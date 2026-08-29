-- =============================================================================
-- Probe: rule_states.phase carries a vocabulary, installed by 0067 (ADR-216).
-- =============================================================================
-- THE DEFECT WAS AN ABSENCE, WHICH IS THE KIND NO INVENTORY OF REJECTIONS FINDS.
-- `0015:47` typed this column `text` and wrote no CHECK, while `0001:45` had
-- already declared `account_phase` as exactly the engine's four `Phase` members.
-- For fifty-two migrations the table replay compares against admitted ANY STRING
-- as a phase, and nothing anywhere said otherwise.
--
-- IT LEADS WITH THE ACCEPTANCES AND THAT IS NOT A STYLE CHOICE. A probe that
-- only ever attempts forbidden things passes against a guard that rejects
-- EVERYTHING, and the failure mode of a vocabulary is exactly that: a fifth
-- member added to `Phase` that nobody adds to `account_phase` makes a legitimate
-- row unwritable, and every rejection below still passes. ACCEPTANCE 1 to 4 are
-- the four members, one row each, so the guard is measured on both sides.
--
-- ACCEPTANCE 5 IS THE ONE THAT LOOKS LIKE IT BELONGS IN ANOTHER FILE. `0048`'s
-- `rewrite_rule_state` takes a `rule_states` ROWTYPE parameter and builds its
-- UPDATE from `pg_attribute`. A column type change is invisible to it by
-- construction, which is a reason to believe it and not a reason to skip it:
-- `0027` installed a function that was WRONG and still installed cleanly, so the
-- append-only rewrite path is EXECUTED here rather than reasoned about.
--
-- REJECTION 3 IS THE CASE-VARIANT AND IT IS THE ONE A CHECK WOULD ALSO HAVE
-- CAUGHT. It is here because `'Funded'` is what an adapter that title-cases an
-- enum on the way out actually writes, and it is the realistic defect rather
-- than the invented one.
--
-- REJECTION 4 AND 5 ASSERT FROM THE CATALOGUE AND NOT THROUGH ROWS, because the
-- two ways this guard can be lost are both invisible to every row above.
-- REJECTION 4 fails if a later migration moves the column back to `text`, at
-- which point every acceptance still passes and every rejection stops firing.
-- REJECTION 5 fails if a later migration widens `account_phase` with
-- `ALTER TYPE ... ADD VALUE`, which cannot be undone -- the grammar has no
-- `DROP VALUE` production -- so the assertion is placed where the widening is
-- cheapest to reconsider.
--
-- REJECTION 6 IS THE COPY THIS RULING REFUSED TO MAKE. ADR-216's argument is
-- that the type IS the vocabulary and there is no second copy of it on this
-- column. A CHECK added later that re-lists the members would be a seventh
-- literal copy of four members that already have six and no comparator, and it
-- would be invisible to every other case here because it would agree with the
-- type on the day it was written.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one identity, one funded CORE-50K account.
-- ---------------------------------------------------------------------------
-- The account's own phase is `funded` and is IRRELEVANT to every case below:
-- nothing binds `rule_states.phase` to `accounts.phase` and ADR-216 does not
-- add such a binding, because a per-day snapshot legitimately disagrees with
-- the account's phase now. It is `funded` only so `accounts_funded_has_date`
-- (0007:130) is satisfied.
INSERT INTO identities (id, status) VALUES
  ('aa000000-0000-0000-0000-000000000216', 'active');
INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000216',
   'aa000000-0000-0000-0000-000000000216',
   'Probe216@Example.test', 'probe216@example.test');
INSERT INTO plans (id, code, name) VALUES
  ('11100000-0000-0000-0000-000000000216', 'core_eod', 'Core EOD');
INSERT INTO plan_versions (id, plan_id, version, status, rules, public_slug,
                           created_by) VALUES
  ('11200000-0000-0000-0000-000000000216',
   '11100000-0000-0000-0000-000000000216', 1, 'draft', '{}'::jsonb,
   'core-eod-v216', 'bb000000-0000-0000-0000-000000000216');
