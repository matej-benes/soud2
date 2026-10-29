const db = require("./db");

// ---------- Extrakce faktů z popisu žádosti ----------
function extractFacts(text) {
  const t = (text || "").toLowerCase();
  const facts = {
    children: [],
    hasChildren: false,
    childCount: 0,
    property: [],
    hasProperty: false,
    debts: false,
    infidelity: false,
    violence: false,
    addiction: false,
    agreement: false,
    conflict: false,
    housing: null,
    incomeMentioned: false,
    thirdParty: false,
    keywords: []
  };

  // Děti
  const childPatterns = [
    /(\d+)\s*(?:let[aá]?|letý|letá|leté|letých)\s*(?:syn|dcera|dítě|dite|dítěte|dětí|deti)/g,
    /(syn|dcera|dítě|dite)\s*(?:ve věku|věk|aged?)?\s*(\d+)/g,
    /děti\s*[:\-]?\s*([^\.;]+)/g
  ];
  for (const p of childPatterns) {
    let m;
    while ((m = p.exec(t)) !== null) {
      facts.hasChildren = true;
      facts.childCount++;
    }
  }
  if (/dět|syn|dcera|dítě|dite|nezletil/i.test(t)) facts.hasChildren = true;
  // věk dětí
  const ageMatches = t.match(/(\d+)\s*(?:let|rok)/g);
  if (ageMatches) {
    for (const a of ageMatches) {
      const n = parseInt(a);
      if (n > 0 && n < 25) facts.children.push(n);
    }
  }
  facts.childCount = Math.max(facts.childCount, facts.children.length, /dět/i.test(t) ? 1 : 0);

  // Majetek
  if (/byt|dům|dum|nemovit|pozemek|chalupa/i.test(t)) { facts.property.push("nemovitost"); facts.hasProperty = true; }
  if (/auto|vozidl|vůz/i.test(t)) { facts.property.push("vozidlo"); facts.hasProperty = true; }
  if (/úspor|uspor|peníz|penez|hotovost|účet|ucet/i.test(t)) { facts.property.push("finanční prostředky"); facts.hasProperty = true; }
  if (/firma|podnik|živnost/i.test(t)) { facts.property.push("podnikatelský majetek"); facts.hasProperty = true; }

  // Další faktory
  if (/dluh|dluž|půjčk|pujck|exekuc/i.test(t)) facts.debts = true;
  if (/nevěr|never|cizolož|milenc|milenk|cizí vztah/i.test(t)) facts.infidelity = true;
  if (/násil|nasili|agres|bití|biti|týran|tyran|ohrož/i.test(t)) facts.violence = true;
  if (/závisl|zavisl|alkohol|drog|gambl/i.test(t)) facts.addiction = true;
  if (/dohoda|smír|smir|souhlas|společn/i.test(t)) facts.agreement = true;
  if (/spor|nesvár|nesvar|nesouhlas|odmít|odmit|nesouhlasím/i.test(t)) facts.conflict = true;
  if (/třetí osoba|treti osoba|nový partner|nova partnerka|milenec/i.test(t)) facts.thirdParty = true;
  if (/příjem|prijem|plat|výdělek|vydelek|důchod|duchod/i.test(t)) facts.incomeMentioned = true;
  if (/bydlení|bydleni|byt|dům|dum|střídav|stridav|výhradní|vyhradni/i.test(t)) facts.housing = "zmíněno";

  return facts;
}

function getJudge(department) {
  return db.getStaffByDept(department);
}

