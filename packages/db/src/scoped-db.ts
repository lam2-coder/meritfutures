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
//
// THIS FILE HAS BEEN WIDENED FOUR TIMES AND NARROWED ONCE, AND ADR-230 IS THE
// FOURTH WIDENING. ADR-084 built the two read doors; ADR-102 added the write
// path; ADR-112 NARROWED it, deleting six writes that could not name a row;
// ADR-126 added the resolution door and `insertUnder`. ADR-157 adds a filter
// TERM (a range and an `IS NULL`, on reads only), and a ROW LOCK. What ADR-157
// does NOT add is an aggregate, a join, a `SqlExecutorReason` member or a
// `SystemReason` member, and P7 section 10 item 1 asked for the first of those
// by name: that entry's section 5 is the argument and it is a refusal on
// evidence rather than on scope.
//
// ADR-230 ADDS `insertAsParty`, AND WHAT MAKES IT THE NARROWEST WIDENING IN THIS
// LIST IS WHAT IT DOES NOT ADD. No key joins `ScopedTableKey`. No key leaves
// `PairTableKey`. `scopePredicate` still throws on every `pair` key, so NOTHING
// BECOMES READABLE. The method INSERTS one row of one class, into the one table
// whose registry rule declares `writer.by === 'party'`, with the writer's own
// identity STAMPED into the column that rule names and refused to the caller --
// so a handler party to one pair cannot write a row for another, and it cannot
// because there is no parameter through which it could. It builds no
// `RETURNING` clause, which is why ADR-106's disclosure ground is absent rather
// than outweighed: the transaction hands the caller back no column at all.

import {
  and,
  eq,
  exists,
  getTableColumns,
  gte,
  isNull as isNullColumn,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  QueryBuilder,
  getTableConfig,
  type PgColumn,
  type PgDatabase,
  type PgQueryResultHKT,
  type PgTable,
} from 'drizzle-orm/pg-core';
import type { Pool, PoolClient } from 'pg';

import { client } from './client.ts';
import * as schema from './schema.ts';
import {
  SCOPE_RULES,
  TABLES,
  type FirmTableKey,
  type PairTableKey,
  type ScopeRule,
  type ScopedTableKey,
  type TableKey,
} from './scope.ts';

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

    case 'either': {
      // THE DISJUNCTION, AND IT IS THE RULING RATHER THAN A CONVENIENCE
      // (ADR-191). The row reaches an identity through its OWN nullable identity
      // column OR through a nullable foreign key to a row that carries one, and
      // which of the two is a fact about the ROW. Serving one leg drops the
      // other half of the table in silence, which is the `owned` failure with a
      // new name.
      //
      // A ROW REACHING NEITHER LEG FALLS OUT WITH NO THIRD PREDICATE. SQL NULL
      // never equals anything, so the equality drops the firm rows and the
      // EXISTS drops them again. Adding `IS NOT NULL` here would look careful
      // and assert nothing, which is `ledger_accounts`' sentence one class over.
      //
      // NO PRECEDENCE BETWEEN THE LEGS. Guarding the EXISTS with
      // `identity_id IS NULL` would stop a row ever reaching two identity uuids,
      // and it is refused: the rows on which the legs disagree are the rows a
      // HARD MERGE produces, where the two uuids are ONE PERSON, and the guard
      // would hide a merged person's account-level history from the survivor.
      // The `EitherRule` docblock carries the argument.
      const via = TABLES[rule.via] as PgTable;
      const disjunction = or(
        eq(columnByName(table, rule.column), identityId),
        exists(
          new QueryBuilder()
            .select({ one: sql`1` })
            .from(via)
            .where(
              and(
                eq(columnByName(via, rule.foreignColumn), columnByName(table, rule.localColumn)),
                scopePredicate(rule.via, identityId),
              ),
            ),
        ),
      );
      // REFUSED RATHER THAN CAST. `or` is typed `SQL | undefined` because it
      // returns `undefined` when EVERY argument is, which cannot happen here:
      // both legs are constructed on the two lines above. A cast would say the
      // same thing and say it in the one direction that is silent if it ever
      // stops being true -- an unscoped read, which is what this file exists to
      // make impossible.
      if (disjunction === undefined) {
        throw new Error(
          `${key} is registered "either" and its disjunction constructed no predicate. ` +
            'A scoped read with no predicate is an unscoped read. The registry and this ' +
            'builder have drifted.',
        );
      }
      return disjunction;
    }

    case 'pair':
      // UNREADABLE THROUGH THE SCOPED ACCESSOR, AND NOT FOR `firm`'s REASON
      // (ADR-106). THIS COMMENT SAID "UNREACHABLE" AND ADR-230 MOVED THE WORD
      // RATHER THAN THE BEHAVIOUR: `insertAsParty` can WRITE one row of a `pair`
      // table whose rule declares `writer.by === 'party'`, and it reaches this
      // function never, because an INSERT has no `WHERE` clause to carry a
      // predicate into. Every path that READS a pair row still arrives here and
      // still throws.
      //
      // A predicate EXISTS here and is deliberately not built:
      // `columnA = $1 OR columnB = $1` returns precisely the rows that are this
      // person's, and every one of them carries the OTHER party's identity uuid
      // out of a NOT NULL column. That is the cross-identity read
      // `correlation_groups` is already refused for at arity three, and it is
      // worse at arity two. `PairTableKey` is excluded from `ScopedTableKey`, so
      // this throw is the runtime half of a type refusal, and it is ALSO excluded
      // from `FirmTableKey`: `firmDb()` takes no reason because no identity is at
      // risk, and here two are.
      throw new Error(
        `${key} belongs to TWO identities (${rule.why}) and has no scoped reading: ` +
          'returning the row to either party hands them the other one. Use ' +
          'systemDb(reason) and say which reason.',
      );

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

// =============================================================================
// THE WRITE PATH (ADR-102)
// =============================================================================
// A READ SCOPES WITH A `WHERE` CLAUSE AND AN INSERT HAS NONE. That single
// asymmetry is the whole shape of everything below it.
//
// `scopePredicate` bounds a read because a read is a filter: the wrong predicate
// returns the wrong rows and the caller sees somebody else's data. A write has
// the same failure mode arriving on the side that DESTROYS rather than leaks --
// an `UPDATE` or `DELETE` that forgets the predicate reaches every identity's
// rows, and a row written under the wrong identity is a corruption no later read
// can tell apart from an honest one. ADR-008 scoped this wrapper to bound the
// first; ADR-102 rules that the second goes through the same one place.
//
// -----------------------------------------------------------------------------
// THERE IS NO NON-TRANSACTIONAL WRITE, AND `packages/queue` ALREADY RULED THIS
// -----------------------------------------------------------------------------
// `scopedDb(id)` and `systemDb(reason)` are UNCHANGED and remain READ ONLY. A
// write is reached only through `transaction(handle, fn)`, which hands the
// callback the same authority with the write methods attached.
//
// This is `job-queue.ts`'s own ruling applied to the accessor. That file states
// it in its header: "THE AWKWARD ONE TO WRITE IS THE NON-TRANSACTIONAL ONE...
// There is no `enqueueNow`, no optional transaction and no ambient default: a
// caller with no state change to join opens a transaction around the single
// insert, which is one line and is correct." ADR-006's central consequence is
// that enqueue participates in the SAME transaction as the state change that
// caused it, and a `scopedDb(id).insert(...)` reachable outside a transaction is
// that consequence made optional at every call site that forgets it.
//
// IT ALSO COSTS ADR-084's TWO WATCHED REFUSALS NOTHING. `CI-01`'s brand seed
// declares a value carrying exactly `__brand`, `reason`, `identityId` and
// `rows()` and demands that `__brand` is what refuses it. A required method
// added to `ScopedDb` would make TypeScript report a MISSING PROPERTY instead,
// and the seed would pass on the wrong evidence. The read interfaces do not
// move, so the seed keeps proving what it was written to prove.
//
// -----------------------------------------------------------------------------
// THE TENANCY COLUMN IS NEVER THE CALLER'S TO NAME
// -----------------------------------------------------------------------------
// ADR-101 refuses a `derived` rule on a row that carries its own identity
// column, because such a rule answers a DIFFERENT question from the one the
// column answers. A write accessor that let a caller supply its own tenancy
// value would route around exactly that: the registry would say how a row
// reaches an identity and the call site would say something else. So on the
// scoped path the identity is STAMPED from the handle on insert, and naming the
// tenancy column in an insert's values or an update's `SET` is refused.

/**
 * Tables the scoped writer will INSERT into.
 *
 * `owned` ONLY, and the three exclusions are three different reasons.
 *
 * `root` is `identities` and inserting one CREATES an identity. A handle already
 * bound to an identity has no correct row to write there.
 *
 * `derived` rows carry NO tenancy column, so there is nothing to stamp. The
 * tenancy is the parent's, and the accessor cannot establish that the parent is
 * this identity's without reading it -- which inside a transaction is a `SELECT`
 * the caller could have skipped and outside one is a race. The construction that
 * WOULD serve it is named in ADR-102 section 4 and is not built here.
 *
 * `firm` is already excluded from `ScopedTableKey`.
 */
export type OwnedTableKey = {
  [K in TableKey]: (typeof SCOPE_RULES)[K]['class'] extends 'owned' ? K : never;
}[TableKey];

/**
 * Every column ON THIS ROW that the scope rule reads. Empty for `firm`, which is
 * the class that reads no column because no identity owns the row.
 *
 * DERIVED FROM THE RULE AND NEVER LISTED, for the reason ADR-101 section 6
 * gives about restating the DDL: a second statement of which column carries
 * tenancy is a second thing to keep true.
 *
 * IT RETURNS A LIST BECAUSE ADR-106's `pair` CLASS HAS TWO, and `tenancyColumn`
 * below reads this one switch rather than restating it. A `pair` row is never
 * reachable through `scopedTx`, but it IS reachable through `systemTx`, whose
 * `update` runs through `refuseTenancyColumn` like every other -- and moving
 * `identity_a` on an APPEND-ONLY edge table is the re-parenting ADR-102 clause 4
 * refuses, arriving on the one class that has two columns to move.
 */
export function tenancyColumns(key: TableKey): readonly string[] {
  const rule = SCOPE_RULES[key];
  switch (rule.class) {
    case 'root':
    case 'owned':
      return [rule.column];
    case 'derived':
      // The row reaches its identity THROUGH this column. Re-pointing it moves
      // the row to another identity's subtree, which the scope predicate cannot
      // see because the predicate ran against the value the row had BEFORE.
      return [rule.localColumn];
    case 'pair':
      // BOTH, and neither is more the tenancy than the other. ADR-106.
      return [rule.columnA, rule.columnB];
    case 'either':
      // BOTH, and for a REASON THE `pair` CASE DOES NOT HAVE (ADR-191). A pair
      // row's two columns are two halves of one answer; an `either` row's two
      // are two answers of which the row uses one. Re-pointing EITHER moves the
      // row: `identity_id` moves it directly, and `account_id` moves it into
      // whichever identity owns the account it is repointed at. `events` is
      // APPEND-ONLY by 0017's own comment, so both are refused to `systemTx`'s
      // `update` and neither is reachable through `scopedTx` at all.
      return [rule.column, rule.localColumn];
    case 'firm':
      return [];
  }
}

/**
 * The SINGLE tenancy column, for the classes that have exactly one.
 *
 * `undefined` for `firm`, which has none, and `undefined` for `pair`, which has
 * two -- so the one caller that STAMPS a column (`scopedInsertStatement`, whose
 * key type is `OwnedTableKey`) cannot be handed a table it would have to guess
 * about. It reads `tenancyColumns` rather than a second switch, so the two
 * cannot disagree.
 */
export function tenancyColumn(key: TableKey): string | undefined {
  const columns = tenancyColumns(key);
  return columns.length === 1 ? columns[0] : undefined;
}

/** The Drizzle property name for a SQL column name, or `undefined`. */
function propertyForColumn(table: PgTable, sqlName: string): string | undefined {
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (column.name === sqlName) return property;
  }
  return undefined;
}

/**
 * Refuse a values object that names the tenancy column.
 *
 * BOTH SPELLINGS ARE REFUSED. The values object is keyed by Drizzle PROPERTY
 * names and the registry names the SQL column, so a caller can reach the same
 * column two ways and only one of them looks like the registry's word.
 *
 * THIS IS A THROW AND NOT A TYPE, stated rather than left to be discovered.
 * Making it a compile error means deriving the property name from
 * `TABLES[K]`'s column map inside a conditional type, over ninety-two tables, on
 * every call site -- and the refusal it buys is one a runtime can see perfectly
 * well because the offending key is a string at the moment it is passed. The
 * suite watches it throwing. ADR-084's `firm` refusal went the other way for the
 * opposite reason: a table KEY is a literal type and a runtime never sees it at
 * all until the query runs.
 */
function refuseTenancyColumn(key: TableKey, values: Readonly<Record<string, unknown>>): void {
  // EVERY tenancy column and not the first one. ADR-106's `pair` class carries
  // two, and a guard that checked one of them would refuse `identity_a` and let
  // `identity_b` through on the same row.
  for (const sqlName of tenancyColumns(key)) {
    const property = propertyForColumn(TABLES[key] as PgTable, sqlName);
    for (const named of Object.keys(values)) {
      if (named !== sqlName && named !== property) continue;
      throw new Error(
        `"${named}" is ${key}'s tenancy column (${SCOPE_RULES[key].class} rule on "${sqlName}") ` +
          'and a scoped write never takes it from the caller. The handle supplies it on insert, ' +
          'and an update that moved it would hand the row to another identity behind a predicate ' +
          'that already matched.',
      );
    }
  }
}

/**
 * The narrow slice of a Drizzle handle every statement below is built on.
 *
 * NAMED SO THE STATEMENTS CAN BE RENDERED WITHOUT A DATABASE, which is the same
 * reason `scopePredicate` builds on a standalone `QueryBuilder`. `ci.yml`'s
 * `integration` job runs on bare `ubuntu-latest` with no services block, so
 * there is no Postgres in CI to write to; the suite asserts the SQL these
 * builders PRODUCE against a driverless handle, and a write the suite cannot
 * execute is stated as unexecuted rather than implied to have run.
 */
export type StatementSource = Pick<
  PgDatabase<PgQueryResultHKT, Record<string, never>>,
  'select' | 'insert' | 'update' | 'delete'
>;

/** One row of a write, keyed by Drizzle property name. */
export type WriteValues = Readonly<Record<string, unknown>>;

/**
 * INSERT, with the identity STAMPED rather than accepted.
 *
 * The caller's values are spread FIRST and the tenancy column written after, so
 * the stamp is the last word -- but a caller that named it has already been
 * refused by `refuseTenancyColumn`, because silently overwriting a value
 * somebody wrote is how a wrong belief survives a code review.
 */
export function scopedInsertStatement(
  source: StatementSource,
  key: OwnedTableKey,
  identityId: IdentityId,
  values: WriteValues,
): ReturnType<ReturnType<StatementSource['insert']>['values']> {
  refuseTenancyColumn(key, values);
  refuseTermInValues(key, values);
  const table = TABLES[key] as PgTable;
  const sqlName = tenancyColumn(key);
  if (sqlName === undefined) throw new Error(`${key} has no tenancy column and cannot be stamped.`);
  const property = propertyForColumn(table, sqlName);
  if (property === undefined) {
    throw new Error(
      `scope registry names column "${sqlName}" on ${key}, which does not exist on this table. ` +
        'The registry and the schema have drifted.',
    );
  }
  return source.insert(table).values({ ...values, [property]: identityId });
}

/** INSERT with no scope. The caller's values are the whole row. */
export function unscopedInsertStatement(
  source: StatementSource,
  key: TableKey,
  values: WriteValues,
): ReturnType<ReturnType<StatementSource['insert']>['values']> {
  refuseTermInValues(key, values);
  return source.insert(TABLES[key] as PgTable).values(values);
}

