-- =============================================================================
-- Probe: ADR-027's ledger constraints, one perturbation each.
-- =============================================================================
-- A constraint nobody has watched reject anything is a constraint nobody knows
-- is wired up. Each block below asserts the constraint FIRES. If any block
-- completes without raising, this script fails the build.
--
-- LEDGER-C1 is the one that matters most: the collapse it catches PASSES the
-- zero-sum trigger, so zero-sum passing is not evidence C1 works.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Fixtures: one identity and the two per-identity positions. Fees is READ below.
INSERT INTO identities (id) VALUES ('11111111-1111-1111-1111-111111111111')
  ON CONFLICT DO NOTHING;

-- THE TWO PER-IDENTITY POSITIONS ARE READ AND NO LONGER SEEDED, for exactly the
-- reason fees_revenue is read below (ADR-183, migration 0054).
--
-- This block used to read: "These are still seeded here because nothing in this
-- tree creates a ledger account for an identity, at any point." That sentence
-- was true when it was written and 0054 makes it false. A trigger on identities
-- now opens all three positions, so the INSERT above fires it and the three
-- rows exist before this line is reached.
--
-- KEEPING THE SEED WOULD HAVE REPRODUCED ADR-177's DEFECT ONE CODE DOWN, and it
-- was executed rather than reasoned about: with 0054 applied and the pinned
-- rows still written under ON CONFLICT DO NOTHING, the clause skips them, the
-- pinned uuid names nothing, and the LEDGER-C1 block below raises
--   LEDGER-C2: ledger_account aaaaaaaa-0000-0000-0000-000000000002 does not exist
-- instead of probing C1 at all. That is the same failure this file's next
-- paragraph describes for 'fees_revenue','revenue', arriving by a new route.
CREATE TEMP VIEW probe_trader_wallet AS
  SELECT id FROM ledger_accounts
   WHERE code = 'trader_wallet'
     AND scope = 'identity'
     AND identity_id = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM probe_trader_wallet) THEN
    RAISE EXCEPTION
      'PROBE FAILED: the fixture identity has no trader_wallet position. 0054 '
      'provisions it on INSERT INTO identities; this probe reads it and no '
      'longer creates one';
  END IF;
END $$;

-- AND THE PROVISIONING ITSELF IS PROBED, because a mechanism nobody has watched
-- run is a mechanism nobody knows is wired up, which is this file's first line.
DO $$
DECLARE
  opened text[];
BEGIN
  SELECT array_agg(code ORDER BY code) INTO opened
    FROM ledger_accounts
   WHERE scope = 'identity'
     AND identity_id = '11111111-1111-1111-1111-111111111111';

  IF opened IS DISTINCT FROM
     ARRAY['promotional_credit','trader_wallet','trader_withdrawable'] THEN
    RAISE EXCEPTION
      'PROBE FAILED: 0054 opened % for the fixture identity; the three '
      'per-identity classes of ADR-027 are what it must open', opened;
  END IF;
END $$;

-- fees_revenue IS READ AND NOT SEEDED, because 0052 seeds it (ADR-177) and this
-- probe pre-dates the chart existing. It used to INSERT its own row under
-- ON CONFLICT DO NOTHING and pin the id; once the seed exists that clause SKIPS
-- the row, the pinned uuid names nothing, and the LEDGER-C1 block below raises
-- LEDGER-C2 on a dangling account instead of probing C1 at all. A fixture that
-- silently stops exercising its constraint is the failure this whole file
-- exists to prevent, so the id is now resolved from the chart rather than
-- asserted onto it.
CREATE TEMP VIEW probe_fees_revenue AS
  SELECT id FROM ledger_accounts WHERE code = 'fees_revenue' AND scope = 'firm';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM probe_fees_revenue) THEN
    RAISE EXCEPTION
      'PROBE FAILED: no firm fees_revenue account. 0052 seeds it; this probe '
      'reads it and no longer creates one';
  END IF;
END $$;

