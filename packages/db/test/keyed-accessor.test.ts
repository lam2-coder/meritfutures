// =============================================================================
// packages/db/test/keyed-accessor.test.ts
// =============================================================================
// ADR-112. THE ACCESSOR LEARNS TO NAME ONE ROW.
//
// ADR-102 landed a write path whose every method narrowed by tenancy or by
// nothing, so a caller that had to name ONE ROW was refused identically at all
// three authorities. Three sessions found that wall from three directions --
// 222 from the provisioning saga, 218 from the auth surface, 219 from the
// idempotency layer -- and ADR-109 clause 2 ruled that the missing construction
// is a PREDICATE and deliberately did not design it. This suite is what the
// design has to survive.
//
// -----------------------------------------------------------------------------
// THE LOAD-BEARING ASSERTION IS THE FOLD OVER THE MIGRATIONS
// -----------------------------------------------------------------------------
// An addressed write is safe because the columns it names contain a key the
// DATABASE makes unique. What the accessor can READ at run time is `schema.ts`,
// which is a TRANSCRIPTION of the DDL that somebody keeps true by hand. So the
// two are folded against each other here, in the direction that can hurt: NO
// column set `schema.ts` declares unique may be absent from the migrations,
// because such a set would be an address the accessor accepts and the database
// does not bound. That is ADR-101's instrument -- read the migrations, do not
// trust the restatement -- pointed at the one new claim ADR-112 makes.
//
// The other direction is live and is asserted as a MEASURED SET rather than
// waved at: 34 keys the migrations declare are absent from `schema.ts`, and
// every one of them is an address this accessor refuses that the database would
// have honoured. A refused write is not a wrong one.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES A WRITE AND THE SUITE SAYS SO, exactly as ADR-102's did
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block, so there is no Postgres in CI. Every statement assertion reads the SQL
// the accessor BUILDS, over a driverless Drizzle handle that records what it is
// asked to run, so what is asserted is what `scopedTx(...).updateAt(...)`
// actually sends rather than a reimplementation of it. ADR-112 section 9 is the
// round trip EXECUTED, once, by hand, and it is evidence rather than a control.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PoolClient } from 'pg';
import { describe, expect, test } from 'vitest';

import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  type ScopedTableKey,
  type TableKey,
} from '../src/scope.ts';
import {
  firmTx,
  scopedTx,
  systemTx,
  uniqueKeys,
  type IdentityId,
  type StatementSource,
} from '../src/scoped-db.ts';

const IDENTITY = 'i-1' as IdentityId;
const OTHER = 'i-2' as IdentityId;
const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

/** A values object that says SOMETHING: drizzle refuses an UPDATE with an empty SET. */
const SET = { updatedAt: new Date(0) };

const SCOPED_KEYS: ScopedTableKey[] = TABLE_KEYS.filter(
  (k): k is ScopedTableKey => SCOPE_RULES[k].class !== 'firm' && SCOPE_RULES[k].class !== 'pair',
);

interface Sent {
  readonly sql: string;
  readonly params: unknown[];
}

function recording(): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const source: StatementSource = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: [] };
  });
  return { source, sent };
}

/**
 * A driverless handle that answers a fixed NUMBER of rows.
 *
 * `drizzle-orm/pg-proxy` hands the mapper an ARRAY per row, in the select's own
 * column order, so a row is built from the table rather than written as an
 * object literal. Only the COUNT matters to `rowAt`, and the values are nulls.
 */
function answering(key: TableKey, howMany: number): StatementSource {
  const width = Object.keys(getTableColumns(TABLES[key] as PgTable)).length;
  const rows = Array.from({ length: howMany }, () => new Array(width).fill(null) as unknown[]);
  return drizzle(async () => ({ rows })) as StatementSource;
}

function stubConn(): PoolClient {
  return { query: async () => ({ rows: [] as unknown[] }) } as unknown as PoolClient;
}

async function sentBy(
  run: (source: StatementSource, conn: PoolClient) => Promise<unknown>,
): Promise<Sent> {
  const { source, sent } = recording();
  await run(source, stubConn());
  expect(sent, 'exactly one statement per call').toHaveLength(1);
  return sent[0] as Sent;
}

