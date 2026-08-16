-- =============================================================================
-- 0034_reversible_contact_addresses
-- =============================================================================
-- E2 READ: MONEY PATH. Auth is a money path (CLAUDE.md, constitution E2) and
-- this file changes what the account-takeover countermeasure can do. It closes
-- OQ-M10-06, which is a PROVEN GAP IN A SHIPPED CONTROL rather than a design
-- preference: INV-M16-03 notifies the PRIOR contact when a contact changes,
-- SECURITY section 4.8 leg 2 is the same control one document over, and there
-- was no plaintext telephone number in any of the thirty-three migrations for
-- either of them to send to.
--
-- ADR-046, and M10 section 7.9.4, which is the approved plan this file is
-- scored against. The founder's amendment is header item 2.
--
-- THE SENTENCE THIS FILE EXISTS TO MAKE TRUE. Both 0019 and the contact_channels
-- design record say the value is hashed because "the sending path holds the
-- address". The sending path is M10. M10 holds nothing, by INV-M10-02 and
-- INV-M10-03 and by the deliberate absence of any table in that module that
-- stores a contact value, and it may not delegate the holding to a vendor
-- because AS-M10-06 part 3 forbids a vendor being the system of record for
-- content a trader must receive. So the citing documents assumed a holder that
-- did not exist. This file gives them one.
--
-- SEVEN things need the founder's line-by-line read.
--
--   1. THE KEY IS THE CONTROL, NOT THE GRANT, AND merit_app CAN READ THE
--      CIPHERTEXT. Every column added here is envelope-encrypted: the row holds
--      ciphertext plus the identifier of the key encryption key that wrapped
--      its data key, and THAT KEY IS NOT IN THIS DATABASE. A dump yields no
--      usable address, which is the stated goal of the hashing this file is
--      loosening, and it yields none whether the reader is an attacker or is
--      merit_app.
--
--      A COLUMN-SCOPED REVOKE WAS CONSIDERED AND IS NOT POSSIBLE HERE.
--      PostgreSQL cannot subtract one column from a table-level SELECT: the
--      table grant implies every column, and `REVOKE SELECT (col)` against it
--      is a no-op that LOOKS like a control. The only way to scope merit_app's
--      read is to revoke the table grant and re-grant column by column, which
--      is a hand-maintained column list, which is the object 0026's revoke list
--      and every hand-maintained count in this corpus have already cost us.
--      If the founder wants the GRANT to carry this weight rather than the key,
--      the shape that gets it is a sidecar table keyed by the row id, and that
--      is a different migration and a different ADR. It is named here so the
--      decision is visible rather than inferred from an absence.
--
--      And the exposure it would close is smaller than it looks: merit_app is
--      the role that already handles a number in plaintext at registration,
--      because the trader types it into the request. What it must not be able
--      to do is destroy one, which is item 2.
--
--   2. merit_dispatcher HAS NO DELETE, ON THE FOUNDER'S AMENDMENT OF 2026-08-16.
--      The plan gave the sending path the address; the amendment says that
--      giving it the power to remove one is a separate decision nobody made.
--      ERASURE IS A PRIVACY OPERATION AND NOT A SEND OPERATION, and a
--      compromised send-path role holding DELETE can destroy the very rows the
--      anti-takeover control reads.
--
--      BE PRECISE ABOUT WHAT THE WITHHELD DELETE BUYS, because overclaiming it
--      is how the next reader stops looking. It protects the ROW: the
--      value_hash INV-M16-03 matches on, the supersession lineage that makes a
--      PRIOR contact addressable at all, and the evidence in item 4. It does
--      NOT make an address indestructible, because UPDATE stays (rotation needs
--      it) and a role that can rewrite a ciphertext can blank one. Row
--      destruction and value destruction are different losses and only the
--      first is closed here.
--
--      THE TABLES ARE NOT APPEND-ONLY AND MUST NOT BE READ AS SUCH. When an
--      erasure path exists it gets its OWN grant to its OWN role, and the
--      absence of a DELETE grant today is a statement about the dispatcher
--      rather than about the table.
--
--   3. THE CIPHERTEXT IS NEVER MATCHED ON, AND THE HASH IS. Every uniqueness
--      index and every lookup in 0019 and 0029 stays exactly where it is:
--      contact_channels_live_uq, identity_phones_live_number_idx and
--      identity_phones_history_idx are all on the hash and none of them moves.
--      A reader who "completes" this file by indexing a ciphertext for
--      uniqueness has to make the encryption DETERMINISTIC to do it, and a
--      deterministic ciphertext is an enumerable one: equal addresses become
--      equal bytes, and the dump the hashing exists to defeat becomes a
--      lookup table again. The hash matches. The ciphertext sends. They are
--      not two spellings of one column.
--
--   4. prior_notified_at NOW REQUIRES EVIDENCE, WHICH IS EC-146 AND GS-265
--      MADE STRUCTURAL. 0029's phone_change_requests_applied_is_complete makes
--      the timestamp a precondition of reaching 'applied', and a database can
--      only assert that a timestamp EXISTS: a handler with no address and a
--      column it must fill will fill it, the constraint passes, and the whole
--      anti-takeover control reads as enforced while nothing left the building.
--      EC-146 rules the remedy: a notification obligation is discharged by a
--      DISPATCH RECORD, never by a timestamp. So the timestamp now cites both
--      legs, and (c) requires both.
--
--      TWO DIFFERENT TABLES, BECAUSE THE TWO LEGS ARE DIFFERENT OBJECTS. The
--      email leg is a notifications row; the SMS leg CANNOT BE ONE, because
--      notifications.channel is CHECK (channel IN ('in_app','email','push'))
--      and 0029 declined to widen it. Its record is an integration_dispatches
--      row, which is the pairing 0029's own comment already states for the OTP
--      path.
--
--      ON DELETE RESTRICT ON THE NOTIFICATION FOREIGN KEYS MEANS A REFERENCED
--      NOTIFICATION CAN NEVER BE DELETED. That is correct: it is evidence, and
--      evidence that a retention job can remove is evidence for exactly as long
--      as nobody needs it. AND IT COLLIDES WITH ANY FUTURE RETENTION SWEEP ON
--      notifications, which will find rows it cannot delete and must be written
--      to expect that rather than to treat it as a bug. Stated here because the
--      sweep does not exist yet and its author will not read this file.
--
--   5. WHAT THE EVIDENCE STILL DOES NOT PROVE, AND THIS HALF IS SEPARATELY
--      REJECTABLE. A foreign key proves a row was cited. It does not prove the
--      message was ADDRESSED TO THE PRIOR CHANNEL, which is the wording GS-265
--      uses, and the database CANNOT prove it: integration_dispatches records
--      fields_sent and never values (INV-M10-03), so no column anywhere holds
--      the destination of a dispatch. That limit is structural and it is left
--      standing rather than papered over.
--
--      What IS closed is the cheap bypass, and only that. Without it the two
--      columns can cite ANY dispatch and ANY notification in the table, which
--      makes the control "some message was sent to somebody". The trigger
--      asserts that both cited rows belong to the SAME IDENTITY as the request.
--      Reject this half if the founder reads ADR-046 narrowly; the foreign keys
--      and the CHECK stand without it.
--
--   6. otp_challenges IS DELIBERATELY NOT TOUCHED, and the omission is the plan
--      rather than an oversight. M10 section 7.9.4's table of flows is the
--      reasoning: an OTP is a CHALLENGE-RESPONSE flow and the trader types the
--      number into the request, so the address is held by the request and is
--      deliverable today. destination_hash stays one-way. The exposed class is
--      every message MERIT ITSELF INITIATES, and those are the three tables
--      below.
--
--   7. A PLAINTEXT ADDRESS IS STRUCTURALLY REFUSED, WHICH IS THE DIFFERENCE
--      BETWEEN INV-M10-12 BEING A CONSTRAINT AND BEING A PROMISE. INV-M10-12
--      says a telephone number exists in plaintext IN A REQUEST BODY AND NEVER
--      AT REST. Nothing else in this file enforces it: every one of the columns
--      above is bytea, EVERY BYTE STRING IS A VALID bytea, and a handler that
--      skips the seal and writes the number itself satisfies every other
--      constraint here. Nothing objects, the row reads as sealed to every
--      reader and every catalogue query, and the defect surfaces at DECRYPT
--      time -- with the address sitting in the clear at rest for however long
--      that takes, which is exactly what INV-M10-12 forbids.
--
--      octet_length(...) >= 29 IS THE SMALLEST ENVELOPE THAT CAN EXIST: a
--      12-byte nonce, a 16-byte GCM tag, and at least one byte of ciphertext
--      under them. A raw E.164 number is AT MOST 16 bytes, a '+' and at most 15
--      digits, so EVERY E.164 ADDRESS IN EXISTENCE SITS BELOW THE FLOOR and no
--      telephone number can be smuggled through this column as bytea. It is a
--      floor rather than an equality, so a longer nonce or a second tag stays
--      inside it and no future scheme has to edit a merged migration to fit.
--
--      BE EXACT ABOUT WHAT IT DOES NOT CATCH, on item 2's discipline, because
--      overclaiming a control is how the next reader stops looking.
--      contact_channels.kind is ('email','push','sms') since 0029, so THAT
--      column also holds email addresses and push tokens, and a plaintext email
--      of 29 bytes or more clears the floor. THE REFUSAL IS TOTAL FOR TELEPHONE
--      NUMBERS, which is the class INV-M10-12 names and the class OQ-M10-06 was
--      about, and it is PARTIAL on contact_channels for the other two kinds,
--      where it catches only the short ones. identity_phones and
--      phone_change_requests hold a telephone number and nothing else, so on
--      those two it is total.
--
-- No numbered delta lands here. ADR-046 is a ruling on an open question, not a
-- module's schema delta, so ADR-026's manifest completeness gate has nothing to
-- count and the record is DELTA_MANIFEST section 18 instead. 0033's precedent.
--
-- IT SUPERSEDES AND NEVER EDITS. 0018, 0019, 0026 and 0029 are untouched on
-- disk and stay exactly as they were written; this file changes what they
-- installed. Migrations are sacred once merged (constitution E2), which is a
-- rule about editing them and not a rule against extending them. 0028's
-- precedent, applied a fourth time.
--
-- ADR-035's array trap: no table here declares an array column, so there is no
-- CHECK over an array to write with cardinality() and no way to write one with
-- array_length(). Stated rather than left implicit.
--
-- Rulings: ADR-046. Authority: docs/plans/M10-integrations.md section 7.9.4,
--          EC-146, GS-265, INV-M16-03, SECURITY section 4.8.
-- Full trace: packages/db/DELTA_MANIFEST.md section 18.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- The role that holds an address
-- -----------------------------------------------------------------------------
-- 0026 created three roles and none of them is a sending path. merit_app is the
-- application, merit_analytics reads a bounded subset and merit_migrator holds
-- the DDL. A fourth exists now because the address needs an owner that is not
-- "whoever is connected", and because item 2's amendment is a statement about a
-- role rather than about a table: you cannot withhold DELETE from the send path
-- until the send path is a principal the database can name.
--
-- NOLOGIN, on 0026's pattern exactly: these are roles a deployment GRANTs to a
-- login user, not login users. IF NOT EXISTS-style because role names are
-- cluster-wide and a shared cluster may already carry them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merit_dispatcher') THEN
    CREATE ROLE merit_dispatcher NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO merit_dispatcher;

