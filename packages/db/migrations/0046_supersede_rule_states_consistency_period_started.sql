-- =============================================================================
-- 0046_supersede_rule_states_consistency_period_started
-- =============================================================================
-- E2 READ: MONEY PATH. One constraint, superseded. Nothing here edits a merged
-- file: 0015_rule_states stays exactly as it was written, and this file changes
-- what it installed. Migrations are sacred once merged (constitution E2), which
-- is a rule about editing them, not a rule against correcting them.
--
-- ADR-079, status `proposed`. SIX things need the founder's line-by-line read:
--
--   1. THE DEFECT IS THAT EVERY EVAL PASS IS UNWRITABLE, not that an exotic row
--      is. The transcript is below, executed rather than predicted.
--   2. THE REFERENCE POINT CHANGES, NOT THE DIRECTION. R-47 defines the period
--      start against the ANCHOR; 0015 bounded it against the row's own
--      trading_day. That is why a correct engine produced a row a
--      correct-looking constraint refused.
--   3. THE ROW THAT MOTIVATED THIS CHANGE IS EXEMPT FROM ITS REPLACEMENT. On
--      the eval-pass row payout_anchor_day IS NULL, so the new constraint does
--      not apply to it. It inserts clean because the constraint is silent, not
--      because the constraint permits it. The new constraint binds from the
--      FIRST SETTLEMENT onward and the probe watches it refuse.
--   4. THE SCHEMA STOPS BOUNDING THE PERIOD START AGAINST trading_day ENTIRELY.
--      That is a real loss and section 3 of ADR-079 states it rather than
--      leaving it to be discovered.
--   5. THE PREDICATE IS TWO-VALUED BECAUSE OF THE TWO `IS NULL` GUARDS IT
--      WRITES, which is ADR-053's hazard inverted: there the predicate was
--      two-valued because of three NOT NULLs it never mentioned. A CHECK that
--      evaluates to NULL PASSES in PostgreSQL. Both columns here are NULLABLE
--      and the probe asserts that from the catalogue.
--   6. THE RETIRED NAME IS GONE FROM THE CATALOGUE rather than redefined, on
--      0036's and 0037's precedent, and the reason is stronger here: the
--      COMPARISON ITSELF changed, so a reader who greps the old name must find
--      nothing rather than a statement about a different reference point.
--
-- -----------------------------------------------------------------------------
-- THE DEFECT, EXECUTED ON POSTGRESQL 16.13 AT 0045, NOT PREDICTED
-- -----------------------------------------------------------------------------
-- 0001 to 0045 applied forward-only into an empty database under
-- ON_ERROR_STOP=1, then session 129's row 0 inserted verbatim: the eval pass
-- day 2026-01-01, with the consistency period starting 2026-01-02.
--
--   ERROR:  new row for relation "rule_states" violates check constraint
--           "rule_states_consistency_period_started"
--   DETAIL:  Failing row contains (1, 11400000-..., 2026-01-01, funded,
--            4750000, f, 4750000, 5000000, 5000000, 0, 0, 0, 0, 0,
--            2026-01-02, 0, null, null, f, {}, {}, \x13bb4ef8..., probe-0, ...)
--
-- progression.ts:339 writes `consistencyPeriodStartDay: nextDay.day.tradingDay`
-- on the pass day. THE ENGINE IS RIGHT. M01:563 states R-47 as
-- "consistencyPeriodStartDay = the next trading day after payoutAnchorDay",
-- M01:737 comments the same line `// R-47, strict`, and AS-12 at M01:987 says
-- the period is "trading days STRICTLY AFTER the anchor" and "the eval pass day
-- is excluded". Every account that passes an evaluation writes this row.
--
-- -----------------------------------------------------------------------------
-- WHY THE SETTLEMENT ROW NEVER TRIPPED IT, WHICH IS WHY NOBODY SAW THIS
-- -----------------------------------------------------------------------------
-- On a settlement row the anchor is the BASIS day, which is "The LAST CLOSED
-- DAY the decision used" (0010:63), and the row is written for the EFFECTIVE
-- day, "the FIRST TRADING DAY WHOSE OPENING BALANCE REFLECTS THE WITHDRAWAL"
-- (0010:97). So nextTradingDayAfter(basis) <= effective and the old predicate
-- held. IT HELD BY `<=` AND NOT BY EQUALITY: equality only when the effective
-- day is the very next trading day, and GS-068 is the case where it is not,
-- with basis 2026-11-25, effective 2026-11-27 and Thanksgiving between them.
--
-- Every case anybody thought to write was a case the constraint was right
-- about, which is 0037's finding one screen up and the same sentence applies.
--
-- -----------------------------------------------------------------------------
-- THE COST, ACCEPTED AND STATED RATHER THAN DISCOVERED LATER
-- -----------------------------------------------------------------------------
-- NOTHING IN THE SCHEMA NOW BOUNDS consistency_period_start_day AGAINST THE
-- ROW'S OWN trading_day, IN EITHER DIRECTION. A period start years in the
-- future is accepted on every row. Before the first settlement, where
-- payout_anchor_day IS NULL and therefore payouts_settled_count = 0 by
-- rule_states_settlements_imply_anchors (0015:188), NOTHING IS ASSERTED AT ALL.
--
-- THE TRUE BOUND IS NOT EXPRESSIBLE AS A CHECK. It is
-- `period_start <= nextTradingDayAfter(trading_day)`, and nextTradingDayAfter
-- is a lookup into trading_calendar; a CHECK cannot read another table. That is
-- the same wall ADR-053 hit when the freeze it wanted to assert turned out to
-- be a two-row property. A trigger could see it and is refused for 0036's
-- stated reason, that a trigger can be disabled and fires per row rather than
-- per constraint, and for a second reason of its own: it would have to identify
-- the reset row, no column marks one, and deriving a discriminator is exactly
-- the move ADR-053 section 3(b) refused.
--
-- WHAT HOLDS THE EVAL-PASS SHAPE INSTEAD IS THE FIXTURE AND PROPERTY LAYER,
-- GS-068 and RE-P-18. THE SCHEMA IS NOT A SECOND OPINION ON THAT ROW.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The constraint that compared against the wrong reference point
-- -----------------------------------------------------------------------------
-- Dropped rather than redefined under the same name, on 0036's and 0037's
-- reading of C-02. Reusing `rule_states_consistency_period_started` would leave
-- every existing reference pointing at a constraint whose meaning had silently
-- changed, and here the change is larger than a scope: the OTHER OPERAND moves,
-- from trading_day to payout_anchor_day. The name is retired with the statement
-- it made.
ALTER TABLE rule_states
  DROP CONSTRAINT rule_states_consistency_period_started;

