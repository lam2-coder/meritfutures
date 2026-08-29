// =============================================================================
// packages/db/test/public-lookup.test.ts
// =============================================================================
// ADR-231. THE DOOR THAT OPENS FOR A CALLER WHO WILL NEVER BE ANYBODY.
//
// `GET /verify/:code` is the page a funded trader shows the world. It reads
// `certificates`, which is scope class `owned` on `identity_id`, and it reads it
// for a stranger: `db.scoped` has no identity to open with and `db.firm` refuses
// the key at compile time. ADR-231 rules the third answer and this suite is what
// that ruling has to survive.
//
// -----------------------------------------------------------------------------
// THE LOAD-BEARING ASSERTION IS `certificates.id`
// -----------------------------------------------------------------------------
// A per-table opt-in is the design that reads most naturally and it is the one
// ADR-231 section 4 refuses, because `certificates` declares TWO unique keys and
// only one of them may be public. `0020_public_surface.sql` keeps `code` distinct
// from `id` "so the public token can be ROTATED AFTER AN INCIDENT", and a door
// that admitted `id` would hand a holder who kept the immutable key a way to
// correlate the certificate after the token they were told to forget had
// changed. The case below fails on the day somebody widens the vocabulary to the
// table, and it fails naming that column.
//
// -----------------------------------------------------------------------------
// AND THE OTHER HALF: A TABLE NOBODY DECLARED IS NOT REACHABLE THROUGH THIS DOOR
// -----------------------------------------------------------------------------
// The type refuses it, and a type refusal is invisible to vitest, which runs
// transpiled code where the error is already gone. So the cases below reach past
// the type with a cast and watch the RUN-TIME guard refuse as well. Both halves
// are the control: the type is what a reader sees and the throw is what an
// `any` at a call site meets.
//
// NOTHING HERE EXECUTES A READ AND THE SUITE SAYS SO. `ci.yml`'s `integration`
// job has no services block, so every statement assertion reads the SQL the
// accessor BUILDS over a driverless Drizzle handle that records what it is asked
// to run. `publicLookupPredicate` is a separate function from `publicLookupDb`
// for exactly this reason: the handle itself reads `client()`, which throws when
// `DATABASE_URL` is unset.

import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

import { SCOPE_RULES, TABLES, TABLE_KEYS, type TableKey } from '../src/scope.ts';
import {
  PUBLIC_LOOKUP_ADDRESS,
  RESOLUTION_ADDRESS,
  publicLookupPredicate,
  uniqueKeys,
  type PubliclyLookedUpTableKey,
  type StatementSource,
} from '../src/scoped-db.ts';

interface Sent {
  readonly sql: string;
  readonly params: unknown[];
}

/** A driverless handle that records every statement and answers no rows. */
function recording(): { source: StatementSource; sent: Sent[] } {
  const sent: Sent[] = [];
  const source = drizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: [] };
  }) as StatementSource;
  return { source, sent };
}

/** The predicate, called past its own type. What an `any` at a call site meets. */
function past(key: string, at: Record<string, unknown>): unknown {
  return publicLookupPredicate(key as PubliclyLookedUpTableKey, at as unknown as { code: unknown });
}

// =============================================================================
// WHAT IT MAY REACH
// =============================================================================

describe('the public lookup reaches certificates by code', () => {
  test('it renders `certificates"."code" = $1` and names no other table', async () => {
    const { source, sent } = recording();
    await source
      .select()
      .from(TABLES['certificates'] as PgTable)
      .where(publicLookupPredicate('certificates', { code: 'tok-1' }));

    const statement = sent[0] as Sent;
    expect(statement.sql).toMatch(/"certificates"\."code" = \$1/);
    expect(statement.params).toEqual(['tok-1']);

    // NO TENANCY, NO EXISTS, NO SECOND TABLE. There is no identity to narrow BY
    // and there is no correct one, which is the sentence that makes this an
    // authority rather than a predicate. The PROJECTION is the whole row and
    // must be: a door cannot project, because a projection is a statement about
    // what one caller renders. `routes/verify.ts` is where the withholding
    // lives, structurally, in `toVerifyRow`.
    const where = statement.sql.slice(statement.sql.indexOf(' where '));
    expect(where).not.toMatch(/exists/i);
    expect(where).not.toMatch(/identity_id/);
  });

  test('the row it addresses is one row, because the database says so', () => {
    // THE FOLD. `refuseUnaddressed` reads `schema.ts`, so a vocabulary member
    // over a non-unique column would be a MANY-ROW read at an authority carrying
    // no tenancy at all, which is the widest failure this door has. The DDL has
    // bounded `code` since `0020_public_surface.sql`'s `certificates_code_uq`;
    // `schema.ts` did not say so until ADR-231 transcribed it, and until then
    // `{ code }` was refused here as an address that "can match more than one
    // row".
    expect(uniqueKeys('certificates').map((k) => [...k].sort().join(','))).toContain('code');
  });
});

// =============================================================================
// WHAT IT MAY NOT REACH, WHICH IS THE HALF THAT IS THE RULING
// =============================================================================

