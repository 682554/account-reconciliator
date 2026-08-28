"use client";

import { useRef, useState } from "react";
import { parseCsv, parseXlsx, type ParsedTable } from "@/lib/parseBankStatement";

type Props = {
  label: string;
  onParsed: (table: ParsedTable) => void;
};

export default function FileUpload({ label, onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  async function handlePdf(file: File) {
    const res = await fetch("/api/parse/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: await file.arrayBuffer(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to parse this PDF.");
    return data as ParsedTable;
  }

  async function handleFile(file: File) {
    setError(null);
    setParsing(true);
    try {
      const isXlsx = /\.xlsx?$/i.test(file.name);
      const isPdf = /\.pdf$/i.test(file.name);
      const table = isPdf
        ? await handlePdf(file)
        : isXlsx
          ? parseXlsx(await file.arrayBuffer())
          : parseCsv(await file.text());
      if (table.headers.length === 0 || table.rows.length === 0) {
        setError("Couldn't find any transactions in this file. Please check the format.");
        return;
      }
      setFileName(file.name);
      onParsed(table);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse this file. Please upload a valid CSV, XLSX, or PDF export.");
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{label}</h3>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 text-sm text-accent-foreground hover:opacity-90 disabled:opacity-40"
          onClick={() => inputRef.current?.click()}
          disabled={parsing}
        >
          {fileName ? "Change file" : "Choose file"}
        </button>
        <span className="text-sm text-muted-foreground">
          {parsing ? "Parsing..." : (fileName ?? "No file chosen")}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.pdf"
        className="hidden"
        disabled={parsing}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
