import type { ReconciliationResult } from "@/lib/matchEngine";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function SummaryCards({ summary }: { summary: ReconciliationResult["summary"] }) {
  const cards = [
    { label: "Reconciled (of logged)", value: `${(summary.matchRateVsLogged * 100).toFixed(1)}%` },
    { label: "Reconciled (of bank)", value: `${(summary.matchRateVsBank * 100).toFixed(1)}%` },
    { label: "Matched pairs", value: summary.matchedPairCount },
    { label: "Split/batch matches", value: summary.splitMatchGroupCount },
    { label: "Missing from bank", value: summary.missingFromBankCount },
    { label: "Not logged", value: summary.notLoggedCount },
    { label: "Possible duplicates", value: summary.possibleDuplicateCount },
    { label: "Unresolved discrepancies", value: summary.unresolvedDiscrepancyCount },
    { label: "Unmatched logged total", value: formatMoney(summary.unmatchedLoggedAbsTotalCents) },
    { label: "Unmatched bank total", value: formatMoney(summary.unmatchedBankAbsTotalCents) },
    { label: "Unresolved delta total", value: formatMoney(summary.unresolvedDiscrepancyAbsTotalCents) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="mt-1 text-lg font-semibold">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