describe('the public lookup reaches nothing else, at either half of the vocabulary', () => {
  test('`certificates.id` is refused BY NAME, even though it is a unique key', () => {
    // THE ONE THAT MATTERS. `id` IS unique, so `refuseUnaddressed` would honour
    // it and a table-only opt-in would admit it. The COLUMN half of the
    // vocabulary is what refuses it, and the reason is `0020`'s own: the two
    // columns exist separately so the public one can be rotated after an
    // incident, and a door that published the immutable one would spend that
    // property for nothing.
    expect(() => past('certificates', { id: 'c-1' })).toThrow(
      /"id" is not a public lookup address on certificates/,
    );
    expect(uniqueKeys('certificates').map((k) => k.join(','))).toContain('id');
  });

  test('`identity_id` is refused, which is the column the whole endpoint exists not to publish', () => {
    expect(() => past('certificates', { identityId: 'i-1' })).toThrow(
      /is not a public lookup address on certificates/,
    );
  });

  test('a table nobody declared readable this way is refused, and `users` is the one that would hurt', () => {
    // `users` IS THE OTHER DOOR'S TABLE, and the two vocabularies are separate
    // objects on purpose: `RESOLUTION_ADDRESS` is `POST /auth/verify`'s
    // pre-identity read and answers "who is this", while this door answers "what
    // did Merit publish". One shared list would have let an unauthenticated
    // verification page address a person by their email.
    expect(() => past('users', { email: 'a@example.com' })).toThrow(
      /users is not publicly readable/,
    );
    // AND THE TABLE THAT WOULD HURT MOST. `payout_requests` is money leaving the
    // firm; nothing declares it publicly readable and nothing here can reach it.
    expect(() => past('payoutRequests', { id: 'p-1' })).toThrow(
      /payoutRequests is not publicly readable/,
    );
  });

  test('an address that omits the declared column is refused rather than widened', () => {
    // ON A ONE-COLUMN LIST THIS IS THE EMPTY ADDRESS, and at an authority
    // carrying no tenancy the empty address is the whole table.
    expect(() => past('certificates', {})).toThrow(/must name "code"/);
  });

  test('a null address value is refused, because equality against NULL names no row', () => {
    expect(() => publicLookupPredicate('certificates', { code: null })).toThrow(
      /is null in a filter/,
    );
  });
});

// =============================================================================
// THE VOCABULARY ITSELF, ASSERTED MECHANICALLY SO A LATER MEMBER IS RE-RULED
// =============================================================================

describe('the vocabulary is the control, so growing it is a decision somebody takes', () => {
  test('it is exactly `certificates` by `code`', () => {
    // THE ASSERTION THAT FAILS ON GOOD NEWS. A second member is legitimate and
    // it is a decision with an argument attached, and the argument it owes is
    // not "this row is public": it is "this column cannot be guessed", because
    // the address is the entire predicate and there is no tenancy conjunct to
    // fall back on.
    expect(PUBLIC_LOOKUP_ADDRESS).toEqual({ certificates: ['code'] });
  });

  test('every publicly readable table is registered, and none of them is already reachable', () => {
    for (const key of Object.keys(PUBLIC_LOOKUP_ADDRESS) as PubliclyLookedUpTableKey[]) {
      expect(TABLE_KEYS, `${key} is not a registry row`).toContain(key);
      const rule = SCOPE_RULES[key as TableKey];
      // A `firm` member would be a door duplicating `firmDb()`, which already
      // reaches rows that belong to nobody with no identity and no reason. This
      // vocabulary is for tables an identity OWNS, which is the boundary being
      // crossed and the reason the ruling was needed at all.
      expect(rule.class, `${key} is ${rule.class} and firmDb() already reaches it`).not.toBe(
        'firm',
      );
    }
  });

  test('every column in the vocabulary exists on its table AND is declared unique in schema.ts', () => {
    for (const [key, columns] of Object.entries(PUBLIC_LOOKUP_ADDRESS)) {
      const table = TABLES[key as TableKey] as PgTable;
      const properties = getTableColumns(table) as unknown as Record<string, { name: string }>;
      const sqlNames: string[] = [];
      for (const property of columns) {
        const column = properties[property];
        expect(column, `${key}.${property} is not a column of that table`).toBeDefined();
        sqlNames.push((column as { name: string }).name);
      }
      const keys = uniqueKeys(key as TableKey).map((k) => [...k].sort().join(','));
      expect(keys, `${key} does not declare (${sqlNames.join(', ')}) unique`).toContain(
        [...sqlNames].sort().join(','),
      );
    }
  });

  test('the two pre-session vocabularies share no table, so neither door inherits the other', () => {
    // ASSERTED RATHER THAN LEFT TO READ AS OBVIOUS. `RESOLUTION_ADDRESS` and
    // `PUBLIC_LOOKUP_ADDRESS` are both lists of tables reachable without a
    // session, and the day one name appears on both, a caller holding either
    // handle can address that table for a reason only one of the two doors was
    // argued for.
    const resolvable = new Set(Object.keys(RESOLUTION_ADDRESS));
    const publicly = Object.keys(PUBLIC_LOOKUP_ADDRESS);
    expect(publicly.filter((key) => resolvable.has(key))).toEqual([]);
  });
});
