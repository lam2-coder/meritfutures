// =============================================================================
// packages/db/test/catalog-read.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-233, AND IT IS A NEW FILE ON `pair-write-door.ts`'s
// PRECEDENT: one ruling, one suite, so a later session reading the ruling has
// one place to check it and neither file has to be understood to read the other.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES A READ
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with NO services
// block, so there is no Postgres in CI to read from. Every assertion below reads
// the SQL the accessor BUILDS, through a driverless Drizzle handle
// (`drizzle-orm/pg-proxy`) that records `(sql, params)`. What is asserted is the
// statement text, its binds, and the refusals.
//
// -----------------------------------------------------------------------------
// WHAT THE NARROWNESS CLAIM IS, EXACTLY
// -----------------------------------------------------------------------------
// "A scoped transaction can read FIVE `firm` tables and no sixth." That is the
// claim ADR-233 rests on, and it is proved from four directions rather than one,
// because a single assertion of it would be an assertion about a value and the
// property is about a SHAPE:
//
//   1. THE LIST IS A STRICT SUBSET OF THE CLASS. Every member is `firm` read
//      back out of `SCOPE_RULES`, and the class is measurably bigger, with three
//      named exclusions that are the ones a reader would worry about.
//   2. THE REFUSAL REACHES EVERY OTHER KEY. All three verbs are driven with
//      every `TableKey` outside the list, cast past the type the way a caster
//      would, and each one throws BEFORE a statement is built.
//   3. THERE IS NO WRITE VERB. The handle carries three `catalog` methods and
//      the set is asserted, so a fourth cannot arrive unremarked.
//   4. NO TENANCY WAS READ AROUND. `scopePredicate` still throws on every
//      catalogue key and the statements carry no identity bind, so this door
//      created no filtered read that a wrong classification could widen.
//
// THE THIRD DIRECTION IS THE ONE WORTH SAYING TWICE. `refuseUncatalogued` exists
// because the compile-time half is castable, which is `sqlExecutorOn`'s own
// stated reason for reading a reason the type already closed.
// =============================================================================

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PoolClient } from 'pg';
import { describe, expect, test } from 'vitest';

import {
  CATALOG_TABLE_KEYS,
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  scopePredicate,
  type CatalogTableKey,
  type IdentityId,
  type TableKey,
} from '../src/index.ts';
import { scopedTx, uniqueKeys, type StatementSource } from '../src/scoped-db.ts';

const IDENTITY = 'i-buyer' as IdentityId;
const OTHER = 'i-somebody-else' as IdentityId;

/** The `firm` class, RE-DERIVED FROM THE REGISTRY rather than imported. */
const FIRM_KEYS: readonly TableKey[] = TABLE_KEYS.filter((k) => SCOPE_RULES[k].class === 'firm');

const CATALOGUE = new Set<string>(CATALOG_TABLE_KEYS);

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

/** A `pg` connection. `scopedTx` needs one; nothing here uses it. */
function stubConn(): PoolClient {
  return { query: async () => ({ rows: [] as unknown[] }) } as unknown as PoolClient;
}

/**
 * An address that names one of the table's declared unique keys, or
 * `undefined` when it declares none this suite can build.
 *
 * BUILT FROM `uniqueKeys()` AND NOT LISTED, so the address a key is driven with
 * is the accessor's own answer rather than a second transcription of it.
 */
function addressFor(key: TableKey): Record<string, unknown> | undefined {
  const [columns] = uniqueKeys(key);
  if (columns === undefined) return undefined;
  const table = TABLES[key] as PgTable;
  const properties = Object.entries(
    getTableColumns(table) as Record<string, { name: string; dataType: string }>,
  );
  const at: Record<string, unknown> = {};
  for (const column of columns) {
    const found = properties.find(([, value]) => value.name === column);
    if (found === undefined) return undefined;
    // THE VALUE FOLLOWS THE COLUMN'S OWN TYPE, because Drizzle maps a bind
    // through the column's driver mapper and `mid_health` is addressed by
    // `(psp, window_start)`. A string in the timestamp half throws inside the
    // mapper, which would fail this case for a reason that is not this ruling's.
    at[found[0]] = sampleFor(found[1].dataType);
  }
  return at;
}

