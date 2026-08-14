-- =============================================================================
-- 0004_catalog
-- =============================================================================
-- E2 READ: MONEY PATH. plan_versions IS THE RULE CONTRACT. It is the single
-- source of truth the engine executes AND the site renders, and it is the
-- artifact behind the single most valuable promise Merit can make in a market
-- whose live case study is a firm destroyed by a retroactive rule change.
--
-- Three things need the founder's line-by-line read:
--
--   1. plan_version_sizes exists at all. Rounding a percentage at runtime is
--      how a marketing page and an engine end up one cent apart, and one cent
--      is a review-page headline. Every published threshold is computed once
--      at publish and never recomputed.
--   2. SD-10's conditional not-null. An enabled floor lock published without
--      its values is a funded account whose floor never locks, silently.
--   3. The config key names ADR-030 ruled: max_payouts, kyc.triggers. The zod
--      schema and the CV publish validations key off these names.
--
-- Deltas folded: SD-10, SD-M9-01
-- Rulings:       ADR-030 (config key names, recorded on plan_versions.rules)
--
-- The immutability trigger for published plan_versions lives in 0027, because
-- it is an UPDATE trigger and belongs with the rest of the invariant set.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- plans
-- -----------------------------------------------------------------------------
CREATE TABLE plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- core_eod, merit_rapid, direct. 'direct' was renamed from 'rapid_daily' at
  -- the M1 gate (ADR-013). The old code is not carried forward: no row exists
  -- to migrate, and a retired alias is a second name for one thing.
  code        text NOT NULL UNIQUE,

  name        text NOT NULL,

  -- Delisting never deletes. A plan nobody can buy still has to explain the
  -- accounts sold under it.
  is_active   boolean NOT NULL DEFAULT true,

  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- plan_versions
-- -----------------------------------------------------------------------------
-- THE IMMUTABLE RULE CONTRACT. Publishing a change means creating a NEW
-- VERSION. This is what makes "the rules at the time" provable (B4 #12), and
-- it is enforced by a trigger in 0027 rather than by process.
CREATE TABLE plan_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  version        integer NOT NULL CHECK (version > 0),
  status         plan_version_status NOT NULL DEFAULT 'draft',

  -- The full config. Shape in DATA_MODEL section 11, validated by zod at the
  -- write boundary.
  --
  -- ADR-030 RULED TWO KEY NAMES AND THEY ARE LOAD BEARING:
  --
  --   * The ladder length is `phase_funded.max_payouts`, NOT
  --     `ladder.payouts_to_graduate`. ADR-024 is the later ruling and
  --     Appendix A is what a founder reads when confirming parameters. The
  --     frozen values are 5 / 5 / 4 (Core EOD, Merit Rapid, Direct).
  --   * `kyc.triggers` is an ARRAY, not the singular `kyc.placement`. Under
  --     ADR-021 placement is a set of trigger events firing at whichever is
  --     reached first. The frozen value is
  --       ['second_distinct_account_purchase', 'pre_funded'].
  --
  -- Every parameter in here is a LAUNCH CANDIDATE re-confirmed at launch, not
  -- a constant. There is no plan parameter anywhere in application code.
  rules          jsonb NOT NULL,

  -- Published rule text keyed by rule path, so marketing copy and engine
  -- parameters ship together. A version cannot be published with copy that
  -- describes a different number.
  copy_blocks    jsonb NOT NULL DEFAULT '{}',

  -- SD-M9-01. A plan version needs a STABLE, PERMANENT public URL that
  -- survives being superseded (INV-M9-11). Deriving the URL from the version
  -- number would make the archive URL change whenever numbering does, which
  -- breaks exactly the links AS-M9-07 depends on: the trader who wants to show
  -- someone the rules their account was sold under.
  public_slug    text NOT NULL,                            -- SD-M9-01

  -- SD-M9-01. A version can be published-for-engine while not yet being the
  -- one on sale. Two different facts, and one boolean cannot hold both.
  public_visible boolean NOT NULL DEFAULT false,           -- SD-M9-01

  published_at   timestamptz NULL,

  -- Retirement stops NEW SALES and never touches live accounts. That
  -- distinction is the whole of the retroactive-change protection.
  retired_at     timestamptz NULL,

  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_versions_published_has_timestamp CHECK (
    status <> 'published' OR published_at IS NOT NULL
  ),
  CONSTRAINT plan_versions_retired_has_timestamp CHECK (
    status <> 'retired' OR retired_at IS NOT NULL
  ),

  -- A draft is never on sale. Public visibility on an unpublished version
  -- would put an unexecutable contract on the pricing page.
  CONSTRAINT plan_versions_visible_implies_published CHECK (
    public_visible = false OR status = 'published'
  )
);

