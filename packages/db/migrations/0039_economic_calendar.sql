-- =============================================================================
-- 0039_economic_calendar
-- =============================================================================
-- NON-MONEY. No ledger account, no balance, no eligibility, no payout. It is
-- still the most consequential non-money table in the corpus, and the reason is
-- worth stating before the DDL rather than after it:
--
--   THIS TABLE IS EVIDENCE. D-04 clusters a trader's entries against a
--   scheduled release instant and produces a risk flag. FM-M7-08 says a stale
--   calendar makes D-04 fire "on the wrong windows or not at all", and FIRING
--   ON A WRONG WINDOW IS STRICTLY WORSE THAN NOT FIRING: it manufactures
--   evidence against a trader who did nothing. A wrong row here does not lose
--   money. It accuses somebody.
--
-- ADR-066, PROPOSED 2026-08-20, section 2. Planned by FOLD-03 section 5.1.
--
-- THIS IS NOT NEW SCOPE, AND THAT IS THE POINT. M07:470 DEP-M7-06 has read "A
-- maintained Tier-1 economic calendar, as data | M6 admin, seed | D-04 fires on
-- the wrong windows" since M07 was written. M07:109 D-04 reads "`fills` plus a
-- maintained Tier-1 economic calendar". M07:267 FM-M7-08 requires the staleness
-- alarm, "like `contract_specs` and `trading_calendar`". A grep for
-- `economic_calendar` over docs/, packages/db/migrations/ and packages/ before
-- this file was written returned FOUR HITS, ALL PROSE, AND NO TABLE.
--
-- So D-04 has been unimplementable for the whole life of the corpus and no gate
-- could see it, because A DECLARED DEPENDENCY WITH NO SATISFYING OBJECT IS
-- INVISIBLE TO EVERY CHECK THIS REPOSITORY RUNS. This file is the satisfying
-- object.
--
-- THE SOURCE QUESTION IS FORECLOSED RATHER THAN OPEN (ADR-066 section 2). A
-- third-party embed cannot carry a revision, cannot be staleness-monitored and
-- cannot be joined to `fills`. D-04 needs all three. An embed rendered beside
-- this table would be a SECOND SOURCE OF TRUTH for "when was the news", which
-- is the failure FM-M7-08 already guards. The M04 panel renders from Merit's
-- row and from no embed.
--
-- FIVE things need the founder's read:
--
--   1. THE REVISION IS A ROW, NOT AN UPDATE, and that is what makes GS-286
--      mechanical rather than conventional. A release time that moves inserts a
--      new row at the next revision; nothing is overwritten. Both readers go
--      through `economic_calendar_current`, so the panel and D-04's window move
--      together BECAUSE THEY CANNOT MOVE SEPARATELY. An UPDATE-in-place design
--      would leave "did D-04 re-evaluate against the new instant" as a question
--      about application code. Here it is a question about a view, and the
--      answer is yes for every consumer at once.
--
--   2. THE STALENESS CLOCK IS A SECOND TABLE, ON trading_calendar's PRECEDENT.
--      FM-M7-08 puts this calendar's freshness "on the same footing as
--      `contract_specs` and `trading_calendar`", and `trading_calendar`'s
--      footing is `trading_calendar_loads` (0032, ADR-042 F-4): a coverage fact
--      that makes "we do not know about this window" a POSITIVE ANSWER instead
--      of an absence. Without it, an exhausted economic calendar is
--      indistinguishable from a quiet week: no rows, no releases, no windows,
--      D-04 finds nothing, AND NOTHING RAISES. That is the single most silent
--      failure available to this table and it is the same one F-4 found one
--      table over. The alarm reads `economic_calendar_loads`; the dead-man
--      switch is in CRON_INVENTORY.
--
--   3. `tier` IS A COLUMN AND NOT AN IMPORT FILTER. DEP-M7-06 says Tier-1, so
--      the tempting cheap version ingests only Tier-1 and stores no tier. That
--      makes "Tier-1" a property of what was loaded rather than a property that
--      can be re-derived, and it cannot be re-asked later: a feed that
--      re-tiers an event retroactively would silently change history with no
--      row to show for it. Storing the tier makes D-04's `tier = 1` a QUERY,
--      and it lets the same load carry the lower tiers the panel does not
--      render. Reject this if the founder wants the narrow import.
--
--   4. THERE IS NO TIMEZONE COLUMN, DELIBERATELY. The table stores one UTC
--      instant. The trader's timezone is a RENDERING concern and GS-285 is
--      exactly the assertion that one row renders in two timezones. A timezone
--      on the row would be the second source of truth for "when was the news"
--      wearing a different hat, and it would make the two traders' dashboards
--      disagree by construction.
--
--   5. `release_trading_day` IS STORED RATHER THAN DERIVED, and this is B4 #1.
--      D-04 joins releases to `fills`, and `fills` carry a `trading_day` in the
--      exchange CT session vocabulary. Deriving that day from a UTC timestamp
--      is the exact error the corpus has now warned about in `trading_calendar`
--      three separate times: a release at 23:30 UTC is not on the UTC calendar
--      date the engine counts in. It is transcribed WITH the release, by the
--      loader that read the source, and it declares its unit.
--
-- WHAT IS NOT HERE, deliberately: no loader, no source file, no rows, no vendor
-- and no D-04 detector code. OQ-F3-03 stands and the vendor is the founder's
-- procurement call with a cost line (ADR-066 section 2). Both tables have zero
-- rows on merge, so nothing below can be read as evidence that any row
-- satisfies it.
--
-- Rulings: ADR-066 (section 2), FOLD-03 section 5.1. Closes M07 DEP-M7-06.
--          Supersedes nothing: it creates what was always declared and never
--          built.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- economic_calendar_loads: the coverage fact, which is the staleness clock
-- -----------------------------------------------------------------------------
-- FM-M7-08's "maintained as data with a staleness alarm", in the shape 0032
-- already ruled for the trading calendar. The row's creation IS the load, so
-- there is deliberately no second `loaded_at` beside `created_at`
-- (trading_calendar_loads' idiom and its stated reason).
CREATE TABLE economic_calendar_loads (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Which source publication this load came from. `text` rather than an enum on
  -- trading_calendar_loads' reasoning: the set of feeds grows on procurement
  -- timescales, not on release timescales.
  source_id           text NOT NULL,

  -- THE COVERAGE WINDOW, AND IT IS WHAT MAKES STALENESS ANSWERABLE. A D-04 run
  -- over a day outside every load's coverage must REFUSE rather than report no
  -- releases, because "no releases" and "we never loaded that week" produce the
  -- same empty result set and mean opposite things.
  coverage_start_day  date NOT NULL,
  coverage_end_day    date NOT NULL,

  -- SHA-256 of the source file as ingested. rule_states' idiom: a hash is a
  -- SHA-256 digest or it is not a hash. With the unique index below it is also
  -- the idempotence promise the database can keep on its own, so re-running the
  -- loader against an unchanged publication writes nothing.
  source_digest       bytea NOT NULL,

  -- Who ran the load. 0002_identity's `actor` idiom: written by a loader or an
  -- operator, neither of which is a `users` row.
  actor               text NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT economic_calendar_loads_coverage_ordered CHECK (
    coverage_end_day >= coverage_start_day
  ),
  CONSTRAINT economic_calendar_loads_source_id_stated CHECK (
    length(btrim(source_id)) > 0
  ),
  CONSTRAINT economic_calendar_loads_actor_stated CHECK (
    length(btrim(actor)) > 0
  ),
  CONSTRAINT economic_calendar_loads_digest_is_sha256 CHECK (
    length(source_digest) = 32
  )
);

-- Idempotence as a constraint rather than as loader behaviour, which is
-- trading_calendar_loads' argument reproduced: the same publication loaded
-- twice is one row, and the digest determines the coverage bounds because both
-- are read from the same file.
CREATE UNIQUE INDEX economic_calendar_loads_source_digest_uq
  ON economic_calendar_loads (source_id, source_digest);

-- The staleness alarm's read: the newest coverage horizon, one index scan.
CREATE INDEX economic_calendar_loads_horizon_idx
  ON economic_calendar_loads (coverage_end_day DESC, coverage_start_day);

-- -----------------------------------------------------------------------------
-- economic_calendar: the events, and a revision that is a row
-- -----------------------------------------------------------------------------
CREATE TABLE economic_calendar (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The load that produced this row, so every release traces to the
  -- transcription that caused it and the staleness clock is reachable from any
  -- row. ON DELETE RESTRICT: the loads table is append-only anyway, and a
  -- release whose provenance could vanish is a release nobody can defend in a
  -- dispute.
  load_id               bigint NOT NULL
                        REFERENCES economic_calendar_loads(id) ON DELETE RESTRICT,

  -- THE EVENT, STABLE ACROSS OCCURRENCES. For example `US.CPI.MOM`. It is the
  -- key D-04 clusters BY: "as a pattern across many events" (M07:109) is a
  -- statement about repeated occurrences of the same event key, and without a
  -- stable key the pattern qualifier that makes D-04 defensible cannot be
  -- expressed at all.
  event_key             text NOT NULL,

  -- WHICH OCCURRENCE. For example `2026-08` for the August print. Text rather
  -- than a date because occurrences are not all monthly and some are numbered
  -- rather than dated; what it must do is identify one release of one event
  -- exactly once, which the unique index below enforces.
  occurrence_key        text NOT NULL,

  -- Header item 3. D-04 reads `tier = 1`; the panel renders `tier = 1`. Lower
  -- tiers are storable so that a feed is not lossy and a re-tiering is visible.
  tier                  smallint NOT NULL,

  -- THE INSTANT, IN UTC, AND IT IS THE WHOLE POINT OF THE TABLE. Header item 4:
  -- one instant, no timezone column, rendered per trader.
  scheduled_release_at  timestamptz NOT NULL,

  -- Header item 5, B4 #1. The exchange CT trading day this release falls in,
  -- transcribed by the loader rather than derived from the timestamp above.
  release_trading_day   date NOT NULL,

  -- THE LOAD-BEARING COLUMN. 0 is the original publication; each revision of a
  -- release time is a NEW ROW at the next number. Nothing is overwritten, so
  -- "what did the calendar say when D-04 read it" is answerable forever, which
  -- is the same property trading_calendar_revisions exists to give the trading
  -- calendar and the same reason: a flag raised against a trader has to be
  -- defensible months later.
  revision              integer NOT NULL,

  -- Why the time moved. Required on a revision, refused on an original. A
  -- revision with no reason records that the calendar moved and NOT that
  -- anybody decided it should, which is trading_calendar_revisions.reason's
  -- exact argument.
  revision_reason       text NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT economic_calendar_event_key_stated CHECK (
    length(btrim(event_key)) > 0
  ),
  CONSTRAINT economic_calendar_occurrence_key_stated CHECK (
    length(btrim(occurrence_key)) > 0
  ),

  -- Tier 1 is what DEP-M7-06 names; 2 and 3 exist so a feed is not lossy.
  CONSTRAINT economic_calendar_tier_is_ranked CHECK (
    tier BETWEEN 1 AND 3
  ),

  CONSTRAINT economic_calendar_revision_is_ordinal CHECK (
    revision >= 0
  ),

  -- NO NULL-PASSES TRAP HERE, AND IT IS CHECKED RATHER THAN ASSUMED. ADR-035
  -- found this defect seven times in the `array_length` form and 0032 header
  -- item 1 found it again on a widened NOT NULL: a CHECK that evaluates to NULL
  -- PASSES. Both sides below are total. `revision` is NOT NULL so `revision = 0`
  -- is always a boolean, and `IS NULL` is a boolean for every input including
  -- NULL. So this constraint has no third outcome to leak through.
  --
  -- It is an equivalence rather than an implication ON PURPOSE, closing both
  -- directions: an original may not claim a reason it did not have, and a
  -- revision may not omit one.
  CONSTRAINT economic_calendar_revision_states_its_reason CHECK (
    (revision = 0) = (revision_reason IS NULL)
  ),

  CONSTRAINT economic_calendar_revision_reason_stated CHECK (
    revision_reason IS NULL OR length(btrim(revision_reason)) > 0
  )
);

-- One row per revision of one occurrence of one event. This is what makes
-- "revision" an append rather than a rewrite: the second write at revision 0
-- is refused, so a loader that means to correct a time has to say so.
CREATE UNIQUE INDEX economic_calendar_occurrence_revision_uq
  ON economic_calendar (event_key, occurrence_key, revision);

-- D-04's read: Tier-1 releases in a trading-day range. The partial index keeps
-- the detector's scan off the lower tiers it never looks at.
CREATE INDEX economic_calendar_tier1_day_idx
  ON economic_calendar (release_trading_day, scheduled_release_at)
  WHERE tier = 1;

-- The panel's read: upcoming releases by instant.
CREATE INDEX economic_calendar_release_idx
  ON economic_calendar (scheduled_release_at);

-- -----------------------------------------------------------------------------
-- economic_calendar_current: the one row both readers read
-- -----------------------------------------------------------------------------
-- ADR-066 section 5.1's "the panel and D-04 read ONE ROW", as an object rather
-- than as a convention. The current state of an occurrence is its highest
-- revision, and this view is the only definition of that anywhere.
--
-- WHY A VIEW AND NOT A DOCUMENTED CONVENTION. "Both consumers pick the max
-- revision" is a sentence that has to be re-implemented correctly in the panel
-- and in the detector, and the failure when one of them gets it wrong is the
-- panel showing 08:30 while D-04 clusters against 09:00. That is precisely the
-- second-source-of-truth failure FM-M7-08 guards, arrived at from inside rather
-- than from an embed. One definition, two consumers, and GS-286 asserts that
-- moving a time moves both because there is no "both" to move separately.
CREATE VIEW economic_calendar_current AS
SELECT DISTINCT ON (event_key, occurrence_key)
       id,
       load_id,
       event_key,
       occurrence_key,
       tier,
       scheduled_release_at,
       release_trading_day,
       revision,
       revision_reason,
       created_at
  FROM economic_calendar
 ORDER BY event_key, occurrence_key, revision DESC;

COMMENT ON VIEW economic_calendar_current IS
  'The current revision of every economic calendar occurrence. The M04 panel '
  'and M07 D-04 both read THIS and never economic_calendar directly, so a '
  'revised release time moves both or neither (ADR-066 section 5.1, GS-286).';

-- -----------------------------------------------------------------------------
-- Append-only, by grant rather than by convention (VG-8)
-- -----------------------------------------------------------------------------
-- 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app full DML on
-- anything a later migration creates, so both tables above are UPDATE-able and
-- DELETE-able the instant they exist. Without this REVOKE, "the revision is a
-- row, not an update" is a sentence in a header and nothing else: a loader
-- could move `scheduled_release_at` in place and the whole of header item 1
-- would be gone with no trace that it ever held.
--
-- Against PUBLIC as well as merit_app, because a revoke that only binds the
-- application role is a revoke that a second connection string bypasses. 0026's
-- own words, and this SUPERSEDES its list rather than editing it (0032's
-- precedent, applied again).
REVOKE UPDATE, DELETE ON
  economic_calendar,
  economic_calendar_loads
FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT, on 0032's stated default:
-- a new table is invisible to analytics until somebody grants it, and it
-- arrives with a consumer that names itself or not at all. Nothing in this
-- calendar is trader-identifying, so the eventual grant is cheap; making it now
-- on the guess that somebody will want it is how a default stops being one.

COMMIT;
