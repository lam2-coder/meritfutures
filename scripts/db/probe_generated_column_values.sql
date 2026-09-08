-- =============================================================================
-- Probe: the GENERATED ALWAYS AS expressions are EXECUTED, not spelled. ADR-455
-- =============================================================================
-- ADR-443 COMPARED THESE EXPRESSIONS AS TEXT AND SAID SO ABOUT ITSELF. Its
-- section 8 item 1: "A GENERATED EXPRESSION COMPARING EQUAL AS TEXT IS NOT THE
-- SAME CLAIM AS IT COMPUTING THE SAME VALUE... Both sides are STRINGS and
-- neither is evaluated." Its item 2: "IT IS COMPARED AGAINST THE MIGRATIONS AS
-- TEXT, NOT AGAINST A DATABASE." That entry's section 11 item 2 named the
-- artifact that would close it: one that "runs SELECT against PostgreSQL 16".
-- THIS IS THAT FILE. Every assertion below reads a value PostgreSQL computed.
--
-- NINE SUCCESSES BEFORE THE FIRST REJECTION, on probe_reserve_coverage.sql's
-- precedent and DELTA_MANIFEST section 13's reason: a column that refused every
-- row would satisfy an inventory of refusals. The claim here is that these six
-- expressions COMPUTE something, so the computed values come first.
--
-- MONEY FIRST, AND THE ORDER IS THE ARGUMENT. Three of the six are integer
-- cents. A generated money column computing something other than what the
-- corpus believes is the worst defect this file could find, so SUCCESS 2
-- through SUCCESS 6 are the money columns and the booleans follow them.
-- Integer cents throughout: no float is written, read or asserted here.
--
-- THE POPULATION IS DERIVED FROM THE CATALOG RATHER THAN FROM PROSE, which is
-- SUCCESS 1 and is the reason this file cannot quietly go stale. ADR-443
-- derived five from `schema.ts` and six from the migration text; this reads
-- `pg_attribute.attgenerated` on the installed database, which is neither
-- document, and pins the six by name. A seventh generated column is RED on the
-- day it lands and deleting one of the six is RED too.
--
-- WHAT THIS FILE ADDS OVER probe_reserve_coverage.sql, WHICH ALREADY EXECUTES
-- ONE OF THE SIX. That probe asserts rcr_bp at 1.5x, 0.8x, exactly 1.0 and one
-- cent either side of it, so the claim "nobody has executed one" was already
-- false when ADR-443 section 11 item 2 was written. What was NOT executed is
-- the OVERFLOW BOUND: ADR-443 section 8 item 2 says of 0049's comment that
-- "this row does not check it". SUCCESS 6 and REJECTION 4 check it.
--
-- RECOMPUTATION ON UPDATE IS ASSERTED SEPARATELY FROM THE INSERT VALUE, three
-- times, because a STORED generated column is written at INSERT and rewritten
-- at UPDATE, and a reader who has only ever seen the INSERT half has seen half
-- the promise. `0014`'s own words are that "the two sides and their difference
-- can never disagree", and an UPDATE that moved one side and left the
-- difference behind would break that sentence without breaking any INSERT.
--
-- Rejections are checked by SQLSTATE where the database raises them, by
-- COLUMN_NAME where the failure is a NOT NULL, and by constraint name nowhere,
-- because REJECTION 5's not_null_violation carries an EMPTY CONSTRAINT_NAME and
-- a check written against that field would pass against every other failure of
-- the same statement.
--
-- THE COUNTERFACTUAL, AS OBSERVED. Executed against `0001`..`0049` the file
-- dies in SUCCESS 1, at the census, with the six-column population reading five
-- and `live_account_state` absent: `0050` is the migration that creates the
-- money column SUCCESS 2 measures. Recorded in DELTA_MANIFEST section 27.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures: one funded account, and the rail attestations the ratio cites
-- ---------------------------------------------------------------------------
-- One account is enough because every assertion below is about ARITHMETIC on
-- one row rather than about a population of rows. probe_reconciliation_run.sql
-- builds three because a sweep needs a population to disagree with; nothing
-- here sweeps.
--
-- The treasury rows are keyed (account_code, as_of) and their balance_cents is
-- load-bearing rather than decoration: RESERVE-C1 asserts that a coverage row's
-- reserve_cents EQUALS the attestation it names, so each of SUCCESS 6's and
-- REJECTION 4's reserve figures needs its own anchor carrying that same number.
DO $$
DECLARE
  v_identity uuid;
  v_user     uuid;
  v_plan     uuid;
  v_pv       uuid;
  v_purchase uuid;
  v_account  uuid;
