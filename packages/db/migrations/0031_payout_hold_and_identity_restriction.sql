-- =============================================================================
-- 0031_payout_hold_and_identity_restriction
-- =============================================================================
-- E2 READ: MONEY PATH. This file makes ADR-040's payout hold and ADR-041's
-- identity restriction bind. SIX things need the founder's line-by-line read,
-- and the second is the one ADR-028 called the single most dangerous item in
-- the set:
--
--   1. THE HOLD TRIO AND ITS COMPLETENESS CHECK. held_at, hold_flag_id,
--      hold_expires_at. A hold with a cited flag and NO CLOCK is an indefinite
--      hold, which is a denial with extra steps, which is what a zero-denial
--      policy must not permit itself (AS-M5-04). The CHECK is what makes the
--      clock unavoidable rather than customary. ITS SHAPE DEPARTS FROM THE
--      FREEZE TRIO'S ON PURPOSE and the reason is written at the constraint.
--   2. BOTH SD-09 PREDICATES, DROPPED AND RE-CREATED UNDER THE SAME NAMES,
--      ADJACENT. A held request is OUTSTANDING. If the predicates had stayed at
--      ('approved','frozen'), a trader could hold one request and file a second
--      against the same account, and G-NO-IN-FLIGHT would be enforced by
--      nothing. THIS IS THE C-02 DEFECT VERBATIM (ADR-028): a predicate that
--      stops matching is a gate that still exists, is still valid, enforces
--      NOTHING, and fails no test.
--   3. THE HOLD-EXPIRY INDEX. The auto-release is now the load-bearing control
--      -- it is the only thing standing between a hold and an indefinite one --
--      so its read path is an index rather than a scan, in the freeze-expiry
--      index's shape, on the same hourly sweep (CRON_INVENTORY).
--   4. THE EXTERNAL LEG'S SETTLEMENT GUARD. 0011 gave wallet_withdrawals a
--      freeze trio and wallet_withdrawal_status has NO frozen value, so today a
--      halted withdrawal SETTLES. The halt is representable and unenforced.
--      This CHECK is the enforcement. It is a CHECK rather than a status value,
--      and the asymmetry with item 1 is deliberate: see section 4 below.
--   5. THE RESTRICTION EPISODE TABLE. identities carries status and
--      status_reason and nothing else, while accounts has had
--      account_status_history since 0007. A repeat restriction would overwrite
--      its predecessor and A RESTORE WOULD BE UNPROVABLE AT EXACTLY THE MOMENT
--      IT IS CONTESTED.
--   6. THE REPLACEMENT COMMENT ON payout_requests. 0010:225 says "no review
--      state by design". That is now false and 0010 is MERGED. A table comment
--      is replaceable metadata, so it is re-stated here rather than edited
--      there.
--
-- Deltas folded: U-07 (hold, with the enum value in 0030), U-08 (external leg
--                guard), U-09 (restriction episodes); SD-09 AMENDED
-- Rulings:       ADR-040 (items 1 to 4 and 6), ADR-041 (item 5)
--
-- WHAT THIS FILE DOES NOT DO, stated so the absences are read as decisions:
--   * It does not relax a single NOT NULL or a single existing CHECK on
--     payout_requests. A held request stores the FULL evaluated decision
--     (ADR-040): the eligibility snapshot, approved_cents, the split, the
--     ordinal and the pinned plan version are computed at request time and
--     frozen, and only the ledger posting is deferred. Release is mechanical
--     and re-evaluates nothing, which preserves INV-M5-02. A superseding
--     migration that relaxes NOT NULL on the money table has a far wider blast
--     radius than one that only adds.
--   * It does not add 'suspended' to identity_status. ADR-041: the reversible
--     restricted state already exists (0001:27, 0002:42); what was missing is
--     its BINDING SURFACE, and G-ELIGIBLE not naming identities.status is the
--     whole finding. Two expressions of one concept is this repository's most
--     repeated defect.
--   * It grants nothing. 0026's ALTER DEFAULT PRIVILEGES already covers a table
--     created later by the migrator role, and identity_restriction_episodes is
--     NOT append-only: the restore updates the row it opened.
--
-- Two disciplines inherited from defects this corpus already paid for. Every
-- CHECK over an array uses cardinality() and never array_length, because a
-- CHECK evaluating to NULL passes (ADR-035); this file writes no array CHECK at
-- all, which is the same rule reaching zero. And no trigger is added, so
-- CI-06j has nothing new to resolve.
--
-- Neither this file nor 0030 edits anything. 0001, 0002, 0008, 0010 and 0011
-- are merged and stay exactly as they are. Migrations are sacred: once merged,
-- never edited, only superseded.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The hold, on payout_requests                                       -- U-07
-- -----------------------------------------------------------------------------
-- ADR-040. The trio mirrors SD-M5-01's freeze trio column for column, because
-- the two states are asked the same three questions by the corpus (is there a
-- cited flag, does it expire, does it block settlement) and answer them
-- identically. They diverge on the only question that decides behaviour, which
-- is the ledger: a frozen request has LT-01 posted and the money is already the
-- trader's; a held request has NOTHING POSTED and nothing is owed yet.
ALTER TABLE payout_requests
  ADD COLUMN held_at         timestamptz NULL,                        -- U-07
  ADD COLUMN hold_flag_id    uuid NULL REFERENCES risk_flags(id)
                               ON DELETE RESTRICT,                    -- U-07
  ADD COLUMN hold_expires_at timestamptz NULL;                        -- U-07

