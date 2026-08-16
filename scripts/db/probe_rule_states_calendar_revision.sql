-- =============================================================================
-- Probe: ADR-047's calendar revision on rule_states, installed by 0035.
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASES, on the lesson DELTA_MANIFEST section 13
-- records: every probe that only ever attempts forbidden things passes against
-- a guard that rejects everything. On THIS migration that is not a stylistic
-- preference, because the obvious tightening of the column is the wrong one and
-- only a success case can see it. `calendar_revision_id` is NULLABLE, and NOT
-- NULL looks like completing the pair while actually refusing every state row
-- the engine writes until somebody has corrected the calendar at least once.
-- That is ADR-039's SUCCESS 2 in a different costume: a control that breaks the
-- ordinary path in order to guard the rare one. SUCCESS 1 is what fails the day
-- somebody adds it.
--
-- THE SECOND THING ONLY A SUCCESS CASE CAN SEE is that a state row may carry an
-- OLDER watermark than the current maximum (SUCCESS 4). The tempting guard,
-- `calendar_revision_id = (SELECT max(id) ...)` on INSERT, would pass EVERY
-- REJECTION IN THIS FILE and would force a row that genuinely read the older
-- calendar to claim one it never saw. `0035` header item 4 refuses to write it;
-- SUCCESS 4 is what stops it being added later by somebody who reads the
-- rejections and concludes the column is under-constrained. Both forms were
-- seeded: the naive guard fails at SUCCESS 1 because it refuses NULL as well,
-- and the refined guard that permits NULL passes SUCCESS 1, 2 and 3 and is
-- caught by SUCCESS 4 alone.
--
-- Rejections are checked BY MESSAGE where the class is ambiguous, never by
-- exception class alone. REJECTION 1 and REJECTION 2 both raise
-- foreign_key_violation, so a handler catching the class cannot tell "the
-- revision does not exist" from "the revision may not be deleted while a state
-- cites it", and either half could be deleted with both tests still passing.
--
-- WHAT THIS FILE CANNOT PROVE, stated rather than implied. The exclusion of
-- this column from `state_hash` is ADR-047's central ruling and NO DATABASE
-- ASSERTION CAN REACH IT: the hash is computed by the engine, and the engine is
-- P2. What is reachable is the CONTRACT, and `0015` deliberately put the hash
-- input set in a column comment because that comment is the only
-- machine-readable record of it (ADR-026 C-07). SUCCESS 6 asserts the comment
-- names this column among the exclusions, which is the difference between the
-- ruling being documented and the ruling being remembered.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- One identity, one funded account, three calendar days, and TWO corrections,
-- because a single revision cannot demonstrate the property the column exists
-- for: replay scopes by comparing watermarks, and a comparison needs two rows
-- that disagree.
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

INSERT INTO trading_calendar (trading_day, session_open_at, session_close_at)
VALUES (DATE '2026-06-01', '2026-05-31 22:00Z', '2026-06-01 21:00Z'),
       (DATE '2026-06-02', '2026-06-01 22:00Z', '2026-06-02 21:00Z'),
       (DATE '2026-06-03', '2026-06-02 22:00Z', '2026-06-03 21:00Z');

-- TWO CORRECTIONS, EACH THROUGH 0033's GUARD RATHER THAN AROUND IT. The
-- revision rows are not inserted bare: each is written with its prior image and
-- followed by the UPDATE it describes, which is how the loader writes one and
-- is what CALENDAR-C1 requires. A probe that inserted revision rows directly
-- would be stamping state rows with watermarks no correction ever produced, and
-- would prove the foreign key while proving nothing about the fact it points at.
DO $$
BEGIN
  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  SELECT t.trading_day, to_jsonb(t), 'probe', 'transcription slip on the close',
         sha256('source-a'::bytea), 0
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-01';
  UPDATE trading_calendar SET session_close_at = '2026-06-01 18:15Z',
                              is_half_day = true,
                              notes = 'per-group closes: ES 12:15 CT, GC 12:30 CT'
   WHERE trading_day = DATE '2026-06-01';

  INSERT INTO trading_calendar_revisions (trading_day, prior_row, actor, reason,
                                          source_digest, dependent_row_count)
  SELECT t.trading_day, to_jsonb(t), 'probe', 'holiday published after the fact',
         sha256('source-b'::bytea), 0
    FROM trading_calendar t WHERE t.trading_day = DATE '2026-06-03';
  UPDATE trading_calendar SET is_holiday = true,
                              session_open_at = NULL,
                              session_close_at = NULL
   WHERE trading_day = DATE '2026-06-03';

  SET CONSTRAINTS trading_calendar_revision_required IMMEDIATE;
  SET CONSTRAINTS trading_calendar_revision_required DEFERRED;
