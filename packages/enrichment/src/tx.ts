// =============================================================================
// packages/enrichment/src/tx.ts
// =============================================================================
// THE WRITER IS INJECTED, AND THIS PACKAGE CANNOT REACH A DATABASE.
//
// `observeEnrichment` takes the caller's OPEN transaction as its first argument
// with no overload that omits it. That is `job-queue.ts`'s ruling, ADR-102's,
// and `packages/ledger/src/tx.ts`'s, applied a fourth time, and here it is load
// bearing for a reason none of the three shares: this path runs INSIDE
// checkout's transaction (P3 section 9's `P3-p` row is why the slice is money
// path at all), so a library able to open its own connection would record a
// signal that SURVIVES A ROLLED-BACK PURCHASE. An observation of a checkout
// that did not happen is worse than no observation, because ADR-023's whole
// purpose in observe mode is to learn the distribution on Merit's own traffic
// and a distribution polluted by abandoned checkouts is not that.
//
// SO `@merit/db` IS NOT A DEPENDENCY. This package declares none, cannot import
// `client()` (which ADR-084 section 9 rules unexported permanently anyway),
// cannot import `drizzle-orm` or `pg` (VG-4 bans both outside `packages/db`),
// and therefore cannot open a pool even by mistake.
//
// -----------------------------------------------------------------------------
// WHAT IT COSTS: TWO STATEMENTS OF ONE SHAPE, BOUND BY AN ASSERTION
// -----------------------------------------------------------------------------
// `EnrichmentTx` restates the subset of ADR-102's `ScopedTx` that this path
// uses, which is ADR-092 section 5's two-statements-of-one-fact hazard: a
// rename in `packages/db` leaves this file compiling and wrong. It is closed
// the way ADR-102 closed the identical problem against `packages/queue` and the
// way `packages/ledger` closed it against ADR-102: the suite READS
// `packages/db/src/scoped-db.ts` and compares the two shapes, so a rename there
// fails a test here and the two must move together.
//
// -----------------------------------------------------------------------------
// WHY `ScopedTx` AND NOT `SystemTx` OR `FirmTx`
// -----------------------------------------------------------------------------
// Every row this package writes belongs to the ONE identity that is buying.
// `identity_signals` is `owned` on `identity_id NOT NULL` and
// `integration_dispatches` is `owned` on a NULLABLE one, so the scoped handle
// stamps the tenancy on insert and ANDs it into the predicate of an addressed
// write, and this package never names an identity at all. A `SystemTx` would
// have reached every trader's rows to write one trader's observation, which is
// authority this path has no use for.
//
// `integration_contracts` IS NOT IN EITHER LIST AND THAT IS NOT AN OMISSION. It
// is `firm`, so `ScopedTx` cannot name it: `ScopedTableKey` excludes every firm
// table and the read is `TS2345` rather than a leak. `contract.ts` states how
// the row is reached instead, and it is not through this interface.
//
// -----------------------------------------------------------------------------
// THERE IS NO `deleteAt` HERE AND NO `insert` ON A TABLE THIS PACKAGE ONLY
// READS
// -----------------------------------------------------------------------------
// `identity_signals` is the entity graph's node set and `integration_dispatches`
// is APPEND-ONLY by its own DDL comment ("Retention: long, deliberately. A
// privacy deletion request and a vendor breach ask the same question"). A path
// that cannot name `deleteAt` cannot issue one whatever authority the handle it
// was given carries, which is `LedgerTx`'s argument about `ledger_entries`
// applied to the two tables here that have the same property.

/** The values of one row, keyed by the Drizzle PROPERTY name, as ADR-102's writer takes them. */
export type WriteValues = Readonly<Record<string, unknown>>;

/**
 * A narrowing over declared columns: equality, ANDed, and nothing else.
 *
 * ADR-112's `RowFilter<K>` is `Readonly<Partial<Record<AddressableColumn<K>,
 * unknown>>>`, keyed by the Drizzle property names of ONE table. This package
 * cannot name that type without a dependency edge, so it restates the shape a
 * caller passes and lets the real handle's own generic refuse a column the
 * table does not have. The refusal still happens; it happens at the accessor
 * rather than here.
 */
export type RowFilter = Readonly<Record<string, unknown>>;

/**
 * A filter that names AT MOST ONE ROW, which is a promise ADR-112 checks at run
 * time rather than in the type, because uniqueness is a fact about the DATABASE
 * and `tsc` cannot read a migration.
 */
export type RowAddress = RowFilter;

/**
 * The tables this package reads, by registry key.
 *
 * NARROWER THAN `ScopedTableKey` ON PURPOSE, on `LedgerReadKey`'s precedent: a
 * caller still holds the wider authority, nothing here exercises it, and a
 * widening is a diff on this union with an argument attached.
 */
export type EnrichmentReadKey = 'identitySignals';

/** The tables this package writes. Both are `owned`, so both are stamped by the handle. */
export type EnrichmentWriteKey = 'identitySignals' | 'integrationDispatches';

/** The one table this package writes an ADDRESSED update to. See `observe.ts` for why. */
export type EnrichmentUpdateKey = 'identitySignals';

/**
 * The open transaction an observation is recorded through.
 *
 * STRUCTURALLY SATISFIED BY ADR-102's `ScopedTx` AND NAMED SEPARATELY ON
 * PURPOSE, on the exact precedent of `LedgerTx` restating `SystemTx` and of
 * `SqlExecutor` restating `packages/queue`'s `JobTransaction`. `ScopedTx`'s
 * members are generic over `ScopedTableKey`, so a handle that accepts every
 * scoped key satisfies one that accepts two.
 *
 * `updateAt` IS HERE AND `insert` ALONE WOULD NOT SERVE, which is a finding
 * from reading the migration rather than a preference.
 * `identity_signals_identity_kind_value_uq` is a `CREATE UNIQUE INDEX` in
 * `0002_identity.sql`, so a second observation of the same value by the same
 * identity is a DUPLICATE KEY. Inside checkout's transaction a duplicate key is
 * a `ROLLBACK`, and a returning trader buying a second account is the ordinary
 * case rather than the exotic one. See `observe.ts` for the read-then-write
 * this forces and for the residual it does not close.
 */
export interface EnrichmentTx {
  /** Rows matching a filter, ANDed with this identity's scope. Many rows, no uniqueness claim. */
  rowsWhere(key: EnrichmentReadKey, where: RowFilter): Promise<unknown[]>;
  /** Insert one row. The handle stamps the tenancy column and refuses a caller that names it. */
  insert(key: EnrichmentWriteKey, values: WriteValues): Promise<unknown[]>;
  /** Write ONE row of this identity's. Tenancy and address are BOTH in the `WHERE`. */
  updateAt(key: EnrichmentUpdateKey, at: RowAddress, values: WriteValues): Promise<unknown[]>;
}
