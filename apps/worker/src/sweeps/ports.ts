// =============================================================================
// apps/worker/src/sweeps/ports.ts
// =============================================================================
// THE HOURLY EXPIRY SWEEP'S I/O BOUNDARY, DECLARED STRUCTURALLY AND IMPORTING
// NOTHING.
//
// `batch/ports.ts` and `provisioning/ports.ts` are the idiom, and THE REASON
// BOTH OF THEM GIVE HAS BEEN SUPERSEDED BY A BETTER ONE. They say
// `apps/worker/package.json` declares `@merit/rules-engine` and nothing else, so
// `@merit/db` is unresolvable here. **That stopped being true on 2026-08-27**:
// ADR-165 admitted the accessor to this deployable's manifest. The structural
// declaration is not weakened by that; it is now REQUIRED rather than merely
// forced, because the same entry rules ONE door and ONE acquisition point --
// `src/db.ts` -- and states the check in terms: `grep -rlE "from '@merit/db'"
// apps/worker/src` must print `apps/worker/src/db.ts` AND NOTHING ELSE. This
// file is not that file. So every shape this job needs is DECLARED here and
// SATISFIED structurally by the accessor the wiring supplies, and the suite
// asserts the absence of the import rather than trusting a manifest to enforce
// it. `@merit/db`'s `SystemTx` is
// assignable to `ExpiryTx` with no import in either direction, and the suite
// binds the two by reading the accessor's source rather than by restating it.
//
// THIS FILE MUST NOT GROW A `pg` IMPORT. `merit/no-raw-db-client` is attached to
// `apps/**` and this path is inside it. NOTHING HERE ADDS A `SqlExecutorReason`
// MEMBER, ADDS A `SystemReason` MEMBER, OR CASTS PAST A KEY TYPE
// (P5 section 11 rule 10, P7 section 11 rule 10).
//
// -----------------------------------------------------------------------------
// A SWEEP IS NOT A BATCH STEP, WHICH IS WHY THIS FILE EXISTS AT ALL
// -----------------------------------------------------------------------------
// P5 section 9 rows `apps/worker/src/batch/ports.ts` as held by `P5-k` and by
// two cross-phase slices, and rules that `P5-j` declares its own file instead:
// "a sweep is not a batch step and folding it in would give the hourly job the
// nightly job's dependency graph". The nightly batch needs a resolved plan, a
// rule state, a calendar slice and a day's marks. This job needs a clock and two
// tables.
//
// -----------------------------------------------------------------------------
// THE AUTHORITY THIS JOB RUNS AT IS THE WIRING'S, AND THE GAP IS REPORTED
// -----------------------------------------------------------------------------
// THIS FILE REPORTED A GAP HERE AND ADR-165 HAS SINCE RULED IT SHUT, IN THE
// DIRECTION THAT COSTS NOTHING. The report read: `SystemReason` is
// `'nightly-batch' | 'operator-console'`, an hourly sweep is neither of those
// words, adding a third is `P5-a`'s line to write, and P5 rule 10 says to report
// it and stop rather than reach. **The ruling is that `SystemReason` gains NO
// member**, because `'nightly-batch'` "already names what a detector run, a
// fold, a sweep and a nightly assertion each are", and a member minted for a
// SERVICE rather than for a KIND of access is the vocabulary joining itself.
// `apps/worker` runs at `systemDb('nightly-batch')` through `src/db.ts`, which
// declares no reason parameter at all, so `'operator-console'` is unreachable
// from this deployable BY CONSTRUCTION.
//
// **SO THE VOCABULARY WAS NEVER THE OBSTACLE, AND NOT REACHING FOR IT WAS THE
// RIGHT CALL RATHER THAN A LUCKY ONE**: a session that had added the third
// member would have spent a widening on a question whose answer was that there
// was nothing to add. `ExpirySweepIo.transact` still takes the whole unit of
// work, which is `AdminPayoutBackend.operator`'s shape and its stated reason: a
// transaction cannot outlive the function that opened it and no caller has a
// `commit` to forget. WHAT IS STILL MISSING IS AN ADAPTER, NOT A WORD.
// =============================================================================

// -----------------------------------------------------------------------------
// The two tables, and no others
// -----------------------------------------------------------------------------

/**
 * The tables this job reads and writes, as a closed union.
 *
 * A NARROW UNION RATHER THAN THE WHOLE KEY SPACE, on `provisioning/ports.ts`'s
 * argument: `SystemTx.updateAt` reaches every table in the estate with one word,
 * which ADR-102 section 8 prices as the widening it accepts, and a sweep that
 * accepted the same reach would spend that budget again for nothing. The
 * narrowing costs the caller nothing, because a wider handle is assignable to a
 * narrower shape.
 *
 * `ledgerTransactions` and `ledgerEntries` are absent DELIBERATELY. The posting
 * does not go through this handle; it goes through {@link ExpiryLedgerPort}, so
 * nothing here can write a ledger row by naming a key.
 *
 * The suite asserts that both members are real `TableKey`s of `packages/db`,
 * which is the half this file cannot assert itself.
 */