// ---------- Generování analýzy a verdiktu podle oddělení ----------
function buildAnalysis(caseData, phase) {
  const judge = getJudge(caseData.department);
  const facts = extractFacts(caseData.description + " " + (caseData.other_parties || ""));

  if (phase === "zahájení") {
    let text = `Soudní senát vedený ${judge.name} (${judge.role}) přijal podanou žádost pod sp. zn. ${caseData.case_number} a přidělil ji oddělení ${caseData.department}.\n\n`;
    text += `Předmět řízení: ${caseData.description}\n\n`;
    text += `Účastníci: navrhovatel ${caseData.applicant_name}`;
    if (caseData.spouse_name) text += `, druhý účastník ${caseData.spouse_name}`;
    if (caseData.other_parties) text += `, další dotčené osoby: ${caseData.other_parties}`;
    text += `.\n\n`;
    text += `Soud zahajuje hloubkové zkoumání rodinných poměrů. `;
    if (facts.hasChildren) text += `Vzhledem k přítomnosti nezletilých dětí bude vyžádáno stanovisko OSPOD a provedeno sociální šetření. `;
    if (facts.hasProperty) text += `Bude provedeno vypořádání majetku (SJM / společného jmění). `;
    if (facts.violence) text += `Bylo zmíněno riziko násilí – soud přistoupí k urychlenému zajištění ochrany. `;
    if (facts.infidelity) text += `Byla zmíněna nevěra/cizí vztah – bude zohledněno při posuzování rozvratu manželství. `;
    text += `\nZákonná lhůta pro řízení běží. Účastníci budou vyzváni k vyjádření a předložení důkazů.`;
    return text;
  }

  if (phase === "šetření") {
    let text = `Průběh řízení sp. zn. ${caseData.case_number}:\n\n`;
    text += `1) Sociální a vztahové šetření bylo provedeno. `;
    if (facts.hasChildren) text += `OSPOD prověřil poměry dětí a jejich vztah k oběma rodičům. `;
    if (facts.hasProperty) text += `Byl zjištěn společný majetek vyžadující vypořádání. `;
    if (facts.debts) text += `Byly zjištěny dluhy – budou zohledněny při majetkovém vypořádání. `;
    if (facts.incomeMentioned) text += `Byl zohledněn příjem účastníků pro účely výživného. `;
    text += `\n2) Vyjádření účastníků byla přijata a zaznamenána.\n`;
    text += `3) Soud posoudil všechny důkazy a připravuje konečné rozhodnutí dle zákonné lhůty.`;
    return text;
  }

  // verdikt
  return buildVerdict(caseData, facts, judge);
}

