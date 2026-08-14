-- =============================================================================
-- 0025_reserved_sequence
-- =============================================================================
-- THE MARKED RESERVED SEQUENCE. Three of the 93 changes land here, and they
-- are marked rather than deferred because ADR-026 rejected no delta: a delta
-- that is rejected is rejected IN WRITING, IN AN ADR, NEVER BY OMISSION, and a
-- table that quietly failed to appear is indistinguishable from one that was
-- dropped.
--
-- These three tables are CREATED AND UNUSED at launch. That is the whole
-- point. Each one costs an empty table now and avoids a migration against live
-- data later, which is the same trade DATA_MODEL section 12 documents for
-- every other reservation.
--
--   U-01        identity_signal_weights   ADR-022 tiers it to v1.x. WEIGHTS
--                                         TUNED ON NO DATA ARE GUESSES WEARING
--                                         A NUMBER, so the table exists and
--                                         holds nothing until there is data.
--   SD-M18-03   graduation_invitations    Conditional on a live program that
--                                         DOES NOT EXIST (OQ-M18-01 as ruled
--                                         at the FREEZE gate). Recorded so the
--                                         shape is decided before commercial
--                                         pressure decides it.
--   SD-M11-04   certificate_verifications The verify endpoint's access log.
--                                         Reserved because the endpoint ships
--                                         before the enumeration campaign it
--                                         watches for.
--
-- Deltas folded: SD-M11-04, SD-M18-03, U-01
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- identity_signal_weights                                       -- U-01
-- -----------------------------------------------------------------------------
-- ADR-022, M07 D-16. THE KNOWN-HOMELESS TABLE.
--
-- D-16 is not a detector so much as THE AGGREGATION OF EVERY OTHER ONE: hard
-- links auto-enforce, soft clusters queue a pre-funding review, and the
-- signal-weight table is config. ADR-022 tiers it to v1.x, so no module
-- claimed it and it reached FREEZE with no delta number.
--
-- Why it stays empty at launch, stated so a future reader does not "fix" it:
-- ADR-022's tier ordering is FORCED BY DATA AVAILABILITY, NOT BY AMBITION. The
-- v1 tier is deliberately only the facts. Weights tuned on no data are guesses
-- wearing a number, and a scored graph running on guessed weights produces
-- confident wrong answers about which humans are the same human.
--
-- The weights are CONFIGURATION, tuned through a reviewed diff, and they are
-- detector internals that M06's evidence packs keep INTERNAL-TIER ALWAYS: the
-- richer the graph, the more a leak is worth.
CREATE TABLE identity_signal_weights (
  signal_kind     text NOT NULL,
  link_kind       text NOT NULL,
  version         integer NOT NULL CHECK (version > 0),

  -- Basis points, like every ratio in this schema.
  weight_bp       integer NOT NULL CHECK (weight_bp BETWEEN 0 AND 10000),

  -- The tier this weight belongs to, so a v1.x weight cannot be switched on by
  -- a config edit that predates the data it needs.
  tier            text NOT NULL CHECK (tier IN ('v1', 'v1x', 'post_launch')),

  rationale       text NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date NULL,
  approved_by     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (signal_kind, link_kind, version),

  CONSTRAINT identity_signal_weights_range_ordered CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX identity_signal_weights_live_idx
  ON identity_signal_weights (signal_kind, link_kind) WHERE effective_to IS NULL;

COMMENT ON TABLE identity_signal_weights IS
  'U-01. RESERVED, empty at launch. ADR-022 tiers scoring to v1.x: weights '
  'tuned on no data are guesses wearing a number.';

-- -----------------------------------------------------------------------------
-- graduation_invitations                                        -- SD-M18-03
-- -----------------------------------------------------------------------------
-- ONLY IF GP-M18-01 OR GP-M18-02 EVER SHIPS. NO LIVE PROGRAM EXISTS AT LAUNCH
-- and zero live-program copy ships until counsel rules (OQ-M18-01).
--
-- The shape is recorded now so that it is decided BEFORE COMMERCIAL PRESSURE
-- DECIDES IT, and so terms_version exists FROM THE FIRST INVITATION rather
-- than being added after the first dispute.
--
-- The decoupling this table sits behind matters even though the program does
-- not exist, and the reason is easy to lose: ADR-024 removed the invitation
-- from R-49 because AN ENGINE THAT EMITS AN INVITATION ON LADDER COMPLETION
-- HAS ALREADY MADE THE PROMISE, and the promise commits Merit rather than the
-- program. Invitation is a DISCRETIONARY OPERATOR ACTION taken from the
-- accounts.graduation_eligible pool (U-02, 0007). Retrofitting discretion onto
-- a population that already believes the ladder leads somewhere is far more
-- expensive than designing it in now, while the population is zero.
--
-- Topstep's live selectivity is 0.71 percent. That is the number that settles
-- the argument.
CREATE TABLE graduation_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id   uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  program_ref   text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz NULL,
  declined_at   timestamptz NULL,
  expires_at    timestamptz NOT NULL,

  -- Present from the first invitation, never added after the first dispute.
  terms_version integer NOT NULL CHECK (terms_version > 0),       -- SD-M18-03

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- An invitation is accepted or declined, never both.
  CONSTRAINT graduation_invitations_one_response CHECK (
    accepted_at IS NULL OR declined_at IS NULL
  ),
  CONSTRAINT graduation_invitations_expiry_after_issue CHECK (
    expires_at > issued_at
  )
);

CREATE INDEX graduation_invitations_identity_idx
  ON graduation_invitations (identity_id, issued_at DESC);
CREATE INDEX graduation_invitations_open_idx
  ON graduation_invitations (expires_at)
  WHERE accepted_at IS NULL AND declined_at IS NULL;

COMMENT ON TABLE graduation_invitations IS
  'SD-M18-03. RESERVED, empty at launch. No live program exists (OQ-M18-01) '
  'and no live-program copy ships until counsel rules.';

-- -----------------------------------------------------------------------------
-- certificate_verifications                                     -- SD-M11-04
-- -----------------------------------------------------------------------------
-- AS-M11-04. THE VERIFY ENDPOINT IS THE ONLY PUBLIC ORACLE MERIT OPERATES
-- ABOUT ITS OWN PAYOUT BOOK, and an enumeration campaign against it is
-- INVISIBLE WITHOUT THIS TABLE.
--
-- HASHED INPUTS ONLY, 90 day retention. And THE RATE OF 'unknown' IS ITSELF
-- THE SIGNAL: a verifier looking up codes they were given resolves them; a
-- verifier guessing codes does not, so a rising unknown rate is an enumeration
-- campaign in progress rather than a usability problem.
CREATE TABLE certificate_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- HASHED. Storing the attempted codes in the clear would make this table a
  -- list of valid tokens for anyone who reached it.
  code_hash         bytea NOT NULL,                               -- SD-M11-04

  result            text NOT NULL CHECK (result IN (
                      'valid', 'unknown', 'revoked', 'deferred'
                    )),                                           -- SD-M11-04

  ip_hash           bytea NULL,
  user_agent_class  text NULL,   -- a class, never the string
  verified_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX certificate_verifications_time_idx
  ON certificate_verifications (verified_at DESC);

-- SD-M11-04. The enumeration signal: unknown-rate over a window, by source.
CREATE INDEX certificate_verifications_unknown_idx
  ON certificate_verifications (verified_at, ip_hash) WHERE result = 'unknown';

COMMENT ON TABLE certificate_verifications IS
  'SD-M11-04. RESERVED. Hashed inputs only, 90 day retention. The rate of '
  'unknown is itself the signal.';

COMMIT;
