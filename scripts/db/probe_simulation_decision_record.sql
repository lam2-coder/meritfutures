-- =============================================================================
-- scripts/db/probe_simulation_decision_record.sql
-- =============================================================================
-- The probe for 0045: `simulation_runs` (SD-M21-01) and the publish-decision
-- record on `plan_versions` (SD-M21-02).
--
-- SUCCESSES LEAD, and that ordering is ADR-035's lesson rather than a style.
-- 0034's guard rejected EVERYTHING and passed thirty-two rejection assertions
-- while doing it. A constraint tested only in the direction it is supposed to
-- refuse is a constraint nobody has checked, so every writable shape is
-- asserted here BEFORE the first rejection.
--
-- THE SEAM THAT MATTERS IS ASSERTION 1. `calibrationDigest()` returns HEX
-- (provenance.ts, `.digest('hex')`) and `calibration_digest` is `bytea`. That
-- is the one place this migration meets running code, and a header comment
-- cannot reach it. Assertion 1 writes a row through the real hex-to-bytea
-- decode using an actual producer output, before anything else runs.
--
-- Every rejection is checked BY SQLSTATE AND BY CONSTRAINT NAME, never by "an
-- exception happened": a probe that catches any error scores a typo as the
-- control working.
--
-- Run against a database with the full migration set applied:
--   psql -v ON_ERROR_STOP=1 -q -f scripts/db/probe_simulation_decision_record.sql
--
-- THE COUNTERFACTUAL. Against a database built from 0001 to 0044 only, this
-- probe MUST fail on REJECTION 1, because the constraint does not exist there.
-- A probe that passes with and without the thing it probes is asserting
-- nothing. The transcript of it failing is in DELTA_MANIFEST section 23.
--
-- Everything happens inside one transaction that is ROLLED BACK.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE probe_result(step text, verdict text) ON COMMIT DROP;

DO $probe$
DECLARE
  plan   uuid;
  pv     uuid;
  run    uuid;
  sweep  uuid := gen_random_uuid();
  code   text;
  cname  text;
  n      integer;

  -- AN ACTUAL `calibrationDigest()` OUTPUT, not a hand-made constant. Produced
  -- by calling the exported function on a CalibrationSource of
  --   id 'probe-calibration', observedAt '2026-08-01',
  --   note 'probe fixture, session 120', bands []
  -- which is why it is 64 characters of hex and not 32 bytes of anything.
  cal_hex text := 'f1091e96a02a8b1c515d4012b7b0757d56809a3798701516776fe3e43b0c23f7';

  d1 bytea := decode(repeat('ab', 32), 'hex');
  d2 bytea := decode(repeat('cd', 32), 'hex');
