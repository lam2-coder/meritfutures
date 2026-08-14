-- =============================================================================
-- 0011_wallet
-- =============================================================================
-- E2 READ: MONEY PATH. The wallet is a PAYABLE, and the whole module rests on
-- one negative fact and one closed list. Five things need the founder's
-- line-by-line read:
--
--   1. INV-WALLET-NO-DEPOSITS. THE WALLET NEVER TAKES A DEPOSIT. This is
--      excluded EXPLICITLY rather than merely omitted (OQ-M20-03 as ruled),
--      because "we did not build deposits" and "deposits are forbidden" are
--      different promises and only the second one survives a product meeting.
--      The check on wallet_entries.provenance is that promise in DDL.
--   2. THE CLOSED CREDIT LIST: payout, refund_wallet_funded, correction. The
--      ledger records the money; wallet_entries records WHAT KIND OF MONEY IT
--      IS. Without provenance every rule in M20 section 3.4 is unenforceable,
--      because the system cannot tell a payout credit from a refund credit
--      once both are in the same integer.
--   3. promotional_credit IS NOT IN THAT LIST AND MUST NOT BE. OQ-FREEZE-01:
--      the loyalty perk is promotional_credit, rendered inside the wallet
--      screen and NEVER WITHDRAWABLE. ADR-025's literal wording ("bonus wallet
--      credit") was OVERRULED at the FREEZE gate and the implementation
--      confirmed. It lives in its own ledger class and in
--      promotional_credit_grants (0024), never here.
--   4. wallet_withdrawals OWNS 'transferring' (ADR-028). payout_requests gave
--      it up. Two tables tracking one transfer is how they disagree.
--   5. SD-M20-03's provenance summary and earliest_credit_at. A withdrawal
--      needs to know WHAT IT IS MADE OF and HOW LONG that value has been in
--      the wallet, or the provenance rule and the chargeback-window hold have
--      nothing to evaluate against.
--
-- Deltas folded: SD-M5-06, SD-M20-01, SD-M20-02, SD-M20-03, SD-M20-04
--
-- Cycle closed here: purchases.wallet_ledger_transaction_id -> ledger_transactions.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- wallet_entries                                                -- SD-M20-01
-- -----------------------------------------------------------------------------
-- INV-M20-04 and INV-M20-03. APPEND-ONLY.
--
-- Every row here has a matching ledger_transaction. The ledger is the money
-- and this is the wallet's own statement, which exists because provenance is a
-- wallet fact and not a ledger fact: the ledger knows an amount moved into
-- trader_wallet, and only this table knows it arrived as a payout rather than
-- as a refund of a wallet-funded purchase.
CREATE TABLE wallet_entries (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_id            uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  direction              text NOT NULL CHECK (direction IN ('credit', 'debit')),

  -- Magnitude. Always positive; direction carries the sign. This is
  -- deliberately NOT the ledger's signed convention: the ledger's sign means
  -- debit/credit against a chart of accounts, and reusing one convention for
  -- two different questions is the shape of error ADR-027 was reversed over.
  amount_cents           bigint NOT NULL CHECK (amount_cents > 0),

  -- SD-M20-01. THE CLOSED LIST.
  --
  --   payout                 the trader_cents leg of a settled payout (LT-01)
  --   refund_wallet_funded   a refund of a purchase the wallet itself funded
  --   correction             a compensating entry, never an update
  --
  -- THERE IS NO DEPOSIT VALUE AND THERE MAY NOT BE ONE
  -- (INV-WALLET-NO-DEPOSITS). Adding one is a regulatory question about
  -- stored value, not a feature, and it requires counsel and an ADR.
  --
  -- There is also no promotional value, on purpose. See the header, item 3.
  provenance             text NOT NULL CHECK (provenance IN (
                           'payout',
                           'refund_wallet_funded',
                           'correction'
                         )),                                     -- SD-M20-01

  cause                  text NOT NULL,   -- the business event, human readable
  reference_id           uuid NOT NULL,   -- polymorphic: payout_request,
                                          -- purchase, or the corrected entry

  -- Every wallet movement is posted. A wallet entry with no ledger
  -- transaction is money that moved outside the ledger.
  ledger_transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id)
                           ON DELETE RESTRICT,

  -- The running balance AFTER this entry. Stored so a statement renders
  -- without a window function over an append-only table, and so a divergence
  -- between the stored balance and the recomputed one is a detectable tamper
  -- indication rather than an invisible one.
  balance_after_cents    bigint NOT NULL CHECK (balance_after_cents >= 0),

  occurred_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wallet_entries_identity_idx
  ON wallet_entries (identity_id, occurred_at DESC);
