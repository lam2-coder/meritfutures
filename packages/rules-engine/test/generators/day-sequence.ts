// =============================================================================
// packages/rules-engine/test/generators/day-sequence.ts
// =============================================================================
// THE ARBITRARY DAY-SEQUENCE GENERATOR. P2 section 5: "arbitrary day sequences,
// arbitrary settlement sequences, and arbitrary plans satisfying CV-01 to
// CV-19 ... What is genuinely buildable before the engine is the expensive
// half."
//
// It was deferred from the session that built `plan.ts`, which said so in its
// own header: the day-sequence generator "depends on `DayInput`'s shape, which
// OQ-P2-01 is about to widen, and building them now means building them twice".
// ADR-049 closed OQ-P2-01, so it is built once, here.
//
// IT BUILDS VALID SEQUENCES BY CONSTRUCTION AND NEVER BY REJECTION SAMPLING,
// for `plan.ts`'s reason: `fc.filter` over a sixteen-rule contract discards
// almost every candidate, shrinks badly, and makes the generator's correctness
// an accident of the filter rather than a property of the construction.
//
// -----------------------------------------------------------------------------
// THE `omit` PARAMETER IS THE POINT, NOT A CONVENIENCE
// -----------------------------------------------------------------------------
// A generator asserted to emit only valid sequences, never watched emitting an
// invalid one, is vacuous: `fc.constant(SOME_KNOWN_GOOD_SEQUENCE)` passes that
// assertion forever. So every rule's construction step is individually
// removable, and `day-sequence.property.test.ts` watches each removal produce a
// sequence the ORACLE rejects, citing that rule AND NOTHING ELSE.
//
// When a rule is omitted the step INVERTS rather than relaxes: it draws from
// values that always violate. A relaxed step would sometimes still emit a valid
// sequence, and a counterfactual that only sometimes fires is one that will
// eventually be quarantined as flaky and deleted.
//
// -----------------------------------------------------------------------------
// WHAT THE GENERATOR KNOWS ABOUT THE CALENDAR, WHICH IS DELIBERATELY NOTHING
// -----------------------------------------------------------------------------
// It does not know what a weekend is. It does not know what a holiday is. It
// draws a first session and then draws a GAP in calendar days before each
// following session, and a weekend is simply a gap of three.
//
// That is not a shortcut, it is the mechanism. B4 #1 and R-02 say the trading
// day is data and gap counting is `calendar.sequence` subtraction, "never date
// arithmetic". A generator that emitted consecutive calendar days would let an
// engine that subtracts dates pass every property it is fed; drawing gaps makes
// that bug visible on the first run. AS-06 (calendar arbitrage around holiday
// clusters) is the adversarial version of the same fact, and the gap arbitrary
// reaches clusters of up to a week.
//
// The `sequence` base is drawn NON-ZERO for the same reason. A slice is a
// window into a longer calendar, so `days[i].sequence` is not `i`, and an
// engine that used the array index as the sequence would be invisible to a
// generator that always started at zero.
//
// -----------------------------------------------------------------------------
// SCOPE, AND WHAT IS DELIBERATELY ABSENT
// -----------------------------------------------------------------------------
// THE DAY SEQUENCE ONLY. The arbitrary SETTLEMENT-sequence generator that P2
// section 5 names alongside this one is not here: a `SettlementFact` carries an
// ordinal that is `payouts_settled_count + 1` at request time (R-45) and two
// distinct trading days (SD-02, SD-03), so generating a coherent settlement
// stream means generating payout eligibility, which means the engine. What a
// settlement leaves on the DAY is `adjustmentCents`, and that is a column of the
// mark and is drawn here.
//
// NO ENGINE CODE. `CalendarSlice`'s constructor, its precomputed index and the
// free functions ADR-049 puts in `calendar.ts` are a separate session's. This
// file emits that constructor's INPUT.
// =============================================================================

import fc from 'fast-check';

import type { CalendarDay, CalendarSource, DailyMark, DaySequence } from './day-input.ts';
import { planArbitrary } from './plan.ts';
import type { MaterializedPlan } from './plan-config.ts';
import type { DsRuleId } from './validate-day-sequence.ts';

