-- =============================================================================
-- 0067_rule_state_phase_vocabulary
-- =============================================================================
-- E2 READ: MONEY PATH. `rule_states` is the table replay compares against, and
-- until this file its `phase` column admitted ANY STRING. It edits nothing:
-- `0015` stays exactly as it was written and this file supersedes one of its
-- column declarations from outside it (constitution E2), which is the third
-- mechanism `0037`, `0046` and `0065` have already used on this table.
--
-- ADR-216, status PROPOSED, UNSIGNED. The founder's line-by-line read is OWED
-- and is not recorded as done anywhere.
--
-- -----------------------------------------------------------------------------
-- 1. THE DEFECT, MEASURED RATHER THAN GREPPED
-- -----------------------------------------------------------------------------
-- Read from `pg_attribute` and `pg_constraint` against `0001`..`0066` applied
-- forward-only into an empty database under ON_ERROR_STOP, on PostgreSQL 16.13:
--
--   rule_states.phase                         text, NOT NULL
--   constraints on rule_states naming phase   0
--   rule_states rows                          0
--   account_phase labels, in sort order       eval, funded, closed, graduated
--   table columns of type account_phase       accounts.phase, and that is all
--
-- `account_phase` is declared at `0001:45` as EXACTLY the engine's four `Phase`
-- members (`packages/rules-engine/src/types.ts:787`), member for member and in
-- the same order, and one column in the estate uses it. `0015:47` typed this
-- column `text` and wrote no CHECK, so the engine's own per-day record admitted
-- a phase the engine cannot produce, on the table `state_hash` replay compares
-- against and on which `phase` is hash input 3 (ADR-026 C-07).
--
-- THE TABLE HOLDS ZERO ROWS AND NO WRITER EXISTS. `B5` term 1, a
-- `writeRuleState` implementation, is still owed. A constraint added to a table
-- already holding a violating row fails AT INSTALL; this one cannot, and that
-- was checked before it was written rather than assumed.
--
-- -----------------------------------------------------------------------------
-- 2. THE RULING: THE TYPE THAT ALREADY EXISTS, NOT A CHECK
-- -----------------------------------------------------------------------------
-- ADR-207 chose a CHECK over a new ENUM for `breach_kind` on three measured
-- reasons. THIS FILE RE-ARGUES THEM ON THIS COLUMN'S FACTS RATHER THAN COPYING
-- THE CONCLUSION, and two of the three do not survive the move.
--
--   REASON 1, "all thirteen enum types are created in 0001 and no migration
--   since has added one", DOES NOT TRANSFER. It is a reason against CREATING a
--   type, and it made an enum for `breach_kind` a ruling about where new estate
--   vocabularies live. `account_phase` ALREADY EXISTS. Measured: `pg_type`
--   reports 13 enum types before this file and 13 after. Adding no new type is
--   not the same as using an existing one, and only the first is what reason 1
--   speaks to.
--
--   REASON 2, "this table already stores an engine union as bare text (phase)",
--   INVERTS, because its premise is the defect this file repairs. A reason that
--   cites a gap as its justification cannot survive the gap's repair with its
--   sign unchanged. What survives is the requirement underneath it, and section
--   4 states honestly where this file leaves that requirement.
--
--   REASON 3, "a CHECK narrows by DROP and re-ADD under one name, which is E2's
--   own mechanism, while an enum value can be added and can never be removed",
--   TRANSFERS AS A FACT AND FAILS AS A REASON HERE. The fact was executed, not
--   recalled: `ALTER TYPE account_phase DROP VALUE 'graduated'` is a SYNTAX
--   ERROR on PostgreSQL 16.13 -- the grammar has no DROP VALUE production, so
--   this is not a permission that could be granted -- and `ALTER TYPE ... ADD
--   VALUE` inside a transaction block raises `unsafe use of new value` when the
--   same transaction then uses it, so widening this vocabulary costs two
--   migrations in an estate where one file is one transaction.
--
--   IT FAILS AS A REASON BECAUSE BOTH COSTS ARE ALREADY BORNE. `accounts.phase`
--   has been `account_phase` since `0001`. Removing a `Phase` member today
--   already means recreating the type and rewriting that column; adding one
--   already costs the two-migration dance. `rule_states.phase` joining the type
--   adds ONE MORE COLUMN to a rewrite that already has to happen and does not
--   add the rewrite. THE MARGINAL COST OF THE ENUM ROUTE ON THIS COLUMN IS
--   ZERO, and that is what `breach_kind` had no counterpart to.
--
-- AND THE REASON ADR-207 HAD NO ACCESS TO IS THE COPY COUNT. `Phase`'s four
-- members are written out LITERALLY SIX TIMES in this repository with NO
-- COMPARATOR BETWEEN ANY TWO of them:
--
--   1. packages/rules-engine/src/types.ts:787       export type Phase
--   2. packages/db/migrations/0001_extensions_and_enums.sql:45   CREATE TYPE
--   3. packages/db/src/schema.ts:163                pgEnum('account_phase', ...)
--   4. apps/api/src/routes/accounts.ts:157          type AccountPhase
--   5. apps/api/src/routes/accounts.ts:748          const PHASES
--   6. apps/portal/src/api/types.ts:123             an inline union
--
-- `breach_kind` had TWO copies and ADR-207 paid for the second with a
-- comparator. A CHECK HERE WOULD MAKE A SEVENTH COPY OF A VOCABULARY THAT
-- ALREADY HAS SIX AND ZERO COMPARATORS. `ALTER COLUMN ... TYPE account_phase`
-- writes the type's NAME and not its members, so this column's vocabulary
-- becomes copy 2 BY CONSTRUCTION rather than by assertion, and there is nothing
-- new for a comparator to defend. That is not an aesthetic preference; it is the
-- difference between a fact stated once and a fact stated twice.
--
-- AND THE PRICE OF DEFERRING IS NOT SYMMETRIC. A CHECK added after rows land can
-- be added NOT VALID and validated without an exclusive-lock rewrite. A column
-- type change CANNOT: it takes ACCESS EXCLUSIVE and rewrites the table. So the
-- answer this file takes is precisely the one whose price rises fastest, and it
-- is taken on the day the table holds zero rows.
--
-- -----------------------------------------------------------------------------
-- 3. WHAT THIS FILE DOES NOT DO
-- -----------------------------------------------------------------------------
-- No table is created, no index is added, no trigger is installed, no constraint
-- is added or dropped, no enum type is created and NO ENUM LABEL IS ADDED. No
-- merged migration is edited. `accounts.phase` and `account_phase`'s own
-- definition are NOT TOUCHED: this file reads the type and does not move it.
--
-- `0048`'s `rewrite_rule_state` takes a `rule_states` ROWTYPE parameter and
-- derives its assignment list from `pg_attribute` through `%I`, binding the row
-- as `$1` and interpolating no value. It is type-transparent by construction and
-- was executed after this change rather than reasoned about. No view or
-- materialized view depends on `rule_states` (`pg_depend` over `pg_rewrite`:
-- zero rows) and no index on the table mentions `phase`.
--
-- NOTHING IN THE ESTATE ORDERS OR RANGE-COMPARES THIS COLUMN, which is the one
-- behaviour a text-to-enum change silently alters: `ORDER BY phase` would move
-- from alphabetical to declaration order. Searched across scripts/, packages/
-- and apps/: the only inequality on any `phase` column in the tree is
-- `0007:130`'s `phase <> 'funded'` on `accounts`, which is equality-shaped and
-- on another table.
--
-- -----------------------------------------------------------------------------
-- 4. WHAT THIS FILE LEAVES OPEN, STATED RATHER THAN GLOSSED
-- -----------------------------------------------------------------------------
-- AFTER THIS FILE, `rule_states` HOLDS ONE ENGINE UNION AS A TYPE AND ANOTHER AS
-- BARE TEXT WITH A CHECK. That is the shape ADR-207 reason 2 named as worse than
-- either uniform answer, and it is now true in the other direction. It is not
-- hidden here: it is the second item on ADR-216's approval block.
--
-- The two are not symmetric, which is why this file does not treat the
-- inconsistency as decisive. `Phase` has a type in `0001` that names its members
-- exactly; `BreachKind` has none, and creating one is the ruling ADR-207
-- declined and this file does not take either. Uniformity bought by leaving
-- `rule_states.phase` unconstrained against a type that already spells it out is
-- uniformity bought with the defect.
--
-- THE STATE HASH IS UNTOUCHED AND UNMOVED. `phase` is input 3 of ADR-026 C-07's
-- nineteen and stays input 3. This file changes the column's DOMAIN and not its
-- value: every string this column could legally hold before it, it holds after
-- it, byte for byte, so no stored hash could change. ADR-207 section 5's open
-- question about the three columns `0065` added is neither answered nor moved.
--
-- -----------------------------------------------------------------------------
-- 5. THE COUNTERFACTUAL, RUN IN BOTH DIRECTIONS
-- -----------------------------------------------------------------------------
-- A rule_states row carrying phase 'not_a_phase_at_all' is ACCEPTED against
-- `0001`..`0066` and REFUSED against `0001`..`0067` with
-- `invalid input value for enum account_phase`. Both transcripts are in
-- DELTA_MANIFEST section 32, and `scripts/db/probe_rule_state_phase_vocabulary.sql`
-- is the committed control that runs them in CI. A migration that applies is not
-- a guard that works, so the refusal was watched firing before it was believed.
-- =============================================================================