INSERT INTO purchases (id, identity_id, user_id, plan_version_id, size_cents,
                       kind, list_price_cents, amount_paid_cents, psp,
                       psp_reference, status, paid_at)
VALUES ('11300000-0000-0000-0000-000000000216',
        'aa000000-0000-0000-0000-000000000216',
        'bb000000-0000-0000-0000-000000000216',
        '11200000-0000-0000-0000-000000000216', 5000000, 'new', 9900, 9900,
        'psp_a', 'probe-216-psp-ref', 'paid', now());
INSERT INTO accounts (id, identity_id, user_id, purchase_id, plan_version_id,
                      size_cents, phase, status, opened_on, funded_on)
VALUES ('11400000-0000-0000-0000-000000000216',
        'aa000000-0000-0000-0000-000000000216',
        'bb000000-0000-0000-0000-000000000216',
        '11300000-0000-0000-0000-000000000216',
        '11200000-0000-0000-0000-000000000216',
        5000000, 'funded', 'active', DATE '2026-11-02', DATE '2026-11-02');

-- One writer for every case, so a difference between two cases is a difference
-- in `phase` and never in the twenty-five columns that are not under test.
--
-- IT BUILDS THE STATEMENT AND DOES NOT BIND THE VALUE, AND THAT IS THE WHOLE
-- POINT OF THE FILE. A `text` VARIABLE does not implicitly cast to an enum:
-- passing one straight into an `account_phase` column raises `column "phase" is
-- of type account_phase but expression is of type text` BEFORE the value is
-- looked at, so the probe would report the same failure for `eval` as for
-- `not_a_phase_at_all` and would be measuring PL/pgSQL's assignment rules
-- rather than the column's vocabulary. THIS WAS WATCHED HAPPENING: the first
-- draft of this file bound the variable, and against `0001`..`0067` it failed at
-- ACCEPTANCE 1 on a phase the column accepts perfectly well.
--
-- Casting the variable instead (`p_phase::account_phase`) would move every
-- rejection out of the INSERT and into the cast, which tests the TYPE and not
-- the COLUMN, and would pass against a column moved back to `text` only because
-- the cast is still there. So the phase goes in as a LITERAL through `%L`,
-- which is what an adapter and a hand-written INSERT both emit, and which the
-- column resolves by assignment: `text` takes any of them and `account_phase`
-- takes exactly four. The same file therefore runs unchanged on both sides of
-- `0067` and its verdict is the migration's, which is what a counterfactual
-- needs.
CREATE FUNCTION pg_temp.probe_state(d date, p_phase text)
RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v_id bigint;
BEGIN
  EXECUTE format($q$
    INSERT INTO rule_states (account_id, trading_day, phase, floor_cents,
                             floor_open_cents, floor_locked,
                             high_water_balance_cents, balance_cents,
                             withdrawable_cents, traded_days_count,
                             win_days_count, payouts_settled_count,
                             engine_eligible, engine_gates, context_gates,
                             state_hash, engine_version)
    VALUES ('11400000-0000-0000-0000-000000000216', %L, %L, 4800000, 4800000,
            false, 5000000, 5000000, 0, 1, 1, 0, false,
            '{}'::jsonb, '{}'::jsonb, sha256(%L::bytea), 'engine-1.0.0')
    RETURNING id
  $q$, d, p_phase, d::text || p_phase)
  INTO v_id;
  RETURN v_id;
END;
$f$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 1 to 4: every member of Phase is writable, one row each
-- ---------------------------------------------------------------------------
-- THE HALF THAT CATCHES THE OPPOSITE DEFECT. `Phase` is a closed union of four
-- and this column must admit all four; a vocabulary narrowed by a typo, or one
-- that fell behind a fifth member added to the engine, fails HERE and nowhere
-- else in this file. The days are distinct because `rule_states_account_day_uq`
-- is unique on (account_id, trading_day).
DO $$
DECLARE members text[] := ARRAY['eval', 'funded', 'closed', 'graduated'];
        m text;
        n int := 0;
