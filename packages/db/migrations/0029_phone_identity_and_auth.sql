-- =============================================================================
-- 0029_phone_identity_and_auth
-- =============================================================================
-- E2 READ: MONEY PATH. Auth is a money path (CLAUDE.md, constitution E2), and
-- this file is where ADR-039 stops being prose. Five things need the founder's
-- line-by-line read, and the first two are about what is NOT here.
--
--   1. THE UNIQUE INDEX ON phone_hash IS DELIBERATELY ABSENT, AND ITS ABSENCE
--      IS THE RULING. ADR-039 splits the hard link in two: identity -> phone is
--      a database constraint (identity_phones_live_per_identity_uq, one live
--      verified phone per identity), and phone -> identity is NOT. A second
--      identity verifying a number already live elsewhere COMPLETES, writes the
--      edge at the hard-link ceiling, and opens a severity-5 flag against both.
--      A reader who "finishes the pair" by making phone_hash unique refuses the
--      innocent owner of a recycled number at the door, before the portability
--      check that exists to rescue them can run. That is amendment 3, and the
--      missing index is how it is honoured.
--
--   2. otp_send_budget.state HAS NO STOPPING STATE, ON THE FOUNDER'S RULING.
--      'armed', 'degraded', 'manually_overridden'. There is no 'paused' and
--      0016's plan_breaker_state, whose pattern this table otherwise copies,
--      has one. Phone verification is mandatory at registration, so a breaker
--      that stops means no new customers: the control protecting the SMS bill
--      becomes a cheap denial of service on revenue, tripped at the price of
--      the traffic that trips it, which is the attacker's business model in
--      amendment 2 anyway. On trip, registration CONTINUES and verification
--      defers to ADR-021's pre_funded gate. Adding 'paused' here reverses a
--      founder ruling with one word.
--
--   3. phone_change_requests_applied_is_complete IS (c), AND IT IS THE SIM-SWAP
--      CONTROL. A phone change may not reach 'applied' unless dual-channel
--      verification happened, the prior contact was notified, and a withdrawal
--      hold is set and STILL RUNNING at the moment it applies. Three D4
--      controls become a precondition of the write rather than three steps a
--      handler is trusted to have taken. The attack this refuses is: take the
--      number, change the number, drain the wallet.
--
--   4. sessions.elevated_by_factor's CHECK LIST IS C-27. It contains 'passkey'
--      and 'dual_channel' and nothing else, so an SMS-established session
--      cannot elevate itself at all. "Never SMS alone" is a vocabulary, not a
--      handler: a SIM-swapped session can see everything and change nothing
--      because the database has no value for the thing it would have to write.
--
--   5. notification_kinds.rate_limit_exempt IS GENERATED FROM class, so the new
--      pre_identity_auth class is non-exempt BY CONSTRUCTION. INV-M16-11 was
--      written for post-identity messages; applied to an attacker-supplied
--      number it funds SMS pumping. As an ordinary boolean a single careless
--      seed row re-exempts the pre-identity class and nothing objects, which is
--      exactly the argument SD-M16-01 already made for `mutable`.
--
-- Deltas folded: SD-M19-05, SD-M19-06, SD-M19-07, SD-M16-04, SD-M16-05,
-- SD-M16-06, SD-M16-07, SD-M4-04, U-07
--
-- Authority: ADR-039, and docs/plans/FOLD-01-phone-identity.md section 4, which
-- is approved and is what this file is scored against. Every folded change
-- carries an inline -- SD-nn or -- U-nn marker.
-- Full trace: packages/db/DELTA_MANIFEST.md
--
-- IT SUPERSEDES AND NEVER EDITS. Six of the nine changes ALTER a table created
-- by a merged migration. 0002, 0003 and 0019 are untouched on disk and stay
-- exactly as they were written; this file changes what they installed.
-- Migrations are sacred once merged (constitution E2), which is a rule about
-- editing them, not a rule against extending them.
--
-- TWO DISCIPLINES THIS CORPUS ALREADY PAID FOR, and both are satisfied by
-- construction rather than by care:
--   * ADR-035's array trap. No table here declares an array column, so there is
--     no CHECK over an array to write with cardinality() and no way to write
--     one with array_length(). Stated rather than left implicit, so the next
--     reader knows it was considered and not forgotten.
--   * CI-06j. This file installs NO trigger and NO function, so there is no
--     PL/pgSQL body naming a column that does not exist. The hard link's
--     severity-5 flag is application logic against dedupe_matches and
--     risk_flags, not a trigger: ADR-039 rules that it CHANGES NO STATE
--     AUTOMATICALLY, and a trigger that opens a flag is automatic state.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- identity_phones                                               -- SD-M19-05
-- -----------------------------------------------------------------------------
-- ADR-039 (a), (b), amendment 3. A VERIFIED PHONE IS AN IDENTITY SIGNAL AND NOT
-- A CONTACT FIELD, and this table is the difference between those two sentences.
--
-- Emails are free to mint and real mobile numbers are scarce, so the number is
-- worth more to ADR-022's link-confidence graph as a node than it is worth to
-- M16 as a delivery address. The delivery address is contact_channels, which
-- change 6 below widens for 'sms'. THE TWO TABLES ARE NOT REDUNDANT: one is who
-- this person is, the other is where a message goes, and collapsing them is how
-- a contact-preference edit becomes an identity change.
--
-- HASHED, NEVER RAW, for contact_channels' reason exactly: this table exists to
-- decide and to notify, and the sending path holds the number. A second
-- plaintext copy of every number a trader has ever used buys nothing and costs
-- a breach.
--
-- SUPERSESSION RATHER THAN UPDATE, for daily_marks' reason exactly. INV-M16-03
-- cannot notify a PRIOR number that was overwritten, and (c) requires notifying
-- the prior number.
CREATE TABLE identity_phones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- HASHED. See the table comment.
  phone_hash         bytea NOT NULL,                              -- SD-M19-05

  -- Non-identifying display fragment for admin and for the trader's own
  -- confirmation screen, on identity_signals.value_preview's pattern: enough to
  -- recognise, not enough to reconstruct.
  phone_preview      text NULL,                                   -- SD-M19-05

  -- ISO-3166-1 alpha-2, derived from the E.164 prefix at capture. char(2) with
  -- the same regex as users.country_code (0002) and kyc_verifications'
  -- three country columns (0003), because a fourth spelling of "country" is how
  -- a join silently returns nothing.
  country_code       char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),

  -- The verification ceremony's output. NULL means captured and not yet proven,
  -- which is a real and common state: the row is written at capture so the
  -- carrier lookup has somewhere to land before the OTP is answered.
  verified_at        timestamptz NULL,                            -- SD-M19-05

  -- (c). The prior number remains a row.
  superseded_at      timestamptz NULL,                            -- SD-M19-05
  superseded_by      uuid NULL REFERENCES identity_phones(id)
                       ON DELETE RESTRICT,                        -- SD-M19-05

  -- AMENDMENT 3, THE RECYCLING GUARD'S OUTPUT. Carriers reassign numbers. When
  -- portability history shows this number left this identity's control, the row
  -- is RELEASED rather than superseded: nothing replaced it, the person simply
  -- no longer holds it. A released row frees the one-live-phone index below, so
  -- the identity is back to holding none, and it stops the number matching as a
  -- live node for a stranger who now legitimately owns it.
  --
  -- release_evidence is the portability record that justified it. A release
  -- with no evidence is an assertion, and the CHECK below refuses one.
  released_at        timestamptz NULL,                            -- SD-M19-05
  release_evidence   jsonb NOT NULL DEFAULT '{}',                 -- SD-M19-05

  -- (a). CARRIER AND LINE TYPE AT CAPTURE. Three of these four signal classes
  -- sit inside ADR-023's existing vendor scope; portability history is the
  -- separable one and is a DISQUALIFYING SELECTION CRITERION in that
  -- procurement, because amendment 3's guard has no input without it.
  --
  -- 'unknown' is the fail-open value and it is the DEFAULT, because the call
  -- site inherits checkout's failure posture verbatim: non-blocking, fail-open
  -- on timeout, VOIP SCORED AND NEVER REJECTED. There is no CHECK anywhere in
  -- this file that refuses a line type, and that absence is the ruling too.
  line_type          text NOT NULL DEFAULT 'unknown' CHECK (line_type IN (
                       'mobile',
                       'landline',
                       'voip',
                       'prepaid',
                       'unknown'
                     )),                                          -- SD-M19-05
  carrier_name       text NULL,                                   -- SD-M19-05
  carrier_country    char(2) NULL CHECK (carrier_country ~ '^[A-Z]{2}$'),

  -- NULLABLE ON PURPOSE, AND THE NULL IS NOT A false. Three-valued because the
  -- lookup fails open: null is "we do not know", false is "the vendor looked and
  -- there is none". The FLEET SIGNATURE (VoIP plus a fresh email plus a
  -- datacenter IP plus no footprint) is scored on footprint_present = false. A
  -- detector written against `IS NOT TRUE` would score every timeout as a fleet
  -- member, which turns a vendor outage into a mass false positive.
  ported             boolean NULL,                                -- SD-M19-05
  last_ported_at     timestamptz NULL,                            -- SD-M19-05
  footprint_present  boolean NULL,                                -- SD-M19-05

  -- WHICH vendor said so and WHEN. An enforcement decided in 2027 on a carrier
  -- lookup needs to know whose lookup it was, for kyc_verifications
  -- .liveness_method's reason (0003): a bare value ages into an assertion
  -- nobody can re-evaluate.
  lookup_provider    text NULL,                                   -- SD-M19-05
  lookup_at          timestamptz NULL,                            -- SD-M19-05

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT identity_phones_supersession_is_complete CHECK (
    (superseded_at IS NULL AND superseded_by IS NULL)
    OR
    (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)
  ),
  CONSTRAINT identity_phones_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
  ),

  -- A release is an evidenced decision or it is not a release.
  CONSTRAINT identity_phones_release_is_evidenced CHECK (
    released_at IS NULL OR release_evidence <> '{}'::jsonb
  ),

  -- SUPERSESSION AND RELEASE ARE DIFFERENT ENDINGS AND A ROW HAS AT MOST ONE.
  -- Superseded means the trader replaced it. Released means the carrier took it
  -- back. Conflating them loses the only distinction amendment 3 turns on.
  CONSTRAINT identity_phones_one_ending CHECK (
    superseded_at IS NULL OR released_at IS NULL
  ),

  -- A port date implies the port flag. The converse is deliberately NOT
  -- asserted: a vendor may report that a number was ported without saying when,
  -- and that state is exactly the one the recycling guard cannot resolve, so it
  -- routes to review. Forbidding it would force the writer to invent a date,
  -- which is worse than recording that the date is missing.
  CONSTRAINT identity_phones_port_date_implies_ported CHECK (
    last_ported_at IS NULL OR ported IS TRUE
  ),

  -- A lookup that happened has a provider, and a provider implies a lookup.
  CONSTRAINT identity_phones_lookup_is_attributed CHECK (
    (lookup_at IS NULL) = (lookup_provider IS NULL)
  )
);

