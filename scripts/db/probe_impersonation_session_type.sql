-- =============================================================================
-- Probe: ADR-068's IMPERSONATION-C1, C2 and C3, installed by 0042.
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASES, on the lesson DELTA_MANIFEST section 13
-- records and section 18 repeated: every probe that only ever attempts
-- forbidden things passes against a guard that rejects everything. A trigger
-- that refused ALL impersonation writes would satisfy an inventory of
-- refusals perfectly, and would also mean support can never open a session.
--
-- THE SUCCESS HALF IS UNUSUALLY LOAD BEARING HERE, and 0034's finding is why.
-- That probe had NO success case on identity_phones, so a CHECK reading
-- `phone_ciphertext IS NULL` passed all thirty-two of its assertions and
-- reported nothing. IMPERSONATION-C1 is a cross-table EXISTS: a trigger body
-- that raised unconditionally, or a mirror pointed at the wrong column, is
-- invisible to a rejection-only probe and would take the trader auth path down
-- with it. S1 to S5 are what separate "the boundary holds" from "nothing works".
--
-- Rejections are checked BY MESSAGE, never by exception class. All five raise
-- check_violation, so a handler catching the class cannot tell C1 from its
-- mirror from C2 from the box ceiling, and any one of them could be deleted
-- with every rejection test still passing.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- identities_status_is_explained (0002:73) requires a status_reason on any
-- identity that is not `active`, so the restricted fixture carries one. Found
-- by running this probe rather than by reading the table.
INSERT INTO identities (id, status, status_reason) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'active', NULL),
  ('aa000000-0000-0000-0000-000000000002', 'restricted',
   'Probe fixture: GS-302 needs a restricted identity to impersonate.');

INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000001',
   'aa000000-0000-0000-0000-000000000001',
   'Trader@Example.test', 'trader@example.test'),
  ('bb000000-0000-0000-0000-000000000002',
   'aa000000-0000-0000-0000-000000000002',
   'Admin@Example.test', 'admin@example.test');

-- A live trader session, so the boundary has something real to collide with.
-- auth_factor is NOT NULL and is 0029's, not 0002's: reading the CREATE TABLE
-- alone does not show it, and this probe found that by being run.
INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, auth_factor) VALUES
  ('cc000000-0000-0000-0000-000000000001',
   'bb000000-0000-0000-0000-000000000001',
   '\x1111111111111111111111111111111111111111111111111111111111111111',
   now() + interval '30 days', 'passkey');

