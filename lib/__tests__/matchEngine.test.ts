import { describe, it, expect } from "vitest";
import { reconcile, descriptionSimilarity, type NormalizedEntry } from "../matchEngine";
import { normalizeRows } from "../parseBankStatement";

function entry(
  id: string,
  date: string,
  amountCents: number,
  description: string,
  reference?: string
): NormalizedEntry {
  return { id, date, amountCents, description, reference, raw: {} };
}

describe("descriptionSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(descriptionSimilarity("Amazon Purchase", "Amazon Purchase")).toBe(1);
  });

  it("returns a high score for overlapping real-world variants", () => {
    const sim = descriptionSimilarity("Amazon purchase - office supplies", "AMZN MKTP US*AMAZON PURCHASE");
    expect(sim).toBeGreaterThan(0.3);
  });

  it("returns 0 for completely unrelated strings", () => {
    expect(descriptionSimilarity("Amazon Purchase", "Zzz Qqq Xxx")).toBeLessThan(0.2);
  });

  it("returns 0 for empty input", () => {
    expect(descriptionSimilarity("", "Amazon")).toBe(0);
  });
});

describe("reconcile — 1:1 matching", () => {
  it("matches identical date, amount, and description", () => {
    const log = [entry("l1", "2026-01-05", 10000, "Office Depot supplies")];
    const bank = [entry("b1", "2026-01-05", 10000, "Office Depot supplies")];
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(1);
    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.notLoggedCount).toBe(0);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "exact" });
  });

  it("matches within date slack and flags the reason", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Netflix subscription")];
    const bank = [entry("b1", "2026-01-07", 5000, "Netflix subscription")];
    const result = reconcile(log, bank, { dateSlackDays: 3 });

    expect(result.summary.matchedPairCount).toBe(1);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "date_mismatch" });
  });

  it("flags a logged entry with no matching bank amount as missing from bank", () => {
    const log = [entry("l1", "2026-01-05", 7500, "Consulting fee")];
    const bank: NormalizedEntry[] = [];
    const result = reconcile(log, bank);

    expect(result.summary.missingFromBankCount).toBe(1);
    expect(result.items[0].type).toBe("missing_from_bank");
  });

  it("flags a bank entry with no matching log entry as not logged", () => {
    const log: NormalizedEntry[] = [];
    const bank = [entry("b1", "2026-01-05", 12000, "Unknown wire transfer")];
    const result = reconcile(log, bank);

    expect(result.summary.notLoggedCount).toBe(1);
    expect(result.items[0].type).toBe("not_logged");
  });

  it("never silently matches a differing amount as a clean match (typos, sign-flips, rounding drift never share an exact amount key)", () => {
    const log = [entry("l1", "2026-01-05", 9900, "Grocery store")];
    const bank = [entry("b1", "2026-01-05", 9901, "Grocery store")]; // 1-cent rounding drift
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(0);
    expect(result.summary.splitMatchGroupCount).toBe(0);
    // same date + identical description is exactly what the discrepancy-pairing tier exists to
    // catch — it's flagged as a probable-same-transaction mismatch, not left as two disconnected
    // one-sided entries.
    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);
    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.notLoggedCount).toBe(0);
  });

  it("flags mismatched description/date far beyond slack as missing from bank rather than a false match", () => {
    const log = [entry("l1", "2026-01-05", 9900, "Grocery store")];
    const bank = [entry("b1", "2026-02-20", 9900, "Zzz unrelated vendor")];
    const result = reconcile(log, bank, { dateSlackDays: 3 });

    expect(result.summary.matchedPairCount).toBe(0);
    expect(result.summary.missingFromBankCount).toBe(1);
  });

  it("flags possible duplicates when multiple bank entries share an amount with no confident match", () => {
    const log = [entry("l1", "2026-01-05", 2000, "Cash withdrawal")];
    const bank = [
      entry("b1", "2026-03-01", 2000, "Zzz unrelated one"),
      entry("b2", "2026-03-15", 2000, "Zzz unrelated two"),
    ];
    const result = reconcile(log, bank, { dateSlackDays: 3 });

    expect(result.items[0].type).toBe("possible_duplicate");
    expect(result.summary.possibleDuplicateCount).toBe(1);
  });

  it("never double-assigns the same bank entry to two log entries — flags the collision instead of silently picking one", () => {
    const log = [
      entry("l1", "2026-01-05", 3000, "Rent"),
      entry("l2", "2026-01-05", 3000, "Rent"),
    ];
    const bank = [entry("b1", "2026-01-05", 3000, "Rent")];
    const result = reconcile(log, bank);

    const matchedCount = result.items.filter((i) => i.type === "matched").length;
    expect(matchedCount).toBe(0);
    expect(result.summary.possibleDuplicateCount).toBe(1);
    const dup = result.items.find((i) => i.type === "possible_duplicate");
    expect(dup).toMatchObject({ ambiguousSide: "log" });
    if (dup?.type === "possible_duplicate") {
      expect(dup.candidates).toHaveLength(2);
      expect(dup.counterpart?.id).toBe("b1");
    }
  });
});

