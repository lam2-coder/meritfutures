import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CHECKS,
  COVERAGE_NEEDLES,
  ENV_IGNORE_SUBJECTS,
  clearingConditionPairs,
  DB_ADMITTED,
  DEPLOYABLES,
  EXIT,
  REPO_ROOT,
  runChecks,
  SURFACE_OWNER,
  needle,
} from '../checks/repo-invariants.mjs';
import { ri11 } from '../checks/ui-server-endpoints.mjs';
import { SUBJECTS } from '../checks/response-shape-copies.mjs';
import { ABSENCE_CLAIMS } from '../checks/absence-claims.mjs';

// =============================================================================
// EACH INVARIANT IS WATCHED FAILING BEFORE IT IS TRUSTED
// =============================================================================
// falsify.mjs's rule, applied to the scaffold's own checks: a check that has
// only ever been seen pass is indistinguishable from a check that cannot fail.
// Every case below states the violation it plants and the finding it demands,
// because "it returned a non-empty array" is not evidence that it caught the
// thing you planted.
//
// The dirty direction runs against a SYNTHETIC minimal tree rather than a copy
// of the repository, so a case is fast and its seed is legible. The clean
// direction runs against the real repository, which is the tree these
// invariants are actually about.

/**
 * Run `fn` with `DB_ADMITTED` temporarily holding `names`, then RESTORE WHAT
 * SHIPPED rather than emptying it.
 *
 * THE `finally { DB_ADMITTED.length = 0 }` THESE CASES USED TO WRITE WAS
 * CORRECT ONLY WHILE THE LIST WAS EMPTY, and ADR-120 made it a list with a
 * member. Clearing to empty is not a restore: it is a mutation that happened to
 * agree with the shipped value, and the day it stopped agreeing every case after
 * it in this file would have run against an admission list the repository does
 * not have. That is the same class as RI-04's second copy -- a fixture that goes
 * stale in step with the thing it is testing -- arriving inside a `finally`.
 */
function withDbAdmitted<T>(names: readonly string[], fn: () => T): T {
  const shipped = [...DB_ADMITTED];
  DB_ADMITTED.length = 0;
  DB_ADMITTED.push(...names);
  try {
    return fn();
  } finally {
    DB_ADMITTED.length = 0;
    DB_ADMITTED.push(...shipped);
  }
}

const seeded: string[] = [];
afterEach(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const appendTo = (root: string, rel: string, body: string): void => {
  const at = join(root, rel);
  writeFileSync(at, (existsSync(at) ? readFileSync(at, 'utf8') : '') + body);
};

const write = (root: string, rel: string, body: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/**
 * Every `.md` in a fixture tree, repo-relative.
 *
 * RI-31's two sentinels are the only cases that need this, and they need it for
 * opposite reasons: one empties the markdown and the other leaves every file in
 * place while taking the SPANS out of it. Enumerating rather than naming the
 * files keeps both cases true when the fixture grows another document.
 */
const walkMarkdown = (root: string, dir = '.', out: string[] = []): string[] => {
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === '.git') continue;
    const rel = dir === '.' ? entry : `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) walkMarkdown(root, rel, out);
    else if (rel.endsWith('.md')) out.push(rel);
  }
  return out;
};

/**
 * The packages the fixture declares, in ONE place.
 *
 * The RI-08 case below builds "every package in this workspace" from this list
 * rather than from a second copy of it, on the rule the fixture's own RI-04
 * comment states: a fixture that maintains its own copy of the thing under test
 * goes stale in step with it and cannot fail.
 */
const FIXTURE_PACKAGES = ['rules-engine', 'db', 'ledger'] as const;

/** A file of `n` lines carrying each name on its own one-based line. */
const linesNaming = (n: number, at: Readonly<Record<number, string>>): string =>
  Array.from({ length: n }, (_, i) => {
    const name = at[i + 1];
    return name === undefined ? '//' : `export function ${name}(): void {}`;
  })
    .join('\n')
    .concat('\n');

/**
 * The mint RI-22 executes, as the fixture states it.
 *
 * IT IS A SECOND IMPLEMENTATION AND NOT A COPY OF THE SHIPPED ONE, on the rule
 * the RI-04 comment below states: a fixture that keeps its own copy of the thing
 * under test goes stale in step with it and cannot fail. What the shipped module
 * and this one share is the CONTRACT RI-22 reads -- three exports and a draw --
 * and each seeded case below breaks exactly one clause of it.
 */
const FIXTURE_MINT =
  "import { randomInt } from 'node:crypto';\n" +
  "export const CERTIFICATE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';\n" +
  'export const CERTIFICATE_CODE_LENGTH = 26;\n' +
  'export const CERTIFICATE_CODE_ENTROPY_BITS = Math.floor(\n' +
  '  CERTIFICATE_CODE_LENGTH * Math.log2(new Set(CERTIFICATE_CODE_ALPHABET).size),\n' +
  ');\n' +
  'export function mintCertificateCode() {\n' +
  "  let code = '';\n" +
  '  for (let i = 0; i < CERTIFICATE_CODE_LENGTH; i += 1)\n' +
  '    code += CERTIFICATE_CODE_ALPHABET.charAt(randomInt(0, CERTIFICATE_CODE_ALPHABET.length));\n' +
  '  return code;\n' +
  '}\n';

/** Put a mint at the path RI-22 names. */
const writeMint = (root: string, body: string): void =>
  write(root, 'packages/db/src/certificate-code.ts', body);

/**
 * The register rows RI-29 reads, one per live check, DERIVED and never typed.
 *
 * The third cell is the title read out of the array, which is the register's own
 * rule. `overrides` replaces or drops the row for one id, which is how a case
 * seeds exactly one of RI-29's legs.
 */
const register = (overrides: Readonly<Record<string, string | null>> = {}): string[] =>
  CHECKS.flatMap((c) => {
    const override = overrides[c.id];
    if (override === null) return [];
    return [override ?? `| \`${c.id}\` | the fixture's register | ${c.title} |`];
  });

/** The fixture's ALLOCATION document: RI-16's citations, then RI-29's register. */
const allocationDoc = (rows: readonly string[]): string =>
  '# Number allocation\n\n## Reservations\n\n' +
  '| 164 | `PayoutTx.ledger` (`routes/payouts.ts:395`) is required, and the worker at ' +
  "`systemDb('nightly-batch')` (`sweeps/ports.ts:219`) already posts; both are scope " +
  'class `derived` (`scope.ts:555,566`) |\n' +
  '| 168 | `PayoutTx.ledger` is a required `LedgerTx` at `routes/payouts.ts:395`, and ' +
  'both plan tables are scope class `firm` (`scope.ts:525,536`) |\n' +
  '\n## The invariant register\n\n' +
  '| Number | Claimed by | What it asserts |\n| --- | --- | --- |\n' +
  rows.join('\n') +
  '\n';

/** A tree that satisfies every invariant, which each case then breaks in one way. */
function cleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-invariants-'));
  seeded.push(root);

  write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  write(root, '.nvmrc', '22\n');
  // RI-14 reads these files BY NAME, so the clean tree carries all of them with
  // reasons that are TRUE. A fixture missing one makes the rename guard fire on
  // every case, which is the guard working and the fixture wrong. That happened
  // twice while this check was written, both times caught by running it.
  write(
    root,
    'apps/api/test/wiring.test.ts',
    'const BLOCKED = {\n' +
      '  useRailBackend:\n' +
      "    'a vendor adapter this workspace does not ship, named in no package.json.',\n" +
      '};\n' +
      '// The gate reads `principal(request)` (`routes/admin-wallet.ts:601`).\n' +
      // RI-20 READS THESE FILES BY NAME AND THROWS WHEN IT FINDS NO COMMAND
      // CLAIM IN ANY OF THEM, so the fixture carries one in each direction and
      // both are TRUE against this tree. A fixture without them makes the
      // asserting-nothing guard fire on every case in this file, which is the
      // guard working and the fixture wrong -- the same trap RI-14's three files
      // and RI-15's six set while they were being written.
      '// `grep -rn zzznosuchtoken packages/db/migrations` returns nothing.\n' +
      '// `grep -rln risk packages/db/migrations` returns 1 line.\n',
  );
  write(root, 'apps/api/src/idempotency.ts', '// The protocol over the store port.\n');
  write(root, 'apps/api/src/routes/wallet-withdrawals.ts', '// The external leg.\n');
  // RI-20 NAMES TWO MORE FILES THAN RI-14 DOES, and the pair is the shape
  // session 410 landed: EACH ONE CARRIES THE CLAIM ABOUT THE OTHER, because a
  // grep over the file a sentence is written in matches the sentence and the
  // count would then include its own statement. So the fixture's `routes/auth.ts`
  // counts the refusals in `auth-backend.ts` and the fixture's `auth-backend.ts`
  // counts the port members in `routes/auth.ts`, and both claims are TRUE here.
  write(
    root,
    'apps/api/src/auth-backend.ts',
    '// The port size is a fact about the other file, so it is settleable here:\n' +
      '// `grep -rn ": unwired" apps/api/src/routes/auth.ts` returns 2 lines.\n' +
      "  requestOtp: blocked('requestOtp', NO_DELIVERY),\n" +
      "  readMe: blocked('readMe', NO_MAX_ACCOUNTS),\n" +
      "  elevate: blocked('elevate', NO_ELEVATION),\n",
  );
  write(
    root,
    'apps/api/src/routes/auth.ts',
    '// The refusal count is a fact about the other file, so it is settleable\n' +
      '// here: `grep -rn ": blocked" apps/api/src/auth-backend.ts` returns 3 lines.\n' +
      "  sessionByToken: unwired('sessionByToken'),\n" +
      "  requestOtp: unwired('requestOtp'),\n",
  );
  // RI-15 NAMES THREE MORE FILES BY NAME AND THE FIXTURE CARRIES ALL OF THEM,
  // for the reason stated above RI-14's three: a fixture missing one makes the
  // rename guard fire on every case, which is the guard working and the fixture
  // wrong. Each one carries a citation that is TRUE against this fixture, so the
  // clean direction is a real pass rather than an empty one.
  write(root, 'apps/api/src/idempotency-store.ts', 'export const databaseIdempotencyStore = 1;\n');
  write(root, 'apps/worker/src/detectors/fills.ts', linesNaming(1100, { 1059: 'martingale' }));
  // RI-16 READS docs/ AND ITS REGISTER NAMES TWO DOCUMENTS AND TWO SOURCE
  // FILES, so the fixture carries all four and reproduces all four registered
  // findings. THE REGISTER SHRINKS ONLY: an entry matching no finding is itself
  // a finding, so a fixture that omitted these would make RI-16 report four on
  // every case in this file -- the register working and the fixture wrong. That
  // is the same trap RI-14's three files and RI-15's six set twice while they
  // were being written.
  write(
    root,
    'apps/api/src/routes/payouts.ts',
    '// The store is `databaseIdempotencyStore` (`src/idempotency-store.ts:1`).\n' +
      '//\n'.repeat(399),
  );
  write(root, 'apps/worker/src/sweeps/ports.ts', '//\n'.repeat(250));
  // AND THE TWO ADR-212 ADDED, WHICH ARE VACANT-LINE FINDINGS RATHER THAN NAME
  // ONES. Both sit in `apps/worker/**`, both cite a line that is BLANK, and
  // neither binds a name -- which is the shape the vacant rule exists for and
  // the reason the register carries a nullable `name` at all. The fixture puts
  // the blank line exactly where the real tree has it, so a case reads the
  // register's own pointers back rather than some other ones.
  //
  // `scope.ts` DOUBLES AS RI-16'S TWO REGISTERED DOC FINDINGS, and the line
  // choices are not free: `derived` sits at 545 and `firm` at 511, so the
  // SECOND number of each comma list in `ALLOCATION.md` below resolves and the
  // FIRST one does not. That is the real tree's shape -- four wrong pointers of
  // which two go green on a coincidence -- reproduced rather than described.
  //
  // ALL FOUR NUMBERS MOVED BY 24 UNDER ADR-237 AND THE SHAPE IS UNCHANGED. The
  // real `scope.ts` gained two registry entries, every declaration below its
  // `TABLES` object moved, and the register moved with the rows rather than the
  // rows being left pointing at a coincidence. THE FIXTURE IS A COPY OF A
  // MOVING TREE AND THAT IS THE ONE THING IT CANNOT DERIVE: the register names
  // literal numbers, so a fixture that did not move with them would report
  // every registered finding as vacant. It went red exactly that way before
  // this shift, on the same run that proved the register entries had followed.
  //
  // AND ONE OF THEM MOVED BY TWO MORE UNDER ADR-252, WHICH IS THE SECOND TIME
  // AND THE FIRST ONE WHERE ONLY ONE MOVED. `0074` added `firmParameters` to
  // `TABLES` and a rule at the foot of `SCOPE_RULES`, so everything below the
  // `TABLES` object shifted by two and the `},` this fixture models went from
  // `909` to `911`. The two `ALLOCATION.md` pointers did NOT move with it: they
  // are registered on their FIRST number, that number is another session's to
  // repair, and only the SECOND of each was repointed in the real document. So
  // `firm` and `derived` stay where they are here and the blank line alone
  // moves, which is the shape the register actually holds.
  //
  // AND ALL FOUR MOVED A FOURTH TIME UNDER ADR-321, BY NINETEEN, WHICH IS THE
  // SECOND TIME EVERY NUMBER MOVED AT ONCE AND THE FIRST TIME A REGISTERED
  // FINDING WENT GREEN BY ACCIDENT. `0078` registered `affiliate_commissions`,
  // so `scope.ts` gained an import, a `TABLES` entry, a `SCOPE_RULES` rule and a
  // rewritten class-docblock paragraph, and every declaration below them shifted
  // by nineteen. THE SHAPE IS UNCHANGED AND IT HAD TO BE RESTORED RATHER THAN
  // LEFT: at the old numbers `scope.ts:536` landed one line off a `derived` in
  // the moved docblock and `scope.ts:547` two lines off another, so BOTH halves
  // of that pointer went green and the register entry naming the first one
  // exempted nothing -- which is a finding of its own, by that entry's own rule.
  // All four numbers therefore move with the tree, `firm` and `derived` move
  // here with them, and the four-pointers-two-green shape the real document
  // holds is reproduced rather than described.
  //
  // AND IT MOVED A THIRD TIME UNDER ADR-262, BY SIXTY-FIVE, WHICH IS THE FIRST
  // MOVE LARGE ENOUGH TO NEED THE FIXTURE TO GROW. That entry added
  // `PairCounterparty` beside `PairWriter` and a `counterparty` block inside the
  // `attributions` rule, both ABOVE the `},` this models, so it went from `911`
  // to `976` and a 960-line fixture no longer reaches it. The length follows the
  // pointer for the reason the paragraph above gives: the register names literal
  // numbers, so a fixture that did not move with them would report every
  // registered finding as vacant. `firm` and `derived` are unmoved again, on the
  // same reasoning as last time.
  write(
    root,
    'packages/db/src/scope.ts',
    Array.from({ length: 1044 }, (_, i) => {
      if (i + 1 === 995) return '';
      const name = { 536: 'firm', 566: 'derived' }[i + 1];
      return name === undefined ? '//' : `// class: '${name}',`;
    })
      .join('\n')
      .concat('\n'),
  );
  write(
    root,
    'packages/db/migrations/0008_risk.sql',
    Array.from({ length: 140 }, (_, i) => (i + 1 === 107 ? '' : '-- risk'))
      .join('\n')
      .concat('\n'),
  );
  write(
    root,
    'apps/worker/src/detectors/identity.ts',
    '// The identity is always there because "flags attach to HUMANS, not to\n' +
      '// accounts" (`0008_risk.sql:107`).\n',
  );
  write(
    root,
    'apps/worker/src/provisioning/payload.ts',
    '// The payload is flat, and `scope.ts:995` repeats it at length.\n',
  );
  write(
    root,
    'docs/plans/FOLD-01-phone-identity.md',
    '# FOLD-01\n\n## Evidence\n\n' +
      '| 3 | the vendor already buys phone footprint | `DECISIONS.md:483` |\n' +
      '| 4 | the store that exists | `databaseIdempotencyStore` ' +
      '(`apps/api/src/idempotency-store.ts:1`) |\n',
  );
  // AND THE FOUR THE IN-TOKEN NAME BINDING ADDED, which point from a plan into
  // `apps/admin/src/page.ts` and are each THIRTY lines short. The fixture
  // reproduces the drift at the same distance rather than at some other one, so
  // a case reads the register's own numbers back.
  write(
    root,
    'apps/admin/src/page.ts',
    Array.from({ length: 680 }, (_, i) => {
      const name = {
        249: 'assertNamesNoSubject',
        293: 'assertFloatIsNotReserve',
        421: 'buildLiabilityHome',
        660: 'renderLiabilityHome',
      }[i + 1];
      return name === undefined ? '//' : `export function ${name}(): void {}`;
    })
      .join('\n')
      .concat('\n'),
  );
  write(
    root,
    'docs/plans/WAVE-06-admin-console-transport.md',
    '# WAVE-06\n\n## The modules\n\n' +
      '| [`page.ts`](../../apps/admin/src/page.ts) | the liability home assembled ' +
      '([`buildLiabilityHome:391`](../../apps/admin/src/page.ts)), its line rendering ' +
      '([`renderLiabilityHome:630`](../../apps/admin/src/page.ts)), and two assertions: ' +
      '[`assertNamesNoSubject:219`](../../apps/admin/src/page.ts) and ' +
      '[`assertFloatIsNotReserve:263`](../../apps/admin/src/page.ts) |\n',
  );
  // RI-29 READS THE `RI-nn` REGISTER OUT OF THIS DOCUMENT, so the fixture
  // carries one and it is DERIVED FROM `CHECKS` rather than typed. A typed copy
  // here would be the exact defect RI-29 exists to catch, one directory over: it
  // would drift the day a check was added and every case below would then report
  // the fixture's staleness instead of its own seed.
  write(root, 'docs/decisions/ALLOCATION.md', allocationDoc(register()));
  // RI-31's SCOPE IS A COMMENT SYNTAX RATHER THAN A DIRECTORY, AND ITS SECOND
  // SENTINEL IS AN UNCONDITIONAL THROW when nothing in the tree carries one. So
  // the fixture must hold at least one generated span or every clean-tree case
  // fails on a fixture defect rather than on a check. TWO FILES, because the
  // check's own claim is that a span crossing a file boundary is fine: these two
  // lines are byte-identical, in different documents, and are NOT a finding.
  write(
    root,
    'docs/testing/SPANS.md',
    '# Spans\n\nThe corpus holds <!--gen:gate_count-->33<!--/gen--> gates.\n',
  );
  // ADR-334. THE STUB GAINS THE MANIFEST'S TWO LANDING SHAPES, AND IT IS
  // FIDELITY RATHER THAN EXEMPTION (ADR-330's phrase for the same repair).
  // `RI-37` binds every migration in this estate to a landing record, and this
  // file used to be two lines written for `RI-31`'s repeated-span leg while the
  // estate carried four migrations, so the check refused to report on it at
  // all. It records all four now, in both of the shapes the real manifest
  // uses, so the clean-tree case ASSERTS something here: a fifth migration
  // added to this fixture without a record turns it red. The generated span
  // stays and stays UNREPEATED, which is what `RI-31` reads this file for.
  write(
    root,
    'packages/db/DELTA_MANIFEST.md',
    [
      '# Manifest',
      '',
      'The corpus holds <!--gen:gate_count-->33<!--/gen--> gates.',
      '',
      '## 1. The migration sequence',
      '',
      '| # | File | Money path | Contents |',
      '|---|---|---|---|',
      '| 0008 | `risk` | no | a row of the migration sequence, which is the fold`s own record |',
      '',
      '## 13. `0078` lands, and a heading is the other shape (2026-09-05)',
      '',
      '## 14. `0079` and `0082` land, and a heading may name two (2026-09-05)',
      '',
      // ADR-337. THE STUB GAINS SECTION 16's SECTION-NUMBER TABLE, on the same
      // fidelity argument one leg over. `RI-37` leg 4 binds every `## <n>.`
      // heading in this file to a row of that table and back, and REFUSES to
      // report on a manifest that carries landing sections and no such table,
      // because a missing one would name every heading in the file as
      // unclaimed. The three numbers this stub heads are claimed here, so the
      // clean-tree case asserts leg 4 as well: a fifth section added to this
      // fixture without a row turns it red.
      '## 16. Allocation: `OI-nn` identifiers and section numbers',
      '',
      '### Section numbers',
      '',
      '| Section | Claimed by | State |',
      '|---|---|---|',
      '| 1 | the fold | allocated |',
      '| 13 | the fold | allocated |',
      '| 14 | the fold | allocated |',
      '| 16 | this table | allocated |',
      '',
    ].join('\n'),
  );
  write(root, 'package.json', JSON.stringify({ name: 'merit', private: true }));
  write(
    root,
    'vitest.config.ts',
    ['unit', 'property', 'golden', 'integration']
      .map((s) => `{ test: { name: '${s}' } }`)
      .join('\n'),
  );
  write(
    root,
    '.github/workflows/ci.yml',
    'jobs:\n  x:\n    steps:\n      - node-version-file: .nvmrc\n',
  );
  for (const pkg of FIXTURE_PACKAGES) {
    write(root, `packages/${pkg}/package.json`, JSON.stringify({ name: `@merit/${pkg}` }));
  }
  // RI-07's input: a module GRAPH, not a file. Two modules rather than one,
  // because the check throws when it walks fewer than two -- a graph walk that
  // reached only the entry point means the specifier scan stopped matching, and
  // a fixture with one file could not tell those apart.
  write(root, 'packages/rules-engine/src/index.ts', "export { floorAt } from './floor.ts';\n");
  write(
    root,
    'packages/rules-engine/src/floor.ts',
    'export const floorAt = (n: number): number => (n < 0 ? 0 : n);\n',
  );
  // RI-04's OWN LIST, NOT A SECOND COPY OF IT. This read `['site', 'portal',
  // 'admin', 'worker']` while DEPLOYABLES read the same four, so the two agreed
  // by coincidence until ADR-083 added `apps/api` to the tree and neither list
  // learned about it. A fixture that maintains its own copy of the thing under
  // test cannot fail when that thing goes stale; it just goes stale in step.
  for (const app of DEPLOYABLES) {
    write(root, `apps/${app}/package.json`, JSON.stringify({ name: `@merit/${app}` }));
  }
  // RI-09'S INPUT, AND IT IS THE FIXTURE'S OWN VOCABULARY RATHER THAN A COPY OF
  // THE REPOSITORY'S. The check parses `BASE_PATH` and `OPERATOR_PREFIXES` out
  // of whatever `apps/<owner>/src/surface.ts` the tree it is given holds, which
  // is what keeps the two lists in one place; the case below that rewrites this
  // file and watches the finding follow is what proves that rather than
  // asserting it. The spelling here matches the real one so the seeded cases
  // read like the defect they stand for.
  write(
    root,
    `apps/${SURFACE_OWNER}/src/surface.ts`,
    "export const BASE_PATH = '/api/v1';\n" +
      "export const OPERATOR_PREFIXES = ['/admin', '/internal'] as const;\n",
  );
  // RI-06's two inputs. The fixture registers one rule and attaches it, which is
  // the shape the invariant demands; the seeded cases below break it in each
  // direction separately.
  write(
    root,
    'packages/eslint-plugin-merit/index.js',
    "const plugin = { rules: {\n  'engine-purity': enginePurity,\n} };\n",
  );
  write(
    root,
    'eslint.config.js',
    "export default [{ rules: { 'merit/engine-purity': 'error' } }];\n",
  );
  // RI-15's REGISTER SHRINKS ONLY, so the fixture reproduces every one of its
  // entries -- SEVEN since ADR-214, because the `routes/admin-wallet.ts:538`
  // entry was repaired at its source and left with the repair. The fixture
  // mirrors the repair rather than the defect: `principal` is at 601 and the
  // citation says 601. An entry matching nothing here would be a finding on EVERY
  // case in this file -- the guard working and the fixture wrong, which is the
  // trap RI-14's three files and the six-file list this check used to carry set
  // twice while they were being written. Each seed reproduces the REAL distance,
  // so a case reads the register's own numbers back rather than some other ones.
  write(root, 'apps/api/src/routes/admin-wallet.ts', linesNaming(700, { 601: 'principal' }));
  write(
    root,
    'apps/api/src/admin-source/index.ts',
    linesNaming(200, { 193: 'IMPLEMENTED_ADMIN_READS' }),
  );
  write(root, 'apps/api/src/routes/admin-reads.ts', linesNaming(900, { 853: 'handle' }));
  write(
    root,
    'packages/db/src/scoped-db.ts',
    linesNaming(800, { 543: 'update', 687: 'FilterTerm' }),
  );
  write(root, 'packages/ledger/src/posting.ts', linesNaming(300, { 232: 'entriesOf' }));
  write(
    root,
    'apps/admin/src/index.ts',
    '// [`IMPLEMENTED_ADMIN_READS:178`](../../api/src/admin-source/index.ts) is data.\n',
  );
  write(
    root,
    'apps/api/src/admin-source/flags.ts',
    '// D-01, D-04 and D-05 write `copy_cluster`, `news_window` and `martingale`\n' +
      '// (`detectors/fills.ts:505`, `:810`, `:1059`).\n',
  );
  for (const rel of ['apps/api/src/routes/admin-feed.ts', 'apps/api/test/admin-feed.test.ts']) {
    write(
      root,
      rel,
      '// `adminHandler` resolves `currentReadSource()` before it calls `spec.handle`\n' +
        '// (`admin-reads.ts:856`).\n',
    );
  }
  write(
    root,
    'apps/api/src/routes/webhooks-psp.ts',
    '// `firmTx.update` (`scoped-db.ts:720`) hardcodes `undefined` for its WHERE clause.\n',
  );
  write(
    root,
    'apps/api/test/admin-payouts.test.ts',
    '// A debit is positive, read off `entriesOf` at `packages/ledger/src/posting.ts:235`.\n',
  );
  write(
    root,
    'apps/api/test/db.test.ts',
    '// `atMost(value)` mints a frozen `FilterTerm` (`scoped-db.ts:662`).\n',
  );
  // RI-18'S THREE INPUTS, AND THE FIXTURE DECLARES EACH SHAPE THREE TIMES ON
  // PURPOSE. The check compares COPIES, so a fixture with one declaration would
  // make it throw its own non-vacuity guard on every case in this file -- the
  // guard working and the fixture wrong, which is the trap RI-14's, RI-15's and
  // RI-16's inputs each set once while they were being written.
  //
  // THE NAMES COME FROM `SUBJECTS` AND ARE NOT A SECOND COPY OF THEM, for the
  // reason `DEPLOYABLES` is read above rather than retyped: a fixture holding
  // its own list of what the check is about cannot fail when that list grows,
  // it goes stale in step.
  //
  // THE THREE COPIES SPELL THE SHAPE DIFFERENTLY ON PURPOSE: an `interface`
  // reaching a second declaration by reference, a `type` alias with
  // `ReadonlyArray<>` where the contract writes `Array<>` and the interface
  // writes `readonly []`, and no `readonly` at all in the document. The real
  // divergence this check exists for hides behind exactly those differences,
  // and three byte-identical copies would not tell a reader whether the parser
  // or a string comparison was doing the work.
  for (const subject of SUBJECTS) {
    write(
      root,
      'docs/architecture/API_CONTRACT.md',
      `### GET /admin/${subject}\n` +
        '```ts\n' +
        `type ${subject} = {\n` +
        '  as_of: string;\n' +
        '  nested: { cents: number };\n' +
        '  rows: Array<{ day: string }>;\n' +
        '};\n' +
        '```\n',
    );
    write(
      root,
      `apps/${SURFACE_OWNER}/src/routes/${subject}.ts`,
      `interface ${subject}Nested {\n  readonly cents: number;\n}\n` +
        `export interface ${subject} {\n` +
        '  readonly as_of: string;\n' +
        `  readonly nested: ${subject}Nested;\n` +
        '  readonly rows: readonly { readonly day: string }[];\n' +
        '}\n',
    );
    write(
      root,
      'apps/admin/src/api/types.ts',
      `export type ${subject} = {\n` +
        '  readonly as_of: string;\n' +
        '  readonly nested: { readonly cents: number };\n' +
        '  readonly rows: ReadonlyArray<{ readonly day: string }>;\n' +
        '};\n',
    );
  }
  // RI-19'S PAIR, AND THE FIXTURE STATES THE CONDITION TWICE ON PURPOSE. The
  // check compares a module's enumeration against the case that restates it, so
  // a fixture with one statement would make its non-vacuity guard throw on every
  // case in this file -- the guard working and the fixture wrong, which is the
  // trap RI-14's, RI-15's, RI-16's and RI-18's inputs each set once while they
  // were being written.
  //
  // THE SPELLING IS `B5`'s OWN, so the seeded cases below read like the defect
  // they stand for rather than like an alphabet. The module enumerates the three
  // terms and the case restates them in one sentence, which is exactly the shape
  // session 392 left on the real tree after it found the two statements carrying
  // two of three terms each.
  write(
    root,
    'apps/api/src/admin-source/blocked-read.ts',
    '// B9. The group is blocked and the condition is stated ONCE, here.\n' +
      '//\n' +
      '// **CLEARING CONDITION, ALL THREE TERMS:**\n' +
      '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
      '//   2. A primary source declares the stored `engine_gates` ENCODING.\n' +
      '//   3. `eligible_next_7d` gains its `| null`.\n',
  );
  write(
    root,
    'apps/api/test/admin-source-blocked-read.test.ts',
    '// CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` implementation\n' +
      '// lands, AND a primary source declares the stored `engine_gates` ENCODING,\n' +
      '// AND `eligible_next_7d` gains its `| null`.\n',
  );

  // RI-22 READS THE CORPUS'S OWN COMMITMENT AND THROWS WHEN IT FINDS NONE, so
  // the fixture carries all three documents it names with the figure they
  // actually state. A fixture missing them makes the settles-nothing guard fire
  // on every case in this file, which is the guard working and the fixture
  // wrong: exactly the trap RI-14's three files and RI-20's two set before it.
  write(
    root,
    'docs/plans/M11-certificates-social-proof.md',
    '| INV-M11-05 | Certificate codes are unguessable | 128 bits of entropy, no sequence |\n' +
      '1. **128 bits of entropy, no sequence, no structure** (INV-M11-05).\n',
  );
  // APPENDED RATHER THAN WRITTEN. `SUBJECTS` above already put RI-18's whole
  // specification in this file, and `write` overwrites: replacing it left RI-18
  // throwing "holds no ```ts block" on the clean tree, which is one check's
  // fixture quietly deleting another's.
  appendTo(
    root,
    'docs/architecture/API_CONTRACT.md',
    "| `GET /verify/:code` | The catalog's budget is an enumeration budget on a 128-bit token |\n",
  );
  write(root, 'docs/edge-cases/EC-091.md', '- Correct behavior: **128 bits of entropy**.\n');
  // AND THE MINT ITSELF, WHICH RI-22 EXECUTES. It is a real generator rather
  // than a stub, because the check asserts over the DRAWS: a fixture that
  // returned a constant would fail the clean direction, which is the check
  // working.
  writeMint(root, FIXTURE_MINT);

  // RI-21 ASKS `git` ABOUT THIS TREE, so the fixture is a real work tree rather
  // than a directory. `git init` is measured at roughly 7ms and this helper runs
  // 100-odd times in this file, which is under a second for the whole suite and
  // is what a check whose subject is git's own answer costs.
  //
  // AND THE `git init` IS LOAD-BEARING FOR A SECOND REASON. Without a `.git`
  // here, `git check-ignore` would walk UP out of the temp directory looking for
  // a work tree, and on a machine where `TMPDIR` sits inside a repository every
  // RI-21 case would silently be reading that repository's rules instead of the
  // fixture's.
  // RI-30's ESTATE, WHICH THE FIXTURE MUST CARRY BECAUSE THAT CHECK'S SENTINELS
  // ARE UNCONDITIONAL THROWS RATHER THAN A SILENCE ON A FOREIGN TREE. ADR-279
  // chose that on the row's own instruction: an absence check over an empty
  // scope reports PASS in silence, and this check's whole subject is that
  // defect. So the fixture holds the three things it refuses to run without --
  // the home, the witness that is admitted to carry the naive idiom, and one
  // importer OUTSIDE `packages/tooling`, which is the leg that detects a revert.
  write(
    root,
    'packages/tooling/checks/strip-comments.mjs',
    'export function stripComments(source) {\n  return source;\n}\n',
  );
  write(
    root,
    'packages/tooling/test/strip-comments.test.ts',
    '// The idiom this file is admitted to carry, as the thing every case compares against.\n' +
      "const naive = (s) => s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ').replace(/\\/\\/[^\\n]*/g, ' ');\n" +
      'export const seen = naive;\n',
  );
  write(
    root,
    'packages/harness/test/parses-source.test.ts',
    "import { stripComments } from '../../tooling/checks/strip-comments.mjs';\n" +
      'export const read = stripComments;\n',
  );

  absenceClaimEstate(root);

  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  write(root, '.gitignore', '.env\n.env.*\n!.env.example\n');
  return root;
}

