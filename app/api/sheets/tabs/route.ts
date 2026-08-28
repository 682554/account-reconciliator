import { NextRequest, NextResponse } from "next/server";
import { listSheetTabs, parseSpreadsheetId } from "@/lib/googleSheets";
import { decryptSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await decryptSession(sessionToken) : null;
  if (!session) {
    return NextResponse.json({ error: "Not connected to Google. Please connect your account." }, { status: 401 });
  }

  const sheetInput = request.nextUrl.searchParams.get("sheet");
  if (!sheetInput) {
    return NextResponse.json({ error: "Missing 'sheet' query parameter." }, { status: 400 });
  }

  try {
    const spreadsheetId = parseSpreadsheetId(sheetInput);
    const tabs = await listSheetTabs(session.googleAccessToken, spreadsheetId);
    return NextResponse.json({ tabs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list sheet tabs." },
      { status: 502 }
    );
  }
}
