-- =============================================================================
-- 0040_report_schedules
-- =============================================================================
-- NON-MONEY. No ledger account, no balance, no eligibility, no payout. What it
-- carries is the DELIVERY OF A CONTROL, and that is worth stating before the
-- DDL rather than after it:
--
--   THE C8 WEEKLY RISK RITUAL'S INPUT IS CURRENTLY A HUMAN REMEMBERING TO LOOK.
--   Constitution 0 lists liability blindness first, with the quote attached:
--   FTT "didn't know their liabilities till everyone requested". M06 exists
--   against that, and M06:377 already calls the recurring artifact "the single
--   most useful recurring artifact this module produces" WITH NO DELIVERY
--   MECHANISM SPECIFIED ANYWHERE. A control that exists and does not arrive is
--   a control that enforces nothing. A report that stops arriving is how
--   liability blindness starts, and it starts silently.
--
-- ADR-066, PROPOSED 2026-08-20, section 3. Planned by FOLD-03 section 5.2.
--
-- THIS IS NOT A SCHEDULER OVER A REPORT BUILDER, AND THE DDL IS WHERE THAT IS
-- ENFORCED. ADR-066 section 0 item 2 records that the referral asked for
-- recurring delivery of "the reporting layer's saved views" and that NEITHER
-- OBJECT EXISTS: `saved view` and `reporting layer` return nothing across
-- docs/plans/ and docs/architecture/, and `scheduled report` returns exactly
-- one line, M06:377, which is not a builder. So a report builder is refused
-- (ADR-066 section 8, alternative 4) and what is admitted is FOUR NAMED DIGESTS
-- over panels M06 already has.
--
--   `report_schedules.digest` IS A CLOSED VOCABULARY OF FOUR. That CHECK is the
--   whole difference between this file and the module ADR-066 refused. A fifth
--   digest needs a migration, which needs a ruling; without the CHECK, "the
--   named set" is a sentence in a plan and the first session asked for a custom
--   report adds a row.
--
-- FIVE things need the founder's read:
--
--   1. THE DELIVERY LOG IS THE LOAD-BEARING HALF, AND THE ALARM READS IT RATHER
--      THAN THE JOB. This is M05:91 INV-M5-18's idiom, deliberately reused on a
--      second sweep rather than reinvented: that invariant is asserted "on the
--      QUERY, never on the job", on the stated ground that A JOB THAT REPORTS
--      SUCCESS IS NOT EVIDENCE THAT THE WORK HAPPENED (M02 FM-M2-11). GS-288 is
--      exactly the case where the job reports success and nothing arrived.
--
--      THAT IS WHY `due_at` EXISTS AND IT IS THE COLUMN THE WHOLE CONTROL RESTS
--      ON. Absence is only detectable against an expectation. Without a stored
--      window, "no delivery row" and "not due yet" are byte-identical, and the
--      alarm has nothing to fire on -- the same shape 0039's coverage bound has
--      one table over, where an exhausted calendar is indistinguishable from a
--      quiet week.
--
--   2. THERE IS DELIBERATELY NO `skipped` OUTCOME. Two values: `delivered` and
--      `failed`. A skip that can be RECORDED as an outcome is a skip that reads
--      as normal in a list of outcomes, and FOLD-03 section 5.2's acceptance is
--      "a failed delivery alarms and NEVER SILENTLY SKIPS". A run that decides
--      not to send writes `failed` with its reason, or it writes nothing and
--      the missing row is itself the finding. Both roads reach a human.
--
--   3. THE DEGRADATION IN GS-290 IS TWO CONSTRAINTS, NOT A CONVENTION. A
--      schedule naming a recipient who has been removed delivers to the rest
--      "AND RECORDS THE REMOVAL". So an omission that states no reason is
--      UNWRITABLE, and a delivery that reached NOBODY cannot be recorded as
--      `delivered` at all. The second one is the one that matters: full
--      degradation to zero recipients is the failure wearing the costume of a
--      success, and it is the exact shape of the thing this table exists
--      against.
--
--   4. NO ARTIFACT IS STORED HERE, ONLY ITS DIGEST, AND THAT IS INV-M6-10
--      RATHER THAN A SIZE DECISION. M06:54 permits trader-identifying data only
--      when the query names a specific subject, and ADR-066 section 3 says no
--      digest is a bulk identity export. A table holding every rendered digest
--      body would BE the bulk export, sitting behind an admin route, created by
--      the feature that was admitted on the promise it was not one. The SHA-256
--      answers "was what arrived what we generated" and answers nothing about
--      any trader.
--
--   5. `report_schedules` IS MUTABLE AND `report_deliveries` IS NOT. A schedule
--      is configuration: recipients change, a schedule is disabled, and every
--      such change is an INV-M6-01 `admin_actions` row. An attempt is history.
--      The REVOKE at the foot is what makes "one row per delivery attempt with
--      its outcome" a fact rather than a hope: an UPDATE-able outcome column is
--      a delivery log that can be made to say the report arrived.
--
-- WHAT IS NOT HERE, deliberately: no job, no renderer, no credential, no
-- transport and no rows. Both tables have zero rows on merge, so nothing below
-- can be read as evidence that any digest has ever been delivered.
--
-- AND SFTP REUSES NO M02 CODE PATH. M02's SFTP is a VENDOR WIRE FORMAT held
-- provisional under ADR-005, and coupling them would make a reporting change a
-- provisioning incident. Mechanically: nothing in this file references an M02
-- object, and `recipients` names a destination rather than holding a credential.
-- OQ-F3-04 stands -- email is the MUST channel and SFTP is a second credential
-- surface, which makes "is email alone acceptable for v1" the founder's
-- security question rather than a convenience one (ADR-066 section 3).
--
-- Rulings: ADR-066 (section 3), FOLD-03 section 5.2. Gives M06:377's recurring
--          artifact a delivery mechanism for the first time; see the note in
--          M06 section 3.6 on why the suppression digest is NOT one of the four.
--          Supersedes nothing.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- report_recipients_are_wellformed
-- -----------------------------------------------------------------------------
-- A CHECK constraint may not contain a subquery, and both duplicate-detection
-- and per-element blankness over an array need one. 0021's `measures_are_distinct`
-- is the precedent and the reason is the same: IMMUTABLE because it reads
-- nothing outside its argument, which is what makes it LEGAL in a CHECK rather
-- than merely accepted there.
--
-- TOTAL FOR EVERY INPUT INCLUDING NULL, and that clause is not decoration.
-- ADR-035 found a CHECK that evaluates to NULL PASSES seven times in the
-- `array_length` form, and 0028 superseded all seven. `cardinality(NULL)` is
-- NULL, so a body opening on it would return NULL for a NULL array and the
-- constraint would pass. The leading `r IS NOT NULL` makes every branch below
-- reachable only for a real array, and the function returns false rather than
-- NULL for the one input that would otherwise leak through.
--
-- AN EMPTY ARRAY PASSES HERE, deliberately. Emptiness is legal for
-- `recipients_omitted` and illegal for `recipients`, so it is asserted at the
-- column that means it rather than folded into a helper that would then need
-- two versions.
CREATE FUNCTION report_recipients_are_wellformed(r text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT r IS NOT NULL
     AND array_position(r, NULL) IS NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(r) AS x WHERE length(btrim(x)) = 0)
     AND cardinality(r) = (SELECT count(DISTINCT x) FROM unnest(r) AS x);