export interface DaySequenceArbitraryOptions {
  /**
   * Rules whose construction step is INVERTED, so the emitted sequence violates
   * them. Empty in every ordinary use; non-empty only in the counterfactual.
   */
  readonly omit?: ReadonlySet<DsRuleId>;
  /**
   * The plan the account is pinned to. Drawn from `planArbitrary()` when
   * absent, which is the ordinary case: a caller that supplies one is usually a
   * `PT-nn` suite that has already drawn a plan and needs the days to agree
   * with it.
   */
  readonly plan?: MaterializedPlan;
}

const has = (omit: ReadonlySet<DsRuleId>, id: DsRuleId): boolean => omit.has(id);

// -----------------------------------------------------------------------------
// Days, as a calendar and never as a clock
// -----------------------------------------------------------------------------
// `generate.mjs` states the distinction for the seed generator and it holds
// here identically: B4 #1 forbids the ENGINE deriving a trading day from a
// timestamp at runtime. This is test material, `Date.UTC` is used as a calendar
// rather than as a clock, and the process timezone cannot reach it, which is
// what keeps this file correct under PT-06's `TZ` randomisation.
//
// The engine imports none of this. `src/` cannot even name `Date`:
// `no-restricted-globals` bans it there, and `eslint.config.js` scopes that to
// `packages/rules-engine/src/**` precisely so "a property suite generates dates
// to build inputs with" stays legal.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `daily_marks.source_hash` is `bytea` and is rendered here as the hex a client
 * sends. Nothing in M01 or `0014` constrains its value, so no rule reads it;
 * it exists because a mark that omits a `NOT NULL` column is not a mark.
 */
const HEX_DIGIT = fc.constantFrom(...'0123456789abcdef');