/** A bind Drizzle's mapper will accept for one column data type. */
function sampleFor(dataType: string): unknown {
  if (dataType === 'date') return new Date('2026-08-29T00:00:00.000Z');
  if (dataType === 'bigint') return 0n;
  if (dataType === 'number') return 0;
  if (dataType === 'boolean') return false;
  return 'x';
}

describe('the list is a strict subset of the `firm` class', () => {
  test('every member is registered `firm`, read back out of SCOPE_RULES', () => {
    for (const key of CATALOG_TABLE_KEYS) {
      expect(SCOPE_RULES[key].class, `${key} is admitted to the catalogue read`).toBe('firm');
    }
  });

  test('five members, sorted, with no duplicate', () => {
    expect(CATALOG_TABLE_KEYS).toHaveLength(5);
    expect(new Set(CATALOG_TABLE_KEYS).size).toBe(CATALOG_TABLE_KEYS.length);
    // ALPHABETICAL AND NOT CODE-UNIT ORDER, which is a distinction with a case
    // in it: `'planVersionSizes' < 'planVersions'` by `.sort()`, because `S` is
    // a smaller code unit than `s`, and that is not the order a reader means by
    // alphabetical. `localeCompare` puts the shorter name first, which is where
    // a reader looks for it.
    expect([...CATALOG_TABLE_KEYS]).toEqual(
      [...CATALOG_TABLE_KEYS].sort((left, right) => left.localeCompare(right)),
    );
  });

  test('the class is measurably bigger, so this is a slice and not the class', () => {
    // THE NUMBER IS DERIVED AND NOT WRITTEN DOWN. A literal here would go stale
    // the day a `firm` table is registered and would fail for the wrong reason;
    // what the ruling claims is the INEQUALITY.
    expect(FIRM_KEYS.length).toBeGreaterThan(CATALOG_TABLE_KEYS.length);
  });

  test('the three `firm` tables a reader would worry about are OUTSIDE it', () => {
    // EACH IS `firm` AND NONE IS CATALOGUE, and the reasons are different:
    // `otp_challenges` holds authentication material written before anybody is
    // anybody, and the other two are the firm's own position, which AS-M12-04
    // rules unpublishable. "The row belongs to nobody" is true of all three and
    // is not the argument a member owes.
    for (const key of ['otpChallenges', 'treasuryBalances', 'reserveCoverageSnapshots'] as const) {
      expect(SCOPE_RULES[key].class, `${key} is firm`).toBe('firm');
      expect(CATALOGUE.has(key), `${key} is not readable from a scoped transaction`).toBe(false);
    }
  });
});

