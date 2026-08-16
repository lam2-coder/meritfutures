// =============================================================================
// packages/rules-engine/test/generators/validate-day-sequence.ts
// =============================================================================
// WHAT MAKES A DAY SEQUENCE WELL FORMED, TRANSCRIBED FROM THE DOCUMENTS AND THE
// MIGRATION AND FROM NOWHERE ELSE.
//
// THIS FILE IS THE ORACLE AND IT IS DELIBERATELY NOT THE GENERATOR.
// `day-sequence.ts` builds valid sequences by CONSTRUCTION; this file checks
// them by READING. If one module did both, the counterfactual in
// `day-sequence.property.test.ts` would prove only that the code agrees with
// itself, which is `validate-plan.ts`'s argument one file over and the shape
// this repository has now caught repeatedly: the `CHECK` that evaluated to
// `NULL` (ADR-035), the `DO` block that read a prefix of the schema (OI-08),
// the probe whose successes were rolled back before its deferred trigger fired,
// the harness that read `tee`'s exit status instead of `psql`'s, and `CI-06k`'s
// first run reading a legend as data.
//
// -----------------------------------------------------------------------------
// EVERY RULE ID IS A CITATION, AND THAT IS WHY THERE IS NO NEW `XX-nn` SERIES
// -----------------------------------------------------------------------------
// `validate-plan.ts` could key its rules by `CV-nn` because M01 ships a CV
// table. There is no equivalent table for the shape of a day sequence: the
// constraints live in M01's invariant list, in M01's DO-1 preconditions, in the
// rule taxonomy, in an approved edge case, in ADR-046 and in four named `CHECK`
// constraints on `daily_marks`.
//
// So the rule id IS the primary source, spelled the way that source spells it,
// with a slash-suffixed clause name where one source states more than one
// clause. A reader resolves every id below to a file and a line, and an
// invented series would have cost that. `DS-nn` was considered and rejected on
// sight: this corpus already carries `SD-nn` for the schema deltas and two
// identifier series one transposition apart is a footgun with no upside.
//
// -----------------------------------------------------------------------------
// THE STORED CLOSING IDENTITY IS EXPORTED SEPARATELY, AND IT NO LONGER CONFLICTS
// -----------------------------------------------------------------------------
// `checkStoredClosingIdentity` transcribes the CHECK the database actually
// carries. Until EC-157 was ruled that was `0014`'s
// `daily_marks_balance_arithmetic`, which COULD NOT be satisfied at the same
// time as INV-18 and INV-19 unless `adjustment_cents` was zero, and the
// property test watched every non-zero-adjustment mark violate it.
//
// EC-157 IS RULED (REPAIR A, 2026-08-16) and `0036` supersedes that constraint
// with INV-19 alone. The same test now watches those marks PASS. It is kept,
// rather than deleted as redundant, because it is the thing that fails if a
// later migration reintroduces the adjustment into the closing identity.
// =============================================================================

import type { CalendarDay, DailyMark, DaySequence } from './day-input.js';

export type DsRuleId =
  // ADR-046: the coverage interval the slice declares.
  | 'ADR-046/inside-coverage'
  // M01 R-02 and `CalendarDay.sequence`.
  | 'R-02/calendar-is-ordered'
  | 'R-02/sequence-is-dense'
  // M01 DO-1's preconditions.
  | 'DO-1/day-is-a-session'
  | 'DO-1/day-advances'
  // EC-047's completeness check.
  | 'EC-047/one-mark-per-open-day'
  // M01 section 1.5's mark identities.
  | 'INV-20'
  | 'INV-18'
  | 'INV-19'
  | 'INV-02'
  // `0014_marks.sql`, by the constraint's own name.
  | 'daily_marks_high_bounds_day'
  | 'daily_marks_low_bounds_day'
  | 'daily_marks_traded_day_matches_fills'
  | 'daily_marks_win_day_implies_traded'
  // M01 R-08 and R-09, which are what those two columns MEAN.
  | 'R-08/fill-count-non-negative'
  | 'R-09/win-day-matches-pnl';

/** Every rule id, in order, so a caller can iterate the contract rather than retype it. */
export const DS_RULE_IDS: readonly DsRuleId[] = [
  'ADR-046/inside-coverage',
  'R-02/calendar-is-ordered',
  'R-02/sequence-is-dense',
  'DO-1/day-is-a-session',
  'DO-1/day-advances',
  'EC-047/one-mark-per-open-day',
  'INV-20',
  'INV-18',
  'INV-19',
  'INV-02',
  'daily_marks_high_bounds_day',
  'daily_marks_low_bounds_day',
  'daily_marks_traded_day_matches_fills',
  'daily_marks_win_day_implies_traded',
  'R-08/fill-count-non-negative',
  'R-09/win-day-matches-pnl',
];

