import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { NormalizedEntry } from "./matchEngine";

export type ParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export type ColumnMapping = {
  date: string;
  description: string;
  /** Optional check/reference/confirmation number — disambiguates same-amount, same-day transactions. */
  reference?: string;
  /** Single signed amount column. Mutually exclusive with debitColumn/creditColumn — pick one mode. */
  amount?: string;
  /** Split-column layout: money going out (e.g. "Withdrawal"/"Debit"). Combines with creditColumn. */
  debitColumn?: string;
  /** Split-column layout: money coming in (e.g. "Deposit"/"Credit"). Combines with debitColumn. */
  creditColumn?: string;
};

const DATE_HEADER_HINTS = ["date", "posted", "transaction date", "posting date"];
const AMOUNT_HEADER_HINTS = ["amount", "value", "debit", "credit", "total"];
const DESCRIPTION_HEADER_HINTS = ["description", "memo", "narrative", "narration", "details", "payee", "notes"];
const DEBIT_HEADER_HINTS = ["withdrawal", "debit", "money out", "paid out", "amount debited", "outflow"];
const CREDIT_HEADER_HINTS = ["deposit", "credit", "money in", "paid in", "amount credited", "inflow"];
const REFERENCE_HEADER_HINTS = [
  "reference",
  "ref",
  "ref no",
  "reference number",
  "check number",
  "check no",
  "confirmation",
  "confirmation number",
  "transaction id",
  "transaction number",
];

function scoreHeader(header: string, hints: string[]): number {
  const h = header.toLowerCase().trim();
  if (hints.includes(h)) return 2;
  return hints.some((hint) => h.includes(hint)) ? 1 : 0;
}

/** Best-effort auto-detection; returns null for a field it can't confidently guess. */
export function autoDetectColumns(headers: string[]): Partial<ColumnMapping> {
  const pick = (hints: string[]) => {
    let best: { header: string; score: number } | null = null;
    for (const header of headers) {
      const score = scoreHeader(header, hints);
      if (score > 0 && (!best || score > best.score)) {
        best = { header, score };
      }
    }
    return best?.header;
  };

  const mapping: Partial<ColumnMapping> = {};
  const date = pick(DATE_HEADER_HINTS);
  const description = pick(DESCRIPTION_HEADER_HINTS);
  const reference = pick(REFERENCE_HEADER_HINTS);
  if (date) mapping.date = date;
  if (description) mapping.description = description;
  if (reference) mapping.reference = reference;

  // Prefer a split debit/credit layout only when BOTH sides are confidently found — e.g. a
  // statement with "Withdrawal" and "Deposit" columns instead of one signed "Amount" column.
  // Finding just one of the two isn't enough evidence to abandon single-column detection.
  const debitColumn = pick(DEBIT_HEADER_HINTS);
  const creditColumn = pick(CREDIT_HEADER_HINTS);
  if (debitColumn && creditColumn && debitColumn !== creditColumn) {
    mapping.debitColumn = debitColumn;
    mapping.creditColumn = creditColumn;
  } else {
    const amount = pick(AMOUNT_HEADER_HINTS);
    if (amount) {
      mapping.amount = amount;
    } else if (debitColumn) {
      mapping.debitColumn = debitColumn;
    } else if (creditColumn) {
      mapping.creditColumn = creditColumn;
    }
  }

  return mapping;
}

export function parseCsv(fileContents: string): ParsedTable {
  const result = Papa.parse<Record<string, string>>(fileContents, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

/**
 * Converts a grid extracted by pdf-parse's getTable() (real detected table cells, keyed by
 * position, not inferred from text position) into the same ParsedTable shape CSV/XLSX use —
 * so the same header-based column auto-detection can pick out the real "Amount" column
 * instead of a trailing "Balance" column.
 */
export function pdfTableToParsedTable(tableRows: string[][]): ParsedTable | null {
  if (tableRows.length < 2) return null;

  const headers = tableRows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = tableRows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = (row[i] ?? "").trim();
    });
    return record;
  });

  return { headers, rows };
}

