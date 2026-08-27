-- =============================================================================
-- 0049_reserve_coverage_snapshots
-- =============================================================================
-- E2 READ: MONEY PATH. The reserve coverage ratio is the number that decides
-- whether SALES PAUSE (GLOSSARY: "reserve / CVaR99 at rho = 0.30. Below 1.0, the
-- circuit breaker pauses new sales. It never pauses payouts."). Until this file
-- there is nowhere in the schema to write it, and five documents cite a control
-- whose input does not exist.
--
-- ADR-128, status: proposed, founder approval PENDING. It closes OI-01.
--
-- -----------------------------------------------------------------------------
-- THIS FILE IS SEPARATE FROM 0048 ON PURPOSE, AND THE REASON IS THE FOUNDER'S
-- READ RATHER THAN TIDINESS
-- -----------------------------------------------------------------------------
-- OI-01 is the only item in this cluster whose remedy is a CHOICE BETWEEN TWO
-- NAMED DESIGNS rather than a gap with one obvious closure, and DATA_MODEL has
-- said since 2026-08-14 that it is "a founder call and no session takes it".
-- Folding it into 0048 would mean that a founder who prefers the other design
-- rejects three SECURITY DEFINER paths and a calendar guard along with it. 0033
-- already writes for exactly this ("Reject this half if the founder reads the
-- ruling narrowly"); a separate file is the stronger form of the same courtesy.
--
-- WHAT IS TRANSCRIBED AND WHAT IS DECIDED. The recommendation implemented below
-- is not this session's. docs/architecture/data-model/liability_snapshots.md has
-- carried it, with its three reasons in order of weight, since the
-- reconciliation: "give them their own table rather than widening this one".
-- ADR-128 proposes adopting it; the approval line is UNSIGNED and the ruling is
-- the founder's.
--
-- -----------------------------------------------------------------------------
-- OI-01 NAMED FIVE ORPHANED FIELDS AND ONLY THREE OF THEM NEED A NEW TABLE
-- -----------------------------------------------------------------------------
-- The approved design was keyed on `snapshot_on date` and carried
-- funded_accounts, reserve_cents, cvar99_cents, rcr_bp and per_plan. The fold
-- kept none of them. Read against the migrations rather than against the item:
--
--   reserve_cents  }  RESERVE COVERAGE. A ratio of the rail's clock to ours, on
--   cvar99_cents   }  a cadence that is not the liability snapshot's. New table.
--   rcr_bp         }
--
--   funded_accounts   NOT reserve coverage. API_CONTRACT's GET /admin/liability
--                     puts it beside open_liability_cents and as_of, which is
--                     the liability snapshot's own grain. It goes on
--                     liability_snapshots by ALTER TABLE, and 0009 is untouched.
--
--   per_plan          ALREADY HAS A HOME AND NEEDS NOTHING. API_CONTRACT's
--                     per_plan is loss ratio, threshold, sales_paused and CUSUM
--                     per plan, and that is plan_breaker_state, which 0016 built
--                     with plan_id, evaluated_on, ratio_bp, threshold_bp and a
--                     state enum whose values include 'paused'. OI-01 has been
--                     carrying an orphan that was never orphaned.
--
-- -----------------------------------------------------------------------------
-- FIVE THINGS NEED THE FOUNDER'S LINE-BY-LINE READ
-- -----------------------------------------------------------------------------
--
--   1. rcr_bp IS A GENERATED COLUMN, WHICH IS THE DIRECT ANSWER TO THE THIRD
--      OBJECTION IN THE RECOMMENDATION. That objection is "a ratio stored beside
--      its own numerator invites recomputation drift, where the stored rcr_bp
--      and the stored bounded_near_term_cents disagree with each other in the
--      same row". A ratio the database computes cannot disagree with its own
--      inputs. It is INTEGER ARITHMETIC on bigint cents: no float enters the
--      reserve path, and the truncation is toward zero, which lowers the ratio
--      and therefore arms the breaker marginally sooner rather than later.
--
--   2. NULLIF IS LOAD-BEARING AND NOT DEFENSIVE PROGRAMMING. A GENERATED column
--      is computed BEFORE the row's CHECK constraints are evaluated, PROVEN BY
--      EXECUTION against PostgreSQL 16: with a plain `/ cvar99_cents`, a zero
--      denominator raises a bare `division by zero` and
--      reserve_coverage_snapshots_cvar99_is_positive never fires at all. With
--      NULLIF the generated value is NULL, the row reaches the constraints, and
--      the operator gets the named constraint that says what is actually wrong.
--
--   3. THE RAIL BALANCE IS A REFERENCE AND A COPY, AND RESERVE-C1 IS WHAT MAKES
--      CARRYING BOTH HONEST. INV-M5-11 says the reserve is reported against a
--      LIVE rail balance rather than a computed one, so the row names the
--      treasury_balances row it read, which is also how P-M6-07's attestation
--      staleness is answerable (source and as_of are one join away, not two more
--      columns). ADR-047 rules that a reference beats a copied value. But a
--      SNAPSHOT that holds only a pointer is not a snapshot, so reserve_cents is
--      stored too, and RESERVE-C1 asserts at write time that the copy IS the
--      referenced balance. Reject RESERVE-C1 if the founder wants the pointer
--      alone; the table stands without it and loses its self-containment.
--
--   4. THE TABLE IS APPEND-ONLY BY RULING AND THE REVOKE IS WHAT MAKES THAT
--      TRUE. 0026:174 grants merit_app SELECT, INSERT, UPDATE, DELETE on every
--      table a later migration creates, so without the REVOKE at the foot the
--      words "append-only" here would be false the instant the table exists.
--      This is the twenty-sixth member of DATA_MODEL section 1's append-only
--      set, and the same commit that adds it adds the mechanical check that
--      asserts the set against the document, which is OI-03.
--
--   5. liability_snapshots.funded_accounts IS NOT NULL WITH NO DEFAULT, AND
--      THAT IS DELIBERATE. A DEFAULT 0 would make every row written by a
--      producer that forgot the column claim ZERO FUNDED ACCOUNTS, which is a
--      number the dashboard would render. The table has no rows today (no
--      producer exists; M06 is unbuilt), so ADD COLUMN NOT NULL without a
--      default is legal, and it makes the count a thing a writer must supply.
--      0035's argument: nothing in this file can be read as evidence that a
--      populated table satisfies it.
--
-- Nothing here edits a merged file. 0009 stays exactly as it was written and
-- this file changes what it installed. Migrations are sacred once merged
-- (constitution E2), which is a rule about editing them and not a rule against
-- correcting them.
--
-- No numbered delta lands here. OI-01 is an open item rather than an `SD-nn`
-- row, so ADR-026's manifest completeness gate has nothing to count and the
-- record is DELTA_MANIFEST section 26 instead. SD-M6-01 is already dispositioned
-- against 0009 and does not move.
--
-- WHAT IS NOT HERE, deliberately: no producer, no rows, no index beyond the two
-- reads that exist, and no breaker_armed column. Armed is `rcr_bp < 10000`, a
-- rendering of a stored number against a threshold the GLOSSARY fixes at 1.0,
-- and storing it would recreate in one column exactly the drift item 1 removes
-- from another. Nothing in the corpus gives the RCR breaker an override state,
-- and plan_breaker_state's 'manually_overridden' belongs to the per-plan loss
-- ratio breaker rather than to this one.
--
-- Rulings: ADR-128 (OI-01). Supersedes nothing on disk.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. liability_snapshots gains the count that belongs to it
-- -----------------------------------------------------------------------------
-- Header item 5. API_CONTRACT's GET /admin/liability renders `funded_accounts`
-- beside `as_of` and `open_liability_cents`, which is this table's grain and not
-- the reserve snapshot's. P-M6-01 is a sum "across funded accounts"; the count
-- is the denominator a reader needs to know whether that sum is one account or a
-- thousand.
ALTER TABLE liability_snapshots
  ADD COLUMN funded_accounts integer NOT NULL
    CONSTRAINT liability_snapshots_funded_accounts_counted CHECK (funded_accounts >= 0);

