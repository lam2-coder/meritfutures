-- =============================================================================
-- 0044_fee_back_and_ladder_unlock
-- =============================================================================
-- E2 READ: MONEY PATH. Two things here need the founder's line-by-line read and
-- they need it for different reasons.
--
--   THE IDEMPOTENCY INDEX. `promotional_credit_grants_fee_back_settlement_uq`
--   is the only thing standing between a retried settlement and a doubled
--   credit. A fee-back grant is issued BY a payout, so the write happens on the
--   settlement path, which is the path that retries.
--
--   THE LOCKED `repeats` FLAG. `plan_versions_fee_back_repeats_locked` pins a
--   column to one value on purpose. Section 3 below is the argument and it is
--   the part to read hardest, because dropping a named constraint is the only
--   way to unlock it and that is the property being bought.
--
-- ADR-070 (status: proposed, founder approval PENDING) rules the gaps. FOLD-05
-- sections 4.1 and 4.2 are the content. SD-M20-05 and SD-M18-04.
--
-- -----------------------------------------------------------------------------
-- 1. THIS FILE IS SMALLER THAN ITS RESERVATION, AND THE REASON IS NOT A DEFECT
-- -----------------------------------------------------------------------------
-- ALLOCATION reserved 0044 as `0044_plan_config_completeness.sql`, "the four
-- gaps as schema". THIS FILE CARRIES TWO OF THE FOUR.
--
--   GAP 3, the marketed size label, is M09's disclosure surface and M09 was
--   outside this session's fence. ADR-070 section 4 rules it and no schema here
--   anticipates it.
--
--   GAP 4, contract limits, CANNOT be written yet and ADR-070 says so in terms:
--   it rules OWNERSHIP ("Merit-owned configuration on the plan version") and
--   explicitly NOT transport, because M02 holds at `review` under ADR-005
--   pending the Rithmic vendor call. A column whose push path is unknown is a
--   column with no specification.
--
-- So gaps 3 and 4 need their OWN number, and the ALLOCATION row is amended in
-- the same branch so it does not read as already spent on them. That is 0041's
-- precedent, which was also smaller than its reservation, recorded the same way.
--
-- -----------------------------------------------------------------------------
-- 2. GAP 1 ADDS NO LEDGER CONCEPT, AND THAT IS THE POINT OF IT
-- -----------------------------------------------------------------------------
-- ADR-070 section 2 calls this the cheapest of the four gaps. Reading the tree
-- confirms it and goes one further: the fee-back credit needs no table.
--
--   THE CLASS EXISTS. `promotional_credit` is a ledger class in 0009, activated
--   by ADR-019, deliberately outside the withdrawable set.
--   THE GRANT TABLE EXISTS. `promotional_credit_grants` (0024, SD-M17-03) is
--   already identity-grained with an amount, an expiry, consumption, revocation
--   and a funding purchase for chargeback clawback.
--
-- SO "WITHDRAWABLE UNTIL EARNED" HOLDS BY CONSTRUCTION rather than by rule: the
-- credit posts into a class the withdrawable calculation does not read. No
-- invariant forbids the conversion because nothing can express it. ADR-070
-- section 2 states that as the reason the gap is cheap, and it is why this file
-- adds ONE COLUMN and ONE INDEX rather than a second grant table.
--
-- `funding_purchase_id` IS REUSED AND NOT DUPLICATED for the amount mode
-- "the evaluation fee actually paid". The evaluation purchase both determines
-- the amount and is what a chargeback claws back, which is the column's stated
-- purpose in 0024: "a credit needs to know what funded it, or a chargeback
-- cannot claw back the credit it paid for".
--
-- WHAT THE EXISTING `amount_cents > 0` CHECK DOES AND DOES NOT DO. It makes a
-- zero-value grant UNWRITABLE, so a fee-back configured to zero fails loudly
-- instead of writing a journal entry asserting that nothing happened. That is
-- the backstop and it is NOT GS-306, which requires that NOTHING POSTS. Zero is
-- not a configurable amount in `phase_funded.fee_back`; it is `enabled: false`.
-- The rule not firing is the specification; the CHECK is what catches the day
-- somebody configures zero anyway.
--
-- -----------------------------------------------------------------------------
-- 3. `repeats` SHIPS LOCKED TO FALSE, AND THIS IS THE MOST CONSEQUENTIAL LINE
--    IN THE FILE
-- -----------------------------------------------------------------------------
-- M20 AS-M20-01 is promotional-credit farming: accumulate credit, spend it on
-- an evaluation, pass, take a payout, withdraw. Five legitimate steps and every
-- ledger entry correct along the way. Its counter #5 is the one that bounds it:
--
--   "The promotional budget is capped per identity and per resolved entity,
--    which is M17's issuance discipline, and it is the upstream control that
--    makes this bounded regardless of the conversion rate."
--
-- A FEE-BACK CREDIT IS ISSUED BY A PAYOUT, BY THE PLAN VERSION, NOT THROUGH
-- M17'S ISSUANCE PATH. So it is outside the only control that bounds every
-- other credit source. With `repeats: true` the chain closes on itself: credit
-- funds an evaluation, the evaluation funds a payout, the payout issues credit.
-- Under zero denial (M05 INV-M5-01) that is a liability with no cap and no
-- owner, and AS-M14-02 already records that a hedged pair earns the streak side
-- of this by construction.
--
-- THE CONSTRAINT IS THE RULING'S TEETH AND A CONVENTION WOULD NOT BE. Filing
-- this as an open question alone would leave a config field that can be set to
-- `true` before anybody has ruled on it, and this corpus's own record is that a
-- control which depends on nobody setting a writable flag is not a control.
--
-- So `true` is UNWRITABLE, by a CHECK with a name that says what removing it
-- means. The day M17's issuance cap demonstrably covers plan-version-issued
-- credits, unlocking this is a migration that drops one named constraint, which
-- is an auditable event with a date and an author. That is the property being
-- bought: not that repeats is off, but that turning it on cannot happen quietly.
--
-- The column exists rather than being omitted BECAUSE omitting it would make
-- `repeats` an unrecorded concept that a later session could add with no trace
-- of the argument above. A locked column carries its own history.
--
-- OQ-M20-06 asks WHEN it may be unlocked. It does not ask whether it should
-- have been locked.
--
-- -----------------------------------------------------------------------------
-- 4. GAP 2 ANSWERS OQ-F5-03 BY WHICH TABLE THE KEY POINTS AT
-- -----------------------------------------------------------------------------
-- ADR-070 section 3: "an unlock reads the HARD-MERGED identity and nothing
-- weaker. A soft-linked pair does not share an unlock." M07:94 is the source:
-- "only a hard merge changes what a trader may buy."
--
-- THE SCHEMA ALREADY MAKES THAT STRUCTURAL AND NO FILTER IS NEEDED. A hard
-- merge REPOINTS OWNERSHIP into the surviving `identities` row and records an
-- `identity_merges` row (0002); `identity_links` carries soft and hard-link
-- edges with a confidence and repoints NOTHING. So `identities.id` IS the
-- hard-merged grain, and an FK to it is the ruling expressed in DDL.
--
-- A soft-linked pair sharing an unlock is therefore UNREPRESENTABLE rather than
-- forbidden: there is no column here that could hold a link, and no read behind
-- this table joins `identity_links`. That is the difference between a rule
-- somebody has to remember and a shape that cannot express the mistake.
--
-- WHY NOT REUSE THE TWO BENEFIT TABLES THAT ALREADY EXIST, since declining to
-- reuse needs the argument rather than the assertion:
--
--   loyalty_benefit_grants (0023)  is the structure INV-M14-11 and INV-M14-12
--     exist to keep inert: "no loyalty mechanic moves a per-account bound" and
--     "cross-account loyalty confers no rule difference". An unlock is earned on
--     ONE account under ONE plan version, not from cross-account loyalty
--     criteria, and filing a purchase entitlement in there puts it inside the
--     fence those two invariants draw.
--
--   graduation_benefits (0023)  carries `accrued_cents bigint NOT NULL` and
--     `basis text NOT NULL`. An unlock has no cents, so it would land as
--     `accrued_cents = 0` with a basis explaining that it is not money. That is
--     the zero-value-row defect GS-306 exists to prevent, one table over.
--
-- INV-M18-07 SAYS "GRADUATION CONFERS NO RULE CHANGE ON ANY ACCOUNT" AND THIS
-- TABLE DOES NOT VIOLATE IT. An unlock changes WHICH `plan_version_sizes` ROW
-- THE IDENTITY MAY PURCHASE. The account opened against it gets that plan
-- version's published rules like everyone, which is INV-M18-07's own
-- enforcement note. No rule parameter moves on any account, and the mechanical
-- form of that claim is asserted in packages/db/test/plan-size-unlocks.test.ts
-- rather than argued here: this table has NOWHERE TO PUT a rule parameter.
--
-- "A LARGER RUNWAY" IN ADR-070 SECTION 3 IS A MARKETED LABEL, NOT A RULE
-- PARAMETER. GS-309 reads "a plan marketed under a runway label", and every
-- other use of the word in this corpus is the calendar's coverage runway. So
-- nothing in gap 2 touches drawdown, buffer or any other scalar.
--
-- -----------------------------------------------------------------------------
-- 5. THE LADDER KEY IS `phase_funded.max_payouts`
-- -----------------------------------------------------------------------------
-- ADR-030 ruled it and 0004:66 states it as load bearing:
-- `ladder.payouts_to_graduate` is the SUPERSEDED name (GLOSSARY:204 says so in
-- those words). validate.ts:218 and settle.ts:197 both read `max_payouts`, and
-- settle.ts:197's `payoutsSettledCount >= plan.funded.maxPayouts` is exactly the
-- expression G-LADDER-COMPLETE names and exactly the trigger for this unlock.
--
-- The superseded name still stands in M01's CV-14 and R-49, in
-- STATE_MACHINES:400's own statement of G-LADDER-COMPLETE, in ADR-070:51 and in
-- FOLD-05:102. Those are outside this fence and are named in the pull request
-- with an owner each. M18's two sites are inside it and are corrected.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- SD-M20-05  the fee-back credit
-- -----------------------------------------------------------------------------

