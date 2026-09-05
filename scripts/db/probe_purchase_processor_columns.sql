-- =============================================================================
-- Probe: a wallet purchase names no processor, installed by 0081 (ADR-323).
-- =============================================================================
-- THE DEFECT WAS TWO CONSTRAINTS POINTING THE WRONG WAY, WHICH IS WORSE THAN AN
-- ABSENCE. `0006:124` and `0006:125` made `psp` and `psp_reference` NOT NULL on
-- a table whose `payment_method` admits `'wallet'`, and `SD-M3-06` added that
-- method without relaxing either. So the honest wallet purchase was UNWRITABLE
-- and a wallet purchase naming `psp_a` and a minted reference was WRITABLE, and
-- an inventory of refusals would have scored that schema as working.
-- ACCEPTANCE 1 and REJECTION 1 are the two halves of that swap and they are the
-- reason this file exists.
--
-- IT LEADS WITH THE ACCEPTANCES AND THAT IS NOT A STYLE CHOICE. Every rejection
-- below passes against columns that refuse EVERY null, which is precisely the
-- pre-`0081` schema. What separates `0081` from a wall is ACCEPTANCE 1 to 4:
-- the honest wallet purchase, a SECOND one, the ordinary card purchase that
-- must go on working, and the `'mixed'` method that a `CASE` one branch too
-- tight would have made unwritable.
--
-- ACCEPTANCE 2 IS THE ONE THAT LOOKS REDUNDANT AND IS NOT. It writes a second
-- wallet purchase, and the only thing that can refuse it is
-- `purchases_psp_reference_uq`, the webhook idempotency anchor, whose two key
-- columns are now nullable. A btree unique index treats NULLs as DISTINCT, so
-- `(NULL, NULL)` collides with nothing; a later rebuild of that index with
-- `NULLS NOT DISTINCT` would permit exactly ONE wallet purchase in the entire
-- table and fail on the second, silently, with every other case here green.
-- ADR-323 refused a partial index in favour of this assertion, so this case is
-- the whole of what that refusal rests on.
--
-- REJECTION 3 IS THE WIDENING CASE AND IT IS THE ONE TO READ. `ALTER COLUMN
-- ... DROP NOT NULL` on its own admits a `payment_method = 'psp'` purchase that
-- names no processor at all: a card purchase the webhook matcher can never
-- resolve and the EC-061 reconciliation can never explain. Nothing else in this
-- file would notice `0081` reduced to its first statement.
--
-- REJECTION 6 IS THE ANCHOR ITSELF, still refusing the duplicate it was built
-- for. Relaxing the two columns it is keyed on is exactly the kind of change
-- that turns a unique index into a decoration, and no case above would see it.
--
-- REJECTION 8 ASSERTS FROM THE CATALOGUE, because three of the ways this ruling
-- can be lost are invisible to every row above: `0006`'s own CHECK carries the
-- processor vocabulary, the anchor must stay UNIQUE and NULLS DISTINCT, and the
-- two columns must stay nullable.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one identity, one user, one plan version, and the postings a
-- wallet leg needs.
-- ---------------------------------------------------------------------------
-- `purchases_wallet_debit_is_posted` requires `wallet_ledger_transaction_id`
-- whenever `wallet_debit_cents > 0`, so each wallet purchase below carries its
-- own `LT-08`. They are separate rows rather than one reused transaction
-- because ACCEPTANCE 2 is about two purchases and two purchases post twice;
-- `ledger_transactions.idempotency_key` is unique, so the second one could not
-- be a copy of the first even if this file wanted it to be.
--
-- NO `ledger_entries` ARE WRITTEN AND THAT IS NOT AN OMISSION. Nothing on
-- `purchases` reads the postings; `LEDGER-C1`'s zero-sum assertion is a
-- deferred trigger on `ledger_entries` and this file writes none, so the
-- transaction rows exist here only to satisfy a foreign key.
INSERT INTO identities (id, status) VALUES
  ('aa000000-0000-0000-0000-000000000323', 'active');
INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000323', 'aa000000-0000-0000-0000-000000000323',
   'probe323@example.test', 'probe323@example.test');
INSERT INTO plans (id, code, name) VALUES
  ('11000000-0000-0000-0000-000000000323', 'probe-323', 'Probe 323');
