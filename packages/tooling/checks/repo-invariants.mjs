#!/usr/bin/env node
// =============================================================================
// packages/tooling/checks/repo-invariants.mjs
// =============================================================================
// The five scaffold properties that P1-monorepo-scaffold says a cheap choice
// destroys silently, as a runnable check.
//
//   node packages/tooling/checks/repo-invariants.mjs         run every check
//   node packages/tooling/checks/repo-invariants.mjs RI-01   run one
//   node packages/tooling/checks/repo-invariants.mjs list    list them
//
// Exit code is 0 only when every check that ran reported PASS.
//
// THE SAME TWO RULES gates.mjs IS WRITTEN UNDER, and for the same reason:
//
//   1. NEVER WEAKEN A CHECK TO PASS IT. A check that cannot verify the whole of
//      what it claims says so in its `covers` line and verifies the part it
//      can. It never returns PASS for something it did not look at.
//   2. A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. Any check that
//      cannot reach its inputs throws, which is a non-zero exit, not a skip.
//
// Each one is watched failing on a seeded violation in
// ../test/repo-invariants.test.ts, which is the same discipline falsify.mjs
// applies to the corpus gates: a check that has only ever been seen pass is
// indistinguishable from a check that cannot fail.
//
// No dependencies, on purpose, and no build step: an invariant asserted by a
// file that must be compiled before it can run is an invariant that stops
// running on the day the compile breaks. This is why the file is `.mjs` beside
// a TypeScript package rather than `.ts` inside a `src/`. It is still
// type-checked, from its JSDoc, by this package's `tsc --noEmit`.
//
// WHY HERE AND NOT IN scripts/. These are build-tooling invariants, checked at
// CI-01 (lint and types) rather than at CI-06 (corpus integrity), and
// P1 section 2.1 puts shared build tooling in `packages/tooling` precisely so
// that it has one home instead of a copy per application. `scripts/corpus/` is
// the corpus runner's directory and these do not check the corpus.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The workspace root, three levels up from `packages/tooling/checks`. */
export const REPO_ROOT = resolve(HERE, '../../..');

/**
 * One repository invariant.
 *
 * @typedef {object} Invariant
 * @property {string} id
 * @property {string} title
 * @property {string} covers  what it does and, explicitly, what it does not
 * @property {(root: string) => string[]} run  findings, empty when the invariant holds
 */

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

/** @type {(root: string, p: string) => string} */
const read = (root, p) => readFileSync(join(root, p), 'utf8');

/** @type {(root: string, p: string) => any} */
const readJson = (root, p) => JSON.parse(read(root, p));

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/**
 * Every file in the tree, repo-relative, skipping build output and vendored code.
 *
 * @param {string} root
 * @param {string} [dir]
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(root, dir = '.', out = []) {
  for (const entry of readdirSync(join(root, dir))) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = dir === '.' ? entry : `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * pnpm-workspace.yaml's `packages:` list, without a YAML parser. The file is
 * ours and its shape is a flat sequence of quoted globs; anything richer than
 * that is a change to a file this check reads, and it will throw here rather
 * than parse to an empty set. THAT DIRECTION IS DELIBERATE: an empty workspace
 * set would make RI-01 pass by knowing about no packages.
 *
 * @param {string} root
 * @returns {string[]}
 */
function workspaceGlobs(root) {
  const body = read(root, 'pnpm-workspace.yaml');
  // Anchored with `^` under `m` rather than searched for as `'\npackages:'`,
  // which was the first version and could not see the key on line 1. Our own
  // file opens with a comment so it worked; a workspace file that opens with
  // `packages:`, which is the ordinary shape, threw. The seeded test caught it.
  const heading = /^packages:[ \t]*$/m.exec(body);
  if (!heading) throw new Error('pnpm-workspace.yaml has no `packages:` key');
  /** @type {string[]} */
  const globs = [];
  for (const line of body
    .slice(heading.index + heading[0].length)
    .split('\n')
    .slice(1)) {
    const m = /^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (!m || m[1] === undefined) break; // the sequence ends at the first non-item line
    globs.push(m[1]);
  }
  if (globs.length === 0) throw new Error('pnpm-workspace.yaml claims no packages');
  return globs;
}

/**
 * Every workspace package, resolved from the globs.
 *
 * @param {string} root
 * @returns {{ dir: string, name: string, manifest: any }[]}
 */
