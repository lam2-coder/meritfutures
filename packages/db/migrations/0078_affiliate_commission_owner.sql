-- =============================================================================
-- 0078_affiliate_commission_owner
-- =============================================================================
-- E2 READ: MONEY PATH. `affiliate_commissions.amount_cents` is SIGNED money
-- Merit owes a named affiliate, and until this file the table named no
-- affiliate. Every part below decides WHOSE money a commission row is, and the
-- second one decides it in a way a writer cannot get wrong later.
--
-- ADR-321 (status: proposed, founder approval PENDING) is the ruling that lands
-- it. It spends `0078`, which ADR-304 reserved and deliberately did not write.
-- NOTHING HERE IS SIGNED.
--
-- -----------------------------------------------------------------------------
-- WHAT WAS MISSING, AND IT IS ONE COLUMN ON ONE OF FOUR TABLES
-- -----------------------------------------------------------------------------
-- Three tables on the affiliate settlement rail declare the identical edge,
-- character for character:
--
--   affiliate_creatives.affiliate_id    0005:106
--   affiliate_clicks.affiliate_id       0005:158
--   affiliate_statements.affiliate_id   0012:136
--
--     affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT
--
-- All three are registered `derived` via `affiliates` on that column, and all
-- three were registered WITH NO RULING AT ALL, because the DDL settles the
-- class. `affiliate_commissions` (0012:159) is the fourth table on that rail and
-- is the ONLY ONE DECLARING NONE, which is the whole of why it is unregistrable:
-- its single path to an identity is `attribution_id` into `attributions`, which
-- is `pair`, so a `derived` rule through it COMPILES and then THROWS.
--
-- ADR-253 section 6 left open whether a SEVENTH scope class was the repair.
-- ADR-304 answered no and said what the repair is instead. This file is it.
--
-- -----------------------------------------------------------------------------
-- `0012` IS MERGED AND IS SUPERSEDED BY ADDITION FROM OUTSIDE IT
-- -----------------------------------------------------------------------------
-- Constitution E2: a migration is sacred once merged, never edited, only
-- superseded. NO LINE OF `0012` IS TOUCHED. That is `0028`'s, `0048`'s,
-- `0068`'s, `0070`'s, `0072`'s, `0073`'s and `0076`'s mechanism on this estate,
-- and it is why the column arrives as an `ALTER TABLE` rather than in a
-- `CREATE TABLE` body it can never be written into.
--
-- -----------------------------------------------------------------------------
-- THE THREE PARTS, AND EACH IS SEPARATELY REJECTABLE
-- -----------------------------------------------------------------------------
-- Written as parts on `0048`'s, `0033`'s and `0076`'s precedent. Rejecting any
-- one leaves the others standing, and ADR-321 names what each costs.
--
--   1. `affiliate_commissions.affiliate_id`, NOT NULL, NO DEFAULT.
--   2. The agreement constraint: `UNIQUE (id, affiliate_id)` on `attributions`
--      so a composite edge has something to name, then the composite foreign
--      key that makes a disagreeing commission unwritable.
--   3. `affiliate_commissions_affiliate_status_idx (affiliate_id, status)`, the
--      shape of the three per-affiliate sums `GET /affiliate/stats` reads.
--
-- -----------------------------------------------------------------------------
-- NO BACKFILL, AND THE MEASUREMENT THAT MAKES A `NOT NULL` COLUMN SAFE
-- -----------------------------------------------------------------------------
-- NOTHING IN ANY `src/` TREE WRITES AN `affiliate_commissions` ROW. Re-derived
-- on the commit that writes this file rather than carried forward from ADR-304:
-- 296 `.ts` files under 17 `apps/*/src` and `packages/*/src` roots, read with
-- comments stripped by `packages/tooling/checks/strip-comments.mjs`, contain no
-- `affiliateCommissions` identifier and no `INSERT INTO`, `UPDATE` or
-- `DELETE FROM affiliate_commissions`. The name survives the strip at exactly
-- two sites, `apps/api/src/routes/affiliate.ts` and `packages/db/src/scope.ts`,
-- and both are refusal or `why` strings. `packages/affiliate/src/attribution.ts`
-- says the same in its own words: P3 writes the attribution and no commission,
-- and the commission clock is P5's and unbuilt.
--
-- So the table is empty in every environment this tree can produce, and a
-- `NOT NULL` column with no `DEFAULT` needs no data migration.
--
-- THIS FILE FAILS ON A DEPLOYMENT THAT ALREADY HOLDS A COMMISSION ROW, ON
-- PURPOSE. It was written outside every path this repository has, and a
-- migration that back-filled it would be choosing an affiliate for money Merit
-- owes somebody. The remedy is to delete the row and write it again once the
-- commission clock exists, or to supersede this file.
--
-- -----------------------------------------------------------------------------
-- WHY THERE IS NO `DEFAULT`, STATED AS A CONTROL RATHER THAN A PREFERENCE
-- -----------------------------------------------------------------------------
-- A default on this column is a WRONG AFFILIATE waiting for the first writer
-- that forgets it. Every other column on this rail that decides whose money a
-- row is carries none, and the failure this refuses is the one `0049`'s
-- `funded_accounts` refuses one table over: a number nobody supplied, rendered
-- as though somebody had.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- -----------------------------------------------------------------------------
-- IT WRITES NO ROW AND SEEDS NOTHING. No commission, no attribution, no
-- affiliate. The commission clock is P5's and is unbuilt, and this file makes
-- its first row WRITABLE and CORRECT rather than writing one.
--
-- IT CHANGES NO GRANT. `0026:174` already grants `merit_app` DML on this table
-- and adding a column moves nothing; whether `affiliate_commissions` belongs in
-- the append-only set is `OI-03`'s question against a document this file does
-- not hold.
--
-- IT DOES NOT REMOVE `affiliate_commissions_attribution_idx`. `0012` declares it
-- and `0012` is not edited. Part 2's composite key makes `(attribution_id,
-- affiliate_id)` an addressable pair; it does not make the single-column index
-- redundant to a planner reading the attribution alone, and dropping an index a
-- merged migration declared is a supersession this row does not take.
--
-- IT REGISTERS NOTHING. The `schema.ts` declaration and the `derived` rule name
-- a column and the suite reads the DDL, so both land AFTER this file in the same
-- pull request and never before it. ADR-304 section 4 clause 5 is that ordering
-- and it cannot be inverted.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. THE COLUMN THAT MAKES A COMMISSION REGISTRABLE
-- -----------------------------------------------------------------------------
-- The three siblings' declaration, character for character. `ON DELETE RESTRICT`
-- for their reason and for `affiliate_statements`': an affiliate row that money
-- is owed against cannot be deleted out from under the record of the debt.
--
-- NOT NULL WITH NO DEFAULT. See the header. The table is empty everywhere, so
-- the `NOT NULL` costs nothing today and refuses the first writer that omits the
-- column, which is the only moment it can ever be enforced cheaply.
ALTER TABLE affiliate_commissions
  ADD COLUMN affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT;

COMMENT ON COLUMN affiliate_commissions.affiliate_id IS
  'ADR-321, on ADR-304 section 4. WHOSE MONEY THIS ROW IS. amount_cents is '
  'signed money Merit owes a named affiliate and this table named no affiliate '
  'until 0078; affiliate_creatives, affiliate_clicks and affiliate_statements '
  'each declare this exact column and are each registered derived via '
  'affiliates on it. NOT NULL with NO DEFAULT: a default here is a wrong '
  'affiliate waiting for the first writer that forgets the column. It is '
  'DENORMALIZED from attributions.affiliate_id and cannot disagree with it, '
  'because affiliate_commissions_attribution_owner_fk names the pair.';

-- -----------------------------------------------------------------------------
-- 2. THE AGREEMENT CONSTRAINT, AND IT IS NOT OPTIONAL
-- -----------------------------------------------------------------------------
-- Part 1 alone denormalizes a tenancy: the same fact is now on two rows, and two
-- rows that can disagree about who is owed money is a COMMISSION PAID TO THE
-- WRONG AFFILIATE. That objection was the seventh scope class's strongest
-- remaining argument, and it is closable by the database rather than by care.
--
-- The unique below is REDUNDANT FOR UNIQUENESS against `attributions`' primary
-- key and exists for one reason: PostgreSQL requires a composite foreign key to
-- name a unique constraint over exactly the referenced columns, and a primary
-- key on `id` alone is not one. Nothing about the grain of `attributions`
-- changes and its primary key is untouched.
--
-- THE IDIOM IS ALREADY IN THIS ESTATE AND IS COPIED RATHER THAN INVENTED:
-- `reserve_coverage_snapshots_anchor_fk` (0049) is a composite foreign key
-- naming `treasury_balances (account_code, as_of)`. A second spelling of one
-- construction is how two constructions come to exist.
ALTER TABLE attributions
  ADD CONSTRAINT attributions_id_affiliate_uq UNIQUE (id, affiliate_id);

COMMENT ON CONSTRAINT attributions_id_affiliate_uq ON attributions IS
  'ADR-321. REDUNDANT FOR UNIQUENESS AND NECESSARY FOR REFERENCE. The primary '
  'key on id already makes this pair unique; a composite foreign key must name '
  'a unique constraint over exactly its referenced columns, so without this '
  'affiliate_commissions_attribution_owner_fk cannot be declared at all. The '
  'grain of this table is unchanged.';

-- Under this constraint a commission whose `affiliate_id` differs from its
-- attribution's cannot be INSERTed, cannot be UPDATEd into existence, and cannot
-- be created by moving the attribution underneath it: the reference is to the
-- PAIR, so an `UPDATE attributions SET affiliate_id = ...` that would break an
-- existing commission's pair is refused by this constraint as well.
--
-- `ON DELETE RESTRICT` is `0049`'s anchor and `0012`'s own single-column edge on
-- this table, said once more on the pair.
ALTER TABLE affiliate_commissions
  ADD CONSTRAINT affiliate_commissions_attribution_owner_fk
    FOREIGN KEY (attribution_id, affiliate_id)
    REFERENCES attributions (id, affiliate_id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT affiliate_commissions_attribution_owner_fk
  ON affiliate_commissions IS
  'ADR-321, on ADR-304 section 4 clause 2. THE DENORMALIZED AFFILIATE MAY NOT '
  'DISAGREE WITH THE ATTRIBUTION IT WAS DERIVED FROM. A commission that names '
  'one affiliate against an attribution naming another is a commission paid to '
  'the wrong affiliate, and this refuses it at the database rather than in a '
  'writer nobody has written yet. reserve_coverage_snapshots_anchor_fk (0049) '
  'is the same idiom.';

-- -----------------------------------------------------------------------------
-- 3. THE READ SHAPE
-- -----------------------------------------------------------------------------
-- `GET /affiliate/stats` renders `earned_cents_lifetime`, `payable_cents` and
-- `paid_cents_lifetime` (API_CONTRACT section 7), which are three sums over this
-- table for one affiliate, partitioned by `status`. `0012` declares four indexes
-- here and NOT ONE is keyed on an affiliate, because until this migration there
-- was nothing to key on.
--
-- `(affiliate_id, status)` AND NOT THE REVERSE. The affiliate is the equality
-- predicate every one of the three reads carries and `status` is what separates
-- them, which is `affiliate_clicks_affiliate_time_idx`'s ordering one table over.
CREATE INDEX affiliate_commissions_affiliate_status_idx
  ON affiliate_commissions (affiliate_id, status);

COMMIT;
