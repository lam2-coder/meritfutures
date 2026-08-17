-- =============================================================================
-- Probe: ADR-053's scoped high-water bound, installed by 0037.
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASES, and on this migration that is not a
-- stylistic preference. The defect being repaired was A CONSTRAINT REFUSING A
-- LEGITIMATE ROW: 0015 asserted `high_water_balance_cents >= balance_cents`
-- unconditionally while R-15 freezes hwb permanently at the floor lock, so the
-- state row of every locked account that then made a new closing high was
-- unwritable. NO INVENTORY OF REJECTIONS CAN SEE THAT. An inventory of
-- rejections passed against it for twenty-two migrations, exactly as it did for
-- EC-157, and for the same reason: every case anybody thought to write was a
-- case the constraint was right about.
--
-- SUCCESS 1 IS GS-016'S EXPECTED END STATE, VERBATIM. If it ever fails again,
-- the constraint has been re-tightened and every funded account that passes an
-- evaluation is unwritable from that commit onward.
--
-- SUCCESS 4 AND SUCCESS 5 ARE THE SAME FUNDED-RESET ROW UNDER BOTH READINGS OF
-- AN OPEN FOUNDER ITEM. INV-07 says a locked floor never changes "for the life
-- of the account"; progression.ts writes floorLocked: false at DO-8; ADR-050
-- deliberately did not cover it. ADR-053 lands without taking a side, and these
-- two cases are what make that claim testable rather than asserted. They are
-- also what would fail if somebody later replaced this constraint with a
-- cross-row freeze trigger, because R-31 resets hwb DOWNWARD to size_cents and
-- on Core EOD every eval pass is also a lock day.
--
-- REJECTION 2 ASSERTS FROM THE CATALOGUE THAT THE RETIRED NAME IS GONE rather
-- than merely quiet, on 0036's precedent, so a reader who greps
-- `rule_states_high_water_bounds_balance` finds nothing instead of finding a
-- statement whose meaning changed underneath them.
--
-- REJECTION 3 IS THE ONE THAT LOOKS LIKE IT BELONGS IN A DIFFERENT FILE, and it
-- is the most important assertion here. A CHECK THAT EVALUATES TO NULL PASSES
-- IN POSTGRESQL. This predicate is two-valued only because floor_locked,
-- high_water_balance_cents and balance_cents are all NOT NULL, and IT MENTIONS
-- NONE OF THEM. Drop any one of those NOT NULLs in a later migration and this
-- constraint silently becomes one that admits everything, with its text
-- unchanged, its name unchanged, and every rejection in this file still
-- passing. The three NOT NULLs are load-bearing for a constraint that does not
-- name them, so they are asserted where somebody dropping one will see it.
--
-- REJECTION 4 asserts the predicate still mentions floor_locked. A future
-- "simplification" back to the unconditional form would pass REJECTION 1, which
-- only exercises unlocked rows.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one identity, one funded CORE-50K account.
-- ---------------------------------------------------------------------------
-- The plan is not read by any constraint here; the numbers below are M01
-- Appendix A.1 at 50K and are written out so the rows are recognisable as the
-- fixtures they are taken from rather than as arbitrary integers.
INSERT INTO identities (id, status) VALUES
  ('aa000000-0000-0000-0000-000000000053', 'active');
INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000053',
   'aa000000-0000-0000-0000-000000000053',
   'Probe53@Example.test', 'probe53@example.test');
INSERT INTO plans (id, code, name) VALUES
  ('11100000-0000-0000-0000-000000000053', 'core_eod', 'Core EOD');
INSERT INTO plan_versions (id, plan_id, version, status, rules, public_slug,
                           created_by) VALUES
  ('11200000-0000-0000-0000-000000000053',
   '11100000-0000-0000-0000-000000000053', 1, 'draft', '{}'::jsonb,
   'core-eod-v53', 'bb000000-0000-0000-0000-000000000053');
