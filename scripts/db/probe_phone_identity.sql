-- =============================================================================
-- Probe: ADR-039's phone identity and passwordless auth (0029). OI-07.
-- =============================================================================
-- DELTA_MANIFEST section 14 records forty-eight assertions EXECUTED against the
-- installed schema on 2026-08-16. They ran ad hoc and were never committed, so
-- they were the exact object section 13 names: a probe that ships beside a fix
-- and never runs again is the same thing as the golden test that was missing.
-- This file is those assertions, wired into CI-06h. That is OI-07.
--
-- IT LEADS WITH THE SUCCESS CASE, and that is the transferable part.
--
-- Every probe in section 10 attempted a forbidden thing and asserted a
-- rejection, so EVERY ONE OF THEM PASSES AGAINST A GUARD THAT REJECTS
-- EVERYTHING. A constraint that refuses all writes satisfies an inventory of
-- refusals perfectly. The permissions below are what that inventory could not
-- see from inside itself, and on this migration the permissions are the
-- load-bearing half: 0029's central ruling is something the database must NOT
-- refuse.
--
-- SUCCESS 2 IS THE ONE TO READ. ADR-039 splits the hard link in two:
-- identity -> phone is a database constraint, and phone -> identity is
-- DELIBERATELY NOT. A second identity verifying a number already live on the
-- first COMPLETES, writes the edge at the hard-link ceiling, and opens a
-- severity-5 flag against both. A reader who "finishes the pair" by making
-- phone_hash unique would refuse the innocent owner of a recycled number at the
-- door, before the portability check that exists to rescue them can run. The
-- missing index is how amendment 3 is honoured, and an absence is invisible in
-- a diff: nothing in the file says "no unique index here". SUCCESS 2 is what
-- says it, and it fails loudly the day somebody completes the pair.
--
-- REJECTIONS ARE CHECKED BY THE CONSTRAINT THAT FIRED, never by exception
-- class. Before 0028 a retirement raised undefined_column and a handler
-- catching "any error" scored that as the constraint working, which is exactly
-- how ADR-035's defect survived a founder-grade review and a 27-file install
-- check. The helpers below read CONSTRAINT_NAME out of GET STACKED DIAGNOSTICS
-- and compare it to the name the assertion names, so a write refused by the
-- WRONG constraint fails this probe rather than passing it.
--
-- THE HELPERS EXIST FOR THAT REASON AND NOT FOR BREVITY. Twenty-five
-- hand-rolled EXCEPTION handlers is twenty-five chances to write
-- `WHEN others THEN RAISE NOTICE 'rejected'`, which is the defect above with
-- the lesson already learned and written down. One helper that mechanically
-- compares the constraint name cannot drift assertion by assertion.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A write that MUST be accepted. The failure message says so, because a probe
-- reporting "something went wrong" on a permission case reads as a broken
-- fixture and gets fixed by loosening the fixture.
CREATE FUNCTION pg_temp.permitted(label text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'PERMITTED  %', label;
EXCEPTION WHEN others THEN
  RAISE EXCEPTION
    'PROBE FAILED (%): this MUST be permitted and the database refused it: % (%)',
    label, SQLERRM, SQLSTATE;
END
$fn$;

-- A write that must be refused BY A NAMED CONSTRAINT. Refused by a different
-- one is a failure, not a pass.
CREATE FUNCTION pg_temp.rejected(label text, stmt text, want_constraint text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS got = CONSTRAINT_NAME;
    IF coalesce(got, '') <> want_constraint THEN
      RAISE EXCEPTION
        'PROBE FAILED (%): expected "%" to refuse this; it was refused by "%" '
        'instead: % (%)',
        label, want_constraint, coalesce(nullif(got, ''), '<none>'),
        SQLERRM, SQLSTATE;
    END IF;
    RAISE NOTICE 'REJECTED   %  <- %', label, got;
    RETURN;
  END;
  RAISE EXCEPTION
    'PROBE FAILED (%): the write was ACCEPTED. % did not fire.',
    label, want_constraint;
END
$fn$;

-- A write refused by something that carries no constraint name: a NOT NULL, or
-- a GENERATED ALWAYS column. Matched on SQLSTATE plus a message fragment, so a
-- different error at the same statement still fails.
CREATE FUNCTION pg_temp.rejected_by_message(
  label text, stmt text, want_sqlstate text, want_needle text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    IF SQLSTATE <> want_sqlstate OR position(want_needle in SQLERRM) = 0 THEN
      RAISE EXCEPTION
        'PROBE FAILED (%): expected % containing "%"; got %: %',
        label, want_sqlstate, want_needle, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTED   %  <- % %', label, SQLSTATE, want_needle;
    RETURN;
  END;
  RAISE EXCEPTION
    'PROBE FAILED (%): the write was ACCEPTED and nothing refused it.', label;
END
$fn$;

-- The helpers return void, so every call below would print an empty result set
-- and bury forty-eight NOTICE lines in three hundred lines of table borders.
-- NOTICEs go to stderr and are unaffected; this hides only the empty rows.
\o /dev/null

-- ---------------------------------------------------------------------------
-- Fixtures. TWO identities, because the ruling is about two of them holding one
-- number, and one shared phone hash so the collision is real rather than staged.
-- ---------------------------------------------------------------------------
INSERT INTO identities (id, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'active'),
  ('a2000000-0000-0000-0000-000000000002', 'active');

INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('b1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'First@Example.test',  'first@example.test'),
  ('b2000000-0000-0000-0000-000000000002',
   'a2000000-0000-0000-0000-000000000002',
   'Second@Example.test', 'second@example.test');

-- =============================================================================
-- identity_phones                                                  SD-M19-05
-- =============================================================================

-- SUCCESS 1: an identity verifies a phone at registration.
SELECT pg_temp.permitted(
  'S1  an identity verifies a phone at registration',
  $q$
  INSERT INTO identity_phones (id, identity_id, phone_hash, country_code,
                               verified_at, line_type, carrier_name,
                               lookup_provider, lookup_at)
  VALUES ('c1000000-0000-0000-0000-000000000001',
          'a1000000-0000-0000-0000-000000000001',
          '\x5348415245440000'::bytea, 'US', now(), 'mobile', 'probe-carrier',
          'probe-vendor', now());
  $q$);

-- ---------------------------------------------------------------------------
-- SUCCESS 2: A SECOND IDENTITY VERIFIES A NUMBER ALREADY LIVE ON THE FIRST
-- ---------------------------------------------------------------------------
-- THE RULING. ADR-039 (b), amendment 3, and header item 1 of 0029. This MUST
-- complete. If it ever starts failing, the recycling guard is dead and the
-- innocent owner of a reassigned number is in a support ticket instead of
-- through the door.
SELECT pg_temp.permitted(
  'S2  A SECOND IDENTITY VERIFIES A NUMBER ALREADY LIVE ON THE FIRST (the ruling)',
  $q$
  INSERT INTO identity_phones (id, identity_id, phone_hash, country_code,
                               verified_at, line_type)
  VALUES ('c2000000-0000-0000-0000-000000000002',
          'a2000000-0000-0000-0000-000000000002',
          '\x5348415245440000'::bytea, 'US', now(), 'mobile');
  $q$);

-- Completing is only half of the ruling. The other half is that the collision
-- is DETECTABLE: identity_phones_live_number_idx serves the read that decides
-- whether to raise the flag, "is this number live on somebody else right now".
-- A schema that permitted the insert but could not see the collision would
-- satisfy the assertion above and still leave the flag unraisable.
DO $$
DECLARE
  live_holders integer;
BEGIN
  SELECT count(DISTINCT identity_id) INTO live_holders
    FROM identity_phones
   WHERE phone_hash = '\x5348415245440000'::bytea
     AND verified_at IS NOT NULL
     AND superseded_at IS NULL
     AND released_at IS NULL;

  IF live_holders <> 2 THEN
    RAISE EXCEPTION
      'PROBE FAILED (S2): the live-number read sees % identities holding the '
      'shared number, expected 2. The hard-link collision is undetectable and '
      'the severity-5 flag has no input.', live_holders;
  END IF;
  RAISE NOTICE 'PERMITTED  S2b the live-number read sees both holders (flag has its input)';
END $$;

-- And the flag itself is writable against both. ADR-039 rules that raising it
-- is APPLICATION LOGIC and not a trigger, because a trigger that opens a flag
-- IS automatic state; what the database owes is somewhere for it to land.
SELECT pg_temp.permitted(
  'S2c the severity-5 hard-link flag opens against both identities',
  $q$
  INSERT INTO risk_flags (identity_id, flag_type, severity, evidence,
                          first_detected_on, sla_due_at)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'phone_hard_link', 5,
          '{"shared_with":"a2000000-0000-0000-0000-000000000002"}'::jsonb,
          current_date, now() + interval '48 hours'),
         ('a2000000-0000-0000-0000-000000000002', 'phone_hard_link', 5,
          '{"shared_with":"a1000000-0000-0000-0000-000000000001"}'::jsonb,
          current_date, now() + interval '48 hours');
  $q$);

-- REJECTION 1: the half of the hard link that IS a constraint. One live
-- verified phone per identity.
SELECT pg_temp.rejected(
  'R1  the same identity verifies a second live phone',
  $q$
  INSERT INTO identity_phones (identity_id, phone_hash, country_code, verified_at)
  VALUES ('a1000000-0000-0000-0000-000000000001',
          '\x4f5448455200000000'::bytea, 'US', now());
  $q$,
  'identity_phones_live_per_identity_uq');

-- REJECTION 2: a release is an evidenced decision or it is not a release.
SELECT pg_temp.rejected(
  'R2  a release with no evidence',
  $q$
  UPDATE identity_phones SET released_at = now()
   WHERE id = 'c1000000-0000-0000-0000-000000000001';
  $q$,
  'identity_phones_release_is_evidenced');

-- SUCCESS 3: A RELEASED ROW FREES THE LIVE INDEX. Amendment 3's whole point:
-- the identity whose number was reassigned verifies a new one with no operator
-- unpicking anything.
SELECT pg_temp.permitted(
  'S3  an evidenced release, and the identity then verifies a new number',
  $q$
  UPDATE identity_phones
     SET released_at = now(),
         release_evidence = '{"portability":"number left this identity"}'::jsonb
   WHERE id = 'c1000000-0000-0000-0000-000000000001';
  $q$);

SELECT pg_temp.permitted(
  'S3b the released row freed identity_phones_live_per_identity_uq',
  $q$
  INSERT INTO identity_phones (id, identity_id, phone_hash, country_code,
                               verified_at)
  VALUES ('c3000000-0000-0000-0000-000000000003',
          'a1000000-0000-0000-0000-000000000001',
          '\x4e45570000000000'::bytea, 'US', now());
  $q$);

-- REJECTION 3: supersession and release are different endings and a row has at
-- most one. Conflating them loses the only distinction amendment 3 turns on.
SELECT pg_temp.rejected(
  'R3  a row both superseded and released',
  $q$
  UPDATE identity_phones
     SET superseded_at = now(),
         superseded_by = 'c3000000-0000-0000-0000-000000000003'
   WHERE id = 'c1000000-0000-0000-0000-000000000001';
  $q$,
  'identity_phones_one_ending');

-- REJECTION 4: a port date implies the port flag.
SELECT pg_temp.rejected(
  'R4  a port date with no port flag',
  $q$
  UPDATE identity_phones SET last_ported_at = now()
   WHERE id = 'c3000000-0000-0000-0000-000000000003';
  $q$,
  'identity_phones_port_date_implies_ported');

-- SUCCESS 4: the converse is DELIBERATELY not asserted. A vendor may report
-- that a number was ported without saying when, and that is exactly the state
-- the recycling guard cannot resolve, so it routes to review. Forbidding it
-- would force the writer to invent a date, which is worse than recording that
-- the date is missing.
SELECT pg_temp.permitted(
  'S4  ported = true with no date, the case the guard cannot resolve',
  $q$
  UPDATE identity_phones SET ported = true
   WHERE id = 'c3000000-0000-0000-0000-000000000003';
  $q$);

-- REJECTION 5: a lookup that happened has a provider.
SELECT pg_temp.rejected(
  'R5  a lookup timestamp with no provider',
  $q$
  UPDATE identity_phones SET lookup_at = now()
   WHERE id = 'c3000000-0000-0000-0000-000000000003';
  $q$,
  'identity_phones_lookup_is_attributed');

-- SUCCESS 5: VOIP AT CAPTURE. Scored, never rejected. There is no CHECK
-- anywhere in 0029 that could refuse a line type, and that absence is the
-- ruling: the call site inherits checkout's failure posture verbatim.
SELECT pg_temp.permitted(
  'S5  VoIP at capture is scored and never rejected',
  $q$
  INSERT INTO identity_phones (identity_id, phone_hash, country_code,
                               line_type, footprint_present)
  VALUES ('a2000000-0000-0000-0000-000000000002',
          '\x564f495000000000'::bytea, 'US', 'voip', false);
  $q$);

-- =============================================================================
-- phone_change_requests                                            SD-M19-06
-- =============================================================================
-- The ceremony as state. (c) names three controls and all three are a
-- precondition of reaching 'applied'.

INSERT INTO phone_change_requests (id, identity_id, old_phone_id,
                                   new_phone_hash)
VALUES ('d1000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001',
        'c3000000-0000-0000-0000-000000000003',
        '\x4348414e474544'::bytea);

-- REJECTION 6: applying with no dual-channel verification. (d), never SMS alone.
SELECT pg_temp.rejected(
  'R6  applying a phone change with no dual-channel verification',
  $q$
  UPDATE phone_change_requests
     SET state = 'applied', applied_at = now(),
         prior_notified_at = now(),
         withdrawal_hold_until = now() + interval '48 hours'
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_applied_is_complete');

-- REJECTION 7: applying with no prior-contact notification. INV-M16-03.
SELECT pg_temp.rejected(
  'R7  applying with no prior-contact notification',
  $q$
  UPDATE phone_change_requests
     SET state = 'applied', applied_at = now(),
         dual_channel_verified_at = now(),
         withdrawal_hold_until = now() + interval '48 hours'
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_applied_is_complete');

-- REJECTION 8: AN ALREADY-EXPIRED HOLD. The database does not assert the 48
-- hour DURATION, which is a launch parameter the config owns (ADR-037). It
-- asserts the ORDERING, which is the part a config cannot get wrong: a hold
-- that expired before the change landed is not a hold.
SELECT pg_temp.rejected(
  'R8  applying with an already-expired withdrawal hold',
  $q$
  UPDATE phone_change_requests
     SET state = 'applied', applied_at = now(),
         dual_channel_verified_at = now(),
         prior_notified_at = now(),
         withdrawal_hold_until = now() - interval '1 hour'
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_applied_is_complete');

-- SUCCESS 6: all three D4 controls and a running hold.
SELECT pg_temp.permitted(
  'S6  applying with all three D4 controls and a running hold',
  $q$
  UPDATE phone_change_requests
     SET state = 'applied', applied_at = now(),
         dual_channel_verified_at = now(),
         prior_notified_at = now(),
         withdrawal_hold_until = now() + interval '48 hours'
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$);

-- REJECTION 9: at most one OPEN request per identity. A second open request is
-- not a second ceremony, it is a way to run two holds and pick the shorter one.
-- The applied request above no longer occupies the partial index, so this needs
-- two fresh ones to test what it claims to test.
SELECT pg_temp.permitted(
  'S6b an applied request frees the open-request index',
  $q$
  INSERT INTO phone_change_requests (id, identity_id, old_phone_id,
                                     new_phone_hash)
  VALUES ('d2000000-0000-0000-0000-000000000002',
          'a1000000-0000-0000-0000-000000000001',
          'c3000000-0000-0000-0000-000000000003',
          '\x4348414e474532'::bytea);
  $q$);

SELECT pg_temp.rejected(
  'R9  a second open change request for one identity',
  $q$
  INSERT INTO phone_change_requests (identity_id, old_phone_id, new_phone_hash)
  VALUES ('a1000000-0000-0000-0000-000000000001',
          'c3000000-0000-0000-0000-000000000003',
          '\x4348414e474533'::bytea);
  $q$,
  'phone_change_requests_open_per_identity_uq');

-- REJECTION 10: an unexplained cancellation on a control this shape is
-- indistinguishable from an attacker abandoning a probe.
SELECT pg_temp.rejected(
  'R10 an unexplained cancellation',
  $q$
  UPDATE phone_change_requests
     SET state = 'cancelled', cancelled_at = now()
   WHERE id = 'd2000000-0000-0000-0000-000000000002';
  $q$,
  'phone_change_requests_cancellation_is_explained');

-- =============================================================================
-- sessions                                                          SD-M4-04
-- =============================================================================
-- C-27, amendment 4. Any single factor logs in; no single factor elevates.

-- SUCCESS 7: an SMS-established session. Every read surface, and nothing more.
SELECT pg_temp.permitted(
  'S7  an SMS-established session logs in',
  $q$
  INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, auth_factor)
  VALUES ('e1000000-0000-0000-0000-000000000001',
          'b1000000-0000-0000-0000-000000000001',
          '\x53455353494f4e31'::bytea, now() + interval '30 days', 'sms_otp');
  $q$);

-- REJECTION 11: THE CHECK LIST IS THE ENFORCEMENT. There is no 'sms_otp' in
-- elevated_by_factor, so a SIM-swapped session cannot elevate itself: the
-- database has no value for the thing such a handler would have to write.
-- C-27 is a VOCABULARY, not a rule somebody remembers.
SELECT pg_temp.rejected(
  'R11 elevating that session by SMS (C-27 is a vocabulary)',
  $q$
  UPDATE sessions SET elevated_at = now(), elevated_by_factor = 'sms_otp'
   WHERE id = 'e1000000-0000-0000-0000-000000000001';
  $q$,
  'sessions_elevated_by_factor_check');

-- SUCCESS 8: elevating the same session by dual channel.
SELECT pg_temp.permitted(
  'S8  elevating the same session by dual channel',
  $q$
  UPDATE sessions SET elevated_at = now(), elevated_by_factor = 'dual_channel'
   WHERE id = 'e1000000-0000-0000-0000-000000000001';
  $q$);

-- REJECTION 12: an elevation with no factor recorded is an elevation nobody can
-- audit.
SELECT pg_temp.rejected(
  'R12 an elevation with no factor recorded',
  $q$
  UPDATE sessions SET elevated_by_factor = NULL
   WHERE id = 'e1000000-0000-0000-0000-000000000001';
  $q$,
  'sessions_elevation_is_complete');

-- REJECTION 13: NOT NULL. Amendment 4 is unenforceable if a session may decline
-- to say how it was established.
SELECT pg_temp.rejected_by_message(
  'R13 a session with no auth_factor',
  $q$
  INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
  VALUES ('b1000000-0000-0000-0000-000000000001',
          '\x53455353494f4e32'::bytea, now() + interval '30 days');
  $q$,
  '23502', 'auth_factor');

-- =============================================================================
-- otp_challenges                                                    SD-M16-05
-- =============================================================================

-- SUCCESS 9: an SMS challenge, and an email challenge unchanged from 0002.
SELECT pg_temp.permitted(
  'S9  an SMS challenge and an email challenge, both permitted',
  $q$
  INSERT INTO otp_challenges (code_hash, expires_at, channel, destination_hash)
  VALUES ('\x434f444531'::bytea, now() + interval '10 minutes', 'sms',
          '\x5348415245440000'::bytea);
  INSERT INTO otp_challenges (code_hash, expires_at, channel, email_normalized)
  VALUES ('\x434f444532'::bytea, now() + interval '10 minutes', 'email',
          'first@example.test');
  $q$);

-- REJECTION 14 and 15: exactly one destination, both ways. Two destinations is
-- a code delivered twice, which halves the work of intercepting it; zero is a
-- challenge nobody can answer.
SELECT pg_temp.rejected(
  'R14 a challenge with BOTH destinations',
  $q$
  INSERT INTO otp_challenges (code_hash, expires_at, channel,
                              email_normalized, destination_hash)
  VALUES ('\x434f444533'::bytea, now() + interval '10 minutes', 'sms',
          'first@example.test', '\x5348415245440000'::bytea);
  $q$,
  'otp_challenges_exactly_one_destination');

SELECT pg_temp.rejected(
  'R15 a challenge with NEITHER destination',
  $q$
  INSERT INTO otp_challenges (code_hash, expires_at, channel)
  VALUES ('\x434f444534'::bytea, now() + interval '10 minutes', 'sms');
  $q$,
  'otp_challenges_exactly_one_destination');

-- =============================================================================
-- otp_send_budget                                                   SD-M16-04
-- =============================================================================

-- SUCCESS 10: an armed budget row.
SELECT pg_temp.permitted(
  'S10 an armed budget row',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents)
  VALUES ('phone', 'deadbeef', current_date, 5, 50000);
  $q$);

-- ---------------------------------------------------------------------------
-- REJECTION 16: THERE IS NO STOPPING STATE, AND THAT IS THE FOUNDER'S RULING
-- ---------------------------------------------------------------------------
-- 0016's plan_breaker_state, whose pattern this table otherwise copies, has a
-- 'paused'. This one deliberately does not. Phone verification is mandatory at
-- registration, so a breaker that STOPS means no new customers: the control
-- protecting the SMS bill becomes a cheap denial of service on revenue, tripped
-- at the price of the traffic that trips it. On trip, registration CONTINUES
-- and verification defers to ADR-021's pre_funded gate.
--
-- An omission and a ruling look identical in a CHECK list. This assertion is
-- what tells them apart, and it fails the day somebody adds the fourth value.
SELECT pg_temp.rejected(
  'R16 a budget row in a state named paused (there is NO stopping state)',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents, state)
  VALUES ('ip', '203.0.113.7', current_date, 5, 50000, 'paused');
  $q$,
  'otp_send_budget_state_check');

-- REJECTION 17: A SILENT TRIP IS NOT WRITABLE. A degraded mode nobody is
-- watching becomes the normal mode.
SELECT pg_temp.rejected(
  'R17 a silent trip',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents, state, tripped_at)
  VALUES ('country', 'US', current_date, 5, 50000, 'degraded', now());
  $q$,
  'otp_send_budget_degraded_is_alarmed');

-- SUCCESS 11: a trip that raises its alarm, carrying the deferral count. ADR-039
-- requires the number of registrations completing unverified during a degraded
-- window to be reported, because a queue nobody drains is a fail-open with
-- extra steps.
SELECT pg_temp.permitted(
  'S11 a trip that raises its alarm, with its deferred-registration count',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents, state, tripped_at,
                               alarm_raised_at, deferred_registrations)
  VALUES ('global', 'global', current_date, 10000, 500000, 'degraded', now(),
          now(), 37);
  $q$);

-- REJECTION 18: deferred registrations with no trip behind them. Either the
-- count is wrong or registrations are being deferred by something nobody
-- declared.
SELECT pg_temp.rejected(
  'R18 deferred registrations with no trip behind them',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents,
                               deferred_registrations)
  VALUES ('country', 'GB', current_date, 5, 50000, 4);
  $q$,
  'otp_send_budget_deferrals_have_a_trip');

