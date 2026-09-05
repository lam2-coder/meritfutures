// =============================================================================
// packages/db/test/data-model-nullability.test.ts -- CI-02, the `unit` project.
// =============================================================================
// RI-36's SUITE, AND IT LIVES HERE RATHER THAN IN `packages/tooling/test`
// BECAUSE ITS INPUT IS THE MIGRATION SET AND ITS BINDING IS `schema.ts`.
//
// ADR-329. Two design records said `not null` about a column that is nullable,
// on consecutive days, and nothing went red: `wallet_entries.provenance` after
// `0080` (ADR-322) and `purchases.psp` and `.psp_reference` after `0081`
// (ADR-323). Each was written down as a landmine by the row that caused it,
// because there was nothing that could write it down as a failure.
//
// THREE KINDS OF CASE ARE HERE AND THEY ARE DIFFERENT ARGUMENTS.
//
//   1. THE BINDING. This repository now holds TWO readers that fold the same
//      migration set for the same fact: `scoped-db.test.ts`'s `foldTableDefs`
//      plus `declaredNotNull`, which compares the DDL against `schema.ts`, and
//      `RI-36`'s `foldColumnNullability`, which compares it against the design
//      records. Two readers of one fact that can disagree is the hazard ADR-092
//      section 5 names, and the answer this estate already uses is an
//      ASSERTION rather than care: `foldTable` and `foldTableDefs` sit in one
//      file and are bound by comparing their key sets. The two folds here are
//      bound THROUGH `schema.ts`, which each is separately compared against:
//      `scoped-db.test.ts` asserts `column.notNull === declaredNotNull(fold)`
//      for every column of every registered table, and the first case below
//      asserts `column.notNull === foldColumnNullability(...)` over the same
//      population. A disagreement between the two readers is therefore RED in
//      one of the two files rather than silent in both.
//
//   2. THE RECONSTRUCTIONS. Each stale record is rebuilt AS IT STOOD on
//      `612f61e8`, against the migration set AS IT STANDS, and watched going
//      RED; and each has a COUNTERFACTUAL beside it, the migration set with the
//      migration that falsified the record taken away, watched GREEN. A check
//      red on both is catching nothing. The stale line is the verbatim text out
//      of `git show`, and it is asserted ABSENT from the live record, so a case
//      cannot go on testing a repair that was reverted.
//
//   3. THE SEEDS. One per leg, plus the two TRUE cells that the first reader
//      written for this check reported as findings. Those two are the reason
//      the reader reads terms rather than the cell, and they are cases because
//      working agreements section 9 says a gate that a true line trips is the
//      thing that is wrong.
//
// EVERY FIXTURE COPIES THE REAL MIGRATION DIRECTORY, because the whole subject
// is a fold over a real history and a synthetic two-table schema would let the
// reconstructions pass against a migration set that does not carry `0080`.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, test } from 'vitest';

import { CHECKS, REPO_ROOT, foldColumnNullability } from '../../tooling/checks/repo-invariants.mjs';
import { TABLES, TABLE_KEYS, type TableKey } from '../src/index.ts';

const MIGRATIONS = 'packages/db/migrations';
const RECORDS = 'docs/architecture/data-model';
const HERE = dirname(fileURLToPath(import.meta.url));

const ri36 = (): { run: (root: string) => string[] } => {
  const found = CHECKS.find((c: { id: string }) => c.id === 'RI-36');
  if (found === undefined) throw new Error('RI-36 is not a member of CHECKS');
  return found;
};

const findings = (root: string): string[] => ri36().run(root);