BEGIN
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_identity;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (v_identity, 'adr455@example.test', 'adr455@example.test')
    RETURNING id INTO v_user;

  INSERT INTO plans (code, name) VALUES ('adr455_core', 'ADR-455 probe')
    RETURNING id INTO v_plan;
  INSERT INTO plan_versions (plan_id, version, status, rules, public_slug, created_by)
    VALUES (v_plan, 1, 'draft', '{"schema_version":1}'::jsonb, 'adr455-probe', v_user)
    RETURNING id INTO v_pv;
  -- 0045 SD-M21-02, on probe_reconciliation_run.sql's wording: a published
  -- version records what it was decided on, or says in writing why no run was
  -- consulted. A probe database has no runs.
  UPDATE plan_versions SET status = 'published', published_at = now(),
         simulation_waiver_reason = 'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)'
   WHERE id = v_pv;

  INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                         list_price_cents, amount_paid_cents, psp, psp_reference,
                         status, paid_at)
    VALUES (v_identity, v_user, v_pv, 5000000, 'new', 15000, 15000, 'psp_a',
            'adr455-ref-1', 'paid', now())
    RETURNING id INTO v_purchase;

  INSERT INTO accounts (identity_id, user_id, purchase_id, plan_version_id,
                        size_cents, status, phase, opened_on, funded_on)
    VALUES (v_identity, v_user, v_purchase, v_pv, 5000000, 'active', 'funded',
            current_date, current_date)
    RETURNING id INTO v_account;

  CREATE TEMP TABLE adr455_ids (kind text PRIMARY KEY, id uuid) ON COMMIT DROP;
  INSERT INTO adr455_ids VALUES ('account', v_account);

  INSERT INTO treasury_balances (account_code, as_of, balance_cents, source)
    VALUES ('payout_wallet', '2026-10-01 12:00Z',        0, 'provider_api'),
           ('payout_wallet', '2026-10-02 12:00Z',   214748, 'provider_api'),
           ('payout_wallet', '2026-10-03 12:00Z',   214749, 'provider_api');
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: THE POPULATION, DERIVED FROM THE CATALOG AND PINNED BY NAME
-- ---------------------------------------------------------------------------
-- SIX COLUMNS, AND THE DERIVATION IS THE POINT. ADR-443 counted five by walking
-- `schema.ts` and six by reading the migration text, and both are documents.
-- `pg_attribute.attgenerated` is the installed database's own answer, and it is
-- the only one of the three that is not a transcription.
--
-- 's' IS STORED AND THE ALTERNATIVE IS NOT COSMETIC. A VIRTUAL column is
-- recomputed on read, which is a different promise about a money column from
-- the one 0014 and 0050 make, so the mode is asserted rather than assumed.
DO $$
DECLARE
  v_found text[];
  v_want  text[] := ARRAY[
    'live_account_state.intraday_movement_cents',
    'notification_kinds.mutable',
    'notification_kinds.rate_limit_exempt',
    'reconciliations.delta_cents',
    'report_schedules.cadence',
    'reserve_coverage_snapshots.rcr_bp'
  ];
  v_virtual integer;