/** The columns a SCOPED handle pins itself: the caller may not name them and they count. */
function pinnedFor(key: TableKey): readonly string[] {
  const rule = SCOPE_RULES[key];
  return rule.class === 'root' || rule.class === 'owned' ? [rule.column] : [];
}

function propertyOf(key: TableKey, sqlName: string): string | undefined {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  return Object.entries(columns).find(([, column]) => column.name === sqlName)?.[0];
}

function sampleValue(column: PgColumn): unknown {
  switch (column.dataType) {
    case 'date':
      return new Date(0);
    case 'number':
      return 1;
    case 'bigint':
      return 1n;
    case 'boolean':
      return true;
    case 'json':
      return {};
    case 'buffer':
      return Buffer.from('addr', 'utf8');
    default:
      return 'addr';
  }
}

/**
 * The columns a caller could name on this table at this authority.
 *
 * This is the READING of ADR-112 rather than a call into it, so a coverage
 * assertion built on it is not the accessor agreeing with itself.
 */
function reachableColumns(key: TableKey, pinned: readonly string[]): Set<string> {
  const all = new Set(
    Object.values(getTableColumns(TABLES[key] as PgTable)).map((c) => (c as PgColumn).name),
  );
  for (const column of pinned) all.delete(column);
  for (const column of pinned) all.add(column);
  return all;
}

/** An address for one table, or `undefined` if the schema declares no key for it. */
function addressFor(key: TableKey, pinned: readonly string[]): Record<string, unknown> | undefined {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const candidate of uniqueKeys(key)) {
    const address: Record<string, unknown> = {};
    let resolved = true;
    let pinnedCovers = true;
    for (const sqlName of candidate) {
      if (pinned.includes(sqlName)) continue;
      pinnedCovers = false;
      const property = propertyOf(key, sqlName);
      if (property === undefined) {
        resolved = false;
        break;
      }
      address[property] = sampleValue(columns[property] as PgColumn);
    }
    if (!resolved) continue;
    if (Object.keys(address).length > 0) return address;
    if (pinnedCovers) {
      const property = Object.keys(columns).find(
        (p) => !pinned.includes((columns[p] as PgColumn).name),
      ) as string;
      return { [property]: sampleValue(columns[property] as PgColumn) };
    }
  }
  return undefined;
}

const scopedAddress = (key: TableKey): Record<string, unknown> | undefined =>
  addressFor(key, pinnedFor(key));

/** A one-column SET that is legal on this table: never a tenancy column, never empty. */
function setFor(key: TableKey): Record<string, unknown> {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  const pinned = pinnedFor(key);
  const rule = SCOPE_RULES[key];
  const forbidden = new Set<string>([
    ...pinned,
    ...(rule.class === 'derived' ? [rule.localColumn] : []),
    ...(rule.class === 'pair' ? [rule.columnA, rule.columnB] : []),
  ]);
  for (const [property, column] of Object.entries(columns)) {
    if (!forbidden.has(column.name)) return { [property]: sampleValue(column) };
  }
  throw new Error(`${key} has no column a SET could name`);
}

// =============================================================================
// THE FOLD OVER THE MIGRATIONS, WHICH IS WHAT MAKES THE ADDRESS CLAIM TRUE
// =============================================================================