describe("reconcile — reference number matching", () => {
  it("uses a matching reference number to confirm a match even with weak description similarity", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Vendor Payment - See Backup", "WIRE912")];
    const bank = [entry("b1", "2026-01-05", 5000, "WIRE TRANSFER OUT - BLACKSTONE CONTRACTOR GROUP", "WIRE912")];
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(1);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "reference_match" });
  });

  it("picks the candidate with the matching reference over one with better description similarity", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Rent payment", "REF-A")];
    const bank = [
      entry("b1", "2026-01-05", 5000, "Rent payment", "REF-B"), // better description match, wrong reference
      entry("b2", "2026-01-05", 5000, "Unrelated text", "REF-A"), // matching reference, weak description
    ];
    const result = reconcile(log, bank);

    expect(result.items[0]).toMatchObject({ type: "matched", reason: "reference_match" });
    if (result.items[0].type === "matched") {
      expect(result.items[0].bankEntry.id).toBe("b2");
    }
  });

  it("flags a reference+amount match as matched_date_gap when dates differ beyond the business-day tolerance", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Consulting retainer", "INV-4471")];
    const bank = [entry("b1", "2026-01-26", 5000, "Consulting retainer", "INV-4471")]; // ~3 weeks later
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(1);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "matched_date_gap" });
  });

  it("still uses reference_match (not the date-gap flag) within the business-day tolerance", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Consulting retainer", "INV-4471")];
    const bank = [entry("b1", "2026-01-08", 5000, "Consulting retainer", "INV-4471")]; // a few days later
    const result = reconcile(log, bank);

    expect(result.items[0]).toMatchObject({ type: "matched", reason: "reference_match" });
  });

  it("falls back to date+amount matching when one side has no reference value at all", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Rent payment")];
    const bank = [entry("b1", "2026-01-05", 5000, "Rent payment", "REF-B")];
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(1);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "exact" });
  });

  it("still matches on exact date+amount even when references explicitly conflict — not every ledger carries the bank's reference", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Rent payment", "REF-A")];
    const bank = [entry("b1", "2026-01-05", 5000, "Rent payment", "REF-B")];
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(1);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "exact" });
  });

  it("matches several blank-reference, identical date+amount pairs without requiring description similarity", () => {
    const log = [
      entry("l1", "2026-01-05", 5000, "Vendor A"),
      entry("l2", "2026-01-06", 6000, "Vendor B"),
      entry("l3", "2026-01-07", 7000, "Vendor C"),
    ];
    const bank = [
      entry("b1", "2026-01-05", 5000, "Completely different text one"),
      entry("b2", "2026-01-06", 6000, "Completely different text two"),
      entry("b3", "2026-01-07", 7000, "Completely different text three"),
    ];
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(3);
    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.notLoggedCount).toBe(0);
  });
});

