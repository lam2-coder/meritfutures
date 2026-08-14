-- =============================================================================
-- 0018_integrations
-- =============================================================================
-- Not a money-path file. It is a DISCLOSURE-path file, and the three tables
-- below answer three questions that are asked under pressure:
--
--   1. "What are we sending Loops?" -> integration_contracts, which makes the
--      answer a query rather than a code review.
--   2. "What did we send about this person?" -> integration_dispatches. A
--      privacy deletion request and a vendor breach ask the IDENTICAL
--      question, and neither can be answered from a log that rotates in 30
--      days.
--   3. "Who at support looked at this identity?" -> support_context_views. A
--      support agent reading the identity graph is a privileged read happening
--      OUTSIDE the admin origin's IP allowlist and hardware-key SSO.
--
-- Deltas folded: SD-M10-01, SD-M10-02, SD-M10-03
--
-- One outbound bus, one field-allowlist contract per vendor, so "what did we
-- tell that vendor about this trader" has exactly one answer.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- integration_contracts                                         -- SD-M10-01
-- -----------------------------------------------------------------------------
-- INV-M10-02. WITHOUT A DECLARED PER-VENDOR FIELD ALLOWLIST, the payload sent
-- to a vendor is whatever the event happened to contain on the day it was
-- serialized, WHICH MEANS A SCHEMA ADDITION SILENTLY BECOMES A DISCLOSURE.
--
-- That is the failure this table prevents and it is worth stating precisely:
-- nobody decides to leak the new column. Someone adds a column to an event
-- payload for an unrelated reason, and the vendor starts receiving it that
-- afternoon.
--
-- Making the contract A ROW rather than code also makes it reviewable by
-- someone who does not read the repository, which is the founder.
CREATE TABLE integration_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration      text NOT NULL,
  event_name       text NOT NULL,

  -- THE ALLOWLIST. Not a denylist, because a denylist defaults to sending.
  field_allowlist  text[] NOT NULL,

  enabled          boolean NOT NULL DEFAULT false,

  -- An optional predicate that must hold before this event is dispatched at
  -- all, evaluated over the allowlisted fields only.
  guard_expression text NULL,

  version          integer NOT NULL DEFAULT 1 CHECK (version > 0),

  -- A contract is APPROVED, by a person, on a date. An enabled contract with
  -- no approver is a disclosure nobody authorised.
  approved_by      text NOT NULL,
  approved_at      timestamptz NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),

  -- An empty allowlist that is enabled would dispatch an event with no fields,
  -- which is either a bug or a signal channel. Neither should be silent.
  CONSTRAINT integration_contracts_enabled_has_fields CHECK (
    enabled = false OR array_length(field_allowlist, 1) >= 1
  )
);

CREATE UNIQUE INDEX integration_contracts_version_uq
  ON integration_contracts (integration, event_name, version);

-- The dispatcher's read: the live contract for this vendor and this event.
CREATE UNIQUE INDEX integration_contracts_live_uq
  ON integration_contracts (integration, event_name) WHERE enabled;

-- -----------------------------------------------------------------------------
-- integration_dispatches                                        -- SD-M10-02
-- -----------------------------------------------------------------------------
-- INV-M10-03. APPEND-ONLY, and THE ONLY TABLE IN THIS MODULE WITH A RETENTION
-- LONGER THAN A QUARTER.
--
-- fields_sent records what actually went, not what the contract permitted. The
-- two can differ when a field is absent from a particular event, and the
-- breach question is about what left the building rather than about what was
-- allowed to.
CREATE TABLE integration_dispatches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration      text NOT NULL,
  event_id         bigint NULL REFERENCES events(id) ON DELETE RESTRICT,

  -- Nullable because not every dispatch is about a person, and the ones that
  -- are not must not be findable by an identity search that returns them
  -- anyway.
  identity_id      uuid NULL REFERENCES identities(id) ON DELETE RESTRICT,

  fields_sent      text[] NOT NULL,                               -- SD-M10-02

  status           text NOT NULL CHECK (status IN (
                     'queued', 'sent', 'failed', 'dropped_by_guard'
                   )),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  response_code    integer NULL,
  dispatched_at    timestamptz NULL,
  idempotency_key  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT integration_dispatches_sent_has_timestamp CHECK (
    status <> 'sent' OR dispatched_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX integration_dispatches_idempotency_uq
  ON integration_dispatches (integration, idempotency_key);

-- THE DELETION-REQUEST AND BREACH QUERY: everything ever sent about this
-- person, to anyone.
CREATE INDEX integration_dispatches_identity_idx
  ON integration_dispatches (identity_id, created_at DESC)
  WHERE identity_id IS NOT NULL;

CREATE INDEX integration_dispatches_integration_idx
  ON integration_dispatches (integration, created_at DESC);
CREATE INDEX integration_dispatches_retry_idx
  ON integration_dispatches (created_at) WHERE status IN ('queued', 'failed');

COMMENT ON TABLE integration_dispatches IS
  'SD-M10-02. Append-only. Retention: long, deliberately. A privacy deletion '
  'request and a vendor breach ask the same question and a 30-day log cannot '
  'answer either.';

-- -----------------------------------------------------------------------------
-- support_context_views                                         -- SD-M10-03
-- -----------------------------------------------------------------------------
-- INV-M10-05, AS-M10-01. Social engineering through support is item 9 in the
-- adversary dossier, and an unaudited support surface is AN UNMONITORED BACK
-- DOOR INTO THE CROWN JEWEL.
--
-- ip_hash rather than ip: this is an audit of Merit's own staff, and the
-- audit should not itself become a second store of personal data about them.
CREATE TABLE support_context_views (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_ref         text NOT NULL,
  identity_id       uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- WHAT WAS RETURNED, not what was requested. A view that logs the request
  -- cannot answer what the agent actually saw.
  fields_returned   text[] NOT NULL,                              -- SD-M10-03

  conversation_ref  text NULL,
  viewed_at         timestamptz NOT NULL DEFAULT now(),
  ip_hash           bytea NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_context_views_identity_idx
  ON support_context_views (identity_id, viewed_at DESC);
CREATE INDEX support_context_views_agent_idx
  ON support_context_views (agent_ref, viewed_at DESC);

COMMIT;
