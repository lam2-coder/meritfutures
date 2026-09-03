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
import {
  scopedTx,
  uniqueKeys,
  type CatalogRow,
  type ScopedTx,
  type StatementSource,
} from '../src/scoped-db.ts';

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

// =============================================================================
// THE FIFTH DIRECTION: THE RETURN IS A DECLARED ROW (ADR-303)
// =============================================================================
// ADR-233 built this door and never ruled its return type. ADR-299 ruling 1
// rules it, and ADR-303 lands it: the three verbs hand back the row type
// `schema.ts` declares instead of `unknown`.
//
// EVERY REFUSAL ABOVE IS UNMOVED AND THAT IS THE OTHER HALF OF THE STOP
// CONDITION. Nothing in this section replaces a case above it; the guard order
// in `catalogRows`, `catalogRowsWhere` and `catalogRowAt` is what the four
// directions above assert and a narrower return cannot reach it.
//
// THE TYPE CASES ARE CHECKED BY `tsc` AND NOT BY VITEST, which this file's own
// header already says about the compile half of any refusal: vitest runs
// transpiled code and a type error is gone by then. `packages/db/tsconfig.json`
// includes `test/**/*.ts`, so `pnpm typecheck` compiles this file and a RED here
// is a compile failure in this package rather than a failing test.

/** `true` only where the argument is `true`. A false case does not compile. */
type Assert<T extends true> = T;

/**
 * `A` and `B` are the SAME type, invariantly.
 *
 * THE CONDITIONAL-IDENTITY FORM AND NOT MUTUAL ASSIGNABILITY, because `any` is
 * assignable in both directions and would pass a two-sided `extends` check
 * silently. That matters here: the failure this section exists to catch is a
 * return type that has stopped being a row, and `any` is one of the two ways it
 * could stop.
 */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type PlanVersionSizeCatalogRow = CatalogRow<'planVersionSizes'>;

/** The row is `schema.ts`'s row, column for column, and it is neither `unknown` nor `any`. */
type TheRowIsTheDeclaredRow = [
  // THE MONEY COLUMN ARRIVES AS `bigint`, which is `{ mode: 'bigint' }` in
  // `schema.ts` reaching a caller as a type rather than as a hope.
  Assert<Same<PlanVersionSizeCatalogRow['sizeCents'], bigint>>,
  // THE PRICE IS ON THE ROW. ADR-299 section 5.1 item 4: the row type carries
  // more than the engine's does, and the engine's refusal of the price by name
  // is preserved because the DECODER's output is still the engine's type.
  Assert<Same<PlanVersionSizeCatalogRow['priceCents'], bigint>>,
  // A NULLABLE COLUMN KEEPS ITS NULL. `profit_target_cents` is NULL on Direct,
  // and a type that flattened that would be false about the one plan with no
  // evaluation.
  Assert<Same<PlanVersionSizeCatalogRow['profitTargetCents'], bigint | null>>,
  // A KEY THE TABLE DOES NOT DECLARE IS NOT ON THE ROW, which is the `TS2339`
  // ADR-299 section 5.1 item 1 says this buys.
  Assert<Same<'notAColumn' extends keyof PlanVersionSizeCatalogRow ? true : false, false>>,
  // AND IT IS NOT `unknown`, NOR `any`. Both would satisfy every assignment in
  // this file and neither is a row.
  Assert<Same<Same<PlanVersionSizeCatalogRow, unknown>, false>>,
  Assert<Same<Same<PlanVersionSizeCatalogRow, any>, false>>,
];

/**
 * THE `jsonb` STAYS UNTYPED, AND IT IS ASSERTED RATHER THAN LEFT AS AN ABSENCE.
 *
 * ADR-299 section 5.1 item 2: `payout_cap_schedule_cents` carries no `.$type<>()`
 * in `schema.ts`, so the blob is `unknown` on the typed row and every reader
 * still decodes it by hand. The one divergence this value has actually produced
 * is inside that blob, and a session reading the typed door must not conclude
 * the cap schedule came with it.
 */
type TheBlobIsStillUnknown = Assert<
  Same<PlanVersionSizeCatalogRow['payoutCapScheduleCents'], unknown>
>;

/**
 * THE OTHER READ VERBS ARE UNMOVED, which ADR-299 section 5.1 item 3 NAMES and
 * does NOT rule. `rows`, `rowsWhere`, `rowAt` and `lockAt` still return
 * `unknown`, so a session that widens one of them is changing something this
 * case records as deliberate rather than tidying an inconsistency.
 */
type TheScopedVerbsStillReturnUnknown = [
  Assert<Same<Awaited<ReturnType<ScopedTx['rows']>>, unknown[]>>,
  Assert<Same<Awaited<ReturnType<ScopedTx['rowsWhere']>>, unknown[]>>,
  Assert<Same<Awaited<ReturnType<ScopedTx['rowAt']>>, unknown>>,
  Assert<Same<Awaited<ReturnType<ScopedTx['lockAt']>>, unknown>>,
];

