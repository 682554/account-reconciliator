const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "online",
    prompt: "consent",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenResponse> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getEnv("GOOGLE_CLIENT_ID"),
      client_secret: getEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${body}`);
  }
  return response.json();
}

/** Extracts the spreadsheet ID from either a raw ID or a full Google Sheets URL. */
export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}

export type SheetValuesResult = {
  headers: string[];
  rows: Record<string, string>[];
};

export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<SheetValuesResult> {
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Sheets API request failed: ${response.status} ${body}`);
  }
  const data = (await response.json()) as { values?: string[][] };
  const values = data.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = values;
  const rows = dataRows.map((row) => {
    const record: Record<string, string> = {};
    headerRow.forEach((header, i) => {
      record[header] = row[i] ?? "";
    });
    return record;
  });
  return { headers: headerRow, rows };
}

export async function listSheetTabs(accessToken: string, spreadsheetId: string): Promise<string[]> {
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Sheets API request failed: ${response.status} ${body}`);
  }
  const data = (await response.json()) as { sheets?: { properties: { title: string } }[] };
  return (data.sheets ?? []).map((s) => s.properties.title);
}
