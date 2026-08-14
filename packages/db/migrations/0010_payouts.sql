-- =============================================================================
-- 0010_payouts
-- =============================================================================
-- E2 READ: MONEY PATH. THIS IS THE FILE WHERE MONEY LEAVES. Five things need
-- the founder's line-by-line read, and the second and third are the ones
-- ADR-028 called the single most dangerous item in the set:
--
--   1. THE SPLIT ARITHMETIC. trader_cents + firm_cents = approved_cents, and
--      approved_cents <= requested_cents. Both CHECKs. approved_cents is what
--      leaves trader_withdrawable; trader_cents is what arrives in
--      trader_wallet; the difference is fees_revenue (ADR-027, LT-01).
--   2. SD-09's PARTIAL UNIQUE INDEX and its predicate. This enforces
--      G-NO-IN-FLIGHT in the database because the engine is not the only
--      writer. The predicate is ('approved','frozen') and it MUST match the
--      status index below it. A predicate fixed in one of two places is a
--      uniqueness guarantee that holds on Tuesdays.
--   3. WHY THE PREDICATE IS THE DANGEROUS HALF. If 'transferring' had stayed
--      in it after ADR-028 retired the value, the index would still exist,
--      still be valid, and enforce NOTHING, because no row would ever match.
--      A gate that silently stops gating is worse than one that is absent, and
--      nothing in the test suite would fail.
--   4. SD-05's ordinal index. A FAILED TRANSFER MUST NOT CONSUME A LADDER RUNG
--      or advance the cap schedule (EC-037). The ladder is finite (5/5/4) and
--      a wrongly-consumed rung is a payout the trader never gets.
--   5. SD-M5-01's freeze clock. A freeze with a cited flag but NO CLOCK is an
--      indefinite hold, which is a denial with extra steps and is exactly what
--      a zero-denial policy must not permit itself (AS-M5-04). The expiry is
--      what makes the control bind on MERIT rather than on the trader.
--
-- Deltas folded: SD-03, SD-05, SD-09, SD-M5-01, SD-M5-02, SD-M5-04
-- Rulings:       ADR-028 (the enum and BOTH predicates), ADR-027 (LT-01)
--
-- Cycle closed here: accounts.terminal_settlement_id -> payout_requests.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- payout_requests
-- -----------------------------------------------------------------------------
CREATE TABLE payout_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  -- DENORMALIZED DELIBERATELY (Wave 2 gate ruling 4). Aggregate exposure
  -- queries and race-safety checks are identity-level (B4 #7): the question
  -- "how much is this human extracting right now" cannot be a join if it is
  -- being asked inside the race it is protecting against.
  identity_id              uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  requested_cents          bigint NOT NULL CHECK (requested_cents > 0),

  -- After the clamp: min(requested, withdrawable, cap).
  approved_cents           bigint NOT NULL CHECK (approved_cents >= 0),

  -- The split legs. trader_cents becomes the WALLET payable; firm_cents
  -- becomes revenue. approved_cents leaves trader_withdrawable in full.
  -- approved_cents != trader_cents, and that inequality is why ADR-027 ruled
  -- two distinct per-identity ledger classes rather than one.
  trader_cents             bigint NOT NULL CHECK (trader_cents >= 0),
  firm_cents               bigint NOT NULL CHECK (firm_cents >= 0),

  -- The LAST CLOSED DAY the decision used. Not a wall clock.
  basis_trading_day        date NOT NULL,

  -- The contract in force, COPIED for provability. The account pins it too;
  -- this copy is what makes the payout explicable without reading the account.
  plan_version_id          uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,

  -- Full gate-by-gate evaluation and inputs, immutable. A jsonb column rather
  -- than a separate table because it is written exactly once, always read with
  -- its parent, and must never drift from it. A join here would add a way for
  -- THE PROOF AND THE DECISION to disagree.
  eligibility_snapshot     jsonb NOT NULL,

  -- ADR-028. THE RULED ENUM: approved, settled, failed, frozen.
  -- There is no 'denied' and no review state BY DESIGN (Wave 2 gate ruling 3),
  -- and 'transferring' belongs to wallet_withdrawals. See 0001 for the full
  -- reasoning, which is written where the type is declared.
  status                   payout_status NOT NULL,

  idempotency_key          text NOT NULL,   -- client-supplied

  -- 1-based per account. Drives the ladder and the cap schedule. R-45 defines
  -- it as payouts_settled_count + 1, so it is DERIVED FROM SETTLEMENTS RATHER
  -- THAN FROM ATTEMPTS.
  payout_ordinal           integer NOT NULL CHECK (payout_ordinal > 0),

  approved_at              timestamptz NOT NULL DEFAULT now(),
  settled_at               timestamptz NULL,

  -- SD-03. REPLAY MUST NOT DEPEND ON A WALL CLOCK. Storing the trading days
  -- the settlement attached to makes the fold deterministic years later.
  --
  -- The two are different dates and the difference is load bearing:
  -- settled_trading_day is when the settlement happened;
  -- effective_trading_day is the FIRST TRADING DAY WHOSE OPENING BALANCE
  -- REFLECTS THE WITHDRAWAL. The adjustment is applied at the open of the
  -- effective day, never inside a session (R-10, SD-01), which is half of why
  -- a settled payout can never breach the account that earned it (INV-21).
  settled_trading_day      date NULL,                            -- SD-03
  effective_trading_day    date NULL,                            -- SD-03

  -- SD-M5-01. The freeze, with a cited flag and a clock.
  frozen_at                timestamptz NULL,                     -- SD-M5-01
  freeze_flag_id           uuid NULL REFERENCES risk_flags(id)
                             ON DELETE RESTRICT,                 -- SD-M5-01
  freeze_expires_at        timestamptz NULL,                     -- SD-M5-01

  -- SD-M5-04. INV-M5-13. A SETTLED PAYOUT WHOSE WITHDRAWAL NEVER APPEARS IN
  -- THE PLATFORM BALANCE LEAVES THE TRADER ABLE TO WITHDRAW THE SAME MONEY
  -- TWICE.
  --
  -- This column is what turns that from an invisible loss into a nightly alarm
  -- (AS-M5-01). 'missing' is a real state, not an error: the money left our
  -- ledger and did not arrive in theirs, and somebody has to be told.
  balance_reflection_status text NOT NULL DEFAULT 'pending' CHECK (
                             balance_reflection_status IN
                               ('pending', 'observed', 'missing')
                           ),                                    -- SD-M5-04
  reflected_on_trading_day date NULL,                            -- SD-M5-04

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- THE SPLIT ARITHMETIC. Integer cents, no floats, checked by the database.
  CONSTRAINT payout_requests_split_sums CHECK (
    trader_cents + firm_cents = approved_cents
  ),

  -- The clamp can only reduce. An approval above the request is not a generous
  -- clamp, it is a bug that pays out money nobody asked for.
  CONSTRAINT payout_requests_approved_within_requested CHECK (
    approved_cents <= requested_cents
  ),

  -- SD-M5-01. A freeze carries its flag AND its expiry. All three together or
  -- none: a freeze with a flag and no clock is the indefinite hold this delta
  -- exists to prevent, and a freeze with a clock and no flag is a hold nobody
  -- can justify.
  CONSTRAINT payout_requests_freeze_is_complete CHECK (
    (status <> 'frozen'
       AND frozen_at IS NULL AND freeze_flag_id IS NULL
       AND freeze_expires_at IS NULL)
    OR
    (status = 'frozen'
       AND frozen_at IS NOT NULL AND freeze_flag_id IS NOT NULL
       AND freeze_expires_at IS NOT NULL)
  ),

  -- SD-03. A settled payout knows both of its trading days.
  CONSTRAINT payout_requests_settled_has_days CHECK (
    status <> 'settled'
    OR (settled_at IS NOT NULL
        AND settled_trading_day IS NOT NULL
        AND effective_trading_day IS NOT NULL)
  ),

  -- The effective day is never before the settlement day: the balance cannot
  -- reflect a withdrawal that has not happened.
  CONSTRAINT payout_requests_effective_after_settled CHECK (
    settled_trading_day IS NULL OR effective_trading_day IS NULL
    OR effective_trading_day >= settled_trading_day
  ),

  -- SD-M5-04. Only a settled payout can have been observed in the platform
  -- balance, and an observation carries the day it was observed on.
  CONSTRAINT payout_requests_reflection_needs_settlement CHECK (
    balance_reflection_status = 'pending' OR status = 'settled'
  ),
  CONSTRAINT payout_requests_observed_has_day CHECK (
    balance_reflection_status <> 'observed' OR reflected_on_trading_day IS NOT NULL
  )
);

