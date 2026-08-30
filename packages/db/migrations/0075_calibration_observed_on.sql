-- =============================================================================
-- 0075_calibration_observed_on
-- =============================================================================
-- E2 READ: NOT THE MONEY PATH, AND THE REASON IS WORTH STATING RATHER THAN
-- ASSUMED. No value moves, no constraint is added or dropped, no grant changes
-- and no row is written. `ALTER TABLE ... RENAME COLUMN` is a catalogue edit:
-- the column keeps its type, its NOT NULL, its ordinal position, its comment
-- and every byte it holds. `simulation_runs` decides what a publish is allowed
-- to be, which is why 0045 was read as money path, but this file does not touch
-- that decision. A reviewer should still read it, because it is the FIRST
-- statement in this estate to change an existing column, and section 3 below is
-- about what that costs the readers that parse this directory.
--
-- ADR-278, on ADR-272 section 5. ALLOCATION row 278 reserves 0075 to it.
--
-- -----------------------------------------------------------------------------
-- 1. WHAT IS WRONG WITH THE NAME
-- -----------------------------------------------------------------------------
-- 0045:103 declares `calibration_observed_at date NOT NULL`. ADR-146 clause 2
-- spells an instant `*_at`, and ADR-272 clause 3 ruled the narrow form of that
-- convention: a column name may be SILENT about its temporal type and may not
-- be FALSE about it. This name is false. It is 1 of 321 `*_at` column
-- declarations in the estate and the only one on a non-instant.
--
-- ADR-271 section 3 then made the property load bearing rather than tidy. That
-- entry shipped a global `setTypeParser` on OID 1082 and bounded its blast
-- radius with the argument that "an instant is spelled `*_at` and a day is
-- spelled `*_day` or `*_on`, so the two vocabularies do not overlap". This
-- column is the one place in the schema where that argument and the wire
-- disagree, and a property a live driver change has been argued from is a rule
-- whatever document it was written in.
--
-- `_on` AND NOT `_day`, WHICH IS A RULING AND NOT A PREFERENCE. API_CONTRACT
-- section 1 makes `*_day` an EXCHANGE trading day. A calibration observation
-- day is the day a vendor's figures were read off (provenance.ts: "`observedAt`
-- NAMES WHEN ITS FIGURES WERE READ OFF IT"), which is on no exchange calendar.
-- Renaming to `_day` would trade one false assertion for a second one.
--
-- -----------------------------------------------------------------------------
-- 2. WHY A NEW MIGRATION AND NOT AN EDIT TO 0045
-- -----------------------------------------------------------------------------
-- Constitution E2. 0045 is merged, and a merged migration is never edited, only
-- superseded. Its header stays exactly as written, including the three
-- sentences that argue the `date` type under the old name, because a merged
-- migration is a record of what it did and not a description of the schema as
-- it stands today.
--
-- A RENAME PRESERVES THE DATA, so there is no backfill, no dual-write window
-- and nothing to coordinate. Verified against the installed catalogue before
-- this file was written: no constraint expression, no index definition, no view
-- and no column comment names `calibration_observed_at`, so the rename has no
-- dependency to carry and PostgreSQL rewrites nothing.
--
-- -----------------------------------------------------------------------------
-- 3. THE THING THIS FILE BREAKS, NAMED HERE RATHER THAN DISCOVERED LATER
-- -----------------------------------------------------------------------------
-- BEFORE THIS FILE THE ESTATE HELD ZERO `RENAME COLUMN` AND ZERO `DROP COLUMN`
-- STATEMENTS, measured over all 68 migrations. Two readers in this repository
-- parse this directory for "the columns the schema declares" and both build
-- that answer as the UNION of `CREATE TABLE` bodies and `ADD COLUMN` clauses:
-- RI-26 in packages/tooling/checks/repo-invariants.mjs, and `dateColumns()`
-- behind CI-06m in scripts/corpus/gates.mjs.
--
-- That union equalled the installed schema on every tree until this one. It
-- does not equal it here: 0045 still declares `calibration_observed_at` and the
-- database no longer has a column by that name.
--
-- ADR-278 folds renames into RI-26's reader, so that check now reads the schema
-- the set INSTALLS. `dateColumns()` is outside this row's fence and is left
-- reading declarations, which ADR-278 section 5 records as owed and states the
-- cost of. Neither is a defect this file introduces; both are assumptions this
-- file is the first statement to falsify, and a reviewer should treat the
-- second as live.
-- =============================================================================

BEGIN;

-- THE WHOLE MIGRATION. `RENAME COLUMN` is transactional in PostgreSQL and takes
-- ACCESS EXCLUSIVE for the catalogue update only; it rewrites no heap.
ALTER TABLE simulation_runs
  RENAME COLUMN calibration_observed_at TO calibration_observed_on;

-- The design record argues the unit and this states it at the database, where a
-- reader who never opens docs/ still meets it. `rail clock` is ADR-082's
-- ruling: never `now()`, never an exchange day, and the day a vendor published
-- the figures rather than the day Merit read them.
COMMENT ON COLUMN simulation_runs.calibration_observed_on IS
  'ADR-278, renaming 0045''s calibration_observed_at. THE DAY THE CALIBRATION '
  'FIGURES WERE OBSERVED, never the day of the run. Unit: rail clock '
  '(ADR-082). The `_on` suffix is ADR-272 clause 3: a `date` wearing `_at` '
  'asserts an RFC 3339 instant (ADR-146 clause 2) and this value is a day. NOT '
  '`_day`, which API_CONTRACT section 1 reserves for an EXCHANGE trading day; '
  'a calibration vendor publishes on no exchange calendar.';

COMMIT;
