require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
const ai = require("./ai");
const sms = require("./sms");
const pdf = require("./pdf");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function processDueCases() {
  const now = new Date();
  const cases = await db.getCases();
  for (const c of cases) {
    if (c.status === "Zahájeno (Probíhá šetření)" && c.resolve_at && new Date(c.resolve_at) <= now) {
      const judge = await db.getStaffByDept(c.department);
      const verdict = ai.generateAnalysis(c, "verdikt");
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
  const cases = await db.getCases();
  const staff = await db.getStaff();
  const smsLogs = await db.getSmsLogs(20);
  res.render("index", { cases, staff, smsLogs });
});

app.post("/create_case", async (req, res) => {
  const { department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description } = req.body;
  const c = await db.createCase({ department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description });
  const caseData = {
    case_number: c.case_number, department: c.department,
    applicant_name: c.applicant_name, spouse_name: c.spouse_name,
    other_parties: c.other_parties, description: c.description
  };
  if (c.applicant_phone) {
    await sms.sendSms(c.applicant_phone, ai.generateSmsContent("applicant", caseData, "zahájení"), c.case_number, c.applicant_name);
  }
  if (c.spouse_phone) {
    await sms.sendSms(c.spouse_phone, ai.generateSmsContent("spouse", caseData, "zahájení"), c.case_number, c.spouse_name);
  }
  res.redirect("/");
});

app.get("/case/:id", async (req, res) => {
  await db.ensureInit();
  await processDueCases();
  const c = await db.getCaseById(parseInt(req.params.id));
  if (!c) return res.status(404).send("Případ nenalezen");
  const logs = await db.getSmsLogsByCase(c.case_number);
  res.render("case_detail", { c, logs });
});

app.get("/case/:id/pdf", async (req, res) => {
  const c = await db.getCaseById(parseInt(req.params.id));
  if (!c) return res.status(404).send("Případ nenalezen");
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

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`AI Soud běží na http://localhost:${port} (backend: ${db.USE_TURSO ? "turso" : "json"})`));
}
