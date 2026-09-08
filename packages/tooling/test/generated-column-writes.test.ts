import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  derivedSet,
  builtStatements,
  literalLines,
  literalStatements,
  refusedWrites,
  run,
} from '../checks/generated-column-writes.mjs';

// =============================================================================
// EVERY LEG IS WATCHED FAILING, AND ONE OF THEM IS WATCHED FAILING FOR REAL
// =============================================================================
// A check nobody has seen red is a check nobody knows the shape of. Legs A and C
// are falsified here against a synthetic tree, which is the only way to seed a
// DDL form or a hand-written statement without editing the repository. Leg B is
// falsified WITHOUT a synthetic anything: it is handed a set that names a column
// the DDL does not generate, and the real accessor over the real registry then
// builds a real INSERT that names it. That is the whole of leg B's machinery
// exercised on the tree it will run against.
//
// THE COUNTS BELOW ARE DERIVED AND NOT TYPED. Nothing here says "six" or
// "twenty". Every case that needs a number reads it back off the same fold the
// checker runs, because a number typed into a suite is a second copy of the
// answer and the copy is what drifts (ADR-034, ADR-185).
// =============================================================================

/** A tree with one migration directory in it, which is all `derivedSet` reads. */
function treeWith(...migrations: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-generated-'));
  const dir = join(root, 'packages/db/migrations');
  mkdirSync(dir, { recursive: true });
  migrations.forEach((sql, i) => {
    writeFileSync(join(dir, `${String(i).padStart(4, '0')}_fixture.sql`), sql);
  });
  return root;
}

/** A tree with one source file in it, which is all `literalStatements` reads. */
function sourceTree(name: string, source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-literal-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', name), source);
  return root;
}

const generated = (pairs: [string, string[]][]): Map<string, Set<string>> =>
  new Map(pairs.map(([table, columns]) => [table, new Set(columns)]));

describe('leg A, the set folded out of the DDL', () => {
  test('reads a stored generated column out of a CREATE TABLE', () => {
    const set = derivedSet(
      treeWith(
        'CREATE TABLE t (\n' +
          '  a bigint NOT NULL,\n' +
          '  b bigint NOT NULL,\n' +
          '  c bigint GENERATED ALWAYS AS (a - b) STORED\n' +
          ');\n',
      ),
    );
    expect(set.findings).toEqual([]);
    expect(set.generated.get('t')).toEqual(new Set(['c']));
    expect(set.generatedOccurrences).toBe(1);
  });

  test('reads one out of an ALTER TABLE ADD COLUMN, which is how the DDL adds one', () => {
    const set = derivedSet(
      treeWith(
        'CREATE TABLE t (a text NOT NULL);\n',
        "ALTER TABLE t\n  ADD COLUMN b boolean GENERATED ALWAYS AS (a IN ('x')) STORED;\n",
      ),
    );
    expect(set.findings).toEqual([]);
    expect(set.generated.get('t')).toEqual(new Set(['b']));
  });

  // THE TWO FEATURES ARE SPELLED THE SAME AND MEAN NOTHING ALIKE. An identity
  // column joining the set would make leg B red over a defect that is not this
  // file's subject, and a generated column classified as an identity would make
  // the whole check silently empty.
  test('keeps an identity column out of the set and still counts it', () => {
    const set = derivedSet(
      treeWith(
        'CREATE TABLE t (\n  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n' +
          '  a bigint NOT NULL\n);\n',
      ),
    );
    expect(set.findings).toEqual([]);
    expect(set.generated.size).toBe(0);
    expect(set.identityOccurrences).toBe(1);
  });

  // THE AUDIT IS THE LEG'S OWN FAILURE MODE MADE VISIBLE. Without it a DDL form
  // the parser walks past shrinks the set, and legs B and C go green over
  // fewer columns while reporting nothing at all.
  test('is a FINDING when the fold walks past a GENERATED ALWAYS AS it did not read', () => {
    // `ALTER TABLE ... ALTER COLUMN ... ADD GENERATED ALWAYS AS IDENTITY`, which
    // turns an existing column into one and is neither a `CREATE TABLE` body nor
    // an `ADD COLUMN`. The point is not this form in particular: it is that a
    // declaration the fold did not read is refused rather than dropped.
    const set = derivedSet(
      treeWith(
        'CREATE TABLE t PARTITION OF p FOR VALUES IN (1);\n' +
          'ALTER TABLE t ALTER COLUMN c ADD GENERATED ALWAYS AS IDENTITY;\n',
      ),
    );
    expect(set.findings).toHaveLength(1);
    expect(set.findings[0]).toContain('does not model');
  });

  test('is a FINDING when the migration directory is empty, rather than an empty set', () => {
    expect(derivedSet(treeWith()).findings[0]).toContain('holds no .sql file');
  });

  // THE REAL TREE. This is the case that binds the checker to this repository:
  // the fold accounts for its whole input, and it finds the column that
  // `schema.ts` does not carry.
  test('accounts for every GENERATED ALWAYS AS in this repository', () => {
    const set = derivedSet();
    expect(set.findings).toEqual([]);
    expect(set.files).toBeGreaterThan(0);
    expect(set.generatedOccurrences).toBeGreaterThan(0);
    expect(set.identityOccurrences).toBeGreaterThan(0);
  });

  // ADR-445 SECTION 4. `live_account_state` is in the DDL and not in
  // `schema.ts`, so a set derived from the schema would be missing exactly the
  // member the sibling row transcribing that table is about to make reachable.
  test('holds a column no Drizzle table in this tree declares', () => {
    const set = derivedSet();
    expect(set.generated.get('live_account_state')).toEqual(new Set(['intraday_movement_cents']));
  });
});

