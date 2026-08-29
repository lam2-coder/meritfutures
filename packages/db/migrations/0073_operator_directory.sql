-- =============================================================================
-- 0073_operator_directory
-- =============================================================================
-- NOT THE MONEY PATH BY FILE, AND IT SITS UNDER EVERY MONEY-PATH ADMIN ROUTE.
-- Nothing here moves a cent, declares a ledger class or touches a payout. What
-- it does is give `admin_actions.actor` a referent, and `admin_actions` is the
-- row that `POST /admin/payouts/:id/release`, `POST /admin/wallet/:id/correct`
-- and every other operator mutation writes. A reviewer reading this file is
-- reading the authorization estate rather than the money estate, and the two
-- questions are separate on purpose.
--
-- ADR-237 (status: proposed, founder approval PENDING) is the ruling.
--
-- -----------------------------------------------------------------------------
-- WHAT WAS MISSING, MEASURED RATHER THAN ASSERTED
-- -----------------------------------------------------------------------------
-- `admin_actions.actor` is `text NOT NULL` with no foreign key (0017:77) and,
-- before this file, NO TABLE IN THIS SCHEMA HELD AN OPERATOR, A ROLE OR AN
-- OPERATOR SESSION. So 0017's own stated control, "NO UNEXPLAINED ADMIN ACTION,
-- EVER", rested on a `NOT NULL` over free text: any string satisfied it,
-- including a string naming nobody. An audit row whose actor resolves to no row
-- is an explanation in the shape of one.
--
-- -----------------------------------------------------------------------------
-- THIS IS A DIRECTORY AND IT IS DELIBERATELY NOT A LOGIN
-- -----------------------------------------------------------------------------
-- THERE IS NO PASSWORD COLUMN, NO SECRET AND NO LOCAL CREDENTIAL IN THIS FILE,
-- and that is a rule rather than an omission. Merit is passwordless by ADR-039
-- and 0002:280 states it in the schema: "Merit is passwordless only, so THERE IS
-- NO PASSWORD TABLE ANYWHERE IN THIS SCHEMA, by design. Adding one is a security
-- architecture change requiring an ADR, not a convenience." The highest
-- privilege door in the system is the last place that rule may bend.
--
-- SO THE SPLIT THIS FILE RESTS ON. Proving WHO someone is belongs to the
-- identity provider C-08 requires and is a purchase Merit has not made.
-- Recording WHICH operators exist and WHAT ROLE each holds is a table, and the
-- role set was closed by API_CONTRACT section 8 before any of this was written.
-- This file takes the second half and leaves the first as a named seam:
-- `operator_sessions` rows are WRITTEN BY whatever verifies an assertion, and
-- nothing in this repository can write one today.
--
-- -----------------------------------------------------------------------------
-- AN OPERATOR IS NOT A `users` ROW, AND 0042 ALREADY SAID OTHERWISE
-- -----------------------------------------------------------------------------
-- `impersonation_sessions.admin_user_id uuid NOT NULL REFERENCES users(id)`
-- (0042:57) models an operator as a trader-side `users` row. THAT EDGE IS NOT
-- FOLLOWED HERE AND THE REASON IS A CREDENTIAL RATHER THAN A TASTE: a `users`
-- row is authenticable by an emailed OTP code, because `otp_challenges` keys off
-- `email_normalized` (0002:308) and `POST /auth/verify` mints a `sessions` row
-- from one. An operator holding a `users` row therefore already holds a login
-- this deployable can mint, which is exactly what SECURITY:134 forbids on this
-- surface: "Admin auth stays hardware-key SSO (C-08) with no SMS path, ever."
--
-- 0042 IS MERGED AND IS NOT EDITED (constitution E2). Nothing in this tree
-- writes an `impersonation_sessions` row, so the collision is latent rather than
-- live; ADR-237 section 6 records it as a finding with the slice that owns the
-- repair. `operators` declares no column against `users` or `identities`, so
-- the operator directory and the trader entity graph share no edge in either
-- direction.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. operators
-- -----------------------------------------------------------------------------
-- MERIT'S RECORD OF WHO MAY ACT ON ITS OWN SURFACE. One row per operator, and
-- the row is the referent `admin_actions.actor` never had.
CREATE TABLE operators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- THE AUDIT STRING, AND IT IS THE JOIN COLUMN RATHER THAN A LABEL.
  -- `admin_actions.actor` is `text` and 0017 is merged, so the referent has to
  -- be reachable from a `text` column. A parallel `actor_operator_id uuid`
  -- would leave `actor` free text beside it and make the audit trail's answer
  -- to "who" depend on which of two columns a route happened to fill, which is
  -- 0043's own stated reason for refusing a nullable discriminator.
  actor         text NOT NULL UNIQUE
                  CHECK (actor <> '' AND actor = btrim(actor)),

  -- API_CONTRACT section 8's set, closed and in its order: "owner (all), ops
  -- (read plus account actions, no config or role changes), readonly".
  --
  -- A CHECK RATHER THAN AN ENUM TYPE, on 0043's precedent for `initiative`: an
  -- enum label cannot be removed, and a role set is exactly the vocabulary a
  -- later ruling narrows. `packages/db/test/operator-role-vocabulary.test.ts`
  -- compares this list against API_CONTRACT and against the API's own constant
  -- on every run, so a fourth role cannot arrive on one side alone.
  role          text NOT NULL
                  CHECK (role IN ('owner', 'ops', 'readonly')),

  -- WHETHER THEY MAY ACT TODAY, WHICH IS NOT WHETHER THEY EXIST.
  -- The row can never be deleted once it has acted (the RESTRICT in section 3),
  -- so without this column offboarding an operator would be impossible rather
  -- than merely awkward. Two values and no third: a departure and a suspension
  -- are the same fact to an authorization decision, and a vocabulary that
  -- separates them is a personnel record nobody has asked this table to keep.
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended')),

  -- For an operator console's own screens. Never an authorization input.
  display_name  text NOT NULL CHECK (display_name <> ''),

  -- ---------------------------------------------------------------------------
  -- THE SEAM, AS TWO COLUMNS
  -- ---------------------------------------------------------------------------
  -- What a verified assertion is matched against. NOT a credential: a subject
  -- claim is an identifier the provider asserts, the way `passkeys.credential_id`
  -- is, and knowing one proves nothing to anybody.
  --
  -- SCOPED BY ISSUER AND UNIQUE ONLY WITHIN ONE. A subject claim is the
  -- provider's identifier and two providers may mint the same string, so a
  -- uniqueness constraint on the subject alone would let a second provider added
  -- later resolve to an operator the first one provisioned.
  --
  -- NULLABLE, AND A NULL PAIR IS AN OPERATOR WHO CANNOT SIGN IN. Two real states
  -- need it: a row provisioned before the provider has ever seen that person, at
  -- which point the opaque subject is not yet knowable, and a non-interactive
  -- actor that must be nameable in the audit trail without ever holding a
  -- session. NULL IS UNREACHABLE RATHER THAN CLAIMABLE, because the seam
  -- resolves by equality and SQL equality never matches NULL.
  idp_issuer    text NULL CHECK (idp_issuer IS NULL OR idp_issuer <> ''),
  idp_subject   text NULL CHECK (idp_subject IS NULL OR idp_subject <> ''),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- BOTH OR NEITHER. A subject with no issuer is a claim with no claimant, and
  -- an issuer with no subject is a provider named against nobody. Either half
  -- alone would make the seam's two-column match silently unsatisfiable.
  CONSTRAINT operators_idp_link_is_whole
    CHECK ((idp_issuer IS NULL) = (idp_subject IS NULL))
);

