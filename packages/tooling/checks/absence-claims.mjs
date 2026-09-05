// =============================================================================
// packages/tooling/checks/absence-claims.mjs
// =============================================================================
// RI-35. A shipped sentence that says something DOES NOT EXIST is bound to the
// artifact it names, and the artifact is asserted still absent.
//
// -----------------------------------------------------------------------------
// THE DEFECT, WITH ITS RECORD
// -----------------------------------------------------------------------------
// A comment or a served refusal asserts an absence: a migration not written, a
// table unregistered, a column undeclared, a schema not installed. Later a row
// lands it. THE SENTENCE IS NOW FALSE AND NOTHING GOES RED, because nothing
// binds the prose to the tree. The next session reads it to decide what to
// build and is sent to do work already done.
//
// Four occurrences are on record and each was repaired BY HAND:
//
//   1. `apps/api/src/routes/affiliate.ts`, four clauses of the message
//      `GET /affiliate/stats` serves. Falsified by `0078`. Repaired by ADR-324.
//   2. `apps/worker/src/index.ts`, "the job store is still not installed".
//      Falsified by `0079`. Repaired by ADR-326.
//   3. `packages/queue/src/pg-boss-queue.ts`, "THAT MIGRATION DOES NOT EXIST
//      YET". Falsified by the same `0079`. Repaired by ADR-327, one row later.
//   4. `scripts/db/probe_pgboss_job_store.sql`, "`0079` deliberately grants
//      nothing". Falsified by `0082`. Repaired by ADR-327.
//
// ADR-324 stated the rule the repairs share: A TEST THAT PINS PROSE GOES STALE
// IN SILENCE AND A TEST THAT DERIVES GOES RED. Three rows then each hand-built
// ONE derivation for ONE site. Occurrence 3 is the proof that does not scale:
// ADR-326 repaired the barrel and left an identical sentence one package away,
// because nothing bound the second site to the migration that had falsified it.
// This check is the binding, written once, for every site at once.
//
// -----------------------------------------------------------------------------
// WHY A REGISTER AND NOT A GREP, WHICH IS THE FIRST THING TO TRY AND IS WRONG
// -----------------------------------------------------------------------------
// A check that fails on every "does not exist yet" in the tree fails on more
// than twenty sites TODAY and most of them are TRUE: an adapter nobody has
// written, a rail nobody has bought, a resolver that is genuinely absent. A
// gate satisfied by deleting honest prose is a gate somebody deletes. And a
// check that tries to PARSE which sentences it can decide misses the ones it
// cannot, silently, which is the defect one layer down.
//
// So each claim is written down with the artifact it names, and the check
// asserts the artifact rather than the sentence. THE REGISTERS BELOW ARE
// WRITTEN AND NEVER COMPUTED, which is `CI-06/gate-inventory`'s own rule for
// its probe table and its unprobeable register, and the reason is the same: a
// register a session can regenerate is a register nobody decided.
//
// -----------------------------------------------------------------------------
// WHY THE REGISTER LIVES HERE AND NOT IN A DOCUMENT
// -----------------------------------------------------------------------------
// This estate keeps registers in two places and the split is by CONTENT. A
// register of NUMBERS lives in `docs/decisions/ALLOCATION.md`, where `RI-29`
// reads it, because a number is claimed by prose and spent by prose. A register
// carrying PROBES lives in the file that runs them: `CI-06/gate-inventory`'s
// `INVENTORY_PROBES` and `UNPROBEABLE_ARTIFACTS` and `CI-06/vg-inventory`'s
// `VG_UNPROBEABLE` are all `Map`s inside `scripts/corpus/gates.mjs`. An entry
// here carries an executable probe, so it belongs with the runner.
//
// IT IS ITS OWN FILE ON `RI-11`'s AND `RI-18`'s PRECEDENT (ADR-138): a check
// whose ruling needs pages of argument reads better beside its own mechanism
// than wedged between two neighbours in an 8,000-line file. THE DEPENDENCY RUNS
// ONE WAY, which `RI-18`'s header says `RI-11`'s does not: nothing here imports
// `repo-invariants.mjs`, so the `CHECKS` literal at the foot of that file can
// import this one in any order without a `ReferenceError`.
//
// **THIS PARAGRAPH READ "NO COMMENT STRIPPER IS WRITTEN OR IMPORTED. `RI-30`
// bans a second one, and this check would be wrong with one anyway: the claims
// it reads LIVE IN COMMENTS, so a stripped file is a file with the subject
// removed", AND ADR-338 FOUND THE HALF THAT IS WRONG.** It is kept beside its
// correction rather than deleted, per `RI-14`.
//
// **NONE IS WRITTEN, WHICH IS `RI-30`'s ACTUAL RULE, AND THE SHARED ONE IS NOW
// IMPORTED.** `RI-30` bans a second STRIPPER and requires that every file which
// parses source import the one in `strip-comments.mjs`; this file parses source
// in two of its probes, so it was on the wrong side of that rule rather than
// exempt from it.
//
// **THE SENTENCE'S REASON IS TRUE OF CLAIM LOOKUP AND FALSE OF A PROBE, AND THE
// DIFFERENCE WAS MEASURED RATHER THAN ARGUED.** Claim lookup still reads RAW
// text and must: a claim is a quoted line of a comment. But the two CALLER
// probes hunt a call shape in code, and unstripped they find the shape inside
// prose. ADR-338 seeded exactly that: `queue-adapter.ts`'s own header names
// `workerQueue(` in order to explain what it does NOT do, the door-caller probe
// counted the mention, and with the wiring DELETED BY HAND the probe still
// reported `present` and `RI-35` still passed. **An absence check that goes
// green over an emptied file is `strip-comments.mjs`'s own worst direction**,
// and it had arrived inside the check written to prevent it.
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { stripComments } from './strip-comments.mjs';

/**
 * What a probe reports about the artifact a claim names.
 *
 * Two values and no third. A probe that cannot reach its inputs THROWS, which
 * is the runner's header rule 2: a check that cannot run is not a check that
 * passed, so an unreadable input is an ERROR and never an `'absent'`.
 *
 * @typedef {'present' | 'absent'} Presence
 */

/**
 * One artifact a claim can name.
 *
 * `needles` drives the sweep in leg 6 and MAY be empty. An artifact registered
 * with no needle is bound to the sites the register names and to no others, and
 * the `sweptBy` field says why in words a reader can argue with.
 *
 * @typedef {object} Artifact
 * @property {string} key
 * @property {string} names        what the artifact IS, in one sentence
 * @property {RegExp[]} needles    line patterns that name this artifact
 * @property {string} sweptBy      why those needles, or why none
 * @property {(root: string) => Presence} probe
 */

/**
 * One absence claim, at one site, in one line.
 *
 * `claim` is a VERBATIM substring of a single line of `site`. Single-line on
 * purpose: a multi-line anchor breaks the first time prettier reflows a comment
 * and would make leg 1 fire on formatting rather than on drift.
 *
 * `disposition` is the whole of the ruling this register makes:
 *
 *   `live`    the sentence asserts an absence TODAY, so the artifact must be
 *             ABSENT. The day somebody lands it the check goes red AT THE
 *             SENTENCE THAT IS NOW LYING. This is the leg that FAILS ON GOOD
 *             NEWS, which `CI-06/gate-inventory` says is the assertion an
 *             implementer is most likely to leave out.
 *   `retired`  the sentence is quoted as HISTORY, kept beside its correction
 *             under `RI-14`, so the artifact must be PRESENT. An absent one
 *             means a true sentence was retired, which is the same defect
 *             running backwards.
 *
 * An entry with `unbindable` names no artifact and carries a reason instead, on
 * `CI-06/gate-inventory`'s precedent for a condition no probe over the tree can
 * report.
 *
 * @typedef {object} Claim
 * @property {string} site
 * @property {string} claim
 * @property {'live' | 'retired'} [disposition]
 * @property {string} [artifact]
 * @property {string} [unbindable]
 * @property {string} why           why this site says what it says
 */

// -----------------------------------------------------------------------------
// The probes' shared readers
// -----------------------------------------------------------------------------

