// =============================================================================
// packages/db/test/write-accessor.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-102, AND IT IS A NEW FILE FOR A STATED REASON.
// `scoped-db.test.ts` is held by five concurrent sessions (206, 207, 208, 214,
// 215) transcribing tables into `schema.ts` and `scope.ts`. Nothing here touches
// a table's rows, so this file and that one never meet.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES A WRITE, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with NO services
// block, so there is no Postgres in CI to write to. Every assertion below reads
// the SQL the accessor BUILDS, the way `scoped-db.test.ts` reads the predicate
// it builds, and no row is inserted, updated or deleted anywhere.
//
// A suite that LOOKED like it exercised a write and did not would be worse than
// one that says it did not, so it is said here, once, in the file's own header:
// THE ROUND TRIP THROUGH A REAL DATABASE IS NOT ASSERTED BY THIS FILE AND IS NOT
// ASSERTED ANYWHERE ELSE EITHER. What is asserted is the statement text, its
// parameters, and the refusals -- which is the whole of what a wrong scope looks
// like before it reaches a driver.
//
// THE STATEMENTS ARE THE ACCESSOR'S OWN AND NOT A REIMPLEMENTATION. The handles
// are built over a DRIVERLESS Drizzle handle (`drizzle-orm/pg-proxy`) whose
// callback records `(sql, params)`, so what is asserted is what
// `scopedTx(...).update(...)` actually sends. ADR-084 section 7 is why that
// distinction is worth the machinery: a suite that renders its own expectation
// from the same rule it is checking agrees with a wrong rule.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PoolClient } from 'pg';
import { describe, expect, test } from 'vitest';

import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  scopePredicate,
  scopedDb,
  systemDb,
  type FirmTableKey,
  type IdentityId,
  type ScopedTableKey,
  type TableKey,
} from '../src/index.ts';
import {
  firmDb,
  firmTx,
  scopedTx,
  systemTx,
  tenancyColumn,
  tenancyColumns,
  type OwnedTableKey,
  type StatementSource,
} from '../src/scoped-db.ts';

const IDENTITY = 'i-1' as IdentityId;
const OTHER = 'i-2' as IdentityId;

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const QUEUE_SOURCE = fileURLToPath(new URL('../../queue/src/job-queue.ts', import.meta.url));

// THE THREE PARTITIONS, NARROWED BY A PREDICATE THAT RESTATES EACH TYPE'S OWN
// DEFINITION. `FirmTableKey` IS `class extends 'firm'` and `ScopedTableKey` is
// its complement, so each guard below is the same condition the type is made of
// rather than a second claim about the registry. The narrowing is needed at all
// because `Array.filter` cannot see through an index into `SCOPE_RULES`, and the
// error it produced before these were added was itself the refusal working:
// `TableKey` is not assignable to `FirmTableKey`.
// ADR-106 SPLIT THIS SET AND THE FILTER IS WHERE THAT LANDS. `ScopedTableKey`
// used to be everything that was not `firm`; a `pair` table is neither, so the
// predicate has to name both exclusions or this array claims keys the type it is
// annotated with does not contain.
const SCOPED_KEYS: ScopedTableKey[] = TABLE_KEYS.filter(
  (k): k is ScopedTableKey => SCOPE_RULES[k].class !== 'firm' && SCOPE_RULES[k].class !== 'pair',
);
const PAIR_KEYS: TableKey[] = TABLE_KEYS.filter((k) => SCOPE_RULES[k].class === 'pair');
const FIRM_KEYS: FirmTableKey[] = TABLE_KEYS.filter(
  (k): k is FirmTableKey => SCOPE_RULES[k].class === 'firm',
);
const OWNED_KEYS: OwnedTableKey[] = TABLE_KEYS.filter(
  (k): k is OwnedTableKey => SCOPE_RULES[k].class === 'owned',
);

/**
 * One statement, as the accessor sent it.
 *
 * `method` is the proxy driver's own word for the shape it expected back and is
 * recorded rather than asserted: what matters here is the text and the binds.
 */
interface Sent {
  readonly sql: string;
  readonly params: unknown[];
}

/** A driverless Drizzle handle that records what it is asked to run. */
function recording(): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const source: StatementSource = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: [] };
  });
  return { source, sent };
}

