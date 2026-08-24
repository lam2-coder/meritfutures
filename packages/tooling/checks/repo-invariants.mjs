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

export const CHECKS = [ri01, ri02, ri03, ri04, ri05, ri06, ri07];

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
