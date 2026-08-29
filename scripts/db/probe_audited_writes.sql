-- =============================================================================
-- Probe: the audited write (0048). OI-04, OI-12, OI-13, ADR-128
-- =============================================================================
-- EIGHT SUCCESS CASES BEFORE THE FIRST REJECTION, and on this file the success
-- half carries most of the weight. Every one of the three functions here is a
-- PATH THAT DID NOT EXIST, so the failure mode this probe exists to catch is not
-- "the guard lets something through", it is "the guard lets NOTHING through".
-- 0034 is the precedent named in DELTA_MANIFEST section 18: a CHECK that
-- rejected everything passed thirty-two rejection assertions and reported
-- nothing wrong.
--
-- SUCCESS 1, 2 AND 3 ARE THE THREE READINGS OF CALENDAR-C3 AND ONLY ONE OF THEM
-- IS OBVIOUS. The guard refuses a retroactive calendar INSERT. What makes an
-- INSERT retroactive is that the engine has already folded past the day, NOT
-- that the day sits inside a trading_calendar_loads coverage window, and the
-- difference is the whole design: an ordinary forward load writes a load row
-- covering a year and then inserts every day inside it, so the coverage reading
-- would refuse the one case OI-12 says is already correct. SUCCESS 1 is the
-- launch case (nothing folded at all), SUCCESS 2 is the forward extension, and
-- both fail the day somebody rewrites the test as a coverage lookup.
--
-- SUCCESS 8 IS THE OTHER TIGHTENING NOBODY WOULD NOTICE. rewrite_rule_state
-- requires a version-like input to have moved, and there are TWO of them:
-- engine_version and calendar_revision_id (ADR-047, "the engine's second
-- version-like input"). A reader who knows B.4 by its engine_version half would
-- narrow that clause to engine_version alone; it would install cleanly, satisfy
-- every rejection below, and refuse every calendar-correction rewrite, which is
-- the entire reason 0035 raised OI-13 in the first place.
--
-- REJECTIONS ARE CHECKED BY MESSAGE, NEVER BY EXCEPTION CLASS. Every assertion
-- in 0048 raises check_violation, so a handler catching the class cannot tell
-- "the replacement is for a different day" from "the mark is already
-- superseded", and either half could be deleted with both tests still passing.
-- The three authz rejections are the exception: they are raised by PostgreSQL
-- itself as insufficient_privilege, and there the CLASS is the finding.
--
-- IT FORCES THE DEFERRED CHECK WHERE THERE IS ONE. This file ends in ROLLBACK,
-- so an assertion left to fire "at commit" would never be checked at all: the
-- probe would report green having verified nothing, which is the vacuous-pass
-- shape this corpus has now found in a CHECK, in a DO block and in a falsify
-- seed. `daily_marks_live_per_account_day_uq` is deferred by 0048 and is forced
-- IMMEDIATE at every point that depends on it. It is named rather than reached
-- through ALL, because ALL would also fire CALENDAR-C1 and a failure there would
-- be reported against the wrong guard.
--
-- CALENDAR-C3 IS NOT DEFERRED AND THE ORDER IN SUCCESS 3 IS THE REASON. The
-- absence record is written BEFORE the calendar row, which 0048's deferrable
-- foreign key on trading_calendar_revisions.trading_day is what permits.
--
-- THE COUNTERFACTUAL, AS OBSERVED RATHER THAN AS PREDICTED. This header first
-- said SUCCESS 4 would fail first, because supersede_daily_mark does not exist
-- before 0048. Executed against 0001-0047, SUCCESS 1 AND 2 BOTH PASS and the
-- file dies at SUCCESS 3 with `insert or update on table
-- "trading_calendar_revisions" violates foreign key constraint
-- trading_calendar_revisions_trading_day_fkey`, because the absence record is
-- written before the calendar row and 0032's foreign key is not deferrable
-- there. Exit 3. Both facts are worth keeping: SUCCESS 1 and 2 pass without
-- 0048 because a guard that does not exist refuses nothing, which is what makes
-- them assertions about the guard's SHAPE rather than its existence, and the
-- first thing that actually breaks is the deferrable foreign key rather than
-- any function. Recorded in DELTA_MANIFEST section 26.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures, part A: everything that does NOT create a trading day
-- ---------------------------------------------------------------------------
-- Ordered deliberately. CALENDAR-C3 reads the greatest trading_day in fills,
-- daily_marks and rule_states, so SUCCESS 1 has to run while all three are
-- empty and part B is what gives the rest of the file a fold extent.
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE probe_bigints (k text PRIMARY KEY, v bigint);

DO $$
DECLARE
  v_identity  uuid;
  v_identity2 uuid;
  v_user      uuid;
  v_plan      uuid;
  v_pv        uuid;
  v_purchase  uuid;
  v_account   uuid;
  v_file      uuid;
  v_admin     bigint;
BEGIN
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_identity;
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_identity2;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (v_identity, 'oi128@example.test', 'oi128@example.test')
    RETURNING id INTO v_user;

  INSERT INTO plans (code, name) VALUES ('core_eod', 'Core EOD probe')
    RETURNING id INTO v_plan;
  INSERT INTO plan_versions (plan_id, version, status, rules, public_slug, created_by)
    VALUES (v_plan, 1, 'draft', '{"schema_version":1}'::jsonb, 'oi128-probe', v_user)
    RETURNING id INTO v_pv;
  -- 0045 SD-M21-02: a published version records what it was decided on, or says
  -- in writing why no run was consulted. A probe database has no runs.
  UPDATE plan_versions SET status = 'published', published_at = now(),
         simulation_waiver_reason = 'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)'
   WHERE id = v_pv;

  INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                         list_price_cents, amount_paid_cents, psp, psp_reference,
                         status, paid_at)
    VALUES (v_identity, v_user, v_pv, 5000000, 'new', 15000, 15000, 'psp_a',
            'oi128-ref', 'paid', now())
    RETURNING id INTO v_purchase;

  INSERT INTO accounts (identity_id, user_id, purchase_id, plan_version_id,
                        size_cents, status, phase, opened_on, funded_on)
    VALUES (v_identity, v_user, v_purchase, v_pv, 5000000, 'active', 'funded',
            current_date, current_date)
    RETURNING id INTO v_account;

  INSERT INTO ingest_files (file_name, sha256, kind, byte_size)
    VALUES ('oi128-probe.csv', sha256('oi128'::bytea), 'fills', 1)
    RETURNING id INTO v_file;

  -- ADR-237, `0073`. THE ACTOR HAS A REFERENT NOW AND A FIXTURE HAS TO SUPPLY IT.
  -- `admin_actions_actor_is_an_operator` is a foreign key onto `operators(actor)`,
  -- so an audit row naming an operator this database does not hold is unwritable,
  -- which is the whole point of the constraint and is what this INSERT satisfies.
  --
  -- `idp_issuer` AND `idp_subject` ARE LEFT NULL AND THAT IS THE CORRECT STATE
  -- HERE RATHER THAN A SHORTCUT: `0073` uses NULL for an operator who cannot sign
  -- in at all, a probe database has no identity provider, and the pair is
  -- unreachable by equality rather than claimable.
  --
  -- ON CONFLICT DO NOTHING because every probe in this directory ends in
  -- ROLLBACK, so the row is this transaction's alone; the clause is what keeps a
  -- second block in the same file from failing on the first one's row.
  INSERT INTO operators (actor, role, display_name)
    VALUES ('founder', 'owner', 'Founder (probe fixture)')
    ON CONFLICT (actor) DO NOTHING;

  -- B.4 step 3's approval. `initiative` is 0043's column and 'operational' is
  -- the value that says Merit acted of its own motion, which an engine upgrade
  -- is; `trader_request` would require on_behalf_of_identity_id.
  INSERT INTO admin_actions (actor, action, subject_kind, subject_id, reason,
                             before, after, initiative)
    VALUES ('founder', 'replay.rewrite_approved', 'account', v_account,
            'B.4 step 3: the dry-run diff report was read and approved',
            '{}'::jsonb, '{}'::jsonb, 'operational')
    RETURNING id INTO v_admin;

  INSERT INTO probe_ids VALUES ('account', v_account), ('identity', v_identity),
                               ('identity2', v_identity2), ('file', v_file);
  INSERT INTO probe_bigints VALUES ('admin_action', v_admin);
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: THE LAUNCH CASE. Nothing folded, so nothing is retroactive
-- ---------------------------------------------------------------------------
-- The calendar is seeded years ahead of an engine that has computed nothing.
-- fills, daily_marks and rule_states are all empty, GREATEST over three NULLs
-- is NULL, and every insert is an extension by definition. A guard that refused
-- here would make the first load of the calendar impossible, which is the shape
-- of fail-closed that fails the wrong thing.
DO $$
BEGIN
  INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
  VALUES (DATE '2026-06-02', '2026-06-01 22:00Z', '2026-06-02 21:00Z'),
         (DATE '2026-06-03', '2026-06-02 22:00Z', '2026-06-03 21:00Z');
  RAISE NOTICE 'SUCCESS 1: with nothing folded, a calendar INSERT needs no revision row';
