-- =============================================================================
-- Probe: ADR-046's reversible contact addresses and the dispatcher role (0034)
-- =============================================================================
-- OQ-M10-06. The finding 0034 closes is not "a column was missing", it is that
-- EVERY DOCUMENT CITING THE CONTROL CITED A CONTROL WHOSE INPUT DID NOT EXIST,
-- and that shape is invisible in a diff. So this file is written to fail if the
-- schema drifts back toward it.
--
-- IT LEADS WITH THE SUCCESS CASES, on probe_phone_identity.sql's discipline. A
-- probe that only attempts forbidden things passes perfectly against a guard
-- that refuses everything, and on THIS migration two of the load-bearing
-- assertions are permissions rather than refusals:
--
--   * S4 IS ERASURE, AND IT IS THE ONE TO READ. The founder's amendment took
--     DELETE away from the sending path on the grounds that erasure is a
--     privacy operation and not a send operation. That argument only holds if
--     erasure is expressible WITHOUT a DELETE. S4 is the proof: clearing the
--     three columns leaves the hash, the supersession lineage and the evidence
--     standing, and a NOT NULL on any of the three would have made DELETE the
--     only way to erase, on the tables that no longer have it.
--
--   * S5 IS THE WHOLE CEREMONY REACHING 'applied'. 0034 tightens the one
--     constraint standing between a phone change and a drained wallet. A
--     tightening that refuses the legitimate path is worse than the gap it
--     closed, because the gap at least let people change their number.
--
-- REJECTIONS ARE CHECKED BY THE CONSTRAINT THAT FIRED, never by exception
-- class, for the reason probe_phone_identity.sql records: before 0028 a
-- retirement raised undefined_column and a handler catching "any error" scored
-- that as the constraint working. The two trigger rejections carry no
-- constraint name, so they are matched on SQLSTATE plus a message fragment that
-- names WHICH leg failed: both legs raise check_violation from one function, so
-- a handler catching the class could not tell the SMS half from the email half
-- and either half could be deleted with every rejection still passing.
--
-- R9 IS THE ASSERTION THAT WOULD NOT EXIST IF THE TRIGGER HAD BEEN WRITTEN THE
-- OBVIOUS WAY. integration_dispatches.identity_id is NULLABLE (0018: not every
-- dispatch is about a person). `evidence_identity <> NEW.identity_id` yields
-- NULL against an unattributed dispatch, NULL is not TRUE, and the one check
-- that exists to attribute the evidence would wave through the least attributed
-- row in the table. The trigger uses IS DISTINCT FROM and R9 is what watches it.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers. Lifted verbatim from probe_phone_identity.sql, and deliberately not
-- factored into a shared file: a probe is evidence about ONE migration, and a
-- shared helper edited for a later migration silently re-scores every earlier
-- one. Twenty-odd hand-rolled EXCEPTION handlers is the alternative and it is
-- twenty-odd chances to write `WHEN others THEN RAISE NOTICE 'rejected'`.
-- ---------------------------------------------------------------------------
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

\o /dev/null

-- ---------------------------------------------------------------------------
-- Fixtures. TWO identities, because half of what 0034 asserts is that evidence
-- belongs to the identity citing it, and that is not testable with one.
-- ---------------------------------------------------------------------------
INSERT INTO identities (id, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'active'),
  ('a2000000-0000-0000-0000-000000000002', 'active');

INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('b1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001',
   'Holder@Example.test', 'holder@example.test'),
  ('b2000000-0000-0000-0000-000000000002',
   'a2000000-0000-0000-0000-000000000002',
   'Stranger@Example.test', 'stranger@example.test');

INSERT INTO notification_kinds (kind, class, title, template_code) VALUES
  ('security.contact_changed', 'security', 'Your contact details changed',
   'probe-contact-changed');

-- The prior number, and the identity that holds it.
INSERT INTO identity_phones (id, identity_id, phone_hash, country_code,
                             verified_at, line_type)
VALUES ('c1000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001',
        '\x5052494f52'::bytea, 'US', now(), 'mobile');

-- =============================================================================
-- The ciphertext columns                                             ADR-046
-- =============================================================================

-- S1: A ROW WITH NO CIPHERTEXT IS STILL A VALID ROW, and this is the whole
-- corpus's state until today: a prior contact Merit can RECOGNISE and cannot
-- REACH. A NOT NULL would have refused every row written before 0034 and would
-- have forced a backfill to invent ciphertext for addresses nobody has.
SELECT pg_temp.permitted(
  'S1  a contact channel with no ciphertext (every row written before 0034)',
  $q$
  INSERT INTO contact_channels (id, identity_id, kind, value_hash, verified_at)
  VALUES ('d1000000-0000-0000-0000-000000000001',
          'a1000000-0000-0000-0000-000000000001',
          'sms', '\x5052494f52'::bytea, now());
  $q$);

