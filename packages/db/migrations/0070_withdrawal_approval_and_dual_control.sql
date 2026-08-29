-- =============================================================================
-- 0070_withdrawal_approval_and_dual_control
-- =============================================================================
-- E2 READ: MONEY PATH. This file gives the external leg's approval edge the
-- columns it has never had and puts the founder's dual-control threshold on it.
-- It edits nothing: `0011` and `0016` stay exactly as they were written and
-- this file supersedes `0011`'s declaration from outside it (constitution E2),
-- which is `0028`'s mechanism on this estate and `0068`'s one migration ago.
--
-- ADR-232, status PROPOSED, UNSIGNED. The founder's line-by-line read is OWED
-- and is not recorded as done anywhere.
--
-- -----------------------------------------------------------------------------
-- 1. THE EDGE HAS NO COLUMNS, WHICH IS WHY NOTHING HAS EVER DRIVEN IT
-- -----------------------------------------------------------------------------
-- STATE_MACHINES section 3.2 draws two arrows into `approved`:
--
--     requested --> approved: G-WITHDRAWAL-CLEARED
--     cooling   --> approved: G-COOLING-ELAPSED
--
-- `0011:126-196` declares `status`, `requested_at` and `settled_at`. There is
-- no `approved_at`, no `approved_by`, and no column that names a second person.
-- So a row that reached `approved` could record WHEN it happened only by the
-- generic `updated_at` and WHO did it not at all, and `0016:224-268`'s
-- `dual_control_approvals` was reachable from this table by no column.
--
-- THAT IS THE ORDER THIS FILE PUTS RIGHT. A transition with nowhere to write
-- its attribution is a transition that cannot be audited after it runs, and the
-- approval is the edge on which `LT-06` moves the trader's balance out of their
-- wallet position and into the firm's `withdrawals_in_flight` obligation
-- (M06 `INV-M6-15`, ADR-187, `0056`). It is the last moment at which a human
-- decision is cheap to reverse.
--
-- -----------------------------------------------------------------------------
-- 2. THE THRESHOLD, AND WHOSE HAND IT BINDS
-- -----------------------------------------------------------------------------
-- The founder answered "above what payout amount should a second human have to
-- approve it" with $5,000, 500000 INTEGER CENTS, on 2026-08-29 (ADR-228
-- section 1, `0068`'s section 1). ADR-232 rules WHERE that answer attaches, and
-- the ruling is asymmetric between the two hands that can reach this edge:
--
--   A MACHINE APPROVAL TAKES NO DUAL CONTROL AND CANNOT. Both guards on this
--     edge are predicates a machine evaluates and neither names a human.
--     `G-WITHDRAWAL-CLEARED` is "KYC verified, destination outside its cooling
--     window, provenance summary present, and identities.status = 'active'"
--     (STATE_MACHINES section 8's guard table, ADR-075) and
--     `G-COOLING-ELAPSED` is a clock. There is no first hand for a second hand
--     to check, and requiring one would make a trader's own money wait on an
--     operator. ADR-232 section 4 rules that arm and states its grounds.
--
--   AN OPERATOR APPROVAL TAKES DUAL CONTROL AT OR ABOVE THE THRESHOLD, and
--     `approved_by` is the column that tells the two apart. NULL is the machine
--     and a non-NULL value is a named human, so the constraint below is written
--     over `approved_by` rather than over a role, a route or a session kind,
--     none of which a database row carries.
--
-- ADR-069 section 5 already rules that an admin-ORIGINATED external withdrawal
-- is dual controlled at every amount (M06 row 17, `POST
-- /admin/identities/:identityId/wallet/withdrawals`). THIS FILE DOES NOT WEAKEN
-- THAT to a threshold: origination is a different act from approval, that route
-- does not exist in this tree, and when it lands its own constraint is the one
-- that binds it. What the threshold below binds is an operator APPROVING a
-- withdrawal, which is the act the founder's question describes.
--
-- -----------------------------------------------------------------------------
-- 3. THE CEILING ARRIVES WITH THE COLUMN, WHICH IS THE WHOLE LESSON OF 0038
-- -----------------------------------------------------------------------------
-- `0038:191-192` shipped `dual_control_threshold_cents bigint NOT NULL CHECK
-- (> 0)` on `account_adjustments`, PER ROW, so the writer chose the line its
-- own amount was measured against. Session 418 executed a $1,000,000 credit
-- naming a threshold of 9223372036854775807 with no approval row past every
-- CHECK on that table, and `0068` bounded it eleven days later.
--
-- `dual_control_threshold_cents` here is `0038`'s column WITH `0068`'s repair
-- already applied, in the same statement that creates it. A writer may name a
-- LOWER threshold, which can only require MORE approvals; it may not name a
-- higher one, which can only require fewer. Tightening is free and loosening is
-- a migration, which is deploy access rather than route access, and ADR-067
-- section 5's threat model is explicit that the credential reaching the route
-- is the one assumed compromised.
--
-- A CEILING AND NOT AN EQUALITY, for `0068`'s reason restated because it is the
-- reason the column is nullable and per row at all: a CHECK binds historical
-- rows, so `= 500000` would make every row written under an earlier threshold
-- unrepresentable the first time the number moved, destroying the property the
-- column exists for in order to defend it.
--
-- -----------------------------------------------------------------------------
-- 4. THE TRIGGER, AND WHY THE FOREIGN KEY IS NOT THE CONTROL
-- -----------------------------------------------------------------------------
-- `dual_control_approval_id uuid REFERENCES dual_control_approvals(id)` proves
-- that a row exists. It proves nothing about WHAT that row says, and the three
-- things it does not prove are the three that matter:
--
--   1. THAT THE APPROVAL IS OF THIS WITHDRAWAL. Without `subject_kind` and
--      `subject_id`, any approval row in the table satisfies the reference,
--      including one raised for an alarm suppression.
--   2. THAT IT IS APPROVED. `status` starts at `pending`, so a citation of a
--      row nobody has approved yet reads exactly like a citation of one they
--      have.
--   3. THAT THE SECOND PERSON IS A SECOND PERSON.
--
-- The third is not restated here and that is deliberate.
-- `dual_control_approvals_second_person` (`0016:250-252`) already refuses
-- `approved_by = requested_by` in DDL. The trigger below asserts
-- `requested_by = NEW.approved_by`, which BINDS the operator of record on this
-- withdrawal to the requester on the approval row, and `0016`'s own CHECK then
-- makes the approver somebody else. Restating the rule here would be a second
-- copy of a control that can drift from the first; composing with it cannot.
--
-- DEFERRABLE INITIALLY DEFERRED, on `0057`'s shape and for its reason: the
-- approval row and the transition that cites it commit in one transaction, and
-- an immediate trigger would decide the question on write order.
--
-- WHAT THE TRIGGER DOES NOT CHECK, so nobody reads coverage into it:
--   * `payload_hash`. `SD-M6-05` makes the hash the thing that pins WHAT was
--     approved, and a withdrawal row is not a payload: the bytes an operator
--     approved are the admin request body, which the origination route this
--     tree does not have would supply. The column is unread here and ADR-232
--     section 7 names it as owed to that route rather than inventing a hash
--     shape for it now.
--   * `expires_at`. `dual_control_approvals_within_window` (`0016:261-263`)
--     already refuses an `approved_at` after the window, so a row whose status
--     is `approved` was approved inside it. What is NOT refused is a
--     withdrawal citing that row long afterwards, which is a staleness rule no
--     approved document states.
--
-- -----------------------------------------------------------------------------
-- 5. WHAT THIS FILE DOES NOT DO
-- -----------------------------------------------------------------------------
--   1. IT DRIVES NO EDGE. Nothing in this tree writes `wallet_withdrawals.status`
--      after the creation INSERT. Derived over `apps/**` and `packages/**`
--      excluding test and tooling directories: the writers are the INSERT at
--      `apps/api/src/routes/wallet-withdrawals.ts` and one UPDATE at
--      `apps/worker/src/sweeps/expiry.ts`, and the second writes the freeze
--      trio and `updated_at` only. Columns are what this file adds.
--   2. IT ADDS NO ENUM VALUE, NO TABLE, NO INDEX, NO LEDGER CODE, NO GRANT AND
--      NO REVOKE. `wallet_withdrawal_status` is untouched: `approved` has been
--      in it since `0001:95-98` and the machine's shape is not what was
--      missing.
--   3. IT DOES NOT MAKE THE APPROVAL POST `LT-06`. That posting is the ledger
--      arm, and ADR-232 section 6 records it as the reason no door in
--      `apps/api` drives this edge yet.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- THE APPROVAL'S ATTRIBUTION                                       -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- `0011` IS UNTOUCHED. This is an addition from outside it, not an edit of it.
ALTER TABLE wallet_withdrawals
  ADD COLUMN approved_at                   timestamptz NULL,
  ADD COLUMN approved_by                   text NULL,
  ADD COLUMN dual_control_approval_id      uuid NULL
                                             REFERENCES dual_control_approvals(id)
                                             ON DELETE RESTRICT,
  ADD COLUMN dual_control_threshold_cents  bigint NULL;

COMMENT ON COLUMN wallet_withdrawals.approved_at IS
  'ADR-232. When the row crossed G-WITHDRAWAL-CLEARED or G-COOLING-ELAPSED '
  '(STATE_MACHINES section 3.2). NOT updated_at, which every writer moves and '
  'which the halt release at apps/worker/src/sweeps/expiry.ts moves without '
  'touching the rail status at all.';

COMMENT ON COLUMN wallet_withdrawals.approved_by IS
  'ADR-232. WHICH HAND MOVED THE ROW, and the column the dual-control '
  'constraints are written over. NULL is a machine approval: both guards on '
  'this edge are predicates naming no human, so an approval that satisfied '
  'them needed no operator and has none to record. A non-NULL value is a named '
  'operator in 0002''s actor idiom, not a users row. ADR-232 section 4 rules '
  'that a trader''s own withdrawal never waits on an operator, so on the only '
  'arm this tree has this column is NULL and the threshold below is '
  'unreachable by design rather than by omission.';

COMMENT ON COLUMN wallet_withdrawals.dual_control_approval_id IS
  'ADR-232, SD-M6-05. The second person''s row in dual_control_approvals '
  '(0016). The FOREIGN KEY proves a row exists and nothing about what it says; '
  'assert_withdrawal_dual_control_is_real below is what makes it an approval OF '
  'THIS WITHDRAWAL, in status approved, whose requester is this row''s '
  'approved_by.';

COMMENT ON COLUMN wallet_withdrawals.dual_control_threshold_cents IS
  'ADR-232. The threshold IN FORCE when this row was approved, not the current '
  'one, which is 0038:279''s reason for the column and the reason it is per '
  'row. 0038 shipped this column with > 0 as its only bound and a $1,000,000 '
  'credit named a threshold no adjustment could reach; 0068 bounded it eleven '
  'days later. Here the ceiling arrives in the same migration as the column. '
  'The VALUE is sourced at apps/api/src/routes/admin-wallet.ts '
  'DUAL_CONTROL_THRESHOLD_CENTS and this column records it and does not choose '
  'it.';

-- -----------------------------------------------------------------------------
-- AN APPROVAL PAST APPROVAL, AND NOTHING BEFORE IT
-- -----------------------------------------------------------------------------
-- The split is STATE_MACHINES section 3.2's and 0057's reading of it: cancelled
-- is reachable only from requested and cooling, both BEFORE approval, and
-- failed is reachable only from transferring, which is after it.
ALTER TABLE wallet_withdrawals
  ADD CONSTRAINT wallet_withdrawals_approved_has_timestamp CHECK (
    status IN ('requested', 'cooling', 'cancelled')
    OR approved_at IS NOT NULL
  ),

  ADD CONSTRAINT wallet_withdrawals_unapproved_records_no_approval CHECK (
    approved_at IS NOT NULL
    OR (approved_by IS NULL
        AND dual_control_approval_id IS NULL
        AND dual_control_threshold_cents IS NULL)
  ),

  -- A dual-control citation is a check ON a named operator. Without an
  -- operator there is nobody for the second person to be second to.
  ADD CONSTRAINT wallet_withdrawals_dual_control_names_an_approver CHECK (
    dual_control_approval_id IS NULL OR approved_by IS NOT NULL
  ),

  -- An operator approval that recorded no threshold is an operator approval
  -- measured against nothing, which is how the control below passes vacuously.
  ADD CONSTRAINT wallet_withdrawals_operator_approval_records_threshold CHECK (
    approved_by IS NULL OR dual_control_threshold_cents IS NOT NULL
  ),

  -- THE CONTROL ITSELF. 0038:235-238's shape, over approved_by rather than
  -- unconditionally, because the machine arm has no first hand.
  ADD CONSTRAINT wallet_withdrawals_operator_approval_dual_controlled CHECK (
    approved_by IS NULL
    OR amount_cents < dual_control_threshold_cents
    OR dual_control_approval_id IS NOT NULL
  ),

  -- 0068's repair, arriving with the column instead of nine migrations later.
  ADD CONSTRAINT wallet_withdrawals_dual_control_threshold_ceiling CHECK (
    dual_control_threshold_cents IS NULL
    OR (dual_control_threshold_cents > 0
        AND dual_control_threshold_cents <= 500000)
  );

COMMENT ON CONSTRAINT wallet_withdrawals_operator_approval_dual_controlled
  ON wallet_withdrawals IS
  'ADR-232, and the founder answer of 2026-08-29 recorded in ADR-228 section 1: '
  '500000 integer cents ($5,000) is the amount above which a second human '
  'approves. Written over approved_by because that column is what distinguishes '
  'the two hands that reach this edge. A machine approval satisfies it with '
  'approved_by NULL and takes no dual control, on ADR-232 section 4: both '
  'guards on this edge name no human, so there is no first approver for a '
  'second to check, and a trader locked out of their own money by a control '
  'meant to stop operator fraud is a worse product than the fraud. An operator '
  'approval at or above the threshold it recorded is unwritable without a row '
  'in dual_control_approvals, and assert_withdrawal_dual_control_is_real is '
  'what makes that row an approval rather than a reference.';

COMMENT ON CONSTRAINT wallet_withdrawals_dual_control_threshold_ceiling
  ON wallet_withdrawals IS
  'ADR-232 on 0068''s precedent. A CEILING and not an equality: this column '
  'records the threshold IN FORCE when the row was approved, so an equality '
  'CHECK would make every historical row unrepresentable the first time the '
  'threshold moved. A writer may name a LOWER threshold, which can only require '
  'MORE approvals, and may not name a higher one, which can only require fewer. '
  'Raising it is a migration, which is deploy access rather than the route '
  'access ADR-067 section 5 assumes compromised, and that asymmetry is the '
  'control.';

-- -----------------------------------------------------------------------------
-- A CITED APPROVAL IS AN APPROVAL OF THIS WITHDRAWAL, BY SOMEBODY ELSE
-- -----------------------------------------------------------------------------
CREATE FUNCTION assert_withdrawal_dual_control_is_real() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approval dual_control_approvals%ROWTYPE;
BEGIN
  SELECT * INTO approval
    FROM dual_control_approvals
   WHERE id = NEW.dual_control_approval_id;

  -- The FOREIGN KEY is also DEFERRABLE-free and fires first, so a missing row
  -- is already refused. This branch exists because a trigger that dereferences
  -- a row it did not find would raise a null-comparison pass rather than an
  -- error, which is the fail-open direction.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'WD-DC1: wallet withdrawal % cites dual control approval %, which does '
      'not exist',
      NEW.id, NEW.dual_control_approval_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF approval.subject_kind <> 'wallet_withdrawal' OR approval.subject_id <> NEW.id THEN
    RAISE EXCEPTION
      'WD-DC2: wallet withdrawal % cites dual control approval %, which '
      'approves (%, %). An approval of something else is not an approval of '
      'this withdrawal (SD-M6-05)',
      NEW.id, approval.id, approval.subject_kind, approval.subject_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION
      'WD-DC3: wallet withdrawal % cites dual control approval %, whose status '
      'is %. A pending, expired or withdrawn row is a request for a second '
      'person and not a second person (0016)',
      NEW.id, approval.id, approval.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- THE SECOND-PERSON RULE IS NOT RESTATED HERE. Binding the operator of
  -- record to requested_by makes 0016's own
  -- dual_control_approvals_second_person the rule that refuses approved_by =
  -- requested_by, and one control composed with beats two copies that drift.
  IF approval.requested_by <> NEW.approved_by THEN
    RAISE EXCEPTION
      'WD-DC4: wallet withdrawal % records approved_by % and cites dual '
      'control approval % requested by %. The operator who approves the '
      'withdrawal is the one the second person checks, so the two names are '
      'one name',
      NEW.id, NEW.approved_by, approval.id, approval.requested_by
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_withdrawals_dual_control_is_real
  AFTER INSERT OR UPDATE ON wallet_withdrawals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.dual_control_approval_id IS NOT NULL)
  EXECUTE FUNCTION assert_withdrawal_dual_control_is_real();

COMMENT ON FUNCTION assert_withdrawal_dual_control_is_real() IS
  'ADR-232, SD-M6-05. A foreign key proves a row exists and says nothing about '
  'what it says. This asserts the three things that matter: the approval names '
  'THIS withdrawal (subject_kind, subject_id), it is in status approved rather '
  'than pending, and its requester is the withdrawal''s own approved_by, which '
  'lets 0016''s dual_control_approvals_second_person be the second-person rule '
  'rather than a second copy of it. payload_hash is deliberately unread: the '
  'bytes an operator approved are an admin request body and a withdrawal row is '
  'not one, so pinning it belongs to the origination route ADR-069 section 5 '
  'names and this tree does not have.';

COMMIT;