INSERT INTO purchases (id, identity_id, user_id, plan_version_id, size_cents,
                       kind, list_price_cents, amount_paid_cents, psp,
                       psp_reference, status, paid_at)
VALUES ('11300000-0000-0000-0000-000000000053',
        'aa000000-0000-0000-0000-000000000053',
        'bb000000-0000-0000-0000-000000000053',
        '11200000-0000-0000-0000-000000000053', 5000000, 'new', 9900, 9900,
        'psp_a', 'probe-53-psp-ref', 'paid', now());
INSERT INTO accounts (id, identity_id, user_id, purchase_id, plan_version_id,
                      size_cents, phase, status, opened_on, funded_on)
VALUES ('11400000-0000-0000-0000-000000000053',
        'aa000000-0000-0000-0000-000000000053',
        'bb000000-0000-0000-0000-000000000053',
        '11300000-0000-0000-0000-000000000053',
        '11200000-0000-0000-0000-000000000053',
        5000000, 'funded', 'active', DATE '2026-11-02', DATE '2026-11-02');

-- One writer for every case, so a difference between two cases is a difference
-- in the three columns under test and never in the twelve that are not.
CREATE FUNCTION pg_temp.probe_state(d date, locked boolean, hwb bigint,
                                    bal bigint, label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                           floor_open_cents, floor_locked,
                           high_water_balance_cents, balance_cents,
                           withdrawable_cents, traded_days_count,
                           win_days_count, payouts_settled_count,
                           engine_eligible, engine_gates, context_gates,
                           state_hash, engine_version)
  VALUES ('11400000-0000-0000-0000-000000000053', d, 'funded', 5010000, 5010000,
          locked, hwb, bal, 0, 1, 1, 0, false, '{}'::jsonb, '{}'::jsonb,
          sha256(label::bytea), 'probe-0');
END $f$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: GS-016 day two. A LOCKED ACCOUNT MAKES A NEW CLOSING HIGH.
-- ---------------------------------------------------------------------------
-- THE ROW 0015 REFUSED, and the reason this file exists. Core EOD at 50K locks
-- at 260,000c of profit; the eval target is 300,000c, so every account that
-- passes crosses the lock and every closing high after it is this row.
--   hwb 5,260,000 frozen at the lock, balance 5,400,000 on the later high.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-04', true, 5260000, 5400000,
                              'gs016-day-two');
  RAISE NOTICE 'SUCCESS 1: a locked account may make a new closing high (GS-016 day two)';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: GS-016 day two is unwritable, the high-water bound has been re-tightened';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: GS-024 day three, the same shape from a different fixture
-- ---------------------------------------------------------------------------
-- Included because GS-016 is a two-day file built for the lock and GS-024 is a
-- four-day file built for the consistency gate that reaches this state on the
-- way past. One fixture demonstrating a shape can be dismissed as a fixture
-- written oddly; two cannot.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-05', true, 5300001, 5450001,
                              'gs024-day-three');
  RAISE NOTICE 'SUCCESS 2: GS-024 day three is writable (locked, hwb below balance)';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: GS-024 day three is unwritable';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: unlocked, hwb EQUAL to balance
-- ---------------------------------------------------------------------------
-- The boundary of the surviving half. Every ordinary day that closes at a new
-- high is this row, because DO-7 sets hwb = max(hwb, closing) before anything
-- else touches it. A `>` written where `>=` belongs passes REJECTION 1 and
-- fails here.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-06', false, 5400000, 5400000,
                              'unlocked-equal');
  RAISE NOTICE 'SUCCESS 3: unlocked with hwb EQUAL to balance is writable';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: the bound rejects equality, so it is > where R-13 says >=';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4 and 5: the R-31 funded reset, under BOTH readings of INV-07
