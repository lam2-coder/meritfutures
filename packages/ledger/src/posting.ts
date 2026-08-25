// =============================================================================
// packages/ledger/src/posting.ts
// =============================================================================
// THE IMBALANCE IS UNREPRESENTABLE, AND THAT IS THIS FILE'S WHOLE CLAIM.
//
// A ledger that can write an unbalanced transaction silently stops being a
// ledger, and `INV-M5-04`'s deferred trigger in `0027` catches it only at
// COMMIT, at which point the caller has already built the wrong thing and the
// error is a Postgres exception naming a uuid. So the shape below is chosen so
// that the wrong thing cannot be built at all:
//
//   AN ENTRY IS NEVER CONSTRUCTED. A `Transfer` is, and every `Transfer`
//   yields exactly two entries, `+amount` against the debit and `-amount`
//   against the credit. There is no exported constructor that produces one leg,
//   so the sum of the entries of any list of transfers is identically zero --
//   not enforced, not asserted, but arithmetically unavailable to be anything
//   else. `sum(map(t => +t.a - t.a)) = 0`.
//
// THE REFUSAL IS KEPT ANYWAY AND IT IS NOT BELT-AND-BRACES THEATRE. `Transfer`
// and `Posting` are branded interfaces and a brand is a cast somebody can
// write; ADR-084's own two refusals are types for the same reason and rest on
// the same limit. `post.ts` re-sums the entries it is about to write and
// refuses a non-zero total BEFORE the first INSERT, so a value that reached
// this path through a cast is refused by the path rather than by the database.
// BOTH halves are watched in the suite, and the second is what the approval
// clause names.
//
// -----------------------------------------------------------------------------
// SIGNS, WHICH THIS CORPUS HAS GOT BACKWARDS FOUR TIMES IN ONE DAY
// -----------------------------------------------------------------------------
// `ledger_entries.amount_cents` is SIGNED and `0009` states the convention in
// its own COMMENT ON COLUMN: "positive DEBIT, negative CREDIT". `0009`'s header
// records that three direction-or-class errors landed on `LT-01` in a single
// day and a fourth landed inside the ADR describing them. So a caller of this
// file never writes a sign: it names a debit account and a credit account and a
// POSITIVE amount, and the sign is applied in exactly one place, below.
//
// MONEY IS INTEGER CENTS AND THE TYPE IS `bigint`. ADR-031 already ruled a
// public surface `bigint` with a unit rather than `numeric`, and `0027`'s
// NO-FLOATS DO block fails the migration if any non-integer numeric column
// appears outside its two-row exemption list. A `number` amount is refused at
// runtime here as well as at compile time, because JSON arrives as `number` and
// `5.5` is exactly the value the constitution bans.

import { accountKey, identityOf, type AccountRef, type IdentityId } from './accounts.ts';

/**
 * ONE MOVEMENT BETWEEN TWO ACCOUNTS. The only unit a posting is built from.
 *
 * BRANDED, so that the only way to obtain one is `transfer()`. An object
 * literal of the same shape is not assignable, which makes "I built the legs
 * myself" a cast a reviewer reads rather than a line that blends in.
 */
export interface Transfer {
  readonly __brand: 'Transfer';
  readonly debit: AccountRef;
  readonly credit: AccountRef;
  /** POSITIVE integer cents. The sign is this file's to apply and never the caller's. */
  readonly amountCents: bigint;
  readonly memo: string | null;
}

/**
 * Build one transfer, or refuse.
 *
 * THE THREE REFUSALS ARE THREE DIFFERENT FACTS ABOUT THE DATABASE:
 *
 *   a non-`bigint` amount   money is integer cents (constitution, DATA_MODEL
 *                           section 1). A `number` here is how a float reaches
 *                           a money path, and JSON has no other numeric type.
 *   a non-positive amount   `CHECK (amount_cents <> 0)` refuses zero, and a
 *                           NEGATIVE amount is a transfer written backwards.
 *                           Accepting it would mean the same movement had two
 *                           spellings and a reviewer had to work out which.
 *   debit equals credit     `LEDGER-C1`'s exact signature at the smallest
 *                           scale: a transaction that debits and credits one
 *                           position is "either a no-op wearing a transfer's
 *                           clothes, or a silent net movement" (ADR-027).
 */
