-- =============================================================================
-- 0028_supersede_plan_version_immutability
-- =============================================================================
-- E2 READ: MONEY PATH. Supersedes two things in already-merged migrations.
-- Nothing here edits a merged file: 0027 and 0008/0011/0018/0019/0020/0022
-- stay exactly as they were written, and this file changes what they installed.
-- Migrations are sacred once merged (constitution E2), which is a rule about
-- editing them, not a rule against correcting them.
--
-- ADR-035, ACCEPTED 2026-08-15. FOUR items, all one class: a guard that was
-- reviewed and never executed. (This line said "Three" above a list of four
-- when it was drafted. Ninth.)
--
--   1. assert_published_plan_version_immutable() read NEW.config and OLD.config.
--      plan_versions has no `config` column; the rule contract is `rules`
--      (0004_catalog). PL/pgSQL resolves record fields AT EXECUTION rather than
--      at CREATE FUNCTION, so 0027 installed cleanly and the function was wrong
--      only when it fired. It fired on the ONE transition the design permits,
--      so NO PLAN VERSION COULD BE RETIRED. Delisting a plan was impossible at
--      the database level and the error named a column nobody would find.
--
--   2. The same guard pinned three columns (rules via the wrong name, version,
--      plan_id) out of twelve. Once item 1 was fixed, a retirement could still
--      have rewritten `copy_blocks` (the published rule TEXT) or `public_slug`
--      (the permanent public URL, SD-M9-01, INV-M9-11). The document's promise
--      is about the ROW; the guard was about three columns of it.
--
--   3. The guard fired only when OLD.status = 'published', so a RETIRED row was
--      completely unguarded: retire a version, rewrite its `rules`, and every
--      account pinned to that plan_version_id silently trades under new rules.
--      A two-step version of exactly the retroactive change B4 #12 exists to
--      make impossible. STATE_MACHINES section 9 already rules retirement
--      TERMINAL (`retired --> [*]`), so this enforces the approved design
--      rather than extending it. Raised in ADR-035's amendment because it was
--      not in the ADR as proposed, and it is a money-path widening: READ IT.
--
--   4. Seven CHECK constraints written `array_length(col, 1) >= n`. array_length
--      on an empty array returns NULL, NULL >= n is NULL, and A CHECK THAT
--      EVALUATES TO NULL PASSES. Each admits the single value it exists to
--      reject. Same defect as statistic_definitions_measures_nonempty, which
--      was caught during the fold and fixed in place before 0021 merged; these
--      seven were not, so they are corrected here. cardinality() returns 0 for
--      an empty array and the comparison is then a real one.
--
-- The count is SEVEN, not the six the manifest and the reconciliation brief
-- both said above a list of seven. Verify it, do not take it from this comment:
--     grep -n 'array_length' packages/db/migrations/*.sql
-- The three remaining hits are in 0027 and are the CORRECT idiom,
-- `IF array_length(...) IS NOT NULL`, which tests the NULL rather than being
-- caught by it.
--
-- HOW THIS DEFECT IS PREVENTED FROM RECURRING, which matters more than the fix:
-- CI-06j resolves every NEW./OLD. column reference in every PL/pgSQL trigger
-- body against the columns the migrations declare. It found item 1 from the
-- tree, with no database. It is LEDGER-C2's idea applied to columns.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1, 2, 3. Published plan_versions are immutable, and retirement is terminal
-- -----------------------------------------------------------------------------
-- THE PINNED SET IS DERIVED, NOT LISTED. Comparing to_jsonb(NEW) against
-- to_jsonb(OLD) minus the columns that are ALLOWED to move means a column added
-- to plan_versions by a future migration is pinned automatically. A hand-written
-- list of eleven columns is the same object as a hand-maintained count, and this
-- corpus has now found eight of those wrong.
--
-- The three columns permitted to move, and why each has to be:
--   status         published -> retired, which is the whole transition
--   retired_at     plan_versions_retired_has_timestamp (0004) REQUIRES it
--   public_visible plan_versions_visible_implies_published (0004) FORBIDS true
--                  on a non-published row, so retiring a version that is on sale
--                  is impossible unless this may move. Pinning it would have
--                  produced a second undelistable-plan bug against a different
--                  constraint, which is why it is called out rather than
--                  quietly permitted.
CREATE OR REPLACE FUNCTION assert_published_plan_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  moved text[];
BEGIN
  IF OLD.status = 'retired' THEN
    -- STATE_MACHINES section 9: `retired --> [*]`. Terminal.
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION
        'plan_version % is retired and retirement is terminal (STATE_MACHINES '
        'section 9). A retired version is still the contract some live account '
        'was sold under and it never changes again.',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    -- Everything except the three movable columns must be byte-identical.
    SELECT array_agg(key ORDER BY key) INTO moved
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key NOT IN ('status', 'retired_at', 'public_visible')
       AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

    IF moved IS NOT NULL THEN
      RAISE EXCEPTION
        'plan_version % is published and immutable. Publish a new version '
        'instead. Columns changed: %.',
        OLD.id, array_to_string(moved, ', ')
        USING ERRCODE = 'check_violation';
    END IF;

    -- The only permitted transition is published -> retired, with retired_at
    -- set. Note `rules` is the column name; 0027 read `config`, which does not
    -- exist, and that is ADR-035.
    IF NOT (NEW.status = 'retired' AND NEW.retired_at IS NOT NULL) THEN
      RAISE EXCEPTION
        'plan_version % is published. The only permitted transition is '
        'published -> retired with retired_at set (attempted status %, '
        'retired_at %). Retirement stops new sales and never touches live '
        'accounts.',
        OLD.id, NEW.status, NEW.retired_at
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged and is NOT recreated: CREATE OR REPLACE
-- FUNCTION rebinds it in place. Dropping and recreating the trigger would widen
-- the window in which plan_versions is unguarded to no purpose.

-- -----------------------------------------------------------------------------
-- 4. The seven NULL-passes CHECK constraints
-- -----------------------------------------------------------------------------
-- Each is dropped and re-added rather than altered, because PostgreSQL has no
-- ALTER CONSTRAINT for a CHECK expression. The names are preserved so every
-- document, runbook and error-handling path that cites one still resolves.
--
-- Re-adding a CHECK validates it against existing rows, which is the behaviour
-- wanted: if any row already holds an empty array this migration fails loudly
-- rather than installing a constraint that a row already violates.

-- 0008_risk: a correlation group of fewer than three is a pair detector.
ALTER TABLE correlation_groups DROP CONSTRAINT correlation_groups_is_a_group;
ALTER TABLE correlation_groups ADD CONSTRAINT correlation_groups_is_a_group CHECK (
  cardinality(member_account_ids) >= 3
);

-- 0011_wallet: reaching escheat_review without ever notifying the trader is the
-- failure this table exists to prevent, and the empty array was the one way to
-- do it.
ALTER TABLE wallet_dormancy DROP CONSTRAINT wallet_dormancy_review_was_noticed;
ALTER TABLE wallet_dormancy ADD CONSTRAINT wallet_dormancy_review_was_noticed CHECK (
  state <> 'escheat_review' OR cardinality(notified_at) >= 1
);

-- 0018_integrations: an enabled contract with an empty allowlist dispatches an
-- event with no fields, which is either a bug or a signal channel.
ALTER TABLE integration_contracts DROP CONSTRAINT integration_contracts_enabled_has_fields;
ALTER TABLE integration_contracts ADD CONSTRAINT integration_contracts_enabled_has_fields CHECK (
  enabled = false OR cardinality(field_allowlist) >= 1
);

-- 0019_notifications_and_community: a notification kind with no channel is a
-- notification nobody receives.
ALTER TABLE notification_kinds DROP CONSTRAINT notification_kinds_has_channels;
ALTER TABLE notification_kinds ADD CONSTRAINT notification_kinds_has_channels CHECK (
  cardinality(default_channels) >= 1
);

-- 0020_public_surface: a revalidation job with no paths revalidates nothing and
-- reports success.
ALTER TABLE page_revalidations DROP CONSTRAINT page_revalidations_has_paths;
ALTER TABLE page_revalidations ADD CONSTRAINT page_revalidations_has_paths CHECK (
  cardinality(paths) >= 1
);

-- 0022_analytics_journal: both halves of a round trip.
ALTER TABLE round_trips DROP CONSTRAINT round_trips_has_entry;
ALTER TABLE round_trips ADD CONSTRAINT round_trips_has_entry CHECK (
  cardinality(entry_fills) >= 1
);

ALTER TABLE round_trips DROP CONSTRAINT round_trips_closed_has_exit;
ALTER TABLE round_trips ADD CONSTRAINT round_trips_closed_has_exit CHECK (
  closed_at IS NULL OR cardinality(exit_fills) >= 1
);

COMMIT;
