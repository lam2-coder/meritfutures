-- =============================================================================
-- 0035_rule_states_calendar_revision
-- =============================================================================
-- E2 READ: MONEY PATH. This file changes the table the nightly self-audit
-- compares against. INV-04 is "replaying every mark from day one reproduces
-- stored state byte-identically", and it is UNDEFINED if the calendar can move
-- underneath a stored row without the row recording which calendar it saw.
--
-- ADR-047, ACCEPTED 2026-08-16, closing `OQ-P2-02`. It is the second half of
-- `0033`. `0033` made the prior image MANDATORY on the calendar side, so every
-- correction now leaves an unforgeable record of what the calendar said before
-- it moved. Nothing joined that record to a state row, so replay held the
-- evidence and could not scope by it.
--
-- WHY THE GAP IS NOT SMALL, which is the part a reader will underestimate. A
-- mark correction changes one account's inputs. A CALENDAR correction changes
-- the day sequence for EVERY ACCOUNT AT ONCE: every counter that advances per
-- trading day, every cadence gap computed by sequence subtraction, every
-- nextTradingDayAfter. At 5,000 accounts the first holiday correction diverges
-- the whole book and pages 5,000 times on one morning, which is how M01
-- Appendix B.5's own warning comes true: "a self-audit that becomes slow
-- becomes a self-audit that gets disabled". The alarm does not fail by being
-- wrong. It fails by being right five thousand times.
--
-- Nothing here edits a merged file. `0015` stays exactly as it was written and
-- this file changes what it installed. Migrations are sacred once merged
-- (constitution E2), which is a rule about editing them and not a rule against
-- correcting them. `0028`'s precedent, applied a fourth time.
--
-- No numbered delta lands here. ADR-047 is a ruling on an open question, not a
-- schema delta, so ADR-026's manifest completeness gate has nothing to count
-- and the record is DELTA_MANIFEST section 19 instead.
--
-- SIX things need the founder's line-by-line read:
--
--   1. THE COLUMN IS EXCLUDED FROM state_hash, AND THAT IS THE WHOLE RULING.
--      Read this first, because the intuitive edit is the opposite one and the
--      opposite one INVERTS ADR-047. `engine_version` is already excluded from
--      the hash for a stated reason: "a build identifier is not state;
--      including it makes every engine upgrade a universal divergence".
--      ADR-047's thesis is that the calendar revision is the engine's SECOND
--      version-like input and that Appendix B.4's protocol fits it without
--      amendment, so the identical argument applies with identical force. A
--      calendar revision inside the hash changes EVERY row's hash on the first
--      correction and produces exactly the 5,000-page morning this ADR exists
--      to prevent. The nineteen hashed fields stay nineteen; the EXCLUSION list
--      goes from three to four, and it is extended in the comment `0015` put it
--      in rather than left implicit, because a hash whose input set is implicit
--      is a hash that changes meaning when a column is added (ADR-026 C-07).
--
--   2. IT IS A WATERMARK, NOT THIS ROW'S DAY, and the column name will invite
--      the other reading. `calendar_revision_id` is the HIGH-WATER revision
--      that existed when the FOLD ran; it is NOT the revision that corrected
--      this row's `trading_day`. The distinction is load-bearing: a rule state
--      is folded over the whole day sequence from day one, so what it depends
--      on is the calendar AS A WHOLE, not one row of it. A per-day reading
--      would scope replay to the corrected day and miss every downstream
--      counter, which is the entire failure. The comment below says so in the
--      column itself, where a reader writing the engine will meet it.
--
--   3. NULL IS LEGAL AND IS NOT "UNKNOWN". It means the fold read a calendar
--      that had NEVER been corrected, which is the state of every row this
--      table will hold until the first correction lands. NOT NULL is the
--      obvious tightening and it is WRONG in the ADR-039 SUCCESS 2 sense: it
--      would refuse every state row the engine writes until somebody had
--      corrected the calendar at least once, which is a control that breaks the
--      ordinary path to guard the rare one. The probe leads with this case.
--
--   4. THERE IS NO TRIGGER ASSERTING THE STAMP IS CURRENT, and refusing to
--      write one is a decision rather than an omission. The tempting guard is
--      `calendar_revision_id = (SELECT max(id) FROM trading_calendar_revisions)`
--      on INSERT. IT WOULD FORCE A LIE. A correction that commits between the
--      fold and the write leaves a state row that genuinely read the OLDER
--      calendar; stamping it with the newer watermark records a calendar it
--      never saw, and replay would then believe a stale row was current. The
--      honest stamp is the one the fold read, and a stamp older than the
--      maximum is CORRECT rather than suspect: replay finds it out of scope and
--      step 4 rewrites it, which is the protocol working. `0033`'s own header
--      settles the principle: the database's answer to a correction with no
--      reason is to REFUSE it, never to write a reason of its own. A control
--      that can fabricate is not a control. What IS assertable, that the stamp
--      names a revision that really existed, is the FOREIGN KEY, and that is
--      why the reference is a key rather than an integer.
--
--   5. NO INDEX, and the precedent is one column over. B.4 step 1 scopes by
--      this column on every nightly audit, which sounds like an index. It is
--      not: the audit re-derives every row for every account, so the scoping is
--      a filter applied DURING a full pass rather than a lookup into one. The
--      existing scoping column, `engine_version`, has carried the identical
--      access pattern since `0015` with no index, and adding one for the second
--      while the first has none would assert a difference between them that
--      does not exist. `0033` made the same call on `rule_states (trading_day)`
--      and wrote down that it was a trade rather than an oversight.
--
--   6. THE APPEND-ONLY GRANT NEEDS NO CHANGE AND IS WHAT MAKES THE STAMP MEAN
--      ANYTHING. A watermark is only evidence if what it points at cannot move.
--      `0032` revoked UPDATE and DELETE on `trading_calendar_revisions` from
--      merit_app AND PUBLIC, `0033` refused DELETE and TRUNCATE on
--      `trading_calendar` itself, and the identity primary key is monotonic. So
--      the set of revisions with `id <= N` is a complete and immutable
--      description of every correction the calendar had undergone at watermark
--      N. `ON DELETE RESTRICT` below is the second lock on the same door. The
--      probe asserts the grant under `SET LOCAL ROLE merit_app` rather than
--      trusting the catalogue, because `0034`'s run proved a REVOKE described
--      as decoration was doing real work.
--
-- WHAT IS NOT HERE, deliberately:
--
--   *  NO BACKFILL. `rule_states` has zero rows today: the engine is P2 and has
--      not been written, and no seed or fixture inserts into it. So the ADD
--      COLUMN below is a metadata-only change and there is no existing row
--      whose watermark anybody would have to invent. Nothing in this file can
--      be read as evidence that a populated table satisfies it;
--      scripts/db/probe_rule_states_calendar_revision.sql is where the evidence
--      is, and it runs in CI on every push.
--
--   *  NO GUARD ON CALENDAR *INSERT*, which is a STATED EXPOSURE rather than a
--      solved problem. `0033` requires a prior image on UPDATE and refuses
--      DELETE and TRUNCATE, so the watermark is complete over every way a day
--      can CHANGE. An INSERT writes no revision row and moves no watermark. For
--      a future day that is correct and desirable, because extending coverage
--      forward changes no already-computed state. For a day BACKFILLED inside
--      an existing coverage window it is not: the day sequence moves
--      retroactively, no revision row records it, and every stamped state row
--      still claims a watermark that looks current. ADR-047 does not rule it
--      and ADR-045 is the ADR that owns `trading_calendar`'s guards, so this
--      session does not add a money-path trigger on its own authority. This is
--      `0032` header item 3's restraint applied a second time, and it is
--      carried as `OI-12`.
--
--   *  NO REWRITE GRANT. B.4 step 4 restores historical `rule_states` under a
--      new version and would have to restamp this column, but `0026` revoked
--      UPDATE on `rule_states` from merit_app and PUBLIC and no SECURITY
--      DEFINER function exists to perform it. That is a PRE-EXISTING gap that
--      applies identically to `engine_version` and is not widened here; it is
--      named because this column makes a second caller for a path that has none
--      and it is carried as `OI-13`.
--
--   *  NO ENGINE. Populating the column, and refusing an audit whose in-scope
--      set is empty while rows exist, are P2. The second is the failure this
--      column creates if it is never written: every row stamped NULL after a
--      correction reads as out of scope, the audit compares NOTHING, and an
--      audit that has stopped looking reports exactly like an audit that found
--      nothing (FM-17). It belongs to the replay job rather than to the schema,
--      because no per-row constraint can tell "not yet written" from "pristine
--      calendar" without fabricating. Carried as `OI-14`.
--
-- Rulings: ADR-047 (`OQ-P2-02`). Supersedes nothing on disk: it adds a column
--          and extends a comment on what `0015` installed, and it depends on
--          the guards `0032` and `0033` installed for the stamp to mean
--          anything at all.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- The calendar revision a rule state was folded under
-- -----------------------------------------------------------------------------
-- ADR-047, closing `OQ-P2-02`. M01 Appendix B.3 names three legitimate
-- divergence causes (a superseded mark, a backdated mark, an engine upgrade)
-- and sends everything else to "no. Page." A calendar correction was not on the
-- list, so the nightly self-audit's response to one was to page once per
-- account.
--
-- A REFERENCE RATHER THAN A COPIED VALUE, which ADR-047 rules explicitly. The
-- alternative is a revision NUMBER stored as an integer, and a second copy of a
-- fact the database already owns is the drift this corpus has spent five ADRs
-- ending. The key also buys the only assertion available here: a stamp naming a
-- revision that never existed cannot be written at all.
--
-- ON DELETE RESTRICT on `rule_states.account_id`'s idiom. It is the second lock
-- rather than the first: `0032` already revoked DELETE on this table from
-- merit_app and PUBLIC, and a stamp whose target can vanish is a citation to a
-- deleted document.
ALTER TABLE rule_states
  ADD COLUMN calendar_revision_id bigint NULL
    REFERENCES trading_calendar_revisions(id) ON DELETE RESTRICT;

