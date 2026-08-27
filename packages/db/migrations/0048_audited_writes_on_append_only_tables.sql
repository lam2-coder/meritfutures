-- =============================================================================
-- 0048_audited_writes_on_append_only_tables
-- =============================================================================
-- E2 READ: MONEY PATH. This file opens three write paths into tables where
-- 0026 revoked UPDATE from merit_app AND from PUBLIC, and closes the one way
-- a trading day can enter the calendar retroactively with nothing recording it.
-- Every part of it either grants a power that did not exist or refuses one that
-- did, so there is no line here that is merely tidy.
--
-- ADR-128, status: proposed, founder approval PENDING. It closes OI-04, OI-12
-- and OI-13 as raised, and it is the DDL half of OI-03; OI-03's own half takes
-- no schema change at all and is scripts/db/assert_append_only_grants.mjs.
--
-- Nothing here edits a merged file. 0002, 0014, 0015, 0026 and 0033 stay
-- exactly as they were written and this file changes what they installed.
-- Migrations are sacred once merged (constitution E2), which is a rule about
-- editing them and not a rule against correcting them. 0028's precedent,
-- applied a fourth time.
--
-- No numbered delta lands here. OI-04, OI-12 and OI-13 are open items, not
-- `SD-nn` rows, so ADR-026's manifest completeness gate has nothing to count
-- and the record is DELTA_MANIFEST section 26 instead.
--
-- -----------------------------------------------------------------------------
-- WHAT THE FOUR PARTS ARE, AND EACH IS SEPARATELY REJECTABLE
-- -----------------------------------------------------------------------------
-- Written as four parts on 0033's precedent, which says of its own counted half
-- "Reject this half if the founder reads the ruling narrowly". Rejecting any one
-- part below leaves the other three standing.
--
--   1. OI-04a  daily_marks_live_per_account_day_uq becomes DEFERRABLE, because
--              without it the ruled correction CANNOT BE PERFORMED AT ALL.
--   2. OI-04a  supersede_daily_mark, the mark-correction path.
--   3. OI-04b  suppress_identity_link, the SD-M7-04 dispute path.
--   4. OI-13   rewrite_rule_state, B.4 step 4's audited rewrite.
--   5. OI-12   CALENDAR-C3, refusing a retroactive trading_calendar INSERT.
--
-- -----------------------------------------------------------------------------
-- NINE THINGS NEED THE FOUNDER'S LINE-BY-LINE READ, AND THE FIRST OF THEM IS A
-- DEFECT IN A MERGED MONEY-PATH MIGRATION RATHER THAN A DESIGN CHOICE
-- -----------------------------------------------------------------------------
--
--   0. THE RULED MARK CORRECTION IS NOT PERFORMABLE AGAINST THE MERGED SCHEMA,
--      AND OI-04 IS UNCLOSEABLE UNTIL THAT IS FIXED. FOUND BY WRITING THE
--      FIXTURE FOR SUCCESS 4 OF THE PROBE, NOT BY READING.
--
--      0014's comment and 0026's comment both state the order: "A CORRECTION
--      PRODUCES A NEW MARK ROW AND POINTS THE OLD ONE HERE", "a correction to a
--      mark inserts a new row and sets superseded_by on the old one". Both
--      halves of that order are refused by the database as it stands:
--
--        INSERT the replacement first  ->  duplicate key value violates unique
--                                          constraint daily_marks_live_per_
--                                          account_day_uq. The partial unique
--                                          index is on `superseded_by IS NULL`,
--                                          so for the instant before the old row
--                                          is pointed away there are TWO live
--                                          marks for the account-day.
--
--        POINT the old row first       ->  insert or update violates foreign key
--                                          constraint. superseded_by references
--                                          daily_marks(id), which is not
--                                          deferrable, so it cannot name a row
--                                          that does not exist yet.
--
--      There is no third order. `daily_marks_no_self_supersede` closes the
--      self-reference, and pointing the old mark at some unrelated row to free
--      the index is the exact thing SUCCESS 4 and REJECTION 5 exist to forbid.
--      SO THE MECHANISM BEHIND THE NEVER-CLAW-BACK PROMISE (DATA_MODEL section
--      16 ruling 2, B4 #5) HAS NEVER BEEN EXECUTABLE. It was never noticed
--      because daily_marks has zero rows and no correction has ever been
--      attempted.
--
--      THE FIX IS TO DEFER THE UNIQUENESS, NOT TO WEAKEN IT. A partial UNIQUE
--      INDEX cannot be deferred, because only a CONSTRAINT can be deferred and a
--      UNIQUE CONSTRAINT cannot be partial. An EXCLUDE constraint can be both,
--      so the index is replaced by
--      `EXCLUDE USING btree (account_id WITH =, trading_day WITH =)
--       WHERE (superseded_by IS NULL) DEFERRABLE INITIALLY DEFERRED`, which is
--      the identical predicate over the identical btree. WHAT CHANGES IS WHEN IT
--      IS CHECKED, and that is 0027, 0033 and CALENDAR-C1's argument arriving on
--      a third guard: a correction is one TRANSACTION, and requiring an order
--      inside it is a contract written in an index and nowhere else.
--
--      THE COST IS STATED RATHER THAN DISCOVERED. Between the INSERT and the
--      UPDATE, inside that one transaction and visible to nothing outside it,
--      the account-day carries two live marks. A query issued by that same
--      transaction in between would see both. The alternative is that the ruled
--      correction cannot happen.
--
--      Reject this part if the founder would rather rule the correction order
--      itself. Parts 2 to 5 stand without it and SUCCESS 4 and 5 of the probe
--      are what would then fail.
--
--   1. THE THREE FUNCTIONS ARE SECURITY DEFINER AND merit_migrator OWNS THEM,
--      WHICH IS 0026's OWN SENTENCE AND HAS A PREREQUISITE 0026 NEVER WROTE.
--      0026 says the two legitimate updates "are performed by SECURITY DEFINER
--      functions owned by merit_migrator rather than by widening the grant".
--      merit_migrator holds NOTHING today: 0026 creates the role, grants USAGE
--      ON SCHEMA public to merit_app and merit_analytics only, and REVOKEs ALL
--      on the schema from PUBLIC. A SECURITY DEFINER function owned by that role
--      therefore fails with `relation "daily_marks" does not exist`, which reads
--      like a missing table and is a missing schema grant. FOUND BY EXECUTING
--      IT, not by reading. So this file grants merit_migrator USAGE on the
--      schema, SELECT on the three tables it must read, and UPDATE on the
--      COLUMNS it must write and no others. Granting the role nothing and
--      leaving the functions owned by the migration user would also work and is
--      NOT what 0026 says.
--
--   2. THE COLUMN-SCOPED UPDATE GRANT IS THE CONTROL, NOT THE FUNCTION BODY.
--      `GRANT UPDATE (superseded_by) ON daily_marks` means that even a defect in
--      the function body, and even a future function written by somebody who
--      copies this one, cannot move a cent of a mark. A reviewer can miss a
--      wrong SET clause; a missing column grant cannot. That is 0026's own
--      argument for the append-only revoke, applied one level down. rule_states
--      is the exception and item 4 is why.
--
--   3. EXECUTE IS REVOKED FROM PUBLIC AND GRANTED TO merit_app. PostgreSQL
--      grants EXECUTE on a new function to PUBLIC by default, so a
--      SECURITY DEFINER function is callable by every role in the cluster the
--      instant it exists. Without the REVOKE, these three functions would hand
--      the append-only bypass to exactly the second connection string 0026's
--      "AND against PUBLIC" exists to stop.
--
--   4. rewrite_rule_state's ASSIGNMENT LIST IS DERIVED FROM THE CATALOGUE,
--      NEVER LISTED. It is built from pg_attribute and executed with the new row
--      bound as a parameter, so a column a later migration adds to rule_states
--      is rewritten with nobody remembering to add it here. That is 0032's
--      `to_jsonb(OLD)` argument -- "a hand-written column list is the same object
--      as a hand-maintained count, and this corpus has now found nine of those
--      wrong" -- applied to the write side. The identifiers come from
--      pg_attribute and go through %I; the values are bound, never interpolated.
--      FOUR COLUMNS ARE EXCLUDED FROM THE LIST AND THAT IS THE CONTROL: id,
--      account_id and trading_day are the row's identity, so a rewrite cannot
--      move a state row to another account or another day, and created_at is the
--      row's birth, so a rewrite cannot make itself look original.
--
--   5. rewrite_rule_state REQUIRES AN admin_actions ROW AND ASSERTS ALMOST
--      NOTHING ABOUT IT. B.4 step 3 says the approval "is an admin_actions row
--      with the report's digest", so requiring the row is transcription. What
--      the row's `action` string should say, and under which key the digest
--      lives, is NOT in the corpus, and a contract invented in a function body
--      is a second contract nobody wrote down (0033 header item 5). So the
--      function asserts that the row exists and that its reason is non-blank,
--      and M01's replay job specifies the rest when it is built.
--
--   6. rewrite_rule_state REQUIRES A VERSION-LIKE INPUT TO HAVE MOVED, and this
--      is the one clause that is a READING rather than a transcription. B.4
--      step 1 scopes divergence detection by engine_version and rows from an
--      older version are "out of scope until step 4 rewrites them", and ADR-047
--      rules the calendar revision the engine's SECOND version-like input whose
--      rewrite "restamps the watermark". So a rewrite that moves neither
--      engine_version nor calendar_revision_id is not B.4 step 4; it is an
--      UPDATE to an append-only table with an approval stapled to it. Reject
--      this clause if the founder reads B.4 narrowly. The other five assertions
--      stand without it.
--
--   8. CALENDAR-C3 IS IMMEDIATE, AND 0032's FOREIGN KEY BECOMES DEFERRABLE SO
--      THAT IT CAN BE. This pairing is the whole shape of part 5 and it was
--      arrived at by watching the alternative fail.
--
--      The guard has to evaluate the fold extent AT THE MOMENT THE DAY IS
--      INSERTED, because that is the question: had anything been folded through
--      this day when it was added. A DEFERRED trigger asks it at COMMIT instead,
--      and then ONE TRANSACTION THAT SEEDS A CALENDAR AND THEN WRITES MARKS
--      AGAINST IT REFUSES ITSELF. That is not hypothetical: it is what
--      probe_calendar_revision_required.sql's own fixture does, and running every
--      existing probe against this schema (DELTA_MANIFEST section 18's rule) is
--      what found it.
--
--      An immediate trigger needs the revision row to exist when the calendar row
--      lands, and 0032 declared trading_calendar_revisions.trading_day a plain
--      foreign key to trading_calendar, so the revision row could not be written
--      first. That foreign key is superseded here as DEFERRABLE INITIALLY
--      DEFERRED, keeping ON DELETE RESTRICT and its name. A revision naming a day
--      that never arrives still fails, at commit rather than at the statement,
--      and it fails; nothing becomes writable that was not.
--
--      THE COST IS AN ORDER, AND IT IS STATED RATHER THAN SILENT, which is the
--      distinction 0033 header item 5 draws when it objects to "a second contract
--      nobody wrote down". A backfill writes the absence record and then adds the
--      day, and CALENDAR-C3's message says so in the sentence a reader meets when
--      they get it wrong. That order also reads correctly: you record that the
--      calendar said nothing about a day BEFORE you make it say something.
--
--   7. CALENDAR-C3's RETROACTIVITY TEST IS THE FOLD EXTENT AND NOT THE COVERAGE
--      WINDOW, AND THE OBVIOUS TEST IS WRONG. OI-12 names the harm as "a day
--      backfilled inside an existing coverage window", which reads as a lookup
--      into trading_calendar_loads. It is not: loading the 2027 calendar writes a
--      load row covering 2027 and then inserts roughly 250 days that are all
--      inside it, so the coverage test would demand 250 revision rows for the
--      one case OI-12 says is ALREADY CORRECT. What makes a day retroactive is
--      that the engine has already folded past it, so the test is
--      NEW.trading_day <= the greatest trading day in fills, daily_marks and
--      rule_states. Those are P1 S-E section 4's ruled partition, the same three
--      tables CALENDAR-C1 counts over, and widening them is a founder's call
--      rather than a migration's (ADR-045's sentence, kept). At launch all three
--      are empty, so seeding years of calendar ahead requires nothing.
--
-- WHAT IS NOT HERE, deliberately: no replay job, no loader, no rows, and no
-- un-suppress path for identity_links. SD-M7-04 rules the suppression and rules
-- nothing about reversing it, and a reversal that no document asks for is a
-- power invented in a migration. daily_marks, identity_links and rule_states all
-- have zero rows today, so nothing below can be read as evidence that any row
-- satisfies it; scripts/db/probe_audited_writes.sql is where the evidence is and
-- it runs in CI on every push.
--
-- Rulings: ADR-128 (OI-04, OI-12, OI-13). Supersedes nothing on disk: it adds
--          paths and a guard to what 0002, 0014, 0015, 0026 and 0033 installed,
--          and 0027 is where the invariant triggers live, which is the idiom
--          part 4 follows.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. What merit_migrator needs in order to be a definer at all
-- -----------------------------------------------------------------------------
-- Header item 1. 0026 names this role "the role that holds DDL" and gives it no
-- privilege of any kind, because DDL is held by table ownership rather than by a
-- grant. A SECURITY DEFINER function owned by it needs schema USAGE to resolve a
-- name and SELECT to evaluate a WHERE clause, and an UPDATE grant alone is not
-- enough: `UPDATE daily_marks SET superseded_by = $1 WHERE id = $2` reads `id`,
-- so without SELECT it fails with `permission denied for table daily_marks`.
-- Both of those failures were produced against PostgreSQL 16 before this block
-- was written rather than anticipated.
--
-- NOTHING HERE WIDENS merit_app OR PUBLIC. The role is NOLOGIN and, before this
-- file, held no privilege on any object in the schema.
GRANT USAGE ON SCHEMA public TO merit_migrator;

GRANT SELECT ON daily_marks, identity_links, rule_states, admin_actions
  TO merit_migrator;

-- Column-scoped, header item 2. These are the only columns any of the three
-- functions below may write, and the grant says so rather than the function body.
GRANT UPDATE (superseded_by) ON daily_marks TO merit_migrator;
GRANT UPDATE (disputed_at, dispute_note, suppressed, suppressed_by)
  ON identity_links TO merit_migrator;

-- rule_states is table-scoped and it is the exception. B.4 step 4 restores the
-- whole computed state under a new version, so the column set it writes is
-- "every column that is not the row's identity", and that set is DERIVED from
-- the catalogue in the function rather than listed. A column-scoped grant would
-- be that same list written a second time, by hand, in the one place a stale
-- copy silently narrows a control instead of failing loudly. The identity
-- columns are protected by the function's exclusion list and by the assertions
-- above it, and REJECTION 8 in the probe is what watches that hold.
GRANT UPDATE ON rule_states TO merit_migrator;

-- -----------------------------------------------------------------------------
-- 1. OI-04a. The uniqueness that made the ruled correction impossible
-- -----------------------------------------------------------------------------
-- Header item 0. This is a DEFECT IN A MERGED MONEY-PATH MIGRATION, proven by
-- execution against PostgreSQL 16 in both directions, and it is corrected here
-- rather than in 0014. 0014 is untouched on disk: migrations are sacred once
-- merged (constitution E2), which is a rule about editing them and not a rule
-- against correcting them. 0028, 0032, 0036, 0037 and 0046 are the precedent,
-- and this is the sixth time.
--
-- THE NAME IS PRESERVED so every document, runbook and generator citing
-- `daily_marks_live_per_account_day_uq` still resolves: DATA_MODEL section 13's
-- invariant table names it, daily_marks.md names it, and
-- packages/rules-engine/test/generators/validate-day-sequence.ts quotes it in a
-- failure message. 0032's precedent on trading_calendar_session_ordered.
--
-- THE PREDICATE IS UNCHANGED AND THE INDEX IS STILL A BTREE. `EXCLUDE USING
-- btree (... WITH =)` builds the same btree over the same two columns with the
-- same partial predicate, so every read that used the index still uses it. The
-- ONE difference is that it can now be deferred, and the error class a violation
-- raises moves from unique_violation to exclusion_violation, which is why the
-- probe checks it by class as well as by name.
-- DROP INDEX and not DROP CONSTRAINT: 0014 created a bare index, so there is no
-- constraint row to drop and `DROP CONSTRAINT IF EXISTS` would emit a NOTICE
-- saying so on every install.
DROP INDEX daily_marks_live_per_account_day_uq;

ALTER TABLE daily_marks ADD CONSTRAINT daily_marks_live_per_account_day_uq
  EXCLUDE USING btree (account_id WITH =, trading_day WITH =)
  WHERE (superseded_by IS NULL)
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT daily_marks_live_per_account_day_uq ON daily_marks IS
  'DATA_MODEL section 13: exactly one live mark per account per trading day. '
  'Was a partial UNIQUE INDEX in 0014 and is an EXCLUDE constraint here for one '
  'reason: the ruled correction order (insert the replacement, then point the '
  'old row at it) is refused by an immediate check in BOTH directions, so the '
  'never-claw-back mechanism was unexecutable. ADR-128, OI-04.';

-- -----------------------------------------------------------------------------
-- 2. OI-04a. supersede_daily_mark: a correction that cannot rewrite a mark
-- -----------------------------------------------------------------------------
-- DATA_MODEL section 16 ruling 2, confirmed at the Wave 2 gate: "Marks and
-- corrections use supersession, never update." 0014 built the column and the
-- partial unique index that makes it work; 0026 revoked the UPDATE that writes
-- it, and named the function that should exist. This is that function, and its
-- whole job is to be the ONLY way superseded_by moves.
--
-- THE FOUR ASSERTIONS ARE WHAT MAKE IT A PATH RATHER THAN A HOLE. A function
-- that took two ids and wrote the column would be the grant merit_app does not
-- have, handed back through a different door.
CREATE FUNCTION supersede_daily_mark(
  p_superseded_mark_id  bigint,
  p_replacement_mark_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_mark daily_marks;
  new_mark daily_marks;
BEGIN
  SELECT * INTO old_mark FROM daily_marks WHERE id = p_superseded_mark_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MARK-SUPERSEDE: daily_marks row % does not exist. See ADR-128.',
      p_superseded_mark_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO new_mark FROM daily_marks WHERE id = p_replacement_mark_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MARK-SUPERSEDE: the replacement daily_marks row % does not exist. A '
      'correction INSERTS the new mark and then points the old one at it, so '
      'the replacement is written first. See ADR-128.',
      p_replacement_mark_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The correction is for the SAME day and the SAME account, which is the
  -- sentence daily_marks_live_per_account_day_uq assumes and nothing states.
  -- Without it, "supersede" can point a mark at an unrelated row and the live
  -- mark for that account-day silently disappears from the partial index.
  IF new_mark.account_id <> old_mark.account_id
     OR new_mark.trading_day <> old_mark.trading_day THEN
    RAISE EXCEPTION
      'MARK-SUPERSEDE: mark % is account % day % and the replacement % is '
      'account % day %. A correction replaces the SAME account-day; anything '
      'else removes a live mark from daily_marks_live_per_account_day_uq and '
      'puts nothing in its place. See ADR-128.',
      p_superseded_mark_id, old_mark.account_id, old_mark.trading_day,
      p_replacement_mark_id, new_mark.account_id, new_mark.trading_day
      USING ERRCODE = 'check_violation';
  END IF;

  -- Re-pointing an already-superseded mark rewrites the correction chain, which
  -- is the history "what did we believe ON THE DAY" is read from (0014's own
  -- comment). daily_marks_no_self_supersede covers only the degenerate case.
  IF old_mark.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION
      'MARK-SUPERSEDE: daily_marks row % is already superseded by %. The chain '
      'is append-only: supersede the LIVE mark, not a historical one. See '
      'ADR-128.',
      p_superseded_mark_id, old_mark.superseded_by
      USING ERRCODE = 'check_violation';
  END IF;

  -- A superseded replacement is a mark that is already history, so pointing at
  -- it leaves the account-day with no live mark at all.
  IF new_mark.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION
      'MARK-SUPERSEDE: the replacement daily_marks row % is itself superseded '
      'by %, so this would leave account % day % with no live mark. See '
      'ADR-128.',
      p_replacement_mark_id, new_mark.superseded_by,
      old_mark.account_id, old_mark.trading_day
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE daily_marks
     SET superseded_by = p_replacement_mark_id
   WHERE id = p_superseded_mark_id;
END
$$;

ALTER FUNCTION supersede_daily_mark(bigint, bigint) OWNER TO merit_migrator;
REVOKE EXECUTE ON FUNCTION supersede_daily_mark(bigint, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION supersede_daily_mark(bigint, bigint) TO merit_app;

COMMENT ON FUNCTION supersede_daily_mark(bigint, bigint) IS
  'OI-04a, ADR-128. The ONLY path that writes daily_marks.superseded_by. 0026 '
  'revoked UPDATE on daily_marks from merit_app and PUBLIC and named this '
  'function; until now a naive supersession failed at the grant, which is the '
  'correct failure and looked like a bug.';

-- -----------------------------------------------------------------------------
-- 3. OI-04b. suppress_identity_link: the SD-M7-04 dispute path
-- -----------------------------------------------------------------------------
-- INV-M7-09. Two housemates, a married couple sharing a card and a father
-- funding a son's evaluation all produce GENUINE edges between GENUINELY
-- DIFFERENT humans, and ADR-022's soft-link queue makes that population larger
-- rather than smaller. Without this path the graph's errors are permanent and
-- invisible to the person they harm.
--
-- IT IS FOUR COLUMNS AND NOT ONE, WHICH THE REGISTER ROW DOES NOT SAY. OI-04
-- calls this a "single-column update" and `suppressed` is indeed the operative
-- field, but identity_links_suppression_has_author makes suppressed_by
-- mandatory, and a suppression with no date and no note records that an edge
-- stopped counting and not that anybody decided it should. All four move
-- together or the write is not a dispute resolution.
--
-- ONE DIRECTION ONLY, AND THAT IS A DECISION. SD-M7-04 rules the suppression
-- and rules nothing about reversing it. An un-suppress path would re-arm
-- enforcement against a human a reviewer has already cleared, and no document
-- in this corpus asks for it. If one does later it is a second function with its
-- own ADR, not a boolean parameter added here.
CREATE FUNCTION suppress_identity_link(
  p_link_id       uuid,
  p_suppressed_by text,
  p_dispute_note  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  edge identity_links;
BEGIN
  SELECT * INTO edge FROM identity_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'LINK-SUPPRESS: identity_links row % does not exist. See ADR-128.',
      p_link_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF edge.suppressed THEN
    RAISE EXCEPTION
      'LINK-SUPPRESS: identity_links row % is already suppressed by %. The '
      'edge is history and a second suppression would overwrite who decided '
      'the first one. See ADR-128.',
      p_link_id, edge.suppressed_by
      USING ERRCODE = 'check_violation';
  END IF;

  -- btrim rather than IS NOT NULL, on 0032's precedent: the empty string
  -- satisfies IS NOT NULL and is the same class of silent pass as the empty
  -- array ADR-035 found seven times.
  IF p_suppressed_by IS NULL OR length(btrim(p_suppressed_by)) = 0 THEN
    RAISE EXCEPTION
      'LINK-SUPPRESS: a suppression with no author is a suppression nobody '
      'owns (0002, identity_links_suppression_has_author). See ADR-128.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The note is what an edge's removal from enforcement is argued from later,
  -- and it is required here rather than by a CHECK because 0002 left it
  -- nullable for the undisputed row.
  IF p_dispute_note IS NULL OR length(btrim(p_dispute_note)) = 0 THEN
    RAISE EXCEPTION
      'LINK-SUPPRESS: a suppression with no note records that an edge stopped '
      'counting and not that anybody decided it should. "We decided this edge '
      'was wrong" is itself evidence (SD-M7-04). See ADR-128.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE identity_links
     SET suppressed    = true,
         suppressed_by = p_suppressed_by,
         disputed_at   = now(),
         dispute_note  = p_dispute_note
   WHERE id = p_link_id;
END
$$;

ALTER FUNCTION suppress_identity_link(uuid, text, text) OWNER TO merit_migrator;
REVOKE EXECUTE ON FUNCTION suppress_identity_link(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION suppress_identity_link(uuid, text, text) TO merit_app;

COMMENT ON FUNCTION suppress_identity_link(uuid, text, text) IS
  'OI-04b, ADR-128. The ONLY path that suppresses an identity_links edge. Writes '
  'the four SD-M7-04 dispute columns together. There is deliberately no reverse: '
  'SD-M7-04 rules the suppression and rules nothing about reversing it.';

-- -----------------------------------------------------------------------------
-- 4. OI-13. rewrite_rule_state: B.4 step 4's audited rewrite
-- -----------------------------------------------------------------------------
-- M01 appendix B.4 step 4: "An audited rewrite job restores historical
-- rule_states under the new version". 0026 revoked UPDATE on rule_states from
-- merit_app and PUBLIC and no function performs it, so the protocol's fourth
-- step has no way to run. Pre-existing and identical for engine_version;
-- 0035's calendar watermark made a second caller for a path that had none, which
-- is how OI-13 came to be raised there rather than at 0015.
--
-- Header items 4, 5 and 6 are the three things to read here.
CREATE FUNCTION rewrite_rule_state(
  p_state_id                 bigint,
  p_approval_admin_action_id bigint,
  p_new                      rule_states
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_state   rule_states;
  approval    admin_actions;
  assignments text;
BEGIN
  -- B.4 step 3. The approval is provable later or the rewrite does not happen.
  SELECT * INTO approval FROM admin_actions WHERE id = p_approval_admin_action_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'STATE-REWRITE: admin_actions row % does not exist. B.4 step 3 makes the '
      'founder approval an admin_actions row with the report digest, and step 4 '
      'is what that approval authorises. See ADR-128.',
      p_approval_admin_action_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(approval.reason)) = 0 THEN
    RAISE EXCEPTION
      'STATE-REWRITE: admin_actions row % carries a blank reason. NO '
      'UNEXPLAINED ADMIN ACTION, EVER (0017). See ADR-128.',
      p_approval_admin_action_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO old_state FROM rule_states WHERE id = p_state_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'STATE-REWRITE: rule_states row % does not exist. See ADR-128.',
      p_state_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The caller passes a whole row, so the row it passes must be THIS row. The
  -- exclusion list below already makes the three identity columns unwritable;
  -- this is what stops a caller believing it rewrote a different one.
  IF p_new.id <> p_state_id
     OR p_new.account_id  <> old_state.account_id
     OR p_new.trading_day <> old_state.trading_day THEN
    RAISE EXCEPTION
      'STATE-REWRITE: the replacement row is (id %, account %, day %) and the '
      'target is (id %, account %, day %). A rewrite restores THIS row under a '
      'new version; it never moves a state to another account or another day. '
      'See ADR-128.',
      p_new.id, p_new.account_id, p_new.trading_day,
      p_state_id, old_state.account_id, old_state.trading_day
      USING ERRCODE = 'check_violation';
  END IF;

  -- Header item 6, and it is the clause that is a reading rather than a
  -- transcription. B.4 read twice, once per version-like input: engine_version
  -- is the code the fold runs, calendar_revision_id is the data it folds over
  -- (ADR-047). A rewrite that moves neither is an UPDATE to an append-only
  -- table with an approval stapled to it.
  IF p_new.engine_version IS NOT DISTINCT FROM old_state.engine_version
     AND p_new.calendar_revision_id IS NOT DISTINCT FROM old_state.calendar_revision_id THEN
    RAISE EXCEPTION
      'STATE-REWRITE: rule_states row % would be rewritten with engine_version '
      'and calendar_revision_id both unchanged. B.4 step 4 restores rows under '
      'a NEW version, and ADR-047 makes the calendar revision the second '
      'version-like input whose rewrite restamps the watermark. A rewrite that '
      'moves neither is not step 4. See ADR-128.',
      p_state_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Header item 4. DERIVED, NOT LISTED. Identifiers come from the catalogue and
  -- pass through %I; the row is BOUND as $1 and never interpolated.
  SELECT string_agg(format('%I = ($1).%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
    INTO assignments
    FROM pg_attribute a
   WHERE a.attrelid = 'public.rule_states'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname NOT IN ('id', 'account_id', 'trading_day', 'created_at');

  -- A zero here would mean the catalogue query stopped matching, at which point
  -- `SET  WHERE` is a syntax error rather than a silent no-op. Asserted anyway,
  -- because "the guard was simply not looking" is this corpus's most repeated
  -- finding and a sentinel costs three lines.
  IF assignments IS NULL THEN
    RAISE EXCEPTION
      'STATE-REWRITE: the derived assignment list is empty, so the catalogue '
      'read is not seeing rule_states. See ADR-128.'
      USING ERRCODE = 'check_violation';
  END IF;

  EXECUTE format('UPDATE public.rule_states SET %s WHERE id = $2', assignments)
    USING p_new, p_state_id;
END
$$;

ALTER FUNCTION rewrite_rule_state(bigint, bigint, rule_states) OWNER TO merit_migrator;
REVOKE EXECUTE ON FUNCTION rewrite_rule_state(bigint, bigint, rule_states) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION rewrite_rule_state(bigint, bigint, rule_states) TO merit_app;

COMMENT ON FUNCTION rewrite_rule_state(bigint, bigint, rule_states) IS
  'OI-13, ADR-128. B.4 step 4''s audited rewrite, and the ONLY path that updates '
  'rule_states. Requires the step 3 admin_actions approval and a moved '
  'version-like input (engine_version or calendar_revision_id, ADR-047). The '
  'assignment list is derived from pg_attribute; id, account_id, trading_day and '
  'created_at are excluded and therefore unwritable.';

-- -----------------------------------------------------------------------------
-- 5. OI-12. CALENDAR-C3: a retroactive calendar INSERT leaves a record
-- -----------------------------------------------------------------------------
-- 0035's own words: "It does not guard calendar INSERT, and that is a stated
-- exposure. 0033 covers every way a day can CHANGE; an INSERT writes no revision
-- row and moves no watermark. For a FUTURE day that is correct. For a day
-- backfilled inside an existing coverage window it is not: the day sequence
-- moves retroactively and every stamped row still claims a watermark that looks
-- current."
--
-- THE WATERMARK IS WHY A LOAD ROW IS NOT ENOUGH. rule_states.calendar_revision_id
-- points at trading_calendar_revisions, so that table IS the watermark: a
-- backfill that writes no revision row leaves every stamped state row looking
-- current, B.4 step 1 scopes to a set that is unchanged, and the audit compares
-- nothing. An audit that has stopped looking reports exactly like one that found
-- nothing (FM-17). Requiring a trading_calendar_loads row would record the
-- source and move no watermark, which closes the paperwork and not the hole.
--
-- THE PRIOR IMAGE OF A DAY THAT DID NOT EXIST IS THE ABSENCE, AND IT IS NOT A
-- FABRICATION. trading_calendar_revisions_prior_row_is_a_row requires the four
-- keys to be PRESENT and says nothing about their values, and is_holiday is NOT
-- NULL on every real trading_calendar row, so `"is_holiday": null` in a prior
-- image can only mean "no row existed". That is F-4's own vocabulary: a day the
-- calendar said nothing about is UNKNOWN, not a holiday. It is also what stops
-- this guard being satisfied by pointing at some unrelated correction's revision
-- row for the same day.
--
-- THE TRIGGER ASSERTS AND DOES NOT WRITE, which is 0027 and 0033's idiom. It
-- cannot invent an actor, a reason or an incident reference, and
-- trading_calendar_revisions.reason is NOT NULL precisely so that a correction
-- nobody owns is refused rather than recorded.
-- Header item 8. 0032 is untouched on disk and this changes what it installed.
-- The NAME IS PRESERVED and ON DELETE RESTRICT is preserved: what changes is
-- WHEN the referenced day has to exist, which is what lets a backfill record the
-- absence before it adds the day and therefore what lets CALENDAR-C3 be
-- immediate. A revision row naming a day that never arrives still fails.
ALTER TABLE trading_calendar_revisions
  DROP CONSTRAINT trading_calendar_revisions_trading_day_fkey;
ALTER TABLE trading_calendar_revisions
  ADD CONSTRAINT trading_calendar_revisions_trading_day_fkey
  FOREIGN KEY (trading_day) REFERENCES trading_calendar (trading_day)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION assert_retroactive_calendar_insert_is_recorded() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fold_extent date;
  revision    trading_calendar_revisions;
BEGIN
  -- Header item 7. The three tables are P1 S-E section 4's ruled partition,
  -- verbatim, the same ones CALENDAR-C1 counts over. reconciliations and
  -- ingest_files also carry a trading_day and are deliberately NOT read here,
  -- on ADR-045's standing sentence: widening the partition is a founder's call
  -- rather than a migration's.
  --
  -- READ AT INSERT TIME, WHICH IS HEADER ITEM 8's WHOLE POINT. Rows this
  -- transaction has already written are counted, because they were computed
  -- against a calendar that did not have this day in it and are therefore
  -- exactly the state that goes stale. Rows it writes AFTER this point are not,
  -- because they will be folded over the day sequence including this day.
  --
  -- GREATEST ignores NULL arguments and returns NULL only when every argument
  -- is NULL, so an empty book yields NULL and the branch below lets every
  -- insert through. That is the launch case and it must not break: seeding
  -- years of calendar ahead of an engine that has folded nothing is exactly the
  -- write this guard must not touch.
  SELECT greatest(
           (SELECT max(f.trading_day) FROM fills       f),
           (SELECT max(m.trading_day) FROM daily_marks m),
           (SELECT max(s.trading_day) FROM rule_states s)
         )
    INTO fold_extent;

  -- AN EXTENSION, not a backfill. Extending coverage forward changes no
  -- already-computed state, which is OI-12's own carve-out and is why the
  -- coverage window is the wrong test: an ordinary forward load inserts every
  -- day of a year inside the load row it just wrote.
  IF fold_extent IS NULL OR NEW.trading_day > fold_extent THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO revision
    FROM trading_calendar_revisions r
   WHERE r.trading_day = NEW.trading_day
     -- The ABSENCE image. Matched on jsonb_typeof rather than on the day
     -- rendered inside prior_row: a jsonb rendering of a date is STABLE rather
     -- than IMMUTABLE and depends on DateStyle, which is the trap 0032 already
     -- recorded on this column. r.trading_day is the real date column and is
     -- what scopes the lookup.
     AND jsonb_typeof(r.prior_row -> 'is_holiday') = 'null'
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'CALENDAR-C3: trading_calendar day % was INSERTED at or before %, the '
      'last day fills, daily_marks or rule_states have been folded through, and '
      'no trading_calendar_revisions row records it. A day added inside the '
      'folded range moves the day sequence retroactively while every stamped '
      'rule_states row still claims a watermark that looks current, so the '
      'nightly audit scopes to an unchanged set and compares nothing (FM-17). '
      'Write a revision row for this day, in this transaction, whose prior_row '
      'carries "is_holiday": null (the day did not exist), with an actor, a '
      'reason and an incident reference. See ADR-128 and ADR-047.',
      NEW.trading_day, fold_extent
      USING ERRCODE = 'check_violation';
  END IF;

  -- dependent_row_count counts rows on the day ITSELF, and for a day that was
  -- never a trading day that is legitimately zero, so
  -- trading_calendar_revisions_incident_named_when_dependent does not fire and
  -- incident_ref stays optional. The harm here is on every day AFTER this one,
  -- which no per-row count on this table expresses, so the requirement is
  -- stated here instead: a retroactive day insertion is an incident by
  -- construction.
  IF revision.incident_ref IS NULL OR length(btrim(revision.incident_ref)) = 0 THEN
    RAISE EXCEPTION
      'CALENDAR-C3: trading_calendar day % has a revision row (id %) and it '
      'names no incident. A day inserted inside the folded range changes every '
      'counter after it, not the day itself, so dependent_row_count is zero and '
      'the incident requirement it drives never fires. This is an incident by '
      'construction. See ADR-128.',
      NEW.trading_day, revision.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END
$$;

-- IMMEDIATE, and header item 8 is why. CALENDAR-C1 is deferred because the
-- question it asks ("was a prior image written") is a statement about the
-- TRANSACTION. The question here ("had anything been folded through this day
-- when it was added") is a statement about the MOMENT, and deferring it makes a
-- transaction that seeds a calendar and then folds over it refuse itself.
CREATE TRIGGER trading_calendar_retroactive_insert_recorded
  AFTER INSERT ON trading_calendar
  FOR EACH ROW EXECUTE FUNCTION assert_retroactive_calendar_insert_is_recorded();

COMMENT ON FUNCTION assert_retroactive_calendar_insert_is_recorded() IS
  'CALENDAR-C3, OI-12, ADR-128. Refuses an INSERT into trading_calendar for a '
  'day at or before the greatest trading day in fills, daily_marks or '
  'rule_states unless a trading_calendar_revisions row records the absence and '
  'names an incident. Extending coverage forward is untouched.';

COMMIT;
