-- =============================================================================
-- 0007_accounts
-- =============================================================================
-- E2 READ: MONEY PATH. accounts is the object every rule runs against and
-- every liability figure sums over. Four things need the founder's
-- line-by-line read:
--
--   1. THE PHASE / STATUS SPLIT. phase is the lifecycle the rules engine
--      executes; status is the operational state. They are separate columns
--      on purpose, and the invariants below tie each to the date that proves
--      it happened.
--   2. plan_version_id NEVER CHANGES, for the life of the account. ToS clause
--      12. Enforced by a trigger in 0027, asserted here in comment because the
--      column is where a reader looks first.
--   3. U-02's graduation_eligible. ADR-024 DECOUPLED the live invitation from
--      the ladder: R-49 sets a review-pool FLAG and emits no invitation. An
--      engine that emits an invitation on ladder completion HAS ALREADY MADE
--      THE PROMISE, and the promise commits Merit rather than the program.
--   4. SD-M2-02's platform_account_refs. FM-M2-05 is the worst outcome in M02:
--      a recycled vendor ref routes one trader's fills onto another trader's
--      account, corrupts two accounts, one of which may be funded, and is
--      invisible until reconciliation.
--
-- Deltas folded: SD-M2-01, SD-M2-02, SD-M2-05, SD-M18-01, U-02, U-06
--
-- Cycle breaks closed and opened here:
--   * CLOSED: purchases.parent_account_id -> accounts (opened in 0006).
--   * OPENED: accounts.terminal_settlement_id -> payout_requests, whose table
--     is created in 0010 because it depends on this one. FK added there.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- accounts
-- -----------------------------------------------------------------------------
CREATE TABLE accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id            uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- One account per purchase. The unique index is what makes a duplicate
  -- provisioning run impossible to complete rather than merely unlikely.
  purchase_id            uuid NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,

  -- NEVER CHANGES, for the life of the account. This is the retroactive-change
  -- protection (B4 #12, GS-041) and it is a promise rather than an
  -- implementation detail, so it is enforced by trigger in 0027 where it
  -- cannot be forgotten.
  plan_version_id        uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,

  size_cents             bigint NOT NULL CHECK (size_cents > 0),

  -- The lifecycle the engine executes (STATE_MACHINES).
  phase                  account_phase NOT NULL,

  -- Operational state, DISTINCT FROM PHASE. An account can be phase 'funded'
  -- and status 'breached'; collapsing the two loses which fact is being
  -- asserted.
  status                 account_status NOT NULL,

  -- B3 reservation. v1 is always rithmic; the column is what makes a second
  -- platform adapter a config change rather than a migration against live
  -- accounts.
  platform               text NOT NULL DEFAULT 'rithmic'
                           CHECK (platform IN ('rithmic', 'tradovate', 'cqg')),
  platform_account_ref   text NULL,

  -- B3 reservation. Marketing needs it even when ingest does not.
  feed                   text NULL CHECK (feed IN ('rithmic', 'cqg', 'dxfeed')),

  -- NinjaTrader, Quantower, ATAS and friends. A provisioning input.
  front_end_permissions  jsonb NOT NULL DEFAULT '[]',

  -- TRADING DAYS, not timestamps. The calendar is authoritative (B4 #1).
  opened_on              date NOT NULL,
  funded_on              date NULL,
  closed_on              date NULL,
  close_reason           text NULL,

  -- Account-level freeze, IN ADDITION TO the identity-level flag. Both exist
  -- because an investigation can be about one account or about a person.
  payouts_frozen         boolean NOT NULL DEFAULT false,

  -- Set by a failed reconciliation. Blocks eligibility until a human clears
  -- it: a context gate, never part of the replayed state (INV-23).
  recon_blocked          boolean NOT NULL DEFAULT false,

  -- Eval expiry when configured. v1 is unlimited on all three plans.
  expires_on             date NULL,

  -- SD-M18-01. The graduated phase already exists in the approved model; what
  -- was missing is WHICH graduation happened and whether the terminal
  -- settlement occurred (INV-M18-05). Without the second, a graduated account
  -- holding a balance is indistinguishable from one that paid out fully.
  --
  -- 'live_program' is in the vocabulary and NO LIVE PROGRAM EXISTS at launch
  -- (OQ-M18-01 as ruled at the FREEZE gate). The value is present so the shape
  -- is decided before commercial pressure decides it, and zero live-program
  -- copy ships until counsel rules.
  graduated_at           timestamptz NULL,                      -- SD-M18-01
  graduation_path        text NULL CHECK (graduation_path IN (
                           'continuation', 'third_party_intro', 'live_program'
                         )),                                    -- SD-M18-01

  -- FK added in 0010_payouts. payout_requests references accounts, so the
  -- cycle opens here and closes there.
  terminal_settlement_id uuid NULL,                             -- SD-M18-01

  -- U-02. ADR-024, M01 R-49. THE FLAG THE ENGINE SETS AND NOTHING ELSE.
  --
  -- R-49 sets phase 'graduated' plus this review-pool flag, and emits NO
  -- invitation event. Invitation is a discretionary operator action taken from
  -- the pool. SD-M18-01 added graduated_at, graduation_path and
  -- terminal_settlement_id, and did not add this: the ruling created a flag no
  -- column existed for, which is why it has no delta number.
  --
  -- The ladder is "the maximum payout level, not a guaranteed minimum for live
  -- eligibility" (ToS clause 8). Topstep's live selectivity is 0.71 percent,
  -- which is what makes "complete the ladder, get live capital" a description
  -- of something no firm actually operates.
  graduation_eligible    boolean NOT NULL DEFAULT false,        -- U-02

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- A funded account knows the day it was funded. The whole funded rule set
  -- keys off that date.
  CONSTRAINT accounts_funded_has_date CHECK (
    phase <> 'funded' OR funded_on IS NOT NULL
  ),

  -- A terminal status knows the day it ended.
  CONSTRAINT accounts_terminal_has_close_date CHECK (
    status NOT IN ('breached', 'closed_admin', 'closed_chargeback', 'graduated')
    OR closed_on IS NOT NULL
  ),

  -- SD-M18-01. A graduation is dated and has a path, or it did not happen.
  CONSTRAINT accounts_graduation_is_complete CHECK (
    (graduated_at IS NULL AND graduation_path IS NULL)
    OR
    (graduated_at IS NOT NULL AND graduation_path IS NOT NULL)
  ),

  CONSTRAINT accounts_closed_is_explained CHECK (
    closed_on IS NULL OR close_reason IS NOT NULL
  )
);

CREATE INDEX accounts_identity_status_idx ON accounts (identity_id, status);

-- Unique among LIVE accounts. This does NOT stop a vendor recycling a retired
-- identifier, which is what SD-M2-02's table exists for.
CREATE UNIQUE INDEX accounts_platform_ref_uq
  ON accounts (platform, platform_account_ref)
  WHERE platform_account_ref IS NOT NULL;

-- The open-liability scan.
CREATE INDEX accounts_funded_idx ON accounts (phase) WHERE phase = 'funded';

CREATE INDEX accounts_provisioning_idx
  ON accounts (created_at) WHERE status = 'provisioning_pending';

-- U-02. The review pool M18 renders. Trader-facing exposure of this pool is
-- forbidden: it is an admin queue, and a pool a trader can see is a promise.
CREATE INDEX accounts_graduation_pool_idx
  ON accounts (identity_id) WHERE graduation_eligible;

COMMENT ON COLUMN accounts.plan_version_id IS
  'Pinned at purchase. NEVER changes (ToS clause 12, B4 #12). Enforced by '
  'trigger in 0027.';

-- Close the cycle opened in 0006: a reset purchase references the account it
-- resets.
ALTER TABLE purchases
  ADD CONSTRAINT purchases_parent_account_fk
  FOREIGN KEY (parent_account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

-- -----------------------------------------------------------------------------
-- account_status_history
-- -----------------------------------------------------------------------------
-- Materialized transition log. events is the canonical trail; this table
-- exists because "was this account active during month M" is a
-- billing-provability question asked often enough to deserve an index rather
-- than an event scan. APPEND-ONLY.
CREATE TABLE account_status_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  from_status text NULL,
  to_status   text NOT NULL,
  from_phase  text NULL,
  to_phase    text NULL,
  reason      text NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_status_history_account_idx
  ON account_status_history (account_id, changed_at DESC);

-- -----------------------------------------------------------------------------
-- platform_account_refs                                         -- SD-M2-02
-- -----------------------------------------------------------------------------
-- INV-M2-10: A PLATFORM REF IS NEVER REUSED ACROSS ACCOUNTS, FOR ANY REASON.
--
-- accounts.platform_account_ref is unique among LIVE accounts, which does not
-- stop a vendor from recycling a retired identifier onto a new account. A
-- recycled ref silently routes one trader's fills onto another trader's
-- account. This table makes a ref PERMANENTLY BURNED: assigned once, retired
-- on close, never reissued, and an inbound row citing a retired ref
-- QUARANTINES THE WHOLE FILE rather than being routed anywhere.
--
-- That is the one case in the system where Merit would rather lose a day of
-- data than accept it (AS-M2-05, FM-M2-05).
--
-- If the vendor's identifier space is genuinely finite and reuse is forced
-- (V-M2-10, a vendor-call question), the only safe design is a Merit-side
-- surrogate with an explicit epoch. That is not decided by assumption here.
CREATE TABLE platform_account_refs (
  platform              text NOT NULL
                          CHECK (platform IN ('rithmic', 'tradovate', 'cqg')),
  platform_account_ref  text NOT NULL,
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  assigned_at           timestamptz NOT NULL DEFAULT now(),
  retired_at            timestamptz NULL,
  retired_reason        text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- The primary key IS the burn. A second row for the same pair cannot exist,
  -- so reassignment fails at insert rather than being detected later.
  PRIMARY KEY (platform, platform_account_ref),

  CONSTRAINT platform_account_refs_retirement_is_explained CHECK (
    retired_at IS NULL OR retired_reason IS NOT NULL
  )
);

CREATE INDEX platform_account_refs_account_idx
  ON platform_account_refs (account_id);

-- The ingest guard's read path: is this inbound ref retired?
CREATE INDEX platform_account_refs_retired_idx
  ON platform_account_refs (platform, platform_account_ref)
  WHERE retired_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- provisioning_queue
-- -----------------------------------------------------------------------------
-- One row per INTENT, so partial success is legible. A batch that half-applied
-- is the normal failure and it has to be readable operation by operation.
--
-- PROVISIONAL (ADR-005): the operation set and payload fields follow the
-- public CSV/SFTP description and must be confirmed against the real
-- provisioning spec at the vendor call.
CREATE TABLE provisioning_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  operation     text NOT NULL CHECK (operation IN (
                  'create_user', 'create_account', 'set_risk',
                  'set_entitlement', 'set_permissions',
                  'disable_account', 'disable_entitlement'
                )),

  payload       jsonb NOT NULL,   -- the exact field values rendered into CSV

  -- SD-M2-01. The approved DATA_MODEL already declares the index
  --   unique (account_id, operation, payload_hash) where status <> 'failed'
  -- and THE COLUMN ITSELF IS MISSING FROM THE TABLE DEFINITION. Without it the
  -- duplicate-intent guard does not exist, and duplicate intents are how an
  -- account gets provisioned twice.
  --
  -- Written by the enqueue path over a canonical serialization of payload,
  -- deliberately NOT a generated column: a generated column would need an
  -- immutable cast of jsonb, whose immutability is a Postgres version
  -- question, and the duplicate-intent guard must not rest on that.
  payload_hash  bytea NOT NULL,                                  -- SD-M2-01

  file_name     text NULL,        -- idempotent name, assigned at batch build
  status        provisioning_status NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    text NULL,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz NULL,
  confirmed_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- U-06. AS-M2-03, M02 section 3.2. BINDING: set_risk MAY NEVER REACH
  -- confirmed_inferred.
  --
  -- An inferred confirmation means we believe the account exists because the
  -- vendor reported on it. That is strong evidence for create_account and
  -- WORTHLESS for set_risk: you cannot infer that a risk setting applied from
  -- an account appearing in a report. The difference is between believing an
  -- account is protected and knowing it, and it is the whole of AS-M2-03.
  --
  -- This is a CHECK rather than a convention because the failure is silent:
  -- an account trading with no working auto-liquidator is a liability the firm
  -- is carrying without knowing.
  CONSTRAINT provisioning_queue_set_risk_never_inferred CHECK (
    operation <> 'set_risk' OR status <> 'confirmed_inferred'
  ),

  CONSTRAINT provisioning_queue_delivered_has_timestamp CHECK (
    status NOT IN ('delivered', 'confirmed', 'confirmed_inferred')
    OR delivered_at IS NOT NULL
  )
);

CREATE INDEX provisioning_queue_status_idx ON provisioning_queue (status, queued_at);

-- SD-M2-01. The duplicate-intent guard, now that the column it names exists.
-- Partial on status <> 'failed' so a genuine retry after a failure is
-- permitted and a second live intent is not.
CREATE UNIQUE INDEX provisioning_queue_intent_uq
  ON provisioning_queue (account_id, operation, payload_hash)
  WHERE status <> 'failed';

-- -----------------------------------------------------------------------------
-- platform_entitlements
-- -----------------------------------------------------------------------------
-- The hygiene ledger behind real monthly cost. B3 reservation, now a real
-- table. monthly_cost_cents makes THE COST OF FORGETTING VISIBLE IN A QUERY,
-- which is the only reason an entitlement leak gets closed.
CREATE TABLE platform_entitlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entitlement         text NOT NULL CHECK (entitlement IN (
                        'market_data_cme', 'platform_access', 'api_tier'
                      )),
  active              boolean NOT NULL DEFAULT true,
  activated_on        date NOT NULL,
  deactivated_on      date NULL,
  monthly_cost_cents  bigint NOT NULL DEFAULT 0 CHECK (monthly_cost_cents >= 0),

  -- SD-M2-05. RITHMIC BILLS PER LOGIN-MONTH PER USER, and separately for API
  -- tier, NOT PER ACCOUNT. Modelling entitlements only per account makes the
  -- monthly bill unreconcilable against our own records, which is how a cost
  -- leak survives for months (V-M2-09).
  --
  -- billing_unit is what makes the invoice reconciliation possible at all, and
  -- the reconciliation is a named line in the C8 cost review.
  platform_user_ref   text NULL,                                 -- SD-M2-05
  billing_unit        text NULL CHECK (billing_unit IN (
                        'per_login_month', 'per_account_month', 'per_api_id_month'
                      )),                                        -- SD-M2-05

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT platform_entitlements_active_matches_dates CHECK (
    (active = true AND deactivated_on IS NULL)
    OR
    (active = false AND deactivated_on IS NOT NULL)
  ),
  CONSTRAINT platform_entitlements_dates_ordered CHECK (
    deactivated_on IS NULL OR deactivated_on >= activated_on
  )
);

CREATE INDEX platform_entitlements_active_idx
  ON platform_entitlements (active, account_id);

-- SD-M2-05. The invoice reconciliation groups by the unit the vendor bills in,
-- not the unit we happen to model in.
CREATE INDEX platform_entitlements_billing_idx
  ON platform_entitlements (billing_unit, platform_user_ref) WHERE active;

-- The nightly alarm's source: any entitlement still active on a closed
-- account. The alarm evaluates THE QUERY, not the job (FM-M2-11), because a
-- job that stopped running looks exactly like a clean night.
CREATE INDEX platform_entitlements_live_by_account_idx
  ON platform_entitlements (account_id) WHERE active;

COMMIT;
