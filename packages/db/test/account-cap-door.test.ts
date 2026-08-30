// =============================================================================
// packages/db/test/account-cap-door.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-265. ADR-238 ruling 1 ruled the base account cap
// the FIRM'S number, ADR-252 built its row (`0074_firm_parameters.sql`) and
// wired no reader, and the two entries waiting on it both said the same thing
// about it in different words: the number NOW HAS A COLUMN AND STILL HAS NO
// DOOR. This file is the door's assertions.
//
// -----------------------------------------------------------------------------
// THE PROPERTY, EXACTLY
// -----------------------------------------------------------------------------
// "A caller receives ONE resolved number or nothing at all." Two halves, and
// each is a trap the dispatching row named by name:
//
//   1. THE FOLD HAPPENS INSIDE THE DOOR. `identities.max_accounts_override` is
//      the per-entity EXCEPTION and `firm_parameters.base_account_cap` is the
//      BASE. A door that returned the base and let the caller remember the
//      override would be a control forgotten exactly once. There is no shape on
//      the return to put a second number in: it is a `number`.
//   2. AN ABSENT BASE ROW IS A REFUSAL AND NOT AN UNLIMITED CAP. The door
//      THROWS, and it throws BEFORE it reads the identity, so no override can
//      answer in a deployment whose firm number nobody approved. A `number` that
//      is never `null` and never `Infinity` is a value `?? Infinity` cannot be
//      written against.
//
// -----------------------------------------------------------------------------
// AND THE ADMISSION THAT WAS NOT TAKEN
// -----------------------------------------------------------------------------
// ADR-252 section 10 sized the remainder of this work as a `CATALOG_TABLE_KEYS`
// admission, "one member plus ADR-233's argument". ADR-265 refuses it: a
// catalogue read hands the caller ROWS, and a caller holding rows does the
// effective dating and the override fold itself, which is trap 1 arriving by
// construction. So the list is still five members and this suite asserts it,
// from the same file the entry it narrows reads.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES AGAINST POSTGRES, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block. Every assertion below reads the SQL the accessor BUILDS, through a
// driverless Drizzle handle (`drizzle-orm/pg-proxy`) that records `(sql,
// params)` and answers rows this file composes. That is `counterparty-door.
// test.ts`'s own construction and its own stated limit: what is proved here is
// the statement and the resolution, never that PostgreSQL agrees.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { describe, expect, test } from 'vitest';

import {
  CATALOG_TABLE_KEYS,
  SCOPE_RULES,
  TABLES,
  type IdentityId,
  type TableKey,
} from '../src/index.ts';
import { effectiveAccountCapStatement, type StatementSource } from '../src/scoped-db.ts';

const BUYER = 'i-buyer' as IdentityId;
const STRANGER = 'i-stranger';

const SCOPED_DB_SRC = readFileSync(
  fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
  'utf8',
);

interface Sent {
  readonly sql: string;
  readonly params: unknown[];
}

/** The property names of one table, in the order a `SELECT *` returns them. */
function propertiesOf(key: TableKey): string[] {
  return Object.keys(getTableColumns(TABLES[key] as PgTable));
}

/** The Drizzle property name for a SQL column name on one table. */
function propertyFor(key: TableKey, sqlName: string): string {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const [property, column] of Object.entries(columns)) {
    if (column.name === sqlName) return property;
  }
  throw new Error(`${key} declares no column named ${sqlName}`);
}

/**
 * One row of a table, as `drizzle-orm/pg-proxy` hands it back.
 *
 * Every column this file does not name is null, which is what makes a door that
 * read one of them visible.
 */
function rowOf(key: TableKey, values: Readonly<Record<string, unknown>>): unknown[] {
  const properties = propertiesOf(key);
  const row = new Array(properties.length).fill(null) as unknown[];
  for (const [sqlName, value] of Object.entries(values)) {
    row[properties.indexOf(propertyFor(key, sqlName))] = value;
  }
  return row;
}

/** A driverless handle answering a queue of row sets, one per STATEMENT. */
function answering(queue: readonly unknown[][][]): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const source: StatementSource = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: queue[sent.length - 1] ?? [] };
  });
  return { source, sent };
}

/** The firm row, at whatever number and date a case needs. */
const baseRow = (integerValue: unknown): unknown[][] => [
  rowOf('firmParameters', {
    parameter: 'base_account_cap',
    integer_value: integerValue,
    reason: 'launch',
    effective_from: new Date('2026-01-01T00:00:00Z'),
    approved_by: 'op-founder',
    created_at: new Date('2026-01-01T00:00:00Z'),
  }),
];

