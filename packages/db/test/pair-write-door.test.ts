// =============================================================================
// packages/db/test/pair-write-door.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-230, AND IT IS A NEW FILE FOR THE REASON
// `write-accessor.test.ts` STATES ABOUT ITS OWN: `scope.ts` is open in a
// concurrent session on a different question (the `owned` case), and nothing
// here reads that question. This file and that one never meet.
//
// -----------------------------------------------------------------------------
// NOTHING HERE EXECUTES A WRITE, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with NO services
// block, so there is no Postgres in CI to write to. Every assertion below reads
// the SQL the accessor BUILDS, through a driverless Drizzle handle
// (`drizzle-orm/pg-proxy`) that records `(sql, params)`. THE ROUND TRIP THROUGH
// A REAL DATABASE IS NOT ASSERTED BY THIS FILE AND IS NOT ASSERTED ANYWHERE
// ELSE: what is asserted is the statement text, its binds, and the refusals,
// which is the whole of what a wrong scope looks like before it reaches a
// driver.
//
// -----------------------------------------------------------------------------
// WHAT THE NARROWNESS CLAIM IS, EXACTLY
// -----------------------------------------------------------------------------
// "A handler party to pair A cannot write a row for pair B." That is proved
// here from three directions rather than one, because a single assertion of it
// would be an assertion about a value and the property is about a SHAPE:
//
//   1. THE STAMP. Every statement the door builds binds the handle's own
//      identity into the writer column, whatever the caller passed.
//   2. THE REFUSAL. Both spellings of the writer column are thrown on, so the
//      caller cannot set it to a value and cannot have one silently overwritten
//      either.
//   3. THE ABSENCE. `scopePredicate` still throws for every `pair` key and the
//      key sets are unmoved, so no READ was created by any of this.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PoolClient } from 'pg';
import { describe, expect, test } from 'vitest';

import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  scopePredicate,
  type IdentityId,
  type ScopedTableKey,
  type TableKey,
} from '../src/index.ts';
import {
  pairInsertStatement,
  scopedTx,
  type PartyWritableTableKey,
  type StatementSource,
} from '../src/scoped-db.ts';

const IDENTITY = 'i-buyer' as IdentityId;
const OTHER = 'i-somebody-else' as IdentityId;
const COUNTERPARTY = 'i-affiliate';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

const PAIR_KEYS: TableKey[] = TABLE_KEYS.filter((k) => SCOPE_RULES[k].class === 'pair');

/**
 * The pair keys whose rule admits a party as the writer, RE-DERIVED FROM THE
 * REGISTRY rather than imported from the door.
 *
 * The type `PartyWritableTableKey` is what the door accepts; this array is the
 * same condition read back out of `SCOPE_RULES` at run time, so the two agreeing
 * is an assertion rather than a tautology. `Array.filter` cannot see through an
 * index into `SCOPE_RULES`, which is why the guard restates the condition the
 * type is made of.
 */
const PARTY_WRITABLE: PartyWritableTableKey[] = TABLE_KEYS.filter(
  (k): k is PartyWritableTableKey => {
    const rule = SCOPE_RULES[k];
    return rule.class === 'pair' && rule.writer.by === 'party';
  },
);

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

/** A `pg` connection that records. `scopedTx` needs one; nothing here uses it. */
function recordingConn(): PoolClient {
  return {
    query: async () => ({ rows: [] as unknown[] }),
  } as unknown as PoolClient;
}

const migrationSql = (): string =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

const ALL_SQL = migrationSql();

/** The Drizzle property name for a SQL column name on one table. */
function propertyFor(key: TableKey, sqlName: string): string {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const [property, column] of Object.entries(columns)) {
    if (column.name === sqlName) return property;
  }
  throw new Error(`${key} declares no column named ${sqlName}`);
}

