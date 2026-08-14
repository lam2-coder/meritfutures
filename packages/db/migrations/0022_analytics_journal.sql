-- =============================================================================
-- 0022_analytics_journal
-- =============================================================================
-- Not a money-path file, and one line in it is load bearing anyway:
--
--   round_trips.net_result_cents IS PRESENTATIONAL AND NEVER RECONCILES THE
--   ACCOUNT. daily_marks does that (INV-M13-02). Two numbers that both look
--   like "what this account made" is exactly how a second rulebook appears,
--   which is also why the analytics database role CANNOT READ PLAN CONFIG AT
--   ALL (0026). The separation is enforced by permission rather than by care.
--
-- Two other things worth reading:
--
--   1. SD-M13-01's derivation_version. GROUPING FILLS INTO ROUND TRIPS IS
--      GENUINELY AMBIGUOUS once scaling in and out, reversals and overnight
--      positions exist. Doing it at read time means the answer depends on
--      which query ran; doing it once, versioned, means A TRADER'S TRADE COUNT
--      IS STABLE and a change to the grouping rule is a visible, dated event.
--   2. SD-M13-02's soft delete. A TRADER WHO DELETES A NOTE EXPECTS IT GONE,
--      and a note that survives deletion in a backup is the difference between
--      a promise and a claim. deleted_at is the tombstone the hard-delete job
--      reads, not the end state.
--
-- Deltas folded: SD-M13-01, SD-M13-02, SD-M13-03
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- round_trips                                                   -- SD-M13-01
-- -----------------------------------------------------------------------------
CREATE TABLE round_trips (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  instrument         text NOT NULL,
  opened_at          timestamptz NOT NULL,
  closed_at          timestamptz NULL,   -- null while the position is open
  trading_day        date NOT NULL,
  direction          text NOT NULL CHECK (direction IN ('long', 'short')),
  max_size           integer NOT NULL CHECK (max_size > 0),

  -- The fills on each side. Arrays rather than a join table because the
  -- grouping IS the finding: which fills belong together is precisely what
  -- derivation_version pins.
  entry_fills        bigint[] NOT NULL,
  exit_fills         bigint[] NOT NULL DEFAULT '{}',

  gross_result_cents bigint NOT NULL,
  fee_cents          bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),

  -- PRESENTATIONAL. NEVER RECONCILES THE ACCOUNT (INV-M13-02). See the header.
  net_result_cents   bigint NOT NULL,

  -- SD-M13-01. INV-M13-10. Which grouping rule produced this row. A change to
  -- the rule is a visible, dated event rather than a trade count that quietly
  -- moved.
  derivation_version integer NOT NULL CHECK (derivation_version > 0), -- SD-M13-01

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT round_trips_net_arithmetic CHECK (
    net_result_cents = gross_result_cents - fee_cents
  ),
  CONSTRAINT round_trips_has_entry CHECK (array_length(entry_fills, 1) >= 1),
  CONSTRAINT round_trips_closed_has_exit CHECK (
    closed_at IS NULL OR array_length(exit_fills, 1) >= 1
  ),
  CONSTRAINT round_trips_ordered CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE INDEX round_trips_account_day_idx ON round_trips (account_id, trading_day DESC);
CREATE INDEX round_trips_open_idx
  ON round_trips (account_id) WHERE closed_at IS NULL;

COMMENT ON COLUMN round_trips.net_result_cents IS
  'Presentational. daily_marks reconciles the account, never this '
  '(INV-M13-02).';

-- -----------------------------------------------------------------------------
-- journal_entries                                               -- SD-M13-02
-- -----------------------------------------------------------------------------
-- The trader's own notes. Merit reads them for nothing.
CREATE TABLE journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id  uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  account_id   uuid NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  scope        text NOT NULL CHECK (scope IN ('day', 'round_trip')),
  reference_id uuid NULL,   -- the round_trip, when scope is round_trip

  body         text NOT NULL,
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- SD-M13-02. INV-M13-07. The TOMBSTONE, not the end state. A hard-delete job
  -- removes the row afterwards, which is what makes deletion a promise rather
  -- than a claim. The soft phase exists only so the delete is undoable inside
  -- a short window and so the job has something to find.
  deleted_at   timestamptz NULL,                                  -- SD-M13-02

  CONSTRAINT journal_entries_round_trip_has_reference CHECK (
    scope <> 'round_trip' OR reference_id IS NOT NULL
  )
);

CREATE INDEX journal_entries_identity_idx
  ON journal_entries (identity_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX journal_entries_reference_idx
  ON journal_entries (reference_id) WHERE reference_id IS NOT NULL;

-- SD-M13-02. The hard-delete job's queue.
CREATE INDEX journal_entries_pending_purge_idx
  ON journal_entries (deleted_at) WHERE deleted_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- analytics_snapshots                                           -- SD-M13-03
-- -----------------------------------------------------------------------------
-- INV-M13-06, AS-M13-07. The expensive shapes are computed ONCE PER ACCOUNT
-- PER CLOSED DAY in the batch, not per page load.
--
-- inputs_digest is what makes INV-M13-10 checkable: IF THE DIGEST CHANGED, THE
-- MARKS CHANGED, AND THE TRADER IS TOLD WHY. Without it, a corrected mark
-- silently changes a trader's historical statistics and the only evidence is
-- that they remember a different number.
CREATE TABLE analytics_snapshots (
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  as_of_trading_day date NOT NULL,
  payload           jsonb NOT NULL,
  inputs_digest     bytea NOT NULL,                               -- SD-M13-03
  computed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (account_id, as_of_trading_day)
);

CREATE INDEX analytics_snapshots_day_idx ON analytics_snapshots (as_of_trading_day);

COMMIT;
