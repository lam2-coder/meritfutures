// =============================================================================
// apps/api/test/last-closed-day-coverage-split.test.ts
// =============================================================================
// ADR-273. THE DOOR THAT IS RIGHT ONLY IF EVERY CALLER REMEMBERS, AND WHETHER
// ANYTHING MAKES THEM.
//
// `packages/db/src/scoped-db.ts` says of this estate, in its own comment, that
// the last-closed-day fold "is already stated twice in this tree and the two
// statements disagree": `readLastClosedTradingDay` in `apps/worker` "consults no
// coverage at all", while `lastClosedDay` here has a CALLER, `anchorCalendar`,
// that "then checks `trading_calendar_loads` and can answer `uncovered`".
//
// **THAT DISAGREEMENT IS OVER, AND SECTION 3 IS WHERE THIS FILE RECORDS IT.**
// `ADR-277` repaired the worker half: both of its branches read
// `trading_calendar_loads` and hand back a discriminated union. The sentence
// above is quoted as the comment that STANDS in `scoped-db.ts` and is now stale
// on its worker clause; repairing it is a `packages/db` edit that ADR-277 was
// fenced out of and that `RI-27` cannot see, and ADR-277 section 6 reports it.
//
// `ADR-042` F-4 is what makes the difference matter: a day outside
// `trading_calendar_loads` is UNKNOWN and unknown is not a holiday. So a fold
// that skips the coverage read hands back a CONFIDENT day for a date the estate
// knows nothing about, and `0032`'s header calls that "the single most silent
// failure available to this table".
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE MEASURES, AND WHY IT IS NOT A SECOND OPINION ABOUT `R-06`
// -----------------------------------------------------------------------------
// Nothing here restates the selection. Every case drives the module's own
// exported readers over rows it declares, and the fixture's own known values are
// what the assertions compare against.
//
// THE CENTRAL CASE IS THE ONE THAT NEEDS NO SECOND CALLER. On an estate whose
// calendar runs two months past its coverage, the refusal these readers return
// CARRIES THE DAY A COVERAGE-BLIND FOLD WOULD HAVE HANDED OUT, in its own
// `anchor_day` field. So the case can assert both halves at once: that the day
// is `2026-08-28`, and that the walk refused it. That is the failure ADR-273
// asks about, executed, without adding a caller to any `src/` file.
//
// -----------------------------------------------------------------------------
// THE SPLIT AND WHAT ACTUALLY HOLDS IT
// -----------------------------------------------------------------------------
// The answer ADR-273 reaches is that the split is safe HERE and that the reason
// is a TYPE rather than a memory: `lastClosedDay` is module-private with one
// caller, and that caller returns a discriminated union whose anchored day is
// unreachable without narrowing past an `uncovered` arm. A consumer that forgets
// does not compile. Cases 6 to 9 measure that, on the source, because a property
// held by the compiler is invisible to a suite that only runs values.
//
// WHAT THIS FILE DOES NOT COVER: the tree. A fifth statement of the fold landing
// in some other package is a property of the whole repository and `RI-27` is its
// home. One case here RUNS `RI-27` so both halves move under `pnpm vitest run`,
// and that is the only place the two overlap.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  readCalendarSlice,
  readTradingHorizon,
  readTradingLookback,
  type TradingCalendarTx,
} from '../src/admin-source/liability.ts';

/** The workspace root, three levels up from `apps/api/test`. */
const ROOT = join(import.meta.dirname, '..', '..', '..');

const LIABILITY_REL = 'apps/api/src/admin-source/liability.ts';
const WORKER_ADAPTER_REL = 'apps/worker/src/batch/adapter.ts';
const WORKER_JOB_REL = 'apps/worker/src/job.ts';

/**
 * `repo-invariants.mjs`'s own comment stripper, RE-DECLARED rather than
 * imported, because that helper is private to the check module and exporting it
 * to satisfy a suite would widen the module's surface for a test's convenience.
 * It is three lines and the cases that use it say what they read.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceOf(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// -----------------------------------------------------------------------------
// THE ESTATE, AND ITS ONE INTERESTING PROPERTY
// -----------------------------------------------------------------------------
// A calendar loaded through June and read at the end of August. The rows for
// August are REAL rows a walk reads; what no row states is that anybody loaded
// them. That is F-4's exact shape and it is the estate a coverage-blind fold
// answers `2026-08-28` on.
// -----------------------------------------------------------------------------

/** June 2026 weekday sessions. `2026-06-01` is a Monday. */
const JUNE: readonly string[] = [
  '2026-06-01',
  '2026-06-02',
  '2026-06-03',
  '2026-06-04',
  '2026-06-05',
  '2026-06-08',
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-15',
  '2026-06-16',
  '2026-06-17',
  '2026-06-18',
  '2026-06-19',
  '2026-06-22',
  '2026-06-23',
  '2026-06-24',
  '2026-06-25',
  '2026-06-26',
  '2026-06-29',
  '2026-06-30',
];

