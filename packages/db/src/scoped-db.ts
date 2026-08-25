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

import { and, eq, exists, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  QueryBuilder,
  type PgColumn,
  type PgDatabase,
  type PgQueryResultHKT,
  type PgTable,
} from 'drizzle-orm/pg-core';
import type { Pool, PoolClient } from 'pg';

import { client } from './client.js';
import * as schema from './schema.js';
import {
  SCOPE_RULES,
  TABLES,
  type FirmTableKey,
  type ScopedTableKey,
  type TableKey,
} from './scope.js';

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
 * The column ON THIS ROW that the scope rule reads. `undefined` for `firm`,
 * which is the class that reads no column because no identity owns the row.
 *
 * DERIVED FROM THE RULE AND NEVER LISTED, for the reason ADR-101 section 6
 * gives about restating the DDL: a second statement of which column carries
 * tenancy is a second thing to keep true.
 */
export function tenancyColumn(key: TableKey): string | undefined {
  const rule = SCOPE_RULES[key];
  switch (rule.class) {
    case 'root':
    case 'owned':
      return rule.column;
    case 'derived':
      // The row reaches its identity THROUGH this column. Re-pointing it moves
      // the row to another identity's subtree, which the scope predicate cannot
      // see because the predicate ran against the value the row had BEFORE.
      return rule.localColumn;
    case 'firm':
      return undefined;
  }
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
  const sqlName = tenancyColumn(key);
  if (sqlName === undefined) return;
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
  return source.insert(TABLES[key] as PgTable).values(values);
}

/**
 * UPDATE carrying a predicate, or none.
 *
 * `where` is REQUIRED IN THE ARGUMENT LIST and `undefined` is spelled out, on
 * `job-queue.ts`'s reasoning about its own transaction argument: an optional
 * predicate is one a caller reaches the unsafe form of by leaving something out.
 */
export function updateStatement(
  source: StatementSource,
  key: TableKey,
  values: WriteValues,
  where: SQL | undefined,
): unknown {
  refuseTenancyColumn(key, values);
  const builder = source.update(TABLES[key] as PgTable).set(values);
  return where === undefined ? builder.returning() : builder.where(where).returning();
}

/** DELETE carrying a predicate, or none. */
export function deleteStatement(
  source: StatementSource,
  key: TableKey,
  where: SQL | undefined,
): unknown {
  const builder = source.delete(TABLES[key] as PgTable);
  return where === undefined ? builder.returning() : builder.where(where).returning();
}

/** SELECT carrying a predicate, or none. */
export function selectStatement(
  source: StatementSource,
  key: TableKey,
  where: SQL | undefined,
): unknown {
  const builder = source.select().from(TABLES[key] as PgTable);
  return where === undefined ? builder : builder.where(where);
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
  update<K extends ScopedTableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  delete<K extends ScopedTableKey>(key: K): Promise<unknown[]>;
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
  update<K extends TableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  delete<K extends TableKey>(key: K): Promise<unknown[]>;
}

/** A transaction over rows that belong to nobody. `FirmTableKey` and nothing else. */
export interface FirmTx extends TxCommon {
  readonly __brand: 'FirmTx';
  rows<K extends FirmTableKey>(key: K): Promise<unknown[]>;
  insert<K extends FirmTableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  update<K extends FirmTableKey>(key: K, values: WriteValues): Promise<unknown[]>;
  delete<K extends FirmTableKey>(key: K): Promise<unknown[]>;
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
    async update<K extends ScopedTableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      return (await updateStatement(
        source,
        key,
        values,
        scopePredicate(key, identityId),
      )) as unknown[];
    },
    async delete<K extends ScopedTableKey>(key: K): Promise<unknown[]> {
      return (await deleteStatement(source, key, scopePredicate(key, identityId))) as unknown[];
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
    async update<K extends TableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      return (await updateStatement(source, key, values, undefined)) as unknown[];
    },
    async delete<K extends TableKey>(key: K): Promise<unknown[]> {
      return (await deleteStatement(source, key, undefined)) as unknown[];
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
    async update<K extends FirmTableKey>(key: K, values: WriteValues): Promise<unknown[]> {
      return (await updateStatement(source, key, values, undefined)) as unknown[];
    },
    async delete<K extends FirmTableKey>(key: K): Promise<unknown[]> {
      return (await deleteStatement(source, key, undefined)) as unknown[];
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
export async function transaction<T>(
  handle: ScopedDb | SystemDb | FirmDb,
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