CREATE INDEX wallet_entries_transaction_idx ON wallet_entries (ledger_transaction_id);
CREATE INDEX wallet_entries_reference_idx ON wallet_entries (reference_id);

-- SD-M20-03's earliest_credit_at is computed from this: the chargeback-window
-- hold asks how old the oldest unspent credit is.
CREATE INDEX wallet_entries_credits_idx
  ON wallet_entries (identity_id, occurred_at) WHERE direction = 'credit';

COMMENT ON TABLE wallet_entries IS
  'Append-only. The ledger records the money; this records what kind of money '
  'it is. No deposit provenance exists and none may be added without counsel '
  'and an ADR (INV-WALLET-NO-DEPOSITS).';

-- -----------------------------------------------------------------------------
-- wallet_withdrawals                              -- SD-M5-06, SD-M20-03
-- -----------------------------------------------------------------------------
-- SD-M5-06. THE EXTERNAL LEG IS A DIFFERENT OBJECT FROM A PAYOUT REQUEST, and
-- modelling it as one would be the mistake.
--
-- A payout request is a CLAIM AGAINST AN ACCOUNT evaluated by the engine; a
-- withdrawal is a MOVEMENT OF AN ALREADY-SETTLED BALANCE evaluated against KYC
-- and destination rules. Conflating them means the engine's gates and the
-- rail's gates share a status column, and the first person to add a state
-- breaks the other one.
--
-- ADR-028 made that concrete: 'transferring' left payout_requests and lives
-- here, along with 'cooling' and 'cancelled', which the internal leg has no
-- use for at all.
CREATE TABLE wallet_withdrawals (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id               uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  amount_cents              bigint NOT NULL CHECK (amount_cents > 0),

  -- Provider-side destination id, never bank details.
  destination_ref           text NOT NULL,

  status                    wallet_withdrawal_status NOT NULL DEFAULT 'requested',
  idempotency_key           text NOT NULL,
  requested_at              timestamptz NOT NULL DEFAULT now(),
  settled_at                timestamptz NULL,

  -- SD-M5-06 carries the freeze columns SD-M5-01 adds to payout_requests, for
  -- the same reason and with the same clock: a freeze with a cited flag and no
  -- expiry is an indefinite hold, and the zero-denial policy must not permit
  -- itself one on either leg.
  frozen_at                 timestamptz NULL,                    -- SD-M5-06
  freeze_flag_id            uuid NULL REFERENCES risk_flags(id)
                              ON DELETE RESTRICT,                -- SD-M5-06
  freeze_expires_at         timestamptz NULL,                    -- SD-M5-06

  -- SD-M5-06 carries SD-M5-02's name-match columns too. This is where the
  -- destination name actually gets compared, because this is the leg with a
  -- destination.
  destination_name_match    boolean NULL,                        -- SD-M5-06
  name_match_score          integer NULL
                              CHECK (name_match_score BETWEEN 0 AND 10000),  -- SD-M5-06
  name_match_method         text NULL,                           -- SD-M5-06
  name_match_reviewed_by    text NULL,                           -- SD-M5-06

  -- SD-M20-03. AS-M20-01 and AS-M20-05. WHAT IS THIS WITHDRAWAL MADE OF, AND
  -- HOW LONG HAS THAT VALUE BEEN HERE.
  --
  -- The provenance rule cannot be evaluated against a balance, only against a
  -- composition: a wallet holding $500 of settled payout and $99 of
  -- refund_wallet_funded is not the same object as one holding $599 of payout,
  -- and only the second is fully withdrawable on the day it arrives.
  --
  -- earliest_credit_at is the chargeback-window hold's input. A refund credit
  -- that is three days old is still inside the window in which the funding
  -- purchase can be charged back, and paying it out is how a wallet becomes a
  -- cash-out rail for a stolen card.
  source_provenance_summary jsonb NOT NULL DEFAULT '{}',         -- SD-M20-03
  earliest_credit_at        timestamptz NULL,                    -- SD-M20-03

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wallet_withdrawals_freeze_is_complete CHECK (
    (frozen_at IS NULL AND freeze_flag_id IS NULL AND freeze_expires_at IS NULL)
    OR
    (frozen_at IS NOT NULL AND freeze_flag_id IS NOT NULL
     AND freeze_expires_at IS NOT NULL)
  ),

  CONSTRAINT wallet_withdrawals_score_has_method CHECK (
    name_match_score IS NULL OR name_match_method IS NOT NULL
  ),

  CONSTRAINT wallet_withdrawals_settled_has_timestamp CHECK (
    status <> 'settled' OR settled_at IS NOT NULL
  ),

  -- SD-M20-03. A withdrawal that reached the rail must know what it was made
  -- of. Before approval the summary may still be empty; after it, never.
  CONSTRAINT wallet_withdrawals_approved_has_provenance CHECK (
    status IN ('requested', 'cooling', 'cancelled', 'failed')
    OR (source_provenance_summary <> '{}'::jsonb AND earliest_credit_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX wallet_withdrawals_identity_idempotency_uq
  ON wallet_withdrawals (identity_id, idempotency_key);

CREATE INDEX wallet_withdrawals_identity_idx
  ON wallet_withdrawals (identity_id, requested_at DESC);

-- The in-flight scan, and the cooling-period sweep.
CREATE INDEX wallet_withdrawals_open_idx
  ON wallet_withdrawals (status, requested_at)
  WHERE status IN ('requested', 'cooling', 'approved', 'transferring');

CREATE INDEX wallet_withdrawals_freeze_expiry_idx
  ON wallet_withdrawals (freeze_expires_at) WHERE freeze_expires_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- wallet_spend_limits                                           -- SD-M20-02
-- -----------------------------------------------------------------------------
-- INV-M20-07, SECURITY C-23. PER IDENTITY RATHER THAN GLOBAL, and the reason
-- is the whole design: the limit that matters is the one on THE COMPROMISED
-- SESSION. A global limit either throttles legitimate traders or is set so
-- high it does nothing, and in practice it is set so high it does nothing.
CREATE TABLE wallet_spend_limits (
  identity_id      uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  daily_cents      bigint NOT NULL CHECK (daily_cents >= 0),
  rolling_7d_cents bigint NOT NULL CHECK (rolling_7d_cents >= 0),
  reason           text NOT NULL,
  set_by           text NOT NULL,
  effective_from   timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (identity_id, effective_from),

  -- A rolling weekly limit below the daily limit is a daily limit with a
  -- confusing name.
  CONSTRAINT wallet_spend_limits_weekly_exceeds_daily CHECK (
    rolling_7d_cents >= daily_cents
  )
);

CREATE INDEX wallet_spend_limits_current_idx
  ON wallet_spend_limits (identity_id, effective_from DESC);

-- -----------------------------------------------------------------------------
-- wallet_dormancy                                               -- SD-M20-04
-- -----------------------------------------------------------------------------
-- INV-M20-09, AS-M20-07. UNCLAIMED-PROPERTY OBLIGATIONS ARE JURISDICTIONAL AND
-- REAL, and the alternative to a state machine is DISCOVERING THE OBLIGATION
-- DURING AN AUDIT.
--
-- Dormancy is designed now; escheatment itself is a counsel question
-- (OQ-M20-04 as ruled), which is why jurisdiction_hint is a hint and the
-- dormancy calendar is blocked on the counsel sitting. The state machine can
-- be built and exercised without the calendar; the calendar cannot be
-- retrofitted onto balances nobody tracked.
CREATE TABLE wallet_dormancy (
  identity_id       uuid PRIMARY KEY REFERENCES identities(id) ON DELETE RESTRICT,
  last_activity_at  timestamptz NOT NULL,

  -- An array because the notification schedule is a SEQUENCE, and "did we
  -- notify them" is answered by the whole sequence rather than by the last
  -- one. A single timestamp would make the second notice overwrite the proof
  -- of the first.
  notified_at       timestamptz[] NOT NULL DEFAULT '{}',         -- SD-M20-04

  state             text NOT NULL DEFAULT 'active' CHECK (state IN (
                      'active', 'dormant', 'escheat_review'
                    )),

  -- A HINT, not a determination. The jurisdiction that governs an unclaimed
  -- balance is a legal question and this column records our best guess so
  -- counsel has something to correct rather than nothing to look at.
  jurisdiction_hint text NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Reaching escheat_review without ever having notified the trader is the
  -- failure this table exists to prevent.
  CONSTRAINT wallet_dormancy_review_was_noticed CHECK (
    state <> 'escheat_review' OR array_length(notified_at, 1) >= 1
  )
);

CREATE INDEX wallet_dormancy_state_idx
  ON wallet_dormancy (state, last_activity_at) WHERE state <> 'active';

-- -----------------------------------------------------------------------------
-- Close the cycle opened in 0006
-- -----------------------------------------------------------------------------
-- SD-M3-06. A wallet-funded purchase posts a ledger transaction, and the
-- purchase row points at it. The constraint purchases_wallet_debit_is_posted
-- already requires the column to be set whenever a wallet leg exists; this is
-- what makes the pointer resolve.
ALTER TABLE purchases
  ADD CONSTRAINT purchases_wallet_ledger_transaction_fk
  FOREIGN KEY (wallet_ledger_transaction_id) REFERENCES ledger_transactions(id)
  ON DELETE RESTRICT;

COMMIT;
