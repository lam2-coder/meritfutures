-- =============================================================================
-- 0074_firm_parameters
-- =============================================================================
-- E2 READ: MONEY PATH. This file gives the base account cap a row, and the cap
-- is the FIRST decision `POST /checkout` makes on both of its paths. A number
-- that decides who may buy an account is the number that decides how much of
-- the firm's tail risk a single buyer may accumulate, so a reviewer reading
-- this file is reading a limit on exposure rather than a settings table.
--
-- Two things need the founder's line-by-line read:
--
--   1. THE VOCABULARY IS CLOSED IN THE DDL AND CLOSED AGAIN BY THE COLUMN TYPE.
--      `firm_parameters_vocabulary_is_closed` admits exactly one member today.
--      A firm parameter table is the thing that grows into a settings bag
--      nobody can reason about, and the two closures below are what stop it:
--      a member that is not in the CHECK cannot be written, and a member whose
--      value is not an integer has nowhere to go, because this table declares
--      one value column and it is `integer`. Widening either is an ADR plus a
--      superseding migration, on `operators.role`'s precedent (0073) and
--      `SystemReason`'s (ADR-126: the vocabulary that moves is the TABLE and
--      never the REASON).
--
--   2. THE TABLE SHIPS EMPTY AND THAT IS THE CONTROL RATHER THAN AN OMISSION.
--      There is no seed row, no DDL default and no fallback anywhere in this
--      file. A cap is a launch candidate re-confirmed at launch as a config
--      row and never a constant, so a number written here today would be a
--      number this session invented. An implementation that finds no effective
--      row therefore finds NO CAP, and no cap is not an unlimited one: a
--      reader that folds an absent row into `Infinity` has built a control
--      that answers yes to everybody, on the endpoint that sells accounts.
--      Nothing in this repository reads this table yet, and ADR-252 refuses to
--      wire one so that the refusal is written once, by the slice that owns it.
--
-- ADR-252 (status: proposed, founder approval PENDING) is the ruling, and
-- ADR-238 ruling 1 is the decision it builds. NOTHING HERE IS SIGNED.
--
-- -----------------------------------------------------------------------------
-- WHAT WAS MISSING, MEASURED RATHER THAN ASSERTED
-- -----------------------------------------------------------------------------
-- Before this file, `grep -rn max_accounts packages/db/migrations` returned ONE
-- line and it was `identities.max_accounts_override` (0002:47), the per-entity
-- EXCEPTION. There was no row anywhere holding the cap that column is an
-- exception TO. The corpus states the value at
-- `plan_versions.rules.limits.max_accounts_per_entity`, inside a per-plan-version
-- jsonb blob, and ADR-238 ruling 1 refuses that home in all three of its
-- available forms: the cap is enforced against an identity's TOTAL live accounts
-- across every plan (constitution B1, INV-M3-08, GS-094), so reading the
-- purchased version makes an identity's effective cap the MAXIMUM over every
-- published version, reading the pinned version on the reset path reads a row
-- that may have been retired years earlier, and requiring every published
-- version to agree is a firm parameter wearing a plan's costume that no CHECK
-- can express, because a CHECK cannot read another row.
--
-- -----------------------------------------------------------------------------
-- THE SHAPE IS `price_floors`' AND THE PRECEDENT IS AN EXACT ONE
-- -----------------------------------------------------------------------------
-- `price_floors` (0024) is the firm's own number with no identity column and no
-- correct one, keyed `(product_ref, effective_from)`, superseded by a new row
-- rather than updated, carrying a written reason and an approver. A cap that
-- decides who is REFUSED a purchase is the same class of number as a floor that
-- decides what a price may not go below: it is the firm's, it is versioned, it
-- is approved by a person, and its history has to be quotable, because
-- INV-M3-08's refusal is a 409 a buyer will ask about.
--
-- ONE THING IS TIGHTER THAN THE PRECEDENT AND IT IS TIGHTER BECAUSE 0073 LANDED.
-- `price_floors.product_ref` is bare text with no CHECK on either side of the
-- clamp, and `price_floors.approved_by` is bare text on 0002's actor idiom
-- because no operator directory existed when it was written. One migration ago
-- it started existing. So `approved_by` here is a foreign key to
-- `operators(actor)` and a cap approved by nobody is UNWRITABLE rather than
-- merely undesirable, which is 0073's own control applied to the row that sets
-- a limit instead of to the row that records an act.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE IS NOT
-- -----------------------------------------------------------------------------
-- IT IS NOT AN ENVIRONMENT VARIABLE'S REPLACEMENT AND NEVER WAS ONE.
-- ADR-238 ruling 4: ADR-226 and ADR-229 admit a deployment-supplied value where
-- the value is a SECRET this repository must not hold. A cap is quoted back to
-- the buyer in the refusal body and an operator has to be able to see it, change
-- it and be recorded as having changed it. A purchase refused by a number no row
-- records is a refusal nobody can reconstruct.
--
-- IT IS NOT A LOGIN, A CREDENTIAL OR A SECRET. There is no password column and
-- no key material in this file. Merit is passwordless by ADR-039 and 0002:280
-- states it for the whole schema.
--
-- IT DOES NOT TOUCH `identities.max_accounts_override`. 0002 is merged and is
-- never edited (constitution E2). The override stays exactly what its own name
-- says it is: the per-entity exception, folded over the base by whichever slice
-- comes to read both.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. firm_parameters
-- -----------------------------------------------------------------------------
-- ONE ROW PER (PARAMETER, EFFECTIVE DATE). A change is a new row and never an
-- UPDATE, so the number in force on the day a purchase was refused stays
-- readable after the number has moved.
CREATE TABLE firm_parameters (
  -- THE CLOSED VOCABULARY. `price_floors.product_ref` is bare text and this
  -- column deliberately is not: a product reference names a thing the catalogue
  -- already constrains, while a parameter NAME constrains nothing but itself, so
  -- an unchecked one is a configuration file wearing a primary key. The
  -- constraint is declared at the foot of the table with a name, so that adding
  -- a member is visible in `pg_constraint` rather than only in a diff.
  parameter       text NOT NULL,

  -- THE VALUE, AND ITS TYPE IS PART OF THE VOCABULARY.
  -- Integer, because a cap is a COUNT of accounts and `identities
  -- .max_accounts_override` is `integer` one table over; comparing a count
  -- against a differently typed base is how the two halves of one number stop
  -- agreeing. There is no `text_value`, no `cents_value` and no `jsonb_value`
  -- beside it ON PURPOSE: a firm parameter that is not an integer belongs in a
  -- table of its own, and adding a second value column here is the first step
  -- of the settings bag this file exists to refuse. NO DEFAULT: a default is a
  -- constant, and the corpus is explicit that these values are a launch
  -- candidate re-confirmed at launch and never a constant.
  integer_value   integer NOT NULL,

  -- NOT NULL. A cap is a LIABILITY decision -- it bounds how much exposure one
  -- buyer may accumulate -- and a liability decision with no written rationale
  -- is one nobody can defend at the next review. `price_floors.reason` carries
  -- the same sentence for the same reason.
  reason          text NOT NULL,

  -- WHEN IT STARTS BINDING. A row dated in the future has not arrived and does
  -- not bind yet, which is `wallet_spend_limits`' idiom (0011) one class over.
  effective_from  timestamptz NOT NULL,

  -- THE APPROVER, AND IT IS A REFERENT RATHER THAN A STRING.
  -- `price_floors.approved_by` is bare `text` because 0073 did not exist when
  -- 0024 was written. It does now, so this column resolves: a cap approved by a
  -- name in no directory cannot be written at all.
  --
  -- ON UPDATE RESTRICT AND NOT CASCADE, which is 0073's own ruling on
  -- `admin_actions.actor`: a cascade would rewrite who approved a number that
  -- was in force in the past, and an approval is a historical fact rather than a
  -- pointer at whoever holds the seat today. ON DELETE RESTRICT for the same
  -- reason in the other direction: an operator who has approved a firm parameter
  -- can be suspended (`operators.status`) and can never be deleted out from
  -- under the number they approved.
  approved_by     text NOT NULL
                    REFERENCES operators(actor) ON UPDATE RESTRICT ON DELETE RESTRICT,

  created_at      timestamptz NOT NULL DEFAULT now(),

  -- THE GRAIN, AND IT IS THE WHOLE PRIMARY KEY. The table has no uuid of its
  -- own, which is `price_floors`' shape exactly. Two rows for one parameter at
  -- one instant would make "which number was in force" ambiguous, and the
  -- primary key is what makes that unrepresentable.
  PRIMARY KEY (parameter, effective_from),

  -- ---------------------------------------------------------------------------
  -- THE VOCABULARY, CLOSED AT THE DATABASE
  -- ---------------------------------------------------------------------------
  -- ONE MEMBER. `base_account_cap` is the number INV-M3-08 enforces per resolved
  -- identity, over that identity's live accounts across EVERY plan, and it is
  -- the number `identities.max_accounts_override` is an exception to.
  --
  -- A CHECK RATHER THAN AN ENUM TYPE, on 0043's precedent for `initiative` and
  -- 0073's for `role`: an enum label cannot be removed, and a parameter set is
  -- exactly the vocabulary a later ruling narrows.
  --
  -- A SECOND MEMBER IS AN ADR AND A SUPERSEDING MIGRATION, not an edit to this
  -- file. `packages/db/test/firm-parameter-vocabulary.test.ts` reads this list
  -- on every run and refuses a member that arrives on one side alone.
  CONSTRAINT firm_parameters_vocabulary_is_closed CHECK (
    parameter IN ('base_account_cap')
  ),

  -- THE BOUND BELONGS TO THE PARAMETER AND NOT TO THE COLUMN, which is the same
  -- reasoning that closes the vocabulary. A cap of zero is not a cap, it is a
  -- firm-wide sales halt written in the wrong place, and it would refuse every
  -- buyer through a control whose refusal body quotes a limit of nothing.
  -- `identities.max_accounts_override` carries `CHECK (> 0)` for the same reason
  -- and the exception and the base agree on their domain.
  --
  -- A LATER MEMBER WITH A DIFFERENT DOMAIN GETS ITS OWN DISJUNCT here rather
  -- than loosening this one, so no future parameter can widen the cap's bound as
  -- a side effect of arriving.
  CONSTRAINT firm_parameters_base_account_cap_is_positive CHECK (
    parameter <> 'base_account_cap' OR integer_value > 0
  )
);

