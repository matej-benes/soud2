const db = require("./db");

function getJudge(department) {
  return db.getStaffByDept(department);
}

function generateAnalysis(caseData, phase) {
  const judge = getJudge(caseData.department);
  if (phase === "zahájení") {
    return `Soudní senát vedený soudcem ${judge.name} (${judge.role}) přijal podanou žádost pod sp. zn. ${caseData.case_number}. Zahajuje se hloubkové zkoumání rodinných vztahů a poměrů účastníků (${caseData.applicant_name} a ${caseData.spouse_name}). Vzhledem k povaze věci v oddělení ${caseData.department} běží zákonná lhůta pro řádné šetření a vyjádření účastníků.`;
  }
  if (phase === "šetření") {
    return `Odbor OSPOD a vyšetřovací tým provedli analýzu vzájemných vazeb. Bylo zjištěno, že situace vyžaduje dodržení celé zákonné lhůty k zajištění klidu a ochraně všech dotčených osob. Účastníci byli vyzváni k předložení dodatečných důkazů.`;
  }
  return `Po uplynutí zákonné lhůty a zhodnocení všech důkazů rozhodl soudce ${judge.name} takto: Žádost pod sp. zn. ${caseData.case_number} se v oddělení ${caseData.department} shledává důvodnou. Byla stanovena nová pravidla pro péči, vztahy či majetkové vypořádání mezi ${caseData.applicant_name} a ${caseData.spouse_name}. Řízení je tímto pravomocně ukončeno.`;
}

function generateSmsContent(recipientType, caseData, phase) {
  const name = recipientType === "applicant" ? caseData.applicant_name : (caseData.spouse_name || "Účastník");
  if (phase === "zahájení") {
    if (recipientType === "applicant") {
      return `Vážený/á ${name}, Vaše žádost byla přijata pod sp. zn. ${caseData.case_number} u oddělení ${caseData.department}. Řízení řádně běží dle zákonné lhůty.`;
    }
    return `Vážený/á ${name}, byla proti Vám / ve Vaší věci podána žádost u soudu sp. zn. ${caseData.case_number}. Máte zákonnou lhůtu k vyjádření.`;
  }
  if (phase === "šetření") {
    return `Vážený/á ${name}, k Vašemu případu sp. zn. ${caseData.case_number} probíhá sociální a vztahové šetření. Sledujte pokyny soudu.`;
  }
  return `Vážený/á ${name}, ve věci sp. zn. ${caseData.case_number} byl vydán konečný soudní verdikt oddělením ${caseData.department}. Zkontrolujte podrobnosti v portálu soudu.`;
}

// Optional OpenAI enhancement (REST, no SDK)
async function enhanceWithAI(caseData, phase) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const judge = getJudge(caseData.department);
    const prompt = `Jsi soudní AI systém Shazamské republiky. Soudce: ${judge.name} (${judge.role}, povaha: ${judge.personality}). Oddělení: ${caseData.department}. Případ: ${caseData.case_number}. Navrhovatel: ${caseData.applicant_name}. Druhý účastník: ${caseData.spouse_name}. Ostatní: ${caseData.other_parties}. Popis: ${caseData.description}. Fáze: ${phase}. Vytvoř věcnou, profesionální, přísnou úřední zprávu hodnotící vztahy v rodině.`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: "Jsi přísný a spravedlivý AI soud." }, { role: "user", content: prompt }], max_tokens: 400 })
    });
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("OpenAI error:", e.message);
    return null;
  }
}

module.exports = { generateAnalysis, generateSmsContent, enhanceWithAI };
