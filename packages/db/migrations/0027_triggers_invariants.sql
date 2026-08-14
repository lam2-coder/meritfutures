-- =============================================================================
-- 0027_triggers_invariants
-- =============================================================================
-- E2 READ: MONEY PATH. The last file, and the one that makes the earlier ones
-- safe. Every constraint here fails at INSERT, not in a job that runs later
-- against data that already exists.
--
-- Carries: the deferred zero-sum trigger, LEDGER-C1, LEDGER-C2, STAT-C1,
--          published-plan_version immutability, accounts.plan_version_id
--          immutability, one-live-mark, and DATA_MODEL section 13's set.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- INV-M5-04: every ledger transaction sums to exactly zero
-- -----------------------------------------------------------------------------
-- DEFERRED to commit, because entries are inserted one at a time and a
-- transaction is only balanced once all its legs exist. An unbalanced
-- transaction cannot be written in the first place, which is what makes a
-- GLOBAL sum mismatch imply data corruption or a direct write, and therefore
-- what makes ADR-016's global halt proportionate.
CREATE FUNCTION assert_ledger_transaction_balances() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  net bigint;
BEGIN
  SELECT COALESCE(sum(amount_cents), 0) INTO net
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;

  IF net <> 0 THEN
    RAISE EXCEPTION
      'ledger transaction % does not balance: net % cents (must be 0)',
      NEW.transaction_id, net
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_zero_sum
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_balances();

-- -----------------------------------------------------------------------------
-- LEDGER-C1: no transaction may debit and credit the SAME ledger account
-- -----------------------------------------------------------------------------
-- ADR-027. This is the exact signature of the C-01 collapse, mechanized.
--
-- Why a flat prohibition rather than a threshold: a transaction that posts
-- opposite signs against one position is either a no-op wearing a transfer's
-- clothes, or a silent net movement in one party's favour. It has NO
-- legitimate use in this chart of accounts.
--
-- The collapse this catches passed the zero-sum trigger above. Debits equalled
-- credits (100,000 against 90,000 + 10,000) while the trader's position was
-- net debited by firm_cents on every approval. The ledger reconciled perfectly
-- and the balance was wrong. Zero-sum cannot see it; this can.
--
-- Three direction-or-class errors landed on LT-01 in a single day, and a
-- fourth landed inside the ADR describing them. That line is too easy to get
-- wrong for prose review to be the control.
CREATE FUNCTION assert_no_opposite_signs_same_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  offending uuid;
BEGIN
  SELECT ledger_account_id INTO offending
    FROM ledger_entries
   WHERE transaction_id = NEW.transaction_id
   GROUP BY ledger_account_id
  HAVING count(*) FILTER (WHERE amount_cents > 0) > 0
     AND count(*) FILTER (WHERE amount_cents < 0) > 0
   LIMIT 1;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'LEDGER-C1: transaction % posts opposite signs against ledger_account %. '
      'A transaction that debits and credits one position is either a no-op or '
      'a silent net movement. See ADR-027.',
      NEW.transaction_id, offending
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_no_opposite_signs
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_no_opposite_signs_same_account();

-- -----------------------------------------------------------------------------
-- LEDGER-C2: every entry resolves to a declared class
-- -----------------------------------------------------------------------------
-- ADR-027. The firm_payable catch, mechanized. The CHECK on
-- ledger_accounts.code (migration 0009) is the primary guard; this trigger is
-- the second line, because a FK to a table whose own CHECK could be dropped in
-- a later migration is a guarantee with a dependency.
--
-- A class that appears first in a migration is a class nobody defined. The
-- first draft of ADR-027 invented `firm_payable` and it reached a committed
-- document before being caught by reading GLOSSARY's class list.
CREATE FUNCTION assert_ledger_account_class_declared() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acct_code text;
BEGIN
  SELECT code INTO acct_code
    FROM ledger_accounts WHERE id = NEW.ledger_account_id;

  IF acct_code IS NULL THEN
    RAISE EXCEPTION 'LEDGER-C2: ledger_account % does not exist',
      NEW.ledger_account_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF acct_code NOT IN (
      'firm_treasury','psp_clearing','fees_revenue','reserve',
      'trader_withdrawable','trader_wallet','promotional_credit') THEN
    RAISE EXCEPTION
      'LEDGER-C2: ledger_account % has undeclared class %. The seven v1 codes '
      'are the whole permitted vocabulary. See ADR-027.',
      NEW.ledger_account_id, acct_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_class_declared
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_account_class_declared();

