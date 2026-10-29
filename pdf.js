const PDFDocument = require("pdfkit");

function generateDecisionPdf(caseData, verdict, judge) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(16).font("Helvetica-Bold").text("AI SOUD SHAZAMSKÉ REPUBLIKY", { align: "center" });
    doc.fontSize(11).font("Helvetica").text("Rozhodnutí soudu (rozsudek)", { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Case info
    doc.fontSize(11).font("Helvetica-Bold").text("Spisová značka: ", { continued: true });
    doc.font("Helvetica").text(caseData.case_number);
    doc.font("Helvetica-Bold").text("Oddělení: ", { continued: true });
    doc.font("Helvetica").text(caseData.department);
    doc.font("Helvetica-Bold").text("Soudce/úředník: ", { continued: true });
    doc.font("Helvetica").text(judge.name + " (" + judge.role + ")");
    doc.font("Helvetica-Bold").text("Zahájeno: ", { continued: true });
    doc.font("Helvetica").text(new Date(caseData.created_at).toLocaleString("cs-CZ"));
    doc.font("Helvetica-Bold").text("Zákonná lhůta (konečný termín): ", { continued: true });
    doc.font("Helvetica").text(new Date(caseData.deadline_at).toLocaleString("cs-CZ"));
    doc.font("Helvetica-Bold").text("Vydáno: ", { continued: true });
    doc.font("Helvetica").text(new Date().toLocaleString("cs-CZ"));
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Parties
    doc.fontSize(12).font("Helvetica-Bold").text("Účastníci řízení");
    doc.fontSize(11).font("Helvetica").text("Navrhovatel: " + (caseData.applicant_name || "-"));
    doc.text("Druhý účastník: " + (caseData.spouse_name || "-"));
    if (caseData.other_parties) doc.text("Ostatní dotčené osoby: " + caseData.other_parties);
    doc.moveDown(1);

    // Description
    doc.fontSize(12).font("Helvetica-Bold").text("Předmět řízení / Žádost");
    doc.fontSize(11).font("Helvetica").text(caseData.description || "-", { align: "justify" });
    doc.moveDown(1);

    // Verdict
    doc.fontSize(12).font("Helvetica-Bold").text("Rozhodnutí soudu");
    doc.fontSize(11).font("Helvetica").text(verdict || "-", { align: "justify" });
    doc.moveDown(2);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    doc.fontSize(9).font("Helvetica-Oblique").text("Toto rozhodnutí bylo vydáno automatizovaným AI soudním systémem Shazamské republiky. Dokument má informativní charakter.", { align: "center" });

    doc.end();
  });
}

module.exports = { generateDecisionPdf };
