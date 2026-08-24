// =============================================================================
// packages/db/test/scoped-db.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-084.
//
// WHAT IS NOT HERE, AND WHY. The two refusals ADR-084 turns on are COMPILE
// errors, and vitest cannot see one: it runs transpiled code and a type error is
// gone by then. `scripts/ci/falsify-ci.mjs` states that in its own words about
// the engine's R-17 case. Both are watched failing to compile there, at stage
// CI-01. A suite that "asserted" them would be asserting nothing.
//
// WHAT IS HERE IS THE PART A RUNTIME CAN SEE: that the registry is TOTAL, that
// every rule RESOLVES against the schema, that `traversal` is TRUE rather than
// merely written, and that the TypeScript schema has not DRIFTED from the DDL
// it transcribes.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  scopePredicate,
  scopedDb,
  systemDb,
  type IdentityId,
  type TableKey,
} from '../src/index.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const IDENTITY = 'i-1' as IdentityId;

const columnsOf = (key: TableKey): Record<string, PgColumn> =>
  getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;

const sqlNames = (key: TableKey): string[] =>
  Object.values(columnsOf(key))
    .map((c) => c.name)
    .sort();

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const allMigrationSql = (): string =>
  migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

/**
 * The column names inside one `CREATE TABLE` body, read out of the SQL.
 *
 * READING THE SQL TO ASSERT AGAINST IT IS NOT GENERATING A SCHEMA FROM IT.
 * Nothing here is emitted and nothing is written back; the migrations stay the
 * source and `schema.ts` stays the transcription.
 */
function ddlColumns(rawSql: string, table: string): string[] {
  // COMMENTS COME OUT FIRST, BEFORE ANY SPLITTING. Stripping them per fragment
  // after splitting on commas is wrong, and wrong in a way that reads as a
  // schema drift: `-- reserved, never in v1 math` contains a comma, so the split
  // lands mid-comment and "never" is reported as a column of ledger_entries.
  const sqlText = rawSql.replace(/--[^\n]*/g, '');
  const open = new RegExp(`CREATE TABLE ${table} \\(`, 'i');
  const at = sqlText.search(open);
  if (at < 0) throw new Error(`no CREATE TABLE for ${table}`);
  const body = sqlText.slice(sqlText.indexOf('(', at) + 1);

  // Walk to the matching close paren so nested CHECK(...) does not end the body.
  let depth = 0;
  let end = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  const inner = body.slice(0, end);

  const names: string[] = [];
  let paren = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') paren++;
    if (ch === ')') paren--;
    if (ch === ',' && paren === 0) {
      names.push(current);
      current = '';
    } else current += ch;
  }
  names.push(current);

  return (
    names
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Table-level clauses are not columns.
      .filter((line) => !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(line))
      .map((line) => line.split(/\s+/)[0] ?? '')
      .filter((n) => n.length > 0)
      .sort()
  );
}

/**
 * Whole column DEFINITIONS from a `CREATE TABLE` body, keyed by column name.
 *
 * The definitions carry the inline `REFERENCES`, which is what lets a scope rule
 * be checked against the DATABASE rather than against itself.
 */
function ddlColumnDefs(rawSql: string, table: string): Map<string, string> {
  const sqlText = rawSql.replace(/--[^\n]*/g, '');
  const at = sqlText.search(new RegExp(`CREATE TABLE ${table} \\(`, 'i'));
  if (at < 0) throw new Error(`no CREATE TABLE for ${table}`);
  const body = sqlText.slice(sqlText.indexOf('(', at) + 1);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  const parts: string[] = [];
  let paren = 0;
  let current = '';
  for (const ch of body.slice(0, end)) {
    if (ch === '(') paren++;
    if (ch === ')') paren--;
    if (ch === ',' && paren === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);

  const defs = new Map<string, string>();
  for (const raw of parts) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line.length === 0) continue;
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(line)) continue;
    const name = line.split(' ')[0];
    if (name !== undefined && name.length > 0) defs.set(name, line);
  }
  return defs;
}