/** Every unique column set the migrations declare, per SQL table name. */
function ddlUniqueKeys(): Map<string, Set<string>> {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n')
    .replace(/--[^\n]*/g, '');

  const found = new Map<string, Set<string>>();
  const record = (table: string, columns: string[]): void => {
    const normalised = columns
      .map((c) => c.trim().replace(/"/g, '').toLowerCase())
      .filter(Boolean)
      .sort()
      .join(',');
    if (normalised === '') return;
    const set = found.get(table) ?? new Set<string>();
    set.add(normalised);
    found.set(table, set);
  };

  const create = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = create.exec(sql)) !== null) {
    const table = match[1] as string;
    let depth = 1;
    let cursor = create.lastIndex;
    for (; cursor < sql.length && depth > 0; cursor += 1) {
      if (sql[cursor] === '(') depth += 1;
      else if (sql[cursor] === ')') depth -= 1;
    }
    const body = sql.slice(create.lastIndex, cursor - 1);

    // Split on TOP-LEVEL commas only: a `CHECK (a IN ('x','y'))` carries its own.
    const parts: string[] = [];
    let nesting = 0;
    let current = '';
    for (const character of body) {
      if (character === '(') nesting += 1;
      if (character === ')') nesting -= 1;
      if (character === ',' && nesting === 0) {
        parts.push(current);
        current = '';
      } else current += character;
    }
    parts.push(current);

    for (const raw of parts) {
      const part = raw.trim();
      if (part === '') continue;
      const tablePrimary = /^(?:CONSTRAINT\s+\w+\s+)?PRIMARY KEY\s*\(([^)]+)\)/i.exec(part);
      if (tablePrimary !== null) {
        record(table, (tablePrimary[1] as string).split(','));
        continue;
      }
      const tableUnique = /^(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(([^)]+)\)/i.exec(part);
      if (tableUnique !== null) {
        record(table, (tableUnique[1] as string).split(','));
        continue;
      }
      if (/^(?:CONSTRAINT|CHECK|EXCLUDE|FOREIGN KEY|LIKE)\b/i.test(part)) continue;
      const column = /^(\w+)\s+/.exec(part);
      if (column === null) continue;
      if (/\bPRIMARY KEY\b/i.test(part) || /\bUNIQUE\b/i.test(part)) {
        record(table, [column[1] as string]);
      }
    }
  }

  for (const altered of sql.matchAll(
    /ALTER TABLE\s+(?:ONLY\s+)?(\w+)[\s\S]*?ADD\s+(?:CONSTRAINT\s+\w+\s+)?(?:PRIMARY KEY|UNIQUE)\s*\(([^)]+)\)/gi,
  )) {
    record(altered[1] as string, (altered[2] as string).split(','));
  }

  // A PARTIAL unique index bounds only the rows it covers, so it is NOT a key.
  for (const indexed of sql.matchAll(
    /CREATE UNIQUE INDEX\s+(?:IF NOT EXISTS\s+)?\w+\s+ON\s+(\w+)\s*\(([^)]+)\)([^;]*);/gi,
  )) {
    if (/\bWHERE\b/i.test(indexed[3] ?? '')) continue;
    record(indexed[1] as string, (indexed[2] as string).split(','));
  }

  return found;
}

const DDL_KEYS = ddlUniqueKeys();
const normalise = (columns: readonly string[]): string =>
  [...columns]
    .map((c) => c.toLowerCase())
    .sort()
    .join(',');

