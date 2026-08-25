// =============================================================================
// packages/rules-engine/test/generators/day-input.ts
// =============================================================================
// THE SHAPE OF A DAY SEQUENCE, transcribed from M01 section 2.1 and from the
// columns `0014_marks.sql` actually declares.
//
// `plan-config.ts` does this job for the config contract one file over and the
// argument is the same one: M01 is the specification, `src/types.ts` is the
// scaffold's deliberate subset of it ("THE FIELD SETS BELOW ARE THE SCAFFOLD'S,
// NOT M01's ... the rest of each record is M01's to add when the engine is
// built"), and a generator needs the full shape before the engine that will
// consume it exists.
//
// -----------------------------------------------------------------------------
// WHAT `CalendarSource` IS, AND WHY IT IS DELIBERATELY NOT `CalendarSlice`
// -----------------------------------------------------------------------------
// ADR-049 rules that `CalendarSlice` is A VALUE: "a frozen ordered array of
// `CalendarDay` plus a precomputed index and a declared coverage interval,
// BUILT BY A PURE EXPORTED CONSTRUCTOR, with the calendar queries as free
// functions in `calendar.ts` over that value."
//
// That constructor is engine code and this session writes none. So this file
// declares the constructor's INPUT -- the ordered days and the declared
// coverage -- and stops there. The precomputed index is the constructor's own
// business, and a generator that guessed at its shape would be rewritten on the
// day `calendar.ts` lands, which is the exact cost the deferral from PR #39 was
// paid to avoid.
//
// The coverage interval is carried here rather than left implicit because it is
// the half of ADR-049 that is load bearing: a day INSIDE coverage that is not a
// session is positively not a trading day, and a day OUTSIDE coverage is
// UNKNOWN. Those two answers differ and only one of them is safe to act on
// (ADR-042 F-4, `0032`, and the loader's L-08 on the fixture calendar).
//
// -----------------------------------------------------------------------------
// CENTS ARE `number` HERE, AND M01 SAYS `bigint`
// -----------------------------------------------------------------------------
// M01 section 2.1 declares `type Cents = bigint` and INV-02 says "all money is
// `bigint` integer cents at every boundary". The tree does not: `src/types.ts`
// ships `Cents = number & { __brand }` and `plan-config.ts` carries every cents
// field as `number`.
//
// This file follows the tree rather than introducing a THIRD spelling, because
// a generator whose `size_cents` is a `bigint` cannot be compared against a
// plan whose `size_cents` is a `number` without a cast at every call site, and a
// cast at every call site is where a units bug hides. The divergence is real and
// is recorded in the session log rather than silently absorbed.
//
// What `bigint` would have bought is bought mechanically instead:
// `INV-02` in `validate-day-sequence.ts` asserts every money field is a SAFE
// integer, which is the property that fails first when a float reaches a
// financial path.
// =============================================================================

import type { MaterializedPlan } from './plan-config.ts';

/**
 * "YYYY-MM-DD", an exchange trading day, never a UTC date (M01 section 2.1,
 * DATA_MODEL B4 #1).
 *
 * It is a string rather than a branded type because every comparison this
 * module and its oracle perform is a LEXICOGRAPHIC one, which on a zero-padded
 * ISO day is exactly chronological order and is the only day comparison in this
 * package that involves no arithmetic at all.
 */
export type TradingDay = string;

/**
 * One row of the trading calendar. M01 section 2.1, verbatim.
 *
 * `sequence` is a "dense index into the calendar; gap counting is subtraction,
 * never date math" (R-02). It is the calendar's own index and NOT the position
 * of this row inside whatever window a caller loaded, which is why the
 * generator draws a non-zero base for it.
 */
export interface CalendarDay {
  readonly tradingDay: TradingDay;
  /** R-03: a half day is a full trading day for every counter. */
  readonly isHalfDay: boolean;
  /** R-04: on a halted session, day counters advance and win days do not. */
  readonly halted: boolean;
  readonly sequence: number;
}

/**
 * The input to ADR-049's `CalendarSlice` constructor: the ordered days, and the
 * interval the calendar declares it can answer for.
 *
 * A day outside `coverage` is UNKNOWN, and under ADR-049 a lookup that lands
 * there returns a typed refusal into `DayOutput.assertions` rather than
 * throwing or returning null.
 */
export interface CalendarSource {
  readonly days: readonly CalendarDay[];
  readonly coverage: { readonly from: TradingDay; readonly to: TradingDay };
}

/**
 * One live row of `daily_marks`, which is "the only input the rules engine
 * reads" (`0014_marks.sql`).
 *
 * TWO FIELDS ARE HERE THAT M01 SECTION 2.1's `DailyMark` DOES NOT LIST, and the
 * omission is M01's rather than this file's. That block is introduced as
 * "exactly the live row from daily_marks" and then leaves out `traded_day` and
 * `win_day`, which `0014` stores, constrains twice
 * (`daily_marks_traded_day_matches_fills`, `daily_marks_win_day_implies_traded`)
 * and justifies storing: "stored rather than derived because the engine reads it
 * on every day of every account". A generator that emitted the block literally
 * would emit a row the database cannot hold. The drift is recorded in the
 * session log; this file follows the migration, which is the merged artifact.
 *
 * SUPERSEDED MARKS ARE NOT MODELLED. R-11: "the engine reads only live marks",
 * `superseded_by is null`. A correction supersedes and replay recomputes
 * forward, so a sequence is a stream of live rows by construction.
 */
export interface DailyMark {
  readonly tradingDay: TradingDay;
  readonly openingBalanceCents: number;
  readonly closingBalanceCents: number;
  readonly highBalanceCents: number;
  /** The breach comparison input: the day's low against the floor open at its start. */
  readonly lowBalanceCents: number;
  /** Signed, from fills only. */
  readonly realizedPnlCents: number;
  /** SD-01. Signed non-trading movement, applied at the OPEN of this day (R-10). */
  readonly adjustmentCents: number;
  readonly fillCount: number;
  /** `fill_count > 0`, by definition rather than by convention (R-08). */
  readonly tradedDay: boolean;
  /** `realized_pnl_cents >= win_day_floor_cents` at the account's PINNED plan (R-09). */
  readonly winDay: boolean;
  /** Digest of the exact input rows. Nothing in M01 or `0014` constrains its value. */
  readonly sourceHash: string;
}

/**
 * ONE ACCOUNT'S RUN, from the day it opened.
 *
 * The plan is carried because two of the sequence's rules are stated against it
 * and cannot be checked without it: INV-20 reads `size_cents` and R-09 reads
 * `win_days.win_day_floor_cents`. It is the plan the account is PINNED to
 * (INV-16), so it is one value for the whole sequence and never re-drawn
 * per day.
 *
 * WHAT IS DELIBERATELY ABSENT: `SettlementFact[]`. P2 section 5 names the
 * arbitrary settlement-sequence generator alongside this one and it is a
 * separate deliverable: a settlement carries a payout request id, an ordinal,
 * an approved amount and TWO trading days (basis and effective, SD-02/SD-03),
 * and generating those coherently means generating payout eligibility, which
 * means the engine. What a settlement leaves ON THE DAY is
 * `adjustmentCents`, and that is a column of the mark and is generated here.
 *
 * `prior: RuleState | null` is absent for the same reason it must be: it is
 * engine OUTPUT. A generator that emitted it would be asserting what the fold
 * computes.
 */
export interface DaySequence {
  readonly plan: MaterializedPlan;
  readonly calendar: CalendarSource;
  readonly marks: readonly DailyMark[];
}
