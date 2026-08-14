-- =============================================================================
-- 0009_ledger
-- =============================================================================
-- E2 READ: MONEY PATH. This is the file ADR-027 was reversed over.
--
-- Deltas folded: SD-M5-03, SD-M5-05, SD-M5-07, SD-M6-01
-- Findings:     C-01 (ADR-027, two distinct per-identity positions)
--
-- The zero-sum trigger, LEDGER-C1 and LEDGER-C2 live in 0027, because they are
-- deferred/constraint triggers and must be created after every table they read.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- ledger_accounts
-- -----------------------------------------------------------------------------
-- THE CHART OF ACCOUNTS. Seven v1 classes. ADR-027.
--
-- trader_withdrawable and trader_wallet are TWO DISTINCT per-identity
-- positions and neither supersedes the other. This was ruled one class, folded,
-- committed, and REVERSED in the same session. The evidence for two:
--
--   A payout approval reduces WITHDRAWABLE by the full approved_cents, and of
--   that, trader_cents becomes the WALLET payable and firm_cents becomes
--   revenue. approved_cents != trader_cents. The two positions move by
--   different magnitudes in one transaction, which one class cannot do.
--
-- Withdrawable is what the engine says the trader may draw.
-- Wallet is what Merit already owes them.
--
-- Collapsing them passes the zero-sum trigger and net-DEBITS the trader's
-- position by firm_cents on every approval (positive is debit:
-- approved_cents - trader_cents = +firm_cents). The ledger reconciles
-- perfectly and the balance is wrong. LEDGER-C1 in 0027 makes that shape
-- unrepresentable.
CREATE TABLE ledger_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','equity')),
  scope        text NOT NULL CHECK (scope IN ('firm','identity')),
  identity_id  uuid NULL REFERENCES identities(id),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- LEDGER-C2's vocabulary. The seven v1 codes are the whole permitted set.
  -- A class appearing first in a migration is a class nobody defined; the
  -- first draft of ADR-027 invented `firm_payable`, which is why this is a
  -- constraint and not a convention.
  CONSTRAINT ledger_accounts_code_is_declared CHECK (
    code IN (
      'firm_treasury',
      'psp_clearing',
      'fees_revenue',
      'reserve',
      'trader_withdrawable',   -- per identity. What the engine says is drawable.
      'trader_wallet',         -- per identity. SD-M5-07. What Merit already owes.
      'promotional_credit'     -- ADR-019 activated it. NEVER withdrawable.
    )
  ),

  -- scope and identity_id must agree, in both directions.
  CONSTRAINT ledger_accounts_scope_identity CHECK (
    (scope = 'identity' AND identity_id IS NOT NULL)
    OR
    (scope = 'firm' AND identity_id IS NULL)
  )
);

-- A firm-scoped class has exactly one account; an identity-scoped class has
-- exactly one per identity. Two partial uniques rather than one, because the
-- firm case has a NULL identity_id and NULLs do not collide.
CREATE UNIQUE INDEX ledger_accounts_firm_code_uq
  ON ledger_accounts (code) WHERE scope = 'firm';
CREATE UNIQUE INDEX ledger_accounts_identity_code_uq
  ON ledger_accounts (code, identity_id) WHERE scope = 'identity';

COMMENT ON TABLE ledger_accounts IS
  'Chart of accounts. Seven v1 classes (ADR-027). trader_withdrawable and '
  'trader_wallet are distinct per-identity positions, not one under two names.';

-- -----------------------------------------------------------------------------
-- ledger_transactions
-- -----------------------------------------------------------------------------
CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,
  reference_kind   text NOT NULL,
  reference_id     uuid NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  reversal_of      uuid NULL REFERENCES ledger_transactions(id),  -- SD-M5-05
  posted_at        timestamptz NOT NULL DEFAULT now()
);