-- ---------------------------------------------------------------------------
-- R-31: "balance = size_cents; hwb = size_cents; floor = size_cents - funded
-- drawdown_cents". Whether floorLocked survives that reset is an OPEN FOUNDER
-- ITEM, and ADR-053 claims to be correct either way. These two cases are that
-- claim, executed.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-09', false, 5000000, 5000000,
                              'r31-lock-cleared');
  RAISE NOTICE 'SUCCESS 4: the funded reset is writable with the lock CLEARED';
  PERFORM pg_temp.probe_state(DATE '2026-11-10', true, 5000000, 5000000,
                              'r31-lock-persisting');
  RAISE NOTICE 'SUCCESS 5: the funded reset is writable with the lock PERSISTING';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: the funded reset is unwritable under one reading of INV-07, so this constraint has taken a side on an unruled item';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: UNLOCKED with hwb below balance must still be refused
-- ---------------------------------------------------------------------------
-- The half of 0015 that was right, and the whole reason ADR-053 scopes the
-- constraint rather than dropping it. Checked BY NAME, because an unrelated
-- check_violation on any of the other seven constraints of this table would
-- otherwise read as a pass.
DO $$
DECLARE c text;
BEGIN
  BEGIN
    PERFORM pg_temp.probe_state(DATE '2026-11-11', false, 5260000, 5400000,
                                'unlocked-below');
    RAISE EXCEPTION 'PROBE FAILED: an unlocked state row with hwb below balance was admitted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
    IF c <> 'rule_states_high_water_bounds_balance_unlocked' THEN
      RAISE EXCEPTION 'PROBE FAILED: rejected by % rather than the high-water bound', c;
    END IF;
    RAISE NOTICE 'REJECTION 1: an unlocked row with hwb below balance is refused, by name';
  END;
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- REJECTION 2: the retired name is GONE from the catalogue
-- ---------------------------------------------------------------------------
-- 0037 drops `rule_states_high_water_bounds_balance` rather than redefining it,
-- so that a reference to that name resolves to nothing rather than to a
-- statement whose meaning changed. This asserts the drop happened rather than
-- trusting that it did.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname = 'rule_states_high_water_bounds_balance';
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE FAILED: the retired constraint name is still installed';
  END IF;
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'rule_states'::regclass
     AND conname = 'rule_states_high_water_bounds_balance_unlocked';
  IF n <> 1 THEN
    RAISE EXCEPTION 'PROBE FAILED: the scoped constraint is not installed';
  END IF;
  RAISE NOTICE 'REJECTION 2: the retired name is gone and the scoped one is installed';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: THE THREE NOT NULLs THE PREDICATE DEPENDS ON AND DOES NOT NAME
-- ---------------------------------------------------------------------------
-- A CHECK THAT EVALUATES TO NULL PASSES. `floor_locked OR hwb >= balance` is
-- two-valued only because all three columns are NOT NULL. Drop one later and
-- this constraint admits everything while its text still reads correctly and
-- every rejection above still passes. This is the assertion that fails on the
-- day somebody makes one of them nullable.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname) INTO missing
    FROM pg_attribute a
   WHERE a.attrelid = 'rule_states'::regclass
     AND a.attname IN ('floor_locked', 'high_water_balance_cents',
                       'balance_cents')
     AND NOT a.attnotnull;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAILED: % lost NOT NULL, so the high-water bound can now evaluate to NULL and a NULL CHECK PASSES', missing;
  END IF;
  RAISE NOTICE 'REJECTION 3: all three columns the predicate depends on are still NOT NULL';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: the predicate still carries its scope
-- ---------------------------------------------------------------------------
-- Every case above exercises the constraint through rows. A revert to the
-- unconditional form would pass REJECTION 1 and fail only SUCCESS 1 and 2, so
-- the scope is asserted directly as well: the text must still mention
-- floor_locked.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'rule_states'::regclass
     AND conname = 'rule_states_high_water_bounds_balance_unlocked';
  IF def IS NULL OR position('floor_locked' in def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAILED: the high-water bound no longer mentions floor_locked: %', def;
  END IF;
  RAISE NOTICE 'REJECTION 4: the predicate is still scoped by floor_locked';
END $$;