function buildVerdict(caseData, facts, judge) {
  const dept = caseData.department;
  let verdict = `ROZSUDEK\n`;
  verdict += `Soudce: ${judge.name} (${judge.role})\n`;
  verdict += `Spisová značka: ${caseData.case_number}\n`;
  verdict += `Oddělení: ${dept}\n\n`;

  if (dept === "Rozvody") {
    verdict += `I. Výrok o rozvodu\n`;
    // Rozvrat manželství
    let rozvrat = "Manželství je hluboce, trvale a nenapravitelně rozvráceno";
    if (facts.infidelity) rozvrat += " (mimo jiné prokázanou nevěrou jednoho z manželů)";
    if (facts.violence) rozvrat += " (včetně prokázaného domácího násilí)";
    if (facts.addiction) rozvrat += " (v důsledku závislostního chování)";
    if (facts.thirdParty) rozvrat += " (vznikem nového partnerského vztahu)";
    if (!facts.infidelity && !facts.violence && !facts.addiction && !facts.thirdParty) rozvrat += " (dlouhodobé odcizení a ztráta vzájemné důvěry)";
    verdict += `${rozvrat}. Manželství se rozvádí.\n\n`;

    if (facts.hasChildren) {
      verdict += `II. Péče o nezletilé děti\n`;
      if (facts.agreement) {
        verdict += `Účastníci se dohodli na ${facts.childCount > 1 ? "společné" : "střídavé"} péči. Soud dohodu schvaluje jako nejlepší řešení v zájmu dětí.\n`;
      } else {
        verdict += `S ohledem na poměry rodiny a zájem dětí soud svěřuje děti do ${facts.violence ? "výhradní péče druhého rodiče (ochrana před násilím)" : "střídavé péče obou rodičů"}.\n`;
      }
      verdict += `Styk s druhým rodičem je upraven tak, aby byl v zájmu dětí (každý druhý víkend, polovina prázdnin, střídání svátků).\n\n`;
    }

    if (facts.hasProperty) {
      verdict += `III. Vypořádání společného jmění manželů (SJM)\n`;
      verdict += `Společné jmění (`;
      verdict += facts.property.join(", ");
      verdict += `) se vypořádává ${facts.agreement ? "dle dohody účastníků" : "rovným podílem (1/2 každému)"}.\n`;
      if (facts.debts) verdict += `Zjištěné dluhy se rozdělují rovným dílem.\n`;
      verdict += `Byt/domov se přiděluje ${facts.violence ? "poškozené straně" : "straně s péčí o děti"} s vyrovnáním poloviny hodnoty.\n\n`;
    }

    verdict += `IV. Výživné\n`;
    verdict += `Soud stanoví výživné na ${facts.hasChildren ? "nezletilé děti" : "rozvedeného manžela"} ve výši přiměřené příjmům povinného a potřebám oprávněného.\n\n`;
    verdict += `V. Náklady řízení\n`;
    verdict += `Každý účastník nese své náklady; soudní poplatek se rozděluje rovným dílem.\n`;
  }
  else if (dept === "OSPOD") {
    verdict += `I. Zjištění\n`;
    verdict += `Bylo provedeno sociální šetření v rodině. `;
    if (facts.violence) verdict += `Bylo prokázáno riziko pro děti – soud nařizuje okamžitá ochranná opatření.\n`;
    else verdict += `Poměry v rodině byly posouzeny s ohledem na zájem dětí.\n`;
    verdict += `\nII. Rozhodnutí o péči\n`;
    if (facts.violence || facts.addiction) {
      verdict += `Děti se svěřují do péče druhého (nezávadného) rodiče / OSPOD zajistí náhradní rodinnou péči. Styk s rizikovým rodičem je omezen a podmíněn odborným dohledem.\n`;
    } else {
      verdict += `Děti zůstávají v péči ${facts.agreement ? "obou rodičů (společná péče)" : "hlavního pečujícího rodiče"} s pravidelným stykem druhého rodiče.\n`;
    }
    verdict += `\nIII. Doporučení\n`;
    verdict += `OSPOD bude rodinu dále monitorovat po dobu 6 měsíců. Rodičům se doporučuje účast na mediačním/psychologickém poradenství.\n`;
    verdict += `\nIV. Právní základ\n`;
    verdict += `§ 869 a násl. zákona č. 89/2012 Sb. (občanský zákoník) – péče o nezletilé děti; § 9 zákona č. 359/1999 Sb. (OSPOD).\n`;
  }
  else if (dept === "Matrika") {
    verdict += `I. Posouzení způsobilosti\n`;
    verdict += `Byla ověřena způsobilost účastníků k uzavření manželství/partnerství (věk, svéprávnost, absence překážek).\n`;
    verdict += `\nII. Rozhodnutí\n`;
    if (facts.conflict) {
      verdict += `Žádost se odkládá – byly zjištěny překážky (spor mezi účastníky / neúplné podklady). Účastníci jsou vyzváni k doplnění.\n`;
    } else {
      verdict += `Žádost se schvaluje. Manželství/partnerství může být uzavřeno. Matriční úřad provede zápis do matriky.\n`;
    }
    if (facts.thirdParty) {
      verdict += `\nPoznámka: byla zmíněna existence třetí osoby – ověřuje se, zda nejde o bigamii/polygamii (v ČR nepřípustné).\n`;
    }
    verdict += `\nIII. Právní základ\n`;
    verdict += `§ 665 a násl. zákona č. 89/2012 Sb. (občanský zákoník) – uzavření manželství; zákon č. 301/2000 Sb. o matrikách.\n`;
  }
  else if (dept === "Arbitráž") {
    verdict += `I. Posouzení vztahové struktury\n`;
    verdict += `Byla provedena analýza složitého vztahu (${facts.thirdParty ? "včetně třetí osoby" : "dvou účastníků"}).\n`;
    if (facts.infidelity) verdict += `Byla prokázána nevěra – zohledněno při rozdělení.\n`;
    verdict += `\nII. Majetkové vypořádání (nesezdaní partneři)\n`;
    if (facts.hasProperty) {
      verdict += `Společně nabytý majetek (${facts.property.join(", ")}) se vypořádá dle podílů na příspěvcích (obvykle rovným dílem, pokud není prokázán jiný podíl).\n`;
    } else {
      verdict += `Nebyl zjištěn společný majetek vyžadující vypořádání.\n`;
    }
    if (facts.debts) verdict += `Dluhy se rozdělují dle toho, kdo je způsobil.\n`;
    verdict += `\nIII. Péče o děti (pokud relevantní)\n`;
    if (facts.hasChildren) {
      verdict += `Péče o nezletilé děti se řídí zájmem dětí – ${facts.agreement ? "dohodou rodičů" : "soudním rozhodnutím"}.\n`;
    } else {
      verdict += `Děti nejsou předmětem řízení.\n`;
    }
    verdict += `\nIV. Právní základ\n`;
    verdict += `§ 1187 a násl. zákona č. 89/2012 Sb. (bezpodílové spoluvlastnictví); § 1158 a násl. (vypořádání podílů).\n`;
  }

  verdict += `\n\nZÁVĚR\n`;
  verdict += `Soud po zhodnocení všech důkazů a okolností případu rozhodl výše uvedeným způsobem. Rozhodnutí je pravomocné po uplynutí lhůty pro odvolání (15 dnů).`;
  return verdict;
}

