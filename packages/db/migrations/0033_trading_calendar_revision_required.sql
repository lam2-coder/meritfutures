-- =============================================================================
-- 0033_trading_calendar_revision_required
-- =============================================================================
-- E2 READ: MONEY PATH. This file guards the table that decides what a trading
-- day IS. Every counter the engine keeps is counted in trading days (R-01,
-- R-02, R-05, R-34, R-37, R-47), and A WRONG ROW CHANGES RULE OUTCOMES WITH NO
-- CHANGE TO A LINE OF ENGINE CODE.
--
-- ADR-044, ACCEPTED 2026-08-16. It closes OI-06 as raised by the session that
-- wrote 0032: ADR-042 F-2 ruled the prior-image TABLE and ruled nothing about
-- what obliges anybody to write to it, so F-2 landed as a table nobody is
-- required to use. The loader writes the image because its own code says so.
-- A hand-run UPDATE writes nothing, and INV-04's replay is then back exactly
-- where F-2 found it: unable to tell a calendar correction from an engine
-- regression, on the nightly self-audit, at the moment somebody is paging.
--
-- THIS FILE ASSERTS. IT DOES NOT WRITE, and that is 0027's idiom rather than a
-- preference. Not one guard in 0027 repairs anything; each raises on a
-- transaction that is already wrong. A trigger that wrote the prior image
-- itself would have to invent an `actor` and a `reason`, and a reason nobody
-- gave is the exact thing trading_calendar_revisions.reason exists to refuse:
-- it is NOT NULL and non-blank because a prior image with no reason records
-- that the calendar moved and not that anybody decided it should. So the
-- database's answer to a correction with no reason is to REFUSE THE
-- CORRECTION, never to write a reason of its own.
--
-- Nothing here edits a merged file. 0004, 0027 and 0032 stay exactly as they
-- were written and this file changes what they installed. Migrations are
-- sacred once merged (constitution E2), which is a rule about editing them and
-- not a rule against correcting them. 0028's precedent, applied a third time.
--
-- No numbered delta lands here. ADR-044 is a ruling on an open item, not a
-- schema delta, so ADR-026's manifest completeness gate has nothing to count
-- and the record is DELTA_MANIFEST section 17 instead.
--
-- FIVE things need the founder's line-by-line read:
--
--   1. THE IMAGE IS COMPARED AS `jsonb`, AND THAT FORCES THE LOADER TO BUILD IT
--      IN THE DATABASE. The assertion is `prior_row = to_jsonb(OLD)`. An image
--      assembled in application code will not equal it: Node renders a
--      timestamp differently from PostgreSQL, and a column list written by hand
--      in TypeScript is missing whatever a later migration adds. THAT IS THE
--      FEATURE. 0032 made the image DERIVED rather than LISTED for exactly this
--      reason, and an application-built image is a hand-written column list
--      wearing a JSON costume. The loader writes
--      `INSERT INTO trading_calendar_revisions (prior_row, ...) SELECT
--      to_jsonb(t), ... FROM trading_calendar t WHERE trading_day = $1`, before
--      or after the UPDATE, in the same transaction.
--
--   2. THE COUNTED HALF IS ONE ASSERTION MORE THAN THE RULING NAMES, and it is
--      separately rejectable. `dependent_row_count` was SELF-REPORTED. The
--      CHECK that makes an incident an incident,
--      trading_calendar_revisions_incident_named_when_dependent, reads that
--      number and nothing else, so WRITING ZERO SKIPPED THE INCIDENT
--      REQUIREMENT ENTIRELY on a day a hundred marks depended on. An audit
--      control whose input is supplied by the party being audited is a form,
--      not a control. So the trigger recounts, over the three tables P1 S-E
--      section 4 partitions on and no others. Reject this half if the founder
--      reads the ruling narrowly; CALENDAR-C1's image half stands without it.
--
--   3. CALENDAR-C2 REFUSES DELETE AND TRUNCATE, because DELETE followed by
--      INSERT is an UPDATE with the control removed, and TRUNCATE is the
--      documented way past a row trigger. Today's protection is real and
--      INVERTED: trading_calendar_revisions.trading_day is ON DELETE RESTRICT,
--      so a day that has already been corrected cannot be deleted and a day
--      nobody has ever touched can be. The rows the audit trail protects are
--      exactly the rows that already have one.
--
--   4. THERE IS NO EXEMPT COLUMN. A `notes` typo fix writes a revision row
--      whose reason says "typo", and that is the intended outcome. The
--      alternative is a list of columns that do not need an image, and a list
--      is the thing 0026's revoke list and every hand-maintained count in this
--      corpus have already demonstrated. A NO-OP UPDATE IS AN UPDATE: the
--      loader S-E4 writes must not re-issue an UPDATE for a row whose values
--      did not move, which is `ON CONFLICT DO UPDATE ... WHERE t IS DISTINCT
--      FROM excluded` rather than an unconditional upsert.
--
--   5. IT IS DEFERRED, for the same reason 0027's zero-sum and STAT-C1 triggers
--      are deferred. The image and the UPDATE arrive in one transaction in an
--      order the database has no business dictating, and a non-deferred AFTER
--      UPDATE trigger would silently require the image to be written first,
--      which is a second contract nobody wrote down. Deferring makes the
--      assertion a statement about the TRANSACTION, which is what a correction
--      actually is.
--
-- WHAT IS NOT HERE, deliberately: no loader, no source file, no rows, and no
-- index on rule_states (trading_day). See the note at the count query.
-- trading_calendar has zero rows today, so nothing below can be read as
-- evidence that any row satisfies it; scripts/db/probe_calendar_revision_
-- required.sql is where the evidence is, and it runs in CI on every push.
--
-- Rulings: ADR-044 (CALENDAR-C1, CALENDAR-C2). Supersedes nothing on disk: it
--          adds guards to what 0004 and 0032 installed, and 0027 is where the
--          invariant triggers live, which is the idiom this file follows.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- CALENDAR-C1: a correction to trading_calendar leaves a prior image, or it
--              does not commit
-- -----------------------------------------------------------------------------
-- ADR-044, closing OI-06. INV-04 is "replaying every mark from day one
-- reproduces stored state byte-identically", and it is defined against a table
-- whose rows can move. trading_calendar carries updated_at and notes and no
-- prior image, so on its own IT CANNOT ANSWER WHAT THE CALENDAR SAID ON THE DAY
-- THE ENGINE READ IT.
--
-- GIT IS REAL HISTORY AND IS THE WRONG HISTORY (ADR-042 F-2). It records what
-- the FILE said. The mark was computed against the DATABASE.
CREATE FUNCTION assert_calendar_correction_has_prior_image() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  image     jsonb := to_jsonb(OLD);
  claimed   integer;
  actual    integer;
