// =============================================================================
// packages/rules-engine/test/generators/validate-settlement-sequence.ts
// =============================================================================
// WHAT MAKES A SETTLEMENT SEQUENCE WELL FORMED, TRANSCRIBED FROM M01 SECTION
// 3.6, FROM `0010_payouts.sql`, AND FROM NOWHERE ELSE.
//
// THIS FILE IS THE ORACLE AND IT IS DELIBERATELY NOT THE GENERATOR, which is
// `validate-day-sequence.ts`'s argument one file over and this repository's
// most-repeated lesson: `settlement-sequence.ts` builds valid sequences by
// CONSTRUCTION and this file checks them by READING. One module doing both
// would make `settlement-sequence.property.test.ts` prove only that the code
// agrees with itself.
//
// IT ALSO DOES NOT IMPORT THE ENGINE. `src/payout/clamp.ts` computes the split
// and `src/payout/settle.ts` advances the anchors; if this oracle called either
// one, a generator built against it would be pinned to the implementation
// rather than to the document, which is TR-01 exactly. Every arithmetic rule
// below is re-derived here from M01's own words.
//
// -----------------------------------------------------------------------------
// WHY THE SHAPES ARE DECLARED HERE AND NOT IN A FOURTH `*-input.ts`
// -----------------------------------------------------------------------------
// `day-input.ts` exists because a day sequence has SEVEN interfaces and three
// consumers. A settlement sequence has TWO, and a file whose whole content is
// two interfaces is a file a reader has to open to learn nothing. They are
// exported from here, so the oracle and the generator still share one
// declaration and the asymmetry with `day-input.ts` is stated rather than left
// for someone to notice and reopen.
//
// -----------------------------------------------------------------------------
// CENTS ARE `number`, FOR `day-input.ts`'s REASON AND NO OTHER
// -----------------------------------------------------------------------------
// M01 section 2.1 declares `type Cents = bigint`; the tree ships
// `Cents = number & { __brand }`. `day-input.ts` follows the tree and records
// the divergence rather than introducing a third spelling, and this file does
// the same thing for the same reason: a settlement whose `approvedCents` is a
// `bigint` cannot be compared against a plan whose `min_payout_cents` is a
// `number` without a cast at every call site, and a cast at every call site is
// where a units bug hides. `INV-02` below buys mechanically what `bigint` would
// have bought by construction.
//
// -----------------------------------------------------------------------------
// EVERY RULE ID IS A CITATION, AND THAT IS WHY THERE IS NO NEW `XX-nn` SERIES
// -----------------------------------------------------------------------------
// Inherited verbatim from `validate-day-sequence.ts`, which rejected a `DS-nn`
// series on sight because this corpus already carries `SD-nn` and two series
// one transposition apart is a footgun with no upside. The rule id IS the
// primary source, spelled the way that source spells it, with a slash-suffixed
// clause name where one source states more than one clause. Database
// constraints are cited BY THEIR OWN CONSTRAINT NAME, so a reader greps
// `0010_payouts.sql` and lands on the line.
// =============================================================================

import type { DaySequence, TradingDay } from './day-input.ts';
import type { MaterializedPlan } from './plan-config.ts';

/**
 * One settled payout, as the fold reads it at DO-2.
 *
 * Field for field `src/types.ts`'s `SettlementFact`, with cents as `number`
 * per the header. A payout that FAILED is deliberately not modelled: R-45 is
 * "a failed attempt does not consume an ordinal (SD-05)", so a stream of
 * settlements is a stream of successes by construction, exactly as
 * `day-input.ts` models only live marks because R-11 says the engine reads
 * only live marks.
 */
export interface SettlementFact {
  readonly payoutRequestId: string;
  /** `payoutsSettledCount + 1` at request time (R-45). */
  readonly ordinal: number;
  /** What the trader asked for. `payout_requests.requested_cents`. */
  readonly requestedCents: number;
  /** R-43's clamp result. `approved_cents`. */
  readonly approvedCents: number;
  /** R-44's ceiling leg. `trader_cents`. */
  readonly traderCents: number;
  /** R-44's remainder. `firm_cents`. */
  readonly firmCents: number;
  /** The last closed day the decision used (R-46, R-47). Not a wall clock. */
  readonly basisTradingDay: TradingDay;
  /** First trading day whose OPENING balance reflects the withdrawal (SD-03). */
  readonly effectiveTradingDay: TradingDay;
}

