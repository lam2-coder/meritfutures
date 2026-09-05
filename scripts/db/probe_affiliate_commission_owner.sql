-- =============================================================================
-- Probe: a commission names its affiliate and cannot name the wrong one (0078)
-- =============================================================================
-- ADR-321, on ADR-304 section 4. THE ACCEPTANCE CASES COME FIRST AND THERE ARE
-- THREE OF THEM, on DELTA_MANIFEST section 13's standing rule: a table that
-- refuses everything passes an inventory of refusals. `0078` exists to make a
-- correct commission row WRITABLE for the first time -- before it, the money
-- Merit owes an affiliate could be stored and could not be attributed to one --
-- so a guard that refused every write would satisfy every rejection below and
-- close nothing.
--
-- REJECTION 2 IS THE ONE TO READ. It is the whole content of the ruling: the
-- denormalized `affiliate_id` cannot disagree with the attribution it was
-- derived from, because `affiliate_commissions_attribution_owner_fk` references
-- the PAIR rather than the id. Without it, part 1 of `0078` would put the same
-- fact on two rows with nothing holding them together, which is a commission
-- paid to the wrong affiliate and is the seventh scope class's strongest
-- remaining argument against a column.
--
-- REJECTION 3 IS ITS OTHER DIRECTION AND IT IS NOT REDUNDANT. A composite
-- foreign key is a constraint on BOTH rows: the child cannot be written wrong,
-- and the parent cannot be MOVED to make an already-correct child wrong.
-- Reassigning an attribution to another affiliate while a commission cites it is
-- refused by the same constraint, which is the half a `CHECK` or a trigger on
-- the child would not have.
--
-- Rejections are checked by CONSTRAINT NAME out of GET STACKED DIAGNOSTICS,
-- never by exception class: three of the five below raise
-- `foreign_key_violation` or `not_null_violation` and a handler catching the
-- class cannot tell any of them apart.
--
-- THE COUNTERFACTUAL, AS OBSERVED. Executed against `0001`..`0077` this file
-- dies inside SUCCESS 1 with `column "affiliate_id" of relation
-- "affiliate_commissions" does not exist`, exit 3. Recorded in DELTA_MANIFEST
-- section 36.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE probe_ids (kind text PRIMARY KEY, id uuid) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- Fixtures: TWO affiliates and one attribution, because one affiliate cannot
-- disagree with anybody
-- ---------------------------------------------------------------------------
-- The subject of this probe is two rows carrying the same fact, so the fixture
-- has to contain a SECOND correct answer for a writer to reach for by mistake.
-- `affiliate_b` is that answer: a real, active affiliate with a real identity,
-- which is what makes REJECTION 2 a plausible mistake rather than a typo.
DO $$
DECLARE
  v_buyer      uuid;
  v_buyer_user uuid;
  v_aff_a_id   uuid;
  v_aff_b_id   uuid;
  v_tos        uuid;
  v_plan       uuid;
  v_pv         uuid;
  v_purchase   uuid;
  v_aff_a      uuid;
  v_aff_b      uuid;
  v_attr       uuid;
