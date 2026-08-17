// =============================================================================
// packages/golden-loader/test/harness/environment.ts
// =============================================================================
// PT-06's HARNESS: the process timezone and locale, randomized per case.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT IN packages/rules-engine/test, WHERE PT-06's SUBJECT LIVES
// -----------------------------------------------------------------------------
// IT NEEDS `process` AND THE ENGINE PACKAGE DOES NOT HAVE IT. That package's
// tsconfig sets `types: []`, and its own comment says why: "no ambient
// declarations are in scope at all ... An I/O call inside this package is a
// COMPILE ERROR before it is a lint finding, WHICH IS THE STRONGEST OF THE
// THREE MECHANISMS GUARDING THIS BOUNDARY and the only one a lint-disable
// comment cannot route around." The `include` covers `test/**/*.ts`, so the
// ban reaches the test directory too. This was found by writing the file there
// first and watching `tsc` refuse it five times over.
//
// Widening that `types` array to place a test helper would be weakening a gate
// to pass it, which the working agreements forbid in as many words. So the
// harness lands one package over, for EXACTLY the reason `golden-loader`'s own
// tsconfig already gives for the loader itself: "a loader living inside that
// package could only read a directory by weakening the strongest of the three
// mechanisms guarding the purity boundary."
//
// The engine is still the subject. Nothing here imports its internals, and the
// arrow between the packages still points one way (RI-01).
//
// STRATEGY section 3.1 gives PT-06 as "any permutation of arrival order, any
// process timezone, any locale, yields byte-identical stored state", and names
// what the randomization buys: it "runs with `TZ` and `LC_ALL` randomized per
// case, WHICH IS HOW A `toLocaleDateString` GETS CAUGHT".
//
// P2 section 5 is what schedules it here rather than with the engine: PT-06 is
// "harness yes, assertion no ... the `TZ` and `LC_ALL` randomization and the
// `RE-D-03` dependency-graph assertion are expressible and meaningful today".
//
// -----------------------------------------------------------------------------
// ONE OF THE TWO VARIABLES DOES NOT WORK IN-PROCESS, AND THIS FILE MEASURES IT
// -----------------------------------------------------------------------------
// `TZ` is re-read by V8 on each `Date` operation, so assigning `process.env.TZ`
// mid-process genuinely changes what the process believes the local time is.
// Verified on this tree's Node before this file was written, not assumed:
// the same UTC instant renders at +00:00, +14:00 and +05:30 under three
// successive assignments.
//
// `LC_ALL` DOES NOT BEHAVE THAT WAY. Node resolves the ICU default locale ONCE
// AT STARTUP, so `Intl.DateTimeFormat().resolvedOptions().locale` stays `en-US`
// no matter what is assigned to `process.env.LC_ALL` afterwards, and a bare
// `toLocaleDateString()` keeps formatting `1/2/2026` under a Turkish or
// Japanese `LC_ALL`. The same values passed on the COMMAND LINE do change it
// (`ja-JP` renders `2026/1/2`, `tr-TR` renders `02.01.2026`).
//
// THAT IS NOT A REASON TO DROP THE LOCALE HALF AND IT IS NOT A REASON TO
// PRETEND. A harness that assigned `LC_ALL` and asserted locale invariance
// would pass on every seed forever while proving nothing, which is the
// vacuous-property trap P2 section 5 names by name. So:
//
//   - `localeIsProcessScoped()` MEASURES the fact rather than restating it. It
//     assigns and reads back, so the day a Node release makes the locale
//     re-resolvable the answer changes by itself and the suites that consult it
//     start asserting for real. Nothing has to be remembered.
//   - The locale half is carried ACROSS PROCESSES instead, by
//     `scripts/ci/engine-digest.mjs` under `RE-D-02`, where `LC_ALL` is in the
//     environment before the process starts and therefore does take effect.
//
// The division is honest in both directions: in-process randomization is real
// for the timezone and inert for the locale, and each is asserted where it
// bites rather than where it reads best.
//
// -----------------------------------------------------------------------------
// THE POOLS ARE ADVERSARIAL RATHER THAN ARBITRARY
// -----------------------------------------------------------------------------
// A pool of five European cities would randomize nothing that matters. Each
// entry below is chosen for a defect it can expose.
// =============================================================================

import fc from 'fast-check';

/**
 * Timezones, each carrying a specific hazard.
 *
 * `Pacific/Kiritimati` is the one that matters most for Merit: at UTC+14 the
 * LOCAL date is a day ahead of the UTC date for ten hours out of twenty-four,
 * so any code that derived a trading day from a timestamp would produce
 * yesterday's answer there. That is B4 #1's ban made executable.
 */
export const TZ_POOL: readonly string[] = [
  'UTC',
  // +14:00. The local date leads UTC's for much of the day.
  'Pacific/Kiritimati',
  // -11:00. The mirror image: the local date trails UTC's.
  'Pacific/Niue',
  // +05:30. A half-hour offset, which breaks code that assumes whole hours.
  'Asia/Kolkata',
  // +05:45. A quarter-hour offset, which breaks code that assumes half hours.
  'Asia/Kathmandu',
  // A southern-hemisphere DST regime, so "summer time" runs over the new year.
  'America/Santiago',
  // The exchange's own zone. Present so the ordinary case is in the support too.
  'America/Chicago',
];

/**
 * Locales, each carrying a specific hazard.
 *
 * `tr_TR` is the dotless-i case: in Turkish, upper-casing `i` yields `İ` and
 * lower-casing `I` yields `ı`, so a locale-sensitive case fold turns an
 * identifier into a different identifier. `ja_JP` and `ar_EG` change the
 * numerals and the calendar a date formatter reaches for.
 */