-- No DDL, for merit_app's reason in 0026 and more so: a role that can alter its
-- own schema can drop the constraints below and then do what they forbid.
REVOKE CREATE ON SCHEMA public FROM merit_dispatcher;

-- -----------------------------------------------------------------------------
-- contact_channels.value_ciphertext                              -- ADR-046
-- -----------------------------------------------------------------------------
-- The delivery address, held REVERSIBLY rather than not at all. This is the
-- column M10 section 7.9.4 names, and the two beside it are what make it
-- rotatable rather than a one-way trip into a key nobody may ever retire.
--
-- NULLABLE, AND THE NULL IS LOAD BEARING IN TWO DIRECTIONS. Backwards, a row
-- written before this migration has a hash and no ciphertext and is still a
-- valid row: it is a prior contact Merit can recognise and cannot reach, which
-- is the state the whole corpus was in until today, and a NOT NULL would have
-- required inventing a ciphertext for it. Forwards, ERASURE IS A NULL. When the
-- privacy path exists it clears these three columns and leaves the hash, the
-- lineage and the evidence standing, which is the only erasure that does not
-- also destroy the account-takeover control. A NOT NULL would have made DELETE
-- the only way to erase, on the tables where item 2 has just taken DELETE away.
ALTER TABLE contact_channels
  ADD COLUMN value_ciphertext bytea NULL;                         -- ADR-046