COMMENT ON COLUMN payout_requests.hold_expires_at IS
  'ADR-040. The 48 hour auto-release SLA. This is the trader-visible date and '
  'it is the control that binds on MERIT rather than on the trader.';

-- THE COMPLETENESS CHECK, AND WHY ITS SHAPE IS NOT THE FREEZE TRIO'S.
--
-- payout_requests_freeze_is_complete (0010:141) couples the trio to the status
-- in BOTH directions: status <> 'frozen' requires all three NULL. Under
-- ADR-040's corrected machine a frozen request releases to 'settled', so
-- satisfying that constraint on release means CLEARING the freeze columns, and
-- the row then carries no evidence it was ever frozen.
--
-- That is inherited on wallet_withdrawals and on payout_requests alike, it is
-- merged, and it is not edited. It is not repeated here, on a new column set,
-- where the choice is still open:
--
--   * A hold that is OPEN is complete. All three or the status may not be
--     'held_pending_review'.
--   * A hold that has been RELEASED keeps its trio. The status has moved to
--     'approved' or 'settled' and the columns stay, so "Merit held this payout
--     and paid it at the SLA" is provable FROM THE ROW.
--
-- The second half is the same argument ADR-041 makes for the restriction being
-- an episode row rather than a column: a record that is erased by the act of
-- ending is unprovable at exactly the moment it is contested. A trader whose
-- money was held for 48 hours and then paid is the person most likely to ask.
--
-- The one combination that must be unrepresentable is a hold with a flag and no
-- clock, or a clock and no flag. Both branches below refuse it.
ALTER TABLE payout_requests
  ADD CONSTRAINT payout_requests_hold_is_complete CHECK (
    (held_at IS NULL AND hold_flag_id IS NULL AND hold_expires_at IS NULL
       AND status <> 'held_pending_review')
    OR
    (held_at IS NOT NULL AND hold_flag_id IS NOT NULL
       AND hold_expires_at IS NOT NULL)
  );

-- The clock runs forward. A hold whose expiry precedes its own start is a hold
-- that is already past due the instant it is written, which the nightly alarm
-- would report as a stalled sweep rather than as the bad write it is.
ALTER TABLE payout_requests
  ADD CONSTRAINT payout_requests_hold_expiry_after_held CHECK (
    held_at IS NULL OR hold_expires_at IS NULL OR hold_expires_at > held_at
  );

-- Every other object on payout_requests was READ AND DISPOSITIONED rather than
-- assumed, and the three that are unchanged are unchanged for a stated reason:
--
--   payout_requests_account_ordinal_uq  (WHERE status <> 'failed')
--     UNCHANGED, AND THAT IS CORRECT. A held request holds its ordinal while
--     held; enforcement sends it to 'failed', which releases the rung (EC-037,
--     SD-05). A held request that reaches auto-release pays and consumes the
--     rung it was always going to consume.
--   payout_requests_freeze_is_complete
--     UNCHANGED. A held row leaves the three FREEZE columns NULL and satisfies
--     that constraint's first branch, because 'held_pending_review' <> 'frozen'.
--   payout_requests_reflection_needs_settlement
--     UNCHANGED. A held row is balance_reflection_status = 'pending', which the
--     constraint permits.
--
-- payout_requests_account_idempotency_uq, identity_approved_idx,
-- freeze_expiry_idx and reflection_pending_idx are likewise unaffected.

