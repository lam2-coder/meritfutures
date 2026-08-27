// =============================================================================
// packages/tooling/checks/ui-server-endpoints.mjs
// =============================================================================
// RI-11. THE TWO WAYS A UI DEPLOYABLE SERVES A PATH WITHOUT ANY FILE SPELLING
// ONE, WHICH IS EXACTLY WHAT RI-09 SAYS IT CANNOT SEE.
//
// ADR-095 ruling 3: "No Next.js route handler and NO SERVER ACTION may serve
// `/api/v1`, any operator path, or any surface API_CONTRACT specifies."
//
// ADR-098 built `RI-09` and closed the ROUTE HANDLER half, by path. Its own
// `covers` line opens its list of blind spots with the other half: "It reads
// PATHS, so a route reached by a catch-all segment, a REWRITE, a middleware or
// a hand-written router table declares nothing this check can find; the
// spelling is the convention a filesystem-routing framework makes load-bearing
// and not the only way to serve a path."
//
// Until 2026-08-27 that half was UNREACHABLE, because there was no `app/`
// directory in this repository and no `next.config` anywhere in it. Session 250
// created both. ADR-138 is the ruling and this file is the mechanism.
//
// -----------------------------------------------------------------------------
// WHY A SERVER ACTION IS REFUSED OUTRIGHT RATHER THAN REFUSED ON ITS PATH
// -----------------------------------------------------------------------------
// A SERVER ACTION HAS NO PATH. Next.js posts it to the URL of whatever route
// the caller is already on, carrying a build-time hash in a `Next-Action`
// header, and dispatches on the hash. So the question RI-09 asks of a route
// handler -- "does this path spell the operator surface" -- has no answer for an
// action, in either direction: the endpoint is real, it accepts a request body,
// it runs on the server with the deployable's own credentials, and no path
// anywhere describes it.
//
// That leaves exactly one checkable question, which is whether one EXISTS, and
// it is why this refusal is total rather than scoped to the operator surface.
// ADR-138 section 3 takes that ruling. ADR-095 ruling 4's single carve-out does
// not reach it: that carve-out is a cache-control ROUTE HANDLER on `apps/site`,
// on M09's four named conditions, and a route handler is a path RI-09 can read.
//
// -----------------------------------------------------------------------------
// WHY A CHECK AND NOT A LINT RULE, WHICH IS A DIFFERENT ANSWER TO RI-09's
// -----------------------------------------------------------------------------
// RI-07 and RI-09 both answer "the defect is a PATH and not a line". Shape A
// here is genuinely a line, and ESLint could read it, so the reason is measured
// rather than inherited: `eslint.config.js` attaches every `merit/*` rule to
// `apps/**/*.ts` and `packages/**/*.ts`, and A SERVER ACTION IN THE APP ROUTER
// IS ORDINARILY `.tsx`. Session 250 measured that on the tree: with a seeded
// action exporting `approvePayout` under `apps/portal/src/app/`, `pnpm run lint`
// exited 0, `tsc --noEmit` exited 0, `repo-invariants.mjs` reported 10 of 10 and
// `gates.mjs check` reported the same single CI-07 finding it reports without
// the seed. ADR-138 section 6 carries the glob as owed to the slice holding
// `eslint.config.js`, and this check does not wait on it: a control that exists
// today beats a wider one somebody else has to write first.
//
// Shape B is a path in a manifest and is nobody's lint rule.
//
// -----------------------------------------------------------------------------
// THE SURFACE VOCABULARY IS READ, NEVER COPIED
// -----------------------------------------------------------------------------
// `apiSurfaceVocabulary` is imported from `repo-invariants.mjs`, which parses
// `BASE_PATH` and `OPERATOR_PREFIXES` out of `apps/api/src/surface.ts`. RI-09's
// header states why: "A second copy of `['/admin', '/internal']` in this file
// would drift the day the contract grows a third operator prefix, and it would
// drift SILENTLY, which is the whole failure mode this check exists inside."
// One list, read twice, is the fix.
//
// THAT IMPORT IS A CYCLE AND IT IS DELIBERATE. `repo-invariants.mjs` imports
// `ri11` from this file for its `CHECKS` array and this file imports two
// bindings back. Nothing here dereferences either binding at module-evaluation
// time -- both are used inside `run` alone -- so the cycle links and never
// deadlocks. A title computed from `DEPLOYABLES` at the top level, which is what
// RI-04 and RI-09 do, would NOT be safe here, and that is why this one is
// written out.
// =============================================================================

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DEPLOYABLES, apiSurfaceVocabulary } from './repo-invariants.mjs';

