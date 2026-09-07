// =============================================================================
// packages/ledger
// =============================================================================
// DOUBLE-ENTRY POSTING, AS A LIBRARY BOTH DEPLOYABLES CALL.
//
// M03's `INV-M3-10` posts a compensating reversal on every chargeback, M05's
// `DEP-M3-06` is the other end of that same obligation, M08's commission clock
// posts on the affiliate path and the nightly batch posts from `apps/worker`.
// A posting path inside `apps/api` is unreachable from `apps/worker` and `RI-04`
// forbids an app depending on an app, so this is a package. `OVERVIEW` section
// 3's container table gains its row in the same change, because that table is
// where a container is rowed.
//
// WHAT THIS PACKAGE GUARANTEES, in one line each:
//
//   Debits equal credits, and the imbalance is UNREPRESENTABLE rather than
//   refused: an entry exists only as one half of a `transfer()`, so the legs of
//   any posting sum to exactly zero arithmetically. The refusal is kept as well,
//   because a brand is a cast somebody can write, and it fires before the
//   database is asked.
//
//   Money is integer cents as `bigint`, everywhere, including in a generated
//   test value. ADR-031 already ruled a public surface `bigint` with a unit.
//
//   A posting is written through ADR-102's accessor and never around it. This
//   package declares no dependency, cannot import a client, and takes the
//   caller's OPEN transaction as its first argument, so the movement commits
//   with the state change that caused it (ADR-006).
//
//   A live `ledger_halts` row refuses the posting. Nothing in the database
//   honours that table; this is the code path that does.

export {
  LEDGER_ACCOUNT_CODES,
  LEDGER_ACCOUNT_SCOPE,
  accountKey,
  firmAccount,
  identityAccount,
  identityOf,
  type AccountRef,
  type FirmAccountCode,
  type IdentityAccountCode,
  type IdentityId,
  type LedgerAccountCode,
} from './accounts.ts';

export {
  assertBalanced,
  entriesOf,
  identitiesTouchedBy,
  netCents,
  posting,
  transfer,
  type EntryDraft,
  type NonEmptyTransfers,
  type Posting,
  type PostingHeader,
  type Transfer,
} from './posting.ts';

export { readChart, resolve, type Chart } from './chart.ts';

export {
  assertNoLiveHalt,
  readLiveHalts,
  type HaltOverrideReason,
  type LiveHalt,
} from './halts.ts';

export { postTransaction, type PostOptions, type PostedTransaction } from './post.ts';

export { PayoutMoneyError, lt01 } from './payout.ts';

export {
  WALLET_WITHDRAWAL_APPROVAL_KIND,
  WALLET_WITHDRAWAL_FAILURE_KIND,
  WALLET_WITHDRAWAL_REFERENCE_KIND,
  reversalPosting,
  walletWithdrawalApprovalPosting,
  walletWithdrawalFailureKey,
  walletWithdrawalFailurePosting,
  type ReversalHeader,
  type WalletWithdrawalFacts,
} from './reversal.ts';

export type { LedgerReadKey, LedgerTx, LedgerWriteKey, WriteValues } from './tx.ts';

