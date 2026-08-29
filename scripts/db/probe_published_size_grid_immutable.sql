-- =============================================================================
-- scripts/db/probe_published_size_grid_immutable.sql
-- =============================================================================
-- 0066 and ADR-213. THE GUARD 0028's GUARANTEE READ AS ALREADY HAVING.
--
-- WHY THIS FILE EXISTS AT ALL, in 0028's own words: 0027 installed a function
-- that read `NEW.config` on a table with no such column, and it INSTALLED
-- CLEANLY, because PL/pgSQL resolves record fields at EXECUTION rather than at
-- CREATE FUNCTION. A migration that applies is not a guard that works. So every
-- case below is watched behaving, and the refusals are checked BY SQLSTATE AND
-- BY MESSAGE TEXT rather than by "an exception happened".
--
-- THE ACCEPTANCES LEAD, and there are six of them. A probe that only ever
-- attempts forbidden things passes against a guard that refuses everything, and
-- refusing everything here would break plan authoring, which is a workflow
-- nothing in `apps/` exercises yet and which nobody would notice was broken.
-- The dangerous over-correction is not "the guard is missing"; it is "the guard
-- is total".
--
-- BEFORE 0066 EVERY ONE OF THE NINE REJECTIONS BELOW COMMITTED. Rejections 1
-- and 2 are session 401's exact mutations: `buffer_cents` 100000 -> 777777 on a
-- published version, and that version's whole size grid DELETEd.
--
-- Run against a database with the full migration set applied:
--   psql -v ON_ERROR_STOP=1 -q -f scripts/db/probe_published_size_grid_immutable.sql
--
-- Everything happens inside one transaction that is ROLLED BACK. The probe
-- leaves no rows behind.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE probe_result(step text, verdict text) ON COMMIT DROP;

DO $probe$
DECLARE
  plan     uuid;
  draft_a  uuid;   -- stays draft for the whole probe
  pub      uuid;   -- draft -> published -> retired
  msg      text;
  code     text;
  n        int;
  b        bigint;
