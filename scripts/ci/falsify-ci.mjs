#!/usr/bin/env node
// =============================================================================
// scripts/ci/falsify-ci.mjs
// =============================================================================
// EVERY GATE CI-01, CI-02 AND CI-05 WIRE, WATCHED FAILING ON A SEEDED VIOLATION
// AIMED AT IT.
//
//   node scripts/ci/falsify-ci.mjs             every case
//   node scripts/ci/falsify-ci.mjs CI-01/vg4   one case
//   node scripts/ci/falsify-ci.mjs list        the cases, and what each seeds
//
// P1 section 6: "Every gate any of these sessions wires ships with a seeded
// violation in falsify.mjs, and must fail on that finding rather than merely
// exit non-zero." STATE says the same thing more sharply: "failing correctly on
// a seeded violation" is TWO checks, not one. Two of the eleven corpus gates
// failed on a truncated tree copy and would have been scored as working.
//
// So every case here states the finding it demands, and a case that exits
// non-zero without producing that finding is reported as FAILED OFF-TARGET
// rather than scored as a pass. That distinction is the whole reason the file
// exists.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO CLEAN PHASE, WHICH scripts/corpus/falsify.mjs HAS
// -----------------------------------------------------------------------------
// falsify.mjs runs each corpus gate twice because nothing else runs them. These
// gates run on the same commit, in their own jobs, minutes before this file
// does: CI-01 lints and type-checks the real tree, CI-02 runs the real suites,
// CI-05 scans the real repository. THE CLEAN DIRECTION IS THE STAGE ITSELF, and
// running it a second time here would double the bill for a second opinion from
// the same command.
//
// -----------------------------------------------------------------------------
// WHERE THE SEEDS LAND
// -----------------------------------------------------------------------------
// Two kinds, and the difference is whether the gate reads the repository.
//
//   IN-TREE   The gate is a workspace command (tsc, eslint, prettier, vitest,
//             pnpm) and only means something against this tree's config. The
//             seed is a real file at a real path, removed in a `finally`, and
//             the run ends by asserting `git status` is clean. A harness that
//             leaves a seeded file behind has planted the next session's bug.
//   TEMP      The gate is a scanner pointed at a directory (gitleaks, semgrep,
//             syft, grype). The seed is a throwaway tree, which is faster and
//             keeps a fake credential out of this repository's history.
//
// EVERY LITERAL A SCANNER WOULD MATCH IS ASSEMBLED FROM FRAGMENTS, so this file
// is not itself a finding when CI-05 scans the repository it lives in. That is
// RI-02's lesson in packages/tooling, which matched its own prose twice, and
// the alternative considered and rejected there was a by-name exclusion: a hole
// in the least visible possible place.
//
// -----------------------------------------------------------------------------
// A MISSING TOOL IS AN ERROR, NOT A SKIP
// -----------------------------------------------------------------------------
// repo-invariants.mjs states the rule and it is inherited here: a check that
// cannot run is not a check that passed. If gitleaks is absent this file exits
// non-zero saying so. Selecting one case by id is the supported way to run a
// subset on a laptop that has not installed four scanners.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The workspace root, two levels up from `scripts/ci`. */
const ROOT = resolve(HERE, '../..');

/** Seeded in-tree files all carry this, so a stray one is greppable. */
const MARK = '__falsify__';

// -----------------------------------------------------------------------------
// Fragment-assembled needles: see the header
// -----------------------------------------------------------------------------

/**
 * The header of a PEM private key block, and VG-1's seed.
 *
 * TWO AWS ACCESS KEY IDS WERE TRIED FIRST AND GITLEAKS WAS RIGHT TO IGNORE
 * BOTH, which is the part worth carrying rather than the constant that
 * replaced them. `AKIA` + `QYLPT7EXAMPLE` + `000` lost to the stopword
 * allowlist, because a placeholder in a code sample is not a leaked
 * credential and `EXAMPLE` is the archetype of one. `AKIA` +
 * `3QF7ZL2XN8VBWK4R` lost as well, so the stopword was not the whole story:
 * the AWS rule carries its own entropy and context conditions, and A
 * SYNTHETIC KEY THAT SATISFIES THE REGEX IS NOT NECESSARILY A THING THE RULE
 * IS WILLING TO REPORT. Both times the harness said `DID NOT FAIL`, and both
 * times THE GATE WAS RIGHT AND THE SEED WAS WRONG, which is the same shape as
 * CI-06e's seed landing on the convention paragraph above EC-001.
 *
 * A PEM header has none of those conditions in front of it: gitleaks'
 * `private-key` rule matches the marker. So the seed exercises THE SCANNER
 * rather than the scanner's opinion about whether a given string looks real,
 * which is the honest choice for a gate whose job is "a secret reached the
 * tree". IT COSTS EXACTLY ONE THING, STATED RATHER THAN IMPLIED: this case
 * proves gitleaks is wired and reading files. It does not prove any particular
 * rule is enabled, and the two AWS attempts are the evidence that those are
 * different claims.
 */
const PRIVATE_KEY_HEADER = ['-----', 'BEGIN RSA PRIVATE KEY', '-----'].join('');

/** The marker comment STRATEGY section 4.5 bans from reaching `main`. */
const BANNED_MARKER = ['TO', 'DO'].join('');

/** A package with long-published advisories, used only as scanner bait. */
const VULNERABLE = { name: 'lodash', version: '4.17.15' };

// -----------------------------------------------------------------------------
// Running things
// -----------------------------------------------------------------------------

