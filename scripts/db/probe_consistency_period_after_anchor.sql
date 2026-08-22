-- =============================================================================
-- Probe: ADR-079's anchor-relative consistency period, installed by 0046.
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASES, and on this migration that is not a
-- stylistic preference. The defect being repaired was A CONSTRAINT REFUSING A
-- LEGITIMATE ROW: 0015 bounded consistency_period_start_day against the row's
-- own trading_day, while R-47 defines it against the ANCHOR and sets it to the
-- next trading day AFTER that anchor. On the eval-pass row the anchor IS the
-- row's day, so the period starts tomorrow and 0015 refused the row. NO
-- INVENTORY OF REJECTIONS CAN SEE THAT. One passed against it for thirty-one
-- migrations, for the same reason 0037's did: every case anybody thought to
-- write was a case the constraint was right about.
--
-- SUCCESS 1 IS SESSION 129'S ROW 0, VERBATIM. If it ever fails again, the bound
-- has been re-pointed at trading_day and every account that passes an
-- evaluation is unwritable from that commit onward.
--
-- REJECTION 1 AND REJECTION 2 ARE THE POINT OF THIS FILE AND THEY EXIST
-- BECAUSE OF WHAT SUCCESS 1 DOES NOT PROVE. On the eval-pass row
-- payout_anchor_day IS NULL, so the new constraint DOES NOT APPLY TO IT.
-- SUCCESS 1 therefore shows the constraint silent, not the constraint
-- permitting, and a CHECK that has only ever been watched not-applying is a
-- CHECK nobody has tested. These two are the boundary either side of R-47's
-- "strictly": start = anchor is refused because the rule is STRICT, and
-- start < anchor is refused because the period cannot precede its own anchor.
-- Without them this migration could ship a constraint that refuses nothing,
-- ever, and every assertion here would still pass.
--
-- REJECTION 3 ASSERTS FROM THE CATALOGUE THAT THE RETIRED NAME IS GONE rather
-- than merely quiet, on 0036's and 0037's precedent. The reason is stronger
-- here than in either: the OTHER OPERAND changed, from trading_day to
-- payout_anchor_day, so a reader who greps
-- `rule_states_consistency_period_started` must find nothing rather than a
-- statement about a different comparison.
--
-- REJECTION 4 IS THE ONE THAT LOOKS LIKE IT BELONGS IN A DIFFERENT FILE, and it
-- is ADR-053's hazard inverted. A CHECK THAT EVALUATES TO NULL PASSES IN
-- POSTGRESQL. 0037's predicate was two-valued because of three NOT NULLs it
-- never mentioned; THIS one is two-valued because of two IS NULL guards it
-- writes, and those guards are only load-bearing while both columns remain
-- NULLABLE. If a later migration makes either one NOT NULL, a guard here
-- becomes dead code and this file says so rather than leaving it to inspection.
--
-- REJECTION 5 asserts the predicate still names payout_anchor_day. A future
-- "simplification" back to a trading_day comparison would reinstate the exact
-- defect ADR-079 repairs, and SUCCESS 2 alone would not catch every form of it.
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
  ('aa000000-0000-0000-0000-000000000079', 'active');
INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000079',
   'aa000000-0000-0000-0000-000000000079',
   'Probe79@Example.test', 'probe79@example.test');
INSERT INTO plans (id, code, name) VALUES
  ('11100000-0000-0000-0000-000000000079', 'core_eod', 'Core EOD');
INSERT INTO plan_versions (id, plan_id, version, status, rules, public_slug,
                           created_by) VALUES
  ('11200000-0000-0000-0000-000000000079',
   '11100000-0000-0000-0000-000000000079', 1, 'draft', '{}'::jsonb,
   'core-eod-v79', 'bb000000-0000-0000-0000-000000000079');
INSERT INTO purchases (id, identity_id, user_id, plan_version_id, size_cents,
                       kind, list_price_cents, amount_paid_cents, psp,
                       psp_reference, status, paid_at)
VALUES ('11300000-0000-0000-0000-000000000079',
        'aa000000-0000-0000-0000-000000000079',
        'bb000000-0000-0000-0000-000000000079',
        '11200000-0000-0000-0000-000000000079', 5000000, 'new', 9900, 9900,
        'psp_a', 'probe-79-psp-ref', 'paid', now());
INSERT INTO accounts (id, identity_id, user_id, purchase_id, plan_version_id,
                      size_cents, phase, status, opened_on, funded_on)