-- WHICH KEY, NOT THE KEY. An opaque identifier for the key encryption key and
-- its version, resolved by the dispatcher against a key manager outside this
-- database. It references no table here ON PURPOSE: a key registry in the same
-- database as the ciphertext is one dump away from being a key ceremony.
--
-- It is what makes rotation a query rather than a migration, and rotation is
-- the reason UPDATE survived item 2's amendment.
ALTER TABLE contact_channels
  ADD COLUMN value_key_id text NULL;                              -- ADR-046

ALTER TABLE contact_channels
  ADD COLUMN value_encrypted_at timestamptz NULL;                 -- ADR-046

-- ALL THREE OR NONE. A ciphertext with no key identifier is an unopenable blob
-- that every future rotation sweep will skip and every reader will believe is
-- an address; a key identifier with no ciphertext is a claim about a value that
-- is not there. The blank check is the same argument as
-- trading_calendar_revisions.reason: an empty string satisfies NOT NULL and
-- answers nothing.
ALTER TABLE contact_channels
  ADD CONSTRAINT contact_channels_ciphertext_is_complete CHECK (
    (value_ciphertext IS NULL AND value_key_id IS NULL AND value_encrypted_at IS NULL)
    OR
    (value_ciphertext IS NOT NULL AND value_key_id IS NOT NULL
     AND value_encrypted_at IS NOT NULL AND btrim(value_key_id) <> '')
  );                                                              -- ADR-046