-- -----------------------------------------------------------------------------
-- STAT-C1: a publish run emits every measure its definition declares
-- -----------------------------------------------------------------------------
-- ADR-032. THE SECOND HALF OF OI-02, and the half that is not a column.
--
-- Adding `measure` to published_statistics made ST-04's median WRITABLE. It
-- did nothing to make it REQUIRED. A run that emits the mean and never emits
-- the median satisfies every constraint on that table and publishes exactly
-- what M12 forbids: "neither is published alone" for ST-04, and ST-05 and
-- ST-06 "published as a pair on the same surface".
--
-- THIS CONVERTS THAT SENTENCE FROM PROSE INTO DDL, and prose is the wrong
-- place for it on this surface. published_statistics is append-only and
-- publicly restated: a missing median is not a bug you fix, it is a number
-- Merit published and must now restate in public.
--
-- DEFERRED, and for the same reason the ledger zero-sum trigger above is
-- deferred: the rows arrive one at a time and the set is only complete once
-- the run's transaction has written all of them. Checking at statement time
-- would fail on the first row of every correct run.
--
-- SCOPE: rows with restatement_of IS NULL, the original publish run. A
-- restatement of ONE measure is legitimate and is NOT publishing it alone,
-- because its pair is already published and still standing; requiring the full
-- set on a correction would mean Merit could not fix a mean without restating
-- a median that was right.
CREATE FUNCTION assert_publish_run_measures_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  declared statistic_measure[];
  emitted  statistic_measure[];
  missing  statistic_measure[];
BEGIN
  -- A restatement corrects one figure. See SCOPE above.
  IF NEW.restatement_of IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT d.measures INTO declared
    FROM statistic_definitions d
   WHERE d.stat_code = NEW.stat_code
     AND d.version   = NEW.definition_version;

  IF declared IS NULL THEN
    RAISE EXCEPTION
      'STAT-C1: no statistic_definitions row for stat_code % version %. A '
      'published figure whose definition does not exist is unverifiable by '
      'the reader, which is the thing M12 exists to prevent.',
      NEW.stat_code, NEW.definition_version
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT (NEW.measure = ANY (declared)) THEN
    RAISE EXCEPTION
      'STAT-C1: stat_code % version % published measure % which its definition '
      'does not declare (declares %). See ADR-032.',
      NEW.stat_code, NEW.definition_version, NEW.measure, declared
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every measure emitted for this exact publication cell. The cell is the
  -- window_uq key minus the measure: same statistic, same definition version,
  -- same window, same grain.
  SELECT coalesce(array_agg(p.measure ORDER BY p.measure),
                  ARRAY[]::statistic_measure[])
    INTO emitted
    FROM published_statistics p
   WHERE p.stat_code          = NEW.stat_code
     AND p.definition_version = NEW.definition_version
     AND p.window_start_day   = NEW.window_start_day
     AND p.window_end_day     = NEW.window_end_day
     AND p.grain_key IS NOT DISTINCT FROM NEW.grain_key
     AND p.restatement_of IS NULL;

  SELECT coalesce(array_agg(m ORDER BY m), ARRAY[]::statistic_measure[])
    INTO missing
    FROM unnest(declared) m
   WHERE NOT (m = ANY (emitted));

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'STAT-C1: publish run for stat_code % version % window % to % grain % '
      'emitted % but its definition declares %. Missing: %. Neither figure of '
      'a pair is published alone (M12, ADR-032).',
      NEW.stat_code, NEW.definition_version,
      NEW.window_start_day, NEW.window_end_day,
      coalesce(NEW.grain_key, '(global)'),
      emitted, declared, missing
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER published_statistics_measures_complete
  AFTER INSERT ON published_statistics
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_publish_run_measures_complete();