-- -----------------------------------------------------------------------------
-- 2. Both SD-09 predicates, widened                          -- SD-09, AMENDED
-- -----------------------------------------------------------------------------
-- THE DANGEROUS HALF. 0010:197 says it in as many words: the predicate "must
-- stay in lockstep with the status index below". There are TWO objects and one
-- predicate, and 0010 wrote them adjacent precisely so that a future change to
-- one is visibly a change to one of two. This is that change, and they are
-- again adjacent.
--
-- A held request is OUTSTANDING: it is a live claim against the account that
-- has not resolved. Under ADR-019 the internal leg settles instantly to the
-- wallet, so the outstanding states are now exactly 'approved', 'frozen' and
-- 'held_pending_review'.
--
-- Dropped and re-created rather than altered, because PostgreSQL has no ALTER
-- INDEX for a predicate. THE NAMES ARE PRESERVED so every document, runbook and
-- error-handling path that cites one still resolves.
--
-- Re-creating the unique index validates it against existing rows: if any
-- account already holds two outstanding requests this migration FAILS LOUDLY
-- rather than installing a guarantee a row already violates.
DROP INDEX payout_requests_no_in_flight_uq;
CREATE UNIQUE INDEX payout_requests_no_in_flight_uq
  ON payout_requests (account_id)
  WHERE status IN ('approved', 'frozen', 'held_pending_review');

DROP INDEX payout_requests_outstanding_idx;
CREATE INDEX payout_requests_outstanding_idx
  ON payout_requests (status)
  WHERE status IN ('approved', 'frozen', 'held_pending_review');

-- -----------------------------------------------------------------------------
-- 3. The hold-expiry sweep's read path                                  -- U-07
-- -----------------------------------------------------------------------------
-- In payout_requests_freeze_expiry_idx's shape (0010:216), on the SAME hourly
-- job, under the SAME S1 dead-man switch, whose stated reason is that "a
-- stalled sweep converts a bounded hold into an unbounded one, which is a
-- denial nobody authorized". One job, one row, one switch.
--
-- The alarm that matters fires on THIS QUERY rather than on the job's own
-- report, because a job that reports success is not evidence that the work
-- happened (M02 FM-M2-11). ADR-040 makes it the fourth unsuppressible alarm.
CREATE INDEX payout_requests_hold_expiry_idx
  ON payout_requests (hold_expires_at) WHERE status = 'held_pending_review';

-- -----------------------------------------------------------------------------
-- 4. The external leg: enforcement, not a state                         -- U-08
-- -----------------------------------------------------------------------------
-- ADR-040. THE ASYMMETRY IS DELIBERATE AND IS STATED SO IT DOES NOT READ AS AN
-- OVERSIGHT.
--
--   On payout_requests the hold REPLACES approval. It is mutually exclusive
--   with every other status, so it is a status.
--
--   On wallet_withdrawals the halt is ORTHOGONAL to the rail state: a halted
--   withdrawal is still 'approved' or 'transferring' as far as the rail is
--   concerned. Collapsing an orthogonal hold into the rail's status column is
--   precisely SD-M5-06's named mistake, where the engine's gates and the rail's
--   gates sharing one column is how the first person to add a state breaks the
--   other one.
--
-- So the external leg gets ENFORCEMENT rather than a state. 0011 already gave
-- it frozen_at, freeze_flag_id, freeze_expires_at and
-- wallet_withdrawals_freeze_expiry_idx; what it never had is anything that
-- refuses settlement. Release resumes the rail. IT DOES NOT RE-PAY, because the
-- money is already the trader's.
--
-- A live freeze is frozen_at IS NOT NULL. wallet_withdrawals has no
-- freeze_released_at and 0011's wallet_withdrawals_freeze_is_complete is
-- all-three-or-none, so releasing a withdrawal freeze means clearing the trio.
-- THAT IS THE OPPOSITE OF THE RETENTION CHOICE MADE IN SECTION 1 ABOVE, and the
-- difference is not a preference: on payout_requests the trio is new and the
-- shape was still open, and here it is merged and is not edited. The record of
-- a released withdrawal halt lives in events and admin_actions. Flagged rather
-- than smoothed over.
ALTER TABLE wallet_withdrawals
  ADD CONSTRAINT wallet_withdrawals_frozen_cannot_settle CHECK (
    status <> 'settled' OR frozen_at IS NULL
  );                                                                  -- U-08

