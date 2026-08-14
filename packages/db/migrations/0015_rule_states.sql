-- =============================================================================
-- 0015_rule_states
-- =============================================================================
-- E2 READ: MONEY PATH. This is the engine's own record, one row per account
-- per trading day, and it is the table replay compares against. Five things
-- need the founder's line-by-line read:
--
--   1. SD-02's TWO ANCHORS. payout_anchor_day and cadence_anchor_day are
--      genuinely different dates and CONFLATING THEM IS A SILENT LIABILITY
--      CHANGE OF 40 PERCENT (EC-039). They coincide under ADR-019's current
--      configuration and they STAY SEPARATE COLUMNS (C-09), because
--      collapsing them because today's configuration makes them equal is
--      exactly the silent fold this session exists to prevent.
--   2. SD-06's GATE SPLIT. Freeze, recon, KYC and in-flight are NOT
--      REPLAYABLE: they were true on the day and may not be true now. Mixing
--      them into the replayed state guarantees nightly false divergences
--      (INV-23), and FM-17 is what happens next: a self-audit that becomes
--      noisy becomes a self-audit that gets disabled.
--   3. SD-08's state_hash AND ITS INPUT LIST. Nothing in the corpus recorded
--      which columns the hash covers until ADR-026 C-07 wrote it down. The
--      list is reproduced below in full, in order, because a hash whose input
--      set is implicit is a hash that changes meaning when a column is added.
--   4. context_gates IS EXCLUDED FROM THE HASH. If it entered, a freeze
--      applied last March would produce a divergence every night until
--      someone disabled the audit.
--   5. withdrawable_cents >= 0 ALWAYS. DATA_MODEL section 13's invariant, a
--      CHECK constraint here and a property test over generated day sequences
--      in the suite.
--
-- Deltas folded: SD-02, SD-04, SD-06, SD-07, SD-08
-- Findings:      C-07 (ADR-026, the state_hash input list), C-09 (two anchors)
--
-- Per account PER TRADING DAY, not a single current row. Roughly 250 rows per
-- funded account per year, confirmed at the Wave 2 gate: it is the difference
-- between an account timeline that reconstructs itself and one that has to be
-- recomputed on demand.
-- =============================================================================

BEGIN;