END $$;

-- The two watermarks this file scopes against, captured as they would be by a
-- fold: the maximum revision id that existed at the moment it ran.
CREATE TEMP TABLE probe_watermarks AS
SELECT min(id) AS older, max(id) AS newer FROM trading_calendar_revisions;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM trading_calendar_revisions;
  IF n <> 2 THEN
    RAISE EXCEPTION 'PROBE FAILED: fixture expected 2 revisions, found %', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: a rule state with NO calendar revision is written
-- ---------------------------------------------------------------------------
-- THE PRISTINE CASE, AND THE ONE A TIGHTENING WOULD BREAK. NULL means the fold
-- read a calendar that had never been corrected, which is the state of every
-- row this table holds until the first correction lands, and on a system whose
-- calendar has just been transcribed that is EVERY ROW THE ENGINE WILL EVER
-- WRITE for months. A NOT NULL on this column installs cleanly, satisfies every
-- other assertion in this file, and stops the engine dead.
DO $$
BEGIN
  INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                           floor_open_cents, high_water_balance_cents,
                           balance_cents, withdrawable_cents, traded_days_count,
                           win_days_count, payouts_settled_count,
                           engine_eligible, engine_gates, context_gates,
                           state_hash, engine_version, calendar_revision_id)
  VALUES ('11400000-0000-0000-0000-000000000001', DATE '2026-06-01', 'funded',
          4800000, 4800000, 5010000, 5010000, 210000, 1, 1, 0,
          false, '{}'::jsonb, '{}'::jsonb, sha256('state-1'::bytea), 'probe-0',
          NULL);
  RAISE NOTICE 'SUCCESS 1: a rule state may carry NO calendar revision (the pristine calendar)';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: a rule state stamped with a real revision is written
-- ---------------------------------------------------------------------------
-- The ordinary post-correction case. If this fails, ADR-047's whole mechanism
-- is unusable by the engine that has to write it.
DO $$
DECLARE
  newer bigint;
BEGIN
  SELECT w.newer INTO newer FROM probe_watermarks w;
  INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                           floor_open_cents, high_water_balance_cents,
                           balance_cents, withdrawable_cents, traded_days_count,
                           win_days_count, payouts_settled_count,
                           engine_eligible, engine_gates, context_gates,
                           state_hash, engine_version, calendar_revision_id)
  VALUES ('11400000-0000-0000-0000-000000000001', DATE '2026-06-02', 'funded',
          4800000, 4800000, 5010000, 5010000, 210000, 2, 1, 0,
          false, '{}'::jsonb, '{}'::jsonb, sha256('state-2'::bytea), 'probe-0',
          newer);
  RAISE NOTICE 'SUCCESS 2: a rule state may be stamped with the current calendar watermark';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: two rule states carrying DIFFERENT watermarks coexist
-- ---------------------------------------------------------------------------
-- THE PROPERTY THE COLUMN EXISTS FOR, and it is a success rather than a
-- rejection because what replay needs is the ability to DISAGREE. B.4 step 1
-- compares only rows whose stored version matches the running one; a schema
-- that forced every row to the same watermark would satisfy the foreign key,
-- read as tidy, and leave the scoping query with nothing to scope. The rows
-- written by SUCCESS 1 and SUCCESS 2 already disagree, and this asserts it
-- rather than assuming it.
DO $$
DECLARE
  distinct_marks integer;
  in_scope       integer;
  out_of_scope   integer;
  newer          bigint;