-- S2: the shape OQ-M10-06 asked for. Sealed value, the key that sealed it, and
-- when. The hash is untouched beside it.
SELECT pg_temp.permitted(
  'S2  a sealed address beside its hash (what OQ-M10-06 asked for)',
  $q$
  UPDATE contact_channels
     SET value_ciphertext   = '\xdeadbeefcafe'::bytea,
         value_key_id       = 'merit-kek-2026-08/1',
         value_encrypted_at = now()
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$);

-- S3: ROTATION, which is the entire reason UPDATE survived the amendment. The
-- rotation index is what makes "every row still under the retiring key" a read
-- rather than a table scan, and this is that read's write half.
SELECT pg_temp.permitted(
  'S3  rotation: resealed under a new key id',
  $q$
  UPDATE contact_channels
     SET value_ciphertext   = '\xfeedfacefeed'::bytea,
         value_key_id       = 'merit-kek-2026-11/2',
         value_encrypted_at = now()
   WHERE id = 'd1000000-0000-0000-0000-000000000001'
     AND value_key_id = 'merit-kek-2026-08/1';
  $q$);

-- ---------------------------------------------------------------------------
-- S4: ERASURE WITHOUT A DELETE. Header, and the founder's amendment.
-- ---------------------------------------------------------------------------
SELECT pg_temp.permitted(
  'S4  ERASURE: the three columns clear and the row stays',
  $q$
  UPDATE contact_channels
     SET value_ciphertext   = NULL,
         value_key_id       = NULL,
         value_encrypted_at = NULL
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$);

-- Clearing is only half of it. The half that matters is WHAT SURVIVED: an
-- erasure that also took the hash would have disarmed INV-M16-03 by the privacy
-- path, which is the trade this design exists to refuse.
DO $$
DECLARE
  surviving_hash bytea;
BEGIN
  SELECT value_hash INTO surviving_hash
    FROM contact_channels
   WHERE id = 'd1000000-0000-0000-0000-000000000001';

  IF surviving_hash IS DISTINCT FROM '\x5052494f52'::bytea THEN
    RAISE EXCEPTION
      'PROBE FAILED (S4b): erasure took the hash with it. INV-M16-03 matches on '
      'the hash, so an erasure that clears it disarms the account-takeover '
      'countermeasure through the privacy path.';
  END IF;
  RAISE NOTICE 'PERMITTED  S4b the hash survived erasure (INV-M16-03 still has its input)';
END $$;

-- Reseal it, because the ceremony below is about an identity Merit can reach.
UPDATE contact_channels
   SET value_ciphertext   = '\xdeadbeefcafe'::bytea,
       value_key_id       = 'merit-kek-2026-11/2',
       value_encrypted_at = now()
 WHERE id = 'd1000000-0000-0000-0000-000000000001';

-- R1 to R4: the completeness CHECKs, one per table plus the blank-key case.
-- A ciphertext with no key identifier is an unopenable blob that every rotation
-- sweep skips and every reader believes is an address.
SELECT pg_temp.rejected(
  'R1  ciphertext with no key id',
  $q$
  UPDATE contact_channels
     SET value_ciphertext = '\xaa'::bytea, value_key_id = NULL,
         value_encrypted_at = now()
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$,
  'contact_channels_ciphertext_is_complete');

SELECT pg_temp.rejected(
  'R2  a key id of whitespace (an empty string satisfies NOT NULL and answers nothing)',
  $q$
  UPDATE contact_channels
     SET value_ciphertext = '\xaa'::bytea, value_key_id = '   ',
         value_encrypted_at = now()
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  $q$,
  'contact_channels_ciphertext_is_complete');

SELECT pg_temp.rejected(
  'R3  identity_phones: sealed, with no record of when',
  $q$
  UPDATE identity_phones
     SET phone_ciphertext = '\xbb'::bytea, phone_key_id = 'merit-kek-2026-11/2'
   WHERE id = 'c1000000-0000-0000-0000-000000000001';
  $q$,
  'identity_phones_ciphertext_is_complete');

-- =============================================================================
-- The notification obligation is discharged by evidence     ADR-046, EC-146
-- =============================================================================

