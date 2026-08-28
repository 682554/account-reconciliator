import { NextRequest, NextResponse } from "next/server";
import { fetchSheetValues, parseSpreadsheetId } from "@/lib/googleSheets";
import { decryptSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await decryptSession(sessionToken) : null;
  if (!session) {
    return NextResponse.json({ error: "Not connected to Google. Please connect your account." }, { status: 401 });
  }

  const sheetInput = request.nextUrl.searchParams.get("sheet");
  const tab = request.nextUrl.searchParams.get("tab");
  if (!sheetInput || !tab) {
    return NextResponse.json({ error: "Missing 'sheet' or 'tab' query parameter." }, { status: 400 });
  }

  try {
    const spreadsheetId = parseSpreadsheetId(sheetInput);
    const result = await fetchSheetValues(session.googleAccessToken, spreadsheetId, tab);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch sheet data." },
      { status: 502 }
    );
  }
}
