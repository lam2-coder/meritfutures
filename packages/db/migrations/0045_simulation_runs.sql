-- =============================================================================
-- 0045_simulation_runs
-- =============================================================================
-- E2 READ: MONEY PATH. The module is non-money under requirement (f), which is
-- about live accounts. This migration is not. It lands a CHECK on
-- `plan_versions`, which is the rule contract every funded account is sold
-- under, and it decides what a publish is ALLOWED TO BE. Read it as money path.
--
-- SD-M21-01 and SD-M21-02, transcribed from M21 section 2. ALLOCATION reserved
-- 0045 CONTINGENT on the M21 plan naming a persisted simulation run; M21
-- section 2.1 is the sentence that spends it.
--
-- -----------------------------------------------------------------------------
-- WHY A TABLE AND NOT A FIELD ON THE FORM
-- -----------------------------------------------------------------------------
-- ADR-071 section 4 raises four adversarial scenarios. Three of them
-- (AS-M21-02 the sample size, AS-M21-03 the diff, AS-M21-04 the read path) are
-- answered by showing a reader something, and all three stay defeatable by a
-- reader who does not look.
--
-- AS-M21-01, stale calibration, is NOT defeatable by attention, because the
-- staleness is invisible at the moment of the decision: stale numbers are
-- exactly as plausible as fresh ones. The only remedy that survives an
-- inattentive reader is a record, and a record is a table.
--
-- FM-M21-03 states the consequence the CHECK below exists to end: "a publish
-- lands with no link to the simulation it was decided on ... the amnesia the
-- module was admitted to end."
--
-- -----------------------------------------------------------------------------
-- THE HONEST BOUNDARY OF THIS MIGRATION, AND IT IS THE PART TO READ HARDEST
-- -----------------------------------------------------------------------------
-- NO CHECK IN THIS FILE CAN ASSERT THAT A PUBLISH RESOLVED TO A *COMPLETE* RUN
-- WHOSE `rules_digest` MATCHES THE `rules` ACTUALLY PUBLISHED. A CHECK cannot
-- read another table. What lands here makes the LINK EXIST. Nothing here makes
-- the link SOUND.
--
-- Writable today, and every one of these satisfies the constraint below:
--
--   * a publish decided on a run whose `status` is 'failed'
--   * a publish decided on a run over a DRAFT that has since been edited, so
--     `rules_digest` no longer matches the row it names
--   * a publish decided on a run belonging to a different plan entirely
--
-- The next reader of `decided_on_simulation_run_id` needs to know that the FK
-- proves a row was named and proves nothing about what it says. Closing this
-- needs a trigger or an application-layer publish path, and 0004:183 already
-- states the trade in its own words: a trigger "is a weaker control: it can be
-- disabled, and it fires per row rather than per constraint". That ruling is
-- owed and is not made here. Recorded as an open item in DELTA_MANIFEST.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- SD-M21-01. `simulation_runs`
-- -----------------------------------------------------------------------------
-- The column list is M21 section 2's row, transcribed. Types are pinned against
-- primary sources rather than chosen, and where a source and an instinct
-- disagree the source wins and the disagreement is argued in place.
CREATE TABLE simulation_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL because THE RUN IS OVER A DRAFT and a draft may not yet be a row the
  -- run can name. M21 section 2: "the run is over a draft, and a draft is
  -- mutable: a run pointing at a row that has since been edited has recorded
  -- the wrong thing." That is why the digests below exist beside this column
  -- and not instead of it.
  plan_version_id         uuid NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,

  -- WHAT WAS ACTUALLY SIMULATED, independent of what the row says today.
  rules_digest            bytea NOT NULL,
  sizes_digest            bytea NOT NULL,

  -- CALIBRATION PROVENANCE. ALLOCATION's reservation names this explicitly:
  -- the record "exists so that a published config can be traced to the
  -- calibration its simulation was run against".
  --
  -- `checkCalibrationSource` (packages/harness/src/provenance.ts) refuses a
  -- calibration source whose id is blank, so the floor below is the schema
  -- agreeing with the code that writes it.
  calibration_id          text NOT NULL,

  -- BYTEA, AND THE PRODUCER RETURNS HEX. `calibrationDigest()` is
  -- `createHash('sha256')...digest('hex')`, so it hands back a 64-character
  -- string and THE WRITE PATH DECODES IT. bytea is kept because the convention
  -- is unbroken across this schema (rule_states.state_hash at 0015,
  -- dual_control_approvals.payload_hash, ingest_files.sha256) and one column
  -- storing a digest as text would make "is this a hash" unanswerable by type.
  --
  -- A COMMENT IS NOT A TEST. The probe writes a row through the real
  -- hex-to-bytea decode, in its success block, before any rejection runs.
  calibration_digest      bytea NOT NULL,

  -- THE DAY THE FIGURES WERE OBSERVED, NEVER THE DAY OF THE RUN. `observedAt`
  -- is validated against ISO_DAY (`yyyy-mm-dd`) in provenance.ts, so this is a
  -- `date` and not a timestamptz: an observation day carries no time of day and
  -- no timezone, and inventing either would be a figure Merit made up.
  --
  -- Its unit declaration is argued in the design record, not here. The closed
  -- vocabulary has no token that fits a calibration vendor and the nearest one
  -- is defended in the open rather than picked quietly.
  calibration_observed_at date NOT NULL,

  -- REPRODUCIBILITY. `provenanceFor` refuses a blank engine version and a blank
  -- seed, so both floors below are the schema agreeing with its own writer.
  harness_version         text NOT NULL,
  engine_version          text NOT NULL,

  -- TEXT, NOT A NUMBER, and this is a transcription rather than a preference:
  -- `Provenance.seed` is typed `string` in provenance.ts. A seed stored as a
  -- bigint would round-trip some seeds and not others.
  --
  -- SIMULATION_HARNESS section 7.2: "a harness whose failures are not
  -- reproducible is a harness whose failures get attributed to noise."
  seed                    text NOT NULL,

  -- `>= 0` AND NOT `> 0`, DELIBERATELY, AND THE ARGUMENT IS THE POINT.
  --
  -- The instinct is that a simulation over zero samples is not a simulation and
  -- the CHECK should say `> 0`. The primary source disagrees: `provenanceFor`
  -- throws only on `runSampleSize < 0`, so a provenance record with
  -- `runSampleSize: 0` is LEGAL IN THE HARNESS. A `> 0` CHECK here would make a
  -- legal harness provenance unstorable, and the failure would land at the
  -- write boundary of a run that had already executed.
  --
  -- This is the schema agreeing with its own primary source instead of with an
  -- instinct. A zero-sample run is a real thing to record: it is what a
  -- misconfigured sweep arm produces, and AS-M21-02 is about sample sizes too
  -- small to separate arms, which is an argument for STORING the small number
  -- and showing it, not for refusing to store it.
  sample_size             integer NOT NULL,

  -- ONE ARM OF A SWEEP, or not part of a sweep at all. All three or none.
  --
  -- `swept_value_bp` SHIPS UNDER THE PLAN'S NAME AND THE NAME IS NOT ALWAYS
  -- TRUE. M21 section 3.4's own worked example sweeps `max_payouts`, which is a
  -- count of 5 and not a basis point. The plan's row is the authority this file
  -- transcribes, so the column keeps the plan's name and the mismatch goes to
  -- the founder's read rather than being renamed on a session's own authority.
  sweep_id                uuid NULL,
  swept_parameter         text NULL,
  swept_value_bp          bigint NULL,

  status                  text NOT NULL,

  -- NOT NULL with a default, per M21 section 2's row. An absent outputs blob
  -- and an empty one are the same fact and one representation is enough.
  outputs                 jsonb NOT NULL DEFAULT '{}',

  -- `dual_control_approvals.requested_by` (0016) is the precedent: who asked is
  -- part of the record, and a blank one is an unattributed run.
  requested_by            text NOT NULL,

  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz NULL,

  -- A hash is a SHA-256 digest or it is not a hash. 0015's wording, kept
  -- deliberately so the three digests here read as the same rule as that one.
  CONSTRAINT simulation_runs_rules_digest_is_sha256
    CHECK (length(rules_digest) = 32),
  CONSTRAINT simulation_runs_sizes_digest_is_sha256
    CHECK (length(sizes_digest) = 32),
  CONSTRAINT simulation_runs_calibration_digest_is_sha256
    CHECK (length(calibration_digest) = 32),

  CONSTRAINT simulation_runs_calibration_id_not_blank
    CHECK (btrim(calibration_id) <> ''),
  CONSTRAINT simulation_runs_harness_version_not_blank
    CHECK (btrim(harness_version) <> ''),
  CONSTRAINT simulation_runs_engine_version_not_blank
    CHECK (btrim(engine_version) <> ''),
  CONSTRAINT simulation_runs_seed_not_blank
    CHECK (btrim(seed) <> ''),
  CONSTRAINT simulation_runs_requested_by_not_blank
    CHECK (btrim(requested_by) <> ''),

  CONSTRAINT simulation_runs_sample_size_nonneg
    CHECK (sample_size >= 0),

  CONSTRAINT simulation_runs_status_known
    CHECK (status IN ('queued', 'running', 'complete', 'failed')),

  -- A BICONDITIONAL, not an implication, on plan_versions_published_has_timestamp's
  -- precedent (0004:106). A terminal run without a completion time cannot be
  -- aged, and a RUNNING run carrying one is claiming to have finished while
  -- saying it has not.
  CONSTRAINT simulation_runs_terminal_has_completion
    CHECK ((status IN ('complete', 'failed')) = (completed_at IS NOT NULL)),

  -- ALL THREE OR NONE. An arm naming a parameter but no sweep is untraceable,
  -- which is AS-M21-02 with the evidence removed: you can see the arm and you
  -- cannot see what it was an arm OF.
  CONSTRAINT simulation_runs_sweep_arm_is_whole
    CHECK (num_nonnulls(sweep_id, swept_parameter, swept_value_bp) IN (0, 3))
);

