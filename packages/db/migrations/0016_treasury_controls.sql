-- =============================================================================
-- 0016_treasury_controls
-- =============================================================================
-- E2 READ: MONEY PATH. Four control surfaces, and every one of them exists
-- because a control that lives in a person's attention is not a control.
--
--   1. U-03's ledger_halts. ADR-016 requires an IDENTITY-SCOPED halt that
--      PAGES AND ESCALATES on a configured window. Nothing in the corpus held
--      it, which is why it has no delta number. A halt with no deadline is an
--      outage nobody owns; a halt with no subject is the global halt, which is
--      a different and much heavier thing.
--   2. SD-M6-02's plan_breaker_state. WITHOUT A RECORDED SAMPLE SIZE AND A
--      MINIMUM, the breaker fires on a two-transaction denominator and pauses
--      sales on a brand new plan during its launch week: a self-inflicted
--      outage that also destroys trust in the breaker itself (AS-M6-02).
--   3. SD-M6-03's alarm_suppressions. Constitution M1's own FM-17 names the
--      failure: a self-audit that becomes slow becomes a self-audit that gets
--      disabled. A MANDATORY EXPIRY converts "temporarily off" from a lie
--      people tell themselves into a dated fact.
--   4. SD-M6-05's dual_control_approvals. Without a row, "dual control" is two
--      clicks by the same session, and Appendix D warns that a control which
--      is theatre is WORSE THAN NOTHING because it reads as a control in an
--      audit.
--
-- Deltas folded: SD-M6-02, SD-M6-03, SD-M6-05, U-03
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- ledger_halts                                                  -- U-03
-- -----------------------------------------------------------------------------
-- ADR-016, M05 INV-M5-16. AN IDENTITY-SCOPED HALT WITH AN ESCALATION CLOCK.
--
-- The global halt is proportionate for a GLOBAL ledger sum mismatch, and it is
-- proportionate precisely because an unbalanced transaction cannot be written
-- in the first place (the deferred zero-sum trigger in 0027), so a global
-- mismatch implies data corruption or a direct write. That is a stop-the-world
-- event.
--
-- A single identity's position failing a check is not. Halting the firm for it
-- is an outage; ignoring it is a leak. The ruling is a SCOPED halt that pages
-- and escalates on a configured window, and this table is the row that ruling
-- requires: a SUBJECT, a START, and a DEADLINE.
--
-- The deadline is the whole point. Without escalate_at, a scoped halt is a
-- quiet flag on one trader that survives because it inconveniences nobody with
-- authority to clear it.
CREATE TABLE ledger_halts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The SUBJECT. Identity-scoped: null is not permitted, because a halt with
  -- no subject is the global halt and the global halt is not a row, it is an
  -- incident.
  identity_id     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- What tripped it. Named rather than free text at the top level so the
  -- runbook can key off it.
  reason_code     text NOT NULL CHECK (reason_code IN (
                    'position_mismatch',
                    'reflection_missing',
                    'wallet_balance_divergence',
                    'manual'
                  )),
  reason_note     text NOT NULL,
  evidence        jsonb NOT NULL DEFAULT '{}',

  -- The START.
  halted_at       timestamptz NOT NULL DEFAULT now(),
  halted_by       text NOT NULL,   -- detector name, or an operator

  -- The DEADLINE. Configured window from halted_at. When this passes with
  -- released_at still null, the halt PAGES and escalates. It is NOT NULL
  -- because a halt without a deadline is the failure mode the ruling exists to
  -- prevent.
  escalate_at     timestamptz NOT NULL,

  -- Recorded when the page fires, so a second page is a second decision rather
  -- than a repeat of the first.
  escalated_at    timestamptz NULL,

  released_at     timestamptz NULL,
  released_by     text NULL,
  release_note    text NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_halts_deadline_after_start CHECK (escalate_at > halted_at),

  CONSTRAINT ledger_halts_release_is_explained CHECK (
    released_at IS NULL
    OR (released_by IS NOT NULL AND release_note IS NOT NULL)
  )
);

-- At most one live halt per identity. A second halt on a subject already
-- halted is new evidence on the existing one, not a second outage.
CREATE UNIQUE INDEX ledger_halts_live_per_identity_uq
  ON ledger_halts (identity_id) WHERE released_at IS NULL;

-- The escalation sweep, and the read every payout and withdrawal path makes
-- before it moves money for this identity.
CREATE INDEX ledger_halts_escalation_idx
  ON ledger_halts (escalate_at) WHERE released_at IS NULL;

COMMENT ON TABLE ledger_halts IS
  'U-03. ADR-016 identity-scoped halt: subject, start, deadline. The global '
  'halt is an incident, not a row in this table.';

