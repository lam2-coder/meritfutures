-- =============================================================================
-- 0050_live_cache_and_role
-- =============================================================================
-- E2 READ: MONEY PATH. This file does not store money that anybody is owed. It
-- is on the money path because it decides WHICH ROLE CAN REACH WHICH TABLE, and
-- four approved documents describe a permission over an object that has not
-- existed until now. ADR-164, status: proposed, founder approval PENDING.
--
-- Five things need the founder's line-by-line read:
--
--   1. THE FIFTH ROLE. merit_live is the principal the live tier runs as. 0026
--      created three and 0034 created a fourth for the sending path, on the
--      sentence this file is the second use of: "you cannot withhold DELETE
--      from the send path until the send path is a principal the database can
--      name." INV-M2-14 needs the same thing of the streaming path.
--
--   2. THE REVOKE ON LINE ~205 IS THE WHOLE CLAIM AND IT RUNS AGAINST THE
--      DEFAULT. 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app
--      SELECT, INSERT, UPDATE, DELETE on every table a later migration creates.
--      So live_account_state is fully readable and writable by the application
--      role the instant it exists, and FM-M12-08 ("the stats worker holds no
--      read grant on the live cache") and FM-M13-07 would be false on the day
--      the table was created. The REVOKE takes all four verbs back, from
--      merit_app AND from PUBLIC.
--
--   3. THE REVOKE IS `ALL` AND NOT `UPDATE, DELETE`, WHICH IS WHERE THIS FILE
--      DEPARTS FROM 0032, 0039 AND 0049. Those three revoke the two verbs that
--      would make an append-only table rewritable. This one revokes SELECT too,
--      because the sentence being implemented is about READING: the stats
--      worker and the engine run as merit_app (INFRA section 5: "API and worker
--      at runtime"), and a SELECT grant is the whole of what FM-M12-08 forbids.
--
--   4. THE COST OF ITEM 3 IS REAL AND IT IS NAMED RATHER THAN HIDDEN.
--      packages/db/src/client.ts opens ONE pool from ONE DATABASE_URL, read
--      "here and nowhere else". So one process is one role, and while apps/api
--      and apps/worker both hold merit_app, no grant in PostgreSQL can separate
--      "the API may read the cache" from "the stats worker may not". THE LIVE
--      READ PATH MUST THEREFORE BE A PROCESS THAT CONNECTS AS merit_live.
--      Which process that is -- a deployable of its own, or apps/api holding a
--      second connection -- is P6-b's address ruling and P6-g's mechanism, and
--      this file takes neither. What it forecloses is the cheap escape:
--      granting merit_app SELECT here, which makes FM-M12-08 false silently.
--
--   5. merit_live GETS NO DEFAULT PRIVILEGES, WHICH IS 0034's DEFAULT AND NOT
--      0026's. There is no ALTER DEFAULT PRIVILEGES ... TO merit_live anywhere
--      in this file. A table created by a later migration is INVISIBLE to the
--      live tier until somebody grants it deliberately, which is the direction
--      INV-M2-14 needs and the opposite of the one that made this file
--      necessary.
--
-- -----------------------------------------------------------------------------
-- WHY A TABLE AT ALL, WHICH IS P6 SECTION 10 ITEM 1 AND WAS A FOUNDER ANSWER
-- -----------------------------------------------------------------------------
-- The plan enumerated three readings and took none. ADR-164 argues the first
-- and states what the other two cost; the two sentences worth carrying here:
--
--   A PROCESS-LOCAL STORE IN THE SOCKET SERVER makes GS-132's poisoning step
--   untestable from outside the process, and GS-132 IS THE PHASE'S STATED
--   DONE-CONDITION ("GS-132 byte-identical with the cache poisoned"). It is
--   also two caches rather than one, because INFRA section 2.1 deploys api and
--   api-admin as two services.
--
--   A SECOND STATEFUL SERVICE would make the separation a CONVENTION again.
--   The engine's inability to read the cache would rest on the worker not
--   importing a client, and INV-M2-14, C-26, FM-M12-08 and FM-M13-07 all say
--   permission. OVERVIEW section 3's rejection of Redis for the queue does NOT
--   decide this and ADR-164 does not pretend it does: a discardable cache needs
--   no backup and no restore, and INV-M2-14 makes the ingest write nothing but
--   the cache, so neither limb of that sentence transfers.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
-- -----------------------------------------------------------------------------
-- No `kind` column. LiveAccountTick.kind is SimWaypoint['kind'], simulator
-- vocabulary, and V-M2-16 is unanswered. stream.ts states that the tick shape
-- is one of the two things the vendor mechanism decides. A merged CHECK over an
-- unconfirmed vendor vocabulary is a constraint that can never be corrected
-- (E2), and nothing in API_CONTRACT reads it.
--
-- No `at_utc` column. The tick carries the feed's own clock. Nothing in the
-- landed contract reads it, and storing it beside as_of_instant invites
-- staleness to be computed from the wrong one -- which is exactly what ADR-152
-- clause 1 and LiveFreshness.stale ("the SERVER's own answer against its own
-- threshold") forbid.
--
-- No `projected_floor_distance_cents` column. The floor is a rule threshold the
-- engine owns. Storing it here puts a rule input in the indicative tier;
-- computing it here needs a grant on rule_states that INV-M2-14 forbids by
-- name. API_CONTRACT section 6.1's field is composed at the read layer.
--
-- No monotonicity trigger. An out-of-order tick that rewound the row is a
-- display defect on a labeled indicative number, never a money defect, and the
-- guard belongs in the ingest's ON CONFLICT ... DO UPDATE ... WHERE
-- excluded.sequence > live_account_state.sequence predicate. It is P6-f's and
-- is recorded as owed rather than added to a migration that cannot be edited.
--
-- No index beyond the primary key. The table holds ONE ROW PER ACCOUNT, so the
-- operator's live Open Liability sums a few thousand rows and a secondary index
-- would be cost with no reader. Stated rather than omitted.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The fifth role
-- -----------------------------------------------------------------------------
-- NOLOGIN and IF NOT EXISTS-style, on 0026's and 0034's pattern exactly: these
-- are roles a deployment GRANTs to a login user, not login users, and role
-- names are cluster-wide so a shared cluster may already carry them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merit_live') THEN
    CREATE ROLE merit_live NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO merit_live;

-- No DDL, for merit_app's reason in 0026 and merit_dispatcher's in 0034: a role
-- that can alter its own schema can drop the constraints below and then do what
-- they forbid.
REVOKE CREATE ON SCHEMA public FROM merit_live;

-- -----------------------------------------------------------------------------
-- 2. live_account_state -- ADR-164, SD-M2-07
-- -----------------------------------------------------------------------------
-- THE LIVE CACHE. ADR-020's tier 2, given a medium for the first time.
--
-- ONE ROW PER ACCOUNT, UPSERTED, AND IT IS DELIBERATELY NOT APPEND-ONLY. Every
-- append-only table in this schema is append-only because its HISTORY IS THE
-- PRODUCT -- 0026's own words about the ledger. ADR-020 says the opposite of
-- this one: "Tier 2 is a view", the content is discardable by design, and feed
-- loss degrades to the last closed session rather than to an older tick. An
-- append-only live cache would grow without bound to preserve a history no
-- document reads, and would need the expiry sweep P6 section 3.5 wondered
-- about. It does not need one.
CREATE TABLE live_account_state (
  -- The grain, and the hop to an identity. INV-M2-10 makes the resolution from
  -- the feed's platform ref safe forever: platform_account_refs is the BURN
  -- LIST and a ref is never reused across accounts, so the ingest's lookup
  -- cannot silently route one trader's ticks onto another trader's row.
  account_id             uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT,

  -- The tick's trading day. Carried because LiveAccountTick.sequence is 1-based
  -- PER ACCOUNT PER DAY, so a sequence without its day is not an ordinal at
  -- all, and because a row left over from yesterday must be distinguishable
  -- from a quiet market today.
  trading_day            date NOT NULL,

  -- 1-based, in delivery order. ADR-020 rule 3 makes feed loss a first-class
  -- state, and stream.ts states why the ordinal exists: without it "the only
  -- way to notice a gap is a timestamp comparison, which cannot tell a lost
  -- tick from a quiet market".
  sequence               integer NOT NULL,

  -- The day's FIRST tick equity for this account, and the latest. Both integer
  -- cents in bigint, and the type is not a preference: INV-02 makes cents the
  -- money type at every boundary, and stream.ts states that a tick narrowed to
  -- a float "would be the one place in the package where a cents value could
  -- silently lose precision, on the surface a trader watches". NEITHER CARRIES
  -- A NON-NEGATIVE CHECK, because an account's equity can go through zero and a
  -- constraint that refused it would drop exactly the ticks a trader most needs
  -- to see.
  opening_equity_cents   bigint NOT NULL,
  equity_cents           bigint NOT NULL,

  -- API_CONTRACT section 8's terms.intraday_movement_cents, computed by the
  -- database. 0049's rcr_bp precedent: a figure the database computes CANNOT
  -- DISAGREE with the two numbers stored beside it, and a movement written by
  -- the ingest could. Signed, in integer cents.
  intraday_movement_cents bigint GENERATED ALWAYS AS (equity_cents - opening_equity_cents) STORED,

  -- LiveFreshness.feed: "which feed the value came from". NO CHECK OVER A VALUE
  -- LIST, for the reason the header gives about `kind`: V-M2-16 is unanswered
  -- and a merged CHECK naming today's feeds could never be corrected.
  feed                   text NOT NULL,

  -- LiveFreshness.as_of_instant: "when that feed was last read". OUR CLOCK, set
  -- on write. ADR-152 clause 1 makes staleness the SERVER's answer, so the
  -- instant staleness is measured from has to be one a lagging or lying feed
  -- cannot move.
  as_of_instant          timestamptz NOT NULL DEFAULT now(),

  -- THE LABEL, ON THE ROW. Constant TRUE by construction and that is the point
  -- rather than an oversight: LiveAccountTick carries `indicative: true` as a
  -- REQUIRED LITERAL so that "a consumer destructuring a tick cannot fail to
  -- see it" (stream.ts), and a row read out of this table travels to a renderer
  -- the same way. INV-M4-11: "a label in a page footer is not a label on a
  -- number."
  indicative             boolean NOT NULL DEFAULT true,

  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT live_account_state_sequence_is_positive
    CHECK (sequence > 0),
  CONSTRAINT live_account_state_is_indicative
    CHECK (indicative)
);

COMMENT ON TABLE live_account_state IS
  'ADR-020 tier 2''s live cache, ADR-164, SD-M2-07. One row per account, '
  'upserted, discardable by design. Reachable only by merit_live: merit_app '
  'holds nothing on it, which is FM-M12-08 and FM-M13-07 as permissions rather '
  'than conventions.';

COMMENT ON COLUMN live_account_state.intraday_movement_cents IS
  'API_CONTRACT section 8 terms.intraday_movement_cents. Signed integer cents, '
  'generated, so it cannot disagree with the two equities beside it (0049).';

COMMENT ON COLUMN live_account_state.as_of_instant IS
  'LiveFreshness.as_of_instant. OUR clock at write time, never the feed''s, '
  'because ADR-152 clause 1 makes staleness the server''s own answer.';

-- -----------------------------------------------------------------------------
-- 3. THE REVOKE THIS FILE EXISTS FOR (header items 2 and 3)
-- -----------------------------------------------------------------------------
-- 0026 ends with ALTER DEFAULT PRIVILEGES granting merit_app SELECT, INSERT,
-- UPDATE and DELETE on anything a later migration creates, so the table above is
-- fully reachable by the application role the instant it exists.
--
-- FM-M12-08: "The stats worker holds no read grant on the live cache."
-- DEP-M12-08 makes it a dependency, and SECURITY's threat row states the
-- consequence as "the engine has no read path to the live cache". The stats run
-- is apps/worker/src/batch/statistics.ts and it runs as merit_app. So the verb
-- that has to go is SELECT, and taking only UPDATE and DELETE -- which is what
-- 0032, 0039 and 0049 each correctly did for a DIFFERENT sentence -- would
-- leave the one this file exists to implement unimplemented.
--
-- Against PUBLIC as well as merit_app, because a revoke that only binds the
-- application role is a revoke that a second connection string bypasses. 0026's
-- own words, and 0032's precedent applied a seventh time.
REVOKE ALL ON live_account_state FROM merit_app, PUBLIC;

-- merit_analytics is deliberately NOT granted SELECT, and here the default is
-- already right: 0026's default privileges make a new table invisible to
-- analytics until somebody grants it. FM-M13-07 ("the analytics service holds
-- no read grant on the live cache") therefore holds by doing nothing, and this
-- comment is the record that it was checked rather than assumed.

-- -----------------------------------------------------------------------------
-- 4. What merit_live may do
-- -----------------------------------------------------------------------------
-- ENUMERATED, NOT GRANTED-THEN-REVOKED, which is 0026's merit_analytics idiom
-- and 0034's, for the reason both give: the risk on a narrow role is a table
-- added later becoming reachable by default, and the default should be that it
-- is not.
--
-- SELECT, INSERT AND UPDATE. INSERT and UPDATE are the upsert; SELECT is the
-- read path that serves API_CONTRACT section 6.1's frames and section 8's
-- figure. INV-M2-14's "write-only into the live cache" is a statement about
-- WHERE the streaming path writes -- the cache and nothing else -- and not a
-- refusal of the read that renders it.
GRANT SELECT, INSERT, UPDATE ON live_account_state TO merit_live;

-- The burn list, READ ONLY. The feed identifies an account by its platform ref
-- and this table is the only place that maps one to an account_id. C-26 is
-- about WRITE grants on authoritative tables and this is a read; INV-M2-14
-- enumerates the four tables the streaming path may not touch and this is not
-- among them.
GRANT SELECT ON platform_account_refs TO merit_live;

-- -----------------------------------------------------------------------------
-- 5. The belts (0034's precedent, which execution proved was a mechanism)
-- -----------------------------------------------------------------------------
-- 0034 recorded that its closing REVOKE was called decoration and turned out to
-- be a control: a seeded DELETE added to a grant list above it did not survive
-- to COMMIT. Two belts here, for the two mistakes this file's grant lists
-- invite.
--
-- FIRST: no DELETE on the cache. Nothing above grants it. Nothing needs it --
-- the table is one row per account and bounded, feed loss is answered by
-- as_of_instant going stale rather than by removing a row, and a live tier that
-- can delete rows can hide the evidence that it was ever wrong.
REVOKE DELETE ON live_account_state FROM merit_live;

-- SECOND: INV-M2-14's four tables, written out as the REVOKE the invariant's
-- own words describe. "It has no grant on fills, raw_ingest_rows, daily_marks,
-- or rule_states ... that separation is a permission rather than a convention."
-- merit_live holds nothing on them as this file is written, because it has no
-- default privileges and no grant above names them, so against the file as
-- written this changes no catalogue row. It binds the likeliest mistake anyway,
-- which is a fifth table appended to a grant list somebody was already editing.
--
-- IT CANNOT BIND THE FUTURE, and nothing in PostgreSQL can: a later migration
-- granting one of these to merit_live wins, and only a reviewer or a gate
-- catches that. 0034 says the same thing about its own belt and it is still
-- true here.
REVOKE ALL ON
  fills,
  raw_ingest_rows,
  daily_marks,
  rule_states
FROM merit_live;

COMMIT;
