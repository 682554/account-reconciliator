import type { FlowTieOut } from "@/lib/matchEngine";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function FlowTieOutPanel({ flowTieOut }: { flowTieOut: FlowTieOut }) {
  const f = flowTieOut;

  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        f.reconciles
          ? "border-border bg-card"
          : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
      }`}
    >
      <h3 className="text-sm font-semibold">{f.label}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{f.caveat}</p>

      <div className="mt-3 flex flex-col gap-1">
        <Row label="Net Bank Activity (this period)" value={formatMoney(f.netBankActivityCents)} />
        <Row label="Net Book Activity (this period)" value={formatMoney(f.netBookActivityCents)} />
        <Row label="Actual Difference" value={formatMoney(f.actualDifferenceCents)} bold />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <p className="text-muted-foreground">Explained by:</p>
        <Row label="  Unmatched bank items (net)" value={formatMoney(f.unmatchedBankNetCents)} />
        <Row label="  Unmatched ledger items (net)" value={formatMoney(-f.unmatchedLedgerNetCents)} />
        <Row label="  Unresolved discrepancies (net delta)" value={formatMoney(f.discrepancyNetDeltaCents)} />
        <Row label="  Probable duplicates (net, excluded)" value={formatMoney(f.duplicatesNetCents)} />
        <Row label="Expected Difference" value={formatMoney(f.expectedDifferenceCents)} bold />
      </div>

      <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
        <Row label="Residual" value={formatMoney(f.residualCents)} bold />
        <p
          className={`mt-1 font-semibold ${
            f.reconciles ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
          }`}
        >
          {f.statusMessage}
        </p>
      </div>
    </div>
  );
}
