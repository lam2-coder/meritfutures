-- =============================================================================
-- 0012_disputes_and_affiliate_settlement
-- =============================================================================
-- E2 READ: MONEY PATH. Three things need the founder's line-by-line read:
--
--   1. A CHARGEBACK IS BOOKED HONESTLY EVEN WHEN IT NETS NEGATIVE (B4 #10).
--      A chargeback closes the account, flags the identity, and posts a
--      REVERSAL. When the payout already settled and the identity nets
--      negative, the ledger shows the loss. It does not net, hide, or defer
--      it. ledger_transaction_id is the link to that compensating entry.
--   2. SD-M8-01's TWO CLOCKS. The approved model has payable_after, which
--      encodes the REFUND window. Chargebacks arrive months later, ON THE CARD
--      NETWORKS' CLOCK RATHER THAN OURS, so a single date conflates two
--      different risks and pays commission long before the sale is final
--      (AS-M8-01).
--   3. clawback_of and affiliates.balance_cents together are what make a
--      clawback enforceable. An affiliate who learns that clawbacks are
--      unenforceable is an affiliate with a business model.
--
-- Deltas folded: SD-M8-01, SD-M8-05
--
-- These four tables share a file because they share an event: a chargeback is
-- what triggers a clawback, and the affiliate settlement half of M08 could not
-- land in 0005 anyway (attributions needs purchases, which needs coupons,
-- which needs affiliates).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- payment_disputes
-- -----------------------------------------------------------------------------
CREATE TABLE payment_disputes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id            uuid NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  kind                   text NOT NULL CHECK (kind IN ('chargeback', 'refund')),
  amount_cents           bigint NOT NULL CHECK (amount_cents > 0),
  reason_code            text NULL,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz NULL,
  outcome                text NULL CHECK (outcome IN ('lost', 'won', 'refunded')),

  -- THE COMPENSATING REVERSAL. Corrections are compensating entries, never
  -- updates (SD-M5-05), and this is the pointer that makes "which reversal
  -- answered which dispute" instant at exactly the moment it must be.
  ledger_transaction_id  uuid NULL REFERENCES ledger_transactions(id)
                           ON DELETE RESTRICT,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_disputes_resolved_has_outcome CHECK (
    (resolved_at IS NULL AND outcome IS NULL)
    OR
    (resolved_at IS NOT NULL AND outcome IS NOT NULL)
  ),

  -- A dispute Merit lost, or refunded, moved money and must name the
  -- transaction that recorded it. A dispute Merit won moved nothing.
  CONSTRAINT payment_disputes_loss_is_posted CHECK (
    outcome IS NULL OR outcome = 'won' OR ledger_transaction_id IS NOT NULL
  )
);

CREATE INDEX payment_disputes_purchase_idx ON payment_disputes (purchase_id);
CREATE INDEX payment_disputes_open_idx
  ON payment_disputes (opened_at) WHERE resolved_at IS NULL;

-- -----------------------------------------------------------------------------
-- attributions
-- -----------------------------------------------------------------------------
CREATE TABLE attributions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One attribution per purchase. The unique is what stops two affiliates
  -- being paid for one sale.
  purchase_id                 uuid NOT NULL UNIQUE REFERENCES purchases(id)
                                ON DELETE RESTRICT,
  affiliate_id                uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  model                       text NOT NULL CHECK (model IN ('last_touch', 'code_override')),
  click_id                    bigint NULL REFERENCES affiliate_clicks(id) ON DELETE RESTRICT,

  -- Self-purchase VOIDS attribution and raises a flag (B4 #16). Voiding rather
  -- than deleting, because the attempt is the signal.
  voided                      boolean NOT NULL DEFAULT false,
  void_reason                 text NULL,

  -- SD-M8-05. INV-M8-03. THE SELF-DEAL CHECK MUST RECORD WHAT IT FOUND, not
  -- only its verdict, or an argument about a voided commission has no evidence
  -- on either side.
  --
  -- Both identities are stored rather than joined, because the check is a
  -- statement about the two of them AT THE MOMENT OF PURCHASE, and an affiliate
  -- can be reassigned or an identity merged afterwards. The confidence is the
  -- link-graph score (ADR-022) that produced the verdict: it is null when the
  -- two identities are literally the same row, because that case needs no
  -- score.
  buyer_identity_id           uuid NOT NULL REFERENCES identities(id)
                                ON DELETE RESTRICT,              -- SD-M8-05
  affiliate_identity_id       uuid NOT NULL REFERENCES identities(id)
                                ON DELETE RESTRICT,              -- SD-M8-05
  self_deal_link_confidence_bp integer NULL
                                CHECK (self_deal_link_confidence_bp
                                       BETWEEN 0 AND 10000),     -- SD-M8-05

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attributions_void_is_explained CHECK (
    voided = false OR void_reason IS NOT NULL
  ),

  -- SD-M8-05. The literal self-deal cannot be attributed at all. A graph-score
  -- self-deal is a judgment and is voided by the detector with its confidence
  -- recorded; this one is arithmetic.
  CONSTRAINT attributions_literal_self_deal_is_void CHECK (
    buyer_identity_id <> affiliate_identity_id OR voided = true
  )
);

