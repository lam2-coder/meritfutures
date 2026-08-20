-- =============================================================================
-- 0043_admin_attributed_actions
-- =============================================================================
-- NON-MONEY PATH, and the adjacency is worth a paragraph rather than an E2
-- header. admin_actions is the audit surface every mutating admin endpoint
-- writes to, including the money-path ones (payout release, payout enforce,
-- wallet correct). Nothing here changes what any of them may do: two columns
-- and one CHECK, all of them recording WHOSE ACT the row describes. The money
-- path reads this table and does not depend on it.
--
-- ADR-069 (status: proposed, founder approval PENDING) is the ruling.
-- M06 section 11 is the specification. SD-M6-11.
--
-- -----------------------------------------------------------------------------
-- THE RESERVATION WAS CONTINGENT AND THIS IS WHAT THE DELTA TURNED OUT TO BE
-- -----------------------------------------------------------------------------
-- ALLOCATION reserved 0043 as "the dual-timeline audit that lets an owner-role
-- admin perform a trader action attributed to the admin", contingent because
-- "M06's admin_actions may already carry the shape". IT CARRIES MOST OF IT AND
-- THE DELTA IS THE HALF IT DOES NOT CARRY.
--
--   ATTRIBUTION      ALREADY CARRIED. 0017 gives admin_actions actor, action,
--                    subject_kind, subject_id, reason NOT NULL, before, after,
--                    evidence_refs and ip. An admin-attributed trader action
--                    needs no new column to say WHO did it or WHY.
--
--   DUAL TIMELINE    ALREADY CARRIED, on the events side. 0017's events table
--                    has actor_kind IN ('system','trader','admin','vendor') plus
--                    actor_id, identity_id and account_id, and
--                    GET /accounts/:accountId/timeline is a projection of it.
--                    An operator's act reaches the trader's timeline as an event
--                    whose actor_kind is 'admin'.
--
--   INITIATIVE       NOT CARRIED ANYWHERE, and this is the delta. Nothing in
--                    the schema distinguishes AN ADMIN ACTING ON A TRADER from
--                    AN ADMIN ACTING FOR ONE. Both write actor=<operator> and a
--                    free-text reason.
--
-- WHY THAT DISTINCTION IS THE WHOLE POINT OF ADR-069 RATHER THAN A NICETY.
-- The fold's argument is that an impersonated action destroys provenance because
-- the actor recorded is the trader. An admin-attributed action preserves it. But
-- "preserves provenance" is only true if the row says WHICH claim it is making,
-- and there are two:
--
--   "Merit did this to the trader"      enforcement, operational
--   "the trader asked and Merit did it" trader_request
--
-- In a dispute or a chargeback representment -- the exact place the fold says an
-- evidence pack is worth most -- those are different defences and only the
-- second one answers "why did you touch my account". A reviewer reading this
-- table two years from now cannot reconstruct which was meant from a free-text
-- reason, and free text is not a control. That is this corpus's own standard,
-- stated on the column one line up: reason is NOT NULL "and the NOT NULL is the
-- whole control".
--
-- THE VOCABULARY IS NOT INVENTED HERE. API_CONTRACT's CloseRequest already
-- carries kind: "enforcement" | "trader_request" | "operational", on
-- POST /admin/accounts/:accountId/close, which is the ONE trader-requested act
-- the corpus already models admin-side. The parity audit calls that row "the
-- shape the other 18 gaps would take if they were closed". This file takes it
-- literally: the same three values, on the row every admin action already
-- writes, so eighteen new routes inherit a discriminator instead of eighteen
-- request bodies each inventing one.
--
-- AND CloseRequest's kind HAS NO COLUMN TODAY. It is a field on a request type
-- and lands in the after jsonb or nowhere; account_status_history has from/to
-- status, from/to phase and a nullable reason, and no kind. So the corpus's one
-- existence proof of an admin-attributed trader-requested action cannot be
-- QUERIED as one. After this file it can.
--
-- -----------------------------------------------------------------------------
-- WHY IT LANDS NOW, BEFORE ANY OF THE EIGHTEEN ROUTES EXISTS
-- -----------------------------------------------------------------------------
-- admin_actions is append-only (0026 revokes UPDATE and DELETE from merit_app
-- and from PUBLIC) and its retention is forever. A discriminator added AFTER
-- rows exist leaves every historical row NULL, and NULL is then ambiguous
-- between "Merit's own act" and "written before the column existed". The column
-- is only unambiguous if it is never null, and it is only never null if it
-- arrives while the table is empty. This is the last cheap moment.
--
-- WHAT IS DELIBERATELY NOT HERE. No column records HOW the requester was
-- verified. That is a support-process question ADR-069 leaves open rather than
-- guessing at, and reason plus evidence_refs carry it as prose until somebody
-- rules a vocabulary. A CHECK naming values nobody has agreed on would be a
-- control in an audit's eyes and a coin flip in practice, which Appendix D
-- warns is worse than nothing.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. On whose initiative
-- -----------------------------------------------------------------------------
-- NOT NULL AND NO DEFAULT, on reason's precedent. A default would let a route
-- added later omit the answer and receive a plausible one, which is the failure
-- mode the NOT NULL on reason exists to prevent one column over. The author of
-- the nineteenth admin route has to answer the question.
--
-- Safe as NOT NULL without a default because the table is empty: this corpus
-- has no deployed database, the migrations apply forward-only from empty, and
-- 0017 runs in the same sequence.
--
-- THE VALUE SET IS API_CONTRACT's CloseRequest.kind, unchanged and in its order.
-- A CHECK rather than an enum type, because an enum value cannot be removed and
-- this vocabulary is one ADR-069's founder read may still narrow.
ALTER TABLE admin_actions
  ADD COLUMN initiative text NOT NULL                              -- SD-M6-11
    CHECK (initiative IN ('enforcement', 'trader_request', 'operational'));

