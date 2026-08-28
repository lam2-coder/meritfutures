-- =============================================================================
-- 0059_reversal_chain
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-193, status: proposed, founder approval PENDING.
--
-- `0009:103-104` PROMISED TWO RULES AND ITS CONSTRAINT COULD ONLY EVER CARRY
-- ONE. The comment reads "A reversal may not reverse itself, and may not chain
-- onto another reversal: a reversal of a reversal is an adjustment and should be
-- posted as one", and `ledger_transactions_no_self_reversal` beneath it is
-- `CHECK (reversal_of IS NULL OR reversal_of <> id)`. That is the WHOLE of what
-- a row-level CHECK can say, because a row-level CHECK cannot query another row.
-- The second clause has been unenforced since the ledger was created. This file
-- is the second clause.
--
-- `0009`, `0027`, `0038`, `0052`, `0053`, `0054`, `0055`, `0056` AND `0057` ARE
-- BYTE FOR BYTE UNCHANGED, AND `0009`'s CONSTRAINT IS NOT SUPERSEDED. That is a
-- deliberate difference from `0057`, which DID supersede an object `0009`
-- created. `ledger_transactions_no_self_reversal` says something true and narrow
-- about ONE row and it goes on saying it; `LEDGER-C3` says the other thing about
-- a SECOND row. Two statements, two objects, and no DROP.
--
-- -----------------------------------------------------------------------------
-- HOW THIS INTERACTS WITH `0057`'s UNIQUE INDEX, STATED RATHER THAN LEFT TO A
-- READER, BECAUSE THE TWO LOOK LIKE THE SAME RULE AND ARE NOT
-- -----------------------------------------------------------------------------
-- `0057` made `ledger_transactions_reversal_of_idx` UNIQUE, which refuses TWO
-- REVERSALS OF ONE TRANSACTION: two rows carrying the SAME `reversal_of` value.
-- `LEDGER-C3` refuses A REVERSAL OF A REVERSAL: one row whose `reversal_of`
-- names a row that itself carries a `reversal_of`. **Different rows, different
-- columns, and neither implies the other.** A chain gives every row a DIFFERENT
-- `reversal_of`, so the UNIQUE index is satisfied by it and always was; and two
-- reversals of one original are both un-chained, so `LEDGER-C3` is satisfied by
-- them. `0057` did not leave this open by oversight: its header item 7 says so
-- in its own words at `0057:152-160`, and ADR-189 section 6 reports it as a
-- finding.
--
-- -----------------------------------------------------------------------------
-- WHETHER, BEFORE WHERE. A REVERSAL OF A REVERSAL IS A RE-APPLICATION AND THE
-- RE-APPLICATION IS LEGITIMATE. WHAT IS REFUSED IS THE LINK
-- -----------------------------------------------------------------------------
-- The operation a chain expresses is real: an original was reversed, the
-- reversal was itself wrong, and the original's effect should stand after all.
-- **This file does not forbid that outcome and could not.** The corpus already
-- rules what shape it takes, one table over, in the same sentence that names the
-- prohibition: "a reversal of a reversal is an adjustment and should be posted
-- as one" (`0009:104`), and `0038:293-296`'s own note under
-- `assert_adjustment_reversal_is_sound` finishes the thought -- "reversing a
-- reversal here is therefore not a hard case, it is a new credit with its own
-- reason and its own second key".
--
-- SO THE RULE IS ABOUT WHAT A ROW MAY CLAIM, NOT ABOUT WHAT MONEY MAY MOVE. A
-- re-application posted as a new transaction with its own kind, its own
-- idempotency key and its own reason is accepted by this file. The same
-- movement wearing `reversal_of` is refused, and the reason is that a reversal
-- built by `reversalPosting` is the EXACT negation of its target, so the
-- reversal of a reversal is byte for byte the ORIGINAL's entries again. It is a
-- fresh money movement carrying a correction's vocabulary, and a reader
-- reconciling the ledger reads "a correction" where the truth is "a second
-- charge".
--
-- AND SD-M5-05's OWN REASON IS THE OTHER HALF. The link exists so that
-- "reconstructing which reversal answered which original" is instant rather than
-- archaeology (`0009:94-97`). At depth 1 that is a lookup. At arbitrary depth it
-- is a walk, and whether a given transaction is live depends on the PARITY of a
-- chain nobody bounded. The column stops answering the question it was added to
-- answer.
--
-- -----------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT `packages/ledger`, WHICH IS THE OTHER HALF OF THE RULING
-- -----------------------------------------------------------------------------
-- ADR-189 section 4 argues that a posting builder proves only what a caller who
-- called it built. That argument applies here and this file does not restate it.
-- **What is different here, and stronger, is that the builder is not merely
-- insufficient: it is INCAPABLE.** `reversalPosting(original, header)` receives
-- `reversalOf` as an opaque string. Whether that string names a row that is
-- itself a reversal is a fact about a row, `packages/ledger` opens no database
-- transaction and cannot (`reversal.ts:259` says so in its own `@param` note),
-- and nothing it holds can answer the question. A guard written there would
-- either refuse nothing or lie.
--
-- THERE IS A SECOND DOOR AND IT DOES NOT PASS THROUGH `reversalPosting` AT ALL.
-- `posting.ts:136`'s `PostingHeader` carries `reversalOf?: string`, so
-- `posting({ ..., reversalOf: x }, transfers)` writes the column directly and
-- `post.ts:176` carries it to the INSERT. A rule enforced in `reversalPosting`
-- would be bypassed by the public constructor one file over, without a cast and
-- without a lint.
--
-- -----------------------------------------------------------------------------
-- FIVE THINGS THAT NEED THE LINE-BY-LINE READ
-- -----------------------------------------------------------------------------
--   1. `BEFORE INSERT OR UPDATE`, WHERE `0038`'s TWO ARE `AFTER INSERT` ONLY AND
--      `0057`'s IS A DEFERRED CONSTRAINT TRIGGER. Each difference is a decision.
--
--      BEFORE rather than DEFERRED because there is no ordering to accommodate:
--      the row being reversed must EXIST before the reversing row can name it,
--      the FK sees to that, and no legitimate posting order needs the check
--      postponed. `0057` is deferred because the transition it guards and the
--      posting that answers it are mutually dependent; nothing here is. BEFORE
--      also puts the error on the offending statement rather than at COMMIT.
--
--      `OR UPDATE` because `0026`'s REVOKE is not the whole story. `0026:88-107`
--      revokes UPDATE and DELETE on `ledger_transactions` from `merit_app` AND
--      `PUBLIC`, which is why `0038` could reason that an INSERT trigger sees
--      every row that will ever exist. But the same file's next paragraph
--      (`0026:109-115`) says single-column UPDATEs to append-only tables are
--      performed by SECURITY DEFINER functions owned by `merit_migrator`, so an
--      UPDATE path to this table is a shape this estate has already designed
--      for, and the table owner holds UPDATE regardless of any REVOKE.
--      Retro-linking a committed row to a reversal is exactly what this guard
--      refuses, and covering it costs nothing on a table nobody updates.
--
--   2. THE `WHEN` CLAUSE IS THE ARM AND THE EARLY RETURN IS NOT REDUNDANT. The
--      trigger fires only for rows carrying a `reversal_of`, so the function is
--      never entered for the ordinary posting. The `IS NULL` return inside it is
--      kept for `LEDGER-C2`'s stated reason (`0027:97-100`): a guarantee that
--      depends on a clause a later migration could drop is a guarantee with a
--      dependency, and without the early return a function re-attached without
--      its `WHEN` clause would refuse every non-reversal in the ledger.
--
--   3. THE "CANNOT SEE" BRANCH IS REACHABLE, WHICH `0038`'s SECOND CHECK IS NOT,
--      AND IT WAS MEASURED RATHER THAN REASONED ABOUT. The FK guarantees the
--      target exists, but the FK is checked AFTER the row trigger, so this
--      function reads a row the FK has not yet vouched for. EXECUTED on
--      PostgreSQL 16 with two concurrent sessions, at READ COMMITTED and at
--      REPEATABLE READ: when the target reversal is committed-but-invisible or
--      uncommitted, this branch fires and the write is refused HERE, before the
--      FK would have refused it. It fails closed, and it is the guard's message
--      the writer sees rather than a foreign key's.
--
--      IT IS NOT A DUPLICATE OF THE FK AND IT IS ALSO NOT INDEPENDENT OF IT.
--      With this branch removed the write is still refused, by
--      `ledger_transactions_reversal_of_fkey` one moment later. It is kept
--      because a guard that silently depends on a constraint a later migration
--      could drop is `0027:97-100`'s own objection, and its ERRCODE is
--      `foreign_key_violation` rather than `check_violation` so that a caller
--      catching one from the other still sees the class it would have seen.
--
--   4. IT READS `FOR UPDATE`, WHICH IS `0038`'s SHAPE AND BUYS LESS THAN IT
--      LOOKS. It takes a row lock on the transaction being reversed so that a
--      concurrent writer cannot make that row a reversal while this one is
--      deciding. **What it cannot do is see a row that is not yet visible**, and
--      item 3 is what covers that case. Stated so that a reader does not count
--      the lock as closing a window it does not close.
--
--   5. WHAT THIS FILE DOES NOT DO, so the absences read as decisions. It adds no
--      table, no column, no enum value, no ledger code, no index, no grant and
--      no revoke. It edits no merged migration. It does NOT bound how many
--      reversals one ORIGINAL may have; `0057`'s UNIQUE index already does, and
--      restating it here would be two objects claiming one rule. It does NOT
--      require that a reversal exist, anywhere, for anything: `WD-C1` requires
--      one on the failure path and this file is silent on every other path.
--      One function, one trigger.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- LEDGER-C3: a reversal may not chain onto another reversal
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1 THROUGH 5. `0009:103-104`'s second clause, which its CHECK
-- could not express, and which has been unenforced on `ledger_transactions`
-- since the ledger was created.
--
-- THE ID CONTINUES `0027`'s FAMILY RATHER THAN OPENING ONE. `LEDGER-C1` refuses
-- a transaction that debits and credits one account and `LEDGER-C2` refuses an
-- entry against an undeclared class; both are about a transaction's shape and so
-- is this. `ADJ-C1` check 1 already raises the same rule one table over, cites
-- this file's authority (`0009`) as its own, and stays exactly as it is: that
-- one binds `account_adjustments` and this one binds every reversal in the
-- ledger, including the ones no adjustment row will ever accompany.
CREATE FUNCTION assert_reversal_does_not_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_link uuid;
BEGIN
  -- Header item 2. The `WHEN` clause is the arm; this is what makes the
  -- function correct without one.
  IF NEW.reversal_of IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lt.reversal_of INTO target_link
    FROM ledger_transactions lt
   WHERE lt.id = NEW.reversal_of
     FOR UPDATE;

  -- Header item 3. Reachable, measured, and fails closed.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'LEDGER-C3: ledger transaction % names % as the transaction it reverses, '
      'and this transaction cannot see that row. A reversal is posted against a '
      'transaction that already exists; ledger_transactions_reversal_of_fkey '
      'refuses this one moment later and this guard does not depend on it '
      '(ADR-193)',
      NEW.id, NEW.reversal_of
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF target_link IS NOT NULL THEN
    RAISE EXCEPTION
      'LEDGER-C3: ledger transaction % reverses %, which is itself the reversal '
      'of %. A reversal of a reversal is an adjustment and should be posted as '
      'one (0009): a new transaction with its own kind, its own idempotency key '
      'and its own reason, and not this one wearing reversal_of. The chained '
      'row is the ORIGINAL''s entries again, so it moves money while reading as '
      'a correction (ADR-193)',
      NEW.id, NEW.reversal_of, target_link
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_transactions_reversal_does_not_chain
  BEFORE INSERT OR UPDATE ON ledger_transactions
  FOR EACH ROW
  WHEN (NEW.reversal_of IS NOT NULL)
  EXECUTE FUNCTION assert_reversal_does_not_chain();

COMMENT ON FUNCTION assert_reversal_does_not_chain() IS
  'LEDGER-C3, ADR-193. 0009:103-104 promised that a reversal "may not chain '
  'onto another reversal" and its CHECK could enforce only reversal_of <> id, '
  'because a row-level CHECK cannot query another row. This is that clause. '
  'It refuses the LINK and not the operation: a re-application is posted as a '
  'new transaction with its own reason and its own key, which is 0009''s own '
  'remedy and 0038''s note under assert_adjustment_reversal_is_sound. It is a '
  'DIFFERENT rule from 0057''s UNIQUE index, which refuses two reversals of ONE '
  'transaction: different rows, different columns, and neither implies the '
  'other.';

COMMIT;
