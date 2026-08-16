-- =============================================================================
-- scripts/db/probe_payout_hold.sql
-- =============================================================================
-- ADR-040's payout hold and ADR-041's restriction episode, probed against a real
-- database. FOLD-02 section 9 item 6.
--
-- IT LEADS WITH THE SUCCESS CASES, and that is not a stylistic choice. Every
-- probe in this corpus before ADR-035 attempted a forbidden thing and asserted a
-- rejection, so every one of them passed against a guard that rejected
-- EVERYTHING, and the one guard that did reject everything went unnoticed
-- through a founder-grade review and a 27-file install check. A hold that cannot
-- be written at all satisfies every rejection assertion below and pays nobody.
--
-- Each rejection is checked BY CONSTRAINT NAME in the message text, never by
-- "an exception happened". A fixture broken in a way that trips a different
-- constraint would otherwise score as the guard working, which is exactly how
-- ADR-035's `undefined_column` read as immutability holding.
--
-- Run against a database with the full migration set applied:
--   psql -v ON_ERROR_STOP=1 -q -f scripts/db/probe_payout_hold.sql
--
-- Everything happens inside one transaction that is ROLLED BACK. The probe
-- leaves no rows behind.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE probe_result(step text, verdict text) ON COMMIT DROP;

DO $probe$
DECLARE
  ident   uuid;
  usr     uuid;
  plan    uuid;
  pv      uuid;
  flag    uuid;
  acct_a  uuid;
  acct_b  uuid;
  held    uuid;
  msg     text;
  kept    boolean;