COMMENT ON COLUMN admin_actions.initiative IS
  'SD-M6-11, ADR-069, M06 section 11. ON WHOSE INITIATIVE the action was '
  'taken, which is NOT the same question as who performed it (actor) or why '
  '(reason). Values are API_CONTRACT CloseRequest.kind''s, unchanged: '
  'enforcement is Merit acting against the trader and pairs with an '
  'evidence_refs entry; trader_request is the trader''s own act performed by an '
  'operator and REQUIRES on_behalf_of_identity_id; operational is Merit''s own '
  'housekeeping. The distinction is the one an evidence pack turns on in a '
  'dispute or a chargeback representment, and it cannot be reconstructed from a '
  'free-text reason.';

-- -----------------------------------------------------------------------------
-- 2. Whose act it was
-- -----------------------------------------------------------------------------
-- subject_kind and subject_id name the OBJECT the action touched: a session, a
-- phone-change request, a payout request, a plan version. They do not name the
-- identity whose act it was, and for most of the eighteen parity routes the two
-- are different rows. Resolving one from the other is a join per subject_kind,
-- which makes the trader half of the dual-timeline audit a query convention
-- instead of a schema fact.
--
-- ON DELETE RESTRICT on the append-only precedent: an identity with an operator
-- action recorded against it is an identity that cannot be deleted out from
-- under its own audit trail.
ALTER TABLE admin_actions
  ADD COLUMN on_behalf_of_identity_id uuid NULL                    -- SD-M6-11
    REFERENCES identities(id) ON DELETE RESTRICT;

COMMENT ON COLUMN admin_actions.on_behalf_of_identity_id IS
  'SD-M6-11, ADR-069, M06 section 11. The identity whose OWN ACT this was, set '
  'exactly when initiative = ''trader_request''. Not the subject: subject_kind '
  'and subject_id name the object touched, which for most parity routes is a '
  'session, a request or an account rather than an identity. This column is '
  'what makes the trader half of the dual-timeline audit one index scan instead '
  'of a join per subject_kind.';

-- -----------------------------------------------------------------------------
-- 3. The biconditional, which is where the control actually lives
-- -----------------------------------------------------------------------------
-- BOTH DIRECTIONS, and the second one is the one that matters. Forward: a
-- trader_request with no identity is a claim that a trader asked with no record
-- of which trader, which is the claim being unable to support itself. Backward:
-- an enforcement or operational row carrying an on-behalf-of identity is an act
-- against a trader dressed as an act for one, and that is the exact
-- misattribution ADR-069 exists to prevent, arriving from the admin side
-- instead of the impersonation side.
ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_on_behalf_matches_initiative
    CHECK ((on_behalf_of_identity_id IS NOT NULL) = (initiative = 'trader_request'));

-- -----------------------------------------------------------------------------
-- 4. The trader-timeline read
-- -----------------------------------------------------------------------------
-- Partial, on 0041's contact_channels_complained_idx precedent and 0019's
-- before it. This index answers "every operator action taken on this trader's
-- behalf, newest first", which is the dual-timeline query. Indexing the nulls
-- would index every enforcement and configuration action Merit has ever taken
-- to answer a question about the ones it did not.
CREATE INDEX admin_actions_on_behalf_idx
  ON admin_actions (on_behalf_of_identity_id, created_at DESC)
  WHERE on_behalf_of_identity_id IS NOT NULL;

COMMIT;