-- wallet_withdrawals_open_idx IS NOT RE-CREATED, and this is a departure from
-- FOLD-02 section 4.5 and ADR-040, which both say "the open index re-created so
-- a halted row stays visible".
--
-- IT WAS READ RATHER THAN RECALLED. Its predicate is
-- WHERE status IN ('requested','cooling','approved','transferring') (0011:205).
-- The halt is orthogonal to the rail status by the ruling three paragraphs up,
-- so a halted withdrawal is still 'approved' or 'transferring' and ALREADY
-- MATCHES. The plan's own finding 3 says the same thing from the other side:
-- "a halted withdrawal still matches wallet_withdrawals_open_idx and nothing
-- refuses settlement", so what was missing was the refusal, which is the CHECK
-- above.
--
-- Dropping and re-creating an index to a byte-identical definition on a money
-- table is a null change that reads in a diff as a considered one, and it would
-- have been the SECOND object in this file to carry the words "re-created under
-- the same name" while meaning something different by them. The sweep's read
-- path is likewise already indexed: wallet_withdrawals_freeze_expiry_idx
-- (0011:209) is (freeze_expires_at) WHERE freeze_expires_at IS NOT NULL, and by
-- wallet_withdrawals_freeze_is_complete that is exactly the halted set.
--
-- Recorded in DELTA_MANIFEST section 14 as a departure, not buried here. If the
-- E2 read wants the re-creation anyway, it belongs in a superseding migration
-- rather than in an edit to this one.

-- -----------------------------------------------------------------------------
-- 5. identity_restriction_episodes                                      -- U-09
-- -----------------------------------------------------------------------------
-- ADR-041. THE EPISODE IS A ROW, NOT A COLUMN.
--
-- identities carries status and status_reason and nothing else (0002:42). A
-- second restriction would overwrite the first, and the restore that ended the
-- first would be unprovable at exactly the moment it is contested. accounts has
-- had account_status_history since 0007 for the same reason at the account
-- level.
--
-- The state itself is NOT created here. identity_status has carried a
-- reversible 'restricted' since 0001:27, the explained-reason CHECK since
-- 0002:73, the machine since STATE_MACHINES section 9, and the event since
-- EVENTS. This table is the EPISODE: who restricted, citing what, when, under
-- which ToS clause, and what documented act ended it.
--
-- Distinct from its two neighbours in one sentence: closure for cause is
-- terminal and per account; a freeze is per payment and expires; A RESTRICTION
-- IS PER HUMAN, HALTS EVERYTHING, AND IS REVERSED BY A DOCUMENTED RESTORE.
CREATE TABLE identity_restriction_episodes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id       uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- THE CITED FLAG. NOT NULL, and that is the point: a restriction that cites
  -- no flag is an accusation with no evidence behind it, which is the shape
  -- 0008's whole module exists to refuse. The freeze columns elsewhere are
  -- nullable only because the row exists before the freeze does; an episode row
  -- exists only because a restriction happened.
  flag_id           uuid NOT NULL REFERENCES risk_flags(id) ON DELETE RESTRICT,

  -- The clause the trader is shown, and the reason an operator typed. GS-117:
  -- the typed reason gates the confirm control, and this column is where it
  -- lands.
  tos_clause        text NOT NULL,
  reason            text NOT NULL,

  opened_by         text NOT NULL,   -- admin, never a detector: ADR-041 puts
                                     -- the entry point on M06's flags queue and
                                     -- identity drill-down, both v1 surfaces
  opened_at         timestamptz NOT NULL DEFAULT now(),

  -- ADR-040's 48 hour SLA, WHERE A PAYOUT IS PENDING. NULL when none is.
  --
  -- IT BINDS THE RESTRICTION RATHER THAN THE PAYOUT, and that is the property
  -- that stops Ruling B from becoming a route around Ruling A: a restriction
  -- cannot hold a held payout past its own 48 hours.
  --
  -- THAT PROPERTY IS NOT ENFORCED BY THIS COLUMN AND SAYING SO IS THE HONEST
  -- FORM. It compares this row against payout_requests.hold_expires_at on
  -- another table, which no CHECK can reach. It is asserted by the golden
  -- scenario FOLD-02 section 7 names and by ADR-040's hold-expiry alarm, which
  -- fires on the payout regardless of why nobody released it. A column that
  -- looks like it enforces a cross-table promise is worse than one documented
  -- not to.
  sla_due_at        timestamptz NULL,

  -- THE RESTORE BRANCH. Fail-closed on the way back in (ADR-041): set_risk at
  -- the account's current floor CONFIRMED FIRST, then entitlement, then
  -- permissions, because re-enabling an entitlement against an unconfirmed
  -- setpoint is an unenforced funded account and INV-M2-13 forbids it. 0007's
  -- provisioning_queue_set_risk_never_inferred is what makes that confirmation
  -- real, and it is the machine-side proof; restore_evidence is the human-side
  -- one, so it is text rather than jsonb.
  --
  -- PROVISIONAL under ADR-005: suspension is always available, RESTORATION IS
  -- CONTINGENT ON V-M2-15. With neither an acknowledgement artifact nor a
  -- readable current risk setting, a restored account cannot be confirmed, and
  -- an unconfirmed account does not trade. This table is written so a restore
  -- is PROVABLE when it happens; it does not make one possible.
  restored_at       timestamptz NULL,
  restored_by       text NULL,
  restore_evidence  text NULL,

  -- The pack exported by the M06 investigating-to-enforced path that opened the
  -- episode. NULLABLE, for two reasons that are stated rather than assumed:
  -- evidence_packs.account_id is NOT NULL and account-scoped (0008:238) while a
  -- restriction is PER HUMAN and may precede any account, which is OI-06; and
  -- the workflow requirement that a pack exist belongs to M06, which owns the
  -- surface, rather than to a CHECK that would make an identity-level
  -- enforcement unwritable for an identity with no account.
  evidence_pack_id  uuid NULL REFERENCES evidence_packs(id) ON DELETE RESTRICT,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- In identities_freeze_is_explained's shape (0002:67). All three or none: a
  -- restore with no actor is a reversal nobody owns, and an actor with no
  -- restored_at is a restore that never happened. The open branch needs no
  -- CHECK because flag_id, tos_clause, reason and opened_by are NOT NULL.
  CONSTRAINT identity_restriction_episodes_restore_is_complete CHECK (
    (restored_at IS NULL AND restored_by IS NULL AND restore_evidence IS NULL)
    OR
    (restored_at IS NOT NULL AND restored_by IS NOT NULL
       AND restore_evidence IS NOT NULL)
  ),

  -- Both clocks run forward. An SLA already past due when the episode opens, or
  -- a restore that precedes the restriction it reverses, are writes that make
  -- the alarm and the audit trail disagree with each other.
  CONSTRAINT identity_restriction_episodes_sla_after_open CHECK (
    sla_due_at IS NULL OR sla_due_at > opened_at
  ),
  CONSTRAINT identity_restriction_episodes_restore_after_open CHECK (
    restored_at IS NULL OR restored_at >= opened_at
  )
);