$$;

COMMENT ON FUNCTION report_recipients_are_wellformed(text[]) IS
  'No NULL element, no blank element, no duplicate. An empty array passes: '
  'emptiness is legal for report_deliveries.recipients_omitted and illegal for '
  'report_schedules.recipients, so it is asserted per column (ADR-066 s3).';

-- -----------------------------------------------------------------------------
-- report_schedules: the four named digests, and nothing else is schedulable
-- -----------------------------------------------------------------------------
CREATE TABLE report_schedules (
  -- uuid rather than 0039's bigint identity, and the split is the corpus's
  -- existing one: this id appears in an admin route, and `economic_calendar`'s
  -- does not.
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- THE CLOSED SET. Header paragraph 3. Each name is one of ADR-066 section 3's
  -- four, and each reads panels M06 section 3.1 already defines:
  --
  --   daily_liability          P-M6-01 Open Liability, P-M6-03 Eligible-Next-7,
  --                            and P-M6-07's reserve coverage ratio, which
  --                            reads a LIVE rail balance (M05 SD-M5-03)
  --   weekly_loss_ratio_cusum  P-M6-05 per-plan loss ratio WITH ITS SAMPLE SIZE
  --                            (INV-M6-07) and P-M6-06 pass-rate CUSUM
  --   weekly_flag_queue        the flag queue summary: counts and links
  --   monthly_revenue_cohort   revenue and cohort
  --
  -- SIZING IS PER DIGEST AND IT BINDS (ADR-066 section 1). `daily_liability`
  -- and `weekly_loss_ratio_cusum` are MUST because they are the C8 ritual's
  -- input; the other two are SHOULD, useful, and nothing depends on them.
  digest        text NOT NULL CHECK (digest IN (
                  'daily_liability',
                  'weekly_loss_ratio_cusum',
                  'weekly_flag_queue',
                  'monthly_revenue_cohort'
                )),

  -- GENERATED FROM digest, never written independently. 0019's `mutable` and
  -- 0029's `rate_limit_exempt` are the idiom and the argument is theirs: the
  -- cadence is a PROPERTY OF THE DIGEST rather than a choice, so as an ordinary
  -- column a daily liability digest could be scheduled monthly by one careless
  -- insert and nothing would object. Generated, the two facts CANNOT DISAGREE.
  --
  -- The CASE is total by construction rather than by the CHECK above: every one
  -- of the four has an arm, and an unknown digest yields NULL against a NOT NULL
  -- column, which is a refusal rather than a silent pass.
  --
  -- THE TWO REFUSALS GUARD EACH OTHER'S WIDENING, AND THAT IS THE POINT RATHER
  -- THAN BELT-AND-BRACES. Executed against PostgreSQL 16.13 while writing this
  -- file: a fifth digest is refused by the NOT NULL on THIS column, not by the
  -- CHECK on `digest`, because a generated column is computed before CHECK
  -- constraints are evaluated. So the error message names `cadence` for a defect
  -- in `digest`, which is recorded here so the next reader is not surprised by
  -- it. Dropping the NOT NULL and re-inserting shows `report_schedules_digest_check`
  -- firing, so the CHECK is live and not decoration.
  --
  -- What the pair buys is that ADMITTING A FIFTH DIGEST IS A TWO-PLACE EDIT: a
  -- migration that widens the CASE and forgets the CHECK is refused by the
  -- CHECK, and one that widens the CHECK and forgets the CASE is refused by
  -- this NOT NULL. Either way a half-admitted digest cannot exist, and ADR-066
  -- section 8's refused report builder cannot arrive one arm at a time.
  cadence       text NOT NULL GENERATED ALWAYS AS (
                  CASE digest
                    WHEN 'daily_liability'         THEN 'daily'
                    WHEN 'weekly_loss_ratio_cusum' THEN 'weekly'
                    WHEN 'weekly_flag_queue'       THEN 'weekly'
                    WHEN 'monthly_revenue_cohort'  THEN 'monthly'
                  END
                ) STORED,

  -- CSV or PDF, per FOLD-03 section 5.2. Recorded on the schedule AND on every
  -- attempt, for the reason given at report_deliveries.format.
  format        text NOT NULL CHECK (format IN ('csv', 'pdf')),

  -- Email is MUST. SFTP push is SHOULD and is a second credential surface
  -- (OQ-F3-04, open). It reuses no M02 code path; see the header.
  channel       text NOT NULL CHECK (channel IN ('email', 'sftp')),

  -- WHERE IT GOES, IN THE CHANNEL'S OWN VOCABULARY: a mailbox for `email`, a
  -- configured destination name for `sftp`. NO CREDENTIAL IS STORED HERE and
  -- there is deliberately no column that could hold one: ADR-010's sensitive
  -- set already covers treasury and rail credentials behind dual control, and a
  -- reporting table that grew a secret would be a fifth credential store nobody
  -- ruled on.
  recipients    text[] NOT NULL,

  -- A schedule is turned off rather than deleted, because a deleted schedule
  -- takes its delivery history's referent with it and the alarm's question
  -- ("did the artifact for this window arrive") stops being answerable for
  -- every window it ever covered.
  enabled       boolean NOT NULL DEFAULT true,

  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A schedule with no recipients is a control that delivers nothing while
  -- reading, in a list of schedules, exactly like one that does.
  CONSTRAINT report_schedules_has_recipients CHECK (
    cardinality(recipients) >= 1
  ),
  CONSTRAINT report_schedules_recipients_wellformed CHECK (
    report_recipients_are_wellformed(recipients)
  ),
  CONSTRAINT report_schedules_created_by_stated CHECK (
    length(btrim(created_by)) > 0
  )
);