/**
 * @typedef {object} Ran
 * @property {number} status
 * @property {string} output  stdout and stderr, joined
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {Ran}
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
  if (result.error) {
    return { status: 127, output: `${result.error.message}` };
  }
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** @type {(name: string) => boolean} */
const onPath = (name) => run('sh', ['-c', `command -v ${name}`]).status === 0;

/** @type {(root: string, rel: string, body: string) => void} */
function write(root, rel, body) {
  mkdirSync(join(root, dirname(rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** A throwaway tree. Collected and removed when the run ends. */
const temps = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'merit-falsify-ci-'));
  temps.push(dir);
  return dir;
}

/**
 * Read a JSON report a scanner wrote, or throw. A scanner that produced no
 * report did not scan, and reading an absent file as "no findings" is how a
 * gate reports green for a run that never happened.
 *
 * @param {string} path
 * @returns {any}
 */
function report(path) {
  if (!existsSync(path)) throw new Error(`the scanner wrote no report at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// -----------------------------------------------------------------------------
// The cases
// -----------------------------------------------------------------------------
//
// Each returns `{ status, output }` from the gate as the seed sees it. The
// runner decides the verdict: non-zero AND every needle present is the only
// result scored as a pass.
//
// `needles` are what the finding must SAY. A case whose needle is merely the
// name of the tool would be satisfied by a crash.

/**
 * @typedef {object} Case
 * @property {string} id
 * @property {string} stage
 * @property {string} seeds     the violation planted, in one line
 * @property {string[]} needles substrings the failure output must contain
 * @property {string[]} [requires] binaries that must be on PATH
 * @property {() => Ran} run
 */

/**
 * An in-tree case: plant files, run the gate, remove them whatever happens.
 *
 * @param {Record<string, string>} files  repo-relative path -> contents
 * @param {() => Ran} gate
 * @returns {Ran}
 */
function seededInTree(files, gate) {
  const planted = Object.keys(files);
  try {
    for (const [rel, body] of Object.entries(files)) write(ROOT, rel, body);
    return gate();
  } finally {
    for (const rel of planted) rmSync(join(ROOT, rel), { force: true });
  }
}

/**
 * An in-tree case that EDITS a tracked file. The original text is restored
 * from memory rather than from git, so the case works on a dirty tree and
 * cannot restore somebody else's uncommitted change by accident.
 *
 * @param {string} rel
 * @param {(before: string) => string} edit
 * @param {() => Ran} gate
 * @returns {Ran}
 */
function seededEdit(rel, edit, gate) {
  const path = join(ROOT, rel);
  const before = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, edit(before));
    return gate();
  } finally {
    writeFileSync(path, before);
  }
}

/** @type {Case[]} */
const CASES = [
  // ---------------------------------------------------------------------------
  // CI-01  Lint and types
  // ---------------------------------------------------------------------------
  {
    id: 'CI-01/types',
    stage: 'CI-01',
    seeds: 'a string assigned to a number, in a package tsc actually reads',
    needles: ['error TS', `${MARK}-types.ts`],
    run: () =>
      seededInTree(
        {
          [`packages/db/src/${MARK}-types.ts`]:
            '// The type error is the point: CI-01 runs tsc --noEmit and must see it.\n' +
            "export const cents: number = 'not a number';\n",
        },
        () => run('pnpm', ['--filter', '@merit/db', 'run', 'typecheck']),
      ),
  },
  {
    id: 'CI-01/vg4',
    stage: 'CI-01',
    seeds: 'a raw PostgreSQL driver imported by an app, which is VG-4 exactly',
    needles: ['merit/no-raw-db-client', `${MARK}-vg4.ts`],
    run: () =>
      seededInTree(
        {
          [`apps/portal/src/${MARK}-vg4.ts`]:
            "import { Pool } from 'pg';\n\nexport const pool = Pool;\n",
        },
        () => run('pnpm', ['exec', 'eslint', `apps/portal/src/${MARK}-vg4.ts`]),
      ),
  },
  {
    id: 'CI-01/engine-purity',
    stage: 'CI-01',
    seeds: "a wall-clock read inside the engine's source",
    needles: ['merit/engine-purity', `${MARK}-purity.ts`],
    run: () =>
      seededInTree(
        {
          [`packages/rules-engine/src/${MARK}-purity.ts`]: 'export const stamp = Date.now();\n',
        },
        () => run('pnpm', ['exec', 'eslint', `packages/rules-engine/src/${MARK}-purity.ts`]),
      ),
  },
  {
    id: 'CI-01/anti-slop',
    stage: 'CI-01',
    seeds: 'a deferred-work marker in a comment, which STRATEGY section 4.5 blocks merge on',
    needles: ['no-warning-comments', `${MARK}-slop.ts`],
    run: () =>
      seededInTree(
        {
          [`apps/site/src/${MARK}-slop.ts`]:
            `// ${BANNED_MARKER}: a gap becomes an EDGE_CASES entry or gets fixed.\n` +
            'export const pending = true;\n',
        },
        () => run('pnpm', ['exec', 'eslint', `apps/site/src/${MARK}-slop.ts`]),
      ),
  },
  {
    id: 'CI-01/format',
    stage: 'CI-01',
    seeds: 'a file Prettier would rewrite, inside the glob format:check reads',
    needles: [`${MARK}-format.ts`],
    run: () =>
      seededInTree(
        {
          [`apps/site/src/${MARK}-format.ts`]: 'export  const   misformatted    =  {a:1,b:2}\n',
        },
        () => run('pnpm', ['run', 'format:check']),
      ),
  },
  {
    id: 'CI-01/invariants',
    stage: 'CI-01',
    seeds: "a workspace dependency in the engine's manifest, which RI-01 exists to reject",
    needles: ['RI-01', 'dependencies.@merit/db'],
    run: () =>
      seededEdit(
        'packages/rules-engine/package.json',
        (before) => {
          const manifest = JSON.parse(before);
          manifest.dependencies = { '@merit/db': 'workspace:*' };
          return `${JSON.stringify(manifest, null, 2)}\n`;
        },
        () => run('node', ['packages/tooling/checks/repo-invariants.mjs', 'RI-01']),
      ),
  },

  // ---------------------------------------------------------------------------
  // CI-02  Unit and property
  // ---------------------------------------------------------------------------
  {
    id: 'CI-02/unit',
    stage: 'CI-02',
    seeds: 'a failing assertion in the `unit` project',
    needles: [`${MARK}-unit.test.ts`],
    run: () =>
      seededInTree(
        {
          [`apps/site/test/${MARK}-unit.test.ts`]:
            "import { expect, test } from 'vitest';\n\n" +
            "test('the stage must go red for this', () => {\n" +
            '  expect(1).toBe(2);\n' +
            '});\n',
        },
        () => run('pnpm', ['exec', 'vitest', 'run', '--project', 'unit']),
      ),
  },
  {
    id: 'CI-02/property',
    stage: 'CI-02',
    seeds: 'a falsifiable property in the `property` project, which fast-check must shrink to',
    needles: [`${MARK}-prop.property.test.ts`],
    run: () =>
      seededInTree(
        {
          [`packages/rules-engine/test/${MARK}-prop.property.test.ts`]:
            "import fc from 'fast-check';\n" +
            "import { expect, test } from 'vitest';\n\n" +
            "test('a property that is not true', () => {\n" +
            '  fc.assert(\n' +
            '    fc.property(fc.integer(), (n) => {\n' +
            '      expect(n).toBeGreaterThanOrEqual(0);\n' +
            '    }),\n' +
            '  );\n' +
            '});\n',
        },
        () => run('pnpm', ['exec', 'vitest', 'run', '--project', 'property']),
      ),
  },

  // ---------------------------------------------------------------------------
  // CI-02  THE ENGINE'S RULES, EACH WATCHED FAILING ON A MUTANT OF ITSELF
  // ---------------------------------------------------------------------------
  // The two cases above prove the STAGE goes red. These prove the RULES do, and
  // the difference is the whole reason they exist.
  //
  // M01 section 8.4's coverage rule is "every rule has at least one unit test
  // asserting its OPERATOR at the boundary on both sides", and ADR-048 then
  // rests the golden stage's polarity on that series being real: a declared rule
  // whose unit test does not actually bite would flip its fixtures to `direct`
  // and prove nothing. A test that still passes when its operator is flipped is
  // a test asserting nothing, and that is checkable from outside the test.
  //
  // EACH NEEDLE IS THE `RE-U-nn` TITLE, not merely a non-zero exit. A mutant
  // that makes some other test fail is FAILED OFF-TARGET, which is the
  // distinction this file was written to keep.
  ...[
    {
      rule: 'R-02',
      // THE MUTANT IS DATE ARITHMETIC, WHICH IS THE ONE R-02 NAMES BY NAME
      // ("never date arithmetic"). It is seeded on `tradingDaysBetween` because
      // that is where the substitution is tempting and where it is INVISIBLE on
      // every consecutive window: `CME_WINDOW`'s five days answer 4 either way,
      // and only `GAPPED_SLICE` tells them apart. A gap counted in calendar days
      // is R-37's cadence gate reading 7 where the exchange traded 5, which is
      // AS-06 arriving as a money gate rather than as a display bug.
      seeds:
        'the gap count reaching for a date difference instead of `sequence` subtraction, which agrees on every consecutive window and disagrees across a holiday (AS-06)',
      file: 'packages/rules-engine/src/calendar.ts',
      from: 'return { found: true, tradingDays: to.day.sequence - from.day.sequence };',
      to: 'return { found: true, tradingDays: (Number(to.day.tradingDay.slice(8)) - Number(from.day.tradingDay.slice(8))) };',
    },
    {
      rule: 'R-06',
      seeds:
        'DO-1’s strictly-forward guard relaxed from `<=` to `<`, so re-applying the day the state already carries folds it a second time instead of refusing (INV-14)',
      file: 'packages/rules-engine/src/day/advance.ts',
      from: 'if (input.prior !== null && mark.tradingDay <= input.prior.tradingDay) {',
      to: 'if (input.prior !== null && mark.tradingDay < input.prior.tradingDay) {',
    },
    {
      rule: 'R-10',
      // THE MUTANT IS THE ADJUSTMENT MOVED FROM THE OPENING IDENTITY TO THE
      // CLOSING ONE, which is R-10's "never inside a session" written the wrong
      // way round and is AS-10 exactly: with the term inside INV-19, a settled
      // withdrawal is arithmetically indistinguishable from a day of trading
      // losses. The day still folds, so nothing crashes; what changes is that
      // the one identity that would have caught a misplaced movement now
      // ACCEPTS it and the one that should not have a term for it now does.
      seeds:
        'the adjustment moved out of INV-18’s opening identity and into INV-19’s closing one, so a settled withdrawal reads as a session loss (AS-10, SD-01)',
      file: 'packages/rules-engine/src/day/advance.ts',
      from: 'const expectedClosing = mark.openingBalanceCents + mark.realizedPnlCents;',
      to: 'const expectedClosing = mark.openingBalanceCents + mark.realizedPnlCents + mark.adjustmentCents;',
    },
    {
      rule: 'R-21',
      seeds: 'the floor breach comparator relaxed from `<` to `<=`, so touching the floor breaches',
      file: 'packages/rules-engine/src/day/breach.ts',
      from: 'mark.lowBalanceCents < input.floorOpenCents',
      to: 'mark.lowBalanceCents <= input.floorOpenCents',
    },
    {
      rule: 'R-22',
      seeds:
        'the hard daily-loss-limit comparator moved from `>` to `>=`, which is the spelling M01 section 3.6 pseudocode carries and R-22 rejects',
      file: 'packages/rules-engine/src/day/breach.ts',
      from: "dailyLossLimit.type === 'hard' && lossCents > dailyLossLimit.limitCents",
      to: "dailyLossLimit.type === 'hard' && lossCents >= dailyLossLimit.limitCents",
    },
    {
      rule: 'R-09',
      seeds:
        'the win-day comparator tightened from `>=` to `>`, so a day exactly at the floor stops counting',
      file: 'packages/rules-engine/src/day/counters.ts',
      from: 'mark.realizedPnlCents >= winDayFloorCents',
      to: 'mark.realizedPnlCents > winDayFloorCents',
    },
    {
      rule: 'R-13',
      seeds:
        'the trailing floor handed the intraday high instead of the close, which is GS-011 exactly',
      file: 'packages/rules-engine/src/day/advance.ts',
      // The first occurrence is DO-7's call into `advanceFloor`; the later ones
      // are `balanceCents:` and the `day.closed` payload, and neither matches.
      from: 'closingBalanceCents: mark.closingBalanceCents,',
      to: 'closingBalanceCents: mark.highBalanceCents,',
    },
    {
      rule: 'R-15',
      // THIS MUTANT IS A DEFECT THE ENGINE SHIPPED WITH, seeded back. R-15
      // assigned the locked value where section 3.4's binding expression takes
      // a `max`, so a day that jumped past the trigger dropped the floor below
      // where R-13 had just trailed it. It survived because `RE-U-015` only
      // landed ON the trigger, where the two numbers agree by CV-12.
      //
      // It now fails TWICE OVER, which is the point of keeping it: the
      // expectation goes red, and R-14's tripwire throws INV-06 before it gets
      // there. A mutant that only one of the two catches would not have proved
      // the tripwire was strengthened.
      seeds:
        "the floor lock assigning `floor_lock_floor_at_cents` instead of taking section 3.4's `max`, which lowers the floor on a day that jumps past the trigger",
      file: 'packages/rules-engine/src/day/floor.ts',
      from:
        'floorCents =\n' +
        '      trailedFloorCents > drawdown.lock.floorAtCents\n' +
        '        ? trailedFloorCents\n' +
        '        : drawdown.lock.floorAtCents;',
      to: 'floorCents = drawdown.lock.floorAtCents;',
    },
    {
      rule: 'R-26',
      seeds:
        'the eval profit target tightened from `>=` to `>`, so an account exactly at its target stops passing (GS-017)',
      file: 'packages/rules-engine/src/day/progression.ts',
      from: 'const targetMet = profitCents >= evalRules.profitTargetCents;',
      to: 'const targetMet = profitCents > evalRules.profitTargetCents;',
    },
    {
      rule: 'R-27',
      seeds:
        'the eval minimum-trading-days gate tightened from `>=` to `>`, so an account exactly at the minimum stops passing',
      file: 'packages/rules-engine/src/day/progression.ts',
      from: 'const daysMet = state.tradedDaysCount >= evalRules.minTradingDays;',
      to: 'const daysMet = state.tradedDaysCount > evalRules.minTradingDays;',
    },
    {
      rule: 'R-28',
      seeds:
        'the consistency deferral turned into a pass, which is the half of R-28 that gets lost: it delays, it never fails, and it must not silently allow either',
      file: 'packages/rules-engine/src/day/progression.ts',
      from: 'if (!verdict.ok) {',
      to: 'if (false && !verdict.ok) {',
    },
    {
      rule: 'R-29',
      seeds:
        'the consistency comparison tightened from `<=` to `<`, so a best day exactly at the threshold stops passing (GS-023)',
      file: 'packages/rules-engine/src/day/consistency.ts',
      from: 'const ok = bestDayCents * 10_000n <= limitBp * periodProfitCents;',
      to: 'const ok = bestDayCents * 10_000n < limitBp * periodProfitCents;',
    },
    {
      rule: 'R-30',
      seeds:
        "the denominator rule relaxed from `<= 0n` to `< 0n`, so a zero-profit period is EVALUATED instead of skipped, which is GS-021 and the near miss of FM-15's divide by zero",
      file: 'packages/rules-engine/src/day/consistency.ts',
      from: 'if (periodProfitCents <= 0n) {',
      to: 'if (periodProfitCents < 0n) {',
    },
    {
      rule: 'R-31',
      seeds:
        'the funded reset carrying the eval profit instead of resetting to `size_cents`, which is AS-14 written into the engine rather than arriving from the platform',
      file: 'packages/rules-engine/src/day/progression.ts',
      from: 'balanceCents: plan.sizeCents,',
      to: 'balanceCents: mark.closingBalanceCents,',
    },
    {
      rule: 'R-35',
      // THE `max` IS THE RULE AND NOT DEFENSIVE CODE. Dropping it turns a
      // profitable account sitting inside its buffer into a NEGATIVE
      // withdrawable, which is INV-05 ("`withdrawable_cents >= 0` always")
      // violated by the one expression M01 says enforces it: "Formula floors at
      // zero (R-35)". GS-025 is exactly this input, at -10,000c.
      seeds:
        'the withdrawable formula stripped of its floor, so a balance inside the buffer reports a negative amount (GS-025, INV-05)',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: 'return surplus > 0n ? surplus : 0n;',
      to: 'return surplus;',
    },
    {
      rule: 'R-33',
      // CV-19's zero DISABLES the gate. Reading the zero as an ordinary
      // threshold makes it pass for the wrong reason and, worse, report
      // `skipped: false`, so GS-080's disabled gate renders as a satisfied one
      // on every eligibility screen in the lineup.
      seeds:
        'the funded minimum-days gate treating a configured zero as a threshold rather than as disabled (CV-19, GS-080)',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: 'const tradedDaysSkipped = funded.minTradingDays === 0;',
      to: 'const tradedDaysSkipped = false;',
    },
    {
      rule: 'R-34',
      seeds:
        'the win-day gate tightened from `>=` to `>`, so an account exactly at its required count stops being eligible',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: 'pass: state.winDaysCount >= funded.winDaysRequiredCount,',
      to: 'pass: state.winDaysCount > funded.winDaysRequiredCount,',
    },
    {
      rule: 'R-36',
      // The funded gate reading the EVAL consistency block. On Core EOD that is
      // `enabled: false`, so the gate would pass unconditionally and the 3000bp
      // funded limit would stop existing, silently, on the plan that carries it.
      seeds:
        'funded consistency reading the EVAL consistency block, which is disabled on Core EOD and would delete the gate',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: '    funded.consistency,\n  );',
      to: '    plan.eval?.consistency ?? funded.consistency,\n  );',
    },
    {
      rule: 'R-37',
      seeds:
        'the cadence gap relaxed from `>=` to `>` against a count that is already a difference, so a cleared gap reads as one day short',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: 'const pass = counted.tradingDays >= needTradingDays;',
      to: 'const pass = counted.tradingDays > needTradingDays;',
    },
    {
      rule: 'R-38',
      // AS-01, live. Dropping the in-flight term lets a trader fire a second and
      // third request against a state whose reset has not happened yet: "on
      // CORE-50K that converts one qualifying stretch into 3 x 150,000c of
      // approved payouts, against a withdrawable that only ever supported one."
      seeds:
        'the one-in-flight control dropped from the context conjunction, which is AS-01 with the engine’s first line of defence removed',
      file: 'packages/rules-engine/src/payout/evaluate.ts',
      from: '    reconClear.pass &&\n    noPayoutInFlight.pass;',
      to: '    reconClear.pass;',
    },
    {
      rule: 'R-40',
      // R-40 requires the account to be `active` AND the phase to be `funded`.
      // Dropping the phase term makes an eval or graduated account context
      // eligible, which is the half a status check alone cannot see.
      seeds: 'the context gate losing R-40’s phase term, so a graduated account reads as payable',
      file: 'packages/rules-engine/src/payout/evaluate.ts',
      from: "pass: external.accountStatus === 'active' && state.phase === 'funded',",
      to: "pass: external.accountStatus === 'active',",
    },
    {
      rule: 'R-39',
      seeds:
        'the minimum-payout gate tightened from `>=` to `>`, so exactly 100.00 stops being eligible (GS-042, CV-15)',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: 'pass: payable >= funded.minPayoutCents,',
      to: 'pass: payable > funded.minPayoutCents,',
    },
    {
      rule: 'R-41',
      // INV-15 is "with NO SHORTCUT PATH". Dropping one term from the
      // conjunction is that shortcut, and the win-day gate is the term a v1
      // plan can actually fail while every other one holds.
      seeds:
        'the eligibility conjunction losing its win-day term, which is INV-15’s shortcut path in one line',
      file: 'packages/rules-engine/src/payout/gates.ts',
      from: '    gates.winDays.pass &&\n',
      to: '',
    },
    {
      rule: 'R-42',
      // The scan keeps the LAST matching rung. Taking the FIRST is the reading a
      // single-rung lineup cannot distinguish: all three v1 plans carry one
      // entry, so this mutant is invisible on every published config and changes
      // the cap on the first plan that ladders one.
      seeds:
        'cap resolution taking the FIRST rung at or below the ordinal instead of the LAST, which no v1 plan can tell apart',
      file: 'packages/rules-engine/src/payout/clamp.ts',
      from: 'if (step.fromOrdinal <= ordinal) capCents = step.capCents;',
      to: 'if (step.fromOrdinal <= ordinal && capCents === null) capCents = step.capCents;',
    },
    {
      rule: 'R-43',
      // INV-10 is `approved = min(effective_request, cap, withdrawable)`. Drop
      // the cap term and a supplied amount is clamped only by the withdrawable,
      // which is a per-request liability limit removed on the money path.
      seeds:
        'the clamp losing its cap term, so a supplied amount is bounded only by the withdrawable (INV-10, GS-026)',
      file: 'packages/rules-engine/src/payout/clamp.ts',
      from: 'const approvedCents = min(min(effectiveRequestCents, capCents), withdrawable);',
      to: 'const approvedCents = min(effectiveRequestCents, withdrawable);',
    },
    {
      rule: 'R-44',
      // The ceiling is what makes the rounding favor the trader. Truncating
      // moves at most one cent per payout to the firm, which is the direction
      // R-44 forbids and the published copy denies.
      seeds:
        'the split truncating instead of ceiling, so the remainder cent goes to the firm (GS-029, RE-P-08)',
      file: 'packages/rules-engine/src/payout/clamp.ts',
      from: 'const traderCents = (approvedCents * BigInt(splitBp) + 9_999n) / 10_000n;',
      to: 'const traderCents = (approvedCents * BigInt(splitBp)) / 10_000n;',
    },
    {
      rule: 'R-45',
      // AS-11 written into the engine: an ordinal counted from ATTEMPTS rather
      // than settlements advances the cap schedule and the graduation counter
      // for money that never arrived.
      seeds:
        'the payout ordinal counted from attempts rather than settlements, which is AS-11 and costs a ladder rung per failed transfer',
      file: 'packages/rules-engine/src/payout/clamp.ts',
      from: 'return state.payoutsSettledCount + 1;',
      to: 'return state.payoutsSettledCount + 2;',
    },
    {
      rule: 'R-19',
      // ADR-014's whole ruling in one line, reinstated. A settlement that
      // recomputes the floor under the dropped balance hands back the loss room
      // the founder deliberately removed, and it moves the floor DOWN, which is
      // INV-06 with no exception and no settlement carve-out.
      seeds:
        'a post-payout floor recompute reinstated, which ADR-014 removed and CV-18 pins to `none`',
      file: 'packages/rules-engine/src/payout/settle.ts',
      from: '    balanceCents: state.balanceCents - fact.approvedCents,',
      to:
        '    balanceCents: state.balanceCents - fact.approvedCents,\n' +
        '    floorCents: state.balanceCents - fact.approvedCents - plan.funded.drawdown.drawdownCents,',
    },
    {
      rule: 'R-46',
      // SD-02: "the two anchors are genuinely different dates and conflating
      // them is a silent liability change of 40 percent (EC-039)". On the v1
      // lineup the two dates coincide, so this mutant is invisible on every
      // published scenario and bites the first time settlement stops being
      // instant.
      seeds:
        'the cadence anchor set from the BASIS day instead of the wallet-credit day, conflating SD-02’s two anchors (EC-039)',
      file: 'packages/rules-engine/src/payout/settle.ts',
      from: 'cadenceAnchorDay: fact.effectiveTradingDay,',
      to: 'cadenceAnchorDay: fact.basisTradingDay,',
    },
    {
      rule: 'R-47',
      // AS-12 exactly: "if the basis day is included in the new consistency
      // period, the very day that funded a payout counts against the next
      // cycle ... and it looks like the consistency rule working rather than a
      // bug."
      seeds:
        'the consistency period starting ON the basis day rather than strictly after it, which is AS-12’s off-by-one',
      file: 'packages/rules-engine/src/payout/settle.ts',
      from: 'consistencyPeriodStartDay: periodStart.day.tradingDay,\n\n    payoutsSettledCount:',
      to: 'consistencyPeriodStartDay: fact.basisTradingDay,\n\n    payoutsSettledCount:',
    },
    {
      rule: 'R-48',
      // R-19's other two fields. The floor is the obvious one; the HIGH-WATER
      // BALANCE is the one a recompute would reach for next, and dropping it to
      // the post-payout balance would let R-13 re-trail from a lower high on
      // every subsequent day, which lowers the floor by a route the floor's own
      // tripwire never sees.
      seeds:
        'the high-water balance dropped to the post-payout balance, so R-13 re-trails from a lower high forever after',
      file: 'packages/rules-engine/src/payout/settle.ts',
      from: '    payoutsSettledCount: state.payoutsSettledCount + 1,',
      to:
        '    highWaterBalanceCents: state.balanceCents - fact.approvedCents,\n' +
        '    payoutsSettledCount: state.payoutsSettledCount + 1,',
    },
    {
      rule: 'R-49',
      seeds:
        'the ladder tightened from `>=` to `>`, so an account settles one payout past its own graduation rung',
      file: 'packages/rules-engine/src/payout/settle.ts',
      from: 'const graduated = settled.payoutsSettledCount >= plan.funded.maxPayouts;',
      to: 'const graduated = settled.payoutsSettledCount > plan.funded.maxPayouts;',
    },
    {
      rule: 'R-50',
      // INV-17's bound is `ladder * max cap`, and a lifetime counter that does
      // not accumulate makes RE-P-17 assert nothing at all.
      seeds:
        'lifetime settled failing to accumulate, which is the counter INV-17’s liability bound is asserted against',
      file: 'packages/rules-engine/src/payout/settle.ts',
      from: 'lifetimeSettledCents: state.lifetimeSettledCents + fact.approvedCents,',
      to: 'lifetimeSettledCents: fact.approvedCents,',
    },
  ].map(({ rule, seeds, file, from, to }) => ({
    id: `CI-02/engine-${rule}`,
    stage: 'CI-02',
    seeds,
    needles: [`RE-U-0${rule.slice(2)}`, rule],
    run: () =>
      seededEdit(
        file,
        (before) => {
          // A MUTATION THAT DID NOT APPLY IS NOT A CLEAN RUN, it is a case that
          // tested nothing. The gate would pass and the runner would report DID
          // NOT FAIL, which reads as "the test is weak" when the truth is "the
          // seed missed". Throwing names which of the two happened.
          if (!before.includes(from)) {
            throw new Error(`the ${rule} mutant found no "${from}" in ${file}`);
          }
          return before.replace(from, to);
        },
        () => run('pnpm', ['exec', 'vitest', 'run', '--project', 'unit']),
      ),
  })),

  // ---------------------------------------------------------------------------
  // CI-05  Security static
  // ---------------------------------------------------------------------------
  {
    id: 'CI-05/gitleaks',
    stage: 'CI-05',
    seeds: 'a PEM private key block sitting in a source tree',
    needles: [PRIVATE_KEY_HEADER],
    requires: ['gitleaks'],
    run: () => {
      const dir = temp();
      // The body is not a key and does not need to be: the `private-key` rule
      // matches the marker. A real key here would be a real key in a CI log.
      write(
        dir,
        'deploy/id_rsa',
        [
          PRIVATE_KEY_HEADER,
          'bm90IGEga2V5LiB0aGlzIGlzIHRoZSBzZWVkZWQgdmlvbGF0aW9uIENJLTA1IGV4aXN0cw==',
          'dG8gY2F0Y2gsIGFuZCBnaXRsZWFrcyBtYXRjaGVzIHRoZSBtYXJrZXIgcmF0aGVyIHRoYW4=',
          PRIVATE_KEY_HEADER.replace('BEGIN', 'END'),
          '',
        ].join('\n'),
      );
      const out = join(dir, 'gitleaks.json');
      const ran = run('gitleaks', [
        'dir',
        dir,
        '--report-format',
        'json',
        '--report-path',
        out,
        '--no-banner',
        '--exit-code',
        '1',
      ]);
      // The console output is version-dependent and the report is not, so the
      // needle is matched against the REPORT. A gate scored on a tool's
      // pretty-printer is a gate that breaks on a release note.
      const findings = report(out);
      return { status: ran.status, output: `${ran.output}\n${JSON.stringify(findings)}` };
    },
  },
  {
    id: 'CI-05/semgrep',
    stage: 'CI-05',
    seeds: 'a plan parameter read from the environment, which DATA_MODEL section 12 forbids',
    needles: ['merit-plan-parameter-from-env'],
    requires: ['semgrep'],
    run: () => {
      const dir = temp();
      write(
        dir,
        'apps/portal/src/limits.ts',
        'export const cap = Number(process.env.DAILY_LOSS_CAP_BP);\n',
      );
      const out = join(dir, 'semgrep.json');
      const ran = run('semgrep', [
        'scan',
        '--config',
        join(ROOT, '.semgrep/merit.yml'),
        '--json',
        '--json-output',
        out,
        '--quiet',
        '--error',
        '--metrics=off',
        dir,
      ]);
      const findings = report(out);
      return { status: ran.status, output: `${ran.output}\n${JSON.stringify(findings)}` };
    },
  },
  {
    id: 'CI-05/sbom-scan',
    stage: 'CI-05',
    seeds: 'a dependency with published advisories, catalogued by syft and matched by grype',
    needles: [VULNERABLE.name, 'GHSA-'],
    requires: ['syft', 'grype'],
    run: () => {
      const dir = temp();
      // Two shapes of the same fact, because syft's JavaScript cataloguers read
      // the lockfile and the installed manifest by different routes and this
      // case is about grype, not about which cataloguer fired.
      write(
        dir,
        'package-lock.json',
        `${JSON.stringify(
          {
            name: 'merit-falsify-seed',
            version: '0.0.0',
            lockfileVersion: 1,
            dependencies: { [VULNERABLE.name]: { version: VULNERABLE.version } },
          },
          null,
          2,
        )}\n`,
      );
      write(
        dir,
        `node_modules/${VULNERABLE.name}/package.json`,
        `${JSON.stringify({ name: VULNERABLE.name, version: VULNERABLE.version }, null, 2)}\n`,
      );

      const sbom = join(dir, 'sbom.cdx.json');
      const built = run('syft', ['scan', `dir:${dir}`, '-o', `cyclonedx-json=${sbom}`, '-q']);
      if (built.status !== 0) {
        return { status: built.status, output: `syft failed to build an SBOM\n${built.output}` };
      }
      const out = join(dir, 'grype.json');
      const ran = run('grype', [
        `sbom:${sbom}`,
        '-o',
        'json',
        '--file',
        out,
        '--fail-on',
        'low',
        '-q',
      ]);
      const findings = report(out);
      return {
        status: ran.status,
        output: `${ran.output}\n${JSON.stringify(findings.matches ?? findings)}`,
      };
    },
  },
  {
    id: 'CI-05/audit',
    stage: 'CI-05',
    seeds: 'the same dependency, resolved into a lockfile, so `pnpm audit` has something to report',
    needles: [VULNERABLE.name],
    run: () => {
      const dir = temp();
      write(
        dir,
        'package.json',
        `${JSON.stringify(
          {
            name: 'merit-falsify-seed',
            version: '0.0.0',
            private: true,
            dependencies: { [VULNERABLE.name]: VULNERABLE.version },
          },
          null,
          2,
        )}\n`,
      );
      const resolved = run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], {
        cwd: dir,
      });
      if (resolved.status !== 0) {
        return {
          status: resolved.status,
          output: `pnpm could not resolve the seed\n${resolved.output}`,
        };
      }
      return run('pnpm', ['audit', '--audit-level=moderate'], { cwd: dir });
    },
  },
  {
    id: 'CI-05/frozen-lockfile',
    stage: 'CI-05',
    seeds: 'a dependency added to a manifest and not to the lockfile, which is VG-12 in one line',
    needles: ['ERR_PNPM_OUTDATED_LOCKFILE'],
    run: () =>
      seededEdit(
        'package.json',
        (before) => {
          const manifest = JSON.parse(before);
          // A real, tiny, long-published package: the point is that the
          // LOCKFILE does not mention it, not what it does.
          manifest.devDependencies = { ...manifest.devDependencies, 'left-pad': '1.3.0' };
          return `${JSON.stringify(manifest, null, 2)}\n`;
        },
        () => run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']),
      ),
  },
];

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

