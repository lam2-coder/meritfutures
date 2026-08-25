// =============================================================================
// packages/ledger/src/tx.ts
// =============================================================================
// THE WRITER IS INJECTED, AND THIS PACKAGE CANNOT REACH A DATABASE.
//
// `postTransaction` takes the caller's OPEN transaction as its FIRST argument
// with no overload that omits it. That is `job-queue.ts`'s ruling and ADR-102's
// applied a third time, and here it is load bearing rather than stylistic:
// ADR-006's central consequence is that the ledger movement commits in the SAME
// transaction as the state change that caused it. `INV-M3-13`'s wallet leg and
// M08 section 3.1's attribution both commit inside checkout's transaction; a
// posting library able to open its own would make that optional at every call
// site that forgot, and the failure would be a balance that exists without the
// purchase that justifies it.
//
// SO `@merit/db` IS NOT A DEPENDENCY. This package declares none, cannot import
// `client()` (which ADR-084 section 9 rules unexported permanently anyway),
// cannot import `drizzle-orm` or `pg` (VG-4 bans both outside `packages/db`),
// and therefore cannot open a pool even by mistake.
//
// -----------------------------------------------------------------------------
// WHAT IT COSTS: TWO STATEMENTS OF ONE SHAPE, BOUND BY AN ASSERTION
// -----------------------------------------------------------------------------
// `LedgerTx` restates the subset of ADR-102's `SystemTx` that this path uses,
// which is ADR-092 section 5's two-statements-of-one-fact hazard: a rename in
// `packages/db` leaves this file compiling and wrong. It is closed the only way
// it can be from a package with no dependency edge, which is the way ADR-102
// closed the same problem against `packages/queue`: the suite READS
// `packages/db/src/scoped-db.ts` and compares the two shapes, so a rename there
// fails a test here and the two must move together.
//
// -----------------------------------------------------------------------------
// WHY `SystemTx` AND NOT `ScopedTx` OR `FirmTx`, WHICH IS A FINDING AND NOT A
// PREFERENCE
// -----------------------------------------------------------------------------
// A double-entry posting touches TWO parties' accounts by construction -- a
// trader leg and a firm leg -- so no single-identity handle can write both, and
// ADR-102 section 8 foreclosure 2 says so by name about this slice. `FirmTx`
// cannot serve it either: `firmTx.insert` accepts `FirmTableKey` and
// `ledger_transactions` and `ledger_entries` are both `derived`, not `firm`.
// That leaves `SystemTx`, whose reason vocabulary is exactly `'nightly-batch' |
// 'operator-console'`.
//
// A CHECKOUT POSTING FROM `apps/api` IS NEITHER OF THOSE WORDS. ADR-102 clause 3
// found and named that gap on the READ side -- "a request handler is neither
// SystemReason" -- and answered it with `firmDb()`, a door that does not reach
// these tables. On the WRITE side the gap is open. This library does not invent
// a second door for it: the reason is chosen by whoever opens the transaction,
// which is the caller, so nothing here is blocked and every eventual caller in
// `apps/api` will be. It is reported rather than routed around.

/** The values of one row, keyed by the Drizzle PROPERTY name, as ADR-102's writer takes them. */
export type WriteValues = Readonly<Record<string, unknown>>;

/**
 * The tables this package reads and writes, by registry key.
 *
 * NARROWER THAN `TableKey` ON PURPOSE. `SystemTx` is generic over every table
 * in the estate, and a posting library that accepted the same range could write
 * anywhere; a caller still holds that authority, but nothing in this package
 * exercises it, and a widening is a diff on this union.
 */
export type LedgerReadKey = 'ledgerAccounts' | 'ledgerHalts';
export type LedgerWriteKey = 'ledgerTransactions' | 'ledgerEntries';

/**
 * The open transaction a posting is written through.
 *
 * STRUCTURALLY SATISFIED BY ADR-102's `SystemTx` AND NAMED SEPARATELY ON
 * PURPOSE, on the exact precedent of `SqlExecutor` restating
 * `packages/queue`'s `JobTransaction`. `SystemTx.rows` and `SystemTx.insert`
 * are generic over `TableKey`, so a handle that accepts every key satisfies one
 * that accepts two: the assignment is ordinary parameter contravariance and the
 * suite watches it hold.
 *
 * THERE IS NO `update` AND NO `delete` HERE, AND THAT IS THE POINT OF THE
 * NARROWING. `ledger_entries` is APPEND-ONLY -- `0009`'s own header says so and
 * `0026` grants no UPDATE or DELETE on it -- and `SD-M5-05` rules that a
 * correction is a compensating entry. A posting path that could not name those
 * verbs cannot issue them, whatever authority the handle it was given carries.
 */
export interface LedgerTx {
  rows(key: LedgerReadKey): Promise<unknown[]>;
  insert(key: LedgerWriteKey, values: WriteValues): Promise<unknown[]>;
}