describe('the registry is total', () => {
  // THE APPROVAL CLAUSE'S FIGURE, COMPUTED. Reported as N of 111 rather than
  // rounded up: the other 104 are unreachable through either accessor.
  test('7 declared tables, 7 scope rules, 0 reachable without one', () => {
    const declared = TABLE_KEYS.length;
    const rules = Object.keys(SCOPE_RULES).length;
    const withoutRule = TABLE_KEYS.filter((k) => !(k in SCOPE_RULES));

    expect(declared).toBe(7);
    expect(rules).toBe(7);
    expect(withoutRule).toEqual([]);

    const createdTables = (allMigrationSql().match(/^CREATE TABLE /gim) ?? []).length;
    expect(createdTables).toBe(111);
  });

  test('every class in the vocabulary has at least one member, so none is vacuous', () => {
    const classes = new Set(TABLE_KEYS.map((k) => SCOPE_RULES[k].class));
    expect([...classes].sort()).toEqual(['derived', 'firm', 'owned', 'root']);
  });

  test('every rule carries a reason and none is a placeholder', () => {
    for (const key of TABLE_KEYS) {
      const why = SCOPE_RULES[key].why;
      expect(why.length, key).toBeGreaterThan(40);
      expect(why.toLowerCase(), key).not.toMatch(/^(todo|tbd|placeholder)/);
    }
  });
});

describe('every rule resolves against the schema', () => {
  // If this fails, `columnByName`'s throw is REACHABLE, which means the registry
  // and the schema have drifted from each other.
  test('every column a rule names exists on the table it names it for', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      const here = sqlNames(key);
      if (rule.class === 'root' || rule.class === 'owned') {
        expect(here, `${key}.${rule.column}`).toContain(rule.column);
      } else if (rule.class === 'derived') {
        expect(here, `${key}.${rule.localColumn}`).toContain(rule.localColumn);
        expect(sqlNames(rule.via), `${rule.via}.${rule.foreignColumn}`).toContain(
          rule.foreignColumn,
        );
      }
    }
  });

  // `traversal` IS CHECKED RATHER THAN TRUSTED. A field the code reads the same
  // way whatever it says is prose, and ADR-042 already ruled prose is not a
  // control. A `hop` is safe to join because it points at the via table's
  // PRIMARY KEY; a `semi-join` is not, and that is why it must be an EXISTS.
  test('every hop names the via table primary key, and every semi-join does not', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'derived') continue;
      const viaCols = columnsOf(rule.via);
      const target = Object.values(viaCols).find((c) => c.name === rule.foreignColumn);
      expect(target, `${rule.via}.${rule.foreignColumn}`).toBeDefined();
      const isPrimary = target?.primary === true;
      if (rule.traversal === 'hop') {
        expect(
          isPrimary,
          `${key} is a hop, so ${rule.via}.${rule.foreignColumn} must be a PK`,
        ).toBe(true);
      } else {
        expect(
          isPrimary,
          `${key} is a semi-join, so ${rule.via}.${rule.foreignColumn} must NOT be a PK`,
        ).toBe(false);
      }
    }
  });
});

