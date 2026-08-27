-- =============================================================================
-- 0051_payout_destinations
-- =============================================================================
-- E2 READ: MONEY PATH. This file stores no money and no balance. It is on the
-- money path because it is THE INPUT TO A GATE THAT DECIDES WHETHER CASH MAY
-- LEAVE: G-DESTINATION-COOLING routes wallet_withdrawals `requested -> cooling`
-- (STATE_MACHINES section 3.2), and until this table exists that gate is drawn
-- over nothing. OI-06 (payout destinations), open since 2026-08-15. ADR-169,
-- status: proposed, founder approval PENDING.
--
-- Six things need the founder's line-by-line read, and item 1 is the one this
-- file exists for.
--
--   1. `cooling_until` IS `NOT NULL`, AND THE RECOMMENDATION DOES NOT SAY THAT.
--      DELTA_MANIFEST's OI-06 row recommends "a payout_destinations registry
--      keyed on (identity_id, destination_ref) carrying first_seen_at and
--      cooling_until" and says nothing about nullability. Nullability is the
--      whole control. Under `timestamptz NULL`, an INSERT that omits the column
--      writes a destination that is USABLE THE INSTANT IT EXISTS: the gate
--      reads `cooling_until > now()`, NULL compares to nothing, the predicate
--      is not true, and the withdrawal is not cooled. That is a fail-OPEN on
--      exactly the row an attacker who has just added their own destination has
--      caused to be written. Under NOT NULL that row CANNOT EXIST. This is
--      SECURITY section 4 item 9's transferable lesson applied before rather
--      than after: "columns that record a control are not the control."
--
--   2. THE `REVOKE` ON DELETE, AND IT RUNS AGAINST 0026's DEFAULT. 0026 ends
--      with ALTER DEFAULT PRIVILEGES granting merit_app SELECT, INSERT, UPDATE
--      and DELETE on every table a later migration creates. Executed rather
--      than believed, on this tree, at 0050: a bare CREATE TABLE returns all
--      four verbs for merit_app in information_schema.table_privileges. So
--      without the REVOKE below, THE APPLICATION ROLE CAN DELETE A COOLING
--      WINDOW. The row IS the memory of the window; a DELETE followed by a
--      re-INSERT is a fresh `first_seen_at` and a control with an erase button.
--      C-11's window would be defeatable by the one verb nothing needs.
--
--   3. THE REVOKE IS `DELETE` ALONE, AND THAT IS A FOURTH SHAPE RATHER THAN A
--      COPY OF ANY PRECEDENT. 0032, 0039 and 0049 each revoke `UPDATE, DELETE`
--      because each implements an APPEND-ONLY table. 0050 revokes `ALL`
--      because its sentence is about READING. This table is neither: it must be
--      readable by merit_app (both payout legs and the affiliate rail read it),
--      and it must be UPDATABLE, because the cooling window has to be
--      RE-ARMABLE and item 4 is why. What may never happen is that a row
--      VANISHES. So SELECT, INSERT and UPDATE survive and DELETE goes.
--
--   4. UPDATE SURVIVES, AND `PAYOUT-DEST-C1` IS WHAT MAKES THAT SAFE.
--      STATE_MACHINES section 6 glosses the gate as "destination changed INSIDE
--      the 48 hour cooling window", so a window can be extended while another
--      is running, and an extension is an UPDATE. The append-only alternative
--      -- one row per registration event -- was refused on a MEASURED ground
--      and not on taste: with more than one row per (identity, destination) the
--      gate's read becomes `max(cooling_until)`, and ADR-157 REFUSED THE SCALAR
--      AGGREGATE ON THE ACCESSOR. An append-only registry would therefore put
--      P5-h's gate outside the one door P5-a landed, and P5-h is the slice this
--      table exists to unblock. So UPDATE is granted and BOUNDED: the trigger
--      refuses a `cooling_until` that moves BACKWARD, and refuses any change to
--      `identity_id`, `destination_ref` or `first_seen_at`. A grant cannot tell
--      a lengthening from a shortening and a trigger can, which is 0033's own
--      argument for CALENDAR-C1 applied one table over.
--
--   5. THE FIRST DESTINATION AN IDENTITY EVER REGISTERS IS COOLED TOO, AND
--      THAT IS A DELIBERATE READING OF C-11 RATHER THAN AN OVERSIGHT. C-11 and
--      SECURITY section 4 item 1 both say a CHANGE triggers cooling, and a
--      first destination is not a change. But SECURITY's own threat row is
--      "attacker with a stolen session requests a payout to their own
--      destination", beaten by "the 48 hour destination-cooling window (C-11)",
--      and on an identity that has never withdrawn there is nothing to change
--      FROM -- so a first-destination exemption is a hole that opens on every
--      account that has not yet used the rail, which at launch is all of them.
--      The structure that implements the fail-closed reading is item 1's NOT
--      NULL: every row carries a window because no row can be written without
--      one, so "is this a change?" is never a question the handler gets to
--      answer wrongly.
--
--   6. `identity_id` IS THE KEY FOR THE AFFILIATE RAIL TOO, AND THAT IS
--      CHECKED RATHER THAN ASSUMED. C-24 requires affiliate destination changes
--      to carry the same window, and ADR-017's founder amendment is explicit
--      that the only difference is which screen initiates the change.
--      `affiliates.identity_id uuid NOT NULL REFERENCES identities(id)`
--      (0005_affiliate_program.sql) means an affiliate IS an identity, so the
--      recommendation's key spans both rails with no discriminator and no
--      second table. ADR-017's "one rail, one destination table, one detector"
--      is satisfiable only because that column is already there.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE, EACH ABSENCE A DECISION
-- -----------------------------------------------------------------------------
-- No `provider` column, and its cost is named rather than hidden.
-- `destination_ref` is a PROVIDER-SIDE id, so the namespace is a provider's and
-- two providers could in principle issue the same ref string. A provider column
-- is still refused, because THE READING LEG COULD NOT FORM THE KEY:
-- payout_transfers carries `provider text NOT NULL DEFAULT 'rise'` (0010) and
-- wallet_withdrawals carries NO provider column at all (0011), so P5-h would
-- have to supply a hardcoded 'rise' to look a row up -- a literal in the gate,
-- which is precisely the drift E2 exists to catch. ADR-017 rules one rail and
-- one destination table; the day a second rail lands, the destination namespace
-- needs a RULING, and this file records that it will be a SUPERSEDING migration
-- and never an edit to this one.
--
-- No `citext` and no case folding on `destination_ref`. A provider-side opaque
-- id may legitimately be case-sensitive, and folding case would collide two
-- genuinely different destinations onto one row -- which would hand the second
-- one a window it never earned. Byte-exact is the fail-closed direction, and it
-- is only fail-closed if the reader treats an ABSENT ROW as "register it and
-- cool it" rather than as "not cooling". That obligation is P5-h's and is
-- recorded here because this file's shape is what makes it load-bearing.
--
-- No `verified_at` and no `notified_at`. C-11 is "48 hour cooling AND
-- re-verification", and SECURITY section 4 item 1 adds the notification to a
-- channel already on file. Both are real and NEITHER IS STORED HERE, because
-- kyc_verifications (0003) already holds the verification and 0034's contact
-- tables already hold the notification, and a second copy of a fact is a second
-- thing that can disagree with it. What this file refuses to do is what 0029
-- did correctly for the PHONE ceremony and what would be wrong here: 0029's
-- phone_change_requests_applied_is_complete can assert all three legs because
-- the CEREMONY is a row in that table. A destination registry is not a
-- ceremony; the ceremony's row is the withdrawal, which is P5-h's.
--
-- No index beyond the primary key. The gate's read is one (identity_id,
-- destination_ref) lookup, which the primary key serves exactly, and 0029's
-- partial `live_hold_idx` has no analogue here BECAUSE of item 1: that index
-- exists to skip the rows whose hold column is NULL, and this table has none.
-- M07's D-09 destination-concentration detector reads `destination_ref` ACROSS
-- identities, which the composite key's second column does not serve -- and
-- D-09 is specified against payout_transfers, the detector does not exist, and
-- P7 owns detectors. An index whose query nobody has written is a guess at its
-- shape that a sacred file can never take back. Named, and not built.
--
-- No DELETE-refusing trigger, although 0033 has the precedent and states the
-- reason a REVOKE alone is weaker: "a revoke does not bind the table owner and
-- a trigger does." CALENDAR-C2 is affordable because trading_calendar has a
-- ruled correction path that leaves a prior image, so every legitimate need has
-- another door. This table has no ruled procedure for a row written in error,
-- so refusing DELETE from the OWNER as well would make a superseding migration
-- the only remedy -- an operational decision no document in this corpus makes.
-- The REVOKE binds every principal that is actually a threat here (merit_app,
-- which is the API and the worker, and PUBLIC). The owner-level refusal is
-- available, named, and deliberately unspent.
--
-- No `updated_at`. Nothing in this tree maintains one: grep of all fifty merged
-- migrations finds no trigger and no function that sets `updated_at`, so every
-- such column here is a value a handler is trusted to write, which is item 9's
-- warning again. `cooling_until` moving forward IS the record of the re-arm and
-- PAYOUT-DEST-C1 is what protects it, so the fact worth having is the one the
-- constraint already holds.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. payout_destinations -- ADR-169, OI-06 (payout destinations)
-- -----------------------------------------------------------------------------
-- THE DESTINATION NAMESPACE, GIVEN A TABLE FOR THE FIRST TIME. Before this file
-- `destination_ref` existed only as a column on payout_transfers (0010:243) and
-- wallet_withdrawals (0011:132), where it is the destination OF A TRANSFER:
-- nothing recorded that a destination changed or when, and C-11, C-24, SECURITY
-- section 4 item 1, WF-M20-02 and M04's destination-cooling scenario all cited
-- a control whose input did not exist.
--
-- ONE ROW PER (IDENTITY, DESTINATION), AND THE COMPOSITE KEY IS THE CONTROL'S
-- SHAPE RATHER THAN A STYLE. A surrogate `id` with a separate unique index
-- would permit a second row for the same pair to be written the day somebody
-- drops the index, and the gate would then have to fold two rows into one
-- answer. Header item 4: that fold is an aggregate and ADR-157 refused it.
CREATE TABLE payout_destinations (
  -- The person. NOT the account: a destination belongs to a human, and the
  -- external leg carries no account_id for the same reason (wallet_withdrawals,
  -- SD-M5-06: the money is the person's by the time it is here). Header item 6:
  -- this column is also what lets the AFFILIATE rail share the namespace, since
  -- affiliates.identity_id makes an affiliate an identity.
  identity_id     uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,

  -- The provider-side destination id, NEVER bank details. Merit does not hold
  -- them, which is 0010's point and stays true here: this table records THAT a
  -- destination was seen and WHEN, and holds nothing that would make it worth
  -- stealing on its own.
  destination_ref text NOT NULL,

  -- WHEN THIS DESTINATION FIRST APPEARED FOR THIS IDENTITY. The destination's
  -- own clock, and DEFAULT now() rather than NOT NULL alone because a
  -- reconciliation that discovers a destination from an older payout_transfers
  -- row must be able to state the earlier truth. Immutable after insert, by
  -- PAYOUT-DEST-C1: rewriting when a destination first appeared is falsifying
  -- the security record this table exists to be.
  first_seen_at   timestamptz NOT NULL DEFAULT now(),

  -- THE CONTROL. Header item 1. NOT NULL, so a destination with no cooling
  -- window is UNWRITABLE rather than merely discouraged.
  --
  -- THE DURATION IS NOT IN THIS FILE AND THAT IS ADR-037's RULE, applied here
  -- exactly as 0029 applied it to the phone ceremony: 48 hours is a launch
  -- CANDIDATE that lives in config, and a schema that restated it would be a
  -- second copy of a number the config owns. What the database asserts is the
  -- ORDERING, which is the part a config cannot get wrong.
  --
  -- IT IS STORED RATHER THAN COMPUTED FROM first_seen_at PLUS THE CONFIGURED
  -- DURATION, and that is the one place this file deliberately accepts a second
  -- derivable-looking value. A cooling window is A PROMISE MADE AT A MOMENT. If
  -- the configured duration moves from 48 hours to 72, a computed window would
  -- retroactively re-cool every destination ever registered, and a move the
  -- other way would retroactively release them. 0049's GENERATED-column remedy
  -- for exactly this hazard is structurally unavailable, for session 281's
  -- reason on a different table: a generated column is a row-local expression
  -- and the duration is not in the row.
  cooling_until   timestamptz NOT NULL,

  -- The ROW's clock, beside the destination's. Equal to first_seen_at on every
  -- row a live registration writes, and different on exactly the rows a
  -- backfill or a reconciliation writes -- which are the rows an incident is
  -- argued from.
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payout_destinations_pkey PRIMARY KEY (identity_id, destination_ref),

  -- A window that ended before the destination appeared is not a window, and a
  -- zero or negative configured duration would produce one. This is the
  -- ORDERING half of the ADR-037 split above: the duration is config's, the
  -- fact that there IS one is the database's.
  CONSTRAINT payout_destinations_cooling_follows_first_seen
    CHECK (cooling_until > first_seen_at),

  -- An empty ref is a destination that matches no lookup any reader will make,
  -- so the real destination would be registered separately and the empty row
  -- would sit in the registry describing nothing.
  CONSTRAINT payout_destinations_ref_is_present
    CHECK (destination_ref <> '')
);

COMMENT ON TABLE payout_destinations IS
  'ADR-169, OI-06. The payout-destination registry: C-11''s and C-24''s 48 hour '
  'cooling window, given storage for the first time. One row per '
  '(identity_id, destination_ref), spanning the trader and affiliate rails '
  'because affiliates.identity_id makes an affiliate an identity (ADR-017). '
  'Retention: forever (security record). Not deletable by merit_app.';

COMMENT ON COLUMN payout_destinations.cooling_until IS
  'G-DESTINATION-COOLING''s input. NOT NULL so that a destination with no '
  'cooling window cannot be written: a nullable column here fails OPEN on the '
  'row an attacker has just caused to exist. The DURATION is config''s '
  '(ADR-037); this column is the window that was actually applied, stored '
  'rather than recomputed so that a config change cannot rewrite history.';

COMMENT ON COLUMN payout_destinations.first_seen_at IS
  'When this destination first appeared for this identity. The destination''s '
  'own clock, immutable after insert by PAYOUT-DEST-C1, beside created_at, '
  'which is the row''s.';

-- -----------------------------------------------------------------------------
-- 2. PAYOUT-DEST-C1: the window may only grow, and the row's identity is fixed
-- -----------------------------------------------------------------------------
-- Header item 4. UPDATE has to exist, because a window has to be re-armable and
-- an append-only registry would force the gate onto an aggregate ADR-157
-- refused. But the ONLY UPDATE anybody wants to make wrongly is one that
-- SHORTENS the window, and PostgreSQL grants cannot tell a lengthening from a
-- shortening. A trigger can.
--
-- The three immutable columns are here rather than in a separate guard because
-- they fail the same way: repointing `destination_ref` on an existing row moves
-- a cooling window from the destination that earned it onto one that did not,
-- and moving `first_seen_at` forward makes an old destination look new while
-- moving it back makes a new one look established. Each is an UPDATE that
-- launders a destination through a row that already had standing.
--
-- BEFORE UPDATE FOR EACH ROW, not a constraint trigger: there is no second
-- write in the transaction that this one has to wait for, which is the reason
-- 0033 and 0027 defer theirs. This one has everything it needs at the row.
CREATE FUNCTION assert_payout_destination_window_only_grows() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.identity_id IS DISTINCT FROM OLD.identity_id
     OR NEW.destination_ref IS DISTINCT FROM OLD.destination_ref THEN
    RAISE EXCEPTION
      'PAYOUT-DEST-C1: a payout_destinations row may not be repointed. '
      'Changing identity_id or destination_ref moves a cooling window from the '
      'destination that earned it onto one that did not, which is C-11 '
      'defeated by an UPDATE. Register the new destination as its own row, '
      'which starts its own window. See ADR-169.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at THEN
    RAISE EXCEPTION
      'PAYOUT-DEST-C1: payout_destinations.first_seen_at is immutable. It is '
      'when this destination first appeared for this identity, and rewriting '
      'it makes an established destination look new or a new one look '
      'established. See ADR-169.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- THE LINE THIS TRIGGER EXISTS FOR. Forward-only, and equality is permitted
  -- so that an UPDATE touching nothing else is not an error: a re-registration
  -- inside a still-longer window is a no-op on this column, and refusing it
  -- would push the caller into reading the row first to decide whether to
  -- write, which is a race this constraint is meant to remove.
  IF NEW.cooling_until < OLD.cooling_until THEN
    RAISE EXCEPTION
      'PAYOUT-DEST-C1: payout_destinations.cooling_until may not move '
      'backward (% -> %). Shortening a running cooling window is the one '
      'UPDATE this control has to refuse, and a GRANT cannot tell a '
      'lengthening from a shortening. See ADR-169 and C-11.',
      OLD.cooling_until, NEW.cooling_until
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payout_destinations_window_only_grows
  BEFORE UPDATE ON payout_destinations
  FOR EACH ROW EXECUTE FUNCTION assert_payout_destination_window_only_grows();

COMMENT ON CONSTRAINT payout_destinations_cooling_follows_first_seen
  ON payout_destinations IS
  'A cooling window that ended before the destination appeared is not a '
  'window. The ORDERING is the database''s; the DURATION is config''s '
  '(ADR-037), which is 0029''s split applied to the destination ceremony.';

-- -----------------------------------------------------------------------------
-- 3. THE GRANTS (header items 2 and 3)
-- -----------------------------------------------------------------------------
-- 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app SELECT, INSERT,
-- UPDATE and DELETE on anything a later migration creates, so the table above
-- arrives fully deletable by the application role. Three of those four verbs
-- are correct and wanted:
--
--   SELECT  -- G-DESTINATION-COOLING on the external leg (P5-h), the internal
--              leg's destination read, and the affiliate rail under C-24. All
--              three run as merit_app (INFRA section 5: "API and worker at
--              runtime").
--   INSERT  -- registering a destination the first time it is seen, which under
--              header item 1 is the same act as arming its window.
--   UPDATE  -- the re-arm, bounded by PAYOUT-DEST-C1 above.
--
-- DELETE is the one that has to go, and it is the one nothing needs. The row is
-- the memory of the window: a DELETE followed by a re-INSERT is a fresh
-- first_seen_at, a fresh window, and no trace that the destination was ever
-- here before. Under a zero-denial policy the only reason to want it is to make
-- a cooling window go away, and that is the operation C-11 exists to prevent.
--
-- Against PUBLIC as well as merit_app, on 0026's own words and 0032's
-- precedent: a revoke that binds only the application role is a revoke a second
-- connection string walks around.
REVOKE DELETE ON payout_destinations FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT, and the default is
-- already right: 0026's default privileges make a new table invisible to
-- analytics until somebody grants it. A destination-concentration read is a
-- RISK question and the risk engine runs as merit_app, so nothing is lost. This
-- comment is the record that it was checked rather than assumed.
--
-- merit_dispatcher (0034) and merit_live (0050) likewise hold nothing here, and
-- for a stronger reason than a comment: NEITHER HAS ANY DEFAULT PRIVILEGES AT
-- ALL, so a table created by a later migration is invisible to both until
-- somebody grants it deliberately. That is the direction 0050 item 5 chose and
-- this file inherits it by doing nothing.
--
-- merit_migrator owns the table and is not constrained by the REVOKE above,
-- which is 0033's stated reason for preferring a trigger over a grant. See the
-- header's last foreclosure for why that trigger is named and not taken here.

COMMIT;
