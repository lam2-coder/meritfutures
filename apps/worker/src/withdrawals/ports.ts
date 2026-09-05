// =============================================================================
// apps/worker/src/withdrawals/ports.ts
// =============================================================================
// THE WITHDRAWAL APPROVAL SWEEP'S I/O BOUNDARY, DECLARED STRUCTURALLY AND
// IMPORTING NOTHING.
//
// ADR-325 transcribes ADR-316 section 3, which ruled every shape below. Nothing
// here is designed; what is decided here is the one thing that entry left to the
// slice, which is where the module sits, and one thing that entry could not have
// known, which is section 3.3's return type. Both are argued in ADR-325 and
// neither is argued again here.
//
// -----------------------------------------------------------------------------
// A NEW MODULE AND NOT A GROWTH OF `sweeps/ports.ts`, ON THAT FILE'S OWN
// ARGUMENT
// -----------------------------------------------------------------------------
// `EXPIRY_TABLES` is a two-member union declared narrow for a stated reason, and
// that file's header rules that "a sweep is not a batch step and folding it in
// would give the hourly job the nightly job's dependency graph". The identical
// sentence holds one step down: the hourly halt-release job needs two tables and
// a clock, this job needs five tables, a ledger and the wallet's own statement,
// and folding the second into the first would make `EXPIRY_TABLES` carry three
// tables that job never touches.
//
// -----------------------------------------------------------------------------
// IT IMPORTS NOTHING, WHICH IS `sweeps/ports.ts`'s IDIOM AND ADR-165's
// REQUIREMENT
// -----------------------------------------------------------------------------
// ADR-165 rules ONE door and ONE acquisition point for `@merit/db`, which is
// `src/db.ts`, and `test/db.test.ts` runs the specifier scan that holds it. So
// every shape this job needs is DECLARED here and SATISFIED structurally by the
// accessor the wiring supplies: `SystemTx` is assignable to {@link ApprovalTx}
// with no import in either direction, and the suite binds the two by reading the
// accessor's source rather than by restating it.
//
// THIS FILE MUST NOT GROW A `pg` IMPORT. `merit/no-raw-db-client` is attached to
// `apps/**` and this path is inside it. NOTHING HERE ADDS A `SqlExecutorReason`
// MEMBER, ADDS A `SystemReason` MEMBER, OR CASTS PAST A KEY TYPE.
//
// -----------------------------------------------------------------------------
// THE AUTHORITY IS ALREADY RULED AND NO WORD IS MINTED FOR IT
// -----------------------------------------------------------------------------
// `apps/worker` runs at `systemDb('nightly-batch')` through `src/db.ts`, whose
// `WORKER_REASON` is typed `SystemReason` rather than inferred so that a member
// removal does not compile, and which declares no reason parameter at all, so
// `'operator-console'` is unreachable from this deployable BY CONSTRUCTION.
// ADR-305 section 3 settles that and forbids any slice below it spending context
// on it. `SystemReason` gains no third member here and none is reached for.
// =============================================================================

// -----------------------------------------------------------------------------
// The five tables, and no others
// -----------------------------------------------------------------------------

/**
 * The tables this job reads and writes, as a closed union. ADR-316 section 3.1.
 *
 * A NARROW UNION RATHER THAN THE WHOLE KEY SPACE, on `provisioning/ports.ts`'s
 * argument: `SystemTx.updateAt` reaches every table in the estate with one word,
 * which ADR-102 section 8 prices as the widening it accepts, and a sweep that
 * accepted the same reach would spend that budget again for nothing. The
 * narrowing costs the caller nothing, because a wider handle is assignable to a
 * narrower shape.
 *
 * `ledgerTransactions` and `ledgerEntries` are absent DELIBERATELY, transcribing
 * `EXPIRY_TABLES`' own exclusion: the posting does not go through this handle,
 * it goes through {@link ApprovalLedgerPort}, so nothing here can write a ledger
 * row by naming a key.
 *
 * `adminActions` IS ABSENT AND ITS ABSENCE IS THE MACHINE ARM. A sweep is
 * nobody's decision and has no actor to record, which is `ExpiryTx`'s stated
 * reason for having no `insert` at all. That reason survives here for the audit
 * table and FAILS for `walletEntries`, which is why this port has an `insert`
 * and that one does not: this job's whole purpose is to move money, and the
 * wallet's own statement is where a movement is recorded.
 *
 * The suite asserts that all five members are real `TableKey`s of `packages/db`,
 * which is the half this file cannot assert itself.
 */