INSERT INTO ledger_transactions (id, kind, reference_kind, reference_id, idempotency_key)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001','payout_approval','probe',
          '11111111-1111-1111-1111-111111111111','probe-c1');

-- ---------------------------------------------------------------------------
-- LEDGER-C1 must reject opposite signs against ONE account.
-- ---------------------------------------------------------------------------
-- This is the C-01 collapse, exactly: +100000 and -90000 on the SAME position,
-- with -10000 to revenue. Debits equal credits, so zero-sum is satisfied and
-- the trader's position is net debited by firm_cents. C1 is the only thing
-- standing between this shape and a committed row.
DO $$
BEGIN
  BEGIN
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_cents) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001',(SELECT id FROM probe_trader_wallet), 100000),
      ('bbbbbbbb-0000-0000-0000-000000000001',(SELECT id FROM probe_trader_wallet), -90000),
      ('bbbbbbbb-0000-0000-0000-000000000001',(SELECT id FROM probe_fees_revenue), -10000);
    -- The trigger is DEFERRED, so it fires here, not on the INSERTs above.
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'PROBE FAILED: LEDGER-C1 admitted opposite signs on one account';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LEDGER-C1 fired as expected';
  END;
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- LEDGER-C2 must reject an undeclared class.
-- ---------------------------------------------------------------------------
-- The firm_payable catch. The CHECK on ledger_accounts.code should refuse the
-- row outright; this asserts the vocabulary is closed at the source.
BEGIN;
DO $$
BEGIN
  BEGIN
    INSERT INTO ledger_accounts (code, kind, scope) VALUES ('firm_payable','liability','firm');
    RAISE EXCEPTION 'PROBE FAILED: LEDGER-C2 admitted undeclared class firm_payable';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LEDGER-C2 fired as expected';
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- LEDGER-K1: ledger_accounts_kind_matches_code must bind every declared code,
-- and its ELSE arm must REFUSE rather than admit.
-- ---------------------------------------------------------------------------
-- ADDED BY ADR-186, AND THE GAP IT FILLS IS THAT THIS CONSTRAINT HAS NEVER BEEN
-- WATCHED FIRING BY ANYTHING THAT RUNS. ADR-177 installed it, ADR-180 and
-- ADR-186 each superseded it, and each of the three watched it in-session
-- against a database nobody keeps. What CI has is
-- packages/ledger/test/chart-of-accounts-kinds.test.ts, which reads the
-- migration TEXT: it would stay green against a constraint that failed to
-- install, against a DROP with no matching ADD, and against an arm the database
-- parses differently from the way the regex does. This file's first line is that
-- a constraint nobody has watched reject anything is a constraint nobody knows
-- is wired up, and until now that was true of this one.
--
-- ALL THREE BLOCKS MATTER AND THE ORDER IS THE ARGUMENT. K1a watches a refusal,
-- K1b watches an ACCEPTANCE -- a probe that only ever attempts forbidden things
-- passes against a guard that rejects everything, which is 0052's rule and
-- 0034's -- and K1c watches the ELSE arm, which is the half a text reader cannot
-- see at all.
--
-- FIRM SCOPE ONLY, DELIBERATELY. This block opens no per-identity row: the
-- fixtures above are READ from what 0054's trigger provisioned, and a probe that
-- asserted its own identity-scoped account back would reproduce ADR-177's defect
-- a third time.
BEGIN;
DO $$
BEGIN
  -- K1a. A REFUSAL. `reserve` is ruled `asset` (ADR-186); `liability` is the
  -- kind ADR-174 section 3 shape (iii) would have needed it to be, so this is
  -- the perturbation that matters rather than an arbitrary wrong literal.
  BEGIN
    INSERT INTO ledger_accounts (code, kind, scope) VALUES ('reserve','liability','firm');
    RAISE EXCEPTION
      'PROBE FAILED: LEDGER-K1 admitted reserve as a liability. Every declared '
      'code has a ruled kind and no firm code is a liability (ADR-186)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LEDGER-K1a fired as expected';
  END;
END $$;
ROLLBACK;