BEGIN
  SELECT array_agg(c.relname || '.' || a.attname ORDER BY c.relname, a.attname),
         count(*) FILTER (WHERE a.attgenerated <> 's')
    INTO v_found, v_virtual
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE a.attgenerated <> '' AND NOT a.attisdropped;

  IF v_found IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION
      'SUCCESS 1 FAILED: the installed database carries generated columns % '
      'and this probe executes %. A generated column nothing executes is the '
      'gap ADR-443 section 8 item 1 names', v_found, v_want;
  END IF;
  IF v_virtual <> 0 THEN
    RAISE EXCEPTION
      'SUCCESS 1 FAILED: % generated columns are VIRTUAL rather than STORED, so '
      'a value read back here was recomputed at read time', v_virtual;
  END IF;
  RAISE NOTICE 'SUCCESS 1: % generated columns, all STORED, and every one is executed below',
    array_length(v_found, 1);
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: MONEY. intraday_movement_cents COMPUTES THE SIGNED MOVEMENT
-- ---------------------------------------------------------------------------
-- THE COLUMN NO PROBE IN THIS REPOSITORY HAD EVER EXECUTED. 0050 calls it
-- "API_CONTRACT section 8's terms.intraday_movement_cents, computed by the
-- database... Signed, in integer cents", and a trader reads it on a live panel.
--
-- FIVE ROWS BECAUSE THE EXPRESSION'S BEHAVIOUR HAS FIVE OBSERVABLE REGIONS and
-- a single gain would distinguish none of them: a gain, a loss, a flat day, a
-- day that goes THROUGH ZERO into negative equity, and a day where BOTH
-- operands are negative. 0050 refuses a non-negative CHECK on either operand in
-- as many words, because "an account's equity can go through zero and a
-- constraint that refused it would drop exactly the ticks a trader most needs
-- to see", so the negative regions are reachable states rather than hypotheses.
--
-- THE SIGN IS THE ASSERTION. `opening - equity` is the same expression with the
-- operands swapped, it computes an equally plausible number, and it would render
-- every winning day as a loss on the surface a trader watches. Nothing in a text
-- comparison can tell the two apart; the values below can.
DO $$
DECLARE
  v_account uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  v_got     bigint;
  v_case    record;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('a gain',            5000000::bigint, 5012345::bigint,    12345::bigint),
      ('a loss',            5000000::bigint, 4987655::bigint,   -12345::bigint),
      ('a flat day',        5000000::bigint, 5000000::bigint,        0::bigint),
      ('through zero',      5000000::bigint,      -1::bigint, -5000001::bigint),
      ('both negative',       -500::bigint,    -100::bigint,      400::bigint)
    ) AS t(label, opening, equity, expected)
  LOOP
    DELETE FROM live_account_state WHERE account_id = v_account;
    INSERT INTO live_account_state
      (account_id, trading_day, sequence, opening_equity_cents, equity_cents, feed)
    VALUES (v_account, '2026-10-01', 1, v_case.opening, v_case.equity, 'adr455')
    RETURNING intraday_movement_cents INTO v_got;

    IF v_got IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION
        'SUCCESS 2 FAILED on %: opening % and equity % computed a movement of % '
        'and the signed difference is %. The panel renders this number to a trader',
        v_case.label, v_case.opening, v_case.equity, v_got, v_case.expected;
    END IF;
    RAISE NOTICE 'SUCCESS 2: % gives a movement of % cents', v_case.label, v_got;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: MONEY. THE MOVEMENT IS RECOMPUTED WHEN THE TICK MOVES
-- ---------------------------------------------------------------------------
-- 0050 stores one row PER ACCOUNT, keyed on account_id alone, so a ticking
-- account is an UPDATE rather than an INSERT and this is the arm the live path
-- actually takes all day. A generated column that were correct only at INSERT
-- would show a trader the movement from the FIRST tick of the day forever.
DO $$
DECLARE
  v_account uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  v_got     bigint;
BEGIN
  DELETE FROM live_account_state WHERE account_id = v_account;
  INSERT INTO live_account_state
    (account_id, trading_day, sequence, opening_equity_cents, equity_cents, feed)
  VALUES (v_account, '2026-10-01', 1, 5000000, 5000000, 'adr455');

  UPDATE live_account_state SET sequence = 2, equity_cents = 4900000
   WHERE account_id = v_account
   RETURNING intraday_movement_cents INTO v_got;

  IF v_got <> -100000 THEN
    RAISE EXCEPTION
      'SUCCESS 3 FAILED: the tick moved to 4900000 against an opening of 5000000 '
      'and the stored movement is % rather than -100000, so the movement is '
      'written at INSERT and left behind by the UPDATE the live path takes', v_got;
  END IF;
  RAISE NOTICE 'SUCCESS 3: the movement follows the tick and is now % cents', v_got;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4: MONEY. delta_cents IS OURS MINUS THEIRS, AND THE SIGN IS ASSERTED
