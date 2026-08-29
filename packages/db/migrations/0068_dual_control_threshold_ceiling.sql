-- =============================================================================
-- 0068_dual_control_threshold_ceiling
-- =============================================================================
-- E2 READ: MONEY PATH. This file writes the number above which one person
-- cannot move money to a named person alone. It edits nothing: `0038` stays
-- exactly as it was written and this file supersedes one of its declarations
-- from outside it (constitution E2), which is `0028`'s mechanism on this estate.
--
-- ADR-228, status PROPOSED, UNSIGNED. The founder's line-by-line read is OWED
-- and is not recorded as done anywhere.
--
-- -----------------------------------------------------------------------------
-- 1. THE ANSWER, RECORDED WITH ITS QUESTION
-- -----------------------------------------------------------------------------
-- A threshold whose reasoning is lost is a threshold the next session moves, so
-- both halves are written here rather than only the number.
--
--   QUESTION, put to the founder on 2026-08-29:
--     "above what payout amount should a second human have to approve it"
--
--   The $5,000 option was described to them as catching the unusual payouts
--     "without adding friction to normal trader withdrawals, which typically
--      run $500-$3,000"
--
--   ANSWER: $5,000, which is 500000 INTEGER CENTS.
--
-- ADR-228 section 4 records, and this comment will not soften, that the
-- reasoning offered with that question is NOT the reasoning this column
-- carries. `account_adjustments` is the ADMIN adjustment table; no trader
-- withdrawal has ever written a row of it and none can. The friction this
-- threshold does not add to normal trader withdrawals is friction it could not
-- have added at any value, including 1 cent. What the number actually sets is
-- ADR-067 section 5's quantity: "the size of the loss one compromised owner
-- session can cause without a second key". That entry recommended 10000 cents
-- (OQ-F6-01) and argued the number should "be set low and read as that number".
-- THE FOUNDER'S ANSWER IS 50x THAT RECOMMENDATION AND IT IS THE ANSWER; the
-- disagreement is surfaced for the E2 read rather than resolved by a session.
--
-- -----------------------------------------------------------------------------
-- 2. THE DEFECT THIS FILE CLOSES, WHICH IS NOT THE MISSING NUMBER
-- -----------------------------------------------------------------------------
-- Writing 500000 into a column does not make it the threshold. `0038:191-192`
-- declares:
--
--   dual_control_threshold_cents bigint NOT NULL CHECK (dual_control_threshold_cents > 0)
--
-- THE NUMBER IS PER ROW AND `> 0` IS THE ONLY BOUND, so the WRITER of an
-- adjustment chooses the line it is measured against. `0038:235-238` reads:
--
--   CHECK (amount_cents < dual_control_threshold_cents OR dual_control_approval_id IS NOT NULL)
--
-- A row naming `dual_control_threshold_cents = 9223372036854775807` satisfies
-- that constraint at any amount a `bigint` can hold, with no approval row, and
-- `0038`'s own comment calls the constraint one that "CANNOT BE WRITTEN
-- AROUND". IT CAN, FROM THE ONE DIRECTION THE COMMENT DOES NOT LOOK: not by
-- evading the comparison but by choosing its right-hand side. That is the
-- control switched off by exactly the compromised owner session ADR-067
-- section 5 says it exists to stop, and it leaves no trace a reader would
-- notice, because the row it writes is a valid row.
--
-- SO THE THRESHOLD NEEDED A BOUND BEFORE IT NEEDED A VALUE, and this file is
-- the bound. The value lives at `apps/api/src/routes/admin-wallet.ts`
-- (DUAL_CONTROL_THRESHOLD_CENTS) on `MINIMUM_WITHDRAWAL_CENTS`'s precedent one
-- route over, because the column RECORDS the threshold in force and does not
-- SOURCE it: no configuration table exists in any of the 115 tables this estate
-- declares, and no config reader exists in this deployable.
--
-- -----------------------------------------------------------------------------
-- 3. A CEILING, AND DELIBERATELY NOT AN EQUALITY
-- -----------------------------------------------------------------------------
-- The obvious constraint is `= 500000`, which would make the column exactly the
-- one number in force and kill the trap in both directions. IT IS REFUSED, and
-- the reason is the column's own documented purpose. `0038:279-282`:
--
--   'The threshold IN FORCE when the row was written, not the current one. '
--   'plan_breaker_state''s precedent (0016). Without it a later configuration '
--   'change retroactively makes an uncontrolled adjustment look compliant.'
--
-- A CHECK constrains every row, historical rows included. An equality CHECK
-- would therefore make the entire history unrepresentable the first time the
-- threshold moves: rows written at 500000 would violate a re-issued `= 300000`,
-- and the remedy would be a growing `IN (...)` list or dropping the control.
-- An equality constraint defends this column by destroying the property it was
-- created for, so it is the wrong shape however attractive its symmetry.
--
-- THE CEILING IS THE ASYMMETRY MADE STRUCTURAL. A writer may name a LOWER
-- threshold, which makes `amount_cents < threshold` fire more often and can
-- only require MORE approvals; it may not name a higher one, which can only
-- require fewer. Tightening the control is free and loosening it is a
-- migration, which is the ceremony the loosening direction deserves and the
-- tightening direction does not.
--
-- AND THE CEILING IS IN DDL RATHER THAN IN THE ROUTE ON THE THREAT MODEL'S OWN
-- TERMS. ADR-067 section 5 is explicit that at launch scale this is
-- "compromise resistance, not insider resistance". A refusal in application
-- code is a refusal a compromised application session is on the wrong side of.
-- A CHECK is not: raising this ceiling requires deploy access to the database,
-- which is a different credential from the one that reaches the route.
--
-- -----------------------------------------------------------------------------
-- 4. WHAT THIS FILE DOES NOT DO, STATED SO NOBODY READS COVERAGE INTO IT
-- -----------------------------------------------------------------------------
--   1. IT DOES NOT MAKE ANY PAYOUT DUAL CONTROLLED. `dual_control_threshold_cents`
--      is the only amount-denominated dual-control threshold in the estate and
--      it exists on ONE table. `grep -c 'dual_control' ` over
--      `apps/api/src/routes/payouts.ts`, `admin-payouts.ts`,
--      `wallet-withdrawals.ts` and `wallet.ts` returns 0, 0, 0 and 0, and
--      neither `payout_requests` (0010) nor `wallet_withdrawals` (0011)
--      declares a dual-control column of any kind. ADR-228 section 5 answers
--      the payout question in full, and the answer is that the founder's
--      threshold is UNDISCHARGED on the path their question named.
--
--   2. IT DOES NOT EXERCISE THE CONSTRAINT IT BOUNDS. `account_adjustments` has
--      no writer: `ADMIN_WALLET_TABLES` deliberately excludes
--      `accountAdjustments` (`admin-wallet.ts:471`, asserted at
--      `apps/api/test/admin-wallet.test.ts:109`), so
--      `account_adjustments_dual_control_above_threshold` has never run against
--      a row in any deployment. This ceiling is live from the moment a writer
--      exists and not before.
--
--   3. IT DOES NOT CLOSE THE AGGREGATION GAP. ADR-067 `OQ-F6-02` is still open:
--      the CHECK is per row, so repeated sub-threshold credits are unconstrained
--      and no constraint sums them. At 500000 rather than 10000 that gap is 50x
--      wider per permitted credit than the entry that named it assumed, which
--      ADR-228 section 4 reports rather than rounds off.
--
--   4. IT SETS NO PRECEDENT FOR PUTTING A LAUNCH CANDIDATE IN DDL. The standing
--      parameter-status ruling keeps plan parameters in `plan_version_sizes`
--      rather than in constants. This is not a plan parameter: it is a bound on
--      an ADMIN's own authority, it is denominated in the firm's loss and not in
--      a trader's terms, and no plan version scopes it. An adjustment may name
--      no account at all (`0038`'s `account_id uuid NULL`), so there is no plan
--      version to read it from even in principle.
-- =============================================================================

BEGIN;

-- `0038` IS UNTOUCHED. This is an addition from outside it, not an edit of it.
ALTER TABLE account_adjustments
  ADD CONSTRAINT account_adjustments_dual_control_threshold_ceiling CHECK (
    dual_control_threshold_cents <= 500000
  );

COMMENT ON CONSTRAINT account_adjustments_dual_control_threshold_ceiling
  ON account_adjustments IS
  'ADR-228. 500000 integer cents ($5,000), the founder answer of 2026-08-29 to '
  '"above what payout amount should a second human have to approve it". A '
  'CEILING and not an equality: 0038:279 makes this column the threshold IN '
  'FORCE when the row was written, so an equality CHECK would make every '
  'historical row unrepresentable the first time the threshold moved. A writer '
  'may name a LOWER threshold, which can only require MORE approvals, and may '
  'not name a higher one, which can only require fewer. Without this bound '
  'account_adjustments_dual_control_above_threshold is satisfiable at any '
  'amount by naming a threshold no adjustment can reach, which is the control '
  'switched off by the compromised owner session ADR-067 section 5 says it '
  'exists to stop. Raising it is a migration, which is deploy access and not '
  'route access, and that asymmetry is the control. THE VALUE IS SOURCED AT '
  'apps/api/src/routes/admin-wallet.ts DUAL_CONTROL_THRESHOLD_CENTS; this '
  'column records the threshold and does not choose it.';

COMMIT;
