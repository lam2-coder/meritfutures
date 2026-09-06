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
// Exit codes: 0 every check PASSED, 1 a check FAILED, 2 a usage error, and 3 a
// check CRASHED, which is its own outcome and never a held invariant. ADR-294.
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

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, dirname, resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// THE ONE COMMENT STRIPPER, IMPORTED RATHER THAN DECLARED. ADR-279. This file
// carried its own two-replacement copy until then, and that copy could not tell
// a block-comment OPENER written inside a LINE comment from a real one: on
// `apps/worker/src/index.ts` it stripped 55,728 characters to 2,753 and a
// `new Date().getHours()` seeded inside the phantom span was INVISIBLE to
// `RI-28`, which reported PASS. See `strip-comments.mjs`'s header for the
// measurement and for what the scanner does not model.
import { stripComments } from './strip-comments.mjs';

// RI-11 LIVES IN ITS OWN FILE AND IS IMPORTED HERE, WHICH IS THE FIRST TIME A
// CHECK IN THIS ARRAY HAS. ADR-138: three sessions were live in this file's
// neighbours when it was written, and a ruling that needs 250 lines of argument
// is a ruling that reads better beside its own mechanism than wedged between
// RI-10 and the runner. The `CHECKS` array below is still the one list, so the
// runner, `pnpm run check:invariants`, the ALLOCATION table and the suite that
// walks every check all see it without learning anything new.
//
// THE IMPORT IS A CYCLE: ui-server-endpoints.mjs reads `DEPLOYABLES` and
// `apiSurfaceVocabulary` back out of this file rather than keeping a second copy
// of apps/api's vocabulary. It touches neither at module-evaluation time, so the
// cycle links; its header states the constraint that keeps it that way.
import { ri11 } from './ui-server-endpoints.mjs';

// RI-18 IS THE SECOND CHECK IN ITS OWN FILE, on RI-11's precedent above, and
// ITS DEPENDENCY RUNS ONE WAY, WHICH THAT ONE'S DOES NOT. Its mechanism is a
// TypeScript parse and it loads the compiler LAZILY, inside `run`: a static
// import of `typescript` costs 465ms on every invocation of this file,
// including the single-check form the usage line above advertises, and only
// the run that reaches RI-18 should pay it.
//
// THE CYCLE ABOVE WAS MEASURED BEFORE THIS IMPORT WAS WRITTEN AND WAS NOT
// COPIED. `ui-server-endpoints.mjs`'s header says its cycle links because
// neither side touches the other at module-evaluation time; the `CHECKS`
// literal at the foot of this file DOES, so importing that module FIRST throws
// `ReferenceError: Cannot access 'ri11' before initialization`. Nothing has hit
// it because every consumer today reaches this file first. RI-18 takes the
// package lister as an ARGUMENT instead, so its module imports nothing from
// here and there is no cycle to depend on an import order.
import { ri18For } from './response-shape-copies.mjs';

// RI-35 IS THE THIRD CHECK IN ITS OWN FILE, on RI-11's and RI-18's precedent,
// AND ITS DEPENDENCY RUNS ONE WAY LIKE RI-18's. It carries two written
// registers and the argument for their shape, which is more prose than any
// neighbour in this file has, and nothing in `absence-claims.mjs` imports this
// module, so the `CHECKS` literal at the foot of this file can name it without
// depending on an import order.
import { ri35 } from './absence-claims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * RI-18, handed the workspace package list rather than importing it.
 *
 * `workspacePackages` is a hoisted function declaration below, so this binding
 * is safe here and sits beside its import rather than at the foot of the file,
 * where three sessions are usually live at once.
 */
const ri18 = ri18For(workspacePackages);

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
// RI-04  Each deployable is its own package
// -----------------------------------------------------------------------------
// ADR-012 puts the admin console on a separate apex domain, SECURITY treats one
// owned admin as total loss, and STRATEGY section 2 chose Playwright over
// Cypress SPECIFICALLY because that separate origin makes cross-origin a
// requirement rather than an edge case. The tempting scaffold is one
// application with three route groups. That choice is invisible for months, is
// a re-platform to undo, and it silently converts a security control into a URL
// convention.
//
// `api` IS HERE BECAUSE ADR-083 RULED IT A FIFTH DEPLOYABLE, and its absence
// from this list between sessions 144 and 147 is the exact failure mode the
// check exists to prevent, mirrored: RI-04 reported PASS while asserting
// nothing whatsoever about apps/api. ADR-083 section 3 leans on this check by
// name -- "RI-04 in repo-invariants.mjs refuses an app that depends on an app"
// -- as the mechanical reason the API cannot live inside one of the three UI
// surfaces, so a list that omitted it left that argument unenforced against the
// one deployable it was written about. The order matches OVERVIEW section 2's
// `subgraph Merit`: Site, Portal, Admin, API, Worker.
// EXPORTED SO THE TEST'S SYNTHETIC FIXTURE IS BUILT FROM THIS LIST rather than
// from a second copy of it. The fixture held its own `['site', 'portal',
// 'admin', 'worker']`, so adding `api` here turned the fixture's clean-tree
// case red -- which is the drift working as designed, caught one layer down.
// Two lists is the defect; one list read twice is the fix.
export const DEPLOYABLES = ['site', 'portal', 'admin', 'api', 'worker'];

/** @type {Invariant} */
const ri04 = {
  id: 'RI-04',
  // COMPUTED FROM THE LIST, NOT WRITTEN BESIDE IT. The title read "site, portal,
  // admin and worker are four separate deployables" while the list held four,
  // so adding a fifth would have left a hand-maintained count contradicting the
  // thing it names -- which is precisely what RI-05's `covers` calls "a
  // hand-maintained count in a different costume, and it drifts the same way".
  // Nothing reads this file as text, so a computed title costs nothing here;
  // the test that names each check uses `c.title` only as a label.
  title: `${DEPLOYABLES.join(', ')} are ${DEPLOYABLES.length} separate deployables`,
  covers:
    'each entry in DEPLOYABLES has its own directory under apps/ with its own ' +
    'package.json and a distinct package name, and no app depends on another ' +
    'app. It does NOT check the deployment configuration, which does not exist ' +
    'yet: it checks the shape that makes a separate deployment possible. It ' +
    'also does NOT check that apps/ holds nothing BEYOND this list, so a sixth ' +
    'application directory added without an entry here is invisible to it, ' +
    'exactly as apps/api was.',
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
// -----------------------------------------------------------------------------
// RI-06  The three merit rules are registered AND attached to a glob
// -----------------------------------------------------------------------------
// ADR-042 wires `merit/no-calendar-in-expiry-path` to a glob that MATCHES ZERO
// FILES, because the hold, expiry and sweep path is P2 code. That is the right
// time to wire it and it creates a specific hazard: a rule scoped to nothing
// looks identical, in every CI run, to a rule that has been unplugged.
//
// The rule file could be deleted, or its `plugins`/`rules` block in
// eslint.config.js could be dropped in a merge, and LINT WOULD STAY GREEN AND
// SAY NOTHING, because there is no file for it to have an opinion about. This
// check is the difference between "the control is armed" and "the control is a
// file in the repository".
//
// It asserts the wiring, in both directions, for all three rules rather than
// just the new one: a plugin rule that nothing attaches, and an attachment
// naming a rule the plugin does not export, are the same defect mirrored.

/** @type {Invariant} */
const ri06 = {
  id: 'RI-06',
  title: 'Every merit ESLint rule is exported by the plugin and attached in eslint.config.js',
  covers:
    'both directions between packages/eslint-plugin-merit/index.js and the workspace root ' +
    'eslint.config.js: every rule the plugin registers is attached to at least one glob, and ' +
    'every `merit/*` rule the config names is one the plugin registers. It exists because ' +
    '`merit/no-calendar-in-expiry-path` is scoped to a path that does not exist yet (ADR-042), ' +
    'so an unplugged rule and an armed one produce byte-identical lint output. It does NOT ' +
    'check that a glob matches files, which for that rule is expected to be false until P2.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const pluginPath = 'packages/eslint-plugin-merit/index.js';
    const configPath = 'eslint.config.js';
    for (const rel of [pluginPath, configPath]) {
      if (!existsSync(join(root, rel))) throw new Error(`${rel} does not exist; RI-06 cannot run`);
    }

    const plugin = read(root, pluginPath);
    // The `rules: { ... }` map of the plugin, read as the source of truth for
    // what exists. Parsed from the text rather than imported, because this file
    // is a checker and importing an ESLint plugin to ask its name is a heavier
    // dependency than the question deserves.
    const block = /rules\s*:\s*\{([\s\S]*?)\}/.exec(plugin);
    if (!block?.[1]) throw new Error(`${pluginPath}: no \`rules\` map found; RI-06 cannot run`);
    const registered = [...block[1].matchAll(/'([a-z][a-z0-9-]*)'\s*:/g)].map((m) => m[1]);
    if (registered.length === 0) {
      throw new Error(
        `${pluginPath}: the \`rules\` map parsed to zero rules; RI-06 is asserting nothing`,
      );
    }

    const config = read(root, configPath);
    const attached = new Set(
      [...config.matchAll(/'merit\/([a-z][a-z0-9-]*)'\s*:/g)].map((m) => m[1]),
    );
    if (attached.size === 0) {
      throw new Error(
        `${configPath}: no \`merit/*\` rule is attached anywhere; RI-06 is asserting nothing`,
      );
    }

    for (const rule of registered) {
      if (!attached.has(rule)) {
        findings.push(
          `${pluginPath} registers \`merit/${rule}\` and ${configPath} attaches it to nothing. ` +
            'A rule nothing attaches is a file, not a control',
        );
      }
    }
    for (const rule of attached) {
      if (!registered.includes(rule)) {
        findings.push(
          `${configPath} attaches \`merit/${rule}\`, which ${pluginPath} does not register. ` +
            'ESLint fails at load on this, so it is caught either way; it is here so the ' +
            'failure names the cause rather than a resolution error',
        );
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-07  The engine's TRANSITIVE module graph reaches no Node builtin
// -----------------------------------------------------------------------------
// M01 SECTION 1.4's `RE-D-03`, WHICH IS A NAMED MERGE BLOCKER AND WAS NOT IN THE
// TREE: "`RE-D-03` is a dependency-graph assertion that the package's TRANSITIVE
// imports contain no Node builtins. All three are merge blockers."
//
// IT LANDS BESIDE RI-01 BECAUSE IT IS A REPO INVARIANT BY CONSTRUCTION and the
// manifest half of the same boundary already lives here.
//
// -----------------------------------------------------------------------------
// WHAT THE THREE EXISTING MECHANISMS CANNOT SEE, WHICH IS WHY THIS IS NOT A
// FOURTH SPELLING OF THEM
// -----------------------------------------------------------------------------
// The hole is concrete rather than theoretical, and it was verified on this tree
// before the check was written:
//
//   RI-01                 reads the MANIFEST. Its own `covers` says "It does NOT
//                         read the source"
//   merit/engine-purity   reads ONE FILE AT A TIME, and returns early on every
//                         relative specifier: `if (source.startsWith('.')) return`
//   eslint.config.js      attaches that rule to `packages/rules-engine/src/**/*.ts`
//                         and to nothing else
//   tsconfig `types: []`  removes the ambient DECLARATIONS, so `process` and
//                         `Buffer` do not exist. It does not stop an explicit
//                         `import { readFileSync } from 'node:fs'`
//
// So a file at `packages/rules-engine/impure/x.ts` that imports `node:crypto`,
// imported from `src/index.ts` as `../impure/x.js`, is INVISIBLE TO ALL FOUR AT
// ONCE: the specifier is relative so the lint rule returns early, the file is
// outside the glob so it is never linted itself, and no manifest entry appears
// so RI-01 stays green. That file is the seeded violation this check ships with
// in `scripts/ci/falsify-ci.mjs`, and that case asserts CI-01's other gates stay
// GREEN on it, which is what proves this check is additive.
//
// Walking the graph is the only way to see it, because the defect is a PATH and
// not a line.

/** Node's own list, so a builtin added by a future release is covered without an edit. */
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((m) => [m, `node:${m}`]).concat(builtinModules.map((m) => `node:${m}`)),
);

/**
 * Every statically written module specifier in one file, in source order.
 *
 * @param {string} source
 * @returns {string[]}
 */
function specifiersIn(source) {
  const code = stripComments(source);
  /** @type {string[]} */
  const out = [];
  for (const re of [
    // `import ... from 'x'` and `export ... from 'x'`.
    /\bfrom\s*['"]([^'"]+)['"]/g,
    // `import 'x'`, the side-effect form.
    /\bimport\s+['"]([^'"]+)['"]/g,
    // `import('x')` with a literal argument. A specifier BUILT AT RUNTIME is
    // invisible here and the `covers` line says so.
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m[1] !== undefined) out.push(m[1]);
    }
  }
  return out;
}

/**
 * Resolve a relative specifier the way this workspace publishes source.
 *
 * Every package here sets `"exports": { ".": "./src/index.ts" }` and nothing is
 * built by `tsc`, so TypeScript's `./x.js` convention names a file that is
 * actually `x.ts` on disk. `scripts/demo/ts-resolve.mjs` solves the same problem
 * for Node at runtime; this is the static half of it.
 *
 * @param {string} fromFile
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [];
  if (/\.(js|mjs|cjs)$/.test(base)) {
    candidates.push(base.replace(/\.(js|mjs|cjs)$/, '.ts'), base.replace(/\.js$/, '.mts'), base);
  } else if (/\.(ts|mts)$/.test(base)) {
    candidates.push(base);
  } else {
    candidates.push(`${base}.ts`, `${base}.mts`, `${base}.js`, join(base, 'index.ts'));
  }
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** @type {Invariant} */
const ri07 = {
  id: 'RI-07',
  title: "packages/rules-engine's transitive module graph reaches no Node builtin",
  covers:
    "M01 section 1.4's RE-D-03: it walks the module graph from " +
    'packages/rules-engine/src/index.ts, follows every relative import to the ' +
    'file it names, and reports three things: a reached file OUTSIDE ' +
    'packages/rules-engine/src (which no other mechanism can see, because ' +
    'merit/engine-purity returns early on a relative specifier and is attached ' +
    'only to that glob), a Node builtin anywhere in the closure, and a bare ' +
    'specifier that is neither. It reads STATIC specifiers and literal ' +
    "`import('...')` only, from source with comments stripped: a specifier BUILT " +
    "AT RUNTIME is invisible to it and is the property suites' and the replay " +
    "self-audit's to catch, which is the same division merit/engine-purity's own " +
    'header draws. It does not read the manifest; that is RI-01.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const entry = join(root, 'packages/rules-engine/src/index.ts');
    if (!existsSync(entry)) {
      throw new Error(`packages/rules-engine/src/index.ts does not exist; RI-07 cannot run`);
    }

    const srcRoot = join(root, 'packages/rules-engine/src');
    const seen = new Set();
    /** @type {Array<{file: string, via: string[]}>} */
    const queue = [{ file: entry, via: [] }];
    let walked = 0;

    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      const { file, via } = next;
      if (seen.has(file)) continue;
      seen.add(file);
      walked++;

      const rel = file.startsWith(root) ? file.slice(root.length + 1) : file;
      const trail = via.length === 0 ? 'the entry point' : `${via.join(' -> ')} -> ${rel}`;

      for (const spec of specifiersIn(readFileSync(file, 'utf8'))) {
        if (NODE_BUILTINS.has(spec)) {
          findings.push(
            `${rel} imports the Node builtin \`${spec}\`. M01 INV-01: "The engine ` +
              'performs no I/O and reads no clock", enforced by RE-D-01, RE-D-03 and ' +
              `ESLint. Reached by: ${trail}`,
          );
          continue;
        }

        if (!spec.startsWith('.')) {
          findings.push(
            `${rel} imports \`${spec}\`, which is neither relative nor a Node builtin. ` +
              'An external package reached from engine source resolves anyway under a ' +
              'hoisted layout, with no manifest entry for RI-01 to find. ' +
              `Reached by: ${trail}`,
          );
          continue;
        }

        const target = resolveRelative(file, spec);
        if (target === null) {
          findings.push(
            `${rel} imports \`${spec}\`, which resolves to no file on disk. RI-07 ` +
              'cannot walk what it cannot find, and a check that silently stopped ' +
              `walking would report PASS for a subgraph it never read. Reached by: ${trail}`,
          );
          continue;
        }

        // THE FINDING NO OTHER MECHANISM PRODUCES. A relative import that leaves
        // `src/` leaves the region `merit/engine-purity` is attached to, so
        // everything the escaped file imports is unlinted.
        if (!target.startsWith(srcRoot + '/')) {
          const targetRel = target.startsWith(root) ? target.slice(root.length + 1) : target;
          findings.push(
            `${rel} imports \`${spec}\`, which resolves to ${targetRel}, OUTSIDE ` +
              'packages/rules-engine/src. `merit/engine-purity` is attached to ' +
              '`packages/rules-engine/src/**/*.ts` and returns early on a relative ' +
              'specifier, so neither this import nor anything the escaped file ' +
              `imports is linted at all. Reached by: ${trail}`,
          );
        }

        queue.push({ file: target, via: [...via, rel] });
      }
    }

    // A CHECK THAT WALKED ONE FILE IS NOT A CHECK THAT PASSED. The engine is a
    // multi-file package (M01 section 1.3 lists thirteen modules), so a graph
    // walk that reached only the entry point means the specifier scan stopped
    // matching, not that the engine became a single file.
    if (walked < 2) {
      throw new Error(
        `RI-07 walked ${walked} file(s) from src/index.ts. The engine is a multi-file ` +
          'package, so this means the specifier scan matched nothing and the check is ' +
          'asserting about a graph it did not read',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-08  No package declares the database accessor unless it has been admitted
// -----------------------------------------------------------------------------
// ADR-096 SECTION 9 NAMED THIS CHECK, MEASURED THE HOLE IT CLOSES, AND ASSIGNED
// IT TO `P4-e`. `P4-e` LANDED WITHOUT IT. Three entries have now cited the same
// hole and none closed it: ADR-096 section 9, ADR-095 `F4`, and ADR-095 section
// 9 item 5b, which is the two of them noticing each other.
//
// THE HOLE, IN ADR-096's OWN WORDS. "A marketing page can acquire a
// write-capable connection to the trader database in a one-line manifest diff",
// and the entry watched it happen rather than predicting it: `"@merit/db":
// "workspace:*"` added to `apps/site/package.json` plus one
// `systemDb('nightly-batch').rows('accounts')` call under `apps/site/src` -- a
// firm-wide unscoped read of the account table, on the marketing origin -- left
// `tsc --noEmit` at 0, `eslint apps packages` at 0, `check:invariants` at 7 of 7
// and `gates.mjs check` at 30 of 30. Section 8 is why that line is the whole
// defect: `0026_roles_and_grants.sql` declares three roles and `merit_app`, the
// only one that could serve the site, holds INSERT and full DML.
//
// WHY NOTHING ELSE SEES IT.
//
//   merit/no-raw-db-client  bans a RAW client -- `pg`, `drizzle-orm`, a second
//                           ORM -- and `@merit/db` is deliberately not on that
//                           list, because reaching the database THROUGH the
//                           accessor is the idiom it funnels everything into.
//                           It is working as designed and has nothing to say
//                           here (ADR-096 section 9)
//   RI-01                   reads a manifest, and reads exactly one:
//                           `packages/rules-engine`'s
//   RI-04                   asks whether one deployable depends on ANOTHER
//                           DEPLOYABLE. `@merit/db` is a package, so a
//                           dependency on it is not a finding of RI-04's and
//                           never was
//   RI-09                   reads PATHS, and says so about this exact row: "it
//                           is also NOT the mechanism ADR-095 section 9 item 5
//                           owes for a server component importing packages/db:
//                           that defect is an import and this one is a path"
//
// THE MANIFEST LINE IS THE ACQUISITION POINT IN BOTH DIRECTIONS, AND THAT WAS
// MEASURED RATHER THAN ASSUMED. `.npmrc` sets `node-linker=isolated` "because
// the default is load-bearing here rather than incidental", so an undeclared
// specifier does not resolve at run time. It does not resolve at BUILD time
// either: seeded into `apps/site/src` and again into `apps/api/src`, with no
// manifest line and no `paths` mapping anywhere in the tree,
// `import { systemDb } from '@merit/db'` reports
//
//   error TS2307: Cannot find module '@merit/db' or its corresponding type
//   declarations.
//
// in BOTH packages. So the manifest field is not merely where the dependency is
// recorded; it is the only place the capability can be acquired, which is what
// makes a manifest check the whole control rather than half of one. (It also
// makes `apps/api/package.json`'s claim that "`tsc` resolves it happily through
// the workspace" wrong on this tree. That file is out of this session's fence
// and the finding is reported rather than taken.)
//
// -----------------------------------------------------------------------------
// WHY AN EMPTY ADMISSION LIST OVER EVERY PACKAGE, AND NOT TWO NAMES
// -----------------------------------------------------------------------------
// ADR-096 section 9 scopes it to `apps/site` and then widens itself in the next
// sentence: "`packages/queue` has held the same shape since ADR-086 with the
// same absence of a check, so this is a second instance rather than a new class,
// and an `RI-08` written to cover both is the better version of it."
//
// ADR-095 SECTION 9 ITEM 5b NAMES THE UNDER-SCOPING FROM THE OTHER SIDE:
// "`RI-08` as ADR-096 scopes it does NOT close `F4` ... it reads `apps/site`
// where `F4`'s subject is M04:25, which is `apps/portal`."
//
// AND THE TREE HAS MOVED PAST BOTH READINGS. Counted here rather than inherited:
// FIVE manifests now state the accessor's absence as a design property in their
// own `//` key -- `packages/queue` (ADR-086), `packages/ledger`, `packages/psp`,
// `apps/api` (ADR-109) -- plus `apps/site` by ADR-096 ruling 2, and
// `apps/worker/src/provisioning/ports.ts` says it in a header. ZERO packages in
// this workspace declare `@merit/db` in any dependency field. A check listing
// two of those five by name would have been silent about the other three on the
// day it was written.
//
// RI-10 IS THE CAUTIONARY TALE AND IT IS ONE DIRECTORY UP THIS FILE: its first
// draft excluded a package BY NAME, and the principled fix was to scope it to
// `src/` rather than to grow the exclusion. A check that needs a name-based
// exception is usually scoped wrong. So the scope here is EVERY WORKSPACE
// PACKAGE and the exception is a list that is EMPTY.
//
// AN EMPTY LIST IS THIS WORKSPACE'S OWN IDIOM FOR EXACTLY THIS, IN THREE PLACES.
// `pnpm-workspace.yaml`'s `onlyBuiltDependencies: []`: "an empty list means every
// one of them is an explicit admission decision rather than a default".
// `.npmrc`: "every one of these settings exists to make a dependency arrive as a
// decision rather than as a side effect". And ADR-084 section 5, which is the
// accessor's own design: "the legitimate unscoped readers are a list somebody
// has to join", closed at two members on the argument that "forgot to scope"
// becomes "wrote the word system".
//
// THIS IS THAT ARGUMENT POINTED AT THE MANIFEST. ADR-096 section 4 states the
// cost it could not repair: the ruling "turns it into 'added one line to a
// package.json', which is also a diff a reviewer reads and is SHORTER, less
// obviously about the database, and reviewed by whoever reviews manifests rather
// than by whoever reviews queries." With an empty `DB_ADMITTED`, that one line
// turns CI-01 red, and making it green again costs a SECOND diff, in this file,
// whose entire subject is which packages may reach the trader database. The
// quiet line becomes a loud one.
//
// `apps/api` IS THE FIRST NAME THAT WILL JOIN, AND IT IS NOT PRE-ADMITTED.
// ADR-109 and `apps/api/src/idempotency.ts` record that its absence is "session
// 219's finding rather than its oversight", so the day the API needs the
// accessor is the day somebody writes it here with a reason. Admitting it now,
// against a need nobody has yet stated, is the list joining itself.
//
// -----------------------------------------------------------------------------
// THAT DAY WAS 2026-08-27 AND THE PARAGRAPH ABOVE IS LEFT STANDING RATHER THAN
// REWRITTEN, BECAUSE IT IS THE RECORD OF WHAT THE LIST PROMISED BEFORE IT WAS
// JOINED
// -----------------------------------------------------------------------------
// `@merit/api` IS THE FIRST AND ONLY ENTRY THIS LIST HAS EVER CARRIED, AND
// ADR-120 IS THE RULING RATHER THAN THIS LINE. Session 218 declared `AuthBackend`
// blocked on its own declaration rather than reaching for the manifest, and
// session 220 declined `IdempotencyStore` for the same reason and wrote the
// argument into ADR-113 section 6: the admission is "an authority change on the
// deployable that serves the whole public surface rather than a side effect of a
// checkout slice". BOTH WERE RIGHT AND NEITHER IS OVERTURNED. What changed is
// not the argument, it is whose session the admission is: ADR-120's SUBJECT is
// this list gaining a member, and a slice whose subject is the authority change
// is the only kind of slice that may take one.
//
// THE PARAGRAPH ABOVE ALSO SET THE PRICE AND IT WAS PAID IN FULL, WATCHED.
// With the manifest line added and this list still empty, `node
// packages/tooling/checks/repo-invariants.mjs` exits 1 at 9 of 10 with
// `FAIL RI-08` naming `apps/api/package.json: dependencies.@merit/db`. ADR-096
// section 4's quiet line became the loud one, and making it green again cost
// exactly the second diff ADR-117 section 4 said it would: this one, in the file
// whose whole subject is which packages may reach the trader database.
//
// WHAT ADMITTING `@merit/api` DOES NOT GRANT, stated at the site because a
// reader of this list will ask. It grants the ability to NAME `@merit/db`, and
// nothing about what may be done with it: `scopedDb` still needs an identity,
// `systemDb` still needs one of two reasons, `firmDb` still refuses every
// `owned` key, and ADR-112's addressed write still refuses an address that names
// no unique key. ADR-084's brands and ADR-008's scoping are the controls on the
// USE, at the type level, and they are unmoved by this line.
//
// THE LIST STAYS AT ONE NAME AND THE GUARDS BELOW ARE UNTOUCHED. In particular
// the `guarded.length === 0` throw stands: a list that covers every package
// still makes this check refuse to run, which is the gate defending its own
// weakening and is the assertion that matters most now that the list is no
// longer empty.

// -----------------------------------------------------------------------------
// THE LIST REACHED TWO NAMES LATER THE SAME DAY AND THE PARAGRAPH ABOVE IS LEFT
// STANDING FOR THE REASON THE ONE ABOVE IT WAS: IT IS THE RECORD OF WHAT THE
// LIST PROMISED WHILE IT HELD ONE
// -----------------------------------------------------------------------------
// EXACTLY ONE OF ITS TWO SENTENCES STOPPED BEING TRUE, and it is the first.
// "THE LIST STAYS AT ONE NAME" does not survive this entry. "THE GUARDS BELOW
// ARE UNTOUCHED" does, and it is the one that was load bearing: the
// `guarded.length === 0` throw stands, the stale-name throw stands, `acquires`
// is unchanged, and nothing in `run()` was edited to make a second name fit.
// The whole of the diff ADR-165 lands in this file is one array element, its
// comment, and this block.
//
// `@merit/worker` IS ADMITTED BY ADR-165, AND THE QUESTION THAT ENTRY ANSWERS
// IS "MAY A SCHEDULED JOB READ THE TRADER DATABASE". It is a different question
// from the one ADR-120 answered, and the difference is not size. `apps/api`
// reaches a row ON BEHALF OF A CALLER IT RESOLVED, which is why
// `scopedDb(identity)` is the shape of that whole deployable and why
// `apps/api/src/db.ts` declares two doors and refuses a third. A SCHEDULED JOB
// HAS NOBODY TO RESOLVE. It runs at 06:00 CT because a clock said so, it
// partitions across every account that has ever existed, and a per-identity
// scope is not a smaller version of that job.
//
// THE WORD EXISTED BEFORE THE DOOR DID, WHICH IS THE STRONGEST FACT HERE.
// `SystemReason`'s first member is `'nightly-batch'` and `systemDb`'s own
// docstring in `packages/db/src/scoped-db.ts` justifies it by citing THIS
// deployable's `apps/worker/src/batch/ports.ts` and its
// `accountsWithStoredState()` "for EVERY account that has ever existed". So
// since ADR-084 the accessor has carried a reason whose only legitimate holder
// is a package that could not name the accessor at all. This line closes that
// gap and widens nothing: `SystemReason` still has two members, and
// `'nightly-batch'` is what a detector run, a fold, a sweep and an assertion
// each already are.
//
// IT IS THE SUBJECT AND NOT A MEANS, AND THREE FILES IN THIS DEPLOYABLE HAVE
// DECLINED IT ALREADY FOR PRECISELY THAT REASON. ADR-117 ruling 4's test is
// kept exactly as sessions 218 and 220 met it, and `apps/worker` has met it
// three more times: `src/index.ts` (session 147) wrote "the wiring is one
// manifest line and one call, in the session that brings the first job with
// it"; `src/batch/ports.ts` wrote "WHEN THE CLIENT LANDS, the adapter is
// written against `packages/db`'s accessor" and built the batch against ports
// instead; `src/provisioning/ports.ts` (session 222) wrote "THIS SESSION IS
// THAT SESSION AND THE MANIFEST IS OUTSIDE ITS FENCE" and reported the wiring
// rather than reaching for it. Five declines across two deployables is what a
// control that works looks like from the inside, and every one of them named
// the same remedy: a session whose OBJECT is the admission. ADR-165 is that
// session and `ALLOCATION` row `165` reserved the number before it ran.
//
// WHAT ADMITTING `@merit/worker` DOES NOT GRANT. The paragraph above about
// `@merit/api` applies unchanged and is not restated: this list grants the
// ability to NAME `@merit/db` and says nothing about what may be done with it.
// What is specific to this deployable is that it takes ONE door rather than
// two. `apps/worker/src/db.ts` opens `batch(fn)` over
// `systemDb('nightly-batch')` and declares no `scoped`, no `firm` and no
// reason parameter, so `'operator-console'` is unreachable from this deployable
// by construction rather than by convention: there is no argument position a
// caller could put it in. `SystemTx` is a superset of `FirmTx` over reads and
// inserts, which is why a second door would have bought nothing and cost a word
// somebody could use.
//
// WHAT THIS FORECLOSES, WHICH IS THE HALF A LATER READER ACTUALLY NEEDS.
// THREE DEPLOYABLES REMAIN OUTSIDE AND EACH IS REFUSED BY SOMETHING THAT IS NOT
// THIS LIST. `apps/site` is refused by ADR-096 ruling 2 and watched by its own
// `test/manifest.test.ts`; `apps/portal` and `apps/admin` are browser surfaces
// that reach data through `apps/api` over HTTP (ADR-162 landed the portal's one
// transport file), so an admission for either would be a second data path to
// the same rows rather than a first path to new ones. FIVE PACKAGES STATE THE
// ACCESSOR'S ABSENCE AS A DESIGN PROPERTY IN THEIR OWN MANIFESTS and all five
// stay stated. So the rule for the next slice is the rule this one followed and
// it is not "argue harder": a slice that finds it needs one of those eight
// names STOPS, reports it, and the admission is taken by a session whose whole
// subject is the authority change. A SECOND NAME ADDED QUIETLY BESIDE A
// FEATURE IS THE FAILURE MODE, and it is cheaper to spot in a two-name list
// than it was in a one-name list only because somebody wrote this paragraph.

/**
 * The packages permitted to declare the database accessor, by package name.
 *
 * THE ADMISSION IS THE CONTROL, AT EVERY LENGTH THIS LIST HAS EVER HAD. It was
 * EMPTY from ADR-117 until ADR-120 and held ONE NAME from ADR-120 until ADR-165,
 * and the emptiness was the control then for the same reason each entry is now:
 * adding a name here is the admission decision, a diff in the file whose subject
 * is which packages may reach the trader database, reviewed by whoever reviews
 * controls, rather than one line in a manifest reviewed by whoever reviews
 * manifests. THE LENGTH IS NOT WRITTEN HERE, on the rule `ri08.title` follows
 * one screen down: a count beside a list is a hand-maintained count in a
 * different costume.
 *
 * `@merit/api` is admitted by ADR-120 and `@merit/worker` by ADR-165, each
 * because it is that entry's SUBJECT. The argument for both names, and against
 * every other one, is in the header above.
 *
 * EXPORTED SO THE TEST READS THIS LIST rather than a second copy of it, which is
 * DEPLOYABLES' relationship to its fixture. RI-04's header states what the
 * second copy cost when it drifted: "Two lists is the defect; one list read
 * twice is the fix."
 *
 * A name that is not a workspace package makes the check THROW rather than
 * quietly exempt nothing, and a list that covers every package makes it throw
 * too. The second guard is "never weaken a gate to pass it" made mechanical:
 * green cannot be bought by admitting everybody.
 *
 * @type {string[]}
 */
export const DB_ADMITTED = [
  // ADR-120. `apps/api` serves the whole public surface API_CONTRACT specifies,
  // and every authenticated handler in it "resolves the caller to an identity
  // and reads through `scopedDb(identity)`" (API_CONTRACT section 1). Sessions
  // 218 and 220 each reached this line from a slice whose subject was something
  // else and each correctly declined; ADR-120's subject IS the admission.
  '@merit/api',

  // ADR-165. `apps/worker` runs every row of CRON_INVENTORY's scheduled-work
  // table -- the nightly batch, the replay self-audit, provisioning delivery,
  // the ledger assertions, the statistics run, the detector runs, the expiry
  // sweeps -- and not one of them has a caller to resolve. It takes ONE door,
  // `systemDb('nightly-batch')` through `apps/worker/src/db.ts`, and that
  // reason has named this deployable's own `batch/ports.ts` since ADR-084, so
  // the word was here before the package could name the accessor the word lives
  // in. Sessions 147 and 222 each reached this line from a slice whose subject
  // was something else and each correctly declined; ADR-165's subject IS the
  // admission.
  '@merit/worker',
];

/**
 * The three ways one dependency entry acquires a named package, and the reason
 * this is not `spec.includes(name)`.
 *
 * A substring test reports `"@merit/dbtools": "workspace:*"` as the accessor and
 * misses `"db": "link:../../packages/db"` entirely, which is the one form where
 * NEITHER the key nor the specifier writes the name down. Each reading is named
 * so a finding says which one fired.
 *
 * @param {string} root
 * @param {string} fromDir       repo-relative directory of the declaring package
 * @param {string} name          the dependency key
 * @param {string} spec          the dependency specifier
 * @param {string} targetName    the package being guarded
 * @param {string} targetDir     repo-relative directory of that package
 * @returns {string | null}      why it resolves there, or null
 */
function acquires(root, fromDir, name, spec, targetName, targetDir) {
  if (name === targetName) return 'names it directly';

  // pnpm's alias forms, `"db": "workspace:@merit/db@*"` and `"db":
  // "npm:@merit/db@0.0.0"`. The name is parsed out rather than searched for, so
  // a scoped name is matched whole.
  const alias = /^(?:workspace|npm):((?:@[^/@\s]+\/)?[^@\s]+)@/.exec(spec);
  if (alias?.[1] === targetName) return `aliases it as \`${name}\``;

  // The path forms, which write no package name at all.
  const linked = /^(?:link|file|portal):(.+)$/.exec(spec);
  if (linked?.[1] !== undefined) {
    if (resolve(join(root, fromDir), linked[1].trim()) === join(root, targetDir))
      return `links its directory as \`${name}\``;
  }
  return null;
}

/** @type {Invariant} */
const ri08 = {
  id: 'RI-08',
  // COMPUTED FROM THE LIST, for the reason RI-04's title is computed and RI-05's
  // `covers` states: a count written beside a list is a hand-maintained count in
  // a different costume, and it drifts the same way.
  title:
    DB_ADMITTED.length === 0
      ? 'No package in this workspace declares the database accessor, in any dependency field'
      : `Only ${DB_ADMITTED.length} admitted package(s) declare the database accessor, ` +
        'in any dependency field',
  covers:
    "every workspace package except the accessor's own, in all four dependency " +
    'fields, against an admission list that is EMPTY. It reads three ways a ' +
    'specifier resolves to the accessor -- the key, a `workspace:`/`npm:` alias ' +
    'whose target is parsed out rather than searched for, and a ' +
    '`link:`/`file:`/`portal:` path that resolves to the accessor directory -- ' +
    "and it names which one fired. It is the MANIFEST half only, and RI-01's " +
    'division is the one it follows. FOUR THINGS A GREEN RESULT DOES NOT COVER. ' +
    '(1) It does not read SOURCE. `merit/no-raw-db-client` reads source and bans ' +
    'a RAW client, which the accessor deliberately is not; the accessor-import ' +
    'half exists for `apps/site` alone, in apps/site/test/manifest.test.ts, and ' +
    'nowhere else. (2) It does not follow TRANSITIVE edges, and that is a ' +
    'boundary rather than an omission: `.npmrc` sets `node-linker=isolated`, so ' +
    'an undeclared specifier resolves neither at run time nor at build time ' +
    '(TS2307, measured from apps/site and apps/api both, with no `paths` mapping ' +
    'in the tree), which makes the DIRECT field the acquisition point. The day ' +
    'DB_ADMITTED stops being empty, a package depending on an admitted one is ' +
    'not a finding here. (3) It says nothing about what an admitted package DOES ' +
    'with the accessor; ADR-084 branding and ADR-008 scoping are that, at the ' +
    'type level. (4) It does not read a raw driver in a dependency field: a ' +
    'declared-but-unimported `pg` is refused by nothing until the import, which ' +
    'is reported rather than taken here. It IS the manifest mechanism ADR-095 ' +
    "`F4`'s import half was owed, over every package rather than over apps/site " +
    'alone, and it is not the lint rule `F4` names.',
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const accessorRel = 'packages/db/package.json';
    if (!existsSync(join(root, accessorRel)))
      throw new Error(
        `${accessorRel} does not exist; RI-08 has no accessor to guard and cannot run`,
      );
    const accessorName = readJson(root, accessorRel).name;
    if (typeof accessorName !== 'string' || accessorName === '')
      throw new Error(`${accessorRel} declares no name; RI-08 cannot run`);

    const packages = workspacePackages(root);
    if (packages.length === 0) throw new Error('no workspace packages resolved; RI-08 cannot run');

    // THE ACCESSOR IS READ OUT OF THE WORKSPACE, NOT WRITTEN HERE. RI-09's
    // relationship to surface.ts, one register over: parse the source of truth
    // and implement the comparison.
    const accessor = packages.find((p) => p.name === accessorName);
    if (accessor === undefined)
      throw new Error(
        `${accessorRel} names \`${accessorName}\`, which resolves to no package in this ` +
          'workspace, so RI-08 would be guarding a name nothing can declare; it cannot run',
      );

    const known = new Set(packages.map((p) => p.name));
    for (const admitted of DB_ADMITTED) {
      if (!known.has(admitted))
        throw new Error(
          `DB_ADMITTED holds \`${admitted}\`, which is not a package in this workspace. A stale ` +
            'admission reads as though the accessor is permitted somewhere it is not; RI-08 ' +
            'cannot run',
        );
    }

    const guarded = packages.filter(
      (p) => p.name !== accessorName && !DB_ADMITTED.includes(p.name),
    );
    // A CHECK THAT GUARDED NOTHING IS NOT A CHECK THAT PASSED, and this is the
    // direction the check gets weakened in: not by deleting it, but by admitting
    // one more package each time one is inconvenient, until the list is
    // everybody and RI-08 reports PASS about a workspace it exempted entirely.
    if (guarded.length === 0)
      throw new Error(
        `DB_ADMITTED admits every package but ${accessorName} itself, so RI-08 is asserting ` +
          'nothing; it cannot run',
      );

    for (const pkg of guarded) {
      const rel = `${pkg.dir}/package.json`;
      for (const field of DEP_FIELDS) {
        for (const [dep, spec] of Object.entries(pkg.manifest[field] ?? {})) {
          const why = acquires(root, pkg.dir, dep, String(spec), accessorName, accessor.dir);
          if (why === null) continue;
          findings.push(
            `${rel}: ${field}.${dep} is \`${String(spec)}\`, which ${why}. ${pkg.name} is not ` +
              `in DB_ADMITTED, and under \`node-linker=isolated\` this line is the whole ` +
              `difference between a package that cannot name \`${accessorName}\` at all and one ` +
              'holding an unscoped, write-capable connection to the trader database. ADR-096 ' +
              'section 8: the only role such a reader could hold is `merit_app`, which carries ' +
              'INSERT and full DML. Admit it in DB_ADMITTED with a reason, or drop the line',
          );
        }
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-09  Only apps/api spells a path on the API surface
// -----------------------------------------------------------------------------
// ADR-083 CLOSES THE OPERATOR PATH WITH TWO STATUS CODES ONE ROW APART, AND
// NOTHING HELD THE DOOR. Its section 4 reads API_CONTRACT section 12's matrix:
// a trader session calling `/admin/*` gets 403, and calling `/internal/*` from
// the public origin gets 404. "403 is what a permission check returns. 404 is
// what an ABSENT ROUTE returns", so the route set is chosen at startup and the
// public deployment answers 404 by having nothing there. `surface.ts` is that
// partition and `surface.test.ts` watches it in both directions.
//
// ALL OF THAT IS ABOUT apps/api, AND NONE OF IT IS ABOUT ANYWHERE ELSE. A file
// that serves `/api/v1/admin/payouts` from inside a UI deployable makes the
// path exist on the public origin without apps/api registering anything, and
// the estate says nothing: seeded on `main`, `pnpm run lint`, `pnpm -r run
// typecheck`, this file, `gates.mjs check` and the full suite are byte-identical
// to the clean tree. RI-04 iterates deployables and asks whether one DEPENDS on
// another; it never asks what one SERVES, and a route handler declares no
// dependency at all. `merit/no-raw-db-client` bans a client import, not a route.
// ADR-098 is the ruling that this absence is a PROPERTY rather than an
// ASSUMPTION, and this check is that property.
//
// WHY A PATH CHECK AND NOT A LINT RULE. RI-07's header states the rule this
// follows: "the defect is a PATH and not a line". A filesystem-routing
// framework turns a directory name into a URL, so the violation is complete
// before any statement is written and an exported `GET` is a consequence rather
// than the cause. ESLint is attached to globs and reads files one at a time; it
// is the wrong instrument for an assertion about where a file IS.
//
// THE TWO LISTS ARE READ FROM apps/api/src/surface.ts AND NEVER WRITTEN HERE.
// `BASE_PATH` and `OPERATOR_PREFIXES` are the contract's own vocabulary and
// they live in one file. RI-06 has the same relationship to the ESLint plugin:
// parse the source of truth, implement the comparison. A second copy of
// `['/admin', '/internal']` in this file would drift the day the contract grows
// a third operator prefix, and it would drift SILENTLY, which is the whole
// failure mode this check exists inside.

/** The one deployable that owns the API surface. ADR-083 ruling 1. */
export const SURFACE_OWNER = 'api';

/**
 * Directory names a filesystem-routing framework treats as the root of its URL
 * space, so that the segment BELOW one of these is a URL segment.
 *
 * DELIBERATELY ONLY THE TWO NEXT.JS SPELLS, because Next.js App Router is the
 * only such framework this workspace admits (ADR-095 ruling 1, `apps/portal`
 * and `apps/site`). A guess at SvelteKit's `routes` would have refused
 * `apps/site/src/routes/`, which exists today and is seven pure render
 * functions rather than a router. A framework this workspace has not admitted
 * is a new entry here, and the `covers` line says so rather than pretending
 * the list is exhaustive.
 */
const ROUTING_ROOTS = ['app', 'pages'];

/**
 * Segments a Next.js route path carries that the URL does not: route groups
 * `(marketing)` and parallel routes `@modal`.
 *
 * Skipped so the check catches MORE, never less. `app/(ops)/admin/route.ts`
 * serves `/admin`, and a naive "the segment under the routing root" test would
 * read `(ops)` and find nothing. Private `_folders` are deliberately NOT
 * skipped and are deliberately not exempted either: this check asserts a
 * SPELLING, not a prediction about what one framework version happens to
 * route, and a path under `_lib` that spells the operator surface is still a
 * path that spells the operator surface.
 *
 * @param {string} segment
 * @returns {boolean}
 */
const isUrlInvisible = (segment) =>
  (segment.startsWith('(') && segment.endsWith(')')) || segment.startsWith('@');

/**
 * The two lists ADR-083 partitions on, read out of `apps/api/src/surface.ts`.
 *
 * Parsed from the text rather than imported: this file has no build step and
 * `surface.ts` is TypeScript, and RI-06 already established that parsing the
 * source of truth beats keeping a second copy of it. Anything that fails to
 * parse THROWS, on the file's second rule: a check that cannot reach its inputs
 * is not a check that passed.
 *
 * @param {string} root
 * @returns {{ rel: string, baseSegments: string[], operatorSegments: string[] }}
 */
export function apiSurfaceVocabulary(root) {
  const rel = `apps/${SURFACE_OWNER}/src/surface.ts`;
  if (!existsSync(join(root, rel)))
    throw new Error(`${rel} does not exist; RI-09 has no surface vocabulary and cannot run`);
  const source = read(root, rel);

  const base = /\bBASE_PATH\s*=\s*['"]([^'"]+)['"]/.exec(source);
  if (!base?.[1]) throw new Error(`${rel}: no \`BASE_PATH\` literal found; RI-09 cannot run`);
  const baseSegments = base[1].split('/').filter(Boolean);
  if (baseSegments.length === 0)
    throw new Error(
      `${rel}: \`BASE_PATH\` is \`${base[1]}\`, which has no segments; RI-09 cannot run`,
    );

  const block = /\bOPERATOR_PREFIXES\s*=\s*\[([^\]]*)\]/.exec(source);
  if (block?.[1] === undefined)
    throw new Error(`${rel}: no \`OPERATOR_PREFIXES\` array found; RI-09 cannot run`);
  const operatorSegments = [...block[1].matchAll(/['"]\/([^'"/]+)['"]/g)].map((m) => String(m[1]));
  if (operatorSegments.length === 0)
    throw new Error(
      `${rel}: \`OPERATOR_PREFIXES\` parsed to zero prefixes; RI-09 would be asserting ` +
        'nothing about the operator surface, which is the half it exists for',
    );

  return { rel, baseSegments, operatorSegments };
}

/**
 * Where a run of segments starts inside a path, or -1.
 *
 * @param {string[]} segments
 * @param {string[]} run
 * @returns {number}
 */
function indexOfRun(segments, run) {
  for (let i = 0; i + run.length <= segments.length; i++) {
    if (run.every((want, k) => segments[i + k] === want)) return i;
  }
  return -1;
}

/** @type {Invariant} */
const ri09 = {
  id: 'RI-09',
  // COMPUTED, for the reason RI-04's title is computed and RI-05's `covers`
  // states: a count written beside a list is a hand-maintained count in a
  // different costume, and it drifts the same way.
  title:
    `Of ${DEPLOYABLES.length} deployables only apps/${SURFACE_OWNER} holds a file whose ` +
    'path spells a route on the API surface',
  covers:
    'every file under each deployable in DEPLOYABLES except apps/' +
    SURFACE_OWNER +
    ", in three path shapes read against apps/api/src/surface.ts's own " +
    "`BASE_PATH` and `OPERATOR_PREFIXES`: the base path's segments appearing " +
    'consecutively anywhere in the path, an operator prefix sitting directly ' +
    'below the base path or below a routing root, and an `api` segment sitting ' +
    'directly below a routing root. FOUR THINGS IT DOES NOT SEE, each of which ' +
    'a green result must not be read as covering. (1) It reads PATHS, so a ' +
    'route reached by a catch-all segment, a rewrite, a middleware or a hand-' +
    'written router table declares nothing this check can find; the spelling is ' +
    'the convention a filesystem-routing framework makes load-bearing and not ' +
    'the only way to serve a path. (2) ROUTING_ROOTS holds the two Next.js ' +
    'spells because ADR-095 admits Next.js and nothing else; another ' +
    "framework's routing root is a new entry here, though the base-path shape " +
    'is framework-independent and catches it anyway. (3) It does not read ' +
    'apps/api, which OWNS the surface: that half is surface.ts and ' +
    'surface.test.ts. (4) It does not read packages/, because a package routes ' +
    'nothing on its own and reaches an origin only through a deployable ' +
    'depending on it, which is RI-04. It is also NOT the mechanism ADR-095 ' +
    'section 9 item 5 owes for a server component importing packages/db: that ' +
    'defect is an import and this one is a path.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    if (!DEPLOYABLES.includes(SURFACE_OWNER))
      throw new Error(
        `\`${SURFACE_OWNER}\` is not in DEPLOYABLES, so RI-09 would exempt a deployable that ` +
          'does not exist and read one that owns nothing; RI-09 cannot run',
      );
    const { rel: surfaceRel, baseSegments, operatorSegments } = apiSurfaceVocabulary(root);
    const basePath = `/${baseSegments.join('/')}`;
    const operators = new Set(operatorSegments);

    let inspected = 0;
    for (const app of DEPLOYABLES) {
      if (app === SURFACE_OWNER) continue;
      const appDir = `apps/${app}`;
      // A MISSING DEPLOYABLE IS RI-04'S FINDING AND NOT THIS ONE'S. Reporting
      // it here too would print one defect twice and make a reader think two
      // properties broke.
      if (!existsSync(join(root, appDir))) continue;

      for (const file of walk(root, appDir)) {
        inspected++;
        const segments = file.split('/').slice(2, -1); // drop `apps/<app>`, drop the filename
        const visible = segments.filter((s) => !isUrlInvisible(s));

        const baseAt = indexOfRun(visible, baseSegments);
        const under = baseAt === -1 ? undefined : visible[baseAt + baseSegments.length];
        if (under !== undefined && operators.has(under)) {
          findings.push(
            `${file} spells \`${basePath}/${under}\` inside apps/${app}. API_CONTRACT ` +
              `section 12 requires 404 for the operator surface from the public origin, and ` +
              `ADR-083 section 4 makes that 404 the ROUTER's: apps/${SURFACE_OWNER} chooses ` +
              'its route set at startup and the public deployment registers nothing there. A ' +
              `path served from apps/${app} is not in that route set and cannot be kept out ` +
              `of it (${surfaceRel} is the vocabulary this reads)`,
          );
          continue;
        }
        if (baseAt !== -1) {
          findings.push(
            `${file} spells \`${basePath}\` inside apps/${app}. ADR-083 ruling 1: the API is ` +
              `its own deployable and not a server inside a UI surface, on API_CONTRACT ` +
              'section 1\'s "no privileged back door" -- a surface that CONTAINS the API has ' +
              'one by construction, because a handler in the same package is an import away',
          );
          continue;
        }

        const rootAt = visible.findIndex((s) => ROUTING_ROOTS.includes(s));
        const below = rootAt === -1 ? undefined : visible[rootAt + 1];
        if (below !== undefined && operators.has(below)) {
          findings.push(
            `${file} puts \`${below}\` directly below the routing root \`${visible[rootAt]}\` ` +
              `in apps/${app}, which serves \`/${below}\` on that deployable's origin. ` +
              `\`/${below}\` is an OPERATOR_PREFIXES entry in ${surfaceRel}: API_CONTRACT ` +
              'heads those sections "admin origin only" and ADR-083 ruling 2 gives them to ' +
              `the operator deployment alone`,
          );
          continue;
        }
        if (below !== undefined && below === baseSegments[0]) {
          findings.push(
            `${file} puts \`${below}\` directly below the routing root \`${visible[rootAt]}\` ` +
              `in apps/${app}. That directory is an API surface inside a UI deployable by the ` +
              "framework's own convention, which ADR-083 ruling 1 and ADR-095 ruling 3 both " +
              'refuse -- the second by name, because the framework admitted there is the one ' +
              'ADR-083 named as the alternative it was foreclosing',
          );
        }
      }
    }

    // A CHECK THAT READ NO FILES IS NOT A CHECK THAT PASSED. Four deployables
    // hold source, so a walk that inspected nothing means the tree moved under
    // this check rather than that the property holds.
    if (inspected === 0)
      throw new Error(
        'RI-09 inspected 0 files across the non-owner deployables. That is a walk that found ' +
          'nothing, not a property that holds',
      );
    return findings;
  },
};

/**
 * Whether one area-relative path is code the node loader loads, which is RI-10's
 * scope stated once rather than spelled inline.
 *
 * TWO POSITIVE TERMS AND ONE SUBTRACTION, IN THAT ORDER. `src/` under apps/ or
 * packages/ is where the deployables live, by ADR-083. Everything under
 * scripts/ is the second term, by ADR-121, because scripts/demo is loaded by the
 * node loader and nightly.yml runs it. `test/` comes back off both, because
 * Vitest resolves the tolerant way and a `.js` specifier in a test is not a
 * runtime defect.
 *
 * THE SUBTRACTION IS A DIRECTORY SEGMENT AND NEVER A PACKAGE OR FILE NAME. That
 * distinction is the whole lesson of this check's first draft, which excluded a
 * package by name. See RI-10's header for why `e2e/` is not allowed to join it.
 *
 * @param {string} area
 * @param {string} rel
 * @returns {boolean}
 */
function runtimeLoaded(area, rel) {
  const segments = rel.split('/');
  if (segments.includes('test')) return false;
  if (area === 'scripts') return true;
  return segments.includes('src');
}

/**
 * A relative import must name the file it ACTUALLY IS, because the resolver that
 * runs this code does not rewrite extensions.
 *
 * THIS IS THE STRICT HALF OF `resolveRelative`, AND THE DIFFERENCE IS THE WHOLE
 * REASON THIS CHECK EXISTS. That helper deliberately maps `./x.js` onto `x.ts`,
 * because that is what `tsc` under `moduleResolution: NodeNext` and Vitest both
 * do. `node --experimental-strip-types`, which ADR-083 rules is how every
 * deployable runs, resolves a specifier to THE FILE IT NAMES and maps nothing.
 *
 * SO THE DEFECT THIS CATCHES PASSES EVERY OTHER CHECK IN THIS REPOSITORY.
 * `pnpm run typecheck`, `pnpm run lint`, `pnpm run gates` and the whole Vitest
 * suite all go green on a file the runtime cannot load, and the only symptom is
 * ERR_MODULE_NOT_FOUND at startup. It was live here until 2026-08-25: 686
 * specifiers wrote `./x.js` for files that are `x.ts`, every app died on its own
 * first relative import, and RI-07 walked the same graph and passed, because it
 * resolves the tolerant way.
 *
 * IT CATCHES THE OPPOSITE DIRECTION TOO, WHICH IS NOT HYPOTHETICAL. The blanket
 * repair of those 686 sites rewrote three specifiers that meant a REAL `.js`
 * file, `packages/eslint-plugin-merit/index.js` being genuine JavaScript. Only
 * running the suite found it. This check finds both directions statically.
 *
 * -----------------------------------------------------------------------------
 * WHY `scripts/` JOINED THE SCOPE ON 2026-08-27, AND WHY IT WAS NOT THERE FIRST
 * -----------------------------------------------------------------------------
 * ADR-121. The original scope was `src/` in apps/ and packages/, on the stated
 * reasoning that "only `src/` is loaded by the runtime". That reasoning was a
 * considered decision and not an oversight, and it was WRONG BY OMISSION rather
 * than in principle: `scripts/demo/` is loaded by the node loader too, and
 * `.github/workflows/nightly.yml` runs it as CI-09's replay self-audit leg.
 *
 * THE OMISSION COST WAS MEASURED, NOT ARGUED. On the tree this widening landed
 * against, `scripts/demo/` carried 19 broken specifiers across 5 non-test files
 * (32 across 7 once its two Vitest suites are counted), and
 * `node --experimental-strip-types scripts/demo/main.ts` died with
 * ERR_MODULE_NOT_FOUND on its own first relative import. Every gate in this
 * repository was green throughout, RI-10 included, because RI-10 was not
 * looking there.
 *
 * THE SCOPE IS STILL POSITIVE AND STRUCTURAL, WHICH IS THE PART THAT MATTERS.
 * `runtimeLoaded` names the directories the node loader loads and subtracts
 * `test/`; it does not name a package, a file or an area to skip. The earlier
 * `src/` line was itself the principled repair of a draft that excluded a
 * package BY NAME, and this widening is held to the same standard: a check that
 * needs a name-based exception is scoped wrong, and that applies to the widening
 * as much as to the original.
 *
 * THE `test/` SUBTRACTION IS THE OLD RULING AND NOT A NEW EXCEPTION. Under
 * `src/` it was structural for free, because nothing under `src/` is a test.
 * Under `scripts/` it has to be written down, because `scripts/demo/test/` is a
 * sibling of the source rather than a sibling of `src/`. The reason is
 * unchanged: Vitest resolves the tolerant way, so a `.js` specifier in a test is
 * not a runtime defect.
 *
 * `e2e/` IS THE NEAR MISS THAT DECIDED THE SHAPE. The tempting simplification is
 * to drop the `src/` clause entirely and scan every non-`test/` TypeScript file
 * in apps/, packages/ and scripts/. Measured, that finds the SAME 19 findings
 * and nothing else, so it looks free. It is not: it silently admits
 * `apps/portal/e2e/` and `apps/site/e2e/`, which are Playwright specs, which are
 * tests, which the ruling above puts out of scope. Keeping them out would cost a
 * second name in the subtraction list, and a subtraction list that grows by name
 * is the failure mode this check's own history is about. So the `src/` clause
 * stays, and `scripts/` is added beside it as a second positive term.
 *
 * @type {Invariant}
 */
const ri10 = {
  id: 'RI-10',
  title: 'Every relative import in shipped source names a file that exists',
  covers:
    'every `.ts`, `.tsx` and `.mts` file under a `src/` directory in apps/ or ' +
    'packages/, PLUS every one under scripts/, which together are the code ' +
    '`node --experimental-strip-types` loads: the deployables by ADR-083, and ' +
    "scripts/demo by nightly.yml, which runs it as CI-09's replay self-audit " +
    'leg. scripts/ joined by ADR-121, after the `src/` line missed 19 broken ' +
    'specifiers there while every gate stayed green. TEST files are ' +
    'deliberately OUT OF SCOPE and that is a ruling ' +
    'rather than an omission: Vitest resolves specifiers the tolerant way, so a ' +
    '`.js` specifier in a test is not a runtime defect, and rule-test fixtures ' +
    'carry synthetic specifiers as DATA that no regex can tell from a ' +
    'statement. Under `src/` that held for free; under scripts/ it is written ' +
    'down, because scripts/demo/test/ is a sibling of the source rather than of ' +
    '`src/`. It reads STATIC specifiers and literal `import(...)` only, from ' +
    'source with comments stripped, so a specifier BUILT AT RUNTIME is invisible ' +
    'to it. It resolves LITERALLY: no extension is added, substituted or ' +
    'dropped, which is the one thing that separates it from RI-07 and from ' +
    '`resolveRelative`. A BARE specifier is out of scope entirely, because those ' +
    'resolve through package exports and were never affected. A green result ' +
    'says the module graph LOADS, and says nothing about whether it behaves.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    for (const area of ['apps', 'packages', 'scripts']) {
      const areaRoot = join(root, area);
      if (!existsSync(areaRoot)) continue;
      for (const rel of walk(areaRoot)) {
        if (!/\.(ts|tsx|mts)$/.test(rel)) continue;
        if (!runtimeLoaded(area, rel)) continue;
        const file = join(areaRoot, rel);
        for (const spec of specifiersIn(readFileSync(file, 'utf8'))) {
          if (!spec.startsWith('.')) continue;
          const target = resolve(dirname(file), spec);
          if (existsSync(target) && statSync(target).isFile()) continue;
          const tolerant = resolveRelative(file, spec);
          const because =
            tolerant === null
              ? 'and nothing on disk answers it'
              : `but ${relative(root, tolerant)} is what is there`;
          findings.push(`${area}/${rel}: \`${spec}\` names no file, ${because}`);
        }
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-12  No tracked document repeats a whole line more than a handful of times
// -----------------------------------------------------------------------------
//
// THIS INVARIANT EXISTS BECAUSE A DEFECT RAN UNCAUGHT FOR A DAY AND WAS FOUND BY
// EYE. `docs/STATE.md` carried the same 340-character sentence FOUR THOUSAND SIX
// HUNDRED AND SEVENTY-TWO TIMES. The file was 11,601 lines and 2,479 of them were
// distinct; the other nine thousand were one line, duplicated.
//
// NOTHING SAW IT, AND THE REASON IS INSTRUCTIVE. The sentence is a generated span
// under CI-06g, so `gates.mjs generate` dutifully rewrote every copy and reported
// "every span already matches its query" -- 4,672 spans, all correct, all the same
// span. CI-06/derivable-counts read the counts and found them right. Every gate was
// green on a document that was 80% one repeated line, because every gate was asking
// whether the content was CORRECT and none was asking whether it was there ONCE.
//
// THE CAUSE WAS A MERGE RULE, WHICH IS WHY THE FIX IS A CHECK AND NOT A CLEANUP.
// STATE.md is appended to by every session, so the resolution for a conflict in it
// is "keep both sides" -- correct for two sessions appending two different sections,
// and catastrophic for a line both sides already had. Under a wave of concurrent
// branches that rule doubles the line on every merge that touches it. A cleanup
// without this check buys one clean day and then the doubling resumes.
//
// THE THRESHOLD IS A CEILING RATHER THAN A ZERO, and that is deliberate. Legitimate
// repetition exists in these documents: a `---` rule, a `|---|---|` table separator,
// a `> ` quote marker, a bare fence. Those are short structural tokens, so the check
// scopes to lines of real length and allows a small count above one. A zero would be
// a check nobody could keep green; a ceiling catches doubling, which is the failure
// mode, and stays quiet about prose that happens to rhyme.
//
// WHAT IT DOES NOT COVER, stated rather than left to be discovered: it reads only
// docs/, it reads whole lines, and two lines differing by one character are two
// lines to it. A duplicated PARAGRAPH whose lines were each reflowed would pass. It
// catches the mechanical doubling a merge produces, which is the one that happened.
//
/** @type {Invariant} */
const ri12 = {
  id: 'RI-12',
  title: 'No document under docs/ repeats a substantial line more than 8 times',
  covers:
    'every tracked `.md` under docs/, read whole-line. A line of at least 80 ' +
    'characters after trimming may appear at most 8 times in one file. Short ' +
    'lines are OUT OF SCOPE because markdown structure legitimately repeats ' +
    'them: rules, table separators, quote markers and fences. It catches the ' +
    'MECHANICAL doubling a keep-both merge produces on a line both sides ' +
    'already carried, which is how STATE.md reached 4,672 copies of one ' +
    'sentence with every gate green. It says nothing about duplicated prose ' +
    'that was reflowed, and nothing about whether the line is CORRECT: ' +
    'CI-06g already checks that, and checked it 4,672 times.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const docs = join(root, 'docs');
    if (!existsSync(docs)) return findings;
    for (const rel of walk(docs)) {
      if (!rel.endsWith('.md')) continue;
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const line of readFileSync(join(docs, rel), 'utf8').split('\n')) {
        const t = line.trim();
        if (t.length < 80) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      for (const [line, n] of counts) {
        if (n <= 8) continue;
        findings.push(`docs/${rel}: one line appears ${n} times: ${line.slice(0, 90)}...`);
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-13  An unsigned ADR says what the founder must decide
// -----------------------------------------------------------------------------
//
// THE BACKLOG IS NOT THE PROBLEM; ITS SHAPE IS. On 2026-08-27 fifty-four entries in
// docs/decisions declared their own approval line withheld. "Read fifty-four
// documents" is not an actionable ask and it had been growing all day. "Answer these
// fifty-four questions" is, and the difference is entirely in what the entries
// themselves say.
//
// THE ENTRIES ALREADY KNEW THIS. Twenty of the fifty-four carried a marked block
// reading `**What a founder read adds and this entry cannot.**` and then named the
// judgements: which reading was taken, why it is a judgement rather than a
// derivation, and what goes wrong if it is the wrong one. ADR-157 is the best of
// them and names three. THE OTHER THIRTY-FOUR CARRIED NOTHING OF THE KIND, and a
// founder arriving at one of those has to reconstruct the question from the ruling
// before they can answer it, on every entry, alone.
//
// SO THE PROPERTY IS ABOUT THE ENTRY AND NOT ABOUT THE SIGNATURE. It does not ask
// that anything be signed -- that is the founder's and no check may stand in for it.
// It asks that an entry which is WAITING on a signature state, in its own words,
// what the signature is for.
//
// WHY A MARKED BLOCK AND NOT A PHRASE LIST. The tempting implementation is a list of
// the ways an entry can gesture at a founder judgement -- "the clause a later session
// will want to reverse", "the part that needs the founder", "that judgement is the
// founder's and no grep reaches it" -- all of which are in the tree. A phrase list is
// a SECOND COPY OF A CONVENTION, it drifts the first time somebody writes a
// twenty-fourth phrasing, and it passes an entry that merely MENTIONS a founder.
// One marked block is the convention itself: the corpus had already written it in
// thirty-two entries before this check existed, so the check adopts what these
// documents do rather than inventing a rule it will then have to police.
//
// "NOTHING HERE IS A JUDGEMENT" IS A VALID ANSWER AND THE CHECK MUST ACCEPT IT.
// A pure transcription against an approved document owes the founder no decision,
// and an entry FORCED TO FABRICATE A QUESTION is worse than one that had none: it
// spends a founder read on a decision nobody has to make. So the marker is followed
// by prose and the check reads its LENGTH rather than its meaning; an entry whose
// prose says "nothing, and here is why" passes on exactly the same terms as one
// naming three judgements.
//
// THE FILE BOUNDARY, WHICH IS A REAL ONE. This file's own header says these are
// build-tooling invariants and that `scripts/corpus/` is where corpus checks live.
// RI-12 landed here the same morning reading nothing but docs/, which is the
// precedent this follows: the corpus RUNNER asserts things about corpus CONTENT
// against its own registries, and this asserts a property of a document's structure
// that needs no registry at all. It runs at CI-01 beside the checks that need
// nothing but the tree.
//
/** An `##`-to-`######` heading whose title names an approval. */
const ADR_APPROVAL_HEADING = /^#{2,6}\s+.*\bapprovals?\b/i;

/** A line that names the approval line itself, wherever in the entry it sits. */
const ADR_APPROVAL_LINE = /\b(?:approval line|founder approval|founder ruling)\b/i;

/** The status vocabulary of an approval statement that is still waiting. */
const ADR_WITHHELD = /\b(?:UNSIGNED|PENDING|NOT GIVEN)\b|_{5,}/i;

/** The status vocabulary of an approval statement that records a disposition. */
const ADR_GRANTED = /^(?:GRANTED|ACCEPTED|SIGNED|ADOPTED|REFUSED|SPLIT)\b/;

/**
 * The label a status is written after, so that `Approval line: GRANTED` and a bare
 * `SIGNED on delegated authority` are one shape. A comma is a separator as well as a
 * colon, because the headings write it that way: `### 5. The approval line, UNSIGNED`.
 */
const ADR_STATUS_LABEL =
  /^(?:the\s+)?(?:founder\s+)?(?:approval(?:\s+line)?|ruling)\b[^:,\n]{0,40}[:,]\s*/i;

/**
 * A line with its markdown furniture and its approval label removed, so a status can
 * be read off the FRONT of what is left.
 *
 * A DISPOSITION IS READ ONLY HERE, AND THAT ASYMMETRY IS THE POINT. ADR-119 has
 * `**REFUSED**` in a table cell about an empty world and ADR-137 cites a
 * recommendation another entry `GRANTED`; both are unsigned, and reading either
 * mention as a signature drops the entry out of scope SILENTLY, which is this file's
 * first rule broken in the direction nobody notices. A withholding token is read
 * anywhere in the approval statement instead: a false read there puts an entry INTO
 * scope, where it is a finding somebody has to argue with rather than a silence.
 *
 * @param {string} line
 * @returns {string}
 */
function adrStatusText(line) {
  const bare = line
    .replace(/^\s*(?:#{1,6}\s+)?/, '')
    .replace(/^\s*(?:[-*+]\s+)?/, '')
    .replace(/^\s*(?:\d+[.)]\s+)?/, '')
    .replace(/\*\*|__|\*|`/g, '')
    .trim();
  return bare.replace(ADR_STATUS_LABEL, '').trim();
}

/** How much prose the marked block must carry before it is an answer rather than a label. */
const FOUNDER_QUESTION_FLOOR = 120;

/**
 * The lines of an ADR that state its approval status.
 *
 * TWO POSITIONS, because the corpus writes the status in two places and neither is
 * going away: inline on a line that names the approval line, and as the first line
 * of prose under a section heading that names the approval. A blockquote or table
 * row is excluded -- both quote OTHER entries' approval lines, and ADR-135 quotes a
 * migration's header comment about one.
 *
 * @param {string[]} lines
 * @returns {{ n: number, text: string }[]}
 */
function adrApprovalStatements(lines) {
  /** @type {{ n: number, text: string }[]} */
  const out = [];
  const plain = (/** @type {string} */ l) => l.replace(/\*\*|__|\*|`/g, '');
  // A FENCE IS NOT A HEADING, and getting that wrong read ADR-111 as unsigned:
  // its approval section runs a shell block whose comments start with `#`, the
  // section looked like it ended at the first of them, and the grant three lines
  // further down was never seen. The check would have failed a SIGNED entry.
  const fenced = lines.map(() => false);
  let open = false;
  for (const [i, line] of lines.entries()) {
    if (/^\s*```/.test(line)) open = !open;
    fenced[i] = open;
  }
  for (const [i, line] of lines.entries()) {
    if (fenced[i]) continue;
    if (ADR_APPROVAL_HEADING.test(line)) {
      out.push({ n: i + 1, text: plain(line) });
      for (const [j, below] of lines.entries()) {
        if (j <= i) continue;
        if (!fenced[j] && /^#{1,6}\s/.test(below)) break;
        if (below.trim() === '') continue;
        out.push({ n: j + 1, text: plain(below) });
      }
      continue;
    }
    if (/^\s*[>|]/.test(line)) continue;
    if (ADR_APPROVAL_LINE.test(line)) out.push({ n: i + 1, text: plain(line) });
  }
  return out;
}

/**
 * The index of the marked block, or -1. A bolded lead-in and a section heading are
 * both accepted because the corpus writes it both ways: 31 entries bold it, ADR-164
 * makes it a section of its own, and the two say the same thing.
 *
 * @param {string[]} lines
 * @returns {number}
 */
function founderQuestionAt(lines) {
  for (const [i, line] of lines.entries()) {
    const t = line
      .replace(/^\s*[#>\-*+\d.)\s]*/, '')
      .replace(/^\*+/, '')
      .trim();
    if (/^what a founder read adds/i.test(t)) return i;
  }
  return -1;
}

/**
 * The prose the marked block carries, counted from the end of its own sentence to
 * the next heading or rule. It is a LENGTH and never a meaning: this check catches
 * an entry that is silent, not one that answers badly.
 *
 * @param {string[]} lines
 * @param {number} at
 * @returns {number}
 */
function founderQuestionProse(lines, at) {
  const head = (lines[at] ?? '').replace(/^\s*[#>\-*+\d.)\s]*/, '');
  let body = head.replace(/^[^.!?\n]*[.!?]?/, '');
  for (const line of lines.slice(at + 1, at + 25)) {
    if (/^#{1,6}\s/.test(line) || /^---\s*$/.test(line)) break;
    body += ` ${line}`;
  }
  return body.replace(/\*\*|__|\*|`|\s+/g, ' ').trim().length;
}

// -----------------------------------------------------------------------------
// RI-14  A reason that claims something does not exist is right, or says it was wrong
// -----------------------------------------------------------------------------
//
// THIS IS THE ONE ERROR CLASS THAT HAS NOW COST THIS PROJECT MORE THAN ANY OTHER,
// AND IT IS THE ONE THE CONSTITUTION NAMES BY NAME: "Each was a failure to check a
// claim against the primary source. Escalating the model does not fix that class of
// error; reading the source and adding a mechanical assertion does. Prefer a new CI
// gate over a bigger model whenever the error is checkable."
//
// WHAT HAPPENED, THREE TIMES, IN ONE FILE. apps/api/test/wiring.test.ts records why
// each unwired backend port is unwired. On 2026-08-28 its `useWithdrawalBackend`
// entry read "an `IdempotencyStore` implementation, which no file in this tree
// provides", while its `usePayoutBackend` entry, A HUNDRED LINES ABOVE, read
// "`databaseIdempotencyStore` already exists and satisfies the `idempotency` member
// alone". Both were in the file at once and every gate was green, because NOTHING
// READS A REASON AGAINST THE TREE IT DESCRIBES. `apps/api/src/idempotency-store.ts`
// had exported that store since ADR-112.
//
// The claim was a stale header restated four times: idempotency.ts's own header said
// it, a session's adapter comment repeated it without opening the file beside it, a
// BLOCKED entry cited the header AND that comment as two sources, and ALLOCATION
// row 172 then reserved an ADR REQUIRED, MONEY PATH against it. Four restatements
// and no reader between them opened the file. After two pull requests corrected it,
// a THIRD copy was still alive in the same file, in the comment on `accountedByPort`.
//
// WHY THE CHECK IS NARROW, AND WHY THAT IS THE POINT. It reads ONE shape: a claim
// that a NAMED thing does not exist. Not "is blocked", not "has no driver", not "no
// SystemReason names a request handler" -- those are claims about behaviour and
// about vocabularies, they are argued rather than looked up, and a check that
// pretended to read them would be a check somebody switches off. A non-existence
// claim about a named export is the one thing here a runner can settle outright, and
// it is exactly the one that went wrong.
//
// A REFUTED CLAIM MAY STAY, AND MUST SAY SO. The corrected file deliberately QUOTES
// the false sentence rather than deleting it, "because a false sentence deleted
// leaves nothing for the next reader to check". That is right and this check must
// not punish it. So a non-existence claim about a thing that DOES exist passes when
// the comment block carrying it marks the claim as refuted -- `It read:`, `WAS
// FALSE`, `IS FALSE`, `REFUTED`, `STALE`, or a strikethrough. The requirement is not
// that the file be silent about its own history; it is that the file never states a
// refuted claim AS IF IT WERE CURRENT.
//
// WHAT IT DOES NOT CATCH, stated rather than left to be discovered. (1) It reads
// EXPORTS and never behaviour, so a reason saying a thing exists but cannot be
// CONSTRUCTED is out of scope -- that is ADR-172's finding 1, which was true, and a
// check that failed it would be wrong. (2) It reads only files a session is likely
// to make this mistake in, listed in SOURCED_CLAIM_FILES, rather than the whole
// tree: the property is about REASONS somebody wrote down, and a survey of all prose
// would drown the finding. (3) It cannot tell a type from its implementation, so
// "no implementation of `Foo` exists" where `Foo` is an exported TYPE is flagged and
// must be either fixed or marked. That direction is deliberate: a false positive is
// an argument somebody has, and a false negative is this defect a fifth time.
const SOURCED_CLAIM_FILES = [
  'apps/api/test/wiring.test.ts',
  // THE OTHER TWO SITES THE CHAIN ACTUALLY RAN THROUGH, added once both were
  // corrected. `idempotency.ts`'s header is where the claim ORIGINATED and
  // `wallet-withdrawals.ts`'s adapter comment is where a session repeated it
  // without opening the file beside it. Both now mark their own history, and
  // listing them is what keeps a later edit from quietly restoring the claim.
  'apps/api/src/idempotency.ts',
  'apps/api/src/routes/wallet-withdrawals.ts',
];

// THE SHAPES THAT ASSERT A NAMED THING IS ABSENT. Deliberately few, and
// CASE-INSENSITIVE, which is not a detail here.
//
// The first draft of this check was case-sensitive and a seeded claim reading
// "No implementation of `IdempotencyStore` exists in this tree" walked straight
// past it. THIS CODEBASE SHOUTS IN ITS COMMENTS AS A HOUSE STYLE -- the very
// sentence this check exists for is written "THE HEADER IS STALE AND THE FILE
// BESIDE IT SAYS OTHERWISE" -- so a case-sensitive matcher is one that reads the
// quiet half of the corpus and skips the emphatic half, which is the half where
// somebody states a claim they are sure of.
const ABSENCE_CLAIMS = [
  /no implementation of `([A-Za-z_][\w]*)`/gi,
  /`([A-Za-z_][\w]*)`[^.`]{0,40}\bdoes not exist\b/gi,
  /no `([A-Za-z_][\w]*)`[^.`]{0,30}\bexists\b/gi,
  /`([A-Za-z_][\w]*)`[^.`]{0,60}\bwhich no file in this tree provides\b/gi,
];

/** A block that marks its own claim as history rather than stating it. */
const REFUTED =
  /it read\b|was false|is false|refuted|\bstale\b|~~|no longer true|was true when|correction rather than/i;

/** Where an export would live if the claim were wrong. */
const EXPORT_ROOTS = ['apps', 'packages'];

/**
 * Every identifier exported from shipped source, as one set.
 * @param {string} root
 * @returns {Set<string>}
 */
function exportedNames(root) {
  /** @type {Set<string>} */
  const names = new Set();
  /** @param {string} dir */
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'test') continue;
        walk(p);
        continue;
      }
      if (!/\.ts$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
      const src = readFileSync(p, 'utf8');
      const re =
        /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|function|class|type|interface|enum|let|var)\s+([A-Za-z_][\w]*)/gm;
      for (const m of src.matchAll(re)) {
        const name = m[1];
        if (name !== undefined) names.add(name);
      }
    }
  };
  for (const r of EXPORT_ROOTS) walk(join(root, r));
  return names;
}

/**
 * The comment block or entry a line sits in: back to a blank-ish boundary and forward.
 * @param {readonly string[]} lines
 * @param {number} i
 * @returns {string}
 */
function blockAround(lines, i) {
  let a = i;
  while (a > 0 && (lines[a - 1] ?? '').trim() !== '' && !/^\s*\/\/ -{10,}/.test(lines[a - 1] ?? ''))
    a -= 1;
  let b = i;
  while (b < lines.length - 1 && (lines[b + 1] ?? '').trim() !== '') b += 1;
  return lines.slice(a, b + 1).join('\n');
}

/** @type {Invariant} */
const ri14 = {
  id: 'RI-14',
  title: 'No reason claims a named thing does not exist while the tree exports it',
  covers:
    'the reason text in ' +
    SOURCED_CLAIM_FILES.join(', ') +
    '. A claim is in scope when it asserts that a BACKTICKED, NAMED thing is ' +
    'absent: `no implementation of X`, `X does not exist`, `no X exists`, or ' +
    '`X, which no file in this tree provides`. Such a claim FAILS when an ' +
    '`export` of that name is present anywhere under apps/ or packages/, ' +
    'excluding test directories, UNLESS the block carrying it marks the claim as ' +
    'history rather than stating it -- `It read:`, `WAS FALSE`, `IS FALSE`, ' +
    '`REFUTED`, `STALE`, a strikethrough, or `was true when`. A REFUTED CLAIM MAY ' +
    'STAY AND MUST SAY SO: the corrected file deliberately quotes the false ' +
    'sentence, because a false sentence deleted leaves nothing for the next ' +
    'reader to check, and this check must not punish that. WHAT IT DOES NOT ' +
    'CATCH. (1) It reads EXPORTS and never behaviour, so a reason saying a thing ' +
    'exists and cannot be CONSTRUCTED is out of scope -- that is ADR-172 finding ' +
    '1, which was TRUE, and a check that failed it would be wrong. (2) It reads ' +
    'only the listed files rather than all prose, because the property is about ' +
    'reasons somebody wrote down and a survey of the tree would drown the ' +
    'finding. (3) It cannot tell a type from its implementation, so a claim about ' +
    'an exported TYPE is flagged and must be fixed or marked. That direction is ' +
    'deliberate: a false positive is an argument somebody has, and a false ' +
    'negative is this defect a fifth time.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const exported = exportedNames(root);
    for (const rel of SOURCED_CLAIM_FILES) {
      const abs = join(root, rel);
      if (!existsSync(abs)) {
        findings.push(
          `${rel} does not exist. This check names the files whose REASONS it reads, ` +
            `so a rename silently empties it; point it at the new path`,
        );
        continue;
      }
      const lines = readFileSync(abs, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const pattern of ABSENCE_CLAIMS) {
          pattern.lastIndex = 0;
          for (const m of (lines[i] ?? '').matchAll(pattern)) {
            const name = m[1];
            if (name === undefined || !exported.has(name)) continue;
            if (REFUTED.test(blockAround(lines, i))) continue;
            findings.push(
              `${rel}:${i + 1}: the reason claims \`${name}\` does not exist and the tree ` +
                `EXPORTS it. Nothing else reads a reason against the tree it describes, ` +
                `which is how one such claim survived four restatements and reached an ` +
                `allocated money-path ADR. Open the file: either the claim is wrong and the ` +
                `reason is rewritten with the surviving one, or it was true when written ` +
                `and the block says so`,
            );
          }
        }
      }
    }
    return findings;
  },
};

/** @type {Invariant} */
const ri13 = {
  id: 'RI-13',
  title: 'Every ADR whose approval line is unsigned states what the founder must decide',
  covers:
    'every `ADR-*.md` under docs/decisions. AN ENTRY IS IN SCOPE WHEN ITS ' +
    'APPROVAL STATEMENT IS WITHHELD: a line naming the approval line, founder ' +
    'approval or founder ruling, or any line inside a section whose heading ' +
    'names an approval, carrying UNSIGNED, PENDING, NOT GIVEN or a blank ' +
    'signature rule, and carrying no DISPOSITION. A disposition -- GRANTED, ' +
    'ACCEPTED, SIGNED, ADOPTED, REFUSED, SPLIT -- is read only where a signature ' +
    'is written: at the FRONT of a line, after its markdown furniture and an ' +
    'optional `Approval line:`, `Founder approval:` or `The approval line,` ' +
    'label. A withholding token is read anywhere in the approval statement ' +
    'instead, and THE ASYMMETRY IS DELIBERATE: a disposition misread out of prose ' +
    "about somebody ELSE'S grant drops an entry out of scope silently, which is " +
    "this file's first rule broken where nobody sees it, while a withholding " +
    'token misread only puts an entry INTO scope, where it is a finding somebody ' +
    'can argue with. Such an entry must carry the marked block `What a founder ' +
    'read adds` -- bolded or as a heading, the form the corpus was already using ' +
    'before this check existed -- followed by at least ' +
    `${FOUNDER_QUESTION_FLOOR} characters of prose. ` +
    'WHAT IT DOES NOT CATCH, stated rather than left to be discovered. (1) It ' +
    "reads the block's LENGTH and never its meaning, so it catches SILENCE and " +
    'not a bad answer, and "nothing here is a judgement, and here is why" passes ' +
    'on the same terms as three named judgements -- deliberately, because an ' +
    'entry forced to fabricate a question is worse than one that had none. (2) It ' +
    'does not read whether a SIGNATURE is owed or given, and it never asks for ' +
    "one: that is the founder's alone. (3) An entry whose approval status this " +
    'check cannot read AT ALL is OUT OF SCOPE rather than a finding, and every ' +
    'pre-FREEZE ruling that records no approval statement is in that position. ' +
    'THAT IS A SECOND DEFECT AND A DIFFERENT INVARIANT; this one never fails an ' +
    'entry whose status it could not read, because guessing in that direction ' +
    'would fail a shelf of documents for a convention that did not exist when ' +
    'they were written.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const dir = join(root, 'docs/decisions');
    if (!existsSync(dir)) return findings;
    const entries = readdirSync(dir)
      .filter((f) => /^ADR-.*\.md$/.test(f))
      .sort();
    for (const file of entries) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      const statements = adrApprovalStatements(lines);
      if (statements.some((s) => ADR_GRANTED.test(adrStatusText(s.text)))) continue;
      const withheld = statements.filter((s) => ADR_WITHHELD.test(s.text)).pop();
      if (!withheld) continue;
      const at = founderQuestionAt(lines);
      if (at >= 0 && founderQuestionProse(lines, at) >= FOUNDER_QUESTION_FLOOR) continue;
      const why =
        at < 0
          ? 'carries no `What a founder read adds` block'
          : `states the block at :${at + 1} and then says nothing: ` +
            `${founderQuestionProse(lines, at)} characters, ${FOUNDER_QUESTION_FLOOR} required`;
      findings.push(
        `docs/decisions/${file}: approval withheld at :${withheld.n} and the entry ${why}. ` +
          'An unsigned entry states what the founder must decide, or states that nothing here is a judgement and why.',
      );
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-15  A `file:line` citation resolves, and the line says the name beside it
// -----------------------------------------------------------------------------
//
// THIS IS THE SIXTH APPEARANCE OF ONE ERROR CLASS AND IT IS THE HALF RI-14 CANNOT
// READ. RI-14 settles whether a claim that a NAMED THING DOES NOT EXIST is right,
// by asking the tree what it exports. It reads EXISTENCE. It does not read
// LOCATION, and location is what went wrong next.
//
// WHAT HAPPENED, IN THE SAME FILE RI-14 WAS WRITTEN FOR. Session 316 checked the
// pointers in `apps/api/test/wiring.test.ts` one by one against the files they
// name and FOUR OF THEM POINTED AT THE WRONG LINE. Two were EIGHTEEN LINES OFF
// and both sat inside the entry ADR-172 had written ONE SESSION EARLIER to
// replace a false reason: `wallet-withdrawals.ts:1233` was `G-WITHDRAWAL-CLEARED`'s
// KYC term while `gateNoInFlight` was at `:1254`, and `:1506` was a `.send({`
// while the identity arm was at `:1527`. The other two were `admin-payouts.ts:381`
// for a declaration at `:390` and `admin-writes.ts:266` for one at `:269`.
//
// THE CLAIMS HELD AT THEIR REAL LINES AND THE POINTERS DID NOT, which is this
// defect in its quietest form. A citation that drifts is WORSE THAN NO CITATION:
// it reads as verified, so the next reader follows it, finds unrelated prose, and
// concludes the reason was invented. That is how a stale claim survived four
// restatements in one week, and the session that found the four said so: "the
// gate that would have caught all four -- resolve every `file:line` inside a
// reason string -- is still not written".
//
// THE HARD HALF IS DECIDING WHETHER THE LINE SAYS WHAT THE CITING SENTENCE
// CLAIMS, AND THIS CHECK DOES NOT TRY TO READ MEANING. It uses a mechanical
// proxy, and the proxy is the shape these citations are actually written in: a
// backticked name, then the pointer, `principal(request)` (`admin-writes.ts:269`).
// When a citation is preceded by a backticked identifier with nothing but glue
// between them, that identifier must appear WITHIN `CITATION_WINDOW` LINES of the
// line cited. Nothing else is inferred, and a citation with no name beside it is
// checked for resolution and range only.
//
// THE WINDOW IS TUNED AGAINST THE REAL CORPUS AND IT IS TWO. Measured over every
// citation in the files below: the widest TRUE citation is one line off
// (`firm` cited at `scope.ts:535`, where the word is on `:536` because `:535`
// opens the entry), and the narrowest FALSE one on record is three
// (`admin-writes.ts:266` for a declaration at `:269`). Two is the largest window
// that still catches every false citation on record and the smallest that admits
// every true one measured. A drift of one or two lines passes, and that is the
// price stated rather than discovered.
//
// WHY LIVE REASON FILES AND NOT `docs/decisions`. The obvious second input is the
// ADRs, and it is the wrong one twice over. AN ADR IS A DATED RECORD OF THE TREE
// AS IT WAS: its citations were true at its date, they go stale BY DESIGN when
// the tree moves, and repairing one is an amendment requiring an ADR rather than
// a commit. ADR-172's `routes/payouts.ts:395` for `PayoutTx.ledger` is 324 lines
// out today because ADR-176 DELETED that member, which is the entry being right
// rather than wrong.
//
// AND THE TWO FINDINGS IT ACTUALLY MAKES THERE ARE BOTH THIS CHECK MISREADING A
// DOCUMENT WRITTEN FOR A READER. Run over `ADR-170` through `ADR-176` it reports
// exactly two. `ADR-172:29` cites `wallet-withdrawals.ts:840-863` for
// `WithdrawalTx`, a RANGE naming the members while the declaring line sits ABOVE
// it -- :831 the day the entry was written and :835 now. `ADR-176:32` writes the
// bare `` `:331` `` whose path is two markdown table rows up, and a bare pointer
// here inherits the nearest full path within six lines, which lands on
// `start.ts` and reports a file of 109 lines. Neither is an ADR that drifted.
//
// So the list below is the files whose citations describe the tree AS IT IS NOW,
// which is RI-14's scope for RI-14's reason: the property is about REASONS
// somebody wrote down. Growing the list is the intended growth path.
//
// WHAT IT DOES NOT CATCH, stated rather than left to be discovered.
// (1) A citation with NO backticked identifier beside it is checked for
//     resolution and range only. That is a real hole and it is measured: of the
//     four false citations of 2026-08-28 this check catches THREE, and misses
//     `routes/wallet-withdrawals.ts:1506`, which sits behind the words "the
//     identity arm this route presents" and names nothing a runner can look up.
// (2) The name is matched as a CASE-INSENSITIVE SUBSTRING of a line in the
//     window, so a line that merely mentions the name in a comment satisfies it.
//     Case-insensitive is not a detail: RI-14's first draft was case-sensitive
//     and a SHOUTED claim walked past it, and this codebase shouts as a house
//     style.
// (3) A NEGATED claim is skipped -- "`fills` HAS NO `identity_id`
//     (`schema.ts:3005`)" cites the line where the table is DECLARED and the
//     name must be absent from it. Asserting the inverse there is a second
//     check, and the existence half of it is RI-14's already.
// (4) It binds only the NEAREST backticked token, so a possessive reads as a
//     subject and is dropped rather than guessed: "`realized_pnl_cents` is
//     `daily_marks`' (`schema.ts:652`)" cites the column and names the table.
// (5) A RANGE citation names a BODY, and the declaring line can sit above the
//     range, further than the window: `ADR-172:29` measures at five. A range is
//     therefore the shape most likely to be a false positive here, and it is
//     left noisy on purpose rather than given a second, wider window.
// (6) A bare `` `:12` `` inherits the nearest full path within
//     `CITATION_INHERIT_LINES` lines, which is how a reader reads it and is
//     wrong wherever a nearer path was cited for something else -- across the
//     rows of a markdown table, measured at `ADR-176:32`.
// (7) It reads the tree it is given and never git history, so it cannot say
//     whether a citation DRIFTED or was FALSE THE DAY IT WAS WRITTEN. Both of
//     the citations it found in `routes/payouts.ts` on its first run were the
//     second kind, checked by hand at the commit that wrote them.
//
// A FALSE POSITIVE HERE IS AN ARGUMENT SOMEBODY HAS AND A FALSE NEGATIVE IS THIS
// DEFECT A SEVENTH TIME, so where the two are in tension this check takes the
// noisier side and the narrowings above are each stated with their reason.
//
// -----------------------------------------------------------------------------
// WHAT A CITATION PROVES, AND WHY A NAME IN A WINDOW WAS NOT IT (ADR-212)
// -----------------------------------------------------------------------------
// EVERYTHING ABOVE THIS LINE WAS TRUE AND THE CHECK WAS STILL GREEN ON CITATIONS
// THAT POINT AT THE WRONG RULE. Session 399 found five of them in
// `packages/db/src/scope.ts` and could not repair them, because repairing them
// needed a ruling about what this check should verify. That ruling is ADR-212
// and it is the three assertions below.
//
// THE MECHANISM, RE-DERIVED AT SOURCE RATHER THAN INHERITED. `scope.ts` is a
// registry of 112 entries, each `key: { class: 'firm' | 'owned' | ..., ... }`,
// so `firm`, `owned` and `identity_id` are among the commonest tokens in the
// file: 107, 72 and 109 lines hold one. The reader binds the NEAREST backticked
// token, and in "`payoutRequests` is `owned` (`scope.ts:1056`)" the nearest
// token is `owned`. A window of two lines around ANY of the 41 `class: 'owned'`
// lines satisfies it. The citation proves the file contains a common word near that
// spot, and the subject -- `payoutRequests`, the one token in that sentence a
// runner could actually check -- is the one the reader drops.
//
// AND THE WINDOW WAS NOT THE THING KEEPING THE SURVIVING FIVE GREEN, which is
// the finding that changed the ruling. Every count below was measured on
// `origin/main` at `37d70b3`, BEFORE a line of this branch's repairs: narrowing the window from 2 to 0 moves NO site at all --
// of the named citations that resolve, every one whose name is within two lines
// has it on the cited line ITSELF -- and it catches NONE of the five. Two of
// the five were never READ (`scope.ts:644,649`, the comma list); two bind NO
// NAME, so only resolution and range were ever asserted about them; one binds a
// name and is caught. A rule about how far a name may sit was answering a
// question none of them turned on.
//
// SO THREE THINGS ARE ADDED, EACH FOR ONE OF THE THREE WAYS A CITATION GOT PAST.
//
//   (1) THE COMMA LIST IS READ. `x.ts:644,649` is two citations, one per number.
//       It was zero.
//   (2) THE CITED LINE MUST CARRY SOMETHING. A pointer landing on a blank line
//       or a bare `},` proves nothing, and it is the shape a pointer takes when
//       what it named moved down. Asserted over EVERY citation, named or not,
//       because it needs no name. It cost 6 of 225 citations on `37d70b3` and
//       every one of the six was a defect.
//   (3) THE ANCHOR. Where a name binds and the window admits it, the cited line
//       must also be PART OF SOMETHING THE SENTENCE NAMES: the range declares
//       the name, or the enclosing declaration of the cited line is named among
//       the backticked tokens beside the citation. `class: 'owned'` inside the
//       `payoutRequests` entry is anchored by a sentence that says
//       `payoutRequests`; the same line cited by a sentence about a different
//       table is not.
//
// WHAT WAS REFUSED, WITH THE COST OF EACH DERIVED BY RUNNING IT RATHER THAN
// ESTIMATED. Requiring the CITED LINE ITSELF to declare the name turns 26 of 52
// named citations red and 18 of those are honest -- a citation to
// `class: 'firm'` proves a class and declares nothing. Requiring the anchor of
// EVERY citation, named or not, turns 116 of 225 red, most of them pointers
// into prose that declares nothing a reader can name. Both are stronger and
// neither is better: a rule that turns a hundred honest citations red is a rule
// somebody deletes, and this file has said so about a list since RI-05.
//
// TWO MORE MISSES, ADDED TO THE EIGHT ABOVE.
// (9)  The anchor is asked only where a NAME BINDS, so a citation with no name
//      beside it is still checked for resolution, range and vacancy alone. That
//      is 173 of the 225 citations here.
// (10) The vacant-line rule fires only when EVERY file a suffix path could name
//      has a vacant line there, on `nearestName`'s own rule that a suffix path
//      is answered by all of them. `provisioning/payload.ts:217` cites
//      `ports.ts:98`, blank in the `ports.ts` it means and not in the other ten,
//      and this check does not raise it.
//
// RI-16 READS THE SAME GRAMMAR AND DOES NOT YET APPLY (2) OR (3), and the
// reason is a measurement rather than an oversight: over docs/ they raise 46
// findings where 2 stand today, 40-odd of them the vacant-line rule inside
// documents whose frontmatter reads `status: approved`, where a change is an
// ADR rather than a commit. Extending it is a slice, not a line.

/** The extensions a reason is written in. */
const CITED_REASON_EXTENSIONS = /\.(?:ts|tsx|mts|mjs|js)$/;

/**
 * The package this check is declared in, WALKED UP TO rather than written down.
 *
 * A rename of this package moves the exclusion with it, which is the whole
 * reason it is found rather than spelled.
 */
const OWN_PACKAGE = (() => {
  let dir = HERE;
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir)
      throw new Error(
        'repo-invariants.mjs sits under no package.json, so RI-15 cannot find the package it ' +
          'must not read as a reason. That is a moved file rather than a clean tree',
      );
    dir = up;
  }
  return `${relative(REPO_ROOT, dir)}/`;
})();

/**
 * THE FILES WHOSE `file:line` CITATIONS DESCRIBE THE TREE AS IT IS NOW, DERIVED
 * FROM THE WALK RATHER THAN NAMED.
 *
 * THIS WAS SIX FILES WRITTEN BY HAND AND THAT IS THE DEFECT RI-05's OWN `covers`
 * NAMES: "a hand-maintained count in a different costume, and it drifts the same
 * way". It drifted exactly that way. Session 351 found
 * `apps/api/src/routes/verify.ts` carrying the SAME two drifted pointers as the
 * copies this check flagged, in a file the list did not name, and repointed them
 * by hand while every gate stayed green. A check whose input is a list is a
 * check whose coverage is somebody's memory.
 *
 * SO THE SET IS THE WALK, AND THE ONE EXCLUSION IS BY SHAPE AND IS MEASURED.
 * This check's own package is skipped, because its `file:line` tokens are the
 * grammar's WORKED EXAMPLES and its suite's SEEDS rather than claims about this
 * tree -- ``[`:874`](../a/path.ts)`` in a header, ``store.ts:99999`` in a case.
 * That is RI-16's exclusion 2, which masks a fenced block for the same reason,
 * arriving in source. Derived at the commit that widened it: 594 source files
 * carry 358 citations, 78 findings fall inside this package and ALL 78 are in
 * the two files whose subject IS this grammar, and the other four source files
 * here carry no finding at all. The exclusion is therefore exact today and
 * stated rather than tuned.
 *
 * WHAT IT NEWLY REFUSES, DERIVED AT THE SAME COMMIT: 588 files where there were
 * 6, 207 citations where there were 94, and EIGHT findings where there was one.
 * Every one is registered below with its owner.
 *
 * @param {readonly string[]} tree
 * @returns {string[]}
 */
function citedReasonFiles(tree) {
  return tree.filter((f) => CITED_REASON_EXTENSIONS.test(f) && !f.startsWith(OWN_PACKAGE));
}

/**
 * THE ONE FINDING THIS CHECK MADE ON ITS FIRST RUN THAT THE SESSION WRITING IT
 * COULD NOT REPAIR, enumerated here rather than dropped and rather than answered
 * with a wider window.
 *
 * THE ENTRY THIS REGISTER WAS OPENED FOR IS DISCHARGED AND GONE, WHICH IS THE
 * MECHANISM WORKING. `wiring.test.ts` cited `routes/admin-wallet.ts:538` for
 * `principal(request)` while `principal(request)` was declared at `:601`. It was
 * true the day it was written -- commit `563ac3d` wrote it against a tree where
 * `principal` WAS on :538, and `224fe5b` then inserted 63 lines above it -- and
 * it stayed live on `main` through the sessions that found it and did not own
 * the file. ADR-214's session owned it, repointed the citation, and the register
 * entry went with the repair rather than outliving it.
 *
 * THE REGISTER SHRINKS ONLY, and this is the first entry to leave by being
 * fixed. Dropping `wiring.test.ts` from the list to get green would have blinded
 * the check to the one file it exists for; widening the window to 63 lines would
 * have blinded it everywhere. Naming the single citation kept both, and cost one
 * line to retire.
 *
 * THE ENTRY IS EXACT AND IT EXPIRES BY ITSELF: file, cited pointer and name all
 * three must match, so it covers this citation and no other, and the day the
 * pointer is corrected it matches nothing and the check stays green. It is then
 * a dead constant for a later session to delete, which is the smaller of the two
 * costs; the other is a red build on somebody else's branch on the day they fix
 * the thing this asked them to fix. THE REGISTER NOW SHRINKS ONLY, on RI-16's
 * rule and CI-06u's: an entry that names nothing on this ref is itself a
 * finding, which is the difference between a register and an exemption list.
 *
 * SEVEN ARRIVED THE DAY THE INPUT SET STOPPED BEING SIX FILES SOMEBODY TYPED,
 * AND THAT IS THE POINT OF DERIVING IT. Not one of the seven is in a file this
 * check's fence holds, and each names the repair it is waiting for.
 *
 *   FOUR ARE A POINTER THAT NO LONGER LANDS ON WHAT IT NAMES, and the repair is
 *   to repoint it:
 *     `apps/admin/src/index.ts:253`     `IMPLEMENTED_ADMIN_READS` is at :193 and
 *                                      the pointer says :178. FIFTEEN lines, and
 *                                      it was hidden until `citationTargets`
 *                                      learned to follow a `../..` path
 *     `routes/webhooks-psp.ts:66`      `firmTx.update` at `scoped-db.ts:720`,
 *                                      which is a docblock line about a null
 *                                      bound. The nearest `update` is 177 away
 *     `test/db.test.ts:66`             `atMost` mints a `FilterTerm` at
 *                                      `scoped-db.ts:662`, and `atMost` is at
 *                                      :722 with `FilterTerm` at :687
 *     `admin-source/flags.ts:48`       three flag types against three pointers,
 *                                      ``(`detectors/fills.ts:505`, `:810`,
 *                                      `:1059`)``. THE CITATION IS TRUE --
 *                                      `martingale` IS at :1059 -- and the
 *                                      reader binds the nearest name to the
 *                                      FIRST pointer, which is miss (8). The
 *                                      repair is to write each name beside its
 *                                      own pointer
 *
 *   THREE ARE THE NAME BESIDE A TRUE POINTER BEING THE WRONG NOUN, and the
 *   repair is one word in the sentence rather than a new line number:
 *     `routes/admin-feed.ts:137`       and its suite copy at
 *     `test/admin-feed.test.ts:59`     ``resolves `currentReadSource()` BEFORE
 *                                      it calls `spec.handle`
 *                                      (`admin-reads.ts:856`)``. :856 IS
 *                                      `currentReadSource()`; `handle` is the
 *                                      nearest token and sits 3 lines up
 *     `test/admin-payouts.test.ts:814` ``read off `entriesOf` at
 *                                      `posting.ts:235``` quotes the two lines
 *                                      at :235-236 and `entriesOf` declares at
 *                                      :232. Miss (5), a body whose declaration
 *                                      sits above the range
 *
 * BOTH KINDS ARE REGISTERED AND NEITHER IS EXCUSED. A sentence whose pointer
 * drifted and a sentence whose pointer is right beside the wrong noun mislead
 * the same reader in the same way, and each is one line for whoever owns the
 * file. Widening the window from two to three would silence three of these and
 * would blind the check to the narrowest FALSE citation on record, which is
 * also three; that trade is refused here and stated rather than taken quietly.
 *
 * @type {readonly {file: string, cites: string, name: string | null}[]}
 */
const CITATIONS_OWNED_ELSEWHERE = [
  {
    file: 'apps/admin/src/index.ts',
    cites: '../../api/src/admin-source/index.ts:178',
    name: 'IMPLEMENTED_ADMIN_READS',
  },
  {
    file: 'apps/api/src/admin-source/flags.ts',
    cites: 'detectors/fills.ts:505',
    name: 'martingale',
  },
  { file: 'apps/api/src/routes/admin-feed.ts', cites: 'admin-reads.ts:856', name: 'handle' },
  { file: 'apps/api/src/routes/webhooks-psp.ts', cites: 'scoped-db.ts:720', name: 'update' },
  { file: 'apps/api/test/admin-feed.test.ts', cites: 'admin-reads.ts:856', name: 'handle' },
  {
    file: 'apps/api/test/admin-payouts.test.ts',
    cites: 'packages/ledger/src/posting.ts:235',
    name: 'entriesOf',
  },
  { file: 'apps/api/test/db.test.ts', cites: 'scoped-db.ts:662', name: 'FilterTerm' },
  // THREE ARRIVED WITH THE ANCHOR AND THE VACANT-LINE RULE, all three in
  // `apps/worker/**`, which session 400 holds. Each was measured at the commit
  // that registered it and each names the line the claim is actually on. A
  // `name` of null is a citation the reader binds no name to, which is what the
  // vacant-line rule asserts about and why the register now carries the field.
  //
  //   `detectors/identity.ts:1609`   quotes "flags attach to HUMANS, not to
  //                                  accounts" at `0008_risk.sql:107`, which is
  //                                  BLANK. The sentence is at `:111`
  //   `provisioning/payload.ts:21`   `scope.ts:995` is `},`, the close of the
  //                                  `kycFunnelEvents` entry. The `payload
  //                                  jsonb` sentence it quotes is at `:1319`,
  //                                  inside `provisioningQueue`
  //
  // A THIRD IS MEASURED AND DELIBERATELY NOT REGISTERED, because this check does
  // NOT raise it and a register entry that raises nothing is itself a finding.
  // `provisioning/payload.ts:217` cites `ports.ts:98` for "THE BATCH THEREFORE
  // READS NO CLOCK", which is at `apps/worker/src/batch/state-writer.ts:207` and
  // is not in a `ports.ts` at all. Line 98 is blank in the `ports.ts` the
  // sentence means, and this tree holds ELEVEN files whose path ends that way;
  // the vacant-line rule fires only when EVERY candidate is vacant, on
  // `nearestName`'s own rule that a suffix path is answered by all of them. That
  // is miss (10) and it is stated rather than tuned away.
  { file: 'apps/worker/src/detectors/identity.ts', cites: '0008_risk.sql:107', name: null },
  { file: 'apps/worker/src/provisioning/payload.ts', cites: 'scope.ts:995', name: null },
];

/**
 * Whether one citation is registered as owned elsewhere.
 *
 * @param {string} file
 * @param {string} cites
 * @param {string | null} name
 * @returns {boolean}
 */
function registeredCitation(file, cites, name) {
  return CITATIONS_OWNED_ELSEWHERE.some(
    (k) => k.file === file && k.cites === cites && k.name === name,
  );
}

/** How far from the cited line the name may sit. Two, and the header says why. */
const CITATION_WINDOW = 2;

/**
 * How far before a citation its SUBJECT may be written, in flattened characters.
 *
 * THE SUBJECT IS NOT THE NEAREST TOKEN AND THAT IS THE WHOLE POINT OF THE
 * ANCHOR. "`payoutRequests` is `owned` (`scope.ts:1056`)" binds `owned` as the
 * name, because `owned` is nearest; `payoutRequests` is the thing the sentence
 * is ABOUT and it is the only token in that sentence a runner can check the
 * cited line against. So the anchor reads EVERY backticked token in the span
 * rather than one, and asks whether any of them names the declaration the cited
 * line sits inside.
 *
 * 400 IS THE SENTENCE THESE REASONS ARE WRITTEN IN, and it sits inside a FLAT
 * REGION rather than on a cliff, which is measured rather than asserted. Over
 * the 56 named citations this check reads, the count the anchor refuses is 9 at
 * a span of 100 and 7 at 200, 300, 400, 600, 800 and 1600 alike. Every subject
 * in this corpus is written within 200 characters of the pointer that cites it,
 * so the parameter buys nothing above that and only loses sentences below it;
 * 400 is chosen for the margin and NOT because a number was tuned until a tree
 * went green.
 */
const CITATION_SUBJECT_SPAN = 400;

/** How far a bare `:N` may sit from the full path it continues. */
const CITATION_INHERIT_LINES = 6;

/** The extensions a citation may name. */
const CITED_EXTENSIONS = 'ts|tsx|mts|mjs|js|sql|md|json|ya?ml';

/**
 * A citation is a BACKTICKED TOKEN THAT ENDS IN A POINTER: `` `path/to/x.ts:12` ``,
 * `` `x.ts:12-34` ``, or the bare `` `:12` `` that continues the path cited before
 * it. It is read as two anchored pieces over one token rather than as a single
 * pattern over the whole text, AND THAT IS NOT A STYLE CHOICE.
 *
 * The single pattern was `` `([^`\n]*?)(path)?:(\d+)(-(\d+))?` `` and it is
 * QUADRATIC on a document with long backtick-free stretches: the lazy prefix
 * cannot cross a backtick, so every backtick in the file is tried as an opener
 * and each one rescans the region after it. On six source files nobody noticed.
 * On `docs/decisions/ALLOCATION.md`, 1.29 MB flattened to one line, it does not
 * finish in five minutes, and A CHECK THAT CANNOT FINISH IS A CHECK THAT DOES
 * NOT RUN. The tokenizer in `citationsIn` walks the backticks once and tests
 * each candidate token against these two, both anchored, which is linear in the
 * file and reads the same citations.
 *
 * THE COMMA LIST IS THE THIRD SHAPE AND IT WAS READ AS NO CITATION AT ALL until
 * this trailing group was added. `` `packages/db/src/scope.ts:644,649` `` is how
 * this corpus cites two rules of one registry in one breath, and the tail was
 * anchored at the end of the token, so `:644,649` matched nothing and the whole
 * token fell through as ordinary prose. TWO OF THE FIVE `scope.ts` CITATIONS
 * SESSION 399 MEASURED WRONG ARE THIS SHAPE, and neither was green because a
 * window admitted it: neither was ever read. A pointer no reader parses reads as
 * verified exactly as loudly as one that resolves, which is the property this
 * whole check exists for. Each number becomes its OWN citation, sharing the path
 * and the name, so `:644,649` is two pointers and each is answered separately.
 */
const CITATION_TAIL = /:(\d+)(?:-(\d+))?((?:,\d+)+)?$/;

/** The path half, anchored at the end of whatever sits before the pointer. */
const CITATION_PATH = new RegExp('[A-Za-z0-9_./()-]*[A-Za-z0-9_-]\\.(?:' + CITED_EXTENSIONS + ')$');

/** A backticked token that is itself a citation, which names nothing. */
const CITATION_TOKEN = new RegExp('\\.(?:' + CITED_EXTENSIONS + '):\\d');

/**
 * What may sit between a name and the pointer that cites it. Whitespace and
 * opening punctuation, and a linking word. AN APOSTROPHE IS NOT GLUE: `X`'
 * makes X a possessive, so the citation is about X's something and not about X.
 */
const IDENTIFIER_GLUE = /^[\s(,:*-]*(?:at|in|is|see)?[\s(,:*-]*$/i;

/** A claim that the cited line does NOT hold the name, which is RI-14's half. */
const NEGATED_CLAIM =
  /\b(?:no|not|never|neither|nor|without|nothing|none|lacks?|absent|missing)\b[^`.;]{0,40}$/i;

/**
 * One file as a single stream, with the source line of every character.
 *
 * A CITATION AND THE NAME IT CITES ARE ROUTINELY ON DIFFERENT PHYSICAL LINES,
 * because these reasons are concatenated string literals and wrapped comments.
 * The one this check exists for is exactly that shape: `gateNoInFlight` ends one
 * line of `wiring.test.ts` and `` (`:1254`) `` opens the next. Reading line by
 * line sees a citation with no name beside it and says nothing, which is the
 * check passing the defect it was written for.
 *
 * @param {string} text
 * @returns {{flat: string, lineOf: (index: number) => number}}
 */
function flattenReasons(text) {
  // SCANNED CHARACTER BY CHARACTER FROM EACH END OF A LINE, AND NOT BY REGEX,
  // and the line of a character is found by BINARY SEARCH over the pieces
  // rather than stored per character. The two shapes below are the same two the
  // first draft wrote as one global regex, and the regex was wrong twice: every
  // leading group was optional so it had no literal to prefilter on and was
  // tried at EVERY index of the text, and `[ \t]*` twice around an optional
  // token is two greedy runs over one character class, which backtracks over
  // every way to split a run of spaces. Source files have neither problem. A
  // PADDED MARKDOWN TABLE IS ONE 13,000-CHARACTER LINE OF THEM, and the regex
  // did not finish on `docs/decisions/ALLOCATION.md` in five minutes. A hand
  // scan is linear, states the shape it strips in the order it strips it, and
  // reads the 19 MB under `docs/` in a fifth of a second.
  const ws = (/** @type {string} */ c) => c === ' ' || c === '\t';
  const quote = (/** @type {string} */ c) => c === "'" || c === '"';
  const raw = text.split('\n');
  /** @type {string[]} */
  const pieces = [];
  /** @type {number[]} */
  const at = [];
  /** @type {number[]} */
  const of = [];
  let width = 0;
  /** @type {(piece: string, line: number) => void} */
  const push = (piece, line) => {
    if (piece === '') return;
    pieces.push(piece);
    at.push(width);
    of.push(line);
    width += piece.length;
  };
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i] ?? '';
    let from = 0;
    let to = line.length;
    if (i < raw.length - 1) {
      // Backwards from the newline: `\r?`, spaces, an optional `+` joining two
      // string literals, spaces, and the quote that closed the first of them.
      if (line.charAt(to - 1) === '\r') to -= 1;
      while (to > from && ws(line.charAt(to - 1))) to -= 1;
      if (line.charAt(to - 1) === '+') {
        to -= 1;
        while (to > from && ws(line.charAt(to - 1))) to -= 1;
      }
      if (quote(line.charAt(to - 1))) to -= 1;
    }
    if (i > 0) {
      // Forwards from the newline: indent, a comment leader, indent, and the
      // quote that opens the continuation.
      while (from < to && ws(line.charAt(from))) from += 1;
      if (line.startsWith('//', from)) {
        from += 2;
        while (line.charAt(from) === '/') from += 1;
      } else if (line.charAt(from) === '*' || line.charAt(from) === '>') from += 1;
      while (from < to && ws(line.charAt(from))) from += 1;
      if (quote(line.charAt(from))) from += 1;
    }
    push(line.slice(from, Math.max(from, to)), i + 1);
    // The joiner stands for the newline and belongs to the line AFTER it, which
    // is where a citation that opens the next line is read from.
    if (i < raw.length - 1) push(' ', i + 2);
  }
  return {
    flat: pieces.join(''),
    lineOf: (index) => {
      let lo = 0;
      let hi = at.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((at[mid] ?? 0) <= index) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return best < 0 ? 0 : (of[best] ?? 0);
    },
  };
}

/**
 * The name a citation is about, or null when it names none.
 *
 * @param {string} flat
 * @param {number} upto  where the citation starts
 * @returns {string | null}
 */
function citedIdentifier(flat, upto) {
  // THE TWO BACKTICKS IMMEDIATELY BEFORE THE CITATION, NEVER A PAIRING WALKED
  // FROM THE START OF THE FILE. The first draft did the latter and it was armed
  // for the head of the file and disarmed for the rest:
  // `apps/api/test/wiring.test.ts` uses a lone backtick as an APOSTROPHE, and
  // one stray backtick inverts every pairing after it. The check went quiet on
  // all three copies of the seeded historical defect and reported PASS, which is
  // a check that cannot fail hiding inside a check that can. Read locally and a
  // stray backtick costs one binding rather than every binding below it.
  //
  // THIS SENTENCE CARRIED A POINTER INTO THAT FILE AND IT CARRIES NONE NOW
  // (ADR-377). The retired figure is line 215, and it was TRUE THE DAY IT WAS
  // WRITTEN: the commit that introduced this check, where the file was 424 lines
  // and the apostrophe sat on that line. The file is 3,593 lines now, the clause
  // the pointer named has been rewritten away, and the apostrophe it was about
  // is on dozens of other lines. NOTHING IN THIS REPOSITORY COULD REPORT THE
  // DRIFT AND THE REASONS ARE TWO, NOT ONE: `citedReasonFiles` puts this whole
  // package outside RI-15's own scope, and `IDENTIFIER_GLUE` binds no name
  // across the words this sentence wrote between the name and the pointer, so
  // both legs were off at once. The claim is about the FILE rather than about a
  // line, it is now written that way, and that is the only form of it that
  // cannot drift.
  const close = flat.lastIndexOf('`', upto - 1);
  if (close < 0) return null;
  const open = flat.lastIndexOf('`', close - 1);
  if (open < 0) return null;
  const token = flat.slice(open + 1, close);
  if (!IDENTIFIER_GLUE.test(flat.slice(close + 1, upto))) return null;
  if (CITATION_TOKEN.test(token)) return null;
  if (NEGATED_CLAIM.test(flat.slice(Math.max(0, open - 70), open))) return null;
  return identifierIn(token);
}

/**
 * The name a citation carries INSIDE ITS OWN BACKTICKS, or null when the token
 * names only the file it points into.
 *
 * THE SHAPE MARKDOWN ACTUALLY WRITES, and the one both checks were blind to.
 * `citedIdentifier` binds a backticked name written IN FRONT of the pointer,
 * which is how a source comment writes a citation; a document writes
 * ``[`setAdminReadSource:739`](../../apps/api/src/routes/admin-reads.ts)`` and
 * puts the name inside the pointer's own backticks, with nothing in front of it
 * to bind. `WAVE-06` section 4.1 carried that pointer 33 lines off in an
 * approved plan and 16 of 16 invariants held.
 *
 * A TOKEN'S PREFIX NAMES EITHER THE FILE OR A SYMBOL IN IT, and the two are told
 * apart mechanically rather than guessed at. `admin-reads.ts:694` and
 * ``[`EVENTS:396`](../architecture/EVENTS.md)`` both name the FILE -- one with
 * its extension, one by the nickname this corpus uses for the document -- and
 * neither says anything about the line a reader would land on. So a prefix that
 * is a path is refused by the caller, and a prefix the target's own basename
 * begins with is refused here. EVERYTHING ELSE IS THE SYMBOL THE POINTER IS
 * ABOUT.
 *
 * THE CALLER ASKS THIS ONLY WHERE THE PATH IS STATED, which is the measurement
 * that keeps the widening from becoming a second guess stacked on the first.
 *
 * THE NEGATED CLAIM IS READ FROM THE SAME PLACE `citedIdentifier` READS IT, so
 * "no `identityColumn` here (`x.ts:52`)" stays RI-14's half in both spellings.
 *
 * @param {string} flat
 * @param {number} open  the citation token's own opening backtick
 * @param {string} before  the token, up to its pointer
 * @param {string} target  the path the citation resolved to
 * @returns {string | null}
 */
function citedInToken(flat, open, before, target) {
  const stem = (target.split('/').pop() ?? '').replace(/\.[A-Za-z0-9]+$/, '');
  if (stem !== '' && stem.toLowerCase().startsWith(before.toLowerCase())) return null;
  if (NEGATED_CLAIM.test(flat.slice(Math.max(0, open - 70), open))) return null;
  return identifierIn(before);
}

/**
 * The identifier a backticked token is about, or null when it is about none.
 *
 * ONE EXTRACTION, READ FROM BOTH SIDES OF A CITATION. A second copy would drift
 * the first time one side learned a spelling the other did not, which is the
 * failure RI-13's header names about phrase lists and the reason `citationsIn`
 * is one grammar rather than two.
 *
 * @param {string} token
 * @returns {string | null}
 */
function identifierIn(token) {
  if (token.length > 80 || /[/$\s\n]/.test(token)) return null;
  // `principal(request)` is about `principal`; `CheckoutTx.insertAttribution`
  // is about the member, which is the specific half of the two.
  const segments = token
    .replace(/[(<].*$/, '')
    .split('.')
    .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  const name = segments[segments.length - 1];
  return name !== undefined && name.length >= 3 ? name : null;
}

/**
 * Every backticked token written within `CITATION_SUBJECT_SPAN` characters
 * before a citation, as the SUBJECTS that citation may be about.
 *
 * DELIBERATELY UNFILTERED. `identifierIn` narrows a token to the one name it
 * BINDS, because binding is a claim the check then enforces; this list is the
 * other direction -- it is asked whether one particular declaration is named,
 * and a token that names nothing simply answers no. Filtering here would drop
 * `liability_snapshots` for having an underscore or `CheckoutTx.insert` for
 * having a dot, and both of those are exactly the shape a subject is written in.
 *
 * THE TOKENS ARE THE SCANNER'S OWN AND NOT A SECOND PAIRING. Re-tokenizing the
 * span with a regex pairs backticks from wherever the span happens to start, so
 * a span opening mid-token inverts every pair inside it and the subject a
 * sentence plainly writes goes missing. That is the same defect `citedIdentifier`
 * records about walking pairs from the start of a file, arriving at the other
 * end of the same reader.
 *
 * @param {readonly {at: number, token: string}[]} seen  tokens already paired
 * @param {number} upto  where the citation's own token starts
 * @returns {string[]}
 */
function subjectsBefore(seen, upto) {
  /** @type {string[]} */
  const out = [];
  for (const s of seen) {
    if (s.at < upto - CITATION_SUBJECT_SPAN || s.at >= upto) continue;
    out.push(s.token);
  }
  return out;
}

/**
 * The shapes a line DECLARES a name in, in the languages this tree cites.
 *
 * FIVE SHAPES AND NOT A PARSER, and the difference is the point. A parser would
 * be right about more lines and would be a second compiler in a check that must
 * finish in a second over 19 MB. These five are what the cited files are written
 * in: a TypeScript binding, an object-literal or interface member, a `CREATE`,
 * a named constraint, a SQL column, and the two `ALTER TABLE` forms. Anything
 * else declares nothing HERE, which makes the anchor fail closed -- it reports
 * rather than guesses.
 *
 * THE TWO `ALTER` SHAPES WERE MISSING AND THAT IS RI-14'S BLINDNESS ARRIVING IN
 * THIS READER. A merged migration is never edited, only superseded (E2), so
 * every column added to a table after its `CREATE` arrives as `ALTER TABLE ...
 * ADD COLUMN` and every constraint as `ADD CONSTRAINT`. Without these two, the
 * whole of that half of the schema was UNCITABLE: a reason pointing at
 * `0065:101` for `lifetime_settled_cents` was told the line declares nothing,
 * so the only way to cite the column that this session's entire subject turns on
 * was to cite it wrongly. ADR-214 section 5. MEASURED before it was written: the
 * two shapes move 0 existing sites and make 1,088 schema objects citable.
 */
const DECLARATION_SHAPES = [
  /^\s*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  /^\s*(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[?!]?\s*[:(]/,
  /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:MATERIALIZED\s+)?(?:TABLE|VIEW|INDEX|TYPE|FUNCTION|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  /^\s*CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  /^\s*(?:ALTER\s+TABLE\s+\S+\s+)?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  /^\s*(?:ALTER\s+TABLE\s+\S+\s+)?ADD\s+CONSTRAINT\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(?:uuid|text|citext|integer|bigint|numeric|boolean|jsonb|json|bytea|timestamptz|timestamp|date|smallint|interval)\b/i,
];

/**
 * The name one line declares, or null when it declares none.
 *
 * @param {string} line
 * @returns {string | null}
 */
function declaredNameOn(line) {
  for (const shape of DECLARATION_SHAPES) {
    const found = shape.exec(line);
    if (found?.[1] !== undefined) return found[1];
  }
  return null;
}

/** A line that carries nothing to check: empty, or a bare closing bracket. */
const VACANT_LINE = /^[\s)\]}>;,]*$/;

/**
 * The indent of a line, in characters, tabs counted as one.
 *
 * @param {string} line
 * @returns {number}
 */
function indentOf(line) {
  let i = 0;
  while (i < line.length && (line.charAt(i) === ' ' || line.charAt(i) === '\t')) i += 1;
  return i;
}

/**
 * The name of the declaration one line sits INSIDE, or null when it sits inside
 * none this reader can name.
 *
 * BY INDENTATION, WHICH IS WHAT THESE FILES ARE FORMATTED BY. `prettier` and
 * `pg_format` both indent a member under the thing that declares it, so the
 * enclosing declaration of a line is the nearest line above it at a strictly
 * smaller indent that declares a name -- and when that line declares none (a
 * `{` continuation, a docblock opener), the walk continues from THERE rather
 * than giving up, so a member two levels in still reaches its table.
 *
 * A LINE AT COLUMN ZERO IS ITS OWN DECLARATION and nothing above it is asked,
 * because `export type ScopedTableKey = ...` is enclosed by the file.
 *
 * @param {readonly string[]} lines
 * @param {number} start  one-based
 * @returns {string | null}
 */
function enclosingDeclaration(lines, start) {
  let from = start;
  for (let guard = 0; guard < 64; guard += 1) {
    const self = lines[from - 1] ?? '';
    const base = indentOf(self);
    if (base === 0) return declaredNameOn(self);
    let next = -1;
    for (let j = from - 2; j >= 0; j -= 1) {
      const line = lines[j] ?? '';
      if (line.trim() === '') continue;
      if (indentOf(line) < base) {
        next = j + 1;
        break;
      }
    }
    if (next < 0) return declaredNameOn(self);
    const named = declaredNameOn(lines[next - 1] ?? '');
    if (named !== null) return named;
    from = next;
  }
  return null;
}

/**
 * Whether two written names are the same name.
 *
 * THE CORPUS WRITES ONE THING TWO WAYS AND BOTH ARE CORRECT: the registry key
 * is `liabilitySnapshots` and the sentence that cites it says
 * `liability_snapshots`, because one is the TypeScript name and the other is the
 * table. So the comparison is over letters and digits only.
 *
 * CONTAINMENT IS ADMITTED ONLY FROM FOUR CHARACTERS UP, which is measured
 * rather than chosen: `CheckoutTx.insertAttribution` must reach
 * `insertAttribution` and `certificates.id` must reach `certificates`, and a
 * bare `id` or `tx` must reach nothing, because a two-letter token is inside
 * half the identifiers in this tree.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameName(a, b) {
  const x = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (x === '' || y === '') return false;
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  return short.length >= 4 && long.includes(short);
}

/**
 * Whether one file ANCHORS a citation: whether the cited line is part of the
 * declaration the citing sentence is about.
 *
 * TWO WAYS, AND A CITATION NEEDS ONE OF THEM.
 *   (a) THE CITED RANGE DECLARES THE NAME. `gateNoInFlight`
 *       (`wallet-withdrawals.ts:1254`) lands on
 *       `export function gateNoInFlight(...)`, and there is nothing left to
 *       argue about.
 *   (b) THE ENCLOSING DECLARATION IS NAMED IN THE CITING SENTENCE.
 *       "`payoutRequests` is `owned` (`scope.ts:1056`)" lands on
 *       `class: 'owned',`, which declares `class` rather than `owned` -- but it
 *       sits inside the `payoutRequests` entry, and the sentence says
 *       `payoutRequests`. THAT is what the citation proves.
 *
 * NEITHER IS SATISFIABLE BY A COINCIDENTAL TOKEN, which is the entire reason
 * this exists. `firm`, `owned` and `identity_id` are the commonest words in
 * `scope.ts`; a registry entry's KEY appears once.
 *
 * @param {readonly string[]} lines
 * @param {{start: number, end: number, name: string, subjects: readonly string[]}} c
 * @returns {boolean}
 */
function anchoredIn(lines, c) {
  const last = Math.min(c.end, lines.length);
  for (let line = c.start; line <= last; line += 1) {
    const declared = declaredNameOn(lines[line - 1] ?? '');
    if (declared !== null && sameName(declared, c.name)) return true;
  }
  const enclosing = enclosingDeclaration(lines, c.start);
  if (enclosing === null) return false;
  return c.subjects.some((s) => sameName(s, enclosing));
}

/**
 * Every citation in one text, with the bare `:12` resolved against the path
 * cited above it and the name it is about bound to it.
 *
 * ONE GRAMMAR, READ BY TWO CHECKS. RI-15 reads live source files and RI-16
 * reads live documents, and the thing they read is the same thing: a pointer
 * somebody wrote so a later reader could follow it. A second copy of this
 * grammar would drift the first time one of them learned a shape the other did
 * not, which is the failure RI-13's header names about phrase lists. The two
 * checks differ in WHAT THEY READ and in what they say about a finding, and
 * they share how a citation is spelled.
 *
 * INHERITANCE IS THE ONE THING THE TWO CHECKS DISAGREE ABOUT and it is a
 * parameter rather than a fork of the reader. RI-15 inherits the nearest path
 * within `CITATION_INHERIT_LINES` lines, which is how a reader reads a source
 * comment. RI-16 does not, and its header measures why: in a padded markdown
 * table a bare pointer is usually a registry shorthand, and every one of the
 * fifteen findings inheritance adds there is the reader guessing.
 *
 * @param {string} text
 * @param {boolean} [inherit]
 * @returns {{at: number, target: string, href: string | null, start: number, end: number, cited: string, name: string | null, subjects: string[]}[]}
 */
function citationsIn(text, inherit = true) {
  const { flat, lineOf } = flattenReasons(text);
  /** @type {{at: number, target: string, href: string | null, start: number, end: number, cited: string, name: string | null, subjects: string[]}[]} */
  const out = [];
  /** @type {number[]} */
  const ticks = [];
  for (let i = flat.indexOf('`'); i >= 0; i = flat.indexOf('`', i + 1)) ticks.push(i);
  /** @type {string | null} */
  let inherited = null;
  let inheritedAt = -CITATION_INHERIT_LINES - 1;
  // THE PAIRING IS THE ONE A SCANNER MAKES AND NOT THE ONE A PARSER WOULD. A
  // token that is not a citation gives its CLOSING backtick up to be the next
  // token's opener, which is what a left-to-right search does and what keeps a
  // backtick used as an apostrophe from inverting every pairing after it.
  /** @type {{at: number, token: string}[]} */
  const seen = [];
  for (let k = 0; k + 1 < ticks.length;) {
    const open = ticks[k] ?? 0;
    const close = ticks[k + 1] ?? 0;
    const token = flat.slice(open + 1, close);
    seen.push({ at: open, token });
    const tail = CITATION_TAIL.exec(token);
    if (tail === null || tail[1] === undefined) {
      k += 1;
      continue;
    }
    k += 2;
    const at = lineOf(open);
    // THE MARKDOWN LINK A CITATION SITS INSIDE NAMES ITS FILE OUTRIGHT, and
    // `[`0004:40`](../../packages/db/migrations/0004_catalog.sql)` is how this
    // corpus writes a citation whose pointer alone would resolve to nothing.
    // Read here rather than in one caller so that BOTH checks read one grammar;
    // and `apps/admin/src/index.ts` carries it in a SOURCE COMMENT, which is why
    // `citationTargets` resolves it for both checks rather than for one.
    /** @type {string | null} */
    let href = null;
    if (flat.slice(close + 1, close + 3) === '](') {
      const shut = flat.indexOf(')', close + 3);
      const spec = shut < 0 ? '' : flat.slice(close + 3, shut);
      if (/^[^\s#?:]+\.[A-Za-z0-9]+$/.test(spec)) href = spec;
    }
    const before = token.slice(0, tail.index);
    const found = CITATION_PATH.exec(before);
    const path = found === null ? '' : found[0];
    /** @type {string | null} */
    let target = null;
    if (path !== '') {
      target = path;
      inherited = path;
      inheritedAt = at;
    } else if (href !== null) {
      target = href;
    } else if (
      inherit &&
      before === '' &&
      inherited !== null &&
      at - inheritedAt <= CITATION_INHERIT_LINES
    ) {
      // ONLY A BARE POINTER CONTINUES THE PATH ABOVE IT. A token carrying its
      // own prefix names its own thing, and over the 588 source files this
      // reader now covers there are 154 of them and NOT ONE is a symbol in the
      // file above: `0029:565` and `0017:82` are MIGRATION numbers, `M07:111`
      // and `M10:372` are PLANS and section lines, `EVENTS:407` and `INFRA:53`
      // are documents, and `+00:00`, `-06:00`, `1:30` and
      // `http://localhost:3000` are not citations at all. Inheriting a path into
      // one of those resolves a pointer nobody wrote and range-checks it against
      // a file it was never about.
      target = inherited;
    }
    if (target === null) continue;
    const first = tail[1];
    const last = tail[2];
    // THE NAME IN FRONT FIRST, THEN THE NAME INSIDE, AND THE SECOND ONLY
    // WHERE THE PATH IS STATED. A token whose prefix is a PATH names the file
    // and no symbol; a token whose path was INHERITED is a registry shorthand
    // far more often than a symbol, and the count is not close. Every one of
    // the seven prefixed tokens in `CITED_REASON_FILES` is `M07:111` or
    // `M20:62` -- a PLAN and a section line -- and 41 of the 163 in docs/ are
    // the same shape. Binding a name there would be the check guessing a path
    // and then guessing a symbol inside it.
    const name =
      citedIdentifier(flat, open) ??
      (href !== null && path === '' ? citedInToken(flat, open, before, target) : null);
    const subjects = subjectsBefore(seen, open);
    // A COMMA LIST IS N CITATIONS SHARING ONE PATH AND ONE SENTENCE. They are
    // emitted separately so each is resolved, range-checked and anchored on its
    // own; the check's own miss (8) already says the reader binds one name to a
    // list of pointers, and emitting one citation per number does not fix that
    // -- it stops the second and later pointers being read as nothing at all.
    /** @type {{first: string, last: string | undefined}[]} */
    const pointers = [{ first, last }];
    for (const extra of (tail[3] ?? '').split(',')) {
      if (extra !== '') pointers.push({ first: extra, last: undefined });
    }
    for (const p of pointers) {
      out.push({
        href,
        at,
        target,
        start: Number(p.first),
        end: p.last === undefined ? Number(p.first) : Number(p.last),
        cited: `${target}:${p.first}${p.last === undefined ? '' : `-${p.last}`}`,
        name,
        subjects,
      });
    }
  }
  return out;
}

/**
 * The nearest line in `files` holding `needle`, and how far it sits from the
 * cited range. Null when no line in any of them holds it at all.
 *
 * @param {readonly string[]} files
 * @param {(rel: string) => string[]} linesOf
 * @param {number} start
 * @param {number} end
 * @param {string} needle  already lower-cased
 * @returns {{file: string, line: number, away: number} | null}
 */
function nearestName(files, linesOf, start, end, needle) {
  /** @type {{file: string, line: number, away: number} | null} */
  let best = null;
  for (const f of files) {
    const lines = linesOf(f);
    for (let j = 0; j < lines.length; j += 1) {
      if (!(lines[j] ?? '').toLowerCase().includes(needle)) continue;
      const line = j + 1;
      const away = line < start ? start - line : line > end ? line - end : 0;
      if (best === null || away < best.away) best = { file: f, line, away };
      if (away === 0) return best;
    }
  }
  return best;
}

/**
 * The files that could answer one citation written in `rel`.
 *
 * ONE RESOLUTION, READ BY BOTH CHECKS, for `citationsIn`'s reason. A path the
 * text STATES relative to itself -- a markdown link's href, or a `../..` pointer
 * written in a source comment -- is resolved AGAINST THE CITING FILE and lands
 * on ONE file. Anything else is matched by suffix against the tree, which is how
 * this corpus writes `routes/payouts.ts:395` and means the one file whose path
 * ends that way.
 *
 * RI-16 ALREADY DID THE FIRST HALF FOR ITS LINKS AND RI-15 DID NOT, so
 * `apps/admin/src/index.ts` citing `../../api/src/admin-source/index.ts:178`
 * read as A PATH NO FILE IN THIS TREE HAS. It is one instance in 210 and it was
 * hiding a real one: the pointer resolves and the name is not within reach of it.
 *
 * @param {string} root
 * @param {string} rel  the file the citation is written in
 * @param {{target: string, href: string | null}} c
 * @param {(target: string) => string[]} candidates
 * @returns {string[]}
 */
function citationTargets(root, rel, c, candidates) {
  const spec = c.href ?? c.target;
  if (c.href === null && !/^\.\.?\//.test(spec)) return candidates(spec);
  const found = relative(root, resolve(dirname(join(root, rel)), spec));
  return existsSync(join(root, found)) ? [found] : [];
}

/**
 * A reader over one tree, resolving a cited path to the files that could answer
 * it and caching every file it reads.
 *
 * @param {string} root
 * @returns {{tree: string[], linesOf: (rel: string) => string[], candidates: (target: string) => string[]}}
 */
function citationReader(root) {
  const tree = walk(root);
  /** @type {Map<string, string[]>} */
  const cache = new Map();
  /** @type {(rel: string) => string[]} */
  const linesOf = (rel) => {
    const hit = cache.get(rel);
    if (hit !== undefined) return hit;
    const lines = read(root, rel).split('\n');
    cache.set(rel, lines);
    return lines;
  };
  /** @type {Map<string, string[]>} */
  const found = new Map();
  return {
    tree,
    linesOf,
    candidates: (target) => {
      const hit = found.get(target);
      if (hit !== undefined) return hit;
      const files = tree.filter((f) => f === target || f.endsWith(`/${target}`));
      found.set(target, files);
      return files;
    },
  };
}

/** @type {Invariant} */
const ri15 = {
  id: 'RI-15',
  title: 'No reason cites a line that is not part of what the sentence names',
  covers:
    'every `file.ts:12` and `file.ts:12-34` citation in EVERY SOURCE FILE THIS ' +
    `TREE HOLDS -- ${CITED_REASON_EXTENSIONS.source} outside \`${OWN_PACKAGE}\`, ` +
    'DERIVED FROM THE WALK and not a list, because a list is the hand-maintained ' +
    "count RI-05's `covers` names and it drifted exactly that way: session 351 " +
    'found `routes/verify.ts` carrying the same two drifted pointers as the ' +
    'copies this check flagged, in a file the list did not name. The one ' +
    'exclusion is this package, whose citations are the grammar WORKED EXAMPLES ' +
    'and the suite SEEDS rather than claims about this tree, and it is measured: ' +
    'all 78 findings inside it sit in the two files whose subject IS this ' +
    'grammar and the other four carry none. It is 588 files and 207 citations ' +
    'where it was 6 and 94. Plus the bare `:12` that continues a path cited within ' +
    `${CITATION_INHERIT_LINES} lines above it, AND the comma list ` +
    '`x.ts:644,649`, which is read as ONE CITATION PER NUMBER and was read as ' +
    'NO CITATION AT ALL before ADR-212: the tail was anchored at the end of the ' +
    'token, so the whole token fell through as prose and two of the five wrong ' +
    '`scope.ts` pointers session 399 measured were never parsed. FOUR THINGS ' +
    'ARE ASSERTED: the ' +
    'path resolves to a file in this tree, the file reaches the line, the CITED ' +
    'LINE IS NOT BLANK OR A BARE CLOSING BRACKET in every file that path could ' +
    'name -- asserted over every citation, named or not, because it needs no ' +
    'name, and 6 of the 225 citations on `37d70b3` failed it, every one a ' +
    'defect -- and -- ' +
    'when the citation is preceded by a BACKTICKED NAME with nothing but glue ' +
    'between them, or CARRIES ONE INSIDE ITS OWN BACKTICKS beside a path the ' +
    'text STATES -- that name appears within ' +
    `${CITATION_WINDOW} lines of the line cited, matched case-insensitively as ` +
    'a substring, AND THE CITED LINE IS ANCHORED TO IT: the cited range ' +
    'DECLARES the name, or the ENCLOSING DECLARATION of the cited line is ' +
    `named among the backticked tokens within ${CITATION_SUBJECT_SPAN} ` +
    'characters before the citation. THE ANCHOR IS WHAT THE WINDOW COULD NOT ' +
    'SUPPLY. In `scope.ts` the tokens `firm`, `owned` and `identity_id` sit on ' +
    '107, 72 and 109 lines, so a window around any of the 41 `class: ' +
    "'owned'" +
    '` ' +
    'lines is satisfied by coincidence; a registry entry key appears ONCE. THE ' +
    'WINDOW IS TUNED AGAINST THIS CORPUS: the widest TRUE ' +
    'citation measured is one line off and the narrowest FALSE one on record is ' +
    'three, so two catches every false citation on record and admits every true ' +
    'one -- and it is now known to be beside the point, because narrowing it ' +
    'from 2 to 0 moves NO SITE on this tree and catches NONE of the five. WHAT ' +
    'WAS REFUSED, EACH COST DERIVED BY RUNNING IT: requiring the cited line ' +
    'itself to DECLARE the name turns 26 of 52 named citations red and 18 of ' +
    'those are honest; requiring the anchor of EVERY citation turns 116 of 225 ' +
    'red. WHAT IT DOES NOT CATCH. (1) A citation with no name beside it is ' +
    'checked for resolution and range only; of the four false citations of ' +
    '2026-08-28 this catches THREE and misses `wallet-withdrawals.ts:1506`, ' +
    'which sits behind the words "the identity arm this route presents" and ' +
    'names nothing a runner can look up. 47 of the 207 citations this check ' +
    'reads today carry a bindable name, 27 of them in `wiring.test.ts`. (1a) ' +
    'THE IN-TOKEN NAME IS RI-16s HALF IN PRACTICE, because it is read only ' +
    'where a markdown LINK states the path and no source file here writes one. ' +
    'A prefixed token INHERITS NO PATH AT ALL: all 154 in this input are a ' +
    'MIGRATION number, a PLAN and a section line, a document, or a clock ' +
    '(`0017:82`, `M07:111`, `EVENTS:407`, `+00:00`), and not one is a symbol ' +
    'in the file cited above it. (2) A ' +
    'NEGATED claim is skipped, ' +
    'because "`fills` HAS NO `identity_id` (`schema.ts:3005`)" cites the line ' +
    'the name must be ABSENT from; that half is RI-14. (3) Only the NEAREST ' +
    'backticked token binds, so a possessive is dropped rather than guessed. ' +
    '(4) It reads docs/decisions NOT AT ALL, deliberately: an ADR is a dated ' +
    'record of the tree as it was, its citations go stale by design when the ' +
    'tree moves, and repairing one is an amendment rather than a commit. (5) A ' +
    'RANGE citation names a body whose declaring line can sit above the range, ' +
    'further than the window, and that is left noisy rather than given a second ' +
    'wider window. (6) A bare `:12` inherits the nearest full path within ' +
    `${CITATION_INHERIT_LINES} lines, which is wrong wherever a nearer path was ` +
    'cited for something else. (7) It ' +
    'never reads git history, so it cannot say whether a citation DRIFTED or was ' +
    'FALSE THE DAY IT WAS WRITTEN; both kinds are in the tree and both are ' +
    'findings. (8) A LIST of names against a LIST of pointers binds only its ' +
    'first pair, because the nearest token is the only one this reader can ' +
    'attach without guessing the positions -- reading the comma list makes the ' +
    'later pointers RESOLVE and RANGE-CHECK, and does not give them their own ' +
    'name. (9) The ANCHOR is asked only where a name binds, which is 52 of the ' +
    '225 citations here; the other 173 are checked for resolution, range and ' +
    'vacancy alone. (10) The vacant-line rule fires only when EVERY file a ' +
    'suffix path could name is vacant there, on `nearestName`s rule that a ' +
    'suffix path is answered by all of them, so ' +
    '`provisioning/payload.ts:217` citing `ports.ts:98` -- blank in the one it ' +
    'means and not in the other ten -- is NOT raised. ' +
    `${CITATIONS_OWNED_ELSEWHERE.length} CITATION(S) ARE NAMED AND NOT ENFORCED, in ` +
    'CITATIONS_OWNED_ELSEWHERE, each exact on file, pointer and name so that it ' +
    'covers one citation and expires by itself. The `wiring.test.ts` entry this ' +
    'register was opened for -- `routes/admin-wallet.ts:538` for ' +
    '`principal(request)`, declared at `:601` -- was REPAIRED by ADR-214s ' +
    'session and left with the repair, which is the first entry to expire by ' +
    'being fixed rather than by a rename. The rest arrived with the derived ' +
    'input set, some a pointer that no longer lands and some the wrong noun ' +
    'beside a true pointer, and NONE is in a file this fence holds. The register ' +
    'SHRINKS ONLY: an entry matching no finding on this ref is itself a finding.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const { tree, linesOf, candidates } = citationReader(root);
    const sources = citedReasonFiles(tree);
    if (sources.length === 0) {
      throw new Error(
        'RI-15 cannot run: the walk reached NO source file outside this check own package. A ' +
          'derived input set cannot be silently emptied by a rename, which is why it is derived, ' +
          'but it can be emptied by a walk that has stopped reaching the tree -- and then every ' +
          'drifted pointer in it would pass for the wrong reason',
      );
    }
    let scoped = 0;
    /** @type {Set<string>} */
    const raised = new Set();

    for (const rel of sources) {
      for (const c of citationsIn(read(root, rel))) {
        scoped += 1;
        const found = citationTargets(root, rel, c, candidates);
        if (found.length === 0) {
          findings.push(
            `${rel}:${c.at}: cites \`${c.cited}\` and NO FILE IN THIS TREE has that path. ` +
              `A pointer nobody can follow reads as verified and is not`,
          );
          continue;
        }
        const reachable = found.filter((f) => linesOf(f).length >= c.end);
        if (reachable.length === 0) {
          const shown = found[0] ?? c.target;
          findings.push(
            `${rel}:${c.at}: cites \`${c.cited}\` and ${shown} has ${linesOf(shown).length} lines. ` +
              `The pointer is past the end of the file it names`,
          );
          continue;
        }
        // THE CITED LINE CARRIES SOMETHING TO CHECK. A pointer that lands on a
        // blank line or on a bare `},` names nothing a reader can compare a
        // claim against, and it is the shape a drifted pointer takes when the
        // declaration it named moved DOWN: the reader follows it, finds the end
        // of some other thing, and cannot tell whether the claim is wrong or
        // the pointer is. Asserted over EVERY citation and not only the named
        // ones, because it needs no name.
        const vacant = reachable.every((f) => VACANT_LINE.test(linesOf(f)[c.start - 1] ?? ''));
        if (vacant) {
          raised.add(`${rel} ${c.cited} ${c.name ?? ''}`);
          if (!registeredCitation(rel, c.cited, c.name)) {
            findings.push(
              `${rel}:${c.at}: cites \`${c.cited}\` and that line is BLANK OR A BARE CLOSING ` +
                `BRACKET in ${reachable.join(', ')}. A pointer that lands on nothing reads as ` +
                `verified and proves nothing; it is what a pointer becomes when the declaration ` +
                `it named moved. Open the file and repoint it at the line that holds the claim`,
            );
          }
          continue;
        }
        if (c.name === null) continue;
        const hit = nearestName(reachable, linesOf, c.start, c.end, c.name.toLowerCase());
        if (hit === null || hit.away > CITATION_WINDOW) {
          raised.add(`${rel} ${c.cited} ${c.name}`);
          if (registeredCitation(rel, c.cited, c.name)) continue;
          const where =
            hit === null
              ? 'NOWHERE IN THAT FILE'
              : `at ${hit.file}:${hit.line}, ${hit.away} lines away`;
          findings.push(
            `${rel}:${c.at}: cites \`${c.cited}\` for \`${c.name}\` and \`${c.name}\` is ${where}. ` +
              `A citation that drifts is worse than none: it reads as verified and sends the ` +
              `next reader to the wrong line, which is how one stale claim survived four ` +
              `restatements. Open the file and repoint it, or say what the line does hold`,
          );
          continue;
        }
        // THE ANCHOR, AND IT IS THE HALF A WINDOW CANNOT SUPPLY. The name is
        // within reach; the question this asks is whether being within reach of
        // it MEANS anything. See `anchoredIn`.
        const bound = c.name;
        if (reachable.some((f) => anchoredIn(linesOf(f), { ...c, name: bound }))) continue;
        raised.add(`${rel} ${c.cited} ${bound}`);
        if (registeredCitation(rel, c.cited, bound)) continue;
        const enclosing = enclosingDeclaration(linesOf(reachable[0] ?? ''), c.start);
        findings.push(
          `${rel}:${c.at}: cites \`${c.cited}\` for \`${c.name}\`, and \`${c.name}\` is within ` +
            `${CITATION_WINDOW} line(s) of it WITHOUT THE CITED LINE BEING PART OF ANYTHING THIS ` +
            `SENTENCE NAMES. The line neither declares \`${c.name}\` nor sits inside ` +
            `${enclosing === null ? 'a declaration this reader can name' : `\`${enclosing}\``}, ` +
            `which nothing beside the citation names. A common word near a pointer is a ` +
            `coincidence, not a proof: name the declaration the line belongs to, or repoint the ` +
            `citation at the declaration you meant`,
        );
      }
    }

    if (scoped === 0) {
      throw new Error(
        `RI-15 read ${sources.length} source file(s) and found NO citation in any of them. This ` +
          'tree argues in `file:line` pointers, so zero is the reader having stopped matching ' +
          'rather than a clean tree',
      );
    }

    // THE REGISTER SHRINKS ONLY, which is CI-06u's rule and RI-16's. An entry
    // naming a citation that is no longer a finding is a repair that landed
    // without the register following it.
    for (const k of CITATIONS_OWNED_ELSEWHERE) {
      if (raised.has(`${k.file} ${k.cites} ${k.name ?? ''}`)) continue;
      findings.push(
        `${k.file}: the register claims \`${k.cites}\`${
          k.name === null ? '' : ` for \`${k.name}\``
        } is a known finding and ` +
          'it is not one on this ref. Either the repair landed and this entry goes, or the file ' +
          'moved and the entry moves with it. A register entry that names nothing exempts ' +
          'nothing and hides the next one',
      );
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-16  A citation in a LIVE DOCUMENT resolves, and the line says the name beside it
// -----------------------------------------------------------------------------
//
// RI-15 READS SIX SOURCE FILES AND ITS OWN `covers` LINE SAYS IT READS
// `docs/decisions` "NOT AT ALL". That was the right call for the input it had and
// it left the larger half of this corpus unread: 922 markdown documents under
// `docs/` carrying 4,469 pointers of the form `file.ts:12`, and until this check
// nothing mechanical followed one of them.
//
// WHY THIS MATTERS MORE HERE THAN IN SOURCE. A wrong citation in a test file is
// read by whoever next edits that test. A wrong citation in a corpus document is
// read by the founder during an E2 review and by every later session that treats
// the entry as settled, and neither of them opens the file to check. RI-15's own
// first run settled that these are AUTHORED WRONG rather than drifting: two of
// the citations it found in `routes/payouts.ts` were false at the commit that
// wrote them, checked by hand.
//
// THE SCOPE IS THE WHOLE OF docs/ AND THE EXCLUSIONS ARE BY SHAPE, EACH ONE
// MEASURED. This is the hard half of the slice and the numbers are the argument.
// Measured on this branch, 2026-08-28:
//
//   * 3,055 citations carry a path of their own or a markdown link beside them.
//     2,387 of those sit UNDER A DATED OR SESSION HEADING and 668 do not.
//   * 1,414 citations are a bare `:12` with no path anywhere near them.
//   * In scope: 668 citations across 922 documents, 19 of them carrying a name
//     this check can bind. EIGHT FINDINGS, all eight registered below.
//
// EXCLUSION 1: A DATED OR SESSION HEADING, AND IT IS NOT THIS CHECK'S IDEA.
// `CI-06/derivable-counts` argued and ruled exactly this axis over exactly this
// corpus: "an entry headed `## ... (2026-08-24)` or `## Session 207: ...` IS A
// RECORD OF A MEASUREMENT MADE THAT DAY", and rewriting it "would REWRITE THE
// RECORD TO SAY SOMETHING IT DID NOT SAY, which is a worse defect than the one
// being repaired". That is RI-15's reason for skipping ADRs, stated one level
// finer, and it is better than a directory list in three ways. It reaches
// INSIDE `docs/STATE.md`, which is a LIVE document that ACCUMULATES dated
// sections and which no directory rule can split. It puts a new session log out
// of scope the day it is written and a new plan IN scope the day it is written,
// with nobody maintaining a list. And it is one rule this corpus already keeps
// rather than a second one that drifts from it. The recogniser is
// `RECORD_HEADING` and it is read at heading levels 1 and 2 only, so an ADR's
// `### 3.` inherits the dated `##` its file opens with, for CI-06's reason.
//
// EXCLUSION 2: A FENCED BLOCK OR A GENERATED SPAN, masked with CI-06's own two
// expressions. A worked example of this check's own finding is exactly what the
// document explaining it would quote, and a generated span is the remedy rather
// than the defect.
//
// EXCLUSION 3: A BARE `:12` WITH NO PATH, AND THIS IS THE ONE THAT DIVERGES FROM
// RI-15. RI-15 lets a bare pointer inherit the nearest full path within six
// lines, and names as its miss (6) that this "is wrong wherever a nearer path
// was cited for something else -- across the rows of a markdown table". IN THIS
// CORPUS THAT IS NOT AN EDGE, IT IS THE COMMON CASE, and the measurement is
// decisive. Inheritance adds FIFTEEN findings inside this scope and ALL FIFTEEN
// ARE THE CHECK GUESSING A PATH:
//
//     `M05:214`, `M05:271`     a PLAN and a section line, not a file
//     `M03:311`                the same shape, in `FOLD-01`
//     `0011:49`, `0026:157`    a MIGRATION NUMBER, which has no extension
//     `open_ct 17:00`          a CLOCK TIME inside a transcribed calendar row
//     [`:874`](../a/path.ts)   the path is in the LINK, not above the line
//
// A bare pointer here is a shorthand for a REGISTRY ID far more often than it is
// a continuation of a path, so this check declines to invent a target. 1,123
// citations are out of scope for it and the number is stated rather than buried.
//
// AND THE HALF OF THAT HOLE THAT COULD BE CLOSED IS CLOSED, WHICH IS WHY THE
// DIVERGENCE IS NOT A NARROWING. A markdown citation routinely carries its own
// path in the link beside it, as `[`0004:40`](../../packages/db/migrations/0004_catalog.sql)`
// does, and that path is STATED BY THE DOCUMENT rather than guessed by the
// runner. Reading it brings 157 more citations into scope, a 30 percent gain
// over the path-carrying set alone, and resolves each one to ONE file rather
// than to every file in the tree whose name ends the same way.
//
// AND THE NAME HALF READS THE ORDER MARKDOWN ACTUALLY WRITES, WHICH IT DID NOT
// AT FIRST AND WHICH COST AN APPROVED PLAN A POINTER 33 LINES OFF. A source
// comment writes ``the store `databaseIdempotencyStore` (`store.ts:1`)``, name
// first and pointer second, and `citedIdentifier` binds exactly that. A document
// writes ``[`setAdminReadSource:739`](../../apps/api/src/routes/admin-reads.ts)``
// and puts the NAME INSIDE THE POINTER'S OWN BACKTICKS, with nothing in front of
// it to bind, so the name half saw nothing and only the range half ran. Seeded
// with `:99999` that citation turns this check red; seeded with the real defect
// it stayed green. `citedInToken` closes it and the two halves are told apart by
// what the prefix names rather than by a guess:
//
//     [`renderLiabilityHome:630`](../page.ts)   a SYMBOL. Bound
//     [`EVENTS:396`](../EVENTS.md)             the FILE, by this corpus's
//                                              nickname for it. Not bound
//     `admin-reads.ts:694`                     the FILE, with its extension.
//                                              Not bound, and the caller says so
//     `M07:111` under a cited `0008_risk.sql`  a PLAN and a section line, whose
//                                              path was GUESSED. Not bound
//
// THE LAST ROW IS THE ONE THAT DECIDES THE SHAPE OF THE RULE, and it is a
// measurement rather than a preference: every one of the seven prefixed tokens
// in RI-15's input is a migration number, a plan, a document or a clock, and 41
// of the 166 in scope here are the same shape. So the in-token name is read ONLY
// where the path is STATED -- in a markdown link beside the pointer -- and never
// where it was inherited, because a name bound onto a guessed path is two
// guesses stacked. The bindable set is 19 where the name-in-front half alone
// binds 5, and every one of the 14 the in-token half adds is a citation whose
// own link names the file it points into.
//
// WHAT IT DOES NOT CATCH, stated rather than left to be discovered.
// (1) THE NAME HALF IS STILL THIN AND THE NUMBER SAYS SO: 19 of the 668
//     citations in scope carry a name this check can bind, against 27 in
//     `wiring.test.ts` alone. Markdown writes a citation alone in a table cell
//     as readily as inside a link, and a bare cell has no name in either place.
//     The other 649 are checked for RESOLUTION AND RANGE only, which is the half
//     that found `DECISIONS.md:483`.
// (2) A NAME AFTER THE POINTER is not read. This corpus writes
//     "`routes/account-reads.ts:851` `ELIGIBILITY_BLOCKER`" as readily as the
//     other order, and binding backwards is a second inference this check does
//     not make. It is the next thing worth adding.
// (3) A BARE POINTER'S REGISTRY SHORTHAND is out of scope rather than resolved.
//     `M05:214` and `0011:49` name a plan and a migration, and both COULD be
//     resolved by a table this check does not have. That is the growth path.
// (4) Everything RI-15's covers line lists about the window, the possessive, the
//     negated claim and the range, because this reads the same grammar through
//     the same reader. The window is TWO and the reason is RI-15's.
// (5) It reads the tree it is given and never git history, so it cannot say
//     whether a citation drifted or was false the day it was written.
//
// THE EIGHT FINDINGS ARE REGISTERED AND NONE IS REPAIRED HERE, and the reason is
// a rule rather than a shortage of time. The first four sit in documents whose
// frontmatter reads `status: approved` in a FROZEN corpus, where "changing a
// frozen document requires an ADR, not a commit"; the tree agrees, and every
// post-FREEZE amendment to a plan carries an ADR number in its commit subject.
// The four the in-token binding added sit in a plan and name symbols under
// `apps/admin/`, and the fence that widened this reader holds neither file. No
// session that widens a check holds every file the widening reaches, which is
// the whole reason this register exists rather than a narrower reader. So each
// entry names the repair it is waiting for, and the register SHRINKS ONLY: an
// entry that matches no finding on this ref is itself a finding, which is
// CI-06u's rule about its own register and the difference between a register and
// an exemption list.

/** A record of a measurement rather than a claim about the tree, per CI-06. */
const RECORD_HEADING = /\b20\d{2}-[01]\d-[0-3]\d\b|\bsessions?\s+\d{1,4}\b/i;

/** The plan holding four of the register's entries, named once. */
const WAVE_06 = 'docs/plans/WAVE-06-admin-console-transport.md';

/**
 * THE FINDINGS THIS CHECK ARRIVED WITH, EACH ONE A REPAIR IT IS WAITING FOR.
 *
 * `ALLOCATION.md` rows 164 and 168 restate ADR-172's finding 1, and RI-15's own
 * header has already ruled on the citation: `PayoutTx.ledger` at
 * `routes/payouts.ts:395` "is 324 lines out today because ADR-176 DELETED that
 * member, which is the entry being right rather than wrong". THERE IS NO LINE TO
 * REPOINT IT AT. The repair is a sentence saying the member is gone, written in
 * the ADR that says so. Row 164's `sweeps/ports.ts:219` is the neighbouring
 * case: the pointer is right for the ADAPTER it was cited for, and the name
 * written beside it, `systemDb('nightly-batch')`, is at `:283`. A reader who
 * follows it lands on the right evidence for a different word.
 *
 * `FOLD-01`'s `DECISIONS.md:483` names NO FILE THIS TREE HAS EVER HAD.
 * `DECISIONS.md` is this corpus's nickname for the ADR registry and every other
 * appearance of it is a markdown link to `decisions/README.md`; this one is a
 * pointer with a line number on a document that does not exist, which is
 * RI-15's "false the day it was written" in its purest form. The repair is to
 * cite `ADR-023` itself, which the same table cell already links.
 *
 * FOUR MORE ARRIVED THE DAY THE IN-TOKEN NAME BINDING LANDED, AND THAT IS THE
 * WIDENING WORKING RATHER THAN A COST OF IT. `WAVE-06` section 3.1 cites four
 * symbols in `apps/admin/src/page.ts` as ``[`renderLiabilityHome:630`](...)``,
 * the shape that carries its name inside the pointer's own backticks, and ALL
 * FOUR ARE EXACTLY THIRTY LINES SHORT: the declarations are at `:660`, `:249`,
 * `:293` and `:421`, and `page.ts` gained thirty lines above them. Two of the
 * four are cited twice, so four entries cover six findings. NEITHER FILE IS THIS
 * CHECK'S TO REPAIR -- the pointers live in a plan and the symbols live under
 * `apps/admin/`, and the fence that widened the reader holds neither -- so they
 * are registered with the count derived here rather than repaired past a fence.
 * The register still SHRINKS ONLY: the day the plan is repointed each entry
 * matches nothing and becomes a finding of its own.
 *
 * TWO MORE ARRIVED WITH THE COMMA LIST (ADR-212), AND THEY WERE NEVER READ AT
 * ALL BEFORE IT. `` `scope.ts:555,564` `` and `` `scope.ts:525,530` `` are the
 * shape the tail expression did not match, so the WHOLE token fell through as
 * prose and neither number in either was ever resolved. Read now, all four
 * pointers are 200-plus lines out -- `ledgerTransactions` and `ledgerEntries`
 * are at `scope.ts:785` and `:776`, `planVersions` and `planVersionSizes` at
 * `:745` and `:750` -- and TWO of the four go green anyway, on the coincidence
 * this entry's own subject is about: `derived` sits at `:561` inside
 * `DerivedRule` and `firm` at `:532` inside a docblock, both within the window
 * of the pointer beside them. The two the window does catch are registered
 * here. THE ROWS ARE NOT REPAIRED AND THAT IS DELIBERATE: rows 164 and 168 are
 * other sessions' dated reservations, this register already holds three
 * entries out of the same file for the same reason, and amending another
 * session's row to repoint a pointer inside a restatement is a decision about
 * the ALLOCATION table rather than a citation repair.
 *
 * @type {readonly {file: string, cites: string, name: string | null}[]}
 */
const DOC_CITATIONS_OWNED_ELSEWHERE = [
  { file: 'docs/decisions/ALLOCATION.md', cites: 'scope.ts:555', name: 'derived' },
  { file: 'docs/decisions/ALLOCATION.md', cites: 'scope.ts:525', name: 'firm' },
  { file: 'docs/decisions/ALLOCATION.md', cites: 'routes/payouts.ts:395', name: 'ledger' },
  { file: 'docs/decisions/ALLOCATION.md', cites: 'routes/payouts.ts:395', name: 'LedgerTx' },
  { file: 'docs/decisions/ALLOCATION.md', cites: 'sweeps/ports.ts:219', name: 'systemDb' },
  { file: 'docs/plans/FOLD-01-phone-identity.md', cites: 'DECISIONS.md:483', name: null },
  {
    file: WAVE_06,
    cites: '../../apps/admin/src/page.ts:630',
    name: 'renderLiabilityHome',
  },
  {
    file: WAVE_06,
    cites: '../../apps/admin/src/page.ts:219',
    name: 'assertNamesNoSubject',
  },
  {
    file: WAVE_06,
    cites: '../../apps/admin/src/page.ts:263',
    name: 'assertFloatIsNotReserve',
  },
  {
    file: WAVE_06,
    cites: '../../apps/admin/src/page.ts:391',
    name: 'buildLiabilityHome',
  },
];

/**
 * One document with its generated spans and fenced blocks blanked, and the
 * record flag of every line. BLANKED RATHER THAN REMOVED so that a line number
 * still means what it means in the file somebody opens.
 *
 * @param {string} text
 * @returns {{body: string, inRecord: boolean[]}}
 */
function documentScope(text) {
  /** @type {(m: string) => string} */
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const body = text
    .replace(new RegExp(`<!--${'gen'}:[a-z0-9_]+-->.*?<!--/${'gen'}-->`, 'gs'), blank)
    .replace(/^(```+|~~~+)[\s\S]*?^\1.*$/gm, blank);
  /** @type {boolean[]} */
  const inRecord = [];
  let flag = false;
  for (const line of body.split('\n')) {
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading !== null && (heading[1] ?? '').length <= 2) flag = RECORD_HEADING.test(line);
    inRecord.push(flag);
  }
  return { body, inRecord };
}

/**
 * Whether a finding is one the register already names.
 *
 * @param {string} file
 * @param {string} cites
 * @param {string | null} name
 * @returns {boolean}
 */
function registeredDocCitation(file, cites, name) {
  return DOC_CITATIONS_OWNED_ELSEWHERE.some(
    (k) => k.file === file && k.cites === cites && k.name === name,
  );
}

/** @type {Invariant} */
const ri16 = {
  id: 'RI-16',
  title: 'No live document cites a line that does not hold the name beside it',
  covers:
    'every `file.ts:12` and `file.ts:12-34` citation in every tracked `.md` ' +
    'under docs/, plus the bare `:12` whose own markdown link names the file. ' +
    'THE SAME THREE THINGS RI-15 ASSERTS, through the same reader: the path ' +
    'resolves to a file in this tree, the file reaches the line, and a ' +
    'BACKTICKED NAME -- in front of the citation, or INSIDE ITS OWN BACKTICKS ' +
    'where a markdown link states the path, which is the order markdown ' +
    `actually writes -- appears within ${CITATION_WINDOW} ` +
    'lines of it, matched case-insensitively as a substring. THREE EXCLUSIONS, ' +
    'ALL BY SHAPE, ALL MEASURED on this branch on 2026-08-28. (1) A citation ' +
    'under a level-1 or level-2 heading naming a DATE or a SESSION is out of ' +
    'scope: 2,387 of the 3,055 path-bearing citations, and the rule is ' +
    "CI-06/derivable-counts' rather than this check's -- such an entry is a " +
    'record of a measurement made that day, and repairing it would rewrite the ' +
    'record to say something it did not say. It reaches INSIDE `docs/STATE.md`, ' +
    'a LIVE document that accumulates dated sections and that no directory rule ' +
    'could split. (2) A fenced block or a generated span, masked with CI-06s ' +
    'own two expressions. (3) A bare `:12` with NO path of its own and no link ' +
    'beside it: 1,414 citations. RI-15 lets such a pointer inherit the nearest ' +
    'path within 6 lines and names that as its miss (6); in THIS corpus ' +
    'inheritance adds 15 findings inside this scope and ALL FIFTEEN are the ' +
    'check guessing, because a bare pointer here is usually a REGISTRY ID: ' +
    '`M05:214` is a plan and a section line, `0011:49` is a migration, and ' +
    '`open_ct 17:00` is a clock. THE IN-TOKEN NAME OBEYS THAT SAME MEASUREMENT: ' +
    'a prefix that is a PATH names the file, a prefix the target basename ' +
    'BEGINS WITH names the file by this corpus nickname for it ' +
    '(``[`EVENTS:396`](../architecture/EVENTS.md)``), and a prefixed token ' +
    'whose path was INHERITED rather than stated is a registry shorthand in 41 ' +
    'of the 166 cases here and in 154 of 154 in RI-15s input. None of the three ' +
    'binds. WHAT IT DOES NOT CATCH. (1) The name half is STILL THIN and the ' +
    'number says so: 19 of the 668 citations in scope carry a bindable name, ' +
    'against 27 in `wiring.test.ts` alone, because markdown writes a citation ' +
    'alone in a table cell as readily as inside a link. The other 649 ' +
    'are checked for RESOLUTION AND RANGE only, which is the half that found ' +
    '`DECISIONS.md:483`. (2) A name written AFTER the pointer, in a SECOND ' +
    'backticked token, is not read; the in-token half reads the name inside the ' +
    'pointer and not one beside it. (3) A registry ' +
    'shorthand in a bare pointer is skipped rather than resolved; a table ' +
    'mapping `M05` and `0011` to files is the growth path. (4) Everything ' +
    'RI-15 lists about the window, the possessive, the negated claim and the ' +
    'range, since this reads the same grammar. (5) It never reads git history, ' +
    'so it cannot say whether a citation drifted or was false the day it was ' +
    `written. ${DOC_CITATIONS_OWNED_ELSEWHERE.length} citation(s) are ` +
    'REGISTERED in DOC_CITATIONS_OWNED_ELSEWHERE, each one a repair this gate ' +
    'is waiting for and none of them repairable here: four sit in documents ' +
    'whose frontmatter reads `status: approved` in a frozen corpus, where a ' +
    'change is an ADR rather than a commit; the four the in-token binding added ' +
    'point from a plan into `apps/admin/src/page.ts`, thirty lines short each, ' +
    'and the fence that widened this reader holds neither file. The register ' +
    'SHRINKS ONLY: an entry matching no finding on this ' +
    'ref is itself a finding, which is what separates a register from an ' +
    'exemption list.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const { tree, linesOf, candidates } = citationReader(root);
    const docs = tree.filter((f) => f.startsWith('docs/') && f.endsWith('.md'));
    if (docs.length === 0) {
      throw new Error(
        'RI-16 cannot run: no tracked `.md` under docs/. This check reads the corpus, so an ' +
          'empty scope is a walk that has stopped reaching it and not a clean tree',
      );
    }
    /** @type {Set<string>} */
    const raised = new Set();
    let scoped = 0;

    for (const rel of docs) {
      const { body, inRecord } = documentScope(read(root, rel));
      for (const c of citationsIn(body, false)) {
        if (inRecord[c.at - 1] === true) continue;
        scoped += 1;
        // A LINK NAMES ITS FILE OUTRIGHT, so it is resolved as a path from the
        // citing document: one file, rather than every file in the tree whose
        // name happens to end the same way.
        const found =
          c.href === null
            ? candidates(c.target)
            : [relative(root, resolve(dirname(join(root, rel)), c.href))].filter((f) =>
                existsSync(join(root, f)),
              );
        const key = `${rel} ${c.cited} ${c.name ?? ''}`;
        if (found.length === 0) {
          raised.add(key);
          if (registeredDocCitation(rel, c.cited, null)) continue;
          findings.push(
            `${rel}:${c.at}: cites \`${c.cited}\` and NO FILE IN THIS TREE has that path. ` +
              'A pointer nobody can follow reads as verified and is not',
          );
          continue;
        }
        const reachable = found.filter((f) => linesOf(f).length >= c.end);
        if (reachable.length === 0) {
          raised.add(key);
          if (registeredDocCitation(rel, c.cited, null)) continue;
          const shown = found[0] ?? c.target;
          findings.push(
            `${rel}:${c.at}: cites \`${c.cited}\` and ${shown} has ${linesOf(shown).length} lines. ` +
              'The pointer is past the end of the file it names',
          );
          continue;
        }
        if (c.name === null) continue;
        const hit = nearestName(reachable, linesOf, c.start, c.end, c.name.toLowerCase());
        if (hit !== null && hit.away <= CITATION_WINDOW) continue;
        raised.add(key);
        if (registeredDocCitation(rel, c.cited, c.name)) continue;
        const where =
          hit === null
            ? 'NOWHERE IN THAT FILE'
            : `at ${hit.file}:${hit.line}, ${hit.away} lines away`;
        findings.push(
          `${rel}:${c.at}: cites \`${c.cited}\` for \`${c.name}\` and \`${c.name}\` is ${where}. ` +
            'A citation in a corpus document is read by a founder at an E2 review and by every ' +
            'later session that treats the entry as settled, and neither of them opens the ' +
            'file. Repoint it, or say what the line does hold',
        );
      }
    }

    if (scoped === 0) {
      throw new Error(
        `RI-16 read ${docs.length} document(s) under docs/ and found NO citation in scope. ` +
          'This corpus argues in `file:line` pointers, so zero means the reader or the ' +
          'record-heading rule has stopped matching, and every drifted pointer in the tree ' +
          'would then pass for the wrong reason',
      );
    }

    // THE REGISTER SHRINKS ONLY, which is CI-06u's rule about its own. An entry
    // naming a citation that is no longer a finding is a repair that landed
    // without the register following it, and a register nobody has to maintain
    // is an exemption list that outlives its reason.
    for (const k of DOC_CITATIONS_OWNED_ELSEWHERE) {
      if (raised.has(`${k.file} ${k.cites} ${k.name ?? ''}`)) continue;
      findings.push(
        `${k.file}: the register claims \`${k.cites}\`${
          k.name === null ? '' : ` for \`${k.name}\``
        } is a known finding and it is not one on this ref. Either the repair landed and this ` +
          'entry goes, or the document moved and the entry moves with it. A register entry ' +
          'that names nothing exempts nothing and hides the next one',
      );
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-19  A clearing condition's terms are the same in the module and in the case
// -----------------------------------------------------------------------------
// SESSION 363 BUILT THE CLEARING-CONDITION PATTERN so that the day a blocker
// lifts, a case goes RED and NAMES it rather than the next session re-deriving
// everything from scratch. Five waves of work have run on it. IT HAS ONE FAILURE
// MODE AND THE FAILURE MODE FIRED: `B5`'s condition was stated TWICE, in
// `apps/api/src/admin-source/liability.ts` and in
// `apps/api/test/admin-source-liability.test.ts`, WITH TWO OF ITS THREE TERMS
// EACH, and no control compared them. The module named the stored `engine_gates`
// encoding and not the `| null`; the case named the `| null` and not the
// encoding. FOUR SESSIONS IN A ROW READ A TWO-TERM CONDITION off a three-term
// blocker, and each of the two statements was individually true.
//
// Session 392 repaired it by writing the condition ONCE, with all three terms,
// and asserting all three. THIS CHECK IS WHAT STOPS IT DRIFTING BACK. RI-15 and
// RI-16 exist because a `file:line` pointer drifts and no reader opens the file
// to notice; A CONDITION RESTATED IN TWO PLACES IS THAT SAME FAILURE ONE LEVEL
// UP, on the artefact every later session trusts to tell it what is still owed.
//
// IT IS A DERIVATION AND NOT A SECOND LIST, which is the trap RI-05's own
// `covers` calls "a hand-maintained count in a different costume" and which
// RI-04 actually fell into: it reported PASS while asserting nothing, because
// its literal held four names where the tree had five. This check stores no
// condition, no term, no blocker, no file and no count. It reads the module's
// own numbered enumeration AS the term set and asks the case whether it names
// each one. THE DAY A FOURTH TERM IS ADDED TO A MODULE, THIS CHECK IS ABOUT FOUR
// TERMS WITH NOBODY EDITING IT.
//
// WHAT A TERM IS, MECHANICALLY. This corpus writes code identifiers in
// backticks. A term's identifiers are the backtick spans inside its numbered
// item, split on everything an identifier cannot hold, so
// `eligible_next_7d: EligibleNext7d | null` is three of them. A term is NAMED in
// the restatement when the restatement carries an identifier DISTINCTIVE to that
// term, meaning one no sibling term carries. The distinctiveness is DERIVED from
// the enumeration rather than declared: `apps` sits in two of `B5`'s three terms
// and buys nothing, `engine_gates` sits in one and is the whole of what term 2
// is about.
//
// A TERM WITH NO DISTINCTIVE IDENTIFIER IS REPORTED RATHER THAN PASSED, on this
// file's rule 1. A term that shares every identifier with a sibling is a term
// this check cannot bind, and saying so is not the same as holding.
//
// WHY THE MODULE IS THE CANONICAL SIDE AND THE CASE RESTATES IT. That is session
// 392's own repair, in its words: the condition is written "ONCE, in the module,
// with all three terms", and the case asserts them. So the module's enumeration
// is the term set and the case is measured against it, in both directions: a
// term the case does not name is drift, and an identifier the case names that no
// term carries is drift the other way. BOTH DIRECTIONS ARE THE DEFECT THAT
// ACTUALLY HAPPENED, one each.
//
// WHY IT LIVES IN THIS FILE AND NOT BESIDE ITS SUBJECT. RI-17 sits in
// `apps/api/test/api-contract-coverage.test.ts` because it needs `@merit/api`
// and `fastify`, which `packages/tooling` cannot resolve. THIS CHECK NEEDS
// NEITHER: it reads source files as text, so it is a row of `CHECKS` and the
// runner reports 18.

/** The source set this check reads. `.json` and `.md` carry no `//` comment. */
const CLEARING_EXTENSIONS = /\.(?:ts|tsx|mts|mjs)$/;

/**
 * The DECLARING form. A statement that does not spell its own term count is not
 * one, which is the whole of how this check finds its subject without a list.
 * The count word is captured because it is a second statement of the same fact
 * sitting beside the enumeration, and RI-04's failure was exactly a count that
 * had stopped agreeing with what it counted.
 */
const CLEARING_MARKER = /CLEARING CONDITION\b[^`\n]{0,24}?\bALL\s+([A-Za-z]+)\s+TERMS\b/i;

/** Number words this check reads. Anything else is reported, never guessed. */
const TERM_COUNT_WORDS = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
]);

/** A numbered term opens an item. Continuation lines do not match. */
const TERM_ITEM = /^(\d+)\.\s+(.*)$/;

/**
 * The comment text of one line, or null when the line ends a statement: code, a
 * bare `//`, a bare `*`, or a block-comment terminator. A blank comment line is
 * a paragraph break in this corpus and is the natural end of a statement.
 *
 * @param {string} line
 * @returns {string | null}
 */
function commentBody(line) {
  const t = line.trim();
  if (t.startsWith('*/')) return null;
  /** @type {string | null} */
  let body = null;
  if (t.startsWith('///')) body = t.slice(3);
  else if (t.startsWith('//')) body = t.slice(2);
  else if (t.startsWith('/**')) body = t.slice(3);
  else if (t.startsWith('/*')) body = t.slice(2);
  else if (t.startsWith('*')) body = t.slice(1);
  if (body === null) return null;
  const trimmed = body.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Every identifier inside the backtick spans of `text`, keyed by its lower-cased
 * form and valued by the spelling the file actually wrote.
 *
 * SPLIT RATHER THAN TAKEN WHOLE, because a span is often a declaration and not a
 * name: `eligible_next_7d: EligibleNext7d | null` is one span and three
 * identifiers, and a restatement that writes only `eligible_next_7d` is naming
 * the same term. Tokens shorter than three characters and tokens opening with a
 * digit are dropped: `0015` and `199` are a migration and a section number
 * reached through `ADR-199`, and neither identifies a term.
 *
 * MATCHED CASE-INSENSITIVELY AND REPORTED AS WRITTEN. The comparison is folded
 * so a case restating `EngineGates` still names a term the module spells
 * `engineGates`, which is a difference in prose rather than in what is owed. The
 * SPELLING is carried alongside because a finding naming `enginegateresults` is
 * a finding a reader has to translate before they can grep for it.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function backtickIdentifiers(text) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    for (const token of (m[1] ?? '').split(/[^A-Za-z0-9_]+/)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(token)) continue;
      const key = token.toLowerCase();
      if (!out.has(key)) out.set(key, token);
    }
  }
  return out;
}

/**
 * The pair a file belongs to, and which side of it the file is.
 *
 * DERIVED FROM THE PATH, which is the objective's own grouping: a condition
 * "stated in code" and "the one stated in its test". `apps/api/src/admin-source/
 * liability.ts` and `apps/api/test/admin-source-liability.test.ts` are one pair
 * because this tree flattens the source directory into the test file name.
 *
 * @param {string} rel
 * @returns {{key: string, side: 'module' | 'case'} | null}
 */
function clearingPair(rel) {
  const src = /^(.*?)\/src\/(.+)\.[A-Za-z]+$/.exec(rel);
  if (src && src[1] !== undefined && src[2] !== undefined) {
    return { key: `${src[1]}::${src[2].replace(/\//g, '-')}`, side: 'module' };
  }
  const spec = /^(.*?)\/test\/(.+)\.test\.[A-Za-z]+$/.exec(rel);
  if (spec && spec[1] !== undefined && spec[2] !== undefined) {
    return { key: `${spec[1]}::${spec[2].replace(/\//g, '-')}`, side: 'case' };
  }
  return null;
}

/**
 * One clearing condition as its file states it.
 *
 * @typedef {object} ClearingStatement
 * @property {string} file
 * @property {number} line          1-based line of the declaring marker
 * @property {string} countWord     the word the statement spells its term count with
 * @property {number | null} count  that word as a number, null when unreadable
 * @property {string[]} terms       the text of each numbered item, in order
 * @property {string} text          the whole statement, one line
 */

/**
 * Every declaring statement in one file.
 *
 * @param {string} body
 * @param {string} rel
 * @returns {ClearingStatement[]}
 */
function clearingStatements(body, rel) {
  const lines = body.split('\n');
  /** @type {ClearingStatement[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const opening = commentBody(line);
    if (opening === null) continue;
    const marker = CLEARING_MARKER.exec(opening);
    if (!marker || marker[1] === undefined) continue;
    /** @type {string[]} */
    const parts = [];
    for (let j = i; j < lines.length; j += 1) {
      const part = commentBody(lines[j] ?? '');
      if (part === null) break;
      parts.push(part);
    }
    /** @type {string[]} */
    const terms = [];
    for (const part of parts) {
      const item = TERM_ITEM.exec(part);
      if (item && item[2] !== undefined) terms.push(item[2]);
      else if (terms.length > 0) terms[terms.length - 1] += ` ${part}`;
    }
    const countWord = marker[1];
    out.push({
      file: rel,
      line: i + 1,
      countWord,
      count: TERM_COUNT_WORDS.get(countWord.toLowerCase()) ?? null,
      terms,
      text: parts.join(' '),
    });
    i += parts.length - 1;
  }
  return out;
}

/**
 * Every `src/` module and `test/` case in `root` that declares a clearing
 * condition, grouped into pairs.
 *
 * EXPORTED SO A CASE CAN ASSERT THE SUBJECT RATHER THAN THE VERDICT. RI-04
 * reported PASS for three sessions while checking nothing, and "the run returned
 * an empty array" cannot tell those two apart. The suite reads this to say which
 * pair RI-19 is actually about on the real tree.
 *
 * @param {string} root
 * @returns {{pairs: Map<string, {module: ClearingStatement[], case: ClearingStatement[]}>, declared: number}}
 */
export function clearingConditionPairs(root) {
  /** @type {Map<string, {module: ClearingStatement[], case: ClearingStatement[]}>} */
  const pairs = new Map();
  let declared = 0;
  for (const rel of walk(root)) {
    if (!CLEARING_EXTENSIONS.test(rel)) continue;
    // THIS PACKAGE IS OUT OF SCOPE, on RI-15's measured reason for the same
    // exclusion: the statements in here are the GRAMMAR worked through in a
    // header and the SEEDS a suite plants, not claims about what this tree owes.
    // A check that read its own examples would report its own documentation.
    if (rel.startsWith(`${OWN_PACKAGE}/`)) continue;
    const pair = clearingPair(rel);
    if (pair === null) continue;
    const body = read(root, rel);
    if (!/CLEARING CONDITION/i.test(body)) continue;
    const statements = clearingStatements(body, rel);
    if (statements.length === 0) continue;
    declared += statements.length;
    const slot = pairs.get(pair.key) ?? { module: [], case: [] };
    slot[pair.side].push(...statements);
    pairs.set(pair.key, slot);
  }
  return { pairs, declared };
}

/** @type {Invariant} */
const ri19 = {
  id: 'RI-19',
  title: 'A clearing condition names the same terms in the module and in the case that restates it',
  covers:
    'every pair of clearing-condition statements that DECLARE THEIR OWN TERM ' +
    'COUNT (`CLEARING CONDITION, ALL THREE TERMS`), one in a `src/` module and ' +
    'one in the `test/` file whose name is that module path with its slashes ' +
    "flattened to dashes. THE TERM SET IS DERIVED FROM THE MODULE'S OWN " +
    'NUMBERED ENUMERATION and nothing about any condition is stored here, on ' +
    "RI-05's rule that a stored copy is a hand-maintained count in a different " +
    "costume and RI-04's demonstration that it goes stale in step. FOUR THINGS " +
    "ARE ASSERTED. (1) The module's spelled count equals the number of items it " +
    "enumerates. (2) The case's spelled count equals that same number. (3) Every " +
    'term of the module is NAMED in the case, where named means the case carries ' +
    'a backticked identifier DISTINCTIVE to that term, meaning one no sibling ' +
    'term carries; the distinctiveness is derived from the enumeration, so ' +
    '`apps` binds nothing on `B5` and `engine_gates` binds term 2. (4) Every ' +
    "backticked identifier in the case appears somewhere in the module's terms, " +
    'so the case cannot introduce a term the module does not carry. BOTH ' +
    'DIRECTIONS ARE THE DEFECT THAT HAPPENED, one each: the module named the ' +
    '`engine_gates` encoding and not the `| null`, the case named the `| null` ' +
    'and not the encoding, and no control compared them for four sessions. ' +
    'WHAT IT DOES NOT CATCH, and the list is the point rather than a caveat. ' +
    '(a) A RESTATEMENT THAT DOES NOT DECLARE ITS TERM COUNT IS INVISIBLE TO IT. ' +
    'The corpus states clearing conditions in many other forms (`RESTATED:`, ' +
    '`FIRED`, `UNCHANGED AND NOW HELD BY ONE BLOCKER`, a bare `it()` title) and ' +
    'this check reads none of them; it binds the form session 392 established ' +
    'and makes that form load-bearing. (b) A condition stated on only ONE side of ' +
    'a pair has nothing to compare and yields no finding. (c) A THIRD statement, ' +
    'in a file that is neither the module nor its name-derived test, is not in ' +
    'any pair. (d) IT READS IDENTIFIERS AND NOT PROSE, so a term whose MEANING ' +
    'drifts while its identifiers stay put passes: "`eligible_next_7d` gains its ' +
    '`| null`" and "`eligible_next_7d` loses its `| null`" are the same term to ' +
    'it. (e) The marker must sit on one line; a count wrapped across two comment ' +
    'lines is not found. (f) It does not ask whether a stated condition has a ' +
    'case at all, which is a convention beyond binding the two statements. ' +
    'A term with no distinctive identifier, a module that enumerates nothing, ' +
    'and a count word it cannot read are REPORTED rather than passed.',
  /** @type {(root: string) => string[]} */
  run: (root) => {
    const { pairs, declared } = clearingConditionPairs(root);

    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. Zero declarations
    // means the form this check binds has left the tree, and every restatement
    // in it would then be free to drift for the reason the check was written.
    if (declared === 0) {
      throw new Error(
        'RI-19 read the tree and found NO clearing condition declaring its own term count. ' +
          'The `CLEARING CONDITION, ALL <N> TERMS` form is the whole of how this check finds ' +
          'its subject, so zero means the convention has been dropped or reworded and every ' +
          'restatement in this tree is now unbound',
      );
    }

    /** @type {string[]} */
    const findings = [];
    for (const [key, slot] of [...pairs].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const [module] = slot.module;
      const [restatement] = slot.case;
      if (slot.module.length > 1 || slot.case.length > 1) {
        throw new Error(
          `${key.replace('::', '/')}: ${slot.module.length} declaring statement(s) in the ` +
            `module and ${slot.case.length} in the case. RI-19 pairs them BY FILE and cannot ` +
            'tell which restatement belongs to which condition once a file holds two. Give ' +
            'the statements a blocker label this check can group on, or it is guessing',
        );
      }
      if (module === undefined || restatement === undefined) continue;

      const where = `${module.file}:${module.line} and ${restatement.file}:${restatement.line}`;
      if (module.terms.length === 0) {
        findings.push(
          `${module.file}:${module.line}: declares ${module.countWord} terms and ENUMERATES ` +
            'NONE. RI-19 takes the numbered items as the term set, so a statement with no ' +
            `\`1.\` item binds nothing and ${restatement.file}:${restatement.line} is free to ` +
            'drift from it, which is the condition this check exists to refuse',
        );
        continue;
      }
      if (module.count === null) {
        findings.push(
          `${module.file}:${module.line}: spells its term count \`${module.countWord}\`, which ` +
            'is not a number word RI-19 reads. A count it cannot read is a count it cannot ' +
            'compare against the ' +
            `${module.terms.length} item(s) enumerated below it`,
        );
      } else if (module.count !== module.terms.length) {
        findings.push(
          `${module.file}:${module.line}: says ALL ${module.countWord.toUpperCase()} TERMS and ` +
            `enumerates ${module.terms.length}. That is RI-04's own failure on the condition ` +
            'itself: a count that has stopped agreeing with what it counts, in the sentence ' +
            'every later session reads to learn what is still owed',
        );
      }
      if (restatement.count === null) {
        findings.push(
          `${restatement.file}:${restatement.line}: spells its term count ` +
            `\`${restatement.countWord}\`, which is not a number word RI-19 reads`,
        );
      } else if (restatement.count !== module.terms.length) {
        findings.push(
          `${restatement.file}:${restatement.line}: says ALL ` +
            `${restatement.countWord.toUpperCase()} TERMS where ${module.file}:${module.line} ` +
            `enumerates ${module.terms.length}. The two statements of one condition disagree ` +
            'about how many terms it has, which is exactly the shape that let four sessions ' +
            'read a two-term condition off a three-term blocker',
        );
      }

      const perTerm = module.terms.map((t) => backtickIdentifiers(t));
      /** @type {Map<string, number>} */
      const carriers = new Map();
      for (const tokens of perTerm) {
        for (const key of tokens.keys()) carriers.set(key, (carriers.get(key) ?? 0) + 1);
      }
      const restated = backtickIdentifiers(restatement.text);

      if (carriers.size === 0) {
        findings.push(
          `${module.file}:${module.line}: enumerates ${module.terms.length} term(s) and NOT ONE ` +
            'of them backticks an identifier. This corpus names code in backticks and RI-19 ' +
            'binds on those names, so this condition is asserting nothing about ' +
            `${restatement.file}:${restatement.line}`,
        );
        continue;
      }

      for (let t = 0; t < perTerm.length; t += 1) {
        const tokens = perTerm[t] ?? new Map();
        const distinctive = [...tokens.keys()].filter((k) => carriers.get(k) === 1).sort();
        if (distinctive.length === 0) {
          findings.push(
            `${module.file}:${module.line}: term ${t + 1} shares every identifier it names with ` +
              'another term of the same condition, so RI-19 cannot tell whether ' +
              `${restatement.file}:${restatement.line} names it. Give the term one identifier ` +
              'of its own. A check never returns PASS for something it did not look at',
          );
          continue;
        }
        if (distinctive.some((k) => restated.has(k))) continue;
        const named = distinctive.map((k) => tokens.get(k) ?? k);
        findings.push(
          `${where}: term ${t + 1} of the condition is stated in the module and NAMED NOWHERE ` +
            `IN THE CASE. It is identified by \`${named.join('`, `')}\` and the ` +
            'restatement carries none of them. TWO STATEMENTS OF ONE CONDITION, EACH ' +
            'INDIVIDUALLY TRUE, IS TWO CONDITIONS: this is how `B5` was read as a two-term ' +
            'blocker for four sessions. Restate the term or point the case at the module',
        );
      }

      for (const key of [...restated.keys()].sort()) {
        if (carriers.has(key)) continue;
        findings.push(
          `${where}: the case names \`${restated.get(key) ?? key}\` inside its clearing ` +
            'condition and NO TERM OF ' +
            'THE MODULE CARRIES IT. Either the case is holding a term the module dropped, ' +
            'which is the drift that actually happened on `B5` in this direction, or it is ' +
            'prose that reads as a term. The condition is stated ONCE, in the module',
        );
      }
    }
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-20  A reason that quotes a command and states its result is RUN
// -----------------------------------------------------------------------------
//
// WHAT HAPPENED, AND IT IS THE SAME FILE RI-14 WAS WRITTEN FOR, ONE CLASS OVER.
// `wiring.test.ts`'s `usePayoutBackend` entry read "`grep -rn lifetime_settled
// packages/db/migrations` returns nothing at all". `0065` landed the three
// columns and session 400 landed the writer, and the entry's OWN CITED GREP now
// returns SEVEN lines. Every gate stayed green, because RI-14 reads EXPORTS and
// a migration COLUMN is not an export. That is not a bug in RI-14; it is a
// boundary nobody had drawn.
//
// THE RULING THIS CHECK IMPLEMENTS IS ADR-214'S, AND IT WAS DERIVED BY RUNNING
// THE ALTERNATIVES RATHER THAN BY ARGUING THEM. Four candidates were measured
// over this tree before one was written:
//
//   C1  RI-14's existing claim shapes, with the name set widened from exports to
//       the 1,088 schema objects the 62 migrations declare.
//       MEASURED: 0 sites in RI-14's three files, 0 across 280 shipped `.ts`.
//       THE PARAMETER EVERYBODY WOULD HAVE CHANGED FIRST MOVES NOTHING, which is
//       ADR-212's finding arriving on a different check. The false sentence does
//       not wear any of RI-14's four shapes.
//   C3  New absence phrasings over declared schema names -- `is absent`,
//       `no column`, `declares no`.
//       MEASURED: 0 sites in RI-14's three files, 26 across shipped `.ts`, of
//       which ONE is a real defect and 25 are honest sentences. `events` is
//       absent from a REGISTRY, `name` from a RESPONSE, `route` is a file stem.
//       The word "absent" does not mean "not in the schema", and no discriminator
//       over prose recovers that.
//   C4  Any backticked snake_case token in a sentence carrying a negation.
//       MEASURED: 13 sites in RI-14's three files ALONE, every one honest.
//   C2  A quoted command with a stated result is EXECUTED.
//       MEASURED: 1 site in RI-14's three files, and it is exactly the false
//       sentence. 0 honest sentences moved.
//
// SO THE RULE IS NOT "RECOGNISE THE COLUMN NAME", WHICH IS UNDECIDABLE OVER
// PROSE AND WAS MEASURED TO BE. THE RULE IS THAT A REASON WANTING TO CLAIM A
// SCHEMA FACT SUPPLIES ITS OWN DECISION PROCEDURE, AND THE RUNNER RUNS IT. The
// burden lands on the sentence making the claim rather than on every sentence
// that is not making one, which is why this check turns no honest prose red.
//
// WHAT IT DOES NOT CATCH, stated rather than left to be discovered.
//   (1) It reads only `grep`. A reason quoting any other command is a FINDING
//       and not a skip, because a check evadable by writing `rg` instead is not
//       a check. Widening the vocabulary is a ruling, not an edit.
//   (2) It executes NOTHING through a shell. The command is tokenised here and
//       run with `execFileSync`, and any shell metacharacter, glob character,
//       absolute path or `..` segment makes the claim UNSETTLEABLE, which is a
//       finding. A reason that needs a regex pattern must state its claim in a
//       form a runner can settle, or not state it.
//   (3) It reads the same three files RI-14 reads, for RI-14's measured reason
//       and one of its own: `docs/` carries 26 more command claims, and several
//       are TIME-STAMPED history -- ADR-211's row 19 says "at this commit" and
//       names `0064` as the last migration. A document may honestly record what
//       a command returned in the past; a live source comment may not. Reaching
//       docs needs an "as at commit X" exemption this check does not have, and
//       that is RI-16's territory.
//   (4) It reads the COUNT of matching lines and never their content, so a
//       command returning the right number of the wrong lines passes.
//
// SESSION 410 ADDED THE TWO AUTH FILES, AND THE CLASS THEY BRING IS A COUNT
// RATHER THAN AN EXISTENCE CLAIM. `databaseAuthBackend`'s wiring partition was
// restated in TWELVE live source comments across `apps/api`; ELEVEN of them were
// stale, four inside `auth-backend.ts` alone and two inside the very suite that
// asserts the true number. Every gate was green, because a bare numeral in prose
// is a claim no runner can settle: measured over this tree, a numeral-word
// beside a refusal noun moves 902 sites across 585 shipped `.ts`/`.tsx` files,
// and 34 in the three auth files alone of which 27 are honest -- "One refusal
// is", "TWO INDEPENDENT REFUSALS", "One method per endpoint". THE RULE IS
// THEREFORE ADR-214'S, UNCHANGED AND ONE CLASS OVER: a sentence wanting to state
// a count supplies the command that settles it, and the runner runs it. Nothing
// here recognises a numeral.
//
// WIDENING RI-14'S OWN LIST TO THESE FILES MOVES 0 SITES, which is ADR-212's and
// ADR-214's finding a third time: the parameter everybody would change first
// buys nothing. So SOURCED_CLAIM_FILES is unchanged and this check gets its own
// list, which is also the honest shape -- the two checks read the same files
// today by history rather than by principle.
//
// AND THE WHOLE TREE IS REFUSED ON A MEASUREMENT RATHER THAN ON TASTE. This
// grammar over all 585 shipped `.ts`/`.tsx` moves 18 sites, of which 12 are the
// SEEDED FIXTURES in this package's own suite -- a check that executes its own
// negative controls is red on landing -- and 4 are prose the grammar mistakes
// for a command, `col = NULL` in `scoped-db.ts` "matches nothing" and a
// `tradingDay` error message in `recon/sweep.ts` likewise. The 2 that remain are
// true live claims in `apps/portal` and `apps/worker`, and they are registered
// in session 410's log rather than reached for here.
const COMMAND_CLAIM_FILES = [
  ...SOURCED_CLAIM_FILES,
  // THE PORT AND ITS BACKEND, AND EACH ONE CARRIES THE CLAIM ABOUT THE OTHER.
  // A claim that greps the file it is written in matches itself, so the refusal
  // count lives in `routes/auth.ts` and greps `auth-backend.ts`, and the port's
  // size lives in `auth-backend.ts` and greps `routes/auth.ts`. Neither file can
  // satisfy its own sentence.
  'apps/api/src/auth-backend.ts',
  'apps/api/src/routes/auth.ts',
];

/**
 * A quoted command and the result the sentence claims for it, on a two-line
 * window so a wrapped string literal does not blind the reader.
 */
const COMMAND_CLAIM =
  /`([a-z][a-z0-9-]* [^`\n]{2,180})`([^.`\n]{0,60}?)\b(?:returns|matches|finds|reports) (nothing(?: at all)?|no lines|(\d+) lines?)\b/gi;

/** Characters that would mean something to a shell, a glob, or a regex engine. */
const UNSAFE_IN_COMMAND = /[;|&$><()`\\!*?[\]{}~\n]/;

/**
 * The command as an argv a runner can execute without a shell, or `null` when
 * no such argv exists.
 * @param {string} command
 * @returns {readonly string[] | null}
 */
function commandArgv(command) {
  if (UNSAFE_IN_COMMAND.test(command)) return null;
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const argv = parts.map((p) => (/^["']/.test(p) ? p.slice(1, -1) : p));
  if (argv.length < 2) return null;
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (arg.startsWith('/') || arg.split('/').includes('..')) return null;
  }
  return argv;
}

/** @type {Invariant} */
const ri20 = {
  id: 'RI-20',
  title:
    'A reason that quotes a command and states its result is run, and the result is what it says',
  covers:
    'the reason text in ' +
    COMMAND_CLAIM_FILES.join(', ') +
    '. A claim is in scope when a BACKTICKED COMMAND is followed, within sixty ' +
    'characters and across at most a two-line window, by `returns`, `matches`, ' +
    '`finds` or `reports` and then either `nothing`, `no lines`, or a DIGIT ' +
    'followed by `line`/`lines`. The command is tokenised and executed with no ' +
    'shell, and the claim FAILS when the number of non-empty output lines is not ' +
    'the number the sentence states. THIS IS THE HALF RI-14 STRUCTURALLY CANNOT ' +
    'READ: RI-14 settles a non-existence claim about a named EXPORT, and a ' +
    'migration COLUMN is not an export, so `lifetime_settled_cents` was outside ' +
    'every gate in the tree while the entry asserting its absence was read by ' +
    'every later session. WHY THE RULE IS A DECISION PROCEDURE RATHER THAN A ' +
    'NAME MATCHER, and it was measured rather than assumed (ADR-214): widening ' +
    "RI-14's name set to the 1,088 schema objects the migrations declare moves 0 " +
    'sites in these three files and 0 across 280 shipped `.ts`; absence ' +
    'phrasings over declared schema names move 26 sites of which 25 are honest ' +
    'sentences, because `absent` means absent from a REGISTRY or a RESPONSE far ' +
    'more often than from the schema; a backticked snake_case token near a ' +
    'negation moves 13 sites in these three files alone, all honest. Executing ' +
    'the quoted command moves exactly 1, and it is the defect. WHAT IT DOES NOT ' +
    'CATCH. (1) Only `grep` is executable; any other command is a FINDING rather ' +
    'than a skip, because a check evadable by writing `rg` is not a check. (2) ' +
    'Nothing runs through a shell: a shell metacharacter, a glob character, an ' +
    'absolute path or a `..` segment makes the claim UNSETTLEABLE, which is a ' +
    'finding. A reason needing a regex states its claim in a settleable form or ' +
    'does not state it. (3) It reads these three files and not `docs/`, which ' +
    'carries 26 more command claims of which several are TIME-STAMPED history: ' +
    'ADR-211 row 19 says "at this commit" and names `0064` as the last ' +
    'migration. A document may honestly record what a command returned in the ' +
    'past and a live source comment may not, and the exemption that needs is ' +
    "RI-16's. (4) It reads the COUNT of matching lines and never their " +
    'content. THE TWO AUTH FILES JOINED THE LIST IN SESSION 410 AND THE CLASS ' +
    'THEY BRING IS A COUNT rather than an existence claim: the wiring partition ' +
    'of `databaseAuthBackend` was restated in twelve live source comments and ' +
    'eleven were stale, four in one file and two in the suite asserting the ' +
    'true number, with every gate green. A BARE NUMERAL IS UNSETTLEABLE AND ' +
    'THAT WAS MEASURED RATHER THAN ASSUMED: a numeral-word beside a refusal ' +
    'noun moves 902 sites across 585 shipped `.ts`/`.tsx` and 34 in the three ' +
    'auth files alone, of which 27 are honest. So the rule stays ADR-214 clause ' +
    '3, the sentence supplies the command. Widening `RI-14` to these files ' +
    'moves 0 sites, which is why that list is unchanged and this check has its ' +
    'own; widening THIS grammar to the whole tree moves 18, of which 12 are ' +
    "this package's own seeded fixtures. A CLAIM MUST NOT BE ABLE TO SATISFY " +
    'ITSELF: a grep over the file the sentence is written in matches the ' +
    'sentence, so each of the two auth files states the half that lives in the ' +
    'other one.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
    let sites = 0;
    for (const rel of COMMAND_CLAIM_FILES) {
      const abs = join(root, rel);
      if (!existsSync(abs)) {
        findings.push(
          `${rel} does not exist. This check names the files whose REASONS it reads, ` +
            `so a rename silently empties it; point it at the new path`,
        );
        continue;
      }
      const lines = readFileSync(abs, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        // THE STRING FURNITURE IS REMOVED RATHER THAN MATCHED AROUND. These
        // reasons are JS string literals concatenated with `' +`, so a claim
        // wraps mid-sentence; joining the pair back into the prose the author
        // wrote is what makes the window read one sentence instead of two
        // halves of one.
        const head = (lines[i] ?? '').replace(/['"]\s*\+\s*$/, '');
        const tail = (lines[i + 1] ?? '').replace(/^\s*['"]/, '');
        const window = head + tail;
        COMMAND_CLAIM.lastIndex = 0;
        for (const m of window.matchAll(COMMAND_CLAIM)) {
          // ATTRIBUTE EACH MATCH TO EXACTLY ONE WINDOW. A claim sitting wholly
          // inside line i is visible from window i-1 as well, and counting it
          // twice would make the site total a number about this loop rather
          // than about the file.
          if ((m.index ?? 0) >= head.length) continue;
          sites += 1;
          const command = m[1] ?? '';
          const stated = m[4] === undefined ? 0 : Number(m[4]);
          const where = `${rel}:${i + 1}`;
          const argv = commandArgv(command);
          if (argv === null) {
            findings.push(
              `${where}: the reason states a result for \`${command}\` and the runner cannot ` +
                `settle it. A command is executed with NO SHELL, so a shell metacharacter, a ` +
                `glob character, an absolute path or a \`..\` segment leaves the claim ` +
                `unsettleable. State it in a form a runner can settle, or do not state it`,
            );
            continue;
          }
          if (argv[0] !== 'grep') {
            findings.push(
              `${where}: the reason states a result for \`${argv[0]}\`, and only \`grep\` is ` +
                `executable here. This is a FINDING rather than a skip on purpose: a check a ` +
                `later author evades by writing a different command name is not a check. ` +
                `Widening the vocabulary is a ruling`,
            );
            continue;
          }
          /** @type {string} */
          let out;
          try {
            out = execFileSync(argv[0], argv.slice(1), {
              cwd: root,
              encoding: 'utf8',
              timeout: 30_000,
              maxBuffer: 16 * 1024 * 1024,
            });
          } catch (err) {
            // grep exits 1 for "no match", which IS a result. Anything else --
            // a path that no longer exists, most often -- is a claim about a
            // tree this one is not.
            const status = /** @type {{ status?: number; stdout?: string }} */ (err).status;
            if (status === 1) out = '';
            else {
              findings.push(
                `${where}: \`${command}\` exited ${String(status)} rather than returning a ` +
                  `result, so the sentence states an outcome for a command this tree cannot ` +
                  `run. A path it names has usually moved`,
              );
              continue;
            }
          }
          const actual = out.split('\n').filter((l) => l !== '').length;
          if (actual === stated) continue;
          findings.push(
            `${where}: the reason says \`${command}\` ${m[4] === undefined ? 'returns nothing' : `returns ${String(stated)} line(s)`} ` +
              `and it returns ${String(actual)}. THE SENTENCE QUOTES ITS OWN DECISION ` +
              `PROCEDURE AND NOBODY RAN IT: this is how \`usePayoutBackend\` told every later ` +
              `session that no migration could store a \`RuleState\` for a full night after ` +
              `\`0065\` landed all three columns. Open the file: either the claim is wrong and ` +
              `the reason is rewritten with the surviving one, or it was true when written and ` +
              `the block says so`,
          );
        }
      }
    }
    if (sites === 0 && findings.length === 0)
      throw new Error(
        'RI-20 read ' +
          `${COMMAND_CLAIM_FILES.length} file(s) and found NO command claim in any of them. ` +
          'This check exists because a reason quoted a command and nobody ran it, so a run ' +
          'that settles nothing is not a pass',
      );
    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-21  The `.env` ignore RULE holds, asked of git rather than read off a line
// -----------------------------------------------------------------------------
//
// WHAT HAPPENED. `INFRA:145` stated ".env files are gitignored and CI verifies
// it rather than trusting it (VG-1)" and BOTH HALVES WERE FALSE for as long as
// the sentence existed. `.gitignore` is the only one in this repository and it
// carried no `.env` entry at all: its sole `env` matches were `.venv/` and
// `next-env.d.ts`, and `git check-ignore -v .env` exited 1, so the file was not
// ignored. And `VG-1` is gitleaks, which reads FILE CONTENT for secret-shaped
// strings and reads no `.gitignore` at any point: a `DATABASE_URL`, a vendor
// base URL or a bucket name is not secret-shaped, so the one control the
// sentence named would have passed the commit it claimed to refuse. ADR-224.
//
// WHY THIS CHECK RUNS A COMMAND INSTEAD OF GREPPING `.gitignore` FOR A STRING,
// which is the whole reason the number was spent. The entry in `.gitignore` is
// NOT the deliverable. Anybody can delete three lines, and a check that greps
// for `.env` would then be asserting that a line exists rather than that
// anything is ignored -- and, worse, would keep passing after a later `!.env`
// or a `.gitignore` in a subdirectory reversed the rule several lines down. A
// GREP FOR A PATTERN IS NOT A TEST THAT THE PATTERN MATCHES. So the subject of
// this check is the RULE: it hands git a list of representative paths and reads
// back what git says about each one, which is the same question a `git add`
// asks.
//
// THE BOUNDARY THAT MADE IT POSSIBLE HERE AND NOT IN `RI-17`'s HOME. `Invariant.run`
// is synchronous and `execFileSync` is already imported by RI-20, so a check in
// this file can execute a command. RI-17 could not be written here because
// `packages/tooling` resolves neither `@merit/api` nor `fastify` and
// `discoverRouteModules` is async; neither disqualifier reaches `git`.
//
// TWO LEGS, BECAUSE AN IGNORE RULE DOES NOT REACH A FILE THAT IS ALREADY
// TRACKED. Git applies `.gitignore` to UNTRACKED paths only, so a `.env`
// committed before the rule landed stays in the tree, stays in every clone and
// stays in the history, with the rule above it reading green forever. Leg 2 is
// one `git ls-files` and it closes that.
//
// IT IS NOT A SECRETS SCANNER AND MUST NOT BECOME ONE. It reads no file content
// anywhere. `CI-05` already runs gitleaks twice (VG-1, history and working
// tree), semgrep, `pnpm audit` and syft/grype, none of them with
// `continue-on-error`; a sixth scanner here would be a second copy of a control
// rather than a control. The property this check owns is the one none of those
// five reads: what git will do with a path that does not exist yet.
//
// WHAT IT DOES NOT CATCH, stated rather than left to be discovered.
//   (1) It reads the RULE and never the working tree, so it says nothing about
//       whether a `.env` exists on somebody's disk right now. That is the
//       correct scope: an ignored file that exists is the system working.
//   (2) `--no-index` is passed deliberately, so leg 1 answers a question about
//       PATTERNS alone. Without it, git reports a tracked path as not-ignored,
//       and a committed `.env.example` would then satisfy the "not ignored"
//       assertion for the wrong reason. Leg 2 asks the tracking question
//       separately and on purpose.
//   (3) The population is a LIST OF SPELLINGS and not the set of all strings.
//       A file named `env.production` with no leading dot, or `secrets.txt`, is
//       outside the rule this check asserts and outside the rule `.gitignore`
//       states. Widening either is a ruling.
//   (4) `.envrc` is asserted NOT ignored, which is direnv's file and is a
//       decision ADR-224 records rather than an omission. Nothing in this
//       repository uses direnv.
//   (5) It reads whether a path is ignored and never whether a `.env` is
//       SAFE. Content is `VG-1`'s and stays there.

/**
 * The paths RI-21 asks git about, and what the rule must say about each.
 *
 * EVERY MEMBER IS HERE FOR A SPELLING THAT A NEIGHBOURING PATTERN DOES NOT
 * COVER, which is the difference between a population and a list somebody
 * lengthened until it looked thorough. `.env` does not match `.env.local`;
 * `*.env` does not match `.env`; a leading-slash `/.env` does not match
 * `apps/api/.env`. Each row names the pattern it would survive the deletion of.
 *
 * @type {{ path: string; ignored: boolean; why: string }[]}
 */
export const ENV_IGNORE_SUBJECTS = [
  {
    path: '.env',
    ignored: true,
    why: 'the plain spelling at the root, and the one `git check-ignore -v .env` exited 1 for',
  },
  {
    path: '.env.local',
    ignored: true,
    why: "dotenv's local override, which a `.env` pattern alone does NOT match",
  },
  {
    path: '.env.production',
    ignored: true,
    why: 'a named environment, the spelling a deploy README tells somebody to create',
  },
  {
    path: '.env.production.local',
    ignored: true,
    why: 'the two-suffix spelling, which a `.env.?*` shape narrower than `.env.*` would miss',
  },
  {
    path: '.env.test',
    ignored: true,
    why: 'the test environment, the one a fixture author reaches for first',
  },
  {
    path: 'apps/api/.env',
    ignored: true,
    why: 'the per-package file. A root-anchored `/.env` would leave this uncovered',
  },
  {
    path: 'apps/api/.env.local',
    ignored: true,
    why: 'depth AND suffix together, which is the pair no single pattern of the three covers alone',
  },
  {
    path: 'packages/db/.env',
    ignored: true,
    why: 'a second directory at a different depth, so the rule is not one path in disguise',
  },
  {
    path: 'apps/portal/.env.development.local',
    ignored: true,
    why: 'depth and two suffixes, the deepest spelling any of this workspace tooling documents',
  },
  {
    path: '.env.example',
    ignored: false,
    why: 'THE ONE EXCEPTION. A committed template carries names and never values, and a rule that ignored it would make every developer invent the variable list',
  },
  {
    path: 'apps/api/.env.example',
    ignored: false,
    why: 'the exception AT DEPTH, so the negation is a basename rule rather than a root-only one',
  },
  {
    path: '.envrc',
    ignored: false,
    why: "direnv's file, deliberately outside the rule (ADR-224). Asserting it is the difference between a decision and an oversight",
  },
  {
    path: 'apps/site/src/environment.ts',
    ignored: false,
    why: 'A CONTROL. A source file whose basename starts with `env`, which a `.env*` or `*env*` pattern would swallow along with the tree',
  },
  {
    path: 'docs/architecture/INFRA.md',
    ignored: false,
    why: 'A SECOND CONTROL, and it is the document the false sentence lived in. A pattern set wide enough to ignore this is a pattern set that ignores the corpus',
  },
];

/** A tracked path whose basename is a `.env` spelling this rule refuses. */
const trackedEnvSpelling = (/** @type {string} */ p) => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base === '.env.example') return false;
  return base === '.env' || base.startsWith('.env.');
};

/** @type {Invariant} */
const ri21 = {
  id: 'RI-21',
  title: 'git ignores every .env spelling and does not ignore the committed example',
  covers:
    'the `.env` ignore RULE, asked of `git check-ignore --no-index` over ' +
    `${String(ENV_IGNORE_SUBJECTS.length)} representative paths read live from ` +
    '`ENV_IGNORE_SUBJECTS`, plus a second leg over `git ls-files`. THE `.gitignore` ' +
    'ENTRY IS NOT WHAT THIS CHECKS AND THAT IS THE POINT: a grep for `.env` in ' +
    'that file asserts a line exists, which is not the same claim as the rule ' +
    'matching, and it would keep passing after a later negation or a ' +
    'subdirectory `.gitignore` reversed the rule. `INFRA:145` claimed for ' +
    'months that this rule existed and that `VG-1` verified it, and BOTH ' +
    'HALVES WERE FALSE: `.gitignore` carried no `.env` entry, `git ' +
    'check-ignore -v .env` exited 1, and gitleaks reads file CONTENT for ' +
    'secret-shaped strings and reads no `.gitignore`, so a `DATABASE_URL` or a ' +
    'vendor base URL would have passed the one control the sentence named ' +
    '(ADR-224). LEG 1 asserts what the rule says: nine spellings ignored, ' +
    'five not, each row naming the pattern whose deletion it would survive. ' +
    'For an expected-ignored path the MATCHING SOURCE must be this ' +
    "repository's own `.gitignore` and the matching pattern must mention " +
    '`env`, so a global excludes file, a `.git/info/exclude` or a `*` ' +
    'catch-all cannot make this check green. LEG 2 asserts that no `.env` ' +
    'spelling is TRACKED, because git applies an ignore rule to untracked ' +
    'paths only: a `.env` committed before the rule landed stays in every ' +
    'clone and in the history with the rule above it reading green forever. ' +
    'IT IS NOT A SECRETS SCANNER AND READS NO FILE CONTENT ANYWHERE. `CI-05` ' +
    'already runs gitleaks twice, semgrep, `pnpm audit` and syft/grype with ' +
    'no `continue-on-error` in the workflow at all; the property this check ' +
    'owns is the one none of those five reads, which is what git will do with ' +
    'a path that does not exist yet. WHAT IT DOES NOT CATCH. (1) It reads the ' +
    'RULE and never the working tree, so an ignored `.env` on somebody s disk ' +
    'is outside it and correctly so. (2) `--no-index` is deliberate, so leg 1 ' +
    'is about PATTERNS alone; without it a tracked path reports as not-ignored ' +
    'and a committed `.env.example` would satisfy its assertion for the wrong ' +
    'reason. (3) The population is a list of SPELLINGS: `env.production` with ' +
    'no leading dot, or `secrets.txt`, is outside this rule and outside the ' +
    'one `.gitignore` states, and widening either is a ruling. (4) `.envrc` is ' +
    'asserted NOT ignored, which is direnv s file and a decision ADR-224 ' +
    'records. (5) Whether a `.env` is SAFE is content, which is `VG-1`s and ' +
    'stays there.',
  run(root) {
    /** @type {string[]} */
    const findings = [];

    if (!ENV_IGNORE_SUBJECTS.some((s) => s.ignored))
      throw new Error(
        'RI-21 has no path it expects to be IGNORED, so leg 1 would pass over a ' +
          'repository with an empty `.gitignore`. A check that asserts nothing is not a ' +
          'check that passed',
      );

    // LEG 1. WHAT THE RULE SAYS, ASKED OF GIT.
    //
    // `-n` prints the non-matching paths too, so every subject comes back on a
    // line of its own and a path git says nothing about is distinguishable from
    // one it did not see. `-v` carries the SOURCE and the PATTERN, which is what
    // lets the ignored direction refuse a match that came from somewhere other
    // than this repository's own `.gitignore`.
    /** @type {string} */
    let out;
    try {
      out = execFileSync('git', ['check-ignore', '--no-index', '-v', '-n', '--stdin'], {
        cwd: root,
        input: ENV_IGNORE_SUBJECTS.map((s) => s.path).join('\n') + '\n',
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (err) {
      const e = /** @type {{ status?: number; stdout?: string }} */ (err);
      // Exit 1 means NO path in the list is ignored, which is a result and is
      // the exact state this check was written to catch. Anything else -- no
      // `git` on the PATH, a root that is not a work tree -- means the question
      // was never asked, and a check that cannot run is not a check that passed.
      if (e.status === 1 && typeof e.stdout === 'string') out = e.stdout;
      else
        throw new Error(
          `RI-21 could not ask git about the ignore rule (\`git check-ignore\` exited ` +
            `${String(e.status)} in ${root}). This check's whole subject is what git says, ` +
            `so an unanswerable question is an ERROR rather than a pass`,
          { cause: err },
        );
    }

    /** @type {Map<string, { source: string; pattern: string } | null>} */
    const verdict = new Map();
    for (const line of out.split('\n')) {
      if (line === '') continue;
      const tab = line.indexOf('\t');
      if (tab === -1) continue;
      const rule = line.slice(0, tab);
      const path = line.slice(tab + 1);
      if (rule === '::') {
        verdict.set(path, null);
        continue;
      }
      // `<source>:<linenum>:<pattern>`, and the source is matched NON-GREEDILY
      // so a pattern carrying a colon stays in the pattern.
      const m = /^(.*?):(\d+):(.*)$/.exec(rule);
      verdict.set(
        path,
        m === null ? { source: rule, pattern: '' } : { source: m[1] ?? '', pattern: m[3] ?? '' },
      );
    }

    for (const subject of ENV_IGNORE_SUBJECTS) {
      if (!verdict.has(subject.path)) {
        findings.push(
          `git said nothing at all about \`${subject.path}\`, which this check hands it on ` +
            `stdin and expects a line back for. The runner read ${String(verdict.size)} verdict(s) ` +
            `for ${String(ENV_IGNORE_SUBJECTS.length)} path(s)`,
        );
        continue;
      }
      const matched = verdict.get(subject.path) ?? null;
      // A NEGATION IS A MATCH THAT MEANS NOT-IGNORED. `git check-ignore -v`
      // reports `!.env.example` as the rule for `.env.example`, so reading "a
      // rule matched" as "ignored" would invert exactly the exception this rule
      // exists to carve out.
      const negated = matched !== null && matched.pattern.startsWith('!');
      const isIgnored = matched !== null && !negated;

      if (subject.ignored && !isIgnored) {
        findings.push(
          `\`${subject.path}\` IS NOT IGNORED and the rule says it must be (${subject.why}). ` +
            (matched === null
              ? 'No pattern in this repository matches it at all'
              : `The nearest rule is \`${matched.pattern}\` at ${matched.source}, which re-includes it`) +
            `. This is the state \`INFRA:145\` asserted was impossible while it held for every ` +
            `\`.env\` spelling in the tree; a value written here would be staged by a bare ` +
            `\`git add -A\` and caught only if gitleaks recognised its SHAPE`,
        );
        continue;
      }
      if (subject.ignored && matched !== null) {
        // THE RULE MUST BE THIS REPOSITORY'S OWN AND MUST BE ABOUT `env`. A
        // developer's global excludes file, a `.git/info/exclude`, or a `*`
        // catch-all several lines down would otherwise turn this check green on
        // a repository whose `.gitignore` says nothing at all.
        if (matched.source !== '.gitignore')
          findings.push(
            `\`${subject.path}\` is ignored by \`${matched.pattern}\` at ${matched.source}, which ` +
              `is not this repository's own \`.gitignore\`. A rule that lives in a global ` +
              `excludes file or in \`.git/info/exclude\` is not in any clone but this one, so ` +
              `the property holds for the person who ran the check and for nobody else`,
          );
        else if (!matched.pattern.includes('env'))
          findings.push(
            `\`${subject.path}\` is ignored by \`${matched.pattern}\`, which does not name ` +
              `\`env\` at all. A catch-all that happens to cover this path is not the rule ` +
              `ADR-224 states, and it would go on reading green after the \`.env\` entries were ` +
              `deleted`,
          );
        continue;
      }
      if (!subject.ignored && isIgnored) {
        findings.push(
          `\`${subject.path}\` IS ignored, by \`${matched?.pattern ?? '?'}\` at ` +
            `${matched?.source ?? '?'}, and the rule says it must not be (${subject.why}). ` +
            `A pattern set wide enough to swallow this one is wide enough to hide a file ` +
            `somebody meant to commit`,
        );
      }
    }

    // LEG 2. AN IGNORE RULE DOES NOT REACH A TRACKED FILE.
    /** @type {string} */
    let tracked;
    try {
      tracked = execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      const e = /** @type {{ status?: number }} */ (err);
      throw new Error(
        `RI-21 could not list the tracked files (\`git ls-files\` exited ${String(e.status)} in ` +
          `${root}). Leg 2 exists because an ignore rule is silent about a file that is already ` +
          `committed, so skipping it would leave the worse half of the property unchecked`,
        { cause: err },
      );
    }
    for (const path of tracked.split('\0')) {
      if (path === '' || !trackedEnvSpelling(path)) continue;
      findings.push(
        `\`${path}\` is TRACKED. A \`.gitignore\` rule applies to untracked paths only, so ` +
          `this file is in every clone and in the history no matter what leg 1 says, and ` +
          `deleting it from the tip does not remove it from the history. Only ` +
          `\`.env.example\` may be committed`,
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-22  The certificate code's entropy is MEASURED, by running the mint
// -----------------------------------------------------------------------------
//
// WHAT HAPPENED. `INV-M11-05` fixes `certificates.code` at "128 bits of
// entropy, no sequence" (`M11:54`); `M11:246` calls that the whole defence, "the
// code space is not walkable, which makes the attack infeasible rather than
// merely rate limited"; `API_CONTRACT:1472` and `:1473` each decline to inherit
// the catalog's rate budget because it "is an enumeration budget on a 128-bit
// token"; `EC-091` restates it a fifth time. ADR-231 then put
// `GET /verify/:code` into service, public and unauthenticated, with the code
// as the only credential a caller presents.
//
// AND NO FUNCTION IN THE REPOSITORY PRODUCED SUCH A CODE. The measurement is in
// ADR-235 section 2: no `INSERT` reaches `certificates` from any deployable, and
// no identifier resembling a certificate-code minter existed in `apps`,
// `packages`, `e2e` or `scripts`. The number was not too small; the generator
// was not there. Five documents described a property of a function nobody had
// written, and two shipped `.ts` comments described it as a property the
// deployment HAS.
//
// SO THIS CHECK EXECUTES THE MINT AND MEASURES WHAT COMES OUT, which is
// `RI-20`'s move one class over: a claim that quotes its own decision procedure
// is settled by running it. A static read of the source would settle the
// alphabet and the length and would settle nothing about the DRAWS, and the
// defects worth catching here -- a constant position, a biased index, a
// counter dressed as a token -- are all properties of the output.
//
// THE THRESHOLD IS READ OUT OF THE CORPUS AND IS NOT TYPED HERE. `128` appears
// in no constant below. The five documents above are parsed for the figure they
// commit to, they must agree with each other, and the executed mint must clear
// the number they name. A corpus that raises the commitment to 192 fails this
// check on the next run rather than on the next reader, and a corpus that
// quietly lowers it to 64 fails too, because the sites must agree and the mint
// is the third opinion.
//
// WHAT IT DOES NOT CATCH, stated rather than left to be discovered.
//   (1) IT CANNOT SEE THE DATABASE. `certificates.code` is `text NOT NULL` with
//       no length bound and no alphabet bound (`0020:125`), so a hand-written
//       `INSERT` can still put a weak code in the column. That bound is a
//       migration and ADR-235 leaves it owed. Leg 3 catches the tree's own
//       writers and nothing else does.
//   (2) IT MEASURES A SAMPLE. Uniformity is asserted with margins wide enough
//       that a fair generator cannot fail by chance (section 4 of ADR-235 does
//       the arithmetic), which means a subtly biased one can pass. The
//       properties it settles cheaply are the ones that actually go wrong: a
//       position that never varies, a symbol outside the declared alphabet, a
//       repeated draw, an alphabet that repeats a character.
//   (3) IT ASSERTS NOTHING ABOUT THE RATE LIMIT. `INV-M11-05`'s other half is
//       "the verification endpoint is rate limited", and nothing in this tree
//       implements one. ADR-235 section 5 rules that separately and reports it
//       as owed. A check that quietly widened to cover it would be reporting a
//       property nobody built.

/** The mint under measurement. */
const MINT_MODULE = 'packages/db/src/certificate-code.ts';

/**
 * Every document that states a bit count for this token. THE LIST IS WRITTEN
 * OUT rather than globbed: a glob that stopped matching would empty this leg in
 * silence, which is the shape of the defect the check exists for.
 */
const ENTROPY_COMMITMENT_FILES = [
  'docs/plans/M11-certificates-social-proof.md',
  'docs/architecture/API_CONTRACT.md',
  'docs/edge-cases/EC-091.md',
];

/** `128 bits of entropy`, `128-bit token`, and the two spellings between. */
const ENTROPY_COMMITMENT = /(\d+)[ -]bits?(?: of entropy| token)/gi;

/**
 * Sources of ambience a token may not be drawn from, with the reason each one
 * is disqualifying. The NAME is written beside the pattern rather than derived
 * from it: a regex printed back into a finding reads as line noise, and a
 * finding a reader cannot parse is a finding they will re-derive by hand.
 */
const AMBIENT_SOURCES = [
  {
    name: 'Math.random',
    pattern: /\bMath\.random\b/,
    why: 'a non-cryptographic PRNG whose internal state is recoverable from its own output',
  },
  {
    name: 'Date.now',
    pattern: /\bDate\.now\b/,
    why: 'a clock, which makes part of the token predictable from when it was issued',
  },
  { name: 'performance.now', pattern: /\bperformance\.now\b/, why: 'a clock' },
];

/** How many codes leg 2 draws. */
const DRAWS = 2000;

/**
 * A file that writes a `certificates` row, in either idiom this tree uses.
 * Leg 3 requires every one of them to reach the mint.
 */
const CERTIFICATE_WRITE = /insert\(\s*'certificates'|INSERT\s+INTO\s+certificates/i;

/** @type {Invariant} */
const ri22 = {
  id: 'RI-22',
  title:
    'The certificate code carries the entropy the corpus commits to, measured by running the mint',
  covers:
    `${MINT_MODULE}, executed. Leg 1 reads the bit count the corpus commits to ` +
    `out of ${ENTROPY_COMMITMENT_FILES.join(', ')} and requires every site to ` +
    'name the SAME figure, so `INV-M11-05`, `AS-M11-04`, the two rate-limit ' +
    'rows and `EC-091` cannot drift apart; the number is read rather than typed ' +
    'here, and a corpus that raises or lowers it moves this check by itself. ' +
    'Leg 2 imports the mint in a child process and draws codes from it, then ' +
    'asserts over the DRAWS rather than over the source: every code is the ' +
    'declared length, every symbol is in the declared alphabet, the alphabet ' +
    'repeats no symbol, no two draws collide, every position exercises most of ' +
    'the alphabet, no symbol dominates a position, and the module-reported bit ' +
    'count equals the count recomputed here from the observed alphabet. THE ' +
    'BIT COUNT IS TAKEN OVER DISTINCT SYMBOLS AND NOT STRING LENGTH, because an ' +
    'alphabet that repeats one character is still 32 characters long and is 31 ' +
    'symbols of entropy. Leg 3 requires that any file writing a `certificates` ' +
    'row imports the mint, so the issuance slice inherits a measured token ' +
    'instead of inventing one. WHY EXECUTION RATHER THAN A READ: the generator ' +
    'did not exist at all when this check was written (ADR-235 section 2), and ' +
    'the defects worth catching in the one that replaced it -- a constant ' +
    'position, a biased index, a counter dressed as a token -- are properties ' +
    'of the output and not of the text. WHAT IT DOES NOT CATCH. (1) The COLUMN ' +
    'is still `text NOT NULL` with no length or alphabet bound, so a ' +
    'hand-written `INSERT` outside this tree can still store a weak code; that ' +
    'bound is a migration and ADR-235 leaves it owed. (2) It measures a SAMPLE, ' +
    'with margins wide enough that a fair generator cannot fail by chance, ' +
    'which means a subtly biased one can pass. (3) It asserts nothing about the ' +
    "RATE LIMIT, which is `INV-M11-05`'s other half and exists nowhere in this " +
    'tree; ADR-235 section 5 rules it separately rather than letting this check ' +
    'imply it was built.',
  run(root) {
    /** @type {string[]} */
    const findings = [];

    // -------------------------------------------------------------------------
    // Leg 1. What the corpus commits to, read from the corpus.
    // -------------------------------------------------------------------------
    /** @type {Map<number, string[]>} */
    const committed = new Map();
    for (const rel of ENTROPY_COMMITMENT_FILES) {
      const abs = join(root, rel);
      if (!existsSync(abs)) {
        findings.push(
          `${rel} does not exist. This check names the documents whose COMMITMENT it reads, so ` +
            `a rename silently empties leg 1 and leaves the mint measured against nothing; ` +
            `point it at the new path`,
        );
        continue;
      }
      const lines = readFileSync(abs, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        ENTROPY_COMMITMENT.lastIndex = 0;
        for (const m of (lines[i] ?? '').matchAll(ENTROPY_COMMITMENT)) {
          const bits = Number(m[1]);
          const where = `${rel}:${i + 1}`;
          const seen = committed.get(bits);
          if (seen) seen.push(where);
          else committed.set(bits, [where]);
        }
      }
    }

    if (committed.size === 0)
      throw new Error(
        `RI-22 read ${String(ENTROPY_COMMITMENT_FILES.length)} document(s) and found NO stated ` +
          'bit count for the certificate code in any of them. This check exists because five ' +
          'documents asserted 128 bits with nothing enforcing it, so a run that settles the ' +
          'threshold against nothing is not a pass',
      );

    if (committed.size > 1) {
      const spread = [...committed.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bits, at]) => `${String(bits)} at ${at.join(', ')}`)
        .join('; ');
      findings.push(
        `the corpus states MORE THAN ONE bit count for the certificate code: ${spread}. These ` +
          `sentences are one commitment written in several places, and a mint cannot be ` +
          `measured against a threshold the corpus does not agree on. Move them together in ` +
          `one edit, or say in an ADR which one binds`,
      );
    }

    const required = Math.max(...committed.keys());

    // -------------------------------------------------------------------------
    // Leg 2. The mint, executed.
    // -------------------------------------------------------------------------
    const mintAbs = join(root, MINT_MODULE);
    if (!existsSync(mintAbs)) {
      findings.push(
        `${MINT_MODULE} does not exist, and the corpus commits to ${String(required)} bits at ` +
          `${[...committed.values()].flat().join(', ')}. THAT IS THE STATE ADR-235 WAS OPENED ` +
          `ON: a property asserted in five documents, leaned on by two rate-limit rows, and ` +
          `produced by no function in the repository. If the mint moved, point this check at ` +
          `it; if it was deleted, the five sentences above are false again`,
      );
      return findings;
    }

    const source = readFileSync(mintAbs, 'utf8');
    if (!/from 'node:crypto'/.test(source))
      findings.push(
        `${MINT_MODULE} does not import from \`node:crypto\`. A public token drawn from anything ` +
          `but a cryptographic source has no entropy worth the name, whatever its length, and ` +
          `the arithmetic below would report the same 130 bits for a counter`,
      );
    for (const { name, pattern, why } of AMBIENT_SOURCES) {
      if (!pattern.test(source)) continue;
      findings.push(
        `${MINT_MODULE} names \`${name}\`, which is ${why}. Every symbol of this token comes ` +
          `from \`node:crypto\` or the token is not what INV-M11-05 says it is`,
      );
    }

    const script =
      `const m = await import(${JSON.stringify(pathToFileURL(mintAbs).href)});\n` +
      `const draws = [];\n` +
      `for (let i = 0; i < ${String(DRAWS)}; i += 1) draws.push(m.mintCertificateCode());\n` +
      `process.stdout.write(JSON.stringify({\n` +
      `  alphabet: m.CERTIFICATE_CODE_ALPHABET,\n` +
      `  length: m.CERTIFICATE_CODE_LENGTH,\n` +
      `  bits: m.CERTIFICATE_CODE_ENTROPY_BITS,\n` +
      `  draws,\n` +
      `}));\n`;

    /** @type {string} */
    let raw;
    try {
      raw = execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', script],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 64 * 1024 * 1024,
          // CAPTURED RATHER THAN INHERITED. `execFileSync` sends the child's
          // stderr to this process by default, which prints a stack trace above
          // the runner's own output and leaves the FINDING with nothing to say.
          // The module refuses to load on a repeated alphabet symbol, so its
          // stderr is the whole diagnosis in exactly the case worth diagnosing.
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (err) {
      const e = /** @type {{ status?: number, stderr?: string }} */ (err);
      // THE THROWN MESSAGE AND NOT THE STACK TAIL. The last lines of a node
      // stderr are `at ...` frames and the version banner, which name the loader
      // rather than the defect; the module's own refusal is the line that says
      // what is wrong with the alphabet.
      const lines = String(e.stderr ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '');
      const thrown = lines.find((l) => /^[A-Za-z]*Error:/.test(l)) ?? lines.slice(-1)[0] ?? '';
      findings.push(
        `${MINT_MODULE} could not be executed (node exited ${String(e.status)}): ${thrown}. A ` +
          `mint that does not run mints nothing, and the module refuses to LOAD rather than ` +
          `report a number it cannot support, so a load failure here is a finding rather than ` +
          `an environment problem`,
      );
      return findings;
    }

    /** @type {{ alphabet: unknown, length: unknown, bits: unknown, draws: unknown }} */
    let measured;
    try {
      measured = JSON.parse(raw);
    } catch {
      findings.push(
        `${MINT_MODULE} ran and did not print a measurement this check can read. It printed ` +
          `${String(raw.length)} byte(s) whose first line is \`${raw.split('\n')[0] ?? ''}\``,
      );
      return findings;
    }

    const alphabet = typeof measured.alphabet === 'string' ? measured.alphabet : '';
    const length = typeof measured.length === 'number' ? measured.length : 0;
    const claimedBits = typeof measured.bits === 'number' ? measured.bits : 0;
    const draws = Array.isArray(measured.draws) ? measured.draws.map((d) => String(d)) : [];

    if (draws.length !== DRAWS)
      throw new Error(
        `RI-22 asked ${MINT_MODULE} for ${String(DRAWS)} codes and read ${String(draws.length)}. ` +
          'This check settles the entropy by measuring the OUTPUT, so a run with no draws in ' +
          'it is not a pass',
      );

    const symbols = new Set(alphabet);
    if (symbols.size !== alphabet.length)
      findings.push(
        `the declared alphabet is ${String(alphabet.length)} character(s) and ` +
          `${String(symbols.size)} DISTINCT symbol(s). A repeated character costs entropy and ` +
          `costs it invisibly: the string is still as long as it was, and every arithmetic ` +
          `taken over its length reports no loss at all`,
      );

    const derived = Math.floor(length * Math.log2(Math.max(symbols.size, 1)));
    if (derived !== claimedBits)
      findings.push(
        `${MINT_MODULE} reports ${String(claimedBits)} bit(s) and ${String(length)} position(s) ` +
          `over ${String(symbols.size)} distinct symbol(s) is ${String(derived)}. The figure the ` +
          `module exports is the one other files will cite, so it is computed here from the ` +
          `observed alphabet rather than believed`,
      );

    if (derived < required)
      findings.push(
        `the mint yields ${String(derived)} bit(s) and the corpus commits to ` +
          `${String(required)} at ${[...committed.values()].flat().join(', ')}. ` +
          `${String(length)} position(s) over ${String(symbols.size)} symbol(s) is not enough, ` +
          `and \`API_CONTRACT:1473\` declines the catalog's rate budget on the strength of this ` +
          `number. A code short enough to walk turns GET /verify/:code into a directory of ` +
          `every funded trader (AS-M11-04)`,
      );

    /** @type {Set<string>} */
    const distinctDraws = new Set();
    /** @type {Map<string, number>[]} */
    const perPosition = Array.from({ length }, () => new Map());
    let wrongLength = 0;
    /** @type {Set<string>} */
    const foreign = new Set();

    for (const draw of draws) {
      distinctDraws.add(draw);
      if (draw.length !== length) {
        wrongLength += 1;
        continue;
      }
      for (let i = 0; i < length; i += 1) {
        const ch = draw.charAt(i);
        if (!symbols.has(ch)) foreign.add(ch);
        const at = perPosition[i];
        if (at) at.set(ch, (at.get(ch) ?? 0) + 1);
      }
    }

    if (wrongLength > 0)
      findings.push(
        `${String(wrongLength)} of ${String(draws.length)} minted code(s) are not ` +
          `${String(length)} character(s) long. The bit count above is the length times the ` +
          `symbol count, so a code shorter than the declared length carries less entropy than ` +
          `every document in the corpus says it does`,
      );

    if (foreign.size > 0)
      findings.push(
        `minted codes contain ${String(foreign.size)} symbol(s) outside the declared alphabet: ` +
          `${[...foreign].map((c) => JSON.stringify(c)).join(', ')}. The declared alphabet is ` +
          `what the entropy is computed over, so a mint drawing from a different set is ` +
          `measured against the wrong denominator in both directions`,
      );

    if (distinctDraws.size !== draws.length)
      findings.push(
        `${String(draws.length)} draw(s) produced ${String(distinctDraws.size)} distinct code(s). ` +
          `At ${String(derived)} bits a collision in ${String(draws.length)} draws does not ` +
          `happen, so this is a mint with state: a counter, a seeded PRNG, or a cache. ` +
          `\`certificates_code_uq\` would reject the second one and the trader would lose a ` +
          `card, which is the visible half; the invisible half is that the space is walkable`,
      );

    // A POSITION THAT DOES NOT VARY IS THE STRUCTURE `M11:246` REFUSES, and it
    // is what a prefix, a version marker or a checksum digit looks like from
    // out here. The margins are wide on purpose: over 2,000 draws a fair
    // position shows each of 32 symbols with probability 1 - (31/32)^2000, so
    // missing three is not something a fair mint does, and a symbol reaching
    // three times its expected share is sixteen standard deviations out.
    const expected = draws.length / Math.max(symbols.size, 1);
    const coverageFloor = Math.floor(symbols.size * 0.9);
    for (let i = 0; i < perPosition.length; i += 1) {
      const at = perPosition[i];
      if (!at || at.size === 0) continue;
      if (at.size < coverageFloor) {
        const only = [...at.keys()].sort().join('');
        findings.push(
          `position ${String(i)} of a minted code showed only ${String(at.size)} of ` +
            `${String(symbols.size)} symbol(s) over ${String(draws.length)} draw(s) (\`${only}\`). ` +
            `A position that does not vary is a prefix, a version marker or a checksum, and ` +
            `\`M11:246\` reads "128 bits of entropy, no sequence, NO STRUCTURE". The bit count ` +
            `above assumes every position is free`,
        );
        continue;
      }
      for (const [ch, seen] of at) {
        if (seen <= expected * 3) continue;
        findings.push(
          `position ${String(i)} drew \`${ch}\` ${String(seen)} time(s) in ` +
            `${String(draws.length)} draw(s), against ${String(Math.round(expected))} expected. ` +
            `A dominated position is a biased index, which is what a modulo over a range the ` +
            `alphabet size does not divide produces, and the low symbols are exactly the ones ` +
            `an enumerator tries first`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Leg 3. The mint is the only producer.
    // -------------------------------------------------------------------------
    for (const rel of walk(root)) {
      if (!/^(apps|packages|e2e|scripts)\//.test(rel)) continue;
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(rel)) continue;
      if (rel === MINT_MODULE) continue;
      const body = readFileSync(join(root, rel), 'utf8');
      if (!CERTIFICATE_WRITE.test(body)) continue;
      if (body.includes('mintCertificateCode')) continue;
      findings.push(
        `${rel} writes a \`certificates\` row and never names \`mintCertificateCode\`. The ` +
          `column is \`text NOT NULL\` with no length bound and no alphabet bound (\`0020:125\`), ` +
          `so the database will accept whatever this file puts in \`code\` and every enumeration ` +
          `control the corpus names for GET /verify/:code rests on what that value is. Mint it ` +
          `through ${MINT_MODULE}, or if this row's code legitimately comes from elsewhere, say ` +
          `where in an ADR and widen this leg deliberately`,
      );
    }
    return findings;
  },
};

// =============================================================================
// RI-23. A RECORDED CLASS B APPROVAL NAMES AN ASSERTION AND A RED
// =============================================================================
// ADR-227 SECTION 3 RULED THAT A MONEY-PATH DIFF WHOSE CENTRAL CLAIM IS A
// PROPERTY HAS ITS APPROVAL **EARNED** BY A NAMED MECHANICAL ASSERTION RATHER
// THAN GRANTED BY A SIGNATURE, AND ITS SECTION 6 SET FOUR CONDITIONS ON WHAT
// COUNTS AS ONE. Two of the four are checkable from the entry's own text and
// two are not, and this check takes the two that are:
//
//   condition 2, "it was watched RED before the change and GREEN after, with
//   the transcript in the entry", and condition 3, "it is named in a registry
//   that a gate runs", of which the checkable half is that the assertion is
//   NAMED AT ALL and that the file it names is on disk.
//
// WHY IT EXISTS. ADR-227's own approval block asked for exactly this and said
// it did not have it: "Section 6's four conditions are the whole defence and
// condition 4 is unenforceable by anything mechanical ... the honest repair is
// an invariant that reads a gate's own history against the entry citing it, and
// that invariant does not exist, is not written here, and is the first thing to
// build if this regime is adopted." This is the buildable part of that.
//
// THE FAILURE MODE IT REMOVES, in the words of ALLOCATION row 244: "an approval
// without a red-then-green transcript is a signature wearing a test's clothes,
// and it is exactly what section E2 refutes." A class B approval block that
// names no assertion, or names a test file that has since been deleted or
// renamed, reads to every later reader as an earned approval and is a granted
// one with better vocabulary.
//
// THE MARKER IS READ FROM THE CORPUS AND NOT INVENTED HERE. `CLASS B APPROVAL`
// is the form ADR-243 established across the four entries it moved, and ADR-244
// wrote eleven more in it. A check whose scope predicate is a phrase one entry
// coined would be a check that stops matching the day the phrasing drifts, so
// the phrase is the one already in use and the drift direction is safe: an
// entry that stops using the marker leaves this check's scope, which is a
// SILENT drop, and that is named below rather than hidden.
// =============================================================================

/**
 * The marker that puts an approval block in RI-23's scope, and it must OPEN the
 * bolded run rather than appear inside it. ADR-243 section 3 clause 4 is a
 * ruling ABOUT what a class B approval records -- "**4. A CLASS B APPROVAL IS
 * RECORDED IN THE ENTRY IT APPROVES**" -- and a check that read that as a
 * recorded approval would be asking an entry's ruling to carry its own
 * transcript. The four blocks ADR-243 actually wrote open with the marker, in
 * two spellings, and both are matched.
 */
const CLASS_B_MARKER = /^\s*(?:[-*>]\s+)?\*\*CLASS B APPROVAL\b/;

/**
 * A recorded RED. ADR-227 section 6 condition 2 is about a result somebody
 * WATCHED, so the words are the ones a transcript uses. `GREEN` alone is not
 * one of them, deliberately: an assertion never seen failing asserts nothing.
 */
const CLASS_B_RED = /\bRED\b|\bREDDEN(?:ED|S)?\b|\bFAIL(?:S|ED|ING)?\b/;

/**
 * A named assertion. A vitest file, a `CI-06<letter>` gate, or an `RI-nn`
 * invariant, which are the three things ADR-227 section 6 admits.
 */
const CLASS_B_TEST_PATH = /`([A-Za-z0-9_./-]+\.test\.tsx?)`|\(([^)\s]+\.test\.tsx?)\)/g;
const CLASS_B_NAMED_GATE = /\bCI-06[a-z]\b|\bRI-\d{2}\b/;

/**
 * The block a `CLASS B APPROVAL` marker opens: the marker line and every line
 * after it up to the next top-level bullet or heading, which is where the next
 * claim starts. A block that runs to the end of the file is the last bullet.
 *
 * @param {readonly string[]} lines
 * @param {number} start index of the marker line
 * @returns {string} the block, joined
 */
function classBBlock(lines, start) {
  const out = [lines[start] ?? ''];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^(- |#|\| |> )/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

/** @type {Map<string, Set<string>>} */
const CLASS_B_SUITE_INDEX = new Map();

/**
 * Every `*.test.ts` basename in the tree, so a citation by name resolves.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
function classBSuiteIndex(root) {
  const cached = CLASS_B_SUITE_INDEX.get(root);
  if (cached) return cached;
  /** @type {Set<string>} */
  const names = new Set();
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.test\.tsx?$/.test(e.name)) names.add(e.name);
    }
  };
  walk(root);
  CLASS_B_SUITE_INDEX.set(root, names);
  return names;
}

const ri23 = {
  id: 'RI-23',
  title: 'A recorded class B approval names an assertion that exists and a RED that was watched',
  covers:
    'every `ADR-*.md` under docs/decisions. AN ENTRY IS IN SCOPE WHEN IT ' +
    'CARRIES THE MARKER `CLASS B APPROVAL` AT THE OPENING OF A BOLDED RUN, ' +
    'which is the form ADR-243 established and ADR-244 extended; the block is ' +
    'that line and every line after it up to the next top-level bullet, ' +
    'heading, table row or blockquote. THE MARKER MUST OPEN THE RUN RATHER ' +
    'THAN SIT INSIDE IT, because ADR-243 section 3 clause 4 is a RULING about ' +
    'what a class B approval records and is not one, and a check that read it ' +
    'as one would ask an entry to put a transcript inside its own ruling. ' +
    'A TEST CITED BY BARE BASENAME IS RESOLVED BY SEARCHING THE TREE and one ' +
    'carrying a separator is resolved exactly: the corpus cites a suite by ' +
    'name in prose as often as by path, and a pointer that names a directory ' +
    'is making a claim about WHERE. Three ' +
    'things are required of each block, and each is one of ADR-227 section 6 ' +
    "conditions 2 and 3 reduced to the part an entry's own text can settle. " +
    '(1) IT NAMES AN ASSERTION: a `*.test.ts` path, a `CI-06<letter>` gate or ' +
    "an `RI-nn`. An approval that names none is a signature with a test's " +
    'vocabulary and nothing behind it. (2) EVERY TEST PATH IT NAMES IS ON ' +
    'DISK, resolved from the repository root and from `docs/decisions/`, so a ' +
    'renamed or deleted suite turns the approval that rests on it RED instead ' +
    'of leaving it reading as earned. (3) IT RECORDS A RED: the block states ' +
    'RED, REDDENED, FAILS or FAILED somewhere, because ADR-227 condition 2 is ' +
    'that the assertion was WATCHED FAILING and an assertion never seen ' +
    'failing asserts nothing. WHAT IT DOES NOT CATCH, stated rather than left ' +
    'to be discovered, and the list is longer than the list of what it does. ' +
    '(1) IT NEVER RE-RUNS THE TRANSCRIPT, so a recorded red that no longer ' +
    'reproduces passes. That is not hypothetical: ADR-244 section 6 re-ran ' +
    "ADR-230's two recorded seeds and one of them is green on the tree today, " +
    'with the property still held by the other. The check that would catch ' +
    'that is running the seed, which a static reader cannot do. (2) IT DOES ' +
    'NOT READ WHETHER THE ASSERTION FALSIFIES THE CENTRAL CLAIM, which is ' +
    'condition 1 and is a judgement about prose. (3) IT DOES NOT READ WHETHER ' +
    'THE ASSERTION WAS WEAKENED TO PASS, which is condition 4 and which ' +
    "ADR-227's own approval block calls unenforceable by anything mechanical. " +
    '(4) AN ENTRY THAT STOPS USING THE MARKER LEAVES SCOPE SILENTLY. The ' +
    'direction is the safe one for a check that can only ever be a floor, and ' +
    'it is the same shape RI-13 records about an unreadable approval status.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const dir = join(root, 'docs/decisions');
    if (!existsSync(dir)) return findings;
    const entries = readdirSync(dir)
      .filter((f) => /^ADR-.*\.md$/.test(f))
      .sort();

    let blocks = 0;
    for (const file of entries) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!CLASS_B_MARKER.test(lines[i] ?? '')) continue;
        blocks += 1;
        const block = classBBlock(lines, i);
        const where = `docs/decisions/${file}:${String(i + 1)}`;

        /** @type {string[]} */
        const paths = [];
        CLASS_B_TEST_PATH.lastIndex = 0;
        for (const m of block.matchAll(CLASS_B_TEST_PATH)) {
          const p = m[1] ?? m[2];
          if (p !== undefined) paths.push(p);
        }

        if (paths.length === 0 && !CLASS_B_NAMED_GATE.test(block)) {
          findings.push(
            `${where} records a CLASS B APPROVAL and names no assertion. ADR-227 section 6 ` +
              'makes a class B approval EARNED BY A NAMED MECHANICAL ASSERTION -- a ' +
              '`*.test.ts` suite, a `CI-06<letter>` gate or an `RI-nn` -- and an approval ' +
              "that names none is a signature wearing a test's clothes, which is the one " +
              'thing section E2 refutes',
          );
        }

        for (const p of paths) {
          const bare = p.replace(/^(\.\.\/)+/, '');
          const fromRoot = join(root, bare);
          const fromEntry = resolve(dir, p);
          if (existsSync(fromRoot) || existsSync(fromEntry)) continue;
          // A BARE BASENAME IS RESOLVED BY SEARCHING, because this corpus cites
          // a suite by name in prose as often as by path -- "`payouts.test.ts`'s
          // 38 cases stayed green" -- and refusing those would fail a form the
          // entries were already written in. A path carrying a separator is
          // resolved exactly and never by search: a pointer that names a
          // directory is making a claim about WHERE, and answering it from
          // somewhere else is the vacancy RI-15 exists to refuse.
          if (!p.includes('/') && classBSuiteIndex(root).has(p)) continue;
          findings.push(
            `${where} rests its CLASS B APPROVAL on \`${p}\`, which is not on disk. An ` +
              'approval earned by an assertion stops being earned the moment the assertion ' +
              'stops existing, and this is exactly ADR-227 section 6 condition 3: an ' +
              'assertion nothing runs is prose. Repoint the block, or the approval it ' +
              'records is owed again',
          );
        }

        if (!CLASS_B_RED.test(block)) {
          findings.push(
            `${where} records a CLASS B APPROVAL and states no RED. ADR-227 section 6 ` +
              'condition 2 is that the assertion was WATCHED FAILING before it passed, with ' +
              'the transcript in the entry, and an assertion never seen failing asserts ' +
              'nothing: a tautology green on an empty tree passes every other condition',
          );
        }
      }
    }

    // A CHECK THAT MATCHES NOTHING IS NOT A CHECK THAT PASSED, and this one's
    // scope predicate is a phrase, so an empty scope is the failure mode worth
    // reporting rather than the happy case. It is a FINDING and not a throw,
    // because a corpus that has genuinely retired class B is a state this file
    // must be able to describe rather than crash on. IT IS SILENT ON A TREE
    // WITH NO ENTRIES AT ALL, because a scaffold fixture that carries no
    // `ADR-*.md` has nothing for a marker to be missing from, and failing it
    // would be this check reporting on a corpus rather than on a repository.
    if (blocks === 0 && entries.length > 0)
      findings.push(
        'RI-23 read every `ADR-*.md` under docs/decisions and found NO block carrying the ' +
          'marker `CLASS B APPROVAL`. Fifteen entries carried one when this check was ' +
          'written (ADR-243 moved four, ADR-244 eleven), so a run that matches none is a ' +
          'renamed marker and this check silently checking nothing, not a corpus without ' +
          'earned approvals',
      );

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-24  Every scripts/db assertion is run and pinned
// -----------------------------------------------------------------------------
// OI-07's FIFTH OCCURRENCE, AND IT WAS LIVE ON `main` WHEN THIS CHECK WAS
// WRITTEN, IN THE HALF THE GATE THAT CLOSED OI-07 CANNOT SEE.
//
// `CI-06s` asserts that every `scripts/db/probe_*.sql` on disk is run by a step
// in `corpus.yml` AND pinned by `CI-06h`'s needle list, in both directions. Its
// on-disk scan is `/^probe_[a-z0-9_]+\.sql$/`. The directory also holds
// ASSERTIONS -- `assert_*.sql` and `assert_*.mjs` -- and those match nothing in
// that pattern.
//
// MEASURED BEFORE THIS CHECK EXISTED, on the tree as merged:
// `assert_append_only_grants.mjs` and `assert_date_unit_shape.mjs` were on disk,
// were wired at `corpus.yml`, and were pinned by NOTHING. Deleting either step
// would have been a silent change with every gate green -- which is OI-07's
// sentence word for word, four occurrences after the pattern was declared and one
// gate after it was supposedly closed. The first is OI-03's entire
// implementation, the only reader of the database's grants in this repository;
// the second is the only refusal of interval arithmetic against a date column.
//
// WIRING AND PINNING ARE TWO EDITS IN TWO FILES and that is the whole mechanism,
// as `CI-06s` states it. This check is that gate's predicate over the other
// family of files, kept as a separate `RI-nn` rather than folded into `CI-06s`
// because `CI-06s`'s scope is written into its own `covers` line and into its
// STRATEGY row, and widening a gate's stated subject in place is how a row stops
// describing what runs.
//
// WHAT IT CANNOT SEE, on `CI-06s`'s own precedent: whether the assertion asserts
// anything. A file that is run and pinned and holds one comment passes here.
const ri24 = {
  id: 'RI-24',
  title: 'Every scripts/db assertion is run by corpus.yml and pinned by CI-06h',
  covers:
    'AN ASSERTION IS RUN AND PINNED, IN BOTH DIRECTIONS. Every ' +
    '`scripts/db/assert_*.sql` and `scripts/db/assert_*.mjs` on disk appears as ' +
    'an invoked STEP in `.github/workflows/corpus.yml` and as a needle in ' +
    "`CI-06h`'s required list in `scripts/corpus/gates.mjs`, and every such " +
    'filename that list names exists on disk. ' +
    'THIS IS `CI-06s` OVER THE FILES `CI-06s` CANNOT SEE: that gate scans ' +
    '`/^probe_[a-z0-9_]+\\.sql$/` and the assertions match none of it. ' +
    'IT MATCHES THE INVOCATION AND NOT THE MENTION: a `.sql` assertion counts ' +
    'when it is the `-f scripts/db/<file>` argument of a psql call and a `.mjs` ' +
    'one when it is the argument of `node scripts/db/<file>`, so a filename ' +
    'appearing only in a workflow comment is claimed as nothing. `corpus.yml` ' +
    'names `assert_append_only_grants.mjs` in prose above the step that runs it, ' +
    'which is the near-miss a loose parser reads as coverage. ' +
    "THE PINNED SIDE IS READ FROM `CI-06h`'s BLOCK ALONE, on `CI-06s`'s " +
    'precedent, because `gates.mjs` names these files in its own comments and a ' +
    'gate counting its own comment as a pin reports every file pinned the day it ' +
    'is written. ' +
    'WHAT IT CANNOT SEE: whether the assertion asserts anything, which is the ' +
    'same boundary `CI-06s` states. A file run and pinned that holds one comment ' +
    'passes here. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];
    const dir = 'scripts/db';
    const workflow = '.github/workflows/corpus.yml';

    const onDisk = existsSync(join(root, dir))
      ? readdirSync(join(root, dir))
          .filter((f) => /^assert_[a-z0-9_]+\.(sql|mjs)$/.test(f))
          .sort()
      : [];

    // SILENT ON A TREE THAT IS NOT THIS REPOSITORY, on RI-23's precedent. The
    // synthetic scaffold fixture carries neither corpus.yml nor scripts/db, and
    // a tree with no corpus workflow has nothing for an assertion to be unwired
    // from. The pairing is what makes this safe rather than an exemption: a tree
    // WITH the workflow and no assertion on disk is the "reader stopped
    // matching" case and throws below.
    if (!existsSync(join(root, workflow))) {
      if (onDisk.length === 0) return findings;
      findings.push(
        `${workflow} is missing and ${dir} holds ${String(onDisk.length)} assertion(s), ` +
          'so none of them is run at all',
      );
      return findings;
    }
    const wf = readFileSync(join(root, workflow), 'utf8');

    // The INVOCATION. `-f` for the psql form, the bare argument for the node one.
    const wired = new Set();
    for (const m of wf.matchAll(/psql\b[^\n]*?-f\s+scripts\/db\/(assert_[a-z0-9_]+\.sql)/g)) {
      wired.add(m[1]);
    }
    for (const m of wf.matchAll(/\bnode\s+scripts\/db\/(assert_[a-z0-9_]+\.mjs)/g)) {
      wired.add(m[1]);
    }

    // CI-06h's block, bounded exactly as CI-06s bounds it: from the declaration
    // to the NEXT top-level gate declaration, whichever letter that is, so this
    // file's prose and the rest of gates.mjs are both outside the window.
    const gatesPath = join(root, 'scripts/corpus/gates.mjs');
    if (!existsSync(gatesPath)) {
      findings.push(
        'scripts/corpus/gates.mjs is missing, so CI-06h pins nothing and every ' +
          'assertion below is unpinned for a reason this check cannot report usefully',
      );
      return findings;
    }
    const gates = readFileSync(gatesPath, 'utf8');
    const from = gates.indexOf('\nconst ci06h = {');
    const after = from === -1 ? -1 : gates.slice(from + 1).search(/\nconst ci06[a-z] = \{/);
    const to = after === -1 ? gates.length : from + 1 + after;
    const pinned = new Set();
    if (from !== -1) {
      for (const m of gates.slice(from, to).matchAll(/'(assert_[a-z0-9_]+\.(?:sql|mjs))'/g)) {
        pinned.add(m[1]);
      }
    }

    for (const file of onDisk) {
      if (!wired.has(file)) {
        findings.push(
          `${dir}/${file} exists and no step in ${workflow} invokes it. An assertion ` +
            `that ships beside a fix and never runs again is the same object as the ` +
            `golden test that was missing (OI-07). Add a step that runs it`,
        );
      }
      if (!pinned.has(file)) {
        findings.push(
          `${dir}/${file} is not pinned by CI-06h's required-needle list, so deleting ` +
            `its workflow step would be a silent change rather than a gate failure. ` +
            `THIS IS OI-07's SHAPE, in the half CI-06s cannot see: that gate reads ` +
            `probe_*.sql only. Add the filename to the list in ci06h's run()`,
        );
      }
    }

    // The stale direction, which is the one nobody looks in: a list naming
    // something that no longer exists still looks complete.
    for (const file of [...pinned].sort()) {
      if (!onDisk.includes(file)) {
        findings.push(
          `CI-06h pins ${file} and no file under ${dir} provides it. The needle asserts ` +
            `a step nobody can delete because the assertion is already gone, so CI-06h ` +
            `passes while proving nothing about it. Remove the needle or restore the file`,
        );
      }
    }
    for (const file of [...wired].sort()) {
      if (!onDisk.includes(file)) {
        findings.push(
          `${workflow} invokes ${dir}/${file} and no such file exists, so the job fails ` +
            `at that step rather than proving anything`,
        );
      }
    }

    // Sentinels, on CI-06s's precedent. Each zero means a reader stopped
    // matching, at which point every file passes for the wrong reason.
    if (onDisk.length === 0) {
      throw new Error(
        `RI-24 found no assert_* file under ${dir} on a tree that DOES carry ${workflow}. ` +
          'This repository has held assert_no_floats.sql since the P1 scaffold, so zero ' +
          'here means the directory or the naming has moved and this check is asserting ' +
          'about a tree it did not read. A tree carrying neither is a fixture and returns ' +
          'silently above',
      );
    }
    if (wired.size === 0) {
      throw new Error(
        `RI-24 matched no assertion invocation in ${workflow}. Zero means the step form ` +
          'has moved, at which point every assertion reads as unwired and the findings ' +
          'above are noise rather than evidence',
      );
    }
    if (pinned.size === 0) {
      throw new Error(
        "RI-24 read no assert_* filename out of CI-06h's block. Zero means the block " +
          'bounds or the needle form have moved, and every assertion would then report ' +
          'as unpinned',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-25  The `date` type parser is installed once, for OID 1082, in the one file
//        that constructs the pool
// -----------------------------------------------------------------------------
// ADR-271's PROPERTY, HELD ACROSS THE TREE RATHER THAN INSIDE ONE PACKAGE.
//
// ADR-268 section 7 measured a defect that was live on `main`: `pg` parsed a
// `date` (OID 1082) into a `Date` at the PROCESS'S LOCAL MIDNIGHT and drizzle's
// `PgDateString.mapFromDriverValue` rendered that with `toISOString()`, so the
// database's `2026-08-28` reached Merit code as `'2026-08-27'` on every
// deployment east of UTC. ADR-271 repaired it with one `setTypeParser(1082, ...)`
// in `packages/db/src/client.ts` returning the wire text verbatim.
//
// A UNIT TEST CAN PIN THAT FILE. IT CANNOT PIN THE TREE, and the two ways this
// repair gets undone are both tree-shaped:
//
//   1. THE SECOND TRAP. Somebody meets a wrong day, does not find this entry,
//      and corrects it AT THE READER -- or installs a SECOND parser somewhere
//      else. A per-reader correction is the same defect multiplied, and a second
//      parser makes which one wins depend on module import order. The parser is
//      the one place the property can be made true for everything, and "one
//      place" is a property of the whole tree.
//   2. THE THIRD TRAP. Somebody generalises the fix to `1114` and `1184`.
//      Merit stores instants in UTC deliberately (CLAUDE.md), so an instant HAS
//      a timezone; handing `timestamptz` back as raw text would be a far larger
//      and much quieter change than the one ADR-271 made.
//
// LEG 2 IS VACUOUSLY TRUE TODAY AND THAT IS THE ARGUMENT FOR WIRING IT NOW,
// which is `assert_date_unit_shape.mjs`'s reasoning one layer up: no source file
// outside `client.ts` names `setTypeParser` at all. A gate wired while it is
// green, and watched failing on a seeded violation, is the cheapest it will ever
// be. That assertion is the SQL half of the same subject -- no `timestamptz`
// cast to `date`, no interval arithmetic against one -- and this is the half it
// cannot see, because it reads migrations and the defect was in the driver.
//
// IT READS SOURCE DIRECTORIES ONLY, and that is deliberate rather than lax. A
// test file legitimately holds the string while asserting ABOUT it: both
// `last-closed-trading-day-door.test.ts` and `date-column-timezone.test.ts` do.
// A file that INSTALLS a parser is a file under a `src/`, and scoping the scan
// there is what keeps the check matching an act instead of a mention.
//
// WHAT IT CANNOT SEE: whether the parser is CORRECT. A `client.ts` installing
// `setTypeParser(1082, (v) => somethingWrong(v))` passes here. That is
// `date-column-timezone.test.ts`'s half, which runs both libraries at five
// process timezones; this check is only that there is exactly one of them and
// that it is aimed at the day OID.
const CLIENT_FILE = 'packages/db/src/client.ts';

const ri25 = {
  id: 'RI-25',
  title: 'One `date` type parser, for OID 1082, in the file that constructs the pool',
  covers:
    'A CALENDAR DAY HAS NO TIMEZONE, AND EXACTLY ONE PLACE KEEPS IT THAT WAY. ' +
    `Three legs. ONE: \`${CLIENT_FILE}\` calls \`setTypeParser\` naming 1082, ` +
    'which is ADR-271 repairing the defect ADR-268 section 7 measured. ' +
    'TWO: NO OTHER SOURCE FILE INSTALLS ONE. Every `*.ts`, `*.mjs` and `*.js` ' +
    'under an `apps/*/src`, `packages/*/src` or `scripts/` directory is read, ' +
    'and naming `setTypeParser` anywhere but the one file is a finding -- ' +
    'because a per-reader correction is the same defect multiplied and a second ' +
    'parser makes the winner depend on import order. ' +
    'THREE: THE TIMESTAMP OIDs ARE NOT TOUCHED. `client.ts` may not install a ' +
    'parser for 1114 (`timestamp`) or 1184 (`timestamptz`): Merit stores ' +
    'instants in UTC deliberately, so an instant HAS a timezone and keeps the ' +
    'coercion a day must not get. ' +
    'IT READS `src/` AND `scripts/` AND NOT TESTS, because a test file holds ' +
    'the string while asserting about it and installing is an act, not a ' +
    'mention. ' +
    'WHAT IT CANNOT SEE: whether the parser is CORRECT. One returning the wrong ' +
    'value passes here; `packages/db/test/date-column-timezone.test.ts` runs ' +
    'both libraries at five process timezones and is that half. ' +
    'SILENT on a tree that carries no `client.ts`, which is the synthetic ' +
    'fixture. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    // SILENT ON A TREE THAT IS NOT THIS REPOSITORY, on RI-23's and RI-24's
    // precedent. The synthetic scaffold fixture writes `scope.ts` and
    // `scoped-db.ts` and no `client.ts`, and a tree with no file that
    // constructs a pool has no parser to have installed.
    if (!existsSync(join(root, CLIENT_FILE))) return findings;

    const client = readFileSync(join(root, CLIENT_FILE), 'utf8');

    // LEG 1. The call, and the OID it names. Matched as an INVOCATION rather
    // than a mention, so the prose above the call cannot satisfy the check that
    // the call exists -- which is the shape RI-24 states for `corpus.yml`.
    //
    // COMMENTS ARE STRIPPED FIRST, AND THE SEED THAT FOUND THAT IS RECORDED IN
    // ADR-271. The first version of this check read the raw file, and
    // commenting the call OUT -- which is precisely how this repair would be
    // reverted -- left the `setTypeParser(DATE_OID` text in place and the check
    // reported PASS on the restored defect. `client.ts`'s own header explains
    // the repair at length and names the call, so the file that most needs
    // checking is the one richest in text that looks like the thing.
    const clientCode = stripComments(client);
    const installs = [...clientCode.matchAll(/setTypeParser\s*\(\s*([A-Za-z0-9_]+)/g)].map(
      (m) => m[1],
    );
    if (installs.length === 0) {
      findings.push(
        `${CLIENT_FILE} calls setTypeParser nowhere, so a \`date\` column is parsed by ` +
          "`pg`'s default: a `Date` at the PROCESS'S LOCAL MIDNIGHT, which drizzle then " +
          'renders with `toISOString()`. That is the ADR-146 clause 4 failure ADR-268 ' +
          'section 7 measured, on all 52 `date` columns at once, live in every deployment ' +
          'east of UTC. Restore the parser ADR-271 installed',
      );
    }

    // The OID may be named through a constant, which `client.ts` does. Either
    // the literal or a constant BOUND to the literal in the same file counts,
    // and nothing else does.
    const boundTo1082 = new Set(
      [...clientCode.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*1082\b/g)].map(
        (m) => m[1],
      ),
    );
    const aimedAtTheDay = installs.some((name) => name === '1082' || boundTo1082.has(name));
    if (installs.length > 0 && !aimedAtTheDay) {
      findings.push(
        `${CLIENT_FILE} installs a type parser for ${installs.join(', ')} and none of those ` +
          'is 1082, which is `date`. The OID this repair exists for is the DAY one. Name ' +
          '1082, or a constant assigned 1082 in this file',
      );
    }

    // LEG 3. The timestamp OIDs, which are a separate property and the opposite
    // answer: an instant HAS a timezone.
    for (const [name, oid] of [
      ['timestamp', '1114'],
      ['timestamptz', '1184'],
    ]) {
      if (installs.includes(oid)) {
        findings.push(
          `${CLIENT_FILE} installs a type parser for OID ${oid} (\`${name}\`). ADR-271 is ` +
            'about a CALENDAR DAY, which has no timezone and was being given one. Merit ' +
            'stores instants in UTC deliberately (CLAUDE.md), so an instant keeps the ' +
            'coercion a day must not get. Remove it: only 1082 belongs here',
        );
      }
    }

    // LEG 2. The rest of the tree. Source and scripts only, for the reason in
    // the header: a test names the string while asserting about it.
    const sources = walk(root).filter((f) => {
      if (f === CLIENT_FILE) return false;
      if (!/\.(ts|mjs|js)$/.test(f)) return false;
      if (/(^|\/)(test|tests|__tests__)\//.test(f)) return false;
      if (/\.test\.[a-z]+$/.test(f)) return false;
      return (
        /^apps\/[^/]+\/src\//.test(f) || /^packages\/[^/]+\/src\//.test(f) || /^scripts\//.test(f)
      );
    });
    for (const file of sources) {
      if (readFileSync(join(root, file), 'utf8').includes('setTypeParser')) {
        findings.push(
          `${file} names setTypeParser and ${CLIENT_FILE} is the only file that may. ` +
            'A SECOND PARSER MAKES THE WINNER DEPEND ON IMPORT ORDER, and correcting a day ' +
            'at the reader is the same defect multiplied once per reader (ADR-271). The ' +
            'parser is the one place the property can be made true for everything',
        );
      }
    }

    // A SENTINEL, on RI-24's precedent. Zero source files means the walk or the
    // filter stopped matching, at which point leg 2 passes by having read
    // nothing and the whole second trap is unguarded while the check reads PASS.
    if (sources.length === 0) {
      throw new Error(
        'RI-25 found no source file under any `apps/*/src`, `packages/*/src` or `scripts/` ' +
          `on a tree that DOES carry ${CLIENT_FILE}. Zero means the walk or the path filter ` +
          'has moved, at which point leg 2 is asserting about an empty list and a second ' +
          'type parser anywhere in the tree would report as absent',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-26  A TEMPORAL COLUMN'S NAME IS NOT FALSE ABOUT ITS OWN TYPE
// -----------------------------------------------------------------------------
// ADR-272'S PROPERTY, AND IT IS THE ONE ADR-271 SECTION 3 ALREADY REASONED FROM
// WITH NOTHING CHECKING IT.
//
// That entry bounded a live type parser's blast radius with this sentence: "an
// instant is spelled `*_at` and a day is spelled `*_day` or `*_on`, so the two
// vocabularies do not overlap and a parser aimed at one cannot reach the other.
// The rule was written as an API-surface refusal and it turns out to have been
// load bearing three layers down." A property a repair has already been argued
// from is a rule, whatever document it was written in, and until this check the
// argument was carried entirely by whoever named a column.
//
// THE PROPERTY IS NARROWER THAN "EVERY DATE COLUMN ANNOUNCES ITSELF", AND
// ADR-272 SECTION 3 IS WHY. A name that lies WITHIN the temporal vocabulary --
// `*_at` on a `date` -- hands a reader a wrong answer of the right shape, and
// nothing downstream can tell. A name that lies ACROSS type families --
// `daily_marks.win_day boolean` -- is refused by the first type the compiler,
// the driver or the planner gives it. Only the first survives contact with a
// type system, so only the first is a defect and only the first is checked here.
//
// TWO LEGS, EACH ASSERTED IN BOTH DIRECTIONS on `0027`'s float-column idiom,
// which data-model/README.md states as this estate's own shape for a ruled
// exception set: "an unlisted column fails, and so does a stale entry naming a
// column that no longer exists."
//
//   LEG 1  NO `*_at` COLUMN IS DECLARED WITH A NON-INSTANT TYPE. NO RULED
//          EXCEPTIONS REMAIN. `simulation_runs.calibration_observed_at` was the
//          one, and `0075` renamed it to `calibration_observed_on` (ADR-278),
//          so the entry came out in the commit that landed the repair.
//   LEG 2  NO COLUMN NAME IS DECLARED WITH A DAY TYPE IN ONE TABLE AND AN
//          INSTANT TYPE IN ANOTHER. One ruled exception, `effective_from`, a
//          `date` in six tables and a `timestamptz` in three. THIS LEG IS WHY
//          LEG 1 ALONE WOULD HAVE BEEN THE WRONG CHECK: the estate's measured
//          ambiguity arrived through a name carrying no suffix at all, so a
//          check reading only suffixes would have reported a clean tree over
//          nine tables that disagree about what one word means.
//
// THE POPULATION IS THE SCHEMA THE SET INSTALLS, NOT THE UNION OF ITS `CREATE
// TABLE` BODIES, AND ADR-278 IS WHY THOSE ARE NOW TWO DIFFERENT ANSWERS. Until
// `0075` this directory held zero `RENAME COLUMN` and zero `DROP COLUMN`
// statements, so a reader that summed declarations got the installed schema for
// free. `0075` renames a column `0045` declares, and constitution E2 makes
// `0045` uneditable, so the declaration stands forever and the column is gone.
//
// A READER THAT DID NOT FOLD THE RENAME WOULD HAVE FAILED THIS TREE FOR DOING
// THE REPAIR. Watched, before the fold was written: with the exception removed
// and the declarations summed, leg 1 reported `calibration_observed_at is
// declared \`date\` in 0045_simulation_runs.sql` and told a repaired estate to
// "rename it by a superseding migration". So renames are folded in file order,
// after each file's own declarations, and a `DROP COLUMN` THROWS rather than
// being ignored: this reader has no model for a column that stops existing, and
// silently asserting about one is the suppression list the exception sets were
// shaped to avoid.
//
// LEG 1 KEEPS A SENTINEL NOW THAT IT KEEPS NO EXCEPTION. The stale-entry half
// was leg 1's reverse assertion, and removing the last entry would have left the
// leg with nothing proving its reader still matches anything: a filter that
// stopped seeing `_at` columns would report a clean estate. ADR-272 measured 321
// `*_at` column declarations, so zero of them on a tree carrying migrations is a
// broken reader and throws.
//
// AN EXCEPTION IS ASSERTED ONLY WHERE ITS WITNESS MIGRATIONS ARE PRESENT, and
// that is a scoping rule rather than an escape hatch. An entry claims that a
// NAMED FILE declares a bad column; on a tree without that file the claim is
// not false, it is not about that tree. The synthetic fixture is such a tree.
// On a tree that DOES carry the witnesses, the stale-entry half is also the
// sentinel and it is stronger than a zero count: if the reader stops matching
// -- the DDL shape moves, the comment stripper breaks, the directory moves --
// the ruled exceptions stop being observed and BOTH legs report. A broken
// reader turns this check RED rather than green, which is the failure mode
// RI-24 and RI-25 each needed a separate sentinel to reach.
//
// WHAT IT CANNOT SEE, stated rather than left to be discovered.
//   (1) IT READS DDL AND NOT A DATABASE. A column added by a function body, by
//       `EXECUTE`, or from outside this directory is invisible here.
//   (2) IT READS `CREATE TABLE` BODIES AND `ADD COLUMN` CLAUSES ONLY, so a
//       plpgsql `DECLARE` block is excluded by construction: `0048:645`
//       declares `fold_extent date` as a local variable and is not a column.
//   (3) IT SAYS NOTHING ABOUT WHICH CALENDAR A DAY IS ON. `*_day` and `*_on`
//       are one vocabulary member here; API_CONTRACT section 1 makes both
//       exchange trading days and `chargeback_window_ends_on` is the card
//       networks' clock wearing the same suffix. ADR-272 section 6 records that
//       drift as owed, and no type settles it.
//   (4) IT CANNOT TELL A TRUE NAME FROM A MEANINGLESS ONE. `zzz_at timestamptz`
//       passes both legs.
const MIGRATIONS_DIR = 'packages/db/migrations';

// The two members of the temporal vocabulary, and nothing else is one. `time`
// and `interval` are neither a day nor an instant and the suffix rule has never
// been about them.
const DAY_TYPES = new Set(['date']);
const INSTANT_TYPES = new Set(['timestamptz', 'timestamp with time zone', 'timestamp']);

// THE RULED EXCEPTIONS. Each carries the migrations that WITNESS it and the
// ground it was ruled on. They are objects and not bare names because an entry
// with no stated ground is how an exception set becomes a suppression list, and
// an entry with no witness is one that can never be shown to be stale.
// EMPTY, AND THE EMPTINESS IS THE RECORD OF A REPAIR RATHER THAN AN OVERSIGHT.
// `calibration_observed_at` was the single entry. `0075` renamed it and ADR-278
// took the entry out in the same commit, because an exception outliving its
// defect is a control that has quietly stopped being one. The shape is kept for
// the next entry: witnesses and a stated ground, never a bare name.
/** @type {Map<string, { witnesses: string[], ground: string }>} */
const AT_SUFFIX_EXCEPTIONS = new Map();
const NAME_TYPE_COLLISION_EXCEPTIONS = new Map([
  [
    'effective_from',
    {
      witnesses: ['0004_catalog.sql', '0074_firm_parameters.sql'],
      ground:
        'ADR-272 clause 4. `date` in geo_restrictions, contract_specs, ' +
        'detector_definitions, statistic_definitions, loyalty_criteria and ' +
        'identity_signal_weights; `timestamptz` in wallet_spend_limits, price_floors and ' +
        'firm_parameters. Nine tables across nine merged migrations, and ADR-272 ' +
        'section 5 is why that repair is not one session',
    },
  ],
]);

/**
 * SQL comments out, on RI-25's seed.
 *
 * A migration in this estate carries more prose than DDL, and `0045`'s own
 * header names `calibration_observed_at` in three sentences ABOUT the column.
 * A reader that did not strip comments would find the subject in the text
 * discussing the subject, which is exactly how RI-25's first version passed on
 * a restored defect.
 *
 * @param {string} sql
 * @returns {string}
 */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

/**
 * A type phrase reduced to a temporal vocabulary member, or `null` for anything
 * that is not one.
 *
 * @param {string} raw
 * @returns {string | null}
 */
function temporalType(raw) {
  const words = raw.trim().toLowerCase().split(/\s+/);
  if (words[0] === 'date') return 'date';
  if (words[0] === 'timestamptz') return 'timestamptz';
  if (words[0] === 'timestamp') {
    return words.slice(0, 4).join(' ') === 'timestamp with time zone'
      ? 'timestamp with time zone'
      : 'timestamp';
  }
  return null;
}

/**
 * One `CREATE TABLE` body split on its TOP-LEVEL commas, so that a `CHECK (a,
 * b)` or a `numeric(10, 2)` is one segment rather than two.
 *
 * @param {string} body
 * @returns {string[]}
 */
function topLevelSegments(body) {
  /** @type {string[]} */
  const segments = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/**
 * A column definition with a temporal type, or `null` for a table-level
 * constraint and for every column that is not one.
 *
 * @param {string} segment
 * @returns {{ name: string, type: string } | null}
 */
function temporalColumnFrom(segment) {
  const trimmed = segment.trim();
  if (trimmed === '') return null;
  if (/^(constraint|primary|unique|check|foreign|exclude|like|deferrable)\b/i.test(trimmed)) {
    return null;
  }
  const m = /^([a-z_][a-z0-9_]*)\s+([a-z][a-z ]*)/i.exec(trimmed);
  const name = m?.[1];
  const declared = m?.[2];
  if (name === undefined || declared === undefined) return null;
  const type = temporalType(declared);
  return type === null ? null : { name: name.toLowerCase(), type };
}

/**
 * Every column rename ONE migration performs, oldest first within the file.
 *
 * ADR-278. `0075` is the first statement in this estate to change an existing
 * column, and without this the declaration sum stops being the installed schema.
 *
 * The optional `COLUMN` keyword is matched because PostgreSQL accepts the form
 * without it. `ALTER TABLE t RENAME TO u` does not match, which is correct: this
 * check keys on column NAME and never on table, so a table rename moves nothing
 * it can see. `RENAME CONSTRAINT a TO b` does match and is a harmless no-op,
 * because no temporal column is named by a constraint name.
 *
 * @param {string} sql
 * @returns {{ from: string, to: string }[]}
 */
function columnRenamesIn(sql) {
  /** @type {{ from: string, to: string }[]} */
  const out = [];
  const code = stripSqlComments(sql);
  const rename = /\bRENAME\s+(?:COLUMN\s+)?([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/gi;
  for (let m = rename.exec(code); m !== null; m = rename.exec(code)) {
    const from = m[1];
    const to = m[2];
    if (from === undefined || to === undefined) continue;
    out.push({ from: from.toLowerCase(), to: to.toLowerCase() });
  }
  return out;
}

/**
 * Every column ONE migration DROPS.
 *
 * There are none in this estate and this reader exists so that the first one
 * announces itself. A dropped column leaves its `CREATE TABLE` declaration
 * standing in a migration E2 forbids editing, so an unfolded drop would have
 * this check asserting about a column the database does not have -- which is
 * the exception set's own failure mode arriving through the reader instead.
 *
 * @param {string} sql
 * @returns {string[]}
 */
function droppedColumnsIn(sql) {
  /** @type {string[]} */
  const out = [];
  const code = stripSqlComments(sql);
  const drop = /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
  for (let m = drop.exec(code); m !== null; m = drop.exec(code)) {
    const name = m[1];
    if (name !== undefined) out.push(name.toLowerCase());
  }
  return out;
}

/**
 * Every temporal column DECLARED by one migration.
 *
 * `CREATE TABLE` bodies are found by paren depth rather than by line shape,
 * because a body closed on the same line as its last column is legal DDL and a
 * line-anchored reader would swallow the rest of the file as one table.
 *
 * @param {string} sql
 * @returns {{ name: string, type: string }[]}
 */
function temporalColumnsIn(sql) {
  const code = stripSqlComments(sql);
  /** @type {{ name: string, type: string }[]} */
  const out = [];

  const create = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[a-z_][a-z0-9_."]*\s*\(/gi;
  for (let m = create.exec(code); m !== null; m = create.exec(code)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i += 1) {
      if (code[i] === '(') depth += 1;
      else if (code[i] === ')') depth -= 1;
    }
    if (depth !== 0) continue;
    for (const segment of topLevelSegments(code.slice(start, i - 1))) {
      const column = temporalColumnFrom(segment);
      if (column !== null) out.push(column);
    }
  }

  // NINE OF THE ESTATE'S TEMPORAL COLUMNS ARRIVE THIS WAY and every one would
  // be invisible to a reader that only knew `CREATE TABLE`.
  const add = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+([a-z][a-z ]*)/gi;
  for (let m = add.exec(code); m !== null; m = add.exec(code)) {
    const name = m[1];
    const declared = m[2];
    if (name === undefined || declared === undefined) continue;
    const type = temporalType(declared);
    if (type !== null) out.push({ name: name.toLowerCase(), type });
  }

  return out;
}

const ri26 = {
  id: 'RI-26',
  title: 'A temporal column name is not false about its own type',
  covers:
    'A NAME THAT LIES INSIDE THE TEMPORAL VOCABULARY IS UNDETECTABLE AND A NAME ' +
    'THAT LIES ACROSS TYPE FAMILIES IS NOT, so only the first is checked. ' +
    `Population: THE SCHEMA THE SET INSTALLS. Every column declared by a ` +
    `\`CREATE TABLE\` body or an \`ADD COLUMN\` clause under \`${MIGRATIONS_DIR}\`, ` +
    'comments stripped first, with `RENAME COLUMN` folded in file order and ' +
    '`DROP COLUMN` a throw. Before `0075` the estate held neither statement and ' +
    'the sum of declarations WAS the installed schema; E2 makes a superseded ' +
    'declaration permanent, so those are two answers now (ADR-278). ' +
    'LEG 1: NO `*_at` COLUMN IS DECLARED WITH A NON-INSTANT TYPE. ADR-146 ' +
    'clause 2 makes `*_at` an assertion that the value is an RFC 3339 UTC ' +
    'instant, and ADR-271 section 3 bounded a live type parser from the ' +
    'schema-level half of that rule holding. ' +
    'LEG 2: NO COLUMN NAME IS DECLARED WITH A DAY TYPE IN ONE TABLE AND AN ' +
    'INSTANT TYPE IN ANOTHER -- the same harm reached through a name carrying ' +
    'no suffix at all, which is why leg 1 alone was the wrong check. ' +
    "BOTH LEGS BITE IN BOTH DIRECTIONS on `0027`'s idiom: an unlisted violator " +
    'fails and so does a ruled exception that has stopped being one, so the day ' +
    'either is repaired this check names the entry to retire. An exception is ' +
    'asserted only where the migrations it names are present, because an entry ' +
    'about `0004` is not a claim about a tree without `0004`. LEG 1 NOW CARRIES ' +
    'NO EXCEPTIONS AT ALL: ADR-278 retired the last one in the commit that ' +
    'landed its repair, and the reverse assertion that half provided is replaced ' +
    'by a throw on a tree that carries migrations and no `*_at` column. ' +
    'NOT CHECKED, AND RULED RATHER THAN MISSED (ADR-272 section 3): `*_day` and ' +
    '`*_on` on a NON-temporal type. `daily_marks.traded_day`, ' +
    '`daily_marks.win_day` and `trading_calendar.is_half_day` are `boolean`, ' +
    '`loyalty_criteria.breaks_on` is `text[]`; each is refused by the first type ' +
    'anything gives it, which is precisely what a `date` wearing `_at` is not. ' +
    'WHAT IT CANNOT SEE: a database, a column built by `EXECUTE`, WHICH ' +
    'CALENDAR a day is on (ADR-272 section 6 records that drift as owed), and ' +
    'whether a name means anything -- `zzz_at timestamptz` passes both legs. ' +
    'SILENT on a tree carrying no migrations directory. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    // SILENT ON A TREE THAT DECLARES NO SCHEMA, on RI-23, RI-24 and RI-25's
    // precedent. The witness rule below is what keeps this from being a way to
    // pass: on a tree that DOES carry the cited migrations, silence is a
    // finding rather than a skip.
    const dir = join(root, MIGRATIONS_DIR);
    if (!existsSync(dir)) return findings;

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const present = new Set(files);

    /** @type {Map<string, Map<string, string[]>>} column name -> type -> migrations */
    const declared = new Map();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      for (const { name, type } of temporalColumnsIn(sql)) {
        const byType = declared.get(name) ?? new Map();
        byType.set(type, [...(byType.get(type) ?? []), file]);
        declared.set(name, byType);
      }

      // A DROP HAS NO FOLD, SO IT THROWS. There are none in this estate; the
      // day one lands, this reader's model of the schema is wrong and it says
      // so instead of asserting about a column the database does not have.
      const dropped = droppedColumnsIn(sql);
      if (dropped.length > 0) {
        throw new Error(
          `RI-26 found \`DROP COLUMN\` in ${file} (${dropped.join(', ')}) and has no fold for ` +
            'one. A dropped column keeps its `CREATE TABLE` declaration in a migration E2 ' +
            'forbids editing, so this reader would go on asserting about a column that no ' +
            'longer exists. Teach the fold, or rule the drop into this check with its ground',
        );
      }

      // RENAMES ARE FOLDED AFTER THIS FILE'S OWN DECLARATIONS, in file order, so
      // that the answer is the schema the set INSTALLS rather than the sum of
      // what it declared along the way (ADR-278). The declaring migration stays
      // in the site list under the new name: it is still where the type came
      // from, and it is what a reader chasing the finding needs to open.
      for (const { from, to } of columnRenamesIn(sql)) {
        const moving = declared.get(from);
        if (moving === undefined) continue;
        declared.delete(from);
        const target = declared.get(to) ?? new Map();
        for (const [type, sites] of moving) {
          target.set(type, [...(target.get(type) ?? []), ...sites]);
        }
        declared.set(to, target);
      }
    }

    /** @param {{ witnesses: string[] }} entry */
    const witnessed = (entry) => entry.witnesses.every((w) => present.has(w));

    // LEG 1. The suffix, and the type behind it.
    /** @type {Set<string>} */
    const atViolators = new Set();
    for (const [name, byType] of declared) {
      if (!name.endsWith('_at')) continue;
      for (const type of byType.keys()) {
        if (INSTANT_TYPES.has(type)) continue;
        atViolators.add(name);
        if (AT_SUFFIX_EXCEPTIONS.has(name)) continue;
        findings.push(
          `${name} is declared \`${type}\` in ${(byType.get(type) ?? []).join(', ')}, and a ` +
            'name ending `_at` is ADR-146 clause 2 asserting that the value is an RFC 3339 ' +
            'UTC instant. The name is false about its own column, which is the one shape of ' +
            'wrongness no type system downstream can catch, and ADR-271 section 3 bounded a ' +
            "live type parser's blast radius from this property holding. Rename it by a " +
            'superseding migration, or rule the exception into RI-26 with its ground',
        );
      }
    }
    for (const [name, entry] of AT_SUFFIX_EXCEPTIONS) {
      if (!witnessed(entry) || atViolators.has(name)) continue;
      findings.push(
        `RI-26 carries ${name} as a ruled \`_at\` exception (${entry.ground}) and this tree ` +
          `carries ${entry.witnesses.join(', ')}, yet no column of that name is declared with ` +
          'a non-instant type any more. Either the repair landed and this entry is stale, or ' +
          'the reader stopped matching and every violator in the estate now reports as ' +
          'absent. Retire the entry or fix the reader',
      );
    }

    // LEG 2. One name, two temporal types, and no suffix to have warned anyone.
    /** @type {Set<string>} */
    const collisions = new Set();
    for (const [name, byType] of declared) {
      const days = [...byType.keys()].filter((t) => DAY_TYPES.has(t));
      const instants = [...byType.keys()].filter((t) => INSTANT_TYPES.has(t));
      if (days.length === 0 || instants.length === 0) continue;
      collisions.add(name);
      if (NAME_TYPE_COLLISION_EXCEPTIONS.has(name)) continue;
      const where = (/** @type {string} */ t) => `\`${t}\` in ${(byType.get(t) ?? []).join(', ')}`;
      findings.push(
        `${name} is declared ${days.map(where).join('; ')} and ${instants.map(where).join('; ')}. ` +
          'One name denotes a DAY in one table and an INSTANT in another, so reading the name ' +
          "settles nothing and no suffix warns anybody. This is ADR-146 clause 2's harm " +
          'arriving through a name that makes no claim at all (ADR-272 section 4). Give one ' +
          'side a name that says which it is, or rule the exception into RI-26 with its ground',
      );
    }
    for (const [name, entry] of NAME_TYPE_COLLISION_EXCEPTIONS) {
      if (!witnessed(entry) || collisions.has(name)) continue;
      findings.push(
        `RI-26 carries ${name} as a ruled day/instant collision (${entry.ground}) and this ` +
          `tree carries ${entry.witnesses.join(', ')}, yet the name no longer collides. ` +
          'Either the repair landed and this entry is stale, or the reader stopped matching. ' +
          'Retire the entry or fix the reader',
      );
    }

    // A THROW BESIDE THE STALE-ENTRY HALF, for the one case the stale-entry
    // half reports too gently: a tree carrying every witness migration and
    // parsing to nothing at all is not a repaired estate, it is a reader that
    // has stopped reading, and a check that cannot reach its inputs throws
    // rather than reporting findings (this file's rule 2).
    const witnesses = [...AT_SUFFIX_EXCEPTIONS.values(), ...NAME_TYPE_COLLISION_EXCEPTIONS.values()]
      .flatMap((entry) => entry.witnesses)
      .filter((w) => present.has(w));
    if (witnesses.length > 0 && declared.size === 0) {
      throw new Error(
        `RI-26 found no \`date\` and no \`timestamptz\` column under ${MIGRATIONS_DIR} on a ` +
          `tree that carries ${witnesses.join(', ')}. Those migrations declare both, so zero ` +
          'means the `CREATE TABLE` reader or the comment stripper has moved and every ' +
          'column in the schema now reports as untyped',
      );
    }

    // LEG 1'S SENTINEL, AND IT REPLACES ONE THAT WAS DELETED RATHER THAN ADDING
    // A NEW IDEA. Until ADR-278 the stale-entry half asserted leg 1's reader in
    // reverse; with the last `_at` exception retired that half asserts nothing,
    // and a suffix filter that stopped matching would report a clean estate over
    // every `*_at` column there is. ADR-272 measured 321 of them, so zero on a
    // tree that carries migrations is a broken reader and not a repaired schema.
    // The guard is `declared.size` and not `files.length`, because a tree whose
    // migrations declare NO temporal column is the fixture case this check is
    // deliberately silent on, and the throw above already covers a tree that
    // parses nothing while carrying the witnesses.
    if (declared.size > 0 && ![...declared.keys()].some((name) => name.endsWith('_at'))) {
      throw new Error(
        `RI-26 found no \`*_at\` temporal column among the ${declared.size} it read under ` +
          `${MIGRATIONS_DIR}. Leg 1 holds no exceptions since ADR-278, so ` +
          'this is the only thing left asserting its reader still matches: zero means the ' +
          'suffix test, the rename fold or the `CREATE TABLE` reader has moved and every ' +
          'violator in the estate now reports as absent',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-27  Every statement of the last-closed-trading-day fold is registered, and
//        each one's coverage disposition is the one the register claims
// -----------------------------------------------------------------------------
// ADR-273's PROPERTY, AND IT IS A PROPERTY OF THE TREE RATHER THAN OF A FILE.
//
// `R-06` permits an eligibility verdict against exactly one day, the LAST CLOSED
// one, and `ADR-042` F-4 rules that the last closed day MERIT KNOWS ABOUT is a
// different answer from the last closed day: a day outside `trading_calendar_loads`
// is UNKNOWN and unknown is not a holiday. `0032`'s own header calls confusing
// the two "the single most silent failure available to this table", because the
// wrong answer is a confident `YYYY-MM-DD` that every gate downstream reads
// without complaint.
//
// THE FOLD IS STATED THREE TIMES IN THIS TREE AND THE THREE PUT THE COVERAGE
// READ IN THREE DIFFERENT PLACES. ADR-273 ruled that this is safe wherever a
// TYPE makes forgetting a compile error and unsafe wherever only a convention
// does, and registered the one site where nothing holds it at all. What the
// ruling cannot do is survive a FOURTH statement landing in a package nobody
// was looking at, which is exactly the shape ADR-268 measured when it found the
// first two disagreeing.
//
// SO THE CENSUS IS THE CHECK. Every source file whose CODE names a session-close
// instant is either on the register with a stated disposition or is a finding.
// The needle is the close instant rather than the phrase "last closed day",
// because a fold is written with the column and named whatever its author likes:
// `readLastClosedTradingDay`, `lastClosedDay` and `lastClosedTradingDayStatement`
// are three names for one predicate already.
//
// COMMENTS ARE STRIPPED, ON `RI-25`'s SEED. That check's first version read the
// raw file and reported PASS with the call commented out, because the file's own
// header explained the repair at length. Every file on this register discusses
// this subject in prose; matching a mention would make the register agree with
// itself.
//
// LEG 2 IS WHAT KEEPS THE REGISTER FROM BECOMING A LIST OF NAMES. A file
// registered as consulting coverage must NAME THE COVERAGE TABLE in code, and
// the one registered as consulting none must not. Both directions are findings:
// coverage disappearing from a site that had it is the regression, and coverage
// APPEARING at the site that lacks it is good news that makes this register and
// ADR-273's finding 1 stale, which a reader needs told rather than hidden.
//
// WHAT IT CANNOT SEE: whether a fold that reads both tables reads them
// CORRECTLY, and whether a file-local fold has acquired a second caller inside
// its own module. Both are `apps/api/test/last-closed-day-coverage-split.test.ts`'s
// half, which drives the real readers over a calendar loaded past its coverage
// and parses `liability.ts` for the one-caller property. This check is only that
// the census is closed and that each entry is still what it says it is.

/**
 * A READ of `trading_calendar_loads`, MATCHED AS AN ACT RATHER THAN A MENTION.
 *
 * THE SEED THAT PROVED THE FIRST VERSION WRONG IS RECORDED IN ADR-273 SECTION 7.
 * Leg 2 originally asked whether the file NAMED the table at all, and
 * `liability.ts` was seeded by pointing `anchorCalendar` at `trading_calendar`
 * instead: the check reported PASS, because that module's three `uncovered`
 * refusals each quote the table name inside their own detail string. Comments
 * are stripped and STRING LITERALS ARE NOT, so on this subject the files richest
 * in explanatory text are the ones a mention-matcher cannot see through. This is
 * `RI-25`'s seed one class over.
 *
 * Two forms, and they are the two idioms this estate has: `ADR-112`'s keyed
 * accessor (`tx.rows('tradingCalendarLoads')`) and the drizzle table handle
 * (`TABLES.tradingCalendarLoads`). A THIRD idiom would report as absent, which
 * is the fail-closed direction: the finding names the file and a reader adds the
 * form.
 */
const READS_THE_LOADS_TABLE =
  /(?:\.\s*(?:rows|rowsWhere|rowAt)\s*\(\s*['"]tradingCalendarLoads['"]|\bTABLES\s*\.\s*tradingCalendarLoads\b)/;

/** Identifiers that mean "this file handles a session close instant". */
const CLOSE_INSTANT = /\b(?:sessionCloseAt|session_close_at|closeAtMs|closeMs)\b/;

/**
 * Every source file that may name one, and what it does with it.
 *
 * `coverage` IS THE ASSERTION AND NOT A LABEL. `consulted` means the file's own
 * code names `trading_calendar_loads`; `absent` means it must not; `n/a` is a
 * file that declares, registers or WRITES the column and folds nothing, so
 * coverage is not its question.
 */
const CLOSE_INSTANT_REGISTER = [
  {
    rel: 'apps/api/src/admin-source/liability.ts',
    coverage: 'consulted',
    what:
      'FOLDS. `lastClosedDay`, module-private, whose one caller `anchorCalendar` reads ' +
      '`trading_calendar_loads` and returns a discriminated union: the anchored day is ' +
      'unreachable without narrowing past an `uncovered` arm (ADR-273 ruling 2)',
  },
  {
    rel: 'apps/worker/src/batch/adapter.ts',
    coverage: 'consulted',
    what:
      'FOLDS, AND THE GAP IS CLOSED (ADR-277). `anchorLastClosedDay` and `anchorNamedDay` read ' +
      'BOTH tables in ONE transaction and return a `TradingDayAnchor` carrying the day on its ' +
      '`anchored` arm ALONE, so the caller cannot skip the verdict and compile. The fold itself ' +
      'is module-private now: `readLastClosedTradingDay` was exported and handed out a bare ' +
      '`TradingDay | null`, and `calendarCarriesDay` asked a coverage-shaped question of ' +
      '`trading_calendar`. THIS ROW READ `absent` FOR ONE WAVE AND THIS CHECK IS WHAT DEMANDED ' +
      'THE EDIT: ADR-268 finding 2 reported the fold, ADR-273 finding 1 enlarged it to the ' +
      'caller and registered it here precisely so that the session repairing it could not ' +
      'leave the register saying a gap exists that somebody had closed',
  },
  {
    rel: 'packages/db/src/scoped-db.ts',
    coverage: 'consulted',
    what:
      'FOLDS. `lastClosedTradingDayStatement`, the fourth named door (ADR-268), which reads ' +
      'BOTH tables itself and refuses an exhausted or gapped calendar. Nothing to forget',
  },
  {
    rel: 'packages/rules-engine/src/calendar.ts',
    coverage: 'required-input',
    what:
      'FOLDS A DIFFERENT QUESTION, `tradingDayAt`, and is the strongest of the four shapes: ' +
      '`SessionCalendarSource` REQUIRES both `sessions` and `coverage`, so a calendar cannot ' +
      'be BUILT without coverage, and the answer type carries `outside_coverage`. IT NAMES ' +
      'NO TABLE AND MUST NOT: the engine is pure and reads no schema, so its coverage read ' +
      'is a field of its own input type rather than a query',
  },
  {
    rel: 'packages/db/src/schema.ts',
    coverage: 'n/a',
    what: 'DECLARES the column. Folds nothing',
  },
  {
    rel: 'packages/db/src/scope.ts',
    coverage: 'n/a',
    what: "REGISTERS the table and names the column inside `tradingCalendar`'s `why`. Folds nothing",
  },
  {
    rel: 'packages/db/src/seed/calendars/generate.mjs',
    coverage: 'n/a',
    what: 'WRITES the column. The loader PRODUCES coverage rather than consulting it',
  },
];

const ri27 = {
  id: 'RI-27',
  title: 'Every last-closed-day fold is registered, with the coverage disposition it claims',
  covers:
    'A CONFIDENT DAY FOR A DATE THE ESTATE KNOWS NOTHING ABOUT IS A WRONG PAYOUT ' +
    'BASIS (ADR-042 F-4, ADR-273). Two legs. ONE: THE CENSUS IS CLOSED. Every ' +
    '`*.ts`, `*.mjs` and `*.js` under an `apps/*/src`, `packages/*/src` or ' +
    '`scripts/` directory is read with COMMENTS STRIPPED, and a file whose code ' +
    'names a session-close instant (`sessionCloseAt`, `session_close_at`, ' +
    '`closeAtMs`, `closeMs`) must be one of the ' +
    `${String(CLOSE_INSTANT_REGISTER.length)} registered sites. An unregistered ` +
    'one is a candidate FOURTH statement of `R-06`’s selection and needs an ADR; ' +
    'a registered one that no longer names it means the register is stale. ' +
    'TWO: EACH DISPOSITION STILL HOLDS. A site registered as consulting coverage ' +
    "must READ it — `.rows('tradingCalendarLoads')` or " +
    '`TABLES.tradingCalendarLoads`, an ACT and never a mention, because every ' +
    'refusal on this subject quotes the table name in its own detail string; ' +
    'the PURE one must instead ' +
    'declare a `readonly coverage` input and an `outside_coverage` answer, ' +
    'because an engine that reads no schema owes the read as a field rather ' +
    'than as a query; and the one registered as consulting none must name ' +
    'neither — in BOTH directions, because coverage vanishing is the regression ' +
    'and coverage arriving makes this register and ADR-273 finding 1 stale. ' +
    'THE NEEDLE IS THE COLUMN AND NOT THE PHRASE, because one predicate already ' +
    'carries three names in this tree. ' +
    'IT READS `src/` AND `scripts/` AND NOT TESTS, on RI-25’s reading: a suite ' +
    'names the identifier while asserting about it. ' +
    'WHAT IT CANNOT SEE: whether a two-table fold reads them CORRECTLY, and ' +
    'whether a file-local fold has gained a second caller inside its own module. ' +
    'Both are `apps/api/test/last-closed-day-coverage-split.test.ts`’s half. ' +
    'SILENT on a tree where NO source file handles a session close at all, ' +
    'which is the synthetic fixture: silence is keyed on the subject rather ' +
    'than on a registered path, because the fixture writes stubs at two of ' +
    'those paths. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const present = CLOSE_INSTANT_REGISTER.filter((entry) => existsSync(join(root, entry.rel)));

    const sources = walk(root).filter((f) => {
      if (!/\.(ts|tsx|mjs|js)$/.test(f)) return false;
      if (/(^|\/)(test|tests|__tests__)\//.test(f)) return false;
      if (/\.test\.[a-z]+$/.test(f)) return false;
      return (
        /^apps\/[^/]+\/src\//.test(f) || /^packages\/[^/]+\/src\//.test(f) || /^scripts\//.test(f)
      );
    });

    // A SENTINEL, on RI-24's and RI-25's precedent. Zero source files on a tree
    // that DOES carry a registered file means the walk or the path filter has
    // moved, at which point leg 1 passes by having read nothing and a fourth
    // statement of the fold anywhere in the tree reports as absent.
    if (sources.length === 0 && present.length > 0) {
      throw new Error(
        'RI-27 found no source file under any `apps/*/src`, `packages/*/src` or `scripts/` ' +
          'on a tree that DOES carry a registered fold. Zero means the walk or the path ' +
          'filter has moved, at which point leg 1 is asserting about an empty list',
      );
    }

    /** Every source file whose CODE handles a session close instant, read once. */
    const naming = new Set(
      sources.filter((f) => CLOSE_INSTANT.test(stripComments(readFileSync(join(root, f), 'utf8')))),
    );

    // SILENT ON A TREE THAT HOLDS NO CALENDAR AT ALL, on RI-23, RI-24 and
    // RI-25's precedent, and the condition is the SUBJECT rather than a file
    // name. The synthetic scaffold fixture writes a `scope.ts` and a
    // `scoped-db.ts` of its own, so keying silence on a registered PATH would
    // have made this check report a stale register against a stub; keying it on
    // whether any file in the tree handles a session close is the question this
    // check is actually about, and a tree with no fold has no census to close.
    if (naming.size === 0) return findings;

    const registered = new Map(CLOSE_INSTANT_REGISTER.map((entry) => [entry.rel, entry]));

    // LEG 1. The census, in both directions.
    for (const file of sources) {
      const names = naming.has(file);
      const entry = registered.get(file);

      if (names && entry === undefined) {
        findings.push(
          `${file} names a session-close instant in CODE and is not on RI-27's register. ` +
            'A file that handles `session_close_at` is a candidate statement of `R-06`’s ' +
            'selection, and this tree already holds three of them putting the coverage read ' +
            'in three different places (ADR-273). Either it folds a last-closed day, in ' +
            'which case an ADR rules where its coverage check lives before it acquires a ' +
            'caller, or it does not, in which case add it to the register with `coverage: ' +
            "'n/a'` and say what it does",
        );
      }

      if (!names && entry !== undefined) {
        findings.push(
          `${file} is on RI-27's register as "${entry.what}" and its code no longer names a ` +
            'session-close instant. The register is stale: either the fold moved, in which ' +
            'case the new home needs its row here, or the file stopped being about this ' +
            'subject, in which case remove the row and say so in ADR-273’s successor',
        );
      }
    }

    // LEG 2. Each disposition, asked of the file rather than of the register.
    for (const entry of present) {
      if (entry.coverage === 'n/a') continue;
      const code = stripComments(readFileSync(join(root, entry.rel), 'utf8'));
      const consults = READS_THE_LOADS_TABLE.test(code);

      // A PURE MODULE CANNOT NAME A TABLE AND IS NOT EXCUSED FROM COVERAGE.
      // `packages/rules-engine` reads no schema by construction, so the read it
      // owes is a REQUIRED FIELD of its own input type and an answer that can
      // say `outside_coverage`. Asserting the table name of it would be asking
      // the engine to import a database.
      if (entry.coverage === 'required-input') {
        const declares = code.indexOf('interface SessionCalendarSource {');
        const block = declares === -1 ? '' : code.slice(declares, code.indexOf('}', declares));
        if (
          !/\breadonly coverage\s*:\s*readonly CoverageInterval\[\]/.test(block) ||
          !code.includes('outside_coverage')
        ) {
          findings.push(
            `${entry.rel} is registered as taking coverage AS A REQUIRED INPUT ` +
              `("${entry.what}") and its code no longer declares a \`readonly coverage\` ` +
              'field or no longer carries the `outside_coverage` answer. A calendar that can ' +
              'be built without coverage places an instant inside a span nobody loaded, and ' +
              'ADR-042 F-4 rules that day UNKNOWN rather than a session',
          );
        }
        continue;
      }

      if (entry.coverage === 'consulted' && !consults) {
        findings.push(
          `${entry.rel} is registered as CONSULTING coverage ("${entry.what}") and its code ` +
            "does not READ the loads table: no `.rows('tradingCalendarLoads')` and no " +
            '`TABLES.tradingCalendarLoads`. A MENTION IS NOT A READ and this check will not ' +
            "accept one, because every refusal on this subject quotes the table's name in " +
            'its own detail string. A last-closed-day fold without the coverage read answers ' +
            'a CONFIDENT day for a date outside `trading_calendar_loads`, which ADR-042 F-4 ' +
            'rules UNKNOWN and 0032 calls the single most silent failure available to this ' +
            'table',
        );
      }

      if (entry.coverage === 'absent' && consults) {
        findings.push(
          `${entry.rel} is registered as consulting NO coverage ("${entry.what}") and its ` +
            'code now names the loads table. THIS IS THE GAP CLOSING AND IT IS GOOD NEWS, ' +
            'and it makes this register and ADR-273 finding 1 wrong. Change this row to ' +
            "`coverage: 'consulted'` in the same commit and record the repair, so the next " +
            'reader is not told a gap exists that somebody already closed',
        );
      }
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-28  No shipped source file reads the process's local clock
// -----------------------------------------------------------------------------
// ADR-274's PROPERTY, AND IT IS THE REASON A DEPLOYMENT'S `TZ` DOES NOT DECIDE
// ANYTHING. ADR-268 section 7 ended on the sentence this check exists to make
// mechanical: "the correctness of every trading day in the estate currently
// rests on an environment variable nobody has written down." ADR-271 removed
// the driver's half of that. THIS IS THE OTHER HALF, and it is the larger one:
// the driver was one library doing one coercion, and this is every line anybody
// writes from here on.
//
// THE ALTERNATIVE WAS A `TZ=UTC` LINE IN A RUNBOOK AND IT IS REFUSED. Nothing
// in this repository can read a deployment's environment, so a stated `TZ`
// requirement would be a control nobody checks -- and it would be checking the
// wrong thing anyway. `TZ` matters only because code asks what it is. Code that
// never asks is correct at every offset, which is a stronger property than a
// setting, and unlike a setting it is checkable from here.
//
// FOUR GROUPS, AND EACH IS A DIFFERENT WAY TO ASK.
//
//   1. READING a local clock field: `getHours`, `getDate`, `getTimezoneOffset`
//      and their siblings. The `getUTC*` spellings are the admitted ones and
//      are different names, so they do not match.
//   2. WRITING one: `setHours`, `setDate` and their siblings. Same rule.
//   3. RENDERING through one: `toLocaleString`, `toDateString`, `toTimeString`
//      and the two `toLocale*` date forms. `toISOString()` is UTC and is what
//      this tree uses everywhere.
//   4. CONSTRUCTING one: the multi-argument `new Date(y, m, d, ...)`, which is
//      LOCAL midnight. `new Date(Date.UTC(...))` is the admitted spelling and
//      is one argument, so the arguments are counted rather than the commas.
//
// PLUS TWO NAMED ASKS. `Intl.DateTimeFormat` without a `timeZone` formats in
// the process's zone, so every construction must name one -- both of the two in
// this tree do, `apps/portal/src/view/economic-calendar.ts` and
// `packages/db/src/seed/calendars/generate.mjs`. And `process.env.TZ` is the
// question asked in words.
//
// WHAT IT CANNOT SEE, AND BOTH ARE REAL:
//
//   1. `Date.prototype.toString`, reached by `String(at)`, `${at}` or `at + ''`.
//      That is local, it is invisible to any text scan, and no spelling of it
//      is distinguishable from the same operation on a number.
//   2. A LENIENT PARSE. `new Date(s)` and `Date.parse(s)` read a date-time
//      string carrying NO offset as LOCAL, per the ECMAScript grammar. Whether
//      that is reachable depends on where `s` comes from, which is a type
//      question rather than a text one. ADR-274 section 5 measured the one site
//      in this estate where a caller supplies that string, and it is reported
//      there rather than caught here.
//
// COMMENTS ARE STRIPPED FIRST, ON RI-25's SEED. That check's first version
// reported PASS on a restored defect because the file's own header explained
// the repair at length and the matcher found the explanation. This file's
// subject has the same shape: the places that talk most about a local clock are
// the headers of the files that refuse to use one.
//
// TESTS ARE OUT OF SCOPE, and deliberately. `packages/db/test/date-column-
// timezone.test.ts` builds `new Date(2026, 7, 28)` on purpose at five process
// timezones, and `scripts/demo/test/replay-determinism.property.test.ts` calls
// `toDateString()` as its declared impure control. Both are asserting ABOUT the
// construct. Using one is an act and lives under a `src/`.

/**
 * The local-clock spellings, by group, with the admitted alternative named.
 *
 * THE FOURTH COLUMN IS WHICH TEXT THE PATTERN READS, AND ADR-279 IS WHY IT
 * EXISTS. Three of these four hunt a CALL, and a call cannot occur inside a
 * string literal, so they read the text with literals BLANKED: otherwise
 * `scripts/ci/falsify-ci.mjs`, whose whole job is to hold the TEXT of seeded
 * violations, is a finding for carrying `value.toLocaleString()` as the
 * CI-02/RE-D-02 seed. The FOURTH names an environment key AS A STRING, so
 * blanking would delete the evidence and the leg would stop working; it reads
 * the text with only comments removed. Both texts are the same length with the
 * same newlines, so one `lineAt` is true of either.
 *
 * @type {ReadonlyArray<readonly [string, RegExp, string, 'blanked' | 'literal']>}
 */
const LOCAL_CLOCK_READS = [
  [
    'reads',
    /\.get(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\s*\(/g,
    'the `getUTC*` form',
    'blanked',
  ],
  [
    'writes',
    /\.set(FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\s*\(/g,
    'the `setUTC*` form',
    'blanked',
  ],
  [
    'renders through',
    /\.to(LocaleString|LocaleDateString|LocaleTimeString|DateString|TimeString)\s*\(/g,
    '`toISOString()`, which is UTC',
    'blanked',
  ],
  [
    'asks for',
    /process\.env\s*(?:\[\s*['"]TZ['"]\s*\]|\.TZ\b)/g,
    'nothing: no Merit line needs it',
    'literal',
  ],
];

/**
 * The text between a call's parentheses, plus its non-empty top-level arguments.
 *
 * `open` is the index of the `(`. Nesting, quotes and template literals are all
 * respected, because `new Date(Date.UTC(y, m, d))` carries two commas that
 * belong to the inner call and `new Date(`${day}T00:00:00Z`)` carries none that
 * belong to anything. A TRAILING COMMA IS NOT AN ARGUMENT: prettier writes one
 * whenever a single argument spans lines, and counting commas rather than
 * arguments reported `packages/kyc/src/fakes/provider.ts` as a local
 * construction while this was being written.
 *
 * @param {string} code
 * @param {number} open
 * @returns {{ text: string, args: string[] } | null} null when unbalanced
 */
function callArguments(code, open) {
  let depth = 0;
  let close = -1;
  /** @type {number[]} */
  const commas = [];
  /** @type {string | null} */
  let quote = null;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (c === ',' && depth === 1) commas.push(i);
  }
  if (close === -1) return null;
  const cuts = [open, ...commas, close];
  /** @type {string[]} */
  const args = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const from = cuts[k];
    const to = cuts[k + 1];
    if (from === undefined || to === undefined) continue;
    const piece = code.slice(from + 1, to);
    if (piece.trim() !== '') args.push(piece);
  }
  return { text: code.slice(open + 1, close), args };
}

const ri28 = {
  id: 'RI-28',
  title: 'No shipped source file reads the process timezone',
  covers:
    'A DEPLOYMENT`S `TZ` DECIDES NOTHING BECAUSE NO SHIPPED LINE ASKS WHAT IT IS ' +
    '(ADR-274). Every `*.ts`, `*.tsx`, `*.mts`, `*.mjs` and `*.js` under an ' +
    '`apps/*/src`, `packages/*/src` or `scripts/` directory is read with ' +
    'comments stripped, and six spellings are findings. FOUR ARE THE LOCAL ' +
    'CLOCK ITSELF: a local component getter (`getHours`, `getDate`, ' +
    '`getTimezoneOffset` and siblings), a local setter, a local rendering ' +
    '(`toLocaleString`, `toDateString`, `toTimeString`, `toLocaleDateString`, ' +
    '`toLocaleTimeString`), and a `process.env.TZ` read. The `getUTC*` and ' +
    '`setUTC*` forms are different names and do not match; `toISOString()` is ' +
    'UTC and is what this tree uses. ' +
    'FIFTH: the MULTI-ARGUMENT `new Date(y, m, d, ...)`, which is LOCAL ' +
    'midnight and is the exact call ADR-268 section 7 found `pg` making. ' +
    'Arguments are counted with nesting, quotes and template literals ' +
    'respected, so `new Date(Date.UTC(...))` is ONE argument and is admitted, ' +
    'and a trailing comma is not an argument. ' +
    'SIXTH: an `Intl.DateTimeFormat` construction that names no `timeZone`, ' +
    'which formats in the process`s zone. Both constructions in this tree name ' +
    'one. ' +
    'COMMENTS AND STRING LITERALS ARE BOTH REMOVED FIRST (ADR-279), through the ' +
    'one scanner in `packages/tooling/checks/strip-comments.mjs`: a spelling ' +
    'written in prose or inside a quoted string is not a call, and ' +
    '`scripts/ci/falsify-ci.mjs` holds the text of seeded violations as its ' +
    'whole subject. A TEMPLATE SUBSTITUTION IS CODE and survives blanking, so ' +
    '`${at.getHours()}` is still a finding. ' +
    'IT READS `src/` AND `scripts/` AND NOT TESTS, because a test legitimately ' +
    'builds these on purpose: `packages/db/test/date-column-timezone.test.ts` ' +
    'constructs a local `Date` at five zones and ' +
    '`scripts/demo/test/replay-determinism.property.test.ts` calls ' +
    '`toDateString()` as its declared impure control. ' +
    'WHAT IT CANNOT SEE, both stated in ADR-274 rather than implied: ' +
    '`Date.prototype.toString` reached through `String(at)` or `${at}`, which ' +
    'no text scan can distinguish from the same operation on a number; and a ' +
    'LENIENT PARSE, `new Date(s)` or `Date.parse(s)` on a date-time string ' +
    'carrying no offset, which ECMAScript reads as LOCAL and whose ' +
    'reachability is a type question. ADR-274 section 5 measured the one ' +
    'caller-supplied site in this estate and reports it there. ' +
    'THIS CHECK IS NOT A `TZ` REQUIREMENT AND DELIBERATELY NOT: nothing here ' +
    'can read a deployment`s environment, so a stated setting would be a ' +
    'control nobody checks. This is the property that makes the setting ' +
    'irrelevant, which is checkable from here. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const sources = walk(root).filter((f) => {
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(f)) return false;
      if (/(^|\/)(test|tests|__tests__|e2e|fixtures)\//.test(f)) return false;
      if (/\.(test|spec)\.[a-z]+$/.test(f)) return false;
      return (
        /^apps\/[^/]+\/src\//.test(f) || /^packages\/[^/]+\/src\//.test(f) || /^scripts\//.test(f)
      );
    });

    // A SENTINEL, on RI-24's and RI-25's precedent. Zero source files means the
    // walk or the path filter has moved, at which point every leg below passes
    // by having read nothing and the whole property is unguarded while the
    // check reads PASS. The synthetic fixture writes several `apps/*/src`
    // files, so this fires on a broken filter rather than on a small tree.
    if (sources.length === 0) {
      throw new Error(
        'RI-28 found no source file under any `apps/*/src`, `packages/*/src` or `scripts/`. ' +
          'Zero means the walk or the path filter has moved, at which point every leg is ' +
          'asserting about an empty list and a local clock read anywhere in the tree would ' +
          'report as absent',
      );
    }

    for (const file of sources) {
      // TWO READINGS OF THE SAME FILE, THE SAME LENGTH AND THE SAME LINES.
      // `withLiterals` has only comments removed; `code` also has every string
      // literal's CONTENT blanked, character for character, so an index into
      // one is the same index into the other. Which pattern reads which is
      // stated per entry in `LOCAL_CLOCK_READS` and above each block below.
      const source = readFileSync(join(root, file), 'utf8');
      const withLiterals = stripComments(source);
      const code = stripComments(source, { literals: 'blank' });
      /** @param {number} index */
      const lineAt = (index) => code.slice(0, index).split('\n').length;

      for (const [verb, pattern, instead, over] of LOCAL_CLOCK_READS) {
        for (const m of (over === 'blanked' ? code : withLiterals).matchAll(pattern)) {
          findings.push(
            `${file}:${lineAt(m.index ?? 0)} ${verb} the process's local clock, as ` +
              `\`${(m[0] ?? '').trim()}\`. A calendar day has no timezone and an instant is ` +
              'stored in UTC (CLAUDE.md), so a local clock field is a third answer that ' +
              `moves with a deployment's \`TZ\` and appears in no diff. Use ${instead}`,
          );
        }
      }

      // THE LOCAL CONSTRUCTOR. Counted rather than pattern-matched, because the
      // admitted spelling `new Date(Date.UTC(y, m, d))` carries the same commas.
      for (const m of code.matchAll(/\bnew\s+Date\s*\(/g)) {
        const call = callArguments(code, (m.index ?? 0) + m[0].length - 1);
        if (call === null || call.args.length < 2) continue;
        findings.push(
          `${file}:${lineAt(m.index ?? 0)} constructs a \`Date\` from ${call.args.length} ` +
            "components, which is the PROCESS'S LOCAL midnight. That is the exact call " +
            'ADR-268 section 7 found `pg` making on every `date` column, and it read ' +
            '`2026-08-28` as `2026-08-27` east of UTC. Use `new Date(Date.UTC(...))`',
        );
      }

      // A FORMATTER THAT NAMES NO ZONE FORMATS IN THE PROCESS'S.
      for (const m of code.matchAll(/\bIntl\.DateTimeFormat\s*\(/g)) {
        const call = callArguments(code, (m.index ?? 0) + m[0].length - 1);
        if (call === null || /\btimeZone\b/.test(call.text)) continue;
        findings.push(
          `${file}:${lineAt(m.index ?? 0)} constructs an \`Intl.DateTimeFormat\` naming no ` +
            "`timeZone`, so it formats in the PROCESS'S zone. Name the zone the render is " +
            'for: `packages/db/src/seed/calendars/generate.mjs` names the exchange`s and ' +
            '`apps/portal/src/view/economic-calendar.ts` names the viewer`s',
        );
      }
    }

    return findings;
  },
};

// ADR-275's PROPERTY: THE REGISTER THAT NAMES THESE CHECKS IS READ BY NOTHING,
// SO A CHECK CAN LAND WITHOUT ITS ROW AND NO GATE IN THIS TREE NOTICES.
//
// The register is the `RI-nn` table in `docs/decisions/ALLOCATION.md`. Its own
// rule, written above it, is that "THE ROWS ARE READ OUT OF repo-invariants.mjs's
// `CHECKS` ARRAY, NEVER TYPED", and until this check nothing enforced either
// half of that sentence. The evidence is not anecdotal: `RI-14`, `RI-19`,
// `RI-20` and `RI-25` each landed without their row, and in wave BA three of
// the last four numbers were spent without their row or without their number.
//
// WHAT IT FOUND ON ITS FIRST RUN, and all of it was invisible to every other
// gate: `RI-11` was in `CHECKS` with NO ROW AT ALL, and four rows -- `RI-08`,
// `RI-18`, `RI-27` and `RI-28` -- did not carry the title the live array holds,
// two of them while asserting in their own text that the title was copied out
// of it. `RI-08`'s and `RI-18`'s titles are COMPUTED from a list in the check,
// which is exactly the case a typed copy cannot survive.
//
// THREE LEGS, THE FIRST TWO IN BOTH DIRECTIONS on `0027`'s idiom.
//
//   1. CHECK -> ROW. Every `id` in the live `CHECKS` array has exactly one row.
//   2. ROW -> CHECK. Every `RI-nn` row names a check that exists. A row whose
//      id is in `CHECKS` is satisfied by that. A row whose id is NOT -- `RI-17`
//      is the one on this tree, and its own cell says so -- must name, as a
//      markdown link, a source file that exists and that carries the id. That
//      is derived from the row rather than from a list kept here, because a
//      list of exemptions inside the check is the second copy this register
//      exists to end.
//   3. TITLE DRIFT, and it is where the value is. The third column must carry
//      the live title VERBATIM. A row whose title has drifted is a row nobody
//      re-read, and a computed title makes that certain rather than likely.
//
// A MALFORMED ROW IS A FINDING RATHER THAN A SKIP. A line that opens with a
// backticked `RI-nn` cell and does not carry the register's three cells is an
// orphan fragment: `RI-23`'s row sat that way for a wave, seen by no table gate
// because `CI-06/table-row-width` never parsed it as part of any table.
//
// WHAT IT CANNOT SEE, AND IT IS THE HALF THAT LET ONE WAVE SPEND ONE NUMBER
// THREE TIMES. Nothing here reads the register's next-free note against a
// DISPATCH, because a dispatch is not a file in this repository. ADR-275
// section 6 rules that rather than inventing a control nobody runs, on
// ADR-274's precedent one wave earlier with `TZ`.

/** The document holding the invariant register, relative to the repo root. */
const REGISTER_DOC = 'docs/decisions/ALLOCATION.md';

/** A register body row: a backticked `RI-nn` in the first cell. */
const REGISTER_ROW = /^\|\s*`(RI-\d+)`\s*\|/;

/** Cells split on unescaped pipes, so a `\|` inside a title stays in its cell. */
const CELL_SPLIT = /(?<!\\)\|/;

/** The extensions a register row may name as a check's home. */
const CHECK_HOME = /\.(ts|tsx|mts|mjs|js)$/;

const ri29 = {
  id: 'RI-29',
  title: 'Every check has one register row and every register row has a check, with the live title',
  covers:
    'THE `RI-nn` REGISTER IN `docs/decisions/ALLOCATION.md` AGAINST THE LIVE ' +
    '`CHECKS` ARRAY, BOTH DIRECTIONS (ADR-275). Every line in that document ' +
    'opening with a backticked `RI-nn` cell is a register row, wherever it ' +
    'sits, so an orphan fragment outside the table is read rather than ' +
    'skipped. FIRST: every `id` in `CHECKS` has EXACTLY ONE row, so a check ' +
    'landing without its row is a finding instead of being invisible. ' +
    'SECOND: every row names a check that EXISTS -- membership of `CHECKS` ' +
    'for a row whose id is in it, and otherwise a markdown link in the row`s ' +
    'own third cell to a `.ts`, `.tsx`, `.mts`, `.mjs` or `.js` file that ' +
    'exists and carries the id. `RI-17` is the one such row on this tree and ' +
    'its cell already names its home. NO EXEMPTION LIST IS KEPT HERE, ' +
    'because a list of exceptions inside the check is the second copy this ' +
    'register exists to end. THIRD: the third cell carries the live `title` ' +
    'VERBATIM, which is the register`s own stated rule and the leg that ' +
    'catches a row nobody re-read. A THREE-CELL SHAPE IS REQUIRED, on ' +
    '`CI-06/table-row-width`s blind spot: that gate never parses a fragment ' +
    'sitting outside a table, and `RI-23`s row sat that way for a wave. ' +
    'IT ASSERTS NOTHING ABOUT THE SECOND AND THIRD COLUMNS BEYOND ' +
    'CONTAINMENT: a row may say more than the title and usually does, and a ' +
    'row that names a home file which merely MENTIONS the id passes, which ' +
    'is a text read and is stated rather than implied. AND IT CANNOT SEE A ' +
    'DISPATCH: nothing here reads the register`s next-free note against the ' +
    'prompts a wave is dispatched with, which is what let one wave reserve ' +
    'one number three times, and a dispatch is not a file in this ' +
    'repository. ADR-275 section 6 rules that rather than inventing a ' +
    'control nobody runs. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const docPath = join(root, REGISTER_DOC);
    if (!existsSync(docPath)) {
      throw new Error(
        `RI-29 cannot run: ${REGISTER_DOC} does not exist, and it is the register this ` +
          'check reads. A missing register is not an empty one',
      );
    }

    /** @type {Map<string, { line: number, cells: string[] }[]>} */
    const rows = new Map();
    const lines = readFileSync(docPath, 'utf8').split('\n');
    lines.forEach((text, index) => {
      const matched = REGISTER_ROW.exec(text);
      if (matched === null) return;
      const id = matched[1] ?? '';
      const cells = text
        .split(CELL_SPLIT)
        .slice(1, -1)
        .map((cell) => cell.trim());
      const seen = rows.get(id) ?? [];
      seen.push({ line: index + 1, cells });
      rows.set(id, seen);
    });

    // A SENTINEL, on RI-24's, RI-25's and RI-28's precedent. Zero rows means
    // the register moved, was renamed, or stopped being written as a table --
    // at which point leg 2 and leg 3 are asserting about an empty list. Leg 1
    // would still be loud, and that is exactly the trap: it would report every
    // check as unregistered and name the wrong defect. Zero is an ERROR.
    if (rows.size === 0) {
      throw new Error(
        `RI-29 found no \`RI-nn\` row in ${REGISTER_DOC}. Zero means the register moved or ` +
          'stopped being a table, at which point the row-to-check and title legs assert ' +
          'about an empty list and the check-to-row leg names the wrong defect',
      );
    }

    for (const [id, seen] of rows) {
      for (const row of seen) {
        if (row.cells.length === 3) continue;
        findings.push(
          `${REGISTER_DOC}:${row.line} opens a \`${id}\` register row carrying ` +
            `${row.cells.length} cell(s) where the register declares 3. A fragment sitting ` +
            'outside the table is read by no table gate: `CI-06/table-row-width` parses ' +
            'rows of tables and this is not one. Fold it back into the register as ' +
            'Number, Claimed by, What it asserts',
        );
      }
      if (seen.length > 1) {
        findings.push(
          `${REGISTER_DOC}:${seen.map((row) => row.line).join(',')} holds ${seen.length} ` +
            `register rows for \`${id}\` where the register admits exactly one. Two rows ` +
            'for one number is how a renumber gets recorded in one place and missed in ' +
            'the other. Amend the row in place rather than joining it (ADR-065 T3)',
        );
      }
    }

    const live = new Set(CHECKS.map((check) => check.id));

    for (const check of CHECKS) {
      if (rows.has(check.id)) continue;
      findings.push(
        `${REGISTER_DOC} carries no register row for \`${check.id}\`, which the live ` +
          `\`CHECKS\` array holds with the title "${check.title}". A check that lands ` +
          'without its row is invisible to every other gate in this tree, which is ' +
          'the defect ADR-275 exists for. Write the row in the same commit as the check',
      );
    }

    const registerDir = dirname(REGISTER_DOC);
    for (const [id, seen] of rows) {
      if (live.has(id)) continue;
      for (const row of seen) {
        const named = [...row.cells.join(' ').matchAll(/\]\(([^)\s]+)\)/g)]
          .map((match) => match[1] ?? '')
          .filter((target) => CHECK_HOME.test(target));
        const backing = named.find((target) => {
          const abs = resolve(root, registerDir, target);
          return existsSync(abs) && readFileSync(abs, 'utf8').includes(id);
        });
        if (backing !== undefined) continue;
        findings.push(
          `${REGISTER_DOC}:${row.line} registers \`${id}\`, which is not in the live ` +
            '`CHECKS` array and whose row names no source file that exists and carries ' +
            'the id. A number in the register with no check behind it is a claim about ' +
            'a control nobody runs. Either the check is gone and the row should say so, ' +
            'or the row should link the file it lives in, as `RI-17`s row does',
        );
      }
    }

    for (const check of CHECKS) {
      for (const row of rows.get(check.id) ?? []) {
        const asserts = row.cells[2];
        if (asserts === undefined || asserts.includes(check.title)) continue;
        findings.push(
          `${REGISTER_DOC}:${row.line} states what \`${check.id}\` asserts without ` +
            `carrying the title the live \`CHECKS\` array holds: "${check.title}". The ` +
            'register`s own rule is that a row`s title is read out of that array and ' +
            'never typed, so a title that has drifted is a row nobody re-read. Copy it ' +
            'out of the array rather than restating it',
        );
      }
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-30  One comment stripper, in packages/tooling, and every parser imports it
// -----------------------------------------------------------------------------
// ADR-279's PROPERTY, AND IT IS `FM-16` IN THE TOOLING. Seven files declared a
// comment stripper, an eighth was found while writing this, and six of the eight
// were the same three-line idiom:
//
//     source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
//
// The block pass runs FIRST and cannot tell that a block-comment OPENER sits
// inside a LINE comment, so a header quoting a glob opens a phantom block that
// runs to the next real closer. On `apps/worker/src/index.ts` that idiom strips
// 55,728 characters to 2,753, and a `new Date().getHours()` seeded inside the
// phantom span was INVISIBLE to `RI-28`, which reported PASS.
//
// **THE DIRECTION IS WHAT MAKES THIS WORTH A CHECK.** A PRESENCE assertion over
// an emptied file goes red and somebody looks. An ABSENCE check over an emptied
// file goes GREEN, and four of the six naive sites were absence checks. That is
// ADR-274's own warned defect class landing inside the check ADR-274 shipped,
// and ADR-277 section 8 said in as many words that a defect deferred to a row
// nobody has written was becoming the pattern rather than the exception.
//
// TWO LEGS, AND THE SECOND IS THE DURABLE ONE.
//
//   1. THE NAME. No file but the home declares a binding named `stripComments`
//      or any `strip*Comment*` spelling. That is the name all eight used and it
//      is what a ninth will be called.
//   2. THE IDIOM, WHICH IS NAME-BLIND. No file but the home carries a
//      `.replace()` over a block-comment or line-comment regex. This catches a
//      copy under a different name, and it catches one written inline with no
//      function at all, which is the form a hurried session actually writes.
//
// ONE FILE IS ADMITTED AND THE ADMISSION IS ASSERTED RATHER THAN TRUSTED.
// `packages/tooling/test/strip-comments.test.ts` reproduces the naive idiom
// VERBATIM, because every case in it is a comparison against the thing being
// repaired and a repair with no record of what it repaired is a repair the next
// session undoes. So the admission is one named path, and the check THROWS if
// that file stops existing or stops carrying the idiom, which is what stops the
// exception quietly becoming a hole.
//
// IT READS WITH LITERALS BLANKED, on RI-28's reasoning: a stripper QUOTED inside
// a string is prose about a stripper. A regex literal is code to this scanner
// and survives blanking, which is what leg 2 needs.
//
// FOUR SENTINELS THAT THROW, AND THE ROW THAT COMMISSIONED THIS CHECK NAMED THE
// REASON: an absence check over an empty scope reports PASS in silence, and this
// whole subject is that defect. Zero files walked, a missing home, a home that
// exports nothing, and an importer set that does not reach outside
// `packages/tooling` are each an ERROR rather than a quiet green. The last is
// the one that matters most: if nothing outside this package imports the home,
// the migration has been reverted and both legs are then trivially satisfied by
// a tree that has gone back to eight copies under other names.
//
// WHAT IT CANNOT SEE, stated rather than implied. A hand-written scanner under a
// name leg 1 does not match, carrying no `.replace()` at all: leg 2 is blind to
// it and so is leg 1. That is a SECOND CORRECT stripper rather than a naive one,
// and it is the copy this check is least worried about, because the defect
// ADR-279 repairs is not duplication for its own sake but the specific idiom
// that empties a file. Duplication of a correct scanner costs a reader; the
// idiom costs a green check that is not checking anything.

/** The one comment stripper, relative to the repo root. */
const STRIPPER_HOME = 'packages/tooling/checks/strip-comments.mjs';

/**
 * The home's type face, which is the same module and not a second copy.
 *
 * It restates the SIGNATURE and holds no algorithm, and it exists because
 * `repo-invariants.mjs` is run as `node ...repo-invariants.mjs` with nothing
 * compiled, so the home cannot be TypeScript, while the suites that import it
 * are type-checked by packages whose `tsconfig.json` sets no `allowJs`.
 */
const STRIPPER_TYPES = 'packages/tooling/checks/strip-comments.d.mts';

/**
 * The one file admitted to carry the naive idiom, and what it must still say.
 *
 * It is the suite that proves the repair, and every case in it compares the
 * scanner against the idiom. The check throws rather than passes if this file
 * stops holding the idiom, because at that point the admission is exempting
 * nothing and the next reader has no way to know that.
 */
const STRIPPER_WITNESS = 'packages/tooling/test/strip-comments.test.ts';

/**
 * A DECLARATION of `stripComments`, which is the name every JavaScript copy used.
 *
 * The trailing `[(=<:]` is what makes it a declaration rather than a mention:
 * this check's own source carries `function stripComments\s*\(` inside a REGEX
 * LITERAL, which the scanner correctly treats as code, and a name leg that read
 * it would report the check as its own violator. The exact name is deliberate
 * too. `stripSqlComments`, `stripJsComments` and `stripComment` do not match,
 * and none of them should: the first two are out of subject below and the third
 * parses YAML.
 */
const STRIPPER_NAME = /\b(?:function|const|let|var|class)\s+(stripComments)\s*[(=<:]/g;

/** A `.replace()` over a JavaScript LINE-comment regex. No SQL or YAML strip can match. */
const STRIPPER_LINE = /\.replace\s*\(\s*\/[^\n]{0,24}?\\\/\\\//g;

/** A `.replace()` over a BLOCK-comment regex, which SQL shares and JavaScript does not own. */
const STRIPPER_BLOCK = /\.replace\s*\(\s*\/[^\n]{0,8}?\\\/\\\*/g;

/**
 * A `--` line-comment strip, which is what makes a block strip SQL and not this.
 *
 * THIS IS A LANGUAGE TEST AND IT IS NOT A FENCE. `RI-30`'s subject is the
 * JavaScript comment stripper. SQL's comment grammar is different (`--`, and
 * `''` doubling inside a literal), the shared home could not strip it correctly,
 * and the five SQL strippers standing in this tree are reported by ADR-279 and
 * repaired by nobody. A block strip in the same expression as a `--` strip is
 * one of those.
 */
const SQL_LINE = /--\[\^\\[nr]\]/;

/** How far from a block strip a `--` strip may sit and still be the same act. */
const SQL_WINDOW = 300;

/** Files a stripper could be written in. */
const STRIPPABLE = /\.(ts|tsx|mts|mjs|js|jsx)$/;

/** @type {Invariant} */
const ri30 = {
  id: 'RI-30',
  title: 'One comment stripper, in packages/tooling, and every parser imports it',
  covers:
    'THE COMMENT STRIPPER IS DECLARED ONCE, IN ' +
    '`packages/tooling/checks/strip-comments.mjs`, AND EVERY FILE THAT PARSES ' +
    'SOURCE IMPORTS IT (ADR-279). Seven files declared their own and six were ' +
    'the two-replacement idiom, whose block pass runs first and cannot tell a ' +
    'block-comment OPENER written inside a LINE comment from a real one: on ' +
    '`apps/worker/src/index.ts` it strips 55,728 characters to 2,753 and a ' +
    '`new Date().getHours()` seeded inside the phantom span was invisible to ' +
    '`RI-28`, which reported PASS. LEG 1 IS THE NAME: no file but the home ' +
    'declares a `strip*Comment*` binding. LEG 2 IS THE IDIOM AND IS ' +
    'NAME-BLIND: no file but the home carries a `.replace()` over a ' +
    'block-comment or line-comment regex, which catches a copy under another ' +
    'name and one written inline with no function at all. ' +
    'ONE FILE IS ADMITTED, `packages/tooling/test/strip-comments.test.ts`, ' +
    'which reproduces the idiom VERBATIM as the thing every case compares ' +
    'against, and THE ADMISSION IS ASSERTED: the check THROWS if that file ' +
    'stops existing or stops carrying the idiom, so an exception cannot ' +
    'quietly become a hole. ' +
    'IT READS EVERY `.ts`, `.tsx`, `.mts`, `.mjs`, `.js` and `.jsx` file in ' +
    'the workspace with comments removed and string literals BLANKED, so a ' +
    'stripper quoted inside a string is prose and a regex literal, which is ' +
    'code, is not. ' +
    'FOUR SENTINELS THROW RATHER THAN PASS, because an absence check over an ' +
    'empty scope reports PASS in silence and this check`s whole subject is ' +
    'that defect: zero files walked, a missing home, a home exporting no ' +
    '`stripComments`, and an importer set that does not reach outside ' +
    '`packages/tooling`. The last is the revert detector. ' +
    'WHAT IT CANNOT SEE: a hand-written scanner under a name leg 1 does not ' +
    'match and carrying no `.replace()`, which is a second CORRECT stripper ' +
    'rather than a naive one. Duplication of a correct scanner costs a ' +
    'reader; the idiom costs a green check that is checking nothing. ' +
    'No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    if (!existsSync(join(root, STRIPPER_HOME))) {
      throw new Error(
        `RI-30 cannot run: ${STRIPPER_HOME} does not exist, and it is the home this check ` +
          'exists to keep single. A missing home is not an empty finding list: with it gone ' +
          'both legs would report every remaining copy as the defect and name the wrong one',
      );
    }

    const home = readFileSync(join(root, STRIPPER_HOME), 'utf8');
    if (!/export function stripComments\s*\(/.test(home)) {
      throw new Error(
        `RI-30 cannot run: ${STRIPPER_HOME} exports no \`stripComments\`, so there is nothing ` +
          'for the tree to import and the absence legs below would be asserting that nobody ' +
          'declares what nobody can obtain',
      );
    }

    if (!existsSync(join(root, STRIPPER_WITNESS))) {
      throw new Error(
        `RI-30 cannot run: ${STRIPPER_WITNESS} does not exist. It is the ONE file admitted ` +
          'to carry the naive idiom, it is admitted because it is the suite that proves the ' +
          'repair, and an admission whose subject is gone is a hole rather than an exception',
      );
    }

    const witness = stripComments(readFileSync(join(root, STRIPPER_WITNESS), 'utf8'), {
      literals: 'blank',
    });
    if ([...witness.matchAll(STRIPPER_LINE)].length === 0) {
      throw new Error(
        `RI-30 cannot run: ${STRIPPER_WITNESS} no longer carries the two-replacement idiom, ` +
          'and it is admitted by name for carrying it. Either the suite stopped comparing the ' +
          'scanner against the thing it repairs, in which case the comparison is what to ' +
          'restore, or the admission is now exempting a file that needs no exemption and ' +
          'should be removed from this check',
      );
    }

    const files = walk(root).filter(
      (f) => STRIPPABLE.test(f) && f !== STRIPPER_HOME && f !== STRIPPER_TYPES,
    );
    if (files.length === 0) {
      throw new Error(
        'RI-30 found no JavaScript-family source file in the workspace. Zero means the walk ' +
          'or the extension filter has moved, at which point both legs are asserting about an ' +
          'empty list and eight comment strippers would report as none',
      );
    }

    /** @type {string[]} */
    const importers = [];
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');

      // THE IMPORTER LEG READS THE TEXT THAT STILL HOLDS LITERALS, because a
      // module specifier IS a string literal and blanking it deletes the thing
      // being looked for. The two legs below read the blanked text for the
      // opposite reason: a stripper quoted inside a string is prose about one.
      if (/from\s+'[^']*strip-comments\.mjs'/.test(stripComments(source))) importers.push(file);

      if (file === STRIPPER_WITNESS) continue;
      const code = stripComments(source, { literals: 'blank' });

      for (const m of code.matchAll(STRIPPER_NAME)) {
        findings.push(
          `${file}:${code.slice(0, m.index ?? 0).split('\n').length} declares \`${m[1]}\`, and ` +
            `the comment stripper is declared once, in ${STRIPPER_HOME}. Seven files declared ` +
            'their own and six were the idiom that reads a block-comment opener inside a line ' +
            'comment as a real one, which empties the rest of the file and turns every ' +
            'absence assertion over it vacuously GREEN (ADR-279). Import it instead',
        );
      }

      const idiom = [
        ...code.matchAll(STRIPPER_LINE),
        // A BLOCK STRIP IS THIS CHECK'S ONLY IF IT IS NOT SQL'S. The window is
        // the expression around it: `stripSqlComments` and its four siblings
        // each strip `--` in the same chain, and they are a different language.
        ...[...code.matchAll(STRIPPER_BLOCK)].filter((m) => {
          const at = m.index ?? 0;
          return !SQL_LINE.test(code.slice(Math.max(0, at - SQL_WINDOW), at + SQL_WINDOW));
        }),
      ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      for (const m of idiom) {
        findings.push(
          `${file}:${code.slice(0, m.index ?? 0).split('\n').length} strips comments with a ` +
            '`.replace()` over a comment regex. TWO REPLACEMENTS CANNOT DO THIS: the block ' +
            'pass runs first and a block-comment OPENER written inside a LINE comment opens a ' +
            'phantom block that runs to the next real closer. On `apps/worker/src/index.ts` ' +
            'that deletes 53,000 of 55,728 characters and `RI-28` reported PASS over a live ' +
            `\`new Date().getHours()\` (ADR-279). Import \`stripComments\` from ${STRIPPER_HOME}`,
        );
      }
    }

    const outside = importers.filter((f) => !f.startsWith('packages/tooling/'));
    if (outside.length === 0) {
      throw new Error(
        `RI-30 found no file outside \`packages/tooling/\` importing ${STRIPPER_HOME}. The ` +
          'home is imported by thirty files across seven packages, so zero outside importers ' +
          'means the migration has been reverted or the module moved. Both legs below are ' +
          'then satisfied by a tree that has gone back to eight copies under other names, ' +
          'which is the silent PASS this check exists to refuse',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-31  No document repeats a whole line that carries a generated span
// -----------------------------------------------------------------------------
//
// RI-12 IS A CEILING OF 8 AND IT CATCHES THE EIGHTH DOUBLING. That is not a
// criticism of its number, which ADR-282 measured and found CORRECT: a ceiling
// of 7 goes red on `docs/reviews/2026-08-20-admin-parity-audit.md`, which heads
// EIGHT separate tables with one identical 94-character header row, and 6 and 5
// each add another legitimate document. RI-12's own header says a zero would be
// a check nobody could keep green and the number is 29, not a handful. So the
// ceiling cannot fall and a second, sharper discriminator is the only way in.
//
// THE DISCRIMINATOR IS THE SPAN, AND THE PROPERTY IS ABOUT THE LINE. A `<!--gen:`
// span is written by `gates.mjs generate`, so a line carrying one is generated
// output rather than prose that happens to rhyme. It needs no length floor and
// no ceiling at all. Both halves of that sentence are load-bearing:
//
//   A SPAN legitimately appears many times in one file. `gate_count` occurs 192
//   times under `docs/`, TWICE ON A SINGLE LINE wherever a document writes
//   "N of N", and every one is correct. A check keyed on the span NAME would be
//   unusable, so this one never looks at the name.
//
//   A LINE carrying one is not legitimately repeated. Measured over the whole
//   corpus at the commit that wrote this: 175 gen-carrying lines under `docs/`
//   over 34 files, and the number appearing byte-identically in two different
//   files is ZERO. The same query rendered in two sections is a real thing and
//   this corpus writes it as two DIFFERENT sentences -- `DELTA_MANIFEST` renders
//   `migration_files` under two "Install verification, from empty" headings, for
//   `0033` and for `0034`, in two differently worded lines.
//
// IT WAS TESTED AGAINST THE MERGES IT CLAIMS TO CATCH RATHER THAN ASSERTED. The
// dispatcher hand-collapsed this defect at `ca2f86f`, `ce026dd` and `c3e7293`,
// each time with every gate green, and EVERY LINE REMOVED BY ALL THREE CARRIES A
// SPAN. Three for three, where RI-12 was nought for three because each stood at
// two or three copies. It also partitions RI-12's own scope cleanly: of the 37
// long lines that repeated inside one file, the 8 carrying a span were all
// defects and the 29 that did not include every legitimate one.
//
// AND IT WAS ASKED FOR THREE DAYS BEFORE RI-12 LANDED WITHOUT IT. `docs/STATE.md`
// records, in session 174's section on 2026-08-24: "The `gen:adr_count` line is
// DUPLICATED VERBATIM in both STATE and INDEX ... `CI-06g` cannot see it: the
// gate rewrites every span it finds and compares each to its own query, so two
// identical copies both pass." That is right and nothing about CI-06g should
// change: it is the COUNT gate and this is not a count defect. 4,672 correct
// copies of one correct span is what a count gate looks like on a broken file.
//
// THE SCOPE IS THE GENERATOR'S, WHICH IS EVERY TRACKED `.md` AND NOT `docs/`.
// The row that commissioned this measured `docs/` and fenced four files there.
// `gates.mjs`'s `markdownFiles()` is `allFiles()` filtered by extension and
// walks the repository, and `packages/db/DELTA_MANIFEST.md` held SEVEN more of
// these, at up to seven copies, sharing the `manifest_changes` and
// `migration_files` spans with the four. A check scoped to `docs/` would have
// reported PASS over 7 of the 15 live instances of the defect it is named for,
// which is ADR-279's finding about RI-28 repeated one wave later. The walk here
// additionally skips `dist`, `build`, `coverage` and `.next`, which the
// generator's does not; the two enumerate the same 1,158 files on this tree and
// the difference is build output that carries no markdown.
//
// WHAT IT DOES NOT COVER, stated rather than left to be discovered. It reads
// WHOLE LINES, so a duplicated paragraph whose lines were reflowed passes, and
// so does a doubled line that differs by one character. It says nothing about
// whether the span's VALUE is right, which is CI-06g's job. It cannot see a
// duplicate ACROSS two files, and that is deliberate: zero exist today and a
// cross-file rule would fire on two documents that legitimately share a
// sentence. And it is blind to a doubled line carrying no span, which is
// RI-12's half and the reason RI-12 stays.
//
/** The opener of a generated span, which is what makes a line generated output. */
const GENERATED_SPAN = '<!--gen:';

/**
 * A document with its fenced code blocks masked, using `gates.mjs`'s own
 * expression rather than a second one.
 *
 * A SPAN SHOWN INSIDE A FENCE IS DOCUMENTATION OF THE FORM AND NOT A SPAN.
 * STRATEGY's CI-06g section carries the worked example, and the generator masks
 * it for exactly that reason, so a check about generated lines that did not
 * would disagree with the thing it is checking. Measured to change nothing on
 * this tree, which is why it is here for correctness rather than for a number.
 *
 * @param {string} body
 * @returns {string}
 */
function maskedFences(body) {
  return body.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/</g, '\0'));
}

/** @type {Invariant} */
const ri31 = {
  id: 'RI-31',
  title: 'No document repeats a whole line that carries a generated span',
  covers:
    'EVERY `.md` IN THE TREE, which is `gates.mjs`s `markdownFiles()` scope ' +
    'and NOT RI-12`s `docs/`, read whole-line with fenced blocks masked the ' +
    'way the generator masks them. A line containing a `<!--gen:` span may ' +
    'appear AT MOST ONCE in one file. NO LENGTH FLOOR AND NO CEILING, and ' +
    'both are derived: the structural repetition RI-12 needs a floor and a ' +
    'ceiling for -- rules, table separators, quote markers, fences, a table ' +
    'header row heading eight tables -- carries no span, and of 175 ' +
    'gen-carrying lines under `docs/` the number repeating byte-identically ' +
    'in two files was ZERO. IT IS KEYED ON THE LINE AND NEVER ON THE SPAN ' +
    'NAME: `gate_count` occurs 192 times, twice on one line wherever a ' +
    'document writes "N of N", and all of it is correct. IT SAYS NOTHING ' +
    'ABOUT THE VALUE, which is CI-06g`s, and CI-06g is blind to this by ' +
    'construction because it rewrites every copy and compares each to its ' +
    'own query: STATE.md reached 4,672 copies of one span with that gate ' +
    'green. IT DOES NOT READ ACROSS FILES and it does not see a reflowed ' +
    'duplicate or one differing by a character. RI-12 STAYS: its ceiling is ' +
    'saturated by a legitimate line and this check does not replace it. No ' +
    'database. ADR-282.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const documents = walk(root).filter((rel) => rel.endsWith('.md'));

    // SENTINEL ONE. Zero markdown means the walk moved or the extension test
    // stopped matching, at which point this check reports PASS having opened
    // nothing. An absence check over an empty scope is worse than none, which
    // is ADR-274's rule and ADR-279's whole subject.
    if (documents.length === 0) {
      throw new Error(
        'RI-31 walked no `.md` file at all. Zero means the walk or the extension test has ' +
          'moved, at which point this check reports PASS over a corpus it never opened',
      );
    }

    let generatedLines = 0;

    for (const rel of documents) {
      /** @type {Map<string, number[]>} */
      const seen = new Map();
      maskedFences(readFileSync(join(root, rel), 'utf8'))
        .split('\n')
        .forEach((line, index) => {
          if (!line.includes(GENERATED_SPAN)) return;
          generatedLines++;
          const trimmed = line.trim();
          seen.set(trimmed, [...(seen.get(trimmed) ?? []), index + 1]);
        });

      for (const [line, at] of seen) {
        if (at.length < 2) continue;
        findings.push(
          `${rel}:${at.join(',')} carries one generated line ${at.length} times where a ` +
            'generated line is written once. `RI-12` is silent because its ceiling is 8 and ' +
            '`CI-06g` is silent because it rewrites every copy and compares each to its own ' +
            `query. Keep the first and delete the rest: ${line.slice(0, 90)}...`,
        );
      }
    }

    // SENTINEL TWO, AND IT IS THE ONE THAT MATTERS. This check's scope is not a
    // directory, it is a COMMENT SYNTAX. Rename the span form, or edit
    // `maskedFences` into swallowing a whole document, and the scope empties
    // while every line above still runs and still finds nothing. The tree
    // carries 170 of these lines, so zero is never a small tree; it is a
    // broken reader. RI-29's sentinel is the idiom.
    if (generatedLines === 0) {
      throw new Error(
        `RI-31 found no line carrying a \`${GENERATED_SPAN}\` span in ${String(documents.length)} ` +
          'markdown file(s). Zero means the span form was renamed or the fence mask now ' +
          'swallows whole documents, at which point this check asserts about an empty list ' +
          'and reports PASS over every doubled generated line in the tree',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-33  One concurrency group for both events of one commit
// -----------------------------------------------------------------------------
// THE DEFECT THIS EXISTS FOR RAN FOR THE WHOLE LIFE OF THE REPOSITORY WITH EVERY
// GATE GREEN, and it was invisible precisely because nothing it broke was ever
// red. `ci.yml`, `corpus.yml` and `golden.yml` each declared `push` and
// `pull_request` and each keyed `concurrency.group` on `github.ref`. That
// context is `refs/heads/<branch>` on a push and `refs/pull/<n>/merge` on a
// pull request, so the two runs of ONE COMMIT landed in two groups and neither
// cancelled the other. Measured on the merged tree at `c81a1a01`: runs
// `33310507086` (push) and `33311908640` (pull_request), same SHA, BOTH RUN TO
// COMPLETION, six jobs each. ADR-292 carries the run ids and the timings.
//
// THE CHECK RENDERS THE GROUP RATHER THAN PATTERN-MATCHING IT, and that is the
// whole design. A denylist of context paths would have to know that
// `github.ref` is divergent, that `github.head_ref` alone is divergent, that
// `github.head_ref || github.ref` is STILL divergent (`<branch>` against
// `refs/heads/<branch>`), and that `github.head_ref || github.ref_name` is not.
// Four rulings, three of them counter-intuitive, in a list somebody maintains.
// Instead the group is EVALUATED under a push context and under a pull-request
// context for the same branch, and the two strings must be equal. The check
// then reports the two group names it computed, which is the defect stating
// itself.
//
// IT ALSO REFUSES THE IDIOM THE DISPATCHING ROW SUPPLIED. `${{
// github.event.pull_request.number || github.ref }}` is the snippet ALLOCATION
// row 292 named, and it renders `7` on the pull request and
// `refs/heads/<branch>` on the push. It is the most-copied answer to this
// question on the internet and it does not answer it. A check that only knew
// the shape of the RIGHT answer would have accepted it.
//
// THREE LEGS. A dual-triggered workflow with NO `concurrency` block at all is
// the same defect in its worst form and is leg 1. Divergent renderings are leg
// 2. `cancel-in-progress` that is not `true` is leg 3, because a shared group
// that only QUEUES still runs both halves; collapsing the groups is necessary
// and not sufficient.
//
// WHAT IT DOES NOT COVER, stated rather than left to be found. It reads the
// `on:` and `concurrency:` blocks with a line reader and not a YAML parser, so
// an anchor, a merge key or a flow mapping spanning lines is beyond it; the
// third sentinel is what stops that from being silent. It says NOTHING about
// whether a workflow SHOULD carry both triggers, which is STRATEGY's call and
// not a check's. It cannot see a duplicate arising from two different
// workflows, or from `workflow_run`. And it models a same-repository pull
// request: a pull request from a FORK whose head branch shares a name with a
// branch of this repository renders the same group as a push to that branch,
// which ADR-292 section 6 records as accepted and bounded rather than fixed.

/** The directory every workflow lives in, relative to the repository root. */
const WORKFLOW_HOME = '.github/workflows';

/** The two triggers whose runs this check requires to collide. */
const DUAL = ['push', 'pull_request'];

/**
 * The `github` context as the two events render it FOR ONE COMMIT ON ONE
 * BRANCH, which is the only situation this check is about.
 *
 * The branch name and pull request number are arbitrary; what is load-bearing
 * is which entries DIFFER between the two columns, and every one of those is a
 * documented property of the event rather than a choice made here. `head_ref`
 * is set only on `pull_request`; on `push` it is the empty string, which is
 * falsy to `||`.
 *
 * @type {Record<string, Record<string, string>>}
 */
const EVENT_CONTEXT = {
  push: {
    'github.event_name': 'push',
    'github.ref': 'refs/heads/merit-branch',
    'github.ref_name': 'merit-branch',
    'github.ref_type': 'branch',
    'github.head_ref': '',
    'github.base_ref': '',
    'github.sha': '1'.repeat(40),
    'github.event.pull_request.number': '',
    'github.event.pull_request.head.ref': '',
    'github.event.number': '',
  },
  pull_request: {
    'github.event_name': 'pull_request',
    'github.ref': 'refs/pull/7/merge',
    'github.ref_name': '7/merge',
    'github.ref_type': 'branch',
    'github.head_ref': 'merit-branch',
    'github.base_ref': 'main',
    'github.sha': '2'.repeat(40),
    'github.event.pull_request.number': '7',
    'github.event.pull_request.head.ref': 'merit-branch',
    'github.event.number': '7',
  },
};

/**
 * Context paths that hold the SAME value on both events, so a group naming one
 * of them is neither a defect nor a fix. Kept separate from `EVENT_CONTEXT` so
 * that the two columns above can be read as the difference they encode.
 *
 * @type {Record<string, string>}
 */
const EVENT_INVARIANT = {
  'github.workflow': 'the-workflow',
  'github.repository': 'owner/repo',
  'github.repository_owner': 'owner',
  'github.workflow_ref': 'owner/repo/.github/workflows/w.yml@refs/heads/main',
};

/**
 * The lines of a workflow with full-line comments and blank lines dropped,
 * paired with their 1-based numbers.
 *
 * A `#` line is dropped rather than blanked because this reader is
 * INDENTATION-SENSITIVE and a comment sits at whatever column its author liked.
 * `ci.yml`'s own `concurrency` block quotes a `${{ ... }}` expression inside a
 * comment, so a reader that kept them would evaluate prose.
 *
 * @param {string} body
 * @returns {{ text: string, line: number }[]}
 */
function significantLines(body) {
  return body
    .split('\n')
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.trim() !== '' && !text.trimStart().startsWith('#'));
}

/**
 * The keys of a top-level block, whatever shape it is written in.
 *
 * `on: push`, `on: [push, pull_request]` and an indented mapping are all live
 * GitHub spellings and this repository uses the third.
 *
 * @param {{ text: string, line: number }[]} lines
 * @param {string} key
 * @returns {{ keys: string[], values: Map<string, string>, line: number } | null}
 */
function topLevelBlock(lines, key) {
  const opener = lines.findIndex(({ text }) => text.startsWith(`${key}:`));
  if (opener === -1) return null;

  const openerLine = /** @type {{ text: string, line: number }} */ (lines[opener]);
  const inline = openerLine.text.slice(key.length + 1).trim();
  if (inline !== '') {
    const flow = /^\[(.*)\]$/.exec(inline);
    const keys = (flow === null ? [inline] : (flow[1] ?? '').split(','))
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter((entry) => entry !== '');
    return { keys, values: new Map(), line: openerLine.line };
  }

  /** @type {string[]} */
  const keys = [];
  /** @type {Map<string, string>} */
  const values = new Map();
  let depth = Number.POSITIVE_INFINITY;

  for (const { text } of lines.slice(opener + 1)) {
    const indent = text.length - text.trimStart().length;
    if (indent === 0) break;
    const entry = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(text);
    if (entry === null) continue;
    if (indent > depth) continue;
    depth = indent;
    const name = /** @type {string} */ (entry[1]);
    keys.push(name);
    values.set(name, (entry[2] ?? '').trim());
  }

  return { keys, values, line: openerLine.line };
}

/**
 * One `${{ ... }}` expression rendered under one event context.
 *
 * The grammar is the one a concurrency group is written in: operands joined by
 * `||`, each a single-quoted literal or a context path, and the value is the
 * first truthy operand or else the last one, which is GitHub's own rule. An
 * operand this does not model THROWS rather than rendering as empty, because an
 * unmodelled path silently renders equal on both sides and turns leg 2 into a
 * check that always passes.
 *
 * @param {string} expression
 * @param {string} event
 * @param {string} where
 * @returns {string}
 */
function renderExpression(expression, event, where) {
  const context = { ...EVENT_INVARIANT, ...EVENT_CONTEXT[event] };
  const operands = expression.split('||').map((operand) => operand.trim());

  /** @type {string[]} */
  const rendered = [];
  for (const operand of operands) {
    const literal = /^'(.*)'$/.exec(operand);
    if (literal !== null) {
      rendered.push(literal[1] ?? '');
      continue;
    }
    const value = context[operand];
    if (value === undefined) {
      throw new Error(
        `RI-33 cannot render ${where}: the operand \`${operand}\` is not a context path this ` +
          'check models. An operand it renders as empty is one that compares EQUAL on both ' +
          'events, which would turn the divergence leg into a check that always passes. Add ' +
          'the path to `EVENT_CONTEXT` if it differs between a push and a pull request, or ' +
          'to `EVENT_INVARIANT` if it does not',
      );
    }
    rendered.push(value);
  }

  return rendered.find((value) => value !== '') ?? rendered[rendered.length - 1] ?? '';
}

/**
 * A whole `group:` value rendered under one event context.
 *
 * @param {string} group
 * @param {string} event
 * @param {string} where
 * @returns {string}
 */
const renderGroup = (group, event, where) =>
  group
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\$\{\{([^}]*)\}\}/g, (_whole, expression) =>
      renderExpression(String(expression), event, where),
    );

/** @type {Invariant} */
const ri33 = {
  id: 'RI-33',
  title: 'A workflow on both push and pull_request renders one concurrency group for both',
  covers:
    'EVERY WORKFLOW IN `.github/workflows` THAT DECLARES BOTH `push` AND ' +
    '`pull_request`, which is the exact set whose every commit starts TWO ' +
    'runs. Its `concurrency.group` is RENDERED under a push context and under ' +
    'a pull-request context for one branch and the two strings must be EQUAL, ' +
    'rather than matched against a list of blessed spellings. That is the ' +
    'design and not an implementation detail: `github.ref` diverges, ' +
    '`github.head_ref` alone diverges, `github.head_ref || github.ref` STILL ' +
    'diverges (`<branch>` against `refs/heads/<branch>`), and ' +
    '`github.event.pull_request.number || github.ref` -- the idiom ALLOCATION ' +
    'row 292 supplied and the most-copied answer to this question -- renders ' +
    '`7` against `refs/heads/<branch>` and DOES NOT FIX IT. THREE LEGS: no ' +
    '`concurrency` block at all, divergent renderings, and ' +
    '`cancel-in-progress` that is not `true`, because a shared group that only ' +
    'QUEUES still runs both halves. THREE SENTINELS THROW: no workflow file ' +
    'walked, a tree whose workflows name `pull_request` while the reader ' +
    'classified NONE as dual-triggered, and an operand inside a group that ' +
    'this check does not model, which would render empty on both sides and ' +
    'make the divergence leg always pass. IT IS A LINE READER AND NOT A YAML ' +
    'PARSER, so an anchor or a multi-line flow mapping is beyond it and the ' +
    'second sentinel is what keeps that loud. IT SAYS NOTHING ABOUT WHETHER A ' +
    'WORKFLOW SHOULD CARRY BOTH TRIGGERS, which is STRATEGY`s call: removing ' +
    'a trigger to stop a duplicate is weakening a gate to pass it. It cannot ' +
    'see a duplicate across two workflows or via `workflow_run`, and it models ' +
    'a SAME-REPOSITORY pull request. No database. ADR-292.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const home = join(root, WORKFLOW_HOME);
    const files = existsSync(home)
      ? readdirSync(home)
          .filter((file) => /\.ya?ml$/.test(file))
          .sort()
      : [];

    // SENTINEL ONE. No workflow file means the directory moved or the extension
    // test stopped matching, at which point every leg below asserts about an
    // empty list and this check reports PASS over a repository whose CI it
    // never opened. ADR-274's rule.
    if (files.length === 0) {
      throw new Error(
        `RI-33 walked no workflow file in ${WORKFLOW_HOME}. Zero means the directory moved ` +
          'or the extension test stopped matching, at which point every leg asserts about ' +
          'an empty list and this check reports PASS over CI it never opened',
      );
    }

    /** @type {string[]} */
    const dual = [];
    let mentionsPullRequest = 0;

    for (const file of files) {
      const rel = `${WORKFLOW_HOME}/${file}`;
      const lines = significantLines(read(root, rel));
      if (lines.some(({ text }) => text.includes('pull_request'))) mentionsPullRequest++;

      const triggers = topLevelBlock(lines, 'on');
      if (triggers === null) continue;
      if (!DUAL.every((trigger) => triggers.keys.includes(trigger))) continue;
      dual.push(rel);

      const concurrency = topLevelBlock(lines, 'concurrency');
      const group = concurrency?.values.get('group');

      // LEG 1. The worst form of the same defect: two runs per commit and
      // nothing that could ever cancel either.
      if (concurrency === null || group === undefined || group === '') {
        findings.push(
          `${rel} declares both \`push\` and \`pull_request\` (${WORKFLOW_HOME}/${file}:` +
            `${String(triggers.line)}) and names no \`concurrency.group\`. Every commit on a ` +
            'branch with an open pull request therefore starts two runs of this workflow and ' +
            'nothing can cancel either',
        );
        continue;
      }

      const where = `${rel}:${String(concurrency.line)}`;
      const [onPush, onPull] = DUAL.map((event) => renderGroup(group, event, where));

      // LEG 2, and it is the one the check is named for.
      if (onPush !== onPull) {
        findings.push(
          `${where} keys \`concurrency.group\` on \`${group}\`, which renders "${String(onPush)}" ` +
            `on \`push\` and "${String(onPull)}" on \`pull_request\` for one commit on one ` +
            'branch. Two groups is two runs, and `cancel-in-progress` never sees them as ' +
            'siblings. `github.head_ref || github.ref_name` renders one string on both ' +
            'events; do NOT reach for a trigger removal, which is weakening a gate to pass it',
        );
      }

      // LEG 3. Necessary and not sufficient: one group that only queues is
      // still two runs, one of them behind the other.
      const cancel = concurrency.values.get('cancel-in-progress');
      if (cancel !== 'true') {
        findings.push(
          `${where} shares one \`concurrency.group\` across \`push\` and \`pull_request\` with ` +
            `\`cancel-in-progress: ${String(cancel ?? '(absent)')}\`. A shared group that does ` +
            'not cancel merely QUEUES the second run, so the commit is still built twice',
        );
      }
    }

    // SENTINEL TWO, AND IT IS THE ONE THAT MATTERS. This check's scope is
    // computed by a line reader over YAML. Reindent a trigger block, write `on`
    // as a flow mapping, or break the key expression, and the dual-triggered
    // set empties while every leg above still runs and still finds nothing.
    // A tree whose workflows say `pull_request` and whose reader found no
    // dual-triggered workflow is a broken reader, not a fixed repository.
    if (mentionsPullRequest > 0 && dual.length === 0) {
      throw new Error(
        `RI-33 found \`pull_request\` in ${String(mentionsPullRequest)} workflow file(s) and ` +
          'classified NONE of them as declaring both triggers. Zero means the `on:` reader ' +
          'stopped matching the shape these workflows are written in, at which point this ' +
          'check reports PASS over every duplicated run in the tree',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-34  Every writer of payout_requests names the derived column and no other
// -----------------------------------------------------------------------------
// ADR-295 (ADR-287 slice 6). THE DEFECT THIS EXISTS FOR IS ONE AN IMPLEMENTER
// WALKS INTO BY BEING CAREFUL, which is why a static check is worth more here
// than a bigger model. `PayoutRequestInsert` declares FOURTEEN fields. TWO of
// them, `splitBp` and `clampReason`, HAVE NO COLUMN: `grep -rn split_bp
// packages/db/migrations` and the same for `clamp_reason` each return ZERO
// lines, and both values are already stored inside `eligibility_snapshot`. A
// THIRD, `plan_version_id`, is `NOT NULL` on the table and is ABSENT from the
// shape, so it has to be derived from `accounts` on the same transaction.
//
// AN IMPLEMENTER MAPPING THE SHAPE FIELD BY FIELD GETS ALL THREE WRONG IN THE
// SAME DIRECTION, and only one of the three fails loudly. Writing `splitBp`
// somewhere would state one money fact twice on the money path and nothing
// would ever go red; omitting `planVersionId` is a `NOT NULL` violation at run
// time, on the request that approves a payout; naming `identityId` is refused
// by `packages/db` at run time, for the same reason and at the same moment.
// ADR-287 finding F3 recorded all three as a LANDMINE for exactly this reason.
//
// SO THIS IS THE MECHANICAL ASSERTION THAT REPLACES REMEMBERING, which is
// `MERIT_BUILD_MASTER_PROMPT`'s own stated remedy for the error class the
// reconciliation session's three worst errors belong to.
// -----------------------------------------------------------------------------

/**
 * Where the writers live, and where the facts this check asserts are declared.
 *
 * `MIGRATIONS_DIR` IS `RI-26`'S AND IS REUSED RATHER THAN RESTATED, on this
 * file's own standing rule: two names for one directory is the second copy the
 * checks in it exist to end.
 */
const PAYOUT_TABLE_KEY = 'payoutRequests';
const PAYOUT_MIGRATION = 'packages/db/migrations/0010_payouts.sql';
const SCOPE_REGISTRY = 'packages/db/src/scope.ts';

/**
 * The two SQL spellings `payout_requests` HAS NO COLUMN FOR, with the property
 * spelling each would be written under. Re-derived by a sentinel below rather
 * than trusted: if a migration ever adds one, this check must stop asserting
 * its absence instead of quietly asserting a fact that stopped being true.
 */
const PAYOUT_COLUMNLESS = [
  { sql: 'split_bp', property: 'splitBp' },
  { sql: 'clamp_reason', property: 'clampReason' },
];

/** The tenancy column. The handle stamps it and naming it in an insert is refused. */
const PAYOUT_TENANCY = [{ sql: 'identity_id', property: 'identityId' }];

/** The `NOT NULL` column the insert shape does not carry, so every writer derives it. */
const PAYOUT_DERIVED = { sql: 'plan_version_id', property: 'planVersionId' };

/** `payoutRequests` is `owned` on `identity_id`, as the registry itself writes it. */
const OWNED_ON_IDENTITY = /payoutRequests:\s*\{\s*class:\s*'owned',\s*column:\s*'identity_id'/;

/** `plan_version_id` is `NOT NULL` on the table, as the migration itself writes it. */
const PLAN_VERSION_NOT_NULL = /plan_version_id\s+uuid NOT NULL/;

/** A scoped or firm write naming this table. The values object is the second argument. */
const WRITES_PAYOUT_REQUESTS = new RegExp(
  String.raw`\binsert(?:Under)?\s*\(\s*(['"\`])` + PAYOUT_TABLE_KEY + String.raw`\1\s*,`,
  'g',
);

/**
 * The TOP-LEVEL keys of one object literal, and whether it spreads.
 *
 * A SPREAD IS REPORTED RATHER THAN WALKED, and that is the leg that keeps this
 * check from being defeated by one character: `{ ...row }` writes every field
 * of `PayoutRequestInsert`, `splitBp` and `clampReason` included, and no key
 * scan can see it. Nesting, quotes and template substitutions are respected, so
 * a key of a nested object is not a key of this one.
 *
 * @param {string} text an object literal, braces included
 * @returns {{ keys: string[], spreads: boolean } | null}
 */
function objectLiteralKeys(text) {
  const open = text.indexOf('{');
  if (open === -1) return null;
  /** @type {string[]} */
  const keys = [];
  let spreads = false;
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  let pending = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i] ?? '';
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      pending = '';
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      pending = '';
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      pending = '';
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (c === ':' && pending.trim() !== '') {
      keys.push(pending.trim());
      pending = '';
      continue;
    }
    if (c === ',') {
      pending = '';
      continue;
    }
    if (text.startsWith('...', i)) spreads = true;
    pending += c;
  }
  return { keys, spreads };
}

/** @type {Invariant} */
const ri34 = {
  id: 'RI-34',
  title: 'Every writer of payout_requests derives plan_version_id and names no column-less field',
  covers:
    'EVERY INSERT INTO `payout_requests` UNDER AN `apps/*/src` OR ' +
    '`packages/*/src` DIRECTORY (ADR-295), read with comments stripped ' +
    'through the one scanner and with the values object parsed as a BALANCED ' +
    'OBJECT LITERAL rather than matched. THREE LEGS, and each is a field of ' +
    '`PayoutRequestInsert` that fails in a DIFFERENT direction. FIRST: no ' +
    'writer names `splitBp` or `clampReason` in either spelling, because ' +
    '`payout_requests` HAS NO SUCH COLUMN and both values are already stored ' +
    'inside `eligibility_snapshot`; writing one elsewhere would state a money ' +
    'fact TWICE on the money path and nothing would ever go red. SECOND: no ' +
    'writer names `identityId` or `identity_id`, because the table is scope ' +
    'class `owned` on it and a scoped write STAMPS its tenancy from the ' +
    'handle. THIRD: every writer names `planVersionId`, which is `NOT NULL` ' +
    'on the table and ABSENT from the insert shape, so an omission is a ' +
    'constraint violation on the request that approves a payout. A SPREAD IS ' +
    'A FINDING ON ITS OWN: `{ ...row }` writes all fourteen fields and no key ' +
    'scan can see it, so the one character that would defeat legs one and two ' +
    'is reported rather than walked. ' +
    'IT READS INSERTS AND NOT UPDATES, and that is a limit rather than an ' +
    'oversight: `planVersionId` is REQUIRED on an insert and FORBIDDEN on an ' +
    'update, where `0027_triggers_invariants.sql` raises on any attempt to ' +
    'move it, so one id covering both would be two rules wearing one number. ' +
    'No writer of either kind exists outside `apps/api/src/payout-backend.ts` ' +
    'on this tree. ' +
    'FIVE SENTINELS THAT THROW, because every leg here is an ABSENCE except ' +
    'the third and an absence over an empty scope reports PASS (ADR-274): no ' +
    'source file walked; A TREE WHOSE SCHEMA DECLARES `payout_requests` AND ' +
    'WHOSE SOURCE WRITES IT NOWHERE, which is what this check becomes the day ' +
    'the module is renamed or the write stops being an `insert` call; ' +
    '`split_bp` or `clamp_reason` APPEARING in `packages/db/migrations`, at ' +
    'which point leg one is asserting a schema fact that stopped being true; ' +
    'and either `plan_version_id uuid NOT NULL` leaving `0010_payouts.sql` or ' +
    '`payoutRequests` ceasing to be registered `owned` on `identity_id` in ' +
    '`packages/db/src/scope.ts`. ' +
    'THE SCHEMA FACTS ARE READ ONLY WHERE THERE IS A WRITER, AND A TREE THAT ' +
    'DECLARES NO `payout_requests` AT ALL RETURNS EMPTY WITHOUT MEASURING. ' +
    'That is the ONE arm here that passes over nothing, it is stated rather ' +
    'than implied, and it cannot arise on this repository: a merged migration ' +
    'is never edited and only superseded (constitution `E2`), so ' +
    '`CREATE TABLE payout_requests` cannot leave this tree without an ADR that ' +
    'is exactly the occasion to re-derive this check. It exists for a ' +
    'SYNTHETIC tree that never had the table, which is what ' +
    '`packages/tooling/test/repo-invariants.test.ts` builds. No database.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    const sources = walk(root).filter((f) => {
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(f)) return false;
      if (/(^|\/)(test|tests|__tests__|e2e|fixtures)\//.test(f)) return false;
      if (/\.(test|spec)\.[a-z]+$/.test(f)) return false;
      return /^apps\/[^/]+\/src\//.test(f) || /^packages\/[^/]+\/src\//.test(f);
    });

    // SENTINEL ONE. Zero source files means the walk or the path filter has
    // moved, at which point every leg below is asserting about an empty list
    // and a writer anywhere in the tree would report as absent.
    if (sources.length === 0) {
      throw new Error(
        'RI-34 found no source file under any `apps/*/src` or `packages/*/src`. Zero means ' +
          'the walk or the path filter has moved, at which point every leg is asserting ' +
          'about an empty list and a writer anywhere in the tree would report as absent',
      );
    }

    /** @type {{ rel: string, line: number, values: string | undefined }[]} */
    const writers = [];

    for (const rel of sources) {
      const code = stripComments(readFileSync(join(root, rel), 'utf8'));
      WRITES_PAYOUT_REQUESTS.lastIndex = 0;
      let matched = WRITES_PAYOUT_REQUESTS.exec(code);
      while (matched !== null) {
        const open = code.indexOf('(', matched.index);
        const call = open === -1 ? null : callArguments(code, open);
        writers.push({
          rel,
          line: code.slice(0, matched.index).split('\n').length,
          values: call?.args[1],
        });
        matched = WRITES_PAYOUT_REQUESTS.exec(code);
      }
    }

    const migrationsDir = join(root, MIGRATIONS_DIR);
    const migrations = existsSync(migrationsDir)
      ? readdirSync(migrationsDir)
          .filter((name) => name.endsWith('.sql'))
          .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
          .join('\n')
      : '';
    const declaresTheTable = /CREATE TABLE payout_requests\b/.test(migrations);

    // THE ONE ARM THAT PASSES OVER NOTHING, AND IT IS THE SCHEMA THAT DECIDES
    // IT RATHER THAN THE ABSENCE OF WRITERS. A tree whose migrations never
    // create `payout_requests` has nothing for this check to be about: leg one
    // asserts the absence of two columns of a table that does not exist and leg
    // three requires a `NOT NULL` column of the same. ON THIS REPOSITORY IT
    // CANNOT ARISE: a merged migration is never edited and only superseded
    // (constitution `E2`), so the `CREATE TABLE` cannot leave the tree without
    // an ADR, which is exactly the occasion to re-derive this check. It exists
    // for the SYNTHETIC tree `packages/tooling/test/repo-invariants.test.ts`
    // builds, which every invariant must hold on and which has no payout schema.
    if (!declaresTheTable) return findings;

    // SENTINEL TWO. The schema declares the table and NOTHING under a
    // deployable's `src/` writes it through the accessor this check reads. Two
    // of the three legs are absences, so this would otherwise be a PASS over an
    // empty scope, which is ADR-274's warned shape.
    if (writers.length === 0) {
      throw new Error(
        `RI-34 found no writer of \`${PAYOUT_TABLE_KEY}\` under any \`apps/*/src\` or ` +
          '`packages/*/src`, on a tree whose migrations DO create `payout_requests`. Zero ' +
          'means the module was renamed, the table key spelling moved, or the write is no ' +
          'longer an `insert` call, at which point two of this check`s three legs are ' +
          'absences asserted over an empty scope and report PASS',
      );
    }

    // SENTINEL THREE. The absence of these two columns is what makes naming
    // them a defect. If a migration adds one, this check must say so rather
    // than keeping an assertion the schema has overtaken.
    for (const { sql } of PAYOUT_COLUMNLESS) {
      if (!migrations.includes(sql)) continue;
      throw new Error(
        `RI-34 found \`${sql}\` in ${MIGRATIONS_DIR}, and this check asserts that no writer ` +
          'names it BECAUSE THE TABLE HAS NO SUCH COLUMN. If a migration added one, leg one ' +
          'is now asserting a schema fact that stopped being true and the check must be ' +
          're-derived rather than left green. ADR-287 finding F3 and ADR-295 are the reasoning',
      );
    }

    // SENTINEL FOUR. Both halves are facts leg two and leg three rest on, and
    // both live in files this check does not otherwise open.
    const migrationPath = join(root, PAYOUT_MIGRATION);
    if (
      !existsSync(migrationPath) ||
      !PLAN_VERSION_NOT_NULL.test(readFileSync(migrationPath, 'utf8'))
    ) {
      throw new Error(
        `RI-34 cannot find \`plan_version_id uuid NOT NULL\` in ${PAYOUT_MIGRATION}. Leg three ` +
          'requires every writer to derive that column BECAUSE it is `NOT NULL` and absent ' +
          'from the insert shape. If the column moved, the requirement moved with it',
      );
    }
    const scopePath = join(root, SCOPE_REGISTRY);
    if (!existsSync(scopePath) || !OWNED_ON_IDENTITY.test(readFileSync(scopePath, 'utf8'))) {
      throw new Error(
        'RI-34 cannot find `payoutRequests` registered `owned` on `identity_id` in ' +
          `${SCOPE_REGISTRY}. Leg two forbids a writer naming the tenancy column BECAUSE the ` +
          'handle stamps it. If the scope class changed, that is a money-path ruling and this ' +
          'check is asserting against a registry it no longer matches',
      );
    }

    for (const writer of writers) {
      const { rel, line, values } = writer;
      if (values === undefined) {
        findings.push(
          `${rel}:${line} writes \`${PAYOUT_TABLE_KEY}\` and this check could not read the ` +
            'values it writes. A writer on the money path that a check cannot parse is a ' +
            'writer nothing holds, so it is reported rather than skipped',
        );
        continue;
      }
      const parsed = objectLiteralKeys(values);
      if (parsed === null) {
        findings.push(
          `${rel}:${line} writes \`${PAYOUT_TABLE_KEY}\` from a value that is not an object ` +
            'literal, so the fields it writes are decided somewhere this check cannot read. ' +
            'ADR-287 finding F3 is why the fields have to be visible at the call site',
        );
        continue;
      }
      if (parsed.spreads) {
        findings.push(
          `${rel}:${line} SPREADS into the \`${PAYOUT_TABLE_KEY}\` insert. A spread writes ` +
            'every field of `PayoutRequestInsert`, including `splitBp` and `clampReason`, ' +
            'which have NO COLUMN and are already stored inside `eligibility_snapshot`. ' +
            'Name the fields',
        );
      }
      for (const { sql, property } of [...PAYOUT_COLUMNLESS, ...PAYOUT_TENANCY]) {
        const named = parsed.keys.filter((key) => key === sql || key === property);
        if (named.length === 0) continue;
        findings.push(
          `${rel}:${line} names \`${named[0] ?? property}\` in a \`${PAYOUT_TABLE_KEY}\` ` +
            (sql === 'identity_id'
              ? 'insert. That is the tenancy column, `packages/db` stamps it from the handle, ' +
                'and naming it in an insert`s values is REFUSED at run time'
              : 'insert. `payout_requests` has NO SUCH COLUMN and the value is already ' +
                'stored inside `eligibility_snapshot`, so a second home for it would state ' +
                'one money fact twice on the money path'),
        );
      }
      if (parsed.keys.some((key) => key === PAYOUT_DERIVED.sql || key === PAYOUT_DERIVED.property))
        continue;
      findings.push(
        `${rel}:${line} writes \`${PAYOUT_TABLE_KEY}\` without naming ` +
          `\`${PAYOUT_DERIVED.property}\`. The column is \`NOT NULL\` and ` +
          '`PayoutRequestInsert` does not carry it, so it is DERIVED from ' +
          '`accounts.plan_version_id` on the same transaction. An omission is a constraint ' +
          'violation on the request that approves a payout',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-36, whose subject is a design record that STATES a nullability the schema
// stopped having
// -----------------------------------------------------------------------------
// ADR-329. `docs/architecture/data-model/` carries one design record per table
// and every record states, per column, whether the column is `not null`. TWO
// RECORDS SAID `not null` ABOUT A COLUMN THAT IS NULLABLE, ON CONSECUTIVE DAYS,
// AND NOTHING WENT RED:
//
//   `0080` (ADR-322) made `wallet_entries.provenance` nullable and
//   direction-conditional; the record went on reading `` `provenance` | text |
//   not null ``, and ADR-322 reported it as a landmine.
//
//   `0081` (ADR-323) dropped both `NOT NULL`s on `purchases.psp` and
//   `purchases.psp_reference`; the record went on reading `not null` for both,
//   and ADR-323 reported it as a landmine AND as a pattern, because it was the
//   second occurrence in two rows.
//
// `CI-06i` reconciles the TABLE SET in both directions and stops at the name;
// `scripts/corpus/data-model-columns.mjs` reconciles the COLUMN SET and says in
// its own `covers` line that it reads names "and never types, nullability,
// defaults or collation". So the axis that both landmines lived on was the one
// axis no check in this repository read.
//
// WHY IT IS AN INVARIANT AND NOT A CI-06 GATE, decided rather than defaulted.
// The subject is a document, which argues for `gates.mjs`; three things argue
// louder for here. This file ALREADY READS THIS MIGRATION SET: `RI-26` folds
// `packages/db/migrations` with `stripSqlComments`, `topLevelSegments`,
// `columnRenamesIn` and a `DROP COLUMN` throw, and the first two are reused
// below rather than written a second time. The `CI-06<letter>` series is CLOSED
// at `w` (ADR-131, `CI-06/closed-letter-series`), so the letter the dispatch
// named does not exist and a corpus gate would be a slug either way. And
// `gates.mjs` is nine thousand lines of JavaScript that `scripts/corpus`'s own
// `tsconfig.json` sets `checkJs: false` over, in writing; `packages/tooling`
// sets `checkJs: true`, so a check written here is type-checked and the same
// check written there is not.
//
// THE HARD PART IS NOT NULLABILITY, IT IS `ALTER`. A column's nullability is
// its `CREATE TABLE` declaration AS AMENDED by every later `ALTER COLUMN ...
// DROP NOT NULL` and `SET NOT NULL` in migration order. A reader that stopped
// at the `CREATE TABLE` would call `wallet_entries.provenance` NOT NULL and
// `purchases.psp` NOT NULL, agree with both stale records, and report a clean
// estate over the exact two defects it was written for. So the fold below walks
// the set in filename order and applies the statements, and every shape it
// cannot model is a THROW rather than a skip.
//
// WHAT IT DEMANDS ABOUT A CHECK: NOTHING, AND THAT IS THE LIMIT IT ACCEPTS.
// After `0080` `wallet_entries.provenance` is not simply nullable: it is
// REQUIRED on a credit and null-or-`correction` on a debit, enforced by
// `wallet_entries_provenance_follows_direction`. This check reads the column's
// own `NOT NULL` and is blind to that CHECK, so a record that says only `null`
// passes it. THE CHECK IS NOT UNGUARDED, it is guarded somewhere else: its
// semantics are executed against a real database by
// `scripts/db/probe_wallet_debit_provenance.sql` and
// `scripts/db/probe_purchase_processor_columns.sql`, which `RI-24` requires
// `corpus.yml` to run and `CI-06h` to pin. Reading a CHECK expression out of
// the tree would be an expression parser, which is a second hard thing to keep
// true, for an assertion a probe already makes better. The wider check -- a
// record's TYPE, DEFAULT and CONSTRAINT text against the DDL -- is named as
// OWED in ADR-329 section 7 and is not attempted here.
//
// FOUR MORE THINGS IT DOES NOT DO.
//   1. It says nothing about a column only one side names. That is
//      `data-model-columns.mjs`'s subject in both directions, and one defect
//      reported by two checks is the collision `CI-06d` and `CI-06e` divide a
//      population to avoid. (That gate is still unregistered; ADR-329 section 8
//      reports it rather than registering it.)
//   2. It reads the FIRST CELL of a `| Column |` table and the cell under that
//      table's own `Constraints` header, so a nullability written in prose
//      below the table is invisible to it exactly as it is to a reader skimming
//      the table.
//   3. A STRUCK-THROUGH ROW IS A TOMBSTONE AND NOT A CLAIM, which is
//      `data-model-columns.mjs`'s ruling on `ADR-029`'s
//      `kyc_verifications.~~dedupe_matched_identity_id~~` and is inherited here
//      rather than re-decided.
//   4. No database. The migration set in the tree is the whole input.
const DATA_MODEL_DIR = 'docs/architecture/data-model';

/**
 * The `### <table>` heading that makes a file a design record.
 *
 * `CI-06i`'s predicate, verbatim, and it owns the finding about a heading that
 * disagrees with its filename. This check reports only that it could not read
 * one, by skipping the file.
 */
const DESIGN_RECORD_HEADING = /^### ([a-z][a-z0-9_]*)\s*$/m;

/**
 * A `CREATE TABLE` segment that is a table-level clause rather than a column.
 *
 * `RI-26`'s `temporalColumnFrom` list plus `partition`, which that reader can
 * omit because a partition clause declares no temporal type and this one cannot
 * because it would otherwise read `partition` as a column name.
 */
const TABLE_LEVEL_CLAUSE =
  /^(constraint|primary|unique|check|foreign|exclude|like|deferrable|partition)\b/i;

/**
 * Whether one column definition declares the column NOT NULL.
 *
 * AT THE TOP LEVEL AND NEVER INSIDE PARENTHESES, which is the whole difficulty.
 * `wallet_entries.balance_after_cents` is `bigint NOT NULL CHECK
 * (balance_after_cents >= 0)` and `account_adjustments` carries CHECK bodies
 * spelling `IS NOT NULL`; a textual scan would read the constraint as the
 * column's own nullability. `packages/db/test/scoped-db.test.ts`'s
 * `withoutNotNull` scans at depth zero for exactly this reason and this is the
 * same rule.
 *
 * `PRIMARY KEY` COUNTS AND THE WORDS ARE OFTEN ABSENT. `wallet_dormancy` is
 * `identity_id uuid PRIMARY KEY REFERENCES identities(id)` with no `NOT NULL`
 * text at all, and `declaredNotNull` in that same suite reads the key as well
 * as the words for the same reason.
 *
 * @param {string} def
 * @returns {boolean}
 */
function declaresNotNull(def) {
  let depth = 0;
  for (let i = 0; i < def.length; i += 1) {
    const ch = def[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth !== 0) continue;
    const previous = def[i - 1];
    if (i !== 0 && previous !== undefined && !/\s/.test(previous)) continue;
    const rest = def.slice(i);
    if (/^NOT\s+NULL\b/i.test(rest) || /^PRIMARY\s+KEY\b/i.test(rest)) return true;
  }
  return false;
}

/**
 * Whether one column definition makes the column GENERATED ALWAYS AS a stored
 * expression.
 *
 * IT IS THE ONE COLUMN SHAPE WHOSE RECORD IS ALLOWED TO SAY NOTHING, and the
 * admission is mechanical rather than a written list. Six columns in this set
 * are generated; the five whose DDL does not also say `NOT NULL` are the only
 * five columns of 1,374 whose record states no nullability at all, and each of
 * those cells spends itself on the expression instead. Every OTHER silent cell
 * is a finding, which is what stops this check being satisfied by deleting the
 * words `not null` from a row.
 *
 * `AS IDENTITY` is excluded because it is the primary-key idiom of this estate
 * and those columns are NOT NULL by their key.
 *
 * @param {string} def
 * @returns {boolean}
 */
const isGenerated = (def) => /\bGENERATED\s+ALWAYS\s+AS\s*\(/i.test(def);

/**
 * One table's columns, keyed by name, with the nullability the set LEAVES them.
 *
 * @typedef {{ notNull: boolean, def: string, where: string }} FoldedColumn
 */

/**
 * The whole migration set folded to `table -> column -> FoldedColumn`, plus the
 * statements the fold cannot model.
 *
 * SCHEMA-QUALIFIED RELATIONS ARE NOT READ AT ALL, and that is what keeps
 * `0079`'s pg-boss installation out of this. Every `CREATE TABLE` and `ALTER
 * TABLE` it writes names `pgboss.<something>`, including the `ADD PRIMARY KEY`
 * that would otherwise be an unmodelled statement, and `docs/architecture/
 * data-model/` records no relation outside `public`.
 *
 * @param {string} root
 * @returns {{ tables: Map<string, Map<string, FoldedColumn>>, unmodelled: string[], files: string[] }}
 */
export function foldColumnNullability(root) {
  const dir = join(root, MIGRATIONS_DIR);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  /** @type {Map<string, Map<string, FoldedColumn>>} */
  const tables = new Map();
  /** @type {string[]} */
  const unmodelled = [];

  for (const file of files) {
    const code = stripSqlComments(readFileSync(join(dir, file), 'utf8'));

    const create = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    for (let m = create.exec(code); m !== null; m = create.exec(code)) {
      const table = (m[1] ?? '').toLowerCase();
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < code.length && depth > 0; i += 1) {
        if (code[i] === '(') depth += 1;
        else if (code[i] === ')') depth -= 1;
      }
      if (depth !== 0) {
        unmodelled.push(`${file}: CREATE TABLE ${table} has an unbalanced body`);
        continue;
      }
      const columns = tables.get(table) ?? new Map();
      tables.set(table, columns);
      /** @type {string[]} */
      const keyed = [];
      for (const segment of topLevelSegments(code.slice(start, i - 1))) {
        const def = segment.replace(/\s+/g, ' ').trim();
        if (def === '') continue;
        if (TABLE_LEVEL_CLAUSE.test(def)) {
          // A TABLE-LEVEL `PRIMARY KEY (a, b)` MAKES ITS COLUMNS NOT NULL AND
          // THE COLUMN DEFINITIONS DO NOT SAY SO. Seventeen tables in this set
          // are keyed that way, `wallet_spend_limits`, `payout_destinations`
          // and `firm_parameters` among them, and a reader that dropped the
          // clause would call every one of those key columns nullable.
          const key = /^(?:CONSTRAINT\s+[a-z_][a-z0-9_]*\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(
            def,
          );
          if (key?.[1] !== undefined) {
            for (const name of key[1].split(',')) keyed.push(name.trim().toLowerCase());
          }
          if (/^LIKE\b/i.test(def)) {
            unmodelled.push(`${file}: CREATE TABLE ${table} imports columns with LIKE`);
          }
          continue;
        }
        const name = /^([a-z_][a-z0-9_]*)\b/i.exec(def)?.[1];
        if (name === undefined) continue;
        columns.set(name.toLowerCase(), { notNull: declaresNotNull(def), def, where: file });
      }
      for (const name of keyed) {
        const column = columns.get(name);
        if (column === undefined) {
          unmodelled.push(`${file}: ${table} PRIMARY KEY names ${name}, which it declares nowhere`);
          continue;
        }
        column.notNull = true;
      }
    }

    const alter = /\bALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)(?![.\w])/gi;
    for (let m = alter.exec(code); m !== null; m = alter.exec(code)) {
      const table = (m[1] ?? '').toLowerCase();
      let depth = 0;
      let i = m.index + m[0].length;
      for (; i < code.length; i += 1) {
        if (code[i] === '(') depth += 1;
        else if (code[i] === ')') depth -= 1;
        else if (code[i] === ';' && depth === 0) break;
      }
      const body = code.slice(m.index + m[0].length, i);
      alter.lastIndex = i;
      const columns = tables.get(table);

      for (const segment of topLevelSegments(body)) {
        const clause = segment.replace(/\s+/g, ' ').trim();
        if (clause === '') continue;

        const added =
          /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i.exec(clause);
        if (added?.[1] !== undefined && added[2] !== undefined) {
          if (columns === undefined) {
            unmodelled.push(`${file}: ADD COLUMN on ${table}, which no CREATE TABLE here makes`);
            continue;
          }
          const def = `${added[1]} ${added[2]}`;
          columns.set(added[1].toLowerCase(), {
            notNull: declaresNotNull(def),
            def,
            where: file,
          });
          continue;
        }

        const moved = /^ALTER\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+(DROP|SET)\s+NOT\s+NULL$/i.exec(
          clause,
        );
        if (moved?.[1] !== undefined) {
          const column = columns?.get(moved[1].toLowerCase());
          if (column === undefined) {
            unmodelled.push(
              `${file}: ALTER COLUMN ${table}.${moved[1]} ${moved[2]} NOT NULL, and the fold ` +
                'has no such column',
            );
            continue;
          }
          column.notNull = /^SET$/i.test(moved[2] ?? '');
          column.where = file;
          continue;
        }

        // EVERY OTHER `ALTER COLUMN` IS SKIPPED RATHER THAN REFUSED, and it is
        // the one place this fold is deliberately narrower than
        // `scoped-db.test.ts`'s. `TYPE`, `SET DEFAULT` and `DROP DEFAULT` move
        // no column's nullability, and `0067` is the only `TYPE` in the set.
        if (/^ALTER\s+COLUMN\b/i.test(clause)) continue;

        if (/^RENAME\s+TO\b/i.test(clause)) {
          unmodelled.push(`${file}: ALTER TABLE ${table} RENAME TO, which moves a whole record`);
          continue;
        }
        if (/^RENAME\s+CONSTRAINT\b/i.test(clause)) continue;
        const renamed =
          /^RENAME\s+(?:COLUMN\s+)?"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?$/i.exec(
            clause,
          );
        if (renamed?.[1] !== undefined && renamed[2] !== undefined) {
          const from = renamed[1].toLowerCase();
          const to = renamed[2].toLowerCase();
          const column = columns?.get(from);
          if (column === undefined) {
            unmodelled.push(
              `${file}: RENAME COLUMN ${table}.${from} TO ${to}, and the fold has no such column`,
            );
            continue;
          }
          columns?.delete(from);
          columns?.set(to, column);
          continue;
        }
        if (/^DROP\s+COLUMN\b/i.test(clause)) {
          unmodelled.push(`${file}: ${table} DROP COLUMN, which this fold cannot replay`);
          continue;
        }
        if (/PRIMARY\s+KEY\b/i.test(clause) && /^(ADD|DROP)\b/i.test(clause)) {
          unmodelled.push(`${file}: ${table} ${clause.slice(0, 70)}, which moves a key`);
          continue;
        }
      }
    }
  }

  return { tables, unmodelled, files };
}

/**
 * One `Constraints` cell split into the terms a reader reads it as.
 *
 * TOP-LEVEL COMMAS ONLY, off `topLevelSegments`, because a cell routinely reads
 * `not null, check in (\`psp_a\`,\`psp_b\`)` and the commas inside the vocabulary
 * are not term boundaries.
 *
 * @param {string} cell
 * @returns {string[]}
 */
const constraintTerms = (cell) =>
  topLevelSegments(cell)
    .map((term) => term.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((term) => term !== '');

/**
 * What a `Constraints` cell STATES about its column's nullability, or `null`
 * when it states nothing.
 *
 * IT READS TERMS AND NOT THE CELL, AND THAT IS A MEASUREMENT RATHER THAN A
 * PREFERENCE. The first reader written for this check tested the whole cell for
 * `not null`, and it produced two findings against records that are TRUE:
 *
 *   `account_adjustments.promotional_credit_grant_id` reads `null, unique where
 *   not null, fk ...`, where the phrase belongs to an INDEX PREDICATE.
 *
 *   `trading_calendar.session_open_at` and `.session_close_at` read `**null
 *   exactly when \`is_holiday\`** (\`0032\`, was \`not null\`)`, where the phrase
 *   is the record QUOTING WHAT IT USED TO SAY, beside the migration that
 *   changed it. Those two cells are the best-maintained nullability lines in
 *   the directory.
 *
 * Working agreements section 9: never weaken a gate to pass it, and a true line
 * that trips a gate means the gate is wrong. Both cells stand exactly as they
 * were and the reader moved.
 *
 * THE FIRST TERM THAT SPEAKS DECIDES, so `fk identities, not null, on delete
 * restrict` is NOT NULL and `null, **fk added in \`0007\`**` is nullable. `pk`
 * is the estate's spelling of a primary key and implies NOT NULL exactly as the
 * DDL side does.
 *
 * @param {string} cell
 * @returns {boolean | null}
 */
function statedNullability(cell) {
  for (const term of constraintTerms(cell)) {
    if (/^not null\b/.test(term)) return true;
    if (/^null\b/.test(term)) return false;
    if (/^pk\b/.test(term) || /^primary key\b/.test(term)) return true;
  }
  return null;
}

/**
 * Every column one design record CLAIMS, with the cell that states it.
 *
 * @param {string} body
 * @param {string} table
 * @returns {{ column: string, cell: string, line: number }[]}
 */
function recordColumnClaims(body, table) {
  /** @type {{ column: string, cell: string, line: number }[]} */
  const claims = [];
  /** @type {string[] | null} */
  let header = null;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? '';
    if (!text.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = text
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const first = cells[0] ?? '';
    if (/^:?-+:?$/.test(first.replace(/\s/g, ''))) continue;
    if (/^\*{0,2}Column\*{0,2}$/i.test(first)) {
      header = cells.map((cell) => cell.replace(/\*/g, '').trim().toLowerCase());
      continue;
    }
    if (header === null) continue;
    const at = header.indexOf('constraints');
    if (at < 0) continue;
    // A TOMBSTONE IS NOT A CLAIM. `data-model-columns.mjs`'s ruling, inherited.
    if (first.includes('~~')) continue;
    const cell = cells[at] ?? '';
    for (const named of first.matchAll(/`(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)`/g)) {
      if (named[1] !== undefined && named[1] !== table) continue;
      const column = named[2];
      if (column === undefined) continue;
      claims.push({ column: column.toLowerCase(), cell, line: i + 1 });
    }
  }
  return claims;
}

/** @type {Invariant} */
const ri36 = {
  id: 'RI-36',
  title: "A design record's nullability is the nullability the migrations leave",
  covers:
    'ADR-329. EVERY `### <table>` DESIGN RECORD UNDER ' +
    '`docs/architecture/data-model/`, COLUMN BY COLUMN, AGAINST THE MIGRATION ' +
    'SET AS IT LEAVES THAT COLUMN. `CI-06i` reconciles the TABLE set in both ' +
    'directions and `scripts/corpus/data-model-columns.mjs` the COLUMN set; ' +
    'both stop at the name, and the axis neither reads is the one two records ' +
    'went stale on in two consecutive rows -- `wallet_entries.provenance` after ' +
    '`0080` (ADR-322) and `purchases.psp` and `.psp_reference` after `0081` ' +
    '(ADR-323), each reported as a landmine because nothing could report it as ' +
    'a failure. ' +
    'THE FOLD IS THE CHECK. A column is read as its `CREATE TABLE` declaration ' +
    'AMENDED by every later `ALTER COLUMN ... DROP NOT NULL` and `SET NOT ' +
    'NULL` in filename order, with `ADD COLUMN` and `RENAME COLUMN` folded and ' +
    'a table-level `PRIMARY KEY (...)` making its columns NOT NULL. A reader ' +
    'that stopped at the `CREATE TABLE` would agree with BOTH stale records, ' +
    'because a later migration is what made both columns nullable. ' +
    'LEG 1 IS THE COMPARISON, IN BOTH DIRECTIONS: a record that says `not ' +
    'null` about a nullable column and a record that says `null` about a NOT ' +
    'NULL one are both findings. LEG 2 IS SILENCE: a record row that states no ' +
    'nullability at all is a finding unless the DDL declares that column ' +
    '`GENERATED ALWAYS AS (...)`, which is the only shape in this set whose ' +
    'cell spends itself on an expression instead. Without leg 2 the check is ' +
    'satisfied by deleting two words from a row. LEG 3 IS THE MODEL: `DROP ' +
    'COLUMN`, a table `RENAME TO`, a `LIKE` body and any statement that adds ' +
    'or drops a PRIMARY KEY are shapes this fold cannot replay, and each is a ' +
    'THROW rather than a skip. ' +
    'IT DEMANDS NOTHING ABOUT A CHECK CONSTRAINT AND THAT IS THE LIMIT IT ' +
    'ACCEPTS. After `0080` `wallet_entries.provenance` is REQUIRED on a credit ' +
    'and null-or-`correction` on a debit by ' +
    '`wallet_entries_provenance_follows_direction`; this reads the column`s own ' +
    '`NOT NULL` and is blind to that, so a record saying only `null` passes. ' +
    'The constraint is guarded by ' +
    '`scripts/db/probe_wallet_debit_provenance.sql` and ' +
    '`scripts/db/probe_purchase_processor_columns.sql`, which `RI-24` requires ' +
    'to run and `CI-06h` to pin, and a record`s TYPE, DEFAULT and CONSTRAINT ' +
    'text against the DDL is named OWED in ADR-329 rather than attempted. ' +
    'FOUR MORE THINGS IT DOES NOT DO. It says nothing about a column only one ' +
    'side names, which is `data-model-columns.mjs`s subject in both ' +
    'directions. It reads the first cell of a `| Column |` table and that ' +
    'table`s own `Constraints` column, so a nullability written in prose below ' +
    'the table is invisible to it. A STRUCK-THROUGH ROW IS A TOMBSTONE AND NOT ' +
    'A CLAIM, inherited from `data-model-columns.mjs` and ADR-029. And it ' +
    'reads no database: the migration set in the tree is the whole input. ' +
    'SILENT on a tree carrying no migrations directory or no design records.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    // SILENT ON A TREE THAT CARRIES NEITHER INPUT, on RI-23, RI-24, RI-25 and
    // RI-26's precedent. The fixture estates in
    // `packages/tooling/test/repo-invariants.test.ts` carry neither, and a
    // check that reported on them would be reporting on a tree that is not
    // this repository. The sentinels below are what stop silence being a way
    // to pass on a tree that DOES carry them.
    const migrations = join(root, MIGRATIONS_DIR);
    const records = join(root, DATA_MODEL_DIR);
    if (!existsSync(migrations) || !existsSync(records)) return findings;

    const { tables, unmodelled, files } = foldColumnNullability(root);

    // LEG 3, AND IT IS RULE 1 RATHER THAN RULE 2. This is not an input the
    // check cannot reach; it is a migration set whose shape the fold does not
    // model, and reporting on it would be claiming to have checked something
    // that was not checked.
    if (unmodelled.length > 0) {
      throw new Error(
        `RI-36 found ${unmodelled.length} statement(s) under ${MIGRATIONS_DIR} that this fold ` +
          `cannot replay, so its nullability is no longer the schema's: ${unmodelled.join('; ')}. ` +
          'Teach the fold the statement before trusting this check again',
      );
    }
    if (tables.size === 0) {
      throw new Error(
        `RI-36 found no unqualified CREATE TABLE in the ${files.length} migration(s) under ` +
          `${MIGRATIONS_DIR}. Zero means the reader or the comment stripper has moved, and ` +
          'every column in the schema now reports as undeclared rather than as nullable',
      );
    }

    // THE READER IS WATCHED DISCRIMINATING RATHER THAN ASSUMED TO. A
    // `declaresNotNull` that returned a constant would agree with roughly one
    // record row in ten and disagree loudly with the rest, which looks like a
    // corpus-wide catastrophe rather than a broken reader; both dispositions
    // present is the cheap assertion that says which it is.
    const declared = [...tables.values()].flatMap((columns) => [...columns.values()]);
    const notNulls = declared.filter((column) => column.notNull).length;
    if (notNulls === 0 || notNulls === declared.length) {
      throw new Error(
        `RI-36 read ${declared.length} column(s) under ${MIGRATIONS_DIR} and ${notNulls} of ` +
          'them as NOT NULL. A schema is never all of one and none of the other, so this is ' +
          'the nullability reader having degraded to a constant rather than a finding',
      );
    }

    let compared = 0;
    const documents = readdirSync(records)
      .filter((f) => /^[a-z][a-z0-9_]*\.md$/.test(f))
      .sort();

    for (const document of documents) {
      const body = readFileSync(join(records, document), 'utf8');
      const heading = DESIGN_RECORD_HEADING.exec(body);
      // `CI-06i` owns "this file is not a readable design record" and owns "no
      // migration creates this table". Reporting either here would make one
      // defect two findings in two runners.
      if (heading?.[1] === undefined) continue;
      const table = heading[1];
      const columns = tables.get(table);
      if (columns === undefined) continue;

      for (const { column, cell, line } of recordColumnClaims(body, table)) {
        const folded = columns.get(column);
        // Only one side names it: `data-model-columns.mjs`'s finding, and not
        // this one's.
        if (folded === undefined) continue;
        compared += 1;
        const stated = statedNullability(cell);
        const where = `${DATA_MODEL_DIR}/${document}:${line}`;

        if (stated === null) {
          if (isGenerated(folded.def)) continue;
          findings.push(
            `${where}: the record states no nullability for \`${table}.${column}\`, and the ` +
              `migrations declare it ${folded.notNull ? 'NOT NULL' : 'nullable'} ` +
              `(${folded.where}). A row that says nothing is a row this check cannot ` +
              'compare, and silence is how a stale `not null` gets repaired by deletion ' +
              'rather than by correction. Its DDL is: ' +
              folded.def,
          );
          continue;
        }
        if (stated === folded.notNull) continue;

        findings.push(
          `${where}: the record says \`${table}.${column}\` is ` +
            `${stated ? '`not null`' : 'nullable'} and the migration set leaves it ` +
            `${folded.notNull ? 'NOT NULL' : 'nullable'} as of ${folded.where}. A design ` +
            'record is what the next module is built from, so a column stated the wrong way ' +
            'round is a module written against a schema that does not exist. Its DDL is: ' +
            folded.def,
        );
      }
    }

    // RULE 2 ON THE HALF A MISSING-INPUT GUARD CANNOT SEE. Every record could
    // parse to a heading and none to a `| Column |` table, or the claim reader
    // could stop matching backticked names, and the loop above would then
    // report nothing at all while asserting nothing at all.
    if (compared === 0) {
      throw new Error(
        `RI-36 compared no column at all over ${documents.length} design record(s) in ` +
          `${DATA_MODEL_DIR} and ${tables.size} table(s) in ${files.length} migration(s). ` +
          'Zero comparisons is the record reader having stopped reading, not a corpus with ' +
          'nothing to say',
      );
    }

    return findings;
  },
};

// -----------------------------------------------------------------------------
// RI-37  EVERY MIGRATION HAS A LANDING RECORD IN THE DELTA MANIFEST
// -----------------------------------------------------------------------------
// ADR-334. `0080` (ADR-322) and `0081` (ADR-323) are MERGED money-schema
// migrations and neither carries a landing section in
// `packages/db/DELTA_MANIFEST.md`. The absence was reported three times and
// repaired none: ADR-323's landmine list named it, ADR-327 carried it forward,
// ADR-330 carried it forward again, and ADR-329 section 9 finding 5 was still
// writing "`0080` and `0081` still carry no `DELTA_MANIFEST` section" four rows
// later. Every one of those is a session writing a sentence because nothing
// could write a failure.
//
// THE MANIFEST IS WHERE A MIGRATION'S EXECUTION LIVES, WHICH IS WHY THIS IS NOT
// A DOCUMENTATION RULE. A landing section carries the install verification from
// an empty database, the object counts read from `pg_tables`, `pg_indexes`,
// `pg_constraint` and `pg_trigger`, the probe transcript and the counterfactual
// that probe was watched failing on. Constitution E2 makes a merged migration
// permanent, so that record is the ONLY place the reasoning behind a permanent
// statement is written down at the migration's own number.
//
// A LANDING RECORD IS ONE OF EXACTLY TWO SHAPES AND NEITHER IS AN INVENTION.
//
//   1. A ROW OF THE MIGRATION SEQUENCE IN SECTION 1. That table is the record
//      of where each delta was FOLDED, and for `0001` to `0029` it is the only
//      record there is: the fold wrote no per-file section and never will,
//      because sections 10 to 12 verify the fold as one set.
//   2. A `## <n>.` SECTION HEADING NAMING THE NUMBER IN BACKTICKS. That is the
//      shape sections 13 onward use, one per superseding migration, and section
//      16's own note calls the sequence append-only. A HEADING CLAIMS ONLY THE
//      NUMBERS BEFORE ITS VERB: every landing heading here reads `0028` lands
//      or `0030` and `0031` land, and a number named AFTER the verb is a
//      cross-reference rather than a claim. That narrowing was forced by the
//      suite rather than designed: section 39's heading MENTIONS `0080` while
//      recording `0081`, and the first reader written here took every
//      backticked number and reported a clean tree with `0080` unrecorded.
//
// THE SECTION-1 LEG IS SCOPED TO SECTION 1 AND THAT IS LOAD BEARING. Section 14
// (`0030` and `0031`) carries a table of the identical shape, and a reader that
// took any four-digit first cell anywhere in the file would count a delta table
// row or a counts table as a record. Both of those numbers ALSO have headings,
// so the scoping costs nothing today and is what stops the leg widening on its
// own the next time somebody writes a table.
//
// LEG 2 RUNS THE OTHER WAY: a number the manifest records must be a file on
// disk. A section for a migration that does not exist is a record of something
// that never landed, and it is the shape a renumbered or abandoned migration
// leaves behind.
//
// LEG 3 IS THE BACKLOG AND IT IS A REGISTER RATHER THAN AN EXEMPTION LIST,
// which is `CI-06/gate-inventory`'s UNPROBEABLE_ARTIFACTS rule and `CI-06e`'s:
// AN ENTRY THAT NO LONGER NAMES A REAL GAP IS ITSELF A FINDING. Twenty
// migrations on this tree have no landing record and SIXTEEN OF THEM ARE MONEY
// PATH. Writing twenty sections in the diff that adds this check would be twenty
// records nobody measured, which is the one thing a landing section may not be;
// so they are enumerated here, with the file and the ADR that rules each, and
// the register can only shrink. It is not a way to pass: a migration that is
// NOT in it and has no record is a finding on the commit that adds it, so the
// backlog cannot grow without somebody writing a line into this file.
//
// LEG 3 RUNS IN ONE DIRECTION AND THE OTHER IS DELIBERATELY NOT TAKEN. An entry
// naming a migration this tree does not carry is INERT. Reporting it would make
// the register a claim about ONE migration set rather than a property of the
// check, and it would fire over every entry on any tree carrying a smaller set;
// constitution E2 makes a merged migration permanent, so the state it would
// guard is one the constitution already forbids. A MIS-KEYED ROW IS STILL
// CAUGHT, by leg 1: a row that types the wrong number absorbs nothing, so the
// file it meant to absorb is reported as having no record.
//
// LEG 4 IS THE OTHER REGISTRY IN THE SAME FILE, AND IT CLOSES THIS CHECK'S OWN
// INSTRUCTION. Leg 1's finding text tells a session to "write the section,
// claim its number in section 16's section-number table, and MEASURE it", and
// until this leg nothing could tell whether the middle clause was done. Section
// 16 is a SECTION-NUMBER ALLOCATION TABLE written after three sections were
// numbered `14` in one day, its own rule is "claim the next free number here in
// the commit that writes the section", and its own closing paragraph said in
// terms that "nothing reads this table". EIGHT OF ITS ROWS RECORD THE SAME
// OMISSION AND NOT ONE OF THEM COULD REPORT IT: `18` and `20` record THEMSELVES
// as having been written as a heading and never as a row, and `21`, `25`, `31`,
// `35`, `45` and `48` each NAME another session's missing row and decline to
// write it. The drift grew to EIGHT unclaimed numbers while they did.
//
// WHAT THE TABLE CLAIMS IS A SET OF NUMBERS, AND THAT IS NOT WHAT A ROW COUNT
// OR A LANDING-RECORD COUNT MEASURES. Its key column is a section number, one
// row keys an inclusive RANGE (`1 to 13`), a lettered heading takes no number
// at all by the table's own written rule, and a number claimed more than once
// is left claimed more than once. So the comparison is: THE SET OF NUMBERS ON
// `## <n>.` HEADINGS AGAINST THE SET OF NUMBERS THE TABLE'S KEY COLUMN CLAIMS.
// A naive one-row-per-landing-heading reader is wrong in BOTH directions: it
// would demand rows for `4a`, `4b` and `4c`, and demand three obligations of
// `## 14.` where the table records one number claimed three times, while
// missing that sections 15, 16 and 22 take numbers and record no landing at
// all.
//
// IT RUNS IN BOTH DIRECTIONS, on legs 1 and 2's idiom. A heading with no claim
// is the drift that has recurred eight times. A claim with no heading is what a
// renumbered or abandoned section leaves behind, and the reservation objection
// does not reach it here because this table's own rule puts the claim in the
// commit that writes the section. Together they turn a MIS-KEYED row into two
// findings that name each other rather than one that names neither.
//
// THE KEY COLUMN IS READ AS A SET, AND THAT IS THE WRITTEN RULE BY WHICH THE
// RECORDED COLLISION IS TOLERATED RATHER THAN A SPECIAL CASE FOR ONE ROW.
// Section 16 rules its own collisions in terms -- "Neither is renumbered, and
// that is a ruling rather than an omission ... The collision is left in place
// and the table allocates forward" -- because renumbering breaks every citation
// of whichever one moves. Two rows carrying one number therefore claim ONE
// number: `21` is claimed by `0038`'s session and again by `ADR-068`'s, and it
// is one member. The same sentence runs over the headings, where `## 14.` heads
// three sections and `## 21.` heads two. THE COST IS STATED RATHER THAN HIDDEN:
// this leg can no more report a FUTURE duplicate row than the recorded one, and
// it does not quietly absorb that job. Duplicate rows in an allocation table
// are `OI-11`, which is open, names its own blocker, and is section 16's row.
//
// FIVE THINGS IT DOES NOT DO.
//   1. IT NEVER READS A SECTION'S CONTENT. Whether a landing section carries an
//      install verification, a probe transcript or a counterfactual is the E2
//      read and is not a parse. This check asserts the record EXISTS.
//   2. It reads no database. The migration directory and one markdown file are
//      the whole input.
//   3. It says nothing about ORDER. Sections 35, 36 and 37 are `0079`, `0078`
//      and `0082`, because the sequence is landing order and not migration
//      order, and a check demanding otherwise would be inventing a rule the
//      file's own section 16 contradicts.
//   4. It says nothing about a migration number that is RESERVED and unwritten.
//      `0058`, `0060` to `0062`, `0069`, `0071` and `0077` are rows of
//      ALLOCATION's migration table with no file, and a reservation is not a
//      landing.
//   5. It does not read ALLOCATION at all, so a file on disk that no table ever
//      claimed is invisible here. That is `CI-06f`'s and `CI-06w`'s subject.
//
// SILENT on a tree carrying no migrations directory and no manifest, on RI-23,
// RI-24, RI-25, RI-26 and RI-36's precedent. The sentinels below are what stop
// silence being a way to pass on a tree that DOES carry them.

const MANIFEST_DOC = 'packages/db/DELTA_MANIFEST.md';

/** The heading that opens the migration-sequence table. Section 1, and only it. */
const MIGRATION_SEQUENCE_HEADING = /^## 1\.\s/;

/** A migration file, by the name the whole estate cites it under. */
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * The verb every landing heading in this file uses, and the boundary of a
 * heading's CLAIM: numbers before it are recorded, numbers after it are prose.
 */
const LANDING_VERB = /\bland(?:s)?\b/;

/** The sub-heading that opens section 16's section-number allocation table. */
const SECTION_NUMBER_TABLE_HEADING = /^### Section numbers\s*$/;

/**
 * A `## <n>.` heading that TAKES a section number.
 *
 * NUMERIC ONLY, AND THE LETTERS ARE EXCLUDED BY THE TABLE'S OWN WRITTEN RULE
 * rather than by this reader's taste: "`4a` is a section and not a number ...
 * A lettered section deliberately claims no number, so the sequence this table
 * allocates is undisturbed by either, and adding rows for them would make the
 * table's own key ambiguous between a number and a name." `4a`, `4b` and `4c`
 * head six sections between them and none of them is owed a row.
 */
const SECTION_HEADING = /^## (\d+)\./;

/**
 * A row of the section-number table, keyed by one number or by an inclusive
 * RANGE. The `1 to 13` row claims thirteen numbers in one row, which is why a
 * reader counting ROWS against headings answers the wrong question in one
 * direction and a reader counting landing records answers it in the other.
 */
const SECTION_NUMBER_ROW = /^\|\s*\*{0,2}(\d+)(?:\s+to\s+(\d+))?\*{0,2}\s*\|/;

/**
 * THE BACKLOG: migrations that landed with no record, each with the file and
 * the ruling its own header cites.
 *
 * IT IS EXPORTED, AND THAT IS A SEAM THE EMPTINESS FORCED RATHER THAN A
 * CONVENIENCE. `packages/db/test/migration-landing-record.test.ts` carries a
 * case per leg, and leg 3's two cases used a LIVE register entry (`0073`) as
 * their fixture. With the register empty there is no live entry left to seed
 * from, so leg 3 would have become untestable and its cases would have been
 * deleted -- coverage lost to a repair, which is the worst of the options. The
 * suite now seeds an entry into this Map and removes it in a `finally`, so leg
 * 3 is asserted exactly as before against a register that holds nothing. THE
 * CHECK'S BEHAVIOUR IS UNCHANGED: nothing here reads the export and no caller
 * writes to it outside that suite.
 *
 * IT IS EMPTY, AS OF 2026-09-05, AND THE EMPTINESS IS THE POINT RATHER THAN A
 * REASON TO DELETE IT. Every `nnnn_*.sql` under packages/db/migrations now has
 * a landing record, so leg 1 is UNCONDITIONAL from here: a merged migration
 * with no section is a finding on the commit that merges it and there is no
 * row left to absorb one. Deleting the map would delete leg 3 with it, and leg
 * 3 is the mechanism that emptied it; the next twenty-migration backlog would
 * then arrive with nowhere to be registered and would be argued about in prose
 * instead. An empty map asserts nothing and costs one iteration of a loop.
 *
 * IT IS A REGISTER AND NOT AN EXEMPTION LIST, and the difference is leg 3: an
 * entry naming a migration that HAS a record, or a migration that is not on
 * disk, is a finding. So a session that writes one of these sections must
 * delete its row here in the same commit, and the register decays in the one
 * direction an allowlist has to decay in.
 *
 * IT IS NOT A RULING THAT THESE MIGRATIONS NEED NO RECORD. Every one of them
 * is owed the section `0080` and `0081` get in ADR-334. What it records is that
 * measuring an install and a probe transcript per migration is a row of its own,
 * dispatched knowing its size, rather than twenty sections written from twenty
 * ADRs in one diff. A landing section that was reconstructed from an ADR instead
 * of measured is the exact thing this check exists to make somebody stop and do
 * properly.
 *
 * IT SHRANK FIVE TIMES AND REACHED ZERO, AND EACH SHRINK IS THE MECHANISM
 * WORKING. ADR-334 opened it at TWENTY entries. ADR-335 wrote DELTA_MANIFEST
 * sections 40 to 45 for `0052` to `0057`, the chart-of-accounts and
 * ledger-code run, and deleted those six rows in the same commit. ADR-336
 * wrote sections 46 to 48 for `0068`, `0070` and `0072`, the
 * withdrawal-approval run, and deleted those three. ADR-351 took the remaining
 * eleven in three clusters: sections 49 to 51 for `0037`, `0059` and `0063`;
 * sections 52 to 55 for `0039`, `0040`, `0041` and `0043`; sections 56 to 59
 * for `0044`, `0050`, `0073` and `0074`. Every one of the twenty was measured
 * against PostgreSQL 16.13 rather than reconstructed from its ADR.
 *
 * WHAT THE ZERO DOES NOT MEAN. This check reads no content, so it cannot tell
 * a section measured against a database from one copied out of a ruling, which
 * is the distinction ADR-334 refused to blur when it opened the register
 * rather than writing twenty sections in one diff. Nor does it mean the
 * schema is watched: ADR-351 section 3 measured that FOUR of its eleven are
 * covered by nothing under scripts/db/, `0044` and `0074` among them, and both
 * of those open with an `E2 READ: MONEY PATH` header.
 *
 * THE MONEY-PATH FIGURE ADR-334 RECORDED WAS SIXTEEN OF TWENTY AND THE MEASURED
 * FIGURE IS FIFTEEN. `0073_operator_directory.sql:4` opens `NOT THE MONEY PATH
 * BY FILE`, so the header is absent; a substring search for `MONEY PATH` over
 * those twenty returns EIGHTEEN, because `0041:4` and `0043:4` read `NON-MONEY
 * PATH` as well. ADR-334's own row for `0073` below carries no marker, so the
 * two halves of that entry disagreed and this one, the machine-readable half,
 * was right. No merged record is amended; ADR-335 reports it.
 */
export const LANDING_RECORD_BACKLOG = new Map([]);

/**
 * Every landing record `packages/db/DELTA_MANIFEST.md` carries, by migration
 * number, with the site that carries it; and, for leg 4, every SECTION NUMBER
 * the file's headings take against every section number its own allocation
 * table claims.
 *
 * @param {string} root
 * @returns {{
 *   records: Map<string, string[]>,
 *   rows: number,
 *   headings: number,
 *   sections: Map<number, string[]>,
 *   claims: Map<number, string[]>,
 *   claimRows: number,
 *   sawTable: boolean,
 * }}
 */
function landingRecords(root) {
  /** @type {Map<string, string[]>} */
  const records = new Map();
  let rows = 0;
  let headings = 0;
  /** Numeric `## <n>.` headings, by the number they take. @type {Map<number, string[]>} */
  const sections = new Map();
  /** Section numbers section 16's table claims, by number. @type {Map<number, string[]>} */
  const claims = new Map();
  let claimRows = 0;
  let sawTable = false;
  let inClaimTable = false;
  /** @param {string} number @param {string} where */
  const note = (number, where) => {
    const seen = records.get(number) ?? [];
    seen.push(where);
    records.set(number, seen);
  };

  let inSequence = false;
  const lines = readFileSync(join(root, MANIFEST_DOC), 'utf8').split('\n');
  lines.forEach((text, index) => {
    const at = `${MANIFEST_DOC}:${index + 1}`;
    // LEG 4's TABLE REGION, and it ends at the next heading of EITHER depth.
    // Section 16 carries two tables under two `###` sub-headings, and a reader
    // that ran to the next `## ` would take the trailing prose of section 16
    // and then stop, which is harmless today and is the kind of scope that
    // widens on its own the next time somebody writes a table.
    if (text.startsWith('### ') || text.startsWith('## ')) {
      if (SECTION_NUMBER_TABLE_HEADING.test(text)) {
        sawTable = true;
        inClaimTable = true;
      } else {
        inClaimTable = false;
      }
    } else if (inClaimTable) {
      const claim = SECTION_NUMBER_ROW.exec(text);
      if (claim !== null) {
        claimRows += 1;
        const from = Number(claim[1]);
        const to = claim[2] === undefined ? from : Number(claim[2]);
        for (let n = from; n <= to; n += 1) {
          claims.set(n, [...(claims.get(n) ?? []), at]);
        }
      }
    }
    if (text.startsWith('## ')) {
      const numbered = SECTION_HEADING.exec(text);
      if (numbered !== null) {
        const number = Number(numbered[1]);
        sections.set(number, [
          ...(sections.get(number) ?? []),
          `${at}, "${text.slice(3).trim().slice(0, 72)}"`,
        ]);
      }
      inSequence = MIGRATION_SEQUENCE_HEADING.test(text);
      // THE CLAIM IS THE PART OF THE HEADING BEFORE THE WORD `land`, AND THAT
      // IS A NARROWING THE SUITE FORCED RATHER THAN A FLOURISH. Section 39's
      // heading reads "`0081` lands, and the record that was owed with it is
      // written in the same commit as `0080`'s"; a reader taking every
      // backticked number in the heading counted that MENTION as a record for
      // `0080` and reported the tree clean with `0080` unrecorded, which the
      // reconstruction case caught. Every landing heading in this file names
      // its own migration before the verb -- `0028` lands, `0030` and `0031`
      // land, `0048` and `0049` land -- and a heading with no `land` in it,
      // like section 15's or section 22's, claims nothing.
      const verb = LANDING_VERB.exec(text);
      if (verb === null) return;
      for (const named of text.slice(0, verb.index).matchAll(/`(\d{4})`/g)) {
        headings += 1;
        note(named[1] ?? '', `${at}, the section headed "${text.slice(3).trim().slice(0, 72)}"`);
      }
      return;
    }
    if (!inSequence) return;
    const row = /^\|\s*\*{0,2}(\d{4})\*{0,2}\s*\|/.exec(text);
    if (row === null) return;
    rows += 1;
    note(row[1] ?? '', `${at}, a row of the migration sequence in section 1`);
  });

  return { records, rows, headings, sections, claims, claimRows, sawTable };
}

/** @type {Invariant} */
const ri37 = {
  id: 'RI-37',
  title:
    'Every migration has a landing record in the delta manifest, and every ' +
    'section number the manifest uses is claimed in its own allocation table',
  covers:
    'ADR-334. EVERY `nnnn_*.sql` UNDER `packages/db/migrations` AGAINST ' +
    '`packages/db/DELTA_MANIFEST.md`, IN BOTH DIRECTIONS. `0080` (ADR-322) ' +
    'and `0081` (ADR-323) are merged money-schema migrations that carry no ' +
    'landing section, and the absence was written down as a landmine by ' +
    'ADR-323, carried forward by ADR-327 and ADR-330 and still true at ' +
    'ADR-329 section 9 finding 5, because nothing could write it down as a ' +
    'failure. ' +
    'A LANDING RECORD IS ONE OF TWO SHAPES, AND BOTH ARE THE MANIFEST`s OWN: ' +
    'a row of the migration-sequence table in SECTION 1, which is the only ' +
    'record `0001` to `0029` have or will have because the fold verifies them ' +
    'as one set; or a `## <n>.` section heading naming the number in ' +
    'backticks BEFORE ITS VERB, which is the shape every section from 13 ' +
    'onward uses -- ``0028` lands`, ``0030` and `0031` land` -- so a number ' +
    'named AFTER the verb is a cross-reference and claims nothing. THE ' +
    'TABLE LEG IS SCOPED TO SECTION 1: section 14 carries a table of the same ' +
    'shape and an unscoped reader would count a delta row or a counts row as ' +
    'a record. ' +
    'LEG 2 RUNS THE OTHER WAY: a number the manifest records must be a file on ' +
    'disk, so a section for a migration that never landed is a finding. ' +
    'LEG 3 IS THE BACKLOG REGISTER, and it is a register rather than an ' +
    'exemption list on `CI-06/gate-inventory`s rule: an entry that no longer ' +
    'names a real gap is ITSELF a finding, so a session writing one of those ' +
    'sections must delete its row in the same commit and the register can only ' +
    'shrink. IT RUNS IN ONE DIRECTION: an entry naming a migration this tree ' +
    'does not carry is INERT, because reporting it would make the register a ' +
    'claim about one migration set rather than a property of the check and ' +
    'constitution E2 already forbids deleting a merged migration; a mis-keyed ' +
    'row is caught by leg 1 instead, since the number it failed to absorb is ' +
    'then reported as unrecorded. IT OPENED AT TWENTY UNDER ADR-334 AND IS NOW EMPTY: ' +
    'ADR-335 wrote DELTA_MANIFEST sections 40 to 45 for `0052` to `0057` ' +
    'and deleted those six rows in the same commit, ADR-336 wrote sections ' +
    '46 to 48 for `0068`, `0070` and `0072` and deleted those three, and ADR-351 ' +
    'wrote sections 49 to 59 for the remaining eleven and deleted them across ' +
    'three commits, which is leg 3 doing its work rather than an allowlist ' +
    'being trimmed. SO LEG 1 IS UNCONDITIONAL FROM HERE and a merged migration ' +
    'with no section is a finding on the commit that merges it. THE EMPTY MAP ' +
    'IS KEPT RATHER THAN DELETED, because deleting it takes leg 3 out of the ' +
    'tree and the next backlog would have nowhere to be registered. ' +
    'A migration outside it with no record is a finding on the commit ' +
    'that adds it, so the backlog cannot grow without an edit to this file, ' +
    'and with the register empty that is EVERY migration. ' +
    'LEG 4 IS THE OTHER REGISTRY IN THE SAME FILE AND IT CLOSES THIS CHECK`s ' +
    'OWN INSTRUCTION (ADR-337): leg 1 tells a session to claim the section`s ' +
    'number in section 16`s section-number table and nothing could tell ' +
    'whether it did. THE COMPARISON IS THE SET OF NUMBERS ON `## <n>.` ' +
    'HEADINGS AGAINST THE SET THE TABLE`s KEY COLUMN CLAIMS, in BOTH ' +
    'directions, which is neither a row count nor a landing-record count: one ' +
    'row keys an inclusive RANGE (`1 to 13`), sections 15, 16 and 22 take ' +
    'numbers and record no landing, and `## 14.` heads three sections on one ' +
    'claimed number. A LETTERED HEADING TAKES NO NUMBER, which is the table`s ' +
    'own written rule -- `4a`, `4b` and `4c` head six sections between them ' +
    'and none is owed a row -- so they are excluded rather than reported. ' +
    'THE KEY COLUMN IS READ AS A SET, and that is the written rule by which ' +
    'the RECORDED collision is tolerated rather than a special case for one ' +
    'row: section 16 rules that a collision "is left in place and the table ' +
    'allocates forward" because renumbering breaks every citation of whichever ' +
    'one moves, so the two rows claiming `21` claim ONE number. THE COST IS ' +
    'STATED: this leg can no more report a FUTURE duplicate row than the ' +
    'recorded one, and it does not absorb that job, which is `OI-11`s and is ' +
    'open with its own blocker named. ' +
    'FIVE THINGS IT DOES NOT DO. It never reads a section`s CONTENT: whether a ' +
    'record carries an install verification, object counts read from the ' +
    'catalogue, a probe transcript and the counterfactual that probe was ' +
    'watched failing on is the `E2` read and is not a parse. It reads no ' +
    'database. It says nothing about ORDER, because sections 35, 36 and 37 are ' +
    '`0079`, `0078` and `0082` and the sequence is LANDING order. It says ' +
    'nothing about a reserved-unwritten number, because a reservation is not a ' +
    'landing. And it does not read ALLOCATION, so a migration on disk that no ' +
    'allocation row ever claimed is `CI-06f`s and `CI-06w`s subject and not ' +
    'this one`s. ' +
    'SILENT on a tree carrying no migrations directory or no manifest.',
  /** @param {string} root */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    // SILENT ON A TREE THAT CARRIES NEITHER INPUT, on RI-23, RI-24, RI-25,
    // RI-26 and RI-36's precedent. The synthetic estates in
    // `packages/tooling/test/repo-invariants.test.ts` carry neither.
    const migrations = join(root, MIGRATIONS_DIR);
    if (!existsSync(migrations) || !existsSync(join(root, MANIFEST_DOC))) return findings;

    const files = readdirSync(migrations)
      .filter((f) => MIGRATION_FILE.test(f))
      .sort();

    // RULE 1 AND NOT RULE 2, three times. Each of these is the reader having
    // stopped reading rather than a corpus with nothing to say, and each would
    // otherwise report a clean estate or a catastrophe in the wrong direction.
    if (files.length === 0) {
      throw new Error(
        `RI-37 found no \`nnnn_*.sql\` in ${MIGRATIONS_DIR}, which exists. Zero migrations ` +
          'means the file-name reader has moved, and every backlog row below would then ' +
          'report as stale in the same run',
      );
    }

    const { records, rows, headings, sections, claims, claimRows, sawTable } = landingRecords(root);
    if (rows === 0) {
      throw new Error(
        `RI-37 parsed no migration-sequence row out of section 1 of ${MANIFEST_DOC}. That ` +
          'table is the only landing record `0001` to `0029` have, so zero rows would ' +
          'report twenty-nine merged migrations as unrecorded and name the wrong defect',
      );
    }
    if (headings === 0) {
      throw new Error(
        `RI-37 parsed no \`## <n>.\` landing section out of ${MANIFEST_DOC}. That is the ` +
          'shape every section from 13 onward uses, so zero means the heading reader has ' +
          'moved rather than that no migration has ever been recorded',
      );
    }

    // LEG 4's SENTINELS, and they are RULE 1 rather than rule 2 on the three
    // above's precedent. A manifest with no section-number table, or one whose
    // table parses to zero rows, would make leg 4 report EVERY numbered
    // heading in the file as unclaimed -- forty-seven findings naming the
    // wrong defect, which is the loud-and-wrong direction this project can
    // least afford. Both are the reader having stopped reading.
    //
    // SILENCE IS NOT AVAILABLE HERE THE WAY IT IS FOR A MISSING FILE. The
    // manifest exists by the time this line runs, and a manifest that carries
    // landing sections and no allocation table is a manifest that lost its
    // table, not a tree that never had one.
    if (!sawTable) {
      throw new Error(
        `RI-37 found no \`### Section numbers\` table in ${MANIFEST_DOC}, which carries ` +
          `${sections.size} numbered section(s). That table is the allocation register leg ` +
          '4 compares against, so a missing one would report every heading in the file as ' +
          'unclaimed and name the wrong defect',
      );
    }
    if (claimRows === 0) {
      throw new Error(
        `RI-37 parsed no row out of ${MANIFEST_DOC}'s \`### Section numbers\` table, which ` +
          'it found. Zero rows means the row reader has moved rather than that the table ' +
          'claims nothing, and leg 4 would then report every numbered heading as unclaimed',
      );
    }

    // LEG 1. Every migration on disk is recorded, or is a backlog row.
    const onDisk = new Set();
    for (const file of files) {
      const number = MIGRATION_FILE.exec(file)?.[1] ?? '';
      onDisk.add(number);
      if (records.has(number)) continue;
      if (LANDING_RECORD_BACKLOG.has(number)) continue;
      findings.push(
        `${MIGRATIONS_DIR}/${file} is on disk and ${MANIFEST_DOC} carries no landing record ` +
          `for \`${number}\`: no row of the migration sequence in section 1 and no ` +
          `\`## <n>.\` section naming it. A merged migration is permanent (constitution ` +
          'E2), so its landing section is the only place the install it was verified ' +
          'against, the object counts it moved and the probe it was watched failing on are ' +
          'written down at its own number. Write the section, claim its number in section ' +
          "16's section-number table, and MEASURE it rather than reconstructing it from " +
          'the ADR',
      );
    }

    // LEG 2, the other direction.
    for (const [number, sites] of [...records].sort()) {
      if (onDisk.has(number)) continue;
      findings.push(
        `${MANIFEST_DOC} records \`${number}\` as landed at ${sites.join('; ')}, and ` +
          `${MIGRATIONS_DIR} carries no such file. A landing record for a migration that ` +
          'is not on disk is a record of something that never landed, which is what a ' +
          'renumbered or abandoned migration leaves behind',
      );
    }

    // LEG 3. The register shrinks, and a stale entry is a finding.
    for (const [number, why] of LANDING_RECORD_BACKLOG) {
      // AN ENTRY NAMING A MIGRATION THIS TREE DOES NOT CARRY IS INERT, AND
      // THAT IS ONE DIRECTION DELIBERATELY NOT TAKEN. Reporting it would make
      // the register a claim about ONE migration set rather than a property of
      // the check, and it would fire over every entry on any tree carrying a
      // smaller set -- which is exactly what the synthetic estate in
      // `packages/tooling/test/repo-invariants.test.ts` is. Constitution E2
      // makes a merged migration permanent, so the state it would guard is one
      // the constitution already forbids. AND A MIS-KEYED ROW IS STILL CAUGHT,
      // by leg 1 rather than here: a row that types the wrong number absorbs
      // nothing, so the file it meant to absorb is reported as unrecorded.
      if (!onDisk.has(number)) continue;
      const sites = records.get(number);
      if (sites === undefined) continue;
      findings.push(
        `RI-37's backlog register holds \`${number}\` (${why}) and ${MANIFEST_DOC} now ` +
          `carries its landing record at ${sites.join('; ')}. The register may only ` +
          'shrink, so the row comes out in the same commit as the section that closes ' +
          'it. An exemption left standing behind a repair is how an allowlist stops ' +
          'being read',
      );
    }

    // LEG 4, BOTH DIRECTIONS, over the SET of numbers rather than over rows.
    for (const [number, sites] of [...sections].sort((a, b) => a[0] - b[0])) {
      if (claims.has(number)) continue;
      findings.push(
        `${MANIFEST_DOC} heads section \`${number}\` at ${sites.join('; ')} and its own ` +
          'section-number table in section 16 carries no row claiming `' +
          `${number}\`. That table exists because three sections were numbered \`14\` in ` +
          'one day, and its rule is to claim the next free number in the commit that ' +
          'writes the section. A number taken by a heading and never entered is invisible ' +
          'to the next session reading the table for the maximum, which is how the ' +
          'collision it was written to end happens again',
      );
    }
    for (const [number, sites] of [...claims].sort((a, b) => a[0] - b[0])) {
      if (sections.has(number)) continue;
      findings.push(
        `${MANIFEST_DOC}'s section-number table claims \`${number}\` at ${sites.join('; ')} ` +
          `and no \`## ${number}.\` heading in that file takes it. This table's own rule ` +
          'puts the claim in the commit that writes the section, so a claim standing alone ' +
          'is what a renumbered or abandoned section leaves behind rather than a ' +
          'reservation in flight',
      );
    }

    return findings;
  },
};

export const CHECKS = [
  ri01,
  ri02,
  ri03,
  ri04,
  ri05,
  ri06,
  ri07,
  ri08,
  ri09,
  ri10,
  ri11,
  ri12,
  ri13,
  ri14,
  ri15,
  ri16,
  ri18,
  ri19,
  ri20,
  ri21,
  ri22,
  ri23,
  ri24,
  ri25,
  ri26,
  ri27,
  ri28,
  ri29,
  ri30,
  ri31,
  ri33,
  ri34,
  ri35,
  ri36,
  ri37,
];

// =============================================================================
// THE REPORT, AND WHY A CRASH IS ITS OWN OUTCOME
// =============================================================================
// ADR-294. This runner used to count a check whose body threw into the same
// tally as a check that found a violation, and then print the difference as
//
//     29 of 30 invariants hold.
//
// over a run of 30 checks that produced 29 passes, ZERO fails and ONE crash.
// Every word of that line is the wrong shape. It reads as a measurement, it
// puts the crashed check on the held side of the sentence by arithmetic, and a
// session reading it cannot tell a real violation from a broken runner. Two
// sessions hit it in one afternoon with `node_modules` absent, where RI-18's
// lazy `typescript` load throws, and both reported the COUNT rather than the
// CRASH, which is the direction this project can least afford to be wrong in:
// header rule 2 says a check that cannot run is not a check that passed, and
// the report was saying the opposite.
//
// So the tally is THREE-WAY and the denominator never moves. A crashed check is
// reported ERROR, is counted apart from both PASS and FAIL, stays in the `of N`,
// and takes the exit code to `EXIT.CRASHED` rather than sharing `EXIT.VIOLATED`
// with a real finding. The `N of N invariants hold` sentence is printed ONLY on
// a run where nothing crashed, because that sentence is a claim about a
// completed measurement and a run holding an ERROR did not complete one.
//
// THE OUTCOME IS DECIDED HERE AND NOT INSIDE ANY CHECK, which is what makes it
// hold for `ri11` and `ri18`, the two checks that live in other files and are
// imported into `CHECKS`: they throw across a module boundary like any other
// and this `try` is what reads them. The one crash it cannot see is a module
// that throws while it is being IMPORTED, which kills the process before a
// check runs at all. That is the reason RI-18 loads its compiler lazily, and it
// is survivable for the same reason: node exits non-zero with a stack trace and
// no summary, so it can never be mistaken for a count.

/**
 * The exit codes, named because the shell is where the distinction is spent.
 *
 * `CRASHED` is 3 rather than 2 because 2 already means a usage error, and it is
 * separate from `VIOLATED` because "this tree breaks an invariant" and "this run
 * did not measure the tree" are different facts that want different responses.
 * It DOMINATES `VIOLATED` on a run that produced both: the findings you can see
 * are the smaller news when a check went unread.
 */
export const EXIT = { OK: 0, VIOLATED: 1, USAGE: 2, CRASHED: 3 };

/**
 * Run `checks`, emitting one transcript line at a time, and return the tally.
 *
 * `emit` is a parameter rather than a bare `console.log` so the suite can read
 * the transcript this file actually prints instead of a second copy of the
 * wording, and so a long run still streams line by line instead of going quiet
 * until the last check returns.
 *
 * @param {readonly Invariant[]} checks
 * @param {{ root?: string, emit?: (line: string) => void }} [options]
 * @returns {{ passed: number, failed: number, errored: number, total: number, exitCode: number }}
 */
export function runChecks(checks, options = {}) {
  const { root = REPO_ROOT, emit = console.log } = options;
  const total = checks.length;
  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (const check of checks) {
    /** @type {string[]} */
    let findings;
    try {
      findings = check.run(root);
    } catch (err) {
      errored++;
      emit(`ERROR  ${check.id}  ${check.title}  (THIS CHECK DID NOT RUN)`);
      emit(`       ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (findings.length === 0) {
      passed++;
      emit(`PASS   ${check.id}  ${check.title}`);
    } else {
      failed++;
      emit(`FAIL   ${check.id}  ${check.title}  (${findings.length})`);
      for (const f of findings) emit(`       ${f}`);
    }
  }

  emit('');
  if (errored === 0) {
    emit(
      `${passed} of ${total} invariants hold.` +
        (failed ? ' Each one is a property the scaffold exists to make impossible to lose.' : ''),
    );
  } else {
    emit(`${errored} of ${total} check(s) COULD NOT RUN, so this run did not measure the tree.`);
    emit(`${passed} passed, ${failed} failed, ${errored} errored, of ${total} check(s).`);
    emit(
      'A CHECK THAT CRASHED IS NOT A CHECK THAT HELD, so this run does not get to say ' +
        `"${passed} of ${total} invariants hold": it is ${passed} measurement(s) and ` +
        `${errored} unknown(s), and the unknown is where a violation hides. Fix the ` +
        'ERROR above and run it again.',
    );
  }

  return {
    passed,
    failed,
    errored,
    total,
    exitCode: errored > 0 ? EXIT.CRASHED : failed > 0 ? EXIT.VIOLATED : EXIT.OK,
  };
}

function main() {
  const [arg] = process.argv.slice(2);

  if (arg === 'list') {
    for (const c of CHECKS) console.log(`${c.id}  ${c.title}\n      covers: ${c.covers}\n`);
    return EXIT.OK;
  }

  const selected = arg ? CHECKS.filter((c) => c.id === arg) : CHECKS;
  if (selected.length === 0) {
    console.error(`no such check: ${arg}. Try: list`);
    return EXIT.USAGE;
  }

  return runChecks(selected).exitCode;
}

// Importable by the test that watches each check fail, runnable by CI-01.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main());
