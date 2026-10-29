const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- Backend selection ----------
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const PG_URL = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

let backend = "json";
let tursoClient = null;
let pgSql = null;

if (TURSO_URL && TURSO_TOKEN) {
  backend = "turso";
  const { createClient } = require("@libsql/client");
  tursoClient = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
} else if (PG_URL) {
  backend = "postgres";
  const { neon } = require("@neondatabase/serverless");
  pgSql = neon(PG_URL);
}

const DATA_FILE = process.env.DATA_FILE || (process.env.VERCEL ? "/tmp/soud-data.json" : path.join(__dirname, "data.json"));

const defaultStaff = [
  { department: "OSPOD", name: "Mgr. Alena Dvořáková", role: "Sociální kurátorka", personality: "Empatická, ale přísná na ochranu zájmů dětí." },
  { department: "OSPOD", name: "Bc. Tomáš Černý", role: "Opatrovník a terénní pracovník", personality: "Pečlivý vyšetřovatel rodinných poměrů." },
  { department: "Matrika", name: "JUDr. Květoslava Růžičková", role: "Matrikářka a soudkyně", personality: "Důsledná znalkyně rodinného práva a předmanželských smluv." },
  { department: "Rozvody", name: "JUDr. Viktor Horák", role: "Předseda senátu pro rozvody", personality: "Rozvážný, hledající smír, ale nekompromisní při rozvratu." },
  { department: "Arbitráž", name: "PhDr. Eva Kratochvílová", role: "Vztahová arbitra a psycholožka", personality: "Specialistka na složité vztahy dvou, tří a více partnerů." }
];

// ---------- JSON file backend ----------
function loadJson() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch (e) { console.error("DB load error:", e.message); }
  return null;
}
function saveJson(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("DB save error:", e.message); }
}
function initJson() {
  let data = loadJson();
  if (!data) { data = { cases: [], staff: defaultStaff, sms_logs: [], attachments: [], nextCaseId: 1, nextLogId: 1, nextAttId: 1 }; saveJson(data); }
  if (!data.staff || !data.staff.length) { data.staff = defaultStaff; saveJson(data); }
  if (!data.cases) data.cases = [];
  if (!data.sms_logs) data.sms_logs = [];
  if (!data.attachments) data.attachments = [];
  if (!data.nextCaseId) data.nextCaseId = (data.cases.length ? Math.max(...data.cases.map(c => c.id)) + 1 : 1);
  if (!data.nextLogId) data.nextLogId = (data.sms_logs.length ? Math.max(...data.sms_logs.map(l => l.id)) + 1 : 1);
  if (!data.nextAttId) data.nextAttId = (data.attachments.length ? Math.max(...data.attachments.map(a => a.id)) + 1 : 1);
  return data;
}

// ---------- Turso init ----------
async function initTurso() {
  await tursoClient.execute(`CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT UNIQUE, department TEXT, applicant_name TEXT, applicant_phone TEXT, spouse_name TEXT, spouse_phone TEXT, other_parties TEXT, description TEXT, status TEXT, created_at TEXT, deadline_at TEXT, resolve_at TEXT, judge_name TEXT, verdict TEXT, pdf_base64 TEXT, pin_hash TEXT)`);
  await tursoClient.execute(`CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, department TEXT, name TEXT, role TEXT, personality TEXT)`);
  await tursoClient.execute(`CREATE TABLE IF NOT EXISTS sms_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT, recipient_phone TEXT, recipient_name TEXT, message TEXT, sent_at TEXT, status TEXT)`);
  await tursoClient.execute(`CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, filename TEXT, mimetype TEXT, data_base64 TEXT, uploaded_at TEXT)`);
  const r = await tursoClient.execute("SELECT COUNT(*) as c FROM staff");
  const cnt = r.rows[0].c ?? r.rows[0][0];
  if (cnt == 0) {
    for (const s of defaultStaff) {
      await tursoClient.execute({ sql: "INSERT INTO staff (department, name, role, personality) VALUES (?,?,?,?)", args: [s.department, s.name, s.role, s.personality] });
    }
  }
}