export const APPROVAL_TABLES = [
  'identities',
  'walletWithdrawals',
  'walletEntries',
  'payoutDestinations',
  'kycVerifications',
] as const;

/** One of {@link APPROVAL_TABLES}. */
export type ApprovalTable = (typeof APPROVAL_TABLES)[number];

/** An address or a filter, by Drizzle property name. ADR-112's shape. */
export type ApprovalFilter = Readonly<Record<string, unknown>>;

/** A set of values to write, by Drizzle property name. */
export type ApprovalValues = Readonly<Record<string, unknown>>;

// -----------------------------------------------------------------------------
// One open transaction, as this job needs to see it
// -----------------------------------------------------------------------------

/**
 * One open transaction. ADR-316 section 3.2.
 *
 * THERE IS NO `terms` MEMBER AND NONE IS REACHED FOR. `ExpiryTerms` exists
 * because the expiry sweep filters on a clock. This job filters on `status`,
 * which is an equality, and it evaluates the cooling clock IN MEMORY because the
 * decision has to be able to say `destination_cooling` rather than return one
 * row fewer. A read that filtered the cooling window in SQL would delete a hold
 * reason, and the rows crossing the boundary would be the window's rather than
 * the match's.
 *
 * THERE IS NO `deleteAt`. An approval destroys nothing.
 *
 * `update` AND `delete` ARE ABSENT BECAUSE THEY ARE ABSENT FROM EVERY
 * TRANSACTION HANDLE IN THIS WORKSPACE (ADR-112).
 */