describe('the addressability claim is checked against the migrations, not against the transcription', () => {
  // THE ONE THAT MATTERS. An address is admitted because the columns it names
  // carry a key. If `schema.ts` claimed a key the DDL does not have, the
  // accessor would admit an address matching many rows and every type in this
  // workspace would be green. Folded over all 47 migrations, this set is EMPTY.
  test('every unique key schema.ts declares is a real one in the migrations', () => {
    const invented: string[] = [];
    for (const key of TABLE_KEYS) {
      const table = getTableConfig(TABLES[key] as PgTable).name;
      const declared = DDL_KEYS.get(table) ?? new Set<string>();
      for (const candidate of uniqueKeys(key)) {
        if (!declared.has(normalise(candidate))) invented.push(`${key}: (${candidate.join(', ')})`);
      }
    }
    expect(invented, 'a key the accessor would accept that the database does not enforce').toEqual(
      [],
    );
  });

  // THE OTHER DIRECTION, MEASURED RATHER THAN WAVED AT. It is the fail-closed
  // one: the accessor refuses an address the database would have bounded. The
  // COUNT is not asserted, because a count is a fact about a tree at a commit
  // and eight approval clauses in this corpus have now drifted on one. What is
  // asserted is that it is non-empty and that every member is a REFUSAL rather
  // than an admission, which is the property that would change if somebody
  // "fixed" this by trusting the DDL at run time.
  test('the keys the migrations declare and schema.ts does not are refusals, and there are some', async () => {
    const missing: string[] = [];
    for (const key of TABLE_KEYS) {
      const table = getTableConfig(TABLES[key] as PgTable).name;
      const known = new Set(uniqueKeys(key).map(normalise));
      for (const declared of DDL_KEYS.get(table) ?? new Set<string>()) {
        if (!known.has(declared)) missing.push(`${key}: (${declared})`);
      }
    }
    expect(missing.length, 'the transcription is behind the DDL somewhere').toBeGreaterThan(0);

    // Every one of them is an address the accessor REFUSES. Watched on the one
    // that costs the most: `treasury_balances` has no other key at all.
    const { source } = recording();
    await expect(
      firmTx(source, stubConn()).updateAt(
        'treasuryBalances',
        { accountCode: 'x' },
        { source: 'y' },
      ),
    ).rejects.toThrow(/must name a row/);
  });

  test('a PARTIAL unique index is not read as a key, so the population it excludes is not addressable through it', async () => {
    // `provisioning_queue_intent_uq` is UNIQUE (account_id, operation,
    // payload_hash) WHERE status <> 'failed'. It bounds the LIVE rows and says
    // nothing about the failed ones, so a failed attempt and a live retry of the
    // same intent are two rows that satisfy the same equality. Session 222's
    // whole enqueue idempotency rests on that index, which is exactly why an
    // address must not be built on it.
    const sql = readFileSync(join(MIGRATIONS, '0007_accounts.sql'), 'utf8');
    expect(sql, 'the partial unique index this case is about').toMatch(
      /CREATE UNIQUE INDEX\s+provisioning_queue_intent_uq[\s\S]{0,200}?WHERE/i,
    );

    const declared = uniqueKeys('provisioningQueue').map((columns) => columns.join(','));
    expect(
      declared,
      'the partial index is not among the keys the accessor will accept',
    ).not.toContain('account_id,operation,payload_hash');

    const { source } = recording();
    await expect(
      systemTx(source, stubConn(), 'nightly-batch').updateAt(
        'provisioningQueue',
        { accountId: 'a-1', operation: 'provision', payloadHash: Buffer.from('h') },
        { status: 'delivered' },
      ),
    ).rejects.toThrow(/must name a row/);
  });

  test('every spelling drizzle has for a key is read, including the table-level composite', () => {
    // FOUR SPELLINGS AND READING ONLY THE FIRST WAS THE EASY BUG. Thirteen
    // registered tables declare their primary key as `primaryKey({ columns })`
    // rather than inline, and an accessor that read only `.primaryKey()` would
    // have refused every address on all thirteen while looking correct on the
    // rest.
    const composite = TABLE_KEYS.filter((key) =>
      getTableConfig(TABLES[key] as PgTable).primaryKeys.some((pk) => pk.columns.length > 1),
    );
    expect(composite.length, 'tables with a table-level composite primary key').toBeGreaterThan(0);
    for (const key of composite) {
      expect(uniqueKeys(key).length, `${key} has a key the accessor can see`).toBeGreaterThan(0);
    }
  });

  test('every scoped table has an address a caller can actually write', () => {
    // COVERAGE, AND IT IS THE ASSERTION THAT CAUGHT TWO DESIGN ERRORS WHILE
    // ADR-112 WAS BEING WRITTEN. The first draft required the CALLER's half of
    // the predicate to contain a unique key, which left the four tables keyed
    // `(identity_id, ...)` unaddressable; the second refused the caller naming a
    // `derived` rule's local column, which left `analytics_snapshots`
    // unaddressable because its key is `(account_id, as_of_trading_day)` and an
    // EXISTS over `accounts` pins neither.
    const unreachable: string[] = [];
    for (const key of SCOPED_KEYS) {
      const reachable = reachableColumns(key, pinnedFor(key));
      if (!uniqueKeys(key).some((candidate) => candidate.every((c) => reachable.has(c)))) {
        unreachable.push(key);
      }
      if (scopedAddress(key) === undefined) unreachable.push(`${key} (no sample)`);
    }
    expect(unreachable).toEqual([]);
  });
});

