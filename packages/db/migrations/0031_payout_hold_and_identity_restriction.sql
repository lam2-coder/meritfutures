-- =============================================================================
-- 0031_payout_hold_and_identity_restriction
-- =============================================================================
-- E2 READ: MONEY PATH. Six changes, all of them on or beside the payout path.
--
--   1. The hold columns on payout_requests and their completeness CHECK
--   2. BOTH SD-09 predicates dropped and re-created under the same names,
--      widened with 'held_pending_review'
--   3. The hold-expiry index, in the freeze-expiry index's shape
--   4. The external leg's settlement guard, and its open index re-created
--   5. The restriction-episode table (ADR-041), its partial unique and its
--      completeness CHECK
--   6. The replacement COMMENT ON TABLE payout_requests carrying the amended
--      zero-denial sentence
--
-- ADR-040 (the payout enforcement window) and ADR-041 (identity-level
-- restriction). Depends on 0030 having added 'held_pending_review' in its own
-- transaction; see that file's header for why one file is impossible.
--
-- NOTHING HERE EDITS ANYTHING. 0001, 0002, 0010 and 0011 are merged and stay
-- exactly as they are. Migrations are sacred: superseded, never edited.
--
-- Two disciplines inherited from defects this corpus already paid for:
-- every CHECK over an array uses cardinality() and never array_length, because
-- a CHECK evaluating to NULL PASSES (ADR-035); and every constraint body names
-- only columns these migrations declare, which CI-06j asserts from the tree.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The hold columns
-- -----------------------------------------------------------------------------
-- ADR-040. Deliberately shaped as an ADDITION and never as a relaxation.
--
-- A HELD REQUEST STORES THE FULL EVALUATED DECISION. The eligibility snapshot,
-- approved_cents, the split, the ordinal and the pinned plan version are all
-- computed at request time and frozen; ONLY THE LEDGER POSTING IS DEFERRED.
--
-- That choice is what keeps every existing NOT NULL and every existing CHECK
-- on this table intact. A superseding migration that relaxes NOT NULL on the
-- money table has a far wider blast radius than one that only adds, and
-- storing the full decision costs nothing. Release is then mechanical and
-- re-evaluates nothing, which preserves INV-M5-02: the number shown is the
-- number sent.
ALTER TABLE payout_requests
  ADD COLUMN held_at          timestamptz NULL,
  ADD COLUMN hold_flag_id     uuid NULL REFERENCES risk_flags(id)
                                ON DELETE RESTRICT,
  ADD COLUMN hold_expires_at  timestamptz NULL,
  ADD COLUMN hold_tos_clause  text NULL,
  ADD COLUMN hold_reason      text NULL;

-- The freeze constraint's shape, one state over. All five together or none.
--
-- A hold with a flag and no clock is the indefinite hold this whole fold
-- exists to prevent; a hold with a clock and no flag is a hold nobody can
-- justify. ADR-040 requires BOTH a cited flag AND a ToS clause AND a written
-- reason, per the existing freeze constraint, so all three are in the
-- completeness branch rather than only the flag.
ALTER TABLE payout_requests
  ADD CONSTRAINT payout_requests_hold_is_complete CHECK (
    (status <> 'held_pending_review'
       AND held_at IS NULL AND hold_flag_id IS NULL
       AND hold_expires_at IS NULL AND hold_tos_clause IS NULL
       AND hold_reason IS NULL)
    OR
    (status = 'held_pending_review'
       AND held_at IS NOT NULL AND hold_flag_id IS NOT NULL
       AND hold_expires_at IS NOT NULL AND hold_tos_clause IS NOT NULL
       AND hold_reason IS NOT NULL)
  );