-- The read every consumer will make: the latest row for one parameter whose
-- `effective_from` has arrived. DESC because that read is `ORDER BY
-- effective_from DESC LIMIT 1`, which is `price_floors_current_idx`'s shape.
CREATE INDEX firm_parameters_current_idx
  ON firm_parameters (parameter, effective_from DESC);

COMMENT ON TABLE firm_parameters IS
  'ADR-252, on ADR-238 ruling 1. Integer-valued parameters that belong to the '
  'FIRM rather than to any identity or any plan version. Superseded by a new '
  'row rather than updated. THE VOCABULARY IS CLOSED BY '
  'firm_parameters_vocabulary_is_closed AND THE VALUE TYPE CLOSES IT AGAIN: a '
  'parameter that is not an integer belongs in another table, and a second '
  'value column here is the first step of a settings bag. SHIPS EMPTY: a cap '
  'is a launch candidate confirmed at launch as a row, so no seed and no '
  'default exists, and an absent row is NO CAP rather than an unlimited one.';

COMMENT ON COLUMN firm_parameters.parameter IS
  'ADR-252. Closed at the database. Adding a member is an ADR plus a '
  'superseding migration, on operators.role''s precedent (0073).';

COMMENT ON COLUMN firm_parameters.integer_value IS
  'ADR-252. A count, not cents. For base_account_cap this is the number of live '
  'accounts one resolved identity may hold across EVERY plan (INV-M3-08), which '
  'identities.max_accounts_override is the per-entity exception to.';

COMMIT;
