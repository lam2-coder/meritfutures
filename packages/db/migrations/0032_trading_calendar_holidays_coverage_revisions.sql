-- =============================================================================
-- 0032_trading_calendar_holidays_coverage_revisions
-- =============================================================================
-- E2 READ: MONEY PATH. This file changes the table that decides what a trading
-- day IS. Every counter the engine keeps is counted in trading days (R-01,
-- R-02, R-05, R-34, R-37, R-47), and A WRONG ROW CHANGES RULE OUTCOMES WITH NO
-- CHANGE TO A LINE OF ENGINE CODE, silently, because the engine is a pure
-- function of the calendar it is handed and three mechanisms guarantee it
-- cannot check for itself: `types: []`, `merit/engine-purity`, and RI-01.
--
-- ADR-042, ACCEPTED 2026-08-15. F-1 through F-4, all four ruled, and the four
-- are one migration or none.
--
-- Nothing here edits a merged file. 0004_catalog stays exactly as it was
-- written and this file changes what it installed. Migrations are sacred once
-- merged (constitution E2), which is a rule about editing them, not a rule
-- against correcting them. This is 0028's precedent, applied a second time.
--
-- No numbered delta lands here. F-1 to F-4 are ADR-042 findings, not `SD-nn`
-- rows, so ADR-026's manifest completeness gate has nothing to count and the
-- record is DELTA_MANIFEST section 14 instead.
--
-- SIX things need the founder's line-by-line read:
--
--   1. F-1 AND THE NULL-PASSES TRAP, WHICH IS THE MOST DANGEROUS LINE IN THIS
--      FILE. Dropping NOT NULL from a column named inside an existing CHECK
--      does not make the CHECK null-safe; it makes it VACUOUS on the rows that
--      now carry NULL, because `session_close_at > session_open_at` evaluates
--      to NULL when either side is NULL and A CHECK THAT EVALUATES TO NULL
--      PASSES. That is the identical defect ADR-035 found seven times in the
--      `array_length` form and fixed in 0028. So the ordering constraint is not
--      merely widened, it is rewritten to admit the two states that are
--      legitimate and nothing else: BOTH columns null (a holiday) or BOTH
--      non-null and ordered (a session). A holiday with an open and no close,
--      or a close and no open, is rejected. The ruled CHECK
--      `is_holiday = (session_open_at IS NULL)` names ONE of the two columns;
--      on its own it would leave a holiday free to carry a close time, and the
--      pairing above is what closes that.
--
--   2. F-2's `dependent_row_count`, WHICH IS ONE COLUMN MORE THAN ADR-042
--      LISTS. The ADR names five fields: prior row image, actor, reason, source
--      digest, incident reference. The plan's section 4 partitions a correction
--      by whether `fills`, `daily_marks` or `rule_states` depend on the day and
--      says the partition is ASSERTED RATHER THAN JUDGED. Without the asserted
--      count stored, `incident_ref` is nullable with nothing saying when it may
--      be null, so "an incident, not a data edit" is a convention. With it, a
--      correction to a day anything depends on CANNOT be written without naming
--      an incident. Read this column and reject it if the founder reads the
--      ruling as five fields exactly.
--
--   3. F-2 CARRIES NO TRIGGER, AND THAT IS A GAP RATHER THAN A DESIGN. Nothing
--      in the database forces an UPDATE to `trading_calendar` to write a prior
--      image; the loader does it. A trigger would make it a control rather than
--      a rule somebody follows, and 0027 is where the invariant triggers live.
--      ADR-042 is SILENT on it, so this session does not add a money-path
--      trigger on its own authority. Carried as OI-06 in DELTA_MANIFEST.
--
--   4. F-3 CARRIES A COMMENT AND ONE PRESENCE CHECK, AND NOT A COLUMN. The
--      symbol dimension is REJECTED: it turns R-01 from a day lookup into a
--      per-symbol lookup, changes the engine's calendar contract, and makes the
--      calendar's grain differ from the grain every counter is defined at. What
--      lands is the ruled semantics on `session_close_at` (the LATEST close
--      across the listed product groups) plus a CHECK that a half day records
--      something in `notes`. THAT CHECK ASSERTS PRESENCE, NEVER CONTENT: it
--      cannot tell per-group close times from the word "yes", and it is here
--      because the alternative is that F-3 lands as prose only.
--
--   5. F-4 MAKES AN UNCOVERED DAY A POSITIVE FACT. Today an exhausted calendar
--      is INDISTINGUISHABLE FROM AN UNBROKEN HOLIDAY: no row means not a
--      trading day, so every counter quietly stops advancing, no rule fires,
--      nothing breaches, nothing becomes eligible, and NOTHING RAISES. That is
--      the single most silent failure available to this table. A stored
--      coverage bound makes "we do not know about this day" answerable, and the
--      batch refuses rather than guesses.
--
--   6. APPEND-ONLY IS A GRANT, NOT A CONVENTION (VG-8), AND 0026's DEFAULT
--      PRIVILEGES WORK AGAINST US HERE. 0026 ends with ALTER DEFAULT PRIVILEGES
--      granting merit_app SELECT, INSERT, UPDATE, DELETE on any table a later
--      migration creates. Both tables below are append-only by ruling, so
--      without the REVOKE at the end of this file the word "append-only" in
--      their comments would be false the moment they were created. This
--      SUPERSEDES 0026's revoke list, which is why DATA_MODEL section 1's
--      append-only set goes from eighteen tables to twenty in the same commit.
--
-- WHAT IS NOT HERE, deliberately: no loader, no source file, no rows, and no
-- `scripts/db/probe_trading_calendar.sql`. Those are S-E3 and S-E4 under
-- ADR-003's strict regime. `trading_calendar` has zero rows today, so every
-- ADD CONSTRAINT below validates against an empty table and cannot be read as
-- evidence that any row satisfies it.
--
-- Rulings: ADR-042 (F-1 to F-4). Supersedes 0004_catalog's trading_calendar
--          constraints and 0026_roles_and_grants' append-only revoke list.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- F-1. A holiday is writable, and it is a POSITIVE FACT rather than an absence
-- -----------------------------------------------------------------------------
-- 0004 declared both session columns NOT NULL under CHECK (close > open), so a
-- holiday row had to carry a FABRICATED session interval while the CHECK
-- immediately beside it said in its own comment that "a holiday has no session
-- to contain fills in". Either the column was dead and holidays were an
-- absence, or fabricated instants entered a containment table. R-01 is a
-- containment lookup, so a fabricated interval is not inert: it is an interval
-- a fill can fall inside.
ALTER TABLE trading_calendar ALTER COLUMN session_open_at  DROP NOT NULL;
ALTER TABLE trading_calendar ALTER COLUMN session_close_at DROP NOT NULL;