// -----------------------------------------------------------------------------
// THE EVENT PRODUCER, RELOCATED HERE BY ADR-410
// -----------------------------------------------------------------------------
// IT IS HERE FOR THE REASON THE HEADER ABOVE ALREADY GIVES FOR THE POSTING PATH,
// WORD FOR WORD: two deployables need it, `RI-04` forbids an app depending on an
// app, so it is a package. `apps/api` held the producer and opens no system
// door; `apps/worker` holds the only `systemDb` in the workspace and could reach
// this module in neither spelling, an `@merit/api` manifest line being refused by
// `RI-04` and a relative specifier by `node-linker=isolated`. That is ADR-104's
// own argument arriving a second time, and this package is the address BOTH
// arrows already name.
//
// IT COSTS THIS PACKAGE NOTHING IT WAS NOT ALREADY PAYING. The producer declares
// no dependency, imports nothing at all, and takes the caller's OPEN transaction
// as its first argument with no overload that omits it, which is `tx.ts`'s
// construction and `postTransaction`'s. `EventInsertTx` restates the subset of
// `SystemTx` this path uses exactly as `LedgerTx` does, and it is bound the same
// way, by a suite that READS `packages/db/src/scoped-db.ts` rather than by an
// import this package may not hold.
//
// WHAT IT IS NOT. It is not a posting and it does not pretend to be one: nothing
// below is reachable from `postTransaction` and nothing in the posting path
// calls it. ADR-410 section 4 states why the two live in one package and why
// `@merit/db` and `@merit/rules-engine` were refused, and records that a
// `packages/events` of its own is the shape a founder may still prefer, at the
// price of a `VG-12` admission and two manifest lines this row could not spend.
export {
  ACTOR_KINDS,
  CENTS_IN_PAYLOAD,
  EVENT_CATALOGUE,
  EVENT_NAMES,
  EVENT_WRITE_TABLE,
  EventError,
  EventSinkUnwired,
  UNWIRED_EVENT_SINK,
  assertPayloadRules,
  buildEvent,
  centsFromPayload,
  centsToPayload,
  encodeCentsForStorage,
  isUuid,
  makeEventSink,
  type ActorKind,
  type CatalogueRow,
  type EmitSpec,
  type EventEnvelope,
  type EventInsertTx,
  type EventName,
  type EventSink,
  type EventWriter,
} from './events.ts';

// THE WRITER IS PUBLISHED ON ITS OWN, AND THE FIRST REASON IS WHAT IT IS.
// Everything in the block above is a pure function, a constant or a type, and
// this is the one export of this package that is an ADAPTER: it performs the
// insert, through the handle its caller opened, into an append-only table. A
// reader deciding whether to take it is deciding to record money movements
// forever, and `UNWIRED_EVENT_SINK` above is the correct value for any
// deployment that has not made that decision.
//
// AND THERE IS A SECOND REASON, STATED RATHER THAN LEFT TO BE DISCOVERED.
// `RI-35`'s `event-sink-caller` probe looks for this name followed by `.`, `,`
// or `)` under any `src/`, as its proxy for a VALUE POSITION, and it excludes
// exactly one file, the module that declares it. A name inside a re-export LIST
// satisfies that proxy and is not a value position at all, so a barrel that
// published it in the block above would be read as an INSTALL and the register
// would report an artifact that does not exist. **THE PROBE CANNOT TELL A
// PUBLICATION FROM AN INSTALL**, which nothing had asked of it before, because
// the producer had never been published from a package. Its power over a REAL
// install is untouched by this line: a file that calls `makeEventSink(...)` or
// passes this value is still caught wherever it is written. ADR-410 section 7
// records the repair as a `sweptBy`-style registration in
// `packages/tooling/checks/absence-claims.mjs`.
//
// **THAT REGISTRATION IS LANDED AND THE SENTENCE SAYING IT WAS OWED IS KEPT
// BESIDE ITS CORRECTION** (`RI-14`). It read that the registration "is owed to
// whoever holds that package and which this row was not granted", which was
// true when ADR-410 wrote it and stopped being true one wave later: ADR-415
// took it, and the entry now carries the false positive in its own words and
// four cases that FIRE it -- this name inside a re-export list reads `present`,
// the same name on a statement of its own reads `absent`, the factory name in
// that list reads `absent` because its shape is a call, and a real install is
// still caught through both shapes. **WHAT HOLDS THE GREEN IS THIS LINE BREAK**
// and the register says so: the statement below is short enough that prettier
// leaves it on one line, so the next character after the name is a space, and a
// second name added to it would be reflowed into a list and flip the artifact
// with nobody having edited the check, the probe or the register.
export { TRANSACTION_EVENT_WRITER } from './events.ts';
