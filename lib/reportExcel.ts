import ExcelJS from "exceljs";
import type { ReconciliationResult } from "./matchEngine";

function formatCents(cents: number): number {
  return cents / 100;
}

const MATCH_REASON_LABEL: Record<string, string> = {
  exact: "Exact date + amount",
  reference_match: "Reference number match",
  matched_date_gap: "Reference match, large date gap — review",
  date_mismatch: "Near date + description match",
};

export async function buildExcelReport(result: ReconciliationResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Account Reconciliator";
  workbook.created = new Date();

  const f = result.flowTieOut;
  const flowSheet = workbook.addWorksheet("Flow Tie-Out");
  flowSheet.columns = [
    { header: "", key: "line", width: 42 },
    { header: "", key: "amount", width: 20 },
  ];
  flowSheet.addRow({ line: f.label });
  flowSheet.getRow(1).font = { bold: true, size: 14 };
  flowSheet.addRow({ line: f.caveat });
  flowSheet.getRow(2).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  flowSheet.getRow(2).alignment = { wrapText: true };
  flowSheet.mergeCells("A2:B2");
  flowSheet.addRow({});
  flowSheet.addRow({ line: "Net Bank Activity (this period)", amount: formatCents(f.netBankActivityCents) });
  flowSheet.addRow({ line: "Net Book Activity (this period)", amount: formatCents(f.netBookActivityCents) });
  flowSheet.addRow({ line: "Actual Difference", amount: formatCents(f.actualDifferenceCents) });
  flowSheet.addRow({});
  flowSheet.addRow({ line: "Explained by:" });
  flowSheet.addRow({ line: "  Unmatched bank items (net)", amount: formatCents(f.unmatchedBankNetCents) });
  flowSheet.addRow({ line: "  Unmatched ledger items (net)", amount: formatCents(-f.unmatchedLedgerNetCents) });
  flowSheet.addRow({ line: "  Unresolved discrepancies (net delta)", amount: formatCents(f.discrepancyNetDeltaCents) });
  flowSheet.addRow({ line: "  Probable duplicates (net, excluded)", amount: formatCents(f.duplicatesNetCents) });
  flowSheet.addRow({ line: "Expected Difference", amount: formatCents(f.expectedDifferenceCents) });
  flowSheet.addRow({});
  const residualRow = flowSheet.addRow({ line: "Residual", amount: formatCents(f.residualCents) });
  residualRow.font = { bold: true };
  const statusRow = flowSheet.addRow({ line: f.statusMessage });
  statusRow.font = f.reconciles
    ? { bold: true, color: { argb: "FF1A7F37" } }
    : { bold: true, color: { argb: "FFB42318" } };
  statusRow.alignment = { wrapText: true };
  flowSheet.mergeCells(`A${statusRow.number}:B${statusRow.number}`);

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value", key: "value", width: 20 },
  ];
  const s = result.summary;
  summarySheet.addRows([
    { metric: "Logged transactions", value: s.loggedCount },
    { metric: "Bank statement transactions", value: s.bankCount },
    { metric: "Matched pairs (1:1)", value: s.matchedPairCount },
    { metric: "Split/batch matches (1 line = sum of 2-4 lines)", value: s.splitMatchGroupCount },
    { metric: "Missing from bank statement", value: s.missingFromBankCount },
    { metric: "Not logged", value: s.notLoggedCount },
    { metric: "Possible duplicates (needs review)", value: s.possibleDuplicateCount },
    { metric: "Unresolved discrepancies (probable same txn, mismatch)", value: s.unresolvedDiscrepancyCount },
    { metric: "Unresolved discrepancy total (abs delta)", value: formatCents(s.unresolvedDiscrepancyAbsTotalCents) },
    { metric: "Reconciled share of logged transactions", value: `${(s.matchRateVsLogged * 100).toFixed(1)}%` },
    { metric: "Reconciled share of bank transactions", value: `${(s.matchRateVsBank * 100).toFixed(1)}%` },
    { metric: "Unmatched logged total (abs value — real exposure)", value: formatCents(s.unmatchedLoggedAbsTotalCents) },
    { metric: "Unmatched bank total (abs value — real exposure)", value: formatCents(s.unmatchedBankAbsTotalCents) },
  ]);
  summarySheet.getRow(1).font = { bold: true };

  const matchedSheet = workbook.addWorksheet("Matched");
  matchedSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Logged Description", key: "logDesc", width: 36 },
    { header: "Bank Description", key: "bankDesc", width: 36 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Match Reason", key: "reason", width: 30 },
    { header: "Description Similarity", key: "similarity", width: 20 },
  ];
  matchedSheet.getRow(1).font = { bold: true };

  const splitMatchSheet = workbook.addWorksheet("Split Matches");
  splitMatchSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Single-side Amount", key: "singleAmount", width: 18 },
    { header: "Single Side", key: "singleSide", width: 12 },
    { header: "Single Description", key: "singleDesc", width: 36 },
    { header: "Group Lines (other side)", key: "groupLines", width: 70 },
  ];
  splitMatchSheet.getRow(1).font = { bold: true };

  const unresolvedSheet = workbook.addWorksheet("Unresolved Discrepancies");
  unresolvedSheet.columns = [
    { header: "Bank Date", key: "bankDate", width: 14 },
    { header: "Bank Description", key: "bankDesc", width: 32 },
    { header: "Bank Amount", key: "bankAmount", width: 14 },
    { header: "Ledger Date", key: "logDate", width: 14 },
    { header: "Ledger Description", key: "logDesc", width: 32 },
    { header: "Ledger Amount", key: "logAmount", width: 14 },
    { header: "Delta (bank - ledger)", key: "delta", width: 18 },
    { header: "Reason", key: "reason", width: 50 },
  ];
  unresolvedSheet.getRow(1).font = { bold: true };

  const discrepancySheet = workbook.addWorksheet("Discrepancies");
  discrepancySheet.columns = [
    { header: "Type", key: "type", width: 22 },
    { header: "Date", key: "date", width: 14 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Description", key: "description", width: 40 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Note", key: "note", width: 50 },
  ];
  discrepancySheet.getRow(1).font = { bold: true };

  for (const item of result.items) {
    if (item.type === "matched") {
      matchedSheet.addRow({
        date: item.logEntry.date,
        amount: formatCents(item.logEntry.amountCents),
        logDesc: item.logEntry.description,
        bankDesc: item.bankEntry.description,
        reference: item.bankEntry.reference ?? item.logEntry.reference ?? "",
        reason: MATCH_REASON_LABEL[item.reason] ?? item.reason,
        similarity: item.descriptionSimilarity.toFixed(2),
      });
    } else if (item.type === "split_match") {
      const groupLines = item.groupEntries
        .map((g) => `${formatCents(g.amountCents)} — ${g.description}`)
        .join(" | ");
      splitMatchSheet.addRow({
        date: item.singleEntry.date,
        singleAmount: formatCents(item.singleEntry.amountCents),
        singleSide: item.singleSide === "bank" ? "Bank" : "Logged",
        singleDesc: item.singleEntry.description,
        groupLines,
      });
    } else if (item.type === "unresolved_discrepancy") {
      unresolvedSheet.addRow({
        bankDate: item.bankEntry.date,
        bankDesc: item.bankEntry.description,
        bankAmount: formatCents(item.bankEntry.amountCents),
        logDate: item.logEntry.date,
        logDesc: item.logEntry.description,
        logAmount: formatCents(item.logEntry.amountCents),
        delta: formatCents(item.deltaCents),
        reason: item.reason,
      });
    } else if (item.type === "missing_from_bank") {
      discrepancySheet.addRow({
        type: "Missing from bank statement",
        date: item.logEntry.date,
        amount: formatCents(item.logEntry.amountCents),
        description: item.logEntry.description,
        reference: item.logEntry.reference ?? "",
        note: item.note,
      });
    } else if (item.type === "not_logged") {
      discrepancySheet.addRow({
        type: "Not logged",
        date: item.bankEntry.date,
        amount: formatCents(item.bankEntry.amountCents),
        description: item.bankEntry.description,
        reference: item.bankEntry.reference ?? "",
        note: item.note,
      });
    } else if (item.type === "possible_duplicate") {
      for (const candidate of item.candidates) {
        discrepancySheet.addRow({
          type: `Possible duplicate — ${item.ambiguousSide} side (needs review)`,
          date: candidate.date,
          amount: formatCents(candidate.amountCents),
          description: candidate.description,
          reference: candidate.reference ?? "",
          note: item.note,
        });
      }
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
