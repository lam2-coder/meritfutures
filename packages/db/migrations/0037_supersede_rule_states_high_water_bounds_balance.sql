-- =============================================================================
-- 0037_supersede_rule_states_high_water_bounds_balance
-- =============================================================================
-- E2 READ: MONEY PATH. One constraint, superseded. Nothing here edits a merged
-- file: 0015_rule_states stays exactly as it was written, and this file changes
-- what it installed. Migrations are sacred once merged (constitution E2), which
-- is a rule about editing them, not a rule against correcting them.
--
-- ADR-053, status `proposed`. FIVE things need the founder's line-by-line read:
--
--   1. THE DEFECT IS THAT EVERY SUCCESSFUL FUNDED ACCOUNT IS UNWRITABLE, not
--      that an exotic row is. See the arithmetic below.
--   2. THE SCHEMA STOPS ASSERTING ANYTHING ABOUT hwb POST-LOCK. That is a real
--      loss and GS-016's own note names the field as the one that catches a
--      half-implemented lock. Section 3 states the cost rather than burying it.
--   3. THE PREDICATE IS TWO-VALUED ONLY BECAUSE OF THREE `NOT NULL`s IT DOES
--      NOT MENTION. A CHECK that evaluates to NULL PASSES in PostgreSQL. Drop
--      any one of those NOT NULLs later and this constraint silently becomes
--      one that admits everything, with its text unchanged.
--   4. NO CROSS-ROW FREEZE TRIGGER IS WRITTEN, and the reason is that R-31
--      resets hwb DOWNWARD at the funded reset while INV-07 versus that reset
--      is an OPEN FOUNDER ITEM. A trigger would have to take a side on it.
--   5. THE RETIRED NAME IS GONE FROM THE CATALOGUE rather than redefined, on
--      0036's precedent, so a reader who greps it finds nothing instead of
--      finding a statement whose meaning changed underneath them.
--
-- -----------------------------------------------------------------------------
-- THE ARITHMETIC, IN INTEGER CENTS, ON THE CASE THE CONSTRAINT REFUSES
-- -----------------------------------------------------------------------------
-- CORE-50K funded (M01 Appendix A.1 at 50K): size 5,000,000c, drawdown
-- 250,000c, floor_lock_at_profit 260,000c, locked floor 5,010,000c.
--
--   Day 1  close 5,260,000  profit 260,000 >= 260,000  -> LOCK ENGAGES
--                           hwb 5,260,000, FROZEN PERMANENTLY (R-15, R-13)
--   Day 2  close 5,400,000  a new closing high
--
--   0015   high_water_balance_cents >= balance_cents  ->  5,260,000 >= 5,400,000
--                                                     ->  REFUSES THE ROW
--
-- THAT IS GS-016'S EXPECTED END STATE, VERBATIM, and GS-016 exists for nothing
-- else: "locked floor does not move on a later high". GS-024's days three and
-- four are the same shape (hwb 5,300,001 against 5,450,001 and 5,500,000).
--
-- IT IS NOT AN EDGE CASE. The lock is enabled on all three v1 plans and fires
-- at drawdown + 10,000c of profit, below every eval target, so EVERY ACCOUNT
-- THAT PASSES AN EVALUATION CROSSES IT. After that day every new closing high
-- is a row the database refuses. The trigger is 260,000c at 50K on Core EOD and
-- Merit Rapid, 210,000c on Direct, and 110,000c to 760,000c across the sizes.
--
-- -----------------------------------------------------------------------------
-- WHY THE CONSTRAINT IS RIGHT ABOUT THE PRE-LOCK WORLD, WHICH IS WHY IT IS
-- SCOPED RATHER THAN DROPPED
-- -----------------------------------------------------------------------------
-- DO-7 computes `hwb' = max(hwb, closing_balance_cents)` BEFORE the lock test,
-- so on every unlocked day, and on the lock day itself, `hwb >= balance` holds
-- by construction. The defect is the ABSENCE OF A QUALIFIER, not the presence
-- of an assertion, and dropping it outright would discard a true statement
-- about every row of every account before its lock day.
--
-- -----------------------------------------------------------------------------
-- THE COST, ACCEPTED AND STATED RATHER THAN DISCOVERED LATER
-- -----------------------------------------------------------------------------
-- POST-LOCK, THE DATABASE ASSERTS NO RELATION BETWEEN hwb AND balance AT ALL.
--
-- GS-016's expectation note: "THE FROZEN HIGH-WATER BALANCE IS THE FIELD THAT
-- CATCHES A HALF-IMPLEMENTED LOCK. An engine that stopped moving the floor but
-- kept updating `hwb` reports 5,400,000 here and still shows the right floor."
-- Under this migration the database accepts that wrong row. The fixture still
-- rejects it; the schema no longer does.
--
-- THE DEFINING POST-LOCK PROPERTY IS "hwb IS UNCHANGED FROM THE PRIOR DAY",
-- which is a statement about two rows and is therefore not expressible as a
-- CHECK. A trigger could see it, and ADR-053 section 3 refuses to write one:
--
--   R-31, the eval-pass effects, verbatim: "balance = size_cents;
--   hwb = size_cents; floor = size_cents - funded drawdown_cents".
--
-- hwb is RESET DOWNWARD there. On Core EOD the eval target is 300,000c and the
-- lock trigger 260,000c, so EVERY EVAL PASS IS ALSO A LOCK DAY, and a freeze
-- trigger would reject the funded reset on the ordinary path. That is the same
-- class of defect as the one being repaired here, installed one row over.
-- Whether the lock even survives the reset is unruled: INV-07 says a locked
-- floor never changes "for the life of the account", progression.ts writes
-- floorLocked: false at DO-8, and ADR-050 deliberately did not cover it.
--
-- A post-lock bound against the floor (`hwb > floor_cents`) was also refused.
-- It is derivable from CV-12 and CV-02 but no row of M01 states it, and it
-- would not catch the failure mode above: a half-implemented lock makes hwb too
-- HIGH and that bounds it below.
-- THIS SESSION EXISTS BECAUSE SOMEBODY WROTE A CHECK STRONGER THAN THE RULE IT
-- WAS CHECKING. Writing a second one while repairing the first is not a fix.
--
-- What holds the post-lock behaviour is the fixture layer, GS-016 and RE-P-02.
--
-- -----------------------------------------------------------------------------
-- THIS FILE REMOVES A SUPPORT FROM AN ALREADY-SIGNED RULING
-- -----------------------------------------------------------------------------
-- ADR-052 (accepted 2026-08-17) rejects the alternative of freezing hwb at the
-- lock trigger partly BECAUSE OF THE CONSTRAINT THIS FILE SCOPES: a hwb of
-- 5,260,000 against that day's balance of 5,300,001 is a row "the constraint
-- rejects". After this migration that row is a LOCKED row and the constraint no
-- longer rejects it, so that argument stops working.
--
-- The alternative stays rejected on ADR-052's second and independent reason,
-- in the same sentence: freezing early "would also make
-- high_water_balance_cents stop being the account's high-water balance". That
-- is about what the column means and nothing here touches it. NOTHING IN THIS
-- FILE REOPENS A SIGNED RULING; it removes a support that ruling no longer
-- needs, and ADR-053 section 5 records the removal so a later reader
-- re-deriving ADR-052 from its own text does not find an argument that has
-- quietly stopped holding.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The constraint that has no qualifier
-- -----------------------------------------------------------------------------
-- Dropped rather than redefined under the same name, deliberately, on 0036's
-- reading of C-02: reusing `rule_states_high_water_bounds_balance` would leave
-- every existing reference to that name pointing at a constraint whose meaning
-- had silently changed. The name is retired with the statement it made.
ALTER TABLE rule_states
  DROP CONSTRAINT rule_states_high_water_bounds_balance;