-- -----------------------------------------------------------------------------
-- 2. BOTH SD-09 predicates, dropped and re-created under the same names
-- -----------------------------------------------------------------------------
-- A HELD REQUEST IS OUTSTANDING. It has not settled, it has not failed, and a
-- second request must not be openable beside it.
--
-- THIS IS THE C-02 DEFECT VERBATIM (ADR-028): a predicate that stops matching
-- is a gate that still exists, is still valid, ENFORCES NOTHING, and fails no
-- test. 0010 wrote these two adjacent, with identical predicates, precisely so
-- that a future change to one is visibly a change to one of two. This is that
-- future change, and both move together.
--
-- The names are preserved so nothing that references them by name breaks, and
-- 0010's reasoning is carried forward rather than left behind in a file a
-- reader of this one may never open.

DROP INDEX payout_requests_no_in_flight_uq;

-- SD-09, PREDICATE PER ADR-028 AS WIDENED BY ADR-040. G-NO-IN-FLIGHT,
-- ENFORCED IN THE DATABASE.
--
-- At most one outstanding request per account. FM-11 is payout stacking inside
-- the settlement window: several capped extractions from one qualifying
-- stretch. The engine refuses it at R-38 and this index refuses it again,
-- because the engine is not the only writer (EC-040, GS-052).
--
-- THE PREDICATE IS THE DANGEROUS HALF and it must stay in lockstep with the
-- status index below. Under ADR-019 the internal leg settles instantly to the
-- wallet; under ADR-040 a hold sits BEFORE approval. The outstanding states
-- are therefore exactly 'approved', 'frozen' and 'held_pending_review'.
CREATE UNIQUE INDEX payout_requests_no_in_flight_uq
  ON payout_requests (account_id)
  WHERE status IN ('approved', 'frozen', 'held_pending_review');

DROP INDEX payout_requests_outstanding_idx;

-- ADR-028 correction 1, WIDENED BY ADR-040. THE SECOND INDEX WITH THE SAME
-- PREDICATE.
--
-- DATA_MODEL carried this one with the stale ('approved','transferring')
-- predicate after the first had been corrected. Both are written here,
-- adjacent, with the same predicate, precisely so that a future change to one
-- is visibly a change to one of two.
CREATE INDEX payout_requests_outstanding_idx
  ON payout_requests (status)
  WHERE status IN ('approved', 'frozen', 'held_pending_review');

-- Every other object on this table was READ AND DISPOSITIONED rather than
-- assumed, and each disposition is recorded because "unchanged" is a decision:
--
--   payout_requests_account_ordinal_uq   WHERE status <> 'failed'
--     UNCHANGED, AND THAT IS CORRECT. A held request holds its ordinal while
--     held; enforcement sends it to 'failed', which releases the rung (EC-037).
--
--   payout_requests_freeze_is_complete
--     UNCHANGED. A held row leaves the three freeze columns null and satisfies
--     the constraint's first branch.
--
--   payout_requests_reflection_needs_settlement
--     UNCHANGED. A held row is 'pending', which the constraint permits.
--
--   payout_requests_account_idempotency_uq, identity_approved_idx,
--   freeze_expiry_idx, reflection_pending_idx
--     UNCHANGED. The hold-expiry index below is added BESIDE the freeze-expiry
--     one, in its shape, rather than widening it: two clocks, two sweeps, two
--     indexes, and neither one silently covering the other.

-- -----------------------------------------------------------------------------
-- 3. The hold-expiry index
-- -----------------------------------------------------------------------------
-- ADR-040. THE AUTO-RELEASE IS NOW THE LOAD-BEARING CONTROL: it is the only
-- thing standing between a hold and an indefinite one, which is a denial
-- nobody had to authorize (FM-M5-09 restated).
--
-- This index is the hourly sweep's source. The sweep already exists for the
-- freeze (CRON_INVENTORY) and already carries an S1 dead-man switch whose
-- stated reason is that a stalled sweep converts a bounded hold into an
-- unbounded one. One job, one row, one switch.
--
-- The alarm fires on THE QUERY, not on the job: a nightly assertion that no
-- request sits past its hold expiry, evaluated independently of whether the
-- sweep reported success. That is M02 FM-M2-11's idiom applied to the
-- releaser, and it is why this index exists rather than a scan.
CREATE INDEX payout_requests_hold_expiry_idx
  ON payout_requests (hold_expires_at) WHERE status = 'held_pending_review';

