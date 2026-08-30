-- =============================================================================
-- 0076_firm_parameter_write_control
-- =============================================================================
-- E2 READ: MONEY ADJACENT. Nothing here moves a cent. What it does is decide
-- who may write the number that `POST /checkout` reads FIRST on both of its
-- paths, which is the number that decides how much of the firm's tail risk one
-- buyer may accumulate. `0074` said the same sentence about the row; this file
-- says it about the WRITE.
--
-- ADR-284 (status: proposed, founder approval PENDING) is the ruling. It builds
-- on ADR-252 (the row), ADR-265 (the door), ADR-237 (`0073`, the operator
-- directory) and ADR-232 (`0070`, the approval edge this file's shape is
-- copied from). NOTHING HERE IS SIGNED.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE IS FOR, IN ONE PARAGRAPH
-- -----------------------------------------------------------------------------
-- `firm_parameters` ships empty and NOTHING WRITES IT. `useCheckoutBackend`'s
-- entry and `routes/checkout.ts`'s header both call that the whole of what is
-- left of the account cap: a cap with a source, a door, and no row. The row
-- needs a writer, a writer is an operator act, and an operator act on a config
-- number is the exact act Appendix D4 and ADR-010 name. SO THE CONTROL LANDS
-- BEFORE THE ROW DOES. Every part below refuses something a bare `INSERT` can
-- do against the merged schema today.
--
-- IT WRITES NO ROW AND SEEDS NOTHING. There is no cap here, no operator here
-- and no approval here. A number, a name and an approval are acts of the firm,
-- and `0074` already refused to invent the first of them for exactly this
-- reason. This file makes those three acts REQUIRED and does not perform them.
--
-- -----------------------------------------------------------------------------
-- WHAT WAS MISSING, MEASURED AT THE CATALOG RATHER THAN ASSERTED
-- -----------------------------------------------------------------------------
-- Read out of a PostgreSQL 16.13 instance carrying `0001` to `0075` applied
-- forward-only from empty under `ON_ERROR_STOP=1`:
--
--   1. `firm_parameters` DECLARES NO `uuid` COLUMN. Zero, over six columns.
--      `admin_actions.subject_id` is `uuid NOT NULL` (`0017:79`) and
--      `dual_control_approvals.subject_id` is `uuid NOT NULL` (`0016:229`), so
--      THE AUDIT ROW API_CONTRACT SECTION 8 REQUIRES OF EVERY ADMIN MUTATION
--      CANNOT NAME A CAP ROW AT ALL, and neither can an approval of one. This
--      was found by writing the insert, not by reading the file. It is `0048`
--      item 0's shape: a ruled act that is not performable against the merged
--      schema, unnoticed because the table has zero rows.
--
--   2. `dual_control_approvals.requested_by` AND `approved_by` HAVE NO FOREIGN
--      KEY. Three constraints in this schema reference `operators` and none of
--      them is on that table. `0073` gave `admin_actions.actor` its referent
--      and left the approval table where it found it, so "a second person"
--      is satisfied today by any string, INCLUDING A STRING NAMING NOBODY, and
--      `dual_control_approvals_second_person` only requires that the string
--      differ from the requester's. That is `0073`'s own finding about `0017`,
--      standing one table over, on the table that IS the dual control.
--
--   3. `firm_parameters` GRANTS `merit_app` `UPDATE` AND `DELETE`. The file's
--      own promise is that a change is a new row and never an UPDATE, "so the
--      number in force on the day a purchase was refused stays readable after
--      the number has moved". Nothing enforced it.
--
-- -----------------------------------------------------------------------------
-- THE FIVE PARTS, AND EACH IS SEPARATELY REJECTABLE
-- -----------------------------------------------------------------------------
-- Written as parts on `0048`'s and `0033`'s precedent. Rejecting any one leaves
-- the others standing, and ADR-284 names what each costs.
--
--   1. `firm_parameters.id`, the surrogate handle the audit spine needs.
--   2. `firm_parameters.dual_control_approval_id`, `0070`'s column on the row
--      that needs a second person.
--   3. Two foreign keys putting `dual_control_approvals`' two names in the
--      operator directory, which is finding 2 above.
--   4. `FP-DC`, the assertion that a cited approval is an approval OF THIS
--      CHANGE, BY A SECOND `owner`. `0070`'s trigger, with the payload leg
--      that file could not write.
--   5. `FP-A` and `FP-S`: the change is audited, and the row is superseded
--      rather than rewritten.
--
-- -----------------------------------------------------------------------------
-- WHY THE CONTROL IS TABLE WIDE AND NAMES NO PARAMETER
-- -----------------------------------------------------------------------------
-- `firm_parameters_vocabulary_is_closed` admits ONE member and `0074` rules
-- that a second one is "an ADR plus a superseding migration". So "every write
-- to this table is dual controlled" and "every cap edit is dual controlled" are
-- the SAME SET today, and the day they stop being the same set, the ADR that
-- widens the vocabulary is the document that decides whether the new member
-- carries this control. A per-parameter exemption written here in advance would
-- be a control with a hole shaped like a parameter nobody has proposed.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- -----------------------------------------------------------------------------
-- THE DELAY WINDOW IS NOT INSTALLED, BECAUSE THE CORPUS STATES NO DURATION.
-- Constitution D4 and ADR-010 both require "dual control plus a delay window"
-- and NEITHER STATES A NUMBER, and SECURITY C-10 restates the pair without one.
-- The only duration in the neighbourhood is the 48 hour cooling on a PAYOUT
-- DESTINATION change, which is a different control on a different act. A number
-- written here would be a number this session invented, which is `0073`'s
-- ruling on the operator session lifetime ceiling applied a second time. WHAT
-- IS INSTALLED INSTEAD IS THE HALF THAT NEEDS NO NUMBER: a row may not take
-- effect before it was approved (`FP-DC7`). That is not the delay window and it
-- is not described as one.
--
-- IT DOES NOT REVOKE THE GRANT, WHICH IS `0026`'s OWN IDIOM AND IS THE STRONGER
-- CONTROL. `FP-S` is a trigger, and `0048` item 2 is right that a grant beats a
-- function body because a reviewer can miss a wrong `SET` clause and cannot
-- miss a missing privilege. The revoke is not taken here because the append-only
-- set is asserted AGAINST A DOCUMENT by `scripts/db/assert_append_only_grants.
-- mjs` (OI-03) in both directions, so revoking without amending the Mutability
-- list turns that assertion red, and that document is outside this row's fence.
-- ADR-284 section 8 records the supersession that owes it.
--
-- IT WRITES NO OPERATOR. The first `operators` rows are a bootstrap: an admin
-- route that creates operators cannot be the thing that creates the first
-- operator. ADR-284 section 6 rules that act deploy access rather than route
-- access, which is `0070`'s own asymmetry, and refuses to seed a name here:
-- a real operator's identifiers are not this repository's to hold (ADR-012),
-- and an invented one is a row somebody would have to remember to delete.
--
-- IT IS NOT A LOGIN, A CREDENTIAL OR A SECRET. No password column, no key
-- material, no hostname and no bucket. Merit is passwordless by ADR-039 and
-- `0002:280` states it for the whole schema. Nothing here can mint a session.
--
-- `0016`, `0017` AND `0074` ARE MERGED AND ARE NOT EDITED. They are superseded
-- BY ADDITION, which is constitution E2 and `0028`'s, `0048`'s, `0068`'s,
-- `0070`'s, `0072`'s and `0073`'s mechanism on this estate.
--
-- -----------------------------------------------------------------------------
-- THIS FILE FAILS ON A DEPLOYMENT THAT ALREADY WROTE A CAP BY HAND, ON PURPOSE
-- -----------------------------------------------------------------------------
-- Part 2 adds a `NOT NULL` column with no default, so an existing
-- `firm_parameters` row stops the migration. No such row exists on any
-- deployment this tree can produce, because nothing under any `src/` writes
-- one. If one exists anyway it was written outside every control in this file,
-- and a migration that back-filled it would be blessing an unapproved cap in
-- the name of applying cleanly. The remedy is to delete the row and write it
-- again through the control, or to supersede this file.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. THE HANDLE THE AUDIT SPINE ADDRESSES ROWS BY
-- -----------------------------------------------------------------------------
-- `0074` declares "The table has no uuid of its own, which is `price_floors`'
-- shape exactly", and the reason it gives is about the PRIMARY KEY: two rows for
-- one parameter at one instant would make "which number was in force" ambiguous.
-- THAT REASON IS UNTOUCHED. The primary key stays `(parameter, effective_from)`
-- and stays the grain. What this column adds is a name the rest of the schema
-- can pronounce, because `admin_actions` and `dual_control_approvals` both
-- address their subject as `(text, uuid)` and a composite key has nowhere to go
-- in a `uuid` column.
--
-- UNIQUE AND NOT THE KEY. A second unique constraint costs one index and makes
-- the surrogate a referent; promoting it to the primary key would be an edit to
-- the grain `0074` chose, in a file that is not allowed to edit `0074`.
--
-- THE DEFAULT IS A CONVENIENCE AND NEVER THE PATH. A writer that lets the
-- database generate this id cannot have named the row in the approval it needs,
-- because the approval is written first and `FP-DC2` compares the two. So the
-- real writer supplies the id, and the default exists so that a reader poking at
-- the table in a scratch database is refused by `FP-DC1` rather than by a
-- `NOT NULL`.
ALTER TABLE firm_parameters
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE firm_parameters
  ADD CONSTRAINT firm_parameters_id_uq UNIQUE (id);