-- ---------------------------------------------------------------------------
-- 0014: "Generated, so the two sides and their difference can never disagree."
-- ADR-443 section 6 could assert that both documents SPELL
-- `our_balance_cents - platform_balance_cents`; this asserts which way the
-- subtraction runs. A sign flip here reads a shortfall against the platform as a
-- surplus, on the table whose whole purpose is to set accounts.recon_blocked and
-- stop a trader's eligibility until a human resolves it.
--
-- FOUR ROWS: agreement, we hold more, we hold less, and both sides negative.
-- A mismatch must name its source (reconciliations_mismatch_names_sources) and
-- a match must have equal sides (reconciliations_status_matches_delta), so the
-- fixture rows satisfy both and the delta is read back afterwards.
DO $$
DECLARE
  v_account uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  v_got     bigint;
  v_case    record;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('the two sides agree',  5000000::bigint, 5000000::bigint,     0::bigint, 'match',    NULL),
      ('we hold more',         5000123::bigint, 5000000::bigint,   123::bigint, 'mismatch', 'ledger'),
      ('we hold less',         5000000::bigint, 5000123::bigint,  -123::bigint, 'mismatch', 'ledger'),
      ('both sides negative',     -250::bigint,    -100::bigint,  -150::bigint, 'mismatch', 'rule_state')
    ) AS t(label, ours, theirs, expected, status, source)
  LOOP
    DELETE FROM reconciliations WHERE account_id = v_account;
    INSERT INTO reconciliations
      (account_id, trading_day, our_balance_cents, platform_balance_cents, status, our_source)
    VALUES (v_account, '2026-10-01', v_case.ours, v_case.theirs, v_case.status, v_case.source)
    RETURNING delta_cents INTO v_got;

    IF v_got IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION
        'SUCCESS 4 FAILED on %: ours % against theirs % computed a delta of % and '
        'ours minus theirs is %. A sign flip renders a shortfall as a surplus',
        v_case.label, v_case.ours, v_case.theirs, v_got, v_case.expected;
    END IF;
    RAISE NOTICE 'SUCCESS 4: % gives a delta of % cents', v_case.label, v_got;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 5: MONEY. THE GENERATED DELTA AND THE CHECK THAT RESTATES IT AGREE
-- ---------------------------------------------------------------------------
-- 0014 says the same fact TWICE and in two languages. `delta_cents` is
-- generated from the two balances, and reconciliations_status_matches_delta is
-- a CHECK written over the two BALANCES rather than over the generated column:
-- a match has equal sides, a mismatch has unequal ones.
--
-- SO THE TABLE CARRIES A CLAIM NEITHER DOCUMENT COMPARISON CAN SEE: that the
-- column and the constraint mean the same thing. If they ever diverged, a row
-- could satisfy the CHECK as a `match` and carry a non-zero delta, which is
-- precisely the disagreement 0014 says cannot happen. It is asserted over every
-- row this file has written rather than over a fresh one.
DO $$
DECLARE
  v_account   uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  v_bad_match integer;
  v_bad_miss  integer;
  v_rows      integer;
BEGIN
  DELETE FROM reconciliations WHERE account_id = v_account;
  INSERT INTO reconciliations
    (account_id, trading_day, our_balance_cents, platform_balance_cents, status, our_source)
  VALUES (v_account, '2026-10-01', 5000000, 5000000, 'match',    NULL),
         (v_account, '2026-10-02', 5000123, 5000000, 'mismatch', 'ledger'),
         (v_account, '2026-10-03', 5000000, 5000123, 'mismatch', 'ledger'),
         (v_account, '2026-10-04',    -250,    -100, 'mismatch', 'rule_state');

  SELECT count(*) FILTER (WHERE status =  'match' AND delta_cents <> 0),
         count(*) FILTER (WHERE status <> 'match' AND delta_cents =  0),
         count(*)
    INTO v_bad_match, v_bad_miss, v_rows
    FROM reconciliations WHERE account_id = v_account;

  IF v_bad_match <> 0 OR v_bad_miss <> 0 THEN
    RAISE EXCEPTION
      'SUCCESS 5 FAILED: % rows are a match with a non-zero delta and % are a '
      'mismatch with a zero one, so the generated column and '
      'reconciliations_status_matches_delta no longer mean the same thing',
      v_bad_match, v_bad_miss;
  END IF;
  RAISE NOTICE
    'SUCCESS 5: over % rows, a match has a zero delta and a mismatch does not', v_rows;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 6: MONEY. rcr_bp AT THE OVERFLOW BOUND 0049 STATES IN A COMMENT
