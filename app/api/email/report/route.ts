import { NextRequest, NextResponse } from "next/server";
import { buildExcelReport } from "@/lib/reportExcel";
import { buildPdfSummary } from "@/lib/reportPdf";
import { getUserEmail, sendEmailWithAttachments } from "@/lib/gmail";
import { decryptSession, SESSION_COOKIE_NAME } from "@/lib/session";
import type { ReconciliationResult } from "@/lib/matchEngine";

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function buildBodyText(result: ReconciliationResult): string {
  const s = result.summary;
  const f = result.flowTieOut;
  return [
    "Your reconciliation just ran. Here are the results, with the full Excel report and PDF summary attached.",
    "",
    `Logged transactions: ${s.loggedCount}`,
    `Bank statement transactions: ${s.bankCount}`,
    `Matched pairs: ${s.matchedPairCount}`,
    `Split/batch matches: ${s.splitMatchGroupCount}`,
    `Missing from bank statement: ${s.missingFromBankCount}`,
    `Not logged: ${s.notLoggedCount}`,
    `Possible duplicates (needs review): ${s.possibleDuplicateCount}`,
    `Unresolved discrepancies: ${s.unresolvedDiscrepancyCount}`,
    "",
    `${f.label}: ${f.statusMessage}`,
    `Residual: ${formatMoney(f.residualCents)}`,
    "",
    "See the attached files for the full transaction-level breakdown.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await decryptSession(sessionToken) : null;
  if (!session) {
    return NextResponse.json({ error: "Not connected to Google. Please connect your account." }, { status: 401 });
  }

  let result: ReconciliationResult;
  try {
    result = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const [excelBuffer, pdfBuffer, toEmail] = await Promise.all([
      buildExcelReport(result),
      buildPdfSummary(result),
      getUserEmail(session.googleAccessToken),
    ]);

    await sendEmailWithAttachments(session.googleAccessToken, {
      to: toEmail,
      subject: "Your reconciliation report is ready",
      bodyText: buildBodyText(result),
      attachments: [
        {
          filename: "reconciliation-report.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          content: excelBuffer,
        },
        {
          filename: "reconciliation-summary.pdf",
          contentType: "application/pdf",
          content: pdfBuffer,
        },
      ],
    });

    return NextResponse.json({ sentTo: toEmail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email." },
      { status: 502 }
    );
  }
}