COMMENT ON COLUMN firm_parameters.id IS
  'ADR-284. A surrogate handle, not the grain: the primary key is still '
  '(parameter, effective_from) and 0074''s reasoning for it is untouched. It '
  'exists because admin_actions.subject_id and dual_control_approvals.'
  'subject_id are both uuid NOT NULL, so without it the audit row API_CONTRACT '
  'section 8 requires of every admin mutation cannot name this row and neither '
  'can an approval of it. Supplied by the writer rather than defaulted, '
  'because the approval names it before the row exists.';

-- -----------------------------------------------------------------------------
-- 2. THE CITED APPROVAL
-- -----------------------------------------------------------------------------
-- `0070`'s column, on the second table that needs it. NOT NULL here where
-- `wallet_withdrawals` made it nullable, and the difference is the whole
-- ruling: a withdrawal has a machine arm that names no human, so an approval
-- there is conditional on a threshold; a config edit has no machine arm at all.
-- Every row in this table is a config edit touching the cap.
--
-- UNIQUE, SO AN APPROVAL IS SPENT ONCE. Without it, one approved payload could
-- be cited by a second row, and `FP-DC5` would refuse the mismatch only because
-- the payload differs. Two rows that happened to differ in nothing but their
-- `id` would both pass. The constraint is the control and the trigger is the
-- reason.
--
-- ON UPDATE RESTRICT AND ON DELETE RESTRICT, which is `0073`'s ruling on
-- `admin_actions.actor` in the other direction: the approval that authorised a
-- number in force in the past is a historical fact, and a cascade would delete
-- the evidence out from under it.
ALTER TABLE firm_parameters
  ADD COLUMN dual_control_approval_id uuid NOT NULL
    REFERENCES dual_control_approvals(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE firm_parameters
  ADD CONSTRAINT firm_parameters_approval_is_spent_once
    UNIQUE (dual_control_approval_id);

COMMENT ON COLUMN firm_parameters.dual_control_approval_id IS
  'ADR-284, SD-M6-05, on 0070''s column. The second person''s row. NOT NULL '
  'and not conditional on a threshold: 0070 made it conditional because a '
  'withdrawal has a machine arm that names no human, and a firm parameter has '
  'none. UNIQUE so one approval authorises one row. A foreign key proves the '
  'row exists and says nothing about what it says, which is what FP-DC asserts.';

-- -----------------------------------------------------------------------------
-- 3. THE TWO NAMES IN THE DIRECTORY
-- -----------------------------------------------------------------------------
-- `0073`'s finding, standing on the table that IS the dual control. Its header
-- reads: "An audit row whose actor resolves to no row is an explanation in the
-- shape of one." An APPROVAL whose approver resolves to no row is a second
-- person in the shape of one, and it is worse, because
-- `dual_control_approvals_second_person` reads as though it settled the
-- question: it requires only that the two strings DIFFER.
--
-- WITHOUT THIS PART, PART 4 IS THEATRE ON ITS OWN TERMS. `FP-DC4` binds the
-- approval's requester to `firm_parameters.approved_by`, which `0074` already
-- resolves into `operators`. So the REQUESTER is a real operator by
-- composition today. THE CHECKER IS NOT, and the checker is the entire control.
-- Appendix D names ceremonial approval as worse than nothing "because it reads
-- as a control in an audit".
--
-- BOTH COLUMNS, NOT ONE. `requested_by` is `NOT NULL` and names whoever asked;
-- a request by nobody is a queue entry no operator has to answer for.
-- `approved_by` is nullable and a NULL is a pending row, which a foreign key
-- admits unchanged.
--
-- ON UPDATE RESTRICT AND ON DELETE RESTRICT, `0073`'s ruling verbatim: renaming
-- an actor would rewrite who approved a past act, and an operator who has
-- approved something can be suspended and can never be deleted.
--
-- THE TABLE IS EMPTY ON EVERY DEPLOYMENT THIS TREE CAN PRODUCE. Nothing under
-- any `src/` writes a `dual_control_approvals` row: the withdrawal path that
-- cites one is itself unwired. So this is a tightening with no back-fill, and
-- if a row exists anyway the migration stops, which is part 2's reasoning.
ALTER TABLE dual_control_approvals
  ADD CONSTRAINT dual_control_approvals_requester_is_an_operator
    FOREIGN KEY (requested_by) REFERENCES operators(actor)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE dual_control_approvals
  ADD CONSTRAINT dual_control_approvals_approver_is_an_operator
    FOREIGN KEY (approved_by) REFERENCES operators(actor)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

COMMENT ON CONSTRAINT dual_control_approvals_approver_is_an_operator
  ON dual_control_approvals IS
  'ADR-284, on 0073''s ruling for admin_actions.actor. The half that makes '
  'dual_control_approvals_second_person a control rather than a string '
  'comparison: that CHECK requires only that the approver differ from the '
  'requester, so before this constraint any string that was not the '
  'requester''s satisfied it, including a string naming nobody.';

-- -----------------------------------------------------------------------------
-- 4. WHAT AN APPROVAL HAS TO SAY. FP-DC
-- -----------------------------------------------------------------------------
-- `0070`'s `assert_withdrawal_dual_control_is_real`, with the leg that file
-- named and could not write. Its own comment says `payload_hash` is
-- "deliberately unread: the bytes an operator approved are an admin request
-- body and a withdrawal row is not one". HERE THE ROW IS THE PAYLOAD. A cap
-- change has no prior state to approve, so the thing a second person checks IS
-- the number, the date and the written reason, and the column `0016` added for
-- exactly that ("An approval that does not pin the payload approves whatever
-- the request happens to say when it executes") finally has a reader.

-- The canonical bytes of one firm parameter change.
--
-- LENGTH PREFIXED, SO THE ENCODING IS INJECTIVE. A plain delimiter join lets a
-- crafted `reason` reproduce another change's bytes, which would let one
-- approved payload authorise a different number. Every field is written as its
-- own octet length, a colon and its value, so no two distinct tuples share an
-- encoding.
--
-- THE TIMESTAMP IS RENDERED IN UTC AND NEVER CAST TO `text`. A `timestamptz`
-- cast to text is rendered in the SESSION's TimeZone, so the same row would
-- digest differently for two operators, and the second person's approval would
-- verify or not depending on where they were sitting. Storage is UTC by the
-- constitution's own convention and this reads it that way.
--
-- `created_at` IS EXCLUDED AND IT IS THE ONLY EXCLUSION. It defaults to `now()`
-- at insert, so it is unknowable when the approval is written and pinning it
-- would make every approval unusable. `dual_control_approval_id` is excluded
-- too and is pinned instead by `FP-DC2` and by the UNIQUE in part 2.
CREATE FUNCTION firm_parameter_payload_digest(
  p_id             uuid,
  p_parameter      text,
  p_integer_value  integer,
  p_reason         text,
  p_effective_from timestamptz,
  p_approved_by    text
) RETURNS bytea
LANGUAGE sql STABLE AS $$
  SELECT sha256(convert_to(
    octet_length(p_id::text)::text || ':' || p_id::text ||
    octet_length(p_parameter)::text || ':' || p_parameter ||
    octet_length(p_integer_value::text)::text || ':' || p_integer_value::text ||
    octet_length(p_reason)::text || ':' || p_reason ||
    octet_length(to_char(p_effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'))::text
      || ':' || to_char(p_effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') ||
    octet_length(p_approved_by)::text || ':' || p_approved_by,
    'UTF8'));
$$;

COMMENT ON FUNCTION firm_parameter_payload_digest(
  uuid, text, integer, text, timestamptz, text
) IS
  'ADR-284, SD-M6-05. The bytes a second person approves, so that '
  'dual_control_approvals.payload_hash pins WHICH change rather than merely '
  'recording that somebody approved something. Length prefixed so the encoding '
  'is injective, and the timestamp is rendered in UTC rather than cast, '
  'because a timestamptz cast to text is rendered in the session''s TimeZone '
  'and would digest differently for two operators in two places. Excludes '
  'created_at alone, which does not exist when the approval is written.';

CREATE FUNCTION assert_firm_parameter_is_dual_controlled() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approval dual_control_approvals%ROWTYPE;
  writer   operators%ROWTYPE;
  checker  operators%ROWTYPE;
  expected bytea;
BEGIN
  SELECT * INTO approval
    FROM dual_control_approvals
   WHERE id = NEW.dual_control_approval_id;

  -- The foreign key fires first and a missing row is already refused. This
  -- branch exists because a trigger that dereferenced a row it did not find
  -- would compare against NULL and PASS, which is the fail-open direction.
  -- 0070's own reasoning, kept.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'FP-DC1: firm parameter % cites dual control approval %, which does not exist',
      NEW.id, NEW.dual_control_approval_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF approval.subject_kind <> 'firm_parameter' OR approval.subject_id <> NEW.id THEN
    RAISE EXCEPTION
      'FP-DC2: firm parameter % cites dual control approval %, which approves '
      '(%, %). An approval of something else is not an approval of this change '
      '(SD-M6-05)',
      NEW.id, approval.id, approval.subject_kind, approval.subject_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF approval.status <> 'approved' THEN
    RAISE EXCEPTION
      'FP-DC3: firm parameter % cites dual control approval %, whose status is '
      '%. A pending, expired or withdrawn row is a request for a second person '
      'and not a second person (0016)',
      NEW.id, approval.id, approval.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- THE SECOND-PERSON RULE IS NOT RESTATED HERE, on 0070's reasoning. Binding
  -- the operator of record to requested_by makes 0016's own
  -- dual_control_approvals_second_person the rule that refuses approved_by =
  -- requested_by, and one control composed with beats two copies that drift.
  IF approval.requested_by <> NEW.approved_by THEN
    RAISE EXCEPTION
      'FP-DC4: firm parameter % records approved_by % and cites dual control '
      'approval % requested by %. The operator who signs the number is the one '
      'the second person checks, so the two names are one name',
      NEW.id, NEW.approved_by, approval.id, approval.requested_by
      USING ERRCODE = 'check_violation';
  END IF;

  expected := firm_parameter_payload_digest(
    NEW.id, NEW.parameter, NEW.integer_value, NEW.reason, NEW.effective_from, NEW.approved_by
  );
  IF approval.payload_hash IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'FP-DC5: firm parameter % does not match the payload dual control '
      'approval % pins. The second person approved a different value, date or '
      'reason, and an approval that does not pin the payload approves whatever '
      'the request happens to say when it executes (0016)',
      NEW.id, approval.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- API_CONTRACT section 8 bounds `ops` to "read plus account actions, NO
  -- CONFIG OR ROLE CHANGES", and a firm parameter is config. ADR-010 names the
  -- credential in the same word: "a second `owner` credential must exist before
  -- the first sensitive config edit". BOTH HANDS, because a second person
  -- without the authority to make the change is not a check on it.
  --
  -- STATUS AS WELL AS ROLE. 0073 declares `status` to be "whether they may act
  -- today, which is not whether they exist", and an operator row can never be
  -- deleted once it has acted, so a suspension is the only offboarding there is.
  SELECT * INTO writer FROM operators WHERE actor = NEW.approved_by;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'FP-DC6: firm parameter % is signed by %, who is in no operator directory',
      NEW.id, NEW.approved_by
      USING ERRCODE = 'check_violation';
  END IF;
  IF writer.role <> 'owner' OR writer.status <> 'active' THEN
    RAISE EXCEPTION
      'FP-DC6: firm parameter % is signed by %, whose role is % and whose '
      'status is %. A config edit is an owner act by an operator who may act '
      'today (API_CONTRACT section 8, ADR-010)',
      NEW.id, writer.actor, writer.role, writer.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO checker FROM operators WHERE actor = approval.approved_by;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'FP-DC6: dual control approval % for firm parameter % was approved by %, '
      'who is in no operator directory',
      approval.id, NEW.id, approval.approved_by
      USING ERRCODE = 'check_violation';
  END IF;
  IF checker.role <> 'owner' OR checker.status <> 'active' THEN
    RAISE EXCEPTION
      'FP-DC6: dual control approval % for firm parameter % was approved by %, '
      'whose role is % and whose status is %. The second hand on a config edit '
      'is an owner who may act today (API_CONTRACT section 8, ADR-010)',
      approval.id, NEW.id, checker.actor, checker.role, checker.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- NOT THE DELAY WINDOW, AND IT MUST NOT BE READ AS ONE. D4 and ADR-010
  -- require a delay and state no duration, so none is installed. What this
  -- refuses is the other direction: a row dated BEFORE its own approval takes
  -- effect the instant it is written and silently changes what was in force
  -- while a purchase was being refused, which is the one thing an effective
  -- dated table exists to make impossible.
  IF NEW.effective_from < approval.approved_at THEN
    RAISE EXCEPTION
      'FP-DC7: firm parameter % takes effect at % and was approved at %. A '
      'number cannot have been in force before the second person agreed to it',
      NEW.id, NEW.effective_from, approval.approved_at
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION assert_firm_parameter_is_dual_controlled() IS
  'ADR-284, on 0070''s assert_withdrawal_dual_control_is_real. Seven '
  'assertions: the approval exists, it names THIS row, it is approved rather '
  'than pending, its requester is the row''s own approved_by so that 0016''s '
  'second-person CHECK is the second-person rule, its payload_hash is this '
  'row''s canonical digest, both hands are active owners, and the row does not '
  'take effect before it was approved. FP-DC7 IS NOT THE DELAY WINDOW: D4 and '
  'ADR-010 require one and state no duration, and inventing a number here is '
  'the thing 0074 refused to do with the cap itself.';

-- DEFERRABLE INITIALLY DEFERRED, on 0070's and 0048's shape. A writer inserts
-- the row and the audit row in one transaction and the order inside it is the
-- writer's business, not a contract written in a trigger.
--
-- INSERT OR UPDATE even though part 5 refuses UPDATE outright. Defence in
-- depth costs one clause: the day somebody supersedes FP-S with a narrower
-- rewrite path, this assertion is already standing on it.
CREATE CONSTRAINT TRIGGER firm_parameters_dual_control_is_real
  AFTER INSERT OR UPDATE ON firm_parameters
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_firm_parameter_is_dual_controlled();

-- -----------------------------------------------------------------------------
-- 5. THE AUDIT ROW, AND THE SUPERSESSION. FP-A AND FP-S
-- -----------------------------------------------------------------------------
-- API_CONTRACT section 8: "Every mutating admin endpoint writes an
-- `admin_actions` row with actor, reason, before, and after, and requires a
-- non-empty `reason`." `firm_parameters.reason` is `NOT NULL` already, so the
-- question this part answers is not whether a reason exists. It is whether the
-- act is in the OPERATOR'S OWN LOG: `admin_actions_actor_idx` is the index that
-- answers "what did this person do", and a cap change recorded only in
-- `firm_parameters.approved_by` is invisible to it. `0017` states the same
-- shape as a rule: the audit table exists alongside `events` so that the audit
-- query never depends on payload shape, "and the duplication is the point".
CREATE FUNCTION assert_firm_parameter_change_is_audited() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
     FROM admin_actions
    WHERE subject_kind = 'firm_parameter'
      AND subject_id = NEW.id
      AND actor = NEW.approved_by;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'FP-A1: firm parameter % was written with no admin_actions row naming it '
      'and its operator %. NO UNEXPLAINED ADMIN ACTION, EVER (0017), and an '
      'act recorded only on the row it changed is invisible to the query that '
      'asks what an operator did',
      NEW.id, NEW.approved_by
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION assert_firm_parameter_change_is_audited() IS
  'ADR-284, 0017, API_CONTRACT section 8. The act has to appear in the '
  'operator''s own log and not only on the row it changed. The actor leg is '
  'what makes it THIS act''s record rather than any row that happens to name '
  'the subject: admin_actions.reason is NOT NULL, so an audited change carries '
  'a written reason by 0017''s own control.';

CREATE CONSTRAINT TRIGGER firm_parameters_change_is_audited
  AFTER INSERT OR UPDATE ON firm_parameters
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_firm_parameter_change_is_audited();

-- `0074`'s own promise, enforced: "ONE ROW PER (PARAMETER, EFFECTIVE DATE). A
-- change is a new row and never an UPDATE, so the number in force on the day a
-- purchase was refused stays readable after the number has moved." Nothing
-- enforced it, and `merit_app` holds UPDATE and DELETE on this table.
--
-- DELETE IS THE HOLE THAT MATTERS AND IT IS THE QUIET ONE. An UPDATE that moved
-- the number would already fail FP-DC5, because the digest no longer matches
-- the approval. A DELETE fails nothing: removing the newest row makes an older,
-- higher cap current again, with no new row, no approval and no audit trail,
-- and the door would read the resurrected number and answer with it.
CREATE FUNCTION refuse_firm_parameter_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'FP-S1: a firm parameter row may not be changed by %. A change is a NEW '
    'ROW at a new effective_from, approved on its own terms, so that the '
    'number in force on the day a purchase was refused stays readable after '
    'the number has moved (0074). Deleting the current row silently restores '
    'the superseded one',
    TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION refuse_firm_parameter_rewrite() IS
  'ADR-284. 0074 promised supersession and nothing enforced it. A trigger '
  'rather than 0026''s revoke, which is the stronger control and is owed: the '
  'append-only set is asserted against the Mutability document by scripts/db/'
  'assert_append_only_grants.mjs in both directions, so the revoke and the '
  'document move together or that assertion goes red.';

CREATE TRIGGER firm_parameters_are_superseded_never_rewritten
  BEFORE UPDATE OR DELETE ON firm_parameters
  FOR EACH ROW
  EXECUTE FUNCTION refuse_firm_parameter_rewrite();

COMMIT;