-- ---------------------------------------------------------------------------
-- THE ONE ADR-443 SECTION 8 ITEM 2 NAMES AS UNCHECKED, in its own words: 0049
-- "states the overflow bound in a comment and this row does not check it".
--
-- 0049's comment: "a coverage above 214,748x raises `integer out of range` on
-- insert". integer tops out at 2,147,483,647 and rcr_bp is basis points, so
-- 214,748x is 2,147,480,000 and fits with 3,647 to spare. This is the LAST
-- coverage the column can hold, and REJECTION 4 is the first it cannot.
--
-- A ZERO RESERVE IS ASSERTED BESIDE IT because it is the other end of the same
-- expression and it is a REPRESENTABLE state: reserve_cents >= 0 is the CHECK,
-- so zero is admitted and must read as 0 bp rather than as NULL. A book with no
-- reserve at all is maximally uncovered, and 0 bp is what arms the breaker
-- hardest.
--
-- probe_reserve_coverage.sql already holds 1.5x, 0.8x, exactly 1.0 and one cent
-- either side. Nothing here repeats those.
DO $$
DECLARE
  v_zero  integer;
  v_bound integer;
BEGIN
  INSERT INTO reserve_coverage_snapshots
    (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
  VALUES ('2026-10-01 23:00Z',      0, 'payout_wallet', '2026-10-01 12:00Z', 10000000),
         ('2026-10-02 23:00Z', 214748, 'payout_wallet', '2026-10-02 12:00Z',        1);

  SELECT rcr_bp INTO v_zero  FROM reserve_coverage_snapshots WHERE as_of = '2026-10-01 23:00Z';
  SELECT rcr_bp INTO v_bound FROM reserve_coverage_snapshots WHERE as_of = '2026-10-02 23:00Z';

  IF v_zero IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'SUCCESS 6 FAILED: a reserve of zero reads % bp rather than 0, so the most '
      'uncovered book this table can record is not the one that arms the breaker '
      'hardest', v_zero;
  END IF;
  IF v_bound <> 2147480000 THEN
    RAISE EXCEPTION
      'SUCCESS 6 FAILED: coverage of 214748x reads % bp rather than 2147480000, '
      'so 0049''s stated overflow bound is in the wrong place', v_bound;
  END IF;
  RAISE NOTICE
    'SUCCESS 6: a zero reserve is % bp and the stated bound of 214748x is % bp, '
    'the largest coverage an integer holds', v_zero, v_bound;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 7: mutable AND rate_limit_exempt OVER THE WHOLE CLASS VOCABULARY
-- ---------------------------------------------------------------------------
-- FIVE CLASSES AND TEN VALUES, WHICH IS THE ENTIRE TRUTH TABLE OF BOTH COLUMNS.
-- `class` is NOT NULL with a CHECK over exactly these five, so this is not a
-- sample: an `IN` over a NOT NULL text column is total, and neither generated
-- column can ever be NULL. Nothing outside this table is asserted.
--
-- THE FIFTH CLASS IS THE ROW TO READ, and 0029 makes two claims about it that
-- nothing had executed. Item 5 of its header: pre_identity_auth "is non-exempt
-- BY CONSTRUCTION... applied to an attacker-supplied number it funds SMS
-- pumping". And beside the ALTER: "the existing `mutable` column ALREADY GIVES
-- THE RIGHT ANSWER FOR THE NEW CLASS WITHOUT BEING TOUCHED... Nobody may opt
-- out of the OTP that proves they own the number they are registering."
-- Both are FALSE for pre_identity_auth and both are asserted below. The
-- exemption column decides whether an OTP send consults otp_send_budget at all.
DO $$
DECLARE
  v_case record;
  v_mut  boolean;
  v_exe  boolean;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('security',          false, true),
      ('money',             false, true),
      ('account_state',     true,  false),
      ('marketing',         true,  false),
      ('pre_identity_auth', false, false)
    ) AS t(class, mutable, exempt)
  LOOP
    INSERT INTO notification_kinds (kind, class, title, template_code)
    VALUES ('adr455_' || v_case.class, v_case.class, 'ADR-455', 'adr455_tpl')
    RETURNING mutable, rate_limit_exempt INTO v_mut, v_exe;

    IF v_mut IS DISTINCT FROM v_case.mutable THEN
      RAISE EXCEPTION
        'SUCCESS 7 FAILED: class % computed mutable = % and SD-M16-01 makes it %. '
        'A class silenceable that should not be is a notification a trader can '
        'turn off', v_case.class, v_mut, v_case.mutable;
    END IF;
    IF v_exe IS DISTINCT FROM v_case.exempt THEN
      RAISE EXCEPTION
        'SUCCESS 7 FAILED: class % computed rate_limit_exempt = % and INV-M16-11 '
        'makes it %. An exempt pre-identity class funds SMS pumping (0029 item 5)',
        v_case.class, v_exe, v_case.exempt;
    END IF;
    RAISE NOTICE 'SUCCESS 7: class % is mutable=% exempt=%', v_case.class, v_mut, v_exe;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 8: BOTH BOOLEANS FOLLOW A RECLASSIFIED KIND