-- The seam's lookup, and the constraint that makes one assertion resolve to at
-- most one operator. Partial, because the NULL rows are the ones deliberately
-- unreachable and indexing them would index every operator who cannot sign in
-- to answer a question about the ones who can.
CREATE UNIQUE INDEX operators_idp_identity_idx
  ON operators (idp_issuer, idp_subject)
  WHERE idp_issuer IS NOT NULL;

COMMENT ON TABLE operators IS
  'ADR-237. Merit''s own operators, their role over API_CONTRACT section 8''s '
  'closed set, and nothing that authenticates anybody. NO PASSWORD, NO SECRET '
  'AND NO LOCAL CREDENTIAL: identity is proved by the C-08 provider and this '
  'table records only the mapping from a proven subject to an actor and a role. '
  'Retention: forever. An operator who has acted is named in an append-only '
  'audit trail and cannot be deleted out from under it.';

COMMENT ON COLUMN operators.actor IS
  'ADR-237. The string `admin_actions.actor` carries, and the target of that '
  'column''s foreign key. IMMUTABLE ONCE USED, by the ON UPDATE RESTRICT on '
  'that constraint: renaming it would rewrite what an append-only audit row '
  'says about a past act.';

COMMENT ON COLUMN operators.role IS
  'ADR-237. API_CONTRACT section 8''s closed set. `ops` is bounded there to '
  '"read plus account actions, no config or role changes", which is why a role '
  'change is an `owner` act and is itself an `admin_actions` row.';