export interface ApprovalTx {
  /** Rows matching a filter. MANY rows, every term an equality. */
  rowsWhere(key: ApprovalTable, where: ApprovalFilter): Promise<unknown[]>;
  /** ONE row, unlocked. The address must name a unique key. */
  rowAt(key: ApprovalTable, at: ApprovalFilter): Promise<unknown>;
  /**
   * ONE row, LOCKED until this transaction ends (ADR-157).
   *
   * IT IS `INV-M20-01`'s PER-IDENTITY LOCK AND NOT A NEW PRIMITIVE, which is
   * ADR-316 section 2's finding and the one line of this port that needed a
   * ruling and turned out to need nothing. `lockAt('identities', { id })` on
   * `SystemTx` and `lockScope()` on `WithdrawalTx` render the same
   * `SELECT ... FOR UPDATE` over the same `identities` row, so the sweep and
   * the request handler CONTEND WITH EACH OTHER rather than each holding a lock
   * the other cannot see.
   *
   * AN ADVISORY LOCK IS REFUSED BY NAME. ADR-157 clause 4:
   * `pg_advisory_xact_lock` can only be sent through `sqlExecutor` and carries
   * no tenancy narrowing at all. None is taken and none is reachable from here.
   */
  lockAt(key: ApprovalTable, at: ApprovalFilter): Promise<unknown>;
  /** Append ONE row. The wallet's own statement is the only thing this appends. */
  insert(key: ApprovalTable, values: ApprovalValues): Promise<unknown[]>;
  /** Write ONE row. The address must name a unique key. */
  updateAt(key: ApprovalTable, at: ApprovalFilter, values: ApprovalValues): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The ledger, as a port and never as arithmetic
// -----------------------------------------------------------------------------

/**
 * `LT-06`'s four facts, field for field with `@merit/ledger`'s
 * `WalletWithdrawalFacts`.
 *
 * STRUCTURAL AND NOT IMPORTED, because this file imports nothing and the
 * accessor's own shapes reach it the same way. `packages/ledger` declares
 * `IdentityId` as a bare `string`, so the mirror is assignable in both
 * directions and the adapter needs no cast; the suite asserts that field for
 * field against `packages/ledger/src/reversal.ts` rather than trusting this
 * paragraph.
 *
 * MONEY IS `bigint` AND A `number` IS REFUSED RATHER THAN COERCED.
 * `wallet_withdrawals.amount_cents` is `bigint` and the Drizzle declaration pins
 * `{ mode: 'bigint' }`, so a `number` reaching here means the handle is not the
 * accessor and the value may already have lost digits.
 */
export interface ApprovalFacts {
  /** `wallet_withdrawals.id`. The `reference_id` of every posting about it. */
  readonly withdrawalId: string;
  /** `wallet_withdrawals.identity_id`. Whose `trader_wallet` position moves. */
  readonly identityId: string;
  /** `wallet_withdrawals.amount_cents`. POSITIVE integer cents; the sign is the posting's. */
  readonly amountCents: bigint;
  /** `wallet_withdrawals.idempotency_key`, the row's OWN stored key, posted under bare. */
  readonly withdrawalIdempotencyKey: string;
}

/**
 * The `LT-06` posting, on THIS transaction.
 *
 * SUPPLIED BY THE WIRING AND NOT BUILT HERE, which is `ExpiryLedgerPort`'s shape
 * and its stated reason, and that reason is stronger here than there: that
 * module refused a second transcription of `LT-01`'s split, and `LT-06` is a
 * SINGLE transfer, which is exactly the shape a session would be tempted to
 * inline. THIS PORT NAMES NO LEDGER ACCOUNT AND CONTAINS NO LEDGER ARITHMETIC.
 *
 * THE HANDLE STAYS IN THE WIRING AND THIS JOB NEVER HOLDS ONE, which is
 * ADR-315's ruling relied on rather than re-argued. A `ledger` member on
 * {@link ApprovalTx} could only RESTATE `@merit/ledger`'s `LedgerTx` here,
 * because this file imports nothing, and restating it writes both ledger table
 * keys back into this job's reach as an `insert` key union: a single-sided entry
 * one call away, past `assertBalanced`, past `LEDGER-C1` and past the halt
 * check. So the adapter recovers the handle by the IDENTITY of the
 * {@link ApprovalTx} it is given, and `sweeps/ledger.ts` is where that lookup
 * lives.
 *
 * IT RETURNS THE LEDGER TRANSACTION'S ID AND ADR-316 DECLARED IT `Promise<void>`.
 * THAT IS A FINDING AGAINST A RULED SHAPE AND NOT A PREFERENCE, and ADR-325
 * section 3 states it with the line that refutes it: `wallet_entries` is in
 * {@link APPROVAL_TABLES} because this job appends the debit
 * (ADR-316 section 3.1), `ledger_transaction_id uuid NOT NULL REFERENCES
 * ledger_transactions(id)` is `0011:83`, and `ledgerTransactions` is excluded
 * from this union DELIBERATELY, so the id can be neither invented nor read back.
 * A `void` port makes the ruled table set unwritable. `ExpiryLedgerPort` is
 * `Promise<void>` correctly, because the expiry sweep appends no wallet row and
 * has nothing to do with the id.
 *
 * A LIVE LEDGER HALT REFUSES THE POSTING AND THAT IS LEFT ALONE.
 * `postTransaction` asserts against `ledger_halts` unless the caller passes
 * `despiteHalt`, and an override is a ruling this job does not take. A refused
 * posting rolls the approval back, which is the correct direction: the row stays
 * `requested` or `cooling`, the trader keeps the claim and keeps their cancel.
 */
export interface ApprovalLedgerPort {
  postLt06(tx: ApprovalTx, facts: ApprovalFacts): Promise<string>;
}

// -----------------------------------------------------------------------------
// The events, as a port that takes the transaction
// -----------------------------------------------------------------------------

/**
 * One event this job emits, by its registry name. ADR-316 section 3.3.
 *
 * BOTH ARE ALREADY ROWS IN THE CATALOGUE AND NOTHING IS INVENTED, which is
 * ADR-159 clause 1: the authority for a name is the registry rather than a
 * producer. `wallet.withdrawal_approved` is EVENTS section 6.2's row and
 * `wallet.debited` is section 6.1's.
 *
 * BOTH CELLS NAME `apps/api` AS THE PRODUCER AND BOTH ARE WRONG, which is
 * ADR-316 section 8 finding 1 re-derived rather than carried: ADR-305 section 4
 * finds the approval edge cannot be driven from that deployable and
 * `apps/api/src/db.ts` states in its own words that it has no `system(reason,
 * fn)` door. THE REPAIR IS OWED TO A ROW WHOSE FENCE REACHES `EVENTS.md` and it
 * is not this one's. `wallet.debited`'s checkout half is unaffected.
 */
export type ApprovalEventName = 'wallet.withdrawal_approved' | 'wallet.debited';

/** One event, name and payload. */
export interface ApprovalEvent {
  readonly name: ApprovalEventName;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The event sink.
 *
 * IT TAKES THE TRANSACTION, which is ADR-006's criterion relied on rather than
 * restated: the event commits with the approval or not at all, so there is no
 * window in which a wallet claim was extinguished and nobody was told, and none
 * in which a trader was told about an approval that rolled back.
 *
 * NOTHING IN THIS WORKSPACE WRITES AN EVENT YET. `payouts.ts`,
 * `admin-payouts.ts` and `sweeps/ports.ts` all report that gap in their own
 * headers and `P5-n` is the slice that builds the producer. This file declares
 * WHAT is emitted and refuses to invent a sink.
 *
 * CENTS CROSS THIS BOUNDARY AS `bigint` AND ARE NOT CONVERTED HERE, which is
 * stated rather than left to be discovered. `JSON.stringify` throws on a
 * `bigint`, so a sink that cannot serialise integer cents RAISES rather than
 * rounding, and that is the fail-loud direction on a money path. The conversion
 * belongs at the one place that serialises, which is the sink `P5-n` owes, and
 * a job that converted here would be performing a lossy narrowing it has no
 * reason to perform. `sweeps/expiry.ts` carries no cents in any payload, so
 * there is no idiom one directory over to follow and this is the first payload
 * in the deployable that has to answer the question.
 */
export interface ApprovalEventPort {
  emit(tx: ApprovalTx, event: ApprovalEvent): Promise<void>;
}

// -----------------------------------------------------------------------------
// Everything the sweep cannot do for itself
// -----------------------------------------------------------------------------

/**
 * The job's whole outside world. ADR-316 section 3.4.
 *
 * `transact` TAKES THE UNIT OF WORK RATHER THAN HANDING BACK A HANDLE, which is
 * `ExpirySweepIo`'s and `AdminPayoutBackend.operator`'s shape and their reason:
 * a transaction cannot outlive the function that opened it and no caller has a
 * `commit` to forget.
 *
 * IT IS CALLED ONCE FOR THE SCAN AND ONCE PER IDENTITY, WHICH IS ADR-316
 * SECTION 3.5's RULING AND NOT A PREFERENCE. One transaction for the whole run
 * is REFUSED: the lock is held to COMMIT, so a sweep-wide transaction holds
 * every scanned identity's `identities` row until the run ends, and
 * `lockScope()` is the first thing the request handler does, so every trader
 * opening a withdrawal blocks behind the batch. And one failure would roll back
 * every identity's posting, turning a single bad row into a night with no
 * approvals at all.
 *
 * `now` IS INJECTED AND IS THE ONLY CLOCK IN THIS JOB, so a fixture pins the
 * instant and the database never supplies one.
 */
export interface WithdrawalApprovalSweepIo {
  transact<T>(fn: (tx: ApprovalTx) => Promise<T>): Promise<T>;
  readonly ledger: ApprovalLedgerPort;
  readonly events: ApprovalEventPort;
  now(): Date;
}

/**
 * Raised by a port that is not installed.
 *
 * A SWEEP THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE EXTINGUISHING REAL
 * TRADERS' CLAIMS, which is `UNWIRED_EXPIRY_SWEEP_IO`'s sentence and is worth
 * more here: the value this one would have to invent is whether a trader's
 * wallet claim was extinguished.
 */
export class WithdrawalApprovalUnwired extends Error {
  constructor(what: string) {
    super(
      `WithdrawalApprovalSweepIo.${what} cannot be served by this deployment: no adapter is ` +
        'installed. The withdrawal approval driver refuses rather than returning a plausible ' +
        "value, because the value it would have to invent is whether a trader's wallet claim " +
        'was extinguished.',
    );
    this.name = 'WithdrawalApprovalUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * `CRON_INVENTORY`'s dead-man switch fires on the JOB'S ABSENCE, so a deployment
 * holding this default is a deployment whose driver is absent and is alarmed as
 * such. That is the correct outcome and is why the default refuses rather than
 * logging and returning an empty report: an empty report is indistinguishable
 * from a run that found nothing to approve.
 */
export const UNWIRED_WITHDRAWAL_APPROVAL_IO: WithdrawalApprovalSweepIo = {
  transact: () => Promise.reject(new WithdrawalApprovalUnwired('transact')),
  ledger: { postLt06: () => Promise.reject(new WithdrawalApprovalUnwired('ledger.postLt06')) },
  events: { emit: () => Promise.reject(new WithdrawalApprovalUnwired('events.emit')) },
  now: () => {
    throw new WithdrawalApprovalUnwired('now');
  },
};