-- The evidence rows. The SMS leg is an integration_dispatches row because it
-- CANNOT be a notifications row: notifications.channel is (in_app, email, push).
INSERT INTO integration_dispatches
  (id, integration, identity_id, fields_sent, status, dispatched_at, idempotency_key)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'sms-vendor',
   'a1000000-0000-0000-0000-000000000001', ARRAY['phone'], 'sent', now(),
   'probe-prior-notice-1'),
  -- A dispatch about NOBODY. 0018 makes identity_id nullable because not every
  -- dispatch is about a person. R9 is what this row exists for.
  ('e3000000-0000-0000-0000-000000000003', 'sms-vendor',
   NULL, ARRAY['phone'], 'sent', now(), 'probe-unattributed'),
  -- A dispatch about the STRANGER.
  ('e2000000-0000-0000-0000-000000000002', 'sms-vendor',
   'a2000000-0000-0000-0000-000000000002', ARRAY['phone'], 'sent', now(),
   'probe-stranger-notice');

INSERT INTO notifications
  (id, identity_id, kind, channel, class, template_version, sent_at,
   delivery_status, delivered_at)
VALUES
  ('f1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001', 'security.contact_changed', 'email',
   'security', 1, now(), 'delivered', now()),
  ('f2000000-0000-0000-0000-000000000002',
   'a2000000-0000-0000-0000-000000000002', 'security.contact_changed', 'email',
   'security', 1, now(), 'delivered', now());

-- S5pre: the request opens. THIS IS A LABELLED SUCCESS RATHER THAN A BARE
-- FIXTURE INSERT, and the difference was found by seeding a guard that refuses
-- everything: as a bare INSERT it failed with a raw constraint error eight
-- assertions in, which reads as a broken fixture and gets "fixed" by loosening
-- the fixture. Labelled, the same seed reports that the ceremony can no longer
-- be opened, which is what actually happened.
SELECT pg_temp.permitted(
  'S5pre a change request opens with a sealed new number',
  $q$
  INSERT INTO phone_change_requests
    (id, identity_id, state, old_phone_id, new_phone_hash,
     new_phone_ciphertext, new_phone_key_id, new_phone_encrypted_at)
  VALUES ('11000000-0000-0000-0000-000000000001',
          'a1000000-0000-0000-0000-000000000001', 'pending',
          'c1000000-0000-0000-0000-000000000001', '\x4e4557'::bytea,
          '\xc0ffee'::bytea, 'merit-kek-2026-11/2', now());
  $q$);

