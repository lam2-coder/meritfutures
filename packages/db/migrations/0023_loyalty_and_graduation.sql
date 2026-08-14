-- =============================================================================
-- 0023_loyalty_and_graduation
-- =============================================================================
-- Not a money-path file by table, and it sits directly beside one, so the
-- boundary is stated first and stated hard:
--
--   ADR-025 REJECTED PROGRESSIVE CAP RELEASE FOR V1 RATHER THAN DEFERRING IT.
--   NO LOYALTY BENEFIT MOVES A PER-ACCOUNT BOUND (INV-M14-11, INV-M14-12).
--   There is no benefit_code here that can raise a cap, lengthen a ladder, or
--   change a gate, and there is no column for one. A cap edit is a cap edit
--   regardless of the word "loyalty" (INV-M14-02), and it goes through the
--   dual-controlled publish path or it does not happen.
--
--   The arithmetic behind the rejection is worth carrying: on the 5-rung
--   ladder ADR-024 established, the market's own mechanic ("after five payouts
--   your cap goes up") is STRUCTURALLY IMPOSSIBLE, because five payouts is the
--   whole ladder. Release at ordinal 5 costs +20 percent of the lifetime bound
--   to deliver ONE raised payout at the end of an account's life; release from
--   ordinal 4 costs +40 percent. A shorter ladder did not make cap release
--   safer; it eliminated the cheap version and left only the expensive ones.
--
-- What loyalty may do instead is cross-account: reset discounts, promotional
-- credit (NEVER WITHDRAWABLE, OQ-FREEZE-01), and review-pool priority.
--
-- Three things worth the careful read:
--
--   1. SD-M14-01 stores a DERIVED state per day rather than a mutable balance,
--      which is what makes "nobody granted this by hand" CHECKABLE: the state
--      is reproducible from the event stream and a divergence is a TAMPER
--      INDICATION.
--   2. SD-M14-02's criteria_version. A criteria change must not silently
--      rewrite what past traders were promised. That is the FundingTicks
--      failure, and it is the one this schema is built to make impossible.
--   3. SD-M14-03's breaks_on is ENUMERATED EXPLICITLY rather than implied,
--      because "what breaks my streak" is the question a trader asks AFTER it
--      breaks, and answering it then is too late (AS-M14-07).
--
-- Deltas folded: SD-M14-01, SD-M14-02, SD-M14-03, SD-M18-02
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- loyalty_criteria                                              -- SD-M14-03
-- -----------------------------------------------------------------------------
-- INV-M14-07. The same versioned-definition discipline M12 uses for
-- statistics, applied to PROMISES.
CREATE TABLE loyalty_criteria (
  benefit_code    text NOT NULL,
  version         integer NOT NULL CHECK (version > 0),
  title           text NOT NULL,
  criteria_spec   jsonb NOT NULL,
  terms_body_mdx  text NOT NULL,
  expiry_rule     text NOT NULL,

  -- SD-M14-03. ENUMERATED, not implied. Each entry names a fact that ends a
  -- streak or forfeits an accrual.
  breaks_on       text[] NOT NULL DEFAULT '{}',                   -- SD-M14-03

  effective_from  date NOT NULL,
  superseded_by   text NULL,   -- benefit_code of the successor, when renamed
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (benefit_code, version)
);

CREATE INDEX loyalty_criteria_effective_idx
  ON loyalty_criteria (benefit_code, effective_from DESC);

COMMENT ON TABLE loyalty_criteria IS
  'SD-M14-03. Versioned promises. No criteria_spec may reference a per-account '
  'bound: caps, ladders and gates are not loyalty surface (ADR-025, '
  'INV-M14-11).';

-- -----------------------------------------------------------------------------
-- loyalty_states                                                -- SD-M14-01
-- -----------------------------------------------------------------------------
-- INV-M14-03. DERIVED PER DAY, NEVER A MUTABLE BALANCE.
--
-- A mutable counter cannot be explained to a trader and cannot be audited: it
-- says what it says. A derived state reproduces from the event stream, so a
-- tier change is explicable and a hand edit is visible as a divergence.
CREATE TABLE loyalty_states (
  identity_id                uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  as_of_trading_day          date NOT NULL,

  payouts_lifetime           integer NOT NULL CHECK (payouts_lifetime >= 0),
  consecutive_payout_cycles  integer NOT NULL CHECK (consecutive_payout_cycles >= 0),
  accounts_funded_lifetime   integer NOT NULL CHECK (accounts_funded_lifetime >= 0),

  -- Already inside SD-M14-01's column list. It is NOT a separate delta, and it
  -- is recorded here because the corpus once called it an addition
  -- (DELTA_MANIFEST section 7).
  --
  -- This is the counter the cross-account programme keys off: the Nth
  -- COMPLETED LADDER earns reset discounts, promotional credit and review-pool
  -- priority. Nothing per-account moves.
  ladders_completed_lifetime integer NOT NULL DEFAULT 0
                               CHECK (ladders_completed_lifetime >= 0),

  resets_lifetime            integer NOT NULL CHECK (resets_lifetime >= 0),
  tenure_days                integer NOT NULL CHECK (tenure_days >= 0),

  derivation_version         integer NOT NULL CHECK (derivation_version > 0),

  -- The tamper indication. Recompute, compare, and a mismatch is a finding.
  inputs_digest              bytea NOT NULL,

  created_at                 timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (identity_id, as_of_trading_day),

  -- A completed ladder is at most one per funded account, and every payout in
  -- it is a lifetime payout. Both bounds are arithmetic rather than policy.
  CONSTRAINT loyalty_states_ladders_within_accounts CHECK (
    ladders_completed_lifetime <= accounts_funded_lifetime
  ),
  CONSTRAINT loyalty_states_cycles_within_payouts CHECK (
    consecutive_payout_cycles <= payouts_lifetime
  )
);

