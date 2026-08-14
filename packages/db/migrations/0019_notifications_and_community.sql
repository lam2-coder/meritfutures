-- =============================================================================
-- 0019_notifications_and_community
-- =============================================================================
-- Not a money-path file. Two modules share it because they are the same
-- surface seen twice: everything Merit says to a trader, and everything Merit
-- says about a trader in public.
--
-- Three things worth the careful read:
--
--   1. SD-M16-01's class IS THE MODULE'S ENTIRE POLICY, and it belongs in
--      data, where it can be reviewed in one query, rather than distributed
--      across handlers. `mutable` is GENERATED from class so the two can never
--      disagree, which is the sort of drift that produces a silenceable money
--      notification eighteen months from now.
--   2. SD-M16-03's contact_channels. NOTIFYING "THE PREVIOUS CONTACT"
--      REQUIRES THE PREVIOUS CONTACT TO EXIST AS A ROW rather than as a value
--      that was overwritten. This is the schema that makes the classic
--      account-takeover countermeasure possible, and ITS ABSENCE IS WHY THAT
--      COUNTERMEASURE IS SO OFTEN MISSING.
--   3. SD-M15-01's role_opt_ins is an ARRAY BECAUSE CONSENT IS PER ROLE. A
--      trader may be happy to be publicly "Funded" and not at all happy to be
--      publicly "Recently Paid".
--
-- Deltas folded: SD-M15-01, SD-M15-02, SD-M16-01, SD-M16-02, SD-M16-03
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- notification_kinds                                            -- SD-M16-01
-- -----------------------------------------------------------------------------
-- INV-M16-01, INV-M16-02, INV-M16-08.
CREATE TABLE notification_kinds (
  kind              text PRIMARY KEY,

  -- THE POLICY. Four classes deciding what a preference may silence:
  --   security      never silenceable. Passkey added, session revoked,
  --                 contact changed.
  --   money         never silenceable. Payout approved, settled, frozen;
  --                 wallet credited or debited.
  --   account_state silenceable. Phase changes, breaches, expiry warnings.
  --   marketing     silenceable, and requires consent to send at all.
  class             text NOT NULL CHECK (class IN (
                      'security', 'money', 'account_state', 'marketing'
                    )),

  title             text NOT NULL,
  template_code     text NOT NULL,
  template_version  integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  default_channels  text[] NOT NULL DEFAULT '{in_app}',

  -- SD-M16-01. GENERATED FROM class, never written independently. If this were
  -- an ordinary column, a money notification could be marked mutable by a
  -- single careless insert and nothing would object. Generated, the two facts
  -- cannot disagree at all.
  mutable           boolean GENERATED ALWAYS AS (
                      class IN ('account_state', 'marketing')
                    ) STORED,                                     -- SD-M16-01

  -- How to collapse a burst into one message. Null means never coalesce, which
  -- is correct for security and money: three payout events are three facts.
  coalesce_key_spec text NULL,                                    -- SD-M16-01

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- SD-M16-01. A security or money notification is never coalesced away.
  CONSTRAINT notification_kinds_immutable_never_coalesced CHECK (
    class NOT IN ('security', 'money') OR coalesce_key_spec IS NULL
  ),

  CONSTRAINT notification_kinds_has_channels CHECK (
    array_length(default_channels, 1) >= 1
  )
);

CREATE INDEX notification_kinds_class_idx ON notification_kinds (class);

COMMENT ON COLUMN notification_kinds.mutable IS
  'SD-M16-01. Generated from class so the two can never disagree. Security '
  'and money notifications are not silenceable by preference.';

-- -----------------------------------------------------------------------------
-- notifications                                                 -- SD-M16-02
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id      uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  kind             text NOT NULL REFERENCES notification_kinds(kind) ON DELETE RESTRICT,

  -- 'push' RESERVED NOW so the future mobile surface needs no migration.
  channel          text NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),

  payload          jsonb NOT NULL DEFAULT '{}',
  read_at          timestamptz NULL,
  sent_at          timestamptz NULL,

  -- SD-M16-02. Denormalized from notification_kinds AT SEND TIME. The class a
  -- message was sent under is a historical fact; the kind's class today is a
  -- current policy. Reclassifying a kind must not rewrite what was already
  -- sent under the old policy.
  class            text NOT NULL CHECK (class IN (
                     'security', 'money', 'account_state', 'marketing'
                   )),                                            -- SD-M16-02
  template_version integer NOT NULL CHECK (template_version > 0), -- SD-M16-02

  -- SD-M16-02. WHAT MAKES A MESSAGE REPRODUCIBLE YEARS LATER. A template plus
  -- a payload is reproducible only while the template still exists in the
  -- shape it had; the rendered body is the artifact.
  rendered_body    text NULL,                                     -- SD-M16-02

  coalesce_key     text NULL,                                     -- SD-M16-02

  -- SD-M16-02. The vendor dispatch that carried it, when one did.
  dispatch_ref     uuid NULL REFERENCES integration_dispatches(id)
                     ON DELETE RESTRICT,                          -- SD-M16-02

  -- SD-M16-02. INV-M16-05, INV-M16-09. THREE DIFFERENT FACTS: sent_at is when
  -- Merit handed it over, delivery_status and delivered_at are what the
  -- channel reported back, read_at is what the trader did. AS-M16-05's
  -- distinction between DISPATCH, DELIVERY and READING is not expressible
  -- without all three, and "we notified you" is a claim that needs the middle
  -- one to be true.
  delivery_status  text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN (
                     'pending', 'delivered', 'bounced', 'suppressed', 'failed'
                   )),                                            -- SD-M16-02
  delivered_at     timestamptz NULL,                              -- SD-M16-02

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_delivered_has_timestamp CHECK (
    delivery_status <> 'delivered' OR delivered_at IS NOT NULL
  ),
  CONSTRAINT notifications_read_implies_sent CHECK (
    read_at IS NULL OR sent_at IS NOT NULL
  )
);