/**
 * The directive, assembled rather than written.
 *
 * RI-05's `needle` idiom and for its stated reason: this file is under
 * `packages/`, so this check READS ITSELF, and a source that spells its own
 * needle reports itself. The prose above is safe by a different property --
 * every occurrence there is inside a comment, and the pattern below demands a
 * whole line that is nothing but a quoted directive -- but the pattern itself
 * could only be written this way.
 */
const DIRECTIVE = ['use', 'server'].join(' ');

/**
 * A directive prologue entry, which is the only form the framework accepts.
 *
 * ANCHORED TO A WHOLE LINE, on both ends. A directive is an expression
 * statement made of one string literal, at the top of a module or at the top of
 * a function body, and anything else with those two words in it is prose. That
 * is what keeps `// a 'use server' directive` in a comment from being a
 * finding, and it is why this reads raw source rather than stripping comments
 * first: the anchor does the work a stripper would.
 *
 * IT IS DELIBERATELY LOOSER THAN THE SPEC IN ONE DIRECTION. The spec puts the
 * directive at the TOP of a body; this pattern accepts it on any line. A
 * misplaced directive is inert in the framework and is still somebody reaching
 * for one, so catching more is the safe error.
 */
const SERVER_ACTION_DIRECTIVE = new RegExp(`^[ \\t]*(['"])${DIRECTIVE}\\1[ \\t]*;?[ \\t]*$`, 'm');

/** Every string literal in a source file, single or double quoted, unescaped. */
const STRING_LITERAL = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** Extensions a bundler in this workspace compiles. */
const COMPILED = new Set(['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs']);

/** Directories that hold output rather than source. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/**
 * A framework routing configuration file, which decides what URLs a deployable
 * answers without any file being named for one.
 *
 * BOTH SPELLINGS THE ADMITTED FRAMEWORK READS, and no guess at another one.
 * `next.config.*` carries `rewrites`, `redirects` and `basePath`; middleware
 * runs before the file system is consulted and may rewrite to anywhere. Next.js
 * looks for middleware at the project root and under `src/`, so both are here.
 * A framework this workspace has not admitted is a new entry, exactly as
 * RI-09's `ROUTING_ROOTS` says of its own list.
 */
const ROUTING_CONFIG = /^(?:src\/)?(?:next\.config|middleware)\.[cm]?[jt]sx?$/;

/**
 * Every file under `rel`, repo-relative, skipping output directories.
 *
 * @param {string} root
 * @param {string} rel
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(root, rel, out = []) {
  for (const entry of readdirSync(join(root, rel)).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const child = `${rel}/${entry}`;
    if (statSync(join(root, child)).isDirectory()) walk(root, child, out);
    else out.push(child);
  }
  return out;
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

/**
 * RI-11.
 *
 * @type {import('./repo-invariants.mjs').Invariant}
 */