describe("reconcile — duplicate collision detection", () => {
  it("lets the correctly-referenced ledger duplicate win regardless of array order, orphaning the actual duplicate instead", () => {
    // The no-reference duplicate is listed FIRST — under the old array-order-greedy matching,
    // it would have stolen the date+amount fallback match before the correctly-referenced
    // original ever got evaluated.
    const log = [
      entry("l1", "2026-01-05", 5000, "Vendor Payment - See Backup"), // duplicate, no reference
      entry("l2", "2026-01-05", 5000, "Wire to Blackstone Contractor", "WIRE912"), // the real one
    ];
    const bank = [entry("b1", "2026-01-05", 5000, "WIRE TRANSFER OUT", "WIRE912")];
    const result = reconcile(log, bank);

    const matched = result.items.find((i) => i.type === "matched");
    expect(matched).toMatchObject({ type: "matched", reason: "reference_match" });
    if (matched?.type === "matched") {
      expect(matched.logEntry.id).toBe("l2");
    }

    // the orphan lost a same-date+amount collision to its sibling, so it's a flagged
    // duplicate for review, not a bare "missing" that implies an unrelated absence.
    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.possibleDuplicateCount).toBe(1);
    const dup = result.items.find((i) => i.type === "possible_duplicate");
    if (dup?.type === "possible_duplicate") {
      expect(dup.candidates[0].id).toBe("l1");
    }
  });

  it("flags a bank-side collision (2 bank lines vs 1 ledger line, no reference) as possible_duplicate", () => {
    const log = [entry("l1", "2026-01-05", 4000, "Office supplies")];
    const bank = [
      entry("b1", "2026-01-05", 4000, "Office supplies"),
      entry("b2", "2026-01-05", 4000, "Office supplies"), // accidental double-charge on the bank side
    ];
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(0);
    expect(result.summary.possibleDuplicateCount).toBe(1);
    const dup = result.items.find((i) => i.type === "possible_duplicate");
    expect(dup).toMatchObject({ ambiguousSide: "bank" });
    if (dup?.type === "possible_duplicate") {
      expect(dup.candidates).toHaveLength(2);
      expect(dup.counterpart?.id).toBe("l1");
    }
  });

  it("counts possible-duplicate candidates toward the unmatched exposure totals", () => {
    const log = [
      entry("l1", "2026-01-05", 3000, "Rent"),
      entry("l2", "2026-01-05", 3000, "Rent"),
    ];
    const bank = [entry("b1", "2026-01-05", 3000, "Rent")];
    const result = reconcile(log, bank);

    // both ambiguous logged candidates' amounts should be reflected as real exposure,
    // not silently dropped just because one of them happens to be a genuine duplicate.
    expect(result.summary.unmatchedLoggedAbsTotalCents).toBe(6000);
  });

  it("labels an orphaned ledger duplicate as possible_duplicate, not missing_from_bank, once its sibling wins the match", () => {
    const log = [
      entry("l1", "2026-01-05", 5000, "Wire to Blackstone Contractor", "WIRE912"), // the real one
      entry("l2", "2026-01-05", 5000, "Wire to Blackstone Contractor (dup)"), // leftover duplicate, no reference
    ];
    const bank = [entry("b1", "2026-01-05", 5000, "WIRE TRANSFER OUT", "WIRE912")];
    const result = reconcile(log, bank);

    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.possibleDuplicateCount).toBe(1);
    const dup = result.items.find((i) => i.type === "possible_duplicate");
    expect(dup).toMatchObject({ ambiguousSide: "log" });
    if (dup?.type === "possible_duplicate") {
      expect(dup.candidates).toHaveLength(1);
      expect(dup.candidates[0].id).toBe("l2");
    }
  });

  it("labels an orphaned bank-side duplicate charge as possible_duplicate, not not_logged, once its sibling wins the match", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Wire to Blackstone Contractor", "WIRE912")];
    const bank = [
      entry("b1", "2026-01-05", 5000, "WIRE TRANSFER OUT", "WIRE912"), // the real one
      entry("b2", "2026-01-05", 5000, "WIRE TRANSFER OUT (duplicate charge)"), // leftover duplicate, no reference
    ];
    const result = reconcile(log, bank);

    expect(result.summary.notLoggedCount).toBe(0);
    expect(result.summary.possibleDuplicateCount).toBe(1);
    const dup = result.items.find((i) => i.type === "possible_duplicate");
    expect(dup).toMatchObject({ ambiguousSide: "bank" });
    if (dup?.type === "possible_duplicate") {
      expect(dup.candidates).toHaveLength(1);
      expect(dup.candidates[0].id).toBe("b2");
    }
  });
});