/** A `pg` connection that records, for the raw-executor assertions. */
function recordingConn(): {
  conn: PoolClient;
  queries: Array<{ text: string; values: unknown[] | undefined }>;
} {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const conn = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rows: [] as unknown[] };
    },
  } as unknown as PoolClient;
  return { conn, queries };
}

/** Run one statement through a recording handle and return what it sent. */
async function sentBy(
  run: (source: StatementSource, conn: PoolClient) => Promise<unknown>,
): Promise<Sent> {
  const { source, sent } = recording();
  const { conn } = recordingConn();
  await run(source, conn);
  expect(sent, 'exactly one statement per call').toHaveLength(1);
  return sent[0] as Sent;
}

/**
 * PLACEHOLDER NUMBERS NORMALISED, AND ONLY THEM.
 *
 * `scopePredicate` alone renders as `$1`; carried into an UPDATE that also sets
 * one column it renders as `$2`, because the SET binds first. The predicate is
 * the same predicate and the ordinal is an artefact of where it sits, so the
 * comparison erases the ordinal and NOTHING ELSE. Column names, table names,
 * operators and the EXISTS bodies are all compared verbatim.
 */
const anonymise = (text: string): string => text.replace(/\$\d+/g, '$?');

const migrationSql = (): string =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

const ALL_SQL = migrationSql();

const dialect = new PgDialect();
const renderedPredicate = (key: TableKey): { sql: string; params: unknown[] } =>
  dialect.sqlToQuery(scopePredicate(key, IDENTITY)) as { sql: string; params: unknown[] };

/** One non-tenancy column of a table, for a SET or a VALUES that has to say something. */
function someOtherColumn(key: TableKey): string {
  const tenancy = tenancyColumn(key);
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const [property, column] of Object.entries(columns)) {
    if (column.name !== tenancy) return property;
  }
  throw new Error(`${key} has no column that is not its tenancy column`);
}

// =============================================================================
// CLAUSE 1: THE WRITE PATH AND HOW IT SCOPES
// =============================================================================

describe('an UPDATE and a DELETE carry the read predicate', () => {
  // THE ONE THAT BINDS READ AND WRITE TOGETHER. `scopedTx` calls
  // `scopePredicate`, so this pair does not prove the predicate is CORRECT --
  // `scoped-db.test.ts` is where correctness lives, against the DDL. What it
  // proves is that the write path has not grown a predicate builder of its own,
  // which is the way one place quietly becomes two.
  test('every scoped UPDATE carries exactly the predicate the matching read does', async () => {
    for (const key of SCOPED_KEYS) {
      const values = { [someOtherColumn(key)]: null };
      const sent = await sentBy((source, conn) =>
        scopedTx(source, conn, IDENTITY).update(key, values),
      );
      const predicate = renderedPredicate(key);
      expect(sent.sql, key).toContain(' where ');
      const where = sent.sql
        .slice(sent.sql.indexOf(' where ') + ' where '.length)
        .split(' returning ')[0] as string;
      expect(anonymise(where), key).toBe(anonymise(predicate.sql));
      expect(sent.params.at(-1), key).toBe(IDENTITY);
    }
  });

  test('every scoped DELETE carries exactly the predicate the matching read does', async () => {
    for (const key of SCOPED_KEYS) {
      const sent = await sentBy((source, conn) => scopedTx(source, conn, IDENTITY).delete(key));
      const predicate = renderedPredicate(key);
      expect(sent.sql, key).toContain(' where ');
      const where =
        sent.sql.slice(sent.sql.indexOf(' where ') + ' where '.length).split(' returning ')[0] ??
        '';
      expect(anonymise(where), key).toBe(anonymise(predicate.sql));
      expect(sent.params, key).toEqual([IDENTITY]);
    }
  });

  // INDEPENDENT OF `scopePredicate` ENTIRELY, and that is the point of having it
  // as well. Both tests above stay green if the predicate becomes `1=1` on both
  // sides at once. These do not.
  test('no scoped write is ever a bare table scan', async () => {
    for (const key of SCOPED_KEYS) {
      const del = await sentBy((source, conn) => scopedTx(source, conn, IDENTITY).delete(key));
      expect(del.sql, key).toMatch(/\swhere\s/);
      expect(del.sql, key).not.toMatch(/\swhere\s+(true|1\s*=\s*1)\b/i);
      expect(del.params, key).toEqual([IDENTITY]);
    }
  });

  test('a root or owned write compares the tenancy column and binds the identity', async () => {
    for (const key of SCOPED_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root' && rule.class !== 'owned') continue;
      const del = await sentBy((source, conn) => scopedTx(source, conn, IDENTITY).delete(key));
      expect(del.sql, key).toContain(`"${rule.column}"`);
      expect(del.sql, key).toMatch(/=\s*\$1/);
    }
  });

  test('a derived write reaches the identity through an EXISTS, never a join', async () => {
    for (const key of SCOPED_KEYS) {
      if (SCOPE_RULES[key].class !== 'derived') continue;
      const del = await sentBy((source, conn) => scopedTx(source, conn, IDENTITY).delete(key));
      expect(del.sql, key).toMatch(/exists/i);
      expect(del.sql, key).not.toMatch(/\bjoin\b/i);
    }
  });
});

