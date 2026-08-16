-- =============================================================================
-- 0036_supersede_daily_marks_balance_arithmetic
-- =============================================================================
-- E2 READ: MONEY PATH. One constraint, superseded. Nothing here edits a merged
-- file: 0014_marks stays exactly as it was written, and this file changes what
-- it installed. Migrations are sacred once merged (constitution E2), which is a
-- rule about editing them, not a rule against correcting them.
--
-- EC-157, RULED 2026-08-16: REPAIR A. THE CONSTRAINT IS WRONG AND THE
-- INVARIANTS ARE RIGHT.
--
-- -----------------------------------------------------------------------------
-- THE ARITHMETIC, IN INTEGER CENTS, ON THE CASE THE COLUMN EXISTS FOR
-- -----------------------------------------------------------------------------
-- A settled payout of 250,000c against a prior close of 5,000,000c, on a day
-- that makes 30,000c:
--
--   INV-18   opening == prior.balance + adjustment   ->  4,750,000
--   INV-19   closing == opening + realized_pnl       ->  4,780,000
--   0014     closing = opening + realized_pnl + adj  ->  4,530,000  <- refuses
--
-- The three have exactly ONE common solution and it is `adjustment_cents = 0`,
-- which is the one value SD-01 was added to make impossible to assume. So the
-- mark for EVERY SETTLED PAYOUT was unwritable as specified, and an engine
-- handed such a row would raise a DO-3 assertion failure against a row the
-- database had already accepted.
--
-- NOTHING HAD NOTICED BECAUSE EVERY MARK IN THE REPOSITORY CARRIES A ZERO
-- ADJUSTMENT, and at zero the three agree exactly.
--
-- -----------------------------------------------------------------------------
-- WHY THE CONSTRAINT LOSES, WITH THE COUNT
-- -----------------------------------------------------------------------------
-- FOUR artifacts say the adjustment lands at the OPEN, and one says it lands
-- inside the day:
--
--   INV-18   `mark.opening_balance_cents == prior.balance_cents
--                                         + mark.adjustment_cents`  (M01)
--   R-10     "The withdrawal lands at the open of effectiveTradingDay,
--             never inside a session"                               (M01)
--   EC-034   states the two identities in the same words
--   0014     its OWN comment on adjustment_cents: "applied at the OPEN of the
--            effective trading day ... never inside a session"
--
--   against  daily_marks_balance_arithmetic
--
-- M02 settles it from the other side. INV-M2-06: "Every mark satisfies M1's
-- identities ... asserted by M2 BEFORE handing the mark to the engine." The
-- ingest module is specified to produce marks in the identity form, so
-- `daily_marks` is a NORMALIZED record and not a raw vendor dump; INV-M2-12
-- has the normalizer classify every balance delta as trading or non-trading
-- and refuse to guess. Both invariants name `mark.` columns, so they are
-- claims about the STORED ROW rather than about anything the engine computes.
--
-- REPAIR B IS REJECTED, and the reasons are recorded rather than implied. It
-- would move the adjustment inside the day, which contradicts R-10 and EC-034,
-- reopens the question SD-01 closed, and breaks INV-21: a withdrawal applied
-- inside a session is a withdrawal the intraday low can be measured against, so
-- INV-21 would stop following from CV-11 and CV-17.
--
-- -----------------------------------------------------------------------------
-- THE COST, ACCEPTED AND STATED RATHER THAN DISCOVERED LATER
-- -----------------------------------------------------------------------------
-- THE SCHEMA STOPS ASSERTING THE ADJUSTMENT AT ALL.
--
-- INV-18 reads `prior.balance_cents`, which lives in `rule_states` and not in
-- `daily_marks`, and a CHECK cannot see across rows. So the identity that
-- governs the adjustment is not expressible as a table constraint and moves to
-- where it was always asserted: M02 before handing the mark over (INV-M2-06),
-- and the engine at DO-3, which returns an AssertionFailure and raises
-- reconciliation rather than throwing (R-07, EC-047).
--
-- This is a real loss of a database-level guarantee and it is the price of the
-- ruling. What is NOT lost is INV-19, which is intra-row and stays a CHECK
-- below. The alternative was keeping an executable statement of an identity
-- that no document asserts, and an executable statement of the wrong identity
-- is still the wrong identity. It was simply the only one of the five artifacts
-- that had never been read against the other four.
--
-- -----------------------------------------------------------------------------
-- THE MISLABEL, WHICH IS HOW THIS HAPPENED
-- -----------------------------------------------------------------------------
-- 0014's comment above the constraint reads "INV-18, now checkable because
-- SD-01 exists", and the daily_marks design record says the same. IT IS
-- NEITHER IDENTITY. INV-18 is the opening identity and INV-19 is the closing
-- one; `closing = opening + realized_pnl + adjustment` is a third statement
-- that appears nowhere in M01.
--
-- A WRONG LABEL ON AN EXECUTABLE ARTIFACT IS HOW THE WRONG IDENTITY BECAME
-- AUTHORITATIVE. A reader checking whether the schema enforced INV-18 found a
-- constraint that said it did. The label is corrected in this file's records in
-- the same commit, because correcting the constraint and leaving the label is
-- how the next reader repeats the inference.
--
-- The replacement constraint below is named for what it is and carries the
-- identity it enforces, so the next reader does not have to trust a comment.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The constraint that states an identity no document asserts
-- -----------------------------------------------------------------------------
-- Dropped rather than replaced under the same name, deliberately. Reusing
-- `daily_marks_balance_arithmetic` would leave every existing reference to that
-- name pointing at a constraint whose meaning had silently changed, which is
-- the C-02 defect (a predicate that stops matching while the name stays put).
-- The name is retired with the statement.
ALTER TABLE daily_marks
  DROP CONSTRAINT daily_marks_balance_arithmetic;

