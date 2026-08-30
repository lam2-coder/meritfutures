// =============================================================================
// packages/db/test/counterparty-door.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-262. ADR-238 ruling 6 named the remedy for the
// cross-identity read `POST /checkout` has been refused twice and could not
// build it: a door that resolves the affiliate INSIDE `packages/db` and hands
// the handler A BIT RATHER THAN A UUID.
//
// -----------------------------------------------------------------------------
// THE PROPERTY, EXACTLY
// -----------------------------------------------------------------------------
// "The handler cannot leak what it never receives." That is proved here from
// three directions, because one assertion of it would be an assertion about a
// VALUE and the property is about a SHAPE:
//
//   1. THE PROJECTION. Every object either read door returns carries exactly
//      the keys it declares, and `affiliates.identity_id` is not among them on
//      any of them. Asserted over the KEY SET rather than over a field, so a
//      column added to the projection later fails a case instead of shipping.
//   2. THE STAMP. `attributions` takes NEITHER identity column from the caller
//      now. Both spellings of both columns throw, and the counterparty is
//      RESOLVED from `affiliate_id` inside the transaction rather than supplied.
//   3. THE REFUSAL. A resolution that matches no row throws and NOTHING IS
//      WRITTEN, because a refusal that threw after the INSERT would be a
//      refusal that wrote the row.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES AGAINST POSTGRES, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block. Every assertion below reads the SQL the accessor BUILDS, through a
// driverless Drizzle handle (`drizzle-orm/pg-proxy`) that records `(sql,
// params)` and answers rows this file composes. That is `pair-write-door.
// test.ts`'s own construction and its own stated limit.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getTableColumns } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { describe, expect, test } from 'vitest';

import { SCOPE_RULES, TABLES, TABLE_KEYS, type IdentityId, type TableKey } from '../src/index.ts';
import {
  attributionAffiliateStatement,
  attributionClickStatement,
  pairInsertStatement,
  type AttributionAffiliate,
  type AttributionClick,
  type PartyWritableTableKey,
  type StatementSource,
} from '../src/scoped-db.ts';

const BUYER = 'i-buyer' as IdentityId;
const AFFILIATE_ID = 'a-0001';
const AFFILIATE_IDENTITY = 'i-affiliate';
const CLICK_TOKEN = 'tok-0001';

const ATTRIBUTION_SRC = readFileSync(
  fileURLToPath(new URL('../../affiliate/src/attribution.ts', import.meta.url)),
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
 * THE PROXY HANDS THE MAPPER AN ARRAY PER ROW, in the select's own column
 * order, so a row is built from the table rather than written as an object
 * literal. Every column this file does not name is null, which is what makes a
 * door that read one of them visible.
 */
function rowOf(key: TableKey, values: Readonly<Record<string, unknown>>): unknown[] {
  const properties = propertiesOf(key);
  const row = new Array(properties.length).fill(null) as unknown[];
  for (const [sqlName, value] of Object.entries(values)) {
    row[properties.indexOf(propertyFor(key, sqlName))] = value;
  }
  return row;
}

/**
 * A driverless handle answering a queue of row sets, one per statement.
 *
 * The queue is per STATEMENT and not per table, because the click door sends
 * two and the order it sends them in is part of what this file asserts.
 */
function answering(queue: readonly unknown[][][]): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const source: StatementSource = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: queue[sent.length - 1] ?? [] };
  });
  return { source, sent };
}

const AFFILIATE_ROW = (): unknown[][] => [
  rowOf('affiliates', { id: AFFILIATE_ID, identity_id: AFFILIATE_IDENTITY }),
];

const CLICK_ROW = (): unknown[][] => [
  rowOf('affiliateClicks', {
    id: 4242n,
    affiliate_id: AFFILIATE_ID,
    click_token: CLICK_TOKEN,
    clicked_at: new Date('2026-08-30T00:00:00.000Z'),
    ip: '198.51.100.7',
    user_agent: 'a browser',
    click_fingerprint: 'a fingerprint',
    suspicious_reason: 'a reason',
    referrer_host: 'example.test',
  }),
];