-- (b), THE HALF THAT IS A DATABASE CONSTRAINT. One live verified phone per
-- identity. Live means verified, not superseded, AND NOT RELEASED: a released
-- row frees this index, which is what lets an identity whose number was
-- reassigned verify a new one without an operator unpicking anything.
CREATE UNIQUE INDEX identity_phones_live_per_identity_uq
  ON identity_phones (identity_id)
  WHERE verified_at IS NOT NULL
    AND superseded_at IS NULL
    AND released_at IS NULL;                                      -- SD-M19-05

-- (b), THE HALF THAT IS NOT. NOT UNIQUE, on the ruling in header item 1. This
-- is the read that decides whether a verification opens the severity-5 flag:
-- "is this number live on somebody else right now".
CREATE INDEX identity_phones_live_number_idx
  ON identity_phones (phone_hash)
  WHERE verified_at IS NOT NULL
    AND superseded_at IS NULL
    AND released_at IS NULL;                                      -- SD-M19-05

-- AMENDMENT 3'S READ, and it is a different question from the one above:
-- "has this number EVER been held, including by an identity that is now
-- banned". The recycling guard needs the history, not the live set, because the
-- whole point is that the prior holder is gone.
CREATE INDEX identity_phones_history_idx
  ON identity_phones (phone_hash, created_at DESC);               -- SD-M19-05

