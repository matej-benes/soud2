require("dotenv").config();
const express = require("express");
const path = require("path");
const db = require("./db");
const ai = require("./ai");
const sms = require("./sms");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Lazy resolution of due cases (simulates real legal deadlines passing)
async function processDueCases() {
  const now = new Date();
  const cases = db.getCases();
  for (const c of cases) {
    if (c.status === "Zahájeno (Probíhá šetření)" && c.resolve_at && new Date(c.resolve_at) <= now) {
      const verdict = ai.generateAnalysis(c, "verdikt");
      db.updateCase(c.id, { status: "Ukončeno - Vydán rozsudek", verdict });
      const updated = db.getCaseById(c.id);
      if (updated.applicant_phone) {
        await sms.sendSms(updated.applicant_phone, ai.generateSmsContent("applicant", updated, "verdikt"), updated.case_number, updated.applicant_name);
      }
      if (updated.spouse_phone) {
        await sms.sendSms(updated.spouse_phone, ai.generateSmsContent("spouse", updated, "verdikt"), updated.case_number, updated.spouse_name);
      }
    }
  }
}

app.get("/", async (req, res) => {
  await processDueCases();
  const cases = db.getCases();
  const staff = db.getStaff();
  const smsLogs = db.getSmsLogs(20);
  res.render("index", { cases, staff, smsLogs });
});

app.post("/create_case", async (req, res) => {
  const { department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description } = req.body;
  const c = db.createCase({ department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description });
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
  await processDueCases();
  const c = db.getCaseById(parseInt(req.params.id));
  if (!c) return res.status(404).send("Případ nenalezen");
  const logs = db.getSmsLogsByCase(c.case_number);
  res.render("case_detail", { c, logs });
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`AI Soud běží na http://localhost:${port}`));
}
