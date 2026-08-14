-- =============================================================================
-- 0006_commerce
-- =============================================================================
-- E2 READ: MONEY PATH. This is where money first enters the system. Four
-- things need the founder's line-by-line read:
--
--   1. THE WALLET AS A PAYMENT METHOD (SD-M3-06). Without an explicit method
--      the wallet path is indistinguishable from a PSP purchase whose webhook
--      never arrived, which is exactly the state FM-M3-01 pages on. The
--      constraints below make 'psp' with a wallet debit unrepresentable.
--   2. THE PRICE ARITHMETIC. list - discount = paid, and paid = psp leg +
--      wallet leg. Both are CHECK constraints, both in integer cents.
--   3. THE COUPON CLAIM RACE. coupon_redemptions' partial unique index IS the
--      race decision (B4 #11). Two tabs cannot both win a single-use code
--      because the claim insert is the race and the index decides it.
--   4. mid_health's thresholds (SD-M3-03) are computed against CARD volume,
--      never total volume. See the comment on that table: getting this wrong
--      makes a healthy shift to wallet funding look like a deteriorating
--      chargeback ratio and trips failover for no reason at all.
--
-- Deltas folded: SD-M3-01, SD-M3-02, SD-M3-03, SD-M3-04, SD-M3-05, SD-M3-06,
--                SD-M4-02
--
-- Two columns here are created without their foreign key, because they close
-- genuine reference cycles rather than because a delta is being applied later:
--   * purchases.parent_account_id          -> fk added in 0007_accounts
--   * purchases.wallet_ledger_transaction_id -> fk added in 0011_wallet
-- Both are recorded in DELTA_MANIFEST section 1.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- coupons
-- -----------------------------------------------------------------------------
CREATE TABLE coupons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                citext NOT NULL UNIQUE,   -- citext: case-insensitive redemption

  discount_kind       text NOT NULL CHECK (discount_kind IN ('percent', 'fixed')),
  discount_bp         integer NULL CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_cents      bigint NULL CHECK (discount_cents > 0),

  affiliate_id        uuid NULL REFERENCES affiliates(id) ON DELETE RESTRICT,

  max_redemptions     integer NULL CHECK (max_redemptions > 0),  -- null: unlimited
  redemption_count    integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),

  -- Blocks one person farming a code. Per IDENTITY, not per email: an email
  -- limit is a limit on typing, not on people.
  per_identity_limit  integer NOT NULL DEFAULT 1 CHECK (per_identity_limit > 0),

  starts_at           timestamptz NULL,
  expires_at          timestamptz NULL,
  is_active           boolean NOT NULL DEFAULT true,

  -- SD-M3-04. Reset pricing and new-purchase pricing are DIFFERENT PRODUCTS
  -- WITH DIFFERENT MARGINS. Without this, one leaked launch code discounts
  -- resets forever, which is the highest-volume repeat purchase in the
  -- business (AS-M3-04).
  --
  -- applies_to_kind has no default in the application: M03 requires it stated
  -- explicitly at creation rather than defaulted silently, because a default
  -- of 'any' is exactly the leak. The column default here exists only so the
  -- constraint is total; the create path supplies it.
  applies_to_kind     text NOT NULL DEFAULT 'any'
                        CHECK (applies_to_kind IN ('new', 'reset', 'any')),  -- SD-M3-04
  first_purchase_only boolean NOT NULL DEFAULT false,                        -- SD-M3-04

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Exactly one of the two discount forms. A coupon that is both is a coupon
  -- whose price depends on which branch the code reads first.
  CONSTRAINT coupons_one_discount_form CHECK (
    (discount_kind = 'percent' AND discount_bp IS NOT NULL AND discount_cents IS NULL)
    OR
    (discount_kind = 'fixed' AND discount_cents IS NOT NULL AND discount_bp IS NULL)
  ),

  CONSTRAINT coupons_window_ordered CHECK (
    starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at
  ),

  CONSTRAINT coupons_redemptions_within_max CHECK (
    max_redemptions IS NULL OR redemption_count <= max_redemptions
  )
);