CREATE INDEX identity_phones_identity_idx
  ON identity_phones (identity_id, created_at DESC);

COMMENT ON TABLE identity_phones IS
  'SD-M19-05. ADR-039 (a), (b), amendment 3. A verified phone as an identity '
  'node, hashed. Retention: forever (fraud history), on identity_signals '
  'payment and kyc_identity precedent.';

COMMENT ON INDEX identity_phones_live_per_identity_uq IS
  'ADR-039 (b), identity -> phone. The half of the hard link that is a '
  'constraint. The phone -> identity half is deliberately not unique.';

-- -----------------------------------------------------------------------------
-- phone_change_requests                                         -- SD-M19-06
-- -----------------------------------------------------------------------------
-- ADR-039 (c) and (d). THE CEREMONY AS STATE, so that the controls are a
-- precondition of the write rather than steps a handler is trusted to take.
--
-- (c) names three controls: dual-channel verification, notification to the
-- prior number AND email, and a 48 hour external-withdrawal hold. All three are
-- asserted below by phone_change_requests_applied_is_complete. The DURATION is
-- not: 48 hours is a launch parameter that lives in config, and ADR-037 rules
-- that a shorthand may not restate a value the config owns. What the database
-- asserts is the ORDERING, which is the part a config cannot get wrong: the
-- hold must still be running at the moment the change applies. A hold that
-- expired before the change landed is not a hold.
CREATE TABLE phone_change_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id              uuid NOT NULL REFERENCES identities(id)
                             ON DELETE RESTRICT,

  state                    text NOT NULL DEFAULT 'pending' CHECK (state IN (
                             'pending',
                             'dual_channel_verified',
                             'applied',
                             'cancelled'
                           )),                                    -- SD-M19-06

  -- NOT NULL. A change request with no prior phone is not a change, it is a
  -- registration, and registration writes identity_phones directly.
  old_phone_id             uuid NOT NULL REFERENCES identity_phones(id)
                             ON DELETE RESTRICT,                  -- SD-M19-06

  -- The proposed number, hashed like every other copy of it. The identity_phones
  -- row for it is written when the request APPLIES, not when it is opened, so an
  -- abandoned request leaves no half-verified phone behind.
  new_phone_hash           bytea NOT NULL,                        -- SD-M19-06

  -- (d). NEVER SMS ALONE. This timestamp records that a passkey assertion or a
  -- second independent channel confirmed the change. sessions.elevated_by_factor
  -- below is the same rule on the session; this is it on the request.
  dual_channel_verified_at timestamptz NULL,                      -- SD-M19-06

  -- INV-M16-03 on a prior NUMBER, which is what change 6 makes possible. One
  -- timestamp for both legs because (c) requires both and a change that
  -- notified one of them has not satisfied it.
  prior_notified_at        timestamptz NULL,                      -- SD-M19-06

  -- The external-withdrawal hold. Read by the payout and wallet-withdrawal
  -- paths, which refuse an external leg while this is in the future.
  withdrawal_hold_until    timestamptz NULL,                      -- SD-M19-06

  applied_at               timestamptz NULL,                      -- SD-M19-06
  cancelled_at             timestamptz NULL,                      -- SD-M19-06
  cancelled_reason         text NULL,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- THE CONTROL. Read this one twice. Every D4 leg (c) names is a precondition
  -- of reaching 'applied', and the hold must still be running when it does.
  CONSTRAINT phone_change_requests_applied_is_complete CHECK (
    state <> 'applied'
    OR (dual_channel_verified_at IS NOT NULL
        AND prior_notified_at IS NOT NULL
        AND withdrawal_hold_until IS NOT NULL
        AND applied_at IS NOT NULL
        AND withdrawal_hold_until > applied_at)
  ),                                                              -- SD-M19-06

  -- The state and its timestamp are one fact written twice, so they agree here
  -- or the state machine has a hole in it.
  CONSTRAINT phone_change_requests_state_matches_applied CHECK (
    (state = 'applied') = (applied_at IS NOT NULL)
  ),
  CONSTRAINT phone_change_requests_state_matches_cancelled CHECK (
    (state = 'cancelled') = (cancelled_at IS NOT NULL)
  ),
  CONSTRAINT phone_change_requests_verified_state_is_earned CHECK (
    state NOT IN ('dual_channel_verified', 'applied')
    OR dual_channel_verified_at IS NOT NULL
  ),

  -- A cancellation is explained. An unexplained cancellation on a control this
  -- shape is indistinguishable from an attacker abandoning a probe.
  CONSTRAINT phone_change_requests_cancellation_is_explained CHECK (
    cancelled_at IS NULL OR cancelled_reason IS NOT NULL
  )
);

