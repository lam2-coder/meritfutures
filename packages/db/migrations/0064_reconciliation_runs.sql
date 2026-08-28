-- =============================================================================
-- 0064_reconciliation_runs
-- =============================================================================
-- E2 READ: MONEY PATH. A reconciliation compares our EOD balance against the
-- platform's, and a `mismatch` sets `accounts.recon_blocked = true` and blocks
-- eligibility until a human clears it (0014_marks.sql, INV-23, SD-06). The
-- record below is what says whether that comparison HAPPENED, over what, and
-- what it found. It is an OPERATIONAL fact and not a money movement: no entry,
-- no balance, no posting, no ledger account and no `_cents` column anywhere in
-- this file.
--
-- SESSION 374's BLOCKER `B4`, re-derived from the catalogue rather than
-- inherited. `integrations.recon.last_run_at` is projected by
-- `LiabilityResponse` (docs/architecture/API_CONTRACT.md:908) and NOTHING IN
-- THIS SCHEMA IS WRITTEN BY A RECONCILIATION RUN. Queried against the installed
-- 59-migration schema rather than grepped:
--
--   * `select table_name from information_schema.columns where table_schema =
--     'public' and column_name in ('started_at','finished_at') group by
--     table_name having count(distinct column_name) = 2`
--     -> ONE ROW: `detector_runs`. The schema holds exactly one run record and
--        it belongs to the risk detectors.
--   * `select table_name || '.' || column_name from information_schema.columns
--     where table_schema = 'public' and (column_name like '%run_at%' or
--     column_name like '%run_id%' or column_name like 'last_%')`
--     -> twelve rows, none of them a reconciliation clock. `last_run_at` does
--        not exist anywhere among the schema's 705 distinct column names.
--   * `select tablename from pg_tables where schemaname = 'public' and
--     (tablename like '%recon%' or '%run%' or '%load%' or '%job%' or '%sweep%')`
--     -> `detector_runs`, `economic_calendar_loads`, `reconciliations`,
--        `simulation_runs`, `trading_calendar_loads`. Ruled one at a time in
--        docs/architecture/data-model/reconciliation_runs.md; not one of them
--        can carry this record under its own rules.
--
-- `reconciliations.account_id` is `NOT NULL` and `reconciliations_account_day_uq`
-- is `(account_id, trading_day)`, so EVERY row of that table is about one
-- account on one day. The only fold available across them,
-- `max(reconciliations.created_at)`, is the fold ADR-199 section 5 refuses one
-- field to the left for the batch, because OVERVIEW section 5.2 leaves the run
-- "resumable at the account boundary" and a fold over per-account clocks
-- REPORTS A SUCCESS FOR A RUN THAT CRASHED. This file is the row that fold was
-- missing, and `reconciliation_runs_completed_is_whole` below is the same
-- refusal written as a constraint.
--
-- -----------------------------------------------------------------------------
-- FIVE THINGS NEED THE FOUNDER'S LINE-BY-LINE READ
-- -----------------------------------------------------------------------------
--
--   1. `reconciliation_runs_completed_is_whole` IS THE CONTROL AND EVERYTHING
--      ELSE IN THIS FILE IS BOOKKEEPING. `status = 'completed'` requires
--      `accounts_done = accounts_total`. A sweep that stopped at account 2,341
--      of 5,000 -- which OVERVIEW section 5.2 makes an ORDINARY occurrence
--      rather than an exotic one -- cannot claim completion, so the panel's
--      clock cannot read a success off a run that crashed. This is
--      `detector_runs_synthetics_match_status`'s shape on a different pair: the
--      state and the counters must agree in the DATABASE.
--
--   2. THERE IS NO UNIQUE INDEX ON `trading_day` AND ITS ABSENCE IS RULED
--      RATHER THAN FORGOTTEN. One run per day is the normal case and it is not
--      the only case: RB-02 section A sends a quarantined day to REDELIVERY,
--      and a redelivered file is applied and reconciled again. A unique index
--      here would read as tidiness and would forbid the remedy the runbook
--      mandates. `detector_runs` has the same shape for the same reason -- a
--      plain `(detector, trading_day desc)` index and no unique key.
--
--   3. `batch_run_id` IS `NOT NULL` AND CARRIES NO FOREIGN KEY, BECAUSE THE
--      TABLE IT WOULD POINT AT DOES NOT EXIST. OVERVIEW section 5.2 puts
--      reconciliation INSIDE the nightly batch ("W->>W: reconciliation: our EOD
--      balance vs Rithmic stated"), so a reconciliation run with no batch run
--      is a row describing a process this corpus does not have. The value is
--      the `run_id` that EVENTS section 5.3 already declares in the payloads of
--      `batch.started`, `batch.completed` and `batch.failed`, and it is the
--      whole reason this file adds no `error` column: a failure's stage, cursor
--      and message are `batch.failed`'s payload
--      (`{ run_id, stage, account_cursor, error }`), and copying them here
--      would be a second answer that can disagree with the first (ADR-047).
--      THE DAY A BATCH RUN BECOMES A ROW, THIS COLUMN GAINS A FOREIGN KEY BY A
--      SUPERSEDING MIGRATION and nothing else about the table moves.
--
--   4. THE TABLE IS MUTABLE AND THAT IS A CHOICE WITH A COST. The row is
--      written when the sweep starts and updated when it stops, which is what
--      makes "started and never finished" distinguishable from "never started"
--      -- the distinction the panel needs and the one a completion-only row
--      cannot make. So it is NOT append-only, it is NOT in the block
--      docs/architecture/data-model/README.md section 1 marks, and `0026`'s
--      closing `ALTER DEFAULT PRIVILEGES` correctly leaves `merit_app` holding
--      `UPDATE`. It carries `updated_at` for exactly that reason (section 1:
--      "Mutable tables carry `updated_at`"). WHAT THE SAME SENTENCE ALSO ASKS
--      FOR IS NOT HERE AND CANNOT BE: mutable tables "emit an event on every
--      meaningful transition", and EVENTS section 5.3 carries
--      `recon.mismatch_detected` and `recon.resolved` and NO `recon.completed`.
--      That half is an amendment to a frozen document and is owed, stated here
--      rather than quietly skipped.
--
--   5. `mismatches_found` IS THE RUN'S CLAIM AND THE DATABASE BOUNDS IT WITHOUT
--      VERIFYING IT. `0 <= mismatches_found <= accounts_done` is enforced;
--      "this number equals the mismatch rows this run wrote" is not, and it
--      cannot be without a cross-table trigger. Session 365 wrote and executed
--      exactly that class of guard against this schema and it was refused on a
--      clean A/B over the probes (`0060`, returned unspent), so this file
--      proposes none. THE NUMBER IS NOT A COPY OF `mismatches_open` EITHER, and
--      the difference is the reason both exist: `mismatches_open` is a count of
--      the CURRENT state of `reconciliations`, which a human resolving a
--      mismatch changes, and `mismatches_found` is what this run saw at the
--      time, which nothing may change afterwards.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- -----------------------------------------------------------------------------
-- It adds NO column to `reconciliations`. The symmetric design is available and
-- is refused on the DDL: `risk_flags.detector_run_id` works because a flag is
-- raised once and never re-raised, and `reconciliations_account_day_uq` makes a
-- re-run UPDATE the existing row instead, so a `reconciliation_run_id` there
-- would name the LAST run that touched the row rather than the run that found
-- it. A column whose meaning changes under a redelivery is worse than no
-- column. The link runs the other way: `trading_day` plus
-- `reconciliations_open_mismatch_idx (trading_day) WHERE status = 'mismatch'`
-- resolves the finding set through an index `0014` already built for it, which
-- is what an operator opens RB-02 with.
--
-- It stores NO `duration_ms`, although `batch.completed`'s payload carries one:
-- `finished_at - started_at` is the same number and a stored copy can disagree
-- with the two instants beside it.
--
-- It stores NO `our_source` and NO `source_ingest_file_id`. Both are per
-- comparison and both are already on `reconciliations` under `SD-M2-06`, and a
-- day is a CHAIN of files rather than one (`0013`'s `replaces_ingest_file_id`),
-- so a single reference on the run would force one file onto a sweep that read
-- several.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- reconciliation_runs
-- -----------------------------------------------------------------------------
-- ONE ROW PER RECONCILIATION SWEEP, over the whole population, inside one
-- nightly batch run. There is no identity column and there is no correct one:
-- the sweep covers every account and the accounts it disagreed with are its
-- OUTPUT, recorded on `reconciliations`, rather than its owner. That is
-- `detector_runs`' sentence and this table is `firm` for the same reason.
CREATE TABLE reconciliation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The nightly batch run this sweep is a stage of. EVENTS section 5.3's
  -- `run_id`, which is how a reader reaches `batch.failed`'s stage, cursor and
  -- error without this table copying any of them. No FK: no batch run is a row
  -- anywhere in this schema, and inventing a table to point at would be a
  -- second run record rather than this one.
  batch_run_id      uuid NOT NULL,

  -- The day being reconciled, never the day the sweep ran. A redelivery
  -- reconciles an OLD day, which is the case the two clocks come apart on.
  trading_day       date NOT NULL,

  -- THE RUN'S OWN CLOCK, AND IT IS `NOT NULL` WHERE `detector_runs`' IS
  -- NULLABLE. The row is created BY the start of the sweep, so the instant is
  -- always known; `0008` left both nullable and this file does not inherit a
  -- nullability it has no use for. `finished_at` is null exactly while the run
  -- is still running, which the constraint below makes structural rather than
  -- conventional.
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz NULL,

  -- WHAT IT COVERED. The names are EVENTS section 5.3's own, transcribed from
  -- `batch.started` / `batch.completed`'s payload
  -- (`{ run_id, trading_day, accounts_total, accounts_done, duration_ms }`)
  -- rather than invented here, so the stage and the batch describe their
  -- coverage in one vocabulary.
  --
  -- `accounts_total` has NO DEFAULT on purpose. A default of zero would let a
  -- producer that forgot the column write a run that claims to have set out to
  -- compare nothing, and a sweep over zero accounts is indistinguishable from a
  -- sweep that never looked (0049's `funded_accounts` reasoning, one table
  -- over). `accounts_done` defaults to zero because at the moment the row is
  -- written it IS zero.
  accounts_total    integer NOT NULL CHECK (accounts_total >= 0),
  accounts_done     integer NOT NULL DEFAULT 0 CHECK (accounts_done >= 0),

  -- WHETHER IT FOUND ANYTHING. A run that found three mismatches SUCCEEDED at
  -- its job; finding a discrepancy is not a failure of the check and the two
  -- must not be one column. This is the count that makes the difference between
  -- a row saying "a job ran" and a row an operator can act on.
  mismatches_found  integer NOT NULL DEFAULT 0 CHECK (mismatches_found >= 0),

  -- `text` with a CHECK rather than a native enum, on DATA_MODEL section 1's
  -- rule for a set expected to grow, and `detector_runs.status`' precedent.
  --
  -- THREE STATES AND NOT `detector_runs`' THREE. 'running' exists because a
  -- process that dies mid-sweep updates nothing, so a row left at 'running'
  -- with a `started_at` hours old is the only way a crashed sweep is visible at
  -- all. 'degraded' is NOT taken: `detector_runs` earns it from the synthetic
  -- battery (SD-M7-01), a control this table has no analogue of, and a state
  -- with no producer is a vocabulary member nobody can write.
  status            text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reconciliation_runs_status_is_known CHECK (
    status IN ('running', 'completed', 'failed')
  ),

  -- A sweep cannot have compared more accounts than it set out to.
  CONSTRAINT reconciliation_runs_done_within_total CHECK (
    accounts_done <= accounts_total
  ),

  -- A mismatch is found ON an account that was compared, and
  -- `reconciliations_account_day_uq` allows at most one row per account per day,
  -- so the count can never exceed the accounts done.
  CONSTRAINT reconciliation_runs_mismatches_within_done CHECK (
    mismatches_found <= accounts_done
  ),

  -- `finished_at` is set exactly when the run is no longer running. Written as
  -- an equivalence rather than as two implications so there is no third state
  -- where both halves are quietly true.
  CONSTRAINT reconciliation_runs_finished_when_not_running CHECK (
    (status = 'running') = (finished_at IS NULL)
  ),

  CONSTRAINT reconciliation_runs_finished_after_started CHECK (
    finished_at IS NULL OR finished_at >= started_at
  ),

  -- THE CONTROL. ADR-199 section 5's refusal, written as a constraint: a run
  -- that stopped short of its own population may not claim it completed, so a
  -- reader taking the latest completed run gets a sweep that actually covered
  -- the book. A crashed sweep is 'running' forever or 'failed' with
  -- `accounts_done < accounts_total`, and both are visible.
  CONSTRAINT reconciliation_runs_completed_is_whole CHECK (
    status <> 'completed' OR accounts_done = accounts_total
  )
);

-- The panel's read, which is `integrations.recon.last_run_at`: the newest run,
-- one index scan. `reserve_coverage_snapshots_latest_idx`'s shape.
CREATE INDEX reconciliation_runs_latest_idx
  ON reconciliation_runs (started_at DESC);

-- The operator's read: every sweep over one trading day, newest first, which is
-- what a redelivery makes a list rather than a row.
CREATE INDEX reconciliation_runs_day_idx
  ON reconciliation_runs (trading_day DESC, started_at DESC);

-- The morning read: anything that did not come back clean. `detector_runs_
-- unhealthy_idx`'s predicate widened by one disjunct, because on this table a
-- run that completed and FOUND something is also a run somebody must look at
-- (RB-02).
CREATE INDEX reconciliation_runs_unhealthy_idx
  ON reconciliation_runs (started_at DESC)
  WHERE status <> 'completed' OR mismatches_found > 0;

COMMENT ON TABLE reconciliation_runs IS
  'One row per reconciliation sweep, per nightly batch run (OVERVIEW 5.2). '
  'MUTABLE: written at the start of the sweep and updated at its end, which is '
  'what makes a run that crashed distinguishable from one that never started. '
  'Retention: forever. An operational record and never a money movement: no '
  'entry, no balance, no posting.';

COMMENT ON COLUMN reconciliation_runs.batch_run_id IS
  'The nightly batch run this sweep is a stage of. EVENTS 5.3 run_id, carried '
  'by batch.started, batch.completed and batch.failed. No foreign key because '
  'no batch run is a row in this schema; a superseding migration adds one the '
  'day it is.';

COMMENT ON COLUMN reconciliation_runs.trading_day IS
  'The exchange trading day being reconciled, never a UTC calendar date and '
  'never the day the sweep ran. A redelivery reconciles an older day.';

COMMENT ON COLUMN reconciliation_runs.mismatches_found IS
  'What THIS RUN saw. Not reconciliations mismatches_open, which is a count of '
  'the current state and moves when a human resolves one. The database bounds '
  'this number and does not verify it against reconciliations; that would take '
  'a cross-table trigger, and 0060 refused that class on evidence.';

COMMENT ON COLUMN reconciliation_runs.status IS
  'running | completed | failed. completed requires accounts_done = '
  'accounts_total (reconciliation_runs_completed_is_whole), so the panel cannot '
  'read a success off a sweep that stopped at the account boundary.';

COMMIT;
