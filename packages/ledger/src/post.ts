// =============================================================================
// packages/ledger/src/post.ts
// =============================================================================
// THE WRITE. One `ledger_transactions` row, then its entries, all of it inside
// a transaction the CALLER opened.
//
// -----------------------------------------------------------------------------
// WHICH INVARIANTS ARE THE SCHEMA'S AND WHICH ARE THIS FILE'S
// -----------------------------------------------------------------------------
// THIS PATH DOES NOT RE-IMPLEMENT WHAT THE DATABASE ENFORCES. It posts what the
// database will accept and it fails loudly when the database refuses.
//
// THE SCHEMA'S, and this file relies on every one of them:
//
//   INV-M5-04     `ledger_entries_zero_sum`, a DEFERRABLE INITIALLY DEFERRED
//                 constraint trigger. Every transaction nets to zero AT COMMIT.
//   LEDGER-C1     `ledger_entries_no_opposite_signs`, deferred. No transaction
//                 debits and credits the same account.
//   LEDGER-C2     `ledger_entries_class_declared`, BEFORE INSERT, so it fires
//                 per row rather than at commit. Every entry's account exists
//                 and its code is one of the seven.
//   amount        `CHECK (amount_cents <> 0)` on every entry.
//   uniqueness    `idempotency_key text NOT NULL UNIQUE` on the transaction, and
//                 the two partial uniques on `ledger_accounts`.
//   reversal      `ledger_transactions_no_self_reversal`, and the FK to itself.
//   integrity     both foreign keys on `ledger_entries`.
//
// THIS FILE'S, and none of them is checkable by the database as it stands:
//
//   balance BEFORE the write. `posting.ts` makes an unbalanced posting
//                 unrepresentable, and this file re-sums the entries anyway,
//                 because a brand is a cast somebody can write. The database
//                 agrees at COMMIT and by then the wrong thing was built.
//   LEDGER-C1 before the write, for the same reason and at construction time.
//   a POSITIVE transfer amount. The database refuses zero and accepts either
//                 sign; this refuses a negative, so one movement has one
//                 spelling.
//   `bigint` cents. `0027`'s NO-FLOATS block asserts the SCHEMA has no
//                 non-integer money column; nothing asserts a caller did not
//                 hand a `number` to a driver.
//   THE HALT. `ledger_halts` has no trigger and no enforcement anywhere.
//                 `halts.ts` is the only thing in this estate that honours it.
//   AN EMPTY TRANSACTION. `ledger_entries_zero_sum` is `AFTER INSERT ON
//                 ledger_entries`, so a `ledger_transactions` row with NO
//                 entries fires it zero times and commits clean. `posting()`
//                 refuses that shape; the database does not.
//   the code-to-scope partition. `ledger_accounts` accepts a firm-scoped
//                 `trader_wallet`; `accounts.ts` refuses to name one.
//
// -----------------------------------------------------------------------------
// ADR-101 SECTION 7's OPEN FAILURE CLASS, ASKED OF THIS PATH BECAUSE THE
// DISPATCH ASKED IT
// -----------------------------------------------------------------------------
// The class is a `semi-join` on a reverse edge whose relation is not TOTAL, and
// `ledgerTransactions` is the registry's only rule of that shape: it reaches an
// identity through its entries, and nothing declares that a transaction HAS
// entries.
//
// THIS POSTING PATH CANNOT SUFFER IT, and the reason is that it never evaluates
// that predicate. `SystemTx.insert` renders an `INSERT` with no `WHERE` at all
// and this file issues no `UPDATE` and no `DELETE` -- `LedgerTx` does not name
// those verbs, so they are unavailable whatever authority the handle carries.
// A subset can only be returned or destroyed by a statement that filters, and
// this path has none.
//
// IT MAKES THE CLASS REACHABLE FOR EVERY OTHER READER, THOUGH, AND THAT IS
// WORTH MORE THAN THE ANSWER ABOVE. The rows this file writes are exactly the
// rows a scoped read of `ledger_transactions` traverses, and ADR-102 records
// that a `DELETE` through the same rule "deletes a subset and leaves the rest".
// This file is the producer of that population and it does not close the class.
// The one shape it can refuse it does: a transaction with no entries at all --
// the extreme case of a non-total relation, and one this database would
// otherwise accept -- is unrepresentable in `posting()`.