-- AT MOST ONE OPEN REQUEST PER IDENTITY. A second open request is not a second
-- ceremony, it is a way to run two holds and pick the shorter one.
CREATE UNIQUE INDEX phone_change_requests_open_per_identity_uq
  ON phone_change_requests (identity_id)
  WHERE state IN ('pending', 'dual_channel_verified');            -- SD-M19-06

-- The read every external-withdrawal path makes before it moves money: is a
-- hold running for this identity.
CREATE INDEX phone_change_requests_live_hold_idx
  ON phone_change_requests (identity_id, withdrawal_hold_until)
  WHERE withdrawal_hold_until IS NOT NULL;                        -- SD-M19-06

CREATE INDEX phone_change_requests_old_phone_idx
  ON phone_change_requests (old_phone_id);

COMMENT ON TABLE phone_change_requests IS
  'SD-M19-06. ADR-039 (c) and (d). The D4 phone-change ceremony as state. '
  'Retention: forever (security record).';

COMMENT ON CONSTRAINT phone_change_requests_applied_is_complete
  ON phone_change_requests IS
  'ADR-039 (c). Dual-channel verification, prior-contact notification and a '
  'still-running withdrawal hold are preconditions of applying a phone change, '
  'not steps a handler is trusted to have taken.';

-- -----------------------------------------------------------------------------
-- otp_send_budget                                               -- SD-M16-04
-- -----------------------------------------------------------------------------
-- ADR-039 amendment 2, and the founder's degradation ruling.
--
-- INV-M16-11 exempts the security and money classes from rate limiting, and it
-- was written for POST-IDENTITY messages: authenticated recipient, address
-- Merit already trusts. Registration OTP is PRE-IDENTITY, unauthenticated, and
-- addressed to an ATTACKER-SUPPLIED NUMBER. Rate-limit-exempt SMS there is SMS
-- pumping: the attacker owns premium-rate numbers, drives volume, takes the
-- carrier share, and Merit pays the bill. Two classes, and this table is the
-- second one's control.
--
-- ON plan_breaker_state's PATTERN FROM 0016 rather than a new idiom: a keyed
-- row per evaluation day carrying a counter, a threshold, a state and a dated
-- override. DAILY GRANULARITY IS DELIBERATE and is not an oversight about
-- bursts. Sub-minute velocity belongs at the edge, where it can refuse a send
-- before one is paid for; this table is the DURABLE, REVIEWABLE budget state,
-- which is the same job plan_breaker_state does for sales.
--
-- THE ONE PLACE IT DEPARTS FROM 0016 IS THE STATE VOCABULARY, AND THAT IS THE
-- FOUNDER'S RULING. See header item 2. There is no 'paused'.
CREATE TABLE otp_send_budget (
  -- WHAT IS BEING BUDGETED. Three velocity scopes from amendment 2 plus the
  -- cost circuit breaker, which is 'global' because Merit's SMS bill is one
  -- number and a per-country breaker cannot see an attack spread across ten.
  scope_kind             text NOT NULL CHECK (scope_kind IN (
                           'phone',
                           'ip',
                           'country',
                           'global'
                         )),                                      -- SD-M16-04

  -- For 'phone' this is encode(phone_hash, 'hex') and NEVER the number: a
  -- rate-limit table is not a reason to keep the one plaintext copy the rest of
  -- this file refuses to keep. For 'ip' the address, for 'country' the alpha-2,
  -- for 'global' the literal 'global'.
  scope_key              text NOT NULL CHECK (scope_key <> ''),   -- SD-M16-04

  evaluated_on           date NOT NULL,

  -- THE VELOCITY HALF.
  sends                  integer NOT NULL DEFAULT 0 CHECK (sends >= 0),
  send_limit             integer NOT NULL CHECK (send_limit > 0),

  -- THE COST HALF. Integer cents, per the constitution and DATA_MODEL section 1.
  spend_cents            bigint NOT NULL DEFAULT 0 CHECK (spend_cents >= 0),
  budget_cents           bigint NOT NULL CHECK (budget_cents > 0),

  -- THREE STATES, AND THE MISSING FOURTH IS THE RULING. 'degraded' is what a
  -- tripped breaker says, and a degraded breaker still lets registration
  -- complete with verification deferred to ADR-021's pre_funded gate.
  state                  text NOT NULL DEFAULT 'armed' CHECK (state IN (
                           'armed',
                           'degraded',
                           'manually_overridden'
                         )),                                      -- SD-M16-04

  tripped_at             timestamptz NULL,                        -- SD-M16-04

  -- THE ALARM IS NOT OPTIONAL AND IS THE HALF THAT DECAYS. A degraded mode
  -- nobody is watching becomes the normal mode, so the trip cannot be recorded
  -- without the alarm having been raised. See the CHECK below.
  alarm_raised_at        timestamptz NULL,                        -- SD-M16-04
  recovered_at           timestamptz NULL,                        -- SD-M16-04

  -- THE REPORTED FIGURE, WITH SOMEWHERE TO LIVE. ADR-039 requires that the
  -- number of registrations completing unverified during a degraded window is
  -- reported, "because a queue nobody drains is a fail-open with extra steps".
  -- A required figure with no column is the OI-06 shape: a control citing an
  -- input that does not exist.
  deferred_registrations integer NOT NULL DEFAULT 0
                           CHECK (deferred_registrations >= 0),   -- SD-M16-04

  -- An override is dated and expires, on 0016's ruling: an indefinite override
  -- is a disabled breaker with a nicer name.
  override_reason        text NULL,
  override_expires_at    timestamptz NULL,
  changed_by             text NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (scope_kind, scope_key, evaluated_on),

  -- One global row per day, not one per spelling of the word.
  CONSTRAINT otp_send_budget_global_is_singular CHECK (
    scope_kind <> 'global' OR scope_key = 'global'
  ),

  -- A SILENT TRIP IS NOT PERMITTED TO BE WRITTEN.
  CONSTRAINT otp_send_budget_degraded_is_alarmed CHECK (
    state <> 'degraded'
    OR (tripped_at IS NOT NULL AND alarm_raised_at IS NOT NULL)
  ),                                                              -- SD-M16-04

  CONSTRAINT otp_send_budget_recovery_follows_a_trip CHECK (
    recovered_at IS NULL
    OR (tripped_at IS NOT NULL AND recovered_at > tripped_at)
  ),
  CONSTRAINT otp_send_budget_degraded_is_not_recovered CHECK (
    state <> 'degraded' OR recovered_at IS NULL
  ),

  -- A deferred registration only exists because a breaker tripped. If this
  -- count is non-zero with no trip, either the count is wrong or registrations
  -- are being deferred by something nobody declared.
  CONSTRAINT otp_send_budget_deferrals_have_a_trip CHECK (
    deferred_registrations = 0 OR tripped_at IS NOT NULL
  ),                                                              -- SD-M16-04

  CONSTRAINT otp_send_budget_override_is_complete CHECK (
    state <> 'manually_overridden'
    OR (override_reason IS NOT NULL
        AND override_expires_at IS NOT NULL
        AND changed_by IS NOT NULL)
  )
);