/** The day `n` CALENDAR days after `day`. Never asked what kind of day it lands on. */
function addCalendarDays(day: string, n: number): string {
  const m = ISO_DAY.exec(day);
  if (m === null) throw new Error(`not an ISO day: ${day}`);
  const utc = Date.UTC(Number(m[1]!), Number(m[2]!) - 1, Number(m[3]!));
  // `toISOString` renders the UTC instant, so the result cannot depend on the
  // process timezone. The slice is the date half of `YYYY-MM-DDTHH:mm:ss.sssZ`.
  return new Date(utc + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The window sessions are drawn from. An arbitrary offset into a bounded range
 * of real calendar days, so days differ between runs without the generator ever
 * asking what day of the week it produced.
 */
const firstSessionDay = (): fc.Arbitrary<string> =>
  fc.integer({ min: 0, max: 1_400 }).map((n) => addCalendarDays('2026-01-02', n));

// -----------------------------------------------------------------------------
// The counterfactual's forced minima
// -----------------------------------------------------------------------------
// SEVEN RULES CANNOT BE VIOLATED BY A SEQUENCE THAT IS TOO SMALL, and inverting
// a step whose precondition is absent proves nothing. `plan.ts` learned this the
// expensive way: two of its nineteen counterfactuals passed vacuously on the
// first run because a conditional rule's precondition was left free.
//
//   ADR-049/inside-coverage     needs two sessions, so one can fall outside
//   R-02/calendar-is-ordered    needs two sessions to put out of order
//   R-02/sequence-is-dense      needs two sequence numbers to break the step between
//   DO-1/day-advances           needs two marks to disorder
//   INV-18                      binds only on marks after the first
//   DO-1/day-is-a-session       needs two marks AND a gap, so a non-session day
//                               exists strictly between two marked sessions
//   EC-047/one-mark-per-open-day needs three marks, so the hole is INTERIOR to
//                               the run rather than a shorter run
//
// `PRECONDITIONS` in the test file is the executable copy of this list, and it
// is what fails by name if an eighth appears and nobody updates a comment.

const needsTwoSessions = (omit: ReadonlySet<DsRuleId>): boolean =>
  has(omit, 'ADR-049/inside-coverage') ||
  has(omit, 'R-02/calendar-is-ordered') ||
  has(omit, 'R-02/sequence-is-dense');

const markMinimum = (omit: ReadonlySet<DsRuleId>): number => {
  if (has(omit, 'EC-047/one-mark-per-open-day')) return 3;
  if (has(omit, 'DO-1/day-advances') || has(omit, 'DO-1/day-is-a-session') || has(omit, 'INV-18')) {
    return 2;
  }
  return 1;
};

// -----------------------------------------------------------------------------
// The sequence
// -----------------------------------------------------------------------------

/**
 * An arbitrary day sequence: one account's run of live marks over a calendar
 * window, from the day the account opened.
 *
 * With no options the emitted sequence satisfies every rule in
 * `validate-day-sequence.ts`, which `day-sequence.property.test.ts` asserts
 * against the independent oracle rather than against this module's reasoning.
 */
export function daySequenceArbitrary(
  options: DaySequenceArbitraryOptions = {},
): fc.Arbitrary<DaySequence> {
  const omit = options.omit ?? new Set<DsRuleId>();
  const planArb =
    options.plan === undefined ? planArbitrary() : fc.constant<MaterializedPlan>(options.plan);

  // DO-1/day-is-a-session is inverted by putting a mark on a day that is inside
  // the coverage and is NOT a session. Such a day exists only where two
  // sessions are more than one calendar day apart, so the gap is forced when
  // that rule is the target. Every other run draws gaps freely, and one is a
  // legal gap: consecutive sessions happen four days a week.
  const gapArb = has(omit, 'DO-1/day-is-a-session')
    ? fc.integer({ min: 2, max: 7 })
    : fc.integer({ min: 1, max: 7 });

  const minSessions = Math.max(needsTwoSessions(omit) ? 2 : 1, markMinimum(omit));

  return planArb.chain((plan) =>
    fc
      .record({
        firstDay: firstSessionDay(),
        // The base is what makes `sequence` a calendar index rather than an
        // array index. Zero stays in the support because a slice starting at
        // the calendar's first row is legal, and only that.
        sequenceBase: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 9_999 })),
        gaps: fc.array(gapArb, { minLength: minSessions - 1, maxLength: 24 }),
        halfDays: fc.array(fc.boolean(), { minLength: 25, maxLength: 25 }),
        halted: fc.array(fc.boolean(), { minLength: 25, maxLength: 25 }),
        // ADR-049's coverage is at least the span of the sessions and is often
        // wider. Both cases are reachable and both matter: coverage wider than
        // the session set is what makes a day INSIDE it "positively not a
        // trading day" rather than "unknown", which is the distinction the
        // ruling turns on.
        coverageBefore: fc.integer({ min: 0, max: 10 }),
        coverageAfter: fc.integer({ min: 0, max: 10 }),
      })
      .chain((cal) => {
        // `gaps` is drawn with `minLength: minSessions - 1`, so this is never
        // below the minimum the counterfactual needs and the gap for every
        // session after the first is always a drawn value rather than a
        // default. A default here would silently undo the forced gap that
        // DO-1/day-is-a-session's inversion depends on.
        const sessionCount = cal.gaps.length + 1;
        const days: CalendarDay[] = [];
        let day = cal.firstDay;
        for (let i = 0; i < sessionCount; i++) {
          if (i > 0) day = addCalendarDays(day, cal.gaps[i - 1]!);
          days.push({
            tradingDay: day,
            isHalfDay: cal.halfDays[i % cal.halfDays.length]!,
            halted: cal.halted[i % cal.halted.length]!,
            sequence: cal.sequenceBase + i,
          });
        }

        return fc
          .record({
            // Where the account opened inside the window, and how long it ran.
            // Drawn rather than fixed at the window's start so the generator
            // emits sessions BEFORE the account's first mark, which is the
            // ordinary case for a real slice and the one where a fold that
            // starts at `days[0]` instead of at `marks[0]` goes wrong.
            markOffset: fc.integer({ min: 0, max: Math.max(0, sessionCount - 1) }),
            markLength: fc.integer({ min: 1, max: sessionCount }),
            // Interior session to drop, and adjacent pairs to disorder. Drawn
            // unconditionally so the counterfactual shrinks like any other
            // input rather than being pinned to one position.
            holeAt: fc.integer({ min: 0, max: 1_000 }),
            markSwapAt: fc.integer({ min: 0, max: 1_000 }),
            calendarSwapAt: fc.integer({ min: 0, max: 1_000 }),
            sequenceBreakAt: fc.integer({ min: 0, max: 1_000 }),
            insertAt: fc.integer({ min: 0, max: 1_000 }),
            marks: fc.array(rawMarkArbitrary(omit), { minLength: 25, maxLength: 40 }),
          })
          .map((draw): DaySequence => buildSequence(plan, days, cal, draw, omit));
      }),
  );
}

