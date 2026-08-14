-- =============================================================================
-- 0002_identity
-- =============================================================================
-- E2 READ: MONEY PATH. Auth is a money path (CLAUDE.md, constitution E2). Two
-- things in this file need the founder's line-by-line read:
--
--   1. THE SPINE. identities is the row every cap, every aggregate liability
--      figure, and every ring detection keys off. If the identity resolution
--      is wrong, every downstream money number is wrong about the right
--      number of dollars against the wrong human.
--   2. THE AUTHENTICATION SURFACE. passkeys, otp_challenges and sessions are
--      the whole of it. Merit is passwordless by design, so there is no
--      password table anywhere in this schema and the absence is deliberate,
--      not an omission to be repaired later.
--
-- Deltas folded: SD-M4-03, SD-M7-04, SD-M10-04, U-04
--
-- Authority: docs/architecture/DATA_MODEL.md section 3, as amended by ADR-026.
-- Every folded change carries an inline -- SD-nn or -- U-nn marker.
-- Full trace: packages/db/DELTA_MANIFEST.md
--
-- Migrations are sacred: once merged, never edited, only superseded.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- identities
-- -----------------------------------------------------------------------------
-- The resolved human. Everything radiates from here, never from email and
-- never from account (DATA_MODEL section 2).
CREATE TABLE identities (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reserved per the Wave 1 schema list. Nullable because v1 never shows it;
  -- two columns now against a leaderboard migration later.
  display_name           text NULL,
  leaderboard_opt_in     boolean NOT NULL DEFAULT false,

  -- Restriction and closure are identity-level, not account-level. An operator
  -- who is restricted is restricted across every account they hold.
  status                 identity_status NOT NULL DEFAULT 'active',
  status_reason          text NULL,

  -- Per-entity cap override for legitimate edge cases: grandfathered merges
  -- (B4 #17), where an identity is over cap through no purchase of its own.
  max_accounts_override  integer NULL CHECK (max_accounts_override > 0),

  -- The investigation freeze. Set before request time only.
  payouts_frozen         boolean NOT NULL DEFAULT false,
  frozen_reason          text NULL,     -- the ToS citation shown to the trader
  frozen_at              timestamptz NULL,

  -- SD-M10-04. The Chatwoot contact pointer, so a support conversation
  -- resolves to an identity without Merit storing transcripts. One column
  -- instead of a conversation table is the whole point: Merit is not a second
  -- copy of the support system.
  support_contact_ref    text NULL,

  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- A freeze with no reason and no clock is an indefinite hold that nobody
  -- owns. frozen_at is what drives the freeze-duration alert, which is the
  -- control that binds on Merit rather than on the trader.
  CONSTRAINT identities_freeze_is_explained CHECK (
    payouts_frozen = false
    OR (frozen_reason IS NOT NULL AND frozen_at IS NOT NULL)
  ),

  -- The same shape one layer up: a non-active status carries its reason.
  CONSTRAINT identities_status_is_explained CHECK (
    status = 'active' OR status_reason IS NOT NULL
  )
);

CREATE INDEX identities_status_idx
  ON identities (status) WHERE status <> 'active';
CREATE INDEX identities_payouts_frozen_idx
  ON identities (payouts_frozen) WHERE payouts_frozen;

COMMENT ON TABLE identities IS
  'The resolved human. Account caps, aggregate liability and ring detection '
  'all key here. Retention: forever (financial counterparty record).';

-- -----------------------------------------------------------------------------
-- identity_signals
-- -----------------------------------------------------------------------------
-- Observed entity-resolution signals: one row per observation type per value
-- per identity. Values are HASHED, never raw, which is what bounds what a
-- breach yields to "these two accounts shared something" rather than to the
-- card number they shared.
CREATE TABLE identity_signals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- text plus check rather than an enum, because this set is expected to grow:
  -- every new detector that observes a new kind of thing adds a value here.
  --
  -- U-01 will add the signal-weight table over this vocabulary in the reserved
  -- sequence (0025), per ADR-022's v1.x tier.
  kind               text NOT NULL CHECK (kind IN (
                       'device',
                       'ip',
                       'asn',
                       'email_normalized',
                       'payment',
                       'kyc_identity',
                       'rise_identity',
                       -- U-04. ADR-023's SEON-class checkout enrichment
                       -- vendor, feeding M07's D-15. The check list had no
                       -- slot for it: the ruling created the signal source and
                       -- no delta created the value it writes under. Observe
                       -- mode at launch, fail-open on timeout, never a silent
                       -- decline.
                       'footprint_enrichment'
                     )),

  -- HASHED, never raw: card BIN plus last four, device id, IP.
  value_hash         bytea NOT NULL,

  -- Non-identifying display fragment for admin, for example 'visa ****4242'.
  -- This is the only human-readable half and it is deliberately not enough to
  -- reconstruct the value it previews.
  value_preview      text NULL,

  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  observation_count  integer NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX identity_signals_identity_kind_value_uq
  ON identity_signals (identity_id, kind, value_hash);

-- The reverse lookup: the join that finds every identity sharing a device.
-- This index IS the entity graph's read path.
CREATE INDEX identity_signals_kind_value_idx
  ON identity_signals (kind, value_hash);

COMMENT ON TABLE identity_signals IS
  'Entity-resolution observations, hashed. Retention: 24 months rolling for '
  'kind = ip; forever for payment and kyc_identity (fraud history).';

-- -----------------------------------------------------------------------------
-- identity_links
-- -----------------------------------------------------------------------------
-- Graph edges between identities, produced by resolution and by detectors.
-- APPEND-ONLY except for the dispute columns SD-M7-04 adds (see below).
CREATE TABLE identity_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_a     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  identity_b     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  link_kind      text NOT NULL,   -- shared_device, shared_payment,
                                  -- biometric_match, behavioural_correlation

  -- Evidence strength, never a boolean. ADR-022 made the graph SCORED: hard
  -- links auto-enforce, soft clusters queue a pre-funding review. A boolean
  -- edge cannot carry that distinction and would force every edge into one of
  -- the two behaviours.
  confidence_bp  integer NOT NULL CHECK (confidence_bp BETWEEN 0 AND 10000),

  -- The specific observations behind the edge. An edge without its evidence is
  -- an accusation without a reason.
  evidence       jsonb NOT NULL,
  created_by     text NOT NULL,   -- detector name, or 'admin'
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- SD-M7-04. INV-M7-09. Two housemates, a married couple sharing a card, and
  -- a father funding a son's evaluation all produce GENUINE edges between
  -- GENUINELY DIFFERENT humans. Without a dispute path the graph's errors are
  -- permanent and invisible to the person they harm, and ADR-022's soft-link
  -- queue makes the wrongly-linked-but-legitimate population LARGER, not
  -- smaller.
  --
  -- suppressed is the operative field: a suppressed edge stays visible as
  -- history and stops contributing to enforcement. The edge is never deleted,
  -- because "we decided this edge was wrong" is itself evidence.
  disputed_at    timestamptz NULL,                    -- SD-M7-04
  dispute_note   text NULL,                           -- SD-M7-04
  suppressed     boolean NOT NULL DEFAULT false,      -- SD-M7-04
  suppressed_by  text NULL,                           -- SD-M7-04

  -- An edge is stored once. Canonical ordering rather than a pair of rows,
  -- so "is there an edge between these two" is one lookup and cannot answer
  -- differently depending on argument order.
  CONSTRAINT identity_links_canonical_order CHECK (identity_a < identity_b),

  -- A suppression with no author is a suppression nobody owns.
  CONSTRAINT identity_links_suppression_has_author CHECK (
    suppressed = false OR suppressed_by IS NOT NULL
  )
);