BEGIN
  FOREACH m IN ARRAY members LOOP
    n := n + 1;
    BEGIN
      PERFORM pg_temp.probe_state(DATE '2026-11-02' + n, m);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'PROBE FAILED: ACCEPTANCE %: phase % is a member of the engine Phase '
        'union and rule_states will not store it (%). The vocabulary on this '
        'column has fallen behind types.ts:787, and every REJECTION in this '
        'file still passes.', n, m, SQLERRM;
    END;
    RAISE NOTICE 'ACCEPTANCE %: phase % is writable', n, m;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- ACCEPTANCE 5: 0048's append-only rewrite still works on the retyped column
-- ---------------------------------------------------------------------------
-- `rewrite_rule_state` is `SECURITY DEFINER`, takes `p_new rule_states` as a
-- ROWTYPE and derives its assignment list from `pg_attribute` through `%I`,
-- binding the row as `$1`. A column type change cannot reach it. THAT IS A
-- REASON TO EXECUTE IT AND NOT A REASON TO SKIP IT: 0027 installed a function
-- that was wrong and still installed cleanly, and this is the one path in the
-- estate that writes this column through a rowtype rather than a column list.
DO $$
DECLARE v_admin bigint;
        v_state bigint;
        v_row   rule_states;
        v_after account_phase;
BEGIN
  INSERT INTO admin_actions (actor, action, subject_kind, subject_id, reason,
                             before, after, initiative)
    VALUES ('founder', 'replay.rewrite_approved', 'account',
            '11400000-0000-0000-0000-000000000216',
            'B.4 step 3: the dry-run diff report was read and approved',
            '{}'::jsonb, '{}'::jsonb, 'operational')
    RETURNING id INTO v_admin;

  v_state := pg_temp.probe_state(DATE '2026-11-20', 'eval');
  SELECT * INTO v_row FROM rule_states WHERE id = v_state;
  v_row.phase := 'funded';
  v_row.engine_version := 'engine-1.0.1';

  PERFORM rewrite_rule_state(v_state, v_admin, v_row);

  SELECT phase INTO v_after FROM rule_states WHERE id = v_state;
  IF v_after <> 'funded' THEN
    RAISE EXCEPTION
      'PROBE FAILED: ACCEPTANCE 5: the approved rewrite left phase at % rather '
      'than funded, so 0048''s catalogue-derived assignment list is no longer '
      'reaching this column', v_after;
  END IF;
  RAISE NOTICE 'ACCEPTANCE 5: 0048''s rewrite_rule_state still writes phase through a rowtype';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: a phase the engine cannot produce
-- ---------------------------------------------------------------------------
-- THE COUNTERFACTUAL. This exact row COMMITS against `0001`..`0066` and is
-- refused from `0067`, and both transcripts are in DELTA_MANIFEST section 32.
-- The SQLSTATE is `invalid_text_representation` (22P02) rather than
-- `check_violation`: an enum refuses at the CAST, before the row is a row.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-12-01', 'not_a_phase_at_all');
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 1: rule_states stored phase not_a_phase_at_all. '
    'The engine''s own per-day record admits a string the engine cannot '
    'produce, on the table replay compares against.';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE NOTICE 'REJECTION 1: a phase outside the vocabulary is refused at the cast';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: the empty string
-- ---------------------------------------------------------------------------
-- What a mapping that reaches for a missing field writes. `phase` is NOT NULL,
-- so NULL was never the shape of that defect; empty is.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-12-02', '');
  RAISE EXCEPTION 'PROBE FAILED: REJECTION 2: rule_states stored an empty phase';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE NOTICE 'REJECTION 2: the empty string is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: the case variant, which is the realistic defect