INSERT INTO plan_versions (id, plan_id, version, rules, public_slug, created_by) VALUES
  ('22000000-0000-0000-0000-000000000323', '11000000-0000-0000-0000-000000000323',
   1, '{}'::jsonb, 'probe-323-v1', 'probe');
INSERT INTO ledger_transactions (id, kind, reference_kind, reference_id, idempotency_key) VALUES
  ('cc000000-0000-0000-0000-000000000323', 'LT-08', 'purchase',
   'dd000000-0000-0000-0000-000000000323', 'probe-323-lt08-a'),
  ('cc000000-0000-0000-0000-000000000324', 'LT-08', 'purchase',
   'dd000000-0000-0000-0000-000000000324', 'probe-323-lt08-b'),
  ('cc000000-0000-0000-0000-000000000325', 'LT-08', 'purchase',
   'dd000000-0000-0000-0000-000000000325', 'probe-323-lt08-c');

-- One writer for every row case, so a difference between two cases is a
-- difference in `payment_method`, `psp` and `psp_reference` and never in the
-- fourteen columns that are not under test.
--
-- THE CENTS AND THE STATUS ARE DERIVED FROM THE METHOD RATHER THAN PASSED,
-- because `purchases_wallet_leg_matches_method` and `purchases_paid_has_
-- timestamp` are OTHER constraints and a case that tripped one of them would
-- report as this constraint working. `'wallet'` is `paid` in the transaction
-- that creates it, which is `INV-M3-13`; the card methods stay `pending` until
-- their webhook, which is what `0006`'s `DEFAULT` says.
--
-- `psp` AND `psp_reference` GO IN AS BOUND PARAMETERS AND NOT THROUGH `format`,
-- because NULL is one of the values under test and `%L` renders it as the four
-- characters NULL in some spellings and as the keyword in others. Bound `text`
-- parameters are what a query builder sends, which is the writer this
-- constraint will actually meet.
CREATE FUNCTION pg_temp.probe_purchase(p_id uuid, p_method text, p_psp text,
                                       p_reference text, p_ledger uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO purchases (id, identity_id, user_id, plan_version_id, size_cents,
                         kind, list_price_cents, discount_cents,
                         amount_paid_cents, psp, psp_reference, payment_method,
                         wallet_debit_cents, wallet_ledger_transaction_id,
                         status, paid_at)
  VALUES (p_id, 'aa000000-0000-0000-0000-000000000323',
          'bb000000-0000-0000-0000-000000000323',
          '22000000-0000-0000-0000-000000000323',
          5000000, 'new', 9900, 0, 9900, p_psp, p_reference, p_method,
          CASE p_method WHEN 'wallet' THEN 9900 WHEN 'mixed' THEN 4000 ELSE 0 END,
          CASE WHEN p_method = 'psp' THEN NULL ELSE p_ledger END,
          CASE p_method WHEN 'wallet' THEN 'paid' ELSE 'pending' END::purchase_status,
          CASE p_method WHEN 'wallet' THEN now() ELSE NULL END);
END;
$f$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 1: the honest wallet purchase, which nothing could write before
-- ---------------------------------------------------------------------------
-- THE ROW THE WHOLE MIGRATION IS FOR. `apps/api/src/routes/checkout.ts`'s
-- wallet arm writes `psp: null, pspReference: null`, and against `0001`..`0080`
-- this exact INSERT raises not_null_violation on `psp`. The only writable
-- alternative was REJECTION 1, which is the state FM-M3-01 pages on.
DO $$
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000323', 'wallet',
                                 NULL, NULL, 'cc000000-0000-0000-0000-000000000323');
  RAISE NOTICE 'ACCEPTANCE 1: a wallet purchase naming no processor is writable';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'PROBE FAILED: ACCEPTANCE 1: a wallet-funded purchase naming no processor '
    'was refused (%). SD-M3-06 put the wallet on this table and checkout.ts '
    'writes both columns null, so the first writer of a wallet purchase has no '
    'legal row to write and every rejection in this file still passes.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 2: a SECOND wallet purchase, which is the anchor's NULL semantics