-- What is degraded right now, which is the alarm sweep's read and the figure
-- the degraded window has to report against.
CREATE INDEX otp_send_budget_degraded_idx
  ON otp_send_budget (evaluated_on DESC, scope_kind)
  WHERE state = 'degraded';                                       -- SD-M16-04

CREATE INDEX otp_send_budget_override_expiry_idx
  ON otp_send_budget (override_expires_at)
  WHERE state = 'manually_overridden';

COMMENT ON TABLE otp_send_budget IS
  'SD-M16-04. ADR-039 amendment 2. Pre-identity OTP velocity by number, IP and '
  'country, plus the global cost circuit breaker. The breaker DEGRADES, it does '
  'not stop. Retention: 24 months (abuse history).';

COMMENT ON COLUMN otp_send_budget.state IS
  'ADR-039. armed, degraded, manually_overridden. There is deliberately no '
  'stopping state: phone verification is mandatory at registration, so a '
  'breaker that stops is a denial of service on customer acquisition.';

-- -----------------------------------------------------------------------------
-- otp_challenges gains a channel and a second kind of destination -- SD-M16-05
-- -----------------------------------------------------------------------------
-- 0002 built otp_challenges for one channel: email_normalized NOT NULL, and the
-- address IS the key. SMS OTP needs a second destination shape, and the number
-- is hashed for the same reason every other copy of it in this file is.
--
-- NO DEFAULT ON channel, DELIBERATELY. Adding the column NOT NULL with no
-- default is safe because the set applies forward-only from empty and there is
-- no deployed database. A DEFAULT 'email' would be worse than unnecessary: a
-- handler that forgot to set the channel on an SMS send would write a
-- well-formed email challenge and the exactly-one-destination CHECK below would
-- be the only thing that noticed, which is a constraint doing a type's job.
ALTER TABLE otp_challenges
  ADD COLUMN channel text NOT NULL CHECK (channel IN ('email', 'sms'));