-- THE TRACEBACK READ: given a version, the runs that named it.
CREATE INDEX simulation_runs_plan_version_idx
  ON simulation_runs (plan_version_id)
  WHERE plan_version_id IS NOT NULL;

-- THE SWEEP READ: the arms of one sweep, in swept order.
CREATE INDEX simulation_runs_sweep_idx
  ON simulation_runs (sweep_id, swept_value_bp)
  WHERE sweep_id IS NOT NULL;

-- NO GRANT BLOCK, AND THAT IS A DECISION RATHER THAN AN OMISSION. 0026's
-- ALTER DEFAULT PRIVILEGES already grants SELECT/INSERT/UPDATE/DELETE on
-- future tables to merit_app. The append-only REVOKE pattern that 0038 and
-- 0039 extend does NOT apply here: `status` and `completed_at` move by design
-- as a run executes, so this table is not append-only and must not be made so.

-- -----------------------------------------------------------------------------
-- SD-M21-02. `plan_versions` records what its publish was decided on
-- -----------------------------------------------------------------------------
ALTER TABLE plan_versions
  ADD COLUMN decided_on_simulation_run_id uuid NULL REFERENCES simulation_runs(id),
  ADD COLUMN simulation_waiver_reason     text NULL;

-- EXACTLY ONE OF TWO, NEVER NEITHER. Make the recorded exception cheap and the
-- unrecorded one impossible.
--
-- This is the whole ruling. A publish either resolves to the run it was decided
-- on, or it carries a written reason why no run was consulted. What it may not
-- be is silent, because an absent link and a lost link are indistinguishable
-- afterwards, and FM-M21-03 calls that "the amnesia the module was admitted to
-- end".
--
-- SCOPED TO `published` ON PURPOSE. A draft with neither field is ordinary
-- authoring and must stay writable. A `retired` row is not re-checked here
-- because 0028's guard makes retirement fully terminal (`OLD.status =
-- 'retired'` refuses ANY change), so a published row carries its decision
-- into retirement unaltered.
ALTER TABLE plan_versions
  ADD CONSTRAINT plan_versions_publish_decision_recorded CHECK (
    status <> 'published'
    OR num_nonnulls(decided_on_simulation_run_id, simulation_waiver_reason) = 1
  );

-- A SECOND NAMED CONSTRAINT AND NOT A FOLD INTO THE FIRST, because the first
-- cannot do this job. `num_nonnulls` counts the empty string as PRESENT, so a
-- waiver of '' satisfies "exactly one" while recording nothing at all: the
-- publish would pass the control and the reader would learn no reason.
--
-- That is 0034's plaintext-floor argument on a different column. Separate and
-- named so the probe can watch each fail on its own; a compound constraint
-- passes for one reason and fails for two.
ALTER TABLE plan_versions
  ADD CONSTRAINT plan_versions_simulation_waiver_not_blank CHECK (
    simulation_waiver_reason IS NULL OR btrim(simulation_waiver_reason) <> ''
  );

-- -----------------------------------------------------------------------------
-- 0028 NEEDS NO EDIT, AND THAT IS A PROPERTY OF HOW IT WAS WRITTEN
-- -----------------------------------------------------------------------------
-- Its published-row guard does not enumerate the columns it pins. It DERIVES
-- them: `jsonb_each(to_jsonb(NEW))` minus exactly three movable keys ('status',
-- 'retired_at', 'public_visible'). So both columns added above are immutable on
-- a published row the moment they exist, with no change to the trigger.
--
-- And the guard fires on `OLD.status = 'published'`. The publish transition has
-- `OLD.status = 'draft'`, so the one UPDATE that writes these columns is not
-- touched by it. M21 section 2 names that transition as the one 0028 permits.
--
-- BOTH FACTS ARE VERIFIED BY THE PROBE, not asserted here. A migration that
-- claims a trigger behaves a certain way and never runs it is a comment.

COMMIT;