BEGIN
  -- THE DEPENDENCY COUNT, COUNTED BY THE DATABASE RATHER THAN CLAIMED BY THE
  -- WRITER. The three tables are P1 S-E section 4's partition, verbatim.
  -- `reconciliations` and `ingest_files` also carry a trading_day and are
  -- deliberately NOT counted: the ruled partition names three tables, and
  -- widening it is a founder's call rather than a migration's.
  --
  -- fills and daily_marks each have a trading_day index. rule_states does not,
  -- and it is not given one here: rule_states is written once per account per
  -- day by the engine, so an index serving a query that runs only on a calendar
  -- CORRECTION would be paid for on every mark of every account forever. A
  -- sequential scan on the rarest write in the system is the cheaper side of
  -- that trade, and it is a trade rather than an oversight.
  SELECT (SELECT count(*) FROM fills       f WHERE f.trading_day = OLD.trading_day)
       + (SELECT count(*) FROM daily_marks m WHERE m.trading_day = OLD.trading_day)
       + (SELECT count(*) FROM rule_states s WHERE s.trading_day = OLD.trading_day)
    INTO actual;

  -- `prior_row = image` is a jsonb comparison, so key order does not matter and
  -- a rendering difference does. See header item 1: that is what makes the
  -- image the database's own to_jsonb(OLD) rather than something an application
  -- assembled and believes is equivalent.
  SELECT r.dependent_row_count INTO claimed
    FROM trading_calendar_revisions r
   WHERE r.trading_day = OLD.trading_day
     AND r.prior_row   = image
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'CALENDAR-C1: trading_calendar day % was updated and no '
      'trading_calendar_revisions row carries its prior image. A correction '
      'with no prior image cannot be told from an engine regression at replay '
      '(INV-04), which is what ADR-042 F-2 exists to prevent. Write '
      'to_jsonb(OLD) of the row, in this transaction, with an actor and a '
      'reason. See ADR-044.',
      OLD.trading_day
      USING ERRCODE = 'check_violation';
  END IF;

  -- THE HALF THAT MAKES THE INCIDENT REQUIREMENT REAL. Without it the writer
  -- picks its own dependent_row_count, and picking zero is how a correction to
  -- a day a hundred marks depend on becomes an ordinary data change with no
  -- incident named. Header item 2.
  IF claimed <> actual THEN
    RAISE EXCEPTION
      'CALENDAR-C1: trading_calendar day % has % dependent row(s) across '
      'fills, daily_marks and rule_states and its prior image claims %. The '
      'count decides whether this is a data change or an incident '
      '(P1 S-E section 4), so it is counted rather than reported. See ADR-044.',
      OLD.trading_day, actual, claimed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED, on 0027's zero-sum precedent: the revision row
