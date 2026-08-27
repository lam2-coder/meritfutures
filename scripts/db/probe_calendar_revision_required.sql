-- =============================================================================
-- Probe: ADR-045's CALENDAR-C1 and CALENDAR-C2, installed by 0033.
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASES, on the lesson DELTA_MANIFEST section 13
-- records: every probe that only ever attempts forbidden things passes against
-- a guard that rejects everything. A trigger that refused all calendar writes
-- would satisfy an inventory of refusals perfectly, and would also stop the
-- loader from ever writing a correction.
--
-- IT FORCES THE DEFERRED CHECK RATHER THAN WAITING FOR A COMMIT THAT NEVER
-- COMES. CALENDAR-C1 is a DEFERRABLE INITIALLY DEFERRED constraint trigger, and
-- this file ends in ROLLBACK like every other probe here, so a success case
-- left to fire "at commit" would never be checked at all: the probe would
-- report six green successes having verified none of them. `SET CONSTRAINTS
-- trading_calendar_revision_required IMMEDIATE` applies the pending checks
-- retroactively, which is the documented behaviour and is what makes every
-- assertion below actually run.
--
-- Rejections are checked BY MESSAGE, never by exception class. Both halves of
-- CALENDAR-C1 raise check_violation, so a handler catching the class cannot
-- tell "no prior image" from "the count is wrong", and the counted half could
-- be deleted with every rejection test still passing.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- One identity, one funded account, and one dependent row in EACH of the three
-- tables the ruled partition names. Three tables and not one, because a count
-- that reads two of them passes every test written against those two.
INSERT INTO identities (id, status) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'active');
INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000001',
   'aa000000-0000-0000-0000-000000000001',
   'Probe@Example.test', 'probe@example.test');
INSERT INTO plans (id, code, name) VALUES
  ('11100000-0000-0000-0000-000000000001', 'core_eod', 'Core EOD');
INSERT INTO plan_versions (id, plan_id, version, status, rules, public_slug,
                           created_by) VALUES
  ('11200000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000001', 1, 'draft', '{}'::jsonb,
   'core-eod-v1', 'bb000000-0000-0000-0000-000000000001');
INSERT INTO purchases (id, identity_id, user_id, plan_version_id, size_cents,
                       kind, list_price_cents, amount_paid_cents, psp,
                       psp_reference, status, paid_at)
VALUES ('11300000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000001',
        'bb000000-0000-0000-0000-000000000001',
        '11200000-0000-0000-0000-000000000001', 5000000, 'new', 9900, 9900,
        'psp_a', 'probe-psp-ref-1', 'paid', now());
INSERT INTO accounts (id, identity_id, user_id, purchase_id, plan_version_id,
                      size_cents, phase, status, opened_on, funded_on)
VALUES ('11400000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000001',
        'bb000000-0000-0000-0000-000000000001',
        '11300000-0000-0000-0000-000000000001',
        '11200000-0000-0000-0000-000000000001',
        5000000, 'funded', 'active', current_date, current_date);

-- TWO calendar days. QUIET carries nothing; BUSY carries one fill, one mark and
-- one rule state, which is what makes a correction to it an INCIDENT.
INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
VALUES (DATE '2026-06-01', '2026-05-31 22:00Z', '2026-06-01 21:00Z'),
       (DATE '2026-06-02', '2026-06-01 22:00Z', '2026-06-02 21:00Z');

INSERT INTO ingest_files (id, file_name, sha256, kind, byte_size)
VALUES ('11500000-0000-0000-0000-000000000001', 'probe.csv',
        sha256('probe'::bytea), 'fills', 1);
INSERT INTO raw_ingest_rows (id, ingest_file_id, line_number, raw)
OVERRIDING SYSTEM VALUE
VALUES (1, '11500000-0000-0000-0000-000000000001', 1, '{}'::jsonb);
INSERT INTO fills (account_id, platform_fill_id, symbol, side, quantity,
                   price_numerator, price_denominator, executed_at,
                   trading_day, ingest_file_id, raw_row_id)
VALUES ('11400000-0000-0000-0000-000000000001', 'probe-fill-1', 'ES', 'buy', 1,
        500000, 100, '2026-06-02 14:00Z', DATE '2026-06-02',
        '11500000-0000-0000-0000-000000000001', 1);
INSERT INTO daily_marks (account_id, trading_day, opening_balance_cents,
                         closing_balance_cents, high_balance_cents,
                         low_balance_cents, realized_pnl_cents, fill_count,
                         traded_day, win_day, source_hash, source)