// =============================================================================
// ADDRESSING ONE ROW (ADR-112)
// =============================================================================
// ADR-102 GAVE THIS FILE A WRITE AND NOT A PLACE TO POINT IT. Every method it
// landed narrows by tenancy or by nothing at all, so a caller that has to name
// ONE ROW is refused identically at all three authorities: ADR-109 clause 2
// found that from the idempotency layer, session 222 found it from the
// provisioning saga, session 218 found it from the auth surface, and clause 2
// says in its own words that it does not design the repair. This is the repair.
//
// -----------------------------------------------------------------------------
// A PREDICATE IS AN EQUALITY CONJUNCTION OVER DECLARED COLUMNS, NEVER A `SQL`
// -----------------------------------------------------------------------------
// The obvious shape is "let the caller pass a `SQL` fragment" and it is the
// wrong one. It hands every call site the ability to write ANY predicate, which
// is the BOLA surface ADR-008 scoped this wrapper to bound and the same
// admission ADR-102 refused to make about `executeSql` -- and it is worse here
// than there, because a raw-SQL call site is a diff a reviewer notices and a
// predicate passed to `updateAt` reads like ordinary accessor use.
//
// `byId(id)` was the other candidate and it is refused ON EVIDENCE. It does not
// serve the table ADR-109 exists for: `idempotency_keys`' primary key is `key`
// (`0017_events_and_audit.sql`), `treasury_balances`' is `(account_code,
// as_of)`, and THIRTEEN registered tables carry a composite primary key. An
// accessor whose addressing idiom fails on the first table that needs it is not
// an addressing idiom.
//
// -----------------------------------------------------------------------------
// A WRITE TAKES AN ADDRESS, A READ MAY TAKE A FILTER, AND THAT ASYMMETRY IS THE
// RULING RATHER THAN A CONVENIENCE
// -----------------------------------------------------------------------------
// An ADDRESS is a filter whose named columns CONTAIN a unique key the schema
// declares, so an addressed write names AT MOST ONE ROW BY CONSTRUCTION rather
// than by the caller's care. A FILTER carries no such requirement and may only
// READ, because a filtered read is a NARROWING of a read that already exists at
// the same authority -- `scopedTx.rows` already returns every row this identity
// owns and `systemTx.rows` already returns every row in the table, and a
// conjunct can only remove rows from either. A filtered WRITE at non-unique
// columns is different in kind: the unaddressed write is REMOVED below, so
// there is no wider method for it to narrow, and admitting one would put back a
// smaller copy of the defect this section exists to close.

/** The Drizzle property names of one table's columns, as a type. */
type ColumnsOf<K extends TableKey> = (typeof TABLES)[K]['_']['columns'];

/**
 * A column of one table, by its Drizzle property name.
 *
 * DERIVED FROM `TABLES` AND NEVER LISTED. A caller naming a column this table
 * does not have is `TS2353` at the call site rather than a run-time surprise,
 * and the list cannot go stale because there is no list.
 */
export type AddressableColumn<K extends TableKey> = Extract<keyof ColumnsOf<K>, string>;

/**
 * A narrowing over declared columns. Equality or a TERM, ANDed, and nothing else.
 *
 * THIS SENTENCE MOVED ONCE AND ADR-157 IS THE ARGUMENT THAT MOVED IT. It read
 * "Equality, ANDed, and nothing else. There is no `OR`, no `IN`, no range and no
 * `IS NULL`, and each absence is the same decision", and it named its own way
 * out in the next clause: "every one of them is a diff on this file with an
 * argument attached when a caller needs it". P5 is the phase whose work is jobs
 * and money, a job is a range query over a clock, and `readLiveHalts` in
 * `packages/ledger` has been paying for the missing null term on every posting
 * since it was written.
 *
 * TWO OF THE FOUR ABSENCES ARE NOW ADMISSIONS AND TWO ARE STILL ABSENCES. A
 * range and an `IS NULL` are `FilterTerm`s below. `OR` and `IN` are not, and the
 * reason is unchanged: a conjunction can only REMOVE rows from the read the
 * caller already holds at this authority, and a disjunction can add them back.
 * That is the whole of why a term is safe here and a `SQL` fragment is not.
 *
 * A TERM READS AND NEVER WRITES. `RowAddress` is the same TypeScript type and a
 * different promise, and `addressPredicate` refuses a term at run time on every
 * write path and on every addressed read, because a term cannot name one row.
 */
export type RowFilter<K extends TableKey> = Readonly<
  Partial<Record<AddressableColumn<K>, unknown>>
>;

/**
 * A filter that names AT MOST ONE ROW.
 *
 * THE SAME TYPE AS `RowFilter` AND A DIFFERENT PROMISE, and the promise is
 * CHECKED AT RUN TIME rather than encoded. Uniqueness is a fact about the
 * DATABASE -- which column sets carry a `PRIMARY KEY` or a `UNIQUE` -- and
 * `tsc` cannot read a migration, which is ADR-101 section 6's own reason for
 * the same shape. `refuseUnaddressed` reads it from `schema.ts` through
 * Drizzle's own table config, so the check is derived from the transcription of
 * the DDL rather than from a second list somebody maintains.
 *
 * A `FilterTerm` IN AN ADDRESS IS REFUSED AT RUN TIME AND NOT BY `tsc`, and
 * ADR-157 states which half is which rather than letting a reader assume the
 * type carries it. The value position is `unknown` because a column may hold a
 * `Date`, a `bigint`, a `Buffer` or a row of JSON, and narrowing it to exclude a
 * term would refuse legitimate values on every table in the registry. So the
 * refusal is a throw, in `addressPredicate`, on the one path every write and
 * every addressed read already share.
 */
export type RowAddress<K extends TableKey> = RowFilter<K>;

/**
 * A filter that names at least one column. An empty one does not compile.
 *
 * `{}` as a literal resolves `keyof F` to `never` and the parameter type to
 * `never`, so `TS2345` refuses it. A caller casting past that still meets the
 * throw in `addressPredicate`, because an empty address is the whole-table
 * write under another name.
 */
export type NamesAColumn<K extends TableKey, F extends RowFilter<K>> = keyof F extends never
  ? never
  : F;

// -----------------------------------------------------------------------------
// A FILTER TERM: THE TWO ABSENCES THAT BECAME ADMISSIONS (ADR-157)
// -----------------------------------------------------------------------------
// ADR-112 refused a range and an `IS NULL` on ONE argument -- "a shape a caller
// can compose freely is a shape a caller can compose wrongly" -- and named the
// price of lifting it: a diff on this file with an argument attached. P5 is that
// argument arriving. `P5-j` sweeps three expiry clocks on two tables and its
// whole query is `freeze_expires_at <= now()`; `readLiveHalts` cannot say
// `released_at IS NULL` and so reads every halt row ever released, on every
// posting, and says so in its own header.
//
// A TERM IS A CLOSED VOCABULARY OF SHAPES, WHICH IS ADR-126 CLAUSE 3's MOVE ON A
// PREDICATE RATHER THAN ON A DOOR. `SystemReason` and `SqlExecutorReason` are
// closed vocabularies of WHY and every member of either grants every table; this
// is a closed vocabulary of HOW ONE COLUMN NARROWS, and every member of it
// removes rows from a read the caller already holds. Joining it is a diff on
// this file, which is the same control at a strictly smaller radius.
//
// THREE CONSTRUCTORS AND NO OTHER PRODUCER. `atMost`, `atLeast` and `isNull` are
// the only functions in this workspace that mint a term, and a term is
// recognised by IDENTITY rather than by shape: `TERMS` is a `WeakSet` holding
// every object those three returned. That is not fastidiousness. `RowFilter`'s
// value position is `unknown` because a column may hold a row of JSON, so a
// shape check would read `{ term: 'at-most', value: 1 }` sitting in a `jsonb`
// column as a term and silently turn an equality into a range. A caller cannot
// hand-roll one, cannot smuggle a `SQL` through one, and cannot receive one
// across a process boundary, because nothing that crossed a boundary is in the
// set.
//
// WHAT IS STILL REFUSED, and each is one line here with an argument attached the
// day a caller has one: `OR`, `IN`, a STRICT inequality, `IS NOT NULL`, `LIKE`,
// and any term at all on the write path. The first two are refused on the
// argument this section opens with and it is unchanged. The third is refused
// because no P5 caller has one: a cursor over `wallet_entries` is `P5-g`'s and
// an inclusive bound re-reads its boundary row, so if that is unacceptable it is
// an argument `P5-g` makes rather than one this entry makes for it.

/**
 * One column's narrowing when it is not an equality. A closed vocabulary.
 *
 * `at-most` and `at-least` are INCLUSIVE, which is the only reading of "a range
 * term" that a clock sweep and a backfill both want, and `<=` is what
 * `freeze_expires_at <= now()` says.
 *
 * `is-null` CARRIES NO VALUE, and that is the shape refusing the wrong question:
 * `col = NULL` matches nothing and `col IS NULL` is not an equality at all,
 * which is why `addressPredicate` refused a null value outright before this
 * existed and still does.
 */
export type FilterTerm =
  | { readonly term: 'at-most'; readonly value: unknown }
  | { readonly term: 'at-least'; readonly value: unknown }
  | { readonly term: 'is-null' };

/**
 * Every term this module has minted.
 *
 * IDENTITY AND NOT SHAPE, for the reason the section header states: a `jsonb`
 * column holding an object that looks like a term is a VALUE, and a shape check
 * would read it as a range. A `WeakSet` is used rather than a `Set` so a term a
 * caller built and dropped is collectable.
 */
const TERMS = new WeakSet<object>();

/** Freeze it, record it, return it. The three constructors below are its only callers. */
function mintTerm<T extends FilterTerm>(shape: T): T {
  Object.freeze(shape);
  TERMS.add(shape);
  return shape;
}

/**
 * `column <= value`. The bound is INCLUSIVE and the value is the CALLER'S.
 *
 * THE CLOCK IS THE PROCESS'S AND NEVER THE DATABASE'S, and that is a design
 * decision rather than an accident of the shape. A term renders `col <= $1` with
 * a bound parameter, so a sweep passes the time it decided to sweep at and a
 * fixture passes a fixed one. Rendering `now()` would put the database's clock
 * in a money path that MERIT_BUILD_MASTER_PROMPT keeps as data, and would make
 * every expiry test unwritable.
 *
 * `NonNullable<unknown>` REFUSES A NULL BOUND AT THE CALL SITE, and the throw
 * below catches the cast that gets past it. A bound of null matches nothing.
 */
export function atMost(value: NonNullable<unknown>): FilterTerm {
  return mintTerm({ term: 'at-most', value: refuseNullBound(value, 'atMost') });
}

/** `column >= value`. Inclusive, and `atMost`'s argument in the other direction. */
export function atLeast(value: NonNullable<unknown>): FilterTerm {
  return mintTerm({ term: 'at-least', value: refuseNullBound(value, 'atLeast') });
}

/**
 * `column IS NULL`.
 *
 * A FRESH OBJECT PER CALL rather than a shared constant, because membership of
 * `TERMS` is what makes a term a term and a frozen singleton would work equally
 * well right up until somebody exported it.
 */
export function isNull(): FilterTerm {
  return mintTerm({ term: 'is-null' });
}

/** Whether a filter value is a term this module minted. The only reader of `TERMS`. */
export function isFilterTerm(candidate: unknown): candidate is FilterTerm {
  return typeof candidate === 'object' && candidate !== null && TERMS.has(candidate);
}

/** The run-time half of `NonNullable<unknown>`, for the caller that cast past it. */
function refuseNullBound(value: unknown, constructor: string): unknown {
  if (value === null || value === undefined) {
    throw new Error(
      `${constructor}(${value === null ? 'null' : 'undefined'}) is not a bound. A comparison ` +
        'against NULL matches nothing, so a null bound is a filter that silently returns no ' +
        'rows rather than the filter somebody meant to write.',
    );
  }
  return value;
}

/** The SQL one term renders against one resolved column. */
function termConjunct(key: TableKey, property: string, column: PgColumn, of: FilterTerm): SQL {
  switch (of.term) {
    case 'at-most':
      return lte(column, of.value);
    case 'at-least':
      return gte(column, of.value);
    case 'is-null':
      return isNullColumn(column);
    default: {
      // A member added to `FilterTerm` without a case here is `TS2322` on this
      // line, so the vocabulary and its renderer cannot drift apart.
      const unreachable: never = of;
      throw new Error(
        `"${String((unreachable as { term?: unknown }).term)}" is not a term shape on ` +
          `${key}.${property}.`,
      );
    }
  }
}

/** Memoised per table: building this reads Drizzle's table config. */
const UNIQUE_KEYS = new Map<TableKey, readonly (readonly string[])[]>();

/**
 * Every column set this table declares UNIQUE, in SQL names, each one sorted.
 *
 * READ FROM THE SCHEMA AND NEVER LISTED HERE, on `scopePredicate`'s own
 * precedent: a hand-written roster of unique keys would be a second statement
 * of the DDL, which is the drift class this package exists to keep to one.
 *
 * FOUR SOURCES, BECAUSE DRIZZLE SPELLS A KEY FOUR WAYS: an inline
 * `.primaryKey()`, a table-level `primaryKey({ columns })`, an inline
 * `.unique()` and a table-level unique constraint. THIRTEEN of the registered
 * tables use the second spelling, so reading only the first would have refused
 * every address on all thirteen.
 *
 * WHAT IT DOES NOT READ IS A PARTIAL UNIQUE INDEX, and that is deliberate:
 * `idempotency_keys_identity_idx` is `UNIQUE ... WHERE identity_id IS NOT NULL`
 * and bounds the row count only for the rows it covers, so treating it as a key
 * would admit an address that matches two rows on the population it excludes.
 */
export function uniqueKeys(key: TableKey): readonly (readonly string[])[] {
  const cached = UNIQUE_KEYS.get(key);
  if (cached !== undefined) return cached;

  const config = getTableConfig(TABLES[key] as PgTable);
  const found: string[][] = [];
  const inlinePrimary = config.columns.filter((c) => c.primary).map((c) => c.name);
  if (inlinePrimary.length > 0) found.push(inlinePrimary);
  for (const primary of config.primaryKeys) found.push(primary.columns.map((c) => c.name));
  for (const column of config.columns) if (column.isUnique) found.push([column.name]);
  for (const unique of config.uniqueConstraints) found.push(unique.columns.map((c) => c.name));

  const frozen: readonly (readonly string[])[] = found.map((columns) =>
    Object.freeze([...columns].sort()),
  );
  UNIQUE_KEYS.set(key, frozen);
  return frozen;
}

/** The Drizzle column object for a property name, or `undefined`. */
function columnByProperty(table: PgTable, property: string): PgColumn | undefined {
  return (getTableColumns(table) as Record<string, PgColumn>)[property];
}

/**
 * The conjunction one filter renders, with terms admitted or refused.
 *
 * ONE FUNCTION AND ONE `admitTerms` FLAG RATHER THAN TWO WALKS OF THE SAME
 * OBJECT, on `handlePinnedColumns`' own precedent in ADR-112 section 5: the
 * column resolution, the sort, the empty check and the null refusal are the same
 * facts for a filter and for an address, and two copies of them is the drift
 * this package exists to keep to one.
 *
 * THE COLUMNS ARE SORTED, so the rendered SQL of one filter is the same text
 * whatever order the caller wrote its keys in. That is what lets the suite
 * assert the text rather than parse it.
 *
 * A `null` OR `undefined` VALUE IS REFUSED and the reason is not tidiness.
 * Rendered as `col = NULL` it matches nothing, so the write is silently a
 * no-op; rendered as `col IS NULL` it stops bounding the row count, because a
 * unique key over a nullable column admits many NULL rows in Postgres. A caller
 * that MEANS `IS NULL` writes `isNull()`, which is a term and reads only.
 */