/** `undefined` IS IN `catalogRowAt`'S RETURN, so an absent row is a case a caller must hold. */
type TheAddressedReadCanBeAbsent = Assert<
  undefined extends Awaited<ReturnType<ScopedTx['catalogRowAt']>> ? true : false
>;

/**
 * THE TYPE CASES, BOUND TO A VALUE SO THE SUITE CAN NAME THEM.
 *
 * A TYPE ALIAS NOTHING REFERENCES IS AN ESLINT ERROR IN THIS REPOSITORY, and
 * writing `_` in front of each name to buy silence would leave the cases
 * invisible to a reader running the suite. Binding them to a tuple of `true`
 * spends one value and makes the RED legible from either half: a case that stops
 * holding is `TS2344` at the alias, and this tuple stops compiling with it.
 */
const ADR_303_TYPE_CASES: readonly [
  TheRowIsTheDeclaredRow,
  TheBlobIsStillUnknown,
  TheScopedVerbsStillReturnUnknown,
  TheAddressedReadCanBeAbsent,
] = [[true, true, true, true, true, true], true, [true, true, true, true], true];

/**
 * The three verbs hand back declared rows AT A CALL SITE, which is the property
 * a caller will actually meet.
 *
 * THIS FUNCTION IS NEVER CALLED AND THAT IS THE POINT: it is compiled and not
 * run, and every line in it is an assignment `unknown` would refuse.
 */
async function theVerbsHandBackDeclaredRows(tx: ScopedTx): Promise<void> {
  const many: readonly PlanVersionSizeCatalogRow[] = await tx.catalogRows('planVersionSizes');
  const filtered: readonly CatalogRow<'coupons'>[] = await tx.catalogRowsWhere('coupons', {
    code: 'LAUNCH50',
  });
  const one: PlanVersionSizeCatalogRow | undefined = await tx.catalogRowAt('planVersionSizes', {
    planVersionId: 'pv-1',
    sizeCents: 5_000_000n,
  });
  // THE MONEY COLUMN IS READ WITHOUT A CAST AND WITHOUT A GUARD FOR ITS
  // EXISTENCE, which is the whole of what the narrowing buys. What it does NOT
  // buy is the guard on the VALUE: ADR-299 section 5.1 item 5 rules that a type
  // derived from a transcription does not retire a runtime check.
  const cents: bigint | undefined = one?.sizeCents;
  const codes: readonly string[] = filtered.map((row) => row.code);
  void many;
  void cents;
  void codes;
}

describe('the return is the declared row and no refusal moved (ADR-303)', () => {
  test('the type cases above are compiled, and this test says so out loud', () => {
    // A TYPE IS NOT A TEST AND THIS FILE SHOULD NOT PRETEND OTHERWISE. The
    // aliases above are checked by `tsc` and are invisible to vitest, so what
    // this case asserts is only that the tuple binding them is whole. A case
    // that stops holding fails `pnpm typecheck` and this line never runs.
    expect(ADR_303_TYPE_CASES.flat(2)).not.toContain(false);
    expect(ADR_303_TYPE_CASES.flat(2).length).toBeGreaterThan(0);
    expect(typeof theVerbsHandBackDeclaredRows).toBe('function');
  });

  test('`catalogRowAt` hands back `undefined` where nothing matched', async () => {
    // THE `| undefined` ARM IS REACHED AT RUN TIME AND NOT ONLY DECLARED. The
    // recording handle answers every statement with no rows, so this is the
    // absent case the type now forces a caller to hold.
    const { source, sent } = recording();
    const found = await scopedTx(source, stubConn(), IDENTITY).catalogRowAt('coupons', {
      code: 'NOT-A-COUPON',
    });
    expect(found).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  test('the guard still runs BEFORE the narrowed return, on all three verbs', async () => {
    // THE SECOND HALF OF THE STOP CONDITION, ASSERTED AS ITSELF. A typed return
    // that cost one refusal would be a regression wearing a type, so each verb
    // is driven once more with a key outside the list and each must still throw
    // having built nothing. The four directions at the top of this file assert
    // this over EVERY outside key; this case asserts it beside the change.
    for (const verb of ['catalogRows', 'catalogRowsWhere', 'catalogRowAt'] as const) {
      const { source, sent } = recording();
      const tx = scopedTx(source, stubConn(), IDENTITY);
      const run =
        verb === 'catalogRows'
          ? tx.catalogRows('treasuryBalances' as CatalogTableKey)
          : verb === 'catalogRowsWhere'
            ? tx.catalogRowsWhere('treasuryBalances' as CatalogTableKey, { id: 'x' } as never)
            : tx.catalogRowAt('treasuryBalances' as CatalogTableKey, { id: 'x' } as never);
      await expect(run, verb).rejects.toThrow(/is not a table a scoped transaction may read/);
      expect(sent, `${verb} built a statement`).toHaveLength(0);
    }
  });
});
