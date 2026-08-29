// =============================================================================
// apps/api/test/admin-source-liability-calendar.test.ts
// =============================================================================
// `readCalendarSlice`, WHICH IS `B5` LEG 2's WORK AND NOT `B5`'s LIFT.
//
// **WHAT THIS FILE PROVES AND WHAT IT DELIBERATELY DOES NOT.** Session 380
// recorded leg 2 of blocker `B5` as a missing `trading_calendar.sequence`
// column, and concluded that "the only substitute available to an adapter is the
// date arithmetic AS-06 forbids". `ADR-204` section 8 refuted the CONCLUSION on
// three steps and returned the work to this fence in terms: "What leg 2 names is
// a `CalendarSlice` loader in the `apps/api` fence, not DDL." Session 389's next
// slice line says the same from the engine side.
//
// **AN ENTRY'S ARGUMENT AND A SLICE A SUITE RUNS ARE DIFFERENT OBJECTS**, which
// is `B2`'s lesson arriving a second time: `ADR-201` defined `avg_30d_cents` in
// August and the figure took two more sessions to reach a body. These cases are
// the body for leg 2, and the property they assert is the one the refutation
// turns on:
//
//     POSITION OVER THE ORDERED, HOLIDAY-FILTERED ROWS OF ONE COVERED INTERVAL
//     IS THE DENSE CALENDAR INDEX `R-02` COUNTS BY.
//
// It is asserted through THE ENGINE'S OWN READERS wherever one exists.
// `lookupCalendarDay` and `nextTradingDayAfter` are exported from
// `@merit/rules-engine` and both are run over the slice this loader built, so
// what passes here is the engine reading this adapter's value and not this file
// agreeing with itself. `tradingDaysBetween` is NOT exported (`projectPayout`
// reaches it internally), so the subtraction property is asserted against the
// ROWS rather than against that function, and the case says so where it does it.
//
// **`readLiability` IS STILL NOT COMPOSED AND THIS FILE IS NOT AN ARM OF `B5`'s
// CLEARING CONDITION.** `PayoutProjectionInput` takes five inputs and this is
// one of them. `state: RuleState` carries `engineGates: EngineGateResults`,
// which lives in `rule_states.engine_gates`, a bag no adapter writes and no
// primary source declares an encoding for. `admin-source-liability.test.ts`
// holds that measurement and this file adds one case pointing at it, so a reader
// arriving here cannot mistake a built input for a lifted blocker.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupCalendarDay, nextTradingDayAfter } from '@merit/rules-engine';
import type { CalendarSlice, TradingDay } from '@merit/rules-engine';

import { AdminReadError } from '../src/routes/admin-reads.ts';
import {
  readCalendarSlice,
  readTradingHorizon,
  type LiabilityCalendarSlice,
  type TradingCalendarTx,
} from '../src/admin-source/liability.ts';

// -----------------------------------------------------------------------------
// The double, and the calendar it answers from
// -----------------------------------------------------------------------------
// `admin-source-liability-book.test.ts`'s November fixture, RE-DECLARED HERE
// RATHER THAN IMPORTED. That file's fixture is private to it and exporting it
// would make two suites share a shape neither owns; the days are the same
// because the interesting week is the same one, and every fact this file asserts
// about them is derived from the rows below rather than carried from there.
// -----------------------------------------------------------------------------

/** Sessions. The last four sit PAST the coverage edge and must not be taken. */
const SESSIONS: readonly string[] = [
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-27',
  '2026-11-30',
  '2026-12-01',
  '2026-12-02',
  '2026-12-03',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-11',
  '2026-12-14',
  '2026-12-15',
  '2026-12-16',
  '2026-12-17',
  '2026-12-18',
  '2026-12-21',
  '2026-12-22',
  '2026-12-23',
  '2026-12-24',
  '2026-12-28',
  '2026-12-29',
  '2026-12-30',
  '2026-12-31',
];

/** Thanksgiving and Christmas, both with the session columns NULL (`0032` F-1). */
const HOLIDAYS: readonly string[] = ['2026-11-26', '2026-12-25'];