COMMENT ON COLUMN rule_states.calendar_revision_id IS
  'ADR-047. THE CALENDAR WATERMARK THIS FOLD READ, not the revision that '
  'corrected this row trading_day: a rule state is folded over the whole day '
  'sequence from day one, so it depends on the calendar AS A WHOLE. The '
  'highest trading_calendar_revisions id that existed when this row was '
  'computed. NULL means the calendar had never been corrected, which is every '
  'row until the first correction, and it is NOT "unknown". Replay compares '
  'only rows carrying the current watermark (M01 Appendix B.4 step 1), exactly '
  'as it scopes by engine_version. EXCLUDED FROM state_hash for the same '
  'reason engine_version is: in the hash, one correction diverges the whole '
  'book on one morning.';

-- -----------------------------------------------------------------------------
-- The state_hash exclusion list gains its fourth entry
-- -----------------------------------------------------------------------------
-- THE ONLY MACHINE-READABLE RECORD OF THE HASH INPUT SET IS THIS COMMENT, which
-- is why extending it is a line of DDL rather than a note in a document. `0015`
-- put the list here on ADR-026 C-07's finding: nothing in the corpus recorded
-- which columns the hash covers until C-07 wrote it down, and a hash whose
-- input set is implicit is a hash that changes meaning when a column is added.
-- This migration adds a column. Leaving the comment alone would make C-07's own
-- warning come true in the commit that cites it.
--
-- The nineteen hashed fields are UNCHANGED and their order is UNCHANGED, so no
-- stored hash moves and no replay is invalidated by this file.
COMMENT ON COLUMN rule_states.state_hash IS
  'SD-08. SHA-256 over the 19 fields listed in ADR-026 C-07, in declared '
  'order. context_gates, engine_version, computed_at and calendar_revision_id '
  'are excluded. calendar_revision_id is excluded on ADR-047 and for the same '
  'reason as engine_version: it is a version-like INPUT to the fold rather '
  'than a fact the fold produced, and hashing it turns a single calendar '
  'correction into a divergence on every row of every account at once.';

COMMIT;