CREATE INDEX coupons_affiliate_idx ON coupons (affiliate_id) WHERE affiliate_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- purchases
-- -----------------------------------------------------------------------------
CREATE TABLE purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id                 uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- Who clicked, versus who they are. Both, because they can differ after a
  -- merge and the difference is evidence.
  user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- PINS THE CONTRACT AT PURCHASE TIME (B4 #12). The account's rules are the
  -- rules on the day it was bought, forever.
  plan_version_id             uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,

  size_cents                  bigint NOT NULL CHECK (size_cents > 0),
  kind                        text NOT NULL CHECK (kind IN ('new', 'reset')),

  -- Set for resets. FK added in 0007_accounts: purchases and accounts
  -- reference each other, and the cycle has to open somewhere.
  parent_account_id           uuid NULL,

  list_price_cents            bigint NOT NULL CHECK (list_price_cents >= 0),
  discount_cents              bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  amount_paid_cents           bigint NOT NULL CHECK (amount_paid_cents >= 0),

  -- Reserved for multi-currency, NEVER used in v1 math (Wave 2 gate ruling 5).
  currency                    char(3) NOT NULL DEFAULT 'USD',

  coupon_id                   uuid NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  affiliate_id                uuid NULL REFERENCES affiliates(id) ON DELETE RESTRICT,

  psp                         text NOT NULL CHECK (psp IN ('psp_a', 'psp_b')),
  psp_reference               text NOT NULL,
  mid_reference               text NULL,   -- the specific merchant account

  status                      purchase_status NOT NULL DEFAULT 'pending',
  paid_at                     timestamptz NULL,
  ip                          inet NULL,

  -- SD-M3-02. Constitution M3 sets the refund window at "pre-first-trade
  -- only". That is A FACT ABOUT TRADING, so it has to be recorded on the
  -- purchase when M02 sees the first fill, or the refund policy is
  -- unenforceable and becomes a support argument. first_trade_at is the
  -- evidence a refusal is made with (FM-M3-10).
  refundable_until            timestamptz NULL,                    -- SD-M3-02
  first_trade_at              timestamptz NULL,                    -- SD-M3-02

  -- SD-M3-05. The geo / document / payment country triangle is an M19 and M07
  -- input, and THE DECISION MERIT MADE AT CHECKOUT MUST BE RECORDED AT
  -- CHECKOUT. Reconstructing it later from an IP log is not the same artifact:
  -- it tells you where they were, not what we decided.
  checkout_ip_country         char(2) NULL,                        -- SD-M3-05
  card_country                char(2) NULL,                        -- SD-M3-05
  geo_decision                text NULL CHECK (
                                geo_decision IN ('allowed', 'warned', 'blocked')
                              ),                                   -- SD-M3-05

  -- SD-M3-06. ADR-019. The wallet as a checkout payment method.
  --
  -- 'mixed' exists because a trader with $60 in the wallet buying a $99
  -- evaluation is THE COMMON CASE, not an edge one, and forcing them to choose
  -- one funding source is a conversion cost with no compensating benefit.
  --
  -- The wallet leg is SERVER-COMPUTED from the identity's balance and is never
  -- supplied by the client, for the same reason no price is.
  payment_method              text NOT NULL DEFAULT 'psp' CHECK (
                                payment_method IN ('psp', 'wallet', 'mixed')
                              ),                                   -- SD-M3-06
  wallet_debit_cents          bigint NOT NULL DEFAULT 0
                                CHECK (wallet_debit_cents >= 0),   -- SD-M3-06

  -- FK added in 0011_wallet: ledger_transactions is created in 0009, which is
  -- after this file because accounts must precede 0010_payouts.
  wallet_ledger_transaction_id uuid NULL,                          -- SD-M3-06

  -- SD-M4-02. M03's AS-M3-05 requires a reset onto a CHANGED plan version to
  -- be explicitly acknowledged. M04 renders the diff and captures the
  -- acknowledgement, and this timestamp is the artifact that settles the
  -- dispute later. A reset is a new contract, and a trader who did not notice
  -- is a trader who was not told.
  rule_diff_acknowledged_at   timestamptz NULL,                    -- SD-M4-02

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- The price arithmetic, in integer cents.
  CONSTRAINT purchases_price_arithmetic CHECK (
    amount_paid_cents = list_price_cents - discount_cents
  ),
  CONSTRAINT purchases_discount_within_list CHECK (
    discount_cents <= list_price_cents
  ),

  -- SD-M3-06. The funding legs must add up and must match the declared method.
  -- These three constraints together make "a wallet purchase that looks like a
  -- stalled PSP purchase" unrepresentable, which is the whole point of the
  -- delta.
  CONSTRAINT purchases_wallet_leg_matches_method CHECK (
    (payment_method = 'psp'    AND wallet_debit_cents = 0)
    OR
    (payment_method = 'wallet' AND wallet_debit_cents = amount_paid_cents
                               AND amount_paid_cents > 0)
    OR
    (payment_method = 'mixed'  AND wallet_debit_cents > 0
                               AND wallet_debit_cents < amount_paid_cents)
  ),

  -- A wallet debit that posted no ledger transaction is money that moved
  -- outside the ledger.
  CONSTRAINT purchases_wallet_debit_is_posted CHECK (
    wallet_debit_cents = 0 OR wallet_ledger_transaction_id IS NOT NULL
  ),

  -- A reset references the account it resets; a new purchase does not.
  CONSTRAINT purchases_reset_has_parent CHECK (
    (kind = 'reset' AND parent_account_id IS NOT NULL)
    OR
    (kind = 'new' AND parent_account_id IS NULL)
  ),

  CONSTRAINT purchases_paid_has_timestamp CHECK (
    status <> 'paid' OR paid_at IS NOT NULL
  )
);

