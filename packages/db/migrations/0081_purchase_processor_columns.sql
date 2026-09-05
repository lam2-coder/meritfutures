-- =============================================================================
-- 0081_purchase_processor_columns
-- =============================================================================
-- E2 READ: MONEY PATH. `purchases` is the row every account is sold on and the
-- row every webhook is matched against. This file decides which purchases name
-- a payment processor and which name none, and it moves two columns that the
-- webhook idempotency anchor is built on.
--
-- ADR-323 (status: proposed, founder approval PENDING) is the ruling. It closes
-- item 1 of `apps/api/src/routes/checkout.ts`'s "FIVE THINGS THIS FILE CANNOT
-- DO" header, which ADR-322 carried forward as its own landmine 1: the same
-- defect class, one table over. NOTHING HERE IS SIGNED.
--
-- -----------------------------------------------------------------------------
-- THE CONTRADICTION, IN FOUR LINES
-- -----------------------------------------------------------------------------
--   `0006:124`  psp text NOT NULL CHECK (psp IN ('psp_a','psp_b'))
--   `0006:125`  psp_reference text NOT NULL
--   `0006:158`  payment_method text NOT NULL DEFAULT 'psp'
--                 CHECK (payment_method IN ('psp','wallet','mixed'))
--   checkout.ts   the wallet arm writes `psp: null, pspReference: null`
--
-- `SD-M3-06` added the wallet payment method to this table and RELAXED NEITHER
-- processor column, and the only two `ALTER TABLE purchases` in the set (`0007`,
-- `0011`) add foreign keys. So a `payment_method = 'wallet'` row was UNWRITABLE
-- without naming a processor that was never called and a reference that
-- references nothing.
--
-- BOTH HALVES WERE EXECUTED against a PostgreSQL 16.13 instance carrying
-- `0001`..`0080` applied forward-only from empty under `ON_ERROR_STOP=1`,
-- before a line of this file was written:
--
--   payment_method='wallet', psp=NULL,     psp_reference=NULL      -> refused,
--                                                                     23502
--   payment_method='wallet', psp='psp_a',  psp_reference=<minted>  -> ACCEPTED
--
-- AND THAT IS THE WRONG WAY ROUND, exactly as `0080` found one table over. The
-- honest row was unwritable and the row that lies about which processor took
-- the money was writable, so an inventory of refusals scores this schema as
-- working. The writable one is the state `FM-M3-01` pages on wearing a wallet
-- purchase's clothes, and making it unrepresentable is what `SD-M3-06` exists
-- for: "without an explicit method the wallet path is indistinguishable from a
-- PSP purchase whose webhook never arrived" (`0006`, DATA_MODEL `purchases`).
--
-- -----------------------------------------------------------------------------
-- THE RULING: A WALLET PURCHASE IS A PURCHASE WITH NO PROCESSOR
-- -----------------------------------------------------------------------------
-- `psp` is "which MID took it" (DATA_MODEL `purchases`) and `psp_reference` is
-- that processor's own reference for the payment. On the wallet path no MID
-- took it and no processor issued a reference, because no processor was called:
-- `payment_method = 'wallet'` means `wallet_debit_cents = amount_paid_cents`
-- (`purchases_wallet_leg_matches_method`) and the whole price is paid by an
-- `LT-08` posting inside the checkout transaction. So the two columns are
-- ABSENT on that path rather than unknown, and absent is what NULL means.
--
-- `0006`'s CHECK ON `psp` SURVIVES AND IS NOT RESTATED. `purchases_psp_check`
-- is a separate constraint from the NOT NULL, so dropping the NOT NULL leaves
-- it installed and it goes on refusing any string outside ('psp_a','psp_b') for
-- every row that names one. It admits NULL because `NULL IN (...)` is NULL and
-- a CHECK that evaluates to NULL admits the row, which is the same composition
-- `0011` and `0080` have on `wallet_entries.provenance`. The vocabulary is
-- therefore still written down exactly once, in `0006` (ADR-216's refused copy).
--
-- -----------------------------------------------------------------------------
-- `payment_method` IS THE DISCRIMINATOR, AND THE ALTERNATIVE IS STRICTLY WEAKER
-- -----------------------------------------------------------------------------
-- The constraint below keys on `payment_method` and not on the presence of the
-- two columns. The presence-keyed spelling is the obvious one and it is refused:
--
--   CHECK ((psp IS NULL) = (psp_reference IS NULL))
--
-- states only the AGREEMENT between the two columns and leaves the METHOD free
-- to disagree with both. It admits a `payment_method = 'wallet'` row naming
-- `psp_a` and a minted reference, which is the exact row measured ACCEPTED
-- above and the one this file exists to refuse; and it admits a
-- `payment_method = 'psp'` row naming no processor, a purchase that claims a
-- card took it and records none. Keying on the method refuses both AND implies
-- the agreement, because every branch names both columns.
--
-- IT IS ALSO THE TABLE'S OWN IDIOM RATHER THAN A NEW ONE.
-- `purchases_wallet_leg_matches_method` (`0006:190`) already keys the wallet
-- CENTS on `payment_method`; this keys the wallet PROCESSOR COLUMNS on the same
-- discriminator. Two constraints, one discriminator, and DATA_MODEL's note that
-- the wallet constraints "together make a wallet purchase that looks like a
-- stalled PSP purchase unrepresentable" is what they are together for.
--
-- -----------------------------------------------------------------------------
-- `'mixed'` NAMES A PROCESSOR, AND THAT IS A RULING THIS FILE HAD TO MAKE
-- -----------------------------------------------------------------------------
-- A total CASE has to answer for all three members. `ELSE false` on `'mixed'`
-- would make the method unwritable, which is a NEW refusal this row has no
-- mandate for and would foreclose the ruling `checkout.ts` item 5 says is owed.
-- The answer follows from the cents constraint rather than from taste:
-- `purchases_wallet_leg_matches_method` requires `wallet_debit_cents <
-- amount_paid_cents` under `'mixed'`, so there is a card remainder, so a
-- processor took part of it and issued a reference for that part. `'mixed'` is
-- therefore grouped with `'psp'` and NOT with `'wallet'`.
--
-- It is written as its own `WHEN` branch with the same body rather than folded
-- into one `IN`, so that the ruling is visible at the member it rules. Nothing
-- writes a `'mixed'` purchase today: `checkout.ts` refuses the method by name.
--
-- -----------------------------------------------------------------------------
-- THE IDEMPOTENCY ANCHOR IS LEFT EXACTLY AS `0006` BUILT IT
-- -----------------------------------------------------------------------------
-- `purchases_psp_reference_uq ON purchases (psp, psp_reference)` is what `0006`
-- calls "THE IDEMPOTENCY ANCHOR FOR WEBHOOKS. Duplicate and out-of-order
-- delivery (B4 #9) is defeated here and in psp_webhook_events, not in a
-- handler." Over nullable columns a btree unique index treats NULLs as
-- DISTINCT, so wallet rows collide with nothing, including with each other.
--
-- THAT IS CORRECT, AND THE REASON IS ASSERTED RATHER THAN ASSUMED. The anchor
-- defeats a duplicate WEBHOOK, and a webhook is a processor's statement about a
-- payment. A wallet purchase reached no processor, so no processor can ever
-- make a statement about it and there is no delivery to deduplicate. M03
-- section 6 is the matcher: "`purchase.paid` requires a `purchases` row Merit
-- created at checkout, matched by `(psp, psp_reference)`", and a lookup whose
-- `psp` is a member of the closed vocabulary can never match a row whose `psp`
-- is NULL, because SQL equality with NULL is never true. Wallet rows are
-- invisible to that matcher BY CONSTRUCTION, which is exactly what they should
-- be. Their own idempotency is `INV-M3-13`: the row is `paid` in the
-- transaction that creates it, so there is no second arrival at all.
--
-- A PARTIAL INDEX WAS CONSIDERED AND REFUSED, and the reason is not effort.
-- `CREATE UNIQUE INDEX ... WHERE psp IS NOT NULL` admits and refuses EXACTLY
-- the same rows as the index already on the table: rows with a NULL `psp` are
-- unconstrained under the partial index because they are not in it, and
-- unconstrained under the full index because their key is distinct from every
-- other. So it is a pure RESTATEMENT of the CHECK below, in a second vocabulary,
-- with nothing keeping the two in step -- ADR-216's refused copy again -- and
-- its cost is dropping and recreating the one object `0006` names as the
-- anchor. A `CREATE INDEX` that lost the word `UNIQUE` in that rewrite behaves
-- identically to the anchor until the first duplicate webhook arrives.
--
-- What the partial index would have bought is a guard against a later
-- `NULLS NOT DISTINCT` rebuild of this index, which would permit exactly ONE
-- wallet purchase in the whole table and fail on the second. That is a real
-- hazard and it is answered by an assertion instead: `ACCEPTANCE 2` in
-- `scripts/db/probe_purchase_processor_columns.sql` writes a SECOND wallet
-- purchase and requires it to commit. An assertion catches the NOT NULL coming
-- back as well, which a partial index would not.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- -----------------------------------------------------------------------------
--   * IT DOES NOT EDIT `0006`. Constitution E2: merged migrations are sacred,
--     superseded by addition from outside and never edited.
--   * IT DOES NOT BUY THE OTHER REPAIR THIS COLUMN IS WANTED FOR. Session 220
--     priced stamping `psp_reference` AFTER the provider call, so that a slow
--     provider does not hold a transaction open, and recorded that it "needs a
--     nullable column and a migration". This migration does NOT deliver it:
--     under `'psp'` both columns are still required at INSERT, by the CASE
--     below rather than by a NOT NULL. That repair still needs its own ruling,
--     because it is about WHEN the reference exists and this one is about
--     WHETHER it exists.
--   * IT DOES NOT TOUCH `mid_reference`. The column is already nullable, so
--     nothing is unwritable, and requiring it NULL on a wallet row would be a
--     new refusal the defect does not force. A wallet purchase may still name a
--     merchant account; ADR-323 section 7 records it rather than ruling it.
--   * IT WRITES NO ROW AND NEEDS NO BACKFILL. Nothing in this tree inserts a
--     `purchases` row at all, re-derived rather than inherited: `insertPurchase`
--     is a port method on `CheckoutTx` with ONE caller and NO production
--     implementation, and `apps/api/src/start.ts` installs no checkout backend,
--     so every deployment answers the write half of checkout with a 503. The
--     table is empty in every environment, which is exactly why the constraint
--     can be made exact now rather than permissive later.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. A purchase that called no processor may name none            -- SD-M3-06
-- -----------------------------------------------------------------------------
-- The two NOT NULLs are the halves of `0006` that made the honest wallet row
-- unwritable. Dropping them alone is a widening and nothing else, which is why
-- part 2 lands in the same transaction: on its own this statement lets a
-- `payment_method = 'psp'` purchase be written naming no processor at all, and
-- a card purchase with no processor and no reference is a row the webhook
-- matcher can never resolve and the reconciliation in EC-061 can never explain.
ALTER TABLE purchases
  ALTER COLUMN psp DROP NOT NULL,
  ALTER COLUMN psp_reference DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Which method may name a processor, and which may not         -- SD-M3-06
-- -----------------------------------------------------------------------------
-- IT COMPOSES WITH `0006`'s CHECKS RATHER THAN REPLACING THEM.
-- `purchases_psp_check` answers "is this a legal processor" and passes a NULL;
-- `purchases_wallet_leg_matches_method` answers "do the cents match the
-- method"; this one answers "does the method name a processor at all", and
-- between the three:
--
--   psp    + 'psp_a' | 'psp_b'  + a reference          admitted
--   psp    + NULL                                      refused here
--   psp    + a processor, no reference                 refused here
--   mixed  + 'psp_a' | 'psp_b'  + a reference          admitted
--   mixed  + NULL                                      refused here
--   wallet + NULL, NULL                                admitted
--   wallet + any processor or any reference            refused here
--   any    + a processor outside the vocabulary        refused by 0006
--
-- WRITTEN AS A TOTAL `CASE` AND NOT AS A DISJUNCTION, which is `0080`'s finding
-- applied one table over rather than rediscovered. The natural spelling,
-- `(payment_method = 'wallet' AND psp IS NULL) OR (payment_method <> 'wallet'
-- AND psp IS NOT NULL ...)`, is a boolean expression over columns that are now
-- NULLABLE, and any branch that reads a NULL column can evaluate to NULL: `NULL
-- OR FALSE` is NULL and A CHECK THAT RETURNS NULL ADMITS THE ROW. Every branch
-- below returns `IS NULL` or `IS NOT NULL`, which are total, so no branch can
-- return NULL and no row can be admitted by vacuity.
--
-- `ELSE false` IS NOT REACHABLE TODAY AND IS NOT DECORATION. `payment_method`'s
-- own CHECK closes it at three members; if a later migration adds a fourth,
-- this constraint refuses it until somebody rules whether that method calls a
-- processor, rather than admitting it by falling off the end of the CASE as
-- NULL.
ALTER TABLE purchases
  ADD CONSTRAINT purchases_processor_columns_follow_method CHECK (
    CASE payment_method
      WHEN 'psp'    THEN psp IS NOT NULL AND psp_reference IS NOT NULL
      -- A mixed purchase pays part of the price with a card, so a processor
      -- took that part and issued a reference for it. See the header.
      WHEN 'mixed'  THEN psp IS NOT NULL AND psp_reference IS NOT NULL
      WHEN 'wallet' THEN psp IS NULL     AND psp_reference IS NULL
      ELSE false
    END
  );

COMMENT ON CONSTRAINT purchases_processor_columns_follow_method ON purchases IS
  'ADR-323. A wallet-funded purchase called no processor, so it names none: '
  'psp and psp_reference are both NULL under payment_method = ''wallet'' and '
  'both required under ''psp'' and ''mixed''. Keyed on payment_method rather '
  'than on the presence of the columns, because the presence-keyed spelling '
  'states only that the two agree and still admits a wallet row naming psp_a '
  'and a minted reference, which is the row SD-M3-06 exists to make '
  'unrepresentable (FM-M3-01). A total CASE and not a disjunction: over '
  'nullable columns a disjunctive CHECK can evaluate to NULL, and a CHECK that '
  'returns NULL admits the row. The processor vocabulary is stated once, by '
  '0006''s purchases_psp_check.';

COMMENT ON COLUMN purchases.psp IS
  'Which MID took it, or NULL when none did. NOT NULL under payment_method '
  '''psp'' and ''mixed'' and NULL under ''wallet'' (ADR-323), enforced by '
  'purchases_processor_columns_follow_method rather than by a column '
  'constraint, because whether this row has a processor is a fact about the '
  'payment method. The closed vocabulary (''psp_a'', ''psp_b'') is 0006''s '
  'CHECK and is untouched; it admits NULL because NULL IN (...) is NULL.';

COMMENT ON COLUMN purchases.psp_reference IS
  'The processor''s own reference for this payment, or NULL when no processor '
  'was called (ADR-323). It is required at INSERT under ''psp'' and ''mixed'', '
  'so this relaxation does NOT deliver the separate repair that would stamp '
  'the reference after the provider call: that is a question about WHEN the '
  'reference exists and needs its own ruling.';

COMMENT ON INDEX purchases_psp_reference_uq IS
  'THE IDEMPOTENCY ANCHOR FOR WEBHOOKS (0006). Duplicate and out-of-order '
  'delivery (B4 #9) is defeated here and in psp_webhook_events, not in a '
  'handler. Since ADR-323 both columns are nullable and a btree unique index '
  'treats NULLs as DISTINCT, so wallet rows collide with nothing and with each '
  'other. That is correct rather than tolerated: a wallet purchase reached no '
  'processor, so no webhook can ever cite it, and M03 section 6''s matcher '
  'looks the row up by (psp, psp_reference) with a psp from the closed '
  'vocabulary, which never equals NULL. NEVER rebuild this index NULLS NOT '
  'DISTINCT: that would permit exactly one wallet purchase in the table and '
  'fail on the second. probe_purchase_processor_columns.sql ACCEPTANCE 2 is '
  'what says so.';

COMMIT;