CREATE TABLE rule_states (
  id                              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id                      uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  trading_day                     date NOT NULL,

  -- Phase as of the END of this day.
  phase                           text NOT NULL,

  -- The floor AFTER this day.
  floor_cents                     bigint NOT NULL,
  floor_locked                    boolean NOT NULL DEFAULT false,

  -- SD-04. THE FLOOR THIS DAY'S BREACH CHECK COMPARED AGAINST.
  --
  -- floor_cents is the floor that SURVIVED the day; floor_open_cents is the
  -- one the day was JUDGED against. On any day where the floor moved, they
  -- differ, and the evidence pack must be able to show which one produced a
  -- breach decision (EC-035). Without it, a breach explanation reads "your low
  -- was below the floor" while showing a floor the low was never compared to.
  floor_open_cents                bigint NOT NULL,               -- SD-04

  high_water_balance_cents        bigint NOT NULL,   -- drives trailing
  balance_cents                   bigint NOT NULL,   -- end-of-day balance

  -- Derived, stored for query speed. NEVER NEGATIVE (DATA_MODEL section 13).
  withdrawable_cents              bigint NOT NULL CHECK (withdrawable_cents >= 0),

  traded_days_count               integer NOT NULL CHECK (traded_days_count >= 0),

  -- Resets to 0 after a SETTLED payout, anchored on payout_anchor_day below.
  win_days_count                  integer NOT NULL CHECK (win_days_count >= 0),

  -- The consistency gate's two halves. The gate is SKIPPED when the
  -- denominator is <= 0, which is why the denominator is stored rather than
  -- inferred from a sign.
  consistency_best_day_cents      bigint NOT NULL DEFAULT 0,
  consistency_period_profit_cents bigint NOT NULL DEFAULT 0,

  -- SD-07. Derivable, and stored anyway, for two reasons that are worth more
  -- than the column: it makes engine_gates SELF-DESCRIBING in the portal and
  -- the evidence pack, and it turns a class of off-by-one bugs into a VISIBLE
  -- FIELD (EC-045).
  --
  -- R-47 defines the period as trading days STRICTLY AFTER the anchor. The
  -- same rule applies at funded start, where the eval pass day is excluded.
  -- That boundary now lives in a column rather than in someone's head
  -- (GS-068).
  consistency_period_start_day    date NULL,                     -- SD-07

  -- Drives the ladder and the cap schedule. SETTLEMENTS, not attempts
  -- (R-45, SD-05).
  payouts_settled_count           integer NOT NULL CHECK (payouts_settled_count >= 0),

  -- SD-02. THE TWO ANCHORS, replacing last_payout_trading_day.
  --
  -- payout_anchor_day  the last settled payout's BASIS day. Resets win days
  --                    and starts the consistency period.
  -- cadence_anchor_day that payout's EFFECTIVE day. Drives the cadence gap.
  --
  -- They are different dates. Under ADR-019 they coincide today, and that is
  -- precisely the trap: a single column would work perfectly until the anchor
  -- moved back, at which point the gap between payouts changes by 40 percent
  -- and nothing in the schema records that two facts had been merged
  -- (EC-039, C-09).
  --
  -- BOTH ARE IN THE STATE HASH and both stay separate columns.
  payout_anchor_day               date NULL,                     -- SD-02
  cadence_anchor_day              date NULL,                     -- SD-02

  -- SD-06. THE VERDICT, SPLIT.
  --
  -- engine_eligible is the ENGINE's verdict from ENGINE gates only. It is
  -- replayable by construction: the same marks and the same plan version
  -- produce the same answer forever.
  --
  -- The trader's actual eligibility is engine_eligible AND every context gate,
  -- and that combined answer is DELIBERATELY NOT STORED HERE, because it is
  -- not a property of the day; it is a property of the moment it was asked.
  engine_eligible                 boolean NOT NULL,              -- SD-06

  -- Gate-by-gate booleans plus the numbers behind them, so the portal renders
  -- truth rather than recomputing it.
  --
  -- engine_gates:  profit target, drawdown, win days, minimum days,
  --                consistency, cadence, cap, minimum payout. Replayable.
  --                IN THE HASH.
  -- context_gates: freeze, recon_blocked, KYC, in-flight. NOT replayable.
  --                NOT IN THE HASH (INV-23).
  engine_gates                    jsonb NOT NULL,                -- SD-06
  context_gates                   jsonb NOT NULL,                -- SD-06

  -- SD-08. SHA-256 over a canonical serialization of the state.
  --
  -- Replay compares HASHES FIRST and diffs fields only on mismatch. Without
  -- it, the nightly audit is a full field-by-field comparison of roughly 1.25M
  -- rows, which is the cost that makes an audit slow, and FM-17 says a
  -- self-audit that becomes slow becomes one that gets disabled.
  --
  -- THE INPUT LIST (ADR-026 C-07). Fields in this exact declared order,
  -- bigint rendered base-10, null as an explicit sentinel, no whitespace:
  --
  --    1. account_id                     11. win_days_count
  --    2. trading_day                    12. consistency_best_day_cents
  --    3. phase                          13. consistency_period_profit_cents
  --    4. floor_cents                    14. consistency_period_start_day  SD-07
  --    5. floor_locked                   15. payouts_settled_count
  --    6. floor_open_cents        SD-04  16. payout_anchor_day             SD-02
  --    7. high_water_balance_cents       17. cadence_anchor_day            SD-02
  --    8. balance_cents                  18. engine_eligible               SD-06
  --    9. withdrawable_cents             19. engine_gates                  SD-06
  --   10. traded_days_count
  --
  -- EXCLUDED, each for a stated reason:
  --   context_gates   the whole reason SD-06 split them (INV-23)
  --   engine_version  a build identifier is not state; including it makes
  --                   every engine upgrade a universal divergence
  --   computed_at     wall clock, not state
  --   id, state_hash  surrogate key, and the hash itself
  state_hash                      bytea NOT NULL,                -- SD-08

  -- Which build produced this row. Required for replay COMPARISON and
  -- deliberately excluded from the hash it is compared with.
  engine_version                  text NOT NULL,

  computed_at                     timestamptz NOT NULL DEFAULT now(),
  created_at                      timestamptz NOT NULL DEFAULT now(),

  -- SD-02. Both anchors are set by the same settlement, so they appear and
  -- disappear together. One present and the other absent means a settlement
  -- was recorded halfway, which is the state the two-column split exists to
  -- make visible rather than to permit.
  CONSTRAINT rule_states_anchors_move_together CHECK (
    (payout_anchor_day IS NULL AND cadence_anchor_day IS NULL)
    OR
    (payout_anchor_day IS NOT NULL AND cadence_anchor_day IS NOT NULL)
  ),

  -- The cadence anchor is the effective day of the payout whose basis day is
  -- the payout anchor, and a balance cannot reflect a withdrawal before the
  -- decision that authorised it.
  CONSTRAINT rule_states_cadence_anchor_not_before_payout_anchor CHECK (
    payout_anchor_day IS NULL OR cadence_anchor_day >= payout_anchor_day
  ),

  -- SD-02. An account with settled payouts has anchors; one with none has
  -- neither. This is the constraint that would have failed loudly if the two
  -- columns had been collapsed into one and half-populated.
  CONSTRAINT rule_states_settlements_imply_anchors CHECK (
    (payouts_settled_count = 0) = (payout_anchor_day IS NULL)
  ),

  -- SD-07. A consistency period that has started is not in the future.
  CONSTRAINT rule_states_consistency_period_started CHECK (
    consistency_period_start_day IS NULL
    OR consistency_period_start_day <= trading_day
  ),

  -- The best day cannot exceed the period's profit when the period is
  -- positive. When the denominator is <= 0 the gate is skipped and the
  -- relation carries no meaning, so the constraint does not assert one.
  CONSTRAINT rule_states_consistency_numerator_within_denominator CHECK (
    consistency_period_profit_cents <= 0
    OR consistency_best_day_cents <= consistency_period_profit_cents
  ),

  -- The high-water mark is a maximum and never falls below the balance it
  -- tracks.
  CONSTRAINT rule_states_high_water_bounds_balance CHECK (
    high_water_balance_cents >= balance_cents
  ),

  -- Win days cannot exceed traded days: a win day is a traded day
  -- (daily_marks_win_day_implies_traded, 0014).
  CONSTRAINT rule_states_win_days_within_traded_days CHECK (
    win_days_count <= traded_days_count
  ),

  -- SD-08. A hash is a SHA-256 digest or it is not a hash.
  CONSTRAINT rule_states_hash_is_sha256 CHECK (length(state_hash) = 32)
);

