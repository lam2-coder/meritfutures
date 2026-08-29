-- =============================================================================
-- Probe: ADR-040's payout hold and ADR-041's identity restriction.
-- =============================================================================
-- IT LEADS WITH THE SUCCESS CASE, and that is the transferable part.
--
-- Every probe in DELTA_MANIFEST section 10 attempted a forbidden thing and
-- asserted a rejection, so EVERY ONE OF THEM PASSES AGAINST A GUARD THAT
-- REJECTS EVERYTHING. A constraint that refuses all writes satisfies an
-- inventory of refusals perfectly. The success cases below are what that
-- inventory could not see from inside itself.
--
-- Rejections are checked BY MESSAGE TEXT where the message is the finding,
-- never by exception class: before 0028 a retirement raised undefined_column,
-- and a handler catching "any error" scored that as the constraint working.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Fixtures. One identity, one funded account, one open flag, one operator.
INSERT INTO identities (id, status) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'active');
INSERT INTO users (id, identity_id, email, email_normalized) VALUES
  ('bb000000-0000-0000-0000-000000000001',
   'aa000000-0000-0000-0000-000000000001',
   'Probe@Example.test', 'probe@example.test');

-- A risk flag to cite. Every hold and every episode requires one; a probe that
-- invented a null here would be testing a schema Merit does not have.
-- Severity 5 and therefore carrying its own SLA: risk_flags_high_severity_has_sla
-- requires it, and ADR-040 enters a hold on an UNRESOLVED HIGH-SEVERITY flag,
-- so the fixture must be high severity or it is not testing the ruled trigger.
INSERT INTO risk_flags (id, identity_id, flag_type, severity, evidence,
                        first_detected_on, sla_due_at)
VALUES ('ff000000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000001', 'probe', 5, '{}'::jsonb,
        current_date, now() + interval '48 hours');

-- A plan version and a funded account, so payout_requests has a real parent.
INSERT INTO plans (id, code, name) VALUES
  ('11100000-0000-0000-0000-000000000001', 'core_eod', 'Core EOD');
INSERT INTO plan_versions (id, plan_id, version, status, rules, public_slug,
                           created_by) VALUES
  ('11200000-0000-0000-0000-000000000001',
   '11100000-0000-0000-0000-000000000001', 1, 'draft', '{}'::jsonb,
   'core-eod-v1', 'bb000000-0000-0000-0000-000000000001')
  ON CONFLICT DO NOTHING;
-- Inserted as draft then published, because plan_versions_published_has_timestamp
-- requires published_at and 0027's immutability trigger only guards UPDATES of
-- an ALREADY-published row.
-- 0045 SD-M21-02: a published version records what it was decided on, or says
-- in writing why no run was consulted. A probe database has no runs.
UPDATE plan_versions SET status = 'published', published_at = now(),
       simulation_waiver_reason = 'probe fixture: no simulation run exists in a probe database (0045, SD-M21-02)'
 WHERE id = '11200000-0000-0000-0000-000000000001';
INSERT INTO purchases (id, identity_id, user_id, plan_version_id, size_cents,
                       kind, list_price_cents, amount_paid_cents, psp,
                       psp_reference, status, paid_at)
VALUES ('11300000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000001',
        'bb000000-0000-0000-0000-000000000001',
        '11200000-0000-0000-0000-000000000001', 5000000, 'new', 9900, 9900,
        'psp_a', 'probe-psp-ref-1', 'paid', now());
-- funded phase requires funded_on (accounts_funded_has_date).
INSERT INTO accounts (id, identity_id, user_id, purchase_id, plan_version_id,
                      size_cents, phase, status, opened_on, funded_on)
VALUES ('11400000-0000-0000-0000-000000000001',
        'aa000000-0000-0000-0000-000000000001',
        'bb000000-0000-0000-0000-000000000001',
        '11300000-0000-0000-0000-000000000001',
        '11200000-0000-0000-0000-000000000001',
        5000000, 'funded', 'active', current_date, current_date);

-- ---------------------------------------------------------------------------
-- SUCCESS 1: a held request is writable, with its full evaluated decision
-- ---------------------------------------------------------------------------
-- ADR-040's central design choice: only the LEDGER POSTING is deferred. Every
-- NOT NULL and every CHECK on this table stays satisfied by a held row. If
-- this INSERT fails, the "addition rather than relaxation" claim is false.
DO $$
DECLARE
  ok boolean;