-- R4: the third table's completeness CHECK. All three are watched, because a
-- constraint written three times is a constraint that can be omitted once and
-- the omission is one missing paragraph in a five-hundred-line file.
SELECT pg_temp.rejected(
  'R4  phone_change_requests: a key id with nothing sealed under it',
  $q$
  UPDATE phone_change_requests
     SET new_phone_ciphertext = NULL, new_phone_encrypted_at = NULL
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_ciphertext_is_complete');

-- S5a: PARTIAL EVIDENCE IS PERMITTED, and the one-directional CHECK is why.
-- The two legs do not land in the same instant. A handler that has sent the SMS
-- and not yet the email holds one citation and no timestamp; a biconditional
-- would force it to discard the citation it has or assert a notification it has
-- not made.
SELECT pg_temp.permitted(
  'S5a evidence with no claim yet (one leg sent, the other in flight)',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id = 'e1000000-0000-0000-0000-000000000001'
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$);

-- R5: THE ASSERTION THAT CLOSES EC-146. A claim with no evidence at all. This
-- is the exact write 0029 accepted and that made the control read as enforced
-- in every document while nothing had left the building.
SELECT pg_temp.rejected(
  'R5  prior_notified_at claimed with NO evidence (EC-146 in one statement)',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id = NULL,
         prior_notified_at              = now()
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_prior_notice_is_evidenced');

-- R6: one leg is not both legs. ADR-039 (c) requires the prior number AND the
-- email, and 0029's own comment says a change that notified one of them has not
-- satisfied it.
SELECT pg_temp.rejected(
  'R6  prior_notified_at claimed on the SMS leg alone',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id = 'e1000000-0000-0000-0000-000000000001',
         prior_notified_at              = now()
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_prior_notice_is_evidenced');

-- R7: the stranger's dispatch. Without the trigger this is accepted, and the
-- control becomes "a message was sent to somebody".
SELECT pg_temp.rejected_by_message(
  'R7  citing a dispatch that belongs to another identity',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id       = 'e2000000-0000-0000-0000-000000000002',
         prior_notified_email_notification_id = 'f1000000-0000-0000-0000-000000000001',
         prior_notified_at                    = now()
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$,
  '23514', 'as its prior-number notice');

-- R8: the same defect on the email leg. Named separately because both legs
-- raise check_violation from one function: a handler catching the class cannot
-- tell them apart, and either half could be deleted with the other still
-- passing.
SELECT pg_temp.rejected_by_message(
  'R8  citing a notification that belongs to another identity',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id       = 'e1000000-0000-0000-0000-000000000001',
         prior_notified_email_notification_id = 'f2000000-0000-0000-0000-000000000002',
         prior_notified_at                    = now()
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$,
  '23514', 'as its prior-email notice');

-- ---------------------------------------------------------------------------
-- R9: THE UNATTRIBUTED DISPATCH. See the header.
-- ---------------------------------------------------------------------------
-- Written with `<>` instead of IS DISTINCT FROM, the trigger compares NULL to a
-- uuid, gets NULL, and admits the one dispatch in the table that is attributed
-- to nobody at all. Every other rejection in this file still passes.
SELECT pg_temp.rejected_by_message(
  'R9  citing a dispatch attributed to NOBODY (the IS DISTINCT FROM case)',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id       = 'e3000000-0000-0000-0000-000000000003',
         prior_notified_email_notification_id = 'f1000000-0000-0000-0000-000000000001',
         prior_notified_at                    = now()
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$,
  '23514', 'rather than to');

-- ---------------------------------------------------------------------------
-- S5: THE CEREMONY COMPLETES. The positive control.
-- ---------------------------------------------------------------------------
-- Both legs cited, both belonging to this identity, the hold running past the
-- moment of application. If this ever starts failing, 0034 has refused the
-- legitimate path and a trader cannot change their number at all.
SELECT pg_temp.permitted(
  'S5  THE CEREMONY REACHES applied WITH BOTH LEGS EVIDENCED (the positive control)',
  $q$
  UPDATE phone_change_requests
     SET prior_notified_sms_dispatch_id       = 'e1000000-0000-0000-0000-000000000001',
         prior_notified_email_notification_id = 'f1000000-0000-0000-0000-000000000001',
         prior_notified_at                    = now(),
         dual_channel_verified_at             = now(),
         withdrawal_hold_until                = now() + interval '48 hours',
         applied_at                           = now(),
         state                                = 'applied'
   WHERE id = '11000000-0000-0000-0000-000000000001';
  $q$);

-- R10 and R11: the founder's note, watched rather than asserted. ON DELETE
-- RESTRICT means a cited notification can never be deleted, which is correct
-- because it is evidence, AND is the collision any future retention sweep on
-- notifications will hit. A sweep author who reads this pair knows what to
-- expect before the incident rather than during it.
SELECT pg_temp.rejected(
  'R10 deleting a CITED notification (the retention-sweep collision, watched)',
  $q$
  DELETE FROM notifications WHERE id = 'f1000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_prior_email_notification_fk');

SELECT pg_temp.rejected(
  'R11 deleting a CITED dispatch',
  $q$
  DELETE FROM integration_dispatches
   WHERE id = 'e1000000-0000-0000-0000-000000000001';
  $q$,
  'phone_change_requests_prior_sms_dispatch_fk');

-- =============================================================================
-- What merit_dispatcher may and may not do
-- =============================================================================
-- THE GRANTS ARE THE FOUNDER'S AMENDMENT AND THEY ARE THE HALF NO CONSTRAINT
-- CAN SPEAK FOR. A migration that granted DELETE by accident installs cleanly,
-- passes every assertion above, and is wrong in the one way the amendment
-- exists to prevent. These run as the role rather than reading pg_catalog,
-- because a catalogue query proves what was written and an attempted write
-- proves what the database will do.

-- S6: the role can find a destination. Without this the sending path is back
-- where OQ-M10-06 found it.
DO $$
DECLARE
  sealed bytea;
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  SELECT value_ciphertext INTO sealed
    FROM contact_channels
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  RESET ROLE;

  IF sealed IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED (S6): merit_dispatcher read the contact channel and found '
      'no sealed address. The sending path holds nothing, which is the state '
      'OQ-M10-06 recorded.';
  END IF;
  RAISE NOTICE 'PERMITTED  S6  merit_dispatcher can read a sealed address';
END $$;

-- S7: and can rotate it. The column-scoped UPDATE grant, exercised.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  UPDATE contact_channels
     SET value_ciphertext   = '\xb0b0'::bytea,
         value_key_id       = 'merit-kek-2027-02/3',
         value_encrypted_at = now()
   WHERE id = 'd1000000-0000-0000-0000-000000000001';
  RESET ROLE;
  RAISE NOTICE 'PERMITTED  S7  merit_dispatcher can rotate the sealed value';
EXCEPTION WHEN others THEN
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (S7): merit_dispatcher cannot rotate. UPDATE stays for '
    'rotation, on the founder''s amendment: % (%)', SQLERRM, SQLSTATE;
END $$;

-- S8: and can write the dispatch record, which is the INSERT the amendment
-- names and is the evidence the ceremony above cites.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  INSERT INTO integration_dispatches
    (integration, identity_id, fields_sent, status, dispatched_at, idempotency_key)
  VALUES ('sms-vendor', 'a1000000-0000-0000-0000-000000000001', ARRAY['phone'],
          'sent', now(), 'probe-dispatcher-wrote-this');
  RESET ROLE;
  RAISE NOTICE 'PERMITTED  S8  merit_dispatcher can record a dispatch';
EXCEPTION WHEN others THEN
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (S8): merit_dispatcher cannot record a dispatch: % (%)',
    SQLERRM, SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- R12: NO DELETE. THE FOUNDER'S AMENDMENT, WATCHED.
-- ---------------------------------------------------------------------------
-- A compromised send-path role holding DELETE can destroy the addresses the
-- anti-takeover control depends on. This is the assertion that fails the day
-- somebody widens the grant to make an erasure ticket easier.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  BEGIN
    DELETE FROM contact_channels
     WHERE id = 'd1000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTED   R12 merit_dispatcher may not DELETE a contact channel';
    RETURN;
  END;
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (R12): merit_dispatcher DELETED a contact channel. Erasure is '
    'a privacy operation and not a send operation (ADR-046, the founder''s '
    'amendment), and the row carries the hash INV-M16-03 matches on.';
END $$;

-- R13: and not on the identity table either, where the prior number lives.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  BEGIN
    DELETE FROM identity_phones
     WHERE id = 'c1000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTED   R13 merit_dispatcher may not DELETE an identity phone';
    RETURN;
  END;
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (R13): merit_dispatcher DELETED an identity_phones row.';
END $$;

-- ---------------------------------------------------------------------------
-- R14: THE COLUMN SCOPE IS REAL, AND THIS IS WHAT PROVES IT.
-- ---------------------------------------------------------------------------
-- The UPDATE grant names three columns. If it were table-wide, the sending path
-- could blank the value_hash and disarm INV-M16-03 without deleting anything,
-- which is the amendment defeated by a verb it was allowed to keep.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  BEGIN
    UPDATE contact_channels SET value_hash = '\x00'::bytea
     WHERE id = 'd1000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTED   R14 merit_dispatcher may not rewrite value_hash';
    RETURN;
  END;
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (R14): merit_dispatcher rewrote value_hash. The UPDATE grant '
    'is column-scoped to the rotation columns precisely so that the send path '
    'cannot blank the value INV-M16-03 matches on.';
END $$;

-- R15: and may not rewrite the audit trail of what left the building. 0026
-- already revoked UPDATE on integration_dispatches from merit_app and PUBLIC
-- because it is append-only under INV-M10-03; the dispatcher must not become
-- the one role that can.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  BEGIN
    UPDATE integration_dispatches SET status = 'failed'
     WHERE id = 'e1000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTED   R15 merit_dispatcher may not rewrite a dispatch record';
    RETURN;
  END;
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (R15): merit_dispatcher rewrote an integration_dispatches '
    'row. That table is append-only under INV-M10-03.';
END $$;

-- R16: and may not read the identity graph it was never granted. 0034 grants
-- five tables by name and adds NO default privilege, so a table created by a
-- later migration is invisible to the sending path until somebody grants it
-- deliberately. This is the assertion that fails if a future session copies
-- 0026's `ALTER DEFAULT PRIVILEGES ... TO merit_app` line and changes the role.
DO $$
BEGIN
  SET LOCAL ROLE merit_dispatcher;
  BEGIN
    PERFORM 1 FROM identity_signals LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTED   R16 merit_dispatcher cannot read identity_signals';
    RETURN;
  END;
  RESET ROLE;
  RAISE EXCEPTION
    'PROBE FAILED (R16): merit_dispatcher read identity_signals. The sending '
    'path is granted five tables by name and nothing else.';
END $$;

\o

ROLLBACK;