-- REJECTION 19: one global row per day, not one per spelling of the word.
SELECT pg_temp.rejected(
  'R19 a second global row under another spelling',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents)
  VALUES ('global', 'GLOBAL', current_date, 10000, 500000);
  $q$,
  'otp_send_budget_global_is_singular');

-- REJECTION 20: an indefinite override is a disabled breaker with a nicer name.
SELECT pg_temp.rejected(
  'R20 an override with no expiry',
  $q$
  INSERT INTO otp_send_budget (scope_kind, scope_key, evaluated_on,
                               send_limit, budget_cents, state,
                               override_reason, changed_by)
  VALUES ('ip', '203.0.113.9', current_date, 5, 50000, 'manually_overridden',
          'vendor incident', 'ops@merit.test');
  $q$,
  'otp_send_budget_override_is_complete');

-- =============================================================================
-- contact_channels                                                  SD-M16-06
-- =============================================================================
-- FOLD-01 finding 4. (c) is UNBUILDABLE without this: "notify the prior number"
-- had nothing to notify, because 0019 wrote kind IN ('email','push').

SELECT pg_temp.permitted(
  'S12 contact_channels accepts an SMS destination',
  $q$
  INSERT INTO contact_channels (identity_id, kind, value_hash)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'sms',
          '\x5348415245440000'::bytea);
  $q$);

