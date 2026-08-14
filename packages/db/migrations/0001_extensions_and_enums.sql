-- =============================================================================
-- 0001_extensions_and_enums
-- =============================================================================
-- Merit Futures schema, migration 1 of 27.
--
-- E2 READ: MONEY PATH. This file declares payout_status, which ADR-028 ruled,
-- and whose value set silently decides whether G-NO-IN-FLIGHT is enforced.
--
-- Authority: docs/architecture/DATA_MODEL.md as amended by ADR-026.
-- Every folded change carries an inline -- SD-nn or -- U-nn marker.
-- Full trace: packages/db/DELTA_MANIFEST.md
--
-- Migrations are sacred: once merged, never edited, only superseded.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email_normalized
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- Identity and access
-- -----------------------------------------------------------------------------
CREATE TYPE identity_status AS ENUM ('active', 'restricted', 'closed');

CREATE TYPE kyc_status AS ENUM (
  'kyc_required', 'pending', 'verified', 'rejected', 'expired'
);

-- -----------------------------------------------------------------------------
-- Catalog and commerce
-- -----------------------------------------------------------------------------
CREATE TYPE plan_version_status AS ENUM ('draft', 'published', 'retired');

CREATE TYPE purchase_status AS ENUM (
  'pending', 'paid', 'failed', 'refunded', 'charged_back'
);

-- -----------------------------------------------------------------------------
-- Accounts and platform
-- -----------------------------------------------------------------------------
CREATE TYPE account_phase AS ENUM ('eval', 'funded', 'closed', 'graduated');

CREATE TYPE account_status AS ENUM (
  'provisioning_pending', 'active', 'breached', 'expired',
  'closed_admin', 'closed_chargeback', 'graduated'
);

-- U-06 adds confirmed_inferred. M02 section 3.2 makes it a distinct state
-- and not a synonym: an inferred confirmation is strong evidence for
-- create_account and WORTHLESS for set_risk, because you cannot infer that a
-- risk setting applied from an account appearing in a report.
-- Binding: set_risk operations may never reach confirmed_inferred (AS-M2-03).
CREATE TYPE provisioning_status AS ENUM (
  'queued', 'written', 'delivered', 'confirmed', 'confirmed_inferred', 'failed'
);

-- -----------------------------------------------------------------------------
-- Ingest
-- -----------------------------------------------------------------------------
CREATE TYPE ingest_file_status AS ENUM (
  'received', 'parsing', 'parsed', 'quarantined', 'applied'
);

-- -----------------------------------------------------------------------------
-- Payouts
-- -----------------------------------------------------------------------------
-- ADR-028. THE RULED ENUM. Read this comment before changing this type.
--
--   * There is NO 'denied' and NO review state, BY DESIGN. The zero-denial
--     policy is expressed as a schema constraint precisely so that adding one
--     is a deliberate act against a stated rule rather than an oversight.
--     Adding a value here requires an ADR.
--
--   * 'transferring' was RETIRED from payout_requests by ADR-028 and belongs
--     to wallet_withdrawals (migration 0011). Under ADR-019 the internal leg
--     settles instantly to the wallet, so there is no transferring state left
--     on this table to occupy.
--
--   * 'settled_to_wallet' was considered and REJECTED: settlement to the
--     wallet is the only settlement the internal leg has, and a status that
--     names its destination invites a second one.
--
-- The SD-09 partial unique index in 0010 keys off this set. If 'transferring'
-- had stayed in that predicate after the value stopped occurring, the index
-- would still exist, still be valid, and enforce NOTHING, because no row would
-- ever match. A gate that silently stops gating is worse than an absent one.
CREATE TYPE payout_status AS ENUM ('approved', 'settled', 'failed', 'frozen');

-- ADR-019's external leg. wallet_withdrawals owns the states payout_requests
-- gave up, plus the two the external rail actually needs.
CREATE TYPE wallet_withdrawal_status AS ENUM (
  'requested', 'cooling', 'approved', 'transferring',
  'settled', 'failed', 'cancelled'
);

-- -----------------------------------------------------------------------------
-- Risk
-- -----------------------------------------------------------------------------
CREATE TYPE risk_flag_status AS ENUM (
  'open', 'investigating', 'dismissed', 'enforced'
);

-- -----------------------------------------------------------------------------
-- Transparency
-- -----------------------------------------------------------------------------
-- ADR-031. THE UNIT VOCABULARY IS ONE VOCABULARY, AND IT IS A TYPE RATHER THAN
-- TWO CHECK LISTS.
--
-- published_statistics carries a unit on the value and a unit on the numerator.
-- Written as two independent CHECK constraints they are two vocabularies for
-- one concept, and two vocabularies for one concept is how they drift: a later
-- migration widens one, nobody widens the other, and a published figure and
-- its own numerator start disagreeing about what a number means on a surface
-- Merit cannot restate quietly.
--
--   count             a number of accounts, evaluations, requests, payouts
--   bp                integer basis points. ST-01, ST-02, ST-07 are rates
--   cents             integer cents. ST-03 and ST-04. THIS IS MONEY
--   duration_seconds  whole seconds. ST-05 and ST-06
--
-- 'bp' never legitimately appears as a NUMERATOR unit, because a numerator is
-- a count, a sum of cents, or an elapsed duration, and the rate is what you
-- get by dividing. It is in the shared type anyway: the alternative is a
-- second type that exists only to omit one value, which is the drift this type
-- exists to prevent.
CREATE TYPE statistic_unit AS ENUM (
  'count', 'bp', 'cents', 'duration_seconds'
);

-- ADR-032. WHICH FIGURE A PUBLISHED ROW CARRIES.
--
-- Three of the seven ruled statistics publish two figures at once: ST-04 mean
-- AND median ("neither is published alone"), ST-05 and ST-06 p50 AND p95. One
-- row per statistic per window cannot express that.
--
-- Shared, for the same reason as statistic_unit above: statistic_definitions
-- DECLARES a measure set and published_statistics carries one measure per row,
-- and the completeness trigger in 0027 compares the two. A comparison between
-- two independently maintained vocabularies is a comparison that eventually
-- passes for the wrong reason.
CREATE TYPE statistic_measure AS ENUM (
  'rate', 'total', 'mean', 'median', 'p50', 'p95', 'count'
);

COMMIT;