-- ONE ENABLED SCHEDULE PER DIGEST PER CHANNEL, and it is a control rather than
-- tidiness. Two enabled schedules for the same digest and channel give the
-- alarm's "did it arrive" question two answers, and they deliver the artifact
-- twice, which is the fastest way to teach an operator to ignore it. A second
-- recipient does not need a second schedule: `recipients` is an array.
CREATE UNIQUE INDEX report_schedules_live_uq
  ON report_schedules (digest, channel)
  WHERE enabled;

-- The scheduler's read: what is due, by cadence.
CREATE INDEX report_schedules_enabled_idx
  ON report_schedules (cadence, digest)
  WHERE enabled;

COMMENT ON TABLE report_schedules IS
  'SD-M6-07, ADR-066 section 3. The four named digests of FOLD-03 section 5.2 '
  'and nothing else: `digest` is a closed vocabulary, which is what makes "this '
  'is not a report builder" a schema fact. Mutable configuration; every change '
  'is an INV-M6-01 admin_actions row. The delivery history is append-only and '
  'lives in report_deliveries.';

COMMENT ON COLUMN report_schedules.recipients IS
  'Mailboxes for the email channel, configured destination names for sftp. '
  'Never a credential (ADR-010 owns the sensitive set).';

-- -----------------------------------------------------------------------------
-- report_deliveries: one row per attempt, and it is what the alarm reads
-- -----------------------------------------------------------------------------
-- Header item 1. THE ALARM FIRES ON THIS TABLE AND NEVER ON THE JOB'S OWN
-- REPORT, which is M05 INV-M5-18's construction on a second sweep. The dead-man
-- switch is in CRON_INVENTORY.
CREATE TABLE report_deliveries (
  -- bigint identity, 0039's split: this id is internal and never in a URL.
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  schedule_id          uuid NOT NULL
                       REFERENCES report_schedules(id) ON DELETE RESTRICT,

  -- THE WINDOW THIS ATTEMPT DISCHARGES, and the column the control rests on
  -- (header item 1). The alarm is an anti-join: an enabled schedule whose
  -- closed window carries no `delivered` row. Without this, absence is
  -- unaskable.
  due_at               timestamptz NOT NULL,

  -- Ordinal within (schedule_id, due_at). A retry is a NEW ROW rather than an
  -- update of the failed one, on 0039's revision reasoning: the failure that
  -- was retried is the evidence, and an attempt count that overwrites its own
  -- history answers "how bad was it" with "fine, eventually".
  attempt              integer NOT NULL,

  -- WHAT CLOSED DATA THIS DIGEST REPORTS, which is a different fact from when
  -- it was due. INV-M6-04: every number names its as-of moment and its source,
  -- and a digest that leaves the console loses the page that would have said
  -- so. A Monday delivery of Friday's book is correct and is only correct
  -- BECAUSE IT SAYS SO.
  covers_through_trading_day  date NOT NULL,

  -- TRANSCRIBED AT ATTEMPT TIME rather than joined from the schedule, because
  -- the schedule is mutable: a channel or format changed next month would
  -- rewrite what every historical delivery claims to have been. This is the
  -- same argument M16 FM-M16-05's stored `rendered_body` makes for proof of
  -- notice, applied to the envelope instead of the contents.
  channel              text NOT NULL CHECK (channel IN ('email', 'sftp')),
  format               text NOT NULL CHECK (format IN ('csv', 'pdf')),

  -- WHO IT ACTUALLY REACHED, and who it did not. GS-290, header item 3.
  recipients_attempted text[] NOT NULL,
  recipients_omitted   text[] NOT NULL DEFAULT '{}',

  -- Why the omitted ones were omitted. Required when there are any, refused
  -- when there are none. "Records the removal" is this column.
  omission_reason      text NULL,

  -- TWO VALUES, header item 2. There is no `skipped`.
  outcome              text NOT NULL CHECK (outcome IN ('delivered', 'failed')),

  -- Required on a failure, refused on a success. A failed delivery with no
  -- stated reason records that something went wrong and NOT what, which is the
  -- alarm arriving without its evidence.
  failure_reason       text NULL,

  -- The delivered/attempted separation M16 FM-M16-05 already draws between
  -- `sent_at` and `delivered_at`, and integration_dispatches' own
  -- `sent_has_timestamp` constraint one table over.
  attempted_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at         timestamptz NULL,

  -- SHA-256 OF THE ARTIFACT, NEVER THE ARTIFACT (header item 4). rule_states'
  -- idiom: a hash is a SHA-256 digest or it is not a hash.
  artifact_digest      bytea NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_deliveries_attempt_is_ordinal CHECK (
    attempt >= 1
  ),

  CONSTRAINT report_deliveries_attempted_wellformed CHECK (
    report_recipients_are_wellformed(recipients_attempted)
  ),
  CONSTRAINT report_deliveries_omitted_wellformed CHECK (
    report_recipients_are_wellformed(recipients_omitted)
  ),

  -- A name cannot be both reached and omitted in one attempt. `&&` is total for
  -- two NOT NULL arrays and returns false when either is empty.
  CONSTRAINT report_deliveries_recipient_sets_disjoint CHECK (
    NOT (recipients_attempted && recipients_omitted)
  ),

  -- GS-290's "AND RECORDS THE REMOVAL", as a refusal. An equivalence rather
  -- than an implication on 0039's reasoning, closing both directions: an
  -- attempt that omitted nobody may not claim a removal it did not make, and
  -- one that omitted somebody may not stay silent about it. Both sides are
  -- total: `cardinality` of a NOT NULL array is an integer, and `IS NULL` is a
  -- boolean for every input.
  CONSTRAINT report_deliveries_omission_states_its_reason CHECK (
    (cardinality(recipients_omitted) > 0) = (omission_reason IS NOT NULL)
  ),
  CONSTRAINT report_deliveries_omission_reason_stated CHECK (
    omission_reason IS NULL OR length(btrim(omission_reason)) > 0
  ),

  -- THE ONE THAT MATTERS MOST IN THIS TABLE. GS-290 degrades to the REMAINING
  -- recipients; degrading to none of them is not a degraded success, it is a
  -- failure that has learned to look like one. A delivery that reached nobody
  -- cannot be written as `delivered`.
  CONSTRAINT report_deliveries_delivered_reached_somebody CHECK (
    outcome <> 'delivered' OR cardinality(recipients_attempted) > 0
  ),

  CONSTRAINT report_deliveries_delivered_has_timestamp CHECK (
    (outcome = 'delivered') = (delivered_at IS NOT NULL)
  ),
  CONSTRAINT report_deliveries_delivered_has_digest CHECK (
    (outcome = 'delivered') = (artifact_digest IS NOT NULL)
  ),
  CONSTRAINT report_deliveries_digest_is_sha256 CHECK (
    artifact_digest IS NULL OR length(artifact_digest) = 32
  ),

  CONSTRAINT report_deliveries_failure_states_its_reason CHECK (
    (outcome = 'failed') = (failure_reason IS NOT NULL)
  ),
  CONSTRAINT report_deliveries_failure_reason_stated CHECK (
    failure_reason IS NULL OR length(btrim(failure_reason)) > 0
  ),

  CONSTRAINT report_deliveries_delivery_follows_attempt CHECK (
    delivered_at IS NULL OR delivered_at >= attempted_at
  )
);