/** The caller's own identity row, with or without the exception on it. */
const identityRow = (override: unknown): unknown[][] => [
  rowOf('identities', { id: BUYER, max_accounts_override: override }),
];

const NO_ROWS: unknown[][] = [];

// -----------------------------------------------------------------------------
// 1. THE READ THE MIGRATION RULED
// -----------------------------------------------------------------------------
// `0074`'s index comment states the read every consumer will make: "the latest
// row for one parameter whose `effective_from` has arrived ... DESC because that
// read is `ORDER BY effective_from DESC LIMIT 1`". A door that read it any other
// way would leave `firm_parameters_current_idx` unused and would answer from a
// row the firm has not reached yet.

describe('the base read is the one 0074 ruled', () => {
  test('it names the parameter, refuses the unarrived row, orders DESC and takes one', async () => {
    const { source, sent } = answering([baseRow(10), identityRow(null)]);
    await effectiveAccountCapStatement(source, BUYER);

    const base = sent[0] as Sent;
    expect(base.sql).toContain('"firm_parameters"');
    expect(base.params).toContain('base_account_cap');
    expect(base.sql).toContain('"effective_from" <= now()');
    expect(base.sql).toContain('order by "firm_parameters"."effective_from" desc');
    expect(base.sql).toContain('limit');
  });

  test('the base is read FIRST and the identity SECOND, which is the refusal being unconditional', async () => {
    const { source, sent } = answering([baseRow(10), identityRow(3)]);
    await effectiveAccountCapStatement(source, BUYER);

    expect(sent).toHaveLength(2);
    expect((sent[0] as Sent).sql).toContain('"firm_parameters"');
    expect((sent[1] as Sent).sql).toContain('"identities"');
  });

  test('two statements and no join, so neither table is read through the other', async () => {
    const { source, sent } = answering([baseRow(10), identityRow(null)]);
    await effectiveAccountCapStatement(source, BUYER);

    for (const statement of sent) {
      expect(statement.sql).not.toContain('join');
    }
  });

  test('the identity read carries the handle-s identity and names no other', async () => {
    const { source, sent } = answering([baseRow(10), identityRow(null)]);
    await effectiveAccountCapStatement(source, BUYER);

    const identity = sent[1] as Sent;
    expect(identity.params).toContain(BUYER);
    expect(identity.params).not.toContain(STRANGER);
  });
});

// -----------------------------------------------------------------------------
// 2. THE SECOND TRAP: AN ABSENT ROW IS A REFUSAL
// -----------------------------------------------------------------------------