describe('leg B, the INSERTs the accessor actually builds', () => {
  test('the real registry builds an INSERT for every key and none names a member', async () => {
    const set = derivedSet();
    const built = await builtStatements(set.generated);
    expect(built.findings).toEqual([]);
    expect(built.tables).toBeGreaterThan(0);
    // A run in which no table carried a member would be a green that asserted
    // nothing, and this is the case that would notice.
    expect(built.covered).toBeGreaterThan(0);
  });

  // FALSIFIED ON THE REAL TREE. The set is the lie and everything else is real:
  // the accessor, the registry, the Drizzle handle and the statement. If a
  // column the DDL does not generate is declared generated, the INSERT that
  // names it is found.
  test('is RED when the set names a column the built INSERT carries', async () => {
    const built = await builtStatements(generated([['identities', ['created_at']]]));
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]).toContain('identities.created_at');
    expect(built.findings[0]).toContain('42601');
  });

  test('a set naming no column of any table leaves it with nothing to assert', async () => {
    const built = await builtStatements(generated([['not_a_table', ['nope']]]));
    expect(built.findings).toEqual([]);
    expect(built.covered).toBe(0);
  });
});

describe('leg C, the hand-written statements', () => {
  test('finds a member named inside a DML literal', () => {
    const root = sourceTree(
      'writer.ts',
      'export const SQL = `\nUPDATE t SET rcr_bp = 1\nWHERE id = $1\n`;\n',
    );
    const found = literalStatements(generated([['t', ['rcr_bp']]]), root);
    expect(found.blocks).toBe(1);
    expect(found.findings).toHaveLength(1);
    expect(found.findings[0]).toContain('src/writer.ts:2');
  });

  // THE BLOCK IS THE UNIT AND THIS IS WHAT THAT BUYS. A mention elsewhere in
  // the same file is not this statement's, and a check that read the file as
  // one unit would be red over every gate in this tree that reads the DDL.
  test('does not reach a mention in a different literal block of the same file', () => {
    const root = sourceTree(
      'writer.ts',
      'export const SQL = `\nINSERT INTO t (a) VALUES ($1)\n`;\n' +
        "\nexport const READ = 'rcr_bp';\n",
    );
    expect(literalStatements(generated([['t', ['rcr_bp']]]), root).findings).toEqual([]);
  });

  // A COMMENT IS NOT A STATEMENT, and this tree's prose quotes the shapes its
  // checks hunt more than any other corpus this file has met.
  test('does not read a statement out of a comment', () => {
    const root = sourceTree(
      'writer.ts',
      '// UPDATE t SET rcr_bp = 1\n/* INSERT INTO t (rcr_bp) VALUES (1) */\nexport const X = 1;\n',
    );
    const found = literalStatements(generated([['t', ['rcr_bp']]]), root);
    expect(found.blocks).toBe(0);
    expect(found.findings).toEqual([]);
  });

  // THE VERB HAS TO BE A STATEMENT'S. `update` is a common English word and
  // `mutable` and `cadence` are both members of the real set.
  test('does not fire on prose that merely carries the word update', () => {
    const root = sourceTree(
      'writer.ts',
      "export const WHY = 'update the cadence when the schedule changes';\n",
    );
    expect(literalStatements(generated([['t', ['cadence']]]), root).findings).toEqual([]);
  });

  test('the real shipped tree names no member in any hand-written statement', () => {
    const set = derivedSet();
    const found = literalStatements(set.generated);
    expect(found.findings).toEqual([]);
    expect(found.files).toBeGreaterThan(0);
    // apps/worker/src/live/ports.ts carries one. Zero blocks would mean the
    // walk or the verb pattern had stopped working, which is the direction an
    // absence check fails green in.
    expect(found.blocks).toBeGreaterThan(0);
  });

  test('literalLines keeps a multi-line template on its own lines', () => {
    const lines = literalLines('const q = `\nINSERT INTO t\n  (a)\n`;\n');
    expect(lines[1]).toContain('INSERT INTO t');
    expect(lines[0]?.trim()).toBe('');
  });
});