SELECT pg_temp.rejected(
  'R21 contact_channels still refuses an invented kind',
  $q$
  INSERT INTO contact_channels (identity_id, kind, value_hash)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'fax', '\x464158'::bytea);
  $q$,
  'contact_channels_kind_allowed');

-- =============================================================================
-- identity_signals                                                  U-07
-- =============================================================================
-- Two kinds and not one: 'phone' is a HIGH-WEIGHT node because real mobile
-- numbers are scarce, and 'phone_carrier' is a WEAK node only worth anything in
-- a composite. Every prepaid VoIP number on one carrier is not a ring, and
-- treating it as one would flag a country rather than a fleet.

SELECT pg_temp.permitted(
  'S13 identity_signals accepts phone and phone_carrier',
  $q$
  INSERT INTO identity_signals (identity_id, kind, value_hash)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'phone',
          '\x5348415245440000'::bytea),
         ('a1000000-0000-0000-0000-000000000001', 'phone_carrier',
          '\x4341525249455200'::bytea);
  $q$);

SELECT pg_temp.rejected(
  'R22 identity_signals still refuses an invented kind',
  $q$
  INSERT INTO identity_signals (identity_id, kind, value_hash)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'phone_vibes',
          '\x5649424553'::bytea);
  $q$,
  'identity_signals_kind_allowed');