function conjunctionOver(
  key: TableKey,
  at: Readonly<Record<string, unknown>>,
  admitTerms: boolean,
): SQL {
  const table = TABLES[key] as PgTable;
  const named = Object.keys(at).sort();
  if (named.length === 0) {
    throw new Error(
      `an empty filter names every row of ${key}, which is the unaddressed write under ` +
        'another name. Name at least one column.',
    );
  }

  const conjuncts: SQL[] = [];
  for (const property of named) {
    const column = columnByProperty(table, property);
    if (column === undefined) {
      throw new Error(
        `"${property}" is not a column of ${key}. A filter names columns by their Drizzle ` +
          'property name, which is what the type accepts.',
      );
    }
    const value = at[property];
    if (isFilterTerm(value)) {
      if (!admitTerms) {
        throw new Error(
          `"${property}" carries a ${value.term} term in an ADDRESS on ${key}. An address names ` +
            'AT MOST ONE ROW and a term names a set, so a term is a read narrowing and never ' +
            'part of an address. Use rowsWhere, or name the row.',
        );
      }
      conjuncts.push(termConjunct(key, property, column, value));
      continue;
    }
    if (value === null || value === undefined) {
      throw new Error(
        `"${property}" is ${value === null ? 'null' : 'undefined'} in a filter on ${key}. ` +
          'Equality against NULL matches nothing and `IS NULL` does not name one row, so a ' +
          'null is refused rather than guessed at. `isNull()` is the term that means it.',
      );
    }
    conjuncts.push(eq(column, value));
  }

  const composed = conjuncts.length === 1 ? conjuncts[0] : and(...conjuncts);
  if (composed === undefined) {
    throw new Error(`the filter on ${key} rendered nothing, which cannot happen with one column.`);
  }
  return composed;
}

/**
 * The EQUALITY conjunction an address renders. A term here is a throw.
 *
 * THIS IS THE ONE PATH EVERY WRITE AND EVERY ADDRESSED READ SHARES, which is
 * why the term refusal lives here rather than at six call sites. ADR-112's
 * foreclosure "an address is equality only" is unmoved by ADR-157 and this
 * function is where it is enforced.
 */
function addressPredicate(key: TableKey, at: Readonly<Record<string, unknown>>): SQL {
  return conjunctionOver(key, at, false);
}

/** The conjunction a FILTER renders. Equality, `atMost`, `atLeast` and `isNull`. */
function filterPredicate(key: TableKey, where: Readonly<Record<string, unknown>>): SQL {
  return conjunctionOver(key, where, true);
}

/**
 * Refuse a term in an INSERT's values or an UPDATE's `SET`.
 *
 * A HAZARD THIS ENTRY CREATES AND THEREFORE CLOSES. Before ADR-157 no caller
 * held an object a filter would treat specially; now one does, and a term
 * handed to `updateAt`'s third argument or to `insert`'s second would be
 * serialised into the column as ordinary JSON. `{ releasedAt: isNull() }` in a
 * `SET` is a caller meaning "clear this column" and getting a row of JSON
 * written into a `timestamptz`, or a silent success on a `jsonb` one.
 */
function refuseTermInValues(key: TableKey, values: Readonly<Record<string, unknown>>): void {
  for (const [property, value] of Object.entries(values)) {
    if (!isFilterTerm(value)) continue;
    throw new Error(
      `"${property}" carries a ${value.term} term in a write to ${key}. A term is a READ ` +
        'narrowing and a values object is a row, so a term here would be written into the ' +
        'column rather than compared against it. To clear a column, write null.',
    );
  }
}

/**
 * Refuse a filter that does not contain a unique key of its table.
 *
 * THE CHECK IS OVER SQL NAMES because the registry and the DDL speak them, and
 * the filter speaks Drizzle property names, so the two are resolved here rather
 * than in either caller.
 *
 * IT FAILS CLOSED IN THE ONE DIRECTION THAT MATTERS AND THAT IS MEASURED. Folded
 * over all 47 migrations, ZERO column sets `schema.ts` declares unique are
 * absent from the DDL, so nothing this admits is unique only in the
 * transcription's imagination. The other direction is live: 34 keys the
 * migrations declare are absent from `schema.ts`, and every one of them is an
 * address this refuses that the database would have honoured. A refused write
 * is not a wrong one. `treasury_balances` is the extreme case and the only
 * registered table with no addressable key at all, because `0009` gives it
 * `PRIMARY KEY (account_code, as_of)` and `schema.ts` declares none.
 */
function refuseUnaddressed(
  key: TableKey,
  at: Readonly<Record<string, unknown>>,
  supplied: readonly string[] = [],
): void {
  const table = TABLES[key] as PgTable;
  const named = new Set<string>(supplied);
  for (const property of Object.keys(at)) {
    const column = columnByProperty(table, property);
    if (column !== undefined) named.add(column.name);
  }

  for (const candidate of uniqueKeys(key)) {
    if (candidate.every((column) => named.has(column))) return;
  }

  const declared = uniqueKeys(key)
    .map((columns) => `(${columns.join(', ')})`)
    .join(', ');
  throw new Error(
    `a write to ${key} must name a row. [${[...named].sort().join(', ')}] contains no unique ` +
      `key ${key} declares, so this predicate can match more than one row. ` +
      (declared === ''
        ? 'That table declares no PRIMARY KEY or UNIQUE in schema.ts, so it has no addressed ' +
          'write at all until the transcription carries the one its migration already has.'
        : `Declared: ${declared}.`),
  );
}

/**
 * The columns the SCOPED HANDLE itself pins to one value.
 *
 * THE CALLER MAY NOT NAME THEM AND THEY COUNT TOWARD THE UNIQUE KEY an address
 * has to contain. Those are two consequences of one fact and this is the one
 * fact.
 *
 * THIS IS THE ONE PLACE THE FIRST DRAFT OF ADR-112 WAS WRONG AND THE TREE SAID
 * SO. Requiring the CALLER's half of the predicate to contain a unique key made
 * `notification_preferences` unaddressable through `scopedTx`, because its
 * primary key is `(identity_id, kind, channel)` and the caller is refused
 * `identity_id` by `refusePinnedColumn`. Four registered tables have that
 * shape. The predicate that reaches the database is the COMPOSITION, so the
 * composition is what must name a row, and the handle's `identity_id = $1` is
 * as much a part of it as the caller's `kind = $2`.
 *
 * `derived` CONTRIBUTES NOTHING and that is not an oversight. Its tenancy
 * narrowing is an `EXISTS` over ANOTHER table; it bounds which rows of this one
 * qualify and pins no column of this row to a value, so it cannot complete a
 * unique key. `pair` is unreachable through `scopedTx` at all.
 *
 * `either` CONTRIBUTES NOTHING EITHER, AND IT IS THE ONE CLASS WHERE THAT LOOKS
 * WRONG (ADR-191). Its predicate names this row's own identity column in an
 * equality, which is exactly the shape `owned` contributes from -- and it is
 * one arm of a DISJUNCTION, so a row satisfying the other arm carries NULL
 * there. The handle therefore fixes that column to no value at all, and
 * counting it toward a unique key would let an address be "complete" while
 * naming a column the matched row does not carry. A rule for this class must
 * read the predicate's SHAPE and never the presence of a column name in it.
 */
function handlePinnedColumns(key: ScopedTableKey): readonly string[] {
  const rule = SCOPE_RULES[key];
  return rule.class === 'root' || rule.class === 'owned' ? [rule.column] : [];
}

/**
 * Refuse a SCOPED filter that names a column the HANDLE HAS ALREADY PINNED.
 *
 * ONE SET, TWO USES, AND THE SECOND DRAFT OF THIS RULING IS WHY THEY ARE ONE.
 * The columns the caller may not name and the columns that count toward the
 * unique key are the SAME columns: the ones the handle's own predicate fixes to
 * a single value. `handlePinnedColumns` is that set and both this guard and
 * `refuseUnaddressed` read it, so the two cannot drift apart.
 *
 * `derived` IS NOT IN IT AND THE FIRST DRAFT HAD IT WRONG. Naming `account_id`
 * in an address on a `derived` table is not the re-parenting ADR-102 clause 4
 * refuses -- that is a `SET`, and it stays refused there. An address NARROWS,
 * the handle's `EXISTS` still proves the parent is this identity's, and
 * refusing it left `analytics_snapshots` with no addressed write at all,
 * because its primary key is `(account_id, as_of_trading_day)` and an `EXISTS`
 * over `accounts` pins neither: one identity owns many accounts, so the
 * caller's half really does have to name which.
 */
function refusePinnedColumn(key: ScopedTableKey, at: Readonly<Record<string, unknown>>): void {
  for (const sqlName of handlePinnedColumns(key)) {
    const property = propertyForColumn(TABLES[key] as PgTable, sqlName);
    for (const named of Object.keys(at)) {
      if (named !== sqlName && named !== property) continue;
      throw new Error(
        `"${named}" is ${key}'s tenancy column (${SCOPE_RULES[key].class} rule on "${sqlName}") ` +
          'and a scoped filter never takes it from the caller. The handle already pins it, so a ' +
          'caller naming it is asserting a scope the handle has already decided -- and it counts ' +
          'toward the unique key an address must contain whether the caller writes it or not.',
      );
    }
  }
}

// -----------------------------------------------------------------------------
// THE PREDICATE A WRITE MAY CARRY IS BRANDED, SO THE WRONG SHAPE DOES NOT
// COMPILE RATHER THAN MERELY FAILING A TEST
// -----------------------------------------------------------------------------
// `where` used to be `SQL | undefined` and `undefined` was how every one of the
// six removed methods reached the whole table. It is now two DISJOINT branded
// types with one producer each, which buys three refusals at compile time:
//
//   1. `undefined` in the where position           -- there is no such value.
//   2. A bare `SQL`, including `scopePredicate(...)` on its own -- the tenancy
//      predicate alone is what `scopedTx.update` carried, and it is now not a
//      write predicate at all.
//   3. An UNSCOPED predicate handed to the SCOPED builder -- which is the
//      shape a keyed write that drops tenancy would have to take, and it is
//      `TS2345` rather than a test somebody has to keep.
//
// THE BRAND IS A TYPE-ONLY INTERSECTION AND NOT A `unique symbol`. Session 222
// measured that `declare const X: unique symbol` type-checks, satisfies every
// use and ERASES under `node --experimental-strip-types`, so a brand written
// that way is a control that is present in the review and absent at run time.
// Nothing here exists after erasure and nothing here needs to.

/** A write predicate carrying BOTH a tenancy narrowing and an address. */
export type ScopedWritePredicate = SQL & { readonly __writePredicate: 'tenancy-and-address' };

/** A write predicate carrying an address and no tenancy, for the two unscoped authorities. */
export type UnscopedWritePredicate = SQL & { readonly __writePredicate: 'address' };

/**
 * The single row an addressed read returned, or `undefined`.
 *
 * IT THROWS ON TWO RATHER THAN RETURNING THE FIRST, and that is the one place
 * in this file where the uniqueness claim is checked against the DATABASE
 * instead of against the transcription of it. `refuseUnaddressed` reads
 * `schema.ts`, which is a transcription somebody keeps true by hand; this reads
 * what Postgres actually returned. A second row means the key the address named
 * is not unique in the database, and returning the first would make that
 * invisible on exactly the path an idempotency store reads.
 */
function oneOrNone(key: TableKey, found: readonly unknown[]): unknown {
  if (found.length > 1) {
    throw new Error(
      `an addressed read of ${key} returned ${found.length} rows. The address named a column ` +
        'set schema.ts declares UNIQUE and the database disagreed, which is a drift between ' +
        'the migrations and the transcription rather than a caller error.',
    );
  }
  return found[0];
}

/** `and` over two predicates that are both present, without the optional arm. */
function bothOf(left: SQL, right: SQL): SQL {
  const composed = and(left, right);
  if (composed === undefined) {
    throw new Error('two present predicates composed to nothing, which drizzle-orm cannot do.');
  }
  return composed;
}

/**
 * THE ONLY PRODUCER OF A SCOPED WRITE PREDICATE, and it ANDs the tenancy
 * narrowing the matching read carries with the caller's address.
 *
 * THE COMPOSITION IS HERE AND NOT AT A CALL SITE, so there is no seam at which
 * a caller could supply the first half. `scopePredicate(key, identityId)` is
 * the same function the read calls, over the whole of `ScopedTableKey`
 * including `derived`, whose `EXISTS` is as correct ANDed as it is alone.
 */
export function scopedWritePredicate<K extends ScopedTableKey>(
  key: K,
  identityId: IdentityId,
  at: RowAddress<K>,
): ScopedWritePredicate {
  refusePinnedColumn(key, at);
  refuseUnaddressed(key, at, handlePinnedColumns(key));
  return bothOf(scopePredicate(key, identityId), addressPredicate(key, at)) as ScopedWritePredicate;
}

/**
 * The only producer of an unscoped write predicate.
 *
 * NO TENANCY CONJUNCT, because `systemTx` and `firmTx` carry no identity. The
 * address is the WHOLE predicate, which is why it is the one authority where
 * `refuseUnaddressed` is the only thing between a caller and the table.
 */
export function unscopedWritePredicate<K extends TableKey>(
  key: K,
  at: RowAddress<K>,
): UnscopedWritePredicate {
  refuseUnaddressed(key, at);
  return addressPredicate(key, at) as UnscopedWritePredicate;
}

/**
 * The read predicate for a filter, with the tenancy narrowing ANDed.
 *
 * TERMS ARE ADMITTED HERE AND NOWHERE THAT WRITES, which is the whole of
 * ADR-157's read-versus-write asymmetry. The tenancy conjunct is the same
 * `scopePredicate` the unfiltered read carries, so a term can only remove rows
 * from what this identity could already see.
 */
export function scopedFilterPredicate<K extends ScopedTableKey>(
  key: K,
  identityId: IdentityId,
  where: RowFilter<K>,
): SQL {
  refusePinnedColumn(key, where);
  return bothOf(scopePredicate(key, identityId), filterPredicate(key, where));
}

/** The read predicate for a filter at an authority that carries no identity. */
export function unscopedFilterPredicate<K extends TableKey>(key: K, where: RowFilter<K>): SQL {
  return filterPredicate(key, where);
}

/**
 * The read predicate for an ADDRESS through a scoped handle. Equality only.
 *
 * SEPARATE FROM `scopedFilterPredicate` BECAUSE A TERM MUST NOT REACH AN
 * ADDRESSED READ. `rowAt` promises one row or none and throws on two; a term
 * makes that promise unkeepable, so the two paths take different builders
 * rather than one builder with a flag a caller could get wrong. It renders
 * exactly what `scopedWritePredicate` renders, which is what makes "the read
 * and the write carry the same predicate" assertable.
 */
export function scopedAddressPredicate<K extends ScopedTableKey>(
  key: K,
  identityId: IdentityId,
  at: RowAddress<K>,
): SQL {
  refusePinnedColumn(key, at);
  return bothOf(scopePredicate(key, identityId), addressPredicate(key, at));
}

/** The read predicate for an address at an authority that carries no identity. */
export function unscopedAddressPredicate<K extends TableKey>(key: K, at: RowAddress<K>): SQL {
  return addressPredicate(key, at);
}

/** UPDATE. The `WHERE` clause is not optional and there is no builder without one. */
function updateStatementOn(
  source: StatementSource,
  key: TableKey,
  values: WriteValues,
  where: SQL,
): unknown {
  refuseTenancyColumn(key, values);
  refuseTermInValues(key, values);
  return source
    .update(TABLES[key] as PgTable)
    .set(values)
    .where(where)
    .returning();
}

