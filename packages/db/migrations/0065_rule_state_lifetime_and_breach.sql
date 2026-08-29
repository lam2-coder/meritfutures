-- =============================================================================
-- 0065_rule_state_lifetime_and_breach
-- =============================================================================
-- E2 READ: MONEY PATH. Three columns, added to the engine's own record. Nothing
-- here edits a merged file: 0015_rule_states stays exactly as it was written and
-- this file changes what it installed, which is constitution E2's mechanism
-- rather than an exception to it.
--
-- ADR-207, status `proposed`, approval line UNSIGNED. SEVEN things need the
-- founder's line-by-line read:
--
--   1. THE BLOCKER IS LIVE RATHER THAN THEORETICAL. databaseAccountReads is
--      wired in production (apps/api/src/start.ts) and its readEligibility
--      REJECTS on ELIGIBILITY_BLOCKER for these exact three fields. A trader
--      asking whether they are eligible today gets a rejection because a
--      column does not exist. RuleState requires lifetimeSettledCents, breached
--      and breachKind, and 0015 declares none of the three. Re-derived live:
--      NO COLUMN NAMED '%breach%' EXISTS IN ANY OF THE 115 TABLES, and
--      lifetime_settled matches nothing in any of the 60 migrations, so the
--      absence is estate-wide and not local to this table.
--
--   2. THE THREE ARE NOT IN THE STATE HASH AND THIS FILE DOES NOT RULE THAT
--      THEY NEVER WILL BE. ADR-026 C-07 fixes NINETEEN inputs and hash.ts's
--      HASHED_COLUMNS is the only executable copy of that list; it lives in
--      packages/rules-engine, which this fence does not hold. So the nineteen
--      stay nineteen TODAY, by the fact that nothing here moves them, and the
--      state_hash comment below records the three as UNRULED rather than as
--      excluded. THAT IS THE DIFFERENCE FROM 0035, which added a column and
--      ruled it EXCLUDED on ADR-047's own reason. There is no such reason here:
--      all three are replayable engine state, indistinguishable in kind from
--      payouts_settled_count (input 15) and phase (input 3), which ARE hashed.
--      ADR-207 section 5 states the decision the founder owes and why it is
--      free today: the table holds ZERO rows and no writer exists.
--
--   3. breached IS DERIVABLE FROM breach_kind AND IS STORED ANYWAY, DELIBERATELY.
--      Read at all five engine sites: advance.ts:125-126 (false, null),
--      advance.ts:321-322 (true, kind, under a `kind !== null` guard),
--      progression.ts:165-166 (false, null on EXPIRY, which is the case that
--      stops phase deciding this), breach.ts:75 (false, null) and breach.ts:88
--      (true, a total BreachKind). breached is true exactly when the kind is
--      not null. It is stored because the redundancy is the DETECTOR for the
--      realistic adapter defect: a mapping that carries one of the two fields
--      and drops the other is REFUSED by rule_states_breach_flag_matches_kind,
--      loudly, at the store. A generated column would make that same omission
--      write a row saying a breached account is not breached, silently, which
--      is the worst available failure on this path. This is the idiom
--      rule_states_settlements_imply_anchors already established on this table.
--
--   4. phase DOES NOT DECIDE breached AND THAT IS WHY BOTH EXIST. An EXPIRED
--      account is phase 'closed' with breached false (progression.ts:163-166's
--      own comment: "a consumer reading breachKind to explain the closure would
--      otherwise be told a drawdown type that never happened"). Any constraint
--      binding breached to phase is therefore refused here; the header of
--      ADR-207 section 6 records the three constraints refused and why.
--
--   5. THE VOCABULARY IN THE CHECK IS A COPY AND THE COMPARATOR IS THE CONTROL.
--      Three literals appear below and the same three appear in BreachKind at
--      packages/rules-engine/src/types.ts. Two copies of one statement with
--      nothing comparing them is FM-16 and this corpus has found it four times.
--      packages/db/test/rule-state-breach-vocabulary.test.ts DERIVES the union
--      from that file and compares it to this file, set for set and in order,
--      and fails naming both if a fourth member is added there.
--
--   6. THE DEFAULTS ARE THE ENGINE'S OWN INITIAL STATE, NOT A CONVENIENCE.
--      advance.ts:124-126 opens a fold at lifetimeSettledCents 0n, breached
--      false, breachKind null. They are also FORCED: five committed probe
--      scripts under scripts/db insert into rule_states with explicit column
--      lists that name none of these three, and all five are wired in
--      corpus.yml. A NOT NULL without a default would turn sixteen CI probes
--      red. Measured, not assumed; the A/B is in DELTA_MANIFEST section 30.
--
--   7. THE LIFETIME CONSTRAINT IS ONE-DIRECTIONAL AND THE BICONDITIONAL IS
--      REFUSED ON EVIDENCE. The tempting shape is
--      (payouts_settled_count = 0) = (lifetime_settled_cents = 0), mirroring
--      rule_states_settlements_imply_anchors exactly. It is WRONG: 0010's
--      payout_requests.approved_cents carries CHECK (approved_cents >= 0), so
--      the estate admits a settled payout of exactly zero cents, and
--      settle.ts:161 accumulates that value. One such settlement gives a row
--      with count 1 and lifetime 0, which the biconditional would refuse. The
--      implication that IS true in both directions of the estate's own
--      guarantees is: no settlements, no lifetime total.
--
-- Deltas folded: none. This is a schema delta with no SD-nn, for 0064's reason:
--                the reservation allocated no SD and the reasoning a founder
--                would otherwise read in one is in ADR-207 and in the
--                DELTA_MANIFEST section this file lands with.
-- Findings:      the state-hash question (item 2), which is RECORDED AND NOT
--                TAKEN, and the phase-vocabulary gap in section 9 of ADR-207.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- The three columns
-- -----------------------------------------------------------------------------
-- R-50. INV-17 bounds this at `ladder * max cap in the schedule`, which is the
-- liability bound the whole plan lineup rests on (AS-03, RE-P-17). That bound
-- is not written here: it reads plan_version_sizes and is therefore not
-- row-local, and a CHECK that cannot see its own operand is not a control.
ALTER TABLE rule_states
  ADD COLUMN lifetime_settled_cents bigint NOT NULL DEFAULT 0
    CHECK (lifetime_settled_cents >= 0);

-- DO-4, DO-5. Terminal and immediate: a breach beats every pass, target and
-- eligibility condition the same day might also satisfy (R-24, R-25).
ALTER TABLE rule_states
  ADD COLUMN breached boolean NOT NULL DEFAULT false;

-- BreachKind, in the order packages/rules-engine/src/types.ts declares it.
-- text with a CHECK rather than a new ENUM type, on three measured reasons
-- stated in full in ADR-207 section 4: every one of the estate's thirteen enum
-- types is created in 0001 and no migration since has added one; this table
-- ALREADY stores an engine union as bare text (phase, against an account_phase
-- type that exists and that only accounts.phase uses); and a CHECK narrows by
-- DROP and re-ADD under one name, which is constitution E2's own stated
-- mechanism, while an enum value can be added and can never be removed.
ALTER TABLE rule_states
  ADD COLUMN breach_kind text NULL;

-- -----------------------------------------------------------------------------
-- The constraints
-- -----------------------------------------------------------------------------
-- The closed vocabulary. NULL is the not-breached value and passes, which is
-- deliberate: the flag below is what makes the pair total.
ALTER TABLE rule_states
  ADD CONSTRAINT rule_states_breach_kind_is_a_breach_kind CHECK (
    breach_kind IS NULL
    OR breach_kind IN ('trailing_eod_floor', 'static_floor', 'hard_daily_loss_limit')
  );

-- Header item 3. The pair moves together or the row is refused.
ALTER TABLE rule_states
  ADD CONSTRAINT rule_states_breach_flag_matches_kind CHECK (
    breached = (breach_kind IS NOT NULL)
  );

-- Header item 7. One direction only, and the other is refused on 0010's
-- approved_cents >= 0.
ALTER TABLE rule_states
  ADD CONSTRAINT rule_states_no_settlements_no_lifetime_total CHECK (
    payouts_settled_count > 0 OR lifetime_settled_cents = 0
  );

-- -----------------------------------------------------------------------------
-- The contract comments
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN rule_states.lifetime_settled_cents IS
  'R-50. Gross cents settled to this account over its whole life, accumulated '
  'at settlement beside payouts_settled_count (settle.ts). Monotone '
  'non-decreasing. INV-17 bounds it at ladder * max cap, which reads '
  'plan_version_sizes and is therefore not a row-local CHECK. NOT among the '
  'nineteen state_hash inputs, and see that column comment: unruled rather '
  'than excluded.';

COMMENT ON COLUMN rule_states.breached IS
  'DO-5. Derivable from breach_kind and stored anyway. The redundancy is the '
  'detector: an adapter that carries one of the pair and drops the other is '
  'refused by rule_states_breach_flag_matches_kind rather than writing a row '
  'that says a breached account is not breached. NOT among the nineteen '
  'state_hash inputs, and see that column comment.';

COMMENT ON COLUMN rule_states.breach_kind IS
  'DO-4. Which rule closed the account, so the evidence pack can say which one '
  '(0015 and breach.ts:54). BreachKind''s three members, and the CHECK is a '
  'COPY of packages/rules-engine/src/types.ts whose comparator is '
  'packages/db/test/rule-state-breach-vocabulary.test.ts. NULL means not '
  'breached, including on an EXPIRED account, which is phase closed and '
  'breached false. NOT among the nineteen state_hash inputs, and see that '
  'column comment.';

-- SUPERSEDES 0035's comment, which superseded 0015's. 0015 and 0035 are merged
-- and are not edited.
--
-- THE SUBSTRING 'calendar_revision_id are excluded' IS LOAD-BEARING:
-- scripts/db/probe_rule_states_calendar_revision.sql SUCCESS 6 asserts it
-- literally, on ADR-047's ruling that naming the column is not the same as
-- naming which side of the line it falls on. It is preserved verbatim.
--
-- THE THREE COLUMNS THIS MIGRATION ADDS ARE RECORDED AS UNRULED AND NOT AS
-- EXCLUDED, and the distinction is the point. Every existing exclusion carries
-- a reason of its own kind: context_gates is not replayable (INV-23),
-- engine_version and calendar_revision_id are version-like INPUTS to the fold
-- rather than facts it produced (ADR-047), computed_at is wall clock. These
-- three are none of those. They are replayable facts the fold produced, which
-- is what inputs 3 and 15 are, and the only reason they are outside the hash
-- today is that HASHED_COLUMNS lives in a package this migration does not
-- reach. A comment claiming them as excluded would read as a ruling nobody
-- made, which is exactly the failure C-07 exists to end.
COMMENT ON COLUMN rule_states.state_hash IS
  'SD-08. SHA-256 over the 19 fields listed in ADR-026 C-07, in declared '
  'order. context_gates, engine_version, computed_at and calendar_revision_id '
  'are excluded. calendar_revision_id is excluded on ADR-047 and for the same '
  'reason as engine_version: it is a version-like INPUT to the fold rather '
  'than a fact the fold produced, and hashing it turns a single calendar '
  'correction into a divergence on every row of every account at once. '
  '0065 adds lifetime_settled_cents, breached and breach_kind. They are NOT '
  'among the nineteen and they are NOT excluded either: they are UNRULED, and '
  'ADR-207 section 5 is the open question. All three are replayable facts the '
  'fold produced, which is what inputs 3 and 15 are, so none of the four '
  'exclusion reasons above reaches them. Deciding this costs nothing while '
  'the table is empty and gets more expensive with the first row.';

COMMIT;