-- =============================================================================
-- notification_kinds                                                SD-M16-07
-- =============================================================================
-- Amendment 2, made structural the way SD-M16-01 already made `mutable`
-- structural.

SELECT pg_temp.permitted(
  'S14 a pre_identity_auth kind is writable',
  $q$
  INSERT INTO notification_kinds (kind, class, title, template_code)
  VALUES ('registration_otp', 'pre_identity_auth', 'Your code', 'tpl_reg_otp');
  $q$);

-- SUCCESS 14b: THE GENERATED COLUMNS READ BACK CORRECTLY, which is the whole
-- point of generating them. As an ordinary boolean, one seed row marking the
-- registration-OTP kind exempt would restore SMS pumping and nothing would
-- object. And `mutable` gives the right answer for the new class WITHOUT being
-- touched: pre_identity_auth is not in ('account_state','marketing'), so nobody
-- may opt out of the OTP proving they own the number they are registering.
DO $$
DECLARE
  exempt  boolean;
  mut     boolean;
BEGIN
  SELECT rate_limit_exempt, mutable INTO exempt, mut
    FROM notification_kinds WHERE kind = 'registration_otp';

  IF exempt IS NOT false THEN
    RAISE EXCEPTION
      'PROBE FAILED (S14b): pre_identity_auth reads rate_limit_exempt = %, '
      'expected false. Amendment 2 is what refuses SMS pumping and it is '
      'supposed to hold BY CONSTRUCTION.', exempt;
  END IF;
  IF mut IS NOT false THEN
    RAISE EXCEPTION
      'PROBE FAILED (S14b): pre_identity_auth reads mutable = %, expected '
      'false. A trader could silence the OTP proving they own the number '
      'they are registering.', mut;
  END IF;
  RAISE NOTICE 'PERMITTED  S14b pre_identity_auth: rate_limit_exempt = false, mutable = false';
