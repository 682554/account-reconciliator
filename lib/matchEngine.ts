export type NormalizedEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
  description: string;
  /** Check/reference/confirmation number, when the source has one. Absent, not empty-string. */
  reference?: string;
  raw: Record<string, unknown>;
};

export type MatchReason =
  | "exact" // date and amount both matched exactly (description similarity not required)
  | "reference_match" // reference numbers matched, date within tolerance
  | "matched_date_gap" // reference numbers matched, but dates differ beyond tolerance — flagged for review
  | "date_mismatch"; // date within slack (not exact) and description similarity confirmed it

export type Matched = {
  type: "matched";
  logEntry: NormalizedEntry;
  bankEntry: NormalizedEntry;
  reason: MatchReason;
  descriptionSimilarity: number;
};

/** A single transaction on one side that equals the sum of 2-4 transactions on the other side, same date. */
export type SplitMatch = {
  type: "split_match";
  singleSide: "log" | "bank";
  singleEntry: NormalizedEntry;
  groupEntries: NormalizedEntry[];
  note: string;
};

export type MissingFromBank = {
  type: "missing_from_bank";
  logEntry: NormalizedEntry;
  note: string;
};

export type NotLogged = {
  type: "not_logged";
  bankEntry: NormalizedEntry;
  note: string;
};

/**
 * 2+ entries on one side that could not be confidently told apart — either they share an
 * amount with no confirming date/description/reference, or they collided at the same
 * date+amount with no reference available to break the tie. `counterpart` is the single
 * entry on the other side they were competing for/against, when one exists.
 */
export type PossibleDuplicate = {
  type: "possible_duplicate";
  ambiguousSide: "log" | "bank";
  candidates: NormalizedEntry[];
  counterpart?: NormalizedEntry;
  note: string;
};

/**
 * A bank line and a logged line that are almost certainly the same underlying transaction —
 * confirmed by a matching reference number, or by same-day + strongly similar description —
 * but whose amounts don't agree (typo, sign-flip, rounding drift). This is a data-entry error
 * to fix on one side, not a timing gap and not a duplicate, so it's kept out of both.
 */
export type UnresolvedDiscrepancy = {
  type: "unresolved_discrepancy";
  bankEntry: NormalizedEntry;
  logEntry: NormalizedEntry;
  /** bankEntry.amountCents - logEntry.amountCents */
  deltaCents: number;
  reason: string;
};

export type ReconciliationItem =
  | Matched
  | SplitMatch
  | MissingFromBank
  | NotLogged
  | PossibleDuplicate
  | UnresolvedDiscrepancy;

export const FLOW_TIE_OUT_LABEL = "Flow Tie-Out";
export const FLOW_TIE_OUT_CAVEAT =
  "Validates this period's activity only — does not confirm the account's actual balance is correct, since it has no starting balance to anchor against. An error already present before this period began would not be caught here.";
export const FLOW_TIE_OUT_RECONCILED_MESSAGE =
  "Flow reconciles — every dollar of difference between bank and book activity this period is accounted for by known unmatched items, discrepancies, and duplicates.";
export const FLOW_TIE_OUT_UNRECONCILED_MESSAGE =
  "Flow does NOT reconcile. Some amount is unaccounted for by matching, split/batch detection, duplicate detection, and discrepancy-pairing combined — this points to either a genuine unexplained transaction or a bug in how items are being bucketed upstream. Do not treat this residual as immaterial or round it away.";

/**
 * A no-beginning-balance sanity check: every dollar of difference between total bank activity
 * and total book activity this period must be fully explained by the unmatched/duplicate/
 * discrepancy buckets already produced above. Matched pairs and split-match groups are exactly
 * equal on both sides by construction, so they cancel out of the difference entirely — this is
 * an algebraic identity, not an estimate. A nonzero residual means some entry fell through every
 * categorization branch without being counted anywhere, i.e. a bucketing bug, not a real-world
 * timing gap (those are already covered by the categories above).
 */