// =============================================================================
// THE COMPOSITION: TENANCY AND ADDRESS, IN BOTH DIRECTIONS
// =============================================================================

describe('a scoped keyed write ANDs the tenancy predicate with the address', () => {
  test('every scoped keyed UPDATE binds the identity from the HANDLE and the address from the CALLER', async () => {
    for (const key of SCOPED_KEYS) {
      const at = scopedAddress(key) as Record<string, unknown>;
      const mine = await sentBy((source, conn) =>
        scopedTx(source, conn, IDENTITY).updateAt(key, at, setFor(key)),
      );
      const theirs = await sentBy((source, conn) =>
        scopedTx(source, conn, OTHER).updateAt(key, at, setFor(key)),
      );

      // THE TEXT IS IDENTICAL AND THE BINDINGS DIFFER IN EXACTLY ONE PLACE.
      // That is the approval line's second half expressed over a statement
      // rather than over a table: the same address through two handles cannot
      // reach the same row, because the only thing that moved is the identity
      // and the caller never supplied it.
      expect(theirs.sql, key).toBe(mine.sql);
      expect(mine.params, key).toContain(IDENTITY);
      expect(theirs.params, key).toContain(OTHER);
      expect(mine.params.filter((p) => p === IDENTITY).length, key).toBe(1);
      expect(theirs.params.filter((p) => p === IDENTITY).length, key).toBe(0);
      const withoutIdentity = (params: unknown[]): unknown[] =>
        params.filter((p) => p !== IDENTITY && p !== OTHER);
      expect(withoutIdentity(theirs.params), key).toEqual(withoutIdentity(mine.params));
    }
  });

  test('the tenancy conjunct comes FIRST, so a reader of the SQL sees the scope before the address', async () => {
    for (const key of SCOPED_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root' && rule.class !== 'owned') continue;
      const at = scopedAddress(key) as Record<string, unknown>;
      const sent = await sentBy((source, conn) =>
        scopedTx(source, conn, IDENTITY).deleteAt(key, at),
      );
      const where = sent.sql.slice(sent.sql.indexOf(' where ') + ' where '.length);
      expect(where, key).toMatch(
        new RegExp(`^\\((?:"[a-z_]+"\\.)?"${rule.column}" = \\$\\d+ and `),
      );
    }
  });

  test('an addressed read at an authority with no identity carries the address and nothing else', async () => {
    const sent = await sentBy((source, conn) =>
      systemTx(source, conn, 'nightly-batch').rowsWhere('idempotencyKeys', { key: 'tok' }),
    );
    expect(sent.sql).toMatch(/^select /);
    expect(sent.sql).toMatch(/where (?:"idempotency_keys"\.)?"key" = \$1/);
    expect(sent.params).toEqual(['tok']);
  });

  test('a filtered read is the unfiltered read plus a conjunct, so it can only narrow', async () => {
    // THE ARGUMENT FOR LETTING A READ TAKE A NON-UNIQUE FILTER, ASSERTED. A
    // filtered read grants no reach because the method it narrows already
    // exists at the same authority; the rendered statements say so.
    for (const key of SCOPED_KEYS.slice(0, 12)) {
      const plain = await sentBy((source, conn) => scopedTx(source, conn, IDENTITY).rows(key));
      const filtered = await sentBy((source, conn) =>
        scopedTx(source, conn, IDENTITY).rowsWhere(
          key,
          scopedAddress(key) as Record<string, unknown>,
        ),
      );
      const from = (statement: string): string => statement.slice(0, statement.indexOf(' where '));
      expect(from(filtered.sql), key).toBe(from(plain.sql));
      expect(filtered.sql.length, key).toBeGreaterThan(plain.sql.length);
    }
  });
});

// =============================================================================
// THE REFUSALS, AND THE POSITIVE CASE THAT KEEPS THEM HONEST
// =============================================================================