describe('an absent base row is a refusal and not an unlimited cap', () => {
  test('no effective row throws', async () => {
    const { source } = answering([NO_ROWS]);
    await expect(effectiveAccountCapStatement(source, BUYER)).rejects.toThrow(
      /no .*base_account_cap.* has taken effect/,
    );
  });

  test('the refusal names the reading, so the session that meets it does not invent one', async () => {
    const { source } = answering([NO_ROWS]);
    await expect(effectiveAccountCapStatement(source, BUYER)).rejects.toThrow(
      /NO CAP AND NOT AN UNLIMITED ONE/,
    );
  });

  test('THE IDENTITY IS NEVER READ, so an override cannot answer where no base was approved', async () => {
    // THE ORDER IS THE CONTROL. An exception carries no approver and no written
    // reason; the row that carries both is the one that is missing. A door that
    // read the identity first and fell back to the override would promote the
    // exception into the firm's number on exactly the deployment nobody
    // configured.
    const { source, sent } = answering([NO_ROWS, identityRow(99)]);
    await expect(effectiveAccountCapStatement(source, BUYER)).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// 3. THE FIRST TRAP: THE FOLD IS INSIDE THE DOOR
// -----------------------------------------------------------------------------

describe('the override is folded over the base inside the door', () => {
  test('no override gives the firm base', async () => {
    const { source } = answering([baseRow(10), identityRow(null)]);
    await expect(effectiveAccountCapStatement(source, BUYER)).resolves.toBe(10);
  });

  test('an override LARGER than the base wins', async () => {
    const { source } = answering([baseRow(10), identityRow(25)]);
    await expect(effectiveAccountCapStatement(source, BUYER)).resolves.toBe(25);
  });

  test('an override SMALLER than the base wins too, which is the direction a fold gets wrong', async () => {
    // `Math.max` and `Math.min` are both available shortcuts and both are wrong.
    // The column is an OVERRIDE rather than a bound in either direction: B4 #17's
    // grandfathered merge needs a larger one, and an identity under review needs
    // a smaller one, and a door that clamped would silently refuse the second.
    const { source } = answering([baseRow(10), identityRow(2)]);
    await expect(effectiveAccountCapStatement(source, BUYER)).resolves.toBe(2);
  });

  test('the caller receives a bare number, so there is nowhere to put a second one', async () => {
    const { source } = answering([baseRow(10), identityRow(4)]);
    const cap = await effectiveAccountCapStatement(source, BUYER);
    expect(typeof cap).toBe('number');
  });

  test('an identity naming no row throws rather than falling through to the base', async () => {
    // The handle is bound to an identity by `scopedDb`, so a handle whose row is
    // absent is a contradiction rather than an identity with no exception, and
    // folding it into "no override" would answer the firm's number to a caller
    // this transaction cannot place.
    const { source } = answering([baseRow(10), NO_ROWS]);
    await expect(effectiveAccountCapStatement(source, BUYER)).rejects.toThrow(/identities/);
  });
});

// -----------------------------------------------------------------------------
// 4. A CAP IS AN INTEGER, ON BOTH SIDES OF THE FOLD
// -----------------------------------------------------------------------------
// Both columns are `integer` with `CHECK (> 0)` at the database (`0074`'s
// `firm_parameters_base_account_cap_is_positive` and `0002:47`), so every case
// below asserts a value the database already refuses. That is the point: this
// door is read by `apps/api` and the driver is what stands between the two, and
// a cap that arrived as a float or a string would be compared against a count of
// live accounts with `>=`.

describe('a cap is a positive integer or it is a throw', () => {
  test.each([
    ['a float base', baseRow(10.5), identityRow(null)],
    ['an unparseable base', baseRow('ten'), identityRow(null)],
    ['a zero base', baseRow(0), identityRow(null)],
    ['a negative base', baseRow(-1), identityRow(null)],
    ['a float override', baseRow(10), identityRow(2.5)],
    ['an unparseable override', baseRow(10), identityRow('two')],
    ['a zero override', baseRow(10), identityRow(0)],
    ['a negative override', baseRow(10), identityRow(-3)],
  ])('%s throws', async (_name, base, identity) => {
    const { source } = answering([base, identity]);
    await expect(effectiveAccountCapStatement(source, BUYER)).rejects.toThrow(
      /is not a positive integer/,
    );
  });

  test('A NUMERIC STRING NEVER REACHES THE GUARD, AND THIS CASE IS WHERE THAT IS RECORDED', async () => {
    // WATCHED, AND IT WAS WRITTEN THE OTHER WAY ROUND FIRST. Two cases above
    // originally asserted that a STRING throws, and both went green-side-up:
    // Drizzle's own `integer` column mapper runs `parseInt` on a string before
    // any Merit code sees the value, so `'10'` arrives here as `10` and the
    // guard has nothing to refuse. THE CASE IS NOT DELETED AND THE GUARD IS NOT
    // LOOSENED. What is asserted is the behaviour that actually exists, so the
    // day that mapper stops coercing -- a driver change, a column type change --
    // this case turns red rather than a cap silently arriving as text on the
    // comparison `liveAccounts >= cap`. An UNPARSEABLE string is `NaN` and the
    // guard does catch that, which the row above asserts.
    const { source } = answering([baseRow('10'), identityRow(null)]);
    await expect(effectiveAccountCapStatement(source, BUYER)).resolves.toBe(10);
  });
});

// -----------------------------------------------------------------------------
// 5. THE ADMISSION THAT WAS NOT TAKEN
// -----------------------------------------------------------------------------

describe('the catalogue list did not move to build this door', () => {
  test('CATALOG_TABLE_KEYS is still the same five members', () => {
    expect(CATALOG_TABLE_KEYS).toEqual([
      'coupons',
      'geoRestrictions',
      'midHealth',
      'planVersions',
      'planVersionSizes',
    ]);
  });

  test('`firmParameters` is not one of them', () => {
    expect(CATALOG_TABLE_KEYS as readonly string[]).not.toContain('firmParameters');
  });

  test('the table is still registered `firm`, which is the class the door reads it as', () => {
    expect(SCOPE_RULES.firmParameters.class).toBe('firm');
    expect(SCOPE_RULES.identities.class).toBe('root');
  });

  test('the door is on the SCOPED transaction, because INV-M3-15 binds the cap to it', () => {
    // `accountCap()` and the restriction check are one call of `gateIdentity`, so
    // a cap read before the transaction opens is a cap that may have been
    // superseded by the time the purchase commits. That is why this is a method
    // of `ScopedTx` rather than a read on `ApiDb.firm`.
    expect(SCOPED_DB_SRC).toContain('effectiveAccountCap(): Promise<number>;');
  });
});