export type FlowTieOut = {
  label: string;
  caveat: string;
  netBankActivityCents: number;
  netBookActivityCents: number;
  actualDifferenceCents: number;
  unmatchedBankNetCents: number;
  unmatchedLedgerNetCents: number;
  discrepancyNetDeltaCents: number;
  /** Net of duplicate amounts pulled from the bank side minus the ledger side (either can host duplicates). */
  duplicatesNetCents: number;
  expectedDifferenceCents: number;
  residualCents: number;
  /** true when |residualCents| is within 1 cent. */
  reconciles: boolean;
  /** FLOW_TIE_OUT_RECONCILED_MESSAGE or FLOW_TIE_OUT_UNRECONCILED_MESSAGE, precomputed so every consumer shows identical wording. */
  statusMessage: string;
};

export type ReconciliationResult = {
  items: ReconciliationItem[];
  flowTieOut: FlowTieOut;
  summary: {
    loggedCount: number;
    bankCount: number;
    /** 1:1 matched pairs (exact / reference / date-gap-flagged / date-slack+description). */
    matchedPairCount: number;
    /** Number of split/batch groups found (one bank or log line summing to 2-4 lines on the other side). */
    splitMatchGroupCount: number;
    missingFromBankCount: number;
    notLoggedCount: number;
    possibleDuplicateCount: number;
    /** Same underlying transaction on both sides, but the amounts disagree — a data-entry error, not a timing gap. */
    unresolvedDiscrepancyCount: number;
    /** Sum of |bank amount - ledger amount| across all unresolved discrepancies. */
    unresolvedDiscrepancyAbsTotalCents: number;
    /** Share of logged lines accounted for by a match or a split-match group (not a net dollar figure). */
    matchRateVsLogged: number;
    /** Share of bank lines accounted for by a match or a split-match group. */
    matchRateVsBank: number;
    /** Sum of |amount| for logged transactions with no confirmed bank counterpart (missing + ambiguous). */
    unmatchedLoggedAbsTotalCents: number;
    /** Sum of |amount| for bank transactions with no confirmed logged counterpart (not-logged + ambiguous). */
    unmatchedBankAbsTotalCents: number;
  };
};

export type MatchOptions = {
  /** Days of slack allowed when treating a date as "close enough" for a description-based match. */
  dateSlackDays?: number;
  /** Minimum description similarity (0-1) required for the date-slack (non-exact-date) match tier. */
  descriptionThreshold?: number;
  /** Business days of date gap allowed for a reference+amount match before it's flagged as matched_date_gap. */
  referenceDateGapBusinessDays?: number;
  /** Min/max number of same-day transactions considered when looking for a split/batch match. */
  splitMatchMinGroupSize?: number;
  splitMatchMaxGroupSize?: number;
  /**
   * Minimum description similarity required to pair an amount-mismatched bank/log line as an
   * unresolved discrepancy when there's no reference number to confirm it. Deliberately higher
   * than descriptionThreshold — a false pair here actively hides a real data-entry error rather
   * than just missing a legitimate match, so this tier trades recall for precision on purpose.
   */
  discrepancyDescriptionThreshold?: number;
};

const DEFAULT_OPTIONS: Required<MatchOptions> = {
  dateSlackDays: 3,
  descriptionThreshold: 0.35,
  referenceDateGapBusinessDays: 5,
  splitMatchMinGroupSize: 2,
  splitMatchMaxGroupSize: 4,
  discrepancyDescriptionThreshold: 0.6,
};

