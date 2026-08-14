-- =============================================================================
-- 0003_kyc
-- =============================================================================
-- E2 READ: MONEY PATH. KYC is what stands between the payout rail and a
-- fleet. Three things here need the founder's line-by-line read:
--
--   1. kyc_verifications.placement's CHECK (U-05). This is the stored value
--      side of ADR-021's ruled trigger set. A config key and a stored value
--      that disagree is the same defect one layer down, and the constraint is
--      what makes them agree by force rather than by care.
--   2. dedupe_matches (SD-M19-04) is an AUTO-ENFORCEMENT INPUT. A hard link
--      bans an account without human review. ADR-029 rules it authoritative
--      and drops the single-column alternative, because a system with two
--      sources for that decision will eventually enforce on whichever is read
--      first.
--   3. sanctions_screenings (SD-M19-02) carries the one outcome Merit MUST
--      act on and the one most likely to be a name collision.
--
-- Deltas folded: SD-M19-01, SD-M19-02, SD-M19-03, SD-M19-04, U-05
-- Findings:      C-05 (ADR-029, dedupe_matches is authoritative)
--
-- WHAT IS DELIBERATELY ABSENT: kyc_verifications.dedupe_matched_identity_id.
-- The approved DATA_MODEL carries it. ADR-029 drops it. Greenfield means it is
-- never created rather than created and dropped, and this comment is the
-- record that its absence is a ruling and not an oversight.
--
-- Merit stores STATUS AND REFERENCES ONLY. Documents, images and biometric
-- templates never touch Merit storage (VG-10). Every jsonb column below holds
-- provider decision metadata and never document data.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- kyc_verifications
-- -----------------------------------------------------------------------------
CREATE TABLE kyc_verifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id            uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  provider               text NOT NULL,   -- Sumsub, Veriff, Persona class.
                                          -- The adapter is vendor-agnostic
                                          -- (M19 section 1.1) and the selected
                                          -- provider is named in the privacy
                                          -- policy at selection time, which
                                          -- makes provider choice a disclosure
                                          -- event and not only a procurement
                                          -- one (ADR-021).
  provider_applicant_id  text NOT NULL,   -- the only pointer we keep

  state                  kyc_status NOT NULL,

  -- U-05. THE RULED TRIGGER VOCABULARY. Read this before changing the check.
  --
  -- The approved DATA_MODEL allowed ('pre_eval','pre_funded','direct_purchase').
  -- ADR-021 replaced the single placement point with a SET of trigger events,
  -- firing at whichever is reached first. SD-M19-03 widened the funnel table
  -- to carry the trigger and did not widen this one, which is why U-05 exists
  -- as a ruling with no delta number.
  --
  -- 'pre_eval' is retired into 'first_purchase': they name the same moment and
  -- ADR-021's vocabulary is the later one. The value is not carried forward,
  -- because no row exists to migrate.
  --
  -- 'payout_request' is INVALID AS A SOLE TRIGGER and is retained only as the
  -- backstop that fires when an earlier trigger somehow did not. Verification
  -- first demanded at payout time is the zero-denial policy meeting a wall,
  -- and it is the industry's worst-reviewed practice. The config schema
  -- enforces the "not alone" half; this column only records what fired.
  --
  -- The frozen v1 configuration is kyc.triggers =
  --   ['second_distinct_account_purchase', 'pre_funded']
  -- (FREEZE gate ruling, ADR-030 renamed the key). Direct and any
  -- instant-funded plan ALWAYS verify at purchase, unchanged and not
  -- configurable, because funding is immediate and no later moment exists:
  -- that is what 'direct_purchase' records.
  placement              text NOT NULL CHECK (placement IN (
                           'first_purchase',                    -- U-05
                           'second_distinct_account_purchase',  -- U-05
                           'second_purchase_any',               -- U-05
                           'eval_pass',                         -- U-05
                           'pre_funded',
                           'direct_purchase',
                           'payout_request'                     -- U-05, backstop only
                         )),

  -- The geo-consistency triangle. Three countries that should agree, recorded
  -- separately so the disagreement is visible rather than resolved silently.
  document_country       char(2) NULL,
  ip_country             char(2) NULL,
  payment_country        char(2) NULL,

  -- The fleet-killer signal. A boolean CANNOT contradict the dedupe_matches
  -- set; it can only be stale, and staleness is detectable (ADR-029). That is
  -- the whole reason it survives while dedupe_matched_identity_id does not.
  biometric_dedupe_hit   boolean NOT NULL DEFAULT false,

  rejection_reason       text NULL,
  verified_at            timestamptz NULL,
  expires_at             timestamptz NULL,   -- drives re-verification

  -- Provider decision metadata ONLY. Never document data.
  raw_result             jsonb NOT NULL DEFAULT '{}',

  -- SD-M19-01. A re-verification is a NEW ROW linked to the one it supersedes,
  -- or the system cannot distinguish "we checked again today" from "we looked
  -- at what we already had". INV-M19-06.
  verification_purpose   text NOT NULL CHECK (verification_purpose IN (
                           'initial',
                           'reverify_destination',
                           'reverify_flag',
                           'reverify_dormant',
                           'reverify_expiry'
                         )),                                    -- SD-M19-01
  supersedes             uuid NULL REFERENCES kyc_verifications(id)
                           ON DELETE RESTRICT,                  -- SD-M19-01
  liveness_passed        boolean NULL,                          -- SD-M19-01

  -- Recorded because liveness techniques and their defeat rates move quickly.
  -- An enforcement decided on a 2027 liveness check needs to know WHICH
  -- technique produced it (AS-M19-06). A boolean alone ages into an assertion
  -- nobody can re-evaluate.
  liveness_method        text NULL,                             -- SD-M19-01

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- An initial verification supersedes nothing; a re-verification supersedes
  -- something. The two halves of SD-M19-01 must agree or the supersession
  -- chain has holes in it.
  CONSTRAINT kyc_verifications_supersession_matches_purpose CHECK (
    (verification_purpose = 'initial' AND supersedes IS NULL)
    OR
    (verification_purpose <> 'initial' AND supersedes IS NOT NULL)
  ),

  CONSTRAINT kyc_verifications_no_self_supersede CHECK (
    supersedes IS NULL OR supersedes <> id
  )
);