-- One row per attempt per window, and the attempt number is what makes a retry
-- an append. A second write at attempt 1 is refused, so a job re-running a
-- window has to say it is retrying.
CREATE UNIQUE INDEX report_deliveries_window_attempt_uq
  ON report_deliveries (schedule_id, due_at, attempt);

-- THE ALARM'S READ, and it is the reason this index is not merely the unique
-- one above reversed: the question is "the newest window for this schedule that
-- carries a delivered row", asked per enabled schedule on every evaluation.
CREATE INDEX report_deliveries_delivered_window_idx
  ON report_deliveries (schedule_id, due_at DESC)
  WHERE outcome = 'delivered';

-- The ops read: what failed, newest first, across every schedule.
CREATE INDEX report_deliveries_failed_idx
  ON report_deliveries (attempted_at DESC)
  WHERE outcome = 'failed';

COMMENT ON TABLE report_deliveries IS
  'SD-M6-07, ADR-066 section 3. ONE ROW PER DELIVERY ATTEMPT WITH ITS OUTCOME, '
  'append-only by grant. The delivery-failure alarm reads THIS TABLE and never '
  'the job report, which is M05 INV-M5-18 on a second sweep: a job that reports '
  'success is not evidence that the work happened (GS-288). No `skipped` '
  'outcome exists. Holds no artifact, only its SHA-256 (INV-M6-10). '
  'Retention: forever.';