/** August 2026 weekday sessions. `2026-08-31` closes AFTER {@link AS_OF}. */
const AUGUST: readonly string[] = [
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-10',
  '2026-08-11',
  '2026-08-12',
  '2026-08-13',
  '2026-08-14',
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-31',
];

/** The day a fold that reads only `trading_calendar` returns at {@link AS_OF}. */
const MAX_CLOSED_DAY = '2026-08-28';

/** The last day any `trading_calendar_loads` row in {@link JUNE_ONLY} declares. */
const COVERED_THROUGH = '2026-06-30';

/** One instant after `2026-08-28` closed and before `2026-08-31` does. */
const AS_OF = '2026-08-30T00:00:00.000Z';

function session(tradingDay: string): Record<string, unknown> {
  return {
    tradingDay,
    sessionOpenAt: new Date(Date.parse(`${tradingDay}T21:00:00.000Z`) - 23 * 60 * 60 * 1000),
    sessionCloseAt: new Date(`${tradingDay}T21:00:00.000Z`),
    isHalfDay: false,
    isHoliday: false,
    halted: false,
    notes: null,
  };
}

const CALENDAR: readonly unknown[] = [...JUNE, ...AUGUST].map((d) => session(d));

/** Coverage stops two months before the calendar does. */
const JUNE_ONLY: readonly unknown[] = [
  { coverageStartDay: '2026-06-01', coverageEndDay: COVERED_THROUGH },
];

/** Coverage that reaches the anchor, so the refusal is shown to be conditional. */
const THROUGH_AUGUST: readonly unknown[] = [
  { coverageStartDay: '2026-06-01', coverageEndDay: '2026-08-31' },
];

function handle(loads: readonly unknown[]): TradingCalendarTx {
  return {
    rows: async (key) => (key === 'tradingCalendar' ? [...CALENDAR] : [...loads]),
  };
}

// =============================================================================
// 1. THE COVERAGE READ IS LOAD-BEARING, AND THE REFUSAL NAMES THE DAY IT REFUSED
// =============================================================================

describe('a calendar loaded past its coverage refuses, and the refusal carries the day', () => {
  it('readTradingHorizon answers `uncovered` and its anchor_day is the coverage-blind answer', async () => {
    // **THIS IS THE WHOLE OF ADR-273's QUESTION IN ONE ASSERTION.** The estate
    // holds a closed session on `2026-08-28`, so a fold reading only
    // `trading_calendar` returns that day and every gate downstream reads the
    // `rule_states` row for it. The coverage read is what turns that confident
    // day into a refusal, and the refusal hands the day back as the SUBJECT of
    // the refusal rather than as an answer.
    const { horizon } = await readTradingHorizon(handle(JUNE_ONLY), AS_OF);

    expect(horizon.kind).toBe('uncovered');
    expect(horizon.anchor_day).toBe(MAX_CLOSED_DAY);
    if (horizon.kind !== 'uncovered') throw new Error('narrowing');
    expect(horizon.detail).toContain('ADR-042 F-4');
    expect(horizon.detail).toContain(COVERED_THROUGH);
  });

  it('readTradingLookback refuses the same estate, on the same anchor', async () => {
    // THE TRAILING WALK IS THE ONE `ADR-201` RULING 3 SCALES A DENOMINATOR
    // FROM, so answering here on an uncovered anchor is a ratio measured over a
    // window nobody loaded.
    const { lookback } = await readTradingLookback(handle(JUNE_ONLY), AS_OF, 30);

    expect(lookback.kind).toBe('uncovered');
    expect(lookback.anchor_day).toBe(MAX_CLOSED_DAY);
  });

  it('readCalendarSlice refuses the same estate, on the same anchor', async () => {
    const { slice } = await readCalendarSlice(handle(JUNE_ONLY), AS_OF);

    expect(slice.kind).toBe('uncovered');
    expect(slice.anchor_day).toBe(MAX_CLOSED_DAY);
  });

  it('a full calendar with NO load row answers for no day at all, and says F-4 is why', async () => {
    // F-4's OWN BRANCH. An estate that has days and no record of having loaded
    // them is entitled to answer for none of them, and the `anchor_day` is
    // `null` because no day was even selected: the refusal is above the fold
    // rather than after it.
    const { horizon } = await readTradingHorizon(handle([]), AS_OF);

    expect(horizon.kind).toBe('uncovered');
    expect(horizon.anchor_day).toBeNull();
    if (horizon.kind !== 'uncovered') throw new Error('narrowing');
    expect(horizon.detail).toContain('ADR-042 F-4');
  });

  it('and the refusal is CONDITIONAL: coverage reaching the anchor answers the day', async () => {
    // **WITHOUT THIS CASE THE THREE ABOVE ARE SATISFIED BY A READER THAT
    // REFUSES EVERYTHING**, which is the second trap ADR-273 was sent to avoid
    // written as a suite defect. The rows are identical; only the load row
    // moved.
    const { slice } = await readCalendarSlice(handle(THROUGH_AUGUST), AS_OF);

    expect(slice.kind).toBe('resolved');
    expect(slice.anchor_day).toBe(MAX_CLOSED_DAY);
  });
});