-- ---------------------------------------------------------------------------
-- SD-M16-01's whole argument is that the two facts "cannot disagree at all". A
-- column correct only at INSERT would let a kind be reclassified from marketing
-- to money and stay silenceable and non-exempt, which is the exact drift the
-- column was generated to make impossible, arrived at through the one verb the
-- INSERT assertions cannot see.
DO $$
DECLARE v_mut boolean; v_exe boolean;
BEGIN
  UPDATE notification_kinds SET class = 'money' WHERE kind = 'adr455_marketing'
   RETURNING mutable, rate_limit_exempt INTO v_mut, v_exe;

  IF v_mut <> false OR v_exe <> true THEN
    RAISE EXCEPTION
      'SUCCESS 8 FAILED: a kind reclassified from marketing to money reads '
      'mutable=% exempt=% and money is mutable=false exempt=true, so a '
      'reclassified kind keeps its old answers', v_mut, v_exe;
  END IF;
  RAISE NOTICE 'SUCCESS 8: reclassifying to money gives mutable=% exempt=%', v_mut, v_exe;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 9: cadence MAPS ALL FOUR DIGESTS, AND TWO OF THEM SHARE AN ANSWER
-- ---------------------------------------------------------------------------
-- 0040: "the cadence is a PROPERTY OF THE DIGEST rather than a choice". The CASE
-- has four arms over three answers, and the two weekly digests sharing 'weekly'
-- is the reason a text comparison cannot check this one by shape: an arm
-- mis-wired to the wrong one of the two weeklies spells identically in both
-- documents and produces the identical string here as well. What the arms do
-- distinguish is a daily digest scheduled monthly, which is the failure 0040
-- names, and that is what this asserts.
DO $$
DECLARE
  v_case record;
  v_got  text;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('daily_liability',         'daily'),
      ('weekly_loss_ratio_cusum', 'weekly'),
      ('weekly_flag_queue',       'weekly'),
      ('monthly_revenue_cohort',  'monthly')
    ) AS t(digest, cadence)
  LOOP
    INSERT INTO report_schedules (digest, format, channel, recipients, created_by)
    VALUES (v_case.digest, 'csv', 'email', '{adr455@example.test}', 'adr455')
    RETURNING cadence INTO v_got;

    IF v_got IS DISTINCT FROM v_case.cadence THEN
      RAISE EXCEPTION
        'SUCCESS 9 FAILED: digest % is scheduled % and 0040 makes it %',
        v_case.digest, v_got, v_case.cadence;
    END IF;
    RAISE NOTICE 'SUCCESS 9: digest % is scheduled %', v_case.digest, v_got;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: MONEY. THE MOVEMENT CANNOT BE WRITTEN BY HAND