COMMENT ON COLUMN operators.idp_subject IS
  'ADR-237. The subject the C-08 identity provider asserts, matched with '
  '`idp_issuer` and never alone. NOT A CREDENTIAL and never a secret: it is an '
  'identifier a provider hands over, and possession of the string proves '
  'nothing. NULL means this operator cannot sign in at all, which is the '
  'correct state for a row provisioned before the provider has seen the person '
  'and for an actor that must be nameable in the audit trail without holding a '
  'session.';

-- -----------------------------------------------------------------------------
-- 2. operator_sessions
-- -----------------------------------------------------------------------------
-- WHAT A PROVEN ASSERTION TURNS INTO, AND NOTHING IN THIS REPOSITORY CAN WRITE
-- A ROW HERE. The writer is the slice that lands an assertion verifier, which
-- needs the identity provider C-08 requires. Until then this table is a shape
-- with no producer, on purpose: a table an unfinished deployment can fill is a
-- login, and this is not one.
--
-- THE HASH, NEVER THE TOKEN, on `sessions.refresh_token_hash` (0002:342) and
-- `impersonation_sessions.token_hash` (0042). `bytea NOT NULL UNIQUE` is the
-- same declaration in the same shape, so a reader comparing the three surfaces
-- finds one convention rather than three.
CREATE TABLE operator_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  operator_id        uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,

  token_hash         bytea NOT NULL UNIQUE,

  -- WHICH VERIFIED ASSERTION THIS SESSION CAME FROM. NOT NULL is the control
  -- and it is the whole difference between a directory and a login: a row here
  -- has to name the assertion it was minted from, so a session that nobody
  -- proved has nothing to write in this column. The value is the provider's
  -- assertion identifier and is not a secret; the assertion itself is never
  -- stored.
  idp_assertion_id   text NOT NULL CHECK (idp_assertion_id <> ''),

  issued_at          timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz NULL,

  -- SD-M4-03's pair, for the same reason `sessions` carries it: an operator
  -- session that moved address mid-life is only expressible if the creation
  -- values and the last-seen values are separate columns.
  created_ip         inet NULL,
  created_user_agent text NULL,
  last_seen_at       timestamptz NULL,
  last_seen_ip       inet NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- A FLOOR AND DELIBERATELY NO CEILING. `impersonation_box_is_bounded` (0042)
  -- carries a two-hour ceiling because M06 SD-M6-10 states one. THE CORPUS
  -- STATES NO CEILING FOR AN OPERATOR SESSION, and a number invented here would
  -- be a setting wearing a bound's clothes, which is the failure M06 names on
  -- the impersonation box in its own words. `sessions` carries a floor and no
  -- ceiling for the same reason. ADR-237 section 7 registers the ceiling as
  -- owed, to be ruled by whichever slice lands the minter, because that is the
  -- first slice with a number to defend.
  CONSTRAINT operator_sessions_expires_after_issue
    CHECK (expires_at > issued_at),

  -- A revocation before the session existed is a clock nobody can read.
  CONSTRAINT operator_sessions_revoked_within_life
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

CREATE INDEX operator_sessions_operator_idx
  ON operator_sessions (operator_id, issued_at DESC);