CREATE INDEX loyalty_states_identity_idx
  ON loyalty_states (identity_id, as_of_trading_day DESC);

-- -----------------------------------------------------------------------------
-- loyalty_benefit_grants                                        -- SD-M14-02
-- -----------------------------------------------------------------------------
-- INV-M14-07 and INV-M14-09.
--
-- criteria_version is what stops a criteria change silently rewriting what
-- past traders were promised. consumed_ref points at the M17 offer or the M03
-- purchase that used it, SO A BENEFIT CANNOT BE SPENT TWICE.
CREATE TABLE loyalty_benefit_grants (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id            uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  benefit_code           text NOT NULL,

  -- WHICH PUBLISHED CRITERIA VERSION EARNED IT. FK to the pair, so a grant can
  -- never cite a version that was never published.
  criteria_version       integer NOT NULL,                        -- SD-M14-02

  earned_on_trading_day  date NOT NULL,
  expires_at             timestamptz NULL,

  -- Polymorphic: an offer id or a purchase id. Not a foreign key because it is
  -- two kinds; the single-spend guarantee is the partial unique index below.
  consumed_at            timestamptz NULL,
  consumed_ref           uuid NULL,                               -- SD-M14-02

  revoked_at             timestamptz NULL,
  revoked_reason         text NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT loyalty_benefit_grants_criteria_fk
    FOREIGN KEY (benefit_code, criteria_version)
    REFERENCES loyalty_criteria (benefit_code, version) ON DELETE RESTRICT,

  CONSTRAINT loyalty_benefit_grants_consumption_is_complete CHECK (
    (consumed_at IS NULL AND consumed_ref IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_ref IS NOT NULL)
  ),

  CONSTRAINT loyalty_benefit_grants_revocation_is_explained CHECK (
    revoked_at IS NULL OR revoked_reason IS NOT NULL
  ),

  -- A revoked benefit was not also spent. If both happened, one of them is
  -- wrong and the write should fail rather than the accounting.
  CONSTRAINT loyalty_benefit_grants_not_both_consumed_and_revoked CHECK (
    consumed_at IS NULL OR revoked_at IS NULL
  )
);

-- SD-M14-02. A BENEFIT CANNOT BE SPENT TWICE: one grant per consuming
-- reference.
CREATE UNIQUE INDEX loyalty_benefit_grants_consumed_ref_uq
  ON loyalty_benefit_grants (consumed_ref) WHERE consumed_ref IS NOT NULL;

CREATE INDEX loyalty_benefit_grants_identity_idx
  ON loyalty_benefit_grants (identity_id, earned_on_trading_day DESC);

-- The trader's usable set, and the expiry sweep.
CREATE INDEX loyalty_benefit_grants_live_idx
  ON loyalty_benefit_grants (identity_id, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- graduation_benefits                                           -- SD-M18-02
-- -----------------------------------------------------------------------------
-- INV-M18-06 and INV-M18-10.
--
-- accrued_cents WITH A STATED basis is what stops a vault display becoming a
-- PROJECTION. A number on a screen with no stated derivation is read as a
-- promise, and the trader is not wrong to read it that way.
--
-- withheld_reason lets the risk review hold a benefit WITHOUT SILENTLY
-- DROPPING IT, which is the difference between a decision and a disappearance.
CREATE TABLE graduation_benefits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id      uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  benefit_code     text NOT NULL,

  accrued_cents    bigint NOT NULL CHECK (accrued_cents >= 0),

  -- NOT NULL. How accrued_cents was derived, in words a trader can check.
  basis            text NOT NULL,                                 -- SD-M18-02

  conferred_at     timestamptz NULL,
  withheld_reason  text NULL,                                     -- SD-M18-02
  criteria_version integer NOT NULL CHECK (criteria_version > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- A benefit is conferred, or withheld with a reason, never both and never
  -- silently neither once it is decided.
  CONSTRAINT graduation_benefits_not_both_conferred_and_withheld CHECK (
    conferred_at IS NULL OR withheld_reason IS NULL
  )
);

CREATE INDEX graduation_benefits_identity_idx ON graduation_benefits (identity_id);
CREATE INDEX graduation_benefits_account_idx ON graduation_benefits (account_id);

-- The review queue: accrued, not yet conferred, not withheld.
CREATE INDEX graduation_benefits_pending_idx
  ON graduation_benefits (created_at)
  WHERE conferred_at IS NULL AND withheld_reason IS NULL;

COMMIT;
