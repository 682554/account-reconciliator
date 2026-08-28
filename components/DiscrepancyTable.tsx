import type { ReconciliationItem } from "@/lib/matchEngine";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Row = { type: string; date: string; amount: number; description: string; note: string };

function rowsFor(item: ReconciliationItem): Row[] {
  if (item.type === "missing_from_bank") {
    return [
      {
        type: "Missing from bank",
        date: item.logEntry.date,
        amount: item.logEntry.amountCents,
        description: item.logEntry.description,
        note: item.note,
      },
    ];
  }
  if (item.type === "not_logged") {
    return [
      {
        type: "Not logged",
        date: item.bankEntry.date,
        amount: item.bankEntry.amountCents,
        description: item.bankEntry.description,
        note: item.note,
      },
    ];
  }
  if (item.type === "possible_duplicate") {
    return item.candidates.map((c) => ({
      type: `Possible duplicate (${item.ambiguousSide})`,
      date: c.date,
      amount: c.amountCents,
      description: c.description,
      note: item.note,
    }));
  }
  if (item.type === "unresolved_discrepancy") {
    return [
      {
        type: "Unresolved discrepancy (bank)",
        date: item.bankEntry.date,
        amount: item.bankEntry.amountCents,
        description: item.bankEntry.description,
        note: item.reason,
      },
      {
        type: "Unresolved discrepancy (ledger)",
        date: item.logEntry.date,
        amount: item.logEntry.amountCents,
        description: item.logEntry.description,
        note: item.reason,
      },
    ];
  }
  return [];
}

export default function DiscrepancyTable({ items }: { items: ReconciliationItem[] }) {
  const rows = items.flatMap(rowsFor);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No discrepancies found — everything matched.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="bg-accent">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-3 py-2">{r.type}</td>
              <td className="px-3 py-2">{r.date}</td>
              <td className="px-3 py-2">{formatMoney(r.amount)}</td>
              <td className="px-3 py-2">{r.description}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