/** DELETE, with the same rule about its `WHERE`. */
function deleteStatementOn(source: StatementSource, key: TableKey, where: SQL): unknown {
  return source
    .delete(TABLES[key] as PgTable)
    .where(where)
    .returning();
}

/** UPDATE through a scoped handle. Accepts NOTHING but a tenancy-and-address predicate. */
export function scopedUpdateStatement(
  source: StatementSource,
  key: ScopedTableKey,
  values: WriteValues,
  where: ScopedWritePredicate,
): unknown {
  return updateStatementOn(source, key, values, where);
}

/** DELETE through a scoped handle. */
export function scopedDeleteStatement(
  source: StatementSource,
  key: ScopedTableKey,
  where: ScopedWritePredicate,
): unknown {
  return deleteStatementOn(source, key, where);
}

/** UPDATE at an authority that carries no identity. */
export function unscopedUpdateStatement(
  source: StatementSource,
  key: TableKey,
  values: WriteValues,
  where: UnscopedWritePredicate,
): unknown {
  return updateStatementOn(source, key, values, where);
}

/** DELETE at an authority that carries no identity. */
export function unscopedDeleteStatement(
  source: StatementSource,
  key: TableKey,
  where: UnscopedWritePredicate,
): unknown {
  return deleteStatementOn(source, key, where);
}

/**
 * SELECT carrying a predicate, or none.
 *
 * THIS ONE STILL TAKES `undefined` AND THAT IS NOT AN OVERSIGHT. An unfiltered
 * SELECT is what `systemDb(reason).rows` and `firmDb().rows` have always
 * granted at those authorities, and it has the only two real callers in the
 * tree. The defect ADR-112 closes is on the side that DESTROYS.
 */
export function selectStatement(
  source: StatementSource,
  key: TableKey,
  where: SQL | undefined,
): unknown {
  const builder = source.select().from(TABLES[key] as PgTable);
  return where === undefined ? builder : builder.where(where);
}

// -----------------------------------------------------------------------------
// THE ROW LOCK (ADR-157)
// -----------------------------------------------------------------------------
// ADR-112's foreclosure 3 named four constructions with no shape in this
// accessor -- `ON CONFLICT`, `ORDER BY`, `LIMIT` and `FOR UPDATE` -- and said a
// claim that needs `SELECT ... FOR UPDATE` has no way to ask. `INV-M20-01` is
// that claim: "every debit is checked against the live position inside the same
// transaction ... plus a per-identity advisory lock". `INV-M5-07` is the same
// claim per account and shared with the nightly batch. `GS-230` is the scenario,
// "exactly one succeeds where the balance covers only one", and it is a claim
// about two concurrent transactions that NOTHING in this tree could make one of
// lose.
//
// A ROW LOCK AND NOT AN ADVISORY LOCK, AND THE DIFFERENCE IS WHICH DOOR IT GOES
// THROUGH. `pg_advisory_xact_lock(bigint)` is what the invariants' prose names,
// and there is no way to send it that is not `sqlExecutor` -- which would mean
// widening a one-member raw-SQL vocabulary to smuggle in a primitive, which is
// the exact reach-around P5 section 11 rule 10 exists to foreclose and the one
// P7 section 11 rule 10 repeats. A row lock says the same thing THROUGH THE
// ACCESSOR: it takes the tenancy predicate the matching read takes, so a caller
// scoped to A locking B's row locks nothing and is told nothing, which an
// advisory lock keyed on a uuid the caller supplies would not have given.
//
// IT IS ON THE TRANSACTION HANDLES ONLY, and that is Postgres rather than
// taste: a row lock is released at COMMIT, so a lock taken outside a
// transaction is released before the next statement runs and is a lock that
// reads like one and is not one. `ScopedDb`, `SystemDb` and `FirmDb` stay read
// only and unchanged, which is also what keeps ADR-084's two watched compile
// refusals proving what they were written to prove.
//
// `FirmTx` DOES NOT GET ONE. A `firm` row belongs to nobody and no invariant in
// the corpus names a lock on one; the two that name a lock name an identity and
// an account, which are `ScopedTx`'s and -- because `INV-M5-07`'s lock is
// SHARED WITH THE NIGHTLY BATCH, and a lock only one of two parties takes is not
// a lock -- `SystemTx`'s.
//
// ONE STRENGTH AND NO OPTIONS. `FOR UPDATE` only: `FOR SHARE` and `FOR NO KEY
// UPDATE` have no caller, and `NOWAIT` and `SKIP LOCKED` each change what a
// contending transaction DOES rather than what it sees, which is a decision a
// money path makes with an argument rather than a parameter somebody passes.

/** SELECT ... FOR UPDATE. The predicate is required and there is no builder without one. */
function lockingSelectStatement(source: StatementSource, key: TableKey, where: SQL): unknown {
  return source
    .select()
    .from(TABLES[key] as PgTable)
    .where(where)
    .for('update');
}

// -----------------------------------------------------------------------------
// THE THIRD DOOR: ROWS THAT BELONG TO NOBODY (ADR-102 clause 3)
// -----------------------------------------------------------------------------
// `systemDb(reason)` and `firmDb()` answer DIFFERENT questions and one door was
// serving both. `systemDb(reason).rows(key)` is generic over `TableKey`, so it
// serves "EVERYBODY's rows, read without their identity" -- which is what
// 'nightly-batch' and 'operator-console' do -- and also "NOBODY's rows", which
// is what reading `coupons` is. Those are not the same act and only the first
// one has an identity at risk.
//
// A REQUEST HANDLER IS NEITHER OF THE TWO REASONS AND THAT IS NOT AN OVERSIGHT.
// `psp_webhook_events`, `coupons`, `integration_contracts`, `plan_versions` and
// `plan_version_sizes` are all `firm`, so they are excluded from
// `ScopedTableKey` and reachable today only through `systemDb`. A handler
// serving `POST /checkout` is not a nightly batch and is not an operator
// console, and ADR-096's remedy for the last reader with no identity -- read
// over HTTP instead, "not a reader of this database at all" -- is unavailable
// here, because under ADR-096 `apps/api` is the process the site reads THROUGH.
// If `apps/api` cannot reach a `firm` table then nothing can.
//
// SO THE VOCABULARY STAYS AT TWO MEMBERS AND A NARROWER DOOR IS ADDED.
// `firmDb()` takes NO reason, because the question a reason answers -- "why are
// you reading rows that are not yours?" -- does not arise about a row that is
// nobody's. A caller that wants an unscoped read of a SCOPED table still has to
// write the word system, and now that word means only what ADR-084 accepted it
// for. Adding 'request-handler' to `SystemReason` would have made the list a
// list nobody has to justify joining, which is ADR-096 section 5's own argument
// against the third member it refused.
//
// WHAT THIS COSTS, STATED HERE RATHER THAN ONLY IN THE ENTRY. The `firm`
// classification now decides read AND write authorization for thirty-five
// tables with no word written at the call site, and ADR-101 section 8 records a
// live defect in exactly that classification's only mechanical check: the
// assertion `no firm table carries a column referencing identities` reads the
// `CREATE TABLE` and misses `admin_actions.on_behalf_of_identity_id`, which
// `0043` adds by `ALTER`. A table wrongly classified `firm` was previously
// behind a two-word vocabulary and is now behind nothing.

/**
 * The accessor for rows that belong to no identity.
 *
 * A `ScopedTableKey` here is a COMPILE ERROR, which is the mirror of
 * `ScopedDb`'s: `FirmTableKey` excludes every table an identity owns, so this
 * handle cannot be used to read around a scope.
 */
export interface FirmDb {
  readonly __brand: 'FirmDb';
  rows<K extends FirmTableKey>(key: K): Promise<unknown[]>;
}

/**
 * The firm-wide accessor. No reason, because no identity is at risk.
 *
 * ITS BRAND IS DISJOINT FROM THE OTHER TWO, so it is not assignable to a
 * `ScopedDb` or to a `SystemDb` and neither is assignable to it.
 */
export function firmDb(): FirmDb {
  return {
    __brand: 'FirmDb',
    async rows<K extends FirmTableKey>(key: K): Promise<unknown[]> {
      return client()
        .select()
        .from(TABLES[key] as PgTable);
    },
  };
}

// =============================================================================
// ESTABLISHMENT, WHICH IS CREATING A SCOPE RATHER THAN EXERCISING ONE (ADR-126)
// =============================================================================
// EVERYTHING ABOVE THIS LINE ASSUMES THE CALLER IS ALREADY SOMEBODY. Three doors
// take an identity, a reason, or nothing, and every one of them answers a
// question of the form "what may THIS caller do". An authentication handler is
// the code that runs BEFORE that question has an answer, and ADR-120 measured
// the consequence in one sentence: ADR-112 unblocked everything a session can DO
// and nothing that MAKES one.
//
// THE TWO ACTS ARE NOT ONE ACT AND THEY DO NOT GET ONE DOOR.
//
//   RESOLVE  turn the address a person typed into the identity that owns it. A
//            read ACROSS the tenancy boundary by construction, because the
//            caller is not yet anyone. This IS an authority problem.
//   MINT     write the session row that establishes the scope. By the time a
//            handler mints it has already resolved, so it HOLDS an identity;
//            what it lacks is a way to write a `derived` row whose parent it can
//            prove. This is NOT an authority problem, and treating it as one is
//            how a vocabulary gets widened for a construction that did not need
//            it.
//
// AND NEITHER IS A MISSING CONSTRUCTION. Both are expressible at `systemTx`
// today: `SystemTx.insert` is generic over `TableKey` and reaches `sessions`,
// `unscopedInsertStatement` does not run `refuseTenancyColumn` so naming
// `user_id` there is permitted, and `SystemTx.rowAt` is generic over `TableKey`
// and reaches `users` by `email`. What neither has is a WORD a request handler
// may write. That is exactly the offer ADR-109 clause 1 declined, and it
// declined it because "admitting 'request-handler' would buy a door that still
// writes the whole table". ADR-112 made that sentence false. THE REFUSAL STANDS
// AND ITS REASON DOES NOT, which is why the replacement reason is written here
// rather than assumed.
//
// -----------------------------------------------------------------------------
// THE VOCABULARY THAT MOVES IS THE TABLE AND NEVER THE REASON
// -----------------------------------------------------------------------------
// `SystemReason` and `SqlExecutorReason` are closed vocabularies of WHY, and
// every member of either grants EVERY TABLE. A third `SystemReason` member would
// hand a request handler EVERY REGISTERED TABLE AT EVERY VERB `SystemTx`
// DECLARES, in exchange for one table at one verb. A closed vocabulary of WHICH
// grants exactly what it names. So both constructions below take a TABLE
// vocabulary, `SystemReason` stays at two members for the third time (ADR-096
// clause 3, ADR-102 clause 3, and here), and `SqlExecutorReason` stays at one.
//
// THIS SENTENCE USED TO STATE THE TWO FIGURES AND ADR-157 MOVED ONE OF THEM.
// It read "all 104 registered tables at six verbs", and the verb count went to
// seven the moment `lockAt` landed on `SystemTx`. The arithmetic was never the
// argument -- the argument is that one side is bounded by a table name and the
// other is not -- so the figures are gone and the property is stated instead,
// which is ADR-034's rule applied to a comment.
//
// THAT IS A RULING RATHER THAN A PREFERENCE, AND `ledger_entries` IS WHY.
// It is `derived` with `traversal: 'hop'` via `ledger_accounts`, so an
// `insertUnder` generic over the CLASS -- which reads naturally, and which the
// first draft of this section had -- would let a scoped request handler write
// ONE LEG of a double-entry posting under its own ledger account. That is money
// creation behind a handle every authenticated request already holds, and
// `packages/ledger/test/accessor-bind.test.ts` states the property it would
// break in its own words: "A posting touches two parties' accounts, so only
// `SystemTx` can write it". The generalisation was MEASURED before it was
// refused, which is the only reason this file does not carry it.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT HERE, NAMED RATHER THAN LEFT TO BE DISCOVERED
// -----------------------------------------------------------------------------
// ESTABLISHING AN IDENTITY AT ALL HAS NO DOOR AND NO CALLER. `identities` is
// `class: 'root'` and `OwnedTableKey` excludes it, so an address that resolves
// to NOBODY cannot be signed up through any authority a request handler holds.
// ADR-120 named two constructions and there are three. The third is reported and
// not built, on `job-queue.ts`'s rule that a primitive admitted before a caller
// exists is a primitive nobody can remove -- and there is no caller, because the
// endpoint that would sign somebody up is `POST /auth/verify`, which is blocked
// on the OTP digest whatever this file does.

/**
 * The tables a caller with NO IDENTITY may read ONE ROW of.
 *
 * A CLOSED LIST OF ONE, AND JOINING IT IS A DIFF ON THIS FILE with an argument
 * attached. That is `SystemReason`'s own control moved from the reason to the
 * table, and it is strictly narrower: a reason grants every table and a table
 * grants one. `users` is here because `POST /auth/verify` must turn the address
 * a person typed into the identity that owns it, and no other table in the
 * registry has stated that need.
 */
export type ResolvableTableKey = 'users';

/**
 * The columns each resolvable table may be addressed BY.
 *
 * THE TABLE LIST IS NOT ENOUGH AND THIS IS THE OTHER HALF. `users` declares TWO
 * unique keys -- `id` inline and `email` inline -- and `refuseUnaddressed` would
 * honour either, so a table-only vocabulary would make EVERY user row in the
 * estate readable before authentication by naming its uuid. The construction
 * does not need that: a person types an address, never a uuid. Naming `id` is
 * `TS2353` at the call site and a throw behind it.
 */
export const RESOLUTION_ADDRESS = { users: ['email'] } as const;

/** The address shape one resolvable table accepts, derived from the list above. */
export type ResolutionAddress<K extends ResolvableTableKey> = Readonly<
  Record<(typeof RESOLUTION_ADDRESS)[K][number], unknown>
>;

/**
 * Refuse a resolution address that is not EXACTLY the declared one.
 *
 * BOTH DIRECTIONS, because they are different failures. A column the list does
 * not carry is a caller reaching past the vocabulary; a declared column the
 * caller omitted is a narrower predicate than the one this door was opened for,
 * and on a one-column list it is the empty address.
 */
function refuseUnresolvableAddress(
  key: ResolvableTableKey,
  at: Readonly<Record<string, unknown>>,
): void {
  const permitted: readonly string[] = RESOLUTION_ADDRESS[key];
  for (const named of Object.keys(at)) {
    if (permitted.includes(named)) continue;
    throw new Error(
      `"${named}" is not a resolution address on ${key}. A pre-identity read reaches ` +
        `[${permitted.join(', ')}] and nothing else, because this door is open to a caller who ` +
        'has proved nothing and the address is the only thing bounding what it can name.',
    );
  }
  for (const required of permitted) {
    if (Object.prototype.hasOwnProperty.call(at, required)) continue;
    throw new Error(
      `a resolution read of ${key} must name "${required}". The declared address is ` +
        `[${permitted.join(', ')}] and a subset of it is a wider predicate than this door grants.`,
    );
  }
}

/**
 * The pre-identity reader.
 *
 * READ ONLY, NON-TRANSACTIONAL, ONE ROW, ONE TABLE, ONE ADDRESS. Its brand is
 * disjoint from the other three, so it is not assignable to a `ScopedDb`, a
 * `SystemDb` or a `FirmDb` and none of them is assignable to it.
 *
 * THERE IS NO `transaction(resolutionDb(), ...)` OVERLOAD and that absence is
 * the ruling rather than an omission. Every write in this file is reached
 * through `transaction`, so a door with no overload cannot participate in one at
 * any authority: the pre-identity reader can be composed into nothing.
 *
 * WHAT IT COSTS, STATED RATHER THAN LEFT TO BE FOUND. A handler that resolves
 * and then mints does so in TWO units of work, so a crash between them leaves a
 * consumed challenge and no session and the person asks for another code. That
 * is the price of a door that cannot write, and it is paid in an inconvenience
 * rather than in a row.
 */
