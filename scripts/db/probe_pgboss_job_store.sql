-- =============================================================================
-- Probe: the pg-boss job store (0079). ADR-318, ADR-305 section 7 slice 4
-- =============================================================================
-- THIS PROBE ASSERTS SOMETHING NO OTHER CHECK IN THIS REPOSITORY CAN.
-- `scripts/db/assert_pgboss_schema_matches_library.mjs` compares TEXT: that
-- `0079` still quotes what the installed pg-boss emits. It never runs a
-- statement, so it cannot tell a body that installs a working job store from one
-- that installs a broken one. Everything below runs against the applied schema.
--
-- FIVE SUCCESS CASES BEFORE THE FIRST REJECTION, on DELTA_MANIFEST section 13's
-- discipline. `0079` exists to make enqueueing POSSIBLE and `0082` exists to
-- make it possible FOR THE APPLICATION ROLE, so a schema that refused every
-- write, or a grant that reached nothing, would satisfy every rejection here and
-- still be useless. SUCCESS 2 and SUCCESS 3 execute `pgboss.create_queue`, which
-- is the function that does the DDL pg-boss would otherwise have done at
-- `start()`, and they prove the partition routing works. SUCCESS 4 runs the whole
-- measured statement set as `merit_app` and is the case that goes RED against
-- `0001`..`0081`.
--
-- SUCCESS 1 IS THE PIN. `pgboss.version` holding exactly `38` is what makes
-- `migrate: false` viable at all: `Contractor.check()` throws
-- `pg-boss database requires migrations` for any other number, so this single
-- row is the contract between the migration set and the library version in the
-- catalog. A probe of tables that skipped it would miss the only row `0079`
-- writes.
--
-- SUCCESS 4 AND SUCCESS 5 ARE THE GRANT, AND THEY ARE THE CASES THIS FILE
-- REFUSED TO CARRY UNTIL `0082`. This header used to read: "REJECTION 5 IS A
-- DELIBERATE ABSENCE ASSERTED RATHER THAN COMMENTED, AND IT IS THE ONE A LATER
-- SLICE MUST CHANGE ... THE DAY SOMEBODY MAKES THAT RULING THIS CASE GOES RED,
-- which is the point: it turns a silent widening into a diff that names the
-- control being changed." `0082_pgboss_app_grants.sql` is that diff, ADR-327 is
-- that ruling, and the case is REWRITTEN rather than deleted or loosened: it
-- asserted an absence and it now asserts that the grant is EXACTLY what was
-- ruled and NO WIDER.
--
-- ONE SENTENCE OF THIS HEADER WAS WRONG AND IS SUPERSEDED IN PLACE. It read:
-- "`0079` deliberately grants nothing, because pg-boss's `create_queue` runs
-- `CREATE TABLE pgboss.%I` and making the queue usable by the application role
-- means granting CREATE on a schema inside the ledger's restore boundary". The
-- second half is FALSE for the queue this workspace declares. `create_queue`
-- `RETURN`s above that `CREATE TABLE` unless `options->>'partition' = 'true'`,
-- and `pg-boss-queue.ts`'s `declareQueue` calls `boss.createQueue(queue)` with no
-- options at all. `0079` is merged and merged migrations are never edited
-- (constitution E2), so the correction lives in `0082`'s header and in ADR-327,
-- and it lives here because this file is a script rather than a migration.
--
-- SUCCESS 4 RUNS THE MEASURED STATEMENT SET UNDER `SET LOCAL ROLE merit_app`.
-- The shapes are transcribed from what pg-boss actually issued against the
-- applied schema (ADR-327 section 3), not invented: the version read, the queue
-- catalogue read and its leases, `create_queue`, the enqueue into the default
-- partition, the fetch, the completion, the retention delete, the flow poller's
-- pass over the partitioned PARENT, the cron table read and the dependency reap.
-- A probe of the catalogue alone would pass against a grant that reads correctly
-- and refuses every statement.
--
-- SUCCESS 5 READS THE CATALOGUE AND ASSERTS EQUALITY IN BOTH DIRECTIONS, out of
-- `aclexplode(pg_class.relacl)` rather than out of `0082`'s DDL, so a privilege
-- ADDED and a privilege LOST are each a failure. REJECTION 5 is the other half:
-- no `CREATE` on the schema, nothing at all on the four tables `0082` leaves
-- alone, no `DELETE` on `pgboss.queue`, and nothing for `merit_analytics` or
-- `PUBLIC`. REJECTION 6 executes the one that matters most: a PARTITIONED queue
-- needs `CREATE TABLE` in this schema, and `merit_app` is refused it BY THE
-- DATABASE rather than by a comment.
--
-- Rejections are checked by CONSTRAINT NAME or by SQLSTATE out of GET STACKED
-- DIAGNOSTICS rather than by exception class alone, because three of the five
-- below raise the same class and a handler catching the class cannot tell them
-- apart.
--
-- THE COUNTERFACTUAL, AS OBSERVED. Executed against `0001`..`0076` this file
-- dies at SUCCESS 1 with `relation "pgboss.version" does not exist`, exit 3, and
-- against `0001`..`0081` it dies at SUCCESS 4 with `permission denied for schema
-- pgboss`, exit 3. The second one is the falsification that matters now: before
-- `0082` this file PASSED, so a green run had to start meaning something new the
-- day the grant landed.
--
-- AND THE EQUALITY WAS FALSIFIED IN BOTH DIRECTIONS RATHER THAN ASSUMED. Six
-- seeded perturbations against the applied set, each watched RED and each
-- restored GREEN by its inverse:
--
--   GRANT DELETE ON pgboss.queue TO merit_app  -> SUCCESS 5, `{queue.DELETE}`
--   GRANT SELECT ON pgboss.bam TO merit_app    -> SUCCESS 5, `{bam.SELECT}`
--   REVOKE UPDATE ON pgboss.version            -> dies inside SUCCESS 4 at
--                                                 `permission denied for table
--                                                 version`
--   REVOKE USAGE ON SCHEMA pgboss              -> dies inside SUCCESS 4 at
--                                                 `permission denied for schema
--                                                 pgboss`
--   GRANT CREATE ON SCHEMA pgboss              -> REJECTION 5 by name
--   GRANT USAGE ON SCHEMA pgboss TO
--     merit_analytics                          -> REJECTION 5 by name
--
-- The two REVOKEs die at a raw Postgres error rather than at a message this file
-- wrote, and that is correct rather than untidy: SUCCESS 4 runs STATEMENTS, so a
-- missing privilege is reported by the server at the statement that needed it.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- SUCCESS 1. The version pin `migrate: false` reads at every `start()`
-- ---------------------------------------------------------------------------
DO $$
DECLARE rows_seen int; pinned int;
BEGIN
  SELECT count(*), max(version) INTO rows_seen, pinned FROM pgboss.version;
  IF rows_seen <> 1 THEN
    RAISE EXCEPTION 'SUCCESS 1 FAILED: pgboss.version holds % rows, expected exactly 1', rows_seen;
  END IF;
  IF pinned <> 38 THEN
    RAISE EXCEPTION 'SUCCESS 1 FAILED: pgboss.version is % and 0079 was emitted at 38. Contractor.check() refuses every other number', pinned;
  END IF;
  RAISE NOTICE 'SUCCESS 1: pgboss.version pins the library schema version at 38';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 2. An unpartitioned queue takes a job, and it lands in job_common