// =============================================================================
// 2. WHAT ENFORCES THE SPLIT, AND IT IS A TYPE RATHER THAN A CONVENTION
// =============================================================================

describe('the coverage check cannot be forgotten by a consumer of the anchor', () => {
  it('`lastClosedDay` is module-private, so the fold has no reachable second caller', () => {
    const code = stripComments(sourceOf(LIABILITY_REL));

    expect(code).toMatch(/\bfunction\s+lastClosedDay\s*\(/);
    expect(code).not.toMatch(/\bexport\s+(?:async\s+)?function\s+lastClosedDay\b/);
    expect(code).not.toMatch(/\bexport\s*\{[^}]*\blastClosedDay\b/);
  });

  it('`lastClosedDay` has exactly ONE call site and it is inside `anchorCalendar`', () => {
    // **ADR-273's LITERAL QUESTION: IS THAT CALLER THE ONLY CALLER.** Measured
    // rather than read: two occurrences in stripped code, the declaration and
    // one call, and the call falls between `anchorCalendar`'s own opening line
    // and the next declaration in the file. The day a second caller appears
    // inside this module, this case is what says so.
    const code = stripComments(sourceOf(LIABILITY_REL));
    const uses = [...code.matchAll(/\blastClosedDay\s*\(/g)];
    expect(uses).toHaveLength(2);

    const opens = code.indexOf('async function anchorCalendar(');
    const nextDeclaration = code.indexOf('export async function readTradingHorizon(');
    expect(opens).toBeGreaterThan(-1);
    expect(nextDeclaration).toBeGreaterThan(opens);

    const call = uses[1]?.index ?? -1;
    expect(call).toBeGreaterThan(opens);
    expect(call).toBeLessThan(nextDeclaration);
  });

  it('the anchored day is reachable only past an `uncovered` arm, which is a COMPILE-time fence', () => {
    // **THIS IS THE REASON THE SPLIT IS SAFE AND IT IS NOT THAT ANYBODY
    // REMEMBERED.** `CalendarAnchor` is a discriminated union: `anchorDay` is
    // declared on the `anchored` arm alone, so reading it without narrowing on
    // `kind` is a type error rather than a stale day. A suite that only runs
    // values cannot see that, so the union's shape is asserted here directly.
    const code = stripComments(sourceOf(LIABILITY_REL));
    const start = code.indexOf('type CalendarAnchor =');
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf('\n\n', start));

    expect(block).toContain("kind: 'anchored'");
    expect(block).toContain("kind: 'uncovered'");
    // ONE declaration, on ONE arm. Two would mean both arms carry a day and the
    // narrowing buys nothing.
    expect([...block.matchAll(/\breadonly anchorDay\b/g)]).toHaveLength(1);
    expect(block).toMatch(/\breadonly anchor_day: string \| null;/);
  });

  it('every `anchorCalendar` call site narrows on `uncovered` before it reads the anchor', () => {
    // THE CENSUS OVER THE THREE WALKS, and the two counts must agree. A fourth
    // walk added without its guard moves the first number and not the second.
    const code = stripComments(sourceOf(LIABILITY_REL));
    const calls = [...code.matchAll(/await anchorCalendar\(/g)];
    const guards = [...code.matchAll(/anchor\.kind === 'uncovered'/g)];

    expect(calls).toHaveLength(3);
    expect(guards).toHaveLength(calls.length);
  });
});

// =============================================================================
// 3. THE GAP THAT WAS REGISTERED HERE, AND IS NOW CLOSED
// =============================================================================
// **THIS SECTION MEASURED A DEFECT AND THE DEFECT IS REPAIRED, SO IT MEASURES
// THE REPAIR.** `ADR-273` registered `apps/worker`'s fold as the one place
// nothing held the split and left it as finding 1, because `apps/worker` was
// outside that row's fence. `ADR-277` is that row and this is the co-motion the
// repair could not avoid: two of the three cases below asserted, in terms, that
// the worker fold was EXPORTED and that neither worker file named the loads
// table, and there is no version of closing the gap that leaves those green.
// `ADR-277` section 6 states the fence departure rather than performing it
// quietly; a founder who prefers the old assertions restored has one file to
// revert.
//
// **THE ASSERTIONS ARE INVERTED, NOT DELETED.** This suite's subject is where
// the coverage read lives on each fold, and that subject did not change: what
// changed is the answer for one of them. A section removed here would leave the
// census in `RI-27` and nothing at all running the behavioural half for
// `apps/worker`, which is the direction that loses coverage.

describe('the worker fold now consults coverage, and so does its caller', () => {
  it('the coverage-blind fold is no longer exported, and the adapter names the loads table', () => {
    // **`ADR-273` SECTION 10 NAMED THIS EXACT SHAPE AS THE ONE A CENSUS CANNOT
    // SEE**: a fold that satisfies `RI-27` completely while handing its caller a
    // bare `string | null`. `readLastClosedTradingDay` was that shape and was
    // exported, so its callers were unbounded by construction. It is
    // module-private now, and what leaves the module is a discriminated union.
    const code = stripComments(sourceOf(WORKER_ADAPTER_REL));

    expect(code).not.toMatch(/\bexport\s+(?:async\s+)?function\s+readLastClosedTradingDay\b/);
    expect(code).not.toMatch(/\bexport\s+(?:async\s+)?function\s+calendarCarriesDay\b/);
    expect(code).toContain('tradingCalendarLoads');
    expect(code).toMatch(/export type TradingDayAnchor/);
  });

  it('its caller narrows on a verdict rather than asking `trading_calendar` for a row', () => {
    // `calendarCarriesDay` DID ask a coverage-shaped question and asked it of
    // the wrong table: a `trading_calendar` row says a day IS a session and
    // never says anybody loaded it, while its refusal text said "outside
    // coverage". The caller now reads a `TradingDayAnchor` on both branches and
    // names no table itself, so the coverage read still has ONE statement in
    // this deployable rather than two.
    const code = stripComments(sourceOf(WORKER_JOB_REL));

    expect(code).not.toContain('readLastClosedTradingDay');
    expect(code).not.toContain('calendarCarriesDay');
    expect(code).toContain('anchorLastClosedDay(');
    expect(code).toContain('anchorNamedDay(');
    expect(code).not.toContain('tradingCalendarLoads');
    expect(code).not.toContain('trading_calendar_loads');
  });
});

// =============================================================================
// 4. THE TREE CENSUS, WHICH IS `RI-27`'s AND IS RUN HERE
// =============================================================================

describe('RI-27 holds on this tree', () => {
  it('reports no finding', async () => {
    // ONE CASE, AND IT IS THE ONLY OVERLAP BETWEEN THE TWO HALVES. `RI-27`
    // owns the tree census because a fifth statement of the fold can land in
    // any package; this file owns the behaviour and the file-local fence. This
    // case exists so a session running only `pnpm vitest run` still moves the
    // census.
    const checks = await import(
      pathToFileURL(join(ROOT, 'packages/tooling/checks/repo-invariants.mjs')).href
    );
    const ri26 = (checks.CHECKS as { id: string; run(root: string): string[] }[]).find(
      (c) => c.id === 'RI-27',
    );
    expect(ri26).toBeDefined();
    expect(ri26?.run(ROOT)).toEqual([]);
  });
});
