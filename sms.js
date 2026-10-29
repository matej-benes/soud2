const db = require("./db");

const ODORIK_URL = "https://www.odorik.cz/api/v1/sms";

function normalizePhone(phone) {
  if (!phone) return "";
  let p = phone.trim().replace(/\s+/g, "");
  if (p.startsWith("+")) p = "00" + p.slice(1);
  if (!p.startsWith("00")) p = "00" + p;
  return p;
}

async function sendSms(phone, message, caseNumber, recipientName) {
  const fullMessage = `SOUD shazamské repub. : - ${message}`;
  const user = process.env.ODORIK_API_USER;
  const pass = process.env.ODORIK_API_PASSWORD;
  const recipient = normalizePhone(phone);

  let status = "SIMULATED (No Odorik credentials)";
  if (user && pass && recipient) {
    try {
      const params = new URLSearchParams();
      params.append("user", user);
      params.append("password", pass);
      params.append("recipient", recipient);
      params.append("message", fullMessage);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(ODORIK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const text = await res.text();
      if (text.toLowerCase().includes("successfully")) {
        status = "SENT (" + text.trim() + ")";
      } else {
        status = "ERROR: " + text.trim();
      }
    } catch (e) {
      status = `EXCEPTION: ${e.message}`;
    }
  } else {
    console.log(`[SMS SIMULATION] To: ${phone} (${recipientName}) | Msg: ${fullMessage}`);
  }

  db.addSmsLog(caseNumber, phone, recipientName, fullMessage, status);
  return status;
}

module.exports = { sendSms, normalizePhone };