VALUES ('11400000-0000-0000-0000-000000000079',
        'aa000000-0000-0000-0000-000000000079',
        'bb000000-0000-0000-0000-000000000079',
        '11300000-0000-0000-0000-000000000079',
        '11200000-0000-0000-0000-000000000079',
        5000000, 'funded', 'active', DATE '2026-01-01', DATE '2026-01-01');

-- One writer for every case, so a difference between two cases is a difference
-- in the three columns under test and never in the fifteen that are not.
-- `settled` drives payouts_settled_count and the two anchors together, because
-- rule_states_settlements_imply_anchors and rule_states_anchors_move_together
-- would otherwise be the constraint a rejection named.
CREATE FUNCTION pg_temp.probe_state(d date, anchor date, period_start date,
                                    label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                           floor_open_cents, floor_locked,
                           high_water_balance_cents, balance_cents,
                           withdrawable_cents, traded_days_count,
                           win_days_count, payout_anchor_day,
                           cadence_anchor_day, consistency_period_start_day,
                           payouts_settled_count, engine_eligible,
                           engine_gates, context_gates, state_hash,
                           engine_version)
  VALUES ('11400000-0000-0000-0000-000000000079', d, 'funded', 4750000, 4750000,
          false, 5000000, 5000000, 0, 1, 1, anchor,
          anchor, period_start,
          CASE WHEN anchor IS NULL THEN 0 ELSE 1 END, false,
          '{}'::jsonb, '{}'::jsonb, sha256(label::bytea), 'probe-0');
END $f$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: SESSION 129'S ROW 0. THE EVAL PASS DAY.
-- ---------------------------------------------------------------------------
-- THE ROW 0015 REFUSED, and the reason this file exists. R-31 sets the period
-- start to the next trading day after the pass day, so trading_day is
-- 2026-01-01 and the period starts 2026-01-02. Under 0015 this row was
-- rejected by rule_states_consistency_period_started; under 0046 the
-- constraint does not reach it, because no settlement has happened and
-- payout_anchor_day IS NULL.
--
-- THIS CASE PROVES THE CONSTRAINT IS SILENT HERE, NOT THAT IT PERMITS. What
-- proves the replacement is a control is REJECTION 1 and REJECTION 2 below.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-01-01', NULL, DATE '2026-01-02',
                              'adr079-eval-pass');
  RAISE NOTICE 'SUCCESS 1: the eval-pass row is writable (session 129 row 0, trading_day 2026-01-01 period_start 2026-01-02)';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: the eval-pass row is unwritable, the period bound has been re-pointed at trading_day';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: THE LEGITIMATE POST-SETTLEMENT ROW. GS-068's SHAPE.
-- ---------------------------------------------------------------------------
-- R-47 sets the period start to nextTradingDayAfter(basisTradingDay). GS-068's
-- basis day is 2026-11-25, Thanksgiving 2026-11-26 carries no session, and the
-- effective day is 2026-11-27. So the period starts 2026-11-27, which is two
-- CALENDAR days after the anchor and one TRADING day after it, and the row is
-- written for the effective day.
--
-- THIS IS ALSO THE CASE THAT SHOWS THE OLD PREDICATE HELD BY `<=` AND NOT BY
-- EQUALITY IN GENERAL: here the two happen to coincide, and on a longer
-- transfer window the period start would be strictly before trading_day.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-27', DATE '2026-11-25',
                              DATE '2026-11-27', 'adr079-gs068-settlement');
  RAISE NOTICE 'SUCCESS 2: a settled row whose period starts the next trading day after the anchor is writable (anchor 2026-11-25, start 2026-11-27)';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: GS-068''s settlement row is unwritable';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: A LATER FUNDED DAY CARRYING THE SAME PERIOD.
-- ---------------------------------------------------------------------------
-- The period start does not move between settlements, so on every day after
-- the settlement the stored start sits BEFORE trading_day. Both the old
-- predicate and the new one accept these rows, and this case is here so a
-- future reader can see that the change did not narrow the ordinary funded day.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-12-04', DATE '2026-11-25',
                              DATE '2026-11-27', 'adr079-later-funded-day');
  RAISE NOTICE 'SUCCESS 3: an ordinary funded day after the settlement is writable (start 2026-11-27 before trading_day 2026-12-04)';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'PROBE FAILED: an ordinary post-settlement funded day is unwritable';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: THE PERIOD STARTS ON THE ANCHOR ITSELF. AS-12, EXACTLY.