ALTER TABLE otp_challenges
  ADD COLUMN destination_hash bytea NULL;                         -- SD-M16-05

-- Relaxed, not dropped. An SMS challenge has no email address, and 0002 made
-- the column NOT NULL because at the time there was no other kind of challenge.
ALTER TABLE otp_challenges
  ALTER COLUMN email_normalized DROP NOT NULL;                    -- SD-M16-05

-- EXACTLY ONE DESTINATION, AND IT IS THE ONE THE CHANNEL NAMES. Two destinations
-- on one challenge is a code delivered twice, which halves the work of
-- intercepting it; zero is a challenge nobody can answer.
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_exactly_one_destination
  CHECK (
    (channel = 'email' AND email_normalized IS NOT NULL AND destination_hash IS NULL)
    OR
    (channel = 'sms'   AND email_normalized IS NULL     AND destination_hash IS NOT NULL)
  );                                                              -- SD-M16-05

-- The SMS sibling of otp_challenges_email_created_idx (0002): the per-number
-- velocity read, which is what otp_send_budget's 'phone' scope is counted from.
CREATE INDEX otp_challenges_destination_created_idx
  ON otp_challenges (destination_hash, created_at DESC)
  WHERE destination_hash IS NOT NULL;                             -- SD-M16-05

COMMENT ON COLUMN otp_challenges.destination_hash IS
  'SD-M16-05. The SMS destination, hashed. Never the number: an OTP table is '
  'not a reason to keep a plaintext copy of every number ever entered, '
  'including every number entered by an attacker.';

