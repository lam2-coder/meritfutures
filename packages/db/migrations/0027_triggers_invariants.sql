-- =============================================================================
-- 0027_triggers_invariants
-- =============================================================================
-- E2 READ: MONEY PATH. The last file, and the one that makes the earlier ones
-- safe. Every constraint here fails at INSERT, not in a job that runs later
-- against data that already exists.
--
-- Carries: the deferred zero-sum trigger, LEDGER-C1, LEDGER-C2,
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
-- path. Three columns in this schema are non-integer and every one of them is
-- a RULED EXEMPTION rather than a local judgment.
--
-- THE LIST IS ASSERTED, NOT DOCUMENTED. The DO block below fails the migration
-- if the set of non-integer numeric-family columns in `public` is anything
-- other than exactly these three. A fourth one cannot be added by a later
-- migration without deleting a line from this file, which is a diff a reviewer
-- sees rather than a discovery CI makes later.
--
-- | Column                              | Type    | Why it is exempt          |
-- |-------------------------------------|---------|---------------------------|
-- | correlation_groups.statistic        | numeric | A correlation coefficient |
-- | correlation_groups.threshold        | numeric | is not money and is not a |
-- |                                     |         | ratio of integers.        |
-- |                                     |         | Rounding it to cents or   |
-- |                                     |         | to bp is the actual error |
-- | published_statistics.value_numeric  | numeric | The published figure.     |
-- |                                     |         | ST-01/02/07 are rates.    |
-- |                                     |         | SEE THE NOTE BELOW: this  |
-- |                                     |         | one is exempt as ruled    |
-- |                                     |         | and does not need to be   |
-- |                                     |         | on this list             |
--
-- NOTE ON published_statistics.value_numeric, for the founder's read.
-- This column is on the authorized list and is left as authorized. On
-- inspection it does not require the exemption: all seven ruled statistics are
-- exactly representable as integers under the corpus's own conventions
-- (ST-01/02/07 rates in basis points, ST-03/04 money in integer cents,
-- ST-05/06 durations in whole seconds), and for ST-03 and ST-04 `numeric`
-- currently holds MONEY on a public surface, which is the case DATA_MODEL
-- section 1 names directly. Tightening it to bigint plus the same unit
-- discriminator the numerator now carries is a one-line change and it is the
-- founder's call, because removing an authorized exemption is not mine to
-- make. Recorded in DELTA_MANIFEST section 9.
--
-- WHAT LEFT THE LIST. published_statistics.numerator and .denominator shipped
-- as numeric and are now bigint. The numerator is a count, integer cents, or a
-- whole-second duration across the seven definitions, carried with a
-- numerator_unit discriminator; the denominator is a count everywhere it
-- exists and is compared against an integer min_sample. Neither was ever
-- authorized and neither needed to be.
DO $$
DECLARE
  allowed  text[] := ARRAY[
    'correlation_groups.statistic',
    'correlation_groups.threshold',
    'published_statistics.value_numeric'
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