-- ---------------------------------------------------------------------------
-- THIS IS THE CASE THE WHOLE ENTRY IS FOR. AS-12: "If the basis day is included
-- in the new consistency period, the very day that funded a payout counts
-- against the next cycle. On a plan where the payout day is usually the best
-- day, this blocks the following cycle by exactly one large day, AND IT LOOKS
-- LIKE THE CONSISTENCY RULE WORKING RATHER THAN A BUG."
--
-- R-47 is STRICT (M01:563, and M01:737 comments the line `// R-47, strict`), so
-- start = anchor is the off-by-one and the database refuses it.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-27', DATE '2026-11-25',
                              DATE '2026-11-25', 'adr079-start-equals-anchor');
  RAISE EXCEPTION 'PROBE FAILED: a period starting ON its own anchor was accepted, which is AS-12''s off-by-one';
EXCEPTION WHEN check_violation THEN
  -- THE NAME IS ASSERTED RATHER THAN THE OUTCOME. `check_violation` alone is
  -- satisfied by ANY constraint on this table refusing the row, so a probe
  -- catching the bare condition would report this case green on a row rejected
  -- by rule_states_settlements_imply_anchors or by the win-day bound, which is
  -- a rejection that proves nothing about the constraint under test.
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'rule_states_consistency_period_after_anchor' THEN
    RAISE EXCEPTION 'PROBE FAILED: the row was refused by % rather than by the constraint under test', c;
  END IF;
  RAISE NOTICE 'REJECTION 1: a period starting ON the anchor is refused by %, (AS-12, R-47 is strict)', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: THE PERIOD STARTS BEFORE THE ANCHOR.
-- ---------------------------------------------------------------------------
-- The other side of the boundary. A period that began before the settlement it
-- is anchored to would count days the payout was already computed against,
-- which is AS-12 with a larger overlap.
DO $$
DECLARE c text;
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-11-27', DATE '2026-11-25',
                              DATE '2026-11-24', 'adr079-start-before-anchor');
  RAISE EXCEPTION 'PROBE FAILED: a period starting BEFORE its own anchor was accepted';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c <> 'rule_states_consistency_period_after_anchor' THEN
    RAISE EXCEPTION 'PROBE FAILED: the row was refused by % rather than by the constraint under test', c;
  END IF;
  RAISE NOTICE 'REJECTION 2: a period starting BEFORE the anchor is refused by %', c;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: THE RETIRED NAME IS GONE FROM THE CATALOGUE.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM 1 FROM pg_constraint
   WHERE conrelid = 'rule_states'::regclass
     AND conname = 'rule_states_consistency_period_started';
  IF FOUND THEN
    RAISE EXCEPTION 'PROBE FAILED: rule_states_consistency_period_started still exists, so a grep for it finds a statement whose reference point changed';
  END IF;
  RAISE NOTICE 'REJECTION 3: the retired name is absent from the catalogue';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: BOTH GUARDED COLUMNS ARE STILL NULLABLE.
-- ---------------------------------------------------------------------------
-- A CHECK evaluating to NULL PASSES. This predicate is two-valued because of
-- the two IS NULL guards it writes, and those guards are only meaningful while
-- both columns can actually be NULL. This is 0037's REJECTION 3 inverted: there
-- the NOT NULLs were load-bearing and unmentioned, here the nullability is
-- load-bearing and the guards are written.
DO $$
DECLARE nullable_count int;
BEGIN
  SELECT count(*) INTO nullable_count
    FROM information_schema.columns
   WHERE table_name = 'rule_states'
     AND column_name IN ('consistency_period_start_day', 'payout_anchor_day')
     AND is_nullable = 'YES';
  IF nullable_count <> 2 THEN
    RAISE EXCEPTION 'PROBE FAILED: % of 2 guarded columns are nullable; an IS NULL guard in rule_states_consistency_period_after_anchor is now dead code', nullable_count;
  END IF;
  RAISE NOTICE 'REJECTION 4: both guarded columns are nullable, so neither IS NULL guard is dead';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: THE PREDICATE STILL COMPARES AGAINST THE ANCHOR.
-- ---------------------------------------------------------------------------
-- A future edit re-pointing this at trading_day reinstates ADR-079's defect,
-- and it would do so while every success case above still passed.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'rule_states'::regclass
     AND conname = 'rule_states_consistency_period_after_anchor';
  IF def IS NULL THEN
    RAISE EXCEPTION 'PROBE FAILED: rule_states_consistency_period_after_anchor does not exist';
  END IF;
  IF position('payout_anchor_day' in def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAILED: the predicate no longer names payout_anchor_day: %', def;
  END IF;
  RAISE NOTICE 'REJECTION 5: the predicate still compares against payout_anchor_day';
END $$;

ROLLBACK;