export interface ResolutionDb {
  readonly __brand: 'ResolutionDb';
  /** ONE row, or `undefined`. The address is the declared one and no other. */
  rowAt<K extends ResolvableTableKey>(key: K, at: ResolutionAddress<K>): Promise<unknown>;
}

/**
 * The pre-identity reader. No identity, because finding one is the point.
 *
 * IT TAKES NO REASON, on `firmDb()`'s precedent one door along: the question a
 * reason answers is "why are you reading rows that are not yours", and the
 * honest answer here is fixed by the vocabulary rather than chosen at the call
 * site. There is one table and one address and no second thing this handle could
 * be doing.
 */
/**
 * THE ONLY PRODUCER OF A PRE-IDENTITY READ PREDICATE, and the seam the suite
 * asserts through.
 *
 * IT IS A SEPARATE FUNCTION FOR THE REASON `scopedWritePredicate` IS. The handle
 * itself reads `client()`, which throws when `DATABASE_URL` is unset, so a
 * refusal asserted only through `resolutionDb().rowAt` would be a refusal no
 * suite in this workspace could reach. `ci.yml`'s `integration` job has no
 * services block, which is the same absence ADR-102 section 16, ADR-112 section
 * 9 and ADR-120 section 7 all name.
 *
 * THERE IS NO TENANCY CONJUNCT AND THERE IS NO CORRECT ONE. That is what makes
 * this door the one where the vocabulary is the whole control: the address is
 * the entire predicate, and the two guards below are everything standing between
 * a caller who has proved nothing and a row.
 */
export function resolutionPredicate<K extends ResolvableTableKey>(
  key: K,
  at: ResolutionAddress<K>,
): SQL {
  const address = at as Readonly<Record<string, unknown>>;
  refuseUnresolvableAddress(key, address);
  // THE FOLD TO `schema.ts` STILL RUNS. The vocabulary says which column is
  // permitted; this says the database agrees that column names one row, so a
  // later member added to `RESOLUTION_ADDRESS` over a non-unique column is a
  // throw rather than a many-row read at an authority carrying no tenancy.
  refuseUnaddressed(key, address);
  return addressPredicate(key, address);
}

export function resolutionDb(): ResolutionDb {
  return {
    __brand: 'ResolutionDb',
    async rowAt<K extends ResolvableTableKey>(key: K, at: ResolutionAddress<K>): Promise<unknown> {
      const found = (await client()
        .select()
        .from(TABLES[key] as PgTable)
        .where(resolutionPredicate(key, at))) as unknown[];
      return oneOrNone(key, found);
    },
  };
}

// =============================================================================
// THE PUBLIC LOOKUP: AN `owned` ROW READ BY NOBODY, BECAUSE THE ADDRESS IS THE
// CREDENTIAL (ADR-231)
// =============================================================================
// EVERY DOOR ABOVE ANSWERS "WHAT MAY THIS CALLER DO", INCLUDING THE ONE THAT
// TAKES NO IDENTITY. `firmDb()` reads rows nobody owns; `resolutionDb()` reads
// one row of one table to find out WHO the caller is. `GET /verify/:code` is
// neither. It reads a row an identity DOES own, on behalf of a caller who will
// never be anybody, and it is correct that it does: a certificate is a claim
// Merit published, and the person the trader shows it to is a stranger by
// construction.
//
// THE SCOPE SYSTEM HAD NO VOCABULARY FOR THAT AND THIS IS THE ONE IT GETS.
// `certificates` is `class: 'owned'` on `identity_id`, so `ScopedTableKey`
// includes it and `FirmTableKey` does not: `db.scoped` needs an identity this
// route cannot have and `db.firm` refuses the key at compile time. That is not
// a gap in the registry. The registry answers WHO OWNS A ROW and it answers it
// correctly here; what was missing is a separate answer to WHAT AN
// UNAUTHENTICATED CALLER MAY ADDRESS A ROW BY.
//
// -----------------------------------------------------------------------------
// THE VOCABULARY IS `(TABLE, COLUMN)` AND THE COLUMN HALF IS THE WHOLE CONTROL
// -----------------------------------------------------------------------------
// This is `RESOLUTION_ADDRESS`'s own two-part shape and it is taken for the
// same reason, one table along. A table-only opt-in would admit EVERY unique
// key the table declares, and `certificates` declares two: `id` and `code`.
// Admitting `id` would defeat the reason the two columns are distinct at all --
// `0020_public_surface.sql` keeps `code` separate "so the public token can be
// ROTATED AFTER AN INCIDENT" -- because a holder who kept the immutable key can
// still correlate the certificate after the token they were told to forget has
// changed. Naming `id` here is `TS2353` at the call site and a throw behind it.
//
// A MEMBER OF THIS LIST IS AN ASSERTION THAT THE NAMED COLUMN IS UNGUESSABLE,
// and that is the sentence a later member has to be able to say. The address is
// the entire predicate: there is no tenancy conjunct, no reason, and no session,
// so whoever can WRITE the value can READ the row. `certificates.code` is here
// because `INV-M11-05` fixes it at "128 bits of entropy, no sequence" and
// M11 section 9's `AS-M11-04` is the scenario written about exactly this door.
//
// THAT ASSERTION IS NOT MECHANICALLY TRUE IN THIS TREE TODAY AND ADR-231
// SECTION 6 SAYS SO RATHER THAN LEAVING IT TO BE FOUND. `certificates.code` is
// `text NOT NULL` under a unique index and carries NO length bound and NO
// alphabet bound in DDL, and nothing in this repository issues a certificate,
// so no minter exists to hold `INV-M11-05` either. The invariant is a corpus
// commitment with no enforcement anywhere. It is recorded here because this door
// is the surface that would pay for it.
//
// -----------------------------------------------------------------------------
// WHAT THIS DOOR DELIBERATELY IS NOT
// -----------------------------------------------------------------------------
// IT IS NOT A `SystemDb` WITH A NICER NAME. `SystemTx` is generic over
// `TableKey` at seven verbs; this reads ONE ROW of ONE TABLE at ONE COLUMN and
// has no insert, no update, no delete, no lock and no `sqlExecutor`.
//
// IT IS NOT COMPOSABLE. There is no `transaction(publicLookupDb(), ...)`
// overload, on `resolutionDb`'s precedent and for a stronger reason: every write
// in this file is reached through `transaction`, so a handle with no overload
// cannot participate in a unit of work at any authority. A door open to a caller
// who has proved nothing must not be able to write.
//
// IT IS NOT A ROUTE INTO `db.scoped`. Resolving `identity_id` from the code and
// then opening the scoped door was the cheaper-looking design and ADR-231
// section 4 refuses it: it needs THIS read to happen first in any case, so it is
// this machinery plus a second round trip, and what the second trip buys is an
// authority over every `owned` and `derived` table that identity has -- payouts,
// accounts, wallet entries, KYC -- handed to an unauthenticated handler in
// exchange for one column of one row it already held.

/**
 * The tables an unauthenticated caller may read ONE ROW of BY PRESENTING ITS
 * TOKEN.
 *
 * A CLOSED LIST OF ONE, AND JOINING IT IS A DIFF ON THIS FILE with an argument
 * attached. The argument a member owes is not "this row is public"; it is "the
 * column below cannot be guessed", because the address is the only thing
 * standing between a stranger and the row.
 */
export type PubliclyLookedUpTableKey = 'certificates';

/**
 * The columns each publicly readable table may be addressed BY.
 *
 * `code` AND NEVER `id`. See this section's header: the two columns exist
 * separately so the public one can be rotated, and admitting the immutable one
 * would spend that property for nothing.
 */
export const PUBLIC_LOOKUP_ADDRESS = { certificates: ['code'] } as const;

/** The address shape one publicly readable table accepts, from the list above. */
export type PublicLookupAddress<K extends PubliclyLookedUpTableKey> = Readonly<
  Record<(typeof PUBLIC_LOOKUP_ADDRESS)[K][number], unknown>
>;

/**
 * Refuse a public address that is not EXACTLY the declared one.
 *
 * BOTH DIRECTIONS, and they are `refuseUnresolvableAddress`'s two failures with
 * a harder consequence. A column the list does not carry is a caller reaching
 * past the vocabulary; a declared column the caller omitted is a WIDER predicate
 * than this door was opened for, and on a one-column list it is the empty
 * address, which at an authority carrying no tenancy is the whole table.
 */
function refusePublicAddress(
  key: PubliclyLookedUpTableKey,
  at: Readonly<Record<string, unknown>>,
): void {
  // THE TABLE IS REFUSED BEFORE THE COLUMN, AND BY NAME. The type already
  // excludes every unregistered key, and a type is gone by the time this runs:
  // a caller that reached here through an `any` or a cast would otherwise index
  // `undefined` and get a `TypeError` about `includes`, which is a refusal
  // nobody can read as one. The suite reaches past the type on purpose, and
  // this is the sentence it meets.
  const declared: readonly string[] | undefined = PUBLIC_LOOKUP_ADDRESS[key];
  if (declared === undefined)
    throw new Error(
      `${String(key)} is not publicly readable: no column of that table is declared a public ` +
        `lookup address. \`PUBLIC_LOOKUP_ADDRESS\` names ` +
        `[${Object.keys(PUBLIC_LOOKUP_ADDRESS).join(', ')}], and joining it is a diff on this ` +
        'file asserting that the column named cannot be guessed.',
    );
  const permitted: readonly string[] = declared;
  for (const named of Object.keys(at)) {
    if (permitted.includes(named)) continue;
    throw new Error(
      `"${named}" is not a public lookup address on ${key}. This door is open to a caller who ` +
        `has proved nothing, so it reaches [${permitted.join(', ')}] and nothing else: the ` +
        'address is the credential and a column that is not one must not be an address.',
    );
  }
  for (const required of permitted) {
    if (Object.prototype.hasOwnProperty.call(at, required)) continue;
    throw new Error(
      `a public lookup of ${key} must name "${required}". The declared address is ` +
        `[${permitted.join(', ')}] and a subset of it is a wider predicate than this door grants.`,
    );
  }
}

/**
 * The reader an unauthenticated caller's request handler uses.
 *
 * READ ONLY, NON-TRANSACTIONAL, ONE ROW, ONE TABLE, ONE ADDRESS. Its brand is
 * disjoint from the other four, so it is not assignable to a `ScopedDb`, a
 * `SystemDb`, a `FirmDb` or a `ResolutionDb`, and none of them is assignable to
 * it.
 *
 * WHAT IT COSTS, STATED RATHER THAN LEFT TO BE FOUND. The row comes back whole,
 * so every column of `certificates` reaches the handler including
 * `revoked_reason`, which `0020` marks INTERNAL free text, and `identity_id`.
 * A door cannot project, because a projection is a statement about what one
 * caller renders and this is an authority. `routes/verify.ts` is where the
 * withholding lives and `toVerifyRow` is the structural form of it: the response
 * is rebuilt field by field rather than spread, so a column added to this table
 * tomorrow cannot ride out onto the public page.
 */
export interface PublicLookupDb {
  readonly __brand: 'PublicLookupDb';
  /** ONE row, or `undefined`. The address is the declared one and no other. */
  rowAt<K extends PubliclyLookedUpTableKey>(key: K, at: PublicLookupAddress<K>): Promise<unknown>;
}

/**
 * THE ONLY PRODUCER OF A PUBLIC LOOKUP PREDICATE, and the seam the suite
 * asserts through.
 *
 * IT IS A SEPARATE FUNCTION FOR `resolutionPredicate`'s REASON. The handle
 * itself reads `client()`, which throws when `DATABASE_URL` is unset, so a
 * refusal asserted only through `publicLookupDb().rowAt` would be a refusal no
 * suite in this workspace could reach: `ci.yml`'s `integration` job has no
 * services block.
 *
 * THERE IS NO TENANCY CONJUNCT AND THERE IS NO CORRECT ONE, which is what makes
 * the vocabulary the whole control rather than half of it.
 */
export function publicLookupPredicate<K extends PubliclyLookedUpTableKey>(
  key: K,
  at: PublicLookupAddress<K>,
): SQL {
  const address = at as Readonly<Record<string, unknown>>;
  refusePublicAddress(key, address);
  // THE FOLD TO `schema.ts`. The vocabulary says which column is permitted;
  // this says the database agrees that column names ONE row. A later member
  // added over a non-unique column would be a many-row read at an authority
  // carrying no tenancy, which is the widest failure this file has.
  refuseUnaddressed(key, address);
  return addressPredicate(key, address);
}

/**
 * The public reader. No identity, because there will never be one.
 *
 * IT TAKES NO REASON, on `firmDb()`'s and `resolutionDb()`'s shared precedent:
 * the question a reason answers is "why are you reading rows that are not
 * yours", and here the vocabulary answers it in advance. There is one table and
 * one address and no second thing this handle could be doing.
 */
export function publicLookupDb(): PublicLookupDb {
  return {
    __brand: 'PublicLookupDb',
    async rowAt<K extends PubliclyLookedUpTableKey>(
      key: K,
      at: PublicLookupAddress<K>,
    ): Promise<unknown> {
      const found = (await client()
        .select()
        .from(TABLES[key] as PgTable)
        .where(publicLookupPredicate(key, at))) as unknown[];
      return oneOrNone(key, found);
    },
  };
}

// =============================================================================
// ESTABLISHING AN IDENTITY (ADR-197)
// =============================================================================
// THE THIRD CONSTRUCTION, WHICH THE SECTION ABOVE NAMED AND DECLINED TO BUILD.
// It declined on `job-queue.ts`'s rule -- a primitive admitted before a caller
// exists is a primitive nobody can remove -- and the words it used were "there
// is no caller". ADR-196 IS THE CALLER SPECIFICATION: it rules the moment
// (`POST /auth/verify`, on a code that verifies, when the address resolves to no
// existing `users` row), the unit of work, and the contents of the row. A ruling
// that names all three is what ADR-112 accepted as a caller for `insertUnder`,
// and it is what admits this.
//
// -----------------------------------------------------------------------------
// CLAUSE 2 IS ENFORCED BY THE SHAPE OF THIS DOOR AND BY NOTHING ELSE
// -----------------------------------------------------------------------------
// ADR-196 clause 2 is "the identity row and its `users` row are ONE UNIT OF
// WORK". Section 8 of that entry WROTE the `DEFERRABLE INITIALLY DEFERRED`
// constraint trigger that would enforce it, measured that it works, and refused
// it on three grounds -- the first of which is that it breaks
// `probe_ledger_constraints.sql`, the acceptance script for `0054`'s own
// trigger. So the entry shipped with its own approval line saying clause 2 is
// "the only clause with no enforcement behind it... prose that the first
// implementer of `verifyOtp` can violate with a green test suite".
//
// THIS DOOR IS WHERE THAT STOPS BEING TRUE, AND IT COSTS NO DDL. `establish` is
// ONE METHOD that issues BOTH inserts, and `EstablishmentTx` carries no other
// verb: there is no `insert`, no `updateAt`, no `rowAt` and no executor. A
// caller therefore has no way to write an `identities` row without the `users`
// row that goes with it, because the only statement that writes the first is the
// statement that writes the second. The invariant moved from a constraint
// nobody could remove into a construction nobody can misuse.
//
// -----------------------------------------------------------------------------
// AND THE RACE IS PAID FOR BY THE SAME SENTENCE
// -----------------------------------------------------------------------------
// ADR-196's named landmine is that two concurrent verifications of one address
// must produce ONE identity, that only `users_email_key` stands between that and
// two, and that each loser costs FOUR PERMANENT ROWS under `ON DELETE RESTRICT`
// -- one `identities` plus three `ledger_accounts` from `0054`'s trigger.
//
// WHAT MAKES THIS WRITE IDEMPOTENT IS THAT THE UNIQUE VIOLATION IS ALLOWED TO
// RAISE. `users_email_key` fires inside the same transaction as the `identities`
// insert, so the ROLLBACK takes the identity row and all three ledger accounts
// with it, and the loser of a race pays ZERO permanent rows rather than four.
// Clause 2 is not merely tidy: it is the mechanism.
//
// SO `ON CONFLICT DO NOTHING` IS REFUSED BY NAME. It does not raise, so the
// transaction would COMMIT with the `identities` row and no `users` row -- which
// is precisely the state clause 2 forbids, and it is permanent, unreachable and
// undeletable under `ON DELETE RESTRICT` with retention "forever (financial
// counterparty record)" (`0002:82-85`). The lenient spelling is the one that
// costs the four rows the strict spelling refunds.
//
// A READ-THEN-WRITE IS REFUSED FOR THE SAME REASON AND IT IS NOT HERE TO
// REFUSE. `resolutionDb` is the read and it is a SEPARATE door with no
// `transaction` overload, so a handler that resolves first is doing so in
// another unit of work and this one still lets the constraint arbitrate.

