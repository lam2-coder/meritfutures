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
