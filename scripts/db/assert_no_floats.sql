-- =============================================================================
-- NO-FLOATS, asserted against the WHOLE applied schema. OI-08.
-- =============================================================================
-- Constitution and DATA_MODEL section 1: money is bigint integer cents, ratios
-- are integer basis points, NEVER numeric and NEVER float, in any financial
-- path. Exactly two columns in this schema are non-integer and both are a RULED
-- EXEMPTION rather than a local judgment.
--
-- WHY THIS FILE EXISTS RATHER THAN ONLY THE DO BLOCK IN 0027.
--
-- The assertion was written inside `0027_triggers_invariants.sql`, so it reads
-- `information_schema.columns` AS OF 0027. That was correct on the day it was
-- written and stopped being correct the moment 0028 landed. By 0032 there were
-- FIVE MIGRATIONS OUTSIDE THE GUARD THE CORPUS BELIEVED PROTECTED EVERY MONEY
-- COLUMN, and a later migration adding a `numeric` money column would have
-- sailed straight past it. Nothing failed; the guard simply was not looking.
-- That is OI-08, and it is the positional-assertion class in general: an
-- assertion that lives inside an ordered set can only see the prefix of the set
-- that precedes it.
--
-- Here it is positionally last BY CONSTRUCTION rather than by whoever remembers
-- to renumber it. The install job applies every migration and then runs this,
-- so the set it reads is the whole schema no matter how many files arrive
-- later. A migration numbered 0099 is inside this guard on the day it is
-- written, with nobody having to move anything.
--
-- 0027'S DO BLOCK IS DELIBERATELY LEFT IN PLACE, NOT DELETED. Migrations are
-- sacred: once merged, never edited, only superseded (constitution E2). 0027 is
-- merged. Its block still passes and still costs nothing; what it cannot do is
-- be the guard, so THIS file is the guard and 0027's copy is a historical
-- assertion about the schema as it stood at 0027. DELTA_MANIFEST's OI-08 row
-- asked for exactly this word: re-assert, not relocate.
--
-- THE LIST FAILS IN BOTH DIRECTIONS, and the second direction is the one that
-- decays quietly. An unlisted non-integer column is the obvious failure. A
-- STALE ENTRY for a column that no longer exists is how an allowlist silently
-- grants more than it names: the entry stays, the column is renamed, and the
-- new spelling is now unguarded while the list still looks complete.
--
-- | Column                              | Type    | Why it is exempt          |
-- |-------------------------------------|---------|---------------------------|
-- | correlation_groups.statistic        | numeric | A correlation coefficient |
-- | correlation_groups.threshold        | numeric | is not money and is not a |
-- |                                     |         | ratio of integers.        |
-- |                                     |         | Rounding it to cents or   |
-- |                                     |         | to bp is the actual error |
--
-- Rho is not money, it is not a ratio of two integers Merit controls, and the
-- threshold must be the same type as the statistic it is compared against. A
-- plain integer rho of 0.30 IS ZERO, and rho = 0.30 is the RESERVE-CRITICAL
-- figure: mean monthly payouts sit flat near $45.3K across every correlation
-- level while CVaR99 nearly doubles from $84.8K at rho = 0.05 to $132.9K at
-- rho = 0.30 (0008). An integer cast would erase the whole range the tail lives
-- in. Reversing that is a risk-path change and needs its own ADR.
--
-- AND THIS FILE WATCHES ITSELF FAIL. STRATEGY section 4.4: a gate nobody has
-- watched fail is not a gate, and an assertion that has only ever been run
-- against a schema that satisfies it reports PASS in exactly the same way as an
-- assertion that has been narrowed until it reads nothing. The two seeded
-- violations below are the falsification, one per direction, each rolled back
-- by the handler that catches it.
-- =============================================================================

\set ON_ERROR_STOP on

-- ONE DEFINITION, exercised three ways. The falsification below calls the same
-- function the gate calls, so a narrowing edit cannot pass the gate while the
-- falsification keeps testing the old logic. Two copies of this block would be
-- the OI-08 shape again in a different costume.
CREATE OR REPLACE FUNCTION pg_temp.assert_no_floats() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  allowed  text[] := ARRAY[
    'correlation_groups.statistic',
    'correlation_groups.threshold'
  ];
  found    text[];
  unlisted text[];
  missing  text[];