export const ri11 = {
  id: 'RI-11',
  title:
    'No package declares a Server Action, and no framework routing config spells the API surface',
  covers:
    'TWO SHAPES, over every file under apps/ and packages/ that a bundler ' +
    'compiles (.ts, .tsx, .mts, .js, .jsx, .mjs, .cjs). (A) THE SERVER ACTION ' +
    'DIRECTIVE, refused in every package with NO exemption, including apps/api ' +
    'which owns the API surface and including test files. The refusal is total ' +
    'rather than scoped to the operator surface because a Server Action has no ' +
    'path: the framework dispatches it on a build-time hash carried in a ' +
    'header, so "which path does this serve" has no answer and only "does one ' +
    'exist" is checkable (ADR-138 section 3). (B) A FRAMEWORK ROUTING CONFIG -- ' +
    'next.config.* or middleware.*, at a deployable root or under its src/ -- ' +
    'carrying a string literal that spells the API base path anywhere in it, or ' +
    'that begins with an operator prefix, both read out of apps/api/src/' +
    'surface.ts rather than copied here. FOUR THINGS IT DOES NOT SEE. (1) It ' +
    'reads DIRECTIVES and STRING LITERALS in source: a rewrite whose source is ' +
    'assembled from a variable at runtime, a directive produced by a build ' +
    'step, or a hand-written router table declares nothing this check can ' +
    "find. (2) The routing-config names are the admitted framework's " +
    "(ADR-095 ruling 1) and another framework's config is a new entry here. " +
    '(3) It is NOT the path half: a route handler whose directory spells the ' +
    'operator surface is RI-09, and this check is deliberately silent about it ' +
    'so one defect is never reported twice. (4) It says nothing about a server ' +
    'component importing packages/db, which is ADR-095 section 9 item 5 and is ' +
    'an import rather than an endpoint.',
  /**
   * @param {string} root
   * @returns {string[]}
   */
  run(root) {
    /** @type {string[]} */
    const findings = [];

    // Rule 2. The vocabulary must be readable or this check cannot run, and
    // `apiSurfaceVocabulary` throws rather than returning an empty set.
    const { rel: surfaceRel, baseSegments, operatorSegments } = apiSurfaceVocabulary(root);
    const basePath = `/${baseSegments.join('/')}`;
    const operators = new Set(operatorSegments);

    if (DEPLOYABLES.length === 0)
      throw new Error('DEPLOYABLES is empty, so RI-11 would read no deployable; it cannot run');

    let inspected = 0;
    for (const area of ['apps', 'packages']) {
      if (!existsSync(join(root, area))) continue;
      for (const entry of readdirSync(join(root, area)).sort()) {
        const pkgDir = `${area}/${entry}`;
        if (!statSync(join(root, pkgDir)).isDirectory()) continue;

        for (const file of walk(root, pkgDir)) {
          const dot = file.lastIndexOf('.');
          if (dot === -1 || !COMPILED.has(file.slice(dot))) continue;
          inspected++;
          const source = readFileSync(join(root, file), 'utf8');

          // -------------------------------------------------------------------
          // Shape A. The directive.
          // -------------------------------------------------------------------
          if (SERVER_ACTION_DIRECTIVE.test(source)) {
            findings.push(
              `${file} carries the Server Action directive. ADR-095 ruling 3 refuses one ` +
                `serving \`${basePath}\`, an operator path or any surface API_CONTRACT ` +
                'specifies, and ADR-138 section 3 makes that refusal TOTAL because an action ' +
                'has no path to check: the framework dispatches it on a build-time hash in a ' +
                "header, so the endpoint is real, runs with this deployable's credentials, " +
                'and nothing in the tree describes what it answers. API_CONTRACT section 1 ' +
                'gives the UI "no privileged back door" and ADR-083 section 3 makes a surface ' +
                'that contains the API one by construction',
            );
          }

          // -------------------------------------------------------------------
          // Shape B. The routing config.
          // -------------------------------------------------------------------
          const inPackage = file.slice(pkgDir.length + 1);
          if (!ROUTING_CONFIG.test(inPackage)) continue;

          for (const [, , literal] of source.matchAll(STRING_LITERAL)) {
            if (literal === undefined || !literal.includes('/')) continue;
            const segments = literal.split('/').filter(Boolean);

            if (indexOfRun(segments, baseSegments) !== -1) {
              findings.push(
                `${file} spells \`${basePath}\` in the string \`${literal}\`. A routing ` +
                  'config decides what URLs this deployable answers BEFORE the file system is ' +
                  'consulted, so a rewrite, a redirect or a `basePath` puts the API surface on ' +
                  'this origin with no file anywhere spelling it, which is the first blind ' +
                  `spot RI-09's own \`covers\` names. ADR-083 ruling 1: the API is its own ` +
                  `deployable (${surfaceRel} is the vocabulary this reads)`,
              );
              continue;
            }

            if (
              literal.startsWith('/') &&
              segments[0] !== undefined &&
              operators.has(segments[0])
            ) {
              findings.push(
                `${file} spells the operator prefix \`/${segments[0]}\` in the string ` +
                  `\`${literal}\`. API_CONTRACT section 12 requires 404 for the operator ` +
                  'surface from the public origin and ADR-083 section 4 makes that 404 the ' +
                  `ROUTER's: apps/api registers nothing there in the public deployment, and a ` +
                  'routing config on another deployable can neither be kept out of that route ' +
                  `set nor be seen by a check that reads paths (${surfaceRel})`,
              );
            }
          }
        }
      }
    }

    // Rule 2 again, one level down. A broken walk reports a clean workspace in
    // exactly the same words a clean workspace does.
    if (inspected === 0)
      throw new Error(
        'RI-11 inspected 0 compiled file(s) under apps/ and packages/, so a green result would ' +
          'mean the walk stopped rather than that the workspace declares no server endpoint',
      );

    return findings;
  },
};