COMMENT ON COLUMN liability_snapshots.funded_accounts IS
  'SD-M6-01, OI-01. Funded accounts contributing to open_liability_cents at '
  'as_of. NOT NULL with no default: a defaulted zero is a number the dashboard '
  'would render and nobody counted.';

-- -----------------------------------------------------------------------------
-- 2. reserve_coverage_snapshots: the number that decides whether sales pause
-- -----------------------------------------------------------------------------
-- The recommendation's own three reasons for a separate table, in its order of
-- weight. liability_snapshots exists for EC-095, three named liability numbers
-- that are never collapsed into one, and a coverage RATIO is a fourth kind of
-- fact that re-collapses the distinction the table exists to enforce. The
-- CADENCES DIFFER: coverage is the rail's clock (SD-M5-03) against ours, and one
-- row would force one as_of onto two sources that do not move together. And the
-- ratio-beside-its-numerator problem, which item 1 above answers rather than
-- accepts.
CREATE TABLE reserve_coverage_snapshots (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The instant the coverage figure describes. Its own clock, which is the
  -- second reason this is not a column set on liability_snapshots.
  as_of                 timestamptz NOT NULL,

  -- THE NUMERATOR. The rail's reported balance, copied from the row named
  -- below and asserted equal to it by RESERVE-C1. INV-M5-11: reported against a
  -- LIVE balance, never one derived from our own ledger, because a reserve
  -- coverage ratio computed from the book it is meant to cover is a number that
  -- agrees with itself.
  reserve_cents         bigint NOT NULL,

  -- THE ANCHOR, as a reference. treasury_balances is keyed (account_code,
  -- as_of), and naming the row rather than restating its fields is what makes
  -- P-M6-07's "attestation staleness shown when the balance is a manual
  -- attestation" a join instead of two more columns that can disagree with their
  -- source. ON DELETE RESTRICT, because a coverage figure whose anchor has been
  -- deleted records a ratio nobody can explain.
  treasury_account_code text        NOT NULL,
  treasury_as_of        timestamptz NOT NULL,

  -- THE DENOMINATOR, AND IT IS THE FLOOR RATHER THAN THE ESTIMATE. P-M6-07:
  -- "The denominator is CVaR99 at rho = 0.30, the reserve floor, never the
  -- harness's central estimate", and ADR-019 put wallet balances inside it
  -- (GS-130). rho = 0.30 is where this system's conservatism deliberately lives.
  cvar99_cents          bigint NOT NULL,

  -- Header items 1 and 2. Integer basis points, computed by the database, so a
  -- stored ratio cannot disagree with the two numbers stored beside it. NULLIF
  -- is what lets the named CHECK below deliver the error on a zero denominator,
  -- because a generated column is computed before constraints are evaluated.
  --
  -- The bound is stated rather than constrained: a coverage above 214,748x
  -- raises `integer out of range` on insert. That failure cannot be given a
  -- nicer name for the same reason NULLIF is needed here, and a reserve 214,748
  -- times the CVaR99 floor is not a state this business reaches.
  rcr_bp                integer GENERATED ALWAYS AS
                          ((reserve_cents * 10000) / NULLIF(cvar99_cents, 0)) STORED,

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Header item 2. A zero denominator is not a coverage of infinity, it is a
  -- CVaR99 nobody computed, and the ratio it would produce is the one number on
  -- this table that must never be invented.
  CONSTRAINT reserve_coverage_snapshots_cvar99_is_positive CHECK (
    cvar99_cents > 0
  ),

  -- A negative rail balance is an overdraft and a different incident. It is not
  -- a coverage figure and the panel has no way to render it.
  CONSTRAINT reserve_coverage_snapshots_reserve_non_negative CHECK (
    reserve_cents >= 0
  ),

  CONSTRAINT reserve_coverage_snapshots_anchor_fk
    FOREIGN KEY (treasury_account_code, treasury_as_of)
    REFERENCES treasury_balances (account_code, as_of) ON DELETE RESTRICT
);