-- The ordering check, made NULL-safe in the strong sense. See header item 1:
-- the weak reading (leave the expression alone and let NULL pass) is the
-- `array_length` defect written a second time.
--
-- The name is PRESERVED so every document, runbook and error-handling path
-- citing `trading_calendar_session_ordered` still resolves. 0028's precedent.
ALTER TABLE trading_calendar DROP CONSTRAINT trading_calendar_session_ordered;
ALTER TABLE trading_calendar ADD CONSTRAINT trading_calendar_session_ordered CHECK (
  (session_open_at IS NULL AND session_close_at IS NULL)
  OR (
    session_open_at  IS NOT NULL
    AND session_close_at IS NOT NULL
    AND session_close_at > session_open_at
  )
);

-- ADR-042 F-1, verbatim. Both directions, because `=` between two booleans is
-- an equivalence rather than an implication: a holiday MUST have no session,
-- and a row with no session MUST be a holiday. The second direction is the one
-- that matters for the fail-closed control, because it is what forbids a
-- sessionless row that is not declared a holiday.
ALTER TABLE trading_calendar ADD CONSTRAINT trading_calendar_holiday_has_no_session CHECK (
  is_holiday = (session_open_at IS NULL)
);

COMMENT ON COLUMN trading_calendar.session_open_at IS
  'UTC instant derived from the CT session definition, so DST is a row rather '
  'than a calculation (B4 #1). NULL exactly when is_holiday (ADR-042 F-1): a '
  'holiday has no session to contain fills in, and a fabricated interval is an '
  'interval a fill can fall inside.';

