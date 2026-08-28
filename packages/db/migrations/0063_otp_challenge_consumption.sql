-- =============================================================================
-- 0063_otp_challenge_consumption
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-200, status: proposed, founder approval PENDING.
--
-- TWO MERGED SENTENCES CLAIM A CONTROL THIS SCHEMA DOES NOT CARRY, AND THIS FILE
-- IS THAT CONTROL.
--
--   `0002_identity.sql:328-330` writes "Single use, enforced by the database
--   rather than by the handler" and creates
--   `otp_challenges_unconsumed_uq ON otp_challenges (id) WHERE consumed_at IS NULL`.
--
--   `id` IS ALREADY THE PRIMARY KEY. A UNIQUE index over the primary key is
--   unique whatever the predicate says, so that object bounds nothing at all: it
--   is a partial index and never a constraint. The sentence above it describes a
--   guarantee no object in the 58 merged files delivers.
--
-- SECURITY section 2's row S states the same control from the other end -- an
-- SMS code intercepted off a handset is answered by "short TTL, single use,
-- 5-attempt lock" -- so single use is a stated defence in a frozen document and
-- in a merged comment, and it rests today on a handler that did not exist until
-- ADR-200.
--
-- SECURITY item 10 is the lesson this file is written against, in its own words:
-- "a control that exists as columns and not as a constraint reads as done in
-- every review and stops nothing at runtime".
--
-- -----------------------------------------------------------------------------
-- WHY A HANDLER CANNOT CARRY IT, MEASURED RATHER THAN ASSUMED
-- -----------------------------------------------------------------------------
-- The handler's consume is "read the challenge, check `consumed_at IS NULL`,
-- write `consumed_at`". Executed against this schema on PostgreSQL 16, two
-- transactions one round trip apart:
--
--   T1 BEGIN; SELECT ... WHERE consumed_at IS NULL  -> one row
--   T2 BEGIN; SELECT ... WHERE consumed_at IS NULL  -> THE SAME ROW
--   T1 UPDATE SET consumed_at = now(); COMMIT       -> accepted
--   T2 UPDATE SET consumed_at = now(); COMMIT       -> ACCEPTED
--
-- Both consume it, so ONE code mints TWO sessions. The read-then-write is the
-- only shape the accessor admits: `ADR-112` clause 1 rules that an address is
-- equality only, `ADR-157` admits `isNull()` on the READ path and refuses it in
-- a write address, and `FirmTx` carries no `FOR UPDATE` read where `ScopedTx`
-- carries `rowAtForUpdate`. So `UPDATE ... WHERE id = $1 AND consumed_at IS NULL`
-- is not expressible from a handler in this tree.
--
-- WITH THIS TRIGGER INSTALLED, THE SAME RACE, SAME SCRIPTS, SAME SCHEMA: T1
-- commits and T2 is REFUSED at its UPDATE, because T2 blocks on T1's row lock
-- and re-evaluates against the row T1 left behind.
--
-- -----------------------------------------------------------------------------
-- WHY THIS AND NOT `ADR-196` SECTION 8's REFUSED SHAPE
-- -----------------------------------------------------------------------------
-- That entry wrote a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on
-- `identities`, measured that it worked, and refused it on three grounds.
-- Every one of them is tested here rather than assumed to differ:
--
--   (i)   IT BREAKS A MERGED PROBE. That candidate went 15 of 15 without it and
--         14 with it, the casualty being `0054`'s own acceptance script. This one
--         was run the same way, against a schema installed from `0001` forward
--         with the file present and again with it absent: 15 of 15 BOTH WAYS.
--   (ii)  IT HAS NO CALLER. That was true of `identities` when nothing wrote the
--         table. `verifyOtp` in `apps/api/src/auth-backend.ts` is this object's
--         caller and it consumes a challenge on every verification that matches.
--   (iii) IT IS NARROWER THAN ITS NAME. That candidate was an `AFTER INSERT`
--         trigger blind to the `UPDATE` an `identity_merges` repoint performs.
--         This one is `BEFORE UPDATE` on the only column whose transition it
--         names, so there is no second statement it does not see. An INSERT
--         carrying `consumed_at` is a challenge born consumed, which answers no
--         code and is left to the handler rather than refused here.
--
-- -----------------------------------------------------------------------------
-- WHAT IT REFUSES AND WHAT IT DELIBERATELY DOES NOT
-- -----------------------------------------------------------------------------
--   REFUSED   consuming a challenge that is already consumed (the race above)
--   REFUSED   moving `consumed_at` to a different instant (a rewritten audit fact)
--   REFUSED   setting `consumed_at` back to NULL (a spent code made spendable)
--   ALLOWED   the first consume, NULL -> an instant
--   ALLOWED   every other UPDATE on a consumed row, `attempts` included, because
--             `NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at` there
--
-- `attempts` IS NOT GUARDED HERE AND THE ABSENCE IS DELIBERATE. Its ceiling is
-- `0002`'s own `CHECK (attempts BETWEEN 0 AND 5)`, the handler refuses to select
-- an exhausted challenge so the CHECK is never the thing that answers a person,
-- and a lost increment under concurrency costs an attacker one extra guess out
-- of five rather than a row. A trigger enforcing monotonicity on a counter the
-- accessor can only write as a literal would be a second opinion about a value
-- no reader treats as exact.
--
-- `0002` AND `0029` ARE BYTE FOR BYTE UNCHANGED AND `otp_challenges_unconsumed_uq`
-- IS NOT DROPPED. It is a real partial index and the read this handler makes --
-- the newest live challenge for one address -- uses that shape. What it is not
-- is the constraint its neighbouring comment claims. This file adds the missing
-- statement rather than removing a true one, which is `0059`'s own posture
-- beside `ledger_transactions_no_self_reversal`.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION assert_otp_consumption_is_write_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION
      'otp_challenges.consumed_at is write once: challenge % was consumed at % and this '
      'statement would set it to %. A second consume is a single-use code spent twice, and '
      'the handler read that preceded it saw the row unconsumed (ADR-200)',
      OLD.id, OLD.consumed_at, NEW.consumed_at
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'otp_challenges_consumption_is_write_once';
  END IF;

  RETURN NEW;
END;
$$;

-- THE `WHEN` CLAUSE IS THE WHOLE OF THE COST, on `0059`'s precedent. The function
-- body runs only for a row that is ALREADY consumed, so every first consume and
-- every `attempts` increment pays a predicate and never a function call.
CREATE TRIGGER otp_challenges_consumption_is_write_once
  BEFORE UPDATE ON otp_challenges
  FOR EACH ROW
  WHEN (OLD.consumed_at IS NOT NULL)
  EXECUTE FUNCTION assert_otp_consumption_is_write_once();

COMMENT ON FUNCTION assert_otp_consumption_is_write_once() IS
  'ADR-200. 0002:328-331 claims "Single use, enforced by the database rather '
  'than by the handler" over otp_challenges_unconsumed_uq, which is a UNIQUE '
  'index over the PRIMARY KEY and therefore bounds nothing. SECURITY section 2 '
  'row S states the same control as "short TTL, single use, 5-attempt lock". '
  'This is the object that carries it: consumed_at is write once, so two '
  'concurrent verifications of one code consume it once. Measured both ways '
  'against this schema: without it both transactions commit and one code mints '
  'two sessions; with it the second is refused at its UPDATE.';

COMMIT;