-- ---------------------------------------------------------------------------
-- THE HALF THAT MAKES EVERY SUCCESS ABOVE WORTH ASSERTING. If a writer can set
-- the movement, then the number a trader reads is whatever the ingest sent
-- rather than what the two equity figures beside it imply, and the argument
-- 0050 makes for generating it ("a movement written by the ingest could"
-- disagree) is gone. `apps/worker`'s upsert names the column nowhere, which
-- `live-ingest.test.ts` asserts over the statement text; this asserts what the
-- database would do if it did.
DO $$
DECLARE
  v_account uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  fired boolean := false; state text := ''; msg text := '';
BEGIN
  DELETE FROM live_account_state WHERE account_id = v_account;
  BEGIN
    INSERT INTO live_account_state
      (account_id, trading_day, sequence, opening_equity_cents, equity_cents, feed,
       intraday_movement_cents)
    VALUES (v_account, '2026-10-01', 1, 5000000, 5000000, 'adr455', 999999);
  EXCEPTION WHEN OTHERS THEN
    fired := true;
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 1 FAILED: a movement of 999999 was written by hand onto an '
      'account whose equity did not move, so the panel can be told anything';
  END IF;
  IF state <> '428C9' THEN
    RAISE EXCEPTION
      'REJECTION 1 fired with sqlstate % rather than 428C9 (generated_always): %',
      state, msg;
  END IF;
  RAISE NOTICE 'REJECTION 1: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: MONEY. THE RECONCILIATION DELTA CANNOT BE WRITTEN BY HAND
-- ---------------------------------------------------------------------------
-- REJECTION 1's argument on the second money column, and 0014's sentence is the
-- sharper one: "the two sides and their difference can never disagree". A
-- writable delta means a reconciliation can report agreement between two
-- balances that do not agree, on the table that blocks a trader's eligibility.
DO $$
DECLARE
  v_account uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  fired boolean := false; state text := ''; msg text := '';
BEGIN
  BEGIN
    INSERT INTO reconciliations
      (account_id, trading_day, our_balance_cents, platform_balance_cents,
       status, delta_cents)
    VALUES (v_account, '2026-10-05', 5000000, 5000000, 'match', 999999);
  EXCEPTION WHEN OTHERS THEN
    fired := true;
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 2 FAILED: a delta of 999999 was written onto a row whose two '
      'balances are equal, so a reconciliation can disagree with itself';
  END IF;
  IF state <> '428C9' THEN
    RAISE EXCEPTION
      'REJECTION 2 fired with sqlstate % rather than 428C9 (generated_always): %',
      state, msg;
  END IF;
  RAISE NOTICE 'REJECTION 2: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: MONEY. THE MOVEMENT OVERFLOWS LOUD RATHER THAN WRAPPING
-- ---------------------------------------------------------------------------
-- THE EDGE THE EXPRESSION'S OWN ARITHMETIC TURNS ON, and the direction is the
-- whole assertion. Both operands are bigint and their difference is a bigint,
-- so a subtraction that spans the type raises rather than wrapping. If it
-- wrapped, the largest possible loss would render as a gain, silently, on the
-- one number 0050 exists to show a trader.
--
-- The two operands here are the bigint extremes. 0050 puts no bound on either
-- and refuses to, so the states are representable and only the arithmetic
-- refuses them.
DO $$
DECLARE
  v_account uuid := (SELECT id FROM adr455_ids WHERE kind = 'account');
  fired boolean := false; state text := ''; msg text := '';
BEGIN
  DELETE FROM live_account_state WHERE account_id = v_account;
  BEGIN
    INSERT INTO live_account_state
      (account_id, trading_day, sequence, opening_equity_cents, equity_cents, feed)
    VALUES (v_account, '2026-10-01', 1,
            -9223372036854775808, 9223372036854775807, 'adr455');
  EXCEPTION WHEN OTHERS THEN
    fired := true;
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 3 FAILED: a movement spanning the whole bigint range was '
      'accepted, so the subtraction wrapped and a maximal loss renders as a gain';
  END IF;
  IF state <> '22003' THEN
    RAISE EXCEPTION
      'REJECTION 3 fired with sqlstate % rather than 22003 (numeric_value_out_of_range): %',
      state, msg;
  END IF;
  RAISE NOTICE 'REJECTION 3: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: MONEY. ONE COVERAGE ABOVE THE BOUND 0049 STATES