/**
 * `users.email_normalized`, per the column's own definition.
 *
 * `0002_identity.sql:250-253`: "Dots and plus-tags stripped: the entity-resolution
 * key. Indexed but deliberately NOT unique. Two people can legitimately share a
 * normalized form, so it is a SIGNAL, not a constraint, and making it unique
 * would refuse service to the second of them."
 *
 * IT IS DELIBERATELY LOSSY AND THE COLUMN SAYS SO. Stripping dots is a Gmail
 * rule applied to every domain, which over-merges; the column is non-unique
 * exactly because over-merging must not refuse anybody, so the imprecision is
 * inside the design rather than a defect in this function.
 *
 * THE FOLD HERE IS `toLowerCase` AND THE ONE IN THE OTP DIGEST IS ASCII ONLY,
 * and the difference is not an inconsistency. This value is only ever compared
 * by `citext`, which folds case itself, so a locale-dependent fold cannot make
 * two equal addresses unequal. A MAC input has no such forgiveness, which is
 * why that one folds only where every locale agrees.
 */
export function normalizedEmail(email: string): string {
  const folded = email.trim().toLowerCase();
  const at = folded.lastIndexOf('@');
  if (at <= 0 || at === folded.length - 1) return folded;
  const local = folded.slice(0, at);
  const domain = folded.slice(at + 1);
  const stripped = (local.split('+')[0] ?? '').replace(/\./g, '');
  // A LOCAL PART THAT IS ENTIRELY A TAG KEEPS ITS ADDRESS. `+tag@example.com`
  // would normalize to `@example.com`, which is a resolution key naming a
  // DOMAIN rather than a person, and the column is non-unique so nothing would
  // object. Falling back leaves a worse signal rather than a wrong one.
  if (stripped === '') return folded;
  return `${stripped}@${domain}`;
}

/**
 * The address an establishment is performed AT.
 *
 * IT IS THE RESOLUTION ADDRESS AND NOT A SECOND VOCABULARY. The door that finds
 * nobody and the door that creates somebody are addressed identically, on
 * purpose: the handler's branch is "resolve, and if that answered nothing,
 * establish AT THE SAME ADDRESS", and two vocabularies for one address is how
 * the two halves of one `if` come to disagree about what they are keyed on.
 * `refuseUnresolvableAddress` is the shared guard and `RESOLUTION_ADDRESS` is
 * the shared list.
 */
export interface EstablishmentAddress {
  /** `users.email`, exactly as the person typed it. `citext`, and `UNIQUE`. */
  readonly email: string;
}

/** What an establishment produced. Both ids, because the caller needs both. */
export interface EstablishedIdentity {
  /** `identities.id`. `VerifyResponse.identity_id`. */
  readonly identityId: string;
  /** `users.id`. `VerifyResponse.user_id`. */
  readonly userId: string;
}

/**
 * Raised when the address was established while this transaction was running.
 *
 * IT IS A TYPED OUTCOME AND NOT A 500, and translating it here rather than at
 * the handler is what stops every caller re-deriving which `constraint` name
 * means "somebody else won". The transaction is already rolled back by the time
 * a caller sees this: the four rows the loser wrote are gone.
 *
 * `is_new` IS `false` ON THIS PATH. ADR-196 clause 4 says `is_new` is true on
 * exactly the call that performed clause 1, and the call that raised this did
 * not perform it.
 */
export class IdentityAlreadyEstablished extends Error {
  /** The address that was already taken. */
  readonly email: string;

  constructor(email: string, options?: { readonly cause?: unknown }) {
    super(
      `${email} already has a users row. \`users_email_key\` arbitrated a race and this ` +
        'transaction lost it, so the identity row and the three ledger_accounts rows ' +
        "0054's trigger wrote have been rolled back. Resolve the address and answer " +
        '`is_new: false`.',
      options,
    );
    this.name = 'IdentityAlreadyEstablished';
    this.email = email;
  }
}

/** `users_email_key`, the `UNIQUE` at `0002_identity.sql:248`. Spelled once. */
const USERS_EMAIL_KEY = 'users_email_key';

/**
 * Whether this is the ONE violation that means "somebody else got here first".
 *
 * THE CONSTRAINT NAME IS MATCHED AND NOT ONLY THE SQLSTATE, because `users`
 * carries two unique keys and `23505` on `users_pkey` is a uuid collision rather
 * than a race. Translating that one into "already established" would answer
 * `is_new: false` for an address nobody holds. A rename makes this stop
 * translating and surface the raw error, which is the fail-safe direction: a 500
 * on a rare path beats a wrong answer on the money path.
 *
 * THE `cause` CHAIN IS WALKED AND THE FIRST DRAFT DID NOT WALK IT, WHICH IS THE
 * DEFECT THE RACE MEASUREMENT CAUGHT. Drizzle does not re-raise the driver's
 * error: it throws its own, carrying `code` and `constraint` one level down in
 * `cause`. A version reading only the top level therefore matched NOTHING, and
 * it failed in the direction that looks fine -- the rollback still refunded the
 * four rows, so every row count was correct and only the error's TYPE was wrong.
 * A handler branching on that type would have answered 500 to every second
 * verification of a racing address instead of `is_new: false`.
 */
function isEmailAlreadyTaken(cause: unknown): boolean {
  // BOUNDED, because a `cause` chain is somebody else's data structure and a
  // cycle in one would hang the error path rather than the happy path, which is
  // the worst place in this file to put an unbounded loop.
  let at: unknown = cause;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof at !== 'object' || at === null) return false;
    const err = at as {
      readonly code?: unknown;
      readonly constraint?: unknown;
      readonly cause?: unknown;
    };
    if (err.code === '23505' && err.constraint === USERS_EMAIL_KEY) return true;
    at = err.cause;
  }
  return false;
}

/** One `id` off a `RETURNING`, or a throw naming the table. */
function returnedId(rows: readonly unknown[], key: TableKey): string {
  const row = rows[0];
  if (rows.length !== 1 || typeof row !== 'object' || row === null)
    throw new Error(
      `an insert into ${key} returned ${String(rows.length)} rows. Establishment writes exactly ` +
        'one of each and a different count is a schema this code no longer describes.',
    );
  const id = (row as Record<string, unknown>)['id'];
  if (typeof id !== 'string' || id === '')
    throw new Error(`${key}.id did not read back as a uuid from its own RETURNING clause.`);
  return id;
}

/**
 * The establishment handle. NO IDENTITY, because creating one is the point.
 *
 * IT TAKES NO REASON, on `firmDb()`'s and `resolutionDb()`'s shared precedent:
 * the question a reason answers is "why are you writing rows that are not
 * yours", and this handle can perform exactly one act on exactly two tables, so
 * the honest answer is fixed by the type rather than chosen at the call site.
 *
 * ITS BRAND IS DISJOINT FROM THE OTHER FOUR, so it is not assignable to a
 * `ScopedDb`, a `SystemDb`, a `FirmDb` or a `ResolutionDb`, and none of them is
 * assignable to it.
 */
export interface EstablishmentDb {
  readonly __brand: 'EstablishmentDb';
}

/**
 * The establishment transaction. ONE VERB.
 *
 * THE ABSENCE OF EVERY OTHER METHOD IS THE CONTROL. `FirmTx` and `SystemTx`
 * carry `insert`, `updateAt`, `deleteAt` and an `sqlExecutor`; this carries
 * `establish` and nothing at all besides. A handle that could write `identities`
 * freely would be `SystemTx` with a different name, and the reason `identities`
 * is `class: 'root'` and excluded from `OwnedTableKey` is that "inserting one
 * CREATES an identity" -- so the door that may is the door that can do nothing
 * else.
 */
export interface EstablishmentTx {
  readonly __brand: 'EstablishmentTx';
  /**
   * Create an identity and its first login, together.
   *
   * @throws {IdentityAlreadyEstablished} when `users_email_key` refused the
   * login. The transaction is rolled back and no row survives.
   */
  establish(at: EstablishmentAddress): Promise<EstablishedIdentity>;
}

/** The handle. There is nothing to configure and that is the point. */
export function establishmentDb(): EstablishmentDb {
  return { __brand: 'EstablishmentDb' };
}

/**
 * The two statements, in the order the foreign key requires.
 *
 * THE `identities` INSERT NAMES NO COLUMN, WHICH IS ADR-196 CLAUSE 3 MADE
 * STRUCTURAL. `establish` takes no `identities` values and there is no parameter
 * through which a caller could offer one, so `display_name`,
 * `max_accounts_override` and `support_contact_ref` stay NULL and
 * `leaderboard_opt_in` stays `false` because nothing in this file can say
 * otherwise. Clause 3 reads "the identity row is written with defaults only";
 * here that is a property of the signature rather than of the caller's care.
 */
export function establishmentTx(source: StatementSource): EstablishmentTx {
  return {
    __brand: 'EstablishmentTx',
    async establish(at: EstablishmentAddress): Promise<EstablishedIdentity> {
      const address = at as unknown as Readonly<Record<string, unknown>>;
      // THE RESOLUTION DOOR'S OWN GUARD, both directions. A key the vocabulary
      // does not carry is a caller reaching past it; the declared key missing is
      // an establishment with no login to write.
      refuseUnresolvableAddress('users', address);
      const email = at.email;
      if (typeof email !== 'string' || email.trim() === '')
        throw new Error(
          'an establishment address must carry a non-empty `email`. `users.email` is ' +
            '`citext NOT NULL UNIQUE` and an identity established without one is the row with ' +
            'no login that ADR-196 clause 2 exists to refuse.',
        );

      const created = (await unscopedInsertStatement(
        source,
        'identities',
        {},
      ).returning()) as unknown[];
      const identityId = returnedId(created, 'identities');

      try {
        const login = (await unscopedInsertStatement(source, 'users', {
          identityId,
          email,
          emailNormalized: normalizedEmail(email),
        }).returning()) as unknown[];
        return { identityId, userId: returnedId(login, 'users') };
      } catch (cause) {
        // TRANSLATED, NEVER SWALLOWED. The throw is what rolls the transaction
        // back, so this re-raises rather than returning anything.
        if (isEmailAlreadyTaken(cause)) throw new IdentityAlreadyEstablished(email, { cause });
        throw cause;
      }
    },
  };
}

/** Every table the registry reaches through ANOTHER table. Derived, never listed. */
type DerivedTableKey = {
  [K in TableKey]: (typeof SCOPE_RULES)[K]['class'] extends 'derived' ? K : never;
}[TableKey];

/**
 * The tables a SCOPED handle may insert into by PROVING the parent.
 *
 * A CLOSED LIST OF ONE, WRITTEN AS AN `Extract` SO THE REGISTRY POLICES IT. If
 * `sessions` ever stops being `derived` this type is `never` and every use of it
 * stops compiling, rather than the list quietly describing a table whose class
 * moved underneath it.
 *
 * IT IS A LIST AND NOT THE WHOLE CLASS, and the reason is measured rather than
 * cautious: `ledger_entries` is `derived` with `traversal: 'hop'`, so the class
 * contains one leg of a double-entry posting. See this section's header.
 */
export type ParentedTableKey = Extract<DerivedTableKey, 'sessions'>;

/**
 * INSERT one row of a `derived` table, with the parent PROVED rather than
 * stamped.
 *
 * THE CALLER NAMES THE PARENT AND THE ACCESSOR PROVES IT, and that inversion is
 * the whole construction. On an `owned` table the tenancy value is KNOWN to the
 * handle, so `scopedInsertStatement` stamps it and `refuseTenancyColumn` refuses
 * a caller who names it. On a `derived` table the handle cannot stamp anything:
 * an identity may hold MORE THAN ONE user (ADR-041), so `user_id` is a choice
 * among this identity's own children and only the caller knows which. That is
 * ADR-112 section 5's second draft finding one class along -- "one identity owns
 * many accounts, so the caller's half really does have to name which".
 *
 * SO THE PARENT IS READ, INSIDE THIS TRANSACTION, THROUGH `scopePredicate`. The
 * read is `SELECT ... FROM via WHERE via.<foreign> = <the value the caller named>
 * AND <the via table's own scope predicate>`, and zero rows is a THROW rather
 * than an insert. ADR-102 section 4 named this construction and declined to
 * build it, on the argument that the read "inside a transaction is a `SELECT`
 * the caller could have skipped and outside one is a race". The second half is
 * why the read is on `source` and not on `client()`; the first half is a cost
 * this entry accepts, on ADR-112 clause 2's own trade -- a run-time check bought
 * a guarantee that holds BY CONSTRUCTION rather than by the caller's care, and
 * the guarantee here is that a session cannot be minted for somebody else.
 *
 * `hop` ONLY. A `semi-join` traversal is one-to-many in the direction traversed,
 * so proving the parent proves that SOME child of this identity's is on the
 * other end and not that this row is. `ledger_transactions` is the registry's
 * only one and it is refused by the type before this ever runs; the check below
 * is the run-time half.
 */