-- One coverage figure per instant, on liability_snapshots_as_of_uq's precedent.
-- Two rows for one as_of are two answers to "what was coverage then", and the
-- panel would have to pick.
CREATE UNIQUE INDEX reserve_coverage_snapshots_as_of_uq
  ON reserve_coverage_snapshots (as_of);

-- The panel's read: the latest figure. DESC because the question is always
-- "what is coverage now".
CREATE INDEX reserve_coverage_snapshots_latest_idx
  ON reserve_coverage_snapshots (as_of DESC);

COMMENT ON TABLE reserve_coverage_snapshots IS
  'SD-M6-01 / OI-01, ADR-128. Append-only. Retention: forever. P-M6-07''s '
  'reserve coverage ratio: reserve / CVaR99 at rho = 0.30, the number that '
  'pauses NEW SALES below 1.0 and never pauses payouts (GLOSSARY). Separate from '
  'liability_snapshots because that table exists to keep three liability numbers '
  'apart and a ratio re-collapses them, and because the rail''s clock is not '
  'ours.';

COMMENT ON COLUMN reserve_coverage_snapshots.rcr_bp IS
  'GENERATED. Integer basis points, reserve_cents * 10000 / cvar99_cents. '
  'Generated rather than written so a stored ratio cannot disagree with the two '
  'numbers stored beside it. Armed is rcr_bp < 10000 and is DELIBERATELY NOT '
  'STORED: it is a rendering against a threshold the GLOSSARY fixes at 1.0.';