-- -----------------------------------------------------------------------------
-- 2. INV-19, and ONLY INV-19, because it is the only one a CHECK can see
-- -----------------------------------------------------------------------------
-- M01 INV-19, verbatim:
--   `mark.closing_balance_cents == mark.opening_balance_cents
--                                + mark.realized_pnl_cents`
--
-- Intra-row, so it is checkable. The adjustment does NOT appear, and that is
-- the whole of the change: under INV-18 the adjustment has already landed in
-- `opening_balance_cents` before the session starts, so adding it again here
-- subtracts a settled payout twice.
--
-- THE NAME CARRIES THE IDENTITY. `daily_marks_balance_arithmetic` said only
-- that some arithmetic closed, which is what let a comment claim it was INV-18.
ALTER TABLE daily_marks
  ADD CONSTRAINT daily_marks_inv19_closing_identity CHECK (
    closing_balance_cents = opening_balance_cents + realized_pnl_cents
  );

-- -----------------------------------------------------------------------------
-- 3. The column comment, replaced so the mislabel does not outlive the fix
-- -----------------------------------------------------------------------------
-- A COMMENT is replaceable metadata rather than migration text, so re-stating
-- it here edits nothing: 0014 is untouched on disk and still says what it said
-- the day it merged. This is 0031's treatment of 0010:225 applied a second
-- time, and it is the only mechanism available, because the `--` comment inside
-- 0014 above the constraint can never be edited (constitution E2) and still
-- reads "INV-18, now checkable".
COMMENT ON COLUMN daily_marks.adjustment_cents IS
  'SD-01. Signed non-trading balance movement: a settled withdrawal today, a '
  'promotional credit later. APPLIED AT THE OPEN of the effective trading day '
  '(R-10, payout_requests.effective_trading_day), never inside a session, so '
  'it is already inside opening_balance_cents by INV-18. '
  'EC-157, Repair A, ruled 2026-08-16: this column does NOT appear in the '
  'closing identity. 0014 carried a CHECK reading '
  '"closing = opening + realized_pnl + adjustment" labelled INV-18, and it is '
  'NEITHER M01 identity; it subtracted every settled payout twice and made the '
  'mark for one unwritable. INV-18 (opening == prior.balance + adjustment) is '
  'NOT enforceable here: prior.balance lives in rule_states and a CHECK cannot '
  'see across rows. It is asserted by M02 before the engine sees the mark '
  '(INV-M2-06) and by the engine at DO-3 (R-07), which raises reconciliation '
  'rather than throwing.';

COMMENT ON CONSTRAINT daily_marks_inv19_closing_identity ON daily_marks IS
  'M01 INV-19, verbatim and alone: closing == opening + realized_pnl. '
  'Supersedes daily_marks_balance_arithmetic (0014) under EC-157 Repair A. '
  'The adjustment is absent on purpose: INV-18 puts it in opening_balance_cents '
  'at the open, so including it here counts it twice.';

COMMIT;
