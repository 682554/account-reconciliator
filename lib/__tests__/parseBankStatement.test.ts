import { describe, it, expect } from "vitest";
import {
  parsePdfText,
  parseAmountToCents,
  parseDateToIso,
  pdfTableToParsedTable,
  groupTablesByHeader,
  autoDetectColumns,
  normalizeRows,
  detectDateConvention,
  extractEmbeddedReference,
} from "../parseBankStatement";

describe("parsePdfText", () => {
  it("extracts transaction rows from slash-dated lines with trailing amounts", () => {
    const text = [
      "Statement Period: 01/01/2026 - 01/31/2026",
      "Date       Description                Amount",
      "01/05/2026 Office Depot supplies        -100.00",
      "01/08/2026 Payroll deposit              2,500.00",
      "Page 1 of 2",
    ].join("\n");

    const table = parsePdfText(text);
    expect(table.headers).toEqual(["Date", "Amount", "Description"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toMatchObject({ Date: "01/05/2026", Description: "Office Depot supplies" });
    expect(table.rows[1]).toMatchObject({ Date: "01/08/2026", Description: "Payroll deposit" });
  });

  it("extracts rows with ISO-style dates", () => {
    const text = "2026-01-05 Grocery store purchase 45.67";
    const table = parsePdfText(text);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].Date).toBe("2026-01-05");
  });

  it("skips lines with no trailing amount", () => {
    const text = "01/05/2026 This is just a note with no amount";
    const table = parsePdfText(text);
    expect(table.rows).toHaveLength(0);
  });

  it("skips lines with no leading date", () => {
    const text = "Balance forward from previous statement 1,200.00";
    const table = parsePdfText(text);
    expect(table.rows).toHaveLength(0);
  });

  it("returns no rows for a blank/scanned-style document with no matching lines", () => {
    const table = parsePdfText("\n\n   \n");
    expect(table.rows).toHaveLength(0);
  });

  it("uses the transaction amount, not a trailing running balance, when both are present", () => {
    // Matches real-world statement layout: Date | Description | Reference | Amount | Balance
    const text = [
      "06/01/2026 RENT - MERIDIAN OFFICE PARK RENT-JUN2026 (6,500.00) 77,713.47",
      "06/01/2026 WIRE TRANSFER OUT - BLACKSTONE CONTRACTOR GROUP WIRE912 (7,789.16) 69,924.31",
    ].join("\n");

    const table = parsePdfText(text);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].Amount).toBe("(6,500.00)");
    expect(table.rows[0].Description).toBe("RENT - MERIDIAN OFFICE PARK RENT-JUN2026");
    expect(table.rows[1].Amount).toBe("(7,789.16)");
    expect(parseAmountToCents(table.rows[0].Amount)).toBe(-650000);
    expect(parseAmountToCents(table.rows[1].Amount)).toBe(-778916);
  });
});

describe("pdfTableToParsedTable", () => {
  it("picks the real Amount column by header, ignoring a trailing Balance column", () => {
    const grid = [
      ["Date", "Description", "Reference", "Amount", "Balance"],
      ["06/01/2026", "RENT - MERIDIAN OFFICE PARK", "RENT-JUN2026", "(6,500.00)", "77,713.47"],
      ["06/01/2026", "WIRE TRANSFER OUT - BLACKSTONE CONTRACTOR GROUP", "WIRE912", "(7,789.16)", "69,924.31"],
    ];

    const table = pdfTableToParsedTable(grid);
    expect(table).not.toBeNull();
    expect(table!.headers).toEqual(["Date", "Description", "Reference", "Amount", "Balance"]);
    expect(table!.rows[0].Amount).toBe("(6,500.00)");
    expect(table!.rows[0].Balance).toBe("77,713.47");
    expect(table!.rows[1].Amount).toBe("(7,789.16)");
  });

  it("returns null when there's no data row beyond the header", () => {
    expect(pdfTableToParsedTable([["Date", "Amount"]])).toBeNull();
  });

  it("fills in a placeholder name for blank header cells", () => {
    const grid = [
      ["Date", "", "Amount"],
      ["06/01/2026", "note", "100.00"],
    ];
    const table = pdfTableToParsedTable(grid);
    expect(table!.headers).toEqual(["Date", "Column 2", "Amount"]);
  });
});