export function workspacePackages(root) {
  /** @type {{ dir: string, name: string, manifest: any }[]} */
  const out = [];
  for (const glob of workspaceGlobs(root)) {
    const [parent, leaf] = glob.split('/');
    if (parent === undefined || leaf !== '*')
      throw new Error(`workspace glob not understood: ${glob}`);
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent)).sort()) {
      const dir = `${parent}/${entry}`;
      if (!statSync(join(root, dir)).isDirectory()) continue;
      if (!existsSync(join(root, dir, 'package.json'))) continue;
      const manifest = readJson(root, `${dir}/package.json`);
      out.push({ dir, name: String(manifest.name), manifest });
    }
  }
  return out;
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// -----------------------------------------------------------------------------
// RI-01  The rules engine declares no workspace dependencies
// -----------------------------------------------------------------------------

/** @type {Invariant} */
const ri01 = {
  id: 'RI-01',
  title: 'packages/rules-engine declares no workspace dependencies, in any dependency field',
  covers:
    'the MANIFEST half of the purity boundary: a `workspace:` specifier, or a ' +
    'specifier of any name that resolves to a package in this workspace, in ' +
    "rules-engine's dependencies, devDependencies, peerDependencies or " +
    'optionalDependencies. It does NOT read the source: an import statement, a ' +
    'wall-clock read and a `node:` builtin are the same defect class and are ' +
    'caught by the `merit/engine-purity` ESLint rule, which runs in the same ' +
    'CI-01 stage. Neither half substitutes for the other.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const rel = 'packages/rules-engine/package.json';
    if (!existsSync(join(root, rel)))
      throw new Error(`${rel} does not exist; the check cannot run`);
    const engine = readJson(root, rel);
    const names = new Set(workspacePackages(root).map((p) => p.name));
    if (names.size === 0) throw new Error('no workspace packages resolved; the check cannot run');

    for (const field of DEP_FIELDS) {
      for (const [dep, spec] of Object.entries(engine[field] ?? {})) {
        const why = String(spec).startsWith('workspace:')
          ? 'a `workspace:` specifier'
          : names.has(dep)
            ? 'a package in this workspace'
            : null;
        if (why === null) continue;
        findings.push(
          `${rel}: ${field}.${dep} is ${why}. The engine's contract is ` +
            '(planConfigVersion, accountState, dayMarks[]) -> newState + events with zero I/O ' +
            '(OVERVIEW section 3), and the replay self-audit, the PT-nn property suites and ' +
            'Stryker-on-the-engine-only all rest on that being literally true (STRATEGY section 2)',
        );
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-02  No coverage threshold, anywhere
// -----------------------------------------------------------------------------
// THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS rather than written out, so this
// file and its test do not match themselves. The alternative is a by-name
// exclusion for the two files that define and test the check, which is a hole
// in exactly the place a hole is least visible.

/** @type {(...parts: string[]) => RegExp} */
export const needle = (...parts) => new RegExp(parts.join(''), 'i');

/**
 * The spellings a coverage gate arrives under, each with the tool that writes
 * it. THE LABELS MUST NOT SPELL THEIR OWN NEEDLE EITHER, for the same reason
 * the needles are assembled: a label written out is a match, and the check
 * would report itself.
 *
 * @type {[RegExp, string][]}
 */
export const COVERAGE_NEEDLES = [
  [needle('coverage', 'Threshold'), 'the Jest / nyc coverage-threshold key'],
  [needle('threshold', 'AutoUpdate'), "Vitest's threshold auto-update option"],
  [needle('check', '-coverage'), 'the nyc / c8 coverage-checking CLI flag'],
  [needle('coverage\\.', 'thresholds'), 'a dotted coverage CLI flag carrying thresholds'],
  [needle('thresholds\\s*:'), 'a Vitest coverage thresholds block'],
];

/** Config files that exist only to hold a coverage gate. */
const COVERAGE_CONFIG_FILES = ['.nycrc', '.nycrc.json', '.nycrc.yml', '.c8rc', '.c8rc.json'];

const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.json',
  '.yaml',
  '.yml',
]);

/** @type {Invariant} */
const ri02 = {
  id: 'RI-02',
  title: 'No coverage threshold exists anywhere in the tree',
  covers:
    'every code and config file in the tree, excluding node_modules and build ' +
    'output, scanned for the known spellings of a coverage gate, plus the ' +
    'existence of a config file whose only purpose is to hold one. It is a ' +
    'SPELLING check in both directions and says so: a gate expressed in a way ' +
    'not listed in COVERAGE_NEEDLES passes, and a scanned file that merely ' +
    'names one of these keys, in a comment or a string, is a finding. ' +
    'STRATEGY section 2 rules coverage out as a gate ' +
    'because on an AI-assisted codebase line coverage measures how much code ' +
    'was executed, which is the one quality signal generated tests inflate for ' +
    'free, and every scaffold generator in this ecosystem adds one by default. ' +
    'ABSENCE IS THEREFORE ASSERTED RATHER THAN ASSUMED.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    let scanned = 0;
    for (const file of walk(root)) {
      const base = basename(file);
      if (COVERAGE_CONFIG_FILES.includes(base)) {
        findings.push(`${file}: a coverage-gate config file exists at all`);
        continue;
      }
      if (!SCANNED_EXTENSIONS.has(extname(file))) continue;
      if (base === 'pnpm-lock.yaml') continue; // a resolution graph, not our config
      scanned++;
      const body = read(root, file);
      for (const [re, tool] of COVERAGE_NEEDLES) {
        if (re.test(body)) findings.push(`${file}: reads as ${tool}`);
      }
    }
    if (scanned === 0) throw new Error('no files scanned; the check cannot run');
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-03  The Vitest projects are the CI stages
// -----------------------------------------------------------------------------
const CI_STAGES = ['unit', 'property', 'golden', 'integration'];

/** @type {Invariant} */
const ri03 = {
  id: 'RI-03',
  title: 'The Vitest projects are named for the CI stages, and no dead workspace file shadows them',
  covers:
    'that vitest.config.ts names a project for each of CI-02 (unit, property), ' +
    'CI-03 (golden) and CI-04 (integration), and that no `vitest.workspace.*` ' +
    'exists. VITEST 4 SILENTLY IGNORES `vitest.workspace.ts`: the default ' +
    'include still finds the tests, so the run reports green while the named ' +
    'projects do not exist and CI-03 cannot be run alone. It reads the config ' +
    'as TEXT rather than resolving it, so a project whose name is computed ' +
    'rather than written would not be seen; that is why the names are literals ' +
    'in that file.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    for (const ext of ['ts', 'mts', 'js', 'mjs']) {
      const dead = `vitest.workspace.${ext}`;
      if (existsSync(join(root, dead))) {
        findings.push(
          `${dead} exists and Vitest 4 ignores it. The projects it declares do not run, ` +
            'and the default include hides that by finding the tests anyway. Move them to ' +
            "vitest.config.ts's `test.projects`",
        );
      }
    }
    const rel = 'vitest.config.ts';
    if (!existsSync(join(root, rel)))
      throw new Error(`${rel} does not exist; the check cannot run`);
    const body = read(root, rel);
    for (const stage of CI_STAGES) {
      if (!body.includes(`name: '${stage}'`)) {
        findings.push(`${rel}: no project named '${stage}', so that CI stage cannot be run alone`);
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-04  The four deployables are four packages
// -----------------------------------------------------------------------------
// ADR-012 puts the admin console on a separate apex domain, SECURITY treats one
// owned admin as total loss, and STRATEGY section 2 chose Playwright over
// Cypress SPECIFICALLY because that separate origin makes cross-origin a
// requirement rather than an edge case. The tempting scaffold is one
// application with three route groups. That choice is invisible for months, is
// a re-platform to undo, and it silently converts a security control into a URL
// convention.
const DEPLOYABLES = ['site', 'portal', 'admin', 'worker'];

/** @type {Invariant} */
const ri04 = {
  id: 'RI-04',
  title: 'site, portal, admin and worker are four separate deployables',
  covers:
    'each of the four has its own directory under apps/ with its own ' +
    'package.json and a distinct package name, and no app depends on another ' +
    'app. It does NOT check the deployment configuration, which does not exist ' +
    'yet: it checks the shape that makes a separate deployment possible.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    /** @type {Map<string, string>} */
    const byName = new Map();
    for (const app of DEPLOYABLES) {
      const rel = `apps/${app}/package.json`;
      if (!existsSync(join(root, rel))) {
        findings.push(`${rel} does not exist: ${app} is not a separate deployable`);
        continue;
      }
      const name = String(readJson(root, rel).name);
      const other = byName.get(name);
      if (other !== undefined)
        findings.push(`apps/${app} and apps/${other} share the name ${name}`);
      byName.set(name, app);
    }
    if (byName.size === 0) throw new Error('no deployables found; the check cannot run');

    for (const app of DEPLOYABLES) {
      const rel = `apps/${app}/package.json`;
      if (!existsSync(join(root, rel))) continue;
      const manifest = readJson(root, rel);
      for (const field of DEP_FIELDS) {
        for (const dep of Object.keys(manifest[field] ?? {})) {
          const owner = byName.get(dep);
          if (owner !== undefined && owner !== app) {
            findings.push(
              `${rel}: ${field}.${dep} makes apps/${app} depend on apps/${owner}. ` +
                'A deployable that imports a deployable is one deployable',
            );
          }
        }
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-05  .nvmrc is the only Node version in the tree
// -----------------------------------------------------------------------------

/** @type {Invariant} */
const ri05 = {
  id: 'RI-05',
  title: '.nvmrc is the only place the Node version is written',
  covers:
    'that .nvmrc exists and holds a version, that no workflow pins ' +
    '`node-version:` inline instead of reading `node-version-file:`, and that ' +
    'no package.json carries an `engines.node` range. OQ-P1-03: two files ' +
    'holding one number is a hand-maintained count in a different costume, and ' +
    'it drifts the same way.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    if (!existsSync(join(root, '.nvmrc'))) {
      throw new Error('.nvmrc does not exist; the check cannot run');
    }
    const pinned = read(root, '.nvmrc').trim();
    if (!/^v?\d+(\.\d+){0,2}$/.test(pinned)) {
      findings.push(`.nvmrc reads "${pinned}", which is not a version`);
    }

    const wfDir = '.github/workflows';
    if (existsSync(join(root, wfDir))) {
      for (const file of readdirSync(join(root, wfDir)).sort()) {
        if (!/\.ya?ml$/.test(file)) continue;
        const rel = `${wfDir}/${file}`;
        read(root, rel)
          .split('\n')
          .forEach((line, i) => {
            if (/^\s*-?\s*node-version\s*:/.test(line)) {
              findings.push(
                `${rel}:${i + 1} pins the Node version inline (${line.trim()}). ` +
                  'Use `node-version-file: .nvmrc`',
              );
            }
          });
      }
    }

    const manifests = [
      'package.json',
      ...workspacePackages(root).map((p) => `${p.dir}/package.json`),
    ];
    for (const rel of manifests) {
      const node = readJson(root, rel).engines?.node;
      if (node) {
        findings.push(`${rel}: engines.node is "${node}", a second place holding the Node version`);
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

/** @type {Invariant[]} */
export const CHECKS = [ri01, ri02, ri03, ri04, ri05];

function main() {
  const [arg] = process.argv.slice(2);

  if (arg === 'list') {
    for (const c of CHECKS) console.log(`${c.id}  ${c.title}\n      covers: ${c.covers}\n`);
    return 0;
  }

  const selected = arg ? CHECKS.filter((c) => c.id === arg) : CHECKS;
  if (selected.length === 0) {
    console.error(`no such check: ${arg}. Try: list`);
    return 2;
  }

  let failed = 0;
  for (const check of selected) {
    /** @type {string[]} */
    let findings;
    try {
      findings = check.run(REPO_ROOT);
    } catch (err) {
      console.log(`ERROR  ${check.id}  ${check.title}`);
      console.log(`       ${err instanceof Error ? err.message : String(err)}`);
      failed++;
      continue;
    }
    if (findings.length === 0) {
      console.log(`PASS   ${check.id}  ${check.title}`);
    } else {
      failed++;
      console.log(`FAIL   ${check.id}  ${check.title}  (${findings.length})`);
      for (const f of findings) console.log(`       ${f}`);
    }
  }

  console.log(
    `\n${selected.length - failed} of ${selected.length} invariants hold.` +
      (failed ? ' Each one is a property the scaffold exists to make impossible to lose.' : ''),
  );
  return failed ? 1 : 0;
}

// Importable by the test that watches each check fail, runnable by CI-01.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