describe('an INSERT has no WHERE clause, so the identity is WRITTEN', () => {
  test('every owned INSERT stamps the tenancy column from the handle', async () => {
    for (const key of OWNED_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'owned') continue;
      const sent = await sentBy((source, conn) =>
        scopedTx(source, conn, IDENTITY).insert(key, { [someOtherColumn(key)]: null }),
      );
      expect(sent.sql, key).toMatch(/^insert into /);
      expect(sent.sql, key).toContain(`"${rule.column}"`);
      expect(sent.params, key).toContain(IDENTITY);
    }
  });

  test('the stamp comes from the HANDLE and never from anything the caller can reach', async () => {
    // Two handles, same table, same values: the only thing that differs in the
    // bound parameters is the identity, and it came from the handle.
    const key = 'accounts' as const;
    const mine = await sentBy((source, conn) => scopedTx(source, conn, IDENTITY).insert(key, {}));
    const theirs = await sentBy((source, conn) => scopedTx(source, conn, OTHER).insert(key, {}));
    expect(mine.sql).toBe(theirs.sql);
    expect(mine.params).toContain(IDENTITY);
    expect(mine.params).not.toContain(OTHER);
    expect(theirs.params).toContain(OTHER);
    expect(theirs.params).not.toContain(IDENTITY);
  });
});

describe('a caller never names the tenancy column', () => {
  // THE REFUSAL THAT MATTERS MOST, AND IT IS WATCHED ON EVERY TABLE RATHER THAN
  // ON ONE. A caller that can name its own tenancy value on the write side has
  // routed around exactly what ADR-101's clause 1 refuses on the read side: the
  // registry would say how a row reaches an identity, and the call site would
  // say something else, and the row would be indistinguishable from an honest
  // one afterwards.
  test('an INSERT naming the tenancy column is refused, in the registry spelling', async () => {
    for (const key of OWNED_KEYS) {
      const sqlName = tenancyColumn(key) as string;
      const { source, conn } = { ...recording(), ...recordingConn() };
      await expect(
        scopedTx(source, conn, IDENTITY).insert(key, { [sqlName]: OTHER }),
        key,
      ).rejects.toThrow(/tenancy column/);
    }
  });

  test('an INSERT naming the tenancy column is refused in the Drizzle spelling too', async () => {
    for (const key of OWNED_KEYS) {
      const sqlName = tenancyColumn(key) as string;
      const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<
        string,
        PgColumn
      >;
      const property = Object.entries(columns).find(([, c]) => c.name === sqlName)?.[0];
      expect(property, `${key} declares ${sqlName}`).toBeDefined();
      const { source, conn } = { ...recording(), ...recordingConn() };
      await expect(
        scopedTx(source, conn, IDENTITY).insert(key, { [property as string]: OTHER }),
        key,
      ).rejects.toThrow(/tenancy column/);
    }
  });

  test('an UPDATE that would RE-PARENT a row is refused, on every class that has a parent', async () => {
    // The predicate matched the row as it stands. A SET that moves the tenancy
    // column hands the row to somebody else AFTER the predicate agreed to it,
    // and `derived` is the class where this is least visible: the column being
    // moved is a foreign key, not an identity.
    for (const key of SCOPED_KEYS) {
      const sqlName = tenancyColumn(key);
      expect(sqlName, `${key} is not firm, so it has a tenancy column`).toBeDefined();
      const { source, conn } = { ...recording(), ...recordingConn() };
      await expect(
        scopedTx(source, conn, IDENTITY).update(key, { [sqlName as string]: OTHER }),
        key,
      ).rejects.toThrow(/tenancy column/);
    }
  });

  test('a write that names no tenancy column is accepted', async () => {
    // The refusal has to be about the column and not about writing at all. A
    // guard that refused everything would pass every test above.
    for (const key of SCOPED_KEYS) {
      const { source, conn } = { ...recording(), ...recordingConn() };
      await expect(
        scopedTx(source, conn, IDENTITY).update(key, { [someOtherColumn(key)]: null }),
      ).resolves.toBeDefined();
    }
  });
});