BEGIN
  SELECT w.newer INTO newer FROM probe_watermarks w;

  SELECT count(DISTINCT coalesce(calendar_revision_id, -1)) INTO distinct_marks
    FROM rule_states;
  IF distinct_marks < 2 THEN
    RAISE EXCEPTION
      'PROBE FAILED: every rule state carries the same watermark, so B.4 step 1 has nothing to scope';
  END IF;

  -- The scoping read itself, written exactly as the nightly audit would write
  -- it. Both halves are asserted: an audit that finds nothing in scope has
  -- stopped looking, and an audit that finds everything in scope is not
  -- scoping.
  SELECT count(*) INTO in_scope
    FROM rule_states WHERE calendar_revision_id IS NOT DISTINCT FROM newer;
  SELECT count(*) INTO out_of_scope
    FROM rule_states WHERE calendar_revision_id IS DISTINCT FROM newer;

  IF in_scope = 0 OR out_of_scope = 0 THEN
    RAISE EXCEPTION
      'PROBE FAILED: B.4 step 1 scoping partitioned % in scope and % out; a partition with an empty side is not a partition',
      in_scope, out_of_scope;
  END IF;
  RAISE NOTICE 'SUCCESS 3: rule states carry differing watermarks and B.4 step 1 partitions them (% in scope, % out)',
    in_scope, out_of_scope;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4: a state may be stamped with an OLDER watermark than the maximum
-- ---------------------------------------------------------------------------
-- THE CASE THAT PINS A DESIGN DECISION RATHER THAN A CONSTRAINT. A correction
-- that commits between the fold and the write leaves a state row that genuinely
-- read the older calendar. The honest stamp is the one the fold READ, and this
-- probe asserts the schema permits it, because the guard that would refuse it
-- (`= max(id)` on INSERT) would force the row to claim a calendar it never saw
-- and replay would then believe a stale row was current. Every rejection below
-- passes with that guard installed. This is the only assertion that fails.
DO $$
DECLARE
  older bigint;
  newer bigint;
BEGIN
  SELECT w.older, w.newer INTO older, newer FROM probe_watermarks w;
  IF older >= newer THEN
    RAISE EXCEPTION 'PROBE FAILED: fixture did not produce two distinct watermarks';
  END IF;

  INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                           floor_open_cents, high_water_balance_cents,
                           balance_cents, withdrawable_cents, traded_days_count,
                           win_days_count, payouts_settled_count,
                           engine_eligible, engine_gates, context_gates,
                           state_hash, engine_version, calendar_revision_id)
  VALUES ('11400000-0000-0000-0000-000000000001', DATE '2026-06-03', 'funded',
          4800000, 4800000, 5010000, 5010000, 210000, 3, 1, 0,
          false, '{}'::jsonb, '{}'::jsonb, sha256('state-3'::bytea), 'probe-0',
          older);
  RAISE NOTICE 'SUCCESS 4: a rule state may carry a watermark older than the maximum (the mid-batch correction)';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 5: the stamp reaches a prior image, and it is NOT this row's day
-- ---------------------------------------------------------------------------
-- THE ASSERTION THAT DEFENDS `0035` HEADER ITEM 2, and it is the one to read.
-- The column is only worth a foreign key if the join at the end of it answers
-- the question INV-04 asks: what did the calendar SAY when this state was
-- computed. But the join must be walked with the RIGHT semantics, and the
-- column name invites the wrong one.
--
-- The state row written by SUCCESS 4 is for 2026-06-03 and carries the OLDER
-- watermark, which is the correction to 2026-06-01. So the revision it reaches
-- is for A DIFFERENT DAY THAN ITS OWN, and that is not an accident of the
-- fixture: it is the property. A rule state is folded over the whole day
-- sequence from day one, so what it depends on is the calendar AS A WHOLE, and
-- a per-day pointer would scope replay to the corrected day and miss every
-- downstream counter, which is the entire failure ADR-047 exists to prevent.
--
-- So this asserts the NON-correspondence rather than tolerating it. A future
-- reader who "fixes" the column into a per-day reference, by joining on
-- trading_day or by constraining the two to agree, fails here and nowhere else.
DO $$
DECLARE
  prior_close text;
  said        jsonb;
  cited_day   date;