export function transfer(
  debit: AccountRef,
  credit: AccountRef,
  amountCents: bigint,
  memo?: string,
): Transfer {
  if (typeof amountCents !== 'bigint') {
    throw new TypeError(
      `a ledger amount is integer cents as a bigint and this one is a ${typeof amountCents}. ` +
        'Money is never a float and never a number on this path (DATA_MODEL section 1).',
    );
  }
  if (amountCents <= 0n) {
    throw new RangeError(
      `a transfer moves a POSITIVE amount and this one is ${amountCents.toString()}c. ` +
        'ledger_entries CHECKs `amount_cents <> 0`, and a negative amount is this same ' +
        'transfer with its two accounts the other way round: write it that way instead, ' +
        'so that the direction is readable at the call site.',
    );
  }
  if (accountKey(debit) === accountKey(credit)) {
    throw new Error(
      `a transfer debits and credits ${accountKey(debit)}, which is LEDGER-C1's own ` +
        'signature: a movement against one position is either a no-op or a silent net ' +
        'movement in one party favour, and it has no legitimate use in this chart (ADR-027).',
    );
  }
  return {
    __brand: 'Transfer',
    debit,
    credit,
    amountCents,
    memo: memo ?? null,
  };
}

/**
 * The `ledger_transactions` row, minus the columns the database supplies.
 *
 * `id` and `posted_at` are the database's DEFAULTs and are never written here.
 * `idempotency_key` is `text NOT NULL UNIQUE`, so a re-drive of the same event
 * is refused by the database rather than deduplicated by this library: an
 * idempotency layer that lives in application memory is one that forgets on a
 * restart.
 */
export interface PostingHeader {
  readonly kind: string;
  readonly referenceKind: string;
  readonly referenceId: string;
  readonly idempotencyKey: string;
  /**
   * The transaction this one reverses. `SD-M5-05`: a correction is a
   * COMPENSATING ENTRY and never an UPDATE, and without the link "reconstructing
   * which reversal answered which original becomes archaeology at exactly the
   * moment it must be instant".
   */
  readonly reversalOf?: string;
}

/** A whole double-entry posting: one transaction row and the transfers under it. */
export interface Posting {
  readonly __brand: 'Posting';
  readonly header: PostingHeader;
  readonly transfers: readonly Transfer[];
}

/** At least one transfer, said in the type. A posting with no legs is not a posting. */
export type NonEmptyTransfers = readonly [Transfer, ...Transfer[]];

/**
 * Build a posting, or refuse.
 *
 * THE `LEDGER-C1` MIRROR IS THE ONE WORTH READING. `transfer()` refuses one
 * transfer whose two sides are the same account; this refuses a SET of
 * transfers that between them post both signs against one account, which is
 * what `0027`'s constraint trigger refuses at commit. The two are the same rule
 * at two scales and the second is the one a multi-leg posting reaches.
 *
 * NETTING IS REFUSED AND THAT IS A DECISION. Collapsing `A -> B` and `B -> C`
 * into `A -> C` would balance, would satisfy `LEDGER-C1`, and would erase the
 * middle position's movement from the books. `0009`'s C-01 reversal is exactly
 * this class of error surviving because the arithmetic still worked, so the
 * shape is refused at construction and the caller writes what it means.
 *
 * TWO TRANSFERS IN THE SAME DIRECTION AGAINST ONE ACCOUNT ARE ALLOWED, because
 * `LEDGER-C1` allows them: it refuses OPPOSITE signs and says nothing about two
 * debits. They post as two entries, which is what a fee and a principal against
 * one treasury account are.
 */
export function posting(header: PostingHeader, transfers: NonEmptyTransfers): Posting {
  if (!Array.isArray(transfers) || transfers.length === 0) {
    throw new Error(
      'a posting has at least one transfer. A `ledger_transactions` row with no entries ' +
        'commits cleanly today -- the zero-sum trigger is AFTER INSERT ON ledger_entries, ' +
        'so no entries means it never fires -- which is why this is refused here.',
    );
  }
  for (const field of ['kind', 'referenceKind', 'referenceId', 'idempotencyKey'] as const) {
    const value = header[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `a posting header needs a ${field} and this one has ${JSON.stringify(value)}. ` +
          'Every one of those columns is `NOT NULL` on ledger_transactions.',
      );
    }
  }
  if (header.reversalOf !== undefined && header.reversalOf.length === 0) {
    throw new Error(
      'reversalOf is present and empty. Omit it for a posting that reverses nothing: ' +
        'the column is nullable and an empty string is not a transaction id.',
    );
  }

  const signs = new Map<string, Set<'debit' | 'credit'>>();
  for (const t of transfers) {
    for (const [side, ref] of [
      ['debit', t.debit],
      ['credit', t.credit],
    ] as const) {
      const key = accountKey(ref);
      const seen = signs.get(key) ?? new Set<'debit' | 'credit'>();
      seen.add(side);
      signs.set(key, seen);
      if (seen.size > 1) {
        throw new Error(
          `LEDGER-C1: this posting debits AND credits ${key}. A transaction that posts ` +
            'opposite signs against one position is either a no-op or a silent net ' +
            'movement, and it has no legitimate use in this chart of accounts (ADR-027). ' +
            '0027 refuses it at COMMIT; this refuses it before the database is asked.',
        );
      }
    }
  }

  return { __brand: 'Posting', header, transfers: [...transfers] };
}