-- -----------------------------------------------------------------------------
-- sessions records HOW it was established, and how it was elevated -- SD-M4-04
-- -----------------------------------------------------------------------------
-- C-27, ADR-039 amendment 4. AMENDMENT 4 IS UNENFORCEABLE WITHOUT THIS: a
-- handler cannot refuse an SMS-established session for a sensitive action if
-- the session never recorded how it was established. An emergent property of
-- two rules is not enforceable, and sessions cannot refuse what it never wrote
-- down.
--
-- Any single factor establishes a session sufficient for EVERY READ SURFACE.
-- No single factor, and specifically never SMS alone, is sufficient for a
-- sensitive action: payout destination change, contact change of either kind,
-- external withdrawal. Each requires a passkey assertion or a dual-channel
-- confirmation, which ELEVATES the session rather than re-establishing it.
ALTER TABLE sessions
  ADD COLUMN auth_factor text NOT NULL CHECK (auth_factor IN (
    'passkey',
    'email_otp',
    'sms_otp'
  ));                                                             -- SD-M4-04

ALTER TABLE sessions
  ADD COLUMN elevated_at timestamptz NULL;                        -- SD-M4-04

-- THIS CHECK LIST IS C-27. Two values, and neither of them is a single factor.
-- There is no 'sms_otp' here and there is no 'email_otp' here, so a session
-- established by either cannot elevate itself: the database has no value for
-- the thing such a handler would have to write. A SIM-swapped session can see
-- everything and change nothing, and that is a vocabulary rather than a rule
-- somebody remembers.
ALTER TABLE sessions
  ADD COLUMN elevated_by_factor text NULL CHECK (elevated_by_factor IN (
    'passkey',
    'dual_channel'
  ));                                                             -- SD-M4-04

ALTER TABLE sessions ADD CONSTRAINT sessions_elevation_is_complete CHECK (
  (elevated_at IS NULL AND elevated_by_factor IS NULL)
  OR
  (elevated_at IS NOT NULL AND elevated_by_factor IS NOT NULL)
);                                                                -- SD-M4-04

-- There is deliberately NO elevation_expires_at. The elevation window is a
-- launch parameter the config owns (ADR-037), evaluated against elevated_at at
-- the moment of the sensitive action. A stored expiry would be a second copy of
-- a config value AND would create an expiry column with no release job, which
-- is the class FOLD-02's CI-06l exists to catch.
COMMENT ON COLUMN sessions.elevated_by_factor IS
  'SD-M4-04, C-27. passkey or dual_channel, and nothing else. Never SMS alone: '
  'the check list is the enforcement.';

-- -----------------------------------------------------------------------------
-- contact_channels accepts an SMS destination                   -- SD-M16-06
-- -----------------------------------------------------------------------------
-- FOLD-01 finding 4, and (c) is UNBUILDABLE WITHOUT IT. INV-M16-03's
-- prior-contact countermeasure notifies the PRIOR contact when a contact
-- changes, and 0019 wrote kind CHECK (kind IN ('email','push')). There was no
-- row shape for a phone number, so "notify the prior number" had nothing to
-- notify.
--
-- The live-uniqueness index contact_channels_live_uq is already per
-- (identity_id, kind), so it needs no change: it now means one live SMS
-- destination per identity as well, which is the correct reading and is what
-- (b) implies for the delivery side.
--
-- 0019 wrote the check inline, so Postgres named it contact_channels_kind_check.
-- Dropped and re-added under an explicit name, so the next widening does not
-- depend on a generated name staying generated.
ALTER TABLE contact_channels DROP CONSTRAINT contact_channels_kind_check;
ALTER TABLE contact_channels ADD CONSTRAINT contact_channels_kind_allowed CHECK (
  kind IN ('email', 'push', 'sms')
);                                                                -- SD-M16-06

-- -----------------------------------------------------------------------------
-- identity_signals learns two phone kinds                       -- U-07
-- -----------------------------------------------------------------------------
-- UNNUMBERED, and it takes the next free unnumbered slot for U-04's reason
-- exactly: ADR-039 creates a signal source and no delta creates the value it
-- writes under. It is the seventh.
--
-- Two kinds, not one, because they are different nodes in ADR-022's graph and
-- weigh differently. 'phone' is the number itself, a HIGH-WEIGHT node: emails
-- are free to mint and real mobile numbers are scarce, which is the whole
-- premise of ADR-039. 'phone_carrier' is the carrier and line-type observation,
-- a WEAK node on its own that is only worth anything in a composite: every
-- prepaid VoIP number on one carrier is not a ring, and treating it as one
-- would flag a country rather than a fleet.
ALTER TABLE identity_signals DROP CONSTRAINT identity_signals_kind_check;
ALTER TABLE identity_signals ADD CONSTRAINT identity_signals_kind_allowed CHECK (
  kind IN (
    'device',
    'ip',
    'asn',
    'email_normalized',
    'payment',
    'kyc_identity',
    'rise_identity',
    'footprint_enrichment',   -- U-04
    'phone',                  -- U-07
    'phone_carrier'           -- U-07
  )
);                                                                -- U-07