/**
 * ONE ACCOUNT'S SETTLEMENTS, over the day sequence they attach to.
 *
 * The day sequence is carried rather than referenced because six of the rules
 * below are stated ACROSS the two and cannot be checked from either alone:
 * both trading days must be sessions in that calendar, and R-10's adjustment
 * must appear on the mark for the effective day. A settlement sequence
 * validated without its days would be a sequence whose days are unfalsifiable.
 */
export interface SettlementSequence {
  readonly days: DaySequence;
  readonly settlements: readonly SettlementFact[];
}

export type SsRuleId =
  // M01 R-45, and `payout_requests.payout_ordinal`.
  | 'R-45/ordinal-starts-at-one'
  | 'R-45/ordinal-is-consecutive'
  // M01 R-42, the cap the ordinal resolves to.
  | 'R-42/approved-within-cap'
  // M01 R-43, the clamp, in the direction it is allowed to move.
  | 'R-43/approved-at-least-the-minimum'
  | 'payout_requests_approved_within_requested'
  // M01 R-44 and INV-11, the split.
  | 'payout_requests_split_sums'
  | 'R-44/remainder-favours-the-trader'
  // M01 R-46, the two anchors, which are different dates.
  | 'R-46/basis-day-is-a-session'
  | 'R-46/effective-day-is-a-session'
  | 'R-46/anchors-advance'
  // SD-03, derived across two constraints. See the source table.
  | 'SD-03/effective-not-before-basis'
  // M01 R-10 and SD-01, the link to the day sequence.
  | 'R-10/adjustment-lands-on-the-effective-day'
  // M01 R-49 and INV-17, the two bounds on a lifetime.
  | 'R-49/ladder-bounds-the-count'
  | 'INV-17/lifetime-bound'
  // M01 section 1.5.
  | 'INV-02';

/** Every rule id, in order, so a caller can iterate the contract rather than retype it. */
export const SS_RULE_IDS: readonly SsRuleId[] = [
  'R-45/ordinal-starts-at-one',
  'R-45/ordinal-is-consecutive',
  'R-42/approved-within-cap',
  'R-43/approved-at-least-the-minimum',
  'payout_requests_approved_within_requested',
  'payout_requests_split_sums',
  'R-44/remainder-favours-the-trader',
  'R-46/basis-day-is-a-session',
  'R-46/effective-day-is-a-session',
  'R-46/anchors-advance',
  'SD-03/effective-not-before-basis',
  'R-10/adjustment-lands-on-the-effective-day',
  'R-49/ladder-bounds-the-count',
  'INV-17/lifetime-bound',
  'INV-02',
];

/**
 * Where each rule is written down, quoted closely enough that a reader can check
 * the transcription without opening four files, and precisely enough that they
 * can open the right one when they want to.
 *
 * `Record<SsRuleId, string>` rather than a list, so the COMPILER refuses a rule
 * added above without a source added here. A citation table that can silently
 * fall behind the thing it cites is the defect ADR-034 exists to end.
 */