describe("reconcile — split/batch matching", () => {
  it("matches one bank line to the sum of 3 same-day logged lines (e.g. a payroll batch)", () => {
    const log = [
      entry("l1", "2026-06-15", 20000, "Payroll - Engineering"),
      entry("l2", "2026-06-15", 15000, "Payroll - Sales"),
      entry("l3", "2026-06-15", 10000, "Payroll - Support"),
    ];
    const bank = [entry("b1", "2026-06-15", 45000, "PAYROLL BATCH")];
    const result = reconcile(log, bank);

    expect(result.summary.splitMatchGroupCount).toBe(1);
    expect(result.summary.matchedPairCount).toBe(0);
    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.notLoggedCount).toBe(0);

    const split = result.items.find((i) => i.type === "split_match");
    expect(split).toMatchObject({ type: "split_match", singleSide: "bank" });
    if (split?.type === "split_match") {
      expect(split.groupEntries).toHaveLength(3);
      expect(split.singleEntry.id).toBe("b1");
    }

    // all logged and bank lines involved should be counted as reconciled for rate purposes
    expect(result.summary.matchRateVsLogged).toBe(1);
    expect(result.summary.matchRateVsBank).toBe(1);
  });

  it("matches one logged line to the sum of several same-day bank lines", () => {
    const log = [entry("l1", "2026-06-15", 45000, "Payroll batch (booked as one line)")];
    const bank = [
      entry("b1", "2026-06-15", 20000, "Payroll dept A"),
      entry("b2", "2026-06-15", 15000, "Payroll dept B"),
      entry("b3", "2026-06-15", 10000, "Payroll dept C"),
    ];
    const result = reconcile(log, bank);

    expect(result.summary.splitMatchGroupCount).toBe(1);
    const split = result.items.find((i) => i.type === "split_match");
    expect(split).toMatchObject({ type: "split_match", singleSide: "log" });
  });

  it("does not split-match across different dates", () => {
    const log = [
      entry("l1", "2026-06-15", 20000, "Payroll - Engineering"),
      entry("l2", "2026-06-16", 15000, "Payroll - Sales"), // different day
      entry("l3", "2026-06-15", 10000, "Payroll - Support"),
    ];
    const bank = [entry("b1", "2026-06-15", 45000, "PAYROLL BATCH")];
    const result = reconcile(log, bank);

    expect(result.summary.splitMatchGroupCount).toBe(0);
  });

  it("does not split-match a group larger than 4 lines", () => {
    const log = [
      entry("l1", "2026-06-15", 1000, "A"),
      entry("l2", "2026-06-15", 1000, "B"),
      entry("l3", "2026-06-15", 1000, "C"),
      entry("l4", "2026-06-15", 1000, "D"),
      entry("l5", "2026-06-15", 1000, "E"),
    ];
    const bank = [entry("b1", "2026-06-15", 5000, "FIVE LINE BATCH")];
    const result = reconcile(log, bank);

    expect(result.summary.splitMatchGroupCount).toBe(0);
    expect(result.summary.notLoggedCount).toBe(1);
  });

  it("does not accidentally split-match one-sided (fabricated/dropped) entries that happen to share a date", () => {
    // three unrelated logged-only entries that don't actually sum to anything on the bank side
    const log = [
      entry("l1", "2026-06-15", 1234, "Fabricated A"),
      entry("l2", "2026-06-15", 5678, "Fabricated B"),
    ];
    const bank: NormalizedEntry[] = [];
    const result = reconcile(log, bank);

    expect(result.summary.splitMatchGroupCount).toBe(0);
    expect(result.summary.missingFromBankCount).toBe(2);
  });
});