/** The two columns of a pair rule, and which is which under ADR-230. */
function partyColumns(key: PartyWritableTableKey): {
  writer: string;
  counterparty: string;
} {
  const rule = SCOPE_RULES[key as TableKey];
  if (rule.class !== 'pair' || rule.writer.by !== 'party')
    throw new Error(`${key} is not party-writable`);
  const writer = rule.writer.column;
  return { writer, counterparty: writer === rule.columnA ? rule.columnB : rule.columnA };
}

/** A minimal legal values object: the counterparty and nothing else. */
function counterpartyValues(key: PartyWritableTableKey): Record<string, unknown> {
  const { counterparty } = partyColumns(key);
  return { [propertyFor(key, counterparty)]: COUNTERPARTY };
}

// =============================================================================
// 1. THE REGISTRY ANSWERS THE QUESTION FOR EVERY PAIR TABLE
// =============================================================================
describe('every pair rule declares who may write it, and the answer is checkable', () => {
  test('the set is not empty, so the assertions below are not vacuous', () => {
    expect(PAIR_KEYS.length).toBeGreaterThan(0);
    expect(PARTY_WRITABLE.length).toBeGreaterThan(0);
  });

  test('a `writer` is required of every pair rule and carries a reason', () => {
    // TOTALITY IS ALREADY A COMPILE ERROR -- `PairRule.writer` is not optional
    // and `SCOPE_RULES` is checked against a mapped type over `TableKey`. This
    // is the half a type cannot state: that the reason is a REASON.
    for (const key of PAIR_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'pair') continue;
      expect(['nobody', 'party'], key).toContain(rule.writer.by);
      expect(rule.writer.why.length, key).toBeGreaterThan(80);
    }
  });

  test('a party writer names one of the two identity columns and no third one', () => {
    // THE STAMP GOES SOMEWHERE, and a writer column that is neither declared
    // identity column would put an identity into a column the registry does not
    // call one. The door checks this too; here it is checked of the registry.
    for (const key of PARTY_WRITABLE) {
      const rule = SCOPE_RULES[key as TableKey];
      if (rule.class !== 'pair' || rule.writer.by !== 'party') continue;
      expect([rule.columnA, rule.columnB], key).toContain(rule.writer.column);
    }
  });

  test('both identity columns of a party-writable table are NOT NULL in the DDL', () => {
    // A PAIR ROW WITH ONE PARTY IS NOT A PAIR, and the door refuses a null
    // counterparty on that ground. This reads the ground rather than trusting
    // it: the refusal would be decorative if the column admitted nulls.
    for (const key of PARTY_WRITABLE) {
      const { writer, counterparty } = partyColumns(key);
      const table = getTableName(TABLES[key] as PgTable);
      for (const column of [writer, counterparty]) {
        const declaration = new RegExp(`${column}\\s+uuid NOT NULL REFERENCES identities\\(id\\)`);
        expect(ALL_SQL, `${table}.${column}`).toMatch(declaration);
      }
    }
  });
});

