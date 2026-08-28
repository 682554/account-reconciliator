"use client";

import { useEffect, useMemo, useState } from "react";
import ColumnMapper from "@/components/ColumnMapper";
import FileUpload from "@/components/FileUpload";
import { autoDetectColumns, type ColumnMapping, type ParsedTable } from "@/lib/parseBankStatement";
import type { ReconciliationResult } from "@/lib/matchEngine";

type MappingState = Partial<ColumnMapping>;

function isCompleteMapping(m: MappingState): m is ColumnMapping {
  const hasAmount = Boolean(m.amount) || Boolean(m.debitColumn) || Boolean(m.creditColumn);
  return Boolean(m.date && m.description && hasAmount);
}

type Props = {
  initialConnected: boolean;
  initialOauthError: string | null;
};

export default function ReconciliatorApp({ initialConnected, initialOauthError }: Props) {
  const [connected] = useState(initialConnected);
  const [oauthError] = useState<string | null>(initialOauthError);

  const [sheetInput, setSheetInput] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [sheetTable, setSheetTable] = useState<ParsedTable | null>(null);
  const [sheetMapping, setSheetMapping] = useState<MappingState>({});
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);

  const [bankTable, setBankTable] = useState<ParsedTable | null>(null);
  const [bankMapping, setBankMapping] = useState<MappingState>({});

  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [emailing, setEmailing] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (initialConnected || initialOauthError) {
      window.history.replaceState({}, "", "/");
    }
  }, [initialConnected, initialOauthError]);

  async function handleListTabs() {
    setSheetError(null);
    setTabs([]);
    setSheetTable(null);
    try {
      const res = await fetch(`/api/sheets/tabs?sheet=${encodeURIComponent(sheetInput)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to list tabs.");
      setTabs(data.tabs);
      if (data.tabs.length > 0) setSelectedTab(data.tabs[0]);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Failed to list tabs.");
    }
  }

  async function handleFetchSheet() {
    setSheetError(null);
    setLoadingSheet(true);
    try {
      const res = await fetch(
        `/api/sheets/fetch?sheet=${encodeURIComponent(sheetInput)}&tab=${encodeURIComponent(selectedTab)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch sheet data.");
      const table: ParsedTable = data;
      setSheetTable(table);
      setSheetMapping(autoDetectColumns(table.headers));
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Failed to fetch sheet data.");
    } finally {
      setLoadingSheet(false);
    }
  }

  const missingSteps = useMemo(() => {
    const missing: string[] = [];
    if (!sheetTable) missing.push("load your logged transactions (step 1)");
    else if (!isCompleteMapping(sheetMapping)) missing.push("finish mapping the logged transaction columns");
    if (!bankTable) missing.push("upload a bank statement (step 2)");
    else if (!isCompleteMapping(bankMapping)) missing.push("finish mapping the bank statement columns");
    return missing;
  }, [sheetTable, bankTable, sheetMapping, bankMapping]);

  const readyToReconcile = missingSteps.length === 0;

  async function sendEmailReport(data: ReconciliationResult) {
    setEmailing(true);
    setEmailError(null);
    setEmailSentTo(null);
    try {
      const res = await fetch("/api/email/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to send email.");
      setEmailSentTo(json.sentTo);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send email.");
    } finally {
      setEmailing(false);
    }
  }

  async function handleReconcile() {
    if (!sheetTable || !bankTable || !isCompleteMapping(sheetMapping) || !isCompleteMapping(bankMapping)) return;
    setReconciling(true);
    setReconcileError(null);
    setResult(null);
    setEmailSentTo(null);
    setEmailError(null);
    try {
      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logTable: sheetTable,
          logMapping: sheetMapping,
          bankTable,
          bankMapping,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reconciliation failed.");
      setResult(data);
      await sendEmailReport(data);
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : "Reconciliation failed.");
    } finally {
      setReconciling(false);
    }
  }

  async function handleDownload(kind: "excel" | "pdf") {
    if (!result) return;
    const res = await fetch(`/api/report/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "excel" ? "reconciliation-report.xlsx" : "reconciliation-summary.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold text-accent-foreground">Account Reconciliator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare your logged transactions against a bank statement, flag discrepancies, and produce a
          reconciliation report for review.
        </p>
      </header>

      {oauthError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Google sign-in failed ({oauthError}). Please try connecting again.
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">1. Connect your Google Sheet</h2>
        {!connected ? (
          <a
            href="/api/auth/google"
            className="inline-flex w-fit items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Connect Google Sheet
          </a>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-green-700 dark:text-green-400">Connected to Google.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Sheet URL or ID</span>
                <input
                  className="w-80 rounded border border-border bg-card px-2 py-1"
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </label>
              <button
                className="rounded border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
                onClick={handleListTabs}
                disabled={!sheetInput}
              >
                List tabs
              </button>
            </div>
            {tabs.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Tab</span>
                  <select
                    className="rounded border border-border bg-card px-2 py-1"
                    value={selectedTab}
                    onChange={(e) => setSelectedTab(e.target.value)}
                  >
                    {tabs.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="rounded border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
                  onClick={handleFetchSheet}
                  disabled={loadingSheet}
                >
                  {loadingSheet ? "Loading..." : "Load transactions"}
                </button>
              </div>
            )}
            {sheetError && <p className="text-sm text-red-600">{sheetError}</p>}
            {sheetTable && (
              <>
                <p className="text-sm text-muted-foreground">Loaded {sheetTable.rows.length} logged transactions.</p>
                <ColumnMapper
                  label="Map logged transaction columns"
                  headers={sheetTable.headers}
                  mapping={sheetMapping}
                  onChange={setSheetMapping}
                />
              </>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">2. Upload the bank statement</h2>
        <FileUpload
          label="Bank statement (CSV, XLSX, or PDF)"
          onParsed={(table) => {
            setBankTable(table);
            setBankMapping(autoDetectColumns(table.headers));
          }}
        />
        {bankTable && (
          <>
            <p className="text-sm text-muted-foreground">Loaded {bankTable.rows.length} bank transactions.</p>
            <ColumnMapper
              label="Map bank statement columns"
              headers={bankTable.headers}
              mapping={bankMapping}
              onChange={setBankMapping}
            />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">3. Reconcile</h2>
        <button
          className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          disabled={!readyToReconcile || reconciling}
          onClick={handleReconcile}
        >
          {reconciling ? "Reconciling..." : "Run reconciliation"}
        </button>
        {!readyToReconcile && (
          <p className="text-sm text-muted-foreground">Before you can reconcile, you still need to: {missingSteps.join("; ")}.</p>
        )}
        {reconcileError && <p className="text-sm text-red-600">{reconcileError}</p>}
      </section>

      {result && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">4. Report</h2>
          <div className="flex gap-2">
            <button
              className="rounded border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
              onClick={() => handleDownload("excel")}
            >
              Download Excel report
            </button>
            <button
              className="rounded border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
              onClick={() => handleDownload("pdf")}
            >
              Download PDF summary
            </button>
          </div>
          {emailing && <p className="text-sm text-muted-foreground">Emailing the report...</p>}
          {emailSentTo && (
            <p className="text-sm text-green-700 dark:text-green-400">Sent to {emailSentTo}.</p>
          )}
          {emailError && <p className="text-sm text-red-600">{emailError}</p>}
        </section>
      )}
    </main>
  );
}
