-- =============================================================================
-- Probe: EC-157's Repair A, the mark identities (0036)
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASE, and here that is not a stylistic preference:
-- the whole finding is that a legitimate row was REFUSED. A probe that only
-- attempted forbidden things would have passed against 0014's constraint for
-- the entire time the defect existed, which is exactly what happened for
-- twenty-two migrations.
--
-- SUCCESS 1 is the row EC-157 is about. Under 0014 it was unwritable; under
-- 0036 it commits. Run this file against 0001-0035 and SUCCESS 1 fails, which
-- is the counterfactual and is recorded in DELTA_MANIFEST.
--
-- Every assertion is checked by MESSAGE where it is a rejection, never by
-- exception class, on 0028's lesson: before that fix a retirement raised
-- `undefined_column` and a handler catching "any error" scored it as the
-- constraint working.
--
-- The file ends in ROLLBACK. Nothing here is deferred, so no
-- SET CONSTRAINTS ... IMMEDIATE is needed; 0033's probe needs one and this one
-- does not, and the difference is that these are plain CHECKs.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Fixtures. Every column is one this migration set declares NOT NULL.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE
  v_identity uuid;
  v_user     uuid;
  v_plan     uuid;
  v_pv       uuid;
  v_purchase uuid;
  v_account  uuid;
BEGIN
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_identity;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (v_identity, 'ec157@example.test', 'ec157@example.test')
    RETURNING id INTO v_user;

  INSERT INTO plans (code, name) VALUES ('core_eod', 'Core EOD probe')
    RETURNING id INTO v_plan;
  INSERT INTO plan_versions (plan_id, version, status, rules, public_slug, created_by)
    VALUES (v_plan, 1, 'draft', '{"schema_version":1}'::jsonb, 'ec157-probe', v_user)
    RETURNING id INTO v_pv;
  UPDATE plan_versions SET status = 'published', published_at = now() WHERE id = v_pv;

  INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                         list_price_cents, amount_paid_cents, psp, psp_reference,
                         status, paid_at)
    VALUES (v_identity, v_user, v_pv, 5000000, 'new', 15000, 15000, 'psp_a',
            'ec157-ref', 'paid', now())
    RETURNING id INTO v_purchase;

  INSERT INTO accounts (identity_id, user_id, purchase_id, plan_version_id,
                        size_cents, status, phase, opened_on, funded_on)
    VALUES (v_identity, v_user, v_purchase, v_pv, 5000000, 'active', 'funded',
            current_date, current_date)
    RETURNING id INTO v_account;

  INSERT INTO probe_ids VALUES ('account', v_account);
END $$;

-- -----------------------------------------------------------------------------
-- SUCCESS 1: THE ROW EC-157 IS ABOUT
-- -----------------------------------------------------------------------------
-- EC-157's worked case, in integer cents. Prior close 5,000,000. A settled
-- payout of 250,000 lands at the OPEN (R-10), so INV-18 gives opening
-- 4,750,000. The day makes 30,000, so INV-19 gives closing 4,780,000.
--
-- 0014 required 4,530,000 and refused this row. That is the defect: the mark
-- for EVERY SETTLED PAYOUT was unwritable as specified.
DO $$
DECLARE v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
BEGIN
  INSERT INTO daily_marks (
    account_id, trading_day,
    opening_balance_cents, closing_balance_cents,
    high_balance_cents, low_balance_cents,
    realized_pnl_cents, adjustment_cents,
    fill_count, traded_day, win_day, source_hash, source
  ) VALUES (
    v_account, DATE '2026-03-02',
    4750000,            -- INV-18: prior 5,000,000 + adjustment (-250,000)
    4780000,            -- INV-19: opening + realized_pnl
    4790000, 4740000,
    30000, -250000,
    12, true, true, '\x00'::bytea, 'report'
  );
  RAISE NOTICE 'SUCCESS 1: a settled-payout mark satisfying INV-18 and INV-19 is writable';
END $$;

-- -----------------------------------------------------------------------------
-- SUCCESS 2: a positive adjustment, which is the promotional-credit direction
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
BEGIN
  INSERT INTO daily_marks (
    account_id, trading_day,
    opening_balance_cents, closing_balance_cents,
    high_balance_cents, low_balance_cents,
    realized_pnl_cents, adjustment_cents,
    fill_count, traded_day, win_day, source_hash, source
  ) VALUES (
    v_account, DATE '2026-03-03',
    5010000, 5015000, 5020000, 5005000,
    5000, 10000,
    3, true, true, '\x00'::bytea, 'report'
  );
  RAISE NOTICE 'SUCCESS 2: a positive adjustment is writable in the same shape';