// ---------- Postgres init ----------
async function initPg() {
  await pgSql`CREATE TABLE IF NOT EXISTS cases (id SERIAL PRIMARY KEY, case_number TEXT UNIQUE, department TEXT, applicant_name TEXT, applicant_phone TEXT, spouse_name TEXT, spouse_phone TEXT, other_parties TEXT, description TEXT, status TEXT, created_at TEXT, deadline_at TEXT, resolve_at TEXT, judge_name TEXT, verdict TEXT, pdf_base64 TEXT, pin_hash TEXT)`;
  await pgSql`CREATE TABLE IF NOT EXISTS staff (id SERIAL PRIMARY KEY, department TEXT, name TEXT, role TEXT, personality TEXT)`;
  await pgSql`CREATE TABLE IF NOT EXISTS sms_logs (id SERIAL PRIMARY KEY, case_number TEXT, recipient_phone TEXT, recipient_name TEXT, message TEXT, sent_at TEXT, status TEXT)`;
  await pgSql`CREATE TABLE IF NOT EXISTS attachments (id SERIAL PRIMARY KEY, case_id INTEGER, filename TEXT, mimetype TEXT, data_base64 TEXT, uploaded_at TEXT)`;
  const rows = await pgSql`SELECT COUNT(*)::int as c FROM staff`;
  if (rows[0].c == 0) {
    for (const s of defaultStaff) {
      await pgSql`INSERT INTO staff (department, name, role, personality) VALUES (${s.department}, ${s.name}, ${s.role}, ${s.personality})`;
    }
  }
}

let initPromise = null;
function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      if (backend === "turso") await initTurso();
      else if (backend === "postgres") await initPg();
      else initJson();
    })().catch(e => { initPromise = null; console.error("DB init error:", e.message); throw e; });
  }
  return initPromise;
}

// ---------- Helpers ----------
function mapCase(row) {
  return {
    id: row.id, case_number: row.case_number, department: row.department,
    applicant_name: row.applicant_name, applicant_phone: row.applicant_phone,
    spouse_name: row.spouse_name, spouse_phone: row.spouse_phone,
    other_parties: row.other_parties, description: row.description,
    status: row.status, created_at: row.created_at, deadline_at: row.deadline_at,
    resolve_at: row.resolve_at, judge_name: row.judge_name, verdict: row.verdict,
    pdf_base64: row.pdf_base64, pin_hash: row.pin_hash
  };
}

// ---------- Unified API ----------
async function getStaff() {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute("SELECT department, name, role, personality FROM staff");
    return r.rows.map(row => ({ department: row.department, name: row.name, role: row.role, personality: row.personality }));
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT department, name, role, personality FROM staff`;
    return rows.map(r => ({ department: r.department, name: r.name, role: r.role, personality: r.personality }));
  }
  return initJson().staff;
}

async function getStaffByDept(dept) {
  const staff = await getStaff();
  return staff.find(s => s.department === dept) || { name: "JUDr. Jan Spravedlivý", role: "Soudce", personality: "Nestranný", department: dept };
}

async function getCases() {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute("SELECT * FROM cases ORDER BY id DESC");
    return r.rows.map(mapCase);
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT * FROM cases ORDER BY id DESC`;
    return rows.map(mapCase);
  }
  return initJson().cases.slice().sort((a, b) => b.id - a.id);
}

async function getCaseById(id) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "SELECT * FROM cases WHERE id = ?", args: [id] });
    if (!r.rows.length) return null;
    return mapCase(r.rows[0]);
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT * FROM cases WHERE id = ${id}`;
    if (!rows.length) return null;
    return mapCase(rows[0]);
  }
  return initJson().cases.find(c => c.id === id) || null;
}

async function getCaseByNumber(num) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "SELECT * FROM cases WHERE case_number = ?", args: [num] });
    if (!r.rows.length) return null;
    return mapCase(r.rows[0]);
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT * FROM cases WHERE case_number = ${num}`;
    if (!rows.length) return null;
    return mapCase(rows[0]);
  }
  return initJson().cases.find(c => c.case_number === num) || null;
}