-- -----------------------------------------------------------------------------
-- 4. The external leg: enforcement, not a state
-- -----------------------------------------------------------------------------
-- ADR-040, AND THE ASYMMETRY IS DELIBERATE RATHER THAN AN OVERSIGHT.
--
-- On payout_requests the hold REPLACES approval: it is mutually exclusive with
-- every other status, so it is a status.
--
-- On wallet_withdrawals the halt is ORTHOGONAL to the rail state. A halted
-- withdrawal is still 'approved' or 'transferring' as far as the rail is
-- concerned. Collapsing an orthogonal hold into the rail's status column is
-- precisely SD-M5-06's named mistake, where the engine's gates and the rail's
-- gates sharing one column is the defect.
--
-- 0011 gave this table frozen_at, freeze_flag_id, freeze_expires_at and a
-- freeze-expiry index, and wallet_withdrawal_status has NO frozen value.
-- THE HALT WAS REPRESENTABLE AND UNENFORCED: a halted withdrawal still matched
-- the open index and nothing refused settlement. This is the enforcement.
--
-- Release resumes the rail; it does not re-pay, because the money is already
-- the trader's.
ALTER TABLE wallet_withdrawals
  ADD CONSTRAINT wallet_withdrawals_live_freeze_blocks_settlement CHECK (
    status <> 'settled' OR frozen_at IS NULL
  );

-- The open index re-created so a HALTED ROW STAYS VISIBLE to the operator and
-- to the sweep. A halt that removes the row from the only index anyone scans
-- is a halt nobody can find.
DROP INDEX wallet_withdrawals_open_idx;

CREATE INDEX wallet_withdrawals_open_idx
  ON wallet_withdrawals (status, requested_at)
  WHERE status IN ('requested', 'cooling', 'approved', 'transferring');

-- The same 48 hour expiry on the same hourly sweep. 0011's
-- wallet_withdrawals_freeze_expiry_idx already indexes freeze_expires_at for
-- every non-null row and is UNCHANGED: it already covers the halted set, so
-- widening it would add nothing and dropping it would remove the sweep's
-- source. Recorded because "unchanged" is a decision here too.