-- THE PLAINTEXT FLOOR. Header item 7, and it is the assertion that makes
-- INV-M10-12 a constraint rather than a promise: 29 bytes is a 12-byte nonce
-- plus a 16-byte GCM tag plus one byte of ciphertext, and a raw E.164 number is
-- at most 16 bytes, so a telephone number written here in the clear is refused
-- by arithmetic rather than by review.
--
-- A SEPARATE CONSTRAINT RATHER THAN A CLAUSE INSIDE is_complete ABOVE, and the
-- reason is the probe rather than taste. A write can violate both at once, and
-- PostgreSQL reports one of the two IN AN ORDER IT DOES NOT DOCUMENT: section
-- 18 of the delta manifest records two assertions in a probe written before
-- this file that were resting on exactly that undocumented order. Named
-- separately, every assertion can name the constraint it is actually watching,
-- and dropping either one fails an assertion that says which one went.
--
-- NULL PASSES, on the same reasoning as the NULLABLE column above: a row
-- written before 0034 has no ciphertext, and erasure is a NULL.
ALTER TABLE contact_channels
  ADD CONSTRAINT contact_channels_ciphertext_refuses_plaintext CHECK (
    value_ciphertext IS NULL OR octet_length(value_ciphertext) >= 29
  );                                                              -- ADR-046

-- THE ROTATION SWEEP'S READ: everything still sealed under the key being
-- retired. Partial, because the rows with no ciphertext are exactly the rows a
-- rotation has no work to do on, and they are the majority until the backfill
-- runs.
CREATE INDEX contact_channels_key_rotation_idx
  ON contact_channels (value_key_id)
  WHERE value_ciphertext IS NOT NULL;                             -- ADR-046