BEGIN
  SELECT r.prior_row, r.prior_row ->> 'session_close_at', r.trading_day
    INTO said, prior_close, cited_day
    FROM rule_states s
    JOIN trading_calendar_revisions r ON r.id = s.calendar_revision_id
   WHERE s.trading_day = DATE '2026-06-03';

  IF said IS NULL THEN
    RAISE EXCEPTION 'PROBE FAILED: a stamped rule state does not reach a prior image';
  END IF;
  IF prior_close IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: the prior image reached from a rule state carries no session_close_at: %', said;
  END IF;
  IF cited_day = DATE '2026-06-03' THEN
    RAISE EXCEPTION
      'PROBE FAILED: the watermark resolved to a revision of the state own trading_day. calendar_revision_id is the calendar the FOLD read, not the revision that corrected this row day (ADR-047, 0035 header item 2)';
  END IF;
  RAISE NOTICE 'SUCCESS 5: a rule state for % reaches the prior image of %, which said session_close_at = %. The watermark is the whole calendar, not this row day',
    DATE '2026-06-03', cited_day, prior_close;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 6: the state_hash contract names this column among the EXCLUSIONS
-- ---------------------------------------------------------------------------
-- ADR-047'S CENTRAL RULING, ASSERTED AS FAR AS A DATABASE CAN REACH IT. The
-- hash is computed by the engine and no constraint can inspect it, but the
-- INPUT SET is a contract and `0015` put that contract in this comment
-- deliberately, on ADR-026 C-07's finding that a hash whose input set is
-- implicit is a hash that changes meaning when a column is added. `0035` adds a
-- column. If the comment does not name it, the next reader has a nineteen-field
-- list, a twentieth column, and no statement about which side of the line it
-- falls on, which is precisely the state C-07 was written to end.
--
-- It asserts BOTH halves. That the column is named, and that it is named as
-- EXCLUDED rather than merely mentioned, because "calendar_revision_id"
-- appearing anywhere in the comment would satisfy a presence check while a
-- comment adding it to the hashed list would be the exact inversion of the
-- ruling.
DO $$
DECLARE
  doc text;
BEGIN
  SELECT col_description('rule_states'::regclass, a.attnum) INTO doc
    FROM pg_attribute a
   WHERE a.attrelid = 'rule_states'::regclass AND a.attname = 'state_hash';

  IF doc IS NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: rule_states.state_hash has no comment, so the hash input set has no machine-readable record at all (ADR-026 C-07)';
  END IF;
  IF doc NOT LIKE '%calendar_revision_id%' THEN
    RAISE EXCEPTION
      'PROBE FAILED: the state_hash contract does not mention calendar_revision_id, so a column was added to rule_states and the hash input set no longer says which side it is on: %',
      doc;
  END IF;
  IF doc NOT LIKE '%calendar_revision_id are excluded%' THEN
    RAISE EXCEPTION
      'PROBE FAILED: the state_hash contract mentions calendar_revision_id but does not list it as EXCLUDED. In the hash, one calendar correction diverges every row of every account at once (ADR-047): %',
      doc;
  END IF;
  RAISE NOTICE 'SUCCESS 6: the state_hash contract names calendar_revision_id among the exclusions';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: a watermark naming a revision that never existed
-- ---------------------------------------------------------------------------
-- WHAT THE FOREIGN KEY BUYS OVER AN INTEGER, and it is the reason ADR-047 rules
-- a REFERENCE rather than a copied value. A stored revision NUMBER accepts any
-- integer a writer types, so a fold that mis-reported its watermark by one
-- would scope replay against a calendar state that never existed and nothing
-- would say so. Here it cannot be written at all.
DO $$
DECLARE
  bogus bigint;
BEGIN
  SELECT max(id) + 1000 INTO bogus FROM trading_calendar_revisions;
  BEGIN
    INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                             floor_open_cents, high_water_balance_cents,
                             balance_cents, withdrawable_cents, traded_days_count,
                             win_days_count, payouts_settled_count,
                             engine_eligible, engine_gates, context_gates,
                             state_hash, engine_version, calendar_revision_id)
    VALUES ('11400000-0000-0000-0000-000000000001', DATE '2026-06-04', 'funded',
            4800000, 4800000, 5010000, 5010000, 210000, 4, 1, 0,
            false, '{}'::jsonb, '{}'::jsonb, sha256('state-4'::bytea), 'probe-0',
            bogus);
    RAISE EXCEPTION 'PROBE FAILED: a rule state cited a calendar revision that does not exist';
  EXCEPTION WHEN foreign_key_violation THEN
    IF SQLERRM NOT LIKE '%rule_states_calendar_revision_id_fkey%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the invented revision: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 1: a rule state may not cite a calendar revision that never existed';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: the cited revision may not be deleted out from under the state