/**
 * Where each rule is written down, quoted closely enough that a reader can
 * check the transcription without opening four files, and precisely enough that
 * they can open the right one when they want to.
 *
 * `Record<DsRuleId, string>` rather than a list, so the COMPILER refuses a rule
 * added above without a source added here. A citation table that can silently
 * fall behind the thing it cites is the defect ADR-034 exists to end.
 */
export const DS_RULE_SOURCES: Record<DsRuleId, string> = {
  'ADR-046/inside-coverage':
    'ADR-046: the slice carries "a declared coverage interval"; a day outside it is ' +
    'UNKNOWN rather than not-a-trading-day (ADR-042 F-4, 0032). The golden loader ' +
    'enforces the same shape on the fixture calendar as L-08.',
  'R-02/calendar-is-ordered':
    'ADR-046: "a frozen ORDERED array of CalendarDay". M01 section 2.1 makes ' +
    '`sequence` a dense index into that order.',
  'R-02/sequence-is-dense':
    'M01 section 2.1: `sequence` is a "dense index into the calendar; gap counting ' +
    'is subtraction, never date math". M01 R-02 counts by `calendar.sequence` ' +
    'subtraction, which is arithmetic only a dense index makes true.',
  'DO-1/day-is-a-session':
    'M01 section 3.1 DO-1: reject unless "`mark.tradingDay` is a calendar trading day".',
  'DO-1/day-advances':
    'M01 section 3.1 DO-1: reject unless "`mark.tradingDay` > `prior.tradingDay`". ' +
    'The same strictness is INV-14 idempotence at the storage layer: ' +
    '`daily_marks_live_per_account_day_uq` is one live mark per account per day.',
  'EC-047/one-mark-per-open-day':
    'EC-047: "every `active` account must have exactly one live mark per trading day ' +
    'it was open"; a missing mark is a reconciliation alarm and is never treated as a ' +
    'flat day.',
  'INV-20':
    'M01 INV-20: "the first funded mark opens at exactly `size_cents`", asserted at ' +
    'DO-3. EC-041: the engine "asserts `first funded mark.opening_balance_cents == ' +
    'size_cents` and refuses the day ... rather than computing on it".',
  'INV-18':
    'M01 INV-18: "`mark.opening_balance_cents == prior.balance_cents + ' +
    'mark.adjustment_cents`", asserted at DO-3. EC-034 states it in the same words, ' +
    'and R-10 puts the movement at the OPEN of the effective trading day, never ' +
    'inside a session.',
  'INV-19':
    'M01 INV-19: "`mark.closing_balance_cents == mark.opening_balance_cents + ' +
    'mark.realized_pnl_cents`", asserted at DO-3. EC-034 states it in the same words.',
  'INV-02':
    'M01 INV-02: "all money is `bigint` integer cents at every boundary". The ' +
    'constitution: "Money is integer cents ... No floats in financial paths." ' +
    'Asserted here as a safe integer, which is what `bigint` buys and what `number` ' +
    'does not enforce on its own.',
  daily_marks_high_bounds_day:
    '`0014_marks.sql`: CHECK (high_balance_cents >= greatest(opening_balance_cents, ' +
    'closing_balance_cents)). "The high and low bound the day they describe."',
  daily_marks_low_bounds_day:
    '`0014_marks.sql`: CHECK (low_balance_cents <= least(opening_balance_cents, ' +
    'closing_balance_cents)).',
  daily_marks_traded_day_matches_fills:
    '`0014_marks.sql`: CHECK (traded_day = (fill_count > 0)). M01 R-08 is the same ' +
    'predicate with the strict `>` called out.',
  daily_marks_win_day_implies_traded:
    '`0014_marks.sql`: CHECK (win_day = false OR traded_day = true). "A day with no ' +
    'fills cannot clear a profit floor, and a win day recorded on an untraded day is ' +
    'a counter that advanced for free."',
  'R-08/fill-count-non-negative':
    '`0014_marks.sql`: `fill_count integer NOT NULL DEFAULT 0 CHECK (fill_count >= ' +
    '0)`. M01 R-08 reads the same column as `fill_count > 0`.',
  'R-09/win-day-matches-pnl':
    'M01 R-09: `realized_pnl_cents >= win_day_floor_cents` ("`>=`, so exactly at the ' +
    'floor counts"), evaluated "against the pinned version, never against a current ' +
    'parameter" (`0014`, `daily_marks.win_day`).',
};