-- ---------------------------------------------------------------------------
-- THE ONLY THING THAT CAN REFUSE THIS IS `purchases_psp_reference_uq`. Both of
-- its key columns are `(NULL, NULL)` on a wallet row, and a btree unique index
-- treats NULLs as DISTINCT, so the second row collides with nothing. ADR-323
-- refused a partial index (`WHERE psp IS NOT NULL`) on the grounds that it
-- admits and refuses exactly the same rows and is therefore a restatement of
-- the CHECK; the one thing it WOULD have bought is immunity from a later
-- `NULLS NOT DISTINCT` rebuild of this index, which would permit exactly one
-- wallet purchase in the whole table. This case is what buys that instead, and
-- it catches the NOT NULL coming back as well, which the partial index could
-- not have.
DO $$
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000324', 'wallet',
                                 NULL, NULL, 'cc000000-0000-0000-0000-000000000324');
  RAISE NOTICE 'ACCEPTANCE 2: a SECOND wallet purchase is writable; NULLs stay distinct in the anchor';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'PROBE FAILED: ACCEPTANCE 2: a second wallet purchase was refused (%). If '
    'this is a unique violation, purchases_psp_reference_uq has been rebuilt '
    'NULLS NOT DISTINCT and Merit may now sell exactly one wallet-funded '
    'evaluation, ever.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 3: the ordinary card purchase, which must go on working
-- ---------------------------------------------------------------------------
-- THE HALF THAT CATCHES THE OPPOSITE DEFECT. `0081` relaxes two NOT NULLs and
-- replaces them with a CHECK, and a CHECK written slightly wrong in the
-- tightening direction refuses the row this table mostly holds. Every purchase
-- Merit has ever been able to write is this shape.
DO $$
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000326', 'psp',
                                 'psp_a', 'psp-a-ref-323-1', NULL);
  RAISE NOTICE 'ACCEPTANCE 3: an ordinary psp purchase naming psp_a is writable';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'PROBE FAILED: ACCEPTANCE 3: an ordinary card purchase was refused (%). '
    '0081 was meant to relax the wallet side and change nothing about the '
    'processor side.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 4: `'mixed'`, the branch a tighter CASE would have closed
-- ---------------------------------------------------------------------------
-- ADR-323's one ruling about a method nobody has built, executed rather than
-- argued. A total CASE has to answer for all three members, and `ELSE false` on
-- `'mixed'` would install cleanly, satisfy every rejection in this file, and
-- make the method unwritable before the ruling `checkout.ts` item 5 says is
-- owed has been taken. `'mixed'` names a processor because
-- `purchases_wallet_leg_matches_method` requires `wallet_debit_cents <
-- amount_paid_cents`, so a card paid the remainder.
DO $$
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000327', 'mixed',
                                 'psp_b', 'psp-b-ref-323-1',
                                 'cc000000-0000-0000-0000-000000000325');
  RAISE NOTICE 'ACCEPTANCE 4: a mixed purchase naming psp_b is writable';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'PROBE FAILED: ACCEPTANCE 4: a mixed purchase naming a processor was '
    'refused (%). ADR-323 groups mixed with psp because a mixed purchase has a '
    'card remainder; a CASE that answers ELSE false for it forecloses a ruling '
    'nobody has taken.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: a wallet purchase naming psp_a, which is the row 0006 admitted
-- ---------------------------------------------------------------------------
-- THE COUNTERFACTUAL. This exact row COMMITS against `0001`..`0080`, verified
-- before `0081` was written. It is a purchase that reached no processor wearing
-- the clothes of one that did, which is the state FM-M3-01 pages on and exactly
-- what SD-M3-06 exists to make unrepresentable.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000328', 'wallet',
                                 'psp_a', 'minted-not-a-processor-reference',
                                 'cc000000-0000-0000-0000-000000000325');
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 1: purchases stored a WALLET purchase naming '
    'psp_a and a minted reference. A purchase that called no processor is '
    'recorded as one that did, which is the state SD-M3-06 exists to make '
    'unrepresentable.';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_processor_columns_follow_method' THEN
    RAISE EXCEPTION 'REJECTION 1: refused, but by % rather than by 0081''s constraint', c;
  END IF;
  RAISE NOTICE 'REJECTION 1: a wallet purchase naming psp_a is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: a wallet purchase with a reference and no processor