CREATE UNIQUE INDEX identity_links_edge_uq
  ON identity_links (identity_a, identity_b, link_kind);
CREATE INDEX identity_links_a_idx ON identity_links (identity_a);
CREATE INDEX identity_links_b_idx ON identity_links (identity_b);

-- The enforcement read path: live edges only.
CREATE INDEX identity_links_live_idx
  ON identity_links (identity_a, identity_b) WHERE NOT suppressed;

-- -----------------------------------------------------------------------------
-- identity_merges
-- -----------------------------------------------------------------------------
-- APPEND-ONLY. Merging never deletes the merged identity row; it repoints
-- ownership and records this row, because the pre-merge history is what a
-- dispute about a grandfathered cap is argued from.
CREATE TABLE identity_merges (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surviving_identity_id  uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  merged_identity_id     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  reason                 text NOT NULL,
  evidence               jsonb NOT NULL,

  -- Supports the B4 #17 grandfather policy: over-cap after merge is
  -- grandfathered and NEW purchases are blocked. Recording the count at merge
  -- time is what makes that policy applicable years later, when the account
  -- count has moved for unrelated reasons.
  accounts_at_merge      integer NOT NULL CHECK (accounts_at_merge >= 0),

  actor                  text NOT NULL,   -- admin or detector
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identity_merges_distinct CHECK (
    surviving_identity_id <> merged_identity_id
  )
);

CREATE INDEX identity_merges_surviving_idx
  ON identity_merges (surviving_identity_id);