-- Client idempotency: the same key on the same account is the same request.
CREATE UNIQUE INDEX payout_requests_account_idempotency_uq
  ON payout_requests (account_id, idempotency_key);

-- SD-05. THE ORDINAL UNIQUE IS PARTIAL.
--
-- A failed transfer must not consume a ladder rung or advance the cap
-- schedule (EC-037). With a total unique index, a failure would burn the
-- ordinal and the retry would need a new one, which silently shortens a finite
-- ladder. R-45 keeps the ordinal derived from settlements; this index is what
-- makes the retry expressible at all.
CREATE UNIQUE INDEX payout_requests_account_ordinal_uq
  ON payout_requests (account_id, payout_ordinal) WHERE status <> 'failed';

-- SD-09, PREDICATE PER ADR-028. G-NO-IN-FLIGHT, ENFORCED IN THE DATABASE.
--
-- At most one outstanding request per account. FM-11 is payout stacking inside
-- the settlement window: several capped extractions from one qualifying
-- stretch. The engine refuses it at R-38 and this index refuses it again,
-- because the engine is not the only writer (EC-040, GS-052).
--
-- THE PREDICATE IS THE DANGEROUS HALF and it must stay in lockstep with the
-- status index below. Under ADR-019 the internal leg settles instantly to the
-- wallet, so the outstanding states are exactly 'approved' and 'frozen'.
CREATE UNIQUE INDEX payout_requests_no_in_flight_uq
  ON payout_requests (account_id) WHERE status IN ('approved', 'frozen');