/**
 * The per-day material, drawn before the sequence knows which days it will land
 * on. `fc.array` of these is drawn at a fixed length and indexed modulo, so the
 * number of days and the amount of material are independent draws and a shrink
 * on one does not have to shrink the other.
 */
interface RawMark {
  readonly realizedPnlCents: number;
  readonly adjustmentCents: number;
  readonly highSlack: number;
  readonly lowSlack: number;
  readonly fillCount: number;
  readonly sourceHash: string;
  readonly openingDelta: number;
  readonly closingDelta: number;
  readonly boundDelta: number;
  readonly fractional: boolean;
}

function rawMarkArbitrary(omit: ReadonlySet<DsRuleId>): fc.Arbitrary<RawMark> {
  return fc.record({
    // Bounded because a fold over a random walk of unbounded steps says nothing
    // useful about a rules engine. NOTHING IN M01 OR `0014` CONSTRAINS THE SIGN
    // OF A BALANCE, so the generator does not assert one either: an account can
    // walk below zero here, and inventing a floor no document states is how a
    // generator quietly stops exercising the breach path.
    realizedPnlCents: fc.integer({ min: -500_000, max: 500_000 }),
    // SD-01's column. Zero on most days, because most days carry no non-trading
    // movement; non-zero often enough that INV-18 is not asserted against a
    // constant. Negative is a settled payout (EC-034) and positive is the
    // promotional credit `0014`'s comment names.
    adjustmentCents: fc.oneof(
      { arbitrary: fc.constant(0), weight: 3 },
      { arbitrary: fc.integer({ min: -400_000, max: -1 }), weight: 1 },
      { arbitrary: fc.integer({ min: 1, max: 400_000 }), weight: 1 },
    ),
    // Zero is in the support: a day whose high IS its open or close is legal
    // and is the boundary `daily_marks_high_bounds_day`'s `>=` allows.
    highSlack: fc.integer({ min: 0, max: 200_000 }),
    lowSlack: fc.integer({ min: 0, max: 200_000 }),
    fillCount: has(omit, 'R-09/win-day-matches-pnl')
      ? // R-09 binds only on a traded day, so the counterfactual forces one.
        fc.integer({ min: 1, max: 400 })
      : has(omit, 'daily_marks_win_day_implies_traded')
        ? // That constraint binds only on an UNTRADED day.
          fc.constant(0)
        : has(omit, 'R-08/fill-count-non-negative')
          ? fc.integer({ min: -400, max: -1 })
          : has(omit, 'daily_marks_traded_day_matches_fills')
            ? fc.constant(0)
            : fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 400 })),
    sourceHash: fc.string({ unit: HEX_DIGIT, minLength: 64, maxLength: 64 }),
    // The inversions' magnitudes. Never zero, so a step that inverts always
    // inverts.
    openingDelta: fc.integer({ min: 1, max: 1_000_000 }),
    closingDelta: fc.integer({ min: 1, max: 1_000_000 }),
    boundDelta: fc.integer({ min: 1, max: 1_000_000 }),
    fractional: fc.constant(has(omit, 'INV-02')),
  });
}

interface SequenceDraw {
  readonly markOffset: number;
  readonly markLength: number;
  readonly holeAt: number;
  readonly markSwapAt: number;
  readonly calendarSwapAt: number;
  readonly sequenceBreakAt: number;
  readonly insertAt: number;
  readonly marks: readonly RawMark[];
}

interface CalendarDraw {
  readonly coverageBefore: number;
  readonly coverageAfter: number;
}

function buildSequence(
  plan: MaterializedPlan,
  sessions: readonly CalendarDay[],
  cal: CalendarDraw,
  draw: SequenceDraw,
  omit: ReadonlySet<DsRuleId>,
): DaySequence {
  const calendar = buildCalendar(sessions, cal, draw, omit);
  const markDays = chooseMarkDays(sessions, draw, omit);
  const marks = chainMarks(plan, markDays, draw.marks, omit);
  return { plan, calendar, marks: applyMarkDayInversions(marks, draw, omit) };
}

// -----------------------------------------------------------------------------
// The calendar
// -----------------------------------------------------------------------------