-- ---------------------------------------------------------------------------
-- Not redundant with REJECTION 1: a constraint written as `psp IS NULL` alone
-- on the wallet branch passes REJECTION 1 and admits this one, and a reference
-- with no processor to have issued it is the same lie in one column instead of
-- two. Every branch of `0081`'s CASE names BOTH columns for this reason.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000329', 'wallet',
                                 NULL, 'reference-without-a-processor',
                                 'cc000000-0000-0000-0000-000000000325');
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 2: purchases stored a WALLET purchase carrying a '
    'psp_reference and no psp. A reference nobody issued is not a reference.';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_processor_columns_follow_method' THEN
    RAISE EXCEPTION 'REJECTION 2: refused, but by % rather than by 0081''s constraint', c;
  END IF;
  RAISE NOTICE 'REJECTION 2: a wallet purchase with a reference and no processor is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: a `'psp'` purchase naming no processor, the widening case
-- ---------------------------------------------------------------------------
-- THE CASE THAT FAILS IF SOMEBODY KEEPS ONLY THE FIRST STATEMENT OF `0081`.
-- `ALTER COLUMN psp DROP NOT NULL` on its own admits this row: a card purchase
-- that names no processor and carries no reference, which the M03 section 6
-- webhook matcher can never resolve and the EC-061 daily reconciliation can
-- never explain. Nothing else in this file would notice.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000330', 'psp',
                                 NULL, NULL, NULL);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 3: purchases stored a payment_method=psp row with '
    'no psp and no psp_reference. 0081 has probably been reduced to its DROP '
    'NOT NULL, which is a widening and nothing else.';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_processor_columns_follow_method' THEN
    RAISE EXCEPTION 'REJECTION 3: refused, but by % rather than by 0081''s constraint', c;
  END IF;
  RAISE NOTICE 'REJECTION 3: a psp purchase naming no processor is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: a `'psp'` purchase with a processor and no reference
-- ---------------------------------------------------------------------------
-- THE DISAGREEING PAIR, which is neither a processor purchase nor a wallet one.
-- Before `0081` the NOT NULL refused it; after `0081` only the CHECK does, and
-- a branch written `psp IS NOT NULL` alone would admit it. It is also the row
-- that would break the anchor's purpose without breaking the anchor: a card
-- purchase with no reference is one the webhook can never match.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000331', 'psp',
                                 'psp_a', NULL, NULL);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 4: purchases stored a psp purchase naming psp_a '
    'with no psp_reference. A card purchase the webhook matcher can never '
    'resolve is exactly the paid-not-provisioned state FM-M3-01 pages on.';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_processor_columns_follow_method' THEN
    RAISE EXCEPTION 'REJECTION 4: refused, but by % rather than by 0081''s constraint', c;
  END IF;
  RAISE NOTICE 'REJECTION 4: a psp purchase with no reference is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: a `'mixed'` purchase naming no processor
-- ---------------------------------------------------------------------------
-- ACCEPTANCE 4's other half. A CASE that grouped `'mixed'` with `'wallet'`
-- instead of with `'psp'` would pass ACCEPTANCE 4 only if the row named nothing,
-- so the two cases together are what pin the ruling rather than either alone.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000332', 'mixed',
                                 NULL, NULL, 'cc000000-0000-0000-0000-000000000325');
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 5: purchases stored a mixed purchase naming no '
    'processor. A mixed purchase has a card remainder by '
    'purchases_wallet_leg_matches_method, so a processor took part of it.';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_processor_columns_follow_method' THEN
    RAISE EXCEPTION 'REJECTION 5: refused, but by % rather than by 0081''s constraint', c;
  END IF;
  RAISE NOTICE 'REJECTION 5: a mixed purchase naming no processor is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6: THE ANCHOR ITSELF, still refusing the duplicate it was built for
-- ---------------------------------------------------------------------------
-- `0006:218`: "THE IDEMPOTENCY ANCHOR FOR WEBHOOKS. Duplicate and out-of-order
-- delivery (B4 #9) is defeated here and in psp_webhook_events, not in a
-- handler." Relaxing the two columns a unique index is keyed on is exactly the
-- kind of change that turns it into a decoration, and no case above would see
-- it: the wallet rows never collide by design, so a broken anchor and a
-- correctly NULL-distinct one look identical from ACCEPTANCE 2. This writes the
-- same `(psp, psp_reference)` pair as ACCEPTANCE 3.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000333', 'psp',
                                 'psp_a', 'psp-a-ref-323-1', NULL);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 6: purchases stored a SECOND row with the same '
    '(psp, psp_reference). The webhook idempotency anchor is gone, and B4 #9''s '
    'duplicate delivery is defeated nowhere.';
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_psp_reference_uq' THEN
    RAISE EXCEPTION 'REJECTION 6: refused, but by % rather than by the anchor', c;
  END IF;
  RAISE NOTICE 'REJECTION 6: a duplicate processor reference is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 7: the processor vocabulary survived the relaxation