BEGIN
  -- Every fixture grid below leaves the floor lock DISABLED, so
  -- plan_version_sizes_floor_lock_complete and _buffer_clears_lock are both
  -- satisfied by construction and a refusal below is this guard's rather than a
  -- CHECK arriving first.
  INSERT INTO plans (code, name) VALUES ('probe_grid_plan', 'Probe grid') RETURNING id INTO plan;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, created_by)
  VALUES (plan, 1, 'draft', '{"phase_funded":{"max_payouts":5}}'::jsonb,
          '{"floor":"never resets"}'::jsonb, 'probe-grid-draft', 'probe')
  RETURNING id INTO draft_a;

  INSERT INTO plan_versions (plan_id, version, status, rules, copy_blocks,
                             public_slug, created_by)
  VALUES (plan, 2, 'draft', '{"phase_funded":{"max_payouts":5}}'::jsonb,
          '{"floor":"never resets"}'::jsonb, 'probe-grid-pub', 'probe')
  RETURNING id INTO pub;

  -- ---------------------------------------------------------------------------
  -- ACCEPTANCE 1. A DRAFT VERSION'S GRID TAKES AN INSERT. This is how every
  --   size row that has ever existed was written, and it is the half a total
  --   guard would silently destroy.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO plan_version_sizes (plan_version_id, size_cents, price_cents,
      reset_price_cents, drawdown_cents, profit_target_cents, buffer_cents,
      win_day_floor_cents, payout_cap_schedule_cents, floor_lock_enabled)
    VALUES (pub, 2500000, 15000, 12000, 100000, 150000, 100000, 5000,
            '[{"from_ordinal":1,"cap_cents":100000}]'::jsonb, false),
           (pub, 5000000, 25000, 20000, 200000, 300000, 200000, 10000,
            '[{"from_ordinal":1,"cap_cents":200000}]'::jsonb, false),
           (draft_a, 2500000, 15000, 12000, 100000, 150000, 100000, 5000,
            '[{"from_ordinal":1,"cap_cents":100000}]'::jsonb, false);
    INSERT INTO probe_result VALUES ('draft grid takes an INSERT', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('draft grid takes an INSERT', 'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- ACCEPTANCE 2. A DRAFT VERSION'S GRID TAKES AN UPDATE. Authoring is editing.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_version_sizes SET buffer_cents = 110000
     WHERE plan_version_id = pub AND size_cents = 2500000;
    SELECT buffer_cents INTO b FROM plan_version_sizes
     WHERE plan_version_id = pub AND size_cents = 2500000;
    INSERT INTO probe_result VALUES ('draft grid takes an UPDATE',
      CASE WHEN b IS NOT DISTINCT FROM 110000::bigint THEN 'PASS'
           ELSE 'FAIL: buffer_cents is ' || coalesce(b::text, '<no such row>') END);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('draft grid takes an UPDATE', 'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- ACCEPTANCE 3. A DRAFT VERSION'S GRID TAKES A DELETE. Removing a size before
  --   publication is authoring too, and it is restored immediately so the grid
  --   the publish below validates is the two-row one.
  -- ---------------------------------------------------------------------------
  BEGIN
    DELETE FROM plan_version_sizes WHERE plan_version_id = pub AND size_cents = 5000000;
    INSERT INTO plan_version_sizes (plan_version_id, size_cents, price_cents,
      reset_price_cents, drawdown_cents, profit_target_cents, buffer_cents,
      win_day_floor_cents, payout_cap_schedule_cents, floor_lock_enabled)
    VALUES (pub, 5000000, 25000, 20000, 200000, 300000, 200000, 10000,
            '[{"from_ordinal":1,"cap_cents":200000}]'::jsonb, false);
    INSERT INTO probe_result VALUES ('draft grid takes a DELETE', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('draft grid takes a DELETE', 'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- ACCEPTANCE 4. THE PUBLISH TRANSITION STILL WORKS WITH A GRID ATTACHED.
  --   0066 guards writes to plan_version_sizes and must not reach the parent's
  --   own state machine. If this fails, plans cannot be published at all, which
  --   is exactly ADR-035 item 1's shape one table over.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions
       SET status = 'published', published_at = now(), public_visible = true,
           simulation_waiver_reason =
             'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)'
     WHERE id = pub;
    INSERT INTO probe_result VALUES ('a version with a grid still publishes', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('a version with a grid still publishes',
      'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- REJECTION 1. SESSION 401's EXACT MUTATION. buffer_cents 100000 -> 777777 on
  --   a PUBLISHED version. Before 0066 this committed.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_version_sizes SET buffer_cents = 777777
     WHERE plan_version_id = pub AND size_cents = 2500000;
    INSERT INTO probe_result VALUES ('published grid refuses an UPDATE',
      'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('published grid refuses an UPDATE',
      CASE WHEN msg LIKE '%is published and its size grid is immutable%'
                AND msg LIKE '%Attempted UPDATE%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- The value must still be the one the version published with, not merely
  -- "the statement raised". A guard that raises after writing is not a guard.
  SELECT buffer_cents INTO b FROM plan_version_sizes
   WHERE plan_version_id = pub AND size_cents = 2500000;
  INSERT INTO probe_result VALUES ('the refused UPDATE left the cents alone',
    CASE WHEN b IS NOT DISTINCT FROM 110000::bigint THEN 'PASS'
         ELSE 'FAIL: buffer_cents is ' || coalesce(b::text, '<no such row>') END);

  -- ---------------------------------------------------------------------------
  -- REJECTION 2. SESSION 401's SECOND MUTATION. The whole grid DELETEs.
  -- ---------------------------------------------------------------------------
  BEGIN
    DELETE FROM plan_version_sizes WHERE plan_version_id = pub;
    INSERT INTO probe_result VALUES ('published grid refuses a DELETE',
      'FAIL: the delete committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('published grid refuses a DELETE',
      CASE WHEN msg LIKE '%is published and its size grid is immutable%'
                AND msg LIKE '%Attempted DELETE%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  SELECT count(*) INTO n FROM plan_version_sizes WHERE plan_version_id = pub;
  INSERT INTO probe_result VALUES ('the refused DELETE left the grid whole',
    CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL: ' || n || ' rows remain' END);

  -- ---------------------------------------------------------------------------
  -- REJECTION 3. THE RULED QUESTION. A size ADDED to a published version. It is
  --   refused because `validatePlan(rules, sizes)` runs at the publish
  --   transition over the WHOLE array, and four of the eight size-level CV rules
  --   plus the floor_lock_enabled materialization have no constraint on this
  --   table at all, so a row written afterwards is a row nothing validated.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO plan_version_sizes (plan_version_id, size_cents, price_cents,
      reset_price_cents, drawdown_cents, profit_target_cents, buffer_cents,
      win_day_floor_cents, payout_cap_schedule_cents, floor_lock_enabled)
    VALUES (pub, 10000000, 45000, 40000, 400000, 600000, 400000, 20000,
            '[{"from_ordinal":1,"cap_cents":400000}]'::jsonb, false);
    INSERT INTO probe_result VALUES ('published grid refuses an INSERT',
      'FAIL: the insert committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('published grid refuses an INSERT',
      CASE WHEN msg LIKE '%is published and its size grid is immutable%'
                AND msg LIKE '%Attempted INSERT%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- REJECTION 4. THE LANDING CHECK. Moving a size row from a DRAFT version onto
  --   a PUBLISHED one is an INSERT into the published grid under another name,
  --   and a guard reading only OLD would admit it.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_version_sizes SET plan_version_id = pub, size_cents = 15000000
     WHERE plan_version_id = draft_a;
    INSERT INTO probe_result VALUES ('a row cannot MOVE ONTO a published version',
      'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('a row cannot MOVE ONTO a published version',
      CASE WHEN msg LIKE '%is published and its size grid is immutable%'
                AND msg LIKE '%size_cents 15000000 row.%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- REJECTION 5. THE LEAVING CHECK. Moving a size row OFF a published version
  --   is a DELETE from it, and a guard reading only NEW would admit it.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_version_sizes SET plan_version_id = draft_a, size_cents = 15000000
     WHERE plan_version_id = pub AND size_cents = 5000000;
    INSERT INTO probe_result VALUES ('a row cannot MOVE OFF a published version',
      'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('a row cannot MOVE OFF a published version',
      CASE WHEN msg LIKE '%it already carries%' AND msg LIKE '%size_cents 5000000%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- ACCEPTANCE 5. THE GUARD IS PER VERSION, NOT PER TABLE. A sibling that is
  --   still a draft stays fully writable while a published version exists.
  --   Without this case, a guard that refused every write to the table would
  --   pass all five rejections above.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_version_sizes SET buffer_cents = 123456
     WHERE plan_version_id = draft_a AND size_cents = 2500000;
    SELECT buffer_cents INTO b FROM plan_version_sizes
     WHERE plan_version_id = draft_a AND size_cents = 2500000;
    INSERT INTO probe_result VALUES ('a draft sibling stays writable',
      CASE WHEN b IS NOT DISTINCT FROM 123456::bigint THEN 'PASS'
           ELSE 'FAIL: buffer_cents is ' || coalesce(b::text, '<no such row>') END);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('a draft sibling stays writable',
      'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- ACCEPTANCE 6. 0028's ONE PERMITTED TRANSITION STILL HAPPENS. published ->
  --   retired with retired_at set, on a version that carries a grid. 0066 must
  --   not have made a published plan undelistable, which is ADR-035 item 1's
  --   own failure arriving from the child table.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_versions
       SET status = 'retired', retired_at = now(), public_visible = false
     WHERE id = pub;
    INSERT INTO probe_result VALUES ('a version with a grid still retires', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
    INSERT INTO probe_result VALUES ('a version with a grid still retires',
      'FAIL: ' || code || ' ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- REJECTIONS 6, 7 AND 8. A RETIRED VERSION'S GRID. Retirement stops new sales
  --   and never touches live accounts, so the grid a retired version was
  --   published with is still the contract some live account was sold under.
  --   0028 freezes a retired plan_versions row absolutely; this is that, one
  --   table out.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE plan_version_sizes SET buffer_cents = 777777
     WHERE plan_version_id = pub AND size_cents = 2500000;
    INSERT INTO probe_result VALUES ('retired grid refuses an UPDATE',
      'FAIL: the update committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('retired grid refuses an UPDATE',
      CASE WHEN msg LIKE '%is retired and its size grid is immutable%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  BEGIN
    DELETE FROM plan_version_sizes WHERE plan_version_id = pub;
    INSERT INTO probe_result VALUES ('retired grid refuses a DELETE',
      'FAIL: the delete committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('retired grid refuses a DELETE',
      CASE WHEN msg LIKE '%is retired and its size grid is immutable%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  BEGIN
    INSERT INTO plan_version_sizes (plan_version_id, size_cents, price_cents,
      reset_price_cents, drawdown_cents, profit_target_cents, buffer_cents,
      win_day_floor_cents, payout_cap_schedule_cents, floor_lock_enabled)
    VALUES (pub, 10000000, 45000, 40000, 400000, 600000, 400000, 20000,
            '[{"from_ordinal":1,"cap_cents":400000}]'::jsonb, false);
    INSERT INTO probe_result VALUES ('retired grid refuses an INSERT',
      'FAIL: the insert committed');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('retired grid refuses an INSERT',
      CASE WHEN msg LIKE '%is retired and its size grid is immutable%'
           THEN 'PASS' ELSE 'FAIL: wrong message: ' || msg END);
  END;

  -- ---------------------------------------------------------------------------
  -- REJECTION 9. A DANGLING PARENT IS THE FOREIGN KEY'S REFUSAL AND NOT THIS
  --   GUARD'S. A BEFORE ROW trigger fires before the foreign key's own check, so
  --   this guard sees the row first; it falls through on a parent it cannot
  --   find, and the constraint answers BY NAME. Reporting a real dangling
  --   reference as an immutability violation would send a reader to the wrong
  --   file, which is precisely what 0027's `undefined_column` did.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO plan_version_sizes (plan_version_id, size_cents, price_cents,
      reset_price_cents, drawdown_cents, profit_target_cents, buffer_cents,
      win_day_floor_cents, payout_cap_schedule_cents, floor_lock_enabled)
    VALUES (gen_random_uuid(), 2500000, 15000, 12000, 100000, 150000, 100000, 5000,
            '[{"from_ordinal":1,"cap_cents":100000}]'::jsonb, false);
    INSERT INTO probe_result VALUES ('a dangling parent is the FK''s refusal',
      'FAIL: the insert committed');
  EXCEPTION
    WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES ('a dangling parent is the FK''s refusal',
        CASE WHEN msg LIKE '%plan_version_sizes_plan_version_id_fkey%'
             THEN 'PASS' ELSE 'FAIL: wrong constraint: ' || msg END);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, code = RETURNED_SQLSTATE;
      INSERT INTO probe_result VALUES ('a dangling parent is the FK''s refusal',
        'FAIL: refused by something else: ' || code || ' ' || msg);
  END;
END;
$probe$;

\echo ''
\echo 'published size grid immutability probes (0066, ADR-213)'
\echo '-------------------------------------------------------'
SELECT rpad(step, 52) || verdict AS result FROM probe_result;

DO $verdict$
DECLARE
  bad   int;
  cases int;
BEGIN
  -- `IS DISTINCT FROM` RATHER THAN `<>`, AND THE COUNTERFACTUAL RUN IS WHY.
  -- Against 0001..0065 rejection 4 commits, which empties the draft sibling
  -- acceptance 5 then looks for; `b` came back NULL, `b = 123456` evaluated to
  -- NULL, the CASE returned NULL, and `verdict <> 'PASS'` is NULL for that row
  -- and does not count. Ten failures were reported where there were eleven.
  -- The three CASEs above are total now and this is the second half: a NULL
  -- verdict is a failure, never an abstention.
  SELECT count(*) INTO bad FROM probe_result WHERE verdict IS DISTINCT FROM 'PASS';
  IF bad > 0 THEN
    RAISE EXCEPTION '% probe(s) failed. A guard nobody has watched behave correctly is not a guard.', bad;
  END IF;

  -- A CASE THAT NEVER RAN LEAVES NO ROW, AND NO ROW LOOKS EXACTLY LIKE A PASS.
  -- Every count above is over what the table holds, so an exception escaping one
  -- of the blocks would report a smaller, greener probe.
  SELECT count(*) INTO cases FROM probe_result;
  IF cases <> 17 THEN
    RAISE EXCEPTION 'expected 17 probe rows and found %. A case that did not run is not a case that passed.', cases;
  END IF;
  RAISE NOTICE 'All % probes pass.', cases;
END;
$verdict$;

ROLLBACK;