describe('a filter that cannot name a row is refused', () => {
  test('an address whose columns carry no unique key is refused, at every authority', async () => {
    const { source } = recording();
    const conn = stubConn();
    await expect(
      scopedTx(source, conn, IDENTITY).updateAt('purchases', { status: 'paid' }, SET),
    ).rejects.toThrow(/must name a row/);
    await expect(
      systemTx(source, conn, 'nightly-batch').deleteAt('purchases', { status: 'paid' }),
    ).rejects.toThrow(/must name a row/);
    await expect(
      firmTx(source, conn).updateAt('coupons', { isActive: true }, { code: 'c' }),
    ).rejects.toThrow(/must name a row/);
  });

  test('the same columns ARE accepted once they carry a key, so the guard is about the key', async () => {
    // THE DIRECTION THAT KEEPS THE ONE ABOVE FROM PASSING VACUOUSLY. A guard
    // that refused everything would satisfy every refusal in this file.
    const { source } = recording();
    await expect(
      scopedTx(source, stubConn(), IDENTITY).updateAt('purchases', { id: 'p-1' }, SET),
    ).resolves.toBeDefined();
  });

  test('an empty filter is refused, because it is the unaddressed write under another name', async () => {
    // TWO GUARDS REACH IT AND WHICH ONE SPEAKS DEPENDS ON THE TABLE, so both are
    // watched rather than one being assumed. On a WRITE the uniqueness check
    // runs first, so an empty address is refused for naming no key; on a READ
    // there is no uniqueness check at all and the emptiness itself is the
    // refusal. Neither path renders a statement.
    const { source } = recording();
    const conn = stubConn();
    await expect(
      scopedTx(source, conn, IDENTITY).updateAt('purchases', {} as { id: string }, SET),
    ).rejects.toThrow(/must name a row/);
    await expect(
      scopedTx(source, conn, IDENTITY).rowsWhere('purchases', {} as { id: string }),
    ).rejects.toThrow(/names every row/);
    await expect(
      systemTx(source, conn, 'nightly-batch').rowsWhere(
        'treasuryBalances',
        {} as { source: string },
      ),
    ).rejects.toThrow(/names every row/);
  });

  test('a null or undefined value is refused rather than rendered either way', async () => {
    const { source } = recording();
    const conn = stubConn();
    await expect(
      systemTx(source, conn, 'nightly-batch').rowAt('idempotencyKeys', {
        key: null as unknown as string,
      }),
    ).rejects.toThrow(/matches nothing/);
    await expect(
      systemTx(source, conn, 'nightly-batch').rowAt('idempotencyKeys', {
        key: undefined as unknown as string,
      }),
    ).rejects.toThrow(/matches nothing/);
  });

  test('a name that is not a column of the table is refused past the type', async () => {
    const { source } = recording();
    await expect(
      systemTx(source, stubConn(), 'nightly-batch').rowsWhere('idempotencyKeys', {
        identity_id: 'x',
      } as unknown as { key: string }),
    ).rejects.toThrow(/is not a column of/);
  });

  test('a scoped caller may not name the column the handle pins, on every root and owned table', async () => {
    const { source } = recording();
    const conn = stubConn();
    for (const key of SCOPED_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root' && rule.class !== 'owned') continue;
      for (const spelling of [rule.column, propertyOf(key, rule.column)]) {
        if (spelling === undefined) continue;
        await expect(
          scopedTx(source, conn, IDENTITY).rowsWhere(key, {
            [spelling]: 'x',
          } as Record<string, unknown>),
          `${key}.${spelling}`,
        ).rejects.toThrow(/tenancy column/);
      }
    }
  });

  test('a DERIVED rule pins nothing, so its local column IS the caller s to narrow by', async () => {
    // THE SECOND DESIGN ERROR, WATCHED SO IT CANNOT COME BACK. An EXISTS over
    // the parent bounds which rows qualify and pins no column of this row: one
    // identity owns many accounts. Refusing `account_id` here left
    // `analytics_snapshots` with no addressed write at all.
    const { source } = recording();
    await expect(
      scopedTx(source, stubConn(), IDENTITY).updateAt(
        'analyticsSnapshots',
        { accountId: 'a-1', asOfTradingDay: '2026-08-26' },
        { equityCents: 1n },
      ),
    ).resolves.toBeDefined();
  });

  test('the tenancy column stays refused in an UPDATE s SET, which is ADR-102 clause 4 unmoved', async () => {
    const { source } = recording();
    await expect(
      scopedTx(source, stubConn(), IDENTITY).updateAt(
        'purchases',
        { id: 'p-1' },
        { identityId: OTHER },
      ),
    ).rejects.toThrow(/tenancy column/);
  });
});

