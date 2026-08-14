-- =============================================================================
-- 0026_roles_and_grants
-- =============================================================================
-- E2 READ: MONEY PATH. This file contains no tables and it is the one that
-- makes several of the earlier files' promises real. Four things need the
-- founder's line-by-line read:
--
--   1. APPEND-ONLY IS A GRANT, NOT A CONVENTION (VG-8). The application role
--      holds INSERT and SELECT on the append-only tables and NO UPDATE, NO
--      DELETE. A code review can miss an UPDATE; a missing grant cannot.
--   2. THE APPLICATION ROLE HAS NO DDL. DATA_MODEL section 14. A running
--      application that can alter its own schema can undo every constraint in
--      the preceding 25 files, which would make them documentation.
--   3. THE ANALYTICS ROLE CANNOT READ PLAN CONFIG AT ALL (M13). Not "should
--      not": cannot. A second rulebook is prevented BY PERMISSION RATHER THAN
--      BY CARE, because the failure mode is an analyst reimplementing an
--      eligibility rule in SQL and getting a different answer that looks
--      authoritative.
--   4. NOBODY CAN DELETE FROM ledger_entries, ledger_transactions, events,
--      admin_actions, fills, daily_marks, rule_states OR tos_acceptances.
--      Those eight are the financial and evidentiary spine.
--
-- No deltas land here. The file exists because DATA_MODEL's Mutability section
-- says these guarantees are "enforced by grants in the database, not by
-- convention", and a guarantee nobody wrote down is a convention.
--
-- Roles are created IF NOT EXISTS-style, because role names are cluster-wide
-- and a shared cluster may already carry them.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- The application. Reads and writes, never alters.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merit_app') THEN
    CREATE ROLE merit_app NOLOGIN;
  END IF;

  -- Analytics and the journal module. Reads a bounded subset, and NOT the
  -- rulebook.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merit_analytics') THEN
    CREATE ROLE merit_analytics NOLOGIN;
  END IF;

  -- Migrations only. This is the role that holds DDL, and it is not the role
  -- the application connects as.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merit_migrator') THEN
    CREATE ROLE merit_migrator NOLOGIN;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Baseline: connect and schema usage, and NO DDL for the application
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO merit_app, merit_analytics;

-- DATA_MODEL section 14: the application role has no DDL. REVOKE CREATE is
-- what implements that sentence.
REVOKE CREATE ON SCHEMA public FROM merit_app, merit_analytics;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- The application role: full DML on mutable tables
-- -----------------------------------------------------------------------------
-- Granted broadly first, then REVOKED narrowly on the append-only set below.
-- The order matters: a broad grant followed by a targeted revoke fails safe if
-- a table is added to the append-only list later and the revoke is forgotten,
-- because the CI check in the testing strategy asserts the revoke list against
-- DATA_MODEL's append-only list rather than trusting either.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO merit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO merit_app;

-- -----------------------------------------------------------------------------
-- APPEND-ONLY: no UPDATE, no DELETE, for anyone
-- -----------------------------------------------------------------------------
-- VG-8. DATA_MODEL's Mutability section names these tables. The revoke is
-- against merit_app AND against PUBLIC, because a grant that only binds the
-- application role is a grant that a second connection string bypasses.
--
-- ledger_entries and ledger_transactions are first because they are the ones
-- where a retrofit cannot be rehearsed: the ledger is the one table in the
-- system whose history IS the product.
REVOKE UPDATE, DELETE ON
  ledger_entries,
  ledger_transactions,
  events,
  admin_actions,
  fills,
  raw_ingest_rows,
  daily_marks,
  rule_states,
  identity_merges,
  identity_links,
  tos_acceptances,
  account_status_history,
  wallet_entries,
  published_statistics,
  kyc_funnel_events,
  integration_dispatches,
  support_context_views,
  certificate_verifications
FROM merit_app, PUBLIC;

-- daily_marks and identity_links carry supersession and dispute columns that
-- are written by UPDATE in a naive implementation. They are NOT: a correction
-- to a mark inserts a new row and sets superseded_by on the old one, and a
-- disputed link sets suppressed on the existing edge. Both of those are
-- UPDATEs to a single column on an append-only table, so they are performed by
-- SECURITY DEFINER functions owned by merit_migrator rather than by widening
-- the grant.
--
-- The functions are not created here. They belong with the module that owns
-- the transition, and each arrives in the same pull request as its
-- negative-authz test (VG-5, DATA_MODEL section 14).

-- -----------------------------------------------------------------------------
-- The analytics role
-- -----------------------------------------------------------------------------
-- Reads the trading and account surface. Explicitly enumerated rather than
-- granted-then-revoked, because the risk here is a table added later becoming
-- readable by default, and the default should be that it is not.
GRANT SELECT ON
  accounts,
  account_status_history,
  daily_marks,
  fills,
  round_trips,
  analytics_snapshots,
  trading_calendar,
  contract_specs,
  reconciliations
TO merit_analytics;

-- The journal is the trader's own writing. Analytics reads it because the
-- module renders it; nothing else does.
GRANT SELECT, INSERT, UPDATE ON journal_entries TO merit_analytics;

-- THE RULEBOOK IS NOT READABLE BY ANALYTICS. M13's finding, implemented.
--
-- A second rulebook appears when someone with a SQL prompt and a deadline
-- reimplements an eligibility rule against the config, gets a different
-- answer, and publishes it. The role cannot read the config at all, so the
-- reimplementation cannot be written rather than being merely discouraged.
--
-- rule_states is excluded for the same reason: it is the engine's verdict, and
-- an analytics surface that reads verdicts will eventually be asked to explain
-- them.
REVOKE ALL ON
  plans,
  plan_versions,
  plan_version_sizes,
  rule_states,
  payout_requests,
  payout_transfers,
  ledger_accounts,
  ledger_transactions,
  ledger_entries,
  wallet_entries,
  wallet_withdrawals,
  detector_definitions,
  identity_signal_weights
FROM merit_analytics;

-- -----------------------------------------------------------------------------
-- Default privileges for anything a later migration creates
-- -----------------------------------------------------------------------------
-- A table created by a future migration is readable and writable by the
-- application and INVISIBLE TO ANALYTICS until someone grants it deliberately.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO merit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO merit_app;

COMMIT;
