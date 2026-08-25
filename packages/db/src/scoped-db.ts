// =============================================================================
// packages/db/src/scoped-db.ts
// =============================================================================
// THE ONE SANCTIONED DATA IDIOM. ADR-008 is `accepted` and made this wrapper
// "part of the acceptance, not a follow-up"; the ESLint half (VG-4) shipped on
// 2026-08-13 and this half is what ADR-084 lands.
//
// THE ACCESSOR NEVER RETURNS A RAW HANDLE. `client()` is not re-exported from
// the package, so for every caller outside this directory "reach the database"
// and "choose a scope" are the SAME ACT. That is what bounds the BOLA blast
// radius: the scope is applied in ONE PLACE rather than remembered at each call
// site, and "forgot to scope" is not an available mistake.
//
// TWO REFUSALS ARE COMPILE ERRORS AND BOTH ARE WATCHED FAILING TO COMPILE in
// `scripts/ci/falsify-ci.mjs` at stage CI-01. They are at CI-01 and not in the
// vitest suite for the reason that file already states about the engine's R-17
// case: vitest "runs transpiled code and a type error is simply gone by then".
//
//   1. A `firm` table passed to `scopedDb(...).rows()` -- `treasury_balances`
//      and `liability_snapshots` are not members of `ScopedTableKey`.
//   2. `systemDb(...)` assigned to a `ScopedDb` -- the brands are disjoint, so
//      an unscoped handle cannot be smuggled into a function that asked for a
//      scoped one.
//
// "FORGOT TO SCOPE" BECOMES "WROTE THE WORD SYSTEM", which is a diff a reviewer
// reads. `systemDb` takes a REASON from a closed two-member vocabulary rather
// than a boolean or a comment, so the legitimate unscoped readers are a list
// somebody has to join.