CREATE UNIQUE INDEX plan_versions_plan_version_uq
  ON plan_versions (plan_id, version);

-- SD-M9-01. The slug is the permanent public URL, so it is unique across every
-- version of every plan, not merely within a plan.
CREATE UNIQUE INDEX plan_versions_public_slug_uq
  ON plan_versions (public_slug);

-- The site's read path: the one version on sale per plan.
CREATE INDEX plan_versions_on_sale_idx
  ON plan_versions (plan_id) WHERE public_visible;

COMMENT ON TABLE plan_versions IS
  'Immutable once published (trigger in 0027). Retention: forever. A retired '
  'version is still needed to explain a 2027 payout in 2031.';

-- -----------------------------------------------------------------------------
-- plan_version_sizes
-- -----------------------------------------------------------------------------
-- Materialized per-size thresholds. Percentages scale, but THE PUBLISHED
-- NUMBER MUST BE EXACT, so it is computed once at publish and never recomputed
-- at runtime. This table's entire justification is that one cent of drift
-- between the marketing page and the engine is a review-page headline.
--
-- v1 sizes: 2,500,000c / 5,000,000c / 10,000,000c / 15,000,000c.
CREATE TABLE plan_version_sizes (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id            uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,

  size_cents                 bigint NOT NULL CHECK (size_cents > 0),
  price_cents                bigint NOT NULL CHECK (price_cents > 0),
  reset_price_cents          bigint NOT NULL CHECK (reset_price_cents > 0),

  drawdown_cents             bigint NOT NULL CHECK (drawdown_cents > 0),

  -- Null on Direct: there is no evaluation, so there is no profit target. A
  -- zero here would be a target of zero, which is a different and reachable
  -- thing.
  profit_target_cents        bigint NULL CHECK (profit_target_cents > 0),

  buffer_cents               bigint NOT NULL CHECK (buffer_cents >= 0),
  win_day_floor_cents        bigint NOT NULL CHECK (win_day_floor_cents > 0),

  -- Ordered steps keyed by payout ordinal. AN ARRAY FROM DAY ONE even though
  -- v1 publishes one flat step, because turning a scalar into a schedule later
  -- is a migration plus a config rewrite. ADR-025 rejected progressive cap
  -- release for v1 and the shape stays, because the reservation costs nothing
  -- and the retrofit does not.
  payout_cap_schedule_cents  jsonb NOT NULL,

  -- Null when the plan has none. v1 configures none on all three.
  daily_loss_limit_cents     bigint NULL CHECK (daily_loss_limit_cents > 0),

  -- SD-10. THE CONDITIONAL NOT-NULL.
  --
  -- These two columns already existed as nullable. The delta is the constraint
  -- that an ENABLED lock can never be published without its values, because a
  -- funded account whose lock is enabled and whose floor_at is null does not
  -- fail: it silently never locks, and the permanent floor lock is a
  -- structural ruling rather than a parameter.
  --
  -- Implementation note, because this is not the obvious shape. The enabling
  -- flag lives in the parent's rules jsonb at phase_funded.drawdown.lock.
  -- enabled, and a CHECK constraint cannot read another table. Rather than
  -- push the guarantee into a trigger (which is a weaker control: it can be
  -- disabled, and it fires per row rather than per constraint), the flag is
  -- MATERIALIZED here alongside every other value this table materializes at
  -- publish. That is exactly what this table is for. The publish path writes
  -- both, and CV-publish validation asserts the materialized flag matches the
  -- parent's jsonb.
  floor_lock_enabled         boolean NOT NULL,             -- SD-10
  floor_lock_at_profit_cents bigint NULL CHECK (floor_lock_at_profit_cents > 0),
  floor_lock_floor_at_cents  bigint NULL CHECK (floor_lock_floor_at_cents > 0),

  created_at                 timestamptz NOT NULL DEFAULT now(),

  -- SD-10. Both values present when the lock is enabled, both absent when it
  -- is not. The second half matters as much as the first: a disabled lock
  -- carrying stale values is a lock that turns on with the wrong numbers the
  -- day someone flips the flag.
  CONSTRAINT plan_version_sizes_floor_lock_complete CHECK (
    (floor_lock_enabled = true
       AND floor_lock_at_profit_cents IS NOT NULL
       AND floor_lock_floor_at_cents IS NOT NULL)
    OR
    (floor_lock_enabled = false
       AND floor_lock_at_profit_cents IS NULL
       AND floor_lock_floor_at_cents IS NULL)
  ),

  -- CV-11. The buffer must exceed the locked-floor offset, which is what
  -- guarantees a post-payout balance of size + buffer sits above any locked
  -- floor. Together with R-48 this is INV-21: a settled payout can never
  -- breach the account that earned it.
  CONSTRAINT plan_version_sizes_buffer_clears_lock CHECK (
    floor_lock_enabled = false
    OR size_cents + buffer_cents > floor_lock_floor_at_cents
  )
);