-- ---------------------------------------------------------------------------
-- `'Funded'` is what an adapter that title-cases on the way out writes, and it
-- reads as correct in every log line it ever appears in. A hash computed over
-- it differs from the hash computed over `'funded'`, so this row would make
-- replay diverge on an account whose state was never wrong.
DO $$
BEGIN
  PERFORM pg_temp.probe_state(DATE '2026-12-03', 'Funded');
  RAISE EXCEPTION
    'PROBE FAILED: REJECTION 3: rule_states stored phase Funded. The '
    'vocabulary is case-insensitive, and a hash over Funded is not the hash '
    'over funded.';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE NOTICE 'REJECTION 3: the case variant is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: the column is still account_phase, asserted from the catalogue
-- ---------------------------------------------------------------------------
-- EVERY CASE ABOVE PASSES AGAINST A COLUMN MOVED BACK TO `text` EXCEPT THE
-- THREE REJECTIONS, and a later migration that moved it back would be doing so
-- for a reason that looked good at the time. This is the assertion that names
-- what was lost rather than merely failing.
DO $$
DECLARE t text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO t
    FROM pg_attribute a
   WHERE a.attrelid = 'rule_states'::regclass AND a.attname = 'phase';
  IF t IS DISTINCT FROM 'account_phase' THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 4: rule_states.phase is % and not account_phase. '
      'ADR-216 rules that the TYPE is this column''s vocabulary; a column of '
      'any other type carries none unless something else supplies one.', t;
  END IF;
  RAISE NOTICE 'REJECTION 4: rule_states.phase is still account_phase';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: account_phase is still exactly the four, in order
-- ---------------------------------------------------------------------------
-- THE WIDENING IS THE MOVE THAT CANNOT BE UNDONE. `ALTER TYPE ... ADD VALUE`
-- exists and `ALTER TYPE ... DROP VALUE` is a SYNTAX ERROR on PostgreSQL 16, so
-- a fifth label added here is permanent short of recreating the type and
-- rewriting both columns that use it. The assertion is ORDERED because
-- `account_phase` is also the sort order of `accounts.phase`, and a member
-- inserted with `BEFORE`/`AFTER` changes that silently.
--
-- `packages/db/test/rule-state-phase-vocabulary.test.ts` compares this same
-- vocabulary against `types.ts:787` where no database exists. This case is the
-- catalogue's own answer, which is a different source and not a second copy.
DO $$
DECLARE labels text[];
BEGIN
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO labels
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'account_phase';
  IF labels IS DISTINCT FROM ARRAY['eval', 'funded', 'closed', 'graduated'] THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 5: account_phase is % and not the engine Phase '
      'union in declaration order. A label ADDED here can never be removed, '
      'and a label reordered moves accounts.phase''s sort order too.', labels;
  END IF;
  RAISE NOTICE 'REJECTION 5: account_phase is exactly the four Phase members, in order';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6: no CHECK re-lists the vocabulary this column already carries
-- ---------------------------------------------------------------------------
-- THE COPY ADR-216 REFUSED TO MAKE. Its ruling is that the type IS the
-- vocabulary: `ALTER COLUMN ... TYPE account_phase` writes the type's NAME, so
-- this column's members are stated once and not twice. A CHECK added later that
-- re-listed them would agree with the type on the day it was written and would
-- be free to drift from it every day after, and NOTHING ELSE IN THIS FILE WOULD
-- NOTICE. `Phase`'s four members already have six literal copies in this
-- repository and no comparator between any two.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'rule_states'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ '\mphase\M'
   LIMIT 1;
  IF def IS NOT NULL THEN
    RAISE EXCEPTION
      'PROBE FAILED: REJECTION 6: a CHECK on rule_states now mentions phase: '
      '%. ADR-216 rules the type is the vocabulary and refuses a second copy '
      'of it on this column. If this constraint is deliberate it needs an ADR '
      'and this case needs to move with it.', def;
  END IF;
  RAISE NOTICE 'REJECTION 6: the vocabulary is stated once, by the type, and not re-listed in a CHECK';
END $$;