/** Where the migration set lives, which three of the four occurrences named. */
const MIGRATIONS_DIR = 'packages/db/migrations';

/** Directories the walk never enters. `repo-invariants.mjs` skips the same set. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** The extensions the sweep reads in the shipped scope, and the import probes with it. */
const SWEPT = /\.(ts|tsx|mts|mjs|js)$/;

/**
 * The second sweep scope, added by ADR-330.
 *
 * ADR-328's OWN APPROVAL BLOCK NAMED THIS AS THE CHANGE THAT WOULD MOST IMPROVE
 * THE CHECK, and it was right one row later: occurrence 4 lived under
 * `scripts/db/` and had to be registered BY HAND because leg 6 could not see it,
 * and ADR-329 finding 6 then found the SEVENTH occurrence at
 * `scripts/corpus/data-model-columns.mjs`, in the directory the sweep does not
 * read. A sweep that stops at the shipped tree is a sweep whose blind spot is a
 * directory somebody can name.
 *
 * WHY THE WHOLE DIRECTORY AND NOT `corpus/` PLUS `db/`. Measured at the moment
 * this line was written: the swept part of `scripts/` is 50 files and 33,992
 * lines -- 9 files and 16,364 lines under `corpus/`, 27 and 11,800 under `db/`,
 * 14 and 5,828 everywhere else -- against a shipped scope of 338 files and
 * 150,916 lines. Restricting it to the two subdirectories that have produced an
 * occurrence would save 14 files and 5,828 lines and would surface NOTHING:
 * `scripts/ci` and `scripts/demo` produce ZERO findings today. A written list of
 * subdirectories is a register somebody has to keep, which is the cost ADR-329
 * section 7 refused for its generated-column admission; a whole directory is a
 * rule nobody has to maintain.
 */
const SCRIPTS_DIR = 'scripts';

/**
 * What the sweep reads under `scripts/`: the same family, PLUS `.sql`.
 *
 * `.sql` IS IN, AND THE REASON IS THAT LEAVING IT OUT WOULD BE HALF A REPAIR.
 * Occurrence 4 lived in `scripts/db/probe_pgboss_job_store.sql`. Widening the
 * scope to the directory that occurrence lived in and then excluding the FILE
 * SHAPE it lived in reproduces the blind spot at one level down.
 *
 * THE LEXER OBJECTION IS REAL AND DOES NOT APPLY TO THIS SWEEP, which is worth
 * saying plainly rather than waving away. A `.sql` comment opens `--` and a
 * JavaScript one opens `//`, and a parser that had to tell a comment from a
 * string literal would need a second lexer for the second shape. THIS SWEEP
 * PARSES NOTHING. It is a per-line regular-expression scan over raw text, in
 * both shapes, and this file's header says why it can never strip comments: the
 * claims it reads LIVE IN COMMENTS. So `.sql` costs one alternative in this
 * character class and no reader at all, and `RI-30`'s single stripper in
 * `packages/tooling` is not imported here for the reason that header already
 * gives rather than for a new one.
 *
 * WHAT IT COSTS IS STATED RATHER THAN HIDDEN, AND IT IS ONE LINE. Measured over
 * the 23 `.sql` files at the moment this line was written: 26 carry a word from
 * the absence vocabulary and exactly ONE also carries a registered needle within
 * the window. It is `probe_pgboss_job_store.sql:72`, which quotes PostgreSQL's
 * own `relation "pgboss.version" does not exist`, and it is registered
 * `unbindable` below beside the reason. A raw scan cannot tell a quoted error
 * string from the file's own assertion IN EITHER SHAPE, which is why that entry
 * and one more like it are in the register rather than in a narrowed needle.
 */
const SWEPT_SCRIPTS = /\.(ts|tsx|mts|mjs|js|sql)$/;

/**
 * How far from an absence word the sweep looks for the artifact's name.
 *
 * TWO, AND THE NUMBER WAS MEASURED RATHER THAN CHOSEN. Comment prose in this
 * repository wraps near column 78, so a sentence naming an artifact and
 * asserting its absence routinely spans two lines: occurrence 3 is exactly that
 * shape, with `pg-boss itself emits` on one line and `THAT MIGRATION DOES NOT
 * EXIST YET` on the next, and a line-scoped sweep MISSES IT. At 1 the sweep
 * also misses `apps/worker/src/schedule.ts`'s provisioning row, whose needle
 * sits two lines below its absence word. At 3 it starts reaching
 * `packages/queue/src/pg-boss-queue.ts:36`, which says a boot-time install
 * would land "with no review and no migration number" -- a sentence about a
 * refused alternative that asserts no absence at all, and therefore a false
 * positive. Two is where the last true site arrives and the first false one has
 * not.
 */
const SWEEP_WINDOW = 2;

/**
 * Every `.sql` file in the migration set, as `{ file, body }`.
 *
 * THROWS ON BOTH FAILURES A PROBE CAN HAVE HERE, and they are different facts.
 * A missing directory means this tree has no migration set, so a probe over it
 * measured nothing; a present but empty one means the same thing louder. Either
 * way `'absent'` would be a claim about a directory that was never read, which
 * is the shape this whole check exists to refuse.
 *
 * @param {string} root
 * @returns {{ file: string, body: string }[]}
 */
function migrations(root) {
  const dir = join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) {
    throw new Error(
      `RI-35 cannot run: ${MIGRATIONS_DIR} does not exist, and three of the four occurrences ` +
        'this check is written against named a migration. A probe that reported `absent` ' +
        'off a directory it could not read would hold every claim about a migration true ' +
        'forever',
    );
  }
  const files = readdirSync(dir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `RI-35 found no \`.sql\` file in ${MIGRATIONS_DIR}. Zero means the set moved or the ` +
        'extension test is wrong, and every migration probe below would report `absent` ' +
        'against an empty list',
    );
  }
  return files.map((file) => ({ file, body: readFileSync(join(dir, file), 'utf8') }));
}

/**
 * Every source file under `apps/*&#47;src` and `packages/*&#47;src`, repo-relative.
 *
 * This is the sweep's scope AND the scope the import probes read. IT EXCLUDES
 * `docs/` DELIBERATELY: a dated record quoting a sentence that has since gone
 * false is written out of citation grammar (ADR-212), and `RI-15` and `RI-16`
 * already exclude those directories for that reason. It excludes `test/` for a
 * narrower reason: a case that asserts a refusal quotes the refusal, so a test
 * carrying a claim string is the assertion and not a second claim site.
 *
 * @param {string} root
 * @returns {string[]}
 */
function shippedSources(root) {
  /** @type {string[]} */
  const out = [];
  for (const parent of ['apps', 'packages']) {
    const parentDir = join(root, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir).sort()) {
      const src = `${parent}/${entry}/src`;
      if (!existsSync(join(root, src))) continue;
      walk(root, src, out);
    }
  }
  return out.filter((rel) => SWEPT.test(rel));
}

/**
 * Every swept file under `scripts/`, repo-relative. ADR-330.
 *
 * IT EXCLUDES ANY DIRECTORY NAMED `test`, on `shippedSources`' own written
 * reason arriving in a directory whose layout does not supply it for free: a
 * case that asserts a refusal QUOTES the refusal, so a test carrying a claim
 * string is the assertion and not a second claim site. Under `apps/*&#47;src`
 * and `packages/*&#47;src` that exclusion is structural, because the suites sit
 * beside `src/` rather than inside it. Under `scripts/` it has to be written,
 * and `scripts/demo/test/` is the one directory it reaches today. MEASURED: the
 * four files there produce zero findings, so this is a rule stated ahead of the
 * case rather than an exemption bought to make a run green.
 *
 * A MISSING `scripts/` IS SKIPPED AND A PRESENT-BUT-UNREADABLE ONE THROWS, and
 * the split is the one `shippedSources` already makes when it skips an absent
 * `apps` or `packages`. A tree that declares no `scripts/` is a tree with one
 * fewer place to look; a `scripts/` that exists and yields nothing is the layout
 * having moved under the check, which is rule 2 and never a quiet zero.
 *
 * @param {string} root
 * @returns {string[]}
 */
