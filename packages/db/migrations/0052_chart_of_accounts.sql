-- =============================================================================
-- 0052_chart_of_accounts
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-177, status: proposed, founder approval PENDING.
--
-- `ledger_accounts` is the table every posting in this system names, and until
-- this file NOTHING HAS EVER POPULATED IT. Executed rather than believed, on
-- PostgreSQL 16 with 0001 through 0051 applied forward-only from empty under
-- ON_ERROR_STOP (114 base tables): `SELECT count(*) FROM ledger_accounts`
-- returns 0. The only INSERT INTO ledger_accounts anywhere in the tree is
-- scripts/db/probe_ledger_constraints.sql, which is a PROBE and not a seed.
--
-- A SEED IS DATA AND ITS VALUES ARE STILL RULINGS. `kind` decides which
-- direction every posting moves an account, so a wrong literal here is not a
-- typo, it is a reversed balance that E2 makes permanent: a merged migration is
-- never edited, only superseded.
--
-- SO THIS FILE WRITES FOUR KINDS AND REFUSES THREE. Four are DERIVED from
-- postings the corpus already states, through the one sign convention
-- (0009:118, positive is DEBIT). Three cannot be settled from any file in this
-- tree and are LEFT OUT rather than guessed. ADR-174 section 4 recorded that
-- absence and inferred no direction from it; this file does not either.
--
-- Six things need the founder's line-by-line read.
--
--   1. THE FOUR DERIVATIONS, EACH WITH ITS STEP WRITTEN OUT.
--
--      The convention is that a DEBIT is +amount_cents and a CREDIT is
--      -amount_cents (0009:118, posting.ts:235-236, and it is the only place in
--      the repository a sign is applied). A debit therefore INCREASES an asset
--      or an expense and DECREASES a liability, a revenue or an equity; a
--      credit does the reverse. Each derivation below is a posting the corpus
--      states, read through that convention, plus one elimination step.
--
--      fees_revenue -> revenue. LT-01 CREDITS it firm_cents and M05:147 says
--        "firm_cents becomes recognized revenue", so the credit increases it
--        and it is a liability, a revenue or an equity. ADR-067 section 2.3 and
--        0038's header item 4 post the other direction on the same account: an
--        adjustment DEBITS fees_revenue and both say in terms that it "reduces
--        revenue". Two postings in opposite directions agree. checkout.ts:1671
--        states the conclusion outright in shipped source, that fees_revenue is
--        "the only one of the seven whose kind is revenue". This is the most
--        over-determined fact in the question.
--
--      trader_wallet -> liability. LT-01 CREDITS it trader_cents and M05:145
--        calls what it credits "a firm obligation to pay"; 0009:25 says "Wallet
--        is what Merit already owes them". The credit increases it, so it is a
--        liability, a revenue or an equity. It is per-identity, so it is not the
--        firm's revenue and not the firm's equity. 0038's header item 4 states
--        it directly for the same account: an adjustment "books a liability and
--        reduces revenue in ONE moment, its own".
--
--      trader_withdrawable -> liability. LT-01 DEBITS it approved_cents and
--        M05:147 says that is "what leaves their claim on the firm"; 0009:24
--        says "Withdrawable is what the engine says the trader may draw". The
--        debit decreases it, so it is a liability, a revenue or an equity. It is
--        per-identity and it is a trader's claim, so it is neither of the other
--        two.
--
--      promotional_credit -> liability. THIS ONE IS DERIVED FROM A CONSTRAINT
--        RATHER THAN FROM PROSE, which is why it is settleable at all while
--        three others are not. 0038:146 CHECKs `destination IN
--        ('trader_wallet','promotional_credit')`, 0038:420-425 writes the sign
--        mapping out as a table -- a credit posts -amount_cents on "the
--        identity's destination class" and +amount_cents on fees_revenue -- and
--        assert_adjustment_posting_matches ENFORCES that mapping on every row.
--        0038's header item 4 describes what that posting does, once, for both
--        destinations: it "books a liability and reduces revenue". So the
--        credit increases promotional_credit and the same file names what is
--        increased. M17 OF-M17-04 corroborates the meaning: a grant "spendable
--        at checkout", which is an entitlement Merit owes.
--
--   2. THE THREE THIS FILE REFUSES, AND WHY EACH REFUSAL IS DIFFERENT.
--
--      firm_treasury. REFUSED BECAUSE THE CORPUS CONTRADICTS ITSELF ABOUT IT,
--        and this file measured the contradiction rather than picking a side.
--        FIVE documents call it the account where a cash movement books
--        (M05:141, ADR-027:48, ADR-033:20, ADR-067:77, 0038:48-49), which is an
--        asset. EVERY POSTING THE CORPUS WRITES AGAINST IT READS AS A LIABILITY
--        under the convention above, and they are unanimous:
--
--          LT-02 DEBITS it trader_cents at payout settlement (M05:131), when
--            cash LEAVES. A debit increases an asset, so under `asset` this
--            books cash arriving at the moment cash departs.
--          LT-06 CREDITS it amount_cents at withdrawal approval (M05:135). A
--            credit decreases an asset, so under `asset` this derecognizes cash
--            AT APPROVAL, which is the exact timing ADR-027, ADR-033, ADR-067
--            and 0038 each refused in turn on LT-01.
--          LT-07 DEBITS it at withdrawal settlement (M05:136), when cash leaves.
--            Backwards under `asset` for the same reason as LT-02.
--
--        Under `liability` all three read correctly and under `asset` all three
--        read backwards, while all five prose sites say asset. THE ARITHMETIC
--        IS UNANIMOUS ON ONE SIDE AND THE PROSE IS UNANIMOUS ON THE OTHER, and
--        that is a defect in the corpus rather than a gap in it. Writing either
--        literal here would harden one half against the other permanently.
--        ADR-177 section 3 records the measurement; ADR-174 section 3 named the
--        three repair shapes and each still needs this answer first.
--
--      psp_clearing. REFUSED FOR LACK OF A POSTING. Nothing in this tree posts
--        against it: session 157 recorded "ACCOUNTS EXIST, PATH DOES NOT" and
--        it is still true. The one statement of its nature is checkout.ts:1680,
--        that crediting it "would book a receivable from a processor that was
--        never asked for money". A receivable is an asset, but that sentence's
--        own verb is backwards for one -- crediting an asset reduces a
--        receivable, it does not book one -- so the sentence cannot be read as
--        a sign-checked derivation. It is the right instinct about a leg nobody
--        has posted, and it is not a chart.
--
--      reserve. REFUSED FOR LACK OF A POSTING AND FOR LACK OF A READER. Nothing
--        posts against it and nothing reads it: SD-M5-03 and INV-M5-11 anchor
--        the reserve figure to `treasury_balances`, deliberately OUTSIDE this
--        ledger, because "computing it from our own ledger makes it a number
--        that agrees with itself". GLOSSARY calls the reserve "funds set aside",
--        which is asset-shaped prose of exactly the kind that turned out to be
--        wrong for firm_treasury one row up.
--
--   3. THE CONSTRAINT HAS A HOLE IN IT AND THE HOLE IS THE POINT. ADR-174
--      finding 9 EXECUTED the fact that this database accepts firm_treasury as
--      'asset', as 'liability' and as 'revenue' in turn: `kind` is a five-member
--      CHECK ON THE ROW and nothing ties a kind to a code. This file ties four
--      of them and leaves three untied, so the CASE below ends in `ELSE true`.
--      A constraint that named all seven would be this file guessing with a
--      constraint wrapped round the guess. The session that settles
--      firm_treasury supersedes this constraint and moves a code out of the
--      hole; the hole is where the open question is stored, in the schema,
--      where the next session cannot miss it.
--
--   4. ONE ROW IS SEEDED AND THAT IS THE WHOLE OF WHAT A MIGRATION CAN SEED.
--      Of the seven codes, LEDGER_ACCOUNT_SCOPE makes four firm-scoped and
--      three per-identity. A migration cannot seed a per-identity account
--      because there are no identities, so the seedable set is the firm codes,
--      and of those four only fees_revenue has a settled kind. THE OTHER THREE
--      ARE UNSEEDABLE FOR A DIFFERENT REASON THAN THEY ARE UNRULED, and both
--      reasons are the same absence.
--
--      A PLAIN INSERT AND NOT `ON CONFLICT DO NOTHING`, because a silent skip is
--      the defect this session actually found: the CI probe seeds its own
--      fees_revenue row under ON CONFLICT DO NOTHING, and once this seed exists
--      that clause skips the row, leaves the probe's pinned uuid dangling and
--      stops LEDGER-C1 being probed at all. Migrations are forward-only and run
--      once; if this row already exists, something is wrong and the right
--      behaviour is to stop.
--
--   5. THIS FILE GRANTS AND REVOKES NOTHING, WHICH IS A DECISION AND NOT AN
--      OMISSION. merit_app holds SELECT, INSERT, UPDATE and DELETE on
--      ledger_accounts (measured on this tree), so the application role can
--      delete the seeded row or reclassify an account, and NOTHING IN THE
--      APPLICATION WRITES THIS TABLE AT ALL -- `LedgerReadKey` is a read key and
--      chart.ts only reads. REVOKE UPDATE, DELETE would therefore cost nothing
--      today and is what 0032, 0039, 0049 and 0051 each did on their own tables.
--      It is refused here because assert_append_only_grants.mjs asserts, in BOTH
--      directions, that the append-only set DATA_MODEL section 1 declares equals
--      the set the database installs. The revoke makes ledger_accounts
--      append-only by that gate's own definition, so it requires amending a
--      FROZEN document, which is an ADR and a slice of its own. ADR-177 section
--      6 records it. Widening this session's fence to reach it is the thing that
--      is not permitted.
--
--   6. NO NEW CODE, NO NEW COLUMN, NO NEW TABLE, NO TRIGGER. 0009's seven-code
--      vocabulary is unchanged and 0027's LEDGER-C2 is unchanged, so this file
--      does not touch the two statements ADR-027 was reversed over. 0009, 0027
--      and 0038 are byte for byte unchanged.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- ledger_accounts_kind_matches_code
-- -----------------------------------------------------------------------------
-- HEADER ITEMS 1 AND 3. `kind` is a five-member CHECK on the row and `code` is a
-- seven-member CHECK on the row, and nothing has ever related the two. This
-- relates the four that are derivable and deliberately leaves three open.
--
-- THE `ELSE true` IS LOAD BEARING AND IS NOT A DEFAULT. firm_treasury,
-- psp_clearing and reserve fall through it, and they fall through it because no
-- file in this tree states their kind. Header item 2 is the derivation of that
-- absence for each of the three separately.
ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_kind_matches_code CHECK (
    CASE code
      WHEN 'fees_revenue'        THEN kind = 'revenue'
      WHEN 'trader_wallet'       THEN kind = 'liability'
      WHEN 'trader_withdrawable' THEN kind = 'liability'
      WHEN 'promotional_credit'  THEN kind = 'liability'
      ELSE true
    END
  );

COMMENT ON CONSTRAINT ledger_accounts_kind_matches_code ON ledger_accounts IS
  'ADR-177. Binds kind to code for the four codes whose kind is derivable from '
  'a posting the corpus states. firm_treasury, psp_clearing and reserve fall '
  'through ELSE true because no file states their kind; the hole is where the '
  'open question is stored and a later migration supersedes this constraint.';

-- -----------------------------------------------------------------------------
-- THE SEED
-- -----------------------------------------------------------------------------
-- HEADER ITEM 4. One row, because one is the whole of what is both firm-scoped
-- and settled. It is written AFTER the constraint above deliberately, so that
-- the seed passes through the gate this file installs rather than around it.
--
-- `id` is left to gen_random_uuid(). Nothing resolves an account by uuid:
-- chart.ts joins on (code, scope, identity_id), which is what the two partial
-- unique indexes make unique, so a pinned literal here would be a constant that
-- looks meaningful and is not.
INSERT INTO ledger_accounts (code, kind, scope, identity_id)
  VALUES ('fees_revenue', 'revenue', 'firm', NULL);

COMMIT;
