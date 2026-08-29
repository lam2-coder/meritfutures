import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName, type Table } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { firmParameters } from '../src/schema.ts';
import { SCOPE_RULES, TABLES, type TableKey } from '../src/scope.ts';

// =============================================================================
// firm-parameter-vocabulary.test.ts
// =============================================================================
// THE COMPARATOR FOR A TABLE WHOSE WHOLE POINT IS THAT IT DOES NOT GROW, on
// `operator-role-vocabulary.test.ts`'s pattern one migration over.
//
// ADR-238 ruling 1 ruled the base account cap the FIRM'S number and refused
// `plan_versions.rules.limits.max_accounts_per_entity` in all three of its
// available forms. ADR-252 builds the home that ruling named, and the risk the
// row that dispatched it names is not that the table is wrong today: it is that
// a firm parameter table is exactly the thing that grows into a settings bag
// nobody can reason about. THE VOCABULARY IS THEREFORE CLOSED AT THE DATABASE
// AND THIS FILE IS WHAT WATCHES THE CLOSURE, so a second member cannot arrive
// as a side effect of a session that wanted somewhere to put a number.
//
// -----------------------------------------------------------------------------
// IT CARRIES NO LIST OF ITS OWN, WHICH IS THE POINT OF THE PATTERN
// -----------------------------------------------------------------------------
// `operator-role-vocabulary.test.ts` compares FOUR statements of one role set
// and holds none of them. There is no corpus document listing firm parameters,
// so this file has fewer sides to compare and says so rather than inventing an
// authority: what it derives is the CHECK's own membership, the arity of it, and
// the fact that no other migration in the set widens it. A member added to the
// DDL turns the arity case red and names itself in the failure.
//
// -----------------------------------------------------------------------------
// THE SECOND CLOSURE IS THE COLUMN TYPE AND IT IS ASSERTED SEPARATELY
// -----------------------------------------------------------------------------
// A CHECK closes which parameters may be NAMED. It says nothing about what may
// be STORED, and a `text_value` column landing beside `integer_value` would be
// the settings bag arriving under a constraint that still passes. So the column
// set is asserted by name, in both the DDL and the Drizzle declaration.
//
// -----------------------------------------------------------------------------
// AND THE TABLE SHIPS EMPTY, WHICH IS A CONTROL RATHER THAN AN OMISSION
// -----------------------------------------------------------------------------
// A cap is a launch candidate re-confirmed at launch as a row and never a
// constant, so a seed row or a DDL default would be a number this repository
// invented. THE TRAP THAT FOLLOWS FROM THAT IS THE ONE THE ROW NAMED FIRST: an
// implementation finding no effective row finds NO CAP, and a reader that folds
// an absent row into an unlimited one has built a control that answers yes to
// everybody on the endpoint that sells accounts. Nothing here can assert what a
// reader that does not exist will do; what it CAN assert is that the absence is
// real, so the reader has to meet it.
//
// IT READS SQL AS TEXT, which is this package's idiom for a fact that lives in
// DDL: a CHECK constraint is erased before a value exists, so there is nothing
// to import and assert against.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'packages', 'db', 'migrations');
const MIGRATION = join(MIGRATIONS, '0074_firm_parameters.sql');

const sql = (): string => readFileSync(MIGRATION, 'utf8');

/**
 * The vocabulary `0074`'s CHECK admits, in the order it writes them.
 *
 * THE PARSER GUARDS ITSELF, which is `operator-role-vocabulary.test.ts`'s stated
 * idiom and the reason it is repeated: a parser that stopped matching would
 * yield an empty set and make every membership assertion below vacuously pass,
 * which is the one failure a derivation can suffer that a hand-maintained copy
 * cannot.
 */
function migrationParameters(): readonly string[] {
  const body = sql();
  const check =
    /CONSTRAINT firm_parameters_vocabulary_is_closed CHECK \(\s*parameter IN \(([^)]*)\)/.exec(
      body,
    );
  if (check?.[1] === undefined)
    throw new Error(`no \`firm_parameters_vocabulary_is_closed\` CHECK in ${MIGRATION}`);
  const members = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
  if (members.length === 0) throw new Error(`the CHECK parsed to no members: ${check[1]}`);
  return members;
}