function scriptSources(root) {
  if (!existsSync(join(root, SCRIPTS_DIR))) return [];
  /** @type {string[]} */
  const out = [];
  walk(root, SCRIPTS_DIR, out);
  const swept = out.filter(
    (rel) => SWEPT_SCRIPTS.test(rel) && !rel.split('/').slice(1, -1).includes('test'),
  );
  if (swept.length === 0) {
    throw new Error(
      `RI-35 found no swept file under ${SCRIPTS_DIR}/, which exists. Zero means the layout ` +
        'moved or the extension test is wrong, and leg 6 would sweep the shipped tree alone ' +
        'while reporting a clean run over the directory ADR-330 widened it to reach',
    );
  }
  return swept;
}

/**
 * The whole of leg 6's scope: the shipped tree AND `scripts/`.
 *
 * IT IS A SECOND FUNCTION AND NOT A WIDER `shippedSources`, DELIBERATELY. Three
 * probes read `shippedSources`, and `queue-door`'s register entry says in words
 * what it means: "a module under `apps/*&#47;src` or `packages/*&#47;src`,
 * outside `packages/queue` itself, that imports `@merit/queue`". Widening that
 * function in place would silently rewrite what three registered artifacts
 * ASSERT while appearing to change only where the sweep looks, which is a
 * change to eight live claims made by editing a file walk. The sweep widens and
 * the probes do not move.
 *
 * @param {string} root
 * @returns {string[]}
 */
function sweptSources(root) {
  return [...shippedSources(root), ...scriptSources(root)];
}

/**
 * Depth-first file walk, repo-relative.
 *
 * @param {string} root
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(root, dir, out) {
  for (const entry of readdirSync(join(root, dir))) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Whether any file in the shipped scope imports `specifier`.
 *
 * It reads the IMPORT and never the mention, which is the distinction the four
 * occurrences turn on: `apps/worker/src/index.ts` names `@merit/queue` in five
 * comments and imports it in none, and a probe that counted mentions would
 * report the door built.
 *
 * @param {string} root
 * @param {string} specifier
 * @param {(rel: string) => boolean} [exclude]  files that are the package itself
 * @returns {Presence}
 */