VALUES ('11400000-0000-0000-0000-000000000001', DATE '2026-06-02',
        5000000, 5010000, 5010000, 5000000, 10000, 1, true, true,
        sha256('mark'::bytea), 'report');
INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                         floor_open_cents, high_water_balance_cents,
                         balance_cents, withdrawable_cents, traded_days_count,
                         win_days_count, payouts_settled_count,
                         engine_eligible, engine_gates, context_gates,
                         state_hash, engine_version)
VALUES ('11400000-0000-0000-0000-000000000001', DATE '2026-06-02', 'funded',
        4800000, 4800000, 5010000, 5010000, 210000, 1, 1, 0,
        false, '{}'::jsonb, '{}'::jsonb, sha256('state'::bytea), 'probe-0');

-- ---------------------------------------------------------------------------
-- SUCCESS 1: an INSERT needs no prior image
-- ---------------------------------------------------------------------------
-- The whole seed is INSERTs. A guard that demanded an image for a day that did
-- not previously exist would refuse the first load of the calendar, which is
-- the shape of "fail closed" that fails the wrong thing.
DO $$
BEGIN
  INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
  VALUES (DATE '2026-06-03', '2026-06-02 22:00Z', '2026-06-03 21:00Z');
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
  RAISE NOTICE 'SUCCESS 1: an INSERT of a calendar day needs no prior image';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: a correction with its prior image commits, IMAGE FIRST
-- ---------------------------------------------------------------------------
-- The ordinary case: a quiet day, nothing depends on it, count zero, no
-- incident. If this fails, ADR-042 F-2's own machinery has been made unusable
-- by the guard that was supposed to enforce it.
DO $$
BEGIN
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  SELECT t.trading_day, to_jsonb(t), 'probe', 'transcription slip on the close',
         sha256('source'::bytea), 0
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-01';
  UPDATE trading_calendar SET session_close_at = '2026-06-01 18:15Z',
                              is_half_day = true,
                              notes = 'per-group closes: ES 12:15 CT, GC 12:30 CT'
   WHERE trading_day = DATE '2026-06-01';
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
  RAISE NOTICE 'SUCCESS 2: a correction carrying its prior image commits';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: the image may be written AFTER the update
-- ---------------------------------------------------------------------------
-- This is what DEFERRABLE INITIALLY DEFERRED buys, and it is the reason the
-- trigger is deferred at all: the order of two writes inside one transaction is
-- the loader's business. A non-deferred AFTER UPDATE trigger would refuse this
-- transaction and nothing would say why.
DO $$
DECLARE
  image jsonb;
BEGIN
  SELECT to_jsonb(t) INTO image
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-01';
  UPDATE trading_calendar SET halted = true WHERE trading_day = DATE '2026-06-01';
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  VALUES (DATE '2026-06-01', image, 'probe', 'exchange halt published late',
          sha256('source'::bytea), 0);
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
  RAISE NOTICE 'SUCCESS 3: the prior image may be written after the update';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4: a day with dependents, counted correctly, naming an incident
-- ---------------------------------------------------------------------------
-- Three dependent rows across the three ruled tables. The count is 3 and the
-- incident is named, so this is the INCIDENT path working rather than being
-- refused.
DO $$
BEGIN
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count,
                                          incident_ref)
  SELECT t.trading_day, to_jsonb(t), 'ops@merit', 'holiday published after the fact',
         sha256('source'::bytea), 3, 'INC-2026-06-02-01'
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-02';
  UPDATE trading_calendar SET halted = true WHERE trading_day = DATE '2026-06-02';
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
  RAISE NOTICE 'SUCCESS 4: a correction to a day with 3 dependents commits when it counts them and names an incident';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: an update with no prior image at all
-- ---------------------------------------------------------------------------
-- OI-06 in one statement. This is what a hand-run UPDATE against the calendar
-- did on 2026-08-16, and it is what ADR-045 exists to stop.
DO $$
BEGIN
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  BEGIN
    UPDATE trading_calendar SET notes = 'no image written'
     WHERE trading_day = DATE '2026-06-01';
    RAISE EXCEPTION 'PROBE FAILED: a calendar correction committed with no prior image';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C1%no%prior image%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the missing image: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 1: CALENDAR-C1 refused a correction with no prior image';
  END;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: an image of the WRONG state