// =============================================================================
// THIS SUITE IS THE CHECK'S WIRING, WHICH IS WHY THE ENTRY POINT IS A CASE
// =============================================================================
// `.github/workflows/ci.yml` is not edited by the row that wrote this and
// ADR-445 section 7 derives why: 20 of the 28 distinct lines of that file cited
// by line number elsewhere in this tree sit below any insertion point in CI-01,
// and the constraint on a widely cited file is that NO CITED LINE MOVES.
//
// SO THE COVERAGE IS THIS FILE'S. `vitest run` is CI-02, the three cases above
// that read the REAL tree are what make the property blocking, and the case
// below runs the command line itself so that no part of the check is reachable
// only by a hand somebody remembers to use. That is the same wiring
// `packages/tooling/checks/api-contract-endpoints.mjs` and `dependants.mjs`
// already have and it is stated here rather than inherited quietly.
// =============================================================================
describe('the command line', () => {
  test('passes over this tree, and says what it derived', async () => {
    const lines: string[] = [];
    const code = await run([], (line) => lines.push(line));
    expect(lines.join('\n')).toContain('PASS');
    expect(code).toBe(0);
  });

  test('takes no argument, because every input it has comes off the tree', async () => {
    const lines: string[] = [];
    expect(await run(['--set', 'rcr_bp'], (line) => lines.push(line))).toBe(2);
    expect(lines[0]).toContain('usage:');
  });
});

