-- =============================================================================
-- Probe: a wallet debit carries no provenance, installed by 0080 (ADR-322).
-- =============================================================================
-- THE DEFECT WAS A CONSTRAINT POINTING THE WRONG WAY, WHICH IS WORSE THAN AN
-- ABSENCE. `0011:71` made `provenance` NOT NULL over three values its own
-- comment calls kinds of CREDIT, on a table whose `direction` admits `'debit'`.
-- So the honest withdrawal debit was UNWRITABLE and a debit labelled `payout`
-- was WRITABLE, and an inventory of refusals would have scored that schema as
-- working. ACCEPTANCE 1 and REJECTION 1 are the two halves of that swap and
-- they are the reason this file exists.
--
-- IT LEADS WITH THE ACCEPTANCES AND THAT IS NOT A STYLE CHOICE. Every rejection
-- below passes against a column that refuses EVERYTHING, including against the
-- pre-`0080` schema for two of the four. What separates `0080` from a wall is
-- ACCEPTANCE 1 to 4: the honest debit, the credit that still carries its class,
-- and the correction debit `0038`'s ADJ-C3 requires.
--
-- ACCEPTANCE 4 IS THE ONE THAT LOOKS LIKE IT BELONGS IN ANOTHER FILE. It runs a
-- whole `account_adjustments` reversal through `0038`'s two deferred constraint
-- triggers, because ADR-322's ruling that `'correction'` stays admissible on a
-- debit is a claim about ADJ-C3 and not about this CHECK. A constraint that
-- refused it would install cleanly, satisfy every other case here, and make a
-- merged trigger unsatisfiable. `SET CONSTRAINTS ALL IMMEDIATE` is what forces
-- the deferred half to run inside a probe that ends in ROLLBACK.
--
-- REJECTION 3 IS THE VACUITY CASE AND IT IS THE ONE TO READ. A CHECK that
-- evaluates to NULL ADMITS the row, so the natural spelling of this constraint,
-- `(direction = 'credit' AND provenance IN (...)) OR (direction = 'debit' AND
-- ...)`, returns `NULL OR FALSE` = NULL for a credit with no provenance and
-- lets through the exact row it was written to refuse. `0080` is a total `CASE`
-- for that reason and REJECTION 3 is what would go red if somebody ever
-- "simplified" it back.
--
-- REJECTION 5 ASSERTS FROM THE CATALOGUE, because the two ways this ruling can
-- be lost are both invisible to every row above: `0011`'s own CHECK carries the
-- closed vocabulary, and a later migration dropping it would leave `deposit`
-- writable on a credit with every case in this file still green.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one identity and one posted transaction per entry.
-- ---------------------------------------------------------------------------
-- `wallet_entries.ledger_transaction_id` is NOT NULL and unique per row only by
-- convention, so one transaction is reused where the case does not care.
-- `balance_after_cents >= 0` is `INV-M20-01`'s DDL half and every value below
-- satisfies it: the arithmetic is not what any case here is measuring.
--
-- NO `ledger_accounts` ROW IS WRITTEN HERE AND THAT IS NOT AN OMISSION. The
-- identity's seven scoped accounts, `trader_wallet` among them, are provisioned
-- by the `identities_provision_ledger_accounts` trigger on the INSERT above;
-- writing one by hand raises `ledger_accounts_identity_code_uq`, which is how
-- this comment came to exist.
INSERT INTO identities (id, status) VALUES
  ('aa000000-0000-0000-0000-000000000322', 'active');
INSERT INTO ledger_transactions (id, kind, reference_kind, reference_id, idempotency_key)
VALUES
  ('cc000000-0000-0000-0000-000000000322', 'LT-06', 'wallet_withdrawal',
   'dd000000-0000-0000-0000-000000000322', 'probe-322-lt06'),
  ('cc000000-0000-0000-0000-000000000323', 'LT-01', 'payout_request',
   'dd000000-0000-0000-0000-000000000323', 'probe-322-lt01');

-- One writer for every row case, so a difference between two cases is a
-- difference in `direction` and `provenance` and never in the eight columns
-- that are not under test.
--
-- `provenance` GOES IN AS A BOUND PARAMETER AND NOT THROUGH `format`, because
-- NULL is one of the values under test and `%L` renders it as the four
-- characters `NULL` in some spellings and as the keyword in others. A bound
-- `text` parameter is exactly what a query builder sends, which is the writer
-- this constraint will actually meet.
CREATE FUNCTION pg_temp.probe_entry(p_direction text, p_provenance text,
                                    p_ledger uuid, p_balance bigint)
RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v_id bigint;
BEGIN
  INSERT INTO wallet_entries (identity_id, direction, amount_cents, provenance,
                              cause, reference_id, ledger_transaction_id,
                              balance_after_cents)
  VALUES ('aa000000-0000-0000-0000-000000000322', p_direction, 10000,
          p_provenance, 'probe-322', 'dd000000-0000-0000-0000-000000000322',
          p_ledger, p_balance)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$f$;

-- One whole `account_adjustments` correction, posting and wallet entry
-- included, for ACCEPTANCE 4. It is a separate writer from `probe_entry`
-- because ADJ-C2 and ADJ-C3 require all three artifacts to agree, and a fixture
-- that assembled them at each call site would be three chances to write a
-- disagreement the trigger would then report as a schema failure.
CREATE FUNCTION pg_temp.probe_adjustment(p_id uuid, p_direction text, p_tx uuid,
                                         p_reverses uuid)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_wallet  uuid;
        v_revenue uuid;
        v_sign    bigint;
BEGIN
  -- 0038's ADJ-C2 mapping, written out once at 0038:418. amount_cents on
  -- ledger_entries is SIGNED and positive is DEBIT; on the adjustment it is a
  -- MAGNITUDE. So a credit posts -amount against the identity's position and
  -- +amount against fees_revenue, and a debit posts the reverse.
  SELECT id INTO v_wallet FROM ledger_accounts
   WHERE scope = 'identity' AND code = 'trader_wallet'
     AND identity_id = 'aa000000-0000-0000-0000-000000000322';
  SELECT id INTO v_revenue FROM ledger_accounts
   WHERE scope = 'firm' AND code = 'fees_revenue';
  v_sign := CASE WHEN p_direction = 'credit' THEN -1 ELSE 1 END;

  INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_cents) VALUES
    (p_tx, v_wallet,   v_sign * 10000),
    (p_tx, v_revenue, -v_sign * 10000);

  -- THE ROW ADJ-C3 REQUIRES, AND ON THE DEBIT LEG IT IS THE WHOLE POINT OF
  -- THIS CASE: a wallet DEBIT carrying provenance = 'correction'.
  INSERT INTO wallet_entries (identity_id, direction, amount_cents, provenance,
                              cause, reference_id, ledger_transaction_id,
                              balance_after_cents)
  VALUES ('aa000000-0000-0000-0000-000000000322', p_direction, 10000,
          'correction', 'probe-322 adjustment', p_id, p_tx,
          CASE WHEN p_direction = 'credit' THEN 10000 ELSE 0 END);

  INSERT INTO account_adjustments
    (id, identity_id, direction, amount_cents, reason_code, reason_note,
     destination, ledger_transaction_id, reverses_adjustment_id, actor,
     dual_control_threshold_cents)
  VALUES (p_id, 'aa000000-0000-0000-0000-000000000322', p_direction, 10000,
          'goodwill',
          'probe-322: ADJ-C3 requires provenance=correction in both directions',
          'trader_wallet', p_tx, p_reverses, 'founder', 500000);
END;
$f$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 1: the honest withdrawal debit, which nothing could write before
-- ---------------------------------------------------------------------------
-- THE ROW THE WHOLE MIGRATION IS FOR. `EVENTS.md:291` rules that
-- `wallet.debited` has no provenance because "a debit consumes a composition
-- rather than having one", and `apps/api/src/routes/checkout.ts`'s
-- `WalletDebitInsert` declares no such field. Against `0001`..`0079` this exact
-- INSERT raises not_null_violation, which is what left ADR-305 slice 7's
-- withdrawal-approval driver with no writable row.
DO $$
BEGIN
  PERFORM pg_temp.probe_entry('debit', NULL,
                              'cc000000-0000-0000-0000-000000000322', 0);
  RAISE NOTICE 'ACCEPTANCE 1: a debit with no provenance is writable';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'PROBE FAILED: ACCEPTANCE 1: a wallet debit carrying no provenance was '
    'refused (%). EVENTS.md 6.1 rules that a debit HAS none, so the first '
    'writer of the wallet''s own statement has no legal row to write and '
    'every rejection in this file still passes.', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 2 and 3: a credit still carries its class, all three members
