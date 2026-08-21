-- =============================================================================
-- scripts/db/probe_plan_version_immutability.sql
-- =============================================================================
-- ADR-035's own words: "The fix ships with the test that would have caught it."
-- This is that test, in the same shape as probe_ledger_constraints.sql.
--
-- WHAT IT PROBES, and why each direction is here:
--
--   THE PERMITTED TRANSITION SUCCEEDS. This is the probe that did not exist.
--   Every existing probe attempted a mutation and asserted a rejection, so
--   every one of them passed against a guard that rejected EVERYTHING. A guard
--   tested only in the direction it is supposed to refuse is a guard nobody has
--   checked. That is the whole lesson of ADR-035 and it is why this file leads
--   with the success case.
--
--   THE FORBIDDEN ONES FAIL, and fail FOR THE RIGHT REASON. Each rejection is
--   checked by SQLSTATE and by message text, never by "an exception happened":
--   before 0028 the retirement raised `undefined_column`, which a handler
--   catching "any error" would have scored as the constraint working.
--
-- Run against a database with the full migration set applied:
--   psql -v ON_ERROR_STOP=1 -q -f scripts/db/probe_plan_version_immutability.sql
--
-- Everything happens inside one transaction that is ROLLED BACK. The probe
-- leaves no rows behind.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE probe_result(step text, verdict text) ON COMMIT DROP;

DO $probe$
DECLARE
  plan uuid;
  pv   uuid;
  msg  text;
  code text;