-- -----------------------------------------------------------------------------
-- F-3. One close time on an early-close day, and it is the LATEST one
-- -----------------------------------------------------------------------------
-- contract_specs lists ES, MES, NQ, MNQ, CL and GC, spanning CME, NYMEX and
-- COMEX, whose early closes differ by product group while their regular hours
-- agree. trading_calendar has one row per trading day and NO SYMBOL DIMENSION,
-- so one session_close_at is wrong for some group on every early-close day.
--
-- The ruled resolution is the LATEST close across the listed groups. R-01 is a
-- containment lookup, so the only thing at stake is whether a fill can fall
-- outside every session, and the latest close guarantees it cannot. The next
-- session opens at 17:00 CT regardless, so no overlap is created and no fill is
-- orphaned. The symbol dimension is REJECTED (header item 4).
COMMENT ON COLUMN trading_calendar.session_close_at IS
  'UTC instant derived from the CT session definition. NULL exactly when '
  'is_holiday (ADR-042 F-1). On an early-close day this is the LATEST close '
  'across the product groups contract_specs lists, because R-01 is a '
  'containment lookup and the latest close is the one that cannot orphan a '
  'fill (ADR-042 F-3). The per-group times are in notes.';

-- The per-group times are the thing a reader needs to explain a fill near the
-- close, and `notes` is where F-3 puts them. This asserts they were WRITTEN,
-- never that they are right: a presence check is what a CHECK can do here, and
-- saying so is better than implying more. btrim rather than IS NOT NULL,
-- because the empty string satisfies IS NOT NULL and is the same class of
-- silent pass as the empty array.
ALTER TABLE trading_calendar ADD CONSTRAINT trading_calendar_half_day_records_group_closes CHECK (
  NOT is_half_day OR (notes IS NOT NULL AND length(btrim(notes)) > 0)
);

COMMENT ON TABLE trading_calendar IS
  'Seeded years ahead, maintained as data, reviewed annually. The exchange '
  'session calendar (CT) is authoritative; storage is UTC. A holiday carries '
  'no session and is a positive fact (ADR-042 F-1). WHAT THIS TABLE DOES NOT '
  'SAY IS WHICH DAYS IT KNOWS ABOUT: coverage is in trading_calendar_loads, '
  'and a day outside coverage is not a holiday, it is unknown (F-4).';

