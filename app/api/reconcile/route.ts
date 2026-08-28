import { NextRequest, NextResponse } from "next/server";
import { normalizeRows, type ColumnMapping, type ParsedTable } from "@/lib/parseBankStatement";
import { reconcile, type MatchOptions } from "@/lib/matchEngine";

type ReconcileRequestBody = {
  logTable: ParsedTable;
  logMapping: ColumnMapping;
  bankTable: ParsedTable;
  bankMapping: ColumnMapping;
  options?: MatchOptions;
};

export async function POST(request: NextRequest) {
  let body: ReconcileRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { logTable, logMapping, bankTable, bankMapping, options } = body;
  if (!logTable || !logMapping || !bankTable || !bankMapping) {
    return NextResponse.json(
      { error: "logTable, logMapping, bankTable, and bankMapping are all required." },
      { status: 400 }
    );
  }

  try {
    const logEntries = normalizeRows(logTable, logMapping, "log");
    const bankEntries = normalizeRows(bankTable, bankMapping, "bank");
    const result = reconcile(logEntries, bankEntries, options);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reconciliation failed." },
      { status: 500 }
    );
  }
}