-- ---------------------------------------------------------------------------
-- A STAMP WHOSE TARGET CAN VANISH IS A CITATION TO A DELETED DOCUMENT. This is
-- ON DELETE RESTRICT firing, and it is the second lock rather than the first:
-- `0032` already revoked DELETE from merit_app and PUBLIC, which REJECTION 4
-- covers. Both are here because a revoke does not bind the table owner and a
-- foreign key does, so the pair covers the superuser path and the application
-- path separately.
DO $$
DECLARE
  cited bigint;
BEGIN
  SELECT calendar_revision_id INTO cited
    FROM rule_states WHERE calendar_revision_id IS NOT NULL LIMIT 1;
  IF cited IS NULL THEN
    RAISE EXCEPTION 'PROBE FAILED: no stamped rule state exists to test the restrict against';
  END IF;
  BEGIN
    DELETE FROM trading_calendar_revisions WHERE id = cited;
    RAISE EXCEPTION 'PROBE FAILED: a calendar revision was deleted while a rule state cited it';
  EXCEPTION WHEN foreign_key_violation THEN
    IF SQLERRM NOT LIKE '%rule_states%' THEN
      RAISE EXCEPTION 'PROBE FAILED: wrong finding for the deleted revision: %', SQLERRM;
    END IF;
    RAISE NOTICE 'REJECTION 2: a cited calendar revision may not be deleted (ON DELETE RESTRICT)';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: merit_app may not REWRITE a revision the states point at
-- ---------------------------------------------------------------------------
-- THE ASSERTION THE WATERMARK RESTS ON, and it is a GRANT rather than a
-- constraint. `id <= N` describes every correction the calendar had undergone
-- at watermark N only because the rows below N cannot change. If the prior
-- image at revision 7 can be rewritten, then two folds carrying watermark 7
-- read different calendars and the column is decoration. `0034`'s run is the
-- precedent for attempting the write rather than reading the catalogue: a
-- catalogue query proves what was granted, an attempted write proves what the
-- database will do.
DO $$
BEGIN
  SET LOCAL ROLE merit_app;
  BEGIN
    UPDATE trading_calendar_revisions SET reason = 'rewritten after the fact';
    RESET ROLE;
    RAISE EXCEPTION 'PROBE FAILED: merit_app rewrote a calendar revision a rule state cites';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTION 3: merit_app may not rewrite a calendar revision (the watermark is immutable)';
  END;
  RESET ROLE;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: merit_app may not DELETE a revision either
-- ---------------------------------------------------------------------------
-- REJECTION 2's other half. The foreign key protects a revision that is CITED;
-- this protects one that is not yet cited, which is every revision between the
-- correction landing and the next fold running. Without it, a correction could
-- be erased in the window before any state row referenced it, and the calendar
-- would have moved twice with one revision on the record.
DO $$
BEGIN
  SET LOCAL ROLE merit_app;
  BEGIN
    DELETE FROM trading_calendar_revisions;
    RESET ROLE;
    RAISE EXCEPTION 'PROBE FAILED: merit_app deleted calendar revisions';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'REJECTION 4: merit_app may not delete a calendar revision';
  END;
  RESET ROLE;
END $$;

-- ---------------------------------------------------------------------------
-- Nothing is kept. Every assertion above ran inside this transaction.
-- ---------------------------------------------------------------------------
-- There is no deferred constraint to force here, unlike
-- probe_calendar_revision_required.sql: every assertion in this file is an
-- immediate foreign key, an immediate privilege check or a query, and each has
-- already fired by the time its DO block returns. The fixture's own two
-- corrections DO cross 0033's deferred trigger, and they force it explicitly
-- rather than leaving it to a COMMIT that never comes.
ROLLBACK;