BEGIN;

-- THE WHOLE RULING IS THIS ONE STATEMENT. `USING phase::account_phase` is
-- required because there is no implicit text-to-enum cast in an ALTER; it is a
-- no-op over the zero rows this table holds and is written so the statement is
-- correct for a table that holds rows rather than only for this one.
ALTER TABLE rule_states
  ALTER COLUMN phase TYPE account_phase USING phase::account_phase;

COMMENT ON COLUMN rule_states.phase IS
  'The phase this account was in AS OF THE END OF THIS TRADING DAY, and not '
  'its phase now. ADR-026 C-07 hash input 3. 0067 (ADR-216) moved this column '
  'from bare text to account_phase, the type 0001:45 has declared as exactly '
  'the engine Phase union since the estate began: until then this table, which '
  'is the one replay compares against, admitted any string as a phase. THE '
  'TYPE IS THE VOCABULARY AND THERE IS NO SECOND COPY OF IT HERE -- a CHECK on '
  'this column would have been a seventh literal copy of four members that '
  'already have six and no comparator. Widening Phase means ALTER TYPE '
  'account_phase ADD VALUE in a migration of its own, because a value added '
  'inside a transaction cannot be used in it; narrowing Phase means recreating '
  'the type, which accounts.phase already made true before this column joined '
  'it. Retention: forever, with the row.';

COMMIT;