END $$;

-- -----------------------------------------------------------------------------
-- SUCCESS 3: the zero-adjustment day, which is why nothing noticed
-- -----------------------------------------------------------------------------
-- At adjustment = 0 the old constraint and INV-19 agree exactly, which is the
-- reason every mark in the repository passed and the defect stayed invisible.
DO $$
DECLARE v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
BEGIN
  INSERT INTO daily_marks (
    account_id, trading_day,
    opening_balance_cents, closing_balance_cents,
    high_balance_cents, low_balance_cents,
    realized_pnl_cents, adjustment_cents,
    fill_count, traded_day, win_day, source_hash, source
  ) VALUES (
    v_account, DATE '2026-03-04',
    5000000, 5020000, 5025000, 4995000,
    20000, 0,
    5, true, true, '\x00'::bytea, 'report'
  );
  RAISE NOTICE 'SUCCESS 3: the zero-adjustment day still passes, unchanged';
END $$;

-- -----------------------------------------------------------------------------
-- REJECTION 1: INV-19 still binds, and it is the half a CHECK can see
-- -----------------------------------------------------------------------------
-- Repair A drops an identity from the schema; it does not stop asserting the
-- one that is intra-row. A closing that does not equal opening + realized_pnl
-- must still be refused, or this migration would have removed a guarantee
-- rather than corrected one.
DO $$
DECLARE
  v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
  v_msg text;
BEGIN
  BEGIN
    INSERT INTO daily_marks (
      account_id, trading_day,
      opening_balance_cents, closing_balance_cents,
      high_balance_cents, low_balance_cents,
      realized_pnl_cents, adjustment_cents,
      fill_count, traded_day, win_day, source_hash, source
    ) VALUES (
      v_account, DATE '2026-03-05',
      5000000, 5099999,           -- not opening + realized_pnl
      5100000, 4999000,
      20000, 0,
      5, true, true, '\x00'::bytea, 'report'
    );
    RAISE EXCEPTION 'REJECTION 1 DID NOT FIRE: INV-19 accepted a broken closing identity';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF position('daily_marks_inv19_closing_identity' in v_msg) = 0 THEN
      RAISE EXCEPTION 'REJECTION 1 fired on the WRONG constraint: %', v_msg;
    END IF;
    RAISE NOTICE 'REJECTION 1: daily_marks_inv19_closing_identity refused a broken closing';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- REJECTION 2: the retired name is GONE, not merely quiet
-- -----------------------------------------------------------------------------
-- 0036 drops the old constraint rather than redefining it under its own name.
-- If the name survived, every reference to it would point at a statement whose
-- meaning had silently changed, which is the C-02 defect. Asserted from the
-- catalogue, because "no row failed it" is not evidence that it is gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'daily_marks' AND c.conname = 'daily_marks_balance_arithmetic'
  ) THEN
    RAISE EXCEPTION 'REJECTION 2 FAILED: daily_marks_balance_arithmetic still exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'daily_marks' AND c.conname = 'daily_marks_inv19_closing_identity'
  ) THEN
    RAISE EXCEPTION 'REJECTION 2 FAILED: the replacement constraint is absent';
  END IF;
  RAISE NOTICE 'REJECTION 2: the retired name is gone and the replacement is present';
END $$;

-- -----------------------------------------------------------------------------
-- REJECTION 3: the day-bounding constraints are untouched
-- -----------------------------------------------------------------------------
-- 0036 changes one constraint. If it had loosened the high/low bounds as
-- collateral, this probe would still be green on everything above.
DO $$
DECLARE
  v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
  v_msg text;
BEGIN
  BEGIN
    INSERT INTO daily_marks (
      account_id, trading_day,
      opening_balance_cents, closing_balance_cents,
      high_balance_cents, low_balance_cents,
      realized_pnl_cents, adjustment_cents,
      fill_count, traded_day, win_day, source_hash, source
    ) VALUES (
      v_account, DATE '2026-03-06',
      5000000, 5020000,
      5010000,                    -- high below the closing it must bound
      4995000,
      20000, 0,
      5, true, true, '\x00'::bytea, 'report'
    );
    RAISE EXCEPTION 'REJECTION 3 DID NOT FIRE: the high bound accepted a high below the close';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF position('daily_marks_high_bounds_day' in v_msg) = 0 THEN
      RAISE EXCEPTION 'REJECTION 3 fired on the WRONG constraint: %', v_msg;
    END IF;
    RAISE NOTICE 'REJECTION 3: daily_marks_high_bounds_day is unchanged and still binds';
  END;
END $$;

ROLLBACK;

\echo 'probe_daily_marks_identities: three success cases and three rejections, all as required.'