describe("reconcile — discrepancy pairing (amount mismatches)", () => {
  it("pairs a reference-confirmed amount mismatch as an unresolved discrepancy with the correct delta", () => {
    const log = [entry("l1", "2026-01-05", 15000, "Comcast Business Expense", "VISA34083")];
    const bank = [entry("b1", "2026-01-05", 15900, "COMCAST BUSINESS EXPENSE", "VISA34083")]; // typo: 159.00 vs 150.00
    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBe(0);
    expect(result.summary.missingFromBankCount).toBe(0);
    expect(result.summary.notLoggedCount).toBe(0);
    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);

    const item = result.items.find((i) => i.type === "unresolved_discrepancy");
    expect(item?.type).toBe("unresolved_discrepancy");
    if (item?.type === "unresolved_discrepancy") {
      expect(item.deltaCents).toBe(900); // bank(15900) - ledger(15000)
      expect(item.bankEntry.id).toBe("b1");
      expect(item.logEntry.id).toBe("l1");
    }
  });

  it("pairs a sign-flip via matching reference, even though the delta is large", () => {
    const log = [entry("l1", "2026-01-05", 5000, "Vendor refund", "REF-500")];
    const bank = [entry("b1", "2026-01-05", -5000, "VENDOR REFUND", "REF-500")];
    const result = reconcile(log, bank);

    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);
    const item = result.items.find((i) => i.type === "unresolved_discrepancy");
    if (item?.type === "unresolved_discrepancy") {
      expect(item.deltaCents).toBe(-10000); // -5000 - 5000
    }
  });

  it("pairs an amount mismatch with no reference, via close date + strong description similarity", () => {
    const log = [entry("l1", "2026-01-05", 9900, "Office Depot supplies purchase")];
    const bank = [entry("b1", "2026-01-05", 9800, "Office Depot supplies purchase")];
    const result = reconcile(log, bank);

    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);
  });

  it("refuses to pair an amount mismatch when there's no reference and description similarity is weak", () => {
    const log = [entry("l1", "2026-01-05", 9900, "Office Depot supplies")];
    const bank = [entry("b1", "2026-01-05", 9800, "Cascade Retail Group - Invoice Payment")];
    const result = reconcile(log, bank);

    // low-confidence coincidence — must NOT be silently paired as "probably the same transaction"
    expect(result.summary.unresolvedDiscrepancyCount).toBe(0);
    expect(result.summary.missingFromBankCount).toBe(1);
    expect(result.summary.notLoggedCount).toBe(1);
  });

  it("does not fold unresolved discrepancies into the unmatched exposure totals (they're a different kind of problem)", () => {
    const log = [entry("l1", "2026-01-05", 15000, "Comcast Business Expense", "VISA34083")];
    const bank = [entry("b1", "2026-01-05", 15900, "COMCAST BUSINESS EXPENSE", "VISA34083")];
    const result = reconcile(log, bank);

    expect(result.summary.unmatchedLoggedAbsTotalCents).toBe(0);
    expect(result.summary.unmatchedBankAbsTotalCents).toBe(0);
    expect(result.summary.unresolvedDiscrepancyAbsTotalCents).toBe(900);
  });

  it("does not let the same bank item pair into more than one unresolved discrepancy", () => {
    const log = [
      entry("l1", "2026-01-05", 15000, "Comcast Business Expense", "VISA34083"),
      entry("l2", "2026-01-05", 15100, "Comcast Business Expense duplicate row", "VISA34083"),
    ];
    const bank = [entry("b1", "2026-01-05", 15900, "COMCAST BUSINESS EXPENSE", "VISA34083")];
    const result = reconcile(log, bank);

    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);
  });
});

describe("reconcile — summary totals", () => {
  it("computes unmatched absolute totals and both match-rate denominators correctly", () => {
    const log = [
      entry("l1", "2026-01-05", 10000, "Office Depot supplies"),
      entry("l2", "2026-01-06", 5000, "Unmatched logged expense"),
    ];
    const bank = [
      entry("b1", "2026-01-05", 10000, "Office Depot supplies"),
      entry("b2", "2026-01-08", 2500, "Unrecorded bank fee"),
    ];
    const result = reconcile(log, bank);

    expect(result.summary.unmatchedLoggedAbsTotalCents).toBe(5000);
    expect(result.summary.unmatchedBankAbsTotalCents).toBe(2500);
    expect(result.summary.matchRateVsLogged).toBe(0.5); // 1 of 2 logged lines reconciled
    expect(result.summary.matchRateVsBank).toBe(0.5); // 1 of 2 bank lines reconciled
  });

  it("keeps unmatched totals as a true absolute-value sum, not a net figure that cancels out", () => {
    const log = [
      entry("l1", "2026-01-05", -10000, "Refund issued, never hit the bank"),
      entry("l2", "2026-01-06", 10000, "Deposit, never hit the bank"),
    ];
    const bank: NormalizedEntry[] = [];
    const result = reconcile(log, bank);

    // a net sum would be 0 here and hide both discrepancies; absolute value must not.
    expect(result.summary.unmatchedLoggedAbsTotalCents).toBe(20000);
  });
});

