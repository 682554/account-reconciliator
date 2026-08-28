"use client";

import { useState } from "react";
import type { ColumnMapping } from "@/lib/parseBankStatement";

type Props = {
  label: string;
  headers: string[];
  mapping: Partial<ColumnMapping>;
  onChange: (mapping: Partial<ColumnMapping>) => void;
};

function ColumnSelect({
  label,
  value,
  headers,
  placeholder,
  onSelect,
}: {
  label: string;
  value: string;
  headers: string[];
  placeholder: string;
  onSelect: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="rounded border border-border bg-card px-2 py-1"
        value={value}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled={placeholder === "Select column"}>
          {placeholder}
        </option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ColumnMapper({ label, headers, mapping, onChange }: Props) {
  const [splitMode, setSplitMode] = useState(() => Boolean(mapping.debitColumn || mapping.creditColumn));

  function toggleSplitMode(next: boolean) {
    setSplitMode(next);
    onChange(
      next
        ? { ...mapping, amount: undefined }
        : { ...mapping, debitColumn: undefined, creditColumn: undefined }
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{label}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ColumnSelect
          label="Date column"
          value={mapping.date ?? ""}
          headers={headers}
          placeholder="Select column"
          onSelect={(v) => onChange({ ...mapping, date: v })}
        />

        {!splitMode ? (
          <ColumnSelect
            label="Amount column"
            value={mapping.amount ?? ""}
            headers={headers}
            placeholder="Select column"
            onSelect={(v) => onChange({ ...mapping, amount: v })}
          />
        ) : (
          <>
            <ColumnSelect
              label="Withdrawal / Debit column"
              value={mapping.debitColumn ?? ""}
              headers={headers}
              placeholder="None"
              onSelect={(v) => onChange({ ...mapping, debitColumn: v || undefined })}
            />
            <ColumnSelect
              label="Deposit / Credit column"
              value={mapping.creditColumn ?? ""}
              headers={headers}
              placeholder="None"
              onSelect={(v) => onChange({ ...mapping, creditColumn: v || undefined })}
            />
          </>
        )}

        <ColumnSelect
          label="Description column"
          value={mapping.description ?? ""}
          headers={headers}
          placeholder="Select column"
          onSelect={(v) => onChange({ ...mapping, description: v })}
        />

        <ColumnSelect
          label="Reference column (optional)"
          value={mapping.reference ?? ""}
          headers={headers}
          placeholder="None"
          onSelect={(v) => onChange({ ...mapping, reference: v || undefined })}
        />
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={splitMode} onChange={(e) => toggleSplitMode(e.target.checked)} />
        This statement uses separate Withdrawal/Deposit (or Debit/Credit) columns instead of one signed
        Amount column
      </label>

      <p className="mt-2 text-xs text-muted-foreground">
        A reference/check number, when available, helps tell apart two different transactions that happen to
        share the same amount.
      </p>
    </div>
  );
}
