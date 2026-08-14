-- =============================================================================
-- 0005_affiliate_program
-- =============================================================================
-- E2 READ: MONEY PATH, narrowly. One column in this file carries money:
-- affiliates.balance_cents (SD-M8-04). It is the carried balance a clawback
-- lands in, and it is the difference between a clawback that is enforceable
-- and one that is not. The rest of the file is the program's evidentiary
-- surface and carries no amounts.
--
-- The affiliate module is split across two migrations, and the reason is a
-- dependency rather than a design choice: coupons.affiliate_id needs
-- affiliates, purchases needs coupons, and attributions needs purchases. The
-- settlement half (attributions, commissions, statements) lands in 0012
-- alongside payment_disputes, which is also where it belongs semantically: a
-- chargeback is what triggers a clawback.
--
-- Deltas folded: SD-M8-02, SD-M8-03, SD-M8-04
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- affiliates
-- -----------------------------------------------------------------------------
CREATE TABLE affiliates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- An affiliate is an identity. That is what makes the self-deal check
  -- possible at all (B4 #16): the buyer and the referrer resolve to the same
  -- graph.
  identity_id             uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  code                    citext NOT NULL UNIQUE,

  -- Reserved for sub-IB trees, unused in v1. Two columns now against a
  -- restructure of a live commission table later.
  parent_id               uuid NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  level                   smallint NOT NULL DEFAULT 0 CHECK (level >= 0),

  commission_bp           integer NOT NULL CHECK (commission_bp BETWEEN 0 AND 10000),
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'closed')),

  -- NFA I-26-12: acceptance is versioned. An affiliate's obligations are the
  -- ones they accepted, on the day they accepted them.
  tos_version_id          uuid NOT NULL REFERENCES tos_versions(id) ON DELETE RESTRICT,

  -- Per-affiliate creative approval flag. SD-M8-03 gives it a record of WHAT
  -- was approved; this boolean stays as the fast gate.
  creative_approved       boolean NOT NULL DEFAULT false,

  -- Maintained on dispute webhooks. The affiliate-coordinated fraud signal
  -- from the adversary dossier: an affiliate whose referrals charge back is a
  -- different problem from an affiliate whose referrals refund.
  chargeback_rate_bp      integer NOT NULL DEFAULT 0
                            CHECK (chargeback_rate_bp BETWEEN 0 AND 10000),

  -- SD-M8-04. INV-M8-06. A CLAWBACK AFTER PAYMENT HAS TO LAND SOMEWHERE.
  --
  -- Without a carried balance the only options are chasing a refund or writing
  -- it off, and an affiliate who learns that clawbacks are unenforceable is an
  -- affiliate with a business model. SIGNED: negative is owed to Merit, which
  -- is the case this column exists for.
  balance_cents           bigint NOT NULL DEFAULT 0,               -- SD-M8-04

  -- SD-M8-04. The clock on a negative balance. A carried debt with no start
  -- date is one nobody escalates, and the escalation is the enforcement.
  negative_balance_since  date NULL,                               -- SD-M8-04

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- SD-M8-04. The two halves must agree in both directions. A negative balance
  -- with no start date has no clock; a start date with a cleared balance is a
  -- debt that was settled and left an alarm behind.
  CONSTRAINT affiliates_negative_balance_has_clock CHECK (
    (balance_cents < 0 AND negative_balance_since IS NOT NULL)
    OR
    (balance_cents >= 0 AND negative_balance_since IS NULL)
  ),

  CONSTRAINT affiliates_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX affiliates_identity_idx ON affiliates (identity_id);
CREATE INDEX affiliates_status_idx ON affiliates (status) WHERE status <> 'active';

-- The collections queue. Reads the debt, oldest first.
CREATE INDEX affiliates_in_debt_idx
  ON affiliates (negative_balance_since) WHERE balance_cents < 0;

COMMENT ON COLUMN affiliates.balance_cents IS
  'SD-M8-04. Signed integer cents. Negative is owed to Merit, which is the '
  'case this column exists for. Never a float.';