-- ---------------------------------------------------------------------------
-- THE HALF THAT CATCHES THE OPPOSITE DEFECT. Dropping the NOT NULL is a
-- widening, and a constraint written slightly wrong in the tightening direction
-- would refuse legitimate credits: `payout` is the trader_cents leg of a
-- settled payout (LT-01), which is the single most common row this table will
-- ever hold. Both non-correction members are exercised, one row each.
DO $$
DECLARE members text[] := ARRAY['payout', 'refund_wallet_funded'];
        m text;
        n int := 1;
BEGIN
  FOREACH m IN ARRAY members LOOP
    n := n + 1;
    BEGIN
      PERFORM pg_temp.probe_entry('credit', m,
                                  'cc000000-0000-0000-0000-000000000323', 10000);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'PROBE FAILED: ACCEPTANCE %: a credit with provenance % was refused '
        '(%). 0080 was meant to relax the debit side and change nothing about '
        'the credit side.', n, m, SQLERRM;
    END;
    RAISE NOTICE 'ACCEPTANCE %: a credit with provenance % is writable', n, m;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 4: 0038's ADJ-C3 reversal, which REQUIRES 'correction' on a debit
-- ---------------------------------------------------------------------------
-- ADR-322's central concession, executed rather than argued. A reversing
-- adjustment against `trader_wallet` is a DEBIT adjustment
-- (`account_adjustments_debit_is_a_reversal`), and
-- `assert_adjustment_wallet_entry_matches` requires exactly one matching wallet
-- entry with `w.direction = NEW.direction` AND `w.provenance = 'correction'`.
-- A biconditional forbidding provenance on every debit would make this pair
-- unsatisfiable, and NOTHING ELSE IN THIS FILE WOULD NOTICE.
--
-- `SET CONSTRAINTS ALL IMMEDIATE` is load bearing: both of `0038`'s assertions
-- are DEFERRABLE INITIALLY DEFERRED, so in a probe that ends in ROLLBACK they
-- would otherwise never run and this case would report green having verified
-- nothing.
DO $$
DECLARE v_credit_adj uuid := 'ee000000-0000-0000-0000-000000000322';
        v_debit_adj  uuid := 'ee000000-0000-0000-0000-000000000323';
        v_tx_credit  uuid := 'cc000000-0000-0000-0000-000000000324';
        v_tx_debit   uuid := 'cc000000-0000-0000-0000-000000000325';
BEGIN
  -- Two transactions, because ADJ-C2 requires each adjustment to post exactly
  -- two legs of its own. The reversing one names the reversed one in
  -- `reversal_of`, which is ADJ-C1 check 6: without it a reversal is merely a
  -- transaction that happens to be equal and opposite.
  INSERT INTO ledger_transactions (id, kind, reference_kind, reference_id,
                                   idempotency_key, reversal_of)
  VALUES (v_tx_credit, 'ADJ', 'account_adjustment', v_credit_adj,
          'probe-322-adj-credit', NULL),
         (v_tx_debit, 'ADJ', 'account_adjustment', v_debit_adj,
          'probe-322-adj-debit', v_tx_credit);

  PERFORM pg_temp.probe_adjustment(v_credit_adj, 'credit', v_tx_credit, NULL);
  PERFORM pg_temp.probe_adjustment(v_debit_adj, 'debit', v_tx_debit, v_credit_adj);

  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE NOTICE
    'ACCEPTANCE 4: 0038''s ADJ-C3 still holds; a reversing adjustment writes a '
    'wallet DEBIT with provenance=correction and both deferred triggers pass';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: a debit labelled `payout`, which is the row 0011 admitted
-- ---------------------------------------------------------------------------
-- THE COUNTERFACTUAL. This exact row COMMITS against `0001`..`0079`, verified
-- before `0080` was written. ADR-158 clause 2's cost is what it buys: "a client
-- reading a debit labelled `payout` would render a credit class on a
-- withdrawal", on the screen where the trader reads what happened to their
-- money.
DO $$
BEGIN
  PERFORM pg_temp.probe_entry('debit', 'payout',
                              'cc000000-0000-0000-0000-000000000322', 0);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 1: wallet_entries stored a DEBIT with '
    'provenance=payout. A withdrawal is now labelled with the class of the '
    'money it consumed, which is the mislabel ADR-158 finding 3 named and '
    '0080 exists to end.';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'REJECTION 1: a debit labelled payout is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: a debit labelled `refund_wallet_funded`, the second member
