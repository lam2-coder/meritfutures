-- =============================================================================
-- 0024_offers
-- =============================================================================
-- E2 READ: MONEY PATH. Offers change prices, and one table here mints value.
-- Four things need the founder's line-by-line read:
--
--   1. SD-M17-04's `varies` CHECK IS THE SCHEMA ENFORCING THE RULE. There is
--      NO ENUM VALUE FOR A RULE, A GATE, OR A PLAN PARAMETER, so an experiment
--      that varies one CANNOT BE WRITTEN DOWN, let alone run (AS-M17-07). The
--      three permitted values are price, presentation and bundle_contents, and
--      adding a fourth is an ADR.
--   2. SD-M17-02's price_floors. Stacking arithmetic needs A HARD STOP THAT IS
--      NOT "the sum of the discounts we happened to configure", and the floor
--      for a Direct plan is a LIABILITY decision rather than a margin one,
--      which is why it carries a written reason and an approver. A Direct
--      account is funded on purchase: its price is the only thing standing
--      between the firm and immediate exposure.
--   3. SD-M17-01's `contents` IS EXPLICIT RATHER THAN DERIVED, because
--      ADR-019a requires STATED CONTENTS BEFORE PAYMENT, and a bundle whose
--      contents are computed at redemption is a bundle whose contents were not
--      stated. list_price_cents is stored beside price_cents so the discount
--      is A FACT rather than a comparison against a value that may since have
--      moved.
--   4. SD-M17-03's promotional_credit_grants. A CREDIT NEEDS TO KNOW WHAT
--      FUNDED IT, or a chargeback cannot claw back the credit it paid for
--      (AS-M17-06). The ledger records the money; this table records the
--      ENTITLEMENT'S PROVENANCE AND EXPIRY.
--
--      And the standing constraint from OQ-FREEZE-01: promotional credit is
--      NEVER WITHDRAWABLE. It is not wallet value, it has its own ledger class
--      (0009), and it never appears in wallet_entries.provenance (0011).
--
-- Deltas folded: SD-M17-01, SD-M17-02, SD-M17-03, SD-M17-04
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- offer_experiments                                             -- SD-M17-04
-- -----------------------------------------------------------------------------
-- INV-M17-07. Created first because offers.experiment_arm references it.
CREATE TABLE offer_experiments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  hypothesis  text NOT NULL,
  arms        jsonb NOT NULL,

  -- THE RULE, IN DDL. An experiment may vary what a thing COSTS, how it is
  -- SHOWN, or what is IN it. It may never vary a rule, a gate, or a plan
  -- parameter, and the enum has no value that would let it try.
  --
  -- This is the constraint that makes "we do not A/B test the rulebook" a
  -- structural fact rather than a policy someone has to remember under
  -- conversion pressure.
  varies      text NOT NULL CHECK (varies IN (
                'price', 'presentation', 'bundle_contents'
              )),                                                 -- SD-M17-04

  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz NULL,
  winner_arm  text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT offer_experiments_winner_needs_end CHECK (
    winner_arm IS NULL OR ended_at IS NOT NULL
  )
);

CREATE INDEX offer_experiments_live_idx ON offer_experiments (started_at)
  WHERE ended_at IS NULL;

COMMENT ON COLUMN offer_experiments.varies IS
  'SD-M17-04. There is no enum value for a rule, a gate, or a plan parameter. '
  'Adding one requires an ADR (AS-M17-07).';

-- -----------------------------------------------------------------------------
-- price_floors                                                  -- SD-M17-02
-- -----------------------------------------------------------------------------
-- INV-M17-05, INV-M17-12. Dual controlled: the floor is set through the
-- dual-controlled publish path (0016's dual_control_approvals), and the row
-- records who approved it.
CREATE TABLE price_floors (
  product_ref     text NOT NULL,
  floor_cents     bigint NOT NULL CHECK (floor_cents >= 0),

  -- NOT NULL. For a Direct plan this is a liability decision, and a liability
  -- decision with no written rationale is one nobody can defend at the next
  -- review.
  reason          text NOT NULL,                                  -- SD-M17-02
  effective_from  timestamptz NOT NULL,
  approved_by     text NOT NULL,                                  -- SD-M17-02
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (product_ref, effective_from)
);

CREATE INDEX price_floors_current_idx
  ON price_floors (product_ref, effective_from DESC);

-- -----------------------------------------------------------------------------
-- offers                                                        -- SD-M17-01
-- -----------------------------------------------------------------------------
-- INV-M17-02, INV-M17-03. AN OFFER CHANGES THE PRICE OF A KNOWN THING AND MAY
-- NEVER CHANGE THE THING.
CREATE TABLE offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_type        text NOT NULL,

  scope             text NOT NULL CHECK (scope IN ('identity', 'segment', 'public')),
  identity_id       uuid NULL REFERENCES identities(id) ON DELETE RESTRICT,

  product_ref       text NOT NULL,

  -- STATED CONTENTS BEFORE PAYMENT (ADR-019a). Explicit, never derived at
  -- redemption.
  contents          jsonb NOT NULL,                               -- SD-M17-01

  price_cents       bigint NOT NULL CHECK (price_cents >= 0),

  -- Stored so the discount is a FACT rather than a comparison against a value
  -- that may since have moved.
  list_price_cents  bigint NOT NULL CHECK (list_price_cents >= 0), -- SD-M17-01

  currency          char(3) NOT NULL DEFAULT 'USD',

  max_redemptions   integer NULL CHECK (max_redemptions > 0),
  redemptions_used  integer NOT NULL DEFAULT 0 CHECK (redemptions_used >= 0),
  expires_at        timestamptz NULL,

  -- Which loyalty criteria version, and which grant, produced this offer. Both
  -- nullable because most offers are not loyalty-derived.
  criteria_version  integer NULL,
  loyalty_grant_id  uuid NULL REFERENCES loyalty_benefit_grants(id)
                      ON DELETE RESTRICT,

  experiment_arm    text NULL,
  experiment_id     uuid NULL REFERENCES offer_experiments(id) ON DELETE RESTRICT,

  created_by        text NOT NULL,
  revoked_at        timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- An identity-scoped offer names its identity; a public one does not.
  CONSTRAINT offers_identity_scope_matches CHECK (
    (scope = 'identity' AND identity_id IS NOT NULL)
    OR
    (scope <> 'identity' AND identity_id IS NULL)
  ),

  -- An offer may discount. It may not mark up: a price above list is not an
  -- offer, it is a different product wearing one's clothes.
  CONSTRAINT offers_price_within_list CHECK (price_cents <= list_price_cents),

  CONSTRAINT offers_redemptions_within_max CHECK (
    max_redemptions IS NULL OR redemptions_used <= max_redemptions
  ),

  -- An arm without an experiment is an arm of nothing.
  CONSTRAINT offers_arm_has_experiment CHECK (
    experiment_arm IS NULL OR experiment_id IS NOT NULL
  )
);