BEGIN;
DO $$
BEGIN
  -- K1b. AN ACCEPTANCE, and it is the half that makes K1a mean anything. If
  -- this raises, the constraint is rejecting the kind it rules rather than
  -- enforcing it, and every refusal above is vacuous.
  INSERT INTO ledger_accounts (code, kind, scope) VALUES ('reserve','asset','firm');
  IF NOT EXISTS (
    SELECT 1 FROM ledger_accounts WHERE code = 'reserve' AND kind = 'asset' AND scope = 'firm'
  ) THEN
    RAISE EXCEPTION 'PROBE FAILED: LEDGER-K1 refused reserve as an asset, which is its ruled kind';
  END IF;
  RAISE NOTICE 'LEDGER-K1b accepted the ruled kind, as expected';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- LEDGER-K2: the EIGHTH code's arm, in both directions
-- ---------------------------------------------------------------------------
-- ADDED BY ADR-187. `withdrawals_in_flight` is the external leg's in-flight
-- obligation and the ONLY firm-scoped `liability` in the chart. Its arm is the
-- one thing 0056 adds to this constraint, and a guard nobody has watched fire is
-- a guard nobody has.
--
-- THE ORDER IS THE ARGUMENT, as it is for K1. K2a watches a REFUSAL and K2b
-- watches an ACCEPTANCE, because a probe that only ever attempts forbidden
-- things passes against a guard that rejects everything.
--
-- BOTH BLOCKS DELETE THE SEEDED ROW INSIDE THE TRANSACTION FIRST. 0056 seeds
-- this code, so `ledger_accounts_firm_code_uq` would reject a second row on the
-- UNIQUE INDEX and the probe would report a kind refusal it never obtained. That
-- is ADR-186 section 7 row 4's method: without deleting first, an acceptance
-- test is consistent with a constraint that rejects everything AND with a unique
-- index that rejects everything, and the two are indistinguishable.
BEGIN;
DO $$
BEGIN
  -- K2a. A REFUSAL. `asset` is the kind every OTHER firm code is ruled, so this
  -- is the perturbation that matters: it is what the row would read if a later
  -- session classed the obligation with the cash accounts beside it.
  DELETE FROM ledger_accounts WHERE code = 'withdrawals_in_flight';
  BEGIN
    INSERT INTO ledger_accounts (code, kind, scope)
      VALUES ('withdrawals_in_flight','asset','firm');
    RAISE EXCEPTION
      'PROBE FAILED: LEDGER-K1 admitted withdrawals_in_flight as an asset. It is '
      'the external leg''s in-flight obligation and ADR-187 rules it a liability: '
      'LT-06 credits it at approval and LT-07 debits it when the cash leaves';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LEDGER-K2a fired as expected';
  END;
END $$;
ROLLBACK;

BEGIN;
DO $$
BEGIN
  -- K2b. AN ACCEPTANCE, and it is the half that makes K2a mean anything.
  DELETE FROM ledger_accounts WHERE code = 'withdrawals_in_flight';
  INSERT INTO ledger_accounts (code, kind, scope)
    VALUES ('withdrawals_in_flight','liability','firm');
  IF NOT EXISTS (
    SELECT 1 FROM ledger_accounts
      WHERE code = 'withdrawals_in_flight' AND kind = 'liability' AND scope = 'firm'
  ) THEN
    RAISE EXCEPTION
      'PROBE FAILED: LEDGER-K1 refused withdrawals_in_flight as a liability, '
      'which is its ruled kind';
  END IF;
  RAISE NOTICE 'LEDGER-K2b accepted the ruled kind, as expected';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- LEDGER-K3: the eighth code is SEEDED, and it is firm-scoped
