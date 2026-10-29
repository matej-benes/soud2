const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || (process.env.VERCEL ? "/tmp/soud-data.json" : path.join(__dirname, "data.json"));

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("DB load error:", e.message);
  }
  return null;
}

function save(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("DB save error:", e.message);
  }
}

const defaultStaff = [
  { department: "OSPOD", name: "Mgr. Alena Dvořáková", role: "Sociální kurátorka", personality: "Empatická, ale přísná na ochranu zájmů dětí." },
  { department: "OSPOD", name: "Bc. Tomáš Černý", role: "Opatrovník a terénní pracovník", personality: "Pečlivý vyšetřovatel rodinných poměrů." },
  { department: "Matrika", name: "JUDr. Květoslava Růžičková", role: "Matrikářka a soudkyně", personality: "Důsledná znalkyně rodinného práva a předmanželských smluv." },
  { department: "Rozvody", name: "JUDr. Viktor Horák", role: "Předseda senátu pro rozvody", personality: "Rozvážný, hledající smír, ale nekompromisní při rozvratu." },
  { department: "Arbitráž", name: "PhDr. Eva Kratochvílová", role: "Vztahová arbitra a psycholožka", personality: "Specialistka na složité vztahy dvou, tří a více partnerů." }
];

function initData() {
  let data = load();
  if (!data) {
    data = { cases: [], staff: defaultStaff, sms_logs: [], nextCaseId: 1, nextLogId: 1 };
    save(data);
  }
  if (!data.staff || data.staff.length === 0) {
    data.staff = defaultStaff;
    save(data);
  }
  if (!data.cases) data.cases = [];
  if (!data.sms_logs) data.sms_logs = [];
  if (!data.nextCaseId) data.nextCaseId = (data.cases.length ? Math.max(...data.cases.map(c => c.id)) + 1 : 1);
  if (!data.nextLogId) data.nextLogId = (data.sms_logs.length ? Math.max(...data.sms_logs.map(l => l.id)) + 1 : 1);
  return data;
}

function getData() { return initData(); }

function getStaff() { return getData().staff; }
function getStaffByDept(dept) { return getData().staff.find(s => s.department === dept) || { name: "JUDr. Jan Spravedlivý", role: "Soudce", personality: "Nestranný" }; }

function getCases() { return getData().cases.sort((a, b) => b.id - a.id); }
function getCaseById(id) { return getData().cases.find(c => c.id === id); }
function getCaseByNumber(num) { return getData().cases.find(c => c.case_number === num); }

function createCase(payload) {
  const data = getData();
  const caseNum = `${Math.floor(Math.random() * 9) + 1}T ${Math.floor(Math.random() * 90) + 10}/2026`;
  const judge = getStaffByDept(payload.department);
  const now = new Date();
  const legalDays = parseInt(process.env.LEGAL_DEADLINE_DAYS || "30", 10);
  const delaySeconds = process.env.RESOLVE_DELAY_SECONDS
    ? parseInt(process.env.RESOLVE_DELAY_SECONDS, 10)
    : legalDays * 24 * 60 * 60;
  const resolveAt = new Date(now.getTime() + delaySeconds * 1000);
  const deadlineAt = new Date(resolveAt.getTime());

  const c = {
    id: data.nextCaseId++,
    case_number: caseNum,
    department: payload.department,
    applicant_name: payload.applicant_name,
    applicant_phone: payload.applicant_phone || "",
    spouse_name: payload.spouse_name || "",
    spouse_phone: payload.spouse_phone || "",
    other_parties: payload.other_parties || "",
    description: payload.description,
    status: "Zahájeno (Probíhá šetření)",
    created_at: now.toISOString(),
    deadline_at: deadlineAt.toISOString(),
    resolve_at: resolveAt.toISOString(),
    judge_name: judge.name,
    verdict: `Soudní senát vedený soudcem ${judge.name} přijal žádost sp. zn. ${caseNum}. Zahájeno hloubkové šetření rodinných vztahů dle zákonné lhůty.`,
    pdf_base64: null
  };
  data.cases.push(c);
  save(data);
  return c;
}

function addSmsLog(caseNumber, phone, name, message, status) {
  const data = getData();
  const log = {
    id: data.nextLogId++,
    case_number: caseNumber,
    recipient_phone: phone,
    recipient_name: name,
    message: message,
    sent_at: new Date().toISOString(),
    status: status
  };
  data.sms_logs.push(log);
  save(data);
  return log;
}

function getSmsLogs(limit = 20) { return getData().sms_logs.sort((a,b) => b.id - a.id).slice(0, limit); }
function getSmsLogsByCase(caseNumber) { return getData().sms_logs.filter(l => l.case_number === caseNumber).sort((a,b) => a.id - b.id); }

function updateCase(id, patch) {
  const data = getData();
  const idx = data.cases.findIndex(c => c.id === id);
  if (idx === -1) return null;
  data.cases[idx] = { ...data.cases[idx], ...patch };
  save(data);
  return data.cases[idx];
}

function resetAll() {
  const data = { cases: [], staff: defaultStaff, sms_logs: [], nextCaseId: 1, nextLogId: 1 };
  save(data);
  return data;
}

module.exports = {
  getData, getStaff, getStaffByDept, getCases, getCaseById, getCaseByNumber,
  createCase, addSmsLog, getSmsLogs, getSmsLogsByCase, updateCase, resetAll
};