BEGIN
  INSERT INTO plans (code, name) VALUES ('probe_plan', 'Probe') RETURNING id INTO plan;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             simulation_waiver_reason)
  VALUES (plan, 1, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb,
          '{"floor":"never resets"}'::jsonb, 'probe-slug-v1', true, now(), 'probe',
          'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)')
  RETURNING id INTO pv;

  -- ---------------------------------------------------------------------------
  -- 1. THE PERMITTED TRANSITION. published -> retired, retired_at set,
  --    public_visible dropped to false (plan_versions_visible_implies_published
  --    forbids a visible non-published row).
  --
  --    BEFORE 0028 THIS RAISED: record "new" has no field "config".
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions
       SET status = 'retired', retired_at = now(), public_visible = false
     WHERE id = pv;
    INSERT INTO probe_result VALUES ('permitted retirement succeeds', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES
      ('permitted retirement succeeds', 'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- 2. RETIREMENT IS TERMINAL. STATE_MACHINES section 9: `retired --> [*]`.
  --    Un-retiring a version and rewriting its rules is the two-step retroactive
  --    change B4 #12 exists to make impossible, and 0027's guard permitted it
  --    because it only fired when OLD.status = 'published'.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions SET rules = '{"phase_funded":{"max_payouts":99}}'::jsonb
     WHERE id = pv;
    INSERT INTO probe_result VALUES ('retired row is frozen', 'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('retired row is frozen',
      CASE WHEN msg LIKE '%retirement is terminal%' THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- A second published row for the rejection probes, since the first is retired.
  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, public_visible, published_at, created_by,
                             simulation_waiver_reason)
  VALUES (plan, 2, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb,
          '{"floor":"never resets"}'::jsonb, 'probe-slug-v2', false, now(), 'probe',
          'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)')
  RETURNING id INTO pv;

  -- ---------------------------------------------------------------------------
  -- 3. THE RULE CONTRACT CANNOT BE REWRITTEN IN PLACE. The promise itself.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions SET rules = '{"phase_funded":{"max_payouts":1}}'::jsonb
     WHERE id = pv;
    INSERT INTO probe_result VALUES ('published rules are immutable', 'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('published rules are immutable',
      CASE WHEN msg LIKE '%Columns changed: rules%' THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- 4. A RETIREMENT CANNOT SMUGGLE A COPY REWRITE. This is ADR-035 item 2: the
  --    0027 guard pinned three columns of twelve, so a retirement was free to
  --    rewrite the published rule TEXT or the permanent public URL. Fixing only
  --    the column name would have left this open.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions
       SET status = 'retired', retired_at = now(),
           copy_blocks = '{"floor":"resets every payout"}'::jsonb
     WHERE id = pv;
    INSERT INTO probe_result VALUES ('retirement cannot rewrite copy', 'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('retirement cannot rewrite copy',
      CASE WHEN msg LIKE '%Columns changed: copy_blocks%' THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  BEGIN
    UPDATE plan_versions
       SET status = 'retired', retired_at = now(), public_slug = 'probe-slug-moved'
     WHERE id = pv;
    INSERT INTO probe_result VALUES ('retirement cannot move the public slug', 'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('retirement cannot move the public slug',
      CASE WHEN msg LIKE '%Columns changed: public_slug%' THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- 5. published -> draft is not a transition. STATE_MACHINES section 9.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions SET status = 'draft' WHERE id = pv;
    INSERT INTO probe_result VALUES ('published cannot revert to draft', 'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('published cannot revert to draft',
      CASE WHEN msg LIKE '%only permitted transition%' THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- 6. A DRAFT ROW IS STILL FREELY EDITABLE. The guard must not have widened
  --    into forbidding ordinary authoring, which is how an over-corrected fix
  --    breaks a workflow nobody tested.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO plan_versions (plan_id, version, status, rules, public_slug, created_by)
    VALUES (plan, 3, 'draft', '{}'::jsonb, 'probe-slug-v3', 'probe') RETURNING id INTO pv;
    UPDATE plan_versions SET rules = '{"edited":true}'::jsonb WHERE id = pv;
    INSERT INTO probe_result VALUES ('draft rows stay editable', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('draft rows stay editable', 'FAIL: ' || code || ' ' || msg);
  END;
END;
$probe$;

-- -----------------------------------------------------------------------------
-- 7. THE SEVEN NULL-PASSES CHECKS. Each is probed with the EMPTY ARRAY, which
--    is the one value each existed to reject and the one value each admitted.
--    Before 0028 every INSERT below COMMITTED.
-- -----------------------------------------------------------------------------
DO $arrays$
DECLARE
  probe record;
  msg  text;
BEGIN
  FOR probe IN
    SELECT * FROM (VALUES
      ('correlation_groups_is_a_group',
       $q$INSERT INTO correlation_groups (trading_day, member_account_ids, method, statistic, threshold, evidence)
          VALUES (current_date, '{}'::uuid[], 'probe', 0.9, 0.3, '{}'::jsonb)$q$),
      ('wallet_dormancy_review_was_noticed',
       $q$INSERT INTO wallet_dormancy (identity_id, last_activity_at, state, notified_at)
          VALUES (gen_random_uuid(), now(), 'escheat_review', '{}'::timestamptz[])$q$),
      ('integration_contracts_enabled_has_fields',
       $q$INSERT INTO integration_contracts (integration, event_name, version, field_allowlist, enabled, approved_by, approved_at)
          VALUES ('probe', 'probe.event', 1, '{}'::text[], true, 'probe', now())$q$),
      ('notification_kinds_has_channels',
       $q$INSERT INTO notification_kinds (kind, class, title, template_code, default_channels)
          VALUES ('probe', 'money', 'Probe', 'probe_tpl', '{}'::text[])$q$),
      ('page_revalidations_has_paths',
       $q$INSERT INTO page_revalidations (trigger, paths) VALUES ('probe', '{}'::text[])$q$),
      ('round_trips_has_entry',
       $q$INSERT INTO round_trips (account_id, instrument, opened_at, trading_day, direction, max_size,
                                   entry_fills, gross_result_cents, fee_cents, net_result_cents, derivation_version)
          VALUES (gen_random_uuid(), 'ES', now(), current_date, 'long', 1, '{}'::bigint[], 0, 0, 0, 1)$q$),
      ('round_trips_closed_has_exit',
       $q$INSERT INTO round_trips (account_id, instrument, opened_at, closed_at, trading_day, direction, max_size,
                                   entry_fills, exit_fills, gross_result_cents, fee_cents, net_result_cents, derivation_version)
          VALUES (gen_random_uuid(), 'ES', now(), now(), current_date, 'long', 1, '{1}'::bigint[], '{}'::bigint[], 0, 0, 0, 1)$q$)
    ) AS t(name, stmt)
  LOOP
    BEGIN
      EXECUTE probe.stmt;
      INSERT INTO probe_result VALUES (probe.name || ': empty array rejected',
        'FAIL: the empty array was ACCEPTED (this is the NULL-passes defect)');
    EXCEPTION
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
        INSERT INTO probe_result VALUES (probe.name || ': empty array rejected',
          CASE WHEN msg LIKE '%' || probe.name || '%' THEN 'PASS'
               ELSE 'FAIL: rejected by a DIFFERENT constraint: ' || msg END);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
        INSERT INTO probe_result VALUES (probe.name || ': empty array rejected',
          'FAIL: wrong error class, the fixture is broken rather than the constraint: ' || msg);
    END;
  END LOOP;
END;
$arrays$;

\echo ''
\echo 'plan_versions immutability and NULL-passes CHECK probes'
\echo '------------------------------------------------------'
SELECT rpad(step, 52) || verdict AS result FROM probe_result;

DO $verdict$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad FROM probe_result WHERE verdict <> 'PASS';
  IF bad > 0 THEN
    RAISE EXCEPTION '% probe(s) failed. A guard nobody has watched behave correctly is not a guard.', bad;
  END IF;
  RAISE NOTICE 'All % probes pass.', (SELECT count(*) FROM probe_result);
END;
$verdict$;

ROLLBACK;