import { and, eq, exists, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';

import { client } from './client.ts';
import { SCOPE_RULES, TABLES, type ScopedTableKey, type TableKey } from './scope.ts';

/** The identity every scoped query is bound to. */
export type IdentityId = string & { readonly __brand: 'IdentityId' };

/**
 * Resolve a rule's SQL column name to the Drizzle column object.
 *
 * The rule names the column in SQL because the rule is a statement ABOUT THE
 * DATABASE, and this is the one place that resolution happens. It throws rather
 * than returning undefined: a rule naming a column that does not exist is a
 * defect in the registry, and the suite asserts every rule's columns resolve for
 * all seven tables so the throw is unreachable in a green tree.
 */
function columnByName(table: PgTable, sqlName: string): PgColumn {
  const columns = table as unknown as Record<string, PgColumn>;
  for (const key of Object.keys(columns)) {
    const candidate = columns[key];
    if (candidate !== undefined && candidate.name === sqlName) return candidate;
  }
  throw new Error(
    `scope registry names column "${sqlName}", which does not exist on this table. ` +
      'The registry and the schema have drifted.',
  );
}

/**
 * The scope predicate for one table, as SQL.
 *
 * DERIVED FROM THE RULE RATHER THAN WRITTEN TWICE. A hand-written predicate per
 * table would be a second statement of the registry, which is the drift class
 * this package exists to keep to one.
 *
 * `derived` recurses into the table it reaches through, and the recursion
 * terminates because every chain ends at `owned` or `root`.
 *
 * BUILT WITH A STANDALONE `QueryBuilder` AND NOT WITH `client()`, so that
 * constructing a predicate NEEDS NO CONNECTION. The unit suite asserts the SQL
 * of all seven rules without a database, which it could not do if predicate
 * construction opened a pool -- and a scope rule nobody can assert cheaply is a
 * scope rule nobody asserts.
 */
export function scopePredicate(key: TableKey, identityId: IdentityId): SQL {
  const rule = SCOPE_RULES[key];
  const table = TABLES[key] as PgTable;

  switch (rule.class) {
    case 'root':
      return eq(columnByName(table, rule.column), identityId);

    case 'owned':
      // A NULLABLE identity column needs NO second predicate. SQL NULL never
      // equals anything, so `ledger_accounts`' firm rows fall out of `= $1` on
      // their own. Adding `IS NOT NULL` here would look careful and assert
      // nothing.
      return eq(columnByName(table, rule.column), identityId);

    case 'derived': {
      // BOTH TRAVERSALS COMPILE TO `EXISTS`, and the `traversal` field is not
      // decorative for it. A `hop` is single-valued so an inner join would ALSO
      // be correct; a `semi-join` is one-to-many in the direction traversed, so
      // a join would return this row ONCE PER MATCHING CHILD. EXISTS is correct
      // for both and cannot multiply either.
      //
      // The field is CHECKED rather than trusted: the suite asserts that every
      // `hop` names the via table's primary key and every `semi-join` does not,
      // so a rule mislabelled as a hop is a test failure rather than a comment
      // nobody reads.
      const via = TABLES[rule.via] as PgTable;
      return exists(
        new QueryBuilder()
          .select({ one: sql`1` })
          .from(via)
          .where(
            and(
              eq(columnByName(via, rule.foreignColumn), columnByName(table, rule.localColumn)),
              scopePredicate(rule.via, identityId),
            ),
          ),
      );
    }

    case 'firm':
      // UNREACHABLE THROUGH THE SCOPED ACCESSOR, because `ScopedTableKey`
      // excludes these keys and `rows()` accepts nothing else. The throw is the
      // runtime half of a refusal whose real enforcement is the type, kept so
      // that a caller reaching this through a cast still fails loudly.
      throw new Error(
        `${key} belongs to no identity (${rule.why}) and has no scoped reading. ` +
          'Use systemDb(reason) and say which reason.',
      );
  }
}

/**
 * The scoped accessor. Every query in the system goes through one of these.
 */
export interface ScopedDb {
  readonly __brand: 'ScopedDb';
  readonly identityId: IdentityId;
  /**
   * Rows of one table, already carrying this identity's scope.
   *
   * A `firm` table here is a COMPILE ERROR: `ScopedTableKey` excludes them.
   */
  rows<K extends ScopedTableKey>(key: K): Promise<unknown[]>;
}

/** The two legitimate unscoped readers. A closed vocabulary, not a boolean. */
export type SystemReason = 'nightly-batch' | 'operator-console';

/**
 * The unscoped accessor.
 *
 * ITS BRAND IS DISJOINT FROM `ScopedDb`'S, so it is NOT ASSIGNABLE to one. That
 * is the second compile-time refusal: a function that asked for a scoped handle
 * cannot be handed this by accident, only by a cast somebody has to write.
 */
export interface SystemDb {
  readonly __brand: 'SystemDb';
  readonly reason: SystemReason;
  rows<K extends TableKey>(key: K): Promise<unknown[]>;
}

/**
 * Every query, scoped to one identity.
 */
export function scopedDb(identityId: IdentityId): ScopedDb {
  return {
    __brand: 'ScopedDb',
    identityId,
    async rows<K extends ScopedTableKey>(key: K): Promise<unknown[]> {
      return client()
        .select()
        .from(TABLES[key] as PgTable)
        .where(scopePredicate(key, identityId));
    },
  };
}

/**
 * The unscoped reader, for the two cases that are legitimately firm-wide.
 *
 * `'nightly-batch'`     Appendix B.5 partitions across EVERY account, and
 *                       `ports.ts` already declares `accountsWithStoredState()`
 *                       "for EVERY account that has ever existed". A per-identity
 *                       scope is not a smaller version of that job.
 * `'operator-console'`  The admin liability dashboard. `liability_snapshots` is
 *                       EC-095's three named numbers and is firm BY CONSTRUCTION.
 */
export function systemDb(reason: SystemReason): SystemDb {
  return {
    __brand: 'SystemDb',
    reason,
    async rows<K extends TableKey>(key: K): Promise<unknown[]> {
      return client()
        .select()
        .from(TABLES[key] as PgTable);
    },
  };
}