COMMENT ON COLUMN contact_channels.value_ciphertext IS
  'ADR-046, OQ-M10-06. The delivery address, envelope-encrypted under the key '
  'named by value_key_id, which is not in this database. value_hash keeps '
  'matching and uniqueness; this column is never matched on, and making it '
  'deterministic enough to match on would make a dump enumerable. At least 29 '
  'bytes when present (12-byte nonce, 16-byte GCM tag, one byte sealed), which '
  'refuses every plaintext E.164 because one is at most 16 bytes. kind is also '
  '(email, push), where a plaintext value of 29 bytes or more clears the floor: '
  'the refusal is total for telephone numbers and partial for the other two.';

-- -----------------------------------------------------------------------------
-- identity_phones.phone_ciphertext                               -- ADR-046
-- -----------------------------------------------------------------------------
-- THE IDENTITY TABLE, AND IT IS NOT REDUNDANT WITH THE ONE ABOVE. 0029 is
-- explicit that identity_phones is who this person is and contact_channels is
-- where a message goes, and that collapsing them is how a contact-preference
-- edit becomes an identity change. The reason this table needs an address too
-- is the SECURITY section 4.8 leg 2 class: a security notice to the VERIFIED
-- number, which Merit initiates, about a destination change or a passkey
-- registration or a breach. That number is an identity fact and the notice is
-- addressed to it directly, not to whatever delivery preference is live.
--
-- SUPERSEDED AND RELEASED ROWS KEEP THEIRS, and that is the point rather than
-- an oversight: ADR-039 (c) requires notifying the PRIOR number, and a prior
-- number whose ciphertext was cleared on supersession would leave the same gap
-- one table over.
ALTER TABLE identity_phones
  ADD COLUMN phone_ciphertext bytea NULL;                         -- ADR-046
ALTER TABLE identity_phones
  ADD COLUMN phone_key_id text NULL;                              -- ADR-046
ALTER TABLE identity_phones
  ADD COLUMN phone_encrypted_at timestamptz NULL;                 -- ADR-046

ALTER TABLE identity_phones
  ADD CONSTRAINT identity_phones_ciphertext_is_complete CHECK (
    (phone_ciphertext IS NULL AND phone_key_id IS NULL AND phone_encrypted_at IS NULL)
    OR
    (phone_ciphertext IS NOT NULL AND phone_key_id IS NOT NULL
     AND phone_encrypted_at IS NOT NULL AND btrim(phone_key_id) <> '')
  );                                                              -- ADR-046

-- The plaintext floor, header item 7. TOTAL ON THIS TABLE rather than partial:
-- phone_ciphertext holds a telephone number and nothing else, so every value
-- this column can legitimately hold in the clear is below 29 bytes and every
-- one of them is refused.
ALTER TABLE identity_phones
  ADD CONSTRAINT identity_phones_ciphertext_refuses_plaintext CHECK (
    phone_ciphertext IS NULL OR octet_length(phone_ciphertext) >= 29
  );                                                              -- ADR-046

CREATE INDEX identity_phones_key_rotation_idx
  ON identity_phones (phone_key_id)
  WHERE phone_ciphertext IS NOT NULL;                             -- ADR-046

COMMENT ON COLUMN identity_phones.phone_ciphertext IS
  'ADR-046, OQ-M10-06. The verified number, envelope-encrypted. phone_hash '
  'keeps matching, and identity_phones_live_number_idx stays on the hash: '
  'ADR-039 (b) deliberately does not make it unique and nothing here changes '
  'that.';

-- -----------------------------------------------------------------------------
-- phone_change_requests.new_phone_ciphertext                     -- ADR-046
-- -----------------------------------------------------------------------------
-- THE PROPOSED NUMBER, which is the one leg of the ceremony that has an address
-- in the request and still needs one in the row. The trader typed it when the
-- request was opened; the confirmation to it is sent later, after the hold, by
-- a job that no longer has the request in front of it.
ALTER TABLE phone_change_requests
  ADD COLUMN new_phone_ciphertext bytea NULL;                     -- ADR-046
ALTER TABLE phone_change_requests
  ADD COLUMN new_phone_key_id text NULL;                          -- ADR-046
ALTER TABLE phone_change_requests
  ADD COLUMN new_phone_encrypted_at timestamptz NULL;             -- ADR-046