export const SS_RULE_SOURCES: Record<SsRuleId, string> = {
  'R-45/ordinal-starts-at-one':
    'M01 R-45: `ordinal = payoutsSettledCount + 1`. On the first settlement that ' +
    'count is zero, so the first ordinal is 1. `0010_payouts.sql` carries the same ' +
    'floor as `CHECK (payout_ordinal > 0)` and calls it "1-based per account".',
  'R-45/ordinal-is-consecutive':
    'M01 R-45: the ordinal is `payoutsSettledCount + 1` and "a failed attempt does ' +
    'not consume an ordinal (SD-05)". `0010_payouts.sql` states the consequence: it ' +
    'is "DERIVED FROM SETTLEMENTS RATHER THAN FROM ATTEMPTS". So across SETTLED ' +
    'payouts the ordinals are gapless, and a gap would mean a failure consumed one.',
  'R-42/approved-within-cap':
    'M01 R-42: "the cap is the `cap_cents` of the last schedule entry whose ' +
    '`from_ordinal <= ordinal`", and R-43 clamps the approval to it. The schedule is ' +
    'an array from day one (DATA_MODEL section 11), so the resolution is a scan and ' +
    'never an index.',
  'R-43/approved-at-least-the-minimum':
    'M01 R-43: "eligible only if `approved >= min_payout_cents`". A settled payout ' +
    'below the minimum is one the gate should never have let through. CV-15 fixes ' +
    'the minimum at 10,000 cents and never scales it by size.',
  payout_requests_approved_within_requested:
    '`0010_payouts.sql`, constraint of this name: `approved_cents <= requested_cents`. ' +
    'Its comment states the reason the direction matters: "An approval above the ' +
    'request is not a generous clamp, it is a bug that pays out money nobody asked ' +
    'for." R-43 says the same thing as `approved = min(effective_request, ...)`.',
  payout_requests_split_sums:
    '`0010_payouts.sql`, constraint of this name: `trader_cents + firm_cents = ' +
    'approved_cents`. M01 INV-11: "exactly, no cents lost", enforced by R-44 and ' +
    'asserted by GS-029. P2 section 5 rules this the R-44 arithmetic half that P2 ' +
    'owns under its own name rather than as a fragment of PT-03.',
  'R-44/remainder-favours-the-trader':
    'M01 R-44: `trader = (approved * split_bp + 9999) / 10000` in integer division ' +
    '(a ceiling); `firm = approved - trader`. "Rounding favors the trader, by at most ' +
    'one cent, and the published copy says so." Integer arithmetic throughout: no ' +
    'float ever touches this line (constitution, INV-02).',
  'R-46/basis-day-is-a-session':
    'M01 R-46: `payoutAnchorDay = fact.basisTradingDay`, and R-47 counts win days ' +
    'from it. `0010_payouts.sql` calls it "The LAST CLOSED DAY the decision used. ' +
    'Not a wall clock." A day that is not a session cannot be a day that closed.',
  'R-46/effective-day-is-a-session':
    'M01 R-46: `cadenceAnchorDay = fact.effectiveTradingDay`, and R-37 counts the ' +
    'cadence gap from it by `calendar.sequence` subtraction. A day with no sequence ' +
    'is a day that subtraction cannot use.',
  'R-46/anchors-advance':
    'M01 R-46, "Settlement advances both anchors", confirmed at the gate by ' +
    'ADR-013. An anchor that advances is one that strictly increases, so across a ' +
    'sequence both day streams are strictly ascending. SD-02 replaced one column ' +
    'with two "because the two anchors are genuinely different dates and conflating ' +
    'them is a silent liability change of 40 percent (EC-039)", so the two are ' +
    'checked separately rather than as one.',
  'SD-03/effective-not-before-basis':
    'DERIVED ACROSS TWO CONSTRAINTS, and it is stated as derived rather than cited ' +
    'as written because `SettlementFact` carries no settled day to check directly. ' +
    '`0010_payouts.sql` gives `payout_requests_effective_after_settled` ' +
    '(`effective_trading_day >= settled_trading_day`), and `basis_trading_day` is ' +
    '"the LAST CLOSED DAY the decision used", which a settlement cannot precede. ' +
    'Transitively `effective >= basis`. Under ADR-019 the wallet leg is instant and ' +
    'the two can COINCIDE, so the comparison is `>=` and never `>`.',
  'R-10/adjustment-lands-on-the-effective-day':
    'M01 R-10 and SD-01: the adjustment is "applied at the OPEN of this day", never ' +
    'inside a session. `0010_payouts.sql`: the effective day is "the FIRST TRADING ' +
    'DAY WHOSE OPENING BALANCE REFLECTS THE WITHDRAWAL ... which is half of why a ' +
    'settled payout can never breach the account that earned it (INV-21)". ' +
    '`day-sequence.ts` names this the one thing a settlement leaves on the day.',
  'R-49/ladder-bounds-the-count':
    'M01 R-49: `payoutsSettledCount >= payouts_to_graduate` graduates the account ' +
    'and closes it, so no settlement follows. ADR-030 rules the canonical field ' +
    'name is `max_payouts` (DATA_MODEL section 11), which is what `plan-config.ts` ' +
    'carries and what CV-14 keys off.',
  'INV-17/lifetime-bound':
    'M01 INV-17: "Lifetime settled extraction per account <= `ladder_count * max ' +
    'cap in the schedule`", the liability bound. STRATEGY PT-08 asserts the same ' +
    'number as a property, noting that since ADR-025 the schedule has one step.',
  'INV-02':
    'M01 INV-02: "All money is integer cents at every boundary." Checked here as ' +
    '`Number.isSafeInteger`, which is the property that fails first when a float ' +
    'reaches a financial path (`validate-day-sequence.ts` states the same rule for ' +
    'the mark).',
};

export interface SsViolation {
  readonly id: SsRuleId;
  /** Where it was found, so a shrunk counterexample says which settlement. */
  readonly path: string;
  readonly detail: string;
}

/**
 * Money fields, by name, so INV-02 is one loop rather than five copies of one
 * comparison. The list is the contract: a field added to `SettlementFact` and
 * not added here is a money field nothing checks.
 */
