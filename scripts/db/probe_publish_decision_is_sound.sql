-- =============================================================================
-- scripts/db/probe_publish_decision_is_sound.sql
-- =============================================================================
-- The probe for 0047: `assert_publish_decision_is_sound()`, ADR-087, OI-29.
--
-- SUCCESSES LEAD. 0034's guard rejected EVERYTHING and passed thirty-two
-- rejection assertions doing it, and 0046's replacement turned out to be EXEMPT
-- from the row it was written for. A control watched only refusing is a control
-- nobody has checked, so every legitimate publish shape is written here before
-- the first rejection.
--
-- THE REJECTIONS ASSERT THE CHECK BY MESSAGE, NOT ONLY BY SQLSTATE. A trigger
-- RAISE carries no CONSTRAINT_NAME, so `GET STACKED DIAGNOSTICS CONSTRAINT_NAME`
-- returns empty and the sibling probe's technique is unavailable. Matching on
-- 'OI-29 check A' / 'OI-29 check B' is the equivalent discrimination: without it
-- a row refused by any of the table's checks, or by 0028, would score as this
-- trigger working.
--
-- THE DIRECTION THAT MATTERS MOST IS NEITHER. `plan_versions_publish_decision_recorded`
-- must go on refusing its two states BY NAME after this trigger is installed.
-- A BEFORE ROW trigger fires before the table's CHECK constraints, so a guard
-- scoped one clause too wide would answer those rows first and every caller
-- that handles publish failures by constraint name would silently stop
-- resolving. Cases `0045 A` and `0045 B` watch that, and they are the reason
-- this file is longer than its two checks.
--
-- Run against a database with the full migration set applied:
--   psql -v ON_ERROR_STOP=1 -q -f scripts/db/probe_publish_decision_is_sound.sql
--
-- THE COUNTERFACTUAL. Against a database built from 0001 to 0046 only, this
-- probe MUST fail on REJECTION 1, because the trigger does not exist there and
-- a publish decided on a failed run inserts clean. Every SUCCESS above it
-- passes at 0046, which is the point: the successes are not what changed. The
-- transcript of it failing is in DELTA_MANIFEST section 25.
--
-- Everything happens inside one transaction that is ROLLED BACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE probe_result(step text, verdict text) ON COMMIT DROP;

DO $probe$
DECLARE
  plan_a  uuid;
  plan_b  uuid;
  pv1     uuid;   -- plan A v1, the draft that gets published in place
  pv2     uuid;   -- plan A v2, published directly
  pv_b    uuid;   -- plan B v1
  pv_a9   uuid;   -- plan A v9, a second draft, for the same-plan-wrong-version case
  r_ok1   uuid;   -- complete, anchored to pv1
  r_ok2   uuid;   -- complete, anchored to pv2
  r_loose uuid;   -- complete, anchored to NOTHING
  r_fail  uuid;   -- failed,   anchored to nothing
  r_queue uuid;   -- queued
  r_run   uuid;   -- running
  r_plan_b uuid;  -- complete, anchored to plan B's version
  r_a9    uuid;   -- complete, anchored to plan A v9
  code    text;
  msg     text;
  n       integer;

  d1 bytea := decode(repeat('ab', 32), 'hex');
  d2 bytea := decode(repeat('cd', 32), 'hex');
  dc bytea := decode(repeat('11', 32), 'hex');
