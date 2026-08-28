-- =============================================================================
-- 0056_eighth_ledger_code
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-187, status: proposed, founder approval PENDING.
--
-- THE EIGHTH LEDGER CODE. `withdrawals_in_flight`, a FIRM-SCOPED `liability`,
-- for the external leg's in-flight obligation: the thing that stands between the
-- moment a wallet withdrawal is approved and the moment its cash leaves.
--
-- THIS IS A DERIVATION AND NOT A PREFERENCE, and the entry says so in those
-- terms. ADR-174 section 3 named three shapes for where this obligation lives
-- and refused to choose. TWO OF THEM ARE NOW CLOSED AND NEITHER CLOSED BY
-- ARGUMENT:
--
--   Shape (iii), `psp_clearing` or `reserve` carries it, is UNREPRESENTABLE
--     rather than refused. ADR-186 ruled both codes `asset` and closed the CASE
--     to `ELSE false`, so after 0055 no firm code in the chart can hold a
--     liability and the database rejects the row. ADR-186 also found, at
--     checkout.ts:1679, the sentence ADR-181 section 8 put to the founder as the
--     coherent alternative -- "there is nothing IN clearing" -- and it does NOT
--     overturn that refusal, because a receivable from a processor and funds
--     held at a processor are BOTH assets while this role is a liability.
--
--   Shape (ii), `LT-06` and `LT-07` collapse to one posting at settlement,
--     deletes `LT-06`. M20:156 rules a BEHAVIOUR on `LT-06` having posted --
--     "LT-06 debited the wallet at approval, so the halt is holding a transfer,
--     not a claim" -- and STATE_MACHINES section 3.2 draws `approved -->
--     transferring --> settled`, whose middle state is the interval this
--     obligation stands in. Both documents are approved.
--
--   Shape (i)'s third ground, that minting "today unblocks nothing" because
--     `LT-06`'s debit leg is per identity and nothing in this tree created an
--     identity ledger account, DIED WITH ADR-183 AND 0054, which provision all
--     three per-identity positions on a trigger over `identities`.
--
-- SO SHAPE (i) IS WHAT THE CORPUS'S OWN CONSTRAINTS LEAVE. This file is not one
-- option among live alternatives; it is the only representable one.
--
-- THE BASELINE WAS REPRODUCED BEFORE A LINE OF THIS FILE WAS WRITTEN, and every
-- figure was read from the catalog rather than from a grep. PostgreSQL 16, 0001
-- through 0055 applied forward-only from empty under ON_ERROR_STOP: 55 files,
-- 114 base tables, 22 non-internal triggers, `ledger_accounts` at 2 rows
-- (`fees_revenue / revenue / firm` and `firm_treasury / asset / firm`), and
-- `pg_get_constraintdef` on `ledger_accounts_kind_matches_code` returning
-- 0055's seven arms and its `ELSE false`.
--
-- ALL THREE GUARDS WERE WATCHED REFUSING THE EIGHTH CODE INDEPENDENTLY, each
-- with the others dropped inside a transaction, which is ADR-181 section 5 row
-- 2's method run over three guards instead of two:
--
--   1. Both CHECKs standing: refused by `ledger_accounts_code_is_declared`.
--   2. `code_is_declared` DROPPED: refused by `ledger_accounts_kind_matches_code`,
--      which is ADR-186's `ELSE false` doing the only thing it was ever going to
--      do.
--   3. BOTH CHECKs dropped, so the row lands: the first `ledger_entries` row
--      against it RAISES `LEDGER-C2: ledger_account ... has undeclared class
--      withdrawals_in_flight`.
--
-- Seven things need the founder's line-by-line read.
--
--   1. THREE GUARDS MOVE IN ONE TRANSACTION, AND 0027 ANTICIPATED THIS FILE IN
--      ITS OWN WORDS. 0027:97-100 explains why LEDGER-C2 is a second line:
--      "the CHECK on ledger_accounts.code (migration 0009) is the primary guard;
--      this trigger is the second line, because a FK to a table whose own CHECK
--      could be dropped in a later migration is a guarantee with a dependency."
--      THIS IS THAT LATER MIGRATION. It drops that CHECK, and the comment's
--      whole point is that doing so must not be quiet. It is not: all three
--      guards move here, adjacent, in one file, in one transaction, and the E2
--      read's subject is that they agree.
--
--      EACH IS SUPERSEDED, NEVER EDITED. The two CHECKs move by DROP and re-ADD
--      under one name, which is 0053's, 0055's and SD-M5-08's idiom; the trigger
--      function moves by CREATE OR REPLACE under one name, which is the same act
--      for an object that has no ADD. 0009, 0027, 0038, 0052, 0053, 0054 and
--      0055 are byte for byte unchanged.
--
--   2. THE CLASS AND THE SCOPE ARE ADR-181's DERIVATION AND ARE NOT REOPENED
--      HERE, but they are what the two literals in this file say, so they are
--      re-derived rather than cited. posting.ts:235-236 pushes `+amountCents` on
--      the debit and `-amountCents` on the credit, so a CREDIT increases a
--      liability and a DEBIT decreases one. M05:135 has `LT-06` DEBIT
--      `trader_wallet` and leaves the credit open; M05:136 has `LT-07` CREDIT
--      `firm_treasury` and leaves the debit open. So the open slot RISES when
--      the trader's claim is extinguished and FALLS when the cash leaves. That
--      is a liability. It is not `revenue` (nothing is earned when a trader
--      moves money already theirs), not an `expense` (no posting in this corpus
--      writes one), not `equity` (it moves on a rail's settlement rather than a
--      capital event), and not an `asset` (an asset credited at approval would
--      SHRINK when a withdrawal is approved). It is FIRM-SCOPED because ADR-174
--      clause 3 rules that "LT-07 stays firm-only", on arithmetic.
--
--   3. THE SPELLING, AND THE THIRD REFUSAL THAT IS NOT IN ADR-181's LIST.
--      ADR-181 section 4 refused two spellings in advance: `firm_payable`,
--      because probe_ledger_constraints.sql uses it as the live negative fixture
--      for LEDGER-C2 and minting it would make that probe assert the opposite of
--      what it says; and any `payouts_*` spelling, because *payout* is the
--      INTERNAL leg's word (LT-01 `payout_approval`, LT-02 `payout_settlement`)
--      and SD-M5-07 retired a pooled `payouts` class, so the name would read as
--      that class returning.
--
--      A THIRD REFUSAL IS ARMED IN THIS TREE AND NO ENTRY NAMES IT.
--      packages/rail/test/lt-07.test.ts asserts, over the declared vocabulary,
--      that no code `includes('payable')` or `includes('payout')`. IT REFUSES
--      `withdrawals_payable`, WHICH IS THE SPELLING ADR-181 SECTION 5 ROW 1 AND
--      ADR-186 SECTION 7 ROW 6 EACH FIRED AT A DATABASE as the eighth code, and
--      which probe_ledger_constraints.sql's K1c block still uses as its live
--      undeclared-code fixture. Weakening that assertion to admit the name would
--      be weakening a gate to pass it, so the NAME moved instead.
--
--      `withdrawals_in_flight` TRANSCRIBES THE CORPUS'S OWN WORDS FOR THE ROLE.
--      `withdrawal` is the EXTERNAL leg's word (LT-06 `wallet_withdrawal_approval`,
--      LT-07 `wallet_withdrawal_settlement`), which is what separates it from the
--      retired pooled class; `in_flight` is what ADR-174 clause 4, ADR-181's own
--      title and M05:135-136 each call this role, and STATE_MACHINES section
--      3.2's middle state is `transferring`. It carries neither refused
--      substring, it is not `firm_payable`, and it leaves K1c's fixture an
--      undeclared code, so that probe still asserts exactly what it says.
--
--      AND IT MATCHES HOW THIS CHART NAMES THINGS. Six of the seven declared
--      codes name what the account HOLDS or where it sits -- `firm_treasury`,
--      `psp_clearing`, `reserve`, `trader_withdrawable`, `trader_wallet`,
--      `promotional_credit` -- rather than their accounting class. Only
--      `fees_revenue` carries a class word. A `*_payable` spelling would have
--      been the second.
--
--   4. THE ROW IS SEEDED, AND THAT IS ARGUED RATHER THAN ASSUMED, because the
--      two entries before this one went opposite ways on it and both were right.
--
--      0052 header item 4's stated RULE is that the seedable set is the firm
--      codes with a settled kind. This code is firm-scoped and its kind is ruled
--      in this file, so the rule admits it.
--
--      0055 FOLLOWED THAT RULE AND DECLINED ITS ARGUMENT, and the argument is
--      what decides here. 0052 seeded `fees_revenue` and 0053 seeded
--      `firm_treasury` because A POSTING THE CORPUS STATES RESOLVES AGAINST
--      EACH; ADR-186 seeded nothing because nothing posts against `psp_clearing`
--      or `reserve`. TWO POSTINGS THE CORPUS STATES RESOLVE AGAINST THIS ONE:
--      M05:135's `LT-06` credit leg and M05:136's `LT-07` debit leg, both ruled
--      to this exact role by ADR-181 and both UNPOSTABLE until this row exists.
--
--      ADR-183 SECTION 7 ROW 3 MEASURED WHAT AN UNSEEDED ROW COSTS. chart.ts's
--      `resolve` throws "no ledger account for ... A posting never opens an
--      account", and LT-01 and LT-08 had never posted in this repository's
--      history for exactly that reason until 0054 wrote their rows. A mint
--      without the seed would repeat that: it would widen the vocabulary at E2's
--      price and leave both rows exactly as unpostable as they were, which is
--      ADR-181 section 4's third ground surviving in a new form.
--
--      AND ADR-186's REASON FOR NOT SEEDING DOES NOT TRANSFER. Its hazard was
--      that a `reserve` ROW is the first object in this tree a reader could sum
--      and mistake for the figure SD-M5-03 anchors OUTSIDE this ledger on
--      purpose. Nothing anchors this obligation outside this ledger. Its balance
--      is meant to be summed, and ADR-181 section 7 already names the reader who
--      owes it a term: INV-M5-15's Open Liability, which must not quietly fall
--      when a withdrawal is approved and the cash is still Merit's.
--
--      `ledger_accounts` GOES FROM 2 ROWS TO 3, by a PLAIN INSERT. See the
--      statement's own note: `ON CONFLICT DO NOTHING` on a firm seed is the
--      silent skip ADR-177 found in the CI probe, and a merged migration runs
--      once.
--
--   5. THE `ELSE false` IS CARRIED OVER AND NOT REOPENED. ADR-186 ruling 3 is
--      the only part of 0055 that binds a future session, and this is that
--      session. It did what it said: an eighth code was refused until its kind
--      was ruled in the migration that mints it, and this file rules it in the
--      same statement that declares the name. The seven arms 0052, 0053 and 0055
--      wrote are carried over UNCHANGED and re-stated rather than referenced,
--      for 0053's reason: a CHECK cannot be extended in place, and a ruling a
--      reader has to assemble out of four files is a ruling nobody reads.
--      Deleting the ELSE would be strictly worse and is not done: a CASE with no
--      ELSE returns NULL for an unmatched code and a CHECK PASSES on NULL.
--
--   6. NO NEW COLUMN, NO NEW TABLE, NO NEW TRIGGER, NO GRANT AND NO REVOKE. The
--      trigger 0027 created is untouched; only the FUNCTION it executes is
--      replaced, under its own name, so `ledger_entries_class_declared` keeps
--      its identity and its timing. 0054's provisioning trigger is untouched and
--      still writes exactly the three per-identity codes: this code is firm
--      scoped and no identity opens a position in it.
--
--   7. WHAT THIS FILE DOES NOT RULE. It does not rule `LT-02`'s open
--      counterparty slot. M05:131 leaves that slot open and says what replaces
--      the pooled class is "ADR-174 section 3's question", which a reader could
--      take to mean this file answers it. IT DOES NOT. ADR-174 clause 4 derives
--      this role from a gap BETWEEN TWO MOMENTS that exists only on the external
--      leg, and says in terms that the internal leg "had no such gap because M05
--      section 3.1 makes the internal leg one transaction". ADR-181's derivation
--      reads `LT-06` and `LT-07` and no other row. `LT-02` is a separate ruling
--      and stays open.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- GUARD ONE: ledger_accounts_code_is_declared                       -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1 AND 3. 0009's primary guard, dropped and re-created under its
-- own name. The seven codes it declared are carried over in 0009's own ORDER,
-- with their comments, because `accounts.test.ts` asserts this list against
-- `LEDGER_ACCOUNT_CODES` positionally so that a diff of the two reads the same
-- way; the eighth is appended rather than inserted, so every existing position
-- is unmoved.
--
-- 0009:46's rule is why this is a constraint and not a convention: "A class
-- appearing first in a migration is a class nobody defined." This class does not
-- appear first here. ADR-174 clause 4 named the role, ADR-181 derived its class
-- and its scope, ADR-186 made every alternative unrepresentable, and ADR-187
-- names it.
ALTER TABLE ledger_accounts
  DROP CONSTRAINT ledger_accounts_code_is_declared;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_code_is_declared CHECK (
    code IN (
      'firm_treasury',
      'psp_clearing',
      'fees_revenue',
      'reserve',
      'trader_withdrawable',   -- per identity. What the engine says is drawable.
      'trader_wallet',         -- per identity. SD-M5-07. What Merit already owes.
      'promotional_credit',    -- ADR-019 activated it. NEVER withdrawable.
      'withdrawals_in_flight'  -- ADR-187. The external leg's in-flight obligation.
    )
  );

-- -----------------------------------------------------------------------------
-- GUARD TWO: LEDGER-C2's function body                              -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1 AND 6. CREATE OR REPLACE under 0027's own name, so the trigger
-- `ledger_entries_class_declared` is not dropped, not re-created, and keeps its
-- BEFORE INSERT timing. The body is 0027's, with the vocabulary widened and the
-- message's count moved with it: a second line that still says SEVEN while the
-- first says eight is a second line nobody can read.
--
-- THE `NOT IN` SHAPE IS PRESERVED DELIBERATELY. `accounts.test.ts` anchors on
-- `IF acct_code NOT IN` to read this vocabulary back and hold it against the
-- CHECK above and against `accounts.ts`. Rewriting the test to a different shape
-- here would move the third copy's only check.
CREATE OR REPLACE FUNCTION assert_ledger_account_class_declared() RETURNS trigger
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
      'trader_withdrawable','trader_wallet','promotional_credit',
      'withdrawals_in_flight') THEN
    RAISE EXCEPTION
      'LEDGER-C2: ledger_account % has undeclared class %. The eight v1 codes '
      'are the whole permitted vocabulary. See ADR-027, ADR-187.',
      NEW.ledger_account_id, acct_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- GUARD THREE: ledger_accounts_kind_matches_code                    -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1, 2 AND 5. The seven arms 0052, 0053 and 0055 wrote are carried
-- over UNCHANGED and the eighth is added. The `ELSE false` 0055 installed is
-- carried over unchanged too: it is the guard that made this file rule a kind in
-- the same statement that mints a name, and it is not reopened by the migration
-- it was aimed at.
--
-- THIS IS THE ONE ARM IN THE CHART THAT IS A FIRM-SCOPED LIABILITY, and after it
-- ADR-174 section 3 shape (iii) is closed for a second reason: not only can
-- neither silent code hold the role, the role now has a code of its own.
ALTER TABLE ledger_accounts
  DROP CONSTRAINT ledger_accounts_kind_matches_code;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_kind_matches_code CHECK (
    CASE code
      WHEN 'fees_revenue'          THEN kind = 'revenue'
      WHEN 'trader_wallet'         THEN kind = 'liability'
      WHEN 'trader_withdrawable'   THEN kind = 'liability'
      WHEN 'promotional_credit'    THEN kind = 'liability'
      WHEN 'firm_treasury'         THEN kind = 'asset'
      WHEN 'psp_clearing'          THEN kind = 'asset'
      WHEN 'reserve'               THEN kind = 'asset'
      WHEN 'withdrawals_in_flight' THEN kind = 'liability'
      ELSE false
    END
  );

-- -----------------------------------------------------------------------------
-- THE SEED                                                              -- HEADER ITEM 4
-- -----------------------------------------------------------------------------
-- One firm row, which is the whole of what a migration can seed for a firm code.
--
-- A PLAIN INSERT, AND THE FIRST DRAFT OF THIS FILE HAD `ON CONFLICT DO NOTHING`
-- ON IT. That is 0054's idiom and it does not belong here: 0054's clause is what
-- makes a TRIGGER re-runnable against a partly provisioned database and a
-- BACKFILL safe to re-run, and this statement is neither. A migration runs once
-- and forward only, so the clause could only ever hide a duplicate, which is the
-- silent skip ADR-177 found in the CI probe and ADR-183 found again in it. 0052
-- and 0053 each seed with a plain INSERT for the same reason.
--
-- The `kind` literal here is NOT a second statement of the ruling. It is the
-- same literal the constraint above binds, and the constraint refuses this row
-- if the two disagree: a wrong kind fails this migration rather than landing.
INSERT INTO ledger_accounts (code, kind, scope)
  VALUES ('withdrawals_in_flight', 'liability', 'firm');

COMMENT ON CONSTRAINT ledger_accounts_code_is_declared ON ledger_accounts IS
  'ADR-187 supersedes ADR-027. EIGHT declared codes. The eighth, '
  'withdrawals_in_flight, is the external leg''s in-flight obligation: a '
  'firm-scoped liability that LT-06 credits when a wallet withdrawal is '
  'approved and LT-07 debits when the cash leaves. LEDGER-C2 in 0027, replaced '
  'by 0056, states the same list as a second line.';

COMMENT ON CONSTRAINT ledger_accounts_kind_matches_code ON ledger_accounts IS
  'ADR-187 supersedes ADR-186 supersedes ADR-180 supersedes ADR-177. Binds kind '
  'to code for ALL EIGHT declared codes, and the ELSE is false rather than '
  'true: a code with no arm is refused, so a ninth code must have its kind '
  'ruled in the migration that mints it. withdrawals_in_flight is the only '
  'firm-scoped liability in the chart, which is what ADR-174 section 3 shape '
  '(i) required and no declared code could hold.';

COMMENT ON TABLE ledger_accounts IS
  'Chart of accounts. Eight v1 classes (ADR-027, ADR-187). trader_withdrawable '
  'and trader_wallet are distinct per-identity positions, not one under two '
  'names. withdrawals_in_flight is firm-scoped and no identity opens a position '
  'in it.';

COMMIT;