describe('the refusal reaches every key outside the list', () => {
  const outside = TABLE_KEYS.filter((key) => !CATALOGUE.has(key));

  test('there are keys outside the list to test, and most of the estate is outside it', () => {
    expect(outside.length).toBeGreaterThan(CATALOG_TABLE_KEYS.length);
  });

  test('`catalogRows` throws on every one, and BUILDS NOTHING', async () => {
    for (const key of outside) {
      const { source, sent } = recording();
      const tx = scopedTx(source, stubConn(), IDENTITY);
      await expect(tx.catalogRows(key as CatalogTableKey), `catalogRows(${key})`).rejects.toThrow(
        /is not a table a scoped transaction may read/,
      );
      // THE STATEMENT IS THE ASSERTION AND NOT THE THROW. A guard that threw
      // after building the SELECT would still have reached the table.
      expect(sent, `catalogRows(${key}) built a statement`).toHaveLength(0);
    }
  });

  test('`catalogRowsWhere` throws on every one, and BUILDS NOTHING', async () => {
    for (const key of outside) {
      const { source, sent } = recording();
      const tx = scopedTx(source, stubConn(), IDENTITY);
      await expect(
        tx.catalogRowsWhere(key as CatalogTableKey, { id: 'x' } as never),
        `catalogRowsWhere(${key})`,
      ).rejects.toThrow(/is not a table a scoped transaction may read/);
      expect(sent, `catalogRowsWhere(${key}) built a statement`).toHaveLength(0);
    }
  });

  test('`catalogRowAt` throws on every one, and BUILDS NOTHING', async () => {
    for (const key of outside) {
      const { source, sent } = recording();
      const tx = scopedTx(source, stubConn(), IDENTITY);
      await expect(
        tx.catalogRowAt(key as CatalogTableKey, { id: 'x' } as never),
        `catalogRowAt(${key})`,
      ).rejects.toThrow(/is not a table a scoped transaction may read/);
      expect(sent, `catalogRowAt(${key}) built a statement`).toHaveLength(0);
    }
  });

  test('the refusal names the key AND the list, so the reader learns where to go', async () => {
    const { source } = recording();
    const tx = scopedTx(source, stubConn(), IDENTITY);
    await expect(tx.catalogRows('otpChallenges' as CatalogTableKey)).rejects.toThrow(
      /otpChallenges/,
    );
    await expect(tx.catalogRows('otpChallenges' as CatalogTableKey)).rejects.toThrow(
      /CATALOG_TABLE_KEYS is a CLOSED LIST/,
    );
    for (const key of CATALOG_TABLE_KEYS) {
      await expect(tx.catalogRows('otpChallenges' as CatalogTableKey)).rejects.toThrow(
        new RegExp(key),
      );
    }
  });

  test('a key that is not in the registry at all is refused by the same guard', async () => {
    const { source, sent } = recording();
    const tx = scopedTx(source, stubConn(), IDENTITY);
    await expect(tx.catalogRows('notATable' as CatalogTableKey)).rejects.toThrow(
      /is not a table a scoped transaction may read/,
    );
    expect(sent).toHaveLength(0);
  });
});