describe("groupTablesByHeader", () => {
  it("merges per-page grids that share an identical header row, in page order", () => {
    const page1 = [
      ["Date", "Description", "Amount"],
      ["06/01/2026", "Rent", "-6500.00"],
      ["06/02/2026", "Payroll", "2500.00"],
    ];
    const page2 = [
      ["Date", "Description", "Amount"],
      ["06/03/2026", "Comcast", "-245.00"],
    ];

    const merged = groupTablesByHeader([page1, page2]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toHaveLength(4); // 1 header row + 3 data rows total
    expect(merged[0][3]).toEqual(["06/03/2026", "Comcast", "-245.00"]);
  });

  it("keeps grids with different headers as separate groups (e.g. a summary table)", () => {
    const transactions = [
      ["Date", "Description", "Amount"],
      ["06/01/2026", "Rent", "-6500.00"],
    ];
    const summary = [
      ["Total Debits", "Total Credits"],
      ["6500.00", "2500.00"],
    ];

    const merged = groupTablesByHeader([transactions, summary]);
    expect(merged).toHaveLength(2);
  });

  it("is not fooled by header case/whitespace differences across pages", () => {
    const page1 = [
      ["Date", "Amount"],
      ["06/01/2026", "-100.00"],
    ];
    const page2 = [
      [" date ", " AMOUNT "],
      ["06/02/2026", "-50.00"],
    ];

    const merged = groupTablesByHeader([page1, page2]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toHaveLength(3);
  });
});

describe("autoDetectColumns — split debit/credit layouts", () => {
  it("detects a Withdrawal/Deposit split layout instead of forcing a single amount column", () => {
    const mapping = autoDetectColumns(["Date", "Narration", "Withdrawal", "Deposit", "Balance"]);
    expect(mapping.debitColumn).toBe("Withdrawal");
    expect(mapping.creditColumn).toBe("Deposit");
    expect(mapping.amount).toBeUndefined();
    expect(mapping.description).toBe("Narration");
  });

  it("still detects a single Amount column when the statement isn't split", () => {
    const mapping = autoDetectColumns(["Date", "Amount", "Description"]);
    expect(mapping.amount).toBe("Amount");
    expect(mapping.debitColumn).toBeUndefined();
    expect(mapping.creditColumn).toBeUndefined();
  });

  it("falls back to single-column detection when only one of debit/credit is confidently found", () => {
    const mapping = autoDetectColumns(["Date", "Amount", "Description", "Some Unrelated Debit Note"]);
    expect(mapping.amount).toBe("Amount");
  });
});

describe("normalizeRows — split debit/credit layouts", () => {
  const mapping = {
    date: "Date",
    description: "Narration",
    debitColumn: "Withdrawal",
    creditColumn: "Deposit",
  };

  it("turns a populated Withdrawal cell into a negative amount", () => {
    const table = {
      headers: ["Date", "Narration", "Withdrawal", "Deposit"],
      rows: [{ Date: "2026-06-01", Narration: "Rent", Withdrawal: "6500.00", Deposit: "" }],
    };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.amountCents).toBe(-650000);
  });

  it("turns a populated Deposit cell into a positive amount", () => {
    const table = {
      headers: ["Date", "Narration", "Withdrawal", "Deposit"],
      rows: [{ Date: "2026-06-01", Narration: "Client payment", Withdrawal: "", Deposit: "2500.00" }],
    };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.amountCents).toBe(250000);
  });

  it("treats a Withdrawal value as negative even if the source text has no minus sign", () => {
    const table = {
      headers: ["Date", "Narration", "Withdrawal", "Deposit"],
      rows: [{ Date: "2026-06-01", Narration: "ATM", Withdrawal: "100.00", Deposit: "" }],
    };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.amountCents).toBeLessThan(0);
  });
});

describe("extractEmbeddedReference", () => {
  it("extracts a labeled UTR", () => {
    expect(extractEmbeddedReference("NEFT payment UTR: HDFC0123456789 received")).toBe("HDFC0123456789");
  });

  it("extracts a labeled Ref No", () => {
    expect(extractEmbeddedReference("Vendor payment Ref No ABC123456 processed")).toBe("ABC123456");
  });

  it("extracts a reference embedded after a payment-rail prefix", () => {
    expect(extractEmbeddedReference("NEFT-CITIN52024010112345678-JOHN DOE")).toBe("CITIN52024010112345678");
  });

  it("falls back to a bare long numeric run when nothing is labeled", () => {
    expect(extractEmbeddedReference("Transfer 40012345678901 to savings")).toBe("40012345678901");
  });

  it("returns undefined for narration with nothing extractable", () => {
    expect(extractEmbeddedReference("Office Depot supplies purchase")).toBeUndefined();
  });
});