describe('the tenancy reader reads something', () => {
  // ADR-101's OWN LESSON, APPLIED HERE BEFORE IT COSTS ANYTHING. Every refusal
  // above passes if `tenancyColumn` silently stops resolving: a guard that finds
  // nothing looks exactly like a guard with nothing to find. These two are what
  // fail, once per table, in that case.
  test('every table has the number of tenancy columns its class declares', () => {
    // THREE ANSWERS AND NOT TWO, since ADR-106. `firm` has none, `pair` has TWO,
    // and everything else has exactly one -- so the singular reader returns
    // `undefined` for two DIFFERENT reasons and the plural is what tells them
    // apart. A reader that silently stopped resolving would return an empty list
    // for every table and fail here on the first non-firm one.
    for (const key of TABLE_KEYS) {
      const columns = tenancyColumns(key);
      const single = tenancyColumn(key);
      if (SCOPE_RULES[key].class === 'firm') {
        expect(columns, key).toEqual([]);
        expect(single, key).toBeUndefined();
      } else if (SCOPE_RULES[key].class === 'pair') {
        expect(columns.length, key).toBe(2);
        expect(columns[0], key).not.toBe(columns[1]);
        expect(
          single,
          `${key} has two, so the singular reader must refuse to guess`,
        ).toBeUndefined();
      } else {
        expect(columns.length, key).toBe(1);
        expect(single, key).toEqual(expect.any(String));
      }
    }
    expect(SCOPED_KEYS.length + PAIR_KEYS.length + FIRM_KEYS.length).toBe(TABLE_KEYS.length);
  });

  test('every tenancy column is declared by the migrations for its own table', () => {
    // THE PRIMARY SOURCE, not `schema.ts`. `getTableName` is used for the table
    // name only, which `scoped-db.test.ts` already binds to the DDL against a
    // hand-written map; what is checked here is the COLUMN, which no other
    // assertion in this package reads out of the SQL for this purpose.
    for (const key of SCOPED_KEYS) {
      const table = getTableName(TABLES[key] as PgTable);
      const column = tenancyColumn(key) as string;
      const declared = new RegExp(
        `(CREATE TABLE ${table}\\s*\\([\\s\\S]*?\\n\\);|ALTER TABLE ${table}[\\s\\S]*?;)`,
        'gi',
      );
      const bodies = ALL_SQL.match(declared) ?? [];
      expect(bodies.length, `${table} is declared somewhere in migrations/`).toBeGreaterThan(0);
      const found = bodies.some((body) =>
        new RegExp(`(^|[\\s(,])${column}\\s`, 'i').test(body.replace(/--[^\n]*/g, '')),
      );
      expect(found, `${table}.${column} is declared in the DDL`).toBe(true);
    }
  });
});

// =============================================================================
// CLAUSE 2: THE TRANSACTION, AND THE `JobTransaction` NOTHING COULD PRODUCE
// =============================================================================