// =============================================================================
// 2. THE NARROWNESS. A HANDLER PARTY TO PAIR A CANNOT WRITE A ROW FOR PAIR B
// =============================================================================
describe('the party write door writes only rows the handle is a party to', () => {
  test('the writer column is bound to the identity the HANDLE carries, on every statement', async () => {
    for (const key of PARTY_WRITABLE) {
      const { source, sent } = recording();
      await pairInsertStatement(source, key, IDENTITY, counterpartyValues(key));
      expect(sent, key).toHaveLength(1);
      const statement = sent[0] as Sent;
      const { writer, counterparty } = partyColumns(key);
      expect(statement.sql, key).toMatch(/^insert into /);
      expect(statement.sql, key).toContain(`"${writer}"`);
      expect(statement.sql, key).toContain(`"${counterparty}"`);
      // THE BIND, AND THIS IS THE ASSERTION THE WHOLE DOOR EXISTS FOR.
      expect(statement.params, key).toContain(IDENTITY);
      expect(statement.params, key).toContain(COUNTERPARTY);
    }
  });

  test('a handler party to pair A cannot write a row for pair B', async () => {
    // THE ROW-230 ASSERTION, WRITTEN AS THE ROW WORDS IT. A handle bound to
    // IDENTITY is handed a values object that tries, in every spelling
    // available to it, to make the row somebody else's. Two spellings throw;
    // the third -- naming nothing -- is stamped. There is no fourth, because the
    // signature has no other parameter.
    for (const key of PARTY_WRITABLE) {
      const { writer } = partyColumns(key);
      const writerProperty = propertyFor(key, writer);

      for (const spelling of new Set([writer, writerProperty])) {
        const { source, sent } = recording();
        await expect(
          pairInsertStatement(source, key, IDENTITY, {
            ...counterpartyValues(key),
            [spelling]: OTHER,
          }),
          `${key}.${spelling}`,
        ).rejects.toThrow(/WRITER column/);
        // AND NOTHING WAS SENT. A refusal that threw after the INSERT would be
        // a refusal that wrote the row.
        expect(sent, `${key}.${spelling}`).toHaveLength(0);
      }

      const { source, sent } = recording();
      await pairInsertStatement(source, key, IDENTITY, counterpartyValues(key));
      const statement = sent[0] as Sent;
      expect(statement.params, key).not.toContain(OTHER);
    }
  });

  test('the same door on another identity writes another row, which is the control', async () => {
    // THE NEGATIVE ABOVE IS ONLY EVIDENCE IF THE POSITIVE MOVES. A door that
    // refused everything would pass every assertion in this file, so the same
    // call on a second handle is run and the bind is asserted to have changed.
    for (const key of PARTY_WRITABLE) {
      const first = recording();
      await pairInsertStatement(first.source, key, IDENTITY, counterpartyValues(key));
      const second = recording();
      await pairInsertStatement(second.source, key, OTHER, counterpartyValues(key));
      expect((first.sent[0] as Sent).params, key).toContain(IDENTITY);
      expect((second.sent[0] as Sent).params, key).toContain(OTHER);
      expect((second.sent[0] as Sent).params, key).not.toContain(IDENTITY);
    }
  });

  test('the counterparty is required, in one spelling, and may not be null', async () => {
    for (const key of PARTY_WRITABLE) {
      const { counterparty } = partyColumns(key);
      const counterpartyProperty = propertyFor(key, counterparty);

      await expect(
        pairInsertStatement(recording().source, key, IDENTITY, {}),
        `${key} unnamed`,
      ).rejects.toThrow(/must name/);

      await expect(
        pairInsertStatement(recording().source, key, IDENTITY, {
          [counterpartyProperty]: null,
        }),
        `${key} null`,
      ).rejects.toThrow(/is not a pair/);

      if (counterparty !== counterpartyProperty) {
        // THE SQL SPELLING IS REFUSED RATHER THAN DROPPED. Drizzle keys a values
        // object by PROPERTY name, so this row would otherwise record one party.
        await expect(
          pairInsertStatement(recording().source, key, IDENTITY, {
            [counterparty]: COUNTERPARTY,
          }),
          `${key} sql spelling`,
        ).rejects.toThrow(/keyed by Drizzle property name/);
      }
    }
  });

  test('a counterparty EQUAL to the writer is permitted, because the self-deal row is evidence', async () => {
    // `attributions_literal_self_deal_is_void` permits the two columns to name
    // one person on a voided row, and SD-M8-05 requires that row to exist: "the
    // self-deal check must record WHAT IT FOUND, not only its verdict". A door
    // refusing it would make the evidence unwritable, so the permission is
    // asserted rather than left to be a side effect.
    for (const key of PARTY_WRITABLE) {
      const { counterparty } = partyColumns(key);
      const { source, sent } = recording();
      await pairInsertStatement(source, key, IDENTITY, {
        [propertyFor(key, counterparty)]: IDENTITY,
      });
      expect(sent, key).toHaveLength(1);
    }
  });

  test('the door builds no RETURNING clause, which is why no read was created', async () => {
    for (const key of PARTY_WRITABLE) {
      const { source, sent } = recording();
      const answer = await pairInsertStatement(source, key, IDENTITY, counterpartyValues(key));
      expect(answer, key).toBeUndefined();
      expect((sent[0] as Sent).sql.toLowerCase(), key).not.toContain('returning');
    }
  });

  test('`insertAsParty` on a scoped transaction is the same door', async () => {
    for (const key of PARTY_WRITABLE) {
      const { source, sent } = recording();
      await scopedTx(source, recordingConn(), IDENTITY).insertAsParty(key, counterpartyValues(key));
      expect(sent, key).toHaveLength(1);
      expect((sent[0] as Sent).params, key).toContain(IDENTITY);
    }
  });
});

