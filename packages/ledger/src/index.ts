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
