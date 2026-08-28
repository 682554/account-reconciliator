# Account Reconciliator

Compares logged transactions from a Google Sheet against an uploaded bank statement (CSV/XLSX), flags discrepancies, and produces an Excel report + PDF summary for human review.

No database, no user accounts. Google OAuth is used only to fetch the sheet the user selects for the duration of one session (an encrypted, short-lived cookie holds the access token — nothing is persisted server-side).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Google Cloud OAuth client (**Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID**, type "Web application"):
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback` (add your production URL's equivalent too once deployed)
   - Enable the **Google Sheets API** for the project

3. Copy `.env.example` to `.env.local` and fill in:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   SESSION_SECRET=<32+ random chars, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`>
   ```

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## How it works

1. **Connect Google Sheet** — OAuth flow grants read-only access to Sheets; user pastes a sheet URL/ID and picks a tab.
2. **Upload bank statement** — CSV or XLSX, parsed client-side.
3. **Column mapping** — date/amount/description columns are auto-detected on both sources (editable if detection is wrong).
4. **Reconcile** — `lib/matchEngine.ts` matches entries on exact amount + date (with a few days' slack) + fuzzy description similarity, using a greedy one-to-one assignment so no entry is double-matched. Anything that doesn't confidently match is flagged as missing-from-bank, not-logged, or a possible duplicate.
5. **Review & export** — summary stats and a discrepancy table on-screen, plus downloadable Excel (multi-tab: Summary/Matched/Discrepancies) and one-page PDF summary reports.

## Testing

```bash
npm test        # unit tests for the matching engine (lib/__tests__/matchEngine.test.ts)
npm run build   # production build + typecheck
npm run lint    # eslint
```

The matching engine, parsers, and report generators are all pure functions with no I/O, so they're fully testable without Google credentials. Google OAuth itself can only be exercised end-to-end once you've set up a Google Cloud OAuth client (step 2 above).

## Onboarding a new customer (while the OAuth consent screen is in "Testing")

The Google Cloud OAuth consent screen is currently in **Testing** mode, which caps access to accounts you've explicitly whitelisted (up to 100). Before a new customer can click "Connect Google Sheet" and get through Google's consent screen, add their Google account:

**Google Cloud Console → APIs & Services → OAuth consent screen → Audience → Test users → Add users** — enter their email, save. They can connect immediately afterward.

This avoids Google's app verification review (privacy policy, demo video, days-to-weeks turnaround) for now, at the cost of manually whitelisting each customer. Once past ~100 customers, or ready for a fully public signup flow, the consent screen needs to move to "In production" (see below).

## Notes for productizing further

- Currently single-session / no accounts, per the initial build scope. Adding persistent accounts, saved reconciliation history, or billing would need a database — none of the current code assumes one, so it's a clean addition later.
- `xlsx` is installed from SheetJS's own CDN tarball (`https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz`), not the npm registry — the registry version has an unpatched high-severity prototype-pollution/ReDoS advisory with no fix available. Re-run `npm install https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` periodically to stay on the latest patched release.
- **Before a public launch:** the current Google OAuth client is a "Desktop app" type, which only works locally via Google's loopback exception. A real deployment needs a separate **Web application**-type OAuth client with your production domain's callback URL registered, and the consent screen moved from "Testing" to "In production" (requires Google's verification review for the `spreadsheets.readonly` sensitive scope — see the onboarding section above for the interim test-user workaround).