END $$;

-- SUCCESS 15: INV-M16-11 IS CONFIRMED AND NOT AMENDED, in those words. The
-- security class stays exempt. "Confirmed rather than amended" has to mean
-- something in the database or it is a sentence in a document.
DO $$
DECLARE
  exempt boolean;
BEGIN
  INSERT INTO notification_kinds (kind, class, title, template_code)
  VALUES ('probe_security_kind', 'security', 'Passkey added', 'tpl_sec');

  SELECT rate_limit_exempt INTO exempt
    FROM notification_kinds WHERE kind = 'probe_security_kind';

  IF exempt IS NOT true THEN
    RAISE EXCEPTION
      'PROBE FAILED (S15): the security class reads rate_limit_exempt = %, '
      'expected true. INV-M16-11 was confirmed, not amended.', exempt;
  END IF;
  RAISE NOTICE 'PERMITTED  S15 the security class still reads rate_limit_exempt = true (INV-M16-11)';
END $$;

-- REJECTION 23: GENERATED ALWAYS. The two facts cannot be made to disagree.
SELECT pg_temp.rejected_by_message(
  'R23 writing rate_limit_exempt directly',
  $q$
  UPDATE notification_kinds SET rate_limit_exempt = true
   WHERE kind = 'registration_otp';
  $q$,
  '428C9', 'rate_limit_exempt');