BEGIN
  SELECT coalesce(array_agg(table_name || '.' || column_name ORDER BY
                            table_name, column_name), ARRAY[]::text[])
    INTO found
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND data_type IN ('numeric', 'real', 'double precision');

  SELECT coalesce(array_agg(c), ARRAY[]::text[]) INTO unlisted
    FROM unnest(found) c WHERE c <> ALL (allowed);

  SELECT coalesce(array_agg(c), ARRAY[]::text[]) INTO missing
    FROM unnest(allowed) c WHERE c <> ALL (found);

  IF array_length(unlisted, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'NO-FLOATS: % is not on the exemption list. Money is bigint integer '
      'cents and ratios are integer basis points (DATA_MODEL section 1). '
      'Adding a non-integer column requires a founder ruling and a line in '
      'this list, not a local judgment in a migration.',
      array_to_string(unlisted, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'NO-FLOATS: the exemption list names % which does not exist. Remove the '
      'stale entry rather than leaving the list wider than the schema.',
      array_to_string(missing, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------------
-- THE ASSERTION. Every migration has applied; this reads the whole schema.
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM pg_temp.assert_no_floats(); END $$;
\echo 'NO-FLOATS: the non-integer set is exactly the two ruled exemptions.'

-- ---------------------------------------------------------------------------
-- FALSIFICATION 1: an unlisted non-integer column trips it
-- ---------------------------------------------------------------------------
-- Seeded on payout_requests deliberately. This guard exists so that a `numeric`
-- money column can never land on the payout path, and that is the table where
-- it would hurt most. The handler catching the exception rolls the seeded
-- column back to the block's savepoint, so the schema is unchanged either way.
DO $$
DECLARE
  fired boolean := false;
  msg   text    := '';
BEGIN
  BEGIN
    ALTER TABLE payout_requests ADD COLUMN probe_float_rate numeric;
    PERFORM pg_temp.assert_no_floats();
  EXCEPTION WHEN check_violation THEN
    fired := true;
    msg   := SQLERRM;
  END;

  IF NOT fired THEN
    RAISE EXCEPTION
      'GATE FAILED: a numeric column added to payout_requests did NOT trip '
      'NO-FLOATS. The assertion is not reading the applied schema.';
  END IF;

  -- Checked BY MESSAGE, never by exception class. A wrong-reason failure that
  -- happens to raise check_violation is scored as the gate working by any
  -- handler that only asks whether something threw.
  IF position('is not on the exemption list' in msg) = 0 THEN
    RAISE EXCEPTION
      'GATE FAILED: NO-FLOATS fired, but for the wrong reason: %', msg;
  END IF;

  RAISE NOTICE 'FALSIFIED (unlisted): %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- FALSIFICATION 2: a stale entry trips it, which is the direction that decays
-- ---------------------------------------------------------------------------
-- Dropping an exempt column must be as loud as adding an unlisted one. Without
-- this direction the list may name columns that no longer exist, which reads as
-- a complete allowlist while guarding a schema that has moved out from under
-- it.
DO $$
DECLARE
  fired boolean := false;
  msg   text    := '';
BEGIN
  BEGIN
    ALTER TABLE correlation_groups DROP COLUMN threshold;
    PERFORM pg_temp.assert_no_floats();
  EXCEPTION WHEN check_violation THEN
    fired := true;
    msg   := SQLERRM;
  END;

  IF NOT fired THEN
    RAISE EXCEPTION
      'GATE FAILED: dropping correlation_groups.threshold did NOT trip '
      'NO-FLOATS. The exemption list is not asserted in both directions and a '
      'stale entry can widen it silently.';
  END IF;

  IF position('which does not exist' in msg) = 0 THEN
    RAISE EXCEPTION
      'GATE FAILED: NO-FLOATS fired, but for the wrong reason: %', msg;
  END IF;

  RAISE NOTICE 'FALSIFIED (stale entry): %', msg;
END $$;

-- The seeded columns were rolled back with their handlers. Prove it, rather
-- than trusting that plpgsql subtransactions behave as documented: if either
-- seed leaked, every step after this one is running against a schema this file
-- modified.
DO $$ BEGIN PERFORM pg_temp.assert_no_floats(); END $$;

\echo 'assert_no_floats: the guard holds on the applied schema and fires in both directions.'