CREATE INDEX kyc_verifications_identity_state_idx
  ON kyc_verifications (identity_id, state);
CREATE INDEX kyc_verifications_dedupe_hit_idx
  ON kyc_verifications (biometric_dedupe_hit) WHERE biometric_dedupe_hit;
CREATE INDEX kyc_verifications_supersedes_idx
  ON kyc_verifications (supersedes) WHERE supersedes IS NOT NULL;   -- SD-M19-01

-- Per-placement funnel telemetry is a condition of ADR-021's acceptance, and
-- the corpus-coverage figure is read from here joined to the buyer population.
CREATE INDEX kyc_verifications_placement_idx
  ON kyc_verifications (placement, created_at DESC);

COMMENT ON TABLE kyc_verifications IS
  'Status and references only. Documents, images and biometric templates '
  'never touch Merit storage (VG-10). Retention: forever (AML obligation).';

-- -----------------------------------------------------------------------------
-- sanctions_screenings                                          -- SD-M19-02
-- -----------------------------------------------------------------------------
-- INV-M19-05, AS-M19-04. This has its own object rather than living in
-- kyc_verifications.rejection_reason, and the reason is worth stating plainly:
-- folding it in would put a LEGALLY MANDATORY REFUSAL in the same field as a
-- blurry-photo rejection. They are not the same kind of fact and they do not
-- get the same review path.
CREATE TABLE sanctions_screenings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  provider        text NOT NULL,
  list_refs       text[] NOT NULL DEFAULT '{}',   -- which lists were screened
  match_strength  integer NULL CHECK (match_strength BETWEEN 0 AND 10000),

  -- A sanctions hit is the one outcome Merit MUST act on and the one most
  -- likely to be a name collision. 'cleared_on_review' is a distinct terminal
  -- state from 'clear' on purpose: "we looked and it was not them" is a
  -- different fact from "nothing matched", and only the first one needs a
  -- reviewer's name attached to it.
  status          text NOT NULL CHECK (status IN (
                    'clear', 'possible_match', 'confirmed_match', 'cleared_on_review'
                  )),
  reviewed_by     text NULL,
  reviewed_at     timestamptz NULL,
  review_note     text NULL,
  screened_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- A review outcome with no reviewer is not a review.
  CONSTRAINT sanctions_screenings_review_has_author CHECK (
    status NOT IN ('confirmed_match', 'cleared_on_review')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX sanctions_screenings_identity_idx
  ON sanctions_screenings (identity_id, screened_at DESC);

-- The action queue: anything that is not clear and not yet reviewed.
CREATE INDEX sanctions_screenings_open_idx
  ON sanctions_screenings (screened_at)
  WHERE status = 'possible_match' AND reviewed_at IS NULL;

-- -----------------------------------------------------------------------------
-- kyc_funnel_events                                             -- SD-M19-03
-- -----------------------------------------------------------------------------
-- Constitution (g) and INV-M19-11. Drop-off per placement CANNOT be
-- reconstructed from kyc_verifications, because the traders who matter most
-- are the ones who never created a verification row at all. THE ABANDONMENT IS
-- THE MEASUREMENT (AS-M19-08).
--
-- This is the table that settles the post-beta KYC trigger adjudication, which
-- is one of the nine items that survived FREEZE. It is a config array decided
-- on this data.
CREATE TABLE kyc_funnel_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_id     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- SD-M19-03 as WIDENED at the reconciliation (ADR-026): this column records
  -- WHICH TRIGGER FIRED, not merely which placement was configured. Under
  -- ADR-021 the placement is a set and the triggers race; recording the
  -- configured set here would answer a question nobody asked and lose the one
  -- that decides the adjudication.
  placement       text NOT NULL CHECK (placement IN (
                    'first_purchase',
                    'second_distinct_account_purchase',
                    'second_purchase_any',
                    'eval_pass',
                    'pre_funded',
                    'direct_purchase',
                    'payout_request'
                  )),

  plan_code       text NOT NULL,   -- per-plan escalation is pre-agreed rather
                                   -- than lineup-wide (ADR-021 condition 3)

  step            text NOT NULL CHECK (step IN (
                    'gate_reached',
                    'session_created',
                    'provider_opened',
                    'submitted',
                    'decided',
                    'abandoned'
                  )),

  occurred_at     timestamptz NOT NULL DEFAULT now(),
  attempt_number  integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),

  -- The per-check cost, in integer cents like every other money column. This
  -- is what turns "a $2 identity check in front of a $79 impulse purchase"
  -- from a rhetorical figure into a measured one.
  cost_cents      bigint NULL CHECK (cost_cents IS NULL OR cost_cents >= 0),

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only.
CREATE INDEX kyc_funnel_events_identity_idx
  ON kyc_funnel_events (identity_id, occurred_at);