export async function insertUnderStatement(
  source: StatementSource,
  key: ParentedTableKey,
  identityId: IdentityId,
  values: WriteValues,
): Promise<unknown[]> {
  // WIDENED DELIBERATELY, AND THE COMPILER SAID SO. `SCOPE_RULES[key]` at a
  // literal key narrows this `const` to the ONE rule `sessions` carries, which
  // makes both guards below unreachable branches: the first draft reported
  // `TS2339: Property 'class' does not exist on type 'never'` from inside its
  // own error message. Widening the index restores the union, so the guards are
  // written against the REGISTRY rather than against the type -- which is the
  // only version of them that survives the registry moving.
  const rule: ScopeRule = SCOPE_RULES[key as TableKey];
  if (rule.class !== 'derived') {
    throw new Error(
      `${key} is registered "${rule.class}" and insertUnder proves a PARENT. An owned or root ` +
        'row carries its own tenancy column, which `insert` stamps; a firm or pair row has no ' +
        'parent to prove; an either row has one through a NULLABLE edge, so proving it ' +
        'establishes tenancy for the rows that have a parent and nothing about the rows that ' +
        'reach an identity the other way. The registry moved and this list did not follow it.',
    );
  }
  if (rule.traversal !== 'hop') {
    throw new Error(
      `${key} reaches its identity by a ${rule.traversal}, which is one-to-many in the direction ` +
        'traversed, so proving the parent proves that SOME row of this identity is on the other ' +
        'end rather than that this one is. insertUnder takes a hop and nothing else.',
    );
  }

  const table = TABLES[key] as PgTable;
  const property = propertyForColumn(table, rule.localColumn);
  if (property === undefined) {
    throw new Error(
      `scope registry names column "${rule.localColumn}" on ${key}, which does not exist on this ` +
        'table. The registry and the schema have drifted.',
    );
  }

  // THE SQL SPELLING IS REFUSED RATHER THAN ACCEPTED, because Drizzle keys a
  // values object by PROPERTY name: a caller writing `user_id` would have the
  // column silently dropped from the INSERT and the parent proved against a
  // value the row never carried. `refuseTenancyColumn` refuses both spellings on
  // the paths that stamp; this one requires one and refuses the other.
  if (
    property !== rule.localColumn &&
    Object.prototype.hasOwnProperty.call(values, rule.localColumn)
  ) {
    throw new Error(
      `"${rule.localColumn}" is ${key}'s SQL column name and a values object is keyed by Drizzle ` +
        `property name. Name "${property}" instead: written this way the column is dropped from ` +
        'the INSERT and the parent is proved against a value the row would not have carried.',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(values, property)) {
    throw new Error(
      `an insert under ${key}'s parent must name "${property}". The handle cannot stamp it: ` +
        `${key} reaches its identity through ${rule.via}, an identity may hold more than one of ` +
        'those, and the accessor has no way to choose which without being told.',
    );
  }

  const parent = values[property];
  if (parent === null || parent === undefined) {
    throw new Error(
      `"${property}" is ${parent === null ? 'null' : 'undefined'} in an insert under ${key}'s ` +
        'parent. A NULL parent proves nothing, because equality against NULL matches no row, so ' +
        'it is refused rather than read as an unparented insert.',
    );
  }

  // THE PROOF. Not a count and not an EXISTS: the rows come back so that the
  // second refusal below can see a hop that named a column the via table does
  // not hold unique, which is a registry drift and not a caller error.
  const via = TABLES[rule.via] as PgTable;
  const proved = (await source
    .select()
    .from(via)
    .where(
      bothOf(
        eq(columnByName(via, rule.foreignColumn), parent),
        scopePredicate(rule.via, identityId),
      ),
    )) as unknown[];

  if (proved.length === 0) {
    throw new Error(
      `no row of ${rule.via} with ${rule.foreignColumn} = the value named for "${property}" ` +
        `belongs to this identity, so the parent of this ${key} row cannot be proved. The row is ` +
        'NOT written. This is the refusal that stops a session being minted for somebody else.',
    );
  }
  if (proved.length > 1) {
    throw new Error(
      `proving the parent of a ${key} row matched ${proved.length} rows of ${rule.via}. The ` +
        `registry calls this traversal a hop, which asserts that "${rule.foreignColumn}" is ` +
        'unique on that table, and the database disagreed.',
    );
  }

  return (await source.insert(table).values(values).returning()) as unknown[];
}

// =============================================================================
// WRITING A ROW THAT BELONGS TO TWO PEOPLE, AS ONE OF THEM (ADR-230)
// =============================================================================
// ADR-106 RULED THAT A `pair` ROW IS SCOPED TO NEITHER PARTY AND THAT RULING IS
// UNTOUCHED. It is a ruling about a READ, and its whole ground is disclosure:
// `columnA = $1 OR columnB = $1` returns precisely this person's rows and every
// one of them carries the other party's identity uuid out of a `NOT NULL`
// column. Nothing below returns a row.
//
// SO THE QUESTION THIS SECTION ANSWERS IS A DIFFERENT ONE, AND IT HAD NO ANSWER
// AT ALL. `apps/api/src/routes/checkout.ts` must write one `attributions` row
// inside the buyer's checkout transaction (M08 section 3.1: resolution "HAPPENS
// AT CHECKOUT START ... AND IT HAPPENS ONCE"), and before this section the only
// door that could reach the table was `systemDb(reason)`, whose vocabulary is
// `'nightly-batch' | 'operator-console'`. A request handler is neither, which is
// ADR-102 clause 3's finding arriving on the write side, and the route has
// answered 503 for it since the file was written.
//
// -----------------------------------------------------------------------------
// THE NARROWNESS IS STRUCTURAL AND NOT CHECKED, WHICH IS THE ONLY KIND WORTH
// HAVING
// -----------------------------------------------------------------------------
// The rule names WHICH of the two identity columns the writer is, and this
// builder STAMPS the handle's own identity into it -- `scopedInsertStatement`'s
// construction exactly, on the one class that has a second identity column
// sitting beside the stamped one. A caller naming that column, in either
// spelling, is REFUSED rather than overwritten, on that function's own stated
// ground that silently overwriting a value somebody wrote is how a wrong belief
// survives a code review.
//
// SO "A HANDLER PARTY TO PAIR A CANNOT WRITE A ROW FOR PAIR B" IS NOT A
// VALIDATION. There is no parameter through which the writer's own column could
// be supplied, so every row this door can write names the handle's identity as a
// party. The suite asserts it from both sides: the stamped bind is the handle's
// identity on every rendered statement, and the two spellings that would set it
// otherwise both throw.
//
// WHAT IT DOES NOT PROVE IS WHO THE COUNTERPARTY IS, AND THAT IS STATED RATHER
// THAN LEFT TO BE ASSUMED. The counterparty is the caller's value and this file
// validates nothing about it beyond its presence. Two reasons it is not
// tightened here: the identity it names is one the caller already held (on
// `attributions` it comes out of a coupon the buyer typed or a click token the
// buyer presented), and a guard refusing a counterparty EQUAL to the writer
// would make `attributions`' literal self-deal row unwritable --
// `attributions_literal_self_deal_is_void` permits exactly that row, voided, and
// SD-M8-05's whole argument is that "the self-deal check must record WHAT IT
// FOUND, not only its verdict".
//
// NO `RETURNING`, AND IT IS THE REASON THE DISCLOSURE GROUND IS ABSENT RATHER
// THAN OUTWEIGHED. `insertUnderStatement` returns its rows and `insert` returns
// its rows; this returns `void`. A caller that needs the generated `id` is
// asking for something this door does not grant, and the one caller the door
// was built for does not: `CheckoutTx.insertAttribution` is
// `Promise<void>` in its own port.

/**
 * The `pair` tables a party to the row may INSERT into.
 *
 * DERIVED FROM THE REGISTRY RATHER THAN LISTED, WHICH IS THE OPPOSITE CHOICE
 * FROM `ParentedTableKey` AND IS MADE ON THE SAME REASONING. That type is an
 * `Extract` down to one member because `DerivedTableKey` contains
 * `ledger_entries`: the CLASS is not the ruling there, so the list has to be.
 * Here the ruling IS per table and it is in the registry -- `PairRule.writer` is
 * required, carries its own `why`, and defaults to nothing -- so an `Extract`
 * would be a second statement of a decision already written once, which is the
 * drift `packages/db` exists to keep to one. A `pair` table added later reaches
 * this door only by an author writing `by: 'party'` and a reason beside it.
 */
export type PartyWritableTableKey = {
  [K in PairTableKey]: (typeof SCOPE_RULES)[K]['writer'] extends { readonly by: 'party' }
    ? K
    : never;
}[PairTableKey];

/**
 * INSERT one row of a `pair` table, AS ONE OF ITS TWO PARTIES.
 *
 * Every refusal below is a throw and not a type, on `refuseTenancyColumn`'s
 * stated ground: the offending key is a string at the moment it is passed, so a
 * runtime can see it perfectly well, and making it a compile error would mean a
 * conditional type over every column of every table at every call site.
 *
 * IT RETURNS `void` AND BUILDS NO `RETURNING`. See this section's header.
 */
export async function pairInsertStatement(
  source: StatementSource,
  key: PartyWritableTableKey,
  identityId: IdentityId,
  values: WriteValues,
): Promise<void> {
  // WIDENED DELIBERATELY, for `insertUnderStatement`'s stated reason: indexing
  // at a literal key narrows this to the one rule `attributions` carries and
  // makes both guards below unreachable branches, which the compiler reports
  // from inside their own error messages. Widening restores the union, so the
  // guards are written against the REGISTRY rather than against the type.
  const rule: ScopeRule = SCOPE_RULES[key as TableKey];
  if (rule.class !== 'pair') {
    throw new Error(
      `${key} is registered "${rule.class}" and insertAsParty writes a row that belongs to TWO ` +
        'identities. An owned or root row carries one tenancy column, which `insert` stamps; a ' +
        'derived row proves a parent; a firm row belongs to nobody. The registry moved and this ' +
        'door did not follow it.',
    );
  }
  if (rule.writer.by !== 'party') {
    throw new Error(
      `${key} is registered "pair" with writer.by === "${rule.writer.by}" (${rule.writer.why}), ` +
        'so no party to one of its rows may author one. ADR-230 makes that the DEFAULT answer ' +
        'and this door serves only the tables whose rule says otherwise.',
    );
  }

  const writerColumn = rule.writer.column;
  if (writerColumn !== rule.columnA && writerColumn !== rule.columnB) {
    // REGISTRY DRIFT AND NOT A CALLER ERROR. A writer column that is neither of
    // the two identity columns would be a stamp into a column no identity is
    // declared on, which is an unscoped write wearing this door's clothes.
    throw new Error(
      `${key}'s writer column "${writerColumn}" is neither "${rule.columnA}" nor ` +
        `"${rule.columnB}", so stamping it would write an identity into a column the registry ` +
        'does not call an identity column. The rule and its own writer have drifted.',
    );
  }
  const counterpartyColumn = writerColumn === rule.columnA ? rule.columnB : rule.columnA;

  refuseTermInValues(key, values);

  const table = TABLES[key] as PgTable;
  const writerProperty = propertyForColumn(table, writerColumn);
  const counterpartyProperty = propertyForColumn(table, counterpartyColumn);
  if (writerProperty === undefined || counterpartyProperty === undefined) {
    throw new Error(
      `scope registry names columns "${writerColumn}" and "${counterpartyColumn}" on ${key}, and ` +
        'at least one does not exist on this table. The registry and the schema have drifted.',
    );
  }

  // THE WRITER'S COLUMN IS REFUSED IN BOTH SPELLINGS, and this is the whole of
  // the narrowness. `refuseTenancyColumn` is NOT reused: it refuses BOTH of a
  // pair row's columns, and the counterparty is the one value this door genuinely
  // needs from the caller.
  for (const named of Object.keys(values)) {
    if (named !== writerColumn && named !== writerProperty) continue;
    throw new Error(
      `"${named}" is ${key}'s WRITER column and insertAsParty never takes it from the caller. ` +
        'The handle stamps its own identity there, which is what makes a row for a pair this ' +
        'caller is not party to unwritable rather than merely refused.',
    );
  }

  // AND THE COUNTERPARTY IS REQUIRED IN EXACTLY ONE SPELLING, which is
  // `insertUnderStatement`'s guard for its own reason: Drizzle keys a values
  // object by PROPERTY name, so a caller writing the SQL spelling would have the
  // column silently dropped and the row would fail at a `NOT NULL` it thought it
  // had satisfied -- or, worse, on a nullable column, commit a pair row with one
  // party.
  if (
    counterpartyProperty !== counterpartyColumn &&
    Object.prototype.hasOwnProperty.call(values, counterpartyColumn)
  ) {
    throw new Error(
      `"${counterpartyColumn}" is ${key}'s SQL column name and a values object is keyed by ` +
        `Drizzle property name. Name "${counterpartyProperty}" instead: written this way the ` +
        'column is dropped from the INSERT and the row records one party rather than two.',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(values, counterpartyProperty)) {
    throw new Error(
      `an insert into ${key} as a party must name "${counterpartyProperty}". A pair row is a ` +
        'statement about TWO identities and the handle can stamp only the one it is bound to.',
    );
  }
  const counterparty = values[counterpartyProperty];
  if (counterparty === null || counterparty === undefined) {
    throw new Error(
      `"${counterpartyProperty}" is ${counterparty === null ? 'null' : 'undefined'} in an insert ` +
        `into ${key} as a party. A pair row with one identity is not a pair, and both of this ` +
        "table's identity columns are declared NOT NULL.",
    );
  }

  // THE STAMP IS THE LAST WORD AND THE CALLER WAS ALREADY REFUSED ABOVE, which
  // is `scopedInsertStatement`'s order and its reason.
  await source.insert(table).values({ ...values, [writerProperty]: identityId });
}

// -----------------------------------------------------------------------------
// THE TRANSACTION, AND THE `JobTransaction` NOTHING IN THIS WORKSPACE COULD
// PRODUCE (ADR-102 clause 2)
// -----------------------------------------------------------------------------
// `packages/queue`'s `enqueue` takes the caller's open transaction as its FIRST
// argument with no overload that omits it, and its own header says the type is
// "deliberately small enough that `packages/db` can satisfy it without exporting
// its client (ADR-084 section 9 rules `client()` unexported, permanently)".
// `packages/db` did not satisfy it, so NOTHING IN THIS WORKSPACE COULD ENQUEUE A
// JOB. `SqlExecutor` is that shape and `transaction()` is its only producer.
//
// THE ESCAPE HATCH IS NAMED RATHER THAN CARRIED. A handle with `executeSql` on
// it runs arbitrary SQL on the transaction's connection, which is every control
// in this file routed around by a caller who already holds a legitimate handle.
// So it is not a method on the transaction: it is `sqlExecutor(reason)`, taking
// a closed vocabulary the way `systemDb` does, so that "ran raw SQL" is a diff a
// reviewer reads rather than a property nobody looked at. Like VG-4 and like
// `JobTransaction` itself, THIS CLOSES THE ACCIDENTAL DOOR AND NOT THE
// DELIBERATE ONE, and `job-queue.ts` states the same limit about itself.

/** Why raw SQL is running on this transaction. One member, and joining it is a diff. */
export type SqlExecutorReason = 'job-enqueue';

/**
 * A SQL executor bound to one open transaction.
 *
 * STRUCTURALLY IDENTICAL TO `packages/queue`'s `JobTransaction` AND NAMED
 * SEPARATELY ON PURPOSE. Neither package depends on the other: `packages/db`
 * declares no `@merit/queue` dependency and `packages/queue/package.json` states
 * in its own `//` key that `@merit/db`'s absence "is the design rather than an
 * omission". Structural typing is what makes one satisfy the other with no
 * import in either direction, and the suite BINDS the two shapes by reading
 * `packages/queue/src/job-queue.ts` rather than by restating it.
 */
export interface SqlExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** What every transaction handle can do, whatever authority it carries. */
interface TxCommon {
  /**
   * A raw SQL executor on this transaction's connection.
   *
   * The one door out of this file, and it is a word somebody has to write.
   */
  sqlExecutor(reason: SqlExecutorReason): SqlExecutor;
}

/**
 * A transaction bound to ONE identity.
 *
 * `insert` is `OwnedTableKey` and `update`/`delete` are the whole of
 * `ScopedTableKey`, and the asymmetry is the one this section opens with: an
 * UPDATE and a DELETE have a `WHERE` clause and carry `scopePredicate` into it,
 * and an INSERT has none, so the identity must be written and only `owned` rows
 * have a column to write it to.
 *
 * THERE IS NO NESTED `transaction`. A savepoint is a primitive no caller has
 * asked for, and `job-queue.ts`'s rule applies to this file too: a primitive
 * admitted before a caller exists is a primitive nobody can remove.
 */
export interface ScopedTx extends TxCommon {
  readonly __brand: 'ScopedTx';
  readonly identityId: IdentityId;
  rows<K extends ScopedTableKey>(key: K): Promise<unknown[]>;
  insert<K extends OwnedTableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  /**
   * INSERT one row of a `derived` table whose PARENT this handle proves.
   *
   * `ParentedTableKey` is a CLOSED LIST and not the whole class, for the reason
   * the establishment section measures: `ledger_entries` is `derived` and a
   * generic version of this method would hand a request handler one leg of a
   * double-entry posting.
   */
  insertUnder<K extends ParentedTableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  /**
   * INSERT one row of a `pair` table, AS ONE OF ITS TWO PARTIES (ADR-230).
   *
   * `PartyWritableTableKey` is derived from `PairRule.writer`, so the set of
   * tables reachable here is exactly the set whose registry rule says a party
   * may author the row, each with its own reason.
   *
   * THE WRITER'S OWN IDENTITY COLUMN IS STAMPED AND CANNOT BE SUPPLIED, so a
   * handler party to one pair cannot write a row for another. The counterparty
   * is required and is the caller's.
   *
   * IT RETURNS NOTHING. `insert` and `insertUnder` return their rows; this
   * builds no `RETURNING` clause, which is why ADR-106's disclosure ground is
   * absent here rather than outweighed. Reading a `pair` row is still refused at
   * every authority below `systemDb(reason)`.
   */
  insertAsParty<K extends PartyWritableTableKey>(key: K, values: WriteValues): Promise<void>;
  /** Rows matching a filter, ANDed with this identity's scope. Many rows. */
  rowsWhere<K extends ScopedTableKey, F extends RowFilter<K>>(
    key: K,
    where: NamesAColumn<K, F>,
  ): Promise<unknown[]>;
  /** ONE row, or `undefined`. The address must name a unique key. */
  rowAt<K extends ScopedTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown>;
  /**
   * ONE row of this identity's, LOCKED until this transaction ends (ADR-157).
   *
   * `rowAt` plus `FOR UPDATE`, on the same predicate, so a caller scoped to one
   * identity naming another's row locks nothing and reads `undefined`.
   */
  lockAt<K extends ScopedTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown>;
  /**
   * Lock THIS HANDLE'S OWN identity row until this transaction ends (ADR-157).
   *
   * `INV-M20-01`'s per-identity lock, and it takes NO argument at all, so there
   * is no address a caller could point at somebody else.
   */
  lockScope(): Promise<unknown>;
  /** Write ONE row of this identity's. Tenancy and address are BOTH in the `WHERE`. */
  updateAt<K extends ScopedTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
    values: WriteValues,
  ): Promise<unknown[]>;
  /** Remove ONE row of this identity's. */
  deleteAt<K extends ScopedTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown[]>;
}

/**
 * A transaction that reaches EVERY identity's rows.
 *
 * THE TWO-WORD VOCABULARY NOW AUTHORIZES WRITING AND NOT ONLY READING, and that
 * is the widening ADR-102 section 5 prices rather than hides. `'nightly-batch'`
 * computes rows for every account and a batch that cannot write is not a batch;
 * `'operator-console'` is the one that costs, because an operator handle now
 * reaches every row in the estate with one word.
 */
export interface SystemTx extends TxCommon {
  readonly __brand: 'SystemTx';
  readonly reason: SystemReason;
  rows<K extends TableKey>(key: K): Promise<unknown[]>;
  insert<K extends TableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  rowsWhere<K extends TableKey, F extends RowFilter<K>>(
    key: K,
    where: NamesAColumn<K, F>,
  ): Promise<unknown[]>;
  rowAt<K extends TableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown>;
  /**
   * ONE row, LOCKED until this transaction ends (ADR-157).
   *
   * HERE BECAUSE `INV-M5-07`'s LOCK IS SHARED WITH THE NIGHTLY BATCH. A lock
   * only the request handler takes is not a lock, so the authority the batch
   * runs at has to be able to take the same one.
   */
  lockAt<K extends TableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown>;
  updateAt<K extends TableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
    values: WriteValues,
  ): Promise<unknown[]>;
  deleteAt<K extends TableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown[]>;
}