-- One state row per account per trading day. Total, not partial: unlike
-- daily_marks, a rule state is never superseded. A correction to the inputs
-- produces a REPLAY, and the replay's divergence is the finding.
CREATE UNIQUE INDEX rule_states_account_day_uq ON rule_states (account_id, trading_day);

CREATE INDEX rule_states_account_day_desc_idx
  ON rule_states (account_id, trading_day DESC);

-- SD-06. The eligible-next-7-days forecast source. Partial on the ENGINE
-- verdict, because that is the only one this table holds.
CREATE INDEX rule_states_engine_eligible_idx
  ON rule_states (trading_day) WHERE engine_eligible;

-- SD-08. The nightly replay audit's comparison read.
CREATE INDEX rule_states_day_hash_idx ON rule_states (trading_day, account_id)
  INCLUDE (state_hash);

COMMENT ON TABLE rule_states IS
  'Append-only. Retention: forever. One row per account per trading day. '
  'Replay reproduces these rows byte-identically (DATA_MODEL section 13).';

COMMENT ON COLUMN rule_states.state_hash IS
  'SD-08. SHA-256 over the 19 fields listed in ADR-026 C-07, in declared '
  'order. context_gates, engine_version and computed_at are excluded.';

COMMENT ON COLUMN rule_states.context_gates IS
  'SD-06. Freeze, recon, KYC, in-flight. NOT replayable and NOT in the state '
  'hash (INV-23). They were true on the day and may not be true now.';

COMMIT;