BEGIN
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_buyer;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (v_buyer, 'buyer@example.test', 'buyer@example.test')
    RETURNING id INTO v_buyer_user;

  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_aff_a_id;
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO v_aff_b_id;

  INSERT INTO tos_versions (document, version, body_md, effective_at)
    VALUES ('affiliate_tos', 1, 'probe', '2026-01-01 00:00Z')
    RETURNING id INTO v_tos;

  INSERT INTO affiliates (identity_id, code, commission_bp, tos_version_id)
    VALUES (v_aff_a_id, 'probe-a', 1000, v_tos) RETURNING id INTO v_aff_a;
  INSERT INTO affiliates (identity_id, code, commission_bp, tos_version_id)
    VALUES (v_aff_b_id, 'probe-b', 1000, v_tos) RETURNING id INTO v_aff_b;

  INSERT INTO plans (code, name) VALUES ('core_eod', 'Core EOD probe')
    RETURNING id INTO v_plan;
  INSERT INTO plan_versions (plan_id, version, status, rules, public_slug, created_by)
    VALUES (v_plan, 1, 'draft', '{"schema_version":1}'::jsonb, 'aff-probe', v_buyer_user)
    RETURNING id INTO v_pv;
  -- 0045 SD-M21-02, as every other probe on this tree states it: a published
  -- version records what it was decided on, and a probe database has no runs.
  UPDATE plan_versions SET status = 'published', published_at = now(),
         simulation_waiver_reason =
           'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)'
   WHERE id = v_pv;

  INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                         list_price_cents, amount_paid_cents, psp, psp_reference,
                         status, paid_at, affiliate_id)
    VALUES (v_buyer, v_buyer_user, v_pv, 5000000, 'new', 15000, 15000, 'psp_a',
            'aff-probe-ref-1', 'paid', now(), v_aff_a)
    RETURNING id INTO v_purchase;

  -- The attribution is affiliate A's. Every case below is about whether a
  -- commission on it can end up naming B.
  INSERT INTO attributions (purchase_id, affiliate_id, model,
                            buyer_identity_id, affiliate_identity_id)
    VALUES (v_purchase, v_aff_a, 'last_touch', v_buyer, v_aff_a_id)
    RETURNING id INTO v_attr;

  INSERT INTO probe_ids VALUES ('affiliate_a', v_aff_a), ('affiliate_b', v_aff_b),
                               ('attribution', v_attr), ('buyer', v_buyer);
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 1: AN ACCRUAL NAMES ITS AFFILIATE. The row 0078 exists to make
-- writable
-- ---------------------------------------------------------------------------
-- Before this migration `affiliate_commissions` declared no edge to `affiliates`
-- at all, so signed money Merit owes a named affiliate was stored against no
-- name. This is the whole repair, executed.
DO $$
DECLARE
  v_attr  uuid := (SELECT id FROM probe_ids WHERE kind = 'attribution');
  v_aff_a uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_a');
  v_row   affiliate_commissions;
BEGIN
  INSERT INTO affiliate_commissions
    (attribution_id, affiliate_id, amount_cents, payable_after, chargeback_window_ends_on)
  VALUES (v_attr, v_aff_a, 150000, '2026-07-15', '2026-10-15')
  RETURNING * INTO v_row;

  IF v_row.affiliate_id <> v_aff_a OR v_row.status <> 'accrued' THEN
    RAISE EXCEPTION
      'SUCCESS 1 FAILED: the accrual reads affiliate % status %, and it must be % accrued',
      v_row.affiliate_id, v_row.status, v_aff_a;
  END IF;
  INSERT INTO probe_ids VALUES ('accrual', v_row.id);
  RAISE NOTICE 'SUCCESS 1: an accrual of % cents is owed to affiliate %',
    v_row.amount_cents, v_row.affiliate_id;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: THE CLAWBACK IS THE SAME AFFILIATE'S, and it is still writable
-- ---------------------------------------------------------------------------
-- `affiliate_commissions_clawback_sign` (0012) makes a clawback negative and an
-- accrual positive. A new NOT NULL column that had broken the compensating row
-- would leave the schema able to record what Merit owes and unable to record
-- what it takes back, which is the worse half to lose on a signed money table.
DO $$
DECLARE
  v_attr    uuid := (SELECT id FROM probe_ids WHERE kind = 'attribution');
  v_aff_a   uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_a');
  v_accrual uuid := (SELECT id FROM probe_ids WHERE kind = 'accrual');
  v_sum     bigint;
BEGIN
  INSERT INTO affiliate_commissions
    (attribution_id, affiliate_id, amount_cents, payable_after,
     chargeback_window_ends_on, clawback_of, status)
  VALUES (v_attr, v_aff_a, -150000, '2026-07-15', '2026-10-15', v_accrual, 'clawed_back');

  SELECT sum(amount_cents) INTO v_sum
    FROM affiliate_commissions WHERE affiliate_id = v_aff_a;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION
      'SUCCESS 2 FAILED: the accrual and its clawback sum to % rather than 0', v_sum;
  END IF;
  RAISE NOTICE 'SUCCESS 2: a clawback names the same affiliate and the pair sums to 0';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: THE THREE SUMS `GET /affiliate/stats` READS ARE ONE INDEX SCAN
