-- =============================================================================
-- 0057_terminal_withdrawal_obligation
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-189, status: proposed, founder approval PENDING.
--
-- THE NINTH LEDGER TRANSACTION IS `LT-09`, AND THIS FILE IS NOT IT. `LT-09` is a
-- POSTING and postings are written by callers; this file is the PROOF that the
-- posting happened. It asserts one thing and asserts it at the only moment the
-- database can see it: a wallet withdrawal that has reached a TERMINAL state
-- leaves NOTHING standing in `withdrawals_in_flight`.
--
-- WHAT IT DOES AND DOES NOT TOUCH OF `0056`'s THREE GUARDS, FIRST, BECAUSE THAT
-- IS THE QUESTION A READER OPENS THIS FILE WITH. `0056` merged one wave ago and
-- moved three guards in one transaction: `ledger_accounts_code_is_declared`,
-- `assert_ledger_account_class_declared` (LEDGER-C2's body) and
-- `ledger_accounts_kind_matches_code`. THIS FILE TOUCHES NONE OF THE THREE. It
-- does not DROP one, does not re-ADD one, does not CREATE OR REPLACE one, and
-- does not name one in a statement. The vocabulary stays closed at EIGHT and no
-- ninth code is minted: `LT-09` posts against `withdrawals_in_flight` and
-- `trader_wallet`, both of which `0056` and `0054` already opened. Nothing in
-- this file reads or writes `ledger_accounts` except as a JOIN target inside one
-- SELECT.
--
-- `0009`, `0027`, `0038`, `0052`, `0053`, `0054`, `0055` AND `0056` ARE BYTE FOR
-- BYTE UNCHANGED.
--
-- -----------------------------------------------------------------------------
-- WHAT IT IS FOR
-- -----------------------------------------------------------------------------
-- STATE_MACHINES section 3.2 draws `transferring --> failed: G-TRANSFER-EXHAUSTED`
-- and M05 section 2.1 declared eight transactions, none of which was a wallet
-- withdrawal that failed on the rail. `LT-06` posts at approval, so the trader's
-- wallet claim is extinguished; `LT-07` never posts, so no cash leaves; the
-- obligation `0056` minted carries a credit balance against a withdrawal that
-- will never settle, and the trader's money is in NEITHER place they could be
-- shown it. ADR-189 rules `LT-09`, the reversal of `LT-06`, as the repair.
--
-- A REVERSAL NOBODY CHECKS IS A PROMISE, and that sentence is this file's whole
-- reason to exist. ADR-189 section 4 measures what a posting builder can and
-- cannot prove. It can build the exact negation, because `reversalPosting` swaps
-- each transfer's two sides and nothing else emits an entry. It CANNOT prove
-- that a withdrawal which reached `failed` was ever handed to it. That is a
-- question about a row's history, and the only thing in this estate that sees a
-- row's history is the database.
--
-- TWO ASSERTIONS, ONE ID, WHICH IS `assert_adjustment_reversal_is_sound`'s OWN
-- SHAPE (0038): six assertions under `ADJ-C1`. Here it is two under `WD-C1`.
--
--   1. A TERMINAL WITHDRAWAL LEAVES NO OBLIGATION STANDING. The net of every
--      `withdrawals_in_flight` entry over every transaction naming this
--      withdrawal must be exactly 0. This is the RULING, stated as arithmetic.
--      It holds three different ways and the trigger does not care which:
--      `settled` discharges through `LT-07`, `failed` through `LT-09`, and
--      `cancelled` because `LT-06` never posted -- `cancelled` is reachable only
--      from `requested` and `cooling`, both BEFORE approval, so its net is a sum
--      over zero rows.
--
--   2. A `failed` WITHDRAWAL THAT REACHED APPROVAL NAMES AT LEAST ONE LEDGER
--      TRANSACTION. Without this, assertion 1 passes VACUOUSLY on the exact
--      defect this file exists to catch: a handler that transitions the row and
--      posts nothing sums over zero rows and gets 0. `0001:90` is the rule --
--      "a gate that silently stops gating is worse than an absent one" -- and a
--      net over an empty set is how this one would.
--
-- -----------------------------------------------------------------------------
-- SEVEN THINGS THAT NEED THE LINE-BY-LINE READ
-- -----------------------------------------------------------------------------
--   1. THE JOIN FROM A WITHDRAWAL TO ITS POSTINGS IS `(reference_kind,
--      reference_id)` AND THERE IS NO OTHER. `ledger_entries` carries no
--      withdrawal FK and no migration has ever proposed one, so this pair is the
--      whole of the edge. `reference_kind = 'wallet_withdrawal'` is ruled by
--      ADR-189 clause 4 and it is the convention already in force one leg over:
--      `payouts.ts` posts `LT-01` under `'payout_request'` and `checkout.ts`
--      posts under `'purchase'`, each the singular of the table the posting is
--      about.
--
--      THE LIMIT THIS CREATES IS NAMED RATHER THAN LEFT TO BE FOUND. A posting
--      written under a DIFFERENT reference tuple is invisible to both assertions
--      and assertion 1 would pass on it. Assertion 2 is what makes that loud on
--      the failure path, and `packages/ledger/src/reversal.ts` is what keeps the
--      tuple from being retyped at a call site: it is built there, once, and
--      `ninth-transaction.test.ts` holds it against this file's text.
--
--   2. ASSERTION 2's PROXY FOR "REACHED APPROVAL" IS `source_provenance_summary`,
--      AND IT IS A PROXY. `wallet_withdrawals` has no `approved_at`. What it has
--      is `wallet_withdrawals_approved_has_provenance` (0011, SD-M20-03), which
--      requires the summary on every status EXCEPT `requested`, `cooling`,
--      `cancelled` and `failed`. So a row that passed `approved` or
--      `transferring` carries one, and it keeps it, because nothing clears it.
--
--      TWO WEAKNESSES IN THE PROXY, BOTH RECORDED. `failed` is on that CHECK's
--      exemption list, so an UPDATE that sets `status = 'failed'` and clears the
--      summary in the same statement escapes assertion 2. And session 303 found
--      that `'[]'::jsonb <> '{}'::jsonb` is TRUE, so an empty ARRAY satisfies the
--      proxy and would make assertion 2 demand a posting for a row that never
--      reached approval. Assertion 1 is unaffected by both: it reads the ledger
--      and not the row.
--
--   3. IT IS A CONSTRAINT TRIGGER AND DEFERRED, AND THAT IS LOAD BEARING RATHER
--      THAN MERELY CONSISTENT. `LT-09` cannot be posted before the transition it
--      answers, and the transition cannot be validated before `LT-09` exists.
--      DEFERRED is what lets both live in one transaction, which is
--      `account_adjustments_wallet_entry_matches`'s stated reason in 0038 and
--      ADR-006's consequence: a posting commits in the SAME transaction as the
--      state change that caused it. A handler that transitions the row in one
--      transaction and posts in a second is refused by the first COMMIT.
--
--   4. `AFTER INSERT OR UPDATE`, WHERE 0038's TWO ARE `AFTER INSERT` ONLY. The
--      difference is a grant. 0038 ends with `REVOKE UPDATE, DELETE ON
--      account_adjustments`, so an INSERT trigger there sees every row that will
--      ever exist. `wallet_withdrawals` is UPDATE-able and MUST be: its whole
--      machine is status transitions. An INSERT-only trigger here would fire on
--      a row created at `requested` and never again, which is every terminal
--      transition unwatched. THIS FILE ADDS NO REVOKE: revoking UPDATE on
--      `wallet_withdrawals` would make the rail unable to advance its own rows.
--
--   5. THE `WHEN` CLAUSE ENUMERATES THE TERMINAL STATES AND A NINTH ENUM VALUE
--      WOULD NOT JOIN IT. `wallet_withdrawal_status` is
--      ('requested','cooling','approved','transferring','settled','failed',
--      'cancelled') in 0001 and STATE_MACHINES section 3.2 draws exactly three
--      arrows into `[*]`. The three are named here as literals, which means a
--      later migration adding a terminal value gets no coverage from this
--      trigger and nothing says so. That is the same class as 0027's vocabulary
--      lists and it is stated for the same reason.
--
--   6. THE `reversal_of` INDEX BECOMES UNIQUE, AND IT IS SUPERSEDED RATHER THAN
--      ALTERED. `0009` created `ledger_transactions_reversal_of_idx` as a plain
--      index. EXECUTED before this file was written: with it plain, a SECOND
--      transaction naming the same `reversal_of` under a different idempotency
--      key LANDS, and it drives `withdrawals_in_flight` to +25,000 and
--      `trader_wallet` to -25,000 while the global sum stays 0, so NOTHING in
--      this database sees it. `ledger_transactions_idempotency_key_key` does not
--      catch it, because the second posting has a different key.
--
--      A TRANSACTION IS REVERSED AT MOST ONCE. That is SD-M5-05 read literally
--      and it is what 0038 check 5 already says one table up: "a reversal is
--      exact; a partial correction is a full reversal plus a new credit". The
--      index is DROPPED and re-created UNIQUE under its own name, which is
--      0031's idiom on `wallet_withdrawals_open_idx` and 0053's, 0055's and
--      SD-M5-08's on a constraint. It binds every reversal in the ledger and not
--      only `LT-09`: `LT-03` is a reversal of `LT-01` and it may not be posted
--      twice either.
--
--   7. WHAT THIS FILE DOES NOT RULE, so the absences read as decisions.
--
--      IT DOES NOT REQUIRE A POSTING ON `settled`. Assertion 2 is scoped to
--      `failed`. Extending it would make `LT-07` mandatory at the settlement
--      transition, which is a rule about a posting ADR-189 does not rule and a
--      slice this session does not hold. The consequence is stated: on `settled`
--      assertion 1 passes vacuously when nothing posted.
--
--      IT DOES NOT CLOSE THE REVERSAL CHAIN. 0009:103-104's comment says a
--      reversal "may not chain onto another reversal" and the CHECK beneath it,
--      `ledger_transactions_no_self_reversal`, enforces only `reversal_of <> id`.
--      EXECUTED: a transaction whose `reversal_of` names a transaction that is
--      itself a reversal LANDS. That is a general ledger rule, `account_adjustments`
--      already enforces it where reversals are actually written today
--      (`assert_adjustment_reversal_is_sound` check 1), and closing it here would
--      be this file ruling the ledger at large from a withdrawal's fence.
--      ADR-189 section 6 reports it.
--
--      IT ADDS NO COLUMN, NO TABLE, NO ENUM VALUE, NO LEDGER CODE, NO GRANT AND
--      NO REVOKE. One index superseded, one function, one trigger.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A REVERSAL IS POSTED AT MOST ONCE                                 -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEM 6. 0009's plain index on the same columns, under the same name.
-- The index is not the point and the uniqueness is: this is the only thing in
-- the database that refuses a second reversal of one transaction, and without it
-- the ninth transaction can be posted twice and leave the obligation at a DEBIT
-- balance with the global sum still zero.
DROP INDEX ledger_transactions_reversal_of_idx;

CREATE UNIQUE INDEX ledger_transactions_reversal_of_idx
  ON ledger_transactions (reversal_of) WHERE reversal_of IS NOT NULL;

COMMENT ON INDEX ledger_transactions_reversal_of_idx IS
  'ADR-189 supersedes 0009''s plain index under its own name. SD-M5-05: '
  'corrections are compensating entries and never updates, so a transaction is '
  'reversed AT MOST ONCE. Without UNIQUE a second reversal of one transaction '
  'lands under a different idempotency_key and moves both positions again while '
  'the global sum stays zero, which no other control in this database sees.';

-- -----------------------------------------------------------------------------
-- WD-C1: a terminal wallet withdrawal leaves no obligation standing
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1, 2, 3, 5 AND 7. Two assertions under one id, which is
-- assert_adjustment_reversal_is_sound's shape (0038) with six.
--
-- ASSERTION 2 IS CHECKED FIRST DELIBERATELY, for 0038 check 1's stated reason:
-- when a handler posted NOTHING, both assertions are unsatisfied and this is the
-- one whose message names the rule the writer actually broke. A reader told
-- "leaves -25000 cents standing" goes looking for a reversal; a reader told
-- "names no ledger transaction" goes looking for LT-06.
CREATE FUNCTION assert_terminal_withdrawal_obligation_is_zero() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  postings   integer;
  obligation bigint;
BEGIN
  IF NEW.status = 'failed'
     AND NEW.source_provenance_summary <> '{}'::jsonb THEN
    SELECT count(*) INTO postings
      FROM ledger_transactions t
     WHERE t.reference_kind = 'wallet_withdrawal'
       AND t.reference_id   = NEW.id;

    IF postings = 0 THEN
      RAISE EXCEPTION
        'WD-C1: wallet withdrawal % is failed and carries a provenance summary, '
        'so it reached approval and LT-06 posted, but no ledger_transactions row '
        'names it as (''wallet_withdrawal'', %). A rail-exhausted withdrawal is '
        'reversed by LT-09 in the transaction that fails it (ADR-189)',
        NEW.id, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT COALESCE(sum(e.amount_cents), 0) INTO obligation
    FROM ledger_transactions t
    JOIN ledger_entries      e ON e.transaction_id    = t.id
    JOIN ledger_accounts     a ON a.id                = e.ledger_account_id
   WHERE t.reference_kind = 'wallet_withdrawal'
     AND t.reference_id   = NEW.id
     AND a.code           = 'withdrawals_in_flight';

  IF obligation <> 0 THEN
    RAISE EXCEPTION
      'WD-C1: wallet withdrawal % is terminal at status % and leaves % cents '
      'standing in withdrawals_in_flight. LT-06 extinguished the trader''s '
      'wallet claim; a terminal withdrawal that has not discharged the '
      'obligation leaves the money in neither place the trader could be shown '
      'it (ADR-189)',
      NEW.id, NEW.status, obligation
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER wallet_withdrawals_terminal_obligation_is_zero
  AFTER INSERT OR UPDATE ON wallet_withdrawals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('settled', 'failed', 'cancelled'))
  EXECUTE FUNCTION assert_terminal_withdrawal_obligation_is_zero();

COMMENT ON FUNCTION assert_terminal_withdrawal_obligation_is_zero() IS
  'WD-C1, ADR-189. A wallet withdrawal in a terminal state leaves nothing '
  'standing in withdrawals_in_flight: settled discharges through LT-07, failed '
  'through LT-09, and cancelled because LT-06 never posted -- cancelled is '
  'reachable only from requested and cooling, both before approval '
  '(STATE_MACHINES section 3.2). The second assertion is scoped to failed and '
  'stops the first passing vacuously when a handler transitioned the row and '
  'posted nothing.';

COMMIT;
