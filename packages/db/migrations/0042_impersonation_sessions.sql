-- =============================================================================
-- 0042_impersonation_sessions
-- =============================================================================
-- E2 READ: MONEY PATH. Auth is a money path (CLAUDE.md, constitution E2), and
-- this file adds a second kind of session to a system that has had exactly one.
--
--   THE WHOLE FILE EXISTS FOR ONE SENTENCE: A TOKEN MINTED HERE CANNOT SATISFY
--   A TRADER AUTHORIZATION. Everything else below is a bound on how long, a
--   record of who and why, and an audit of what was looked at. Those matter.
--   But if the boundary leaks, every one of them is decoration, which is
--   GS-303's own wording: "a token that can be replayed makes every other
--   control on this list decorative."
--
-- ADR-068, PROPOSED 2026-08-20. Planned by FOLD-04 section 4. SD-M6-10.
--
-- WHY A PASSWORDLESS FIRM NEEDS THIS. 0002:280 states it: "Merit is passwordless
-- only, so THERE IS NO PASSWORD TABLE ANYWHERE IN THIS SCHEMA, by design."
-- ADR-039 made OTP and passkeys the whole of trader authentication. There is no
-- credential to share and no reset to walk somebody down, so impersonation is
-- the only support-visibility path into what a trader is actually seeing. This
-- table is a CONSEQUENCE of ADR-039, not a departure from it.
--
-- WHAT THIS FILE DOES NOT NEED TO ENFORCE, AND THE READER SHOULD CHECK THAT
-- CLAIM RATHER THAN ACCEPT IT. ADR-068 section 1 finds that three of the seven
-- blocked routes are already refused by SECURITY:45 C-27: external withdrawal,
-- payout-destination change, and contact change of either kind. C-27 requires a
-- passkey assertion or a dual-channel confirmation AS THE TRADER to elevate a
-- session. An impersonation session never inherits or intercepts either, so it
-- cannot elevate, so those three are closed to it by an invariant that predates
-- this file. FOUR EXPLICIT REFUSALS, THREE INHERITED. Application code owns the
-- four; no column below is involved in them.
--
-- THE STRUCTURAL PART OF THAT ARGUMENT IS IN THIS FILE AND IS EASY TO MISS:
-- impersonation_sessions carries NO user_id, NO auth_factor, NO elevated_at and
-- NO elevated_by_factor. C-27's elevation columns live on sessions (0029,
-- SD-M4-04). There is no column here a trader-session lookup could resolve and
-- no column an elevation could be written to. "It cannot elevate" is therefore
-- a fact about the schema rather than a rule somebody has to remember.
--
-- NO MONEY MOVES THROUGH ANY COLUMN BELOW. No ledger account, no balance, no
-- cents, no eligibility input. It is money path because it is auth.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- impersonation_sessions
-- -----------------------------------------------------------------------------
-- The subject is an IDENTITY and not a user, deliberately. A restriction is per
-- human (M20:147, ADR-041) and so is support: the caller is a person, and the
-- accounts under them are what support is trying to see. identities is also the
-- table whose status GS-302 turns on.
CREATE TABLE impersonation_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who. An admin user under hardware-key SSO at ADMIN_ORIGIN (ADR-012).
  admin_user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Whom. GS-302: a `restricted` identity is IMPERSONABLE, because that is
  -- exactly when the trader calls. identity_status is ('active','restricted',
  -- 'closed') at 0001:27 and ADR-041 refused a fourth value, so there is no
  -- `suspended` to write a constraint against. `closed` is OQ-F4-04 and is
  -- DELIBERATELY UNCONSTRAINED HERE: ADR-068 section 7 declines to rule it, and
  -- a CHECK written now would settle by accident what the ADR left open.
  subject_identity_id   uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- THE BOUNDARY COLUMN. Same type and shape as sessions.refresh_token_hash at
  -- 0002:342 on purpose: the two are compared by IMPERSONATION-C1 below, and a
  -- comparison across two different representations is a comparison that stops
  -- working the day somebody changes one of them.
  token_hash            bytea NOT NULL UNIQUE,

  -- Why. 0017:82 on admin_actions.reason: "NO UNEXPLAINED ADMIN ACTION, EVER.
  -- NOT NULL is the whole control." A controlled vocabulary is the half NOT
  -- NULL cannot do, because "asdf" is a non-null reason.
  reason_code           text NOT NULL CHECK (reason_code IN (
                          'trader_reported_display_issue',
                          'trader_reported_missing_data',
                          'payout_status_inquiry',
                          'account_state_inquiry',
                          'kyc_flow_stuck',
                          'billing_inquiry',
                          'incident_investigation',
                          'compliance_review'
                        )),

  -- And the vocabulary cannot carry the specifics, so the detail is mandatory
  -- and non-blank. btrim() rather than <> '': a reason of three spaces passes
  -- the naive form and is the same nothing.
  reason_detail         text NOT NULL CHECK (btrim(reason_detail) <> ''),

  started_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,

  ended_at              timestamptz NULL,
  ended_by              uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  end_reason            text NULL CHECK (end_reason IS NULL OR end_reason IN (
                          'explicit_exit',
                          'admin_session_ended',
                          'revoked_by_owner'
                        )),

  -- IMPERSONATION-C3: the box is bounded, and the ceiling is here rather than
  -- in config BECAUSE A BOUND THAT CAN BE RAISED BY THE PERSON INCONVENIENCED BY
  -- IT IS NOT A BOUND. ADR-068 section 5: the default is 30 minutes and is
  -- configurable; the 2 hour ceiling is structural. The failure mode is not
  -- malice, it is a support lead raising a setting during a bad week and nobody
  -- lowering it afterwards.
  --
  -- THE VALUE 2 IS A LAUNCH CANDIDATE AND THE FOUNDER'S. What is ruled is that
  -- a ceiling exists and lives in the schema.
  CONSTRAINT impersonation_box_is_bounded CHECK (
    expires_at > started_at
    AND expires_at <= started_at + interval '2 hours'
  ),

  -- identity_restriction_restore_is_complete's shape (0031:264). An exit
  -- carries its actor and its reason, or it did not happen. A session recorded
  -- as ended by nobody for no reason is the unprovable exit this column set
  -- exists to prevent.
  CONSTRAINT impersonation_exit_is_complete CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL)
    OR
    (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL)
  ),

  -- An exit cannot precede the start, and cannot be recorded after the box has
  -- already closed. The second half is the one that matters: an ended_at after
  -- expires_at claims a session was live when it was not.
  CONSTRAINT impersonation_exit_within_box CHECK (
    ended_at IS NULL
    OR (ended_at >= started_at AND ended_at <= expires_at)
  )
);