/**
 * pdf-parse's getTable() detects one grid per page, even when a statement's transaction
 * table simply continues across pages with the header row repeated on each — it does not
 * assume those are "the same table." This merges grids that share an identical header row
 * (trimmed, case-insensitive) into one, concatenating their data rows in page order, so a
 * multi-page statement doesn't silently truncate to whatever fit on the first page.
 */
export function groupTablesByHeader(grids: string[][][]): string[][][] {
  const groups = new Map<string, string[][]>();

  for (const grid of grids) {
    if (grid.length === 0) continue;
    const headerKey = grid[0].map((h) => h.trim().toLowerCase()).join("|");
    if (!headerKey) continue;

    const existing = groups.get(headerKey);
    if (existing) {
      existing.push(...grid.slice(1));
    } else {
      groups.set(headerKey, [grid[0], ...grid.slice(1)]);
    }
  }

  return [...groups.values()];
}

export function parseXlsx(buffer: ArrayBuffer): ParsedTable {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

const PDF_LEADING_DATE = new RegExp(
  "^\\s*(" +
    "\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}" + // 01/05/2026
    "|\\d{4}-\\d{2}-\\d{2}" + // 2026-01-05
    "|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4}" + // January 5, 2026
    "|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{2,4}" + // 5 January 2026
    ")\\b"
);
const PDF_MONEY_TOKEN = /[-+]?\(?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?/g;

/**
 * Best-effort line-based extraction of transactions from text-layer PDF content
 * (i.e. a real digital bank statement export, not a scanned image — that would need OCR).
 * A line counts as a transaction row only if it starts with a recognizable date and has
 * at least one currency-looking amount after that; everything in between becomes the
 * description. This intentionally drops headers, footers, and lines that don't fit that shape.
 *
 * Many statements print a running balance after the transaction amount (Date, Description,
 * Amount, Balance). When a line has two or more money tokens, the second-to-last is treated
 * as the transaction amount and the last as the balance — the actual amount is never the
 * last number on such a line.
 */
export function parsePdfText(text: string): ParsedTable {
  const rows: Record<string, string>[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const dateMatch = PDF_LEADING_DATE.exec(line);
    if (!dateMatch) continue;
    const afterDateIndex = dateMatch.index + dateMatch[0].length;

    const moneyMatches = [...line.matchAll(PDF_MONEY_TOKEN)].filter((m) => m.index >= afterDateIndex);
    if (moneyMatches.length === 0) continue;

    const amountMatch =
      moneyMatches.length >= 2 ? moneyMatches[moneyMatches.length - 2] : moneyMatches[0];

    rows.push({
      Date: dateMatch[1],
      Amount: amountMatch[0].trim(),
      Description: line.slice(afterDateIndex, amountMatch.index).trim(),
    });
  }

  return { headers: ["Date", "Amount", "Description"], rows };
}

/** Parses a decimal-string amount (handles "$1,234.56", "(12.00)" negatives, etc.) into integer cents. */
export function parseAmountToCents(raw: string): number {
  const trimmed = raw.trim();
  const isNegative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const cleaned = trimmed.replace(/[()$,\s-]/g, "");
  if (!cleaned) return 0;
  const value = parseFloat(cleaned);
  const cents = Math.round(value * 100);
  return isNegative ? -Math.abs(cents) : cents;
}

export type DateConvention = "day-first" | "month-first";

/** Matches DD-MM-YYYY / MM-DD-YYYY / DD/MM/YYYY / MM/DD/YYYY style — separator-agnostic, 2-2-4-or-2 digit groups. */
const AMBIGUOUS_NUMERIC_DATE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/;

/**
 * Scans every raw date string in a column ONCE to determine whether it's day-first or
 * month-first, so that convention can be applied uniformly to every row. Deciding this
 * per-row is the bug: a date like "17-03-2026" can only be day-first (no month is >12), but
 * "03-12-2026" is ambiguous on its own and would silently get misread as month-first even in
 * a file that's actually day-first throughout. Finding just one disambiguating date anywhere
 * in the column settles it for the whole column.
 */
export function detectDateConvention(rawDates: string[]): DateConvention {
  for (const raw of rawDates) {
    const match = AMBIGUOUS_NUMERIC_DATE.exec(raw.trim());
    if (!match) continue;
    if (parseInt(match[1], 10) > 12) return "day-first";
  }
  return "month-first";
}

/** Normalizes a variety of common date string formats to YYYY-MM-DD, per the given day/month convention. */
export function parseDateToIso(raw: string, convention: DateConvention = "month-first"): string {
  const trimmed = raw.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const numericMatch = AMBIGUOUS_NUMERIC_DATE.exec(trimmed);
  if (numericMatch) {
    const [, first, second, rawYear] = numericMatch;
    const y = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const [month, day] = convention === "day-first" ? [second, first] : [first, second];
    return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return trimmed;
}

// Explicit label wins first, e.g. "UTR: 123456789012", "RRN 987654321012", "Ref No ABC123456".
const LABELED_REFERENCE = /\b(?:UTR|RRN|Ref(?:erence)?(?:\s?No\.?)?|Txn\s?ID|Transaction\s?ID)[:\s#-]+([A-Za-z0-9]{6,})/i;
// Common payment-rail prefixes embed the reference right after them, e.g. "NEFT-CITIN52024...".
const PAYMENT_RAIL_REFERENCE = /\b(?:NEFT|RTGS|IMPS|UPI|ACH)[\s/-]+([A-Za-z0-9]{6,})/i;
// Last resort: a long numeric run is very unlikely to be anything other than a transaction ID.
const LONG_NUMERIC_REFERENCE = /\b(\d{11,})\b/;

/**
 * Best-effort extraction of a transaction reference (e.g. a UTR) embedded in narration text,
 * for statements with no dedicated reference column at all. Tried in descending order of
 * confidence; returns undefined when nothing recognizable is found, which is the correct
 * signal for the matching engine's description-similarity fallback tier to take over instead.
 */
export function extractEmbeddedReference(description: string): string | undefined {
  return (
    LABELED_REFERENCE.exec(description)?.[1] ??
    PAYMENT_RAIL_REFERENCE.exec(description)?.[1] ??
    LONG_NUMERIC_REFERENCE.exec(description)?.[1] ??
    undefined
  );
}

function resolveAmountCents(row: Record<string, string>, mapping: ColumnMapping): number {
  if (mapping.amount) {
    return parseAmountToCents(row[mapping.amount] ?? "0");
  }
  // Split debit/credit layout: each row normally populates only one of the two columns.
  // A debit/withdrawal column holds a positive magnitude for money leaving the account
  // regardless of whether the source text itself carries a minus sign, so it's forced
  // negative here rather than trusting parseAmountToCents' sign detection on that column.
  const debit = mapping.debitColumn ? Math.abs(parseAmountToCents(row[mapping.debitColumn] ?? "0")) : 0;
  const credit = mapping.creditColumn ? Math.abs(parseAmountToCents(row[mapping.creditColumn] ?? "0")) : 0;
  return credit - debit;
}

export function normalizeRows(
  table: ParsedTable,
  mapping: ColumnMapping,
  idPrefix: string
): NormalizedEntry[] {
  const dateConvention = detectDateConvention(table.rows.map((row) => row[mapping.date] ?? ""));

  return table.rows.map((row, index) => {
    const description = (row[mapping.description] ?? "").replace(/\s+/g, " ").trim();
    const columnReference = mapping.reference ? (row[mapping.reference] ?? "").trim() : "";
    // Backfill from the narration only when the mapped reference column (if any) came up empty
    // for this row — a real column value always wins. This is the single point where every
    // downstream consumer's .reference comes from, so the main matcher and discrepancy-pairing
    // can't drift out of sync on what counts as "the reference."
    const reference = columnReference || extractEmbeddedReference(description);
    return {
      id: `${idPrefix}-${index}`,
      date: parseDateToIso(row[mapping.date] ?? "", dateConvention),
      amountCents: resolveAmountCents(row, mapping),
      description,
      reference: reference || undefined,
      raw: row,
    };
  });
}