function session(tradingDay: string): Record<string, unknown> {
  return {
    tradingDay,
    sessionOpenAt: new Date(Date.parse(`${tradingDay}T22:00:00.000Z`) - 23 * 60 * 60 * 1000),
    sessionCloseAt: new Date(`${tradingDay}T22:00:00.000Z`),
    isHalfDay: tradingDay === '2026-11-27',
    isHoliday: false,
    halted: tradingDay === '2026-12-01',
    notes: null,
  };
}

function holiday(tradingDay: string): Record<string, unknown> {
  return {
    tradingDay,
    sessionOpenAt: null,
    sessionCloseAt: null,
    isHalfDay: false,
    isHoliday: true,
    halted: false,
    notes: 'exchange holiday',
  };
}

const CALENDAR: readonly unknown[] = [
  ...SESSIONS.map((d) => session(d)),
  ...HOLIDAYS.map((d) => holiday(d)),
];

/** Two loads overlapping on `2026-12-15`, so the merge is exercised. */
const LOADS: readonly unknown[] = [
  { coverageStartDay: '2026-11-16', coverageEndDay: '2026-12-15' },
  { coverageStartDay: '2026-12-15', coverageEndDay: '2026-12-24' },
];

function handle(
  overrides: { calendar?: readonly unknown[]; loads?: readonly unknown[] } = {},
): TradingCalendarTx {
  return {
    rows: async (key) =>
      key === 'tradingCalendar'
        ? [...(overrides.calendar ?? CALENDAR)]
        : [...(overrides.loads ?? LOADS)],
  };
}

/** The `resolved` arm or a thrown test failure, so no case reads through a union. */
function resolved(answer: LiabilityCalendarSlice): {
  readonly anchor: string;
  readonly slice: CalendarSlice;
} {
  if (answer.kind !== 'resolved') throw new Error(`expected a slice, got ${answer.detail}`);
  return { anchor: answer.anchor_day, slice: answer.slice };
}

const day = (iso: string): TradingDay => iso as TradingDay;

/** Anchored inside the November week, one instant after `2026-11-24` closed. */
const AS_OF = '2026-11-25T00:30:00.000Z';

/** The workspace root, three levels up from `apps/api/test`. */
const ROOT = join(import.meta.dirname, '..', '..', '..');

// =============================================================================
// THE SLICE, AND THE PROPERTY THE REFUTATION TURNS ON
// =============================================================================