describe("reconcile + normalizeRows — reference backfill flows through to both tiers", () => {
  it("lets the main matcher's reference tier fire on a UTR embedded in narration, with no reference column at all", () => {
    const logTable = {
      headers: ["Date", "Description", "Amount"],
      rows: [{ Date: "2026-06-01", Description: "Vendor payment ref UTR: HDFC0123456789", Amount: "500.00" }],
    };
    const bankTable = {
      headers: ["Date", "Narration", "Amount"],
      rows: [{ Date: "2026-06-01", Narration: "NEFT payment UTR: HDFC0123456789 received", Amount: "500.00" }],
    };
    const logEntries = normalizeRows(logTable, { date: "Date", description: "Description", amount: "Amount" }, "log");
    const bankEntries = normalizeRows(bankTable, { date: "Date", description: "Narration", amount: "Amount" }, "bank");

    const result = reconcile(logEntries, bankEntries);
    expect(result.items[0]).toMatchObject({ type: "matched", reason: "reference_match" });
  });

  it("lets discrepancy-pairing use the same backfilled reference to pair an amount mismatch", () => {
    const logTable = {
      headers: ["Date", "Description", "Amount"],
      rows: [{ Date: "2026-06-01", Description: "Vendor payment ref UTR: HDFC0123456789", Amount: "500.00" }],
    };
    const bankTable = {
      headers: ["Date", "Narration", "Amount"],
      // typo: 590.00 instead of 500.00 — same UTR should still pair them as an unresolved discrepancy
      rows: [{ Date: "2026-06-01", Narration: "NEFT payment UTR: HDFC0123456789 received", Amount: "590.00" }],
    };
    const logEntries = normalizeRows(logTable, { date: "Date", description: "Description", amount: "Amount" }, "log");
    const bankEntries = normalizeRows(bankTable, { date: "Date", description: "Narration", amount: "Amount" }, "bank");

    const result = reconcile(logEntries, bankEntries);
    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);
    expect(result.items[0]).toMatchObject({ type: "unresolved_discrepancy", deltaCents: 9000 });
  });

  it("still uses the description-similarity fallback in discrepancy-pairing when no reference is extractable anywhere", () => {
    const logTable = {
      headers: ["Date", "Description", "Amount"],
      rows: [{ Date: "2026-06-01", Description: "Office Depot supplies purchase", Amount: "99.00" }],
    };
    const bankTable = {
      headers: ["Date", "Narration", "Amount"],
      rows: [{ Date: "2026-06-01", Narration: "Office Depot supplies purchase", Amount: "98.00" }],
    };
    const logEntries = normalizeRows(logTable, { date: "Date", description: "Description", amount: "Amount" }, "log");
    const bankEntries = normalizeRows(bankTable, { date: "Date", description: "Narration", amount: "Amount" }, "bank");

    expect(logEntries[0].reference).toBeUndefined();
    expect(bankEntries[0].reference).toBeUndefined();

    const result = reconcile(logEntries, bankEntries);
    expect(result.summary.unresolvedDiscrepancyCount).toBe(1);
  });
});

