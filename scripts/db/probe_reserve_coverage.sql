-- =============================================================================
-- Probe: reserve coverage (0049). OI-01, ADR-128
-- =============================================================================
-- SIX SUCCESS CASES BEFORE THE FIRST REJECTION, and the reason is the same one
-- DELTA_MANIFEST section 13 gives every time: a table that refuses everything
-- passes an inventory of refusals. This table's whole purpose is to make a
-- number WRITABLE that had nowhere to live, so a guard that refused every row
-- would satisfy every rejection below and close OI-01 with a table nobody can
-- use.
--
-- SUCCESS 4 IS THE BOUNDARY AND IT IS THE ONE TO READ. The GLOSSARY puts the
-- breaker at exactly 1.0, and rcr_bp is integer arithmetic, so a coverage of
-- exactly 1.0 must render 10000 and not 9999. An expression that divided before
-- it multiplied, or that lost a digit, would arm the circuit breaker on a fully
-- covered book and pause sales for a rounding.
--
-- SUCCESS 5 IS ITS MIRROR: truncation is toward zero, so a ratio just above 1.0
-- reads as exactly 1.0 and a ratio just below reads as below. The direction
-- matters because it decides which way an ambiguous book falls, and it falls
-- toward arming the breaker, which is where this system's conservatism already
-- lives (rho = 0.30, the CVaR99 floor, the RCR breaker at 1.0).
--
-- REJECTION 1 IS THE ASSERTION THAT LOOKS LIKE DEFENSIVE PROGRAMMING AND IS NOT.
-- A GENERATED column is computed BEFORE the row's CHECK constraints, so with a
-- plain `/ cvar99_cents` a zero denominator raises a bare `division by zero` and
-- reserve_coverage_snapshots_cvar99_is_positive NEVER FIRES AT ALL. 0049 writes
-- `NULLIF(cvar99_cents, 0)` for that reason and this is what watches it: the
-- assertion is that the error names the CONSTRAINT rather than the arithmetic.
--
-- Rejections are checked by CONSTRAINT NAME out of GET STACKED DIAGNOSTICS where
-- the database raises them, and BY MESSAGE where 0049 raises them. Never by
-- exception class: four of the rejections below raise check_violation and a
-- handler catching the class cannot tell any of them apart.
--
-- THE COUNTERFACTUAL, AS OBSERVED. Executed against 0001-0048 the file dies
-- before SUCCESS 1's INSERT, at its DECLARE, with `type
-- "reserve_coverage_snapshots" does not exist`: the probe binds the table's own
-- composite type, so the absence is caught at PL/pgSQL compile time rather than
-- at the write. Exit 3. Recorded in DELTA_MANIFEST section 26.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: three attestations of the payout wallet, on the rail's own clock
-- ---------------------------------------------------------------------------
-- treasury_balances is keyed (account_code, as_of) and carries the source. Two
-- provider_api rows and one manual_attestation, because P-M6-07 renders
-- attestation staleness only for the second kind and a probe with one source
-- proves nothing about the branch.
DO $$
DECLARE
  v_identity uuid;
  v_user     uuid;
BEGIN
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_identity;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (v_identity, 'oi01@example.test', 'oi01@example.test')
    RETURNING id INTO v_user;

  INSERT INTO treasury_balances (account_code, as_of, balance_cents, source)
    VALUES ('payout_wallet', '2026-06-01 12:00Z', 15000000, 'provider_api'),
           ('payout_wallet', '2026-06-02 12:00Z',  8000000, 'provider_api');

  -- An attestation with no human attached is not an attestation
  -- (treasury_balances_attestation_has_author, 0009).
  INSERT INTO treasury_balances (account_code, as_of, balance_cents, source, recorded_by)
    VALUES ('payout_wallet', '2026-06-03 12:00Z', 10000000, 'manual_attestation', v_user);
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: a covered book. THE ROW OI-01 EXISTS TO MAKE WRITABLE
-- ---------------------------------------------------------------------------
-- $150,000.00 of reserve against a CVaR99 floor of $100,000.00 is 1.5x, which is
-- 15000 basis points. Above 1.0, so the circuit breaker is not armed and sales
-- continue. Before 0049 there was nowhere in the schema to record any of this,
-- and five documents cited a control whose input did not exist.
DO $$
DECLARE v_row reserve_coverage_snapshots;
BEGIN
  INSERT INTO reserve_coverage_snapshots
    (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
  VALUES ('2026-06-01 23:00Z', 15000000, 'payout_wallet', '2026-06-01 12:00Z', 10000000)
  RETURNING * INTO v_row;

  IF v_row.rcr_bp <> 15000 THEN
    RAISE EXCEPTION 'SUCCESS 1 FAILED: rcr_bp is % and 1.5x coverage is 15000 bp', v_row.rcr_bp;
  END IF;
  RAISE NOTICE 'SUCCESS 1: a covered book writes, and rcr_bp is % bp', v_row.rcr_bp;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: an UNCOVERED book, which is the case the table exists for
-- ---------------------------------------------------------------------------
-- $80,000.00 against a $100,000.00 floor is 0.8x, 8000 bp, below 1.0. GLOSSARY:
-- "Below 1.0, the circuit breaker pauses new sales. It never pauses payouts."
-- A table that could only record a healthy ratio would be a dashboard rather
-- than a control.
DO $$
DECLARE v_row reserve_coverage_snapshots;
BEGIN
  INSERT INTO reserve_coverage_snapshots
    (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
  VALUES ('2026-06-02 23:00Z', 8000000, 'payout_wallet', '2026-06-02 12:00Z', 10000000)
  RETURNING * INTO v_row;

  IF v_row.rcr_bp <> 8000 OR v_row.rcr_bp >= 10000 THEN
    RAISE EXCEPTION 'SUCCESS 2 FAILED: rcr_bp is % and 0.8x coverage must read below 10000', v_row.rcr_bp;
  END IF;
  RAISE NOTICE 'SUCCESS 2: an uncovered book writes, rcr_bp % bp, breaker armed', v_row.rcr_bp;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: the manual attestation, and staleness is a JOIN rather than a column
-- ---------------------------------------------------------------------------
-- P-M6-07 shows "attestation staleness when the balance is a manual
-- attestation". 0049 stores the anchor as a REFERENCE instead of copying
-- `source` and the rail's `as_of` into two more columns that can disagree with
-- the row they came from (ADR-047: a reference beats a copied value). This is
-- the assertion that the panel can actually reach both.
DO $$
DECLARE
  v_source    text;
  v_staleness interval;
BEGIN
  INSERT INTO reserve_coverage_snapshots
    (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
  VALUES ('2026-06-03 23:00Z', 10000000, 'payout_wallet', '2026-06-03 12:00Z', 10000000);

  SELECT t.source, r.as_of - t.as_of
    INTO v_source, v_staleness
    FROM reserve_coverage_snapshots r
    JOIN treasury_balances t
      ON t.account_code = r.treasury_account_code AND t.as_of = r.treasury_as_of
   WHERE r.as_of = '2026-06-03 23:00Z';

  IF v_source <> 'manual_attestation' OR v_staleness <> interval '11 hours' THEN
    RAISE EXCEPTION
      'SUCCESS 3 FAILED: the panel cannot reach the attestation (source %, staleness %)',
      v_source, v_staleness;
  END IF;
  RAISE NOTICE 'SUCCESS 3: source is % and staleness is %, both one join away', v_source, v_staleness;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4: EXACTLY 1.0 READS AS EXACTLY 10000
-- ---------------------------------------------------------------------------
-- THE BOUNDARY THE BREAKER IS DEFINED AT. An expression that divided before it
-- multiplied would render this book as 0 bp and pause sales on a fully covered
-- balance sheet; one that lost a digit would render 1000. Asserted on the row
-- SUCCESS 3 already wrote, where reserve and CVaR99 are both $100,000.00.
DO $$
DECLARE v_bp integer;
BEGIN
  SELECT rcr_bp INTO v_bp FROM reserve_coverage_snapshots WHERE as_of = '2026-06-03 23:00Z';
  IF v_bp <> 10000 THEN
    RAISE EXCEPTION
      'SUCCESS 4 FAILED: coverage of exactly 1.0 rendered % bp rather than 10000, '
      'so the breaker fires on a fully covered book', v_bp;
  END IF;
  RAISE NOTICE 'SUCCESS 4: coverage of exactly 1.0 is exactly 10000 bp';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 5: truncation is toward zero, which is toward ARMING the breaker
-- ---------------------------------------------------------------------------
-- Integer division truncates, so the stored ratio is never higher than the true
-- one. One cent short of full coverage reads as 9999 (armed) and one cent over
-- reads as 10000 (not armed). That is the conservative direction and it is where
-- this system's conservatism is already ruled to live. If somebody replaces the
-- expression with a rounding one, this is the assertion that says so.
DO $$
DECLARE v_low integer; v_high integer;
BEGIN
  INSERT INTO treasury_balances (account_code, as_of, balance_cents, source)
    VALUES ('payout_wallet', '2026-06-04 12:00Z',  9999999, 'provider_api'),
           ('payout_wallet', '2026-06-05 12:00Z', 10000001, 'provider_api');

  INSERT INTO reserve_coverage_snapshots
    (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
  VALUES ('2026-06-04 23:00Z',  9999999, 'payout_wallet', '2026-06-04 12:00Z', 10000000),
         ('2026-06-05 23:00Z', 10000001, 'payout_wallet', '2026-06-05 12:00Z', 10000000);

  SELECT rcr_bp INTO v_low  FROM reserve_coverage_snapshots WHERE as_of = '2026-06-04 23:00Z';
  SELECT rcr_bp INTO v_high FROM reserve_coverage_snapshots WHERE as_of = '2026-06-05 23:00Z';
  IF v_low <> 9999 OR v_high <> 10000 THEN
    RAISE EXCEPTION
      'SUCCESS 5 FAILED: one cent under reads % bp and one cent over reads % bp; '
      'they must be 9999 and 10000, which is truncation toward zero', v_low, v_high;
  END IF;
  RAISE NOTICE 'SUCCESS 5: a cent under is % bp and a cent over is % bp', v_low, v_high;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 6: liability_snapshots carries funded_accounts. OI-01's fourth field
-- ---------------------------------------------------------------------------
-- The one orphan that is NOT reserve coverage. API_CONTRACT's GET
-- /admin/liability renders it beside as_of and open_liability_cents, which is
-- this table's grain, and P-M6-01 is a sum "across funded accounts" whose count
-- a reader needs in order to know whether the sum is one account or a thousand.
DO $$
DECLARE v_count integer;
BEGIN
  INSERT INTO liability_snapshots
    (as_of, open_liability_cents, bounded_near_term_cents,
     remaining_ladder_exposure_cents, wallet_balances_cents, funded_accounts)
  VALUES ('2026-06-01 23:00Z', 42000000, 9000000, 180000000, 3000000, 137);

  SELECT funded_accounts INTO v_count FROM liability_snapshots WHERE as_of = '2026-06-01 23:00Z';
  IF v_count <> 137 THEN
    RAISE EXCEPTION 'SUCCESS 6 FAILED: funded_accounts is % rather than 137', v_count;
  END IF;
  RAISE NOTICE 'SUCCESS 6: a liability snapshot carries its funded-account count';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: a zero denominator names the CONSTRAINT, not the arithmetic
-- ---------------------------------------------------------------------------
-- THE ASSERTION THAT PROVES NULLIF IS LOAD-BEARING. A generated column is
-- computed before the row's CHECK constraints, so without NULLIF this raises
-- `division by zero` (SQLSTATE 22012) and
-- reserve_coverage_snapshots_cvar99_is_positive never runs. A zero CVaR99 is not
-- infinite coverage, it is a floor nobody computed, and the operator has to be
-- told which of those two things happened.
DO $$
DECLARE fired boolean := false; cname text := ''; state text := '';
BEGIN
  BEGIN
    INSERT INTO reserve_coverage_snapshots
      (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
    VALUES ('2026-06-06 23:00Z', 15000000, 'payout_wallet', '2026-06-01 12:00Z', 0);
  EXCEPTION WHEN OTHERS THEN
    fired := true;
    GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME, state = RETURNED_SQLSTATE;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 1 FAILED: a zero CVaR99 floor was accepted';
  END IF;
  IF state = '22012' THEN
    RAISE EXCEPTION
      'REJECTION 1 FAILED: the row raised division_by_zero, so the NULLIF in '
      'rcr_bp has been removed and the named constraint is unreachable';
  END IF;
  IF cname <> 'reserve_coverage_snapshots_cvar99_is_positive' THEN
    RAISE EXCEPTION 'REJECTION 1 fired on the wrong constraint: % (sqlstate %)', cname, state;
  END IF;
  RAISE NOTICE 'REJECTION 1: a zero CVaR99 is refused by %, not by the arithmetic', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: rcr_bp cannot be written by hand
-- ---------------------------------------------------------------------------
-- THE WHOLE ANSWER TO THE RECOMMENDATION'S THIRD OBJECTION. If a writer can set
-- the ratio, the ratio can disagree with the two numbers stored beside it in the
-- same row, which is the drift OI-01's recommendation names by hand.
DO $$
DECLARE fired boolean := false; msg text := '';
BEGIN
  BEGIN
    INSERT INTO reserve_coverage_snapshots
      (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents, rcr_bp)
    VALUES ('2026-06-06 23:00Z', 15000000, 'payout_wallet', '2026-06-01 12:00Z', 10000000, 99999);
  EXCEPTION WHEN generated_always THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 2 FAILED: rcr_bp was written by hand, so it can disagree with its inputs';
  END IF;
  RAISE NOTICE 'REJECTION 2: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: RESERVE-C1. The copy is the balance it names
-- ---------------------------------------------------------------------------
-- The foreign key proves the anchor EXISTS and nothing proves the numerator is
-- what it says. A coverage figure whose reserve does not match the attestation
-- it cites is worse than one with no citation, because it reads as evidence.
DO $$
DECLARE fired boolean := false; msg text := '';
BEGIN
  BEGIN
    INSERT INTO reserve_coverage_snapshots
      (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
    VALUES ('2026-06-06 23:00Z', 99000000, 'payout_wallet', '2026-06-01 12:00Z', 10000000);
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 3 FAILED: a reserve that contradicts its own anchor was accepted';
  END IF;
  IF position('RESERVE-C1' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 3 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 3: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: an anchor that does not exist
-- ---------------------------------------------------------------------------
-- INV-M5-11: the reserve is reported against a LIVE rail balance rather than a
-- computed one. A row naming an attestation nobody recorded is a computed one
-- with a citation stapled to it.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reserve_coverage_snapshots
      (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
    VALUES ('2026-06-06 23:00Z', 15000000, 'payout_wallet', '2020-01-01 00:00Z', 10000000);
  EXCEPTION WHEN foreign_key_violation THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 4 FAILED: a coverage row named an attestation that does not exist';
  END IF;
  IF cname <> 'reserve_coverage_snapshots_anchor_fk' THEN
    RAISE EXCEPTION 'REJECTION 4 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 4: an unrecorded anchor is refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: two coverage figures for one instant
-- ---------------------------------------------------------------------------
-- Two rows for one as_of are two answers to "what was coverage then", and the
-- panel would have to pick one. liability_snapshots_as_of_uq's precedent.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reserve_coverage_snapshots
      (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
    VALUES ('2026-06-01 23:00Z', 15000000, 'payout_wallet', '2026-06-01 12:00Z', 20000000);
  EXCEPTION WHEN unique_violation THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: one instant carried two coverage figures';
  END IF;
  IF cname <> 'reserve_coverage_snapshots_as_of_uq' THEN
    RAISE EXCEPTION 'REJECTION 5 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 5: a second figure for one instant is refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6: VG-5. The table is append-only, and that is a GRANT
-- ---------------------------------------------------------------------------
-- 0026:174 grants merit_app full DML on every table a later migration creates,
-- so without 0049's REVOKE the word "append-only" in this table's comment would
-- be false the instant it existed. A coverage figure that can be rewritten means
-- the record of why sales were or were not paused on a given day can be edited
-- after the fact by the party the record is about.
DO $$
DECLARE fired boolean;
BEGIN
  SET LOCAL ROLE merit_app;

  fired := false;
  BEGIN UPDATE reserve_coverage_snapshots SET cvar99_cents = 1 WHERE as_of = '2026-06-01 23:00Z';
  EXCEPTION WHEN insufficient_privilege THEN fired := true; END;
  IF NOT fired THEN RAISE EXCEPTION 'REJECTION 6 FAILED: merit_app updated a coverage snapshot'; END IF;

  fired := false;
  BEGIN DELETE FROM reserve_coverage_snapshots WHERE as_of = '2026-06-01 23:00Z';
  EXCEPTION WHEN insufficient_privilege THEN fired := true; END;
  IF NOT fired THEN RAISE EXCEPTION 'REJECTION 6 FAILED: merit_app deleted a coverage snapshot'; END IF;

  -- And INSERT and SELECT must still work, because a revoke that took the whole
  -- table would satisfy both assertions above and leave the producer unable to
  -- write anything. 0034's lesson: a guard that refuses everything passes an
  -- inventory of refusals.
  PERFORM count(*) FROM reserve_coverage_snapshots;
  INSERT INTO reserve_coverage_snapshots
    (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
  VALUES ('2026-06-07 23:00Z', 15000000, 'payout_wallet', '2026-06-01 12:00Z', 10000000);

  RESET ROLE;
  RAISE NOTICE 'REJECTION 6: merit_app may INSERT and SELECT, and may not UPDATE or DELETE';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 7: merit_analytics cannot read the firm's reserve position
-- ---------------------------------------------------------------------------
-- 0026's default privileges make a new table invisible to analytics until
-- somebody grants it, and the default should be that it is not. M13's trading
-- surface is accounts, marks, fills and round trips; the firm's reserve position
-- is not on it. This is the assertion that fails the day a later migration
-- grants it without saying why.
DO $$
DECLARE fired boolean := false;
BEGIN
  SET LOCAL ROLE merit_analytics;
  BEGIN
    PERFORM count(*) FROM reserve_coverage_snapshots;
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 7 FAILED: merit_analytics can read reserve_coverage_snapshots';
  END IF;
  RAISE NOTICE 'REJECTION 7: the reserve position is not on the analytics surface';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 8: a liability snapshot that counts no accounts
-- ---------------------------------------------------------------------------
-- funded_accounts is NOT NULL with NO DEFAULT on purpose. A DEFAULT 0 would make
-- every row written by a producer that forgot the column claim zero funded
-- accounts, which is a number the dashboard would render and nobody counted.
DO $$
DECLARE fired boolean := false; msg text := '';
BEGIN
  BEGIN
    INSERT INTO liability_snapshots
      (as_of, open_liability_cents, bounded_near_term_cents,
       remaining_ladder_exposure_cents, wallet_balances_cents)
    VALUES ('2026-06-02 23:00Z', 42000000, 9000000, 180000000, 3000000);
  EXCEPTION WHEN not_null_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 8 FAILED: a liability snapshot was written with no funded-account '
      'count, so the column has acquired a default and zero is now renderable';
  END IF;
  RAISE NOTICE 'REJECTION 8: %', msg;
END $$;

\echo 'probe_reserve_coverage: 6 successes and 8 rejections hold against the applied schema.'

ROLLBACK;