END $$;

-- ---------------------------------------------------------------------------
-- Fixtures, part B: one dependent row in EACH of the ruled three tables
-- ---------------------------------------------------------------------------
-- Three tables and not one, because a guard that reads two of them passes every
-- test written against those two. This sets the fold extent to 2026-06-02.
DO $$
DECLARE
  v_account uuid   := (SELECT v FROM probe_ids WHERE k = 'account');
  v_file    uuid   := (SELECT v FROM probe_ids WHERE k = 'file');
  v_mark    bigint;
  v_state   bigint;
BEGIN
  INSERT INTO raw_ingest_rows (ingest_file_id, line_number, raw)
    VALUES (v_file, 1, '{}'::jsonb);

  INSERT INTO fills (account_id, platform_fill_id, symbol, side, quantity,
                     price_numerator, price_denominator, executed_at, trading_day,
                     ingest_file_id, raw_row_id)
    VALUES (v_account, 'oi128-fill', 'ES', 'buy', 1, 500000, 100,
            '2026-06-02 14:00Z', DATE '2026-06-02', v_file,
            (SELECT id FROM raw_ingest_rows ORDER BY id DESC LIMIT 1));

  INSERT INTO daily_marks (account_id, trading_day, opening_balance_cents,
                           closing_balance_cents, high_balance_cents,
                           low_balance_cents, realized_pnl_cents, adjustment_cents,
                           fill_count, traded_day, win_day, source_hash, source)
    VALUES (v_account, DATE '2026-06-02', 5000000, 5030000, 5040000, 4990000,
            30000, 0, 1, true, true, sha256('mark1'::bytea), 'report')
    RETURNING id INTO v_mark;

  INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                           floor_open_cents, high_water_balance_cents,
                           balance_cents, withdrawable_cents, traded_days_count,
                           win_days_count, payouts_settled_count, engine_eligible,
                           engine_gates, context_gates, state_hash, engine_version)
    VALUES (v_account, DATE '2026-06-02', 'funded', 4800000, 4800000, 5030000,
            5030000, 30000, 1, 1, 0, false,
            '{"profit_target":false}'::jsonb, '{"freeze":false}'::jsonb,
            sha256('state1'::bytea), 'engine-1.0.0')
    RETURNING id INTO v_state;

  INSERT INTO probe_bigints VALUES ('mark_live', v_mark), ('state', v_state);
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: THE FORWARD EXTENSION, which the coverage reading would refuse
-- ---------------------------------------------------------------------------
-- 2026-06-04 is beyond 2026-06-02, the greatest day anything has been folded
-- through, so extending coverage forward changes no already-computed state.
-- This is OI-12's own carve-out, stated in its own words: "For a FUTURE day that
-- is correct, because extending coverage forward changes no already-computed
-- state." IT IS ALSO THE ASSERTION THAT FAILS IF THE GUARD IS REWRITTEN AS A
-- trading_calendar_loads LOOKUP, because a real load writes a coverage row and
-- then inserts every day inside it.
DO $$
BEGIN
  INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
  VALUES (DATE '2026-06-04', '2026-06-03 22:00Z', '2026-06-04 21:00Z');
  RAISE NOTICE 'SUCCESS 2: a day beyond the fold extent is an extension and needs nothing';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: the retroactive backfill, RECORDED, commits