describe('readCalendarSlice builds one covered interval and indexes it by POSITION', () => {
  it('takes the whole interval covering the anchor and stops at both coverage edges', async () => {
    // **THE INTERVAL IS NOT THE HORIZON AND THIS IS THE CASE THAT SAYS SO.**
    // `projectPayout` requires a calendar that covers "the cadence anchor AND
    // every horizon day", and the cadence anchor is a PAST day: it is
    // `rule_states.cadence_anchor_day`, the basis `R-37` counts from. A slice
    // built to the horizon alone would answer `outside_coverage` for every
    // account whose anchor predates it.
    const { slice, anchor } = resolved((await readCalendarSlice(handle(), AS_OF)).slice);

    expect(anchor).toBe('2026-11-24');
    // BOTH EDGES. The merged interval is 2026-11-16..2026-12-24, so the first
    // session of coverage is present and the four December rows past the edge
    // are not, even though they are real rows this walk read.
    expect(slice.days[0]?.tradingDay).toBe('2026-11-16');
    expect(slice.days[slice.days.length - 1]?.tradingDay).toBe('2026-12-24');
    expect(slice.days.map((d) => d.tradingDay)).not.toContain('2026-12-28');
    expect(slice.coverage).toEqual({ from: '2026-11-16', to: '2026-12-24' });
    // AND IT REACHES BACKWARDS PAST THE ANCHOR, which is the half a horizon walk
    // cannot supply and the projection's precondition needs.
    expect(slice.days.map((d) => d.tradingDay)).toContain('2026-11-16');
    expect(slice.days.filter((d) => d.tradingDay < anchor)).toHaveLength(6);
  });

  it('is DENSE: sequence is position, and no holiday consumes an index', async () => {
    // **THIS IS `ADR-204` SECTION 8 STEP 3 EXECUTED.** `0032` makes a day inside
    // coverage that the table does not hold POSITIVELY not a session, so it is
    // correctly absent from a dense index, and a slice over ONE covered interval
    // therefore cannot have the hole `packages/golden-loader/src/calendar.ts`
    // names as the exact limit of position-as-index.
    const { slice } = resolved((await readCalendarSlice(handle(), AS_OF)).slice);

    expect(slice.days.map((d) => d.sequence)).toEqual(slice.days.map((_, i) => i));
    // THE HOLIDAY IS INSIDE COVERAGE AND CONSUMES NO INDEX, which is the whole
    // of density: 2026-11-25 and 2026-11-27 are ADJACENT sequences with
    // Thanksgiving between them on the calendar.
    const at = (d: string) => slice.days.find((row) => row.tradingDay === d)?.sequence;
    expect(at('2026-11-27')).toBe((at('2026-11-25') ?? -99) + 1);
    expect(slice.days.map((d) => d.tradingDay)).not.toContain('2026-11-26');
    // Non-vacuity: the holiday really was a row this walk read and rejected.
    expect(
      CALENDAR.some((row) => (row as { tradingDay: string }).tradingDay === '2026-11-26'),
    ).toBe(true);
  });

  it('makes SEQUENCE SUBTRACTION the trading-day count R-02 requires, and date arithmetic wrong', async () => {
    // **THE PROPERTY `R-37` COUNTS BY**, asserted against the ROWS rather than
    // against `tradingDaysBetween`, which is not exported from
    // `@merit/rules-engine` (`projectPayout` reaches it internally). The
    // arithmetic is that function's, verbatim: `to.sequence - from.sequence`.
    //
    // AND THE CONTRAST IS THE POINT. From 2026-11-20 to 2026-11-30 is FIVE
    // trading days and TEN calendar days, because Thanksgiving and two weekends
    // fall inside. `AS-06` is why the difference is not a rounding question: a
    // cadence gap resolved by date arithmetic would call an account eligible
    // four days early, on money.
    const { slice } = resolved((await readCalendarSlice(handle(), AS_OF)).slice);
    const seq = (d: string) => slice.days.find((row) => row.tradingDay === d)?.sequence ?? -1;

    expect(seq('2026-11-30') - seq('2026-11-20')).toBe(5);
    // The same span in CALENDAR days, derived rather than written down.
    const calendarDays =
      (Date.parse('2026-11-30T00:00:00.000Z') - Date.parse('2026-11-20T00:00:00.000Z')) /
      86_400_000;
    expect(calendarDays).toBe(10);
    // And the count is exactly the sessions strictly between them, which is what
    // makes the subtraction a COUNT rather than an offset that happens to match.
    expect(
      slice.days.filter((d) => d.tradingDay > '2026-11-20' && d.tradingDay <= '2026-11-30'),
    ).toHaveLength(5);
  });

  it('carries the half day and the halted day, because neither is a non-session', async () => {
    // `0004` B4 #3: a half day "counts as a FULL DAY". B4 #2: on a halted
    // session "day counters advance and win days do NOT". Both are trading days
    // and both must occupy an index, or the gap count shortens on exactly the
    // weeks the exchange is unusual.
    const { slice } = resolved((await readCalendarSlice(handle(), AS_OF)).slice);
    const at = (d: string) => slice.days.find((row) => row.tradingDay === d);

    expect(at('2026-11-27')).toMatchObject({ isHalfDay: true, halted: false });
    expect(at('2026-12-01')).toMatchObject({ isHalfDay: false, halted: true });
    expect(at('2026-11-27')?.sequence).toBeTypeOf('number');
  });
});

// =============================================================================
// THE ENGINE'S OWN READERS, OVER THIS ADAPTER'S SLICE
// =============================================================================

