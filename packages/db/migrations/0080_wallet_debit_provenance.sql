-- =============================================================================
-- 0080_wallet_debit_provenance
-- =============================================================================
-- E2 READ: MONEY PATH. This file decides what a customer-visible ledger row
-- MEANS. `wallet_entries` is the trader's own statement of a balance Merit owes
-- unconditionally (M20 section 1.2, INV-M5-15), and the column this file moves
-- is the one that says what kind of money each line is.
--
-- ADR-322 (status: proposed, founder approval PENDING) is the ruling. It closes
-- ADR-158 finding 3 and ADR-316 section 8 finding 2, which found the same defect
-- independently and repaired it zero times. NOTHING HERE IS SIGNED.
--
-- -----------------------------------------------------------------------------
-- THE CONTRADICTION, IN THREE LINES
-- -----------------------------------------------------------------------------
--   `0011:52`  direction text NOT NULL CHECK (direction IN ('credit','debit'))
--   `0011:71`  provenance text NOT NULL CHECK (provenance IN
--                ('payout','refund_wallet_funded','correction'))
--   EVENTS.md:291  "`wallet.debited` has no `provenance` and that asymmetry is
--                   correct. Provenance is what value is MADE of, and it is a
--                   property of a credit; a debit consumes a composition rather
--                   than having one."
--
-- A debit row is representable, every row must carry a provenance, and an
-- approved architecture document rules that a debit has none. So the honest
-- withdrawal debit was UNWRITABLE and the dishonest one was WRITABLE, which is
-- the wrong way round. Both halves were executed against a PostgreSQL 16
-- instance carrying `0001`..`0079` applied forward-only from empty under
-- `ON_ERROR_STOP=1`, before a line of this file was written:
--
--   direction='debit', provenance=NULL      -> refused, not_null_violation
--   direction='debit', provenance='payout'  -> ACCEPTED
--
-- -----------------------------------------------------------------------------
-- THE RULING: THE SCHEMA MOVES AND `EVENTS.md` STANDS
-- -----------------------------------------------------------------------------
-- EVENTS.md is right and its reason is structural rather than stylistic. A
-- withdrawal is composed FIFO out of many credits (M20 section 3.4, P-1 and
-- P-3), so what a debit consumes is a MIXTURE, and a scalar column cannot hold
-- one. The corpus already has the plural column for it:
-- `wallet_withdrawals.source_provenance_summary jsonb` (`0011:169`, SD-M20-03),
-- reported by `wallet.withdrawal_approved` rather than by `wallet.debited`.
-- Widening this column with debit members would therefore be storing a
-- one-of-many answer to a many-valued question, beside a column that already
-- answers it correctly.
--
-- The API contract already committed to that reading: ADR-158 clause 2 types
-- `WalletEntry` as a union discriminated on `direction`, in which `WalletDebit`
-- declares NO `provenance` field at all, and `apps/api/src/routes/checkout.ts`'s
-- `WalletDebitInsert` declines to carry one, citing this defect as the reason.
-- This file is what makes the database agree with them.
--
-- INV-M20-04 IS THE SENTENCE THAT HAS TO BECOME TRUE: "Every debit records its
-- cause and reference, and every credit records its provenance class". `cause`
-- and `reference_id` are already NOT NULL for both directions and are untouched
-- here. The second half is what this file installs, in the only place the
-- invariant can be enforced rather than intended.
--
-- -----------------------------------------------------------------------------
-- `correction` IS THE ONE MEMBER THAT MAY APPEAR ON A DEBIT, AND THAT IS
-- MERGED DDL RATHER THAN A CONCESSION
-- -----------------------------------------------------------------------------
-- `0011`'s header calls the list "THE CLOSED CREDIT LIST" and that description
-- was already out of date when it was written down. Two of the three members
-- name where value CAME FROM and are credit-only. The third names a MECHANISM
-- and `0011:64` defines it direction-agnostically: "a compensating entry, never
-- an update".
--
-- `0038` then made that concrete and merged it. `assert_adjustment_wallet_entry_
-- matches` (`0038:548`) requires every `trader_wallet` adjustment to have
-- EXACTLY ONE matching `wallet_entries` row with `w.direction = NEW.direction`
-- AND `w.provenance = 'correction'`, and `account_adjustments_debit_is_a_
-- reversal` (`0038:221`) makes the debit direction reachable: reversing a wallet
-- credit adjustment IS a `trader_wallet` debit adjustment. So a wallet debit
-- carrying `provenance = 'correction'` is not merely tolerable, it is REQUIRED
-- by a constraint trigger on main, and `apps/api/src/routes/admin-wallet.ts`
-- writes exactly that row on `POST /admin/wallet/:identityId/correct` with
-- `direction` admitting both members.
--
-- A BICONDITIONAL WAS THE OBVIOUS SHAPE AND IT IS REFUSED. Writing
-- `(provenance IS NOT NULL) = (direction = 'credit')` reads better and is
-- wrong three times over: it breaks ADJ-C3 for every reversal, it makes the
-- debit half of a built admin endpoint unwritable, and it contradicts
-- API_CONTRACT's `WalletCorrectionResponse`, which carries `provenance` beside a
-- `direction` of `"credit" | "debit"`. Three approved or merged artifacts would
-- have to move to buy a tidier CHECK.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- -----------------------------------------------------------------------------
--   * IT DOES NOT EDIT `0011`. Constitution E2: merged migrations are sacred,
--     superseded by addition from outside and never edited. `0011`'s CHECK
--     stays, and it is still the only place the three-member vocabulary is
--     written down.
--   * IT DOES NOT RESTATE THAT VOCABULARY. The constraint below says which
--     DIRECTION may carry a provenance and names exactly one literal, the one
--     member that is direction-agnostic. A second copy of the closed list here
--     would agree with `0011` on the day it was written and be free to drift
--     from it every day after, which is ADR-216's refused copy in a CHECK.
--   * IT DOES NOT WIDEN THE CLOSED LIST. No new member, and in particular NO
--     DEPOSIT MEMBER: INV-WALLET-NO-DEPOSITS is `0011`'s CHECK and it is
--     untouched, so `provenance = 'deposit'` is still refused in both
--     directions.
--   * IT WRITES NO ROW. Nothing in this tree inserts into `wallet_entries` at
--     all today, re-derived rather than inherited: `grep` over `apps/*/src` and
--     `packages/*/src` for `'walletEntries'` returns twelve hits and every one
--     is a read or a comment. So this constraint lands on an empty table and
--     needs no backfill, which is exactly why it can be made exact now and not
--     later.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. A debit may have no provenance                              -- INV-M20-04
-- -----------------------------------------------------------------------------
-- The NOT NULL was the half of `0011` that made the honest debit unwritable.
-- Dropping it alone would be a widening and nothing else, which is why part 2
-- lands in the same transaction: on its own this statement lets a CREDIT be
-- written with no provenance class at all, and a credit whose class is unknown
-- is precisely what makes every rule in M20 section 3.4 unevaluable.
ALTER TABLE wallet_entries ALTER COLUMN provenance DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Which direction may carry which                             -- INV-M20-04
-- -----------------------------------------------------------------------------
-- IT COMPOSES WITH `0011`'s CHECK RATHER THAN REPLACING IT, and the composition
-- is the point. `wallet_entries_provenance_check` answers "is this a legal
-- member" and passes a NULL, because a CHECK that evaluates to NULL passes.
-- This one answers "may this direction carry it", and between them:
--
--   credit + 'payout' | 'refund_wallet_funded' | 'correction'   admitted
--   credit + NULL                                              refused here
--   debit  + NULL                                              admitted
--   debit  + 'correction'                                      admitted (ADJ-C3)
--   debit  + 'payout' | 'refund_wallet_funded'                 refused here
--   either + anything outside the list                         refused by 0011
--
-- WRITTEN AS A `CASE` AND NOT AS A DISJUNCTION, because the disjunction is
-- silently vacuous. `(direction = 'credit' AND provenance IN (...)) OR
-- (direction = 'debit' AND ...)` evaluates to `NULL OR FALSE` = NULL for a
-- credit carrying no provenance, and a CHECK that returns NULL ADMITS THE ROW.
-- The shape that reads most naturally would have installed cleanly, refused the
-- two mislabelled debits, and let through the one row this constraint exists to
-- refuse. Every branch below is total and returns a real boolean.
--
-- `ELSE false` IS NOT REACHABLE TODAY AND IS NOT DECORATION. `direction`'s own
-- CHECK closes it at two members; if a later migration adds a third, this
-- constraint refuses it until somebody rules what provenance means for it,
-- rather than admitting it by falling off the end of the CASE as NULL.
ALTER TABLE wallet_entries
  ADD CONSTRAINT wallet_entries_provenance_follows_direction CHECK (
    CASE direction
      WHEN 'credit' THEN provenance IS NOT NULL
      WHEN 'debit'  THEN provenance IS NULL OR provenance = 'correction'
      ELSE false
    END
  );

COMMENT ON CONSTRAINT wallet_entries_provenance_follows_direction ON wallet_entries IS
  'ADR-322. INV-M20-04''s second half: every credit records its provenance '
  'class and a debit records none, because provenance is what value is MADE '
  'of and a debit consumes a composition rather than having one (EVENTS.md '
  '6.1). The composition a debit destroys is reported by '
  'wallet_withdrawals.source_provenance_summary, which is plural because the '
  'FIFO answer is. ''correction'' is the one member admissible on a debit: it '
  'names a mechanism rather than a source, 0011 defines it as "a compensating '
  'entry, never an update", and 0038''s ADJ-C3 REQUIRES it on the wallet '
  'debit a reversing adjustment writes. This constraint states the direction '
  'rule only; the closed vocabulary is stated once, by 0011.';

COMMENT ON COLUMN wallet_entries.provenance IS
  'What kind of money this is. NOT NULL on a credit and normally NULL on a '
  'debit (ADR-322). The exception is ''correction'', which 0038''s ADJ-C3 '
  'requires on the debit a reversing adjustment writes. There is no deposit '
  'member and none may be added without counsel and an ADR '
  '(INV-WALLET-NO-DEPOSITS); the vocabulary itself is 0011''s CHECK.';

COMMIT;
