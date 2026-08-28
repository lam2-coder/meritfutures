-- =============================================================================
-- 0055_last_two_ledger_kinds
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-186, status: proposed, founder approval PENDING.
--
-- `psp_clearing` IS AN `asset` AND `reserve` IS AN `asset`, AND THE `ELSE true`
-- CLOSES TO `ELSE false`. Every one of the seven declared codes now has a
-- `kind` bound to it, and a code with no arm is REFUSED rather than admitted.
--
-- 0052 ruled four kinds and left three codes falling through `ELSE true`. 0053
-- moved one of them out and said, in its own words, that "psp_clearing and
-- reserve fall through it, refused by 0052 for lack of a posting and, for
-- reserve, for lack of a reader. Neither refusal is reopened here." This file
-- reopens both, and it is the last file that can: there is nothing left in the
-- hole after it.
--
-- THE CONSTRAINT IN FORCE WAS READ FROM THE DATABASE AND NOT FROM A FILE NAME.
-- A CHECK cannot be extended in place, so the constraint the database has is
-- the LAST one added, whatever file added it. Executed: 0001 through 0054
-- applied forward-only from empty against PostgreSQL 16 under ON_ERROR_STOP,
-- 114 base tables, `pg_get_constraintdef` on
-- `ledger_accounts_kind_matches_code` returns 0053's five arms and its
-- `ELSE true`, and `ledger_accounts` holds two rows.
--
-- THE HOLE WAS WATCHED ACCEPTING BEFORE IT WAS CLOSED, which is 0052's own rule
-- and 0034's: TEN acceptances, `psp_clearing` and `reserve` each admitted as
-- `asset`, `liability`, `revenue`, `expense` and `equity` in turn. A probe that
-- only ever attempts forbidden things passes against a guard that rejects
-- everything.
--
-- Six things need the founder's line-by-line read.
--
--   1. THE ELIMINATION, WHICH RUNS ONCE FOR BOTH CODES. `kind` is a five-member
--      CHECK (0009:40). Neither code is `revenue`: checkout.ts:1673 states in
--      shipped source that `fees_revenue` is "the only one of the seven whose
--      kind is revenue", and :1674-1675 names these two among "the other three
--      firm codes" and says "none of them is where a product sale is
--      recognized". Neither is an `expense`: no posting in this corpus writes
--      one and no code is an expense, which is 0053's own step. Neither is
--      `equity`: an equity position moves on a capital event, and nothing in
--      this corpus describes a capital event at all. SO EACH IS `asset` OR
--      `liability`, and the grounds below choose.
--
--   2. psp_clearing -> asset. THE TREE STATES ITS NATURE TWICE AND BOTH
--      STATEMENTS ARE ASSET-SHAPED, and the second one is the finding.
--
--      checkout.ts:1681-1682 is the sentence ADR-177 and ADR-181 both quote:
--        crediting a clearing account "would book a receivable from a processor
--        that was never asked for money". A RECEIVABLE IS AN ASSET. ADR-177 is
--        right that the sentence's VERB is backwards for one, because crediting
--        an asset reduces a receivable rather than booking one, so this cannot
--        be read as a sign-checked derivation. IT IS NOT BEING READ AS ONE. The
--        noun is what is read, and the noun is a class word.
--
--      checkout.ts:1679 is the sentence NEITHER PRIOR ENTRY QUOTED, and it sits
--        one line above the one both did: "There is no processor in this
--        transaction, so there is nothing IN clearing." An account that HOLDS
--        something when a processor is present is an account that holds Merit's
--        money at a third party. That is cash at a third party, which is an
--        asset, and it is the reading ADR-181 section 8 offered as the coherent
--        alternative NOT WRITTEN IN THIS TREE -- "funds held at a payment
--        provider for onward payment". IT IS WRITTEN IN THIS TREE, in shipped
--        source, one line above the sentence that entry read instead.
--
--      SO THE TWO READINGS DO NOT COMPETE ON CLASS. A receivable from a
--        processor and funds held at a processor for onward payment are both
--        assets. What would make `psp_clearing` a `liability` is a reading under
--        which Merit holds money it owes onward to somebody else, and NO FILE IN
--        THIS TREE STATES ONE. M03 section 3.4's whole table, quoted at
--        checkout.ts:1680, is about a purchase with "no third party": the
--        processor path collects Merit's own product revenue, and money Merit
--        has collected for itself is not money Merit owes.
--
--   3. reserve -> asset, AND THIS IS THE WEAKER OF THE TWO. It has no posting
--      and no reader, which is what ADR-177 refused it for, and BOTH ARE STILL
--      TRUE and were re-derived here rather than inherited. What has changed is
--      not the evidence for it but the ground ADR-177 gave for discounting that
--      evidence.
--
--      GLOSSARY: the reserve is "Funds set aside to cover projected payouts.
--        Held and reported separately from operating funds." FUNDS ARE CASH and
--        a thing "held" is a thing held.
--
--      0052:114-116 DISCOUNTED THAT SENTENCE ON A GROUND ADR-180 HAS SINCE
--        REVERSED. It called it "asset-shaped prose of exactly the kind that
--        turned out to be wrong for firm_treasury one row up". ADR-180 ruled
--        that the asset-shaped prose about firm_treasury was RIGHT and the
--        arithmetic backwards. The precedent 0052 used to distrust this sentence
--        now runs the other way.
--
--      AND UNLIKE firm_treasury THERE IS NOTHING ON THE OTHER SIDE. ADR-180 had
--        to choose between two unanimous halves. Here there is one direction of
--        evidence and no posting anywhere in the corpus contradicting it, which
--        is a WEAKER kind of evidence and a STRONGER epistemic position at the
--        same time, and saying both is the honest form of it.
--
--      THE COMPETING READING IS `equity` AND IT IS NAMED RATHER THAN IGNORED.
--        In classical accounting a "reserve" is often an appropriation of
--        retained earnings, which is equity. It is refused on the anchor:
--        SD-M5-03 ties the reserve figure to `treasury_balances`, whose `source`
--        is CHECKed to ('provider_api','manual_attestation') (0009:147). A
--        provider API reports how much of Merit's money it is holding. An equity
--        appropriation has no rail balance and no provider to report it. This is
--        0053 ground (a) applied to the other code.
--
--   4. THE `ELSE true` CLOSES TO `ELSE false`, WHICH IS A DECISION AND NOT A
--      TIDY-UP. With all seven codes armed and `ledger_accounts_code_is_declared`
--      closing `code` at those seven, the ELSE arm is UNREACHABLE TODAY under
--      either word. What separates them is what happens on the day the
--      vocabulary widens.
--
--      Under `ELSE true` an eighth code inserts with ANY kind and nothing says
--      so, which is the same silence 0052 installed deliberately and stored an
--      open question in. There is no open question left to store.
--
--      Under `ELSE false` an eighth code is REFUSED until its kind is ruled in
--      the same migration that mints it. That is 0009:46's rule -- "A class
--      appearing first in a migration is a class nobody defined" -- one column
--      over: a code with a declared name and no ruled kind is a class half
--      defined. ADR-181 section 4 measured that minting the eighth code must
--      move 0009's CHECK and 0027's LEDGER-C2 together; this makes it three, and
--      the third one FAILS LOUDLY rather than admitting.
--
--      WATCHED FIRING RATHER THAN ASSERTED: with
--      `ledger_accounts_code_is_declared` DROPPED inside a transaction, an
--      eighth code that guard-two's trigger would also refuse is refused HERE
--      FIRST, by name, on this constraint.
--
--   5. NO ROW IS SEEDED, AND THAT IS A DECISION. Both codes are firm-scoped
--      (LEDGER_ACCOUNT_SCOPE, accounts.ts:52-55), so both are seedable by a
--      migration in the way the three per-identity classes were not, and 0052
--      header item 4's stated rule -- the seedable set is the firm codes with a
--      settled kind -- would now admit them.
--
--      THE RULE IS FOLLOWED AND ITS ARGUMENT IS NOT. 0052 seeded `fees_revenue`
--      and 0053 seeded `firm_treasury` because a posting the corpus states
--      resolves against each of them. NOTHING POSTS AGAINST EITHER OF THESE TWO,
--      so a row here would be a chart entry no posting resolves and a
--      `readChart` cost with no reader (chart.ts:12-16 prices that read).
--
--      AND ONE OF THE TWO CARRIES A HAZARD THE OTHER DOES NOT. SD-M5-03 anchors
--      the reserve figure OUTSIDE this ledger on purpose, because "computing it
--      from our own ledger makes it a number that agrees with itself". A
--      `reserve` ROW is the first object in this tree a later reader could sum
--      and mistake for that figure. Ruling the kind creates no such object;
--      seeding one would. If the founder wants the rows, they are one migration
--      of the same shape and this file is deliberately the cheaper half.
--
--   6. NO NEW CODE, NO NEW COLUMN, NO NEW TABLE, NO TRIGGER, NO GRANT AND NO
--      REVOKE. The vocabulary stays closed at seven, 0027's LEDGER-C2 is
--      untouched, and 0009, 0027, 0038, 0052, 0053 and 0054 are byte for byte
--      unchanged. A merged migration is never edited, only superseded, so the
--      constraint moves by DROP and re-ADD under one name, which is 0053's own
--      idiom and SD-M5-08's. 0052 header item 5's refused REVOKE stays refused
--      and stays ADR-177 section 7's.
--
-- WHAT THIS RULING COSTS, STATED BEFORE THE READ RATHER THAN AFTER IT. ADR-174
-- section 3 shape (iii) puts the external leg's in-flight obligation on
-- `psp_clearing` or `reserve`. ADR-181 derived that role to be a FIRM-SCOPED
-- `liability` and refused (iii) on what the tree says these two ARE. This file
-- makes that refusal a constraint: after it, NO firm code in the chart can hold
-- a liability, and shape (iii) is not merely refused but unrepresentable. The
-- eighth code, or shape (ii), is what is left. IF THE FOUNDER WANTS SHAPE (iii),
-- THE PLACE TO OVERTURN THIS IS ITEM 2 AND NOT THE CONSTRAINT: say that
-- `psp_clearing` is money Merit owes onward rather than money Merit holds, and
-- this file is superseded by one more of the same shape.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- ledger_accounts_kind_matches_code                                 -- SUPERSEDES
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 4 AND 6. Dropped and re-created under its own name, adjacent, in
-- one file. The five arms 0052 and 0053 wrote are carried over UNCHANGED and
-- re-stated rather than referenced, for 0053's reason: a CHECK cannot be
-- extended in place, and a ruling a reader has to assemble out of three files is
-- a ruling nobody reads.
--
-- THE `ELSE` IS THE ONLY THING IN THIS STATEMENT THAT IS NOT A CARRY-OVER OR AN
-- ADDITION, and header item 4 is why the word changed rather than the arm being
-- deleted. Deleting the ELSE entirely is NOT the same closure and is strictly
-- worse: a CASE with no ELSE returns NULL for an unmatched code and a CHECK
-- PASSES on NULL, so the constraint would behave exactly as `ELSE true` did
-- while appearing to say something else.
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
      WHEN 'psp_clearing'        THEN kind = 'asset'
      WHEN 'reserve'             THEN kind = 'asset'
      ELSE false
    END
  );

COMMENT ON CONSTRAINT ledger_accounts_kind_matches_code ON ledger_accounts IS
  'ADR-186 supersedes ADR-180 supersedes ADR-177. Binds kind to code for ALL '
  'SEVEN declared codes, and the ELSE is false rather than true: a code with no '
  'arm is refused, so an eighth code must have its kind ruled in the migration '
  'that mints it. psp_clearing is asset (checkout.ts states it holds funds at a '
  'processor and that crediting it books a receivable; both are assets) and '
  'reserve is asset (GLOSSARY: funds set aside, held separately). No firm code '
  'is a liability, so ADR-174 section 3 shape (iii) is unrepresentable.';

COMMIT;
