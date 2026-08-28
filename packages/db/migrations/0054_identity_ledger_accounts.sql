-- =============================================================================
-- 0054_identity_ledger_accounts
-- =============================================================================
-- E2 READ: MONEY PATH. ADR-183, status: proposed, founder approval PENDING.
--
-- AN IDENTITY GETS ITS THREE LEDGER POSITIONS WHEN IT COMES INTO EXISTENCE,
-- AND THE DATABASE IS WHAT GIVES THEM.
--
-- Nothing in this tree has ever created a ledger account for an identity.
-- 0009 declared three per-identity classes, 0052 and 0053 seeded the two FIRM
-- rows, and the per-identity rows were left to a mechanism nobody wrote. The
-- consequence is not theoretical and it is not confined to unbuilt modules:
-- apps/api/src/routes/payouts.ts:811-812 builds LT-01 out of
-- identityAccount('trader_withdrawable') and identityAccount('trader_wallet'),
-- apps/api/src/routes/checkout.ts:1703 builds LT-08 out of
-- identityAccount('trader_wallet'), and both reach postTransaction on a live
-- request path (admin-payouts.ts:1190, checkout.ts:1958). Both throw at
-- chart.ts's `resolve` today, on every identity that has ever existed.
--
-- -----------------------------------------------------------------------------
-- WHY THE DATABASE AND NOT THE APPLICATION
-- -----------------------------------------------------------------------------
-- ADR-183 rules the mechanism and section 3 is the argument. The short form:
-- provisioning in application code is where every other control in this corpus
-- lives, and it is refused here because THE PATH DOES NOT EXIST. No TypeScript
-- file in apps/ or packages/ inserts into `identities` at all, so a ruling
-- placed there would be a ruling written against an absence, and the day it
-- was written the finding it exists to repair would still be true.
--
-- A trigger makes provisioning coextensive with the identity's existence.
-- There is no path that creates an identity and skips it, because there is no
-- path at all: the row is what fires it, whatever writes the row.
--
-- -----------------------------------------------------------------------------
-- THE COST, STATED WHERE IT IS PAID
-- -----------------------------------------------------------------------------
-- THIS IS THE FIRST TRIGGER IN THIS SCHEMA THAT WRITES. Measured from the
-- catalog rather than from a grep: 21 non-internal triggers over 19 distinct
-- functions before this file, and NOT ONE function body contains an INSERT, an
-- UPDATE or a DELETE. The two that match the word `UPDATE` match it inside an
-- error-message string. Every existing trigger asserts and refuses; this one
-- makes a row appear that no statement asked for.
--
-- That is a real precedent and ADR-183 section 5 does not pretend otherwise.
-- What it rests on is that the alternative is not "the same guarantee somewhere
-- safer", it is "no guarantee until a file that does not exist is written".
--
-- SECOND COST: THIS IS A FOURTH STATEMENT OF THE PER-IDENTITY VOCABULARY.
-- 0009's `ledger_accounts_code_is_declared` states the seven, 0027's LEDGER-C2
-- states them again, and accounts.ts states which three are per identity. That
-- third copy earns its place, in its own header's words, "only because it is
-- CHECKED against both of the others". So does this one:
-- packages/ledger/test/identity-provisioning.test.ts reads the code list OUT OF
-- THIS FILE and asserts it equals the identity partition of
-- LEDGER_ACCOUNT_SCOPE, in both directions. A merged migration is never edited,
-- so a copy nobody checks would be wrong forever.
--
-- THE `kind` LITERALS ARE DERIVED AND ARE SELF-CHECKING; THE `code` LITERALS
-- ARE NEITHER. `ledger_accounts_kind_matches_code` as 0053 left it rules all
-- three per-identity codes `liability`, so a wrong kind here is REFUSED by the
-- database and every identity creation fails loudly. A wrong CODE is not: a
-- row reading ('reserve','liability','identity', <uuid>) passes
-- code_is_declared, passes scope_identity, and falls through
-- kind_matches_code's `ELSE true`. The DDL never ties `code` to `scope`, which
-- accounts.ts's header states from the other direction, so the code half needs
-- a test and cannot have a constraint.
--
-- -----------------------------------------------------------------------------
-- ALL THREE CODES, NOT THE ONE A POSTING NEEDS
-- -----------------------------------------------------------------------------
-- ADR-183 section 4. Two of the three, `trader_withdrawable` and
-- `trader_wallet`, are named by shipped posting builders today.
-- `promotional_credit` is named by none, and it is provisioned anyway.
--
-- Provisioning two would leave M14, M17 and M20 to build a SECOND provisioning
-- mechanism for the third code, which is this same ruling made a second time,
-- later, in a module that is not the ledger's. And the set written here is
-- derived from the vocabulary rather than from module ship order: it is the
-- identity partition, whole.
--
-- AN ACCOUNT IS NOT A GRANT AND A ROW IS NOT A BALANCE. INV-M14-10 and
-- INV-M17-08 require `promotional_credit` to have no path to `trader_wallet`
-- and no path to a withdrawal. A zero-balance account crosses neither: those
-- invariants are about ENTRIES, and this file writes no entry.
--
-- THE READ COST IS REAL AND IS ALREADY WRITTEN DOWN. chart.ts:15 records that
-- resolving one posting reads the whole chart, "four firm rows plus up to three
-- per identity, which grows with the trader population and not with the
-- posting". This file makes that "up to three" exactly three. The comment
-- anticipated this shape; it did not price it, and ADR-183 section 6 does.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- -----------------------------------------------------------------------------
-- It supersedes nothing. 0009, 0027, 0038, 0052 and 0053 are byte for byte
-- unchanged: no constraint is dropped, no function is replaced, no seed is
-- rewritten. The vocabulary stays closed at seven and NO EIGHTH CODE IS
-- MINTED. It adds rows and the mechanism that creates them, and it touches
-- neither the vocabulary nor the kind constraint.
--
-- It does not make LT-06 or LT-07 postable. Their open slot is a firm-scoped
-- `liability` with no code (ADR-181), and that is a different absence. What it
-- does is make ADR-181 section 4's THIRD GROUND false: minting the eighth code
-- no longer "unblocks nothing", because LT-06's debit leg now resolves.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- The provisioning function
-- -----------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING, with no conflict target, so that
-- ledger_accounts_identity_code_uq -- `(code, identity_id) WHERE scope =
-- 'identity'`, 0009:74-75 -- is what decides whether a row already exists,
-- rather than this function holding a second opinion about it. The clause is
-- reachable only if an account was opened for the identity before its own
-- INSERT completed, which nothing does today; it is here so that the
-- re-provisioning path a later module may need cannot double-open a position.
CREATE FUNCTION provision_identity_ledger_accounts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The three per-identity classes of ADR-027's seven, with the only `kind`
  -- ledger_accounts_kind_matches_code will accept for each. A wrong literal in
  -- either column of the kind position is refused by that constraint; a wrong
  -- literal in the code position is not, and is watched by
  -- packages/ledger/test/identity-provisioning.test.ts instead.
  INSERT INTO ledger_accounts (code, kind, scope, identity_id) VALUES
    ('trader_withdrawable', 'liability', 'identity', NEW.id),
    ('trader_wallet',       'liability', 'identity', NEW.id),
    ('promotional_credit',  'liability', 'identity', NEW.id)
  ON CONFLICT DO NOTHING;

  -- AFTER trigger: the return value is discarded. NULL rather than NEW, on
  -- 0027's convention for its own AFTER trigger.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION provision_identity_ledger_accounts() IS
  'ADR-183. Opens the three per-identity ledger positions when an identity is '
  'created. The code list is a fourth statement of the per-identity vocabulary '
  'and is checked against accounts.ts by packages/ledger.';

CREATE TRIGGER identities_provision_ledger_accounts
  AFTER INSERT ON identities
  FOR EACH ROW EXECUTE FUNCTION provision_identity_ledger_accounts();

-- -----------------------------------------------------------------------------
-- The backfill
-- -----------------------------------------------------------------------------
-- A trigger repairs the future. Every identity that already exists was created
-- before this file and would keep the defect forever, which is a migration
-- that looks like it worked.
--
-- THIS TREE HAS NO SUCH ROW: no migration inserts into `identities` and no
-- TypeScript file does either, so on a fresh install this statement writes
-- nothing. It is not therefore decoration. It is the half that is right in any
-- environment where the table is not empty, and an environment where it is not
-- empty is the only kind that matters.
INSERT INTO ledger_accounts (code, kind, scope, identity_id)
SELECT c.code, 'liability', 'identity', i.id
  FROM identities i
  CROSS JOIN (VALUES
    ('trader_withdrawable'),
    ('trader_wallet'),
    ('promotional_credit')
  ) AS c(code)
ON CONFLICT DO NOTHING;

COMMIT;