const MONEY_FIELDS = [
  'requestedCents',
  'approvedCents',
  'traderCents',
  'firmCents',
] as const satisfies readonly (keyof SettlementFact)[];

/**
 * R-42's cap resolution, re-derived from M01 rather than imported from
 * `src/payout/clamp.ts`, per this file's header.
 *
 * "The `cap_cents` of the LAST schedule entry whose `from_ordinal <= ordinal`."
 * The scan is deliberate: DATA_MODEL section 11 makes the schedule an array
 * from day one, and ADR-025 leaving it with a single step today is a fact about
 * the v1 lineup rather than about the shape.
 */
export function capForOrdinal(plan: MaterializedPlan, ordinal: number): number {
  let cap = 0;
  for (const step of plan.phase_funded.payout_cap_schedule) {
    if (step.from_ordinal <= ordinal) cap = step.cap_cents;
  }
  return cap;
}

/**
 * R-44's ceiling, re-derived. `(approved * split_bp + 9999) / 10000` in integer
 * division, which is the trader-favouring rounding M01 states and the published
 * copy repeats.
 */
export function traderLeg(approvedCents: number, splitBp: number): number {
  return Math.floor((approvedCents * splitBp + 9999) / 10000);
}

/**
 * Every rule above, evaluated against one sequence.
 *
 * Returns every violation rather than the first, for `validate-plan.ts`'s
 * reason: a sequence with three defects must not take three runs to diagnose.
 *
 * DAY COMPARISONS ARE STRING COMPARISONS THROUGHOUT, inherited from
 * `validate-day-sequence.ts` and for its reason: a zero-padded ISO day compares
 * lexicographically in exactly chronological order, so the oracle performs NO
 * date arithmetic at all. An oracle that parsed days into instants would be a
 * second implementation of the thing B4 #1 forbids the engine from doing,
 * sitting in the file that judges whether the engine's inputs are well formed.
 */
export function validateSettlementSequence(seq: SettlementSequence): readonly SsViolation[] {
  const out: SsViolation[] = [];

  checkOrdinals(seq, out);
  checkAmounts(seq, out);
  checkDays(seq, out);
  checkLifetime(seq, out);

  return out;
}

function checkOrdinals(seq: SettlementSequence, out: SsViolation[]): void {
  seq.settlements.forEach((s, i) => {
    if (i === 0 && s.ordinal !== 1) {
      out.push({
        id: 'R-45/ordinal-starts-at-one',
        path: `settlements[0]`,
        detail: `the first settlement carries ordinal ${s.ordinal}; payoutsSettledCount is 0 before it, so R-45 makes it 1`,
      });
    }
    if (i > 0) {
      const expected = (seq.settlements[i - 1]?.ordinal ?? 0) + 1;
      if (s.ordinal !== expected) {
        out.push({
          id: 'R-45/ordinal-is-consecutive',
          path: `settlements[${i}]`,
          detail: `ordinal ${s.ordinal} follows ${expected - 1}; R-45 makes it ${expected}, because a settled payout advances payoutsSettledCount by exactly one`,
        });
      }
    }
  });
}

function checkAmounts(seq: SettlementSequence, out: SsViolation[]): void {
  const plan = seq.days.plan;
  const funded = plan.phase_funded;

  seq.settlements.forEach((s, i) => {
    const path = `settlements[${i}]`;

    for (const field of MONEY_FIELDS) {
      if (!Number.isSafeInteger(s[field])) {
        out.push({
          id: 'INV-02',
          path: `${path}.${field}`,
          detail: `${String(s[field])} is not a safe integer number of cents`,
        });
      }
    }

    const cap = capForOrdinal(plan, s.ordinal);
    if (s.approvedCents > cap) {
      out.push({
        id: 'R-42/approved-within-cap',
        path,
        detail: `approvedCents ${s.approvedCents} exceeds the ordinal-${s.ordinal} cap of ${cap}`,
      });
    }

    if (s.approvedCents < funded.min_payout_cents) {
      out.push({
        id: 'R-43/approved-at-least-the-minimum',
        path,
        detail: `approvedCents ${s.approvedCents} is below min_payout_cents ${funded.min_payout_cents}, so R-43 would not have found it eligible`,
      });
    }

    if (s.approvedCents > s.requestedCents) {
      out.push({
        id: 'payout_requests_approved_within_requested',
        path,
        detail: `approvedCents ${s.approvedCents} exceeds requestedCents ${s.requestedCents}; the clamp can only reduce`,
      });
    }

    if (s.traderCents + s.firmCents !== s.approvedCents) {
      out.push({
        id: 'payout_requests_split_sums',
        path,
        detail: `traderCents ${s.traderCents} + firmCents ${s.firmCents} is ${s.traderCents + s.firmCents}, not approvedCents ${s.approvedCents}`,
      });
    }

    const expectedTrader = traderLeg(s.approvedCents, funded.split_bp);
    if (s.traderCents !== expectedTrader) {
      out.push({
        id: 'R-44/remainder-favours-the-trader',
        path,
        detail: `traderCents ${s.traderCents}; R-44's ceiling at split_bp ${funded.split_bp} gives ${expectedTrader}`,
      });
    }
  });
}