export const EXPIRY_TABLES = ['payoutRequests', 'walletWithdrawals'] as const;

/** One of {@link EXPIRY_TABLES}. */
export type ExpiryTable = (typeof EXPIRY_TABLES)[number];

// -----------------------------------------------------------------------------
// ADR-157's terms, as this file must be able to name them
// -----------------------------------------------------------------------------

/**
 * One column's narrowing when it is not an equality, as ADR-157 minted it.
 *
 * IT IS DECLARED AND NEVER CONSTRUCTED HERE. `packages/db` keeps a `WeakSet` of
 * the terms it minted and `isFilterTerm` reads identity rather than shape,
 * precisely so a caller cannot hand-roll one: a `jsonb` column holding an object
 * that looks like a term is a VALUE, and a shape check would read it as a range.
 * So this type exists to let {@link ExpirySweepIo} say what its filters carry,
 * and the actual terms come in through {@link ExpiryTerms}.
 */
export type ExpiryFilterTerm =
  | { readonly term: 'at-most'; readonly value: unknown }
  | { readonly term: 'at-least'; readonly value: unknown }
  | { readonly term: 'is-null' };

/**
 * ADR-157's two READ-PATH constructors, supplied by the wiring.
 *
 * THE CONSTRUCTORS ARE INJECTED RATHER THAN IMPORTED because a term is only a
 * term if `packages/db` minted it, and this app cannot import that package. A
 * fake in the suite mints its own and the sweep cannot tell the difference,
 * which is correct: what the sweep is responsible for is WHICH term goes on
 * WHICH column, and that is exactly what the suite asserts.
 *
 * `atMost` IS INCLUSIVE AND ITS BOUND IS THE SWEEP'S CLOCK, NEVER THE
 * DATABASE'S. ADR-157 states the reason in terms: rendering `now()` would put
 * the database's clock in a money path that MERIT_BUILD_MASTER_PROMPT keeps as
 * data, and would make every expiry test unwritable.
 *
 * THERE IS NO `isNotNull` AND NONE IS REACHED FOR. ADR-157 refuses it by name,
 * and this job does not need it: `atMost` already excludes a null clock, because
 * `NULL <= x` is NULL and never matches.
 */
export interface ExpiryTerms {
  /** `column <= value`, inclusive. */
  atMost(value: NonNullable<unknown>): ExpiryFilterTerm;
  /** `column IS NULL`. */
  isNull(): ExpiryFilterTerm;
}

/** An address or a filter, by Drizzle property name. ADR-112's shape. */
export type ExpiryFilter = Readonly<Record<string, unknown>>;

/** A set of values to write, by Drizzle property name. */
export type ExpiryValues = Readonly<Record<string, unknown>>;

// -----------------------------------------------------------------------------
// One open transaction, as this job needs to see it
// -----------------------------------------------------------------------------

/**
 * One open transaction.
 *
 * `update` AND `delete` ARE ABSENT BECAUSE THEY ARE ABSENT FROM EVERY
 * TRANSACTION HANDLE IN THIS WORKSPACE (ADR-112). The accessors are `rowsWhere`,
 * `lockAt` and `updateAt`, and nothing here reaches for another. `deleteAt` is
 * absent because a sweep destroys nothing: every release is an UPDATE.
 *
 * `insert` IS ABSENT TOO, and that is what stops this job writing its own audit
 * row. `admin_actions` is the OPERATOR's record of an operator's decision, and
 * an expiry is nobody's decision: `payout.hold_released` carries
 * `released_by: 'expiry'` for exactly that distinction (EVENTS section 6). A
 * sweep that wrote `admin_actions` rows would have to invent an `actor` for an
 * act with no human in it.
 */