-- and the UPDATE are one transaction, and requiring an order between them would
-- be a contract written in a trigger and nowhere else. Header item 5.
CREATE CONSTRAINT TRIGGER trading_calendar_revision_required
  AFTER UPDATE ON trading_calendar
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_calendar_correction_has_prior_image();

-- -----------------------------------------------------------------------------
-- CALENDAR-C2: a trading_calendar row is corrected, never removed
-- -----------------------------------------------------------------------------
-- ADR-044. CALENDAR-C1 without this is a guard whose bypass is one extra
-- statement: DELETE the row, INSERT the corrected one, and the day has changed
-- with no prior image and no revision row anywhere.
--
-- TRUNCATE is named because TRUNCATE FIRES NO ROW TRIGGERS AT ALL. This corpus
-- has already found two guards that passed by not looking: a CHECK on
-- array_length that admitted the empty array (ADR-035), and a NO-FLOATS DO
-- block that read the schema as of 0027 while five later migrations landed
-- outside it (OI-08). A row-level guard with a statement-level bypass is the
-- same shape. A REVOKE would not close it either, because a revoke does not
-- bind the table owner and a trigger does.
--
-- THE ESCAPE HATCH EXISTS AND IT IS AUDITABLE, which is what makes an outright
-- refusal acceptable rather than merely strict. A day that should never have
-- been transcribed is corrected by marking it is_holiday with no session: a
-- POSITIVE FACT (ADR-042 F-1), leaving a prior image, refused by CALENDAR-C1 if
-- it leaves none. Nothing about this calendar needs a row to vanish, and the
-- one operation that makes a row vanish is the one operation that can leave no
-- trace of what it said.
CREATE FUNCTION refuse_trading_calendar_row_removal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'CALENDAR-C2: trading_calendar day % may not be deleted. A calendar day '
      'is CORRECTED, never removed: mark it is_holiday with no session, which '
      'leaves a prior image (ADR-042 F-1). DELETE then INSERT is an UPDATE with '
      'the audit trail removed. See ADR-044.',
      OLD.trading_day
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE EXCEPTION
    'CALENDAR-C2: trading_calendar may not be truncated. TRUNCATE fires no row '
    'triggers, so it is the one statement that walks past CALENDAR-C1 and '
    'leaves no prior image for any day at once. See ADR-044.'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER trading_calendar_no_delete
  BEFORE DELETE ON trading_calendar
  FOR EACH ROW EXECUTE FUNCTION refuse_trading_calendar_row_removal();

CREATE TRIGGER trading_calendar_no_truncate
  BEFORE TRUNCATE ON trading_calendar
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_trading_calendar_row_removal();

COMMIT;