function importedAnywhere(root, specifier, exclude = () => false) {
  const files = shippedSources(root);
  if (files.length === 0) {
    throw new Error(
      'RI-35 found no source file under any `apps/*/src` or `packages/*/src`. Zero means ' +
        'the layout moved, and every import probe below would report `absent` against an ' +
        'empty walk',
    );
  }
  const pattern = new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*['"]${specifier.replace(/[/@]/g, '\\$&')}(?:/[^'"]*)?['"]`,
  );
  for (const rel of files) {
    if (exclude(rel)) continue;
    if (pattern.test(readFileSync(join(root, rel), 'utf8'))) return 'present';
  }
  return 'absent';
}

/**
 * Whether `manifest` declares `specifier` in any dependency field.
 *
 * A MISSING MANIFEST THROWS. "This package declares no dependency on X" and
 * "this package does not exist" are different facts and only one of them is
 * what the claim sites say.
 *
 * @param {string} root
 * @param {string} manifest
 * @param {string} specifier
 * @returns {Presence}
 */
function declaredIn(root, manifest, specifier) {
  const path = join(root, manifest);
  if (!existsSync(path)) {
    throw new Error(
      `RI-35 cannot run: ${manifest} does not exist, and a claim in this register says what ` +
        'that manifest declares. An absent manifest is not a manifest that declares nothing',
    );
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const deps = parsed[field];
    if (deps && Object.prototype.hasOwnProperty.call(deps, specifier)) return 'present';
  }
  return 'absent';
}

/**
 * Read one file that must exist, because a claim is about what is IN it.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
function requireFile(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    throw new Error(
      `RI-35 cannot run: ${rel} does not exist, and a probe in this register reads it. A ` +
        'probe that reported `absent` off a file it could not open would hold its claim ' +
        'true forever',
    );
  }
  return readFileSync(path, 'utf8');
}

// -----------------------------------------------------------------------------
// THE ARTIFACT REGISTER. Written, never computed.
// -----------------------------------------------------------------------------

/** @type {Artifact[]} */
export const ABSENCE_ARTIFACTS = [
  {
    key: 'queue-door',
    names:
      'a module under `apps/*/src` or `packages/*/src`, outside `packages/queue` itself, that ' +
      'imports `@merit/queue`. ADR-165s ONE DOOR per deployable, for the queue',
    needles: [/@merit\/queue/, /pgBossQueue/, /pgboss/i, /pg-boss/i],
    sweptBy:
      'the package specifier, the adapter factory name, and the schema name in both ' +
      'spellings. MEASURED at the moment this register was written: the four needles reach ' +
      'seven lines in the shipped scope and every one of them is a claim registered below. ' +
      'Widening them to `@merit/db` was tried and rejected in the same sitting: that ' +
      'needle reaches six lines about five different artifacts, which is a different rows ' +
      'fence and not a tighter gate',
    probe: (root) =>
      importedAnywhere(root, '@merit/queue', (rel) => rel.startsWith('packages/queue/')),
  },
  {
    key: 'api-queue-manifest',
    names: '`apps/api/package.json` declaring a dependency on `@merit/queue`',
    needles: [],
    sweptBy:
      'nothing, and the reason is that its sites are already swept. Both claim sites below ' +
      'carry `@merit/queue` on their own line, so `queue-door`s first needle reaches them ' +
      'and a second copy of it here would buy nothing',
    probe: (root) => declaredIn(root, 'apps/api/package.json', '@merit/queue'),
  },
  {
    key: 'db-queue-manifest',
    names: '`packages/db/package.json` declaring a dependency on `@merit/queue`',
    needles: [],
    sweptBy: 'nothing, for `api-queue-manifest`s reason: its one site carries the specifier',
    probe: (root) => declaredIn(root, 'packages/db/package.json', '@merit/queue'),
  },
  {
    key: 'provisioning-ports-workspace-import',
    names:
      'an import of `@merit/db`, `@merit/queue` or `@merit/rithmic` in ' +
      '`apps/worker/src/provisioning/ports.ts`, which the file says it has none of',
    needles: [],
    sweptBy: 'nothing, for `api-queue-manifest`s reason: its one site carries the specifier',
    probe: (root) => {
      const body = requireFile(root, 'apps/worker/src/provisioning/ports.ts');
      return /(?:from|import|require)\s*\(?\s*['"]@merit\/(?:db|queue|rithmic)(?:\/[^'"]*)?['"]/.test(
        body,
      )
        ? 'present'
        : 'absent';
    },
  },
  {
    key: 'worker-queue-manifest',
    names: '`apps/worker/package.json` declaring a dependency on `@merit/queue`',
    needles: [],
    sweptBy: 'nothing, for `api-queue-manifest`s reason: its one site carries the specifier',
    probe: (root) => declaredIn(root, 'apps/worker/package.json', '@merit/queue'),
  },
  {
    key: 'db-pool-sql-executor',
    names: '`packages/db` exporting `poolSqlExecutor`, the pool-shaped door ADR-332 published',
    needles: [],
    sweptBy:
      'nothing, for `api-queue-manifest`s reason: its one claim site carries the name on its ' +
      'own line and `queue-door`s needles do not reach it. **THIS IS THE ENTRY ADR-332 LEFT ' +
      'OWED AND NAMED IN `packages/queue/test/surface.test.ts`**, in the exact shape that file ' +
      'writes down: an artifact keyed on the export, with a `retired` claim anchored on the ' +
      'quotation the correction retires. That row could not take it, because the sentence it ' +
      'retired had never been registered and no marker in the vocabulary above reaches it, so ' +
      'the register could not be amended under its grant. ADR-333 is amending the register ' +
      'anyway (`queue-door` moved) and takes it here',
    probe: (root) => {
      // BOTH HALVES, BECAUSE A BARREL LINE ALONE IS NOT AN EXPORT. The name has
      // to be published by `packages/db`'s own entry point AND declared by the
      // module behind it; a re-export of something deleted does not compile, but
      // a probe reading one half would call the artifact present off whichever
      // half a partial revert happened to leave.
      const barrel = requireFile(root, 'packages/db/src/index.ts');
      const declared = requireFile(root, 'packages/db/src/scoped-db.ts');
      const republished = /^\s*poolSqlExecutor,\s*$/m.test(barrel);
      const exists = /^export function poolSqlExecutor\(/m.test(declared);
      return republished && exists ? 'present' : 'absent';
    },
  },
  {
    key: 'job-queue-failure-channel',
    names:
      'a channel on `JobQueue` by which a caller could observe a SUPERVISE FAILURE: a sixth ' +
      'method, or an emitter. ADR-006s five-method interface, ADR-331 section 10 item 3 and ' +
      'ADR-332 section 10 item 2',
    needles: [],
    sweptBy:
      'nothing, for `api-queue-manifest`s reason: both claim sites already sit inside ' +
      '`queue-door`s needle reach, so a second copy would buy nothing. AND A NEEDLE ON ' +
      '`supervisor` WAS TRIED AND REJECTED IN THE SAME SITTING: over the widened scope it ' +
      'reaches the `job-supervisor` reason word in `packages/db/src/scoped-db.ts` and in ' +
      '`apps/worker/src/db.ts`, which are statements about a VOCABULARY and not about this ' +
      'channel, so it would register noise, which is ADR-328s own rule against a needle that ' +
      'mostly names other things',
    probe: (root) => {
      // READ AT THE INTERFACE'S OWN DATA. `JOB_QUEUE_METHODS` is the list
      // `surface.test.ts` grades ADR-006's narrowness criterion against, and
      // `EveryJobQueueMethodIsListed` makes it total in the other direction, so
      // a sixth METHOD cannot arrive without appearing here.
      const body = requireFile(root, 'packages/queue/src/job-queue.ts');
      const start = body.indexOf('export const JOB_QUEUE_METHODS');
      const end = body.indexOf('] as const', start);
      if (start === -1 || end === -1) {
        throw new Error(
          'RI-35 cannot read `JOB_QUEUE_METHODS` out of packages/queue/src/job-queue.ts, so ' +
            'the failure-channel probe measured nothing. A probe that reported `absent` off a ' +
            'list it could not find would hold its claim true forever',
        );
      }
      const listed = [...body.slice(start, end).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
      if (listed.length === 0) {
        throw new Error(
          'RI-35 found `JOB_QUEUE_METHODS` declaring no method, which cannot be true of a ' +
            'shipped interface and would make every absence below unfalsifiable',
        );
      }
      const five = new Set(['declareQueue', 'enqueue', 'consume', 'start', 'stop']);
      const sixth = listed.some((name) => name !== undefined && !five.has(name));
      // AND AN EMITTER, WHICH WOULD BE A CHANNEL WITHOUT BEING A METHOD. That is
      // the shape pg-boss itself uses and the shape `pgBossQueue` declines to
      // forward, so it is the likeliest way this artifact arrives.
      const emitter = /EventEmitter|addListener|\bonError\b|\bonFailure\b/.test(body);
      return sixth || emitter ? 'present' : 'absent';
    },
  },
  {
    key: 'worker-queue-door-caller',
    names:
      'a caller of `apps/worker/src/queue.ts`s door under any `src/`, past the module that ' +
      'declares it. ADR-333 wrote the door and wired nothing',
    needles: [],
    sweptBy:
      'nothing, on `provisioning-saga-caller`s reason: the door`s two exported names reach ' +
      'three lines in the shipped scope and all three are its own declaration, so a needle on ' +
      'them would sweep the register that already binds them',
    probe: (root) => {
      const files = shippedSources(root);
      if (files.length === 0) {
        throw new Error(
          'RI-35 found no source file under any `apps/*/src` or `packages/*/src`, so the ' +
            'queue-door caller probe measured nothing',
        );
      }
      // THE DECLARING MODULE IS EXCLUDED AND NOTHING ELSE IS. `LIVE_QUEUE` is
      // declared there and `workerQueue(` is both declared and called there, so
      // a probe over the whole tree would report the door calling itself.
      // A CALL AND NEVER THE MENTION, on `provisioning-saga-caller`s instrument
      // and for ADR-165 section 9s recorded reason: `apps/worker/src/index.ts`
      // NAMES `LIVE_QUEUE` in order to say that nothing calls it, and a probe
      // counting the name would report the door wired off the sentence saying it
      // is not. So the shapes are a property access and a factory call, and the
      // declaring module is excluded because it is both.
      //
      // **A THIRD SHAPE WAS ADDED BY ADR-338 AND IT IS THE ONE THE WIRING
      // ACTUALLY TOOK, WHICH IS A FINDING AGAINST THIS PROBE RATHER THAN A
      // PREFERENCE.** The two shapes above see a door that is CALLED and miss a
      // door that is HANDED TO SOMETHING -- `provisioningJobQueue(LIVE_QUEUE)`,
      // which is `postgresBatchPorts(io.db)`s arrangement one capability over
      // and the likeliest way an adapter takes a door in this estate. Written as
      // it stood, this probe would have reported `absent` over the very row that
      // wired the saga`s queue port, holding a `live` claim true past its own
      // falsification, which is the defect RI-35 exists to prevent arriving
      // INSIDE RI-35. So an argument position counts: the name followed by `,`
      // or `)`.
      //
      // IT IS STILL A CALL AND NEVER THE MENTION. Every prose occurrence of the
      // name in this tree is backticked, so `LIVE_QUEUE` in a sentence is
      // followed by a backtick and matches none of the three; the three shapes
      // are `LIVE_QUEUE.`, `LIVE_QUEUE,`, `LIVE_QUEUE)` and `workerQueue(`.
      const door = 'apps/worker/src/queue.ts';
      for (const rel of files) {
        if (rel === door) continue;
        const called = stripComments(readFileSync(join(root, rel), 'utf8'))
          .split('\n')
          .some(
            (line) =>
              /\bLIVE_QUEUE\s*[.,)]/.test(line) ||
              (/\bworkerQueue\s*\(/.test(line) && !/function\s+workerQueue/.test(line)),
          );
        if (called) return 'present';
      }
      return 'absent';
    },
  },
  {
    key: 'provisioning-saga-caller',
    names: 'a caller of `runProvisioningSaga` under any `src/`, past its own barrel re-exports',
    needles: [],
    sweptBy:
      'nothing. The entry point`s name reaches four lines in the shipped scope and three of ' +
      'them are a declaration or a re-export, so a needle on it would sweep the register ' +
      'that already binds it',
    probe: (root) => {
      const files = shippedSources(root);
      if (files.length === 0) {
        throw new Error(
          'RI-35 found no source file under any `apps/*/src` or `packages/*/src`, so the ' +
            'caller probe measured nothing',
        );
      }
      // A CALL AND NEVER THE DECLARATION. `export async function
      // runProvisioningSaga(` is the entry point itself, and a probe counting it
      // would report every job in this deployable as already called.
      //
      // **AND NEVER THE MENTION EITHER, WHICH IS ADR-338's REPAIR AND NOT A
      // TIDY-UP.** This probe read RAW text, and the line directly above quotes
      // the very shape it hunts: `runProvisioningSaga(` appears in this comment,
      // and it appears in `schedule.ts`'s registry row and in three headers under
      // `apps/worker/src/`. It reported `absent` only because the guard on the
      // word `function` happened to catch the one form it met; a header writing
      // "nothing calls `runProvisioningSaga()`" would have flipped it to
      // `present` and retired a true claim. Stripped, it reads code.
      for (const rel of files) {
        const called = stripComments(readFileSync(join(root, rel), 'utf8'))
          .split('\n')
          .some(
            (line) =>
              /runProvisioningSaga\s*\(/.test(line) && !/function\s+runProvisioningSaga/.test(line),
          );
        if (called) return 'present';
      }
      return 'absent';
    },
  },
  {
    key: 'pgboss-job-store-migration',
    names: 'a migration installing pg-boss`s schema, which `0079_pgboss_job_store.sql` is',
    needles: [],
    sweptBy:
      'nothing of its own. `queue-door`s `pgboss` and `pg-boss` needles already reach every ' +
      'line in the shipped scope that names this migration, and a fifth needle spelling ' +
      '`CREATE SCHEMA` reaches none of them: the sentences say "the job store" and "that ' +
      'migration", never the DDL',
    probe: (root) =>
      migrations(root).some(({ body }) => /CREATE SCHEMA IF NOT EXISTS pgboss/i.test(body))
        ? 'present'
        : 'absent',
  },
  {
    key: 'pgboss-app-grant-migration',
    names:
      'a migration granting the application role `USAGE` on the `pgboss` schema, which ' +
      '`0082_pgboss_app_grants.sql` is',
    needles: [],
    sweptBy:
      'nothing. Its one registered site is a `.sql` file under `scripts/db/`, which is ' +
      'outside the swept scope by construction: the sweep reads the JavaScript-family ' +
      'source that ships, and a probe script is neither',
    probe: (root) =>
      migrations(root).some(({ body }) => /GRANT\s+USAGE\s+ON\s+SCHEMA\s+pgboss/i.test(body))
        ? 'present'
        : 'absent',
  },
  {
    key: 'affiliate-commissions-owner-column',
    names:
      'a migration giving `affiliate_commissions` its `affiliate_id` owner column, which ' +
      '`0078_affiliate_commission_owner.sql` is',
    needles: [],
    sweptBy:
      'nothing, and this one is a MEASUREMENT rather than an omission. The obvious needle, ' +
      '`affiliate_commissions`, reaches three lines in `packages/db/src/scope.ts` where a ' +
      'single line is a several-thousand-character `why` string holding a whole paragraph. ' +
      'Line-scoped proximity means nothing there: the marker and the needle land in ' +
      'sentences about different tables. The sweep would demand three registrations for ' +
      'prose that asserts no absence about this column, which is a gate satisfied by ' +
      'registering noise',
    probe: (root) =>
      migrations(root).some(({ body }) =>
        /ALTER TABLE[\s\S]{0,200}?affiliate_commissions[\s\S]{0,200}?ADD COLUMN\s+affiliate_id/i.test(
          body,
        ),
      )
        ? 'present'
        : 'absent',
  },
  {
    key: 'db-transaction-and-sql-executor',
    names:
      '`packages/db` exporting both a transaction runner and the `SqlExecutor` shape ' +
      '`packages/queue`s `JobTransaction` declares',
    needles: [],
    sweptBy:
      'nothing, MEASURED. `SqlExecutor` and `sqlExecutor` together reach one line in the ' +
      'shipped scope and it is a claim about a different artifact, the live-feed adapter; ' +
      '`@merit/db` and `packages/db` reach six lines about five artifacts. Neither is this ' +
      'artifacts sweep, and a needle that mostly names other things is a needle that ' +
      'registers noise',
    probe: (root) => {
      const barrel = requireFile(root, 'packages/db/src/index.ts');
      const runsATransaction = /^\s*transaction,\s*$/m.test(barrel);
      const yieldsAnExecutor = /^\s*type SqlExecutor,\s*$/m.test(barrel);
      return runsATransaction && yieldsAnExecutor ? 'present' : 'absent';
    },
  },
  {
    key: 'gates-importable',
    names:
      '`scripts/corpus/gates.mjs` being importable by a second reader: it exports its gate ' +
      'array AND guards its own invocation, so importing it does not run every gate and exit ' +
      'the process',
    needles: [/direct-invocation guard/i, /process\.exit\(main\(\)\)/],
    sweptBy:
      'the two phrasings that NAME THE ARTIFACT rather than the file, and the distinction is ' +
      'the measurement. `gates.mjs` reaches 84 lines over the widened scope, 32 of them in ' +
      '`falsify.mjs` alone, about the runner in general; ADR-328s own rule is that a needle ' +
      'which mostly names other things is a needle that registers noise, and it was measured ' +
      'reaching one further line, `falsify.mjs:3217`s expectation string `and no file ' +
      'provides it`, which asserts nothing about this tree. The two kept here name the guard ' +
      'and the unguarded shape it replaced: together they reach TEN lines over the widened ' +
      'scope, of which the seventh occurrence is the only one carrying an absence word ' +
      'within the window',
    probe: (root) => {
      // BOTH HALVES, BECAUSE THE FALSE SENTENCE MADE TWO CLAIMS. It said the
      // module ends in `process.exit(main())` at module scope with no guard, and
      // the duplication it justified needs an EXPORT to be repaired as well as a
      // guard. A probe reading one half would call the artifact present off a
      // guard with nothing exported behind it.
      const body = requireFile(root, 'scripts/corpus/gates.mjs');
      const exportsItsGates = /^export const GATES\b/m.test(body);
      const guarded = /^\s*if \(invokedDirectly\) process\.exit\(main\(\)\);/m.test(body);
      return exportsItsGates && guarded ? 'present' : 'absent';
    },
  },
];

