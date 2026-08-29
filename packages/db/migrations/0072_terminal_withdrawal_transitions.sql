-- =============================================================================
-- 0072_terminal_withdrawal_transitions
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-234, status: proposed, founder approval PENDING.
--
-- THE TERMINAL EDGE IS THE ONE THAT RELEASES A TRADER, AND UNTIL THIS FILE THE
-- DATABASE HELD NO OPINION ABOUT WHICH ARROWS REACH IT. `0011` declared the
-- seven-member vocabulary, `0031` bound the halt to `settled`, `0057` bound the
-- OBLIGATION a terminal row leaves behind, and `0070` bound the approval's own
-- columns. None of the four says which status a terminal status may be entered
-- FROM, and STATE_MACHINES section 3.2 draws exactly three arrows into `[*]`.
--
-- `0011`, `0031`, `0057` AND `0070` ARE BYTE FOR BYTE UNCHANGED. This file adds
-- from outside them and edits none of them.
--
-- -----------------------------------------------------------------------------
-- WHY IT MATTERS THAT NOTHING SAID SO, WHICH IS `0057`'s OWN REASONING RESTING
-- ON AN ARROW SET NOTHING ENFORCED
-- -----------------------------------------------------------------------------
-- `0057`'s `WD-C1` holds three different ways and its comment says which:
-- "settled discharges through LT-07, failed through LT-09, and cancelled
-- because LT-06 never posted -- cancelled is reachable only from requested and
-- cooling, both BEFORE approval, so its net is a sum over zero rows".
--
-- THAT LAST CLAUSE IS A CLAIM ABOUT AN ARROW SET AND NOT ABOUT A ROW, and
-- EXECUTED against this estate before this file was written it does not hold:
-- an `UPDATE wallet_withdrawals SET status = 'cancelled'` from `approved`
-- LANDS. Today it lands harmlessly, because no door drives the approval edge
-- and `LT-06` therefore never posts, so `WD-C1`'s sum really is over zero rows.
-- THE DAY THE POSTING LANDS IT STOPS BEING HARMLESS: a cancel from `approved`
-- would leave the obligation standing, the trader's wallet claim already
-- extinguished by `LT-06`, and the money in neither place they could be shown
-- it -- which is the exact defect `0057` was written to refuse, arriving
-- through the one arrow `0057` assumed did not exist.
--
-- A CONTROL WHOSE CORRECTNESS RESTS ON A TRANSITION NOBODY REFUSES IS HALF A
-- MECHANISM, and this table has already paid for that twice: `0011` made the
-- halt "representable and unenforced for four migrations" (STATE_MACHINES
-- section 3.2's own indented note), and `0038` shipped a dual-control threshold
-- with no ceiling that a $1,000,000 credit walked past eleven days later
-- (ADR-228, `0068`). THE ARROW SET IS THE THIRD OF THE SAME SHAPE and it is
-- closed here rather than after the posting that makes it expensive.
--
-- -----------------------------------------------------------------------------
-- WHAT IS ADDED
-- -----------------------------------------------------------------------------
--   1. `cancelled_at`. `cancelled` WAS THE ONLY TERMINAL STATUS WITH NO CLOCK.
--      `0011` gave `settled` its `settled_at` and
--      `wallet_withdrawals_settled_has_timestamp`; `0070` gave `approved` its
--      `approved_at` and `wallet_withdrawals_approved_has_timestamp`, which
--      exempts `failed` and so requires one there too. A cancelled row recorded
--      WHEN only through `updated_at`, which the halt release at
--      `apps/worker/src/sweeps/expiry.ts` moves without touching the rail
--      status at all. Two constraints, in `0070`'s own pair shape: the status
--      requires the clock, and the clock requires the status.
--
--   2. `WD-C2`, TWO ASSERTIONS UNDER ONE ID. `0057`'s shape, which is in turn
--      `assert_adjustment_reversal_is_sound`'s (`0038`) with six.
--
--        ASSERTION 1: A TERMINAL STATUS IS NEVER LEFT. Section 3.2 draws
--        `settled --> [*]`, `failed --> [*]` and `cancelled --> [*]` and no
--        arrow out of any of the three. Nothing refused `UPDATE ... SET status
--        = 'requested'` on a settled row before this file, and on the release
--        path that is the whole property inverted: a cancelled withdrawal that
--        can be re-opened is a release that can be revoked, and a settled one
--        that can be re-opened is money reported as gone and then claimed
--        again.
--
--        ASSERTION 2: A TERMINAL STATUS IS ENTERED ONLY ALONG AN ARROW SECTION
--        3.2 DRAWS. `cancelled` from `requested` or `cooling` under
--        `G-TRADER-CANCELS`; `settled` from `transferring` under
--        `G-SETTLEMENT-CONFIRMED`; `failed` from `transferring` under
--        `G-TRANSFER-EXHAUSTED`. AND NEVER AT INSERT: `[*] --> requested` is
--        the only arrow into the machine, so a row born terminal is a row that
--        never had one.
--
-- -----------------------------------------------------------------------------
-- SIX THINGS THAT NEED THE LINE-BY-LINE READ
-- -----------------------------------------------------------------------------
--   1. ASSERTION 1 IS CHECKED FIRST AND THE ORDER IS DELIBERATE, for `0057`'s
--      and `0038` check 1's stated reason: when a writer moves `settled` to
--      `cancelled` BOTH assertions are unsatisfied, and the one that names the
--      rule they actually broke is the one about leaving. A reader told
--      "cancelled is reachable only from requested and cooling" goes looking
--      for the wrong half of their own statement.
--
--   2. IT IS `NOT DEFERRABLE`, WHERE `0057`'s `WD-C1` IS `DEFERRABLE INITIALLY
--      DEFERRED`, AND THE DIFFERENCE IS NOT A PREFERENCE. `WD-C1` reads
--      `ledger_transactions` rows the same transaction is still writing, so it
--      CANNOT run at statement time. `WD-C2` reads `OLD` and `NEW` of one row
--      and nothing else in the database, so it has nothing to wait for, and an
--      immediate refusal names the statement that broke the rule instead of
--      naming `COMMIT`.
--
--      AND THE ORDERING THIS CREATES WITH `0031` IS LOAD BEARING AND IS
--      EXECUTED RATHER THAN ARGUED. `scripts/db/probe_payout_hold.sql`
--      REJECTION 3 drives `approved --> settled` on a frozen row and expects
--      `wallet_withdrawals_live_freeze_blocks_settlement` to refuse it.
--      Assertion 2 refuses that same transition for a different reason. A CHECK
--      constraint is evaluated as the row is written and an `AFTER ... FOR EACH
--      ROW` trigger fires after the statement's rows are, so the CHECK still
--      wins and the probe still tests the halt. EXECUTED BOTH WAYS: the probe
--      passes unchanged against this migration, and its refusal still names
--      `wallet_withdrawals_live_freeze_blocks_settlement`.
--
--   3. THE `WHEN` CLAUSE IS WHAT KEEPS THE HALT SWEEP OUT OF THIS TRIGGER.
--      `apps/worker/src/sweeps/expiry.ts` UPDATEs `wallet_withdrawals` to write
--      the freeze trio and `updated_at` WITHOUT touching `status`, which is the
--      only UPDATE of this table anywhere in `apps/**` or `packages/**` outside
--      the approval edge. `OLD.status IS DISTINCT FROM NEW.status` is false
--      there, so the trigger does not fire and a halt release is not a
--      transition.
--
--   4. THE STATUS LITERALS ARE ENUMERATED AND A NINTH ENUM VALUE WOULD NOT JOIN
--      THEM. This is `0057` header item 5's landmine restated at its second
--      site, because it is now true in two files rather than one: a later
--      migration adding a terminal member to `wallet_withdrawal_status` gets no
--      coverage from either trigger and nothing says so. `0027`'s vocabulary
--      lists are the same class. It is stated rather than repaired because the
--      repair is a vocabulary registry and that is not this file's fence.
--
--   5. WHAT IT DOES NOT BIND, so the absences read as decisions. THE THREE
--      NON-TERMINAL ARROWS ARE UNTOUCHED: `requested --> cooling`, `requested
--      / cooling --> approved` and `approved --> transferring` are drawn in
--      section 3.2 and are still enforceable only by the application. Binding
--      them is a whole-machine guard and this file's subject is the terminal
--      edge; `0070` owns the approval neighbourhood and binding its arrow from
--      outside it, one migration later, would put two files in charge of one
--      transition. `wallet_withdrawals_approved_has_timestamp` (`0070`) already
--      requires that a `failed` row carry `approved_at`, so the approval half
--      of the `failed` path is bound today by a CHECK and the arrow half is
--      bound here.
--
--   6. IT ADDS NO TABLE, NO ENUM VALUE, NO LEDGER CODE, NO INDEX, NO GRANT AND
--      NO REVOKE. One column, two CHECKs, one function, one trigger.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- THE CANCELLATION'S CLOCK                                         -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEM 1. `0011` IS UNTOUCHED. An addition from outside it.
ALTER TABLE wallet_withdrawals
  ADD COLUMN cancelled_at timestamptz NULL;

COMMENT ON COLUMN wallet_withdrawals.cancelled_at IS
  'ADR-234. When the row crossed G-TRADER-CANCELS (STATE_MACHINES section '
  '3.2). The third of the three terminal clocks and the last to be added: 0011 '
  'gave settled its settled_at, 0070 gave approved its approved_at and by '
  'exemption requires one on failed, and cancelled recorded WHEN only through '
  'updated_at -- which the halt release at apps/worker/src/sweeps/expiry.ts '
  'moves without touching the rail status at all.';

ALTER TABLE wallet_withdrawals
  ADD CONSTRAINT wallet_withdrawals_cancelled_has_timestamp CHECK (
    status <> 'cancelled' OR cancelled_at IS NOT NULL
  ),

  -- 0070's pair shape: the status requires the clock and the clock requires the
  -- status. cancelled is terminal and assertion 1 below refuses leaving it, so
  -- a non-NULL cancelled_at on any other status is a cancellation that was
  -- undone by a writer that could not have existed.
  ADD CONSTRAINT wallet_withdrawals_uncancelled_records_no_cancellation CHECK (
    cancelled_at IS NULL OR status = 'cancelled'
  );

-- -----------------------------------------------------------------------------
-- WD-C2: a terminal status is entered only along a drawn arrow, and never left
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1 THROUGH 5. Two assertions under one id, which is WD-C1's shape
-- (0057) and assert_adjustment_reversal_is_sound's (0038) with six.
CREATE FUNCTION assert_withdrawal_terminal_transition_is_drawn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- ASSERTION 1, FIRST FOR HEADER ITEM 1's REASON. settled --> [*], failed -->
  -- [*] and cancelled --> [*] are the only arrows section 3.2 draws out of the
  -- three, and [*] is not a status a row comes back from.
  --
  -- THE MEMBERSHIP IS SPELLED `IN` AND NOT `= ANY (ARRAY[...])`, AND THAT IS
  -- A TYPE ERROR THIS FILE ALREADY MADE. `status` is `wallet_withdrawal_status`
  -- and a `text[]` is a concrete type, so the array form raises "operator does
  -- not exist: wallet_withdrawal_status = text" AT TRIGGER TIME rather than at
  -- CREATE time -- a 500 on the money path, on a row the caller was refusing.
  -- The `IN` form's literals are `unknown` and coerce to the enum. FOUND BY
  -- EXECUTION: `scripts/db/probe_ledger_constraints.sql` went red on it, on the
  -- one drawn arrow in this estate that any fixture actually walks.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('settled', 'failed', 'cancelled') THEN
    RAISE EXCEPTION
      'WD-C2: wallet withdrawal % is terminal at status % and may not become '
      '%. STATE_MACHINES section 3.2 draws settled, failed and cancelled into '
      '[*] and draws no arrow out of any of them. A cancelled withdrawal that '
      'can be re-opened is a release that can be revoked, and a settled one '
      'that can be re-opened is money reported as gone and then claimed again '
      '(ADR-234)',
      NEW.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- ASSERTION 2. The three arrows into [*], and nothing else reaches them.
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'WD-C2: wallet withdrawal % is created at terminal status %. Section '
      '3.2 draws [*] --> requested as the only arrow into this machine, so a '
      'row born terminal is a row that never had one: nothing observed the '
      'money moving, failing or being withdrawn (ADR-234)',
      NEW.id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status NOT IN ('requested', 'cooling') THEN
    RAISE EXCEPTION
      'WD-C2: wallet withdrawal % cannot be cancelled from %. G-TRADER-CANCELS '
      'is drawn from requested and from cooling and from nowhere else, both '
      'BEFORE approval, which is what makes WD-C1 (0057) hold on this exit: '
      'LT-06 never posted, so the obligation nets over zero rows. A cancel '
      'from % leaves that obligation standing (ADR-234)',
      NEW.id, OLD.status, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('settled', 'failed') AND OLD.status <> 'transferring' THEN
    RAISE EXCEPTION
      'WD-C2: wallet withdrawal % cannot reach % from %. G-SETTLEMENT-CONFIRMED '
      'and G-TRANSFER-EXHAUSTED are both drawn out of transferring and out of '
      'no other status: a withdrawal settles or fails because the RAIL '
      'reported, and a row that never reached transferring was never handed to '
      'one (ADR-234)',
      NEW.id, NEW.status, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

-- TWO TRIGGERS OVER ONE FUNCTION, AND IT IS POSTGRESQL AND NOT A PREFERENCE.
-- A WHEN clause on a trigger that covers INSERT may not reference OLD, and
-- assertion 1 is a question about OLD, so a single AFTER INSERT OR UPDATE
-- trigger could carry either assertion's WHEN clause and not both. EXECUTED:
-- CREATE TRIGGER refuses it outright, at CREATE time, with "INSERT trigger's
-- WHEN condition cannot reference OLD values", and TG_OP is not in scope in a
-- WHEN clause either ("column tg_op does not exist"), so neither spelling of
-- the guard survives. The alternative was one trigger with NO
-- WHEN clause and the filtering moved into the body, which fires on every write
-- to this table -- including the halt sweep's -- and hides in PL/pgSQL the one
-- fact a reader of the DDL most needs, which is WHEN this control runs.
CREATE CONSTRAINT TRIGGER wallet_withdrawals_not_born_terminal
  AFTER INSERT ON wallet_withdrawals
  FOR EACH ROW
  WHEN (NEW.status IN ('settled', 'failed', 'cancelled'))
  EXECUTE FUNCTION assert_withdrawal_terminal_transition_is_drawn();

CREATE CONSTRAINT TRIGGER wallet_withdrawals_terminal_transition_is_drawn
  AFTER UPDATE ON wallet_withdrawals
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND (NEW.status IN ('settled', 'failed', 'cancelled')
         OR OLD.status IN ('settled', 'failed', 'cancelled'))
  )
  EXECUTE FUNCTION assert_withdrawal_terminal_transition_is_drawn();

COMMENT ON FUNCTION assert_withdrawal_terminal_transition_is_drawn() IS
  'WD-C2, ADR-234. STATE_MACHINES section 3.2 draws three arrows into [*] and '
  'none out. A terminal status is entered only from the status the drawing '
  'draws it from -- cancelled from requested or cooling, settled and failed '
  'from transferring -- and never at INSERT, and once entered it is never '
  'left. WD-C1 (0057) binds the OBLIGATION a terminal row leaves behind and '
  'rests its own cancelled arm on an arrow set nothing enforced until this '
  'trigger: a cancel from approved lands harmlessly only while no door drives '
  'the approval edge, and stops being harmless the day LT-06 posts.';

COMMIT;