-- ---------------------------------------------------------------------------
-- 2026-05-29 is before the fold extent, so it moves the day sequence
-- retroactively. With the absence image, an actor, a reason and an incident it
-- is an incident that happened and was written down, which is the outcome the
-- guard exists to produce. If this fails, CALENDAR-C3 refuses the repair as well
-- as the silent change, and a guard with no legitimate path is a table nobody
-- can fix.
--
-- THE PRIOR IMAGE IS THE ABSENCE. is_holiday is NOT NULL on every real
-- trading_calendar row, so `"is_holiday": null` can only mean "no row existed".
-- The calendar row is inserted FIRST because trading_calendar_revisions.
-- trading_day is a foreign key to it; that ordering is the database's own and
-- not a contract this trigger invents.
DO $$
BEGIN
  -- THE ABSENCE RECORD COMES FIRST, which is what 0048's deferrable foreign key
  -- makes possible and what lets CALENDAR-C3 be immediate. It also reads
  -- correctly: record that the calendar said nothing about this day BEFORE
  -- making it say something.
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count,
                                          incident_ref)
  VALUES (DATE '2026-05-29',
          jsonb_build_object('trading_day', '2026-05-29',
                             'is_holiday', NULL,
                             'session_open_at', NULL,
                             'session_close_at', NULL),
          'calendar-loader',
          'the 2026 source omitted 2026-05-29 and the day sequence was short by one',
          sha256('corrected-source'::bytea), 0, 'INC-2026-0042');

  INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
  VALUES (DATE '2026-05-29', '2026-05-28 22:00Z', '2026-05-29 21:00Z');

  RAISE NOTICE 'SUCCESS 3: a retroactive INSERT with an absence image and an incident commits';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4: supersede_daily_mark walks the path 0026 named and nobody had
-- ---------------------------------------------------------------------------
-- DATA_MODEL section 16 ruling 2, confirmed at the Wave 2 gate: "Marks and
-- corrections use supersession, never update." 0014 built the column, 0026
-- revoked the UPDATE that writes it and named a function that did not exist, so
-- until 0048 the ruled correction path failed at the grant. That is the correct
-- failure and it looked like a bug, which is exactly what OI-04 says.
--
-- RUN AGAINST 0001-0047 THIS IS THE FIRST ASSERTION THAT FAILS.
DO $$
DECLARE
  v_account uuid   := (SELECT v FROM probe_ids WHERE k = 'account');
  v_old     bigint := (SELECT v FROM probe_bigints WHERE k = 'mark_live');
  v_new     bigint;