// -----------------------------------------------------------------------------
// THE ABSENCE VOCABULARY. Written, never computed.
// -----------------------------------------------------------------------------
// EVERY ENTRY IS TAKEN FROM A SENTENCE THAT ACTUALLY WENT FALSE, or from one
// standing in the tree today, rather than invented from how an absence could be
// phrased. That is the difference between a vocabulary and a wish list, and it
// is why the list is short.
//
// `undeclared in` carries its preposition because bare `undeclared` reaches
// "pg-boss REFUSES AN UNDECLARED QUEUE" in `packages/queue/src/job-queue.ts`,
// which asserts a vendor behaviour and no absence at all. `is not in` was
// drafted and cut for the same reason: it reaches "this is not in isolation" in
// `packages/db/src/client.ts`. Both were measured, not reasoned.

/** @type {RegExp[]} */
const ABSENCE_MARKERS = [
  /does not exist/i,
  /do not exist/i,
  /\bnot written\b/i,
  /\bnot installed\b/i,
  /\bUNREGISTERED\b/,
  /\bundeclared in\b/i,
  /\bno migration\b/i,
  /\bno such\b/i,
  /nothing[^.]{0,60}\bimports?\b/i,
  /\bno (module|file|adapter|importer|caller|door)\b/i,
  /\bdeclares no\b/i,
  /\bgrants nothing\b/i,
  /\bnot here\b/i,
  /\bunexercised\b/i,
  // ADR-330. The seventh occurrence's own words, and the first entry added to
  // this vocabulary since it was written. MEASURED over the widened scope at the
  // moment it was added: it reaches TWO lines. One is the seventh occurrence,
  // `scripts/corpus/data-model-columns.mjs`, and the other is
  // `apps/worker/src/live/ports.ts:39`, which says a type "cannot be imported
  // here whatever the" fence allows -- a TRUE sentence about a fence, carrying
  // no registered needle within the window, and therefore silent. Nothing about
  // it was rewritten to accommodate this marker.
  /\bcannot be imported\b/i,
];

// -----------------------------------------------------------------------------
// THE CLAIM REGISTER. Written, never computed.
// -----------------------------------------------------------------------------