ALTER TABLE phone_change_requests
  ADD CONSTRAINT phone_change_requests_ciphertext_is_complete CHECK (
    (new_phone_ciphertext IS NULL AND new_phone_key_id IS NULL
     AND new_phone_encrypted_at IS NULL)
    OR
    (new_phone_ciphertext IS NOT NULL AND new_phone_key_id IS NOT NULL
     AND new_phone_encrypted_at IS NOT NULL AND btrim(new_phone_key_id) <> '')
  );                                                              -- ADR-046

-- The plaintext floor, header item 7. TOTAL ON THIS TABLE, for
-- identity_phones' reason, and this is the column where the smuggled plaintext
-- is likeliest: the trader typed the number into the request, so THE HANDLER
-- THAT OPENS THIS ROW IS THE ONE HANDLER IN THE CORPUS HOLDING A NUMBER IN THE
-- CLEAR AND A bytea COLUMN TO PUT IT IN.
ALTER TABLE phone_change_requests
  ADD CONSTRAINT phone_change_requests_ciphertext_refuses_plaintext CHECK (
    new_phone_ciphertext IS NULL OR octet_length(new_phone_ciphertext) >= 29
  );                                                              -- ADR-046

CREATE INDEX phone_change_requests_key_rotation_idx
  ON phone_change_requests (new_phone_key_id)
  WHERE new_phone_ciphertext IS NOT NULL;                         -- ADR-046

-- -----------------------------------------------------------------------------
-- The notification obligation is discharged by evidence          -- ADR-046
-- -----------------------------------------------------------------------------
-- EC-146 and GS-265. Header item 4. The address alone does not close
-- OQ-M10-06: it makes the send POSSIBLE, and what made the gap invisible was
-- that a handler which sent nothing could still satisfy the constraint. So the
-- timestamp stops being a claim and becomes a citation.
--
-- ON DELETE RESTRICT ON BOTH. See header item 4 for what that costs a future
-- retention sweep on notifications, which is a real cost accepted deliberately.
--
-- THE FOREIGN KEYS ARE NAMED, and that is 0029's own lesson applied on the way
-- in rather than on the way out. 0019 wrote a CHECK inline, PostgreSQL named it
-- contact_channels_kind_check, and 0029 had to drop a generated name to widen
-- it. An inline REFERENCES here would have produced
-- phone_change_requests_prior_notified_email_notification_id_fkey, which is a
-- name at the edge of PostgreSQL's 63-byte truncation AND is the name the probe
-- has to assert on when it watches a cited notification refuse to be deleted.
ALTER TABLE phone_change_requests
  ADD COLUMN prior_notified_sms_dispatch_id uuid NULL;            -- ADR-046
ALTER TABLE phone_change_requests
  ADD CONSTRAINT phone_change_requests_prior_sms_dispatch_fk
    FOREIGN KEY (prior_notified_sms_dispatch_id)
    REFERENCES integration_dispatches(id) ON DELETE RESTRICT;     -- ADR-046

ALTER TABLE phone_change_requests
  ADD COLUMN prior_notified_email_notification_id uuid NULL;      -- ADR-046
ALTER TABLE phone_change_requests
  ADD CONSTRAINT phone_change_requests_prior_email_notification_fk
    FOREIGN KEY (prior_notified_email_notification_id)
    REFERENCES notifications(id) ON DELETE RESTRICT;              -- ADR-046

-- ONE DIRECTION ONLY, AND THE OTHER DIRECTION IS DELIBERATELY LEFT OPEN. A
-- claim with no evidence is refused. Evidence with no claim is PERMITTED,
-- because the two legs do not land in the same instant: a handler that has sent
-- the SMS and not yet the email holds one citation and no timestamp, and a
-- biconditional would force it to either discard the citation it has or assert
-- a notification it has not made. 0029's applied_is_complete has exactly this
-- shape and for exactly this reason.
ALTER TABLE phone_change_requests
  ADD CONSTRAINT phone_change_requests_prior_notice_is_evidenced CHECK (
    prior_notified_at IS NULL
    OR (prior_notified_sms_dispatch_id IS NOT NULL
        AND prior_notified_email_notification_id IS NOT NULL)
  );                                                              -- ADR-046