/** A transaction over rows that belong to nobody. `FirmTableKey` and nothing else. */
export interface FirmTx extends TxCommon {
  readonly __brand: 'FirmTx';
  rows<K extends FirmTableKey>(key: K): Promise<unknown[]>;
  insert<K extends FirmTableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  rowsWhere<K extends FirmTableKey, F extends RowFilter<K>>(
    key: K,
    where: NamesAColumn<K, F>,
  ): Promise<unknown[]>;
  rowAt<K extends FirmTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown>;
  updateAt<K extends FirmTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
    values: WriteValues,
  ): Promise<unknown[]>;
  deleteAt<K extends FirmTableKey, A extends RowAddress<K>>(
    key: K,
    at: NamesAColumn<K, A>,
  ): Promise<unknown[]>;
}

/**
 * Build the three transaction handles over one connection.
 *
 * ONE BUILDER PER AUTHORITY AND NOT ONE GENERIC ONE, because the difference
 * between them is exactly the three key types and the presence or absence of a
 * predicate, and a generic that erased those would be a generic over the only
 * thing this file exists to keep distinct.
 */
export function scopedTx(
  source: StatementSource,
  conn: PoolClient,
  identityId: IdentityId,
): ScopedTx {
  return {
    __brand: 'ScopedTx',
    identityId,
    sqlExecutor: (reason) => sqlExecutorOn(conn, reason),
    async rows<K extends ScopedTableKey>(key: K): Promise<unknown[]> {
      return (await selectStatement(source, key, scopePredicate(key, identityId))) as unknown[];
    },
    async insert<K extends OwnedTableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      return (await scopedInsertStatement(
        source,
        key,
        identityId,
        values,
      ).returning()) as unknown[];
    },
    async insertUnder<K extends ParentedTableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      // THE READ AND THE WRITE ARE ON `source`, which is this transaction's own
      // handle. Proving the parent on `client()` would prove it against
      // committed state and leave the window ADR-102 section 4 calls a race.
      return await insertUnderStatement(source, key, identityId, values);
    },
    async insertAsParty<K extends PartyWritableTableKey>(
      key: K,
      values: WriteValues,
    ): Promise<void> {
      // THE IDENTITY IS THE HANDLE'S AND THERE IS NO SECOND PLACE IT COULD COME
      // FROM. This method takes a key and a row, exactly like `insert`, and the
      // stamped column is the registry's answer rather than this call site's.
      await pairInsertStatement(source, key, identityId, values);
    },
    async rowsWhere<K extends ScopedTableKey, F extends RowFilter<K>>(
      key: K,
      where: NamesAColumn<K, F>,
    ): Promise<unknown[]> {
      return (await selectStatement(
        source,
        key,
        scopedFilterPredicate(key, identityId, where),
      )) as unknown[];
    },
    async rowAt<K extends ScopedTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown> {
      refuseUnaddressed(key, at, handlePinnedColumns(key));
      const found = (await selectStatement(
        source,
        key,
        scopedAddressPredicate(key, identityId, at),
      )) as unknown[];
      return oneOrNone(key, found);
    },
    async lockAt<K extends ScopedTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown> {
      // EVERY GUARD `rowAt` RUNS, IN THE SAME ORDER, and then the lock. The two
      // read the same predicate from the same builder, so "a lock reaches
      // exactly what the read reaches" is a property of the code rather than of
      // two call sites agreeing.
      refuseUnaddressed(key, at, handlePinnedColumns(key));
      const found = (await lockingSelectStatement(
        source,
        key,
        scopedAddressPredicate(key, identityId, at),
      )) as unknown[];
      return oneOrNone(key, found);
    },
    async lockScope(): Promise<unknown> {
      // `identities` is the registry's only `root` and its rule is `id`, so
      // `scopePredicate` renders `identities.id = $1` and the caller supplies
      // nothing. There is no address here to point at another identity.
      const found = (await lockingSelectStatement(
        source,
        'identities',
        scopePredicate('identities', identityId),
      )) as unknown[];
      return oneOrNone('identities', found);
    },
    async updateAt<K extends ScopedTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
      values: WriteValues,
    ): Promise<unknown[]> {
      return (await scopedUpdateStatement(
        source,
        key,
        values,
        scopedWritePredicate(key, identityId, at),
      )) as unknown[];
    },
    async deleteAt<K extends ScopedTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown[]> {
      return (await scopedDeleteStatement(
        source,
        key,
        scopedWritePredicate(key, identityId, at),
      )) as unknown[];
    },
  };
}

export function systemTx(
  source: StatementSource,
  conn: PoolClient,
  reason: SystemReason,
): SystemTx {
  return {
    __brand: 'SystemTx',
    reason,
    sqlExecutor: (r) => sqlExecutorOn(conn, r),
    async rows<K extends TableKey>(key: K): Promise<unknown[]> {
      return (await selectStatement(source, key, undefined)) as unknown[];
    },
    async insert<K extends TableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      return (await unscopedInsertStatement(source, key, values).returning()) as unknown[];
    },
    async rowsWhere<K extends TableKey, F extends RowFilter<K>>(
      key: K,
      where: NamesAColumn<K, F>,
    ): Promise<unknown[]> {
      return (await selectStatement(source, key, unscopedFilterPredicate(key, where))) as unknown[];
    },
    async rowAt<K extends TableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown> {
      refuseUnaddressed(key, at);
      const found = (await selectStatement(
        source,
        key,
        unscopedAddressPredicate(key, at),
      )) as unknown[];
      return oneOrNone(key, found);
    },
    async lockAt<K extends TableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown> {
      refuseUnaddressed(key, at);
      const found = (await lockingSelectStatement(
        source,
        key,
        unscopedAddressPredicate(key, at),
      )) as unknown[];
      return oneOrNone(key, found);
    },
    async updateAt<K extends TableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
      values: WriteValues,
    ): Promise<unknown[]> {
      return (await unscopedUpdateStatement(
        source,
        key,
        values,
        unscopedWritePredicate(key, at),
      )) as unknown[];
    },
    async deleteAt<K extends TableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown[]> {
      return (await unscopedDeleteStatement(
        source,
        key,
        unscopedWritePredicate(key, at),
      )) as unknown[];
    },
  };
}

export function firmTx(source: StatementSource, conn: PoolClient): FirmTx {
  return {
    __brand: 'FirmTx',
    sqlExecutor: (reason) => sqlExecutorOn(conn, reason),
    async rows<K extends FirmTableKey>(key: K): Promise<unknown[]> {
      return (await selectStatement(source, key, undefined)) as unknown[];
    },
    async insert<K extends FirmTableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      return (await unscopedInsertStatement(source, key, values).returning()) as unknown[];
    },
    async rowsWhere<K extends FirmTableKey, F extends RowFilter<K>>(
      key: K,
      where: NamesAColumn<K, F>,
    ): Promise<unknown[]> {
      return (await selectStatement(source, key, unscopedFilterPredicate(key, where))) as unknown[];
    },
    async rowAt<K extends FirmTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown> {
      refuseUnaddressed(key, at);
      const found = (await selectStatement(
        source,
        key,
        unscopedAddressPredicate(key, at),
      )) as unknown[];
      return oneOrNone(key, found);
    },
    async updateAt<K extends FirmTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
      values: WriteValues,
    ): Promise<unknown[]> {
      return (await unscopedUpdateStatement(
        source,
        key,
        values,
        unscopedWritePredicate(key, at),
      )) as unknown[];
    },
    async deleteAt<K extends FirmTableKey, A extends RowAddress<K>>(
      key: K,
      at: NamesAColumn<K, A>,
    ): Promise<unknown[]> {
      return (await unscopedDeleteStatement(
        source,
        key,
        unscopedWritePredicate(key, at),
      )) as unknown[];
    },
  };
}

/**
 * The raw executor, bound to one connection.
 *
 * IT TAKES THE CONNECTION AND NOT A DRIZZLE HANDLE, and that is not an
 * implementation detail. `JobTransaction.executeSql` is `(text, values)` with
 * `$n` placeholders, which is `pg`'s own call shape exactly; routing it through
 * Drizzle would mean splitting the vendor's generated SQL on `$n` and rebuilding
 * it as template chunks, and a text transform over somebody else's SQL breaks
 * the first time a dollar-quoted string or a literal `$1` goes through it.
 */
function sqlExecutorOn(conn: PoolClient, reason: SqlExecutorReason): SqlExecutor {
  // The vocabulary is closed by the TYPE. This reads it so the parameter is not
  // decorative, and so a cast past the type still names its reason.
  if (reason !== 'job-enqueue') {
    throw new Error(`"${String(reason)}" is not a reason to run raw SQL on this transaction.`);
  }
  return {
    async executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
      const result = await conn.query(text, values);
      return { rows: result.rows as unknown[] };
    },
  };
}

/**
 * Run `fn` inside one database transaction, with the authority `handle` carries.
 *
 * THE HANDLE IS THE ARGUMENT AND NOT A STRING, so the write path cannot be
 * reached without first having chosen a scope -- which is ADR-008's "reach the
 * database and choose a scope are the SAME ACT", extended to the side that
 * writes.
 *
 * `BEGIN` / `COMMIT` / `ROLLBACK` ARE ISSUED ON THE CONNECTION RATHER THAN
 * THROUGH Drizzle's `db.transaction`, because `sqlExecutor` needs that same
 * connection as a `pg` client and Drizzle exposes no supported way to reach one
 * from inside its own transaction callback. One connection, one transaction, one
 * place the two views of it are created.
 */
/**
 * The pool `client()` holds, narrowed with a check rather than with a bare cast.
 *
 * `drizzle(pool, ...)` attaches `$client` to the handle it returns and
 * `client.ts` declares its return type as plain `NodePgDatabase<typeof schema>`,
 * which erases it. THAT FILE IS OUTSIDE THIS SESSION'S FENCE, so the property is
 * recovered here and PROVED at runtime instead of asserted by a cast, and the
 * suite watches this function returning a pool. `pg` is imported for its TYPES
 * ONLY, which erases, so `client.ts` remains the only file in the workspace that
 * imports it at runtime.
 */
function poolFromClient(): Pool {
  const handle = client() as unknown as { readonly $client?: unknown };
  const candidate = handle.$client;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as Pool).connect !== 'function' ||
    typeof (candidate as Pool).totalCount !== 'number'
  ) {
    throw new Error(
      'client() no longer exposes a pg Pool on `$client`. The transaction primitive ' +
        "needs the connection itself, because JobTransaction.executeSql is pg's own " +
        'call shape. Drizzle changed and packages/db has to follow it.',
    );
  }
  return candidate as Pool;
}

export function transaction<T>(handle: ScopedDb, fn: (tx: ScopedTx) => Promise<T>): Promise<T>;
export function transaction<T>(handle: SystemDb, fn: (tx: SystemTx) => Promise<T>): Promise<T>;
export function transaction<T>(handle: FirmDb, fn: (tx: FirmTx) => Promise<T>): Promise<T>;
/**
 * THE ESTABLISHMENT DOOR HAS AN OVERLOAD WHERE `resolutionDb` DELIBERATELY HAS
 * NONE, and the asymmetry is the ruling rather than an oversight. That door
 * READS one row and can be composed into nothing; this one WRITES two rows that
 * ADR-196 clause 2 requires to commit or fail together, and `transaction` is the
 * only thing in this file that can make two statements one unit of work.
 */
export function transaction<T>(
  handle: EstablishmentDb,
  fn: (tx: EstablishmentTx) => Promise<T>,
): Promise<T>;
export async function transaction<T>(
  handle: ScopedDb | SystemDb | FirmDb | EstablishmentDb,
  fn: (tx: never) => Promise<T>,
): Promise<T> {
  const conn = await poolFromClient().connect();
  try {
    await conn.query('BEGIN');
    let result: T;
    try {
      const source = drizzle(conn, { schema });
      const tx =
        handle.__brand === 'ScopedDb'
          ? scopedTx(source, conn, handle.identityId)
          : handle.__brand === 'SystemDb'
            ? systemTx(source, conn, handle.reason)
            : handle.__brand === 'EstablishmentDb'
              ? establishmentTx(source)
              : firmTx(source, conn);
      result = await fn(tx as never);
    } catch (cause) {
      // A failed ROLLBACK must not replace the error that caused it. The
      // connection is released either way and `pg` discards a poisoned one.
      await conn.query('ROLLBACK').catch(() => undefined);
      throw cause;
    }
    await conn.query('COMMIT');
    return result;
  } finally {
    conn.release();
  }
}