COMMENT ON COLUMN report_deliveries.due_at IS
  'The window this attempt discharges. The alarm is an anti-join against it: '
  'without a stored window, "nothing arrived" and "not due yet" are the same '
  'empty result (ADR-066 s3, GS-288).';

COMMENT ON COLUMN report_deliveries.covers_through_trading_day IS
  'Unit: trading day. The last closed trading day the digest reports, which is '
  'a different fact from due_at. INV-M6-04 applied to an artifact that has left '
  'the console.';

-- -----------------------------------------------------------------------------
-- report_deliveries is append-only, by grant rather than by convention (VG-8)
-- -----------------------------------------------------------------------------
-- 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app full DML on
-- anything a later migration creates, so this table is UPDATE-able and
-- DELETE-able the instant it exists. Without this REVOKE, "one row per delivery
-- attempt with its outcome" is a sentence in a header: a `failed` row could be
-- moved to `delivered` after the fact, and the alarm's own evidence would be
-- editable by the process the alarm exists to distrust.
--
-- Against PUBLIC as well as merit_app, because a revoke that only binds the
-- application role is a revoke that a second connection string bypasses. 0026's
-- own words; this SUPERSEDES its list rather than editing it, on 0032's and
-- 0039's precedent.
--
-- `report_schedules` IS DELIBERATELY NOT REVOKED (header item 5). It is
-- configuration and it changes: recipients are added, a schedule is disabled.
-- Every such change is an INV-M6-01 `admin_actions` row with actor, reason,
-- before and after, and `enabled` is why nothing needs DELETE.
REVOKE UPDATE, DELETE ON report_deliveries FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT, on 0032's and 0039's
-- stated default: a new table is invisible to analytics until somebody grants
-- it, and it arrives with a consumer that names itself or not at all.
-- `recipients` is a list of Merit operators' mailboxes, so the eventual grant
-- is a decision about staff data rather than a formality.

COMMIT;
