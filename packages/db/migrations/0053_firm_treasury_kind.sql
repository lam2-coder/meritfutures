-- =============================================================================
-- 0053_firm_treasury_kind
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-180, status: proposed, founder approval PENDING.
--
-- `firm_treasury` IS AN `asset`. THE PROSE IS RIGHT AND THE ARITHMETIC IS
-- WRONG, and this file writes the half of that ruling a schema can hold.
--
-- 0052 refused this code and said why in terms: five documents call it the
-- account where a cash movement books, every posting the corpus writes against
-- it reads as a liability under the one sign convention, both sides are
-- unanimous, and no literal could be right about both halves. THAT
-- MEASUREMENT IS RE-DERIVED AT SOURCE HERE AND IS CONFIRMED. What ADR-180 adds
-- is the choice 0052 deliberately did not make, and ADR-180 AMENDS the losing
-- side rather than leaving it standing: M05 section 2.1's LT-02, LT-06 and
-- LT-07 rows are amended, because a ruling that writes a kind and leaves three
-- approved rows contradicting it has moved the contradiction rather than
-- settled it.
--
-- THIS IS A JUDGEMENT AND NOT A DERIVATION, AND THAT IS WHY THE ENTRY SHIPS
-- UNSIGNED. 0052's four kinds each came from a posting plus an elimination
-- step, and 0052's own approval block draws the line between what is derivable
-- and what is not. This code is on the other side of that line: both readings
-- are internally coherent, and choosing between them is weighing which half of
-- a corpus to disbelieve. Six things need the founder's line-by-line read.
--
--   1. THE FIVE GROUNDS, WEAKEST LAST, AND THE ONE THAT IS NOT USED.
--
--      (a) `treasury_balances` IS SCHEMA RATHER THAN PROSE AND IT ONLY PARSES
--        AS CASH. 0009:137-156 creates it with `account_code`, `balance_cents`
--        and `source CHECK IN ('provider_api','manual_attestation')`, and its
--        own header says the reserve coverage ratio "is anchored to the RAIL's
--        reported balance" because computing it from our own ledger "makes it a
--        number that agrees with itself" (SD-M5-03, INV-M5-11). A payment rail
--        reports exactly one number about Merit: how much of Merit's money it
--        is holding. That is cash at a third party, which is an asset. There is
--        no reading under which a provider API returns the balance of an
--        obligation Merit owes.
--
--        STATED AT ITS REAL STRENGTH AND NOT ABOVE IT: `account_code` is `text`
--        with no foreign key and no CHECK against `ledger_accounts` (ADR-174
--        finding 10 EXECUTED that), and no row anywhere in this tree writes
--        `firm_treasury` into it. So this is an argument from the table's
--        SUBJECT and not from a join. It is still the only statement about a
--        treasury balance in this corpus that is neither prose about intent nor
--        a cell of the LT table.
--
--      (b) UNDER `liability` THE CHART HAS NO CASH ACCOUNT, AND NOBODY HAS EVER
--        RECORDED THAT. The seven codes are closed (0009:49-58). fees_revenue
--        is revenue; trader_withdrawable, trader_wallet and promotional_credit
--        are the trader's and are ruled liability by 0052; psp_clearing is a
--        receivable from a processor (checkout.ts:1682); reserve has no posting
--        and no reader and is anchored outside this ledger on purpose. If
--        firm_treasury is an obligation then a double-entry ledger whose whole
--        subject is money movement holds no cash account at all.
--
--        THAT IS A LOUDER ABSENCE THAN A BACKWARDS ROW AND NOBODY NOTICED IT,
--        across every module plan, every decision entry and every merged
--        migration in this tree. The absence this corpus DID notice is the
--        other one: ADR-174 clause 4 names the external leg's missing in-flight
--        obligation role in terms, derives it from STATE_MACHINES section 3.2's
--        three-state rail and M20:156, and refuses to design it. An absence the
--        corpus never noticed, weighed against one it noticed and wrote down,
--        is evidence about which of the two is real.
--
--      (c) THE ARITHMETIC'S UNANIMITY IS ONE HAND AND NOT THREE WITNESSES.
--        LT-02, LT-06 and LT-07 are three cells of ONE table in ONE document.
--        ADR-027:73 records that "three direction-or-class errors landed on
--        LT-01 in a single day", one of which was "the firm_treasury debit that
--        contradicted the recognition timing", and that a fourth landed inside
--        the ADR describing them. 0009:121 calls a reversed sign "the error that
--        landed four times in one day on LT-01" and posting.ts:29 carries the
--        heading "SIGNS, WHICH THIS CORPUS HAS GOT BACKWARDS FOUR TIMES IN ONE
--        DAY". The one-place sign function exists BECAUSE the rows of that table
--        were written backwards. Three backwards rows in that table is this
--        corpus's documented failure mode at its documented site, and their
--        agreement is what one misunderstanding looks like rather than what
--        three independent measurements look like.
--
--      (d) FOUR OF THE PROSE SITES ARE DECISIONS AND NOT DESCRIPTIONS. M05:141,
--        ADR-027:48, ADR-033:20, ADR-067:77, 0038:48-49 and payouts.ts:773 all
--        call firm_treasury the account where cash books. Four of them did
--        something about it: ADR-027 and ADR-033 REFUSED firm_treasury as
--        LT-01's debit leg, ADR-067 section 2.3 refused it as the adjustment's
--        debit leg, and 0038's own E2-read header refuses it again -- "it moves
--        NO CASH. `firm_treasury` was the available mistake". A session that
--        declines to touch an account because touching it moves cash has ACTED
--        on the belief rather than restated it, and four did. NO SESSION HAS
--        EVER DECLINED AN ACTION ON THE GROUND THAT firm_treasury IS AN
--        OBLIGATION.
--
--      (e) THE NAME, TAKEN LAST AND CARRYING THE LEAST. A treasury is cash. It
--        is recorded because it agrees and it is relied on for nothing, since a
--        name is a convention and this entry's own ground elsewhere is that a
--        control outranks a convention.
--
--      AND THE MEASUREMENT THIS ENTRY DOES NOT USE, NAMED SO A READER DOES NOT
--        THINK IT WAS OVERLOOKED. ADR-174 finding 6 measured that LT-06 credits
--        firm_treasury and LT-07 debits it, so the external leg moves it by
--        ZERO. That zero is NOT evidence for either side: under `liability` it
--        is correct, an obligation created and discharged inside one leg, and
--        under `asset` it is the fingerprint of the defect. It holds for every
--        kind, which ADR-174 said in terms, so it decides nothing here.
--
--      THE ELIMINATION, WHICH RUNS BEFORE THE FIVE GROUNDS DO. `kind` is a
--      five-member CHECK (0009:40). firm_treasury is not `revenue`:
--      checkout.ts:1673 states in shipped source that fees_revenue is "the only
--      one of the seven whose kind is revenue". It is not an `expense`: no
--      posting in this corpus writes one and no code is an expense. It is not
--      `equity`: it is moved by settlements against a trader's position rather
--      than by a capital event. So it is `asset` or `liability`, and the
--      grounds above choose.
--
--   2. WHAT THIS MAKES WRONG, AND ADR-180 AMENDS IT RATHER THAN LEAVING IT.
--      Read through the sign convention (0009:118, posting.ts:235-236, positive
--      is DEBIT), an `asset` is INCREASED by a debit. So:
--
--        LT-02 read `debit firm_treasury trader_cents` at a settlement, which
--          books cash ARRIVING at the moment cash departs. It is CREDITED.
--        LT-06 read `credit firm_treasury amount_cents` at an approval, which
--          derecognizes cash AT APPROVAL -- the exact timing the batch 1 gate
--          ruled against and ADR-027, ADR-033, ADR-067 and 0038 each refused in
--          turn on LT-01. No cash moves at an approval, so this posting must
--          name NO cash account at all.
--        LT-07 read `debit firm_treasury` at a settlement. Backwards for LT-02's
--          reason. It is CREDITED.
--
--      M05 SECTION 2.1 IS AMENDED IN PLACE FOR ALL THREE, each row keeping its
--      original text quoted inside it, which is ADR-027's own precedent in this
--      exact table. Only the leg naming firm_treasury moves. THE COUNTERPARTY
--      SLOTS ARE LEFT OPEN AND NOT HALF-WRITTEN: they are ADR-174 section 3's
--      and this session's fence excludes them.
--
--      ADR-174 REFUSED THAT AMENDMENT AND ITS GROUND NO LONGER HOLDS, which is
--      recorded rather than stepped around. That entry rejected "amend the
--      LT-07 row to name the debit and credit correctly and leave the account
--      open" because "the row cannot be half-corrected without naming what the
--      credit account is". The half that was undecidable then is the half this
--      file decides: the cash leg is now determined, and only the code holding
--      the in-flight obligation is still open. ADR-174 clause 4 already RULED
--      that the role exists.
--
--   3. THE CONSTRAINT IS SUPERSEDED AND 0052 IS NOT EDITED. 0052's header says
--      what happens next in its own words: "the session that settles
--      firm_treasury supersedes this constraint and moves a code out of the
--      hole". So `ledger_accounts_kind_matches_code` is DROPPED and RE-CREATED
--      under its own name with a fifth arm, which is SD-M5-08's idiom (both
--      SD-09 predicates "dropped and re-created under their own names,
--      adjacent, in one file"). 0052 is byte for byte unchanged, and so are
--      0009, 0027 and 0038. A merged migration is never edited, only
--      superseded.
--
--      THE `ELSE true` SURVIVES AND STILL MEANS WHAT IT MEANT. psp_clearing and
--      reserve fall through it, refused by 0052 for lack of a posting and, for
--      reserve, for lack of a reader. Neither refusal is reopened here: this
--      entry answers a contradiction and has nothing to say about a silence.
--      The hole is smaller by one code and it is still where the open question
--      is stored.
--
--   4. THE SEED, AND `ledger_accounts` GOES FROM 1 ROW TO 2. firm_treasury is
--      firm-scoped (LEDGER_ACCOUNT_SCOPE in accounts.ts:52), so unlike the
--      three per-identity classes it is seedable by a migration at all. It is
--      written AFTER the constraint deliberately, so the row passes through the
--      gate this file installs rather than around it.
--
--      A PLAIN INSERT AND NOT `ON CONFLICT DO NOTHING`, for 0052's reason
--      restated: a silent skip is the defect session 321 actually found in the
--      CI probe. Migrations are forward-only and run once; if this row already
--      exists something is wrong and stopping is the right behaviour.
--
--      `id` is left to gen_random_uuid(), because chart.ts joins on
--      (code, scope, identity_id) and nothing resolves an account by uuid.
--
--   5. WHAT A WRONG RULING COSTS, STATED BEFORE THE READ RATHER THAN AFTER IT.
--      If the founder rules the other way, this constraint and this row are
--      superseded by one more migration of the same shape, and M05's three rows
--      are amended back by one more ADR. NOTHING ELSE IN THE TREE MOVES,
--      because no posting builder for LT-02, LT-06 or LT-07 exists: grep finds
--      no lt02, lt06 or lt07 in any shipped source, only lt01 and lt08. THE
--      REVERSAL IS CHEAP TODAY AND GETS EXPENSIVE THE DAY A RECEIVER POSTS ONE,
--      which is the argument for answering it now rather than for answering it
--      this way.
--
--   6. NO NEW CODE, NO NEW COLUMN, NO NEW TABLE, NO TRIGGER, NO GRANT AND NO
--      REVOKE. The vocabulary stays closed at seven and 0027's LEDGER-C2 is
--      untouched, so this file does not touch either of the two statements
--      ADR-027 was reversed over. 0052 header item 5's refused REVOKE stays
--      refused and stays ADR-177 section 7's, for the reason it gives: it needs
--      a FROZEN document amended and that is a slice of its own.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- ledger_accounts_kind_matches_code                                 -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEM 3. Dropped and re-created under its own name, adjacent, in one
-- file. The four arms 0052 wrote are carried over UNCHANGED and re-stated
-- rather than referenced, because a CHECK cannot be extended in place and a
-- constraint that names four codes in one file and a fifth in another is a
-- ruling a reader has to assemble.
ALTER TABLE ledger_accounts
  DROP CONSTRAINT ledger_accounts_kind_matches_code;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_kind_matches_code CHECK (
    CASE code
      WHEN 'fees_revenue'        THEN kind = 'revenue'
      WHEN 'trader_wallet'       THEN kind = 'liability'
      WHEN 'trader_withdrawable' THEN kind = 'liability'
      WHEN 'promotional_credit'  THEN kind = 'liability'
      WHEN 'firm_treasury'       THEN kind = 'asset'
      ELSE true
    END
  );

COMMENT ON CONSTRAINT ledger_accounts_kind_matches_code ON ledger_accounts IS
  'ADR-180 supersedes ADR-177. Binds kind to code for five of the seven codes. '
  'firm_treasury is asset: the prose is right and the three postings written '
  'against it are backwards, which ADR-180 amends in M05 section 2.1. '
  'psp_clearing and reserve still fall through ELSE true, refused for lack of '
  'a posting and, for reserve, for lack of a reader.';

-- -----------------------------------------------------------------------------
-- THE SEED
-- -----------------------------------------------------------------------------
-- HEADER ITEM 4. The second row this table has ever held. Written after the
-- constraint so it passes through the gate above rather than around it.
INSERT INTO ledger_accounts (code, kind, scope, identity_id)
  VALUES ('firm_treasury', 'asset', 'firm', NULL);

COMMIT;