/**
 * RI-35's estate, which the fixture must carry for the same reason RI-30's does.
 *
 * That check's probes THROW rather than fall silent on a tree they cannot read,
 * on ADR-294's rule that a check which cannot run is not a check that passed. So
 * a fixture missing a manifest, the migration set or the `@merit/db` barrel
 * makes RI-35 ERROR on every case in this file, which is the guard working and
 * the fixture wrong: the trap RI-14's three files, RI-20's two, RI-22's three
 * and RI-30's estate each set while they were being written.
 *
 * THE CLAIM SITES ARE DERIVED FROM THE REGISTER AND THE ARTIFACTS ARE NOT. The
 * sites are the register's own data, so materialising them from it keeps this
 * helper true when a claim is added. What makes each artifact PRESENT or ABSENT
 * is a SECOND implementation of what the probes read, on this file's own rule
 * for RI-22's mint: a fixture that keeps a copy of the mechanism under test goes
 * stale in step with it and cannot fail.
 *
 * EVERY ARTIFACT IS PUT IN THE STATE THE REGISTER'S DISPOSITIONS DEMAND. A
 * `retired` claim needs its artifact PRESENT and a `live` one needs it ABSENT,
 * so the migration set carries the three migrations, `apps/worker` declares
 * `@merit/queue` and the `@merit/db` barrel exports every half a probe reads;
 * while `apps/api` and `packages/db` declare the queue in no manifest and
 * nothing calls `runProvisioningSaga`.
 *
 * **ADR-333 FLIPPED `queue-door` AND THIS HELPER HAD TO FLIP WITH IT**, which is
 * the fixture doing its job rather than a maintenance cost. That artifact's three
 * claims were `live` and are `retired`, so a fixture where NO `src/` file imports
 * the queue now fails leg 3 instead of passing leg 2: `apps/worker/src/queue.ts`
 * carries a real import here, exactly as it does in this repository. Two probes
 * arrived with the same row and each reads a file this fixture had never needed:
 * `job-queue-failure-channel` reads `packages/queue/src/job-queue.ts`, which is
 * written with the FIVE methods and no emitter because its claims are `live`;
 * and `db-pool-sql-executor` reads the accessor's barrel and `scoped-db.ts`,
 * both of which must name `poolSqlExecutor` because its claim is `retired`.
 * Each of those probes THROWS on a file it cannot open, so the omission was an
 * ERROR on every case in this file rather than a silent pass, which is the trap
 * RI-14's three files, RI-20's two, RI-22's three and RI-30's estate each set
 * while they were being written.
 */
