-- =============================================================================
-- 0014_marks
-- =============================================================================
-- E2 READ: MONEY PATH. daily_marks IS THE ONLY INPUT THE RULES ENGINE READS.
-- Three things need the founder's line-by-line read:
--
--   1. SD-01's adjustment_cents. NON-TRADING BALANCE MOVEMENTS MUST BE
--      DISTINGUISHABLE FROM TRADING P&L, or a payout looks like a
--      catastrophic loss and BREACHES THE ACCOUNT THAT EARNED IT (EC-034).
--      This is one of the three mechanisms behind INV-21 and it is the one
--      that lives in the schema.
--   2. SUPERSESSION, NEVER UPDATE (Wave 2 gate ruling 2). A correction
--      produces a NEW mark row and points the old one at it. An UPDATE erases
--      the first answer, and THE FIRST ANSWER IS WHAT A SETTLED PAYOUT WAS
--      BASED ON. This is the mechanism behind the never-claw-back promise
--      (B4 #5).
--   3. The partial unique index: EXACTLY ONE LIVE MARK PER ACCOUNT PER DAY.
--      It is in DATA_MODEL section 13's invariant table and it is enforced
--      here, by an index, not by a job.
--
-- Deltas folded: SD-01, SD-M2-06
--
-- V-M2-05 is the second-highest risk in the corpus and it lands on this file:
-- if non-trading movements are NOT applied between sessions and are not
-- distinguishable in the vendor's report, daily_marks needs an intraday
-- adjustment timestamp and M01's breach comparison changes shape. The column
-- below assumes the between-sessions answer, which is what the corpus assumes
-- everywhere, and the vendor call is what confirms it.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- daily_marks
-- -----------------------------------------------------------------------------
CREATE TABLE daily_marks (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  trading_day            date NOT NULL,

  opening_balance_cents  bigint NOT NULL,
  closing_balance_cents  bigint NOT NULL,
  high_balance_cents     bigint NOT NULL,

  -- THE BREACH COMPARISON INPUT. The day's low against the floor that was open
  -- at the start of the day (rule_states.floor_open_cents, SD-04).
  low_balance_cents      bigint NOT NULL,

  -- SIGNED. This is a movement, so it may be negative.
  realized_pnl_cents     bigint NOT NULL,

  fill_count             integer NOT NULL DEFAULT 0 CHECK (fill_count >= 0),

  -- fill_count > 0. Stored rather than derived because the engine reads it on
  -- every day of every account and a derived predicate is a derived predicate
  -- in every one of those reads.
  traded_day             boolean NOT NULL,

  -- realized_pnl_cents >= win_day_floor_cents at the account's PLAN VERSION.
  -- Evaluated against the pinned version, never against a current parameter.
  win_day                boolean NOT NULL,

  -- SD-01. NON-TRADING BALANCE MOVEMENTS: a settled withdrawal today, a
  -- promotional credit later. SIGNED.
  --
  -- Why this column is a money-path item rather than bookkeeping: without it,
  -- a settled payout of $2,500 leaving the platform balance is
  -- INDISTINGUISHABLE FROM A $2,500 TRADING LOSS. The breach check would
  -- compare a balance reduced by the trader's own earnings against a floor
  -- that has not moved, and BREACH THE ACCOUNT THAT EARNED THE PAYOUT
  -- (EC-034).
  --
  -- The movement is applied at the OPEN of the effective trading day
  -- (R-10, and payout_requests.effective_trading_day, SD-03), never inside a
  -- session. The floor is recomputed in the same step as the balance drop, so
  -- balance and floor move together (R-48). Those two plus CV-11's buffer
  -- clearance are INV-21, which GS-065 asserts directly.
  --
  -- It also makes INV-18 checkable at all:
  --   closing = opening + realized_pnl + adjustment.
  adjustment_cents       bigint NOT NULL DEFAULT 0,              -- SD-01

  -- Digest of the exact input rows. What makes a recomputation provably the
  -- same computation.
  source_hash            bytea NOT NULL,

  source                 text NOT NULL CHECK (source IN (
                           'report', 'api', 'recomputed', 'simulated'
                         )),                                     -- B3 reservation

  -- B3 reservation (report_file_id). Null when recomputed.
  ingest_file_id         uuid NULL REFERENCES ingest_files(id) ON DELETE RESTRICT,

  -- A CORRECTION PRODUCES A NEW MARK ROW AND POINTS THE OLD ONE HERE. Never an
  -- UPDATE. Replay must be able to show what we believed ON THE DAY and what
  -- we believe now.
  superseded_by          bigint NULL REFERENCES daily_marks(id) ON DELETE RESTRICT,

  computed_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- INV-18, now checkable because SD-01 exists. The day's arithmetic closes.
  CONSTRAINT daily_marks_balance_arithmetic CHECK (
    closing_balance_cents = opening_balance_cents
                          + realized_pnl_cents
                          + adjustment_cents
  ),

  -- The high and low bound the day they describe.
  CONSTRAINT daily_marks_high_bounds_day CHECK (
    high_balance_cents >= greatest(opening_balance_cents, closing_balance_cents)
  ),
  CONSTRAINT daily_marks_low_bounds_day CHECK (
    low_balance_cents <= least(opening_balance_cents, closing_balance_cents)
  ),

  -- traded_day is fill_count > 0, by definition rather than by convention.
  CONSTRAINT daily_marks_traded_day_matches_fills CHECK (
    traded_day = (fill_count > 0)
  ),

  -- A win day is a traded day. A day with no fills cannot clear a profit
  -- floor, and a win day recorded on an untraded day is a counter that
  -- advanced for free.
  CONSTRAINT daily_marks_win_day_implies_traded CHECK (
    win_day = false OR traded_day = true
  ),

  CONSTRAINT daily_marks_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
  )
);