BEGIN
  BEGIN
    INSERT INTO payout_requests (
      id, account_id, identity_id, requested_cents, approved_cents,
      trader_cents, firm_cents, basis_trading_day, plan_version_id,
      eligibility_snapshot, status, idempotency_key, payout_ordinal,
      held_at, hold_flag_id, hold_expires_at, hold_tos_clause, hold_reason
    )
    VALUES (
      'cc000000-0000-0000-0000-000000000001',
      '11400000-0000-0000-0000-000000000001',
      'aa000000-0000-0000-0000-000000000001',
      100000, 100000, 90000, 10000, current_date,
      '11200000-0000-0000-0000-000000000001',
      '{"gates":"evaluated at request time"}'::jsonb,
      'held_pending_review', 'probe-hold-1', 1,
      now(), 'ff000000-0000-0000-0000-000000000001', now() + interval '48 hours',
      'ToS 13', 'unresolved high-severity flag at request time');
    RAISE NOTICE 'SUCCESS 1: a held request stores the full decision';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'PROBE FAILED (success 1): a held request could not be written: %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2: the hold auto-releases and PAYS at expiry
-- ---------------------------------------------------------------------------
-- The whole SLA. A held request moves to 'approved' and clears its hold
-- columns, and the completeness CHECK permits exactly that transition. If this
-- fails, the auto-release cannot be implemented against this schema.
DO $$
BEGIN
  BEGIN
    UPDATE payout_requests
       SET status = 'approved',
           held_at = NULL, hold_flag_id = NULL, hold_expires_at = NULL,
           hold_tos_clause = NULL, hold_reason = NULL
     WHERE id = 'cc000000-0000-0000-0000-000000000001';
    RAISE NOTICE 'SUCCESS 2: the hold auto-releases to approved and pays';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'PROBE FAILED (success 2): auto-release rejected: %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3: enforcement frees the ordinal
-- ---------------------------------------------------------------------------
-- EC-037. A held request holds its rung while held; enforcement sends it to
-- 'failed', which releases it. account_ordinal_uq is WHERE status <> 'failed',
-- so a second request may then take ordinal 1.
DO $$
BEGIN
  UPDATE payout_requests SET status = 'failed'
   WHERE id = 'cc000000-0000-0000-0000-000000000001';
  BEGIN
    INSERT INTO payout_requests (
      id, account_id, identity_id, requested_cents, approved_cents,
      trader_cents, firm_cents, basis_trading_day, plan_version_id,
      eligibility_snapshot, status, idempotency_key, payout_ordinal
    )
    VALUES ('cc000000-0000-0000-0000-000000000002',
      '11400000-0000-0000-0000-000000000001',
      'aa000000-0000-0000-0000-000000000001', 100000, 100000, 90000, 10000,
      current_date, '11200000-0000-0000-0000-000000000001', '{}'::jsonb,
      'approved', 'probe-2', 1);
    RAISE NOTICE 'SUCCESS 3: enforcement freed the ordinal for a new request';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'PROBE FAILED (success 3): the rung was not released: %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1: G-NO-IN-FLIGHT refuses a second request beside a HELD one
-- ---------------------------------------------------------------------------
-- The widened predicate, and the reason this migration exists. Under the old
-- predicate a held row would not match, the index would still exist, still be
-- valid, and ENFORCE NOTHING (the C-02 defect verbatim).
DO $$
BEGIN
  UPDATE payout_requests SET status = 'held_pending_review',
      held_at = now(), hold_expires_at = now() + interval '48 hours',
      hold_tos_clause = 'ToS 13', hold_reason = 'probe',
      hold_flag_id = 'ff000000-0000-0000-0000-000000000001'
   WHERE id = 'cc000000-0000-0000-0000-000000000002';
  BEGIN
    INSERT INTO payout_requests (
      id, account_id, identity_id, requested_cents, approved_cents,
      trader_cents, firm_cents, basis_trading_day, plan_version_id,
      eligibility_snapshot, status, idempotency_key, payout_ordinal
    )
    VALUES ('cc000000-0000-0000-0000-000000000003',
      '11400000-0000-0000-0000-000000000001',
      'aa000000-0000-0000-0000-000000000001', 100000, 100000, 90000, 10000,
      current_date, '11200000-0000-0000-0000-000000000001', '{}'::jsonb,
      'approved', 'probe-3', 2);
    RAISE EXCEPTION 'PROBE FAILED: a second request opened beside a HELD one';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'REJECTION 1: no_in_flight_uq refused a second request beside a held one';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2: an incomplete hold is unwritable