-- REJECTION 24: AN OTP IS NEVER COALESCED. Three OTP requests are three codes,
-- and collapsing a burst of them into one message delivers one code for three
-- challenges, which is a broken login rather than a tidy inbox.
SELECT pg_temp.rejected(
  'R24 coalescing a pre-identity kind',
  $q$
  UPDATE notification_kinds SET coalesce_key_spec = 'identity_id'
   WHERE kind = 'registration_otp';
  $q$,
  'notification_kinds_immutable_never_coalesced');

-- =============================================================================
-- kyc_verifications                                                 SD-M19-07
-- =============================================================================

INSERT INTO kyc_verifications (id, identity_id, provider, provider_applicant_id,
                               state, placement, verification_purpose)
VALUES ('f1000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001', 'probe-provider', 'applicant-1',
        'verified', 'pre_funded', 'initial');

SELECT pg_temp.permitted(
  'S16 reverify_phone_change superseding an initial verification',
  $q$
  INSERT INTO kyc_verifications (identity_id, provider, provider_applicant_id,
                                 state, placement, verification_purpose,
                                 supersedes)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'probe-provider',
          'applicant-1', 'verified', 'pre_funded', 'reverify_phone_change',
          'f1000000-0000-0000-0000-000000000001');
  $q$);

-- REJECTION 25: refused by a constraint 0003 wrote against the SHAPE rather
-- than against a list, so it binds a value that did not exist when it was
-- written. That is what a constraint written against the shape buys, and it is
-- worth naming because the alternative would have needed a line in 0029.
SELECT pg_temp.rejected(
  'R25 reverify_phone_change superseding nothing',
  $q$
  INSERT INTO kyc_verifications (identity_id, provider, provider_applicant_id,
                                 state, placement, verification_purpose)
  VALUES ('a1000000-0000-0000-0000-000000000001', 'probe-provider',
          'applicant-2', 'verified', 'pre_funded', 'reverify_phone_change');
  $q$,
  'kyc_verifications_supersession_matches_purpose');