-- -----------------------------------------------------------------------------
-- notification_kinds gains a fifth class and an unforgeable exemption
-- -----------------------------------------------------------------------------
--                                                               -- SD-M16-07
-- ADR-039 amendment 2, made structural the way SD-M16-01 already made `mutable`
-- structural.
--
-- INV-M16-11 IS CONFIRMED AND NOT AMENDED, in those words. It exempts the
-- security and money classes from rate limiting and it stays exactly as
-- written. What changes is that a FIFTH class exists which is not either of
-- them, so the exemption no longer reaches the pre-identity surface by default.
--
-- rate_limit_exempt IS GENERATED FROM class. As an ordinary boolean, one seed
-- row marking the registration-OTP kind exempt would restore SMS pumping and
-- nothing would object; generated, the two facts cannot disagree at all.
--
-- AND THE EXISTING `mutable` COLUMN ALREADY GIVES THE RIGHT ANSWER FOR THE NEW
-- CLASS WITHOUT BEING TOUCHED: pre_identity_auth is not in
-- ('account_state','marketing'), so it is not silenceable, which is correct.
-- Nobody may opt out of the OTP that proves they own the number they are
-- registering. That is what a generated column buys, and it is worth naming.
--
-- notifications.class IS DELIBERATELY NOT WIDENED, and the reason is structural
-- rather than an omission: notifications.identity_id is NOT NULL (0019), so a
-- pre-identity message cannot be a notifications row at all. There is no
-- identity yet, which is what "pre-identity" means. The kind exists here as
-- POLICY, read by the SMS sender to decide whether to consult otp_send_budget;
-- the delivery record is otp_challenges plus an integration_dispatches row. A
-- later session "completing the pair" by widening notifications.class would be
-- adding a value that no row can ever legally carry.
ALTER TABLE notification_kinds DROP CONSTRAINT notification_kinds_class_check;
ALTER TABLE notification_kinds ADD CONSTRAINT notification_kinds_class_allowed CHECK (
  class IN (
    'security',
    'money',
    'account_state',
    'marketing',
    'pre_identity_auth'       -- SD-M16-07
  )
);                                                                -- SD-M16-07

ALTER TABLE notification_kinds
  ADD COLUMN rate_limit_exempt boolean GENERATED ALWAYS AS (
    class IN ('security', 'money')
  ) STORED;                                                       -- SD-M16-07

-- AN OTP IS NEVER COALESCED. Three OTP requests are three codes, and collapsing
-- a burst of them into one message delivers one code for three challenges,
-- which is a broken login rather than a tidy inbox. 0019 already forbade
-- coalescing for security and money; the new class joins them, and the
-- constraint is dropped and re-added rather than a second one added beside it,
-- so there stays exactly one place that answers this question.
ALTER TABLE notification_kinds
  DROP CONSTRAINT notification_kinds_immutable_never_coalesced;
ALTER TABLE notification_kinds
  ADD CONSTRAINT notification_kinds_immutable_never_coalesced CHECK (
    class NOT IN ('security', 'money', 'pre_identity_auth')
    OR coalesce_key_spec IS NULL
  );                                                              -- SD-M16-07

CREATE INDEX notification_kinds_rate_limit_exempt_idx
  ON notification_kinds (rate_limit_exempt);                      -- SD-M16-07

COMMENT ON COLUMN notification_kinds.rate_limit_exempt IS
  'SD-M16-07. Generated from class, on mutable''s pattern. INV-M16-11 is '
  'CONFIRMED, not amended: security and money stay exempt. pre_identity_auth is '
  'non-exempt by construction, which is what refuses SMS pumping.';

-- -----------------------------------------------------------------------------
-- kyc_verifications learns the phone-change re-verification     -- SD-M19-07
-- -----------------------------------------------------------------------------
-- ADR-039 (c), INV-M19-06. A re-verification is a NEW ROW linked to the one it
-- supersedes, and a phone change is one of the triggers that calls for one.
--
-- kyc_verifications_supersession_matches_purpose (0003) already binds the new
-- value correctly with no change: it requires that any non-'initial' purpose
-- supersedes something. A phone-change re-verification that supersedes nothing
-- is refused by a constraint written before this value existed, which is what a
-- constraint written against the SHAPE rather than against a list buys.
ALTER TABLE kyc_verifications
  DROP CONSTRAINT kyc_verifications_verification_purpose_check;
ALTER TABLE kyc_verifications
  ADD CONSTRAINT kyc_verifications_verification_purpose_allowed CHECK (
    verification_purpose IN (
      'initial',
      'reverify_destination',
      'reverify_flag',
      'reverify_dormant',
      'reverify_expiry',
      'reverify_phone_change'   -- SD-M19-07
    )
  );                                                              -- SD-M19-07

COMMIT;