-- THE EVIDENCE BELONGS TO THIS IDENTITY. Header item 5, and this is the half
-- that is separately rejectable.
--
-- A foreign key proves a row was cited and nothing more. Without this, the two
-- columns above can cite any dispatch and any notification in either table, and
-- the strongest reading of the control collapses to "a message was sent to
-- somebody". A CHECK cannot say this: it may not read another table. So it is
-- a trigger, in 0027's idiom, which ASSERTS and never repairs.
--
-- NOT DEFERRED, and the difference from 0033 is worth one line. CALENDAR-C1 is
-- deferred because the image and the update arrive in one transaction in an
-- order the database has no business dictating. Here the order is already
-- forced: the foreign keys are immediate, so both rows exist before the
-- citation can be written at all, and deferring would buy nothing.
CREATE FUNCTION assert_prior_notice_evidence_matches_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  evidence_identity uuid;
BEGIN
  IF NEW.prior_notified_sms_dispatch_id IS NOT NULL THEN
    SELECT d.identity_id INTO evidence_identity
      FROM integration_dispatches d
     WHERE d.id = NEW.prior_notified_sms_dispatch_id;

    -- IS DISTINCT FROM, not <>. integration_dispatches.identity_id is NULLABLE
    -- (0018: not every dispatch is about a person), and a NULL compared with <>
    -- yields NULL, which is not TRUE, which would let an unattributed dispatch
    -- through the one check that exists to attribute it.
    IF evidence_identity IS DISTINCT FROM NEW.identity_id THEN
      RAISE EXCEPTION
        'ADR-046: phone_change_requests % cites integration_dispatches % as '
        'its prior-number notice, and that dispatch belongs to identity % '
        'rather than to %. A notification obligation is discharged by a '
        'dispatch record (EC-146), and a dispatch addressed to somebody else '
        'discharges nothing.',
        NEW.id, NEW.prior_notified_sms_dispatch_id,
        coalesce(evidence_identity::text, 'nobody'), NEW.identity_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.prior_notified_email_notification_id IS NOT NULL THEN
    SELECT n.identity_id INTO evidence_identity
      FROM notifications n
     WHERE n.id = NEW.prior_notified_email_notification_id;

    IF evidence_identity IS DISTINCT FROM NEW.identity_id THEN
      RAISE EXCEPTION
        'ADR-046: phone_change_requests % cites notifications % as its '
        'prior-email notice, and that notification belongs to identity % '
        'rather than to %. See EC-146.',
        NEW.id, NEW.prior_notified_email_notification_id,
        coalesce(evidence_identity::text, 'nobody'), NEW.identity_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER phone_change_requests_evidence_is_this_identitys
  AFTER INSERT OR UPDATE ON phone_change_requests
  FOR EACH ROW
  WHEN (NEW.prior_notified_sms_dispatch_id IS NOT NULL
        OR NEW.prior_notified_email_notification_id IS NOT NULL)
  EXECUTE FUNCTION assert_prior_notice_evidence_matches_identity();

COMMENT ON COLUMN phone_change_requests.prior_notified_sms_dispatch_id IS
  'ADR-046, EC-146, GS-265. The dispatch that carried the notice to the prior '
  'number. prior_notified_at may not be set without it. The database cannot '
  'assert that it was ADDRESSED to the prior number, because '
  'integration_dispatches records fields_sent and never values (INV-M10-03).';

COMMENT ON COLUMN phone_change_requests.prior_notified_email_notification_id IS
  'ADR-046, EC-146. The email leg. It is a notifications row and the SMS leg '
  'cannot be one: notifications.channel is (in_app, email, push) and 0029 '
  'declined to widen it, because notifications.identity_id is NOT NULL and a '
  'pre-identity message cannot be a notifications row at all.';