function absenceClaimEstate(root: string): void {
  write(root, 'apps/api/package.json', '{ "name": "@merit/api", "private": true }\n');
  write(root, 'packages/db/package.json', '{ "name": "@merit/db", "private": true }\n');
  write(
    root,
    'apps/worker/package.json',
    '{ "name": "@merit/worker", "private": true,\n' +
      '  "dependencies": { "@merit/queue": "workspace:*" } }\n',
  );
  appendTo(
    root,
    'packages/db/src/index.ts',
    'export {\n  poolSqlExecutor,\n  transaction,\n  type SqlExecutor,\n};\n',
  );
  // ADR-333. `db-pool-sql-executor` reads BOTH halves, so the fixture carries
  // both: a barrel line alone is not an export.
  appendTo(
    root,
    'packages/db/src/scoped-db.ts',
    'export function poolSqlExecutor(reason) {\n  return reason;\n}\n',
  );
  // ADR-333. `job-queue-failure-channel`'s two claims are `live`, so the
  // interface here carries the FIVE methods ADR-006 fixed and no emitter.
  write(
    root,
    'packages/queue/src/job-queue.ts',
    "export const JOB_QUEUE_METHODS = [\n  'declareQueue',\n  'enqueue',\n  'consume',\n" +
      "  'start',\n  'stop',\n] as const;\n",
  );
  // ADR-333. `queue-door`'s three claims are `retired`, so the importer has to
  // be REAL here: the claim lines the loop below appends to this same file are
  // comments, and `importedAnywhere` reads the import and never the mention.
  write(root, 'apps/worker/src/queue.ts', "import { pgBossQueue } from '@merit/queue';\n");
  // ADR-338. `worker-queue-door-caller`'s two claims are `retired`, so the
  // fixture needs a CALLER of the door past the module that declares it, exactly
  // as this repository now has one. The probe strips comments before it reads, so
  // this has to be real code and not a sentence about one; and it must not name
  // `runProvisioningSaga`, whose own artifact is `live` and must stay ABSENT.
  write(
    root,
    'apps/worker/src/provisioning/queue-adapter.ts',
    "import { LIVE_QUEUE } from '../queue.ts';\n" +
      'export const LIVE_PROVISIONING_QUEUE = provisioningJobQueue(LIVE_QUEUE);\n',
  );
  write(
    root,
    'packages/db/migrations/0078_affiliate_commission_owner.sql',
    'ALTER TABLE affiliate_commissions ADD COLUMN affiliate_id uuid NOT NULL;\n',
  );
  write(
    root,
    'packages/db/migrations/0079_pgboss_job_store.sql',
    'CREATE SCHEMA IF NOT EXISTS pgboss;\n',
  );
  write(
    root,
    'packages/db/migrations/0082_pgboss_app_grants.sql',
    'GRANT USAGE ON SCHEMA pgboss TO merit_app;\n',
  );

  // ADR-330. THE ESTATE REACHES `scripts/` NOW, AND THESE THREE FILES ARE
  // FIDELITY RATHER THAN EXEMPTION. `RI-35`'s sweep was widened to read
  // `scripts/`, so the register gained claim sites there and the loop below
  // materialises them -- which drags in two OTHER checks' subjects, and both
  // were repaired by making the fixture more like this repository rather than
  // by narrowing anything.
  //
  //   `scripts/corpus/gates.mjs` is what the `gates-importable` probe READS. It
  //   throws on a missing file rather than reporting `absent`, which is rule 2,
  //   so a fixture without it makes every case in this file an ERROR. It carries
  //   the two halves the probe asserts -- the `GATES` export and the
  //   direct-invocation guard -- and a `ci06h` block, because `RI-24` reads that
  //   block for the pins below.
  //
  //   `.github/workflows/corpus.yml` is `RI-24`'s other half. One registered
  //   claim site is `scripts/db/assert_pgboss_schema_matches_library.mjs`, whose
  //   name matches that check's `assert_*` discovery, so materialising it put an
  //   assertion on disk that no workflow ran. The real repository runs and pins
  //   it; the fixture now does too.
  write(
    root,
    'scripts/corpus/gates.mjs',
    'const REQUIRED = 1;\n' +
      "const ci06h = {\n  id: 'CI-06h',\n" +
      "  run: () => ['assert_pgboss_schema_matches_library.mjs', REQUIRED],\n};\n" +
      'export const GATES = [ci06h];\n' +
      'const main = () => 0;\n' +
      'const invokedDirectly = false;\n' +
      'if (invokedDirectly) process.exit(main());\n',
  );
  write(
    root,
    '.github/workflows/corpus.yml',
    'jobs:\n  corpus:\n    steps:\n' +
      '      - run: node scripts/db/assert_pgboss_schema_matches_library.mjs\n',
  );

  /** Every registered claim, grouped by the site that carries it. */
  const bySite = new Map<string, string[]>();
  for (const claim of ABSENCE_CLAIMS) {
    const seen = bySite.get(claim.site) ?? [];
    seen.push(claim.claim);
    bySite.set(claim.site, seen);
  }
  // APPENDED AND NEVER WRITTEN. `packages/db/src/scoped-db.ts` already carries
  // RI-16's citation fixture, and overwriting it would be one check's fixture
  // quietly deleting another's -- which is the note above `appendTo`'s use for
  // API_CONTRACT.md, arriving a second time.
  for (const [site, claims] of bySite) {
    mkdirSync(join(root, site, '..'), { recursive: true });
    appendTo(root, site, `${claims.map((claim) => `// ${claim}`).join('\n')}\n`);
  }
}

const check = (id: string) => {
  const found = CHECKS.find((c) => c.id === id);
  if (!found) throw new Error(`no such check: ${id}`);
  return found;
};

const findings = (id: string, root: string): string[] => check(id).run(root);

// -----------------------------------------------------------------------------
// The clean direction, both trees
// -----------------------------------------------------------------------------
describe('clean tree: every invariant holds', () => {
  test.each(CHECKS.map((c) => [c.id, c.title] as const))('%s %s', (id) => {
    expect(findings(id, REPO_ROOT)).toEqual([]);
  });

  test('the synthetic fixture itself satisfies every invariant', () => {
    const root = cleanTree();
    for (const c of CHECKS)
      expect({ id: c.id, findings: c.run(root) }).toEqual({ id: c.id, findings: [] });
  });
});

// -----------------------------------------------------------------------------
// The dirty direction, one seeded violation per invariant
// -----------------------------------------------------------------------------
describe('seeded tree: each invariant fails on the violation it names', () => {
  // RI-06 EXISTS FOR A RULE WHOSE GLOB MATCHES NOTHING, so both directions are
  // seeded. An unplugged rule and an armed one produce byte-identical lint
  // output when there are no files for the rule to have an opinion about, and
  // that is precisely `merit/no-calendar-in-expiry-path`'s situation until P2.
  test('RI-06 catches a plugin rule that eslint.config.js attaches to nothing', () => {
    const root = cleanTree();
    write(
      root,
      'packages/eslint-plugin-merit/index.js',
      "const plugin = { rules: {\n  'engine-purity': enginePurity,\n  'no-calendar-in-expiry-path': noCalendarInExpiryPath,\n} };\n",
    );
    expect(findings('RI-06', root).join('\n')).toContain('attaches it to nothing');
  });

  test('RI-06 catches a config attaching a rule the plugin does not register', () => {
    const root = cleanTree();
    write(
      root,
      'eslint.config.js',
      "export default [{ rules: { 'merit/no-such-rule': 'error' } }];\n",
    );
    expect(findings('RI-06', root).join('\n')).toContain('does not register');
  });

  test('RI-01 catches a workspace dependency added to the engine', () => {
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/package.json',
      JSON.stringify({ name: '@merit/rules-engine', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    expect(findings('RI-01', root).join('\n')).toContain(
      'dependencies.@merit/db is a `workspace:` specifier',
    );
  });

  test('RI-01 catches a workspace package imported without the workspace: protocol', () => {
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/package.json',
      JSON.stringify({ name: '@merit/rules-engine', devDependencies: { '@merit/db': '0.0.0' } }),
    );
    expect(findings('RI-01', root).join('\n')).toContain(
      'devDependencies.@merit/db is a package in this workspace',
    );
  });

  // THE NEEDLE IS ASSEMBLED HERE TOO. RI-02 is a text scan, so a file that
  // merely NAMES one of these keys is a finding of it, comments included. The
  // alternative is an exclusion for the check's own test, which is a hole in
  // the least visible possible place, so nothing in this file spells one out.
  test.each(COVERAGE_NEEDLES.map(([re, tool]) => [tool, re] as const))(
    'RI-02 catches %s',
    (tool, re) => {
      const root = cleanTree();
      // The seeded spelling is DERIVED FROM THE NEEDLE rather than retyped, so
      // a case cannot drift away from the pattern it is testing. Two
      // transforms make the pattern into literal text: drop the escaping
      // backslashes, and turn the one whitespace class into the whitespace it
      // stands for. A needle whose source does not survive that will fail this
      // case loudly, which is the direction it should fail in.
      const spelling = re.source.replaceAll('\\', '').replace('s*:', ': 80');
      write(root, 'vitest.config.ts', `export default { test: { coverage: { ${spelling} } } };\n`);
      expect(findings('RI-02', root)).toContain(`vitest.config.ts: reads as ${tool}`);
    },
  );

  test('RI-02 catches a coverage-gate config file existing at all', () => {
    const root = cleanTree();
    write(root, '.nycrc', '{}\n');
    expect(findings('RI-02', root).join('\n')).toContain(
      '.nycrc: a coverage-gate config file exists',
    );
  });

  test('RI-03 catches a vitest.workspace.ts, which Vitest 4 silently ignores', () => {
    const root = cleanTree();
    write(root, 'vitest.workspace.ts', 'export default [];\n');
    expect(findings('RI-03', root).join('\n')).toContain(
      'vitest.workspace.ts exists and Vitest 4 ignores it',
    );
  });

  test('RI-03 catches the golden stage being folded into another project', () => {
    const root = cleanTree();
    write(
      root,
      'vitest.config.ts',
      "{ test: { name: 'unit' } }\n{ test: { name: 'integration' } }\n",
    );
    const out = findings('RI-03', root).join('\n');
    expect(out).toContain("no project named 'golden'");
    expect(out).toContain("no project named 'property'");
  });

  test('RI-04 catches admin being folded into another deployable', () => {
    const root = cleanTree();
    rmSync(join(root, 'apps/admin'), { recursive: true });
    expect(findings('RI-04', root).join('\n')).toContain(
      'apps/admin/package.json does not exist: admin is not a separate deployable',
    );
  });

  test('RI-04 catches one app depending on another', () => {
    const root = cleanTree();
    write(
      root,
      'apps/portal/package.json',
      JSON.stringify({ name: '@merit/portal', dependencies: { '@merit/admin': 'workspace:*' } }),
    );
    expect(findings('RI-04', root).join('\n')).toContain('makes apps/portal depend on apps/admin');
  });

  test('RI-05 catches a workflow pinning the Node version inline', () => {
    const root = cleanTree();
    write(root, '.github/workflows/ci.yml', 'jobs:\n  x:\n    steps:\n      - node-version: 20\n');
    expect(findings('RI-05', root).join('\n')).toContain('pins the Node version inline');
  });

  test('RI-05 catches a second Node version hiding in engines', () => {
    const root = cleanTree();
    write(root, 'package.json', JSON.stringify({ name: 'merit', engines: { node: '>=20' } }));
    expect(findings('RI-05', root).join('\n')).toContain('engines.node is ">=20"');
  });

  // ---------------------------------------------------------------------------
  // RI-07, AND THE FIRST CASE IS THE ONE THAT JUSTIFIES THE CHECK EXISTING
  // ---------------------------------------------------------------------------
  // The others are defence in depth. The escape-hatch case is the one no other
  // mechanism in this repository can produce a finding for: the specifier is
  // RELATIVE, so `merit/engine-purity` returns early on it, and the file it
  // reaches is outside that rule's glob, so nothing lints the file either.
  test('RI-07 catches a relative import that escapes packages/rules-engine/src', () => {
    const root = cleanTree();
    write(root, 'packages/rules-engine/impure/io.ts', 'export const x = 1;\n');
    write(
      root,
      'packages/rules-engine/src/index.ts',
      "export { floorAt } from './floor.ts';\nexport { x } from '../impure/io.ts';\n",
    );
    const out = findings('RI-07', root).join('\n');
    expect(out).toContain('OUTSIDE');
    expect(out).toContain('packages/rules-engine/impure/io.ts');
  });

  test('RI-07 catches a Node builtin reached TRANSITIVELY, and names the trail', () => {
    // Two hops from the entry point, which is the whole difference between this
    // check and a per-file lint rule. The trail is asserted because a finding
    // that says "somewhere in the engine" is a finding somebody has to
    // reproduce before they can act on it.
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/floor.ts',
      "import { readFileSync } from 'node:fs';\nexport const floorAt = (): string => readFileSync('x', 'utf8');\n",
    );
    const out = findings('RI-07', root).join('\n');
    expect(out).toContain('node:fs');
    expect(out).toContain('Reached by: packages/rules-engine/src/index.ts');
  });

  test('RI-07 catches a bare specifier that is not a builtin', () => {
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/floor.ts',
      "import Decimal from 'decimal.js';\nexport const floorAt = (n: number): number => new Decimal(n).toNumber();\n",
    );
    const out = findings('RI-07', root).join('\n');
    expect(out).toContain('decimal.js');
    expect(out).toContain('neither relative nor a Node builtin');
  });

  test('RI-07 reports a relative import that resolves to nothing rather than skipping it', () => {
    // The direction matters. A walk that silently skipped what it could not
    // resolve would report PASS for a subgraph it never read, which is rule 1
    // of this runner: never weaken a check to pass it.
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/index.ts',
      "export { floorAt } from './floor.ts';\nexport { gone } from './not-here.ts';\n",
    );
    expect(findings('RI-07', root).join('\n')).toContain('resolves to no file on disk');
  });

  test('RI-07 does not report a specifier that appears only inside a comment', () => {
    // These files carry more prose than code and their headers quote real
    // import lines while explaining them. A check that read those as imports
    // would fail on the tree it is meant to protect, so the clean direction
    // needs this stated as its own case rather than left to the whole-repo run.
    const root = cleanTree();
    write(
      root,
      'packages/rules-engine/src/floor.ts',
      "// This module must never `import { readFileSync } from 'node:fs'`.\n" +
        "/* Nor `import Decimal from 'decimal.js'`, for INV-02's reason. */\n" +
        'export const floorAt = (n: number): number => n;\n',
    );
    expect(findings('RI-07', root)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // RI-08, AND THE SEED IS ADR-096's OWN, WATCHED FAILING HERE AND ON THE TREE
  // ---------------------------------------------------------------------------
  // The entry measured the hole with a line it wrote into `apps/site/package.json`
  // and four commands that stayed green over it. The first case is that line.
  //
  // The three after it are the three readings of "resolves to the accessor",
  // because `spec.includes('@merit/db')` was the shape to beat: it reports
  // `@merit/dbtools` and it cannot see `link:../../packages/db`, where neither
  // the key nor the specifier writes the name down at all.
  //
  // THE `packages/queue` CASE IS THE WIDENED SCOPE, PROVEN RATHER THAN CLAIMED.
  // ADR-096 section 9 calls it "the second instance" and says an RI-08 covering
  // both is the better version; ADR-095 section 9 item 5b says the apps/site-only
  // scope does not reach `apps/portal` either. A check scoped to two names would
  // pass this case, which is what makes it worth a test rather than a sentence.
  const siteWith = (root: string, deps: Record<string, string>): void =>
    write(
      root,
      'apps/site/package.json',
      JSON.stringify({ name: '@merit/site', dependencies: deps }),
    );

  test("RI-08 catches ADR-096's own seed, the accessor declared by the marketing site", () => {
    const root = cleanTree();
    siteWith(root, { '@merit/db': 'workspace:*' });
    const out = findings('RI-08', root).join('\n');
    expect(out).toContain('apps/site/package.json: dependencies.@merit/db');
    expect(out).toContain('names it directly');
  });

  test('RI-08 catches the accessor aliased under another key', () => {
    const root = cleanTree();
    siteWith(root, { db: 'workspace:@merit/db@*' });
    expect(findings('RI-08', root).join('\n')).toContain('aliases it as `db`');
  });

  test('RI-08 catches the accessor linked by PATH, which writes no package name', () => {
    // The one form where neither the key nor the specifier spells `@merit/db`,
    // so a name test of any kind is blind to it and only resolution finds it.
    const root = cleanTree();
    siteWith(root, { db: 'link:../../packages/db' });
    expect(findings('RI-08', root).join('\n')).toContain('links its directory as `db`');
  });

  test('RI-08 reads all four dependency fields, not just `dependencies`', () => {
    const root = cleanTree();
    write(
      root,
      'apps/site/package.json',
      JSON.stringify({
        name: '@merit/site',
        devDependencies: { '@merit/db': 'workspace:*' },
        optionalDependencies: { db: 'npm:@merit/db@0.0.0' },
      }),
    );
    const out = findings('RI-08', root);
    expect(out).toHaveLength(2);
    expect(out.join('\n')).toContain('devDependencies.@merit/db');
    expect(out.join('\n')).toContain('optionalDependencies.db');
  });

  test('RI-08 catches packages/queue, which an apps/site-scoped check would not', () => {
    const root = cleanTree();
    write(
      root,
      'packages/queue/package.json',
      JSON.stringify({ name: '@merit/queue', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    expect(findings('RI-08', root).join('\n')).toContain('packages/queue/package.json');
  });

  test('RI-08 does NOT refuse a package whose name merely starts with the accessor name', () => {
    // The substring trap, and the reason the alias target is PARSED rather than
    // searched for. `@merit/dbtools` is a different package by every reading.
    const root = cleanTree();
    write(root, 'packages/dbtools/package.json', JSON.stringify({ name: '@merit/dbtools' }));
    siteWith(root, { '@merit/dbtools': 'workspace:*', '@merit/rules-engine': 'workspace:*' });
    expect(findings('RI-08', root)).toEqual([]);
  });

  test('RI-08 does NOT read the accessor package against itself', () => {
    // RI-09's `if (app === SURFACE_OWNER) continue`, one register over. The
    // owner of a thing is not a consumer of it, and the exemption is derived
    // from the name on disk rather than written down here.
    const root = cleanTree();
    write(
      root,
      'packages/db/package.json',
      JSON.stringify({ name: '@merit/db', devDependencies: { '@merit/db': 'workspace:*' } }),
    );
    expect(findings('RI-08', root)).toEqual([]);
  });

  test('RI-08 admits a package that is named in DB_ADMITTED, and only that one', () => {
    // THE BRANCH THAT WAS UNREACHABLE ON THE REAL TREE UNTIL ADR-120. `apps/api`
    // was the name ADR-109 expected to join first ("whether `apps/api` gets
    // `@merit/db` ... it does not here"), and session 232 is the slice whose
    // subject that admission is. The case is unchanged in substance: one
    // admitted package is exempt and the one beside it is still a finding, which
    // is the whole of what an admission buys.
    const root = cleanTree();
    write(
      root,
      'apps/api/package.json',
      JSON.stringify({ name: '@merit/api', dependencies: { '@merit/db': 'workspace:*' } }),
    );
    siteWith(root, { '@merit/db': 'workspace:*' });
    withDbAdmitted(['@merit/api'], () => {
      const out = findings('RI-08', root);
      expect(out).toHaveLength(1);
      expect(out.join('\n')).toContain('apps/site/package.json');
    });
  });

  // ---------------------------------------------------------------------------
  // THE SHIPPED LIST, WHICH EVERY CASE ABOVE IS BLIND TO
  // ---------------------------------------------------------------------------
  // Every seeded case runs against a synthetic tree, so all of them stay green if
  // `DB_ADMITTED` is emptied, widened, or filled with names that declare nothing.
  // The two below read the REPOSITORY, and they are the only assertions in this
  // file about the list as it ships.
  test('the shipped admission is doing work: the real tree is a finding without it', () => {
    // THE DIRECTION AN ADMISSION LIST FAILS IN IS SILENCE. With the list as it
    // ships RI-08 is clean over the whole workspace; with it emptied,
    // `apps/api/package.json` is exactly the finding ADR-117 section 4 promised
    // the manifest line would become, and ADR-120 is the second diff that
    // answered it.
    expect(findings('RI-08', REPO_ROOT)).toEqual([]);
    const out = withDbAdmitted([], () => findings('RI-08', REPO_ROOT).join('\n'));
    expect(out).toContain('apps/api/package.json: dependencies.@merit/db');
  });

  test('every admitted package really declares the accessor', () => {
    // A STALE ADMISSION IS THE SAME DEFECT AS A STALE NAME, ONE STEP LATER. The
    // check THROWS on an admission naming a package that does not exist, because
    // that reads as though the accessor is permitted somewhere it is not. An
    // admission naming a package that exists and declares nothing reads the same
    // way and throws nothing, so it is asserted here: a name earns its place by
    // being a package that actually reaches the trader database, and "we might
    // need it later" is the list joining itself.
    //
    // ASSERTED AS A PROPERTY OVER THE LIST AND NEVER AS A COPY OF IT. A second
    // spelling of `DB_ADMITTED` here would be RI-04's own defect (see
    // `cleanTree`), and six approval clauses in this corpus have drifted on an
    // enumeration while the ruling held every time.
    expect(DB_ADMITTED.length).toBeGreaterThan(0);
    const unadmitted = withDbAdmitted([], () => findings('RI-08', REPO_ROOT).join('\n'));
    for (const name of DB_ADMITTED) {
      expect(unadmitted).toContain(`${name} is not in DB_ADMITTED`);
    }
  });

  // ---------------------------------------------------------------------------
  // RI-10, AND BOTH DIRECTIONS ARE SEEDED BECAUSE BOTH HAPPENED ON 2026-08-25
  // ---------------------------------------------------------------------------
  // The first case is the defect as it lived here: 686 specifiers wrote `./x.js`
  // for files that are `x.ts`, every deployable died on its own first relative
  // import with ERR_MODULE_NOT_FOUND, and typecheck, lint, gates and the whole
  // Vitest suite were green throughout. RI-07 walked the same graph and passed,
  // because `resolveRelative` maps `.js` onto `.ts` on purpose.
  //
  // The second case is the direction the REPAIR got wrong, and it matters as
  // much: three of those 686 sites named a real `.js` file, because
  // packages/eslint-plugin-merit/index.js is genuine JavaScript. A check that
  // only looked for `.js` specifiers would have blessed the broken repair.
  test('RI-10 catches a `.js` specifier naming a file that is `.ts`', () => {
    const root = cleanTree();
    write(root, 'packages/db/src/thing.ts', 'export const thing = 1;\n');
    write(
      root,
      'packages/db/src/uses-it.ts',
      "import { thing } from './thing.js';\nexport { thing };\n",
    );
    const out = findings('RI-10', root).join('\n');
    expect(out).toContain('packages/db/src/uses-it.ts');
    expect(out).toContain('`./thing.js` names no file');
    expect(out).toContain('packages/db/src/thing.ts is what is there');
  });

  test('RI-10 catches the reverse: a `.ts` specifier naming a file that is genuinely `.js`', () => {
    const root = cleanTree();
    write(root, 'packages/db/src/legacy.js', 'export const legacy = 1;\n');
    write(
      root,
      'packages/db/src/uses-legacy.ts',
      "import { legacy } from './legacy.ts';\nexport { legacy };\n",
    );
    const out = findings('RI-10', root).join('\n');
    expect(out).toContain('packages/db/src/uses-legacy.ts');
    expect(out).toContain('`./legacy.ts` names no file');
  });

  test('RI-10 does NOT refuse a bare specifier, which resolves through package exports', () => {
    const root = cleanTree();
    write(root, 'packages/db/src/bare.ts', "import { z } from 'drizzle-orm';\nexport { z };\n");
    expect(findings('RI-10', root)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // RI-10's SCOPE, AND THE WIDENING IS SEEDED BECAUSE THE `src/` LINE WAS BLIND
  // ---------------------------------------------------------------------------
  // ADR-121. `scripts/` joined the scope after the `src/` line let 19 broken
  // specifiers sit in `scripts/demo/` while every gate in the repository stayed
  // green, `node --experimental-strip-types scripts/demo/main.ts` died with
  // ERR_MODULE_NOT_FOUND, and nightly.yml ran the directory anyway.
  //
  // THE FIRST CASE IS THE SEEDED VIOLATION and it is the whole point: without
  // the widening it returns nothing, which is the state this ADR ended.
  //
  // THE SECOND IS THE NEAR MISS THAT MUST NOT FIRE, and it matters as much. The
  // test ruling survives the widening: `scripts/demo/test/` holds Vitest suites,
  // Vitest resolves the tolerant way, and a `.js` specifier there is not a
  // runtime defect. A widening that swallowed the ruling would be a different
  // check wearing this one's name.
  //
  // THE THIRD IS THE OTHER DIRECTION UNDER THE NEW SCOPE: a specifier naming a
  // real `.js` file in `scripts/` passes, because the file is there. Session
  // 148's blanket rewrite broke `packages/eslint-plugin-merit/index.js` and this
  // is that lesson pointed at the directory that just joined.
  test('RI-10 reaches scripts/, which the `src/` scope could not see', () => {
    const root = cleanTree();
    write(root, 'scripts/demo/thing.ts', 'export const thing = 1;\n');
    write(root, 'scripts/demo/main.ts', "import { thing } from './thing.js';\nexport { thing };\n");
    const out = findings('RI-10', root).join('\n');
    expect(out).toContain('scripts/demo/main.ts');
    expect(out).toContain('`./thing.js` names no file');
    expect(out).toContain('scripts/demo/thing.ts is what is there');
  });

  test('RI-10 still exempts tests after the widening, including under scripts/', () => {
    const root = cleanTree();
    write(root, 'scripts/demo/thing.ts', 'export const thing = 1;\n');
    write(
      root,
      'scripts/demo/test/thing.test.ts',
      "import { thing } from '../thing.js';\nexport { thing };\n",
    );
    expect(findings('RI-10', root)).toEqual([]);
  });

  test('RI-10 does NOT refuse a scripts/ specifier naming a file that is genuinely `.js`', () => {
    const root = cleanTree();
    write(root, 'scripts/demo/hook.js', 'export const hook = 1;\n');
    write(
      root,
      'scripts/demo/uses-hook.ts',
      "import { hook } from './hook.js';\nexport { hook };\n",
    );
    expect(findings('RI-10', root)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // RI-09, AND THE FIRST TWO CASES ARE THE RULING (ADR-098) STATED AS A TEST
  // ---------------------------------------------------------------------------
  // ADR-095's approval clause is a path and four green commands: seed
  // `apps/portal/src/app/api/v1/admin/payouts/route.ts` and nothing in the
  // estate refuses it. The first case is that exact path and demands a finding.
  // The second is the direction a check written carelessly gets wrong, and it
  // matters more: `apps/api` OWNS this surface, so a route there must pass. A
  // check that refused both would be unusable the day P4-d writes the first
  // handler, and nobody would find that out until then.
  test("RI-09 catches ADR-095's own seed, an operator route inside a UI deployable", () => {
    const root = cleanTree();
    write(
      root,
      'apps/portal/src/app/api/v1/admin/payouts/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    const out = findings('RI-09', root).join('\n');
    expect(out).toContain('apps/portal/src/app/api/v1/admin/payouts/route.ts');
    expect(out).toContain('spells `/api/v1/admin` inside apps/portal');
  });

  test('RI-09 does NOT refuse the same route under the deployable that owns the surface', () => {
    const root = cleanTree();
    write(
      root,
      `apps/${SURFACE_OWNER}/src/app/api/v1/admin/payouts/route.ts`,
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    write(
      root,
      `apps/${SURFACE_OWNER}/src/routes/admin/payouts.ts`,
      'export const payouts = (): string => "ok";\n',
    );
    expect(findings('RI-09', root)).toEqual([]);
  });

  test('RI-09 does NOT refuse an api directory that is not below a routing root', () => {
    // `apps/portal/src/api/types.ts` EXISTS ON MAIN and is the portal's
    // TRANSCRIPTION of the wire types -- ADR-083 section 3 cites it as evidence
    // the portal is on the far side of the boundary, so a check that refused it
    // would refuse the thing the ruling holds up as correct. It is `src/api`,
    // not `app/api`, and the difference is exactly the framework's.
    const root = cleanTree();
    write(root, 'apps/portal/src/api/types.ts', 'export type Money = { cents: number };\n');
    expect(findings('RI-09', root)).toEqual([]);
  });

  test('RI-09 catches an operator route that does not carry the base path', () => {
    // App Router serves `app/internal/jobs/route.ts` at `/internal/jobs`. The
    // base-path shape cannot see this one, which is why there is more than one.
    const root = cleanTree();
    write(
      root,
      'apps/site/src/app/internal/jobs/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    expect(findings('RI-09', root).join('\n')).toContain(
      'puts `internal` directly below the routing root `app` in apps/site',
    );
  });

  test('RI-09 sees through a route group, which the URL does not carry', () => {
    // `(ops)` is invisible in the URL, so a naive "the segment under the
    // routing root" test reads `(ops)` and finds nothing. Skipping it makes the
    // check catch MORE, which is the only direction a skip may run in here.
    const root = cleanTree();
    write(
      root,
      'apps/site/src/app/(ops)/admin/payouts/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    expect(findings('RI-09', root).join('\n')).toContain('`admin` directly below the routing root');
  });

  test('RI-09 catches a Pages Router api directory with no version segment', () => {
    const root = cleanTree();
    write(root, 'apps/portal/src/pages/api/hello.ts', 'export default (): null => null;\n');
    expect(findings('RI-09', root).join('\n')).toContain(
      'an API surface inside a UI deployable by',
    );
  });

  test("RI-09 reads the tree's OWN operator prefixes rather than a copy of them", () => {
    // THE CASE THAT PROVES THE TWO LISTS ARE ONE LIST. A third prefix in
    // surface.ts must move the check without an edit here; if this file held
    // its own `['/admin', '/internal']`, the two would drift silently and the
    // drift is the entire failure mode RI-09 exists inside.
    const root = cleanTree();
    write(
      root,
      `apps/${SURFACE_OWNER}/src/surface.ts`,
      "export const BASE_PATH = '/api/v1';\n" +
        "export const OPERATOR_PREFIXES = ['/admin', '/internal', '/ops'] as const;\n",
    );
    write(
      root,
      'apps/portal/src/app/ops/route.ts',
      'export function GET(): Response { return new Response("{}"); }\n',
    );
    expect(findings('RI-09', root).join('\n')).toContain('`/ops` is an OPERATOR_PREFIXES entry');
  });

  // ---------------------------------------------------------------------------
  // RI-14, seeded with THE ACTUAL SENTENCE, in both directions
  // ---------------------------------------------------------------------------
  // The seed is not invented. It is the reason `apps/api/test/wiring.test.ts`
  // carried on 2026-08-28, beside the export that refuted it, which is the state
  // the file was actually in while every gate reported green. A check watched
  // failing on a fabricated shape proves it recognises the shape; watched failing
  // on the sentence that got through proves it would have caught the thing.
  //
  // BOTH DIRECTIONS ON THE SAME FILE, for RI-13's reason: a case that only ever
  // plants a violation cannot tell a check that reads the refuted-marker from one
  // that fails every absence claim it sees.
  // BOTH exports, because the real tree has both and the distinction is the whole
  // reason this check cannot tell a type from its implementation: `IdempotencyStore`
  // is the interface in `idempotency.ts` and `databaseIdempotencyStore` is the
  // implementation in `idempotency-store.ts`. The false reason denied the second by
  // naming the first, and it is the first that a runner can look up.
  const STORE_EXPORT =
    'export interface IdempotencyStore { readonly find: () => void }\n' +
    'export function databaseIdempotencyStore(): IdempotencyStore {\n' +
    '  return null as never;\n' +
    '}\n';

  const FALSE_REASON =
    'const BLOCKED = {\n' +
    '  useWithdrawalBackend:\n' +
    "    'an `IdempotencyStore` implementation, which no file in this tree provides. ' +\n" +
    "    'The adapter returns UNWIRED_STORE for that arm deliberately.',\n" +
    '};\n';

  test('RI-14 catches the reason that actually got through, beside the export refuting it', () => {
    const root = cleanTree();
    write(root, 'apps/api/src/idempotency-store.ts', STORE_EXPORT);
    write(root, 'apps/api/test/wiring.test.ts', FALSE_REASON);
    expect(findings('RI-14', root).join('\n')).toContain(
      'the reason claims `IdempotencyStore` does not exist and the tree EXPORTS it',
    );
  });

  test('RI-14 goes quiet on the SAME file once the claim is marked as refuted', () => {
    // THE DIRECTION THE CHECK MUST NOT PUSH. The corrected file deliberately
    // QUOTES the false sentence rather than deleting it, because a false sentence
    // deleted leaves nothing for the next reader to check. If this case failed,
    // the check would be pressuring every correction into a deletion.
    const root = cleanTree();
    write(root, 'apps/api/src/idempotency-store.ts', STORE_EXPORT);
    write(
      root,
      'apps/api/test/wiring.test.ts',
      '// THE REASON THAT STOOD HERE WAS FALSE AND IS REPLACED RATHER THAN DELETED.\n' +
        '// It read: no implementation of `IdempotencyStore` exists in this tree.\n' +
        '// `databaseIdempotencyStore` has exported it since ADR-112.\n' +
        FALSE_REASON.replace('which no file in this tree provides', 'no driver for its edges'),
    );
    expect(findings('RI-14', root)).toEqual([]);
  });

  test('RI-14 does not fire on a thing that exists and cannot be CONSTRUCTED', () => {
    // ADR-172's finding 1 was TRUE: `usePayoutBackend` cannot be constructed at
    // all, because `PayoutTx.ledger` is a non-nullable `LedgerTx` no live door
    // satisfies. A check that failed that reason would be wrong, and it is the
    // nearest true claim to the false one, which is why it is asserted here.
    const root = cleanTree();
    write(root, 'apps/api/src/payouts.ts', 'export interface PayoutTx { readonly x: number }\n');
    write(
      root,
      'apps/api/test/wiring.test.ts',
      'const BLOCKED = {\n' +
        '  usePayoutBackend:\n' +
        "    'a door satisfying `PayoutTx`. It is declared and NO LIVE DEPLOYMENT CAN ' +\n" +
        "    'CONSTRUCT ONE, which is a fact about its ledger arm and not about its absence.',\n" +
        '};\n',
    );
    expect(findings('RI-14', root)).toEqual([]);
  });

  test('RI-14 reads a SHOUTED claim, which the first draft of it did not', () => {
    // THE GAP THAT WAS REAL. The first version of this check was case-sensitive
    // and a claim reading "No implementation of `IdempotencyStore` exists in this
    // tree" walked straight past it. This codebase shouts in its comments as a
    // house style, and the emphatic half is exactly where somebody states a claim
    // they are sure of, so a case-sensitive matcher reads the quiet half and skips
    // the half that matters.
    const root = cleanTree();
    write(root, 'apps/api/src/idempotency-store.ts', STORE_EXPORT);
    write(
      root,
      'apps/api/test/wiring.test.ts',
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'NO IMPLEMENTATION OF `IdempotencyStore` EXISTS IN THIS TREE.',\n" +
        '};\n',
    );
    expect(findings('RI-14', root).join('\n')).toContain(
      'the reason claims `IdempotencyStore` does not exist',
    );
  });

  test('RI-14 fails loudly when the file it reads is renamed away', () => {
    // A check that names the files it reads is emptied by a rename, silently, and
    // then reports PASS forever. This is that failure made loud.
    const root = cleanTree();
    rmSync(join(root, 'apps/api/test/wiring.test.ts'));
    expect(findings('RI-14', root).join('\n')).toContain(
      'apps/api/test/wiring.test.ts does not exist',
    );
  });

  // ---------------------------------------------------------------------------
  // RI-15, seeded with THE ACTUAL POINTERS, in both directions
  // ---------------------------------------------------------------------------
  // The seeds are not invented. They are the four line citations
  // `apps/api/test/wiring.test.ts` carried on 2026-08-28, checked one by one
  // against the files they name and found to point at the wrong line. THE CLAIMS
  // HELD AT THEIR REAL LINES AND THE POINTERS DID NOT, which is why nothing
  // failed and why a reader who followed one concluded the reason was invented.
  //
  // All four were also restored into the REAL FILE on the real tree while this
  // check was written: three fire, at four sites, and the tree was restored byte
  // for byte after. The cases below are the same seeds against the synthetic
  // fixture, which is what makes them fast and their targets legible.

  /**
   * The file these cases write their reason into.
   *
   * NOT `wiring.test.ts` AND NOT `detectors/fills.ts` ANY MORE, and the reason
   * is the input set itself: RI-15 reads every source file this tree holds, so
   * a seed needs no particular one, and the files the REGISTER's eight entries
   * depend on then stay intact under every case below. A case that overwrote one
   * of them would turn the register's shrinks-only guard red for a reason that
   * has nothing to do with what the case is about.
   */
  const REASON = 'apps/api/src/reasons.ts';

  /** A file of `n` lines carrying `name` on line `at`, one-based. */
  const fileWithNameAt = (n: number, at: number, name: string): string =>
    Array.from({ length: n }, (_, i) =>
      i + 1 === at ? `export function ${name}(): void {}` : '//',
    )
      .join('\n')
      .concat('\n');

  test('RI-15 catches the pointer that was eighteen lines off, in the reason that replaced a false one', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'both statuses are in `OPEN_WITHDRAWAL_STATUSES`, so `gateNoInFlight` ' +\n" +
        "    '(`routes/wallet-withdrawals.ts:1233`) would refuse that identity every later withdrawal.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/wallet-withdrawals.ts:1233` for `gateNoInFlight` and `gateNoInFlight` is at ' +
        'apps/api/src/routes/wallet-withdrawals.ts:1254, 21 lines away',
    );
  });

  test('RI-15 goes quiet on the SAME entry once the pointer is corrected', () => {
    // THE DIRECTION THAT MATTERS AS MUCH AS THE OTHER. A case that only ever
    // plants a violation cannot tell a check that resolves a pointer from one
    // that fails every pointer it sees, and this check reads 57 citations in
    // `wiring.test.ts` alone.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'both statuses are in `OPEN_WITHDRAWAL_STATUSES`, so `gateNoInFlight` ' +\n" +
        "    '(`routes/wallet-withdrawals.ts:1254`) would refuse that identity every later withdrawal.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root)).toEqual([]);
  });

  test('RI-15 reads a bare `:12` against the path cited above it', () => {
    // The corrected file writes the path once and continues with bare pointers,
    // and the defect this check exists for was written in that shape. A check
    // that skipped them would pass the thing it was written for.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  useWithdrawalBackend:\n' +
        "    'NOTHING drives `requested --> approved` (`routes/wallet-withdrawals.ts:57-60`), ' +\n" +
        "    'and so `gateNoInFlight` ' +\n" +
        "    '(`:1233`) would refuse that identity.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/wallet-withdrawals.ts:1233`',
    );
  });

  test('RI-15 stays armed after a backtick used as an APOSTROPHE, which its first draft did not', () => {
    // THE BUG THAT WAS REAL, AND IT WAS SILENT. The first version paired
    // backticks from the start of the file. `wiring.test.ts:215` writes "the
    // engine`s own `RuleState`", using a backtick as an apostrophe, and ONE
    // stray backtick inverts every pairing after it: the check found no name
    // beside any of the three seeded pointers below it and reported PASS. A
    // check that cannot fail, hiding inside a check that can.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        '  usePayoutBackend:\n' +
        "    'whose `state` is the engine`s own `RuleState`.',\n" +
        '  useWithdrawalBackend:\n' +
        "    'so `gateNoInFlight` (`routes/wallet-withdrawals.ts:1233`) would refuse.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `gateNoInFlight`');
  });

  test('RI-15 reads a SHOUTED name, for the reason RI-14 reads a shouted claim', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1400, 1254, 'gateNoInFlight'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        "  useWithdrawalBackend: 'AND `GATENOINFLIGHT` (`routes/wallet-withdrawals.ts:1233`) REFUSES.',\n" +
        '};\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `GATENOINFLIGHT`');
  });

  test('RI-15 catches a path no file in this tree has', () => {
    const root = cleanTree();
    write(
      root,
      REASON,
      "const BLOCKED = { useRailBackend: 'the adapter (`routes/rail-vendor.ts:12`) is not shipped.' };\n",
    );
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/rail-vendor.ts:12` and NO FILE IN THIS TREE has that path',
    );
  });

  test('RI-15 catches a pointer past the end of the file it names', () => {
    const root = cleanTree();
    write(
      root,
      REASON,
      "const BLOCKED = { useStore: 'the store (`src/idempotency-store.ts:900`) exists.' };\n",
    );
    expect(findings('RI-15', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-15 does not fire on a NEGATED claim, whose cited line must NOT hold the name', () => {
    // "`fills` HAS NO `identity_id` (`schema.ts:3005`)" cites the line the table
    // is DECLARED on, and the name must be absent from it. Asserting the inverse
    // is a second check and the existence half of it is RI-14's. This is the
    // shape that put three false findings on `detectors/fills.ts` before the
    // rule was written, and it is one of the two that keep this check quiet.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(
      root,
      REASON,
      '// The identity edge is on the `accounts` row below, because `fills` HAS NO\n' +
        '// `identity_id` (`packages/db/src/schema.ts:20`), and a canary carrying a\n' +
        '// column the table does not have is one a detector could find.\n',
    );
    expect(findings('RI-15', root)).toEqual([]);

    // AND THE SAME SENTENCE WITHOUT THE NEGATION FIRES, which is what keeps this
    // case from passing for some other reason. A quiet rule asserted only in the
    // quiet direction is indistinguishable from a binding that never happened.
    write(
      root,
      REASON,
      '// The identity edge is on the `accounts` row below, because `fills` carries\n' +
        '// `identity_id` (`packages/db/src/schema.ts:20`), and a canary carrying a\n' +
        '// column the table does not have is one a detector could find.\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `identity_id`');
  });

  test('RI-15 does not fire on a POSSESSIVE, which names a thing the pointer is not about', () => {
    // "`realized_pnl_cents` is `daily_marks`' (`schema.ts:652`)" cites the COLUMN
    // and names the TABLE. An apostrophe is not glue, so the binding is dropped
    // rather than guessed, and the citation is checked for resolution and range.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'realizedPnlCents'));
    write(
      root,
      REASON,
      "// `realized_pnl_cents` is `daily_marks`' (`packages/db/src/schema.ts:20`).\n",
    );
    expect(findings('RI-15', root)).toEqual([]);

    // AND THE SAME SENTENCE WITHOUT THE APOSTROPHE FIRES, for the reason above.
    write(
      root,
      REASON,
      '// `realized_pnl_cents` is on `daily_marks` (`packages/db/src/schema.ts:20`).\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `daily_marks`');
  });

  test('RI-15 says nothing about a citation with NO name beside it, which is its stated miss', () => {
    // THE HOLE, ASSERTED RATHER THAN LEFT TO BE DISCOVERED. This is the fourth
    // of the four false citations of 2026-08-28: `:1506` was a `.send({` and the
    // identity arm was at `:1527`, and the sentence carrying it says "the
    // identity arm this route presents", which names nothing a runner can look
    // up. The check is silent here and its `covers` says so.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/wallet-withdrawals.ts',
      fileWithNameAt(1600, 1527, 'identityScope'),
    );
    write(
      root,
      REASON,
      'const BLOCKED = {\n' +
        "  useWithdrawalBackend: 'it serves the identity arm this route presents " +
        "(`routes/wallet-withdrawals.ts:1506`).',\n" +
        '};\n',
    );
    expect(findings('RI-15', root)).toEqual([]);
  });

  test('RI-15 admits a pointer ON the declaration, refuses one two lines off it, and catches one three lines off', () => {
    // THE WINDOW AT ITS TWO BOUNDARIES, AND THE ANCHOR BETWEEN THEM. The widest
    // TRUE citation measured in this corpus is one line off and the narrowest
    // FALSE one on record is three (`admin-writes.ts:266` for a declaration at
    // `:269`), so a case that only asserted the catch could not tell this window
    // from one of zero.
    //
    // THE MIDDLE TRANSITION IS ADR-212 AND IT USED TO BE SILENT. `:267` is a
    // filler line two above the declaration: the window admits it, and the
    // anchor asks the question the window cannot -- is the cited line part of
    // anything this sentence names -- and gets no for an answer. The next case
    // shows the same distance passing when the answer is yes.
    const root = cleanTree();
    write(root, 'apps/api/src/routes/admin-writes.ts', fileWithNameAt(300, 269, 'principal'));
    const reason = (line: number): string =>
      'const BLOCKED = {\n' +
      `  useAdminWriteBackend: '\`principal(request)\` (\`routes/admin-writes.ts:${line}\`).',\n` +
      '};\n';

    write(root, REASON, reason(269));
    expect(findings('RI-15', root)).toEqual([]);

    write(root, REASON, reason(267));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/admin-writes.ts:267` for `principal`, and `principal` is within 2 line(s) ' +
        'of it WITHOUT THE CITED LINE BEING PART OF ANYTHING THIS SENTENCE NAMES',
    );

    write(root, REASON, reason(266));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `routes/admin-writes.ts:266` for `principal` and `principal` is at ' +
        'apps/api/src/routes/admin-writes.ts:269, 3 lines away',
    );
  });

  // ---------------------------------------------------------------------------
  // ADR-212: what a citation PROVES
  // ---------------------------------------------------------------------------
  // THE SEEDS ARE THE REGISTRY SHAPE SESSION 399 MEASURED THE DEFECT IN, reduced
  // to two entries. `packages/db/src/scope.ts` carries 112 of them, `owned` sits
  // on 72 lines and `firm` on 107, and that is the entire mechanism: the reader
  // binds the NEAREST backticked token, the nearest token is the CLASS, and a
  // window around any entry's class line is satisfied by every other entry's.
  //
  // A CASE THAT ONLY PLANTED THE VIOLATION COULD NOT TELL THE ANCHOR FROM A
  // CHECK THAT REFUSES EVERY REGISTRY CITATION, so each one below runs in both
  // directions on ONE fixture: the right entry is silent and the wrong entry
  // fires, with the coincidental token on the cited line in BOTH.

  /** A file this case owns, so no case here overwrites a register input. */
  const REGISTRY = 'packages/db/src/registry.ts';

  /** Two registry entries of the same class, which is what makes the token cheap. */
  const registry = [
    'export const SCOPE_RULES = {',
    '  certificates: {',
    "    class: 'owned',",
    "    column: 'identity_id',",
    '  },',
    '',
    '  payoutRequests: {',
    "    class: 'owned',",
    "    column: 'identity_id',",
    '  },',
    '};',
  ]
    .join('\n')
    .concat('\n');

  test('RI-15 separates the right registry entry from the wrong one, with the same token on both lines', () => {
    const root = cleanTree();
    write(root, REGISTRY, registry);
    const reason = (line: number): string =>
      'const BLOCKED = {\n' +
      `  usePayoutBackend: '\`payoutRequests\` is \`owned\` (\`registry.ts:${line}\`).',\n` +
      '};\n';

    // `:8` IS `payoutRequests`' OWN CLASS LINE. Anchored by the enclosing
    // declaration, which the sentence names.
    write(root, REASON, reason(8));
    expect(findings('RI-15', root)).toEqual([]);

    // `:3` IS `certificates`' CLASS LINE, and it holds the word `owned` too.
    // THE OLD CHECK WAS SILENT HERE: the name is on the cited line, distance
    // zero, and it points at a rule about a different table.
    write(root, REASON, reason(3));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `registry.ts:3` for `owned`, and `owned` is within 2 line(s) of it WITHOUT THE ' +
        'CITED LINE BEING PART OF ANYTHING THIS SENTENCE NAMES. The line neither declares ' +
        '`owned` nor sits inside `certificates`',
    );
  });

  test('RI-15 catches a pointer that lands on a blank line or a bare closing bracket, with no name at all', () => {
    // THE HALF THAT NEEDS NO NAME, and three of the five wrong `scope.ts`
    // pointers on `origin/main` were this shape: `:1307` and `:911` are both
    // `},`, the close of some other entry. A pointer that lands on nothing reads
    // as verified exactly as loudly as one that lands on the claim.
    const root = cleanTree();
    write(root, REGISTRY, registry);
    const reason = (line: number): string =>
      'const BLOCKED = {\n' +
      `  usePayoutBackend: 'the registry states it at \`registry.ts:${line}\`.',\n` +
      '};\n';

    // A LINE THAT CARRIES A CLAIM, cited by a sentence that binds no name: the
    // stated miss, and it stays silent.
    write(root, REASON, reason(3));
    expect(findings('RI-15', root)).toEqual([]);

    write(root, REASON, reason(5));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `registry.ts:5` and that line is BLANK OR A BARE CLOSING BRACKET',
    );

    write(root, REASON, reason(6));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `registry.ts:6` and that line is BLANK OR A BARE CLOSING BRACKET',
    );
  });

  test('RI-15 reads a comma list as one citation per number, where it read the whole token as none', () => {
    // `packages/db/src/scope.ts:644,649` AND `:675,684` ARE REAL POINTERS ON
    // `origin/main` AND BOTH WERE UNREAD. The tail expression was anchored at
    // the end of the token, so `:644,649` matched nothing and the token fell
    // through as prose -- including its FIRST number, which on its own would
    // have resolved. Two of the five citations session 399 measured wrong were
    // green for that reason and not because a window admitted them.
    const root = cleanTree();
    write(root, REGISTRY, registry);
    const reason = (pointer: string): string =>
      'const BLOCKED = {\n' +
      `  usePayoutBackend: '\`certificates\` and \`payoutRequests\` are both \`owned\` ` +
      `(\`registry.ts:${pointer}\`).',\n` +
      '};\n';

    // BOTH NUMBERS ANSWERED AND BOTH ANCHORED: `:3` is `certificates`' class
    // line and `:8` is `payoutRequests`', and the sentence names both. This is
    // the shape a comma list is honestly written in and it stays silent.
    write(root, REASON, reason('3,8'));
    expect(findings('RI-15', root)).toEqual([]);

    // THE SECOND NUMBER IS PAST THE END OF THE FILE, which the old reader could
    // not say because it never read the token at all.
    write(root, REASON, reason('3,900'));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `registry.ts:900` and packages/db/src/registry.ts has 12 lines',
    );

    // AND THE FIRST NUMBER IS ANSWERED SEPARATELY, so a list cannot hide one
    // bad pointer behind one good one.
    write(root, REASON, reason('900,3'));
    expect(findings('RI-15', root).join('\n')).toContain(
      'cites `registry.ts:900` and packages/db/src/registry.ts has 12 lines',
    );
  });

  test('RI-15 does not bind a name inside a token whose path it only GUESSED', () => {
    // THE BOUNDARY THE IN-TOKEN BINDING STOPS AT, and it is a measurement rather
    // than a preference. `detectors/fills.ts` writes ``the tier `M07:111` names``
    // two lines under a citation of `0008_risk.sql`, and `M07` is a PLAN and a
    // section line rather than a symbol in that migration. EVERY ONE OF THE
    // SEVEN prefixed tokens in this check's input is that shape -- five `M07`
    // and two `M20` -- and none is a symbol, so a name bound onto an INHERITED
    // path would be the check guessing a file and then guessing a name in it.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(
      root,
      'apps/api/src/idempotency.ts',
      '// `packages/db/src/schema.ts:20` is the reader.\n// The tier `M07:23` names.\n',
    );
    expect(findings('RI-15', root)).toEqual([]);

    // AND THE SAME INHERITED POINTER WITH THE NAME WRITTEN IN FRONT OF IT FIRES,
    // which is what keeps the silence above from passing because the file went
    // unread or the inheritance stopped resolving.
    write(
      root,
      'apps/api/src/idempotency.ts',
      '// `packages/db/src/schema.ts:20` is the reader.\n// The edge `fills` (`:23`) drifts.\n',
    );
    expect(findings('RI-15', root).join('\n')).toContain('for `fills`');
  });

  test('RI-15 reads a token whose prefix is a PATH as naming nothing', () => {
    // `admin-reads.ts:694` names the FILE it points into and no symbol in it, so
    // there is nothing for a runner to look up. The in-token binding takes the
    // prefix only where it is NOT a path, and this is that boundary.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(root, 'apps/api/src/idempotency.ts', '// The reader is `schema.ts:23`.\n');
    expect(findings('RI-15', root)).toEqual([]);
  });

  test('RI-15 survives the rename that used to empty it, and follows the file', () => {
    // THE DEFECT THAT MADE THIS INPUT SET DERIVED. A check that NAMES the files it
    // reads is emptied by a rename, silently, and then reports PASS forever;
    // session 351 found the softer half of the same thing, `routes/verify.ts`
    // carrying the same two drifted pointers as the copies this check flagged and
    // never read because nobody had typed its name. The set is the WALK now, so a
    // renamed file is still read and the finding follows it to its new path.
    const root = cleanTree();
    renameSync(
      join(root, 'apps/api/src/routes/webhooks-psp.ts'),
      join(root, 'apps/api/src/routes/webhooks-provider.ts'),
    );
    const found = findings('RI-15', root).join('\n');
    expect(found).toContain(
      'apps/api/src/routes/webhooks-provider.ts:1: cites `scoped-db.ts:720` for `update`',
    );
    // AND THE REGISTER ENTRY THAT NAMED THE OLD PATH NOW NAMES NOTHING, which is
    // the half that keeps a register from outliving its reason.
    expect(found).toContain(
      'apps/api/src/routes/webhooks-psp.ts: the register claims `scoped-db.ts:720`',
    );
  });

  test('RI-15 throws when the walk reaches no source file at all', () => {
    // THE DIRECTION A DERIVED SET FAILS IN, and it is RI-16's guard rather than a
    // new idea. A list goes stale LOUDLY the day one of its names is wrong; a
    // walk goes stale SILENTLY the day it stops reaching the tree, and then every
    // drifted pointer in it passes for the wrong reason. Zero is an ERROR.
    const root = cleanTree();
    rmSync(join(root, 'apps'), { recursive: true });
    rmSync(join(root, 'packages'), { recursive: true });
    // ADR-330: `scripts/` too. `RI-15`'s walk always read it; what changed is
    // that `RI-35`'s register now names sites there, so `cleanTree` materialises
    // two source files under it and "no source file at all" stopped being true
    // of this tree. The sentinel is about a walk that reaches NOTHING, so the
    // fixture has to leave nothing rather than the assertion being softened.
    rmSync(join(root, 'scripts'), { recursive: true });
    rmSync(join(root, 'vitest.config.ts'));
    rmSync(join(root, 'eslint.config.js'));
    expect(() => findings('RI-15', root)).toThrow(/NO source file/);
  });

  // ---------------------------------------------------------------------------
  // RI-16, and every seed runs in BOTH directions
  // ---------------------------------------------------------------------------
  // The check reads 603 citations on the real tree and returns four findings, so
  // a case that only ever plants a violation cannot tell it from a check that
  // fails every pointer it sees. Each transition below is therefore asserted
  // twice: the defect fires, and the repaired or excluded form is silent.
  //
  // The seeds are the shapes the corpus actually writes. `M05:214` is a real
  // bare pointer out of `ALLOCATION.md` naming a PLAN and a section line, and
  // ``[`:1`](../../path.ts)`` is the real markdown-link shape whose path the
  // document states rather than the runner guessing it.

  /** A live document: a heading that names no date, so its body is in scope. */
  const liveDoc = (body: string): string => `# Notes\n\n## The seam\n\n${body}\n`;
  const LIVE_DOC = 'docs/architecture/NOTES.md';

  test('RI-16 catches a pointer past the end of the file it names', () => {
    const root = cleanTree();
    write(
      root,
      LIVE_DOC,
      liveDoc('The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:900`).'),
    );
    expect(findings('RI-16', root).join('\n')).toContain(
      'docs/architecture/NOTES.md:5: cites `apps/api/src/idempotency-store.ts:900` and ' +
        'apps/api/src/idempotency-store.ts has 2 lines',
    );
  });

  test('RI-16 goes quiet on the SAME sentence once the pointer is corrected', () => {
    const root = cleanTree();
    write(
      root,
      LIVE_DOC,
      liveDoc('The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:1`).'),
    );
    expect(findings('RI-16', root)).toEqual([]);
  });

  test('RI-16 catches a path no file in this tree has', () => {
    // THE FINDING IT ARRIVED WITH, IN THE SHAPE IT ARRIVED IN.
    // `docs/plans/FOLD-01-phone-identity.md` cites `DECISIONS.md:483`, and
    // `DECISIONS.md` is this corpus's NICKNAME for the ADR registry rather than
    // a file it has ever had. That one is registered; this is the same shape on
    // a document the register does not name.
    const root = cleanTree();
    write(root, LIVE_DOC, liveDoc('The adapter (`routes/rail-vendor.ts:12`) is not shipped.'));
    expect(findings('RI-16', root).join('\n')).toContain(
      'cites `routes/rail-vendor.ts:12` and NO FILE IN THIS TREE has that path',
    );
  });

  test('RI-16 admits a name two lines off and catches one three lines off', () => {
    // THE WINDOW, AT ITS TWO BOUNDARIES, because a case that only asserted the
    // catch could not tell this window from one of zero.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    const cite = (line: number): string =>
      liveDoc(`The canary reads \`fills\` (\`packages/db/src/schema.ts:${line}\`).`);

    write(root, LIVE_DOC, cite(22));
    expect(findings('RI-16', root)).toEqual([]);

    write(root, LIVE_DOC, cite(23));
    expect(findings('RI-16', root).join('\n')).toContain(
      'cites `packages/db/src/schema.ts:23` for `fills` and `fills` is at ' +
        'packages/db/src/schema.ts:20, 3 lines away',
    );
  });

  test('RI-16 reads a SHOUTED name, for the reason RI-14 reads a shouted claim', () => {
    // RI-14's first draft was case-sensitive and a shouted claim walked past it.
    // This corpus shouts in its documents as a house style, and a matcher that
    // reads the quiet half and skips the emphatic half skips the half where
    // somebody states a claim they are sure of.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(root, LIVE_DOC, liveDoc('**`FILLS`** (`packages/db/src/schema.ts:23`) IS THE EDGE.'));
    expect(findings('RI-16', root).join('\n')).toContain('for `FILLS`');
  });

  test('RI-16 says nothing under a DATED heading and says it under a plain one', () => {
    // THE EXCLUSION THAT MAKES THE CHECK POSSIBLE, ASSERTED IN BOTH DIRECTIONS,
    // and it is CI-06/derivable-counts' rule rather than this check's: an entry
    // headed with a date or a session number is a RECORD OF A MEASUREMENT MADE
    // THAT DAY, and repairing it would rewrite the record to say something it
    // did not say. A case that only planted the defect could not tell this rule
    // from a check that reads nothing at all.
    const root = cleanTree();
    const body =
      'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:900`).';

    write(root, LIVE_DOC, `# Notes\n\n## The seam (2026-08-24)\n\n${body}\n`);
    expect(findings('RI-16', root)).toEqual([]);

    write(root, LIVE_DOC, `# Notes\n\n## Session 207: the seam\n\n${body}\n`);
    expect(findings('RI-16', root)).toEqual([]);

    write(root, LIVE_DOC, `# Notes\n\n## The seam\n\n${body}\n`);
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 says nothing inside a fenced block', () => {
    // A worked example of this check's own finding is exactly what the document
    // explaining it would quote. CI-06t masks fences for the same reason.
    const root = cleanTree();
    const body =
      'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:900`).';
    write(root, LIVE_DOC, liveDoc(`\`\`\`\n${body}\n\`\`\``));
    expect(findings('RI-16', root)).toEqual([]);

    // AND THE SAME SENTENCE OUTSIDE THE FENCE FIRES, for the reason every case
    // in this block is written twice: a silence asserted alone is
    // indistinguishable from a check that never looked.
    write(root, LIVE_DOC, liveDoc(body));
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 does NOT inherit a path into a bare pointer, and reads the same line spelled out', () => {
    // THE ONE THING IT DISAGREES WITH RI-15 ABOUT, in both directions. `M05:214`
    // is a real bare pointer out of `ALLOCATION.md` and it names a PLAN and a
    // section line. Inheriting the path cited beside it turns it into a
    // citation of a file nobody wrote, which is the check guessing; all fifteen
    // findings inheritance adds inside this scope are that.
    const root = cleanTree();
    write(
      root,
      LIVE_DOC,
      liveDoc(
        'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:1`), ' +
          'and the ladder is `M05:900`.',
      ),
    );
    expect(findings('RI-16', root)).toEqual([]);

    // AND THE SAME POINTER WITH THE PATH WRITTEN OUT FIRES, which is what keeps
    // this case from passing for some other reason.
    write(
      root,
      LIVE_DOC,
      liveDoc(
        'The store is `databaseIdempotencyStore` (`apps/api/src/idempotency-store.ts:1`), ' +
          'and the ladder is `apps/api/src/idempotency-store.ts:900`.',
      ),
    );
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 takes the path a markdown LINK states, in both directions', () => {
    // THE HALF OF THE BARE-POINTER HOLE THAT CLOSES WITHOUT GUESSING. The
    // document states the path in the link; the runner does not infer it. This
    // is 130 of the 603 citations in scope, so a check that dropped them would
    // be reading three quarters of what it claims.
    const root = cleanTree();
    write(root, LIVE_DOC, liveDoc('The store is [`:1`](../../apps/api/src/idempotency-store.ts).'));
    expect(findings('RI-16', root)).toEqual([]);

    write(
      root,
      LIVE_DOC,
      liveDoc('The store is [`:900`](../../apps/api/src/idempotency-store.ts).'),
    );
    expect(findings('RI-16', root).join('\n')).toContain('has 2 lines');
  });

  test('RI-16 binds the name a citation carries INSIDE its own backticks', () => {
    // THE SHAPE MARKDOWN ACTUALLY WRITES, AND THE ONE THIS CHECK WAS BLIND TO.
    // `WAVE-06` section 4.1 carried
    // ``[`setAdminReadSource:706`](../../apps/api/src/routes/admin-reads.ts)``
    // against a declaration at :739 and RI-16 was GREEN on it. Seeded with
    // `:99999`, the same citation turned it RED, so the pointer WAS in scope and
    // the RANGE half worked; what did not reach it is the NAME half, which bound
    // only a backticked name written IN FRONT of the pointer. There is nothing in
    // front of this one, because the name is inside the pointer's own backticks.
    const root = cleanTree();
    write(root, 'packages/db/src/schema.ts', fileWithNameAt(40, 20, 'fills'));
    write(root, LIVE_DOC, liveDoc('The edge is [`fills:23`](../../packages/db/src/schema.ts).'));
    expect(findings('RI-16', root).join('\n')).toContain(
      'cites `../../packages/db/src/schema.ts:23` for `fills` and `fills` is at ' +
        'packages/db/src/schema.ts:20, 3 lines away',
    );

    // AND THE SAME CITATION REPOINTED IS SILENT, because a catch asserted alone
    // is indistinguishable from a check that fires on every token it can parse.
    write(root, LIVE_DOC, liveDoc('The edge is [`fills:20`](../../packages/db/src/schema.ts).'));
    expect(findings('RI-16', root)).toEqual([]);
  });

  test('RI-16 reads a token that names its own FILE as naming nothing', () => {
    // THE HALF THE IN-TOKEN BINDING MUST NOT TAKE. This corpus writes
    // ``[`EVENTS:396`](../architecture/EVENTS.md)`` for a pointer into a
    // DOCUMENT, and `EVENTS` there is the file rather than a symbol on line 396.
    // Binding it would assert that the line says "EVENTS", which the document
    // never claimed, and there are more pointers of that shape than of the other.
    const root = cleanTree();
    write(
      root,
      'docs/architecture/EVENTS.md',
      `# Events\n\n## Catalogue\n\n${'| a |\n'.repeat(40)}`,
    );
    write(root, LIVE_DOC, liveDoc('Section 11 opens at [`EVENTS:40`](./EVENTS.md).'));
    expect(findings('RI-16', root)).toEqual([]);

    // AND A PREFIX THAT IS NOT THAT FILE'S NAME BINDS, which is what keeps the
    // silence above from passing for the reason that nothing binds at all.
    write(root, LIVE_DOC, liveDoc('Section 11 opens at [`catalogueRow:40`](./EVENTS.md).'));
    expect(findings('RI-16', root).join('\n')).toContain('for `catalogueRow`');
  });

  test('RI-16 catches a register entry that no longer names a finding', () => {
    // THE REGISTER SHRINKS ONLY, which is CI-06u's rule about its own and the
    // difference between a register and an exemption list. The entry names the
    // repair the gate is waiting for; the day the repair lands, the entry has to
    // go with it, and this is what makes that happen rather than hoping for it.
    const root = cleanTree();
    write(
      root,
      'docs/plans/FOLD-01-phone-identity.md',
      liveDoc('The vendor buys phone footprint.'),
    );
    expect(findings('RI-16', root).join('\n')).toContain(
      'docs/plans/FOLD-01-phone-identity.md: the register claims `DECISIONS.md:483` is a known ' +
        'finding and it is not one on this ref',
    );
  });

  // ---------------------------------------------------------------------------
  // RI-13, and the seeds run in BOTH directions on the same entry
  // ---------------------------------------------------------------------------
  // The block is what an unsigned entry owes its reader, so the cases that matter
  // are the two transitions: an entry that lacks it must be a finding, and the
  // same entry with it added must be silent. A case that only ever plants a
  // violation cannot tell a check that recognises the block from a check that
  // returns a finding for every unsigned entry it sees.
  const UNSIGNED_ADR = [
    '## ADR-900: a ruling (2026-08-27, status: proposed)',
    '',
    '- **Decision:** the reading that costs a caller a narrowing is taken.',
    '',
    '### 4. Approval',
    '',
    '**Approval line: PENDING, UNSIGNED.** Not money path.',
    '',
  ].join('\n');

  const FOUNDER_BLOCK =
    '**What a founder read adds and this entry cannot.** The ruling picks one of ' +
    'two coherent readings and the other one is not absurd: it costs every caller ' +
    'a narrowing it would otherwise not write, and the cost lands forever on a ' +
    'path nobody revisits. Whether that price is right is the judgement.\n';

  test('RI-13 catches an unsigned ADR that never says what the founder must decide', () => {
    const root = cleanTree();
    write(root, 'docs/decisions/ADR-900.md', UNSIGNED_ADR);
    expect(findings('RI-13', root).join('\n')).toContain(
      'ADR-900.md: approval withheld at :7 and the entry carries no `What a founder read adds` block',
    );
  });

  test('RI-13 goes quiet on the SAME entry once the block is added', () => {
    const root = cleanTree();
    write(root, 'docs/decisions/ADR-900.md', `${UNSIGNED_ADR}\n${FOUNDER_BLOCK}`);
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 accepts "nothing here is a judgement" as the answer', () => {
    // THE DIRECTION THE CHECK MUST NOT PUSH. An entry that is pure transcription
    // against an approved document owes the founder no decision, and one forced to
    // fabricate a question is worse than one that had none: it spends a read on a
    // decision nobody has to make. The check reads the block's LENGTH, never its
    // meaning, which is exactly what makes this pass on the same terms as a
    // three-judgement answer.
    const root = cleanTree();
    const nothing =
      '**What a founder read adds and this entry cannot: nothing, and here is why.** ' +
      'Every clause is transcribed from an approved plan and the entry cites the line ' +
      'each came from. No reading was chosen, nothing was refused, and there is no ' +
      'alternative whose cost anybody had to weigh.\n';
    write(root, 'docs/decisions/ADR-900.md', `${UNSIGNED_ADR}\n${nothing}`);
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 catches the block used as a LABEL with nothing behind it', () => {
    // A grep for the marker alone would pass this, and it is the cheapest way to
    // make the check quiet: write the heading, answer nothing.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      `${UNSIGNED_ADR}\n**What a founder read adds and this entry cannot.** Nothing much.\n`,
    );
    expect(findings('RI-13', root).join('\n')).toContain('and then says nothing');
  });

  test('RI-13 leaves an entry whose approval is GRANTED out of scope', () => {
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      UNSIGNED_ADR.replace('PENDING, UNSIGNED.', 'GRANTED 2026-08-27.'),
    );
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 reads a grant written DEEPER in the approval section than its first line', () => {
    // ADR-111 IS THE CASE, AND THE CHECK FAILED IT BEFORE THIS SEED EXISTED. Its
    // approval section opens by recording that the entry landed with no approval
    // line, runs a shell block whose comments start with `#`, and signs at the
    // bottom. Reading the section as ending at the first `#` inside the fence lost
    // the signature and reported a SIGNED entry as unsigned.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      [
        '## ADR-900: a ruling (2026-08-27, status: accepted)',
        '',
        '### 4. The approval line, ADDED BY THE LOOP',
        '',
        '**This entry landed with no approval line and the log says UNSIGNED.**',
        '',
        '```',
        '# 1. what was verified at merge',
        'pnpm run verify   -> exit 0',
        '```',
        '',
        '**SIGNED ON DELEGATED AUTHORITY, 2026-08-27. Not money path.**',
        '',
      ].join('\n'),
    );
    expect(findings('RI-13', root)).toEqual([]);
  });

  test('RI-13 does NOT read a disposition out of prose about somebody else"s grant', () => {
    // THE OPPOSITE DIRECTION, AND IT IS THE ONE THAT FAILS SILENTLY. ADR-119 has
    // `**REFUSED**` in a table cell about an empty world and ADR-137 cites a
    // recommendation another entry GRANTED. Both are unsigned. A disposition read
    // from anywhere in the section drops them out of scope with nothing reported,
    // so a disposition is read only at the FRONT of a line, where a signature goes.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      [
        '## ADR-900: a ruling (2026-08-27, status: proposed)',
        '',
        '### 4. Approval',
        '',
        '| 5 | An empty world | **REFUSED**, which is another entry"s sentence |',
        '',
        '- **The clause to read before signing is clause 1.** It says an item that',
        '  ADR-059 recommendation 3 GRANTED does not hold what its register says.',
        '',
        '- **Approval line: PENDING, UNSIGNED.** Not money path.',
        '',
      ].join('\n'),
    );
    expect(findings('RI-13', root).join('\n')).toContain('ADR-900.md: approval withheld at :10');
  });

  test('RI-13 leaves an entry carrying NO approval statement out of scope', () => {
    // THE DELIBERATE HOLE, AND IT IS IN `covers`. Thirty-one pre-FREEZE entries
    // record no approval at all. Reading their silence as "unsigned" would fail
    // them for a convention that did not exist when they were written, so an
    // unreadable status puts an entry out of scope rather than into a finding.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      '## ADR-900: a ruling (2026-08-14, status: accepted)\n\n- **Decision:** a thing.\n',
    );
    expect(findings('RI-13', root)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Rule 2 of the runner: a check that cannot run is not a check that passed
// -----------------------------------------------------------------------------
describe('a check that cannot reach its inputs throws rather than passing', () => {
  test.each([
    ['RI-01', 'packages/rules-engine/package.json'],
    ['RI-03', 'vitest.config.ts'],
    ['RI-05', '.nvmrc'],
    ['RI-07', 'packages/rules-engine/src/index.ts'],
    ['RI-08', 'packages/db/package.json'],
    ['RI-09', `apps/${SURFACE_OWNER}/src/surface.ts`],
  ])('%s throws when %s is gone', (id, input) => {
    const root = cleanTree();
    renameSync(join(root, input), join(root, `${input}.moved`));
    expect(() => findings(id, root)).toThrow(/cannot run/);
  });

  test('RI-01 throws when the workspace resolves no packages', () => {
    const root = cleanTree();
    write(root, 'pnpm-workspace.yaml', 'packages:\n');
    expect(() => findings('RI-01', root)).toThrow(/claims no packages/);
  });

  test('RI-09 throws when OPERATOR_PREFIXES parses to nothing', () => {
    // THE DIRECTION THAT MATTERS. An empty prefix list would make RI-09 report
    // PASS while asserting nothing at all about the operator surface, which is
    // the half it was written for -- and it is the same shape as RI-04
    // reporting PASS about a deployable its literal did not name.
    const root = cleanTree();
    write(root, `apps/${SURFACE_OWNER}/src/surface.ts`, "export const BASE_PATH = '/api/v1';\n");
    expect(() => findings('RI-09', root)).toThrow(/cannot run/);
  });

  // RI-08's TWO GUARDS ARE ABOUT THE ADMISSION LIST AND NOT ABOUT A MISSING
  // FILE, because that list is the direction the check gets weakened in. Nobody
  // deletes an invariant; somebody admits one more package each time one is
  // inconvenient, and the check keeps reporting PASS about a workspace it has
  // exempted. Both cases go through `withDbAdmitted`, which restores what
  // SHIPPED rather than emptying the list: it is module state, and since
  // ADR-120 it is module state with a member in it.
  test('RI-08 throws on an admission naming a package that does not exist', () => {
    const root = cleanTree();
    withDbAdmitted(['@merit/gone'], () => {
      expect(() => findings('RI-08', root)).toThrow(/cannot run/);
    });
  });

  test('RI-08 throws when the admission list covers every package', () => {
    // The end state of one admission at a time. A green result here would mean
    // "no package outside the list declares the accessor" over an empty
    // remainder, which is RI-04 reporting PASS about a deployable its literal
    // did not name, and RI-09 reporting PASS with no operator prefixes.
    const root = cleanTree();
    const everybody = [
      ...DEPLOYABLES.map((app) => `@merit/${app}`),
      // Every fixture package but the accessor itself, which is what `admitted`
      // is a list of and therefore cannot be a member of.
      ...FIXTURE_PACKAGES.filter((pkg) => pkg !== 'db').map((pkg) => `@merit/${pkg}`),
    ];
    withDbAdmitted(everybody, () => {
      expect(() => findings('RI-08', root)).toThrow(/asserting nothing/);
    });
  });

  test('RI-16 throws when no tracked `.md` under docs/ is left to read', () => {
    // A check that names a TREE rather than a file is emptied by a move, and it
    // then reports PASS forever about a corpus it never opened.
    const root = cleanTree();
    rmSync(join(root, 'docs'), { recursive: true, force: true });
    expect(() => findings('RI-16', root)).toThrow(/cannot run/);
  });

  test('RI-16 throws when every citation falls out of scope', () => {
    // THE DIRECTION THAT FAILS SILENTLY, and it is the same shape as RI-09
    // reporting PASS with no operator prefixes. The record-heading rule holds
    // 2,288 of 2,950 path-bearing citations out of scope on the real tree, so a
    // rule that widened by accident would empty this check while it kept saying
    // PASS. Zero in scope is an ERROR, not a clean result.
    const root = cleanTree();
    for (const doc of [
      'docs/plans/FOLD-01-phone-identity.md',
      'docs/decisions/ALLOCATION.md',
      'docs/plans/WAVE-06-admin-console-transport.md',
    ]) {
      write(
        root,
        doc,
        `# D\n\n## The rows (2026-08-24)\n\nThe store (\`src/idempotency-store.ts:900\`).\n`,
      );
    }
    expect(() => findings('RI-16', root)).toThrow(/NO citation in scope/);
  });

  test('RI-31 throws when the walk reaches no markdown at all', () => {
    const root = cleanTree();
    for (const rel of walkMarkdown(root)) rmSync(join(root, rel));
    expect(() => findings('RI-31', root)).toThrow(/walked no `\.md` file at all/);
  });

  test('RI-31 throws when nothing in the tree carries a generated span', () => {
    // THE DIRECTION THAT FAILS SILENTLY, and it is why this sentinel exists at
    // all. This check's scope is a COMMENT SYNTAX rather than a directory:
    // rename the span form, or widen the fence mask until it swallows whole
    // documents, and every line of the check still runs, finds nothing, and
    // reports PASS over every doubled generated line in the tree. The markdown
    // is left in place here, so the throw is about the SPANS being gone rather
    // than about the files being gone.
    const root = cleanTree();
    for (const rel of walkMarkdown(root)) {
      const body = readFileSync(join(root, rel), 'utf8');
      if (body.includes('<!--gen:')) write(root, rel, body.replaceAll('<!--gen:', '<!--span:'));
    }
    expect(() => findings('RI-31', root)).toThrow(/no line carrying a `<!--gen:` span/);
  });

  test('RI-07 throws when the graph walk reaches only the entry point', () => {
    // THE FAILURE MODE THIS GUARDS IS THE CHECK ITSELF BREAKING SILENTLY. If the
    // specifier scan stopped matching -- a regex edit, a syntax this file does
    // not parse -- RI-07 would walk one file, find no imports, and report PASS
    // about a thirteen-module package it never read. Reaching one file is
    // therefore an ERROR and not a clean result.
    const root = cleanTree();
    write(root, 'packages/rules-engine/src/index.ts', 'export const nothing = 1;\n');
    expect(() => findings('RI-07', root)).toThrow(/walked 1 file/);
  });
});

// -----------------------------------------------------------------------------
// The helper the two above depend on
// -----------------------------------------------------------------------------
test('needle assembles a pattern without spelling it', () => {
  // Both the pattern AND the subject are assembled. Writing the subject out was
  // the first version of this case, and it made THIS FILE a finding of RI-02
  // when the check ran against the real repository. The check was right and the
  // test was wrong, which is the direction that keeps a check trustworthy.
  const spelled = 'cover' + 'ageThreshold: 90';
  expect(needle('cover', 'ageThreshold').test(spelled)).toBe(true);
  expect(needle('cover', 'ageThreshold').test('coverage is reported as a trend')).toBe(false);
});

// -----------------------------------------------------------------------------
// RI-19, whose subject is the clearing-condition pattern itself
// -----------------------------------------------------------------------------
// EVERY SEED BELOW IS THE DEFECT THAT ACTUALLY HAPPENED OR ONE STEP FROM IT.
// `B5`'s condition was stated in `apps/api/src/admin-source/liability.ts` and in
// `apps/api/test/admin-source-liability.test.ts` WITH TWO OF ITS THREE TERMS
// EACH, and each statement was individually true, so four sessions in a row read
// a two-term condition off a three-term blocker. The first two cases are that
// defect in each of its two directions.
//
// THE LAST TWO CASES ARE THE REACH RATHER THAN THE CATCH. A check that claims
// more than it does is the defect class this corpus found four times on
// 2026-08-28, and adding a fifth inside the invariant written to prevent one
// would be a poor joke. What RI-19 does NOT see is asserted here, in the suite,
// where it cannot quietly stop being true.
describe('RI-19 binds the two statements of one clearing condition', () => {
  const CONDITION = 'apps/api/test/admin-source-blocked-read.test.ts';

  test('it catches the case dropping a term the module enumerates, which is `B5` exactly', () => {
    // SESSION 392's OWN PRE-REPAIR TEXT. The case named the `| null` and not the
    // `engine_gates` ENCODING; the module named the encoding and not the
    // `| null`. Neither named the other's second term and no control compared
    // them. This is the half a reader of the CASE would have been missing.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` implementation\n' +
        '// lands, AND `eligible_next_7d` gains its `| null`.\n',
    );
    const found = findings('RI-19', root);
    expect(found.join('\n')).toContain('term 2 of the condition');
    expect(found.join('\n')).toContain('NAMED NOWHERE IN THE CASE');
    // AND IT NAMES THE TERM BY ITS OWN IDENTIFIER, which is what makes the
    // finding actionable rather than a count that went red.
    expect(found.join('\n')).toContain('`engine_gates`');
  });

  test('it catches the case holding a term the module has dropped, the other direction', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL TWO TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//   2. A primary source declares the stored `engine_gates` ENCODING.\n',
    );
    const found = findings('RI-19', root).join('\n');
    expect(found).toContain('the case names `eligible_next_7d`');
    expect(found).toContain('NO TERM OF THE MODULE CARRIES IT');
    // The count arm fires on the same seed and reports the disagreement from the
    // case's side, because the two statements now differ about how many terms
    // the blocker has. Both readings of one drift, which is the point.
    expect(found).toContain('says ALL THREE TERMS where');
  });

  test('it catches a module whose spelled count has stopped agreeing with its own items', () => {
    // RI-04's failure arriving on the condition itself: its literal held four
    // names where the tree had five, and it passed green for three sessions.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL FOUR TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//   2. A primary source declares the stored `engine_gates` ENCODING.\n' +
        '//   3. `eligible_next_7d` gains its `| null`.\n',
    );
    expect(findings('RI-19', root).join('\n')).toContain('says ALL FOUR TERMS and enumerates 3');
  });

  test('it reports a module that declares terms and enumerates none, rather than passing', () => {
    // The enumeration IS the term set. A statement with no `1.` item binds
    // nothing, and reporting PASS over it would be this check asserting the
    // agreement of a list it never read.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL THREE TERMS:** a `writeRuleState` lands, and\n' +
        '// the rest of it is prose.\n',
    );
    expect(findings('RI-19', root).join('\n')).toContain('ENUMERATES NONE');
  });

  test('it reports a term that shares every identifier with a sibling, rather than passing', () => {
    // A CHECK NEVER RETURNS PASS FOR SOMETHING IT DID NOT LOOK AT, which is this
    // runner's rule 1. Two terms naming only `writeRuleState` are two terms RI-19
    // cannot tell apart, and silence there would be the check covering less than
    // its own words claim.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL THREE TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//   2. A second `writeRuleState` thing happens.\n' +
        '//   3. `eligible_next_7d` gains its `| null`.\n',
    );
    expect(findings('RI-19', root).join('\n')).toContain('shares every identifier it names');
  });

  test('it THROWS when the form it binds has left the tree, rather than reporting agreement', () => {
    // A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED. Zero declarations means
    // the marker was reworded, and every restatement in the tree is unbound the
    // moment that happens. Reporting PASS there is RI-04's three green sessions.
    const root = cleanTree();
    write(root, 'apps/api/src/admin-source/blocked-read.ts', '// nothing is blocked.\n');
    write(root, CONDITION, '// nothing is blocked.\n');
    expect(() => findings('RI-19', root)).toThrow(/found NO clearing condition/);
  });

  test('it THROWS rather than guessing which restatement belongs to which condition', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/admin-source/blocked-read.ts',
      '// **CLEARING CONDITION, ALL ONE TERMS:**\n' +
        '//   1. A `writeRuleState` IMPLEMENTATION lands.\n' +
        '//\n' +
        '// **CLEARING CONDITION, ALL ONE TERMS:**\n' +
        '//   1. A `readRuleState` IMPLEMENTATION lands.\n',
    );
    expect(() => findings('RI-19', root)).toThrow(/pairs them BY FILE/);
  });

  test('a restatement spelling an identifier in another case holds, which is prose and not drift', () => {
    // The comparison is case-folded on purpose. `EngineGates` and `engineGates`
    // are one term written by two hands, and a check that went red on that would
    // be teaching sessions to ignore it.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, ALL THREE TERMS: a `WRITERULESTATE` lands, AND a\n' +
        '// source declares the stored `Engine_Gates` ENCODING, AND\n' +
        '// `ELIGIBLE_NEXT_7D` gains its `| NULL`.\n',
    );
    expect(findings('RI-19', root)).toEqual([]);
  });

  test('IT IS BLIND TO A TERM WHOSE MEANING INVERTS WHILE ITS IDENTIFIERS STAY PUT', () => {
    // THE LIMIT, ASSERTED RATHER THAN DESCRIBED. RI-19 reads identifiers and not
    // prose, so "gains its `| null`" and "LOSES its `| null`" are the same term
    // to it. This case exists so the next reader learns that from a green
    // assertion here instead of from a condition that drifted past a check
    // whose `covers` they took at its word.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` implementation\n' +
        '// is REMOVED, AND nothing declares the stored `engine_gates` ENCODING,\n' +
        '// AND `eligible_next_7d` LOSES its `| null`.\n',
    );
    expect(findings('RI-19', root)).toEqual([]);
  });

  test('IT IS BLIND TO A RESTATEMENT THAT DOES NOT DECLARE ITS OWN TERM COUNT', () => {
    // THE SECOND LIMIT, AND IT IS THE LARGER ONE. The corpus states clearing
    // conditions in many other forms and RI-19 reads none of them: it binds the
    // form session 392 established and makes it load-bearing. A case that
    // restates the condition WITHOUT the marker is not in any pair, and the two
    // statements are then free to drift exactly as `B5`'s did.
    const root = cleanTree();
    write(
      root,
      CONDITION,
      '// CLEARING CONDITION, RESTATED: a `writeRuleState` implementation lands,\n' +
        '// AND `eligible_next_7d` gains its `| null`.\n',
    );
    // Two of three terms, no control, and RI-19 says nothing. This is the hole.
    expect(findings('RI-19', root)).toEqual([]);
  });
});

