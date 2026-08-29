-- =============================================================================
-- 0066_published_size_grid_immutable
-- =============================================================================
-- E2 READ: MONEY PATH. This file closes the gap between what `0028` guarantees
-- and what the money actually lives in. It edits nothing: `0004`, `0027` and
-- `0028` stay exactly as they were written and this file adds one function and
-- one trigger beside them (constitution E2).
--
-- ADR-213, status PROPOSED, UNSIGNED. The founder's line-by-line read is OWED
-- and is not recorded as done anywhere.
--
-- -----------------------------------------------------------------------------
-- 1. THE DEFECT, AND IT WAS LIVE IN THE MERGED SCHEMA
-- -----------------------------------------------------------------------------
-- `0027:260` creates `plan_versions_published_immutable` and `0028` replaces its
-- function body, so a PUBLISHED `plan_versions` row is pinned to the byte and a
-- RETIRED one is frozen absolutely.
--
-- `plan_version_sizes` CARRIED ZERO TRIGGERS. Read from `pg_trigger` against the
-- full merged set rather than from a grep: the only non-internal triggers on any
-- plan table are `plan_versions_published_immutable`,
-- `plan_versions_publish_decision_is_sound`,
-- `plan_versions_publish_decision_is_sound_on_publish` and
-- `accounts_plan_version_pinned`. Not one is on the size grid, and `merit_app`
-- holds `INSERT`, `UPDATE`, `DELETE` and `SELECT` on it, read from
-- `information_schema.role_table_grants` and granted by `0026:75`'s blanket
-- `GRANT ... ON ALL TABLES`, from which this table is never subtracted: `0026`
-- names it once, in a `REVOKE` aimed at `merit_analytics` (`0026:156`).
--
-- SO `0028`'s IMMUTABILITY GUARANTEE IS TRUE OF THE ROW AND FALSE OF THE MONEY.
-- Executed on PostgreSQL 16 against `0001`..`0065` applied forward-only from
-- empty, inside a rolled-back transaction: `buffer_cents` moved from `100000` to
-- `777777` on a PUBLISHED version, that version's whole size grid `DELETE`d, and
-- a fourth size `INSERT`ed into it. All three COMMITTED.
--
-- WHAT DEPENDS ON THOSE ROWS, in the tree's own words:
-- `packages/rules-engine/src/types.ts` -- "`plan_versions.rules` for STRUCTURE
-- and `plan_version_sizes` for EVERY CENTS". `ResolvedPlan` reads the drawdown,
-- the profit target, the buffer, the win-day floor, the payout cap schedule, the
-- daily loss limit and all three floor-lock values from this table. A payout
-- approval computed from those numbers writes an append-only
-- `eligibility_snapshot` (`INV-22`), so the failure is not a stale response. It
-- is an approval the catalogue no longer supports, recorded as though it did.
--
-- -----------------------------------------------------------------------------
-- 2. WHAT IS RULED, AND THE `INSERT` IS DECIDED RATHER THAN ASSUMED
-- -----------------------------------------------------------------------------
-- `UPDATE` refused, `DELETE` refused, `INSERT` REFUSED. Once a version leaves
-- `draft` its size grid is fixed AS A SET.
--
-- The first two follow from `0028` one table out: moving a published cents value
-- is the retroactive rule change B4 #12 exists to make impossible, and deleting
-- the grid is the same act with the numbers removed rather than replaced.
--
-- THE `INSERT` IS THE ONE THAT NEEDED AN ARGUMENT, because adding a size takes
-- nothing away from any account that already exists. It is refused on evidence
-- rather than on symmetry, and the evidence is that NOTHING VALIDATES SUCH A ROW:
--
--   a. `validatePlan(rules, sizes)` IS THE PUBLISH GATE AND IT TAKES THE WHOLE
--      ARRAY. `packages/rules-engine/src/plan/validate.ts` states the split --
--      nine of the nineteen `CV` rules read only `plan_versions.rules`, "eight
--      read `plan_version_sizes` and are evaluated once per size", and `CV-05`
--      and `CV-16` straddle both. It runs at the publish transition
--      (`apps/api/src/routes/admin-writes.ts` reads the grid with `rowsWhere`
--      and hands the array to `backend.validatePlan`). A row inserted after that
--      transition is a row `validatePlan` was never given.
--
--   b. AND THE DATABASE CANNOT STAND IN FOR IT. Of the eight size-level rules
--      exactly one has a `CHECK` counterpart: `CV-11` is
--      `plan_version_sizes_buffer_clears_lock`. `CV-09` (the cap schedule's
--      shape), `CV-10` (`cap_cents >= min_payout_cents`), `CV-12` (the locked
--      floor's offset) and `CV-17` have NO constraint on this table, and three of
--      those four read the parent's `rules` jsonb, which `0004:183` already
--      records a `CHECK` cannot do. The `floor_lock_enabled` materialization is
--      in the same position: `0004:188` says "CV-publish validation asserts the
--      materialized flag matches the parent's jsonb", and that is publish-time
--      code and not a constraint.
--
--   c. SO AN INSERTED ROW IS `validate.ts`'s OWN FAILURE MODE, WRITTEN DOWN
--      BEFORE THIS FILE EXISTED: "A size row that disagrees with its own rules is
--      two plans wearing one version number, and which of the two an account gets
--      depends on which field a rule happens to read."
--
--   d. AND THE CORPUS ALREADY HAS A MECHANISM FOR OFFERING A NEW SIZE. It is
--      publishing a version. `0044`'s `plan_size_unlocks` says so from the other
--      side: the unlock names a `size_cents` rather than a row id "because the
--      entitlement is to the SIZE, and a version publishing the same size again
--      should honour an unlock earned against it".
--
-- A DRAFT VERSION'S GRID IS UNTOUCHED AND THAT IS THE POINT. Authoring happens on
-- a draft, the publish transition validates the draft's grid as a set, and after
-- it the set is what was validated. `admin-writes.ts` already writes exactly this
-- order: it creates the version with `status: 'draft'`, inserts every size row
-- into the draft, and publishes in a second route. NOTHING IN `apps/` IS BROKEN
-- BY THIS GUARD, and that is checked rather than hoped: the only writer of this
-- table in the tree is that module, and every route in it answers 503 today.
--
-- -----------------------------------------------------------------------------
-- 3. THE MECHANISM IS `0027`/`0028`'s, EXTENDED BY EXACTLY ONE `SELECT`
-- -----------------------------------------------------------------------------
-- A `BEFORE ... FOR EACH ROW` PL/pgSQL trigger raising `check_violation`, which
-- is `plan_versions_published_immutable`'s shape and not a new one. It is NOT a
-- `CONSTRAINT TRIGGER`: deferring would let the write land and fail at `COMMIT`,
-- which is weaker for no gain here, and `0027` defers only the assertions that
-- must see a whole transaction.
--
-- THE ONE THING `0027` AND `0028` DO NOT SUPPLY, SAID PLAINLY: their predicate is
-- row-local, comparing `OLD` against `NEW` on the guarded table. This one is not.
-- The status that decides the refusal lives on the PARENT, so the body reads
-- `plan_versions` and a `CHECK` constraint could not express it at all -- which is
-- `0004:183`'s own argument for why `floor_lock_enabled` is materialized rather
-- than checked. That is a widening of the predicate and not of the mechanism, and
-- it is stated here rather than left for a reader to notice.
--
-- FOUR THINGS THIS GUARD DOES NOT DO, because a guard believed to cover more than
-- it does is worse than one that is missing:
--
--   1. `TRUNCATE`. A row-level trigger does not fire on it. It is not reachable
--      by the application role -- `information_schema.role_table_grants` gives
--      `merit_app` exactly `SELECT`, `INSERT`, `UPDATE`, `DELETE` here and no
--      `TRUNCATE` -- so the hole is the owner's, which is item 2 anyway.
--   2. A SUPERUSER OR THE TABLE OWNER can `ALTER TABLE ... DISABLE TRIGGER`.
--      `0004:184-185`'s cost, stated there and unhedged: a trigger "can be disabled
--      and it fires per row". It won here because the alternative does not exist.
--   3. IT DOES NOT PIN `plans`. Session 401 finding 5: `plans` carries zero
--      triggers and `plans.code` moved on a live database. `ADR-141` clause 3
--      credits `0028` with pinning it and `0028` does not name that table. That
--      is a display field rather than money, it needs its own ruling, and it is
--      REPORTED here rather than folded in.
--   4. IT DOES NOT WIRE `usePayoutBackend`. `ADR-211` rules that port blocked;
--      this clears one of its grounds and not the port.
--
-- HOW THE REFUSAL WAS CHECKED, which is `0028`'s own lesson: `0027` installed a
-- function that read `NEW.config` on a table with no such column, and it
-- installed CLEANLY because PL/pgSQL resolves record fields at EXECUTION. A
-- migration that applies is not a guard that works. Every case below was WATCHED
-- FIRING against a live PostgreSQL 16 before this file was committed, refusals by
-- SQLSTATE and by message text, and the acceptances too:
-- `scripts/db/probe_published_size_grid_immutable.sql` is that transcript, it is
-- wired into the `migrations` job of `.github/workflows/corpus.yml`, and `CI-06h`
-- pins it so deleting the step is a gate failure rather than a silent change.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A published version's size grid is immutable
-- -----------------------------------------------------------------------------
-- THE REFUSED SET IS DERIVED, NOT LISTED, which is `0028`'s instinct applied to
-- the status vocabulary instead of to the column list. `0028` pins every column
-- except three named movable ones so that a column added by a later migration is
-- pinned automatically. Here the permissive side is the one that is named:
-- `draft` is the only status under which this grid may be written, so a fourth
-- label added to `plan_version_status` by a later migration is REFUSED by
-- default and the migration that adds it has to say otherwise on purpose.
--
-- BOTH ENDS OF AN `UPDATE` ARE CHECKED. Moving a size row from a draft version
-- onto a published one is an `INSERT` into the published grid under another
-- name, and moving one off a published version is a `DELETE` from it. Reading
-- only `NEW` would admit the second; reading only `OLD` would admit the first.
--
-- A MISSING PARENT IS NOT THIS GUARD'S REFUSAL. `BEFORE ROW` fires before the
-- foreign key's own `AFTER` check, so a `plan_version_id` naming no row reaches
-- here first; the body falls through and lets
-- `plan_version_sizes_plan_version_id_fkey` refuse it BY NAME, rather than
-- reporting a real dangling reference as an immutability violation.
CREATE FUNCTION assert_published_plan_version_size_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status plan_version_status;
  parent_id     uuid;
BEGIN
  -- INSERT and UPDATE: the version this row is landing ON.
  IF TG_OP <> 'DELETE' THEN
    parent_id := NEW.plan_version_id;
    SELECT status INTO parent_status FROM plan_versions WHERE id = parent_id;
    IF FOUND AND parent_status <> 'draft' THEN
      RAISE EXCEPTION
        'plan_version % is % and its size grid is immutable. Attempted % of the '
        'size_cents % row. Every cents value the engine and a payout approval '
        'read is materialized here, and CV-01 to CV-19 are validated at PUBLISH '
        'over the whole grid, so a row written afterwards is a row nothing '
        'validated. Publish a new version instead.',
        parent_id, parent_status, TG_OP, NEW.size_cents
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- UPDATE and DELETE: the version this row is leaving.
  IF TG_OP <> 'INSERT' THEN
    parent_id := OLD.plan_version_id;
    SELECT status INTO parent_status FROM plan_versions WHERE id = parent_id;
    IF FOUND AND parent_status <> 'draft' THEN
      RAISE EXCEPTION
        'plan_version % is % and its size grid is immutable. Attempted % of the '
        'size_cents % row it already carries. Retirement stops new sales and '
        'never touches live accounts, and neither does anything else: the grid a '
        'version was published with is the grid every account sold under it is '
        'held to. Publish a new version instead.',
        parent_id, parent_status, TG_OP, OLD.size_cents
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plan_version_sizes_published_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON plan_version_sizes
  FOR EACH ROW EXECUTE FUNCTION assert_published_plan_version_size_immutable();

-- The record `0004` wrote for `plan_versions` and did not write here. The
-- design record has claimed this guarantee since the day the table landed --
-- docs/architecture/data-model/plan_version_sizes.md: "Immutable once the parent
-- version is published (same trigger)" -- and there was no such trigger. The
-- sentence becomes true with this file.
COMMENT ON TABLE plan_version_sizes IS
  'Materialized per-size thresholds, computed once at publish and never '
  'recomputed. Immutable once the parent version leaves draft (trigger in '
  '0066): no INSERT, no UPDATE, no DELETE. Retention: forever.';

COMMIT;