export interface DsViolation {
  readonly id: DsRuleId;
  /** Where it was found, so a shrunk counterexample says which day. */
  readonly path: string;
  readonly detail: string;
}

/**
 * Money fields, by name, so INV-02 is one loop rather than six copies of one
 * comparison. The list is the contract: a field added to `DailyMark` and not
 * added here is a money field nothing checks.
 */
const MONEY_FIELDS = [
  'openingBalanceCents',
  'closingBalanceCents',
  'highBalanceCents',
  'lowBalanceCents',
  'realizedPnlCents',
  'adjustmentCents',
] as const satisfies readonly (keyof DailyMark)[];

/**
 * Every rule above, evaluated against one sequence.
 *
 * Returns every violation rather than the first, for `validate-plan.ts`'s
 * reason: a sequence with three defects must not take three runs to diagnose.
 *
 * DAY COMPARISONS ARE STRING COMPARISONS THROUGHOUT, and that is deliberate
 * rather than lazy. A zero-padded ISO day compares lexicographically in exactly
 * chronological order, so the oracle performs NO date arithmetic at all. An
 * oracle that parsed days into instants would be a second implementation of the
 * thing B4 #1 forbids the engine from doing, sitting in the file that judges
 * whether the engine's inputs are well formed.
 */
export function validateDaySequence(seq: DaySequence): readonly DsViolation[] {
  const out: DsViolation[] = [];
  const days = seq.calendar.days;
  const marks = seq.marks;
  const { from, to } = seq.calendar.coverage;

  checkCalendar(days, from, to, out);
  checkMarkDays(days, marks, out);
  checkMarkArithmetic(seq, out);

  return out;
}

function checkCalendar(
  days: readonly CalendarDay[],
  from: string,
  to: string,
  out: DsViolation[],
): void {
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;

    // ADR-046/inside-coverage. A session the calendar declares and its own
    // coverage disowns makes the coverage interval meaningless: every lookup
    // for that day would be a refusal against a day the same file lists.
    if (day.tradingDay < from || day.tradingDay > to) {
      out.push({
        id: 'ADR-046/inside-coverage',
        path: `calendar.days[${i}].tradingDay`,
        detail: `session ${day.tradingDay} is outside the declared coverage ${from}..${to}`,
      });
    }

    if (i === 0) continue;
    const prev = days[i - 1]!;

    // R-02/calendar-is-ordered.
    if (!(day.tradingDay > prev.tradingDay)) {
      out.push({
        id: 'R-02/calendar-is-ordered',
        path: `calendar.days[${i}].tradingDay`,
        detail: `${day.tradingDay} does not follow ${prev.tradingDay}`,
      });
    }

    // R-02/sequence-is-dense. Checked against the PREVIOUS row rather than
    // against `days[0].sequence + i`, so a single break reports at the row it
    // happens on instead of at every row after it.
    if (day.sequence !== prev.sequence + 1) {
      out.push({
        id: 'R-02/sequence-is-dense',
        path: `calendar.days[${i}].sequence`,
        detail: `sequence ${day.sequence} does not follow ${prev.sequence} by exactly one`,
      });
    }
  }

  if (days.length > 0 && !Number.isSafeInteger(days[0]!.sequence)) {
    out.push({
      id: 'R-02/sequence-is-dense',
      path: 'calendar.days[0].sequence',
      detail: `sequence ${days[0]!.sequence} is not a safe integer`,
    });
  }
}