function generateAnalysis(caseData, phase) {
  const judge = getJudge(caseData.department);
  // Try OpenAI if available
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    // sync fallback handled below; async not needed here
  }
  return buildAnalysis(caseData, phase);
}

// Async OpenAI enhancement (optional)
async function enhanceWithAI(caseData, phase) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const judge = getJudge(caseData.department);
    const facts = extractFacts(caseData.description + " " + (caseData.other_parties || ""));
    const prompt = `Jsi soudní AI systém Shazamské republiky (právo ČR). Soudce: ${judge.name} (${judge.role}). Oddělení: ${caseData.department}. Případ: ${caseData.case_number}. Navrhovatel: ${caseData.applicant_name}. Druhý účastník: ${caseData.spouse_name}. Ostatní: ${caseData.other_parties}. Popis: ${caseData.description}. Extrahované faktory: ${JSON.stringify(facts)}. Fáze: ${phase}. Vytvoř věcnou, profesionální, přísnou úřední zprávu hodnotící vztahy v rodině a situaci dle českého práva.`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: "Jsi přísný a spravedlivý AI soud ČR." }, { role: "user", content: prompt }], max_tokens: 600 })
    });
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("OpenAI error:", e.message);
    return null;
  }
}

async function generateAnalysisAsync(caseData, phase) {
  const aiText = await enhanceWithAI(caseData, phase);
  if (aiText) return aiText;
  return buildAnalysis(caseData, phase);
}

function generateSmsContent(recipientType, caseData, phase) {
  const name = recipientType === "applicant" ? caseData.applicant_name : (caseData.spouse_name || "Účastník");
  if (phase === "zahájení") {
    if (recipientType === "applicant") {
      return `Vážený/á ${name}, Vaše žádost byla přijata pod sp. zn. ${caseData.case_number} u oddělení ${caseData.department}. Řízení řádně běží dle zákonné lhůty. Budete vyzván/a k vyjádření.`;
    }
    return `Vážený/á ${name}, byla proti Vám / ve Vaší věci podána žádost u soudu sp. zn. ${caseData.case_number} (oddělení ${caseData.department}). Máte zákonnou lhůtu k vyjádření. Ignorování může vést k rozhodnutí bez Vašeho stanoviska.`;
  }
  if (phase === "šetření") {
    return `Vážený/á ${name}, k Vašemu případu sp. zn. ${caseData.case_number} probíhá sociální a vztahové šetření. Sledujte pokyny soudu a portál.`;
  }
  return null; // completion handled separately
}

module.exports = { generateAnalysis, generateAnalysisAsync, generateSmsContent, extractFacts, enhanceWithAI };