export interface ExpiryTx {
  /**
   * Rows matching a filter. MANY rows, and the READ path is the only place a
   * term may appear (ADR-157).
   */
  rowsWhere(key: ExpiryTable, where: ExpiryFilter): Promise<unknown[]>;
  /**
   * ONE row, LOCKED until this transaction ends (ADR-157).
   *
   * `rowAt` plus `FOR UPDATE` on the same predicate, with the tenancy conjunct
   * attached at the accessor. It is the whole concurrency control for this job:
   * this sweep is the THIRD door onto the hold transition and
   * `admin-payouts.ts`'s release and enforce endpoints are the other two, so an
   * operator releasing a hold in the second before this job reads it must make
   * this job find a row that is no longer held.
   *
   * AN ADVISORY LOCK IS REFUSED BY NAME. ADR-157 clause 4 and P5 and P7 rule 10:
   * `pg_advisory_xact_lock` can only be sent through `sqlExecutor` and carries
   * no tenancy narrowing at all. None is taken and none is reachable from this
   * port.
   */
  lockAt(key: ExpiryTable, at: ExpiryFilter): Promise<unknown>;
  /** Write ONE row. The address must name a unique key. */
  updateAt(key: ExpiryTable, at: ExpiryFilter, values: ExpiryValues): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The ledger, as a port and never as arithmetic
// -----------------------------------------------------------------------------

/**
 * `LT-01`'s six values, field for field with `@merit/ledger`'s `lt01()`.
 *
 * MONEY IS `bigint` AND A `number` IS REFUSED RATHER THAN COERCED. Every
 * `*_cents` column on `payout_requests` is `bigint` and the Drizzle declaration
 * pins `{ mode: 'bigint' }`, so a `number` reaching here means the handle is not
 * the accessor and the value may already have lost digits.
 *
 * `idempotencyKey` IS THE LEDGER TRANSACTION'S KEY AND IS ALREADY DERIVED. See
 * `releaseLedgerKey` in `expiry.ts`: it is the request's OWN stored key under
 * the `PAYOUT_ENDPOINT` prefix `payouts.ts` declares and `admin-payouts.ts`
 * imports, so `LT-01` for one payout request is ONE posting whichever door
 * reaches it. ADR-176 removed the request path's own posting, so the doors that
 * mint the string are this sweep and the operator console; the prefix and the
 * source column are unchanged, which is why the property is unchanged.
 */
export interface Lt01Values {
  readonly identityId: string;
  readonly payoutRequestId: string;
  readonly idempotencyKey: string;
  readonly approvedCents: bigint;
  readonly traderCents: bigint;
  readonly firmCents: bigint;
}

/**
 * The `LT-01` posting, on THIS transaction.
 *
 * SUPPLIED BY THE WIRING AND NOT BUILT HERE, as `AdminPayoutTx.ledger` is one
 * deployable over. This file names no ledger account, writes no
 * transfer and contains no ledger arithmetic: a second transcription of
 * `debit trader_withdrawable / credit trader_wallet / credit fees_revenue` is
 * ADR-092 section 5's two-statements-of-one-fact hazard arriving on the money
 * path, and `lt01` already asserts `INV-M5-03` over the split internally.
 *
 * THIS DOCBLOCK USED TO SPECIFY THE ADAPTER AS `postTransaction(tx.ledger,
 * await readChart(tx.ledger), lt01(values))` AND `tx.ledger` NAMED NOTHING.
 * {@link ExpiryTx} declares three members and not one of them is a ledger
 * handle, so that sentence did not compile against the port immediately below
 * it. ADR-315 ruled the SENTENCE wrong rather than the port. The three members
 * stand and what follows is the shape the wiring will actually take.
 *
 * THE HANDLE STAYS IN THE WIRING AND THIS JOB NEVER HOLDS ONE, WHICH IS THE
 * ONLY SHAPE THAT LEAVES {@link EXPIRY_TABLES}'s EXCLUSION TRUE IN ITS OWN
 * WORDS. A `ledger` member would have to RESTATE `@merit/ledger`'s `LedgerTx`
 * here, because this file imports nothing and `apps/worker/package.json`
 * declares no `@merit/ledger`, and restating it writes both ledger table keys
 * into this file as an `insert` key union. That is the two keys
 * {@link EXPIRY_TABLES} excludes arriving back within reach of the sweep, one
 * call away from a single-sided entry written past `assertBalanced`, past
 * `LEDGER-C1` and past the halt check below. It would break the header's
 * `SystemTx` assignability too, because `SystemTx` has no `ledger` property.
 *
 * SO THE ADAPTER RECOVERS THE HANDLE BY THE IDENTITY OF THE `ExpiryTx` IT IS
 * GIVEN, which is the `WeakSet` idiom {@link ExpiryFilterTerm} already relies
 * on, turned on a handle instead of on a term. The wiring opens ONE
 * transaction, passes it to `transact` as the `ExpiryTx` it already satisfies,
 * records it against itself, and `postLt01` looks it up and REFUSES a handle it
 * did not open, because a handle this wiring did not open is a handle it cannot
 * know the authority of. The posting is then `postTransaction(ledger, await
 * readChart(ledger), lt01(values))` and nothing more, on that same transaction,
 * which is ADR-006's requirement met rather than restated: the `LedgerTx` IS
 * the handle the release was written through and not a second one opened beside
 * it.
 *
 * A live ledger halt refuses the posting and that is left alone:
 * `postTransaction` asserts against `ledger_halts` unless the caller passes
 * `despiteHalt`, and an override is a ruling this job does not take. A refused
 * posting rolls the release back, which is the correct direction: the hold
 * stands and the nightly assertion (`P5-k`) reports it.
 */
export interface ExpiryLedgerPort {
  postLt01(tx: ExpiryTx, values: Lt01Values): Promise<void>;
}

// -----------------------------------------------------------------------------
// The events, as a port that takes the transaction
// -----------------------------------------------------------------------------

/**
 * One event this job emits, by its registry name.
 *
 * ALL THREE ARE ALREADY ROWS IN THE CATALOGUE AND THIS JOB IS THE NAMED
 * PRODUCER OF EACH (EVENTS section 6). Nothing is invented here, which is
 * ADR-159 clause 1: a name becomes a row only where every field is a column a
 * migration declares or a field of a mirror a plan names, and the authority for
 * a name is the registry rather than a producer.
 */
export type ExpiryEventName =
  'payout.hold_released' | 'wallet.withdrawal_halt_released' | 'payout.freeze_expiring';

/** One event, name and payload. */
export interface ExpiryEvent {
  readonly name: ExpiryEventName;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The event sink.
 *
 * IT TAKES THE TRANSACTION, WHICH IS ADR-006's CRITERION RELIED ON RATHER THAN
 * RESTATED: the event commits with the release or not at all, so there is no
 * window in which a hold released and nobody was told, and none in which a
 * trader was told about a release that rolled back.
 *
 * NOTHING IN THIS WORKSPACE WRITES AN EVENT YET. `payouts.ts` and
 * `admin-payouts.ts` both report that gap in their own headers, and `P5-n` is
 * the slice that builds the producer. This file declares WHAT is emitted and
 * refuses to invent a sink, which is the same disposition one directory over.
 */
export interface ExpiryEventPort {
  emit(tx: ExpiryTx, event: ExpiryEvent): Promise<void>;
}

// -----------------------------------------------------------------------------
// Everything the sweep cannot do for itself
// -----------------------------------------------------------------------------

/**
 * The job's whole outside world.
 *
 * `transact` TAKES THE UNIT OF WORK RATHER THAN HANDING BACK A HANDLE, which is
 * `ApiDb`'s and `AdminPayoutBackend`'s shape and their reason: a transaction
 * cannot outlive the function that opened it and no caller has a `commit` to
 * forget. The AUTHORITY is the wiring's decision and the shape is all this file
 * fixes; ADR-165 has since named that authority, `systemDb('nightly-batch')`
 * through `src/db.ts`, and this file's header says why no word was minted.
 *
 * `now` IS INJECTED AND IS THE ONLY CLOCK IN THIS JOB. ADR-157: the bound handed
 * to `atMost` is the sweep's own instant, so a fixture pins it and the database
 * never supplies one.
 */
export interface ExpirySweepIo {
  transact<T>(fn: (tx: ExpiryTx) => Promise<T>): Promise<T>;
  readonly terms: ExpiryTerms;
  readonly ledger: ExpiryLedgerPort;
  readonly events: ExpiryEventPort;
  now(): Date;
}

/**
 * Raised by a port that is not installed.
 *
 * A SWEEP THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE PAYING REAL TRADERS,
 * which is `UNWIRED_ADMIN_PAYOUT_BACKEND`'s sentence and it is worth as much
 * here: the value this one would have to invent is whether a held payout was
 * released and paid.
 */
export class ExpirySweepUnwired extends Error {
  constructor(what: string) {
    super(
      `ExpirySweepIo.${what} cannot be served by this deployment: no adapter is installed. The ` +
        'hourly expiry sweep refuses rather than returning a plausible value, because the value ' +
        'it would have to invent is whether a held payout was released and paid.',
    );
    this.name = 'ExpirySweepUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * `CRON_INVENTORY`'s S1 dead-man switch fires on the JOB'S ABSENCE, so a
 * deployment holding this default is a deployment whose sweep is absent and is
 * alarmed as such. That is the correct outcome and is why the default refuses
 * rather than logging and returning an empty report: an empty report is
 * indistinguishable from a clean sweep.
 */
export const UNWIRED_EXPIRY_SWEEP_IO: ExpirySweepIo = {
  transact: () => Promise.reject(new ExpirySweepUnwired('transact')),
  terms: {
    atMost: () => {
      throw new ExpirySweepUnwired('terms.atMost');
    },
    isNull: () => {
      throw new ExpirySweepUnwired('terms.isNull');
    },
  },
  ledger: { postLt01: () => Promise.reject(new ExpirySweepUnwired('ledger.postLt01')) },
  events: { emit: () => Promise.reject(new ExpirySweepUnwired('events.emit')) },
  now: () => {
    throw new ExpirySweepUnwired('now');
  },
};