CREATE INDEX kyc_funnel_events_funnel_idx
  ON kyc_funnel_events (placement, plan_code, step, occurred_at);

-- -----------------------------------------------------------------------------
-- dedupe_matches                                                -- SD-M19-04
-- -----------------------------------------------------------------------------
-- ADR-029, C-05. THE AUTHORITATIVE HARD LINK.
--
-- A match is a RELATIONSHIP BETWEEN TWO IDENTITIES, not a property of one. The
-- approved single column dedupe_matched_identity_id cannot express a face
-- matching three identities, and "first match" is not a property of a set: the
-- column would drift the moment a second match arrived.
--
-- Why this needed a ruling rather than a preference. Under ADR-022 a dedupe
-- hit is a HARD LINK THAT AUTO-ENFORCES, so it bans an account without human
-- review. Two sources that can disagree is an enforcement defect, not a
-- redundancy, and leaving both would have been the safe-looking choice and the
-- wrong one.
CREATE TABLE dedupe_matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_a         uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  identity_b         uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  match_strength     integer NOT NULL CHECK (match_strength BETWEEN 0 AND 10000),
  provider_ref       text NOT NULL,
  observed_at        timestamptz NOT NULL DEFAULT now(),

  -- 'open' is the state an auto-enforcing link sits in before a human has
  -- looked. It is first in the list because it is the default and because a
  -- disposition list whose first value is a conclusion invites defaulting to
  -- one.
  disposition        text NOT NULL DEFAULT 'open' CHECK (disposition IN (
                       'open',
                       'confirmed_same_person',
                       'distinct_persons',
                       'inconclusive'
                     )),
  disposition_note   text NULL,

  -- The provider's decision metadata: scores, method, timestamps. NEVER
  -- images. This is what makes an enforcement survive the provider
  -- relationship ending (AS-M19-07), which is the difference between evidence
  -- Merit holds and evidence Merit rents.
  evidence_snapshot  jsonb NOT NULL DEFAULT '{}',

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dedupe_matches_canonical_order CHECK (identity_a < identity_b),

  -- A resolved disposition carries its reasoning. 'inconclusive' counts as
  -- resolved for this purpose: deciding not to decide is a decision.
  CONSTRAINT dedupe_matches_resolution_is_explained CHECK (
    disposition = 'open' OR disposition_note IS NOT NULL
  )
);

-- One live match row per pair per provider reference. A re-screen that returns
-- the same pair updates the disposition rather than stacking a second opinion.
CREATE UNIQUE INDEX dedupe_matches_pair_uq
  ON dedupe_matches (identity_a, identity_b, provider_ref);

CREATE INDEX dedupe_matches_a_idx ON dedupe_matches (identity_a);
CREATE INDEX dedupe_matches_b_idx ON dedupe_matches (identity_b);

-- The review queue, and the auto-enforcement read path.
CREATE INDEX dedupe_matches_open_idx
  ON dedupe_matches (observed_at) WHERE disposition = 'open';

COMMENT ON TABLE dedupe_matches IS
  'Authoritative hard link (ADR-029). kyc_verifications.biometric_dedupe_hit '
  'is the fast boolean and can only be stale, never contradictory.';

COMMIT;