function buildCalendar(
  sessions: readonly CalendarDay[],
  cal: CalendarDraw,
  draw: SequenceDraw,
  omit: ReadonlySet<DsRuleId>,
): CalendarSource {
  let days = sessions;

  // R-02/sequence-is-dense: one step of two somewhere after the first row. Days
  // are untouched, so nothing else can report.
  if (has(omit, 'R-02/sequence-is-dense')) {
    const breakAt = 1 + (draw.sequenceBreakAt % Math.max(1, days.length - 1));
    days = days.map((d, i) => (i >= breakAt ? { ...d, sequence: d.sequence + 1 } : d));
  }

  // R-02/calendar-is-ordered: two adjacent rows exchange their DAYS and keep
  // their sequence numbers. The set of sessions is unchanged, so no mark stops
  // landing on one and the finding belongs to this rule alone.
  if (has(omit, 'R-02/calendar-is-ordered')) {
    const at = draw.calendarSwapAt % Math.max(1, days.length - 1);
    const swapped = [...days];
    const a = swapped[at]!;
    const b = swapped[at + 1]!;
    swapped[at] = { ...a, tradingDay: b.tradingDay };
    swapped[at + 1] = { ...b, tradingDay: a.tradingDay };
    days = swapped;
  }

  // The span is taken from the MINIMUM and MAXIMUM day rather than from the
  // first and last rows, because R-02/calendar-is-ordered's inversion leaves
  // those two different things. Read positionally, that inversion would push
  // `days[1]` outside a coverage anchored on a later `days[0]` and report
  // ADR-049/inside-coverage as collateral, which is the counterfactual grading
  // itself on the wrong rule.
  const ordered = [...days].map((d) => d.tradingDay).sort();
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  // ADR-049/inside-coverage: the interval starts one session late, so the
  // calendar declares a session its own coverage disowns.
  const from = has(omit, 'ADR-049/inside-coverage')
    ? ordered[1]!
    : addCalendarDays(first, -cal.coverageBefore);

  return { days, coverage: { from, to: addCalendarDays(last, cal.coverageAfter) } };
}

// -----------------------------------------------------------------------------
// Which days carry a mark
// -----------------------------------------------------------------------------
// THE HOLE AND THE INSERTION ARE DECIDED HERE, BEFORE THE BALANCES ARE CHAINED,
// and that ordering is what keeps the counterfactuals attributable. Dropping a
// mark from a chained list breaks the next day's INV-18 as collateral, and the
// test asserts that omitting one rule reports exactly one. Choosing the days
// first and chaining over what survives leaves the chain intact by
// construction.

function chooseMarkDays(
  sessions: readonly CalendarDay[],
  draw: SequenceDraw,
  omit: ReadonlySet<DsRuleId>,
): readonly string[] {
  const minimum = markMinimum(omit);
  const offset = Math.min(draw.markOffset, Math.max(0, sessions.length - minimum));
  const available = sessions.length - offset;
  const length = Math.min(Math.max(draw.markLength, minimum), available);

  let days = sessions.slice(offset, offset + length).map((d) => d.tradingDay);

  // EC-047/one-mark-per-open-day: a session strictly inside the run has no
  // mark. Interior, so the run's own first and last days do not move and the
  // finding is a hole rather than a shorter run.
  if (has(omit, 'EC-047/one-mark-per-open-day')) {
    const at = 1 + (draw.holeAt % Math.max(1, days.length - 2));
    days = [...days.slice(0, at), ...days.slice(at + 1)];
  }

  // DO-1/day-is-a-session: an extra mark on a day that is inside the coverage
  // and is not a session. It is inserted in DAY ORDER and never at position
  // zero, so DO-1/day-advances and INV-20 both still hold and this rule is the
  // only one that reports.
  if (has(omit, 'DO-1/day-is-a-session')) {
    const at = 1 + (draw.insertAt % Math.max(1, days.length - 1));
    const intruder = addCalendarDays(days[at - 1]!, 1);
    days = [...days.slice(0, at), intruder, ...days.slice(at)];
  }

  return days;
}

// -----------------------------------------------------------------------------
// The balances
// -----------------------------------------------------------------------------