/** @type {Claim[]} */
export const ABSENCE_CLAIMS = [
  // --- the queue's door, WRITTEN BY ADR-333, so all three moved together ----
  // **THIS IS LEG 2 FIRING ON GOOD NEWS AND IT IS WHAT THE LEG IS FOR.** All
  // three of these were `live` against `queue-door` for three rows: ADR-327 put
  // `@merit/queue` in `apps/worker`'s manifest and could not add an importer,
  // ADR-331 and ADR-332 each measured a blocker and each recorded that the
  // importer was a different row's. ADR-333 wrote `apps/worker/src/queue.ts`,
  // the probe flipped to `present`, and RI-35 went red AT ALL THREE SENTENCES
  // rather than at a count somebody would have had to notice. Each is repaired
  // beside its correction under `RI-14` and moved here to `retired`, in the same
  // commit, so a tree that lost the door again turns leg 3 red at the same lines.
  {
    site: 'apps/worker/src/index.ts',
    claim: 'declared and unexercised. The next row owes the ONE-DOOR module ... ADR-327',
    disposition: 'retired',
    artifact: 'queue-door',
    why: 'ADR-327 added the manifest line and could not add the importer; ADR-333 added it',
  },
  {
    site: 'apps/worker/src/index.ts',
    claim: 'THAT CLAUSE READ "no adapter over `pgBossQueue` exists yet because no module',
    disposition: 'retired',
    artifact: 'queue-door',
    why: 'ADR-333 falsified the clause`s stated REASON and left its conclusion standing',
  },
  {
    site: 'packages/queue/src/index.ts',
    claim: 'NO MODULE IN THIS WORKSPACE IMPORTS `@merit/queue`',
    disposition: 'retired',
    artifact: 'queue-door',
    why: 'the package published an interface and an adapter, and `apps/worker` has now taken it',
  },
  {
    site: 'packages/queue/src/index.ts',
    claim: 'THAT PARAGRAPH ENDED "That door is not published by `packages/db` and the',
    disposition: 'retired',
    artifact: 'db-pool-sql-executor',
    why: 'ADR-332 published `poolSqlExecutor` and left this register entry owed by name',
  },

  // --- live: the door exists, and what it deliberately does NOT reach -------
  {
    site: 'apps/worker/src/queue.ts',
    claim: '**1. `start()` IS THE SUPERVISOR, AND ITS FAILURES REACH NO CALLER OF',
    disposition: 'live',
    artifact: 'job-queue-failure-channel',
    why:
      'the door withholds `start` BECAUSE the failures have no channel; if one arrives the ' +
      'reason for withholding it is gone and this sentence has to be read again',
  },
  {
    site: 'packages/queue/src/index.ts',
    claim: 'manifest and not a grant this time: it is that a caller of `start()` cannot',
    disposition: 'live',
    artifact: 'job-queue-failure-channel',
    why: 'the package states its own limit, and it is the package that would repair it',
  },
  {
    site: 'apps/worker/src/index.ts',
    claim: '`enqueueProvisioningOp` calls it, and **no adapter over `LIVE_QUEUE` has a',
    disposition: 'retired',
    artifact: 'worker-queue-door-caller',
    why:
      'THE DAY CAME. This row read `live` and said "the day the saga is wired this goes red"; ' +
      'ADR-338 wrote `apps/worker/src/provisioning/queue-adapter.ts`, the probe flipped to ' +
      '`present`, and leg 2 went red at this sentence rather than at a count. The clause is kept ' +
      'whole under RI-14 with its correction beneath it, and this row now holds the correction ' +
      'to the tree: an adapter that went away again turns leg 3 red at the same line',
  },
  {
    site: 'apps/worker/src/queue.ts',
    claim: 'THIS PARAGRAPH READ "NOTHING HERE IS WIRED AND NOTHING IS SCHEDULED. No',
    disposition: 'retired',
    artifact: 'worker-queue-door-caller',
    why:
      'the door said of itself that nothing called it, one file away from the barrel that said ' +
      'the same thing, which is occurrence 3`s shape exactly. ADR-338 falsified both and both ' +
      'are registered, so neither can be retired without the other going red',
  },
  {
    site: 'apps/worker/src/schedule.ts',
    claim: 'THIS ITEM READ "THE ROLE THIS DEPLOYABLE CONNECTS AS CANNOT REACH THE',
    disposition: 'retired',
    artifact: 'pgboss-app-grant-migration',
    why:
      'A SITE THIS REGISTER HAD NEVER MET, found by ADR-338 while wiring the door rather than ' +
      'by a check. `0082` (ADR-327) falsified it on the day it merged and this file was not one ' +
      'of the four occurrences anybody repaired; the item`s CONCLUSION survives on its two ' +
      'neighbours, which is why nothing above it moved and only the reason is corrected',
  },
  {
    site: 'apps/api/src/routes/internal.ts',
    claim: '`apps/api` DECLARES NO `@merit/queue`. A job enqueue goes through that',
    disposition: 'live',
    artifact: 'api-queue-manifest',
    why: 'the internal route enqueues through a port rather than through the package',
  },
  {
    site: 'apps/api/src/routes/internal.ts',
    claim: "See this file's header: `apps/api` declares no `@merit/queue`, and the",
    disposition: 'live',
    artifact: 'api-queue-manifest',
    why: 'the same fact stated a second time in the same file, which is why both are bound',
  },
  {
    site: 'packages/db/src/scoped-db.ts',
    claim: 'declares no `@merit/queue` dependency and `packages/queue/package.json` states',
    disposition: 'live',
    artifact: 'db-queue-manifest',
    why: 'structural typing binds `SqlExecutor` to `JobTransaction` with no import either way',
  },
  {
    site: 'apps/worker/src/provisioning/ports.ts',
    claim: 'NOTHING HERE IMPORTS `@merit/db`, `@merit/queue` OR `@merit/rithmic`, AND THE',
    disposition: 'live',
    artifact: 'provisioning-ports-workspace-import',
    why: 'the ports file names its dependencies to say it has none',
  },

  {
    site: 'apps/worker/src/schedule.ts',
    claim:
      "'NO LIVE PORTS AND NO CALLER, and this is the one job whose wiring would ALSO need the '",
    disposition: 'live',
    artifact: 'provisioning-saga-caller',
    why: 'the register of jobs says why the provisioning saga is on no clock',
  },

  // --- retired: the four occurrences, kept as history under RI-14 ----------
  {
    site: 'apps/api/src/routes/affiliate.ts',
    claim: '`one COLUMN away` and `0078 ... is NOT WRITTEN`. NOTHING WENT RED, because',
    disposition: 'retired',
    artifact: 'affiliate-commissions-owner-column',
    why: 'OCCURRENCE 1. ADR-324 repaired it. The quote is legitimate only while `0078` exists',
  },
  {
    site: 'apps/worker/src/index.ts',
    claim: '**THIS PARAGRAPH READ "The job store is still not installed: pg-boss\'s schema',
    disposition: 'retired',
    artifact: 'pgboss-job-store-migration',
    why: 'OCCURRENCE 2. ADR-326 repaired it. The quote is legitimate only while `0079` exists',
  },
  {
    site: 'packages/queue/src/pg-boss-queue.ts',
    claim: '**THIS PARAGRAPH READ "THAT MIGRATION DOES NOT EXIST YET and this package',
    disposition: 'retired',
    artifact: 'pgboss-job-store-migration',
    why: 'OCCURRENCE 3, one package away from occurrence 2 and left behind by it. ADR-327',
  },
  {
    site: 'scripts/db/probe_pgboss_job_store.sql',
    claim: '-- "`0079` deliberately grants nothing, because pg-boss\'s `create_queue` runs',
    disposition: 'retired',
    artifact: 'pgboss-app-grant-migration',
    why: 'OCCURRENCE 4`s absence half. ADR-327 rewrote REJECTION 5 when `0082` falsified it',
  },
  {
    site: 'apps/worker/src/index.ts',
    claim: 'reaches a schema the role can see. **THIS PARAGRAPH READ "NOTHING HERE IMPORTS',
    disposition: 'retired',
    artifact: 'pgboss-app-grant-migration',
    why: 'the retired half is the GRANT and not the importer, which is still absent above',
  },
  {
    site: 'apps/worker/src/index.ts',
    claim: 'It read "STILL NOT HERE" through two rewrites: ADR-326 measured the blocker',
    disposition: 'retired',
    artifact: 'worker-queue-manifest',
    why: 'ADR-327 added the manifest line the barrel had asked for since session 147',
  },
  {
    site: 'packages/queue/src/index.ts',
    claim: 'THIS HEADING READ "IT HOLDS NO CONNECTION, AND THE THING IT NEEDS DOES NOT',
    disposition: 'retired',
    artifact: 'db-transaction-and-sql-executor',
    why: 'OCCURRENCE 5, found while sizing this row and repaired by it. ADR-328 section 5',
  },

  // --- ADR-330: what the sweep saw the day it learned to read `scripts/` -----
  {
    site: 'scripts/corpus/data-model-columns.mjs',
    claim: '**THIS PARAGRAPH READ "IT CANNOT BE IMPORTED: `gates.mjs` ends in',
    disposition: 'retired',
    artifact: 'gates-importable',
    why:
      'OCCURRENCE 7, reported by leg 6 the moment the sweep reached `scripts/`, and the ' +
      'first of the seven that a check found rather than a reader. ADR-329 finding 6, ADR-330',
  },
  {
    site: 'scripts/db/assert_pgboss_schema_matches_library.mjs',
    claim: '`check()` throws `pg-boss is not installed` when the',
    unbindable:
      'it quotes the pg-boss library`s own thrown error string verbatim, so the sentence ' +
      'states what a VENDOR FUNCTION DOES when a version table is absent and states nothing ' +
      'about what this tree lacks. No probe over this tree can report a function`s behaviour ' +
      'in a dependency, which is the same limit ADR-328 recorded for occurrence 4`s ' +
      'behaviour half. The needle `pg-boss` is correct and the marker `not installed` landed ' +
      'INSIDE A QUOTATION, which a per-line scan over raw text cannot see in any file shape',
    why:
      'the sweep`s first false positive under the widened scope, registered rather than ' +
      'narrowed away: tightening `not installed` would blind the vocabulary to occurrence 2',
  },
  {
    site: 'scripts/db/probe_pgboss_job_store.sql',
    claim: 'dies at SUCCESS 1 with `relation "pgboss.version" does not exist`, exit 3, and',
    unbindable:
      'it quotes PostgreSQL`s own error text verbatim while RECORDING AN OBSERVED ' +
      'COUNTERFACTUAL: what this probe did when executed against `0001`..`0076`, a migration ' +
      'range that is not this tree. The sentence is a dated observation about a tree that no ' +
      'longer exists, so a probe over the tree that does exist can neither confirm nor ' +
      'falsify it, and `RI-15` and `RI-16` exclude dated records for the same reason',
    why: 'the one line `.sql` costs, named in `SWEPT_SCRIPTS` before it was registered here',
  },
];

