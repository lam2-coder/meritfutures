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
// AND THERE WAS A SECOND REASON. **IT IS SPENT, AND ITS TWO EMPHASISED CLAIMS
// ARE KEPT BESIDE THEIR CORRECTION (`RI-14`) RATHER THAN DELETED, BECAUSE A
// FALSE SENTENCE DELETED LEAVES NOTHING FOR THE NEXT READER TO CHECK.**
//
// IT READ, and its first half was true when ADR-410 section 7 raised it and
// when ADR-415 section 6 wrote it down:
//
//     "`RI-35`'s `event-sink-caller` probe looks for this name followed by
//     `.`, `,` or `)` under any `src/`, as its proxy for a VALUE POSITION, and
//     it excludes exactly one file, the module that declares it. A name inside
//     a re-export LIST satisfies that proxy and is not a value position at all,
//     so a barrel that published it in the block above would be read as an
//     INSTALL and the register would report an artifact that does not exist.
//     **THE PROBE CANNOT TELL A PUBLICATION FROM AN INSTALL** [...] **WHAT
//     HOLDS THE GREEN IS THIS LINE BREAK** and the register says so: the
//     statement below is short enough that prettier leaves it on one line, so
//     the next character after the name is a space, and a second name added to
//     it would be reflowed into a list and flip the artifact with nobody having
//     edited the check, the probe or the register."
//
// **THE FIRST OF THOSE IS FALSE SINCE ADR-431. THE SECOND WAS NEVER TRUE.**
//
// THE PROBE CAN TELL A PUBLICATION FROM AN INSTALL. It blanks every `import`
// and `export` specifier list before it reads a line -- `BINDING_LIST` and
// `withoutBindingLists` in `packages/tooling/checks/absence-claims.mjs`,
// applied at that probe`s own read -- and a name inside a specifier list is a
// binding position by TypeScript`s own grammar. The punctuation proxy and the
// single exclusion are exactly as quoted above; what changed is what the line
// looks like by the time the proxy reads it.
//
// AND THE LINE BREAK WAS NEVER WHAT HELD THE GREEN, which ADR-434 re-derived
// against the pre-repair check rather than taking on report. Seven spellings of
// this publication were run through both: `export { TRANSACTION_EVENT_WRITER,
// makeEventSink } from './events.ts';` on ONE line, with no reflow anywhere,
// read `present` on the old check, while the same two names with the writer
// LAST and no comma after it read `absent` whether wrapped or not. The comma
// the proxy reads is the SEPARATOR, so it arrives with the second name rather
// than with the wrap. Prettier was one route in, through the trailing comma
// `trailingComma: "all"` puts after the last name of a list long enough to
// wrap, and it was never the mechanism.
//
// **SO THE REQUEST THIS COMMENT USED TO MAKE OF THE NEXT READER IS WITHDRAWN.**
// Adding a second name to the statement below flips nothing: all seven
// publication shapes read `absent` under the shipped probe, and a real install
// still reads `present` through a call, through an argument and through a
// member access. The writer is published on its own for the FIRST reason above,
// which is about what it is, and that reason is untouched by any of this.
//
// **AND NOTHING IN THIS TREE WATCHES THIS PARAGRAPH, WHICH IS WHY THE FALSE
// SENTENCES SURVIVED A WAVE.** ADR-434 derives it leg by leg: this file is not
// a registered absence-claim site, so legs 1 to 5 never open it; leg 6 does
// sweep it and stays silent because `event-sink-caller` registers no needle and
// none of the register`s other needles reaches this window; leg 7 does read
// this file and counts lines rather than reading them. The correction above
// landed because a row was sent to make it, not because anything went red.
export { TRANSACTION_EVENT_WRITER } from './events.ts';
