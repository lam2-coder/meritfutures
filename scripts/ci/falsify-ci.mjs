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

/** A syntactically valid AWS access key id that has never been issued. */
const FAKE_AWS_KEY = ['AKIA', 'QYLPT7EXAMPLE', '000'].join('');

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
          [`packages/rules-engine/src/${MARK}-purity.ts`]:
            'export const stamp = Date.now();\n',
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
  // CI-05  Security static
  // ---------------------------------------------------------------------------
  {
    id: 'CI-05/gitleaks',
    stage: 'CI-05',
    seeds: 'a syntactically valid AWS access key id in a source file',
    needles: [FAKE_AWS_KEY],
    requires: ['gitleaks'],
    run: () => {
      const dir = temp();
      write(dir, 'src/config.ts', `export const key = '${FAKE_AWS_KEY}';\n`);
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
      const resolved = run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: dir });
      if (resolved.status !== 0) {
        return { status: resolved.status, output: `pnpm could not resolve the seed\n${resolved.output}` };
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
      failed++;
    } else if (absent.length > 0) {
      console.log(`  FAILED OFF-TARGET     ${testCase.id}  <- ${testCase.seeds}`);
      console.log(`        exited ${result.status} without saying: ${absent.join(', ')}`);
      console.log('        A gate that fails for a reason nobody planted proves nothing.');
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
