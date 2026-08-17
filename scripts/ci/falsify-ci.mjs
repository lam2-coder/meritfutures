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

// -----------------------------------------------------------------------------
// A KILLED RUN MUST NOT LEAVE A MUTANT IN THE TREE
// -----------------------------------------------------------------------------
// `seededEdit` and `seededInTree` restore in a `finally`, and A `finally` DOES
// NOT RUN WHEN THE PROCESS IS KILLED. This suite takes minutes, so it is
// routinely killed: a CI timeout, an impatient laptop, a session harness with a
// two-minute budget. The mutation then survives as an uncommitted working-tree
// edit, and the next thing to touch the tree is a `git add -A`.
//
// THIS IS NOT HYPOTHETICAL AND IT HAPPENED TWICE IN ONE SESSION. A timed-out run
// left the `R-33` mutant in `gates.ts` (`tradedDaysSkipped` pinned to `false`,
// so CV-19's disabled gate reads as SATISFIED rather than skipped, which is
// GS-080's exact failure), and the retry that proved the fix left `R-37`'s. The
// first was caught only because the next run's own "the mutant found no ..."
// error fired against the already-mutated line. That is the harness noticing by
// luck, and it is one `git add -A` away from a seeded money-path defect landing
// on a branch.
//
// A SIGNAL HANDLER IS NOT THE FIX AND WAS TRIED FIRST. The gate runs its child
// SYNCHRONOUSLY, so node is blocked inside the spawn for the whole of each case
// and a queued handler cannot run until it returns. `SIGKILL` is uncatchable in
// any case. So the restore has to survive the process dying at an arbitrary
// instant, which means it has to be ON DISK BEFORE THE MUTATION IS.
//
// The journal is written before each seed and truncated after it, and the next
// run restores from it and says so. Recovery is therefore automatic and LOUD:
// silent recovery would hide a harness that crashes every run.
const JOURNAL = join(ROOT, '.falsify-pending.json');

/** @type {Map<string, string | null>} path -> original contents, `null` when it did not exist */
const PENDING = new Map();

function writeJournal() {
  if (PENDING.size === 0) {
    rmSync(JOURNAL, { force: true });
    return;
  }
  writeFileSync(JOURNAL, JSON.stringify(Object.fromEntries(PENDING), null, 2));
}

/** Record a file's pre-seed state, ON DISK, before it is touched. */
function beginSeed(paths) {
  for (const path of paths) {
    PENDING.set(path, existsSync(path) ? readFileSync(path, 'utf8') : null);
  }
  writeJournal();
}

/** Put the files back and drop them from the journal. */
function endSeed(paths) {
  for (const path of paths) {
    const before = PENDING.get(path);
    if (before === null) rmSync(path, { force: true });
    else if (before !== undefined) writeFileSync(path, before);
    PENDING.delete(path);
  }
  writeJournal();
}

/**
 * Undo whatever a previous run was killed in the middle of.
 *
 * RUN BEFORE ANY CASE, because a case seeded on top of a surviving mutation
 * tests neither one.
 */
function recoverFromKilledRun() {
  if (!existsSync(JOURNAL)) return;
  /** @type {Record<string, string | null>} */
  const pending = JSON.parse(readFileSync(JOURNAL, 'utf8'));
  const paths = Object.keys(pending);
  for (const path of paths) {
    const before = pending[path];
    if (before === null) rmSync(path, { force: true });
    else writeFileSync(path, before);
  }
  rmSync(JOURNAL, { force: true });
  process.stderr.write(
    `RECOVERED ${paths.length} seeded file(s) left behind by a killed run:\n` +
      paths.map((p) => `  ${p}\n`).join('') +
      'A previous invocation was killed mid-case. The tree is restored; nothing else was changed.\n\n',
  );
}

// Still worth having for the window between cases, where node is not blocked in
// a child and an interactive interrupt can be honoured immediately.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    for (const path of [...PENDING.keys()]) endSeed([path]);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

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
  const paths = Object.keys(files).map((rel) => join(ROOT, rel));
  beginSeed(paths);
  try {
    for (const [rel, body] of Object.entries(files)) write(ROOT, rel, body);
    return gate();
  } finally {
    endSeed(paths);
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
  beginSeed([path]);
  try {
    writeFileSync(path, edit(before));
    return gate();
  } finally {
    endSeed([path]);
  }
}