CREATE INDEX identity_merges_merged_idx
  ON identity_merges (merged_identity_id);

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
-- The authentication principal. One identity may own several users only
-- through a merge; the normal case is one to one.
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- citext so casing never creates a duplicate human.
  email              citext NOT NULL UNIQUE,

  -- Dots and plus-tags stripped: the entity-resolution key. Indexed but
  -- deliberately NOT unique. Two people can legitimately share a normalized
  -- form, so it is a SIGNAL, not a constraint, and making it unique would
  -- refuse service to the second of them.
  email_normalized   citext NOT NULL,

  email_verified_at  timestamptz NULL,
  country_code       char(2) NULL CHECK (country_code ~ '^[A-Z]{2}$'),

  -- Display only. Never used in rule math: the trading day comes from the
  -- exchange session calendar, never from a user's timezone (B4 #1).
  timezone           text NULL,

  marketing_consent  boolean NOT NULL DEFAULT false,
  last_login_at      timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_email_normalized_idx ON users (email_normalized);
CREATE INDEX users_identity_idx ON users (identity_id);

COMMENT ON COLUMN users.email_normalized IS
  'Entity-resolution key. NOT unique on purpose: two people can share a '
  'normalized form. A signal, never a constraint.';

-- -----------------------------------------------------------------------------
-- passkeys
-- -----------------------------------------------------------------------------
-- WebAuthn credentials. Merit is passwordless only, so THERE IS NO PASSWORD
-- TABLE ANYWHERE IN THIS SCHEMA, by design. Adding one is a security
-- architecture change requiring an ADR, not a convenience.
CREATE TABLE passkeys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  credential_id  bytea NOT NULL UNIQUE,
  public_key     bytea NOT NULL,

  -- Clone detection. A signature counter that goes backwards means the
  -- credential exists in two places.
  sign_count     bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),

  transports     text[] NULL,
  label          text NULL,       -- user-facing device name
  last_used_at   timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX passkeys_user_idx ON passkeys (user_id);

-- -----------------------------------------------------------------------------
-- otp_challenges
-- -----------------------------------------------------------------------------
CREATE TABLE otp_challenges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Issued before a user may exist, so this keys off the normalized email
  -- rather than a user_id.
  email_normalized  citext NOT NULL,

  -- NEVER store the code itself.
  code_hash         bytea NOT NULL,

  expires_at        timestamptz NOT NULL,      -- short TTL, 10 minutes
  consumed_at       timestamptz NULL,

  -- Lockout WITHOUT enabling user enumeration: the attempt counter is on the
  -- challenge, not on the account, so a locked-out attacker learns nothing
  -- about whether the address exists.
  attempts          smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),

  request_ip        inet NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX otp_challenges_email_created_idx
  ON otp_challenges (email_normalized, created_at DESC);

-- Single use, enforced by the database rather than by the handler.
CREATE UNIQUE INDEX otp_challenges_unconsumed_uq
  ON otp_challenges (id) WHERE consumed_at IS NULL;

COMMENT ON TABLE otp_challenges IS 'Retention: 30 days.';

-- -----------------------------------------------------------------------------
-- sessions
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Rotation on every refresh. The hash, never the token.
  refresh_token_hash     bytea NOT NULL UNIQUE,

  issued_at              timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  revoked_at             timestamptz NULL,
  ip                     inet NULL,
  user_agent             text NULL,

  -- Ties a session to the entity graph.
  device_fingerprint_id  uuid NULL REFERENCES identity_signals(id) ON DELETE RESTRICT,

  -- SD-M4-03. Account takeover leading to payout redirection is the
  -- highest-value attack on a trader account (SECURITY section 2.6). Three
  -- things need these columns and none of them work without all four:
  --
  --   1. The trader-visible active-sessions list. This is the control that
  --      lets the VICTIM act before the firm notices, which matters because
  --      the firm notices at the payout destination change and that is late.
  --   2. Revoking one session rather than all of them.
  --   3. The anomaly signal that a session MOVED COUNTRY mid-life (AS-M4-05),
  --      which is only expressible if the creation values and the last-seen
  --      values are separate columns rather than one overwritten pair.
  created_ip             inet NULL,          -- SD-M4-03
  created_user_agent     text NULL,          -- SD-M4-03
  last_seen_at           timestamptz NULL,   -- SD-M4-03
  last_seen_ip           inet NULL,          -- SD-M4-03

  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

-- The trader-visible list and the revocation path both read live sessions only.
CREATE INDEX sessions_live_idx
  ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS 'Retention: 90 days after expiry.';

COMMIT;