-- ADR-028 correction 1. THE SECOND INDEX WITH THE SAME PREDICATE.
--
-- DATA_MODEL carried this one with the stale ('approved','transferring')
-- predicate after the first had been corrected. Both are written here,
-- adjacent, with the same predicate, precisely so that a future change to one
-- is visibly a change to one of two.
CREATE INDEX payout_requests_outstanding_idx
  ON payout_requests (status) WHERE status IN ('approved', 'frozen');

CREATE INDEX payout_requests_identity_approved_idx
  ON payout_requests (identity_id, approved_at DESC);

-- SD-M5-01. The freeze-expiry sweep: the control that binds on Merit.
CREATE INDEX payout_requests_freeze_expiry_idx
  ON payout_requests (freeze_expires_at) WHERE status = 'frozen';

-- SD-M5-04. The nightly alarm's source.
CREATE INDEX payout_requests_reflection_pending_idx
  ON payout_requests (settled_trading_day)
  WHERE status = 'settled' AND balance_reflection_status <> 'observed';

COMMENT ON TABLE payout_requests IS
  'Retention: forever. status has no denied and no review state by design '
  '(zero-denial policy). Adding a value requires an ADR.';

-- -----------------------------------------------------------------------------
-- payout_transfers
-- -----------------------------------------------------------------------------
-- Separates "we approved" from "the rail moved money", so a Rise outage never
-- looks like a payout problem.
CREATE TABLE payout_transfers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_request_id      uuid NOT NULL REFERENCES payout_requests(id) ON DELETE RESTRICT,
  provider               text NOT NULL DEFAULT 'rise',
  provider_transfer_id   text NULL,
  idempotency_key        text NOT NULL UNIQUE,
  amount_cents           bigint NOT NULL CHECK (amount_cents > 0),

  -- Provider-side destination id, NEVER bank details. Merit does not hold
  -- them, which is the point.
  destination_ref        text NOT NULL,

  -- Rise identity versus KYC identity. False freezes and flags.
  destination_name_match boolean NULL,

  status                 text NOT NULL CHECK (status IN (
                           'queued', 'sent', 'settled', 'failed', 'retrying'
                         )),
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error             text NULL,
  sent_at                timestamptz NULL,
  settled_at             timestamptz NULL,

  -- SD-M5-02. destination_name_match is a boolean in the approved model, and
  -- REAL NAME MATCHING IS NOT BOOLEAN.
  --
  -- Transliteration, married names, and common names make a strict comparison
  -- produce FALSE FREEZES ON LEGITIMATE TRADERS, which under a zero-denial
  -- policy is a brand cost paid by the people least deserving of it. The score
  -- and the method make the threshold tunable and auditable (AS-M5-02), and
  -- the reviewer's name is what turns an override into a decision somebody
  -- made.
  --
  -- Merit refuses the market norm of payout-time fraud friction (Apex's
  -- screen-recording requirement, refused on the record). That refusal only
  -- holds if the identity friction actually lands upstream of funding, which
  -- is what ADR-021's triggers are for. These three columns are what keep the
  -- name check from becoming the friction that reappears here.
  name_match_score       integer NULL
                           CHECK (name_match_score BETWEEN 0 AND 10000), -- SD-M5-02
  name_match_method      text NULL,                                      -- SD-M5-02
  name_match_reviewed_by text NULL,                                      -- SD-M5-02

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- SD-M5-02. A score with no method is a number nobody can re-derive when the
  -- matcher is replaced.
  CONSTRAINT payout_transfers_score_has_method CHECK (
    name_match_score IS NULL OR name_match_method IS NOT NULL
  ),

  CONSTRAINT payout_transfers_settled_has_timestamp CHECK (
    status <> 'settled' OR settled_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX payout_transfers_provider_transfer_uq
  ON payout_transfers (provider, provider_transfer_id)
  WHERE provider_transfer_id IS NOT NULL;

CREATE INDEX payout_transfers_request_idx ON payout_transfers (payout_request_id);
CREATE INDEX payout_transfers_open_idx
  ON payout_transfers (status, created_at)
  WHERE status IN ('queued', 'sent', 'retrying');

-- -----------------------------------------------------------------------------
-- Close the cycle opened in 0007
-- -----------------------------------------------------------------------------
-- SD-M18-01. Without the terminal settlement, a graduated account holding a
-- balance is indistinguishable from one that paid out fully (INV-M18-05).
ALTER TABLE accounts
  ADD CONSTRAINT accounts_terminal_settlement_fk
  FOREIGN KEY (terminal_settlement_id) REFERENCES payout_requests(id)
  ON DELETE RESTRICT;

COMMIT;