async function createCase(payload) {
  await ensureInit();
  const caseNum = `${Math.floor(Math.random() * 9) + 1}T ${Math.floor(Math.random() * 90) + 10}/2026`;
  const judge = await getStaffByDept(payload.department);
  const now = new Date();
  const legalDays = parseInt(process.env.LEGAL_DEADLINE_DAYS || "30", 10);
  const delaySeconds = process.env.RESOLVE_DELAY_SECONDS ? parseInt(process.env.RESOLVE_DELAY_SECONDS, 10) : legalDays * 24 * 60 * 60;
  const resolveAt = new Date(now.getTime() + delaySeconds * 1000);
  const deadlineAt = new Date(resolveAt.getTime());
  const verdict = `Soudní senát vedený soudcem ${judge.name} přijal žádost sp. zn. ${caseNum}. Zahájeno hloubkové šetření rodinných vztahů dle zákonné lhůty.`;

  if (backend === "turso") {
    await tursoClient.execute({
      sql: `INSERT INTO cases (case_number, department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description, status, created_at, deadline_at, resolve_at, judge_name, verdict, pdf_base64, pin_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [caseNum, payload.department, payload.applicant_name, payload.applicant_phone || "", payload.spouse_name || "", payload.spouse_phone || "", payload.other_parties || "", payload.description, "Zahájeno (Probíhá šetření)", now.toISOString(), deadlineAt.toISOString(), resolveAt.toISOString(), judge.name, verdict, null, payload.pin_hash || null]
    });
    return await getCaseByNumber(caseNum);
  }
  if (backend === "postgres") {
    await pgSql`INSERT INTO cases (case_number, department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description, status, created_at, deadline_at, resolve_at, judge_name, verdict, pdf_base64, pin_hash) VALUES (${caseNum}, ${payload.department}, ${payload.applicant_name}, ${payload.applicant_phone || ""}, ${payload.spouse_name || ""}, ${payload.spouse_phone || ""}, ${payload.other_parties || ""}, ${payload.description}, ${"Zahájeno (Probíhá šetření)"}, ${now.toISOString()}, ${deadlineAt.toISOString()}, ${resolveAt.toISOString()}, ${judge.name}, ${verdict}, ${null}, ${payload.pin_hash || null})`;
    return await getCaseByNumber(caseNum);
  }
  const data = initJson();
  const c = { id: data.nextCaseId++, case_number: caseNum, department: payload.department, applicant_name: payload.applicant_name, applicant_phone: payload.applicant_phone || "", spouse_name: payload.spouse_name || "", spouse_phone: payload.spouse_phone || "", other_parties: payload.other_parties || "", description: payload.description, status: "Zahájeno (Probíhá šetření)", created_at: now.toISOString(), deadline_at: deadlineAt.toISOString(), resolve_at: resolveAt.toISOString(), judge_name: judge.name, verdict, pdf_base64: null, pin_hash: payload.pin_hash || null };
  data.cases.push(c);
  saveJson(data);
  return c;
}

async function addSmsLog(caseNumber, phone, name, message, status) {
  await ensureInit();
  if (backend === "turso") {
    await tursoClient.execute({ sql: "INSERT INTO sms_logs (case_number, recipient_phone, recipient_name, message, sent_at, status) VALUES (?,?,?,?,?,?)", args: [caseNumber, phone, name, message, new Date().toISOString(), status] });
    return;
  }
  if (backend === "postgres") {
    await pgSql`INSERT INTO sms_logs (case_number, recipient_phone, recipient_name, message, sent_at, status) VALUES (${caseNumber}, ${phone}, ${name}, ${message}, ${new Date().toISOString()}, ${status})`;
    return;
  }
  const data = initJson();
  const log = { id: data.nextLogId++, case_number: caseNumber, recipient_phone: phone, recipient_name: name, message, sent_at: new Date().toISOString(), status };
  data.sms_logs.push(log);
  saveJson(data);
  return log;
}

async function getSmsLogs(limit = 20) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "SELECT * FROM sms_logs ORDER BY id DESC LIMIT ?", args: [limit] });
    return r.rows.map(row => ({ id: row.id, case_number: row.case_number, recipient_phone: row.recipient_phone, recipient_name: row.recipient_name, message: row.message, sent_at: row.sent_at, status: row.status }));
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT * FROM sms_logs ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(r => ({ id: r.id, case_number: r.case_number, recipient_phone: r.recipient_phone, recipient_name: r.recipient_name, message: r.message, sent_at: r.sent_at, status: r.status }));
  }
  return initJson().sms_logs.slice().sort((a, b) => b.id - a.id).slice(0, limit);
}

async function getSmsLogsByCase(caseNumber) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "SELECT * FROM sms_logs WHERE case_number = ? ORDER BY id ASC", args: [caseNumber] });
    return r.rows.map(row => ({ id: row.id, case_number: row.case_number, recipient_phone: row.recipient_phone, recipient_name: row.recipient_name, message: row.message, sent_at: row.sent_at, status: row.status }));
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT * FROM sms_logs WHERE case_number = ${caseNumber} ORDER BY id ASC`;
    return rows.map(r => ({ id: r.id, case_number: r.case_number, recipient_phone: r.recipient_phone, recipient_name: r.recipient_name, message: r.message, sent_at: r.sent_at, status: r.status }));
  }
  return initJson().sms_logs.filter(l => l.case_number === caseNumber).sort((a, b) => a.id - b.id);
}

async function updateCase(id, patch) {
  await ensureInit();
  if (backend === "turso") {
    const sets = Object.keys(patch).map(k => `${k} = ?`).join(", ");
    const args = [...Object.values(patch), id];
    if (Object.keys(patch).length) await tursoClient.execute({ sql: `UPDATE cases SET ${sets} WHERE id = ?`, args });
    return await getCaseById(id);
  }
  if (backend === "postgres") {
    // build dynamic update
    const keys = Object.keys(patch);
    if (keys.length) {
      // use simple sequential updates
      for (const k of keys) {
        await pgSql`UPDATE cases SET ${pgSql.unsafe(k)} = ${patch[k]} WHERE id = ${id}`;
      }
    }
    return await getCaseById(id);
  }
  const data = initJson();
  const idx = data.cases.findIndex(c => c.id === id);
  if (idx === -1) return null;
  data.cases[idx] = { ...data.cases[idx], ...patch };
  saveJson(data);
  return data.cases[idx];
}

async function addAttachment(caseId, filename, mimetype, base64Data) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "INSERT INTO attachments (case_id, filename, mimetype, data_base64, uploaded_at) VALUES (?,?,?,?,?)", args: [caseId, filename, mimetype, base64Data, new Date().toISOString()] });
    return Number(r.lastInsertRowid);
  }
  if (backend === "postgres") {
    const rows = await pgSql`INSERT INTO attachments (case_id, filename, mimetype, data_base64, uploaded_at) VALUES (${caseId}, ${filename}, ${mimetype}, ${base64Data}, ${new Date().toISOString()}) RETURNING id`;
    return rows[0].id;
  }
  const data = initJson();
  if (!data.attachments) data.attachments = [];
  const id = (data.attachments.length ? Math.max(...data.attachments.map(a => a.id)) + 1 : 1);
  data.attachments.push({ id, case_id: caseId, filename, mimetype, data_base64: base64Data, uploaded_at: new Date().toISOString() });
  saveJson(data);
  return id;
}

