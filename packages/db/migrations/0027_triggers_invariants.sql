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

COMMIT;