CREATE INDEX offers_identity_idx
  ON offers (identity_id, expires_at) WHERE identity_id IS NOT NULL;
CREATE INDEX offers_live_idx
  ON offers (product_ref, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX offers_experiment_idx
  ON offers (experiment_id) WHERE experiment_id IS NOT NULL;

-- SD-M17-01. One offer per loyalty grant: the grant's single-spend guarantee
-- (0023) and this index are the two halves of "a benefit cannot be spent
-- twice".
CREATE UNIQUE INDEX offers_loyalty_grant_uq
  ON offers (loyalty_grant_id) WHERE loyalty_grant_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- promotional_credit_grants                                     -- SD-M17-03
-- -----------------------------------------------------------------------------
-- INV-M17-08, INV-M17-11.
--
-- NEVER WITHDRAWABLE (OQ-FREEZE-01, overruling ADR-025's literal wording and
-- confirming the implementation). Promotional credit is rendered inside the
-- wallet screen and is NOT wallet value: it has its own ledger class
-- (promotional_credit, 0009) and no wallet_entries.provenance value (0011).
-- The invariant guard caught the wording error and this is where it lands.
--
-- funding_purchase_id is the delta's real content. A CREDIT NEEDS TO KNOW WHAT
-- FUNDED IT, or a chargeback cannot claw back the credit it paid for
-- (AS-M17-06): the purchase reverses, the credit stays, and the trader spends
-- money the firm never received.
CREATE TABLE promotional_credit_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id         uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),

  source_offer_id     uuid NULL REFERENCES offers(id) ON DELETE RESTRICT,
  funding_purchase_id uuid NULL REFERENCES purchases(id) ON DELETE RESTRICT,  -- SD-M17-03

  -- NOT NULL. Promotional credit expires; that is what distinguishes it from
  -- a payable. An unexpiring promotional balance is a liability wearing a
  -- marketing label, and it is also an escheatment question nobody wants.
  expires_at          timestamptz NOT NULL,                       -- SD-M17-03

  consumed_cents      bigint NOT NULL DEFAULT 0 CHECK (consumed_cents >= 0),
  revoked_at          timestamptz NULL,
  revoked_reason      text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- A grant cannot be spent past its own size.
  CONSTRAINT promotional_credit_grants_consumed_within_amount CHECK (
    consumed_cents <= amount_cents
  ),

  CONSTRAINT promotional_credit_grants_revocation_is_explained CHECK (
    revoked_at IS NULL OR revoked_reason IS NOT NULL
  )
);

CREATE INDEX promotional_credit_grants_identity_idx
  ON promotional_credit_grants (identity_id, expires_at);

-- SD-M17-03. The clawback read: every credit a given purchase funded, which is
-- the query a chargeback runs.
CREATE INDEX promotional_credit_grants_funding_idx
  ON promotional_credit_grants (funding_purchase_id)
  WHERE funding_purchase_id IS NOT NULL;

-- The spendable set, and the expiry sweep.
CREATE INDEX promotional_credit_grants_live_idx
  ON promotional_credit_grants (identity_id, expires_at)
  WHERE revoked_at IS NULL AND consumed_cents < amount_cents;

COMMENT ON TABLE promotional_credit_grants IS
  'SD-M17-03. NEVER WITHDRAWABLE (OQ-FREEZE-01). Its own ledger class, and no '
  'wallet_entries provenance value. The ledger records the money; this records '
  'the entitlement''s provenance and expiry.';

COMMIT;