/** One `ledger_entries` row, before the chart resolves its account to a uuid. */
export interface EntryDraft {
  readonly account: AccountRef;
  /** SIGNED. Positive is DEBIT and negative is CREDIT. `0009`'s COMMENT ON COLUMN. */
  readonly amountCents: bigint;
  readonly memo: string | null;
}

/**
 * The entries a posting is, in the order the transfers declare them.
 *
 * THE ONE PLACE A SIGN IS APPLIED IN THIS PACKAGE, and the reason the sum is
 * zero: every transfer contributes `+a` and `-a` and nothing else contributes
 * at all.
 */
export function entriesOf(post: Posting): readonly EntryDraft[] {
  const entries: EntryDraft[] = [];
  for (const t of post.transfers) {
    entries.push({ account: t.debit, amountCents: t.amountCents, memo: t.memo });
    entries.push({ account: t.credit, amountCents: -t.amountCents, memo: t.memo });
  }
  return entries;
}

/**
 * The net of a set of entries, in integer cents.
 *
 * `PT-03`'s subject in both halves: per transaction it must be zero, which the
 * shape above guarantees and `0027` re-checks at commit, and IN AGGREGATE over
 * every entry ever written it must be zero, which no constraint in this
 * database can see because the deferred trigger reads one `transaction_id`.
 */
export function netCents(entries: readonly EntryDraft[]): bigint {
  let net = 0n;
  for (const entry of entries) net += entry.amountCents;
  return net;
}

/**
 * Refuse a set of entries that does not net to zero.
 *
 * THE GUARD IS EXPORTED SO THAT IT CAN BE WATCHED FIRING, which is the whole
 * reason it is a function and not three lines inside `post.ts`. Through the
 * types above it is UNREACHABLE: `entriesOf` emits `+a` and `-a` for every
 * transfer and nothing else emits an entry at all, so no `Posting` -- not even
 * one assembled past both brands by a cast -- can fold to a non-zero net. That
 * is a stronger claim than "refused" and it is the one this package makes.
 *
 * IT IS KEPT ANYWAY, FOR THE FAILURE THAT CLAIM DEPENDS ON. The claim rests
 * entirely on `entriesOf` emitting legs in pairs; a later session that adds a
 * third leg shape, or folds a net amount, or writes an adjustment entry with no
 * counter-leg, breaks it silently and every type still compiles. This guard is
 * what turns that into a refusal at the last moment before the first INSERT,
 * and the suite drives it with a credit that has no debit so that it is watched
 * refusing rather than assumed to.
 */
export function assertBalanced(entries: readonly EntryDraft[], transferCount: number): void {
  const net = netCents(entries);
  if (net === 0n) return;
  throw new Error(
    `this posting nets ${net.toString()}c and a ledger transaction nets exactly zero ` +
      `(INV-M5-04). ${String(entries.length)} entr(ies) over ${String(transferCount)} ` +
      'transfer(s): a balanced posting is the only one `transfer()` and `posting()` can ' +
      'build, so a set of entries reaching here unbalanced was not folded from transfers. ' +
      '0027 would refuse this at COMMIT; it is refused here so that no row is written and ' +
      'no idempotency key is consumed.',
  );
}

/** Every identity whose account this posting touches. The subjects a halt is checked against. */
export function identitiesTouchedBy(post: Posting): readonly IdentityId[] {
  const found = new Set<IdentityId>();
  for (const entry of entriesOf(post)) {
    const identity = identityOf(entry.account);
    if (identity !== undefined) found.add(identity);
  }
  return [...found];
}
