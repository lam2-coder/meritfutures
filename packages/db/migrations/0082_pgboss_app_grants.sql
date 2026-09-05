-- =============================================================================
-- 0082_pgboss_app_grants
-- =============================================================================
-- E2 READ: MONEY PATH. THIS FILE MOVES A CONTROL AND CREATES NOTHING.
--
-- It widens what the application role can reach INSIDE THE PITR BOUNDARY THAT
-- PROTECTS THE LEDGER. `0079_pgboss_job_store.sql` put pg-boss's schema in this
-- database, in the same restore as `ledger_entries`, and granted the application
-- role nothing at all. This file is the grant, and four things in it need the
-- founder's line-by-line read:
--
--   1. `CREATE ON SCHEMA pgboss` IS REFUSED, AND THE REFUSAL IS THE RULING.
--      `0026_roles_and_grants.sql:64` REVOKEs `CREATE ON SCHEMA public` from
--      `merit_app` because "the application role has no DDL" (DATA_MODEL section
--      14). Granting it here, on a schema inside the ledger's restore boundary,
--      would undo one of the four things `0026`'s own header puts to a founder.
--      ADR-326 section 3.3 ruled it out and ADR-327 measured that nothing needs
--      it. **A running application still cannot alter its own schema.**
--   2. THE SET IS MEASURED AND NOT REASONED. Every term below was produced by
--      running `pgBossQueue`'s five methods and its three background pollers
--      against the applied schema under `SET ROLE merit_app`, and by then
--      REVOKING each term one at a time and watching the run go red. ADR-327
--      section 3 carries both transcripts. A privilege nobody watched being
--      needed is a privilege nobody knows is needed.
--   3. IT IS TABLE BY TABLE AND NOT `ON ALL TABLES IN SCHEMA pgboss`. Four of
--      the schema's tables get nothing: `bam`, `warning`, `subscription` and
--      `queue_stats`. `ALL TABLES` would also have granted on the `queue_stats`
--      partitions, whose names are `queue_stats_YYYYMMDD` off the day `0079` was
--      APPLIED (`0079`'s header, property A), so the resulting privilege set
--      would differ per install day and no probe could state it.
--   4. NO DEFAULT PRIVILEGES ARE ALTERED FOR THIS SCHEMA. `0026:174` does that
--      for `public`, so a table a later migration creates there is reachable by
--      the application. Here the opposite is wanted: the next pg-boss catalog
--      bump arrives as a NEW migration carrying `getMigrationPlans`' output, and
--      a table it adds must be UNREACHABLE until somebody grants it deliberately
--      in that same migration. That is `0026`'s own reasoning for the analytics
--      role, applied to a vendor's schema.
--
-- ADR-327 (status: proposed, founder approval PENDING) is the ruling, on ADR-326
-- section 3.3 and ADR-305 section 7 slice 8. NOTHING HERE IS SIGNED.
--
-- -----------------------------------------------------------------------------
-- A SENTENCE IN `0079` AND IN ITS PROBE IS WRONG, AND IT IS SUPERSEDED IN PLACE
-- RATHER THAN EDITED
-- -----------------------------------------------------------------------------
-- `0079`'s header, finding 1, reads: "pg-boss's `create_queue` runs `CREATE
-- TABLE pgboss.%I`, so making the queue usable by the application role means
-- granting CREATE on a schema inside the ledger's restore boundary". The same
-- sentence is in `scripts/db/probe_pgboss_job_store.sql`'s header.
--
-- IT IS FALSE FOR THE QUEUE THIS WORKSPACE DECLARES. Read at the function body
-- `0079` itself quotes, `pgboss.create_queue` computes `tablename` as
-- `'job_common'` unless `options->>'partition' = 'true'`, inserts one row into
-- `pgboss.queue`, and then:
--
--     IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM
--       'true' THEN RETURN; END IF;
--     EXECUTE format('CREATE TABLE pgboss.%I ...', tablename);
--
-- The `CREATE TABLE` is BELOW that `RETURN` and is unreachable for a queue that
-- is not partitioned. `packages/queue/src/pg-boss-queue.ts`'s `declareQueue`
-- calls `boss.createQueue(queue)` with no options, and `PgBossQueueOptions`
-- declares two fields, neither of which is a queue option, so no caller in this
-- workspace can ask for a partitioned queue at all.
--
-- `0079` IS MERGED AND IS NOT EDITED. Migrations are sacred: once merged, never
-- edited, only superseded (constitution E2). So the correction lives here and in
-- ADR-327, and the probe, which is not a migration, is rewritten.
--
-- AND THE REFUSAL IS ENFORCED RATHER THAN DESCRIBED. With the grants below and
-- no `CREATE`, `pgboss.create_queue('x', '{"partition":true}')` run as
-- `merit_app` fails at `permission denied for schema pgboss`, which the probe
-- asserts. A partitioned queue is refused BY THE DATABASE and not by a comment.
--
-- -----------------------------------------------------------------------------
-- WHAT THE MEASUREMENT COVERED, BECAUSE A GRANT IS ONLY AS NARROW AS THE PATHS
-- SOMEBODY RAN
-- -----------------------------------------------------------------------------
-- `pgBossQueue` fixes `migrate: false` and `useListenNotify: false` and takes no
-- other pg-boss option, so the reachable statement set is bounded by the library
-- defaults it does not name: `supervise` and `schedule` are ON, and
-- `persistQueueStats` and `persistWarnings` are OFF and cannot be turned on
-- through this interface. Under those settings the whole of `start()`,
-- `declareQueue`, `enqueue`, `consume`, `stop()`, the flow poller, the cron
-- monitor, the cron worker and one full supervisor pass (monitor and maintain)
-- executed with zero permission errors under exactly the grants below.
--
-- THE TABLES THAT GET NOTHING ARE THE ONES NO PATH REACHED. `bam` is written
-- only under `migrate: true`, which this interface pins false. `warning` and
-- `queue_stats` are written only under `persistWarnings` and
-- `persistQueueStats`. `subscription` is written only by `publish`/`subscribe`,
-- which `JobQueue`'s five methods do not expose. If any of those becomes
-- reachable, the failure is a loud `permission denied` in a deployable rather
-- than a silent widening here, and the remedy is a new numbered migration.
--
-- No table is created, no column changes, no constraint moves and no trigger is
-- installed, so the `public` object counts CI-06h derives are UNCHANGED by this
-- file: 118 tables, 414 indexes, 518 checks, 32 triggers, before and after, read
-- from the catalog on PostgreSQL 16.13.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- The schema itself: USAGE, and deliberately not CREATE
-- -----------------------------------------------------------------------------
-- Without this, `SELECT to_regclass('pgboss.version')` (the first statement
-- `start()` runs) raises `permission denied for schema pgboss` and every one of
-- `JobQueue`'s five methods throws.
GRANT USAGE ON SCHEMA pgboss TO merit_app;

-- DATA_MODEL section 14 and `0026:62-64`, restated on the schema `0079`
-- installed. BOTH LINES BELOW REMOVE NOTHING, measured: PostgreSQL grants a
-- newly created schema to nobody, so neither `merit_app` nor `PUBLIC` holds a
-- privilege here to take away. They are written anyway, exactly as `0026:64` and
-- `0026:65` are written over `public`, because the statement a reader has to find
-- is "this role has no DDL on the ledger's restore boundary", and a control that
-- exists only as the absence of a line is a control nobody can read. `merit_app`
-- also owns nothing in `pgboss`, so it can neither create nor drop nor alter
-- here by ownership either.
REVOKE CREATE ON SCHEMA pgboss FROM merit_app;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;

-- NOTHING IS GRANTED TO `merit_analytics` AND NOTHING IS REVOKED FROM IT. The
-- rulebook argument `0026` makes for that role does not apply to a job store,
-- but the default `0026` sets for it does: a table is invisible to analytics
-- until somebody grants it deliberately, and no analytics surface reads a queue.

-- -----------------------------------------------------------------------------
-- The tables, one at a time, with the path that needs each privilege
-- -----------------------------------------------------------------------------

-- `pgboss.version` holds ONE row and it is the version pin. SELECT is
-- `Contractor.check()` at every `start()`; UPDATE is the flow poller's
-- `SET flow_on = now()` and the cron monitor's `SET cron_on = now()`, which are
-- the two leases those pollers take. No INSERT: the row is `0079`'s and a second
-- one would make `Contractor.check()`'s reading ambiguous. No DELETE: deleting
-- it turns every later `start()` into `pg-boss is not installed`.
GRANT SELECT, UPDATE ON pgboss.version TO merit_app;

-- `pgboss.queue` is the queue catalogue. SELECT is the queue cache every fetch
-- reads; INSERT is `create_queue`, which is `declareQueue`; UPDATE is the
-- supervisor's `monitor_on` and `maintain_on` leases and the counter cache it
-- writes back. NO DELETE, and that is a decision: `pgboss.delete_queue` DELETEs
-- from this table, `JobQueue` publishes no method that calls it, and a deployable
-- that can drop a queue can drop the jobs enqueued against it.
GRANT SELECT, INSERT, UPDATE ON pgboss.queue TO merit_app;

-- `pgboss.schedule` is pg-boss's OWN cron table and this system does not use it:
-- ADR-241 rules the schedule EXTERNAL, one process per run. SELECT alone is
-- granted because the cron monitor reads the table unconditionally at `start()`
-- and every 30 seconds after it, and a read of an empty table is what it should
-- find. NO INSERT and NO UPDATE, so a deployable cannot acquire a second,
-- in-process scheduler by writing a row.
GRANT SELECT ON pgboss.schedule TO merit_app;

-- `pgboss.job` is the PARTITIONED PARENT. Postgres checks privileges on the
-- relation the statement names, so the parent needs its own terms even though
-- every row lives in a partition. SELECT and UPDATE are the flow poller's
-- `SELECT ... FOR UPDATE OF j` and the `UPDATE pgboss.job SET
-- pending_dependencies = ...` beside it; INSERT is the dead-letter arm of the
-- timeout and heartbeat sweeps, which is planned and therefore permission-checked
-- on every supervisor pass even though this workspace configures no dead letter.
-- NO DELETE: every delete pg-boss issues names the partition.
GRANT SELECT, INSERT, UPDATE ON pgboss.job TO merit_app;

-- `pgboss.job_common` is the DEFAULT partition and it is where every job in this
-- system lands, because a non-partitioned queue routes here. All four: INSERT is
-- `enqueue`, SELECT and UPDATE are the fetch, the completion and the timeout
-- sweep, and DELETE is the retention pass plus the delete-and-reinsert the
-- timeout sweep performs on an expired job.
GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.job_common TO merit_app;

-- `pgboss.job_dependency` is job-graph edges. SELECT is the flow poller's join;
-- DELETE is the maintenance pass that reaps edges whose job is gone. NO INSERT:
-- edges are written only by `send` with a dependency argument, and `JobRequest`
-- declares no such field (`job-queue.ts` refuses job-graph dependencies by name).
GRANT SELECT, DELETE ON pgboss.job_dependency TO merit_app;

COMMIT;