BEGIN
  INSERT INTO daily_marks (account_id, trading_day, opening_balance_cents,
                           closing_balance_cents, high_balance_cents,
                           low_balance_cents, realized_pnl_cents, adjustment_cents,
                           fill_count, traded_day, win_day, source_hash, source)
    VALUES (v_account, DATE '2026-06-02', 5000000, 5020000, 5040000, 4990000,
            20000, 0, 1, true, true, sha256('mark2'::bytea), 'report')
    RETURNING id INTO v_new;

  PERFORM supersede_daily_mark(v_old, v_new);

  -- 0048 part 1. The INSERT above leaves TWO live marks for the account-day for
  -- the instant before the line above points the old one away, which is why the
  -- uniqueness is deferred. Forcing it here is what proves the transaction ends
  -- in a state the constraint accepts; this file ends in ROLLBACK, so a check
  -- left to fire "at commit" would never fire at all.
  SET CONSTRAINTS daily_marks_live_per_account_day_uq IMMEDIATE;
  SET CONSTRAINTS daily_marks_live_per_account_day_uq DEFERRED;

  IF (SELECT superseded_by FROM daily_marks WHERE id = v_old) IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'SUCCESS 4 FAILED: superseded_by did not move';
  END IF;

  -- daily_marks_live_per_account_day_uq is a PARTIAL unique index on
  -- superseded_by IS NULL, so this is the property the whole mechanism exists
  -- for: exactly one live mark per account-day, across a correction.
  IF (SELECT count(*) FROM daily_marks
       WHERE account_id = v_account AND trading_day = DATE '2026-06-02'
         AND superseded_by IS NULL) <> 1 THEN
    RAISE EXCEPTION 'SUCCESS 4 FAILED: the account-day does not have exactly one live mark';
  END IF;

  INSERT INTO probe_bigints VALUES ('mark_correction_1', v_new);
  RAISE NOTICE 'SUCCESS 4: a mark correction supersedes, and the account-day keeps one live mark';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 5: the chain is walkable, which a one-shot function would not be
-- ---------------------------------------------------------------------------
-- A second correction supersedes the FIRST correction. Without this case a
-- function that refused any mark whose account-day already carried a superseded
-- row would pass SUCCESS 4 and stop the second correction of the same day
-- forever, which is the day a transcription error is found twice.
DO $$
DECLARE
  v_account uuid   := (SELECT v FROM probe_ids WHERE k = 'account');
  v_first   bigint := (SELECT v FROM probe_bigints WHERE k = 'mark_correction_1');
  v_second  bigint;
BEGIN
  INSERT INTO daily_marks (account_id, trading_day, opening_balance_cents,
                           closing_balance_cents, high_balance_cents,
                           low_balance_cents, realized_pnl_cents, adjustment_cents,
                           fill_count, traded_day, win_day, source_hash, source)
    VALUES (v_account, DATE '2026-06-02', 5000000, 5010000, 5040000, 4990000,
            10000, 0, 1, true, true, sha256('mark3'::bytea), 'report')
    RETURNING id INTO v_second;

  PERFORM supersede_daily_mark(v_first, v_second);
  SET CONSTRAINTS daily_marks_live_per_account_day_uq IMMEDIATE;
  SET CONSTRAINTS daily_marks_live_per_account_day_uq DEFERRED;
  INSERT INTO probe_bigints VALUES ('mark_correction_2', v_second);
  RAISE NOTICE 'SUCCESS 5: a second correction supersedes the first';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 6: suppress_identity_link writes all four dispute columns
-- ---------------------------------------------------------------------------
-- INV-M7-09's population: two housemates, a married couple sharing a card, a
-- father funding a son. The edge is GENUINE and the humans are DIFFERENT, and
-- without this path the graph's error is permanent and invisible to the person
-- it harms. identity_links_suppression_has_author is why `suppressed` alone is
-- not enough, and OI-04's phrase "single-column update" is imprecise there.
DO $$
DECLARE
  v_a    uuid := (SELECT v FROM probe_ids WHERE k = 'identity');
  v_b    uuid := (SELECT v FROM probe_ids WHERE k = 'identity2');
  v_edge uuid;
  v_row  identity_links;
BEGIN
  INSERT INTO identity_links (identity_a, identity_b, link_kind, confidence_bp,
                              evidence, created_by)
    VALUES (least(v_a, v_b), greatest(v_a, v_b), 'shared_payment', 9000,
            '{"card_fingerprint":"abc"}'::jsonb, 'detector.payment')
    RETURNING id INTO v_edge;

  PERFORM suppress_identity_link(v_edge, 'ops.reviewer',
                                 'household: two adults at one address, both KYC verified');

  SELECT * INTO v_row FROM identity_links WHERE id = v_edge;
  IF NOT v_row.suppressed
     OR v_row.suppressed_by IS NULL
     OR v_row.disputed_at IS NULL
     OR v_row.dispute_note IS NULL THEN
    RAISE EXCEPTION
      'SUCCESS 6 FAILED: the four SD-M7-04 dispute columns did not move together (%)',
      to_jsonb(v_row);
  END IF;

  INSERT INTO probe_ids VALUES ('edge', v_edge);
  RAISE NOTICE 'SUCCESS 6: a disputed edge is suppressed with its author, date and note';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 7: rewrite_rule_state under a NEW ENGINE VERSION. B.4 step 4
-- ---------------------------------------------------------------------------
-- The protocol's fourth step, which had no way to run: 0026 revoked UPDATE on
-- rule_states and no function performed the rewrite. The assertion that the four
-- excluded columns did not move is the control described in 0048 header item 4:
-- the assignment list is derived from pg_attribute MINUS the row's identity and
-- its birth, so a rewrite cannot move a state to another account or another day
-- and cannot make itself look original.
DO $$
DECLARE
  v_state  bigint := (SELECT v FROM probe_bigints WHERE k = 'state');
  v_admin  bigint := (SELECT v FROM probe_bigints WHERE k = 'admin_action');
  v_before rule_states;
  v_new    rule_states;
  v_after  rule_states;