describe('the engine reads the slice this loader built', () => {
  it('keeps `not_a_session` and `outside_coverage` apart, which is ADR-042 F-4 on real rows', async () => {
    // **THE TWO ANSWERS THAT MAY NEVER COLLAPSE**, taken from
    // `lookupCalendarDay` rather than restated here: "a day inside coverage that
    // the calendar does not hold is POSITIVELY not a trading day, and a day
    // outside coverage is UNKNOWN. Only one of those is safe to act on."
    const { slice } = resolved((await readCalendarSlice(handle(), AS_OF)).slice);

    // A HOLIDAY INSIDE COVERAGE.
    expect(lookupCalendarDay(slice, day('2026-11-26'))).toEqual({
      found: false,
      reason: 'not_a_session',
    });
    // A REAL SESSION ROW PAST THE COVERAGE EDGE. The row exists in
    // `trading_calendar` and the slice is not entitled to answer for it.
    expect(SESSIONS).toContain('2026-12-28');
    expect(lookupCalendarDay(slice, day('2026-12-28'))).toEqual({
      found: false,
      reason: 'outside_coverage',
    });
    // Non-vacuity on the acceptance side: an ordinary day is FOUND, so the
    // refusals above are not a lookup that rejects everything.
    expect(lookupCalendarDay(slice, day('2026-11-30')).found).toBe(true);
  });

  it('walks forward through the holiday under `nextTradingDayAfter`', async () => {
    // The engine's own successor, over this slice. 2026-11-25's next session is
    // 2026-11-27 and never 2026-11-26, and the last covered day has NO successor
    // even though rows exist past it, which is that function's stated rule:
    // "THE LAST DAY IN `days` IS A MISS EVEN WHEN COVERAGE EXTENDS PAST IT".
    const { slice } = resolved((await readCalendarSlice(handle(), AS_OF)).slice);

    expect(nextTradingDayAfter(slice, day('2026-11-25'))).toMatchObject({
      found: true,
      day: { tradingDay: '2026-11-27' },
    });
    expect(nextTradingDayAfter(slice, day('2026-12-24')).found).toBe(false);
  });

  it('agrees with `readTradingHorizon` day for day, because both walk one anchor', async () => {
    // THE TWO WALKS SHARE `anchorCalendar` BY IDENTITY and this is the case that
    // asserts the consequence rather than the arrangement. The horizon's seven
    // days are the seven slice entries immediately after the anchor's, so a
    // projection placed on a horizon day is placed on a day the slice can
    // resolve. A divergence here would be `projectPayout` refusing a day the
    // horizon just handed it.
    const tx = handle();
    const { slice, anchor } = resolved((await readCalendarSlice(tx, AS_OF)).slice);
    const { horizon } = await readTradingHorizon(tx, AS_OF);
    if (horizon.kind !== 'resolved') throw new Error('expected a resolved horizon');

    const anchorSeq = slice.days.find((d) => d.tradingDay === anchor)?.sequence ?? -1;
    expect(horizon.days.map((d) => d.trading_day)).toEqual(
      slice.days
        .filter((d) => d.sequence > anchorSeq && d.sequence <= anchorSeq + 7)
        .map((d) => d.tradingDay),
    );
    expect(horizon.days).toHaveLength(7);
  });
});

// =============================================================================
// THE REFUSALS
// =============================================================================