-- -----------------------------------------------------------------------------
-- F-2. trading_calendar_revisions: what the database held on the day
-- -----------------------------------------------------------------------------
-- INV-04 is "replaying every mark from day one reproduces stored state
-- byte-identically", and it was defined against a value that can move
-- underneath it. The table carries updated_at and notes and no prior image, so
-- it CANNOT ANSWER WHAT THE CALENDAR SAID ON THE DAY THE ENGINE READ IT, and
-- the nightly self-audit would page with no way to distinguish a calendar
-- correction from an engine regression.
--
-- GIT IS REAL HISTORY AND IS THE WRONG HISTORY. It records what the FILE said.
-- It cannot prove what the DATABASE held when the mark was computed, and the
-- mark was computed against the database.
CREATE TABLE trading_calendar_revisions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  trading_day         date NOT NULL REFERENCES trading_calendar(trading_day) ON DELETE RESTRICT,

  -- THE PRIOR IMAGE IS DERIVED, NOT LISTED: to_jsonb(OLD) of the whole row, so
  -- a column added to trading_calendar by a future migration is captured
  -- automatically. A hand-written column list is the same object as a
  -- hand-maintained count, and this corpus has now found nine of those wrong.
  -- 0028's pinned-set argument, one table over.
  prior_row           jsonb NOT NULL,

  -- Who made the correction. Free text on 0002_identity's `actor` idiom: this
  -- is written by the loader and by an operator, neither of which is a `users`
  -- row.
  actor               text NOT NULL,

  -- Why. Prose, and required, because a prior image with no reason records
  -- that the calendar moved and not that anybody decided it should.
  reason              text NOT NULL,

  -- The digest of the SOURCE FILE that produced the new value, so a revision
  -- can be traced to the transcription that caused it. rule_states' idiom:
  -- a hash is a SHA-256 digest or it is not a hash.
  source_digest       bytea NOT NULL,

  -- THE PARTITION, ASSERTED RATHER THAN JUDGED. Rows in fills, daily_marks and
  -- rule_states that depend on this trading day, counted by the loader BEFORE
  -- the write. Zero is an ordinary data change. Non-zero is an incident: every
  -- affected account is replayed through the same advanceDay fold, and B4 #5
  -- governs the outcome, so a settled payout whose eligibility changes
  -- retroactively is NEVER clawed back, it is flagged for review and absorbed.
  dependent_row_count integer NOT NULL,

  -- The incident this correction belongs to. Null is legal only when nothing
  -- depended on the day; see the constraint below.
  incident_ref        text NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- `{}` is the jsonb form of the empty array that passes a length check: it is
  -- a valid jsonb value and it is not a row image. The four keys named are the
  -- ones a replay needs in order to say what the calendar asserted about the
  -- day, so their absence is the failure this rejects.
  CONSTRAINT trading_calendar_revisions_prior_row_is_a_row CHECK (
    jsonb_typeof(prior_row) = 'object'
    AND prior_row ? 'trading_day'
    AND prior_row ? 'is_holiday'
    AND prior_row ? 'session_open_at'
    AND prior_row ? 'session_close_at'
  ),

  CONSTRAINT trading_calendar_revisions_actor_stated CHECK (
    length(btrim(actor)) > 0
  ),
  CONSTRAINT trading_calendar_revisions_reason_stated CHECK (
    length(btrim(reason)) > 0
  ),

  CONSTRAINT trading_calendar_revisions_digest_is_sha256 CHECK (
    length(source_digest) = 32
  ),

  CONSTRAINT trading_calendar_revisions_dependents_counted CHECK (
    dependent_row_count >= 0
  ),

  -- The whole point of storing the count. A correction to a day that fills,
  -- marks or rule states already depend on is an INCIDENT, and an incident that
  -- names no incident is a data edit wearing the word.
  CONSTRAINT trading_calendar_revisions_incident_named_when_dependent CHECK (
    dependent_row_count = 0
    OR (incident_ref IS NOT NULL AND length(btrim(incident_ref)) > 0)
  )
);

-- The replay's read: what did this table say about day D, and in what order did
-- it change. created_at DESC because the newest prior image is the one that
-- answers "what did it say most recently before now".
CREATE INDEX trading_calendar_revisions_day_idx
  ON trading_calendar_revisions (trading_day, created_at DESC);

-- The incident read, from the other end: everything one incident moved.
CREATE INDEX trading_calendar_revisions_incident_idx
  ON trading_calendar_revisions (incident_ref, created_at)
  WHERE incident_ref IS NOT NULL;

COMMENT ON TABLE trading_calendar_revisions IS
  'ADR-042 F-2. Append-only. Retention: forever. One row per correction to a '
  'trading_calendar row, carrying the PRIOR image. What makes INV-04 replay '
  'able to tell a calendar correction from an engine regression.';

COMMENT ON COLUMN trading_calendar_revisions.prior_row IS
  'to_jsonb(OLD) of the whole trading_calendar row, derived rather than listed. '
  'That prior_row.trading_day equals this row trading_day is asserted by the '
  'loader and its probe rather than by a CHECK: the comparison needs a jsonb '
  'rendering of a date, which is STABLE rather than IMMUTABLE, and PostgreSQL '
  'will not accept a non-immutable expression in a CHECK.';

COMMENT ON COLUMN trading_calendar_revisions.dependent_row_count IS
  'Rows in fills, daily_marks and rule_states depending on this trading day, '
  'counted before the write. Zero is a data change; non-zero is an incident '
  'and requires incident_ref (P1 S-E section 4).';

