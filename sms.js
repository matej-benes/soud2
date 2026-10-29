const db = require("./db");

const ODORIK_URL = "https://www.odorik.cz/api/v1/sms";

async function sendSms(phone, message, caseNumber, recipientName) {
  const fullMessage = `SOUD shazamské repub. : - ${message}`;
  const user = process.env.ODORIK_API_USER;
  const pass = process.env.ODORIK_API_PASSWORD;

  let status = "SIMULATED (No Odorik credentials)";
  if (user && pass && phone) {
    try {
      const payload = { user, password: pass, sms: [{ recipient: phone, message: fullMessage }] };
      const res = await fetch(ODORIK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      status = res.ok ? "SENT" : `ERROR ${res.status}`;
    } catch (e) {
      status = `EXCEPTION: ${e.message}`;
    }
  } else {
    console.log(`[SMS SIMULATION] To: ${phone} (${recipientName}) | Msg: ${fullMessage}`);
  }

  db.addSmsLog(caseNumber, phone, recipientName, fullMessage, status);
  return status;
}

module.exports = { sendSms };
