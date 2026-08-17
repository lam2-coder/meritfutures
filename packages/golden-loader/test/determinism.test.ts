// =============================================================================
// packages/golden-loader/test/determinism.test.ts
// =============================================================================
// RE-D-01 AND RE-D-02. TWO OF M01 SECTION 1.4's THREE NAMED MERGE BLOCKERS,
// NONE OF WHICH WAS IN THE TREE. The third is RE-D-03, which lands as RI-07 in
// packages/tooling because it is a repo invariant by construction.
//
//   RE-D-01  "a test that stubs `globalThis.fetch`, `Date`, and `Math.random`
//            to throw and runs the entire golden suite"
//   RE-D-02  "runs the suite under `TZ=Asia/Kolkata` with a non-English locale
//            and diffs the output against the default run"
//
// -----------------------------------------------------------------------------
// WHY THIS FILE IS HERE AND NOT IN packages/rules-engine/test
// -----------------------------------------------------------------------------
// It needs the loader, and an engine test importing the loader would be exactly
// the workspace dependency RI-01 exists to forbid. The arrow between these two
// packages points one way on purpose, and golden-loader's own manifest says so:
// "IT DEPENDS ON THE ENGINE AND THE ENGINE DEPENDS ON NOTHING."
//
// It is `determinism.test.ts` and not `*.golden.test.ts`, so it runs in the
// `unit` project. M01 section 8.1 gives the `RE-D-nn` suite "every commit /
// merge", CI-02 runs `unit` on every push, and `ci.yml` was wired so a suite
// joins the stage BY GLOB with no workflow edit. That property is being used
// here rather than described.
//
// -----------------------------------------------------------------------------
// TWO CORPORA, AND THE VACUITY OF ONE IS DERIVED RATHER THAN NARRATED
// -----------------------------------------------------------------------------
// M01's literal instruction is "the entire golden suite". THE GOLDEN SUITE
// STILL FOLDS `evaluate`, THE SCAFFOLD'S IDENTITY STUB (`run.ts`, and
// `engineIsIdentityStub()` is the probe that says so). Stubbing the clock and
// running a function that returns its own argument proves nothing.
//
// So both gates also run the DEMO corpus, which folds a seeded population
// through the real `advanceDay` and `evaluatePayout` -- 45 of 50 rules -- and
// which therefore makes them bite today.
//
// AND THE SPLIT IS READ OFF THE LOADER, NOT WRITTEN DOWN. The golden half's
// assertions sit behind `describe.runIf(!stubbed)`, so today they appear in the
// log as named skips exactly as CI-03's three end-to-end cases already do, and
// they switch themselves on the day the loader moves to `advanceDay`. ADR-038
// ruled this mechanism and CI-03 already carries it; the alternative is three
// prose statements that all go quietly wrong on the same day, which is the
// drift ADR-034 exists to end.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { REPO_ROOT, engineIsIdentityStub, loadFixtureDirectory, runFixture } from '../src/index.js';
import { DEFAULT_OPTIONS, runDemo } from '../../../scripts/demo/main.js';

const { fixtures, failures } = loadFixtureDirectory();
const stubbed = engineIsIdentityStub();

/** Small enough for a unit stage, long enough that accounts fund, settle and breach. */
const DEMO_OPTIONS = { ...DEFAULT_OPTIONS, days: 20, accountsPerCohort: 1 };