CREATE INDEX notifications_identity_idx ON notifications (identity_id, created_at DESC);
CREATE INDEX notifications_unread_idx
  ON notifications (identity_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_coalesce_idx
  ON notifications (identity_id, coalesce_key, created_at DESC)
  WHERE coalesce_key IS NOT NULL;
CREATE INDEX notifications_undelivered_idx
  ON notifications (created_at) WHERE delivery_status IN ('pending', 'failed');

-- -----------------------------------------------------------------------------
-- notification_preferences
-- -----------------------------------------------------------------------------
-- A preference exists per kind per channel. What it may silence is decided by
-- notification_kinds.mutable, enforced in the send path: a preference row
-- against an immutable kind is permitted to exist and is ignored, because
-- refusing to store it produces a settings screen that lies about what it
-- saved.
CREATE TABLE notification_preferences (
  identity_id  uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  kind         text NOT NULL REFERENCES notification_kinds(kind) ON DELETE RESTRICT,
  channel      text NOT NULL CHECK (channel IN ('in_app', 'email', 'push')),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (identity_id, kind, channel)
);

-- -----------------------------------------------------------------------------
-- contact_channels                                              -- SD-M16-03
-- -----------------------------------------------------------------------------
-- INV-M16-03. THE PREVIOUS CONTACT MUST EXIST AS A ROW.
--
-- The account-takeover countermeasure is: when a contact changes, notify the
-- PRIOR contacts for a window. That is impossible if the contact is a column
-- that was overwritten, which is why the countermeasure is so often missing.
-- Supersession rather than update, for the same reason daily_marks supersedes.
--
-- value_hash rather than the value: this table exists to notify a prior
-- address, and the sending path holds the address. Storing a second plaintext
-- copy of every address a trader has ever used buys nothing and costs a
-- breach.
CREATE TABLE contact_channels (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id    uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  kind           text NOT NULL CHECK (kind IN ('email', 'push')),
  value_hash     bytea NOT NULL,
  verified_at    timestamptz NULL,
  superseded_at  timestamptz NULL,
  superseded_by  uuid NULL REFERENCES contact_channels(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_channels_supersession_is_complete CHECK (
    (superseded_at IS NULL AND superseded_by IS NULL)
    OR
    (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)
  ),
  CONSTRAINT contact_channels_no_self_supersede CHECK (
    superseded_by IS NULL OR superseded_by <> id
  )
);

-- One live channel per identity per kind.
CREATE UNIQUE INDEX contact_channels_live_uq
  ON contact_channels (identity_id, kind) WHERE superseded_at IS NULL;

-- SD-M16-03. The countermeasure's read: recently superseded contacts, which
-- are the ones still inside the notification window.
CREATE INDEX contact_channels_recently_superseded_idx
  ON contact_channels (superseded_at) WHERE superseded_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- discord_links                                                 -- SD-M15-01
-- -----------------------------------------------------------------------------
-- INV-M15-01, INV-M15-03.
--
-- role_opt_ins is an ARRAY BECAUSE CONSENT IS PER ROLE. A trader may be happy
-- to be publicly "Funded" and not at all happy to be publicly "Recently Paid".
-- A single boolean would force one answer onto both.
--
-- The nonce is stored HASHED so a stolen database yields no live link tokens,
-- and it is what makes the link flow resistant to a replayed link request.
CREATE TABLE discord_links (
  identity_id      uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  discord_user_id  text NOT NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz NULL,
  role_opt_ins     text[] NOT NULL DEFAULT '{}',                  -- SD-M15-01
  link_nonce_hash  bytea NOT NULL,                                -- SD-M15-01
  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (identity_id, discord_user_id)
);

-- A Discord account links to at most one live identity. A link is never a
-- credential and must not become one by accident of multiplicity.
CREATE UNIQUE INDEX discord_links_live_discord_user_uq
  ON discord_links (discord_user_id) WHERE revoked_at IS NULL;

CREATE INDEX discord_links_identity_idx ON discord_links (identity_id);

-- -----------------------------------------------------------------------------
-- discord_announcements                                         -- SD-M15-02
-- -----------------------------------------------------------------------------
-- INV-M15-04, INV-M15-05. EVERY MESSAGE MERIT HAS EVER POSTED IN ITS OWN
-- COMMUNITY, REPRODUCIBLE, WITH THE EVENT THAT CAUSED IT.
--
-- In a market where one announcement destroyed a firm, being able to prove
-- exactly what was said and when is worth a table. Announcements are
-- TEMPLATE-ONLY: template_code is NOT NULL, so there is no path by which a
-- free-text post reaches the channel through this system.
CREATE TABLE discord_announcements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              bigint NULL REFERENCES events(id) ON DELETE RESTRICT,
  template_code         text NOT NULL,                            -- SD-M15-02
  channel_id            text NOT NULL,
  rendered_body         text NOT NULL,                            -- SD-M15-02
  posted_at             timestamptz NULL,
  provider_message_ref  text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT discord_announcements_posted_has_ref CHECK (
    posted_at IS NULL OR provider_message_ref IS NOT NULL
  )
);

CREATE INDEX discord_announcements_posted_idx
  ON discord_announcements (posted_at DESC);
CREATE INDEX discord_announcements_event_idx
  ON discord_announcements (event_id) WHERE event_id IS NOT NULL;

COMMIT;