-- -----------------------------------------------------------------------------
-- affiliate_creatives                                           -- SD-M8-03
-- -----------------------------------------------------------------------------
-- INV-M8-08. affiliates.creative_approved is a boolean with no record of WHAT
-- was approved, which is worthless in a compliance conversation. NFA I-26-12
-- requires the disclosure to accompany the claim, and that is a PER-CREATIVE
-- fact: one approved landing page says nothing about the video posted three
-- months later.
CREATE TABLE affiliate_creatives (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id          uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,

  kind                  text NOT NULL CHECK (kind IN (
                          'landing', 'video', 'post', 'email', 'other'
                        )),

  -- The URL, or a storage reference for something that has none. Merit
  -- reviews what it can reach.
  url_or_ref            text NOT NULL,

  submitted_at          timestamptz NOT NULL DEFAULT now(),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'approved', 'rejected', 'withdrawn'
                        )),
  reviewed_by           text NULL,
  reviewed_at           timestamptz NULL,

  -- Which disclosure version accompanied this claim. The disclosure is the
  -- compliance artifact and it moves; pinning it per creative is what makes a
  -- 2027 review of a 2026 post answerable.
  disclosure_version_id uuid NULL REFERENCES tos_versions(id) ON DELETE RESTRICT,

  notes                 text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- A decided creative carries its reviewer and its date.
  CONSTRAINT affiliate_creatives_decision_has_author CHECK (
    status NOT IN ('approved', 'rejected')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),

  -- An approved creative carries the disclosure it was approved with. This is
  -- the constraint that makes INV-M8-08 hold rather than merely be asserted.
  CONSTRAINT affiliate_creatives_approved_has_disclosure CHECK (
    status <> 'approved' OR disclosure_version_id IS NOT NULL
  )
);

CREATE INDEX affiliate_creatives_affiliate_idx
  ON affiliate_creatives (affiliate_id, submitted_at DESC);

-- The review queue.
CREATE INDEX affiliate_creatives_pending_idx
  ON affiliate_creatives (submitted_at) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- affiliate_clicks
-- -----------------------------------------------------------------------------
-- 30-day cookie window. High volume, never in a URL, so bigint identity.
CREATE TABLE affiliate_clicks (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  affiliate_id       uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  click_token        uuid NOT NULL DEFAULT gen_random_uuid(),
  ip                 inet NULL,
  user_agent         text NULL,
  landing_path       text NULL,
  clicked_at         timestamptz NOT NULL DEFAULT now(),

  -- SD-M8-02. Last-touch attribution with a 30 day window is STEALABLE BY
  -- VOLUME, and the theft is invisible without knowing where a click came
  -- from. These four fields are the difference between detecting cookie
  -- stuffing and paying for it (AS-M8-03).
  --
  -- referrer_host is the single highest-value one: a click with no referrer
  -- arriving at a deep product path is the signature of an injected pixel
  -- rather than a person who read something and followed a link.
  referrer_host      text NULL,                                    -- SD-M8-02
  landing_is_direct  boolean NOT NULL DEFAULT false,               -- SD-M8-02
  click_fingerprint  bytea NULL,                                   -- SD-M8-02

  -- Set by the detector, not by the click handler. Null means "not examined",
  -- which is a different state from "examined and clean".
  suspicious_reason  text NULL,                                    -- SD-M8-02

  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliate_clicks_token_uq ON affiliate_clicks (click_token);
CREATE INDEX affiliate_clicks_affiliate_time_idx
  ON affiliate_clicks (affiliate_id, clicked_at DESC);

-- SD-M8-02. The stuffing detector's read path: volume by referrer per
-- affiliate per window.
CREATE INDEX affiliate_clicks_referrer_idx
  ON affiliate_clicks (affiliate_id, referrer_host, clicked_at DESC);

-- SD-M8-02. The review queue for flagged clicks.
CREATE INDEX affiliate_clicks_suspicious_idx
  ON affiliate_clicks (clicked_at) WHERE suspicious_reason IS NOT NULL;

COMMENT ON TABLE affiliate_clicks IS 'Retention: 12 months.';

COMMIT;