BEGIN
  -- The fixture is built in dependency order rather than mocked: accounts needs
  -- a purchase and a purchase needs a plan_version. A probe against a shape the
  -- application will never write proves nothing about the shape it will.
  INSERT INTO identities (status) VALUES ('active') RETURNING id INTO ident;
  INSERT INTO users (identity_id, email, email_normalized)
    VALUES (ident, 'probe-hold@example.test', 'probehold@example.test')
    RETURNING id INTO usr;
  INSERT INTO plans (code, name) VALUES ('probe_hold_plan', 'Probe hold')
    RETURNING id INTO plan;
  INSERT INTO plan_versions (plan_id, version, status, rules, public_slug,
                             published_at, created_by)
    VALUES (plan, 1, 'published', '{"phase_funded":{"max_payouts":5}}'::jsonb,
            'probe-hold-v1', now(), 'probe')
    RETURNING id INTO pv;

  -- A severity-5 flag, because an unresolved HIGH-SEVERITY flag at request time
  -- is the entry condition ADR-040 names. risk_flags_high_severity_has_sla
  -- requires the clock, which is SD-M7-02 doing its job on the fixture.
  INSERT INTO risk_flags (identity_id, flag_type, severity, evidence,
                          first_detected_on, sla_due_at)
    VALUES (ident, 'payment_velocity', 5, '{"probe":true}'::jsonb,
            current_date, now() + interval '4 hours')
    RETURNING id INTO flag;

  INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                         list_price_cents, discount_cents, amount_paid_cents,
                         psp, psp_reference, status, paid_at)
    VALUES (ident, usr, pv, 5000000, 'new', 50000, 0, 50000,
            'psp_a', 'probe-ref-a', 'paid', now());
  INSERT INTO accounts (identity_id, user_id, purchase_id, plan_version_id,
                        size_cents, phase, status, opened_on, funded_on)
    SELECT ident, usr, p.id, pv, 5000000, 'funded', 'active', current_date, current_date
      FROM purchases p WHERE p.psp_reference = 'probe-ref-a'
    RETURNING id INTO acct_a;

  INSERT INTO purchases (identity_id, user_id, plan_version_id, size_cents, kind,
                         list_price_cents, discount_cents, amount_paid_cents,
                         psp, psp_reference, status, paid_at)
    VALUES (ident, usr, pv, 5000000, 'new', 50000, 0, 50000,
            'psp_a', 'probe-ref-b', 'paid', now());
  INSERT INTO accounts (identity_id, user_id, purchase_id, plan_version_id,
                        size_cents, phase, status, opened_on, funded_on)
    SELECT ident, usr, p.id, pv, 5000000, 'funded', 'active', current_date, current_date
      FROM purchases p WHERE p.psp_reference = 'probe-ref-b'
    RETURNING id INTO acct_b;

  -- ---------------------------------------------------------------------------
  -- 1. SUCCESS. A HOLD IS WRITABLE AT ALL.
  --
  --    The first assertion, because it is the one whose absence every rejection
  --    below would survive. It also exercises ADR-040's ruling that a held
  --    request stores the FULL evaluated decision: every NOT NULL and every
  --    existing CHECK on payout_requests is satisfied by a held row, which is
  --    why 0031 relaxes none of them.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO payout_requests (
      account_id, identity_id, requested_cents, approved_cents, trader_cents,
      firm_cents, basis_trading_day, plan_version_id, eligibility_snapshot,
      status, idempotency_key, payout_ordinal,
      held_at, hold_flag_id, hold_expires_at)
    VALUES (acct_a, ident, 100000, 100000, 90000, 10000, current_date, pv,
            '{"gates":{}}'::jsonb, 'held_pending_review', 'probe-hold-1', 1,
            now(), flag, now() + interval '48 hours')
    RETURNING id INTO held;
    INSERT INTO probe_result VALUES ('a held request is writable', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('a held request is writable', 'FAIL: ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- 2. SUCCESS. A SECOND OUTSTANDING REQUEST ON THE SAME ACCOUNT IS REFUSED.
  --
  --    THE POINT OF THE WHOLE PREDICATE WIDENING. Against 0010's
  --    ('approved','frozen') this INSERT succeeds and G-NO-IN-FLIGHT is enforced
  --    by nothing while a request is held: the C-02 defect, verbatim.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO payout_requests (
      account_id, identity_id, requested_cents, approved_cents, trader_cents,
      firm_cents, basis_trading_day, plan_version_id, eligibility_snapshot,
      status, idempotency_key, payout_ordinal)
    VALUES (acct_a, ident, 50000, 50000, 45000, 5000, current_date, pv,
            '{"gates":{}}'::jsonb, 'approved', 'probe-hold-2', 2);
    INSERT INTO probe_result VALUES
      ('a held request blocks a second outstanding one',
       'FAIL: ACCEPTED. The SD-09 predicate does not cover held_pending_review');
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES
        ('a held request blocks a second outstanding one',
         CASE WHEN msg LIKE '%payout_requests_no_in_flight_uq%' THEN 'PASS'
              ELSE 'FAIL: refused by something else: ' || msg END);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES
        ('a held request blocks a second outstanding one',
         'FAIL: wrong error class, the fixture is broken rather than the index: ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- 3. SUCCESS. THE AUTO-RELEASE PAYS, AND THE HOLD STAYS PROVABLE.
  --
  --    ADR-040: a held request that reaches auto-release PAYS, even if the
  --    account breached during the hold, because the alternative is that Merit's
  --    own hold cost the trader money. Release is mechanical and re-evaluates
  --    nothing.
  --
  --    The second half is 0031's departure from the freeze trio's shape,
  --    executed rather than argued: the trio survives the release, so "Merit
  --    held this payout and paid it at the SLA" is provable FROM THE ROW.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE payout_requests
       SET status = 'settled', settled_at = now(),
           settled_trading_day = current_date, effective_trading_day = current_date
     WHERE id = held;
    SELECT held_at IS NOT NULL AND hold_flag_id IS NOT NULL
             AND hold_expires_at IS NOT NULL
      INTO kept FROM payout_requests WHERE id = held;
    INSERT INTO probe_result VALUES
      ('a held request releases and pays',
       CASE WHEN kept THEN 'PASS'
            ELSE 'FAIL: released, but the hold trio did not survive it' END);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('a held request releases and pays', 'FAIL: ' || msg);
  END;

  -- ---------------------------------------------------------------------------
  -- 4. SUCCESS. ENFORCEMENT FREES THE LADDER RUNG.
  --
  --    EC-037 and SD-05: a request that does not pay must not consume a rung of
  --    a finite ladder. Enforcement sends the hold to 'failed', and the ordinal
  --    is then re-usable because payout_requests_account_ordinal_uq is partial.
  --    Probed on the second account so the settled row above is not in the way.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO payout_requests (
      account_id, identity_id, requested_cents, approved_cents, trader_cents,
      firm_cents, basis_trading_day, plan_version_id, eligibility_snapshot,
      status, idempotency_key, payout_ordinal,
      held_at, hold_flag_id, hold_expires_at)
    VALUES (acct_b, ident, 100000, 100000, 90000, 10000, current_date, pv,
            '{"gates":{}}'::jsonb, 'held_pending_review', 'probe-hold-3', 1,
            now(), flag, now() + interval '48 hours');
    UPDATE payout_requests SET status = 'failed'
     WHERE account_id = acct_b AND idempotency_key = 'probe-hold-3';
    INSERT INTO payout_requests (
      account_id, identity_id, requested_cents, approved_cents, trader_cents,
      firm_cents, basis_trading_day, plan_version_id, eligibility_snapshot,
      status, idempotency_key, payout_ordinal)
    VALUES (acct_b, ident, 100000, 100000, 90000, 10000, current_date, pv,
            '{"gates":{}}'::jsonb, 'approved', 'probe-hold-4', 1);
    INSERT INTO probe_result VALUES ('enforcement frees the ordinal', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('enforcement frees the ordinal', 'FAIL: ' || msg);
  END;

END;
$probe$;

-- The rejection battery. Each row is one INSERT that must be refused, and by
-- the NAMED constraint. Written as data rather than as eighteen copies of the
-- same BEGIN/EXCEPTION block, in probe_plan_version_immutability.sql's idiom.
DO $rejections$
DECLARE
  probe record;
  msg   text;
  ident uuid;
  acct  uuid;
  flag  uuid;
  pv    uuid;
BEGIN
  SELECT id INTO ident FROM identities
    WHERE id IN (SELECT identity_id FROM users WHERE email = 'probe-hold@example.test');
  SELECT id INTO flag FROM risk_flags WHERE identity_id = ident LIMIT 1;
  SELECT id INTO pv FROM plan_versions WHERE public_slug = 'probe-hold-v1';
  SELECT a.id INTO acct FROM accounts a
    JOIN purchases p ON p.id = a.purchase_id
   WHERE p.psp_reference = 'probe-ref-a';

  FOR probe IN
    SELECT * FROM (VALUES
      ('payout_requests_hold_is_complete',
       'a hold with a flag and no clock',
       format($q$INSERT INTO payout_requests (account_id, identity_id, requested_cents,
                 approved_cents, trader_cents, firm_cents, basis_trading_day, plan_version_id,
                 eligibility_snapshot, status, idempotency_key, payout_ordinal,
                 held_at, hold_flag_id, hold_expires_at)
                 VALUES (%L, %L, 100000, 100000, 90000, 10000, current_date, %L,
                 '{}'::jsonb, 'held_pending_review', 'probe-rej-1', 9, now(), %L, NULL)$q$,
                 acct, ident, pv, flag)),

      ('payout_requests_hold_is_complete',
       'a hold with a clock and no flag',
       format($q$INSERT INTO payout_requests (account_id, identity_id, requested_cents,
                 approved_cents, trader_cents, firm_cents, basis_trading_day, plan_version_id,
                 eligibility_snapshot, status, idempotency_key, payout_ordinal,
                 held_at, hold_flag_id, hold_expires_at)
                 VALUES (%L, %L, 100000, 100000, 90000, 10000, current_date, %L,
                 '{}'::jsonb, 'held_pending_review', 'probe-rej-2', 9, now(), NULL,
                 now() + interval '48 hours')$q$, acct, ident, pv)),

      ('payout_requests_hold_is_complete',
       'the held status with no hold at all',
       format($q$INSERT INTO payout_requests (account_id, identity_id, requested_cents,
                 approved_cents, trader_cents, firm_cents, basis_trading_day, plan_version_id,
                 eligibility_snapshot, status, idempotency_key, payout_ordinal)
                 VALUES (%L, %L, 100000, 100000, 90000, 10000, current_date, %L,
                 '{}'::jsonb, 'held_pending_review', 'probe-rej-3', 9)$q$, acct, ident, pv)),

      ('payout_requests_hold_expiry_after_held',
       'a hold that expires before it starts',
       format($q$INSERT INTO payout_requests (account_id, identity_id, requested_cents,
                 approved_cents, trader_cents, firm_cents, basis_trading_day, plan_version_id,
                 eligibility_snapshot, status, idempotency_key, payout_ordinal,
                 held_at, hold_flag_id, hold_expires_at)
                 VALUES (%L, %L, 100000, 100000, 90000, 10000, current_date, %L,
                 '{}'::jsonb, 'held_pending_review', 'probe-rej-4', 9, now(), %L,
                 now() - interval '1 hour')$q$, acct, ident, pv, flag)),

      ('identity_restriction_episodes_restore_is_complete',
       'a restore with no actor',
       format($q$INSERT INTO identity_restriction_episodes (identity_id, flag_id,
                 tos_clause, reason, opened_by, restored_at)
                 VALUES (%L, %L, 'ToS 5.3', 'probe', 'admin:probe', now())$q$, ident, flag)),

      ('identity_restriction_episodes_restore_is_complete',
       'a restoring actor with no restore',
       format($q$INSERT INTO identity_restriction_episodes (identity_id, flag_id,
                 tos_clause, reason, opened_by, restored_by, restore_evidence)
                 VALUES (%L, %L, 'ToS 5.3', 'probe', 'admin:probe', 'admin:probe2',
                 'setpoint confirmed')$q$, ident, flag)),

      ('identity_restriction_episodes_sla_after_open',
       'an SLA already past due when the episode opens',
       format($q$INSERT INTO identity_restriction_episodes (identity_id, flag_id,
                 tos_clause, reason, opened_by, opened_at, sla_due_at)
                 VALUES (%L, %L, 'ToS 5.3', 'probe', 'admin:probe', now(),
                 now() - interval '1 hour')$q$, ident, flag)),

      ('identity_restriction_episodes_restore_after_open',
       'a restore that precedes the restriction it reverses',
       format($q$INSERT INTO identity_restriction_episodes (identity_id, flag_id,
                 tos_clause, reason, opened_by, opened_at, restored_at, restored_by,
                 restore_evidence)
                 VALUES (%L, %L, 'ToS 5.3', 'probe', 'admin:probe', now(),
                 now() - interval '1 hour', 'admin:probe2', 'setpoint confirmed')$q$,
                 ident, flag))
    ) AS t(cname, label, stmt)
  LOOP
    BEGIN
      EXECUTE probe.stmt;
      INSERT INTO probe_result VALUES (probe.label, 'FAIL: ACCEPTED');
    EXCEPTION
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
        INSERT INTO probe_result VALUES (probe.label,
          CASE WHEN msg LIKE '%' || probe.cname || '%' THEN 'PASS'
               ELSE 'FAIL: rejected by a DIFFERENT constraint: ' || msg END);
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
        INSERT INTO probe_result VALUES (probe.label,
          'FAIL: wrong error class, the fixture is broken rather than the constraint: ' || msg);
    END;
  END LOOP;
END;
$rejections$;

-- The external leg, and the restriction episode's own uniqueness. Both need a
-- success and a rejection in sequence, so they are their own block.
DO $legs$
DECLARE
  ident uuid;
  flag  uuid;
  wd    uuid;
  epi   uuid;
  msg   text;
BEGIN
  SELECT identity_id INTO ident FROM users WHERE email = 'probe-hold@example.test';
  SELECT id INTO flag FROM risk_flags WHERE identity_id = ident LIMIT 1;

  -- -------------------------------------------------------------------------
  -- THE EXTERNAL LEG. A halted withdrawal is still 'approved' as far as the
  -- rail is concerned (the halt is ORTHOGONAL, ADR-040), so the write below is
  -- the state 0011 already permitted and nothing refused.
  -- -------------------------------------------------------------------------
  INSERT INTO wallet_withdrawals (identity_id, amount_cents, destination_ref,
                                  status, idempotency_key, frozen_at,
                                  freeze_flag_id, freeze_expires_at,
                                  source_provenance_summary, earliest_credit_at)
  VALUES (ident, 90000, 'rise:probe-dest', 'approved', 'probe-wd-1', now(), flag,
          now() + interval '48 hours', '{"payout":90000}'::jsonb,
          now() - interval '3 days')
  RETURNING id INTO wd;
  INSERT INTO probe_result VALUES ('a halted withdrawal is representable', 'PASS');

  BEGIN
    UPDATE wallet_withdrawals SET status = 'settled', settled_at = now() WHERE id = wd;
    INSERT INTO probe_result VALUES ('a halted withdrawal cannot settle',
      'FAIL: ACCEPTED. The halt is representable and unenforced');
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES ('a halted withdrawal cannot settle',
        CASE WHEN msg LIKE '%wallet_withdrawals_frozen_cannot_settle%' THEN 'PASS'
             ELSE 'FAIL: rejected by a DIFFERENT constraint: ' || msg END);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES ('a halted withdrawal cannot settle',
        'FAIL: wrong error class: ' || msg);
  END;

  -- Release resumes the rail. It does not re-pay: the money was already the
  -- trader's before the halt, which is the ledger discriminator ADR-040 uses to
  -- keep this leg out of payout_requests.status.
  BEGIN
    UPDATE wallet_withdrawals
       SET frozen_at = NULL, freeze_flag_id = NULL, freeze_expires_at = NULL
     WHERE id = wd;
    UPDATE wallet_withdrawals SET status = 'settled', settled_at = now() WHERE id = wd;
    INSERT INTO probe_result VALUES ('a released withdrawal settles', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('a released withdrawal settles', 'FAIL: ' || msg);
  END;

  -- -------------------------------------------------------------------------
  -- THE RESTRICTION EPISODE. One open episode per identity, and a restore is
  -- what re-opens the door.
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO identity_restriction_episodes (identity_id, flag_id, tos_clause,
                                               reason, opened_by, sla_due_at)
    VALUES (ident, flag, 'ToS 5.3', 'ring membership, probe',
            'admin:probe', now() + interval '48 hours')
    RETURNING id INTO epi;
    INSERT INTO probe_result VALUES ('a restriction episode is writable', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES ('a restriction episode is writable', 'FAIL: ' || msg);
  END;

  BEGIN
    INSERT INTO identity_restriction_episodes (identity_id, flag_id, tos_clause,
                                               reason, opened_by)
    VALUES (ident, flag, 'ToS 5.3', 'a second, concurrent restriction', 'admin:probe2');
    INSERT INTO probe_result VALUES ('at most one open episode per identity',
      'FAIL: ACCEPTED. Two restore actions now exist for one restriction');
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES ('at most one open episode per identity',
        CASE WHEN msg LIKE '%identity_restriction_episodes_open_uq%' THEN 'PASS'
             ELSE 'FAIL: refused by something else: ' || msg END);
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      INSERT INTO probe_result VALUES ('at most one open episode per identity',
        'FAIL: wrong error class: ' || msg);
  END;

  BEGIN
    UPDATE identity_restriction_episodes
       SET restored_at = now(), restored_by = 'admin:probe2',
           restore_evidence = 'set_risk confirmed at the account floor, then entitlement',
           updated_at = now()
     WHERE id = epi;
    INSERT INTO identity_restriction_episodes (identity_id, flag_id, tos_clause,
                                               reason, opened_by)
    VALUES (ident, flag, 'ToS 5.3', 'a later, separate restriction', 'admin:probe3');
    INSERT INTO probe_result VALUES
      ('a restore is provable and re-opens the door', 'PASS');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    INSERT INTO probe_result VALUES
      ('a restore is provable and re-opens the door', 'FAIL: ' || msg);
  END;
END;
$legs$;

\echo ''
\echo "ADR-040 payout hold and ADR-041 restriction episode probes"
\echo '---------------------------------------------------------'
SELECT rpad(step, 52) || verdict AS result FROM probe_result;

DO $verdict$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad FROM probe_result WHERE verdict <> 'PASS';
  IF bad > 0 THEN
    RAISE EXCEPTION '% probe(s) failed. A guard nobody has watched behave correctly is not a guard.', bad;
  END IF;
  RAISE NOTICE 'All % probes pass.', (SELECT count(*) FROM probe_result);
END;
$verdict$;

ROLLBACK;