COMMENT ON TABLE impersonation_sessions IS
  'ADR-068. A read-only, money-blind, time-boxed support-visibility session. '
  'NOT a trader session: IMPERSONATION-C1 makes a token here unresolvable on '
  'the trader auth path, in both directions. The trader is NOT notified '
  '(ADR-068 section 3), and the internal audit trail is the compensating '
  'control for that, which is why impersonation_page_views is not optional.';

CREATE INDEX impersonation_sessions_subject_idx
  ON impersonation_sessions (subject_identity_id, started_at DESC);

CREATE INDEX impersonation_sessions_admin_idx
  ON impersonation_sessions (admin_user_id, started_at DESC);

-- The live-session lookup the auth path makes on every request.
CREATE INDEX impersonation_sessions_open_idx
  ON impersonation_sessions (expires_at)
  WHERE ended_at IS NULL;

-- -----------------------------------------------------------------------------
-- impersonation_page_views
-- -----------------------------------------------------------------------------
-- Requirement 6 says "pages viewed" and this is that. It is the compensating
-- control for the non-disclosure ruling: an unnotified view that is not itself
-- recorded in detail is not an exception to transparency, it is the absence of
-- it (ADR-068 section 3).
CREATE TABLE impersonation_page_views (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonation_session_id  uuid NOT NULL
                              REFERENCES impersonation_sessions(id) ON DELETE RESTRICT,

  -- The route template, never the resolved path: a resolved path carries ids in
  -- its segments and this table is read by people reviewing an admin's conduct,
  -- not by people who need the trader's account number a second time.
  route                     text NOT NULL CHECK (btrim(route) <> ''),

  viewed_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE impersonation_page_views IS
  'ADR-068 requirement 6. Append-only by grant. IMPERSONATION-C2 makes a view '
  'outside its session box UNWRITABLE, so a request served after expiry fails '
  'loudly at the moment it tries to record itself.';

CREATE INDEX impersonation_page_views_session_idx
  ON impersonation_page_views (impersonation_session_id, viewed_at);

-- -----------------------------------------------------------------------------
-- IMPERSONATION-C1: the session-type boundary, IN BOTH DIRECTIONS
-- -----------------------------------------------------------------------------
-- THIS IS THE FILE'S REASON TO EXIST.
--
-- The trader auth path resolves a bearer token by looking its hash up on
-- sessions.refresh_token_hash (0002:342). So the only question that matters is
-- whether a sessions row can ever exist carrying an impersonation token's hash.
-- If it cannot, that lookup CANNOT RETURN A ROW for an impersonation token, and
-- the boundary holds without any middleware being correct.
--
-- BOTH DIRECTIONS, BECAUSE ONE ALONE LEAVES AN ORDERING HOLE. A guard only on
-- impersonation_sessions is satisfied by writing the sessions row SECOND: at the
-- moment the impersonation row was checked the trader row did not exist yet. The
-- mirror closes it. Two triggers is not redundancy here, it is the difference
-- between a guard and half of one.
--
-- WHY NOT A UNIQUE INDEX ACROSS BOTH TABLES: PostgreSQL has none. A CHECK cannot
-- read another table either, which 0004:183 already states in its own words for
-- the same reason. A trigger is the weakest of the three mechanisms and it is
-- the only one that exists, so it is used and its weakness is named: a trigger
-- can be disabled by the table owner. The probe asserts it FIRES rather than
-- asserting it is defined.
CREATE FUNCTION refuse_impersonation_token_collision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sessions s WHERE s.refresh_token_hash = NEW.token_hash) THEN
    RAISE EXCEPTION
      'IMPERSONATION-C1: this token_hash already exists as a trader '
      'sessions.refresh_token_hash. An impersonation token that resolves on the '
      'trader auth path makes every other control on this table decorative '
      '(GS-303). See ADR-068 section 4.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER impersonation_sessions_token_is_not_a_trader_token
  BEFORE INSERT OR UPDATE OF token_hash ON impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION refuse_impersonation_token_collision();