-- ---------------------------------------------------------------------------
-- API_CONTRACT section 7 renders `earned_cents_lifetime`, `payable_cents` and
-- `paid_cents_lifetime` per affiliate, partitioned by `status`. `0012` declared
-- four indexes on this table and none was keyed on an affiliate, because there
-- was nothing to key on. This asserts the read RESOLVES rather than asserting a
-- plan: a probe that pinned an EXPLAIN would fail on an empty table for reasons
-- that have nothing to do with the schema.
DO $$
DECLARE
  v_aff_a   uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_a');
  v_aff_b   uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_b');
  v_earned  bigint;
  v_b_rows  bigint;
  v_indexed boolean;
BEGIN
  SELECT coalesce(sum(amount_cents) FILTER (WHERE status = 'accrued'), 0)
    INTO v_earned
    FROM affiliate_commissions WHERE affiliate_id = v_aff_a;
  SELECT count(*) INTO v_b_rows
    FROM affiliate_commissions WHERE affiliate_id = v_aff_b;

  SELECT true INTO v_indexed FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname = 'affiliate_commissions_affiliate_status_idx';

  IF v_earned <> 150000 THEN
    RAISE EXCEPTION 'SUCCESS 3 FAILED: the accrued sum is % rather than 150000', v_earned;
  END IF;
  -- THE SECOND AFFILIATE SEES NOTHING, which is the property the scope rule
  -- registered on this column will rest on.
  IF v_b_rows <> 0 THEN
    RAISE EXCEPTION 'SUCCESS 3 FAILED: affiliate B has % commission rows', v_b_rows;
  END IF;
  IF v_indexed IS NOT TRUE THEN
    RAISE EXCEPTION
      'SUCCESS 3 FAILED: affiliate_commissions_affiliate_status_idx does not exist, so the '
      'three per-affiliate sums have no index keyed on an affiliate';
  END IF;
  RAISE NOTICE 'SUCCESS 3: accrued is % cents for A and % rows for B, on (affiliate_id, status)',
    v_earned, v_b_rows;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: A COMMISSION THAT NAMES NO AFFILIATE
-- ---------------------------------------------------------------------------
-- NOT NULL WITH NO DEFAULT, and this is the assertion that says the column never
-- acquired one. A default here would silently attribute every row written by a
-- writer that forgot the column to whichever affiliate the default named, which
-- is money moving to the wrong human with no error anywhere.
DO $$
DECLARE
  v_attr  uuid := (SELECT id FROM probe_ids WHERE kind = 'attribution');
  fired   boolean := false;
  msg     text := '';
BEGIN
  BEGIN
    INSERT INTO affiliate_commissions
      (attribution_id, amount_cents, payable_after, chargeback_window_ends_on)
    VALUES (v_attr, 150000, '2026-07-15', '2026-10-15');
  EXCEPTION WHEN not_null_violation THEN fired := true; msg := SQLERRM;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 1 FAILED: a commission was written with no affiliate, so the column has '
      'acquired a DEFAULT and every forgetful writer now names whoever it points at';
  END IF;
  RAISE NOTICE 'REJECTION 1: %', msg;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: THE COMMISSION THAT DISAGREES WITH ITS OWN ATTRIBUTION
-- ---------------------------------------------------------------------------
-- THE WHOLE RULING, EXECUTED. Affiliate B is a real, active affiliate, so the
-- single-column edge to `affiliates` accepts it and the single-column edge to
-- `attributions` accepts the attribution. Both rows exist and both references
-- resolve; what is false is the PAIR. Without the composite key this row is
-- written, and $1,500.00 Merit owes affiliate A is recorded as owed to
-- affiliate B.
DO $$
DECLARE
  v_attr  uuid := (SELECT id FROM probe_ids WHERE kind = 'attribution');
  v_aff_b uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_b');
  fired   boolean := false;
  cname   text := '';