/**
 * A tool's own output, indented and bounded, for the two verdicts where the
 * reader's next question is "what did it actually say".
 *
 * @param {string} output
 * @returns {string}
 */
function indent(output) {
  const LIMIT = 4000;
  const body = output.length > LIMIT ? `${output.slice(0, LIMIT)}\n[truncated]` : output;
  return body
    .split('\n')
    .map((line) => `        | ${line}`)
    .join('\n');
}

/** Remove any seeded file a killed run left behind, before and after. */
function sweep() {
  const found = run('sh', [
    '-c',
    `find apps packages -name '*${MARK}*' -not -path '*/node_modules/*' 2>/dev/null || true`,
  ]);
  const stale = found.output.split('\n').filter(Boolean);
  for (const rel of stale) rmSync(join(ROOT, rel), { force: true });
  return stale;
}

function main() {
  const [arg] = process.argv.slice(2);

  if (arg === 'list') {
    for (const c of CASES) {
      const needs = c.requires?.length ? `  [needs ${c.requires.join(', ')}]` : '';
      console.log(`${c.id.padEnd(22)} ${c.stage}${needs}\n      seeds:  ${c.seeds}`);
      console.log(`      demands: ${c.needles.join(' + ')}\n`);
    }
    return 0;
  }

  // A stage name selects every case aimed at that stage, so each CI job runs
  // its OWN seeds in its own runner rather than a fourth job re-installing four
  // scanners to run everybody's. A stage that proves itself is also a stage
  // that cannot be left green by a falsification job somebody deleted.
  const selected = arg ? CASES.filter((c) => c.id === arg || c.stage === arg) : CASES;
  if (selected.length === 0) {
    console.error(`no such case or stage: ${arg}. Try: list`);
    return 2;
  }

  // The assertion is that the harness CHANGES NOTHING, not that the tree was
  // clean to begin with. A session runs this over its own uncommitted work, and
  // a check phrased as "git status is empty" would fail on the working state
  // rather than on a surviving seed, which is a gate failing for a reason
  // nobody planted.
  const before = run('git', ['status', '--porcelain']).output;

  const swept = sweep();
  if (swept.length > 0) {
    console.log(`Swept ${swept.length} seeded file(s) a previous run left behind:`);
    for (const rel of swept) console.log(`  ${rel}`);
    console.log('');
  }

  console.log('SEEDED VIOLATIONS: each gate must FAIL, and fail ON the seeded finding\n');

  let failed = 0;
  for (const testCase of selected) {
    const missing = (testCase.requires ?? []).filter((bin) => !onPath(bin));
    if (missing.length > 0) {
      // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED.
      console.log(`  ERROR                 ${testCase.id}  <- ${testCase.seeds}`);
      console.log(`        not on PATH: ${missing.join(', ')}. Install it or select another case`);
      failed++;
      continue;
    }

    /** @type {Ran} */
    let result;
    try {
      result = testCase.run();
    } catch (err) {
      console.log(`  ERROR                 ${testCase.id}  <- ${testCase.seeds}`);
      console.log(`        ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }

    const absent = testCase.needles.filter((n) => !result.output.includes(n));

    if (result.status === 0) {
      console.log(`  DID NOT FAIL          ${testCase.id}  <- ${testCase.seeds}`);
      console.log('        The gate accepted a violation aimed straight at it.');
      // WHAT THE TOOL ACTUALLY SAID, because the alternative is guessing. The
      // gitleaks seed took two rounds to settle and both were spent inferring
      // a reason from an exit code; the tool had the answer each time and
      // nothing printed it. A harness that reports a verdict and withholds the
      // evidence makes its own findings expensive.
      console.log(indent(result.output));
      failed++;
    } else if (absent.length > 0) {
      console.log(`  FAILED OFF-TARGET     ${testCase.id}  <- ${testCase.seeds}`);
      console.log(`        exited ${result.status} without saying: ${absent.join(', ')}`);
      console.log('        A gate that fails for a reason nobody planted proves nothing.');
      console.log(indent(result.output));
      failed++;
    } else {
      console.log(`  failed as required    ${testCase.id}  <- ${testCase.seeds}`);
      console.log(`        found: ${testCase.needles.join(' + ')}`);
    }
  }

  const left = sweep();
  if (left.length > 0) {
    console.log(`\nSeeded file(s) survived the run and were removed: ${left.join(', ')}`);
  }
  const after = run('git', ['status', '--porcelain']).output;
  if (after !== before) {
    console.log('\nTHE HARNESS CHANGED THE TREE. Before, then after:');
    console.log(before);
    console.log('---');
    console.log(after);
    console.log('A harness that leaves a seed behind has planted the next bug.');
    failed++;
  }

  console.log(
    `\n${selected.length - failed} of ${selected.length} gate(s) were watched failing on ` +
      'the violation aimed at them.',
  );
  return failed ? 1 : 0;
}

// `exitCode` rather than `exit()`: if `main` throws, the exception still
// propagates and Node exits non-zero on its own, and the temporary trees are
// still removed. An explicit `exit()` in a `try` would have to re-decide what a
// thrown error means, which is a second expression of "this run did not pass".
try {
  process.exitCode = main();
} finally {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}