// =============================================================================
// 1. THE PROJECTION. NEITHER DOOR HANDS OUT AN IDENTITY
// =============================================================================
describe('the affiliate is resolved here and leaves as a bit', () => {
  test('`attributionAffiliate` returns the affiliate id and one boolean, and nothing else', async () => {
    const { source } = answering([AFFILIATE_ROW()]);
    const ref = await attributionAffiliateStatement(source, BUYER, AFFILIATE_ID);
    expect(ref).not.toBeNull();
    // THE KEY SET AND NOT A FIELD. A door that grew a third key would pass an
    // assertion written as `expect(ref.identityId).toBeUndefined()`.
    expect(Object.keys(ref as AttributionAffiliate).sort()).toEqual(['affiliateId', 'isBuyer']);
    expect(JSON.stringify(ref)).not.toContain(AFFILIATE_IDENTITY);
  });

  test('the bit is FALSE when the affiliate is somebody else', async () => {
    const { source } = answering([AFFILIATE_ROW()]);
    const ref = await attributionAffiliateStatement(source, BUYER, AFFILIATE_ID);
    expect(ref?.isBuyer).toBe(false);
  });

  test('the bit is TRUE when the affiliate is the handle, which is the self-deal case', async () => {
    // `attributions_literal_self_deal_is_void` is the constraint this bit
    // exists for, and SD-M8-05 requires the row be WRITTEN rather than refused.
    const { source } = answering([[rowOf('affiliates', { id: AFFILIATE_ID, identity_id: BUYER })]]);
    const ref = await attributionAffiliateStatement(source, BUYER, AFFILIATE_ID);
    expect(ref?.isBuyer).toBe(true);
  });

  test('an affiliate id naming no row is `null` rather than a throw', async () => {
    // A coupon naming a retired affiliate is an ordinary answer and not a
    // contradiction: `coupons.affiliate_id` is a firm row's column.
    const { source } = answering([[]]);
    expect(await attributionAffiliateStatement(source, BUYER, AFFILIATE_ID)).toBeNull();
  });

  test('`attributionClick` hands out the click id, the time and the bit, and no other column', async () => {
    const { source, sent } = answering([CLICK_ROW(), AFFILIATE_ROW()]);
    const click = (await attributionClickStatement(source, BUYER, CLICK_TOKEN)) as AttributionClick;
    expect(click).not.toBeNull();
    expect(Object.keys(click).sort()).toEqual(['affiliate', 'clickId', 'clickedAt']);
    expect(Object.keys(click.affiliate).sort()).toEqual(['affiliateId', 'isBuyer']);
    // THE FOUR COLUMNS THE REGISTRY CALLS THE TRAP. `ip` reaches whoever shares
    // a network, `user_agent` whoever shares a browser build, and
    // `click_fingerprint` is `sessions.device_fingerprint_id`'s named trap on a
    // different table. None of them is attribution's business.
    const handed = JSON.stringify(click, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    for (const leaked of ['198.51.100.7', 'a browser', 'a fingerprint', 'a reason', 'example.test'])
      expect(handed, leaked).not.toContain(leaked);
    expect(handed).not.toContain(AFFILIATE_IDENTITY);
    expect(sent).toHaveLength(2);
  });

  test('an unknown click token is `null` and the affiliate is never asked for', async () => {
    const { source, sent } = answering([[]]);
    expect(await attributionClickStatement(source, BUYER, CLICK_TOKEN)).toBeNull();
    expect(sent, 'one statement, and no second read on a token that named nothing').toHaveLength(1);
  });

  test('a click whose affiliate row is gone THROWS, because the FK says it cannot be', async () => {
    const { source } = answering([CLICK_ROW(), []]);
    await expect(attributionClickStatement(source, BUYER, CLICK_TOKEN)).rejects.toThrow(
      /NOT NULL REFERENCES affiliates/,
    );
  });
});

// =============================================================================
// 2. THE STAMP. `attributions` TAKES NEITHER IDENTITY FROM THE CALLER
// =============================================================================
describe('a resolved counterparty is stamped and cannot be supplied', () => {
  test("the registry says how `attributions`' counterparty is filled, and it is not the caller", () => {
    const rule = SCOPE_RULES.attributions;
    if (rule.class !== 'pair' || rule.writer.by !== 'party') throw new Error('registry moved');
    expect(rule.writer.counterparty.by).toBe('resolved');
    if (rule.writer.counterparty.by !== 'resolved') return;
    expect(rule.writer.counterparty.from).toBe('affiliate_id');
    expect(rule.writer.counterparty.via).toBe('affiliates');
    expect(rule.writer.counterparty.why.length).toBeGreaterThan(80);
  });

  test('every party-writable pair table answers the question', () => {
    // TOTALITY IS A COMPILE ERROR ALREADY. This is the half a type cannot
    // state: that the reason is a REASON.
    const party = TABLE_KEYS.filter((k): k is PartyWritableTableKey => {
      const rule = SCOPE_RULES[k];
      return rule.class === 'pair' && rule.writer.by === 'party';
    });
    expect(party.length).toBeGreaterThan(0);
    for (const key of party) {
      const rule = SCOPE_RULES[key as TableKey];
      if (rule.class !== 'pair' || rule.writer.by !== 'party') continue;
      expect(['caller', 'resolved'], key).toContain(rule.writer.counterparty.by);
    }
  });

  test('the counterparty column is refused in BOTH spellings now, like the writer', async () => {
    for (const named of [
      'affiliate_identity_id',
      propertyFor('attributions', 'affiliate_identity_id'),
    ]) {
      const { source, sent } = answering([AFFILIATE_ROW()]);
      await expect(
        pairInsertStatement(source, 'attributions', BUYER, {
          affiliateId: AFFILIATE_ID,
          [named]: AFFILIATE_IDENTITY,
        }),
        named,
      ).rejects.toThrow(/RESOLVED/);
      expect(sent, 'nothing is sent when the refusal fires').toHaveLength(0);
    }
  });

  test('the insert binds the resolved identity, and the caller supplied only the affiliate id', async () => {
    const { source, sent } = answering([AFFILIATE_ROW()]);
    await pairInsertStatement(source, 'attributions', BUYER, { affiliateId: AFFILIATE_ID });
    expect(sent).toHaveLength(2);
    const insert = sent[1] as Sent;
    expect(insert.sql).toMatch(/^insert into "attributions"/i);
    expect(insert.params).toContain(BUYER);
    expect(insert.params).toContain(AFFILIATE_IDENTITY);
    expect(insert.sql).not.toMatch(/returning/i);
  });

  test('a second handle writes the same affiliate against ITS OWN identity', async () => {
    // THE CONTROL CASE. A door that stamped a constant would pass every
    // assertion above it.
    const other = 'i-somebody-else' as IdentityId;
    const { source, sent } = answering([AFFILIATE_ROW()]);
    await pairInsertStatement(source, 'attributions', other, { affiliateId: AFFILIATE_ID });
    expect((sent[1] as Sent).params).toContain(other);
    expect((sent[1] as Sent).params).not.toContain(BUYER);
  });

  test('an `affiliate_id` naming no row THROWS and the row is NOT written', async () => {
    const { source, sent } = answering([[]]);
    await expect(
      pairInsertStatement(source, 'attributions', BUYER, { affiliateId: AFFILIATE_ID }),
    ).rejects.toThrow(/cannot be resolved/);
    expect(sent, 'the resolution ran and the insert did not').toHaveLength(1);
  });

  test('omitting the column the resolution reads THROWS before anything is sent', async () => {
    const { source, sent } = answering([AFFILIATE_ROW()]);
    // THE MESSAGE NAMES THE RESOLUTION AND NOT THE COUNTERPARTY, because the
    // door refused a missing counterparty before this ruling too and a case
    // that passes on the OLD refusal is a case that proves nothing.
    await expect(pairInsertStatement(source, 'attributions', BUYER, {})).rejects.toThrow(
      /the column its counterparty is RESOLVED from/,
    );
    expect(sent).toHaveLength(0);
  });
});

// =============================================================================
// 3. THE SHAPE `packages/affiliate` HOLDS, READ RATHER THAN RESTATED
// =============================================================================
describe('the fold one package over carries the bit and not the uuid', () => {
  test('`AffiliateRef` declares `isBuyer` and declares no identity at all', () => {
    // BOUND BY READING THE OTHER PACKAGE'S SOURCE rather than by importing it,
    // which is `SqlExecutor` and `JobTransaction`'s construction exactly:
    // neither package depends on the other, and structural typing is what makes
    // one satisfy the other with no import in either direction.
    expect(ATTRIBUTION_SRC).toContain('export interface AffiliateRef {');
    expect(ATTRIBUTION_SRC).toContain('  readonly isBuyer: boolean;');
    expect(ATTRIBUTION_SRC).not.toContain('  readonly identityId: string;');
    expect(ATTRIBUTION_SRC).not.toContain('affiliate.identityId');
  });

  test('the row the fold produces names no affiliate identity for the door to refuse', () => {
    expect(ATTRIBUTION_SRC).not.toContain('affiliateIdentityId');
  });
});