/** The column names of one `CREATE TABLE` block, in declaration order. */
function ddlColumns(table: string): readonly string[] {
  const body = sql();
  const start = body.indexOf(`CREATE TABLE ${table} (`);
  if (start === -1) throw new Error(`no \`CREATE TABLE ${table}\` in ${MIGRATION}`);
  const end = body.indexOf('\n);', start);
  if (end === -1) throw new Error(`unterminated \`CREATE TABLE ${table}\` in ${MIGRATION}`);
  const block = body.slice(start, end);
  const names = [
    ...block.matchAll(/^ {2}([a-z][a-z0-9_]*) {2,}(?:text|integer|bigint|uuid|timestamptz)\b/gm),
  ].map((m) => m[1] as string);
  if (names.length === 0) throw new Error(`the column parser matched nothing in ${table}`);
  return names;
}

/** Every `.sql` in the migration set, keyed by file name. */
function migrationFiles(): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(MIGRATIONS).sort()) {
    if (extname(f) !== '.sql') continue;
    out.set(f, readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  if (out.size === 0) throw new Error(`no migrations found in ${MIGRATIONS}`);
  return out;
}

// -----------------------------------------------------------------------------
// 1. THE VOCABULARY, CLOSED AT THE DATABASE
// -----------------------------------------------------------------------------

describe('the firm parameter vocabulary is closed in the DDL', () => {
  test('the CHECK admits exactly one member and it is the base account cap', () => {
    // A SECOND MEMBER IS AN ADR AND A SUPERSEDING MIGRATION, never an edit to a
    // merged file. If this is red, read ADR-252 section 3 before widening it:
    // the arity is the control, not a number that happens to be true today.
    expect(migrationParameters()).toEqual(['base_account_cap']);
  });

  test('no other migration widens the vocabulary, asserted BY CONSTRAINT NAME', () => {
    // Migrations are sacred and are superseded rather than edited, so the way a
    // member arrives is a LATER file dropping this constraint and adding its
    // own. That is a legitimate move and it is not a silent one: this case names
    // the constraint, so the file that supersedes it appears in the diff beside
    // its own name.
    const offenders: string[] = [];
    for (const [file, body] of migrationFiles()) {
      if (file === '0074_firm_parameters.sql') continue;
      if (body.includes('firm_parameters_vocabulary_is_closed')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test('no migration alters `firm_parameters` at all, asserted BY TABLE NAME', () => {
    // The whole-set sweep beside the constraint sweep, because a column added by
    // an `ALTER` would widen what may be STORED without touching the CHECK that
    // says what may be NAMED.
    const offenders: string[] = [];
    for (const [file, body] of migrationFiles()) {
      if (/ALTER\s+TABLE\s+(?:ONLY\s+)?firm_parameters\b/i.test(body)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("the cap's domain is carried per parameter rather than on the column", () => {
    // A bare `CHECK (integer_value > 0)` would bind every future member to the
    // cap's domain, so a later parameter that legitimately admits zero would
    // arrive by LOOSENING the cap's own bound. The disjunct names the parameter,
    // which is the same reasoning that closes the vocabulary.
    expect(sql()).toContain('CONSTRAINT firm_parameters_base_account_cap_is_positive CHECK (');
    expect(sql()).toContain("parameter <> 'base_account_cap' OR integer_value > 0");
  });
});

// -----------------------------------------------------------------------------
// 2. THE SECOND CLOSURE. WHAT MAY BE STORED, AND NOT ONLY WHAT MAY BE NAMED
// -----------------------------------------------------------------------------

describe('one value column, and its type is part of the vocabulary', () => {
  test('the DDL declares these six columns and no seventh', () => {
    // `integer_value` AND NO SIBLING. A `text_value`, a `cents_value` or a
    // `jsonb_value` beside it is the first step of the settings bag this table
    // exists to refuse, and each would pass the CHECK above untouched.
    expect(ddlColumns('firm_parameters')).toEqual([
      'parameter',
      'integer_value',
      'reason',
      'effective_from',
      'approved_by',
      'created_at',
    ]);
  });

  test('the Drizzle declaration transcribes the same six and no more', () => {
    // The two hand-written statements of one table, compared. `schema.ts` is a
    // transcription and the DDL is the authority, which is why this compares
    // against the migration rather than against a list held here.
    expect(Object.keys(getTableColumns(firmParameters)).sort()).toEqual(
      ['parameter', 'integerValue', 'reason', 'effectiveFrom', 'approvedBy', 'createdAt'].sort(),
    );
  });

  test('the cap is an INTEGER on both sides of the fold', () => {
    // `identities.max_accounts_override` is `integer` and is the per-entity
    // exception to this number. Comparing a count against a differently typed
    // base is how two halves of one number stop agreeing.
    expect(sql()).toMatch(/^ {2}integer_value {2,}integer NOT NULL,$/m);
    const identity = readFileSync(join(MIGRATIONS, '0002_identity.sql'), 'utf8');
    expect(identity).toMatch(/max_accounts_override {2,}integer NULL CHECK/);
  });
});

// -----------------------------------------------------------------------------
// 3. THE TABLE SHIPS EMPTY, AND AN ABSENT ROW IS NO CAP
// -----------------------------------------------------------------------------

describe('no cap is invented anywhere in the migration set', () => {
  test('`0074` writes no row', () => {
    // A seed would be a number this session chose. The cap is a launch candidate
    // confirmed at launch as a row, per the standing parameter-status ruling.
    expect(sql()).not.toMatch(/INSERT\s+INTO/i);
  });

  test('no migration in the set writes a `firm_parameters` row', () => {
    const offenders: string[] = [];
    for (const [file, body] of migrationFiles()) {
      if (/INSERT\s+INTO\s+firm_parameters\b/i.test(body)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test('`integer_value` carries no DDL default, in the SQL and in the transcription', () => {
    // A DEFAULT IS A CONSTANT, which ADR-238 ruling 3 refuses by name: changing
    // the platform cap would become a migration plus a backfill, and the corpus
    // rules every one of these values a launch candidate rather than a constant.
    expect(sql()).not.toMatch(/integer_value[^,]*DEFAULT/i);
    expect(getTableColumns(firmParameters).integerValue.hasDefault).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 4. THE REGISTRATION, WHICH IS THE HALF ADR-238's FENCE COULD NOT REACH
// -----------------------------------------------------------------------------

describe('the table is registered, and registered `firm`', () => {
  test('`firmParameters` is a member of `TABLES` under its SQL name', () => {
    expect(getTableName(TABLES['firmParameters' as TableKey] as Table)).toBe('firm_parameters');
  });

  test('the scope class is `firm`', () => {
    // The DDL settles it: the row declares no column against `identities(id)` or
    // `accounts(id)`, so `owned`, `pair` and `either` have nothing to name.
    expect(SCOPE_RULES['firmParameters' as TableKey].class).toBe('firm');
  });

  test('the row declares no identity column and no account column', () => {
    // The predicate the class is read off, asserted against the DDL rather than
    // trusted from the rule's own prose.
    expect(sql()).not.toMatch(/REFERENCES\s+identities\s*\(/i);
    expect(sql()).not.toMatch(/REFERENCES\s+accounts\s*\(/i);
  });

  test('the approver is a REFERENT and the edge is to the operator directory', () => {
    // `price_floors.approved_by` is bare text because 0073 did not exist when
    // 0024 was written. It does now, so a cap approved by a name in no directory
    // is unwritable. RESTRICT in both directions: an approval is a historical
    // fact rather than a pointer at whoever holds the seat today.
    expect(sql()).toContain('REFERENCES operators(actor) ON UPDATE RESTRICT ON DELETE RESTRICT');
  });
});