-- WHICH SETTLEMENT PRODUCED THIS GRANT. Neither existing source column can say
-- it: `source_offer_id` names an offer and `funding_purchase_id` names the
-- purchase that funded the credit. A fee-back grant needs both facts and they
-- are different rows.
--
-- NULLABLE because every grant M17 issues has no settlement, which is the
-- normal case and stays the normal case.
ALTER TABLE promotional_credit_grants
  ADD COLUMN source_payout_request_id uuid NULL
    REFERENCES payout_requests(id) ON DELETE RESTRICT;

COMMENT ON COLUMN promotional_credit_grants.source_payout_request_id IS
  'SD-M20-05. The settled payout that triggered a fee-back credit. NULL on '
  'every offer-issued grant. Populated only by the fee-back rule.';

-- THE MONEY CONTROL. One fee-back grant per settlement, enforced by the
-- database rather than by the settlement path being careful.
--
-- A settlement that retries after a partial failure is the ordinary shape of
-- this write, not an exotic one, and without this index the second attempt
-- credits the identity twice. `promotional_credit` is spendable at checkout, so
-- a doubled grant is a doubled discount against real revenue.
CREATE UNIQUE INDEX promotional_credit_grants_fee_back_settlement_uq
  ON promotional_credit_grants (source_payout_request_id)
  WHERE source_payout_request_id IS NOT NULL;