-- ---------------------------------------------------------------------------
-- ADDED BY ADR-187. The mint's whole point is that LT-06 and LT-07 become
-- postable, and chart.ts's `resolve` throws rather than opening an account: a
-- migration that widened the vocabulary and seeded nothing would have bought no
-- postable transaction, which is ADR-181 section 4's third ground in a new form.
-- ADR-183 section 7 row 3 is the standing measurement of that failure.
--
-- AND NO IDENTITY OPENS A POSITION IN IT. 0054's trigger writes exactly the
-- three per-identity codes; this one is the firm's own obligation and an
-- identity-scoped row in it would make LT-07 visible to an identity-scoped
-- check, which is the property ADR-124 clause 3's conclusion depends on.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM ledger_accounts
    WHERE code = 'withdrawals_in_flight' AND kind = 'liability' AND scope = 'firm'
      AND identity_id IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'PROBE FAILED: expected exactly one firm withdrawals_in_flight row, found %. '
      '0056 seeds it and LT-06/LT-07 are unpostable without it', n;
  END IF;

  SELECT count(*) INTO n FROM ledger_accounts
    WHERE code = 'withdrawals_in_flight' AND scope = 'identity';
  IF n <> 0 THEN
    RAISE EXCEPTION
      'PROBE FAILED: % identity-scoped withdrawals_in_flight rows exist. The '
      'external leg''s obligation is the FIRM''s and LT-07 stays firm-only '
      '(ADR-174 clause 3)', n;
  END IF;
  RAISE NOTICE 'LEDGER-K3: the eighth code is seeded once, firm-scoped, as expected';
END $$;

BEGIN;
DO $$
BEGIN
  -- K1c. THE ELSE ARM, WHICH IS WHY 0055 EXISTS AT ALL. `code_is_declared` is
  -- dropped INSIDE this transaction so that the kind constraint is the only
  -- thing left standing, which is ADR-181 section 5 row 2's method for watching
  -- one guard independently of another. Under 0053's `ELSE true` this INSERT
  -- LANDED; under 0055's `ELSE false` it must not. A code with a name and no
  -- ruled kind is 0009:46's failure one column over.
  ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_code_is_declared;
  BEGIN
    INSERT INTO ledger_accounts (code, kind, scope) VALUES ('withdrawals_payable','liability','firm');
    RAISE EXCEPTION
      'PROBE FAILED: LEDGER-K1 ELSE arm admitted an undeclared code with an '
      'unruled kind. 0055 closed ELSE true to ELSE false so that minting a code '
      'requires ruling its kind in the same migration';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LEDGER-K1c fired as expected';
  END;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Zero-sum must reject an unbalanced transaction.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO identities (id) VALUES ('11111111-1111-1111-1111-111111111111') ON CONFLICT DO NOTHING;

-- READ, NOT SEEDED, for the same reason as the C1 block above. This block used
-- to pin 'cccccccc-0000-0000-0000-000000000001' onto its own trader_wallet row
-- under ON CONFLICT DO NOTHING; with 0054 provisioning the position, that
-- clause skips and the zero-sum block raises LEDGER-C2 on a dangling account
-- instead of probing zero-sum at all. Watched doing exactly that before it was
-- repaired.
CREATE TEMP VIEW probe_zs_wallet AS
  SELECT id FROM ledger_accounts
   WHERE code = 'trader_wallet'
     AND scope = 'identity'
     AND identity_id = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM probe_zs_wallet) THEN
    RAISE EXCEPTION
      'PROBE FAILED: the fixture identity has no trader_wallet position for the '
      'zero-sum block. 0054 provisions it on INSERT INTO identities';
  END IF;
END $$;

INSERT INTO ledger_transactions (id, kind, reference_kind, reference_id, idempotency_key)
  VALUES ('dddddddd-0000-0000-0000-000000000001','adjustment','probe',
          '11111111-1111-1111-1111-111111111111','probe-zs');
DO $$
BEGIN
  BEGIN
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_cents)
      VALUES ('dddddddd-0000-0000-0000-000000000001',(SELECT id FROM probe_zs_wallet), 1);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'PROBE FAILED: zero-sum admitted an unbalanced transaction';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'zero-sum fired as expected';
  END;
END $$;
ROLLBACK;

\echo 'All ledger constraint probes fired as expected.'