describe('the raw executor is a named door and not a property', () => {
  test('`executeSql` passes the vendor text and binds through UNCHANGED', async () => {
    // pg-boss generates its own SQL with `$n` placeholders. Anything that
    // rewrote it -- splitting on `$n` to rebuild it as Drizzle chunks, say --
    // would work until a dollar-quoted string or a literal `$1` inside a text
    // value went through it. This asserts the pass-through is byte-exact.
    const { source } = recording();
    const { conn, queries } = recordingConn();
    const text = 'insert into j (name, data) values ($1, $2::jsonb) -- $$not a placeholder$$';
    const values = [1_50, 'x'];
    const out = await scopedTx(source, conn, IDENTITY)
      .sqlExecutor('job-enqueue')
      .executeSql(text, values);
    expect(queries).toEqual([{ text, values }]);
    expect(out).toEqual({ rows: [] });
  });

  test('a reason outside the vocabulary is refused even past a cast', () => {
    const { source } = recording();
    const { conn } = recordingConn();
    expect(() => scopedTx(source, conn, IDENTITY).sqlExecutor('whatever' as never)).toThrow(
      /not a reason to run raw SQL/,
    );
  });

  test('all three authorities produce an executor, and it is the same shape', () => {
    const { source } = recording();
    const { conn } = recordingConn();
    for (const handle of [
      scopedTx(source, conn, IDENTITY),
      systemTx(source, conn, 'nightly-batch'),
      firmTx(source, conn),
    ]) {
      expect(Object.keys(handle.sqlExecutor('job-enqueue'))).toEqual(['executeSql']);
    }
  });
});

describe('`SqlExecutor` is the `JobTransaction` `packages/queue` declares, read rather than restated', () => {
  // ADR-092 SECTION 5's HAZARD, CLOSED THE ONLY WAY IT CAN BE FROM HERE.
  // `packages/db` declares no dependency on `@merit/queue` and `packages/queue`
  // declares none on `@merit/db` -- its manifest says in its own `//` key that
  // the absence "is the design rather than an omission" -- so the two shapes
  // cannot be bound by an import in either direction, and `package.json` is
  // outside this session's fence besides. They are bound by READING the other
  // package's source, which is the instrument ADR-101 used on the migrations.
  const queueSource = readFileSync(QUEUE_SOURCE, 'utf8');
  const ourSource = readFileSync(
    fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
    'utf8',
  );

  const bodyOf = (text: string, name: string): string => {
    const open = text.indexOf(`export interface ${name} {`);
    expect(open, `${name} is declared`).toBeGreaterThan(-1);
    const close = text.indexOf('\n}', open);
    return text
      .slice(text.indexOf('{', open) + 1, close)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*'))
      .join(' ');
  };

  test('the two interface bodies are the same declaration', () => {
    expect(bodyOf(ourSource, 'SqlExecutor')).toBe(bodyOf(queueSource, 'JobTransaction'));
  });

  test('the queue still takes the transaction FIRST and offers no overload without it', () => {
    // If `enqueue` ever gained a non-transactional form, this file's whole
    // reason for producing an executor would have changed and nobody here would
    // otherwise notice.
    expect(queueSource).toContain(
      'enqueue<P extends JobPayload>(tx: JobTransaction, request: JobRequest<P>): Promise<JobId | null>;',
    );
  });

  test('neither package IMPORTS the other', () => {
    // Prose may name it; a module specifier may not. The whole point of the
    // structural bind is that no dependency edge exists in either direction.
    const specifiers = (text: string): string[] =>
      [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1] as string);
    expect(specifiers(ourSource).filter((s) => s.includes('queue'))).toEqual([]);
    expect(specifiers(queueSource).filter((s) => s.includes('db'))).toEqual([]);
  });
});