-- ---------------------------------------------------------------------------
-- The nastier version, because a row exists in the revisions table and a
-- reviewer counting rows sees one. The image is the row as it will be AFTER the
-- update, which is what a loader that captured its image one statement too late
-- would write, and it answers a different question than replay is asking.
DO $$
DECLARE
  wrong jsonb;
BEGIN
  SELECT to_jsonb(t) INTO wrong FROM trading_calendar t
   WHERE t.trading_day = DATE '2026-06-01';
  wrong := jsonb_set(wrong, '{notes}', '"an image of a state that never was"');
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  VALUES (DATE '2026-06-01', wrong, 'probe', 'image of the wrong state',
          sha256('source'::bytea), 0);
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  BEGIN
    UPDATE trading_calendar SET notes = 'the real new value'
     WHERE trading_day = DATE '2026-06-01';
    RAISE EXCEPTION 'PROBE FAILED: an image of a different state was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C1%no%prior image%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the wrong-state image: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 2: CALENDAR-C1 refused an image that is not the prior state';
  END;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: an image built by hand rather than by the database
-- ---------------------------------------------------------------------------
-- It carries all four keys the prior_row CHECK requires and it renders the
-- timestamps the way an application would. That CHECK passes and CALENDAR-C1
-- does not, which is the point: the image is `to_jsonb(OLD)` or it is a
-- hand-written column list wearing a JSON costume, and a hand-written column
-- list is missing whatever a later migration adds.
DO $$
BEGIN
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  VALUES (DATE '2026-06-01',
          jsonb_build_object('trading_day', '2026-06-01',
                             'is_holiday', false,
                             'session_open_at', '2026-05-31T22:00:00Z',
                             'session_close_at', '2026-06-01T18:15:00Z'),
          'probe', 'assembled in application code',
          sha256('source'::bytea), 0);
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  BEGIN
    UPDATE trading_calendar SET notes = 'hand-built image'
     WHERE trading_day = DATE '2026-06-01';
    RAISE EXCEPTION 'PROBE FAILED: a hand-assembled image was accepted as the prior row';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C1%no%prior image%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the hand-built image: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 3: CALENDAR-C1 refused an image the database did not derive';
  END;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: THE BYPASS THE COUNTED HALF EXISTS TO CLOSE
-- ---------------------------------------------------------------------------
-- A correct prior image, a real reason, an honest actor, and
-- `dependent_row_count = 0` on a day carrying three dependent rows. Every
-- CHECK on trading_calendar_revisions passes, because
-- trading_calendar_revisions_incident_named_when_dependent reads the claimed
-- number and nothing else. WITHOUT THIS ASSERTION, AN INCIDENT BECOMES AN
-- ORDINARY DATA CHANGE BY TYPING A ZERO.
DO $$
BEGIN
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  SELECT t.trading_day, to_jsonb(t), 'ops@merit', 'nothing depends on this day',
         sha256('source'::bytea), 0
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-02';
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  BEGIN
    UPDATE trading_calendar SET notes = 'corrected quietly'
     WHERE trading_day = DATE '2026-06-02';
    RAISE EXCEPTION 'PROBE FAILED: a day with 3 dependent rows was corrected claiming 0';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C1%has 3 dependent row(s)%claims 0%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the miscounted dependents: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 4: CALENDAR-C1 counted 3 dependents against a claim of 0';
  END;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: two corrections in one transaction, one image
-- ---------------------------------------------------------------------------
-- The trigger is FOR EACH ROW on each update event, not once per transaction,
-- so the second correction needs the image of the state the first one left.
-- A per-transaction check would accept this and lose an entire intermediate
-- state from the replay record.
DO $$
BEGIN
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  SELECT t.trading_day, to_jsonb(t), 'probe', 'first of two corrections',
         sha256('source'::bytea), 0
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-01';
  UPDATE trading_calendar SET notes = 'first correction'
   WHERE trading_day = DATE '2026-06-01';
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  BEGIN
    UPDATE trading_calendar SET notes = 'second correction, no second image'
     WHERE trading_day = DATE '2026-06-01';
    RAISE EXCEPTION 'PROBE FAILED: a second correction rode on the first image';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C1%no%prior image%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the second correction: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 5: CALENDAR-C1 required a second image for a second correction';
  END;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6: a no-op update is an update