-- The live-session sweep. Partial on `sessions_live_idx`'s precedent: a revoked
-- session is never the answer to "is this token still good".
CREATE INDEX operator_sessions_live_idx
  ON operator_sessions (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE operator_sessions IS
  'ADR-237. One operator session, created by whatever verified the assertion '
  'named in `idp_assertion_id` and by nothing else. NOTHING IN THIS REPOSITORY '
  'WRITES A ROW HERE: the minter needs the C-08 identity provider. Retention: '
  '90 days after expiry, on `sessions`'' precedent. '
  'NO TRIGGER TIES `token_hash` TO `sessions.refresh_token_hash` and that is '
  'deliberate. IMPERSONATION-C1 exists because 0042 mints a token INTENDED to '
  'be presented on the trader path; no token here is ever presented there, so '
  'the only way the two could collide is a repeated draw from a CSPRNG.';

-- -----------------------------------------------------------------------------
-- 3. The referent admin_actions.actor never had
-- -----------------------------------------------------------------------------
-- THIS IS THE LINE THAT TURNS 0017's ASSERTION INTO A CONSTRAINT. Before it,
-- `reason text NOT NULL` was the only control on the row and the actor could be
-- any string at all. After it, an audit row naming an actor who is in no
-- directory does not exist, because the database refuses to write one.
--
-- SAFE AS A CONSTRAINT ON AN EXISTING COLUMN BECAUSE THE TABLE IS EMPTY, which
-- is the same ground 0043 stated for its own NOT NULL: this corpus has no
-- deployed database, migrations apply forward-only from empty, and 0017 runs
-- earlier in the same sequence. It is also the last cheap moment, for exactly
-- 0043's reason one column over.
--
-- 0017 IS MERGED AND IS SUPERSEDED BY ADDITION RATHER THAN EDITED (constitution
-- E2), which is 0028's and 0068's mechanism on this estate.
--
-- ON DELETE RESTRICT: an operator with an action recorded against them cannot
-- be deleted out from under their own audit trail. It is 0043's own action on
-- `on_behalf_of_identity_id` and the append-only precedent it cites.
--
-- ON UPDATE RESTRICT AND NOT CASCADE, AND THE DIFFERENCE IS THE WHOLE POINT.
-- A cascade would rename the actor on every historical row, which is an
-- append-only audit trail being rewritten by a personnel edit. RESTRICT makes
-- an actor string immutable from the first act onwards and leaves an unused
-- one renameable, which is the correct asymmetry.
ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_actor_is_an_operator
    FOREIGN KEY (actor) REFERENCES operators(actor)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

COMMENT ON CONSTRAINT admin_actions_actor_is_an_operator ON admin_actions IS
  'ADR-237. 0017 declares "NO UNEXPLAINED ADMIN ACTION, EVER" and rested it on '
  '`reason text NOT NULL`, which any string satisfies. An action whose ACTOR '
  'resolves to no row is unexplained in the way that matters most, and this '
  'constraint is the half 0017 could not write because no directory existed.';

-- -----------------------------------------------------------------------------
-- 4. WHAT IS DELIBERATELY NOT HERE
-- -----------------------------------------------------------------------------
-- NO PASSWORD, NO SECRET, NO API KEY AND NO LOCAL CREDENTIAL OF ANY KIND. See
-- the header. `token_hash` is the hash of a token this repository cannot mint.
--
-- NO GRANT REVOCATION. Both tables are mutable by design: a role changes, a
-- status changes, a session is revoked and a last-seen pair is written on every
-- request. The append-only set (0026 and its five successors) is for rows that
-- are evidence, and the evidence about an operator's acts lives one table over
-- in `admin_actions`, which IS append-only and which now cannot name a stranger.
--
-- NO `users` OR `identities` EDGE, in either direction. See the header.
--
-- NO FOREIGN KEY ON `evidence_packs.requested_by`, `dual_control_approvals`'
-- `requested_by` and `approved_by`, OR `treasury_balances.recorded_by`. All
-- four are `text` actor strings that this directory could now constrain, and
-- all four are a different question from the one ADR-237 was dispatched to
-- rule. They are named in ADR-237 section 7 as owed rather than left to be
-- rediscovered.
--
-- NO PROVISIONING ROUTE. Creating an operator is a write, no admin write path
-- is wired, and a route that mints the first `owner` is precisely the shape a
-- login takes when it is written by accident.
-- =============================================================================

COMMIT;
