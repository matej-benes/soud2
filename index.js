require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const db = require("./db");
const ai = require("./ai");
const sms = require("./sms");
const pdf = require("./pdf");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 5 } });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Cookie helper for PIN access
function getAccessCookie(req, caseId) {
  const name = `case_access_${caseId}`;
  const cookies = (req.headers.cookie || "").split(";").map(c => c.trim());
  const c = cookies.find(x => x.startsWith(name + "="));
  return c ? decodeURIComponent(c.split("=").slice(1).join("=")) : null;
}
function setAccessCookie(res, caseId, value) {
  res.setHeader("Set-Cookie", `case_access_${caseId}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

async function isUnlocked(req, caseId) {
  const c = await db.getCaseById(caseId);
  if (!c) return false;
  if (!c.pin_hash) return true; // no pin set (legacy) -> open
  const cookie = getAccessCookie(req, caseId);
  if (!cookie) return false;
  // cookie stores hash of pin; recompute not possible without pin; store hashed cookie value = pin_hash
  return cookie === c.pin_hash;
}

async function processDueCases() {
  const now = new Date();
  const cases = await db.getCases();
  for (const c of cases) {
    if (c.status === "Zahájeno (Probíhá šetření)" && c.resolve_at && new Date(c.resolve_at) <= now) {
      const judge = await db.getStaffByDept(c.department);
      const verdict = await ai.generateAnalysisAsync(c, "verdikt");
      let pdfBase64 = null;
      try {
        const buf = await pdf.generateDecisionPdf(c, verdict, judge);
        pdfBase64 = buf.toString("base64");
      } catch (e) {
        console.error("PDF gen error:", e.message);
      }
      await db.updateCase(c.id, { status: "Ukončeno - Vydán rozsudek", verdict, pdf_base64: pdfBase64 });
      const updated = await db.getCaseById(c.id);
      const baseUrl = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      const pdfLink = baseUrl ? `${baseUrl}/case/${updated.id}/pdf` : `/case/${updated.id}/pdf`;
      const completionMsg = (recipientType) => `Vážený/á ${recipientType === "applicant" ? updated.applicant_name : updated.spouse_name}, ve věci sp. zn. ${updated.case_number} byl vydán konečný soudní rozsudek oddělením ${updated.department}. Rozhodnutí (PDF) ke stažení: ${pdfLink} . Řízení je tímto pravomocně ukončeno.`;
      if (updated.applicant_phone) {
        await sms.sendSms(updated.applicant_phone, completionMsg("applicant"), updated.case_number, updated.applicant_name);
      }
      if (updated.spouse_phone) {
        await sms.sendSms(updated.spouse_phone, completionMsg("spouse"), updated.case_number, updated.spouse_name);
      }
    }
  }
}

app.get("/", async (req, res) => {
  await db.ensureInit();
  await processDueCases();
  let cases = await db.getCases();
  const staff = await db.getStaff();
  const smsLogs = await db.getSmsLogs(20);

  // Search & filter
  const q = (req.query.q || "").trim().toLowerCase();
  const dept = req.query.department || "";
  const status = req.query.status || "";
  if (q) {
    cases = cases.filter(c =>
      (c.case_number || "").toLowerCase().includes(q) ||
      (c.applicant_name || "").toLowerCase().includes(q) ||
      (c.spouse_name || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q) ||
      (c.other_parties || "").toLowerCase().includes(q)
    );
  }
  if (dept) cases = cases.filter(c => c.department === dept);
  if (status) cases = cases.filter(c => c.status === status || (status === "pending" && c.status.indexOf("Probíhá") >= 0) || (status === "resolved" && c.status.indexOf("Ukončeno") === 0));

  res.render("index", { cases, staff, smsLogs, q, dept, status });
});

app.post("/create_case", async (req, res) => {
  const { department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description } = req.body;

  // Generate PIN for access
  const pin = db.generatePin();
  const pinHash = db.hashPin(pin);

  const c = await db.createCase({ department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description, pin_hash: pinHash });

  const caseData = {
    case_number: c.case_number, department: c.department,
    applicant_name: c.applicant_name, spouse_name: c.spouse_name,
    other_parties: c.other_parties, description: c.description
  };

  // SMS with PIN to participants
  const pinMsg = (name) => `Vážený/á ${name}, Váš přístupový PIN k spisu ${c.case_number} je: ${pin}. UCHOVEJTE SI HO – bude potřeba pro přístup k detailům a rozhodnutí (PDF). Nikomu ho nesdělujte.`;

  if (c.applicant_phone) {
    await sms.sendSms(c.applicant_phone, ai.generateSmsContent("applicant", caseData, "zahájení") + " " + pinMsg(c.applicant_name), c.case_number, c.applicant_name);
  }
  if (c.spouse_phone) {
    await sms.sendSms(c.spouse_phone, ai.generateSmsContent("spouse", caseData, "zahájení") + " " + pinMsg(c.spouse_name), c.case_number, c.spouse_name);
  }

  res.redirect("/");
});

// PIN verification
app.post("/case/:id/verify", async (req, res) => {
  const id = parseInt(req.params.id);
  const pin = (req.body.pin || "").trim();
  const ok = await db.verifyPin(id, pin);
  if (ok) {
    const c = await db.getCaseById(id);
    setAccessCookie(res, id, c.pin_hash);
    return res.redirect(`/case/${id}`);
  }
  res.redirect(`/case/${id}?error=pin`);
});

app.get("/case/:id", async (req, res) => {
  await db.ensureInit();
  const id = parseInt(req.params.id);
  const c = await db.getCaseById(id);
  if (!c) return res.status(404).send("Případ nenalezen");

  // PIN gate
  if (c.pin_hash && !(await isUnlocked(req, id))) {
    const error = req.query.error === "pin" ? "Nesprávný PIN. Zkuste to znovu." : null;
    return res.render("pin_gate", { c, error });
  }

  await processDueCases();
  const updated = await db.getCaseById(id);
  const logs = await db.getSmsLogsByCase(updated.case_number);
  const attachments = await db.getAttachments(id);
  res.render("case_detail", { c: updated, logs, attachments });
});

app.get("/case/:id/pdf", async (req, res) => {
  const id = parseInt(req.params.id);
  const c = await db.getCaseById(id);
  if (!c) return res.status(404).send("Případ nenalezen");
  if (c.pin_hash && !(await isUnlocked(req, id))) {
    return res.status(403).send("Přístup zamítnut. Zadejte PIN.");
  }
  if (!c.pdf_base64) {
    const judge = await db.getStaffByDept(c.department);
    const verdict = c.verdict || ai.generateAnalysis(c, "verdikt");
    try {
      const buf = await pdf.generateDecisionPdf(c, verdict, judge);
      await db.updateCase(c.id, { pdf_base64: buf.toString("base64"), verdict });
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="rozhodnuti_${c.case_number.replace(/\s/g, "_")}.pdf"`);
      return res.send(buf);
    } catch (e) {
      return res.status(500).send("Chyba generování PDF: " + e.message);
    }
  }
  const buf = Buffer.from(c.pdf_base64, "base64");
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="rozhodnuti_${c.case_number.replace(/\s/g, "_")}.pdf"`);
  res.send(buf);
});

// Attachments
app.post("/case/:id/attachments", upload.array("files", 5), async (req, res) => {
  const id = parseInt(req.params.id);
  const c = await db.getCaseById(id);
  if (!c) return res.status(404).send("Případ nenalezen");
  if (c.pin_hash && !(await isUnlocked(req, id))) {
    return res.status(403).send("Přístup zamítnut. Zadejte PIN.");
  }
  if (req.files) {
    for (const f of req.files) {
      const b64 = f.buffer.toString("base64");
      await db.addAttachment(id, f.originalname, f.mimetype, b64);
    }
  }
  res.redirect(`/case/${id}`);
});

app.get("/case/:id/attachment/:attId", async (req, res) => {
  const id = parseInt(req.params.id);
  const c = await db.getCaseById(id);
  if (!c) return res.status(404).send("Případ nenalezen");
  if (c.pin_hash && !(await isUnlocked(req, id))) {
    return res.status(403).send("Přístup zamítnut. Zadejte PIN.");
  }
  const att = await db.getAttachment(parseInt(req.params.attId));
  if (!att) return res.status(404).send("Příloha nenalezena");
  const buf = Buffer.from(att.data_base64, "base64");
  res.set("Content-Type", att.mimetype || "application/octet-stream");
  res.set("Content-Disposition", `inline; filename="${att.filename}"`);
  res.send(buf);
});

app.post("/resolve/:id", async (req, res) => {
  const c = await db.getCaseById(parseInt(req.params.id));
  if (!c) return res.status(404).send("Případ nenalezen");
  if (c.status !== "Zahájeno (Probíhá šetření)") return res.redirect(`/case/${c.id}`);
  await db.updateCase(c.id, { resolve_at: new Date(Date.now() - 1000).toISOString() });
  await processDueCases();
  res.redirect(`/case/${c.id}`);
});

app.post("/admin/reset", async (req, res) => {
  await db.resetAll();
  res.redirect("/");
});

app.get("/api/cron", async (req, res) => {
  await db.ensureInit();
  await processDueCases();
  res.json({ ok: true, backend: db.USE_TURSO ? "turso" : "json", processed: new Date().toISOString() });
});

// Wizard page
app.get("/wizard", (req, res) => {
  res.render("wizard", {});
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`AI Soud běží na http://localhost:${port}`));
}