describe('a scope rule is checked against the DDL, not against itself', () => {
  // THE TEST THAT WOULD HAVE CAUGHT THE SEED THAT SURVIVED. Session 145 seeded
  // `accounts` scoped by `user_id` instead of `identity_id` and ALL TWENTY-TWO
  // assertions passed, because the render test took its expected column FROM THE
  // RULE and so was asserting the code against itself.
  //
  // A USER IS A LOGIN AND AN IDENTITY IS THE PERSON, and ADR-041 is why they are
  // two columns. Scoping accounts by `user_id` returns a DIFFERENT SET OF ROWS,
  // silently, for every trader whose identity has more than one login -- which is
  // the exact failure ADR-008 scoped the wrapper to bound.
  //
  // The expectation therefore comes from the MIGRATIONS: an `owned` column must
  // be declared `REFERENCES identities(id)` in the DDL. `user_id` references
  // `users(id)` and `treasury_balances.recorded_by` references `users(id)`, so
  // both are refused by the database's own declaration rather than by a list
  // somebody remembered to update.
  const sqlText = allMigrationSql();
  const SQL_NAME: Readonly<Record<TableKey, string>> = {
    identities: 'identities',
    accounts: 'accounts',
    ledgerAccounts: 'ledger_accounts',
    ledgerEntries: 'ledger_entries',
    ledgerTransactions: 'ledger_transactions',
    treasuryBalances: 'treasury_balances',
    liabilitySnapshots: 'liability_snapshots',
  };

  test('every owned rule names a column the DDL declares REFERENCES identities(id)', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'owned') continue;
      const defs = ddlColumnDefs(sqlText, SQL_NAME[key]);
      const def = defs.get(rule.column);
      expect(def, `${SQL_NAME[key]}.${rule.column} is not a column`).toBeDefined();
      expect(
        def ?? '',
        `${SQL_NAME[key]}.${rule.column} must reference identities(id), and its DDL is: ${def ?? ''}`,
      ).toMatch(/REFERENCES\s+identities\s*\(\s*id\s*\)/i);
    }
  });

  test('the root rule is the identities table itself', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root') continue;
      expect(SQL_NAME[key]).toBe('identities');
      expect(rule.column).toBe('id');
    }
  });

  test('every derived rule names a foreign key the DDL actually declares', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'derived') continue;
      const here = ddlColumnDefs(sqlText, SQL_NAME[key]).get(rule.localColumn);
      const there = ddlColumnDefs(sqlText, SQL_NAME[rule.via]).get(rule.foreignColumn);
      expect(here, `${SQL_NAME[key]}.${rule.localColumn}`).toBeDefined();
      expect(there, `${SQL_NAME[rule.via]}.${rule.foreignColumn}`).toBeDefined();

      // The edge is declared in ONE of the two directions and either is valid:
      // ledger_entries.ledger_account_id -> ledger_accounts(id) points forward,
      // and ledger_entries.transaction_id -> ledger_transactions(id) is the
      // reverse edge ledger_transactions traverses.
      const forward = new RegExp(`REFERENCES\\s+${SQL_NAME[rule.via]}\\s*\\(`, 'i').test(
        here ?? '',
      );
      const reverse = new RegExp(`REFERENCES\\s+${SQL_NAME[key]}\\s*\\(`, 'i').test(there ?? '');
      expect(
        forward || reverse,
        `no declared FK between ${SQL_NAME[key]}.${rule.localColumn} and ${SQL_NAME[rule.via]}.${rule.foreignColumn}`,
      ).toBe(true);
    }
  });

  test('no firm table carries a column referencing identities, so the class is not hiding one', () => {
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'firm') continue;
      const defs = [...ddlColumnDefs(sqlText, SQL_NAME[key]).values()];
      const reaching = defs.filter((d) => /REFERENCES\s+identities\s*\(/i.test(d));
      expect(reaching, `${SQL_NAME[key]} reaches identities directly`).toEqual([]);
    }
  });
});

describe('the predicates discriminate', () => {
  // RENDERED TO SQL AND READ, not merely constructed. A predicate that built
  // without throwing would satisfy a `toBeDefined()` while comparing the wrong
  // column, or no column, which is the failure this whole entry exists to bound.
  const dialect = new PgDialect();
  const render = (key: TableKey): { sql: string; params: unknown[] } =>
    dialect.sqlToQuery(scopePredicate(key, IDENTITY)) as { sql: string; params: unknown[] };

  test('root and owned compare the identity column, and bind the identity', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root' && rule.class !== 'owned') continue;
      const { sql: text, params } = render(key);
      expect(text, key).toContain(`"${rule.column}"`);
      expect(text, key).toMatch(/=\s*\$1/);
      expect(params, key).toEqual(['i-1']);
      // A scoped read must never be a bare table scan.
      expect(text, key).not.toMatch(/^\s*(true|1\s*=\s*1)\s*$/i);
    }
  });

  test('ledger_entries reaches the identity through ledger_accounts, in one hop', () => {
    const { sql: text, params } = render('ledgerEntries');
    expect(text).toMatch(/exists/i);
    expect(text).toContain('"ledger_accounts"');
    expect(text).toContain('"identity_id"');
    expect(params).toEqual(['i-1']);
  });

  test('ledger_transactions uses EXISTS, because a join would multiply rows', () => {
    const { sql: text, params } = render('ledgerTransactions');
    expect(text).toMatch(/exists/i);
    // THE CHAIN IS TWO DEEP: transactions -> entries -> accounts, and the
    // identity is compared only at the end of it.
    expect(text).toContain('"ledger_entries"');
    expect(text).toContain('"ledger_accounts"');
    expect(text).toContain('"identity_id"');
    // AND IT IS NOT A JOIN. A join here returns the transaction once per
    // matching entry, and a transaction has a trader leg AND a firm leg.
    expect(text).not.toMatch(/\bjoin\b/i);
    expect(params).toEqual(['i-1']);
  });

  test('a firm table has no scoped reading, and says so rather than returning nothing', () => {
    expect(() => scopePredicate('treasuryBalances', IDENTITY)).toThrow(/belongs to no identity/);
    expect(() => scopePredicate('liabilitySnapshots', IDENTITY)).toThrow(/systemDb/);
  });
});