function chainMarks(
  plan: MaterializedPlan,
  days: readonly string[],
  raw: readonly RawMark[],
  omit: ReadonlySet<DsRuleId>,
): readonly DailyMark[] {
  const winDayFloorCents = plan.phase_funded.win_days.win_day_floor_cents;
  const marks: DailyMark[] = [];
  let priorClosing = 0;

  for (let i = 0; i < days.length; i++) {
    const r = raw[i % raw.length]!;

    // Nothing asserts an adjustment on the account's first day: INV-18 is the
    // only rule that reads the column and `DayInput.prior` is "null only on the
    // account's first trading day". An unverifiable input is not a modelled
    // case, so it is zero there.
    const adjustmentCents = i === 0 ? 0 : r.adjustmentCents;

    // INV-02: one fractional cent, introduced at the pnl so that it propagates
    // through the closing balance and the bounds the way a real float would.
    // Every other identity still closes exactly, so INV-02 reports alone.
    const realizedPnlCents = r.fractional ? r.realizedPnlCents + 0.5 : r.realizedPnlCents;

    // INV-20 on the first day, INV-18 on every day after it.
    let openingBalanceCents: number;
    if (i === 0) {
      openingBalanceCents = has(omit, 'INV-20')
        ? plan.size_cents + r.openingDelta
        : plan.size_cents;
    } else {
      const chained = priorClosing + adjustmentCents;
      openingBalanceCents = has(omit, 'INV-18') ? chained + r.openingDelta : chained;
    }

    // INV-19.
    const closingBalanceCents = has(omit, 'INV-19')
      ? openingBalanceCents + realizedPnlCents + r.closingDelta
      : openingBalanceCents + realizedPnlCents;

    // The next day chains from what was EMITTED, not from what INV-19 says the
    // close should have been. Otherwise inverting INV-19 breaks the following
    // day's INV-18 as collateral.
    priorClosing = closingBalanceCents;

    const top = Math.max(openingBalanceCents, closingBalanceCents);
    const bottom = Math.min(openingBalanceCents, closingBalanceCents);

    const fillCount = r.fillCount;
    const tradedDay = has(omit, 'daily_marks_traded_day_matches_fills')
      ? fillCount === 0
      : fillCount > 0;

    // R-09, and the two inversions that read it. `daily_marks_win_day_implies_
    // traded` is inverted by claiming a win on a day with no fills; R-09 by
    // disagreeing with the pinned floor on a day that HAS fills.
    const clearsFloor = realizedPnlCents >= winDayFloorCents;
    const winDay = has(omit, 'daily_marks_win_day_implies_traded')
      ? true
      : has(omit, 'R-09/win-day-matches-pnl')
        ? !clearsFloor
        : tradedDay && clearsFloor;

    marks.push({
      tradingDay: days[i]!,
      openingBalanceCents,
      closingBalanceCents,
      highBalanceCents: has(omit, 'daily_marks_high_bounds_day')
        ? top - r.boundDelta
        : top + r.highSlack,
      lowBalanceCents: has(omit, 'daily_marks_low_bounds_day')
        ? bottom + r.boundDelta
        : bottom - r.lowSlack,
      realizedPnlCents,
      adjustmentCents,
      fillCount,
      tradedDay,
      winDay,
      sourceHash: r.sourceHash,
    });
  }

  return marks;
}

/**
 * DO-1/day-advances, applied AFTER the chain is built.
 *
 * Two adjacent marks exchange their trading days and keep their balances, so
 * the fold's arithmetic still closes and the only thing wrong with the sequence
 * is its order. Exchanging the marks themselves would have broken INV-18 on
 * both of them, and the counterfactual would have proved that this generator
 * can break three rules at once rather than that it can break this one.
 */
function applyMarkDayInversions(
  marks: readonly DailyMark[],
  draw: SequenceDraw,
  omit: ReadonlySet<DsRuleId>,
): readonly DailyMark[] {
  if (!has(omit, 'DO-1/day-advances')) return marks;

  const at = draw.markSwapAt % Math.max(1, marks.length - 1);
  const swapped = [...marks];
  const a = swapped[at]!;
  const b = swapped[at + 1]!;
  swapped[at] = { ...a, tradingDay: b.tradingDay };
  swapped[at + 1] = { ...b, tradingDay: a.tradingDay };
  return swapped;
}
