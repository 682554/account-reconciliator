import { NextRequest, NextResponse } from "next/server";
import { buildExcelReport } from "@/lib/reportExcel";
import type { ReconciliationResult } from "@/lib/matchEngine";

export async function POST(request: NextRequest) {
  let result: ReconciliationResult;
  try {
    result = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const buffer = await buildExcelReport(result);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="reconciliation-report.xlsx"',
    },
  });
}