BEGIN
  SELECT * INTO v_before FROM rule_states WHERE id = v_state;
  v_new := v_before;
  v_new.engine_version  := 'engine-1.1.0';
  v_new.withdrawable_cents := 25000;
  v_new.state_hash      := sha256('state1-v2'::bytea);

  PERFORM rewrite_rule_state(v_state, v_admin, v_new);

  SELECT * INTO v_after FROM rule_states WHERE id = v_state;
  IF v_after.engine_version <> 'engine-1.1.0' OR v_after.withdrawable_cents <> 25000 THEN
    RAISE EXCEPTION 'SUCCESS 7 FAILED: the rewrite did not take';
  END IF;
  IF v_after.id         <> v_before.id
     OR v_after.account_id  <> v_before.account_id
     OR v_after.trading_day <> v_before.trading_day
     OR v_after.created_at  <> v_before.created_at THEN
    RAISE EXCEPTION
      'SUCCESS 7 FAILED: an excluded column moved. id, account_id, trading_day '
      'and created_at are outside the derived assignment list and must be '
      'unwritable through this function';
  END IF;
  RAISE NOTICE 'SUCCESS 7: an approved rewrite under a new engine version lands, identity intact';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 8: the CALENDAR revision is the second version-like input
-- ---------------------------------------------------------------------------
-- ADR-047: engine_version is the code the fold runs, the calendar revision is
-- the data it folds over, and B.4 is read TWICE, once per input, WITHOUT
-- AMENDMENT. Step 4's rewrite restamps the watermark.
--
-- THIS IS THE TIGHTENING NOBODY WOULD NOTICE. Narrow 0048's version-like clause
-- to engine_version alone and this file is the only place that fails: the change
-- installs cleanly, satisfies REJECTION 9 and every other rejection here, and
-- refuses every calendar-correction rewrite, which is the exact case that made
-- 0035 raise OI-13.
DO $$
DECLARE
  v_state bigint := (SELECT v FROM probe_bigints WHERE k = 'state');
  v_admin bigint := (SELECT v FROM probe_bigints WHERE k = 'admin_action');
  v_rev   bigint := (SELECT id FROM trading_calendar_revisions ORDER BY id DESC LIMIT 1);
  v_new   rule_states;
BEGIN
  SELECT * INTO v_new FROM rule_states WHERE id = v_state;
  -- engine_version deliberately UNCHANGED.
  v_new.calendar_revision_id := v_rev;
  v_new.state_hash           := sha256('state1-v3'::bytea);

  PERFORM rewrite_rule_state(v_state, v_admin, v_new);

  IF (SELECT calendar_revision_id FROM rule_states WHERE id = v_state) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'SUCCESS 8 FAILED: the watermark was not restamped';
  END IF;
  RAISE NOTICE 'SUCCESS 8: a rewrite that moves only the calendar watermark is accepted';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1, 2 and 3: VG-5. merit_app still cannot write these tables
-- ---------------------------------------------------------------------------
-- THE NEGATIVE-AUTHZ TEST DATA_MODEL SECTION 14 REQUIRES OF EVERY NEW TABLE AND
-- EVERY SECURITY DEFINER FUNCTION, and the assertion that the three functions
-- are a PATH rather than a HOLE. If any of these passes, 0048 has handed the
-- application role the append-only bypass 0026 exists to withhold.
--
-- Checked BY CLASS here and only here: insufficient_privilege is raised by
-- PostgreSQL rather than by a RAISE in 0048, so the class IS the finding and
-- there is no message of ours to match.
DO $$
DECLARE
  v_old  bigint := (SELECT v FROM probe_bigints WHERE k = 'mark_live');
  v_edge uuid   := (SELECT v FROM probe_ids WHERE k = 'edge');
  v_st   bigint := (SELECT v FROM probe_bigints WHERE k = 'state');
  fired  boolean;
BEGIN
  SET LOCAL ROLE merit_app;

  fired := false;
  BEGIN
    UPDATE daily_marks SET superseded_by = NULL WHERE id = v_old;
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 1 FAILED: merit_app updated daily_marks directly';
  END IF;

  fired := false;
  BEGIN
    UPDATE identity_links SET suppressed = false WHERE id = v_edge;
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 2 FAILED: merit_app updated identity_links directly';
  END IF;

  fired := false;
  BEGIN
    UPDATE rule_states SET engine_version = 'sneaky' WHERE id = v_st;
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 3 FAILED: merit_app updated rule_states directly';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'REJECTION 1-3: merit_app cannot UPDATE any of the three tables directly';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: EXECUTE is not PUBLIC, which PostgreSQL grants by default
-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER function is callable by EVERY role in the cluster the
-- instant it exists, unless somebody revokes it. Without 0048's REVOKE, these
-- three functions would hand the append-only bypass to exactly the second
-- connection string 0026's "AND against PUBLIC" exists to stop. merit_analytics
-- is the role that proves it: it is a real role, it is not merit_app, and it is
-- the one the corpus already treats as the untrusted reader.
DO $$
DECLARE
  fired boolean := false;
  msg   text    := '';
BEGIN
  SET LOCAL ROLE merit_analytics;
  BEGIN
    PERFORM supersede_daily_mark(1, 2);
  EXCEPTION WHEN insufficient_privilege THEN fired := true; msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 4 FAILED: merit_analytics can execute supersede_daily_mark, so '
      'EXECUTE is still granted to PUBLIC';
  END IF;
  RAISE NOTICE 'REJECTION 4: a role that is not merit_app cannot execute the path (%)', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: a replacement mark for a DIFFERENT account-day