function checkMarkDays(
  days: readonly CalendarDay[],
  marks: readonly DailyMark[],
  out: DsViolation[],
): void {
  const sessions = new Set(days.map((d) => d.tradingDay));

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!;

    // DO-1/day-is-a-session.
    if (!sessions.has(mark.tradingDay)) {
      out.push({
        id: 'DO-1/day-is-a-session',
        path: `marks[${i}].tradingDay`,
        detail: `${mark.tradingDay} is not a session the calendar declares`,
      });
    }

    // DO-1/day-advances. Strict, so a repeated day is a finding: two live
    // marks on one day is what INV-14 and the partial unique index both refuse.
    if (i > 0 && !(mark.tradingDay > marks[i - 1]!.tradingDay)) {
      out.push({
        id: 'DO-1/day-advances',
        path: `marks[${i}].tradingDay`,
        detail: `${mark.tradingDay} does not advance on ${marks[i - 1]!.tradingDay}`,
      });
    }
  }

  // EC-047/one-mark-per-open-day. Stated over the SET of mark days and bounded
  // by their own minimum and maximum, so it says nothing about when the account
  // opened or closed: only that it has no hole while it was open. `min` and
  // `max` rather than `marks[0]` and `marks[at(-1)]` so a sequence that is out
  // of order is judged on its days rather than on its ordering, which is
  // DO-1/day-advances' finding and not this one's.
  if (marks.length > 0) {
    const marked = new Set(marks.map((m) => m.tradingDay));
    let lo = marks[0]!.tradingDay;
    let hi = marks[0]!.tradingDay;
    for (const mark of marks) {
      if (mark.tradingDay < lo) lo = mark.tradingDay;
      if (mark.tradingDay > hi) hi = mark.tradingDay;
    }
    for (const day of days) {
      if (day.tradingDay >= lo && day.tradingDay <= hi && !marked.has(day.tradingDay)) {
        out.push({
          id: 'EC-047/one-mark-per-open-day',
          path: 'marks',
          detail: `session ${day.tradingDay} falls inside the run ${lo}..${hi} and has no mark`,
        });
      }
    }
  }
}

function checkMarkArithmetic(seq: DaySequence, out: DsViolation[]): void {
  const marks = seq.marks;
  const sizeCents = seq.plan.size_cents;
  const winDayFloorCents = seq.plan.phase_funded.win_days.win_day_floor_cents;

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!;
    const at = `marks[${i}]`;

    // INV-02, before anything that compares these numbers. A fractional cent
    // makes every equality below true or false for reasons that have nothing to
    // do with the rule being checked.
    for (const field of MONEY_FIELDS) {
      if (!Number.isSafeInteger(mark[field])) {
        out.push({
          id: 'INV-02',
          path: `${at}.${field}`,
          detail: `${field} is ${mark[field]}, which is not a safe integer number of cents`,
        });
      }
    }

    if (i === 0) {
      // INV-20. The sequence is one account's run FROM ITS OPEN, so the first
      // mark is the account's first and opens at the plan's size. INV-18 does
      // not apply here: `DayInput.prior` is "null only on the account's first
      // trading day", so there is no prior balance to add the adjustment to.
      if (mark.openingBalanceCents !== sizeCents) {
        out.push({
          id: 'INV-20',
          path: `${at}.openingBalanceCents`,
          detail: `the account's first mark opens at ${mark.openingBalanceCents}, not size_cents ${sizeCents}`,
        });
      }
    } else {
      // INV-18. The adjustment lands at the OPEN, between sessions (R-10), so
      // it is on this side of the equals sign and not inside the day.
      const prior = marks[i - 1]!;
      const expected = prior.closingBalanceCents + mark.adjustmentCents;
      if (mark.openingBalanceCents !== expected) {
        out.push({
          id: 'INV-18',
          path: `${at}.openingBalanceCents`,
          detail: `opening ${mark.openingBalanceCents} is not prior closing ${prior.closingBalanceCents} plus adjustment ${mark.adjustmentCents} (${expected})`,
        });
      }
    }

    // INV-19.
    const expectedClose = mark.openingBalanceCents + mark.realizedPnlCents;
    if (mark.closingBalanceCents !== expectedClose) {
      out.push({
        id: 'INV-19',
        path: `${at}.closingBalanceCents`,
        detail: `closing ${mark.closingBalanceCents} is not opening ${mark.openingBalanceCents} plus realized pnl ${mark.realizedPnlCents} (${expectedClose})`,
      });
    }

    // daily_marks_high_bounds_day and daily_marks_low_bounds_day.
    const top = Math.max(mark.openingBalanceCents, mark.closingBalanceCents);
    const bottom = Math.min(mark.openingBalanceCents, mark.closingBalanceCents);
    if (!(mark.highBalanceCents >= top)) {
      out.push({
        id: 'daily_marks_high_bounds_day',
        path: `${at}.highBalanceCents`,
        detail: `high ${mark.highBalanceCents} is below the day it describes (${top})`,
      });
    }
    if (!(mark.lowBalanceCents <= bottom)) {
      out.push({
        id: 'daily_marks_low_bounds_day',
        path: `${at}.lowBalanceCents`,
        detail: `low ${mark.lowBalanceCents} is above the day it describes (${bottom})`,
      });
    }

    // R-08/fill-count-non-negative.
    if (!Number.isSafeInteger(mark.fillCount) || mark.fillCount < 0) {
      out.push({
        id: 'R-08/fill-count-non-negative',
        path: `${at}.fillCount`,
        detail: `fillCount is ${mark.fillCount}`,
      });
    }

    // daily_marks_traded_day_matches_fills.
    if (mark.tradedDay !== mark.fillCount > 0) {
      out.push({
        id: 'daily_marks_traded_day_matches_fills',
        path: `${at}.tradedDay`,
        detail: `tradedDay is ${mark.tradedDay} with fillCount ${mark.fillCount}`,
      });
    }

    // daily_marks_win_day_implies_traded.
    if (mark.winDay && !mark.tradedDay) {
      out.push({
        id: 'daily_marks_win_day_implies_traded',
        path: `${at}.winDay`,
        detail: 'a win day on a day with no fills is a counter that advanced for free',
      });
    }

    // R-09/win-day-matches-pnl, CONDITIONAL ON THE DAY BEING TRADED, and the
    // condition is what keeps this rule and the one above from being one rule
    // written twice. R-09 defines the flag as `realized_pnl >= floor`;
    // `daily_marks_win_day_implies_traded` overrides it to `false` on an
    // untraded day. Stated unconditionally, this rule would demand `true` on an
    // untraded day whose pnl cleared the floor and the constraint above would
    // demand `false`, and no mark could satisfy both.
    if (mark.tradedDay) {
      const shouldWin = mark.realizedPnlCents >= winDayFloorCents;
      if (mark.winDay !== shouldWin) {
        out.push({
          id: 'R-09/win-day-matches-pnl',
          path: `${at}.winDay`,
          detail: `winDay is ${mark.winDay} with realized pnl ${mark.realizedPnlCents} against the pinned floor ${winDayFloorCents}`,
        });
      }
    }
  }
}