-- ---------------------------------------------------------------------------
-- SUCCESS 6's mirror, and together they pin the bound to a single integer.
-- 214,748x fits and 214,749x does not, which is exactly where 0049's comment
-- puts it: "a coverage above 214,748x raises `integer out of range` on insert.
-- That failure cannot be given a nicer name for the same reason NULLIF is
-- needed here". This is the assertion that says so if the type ever widens or
-- the multiplier moves, and it is the item ADR-443 section 8 item 2 left open.
DO $$
DECLARE fired boolean := false; state text := ''; msg text := '';
BEGIN
  BEGIN
    INSERT INTO reserve_coverage_snapshots
      (as_of, reserve_cents, treasury_account_code, treasury_as_of, cvar99_cents)
    VALUES ('2026-10-03 23:00Z', 214749, 'payout_wallet', '2026-10-03 12:00Z', 1);
  EXCEPTION WHEN OTHERS THEN
    fired := true;
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 4 FAILED: a coverage of 214749x was stored, so rcr_bp is no '
      'longer an integer and 0049''s stated bound is wrong';
  END IF;
  IF state <> '22003' THEN
    RAISE EXCEPTION
      'REJECTION 4 fired with sqlstate % rather than 22003: %', state, msg;
  END IF;
  RAISE NOTICE 'REJECTION 4: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: A FIFTH DIGEST IS REFUSED BY cadence, NOT BY THE CHECK ON digest
-- ---------------------------------------------------------------------------
-- 0040 RECORDS THIS AS SOMETHING IT RAN, and until now nothing re-ran it:
-- "Executed against PostgreSQL 16.13 while writing this file: a fifth digest is
-- refused by the NOT NULL on THIS column, not by the CHECK on `digest`, because
-- a generated column is computed before CHECK constraints are evaluated. So the
-- error message names `cadence` for a defect in `digest`, which is recorded here
-- so the next reader is not surprised by it."
--
-- THE COLUMN IS THE ASSERTION AND THE CONSTRAINT NAME CANNOT BE. A
-- not_null_violation carries an EMPTY CONSTRAINT_NAME, so this reads COLUMN_NAME
-- out of the same diagnostics: an assertion written against the constraint name
-- would match the empty string and pass against anything.
--
-- WHY IT MATTERS BEYOND THE MESSAGE: the pair is what makes admitting a fifth
-- digest a two-place edit. A migration widening the CHECK and forgetting the
-- CASE is stopped HERE, and this is the only thing that watches that arm.
DO $$
DECLARE fired boolean := false; state text := ''; col text := ''; msg text := '';
BEGIN
  BEGIN
    INSERT INTO report_schedules (digest, format, channel, recipients, created_by)
    VALUES ('adr455_invented_digest', 'csv', 'email', '{adr455@example.test}', 'adr455');
  EXCEPTION WHEN OTHERS THEN
    fired := true;
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, col = COLUMN_NAME, msg = MESSAGE_TEXT;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 5 FAILED: a digest with no CASE arm was scheduled, so the CASE '
      'has grown an ELSE and a half-admitted digest can exist';
  END IF;
  IF state <> '23502' THEN
    RAISE EXCEPTION
      'REJECTION 5 fired with sqlstate % rather than 23502 (not_null_violation), '
      'so the refusal is no longer the one 0040 recorded: %', state, msg;
  END IF;
  IF col <> 'cadence' THEN
    RAISE EXCEPTION
      'REJECTION 5 named column % rather than cadence. 0040 records that the '
      'generated column is computed BEFORE the CHECK on digest and therefore '
      'refuses first; a different column here means that order has changed', col;
  END IF;
  RAISE NOTICE 'REJECTION 5: a fifth digest is refused by the NOT NULL on %, sqlstate %',
    col, state;
END $$;

\echo 'probe_generated_column_values: 9 successes and 5 rejections hold, over all 6 generated columns, executed rather than spelled.'

ROLLBACK;
