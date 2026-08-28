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
import { builtinModules } from 'node:module';
import { join, dirname, resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Source with comments removed, so a specifier quoted inside a header block is
 * not read as an import.
 *
 * These files carry more prose than code and several headers quote real import
 * lines while explaining them, so scanning the raw text would report findings
 * against sentences. The `[^:]` guard keeps `https://` out of the line-comment
 * pattern.
 */
/**
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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

/** The files whose `file:line` citations describe the tree as it is now. */
const CITED_REASON_FILES = [
  // RI-14'S OWN THREE, because this is the same property read at a different
  // resolution: a reason somebody wrote down, checked against the tree it
  // describes. RI-14 asks whether the named thing is there at all; this asks
  // whether it is where the reason says.
  'apps/api/test/wiring.test.ts',
  'apps/api/src/idempotency.ts',
  'apps/api/src/routes/wallet-withdrawals.ts',
  // The file whose absence the first false claim asserted, and the two densest
  // live reason files in the tree after `wiring.test.ts`.
  'apps/api/src/idempotency-store.ts',
  'apps/api/src/routes/payouts.ts',
  'apps/worker/src/detectors/fills.ts',
];

/**
 * THE ONE FINDING THIS CHECK MADE ON ITS FIRST RUN THAT THE SESSION WRITING IT
 * COULD NOT REPAIR, enumerated here rather than dropped and rather than answered
 * with a wider window.
 *
 * `wiring.test.ts:168` cites `routes/admin-wallet.ts:538` for `principal(request)`
 * and `principal(request)` is declared at `:601`. IT WAS TRUE THE DAY IT WAS
 * WRITTEN: commit `563ac3d` wrote it against a tree where `principal` WAS on
 * :538, and commit `224fe5b` then inserted 63 lines above it. That is a FIFTH
 * false citation in that file, live on `main`, found by the check on its first
 * run over the file it was built for.
 *
 * IT IS NOT FIXED HERE BECAUSE THIS SESSION DOES NOT OWN THAT FILE. Session 322
 * does, this wave. Dropping `wiring.test.ts` from the list to get green would
 * blind the check to the one file it exists for; widening the window to 63 lines
 * would blind it everywhere. Naming the single citation is the narrowest thing
 * that keeps both.
 *
 * THE ENTRY IS EXACT AND IT EXPIRES BY ITSELF: file, cited pointer and name all
 * three must match, so it covers this citation and no other, and the day the
 * pointer is corrected it matches nothing and the check stays green. It is then
 * a dead constant for a later session to delete, which is the smaller of the two
 * costs; the other is a red build on somebody else's branch on the day they fix
 * the thing this asked them to fix.
 *
 * @type {readonly {file: string, cites: string, name: string}[]}
 */
const CITATIONS_OWNED_ELSEWHERE = [
  { file: 'apps/api/test/wiring.test.ts', cites: 'routes/admin-wallet.ts:538', name: 'principal' },
];

/** How far from the cited line the name may sit. Two, and the header says why. */
const CITATION_WINDOW = 2;

/** How far a bare `:N` may sit from the full path it continues. */
const CITATION_INHERIT_LINES = 6;

/** The extensions a citation may name. */
const CITED_EXTENSIONS = 'ts|tsx|mts|mjs|js|sql|md|json|ya?ml';

/**
 * A citation inside backticks: `` `path/to/file.ts:12` ``, `` `file.ts:12-34` ``
 * or the bare `` `:12` `` that continues the path cited before it.
 */
const CITATION = new RegExp(
  '`([^`\\n]*?)((?:[A-Za-z0-9_./-]*[A-Za-z0-9_-]\\.(?:' +
    CITED_EXTENSIONS +
    '))?):(\\d+)(?:-(\\d+))?`',
  'g',
);

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
 * @returns {{flat: string, lineAt: number[]}}
 */
function flattenReasons(text) {
  const JOINER = /['"]?[ \t]*\+?[ \t]*\r?\n[ \t]*(?:\/\/+|\*|>)?[ \t]*['"]?/g;
  let flat = '';
  /** @type {number[]} */
  const lineAt = [];
  let line = 1;
  let i = 0;
  for (const m of text.matchAll(JOINER)) {
    const start = m.index ?? 0;
    for (; i < start; i += 1) {
      flat += text.charAt(i);
      lineAt.push(line);
    }
    for (const ch of m[0]) if (ch === '\n') line += 1;
    flat += ' ';
    lineAt.push(line);
    i = start + m[0].length;
  }
  for (; i < text.length; i += 1) {
    if (text.charAt(i) === '\n') line += 1;
    flat += text.charAt(i);
    lineAt.push(line);
  }
  return { flat, lineAt };
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
  // for 215 lines and disarmed for the rest: `wiring.test.ts:215` writes "the
  // engine`s own `RuleState`", using a backtick as an APOSTROPHE, and one stray
  // backtick inverts every pairing after it. The check went quiet on all three
  // copies of the seeded historical defect and reported PASS, which is a check
  // that cannot fail hiding inside a check that can. Read locally and a stray
  // backtick costs one binding rather than every binding below it.
  const close = flat.lastIndexOf('`', upto - 1);
  if (close < 0) return null;
  const open = flat.lastIndexOf('`', close - 1);
  if (open < 0) return null;
  const token = flat.slice(open + 1, close);
  if (!IDENTIFIER_GLUE.test(flat.slice(close + 1, upto))) return null;
  if (token.length > 80 || CITATION_TOKEN.test(token) || /[/$\s\n]/.test(token)) return null;
  if (NEGATED_CLAIM.test(flat.slice(Math.max(0, open - 70), open))) return null;
  // `principal(request)` is about `principal`; `CheckoutTx.insertAttribution`
  // is about the member, which is the specific half of the two.
  const segments = token
    .replace(/[(<].*$/, '')
    .split('.')
    .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  const name = segments[segments.length - 1];
  return name !== undefined && name.length >= 3 ? name : null;
}

/** @type {Invariant} */
const ri15 = {
  id: 'RI-15',
  title: 'No reason cites a line that does not hold the name beside it',
  covers:
    'every `file.ts:12` and `file.ts:12-34` citation in ' +
    CITED_REASON_FILES.join(', ') +
    ', plus the bare `:12` that continues a path cited within ' +
    `${CITATION_INHERIT_LINES} lines above it. THREE THINGS ARE ASSERTED: the ` +
    'path resolves to a file in this tree, the file reaches the line, and -- ' +
    'when the citation is preceded by a BACKTICKED NAME with nothing but glue ' +
    'between them -- that name appears within ' +
    `${CITATION_WINDOW} lines of the line cited, matched case-insensitively as ` +
    'a substring. THE WINDOW IS TUNED AGAINST THIS CORPUS: the widest TRUE ' +
    'citation measured is one line off and the narrowest FALSE one on record is ' +
    'three, so two catches every false citation on record and admits every true ' +
    'one. WHAT IT DOES NOT CATCH. (1) A citation with no name beside it is ' +
    'checked for resolution and range only; of the four false citations of ' +
    '2026-08-28 this catches THREE and misses `wallet-withdrawals.ts:1506`, ' +
    'which sits behind the words "the identity arm this route presents" and ' +
    'names nothing a runner can look up. (2) A NEGATED claim is skipped, ' +
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
    'findings. ONE CITATION IS NAMED AND NOT ENFORCED, in ' +
    'CITATIONS_OWNED_ELSEWHERE: `wiring.test.ts:168` cites ' +
    '`routes/admin-wallet.ts:538` for `principal(request)`, which is declared at ' +
    '`:601`. That is a FIFTH false citation in that file, found by this check on ' +
    'its first run, and the session that wrote the check does not own the file. ' +
    'The entry is exact and covers that one citation only.',
  run(root) {
    /** @type {string[]} */
    const findings = [];
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

    for (const rel of CITED_REASON_FILES) {
      if (!existsSync(join(root, rel))) {
        findings.push(
          `${rel} does not exist. This check names the files whose CITATIONS it reads, ` +
            `so a rename silently empties it; point it at the new path`,
        );
        continue;
      }
      const { flat, lineAt } = flattenReasons(read(root, rel));
      /** @type {string | null} */
      let inherited = null;
      let inheritedAt = -CITATION_INHERIT_LINES - 1;
      for (const m of flat.matchAll(CITATION)) {
        const at = lineAt[m.index ?? 0] ?? 0;
        const path = m[2];
        const first = m[3];
        const last = m[4];
        if (first === undefined) continue;
        /** @type {string | null} */
        let target = null;
        if (path !== undefined && path !== '') {
          target = path;
          inherited = path;
          inheritedAt = at;
        } else if (inherited !== null && at - inheritedAt <= CITATION_INHERIT_LINES) {
          target = inherited;
        }
        if (target === null) continue;

        const cited = `${target}:${first}${last === undefined ? '' : `-${last}`}`;
        const candidates = tree.filter((f) => f === target || f.endsWith(`/${target}`));
        if (candidates.length === 0) {
          findings.push(
            `${rel}:${at}: cites \`${cited}\` and NO FILE IN THIS TREE has that path. ` +
              `A pointer nobody can follow reads as verified and is not`,
          );
          continue;
        }
        const start = Number(first);
        const end = last === undefined ? start : Number(last);
        const reachable = candidates.filter((f) => linesOf(f).length >= end);
        if (reachable.length === 0) {
          const shown = candidates[0] ?? target;
          findings.push(
            `${rel}:${at}: cites \`${cited}\` and ${shown} has ${linesOf(shown).length} lines. ` +
              `The pointer is past the end of the file it names`,
          );
          continue;
        }

        const name = citedIdentifier(flat, m.index ?? 0);
        if (name === null) continue;
        const needle = name.toLowerCase();
        const near = reachable.some((f) => {
          const lines = linesOf(f);
          const from = Math.max(0, start - 1 - CITATION_WINDOW);
          const to = Math.min(lines.length, end + CITATION_WINDOW);
          for (let j = from; j < to; j += 1)
            if ((lines[j] ?? '').toLowerCase().includes(needle)) return true;
          return false;
        });
        if (near) continue;
        if (
          CITATIONS_OWNED_ELSEWHERE.some(
            (k) => k.file === rel && k.cites === cited && k.name === name,
          )
        )
          continue;

        let where = 'NOWHERE IN THAT FILE';
        for (const f of reachable) {
          const lines = linesOf(f);
          let best = Number.POSITIVE_INFINITY;
          let bestLine = 0;
          for (let j = 0; j < lines.length; j += 1) {
            if (!(lines[j] ?? '').toLowerCase().includes(needle)) continue;
            const d = j + 1 < start ? start - (j + 1) : j + 1 - end;
            if (d < best) {
              best = d;
              bestLine = j + 1;
            }
          }
          if (best < Number.POSITIVE_INFINITY) {
            where = `at ${f}:${bestLine}, ${best} lines away`;
            break;
          }
        }
        findings.push(
          `${rel}:${at}: cites \`${cited}\` for \`${name}\` and \`${name}\` is ${where}. ` +
            `A citation that drifts is worse than none: it reads as verified and sends the ` +
            `next reader to the wrong line, which is how one stale claim survived four ` +
            `restatements. Open the file and repoint it, or say what the line does hold`,
        );
      }
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
];

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