describe('the five members are served, on THIS transaction', () => {
  test('`catalogRows` builds one SELECT naming the table', async () => {
    for (const key of CATALOG_TABLE_KEYS) {
      const { source, sent } = recording();
      await scopedTx(source, stubConn(), IDENTITY).catalogRows(key);
      expect(sent, key).toHaveLength(1);
      expect(sent[0]?.sql, key).toContain(getTableName(TABLES[key] as PgTable));
      expect(sent[0]?.sql, key).toMatch(/^select /i);
    }
  });

  test('THE STATEMENT CARRIES NO TENANCY, and two identities render the same one', async () => {
    for (const key of CATALOG_TABLE_KEYS) {
      const mine = recording();
      const theirs = recording();
      await scopedTx(mine.source, stubConn(), IDENTITY).catalogRows(key);
      await scopedTx(theirs.source, stubConn(), OTHER).catalogRows(key);
      // A `firm` row is nobody's, so there is no tenancy to filter by and the
      // absence of a filter is the class being read correctly. If these two ever
      // differ, something is scoping a row that belongs to no identity.
      expect(mine.sent[0]?.sql, key).toBe(theirs.sent[0]?.sql);
      expect(mine.sent[0]?.params, key).toEqual(theirs.sent[0]?.params);
      expect(mine.sent[0]?.params, key).not.toContain(IDENTITY);
      expect(mine.sent[0]?.sql, key).not.toMatch(/where/i);
    }
  });

  test('`catalogRowsWhere` renders the filter and still binds no identity', async () => {
    const { source, sent } = recording();
    await scopedTx(source, stubConn(), IDENTITY).catalogRowsWhere('midHealth', { psp: 'psp_a' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params).toEqual(['psp_a']);
    expect(sent[0]?.params).not.toContain(IDENTITY);
  });

  test('`catalogRowAt` addresses each member by a key the schema declares', async () => {
    for (const key of CATALOG_TABLE_KEYS) {
      const at = addressFor(key);
      expect(at, `${key} declares a unique key this suite can address it by`).toBeDefined();
      const { source, sent } = recording();
      await scopedTx(source, stubConn(), IDENTITY).catalogRowAt(key, at as never);
      expect(sent, key).toHaveLength(1);
      expect(sent[0]?.params, key).not.toContain(IDENTITY);
    }
  });

  test('`catalogRowAt` refuses an address that is not a unique key', async () => {
    const { source, sent } = recording();
    const tx = scopedTx(source, stubConn(), IDENTITY);
    await expect(tx.catalogRowAt('coupons', { discountKind: 'percent' })).rejects.toThrow(
      /can match more than one row/,
    );
    expect(sent).toHaveLength(0);
  });
});

describe('the two addresses the ports need, pinned', () => {
  // BOTH WERE REFUSED BEFORE ADR-233 AND THE DATABASE HAD BOUNDED BOTH FOR
  // YEARS. `coupons.code` is `citext NOT NULL UNIQUE` inline in
  // `0006_commerce.sql` and `plan_version_sizes_version_size_uq` is a standalone
  // `CREATE UNIQUE INDEX` in `0004_catalog.sql`; neither spelling was in
  // `schema.ts`, which is the one file `uniqueKeys()` reads. These two cases go
  // red the day somebody deletes the transcription.
  test('`coupons` is addressable by `code`, which is `CheckoutTx.couponByCode`', async () => {
    expect(uniqueKeys('coupons').map((k) => [...k])).toContainEqual(['code']);
    const { source, sent } = recording();
    await scopedTx(source, stubConn(), IDENTITY).catalogRowAt('coupons', { code: 'LAUNCH50' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params).toEqual(['LAUNCH50']);
  });

  test('`planVersionSizes` is addressable by version and size, which is THE PRICE', async () => {
    expect(uniqueKeys('planVersionSizes').map((k) => [...k])).toContainEqual([
      'plan_version_id',
      'size_cents',
    ]);
    const { source, sent } = recording();
    await scopedTx(source, stubConn(), IDENTITY).catalogRowAt('planVersionSizes', {
      planVersionId: 'pv-1',
      sizeCents: 5_000_000n,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params).toEqual(['pv-1', 5_000_000n]);
  });
});

describe('nothing here is a write, and nothing here is a scope', () => {
  test('the handle carries exactly three `catalog` methods and none of them writes', () => {
    const tx = scopedTx(recording().source, stubConn(), IDENTITY);
    const named = Object.keys(tx)
      .filter((name) => name.startsWith('catalog'))
      .sort();
    expect(named).toEqual(['catalogRowAt', 'catalogRows', 'catalogRowsWhere']);
    for (const verb of ['catalogInsert', 'catalogUpdateAt', 'catalogDeleteAt']) {
      expect(verb in tx, `${verb} must not exist`).toBe(false);
    }
  });

  test('`scopePredicate` still throws on every catalogue key', () => {
    // NO READ AROUND A SCOPE WAS CREATED. These keys had no tenancy predicate
    // before this ruling and have none after it; what changed is which
    // transaction an unfiltered read of a nobody's row runs in.
    for (const key of CATALOG_TABLE_KEYS) {
      expect(() => scopePredicate(key, IDENTITY), key).toThrow();
    }
  });

  test('the scoped read verbs still refuse these keys, which is the type unmoved', async () => {
    const { source, sent } = recording();
    const tx = scopedTx(source, stubConn(), IDENTITY);
    for (const key of CATALOG_TABLE_KEYS) {
      // `rows` is typed over `ScopedTableKey`, which excludes every `firm` key,
      // so this call site does not compile without the cast. The RUNTIME half is
      // `scopePredicate`'s throw, asserted here so the compile half is not the
      // only thing standing between a catalogue key and a scoped read.
      await expect(tx.rows(key as never), key).rejects.toThrow();
    }
    expect(sent).toHaveLength(0);
  });
});