describe("reconcile — Flow Tie-Out", () => {
  it("reconciles to a zero residual for a simple matched-only case", () => {
    const log = [entry("l1", "2026-01-05", 10000, "Office Depot supplies")];
    const bank = [entry("b1", "2026-01-05", 10000, "Office Depot supplies")];
    const result = reconcile(log, bank);

    expect(result.flowTieOut.residualCents).toBe(0);
    expect(result.flowTieOut.reconciles).toBe(true);
    expect(result.flowTieOut.actualDifferenceCents).toBe(0);
    expect(result.flowTieOut.expectedDifferenceCents).toBe(0);
  });

  it("explains a one-sided unmatched bank item as unmatchedBankNetCents", () => {
    const log: NormalizedEntry[] = [];
    const bank = [entry("b1", "2026-01-05", 5000, "Unknown wire")];
    const result = reconcile(log, bank);

    expect(result.flowTieOut.actualDifferenceCents).toBe(5000);
    expect(result.flowTieOut.unmatchedBankNetCents).toBe(5000);
    expect(result.flowTieOut.residualCents).toBe(0);
  });

  it("explains an unresolved discrepancy via discrepancyNetDeltaCents", () => {
    const log = [entry("l1", "2026-01-05", 15000, "Comcast", "REF1")];
    const bank = [entry("b1", "2026-01-05", 15900, "Comcast", "REF1")];
    const result = reconcile(log, bank);

    expect(result.flowTieOut.discrepancyNetDeltaCents).toBe(900);
    expect(result.flowTieOut.residualCents).toBe(0);
  });

  it("explains a ledger-side duplicate via duplicatesNetCents (matches the literal spec when duplicates are ledger-only)", () => {
    const log = [
      entry("l1", "2026-01-05", 3000, "Rent"),
      entry("l2", "2026-01-05", 3000, "Rent duplicate entry"),
    ];
    const bank = [entry("b1", "2026-01-05", 3000, "Rent")];
    const result = reconcile(log, bank);

    // The ambiguous log pair (l1+l2=6000) contributes to the ledger side; the single bank
    // counterpart it was competing for (b1=3000) contributes to the bank side.
    // duplicatesNetCents = bankSide(3000) - ledgerSide(6000) = -3000
    expect(result.flowTieOut.duplicatesNetCents).toBe(-3000);
    expect(result.flowTieOut.residualCents).toBe(0);
  });

  it("still reconciles to zero when duplicates land on the BANK side (the case a ledger-only formula would miss)", () => {
    const log = [entry("l1", "2026-01-05", 3000, "Rent")];
    const bank = [
      entry("b1", "2026-01-05", 3000, "Rent"),
      entry("b2", "2026-01-05", 3000, "Rent duplicate charge"),
    ];
    const result = reconcile(log, bank);

    expect(result.summary.possibleDuplicateCount).toBeGreaterThan(0);
    expect(result.flowTieOut.duplicatesNetCents).toBeGreaterThan(0); // net pulled from the bank side
    expect(result.flowTieOut.residualCents).toBe(0);
  });

  it("stays exactly zero across a complex mix of every bucket type at once", () => {
    const log = [
      // clean match
      entry("l1", "2026-01-05", 10000, "Office Depot supplies"),
      // split-match group (2 log lines = 1 bank line)
      entry("l2", "2026-06-15", 12000, "Payroll - Eng", "PAY-001"),
      entry("l3", "2026-06-15", 8000, "Payroll - Sales", "PAY-001"),
      // ledger-only duplicate
      entry("l4", "2026-01-05", 3000, "Rent"),
      entry("l5", "2026-01-05", 3000, "Rent duplicate entry"),
      // discrepancy pair (amount mismatch, same reference)
      entry("l6", "2026-01-05", 15000, "Comcast", "REF1"),
      // ledger-only missing
      entry("l7", "2026-01-06", 7500, "Consulting fee"),
    ];
    const bank = [
      entry("b1", "2026-01-05", 10000, "Office Depot supplies"),
      entry("b2", "2026-06-15", 20000, "Payroll batch"),
      entry("b3", "2026-01-05", 3000, "Rent"),
      entry("b4", "2026-01-05", 15900, "Comcast", "REF1"),
      // bank-only not-logged (two independent entries, same amount, no ledger counterpart at all —
      // not a "duplicate" in the detection sense since there's nothing to lose a collision to)
      entry("b5", "2026-01-08", 4200, "Unrecorded bank fee"),
      entry("b6", "2026-01-09", 6600, "Duplicate charge"),
      entry("b7", "2026-01-09", 6600, "Duplicate charge again"),
    ];

    const result = reconcile(log, bank);

    expect(result.summary.matchedPairCount).toBeGreaterThan(0);
    expect(result.summary.splitMatchGroupCount).toBeGreaterThan(0);
    expect(result.summary.possibleDuplicateCount).toBeGreaterThan(0);
    expect(result.summary.unresolvedDiscrepancyCount).toBeGreaterThan(0);
    expect(result.summary.missingFromBankCount).toBeGreaterThan(0);
    expect(result.summary.notLoggedCount).toBeGreaterThan(0);

    expect(result.flowTieOut.actualDifferenceCents).toBe(
      result.flowTieOut.netBankActivityCents - result.flowTieOut.netBookActivityCents
    );
    expect(result.flowTieOut.residualCents).toBe(0);
    expect(result.flowTieOut.reconciles).toBe(true);
  });

  it("carries the required label, caveat, and status message text", () => {
    const result = reconcile([], []);
    expect(result.flowTieOut.label).toBe("Flow Tie-Out");
    expect(result.flowTieOut.caveat).toMatch(/does not confirm the account's actual balance is correct/i);
    expect(result.flowTieOut.caveat).toMatch(/no starting balance/i);
    expect(result.flowTieOut.reconciles).toBe(true);
    expect(result.flowTieOut.statusMessage).toMatch(/flow reconciles/i);
  });
});