describe('readCalendarSlice refuses rather than answering narrowly', () => {
  it('answers `uncovered` when no load declares coverage, on the horizon`s own words', async () => {
    // `ADR-042` F-4: coverage is a stored fact precisely so this is a POSITIVE
    // answer rather than an unbroken run of non-holidays. The detail is
    // `anchorCalendar`'s, shared with both other walks.
    const answer = (await readCalendarSlice(handle({ loads: [] }), AS_OF)).slice;
    expect(answer.kind).toBe('uncovered');
    if (answer.kind !== 'uncovered') throw new Error('unreachable');
    expect(answer.anchor_day).toBeNull();
    expect(answer.detail).toContain('no `trading_calendar_loads` row declares coverage');
  });

  it('answers `uncovered` when the anchor sits outside every covered interval', async () => {
    const answer = (
      await readCalendarSlice(
        handle({ loads: [{ coverageStartDay: '2027-01-01', coverageEndDay: '2027-06-30' }] }),
        AS_OF,
      )
    ).slice;
    expect(answer.kind).toBe('uncovered');
    if (answer.kind !== 'uncovered') throw new Error('unreachable');
    expect(answer.anchor_day).toBe('2026-11-24');
    expect(answer.detail).toContain('A day outside coverage is UNKNOWN');
  });

  it('has NO `exhausted` arm, and a one-session interval is a correct slice', async () => {
    // **THE MISSING ARM IS THE FINDING RATHER THAN A SIMPLIFICATION.** A horizon
    // asks for SEVEN days and can be short of them; a slice asks for the covered
    // interval and takes what it holds. Reporting a small estate as `exhausted`
    // would be reporting the calendar's size as a defect.
    const answer = (
      await readCalendarSlice(
        handle({
          calendar: [session('2026-11-24')],
          loads: [{ coverageStartDay: '2026-11-24', coverageEndDay: '2026-11-24' }],
        }),
        AS_OF,
      )
    ).slice;
    const { slice } = resolved(answer);
    expect(slice.days).toHaveLength(1);
    expect(slice.days[0]?.sequence).toBe(0);
    // And the SAME estate exhausts the horizon, so the two answers are shown to
    // differ on one input rather than described as differing.
    const { horizon } = await readTradingHorizon(
      handle({
        calendar: [session('2026-11-24')],
        loads: [{ coverageStartDay: '2026-11-24', coverageEndDay: '2026-11-24' }],
      }),
      AS_OF,
    );
    expect(horizon.kind).toBe('exhausted');
  });

  it('re-throws the engine`s slice refusal as a defect in THIS assembly', async () => {
    // `ADR-049` makes a malformed slice a CALLER defect rather than a day the
    // engine refuses, and this loader is that caller. `trading_calendar` has
    // `trading_day` as its PRIMARY KEY so a live database cannot produce this,
    // but the port is `rows(): Promise<unknown[]>` and a caller can, which is
    // the direction a re-thrown refusal has to survive. **WATCHED FIRING RATHER
    // THAN ASSUMED: without the `try`, this is a bare `CalendarSliceError`
    // escaping an admin read.**
    const twice = handle({ calendar: [session('2026-11-24'), session('2026-11-24')] });
    await expect(readCalendarSlice(twice, AS_OF)).rejects.toThrow(AdminReadError);
    await expect(readCalendarSlice(twice, AS_OF)).rejects.toThrow(
      /do not assemble into a slice.*is not after/s,
    );
  });

  it('refuses an as-of that is not an instant, sharing the horizon`s refusal', async () => {
    await expect(readCalendarSlice(handle(), 'the last closed day')).rejects.toThrow(
      AdminReadError,
    );
  });
});

// =============================================================================
// WHAT THIS DOES NOT LIFT
// =============================================================================

describe('the slice is ONE of projectPayout`s five inputs and B5 is unmoved', () => {
  it('leaves `state` blocked, because a RuleState carries the bag nothing declares', () => {
    // **THE CHAIN, AT ITS THREE SOURCES.** `PayoutProjectionInput.state` is a
    // `RuleState`; `RuleState.engineGates` is an `EngineGateResults`; that value
    // is stored in `rule_states.engine_gates`, a `jsonb NOT NULL` bag whose
    // encoding no primary source declares. So the input this fence cannot
    // produce is not the calendar and never was.
    const project = readFileSync(join(ROOT, 'packages/rules-engine/src/payout/project.ts'), 'utf8');
    expect(project).toContain('readonly state: RuleState;');
    expect(project).toContain('readonly calendar: CalendarSlice;');

    const types = readFileSync(join(ROOT, 'packages/rules-engine/src/types.ts'), 'utf8');
    expect(types).toContain('readonly engineGates: EngineGateResults;');

    // AND THE CONTRACT STILL CARRIES NO ENCODING FOR IT, which is the half a
    // landed writer would not by itself supply.
    expect(readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8')).not.toContain(
      'engine_gates:',
    );
  });

  it('reads NO rule_states, so this loader fixes no encoding from the read side', () => {
    // `ADR-199` section 7's rule, which `ADR-204` section 8 cites to return a
    // migration number unspent: a shape fixed at the moment of maximum ignorance
    // about the producer is the trade this estate refuses. A reader here that
    // decoded `engine_gates` would be that trade with a different name.
    const module = readFileSync(join(ROOT, 'apps/api/src/admin-source/liability.ts'), 'utf8');
    expect(module).not.toContain("'ruleStates'");
    // Non-vacuity: the table IS a registered `TableKey`, so its absence from
    // this module is a decision and not an unavailability.
    expect(readFileSync(join(ROOT, 'packages/db/src/scope.ts'), 'utf8')).toContain('ruleStates');
  });
});