BEGIN
  INSERT INTO plans (code, name) VALUES ('probe_m21_plan', 'Probe M21') RETURNING id INTO plan;

  -- ===========================================================================
  -- SUCCESSES. Every one of these runs before the first rejection.
  -- ===========================================================================

  -- SUCCESS 1. THE HEX-TO-BYTEA SEAM, WATCHED WORKING.
  -- decode(hex, 'hex') is what the write path does with calibrationDigest()'s
  -- return value. If the producer ever returned bytes, or the column ever
  -- became text, this assertion is what would notice.
  INSERT INTO simulation_runs (
    rules_digest, sizes_digest, calibration_id, calibration_digest,
    calibration_observed_on, harness_version, engine_version, seed, sample_size,
    status, requested_by, completed_at)
  VALUES (d1, d2, 'probe-calibration', decode(cal_hex, 'hex'), DATE '2026-08-01',
          '1.0.0', '1.0.0', 'seed-alpha', 10000, 'complete', 'probe', now())
  RETURNING id INTO run;

  SELECT length(calibration_digest) INTO n FROM simulation_runs WHERE id = run;
  IF n <> 32 THEN
    RAISE EXCEPTION 'hex-to-bytea decode produced % bytes, not 32', n;
  END IF;
  INSERT INTO probe_result VALUES ('SUCCESS 1',
    'calibrationDigest() hex (64 chars) decoded to exactly 32 bytea bytes and satisfied the CHECK');

  -- SUCCESS 2. A queued run carries no completion time, and sample_size 0 is
  -- STORABLE, which is the `>= 0` decision watched rather than argued.
  INSERT INTO simulation_runs (
    rules_digest, sizes_digest, calibration_id, calibration_digest,
    calibration_observed_on, harness_version, engine_version, seed, sample_size,
    status, requested_by)
  VALUES (d1, d2, 'probe-calibration', decode(cal_hex, 'hex'), DATE '2026-08-01',
          '1.0.0', '1.0.0', 'seed-beta', 0, 'queued', 'probe');
  INSERT INTO probe_result VALUES ('SUCCESS 2',
    'a queued run writes with completed_at NULL, and sample_size 0 IS storable');

  -- SUCCESS 3. A DRAFT with neither field. The constraint must not have widened
  -- into forbidding ordinary authoring, which would make the module unusable
  -- and would still pass every rejection below.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, created_by)
  VALUES (plan, 1, 'draft', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-m21-draft', false, 'probe');
  INSERT INTO probe_result VALUES ('SUCCESS 3',
    'a DRAFT with neither a run nor a waiver still writes: authoring is untouched');

  -- SUCCESS 4. A publish that names its run.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             decided_on_simulation_run_id)
  VALUES (plan, 2, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-m21-v2', true, now(), 'probe', run)
  RETURNING id INTO pv;
  INSERT INTO probe_result VALUES ('SUCCESS 4',
    'a published version resolving to its simulation run writes');

  -- SUCCESS 5. A publish that carries a written waiver instead. THE RECORDED
  -- EXCEPTION IS CHEAP, which is the half of the ruling that makes the other
  -- half enforceable.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             simulation_waiver_reason)
  VALUES (plan, 3, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb, '{}'::jsonb,
          'probe-m21-v3', true, now(), 'probe',
          'copy-only change, no rule parameter moved');
  INSERT INTO probe_result VALUES ('SUCCESS 5',
    'a published version carrying a written waiver writes: the exception is CHEAP');

  -- SUCCESS 6. A whole sweep arm.
  INSERT INTO simulation_runs (
    rules_digest, sizes_digest, calibration_id, calibration_digest,
    calibration_observed_on, harness_version, engine_version, seed, sample_size,
    status, requested_by, sweep_id, swept_parameter, swept_value_bp, completed_at)
  VALUES (d1, d2, 'probe-calibration', decode(cal_hex, 'hex'), DATE '2026-08-01',
          '1.0.0', '1.0.0', 'seed-arm', 5000, 'complete', 'probe',
          sweep, 'phase_funded.max_payouts', 5, now());
  INSERT INTO probe_result VALUES ('SUCCESS 6',
    'a sweep arm with all three columns writes, alongside runs carrying none');

  -- ===========================================================================
  -- REJECTIONS. Each by SQLSTATE and by CONSTRAINT NAME.
  -- ===========================================================================

  -- REJECTION 1. A publish with NEITHER. This is the assertion the
  -- counterfactual database must fail, because there the constraint is absent.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by)
    VALUES (plan, 10, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-m21-neither', true, now(), 'probe');
    RAISE EXCEPTION 'a publish with NEITHER a run nor a waiver was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    IF cname <> 'plan_versions_publish_decision_recorded' THEN
      RAISE EXCEPTION 'rejected by the wrong constraint: %', cname;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 1',
      'publish with NEITHER refused by ' || cname || ' (SQLSTATE ' || code || ')');
  END;

  -- REJECTION 2. A publish with BOTH. An exception that also names a run is not
  -- an exception, and "exactly one" has to mean exactly one in both directions.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               decided_on_simulation_run_id, simulation_waiver_reason)
    VALUES (plan, 11, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-m21-both', true, now(), 'probe', run, 'and also a waiver');
    RAISE EXCEPTION 'a publish with BOTH was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    IF cname <> 'plan_versions_publish_decision_recorded' THEN
      RAISE EXCEPTION 'rejected by the wrong constraint: %', cname;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 2',
      'publish with BOTH refused by ' || cname || ' (SQLSTATE ' || code || ')');
  END;

  -- REJECTION 3. A BLANK waiver. num_nonnulls counts '' as present, so without
  -- the second named constraint this row would satisfy "exactly one" while
  -- recording nothing. The rejection must name the SECOND constraint.
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                               public_slug, public_visible, published_at, created_by,
                               simulation_waiver_reason)
    VALUES (plan, 12, 'published', '{}'::jsonb, '{}'::jsonb,
            'probe-m21-blank', true, now(), 'probe', '   ');
    RAISE EXCEPTION 'a BLANK waiver was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    IF cname <> 'plan_versions_simulation_waiver_not_blank' THEN
      RAISE EXCEPTION 'blank waiver rejected by % rather than the blank floor', cname;
    END IF;
    INSERT INTO probe_result VALUES ('REJECTION 3',
      'BLANK waiver refused by ' || cname || ', which the exactly-one CHECK cannot do');
  END;

  -- REJECTION 4. A RUNNING row carrying a completion time.
  BEGIN
    INSERT INTO simulation_runs (
      rules_digest, sizes_digest, calibration_id, calibration_digest,
      calibration_observed_on, harness_version, engine_version, seed, sample_size,
      status, requested_by, completed_at)
    VALUES (d1, d2, 'c', decode(cal_hex, 'hex'), DATE '2026-08-01',
            '1.0.0', '1.0.0', 's', 1, 'running', 'probe', now());
    RAISE EXCEPTION 'a running row with completed_at was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    INSERT INTO probe_result VALUES ('REJECTION 4',
      'running + completed_at refused by ' || cname);
  END;

  -- REJECTION 5. A COMPLETE row with no completion time. The other half of the
  -- biconditional, which an implication would have let through.
  BEGIN
    INSERT INTO simulation_runs (
      rules_digest, sizes_digest, calibration_id, calibration_digest,
      calibration_observed_on, harness_version, engine_version, seed, sample_size,
      status, requested_by)
    VALUES (d1, d2, 'c', decode(cal_hex, 'hex'), DATE '2026-08-01',
            '1.0.0', '1.0.0', 's', 1, 'complete', 'probe');
    RAISE EXCEPTION 'a complete row without completed_at was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    INSERT INTO probe_result VALUES ('REJECTION 5',
      'complete without completed_at refused by ' || cname);
  END;

  -- REJECTION 6. A PARTIAL sweep arm: two of three.
  BEGIN
    INSERT INTO simulation_runs (
      rules_digest, sizes_digest, calibration_id, calibration_digest,
      calibration_observed_on, harness_version, engine_version, seed, sample_size,
      status, requested_by, swept_parameter, swept_value_bp)
    VALUES (d1, d2, 'c', decode(cal_hex, 'hex'), DATE '2026-08-01',
            '1.0.0', '1.0.0', 's', 1, 'queued', 'probe', 'some.param', 5);
    RAISE EXCEPTION 'a partial sweep arm was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    INSERT INTO probe_result VALUES ('REJECTION 6',
      'a sweep arm naming a parameter but no sweep refused by ' || cname);
  END;

  -- REJECTION 7. A digest of the wrong length. A hash is a SHA-256 digest or it
  -- is not a hash, and a hex string stored raw would be 64 bytes rather than 32.
  BEGIN
    INSERT INTO simulation_runs (
      rules_digest, sizes_digest, calibration_id, calibration_digest,
      calibration_observed_on, harness_version, engine_version, seed, sample_size,
      status, requested_by)
    VALUES (d1, d2, 'c', cal_hex::bytea, DATE '2026-08-01',
            '1.0.0', '1.0.0', 's', 1, 'queued', 'probe');
    RAISE EXCEPTION 'a 64-byte calibration digest was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    INSERT INTO probe_result VALUES ('REJECTION 7',
      'the hex string stored UNDECODED (64 bytes) refused by ' || cname);
  END;

  -- REJECTION 8. A negative sample size, which is the bound provenanceFor
  -- actually enforces.
  BEGIN
    INSERT INTO simulation_runs (
      rules_digest, sizes_digest, calibration_id, calibration_digest,
      calibration_observed_on, harness_version, engine_version, seed, sample_size,
      status, requested_by)
    VALUES (d1, d2, 'c', decode(cal_hex, 'hex'), DATE '2026-08-01',
            '1.0.0', '1.0.0', 's', -1, 'queued', 'probe');
    RAISE EXCEPTION 'a negative sample size was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, cname = CONSTRAINT_NAME;
    INSERT INTO probe_result VALUES ('REJECTION 8',
      'sample_size -1 refused by ' || cname || ', matching provenanceFor exactly');
  END;

  -- ===========================================================================
  -- THE 0028 INTERACTIONS. Claimed in the migration header, verified here.
  -- ===========================================================================

  -- 0028 A. THE PUBLISH TRANSITION IS NOT BLOCKED. 0028 fires on
  -- OLD.status = 'published'; a publish has OLD.status = 'draft', so the one
  -- UPDATE that writes these columns must succeed.
  UPDATE plan_versions
     SET status = 'published', published_at = now(),
         decided_on_simulation_run_id = run
   WHERE plan_id = plan AND version = 1;
  INSERT INTO probe_result VALUES ('0028 A',
    'the draft -> published UPDATE writing the decision SUCCEEDS: 0028 does not block it');

  -- 0028 B. THE DECISION IS IMMUTABLE ONCE PUBLISHED, with no edit to 0028,
  -- because its pinned set is DERIVED rather than enumerated.
  BEGIN
    UPDATE plan_versions SET decided_on_simulation_run_id = NULL WHERE id = pv;
    RAISE EXCEPTION 'a published row let its decision be cleared';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('0028 B',
      'a published row REFUSES to have its decision moved, via 0028''s derived pinned set');
  END;

  RAISE NOTICE 'probe complete';
END
$probe$;

SELECT step, verdict FROM probe_result ORDER BY step;

ROLLBACK;