-- -----------------------------------------------------------------------------
-- 5. The restriction episode (ADR-041)
-- -----------------------------------------------------------------------------
-- `identities` carries status and status_reason and NOTHING ELSE, while
-- `accounts` has had account_status_history since 0007. A repeat restriction
-- would overwrite its predecessor and A RESTORE WOULD BE UNPROVABLE AT
-- EXACTLY THE MOMENT IT IS CONTESTED.
--
-- ADR-041 rules that `restricted` is NOT renamed to `suspended`: the state
-- already exists in identity_status, is already reversible, is already a
-- distinct third value, and is already on the trader's own GET /me. What was
-- missing was never the state. It was the binding surface and the episode
-- record. Two expressions of one concept is this repository's most repeated
-- defect, and adding `suspended` beside `restricted` would create one
-- deliberately.
--
-- Distinct from its two neighbours, in the ADR's own words:
--   closure for cause is terminal and per account
--   a freeze is per payment and expires
--   A RESTRICTION IS PER HUMAN, HALTS EVERYTHING, AND IS REVERSED BY A
--   DOCUMENTED RESTORE.
CREATE TABLE identity_restriction_episodes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id          uuid NOT NULL REFERENCES identities(id)
                         ON DELETE RESTRICT,

  -- The citation. A restriction with no cited flag is an enforcement nobody
  -- can justify, which is the freeze constraint's reasoning one layer up.
  flag_id              uuid NOT NULL REFERENCES risk_flags(id)
                         ON DELETE RESTRICT,
  tos_clause           text NOT NULL,
  reason               text NOT NULL,

  -- Audit: actor and time, on both directions.
  opened_by            uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at            timestamptz NOT NULL DEFAULT now(),

  -- ADR-040's 48 hour SLA, WHERE A PAYOUT IS PENDING. Null when none is.
  --
  -- IT BINDS THE RESTRICTION RATHER THAN THE PAYOUT. A restriction cannot hold
  -- a held payout past its own 48 hours, and THAT IS THE PROPERTY THAT STOPS
  -- RULING B FROM BECOMING A ROUTE AROUND RULING A. Asserted rather than
  -- intended: the probe drives it.
  sla_due_at           timestamptz NULL,

  -- The restore, which is what makes this reversible rather than terminal.
  restored_at          timestamptz NULL,
  restored_by          uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  restore_evidence     text NULL,

  -- The enforcement branch. An episode that ends in closure for cause carries
  -- its pack; one that ends in a restore does not.
  evidence_pack_id     uuid NULL REFERENCES evidence_packs(id)
                         ON DELETE RESTRICT,

  created_at           timestamptz NOT NULL DEFAULT now(),

  -- identities_freeze_is_explained's shape: an episode with a clock and no
  -- flag, or a flag and no clock, is unwritable. The flag and the clause are
  -- NOT NULL above, so the completeness question that remains is the RESTORE:
  -- a restored episode carries its actor and its evidence, or it is not
  -- restored. A restore nobody signed is the unprovable restore this table
  -- exists to prevent.
  CONSTRAINT identity_restriction_restore_is_complete CHECK (
    (restored_at IS NULL AND restored_by IS NULL AND restore_evidence IS NULL)
    OR
    (restored_at IS NOT NULL AND restored_by IS NOT NULL
       AND restore_evidence IS NOT NULL)
  ),

  -- A restore cannot precede the restriction it reverses.
  CONSTRAINT identity_restriction_restore_follows_open CHECK (
    restored_at IS NULL OR restored_at >= opened_at
  )
);

-- AT MOST ONE OPEN EPISODE PER IDENTITY, in payout_requests_no_in_flight_uq's
-- shape. Two open episodes on one human is two clocks on one restriction and
-- two restores to prove.
CREATE UNIQUE INDEX identity_restriction_open_uq
  ON identity_restriction_episodes (identity_id) WHERE restored_at IS NULL;

-- The SLA sweep's source, in payout_requests_hold_expiry_idx's shape. Same
-- clock, same hourly job, same dead-man switch.
CREATE INDEX identity_restriction_sla_due_idx
  ON identity_restriction_episodes (sla_due_at)
  WHERE restored_at IS NULL AND sla_due_at IS NOT NULL;

CREATE INDEX identity_restriction_identity_idx
  ON identity_restriction_episodes (identity_id, opened_at DESC);

COMMENT ON TABLE identity_restriction_episodes IS
  'ADR-041. One row per restriction of one human. Retention: forever. '
  'At most one open episode per identity. The restore is the proof, which is '
  'why restored_by and restore_evidence are all-or-none.';

-- -----------------------------------------------------------------------------
-- 6. The replacement table comment
-- -----------------------------------------------------------------------------
-- 0010:225 carried the pre-amendment sentence. A COMMENT ON TABLE is
-- REPLACEABLE METADATA rather than migration text, so re-stating it here edits
-- nothing: 0010 is untouched and still says what it said the day it merged.
--
-- This is one of the ten zero-denial sites, and it is one of the THREE that
-- live in migrations. The other two, 0001:73 and 0010:77, are `--` comments
-- and can never be edited. They now describe a policy whose mechanism has
-- moved, and 0030's header carries the amendment in full so a reader arriving
-- from either of them lands somewhere.
COMMENT ON TABLE payout_requests IS
  'Retention: forever. ADR-040 amends the zero-denial policy: no payout is '
  'denied, and the mechanism is now a review state that EXPIRES rather than '
  'the absence of one. held_pending_review is pre-approval, carries a cited '
  'flag and a ToS clause, and auto-releases and pays within 48 hours unless a '
  'documented enforcement action is recorded. There is still no denied '
  'status. Adding a value requires an ADR.';

COMMIT;