-- ---------------------------------------------------------------------------
-- The assertion nothing else makes. daily_marks_live_per_account_day_uq assumes
-- the correction is for the same account-day and cannot say so; without this
-- check, "supersede" can point a live mark at an unrelated row and the
-- account-day silently loses its live mark with nothing put in its place.
DO $$
DECLARE
  v_account uuid   := (SELECT v FROM probe_ids WHERE k = 'account');
  v_live    bigint := (SELECT v FROM probe_bigints WHERE k = 'mark_correction_2');
  v_other   bigint;
  fired     boolean := false;
  msg       text    := '';
BEGIN
  INSERT INTO daily_marks (account_id, trading_day, opening_balance_cents,
                           closing_balance_cents, high_balance_cents,
                           low_balance_cents, realized_pnl_cents, adjustment_cents,
                           fill_count, traded_day, win_day, source_hash, source)
    VALUES (v_account, DATE '2026-06-03', 5010000, 5010000, 5010000, 5010000,
            0, 0, 0, false, false, sha256('mark-otherday'::bytea), 'report')
    RETURNING id INTO v_other;

  BEGIN
    PERFORM supersede_daily_mark(v_live, v_other);
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;

  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: a cross-day supersession was accepted';
  END IF;
  IF position('replaces the SAME account-day' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 5 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 5: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6: re-pointing a mark that is already superseded
-- ---------------------------------------------------------------------------
-- The correction chain is the history "what did we believe ON THE DAY" is read
-- from (0014's own comment, and DATA_MODEL section 16 ruling 2). Re-pointing a
-- historical mark rewrites that history without touching a single balance, and
-- daily_marks_no_self_supersede covers only the degenerate case.
DO $$
DECLARE
  v_old   bigint := (SELECT v FROM probe_bigints WHERE k = 'mark_live');
  v_live  bigint := (SELECT v FROM probe_bigints WHERE k = 'mark_correction_2');
  fired   boolean := false;
  msg     text    := '';
BEGIN
  BEGIN
    PERFORM supersede_daily_mark(v_old, v_live);
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 6 FAILED: an already-superseded mark was re-pointed';
  END IF;
  IF position('is already superseded by' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 6 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 6: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6b: TWO LIVE MARKS ARE STILL REFUSED, which is what deferring costs
-- ---------------------------------------------------------------------------
-- 0048 part 1 moved this from an immediate partial UNIQUE INDEX to a DEFERRED
-- EXCLUDE constraint, and the whole risk of that change is that the guarantee
-- goes with the timing. DATA_MODEL section 13's invariant is "exactly one live
-- mark per account per trading day" and it must still hold AT COMMIT.
--
-- Checked BY CLASS as well as by name, because the class MOVED: an exclusion
-- constraint raises exclusion_violation where the index raised unique_violation,
-- so a handler written against the old class would score this as passing while
-- catching nothing.
DO $$
DECLARE
  v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
  fired     boolean := false;
  msg       text    := '';
BEGIN
  BEGIN
    INSERT INTO daily_marks (account_id, trading_day, opening_balance_cents,
                             closing_balance_cents, high_balance_cents,
                             low_balance_cents, realized_pnl_cents, adjustment_cents,
                             fill_count, traded_day, win_day, source_hash, source)
      VALUES (v_account, DATE '2026-06-02', 5000000, 5005000, 5040000, 4990000,
              5000, 0, 1, true, true, sha256('mark-second-live'::bytea), 'report');
    SET CONSTRAINTS daily_marks_live_per_account_day_uq IMMEDIATE;
  EXCEPTION WHEN exclusion_violation THEN fired := true; msg := SQLERRM;
  END;
  SET CONSTRAINTS daily_marks_live_per_account_day_uq DEFERRED;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 6b FAILED: a second LIVE mark for one account-day survived to '
      'the constraint check. Deferring the uniqueness has removed it';
  END IF;
  IF position('daily_marks_live_per_account_day_uq' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 6b fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 6b: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 7: a suppression with no author
-- ---------------------------------------------------------------------------
-- btrim rather than IS NOT NULL, on 0032's precedent: the empty string satisfies
-- IS NOT NULL and is the same class of silent pass as the empty array ADR-035
-- found seven times. identity_links_suppression_has_author would accept ''.
DO $$
DECLARE
  v_a    uuid := (SELECT v FROM probe_ids WHERE k = 'identity');
  v_b    uuid := (SELECT v FROM probe_ids WHERE k = 'identity2');
  v_edge uuid;
  fired  boolean := false;
  msg    text    := '';
BEGIN
  INSERT INTO identity_links (identity_a, identity_b, link_kind, confidence_bp,
                              evidence, created_by)
    VALUES (least(v_a, v_b), greatest(v_a, v_b), 'shared_device', 4000,
            '{"device":"d1"}'::jsonb, 'detector.device')
    RETURNING id INTO v_edge;

  BEGIN
    PERFORM suppress_identity_link(v_edge, '   ', 'a note');
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 7 FAILED: a blank author was accepted';
  END IF;
  IF position('no author' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 7 fired for the wrong reason: %', msg;
  END IF;

  -- The note half, separately, because one check standing in for two is how a
  -- half gets deleted without a test noticing.
  fired := false;
  BEGIN
    PERFORM suppress_identity_link(v_edge, 'ops.reviewer', '');
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 7b FAILED: a blank note was accepted';
  END IF;
  IF position('no note' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 7b fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 7: a suppression needs both an author and a note';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 8: suppressing an edge that is already suppressed
-- ---------------------------------------------------------------------------
-- A second suppression overwrites who decided the first one, and "we decided
-- this edge was wrong" is itself evidence (SD-M7-04).
DO $$
DECLARE
  v_edge uuid := (SELECT v FROM probe_ids WHERE k = 'edge');
  fired  boolean := false;
  msg    text    := '';
BEGIN
  BEGIN
    PERFORM suppress_identity_link(v_edge, 'ops.other', 'second opinion');
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 8 FAILED: an already-suppressed edge was suppressed again';
  END IF;
  IF position('already suppressed by' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 8 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 8: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 9: a rewrite with no approval
-- ---------------------------------------------------------------------------
-- B.4 step 3: "The founder approves the report. Approval is an admin_actions row
-- with the report's digest, so what was approved is provable later." Step 4 is
-- what that approval authorises, and an unapproved rewrite is an UPDATE to an
-- append-only table.
DO $$
DECLARE
  v_state bigint := (SELECT v FROM probe_bigints WHERE k = 'state');
  v_new   rule_states;
  fired   boolean := false;
  msg     text    := '';
BEGIN
  SELECT * INTO v_new FROM rule_states WHERE id = v_state;
  v_new.engine_version := 'engine-9.9.9';
  BEGIN
    PERFORM rewrite_rule_state(v_state, -1, v_new);
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 9 FAILED: a rewrite with no approval row was accepted';
  END IF;
  IF position('admin_actions row -1 does not exist' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 9 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 9: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 10: a rewrite that moves NEITHER version-like input
-- ---------------------------------------------------------------------------
-- 0048 header item 6, the clause that is a reading rather than a transcription
-- and is separately rejectable. A rewrite that changes a computed field while
-- leaving both engine_version and calendar_revision_id where they were is not
-- B.4 step 4; it is an UPDATE to an append-only table with an approval stapled
-- to it. SUCCESS 8 is the other half of this pair and the two must be read
-- together.
DO $$
DECLARE
  v_state bigint := (SELECT v FROM probe_bigints WHERE k = 'state');
  v_admin bigint := (SELECT v FROM probe_bigints WHERE k = 'admin_action');
  v_new   rule_states;
  fired   boolean := false;
  msg     text    := '';
BEGIN
  SELECT * INTO v_new FROM rule_states WHERE id = v_state;
  v_new.balance_cents            := 1;
  v_new.high_water_balance_cents := 1;
  v_new.withdrawable_cents       := 0;
  BEGIN
    PERFORM rewrite_rule_state(v_state, v_admin, v_new);
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 10 FAILED: a balance was rewritten with both version-like '
      'inputs unchanged, which is an UPDATE to an append-only table';
  END IF;
  IF position('both unchanged' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 10 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 10: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 11: a rewrite that would move the row's identity
-- ---------------------------------------------------------------------------
-- The exclusion list already makes account_id unwritable, so this assertion is
-- what tells a caller it did not do what it thought it did. Without the explicit
-- refusal the function would silently rewrite the ORIGINAL row's computed fields
-- while the caller believed it had moved the state to another account.
DO $$
DECLARE
  v_state bigint := (SELECT v FROM probe_bigints WHERE k = 'state');
  v_admin bigint := (SELECT v FROM probe_bigints WHERE k = 'admin_action');
  v_new   rule_states;
  fired   boolean := false;
  msg     text    := '';
BEGIN
  SELECT * INTO v_new FROM rule_states WHERE id = v_state;
  v_new.engine_version := 'engine-2.0.0';
  v_new.account_id     := (SELECT v FROM probe_ids WHERE k = 'identity');
  BEGIN
    PERFORM rewrite_rule_state(v_state, v_admin, v_new);
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 11 FAILED: a rewrite moved a state row to another account';
  END IF;
  IF position('never moves a state to another account' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 11 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 11: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 12: the retroactive INSERT with NO revision row. OI-12 itself
-- ---------------------------------------------------------------------------
-- This is the exposure 0035 stated and left open, in one statement: a day added
-- inside the folded range moves the day sequence retroactively, every stamped
-- rule_states row still claims a watermark that looks current, B.4 step 1 scopes
-- to an unchanged set, and the audit compares nothing. An audit that has stopped
-- looking reports exactly like one that found nothing (FM-17).
DO $$
DECLARE
  fired boolean := false;
  msg   text    := '';
BEGIN
  BEGIN
    INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
    VALUES (DATE '2026-05-28', '2026-05-27 22:00Z', '2026-05-28 21:00Z');
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 12 FAILED: a retroactive calendar INSERT committed unrecorded';
  END IF;
  IF position('no trading_calendar_revisions row records it' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 12 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 12: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 13: an UPDATE-shaped revision row does not satisfy an INSERT
-- ---------------------------------------------------------------------------
-- THE ASSERTION THAT KEEPS THE GUARD FROM BEING SATISFIED BY THE WRONG RECORD.
-- A day that was corrected earlier already has revision rows carrying a real
-- to_jsonb(OLD) image, and a guard that only asked "is there a revision row for
-- this day" would accept one of those and record nothing about the insertion.
-- is_holiday is NOT NULL on every real trading_calendar row, so a JSON null
-- there is the only image that can mean "no row existed".
DO $$
DECLARE
  fired boolean := false;
  msg   text    := '';
BEGIN
  BEGIN
    -- A well formed image of a REAL row, which is what an UPDATE would leave.
    INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                            source_digest, dependent_row_count,
                                            incident_ref)
    VALUES (DATE '2026-05-27',
            jsonb_build_object('trading_day', '2026-05-27',
                               'is_holiday', false,
                               'session_open_at', '2026-05-26T22:00:00+00:00',
                               'session_close_at', '2026-05-27T21:00:00+00:00'),
            'operator', 'looks like a correction and is not one',
            sha256('x'::bytea), 0, 'INC-2026-0043');
    INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
    VALUES (DATE '2026-05-27', '2026-05-26 22:00Z', '2026-05-27 21:00Z');
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 13 FAILED: a revision row carrying a REAL prior image satisfied '
      'the guard on an INSERT, so any earlier correction of the same day would';
  END IF;
  IF position('no trading_calendar_revisions row records it' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 13 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 13: an UPDATE-shaped image does not record an INSERT';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 14: recorded, and naming no incident
-- ---------------------------------------------------------------------------
-- THE HALF THAT NO EXISTING CONSTRAINT REACHES, and the reason it is stated in
-- the trigger rather than left to the table. dependent_row_count counts rows on
-- the day ITSELF, and a day that was never a trading day legitimately has none,
-- so trading_calendar_revisions_incident_named_when_dependent sees a zero and
-- lets incident_ref stay null. The harm from a backfill is on every day AFTER
-- it, which no per-row count on that table expresses.
DO $$
DECLARE
  fired boolean := false;
  msg   text    := '';
BEGIN
  BEGIN
    INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                            source_digest, dependent_row_count)
    VALUES (DATE '2026-05-26',
            jsonb_build_object('trading_day', '2026-05-26',
                               'is_holiday', NULL,
                               'session_open_at', NULL,
                               'session_close_at', NULL),
            'calendar-loader', 'the source omitted this day', sha256('y'::bytea), 0);
    INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
    VALUES (DATE '2026-05-26', '2026-05-25 22:00Z', '2026-05-26 21:00Z');
  EXCEPTION WHEN check_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 14 FAILED: a retroactive INSERT naming no incident committed';
  END IF;
  IF position('incident by construction' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 14 fired for the wrong reason: %', msg;
  END IF;
  RAISE NOTICE 'REJECTION 14: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 15: an admin action naming an actor who is in no directory
-- ---------------------------------------------------------------------------
-- ADR-237, `0073`. 0017 declares "NO UNEXPLAINED ADMIN ACTION, EVER. NOT NULL
-- is the whole control" over `reason`, one column away from an `actor text NOT
-- NULL` that carried no foreign key, so any string satisfied it INCLUDING A
-- STRING NAMING NOBODY. `admin_actions_actor_is_an_operator` is the half 0017
-- could not write, because no directory existed to point at.
--
-- THE PERMIT DIRECTION IS ALREADY EXERCISED BY THIS FILE'S OWN SETUP, which
-- inserts the `operators` row and then the audit row that names it. This case
-- is the refusal, and it is here rather than in a new probe because a
-- constraint nobody has seen reject anything is a constraint nobody knows is
-- wired up, and this file already holds the table.
DO $$
DECLARE
  v_account uuid := (SELECT v FROM probe_ids WHERE k = 'account');
  fired     boolean := false;
  msg       text    := '';
BEGIN
  BEGIN
    INSERT INTO admin_actions (actor, action, subject_kind, subject_id, reason,
                               before, after, initiative)
      VALUES ('someone.who.does.not.work.here', 'replay.rewrite_approved',
              'account', v_account, 'a reason that explains nothing about who',
              '{}'::jsonb, '{}'::jsonb, 'operational');
  EXCEPTION WHEN foreign_key_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 15 FAILED: an audit row named an actor in no directory';
  END IF;
  IF position('admin_actions_actor_is_an_operator' in msg) = 0 THEN
    RAISE EXCEPTION 'REJECTION 15 fired for the wrong reason: %', msg;
  END IF;

  -- A SUSPENDED OPERATOR IS STILL A REFERENT AND THIS CONSTRAINT DOES NOT READ
  -- THE STATUS, which is stated here so a later reader does not mistake the
  -- foreign key for an authorization control. Refusing a suspended operator is
  -- `resolveOperatorSession`'s job at the door; the database's job is that the
  -- name resolves at all, and an operator who acted and was later suspended
  -- must keep every row they wrote.
  UPDATE operators SET status = 'suspended' WHERE actor = 'founder';
  INSERT INTO admin_actions (actor, action, subject_kind, subject_id, reason,
                             before, after, initiative)
    VALUES ('founder', 'replay.rewrite_approved', 'account', v_account,
            'a suspended operator keeps the rows they already wrote',
            '{}'::jsonb, '{}'::jsonb, 'operational');
  UPDATE operators SET status = 'active' WHERE actor = 'founder';

  RAISE NOTICE 'REJECTION 15: %', msg;
END $$;

\echo 'probe_audited_writes: 8 successes and 16 rejections hold against the applied schema.'

ROLLBACK;