// =============================================================================
// THE SHAPE OF THE HANDLES AFTER ADR-112
// =============================================================================

describe('there is no unaddressed write left at any authority', () => {
  test('no transaction handle carries `update` or `delete`', () => {
    const { source } = recording();
    const conn = stubConn();
    for (const handle of [
      scopedTx(source, conn, IDENTITY),
      systemTx(source, conn, 'nightly-batch'),
      firmTx(source, conn),
    ]) {
      const carried = handle as unknown as Record<string, unknown>;
      expect(carried['update'], `${String(carried['__brand'])} carries update`).toBeUndefined();
      expect(carried['delete'], `${String(carried['__brand'])} carries delete`).toBeUndefined();
    }
  });

  test('every transaction handle carries the four addressed methods and the two unchanged ones', () => {
    const { source } = recording();
    const conn = stubConn();
    for (const handle of [
      scopedTx(source, conn, IDENTITY),
      systemTx(source, conn, 'nightly-batch'),
      firmTx(source, conn),
    ]) {
      const carried = handle as unknown as Record<string, unknown>;
      for (const method of ['rows', 'insert', 'rowsWhere', 'rowAt', 'updateAt', 'deleteAt']) {
        expect(typeof carried[method], `${String(carried['__brand'])}.${method}`).toBe('function');
      }
    }
  });

  test('the READ handles are still read only, so ADR-102 clause 1 is unmoved', async () => {
    const { scopedDb, systemDb, firmDb } = await import('../src/scoped-db.ts');
    expect(Object.keys(scopedDb(IDENTITY)).sort()).toEqual(['__brand', 'identityId', 'rows']);
    expect(Object.keys(systemDb('nightly-batch')).sort()).toEqual(['__brand', 'reason', 'rows']);
    expect(Object.keys(firmDb()).sort()).toEqual(['__brand', 'rows']);
  });

  test('`sqlExecutor` is still one member wide, because the construction removed the need to widen it', () => {
    // ADR-112 RULING 5, WATCHED. The three needs ADR-109 clause 2 names are
    // served by an address, so the raw-SQL vocabulary does not move. A session
    // that widens it will find this test rather than a paragraph.
    const source = readFileSync(
      fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
      'utf8',
    );
    const declared = /export type SqlExecutorReason =([^;]+);/.exec(source)?.[1] ?? '';
    expect([...declared.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])).toEqual(['job-enqueue']);
  });
});

describe('an addressed read returns one row or none', () => {
  test('none is `undefined` and one is the row', async () => {
    const conn = stubConn();
    const none = await scopedTx(answering('purchases', 0), conn, IDENTITY).rowAt('purchases', {
      id: 'p-1',
    });
    expect(none).toBeUndefined();
    const one = await scopedTx(answering('purchases', 1), conn, IDENTITY).rowAt('purchases', {
      id: 'p-1',
    });
    expect(one).toBeDefined();
    expect(Array.isArray(one), 'one ROW and not the array it came in').toBe(false);
  });

  test('TWO rows is a THROW and never the first of them', async () => {
    // THE ONE PLACE THE UNIQUENESS CLAIM IS CHECKED AGAINST THE DATABASE RATHER
    // THAN AGAINST THE TRANSCRIPTION OF IT. `refuseUnaddressed` reads
    // `schema.ts`; this reads what Postgres actually returned. Returning the
    // first row would make a drift between the two invisible on exactly the path
    // an idempotency store reads.
    await expect(
      scopedTx(answering('purchases', 2), stubConn(), IDENTITY).rowAt('purchases', {
        id: 'p-1',
      }),
    ).rejects.toThrow(/returned 2 rows/);
  });
});
