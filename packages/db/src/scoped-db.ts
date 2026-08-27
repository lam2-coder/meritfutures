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

    case 'pair':
      // UNREACHABLE THROUGH THE SCOPED ACCESSOR, AND NOT FOR `firm`'s REASON
      // (ADR-106). A predicate EXISTS here and is deliberately not built:
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
 * A narrowing over declared columns. Equality, ANDed, and nothing else.
 *
 * There is no `OR`, no `IN`, no range and no `IS NULL`, and each absence is the
 * same decision: a shape a caller can compose freely is a shape a caller can
 * compose wrongly, and every one of them is a diff on this file with an
 * argument attached when a caller needs it.
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
 * The equality conjunction one filter renders.
 *
 * THE COLUMNS ARE SORTED, so the rendered SQL of one filter is the same text
 * whatever order the caller wrote its keys in. That is what lets the suite
 * assert the text rather than parse it.
 *
 * A `null` OR `undefined` VALUE IS REFUSED and the reason is not tidiness.
 * Rendered as `col = NULL` it matches nothing, so the write is silently a
 * no-op; rendered as `col IS NULL` it stops bounding the row count, because a
 * unique key over a nullable column admits many NULL rows in Postgres. Neither
 * reading is a row this accessor should write, so neither is offered.
 */
function addressPredicate(key: TableKey, at: Readonly<Record<string, unknown>>): SQL {
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
    if (value === null || value === undefined) {
      throw new Error(
        `"${property}" is ${value === null ? 'null' : 'undefined'} in a filter on ${key}. ` +
          'Equality against NULL matches nothing and `IS NULL` does not name one row, so a ' +
          'null is refused rather than guessed at.',
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

/** The read predicate for a filter, with the tenancy narrowing ANDed. */
export function scopedFilterPredicate<K extends ScopedTableKey>(
  key: K,
  identityId: IdentityId,
  where: RowFilter<K>,
): SQL {
  refusePinnedColumn(key, where);
  return bothOf(scopePredicate(key, identityId), addressPredicate(key, where));
}

/** The read predicate for a filter at an authority that carries no identity. */
export function unscopedFilterPredicate<K extends TableKey>(key: K, where: RowFilter<K>): SQL {
  return addressPredicate(key, where);
}

/** UPDATE. The `WHERE` clause is not optional and there is no builder without one. */
function updateStatementOn(
  source: StatementSource,
  key: TableKey,
  values: WriteValues,
  where: SQL,
): unknown {
  refuseTenancyColumn(key, values);
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
// hand a request handler all 104 registered tables at six verbs in exchange for
// one table at one verb. A closed vocabulary of WHICH grants exactly what it
// names. So both constructions below take a TABLE vocabulary, `SystemReason`
// stays at two members for the third time (ADR-096 clause 3, ADR-102 clause 3,
// and here), and `SqlExecutorReason` stays at one.
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
        'parent to prove. The registry moved and this list did not follow it.',
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
        scopedFilterPredicate(key, identityId, at),
      )) as unknown[];
      return oneOrNone(key, found);
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
        unscopedFilterPredicate(key, at),
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
        unscopedFilterPredicate(key, at),
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