-- THE IDEMPOTENCY ANCHOR FOR WEBHOOKS. Duplicate and out-of-order delivery
-- (B4 #9) is defeated here and in psp_webhook_events, not in a handler.
CREATE UNIQUE INDEX purchases_psp_reference_uq ON purchases (psp, psp_reference);

CREATE INDEX purchases_identity_created_idx
  ON purchases (identity_id, created_at DESC);

-- The paid-not-provisioned alarm query.
CREATE INDEX purchases_pending_idx
  ON purchases (created_at) WHERE status = 'pending';

-- SD-M3-02. The refund-window closer: purchases still inside their window.
CREATE INDEX purchases_refundable_idx
  ON purchases (refundable_until)
  WHERE first_trade_at IS NULL AND refundable_until IS NOT NULL;

CREATE INDEX purchases_parent_account_idx
  ON purchases (parent_account_id) WHERE parent_account_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- coupon_redemptions
-- -----------------------------------------------------------------------------
-- THIS TABLE IS WHY TWO TABS CANNOT BOTH WIN A SINGLE-USE CODE. Redemption is
-- an ATOMIC CLAIM, never a read-then-write (B4 #11): the claim insert is the
-- race, and the partial unique index below decides it.
CREATE TABLE coupon_redemptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id    uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,

  -- Limits are per identity, not per email.
  identity_id  uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- Null while the claim is HELD and the payment is in flight.
  purchase_id  uuid NULL REFERENCES purchases(id) ON DELETE RESTRICT,

  claimed_at   timestamptz NOT NULL DEFAULT now(),

  -- Claim released if payment fails. The row survives, so a pattern of
  -- claim-and-abandon is visible rather than erased.
  released_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Enforces the per-identity limit of one AT THE DATABASE LEVEL when the limit
-- is 1, which is every launch code. Limits above 1 are checked
-- transactionally against redemption_count in the same statement.
CREATE UNIQUE INDEX coupon_redemptions_live_claim_uq
  ON coupon_redemptions (coupon_id, identity_id) WHERE released_at IS NULL;

CREATE INDEX coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_id);

-- -----------------------------------------------------------------------------
-- psp_webhook_events
-- -----------------------------------------------------------------------------
-- Raw, signed, immutable inbound payment events. Kept SEPARATELY from events
-- because these are THIRD-PARTY ASSERTIONS, not facts we generated, and the
-- distinction matters the day one of them turns out to be wrong.
CREATE TABLE psp_webhook_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  psp                text NOT NULL,
  provider_event_id  text NOT NULL,
  event_type         text NOT NULL,

  -- RECORDED, NOT ASSUMED. A payload whose signature did not verify is still
  -- stored, and stored with the fact that it did not verify.
  signature_verified boolean NOT NULL,

  payload            jsonb NOT NULL,   -- as received
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz NULL,
  processing_result  text NULL CHECK (processing_result IN (
                       'applied', 'duplicate_ignored',
                       'out_of_order_deferred', 'rejected_signature'
                     )),

  -- SD-M3-01. INV-M3-04 needs SOMEWHERE TO PARK A DEFERRED EVENT and
  -- SOMETHING TO DRIVE ITS RE-EVALUATION. Without these three columns
  -- "deferred" means "dropped and hoped for".
  --
  -- The canonical case is a refund that arrives before its payment
  -- (FM-M3-03): applying it would record a refund against nothing, so it is
  -- deferred and re-driven, and warned on after 3 attempts.
  purchase_id        uuid NULL REFERENCES purchases(id) ON DELETE RESTRICT,  -- SD-M3-01
  deferred_until     timestamptz NULL,                                       -- SD-M3-01
  defer_attempts     integer NOT NULL DEFAULT 0
                       CHECK (defer_attempts >= 0),                          -- SD-M3-01

  created_at         timestamptz NOT NULL DEFAULT now()
);