// =============================================================================
// THE HOLE, HELD OPEN ON A REAL BUILT STATEMENT (ADR-445 section 8)
// =============================================================================
// THIS BLOCK ASSERTS THAT A DEFECT IS STILL PRESENT AND IT IS SUPPOSED TO.
// `updateStatementOn` at `packages/db/src/scoped-db.ts:1211` hands the caller's
// values to Drizzle's `.set()`, which maps over the caller's keys rather than
// over the table's columns, so an UPDATE that names a stored generated column is
// a statement this accessor will build. `packages/db/src/` was outside the fence
// of the row that measured it, so the finding is carried here rather than fixed.
//
// WHEN THE REPAIR LANDS THIS GOES RED. That is the design. Delete this block in
// the commit that repairs the builder, and record the repair in ADR-445's
// section 8 item 1 rather than deleting the item: RI-14 keeps what was corrected
// beside its correction.
// =============================================================================
describe('leg D, the refusal the UPDATE builder now holds', () => {
  // WHAT STOOD HERE WAS A DEMONSTRATION AND IT IS DELETED RATHER THAN REPAIRED.
  // `ADR-445` shipped a `describe` block asserting the UPDATE builder DID name a
  // stored generated column, and a helper, `updateTargets`, whose whole purpose
  // was to hold that hole open on a real built statement so the commit closing
  // it would go red. `ADR-448` closed it. The block and the helper are gone and
  // what replaces them asserts the REFUSAL over the same registry and the same
  // real builder. `RI-14` keeps the record of the correction beside the
  // correction, which is `ADR-448` section 8 item 1 and this file's checker
  // header, rather than in a case that no longer means anything.

  test('every stored generated column on the registry is refused, and by name', async () => {
    const legD = await refusedWrites();
    expect(legD.findings).toEqual([]);
    expect(legD.refused).toBeGreaterThan(0);
    expect(legD.tables).toBeGreaterThan(0);
  });

  // THE COLUMNS LEG D REFUSES ARE THE REGISTRY'S SUBSET OF THE DDL'S, AND THE
  // INEQUALITY IS THE ASSERTION. `live_account_state` carries a generated column
  // and is not a registry table, so the UPDATE builder cannot reach it and the
  // two counts must differ. A case asserting equality would go red on a true
  // tree; this one goes red if the registry silently gains or loses the table,
  // and neither side of it is a number typed into this file.
  test('the columns leg D refuses are the registry subset of the fold', async () => {
    const legD = await refusedWrites();
    const set = derivedSet();
    const inDdl = [...set.generated.values()].reduce((n, columns) => n + columns.size, 0);
    expect(legD.refused).toBeGreaterThan(0);
    expect(legD.refused).toBeLessThan(inDdl);
  });

  // TWO INDEPENDENT READS OF THE IDENTITY POPULATION, COMPARED. Leg A folds the
  // DDL under `packages/db/migrations/` and counts `GENERATED ALWAYS AS IDENTITY`
  // as text; leg D walks the Drizzle declarations through the registry. The two
  // counts have to agree: the day a migration adds an identity column and
  // `schema.ts` does not, this is the case that says so.
  test('the identity columns leg D reaches are the ones the DDL declares', async () => {
    const legD = await refusedWrites();
    const set = derivedSet();
    expect(legD.identityReached).toBe(set.identityOccurrences);
  });

  // WHAT STOOD ABOVE SAID LEG D ASSERTS NO REFUSAL FOR THESE, AND `ADR-452` MADE
  // IT FALSE. The count was reported and walked past, so the checker printed an
  // identical `PASS` with and without the widening at `scoped-db.ts:4690` and a
  // refusal nothing watched would have been indistinguishable from no refusal at
  // all. `RI-14` keeps the record of that beside its correction, which is the
  // checker's own header and `ADR-452`. THIS IS THE CASE THAT GOES RED IF THE
  // CLAUSE IS REVERTED, and it was watched doing exactly that.
  test('every always-identity column on the registry is refused, and by name', async () => {
    const legD = await refusedWrites();
    expect(legD.findings).toEqual([]);
    expect(legD.identityRefused).toBe(legD.identityReached);
    expect(legD.identityRefused).toBeGreaterThan(0);
    expect(legD.identityTables).toBeGreaterThan(0);
  });

  // THE IDENTITY MESSAGE CARRIES ITS OWN SQLSTATE AND IT IS NOT THE STORED ONE.
  // PostgreSQL answers `428C9` to a write naming a `GENERATED ALWAYS AS IDENTITY`
  // column, which `ADR-448` section 8 item 2 states and this case holds: a
  // refusal that reported `42601` here would send a reader to the wrong half of
  // the DDL.
  test('the identity refusal names the rule and its own SQLSTATE', async () => {
    const legD = await refusedWrites();
    const sample = legD.identitySample;
    expect(sample).toBeTypeOf('string');
    expect(sample).toMatch(/GENERATED ALWAYS AS IDENTITY/);
    expect(sample).toMatch(/428C9/);
    expect(sample).not.toMatch(/42601/);
    expect(sample).toMatch(/never takes it from the caller/);
  });

  // THE ADDRESS PATH IS THE MONEY-PATH CONSTRAINT AND IT IS ASSERTED RATHER THAN
  // ARGUED. `apps/worker/src/recon/sweep.ts:629` addresses `reconciliations` by
  // its identity `id`, and widening the guard to identity columns makes that
  // sharper rather than safer: an identity column is exactly what an address is
  // built from. The guard reads `values` and never the predicate, and this case
  // is what would go red the day someone moved it.
  // THIS CASE IS DELIBERATELY NOT COUPLED TO `findings`. It asserts a DIFFERENT
  // property from the refusal above and must stay green when the widening is
  // reverted: reverting the clause stops the WRITE being refused and must not
  // touch the ADDRESS at all. A case that also demanded an empty `findings`
  // would go red for the refusal's reason and tell a reader nothing about the
  // address, which is the money-path half.
  test('an identity column still addresses a row, and only the write is refused', async () => {
    const legD = await refusedWrites();
    expect(legD.addressed).toBe(legD.identityReached);
    expect(legD.addressed).toBeGreaterThan(0);
  });

  // THE MESSAGE IS THE DISCRIMINATOR AND IT IS ASSERTED RATHER THAN ASSUMED. Leg
  // D refuses to count a throw that does not name the column, so a builder that
  // started failing for an unrelated reason would show up as a finding instead
  // of as a pass. This case reads the message the guard actually produced on
  // this tree and checks it carries what a reader needs: the rule, and the
  // SQLSTATE PostgreSQL would have answered with.
  test('the refusal names the rule and the SQLSTATE', async () => {
    const legD = await refusedWrites();
    const sample = legD.sample;
    expect(sample).toBeTypeOf('string');
    expect(sample).toMatch(/GENERATED ALWAYS AS \(\.\.\.\) STORED/);
    expect(sample).toMatch(/42601/);
    expect(sample).toMatch(/never takes it from the caller/);
  });
});
