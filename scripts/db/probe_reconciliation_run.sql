-- =============================================================================
-- Probe: the reconciliation run record (0064). Session 374's blocker B4
-- =============================================================================
-- FIVE SUCCESS CASES BEFORE THE FIRST REJECTION, on DELTA_MANIFEST section 13's
-- discipline: this table exists to make a fact WRITABLE that had nowhere to
-- live, so a guard that refused every row would satisfy every rejection below
-- and close B4 with a table nobody can use.
--
-- SUCCESS 4 IS THE ONE TO READ AND IT IS WHY THE TABLE EXISTS. Two sweeps over
-- one trading day: the first completes, the second starts and never finishes,
-- which is what a process killed at the account boundary leaves behind
-- (OVERVIEW section 5.2). "The latest run STARTED" and "the latest run that
-- actually covered the book" then return DIFFERENT rows, and before this
-- migration there was no query that could tell them apart -- which is exactly
-- ADR-199 section 5's refusal of `max(reconciliations.created_at)`, one field
-- to the left.
--
-- SUCCESS 3 IS THE OTHER HALF OF THE SAME POINT. `mismatches_found` and
-- `mismatches_open` are asserted to DISAGREE after a human resolves one, on the
-- same day and the same rows. If they were ever equal by construction, one of
-- them would be a copy of the other and this table would be carrying a number
-- `reconciliations` already answers.
--
-- SUCCESS 2 IS AN ACCEPTANCE CASE FOR A REJECTION, and it is the half a probe of
-- refusals never sees: the run record is MUTABLE ON PURPOSE, so the UPDATE that
-- closes a sweep must be permitted to `merit_app` and is asserted to work, in
-- the same block that asserts DELETE is not what this table needs revoked.
--
-- Rejections are checked by CONSTRAINT NAME out of GET STACKED DIAGNOSTICS, and
-- never by exception class: six of the rejections below raise check_violation
-- and a handler catching the class cannot tell any of them apart.
--
-- THE COUNTERFACTUAL, AS OBSERVED. Executed against 0001-0063 this file dies
-- before SUCCESS 1's INSERT, at its DECLARE, with `type "reconciliation_runs"
-- does not exist`: the probe binds the table's own composite type, so the
-- absence is caught at PL/pgSQL compile time rather than at the write. Exit 3.
-- Recorded in DELTA_MANIFEST section 29.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE probe_ids (kind text PRIMARY KEY, id uuid) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Fixtures: three funded accounts, so a sweep has a population to disagree with
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_identity uuid;
  v_user     uuid;
  v_plan     uuid;
  v_pv       uuid;
  v_purchase uuid;
  v_account  uuid;
  i          integer;
BEGIN
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_identity;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (v_identity, 'b4@example.test', 'b4@example.test')
    RETURNING id INTO v_user;

  INSERT INTO plans (code, name) VALUES ('core_eod', 'Core EOD probe')
    RETURNING id INTO v_plan;
  INSERT INTO plan_versions (plan_id, version, status, rules, public_slug, created_by)
    VALUES (v_plan, 1, 'draft', '{"schema_version":1}'::jsonb, 'b4-probe', v_user)
    RETURNING id INTO v_pv;
  -- 0045 SD-M21-02: a published version records what it was decided on, or says
  -- in writing why no run was consulted. A probe database has no runs.
  UPDATE plan_versions SET status = 'published', published_at = now(),
         simulation_waiver_reason = 'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)'
   WHERE id = v_pv;

  FOR i IN 1..3 LOOP
    INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                           list_price_cents, amount_paid_cents, psp, psp_reference,
                           status, paid_at)
      VALUES (v_identity, v_user, v_pv, 5000000, 'new', 15000, 15000, 'psp_a',
              'b4-ref-' || i, 'paid', now())
      RETURNING id INTO v_purchase;

    INSERT INTO accounts (identity_id, user_id, purchase_id, plan_version_id,
                          size_cents, status, phase, opened_on, funded_on)
      VALUES (v_identity, v_user, v_purchase, v_pv, 5000000, 'active', 'funded',
              current_date, current_date)
      RETURNING id INTO v_account;

    INSERT INTO probe_ids VALUES ('account_' || i, v_account);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: A SWEEP STARTS. The row session 374's B4 had nowhere to write
-- ---------------------------------------------------------------------------
-- Before 0064 nothing in this schema was written by a reconciliation run, so
-- `integrations.recon.last_run_at` had no source rather than a missing join.
-- This is that source: the run declares its population up front and has compared
-- nobody yet, which is a legitimate and complete row rather than a placeholder.
DO $$
DECLARE v_row reconciliation_runs;
BEGIN
  INSERT INTO reconciliation_runs
    (id, batch_run_id, trading_day, started_at, accounts_total, status)
  VALUES ('00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-0000000000b1',
          '2026-08-26', '2026-08-27 06:00Z', 3, 'running')
  RETURNING * INTO v_row;

  IF v_row.finished_at IS NOT NULL OR v_row.accounts_done <> 0
     OR v_row.mismatches_found <> 0 THEN
    RAISE EXCEPTION
      'SUCCESS 1 FAILED: a run that has just started reads finished_at %, done %, found %',
      v_row.finished_at, v_row.accounts_done, v_row.mismatches_found;
  END IF;
  RAISE NOTICE 'SUCCESS 1: a sweep over % accounts is recorded at %',
    v_row.accounts_total, v_row.started_at;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: THE SWEEP CLOSES, AND merit_app IS THE ROLE THAT CLOSES IT
-- ---------------------------------------------------------------------------
-- The record is mutable on purpose: written at the start, updated at the end.
-- 0026's closing ALTER DEFAULT PRIVILEGES grants merit_app all four verbs on a
-- table a later migration creates, and 0064 revokes nothing, so this UPDATE must
-- work as the APPLICATION role and not merely as the owner. A revoke copied from
-- 0049 would have left the producer unable to finish a run it had started, and
-- that failure would look exactly like a crash.
DO $$
DECLARE v_row reconciliation_runs;
BEGIN
  SET LOCAL ROLE merit_app;

  PERFORM count(*) FROM reconciliation_runs;

  UPDATE reconciliation_runs
     SET accounts_done = 3, mismatches_found = 0, status = 'completed',
         finished_at = '2026-08-27 06:04Z', updated_at = now()
   WHERE id = '00000000-0000-4000-8000-000000000001'
  RETURNING * INTO v_row;

  RESET ROLE;

  IF v_row.status <> 'completed' OR v_row.accounts_done <> v_row.accounts_total THEN
    RAISE EXCEPTION 'SUCCESS 2 FAILED: the run did not close (% of %, status %)',
      v_row.accounts_done, v_row.accounts_total, v_row.status;
  END IF;
  RAISE NOTICE 'SUCCESS 2: merit_app closed a clean sweep, % of % accounts',
    v_row.accounts_done, v_row.accounts_total;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: A RUN THAT FINDS SOMETHING SUCCEEDED, and the two counts DISAGREE
-- ---------------------------------------------------------------------------
-- A sweep over the next day finds two mismatches. It COMPLETES: finding a
-- discrepancy is the check working, not the check failing, and a schema that put
-- those two in one column would make an operator unable to tell them apart.
--
-- Then a human resolves one, per 0014's `resolved` state and RB-02. THE RUN'S
-- COUNT DOES NOT MOVE AND THE OPEN COUNT DOES. That is the assertion that proves
-- `mismatches_found` is not a copy of anything `reconciliations` already answers:
-- one is what this run saw, the other is the state now.
DO $$
DECLARE
  v_a1 uuid; v_a2 uuid; v_a3 uuid;
  v_found integer; v_open integer;
BEGIN
  SELECT id INTO v_a1 FROM probe_ids WHERE kind = 'account_1';
  SELECT id INTO v_a2 FROM probe_ids WHERE kind = 'account_2';
  SELECT id INTO v_a3 FROM probe_ids WHERE kind = 'account_3';

  -- Two disagreements and one clean account, on 0014's own constraints: a match
  -- has a zero delta, a mismatch does not and must name our side.
  INSERT INTO reconciliations
    (account_id, trading_day, our_balance_cents, platform_balance_cents, status, our_source)
  VALUES (v_a1, '2026-08-27', 5000000, 4999500, 'mismatch', 'rule_state'),
         (v_a2, '2026-08-27', 5000000, 5001200, 'mismatch', 'ledger');
  INSERT INTO reconciliations
    (account_id, trading_day, our_balance_cents, platform_balance_cents, status)
  VALUES (v_a3, '2026-08-27', 5000000, 5000000, 'match');

  INSERT INTO reconciliation_runs
    (id, batch_run_id, trading_day, started_at, finished_at,
     accounts_total, accounts_done, mismatches_found, status)
  VALUES ('00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-0000000000b2',
          '2026-08-27', '2026-08-28 06:00Z', '2026-08-28 06:05Z',
          3, 3, 2, 'completed');

  -- The operator's next move, through the index 0014 already built for it:
  -- reconciliations_open_mismatch_idx (trading_day) WHERE status = 'mismatch'.
  SELECT count(*) INTO v_open
    FROM reconciliations
   WHERE trading_day = '2026-08-27' AND status = 'mismatch';
  SELECT mismatches_found INTO v_found
    FROM reconciliation_runs WHERE id = '00000000-0000-4000-8000-000000000002';

  IF v_found <> 2 OR v_open <> 2 THEN
    RAISE EXCEPTION 'SUCCESS 3 FAILED: found % and open % before any resolution', v_found, v_open;
  END IF;

  -- A human clears one. 0014 requires both an author and an explanation.
  UPDATE reconciliations
     SET status = 'resolved', resolved_by = 'ops@merit.test',
         resolution_note = 'vendor correction applied, RB-02 section B'
   WHERE account_id = v_a1 AND trading_day = '2026-08-27';

  SELECT count(*) INTO v_open
    FROM reconciliations
   WHERE trading_day = '2026-08-27' AND status = 'mismatch';
  SELECT mismatches_found INTO v_found
    FROM reconciliation_runs WHERE id = '00000000-0000-4000-8000-000000000002';

  IF v_found <> 2 OR v_open <> 1 THEN
    RAISE EXCEPTION
      'SUCCESS 3 FAILED: after a resolution the run found % and % are open; if '
      'these two numbers cannot come apart, one of them is a copy of the other',
      v_found, v_open;
  END IF;
  RAISE NOTICE 'SUCCESS 3: the run found % and % is still open; the counts are different facts',
    v_found, v_open;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4: A SECOND SWEEP OVER THE SAME DAY, AND IT NEVER FINISHES
-- ---------------------------------------------------------------------------
-- TWO THINGS AT ONCE, and both are the reason this table is not shaped like a
-- snapshot.
--
-- FIRST, a trading day carries MORE THAN ONE RUN. RB-02 section A sends a
-- quarantined day to redelivery, and a redelivered file is applied and
-- reconciled again. A unique index on trading_day would have read as tidiness
-- and forbidden the remedy the runbook mandates.
--
-- SECOND, this run is killed at the account boundary: 2 of 3 compared, nothing
-- ever updates the row, and it sits at 'running' with an old started_at. The two
-- queries below then return DIFFERENT rows, which is the whole of B4: the panel
-- can say when reconciliation last RAN and, separately, when one last COVERED
-- THE BOOK, and no fold over per-account clocks can do that.
DO $$
DECLARE
  v_latest_started   uuid;
  v_latest_completed uuid;
  v_runs_that_day    integer;
BEGIN
  INSERT INTO reconciliation_runs
    (id, batch_run_id, trading_day, started_at, accounts_total, accounts_done, status)
  VALUES ('00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-0000000000b3',
          '2026-08-27', '2026-08-28 09:30Z', 3, 2, 'running');

  SELECT count(*) INTO v_runs_that_day
    FROM reconciliation_runs WHERE trading_day = '2026-08-27';
  IF v_runs_that_day <> 2 THEN
    RAISE EXCEPTION
      'SUCCESS 4 FAILED: one trading day carried % runs; a redelivery must be '
      'able to reconcile a day a second time (RB-02 section A)', v_runs_that_day;
  END IF;

  SELECT id INTO v_latest_started
    FROM reconciliation_runs ORDER BY started_at DESC LIMIT 1;
  SELECT id INTO v_latest_completed
    FROM reconciliation_runs WHERE status = 'completed'
    ORDER BY finished_at DESC LIMIT 1;

  IF v_latest_started = v_latest_completed THEN
    RAISE EXCEPTION
      'SUCCESS 4 FAILED: the latest run and the latest COMPLETED run are the '
      'same row, so a crashed sweep is invisible and the panel would report a '
      'success for a run that never covered the book (ADR-199 section 5)';
  END IF;
  IF v_latest_started <> '00000000-0000-4000-8000-000000000003'
     OR v_latest_completed <> '00000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'SUCCESS 4 FAILED: latest started % and latest completed %',
      v_latest_started, v_latest_completed;
  END IF;
  RAISE NOTICE 'SUCCESS 4: the newest run is the crashed one and the newest COMPLETED run is not';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 5: THE MORNING READ REACHES EVERYTHING SOMEBODY MUST LOOK AT
-- ---------------------------------------------------------------------------
-- reconciliation_runs_unhealthy_idx's predicate is detector_runs' widened by one
-- disjunct, because on this table a run that COMPLETED and found something is
-- also a run an operator opens RB-02 for. Asserted against the predicate rather
-- than against the index, since a partial index that is never chosen by the
-- planner still has to hold the right rows.
DO $$
DECLARE v_unhealthy integer;
BEGIN
  SELECT count(*) INTO v_unhealthy
    FROM reconciliation_runs
   WHERE status <> 'completed' OR mismatches_found > 0;

  IF v_unhealthy <> 2 THEN
    RAISE EXCEPTION
      'SUCCESS 5 FAILED: the morning read reaches % rows and must reach 2, the '
      'crashed sweep and the completed one that found mismatches', v_unhealthy;
  END IF;
  RAISE NOTICE 'SUCCESS 5: the morning read reaches both the crashed run and the run that found something';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: A RUN THAT STOPPED SHORT MAY NOT CLAIM IT COMPLETED
-- ---------------------------------------------------------------------------
-- THE CONTROL, AND THE REASON THIS TABLE IS NOT A TIMESTAMP COLUMN SOMEWHERE.
-- ADR-199 section 5 refuses a fold over per-account clocks for the batch because
-- "a sweep resumable at the account boundary reports a SUCCESS for a run that
-- crashed". This is that refusal enforced by the database: 2 of 3 accounts and
-- the word 'completed' cannot appear in one row.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, finished_at,
       accounts_total, accounts_done, status)
    VALUES ('00000000-0000-4000-8000-0000000000c1', '2026-08-28',
            '2026-08-29 06:00Z', '2026-08-29 06:02Z', 3, 2, 'completed');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 1 FAILED: a sweep that covered 2 of 3 accounts claimed it '
      'completed, so last_run_at can again read a success off a crashed run';
  END IF;
  IF cname <> 'reconciliation_runs_completed_is_whole' THEN
    RAISE EXCEPTION 'REJECTION 1 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 1: a partial sweep cannot claim completion, refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: 'completed' with no finishing instant
-- ---------------------------------------------------------------------------
-- The equivalence is written as one constraint rather than two implications, so
-- there is no third state where a run is finished and has no clock.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, accounts_total, accounts_done, status)
    VALUES ('00000000-0000-4000-8000-0000000000c2', '2026-08-28',
            '2026-08-29 06:00Z', 3, 3, 'completed');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 2 FAILED: a completed run carries no finished_at';
  END IF;
  IF cname <> 'reconciliation_runs_finished_when_not_running' THEN
    RAISE EXCEPTION 'REJECTION 2 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 2: a completed run with no finishing instant is refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: 'running' with a finishing instant, which is the other direction
-- ---------------------------------------------------------------------------
-- Asserted separately because a constraint written as a single implication would
-- pass REJECTION 2 and let this row through, and a row that is running and
-- finished at the same time is the state an operator can least afford.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, finished_at, accounts_total, status)
    VALUES ('00000000-0000-4000-8000-0000000000c3', '2026-08-28',
            '2026-08-29 06:00Z', '2026-08-29 06:02Z', 3, 'running');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 3 FAILED: a run is both running and finished';
  END IF;
  IF cname <> 'reconciliation_runs_finished_when_not_running' THEN
    RAISE EXCEPTION 'REJECTION 3 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 3: a running run with a finishing instant is refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: more accounts compared than the sweep set out to compare
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, accounts_total, accounts_done, status)
    VALUES ('00000000-0000-4000-8000-0000000000c4', '2026-08-28',
            '2026-08-29 06:00Z', 3, 4, 'running');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 4 FAILED: a sweep compared more accounts than it had';
  END IF;
  IF cname <> 'reconciliation_runs_done_within_total' THEN
    RAISE EXCEPTION 'REJECTION 4 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 4: %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: more mismatches than accounts compared
-- ---------------------------------------------------------------------------
-- A mismatch is found ON an account that was compared, and
-- reconciliations_account_day_uq allows at most one row per account per day, so
-- a count above accounts_done is a number nobody could have observed.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, accounts_total, accounts_done,
       mismatches_found, status)
    VALUES ('00000000-0000-4000-8000-0000000000c5', '2026-08-28',
            '2026-08-29 06:00Z', 3, 2, 3, 'running');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: more mismatches than accounts compared';
  END IF;
  IF cname <> 'reconciliation_runs_mismatches_within_done' THEN
    RAISE EXCEPTION 'REJECTION 5 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 5: %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6: a run that finished before it started
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, finished_at,
       accounts_total, accounts_done, status)
    VALUES ('00000000-0000-4000-8000-0000000000c6', '2026-08-28',
            '2026-08-29 06:00Z', '2026-08-29 05:00Z', 3, 3, 'completed');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 6 FAILED: a run finished an hour before it started';
  END IF;
  IF cname <> 'reconciliation_runs_finished_after_started' THEN
    RAISE EXCEPTION 'REJECTION 6 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 6: %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 7: a status outside the three
-- ---------------------------------------------------------------------------
-- 'degraded' is the near miss on purpose: it is detector_runs' third state, it
-- is the word a reader coming from 0008 would reach for, and 0064 does not carry
-- it because the synthetic battery that earns it there has no analogue here.
DO $$
DECLARE fired boolean := false; cname text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs
      (batch_run_id, trading_day, started_at, finished_at,
       accounts_total, accounts_done, status)
    VALUES ('00000000-0000-4000-8000-0000000000c7', '2026-08-28',
            '2026-08-29 06:00Z', '2026-08-29 06:02Z', 3, 3, 'degraded');
  EXCEPTION WHEN OTHERS THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 7 FAILED: a status outside the three was accepted';
  END IF;
  IF cname <> 'reconciliation_runs_status_is_known' THEN
    RAISE EXCEPTION 'REJECTION 7 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 7: %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 8: a sweep with no declared population
-- ---------------------------------------------------------------------------
-- accounts_total is NOT NULL with NO DEFAULT, on 0049's funded_accounts
-- reasoning. A DEFAULT 0 would let a producer that forgot the column write a run
-- claiming to have set out to compare nobody, and REJECTION 1's control would
-- then be satisfied by every such row: 0 of 0 is a whole sweep.
DO $$
DECLARE fired boolean := false; msg text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs (batch_run_id, trading_day, started_at, status)
    VALUES ('00000000-0000-4000-8000-0000000000c8', '2026-08-28',
            '2026-08-29 06:00Z', 'running');
  EXCEPTION WHEN not_null_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 8 FAILED: a run was written with no population, so accounts_total '
      'has acquired a default and a vacuous completion is now writable';
  END IF;
  RAISE NOTICE 'REJECTION 8: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 9: a run with no batch behind it
-- ---------------------------------------------------------------------------
-- OVERVIEW section 5.2 puts reconciliation INSIDE the nightly batch, so a run
-- naming no batch run is a row describing a process this corpus does not have.
-- The column carries no foreign key -- no batch run is a row anywhere -- so NOT
-- NULL is the whole of what the database can hold here, and this is the
-- assertion that says it still does.
DO $$
DECLARE fired boolean := false; msg text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliation_runs (trading_day, started_at, accounts_total, status)
    VALUES ('2026-08-28', '2026-08-29 06:00Z', 3, 'running');
  EXCEPTION WHEN not_null_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 9 FAILED: a reconciliation run names no batch run';
  END IF;
  RAISE NOTICE 'REJECTION 9: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 10: merit_analytics cannot read the firm's reconciliation health
-- ---------------------------------------------------------------------------
-- 0026's default privileges make a new table invisible to analytics until
-- somebody grants it, and the default should be that it is not: M13's trading
-- surface is accounts, marks, fills and round trips, and how often our balances
-- disagree with the platform's is not on it. This is the assertion that fails the
-- day a later migration grants it without saying why.
DO $$
DECLARE fired boolean := false;
BEGIN
  SET LOCAL ROLE merit_analytics;
  BEGIN
    PERFORM count(*) FROM reconciliation_runs;
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 10 FAILED: merit_analytics can read reconciliation_runs';
  END IF;
  RAISE NOTICE 'REJECTION 10: reconciliation health is not on the analytics surface';
END $$;

\echo 'probe_reconciliation_run: 5 successes and 10 rejections hold against the applied schema.'

ROLLBACK;
