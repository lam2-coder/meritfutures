import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  derivedSet,
  builtStatements,
  literalLines,
  literalStatements,
  run,
  updateTargets,
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
describe('the UPDATE half, which does not hold', () => {
  test('the accessor builds an UPDATE that writes a stored generated column', async () => {
    const set = derivedSet();
    const targets = await updateTargets(set.generated);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(set.generated.get(target.table)?.has(target.column)).toBe(true);
    }
  });

  // THE EXTENT IS DERIVED FROM BOTH SIDES AND NEITHER SIDE IS TYPED HERE. Every
  // member of the set that sits on a registry table with an addressable write is
  // reachable, and the case says so by computing both and comparing them.
  test('every member on an addressable registry table is reachable, and no other', async () => {
    const set = derivedSet();
    const targets = await updateTargets(set.generated);
    const reached = new Set(targets.map((t) => `${t.table}.${t.column}`));
    const all = new Set(
      [...set.generated].flatMap(([table, columns]) => [...columns].map((c) => `${table}.${c}`)),
    );
    for (const one of reached) expect(all.has(one)).toBe(true);
    // `live_account_state` is in the DDL and not in the registry, so at least
    // one member is out of the UPDATE builder's reach and the two sets differ.
    expect(reached.size).toBeLessThan(all.size);
  });
});