-- -----------------------------------------------------------------------------
-- 2. R-47's own strictness, against the anchor R-47 names
-- -----------------------------------------------------------------------------
-- Reads: once an anchor exists, the consistency period starts strictly after
-- it. That is R-47 verbatim rather than a proxy for it, which is the bar
-- ADR-053 section 3(b) set when it refused a predicate that was only derivable,
-- and it is the invariant AS-12 is an attack on: if the basis day were included
-- in the new period, the very day that funded a payout would count against the
-- next cycle.
--
-- THE TWO `IS NULL` GUARDS ARE LOAD BEARING AND ARE WRITTEN RATHER THAN
-- ASSUMED. consistency_period_start_day and payout_anchor_day are both NULLABLE
-- in 0015. A CHECK that evaluates to NULL PASSES in PostgreSQL, so without the
-- guards this predicate would be three-valued and would admit every row with a
-- null on either side while its text still read correctly.
-- probe_consistency_period_after_anchor.sql asserts both nullabilities from the
-- catalogue for exactly that reason: if a later migration makes either column
-- NOT NULL, a guard here becomes dead code and the next reader should be told
-- by a failing probe rather than by inspection.
--
-- THE NAME CARRIES THE REFERENCE POINT. `rule_states_consistency_period_started`
-- said the bound was against the row's own day, which is the claim that was
-- wrong.
ALTER TABLE rule_states
  ADD CONSTRAINT rule_states_consistency_period_after_anchor CHECK (
    consistency_period_start_day IS NULL
    OR payout_anchor_day IS NULL
    OR consistency_period_start_day > payout_anchor_day
  );

-- -----------------------------------------------------------------------------
-- 3. The comments, so the superseded statement does not outlive the fix
-- -----------------------------------------------------------------------------
-- A COMMENT is replaceable metadata rather than migration text, so re-stating
-- the column comment here edits nothing: 0015 is untouched on disk and still
-- says what it said the day it merged. This is 0036's and 0037's treatment
-- applied a third time, and it is the only mechanism available, because the
-- `--` comment inside 0015 above the constraint can never be edited
-- (constitution E2) and still reads "SD-07. A consistency period that has
-- started is not in the future", which is the sentence that was wrong.
COMMENT ON COLUMN rule_states.consistency_period_start_day IS
  'SD-07. The first trading day of the current consistency period, stored so '
  'the boundary is visible in the portal and the evidence pack rather than '
  'living in someone''s head (AS-12). Set to nextTradingDayAfter(anchor) in '
  'both places that set it: R-47 at settlement, anchored to the BASIS day, and '
  'R-31 at the eval pass, anchored to the PASS day. NULL for the whole eval '
  'phase (advance.ts:120). ON THE EVAL-PASS ROW THIS COLUMN IS THE DAY AFTER '
  'trading_day AND THAT ROW IS CORRECT: the period is trading days STRICTLY '
  'AFTER the anchor and the pass day is excluded (M01 R-47, AS-12). ADR-079: '
  '0015 bounded this column against trading_day and therefore refused the '
  'state row of every account that passed an evaluation. The bound is now '
  'against the ANCHOR, which is the day R-47 actually names, and NOTHING here '
  'bounds this column against trading_day; the true bound needs a '
  'trading_calendar lookup and a CHECK cannot read another table. GS-068 and '
  'RE-P-18 hold the shape.';

COMMENT ON CONSTRAINT rule_states_consistency_period_after_anchor ON rule_states IS
  'ADR-079. Once an anchor exists, the consistency period starts STRICTLY '
  'after it (R-47, AS-12). Supersedes rule_states_consistency_period_started '
  '(0015), which bounded the period start against the row''s own trading_day '
  'and made every eval-pass row unwritable. Two-valued only because of the two '
  'IS NULL guards in its own text: consistency_period_start_day and '
  'payout_anchor_day are both NULLABLE and a CHECK evaluating to NULL passes. '
  'SILENT BEFORE THE FIRST SETTLEMENT, where payout_anchor_day IS NULL is '
  'exactly payouts_settled_count = 0 (rule_states_settlements_imply_anchors), '
  'so the eval-pass row that motivated ADR-079 is exempt rather than permitted.';

COMMIT;