-- ---------------------------------------------------------------------------
-- There is no exempt column and there is no exempt update. This is stated as an
-- assertion rather than as prose because it is a real obligation on the loader:
-- an unconditional upsert over a full year would demand an image for every row
-- it rewrote to the same values. `ON CONFLICT DO UPDATE ... WHERE t IS DISTINCT
-- FROM excluded` is the shape that does not.
DO $$
BEGIN
  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  BEGIN
    UPDATE trading_calendar SET notes = notes
     WHERE trading_day = DATE '2026-06-01';
    RAISE EXCEPTION 'PROBE FAILED: an update that changed nothing skipped the image';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C1%no%prior image%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the no-op update: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 6: CALENDAR-C1 refused an update that changed nothing and left no image';
  END;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 7: DELETE, which is how CALENDAR-C1 would otherwise be bypassed
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    DELETE FROM trading_calendar WHERE trading_day = DATE '2026-06-03';
    RAISE EXCEPTION 'PROBE FAILED: a calendar day was deleted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C2%may not be deleted%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the delete: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 7: CALENDAR-C2 refused a delete of a day nothing had corrected';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 8: TRUNCATE, INCLUDING THE FORM THAT DEFEATS THE FOREIGN KEY
-- ---------------------------------------------------------------------------
-- `TRUNCATE trading_calendar` alone fails on the revisions foreign key, and a
-- probe that stopped there would be testing PostgreSQL rather than this
-- migration. The form below defeats the foreign key, so the only thing standing
-- between an operator and an empty calendar with an empty audit trail is
-- CALENDAR-C2.
--
-- IT WAS A HAND-MAINTAINED TABLE LIST UNTIL `0035`, and `0035` broke it. The
-- statement read `TRUNCATE trading_calendar, trading_calendar_revisions`, which
-- named every table in the dependency graph AS OF `0033`. ADR-047 added
-- `rule_states.calendar_revision_id`, a third table entered the graph, and the
-- statement started failing with `cannot truncate a table referenced in a
-- foreign key constraint` BEFORE CALENDAR-C2 could fire. The guard was intact
-- the whole time; the probe had gone blind to it, and the wrong-finding check
-- two lines down is what said so rather than a silent pass.
--
-- CASCADE IS THE FIX BECAUSE IT IS NOT A LIST. PostgreSQL derives the
-- referencing set itself, so the next migration to reference either table
-- cannot break this assertion the way `0035` did. It is also the STRONGER test:
-- CASCADE is the form an operator with a deadline actually reaches for, and it
-- is the one that empties the audit trail and the states along with the
-- calendar. This is the positional-assertion lesson (OI-08) in a new costume: a
-- hand-maintained list does not fail when it goes stale, it keeps passing
-- against less, and here it did not even do that.
--
-- AND `0048` BROKE IT A SECOND TIME, FOR A DIFFERENT REASON, WHICH IS WHY THE
-- FLUSH BELOW EXISTS. ADR-128 supersedes
-- `trading_calendar_revisions_trading_day_fkey` as DEFERRABLE INITIALLY
-- DEFERRED, so that a backfill can record the absence of a day BEFORE adding it
-- and CALENDAR-C3 can be checked at the moment of insert rather than at commit.
-- Every revision row this file writes therefore leaves a pending foreign-key
-- event, and PostgreSQL refuses to TRUNCATE a table that has pending trigger
-- events AT ALL: `cannot TRUNCATE "trading_calendar_revisions" because it has
-- pending trigger events`, raised before any statement trigger fires. The probe
-- met an error from the executor instead of the finding it was written to
-- observe, AND THE WRONG-FINDING CHECK BELOW SAID SO LOUDLY FOR THE SECOND TIME.
--
-- CALENDAR-C2 IS INTACT AND THE OPERATIONAL FACT IS WORTH MORE THAN THE REPAIR.
-- An operator truncating in a fresh transaction still meets CALENDAR-C2. What
-- changed is that inside a transaction which has already written a revision row,
-- the refusal now arrives from PostgreSQL with a message that explains nothing
-- about why this calendar may not be emptied. Flushing the pending events first
-- is what makes this assertion test CALENDAR-C2 rather than that interaction.
DO $$
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    TRUNCATE trading_calendar CASCADE;
    RAISE EXCEPTION 'PROBE FAILED: the calendar was truncated together with everything referencing it';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%CALENDAR-C2%may not be truncated%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the truncate: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 8: CALENDAR-C2 refused a cascading truncate that the foreign keys would have allowed';
  END;
END $$;

ROLLBACK;

\echo 'probe_calendar_revision_required: every success case succeeded and every rejection fired.'