/** @type {Case[]} */
const CASES = [
  // ---------------------------------------------------------------------------
  // CI-01  RE-D-03, and the case that proves it is not a duplicate
  // ---------------------------------------------------------------------------
  {
    id: 'CI-01/RE-D-03',
    stage: 'CI-01',
    // THIS CASE ASSERTS TWO THINGS AND THE SECOND IS THE POINT. RI-07 must fail
    // on the escape, AND the two mechanisms that already existed must stay
    // GREEN on the same tree. A new gate that fires only where an old one
    // already fires is a second opinion, not a control, and the only way to
    // tell those apart is to watch the old ones say nothing.
    //
    // The seed is the exact shape M01 section 1.4's RE-D-03 exists for: a
    // RELATIVE import, so `merit/engine-purity` returns early on it, reaching a
    // file OUTSIDE `packages/rules-engine/src/**`, so that file is never linted
    // either, which then imports a Node builtin.
    seeds:
      'a `node:crypto` import in a file outside packages/rules-engine/src, reached from src/index.ts by a RELATIVE specifier. Invisible to RI-01 (manifest only) and to merit/engine-purity (returns early on `.`, and is attached to src/** only)',
    needles: [
      'OUTSIDE',
      `${MARK}-escape.ts`,
      'node:crypto',
      'ADDITIVITY: RI-01 green, engine-purity green',
    ],
    run: () =>
      seededInTree(
        {
          // THE SEED IS A FILE AND NOT A DIRECTORY, which is a constraint of this
          // harness rather than a stylistic choice. `sweep()` removes stale
          // marked paths with a non-recursive `rmSync`, so a marked DIRECTORY
          // makes the harness throw `EISDIR` before any case runs at all. Found
          // by seeding one. The package root is already outside `src/**`, which
          // is the only property this case needs.
          [`packages/rules-engine/${MARK}-escape.ts`]:
            "import { randomUUID } from 'node:crypto';\n" +
            '// The builtin is the point: RI-07 walks the graph and must reach it.\n' +
            'export const nonce = (): string => randomUUID();\n',
        },
        () =>
          seededEdit(
            'packages/rules-engine/src/index.ts',
            (before) => `${before}\nexport { nonce } from '../${MARK}-escape.js';\n`,
            () => {
              const ri07 = run('node', ['packages/tooling/checks/repo-invariants.mjs', 'RI-07']);
              const ri01 = run('node', ['packages/tooling/checks/repo-invariants.mjs', 'RI-01']);
              const lint = run('pnpm', ['exec', 'eslint', 'packages/rules-engine/src/']);
              const additivity =
                `ADDITIVITY: RI-01 ${ri01.status === 0 ? 'green' : 'RED'}, ` +
                `engine-purity ${lint.status === 0 ? 'green' : 'RED'}`;
              return { status: ri07.status, output: `${ri07.output}\n${additivity}\n` };
            },
          ),
      ),
  },

  // ---------------------------------------------------------------------------
  // CI-02  RE-D-01 and RE-D-02
  // ---------------------------------------------------------------------------
  {
    id: 'CI-02/RE-D-01-engine',
    stage: 'CI-02',
    // THE FINDING RE-D-01 EXISTS TO PRODUCE. INV-01 is "the ENGINE performs no
    // I/O and reads no clock | RE-D-01, RE-D-03, ESLint", so a seed anywhere
    // else never once demonstrates this gate catching an engine clock read.
    //
    // `merit/engine-purity` catches this too, and THE REDUNDANCY IS DELIBERATE:
    // M01 names three mechanisms for INV-01 on purpose, and a gate is proven by
    // its own finding rather than by a neighbouring gate's.
    //
    // It goes INSIDE `advanceDay` rather than at module scope, because a
    // top-level read runs at import time, which is before the trap installs.
    seeds: 'a `Date.now()` inside `advanceDay`, on the fold path the demo corpus actually executes',
    needles: ['RE-D-01', 'Date.now()', 'reads no clock'],
    run: () =>
      seededEdit(
        'packages/rules-engine/src/day/advance.ts',
        (before) =>
          before.replace(
            'export function advanceDay(input: DayInput): DayOutput {\n' +
              '  const { plan, mark, settlements, engineVersion } = input;',
            'export function advanceDay(input: DayInput): DayOutput {\n' +
              `  const ${MARK}_clock = Date.now();\n` +
              `  void ${MARK}_clock;\n` +
              '  const { plan, mark, settlements, engineVersion } = input;',
          ),
        () =>
          run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--project',
            'unit',
            'packages/golden-loader/test/determinism.test.ts',
            '-t',
            'RE-D-01',
          ]),
      ),
  },
  {
    id: 'CI-02/RE-D-01-outside-the-glob',
    stage: 'CI-02',
    // THE ADDITIVITY CASE, and it is why the pair is kept rather than collapsed
    // to the one above. `scripts/demo/fold.ts` is on the corpus's fold path and
    // is OUTSIDE `merit/engine-purity`'s glob, so this clock read is one that
    // ONLY RE-D-01 can see. The case asserts CI-01 stays green on it.
    seeds:
      'a `new Date()` in scripts/demo/fold.ts, which is on the fold path and outside merit/engine-purity glob, so no lint rule can see it',
    needles: ['RE-D-01', 'new Date()', 'ADDITIVITY: eslint green'],
    run: () =>
      seededEdit(
        'scripts/demo/fold.ts',
        (before) =>
          before.replace(
            'export function foldAccount(input: FoldInput): AccountRun {',
            'export function foldAccount(input: FoldInput): AccountRun {\n' +
              `  const ${MARK}_now = new Date();\n` +
              `  void ${MARK}_now;`,
          ),
        () => {
          const gate = run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--project',
            'unit',
            'packages/golden-loader/test/determinism.test.ts',
            '-t',
            'RE-D-01',
          ]);
          const lint = run('pnpm', ['exec', 'eslint', 'scripts/demo/fold.ts']);
          return {
            status: gate.status,
            output: `${gate.output}\nADDITIVITY: eslint ${lint.status === 0 ? 'green' : 'RED'}\n`,
          };
        },
      ),
  },
  {
    id: 'CI-02/RE-D-02',
    stage: 'CI-02',
    // A LOCALE READ, WHICH IS THE DEFECT RE-D-02 IS SHAPED AROUND. STRATEGY
    // section 3.1 names it in as many words: randomizing `LC_ALL` "is how a
    // `toLocaleDateString` gets caught". `render.ts`'s own header bans it and
    // this seeds exactly what that ban is for.
    //
    // It can only be caught ACROSS PROCESSES: Node resolves the ICU default
    // locale once at startup, so the same seed is invisible to any in-process
    // locale comparison. That is why RE-D-02 spawns `engine-digest.mjs`.
    // THE SEED MUST REACH THE OUTPUT, NOT MERELY READ THE LOCALE. The first
    // version assigned `toLocaleDateString()` to a variable it then discarded,
    // and the digest was byte-identical under every locale: the gate reported
    // "did not fail" and it was RIGHT to. A mutant whose effect never leaves the
    // function proves nothing about a gate that compares output.
    //
    // `bigint.toLocaleString()` is the version that bites, and it is the exact
    // defect `render.ts`'s own header bans: the thousands separator is a comma
    // under `en`, a period under `de`, and Arabic-Indic digits under `ar_EG`.
    seeds:
      'a `toLocaleString()` thousands separator in scripts/demo/render.ts, so every money figure in the digest changes with LC_ALL',
    needles: ['digest differs under TZ=', 'LC_ALL='],
    run: () =>
      seededEdit(
        'scripts/demo/render.ts',
        (before) =>
          before.replace(
            'function grouped(value: bigint): string {\n  const digits = String(value);',
            'function grouped(value: bigint): string {\n' +
              `  if (String(value).length > 0) return value.toLocaleString(); // ${MARK}\n` +
              '  const digits = String(value);',
          ),
        () =>
          run('pnpm', [
            'exec',
            'vitest',
            'run',
            '--project',
            'unit',
            'packages/golden-loader/test/determinism.test.ts',
            '-t',
            'RE-D-02',
          ]),
      ),
  },

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
    id: 'CI-01/engine-R-17',
    stage: 'CI-01',
    // R-17's MUTANT LIVES IN THE TYPECHECK STAGE AND NOT IN CI-02's, and the
    // placement is the finding rather than an inconvenience. Every other engine
    // rule is asserted by a comparison a unit test can run; R-17 is "config-
    // supported and UNIMPLEMENTED", so what discharges it is that
    // `intraday_trailing` cannot be written down. `RE-U-017` asserts that with
    // `@ts-expect-error`, which vitest cannot evaluate at all -- it runs
    // transpiled code and a type error is simply gone by then. Widening the
    // union makes the directive UNUSED, which is a `tsc` error, so the gate that
    // must be watched failing is CI-01.
    seeds:
      "`DrawdownType` widened to admit `intraday_trailing`, which R-17 says is unimplemented and CV-01 rejects at publish. RE-U-017's `@ts-expect-error` goes unused and tsc says so",
    needles: ['error TS', 'rules-c-floor.test.ts'],
    run: () =>
      seededEdit(
        'packages/rules-engine/src/types.ts',
        (before) =>
          before.replace(
            "export type DrawdownType = 'trailing_eod' | 'static';",
            "export type DrawdownType = 'trailing_eod' | 'static' | 'intraday_trailing';",
          ),
        () => run('pnpm', ['--filter', '@merit/rules-engine', 'run', 'typecheck']),
      ),
  },
  {
    id: 'CI-01/engine-R-05',
    stage: 'CI-01',
    // THE MUTANT IS THE ONE CHANGE THAT WOULD MAKE R-05 AN ENGINE RULE. R-05 is
    // discharged by `CalendarDay` not carrying `trading_calendar`'s two session
    // instants, so the violation aimed at it is the column arriving. `RE-U-005`
    // holds a `Record<keyof CalendarDay, true>`, which stops compiling the
    // moment the interface grows a fifth key, and a transcribed calendar year
    // adds ROWS rather than columns, so this cannot fire by accident.
    seeds:
      '`CalendarDay` widened with a `session_open_at` instant, which is the one change that would put a timezone inside the engine (R-05, B4 #1)',
    needles: ['error TS', 'rules-a-calendar.test.ts'],
    run: () =>
      seededEdit(
        'packages/rules-engine/src/types.ts',
        (before) =>
          before.replace(
            '  /** Dense index into the calendar. Gap counting is subtraction, never date math (R-02). */\n  readonly sequence: number;',
            '  readonly sessionOpenAt: string;\n  /** Dense index into the calendar. Gap counting is subtraction, never date math (R-02). */\n  readonly sequence: number;',
          ),
        () => run('pnpm', ['--filter', '@merit/rules-engine', 'run', 'typecheck']),
      ),
  },
  {
    id: 'CI-01/engine-R-11',
    stage: 'CI-01',
    // R-01 AND R-11 SHARE THIS MUTANT'S TARGET AND ASSERT DIFFERENT THINGS ABOUT
    // IT, so one edit is watched failing on two rules. `RE-U-001` holds a
    // `Record<keyof DailyMark, true>` (adding a key is a missing property) and
    // `RE-U-011` holds an `Extract<keyof DailyMark, 'supersededBy' | ...>[]`
    // (which resolves from `never` to a real union the moment the field exists).
    // The needle names both files so a mutant that tripped only one of them is
    // reported off-target rather than accepted.
    seeds:
      '`DailyMark` widened with a `supersededBy` field, so the engine could branch on a mark the caller was supposed to have filtered out (R-11, R-01)',
    needles: ['error TS', 'rules-a-calendar.test.ts', 'rules-b-marks.test.ts'],
    run: () =>
      seededEdit(
        'packages/rules-engine/src/types.ts',
        (before) =>
          before.replace(
            '  readonly fillCount: number;\n  readonly sourceHash: string;',
            '  readonly fillCount: number;\n  readonly supersededBy: string | null;\n  readonly sourceHash: string;',
          ),
        () => run('pnpm', ['--filter', '@merit/rules-engine', 'run', 'typecheck']),
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
      rule: 'R-32',
      // THE MUTANT MOVED FROM THE REFUSAL TO THE OPERATOR WHEN ADR-051 LANDED.
      // It used to switch the refusal off, because the refusal was all R-32 had;
      // the rule computes now, so the thing worth protecting is the FENCEPOST.
      //
      // IT IS THE OFF-BY-ONE AND NOT AN ARBITRARY FLIP. ADR-051 ruled the anchor
      // and the binding column and deliberately left the fencepost to an
      // executable pin, so this is the one line in R-32 that no document
      // dictates. Dropping the `+ 1` grants an account N+1 trading days on a
      // limit of N: every account outlives its own expiry by exactly one day,
      // on a rule whose whole purpose is to end the evaluation on time. It is
      // also the mutant most likely to be introduced by accident, which is what
      // makes it worth a seed rather than a comment.
      seeds:
        'R-32’s fencepost dropped, so the opening day counts as elapsed day 0 and every account gets one trading day more than `max_days` allows (ADR-051 left this to the pin)',
      file: 'packages/rules-engine/src/day/progression.ts',
      from: 'const elapsedTradingDays = counted.tradingDays + 1;',
      to: 'const elapsedTradingDays = counted.tradingDays;',
    },
    {
      rule: 'R-20',
      // R-20 IS NOT DECLARED AND IT STILL EARNS A MUTANT, because what it
      // asserts is that `day.closed` carries the setpoint's SOURCE and a
      // consumer reading it is right on every day. The mutant is the plausible
      // confusion rather than an arbitrary flip: `floorOpenCents` and
      // `floorCents` are both on the payload and they differ exactly on the days
      // the floor MOVED, which are precisely the days R-20 requires a re-push.
      // So a setpoint derived from the wrong one is stale on every day it
      // matters and identical on every day it does not.
      seeds:
        'the closing event carrying the floor AT THE OPEN as the setpoint, so the push is stale on exactly the days the floor moved (D-M2-3)',
      file: 'packages/rules-engine/src/day/advance.ts',
      from: '    floorCents: state.floorCents,\n    tradedDaysCount: state.tradedDaysCount,',
      to: '    floorCents: state.floorOpenCents,\n    tradedDaysCount: state.tradedDaysCount,',
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
  // CI-02  THE PUBLISH PATH: CV-01 TO CV-19, THE MZ FINDINGS, AND resolvePlan
  // ---------------------------------------------------------------------------
  // The `RE-C-nn` series is the config half of M01 section 8.1 and its operators
  // need the same treatment the `RE-U-nn` series got: a test that does not go
  // red when its comparison is flipped is asserting nothing.
  //
  // SIX OF THE NINETEEN ARE SEEDED RATHER THAN ALL NINETEEN, and the choice is
  // stated so it is a judgement rather than an omission. The four operator
  // mutants below are the ones where a plausible edit CHANGES WHAT PUBLISHES:
  // CV-11 and CV-17 are the two halves of INV-21, CV-12 is what stops the floor
  // jumping at the lock, and CV-01 is R-17. CV-09 and CV-15 are seeded because
  // each is an equality or an identity that reads correctly when written the
  // wrong way. The remaining thirteen are `>=` against a constant with no second
  // reading, and their `RE-C` cases already assert both sides.
  //
  // THE LAST TWO ARE NOT CV RULES. `MZ-per-phase` is this session's own finding
  // and a finding nobody watched fail is a finding nobody has tested; the
  // `resolvePlan` mutant is the percentage M01 section 2.4 exists to keep out of
  // the runtime, and it is the one edit in this package that would look like a
  // simplification in a diff.
  ...[
    {
      id: 'CV-01',
      seeds:
        '`intraday_trailing` admitted by CV-01, which is R-17 computing something plausible instead of failing loudly (GS-078)',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: "if (d.type !== 'trailing_eod' && d.type !== 'static') {",
      to: "if (d.type !== 'trailing_eod' && d.type !== 'static' && d.type !== 'intraday_trailing') {",
      needles: ['RE-C-01', 'CV-01'],
    },
    {
      id: 'CV-09',
      seeds:
        'the first-rung check loosened from `!== 1` to `< 1`, so a schedule starting at ordinal 2 publishes and ordinal 1 has no cap',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: 'if (first.from_ordinal !== 1) {',
      to: 'if (first.from_ordinal < 1) {',
      needles: ['RE-C-09', 'CV-09'],
    },
    {
      id: 'CV-11',
      seeds:
        'CV-11 relaxed from `>` to `>=`, so a buffer EQUAL to the locked-floor offset publishes and a post-payout balance lands exactly on the floor (INV-21)',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: 'if (!(size.buffer_cents > offset)) {',
      to: 'if (!(size.buffer_cents >= offset)) {',
      needles: ['RE-C-11', 'CV-11'],
    },
    {
      id: 'CV-12',
      seeds:
        'CV-12 weakened from an equality to a one-sided bound, so a lock trigger ABOVE the trailing floor publishes and the floor jumps when it engages (R-15)',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: 'if (atProfit !== expected) {',
      to: 'if (atProfit < expected) {',
      needles: ['RE-C-12', 'CV-12'],
    },
    {
      id: 'CV-15',
      seeds:
        'CV-15 loosened from an equality to a floor, so a config edit can raise the minimum payout above the 10,000c GLOSSARY fixes and never scales',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: 'if (fu.min_payout_cents !== MIN_PAYOUT_CENTS) {',
      to: 'if (fu.min_payout_cents < MIN_PAYOUT_CENTS) {',
      needles: ['RE-C-15', 'CV-15'],
    },
    {
      id: 'CV-17',
      seeds:
        'CV-17 relaxed from `<` to `<=`, which is the other half of INV-21: a cap EQUAL to the drawdown means the payout breaches the account that earned it (GS-083)',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: 'if (!(sched[i]!.cap_cents < size.drawdown_cents)) {',
      to: 'if (!(sched[i]!.cap_cents <= size.drawdown_cents)) {',
      needles: ['RE-C-17', 'CV-17'],
    },
    {
      id: 'MZ-per-phase',
      seeds:
        'the per-phase materialization check gated off, so a plan declaring two different drawdowns publishes and one phase silently gets the other’s number',
      file: 'packages/rules-engine/src/plan/validate.ts',
      from: '    if (ev.drawdown.amount_bp !== fu.drawdown.amount_bp) {',
      to: '    if (false && ev.drawdown.amount_bp !== fu.drawdown.amount_bp) {',
      needles: ['MZ-per-phase'],
    },
    {
      id: 'resolve-percentage',
      // M01 section 2.4: "No percentage is ever applied to a money value at
      // runtime. That single rule is what makes the marketing page and the
      // engine agree to the cent." The mutant is the edit that looks like a
      // tidy-up: deriving the drawdown from the bp instead of reading the
      // materialized column. On every v1 plan it produces the SAME NUMBER, which
      // is exactly why it needs a test that does not.
      seeds:
        'the drawdown recomputed from `amount_bp` at resolution instead of read from `plan_version_sizes`, which is the one-cent drift the table exists to prevent',
      file: 'packages/rules-engine/src/plan/resolve.ts',
      from: '    drawdownCents: size.drawdown_cents,',
      to: '    drawdownCents: (size.size_cents * BigInt(published.amount_bp)) / 10_000n,',
      needles: ['no percentage is applied'],
    },
  ].map(({ id, seeds, file, from, to, needles }) => ({
    id: `CI-02/engine-${id}`,
    stage: 'CI-02',
    seeds,
    needles,
    run: () =>
      seededEdit(
        file,
        (before) => {
          if (!before.includes(from)) {
            throw new Error(`the ${id} mutant found no "${from}" in ${file}`);
          }
          return before.replace(from, to);
        },
        () => run('pnpm', ['exec', 'vitest', 'run', '--project', 'unit']),
      ),
  })),

  // ---------------------------------------------------------------------------
  // CI-02  RE-P-01, WATCHED FAILING IN BOTH OF ITS DIRECTIONS
  // ---------------------------------------------------------------------------
  // The `RE-U-nn` series above proves the unit suite's operators bite. RE-P-01
  // is a PROPERTY and it makes two claims that fail differently, so it is
  // watched twice: no boundary is asserted in one direction only.
  //
  // Both cases run `--project property` and both demand the string `RE-P-01` in
  // the output, which is the failing test's own name. A mutant that made some
  // other property go red would be FAILED OFF-TARGET, which is the distinction
  // this file exists to keep.
  {
    id: 'CI-02/engine-RE-P-01-monotone',
    stage: 'CI-02',
    // R-12's INITIAL floor expression written where DO-7's OUTCOME belongs, so
    // a floor that has trailed up falls back to the account-open floor on the
    // next day. It is the confusion R-12 and R-13 invite by both being floor
    // rules, and it decreases the floor on an ordinary day that emits no
    // `phase.passed`, so ADR-050's one exception cannot cover it.
    //
    // IT IS SEEDED IN `advance.ts` AND NOT IN `floor.ts`, AND THAT IS THE WHOLE
    // POINT OF THIS CASE. R-14's tripwire lives INSIDE `advanceFloor` and
    // compares within one day's trail-then-lock, so a floor lowered after that
    // function returns is invisible to it. A mutant inside `floor.ts` would be
    // caught by the tripwire throwing rather than by the property asserting, and
    // this pair is meant to show that RE-P-01 itself bites.
    seeds:
      "the day's floor written from R-12's account-open expression rather than from DO-7's outcome, so a trailed floor falls back on the next day",
    needles: ['RE-P-01'],
    run: () =>
      seededEdit(
        'packages/rules-engine/src/day/advance.ts',
        (before) => {
          const from = 'floorCents: floor.floorCents,';
          if (!before.includes(from)) {
            throw new Error(`the RE-P-01 monotone mutant found no "${from}" in advance.ts`);
          }
          return before.replace(
            from,
            'floorCents: initialFloorCents(plan.sizeCents, rules.drawdown.drawdownCents),',
          );
        },
        () => run('pnpm', ['exec', 'vitest', 'run', '--project', 'property']),
      ),
  },
  {
    id: 'CI-02/engine-RE-P-01-exception',
    stage: 'CI-02',
    // THE MUTANT NO TRIPWIRE CAN SEE, and the reason this case exists at all.
    // DO-7's `neverRetreats` compares within one day's trail-then-lock and never
    // spans the R-31 reset, deliberately (ADR-050), so a reset that lands one
    // cent BELOW `size_cents - funded drawdown_cents` passes every check the
    // engine makes about itself.
    //
    // It is an exception WIDER than the one ADR-050 states, which is exactly the
    // unstated exception INV-06's "no exception, no phase qualifier" clause
    // forbids. Only RE-P-01's `===` at the pass day catches it, which is what
    // makes "the exception is pinned rather than excused" a fact about the
    // repository instead of a sentence in an ADR.
    seeds:
      "the R-31 funded reset landing one cent below the floor R-12 and R-31 state and GS-019 pins, which is an exception wider than ADR-050's",
    needles: ['RE-P-01'],
    run: () =>
      seededEdit(
        'packages/rules-engine/src/day/progression.ts',
        (before) => {
          const from =
            'const resetFloorCents = initialFloorCents(plan.sizeCents, plan.funded.drawdown.drawdownCents);';
          if (!before.includes(from)) {
            throw new Error(`the RE-P-01 exception mutant found no "${from}" in progression.ts`);
          }
          return before.replace(
            from,
            'const resetFloorCents = initialFloorCents(plan.sizeCents, plan.funded.drawdown.drawdownCents + 1n);',
          );
        },
        () => run('pnpm', ['exec', 'vitest', 'run', '--project', 'property']),
      ),
  },

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
            // THE PIN IS CARRIED INTO THE SEED, AND IT IS NOT COSMETIC. Without
            // it this manifest has no `packageManager` and sits outside the
            // repository, so corepack finds no project spec, falls back to
            // `fetchLatestStableVersion` and asks the registry what the latest
            // pnpm is. That query is rate limited, it answered HTTP 429 on
            // 2026-08-17, and the case then failed OFF-TARGET: the harness
            // reported `exited 1 without saying: lodash` and refused to count
            // it, which is the discipline working. Four of the five CI-05 cases
            // are local; this was the only one reaching the network for a
            // reason unrelated to the thing it tests.
            packageManager: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
              .packageManager,
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

  // BEFORE ANYTHING ELSE, INCLUDING `list`. A surviving mutation is a defect in
  // the working tree whether or not this invocation intends to run a case, and
  // the cheapest moment to remove it is any moment this script starts.
  recoverFromKilledRun();

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