-- SD-M5-05. Corrections are compensating entries, never updates. Without the
-- link a reversal is a transaction that happens to be equal and opposite, and
-- reconstructing which reversal answered which original becomes archaeology at
-- exactly the moment (a chargeback dispute, an audit) when it must be instant.
CREATE INDEX ledger_transactions_reversal_of_idx
  ON ledger_transactions (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX ledger_transactions_reference_idx
  ON ledger_transactions (reference_kind, reference_id);

-- A reversal may not reverse itself, and may not chain onto another reversal:
-- a reversal of a reversal is an adjustment and should be posted as one.
ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_no_self_reversal
  CHECK (reversal_of IS NULL OR reversal_of <> id);

-- -----------------------------------------------------------------------------
-- ledger_entries
-- -----------------------------------------------------------------------------
-- APPEND-ONLY. No UPDATE, no DELETE grant (see 0026).
CREATE TABLE ledger_entries (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id    uuid NOT NULL REFERENCES ledger_transactions(id),
  ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id),

  -- SIGNED: positive is DEBIT, negative is CREDIT.
  -- This convention is load bearing and is stated in three places
  -- (here, DATA_MODEL, M05 section 4) because getting it backwards is the
  -- error that landed four times in one day on LT-01.
  amount_cents      bigint NOT NULL CHECK (amount_cents <> 0),

  currency          char(3) NOT NULL DEFAULT 'USD',  -- reserved, never in v1 math
  memo              text NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);
CREATE INDEX ledger_entries_account_created_idx
  ON ledger_entries (ledger_account_id, created_at);

COMMENT ON COLUMN ledger_entries.amount_cents IS
  'Signed: positive DEBIT, negative CREDIT. Integer cents, never a float.';

-- -----------------------------------------------------------------------------
-- treasury_balances                                              -- SD-M5-03
-- -----------------------------------------------------------------------------
-- INV-M5-11. The reserve coverage ratio decides whether sales pause. Computing
-- it from our own ledger makes it a number that agrees with itself, so it is
-- anchored to the RAIL's reported balance; when the rail cannot be queried, to
-- a dated manual attestation that is visibly stale rather than silently wrong.
CREATE TABLE treasury_balances (
  account_code   text NOT NULL,
  as_of          timestamptz NOT NULL,
  balance_cents  bigint NOT NULL,
  source         text NOT NULL CHECK (source IN ('provider_api','manual_attestation')),
  recorded_by    uuid NULL REFERENCES users(id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_code, as_of),

  -- An attestation with no human attached is not an attestation.
  CONSTRAINT treasury_balances_attestation_has_author CHECK (
    source <> 'manual_attestation' OR recorded_by IS NOT NULL
  )
);

-- -----------------------------------------------------------------------------
-- liability_snapshots                                            -- SD-M6-01
-- -----------------------------------------------------------------------------
-- EC-095: three named numbers, never one, each printed with its own
-- definition. Showing one and calling it "liability" is how the FTT quote
-- happens.
CREATE TABLE liability_snapshots (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  as_of                           timestamptz NOT NULL,

  -- 1. Open liability: the sum of withdrawable across funded accounts.
  open_liability_cents            bigint NOT NULL,

  -- 2. Bounded near-term liability: sum of min(withdrawable, cap for next
  --    ordinal) over accounts eligible now or inside 7 trading days. This is
  --    the figure the payout wallet is funded against and the one ADR-011's
  --    top-up trigger reads.
  bounded_near_term_cents         bigint NOT NULL,

  -- 3. Remaining ladder exposure: sum((ladder - payouts_settled) * cap).
  --    The upper bound on lifetime commitment; INV-17 asserts it.
  --    ADR-024 shortened the ladder to 5/5/4, so this number fell. It is read
  --    from the pinned plan version, never from a constant.
  remaining_ladder_exposure_cents bigint NOT NULL,

  -- SD-M6-01 also carries the wallet position, because ADR-019 made wallet
  -- balances part of Open Liability (INV-M5-15).
  wallet_balances_cents           bigint NOT NULL,

  -- The absorbed-corrections line (OQ-10 ruling, M02 AS-M2-07). Signed.
  absorbed_corrections_cents      bigint NOT NULL DEFAULT 0,

  computed_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX liability_snapshots_as_of_uq ON liability_snapshots (as_of);

COMMIT;