/**
 * Token-overlap (Dice coefficient over bigrams) similarity — no external dependency needed
 * for the fuzzy description check described in the plan.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const bigrams = (s: string) => {
    const grams = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    return grams;
  };

  const ga = bigrams(na);
  const gb = bigrams(nb);
  let intersection = 0;
  let totalA = 0;
  let totalB = 0;
  for (const v of ga.values()) totalA += v;
  for (const v of gb.values()) totalB += v;
  for (const [g, countA] of ga) {
    const countB = gb.get(g);
    if (countB) intersection += Math.min(countA, countB);
  }
  if (totalA + totalB === 0) return 0;
  return (2 * intersection) / (totalA + totalB);
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function businessDaysBetween(dateA: string, dateB: string): number {
  let a = new Date(dateA);
  let b = new Date(dateB);
  if (a.getTime() === b.getTime()) return 0;
  if (a.getTime() > b.getTime()) [a, b] = [b, a];

  let count = 0;
  const cur = new Date(a);
  cur.setDate(cur.getDate() + 1);
  while (cur.getTime() <= b.getTime()) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** true = both sides have a reference and it matches; false = both have one and it conflicts; null = not comparable. */
function compareReference(a?: string, b?: string): boolean | null {
  if (!a || !b) return null;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function groupByDateAmount(entries: NormalizedEntry[]): Map<string, NormalizedEntry[]> {
  const map = new Map<string, NormalizedEntry[]>();
  for (const e of entries) {
    const key = `${e.date}|${e.amountCents}`;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

type SplitCandidate = { single: NormalizedEntry; group: NormalizedEntry[] };

/**
 * Finds, for entries on `singleSide`, a same-date subset of 2-4 entries on `groupSide` whose
 * amounts sum exactly to it. Greedy: processes single-side entries in order and removes
 * consumed group-side entries from the pool as matches are found, so no entry is used twice.
 */
function findSplitMatches(
  singleSideEntries: NormalizedEntry[],
  groupSideEntries: NormalizedEntry[],
  minSize: number,
  maxSize: number
): SplitCandidate[] {
  const results: SplitCandidate[] = [];
  const usedGroupIds = new Set<string>();

  const groupByDate = new Map<string, NormalizedEntry[]>();
  for (const e of groupSideEntries) {
    const list = groupByDate.get(e.date) ?? [];
    list.push(e);
    groupByDate.set(e.date, list);
  }

  for (const single of singleSideEntries) {
    const candidates = (groupByDate.get(single.date) ?? []).filter((e) => !usedGroupIds.has(e.id));
    if (candidates.length < minSize) continue;

    let found: NormalizedEntry[] | null = null;
    for (let size = minSize; size <= maxSize && !found; size++) {
      for (const combo of combinations(candidates, size)) {
        const sum = combo.reduce((acc, e) => acc + e.amountCents, 0);
        if (sum === single.amountCents) {
          found = combo;
          break;
        }
      }
    }

    if (found) {
      results.push({ single, group: found });
      for (const g of found) usedGroupIds.add(g.id);
      groupByDate.set(
        single.date,
        (groupByDate.get(single.date) ?? []).filter((e) => !usedGroupIds.has(e.id))
      );
    }
  }

  return results;
}

/**
 * If `entry` shares a date+amount key with another entry on its own side that ended up
 * matched, returns that sibling — evidence `entry` is a leftover duplicate that lost the
 * collision, not a transaction that's genuinely missing/unrecorded on the other side.
 */
function findMatchedSibling(
  entry: NormalizedEntry,
  keyGroups: Map<string, NormalizedEntry[]>,
  usedIds: Set<string>
): NormalizedEntry | null {
  const key = `${entry.date}|${entry.amountCents}`;
  const siblings = keyGroups.get(key) ?? [];
  return siblings.find((s) => s.id !== entry.id && usedIds.has(s.id)) ?? null;
}

export function reconcile(
  logEntries: NormalizedEntry[],
  bankEntries: NormalizedEntry[],
  options: MatchOptions = {}
): ReconciliationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const logKeyGroups = groupByDateAmount(logEntries);
  const bankKeyGroups = groupByDateAmount(bankEntries);

  const usedBankIds = new Set<string>();
  const usedLogIds = new Set<string>();
  const items: ReconciliationItem[] = [];

  const byAmount = new Map<number, NormalizedEntry[]>();
  for (const b of bankEntries) {
    const list = byAmount.get(b.amountCents) ?? [];
    list.push(b);
    byAmount.set(b.amountCents, list);
  }

  // ================= Stage 1: reference + amount (highest priority) =================
  // A global pass over every log entry, matching only where a reference genuinely confirms
  // it. Running this to completion before any lower-confidence tier runs is what stops a
  // no-reference duplicate from grabbing a bank line before its correctly-referenced sibling
  // gets a chance to claim it.
  for (const log of logEntries) {
    const available = (byAmount.get(log.amountCents) ?? []).filter((b) => !usedBankIds.has(b.id));
    const refCandidates = available.filter((b) => compareReference(log.reference, b.reference) === true);
    if (refCandidates.length === 0) continue;

    refCandidates.sort((a, b) => daysBetween(log.date, a.date) - daysBetween(log.date, b.date));
    const bankEntry = refCandidates[0];
    const gap = businessDaysBetween(log.date, bankEntry.date);
    const reason: MatchReason = gap > opts.referenceDateGapBusinessDays ? "matched_date_gap" : "reference_match";

    usedBankIds.add(bankEntry.id);
    usedLogIds.add(log.id);
    items.push({
      type: "matched",
      logEntry: log,
      bankEntry,
      reason,
      descriptionSimilarity: descriptionSimilarity(log.description, bankEntry.description),
    });
  }

  let remainingLog = logEntries.filter((e) => !usedLogIds.has(e.id));
  let remainingBank = bankEntries.filter((e) => !usedBankIds.has(e.id));

  // ================= Stage 2: split/batch matching =================
  const splitMatches: SplitMatch[] = [];

  for (const r of findSplitMatches(remainingBank, remainingLog, opts.splitMatchMinGroupSize, opts.splitMatchMaxGroupSize)) {
    usedBankIds.add(r.single.id);
    for (const g of r.group) usedLogIds.add(g.id);
    splitMatches.push({
      type: "split_match",
      singleSide: "bank",
      singleEntry: r.single,
      groupEntries: r.group,
      note: `1 bank transaction matches the sum of ${r.group.length} logged transactions on ${r.single.date}.`,
    });
  }
  remainingLog = remainingLog.filter((e) => !usedLogIds.has(e.id));
  remainingBank = remainingBank.filter((e) => !usedBankIds.has(e.id));

  for (const r of findSplitMatches(remainingLog, remainingBank, opts.splitMatchMinGroupSize, opts.splitMatchMaxGroupSize)) {
    usedLogIds.add(r.single.id);
    for (const g of r.group) usedBankIds.add(g.id);
    splitMatches.push({
      type: "split_match",
      singleSide: "log",
      singleEntry: r.single,
      groupEntries: r.group,
      note: `1 logged transaction matches the sum of ${r.group.length} bank transactions on ${r.single.date}.`,
    });
  }
  remainingLog = remainingLog.filter((e) => !usedLogIds.has(e.id));
  remainingBank = remainingBank.filter((e) => !usedBankIds.has(e.id));
  items.push(...splitMatches);

  // ================= Stage 3: exact date+amount fallback, with collision detection =================
  // Real ledgers frequently don't carry the bank's reference number, so exact date+amount is
  // still allowed to match on its own — but only after checking whether 2+ unmatched entries
  // on one side are competing for the same single entry on the other side. A silent
  // first-in-array-order match here is exactly what let a ledger duplicate steal the wrong
  // bank line out from under the correct original.
  const logByKey = groupByDateAmount(remainingLog);
  const bankByKey = groupByDateAmount(remainingBank);
  const keys = new Set<string>([...logByKey.keys(), ...bankByKey.keys()]);

  for (const key of keys) {
    const logs = logByKey.get(key) ?? [];
    const banks = bankByKey.get(key) ?? [];
    if (logs.length === 0 || banks.length === 0) continue;

    if (logs.length === 1 && banks.length === 1) {
      const log = logs[0];
      const bankEntry = banks[0];
      usedLogIds.add(log.id);
      usedBankIds.add(bankEntry.id);
      items.push({
        type: "matched",
        logEntry: log,
        bankEntry,
        reason: "exact",
        descriptionSimilarity: descriptionSimilarity(log.description, bankEntry.description),
      });
      continue;
    }

    // Collision: at least one side has 2+ entries at this exact date+amount. First, resolve
    // any pair a reference number uniquely confirms — a real signal beats a coin-flip tie-break.
    let remLogs = [...logs];
    let remBanks = [...banks];

    for (const bankEntry of banks) {
      if (!remBanks.some((b) => b.id === bankEntry.id)) continue;
      const refMatches = remLogs.filter((l) => compareReference(l.reference, bankEntry.reference) === true);
      if (refMatches.length === 1) {
        const log = refMatches[0];
        usedLogIds.add(log.id);
        usedBankIds.add(bankEntry.id);
        items.push({
          type: "matched",
          logEntry: log,
          bankEntry,
          reason: "reference_match",
          descriptionSimilarity: descriptionSimilarity(log.description, bankEntry.description),
        });
        remLogs = remLogs.filter((l) => l.id !== log.id);
        remBanks = remBanks.filter((b) => b.id !== bankEntry.id);
      }
    }

    if (remLogs.length === 0 || remBanks.length === 0) continue; // fully resolved by reference

    if (remLogs.length === 1 && remBanks.length === 1) {
      const log = remLogs[0];
      const bankEntry = remBanks[0];
      usedLogIds.add(log.id);
      usedBankIds.add(bankEntry.id);
      items.push({
        type: "matched",
        logEntry: log,
        bankEntry,
        reason: "exact",
        descriptionSimilarity: descriptionSimilarity(log.description, bankEntry.description),
      });
      continue;
    }

    // Ambiguous tie: no reference to break it. Tie-break by original row order for bookkeeping
    // purposes, but flag every candidate involved — including the tie-broken pick — as needing
    // human review rather than silently reporting a confident match.
    if (remLogs.length >= 2 && remBanks.length === 1) {
      const counterpart = remBanks[0];
      usedBankIds.add(counterpart.id);
      for (const l of remLogs) usedLogIds.add(l.id);
      items.push({
        type: "possible_duplicate",
        ambiguousSide: "log",
        candidates: remLogs,
        counterpart,
        note: `${remLogs.length} logged transactions share this date and amount with no reference to tell them apart. "${remLogs[0].description}" would be used by default — please confirm.`,
      });
      continue;
    }

    if (remBanks.length >= 2 && remLogs.length === 1) {
      const counterpart = remLogs[0];
      usedLogIds.add(counterpart.id);
      for (const b of remBanks) usedBankIds.add(b.id);
      items.push({
        type: "possible_duplicate",
        ambiguousSide: "bank",
        candidates: remBanks,
        counterpart,
        note: `${remBanks.length} bank transactions share this date and amount with no reference to tell them apart. "${remBanks[0].description}" would be used by default — please confirm.`,
      });
      continue;
    }

    // Rare residual ambiguity on both sides at once — flag everything rather than guess.
    for (const l of remLogs) usedLogIds.add(l.id);
    for (const b of remBanks) usedBankIds.add(b.id);
    items.push({
      type: "possible_duplicate",
      ambiguousSide: "log",
      candidates: remLogs,
      note: `${remLogs.length} logged and ${remBanks.length} bank transactions share this date and amount with no reference to disambiguate them — please review manually.`,
    });
    items.push({
      type: "possible_duplicate",
      ambiguousSide: "bank",
      candidates: remBanks,
      note: `${remBanks.length} bank and ${remLogs.length} logged transactions share this date and amount with no reference to disambiguate them — please review manually.`,
    });
  }

  remainingLog = logEntries.filter((e) => !usedLogIds.has(e.id));
  remainingBank = bankEntries.filter((e) => !usedBankIds.has(e.id));

  // ================= Stage 4: date-slack + description fallback (lowest priority) =================
  for (const log of remainingLog) {
    if (usedLogIds.has(log.id)) continue;
    const available = (byAmount.get(log.amountCents) ?? []).filter((b) => !usedBankIds.has(b.id));
    if (available.length === 0) continue;

    const candidates = available
      .map((b) => ({
        bankEntry: b,
        sim: descriptionSimilarity(log.description, b.description),
        dateDiff: daysBetween(log.date, b.date),
      }))
      .filter((c) => c.dateDiff > 0 && c.dateDiff <= opts.dateSlackDays && c.sim >= opts.descriptionThreshold)
      .sort((a, b) => b.sim - a.sim || a.dateDiff - b.dateDiff);

    if (candidates.length === 0) continue;
    const best = candidates[0];
    usedBankIds.add(best.bankEntry.id);
    usedLogIds.add(log.id);
    items.push({ type: "matched", logEntry: log, bankEntry: best.bankEntry, reason: "date_mismatch", descriptionSimilarity: best.sim });
  }

  remainingLog = logEntries.filter((e) => !usedLogIds.has(e.id));
  remainingBank = bankEntries.filter((e) => !usedBankIds.has(e.id));

  // ================= Stage 5: discrepancy pairing (amount mismatches) =================
  // Everything above required amounts to match exactly. What's left may still be the same
  // underlying transaction on both sides with a data-entry error — a typo, a sign-flip, cent
  // rounding drift. Pair those explicitly instead of leaving two disconnected one-sided entries
  // a human would have immediately recognized as the same thing. Reference match is the primary
  // signal (near-unique, trusted even with a large delta); without one, the fallback requires
  // both a close date AND a strict description-similarity bar, since a bare similarity score
  // can't reliably tell a real pair from two coincidentally-similar unrelated transactions.
  const unresolvedDiscrepancies: UnresolvedDiscrepancy[] = [];

  for (const bankEntry of remainingBank) {
    if (usedBankIds.has(bankEntry.id)) continue;
    const refCandidates = remainingLog
      .filter((log) => !usedLogIds.has(log.id) && log.amountCents !== bankEntry.amountCents)
      .filter((log) => compareReference(log.reference, bankEntry.reference) === true)
      .sort((a, b) => daysBetween(bankEntry.date, a.date) - daysBetween(bankEntry.date, b.date));

    const logEntry = refCandidates[0];
    if (!logEntry) continue;

    usedBankIds.add(bankEntry.id);
    usedLogIds.add(logEntry.id);
    unresolvedDiscrepancies.push({
      type: "unresolved_discrepancy",
      bankEntry,
      logEntry,
      deltaCents: bankEntry.amountCents - logEntry.amountCents,
      reason: `Reference numbers match but amounts differ (bank ${formatDollars(bankEntry.amountCents)} vs ledger ${formatDollars(logEntry.amountCents)}).`,
    });
  }
  remainingLog = remainingLog.filter((e) => !usedLogIds.has(e.id));
  remainingBank = remainingBank.filter((e) => !usedBankIds.has(e.id));

  for (const bankEntry of remainingBank) {
    if (usedBankIds.has(bankEntry.id)) continue;
    const candidates = remainingLog
      .filter((log) => !usedLogIds.has(log.id) && log.amountCents !== bankEntry.amountCents)
      .filter((log) => compareReference(log.reference, bankEntry.reference) !== true) // no confirming reference
      .map((log) => ({
        logEntry: log,
        dateDiff: daysBetween(bankEntry.date, log.date),
        sim: descriptionSimilarity(bankEntry.description, log.description),
      }))
      .filter((c) => c.dateDiff <= opts.dateSlackDays && c.sim >= opts.discrepancyDescriptionThreshold)
      .sort((a, b) => b.sim - a.sim || a.dateDiff - b.dateDiff);

    const best = candidates[0];
    if (!best) continue;

    usedBankIds.add(bankEntry.id);
    usedLogIds.add(best.logEntry.id);
    unresolvedDiscrepancies.push({
      type: "unresolved_discrepancy",
      bankEntry,
      logEntry: best.logEntry,
      deltaCents: bankEntry.amountCents - best.logEntry.amountCents,
      reason: `Same date and closely matching description, but amounts differ (bank ${formatDollars(bankEntry.amountCents)} vs ledger ${formatDollars(best.logEntry.amountCents)}).`,
    });
  }
  remainingLog = remainingLog.filter((e) => !usedLogIds.has(e.id));
  remainingBank = remainingBank.filter((e) => !usedBankIds.has(e.id));
  items.push(...unresolvedDiscrepancies);

  // ================= Final categorization of anything still unmatched =================
  for (const log of remainingLog) {
    const matchedSibling = findMatchedSibling(log, logKeyGroups, usedLogIds);
    if (matchedSibling) {
      items.push({
        type: "possible_duplicate",
        ambiguousSide: "log",
        candidates: [log],
        note: `Shares its date and amount with "${matchedSibling.description}", which already matched a bank transaction — likely a duplicate logged entry.`,
      });
      continue;
    }

    const stillAvailable = (byAmount.get(log.amountCents) ?? []).filter((b) => !usedBankIds.has(b.id));
    if (stillAvailable.length > 1) {
      items.push({
        type: "possible_duplicate",
        ambiguousSide: "bank",
        candidates: stillAvailable,
        counterpart: log,
        note: `${stillAvailable.length} bank entries share this amount; none confidently matched.`,
      });
    } else if (stillAvailable.length === 1) {
      items.push({
        type: "missing_from_bank",
        logEntry: log,
        note: "A bank entry with this amount exists but date/description differ too much to confirm a match.",
      });
    } else {
      items.push({
        type: "missing_from_bank",
        logEntry: log,
        note: "No bank entry with this amount was found.",
      });
    }
  }

  for (const b of remainingBank) {
    const matchedSibling = findMatchedSibling(b, bankKeyGroups, usedBankIds);
    if (matchedSibling) {
      items.push({
        type: "possible_duplicate",
        ambiguousSide: "bank",
        candidates: [b],
        note: `Shares its date and amount with "${matchedSibling.description}", which already matched a logged transaction — likely a duplicate bank entry.`,
      });
      continue;
    }

    items.push({ type: "not_logged", bankEntry: b, note: "No corresponding logged transaction was found." });
  }

  // ================= Summary =================
  const matchedItems = items.filter((i): i is Matched => i.type === "matched");
  const splitMatchItems = items.filter((i): i is SplitMatch => i.type === "split_match");
  const missingFromBank = items.filter((i): i is MissingFromBank => i.type === "missing_from_bank");
  const notLogged = items.filter((i): i is NotLogged => i.type === "not_logged");
  const possibleDuplicates = items.filter((i): i is PossibleDuplicate => i.type === "possible_duplicate");

  const accountedLogIds = new Set<string>();
  const accountedBankIds = new Set<string>();
  for (const m of matchedItems) {
    accountedLogIds.add(m.logEntry.id);
    accountedBankIds.add(m.bankEntry.id);
  }
  for (const s of splitMatchItems) {
    if (s.singleSide === "bank") {
      accountedBankIds.add(s.singleEntry.id);
      for (const g of s.groupEntries) accountedLogIds.add(g.id);
    } else {
      accountedLogIds.add(s.singleEntry.id);
      for (const g of s.groupEntries) accountedBankIds.add(g.id);
    }
  }

  let unmatchedLoggedAbsTotalCents = missingFromBank.reduce((sum, m) => sum + Math.abs(m.logEntry.amountCents), 0);
  let unmatchedBankAbsTotalCents = notLogged.reduce((sum, m) => sum + Math.abs(m.bankEntry.amountCents), 0);
  for (const d of possibleDuplicates) {
    const total = d.candidates.reduce((sum, e) => sum + Math.abs(e.amountCents), 0);
    if (d.ambiguousSide === "log") unmatchedLoggedAbsTotalCents += total;
    else unmatchedBankAbsTotalCents += total;
  }

  const unresolvedDiscrepancyItems = items.filter((i): i is UnresolvedDiscrepancy => i.type === "unresolved_discrepancy");
  const unresolvedDiscrepancyAbsTotalCents = unresolvedDiscrepancyItems.reduce(
    (sum, d) => sum + Math.abs(d.deltaCents),
    0
  );

  // ================= Flow Tie-Out =================
  const netBankActivityCents = bankEntries.reduce((sum, e) => sum + e.amountCents, 0);
  const netBookActivityCents = logEntries.reduce((sum, e) => sum + e.amountCents, 0);
  const actualDifferenceCents = netBankActivityCents - netBookActivityCents;

  const unmatchedBankNetCents = notLogged.reduce((sum, m) => sum + m.bankEntry.amountCents, 0);
  const unmatchedLedgerNetCents = missingFromBank.reduce((sum, m) => sum + m.logEntry.amountCents, 0);
  const discrepancyNetDeltaCents = unresolvedDiscrepancyItems.reduce((sum, d) => sum + d.deltaCents, 0);

  let duplicateBankNetCents = 0;
  let duplicateLedgerNetCents = 0;
  for (const d of possibleDuplicates) {
    const candidatesSumCents = d.candidates.reduce((sum, e) => sum + e.amountCents, 0);
    if (d.ambiguousSide === "bank") {
      duplicateBankNetCents += candidatesSumCents;
      if (d.counterpart) duplicateLedgerNetCents += d.counterpart.amountCents;
    } else {
      duplicateLedgerNetCents += candidatesSumCents;
      if (d.counterpart) duplicateBankNetCents += d.counterpart.amountCents;
    }
  }
  const duplicatesNetCents = duplicateBankNetCents - duplicateLedgerNetCents;

  const expectedDifferenceCents =
    unmatchedBankNetCents - unmatchedLedgerNetCents + discrepancyNetDeltaCents + duplicatesNetCents;
  const residualCents = actualDifferenceCents - expectedDifferenceCents;
  const reconciles = Math.abs(residualCents) <= 1;

  const flowTieOut: FlowTieOut = {
    label: FLOW_TIE_OUT_LABEL,
    caveat: FLOW_TIE_OUT_CAVEAT,
    netBankActivityCents,
    netBookActivityCents,
    actualDifferenceCents,
    unmatchedBankNetCents,
    unmatchedLedgerNetCents,
    discrepancyNetDeltaCents,
    duplicatesNetCents,
    expectedDifferenceCents,
    residualCents,
    reconciles,
    statusMessage: reconciles ? FLOW_TIE_OUT_RECONCILED_MESSAGE : FLOW_TIE_OUT_UNRECONCILED_MESSAGE,
  };

  return {
    items,
    flowTieOut,
    summary: {
      loggedCount: logEntries.length,
      bankCount: bankEntries.length,
      matchedPairCount: matchedItems.length,
      splitMatchGroupCount: splitMatchItems.length,
      missingFromBankCount: missingFromBank.length,
      notLoggedCount: notLogged.length,
      possibleDuplicateCount: possibleDuplicates.length,
      unresolvedDiscrepancyCount: unresolvedDiscrepancyItems.length,
      unresolvedDiscrepancyAbsTotalCents,
      matchRateVsLogged: logEntries.length === 0 ? 0 : accountedLogIds.size / logEntries.length,
      matchRateVsBank: bankEntries.length === 0 ? 0 : accountedBankIds.size / bankEntries.length,
      unmatchedLoggedAbsTotalCents,
      unmatchedBankAbsTotalCents,
    },
  };
}