/**
 * `0036_supersede_daily_marks_balance_arithmetic.sql`'s
 * `daily_marks_inv19_closing_identity`, transcribed verbatim:
 *
 *   CHECK (closing_balance_cents = opening_balance_cents + realized_pnl_cents)
 *
 * EC-157 IS RULED: REPAIR A, 2026-08-16. THE CONSTRAINT WAS WRONG AND THE
 * INVARIANTS WERE RIGHT.
 *
 * `0014` carried `closing = opening + realized_pnl + adjustment`, which added
 * the adjustment a SECOND time, inside the day. INV-18 has already put it
 * before the open (`opening = prior.closing + adjustment`, and R-10 puts the
 * movement "at the open ... never inside a session"). Worked, in integer cents,
 * on the case SD-01 was added for:
 *
 *   prior closing 5,000,000; a settled payout of 250,000; the day makes 30,000
 *   INV-18       -> opening = 5,000,000 - 250,000            = 4,750,000
 *   INV-19       -> closing = 4,750,000 + 30,000             = 4,780,000
 *   0014's CHECK -> closing = 4,750,000 + 30,000 - 250,000   = 4,530,000
 *
 * The database refused the row the two invariants require, so the mark for
 * every settled payout was unwritable as specified. `0036` drops that
 * constraint and adds INV-19 alone, which is the half a CHECK can see: INV-18
 * reads `prior.balance`, which lives in `rule_states`, and a CHECK cannot see
 * across rows. INV-18 is asserted by M02 before the engine sees the mark
 * (INV-M2-06) and by the engine at DO-3 (R-07).
 *
 * THE OLD NAME IS GONE RATHER THAN REDEFINED, so a reader who greps for
 * `daily_marks_balance_arithmetic` finds nothing rather than finding a
 * statement whose meaning changed underneath it. Both `0014`'s comment and the
 * `daily_marks` design record labelled it "INV-18" and it was neither identity,
 * which is how the wrong arithmetic became the authoritative one.
 */
export function checkStoredClosingIdentity(mark: DailyMark): boolean {
  return mark.closingBalanceCents === mark.openingBalanceCents + mark.realizedPnlCents;
}

/** Convenience for the common assertion. */
export const isValidDaySequence = (seq: DaySequence): boolean =>
  validateDaySequence(seq).length === 0;