describe('a write is reachable ONLY through a transaction', () => {
  // THE REGRESSION GUARD FOR ADR-084's TWO WATCHED REFUSALS. `CI-01`'s brand
  // seed declares a value carrying exactly these four members and demands that
  // `__brand` is what refuses it. Add a required method to `ScopedDb` and
  // TypeScript reports a MISSING PROPERTY instead, the needle stops matching,
  // and the seed passes on the wrong evidence. This asserts the shape the seed
  // depends on, in the package that owns it, rather than leaving it to a file
  // this session may not touch.
  test('`scopedDb` still carries exactly `__brand`, `identityId` and `rows`', () => {
    expect(Object.keys(scopedDb(IDENTITY)).sort()).toEqual(['__brand', 'identityId', 'rows']);
  });

  test('`systemDb` still carries exactly `__brand`, `reason` and `rows`', () => {
    expect(Object.keys(systemDb('nightly-batch')).sort()).toEqual(['__brand', 'reason', 'rows']);
  });

  test('no read handle carries a write method or an executor', () => {
    for (const handle of [scopedDb(IDENTITY), systemDb('operator-console'), firmDb()]) {
      for (const forbidden of ['insert', 'update', 'delete', 'sqlExecutor', 'transaction']) {
        expect(forbidden in handle, `${handle.__brand}.${forbidden}`).toBe(false);
      }
    }
  });

  test('a transaction handle offers no nested transaction', () => {
    const { source } = recording();
    const { conn } = recordingConn();
    for (const tx of [
      scopedTx(source, conn, IDENTITY),
      systemTx(source, conn, 'nightly-batch'),
      firmTx(source, conn),
    ]) {
      expect('transaction' in tx, tx.__brand).toBe(false);
    }
  });

  test('the four brands are pairwise distinct', () => {
    const { source } = recording();
    const { conn } = recordingConn();
    const brands = [
      scopedDb(IDENTITY).__brand,
      systemDb('nightly-batch').__brand,
      firmDb().__brand,
      scopedTx(source, conn, IDENTITY).__brand,
      systemTx(source, conn, 'nightly-batch').__brand,
      firmTx(source, conn).__brand,
    ];
    expect(new Set(brands).size).toBe(brands.length);
  });
});

// =============================================================================
// CLAUSE 3: THE READER WITH NO IDENTITY
// =============================================================================

describe('the vocabulary stays at two members', () => {
  // ADR-096 CLAUSE 3, KEPT AND CHECKED. That entry refused a third
  // `SystemReason` for `apps/site` and its argument was that "a list whose third
  // member is the public website is a list nobody has to justify joining". This
  // entry needed a reader with no identity and did not spend that list.
  const ourSource = readFileSync(
    fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
    'utf8',
  );

  test('`SystemReason` is still exactly the two ADR-084 accepted', () => {
    expect(ourSource).toContain("export type SystemReason = 'nightly-batch' | 'operator-console';");
  });

  test('`firmDb` takes no argument at all, so there is no reason to widen', () => {
    expect(firmDb.length).toBe(0);
    expect(Object.keys(firmDb()).sort()).toEqual(['__brand', 'rows']);
  });
});

describe('the tables a request handler needs are the ones that belong to nobody', () => {
  // THE FINDING CLAUSE 3 EXISTS FOR, ASSERTED RATHER THAN DESCRIBED. Each of
  // these is `firm`, so each is excluded from `ScopedTableKey`, so before
  // `firmDb()` each was reachable only by a caller writing one of two words
  // neither of which is true of a request handler.
  const NEEDED = [
    'coupons',
    'pspWebhookEvents',
    'integrationContracts',
    'planVersions',
    'planVersionSizes',
  ] as const satisfies readonly TableKey[];

  test('each is registered `firm`, which is why the scoped accessor cannot serve it', () => {
    for (const key of NEEDED) expect(SCOPE_RULES[key].class, key).toBe('firm');
  });

  test('the firm accessor serves every one of them and no scoped table', async () => {
    for (const key of NEEDED) {
      const sent = await sentBy(async (source, conn) => firmTx(source, conn).rows(key));
      expect(sent.sql, key).toMatch(/^select /);
      expect(sent.sql, key).not.toMatch(/\swhere\s/);
    }
  });

  test('a scoped key passed to the firm accessor is refused past a cast', async () => {
    // The real refusal is the TYPE: `FirmTableKey` excludes every scoped table,
    // so `firmDb().rows('accounts')` does not compile. This is the runtime half,
    // for a caller that got there through a cast, and it is `scopePredicate`'s
    // own idiom one class over.
    for (const key of SCOPED_KEYS) {
      expect(() => scopePredicate(key, IDENTITY), key).not.toThrow();
    }
    for (const key of FIRM_KEYS) {
      expect(() => scopePredicate(key, IDENTITY), key).toThrow(/belongs to no identity/);
    }
    // ADR-106. A `pair` key is in NEITHER door's type, so it is refused past a
    // cast by both -- and the message is a different one, because the reason is
    // a different one: two identities own the row rather than none.
    for (const key of PAIR_KEYS) {
      expect(() => scopePredicate(key, IDENTITY), key).toThrow(/belongs to TWO identities/);
    }
  });

  test('a caller may not move EITHER identity column of a pair row, on the door that can reach one', async () => {
    // THE ONE PLACE ADR-102's CLAUSE 4 MEETS ADR-106. A `pair` table is not in
    // `ScopedTableKey`, so `scopedTx` cannot reach it at all; `systemTx` is
    // generic over `TableKey` and CAN, and its `update` runs through the same
    // `refuseTenancyColumn`. All three pair tables are append-only in the
    // identity columns -- `identity_links` by 0002's own comment, `attributions`
    // by INV-M8-01's one-attribution-per-purchase -- so moving one is the
    // re-parenting clause 4 refuses, arriving on the class that has two to move.
    for (const key of PAIR_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'pair') continue;
      for (const column of [rule.columnA, rule.columnB]) {
        const { source, conn } = { ...recording(), ...recordingConn() };
        await expect(
          systemTx(source, conn, 'operator-console').update(key, { [column]: OTHER }),
          `${key}.${column}`,
        ).rejects.toThrow(/tenancy column/);
      }
    }
  });
});