-- ---------------------------------------------------------------------------
-- SUCCESS CASES FIRST
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- S1. THE ORDINARY CASE. A support session opens against an active identity
  -- with a distinct token. If this fails, the guard refuses everything and
  -- every rejection below is vacuous.
  INSERT INTO impersonation_sessions
    (id, admin_user_id, subject_identity_id, token_hash, reason_code,
     reason_detail, started_at, expires_at)
  VALUES
    ('dd000000-0000-0000-0000-000000000001',
     'bb000000-0000-0000-0000-000000000002',
     'aa000000-0000-0000-0000-000000000001',
     '\x2222222222222222222222222222222222222222222222222222222222222222',
     'trader_reported_display_issue',
     'Trader reports the payout panel renders an empty state.',
     now(), now() + interval '30 minutes');
  RAISE NOTICE 'S1: a support session opened against an active identity';

  -- S2. GS-302, AND IT IS A SUCCESS CASE ON PURPOSE. A `restricted` identity
  -- is IMPERSONABLE, because that is exactly when the trader calls. A
  -- constraint that blocked this would look like caution and would remove
  -- support from the only population that needs it.
  INSERT INTO impersonation_sessions
    (id, admin_user_id, subject_identity_id, token_hash, reason_code,
     reason_detail, started_at, expires_at)
  VALUES
    ('dd000000-0000-0000-0000-000000000002',
     'bb000000-0000-0000-0000-000000000002',
     'aa000000-0000-0000-0000-000000000002',
     '\x3333333333333333333333333333333333333333333333333333333333333333',
     'account_state_inquiry',
     'Restricted identity called about the restriction itself.',
     now(), now() + interval '30 minutes');
  RAISE NOTICE 'S2: GS-302, a restricted identity is impersonable';

  -- S3. A page view INSIDE the box is writable. C2's permissive side, and
  -- without it a trigger that rejected every view would pass R4 below.
  INSERT INTO impersonation_page_views
    (impersonation_session_id, route, viewed_at)
  VALUES
    ('dd000000-0000-0000-0000-000000000001',
     '/accounts/:accountId/payouts',
     now() + interval '5 minutes');
  RAISE NOTICE 'S3: a page view inside the box was recorded';

  -- S4. THE EXIT IS AN UPDATE AND IT MUST STILL WORK. 0042 revokes DELETE and
  -- KEEPS UPDATE on this table for exactly this write, and C1's trigger fires
  -- on UPDATE OF token_hash. A mirror written carelessly would refuse the row's
  -- own hash back to itself and make every session unclosable.
  UPDATE impersonation_sessions
     SET ended_at = now() + interval '10 minutes',
         ended_by = 'bb000000-0000-0000-0000-000000000002',
         end_reason = 'explicit_exit'
   WHERE id = 'dd000000-0000-0000-0000-000000000002';
  RAISE NOTICE 'S4: the explicit exit was recorded, so C1 did not block the one allowed update';

  -- S5. A NEW TRADER SESSION STILL OPENS. The mirror sits on sessions, which is
  -- the trader auth path's own table. If it is wrong, ordinary login breaks,
  -- and this is the assertion that separates "the boundary holds" from "the
  -- product is down".
  INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, auth_factor) VALUES
    ('cc000000-0000-0000-0000-000000000002',
     'bb000000-0000-0000-0000-000000000001',
     '\x4444444444444444444444444444444444444444444444444444444444444444',
     now() + interval '30 days', 'passkey');
  RAISE NOTICE 'S5: an ordinary trader session still opens with the mirror installed';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTIONS
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- R1. IMPERSONATION-C1, the direction everyone writes.
  BEGIN
    INSERT INTO impersonation_sessions
      (admin_user_id, subject_identity_id, token_hash, reason_code,
       reason_detail, started_at, expires_at)
    VALUES
      ('bb000000-0000-0000-0000-000000000002',
       'aa000000-0000-0000-0000-000000000001',
       '\x1111111111111111111111111111111111111111111111111111111111111111',
       'incident_investigation', 'Replay attempt.',
       now(), now() + interval '30 minutes');
    RAISE EXCEPTION 'PROBE FAILED: an impersonation token was minted onto an existing trader session hash';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%IMPERSONATION-C1:%trader%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the forward guard: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 1: C1 refused an impersonation token that already exists as a trader session hash';
  END;

  -- R2. THE MIRROR, AND IT IS THE ONE THAT MATTERS. Writing the sessions row
  -- SECOND is what a guard on one table alone cannot see: at the moment the
  -- impersonation row was checked, this trader row did not exist. If only R1
  -- were implemented, this INSERT would succeed and the impersonation token
  -- would resolve on the trader auth path, which is GS-303 exactly.
  BEGIN
    INSERT INTO sessions (user_id, refresh_token_hash, expires_at, auth_factor) VALUES
      ('bb000000-0000-0000-0000-000000000001',
       '\x2222222222222222222222222222222222222222222222222222222222222222',
       now() + interval '30 days', 'passkey');
    RAISE EXCEPTION 'PROBE FAILED: the ordering hole is open, a trader session took an impersonation token hash';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%IMPERSONATION-C1 (mirror)%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the mirror: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 2: the mirror closed the ordering hole a single-sided guard leaves open';
  END;

  -- R3. IMPERSONATION-C3, the ceiling. ADR-068 section 5: a configurable
  -- duration with no ceiling is a setting, not a time box.
  BEGIN
    INSERT INTO impersonation_sessions
      (admin_user_id, subject_identity_id, token_hash, reason_code,
       reason_detail, started_at, expires_at)
    VALUES
      ('bb000000-0000-0000-0000-000000000002',
       'aa000000-0000-0000-0000-000000000001',
       '\x5555555555555555555555555555555555555555555555555555555555555555',
       'incident_investigation', 'A long look.',
       now(), now() + interval '3 hours');
    RAISE EXCEPTION 'PROBE FAILED: a session was opened past the two hour ceiling';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%impersonation_box_is_bounded%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the ceiling: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 3: the box ceiling refused a three hour session';
  END;

  -- R4. IMPERSONATION-C2. A view after the box closed is UNWRITABLE, which is
  -- what makes a request served past expiry fail loudly rather than quietly.
  BEGIN
    INSERT INTO impersonation_page_views
      (impersonation_session_id, route, viewed_at)
    VALUES
      ('dd000000-0000-0000-0000-000000000001',
       '/accounts/:accountId/payouts',
       now() + interval '90 minutes');
    RAISE EXCEPTION 'PROBE FAILED: a page view was recorded after the session box closed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%IMPERSONATION-C2:%outside its session box%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the out-of-box view: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 4: C2 refused a page view recorded after expiry';
  END;

  -- R5. C2 READS THE EXIT AND NOT ONLY THE EXPIRY. Session dd..02 was exited at
  -- +10 minutes in S4 and its expires_at is +30. A view at +20 is inside
  -- expires_at and after the session ended, and LEAST(expires_at,
  -- COALESCE(ended_at, expires_at)) is the whole difference. A bound written as
  -- plain expires_at passes R4 and fails here.
  BEGIN
    INSERT INTO impersonation_page_views
      (impersonation_session_id, route, viewed_at)
    VALUES
      ('dd000000-0000-0000-0000-000000000002',
       '/accounts/:accountId',
       now() + interval '20 minutes');
    RAISE EXCEPTION 'PROBE FAILED: a page view was recorded after an explicit exit but before expiry';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%IMPERSONATION-C2:%outside its session box%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the post-exit view: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 5: C2 read the explicit exit rather than the expiry alone';
  END;

  -- R6. The exit is complete or it did not happen (0031:264's shape).
  BEGIN
    UPDATE impersonation_sessions
       SET ended_at = now() + interval '5 minutes'
     WHERE id = 'dd000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'PROBE FAILED: a session was ended by nobody for no reason';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%impersonation_exit_is_complete%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the incomplete exit: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 6: an exit with no actor and no reason was refused';
  END;

  -- R7. A blank reason_detail is the same nothing as a null one. btrim rather
  -- than <> '': three spaces passes the naive form.
  BEGIN
    INSERT INTO impersonation_sessions
      (admin_user_id, subject_identity_id, token_hash, reason_code,
       reason_detail, started_at, expires_at)
    VALUES
      ('bb000000-0000-0000-0000-000000000002',
       'aa000000-0000-0000-0000-000000000001',
       '\x6666666666666666666666666666666666666666666666666666666666666666',
       'billing_inquiry', '   ',
       now(), now() + interval '30 minutes');
    RAISE EXCEPTION 'PROBE FAILED: a session opened with a blank reason detail';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'REJECTION 7: a whitespace-only reason detail was refused';
  END;
END $$;

ROLLBACK;

\echo 'probe_impersonation_session_type: every success case succeeded and every rejection fired.'
