import PDFDocument from "pdfkit";
import type { ReconciliationResult } from "./matchEngine";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export async function buildPdfSummary(result: ReconciliationResult): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const s = result.summary;
  const f = result.flowTieOut;

  doc.fontSize(20).text("Reconciliation Summary", { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#666").text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(14).text(f.label, { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#666").text(f.caveat);
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor("#000");
  const flowRow = (label: string, value: string) => doc.text(`${label}: ${value}`);
  flowRow("Net Bank Activity (this period)", formatMoney(f.netBankActivityCents));
  flowRow("Net Book Activity (this period)", formatMoney(f.netBookActivityCents));
  flowRow("Actual Difference", formatMoney(f.actualDifferenceCents));
  doc.moveDown(0.3);
  doc.text("Explained by:");
  flowRow("  Unmatched bank items (net)", formatMoney(f.unmatchedBankNetCents));
  flowRow("  Unmatched ledger items (net)", formatMoney(-f.unmatchedLedgerNetCents));
  flowRow("  Unresolved discrepancies (net delta)", formatMoney(f.discrepancyNetDeltaCents));
  flowRow("  Probable duplicates (net, excluded)", formatMoney(f.duplicatesNetCents));
  flowRow("Expected Difference", formatMoney(f.expectedDifferenceCents));
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").text(`Residual: ${formatMoney(f.residualCents)}`);
  doc.fillColor(f.reconciles ? "#1a7f37" : "#b42318").text(f.statusMessage);
  doc.font("Helvetica").fillColor("#000");
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(13).text("Totals", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);
  const row = (label: string, value: string) => {
    doc.text(`${label}: ${value}`);
  };
  row("Logged transactions", String(s.loggedCount));
  row("Bank statement transactions", String(s.bankCount));
  row("Matched pairs (1:1)", String(s.matchedPairCount));
  row("Split/batch matches", String(s.splitMatchGroupCount));
  row("Missing from bank statement", String(s.missingFromBankCount));
  row("Not logged", String(s.notLoggedCount));
  row("Possible duplicates (needs review)", String(s.possibleDuplicateCount));
  row("Unresolved discrepancies (probable same txn, mismatch)", String(s.unresolvedDiscrepancyCount));
  row("Reconciled share of logged transactions", `${(s.matchRateVsLogged * 100).toFixed(1)}%`);
  row("Reconciled share of bank transactions", `${(s.matchRateVsBank * 100).toFixed(1)}%`);
  doc.moveDown(1);

  doc.fontSize(13).text("Unmatched Exposure", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);
  row("Unmatched logged total (absolute value)", formatMoney(s.unmatchedLoggedAbsTotalCents));
  row("Unmatched bank total (absolute value)", formatMoney(s.unmatchedBankAbsTotalCents));
  row("Unresolved discrepancy total (absolute delta)", formatMoney(s.unresolvedDiscrepancyAbsTotalCents));
  doc.moveDown(1.5);

  doc
    .fontSize(10)
    .fillColor("#666")
    .text(
      "This is a summary only. See the accompanying Excel report for the full transaction-level breakdown of matches and discrepancies."
    );

  doc.end();
  return done;
}