describe('the firm, pair and scoped partitions cover the registry exactly', () => {
  test('every registered table is in exactly one of the three doors', () => {
    // COMPARED AS STRINGS DELIBERATELY. `FIRM_KEYS.includes(scopedKey)` does not
    // COMPILE -- `ScopedTableKey` is not assignable to `FirmTableKey` -- which is
    // the disjointness already proved by the type. This is the runtime half, and
    // it also catches a registry where the two sets fail to COVER `TableKey`,
    // which no type states.
    const firm: string[] = FIRM_KEYS;
    const scoped: string[] = SCOPED_KEYS;
    const pair: string[] = PAIR_KEYS;
    expect(scoped.filter((k) => firm.includes(k))).toEqual([]);
    expect(scoped.filter((k) => pair.includes(k))).toEqual([]);
    expect(pair.filter((k) => firm.includes(k))).toEqual([]);
    expect([...scoped, ...pair, ...firm].sort()).toEqual([...TABLE_KEYS].sort());
    // AND THE PAIR SET IS NOT EMPTY, so the two assertions above are not three
    // ways of saying the old two-way split. ADR-106.
    expect(pair.length).toBeGreaterThan(0);
  });

  test('the unscoped writers carry no predicate, because there is no identity to carry', async () => {
    for (const key of FIRM_KEYS) {
      const sent = await sentBy((source, conn) =>
        firmTx(source, conn).update(key, { [someOtherColumn(key)]: null }),
      );
      expect(sent.sql, key).toMatch(/^update /);
      expect(sent.sql, key).not.toMatch(/\swhere\s/);
    }
    const sent = await sentBy((source, conn) =>
      systemTx(source, conn, 'nightly-batch').delete('accounts'),
    );
    expect(sent.sql).toMatch(/^delete from "accounts"/);
    expect(sent.sql).not.toMatch(/\swhere\s/);
  });
});

describe('the pool the transaction needs is reachable and is a pool', () => {
  // `client()`'s DECLARED return type erases Drizzle's `$client`, and `client.ts`
  // is outside this session's fence, so `transaction()` recovers the pool with a
  // runtime check instead of a cast. This is that check, watched succeeding, so
  // a Drizzle upgrade that moved the property fails here rather than at the
  // first transaction in production.
  test('`client()` exposes a pg Pool, without opening a socket', async () => {
    process.env['DATABASE_URL'] = 'postgres://unused@127.0.0.1:1/unused';
    const { client, closeClient } = await import('../src/client.ts');
    const handle = client() as unknown as { $client?: { connect?: unknown; totalCount?: unknown } };
    expect(typeof handle.$client?.connect).toBe('function');
    expect(typeof handle.$client?.totalCount).toBe('number');
    await closeClient();
  });
});