-- -----------------------------------------------------------------------------
-- plan_breaker_state                                            -- SD-M6-02
-- -----------------------------------------------------------------------------
-- INV-M6-07. The breaker that pauses sales on a plan.
--
-- sample_size and min_sample are the delta's real content. A loss-ratio
-- breaker with no minimum sample fires on a two-transaction denominator, which
-- means it fires during LAUNCH WEEK on every new plan, every time. That is an
-- outage Merit inflicts on itself, and worse, it is the outage that teaches
-- everyone to override the breaker (AS-M6-02, and AS-M6-02's mechanism is the
-- same one as AS-M6-02's cousin in M07: a control that cries wolf gets
-- overridden).
--
-- 'insufficient_data' is therefore a FIRST-CLASS STATE, not an error. It is
-- what the breaker says during launch week, and saying it is the correct
-- behaviour.
CREATE TABLE plan_breaker_state (
  plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  evaluated_on       date NOT NULL,

  metric             text NOT NULL,
  numerator_cents    bigint NOT NULL,
  denominator_cents  bigint NOT NULL,
  sample_size        integer NOT NULL CHECK (sample_size >= 0),   -- SD-M6-02
  ratio_bp           integer NOT NULL,
  threshold_bp       integer NOT NULL,
  min_sample         integer NOT NULL CHECK (min_sample > 0),     -- SD-M6-02

  state              text NOT NULL CHECK (state IN (
                       'armed', 'paused', 'insufficient_data', 'manually_overridden'
                     )),

  -- An override is dated and expires. An indefinite override is a disabled
  -- breaker with a nicer name.
  override_reason    text NULL,
  override_expires_at timestamptz NULL,
  changed_by         text NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (plan_id, evaluated_on),

  -- SD-M6-02. The breaker may not be armed or paused below its own minimum
  -- sample. Below it the only honest state is insufficient_data, and this
  -- CHECK is what makes that honesty structural rather than procedural.
  CONSTRAINT plan_breaker_state_respects_min_sample CHECK (
    state NOT IN ('armed', 'paused') OR sample_size >= min_sample
  ),

  -- An override carries a reason, an expiry, and a name.
  CONSTRAINT plan_breaker_state_override_is_complete CHECK (
    state <> 'manually_overridden'
    OR (override_reason IS NOT NULL
        AND override_expires_at IS NOT NULL
        AND changed_by IS NOT NULL)
  )
);

CREATE INDEX plan_breaker_state_current_idx
  ON plan_breaker_state (plan_id, evaluated_on DESC);
CREATE INDEX plan_breaker_state_override_expiry_idx
  ON plan_breaker_state (override_expires_at)
  WHERE state = 'manually_overridden';

-- -----------------------------------------------------------------------------
-- alarm_suppressions                                            -- SD-M6-03
-- -----------------------------------------------------------------------------
-- INV-M6-06. A MANDATORY EXPIRY, which is the whole delta.
--
-- expires_at is NOT NULL and there is no sentinel for "never". That is
-- deliberate: the only way to suppress an alarm indefinitely is to keep
-- renewing the suppression, which is a repeated, dated, attributed act rather
-- than a single forgotten one.
CREATE TABLE alarm_suppressions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_key      text NOT NULL,

  -- What the suppression covers: an account, an identity, a plan, a detector.
  -- jsonb because the scope shape differs per alarm and inventing a column per
  -- alarm class is how this table becomes unmaintainable.
  scope          jsonb NOT NULL DEFAULT '{}',

  -- NOT NULL. A suppression nobody explained is one nobody can review.
  reason         text NOT NULL,
  suppressed_by  text NOT NULL,
  suppressed_at  timestamptz NOT NULL DEFAULT now(),

  -- NOT NULL, BY DESIGN. See the table comment above.
  expires_at     timestamptz NOT NULL,                            -- SD-M6-03

  released_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alarm_suppressions_expiry_after_start CHECK (expires_at > suppressed_at)
);

-- The live-suppression read: what is currently muted, and until when.
CREATE INDEX alarm_suppressions_live_idx
  ON alarm_suppressions (alarm_key, expires_at)
  WHERE released_at IS NULL;

COMMENT ON COLUMN alarm_suppressions.expires_at IS
  'SD-M6-03. NOT NULL with no never sentinel. Indefinite suppression is only '
  'reachable by repeated, dated, attributed renewal.';

-- -----------------------------------------------------------------------------
-- dual_control_approvals                                        -- SD-M6-05
-- -----------------------------------------------------------------------------
-- ADR-010 requires a SECOND approval WITHIN A WINDOW. That needs a row.
--
-- payload_hash is what makes the second approval an approval OF SOMETHING. An
-- approval that does not pin the payload approves whatever the request happens
-- to say when it executes, which is a control that can be edited after it is
-- passed.
CREATE TABLE dual_control_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind  text NOT NULL,
  subject_id    uuid NOT NULL,
  requested_by  text NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),

  -- Pins WHAT is being approved. See above.
  payload_hash  bytea NOT NULL,                                   -- SD-M6-05

  approved_by   text NULL,
  approved_at   timestamptz NULL,

  -- The window. ADR-010's "within a window" is this column, and it is NOT NULL
  -- for the same reason alarm_suppressions.expires_at is.
  expires_at    timestamptz NOT NULL,

  status        text NOT NULL DEFAULT 'pending' CHECK (status IN (
                  'pending', 'approved', 'expired', 'withdrawn'
                )),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- THE CONTROL ITSELF, IN DDL: the approver is not the requester. Without
  -- this the table records two clicks by the same session and calls it dual
  -- control, which Appendix D names as worse than nothing because it reads as
  -- a control in an audit.
  CONSTRAINT dual_control_approvals_second_person CHECK (
    approved_by IS NULL OR approved_by <> requested_by
  ),

  CONSTRAINT dual_control_approvals_approval_is_complete CHECK (
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR
    (status <> 'approved' AND approved_by IS NULL AND approved_at IS NULL)
  ),

  -- An approval outside its own window is not an approval.
  CONSTRAINT dual_control_approvals_within_window CHECK (
    approved_at IS NULL OR approved_at <= expires_at
  ),

  CONSTRAINT dual_control_approvals_window_after_request CHECK (
    expires_at > requested_at
  )
);

CREATE INDEX dual_control_approvals_subject_idx
  ON dual_control_approvals (subject_kind, subject_id);

-- The pending queue and the expiry sweep.
CREATE INDEX dual_control_approvals_pending_idx
  ON dual_control_approvals (expires_at) WHERE status = 'pending';

COMMIT;
