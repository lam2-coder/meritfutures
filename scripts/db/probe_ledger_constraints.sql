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

-- Fixtures: one identity, the two per-identity positions, and fees.
INSERT INTO identities (id) VALUES ('11111111-1111-1111-1111-111111111111')
  ON CONFLICT DO NOTHING;

INSERT INTO ledger_accounts (id, code, kind, scope, identity_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','trader_withdrawable','liability','identity','11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002','trader_wallet','liability','identity','11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003','fees_revenue','revenue','firm',NULL)
  ON CONFLICT DO NOTHING;

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
      ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002', 100000),
      ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002', -90000),
      ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003', -10000);
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
INSERT INTO ledger_accounts (id, code, kind, scope, identity_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001','trader_wallet','liability','identity','11111111-1111-1111-1111-111111111111')
  ON CONFLICT DO NOTHING;
INSERT INTO ledger_transactions (id, kind, reference_kind, reference_id, idempotency_key)
  VALUES ('dddddddd-0000-0000-0000-000000000001','adjustment','probe',
          '11111111-1111-1111-1111-111111111111','probe-zs');
DO $$
BEGIN
  BEGIN
    INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_cents)
      VALUES ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001', 1);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'PROBE FAILED: zero-sum admitted an unbalanced transaction';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'zero-sum fired as expected';
  END;
END $$;
ROLLBACK;

\echo 'All ledger constraint probes fired as expected.'