-- -----------------------------------------------------------------------------
-- What merit_dispatcher may do
-- -----------------------------------------------------------------------------
-- ENUMERATED, NOT GRANTED-THEN-REVOKED, which is 0026's merit_analytics idiom
-- rather than its merit_app idiom, and the choice is the same one 0026 made for
-- the same reason: the risk on a narrow role is a table added later becoming
-- reachable by default, and the default should be that it is not.
--
-- FOR THAT REASON THERE IS NO `ALTER DEFAULT PRIVILEGES ... TO merit_dispatcher`
-- ANYWHERE IN THIS FILE. 0026 has one for merit_app, which is why a table
-- created by a future migration is writable by the application on the day it is
-- created. The sending path gets the opposite default: a new table is invisible
-- to it until somebody grants it deliberately.
GRANT SELECT ON
  contact_channels,
  identity_phones,
  phone_change_requests
TO merit_dispatcher;

-- THE FOUNDER'S AMENDMENT, WRITTEN AS THE THREE VERBS IT IS. SELECT to find the
-- destination. INSERT to record the dispatch. UPDATE to rotate. NO DELETE.
--
-- UPDATE IS COLUMN-SCOPED TO THE ROTATION COLUMNS, which is narrower than the
-- amendment's words and is what "UPDATE stays for rotation" asks for when it is
-- written as a grant: rotation rewrites the sealed value and the key that
-- sealed it, and touches nothing else. Table-wide UPDATE would additionally let
-- the send path clear a verified_at, rewrite a supersession pointer or blank a
-- value_hash, none of which is rotation and all of which are ways to disarm
-- INV-M16-03 without deleting a single row.
--
-- IF THE FOUNDER MEANT TABLE-WIDE UPDATE, the widening is one word per line and
-- this comment is where to start reading. It is called out because a grant that
-- is narrower than its ruling is still a departure from it.
GRANT UPDATE (value_ciphertext, value_key_id, value_encrypted_at)
  ON contact_channels TO merit_dispatcher;
GRANT UPDATE (phone_ciphertext, phone_key_id, phone_encrypted_at)
  ON identity_phones TO merit_dispatcher;
GRANT UPDATE (new_phone_ciphertext, new_phone_key_id, new_phone_encrypted_at)
  ON phone_change_requests TO merit_dispatcher;

-- The dispatch record. INSERT is the verb the amendment names and this is where
-- it lands: the sending path's output is the evidence row the ceremony above
-- now cites. SELECT because the retry and idempotency reads are the same
-- table's.
--
-- NO UPDATE AND NO DELETE HERE, and that is not this file's doing: 0026 already
-- revoked both from merit_app AND from PUBLIC, because integration_dispatches
-- is append-only under INV-M10-03. Granting the dispatcher an UPDATE would make
-- it the one role that can rewrite the audit trail of what left the building.
GRANT SELECT, INSERT ON integration_dispatches TO merit_dispatcher;

-- The contract allowlist, read-only. INV-M10-02's guarantee is that a field is
-- not sent to anybody until somebody adds it to that vendor's contract row, and
-- a sending path that can write its own contract is a sending path that can
-- authorise its own disclosure.
GRANT SELECT ON integration_contracts TO merit_dispatcher;

-- BELT, AND IT BINDS THIS FILE AND ONLY THIS FILE. Nothing above grants DELETE,
-- so against the file as written this revokes a privilege the role does not
-- hold and changes no catalogue row.
--
-- IT IS STRONGER THAN THAT SENTENCE SUGGESTS AND THE DIFFERENCE WAS FOUND BY
-- EXECUTING IT. This comment first read "a statement rather than a mechanism".
-- Then the seeded-violation run added DELETE to the GRANT above, expecting the
-- probe to catch it, and THE PROBE STILL PASSED: this REVOKE had already taken
-- it back. A privilege granted earlier in this file cannot survive to COMMIT,
-- which makes the belt a real mechanism against the likeliest mistake, an
-- absent-minded verb added to a grant list somebody was already editing.
--
-- IT CANNOT BIND THE FUTURE, and nothing in PostgreSQL can: a later migration
-- granting DELETE to this role wins, and the only thing that catches that is a
-- reviewer or a gate. There is no gate today. The seeded case that proves this
-- half is the one that adds the grant AFTER this statement, and it is R12 in
-- the probe that catches it.
REVOKE DELETE ON
  contact_channels,
  identity_phones,
  phone_change_requests,
  integration_dispatches
FROM merit_dispatcher;

COMMIT;