// =============================================================================
// 3. WHAT DID NOT MOVE
// =============================================================================
describe('ADR-230 created no read and admitted no other table', () => {
  test('a pair table whose rule says `nobody` is refused past a cast', async () => {
    const refused = PAIR_KEYS.filter((k) => !(PARTY_WRITABLE as TableKey[]).includes(k));
    expect(refused.length, 'the two edge tables').toBeGreaterThan(0);
    for (const key of refused) {
      await expect(
        // The real refusal is the TYPE: these keys are not members of
        // `PartyWritableTableKey`. This is the runtime half, for a caller that
        // got here through a cast, and it is `scopePredicate`'s own idiom.
        pairInsertStatement(recording().source, key as PartyWritableTableKey, IDENTITY, {}),
        key,
      ).rejects.toThrow(/no party to one of its rows may author one/);
    }
  });

  test('a non-pair table is refused past a cast, whatever its class', async () => {
    // One member of each of the other four reachable classes. `identities` is
    // the fifth (`root`) and is included so no class is left untested.
    for (const key of ['accounts', 'sessions', 'planVersions', 'events', 'identities'] as const) {
      await expect(
        pairInsertStatement(
          recording().source,
          key as unknown as PartyWritableTableKey,
          IDENTITY,
          {},
        ),
        key,
      ).rejects.toThrow(/insertAsParty writes a row that belongs to TWO identities/);
    }
  });

  test('the derived key type is neither `never` nor wider than the ruling', () => {
    // A COMPILE-TIME PAIR, AND VITEST SEES NEITHER OF THEM. `tsc` does: the
    // first line stops compiling if `PartyWritableTableKey` collapses to
    // `never`, and the second stops compiling if it ever admits a table whose
    // rule did not say `by: 'party'`. The runtime assertion below is the third
    // reading of the same fact and the only one this runner can observe.
    const member: PartyWritableTableKey = 'attributions';
    // @ts-expect-error `accounts` is `owned`, and a widening here would be the
    // whole estate's scope system quietly losing its shape.
    const notAMember: PartyWritableTableKey = 'accounts';
    expect(member).toBe('attributions');
    expect(notAMember).toBe('accounts');
    expect(PARTY_WRITABLE).toContain('attributions');
  });

  test('every pair key still has no scoped READING, party-writable or not', () => {
    // THE HALF THAT WOULD BE THE REAL WIDENING IF IT EVER STOPPED HOLDING.
    for (const key of PAIR_KEYS) {
      expect(() => scopePredicate(key, IDENTITY), key).toThrow(/belongs to TWO identities/);
    }
  });

  test('no pair key joined `ScopedTableKey`', () => {
    // COMPARED AS STRINGS, because `PairTableKey` is not assignable to
    // `ScopedTableKey` and the comparison that would state this in types does
    // not compile. This is the runtime half of that refusal.
    const scoped: string[] = TABLE_KEYS.filter(
      (k): k is ScopedTableKey =>
        SCOPE_RULES[k].class !== 'firm' && SCOPE_RULES[k].class !== 'pair',
    );
    for (const key of PAIR_KEYS) expect(scoped, key).not.toContain(key);
  });
});