-- -----------------------------------------------------------------------------
-- 2. The same invariant, scoped to the state in which it is true
-- -----------------------------------------------------------------------------
-- Reads: while the floor is unlocked, the high-water balance is at least the
-- balance it tracks. Once floor_locked, hwb is frozen by R-15 and this file
-- asserts nothing about it.
--
-- THE THREE `NOT NULL`s THIS PREDICATE DEPENDS ON AND DOES NOT MENTION are
-- floor_locked, high_water_balance_cents and balance_cents, all declared NOT
-- NULL in 0015. A CHECK that evaluates to NULL PASSES, so if any one of them
-- ever loses NOT NULL this constraint degrades into one that admits everything
-- while its text still reads correctly. probe_rule_states_high_water_bound.sql
-- asserts all three from the catalogue for exactly that reason.
--
-- THE NAME CARRIES THE SCOPE. `rule_states_high_water_bounds_balance` said the
-- bound was unconditional, which is the claim that was wrong.
ALTER TABLE rule_states
  ADD CONSTRAINT rule_states_high_water_bounds_balance_unlocked CHECK (
    floor_locked OR high_water_balance_cents >= balance_cents
  );

-- -----------------------------------------------------------------------------
-- 3. The comments, so the superseded statement does not outlive the fix
-- -----------------------------------------------------------------------------
-- A COMMENT is replaceable metadata rather than migration text, so re-stating
-- the column comment here edits nothing: 0015 is untouched on disk and still
-- says what it said the day it merged. This is 0036's treatment of 0014
-- applied a second time, and it is the only mechanism available, because the
-- `--` comment inside 0015 above the constraint can never be edited
-- (constitution E2) and still reads "the high-water mark is a maximum and never
-- falls below the balance it tracks", without the qualifier R-15 requires.
COMMENT ON COLUMN rule_states.high_water_balance_cents IS
  'Drives trailing (R-13): hwb'' = max(hwb, closing_balance_cents), computed at '
  'DO-7 BEFORE the lock test. FROZEN PERMANENTLY once floor_locked (R-15, and '
  'R-13: "hwb stops updating once floorLocked"), so AFTER THE LOCK A NEW '
  'CLOSING HIGH LEAVES THIS COLUMN BELOW balance_cents and that row is correct '
  '(GS-016, GS-024). RESET DOWNWARD to size_cents at the funded reset (R-31). '
  'ADR-053: 0015 checked hwb >= balance_cents unconditionally and therefore '
  'refused the state row of every locked account that made a new closing high, '
  'which is every account that passes an evaluation. The bound is now scoped to '
  'the unlocked state and NOTHING here bounds hwb once locked; the freeze is a '
  'two-row property, is not expressible as a CHECK, and is asserted by GS-016 '
  'and RE-P-02.';

COMMENT ON CONSTRAINT rule_states_high_water_bounds_balance_unlocked ON rule_states IS
  'ADR-053. While the floor is unlocked, hwb >= balance_cents, which holds by '
  'construction because DO-7 trails before it locks. Supersedes '
  'rule_states_high_water_bounds_balance (0015), which asserted it without the '
  'qualifier and made GS-016''s expected end state unwritable. Two-valued only '
  'because floor_locked, high_water_balance_cents and balance_cents are all NOT '
  'NULL; a CHECK evaluating to NULL passes.';

COMMIT;