-- ---------------------------------------------------------------------------
-- `0081` states the METHOD rule and deliberately does not restate
-- ('psp_a','psp_b'). `purchases_psp_check` is a separate constraint from the
-- NOT NULL that was dropped, so it is still installed and still closed; this is
-- the row that says so. A widening that also admitted a new processor would be
-- caught nowhere else here.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_purchase('dd000000-0000-0000-0000-000000000334', 'psp',
                                 'psp_c', 'psp-c-ref-323-1', NULL);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 7: purchases stored psp = psp_c. 0006''s closed '
    'processor vocabulary is the only place the two MIDs are written down and '
    'dropping its CHECK makes any string a processor.';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'purchases_psp_check' THEN
    RAISE EXCEPTION 'REJECTION 7: refused, but by % rather than by 0006''s vocabulary', c;
  END IF;
  RAISE NOTICE 'REJECTION 7: a processor outside the vocabulary is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 8: the three catalogue facts no row above can see
-- ---------------------------------------------------------------------------
-- ADR-323's ruling is split across two migrations exactly as ADR-322's was:
-- `0006` holds the processor vocabulary and the anchor, `0081` holds the method
-- rule. This asserts that both halves are still there, that the anchor is still
-- UNIQUE, still whole rather than partial, and still NULLS DISTINCT, and that
-- the two columns are still nullable.
DO $$
DECLARE method_rule text;
        vocabulary  text;
        anchor      record;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO method_rule
    FROM pg_constraint
   WHERE conrelid = 'purchases'::regclass
     AND conname = 'purchases_processor_columns_follow_method';
  IF method_rule IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases_processor_columns_follow_method is '
      'gone. Without it both columns are nullable on EVERY method, so a card '
      'purchase with no processor and a wallet purchase naming one are both '
      'writable and 0081 has been reduced to a DROP NOT NULL.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO vocabulary
    FROM pg_constraint
   WHERE conrelid = 'purchases'::regclass AND conname = 'purchases_psp_check';
  IF vocabulary IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases_psp_check is gone. 0081 states the '
      'METHOD rule and does not restate the two MIDs, so dropping 0006''s CHECK '
      'makes any string a processor.';
  END IF;

  SELECT i.indisunique, i.indnullsnotdistinct, i.indpred IS NOT NULL AS partial
    INTO anchor
    FROM pg_index i
   WHERE i.indexrelid = 'purchases_psp_reference_uq'::regclass;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases_psp_reference_uq does not exist. '
      'The webhook idempotency anchor (0006:218, B4 #9) is gone.';
  END IF;
  IF NOT anchor.indisunique THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases_psp_reference_uq is no longer '
      'UNIQUE, so duplicate webhook delivery is defeated nowhere.';
  END IF;
  IF anchor.indnullsnotdistinct THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases_psp_reference_uq is NULLS NOT '
      'DISTINCT. Every wallet purchase keys on (NULL, NULL), so Merit may sell '
      'exactly one wallet-funded evaluation, ever. ADR-323 refused a partial '
      'index on the understanding that this never happens.';
  END IF;
  IF anchor.partial THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases_psp_reference_uq has become '
      'partial. ADR-323 ruled the whole index correct and refused the partial '
      'rewrite as a restatement of the CHECK; if that ruling has been reversed '
      'it needs an ADR, not an index definition nobody read.';
  END IF;

  IF (SELECT bool_or(attnotnull) FROM pg_attribute
       WHERE attrelid = 'purchases'::regclass
         AND attname IN ('psp', 'psp_reference')) THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 8: purchases.psp or purchases.psp_reference is '
      'NOT NULL again. A later SET NOT NULL restores the contradiction ADR-323 '
      'closed: the wallet purchase becomes unwritable and ACCEPTANCE 1 is the '
      'only case here that would say so.';
  END IF;

  RAISE NOTICE
    'REJECTION 8: the vocabulary is 0006''s, the method rule is 0081''s, the '
    'anchor is unique, whole and NULLS DISTINCT, and both columns are nullable';
END $$;

ROLLBACK;