-- ---------------------------------------------------------------------------
-- A hold with a clock and no flag is a hold nobody can justify.
DO $$
BEGIN
  BEGIN
    UPDATE payout_requests SET hold_flag_id = NULL
     WHERE id = 'cc000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'PROBE FAILED: a hold with no cited flag was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'REJECTION 2: hold_is_complete refused a hold with no flag';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3: a frozen withdrawal cannot reach 'settled'
-- ---------------------------------------------------------------------------
-- 0011 made the halt REPRESENTABLE AND UNENFORCED. This is the enforcement.
DO $$
BEGIN
  -- `approved_at` IS SUPPLIED BECAUSE `0070` MADE THIS ROW UNREPRESENTABLE
  -- WITHOUT IT. The row's own status is `approved`, so the column the fixture
  -- was missing is the one the status asserts. `approved_by` stays NULL, which
  -- is the machine arm and takes no dual control (ADR-232 section 3).
  INSERT INTO wallet_withdrawals (
    id, identity_id, amount_cents, destination_ref, status, idempotency_key,
    frozen_at, freeze_flag_id, freeze_expires_at,
    source_provenance_summary, earliest_credit_at, approved_at
  )
  VALUES ('dd000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001', 50000, 'rise-dest-1',
    'approved', 'probe-w-1', now(), 'ff000000-0000-0000-0000-000000000001',
    now() + interval '48 hours', '{"payout":50000}'::jsonb, now(), now());
  BEGIN
    UPDATE wallet_withdrawals SET status = 'settled', settled_at = now()
     WHERE id = 'dd000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'PROBE FAILED: a frozen withdrawal settled';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'REJECTION 3: a live freeze blocked settlement on the external leg';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4 and REJECTION 4: the restriction episode
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO identity_restriction_episodes (
    id, identity_id, flag_id, tos_clause, reason, opened_by, sla_due_at)
  VALUES ('ee000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000001', 'ToS 5',
    'coordinated extraction across linked accounts',
    'bb000000-0000-0000-0000-000000000001', now() + interval '48 hours');
  RAISE NOTICE 'SUCCESS 4: a restriction episode opened with its citation and clock';

  -- At most one open episode per human.
  BEGIN
    INSERT INTO identity_restriction_episodes (
      identity_id, flag_id, tos_clause, reason, opened_by)
    VALUES ('aa000000-0000-0000-0000-000000000001',
      'ff000000-0000-0000-0000-000000000001', 'ToS 5', 'second',
      'bb000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'PROBE FAILED: two open episodes on one identity';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'REJECTION 4: at most one open episode per identity';
  END;

  -- A restore nobody signed is the unprovable restore this table prevents.
  BEGIN
    UPDATE identity_restriction_episodes SET restored_at = now()
     WHERE id = 'ee000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'PROBE FAILED: an unsigned restore was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'REJECTION 5: restore_is_complete refused a restore with no actor';
  END;

  -- SUCCESS 5: a documented restore, which is what makes this reversible.
  UPDATE identity_restriction_episodes
     SET restored_at = now(),
         restored_by = 'bb000000-0000-0000-0000-000000000001',
         restore_evidence = 'flag dismissed, setpoint confirmed, entitlement restored'
   WHERE id = 'ee000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'SUCCESS 5: a documented restore is provable from the episode row';

  -- And the open index frees, so the human can be restricted again later.
  INSERT INTO identity_restriction_episodes (
    identity_id, flag_id, tos_clause, reason, opened_by)
  VALUES ('aa000000-0000-0000-0000-000000000001',
    'ff000000-0000-0000-0000-000000000001', 'ToS 5', 'repeat',
    'bb000000-0000-0000-0000-000000000001');
  RAISE NOTICE 'SUCCESS 6: a restored episode frees the partial unique for a repeat';
END $$;

ROLLBACK;

\echo 'probe_payout_hold: every success case succeeded and every rejection fired.'