async function getAttachments(caseId) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "SELECT id, case_id, filename, mimetype, uploaded_at FROM attachments WHERE case_id = ?", args: [caseId] });
    return r.rows.map(row => ({ id: row.id, case_id: row.case_id, filename: row.filename, mimetype: row.mimetype, uploaded_at: row.uploaded_at }));
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT id, case_id, filename, mimetype, uploaded_at FROM attachments WHERE case_id = ${caseId}`;
    return rows.map(r => ({ id: r.id, case_id: r.case_id, filename: r.filename, mimetype: r.mimetype, uploaded_at: r.uploaded_at }));
  }
  const data = initJson();
  return (data.attachments || []).filter(a => a.case_id === caseId).map(a => ({ id: a.id, case_id: a.case_id, filename: a.filename, mimetype: a.mimetype, uploaded_at: a.uploaded_at }));
}

async function getAttachment(attId) {
  await ensureInit();
  if (backend === "turso") {
    const r = await tursoClient.execute({ sql: "SELECT * FROM attachments WHERE id = ?", args: [attId] });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return { id: row.id, case_id: row.case_id, filename: row.filename, mimetype: row.mimetype, data_base64: row.data_base64, uploaded_at: row.uploaded_at };
  }
  if (backend === "postgres") {
    const rows = await pgSql`SELECT * FROM attachments WHERE id = ${attId}`;
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, case_id: r.case_id, filename: r.filename, mimetype: r.mimetype, data_base64: r.data_base64, uploaded_at: r.uploaded_at };
  }
  const data = initJson();
  return (data.attachments || []).find(a => a.id === attId) || null;
}

async function resetAll() {
  await ensureInit();
  if (backend === "turso") {
    await tursoClient.execute("DELETE FROM cases");
    await tursoClient.execute("DELETE FROM sms_logs");
    await tursoClient.execute("DELETE FROM attachments");
    try { await tursoClient.execute("DELETE FROM sqlite_sequence WHERE name IN ('cases','sms_logs','attachments')"); } catch (e) {}
    return;
  }
  if (backend === "postgres") {
    await pgSql`TRUNCATE cases, sms_logs, attachments RESTART IDENTITY`;
    return;
  }
  const data = { cases: [], staff: defaultStaff, sms_logs: [], attachments: [], nextCaseId: 1, nextLogId: 1, nextAttId: 1 };
  saveJson(data);
  return data;
}

// ---------- PIN helpers ----------
function hashPin(pin) { return crypto.createHash("sha256").update(String(pin)).digest("hex"); }
function generatePin() { return String(Math.floor(100000 + Math.random() * 900000)); }
async function verifyPin(caseId, pin) {
  const c = await getCaseById(caseId);
  if (!c || !c.pin_hash) return false;
  return c.pin_hash === hashPin(pin);
}

module.exports = {
  backend, USE_TURSO: backend === "turso",
  ensureInit, getStaff, getStaffByDept, getCases, getCaseById, getCaseByNumber,
  createCase, addSmsLog, getSmsLogs, getSmsLogsByCase, updateCase, resetAll,
  generatePin, hashPin, verifyPin,
  addAttachment, getAttachments, getAttachment
};