-- The mirror. Same boundary, opposite table, and it is what closes the ordering
-- hole rather than restating the guard above.
CREATE FUNCTION refuse_trader_session_token_collision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM impersonation_sessions i WHERE i.token_hash = NEW.refresh_token_hash) THEN
    RAISE EXCEPTION
      'IMPERSONATION-C1 (mirror): this refresh_token_hash already exists as an '
      'impersonation_sessions.token_hash. Guarding only the impersonation side '
      'is satisfied by writing this row second, which is the ordering hole the '
      'mirror exists to close. See ADR-068 section 4.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_token_is_not_an_impersonation_token
  BEFORE INSERT OR UPDATE OF refresh_token_hash ON sessions
  FOR EACH ROW EXECUTE FUNCTION refuse_trader_session_token_collision();

-- -----------------------------------------------------------------------------
-- IMPERSONATION-C2: a page view cannot be recorded outside its session's box
-- -----------------------------------------------------------------------------
-- GS-301 says a session that reaches expiry mid-view has its NEXT REQUEST
-- refused, "not silently served". A CHECK cannot refuse a request. It can refuse
-- a ROW, and that turns out to be the more useful thing from where the database
-- sits:
--
--   A REQUEST SERVED AFTER EXPIRY BECOMES UNAUDITABLE. The system cannot write
--   the page-view row, so a system that served it FAILS LOUDLY at the moment it
--   tries to record what it did, instead of quietly succeeding.
--
-- LEAST(expires_at, COALESCE(ended_at, expires_at)) rather than expires_at: an
-- explicit exit closes the box early, and a view recorded between the exit and
-- the original expiry is a view after the session ended.
--
-- A trigger and not a CHECK, for 0004:183's stated reason: a CHECK cannot read
-- another table. The bound lives on impersonation_sessions.
CREATE FUNCTION refuse_impersonation_page_view_outside_box() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s_started  timestamptz;
  s_closes   timestamptz;
BEGIN
  SELECT started_at, LEAST(expires_at, COALESCE(ended_at, expires_at))
    INTO s_started, s_closes
    FROM impersonation_sessions
   WHERE id = NEW.impersonation_session_id;

  IF NEW.viewed_at < s_started OR NEW.viewed_at > s_closes THEN
    RAISE EXCEPTION
      'IMPERSONATION-C2: viewed_at % is outside its session box [%, %]. A '
      'request served after the box closed is UNAUDITABLE, so recording it '
      'fails rather than succeeding quietly (GS-301). See ADR-068 section 4.',
      NEW.viewed_at, s_started, s_closes
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER impersonation_page_view_within_box
  BEFORE INSERT OR UPDATE ON impersonation_page_views
  FOR EACH ROW EXECUTE FUNCTION refuse_impersonation_page_view_outside_box();

-- -----------------------------------------------------------------------------
-- Append-only, by grant rather than by convention (VG-8)
-- -----------------------------------------------------------------------------
-- 0026:174's ALTER DEFAULT PRIVILEGES grants merit_app full DML on anything a
-- later migration creates, so both tables above are UPDATE-able and DELETE-able
-- the instant they exist. Append-only here is a REVOKE or it is nothing.
--
-- NOTE THE ASYMMETRY, WHICH IS DELIBERATE. impersonation_page_views loses UPDATE
-- and DELETE. impersonation_sessions loses only DELETE: it NEEDS update, because
-- recording the exit is an update to a row that already exists. That is the one
-- legitimate update on this pair, and IMPERSONATION-C1's trigger fires on
-- UPDATE OF token_hash so the boundary survives it.
--
-- Against PUBLIC as well as merit_app, on 0039's stated reason: a revoke that
-- only binds the application role is a revoke a second connection string walks
-- around.
REVOKE UPDATE, DELETE ON impersonation_page_views FROM merit_app, PUBLIC;
REVOKE DELETE ON impersonation_sessions FROM merit_app, PUBLIC;

-- merit_analytics gets nothing, and here that is a rule rather than 0032's
-- default. A row in either table names an ADMIN ACTOR beside a TRADER SUBJECT
-- and records that the second was watched without being told. That is the
-- narrowest-audience data this schema holds, and an analytics grant is how a
-- narrow audience stops being one.
REVOKE ALL ON impersonation_sessions, impersonation_page_views FROM merit_analytics;

COMMIT;