function checkDays(seq: SettlementSequence, out: SsViolation[]): void {
  const sessions = new Set(seq.days.calendar.days.map((d) => d.tradingDay));
  const markByDay = new Map(seq.days.marks.map((m) => [m.tradingDay, m]));

  seq.settlements.forEach((s, i) => {
    const path = `settlements[${i}]`;

    if (!sessions.has(s.basisTradingDay)) {
      out.push({
        id: 'R-46/basis-day-is-a-session',
        path: `${path}.basisTradingDay`,
        detail: `${s.basisTradingDay} is not a session in the calendar, so it is not a day that closed`,
      });
    }
    if (!sessions.has(s.effectiveTradingDay)) {
      out.push({
        id: 'R-46/effective-day-is-a-session',
        path: `${path}.effectiveTradingDay`,
        detail: `${s.effectiveTradingDay} is not a session in the calendar, so R-37 cannot subtract its sequence`,
      });
    }

    if (s.effectiveTradingDay < s.basisTradingDay) {
      out.push({
        id: 'SD-03/effective-not-before-basis',
        path,
        detail: `effectiveTradingDay ${s.effectiveTradingDay} precedes basisTradingDay ${s.basisTradingDay}; the balance cannot reflect a withdrawal decided later`,
      });
    }

    const mark = markByDay.get(s.effectiveTradingDay);
    if (mark !== undefined && mark.adjustmentCents > -s.approvedCents) {
      out.push({
        id: 'R-10/adjustment-lands-on-the-effective-day',
        path: `${path}.effectiveTradingDay`,
        detail: `the mark for ${s.effectiveTradingDay} carries adjustmentCents ${mark.adjustmentCents}, which does not account for a withdrawal of ${s.approvedCents}`,
      });
    }

    if (i > 0) {
      const prior = seq.settlements[i - 1];
      if (prior !== undefined && s.basisTradingDay <= prior.basisTradingDay) {
        out.push({
          id: 'R-46/anchors-advance',
          path: `${path}.basisTradingDay`,
          detail: `${s.basisTradingDay} does not advance past the prior payout anchor ${prior.basisTradingDay}`,
        });
      }
      if (prior !== undefined && s.effectiveTradingDay <= prior.effectiveTradingDay) {
        out.push({
          id: 'R-46/anchors-advance',
          path: `${path}.effectiveTradingDay`,
          detail: `${s.effectiveTradingDay} does not advance past the prior cadence anchor ${prior.effectiveTradingDay}`,
        });
      }
    }
  });
}

function checkLifetime(seq: SettlementSequence, out: SsViolation[]): void {
  const funded = seq.days.plan.phase_funded;

  if (seq.settlements.length > funded.max_payouts) {
    out.push({
      id: 'R-49/ladder-bounds-the-count',
      path: 'settlements',
      detail: `${seq.settlements.length} settlements against max_payouts ${funded.max_payouts}; R-49 graduates and closes the account at the ladder, so no settlement follows it`,
    });
  }

  const lifetime = seq.settlements.reduce((sum, s) => sum + s.approvedCents, 0);
  const maxCap = funded.payout_cap_schedule.reduce((max, s) => Math.max(max, s.cap_cents), 0);
  const bound = funded.max_payouts * maxCap;

  if (lifetime > bound) {
    out.push({
      id: 'INV-17/lifetime-bound',
      path: 'settlements',
      detail: `lifetime settled ${lifetime} exceeds the INV-17 bound of ${bound} (max_payouts ${funded.max_payouts} * max cap ${maxCap})`,
    });
  }
}

/** The whole contract as one predicate, for the callers that only need the verdict. */
export const isValidSettlementSequence = (seq: SettlementSequence): boolean =>
  validateSettlementSequence(seq).length === 0;