// -----------------------------------------------------------------------------
// The scope, printed on every run
// -----------------------------------------------------------------------------
describe('RE-D-nn: what these gates currently prove', () => {
  test('the corpora and their scope are derived and printed', () => {
    console.log(
      `\n  RE-D-01/02 corpora:\n` +
        `    demo    LIVE      real advanceDay + evaluatePayout fold\n` +
        `    golden  ${stubbed ? 'VACUOUS   the loader still folds `evaluate`, the identity stub' : 'LIVE      the loader folds the engine'}\n` +
        `    fixtures loaded: ${fixtures.length}, load failures: ${failures.length}\n`,
    );

    // A corpus that failed to load is not a corpus that agreed.
    expect(failures).toEqual([]);
    expect(fixtures.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// RE-D-01
// -----------------------------------------------------------------------------
// THE CLOCK SURFACE IS TRAPPED AND THE CALENDAR SURFACE IS NOT, and the
// distinction is M01's own. Section 1.4 bans "`Date.now()`, `new Date()`, ANY
// WALL-CLOCK READ" and the replacement it names is "Trading days arrive as
// inputs". `Date.UTC(y, m, d)` and `new Date(milliseconds)` read no clock: they
// are pure arithmetic over given numbers, which is how this repository's own
// generators build calendars (`day-sequence.ts` states the licence explicitly).
//
// Trapping the whole constructor would therefore fail on test material that is
// behaving correctly, and the fix for that failure would be to weaken the trap.
// Trapping the zero-argument form catches the defect and nothing else.

interface Trap {
  readonly restore: () => void;
  readonly tripped: () => string[];
}

function trapImpurity(): Trap {
  const RealDate = globalThis.Date;
  const realRandom = Math.random;
  const realFetch = globalThis.fetch;
  const hits: string[] = [];

  const fail = (what: string): never => {
    hits.push(what);
    throw new Error(
      `RE-D-01: the fold reached \`${what}\`. M01 INV-01: "The engine performs no ` +
        'I/O and reads no clock." Trading days arrive as inputs.',
    );
  };

  class TrappedDate extends RealDate {
    // `readonly unknown[]` rather than `ConstructorParameters<typeof Date>`,
    // which resolves to ONE overload and makes `args.length === 0` a type error
    // for comparing `1` with `0`. The runtime spread forwards whatever arrives,
    // so the cast is type-level only and every arity still reaches `RealDate`.
    constructor(...args: readonly unknown[]) {
      if (args.length === 0) fail('new Date()');
      super(...(args as [string | number | Date]));
    }
    static override now(): number {
      return fail('Date.now()');
    }
  }

  globalThis.Date = TrappedDate as unknown as DateConstructor;
  Math.random = (): number => fail('Math.random()');
  globalThis.fetch = ((): never => fail('fetch()')) as unknown as typeof fetch;

  return {
    restore: () => {
      globalThis.Date = RealDate;
      Math.random = realRandom;
      globalThis.fetch = realFetch;
    },
    tripped: () => hits,
  };
}

let active: Trap | null = null;
afterEach(() => {
  active?.restore();
  active = null;
});

describe('RE-D-01: the fold performs no I/O and reads no clock', () => {
  test('the trap itself fires, so a green result is not a broken trap', () => {
    // THE ANTI-VACUITY HALF. Every assertion below is "nothing threw", which is
    // exactly what a trap that failed to install would also produce. So the trap
    // is watched catching all three before it is trusted to have caught none.
    const trap = (active = trapImpurity());

    expect(() => Date.now()).toThrow(/RE-D-01/);
    expect(() => new Date()).toThrow(/RE-D-01/);
    expect(() => Math.random()).toThrow(/RE-D-01/);
    expect(() => (globalThis.fetch as unknown as () => void)()).toThrow(/RE-D-01/);

    // And the calendar surface is deliberately still open, or the corpora below
    // would fail for building their own inputs rather than for reading a clock.
    expect(() => Date.UTC(2026, 0, 2)).not.toThrow();
    expect(() => new Date(Date.UTC(2026, 0, 2))).not.toThrow();

    expect(trap.tripped()).toHaveLength(4);
  });

  test('the demo corpus folds clean under the trap', () => {
    // THE HALF THAT BITES TODAY. `runDemo` folds a seeded population through the
    // real `advanceDay` and `evaluatePayout`.
    const expected = runDemo(DEMO_OPTIONS);

    const trap = (active = trapImpurity());
    const underTrap = runDemo(DEMO_OPTIONS);
    trap.restore();
    active = null;

    expect(trap.tripped()).toEqual([]);
    // And it produced the same answer, not merely an answer. A fold that caught
    // the trap's throw internally and degraded would otherwise pass.
    expect(underTrap).toBe(expected);
  });

  test.runIf(!stubbed)('the golden corpus folds clean under the trap', () => {
    const trap = (active = trapImpurity());
    for (const fixture of fixtures) runFixture(fixture);
    trap.restore();
    active = null;
    expect(trap.tripped()).toEqual([]);
  });

  test.skipIf(!stubbed)(
    'the golden corpus is SKIPPED while the loader folds the identity stub',
    () => {
      // Derived, not narrated: this case is selected by `engineIsIdentityStub()`
      // and disappears the day the loader moves. It exists so the skip has a
      // NAME in the log rather than being a silent absence.
      expect(stubbed).toBe(true);
    },
  );
});

// -----------------------------------------------------------------------------
// RE-D-02
// -----------------------------------------------------------------------------
// SPAWNED, NOT WRAPPED, AND THE REASON IS MEASURED. `TZ` can be changed
// in-process; `LC_ALL` cannot, because Node resolves the ICU default locale once
// at startup. PT-06's harness carries that measurement
// (`localeIsProcessScoped()`); this gate is where the consequence lands. A
// same-process locale comparison would pass on every seed forever.

const DIGEST = join(REPO_ROOT, 'scripts/ci/engine-digest.mjs');

const digestUnder = (env: Record<string, string>): string =>
  execFileSync(process.execPath, [DIGEST], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

/** The first line that differs, so a failure names the fixture rather than the corpus. */
function firstDifference(a: string, b: string): string {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return `line ${i + 1}:\n    default: ${left[i] ?? '<absent>'}\n    variant: ${right[i] ?? '<absent>'}`;
    }
  }
  return 'no differing line, but the strings compared unequal';
}

describe('RE-D-02: the fold is invariant under the process timezone and locale', () => {
  const baseline = digestUnder({ TZ: 'UTC', LC_ALL: 'C' });

  test('the digest is not vacuous', () => {
    // Two empty strings compare equal forever. This is the guard that the thing
    // being diffed is a real digest of a real corpus.
    expect(baseline).toContain('demo ');
    expect(baseline).toContain('golden ');
    expect(baseline.split('\n').length).toBeGreaterThan(5);
  });

  test.each([
    ['Asia/Kolkata', 'ja_JP.UTF-8'],
    ['Pacific/Kiritimati', 'tr_TR.UTF-8'],
    ['America/Santiago', 'ar_EG.UTF-8'],
  ])('TZ=%s LC_ALL=%s produces a byte-identical digest', (TZ, LC_ALL) => {
    const variant = digestUnder({ TZ, LC_ALL });
    expect(
      variant === baseline
        ? true
        : `digest differs under TZ=${TZ} LC_ALL=${LC_ALL}. ${firstDifference(baseline, variant)}`,
    ).toBe(true);
  });

  test('and the spawned locale genuinely changed, so the comparison meant something', () => {
    // THE ANTI-VACUITY PAIRING. If the environment were not reaching the child,
    // every digest above would match because nothing varied rather than because
    // nothing depended on what varied. So the same spawn mechanism is watched
    // moving a probe that DOES read the locale.
    const resolved = (LC_ALL: string): string =>
      execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().locale)'],
        { encoding: 'utf8', env: { ...process.env, LC_ALL } },
      );

    expect(resolved('ja_JP.UTF-8')).toBe('ja-JP');
    expect(resolved('tr_TR.UTF-8')).toBe('tr-TR');
  });
});