describe('the accessors', () => {
  test('the scoped accessor carries the identity it is scoped by', () => {
    expect(scopedDb(IDENTITY).identityId).toBe('i-1');
  });

  test('the unscoped reader carries a reason from a closed vocabulary', () => {
    expect(systemDb('nightly-batch').reason).toBe('nightly-batch');
    expect(systemDb('operator-console').reason).toBe('operator-console');
  });

  test('the two accessors carry disjoint brands, which is what makes them unmixable', () => {
    expect(scopedDb(IDENTITY).__brand).toBe('ScopedDb');
    expect(systemDb('nightly-batch').__brand).toBe('SystemDb');
    expect(scopedDb(IDENTITY).__brand).not.toBe(systemDb('nightly-batch').__brand);
  });
});

describe('the TypeScript schema has not drifted from the DDL', () => {
  // ADR-008's "types are generated from the schema so drift is a compile error"
  // is FALSE on this tree and ADR-084 supersedes it. This is what replaces it.
  const sqlText = allMigrationSql();

  const DDL_NAMES: ReadonlyArray<readonly [TableKey, string]> = [
    ['identities', 'identities'],
    ['accounts', 'accounts'],
    ['ledgerAccounts', 'ledger_accounts'],
    ['ledgerEntries', 'ledger_entries'],
    ['ledgerTransactions', 'ledger_transactions'],
    ['treasuryBalances', 'treasury_balances'],
    ['liabilitySnapshots', 'liability_snapshots'],
  ];

  test('the seven map to the SQL names the DDL uses', () => {
    for (const [key, sqlName] of DDL_NAMES) {
      expect(getTableName(TABLES[key] as PgTable)).toBe(sqlName);
    }
  });

  for (const [key, sqlName] of DDL_NAMES) {
    test(`${sqlName}: the TS column set equals the CREATE TABLE column set`, () => {
      expect(sqlNames(key)).toEqual(ddlColumns(sqlText, sqlName));
    });
  }

  // THE ABSENCE THIS ASSERTION RESTS ON, RE-RUN AT TEST TIME RATHER THAN
  // MEASURED ONCE AND WRITTEN DOWN. Comparing against the `CREATE TABLE` body is
  // only sound while no LATER migration changes the table's columns. Session 145
  // measured that absence wide -- ADD, DROP, ALTER and RENAME, not `ADD COLUMN`
  // textually -- and this re-derives it on every run, so the day one lands the
  // check FAILS rather than silently reading a stale CREATE.
  test('no later migration changes a column on any of the seven', () => {
    const sevenSqlNames = DDL_NAMES.map(([, n]) => n);
    const offenders: string[] = [];

    for (const file of migrationFiles()) {
      const text = readFileSync(join(MIGRATIONS, file), 'utf8');
      const statements = text.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_]+)"?([\s\S]*?);/gi,
      );
      for (const statement of statements ?? []) {
        const table = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_]+)"?/i.exec(statement)?.[1];
        if (table === undefined || !sevenSqlNames.includes(table)) continue;
        // ADD CONSTRAINT does not change a column set. Two exist and both are
        // named in ADR-084: ledger_transactions in 0009 and accounts in 0010.
        if (/\bADD\s+CONSTRAINT\b/i.test(statement)) continue;
        if (/\b(ADD|DROP|ALTER)\s+COLUMN\b|\bRENAME\b/i.test(statement)) {
          offenders.push(`${file}: ${statement.slice(0, 90).replace(/\s+/g, ' ')}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('the seven are each created exactly once, so there is one CREATE to read', () => {
    for (const [, sqlName] of DDL_NAMES) {
      const matches = allMigrationSql().match(new RegExp(`CREATE TABLE ${sqlName} \\(`, 'gi'));
      expect(matches?.length, sqlName).toBe(1);
    }
  });
});
