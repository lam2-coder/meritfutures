-- =============================================================================
-- Probe: the pg-boss job store (0079). ADR-318, ADR-305 section 7 slice 4
-- =============================================================================
-- THIS PROBE ASSERTS SOMETHING NO OTHER CHECK IN THIS REPOSITORY CAN.
-- `scripts/db/assert_pgboss_schema_matches_library.mjs` compares TEXT: that
-- `0079` still quotes what the installed pg-boss emits. It never runs a
-- statement, so it cannot tell a body that installs a working job store from one
-- that installs a broken one. Everything below runs against the applied schema.
--
-- THREE SUCCESS CASES BEFORE THE FIRST REJECTION, on DELTA_MANIFEST section 13's
-- discipline. This migration exists to make enqueueing POSSIBLE, so a schema
-- that refused every write would satisfy every rejection here and still be
-- useless. SUCCESS 2 and SUCCESS 3 are the two that matter: they execute
-- `pgboss.create_queue`, which is the function that does the DDL pg-boss would
-- otherwise have done at `start()`, and they prove the partition routing works.
--
-- SUCCESS 1 IS THE PIN. `pgboss.version` holding exactly `38` is what makes
-- `migrate: false` viable at all: `Contractor.check()` throws
-- `pg-boss database requires migrations` for any other number, so this single
-- row is the contract between the migration set and the library version in the
-- catalog. A probe of tables that skipped it would miss the only row `0079`
-- writes.
--
-- REJECTION 5 IS A DELIBERATE ABSENCE ASSERTED RATHER THAN COMMENTED, AND IT IS
-- THE ONE A LATER SLICE MUST CHANGE. `0026_roles_and_grants.sql` grants USAGE
-- and default privileges IN SCHEMA public only, so `merit_app` cannot see this
-- schema at all. `0079` deliberately grants nothing, because pg-boss's
-- `create_queue` runs `CREATE TABLE pgboss.%I` and making the queue usable by
-- the application role means granting CREATE on a schema inside the ledger's
-- restore boundary to the role `0026` explicitly REVOKES CREATE from on public.
-- That is a privilege ruling and it belongs to the slice that wires a deployable
-- to the queue (ADR-305 slice 8). THE DAY SOMEBODY MAKES THAT RULING THIS CASE
-- GOES RED, which is the point: it turns a silent widening into a diff that
-- names the control being changed.
--
-- Rejections are checked by CONSTRAINT NAME or by SQLSTATE out of GET STACKED
-- DIAGNOSTICS rather than by exception class alone, because three of the five
-- below raise the same class and a handler catching the class cannot tell them
-- apart.
--
-- THE COUNTERFACTUAL, AS OBSERVED. Executed against `0001`..`0076` this file
-- dies at SUCCESS 1 with `relation "pgboss.version" does not exist`. Exit 3.
--
-- REJECTION 5 WAS FALSIFIED RATHER THAN ASSUMED. `GRANT USAGE ON SCHEMA pgboss
-- TO merit_app` against the applied set turns it RED with the message above, and
-- the REVOKE restores the green run.
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
-- REJECTION 5. THE DELIBERATE ABSENCE. `0079` grants nothing, so the application
-- role cannot reach this schema. Read the header before changing this case.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fired boolean := false;
BEGIN
  IF has_schema_privilege('merit_app', 'pgboss', 'USAGE') THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_app holds USAGE on pgboss. 0079 grants nothing; a later migration granted it and ADR-305 slice 8 owes the ruling that says why';
  END IF;
  IF has_schema_privilege('merit_app', 'pgboss', 'CREATE') THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_app holds CREATE on pgboss, inside the ledger restore boundary';
  END IF;
  SET LOCAL ROLE merit_app;
  BEGIN
    PERFORM count(*) FROM pgboss.queue;
  EXCEPTION WHEN insufficient_privilege THEN fired := true;
  END;
  RESET ROLE;
  IF NOT fired THEN
    RAISE EXCEPTION 'REJECTION 5 FAILED: merit_app can read pgboss.queue';
  END IF;
  RAISE NOTICE 'REJECTION 5: merit_app cannot reach the pgboss schema, and 0079 grants nothing on purpose';
END $$;

\echo 'probe_pgboss_job_store: 3 successes and 5 rejections hold against the applied schema.'

ROLLBACK;