BEGIN
  INSERT INTO plans (code, name) VALUES ('probe_oi29_a', 'Probe OI-29 A') RETURNING id INTO plan_a;
  INSERT INTO plans (code, name) VALUES ('probe_oi29_b', 'Probe OI-29 B') RETURNING id INTO plan_b;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, created_by)
  VALUES (plan_a, 1, 'draft', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-oi29-a1', false, 'probe')
  RETURNING id INTO pv1;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, created_by)
  VALUES (plan_a, 9, 'draft', '{"phase_funded":{"max_payouts":4}}'::jsonb, '{}'::jsonb,
          'probe-oi29-a9', false, 'probe')
  RETURNING id INTO pv_a9;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, created_by)
  VALUES (plan_b, 1, 'draft', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-oi29-b1', false, 'probe')
  RETURNING id INTO pv_b;

  -- The runs. Every status the vocabulary admits, plus every anchor shape.
  INSERT INTO simulation_runs (plan_version_id, rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by, completed_at)
  VALUES (pv1, d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-ok1',
          10000, 'complete', 'probe', now())
  RETURNING id INTO r_ok1;

  INSERT INTO simulation_runs (rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by, completed_at)
  VALUES (d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-loose',
          10000, 'complete', 'probe', now())
  RETURNING id INTO r_loose;

  INSERT INTO simulation_runs (rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by, completed_at)
  VALUES (d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-fail',
          10000, 'failed', 'probe', now())
  RETURNING id INTO r_fail;

  INSERT INTO simulation_runs (rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by)
  VALUES (d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-queued',
          10000, 'queued', 'probe')
  RETURNING id INTO r_queue;

  INSERT INTO simulation_runs (rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by)
  VALUES (d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-running',
          10000, 'running', 'probe')
  RETURNING id INTO r_run;

  INSERT INTO simulation_runs (plan_version_id, rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by, completed_at)
  VALUES (pv_b, d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-planb',
          10000, 'complete', 'probe', now())
  RETURNING id INTO r_plan_b;

  INSERT INTO simulation_runs (plan_version_id, rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by, completed_at)
  VALUES (pv_a9, d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-a9',
          10000, 'complete', 'probe', now())
  RETURNING id INTO r_a9;

  -- ===========================================================================
  -- SUCCESSES. Every one of these runs before the first rejection, and every
  -- one of them passes at 0046 as well: they are the shapes that did NOT change.
  -- ===========================================================================

  -- SUCCESS 1. THE SOUND PUBLISH, INSERTED. A complete run anchored to the row
  -- being published. This is the shape the whole control exists to permit, and
  -- a guard that refused it would be a module nobody can use.
  INSERT INTO simulation_runs (plan_version_id, rules_digest, sizes_digest, calibration_id,
    calibration_digest, calibration_observed_at, harness_version, engine_version, seed,
    sample_size, status, requested_by, completed_at)
  VALUES (NULL, d1, d2, 'probe-cal', dc, DATE '2026-08-01', '1.0.0', '1.0.0', 'seed-ok2',
          10000, 'complete', 'probe', now())
  RETURNING id INTO r_ok2;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             decided_on_simulation_run_id)
  VALUES (plan_a, 2, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-oi29-a2', true, now(), 'probe', r_ok2)
  RETURNING id INTO pv2;

  UPDATE simulation_runs SET plan_version_id = pv2 WHERE id = r_ok2;
  INSERT INTO probe_result VALUES ('SUCCESS 1',
    'a publish naming a COMPLETE run writes, and the run is re-anchored to it afterwards');

  -- SUCCESS 2. THE SOUND PUBLISH, VIA THE draft -> published UPDATE. This is
  -- the transition M21 section 2 names and 0028 permits, and it is the ONLY
  -- path the second trigger guards. Without this case the UPDATE attachment
  -- could be missing entirely and every other assertion here would still pass.
  UPDATE plan_versions
     SET status = 'published', published_at = now(),
         decided_on_simulation_run_id = r_ok1
   WHERE id = pv1;
  INSERT INTO probe_result VALUES ('SUCCESS 2',
    'the draft -> published UPDATE onto a COMPLETE run anchored to THIS row succeeds');

  -- SUCCESS 3. THE NULL ANCHOR IS PERMITTED, AND THAT IS A HOLE RATHER THAN A
  -- FEATURE. 0045:66 makes `plan_version_id` nullable on purpose, so check B
  -- cannot reach a run that names no version. Asserted here so the hole is
  -- VISIBLE in the probe output rather than inferable from the trigger body:
  -- the day somebody closes it, this line is what tells them what they broke.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             decided_on_simulation_run_id)
  VALUES (plan_a, 3, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-oi29-a3', false, now(), 'probe', r_loose);
  INSERT INTO probe_result VALUES ('SUCCESS 3',
    'a COMPLETE run anchored to NOTHING still decides any publish: OI-29b, the surviving hole');

  -- SUCCESS 4. THE RECORDED EXCEPTION STAYS CHEAP. A waiver publish names no
  -- run, so both triggers' WHEN clauses are false and 0045's ruling is
  -- untouched. A guard that made the waiver path harder would have moved a
  -- ruling it was not asked to move.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             simulation_waiver_reason)
  VALUES (plan_a, 4, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-oi29-a4', false, now(), 'probe', 'copy-only change, no rule parameter moved');
  INSERT INTO probe_result VALUES ('SUCCESS 4',
    'a waiver publish is untouched: the trigger is scoped to publishes that NAME a run');

  -- SUCCESS 5. AUTHORING IS UNTOUCHED, INCLUDING AGAINST A FAILED RUN. A DRAFT
  -- may name any run at all, because nothing has been sold yet. The guard is
  -- scoped to the PUBLISH DECISION and not to the column, and this is the
  -- assertion that says so.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, created_by,
                             decided_on_simulation_run_id)
  VALUES (plan_a, 5, 'draft', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-oi29-a5', false, 'probe', r_fail);
  INSERT INTO probe_result VALUES ('SUCCESS 5',
    'a DRAFT may name a FAILED run: the guard is on the publish decision, not on the column');

  -- ===========================================================================
  -- REJECTIONS. Each by SQLSTATE and by the CHECK NAMED IN THE MESSAGE.
  -- Every one of these INSERTS CLEAN at 0046.
  -- ===========================================================================

  -- REJECTION 1. DELTA_MANIFEST's STATE 1, and the counterfactual's anchor.
  -- A publish decided on a FAILED run.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id)
    VALUES (plan_a, 10, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a10', false, now(), 'probe', r_fail);
    RAISE EXCEPTION 'a publish decided on a FAILED run was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check A' in msg) = 0 THEN
      RAISE EXCEPTION 'refused, but not by check A: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 1',
      'publish on a FAILED run refused by check A (SQLSTATE ' || code || ')');
  END;

  -- REJECTION 2. `= complete` RATHER THAN `<> failed`, WATCHED. A QUEUED run
  -- has produced no numbers at all. A guard written to negate the state that
  -- motivated it would accept this row, and this is the only assertion that
  -- would notice.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id)
    VALUES (plan_a, 11, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a11', false, now(), 'probe', r_queue);
    RAISE EXCEPTION 'a publish decided on a QUEUED run was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check A' in msg) = 0 THEN
      RAISE EXCEPTION 'refused, but not by check A: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 2',
      'publish on a QUEUED run refused by check A: `<> failed` would have accepted it');
  END;

  -- REJECTION 3. The third status the vocabulary admits.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id)
    VALUES (plan_a, 12, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a12', false, now(), 'probe', r_run);
    RAISE EXCEPTION 'a publish decided on a RUNNING run was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check A' in msg) = 0 THEN
      RAISE EXCEPTION 'refused, but not by check A: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 3',
      'publish on a RUNNING run refused by check A');
  END;

  -- REJECTION 4. DELTA_MANIFEST's STATE 3. A run belonging to a DIFFERENT PLAN.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id)
    VALUES (plan_a, 13, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a13', false, now(), 'probe', r_plan_b);
    RAISE EXCEPTION 'a publish decided on ANOTHER PLAN''s run was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check B' in msg) = 0 THEN
      RAISE EXCEPTION 'refused, but not by check B: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 4',
      'publish on a DIFFERENT PLAN''s run refused by check B (SQLSTATE ' || code || ')');
  END;

  -- REJECTION 5. THE CASE DELTA_MANIFEST DOES NOT NAME, AND IT IS THE SAME
  -- DEFECT. Same plan, different VERSION. A guard written to the manifest's
  -- wording -- "a different plan entirely" -- would compare `plan_id` and
  -- accept this row, and the run ranged over another version's rules either way.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id)
    VALUES (plan_a, 14, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a14', false, now(), 'probe', r_a9);
    RAISE EXCEPTION 'a publish decided on ANOTHER VERSION of the same plan was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check B' in msg) = 0 THEN
      RAISE EXCEPTION 'refused, but not by check B: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 5',
      'publish on ANOTHER VERSION of the same plan refused by check B: the test is the ROW');
  END;

  -- REJECTION 6. THE UPDATE PATH REFUSES TOO. Both attachments have to be
  -- wired: a file that installed only the INSERT trigger would pass every
  -- rejection above while leaving the transition M21 actually specifies wide
  -- open, and SUCCESS 2 alone cannot tell the difference.
  BEGIN
    UPDATE plan_versions
       SET status = 'published', published_at = now(),
           decided_on_simulation_run_id = r_fail
     WHERE id = pv_a9;
    RAISE EXCEPTION 'the draft -> published UPDATE onto a FAILED run was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check A' in msg) = 0 THEN
      RAISE EXCEPTION 'the UPDATE was refused, but not by check A: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 6',
      'the draft -> published UPDATE onto a FAILED run refused by check A: both triggers are wired');
  END;

  -- REJECTION 7. The UPDATE path against check B.
  BEGIN
    UPDATE plan_versions
       SET status = 'published', published_at = now(),
           decided_on_simulation_run_id = r_plan_b
     WHERE id = pv_a9;
    RAISE EXCEPTION 'the draft -> published UPDATE onto ANOTHER PLAN''s run was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
    IF position('OI-29 check B' in msg) = 0 THEN
      RAISE EXCEPTION 'the UPDATE was refused, but not by check B: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 7',
      'the draft -> published UPDATE onto ANOTHER PLAN''s run refused by check B');
  END;

  -- ===========================================================================
  -- THE 0045 INTERACTIONS. THE DIRECTION A WIDER TRIGGER WOULD HAVE BROKEN.
  -- A BEFORE ROW trigger fires before the table's CHECK constraints, so these
  -- two rows reach this trigger first. Both must pass THROUGH it and be refused
  -- by name, exactly as they were at 0046.
  -- ===========================================================================

  -- 0045 A. Publish with NEITHER. The run is NULL, so the WHEN clause is false.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by)
    VALUES (plan_a, 20, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a20', false, now(), 'probe');
    RAISE EXCEPTION 'a publish with NEITHER was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('plan_versions_publish_decision_recorded' in msg) = 0 THEN
      RAISE EXCEPTION '0047 intercepted 0045''s NEITHER case: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('0045 A',
      'publish with NEITHER still refused by plan_versions_publish_decision_recorded, by name');
  END;

  -- 0045 B. Publish with BOTH. The run here IS named and IS sound, so this
  -- trigger runs, passes, and lets 0045's CHECK answer. THE ONE THAT WOULD HAVE
  -- BROKEN had check B required a non-null anchor: `r_loose` names no version.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id, simulation_waiver_reason)
    VALUES (plan_a, 21, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-oi29-a21', false, now(), 'probe', r_loose, 'and also a waiver');
    RAISE EXCEPTION 'a publish with BOTH was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('plan_versions_publish_decision_recorded' in msg) = 0 THEN
      RAISE EXCEPTION '0047 intercepted 0045''s BOTH case: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('0045 B',
      'publish with BOTH still refused by plan_versions_publish_decision_recorded, by name');
  END;

  -- 0028. A sound decision is still IMMUTABLE once published, with no edit to
  -- 0028, because its pinned set is derived rather than enumerated. Asserted
  -- again here because 0047 adds a BEFORE UPDATE trigger to this table and
  -- ordering between two BEFORE triggers is by NAME: if this one had been
  -- scoped to fire on every published-row update it would answer first and the
  -- immutability refusal would arrive worded as a soundness failure.
  BEGIN
    UPDATE plan_versions SET decided_on_simulation_run_id = r_loose WHERE id = pv2;
    RAISE EXCEPTION 'a published row let its decision be moved';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('is published and immutable' in msg) = 0 THEN
      RAISE EXCEPTION '0047 answered before 0028 on a published row: %', msg;
    END IF;
    INSERT INTO probe_result VALUES ('0028',
      'a published row is refused by 0028''s immutability guard, in 0028''s own words');
  END;

  -- CATALOGUE. Both attachments exist, on the table and events named. A trigger
  -- the migration created and a later file dropped would leave every assertion
  -- above passing only until somebody re-ran them.
  SELECT count(*) INTO n
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'plan_versions'
     AND NOT t.tgisinternal
     AND t.tgname LIKE 'plan_versions_publish_decision_is_sound%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected 2 publish-decision triggers on plan_versions, found %', n;
  END IF;
  INSERT INTO probe_result VALUES ('CATALOGUE',
    'both publish-decision triggers are attached to plan_versions (INSERT and UPDATE)');

  RAISE NOTICE 'probe complete';
END
$probe$;

SELECT step, verdict FROM probe_result ORDER BY step;

ROLLBACK;