describe("normalizeRows — reference backfill from narration", () => {
  it("backfills .reference from an embedded UTR when there's no reference column at all", () => {
    const table = {
      headers: ["Date", "Narration", "Amount"],
      rows: [{ Date: "2026-06-01", Narration: "NEFT payment UTR: HDFC0123456789 received", Amount: "100.00" }],
    };
    const mapping = { date: "Date", description: "Narration", amount: "Amount" };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.reference).toBe("HDFC0123456789");
  });

  it("prefers a real reference column value over anything extractable from narration", () => {
    const table = {
      headers: ["Date", "Narration", "Reference", "Amount"],
      rows: [
        {
          Date: "2026-06-01",
          Narration: "NEFT payment UTR: HDFC0123456789 received",
          Reference: "REAL-REF-001",
          Amount: "100.00",
        },
      ],
    };
    const mapping = { date: "Date", description: "Narration", reference: "Reference", amount: "Amount" };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.reference).toBe("REAL-REF-001");
  });

  it("backfills from narration when a mapped reference column is blank for that row", () => {
    const table = {
      headers: ["Date", "Narration", "Reference", "Amount"],
      rows: [
        { Date: "2026-06-01", Narration: "NEFT payment UTR: HDFC0123456789 received", Reference: "", Amount: "100.00" },
      ],
    };
    const mapping = { date: "Date", description: "Narration", reference: "Reference", amount: "Amount" };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.reference).toBe("HDFC0123456789");
  });

  it("leaves .reference undefined when nothing is extractable anywhere, so the description-similarity fallback stays available", () => {
    const table = {
      headers: ["Date", "Narration", "Amount"],
      rows: [{ Date: "2026-06-01", Narration: "Office Depot supplies purchase", Amount: "100.00" }],
    };
    const mapping = { date: "Date", description: "Narration", amount: "Amount" };
    const [entry] = normalizeRows(table, mapping, "bank");
    expect(entry.reference).toBeUndefined();
  });
});

describe("parseAmountToCents (PDF-extracted amount strings)", () => {
  it("parses negative amounts from a leading minus sign", () => {
    expect(parseAmountToCents("-100.00")).toBe(-10000);
  });

  it("parses amounts with thousands separators", () => {
    expect(parseAmountToCents("2,500.00")).toBe(250000);
  });
});

describe("parseDateToIso (PDF-extracted date strings)", () => {
  it("normalizes slash dates as month-first by default", () => {
    expect(parseDateToIso("01/05/2026")).toBe("2026-01-05");
  });

  it("passes through ISO dates", () => {
    expect(parseDateToIso("2026-01-05")).toBe("2026-01-05");
  });

  it("normalizes hyphenated dates as day-first when told to", () => {
    expect(parseDateToIso("17-03-2026", "day-first")).toBe("2026-03-17");
  });

  it("normalizes an ambiguous hyphenated date (day <= 12) according to the given convention, not a guess", () => {
    expect(parseDateToIso("03-05-2026", "day-first")).toBe("2026-05-03"); // 3 May
    expect(parseDateToIso("03-05-2026", "month-first")).toBe("2026-03-05"); // March 5
  });
});

describe("detectDateConvention", () => {
  it("detects day-first when any date's first token exceeds 12", () => {
    const dates = ["03-05-2026", "17-03-2026", "02-01-2026"]; // "17" can only be a day
    expect(detectDateConvention(dates)).toBe("day-first");
  });

  it("finds the disambiguating date anywhere in the column, not just the first row", () => {
    const dates = ["03-05-2026", "02-01-2026", "25-12-2026"]; // disambiguator is the LAST entry
    expect(detectDateConvention(dates)).toBe("day-first");
  });

  it("defaults to month-first when nothing in the column disambiguates it", () => {
    const dates = ["03-05-2026", "01-02-2026", "12-11-2026"]; // every token is <= 12
    expect(detectDateConvention(dates)).toBe("month-first");
  });

  it("applies the whole-column convention uniformly via normalizeRows, fixing the day<=12 misread", () => {
    const table = {
      headers: ["Date", "Amount", "Description"],
      // "17-03-2026" forces day-first for the whole column; "03-05-2026" is ambiguous alone
      // and would previously have been silently misread as March 5th (month-first).
      rows: [
        { Date: "17-03-2026", Amount: "100.00", Description: "A" },
        { Date: "03-05-2026", Amount: "50.00", Description: "B" },
      ],
    };
    const mapping = { date: "Date", amount: "Amount", description: "Description" };
    const entries = normalizeRows(table, mapping, "bank");

    expect(entries[0].date).toBe("2026-03-17");
    expect(entries[1].date).toBe("2026-05-03"); // 3 May, not March 5th
  });
});