-- =============================================================================
-- The absence that is the ruling, asserted as an absence
-- =============================================================================
-- SUCCESS 2 proves a second identity CAN verify a live number. This proves WHY,
-- and it is the assertion that catches the change before it reaches a customer:
-- a later session "completing the pair" would add a unique index on phone_hash,
-- and it would look like tightening a constraint rather than reversing
-- amendment 3.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(i.relname, ', ') INTO offending
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey)
   WHERE t.relname = 'identity_phones'
     AND a.attname = 'phone_hash'
     AND x.indisunique;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: identity_phones.phone_hash carries a UNIQUE index (%). '
      'ADR-039 rules the phone -> identity half of the hard link is NOT a '
      'database constraint. A unique index here refuses the innocent owner of '
      'a recycled number at the door, before the portability check that exists '
      'to rescue them can run (amendment 3). Reversing that needs an ADR, not '
      'an index.', offending;
  END IF;
  RAISE NOTICE 'PERMITTED  A1  phone_hash carries NO unique index (amendment 3 intact)';
END $$;

-- And the state vocabulary, asserted as a set rather than one probe value.
-- R16 catches 'paused'; this catches 'halted', 'stopped' and every other
-- spelling of the ruling somebody might add later.
DO $$
DECLARE
  states text;
BEGIN
  SELECT string_agg(v, ', ' ORDER BY v) INTO states
    FROM (
      SELECT unnest(regexp_matches(
               pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g')) AS v
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'otp_send_budget'
         AND c.conname = 'otp_send_budget_state_check'
    ) s;

  IF states <> 'armed, degraded, manually_overridden' THEN
    RAISE EXCEPTION
      'PROBE FAILED: otp_send_budget.state now admits [%], expected exactly '
      '[armed, degraded, manually_overridden]. There is deliberately no '
      'stopping state: phone verification is mandatory at registration, so a '
      'breaker that stops is a denial of service on customer acquisition. '
      'That is a founder ruling and it cannot be reversed with one word.',
      states;
  END IF;
  RAISE NOTICE 'PERMITTED  A2  otp_send_budget.state is still exactly three values, none of them stopping';
END $$;

ROLLBACK;

\o
\echo 'probe_phone_identity: every success case succeeded and every rejection fired for its own reason.'