-- AT MOST ONE OPEN EPISODE PER IDENTITY, in payout_requests_no_in_flight_uq's
-- shape. Two open episodes on one human means two restore actions, each able to
-- lift a restriction the other still holds, and whichever runs second silently
-- un-restricts a trader nobody cleared. The database refuses it because the
-- console is not the only writer, which is the same argument SD-09 makes one
-- table over.
CREATE UNIQUE INDEX identity_restriction_episodes_open_uq
  ON identity_restriction_episodes (identity_id) WHERE restored_at IS NULL;

-- The drill-down's read path: this human's restrictions, most recent first.
CREATE INDEX identity_restriction_episodes_identity_idx
  ON identity_restriction_episodes (identity_id, opened_at DESC);

-- The SLA sweep: open episodes with a clock, soonest first.
CREATE INDEX identity_restriction_episodes_sla_due_idx
  ON identity_restriction_episodes (sla_due_at)
  WHERE restored_at IS NULL AND sla_due_at IS NOT NULL;

COMMENT ON TABLE identity_restriction_episodes IS
  'ADR-041. One row per identity-level restriction. A restriction is per human, '
  'halts every linked account at once, preserves account state intact, and is '
  'reversed by a documented restore. Retention: forever (enforcement record).';

-- -----------------------------------------------------------------------------
-- 6. The replacement table comment on payout_requests
-- -----------------------------------------------------------------------------
-- 0010:224 reads "status has no denied and no review state by design
-- (zero-denial policy)". The second half of that is now false. 0010 IS MERGED
-- AND IS NOT EDITED (constitution E2), and a COMMENT ON TABLE is replaceable
-- metadata rather than structure, so it is re-stated here.
--
-- The other nine sites ADR-040 enumerates are amended in their own documents.
-- TWO OF THE TEN CAN NEVER BE: 0001:73 and 0010:77 are `--` comments inside
-- merged migrations and stay as written forever. The ADR says so rather than
-- implying the sweep was complete, and 0030's header is where a reader arriving
-- from either of them lands.
COMMENT ON TABLE payout_requests IS
  'Retention: forever. ZERO DENIAL, AS AMENDED BY ADR-040. There is still no '
  'denied status and adding one still requires an ADR against the policy. The '
  'review state held_pending_review EXISTS AND IT EXPIRES: every hold either '
  'pays inside 48 hours or produces a documented enforcement action carrying a '
  'cited flag, a ToS clause and an evidence pack. This replaces the 0010 '
  'comment reading "no review state by design"; 0010 is merged and is not '
  'edited.';

COMMIT;