CREATE INDEX attributions_affiliate_idx ON attributions (affiliate_id, created_at DESC);
CREATE INDEX attributions_buyer_idx ON attributions (buyer_identity_id);

-- The self-deal review queue: scored but not yet voided.
CREATE INDEX attributions_self_deal_review_idx
  ON attributions (self_deal_link_confidence_bp DESC)
  WHERE self_deal_link_confidence_bp IS NOT NULL AND voided = false;

-- -----------------------------------------------------------------------------
-- affiliate_statements
-- -----------------------------------------------------------------------------
-- Created before affiliate_commissions because SD-M8-01's paid_in_statement_id
-- references it. Monthly, IMMUTABLE ONCE ISSUED.
CREATE TABLE affiliate_statements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id      uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  total_cents       bigint NOT NULL,   -- signed: a clawback-heavy month is negative
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  paid_transfer_ref text NULL,
  issued_at         timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT affiliate_statements_period_ordered CHECK (period_end >= period_start),
  CONSTRAINT affiliate_statements_issued_has_date CHECK (
    status = 'draft' OR issued_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX affiliate_statements_period_uq
  ON affiliate_statements (affiliate_id, period_start);

-- -----------------------------------------------------------------------------
-- affiliate_commissions
-- -----------------------------------------------------------------------------
CREATE TABLE affiliate_commissions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id            uuid NOT NULL REFERENCES attributions(id) ON DELETE RESTRICT,

  -- Signed: a clawback row is negative. The clawback is a COMPENSATING ROW,
  -- never an update to the original, for the same reason a ledger reversal is.
  amount_cents              bigint NOT NULL CHECK (amount_cents <> 0),

  status                    text NOT NULL DEFAULT 'accrued' CHECK (status IN (
                              'accrued', 'payable', 'paid', 'clawed_back'
                            )),

  -- The REFUND window. Merit's own clock.
  payable_after             date NOT NULL,

  -- SD-M8-01. THE SECOND CLOCK, and it is the card networks' rather than ours.
  --
  -- Chargebacks arrive months after the sale. Paying commission on
  -- payable_after alone pays it long before the sale is final, and the money is
  -- then in someone else's bank account when the chargeback lands (AS-M8-01).
  chargeback_window_ends_on date NOT NULL,                       -- SD-M8-01

  -- SD-M8-01. Which commission this row claws back. Null on an accrual.
  clawback_of               uuid NULL REFERENCES affiliate_commissions(id)
                              ON DELETE RESTRICT,                -- SD-M8-01

  -- SD-M8-01. Which statement paid it. Null until paid. This is what makes
  -- "when did we pay this, and on what statement" a lookup rather than a
  -- reconstruction.
  paid_in_statement_id      uuid NULL REFERENCES affiliate_statements(id)
                              ON DELETE RESTRICT,                -- SD-M8-01

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- SD-M8-01. The chargeback window closes no earlier than the refund window.
  -- If it ever did, the later clock would be the one that does not bind, which
  -- is the defect the delta exists to fix.
  CONSTRAINT affiliate_commissions_chargeback_window_is_later CHECK (
    chargeback_window_ends_on >= payable_after
  ),

  -- A clawback is negative; an accrual is positive. This is the constraint
  -- that stops a clawback being written as a second accrual.
  CONSTRAINT affiliate_commissions_clawback_sign CHECK (
    (clawback_of IS NULL AND amount_cents > 0)
    OR
    (clawback_of IS NOT NULL AND amount_cents < 0)
  ),

  CONSTRAINT affiliate_commissions_no_self_clawback CHECK (
    clawback_of IS NULL OR clawback_of <> id
  ),

  -- A paid commission names the statement that paid it.
  CONSTRAINT affiliate_commissions_paid_has_statement CHECK (
    status <> 'paid' OR paid_in_statement_id IS NOT NULL
  )
);

CREATE INDEX affiliate_commissions_attribution_idx
  ON affiliate_commissions (attribution_id);
CREATE INDEX affiliate_commissions_statement_idx
  ON affiliate_commissions (paid_in_statement_id)
  WHERE paid_in_statement_id IS NOT NULL;
CREATE INDEX affiliate_commissions_clawback_idx
  ON affiliate_commissions (clawback_of) WHERE clawback_of IS NOT NULL;

-- SD-M8-01. The payable sweep reads BOTH clocks. A commission is payable only
-- when both windows have closed, which is the whole content of the delta.
CREATE INDEX affiliate_commissions_payable_sweep_idx
  ON affiliate_commissions (chargeback_window_ends_on, payable_after)
  WHERE status = 'accrued';

COMMIT;