-- -----------------------------------------------------------------------------
-- F-4. trading_calendar_loads: "we do not know about this day" is an ANSWER
-- -----------------------------------------------------------------------------
-- Coverage had no storage anywhere, so an exhausted calendar read exactly like
-- an unbroken holiday. This table is the difference between a batch that
-- refuses and a batch that guesses, and it serves three things at once: the
-- fail-closed control, the six-month horizon alarm (ADR-042, OQ-SE-02), and the
-- loader's digest round trip.
CREATE TABLE trading_calendar_loads (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Which source publication this load came from, e.g. the CME 2026 calendar.
  -- Text rather than an enum: the set grows once a year, which is the case
  -- DATA_MODEL section 1 sends to text with a check.
  source_id           text NOT NULL,

  -- THE COVERAGE BOUNDS, INCLUSIVE, in the same date domain as
  -- trading_calendar.trading_day: the exchange's CT trading day, never a UTC
  -- calendar date derived from a timestamp. A day inside these bounds with no
  -- trading_calendar row is a bug in the load. A day OUTSIDE them is unknown,
  -- and unknown is not a holiday.
  coverage_start_day  date NOT NULL,
  coverage_end_day    date NOT NULL,

  -- SHA-256 of the source file as committed. The loader re-reads the rows it
  -- wrote, re-canonicalizes and asserts the digests match, which is what
  -- catches a truncated load, a partial transaction, and a timestamptz rendered
  -- in the session's timezone rather than UTC.
  source_digest       bytea NOT NULL,

  actor               text NOT NULL,

  -- There is deliberately no separate `loaded_at`. The row's creation IS the
  -- load, and DATA_MODEL section 1 permits exactly three ruled exceptions to
  -- every-table-carries-created_at, each carrying a more specific timestamp
  -- INSTEAD. A second timestamp here would be a second answer to one question.
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trading_calendar_loads_coverage_ordered CHECK (
    coverage_end_day >= coverage_start_day
  ),
  CONSTRAINT trading_calendar_loads_source_id_stated CHECK (
    length(btrim(source_id)) > 0
  ),
  CONSTRAINT trading_calendar_loads_actor_stated CHECK (
    length(btrim(actor)) > 0
  ),
  CONSTRAINT trading_calendar_loads_digest_is_sha256 CHECK (
    length(source_digest) = 32
  )
);

-- IDEMPOTENCE AS A CONSTRAINT RATHER THAN AS LOADER BEHAVIOUR. Re-running the
-- loader against an unchanged source must write nothing; this is the half of
-- that promise the database can keep on its own. The digest determines the
-- coverage bounds, because both are read from the same file.
CREATE UNIQUE INDEX trading_calendar_loads_source_digest_uq
  ON trading_calendar_loads (source_id, source_digest);

-- The horizon alarm's read: how far ahead does coverage run. Descending because
-- the question is always about the maximum.
CREATE INDEX trading_calendar_loads_horizon_idx
  ON trading_calendar_loads (coverage_end_day DESC, coverage_start_day);

COMMENT ON TABLE trading_calendar_loads IS
  'ADR-042 F-4. Append-only. Retention: forever. One row per load of a calendar '
  'source. THE COVERAGE FACT: a day outside every row here is UNKNOWN rather '
  'than a holiday, and the batch fails closed on it instead of letting every '
  'counter silently stop advancing.';

COMMENT ON COLUMN trading_calendar_loads.coverage_start_day IS
  'Inclusive lower bound, in exchange CT trading-day space, the same domain as '
  'trading_calendar.trading_day. Never a UTC calendar date.';

COMMENT ON COLUMN trading_calendar_loads.coverage_end_day IS
  'Inclusive upper bound, in exchange CT trading-day space. The horizon alarm '
  'warns when the maximum runs less than six months ahead (ADR-042, OQ-SE-02).';

-- -----------------------------------------------------------------------------
-- Append-only is a grant, not a convention (VG-8)
-- -----------------------------------------------------------------------------
-- 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app full DML on
-- anything a later migration creates, so both tables above are UPDATE-able and
-- DELETE-able the instant they exist. Both are append-only BY RULING: a prior
-- image that can be rewritten proves nothing about what the database held, and
-- a coverage fact that can be deleted un-answers the question F-4 exists to
-- answer.
--
-- Against PUBLIC as well as merit_app, because a revoke that only binds the
-- application role is a revoke that a second connection string bypasses. 0026's
-- own words, and this SUPERSEDES its list rather than editing it.
REVOKE UPDATE, DELETE ON
  trading_calendar_revisions,
  trading_calendar_loads
FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT on either table. 0026's
-- default privileges make a new table invisible to analytics until somebody
-- grants it, and the default should be that it is not: neither table is part of
-- the trading surface M13 describes, and the revisions table is an incident
-- record. It arrives with a consumer that names itself, or not at all.

COMMIT;