-- ---------------------------------------------------------------------------
DO $$
DECLARE landed text;
BEGIN
  PERFORM pgboss.create_queue('probe-plain', '{"policy":"standard"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM pgboss.queue WHERE name = 'probe-plain' AND table_name = 'job_common') THEN
    RAISE EXCEPTION 'SUCCESS 2 FAILED: create_queue did not register probe-plain against job_common';
  END IF;

  INSERT INTO pgboss.job (name, data) VALUES ('probe-plain', '{"probe":1}'::jsonb);

  SELECT c.relname INTO landed
  FROM pgboss.job j
  JOIN pg_class c ON c.oid = j.tableoid
  WHERE j.name = 'probe-plain';

  IF landed IS DISTINCT FROM 'job_common' THEN
    RAISE EXCEPTION 'SUCCESS 2 FAILED: the job landed in % rather than job_common', coalesce(landed, '<nowhere>');
  END IF;
  RAISE NOTICE 'SUCCESS 2: an unpartitioned queue accepts a job into the default partition';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 3. A partitioned queue gets its OWN table, and delete_queue drops it
-- ---------------------------------------------------------------------------
DO $$
DECLARE own_table text; landed text;
BEGIN
  PERFORM pgboss.create_queue('probe-partitioned', '{"policy":"standard","partition":true}'::jsonb);
  SELECT table_name INTO own_table FROM pgboss.queue WHERE name = 'probe-partitioned';
  IF own_table IS NULL OR own_table = 'job_common' THEN
    RAISE EXCEPTION 'SUCCESS 3 FAILED: a partitioned queue was routed to % rather than a table of its own', coalesce(own_table, '<null>');
  END IF;

  INSERT INTO pgboss.job (name, data) VALUES ('probe-partitioned', '{"probe":3}'::jsonb);

  SELECT c.relname INTO landed
  FROM pgboss.job j
  JOIN pg_class c ON c.oid = j.tableoid
  WHERE j.name = 'probe-partitioned';

  IF landed IS DISTINCT FROM own_table THEN
    RAISE EXCEPTION 'SUCCESS 3 FAILED: the job landed in % rather than %', coalesce(landed, '<nowhere>'), own_table;
  END IF;

  DELETE FROM pgboss.job WHERE name = 'probe-partitioned';
  -- `q_fkey` is DEFERRABLE INITIALLY DEFERRED, so the insert and delete above
  -- leave pending trigger events and Postgres refuses to DROP a table carrying
  -- them. Forcing them now is what an application would get at COMMIT.
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM pgboss.delete_queue('probe-partitioned');
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss' AND c.relname = own_table
  ) THEN
    RAISE EXCEPTION 'SUCCESS 3 FAILED: delete_queue left % behind', own_table;
  END IF;
  RAISE NOTICE 'SUCCESS 3: a partitioned queue owns its table and delete_queue reclaims it';
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 4. THE APPLICATION ROLE CAN ACTUALLY RUN THE QUEUE. `0082`, ADR-327
-- ---------------------------------------------------------------------------
-- EVERY STATEMENT BELOW IS A SHAPE pg-boss ISSUED against this schema during
-- ADR-327's measurement, re-run here under the role the deployable connects as.
-- The point of transcribing them rather than asserting privileges is that a
-- privilege is a name and a statement is the thing that either runs or does not:
-- `job` is a PARTITIONED PARENT and `job_common` its default partition, and
-- Postgres checks the relation the statement names, so a grant on one of them
-- says nothing about the other.
DO $$
DECLARE fetched uuid; reaped int;
BEGIN
  SET LOCAL ROLE merit_app;

  -- `Contractor.check()` at every start(), then the queue-cache read.
  PERFORM version FROM pgboss.version;
  PERFORM name, policy, table_name FROM pgboss.queue;

  -- The two leases the flow poller and the cron monitor take on the pin row.
  UPDATE pgboss.version SET flow_on = now();
  UPDATE pgboss.version SET cron_on = now();

  -- `declareQueue`, which is `create_queue` with no options. It is SECURITY
  -- INVOKER, so this INSERT into pgboss.queue is checked against merit_app.
  PERFORM pgboss.create_queue('probe-as-merit-app', '{"policy":"standard"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM pgboss.queue WHERE name = 'probe-as-merit-app' AND table_name = 'job_common') THEN
    RAISE EXCEPTION 'SUCCESS 4 FAILED: merit_app could not declare a queue';
  END IF;

  -- `enqueue`. pg-boss names the PARTITION here rather than the parent.
  INSERT INTO pgboss.job_common (name, data) VALUES ('probe-as-merit-app', '{"probe":4}'::jsonb);

  -- The fetch, as `consume` issues it: SELECT ... FOR UPDATE then the UPDATE.
  WITH next AS (
    SELECT j.id FROM pgboss.job_common j
    WHERE j.name = 'probe-as-merit-app' AND j.state < 'active'
    ORDER BY j.created_on, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE pgboss.job_common j SET state = 'active', started_on = now()
  FROM next WHERE j.id = next.id
  RETURNING j.id INTO fetched;
  IF fetched IS NULL THEN
    RAISE EXCEPTION 'SUCCESS 4 FAILED: merit_app enqueued a job it cannot fetch';
  END IF;

  -- The completion, and then the retention pass that reclaims the row.
  UPDATE pgboss.job_common SET state = 'completed', completed_on = now() WHERE id = fetched;
  DELETE FROM pgboss.job_common WHERE id = fetched;

  -- The dead-letter arm of the timeout sweep names the PARENT, and it is planned
  -- on every supervisor pass whether or not a dead letter is configured.
  INSERT INTO pgboss.job (name, data) VALUES ('probe-as-merit-app', '{"probe":"parent"}'::jsonb);
  PERFORM j.id FROM pgboss.job j WHERE j.name = 'probe-as-merit-app' FOR UPDATE OF j;
  UPDATE pgboss.job j SET pending_dependencies = j.pending_dependencies WHERE j.name = 'probe-as-merit-app';
  DELETE FROM pgboss.job_common WHERE name = 'probe-as-merit-app';

  -- The supervisor's two leases on the queue row.
  UPDATE pgboss.queue SET monitor_on = now(), maintain_on = now() WHERE name = 'probe-as-merit-app';

  -- The cron monitor reads pg-boss's own schedule table every 30 seconds. It is
  -- EMPTY and stays empty (ADR-241 rules the schedule external), and a read of an
  -- empty table is exactly what this role should be able to do and no more.
  PERFORM name, cron FROM pgboss.schedule;

  -- The dependency reap, which is the maintenance pass's last statement.
  DELETE FROM pgboss.job_dependency
  WHERE child_name = 'probe-as-merit-app'
    AND NOT EXISTS (SELECT 1 FROM pgboss.job_common j WHERE j.name = child_name AND j.id = child_id);
  GET DIAGNOSTICS reaped = ROW_COUNT;

  RESET ROLE;
  RAISE NOTICE 'SUCCESS 4: merit_app declared a queue, enqueued, fetched, completed and reaped (% edge(s))', reaped;
END $$;

-- ---------------------------------------------------------------------------
-- SUCCESS 5. The grant is EXACTLY what ADR-327 ruled, read from the catalogue
-- ---------------------------------------------------------------------------
-- BOTH DIRECTIONS, out of `aclexplode(pg_class.relacl)` rather than out of
-- `0082`'s DDL, because a check that reads the file it is checking is a second
-- copy of that file. A privilege ADDED and a privilege LOST are each a failure:
-- one is the silent widening REJECTION 5 was written to catch, the other is a
-- deployable that boots and then refuses a job at three in the morning.
DO $$
DECLARE
  ruled text[] := ARRAY[
    'job.INSERT', 'job.SELECT', 'job.UPDATE',
    'job_common.DELETE', 'job_common.INSERT', 'job_common.SELECT', 'job_common.UPDATE',
    'job_dependency.DELETE', 'job_dependency.SELECT',
    'queue.INSERT', 'queue.SELECT', 'queue.UPDATE',
    'schedule.SELECT',
    'version.SELECT', 'version.UPDATE'
  ];
  held text[];
  extra text[];
  missing text[];
BEGIN
  IF NOT has_schema_privilege('merit_app', 'pgboss', 'USAGE') THEN
    RAISE EXCEPTION 'SUCCESS 5 FAILED: merit_app holds no USAGE on pgboss, so every JobQueue method throws';
  END IF;

  SELECT coalesce(array_agg(g ORDER BY g), '{}'::text[]) INTO held FROM (
    SELECT c.relname || '.' || a.privilege_type AS g
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'pgboss' AND a.grantee = 'merit_app'::regrole::oid
  ) s;

  SELECT coalesce(array_agg(r ORDER BY r), '{}'::text[]) INTO missing
  FROM unnest(ruled) r WHERE r <> ALL (held);
  SELECT coalesce(array_agg(h ORDER BY h), '{}'::text[]) INTO extra
  FROM unnest(held) h WHERE h <> ALL (ruled);

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'SUCCESS 5 FAILED: ADR-327 ruled these and the catalogue does not hold them: %', missing;
  END IF;
  IF cardinality(extra) > 0 THEN
    RAISE EXCEPTION 'SUCCESS 5 FAILED: merit_app holds privileges ADR-327 did not rule, inside the ledger restore boundary: %', extra;
  END IF;
  RAISE NOTICE 'SUCCESS 5: merit_app holds exactly the % privileges ADR-327 ruled, on 6 of the schema''s tables', cardinality(ruled);
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 1. A job for a queue nobody declared. `q_fkey` is DEFERRABLE
-- INITIALLY DEFERRED, so this fires at the end of the subtransaction rather
-- than at the INSERT, which is exactly how it would fire in an application
-- transaction that enqueued and then did more work.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired text;
BEGIN
  BEGIN
    INSERT INTO pgboss.job (name) VALUES ('probe-never-declared');
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS fired = CONSTRAINT_NAME;
  END;
  IF fired IS DISTINCT FROM 'q_fkey' THEN
    RAISE EXCEPTION 'REJECTION 1 FAILED: a job for an undeclared queue was accepted (constraint: %)', coalesce(fired, '<none>');
  END IF;
  RAISE NOTICE 'REJECTION 1: a job naming no declared queue is refused by q_fkey';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 2. Deleting a queue that still holds work. ON DELETE RESTRICT is
-- what stops a queue teardown from silently dropping enqueued jobs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired text;
BEGIN
  BEGIN
    DELETE FROM pgboss.queue WHERE name = 'probe-plain';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS fired = CONSTRAINT_NAME;
  END;
  IF fired IS DISTINCT FROM 'q_fkey' THEN
    RAISE EXCEPTION 'REJECTION 2 FAILED: a queue holding a job was deleted (constraint: %)', coalesce(fired, '<none>');
  END IF;
  RAISE NOTICE 'REJECTION 2: a queue still holding a job cannot be deleted';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 3. `job_state` is a TYPE and not free text, so an invented state is
-- refused at the write rather than read back later as a job nothing dispatches.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired boolean := false;
BEGIN
  BEGIN
    INSERT INTO pgboss.job (name, state) VALUES ('probe-plain', 'nearly_done');
  EXCEPTION WHEN invalid_text_representation THEN fired := true;
  END;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 3 FAILED: pgboss.job accepted a state outside pgboss.job_state';
  END IF;
  RAISE NOTICE 'REJECTION 3: a job state outside the enum is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 4. A `key_strict_fifo` job with no key. The whole ordering guarantee
-- of that policy is per key, so a null key is a job with no place in the order.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired text;
BEGIN
  BEGIN
    INSERT INTO pgboss.job (name, policy, singleton_key) VALUES ('probe-plain', 'key_strict_fifo', NULL);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS fired = CONSTRAINT_NAME;
  END;
  IF fired IS DISTINCT FROM 'job_key_strict_fifo_singleton_key_check' THEN
    RAISE EXCEPTION 'REJECTION 4 FAILED: a key_strict_fifo job with no key was accepted (constraint: %)', coalesce(fired, '<none>');
  END IF;
  RAISE NOTICE 'REJECTION 4: a key_strict_fifo job with no singleton_key is refused';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 5. AND NOTHING WIDER. `0082`, ADR-327
-- ---------------------------------------------------------------------------
-- THIS CASE ASSERTED AN ABSENCE AND NOW ASSERTS A CEILING. Read the header
-- before changing it: it went red BY `0082` SUCCEEDING, which is what it was
-- written to do, and rewriting it to the narrower truth is the whole design.
-- SUCCESS 5 says the catalogue holds exactly the ruled set. This says the role
-- cannot DO the things outside it, which is the half a catalogue read cannot
-- reach: a privilege inherited through a role membership, or granted to PUBLIC,
-- never appears in `merit_app`'s own ACL entries.
DO $$
DECLARE fired boolean;
BEGIN
  -- 1. NO DDL INSIDE THE LEDGER'S RESTORE BOUNDARY. 0026:64 REVOKEs exactly this
  --    privilege from exactly this role on `public`, and 0082 refuses to hand it
  --    back on a schema sitting in the same PITR window as ledger_entries.
  IF has_schema_privilege('merit_app', 'pgboss', 'CREATE') THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_app holds CREATE on pgboss, inside the ledger restore boundary. ADR-326 section 3.3 and ADR-327 both refuse it';
  END IF;

  -- 2. THE FOUR TABLES 0082 LEAVES ALONE. bam is written only under
  --    migrate: true; warning and queue_stats only under persistWarnings and
  --    persistQueueStats; subscription only by publish/subscribe. pgBossQueue
  --    pins the first and PgBossQueueOptions cannot set the rest, so a role that
  --    could reach them would be reaching further than any code path goes.
  IF has_table_privilege('merit_app', 'pgboss.bam', 'SELECT')
     OR has_table_privilege('merit_app', 'pgboss.warning', 'SELECT')
     OR has_table_privilege('merit_app', 'pgboss.subscription', 'SELECT')
     OR has_table_privilege('merit_app', 'pgboss.queue_stats', 'SELECT') THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_app can reach one of pgboss.bam, pgboss.warning, pgboss.subscription or pgboss.queue_stats. 0082 grants on six tables and no path reaches these four';
  END IF;

  -- 3. NO DELETE ON THE QUEUE CATALOGUE, asserted as a STATEMENT because that is
  --    what pgboss.delete_queue runs. A deployable that can drop a queue can
  --    drop the jobs enqueued against it, and JobQueue publishes no method for it.
  SET LOCAL ROLE merit_app;
  fired := false;
  BEGIN
    DELETE FROM pgboss.queue WHERE name = 'probe-as-merit-app';
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_app deleted a row from pgboss.queue';
  END IF;

  -- 4. NOTHING FOR ANY OTHER ROLE. 0026 makes a new table invisible to analytics
  --    until somebody grants it deliberately, and PUBLIC holding a privilege here
  --    would make the whole enumeration above decorative.
  IF has_schema_privilege('merit_analytics', 'pgboss', 'USAGE') THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_analytics can reach pgboss. No analytics surface reads a queue';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname = 'pgboss' AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: PUBLIC holds a privilege on the pgboss schema';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'pgboss' AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: PUBLIC holds a privilege on a table in the pgboss schema';
  END IF;

  RAISE NOTICE 'REJECTION 5: no CREATE, four tables unreachable, no DELETE on the catalogue, nothing for analytics or PUBLIC';
END $$;

-- ---------------------------------------------------------------------------
-- REJECTION 6. A PARTITIONED QUEUE IS REFUSED BY THE DATABASE. `0082`, ADR-327
-- ---------------------------------------------------------------------------
-- THE ONE CASE THAT EXECUTES THE CORRECTION `0082` CARRIES. `0079`'s header and
-- this file's own header both said that making the queue usable means granting
-- CREATE, because `pgboss.create_queue` runs `CREATE TABLE pgboss.%I`. It does,
-- for a PARTITIONED queue only, and SUCCESS 3 above proves that arm works for a
-- role that holds CREATE. This proves the application role does not, so the
-- correction is not a claim about what a caller happens to pass today: a
-- partitioned queue is refused even if somebody writes one.
DO $$
DECLARE fired boolean := false; state text;
BEGIN
  SET LOCAL ROLE merit_app;
  BEGIN
    PERFORM pgboss.create_queue('probe-partitioned-as-app', '{"policy":"standard","partition":true}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE;
    fired := true;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 6 FAILED: merit_app created a partitioned queue, so it holds CREATE on a schema inside the ledger restore boundary';
  END IF;
  IF state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'REJECTION 6 FAILED: the refusal was % rather than insufficient_privilege', coalesce(state, '<none>');
  END IF;
  -- And the queue row the function inserts BEFORE the CREATE TABLE is gone with
  -- the subtransaction, so a refused declaration leaves no half-made queue.
  IF EXISTS (SELECT 1 FROM pgboss.queue WHERE name = 'probe-partitioned-as-app') THEN
    RAISE EXCEPTION 'REJECTION 6 FAILED: the refused partitioned queue left a row in pgboss.queue';
  END IF;
  RAISE NOTICE 'REJECTION 6: merit_app cannot declare a partitioned queue, and the refusal leaves no row';
END $$;

\echo 'probe_pgboss_job_store: 5 successes and 6 rejections hold against the applied schema.'

ROLLBACK;