const seeded: string[] = [];
afterAll(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A tree carrying the REAL migration set and whichever design records are named.
 *
 * The records are given as file body, so a case may hand in the live record, a
 * reconstruction of an old one, or something invented. `without` removes named
 * migrations, which is how a counterfactual tree is built.
 */
function estate(records: Record<string, string>, without: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-nullability-'));
  seeded.push(root);
  cpSync(join(REPO_ROOT, MIGRATIONS), join(root, MIGRATIONS), { recursive: true });
  for (const file of without) rmSync(join(root, MIGRATIONS, file));
  mkdirSync(join(root, RECORDS), { recursive: true });
  for (const [name, body] of Object.entries(records)) {
    writeFileSync(join(root, RECORDS, name), body);
  }
  return root;
}

const liveRecord = (name: string): string => readFileSync(join(REPO_ROOT, RECORDS, name), 'utf8');

/**
 * One design record with the row for `column` replaced by `line`.
 *
 * THE REPLACEMENT IS ASSERTED RATHER THAN ATTEMPTED. A reconstruction that
 * quietly changed nothing would test the repaired record under the name of the
 * stale one and report GREEN for the wrong reason, which is the vacuous-pass
 * shape this corpus has now found in a CHECK, in a `DO` block and in a fold.
 */
function withRow(body: string, column: string, line: string): string {
  const opening = `| \`${column}\` |`;
  const lines = body.split('\n');
  const at = lines.filter((text) => text.startsWith(opening));
  expect(at.length, `${column} heads ${at.length} row(s) of the record, and it must head 1`).toBe(
    1,
  );
  const out = lines.map((text) => (text.startsWith(opening) ? line : text)).join('\n');
  expect(out, `the reconstruction of ${column} changed nothing`).not.toBe(body);
  return out;
}

// -----------------------------------------------------------------------------
// 1. THE BINDING: RI-36's fold and `schema.ts`, over every registered table
// -----------------------------------------------------------------------------
describe('RI-36 folds the same nullability the TypeScript transcription carries', () => {
  const columnsOf = (key: TableKey): Record<string, PgColumn> =>
    getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;

  test('every registered column: `schema.ts` and RI-36 agree on NOT NULL', () => {
    const { tables } = foldColumnNullability(REPO_ROOT);
    let compared = 0;
    let notNulls = 0;
    for (const key of TABLE_KEYS) {
      const sqlName = getTableName(TABLES[key] as PgTable);
      const folded = tables.get(sqlName);
      // `economic_calendar_current` is a `CREATE VIEW` and RI-36's fold reads
      // `CREATE TABLE` only (ADR-209 names the same relation for the same
      // reason one file over). A view has no nullability of its own to fold.
      if (folded === undefined) continue;
      for (const column of Object.values(columnsOf(key))) {
        const declared = folded.get(column.name);
        expect(declared, `${sqlName}.${column.name} is not a folded column`).toBeDefined();
        expect(
          declared?.notNull,
          `${sqlName}.${column.name} is transcribed as ` +
            `${column.notNull ? 'NOT NULL' : 'nullable'} and RI-36 folds it the other way. ` +
            `Its DDL is: ${declared?.def ?? ''}`,
        ).toBe(column.notNull);
        compared += 1;
        if (column.notNull) notNulls += 1;
      }
    }
    // THE COMPARISON IS WATCHED DISCRIMINATING RATHER THAN ASSUMED TO. Two
    // readers that both returned `false` for everything would agree on every
    // row above, and `scoped-db.test.ts` would still be green because it
    // compares a different pair. Both dispositions present, over more columns
    // than there are tables, is what says the loop read something.
    expect(compared).toBeGreaterThan(TABLE_KEYS.length);
    expect(notNulls).toBeGreaterThan(0);
    expect(notNulls).toBeLessThan(compared);
  });

  test('the repository holds: every design record states the nullability it has', () => {
    expect(findings(REPO_ROOT)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 2. THE RECONSTRUCTIONS, each with the tree its record was TRUE on
// -----------------------------------------------------------------------------
describe('RI-36 goes red on the two records that were stale when it was written', () => {
  /** `wallet_entries.md:10` on `612f61e8`, verbatim out of `git show`. */
  const STALE_PROVENANCE =
    '| `provenance` | text | not null, check in ' +
    '(`payout`,`refund_wallet_funded`,`correction`) | **the closed list.** The ledger records ' +
    'the money; this records **what kind of money it is** |';
  /** `purchases.md:17` and `:18` on `612f61e8`, verbatim. */
  const STALE_PSP = '| `psp` | text | not null, check in (`psp_a`,`psp_b`) | which MID took it |';
  const STALE_PSP_REFERENCE = '| `psp_reference` | text | not null | |';

  // RI-14's SHAPE: a line quoted as history is only legitimate while the tree
  // has stopped carrying it. Without this, these cases go on reconstructing a
  // repair somebody reverted and report RED as though the check were working.
  test('all three stale lines are gone from the live records', () => {
    expect(liveRecord('wallet_entries.md')).not.toContain(STALE_PROVENANCE);
    expect(liveRecord('purchases.md')).not.toContain(STALE_PSP);
    expect(liveRecord('purchases.md')).not.toContain(STALE_PSP_REFERENCE);
  });

  const staleWallet = (): string =>
    withRow(liveRecord('wallet_entries.md'), 'provenance', STALE_PROVENANCE);
  const stalePurchases = (): string =>
    withRow(
      withRow(liveRecord('purchases.md'), 'psp', STALE_PSP),
      'psp_reference',
      STALE_PSP_REFERENCE,
    );

  test('OCCURRENCE 1: `wallet_entries.md` as it stood, against the set as it stands', () => {
    const found = findings(estate({ 'wallet_entries.md': staleWallet() }));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('`wallet_entries.provenance` is `not null`');
    expect(found[0]).toContain('leaves it nullable as of 0080_wallet_debit_provenance.sql');
  });

  test('OCCURRENCE 1 COUNTERFACTUAL: the same record without `0080` is TRUE', () => {
    expect(
      findings(
        estate({ 'wallet_entries.md': staleWallet() }, ['0080_wallet_debit_provenance.sql']),
      ),
    ).toEqual([]);
  });

  test('OCCURRENCE 2: `purchases.md` as it stood, against the set as it stands', () => {
    const found = findings(estate({ 'purchases.md': stalePurchases() }));
    expect(found).toHaveLength(2);
    expect(found.join('\n')).toContain('`purchases.psp` is `not null`');
    expect(found.join('\n')).toContain('`purchases.psp_reference` is `not null`');
    expect(found.join('\n')).toContain('leaves it nullable as of 0081_purchase_processor_columns');
  });

  test('OCCURRENCE 2 COUNTERFACTUAL: the same record without `0081` is TRUE', () => {
    expect(
      findings(
        estate({ 'purchases.md': stalePurchases() }, ['0081_purchase_processor_columns.sql']),
      ),
    ).toEqual([]);
  });

  // THE `CREATE TABLE` READER IS THE ONE THAT WOULD HAVE PASSED, and this is
  // the case that says so. Both counterfactuals above are the tree whose
  // `CREATE TABLE` bodies are IDENTICAL to today's -- E2 makes them permanent
  // -- and both records pass there. So a check that read only the `CREATE
  // TABLE` would report exactly what the counterfactual reports, on the real
  // tree, and would have been green over both defects it was written for.
  test('the fold is load bearing: both columns are NOT NULL at their `CREATE TABLE`', () => {
    const before = foldColumnNullability(
      estate({}, ['0080_wallet_debit_provenance.sql', '0081_purchase_processor_columns.sql']),
    ).tables;
    const after = foldColumnNullability(REPO_ROOT).tables;
    for (const [table, column] of [
      ['wallet_entries', 'provenance'],
      ['purchases', 'psp'],
      ['purchases', 'psp_reference'],
    ] as const) {
      expect(before.get(table)?.get(column)?.notNull, `${table}.${column} before`).toBe(true);
      expect(after.get(table)?.get(column)?.notNull, `${table}.${column} after`).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// 3. THE SEEDS, one per leg, and the two TRUE cells that moved the reader
// -----------------------------------------------------------------------------
describe('RI-36 reads a record the way a record is written', () => {
  const record = (table: string, rows: string): string =>
    `### ${table}\n| Column | Type | Constraints | Why |\n|---|---|---|---|\n${rows}\n`;

  // LEG 1, THE OTHER DIRECTION. A record calling a NOT NULL column nullable is
  // the same lie running backwards and is the half a check written only for
  // ADR-322's and ADR-323's shape would have missed.
  test('a record that says `null` about a NOT NULL column is a finding', () => {
    const found = findings(
      estate({
        'wallet_entries.md': record('wallet_entries', '| `cause` | text | null | |'),
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('`wallet_entries.cause` is nullable');
    expect(found[0]).toContain('leaves it NOT NULL');
  });

  // LEG 2. Without this the check is satisfied by DELETING the two words, which
  // is the repair a session under deadline reaches for.
  test('a record that states no nullability at all is a finding', () => {
    const found = findings(
      estate({
        'wallet_entries.md': record('wallet_entries', '| `cause` | text | check <> `` | |'),
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('states no nullability for `wallet_entries.cause`');
  });

  // LEG 2's ONE ADMISSION, and it is keyed on the DDL rather than on a written
  // list. Five of the estate's 1,374 record rows state no nullability and all
  // five are `GENERATED ALWAYS AS (...)` columns whose cell spends itself on
  // the expression.
  test('a GENERATED column may state none, which is the only silence admitted', () => {
    expect(
      findings(
        estate({
          'reconciliations.md': record(
            'reconciliations',
            '| `delta_cents` | bigint | **generated always as** `a - b` **stored** | |',
          ),
        }),
      ),
    ).toEqual([]);
  });

  // THE TWO TRUE CELLS. The first reader written for this check tested the
  // WHOLE CELL for `not null` and reported both of these, and both records are
  // right: one carries the phrase inside an INDEX PREDICATE and the other
  // QUOTES what the record used to say beside the migration that changed it.
  // Working agreements section 9: a gate that a true line trips is the thing
  // that is wrong, so the cells stand and the reader reads terms.
  test('`null, unique where not null, fk ...` is nullable, not NOT NULL', () => {
    expect(
      findings(
        estate({
          'account_adjustments.md': record(
            'account_adjustments',
            '| `promotional_credit_grant_id` | uuid | null, unique where not null, fk ' +
              '`promotional_credit_grants` | |',
          ),
        }),
      ),
    ).toEqual([]);
  });

  test('a cell QUOTING its own retired `not null` is read as what it says now', () => {
    expect(
      findings(
        estate({
          'trading_calendar.md': record(
            'trading_calendar',
            '| `session_open_at` | timestamptz | **null exactly when `is_holiday`** (`0032`, ' +
              'was `not null`) | |',
          ),
        }),
      ),
    ).toEqual([]);
  });

  // The live cells, which is what makes the two cases above a claim about this
  // repository rather than about two strings.
  test('both of those cells are the live text of their own design records', () => {
    expect(liveRecord('account_adjustments.md')).toContain('null, unique where not null, fk');
    expect(liveRecord('trading_calendar.md')).toContain('(`0032`, was `not null`)');
  });

  test('a struck-through row is a tombstone and not a claim', () => {
    expect(
      findings(
        estate({
          'wallet_entries.md': record(
            'wallet_entries',
            '| `cause` | text | not null | |\n' +
              '| ~~`cause_kind`~~ | text | null | never created, by a ruling |',
          ),
        }),
      ),
    ).toEqual([]);
  });

  test('a `pk` cell is NOT NULL, which is how the identity columns pass', () => {
    expect(
      findings(
        estate({
          'wallet_entries.md': record(
            'wallet_entries',
            '| `id` | bigint | pk, generated always as identity | |',
          ),
        }),
      ),
    ).toEqual([]);
  });

  // A TABLE-LEVEL `PRIMARY KEY (a, b)` MAKES ITS COLUMNS NOT NULL AND THE
  // COLUMN DEFINITIONS DO NOT SAY SO. Sixteen tables in this set are keyed that
  // way; a reader that dropped the clause would call every one of those key
  // columns nullable and every `pk` cell above them a finding.
  test('a table-level PRIMARY KEY makes its columns NOT NULL', () => {
    const { tables } = foldColumnNullability(REPO_ROOT);
    expect(tables.get('firm_parameters')?.get('parameter')?.notNull).toBe(true);
    expect(tables.get('firm_parameters')?.get('effective_from')?.notNull).toBe(true);
  });

  test('a `CHECK (x IS NOT NULL)` inside a column definition is not its nullability', () => {
    const root = estate({});
    writeFileSync(
      join(root, MIGRATIONS, '0083_seed.sql'),
      'CREATE TABLE seeded_rows (\n  a text CHECK (a IS NOT NULL),\n  b text NOT NULL\n);\n',
    );
    const { tables } = foldColumnNullability(root);
    expect(tables.get('seeded_rows')?.get('a')?.notNull).toBe(false);
    expect(tables.get('seeded_rows')?.get('b')?.notNull).toBe(true);
  });

  // `SET NOT NULL` HAS ZERO INSTANCES IN THIS ESTATE and the fold reads it
  // anyway, because the fold is a replay and a replay that models one direction
  // of a statement pair is a replay with a hole in it.
  test('`SET NOT NULL` folds too, in the direction nothing in this estate uses', () => {
    const root = estate({});
    writeFileSync(
      join(root, MIGRATIONS, '0083_seed.sql'),
      'ALTER TABLE wallet_entries ALTER COLUMN provenance SET NOT NULL;\n',
    );
    expect(
      foldColumnNullability(root).tables.get('wallet_entries')?.get('provenance')?.notNull,
    ).toBe(true);
  });

  // LEG 3. A shape the fold cannot replay is a THROW and never a skip, because
  // reporting on it would be claiming to have checked something that was not
  // checked.
  test('a `DROP COLUMN` the fold cannot replay is a THROW', () => {
    const root = estate({ 'wallet_entries.md': liveRecord('wallet_entries.md') });
    writeFileSync(
      join(root, MIGRATIONS, '0083_seed.sql'),
      'ALTER TABLE wallet_entries DROP COLUMN cause;\n',
    );
    expect(() => findings(root)).toThrow(/DROP COLUMN, which this fold cannot replay/);
  });

  test('a table `RENAME TO` is a THROW', () => {
    const root = estate({ 'wallet_entries.md': liveRecord('wallet_entries.md') });
    writeFileSync(
      join(root, MIGRATIONS, '0083_seed.sql'),
      'ALTER TABLE wallet_entries RENAME TO wallet_rows;\n',
    );
    expect(() => findings(root)).toThrow(/RENAME TO, which moves a whole record/);
  });

  test('a statement that adds a PRIMARY KEY is a THROW', () => {
    const root = estate({ 'wallet_entries.md': liveRecord('wallet_entries.md') });
    writeFileSync(
      join(root, MIGRATIONS, '0083_seed.sql'),
      'ALTER TABLE wallet_entries ADD PRIMARY KEY (cause);\n',
    );
    expect(() => findings(root)).toThrow(/which moves a key/);
  });

  // A RENAME IS FOLDED RATHER THAN REFUSED, because `0075` is one and the
  // estate carries it today.
  test('`RENAME COLUMN` moves the folded column, so the record may name the new one', () => {
    const { tables } = foldColumnNullability(REPO_ROOT);
    const table = tables.get('simulation_runs');
    expect(table?.has('calibration_observed_at')).toBe(false);
    expect(table?.get('calibration_observed_on')?.notNull).toBe(true);
  });

  // RULE 2. Every sentinel below is a way the check could report a clean corpus
  // for the one reason that means nothing was measured.
  test('a design record directory with no readable record is a THROW', () => {
    expect(() => findings(estate({}))).toThrow(/compared no column at all/);
  });

  test('a tree with neither input is SILENT, which is what the fixture estates are', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-nullability-empty-'));
    seeded.push(root);
    expect(findings(root)).toEqual([]);
  });

  test('a migration set that parses to no table is a THROW', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-nullability-notables-'));
    seeded.push(root);
    mkdirSync(join(root, MIGRATIONS), { recursive: true });
    mkdirSync(join(root, RECORDS), { recursive: true });
    writeFileSync(join(root, MIGRATIONS, '0001_none.sql'), 'CREATE INDEX x ON y (z);\n');
    expect(() => findings(root)).toThrow(/found no unqualified CREATE TABLE/);
  });

  test('a schema that is all NOT NULL or none of it is a broken reader, not a finding', () => {
    const root = mkdtempSync(join(tmpdir(), 'merit-nullability-constant-'));
    seeded.push(root);
    mkdirSync(join(root, MIGRATIONS), { recursive: true });
    mkdirSync(join(root, RECORDS), { recursive: true });
    writeFileSync(
      join(root, MIGRATIONS, '0001_all.sql'),
      'CREATE TABLE things (\n  a text NOT NULL,\n  b text NOT NULL\n);\n',
    );
    expect(() => findings(root)).toThrow(/degraded to a constant/);
  });

  // `0079` INSTALLS TWELVE RELATIONS AND EVERY ONE OF THEM IS SCHEMA-QUALIFIED,
  // including an `ALTER TABLE pgboss.job ADD PRIMARY KEY` that leg 3 would
  // otherwise throw on. The fold reads unqualified relations only, which is
  // also what `docs/architecture/data-model/` records.
  test('the pg-boss schema is invisible to the fold, key statements included', () => {
    const { tables, unmodelled } = foldColumnNullability(REPO_ROOT);
    expect(unmodelled).toEqual([]);
    expect(tables.has('job')).toBe(false);
    expect(tables.has('pgboss')).toBe(false);
  });

  // THE SUITE'S OWN HOME IS ASSERTED, because a file that moved out of
  // `packages/db/test` would stop being run by the `unit` project and this
  // whole argument would be green by absence.
  test('this suite sits beside the migrations it folds', () => {
    expect(join(HERE, '..', 'migrations')).toBe(join(REPO_ROOT, MIGRATIONS));
  });
});