CREATE UNIQUE INDEX plan_version_sizes_version_size_uq
  ON plan_version_sizes (plan_version_id, size_cents);

COMMENT ON COLUMN plan_version_sizes.floor_lock_enabled IS
  'SD-10. Materialized from the parent rules jsonb at publish so the '
  'conditional not-null can be a CHECK rather than a trigger.';

-- -----------------------------------------------------------------------------
-- tos_versions / tos_acceptances
-- -----------------------------------------------------------------------------
CREATE TABLE tos_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document      text NOT NULL CHECK (document IN (
                  'tos', 'privacy', 'risk_disclosure', 'affiliate_tos'
                )),
  version       integer NOT NULL CHECK (version > 0),
  body_md       text NOT NULL,
  effective_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tos_versions_document_version_uq
  ON tos_versions (document, version);

COMMENT ON TABLE tos_versions IS
  'Immutable once effective_at has passed. A document a trader accepted '
  'cannot be edited into one they did not.';

-- The row that proves what a trader agreed to and when, which is the first
-- thing any enforcement dispute asks for. APPEND-ONLY.
CREATE TABLE tos_acceptances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  tos_version_id  uuid NOT NULL REFERENCES tos_versions(id) ON DELETE RESTRICT,
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  ip              inet NOT NULL,
  user_agent      text NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tos_acceptances_identity_version_uq
  ON tos_acceptances (identity_id, tos_version_id);

-- -----------------------------------------------------------------------------
-- geo_restrictions
-- -----------------------------------------------------------------------------
-- Checkout and login behave differently, which is why this is a three-value
-- rule rather than a boolean.
CREATE TABLE geo_restrictions (
  country_code    char(2) PRIMARY KEY,
  rule            text NOT NULL CHECK (rule IN ('block_purchase', 'block_all', 'warn')),

  -- Counsel's rationale. Versioned by row history in events, because "why is
  -- this country blocked" is a question with a legal answer.
  reason          text NOT NULL,
  effective_from  date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- contract_specs
-- -----------------------------------------------------------------------------
-- B4 #14 exists because someone always hardcodes a multiplier. Tick size is an
-- EXACT RATIONAL, never a float, for the same reason money is integer cents.
CREATE TABLE contract_specs (
  symbol                 text NOT NULL,
  exchange               text NOT NULL,
  tick_size_numerator    bigint NOT NULL CHECK (tick_size_numerator > 0),
  tick_size_denominator  bigint NOT NULL CHECK (tick_size_denominator > 0),
  tick_value_cents       bigint NOT NULL CHECK (tick_value_cents > 0),
  currency               char(3) NOT NULL DEFAULT 'USD',
  is_micro               boolean NOT NULL DEFAULT false,

  -- Versioned because specs change. effective_to null means current.
  effective_from         date NOT NULL,
  effective_to           date NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (symbol, effective_from),

  CONSTRAINT contract_specs_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX contract_specs_current_idx
  ON contract_specs (symbol) WHERE effective_to IS NULL;

-- -----------------------------------------------------------------------------
-- trading_calendar
-- -----------------------------------------------------------------------------
-- THE TRADING DAY IS DATA, NEVER ARITHMETIC. Session boundaries are stored as
-- UTC instants derived from CT session definitions, so DST is a row rather
-- than a calculation (B4 #1). No engine rule ever derives a trading day from a
-- timestamp's UTC date.
CREATE TABLE trading_calendar (
  trading_day       date PRIMARY KEY,
  session_open_at   timestamptz NOT NULL,
  session_close_at  timestamptz NOT NULL,

  -- Counts as a FULL DAY (B4 #3). A half day that counted as half a day would
  -- make the minimum-trading-days gate a different promise in November.
  is_half_day       boolean NOT NULL DEFAULT false,

  -- Not a trading day at all.
  is_holiday        boolean NOT NULL DEFAULT false,

  -- Day counters advance, win days do NOT (B4 #2). A trader cannot earn a win
  -- day on a session the exchange halted, and cannot be penalised for one
  -- either.
  halted            boolean NOT NULL DEFAULT false,

  notes             text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trading_calendar_session_ordered CHECK (
    session_close_at > session_open_at
  ),

  -- A holiday has no session to contain fills in.
  CONSTRAINT trading_calendar_holiday_not_half_day CHECK (
    NOT (is_holiday AND is_half_day)
  )
);

COMMENT ON TABLE trading_calendar IS
  'Seeded years ahead, maintained as data, reviewed annually. The exchange '
  'session calendar (CT) is authoritative; storage is UTC.';

COMMIT;