-- EXACTLY ONE LIVE MARK PER ACCOUNT PER DAY. DATA_MODEL section 13's
-- invariant, enforced by a partial unique index rather than by a job.
CREATE UNIQUE INDEX daily_marks_live_per_account_day_uq
  ON daily_marks (account_id, trading_day) WHERE superseded_by IS NULL;

CREATE INDEX daily_marks_trading_day_idx ON daily_marks (trading_day);
CREATE INDEX daily_marks_account_day_desc_idx
  ON daily_marks (account_id, trading_day DESC);
CREATE INDEX daily_marks_superseded_idx
  ON daily_marks (superseded_by) WHERE superseded_by IS NOT NULL;

COMMENT ON TABLE daily_marks IS
  'Append-only, including supersession. Retention: forever. The only input '
  'the rules engine reads.';

COMMENT ON COLUMN daily_marks.adjustment_cents IS
  'SD-01. Signed non-trading movement, applied at the OPEN of the effective '
  'trading day, never inside a session. Without it a settled payout is '
  'indistinguishable from a trading loss (EC-034).';

-- -----------------------------------------------------------------------------
-- reconciliations
-- -----------------------------------------------------------------------------
-- A 'mismatch' sets accounts.recon_blocked = true and blocks eligibility until
-- a HUMAN resolves it. recon is a CONTEXT gate, never part of the replayed
-- state (INV-23, SD-06): it was true on the day and may not be true now.
CREATE TABLE reconciliations (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  trading_day            date NOT NULL,
  our_balance_cents      bigint NOT NULL,
  platform_balance_cents bigint NOT NULL,

  -- Generated, so the two sides and their difference can never disagree.
  delta_cents            bigint GENERATED ALWAYS AS
                           (our_balance_cents - platform_balance_cents) STORED,

  status                 text NOT NULL CHECK (status IN ('match', 'mismatch', 'resolved')),
  resolved_by            text NULL,
  resolution_note        text NULL,

  -- SD-M2-06. A MISMATCH IS ONLY ACTIONABLE IF YOU CAN NAME THE TWO DOCUMENTS
  -- THAT DISAGREED.
  --
  -- source_ingest_file_id records which file carried the VENDOR's number.
  -- our_source records which of our two internal balance derivations we
  -- compared: the rule state's balance, or the ledger's. They can disagree
  -- with each other as well as with the vendor, and a nightly alarm that does
  -- not say which pair diverged is a five-hour diagnosis instead of a
  -- five-minute one (FM-M2-08).
  source_ingest_file_id  uuid NULL REFERENCES ingest_files(id)
                           ON DELETE RESTRICT,                   -- SD-M2-06
  our_source             text NULL CHECK (our_source IN ('rule_state', 'ledger')),
                                                                 -- SD-M2-06

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reconciliations_resolution_is_explained CHECK (
    status <> 'resolved' OR (resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
  ),

  -- SD-M2-06. A mismatch names both documents. This is the constraint that
  -- turns the delta from two available columns into two required ones at the
  -- moment they matter.
  CONSTRAINT reconciliations_mismatch_names_sources CHECK (
    status = 'match' OR our_source IS NOT NULL
  ),

  -- A match has a zero delta and a mismatch does not, by construction rather
  -- than by the writer's care.
  CONSTRAINT reconciliations_status_matches_delta CHECK (
    (status = 'match' AND our_balance_cents = platform_balance_cents)
    OR
    (status <> 'match' AND our_balance_cents <> platform_balance_cents)
  )
);

CREATE UNIQUE INDEX reconciliations_account_day_uq
  ON reconciliations (account_id, trading_day);

-- The blocking set: unresolved mismatches, which are the accounts excluded
-- from eligibility this morning.
CREATE INDEX reconciliations_open_mismatch_idx
  ON reconciliations (trading_day) WHERE status = 'mismatch';

COMMIT;