import { assertBalanced, entriesOf, identitiesTouchedBy, type Posting } from './posting.ts';
import { resolve, type Chart } from './chart.ts';
import { assertNoLiveHalt, readLiveHalts, type HaltOverrideReason } from './halts.ts';
import type { LedgerTx } from './tx.ts';

/** What a posting wrote, once the database has assigned its keys. */
export interface PostedTransaction {
  readonly transactionId: string;
  readonly entryCount: number;
  /** Always `0n`. Returned so that a caller asserting it is asserting the write and not the value. */
  readonly netCents: bigint;
}

/** The one word that lets a posting through a live halt. See `halts.ts`. */
export interface PostOptions {
  readonly despiteHalt?: HaltOverrideReason;
}

/** Read `id` off whatever the accessor returned, or say what it actually returned. */
function insertedId(returned: readonly unknown[], table: string): string {
  const [row] = returned;
  if (typeof row !== 'object' || row === null) {
    throw new Error(
      `the ${table} INSERT returned ${String(row)} rather than a row. ADR-102's writer ` +
        'calls `.returning()` on every statement, so an empty result here means the ' +
        'INSERT did not happen and the caller is about to build on a key that does not exist.',
    );
  }
  const id = (row as Record<string, unknown>)['id'];
  if (typeof id !== 'string') {
    throw new Error(`the ${table} INSERT returned a row with no string id.`);
  }
  return id;
}

/**
 * Post one double-entry transaction.
 *
 * THE ORDER IS FORCED BY A FOREIGN KEY: `ledger_entries.transaction_id`
 * references `ledger_transactions(id)`, so the header row is written first and
 * every entry follows it. That leaves a window, INSIDE this transaction and
 * visible to nobody else, in which the transaction row exists with no entries;
 * it closes before COMMIT because the entries are written before this function
 * returns, and if they are not, the caller's transaction rolls back and takes
 * the header with it. That is ADR-006's consequence relied on rather than
 * restated.
 *
 * `currency` IS NOT WRITTEN. `0009` defaults it to `'USD'` and calls it
 * "reserved, never in v1 math". A column this path set would be a second
 * statement of a value nothing reads.
 */
export async function postTransaction(
  tx: LedgerTx,
  chart: Chart,
  post: Posting,
  options: PostOptions = {},
): Promise<PostedTransaction> {
  const entries = entriesOf(post);

  // THE REFUSAL THE APPROVAL CLAUSE NAMES, and it runs BEFORE the database is
  // asked anything, so a refused posting writes no row and consumes no
  // idempotency key. It is unreachable through `entriesOf` by construction and
  // `assertBalanced`'s own comment says what it is therefore for.
  if (entries.length === 0) {
    throw new Error(
      'a posting with no entries writes a `ledger_transactions` row the zero-sum trigger ' +
        'never fires for, because that trigger is AFTER INSERT ON ledger_entries. The ' +
        'database accepts such a row; this does not.',
    );
  }
  assertBalanced(entries, post.transfers.length);

  // LEDGER-C1, re-checked over the entries actually about to be written rather
  // than over the transfers `posting()` was given.
  const signs = new Map<string, Set<string>>();
  for (const entry of entries) {
    const id = resolve(chart, entry.account);
    const seen = signs.get(id) ?? new Set<string>();
    seen.add(entry.amountCents > 0n ? 'debit' : 'credit');
    signs.set(id, seen);
    if (seen.size > 1) {
      throw new Error(
        `LEDGER-C1: this posting resolves two opposite-signed entries onto ledger_account ` +
          `${id}. 0027 refuses that at COMMIT. Two DIFFERENT references resolving to one ` +
          'account is the case `posting()` cannot see, because it compares references and ' +
          'this compares the uuids they resolve to.',
      );
    }
  }

  if (options.despiteHalt === undefined) {
    assertNoLiveHalt(await readLiveHalts(tx), identitiesTouchedBy(post));
  }

  const header = post.header;
  const transactionId = insertedId(
    await tx.insert('ledgerTransactions', {
      kind: header.kind,
      referenceKind: header.referenceKind,
      referenceId: header.referenceId,
      idempotencyKey: header.idempotencyKey,
      reversalOf: header.reversalOf ?? null,
    }),
    'ledger_transactions',
  );

  for (const entry of entries) {
    await tx.insert('ledgerEntries', {
      transactionId,
      ledgerAccountId: resolve(chart, entry.account),
      amountCents: entry.amountCents,
      memo: entry.memo,
    });
  }

  return { transactionId, entryCount: entries.length, netCents: 0n };
}