-- The materialized half of `phase_funded.fee_back.repeats`, on 0004:183's own
-- pattern: "a CHECK constraint cannot read another table ... the flag is
-- MATERIALIZED here alongside every other value this table materializes at
-- publish, and CV-publish validation asserts the materialized flag matches the
-- parent's jsonb". Section 3 above is why the CHECK pins it.
ALTER TABLE plan_versions
  ADD COLUMN fee_back_repeats boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN plan_versions.fee_back_repeats IS
  'SD-M20-05. Materialized from phase_funded.fee_back.repeats at publish. '
  'LOCKED to false: see plan_versions_fee_back_repeats_locked.';

-- DROPPING THIS CONSTRAINT IS THE ONLY WAY TO SHIP A REPEATING FEE-BACK, and
-- that is deliberate. It may be dropped when M17's per-identity issuance cap
-- demonstrably covers plan-version-issued credits, and not before. OQ-M20-06.
ALTER TABLE plan_versions
  ADD CONSTRAINT plan_versions_fee_back_repeats_locked
    CHECK (fee_back_repeats = false);

-- -----------------------------------------------------------------------------
-- SD-M18-04  the ladder unlock
-- -----------------------------------------------------------------------------
-- One row per (identity, plan version, unlocked size). The row IS the
-- entitlement; there is no state machine and no cents.
CREATE TABLE plan_size_unlocks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ADR-070 section 3, in DDL. `identities.id` is the hard-merged grain because
  -- a merge repoints ownership into this row. Nothing here reaches
  -- identity_links, so a soft-linked pair cannot share an unlock.
  identity_id         uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- The unlock is PER PLAN VERSION. An entitlement earned under one published
  -- rule set does not silently carry into the next one, which is the same
  -- reasoning that makes a version immutable once published.
  plan_version_id     uuid NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,

  -- WHAT MAY NOW BE PURCHASED, and the only value this table confers. It names
  -- a plan_version_sizes.size_cents; it is not a foreign key to that row
  -- because the entitlement is to the SIZE, and a version publishing the same
  -- size again should honour an unlock earned against it.
  unlocked_size_cents bigint NOT NULL CHECK (unlocked_size_cents > 0),

  -- The account whose ladder completed. The evidence for the entitlement, and
  -- what a dispute is argued from.
  earned_account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  earned_at           timestamptz NOT NULL DEFAULT now(),

  revoked_at          timestamptz NULL,
  revoked_reason      text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- A revocation without a reason is a disappearance. graduation_benefits'
  -- withheld_reason makes the same argument one table over.
  CONSTRAINT plan_size_unlocks_revocation_is_explained CHECK (
    revoked_at IS NULL OR revoked_reason IS NOT NULL
  )
);

-- An identity earns a given size once per plan version. Two completed ladders
-- do not stack into two entitlements to the same size, and a retried grant
-- write fails rather than duplicating.
CREATE UNIQUE INDEX plan_size_unlocks_identity_version_size_uq
  ON plan_size_unlocks (identity_id, plan_version_id, unlocked_size_cents);

-- The purchase path's read: what this identity may buy, right now.
CREATE INDEX plan_size_unlocks_live_idx
  ON plan_size_unlocks (identity_id, plan_version_id)
  WHERE revoked_at IS NULL;

-- The evidence read, and the sweep if an account's ladder is ever unwound.
CREATE INDEX plan_size_unlocks_earned_account_idx
  ON plan_size_unlocks (earned_account_id);

COMMENT ON TABLE plan_size_unlocks IS
  'SD-M18-04. A purchase entitlement earned by completing a ladder, per '
  'ADR-070 section 3. Keyed to the hard-merged identity. Confers no rule '
  'change on any account (INV-M18-07, INV-M18-12): it changes only which '
  'plan_version_sizes row may be purchased. Retention: forever.';

COMMIT;