// -----------------------------------------------------------------------------
// THE CHECK
// -----------------------------------------------------------------------------

/**
 * Run the register against a tree.
 *
 * The register is a PARAMETER so the suite can seed one, on `ri18For`'s shape:
 * every reconstruction in ADR-328 section 6 rebuilds one of the four occurrences
 * as it stood the day it went stale and watches this function report it.
 *
 * @param {string} root
 * @param {{ artifacts: readonly Artifact[], claims: readonly Claim[] }} register
 * @returns {string[]}
 */
export function checkAbsenceClaims(root, register) {
  const { artifacts, claims } = register;
  /** @type {string[]} */
  const findings = [];

  const byKey = new Map(artifacts.map((artifact) => [artifact.key, artifact]));
  if (byKey.size !== artifacts.length) {
    throw new Error(
      'RI-35 found two artifacts registered under one key. A duplicate key means one probe ' +
        'silently shadows another and half the claims are bound to a mechanism nobody reads',
    );
  }

  // ---------------------------------------------------------------------------
  // LEG 1. EVERY CLAIM SITE STILL CARRIES ITS SENTENCE, EXACTLY ONCE.
  //
  // This is what keeps the register from becoming furniture, which is
  // `UNPROBEABLE_ARTIFACTS`' own defining property: an entry that no longer
  // names a real claim is itself a finding. Zero occurrences means the sentence
  // was reworded or deleted and the entry has to move with it; two means the
  // anchor does not identify a site and the other legs are asserting about a
  // line nobody chose.
  // ---------------------------------------------------------------------------
  /** @type {Map<Claim, string[]>} */
  const bodies = new Map();
  for (const claim of claims) {
    const path = join(root, claim.site);
    if (!existsSync(path)) {
      findings.push(
        `${claim.site} is registered as an absence-claim site and does not exist. A register ` +
          'entry pointing at a file nobody has is a claim about a control nobody runs: ' +
          'retire the entry or repair the path',
      );
      continue;
    }
    const lines = readFileSync(path, 'utf8').split('\n');
    const hits = lines.filter((line) => line.includes(claim.claim));
    if (hits.length === 1) {
      bodies.set(claim, lines);
      continue;
    }
    findings.push(
      `${claim.site} carries the registered claim "${claim.claim}" ${String(hits.length)} ` +
        (hits.length === 0
          ? 'times. The sentence moved, was reworded or was deleted, and the register did ' +
            'not move with it. A register entry anchored to prose that is gone asserts ' +
            'nothing, which is the exact failure this check exists about'
          : 'times. The anchor does not identify one site, so the disposition below is ' +
            'about a line nobody chose. Lengthen it until it is unique'),
    );
  }

  // ---------------------------------------------------------------------------
  // LEG 2 AND LEG 3. THE DISPOSITION, AGAINST THE PROBE.
  //
  // Leg 2 is the one that FAILS ON GOOD NEWS and it is the whole point of the
  // row: the day a migration, a registration or an importer lands, the sentence
  // saying it has not is a finding AT ITS OWN LINE.
  //
  // Leg 3 runs the other way and costs one branch. A sentence quoted as history
  // under `RI-14` is only legitimate because the tree falsified it, so an
  // artifact that is still ABSENT under a retired quote means somebody retired a
  // sentence that was still true.
  // ---------------------------------------------------------------------------
  for (const claim of claims) {
    if (!bodies.has(claim)) continue;

    if (claim.unbindable !== undefined) {
      if (claim.artifact !== undefined || claim.disposition !== undefined) {
        findings.push(
          `${claim.site} registers "${claim.claim}" as unbindable AND names an artifact or a ` +
            'disposition. An entry is one or the other: an unbindable claim is one no probe ' +
            'over this tree can report, and a probe would settle it',
        );
      }
      if (claim.unbindable.trim().length < 40) {
        findings.push(
          `${claim.site} registers "${claim.claim}" as unbindable with a reason of ` +
            `${String(claim.unbindable.trim().length)} character(s). An unbindable entry is ` +
            'the one place this register accepts a claim it cannot check, so the reason is ' +
            'the whole of the control and it has to be readable by somebody deciding ' +
            'whether to believe it',
        );
      }
      continue;
    }

    const artifact = claim.artifact === undefined ? undefined : byKey.get(claim.artifact);
    if (artifact === undefined) {
      findings.push(
        `${claim.site} registers "${claim.claim}" against artifact ` +
          `\`${String(claim.artifact)}\`, which no artifact register entry declares. A claim ` +
          'bound to nothing is a claim nobody checks, and it is not an unbindable entry ' +
          'either, because those carry a reason',
      );
      continue;
    }

    const presence = artifact.probe(root);
    if (claim.disposition === 'live' && presence === 'present') {
      findings.push(
        `${claim.site} says "${claim.claim}" AND ${artifact.names} EXISTS. The sentence is ` +
          'false and this is the check going red at it rather than a later session reading ' +
          'it and being sent to do work already done. Repair the sentence, then move its ' +
          'register entry to `retired` so the quote kept beside the correction stays bound',
      );
      continue;
    }
    if (claim.disposition === 'retired' && presence === 'absent') {
      findings.push(
        `${claim.site} quotes "${claim.claim}" as a RETIRED absence claim, and ` +
          `${artifact.names} is still ABSENT. A sentence is retired because the tree ` +
          'falsified it, so this is either a correction written ahead of the thing that ' +
          'justifies it, or the artifact went away again',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // LEG 4. NO ARTIFACT IS FURNITURE.
  //
  // An artifact nobody claims is a probe that runs for nothing, and it is how a
  // register grows a mechanism whose subject has quietly gone. `RI-29`'s
  // row-to-check leg is the same property one register up.
  // ---------------------------------------------------------------------------
  const claimed = new Set(claims.map((claim) => claim.artifact).filter((key) => key !== undefined));
  for (const artifact of artifacts) {
    if (claimed.has(artifact.key)) continue;
    findings.push(
      `the artifact register declares \`${artifact.key}\` and no claim names it. An artifact ` +
        'nobody claims is a probe that runs for nothing: either the sentence it was written ' +
        'for is gone, in which case drop the artifact, or a claim lost its binding',
    );
  }

  // ---------------------------------------------------------------------------
  // LEG 6. THE SWEEP, PER ARTIFACT AND NOT PER TREE.
  //
  // A line in the swept scope that names a registered artifact AND carries a
  // word from the absence vocabulary must be a registered claim. THIS IS THE LEG
  // THAT SCALES: `0079` falsified two sentences in two packages, ADR-326
  // repaired one and ADR-327 repaired the other a row later, because nothing
  // bound the second. Register the artifact once and every site naming it has to
  // be accounted for.
  //
  // THE SCOPE IS `apps/*&#47;src`, `packages/*&#47;src` AND `scripts/` SINCE
  // ADR-330, and the widening is that entry's whole subject. ADR-328 shipped
  // this leg over the first two and said in its own approval block that
  // `scripts/` was the weakest line it drew, because occurrence 4 lived there
  // and was registered by hand precisely because the sweep could not see it.
  // ADR-329 finding 6 then found the seventh occurrence at
  // `scripts/corpus/data-model-columns.mjs`. A blind spot somebody can name in
  // an approval block is a blind spot with a row waiting to fall into it.
  //
  // IT SWEEPS ONLY THE NEEDLES SOMEBODY REGISTERED, which is the limit that
  // keeps it honest rather than the limit that makes it weak. A tree-wide grep
  // for absence phrasing reaches more than twenty sites today and most of them
  // are TRUE, so a gate demanding registration of all of them is a gate somebody
  // satisfies by deleting honest prose.
  // ---------------------------------------------------------------------------
  const needles = artifacts.flatMap((artifact) => artifact.needles);
  if (needles.length > 0) {
    const files = sweptSources(root);
    if (files.length === 0) {
      throw new Error(
        'RI-35 found no source file under any `apps/*/src` or `packages/*/src` to sweep, and ' +
          'none under `scripts/` either. Zero means the layout moved, and the sweep would ' +
          'report every registered artifact as unclaimed anywhere',
      );
    }
    /** @type {Map<string, Claim[]>} */
    const bySite = new Map();
    for (const claim of claims) {
      const seen = bySite.get(claim.site) ?? [];
      seen.push(claim);
      bySite.set(claim.site, seen);
    }
    for (const rel of files) {
      const registered = bySite.get(rel) ?? [];
      const lines = readFileSync(join(root, rel), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!ABSENCE_MARKERS.some((marker) => marker.test(line))) return;
        // THE WINDOW IS THE UNIT AND NOT THE LINE, and `SWEEP_WINDOW`'s docblock
        // is the measurement. It is read for the needle AND for the claim: a
        // wrapped sentence puts the artifact on one line and the absence word on
        // the next, so an anchor scoped to the marker line would report the half
        // of a registered claim that fell on the wrong side of a wrap.
        const window = lines
          .slice(Math.max(0, index - SWEEP_WINDOW), index + SWEEP_WINDOW + 1)
          .join('\n');
        if (!needles.some((needle) => needle.test(window))) return;
        if (registered.some((claim) => window.includes(claim.claim))) return;
        findings.push(
          `${rel}:${String(index + 1)} names a registered artifact and asserts an absence, ` +
            'and no register entry binds it: ' +
            `"${line.trim().slice(0, 120)}". Either it is a claim, in which case register ` +
            'it with the artifact it names, or the needle that reached it is too wide and ' +
            'belongs tightened in the artifact register beside the reason',
        );
      });
    }
  }

  return findings;
}

/** @type {{ id: string, title: string, covers: string, run: (root: string) => string[] }} */
export const ri35 = {
  id: 'RI-35',
  title: 'Every registered absence claim still names something absent',
  covers:
    'ADR-328. A SHIPPED SENTENCE SAYING SOMETHING DOES NOT EXIST IS BOUND TO THE ARTIFACT ' +
    'IT NAMES, AND THE ARTIFACT IS ASSERTED STILL ABSENT. Four occurrences are on record ' +
    '(ADR-324, ADR-326, ADR-327) and each was repaired by hand; this is the binding written ' +
    'once. SIX LEGS. (1) Every registered site exists and carries its sentence EXACTLY ONCE, ' +
    'so a register entry cannot outlive the prose it names. (2) A `live` claim`s artifact ' +
    'must be ABSENT, which is the leg that FAILS ON GOOD NEWS: the day somebody lands it, ' +
    'this goes red AT THE SENTENCE THAT IS NOW LYING. (3) A `retired` claim, quoted as ' +
    'history under RI-14, must have its artifact PRESENT, because a sentence is retired ' +
    'only when the tree falsified it. (4) An `unbindable` entry names no artifact and ' +
    'carries a reason of at least 40 characters, on CI-06/gate-inventory`s precedent for a ' +
    'condition no probe over the tree can report. (5) No artifact is furniture: one nobody ' +
    'claims is a finding. (6) THE SWEEP, which is the leg that scales: a line in ' +
    '`apps/*/src`, `packages/*/src` OR `scripts/` that matches a registered needle AND a ' +
    'word from the written absence vocabulary must be a registered claim. `0079` falsified ' +
    'two sentences in two packages and two separate rows repaired them, because nothing ' +
    'bound the second. THE `scripts/` HALF OF THAT SCOPE IS ADR-330 AND IT IS A REPAIR OF ' +
    'THIS CHECK RATHER THAN AN ADDITION TO IT: ADR-328 shipped leg 6 over the shipped tree ' +
    'alone and its own approval block named `scripts/` as the weakest line it drew, because ' +
    'occurrence 4 lived there and had to be registered by hand; ADR-329 finding 6 then found ' +
    'the SEVENTH occurrence at `scripts/corpus/data-model-columns.mjs`, and leg 6 reported it ' +
    'the moment the scope reached it. The whole directory is swept rather than a written list ' +
    'of subdirectories, `.sql` INCLUDED because occurrence 4 was a `.sql` file and a scope ' +
    'that reaches the directory but not the file shape reproduces the blind spot one level ' +
    'down, and any directory named `test` excluded on the reason `apps/*/src` gets ' +
    'structurally: a case asserting a refusal quotes it. ' +
    'BOTH REGISTERS ARE WRITTEN AND NEVER COMPUTED, on CI-06/gate-inventory`s rule for its ' +
    'own probe table. WHAT IT DOES NOT DO, and each of these is a real hole rather than a ' +
    'modesty clause. IT SWEEPS ONLY REGISTERED NEEDLES: an absence claim about an artifact ' +
    'nobody registered is invisible, and that is deliberate, because a tree-wide grep for ' +
    'absence phrasing reaches more than twenty sites today of which most are TRUE and a ' +
    'gate satisfied by deleting honest prose is a gate somebody deletes. THE VOCABULARY IS ' +
    'WRITTEN: a sentence asserting absence in words not in it is invisible, and every entry ' +
    'in it was taken from a sentence that actually went false. IT IS LINE SCOPED: a claim ' +
    'whose needle and whose absence word land on different lines is missed, which is why ' +
    'two artifacts here register no needle at all and say so. IT READS TEXT AND NEVER ' +
    'MEANING: a line carrying a needle and a marker while asserting no absence is a false ' +
    'positive that has to be registered or have its needle tightened, and BOTH of the two ' +
    'the widened scope surfaced are QUOTED ERROR STRINGS -- pg-boss`s own thrown text and ' +
    'PostgreSQL`s -- registered `unbindable` rather than narrowed away, because a per-line ' +
    'scan over raw text cannot tell a quotation from an assertion in any file shape. IT ' +
    'EXCLUDES `docs/` AND `test/`: a dated record quoting a false sentence is written out of ' +
    'citation grammar (ADR-212, RI-15, RI-16) and a case asserting a refusal quotes it. AND IT ' +
    'CANNOT SEE A CLAIM ABOUT BEHAVIOUR RATHER THAN EXISTENCE: `0079`s header said granting ' +
    'the queue role means granting CREATE, which ADR-327 falsified by RUNNING pg-boss, and ' +
    'no probe over this tree reports what a function does under an option no caller passes. ' +
    'No database.',
  run: (root) => checkAbsenceClaims(root, { artifacts: ABSENCE_ARTIFACTS, claims: ABSENCE_CLAIMS }),
};