describe('RI-19 is about a real pair on the real tree, which is separate from its verdict', () => {
  test('it binds `B5`s condition across `liability.ts` and its case, with two terms', () => {
    // "IT RETURNED AN EMPTY ARRAY" IS NOT EVIDENCE THAT IT LOOKED. RI-04 passed
    // green for three sessions while checking nothing, so this case asserts the
    // SUBJECT: the pair RI-19 found, which side is canonical, and how many terms
    // it derived. Every number here is read out of the tree at run time.
    const { pairs, declared } = clearingConditionPairs(REPO_ROOT);
    expect(declared).toBeGreaterThanOrEqual(2);
    const b5 = pairs.get('apps/api::admin-source-liability');
    expect(b5).toBeDefined();
    expect(b5?.module.map((m) => m.file)).toEqual(['apps/api/src/admin-source/liability.ts']);
    expect(b5?.case.map((c) => c.file)).toEqual(['apps/api/test/admin-source-liability.test.ts']);
    // THE MODULE ENUMERATES AND THE CASE RESTATES, which is session 392's repair
    // in its own words: the condition is written ONCE, in the module.
    // **THE COUNT MOVED FROM THREE TO TWO AND THAT IS THE SUBJECT MOVING, NOT
    // THIS CASE WEAKENING.** All three of `B5`s original terms were spent by
    // ADR-206, ADR-208 and ADR-264 while the figure stayed absent, so ADR-269
    // restated the condition over the two terms that actually hold it. The
    // numbers are read out of the tree at run time and this case is what
    // notices the day they move again.
    expect(b5?.module[0]?.terms.length).toBe(2);
    expect(b5?.module[0]?.count).toBe(2);
    expect(b5?.case[0]?.count).toBe(2);
    expect(b5?.case[0]?.terms.length).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// RI-20, whose subject is a sentence that quotes its own decision procedure
// -----------------------------------------------------------------------------
// THE DEFECT THIS CHECK WAS WRITTEN FOR IS ON THE REAL TREE AND WAS CAUGHT BY IT
// BEFORE A LINE OF THE MAP WAS REPAIRED: `wiring.test.ts`'s `usePayoutBackend`
// entry claimed a recursive grep for lifetime_settled over the migrations
// directory returned nothing, and it returned seven lines. That run is the only
// evidence that matters and it is reproduced here as a seed, because a check
// that has only ever been seen pass is indistinguishable from one that cannot
// fail.
describe('RI-20 runs the command a reason quotes', () => {
  /** The fixture's `wiring.test.ts` with `body` appended as a comment. */
  const claiming = (root: string, body: string): void => {
    write(
      root,
      'apps/api/test/wiring.test.ts',
      '// `grep -rn zzznosuchtoken packages/db/migrations` returns nothing.\n' +
        '// `grep -rln risk packages/db/migrations` returns 1 line.\n' +
        body,
    );
  };

  test('it catches a claim that a command returns nothing when the command returns lines', () => {
    // THE REAL DEFECT, IN THE SHAPE IT ACTUALLY HAD. `risk` is on 139 lines of
    // the fixture's one migration, and the sentence says the grep finds none.
    const root = cleanTree();
    claiming(root, '// `grep -rn risk packages/db/migrations` returns nothing at all.\n');
    expect(findings('RI-20', root).join('\n')).toContain('returns nothing and it returns 139');
  });

  test('it catches a stated COUNT that is not the count', () => {
    const root = cleanTree();
    claiming(root, '// `grep -rln risk packages/db/migrations` returns 4 lines.\n');
    expect(findings('RI-20', root).join('\n')).toContain('returns 4 line(s) and it returns 1');
  });

  test('a command that is not `grep` is a FINDING and never a skip', () => {
    // A CHECK A LATER AUTHOR EVADES BY WRITING A DIFFERENT COMMAND NAME IS NOT A
    // CHECK, so the unexecutable direction reports rather than passing quietly.
    const root = cleanTree();
    claiming(root, '// `rg -n risk packages/db/migrations` returns nothing.\n');
    expect(findings('RI-20', root).join('\n')).toContain('only `grep` is executable here');
  });

  test('a command carrying a shell metacharacter is unsettleable rather than executed', () => {
    // NOTHING RUNS THROUGH A SHELL. This is the case that would be arbitrary
    // code execution out of a comment if the check took the easy route, and the
    // seed is the easy route's exact payload.
    const root = cleanTree();
    claiming(root, '// `grep -rn risk packages/db; touch pwned` returns nothing.\n');
    const found = findings('RI-20', root).join('\n');
    expect(found).toContain('cannot settle it');
    expect(existsSync(join(root, 'pwned'))).toBe(false);
  });

  test('a command whose path has moved is a finding rather than a silent zero', () => {
    // grep exits 2 for a missing path and 1 for no match, and reading the two
    // the same way would make every renamed directory look like a claim that
    // came true.
    const root = cleanTree();
    claiming(root, '// `grep -rn risk packages/db/no-such-dir` returns nothing.\n');
    expect(findings('RI-20', root).join('\n')).toContain('rather than returning a result');
  });

  test('it names a file that has been renamed out from under it', () => {
    const root = cleanTree();
    rmSync(join(root, 'apps/api/src/idempotency.ts'));
    expect(findings('RI-20', root).join('\n')).toContain('point it at the new path');
  });

  test('a run that settles NO claim throws rather than passing', () => {
    // "A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED", applied to a check
    // whose input is prose somebody has to write: an empty input is silence, not
    // a green tick.
    const root = cleanTree();
    // EVERY FILE IN THE LIST GOES SILENT, not just the first one. This case read
    // only `wiring.test.ts` until session 410 put two more files in RI-20's
    // scope, at which point it stopped testing the empty-input guard and started
    // passing on the claims the other two carry. Each file still EXISTS, so the
    // rename guard is not what fires.
    for (const rel of [
      'apps/api/test/wiring.test.ts',
      'apps/api/src/auth-backend.ts',
      'apps/api/src/routes/auth.ts',
    ])
      write(root, rel, '// nothing quoted here.\n');
    expect(() => findings('RI-20', root)).toThrow(/found NO command claim/);
  });

  test('THE ACCEPTANCE DIRECTION: a true claim in both shapes passes', () => {
    // A PROBE THAT ONLY EVER ATTEMPTS FORBIDDEN THINGS PASSES AGAINST A GUARD
    // THAT REJECTS EVERYTHING. The fixture's two claims are true and this asserts
    // they are read and cleared rather than skipped.
    const root = cleanTree();
    expect(findings('RI-20', root)).toEqual([]);
  });

  test('THE DIRECTION THAT ACTUALLY HAPPENS: the TREE moves and no sentence is touched', () => {
    // ADR-200 WIRED `verifyOtp` AND ELEVEN SENTENCES WENT ON SAYING TWELVE. The
    // seeds above all edit the claim; this one edits the TREE and leaves every
    // sentence exactly as its author wrote it, which is the event that produced
    // the defect session 410 was dispatched for. The finding must land on the
    // file holding the SENTENCE and name the file holding the COUNT.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/auth-backend.ts',
      '// The port size is a fact about the other file, so it is settleable here:\n' +
        '// `grep -rn ": unwired" apps/api/src/routes/auth.ts` returns 2 lines.\n' +
        "  requestOtp: blocked('requestOtp', NO_DELIVERY),\n" +
        "  readMe: blocked('readMe', NO_MAX_ACCOUNTS),\n" +
        "  elevate: blocked('elevate', NO_ELEVATION),\n" +
        "  verifyPhone: blocked('verifyPhone', NO_PREVIEW_COLUMN),\n",
    );
    const found = findings('RI-20', root).join('\n');
    expect(found).toContain('apps/api/src/routes/auth.ts:2');
    expect(found).toContain('returns 3 line(s) and it returns 4');
  });

  test('A CLAIM MUST NOT BE ABLE TO SATISFY ITSELF, which is why the two claims are crossed', () => {
    // THE RULE STATED AS A CASE RATHER THAN AS A COMMENT. Writing the refusal
    // count INTO `auth-backend.ts` puts the pattern on one more line of the file
    // the command greps, so the sentence changes the number it is asserting: the
    // three refusals below are three, the file returns FOUR, and the extra line
    // is the claim itself. A true count is unwritable there, which is the whole
    // reason the shipped tree crosses the two claims over.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/auth-backend.ts',
      '// Written in the file it greps, which is the mistake:\n' +
        '// `grep -rn ": blocked" apps/api/src/auth-backend.ts` returns 3 lines.\n' +
        "  requestOtp: blocked('requestOtp', NO_DELIVERY),\n" +
        "  readMe: blocked('readMe', NO_MAX_ACCOUNTS),\n" +
        "  elevate: blocked('elevate', NO_ELEVATION),\n",
    );
    // The other file's claim is corrected to the same four, so the ONLY finding
    // left is the self-matching one and the case cannot pass on the wrong site.
    write(
      root,
      'apps/api/src/routes/auth.ts',
      '// `grep -rn ": blocked" apps/api/src/auth-backend.ts` returns 4 lines.\n' +
        "  sessionByToken: unwired('sessionByToken'),\n" +
        "  requestOtp: unwired('requestOtp'),\n",
    );
    const found = findings('RI-20', root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('apps/api/src/auth-backend.ts:2');
    expect(found[0]).toContain('returns 3 line(s) and it returns 4');
  });

  test('THE LIMIT, ASSERTED RATHER THAN DESCRIBED: it reads the COUNT and not the content', () => {
    // `zzznosuchtoken` and a token matching nothing else both return nothing, so
    // a sentence naming the wrong pattern passes. This is the hole, and it is
    // stated in the suite because `covers` claiming it would be a claim nobody
    // checked.
    const root = cleanTree();
    claiming(root, '// `grep -rn alsonotpresent packages/db/migrations` returns nothing.\n');
    expect(findings('RI-20', root)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// RI-15's two `ALTER TABLE` declaration shapes, which ADR-214 added
// -----------------------------------------------------------------------------
describe('RI-15 can anchor a citation on a column a migration ADDS', () => {
  test('`ADD COLUMN` and `ADD CONSTRAINT` are declarations', () => {
    // WITHOUT THESE TWO SHAPES EVERY COLUMN ADDED AFTER A TABLE'S `CREATE` WAS
    // UNCITABLE, which is RI-14's blindness arriving in RI-15's reader: a
    // merged migration is never edited, only superseded, so `ALTER TABLE ... ADD
    // COLUMN` is how half the schema exists. The fixture below is `0065`'s shape.
    const root = cleanTree();
    write(
      root,
      'packages/db/migrations/0065_rule_state_lifetime_and_breach.sql',
      'ALTER TABLE rule_states\n' +
        '  ADD COLUMN lifetime_settled_cents bigint NOT NULL DEFAULT 0;\n' +
        'ALTER TABLE rule_states\n' +
        '  ADD CONSTRAINT rule_states_breach_flag_matches_kind CHECK (true);\n',
    );
    write(
      root,
      'apps/api/test/wiring.test.ts',
      '// The gate reads `principal(request)` (`routes/admin-wallet.ts:601`).\n' +
        '// `grep -rn zzznosuchtoken packages/db/migrations` returns nothing.\n' +
        '// `grep -rln risk packages/db/migrations` returns 1 line.\n' +
        '// `lifetime_settled_cents`\n' +
        '// (`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql:2`) and\n' +
        '// `rule_states_breach_flag_matches_kind`\n' +
        '// (`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql:4`).\n',
    );
    expect(findings('RI-15', root)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// RI-21, whose subject is what git DOES rather than what `.gitignore` SAYS
// -----------------------------------------------------------------------------
// THE DEFECT THIS CHECK WAS WRITTEN FOR WAS ON THE REAL TREE AND HAD BEEN FOR
// MONTHS: `INFRA:145` said ".env files are gitignored and CI verifies it rather
// than trusting it (VG-1)", `.gitignore` carried no `.env` entry at all, and
// `git check-ignore -v .env` exited 1. The seeds below are the four ways the
// rule can be lost, each watched firing, plus the two cases that are the whole
// argument for asking git instead of grepping the file: a subdirectory
// `.gitignore` that re-includes a path while the root entry is still there word
// for word, and a file that is already tracked, which no ignore rule reaches.
describe('RI-21 asks git what the ignore rule says', () => {
  /** The fixture's root `.gitignore`, replaced wholesale. */
  const ignoring = (root: string, body: string): void => write(root, '.gitignore', body);

  test('THE REAL DEFECT: the entry is deleted and every ignored spelling reports', () => {
    // `.gitignore` WITH NO `.env` LINE IS THE STATE THE REPOSITORY WAS IN, and
    // it is the state a single careless edit returns it to. Nine paths must be
    // ignored, so nine findings and not one.
    const root = cleanTree();
    ignoring(root, 'node_modules/\ndist/\n');
    const found = findings('RI-21', root);
    expect(found).toHaveLength(9);
    expect(found.join('\n')).toContain('`.env` IS NOT IGNORED');
    expect(found.join('\n')).toContain('No pattern in this repository matches it at all');
  });

  test('the suffix family is its own pattern, and deleting it leaves `.env` passing', () => {
    // THE REASON THE RULE IS THREE LINES AND NOT ONE. `.env` does not match
    // `.env.local`, so a set that looks complete to a reader covers the file
    // nobody creates and misses the five people actually write.
    const root = cleanTree();
    ignoring(root, '.env\n!.env.example\n');
    const found = findings('RI-21', root);
    expect(found.join('\n')).toContain('`.env.local` IS NOT IGNORED');
    expect(found.join('\n')).not.toContain('`.env` IS NOT IGNORED and');
    expect(found).toHaveLength(6);
  });

  test('deleting the negation swallows the committed template, in both directions', () => {
    // THE EXCEPTION IS PART OF THE RULE AND NOT A CONVENIENCE. A `.env.example`
    // that is silently ignored is a template nobody can commit, and the failure
    // is invisible: `git add` simply does nothing.
    const root = cleanTree();
    ignoring(root, '.env\n.env.*\n');
    const found = findings('RI-21', root);
    expect(found).toHaveLength(2);
    expect(found.join('\n')).toContain('`.env.example` IS ignored, by `.env.*`');
    expect(found.join('\n')).toContain('`apps/api/.env.example` IS ignored');
  });

  test('a catch-all that happens to cover the paths is refused as the rule', () => {
    // A `*` IGNORES EVERY SUBJECT AND WOULD SATISFY A CHECK THAT ONLY ASKED
    // "is it ignored". It is not the rule ADR-224 states, it would read green
    // after the `.env` entries were deleted, and it takes the corpus with it.
    const root = cleanTree();
    ignoring(root, '*\n');
    const found = findings('RI-21', root).join('\n');
    expect(found).toContain('is ignored by `*`, which does not name `env` at all');
    expect(found).toContain('`docs/architecture/INFRA.md` IS ignored');
  });

  test('THE CASE THAT IS THE WHOLE ARGUMENT: the root entry survives and the rule does not', () => {
    // A GREP FOR `.env` IN `.gitignore` PASSES HERE AND THE FILE IS NOT
    // IGNORED. The root entries are untouched, word for word, and a
    // subdirectory `.gitignore` re-includes the path underneath them. This is
    // why the check runs a command: `.gitignore` is not the only file that
    // decides, and even within one file a later negation wins.
    const root = cleanTree();
    write(root, 'apps/api/.gitignore', '!.env.local\n');
    const found = findings('RI-21', root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('`apps/api/.env.local` IS NOT IGNORED');
    expect(found[0]).toContain('which re-includes it');
    // The root entry the grep would have found is still there, unedited.
    expect(existsSync(join(root, '.gitignore'))).toBe(true);
  });

  test('a rule that lives outside this repository is not this repository having it', () => {
    // `.git/info/exclude` AND A GLOBAL EXCLUDES FILE ARE NOT IN ANY CLONE BUT
    // ONE. A check that accepted them would hold for whoever ran it and for
    // nobody who checks the repository out tomorrow.
    const root = cleanTree();
    ignoring(root, '!.env.example\n');
    write(root, '.git/info/exclude', '.env\n.env.*\n');
    const found = findings('RI-21', root).join('\n');
    expect(found).toContain('at .git/info/exclude, which is not this repository');
  });

  test('LEG 2: an ignore rule is silent about a file that is already tracked', () => {
    // GIT APPLIES `.gitignore` TO UNTRACKED PATHS ONLY. A `.env` committed
    // before the rule landed is in every clone and in the history, and leg 1
    // goes on reporting that the rule holds, which it does. THE FIXTURE FILE IS
    // EMPTY: this suite stages a NAME and never a value.
    const root = cleanTree();
    writeFileSync(join(root, '.env.local'), '');
    execFileSync('git', ['add', '-f', '.env.local'], { cwd: root, stdio: 'ignore' });
    const found = findings('RI-21', root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('`.env.local` is TRACKED');
    expect(found[0]).toContain('applies to untracked paths only');
  });

  test('the committed example is the one tracked spelling leg 2 admits', () => {
    // THE ACCEPTANCE HALF OF LEG 2, so the case above is not passing because
    // every tracked path reports.
    const root = cleanTree();
    writeFileSync(join(root, '.env.example'), 'DATABASE_URL=\n');
    execFileSync('git', ['add', '.env.example'], { cwd: root, stdio: 'ignore' });
    expect(findings('RI-21', root)).toEqual([]);
  });

  test('a root git cannot answer for is an ERROR and never a pass', () => {
    // "A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED", and this one's
    // entire subject is git's own answer, so a directory with no work tree must
    // throw rather than report an empty findings array.
    const root = mkdtempSync(join(tmpdir(), 'merit-invariants-nogit-'));
    seeded.push(root);
    expect(() => findings('RI-21', root)).toThrow(/could not ask git about the ignore rule/);
  });

  test('THE ACCEPTANCE DIRECTION: the three-line rule satisfies every subject', () => {
    // A PROBE THAT ONLY EVER ATTEMPTS FORBIDDEN THINGS PASSES AGAINST A GUARD
    // THAT REJECTS EVERYTHING. The fixture carries the shipped pattern set and
    // this asserts all fourteen subjects are read and cleared.
    const root = cleanTree();
    expect(findings('RI-21', root)).toEqual([]);
    expect(ENV_IGNORE_SUBJECTS.filter((s) => s.ignored)).toHaveLength(9);
    expect(ENV_IGNORE_SUBJECTS.filter((s) => !s.ignored)).toHaveLength(5);
  });

  test('a population with nothing to ignore throws rather than passing over an empty rule', () => {
    // THE SAME GUARD RI-20 CARRIES, one check over: an empty input is silence
    // rather than a green tick, and here the input is the subject list itself.
    const root = cleanTree();
    const shipped = [...ENV_IGNORE_SUBJECTS];
    ENV_IGNORE_SUBJECTS.length = 0;
    ENV_IGNORE_SUBJECTS.push(...shipped.filter((s) => !s.ignored));
    try {
      expect(() => findings('RI-21', root)).toThrow(/no path it expects to be IGNORED/);
    } finally {
      ENV_IGNORE_SUBJECTS.length = 0;
      ENV_IGNORE_SUBJECTS.push(...shipped);
    }
  });
});

// -----------------------------------------------------------------------------
// RI-22, whose subject is what the mint ACTUALLY RETURNS
// -----------------------------------------------------------------------------
//
// Every case below breaks one clause of the contract RI-22 reads and watches it
// fire. THE MINT IS EXECUTED IN EACH ONE, which is what separates this check
// from a static read: the prefix, the counter and the biased index cases are all
// source that looks entirely reasonable and produces a token that is not what
// five documents say it is.

describe('RI-22 measures the certificate code by minting codes', () => {
  /** The fixture mint with one clause replaced. */
  const mintWith = (root: string, from: string, to: string): void => {
    if (!FIXTURE_MINT.includes(from)) throw new Error(`the fixture mint does not contain: ${from}`);
    writeMint(root, FIXTURE_MINT.replace(from, to));
  };

  test('a code too short for the corpus commitment', () => {
    const root = cleanTree();
    mintWith(root, 'CERTIFICATE_CODE_LENGTH = 26', 'CERTIFICATE_CODE_LENGTH = 24');
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('the mint yields 120 bit(s) and the corpus commits to 128');
    expect(found).toContain('24 position(s) over 32 symbol(s) is not enough');
  });

  test('an alphabet that repeats a symbol', () => {
    // THE LOSS IS INVISIBLE TO EVERY ARITHMETIC OVER THE STRING LENGTH: 32
    // characters and 31 symbols, and `.length` reports 32 either way.
    //
    // THE FIXTURE MINT LOADS AND THE SHIPPED ONE REFUSES TO, and the case is
    // written against the fixture's weaker behaviour deliberately: the shipped
    // module's load-time guard is one line a later author can delete, and this
    // asserts RI-22 still catches the repeat when it is gone. The load-failure
    // path has its own case below.
    const root = cleanTree();
    mintWith(root, "'0123456789ABCDEFGHJKMNPQRSTVWXYZ'", "'0123456789ABCDEFGHJKMNPQRSTVWXY0'");
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('32 character(s) and 31 DISTINCT symbol(s)');
    expect(found).toContain('every arithmetic taken over its length reports no loss');
  });

  test('a mint that refuses to load is a finding rather than an environment problem', () => {
    // THE SHIPPED MODULE'S OWN SHAPE. It throws at import rather than reporting
    // a number it cannot support, and RI-22 lifts the thrown message out of the
    // child's stderr rather than the stack frames underneath it.
    const root = cleanTree();
    writeMint(root, FIXTURE_MINT + "throw new Error('CERTIFICATE_CODE_ALPHABET repeats');\n");
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('could not be executed');
    expect(found).toContain('Error: CERTIFICATE_CODE_ALPHABET repeats');
    expect(found).toContain('A mint that does not run mints nothing');
  });

  test('a mint drawn from Math.random rather than node:crypto', () => {
    const root = cleanTree();
    mintWith(
      root,
      "import { randomInt } from 'node:crypto';",
      'const randomInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));',
    );
    const found = findings('RI-22', root);
    expect(found.join('\n')).toContain('does not import from `node:crypto`');
    expect(found.join('\n')).toContain('names `Math.random`');
  });

  test('a mint that folds a clock into the token', () => {
    const root = cleanTree();
    mintWith(root, "  let code = '';", "  let code = '';\n  const at = Date.now();\n  void at;");
    expect(findings('RI-22', root).join('\n')).toContain('names `Date.now`');
  });

  test('a fixed prefix, which is the structure M11 refuses', () => {
    const root = cleanTree();
    // THE LENGTH IS HELD CONSTANT AND ONE POSITION IS SPENT ON THE PREFIX,
    // which is what a version marker actually looks like. Prepending a symbol
    // without shortening the loop makes the code 27 characters and RI-22
    // reports the LENGTH instead, which is the more fundamental finding and
    // hides the one this case is about.
    writeMint(
      root,
      FIXTURE_MINT.replace("  let code = '';", "  let code = 'M';").replace(
        'for (let i = 0;',
        'for (let i = 1;',
      ),
    );
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('position 0 of a minted code showed only 1 of 32 symbol(s)');
    expect(found).toContain('no sequence, NO STRUCTURE');
  });

  test('a counter dressed as a token', () => {
    const root = cleanTree();
    writeMint(
      root,
      "export const CERTIFICATE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';\n" +
        'export const CERTIFICATE_CODE_LENGTH = 26;\n' +
        'export const CERTIFICATE_CODE_ENTROPY_BITS = 130;\n' +
        'let next = 0;\n' +
        'export function mintCertificateCode() {\n' +
        '  next += 1;\n' +
        "  return String(next % 97).padStart(CERTIFICATE_CODE_LENGTH, '0');\n" +
        '}\n',
    );
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('produced 97 distinct code(s)');
    expect(found).toContain('this is a mint with state');
  });

  test('a symbol outside the declared alphabet', () => {
    // THE ALPHABET IS THE DENOMINATOR OF THE BIT COUNT, so a mint drawing from a
    // different set is measured against the wrong number in both directions.
    const root = cleanTree();
    mintWith(root, '  return code;', "  return '-' + code.slice(1);");
    expect(findings('RI-22', root).join('\n')).toContain(
      'symbol(s) outside the declared alphabet: "-"',
    );
  });

  test('a module whose exported bit count is not the one its own alphabet gives', () => {
    const root = cleanTree();
    mintWith(
      root,
      'export const CERTIFICATE_CODE_ENTROPY_BITS = Math.floor(\n' +
        '  CERTIFICATE_CODE_LENGTH * Math.log2(new Set(CERTIFICATE_CODE_ALPHABET).size),\n' +
        ');',
      'export const CERTIFICATE_CODE_ENTROPY_BITS = 999;',
    );
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('reports 999 bit(s)');
    expect(found).toContain('is 130');
  });

  test('the corpus disagreeing with itself about the commitment', () => {
    const root = cleanTree();
    appendTo(root, 'docs/edge-cases/EC-091.md', 'Restated as **192 bits of entropy**.\n');
    const found = findings('RI-22', root).join('\n');
    expect(found).toContain('states MORE THAN ONE bit count');
    expect(found).toContain('a mint cannot be measured against a threshold the corpus');
  });

  test('the mint deleted, which is the state ADR-235 was opened on', () => {
    const root = cleanTree();
    rmSync(join(root, 'packages/db/src/certificate-code.ts'));
    expect(findings('RI-22', root).join('\n')).toContain(
      'produced by no function in the repository',
    );
  });

  test('a writer of certificates that mints its own code', () => {
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/issue.ts',
      "await tx.insert('certificates', { code: 'MERIT-0001' });\n",
    );
    expect(findings('RI-22', root).join('\n')).toContain(
      'writes a `certificates` row and never names `mintCertificateCode`',
    );
  });

  test('a writer of certificates that reaches the mint is accepted', () => {
    // THE ACCEPTANCE DIRECTION. A leg that only ever refuses is a leg that would
    // pass over an issuer doing the right thing, and leg 3 has no site in the
    // shipped tree yet, so this case is the only place it is exercised at all.
    const root = cleanTree();
    write(
      root,
      'apps/api/src/routes/issue.ts',
      "import { mintCertificateCode } from '@merit/db';\n" +
        "await tx.insert('certificates', { code: mintCertificateCode() });\n",
    );
    expect(findings('RI-22', root)).toEqual([]);
  });

  test('a corpus stating no bit count at all throws rather than passing', () => {
    // THE SAME GUARD RI-20 AND RI-21 CARRY. A threshold read from nothing is a
    // mint measured against nothing, and this check exists because five
    // documents stated the figure while no runner read any of them.
    const root = cleanTree();
    for (const rel of ['docs/plans/M11-certificates-social-proof.md', 'docs/edge-cases/EC-091.md'])
      writeFileSync(join(root, rel), 'No number here.\n');
    writeFileSync(join(root, 'docs/architecture/API_CONTRACT.md'), '```ts\ntype X = {};\n```\n');
    expect(() => findings('RI-22', root)).toThrow(/found NO stated bit count/);
  });

  test('a commitment document that moved is a finding rather than a smaller population', () => {
    const root = cleanTree();
    renameSync(join(root, 'docs/edge-cases/EC-091.md'), join(root, 'docs/edge-cases/EC-099.md'));
    expect(findings('RI-22', root).join('\n')).toContain('point it at the new path');
  });
});

// -----------------------------------------------------------------------------
// RI-23, whose subject is an approval that CLAIMS to be earned
// -----------------------------------------------------------------------------
// ADR-227 SECTION 3 MADE A CLASS B APPROVAL AN ARTIFACT RATHER THAN A
// SIGNATURE, and the way that regime fails is not that somebody forges a
// signature: it is that an entry writes the vocabulary of an earned approval
// with nothing behind it. Each case below breaks exactly one of the two
// conditions RI-23 can read and watches it fire, and the last two are the
// scope predicate in both directions, because a check that matched a ruling
// ABOUT class B would be asking an entry to put a transcript in its own
// ruling, and a check that matched nothing would pass forever.
const CLASS_B_ENTRY = [
  '## ADR-900: a claim (2026-08-29, status: proposed)',
  '',
  '- **CLASS B APPROVAL, EARNED 2026-08-29 UNDER [ADR-227](ADR-227.md) SECTION 3.**',
  '  The assertion is [`apps/api/test/adr-900-the-claim.test.ts`](../../apps/api/test/adr-900-the-claim.test.ts),',
  '  watched RED on the real tree and GREEN after a byte-identical restore.',
  '',
].join('\n');

describe('RI-23 refuses a class B approval that is a signature in a test’s clothes', () => {
  /** Put the suite the fixture entry names on the fixture's disk. */
  const withSuite = (root: string): string => {
    write(root, 'apps/api/test/adr-900-the-claim.test.ts', 'export {};\n');
    return root;
  };

  test('the clean shape passes, so the seeds below are evidence', () => {
    const root = withSuite(cleanTree());
    write(root, 'docs/decisions/ADR-900.md', CLASS_B_ENTRY);
    expect(findings('RI-23', root)).toEqual([]);
  });

  test('a suite cited by BARE BASENAME resolves, because the corpus cites them that way', () => {
    const root = withSuite(cleanTree());
    write(
      root,
      'docs/decisions/ADR-900.md',
      CLASS_B_ENTRY.replace(
        /The assertion is .*$/m,
        'The assertion is `adr-900-the-claim.test.ts`, watched RED.',
      ),
    );
    expect(findings('RI-23', root)).toEqual([]);
  });

  test('an approval that names no assertion is refused', () => {
    const root = withSuite(cleanTree());
    write(
      root,
      'docs/decisions/ADR-900.md',
      CLASS_B_ENTRY.replace(
        /The assertion is .*$/m,
        'The claim is a PROPERTY and it was watched RED.',
      ),
    );
    expect(findings('RI-23', root).join('\n')).toContain('names no assertion');
  });

  test('an approval resting on a suite that is not on disk is refused', () => {
    const root = withSuite(cleanTree());
    write(
      root,
      'docs/decisions/ADR-900.md',
      CLASS_B_ENTRY.replace(/adr-900-the-claim\.test\.ts/g, 'a-suite-nobody-wrote.test.ts'),
    );
    expect(findings('RI-23', root).join('\n')).toContain('is not on disk');
  });

  test('an approval that records no RED is refused, which is ADR-227 condition 2', () => {
    const root = withSuite(cleanTree());
    write(
      root,
      'docs/decisions/ADR-900.md',
      CLASS_B_ENTRY.replace('watched RED on the real tree and GREEN', 'GREEN'),
    );
    expect(findings('RI-23', root).join('\n')).toContain('states no RED');
  });

  test('a RULING about class B approvals is not a recorded one, and stays out of scope', () => {
    // THE FALSE POSITIVE THIS CHECK WOULD OTHERWISE HAVE. ADR-243 section 3
    // clause 4 reads "**4. A CLASS B APPROVAL IS RECORDED IN THE ENTRY IT
    // APPROVES**", inside a blockquote, and it names no assertion and no red
    // because it is a rule rather than an approval. The marker must OPEN the
    // bolded run, so this is silent, and the clean case above is what says the
    // narrowing did not simply switch the check off.
    const root = withSuite(cleanTree());
    write(
      root,
      'docs/decisions/ADR-900.md',
      [
        '## ADR-900: a ruling (2026-08-29, status: proposed)',
        '',
        '> **4. A CLASS B APPROVAL IS RECORDED IN THE ENTRY IT APPROVES.**',
        '',
        CLASS_B_ENTRY,
      ].join('\n'),
    );
    expect(findings('RI-23', root)).toEqual([]);
  });

  test('a corpus of entries carrying no marker at all is a finding, not a pass', () => {
    // A CHECK WHOSE SCOPE PREDICATE IS A PHRASE STOPS CHECKING WHEN THE PHRASE
    // DRIFTS, silently and while reporting PASS. That is this file's first rule
    // broken where nobody sees it, so an empty scope over a non-empty corpus is
    // reported rather than assumed to mean there is nothing to check.
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ADR-900.md',
      '## ADR-900: a claim (2026-08-29, status: proposed)\n',
    );
    expect(findings('RI-23', root).join('\n')).toContain('found NO block carrying the marker');
  });
});

// -----------------------------------------------------------------------------
// RI-25, whose subject is a defect that was LIVE ON `main` and asymmetric
// -----------------------------------------------------------------------------
// ADR-268 section 7 measured it and ADR-271 repaired it: `pg` parsed a `date`
// (OID 1082) into a `Date` at the process's LOCAL MIDNIGHT, drizzle rendered
// that with `toISOString()`, and the database's `2026-08-28` reached Merit code
// as `'2026-08-27'` on every deployment east of UTC.
//
// THE FIXTURE CARRIES NO `client.ts`, so the clean-tree case above passes by the
// silence RI-25's `covers` line states. Every case here writes one, which is
// what puts the tree in the check's scope at all -- the first case below is that
// pairing asserted rather than assumed.
describe('RI-25 keeps one date type parser aimed at the day OID', () => {
  const REPAIRED =
    "import { Pool, types as pgTypes } from 'pg';\n" +
    'const DATE_OID = 1082;\n' +
    'export function dateWireText(wire) { return wire; }\n' +
    'pgTypes.setTypeParser(DATE_OID, dateWireText);\n';

  /** A tree in RI-25's scope: the fixture plus the one file that constructs the pool. */
  const treeWithClient = (body: string): string => {
    const root = cleanTree();
    write(root, 'packages/db/src/client.ts', body);
    return root;
  };

  test('the repaired file holds, and a tree with no client.ts is silent', () => {
    expect(findings('RI-25', treeWithClient(REPAIRED))).toEqual([]);
    // THE SILENCE IS ASSERTED RATHER THAN RELIED ON. If this stopped being
    // silent, every case below would be reading a finding the seed did not
    // cause, and if the SCOPE stopped working they would all pass for nothing.
    expect(findings('RI-25', cleanTree())).toEqual([]);
  });

  test('a client.ts that installs no parser is the defect ADR-268 measured', () => {
    const root = treeWithClient("import { Pool } from 'pg';\nexport const p = Pool;\n");
    expect(findings('RI-25', root).join('\n')).toContain('calls setTypeParser nowhere');
  });

  test('a parser aimed at some other OID does not repair the day', () => {
    const root = treeWithClient('pgTypes.setTypeParser(1700, (v) => v);\n');
    expect(findings('RI-25', root).join('\n')).toContain('none of those is 1082');
  });

  test('THE THIRD TRAP: a parser on timestamptz is a finding even beside a correct one', () => {
    const root = treeWithClient(REPAIRED + 'pgTypes.setTypeParser(1184, (v) => v);\n');
    expect(findings('RI-25', root).join('\n')).toContain('OID 1184 (`timestamptz`)');
  });

  test('and on timestamp, which is the same answer for the same reason', () => {
    const root = treeWithClient(REPAIRED + 'pgTypes.setTypeParser(1114, (v) => v);\n');
    expect(findings('RI-25', root).join('\n')).toContain('OID 1114 (`timestamp`)');
  });

  test('THE SECOND TRAP: a second parser anywhere else in a src directory', () => {
    const root = treeWithClient(REPAIRED);
    write(root, 'apps/worker/src/db.ts', 'types.setTypeParser(1082, (v) => v);\n');
    expect(findings('RI-25', root).join('\n')).toContain(
      'apps/worker/src/db.ts names setTypeParser',
    );
  });

  test('a test file naming it while asserting ABOUT it is not installing one', () => {
    // THE DISTINCTION THE CHECK IS SCOPED ON, watched rather than trusted.
    // `last-closed-trading-day-door.test.ts` and `date-column-timezone.test.ts`
    // both hold this string in the real tree, and a check that read tests would
    // report the repair's own controls as violations of it.
    const root = treeWithClient(REPAIRED);
    write(root, 'packages/db/test/x.test.ts', "expect(src).toContain('setTypeParser');\n");
    write(root, 'packages/db/src/__tests__/y.ts', "expect(src).toContain('setTypeParser');\n");
    expect(findings('RI-25', root)).toEqual([]);
  });

  test('the OID may be named through a constant, which is how client.ts names it', () => {
    const named = treeWithClient('const DATE_OID = 1082;\nsetTypeParser(DATE_OID, (v) => v);\n');
    expect(findings('RI-25', named)).toEqual([]);
    // A constant that is NOT 1082 must still fail, or leg 1 would pass on any
    // identifier at all and the OID check would be decorative.
    const wrong = treeWithClient('const OID = 1700;\nsetTypeParser(OID, (v) => v);\n');
    expect(findings('RI-25', wrong).join('\n')).toContain('none of those is 1082');
  });

  test('prose naming the call does not satisfy the call, which is RI-24s shape', () => {
    const root = treeWithClient(
      '// ADR-271 installs setTypeParser 1082 here, honestly it does\n' +
        "import { Pool } from 'pg';\nexport const p = Pool;\n",
    );
    expect(findings('RI-25', root).join('\n')).toContain('calls setTypeParser nowhere');
  });

  test('THE CALL COMMENTED OUT IS THE CALL ABSENT, which is how a revert looks', () => {
    // THIS CASE EXISTS BECAUSE THE SEED FOUND THE CHECK WRONG. RI-25's first
    // version matched the raw file, so commenting the call out -- the exact
    // shape of reverting this repair -- left the text in place and RI-25
    // reported PASS while the estate was back to reading days at local
    // midnight. Comments are stripped now, and this is that fix watched.
    const root = treeWithClient(REPAIRED.replace(/^pgTypes\./m, '// pgTypes.'));
    expect(findings('RI-25', root).join('\n')).toContain('calls setTypeParser nowhere');
  });

  test('a block comment quoting the whole repair does not satisfy it either', () => {
    const root = treeWithClient(
      `/* the repair reads:\n${REPAIRED}\n*/\nimport { Pool } from 'pg';\nexport const p = Pool;\n`,
    );
    expect(findings('RI-25', root).join('\n')).toContain('calls setTypeParser nowhere');
  });
});

// -----------------------------------------------------------------------------
// RI-26, whose subject is a name that is FALSE rather than a name that is silent
// -----------------------------------------------------------------------------
// ADR-272, and ADR-278 for the rename fold. The check has two legs and each is
// asserted in BOTH directions, so the fixture has to carry the ruled exception
// rather than a clean estate: an exception set that is never observed to be
// violated is the same shape as a reader that stopped reading, and the check is
// supposed to say so.
//
// THE FIXTURE ALSO CARRIES A REPAIR, WHICH IS NEW WITH ADR-278. `0045` declares
// `calibration_observed_at date` and `0075` renames it; E2 makes the first
// permanent, so the estate's DECLARATIONS and its INSTALLED schema disagree here
// and every case below is written against the second. Deleting `0075` from the
// fixture is the seed that proves the fold is load bearing, and it is a test.
//
// EVERY CASE HERE WRITES A MIGRATIONS DIRECTORY, because a tree without one is
// silent by design and would pass every case for the wrong reason.
describe('RI-26 keeps a temporal column name honest about its own type', () => {
  /**
   * The two ruled exceptions, in the migrations RI-26 names as their witnesses,
   * plus enough ordinary schema for the legs to have a population.
   */
  const CATALOG =
    'CREATE TABLE geo_restrictions (\n' +
    '  effective_from  date NOT NULL,\n' +
    '  created_at      timestamptz NOT NULL\n' +
    ');\n';
  const SIMULATION_RUNS =
    '-- THE DAY THE FIGURES WERE OBSERVED. `calibration_observed_at` is a `date`\n' +
    '-- and not a timestamptz, and this header says so at length.\n' +
    'CREATE TABLE simulation_runs (\n' +
    '  calibration_observed_at date NOT NULL,\n' +
    '  started_at              timestamptz NOT NULL\n' +
    ');\n';
  const FIRM_PARAMETERS =
    'CREATE TABLE firm_parameters (\n' +
    '  effective_from  timestamptz NOT NULL,\n' +
    '  created_at      timestamptz NOT NULL\n' +
    ');\n';
  /** ADR-278's repair. `0045` above is untouched, because E2 forbids editing it. */
  const RENAME =
    '-- ADR-278. `calibration_observed_at` was a `date` wearing an instant suffix.\n' +
    'ALTER TABLE simulation_runs\n' +
    '  RENAME COLUMN calibration_observed_at TO calibration_observed_on;\n';
  const ESTATE: Record<string, string> = {
    '0004_catalog.sql': CATALOG,
    '0045_simulation_runs.sql': SIMULATION_RUNS,
    '0074_firm_parameters.sql': FIRM_PARAMETERS,
    '0075_calibration_observed_on.sql': RENAME,
  };

  /** The estate as it stands, with named files replaced or added. */
  const estate = (overrides: Record<string, string> = {}): string => {
    const root = cleanTree();
    for (const [file, body] of Object.entries({ ...ESTATE, ...overrides })) {
      write(root, `packages/db/migrations/${file}`, body);
    }
    return root;
  };

  test('the estate as it stands holds: the ruled collision observed, the `_at` repaired', () => {
    expect(findings('RI-26', estate())).toEqual([]);
  });

  test('the real repository holds', () => {
    expect(findings('RI-26', REPO_ROOT)).toEqual([]);
  });

  // LEG 1, FORWARD.
  test('a NEW `_at` column declared `date` is a finding', () => {
    const root = estate({
      '0050_new.sql': 'CREATE TABLE things (\n  reviewed_at date NOT NULL\n);\n',
    });
    expect(findings('RI-26', root).join('\n')).toContain('reviewed_at is declared `date`');
  });

  test('`ADD COLUMN` reaches it too, which a `CREATE TABLE` reader would miss', () => {
    const root = estate({
      '0050_new.sql': 'ALTER TABLE accounts\n  ADD COLUMN reviewed_at date NOT NULL;\n',
    });
    expect(findings('RI-26', root).join('\n')).toContain('reviewed_at is declared `date`');
  });

  // LEG 1 HAS NO EXCEPTION TO GO STALE ANY MORE, SO THE FOLD CARRIES THAT
  // DIRECTION INSTEAD (ADR-278). These two are the seeds that would have caught
  // the reader shipping unfolded: the first proves the repair is what makes the
  // tree green, the second proves the fold feeds leg 1 rather than bypassing it.
  test('WITHOUT the renaming migration the estate is a finding again', () => {
    const root = cleanTree();
    for (const [file, body] of Object.entries(ESTATE)) {
      if (file === '0075_calibration_observed_on.sql') continue;
      write(root, `packages/db/migrations/${file}`, body);
    }
    expect(findings('RI-26', root).join('\n')).toContain(
      'calibration_observed_at is declared `date` in 0045_simulation_runs.sql',
    );
  });

  test('a rename INTO a false name is a finding, so the fold feeds leg 1', () => {
    const root = estate({
      '0076_new.sql':
        'ALTER TABLE geo_restrictions RENAME COLUMN effective_from TO effective_at;\n',
    });
    expect(findings('RI-26', root).join('\n')).toContain('effective_at is declared `date`');
  });

  test('the fold reads the form with the COLUMN keyword omitted, which is legal DDL', () => {
    const root = estate({
      '0075_calibration_observed_on.sql':
        'ALTER TABLE simulation_runs RENAME calibration_observed_at TO calibration_observed_on;\n',
    });
    expect(findings('RI-26', root)).toEqual([]);
  });

  test("a rename named only in a COMMENT folds nothing, on RI-25's seed", () => {
    const root = estate({
      '0075_calibration_observed_on.sql':
        '-- ALTER TABLE simulation_runs RENAME COLUMN calibration_observed_at TO x;\n',
    });
    expect(findings('RI-26', root).join('\n')).toContain(
      'calibration_observed_at is declared `date`',
    );
  });

  // A DROP HAS NO FOLD AND MUST NOT BE IGNORED. This reader would otherwise go
  // on asserting about a column the database does not have, which is the
  // suppression list the exception sets were shaped to avoid, reached through
  // the reader instead of through an entry.
  test('a `DROP COLUMN` anywhere in the set is a THROW, never a silent pass', () => {
    const root = estate({
      '0076_new.sql': 'ALTER TABLE simulation_runs DROP COLUMN started_at;\n',
    });
    expect(() => findings('RI-26', root)).toThrow(/DROP COLUMN.*and has no fold/s);
  });

  // LEG 2, FORWARD.
  test('one name declared `date` in one table and `timestamptz` in another is a finding', () => {
    const root = estate({
      '0050_new.sql': 'CREATE TABLE windows (\n  period_start date NOT NULL\n);\n',
      '0051_new.sql': 'CREATE TABLE spans (\n  period_start timestamptz NOT NULL\n);\n',
    });
    expect(findings('RI-26', root).join('\n')).toContain('period_start is declared `date`');
  });

  test('`timestamp with time zone` spelled long-form is an instant, not a third thing', () => {
    const root = estate({
      '0050_new.sql':
        'CREATE TABLE windows (\n  audited_at timestamp with time zone NOT NULL\n);\n',
    });
    expect(findings('RI-26', root)).toEqual([]);
  });

  // LEG 2, REVERSE.
  test('repairing the ruled collision turns that entry stale, which is a finding', () => {
    const root = estate({
      '0074_firm_parameters.sql': FIRM_PARAMETERS.replace(
        'effective_from  timestamptz',
        'effective_at    timestamptz',
      ),
    });
    expect(findings('RI-26', root).join('\n')).toContain(
      'carries effective_from as a ruled day/instant collision',
    );
  });

  // THE RULING ITSELF, WATCHED. ADR-272 section 3 rules that a suffix lying
  // ACROSS type families is not this defect, and a check is the only place that
  // ruling can be wrong in a way somebody notices.
  test('`_day` on a boolean and `_on` on an array are NOT findings, which is the ruling', () => {
    const root = estate({
      '0050_new.sql':
        'CREATE TABLE daily_marks (\n' +
        '  trading_day date NOT NULL,\n' +
        '  traded_day  boolean NOT NULL,\n' +
        '  win_day     boolean NOT NULL,\n' +
        "  breaks_on   text[] NOT NULL DEFAULT '{}'\n" +
        ');\n',
    });
    expect(findings('RI-26', root)).toEqual([]);
  });

  // RI-25's SEED, ONE FILE TYPE OVER. A migration in this estate carries more
  // prose than DDL and `0045`'s header discusses its own defect by name, so a
  // reader that did not strip comments would find the subject in the sentence
  // about the subject.
  test('a comment describing a bad column does not declare one', () => {
    const root = estate({
      '0050_new.sql':
        '-- A column named `reviewed_at date NOT NULL` would be the ADR-272 defect.\n' +
        '/* reviewed_at date NOT NULL, */\n' +
        'CREATE TABLE things (\n  reviewed_at timestamptz NOT NULL\n);\n',
    });
    expect(findings('RI-26', root)).toEqual([]);
  });

  test('a plpgsql DECLARE block is not a table, so its local variables are not columns', () => {
    const root = estate({
      '0050_new.sql':
        'CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\n' +
        'DECLARE\n' +
        '  fold_extent date;\n' +
        '  checked_at  date;\n' +
        'BEGIN\n' +
        '  RETURN NULL;\n' +
        'END;\n' +
        '$$;\n',
    });
    expect(findings('RI-26', root)).toEqual([]);
  });

  // THE READER'S OWN FAILURE, AND IT THROWS RATHER THAN PASSING. A tree
  // carrying the witness migrations and parsing to nothing is not a repaired
  // estate; it is a check that has stopped reading.
  // LEG 1'S SENTINEL, WHICH REPLACES THE STALE-ENTRY HALF ADR-278 RETIRED. With
  // no exception left, nothing else asserts that the suffix filter still
  // matches: a reader that stopped seeing `_at` would report a clean estate over
  // all 321 of them. This tree parses temporal columns and has no `_at` among
  // them, which the real estate cannot be.
  test('temporal columns but not one `*_at` among them is a THROW', () => {
    const root = cleanTree();
    write(
      root,
      'packages/db/migrations/0001_only.sql',
      'CREATE TABLE things (\n  trading_day date NOT NULL,\n  opened_on date NOT NULL\n);\n',
    );
    expect(() => findings('RI-26', root)).toThrow(/found no `\*_at` temporal column among the 2/);
  });

  test('witness migrations present and nothing parsed is a THROW, never a pass', () => {
    const root = estate(
      Object.fromEntries(
        Object.entries(ESTATE).map(([file, body]) => [
          file,
          body
            .split('\n')
            .map((line) => `-- ${line}`)
            .join('\n'),
        ]),
      ),
    );
    expect(() => findings('RI-26', root)).toThrow(/has stopped|reader or the comment stripper/);
  });
});

// -----------------------------------------------------------------------------
// RI-28, the other half of the same subject
// -----------------------------------------------------------------------------
// RI-25 keeps the DRIVER from giving a calendar day a timezone. RI-28 keeps
// MERIT'S OWN LINES from asking what the process's timezone is, which is the
// larger half: the driver was one library doing one coercion, and this is every
// line anybody writes from here on (ADR-274).
//
// THE FIXTURE IS ALREADY IN SCOPE, unlike RI-25's, because `cleanTree()` writes
// several `apps/*/src` files. So the clean-tree cases above are a real pass over
// a non-empty file list rather than a silence, and the seeds here write into
// that same scope.
describe('RI-28 refuses a process-local clock in shipped source', () => {
  /** A tree in RI-28's scope: the fixture plus one source file carrying the seed. */
  const treeWithSource = (body: string): string => {
    const root = cleanTree();
    write(root, 'apps/api/src/clock-seed.ts', body);
    return root;
  };

  test('the clean fixture holds, and the scope it holds over is not empty', () => {
    const root = cleanTree();
    expect(findings('RI-28', root)).toEqual([]);
    // THE PASS IS ASSERTED TO BE A REAL ONE. A filter that stopped matching
    // would make every case in this block pass by reading nothing, so the
    // admitted spellings are exercised here and the sentinel is exercised in
    // the throwing direction in the last case of this block.
    expect(
      findings(
        'RI-28',
        treeWithSource(
          'const a = new Date(Date.UTC(2026, 7, 28)).getUTCDate();\n' +
            'const b = new Date(`2026-08-28T00:00:00Z`).toISOString();\n' +
            "const c = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago' });\n" +
            'const d = new Date(1);\n',
        ),
      ),
    ).toEqual([]);
  });

  test.each([
    [
      'a local component getter',
      'export const h = new Date().getHours();\n',
      "reads the process's",
    ],
    [
      'a local component setter',
      'export const d = new Date();\nd.setHours(0);\n',
      "writes the process's",
    ],
    [
      'a local rendering',
      'export const s = new Date().toDateString();\n',
      "renders through the process's",
    ],
    ['a `process.env.TZ` read', "export const z = process.env['TZ'];\n", "asks for the process's"],
    [
      'the multi-argument constructor',
      'export const m = new Date(2026, 7, 28);\n',
      'constructs a `Date` from 3 components',
    ],
    [
      'a formatter naming no zone',
      "export const f = new Intl.DateTimeFormat('en-US', { hour: '2-digit' });\n",
      'naming no `timeZone`',
    ],
  ])('RI-28 catches %s', (_what, body, needle) => {
    expect(findings('RI-28', treeWithSource(body)).join('\n')).toContain(needle);
  });

  test('a `getUTC*` read is the admitted spelling and is not the getter it contains', () => {
    // `getUTCDate` CONTAINS `getDate` AS A SUBSTRING IN NEITHER DIRECTION, and
    // this case is what keeps a future widening of the pattern from banning the
    // one spelling the check exists to send people to.
    expect(
      findings('RI-28', treeWithSource('export const u = new Date(1).getUTCDate();\n')),
    ).toEqual([]);
  });

  test('COMMENTS ARE STRIPPED, AND THAT IS LOAD-BEARING RATHER THAN DEFENSIVE', () => {
    // RI-25's seed found the same mechanism mattering in the OPPOSITE
    // direction: there a comment made a presence check pass falsely. Here a
    // comment would make an ABSENCE check fail falsely, and it is not
    // hypothetical -- measured on the real tree while ADR-274 was written, the
    // unstripped scan reports three findings, all of them prose in
    // `scripts/ci/`. The files that talk most about a local clock are the
    // headers of the files that refuse to use one.
    const prose =
      '// never call new Date().getHours() or toLocaleString(), and do not read\n' +
      '// process.env.TZ. See ADR-274.\n' +
      '/* nor new Date(2026, 7, 28), nor Intl.DateTimeFormat("en-US", {}) */\n' +
      'export const ok = new Date(Date.UTC(2026, 7, 28)).toISOString();\n';
    expect(findings('RI-28', treeWithSource(prose))).toEqual([]);
  });

  test('a trailing comma is not a second argument', () => {
    // PRETTIER WRITES ONE whenever a single argument spans lines, and counting
    // commas rather than arguments reported `packages/kyc/src/fakes/provider.ts`
    // as a local construction while this check was being written.
    const wrapped =
      'export const e = new Date(\n  Date.UTC(2026, 7, 28) + 1000,\n).toISOString();\n';
    expect(findings('RI-28', treeWithSource(wrapped))).toEqual([]);
  });

  test('a test file is out of scope, because building one on purpose is not using one', () => {
    const root = cleanTree();
    write(
      root,
      'packages/db/test/date-column-timezone.test.ts',
      'const x = new Date(2026, 7, 28);\n',
    );
    write(root, 'apps/api/src/e2e/pass.ts', 'const y = new Date().getHours();\n');
    expect(findings('RI-28', root)).toEqual([]);
  });

  test('a scope that matches nothing THROWS rather than reporting a clean tree', () => {
    // THE DIRECTION THAT MATTERS, and it is the one every case above depends
    // on. RI-28 is an ABSENCE check, so a path filter that stopped matching
    // reports PASS about an empty list while a local clock read anywhere in the
    // tree goes unseen. That failure is silent in a way a presence check's is
    // not, which is why the sentinel is a throw and not a finding.
    const root = mkdtempSync(join(tmpdir(), 'merit-invariants-empty-'));
    seeded.push(root);
    write(root, 'docs/STATE.md', '# not source\n');
    expect(() => findings('RI-28', root)).toThrow(/found no source file/);
  });
});

// -----------------------------------------------------------------------------
// RI-29, the register nothing read
// -----------------------------------------------------------------------------
// EVERY CASE BELOW SEEDS THE REGISTER RATHER THAN THE CHECKS ARRAY, because the
// array is this file's own import and a case that mutated it would be testing
// the fixture. The register is a document, which is the half that drifts.
//
// THE CLEAN DIRECTION IS COVERED TWICE ALREADY and it is worth naming: the real
// tree runs at the top of this file, and the fixture's own register is derived
// from `CHECKS`, so a case that seeds nothing must report nothing on both.
describe('RI-29 binds the invariant register to the live CHECKS array', () => {
  /** A tree whose register is the fixture's, with one id replaced or dropped. */
  const treeWithRegister = (overrides: Readonly<Record<string, string | null>>): string => {
    const root = cleanTree();
    write(root, 'docs/decisions/ALLOCATION.md', allocationDoc(register(overrides)));
    return root;
  };

  test('a check with no register row is a finding', () => {
    // THE DEFECT ADR-275 EXISTS FOR, and the one that was live on the real tree:
    // `RI-11` had been a member of `CHECKS` since it was written and this table
    // had never carried a row for it, invisible to every gate.
    expect(findings('RI-29', treeWithRegister({ 'RI-11': null })).join('\n')).toContain(
      'carries no register row for `RI-11`',
    );
  });

  test('a register row naming no check that exists is a finding', () => {
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ALLOCATION.md',
      allocationDoc([
        ...register(),
        '| `RI-90` | a number nobody minted | Something nothing checks |',
      ]),
    );
    expect(findings('RI-29', root).join('\n')).toContain('registers `RI-90`, which is not in');
  });

  test('a row whose check lives outside CHECKS passes when it names its home', () => {
    // `RI-17` IS THIS ROW ON THE REAL TREE and it is why leg 2 is not simply
    // membership of `CHECKS`. Its check landed in `apps/api/test/` because
    // `packages/tooling` resolves neither `@merit/api` nor `fastify`, and the
    // row's own cell names the file. NO EXEMPTION LIST IS KEPT IN THE CHECK:
    // the admission is derived from the row, so a row that stops naming a real
    // home goes red without anything here being edited.
    const root = cleanTree();
    write(root, 'apps/api/test/elsewhere.test.ts', "describe('RI-90', () => {});\n");
    write(
      root,
      'docs/decisions/ALLOCATION.md',
      allocationDoc([
        ...register(),
        '| `RI-90` | a check outside the array | **LANDED as ' +
          '[`apps/api/test/elsewhere.test.ts`](../../apps/api/test/elsewhere.test.ts)** |',
      ]),
    );
    expect(findings('RI-29', root)).toEqual([]);
  });

  test('a home link that names a file which does not exist is still a finding', () => {
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ALLOCATION.md',
      allocationDoc([
        ...register(),
        '| `RI-90` | a check outside the array | **LANDED as ' +
          '[`apps/api/test/gone.test.ts`](../../apps/api/test/gone.test.ts)** |',
      ]),
    );
    expect(findings('RI-29', root).join('\n')).toContain('registers `RI-90`, which is not in');
  });

  test('a title that has drifted from the live array is a finding', () => {
    // THE LEG WHERE THE VALUE IS. Four rows on the real tree failed this and
    // two of them asserted in their own text that the title had been copied out
    // of the array while carrying no title at all.
    const drifted = '| `RI-05` | the fixture`s register | The Node version is written once |';
    expect(findings('RI-29', treeWithRegister({ 'RI-05': drifted })).join('\n')).toContain(
      'states what `RI-05` asserts without carrying the title',
    );
  });

  test('a title the row merely paraphrases is a finding, and containment is what passes', () => {
    // CONTAINMENT RATHER THAN EQUALITY IS THE RULE, and it is stated rather than
    // implied: rows RI-17 and later wrap the title in prose about where the
    // check landed and what it was watched doing, which is worth keeping.
    const c = CHECKS.find((check) => check.id === 'RI-05');
    const wrapped = `| \`RI-05\` | the fixture\`s register | **LANDED**, title read live: *"${c?.title ?? ''}"*, and watched RED |`;
    expect(findings('RI-29', treeWithRegister({ 'RI-05': wrapped }))).toEqual([]);
  });

  test('two rows for one number is a finding', () => {
    const root = cleanTree();
    write(
      root,
      'docs/decisions/ALLOCATION.md',
      allocationDoc([...register(), '| `RI-05` | a renumber recorded twice | .nvmrc |']),
    );
    expect(findings('RI-29', root).join('\n')).toContain('holds 2 register rows for `RI-05`');
  });

  test('a two-cell orphan fragment is a finding, which is the shape no table gate reads', () => {
    // `RI-23`'s ROW SAT THIS WAY FOR A WAVE. `CI-06/table-row-width` parses rows
    // of tables and a fragment after a blank line is not part of one, so the
    // only gate that could have seen it was the one that did not exist.
    const orphan = '| `RI-05` | .nvmrc is the only place the Node version is written |';
    expect(findings('RI-29', treeWithRegister({ 'RI-05': orphan })).join('\n')).toContain(
      'register row carrying 2 cell(s) where the register declares 3',
    );
  });

  test('a register with no rows THROWS rather than reporting a clean tree', () => {
    // THE DIRECTION THAT FAILS SILENTLY. With no rows parsed, leg 2 and leg 3
    // assert about an empty list, and leg 1 is worse than silent: it would
    // report every check as unregistered and name the wrong defect entirely.
    const root = cleanTree();
    write(root, 'docs/decisions/ALLOCATION.md', allocationDoc([]));
    expect(() => findings('RI-29', root)).toThrow(/found no `RI-nn` row/);
  });

  test('a register document that is gone THROWS, because a missing one is not an empty one', () => {
    const root = cleanTree();
    renameSync(
      join(root, 'docs/decisions/ALLOCATION.md'),
      join(root, 'docs/decisions/ALLOCATION.md.moved'),
    );
    expect(() => findings('RI-29', root)).toThrow(/cannot run/);
  });
});

// -----------------------------------------------------------------------------
// RI-31, whose subject is a line the generator wrote rather than a line's length
// -----------------------------------------------------------------------------
// THE TWO DIRECTIONS ARE NOT SYMMETRIC AND BOTH ARE HERE. A check that fires on
// a doubled generated line is easy; a check that stays quiet about the four
// shapes below is the whole reason it can have no ceiling and no length floor.
// ADR-282 ruled each of them on measurement rather than on taste, so each is a
// case here where it cannot quietly stop being true.
describe('RI-31 refuses a generated line written twice, and only that', () => {
  const SPAN = '<!--gen:gate_count-->33<!--/gen-->';

  test('a generated line doubled inside one file is a finding', () => {
    const root = cleanTree();
    write(
      root,
      'docs/testing/SPANS.md',
      `# Spans\n\nThe corpus holds ${SPAN} gates.\nThe corpus holds ${SPAN} gates.\n`,
    );
    expect(findings('RI-31', root).join('\n')).toContain('docs/testing/SPANS.md:3,4');
  });

  // THE SCOPE LEG, AND IT IS THE ONE THE ROW'S FENCE GOT WRONG. RI-12 reads
  // `docs/`; the generator writes every `.md` in the tree, and the file that
  // held seven of the fifteen live instances was `packages/db/DELTA_MANIFEST.md`.
  // A check that only walked `docs/` would report PASS here.
  test('a generated line doubled OUTSIDE docs/ is a finding', () => {
    const root = cleanTree();
    write(
      root,
      'packages/db/DELTA_MANIFEST.md',
      `# Manifest\n\nThe corpus holds ${SPAN} gates.\nThe corpus holds ${SPAN} gates.\n`,
    );
    expect(findings('RI-31', root).join('\n')).toContain('packages/db/DELTA_MANIFEST.md:3,4');
  });

  test('one span NAME twice on a single line is not a finding', () => {
    // `gate_count` occurs 192 times under docs/ and twice on one line wherever a
    // document writes "N of N". A check keyed on the name would be unusable.
    const root = cleanTree();
    write(root, 'docs/testing/SPANS.md', `# Spans\n\n${SPAN} of ${SPAN} gates pass.\n`);
    expect(findings('RI-31', root)).toEqual([]);
  });

  test('one identical generated line in two different files is not a finding', () => {
    // Zero such pairs existed in the corpus when this check was written, and a
    // cross-file rule would fire on two documents that legitimately share a
    // sentence. The fixture already carries this pair; this asserts it.
    const root = cleanTree();
    const line = `The corpus holds ${SPAN} gates.`;
    write(root, 'docs/testing/SPANS.md', `# Spans\n\n${line}\n`);
    write(root, 'packages/db/DELTA_MANIFEST.md', `# Manifest\n\n${line}\n`);
    expect(findings('RI-31', root)).toEqual([]);
  });

  test('a doubled line carrying no span is not a finding, which is RI-12 half', () => {
    // The partition ADR-282 measured: of 37 long lines repeating inside one
    // file, 29 carried no span and included every legitimate one. This check
    // does not replace RI-12 and must not start reporting its subject.
    const root = cleanTree();
    const long =
      'A sentence long enough to sit inside RI-12 own scope, repeated once, carrying no generated span at all.';
    write(
      root,
      'docs/testing/SPANS.md',
      `# Spans\n\nThe corpus holds ${SPAN} gates.\n\n${long}\n${long}\n`,
    );
    expect(findings('RI-31', root)).toEqual([]);
  });

  test('a generated line doubled inside a fenced block is not a finding', () => {
    // A span shown in a fence is documentation of the FORM. STRATEGY carries the
    // worked example and the generator masks it, so this check masks it too.
    const root = cleanTree();
    write(
      root,
      'docs/testing/SPANS.md',
      `# Spans\n\nThe corpus holds ${SPAN} gates.\n\n\`\`\`\n${SPAN}\n${SPAN}\n\`\`\`\n`,
    );
    expect(findings('RI-31', root)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The runner's own report: a crash is its own outcome
// -----------------------------------------------------------------------------
// ADR-294. Every case above asks whether a CHECK is honest. These ask whether
// the RUNNER is, and the defect they pin is the one two sessions hit in one
// afternoon: with `node_modules` absent, RI-18's lazy `typescript` load threw,
// the runner folded that crash into the same counter as a violation, and then
// printed `29 of 30 invariants hold.` The crashed check was on the HELD side of
// that sentence by arithmetic, and the sentence still read as a measurement.
//
// EACH ONE WAS WATCHED FAILING, which for a report rather than a check means
// restoring the arithmetic it refuses: the single `failed` counter and the one
// summary line were put back inside `runChecks` and this block was run. FIVE OF
// THE SIX WENT RED and the sixth stayed green, which is the result the fix
// wants, because that one asserts the wording a run with NO crash keeps. The
// full RED and the before and after CLI transcripts are in ADR-294 section 3.
describe('the runner reports a crashed check apart from a passed and a failed one', () => {
  const held = (id: string) => ({
    id,
    title: `${id} holds`,
    covers: 'nothing. A fixture for the report, not an invariant.',
    run: (): string[] => [],
  });

  const violated = (id: string) => ({
    id,
    title: `${id} is violated`,
    covers: 'nothing. A fixture for the report, not an invariant.',
    run: (): string[] => [`${id} found one thing`],
  });

  const crashes = (id: string) => ({
    id,
    title: `${id} cannot run`,
    covers: 'nothing. A fixture for the report, not an invariant.',
    run: (): string[] => {
      throw new Error(`${id} could not reach its inputs`);
    },
  });

  /** Run `checks` and collect the transcript the runner emits, line by line. */
  const transcript = (
    checks: readonly {
      id: string;
      title: string;
      covers: string;
      run: (root: string) => string[];
    }[],
    root = REPO_ROOT,
  ): { lines: string[]; result: ReturnType<typeof runChecks> } => {
    const lines: string[] = [];
    const result = runChecks(checks, { root, emit: (line: string) => lines.push(line) });
    return { lines, result };
  };

  test('a crash is an ERROR, counted apart from both PASS and FAIL', () => {
    const { lines, result } = transcript([held('RI-A'), held('RI-B'), crashes('RI-C')]);
    expect(result).toMatchObject({ passed: 2, failed: 0, errored: 1, total: 3 });
    expect(lines).toContain('PASS   RI-A  RI-A holds');
    expect(lines.find((line) => line.startsWith('ERROR  RI-C'))).toBe(
      'ERROR  RI-C  RI-C cannot run  (THIS CHECK DID NOT RUN)',
    );
    expect(lines.some((line) => line.startsWith('FAIL   RI-C'))).toBe(false);
  });

  test('a run holding a crash never prints the invariants-hold sentence', () => {
    // The shipped runner printed `2 of 3 invariants hold.` here, which is the
    // whole defect: the sentence is a claim about a completed measurement and
    // this run did not complete one.
    const { lines } = transcript([held('RI-A'), held('RI-B'), crashes('RI-C')]);
    expect(lines.some((line) => line.startsWith('2 of 3 invariants hold'))).toBe(false);
    expect(lines).toContain('1 of 3 check(s) COULD NOT RUN, so this run did not measure the tree.');
    expect(lines).toContain('2 passed, 0 failed, 1 errored, of 3 check(s).');
  });

  test('the crash is not subtracted from the denominator', () => {
    // 30 checks producing 29 passes, 0 fails and 1 crash is not `29 of 30`, and
    // it is not `29 of 29` either. The denominator is how many checks there
    // were, so it does not move when one of them stops working.
    const { lines, result } = transcript([held('RI-A'), crashes('RI-B')]);
    expect(result.total).toBe(2);
    for (const line of lines) expect(line).not.toContain('of 1 check');
    expect(lines).toContain('1 passed, 0 failed, 1 errored, of 2 check(s).');
  });

  test('a crash exits CRASHED, and dominates a violation in the same run', () => {
    expect(runChecks([held('RI-A'), crashes('RI-B')], { emit: () => {} }).exitCode).toBe(
      EXIT.CRASHED,
    );
    const both = runChecks([violated('RI-A'), crashes('RI-B')], { emit: () => {} });
    expect(both).toMatchObject({ passed: 0, failed: 1, errored: 1, exitCode: EXIT.CRASHED });
    expect(EXIT.CRASHED).not.toBe(EXIT.VIOLATED);
    expect(EXIT.CRASHED).not.toBe(EXIT.USAGE);
  });

  test('a check IMPORTED from another file crashes the same way', () => {
    // RI-11 and RI-18 live in their own files and are imported into `CHECKS`,
    // and RI-18 is the check that started this. The outcome is decided by the
    // runner rather than inside any check, so a throw that crosses a module
    // boundary is read exactly like a local one. Pointed at a tree that holds
    // none of its inputs, RI-11 throws its own sentinel.
    const root = mkdtempSync(join(tmpdir(), 'merit-runner-'));
    seeded.push(root);
    const { lines, result } = transcript([ri11], root);
    expect(result).toMatchObject({ passed: 0, failed: 0, errored: 1, total: 1 });
    expect(lines[0]).toContain('ERROR  RI-11');
    expect(lines[0]).toContain('(THIS CHECK DID NOT RUN)');
    expect(result.exitCode).toBe(EXIT.CRASHED);
  });

  test('a run with no crash keeps the wording and the exit code it always had', () => {
    // The fix is narrow on purpose. Nothing that reads this output learns a new
    // shape on a run where every check ran, so a green run still says `N of N
    // invariants hold.` and a violated one still exits 1.
    const clean = transcript([held('RI-A'), held('RI-B')]);
    expect(clean.lines).toEqual([
      'PASS   RI-A  RI-A holds',
      'PASS   RI-B  RI-B holds',
      '',
      '2 of 2 invariants hold.',
    ]);
    expect(clean.result.exitCode).toBe(EXIT.OK);

    const dirty = transcript([held('RI-A'), violated('RI-B')]);
    expect(dirty.lines).toContain(
      '1 of 2 invariants hold. Each one is a property the scaffold exists to make impossible to lose.',
    );
    expect(dirty.lines).toContain('       RI-B found one thing');
    expect(dirty.result.exitCode).toBe(EXIT.VIOLATED);
  });
});
