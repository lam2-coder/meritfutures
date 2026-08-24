-- =============================================================================
-- 0047_publish_decision_is_sound
-- =============================================================================
-- E2 READ: MONEY PATH. `plan_versions` is the rule contract every funded
-- account is sold under, and this file decides what a publish is ALLOWED TO
-- RESOLVE TO. Nothing here edits a merged file: `0045_simulation_runs` stays
-- exactly as it was written and keeps both of its constraints. Migrations are
-- sacred once merged (constitution E2), which is a rule about editing them and
-- not a rule against completing them.
--
-- ADR-087, status `proposed`, approval line UNSIGNED. `OI-29`'s enforcement
-- half. This ADDS a control; it supersedes nothing and retires no name.
--
-- -----------------------------------------------------------------------------
-- CITATION CORRECTION, MADE BEFORE ANYTHING ELSE IN THIS FILE IS READ
-- -----------------------------------------------------------------------------
-- `ALLOCATION`'s reservation for this number, the ADR-087 reservation beside
-- it, and P3's build plan all attribute `plan_versions_publish_decision_recorded`
-- to `0004_catalog.sql`. IT IS NOT THERE AND NEVER WAS.
--
--   $ grep -n 'plan_versions_publish_decision_recorded' packages/db/migrations/*.sql
--   0045_simulation_runs.sql:236:  ADD CONSTRAINT plan_versions_publish_decision_recorded CHECK (
--
-- The constraint was added by `0045` (session 120, SD-M21-02) along with both
-- columns it reads. `0004` is cited correctly for a different thing: `0004:183`
-- is where the trigger's cost is stated in the corpus's own words, and `0045:48`
-- quotes it from there. Two facts, one file number, and they were fused.
--
-- WHAT THE ERROR WOULD HAVE COST HAD IT NOT BEEN CHECKED. A session writing
-- this migration from the reservation alone would have gone to `0004` for the
-- constraint's text, not found it, and either invented the predicate or
-- superseded the wrong thing. The reservation's own instruction is what caught
-- it: grep the migration directory before citing any constraint by file.
--
-- -----------------------------------------------------------------------------
-- THE DEFECT, MEASURED AT 0046 RATHER THAN QUOTED
-- -----------------------------------------------------------------------------
-- 0001 to 0046 applied forward-only into an empty PostgreSQL 16.13 under
-- ON_ERROR_STOP=1. All three of DELTA_MANIFEST's writable-and-wrong publish
-- states inserted clean, each satisfying
-- `plan_versions_publish_decision_recorded`:
--
--   NOTICE:  WRITABLE AT 0046 (1): publish decided on a FAILED run
--   NOTICE:  WRITABLE AT 0046 (2): publish decided on a run belonging to a
--            DIFFERENT plan
--   NOTICE:  WRITABLE AT 0046 (3): publish decided on a run naming NO plan
--            version
--
-- A `CHECK` cannot read another table, so the FK proves a row was named and
-- proves nothing about what it says (0045:45). That is `OI-29` exactly.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE CLOSES, AND WHAT IT DOES NOT. READ THIS PART HARDEST
-- -----------------------------------------------------------------------------
-- DELTA_MANIFEST names three states. THIS FILE CLOSES TWO OF THEM OUTRIGHT AND
-- NARROWS THE THIRD. It does not close the third, and the reason is a fact
-- about the tree rather than a preference:
--
--   1. A publish decided on a `failed` run          -> CLOSED, check A below.
--   2. A publish decided on a run over a SINCE-EDITED draft, so `rules_digest`
--      no longer matches                            -> NOT CLOSED. See below.
--   3. A publish decided on a run belonging to a DIFFERENT plan
--                                                   -> CLOSED, check B below,
--      and check B is strictly stronger than state 3 asks: it refuses a run
--      anchored to a different VERSION of the SAME plan too.
--
-- STATE 2 IS NOT CLOSED BECAUSE `rules_digest` HAS NO PRODUCER. This was
-- checked against the primary source rather than assumed, which the build plan
-- required in terms:
--
--   $ grep -rn 'rules_digest\|rulesDigest' --include='*.ts' --include='*.mjs' \
--       packages/ apps/ scripts/
--   (no output)
--
-- ADR-081 records that `hash.ts` is "the digest half `OI-29` needs". IT IS NOT.
-- `hash.ts` hashes `rule_states`: `canonicalStateSerialization` takes a
-- `StateHashSubject`, and `HASHED_COLUMNS` is nineteen `rule_states` columns
-- (hash.ts:557). Nothing anywhere computes a digest over `plan_versions.rules`.
-- What ADR-081 landed is a pure SHA-256 and a framing discipline, both reusable
-- and neither pointed at this subject. `simulation_runs.rules_digest` is
-- written by nobody today, so there is nothing for a comparison to agree with.
--
-- AND THE DATABASE COULD HASH IT, WHICH IS WHY THIS IS A RULING AND NOT A
-- LIMITATION. `pgcrypto` is installed (0001:22, for gen_random_uuid) and
-- `digest(rules::text, 'sha256')` runs today. Installing that comparison here
-- would DEFINE the canonical serialization of the rule contract to be
-- PostgreSQL's `jsonb::text`, in passing, in a trigger, on the money path,
-- binding on a TypeScript writer that does not exist yet.
--
-- MEASURED, NOT ASSERTED, on the same database:
--
--   SELECT digest('{"a":1.0}'::jsonb::text,'sha256')
--        = digest('{"a":1}'::jsonb::text,'sha256');    -> f
--
--   '{"a":1.0}'::jsonb::text  -> {"a": 1.0}
--   '{"a":1.00}'::jsonb::text -> {"a": 1.00}
--   '{"a":1e2}'::jsonb::text  -> {"a": 100}
--   '{"a":1,"a":2}'::jsonb::text -> {"a": 2}
--
-- `jsonb::text` sorts keys and normalizes whitespace and IS NOT CANONICAL OVER
-- NUMBERS. A trailing zero on a rule parameter changes the digest. So the
-- comparison would not merely be premature, it would REFUSE LEGITIMATE
-- PUBLISHES: a draft re-saved with `5.0` where it held `5` digests differently
-- while being the same rule contract. That is the failure direction a money
-- path cannot take. `hash.ts` has `money()` and `count()` renderers precisely
-- because a canonical serialization has to make that decision explicitly, and
-- `jsonb::text` makes it accidentally.
--
-- SO STATE 2 STAYS OPEN, NARROWED, AND IS RE-FILED RATHER THAN CLOSED. Check B
-- narrows it: after this migration a run that names a plan version can only
-- decide THAT version's publish, so the "since-edited draft" case survives only
-- for a run whose `plan_version_id` IS NULL. DELTA_MANIFEST carries the
-- successor open item.
--
-- -----------------------------------------------------------------------------
-- WHY THE NULL ANCHOR SURVIVES, AND IT IS THE FENCE THAT DECIDED IT
-- -----------------------------------------------------------------------------
-- `simulation_runs.plan_version_id` is NULLABLE ON PURPOSE (0045:66): "the run
-- is over a draft, and a draft may not yet be a row the run can name". So check
-- B has to permit a NULL anchor, and a run with a NULL anchor can decide any
-- publish of any plan.
--
-- REQUIRING A NON-NULL ANCHOR WOULD CLOSE THAT, AND IT WOULD BREAK A PINNED
-- PROBE. `probe_simulation_decision_record.sql` SUCCESS 4 and case `0028 A`
-- both publish against a run whose `plan_version_id` is NULL, and both are
-- asserted WRITABLE there. Turning an asserted-writable shape into a rejection
-- is a change to what `0045` ruled, not an enforcement of it, and it is not
-- this session's to make: the file is outside this session's fence and the
-- branch must end mergeable.
--
-- THE HOLE IS NAMED IN DELTA_MANIFEST WITH ITS COST rather than left for the
-- next reader to find. That is `0045`'s own habit applied to `0045`.
--
-- -----------------------------------------------------------------------------
-- A FOURTH CHECK WAS AVAILABLE AND IS DELIBERATELY NOT TAKEN
-- -----------------------------------------------------------------------------
-- `completed_at <= published_at` is checkable here and would refuse a publish
-- citing a run that had not finished when the decision was recorded. IT IS NOT
-- ONE OF THE THREE. A money-path migration that installs an unruled constraint
-- because it was cheap is how a schema acquires rules nobody decided, and the
-- next reader cannot tell which of its controls were ruled. It is recorded in
-- ADR-087 section 6 as a candidate for a ruling, not installed.
--
-- -----------------------------------------------------------------------------
-- THE COST OF THE MECHANISM, STATED IN THE CORPUS'S OWN WORDS
-- -----------------------------------------------------------------------------
-- 0004:183: a trigger "is a weaker control: it can be disabled, and it fires
-- per row rather than per constraint". Both limbs are true of what is below and
-- neither is hedged. `ALTER TABLE plan_versions DISABLE TRIGGER ALL` turns this
-- off, and nothing in the schema notices. A `CHECK` cannot be disabled that
-- way, and a `CHECK` cannot do this job at all.
--
-- The alternative is an application publish path. ADR-087 rules on it and the
-- short form is that it loses HERE and wins LATER: it is the only mechanism
-- that could ever carry the digest comparison, because it can call the
-- TypeScript that would produce the digest, and it does not exist today. There
-- is no publish path in `apps/`; the only `plan_versions` references there are
-- read-side types. A control that would run in a code path nobody has written
-- is not a control.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- assert_publish_decision_is_sound
-- -----------------------------------------------------------------------------
-- Every RAISE names the check and the values, on 0038's pattern, because a
-- refusal that says only "not sound" sends the reader to the trigger body to
-- find out which of two things went wrong.
--
-- `check_violation` as the SQLSTATE, matching every other guard in this schema,
-- so a caller handling constraint failures handles this one without learning a
-- new code. The probe asserts the SQLSTATE and the message, since a trigger
-- RAISE carries no CONSTRAINT_NAME to assert.
CREATE FUNCTION assert_publish_decision_is_sound() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run    simulation_runs%ROWTYPE;
  run_pv uuid;
BEGIN
  -- The WHEN clauses on both triggers guarantee this is not null. Selected
  -- rather than joined so a missing row is distinguishable from an unsound one;
  -- the FK makes it unreachable, and an unreachable branch that RAISEs beats
  -- one that silently returns, which is 0038's stated reason for keeping its
  -- own unreachable second check.
  SELECT * INTO run FROM simulation_runs WHERE id = NEW.decided_on_simulation_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'OI-29: plan_version % is decided on simulation run %, which does not exist',
      NEW.id, NEW.decided_on_simulation_run_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- CHECK A. THE RUN FINISHED, AND FINISHED WELL. DELTA_MANIFEST's state 1.
  --
  -- `= 'complete'` rather than `<> 'failed'`, and that is the whole of the
  -- decision. `simulation_runs_status_known` (0045:181) admits four values;
  -- refusing only 'failed' would leave a publish decided on a run that is still
  -- QUEUED, which has produced no numbers at all and is a strictly worse
  -- citation than a failed one. The instinct is to negate the bad state; the
  -- primary source says there are two more.
  --
  -- IT ALSO BUYS A COMPLETION TIME FOR FREE, and that is a property of 0045
  -- rather than of this line: `simulation_runs_terminal_has_completion` is a
  -- BICONDITIONAL, so `status = 'complete'` implies `completed_at IS NOT NULL`.
  -- A publish can therefore always be dated against the run it names.
  IF run.status <> 'complete' THEN
    RAISE EXCEPTION
      'OI-29 check A: plan_version % is decided on simulation run %, whose '
      'status is % and must be complete. A publish decided on a run that did '
      'not finish cites numbers that do not exist',
      NEW.id, run.id, run.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- CHECK B. THE RUN RAN OVER THIS ROW. DELTA_MANIFEST's state 3, and more.
  --
  -- STRONGER THAN THE STATE IT CLOSES, DELIBERATELY. State 3 is "a run
  -- belonging to a different plan entirely". Same plan, different version is
  -- the identical defect wearing a better disguise: the run ranged over some
  -- other version's rules either way. So the test is the row, not the plan.
  --
  -- THE NULL BRANCH IS NOT AN OVERSIGHT. 0045:66 makes the column nullable in
  -- terms, and the header above records why closing it here is out of this
  -- session's hands and what it would cost.
  run_pv := run.plan_version_id;
  IF run_pv IS NOT NULL AND run_pv <> NEW.id THEN
    RAISE EXCEPTION
      'OI-29 check B: plan_version % is decided on simulation run %, which ran '
      'over plan_version %. A run decides the publish of the row it ran over, '
      'and no other',
      NEW.id, run.id, run_pv
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- TWO TRIGGERS, ONE FUNCTION, AND THE SPLIT IS THE SCOPE
-- -----------------------------------------------------------------------------
-- The guard belongs on the PUBLISH DECISION and nowhere else. A `WHEN` clause
-- cannot read `TG_OP`, so expressing "on insert, or on the draft -> published
-- transition" needs two attachments.
--
-- WHAT THE SPLIT BUYS, AND IT IS NOT TIDINESS. Without the
-- `OLD.status IS DISTINCT FROM 'published'` limb this function would re-run on
-- every update to an already-published row, and 0028's guard refuses those. Two
-- BEFORE ROW triggers on one table fire in NAME ORDER, and
-- `plan_versions_publish_decision_is_sound` sorts before
-- `plan_versions_published_immutable` ('_' < 'e'), so this one would answer
-- first and a row that is refused for being IMMUTABLE would report a soundness
-- message instead. The scope keeps 0028's refusals worded by 0028.
--
-- A BEFORE ROW TRIGGER FIRES BEFORE THE TABLE'S CHECK CONSTRAINTS, which is why
-- the `decided_on_simulation_run_id IS NOT NULL` limb is load bearing rather
-- than an optimization. `probe_simulation_decision_record.sql` REJECTION 1
-- (neither field) and REJECTION 2 (both fields) must keep being refused BY NAME
-- by `plan_versions_publish_decision_recorded`; REJECTION 1 has a null run and
-- REJECTION 2's run is complete and null-anchored, so this function is silent
-- on both and 0045's CHECK answers them as it did before. Verified by running
-- that probe at 0047, not by reading these triggers.
CREATE TRIGGER plan_versions_publish_decision_is_sound
  BEFORE INSERT ON plan_versions
  FOR EACH ROW
  WHEN (NEW.status = 'published' AND NEW.decided_on_simulation_run_id IS NOT NULL)
  EXECUTE FUNCTION assert_publish_decision_is_sound();

CREATE TRIGGER plan_versions_publish_decision_is_sound_on_publish
  BEFORE UPDATE ON plan_versions
  FOR EACH ROW
  WHEN (NEW.status = 'published'
        AND OLD.status IS DISTINCT FROM 'published'
        AND NEW.decided_on_simulation_run_id IS NOT NULL)
  EXECUTE FUNCTION assert_publish_decision_is_sound();

COMMENT ON FUNCTION assert_publish_decision_is_sound() IS
  'OI-29. The FK proves a simulation run was named; this proves what it says. '
  'Closes two of DELTA_MANIFEST section 25''s three unsound publish states and '
  'narrows the third. ADR-087.';

COMMIT;