-- THIS UNIQUE INDEX **IS** THE IDEMPOTENCY GUARANTEE for B4 #9. Not a helper
-- for one: the guarantee itself.
CREATE UNIQUE INDEX psp_webhook_events_provider_event_uq
  ON psp_webhook_events (psp, provider_event_id);

-- SD-M3-01. The re-drive queue.
CREATE INDEX psp_webhook_events_deferred_idx
  ON psp_webhook_events (deferred_until)
  WHERE deferred_until IS NOT NULL AND processed_at IS NULL;

CREATE INDEX psp_webhook_events_purchase_idx
  ON psp_webhook_events (purchase_id) WHERE purchase_id IS NOT NULL;

COMMENT ON TABLE psp_webhook_events IS 'Retention: 24 months, then archive.';

-- -----------------------------------------------------------------------------
-- mid_health                                                    -- SD-M3-03
-- -----------------------------------------------------------------------------
-- Failover needs A DECISION RECORD, not a live computation. A routing decision
-- that cannot be explained after the fact is one nobody will trust during an
-- incident, and the 65bp chargeback threshold that threatens the processor
-- relationship needs to be a TRACKED SERIES rather than a query someone
-- remembers to run.
--
-- "Firms die from PSP freezes" is a named risk in constitution section 0. A
-- firm with one MID has no working version of RB-03.
--
-- THE DENOMINATOR RULE, and it is the dangerous part of this table.
-- Both rates are computed against CARD VOLUME, NEVER TOTAL VOLUME.
-- Wallet-funded purchases carry no chargeback exposure whatsoever, so as
-- wallet adoption grows the denominator of a total-volume ratio shrinks while
-- the numerator does not: a HEALTHY shift toward wallet funding would look
-- like a deteriorating chargeback ratio and trip failover in AS-M3-02's
-- direction for no reason at all. The columns are named to make the mistake
-- hard to make silently.
CREATE TABLE mid_health (
  psp                 text NOT NULL,
  window_start        timestamptz NOT NULL,
  window_end          timestamptz NOT NULL,

  -- Card-volume counters. attempts is the denominator for decline_rate_bp;
  -- card_settled_count is the denominator for chargeback_rate_bp.
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  declines            integer NOT NULL DEFAULT 0 CHECK (declines >= 0),
  card_settled_count  integer NOT NULL DEFAULT 0 CHECK (card_settled_count >= 0),
  chargebacks         integer NOT NULL DEFAULT 0 CHECK (chargebacks >= 0),

  -- Basis points, integer, like every ratio in this schema.
  decline_rate_bp     integer NOT NULL CHECK (decline_rate_bp BETWEEN 0 AND 10000),
  chargeback_rate_bp  integer NOT NULL CHECK (chargeback_rate_bp BETWEEN 0 AND 10000),

  state               text NOT NULL CHECK (state IN ('healthy', 'degraded', 'unhealthy')),
  state_changed_at    timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (psp, window_start),

  CONSTRAINT mid_health_window_ordered CHECK (window_end > window_start),
  CONSTRAINT mid_health_declines_within_attempts CHECK (declines <= attempts),
  CONSTRAINT mid_health_chargebacks_within_settled CHECK (
    chargebacks <= card_settled_count
  )
);

CREATE INDEX mid_health_state_idx ON mid_health (psp, window_start DESC);

COMMENT ON COLUMN mid_health.chargeback_rate_bp IS
  'SD-M3-03. Computed against CARD volume (card_settled_count), never total '
  'volume. Wallet purchases carry no chargeback exposure and must not dilute '
  'the denominator.';

COMMIT;