-- ---------------------------------------------------------------------------
-- Not redundant with REJECTION 1: a constraint written as
-- `provenance <> 'payout'` on the debit branch passes REJECTION 1 and admits
-- this one, and that is a plausible narrowing rather than an invented one.
DO $$
BEGIN
  PERFORM pg_temp.probe_entry('debit', 'refund_wallet_funded',
                              'cc000000-0000-0000-0000-000000000322', 0);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 2: wallet_entries stored a DEBIT with '
    'provenance=refund_wallet_funded. Only the direction-agnostic member '
    '(correction) may appear on a debit.';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'REJECTION 2: a debit labelled refund_wallet_funded is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: a CREDIT with no provenance, which is the vacuity case
-- ---------------------------------------------------------------------------
-- THE CASE THAT FAILS IF SOMEBODY SIMPLIFIES THE CONSTRAINT. `0011`'s CHECK
-- passes a NULL, because `NULL IN (...)` is NULL and a CHECK that evaluates to
-- NULL admits the row; so does the disjunctive spelling of `0080`'s own rule,
-- for the same reason one branch further along. The only thing standing between
-- this schema and a credit whose class is unknown is the total `CASE`, and
-- without a class every rule in M20 section 3.4 is unevaluable against that
-- balance.
DO $$
BEGIN
  PERFORM pg_temp.probe_entry('credit', NULL,
                              'cc000000-0000-0000-0000-000000000323', 10000);
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 3: wallet_entries stored a CREDIT with no '
    'provenance. INV-M20-04 requires every credit to record its provenance '
    'class, and a CHECK that returns NULL admits the row rather than refusing '
    'it: 0080''s CASE has probably been rewritten as a disjunction.';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'REJECTION 3: a credit with no provenance is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: the deposit that may never exist, in both directions
-- ---------------------------------------------------------------------------
-- INV-WALLET-NO-DEPOSITS. `0011`'s header states it as a PROMISE and its CHECK
-- is that promise in DDL; `0080` relaxes a NOT NULL on the same column and this
-- is the case that says the promise survived the relaxation. A widening that
-- also admitted a new member would be caught nowhere else here.
DO $$
DECLARE dirs text[] := ARRAY['credit', 'debit'];
        d text;
BEGIN
  FOREACH d IN ARRAY dirs LOOP
    BEGIN
      PERFORM pg_temp.probe_entry(d, 'deposit',
                                  'cc000000-0000-0000-0000-000000000322', 0);
      RAISE EXCEPTION
        'PROBE FAILED: REJECTION 4: wallet_entries stored a % with '
        'provenance=deposit. INV-WALLET-NO-DEPOSITS is a regulatory promise '
        'about stored value and 0011''s closed list is where it is kept.', d;
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'REJECTION 4: provenance=deposit is refused on a %', d;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: both constraints are still installed, read from the catalogue
-- ---------------------------------------------------------------------------
-- EVERY CASE ABOVE PASSES WITH `0011`'s CHECK DROPPED except REJECTION 4, and
-- every case above passes with `0080`'s CHECK dropped except the three
-- rejections it owns. This asserts that the pair is still a pair and names what
-- each half carries, because ADR-322's ruling is deliberately split across two
-- migrations: `0011` holds the vocabulary and `0080` holds the direction rule,
-- so that the three members are written down exactly once.
DO $$
DECLARE vocabulary text;
        direction_rule text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO vocabulary
    FROM pg_constraint
   WHERE conrelid = 'wallet_entries'::regclass
     AND conname = 'wallet_entries_provenance_check';
  IF vocabulary IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 5: wallet_entries_provenance_check is gone. '
      '0080 states the DIRECTION rule and deliberately does not restate the '
      'closed vocabulary, so dropping 0011''s CHECK makes any string a legal '
      'provenance on a credit, INV-WALLET-NO-DEPOSITS included.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO direction_rule
    FROM pg_constraint
   WHERE conrelid = 'wallet_entries'::regclass
     AND conname = 'wallet_entries_provenance_follows_direction';
  IF direction_rule IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 5: wallet_entries_provenance_follows_direction '
      'is gone. Without it the column is nullable on BOTH sides, so a credit '
      'with no class and a debit labelled payout are both writable and 0080 '
      'has been reduced to a DROP NOT NULL.';
  END IF;

  IF (SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'wallet_entries'::regclass AND attname = 'provenance') THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 5: wallet_entries.provenance is NOT NULL again. '
      'A later SET NOT NULL restores the contradiction ADR-322 closed: the '
      'honest debit becomes unwritable and ACCEPTANCE 1 is the only case here '
      'that would say so.';
  END IF;

  RAISE NOTICE
    'REJECTION 5: the vocabulary is 0011''s, the direction rule is 0080''s, '
    'and the column is nullable';
END $$;

ROLLBACK;