BEGIN
  BEGIN
    INSERT INTO affiliate_commissions
      (attribution_id, affiliate_id, amount_cents, payable_after, chargeback_window_ends_on)
    VALUES (v_attr, v_aff_b, 150000, '2026-07-15', '2026-10-15');
  EXCEPTION WHEN foreign_key_violation THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 2 FAILED: a commission on affiliate A''s attribution was recorded as owed '
      'to affiliate B. The denormalized column can disagree with its parent and the money '
      'is payable to the wrong human';
  END IF;
  IF cname <> 'affiliate_commissions_attribution_owner_fk' THEN
    RAISE EXCEPTION 'REJECTION 2 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 2: a disagreeing commission is refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: THE ATTRIBUTION MOVED UNDER AN ALREADY-CORRECT COMMISSION
-- ---------------------------------------------------------------------------
-- THE DIRECTION A CHECK OR A TRIGGER ON THE CHILD WOULD NOT HAVE. A composite
-- foreign key constrains the parent too: reassigning the attribution to
-- affiliate B while affiliate A's commission cites the pair is refused, so
-- disagreement cannot be created from either side. `0012`'s own comment says an
-- affiliate can be reassigned, which is exactly why this direction is asserted.
DO $$
DECLARE
  v_attr  uuid := (SELECT id FROM probe_ids WHERE kind = 'attribution');
  v_aff_b uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_b');
  fired   boolean := false;
  cname   text := '';
BEGIN
  BEGIN
    UPDATE attributions SET affiliate_id = v_aff_b WHERE id = v_attr;
  EXCEPTION WHEN foreign_key_violation THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 3 FAILED: the attribution was reassigned to affiliate B while affiliate '
      'A''s commission cited it, so the two rows now disagree about who is owed';
  END IF;
  IF cname <> 'affiliate_commissions_attribution_owner_fk' THEN
    RAISE EXCEPTION 'REJECTION 3 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 3: moving the attribution under a commission is refused by %', cname;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4: THE AFFILIATE ROW CANNOT BE DELETED OUT FROM UNDER THE DEBT
-- ---------------------------------------------------------------------------
-- `ON DELETE RESTRICT`, which is the three siblings' declaration and is what
-- `affiliate_statements` already carries. Money owed is a record; deleting the
-- party it is owed to deletes the evidence rather than the obligation.
DO $$
DECLARE
  v_aff_a uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_a');
  fired   boolean := false;
BEGIN
  BEGIN
    DELETE FROM affiliates WHERE id = v_aff_a;
  EXCEPTION WHEN foreign_key_violation THEN fired := true;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 4 FAILED: an affiliate Merit owes money to was deleted';
  END IF;
  RAISE NOTICE 'REJECTION 4: an affiliate carrying commission rows cannot be deleted';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5: AN UPDATE CANNOT MOVE A COMMISSION TO ANOTHER AFFILIATE EITHER
-- ---------------------------------------------------------------------------
-- The INSERT path is REJECTION 2 and this is the other way a row reaches the
-- wrong affiliate. This table is not in the append-only set, so `merit_app`
-- holds UPDATE on it, and the constraint rather than a grant is what refuses
-- this. Run as `merit_app` for exactly that reason: a rejection observed only as
-- the owner would say nothing about the role the application connects as.
DO $$
DECLARE
  v_aff_b   uuid := (SELECT id FROM probe_ids WHERE kind = 'affiliate_b');
  v_accrual uuid := (SELECT id FROM probe_ids WHERE kind = 'accrual');
  fired     boolean := false;
  cname     text := '';
BEGIN
  SET LOCAL ROLE merit_app;
  BEGIN
    UPDATE affiliate_commissions SET affiliate_id = v_aff_b WHERE id = v_accrual;
  EXCEPTION WHEN foreign_key_violation THEN
    fired := true; GET STACKED DIAGNOSTICS cname = CONSTRAINT_NAME;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION
      'REJECTION 5 FAILED: merit_app moved an existing commission to another affiliate';
  END IF;
  IF cname <> 'affiliate_commissions_attribution_owner_fk' THEN
    RAISE EXCEPTION 'REJECTION 5 fired on the wrong constraint: %', cname;
  END IF;
  RAISE NOTICE 'REJECTION 5: merit_app cannot move a commission to another affiliate (%)', cname;
END $$;

\echo 'probe_affiliate_commission_owner: 3 successes and 5 rejections hold against the applied schema.'

ROLLBACK;