-- -----------------------------------------------------------------------------
-- Published plan_versions are immutable (B4 #12)
-- -----------------------------------------------------------------------------
-- The single most valuable promise Merit can make, in a market whose live case
-- study is a firm destroyed by a retroactive rule change. Publishing a change
-- means creating a new version.
CREATE FUNCTION assert_published_plan_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    -- The only permitted transition is published -> retired, setting retired_at.
    IF NOT (NEW.status = 'retired'
            AND NEW.config IS NOT DISTINCT FROM OLD.config
            AND NEW.version IS NOT DISTINCT FROM OLD.version
            AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id) THEN
      RAISE EXCEPTION
        'plan_version % is published and immutable. Publish a new version '
        'instead. Retirement stops new sales and never touches live accounts.',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plan_versions_published_immutable
  BEFORE UPDATE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION assert_published_plan_version_immutable();

-- -----------------------------------------------------------------------------
-- An account's pinned plan_version never moves
-- -----------------------------------------------------------------------------
-- ToS clause 12. The retroactive-change protection is a promise, not an
-- implementation detail, so it is enforced where it cannot be forgotten.
CREATE FUNCTION assert_account_plan_version_pinned() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id THEN
    RAISE EXCEPTION
      'account % has plan_version pinned at purchase and it may never change '
      '(B4 #12, GS-041). Attempted % -> %.',
      OLD.id, OLD.plan_version_id, NEW.plan_version_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_plan_version_pinned
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION assert_account_plan_version_pinned();

-- -----------------------------------------------------------------------------
-- NO-FLOATS EXEMPTION LIST
-- -----------------------------------------------------------------------------
-- Constitution and DATA_MODEL section 1: money is bigint integer cents, ratios
-- are integer basis points, NEVER numeric and NEVER float, in any financial
-- path. Two columns in this schema are non-integer and both are a RULED
-- EXEMPTION rather than a local judgment.
--
-- NO MONEY-BEARING COLUMN IS ON THIS LIST, and after ADR-031 none ever was.
-- That is the property the list exists to hold, and it is worth more than the
-- count: what remains is two correlation coefficients on a risk-detection
-- table, and what left was a column holding published cents.
--
-- THE LIST IS ASSERTED, NOT DOCUMENTED. The DO block below fails the migration
-- if the set of non-integer numeric-family columns in `public` is anything
-- other than exactly these two. A third one cannot be added by a later
-- migration without adding a line to this file, which is a diff a reviewer
-- sees rather than a discovery CI makes later.
--
-- | Column                              | Type    | Why it is exempt          |
-- |-------------------------------------|---------|---------------------------|
-- | correlation_groups.statistic        | numeric | A correlation coefficient |
-- | correlation_groups.threshold        | numeric | is not money and is not a |
-- |                                     |         | ratio of integers.        |
-- |                                     |         | Rounding it to cents or   |
-- |                                     |         | to bp is the actual error |
--
-- WHAT LEFT THE LIST, AND WHY THE LIST IS NOW SHORTER BY A MONEY COLUMN.
--
-- published_statistics.value_numeric was AUTHORIZED and is retired by ADR-031.
-- It is now `value bigint` with a `value_unit`. All seven ruled statistics are
-- exactly representable as integers under the corpus's own conventions
-- (ST-01/02/07 rates in basis points, ST-03/04 money in integer cents,
-- ST-05/06 durations in whole seconds), and for ST-03 and ST-04 the column
-- held MONEY ON A PUBLIC SURFACE, which is the case DATA_MODEL section 1 names
-- directly. An authorized exemption covering a money column is not an
-- exemption; it is a hole with a ruling attached.
--
-- published_statistics.numerator and .denominator shipped as numeric and were
-- NEVER authorized. Both are bigint. The numerator is a count, integer cents,
-- or a whole-second duration across the seven definitions, carried with a
-- numerator_unit discriminator; the denominator is a count everywhere it
-- exists and is compared against an integer min_sample.
--
-- The two correlation columns are LEFT EXEMPT on the founder's ruling at this
-- gate. Rho is not money, it is not a ratio of two integers Merit controls,
-- and the threshold must be the same type as the statistic it is compared
-- against. Reversing that is a risk-path change and would need its own ADR.
--
-- AND THE ROUNDING IS NOT HARMLESS HERE, which is the difference from the
-- column that just left. A plain integer rho of 0.30 IS ZERO, and rho = 0.30
-- is the RESERVE-CRITICAL figure: the risk engine shows mean monthly payouts
-- flat near $45.3K across every correlation level while CVaR99 nearly doubles
-- from $84.8K at rho = 0.05 to $132.9K at rho = 0.30 (0008). An integer cast
-- would erase the whole range the tail lives in.
DO $$
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

  -- The list is asserted in BOTH directions. A stale entry for a column that
  -- no longer exists is how an allowlist quietly grants more than it names.
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'NO-FLOATS: the exemption list names % which does not exist. Remove the '
      'stale entry rather than leaving the list wider than the schema.',
      array_to_string(missing, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

COMMIT;
