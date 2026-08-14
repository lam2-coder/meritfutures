-- =============================================================================
-- 0017_events_and_audit
-- =============================================================================
-- No deltas land here. Every table is DATA_MODEL section 10 as approved, and
-- the file exists because these three are the append-only spine that the
-- admin feed, analytics, messaging and audit all read.
--
-- Two things worth reading even though nothing changed:
--
--   1. admin_actions.reason IS NOT NULL. No unexplained admin action, ever.
--      That is the constraint, not a convention, and it is the first thing any
--      enforcement dispute asks for.
--   2. admin_actions exists ALONGSIDE events rather than instead of it, so the
--      audit query never depends on event-payload shape. Every admin action
--      also emits an event; the duplication is the point.
--
-- Full event catalogue: docs/architecture/EVENTS.md.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
-- APPEND-ONLY, no UPDATE, no DELETE. Retention: forever.
CREATE TABLE events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name      text NOT NULL,   -- dotted name, versioned by schema_version

  -- Payloads evolve; CONSUMERS MUST KNOW WHICH SHAPE THEY HOLD. A consumer
  -- that infers the shape from the fields present is a consumer that breaks
  -- silently when a field becomes optional.
  schema_version  smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),

  -- WHEN THE FACT HAPPENED versus WHEN WE LEARNED IT. Both, because they
  -- diverge on exactly the events where the difference matters: vendor
  -- corrections, late webhooks, backfills.
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),

  identity_id     uuid NULL REFERENCES identities(id) ON DELETE RESTRICT,
  account_id      uuid NULL REFERENCES accounts(id) ON DELETE RESTRICT,

  -- Polymorphic subject. Not a foreign key, because the subject can be any of
  -- a dozen kinds and a nullable column per kind is worse than a pair.
  subject_kind    text NOT NULL,
  subject_id      uuid NOT NULL,

  -- Validated against the event's zod schema AT WRITE TIME.
  payload         jsonb NOT NULL,

  actor_kind      text NOT NULL CHECK (actor_kind IN (
                    'system', 'trader', 'admin', 'vendor'
                  )),
  actor_id        text NULL,

  -- Ties a saga's events together. The correlation is what makes "show me
  -- everything that happened because of this purchase" one query.
  correlation_id  uuid NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_account_time_idx ON events (account_id, occurred_at DESC);
CREATE INDEX events_identity_time_idx ON events (identity_id, occurred_at DESC);
CREATE INDEX events_name_time_idx ON events (event_name, occurred_at DESC);
CREATE INDEX events_correlation_idx ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX events_subject_idx ON events (subject_kind, subject_id);

-- -----------------------------------------------------------------------------
-- admin_actions
-- -----------------------------------------------------------------------------
-- APPEND-ONLY. Every row also emits an event; this table exists so the audit
-- query never depends on event-payload shape.
CREATE TABLE admin_actions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor         text NOT NULL,
  action        text NOT NULL,
  subject_kind  text NOT NULL,
  subject_id    uuid NOT NULL,

  -- NO UNEXPLAINED ADMIN ACTION, EVER. NOT NULL is the whole control.
  reason        text NOT NULL,

  -- The before and after, so the action is reconstructable without replaying
  -- the system that produced it.
  before        jsonb NOT NULL,
  after         jsonb NOT NULL,

  evidence_refs jsonb NOT NULL DEFAULT '[]',
  ip            inet NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_actions_subject_idx ON admin_actions (subject_kind, subject_id, created_at DESC);
CREATE INDEX admin_actions_actor_idx ON admin_actions (actor, created_at DESC);
CREATE INDEX admin_actions_action_idx ON admin_actions (action, created_at DESC);

-- -----------------------------------------------------------------------------
-- idempotency_keys
-- -----------------------------------------------------------------------------
-- Replaying a key returns the stored response VERBATIM. Retention: 30 days.
CREATE TABLE idempotency_keys (
  key              text PRIMARY KEY,   -- scoped by endpoint prefix
  identity_id      uuid NULL REFERENCES identities(id) ON DELETE RESTRICT,
  endpoint         text NOT NULL,

  -- THE SAME KEY WITH A DIFFERENT BODY IS A CLIENT BUG AND RETURNS 409. Not a
  -- new request, and not a silent overwrite of the first one: those are the
  -- two ways an idempotency layer becomes a duplicate-payment machine.
  request_hash     bytea NOT NULL,

  response_status  integer NULL,
  response_body    jsonb NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
CREATE INDEX idempotency_keys_identity_idx
  ON idempotency_keys (identity_id) WHERE identity_id IS NOT NULL;

COMMIT;