export const LOCALE_POOL: readonly string[] = [
  'C',
  'en_US.UTF-8',
  'tr_TR.UTF-8',
  'ja_JP.UTF-8',
  'ar_EG.UTF-8',
  'de_DE.UTF-8',
];

export interface ProcessEnvironment {
  readonly tz: string;
  readonly locale: string;
}

/** One drawn `(TZ, LC_ALL)` pair. */
export const environmentArbitrary = (): fc.Arbitrary<ProcessEnvironment> =>
  fc.record({
    tz: fc.constantFrom(...TZ_POOL),
    locale: fc.constantFrom(...LOCALE_POOL),
  });

/**
 * Two environments that are guaranteed to DIFFER in both variables.
 *
 * A determinism property drawn from two independent draws would compare a run
 * against itself whenever the two coincided, and at seven timezones that is
 * roughly one case in seven passing without testing anything. The pairing is
 * built rather than filtered so it cannot silently degrade.
 */
export const environmentPairArbitrary = (): fc.Arbitrary<
  readonly [ProcessEnvironment, ProcessEnvironment]
> =>
  fc
    .tuple(
      fc.integer({ min: 0, max: TZ_POOL.length - 1 }),
      fc.integer({ min: 1, max: TZ_POOL.length - 1 }),
      fc.integer({ min: 0, max: LOCALE_POOL.length - 1 }),
      fc.integer({ min: 1, max: LOCALE_POOL.length - 1 }),
    )
    .map(([tzA, tzShift, locA, locShift]: readonly [number, number, number, number]) => {
      const tzB = (tzA + tzShift) % TZ_POOL.length;
      const locB = (locA + locShift) % LOCALE_POOL.length;
      return [
        { tz: TZ_POOL[tzA]!, locale: LOCALE_POOL[locA]! },
        { tz: TZ_POOL[tzB]!, locale: LOCALE_POOL[locB]! },
      ] as const;
    });

/**
 * Run `fn` with the process timezone and locale set, and restore them however
 * it exits.
 *
 * THE RESTORE IS IN A `finally` AND THAT IS LOAD BEARING. A property test that
 * threw while the timezone was `Pacific/Kiritimati` would leave every later
 * case in this process running in a timezone nobody chose, and the resulting
 * failures would point at the wrong test. Deleting the key when it was absent
 * is distinguished from assigning back an empty string, because `TZ=''` is not
 * the same thing to V8 as no `TZ` at all.
 */
export function withEnvironment<T>(env: ProcessEnvironment, fn: () => T): T {
  // Bracket notation throughout: `noPropertyAccessFromIndexSignature` is on in
  // `tsconfig.base.json`, and `process.env` is an index signature.
  const priorTz = process.env['TZ'];
  const priorLocale = process.env['LC_ALL'];

  process.env['TZ'] = env.tz;
  process.env['LC_ALL'] = env.locale;
  try {
    return fn();
  } finally {
    if (priorTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = priorTz;
    if (priorLocale === undefined) delete process.env['LC_ALL'];
    else process.env['LC_ALL'] = priorLocale;
  }
}

/**
 * Whether assigning `process.env.TZ` mid-process actually changes how this
 * process renders an instant.
 *
 * MEASURED, NOT DECLARED. It renders one fixed UTC instant under two entries
 * from the pool and compares. A future runtime that cached the zone would flip
 * this to `false` on its own, and the suites that gate on it would say so
 * instead of continuing to pass while testing nothing.
 */
export function timezoneIsProcessScoped(): boolean {
  const instant = Date.UTC(2026, 0, 2, 3, 0, 0);
  const a = withEnvironment({ tz: 'UTC', locale: 'C' }, () => new Date(instant).toString());
  const b = withEnvironment({ tz: 'Pacific/Kiritimati', locale: 'C' }, () =>
    new Date(instant).toString(),
  );
  return a !== b;
}

/**
 * Whether assigning `process.env.LC_ALL` mid-process actually changes the
 * locale this process formats in.
 *
 * On this tree's Node it is `false`: the ICU default locale is resolved once at
 * startup. See the header. This function is what stops that fact from being a
 * comment somebody has to remember to update.
 */
export function localeIsProcessScoped(): boolean {
  const read = (): string => Intl.DateTimeFormat().resolvedOptions().locale;
  const a = withEnvironment({ tz: 'UTC', locale: 'tr_TR.UTF-8' }, read);
  const b = withEnvironment({ tz: 'UTC', locale: 'ja_JP.UTF-8' }, read);
  return a !== b;
}

/**
 * One line naming what randomization this process can and cannot perform,
 * derived from the two measurements above.
 *
 * ADR-038's mechanism, borrowed: "CI-03 prints what it currently proves." A
 * suite that randomizes an environment variable the runtime ignores is a suite
 * whose green means less than it looks like, and the only defence that does not
 * rot is one that measures itself and says so on every run.
 */
export function describeEnvironmentScope(): string {
  const tz = timezoneIsProcessScoped();
  const locale = localeIsProcessScoped();
  return (
    `PT-06 harness: TZ randomization in-process is ${tz ? 'LIVE' : 'INERT'}; ` +
    `LC_ALL randomization in-process is ${locale ? 'LIVE' : 'INERT'}` +
    (locale ? '' : '. The locale half is carried across processes by RE-D-02 (engine-digest.mjs)')
  );
}