COMMENT ON COLUMN reserve_coverage_snapshots.cvar99_cents IS
  'CVaR99 at rho = 0.30, the RESERVE FLOOR, never the simulation harness''s '
  'central estimate (P-M6-07). Includes wallet balances (ADR-019, GS-130).';

-- -----------------------------------------------------------------------------
-- 3. RESERVE-C1: the copy is the balance it names
-- -----------------------------------------------------------------------------
-- Header item 3. The foreign key proves the anchor row EXISTS; nothing proves
-- that reserve_cents is what it says. A coverage figure whose numerator does not
-- match the attestation it cites is worse than one with no citation, because it
-- reads as evidence.
--
-- IT ASSERTS AND DOES NOT WRITE, which is 0027 and 0033's idiom. Copying the
-- balance in on the writer's behalf would make the column derived, and a derived
-- numerator on a table whose whole claim is "this is what the RAIL said" hides
-- the one disagreement worth seeing.
--
-- THE LIMIT IS STATED RATHER THAN IMPLIED. treasury_balances is not in the
-- append-only set, so a later UPDATE to an attestation can move a balance this
-- table has already cited. This trigger fires on INSERT and cannot see that.
-- What it guarantees is that the copy was true WHEN IT WAS WRITTEN, which is
-- what makes a later divergence a visible fact rather than a silent rewrite of
-- history. Making treasury_balances append-only is a separate ruling and is not
-- taken here.
CREATE FUNCTION assert_reserve_matches_its_anchor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  anchor_cents bigint;
BEGIN
  SELECT t.balance_cents INTO anchor_cents
    FROM treasury_balances t
   WHERE t.account_code = NEW.treasury_account_code
     AND t.as_of        = NEW.treasury_as_of;

  -- The foreign key has already run, so NOT FOUND here means the constraint was
  -- dropped rather than that the writer skipped a step. Asserted anyway: a
  -- sentinel that can only fire when something else broke is how this corpus
  -- finds out that something else broke.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'RESERVE-C1: no treasury_balances row for (%, %), so '
      'reserve_coverage_snapshots_anchor_fk is not doing its job. See ADR-128.',
      NEW.treasury_account_code, NEW.treasury_as_of
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.reserve_cents <> anchor_cents THEN
    RAISE EXCEPTION
      'RESERVE-C1: reserve_cents is % and treasury_balances (%, %) reports %. '
      'The reserve is reported against a LIVE rail balance rather than a '
      'computed one (INV-M5-11), so the numerator of the ratio that pauses '
      'sales is the attestation it cites or it is not the reserve. See ADR-128.',
      NEW.reserve_cents, NEW.treasury_account_code, NEW.treasury_as_of,
      anchor_cents
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END
$$;

CREATE TRIGGER reserve_coverage_snapshots_matches_anchor
  AFTER INSERT ON reserve_coverage_snapshots
  FOR EACH ROW EXECUTE FUNCTION assert_reserve_matches_its_anchor();

COMMENT ON FUNCTION assert_reserve_matches_its_anchor() IS
  'RESERVE-C1, OI-01, ADR-128. reserve_cents equals the treasury_balances row it '
  'names, at write time. INSERT only: this table is append-only, and a later '
  'correction to the attestation is outside what a trigger on this table can '
  'see.';

-- -----------------------------------------------------------------------------
-- 4. Append-only is a grant, not a convention (VG-8)
-- -----------------------------------------------------------------------------
-- Header item 4, and 0032's precedent applied a sixth time. 0026 ends with
-- ALTER DEFAULT PRIVILEGES granting merit_app full DML on anything a later
-- migration creates, so this table is UPDATE-able and DELETE-able the instant it
-- exists and every sentence above about a snapshot would be false.
--
-- A COVERAGE FIGURE THAT CAN BE REWRITTEN IS NOT A CONTROL. It is the input to
-- the circuit breaker that pauses new sales, so a rewritable row means the
-- record of why sales were or were not paused on a given day can be edited after
-- the fact by the party the record is about.
--
-- Against PUBLIC as well as merit_app, because a revoke that only binds the
-- application role is a revoke that a second connection string bypasses.
REVOKE UPDATE, DELETE ON reserve_coverage_snapshots FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT. 0026's default privileges
-- make a new table invisible to analytics until somebody grants it, and the
-- default should be that it is not: M13's trading surface is accounts, marks,
-- fills and round trips, and the firm's reserve position is not on it. It
-- arrives with a consumer that names itself, or not at all.

COMMIT;
