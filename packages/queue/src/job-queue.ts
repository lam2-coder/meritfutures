// =============================================================================
// packages/queue/src/job-queue.ts
// =============================================================================
// THE JOB INTERFACE ADR-006 MADE A REVIEW CRITERION ON 2026-08-13, AND THIS IS
// THE FIRST ARTIFACT IT HAS EVER BEEN APPLIED TO. ADR-006 is `accepted`, it
// chose pg-boss, and it closed with a sentence that is a specification rather
// than a hope: "The job interface stays narrow enough that a later move to
// BullMQ is a contained change, and that narrowness is now a review criterion on
// M2 and M5, not an aspiration." Nothing in this tree enqueued anything until
// this file, so the criterion had nothing to grade.
//
// NO VENDOR IS NAMED IN THIS FILE. `pg-boss` appears in exactly one module of
// this package (`pg-boss-queue.ts`) and in no other module of the workspace, so
// "a later move to BullMQ" is a rewrite of one file rather than a search of the
// tree. That is what ADR-006's clause buys and it is only true while it is true,
// which is why `surface.test.ts` pins this list by name.
//
// -----------------------------------------------------------------------------
// THE ONE PRIMITIVE POSTGRES HAS AND REDIS DOES NOT, IN THE REQUIRED ARGUMENT
// POSITION
// -----------------------------------------------------------------------------
// `enqueue` takes the caller's OPEN TRANSACTION FIRST and has no overload that
// omits it. ADR-006's central consequence is that "enqueue participates in the
// same transaction as the state change that caused it, which removes a whole
// class of saga bugs ('committed the purchase, lost the provisioning job')", and
// a transaction is PER-CONNECTION, so an enqueue that reaches its own connection
// is that bug however carefully it is written.
//
// This is admitted DELIBERATELY and it is the foreclosure ADR-086 records: a
// BullMQ adapter could satisfy every other method on this interface and could
// not satisfy this one. It would have to accept the transaction and ignore it,
// which is the bug wearing the type that was supposed to prevent it. Naming that
// here costs one paragraph; discovering it at the move costs the saga.
//
// THE AWKWARD ONE TO WRITE IS THE NON-TRANSACTIONAL ONE, and that is the whole
// shape of this file. There is no `enqueueNow`, no optional transaction and no
// ambient default: a caller with no state change to join opens a transaction
// around the single insert, which is one line and is correct. A caller who wants
// the unsafe form has to build a `JobTransaction` by hand, which is a diff a
// reviewer reads.

/**
 * A job id, as the queue issues it.
 *
 * BRANDED because `null` is a real answer here and the pair has to survive being
 * passed around: `enqueue` returns `null` when `key` deduplicated the job
 * against one already queued, which is a SUCCESS and not a failure. An unbranded
 * `string | null` invites a caller to treat the null as an error and retry, and
 * retrying a deduplicated enqueue is how an idempotency key becomes decoration.
 */
export type JobId = string & { readonly __brand: 'JobId' };

/**
 * The caller's open transaction, as the queue sees it.
 *
 * ONE METHOD, AND IT IS A SQL EXECUTOR RATHER THAN A HANDLE. That is not a
 * convenience: it is the narrowest thing a Postgres-backed queue can be handed
 * that still lets the insert ride on the caller's connection, and it is
 * deliberately small enough that `packages/db` can satisfy it without exporting
 * its client (ADR-084 section 9 rules `client()` unexported, permanently).
 *
 * WHAT THIS TYPE CANNOT DO, stated rather than implied. It is STRUCTURAL, so
 * anything with an `executeSql` satisfies it, including a pool. The type says
 * "give the queue something that runs SQL"; it cannot say "and be inside a
 * transaction", because being inside a transaction is a fact about a connection
 * at a moment and no TypeScript type observes a moment. What the interface CAN
 * do, and does, is make the transaction the caller's to supply rather than the
 * queue's to open, so that the mistake is visible at the call site instead of
 * hidden in an adapter. `merit/no-raw-db-client` (VG-4) has exactly the same
 * limit and states it the same way: this closes the accidental door.
 */
export interface JobTransaction {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** What a job carries. JSON, because the job store is a table and not a heap. */
export type JobPayload = Record<string, unknown>;

/**
 * One enqueue request.
 *
 * EVERY OPTIONAL FIELD HERE IS EXPRESSIBLE ON A REDIS-BACKED QUEUE, and that is
 * the admission test ADR-086 applies to each of them one at a time. `key` is a
 * job id/dedup key, `notBefore` is a delay, and the two retry fields are an
 * attempt count and a backoff. What is NOT here is the list that would make
 * ADR-006's "contained change" expensive: no time-window singleton
 * (`sendThrottled`/`sendDebounced` are Postgres-side arithmetic over the job
 * table), no priority, no dead-letter routing, no job-graph dependencies and no
 * query over queued jobs. Each is available from pg-boss and each is refused
 * until a caller needs it, because a primitive admitted before a caller exists
 * is a primitive nobody can remove.
 */
export interface JobRequest<P extends JobPayload = JobPayload> {
  /** The queue this job belongs to. It must already exist; see `declareQueue`. */
  readonly queue: string;
  readonly payload: P;
  /**
   * The idempotency key. At most one job with this key is queued at a time, and
   * a second enqueue under a live key returns `null` rather than a second job.
   */
  readonly key?: string;
  /** Do not run before this instant. Stored UTC, per the corpus convention. */
  readonly notBefore?: Date;
  /** Retries after the first failure. */
  readonly retryLimit?: number;
  /** Whole seconds between retries. Integer, because there are no floats here. */
  readonly retryDelaySeconds?: number;
}

/** One job, as it reaches a consumer. */
export interface DeliveredJob<P extends JobPayload = JobPayload> {
  readonly id: JobId;
  readonly queue: string;
  readonly payload: P;
}

/**
 * A consumer.
 *
 * ONE JOB PER CALL, not a batch, and the adapter is what flattens. pg-boss hands
 * its handler an ARRAY even at the default batch size of one; BullMQ hands one
 * job. A one-job signature is the shape both can serve, so the batch is the
 * adapter's business rather than the interface's.
 *
 * A handler that RESOLVES completes the job and a handler that THROWS fails it,
 * which is both queues' contract and is stated here because it is the only part
 * of the consumer's semantics that is not visible in the type.
 */
export type JobHandler<P extends JobPayload = JobPayload> = (job: DeliveredJob<P>) => Promise<void>;

/**
 * The job interface. FIVE METHODS, and the count is asserted rather than
 * described (`test/surface.test.ts`).
 *
 * ADR-006 made this narrowness a review criterion, and a criterion with no
 * artifact and no number is a sentence. The number is here so that the sixth
 * method is a diff somebody has to defend.
 */
export interface JobQueue {
  /**
   * Register a queue.
   *
   * IT EXISTS BECAUSE pg-boss REFUSES AN UNDECLARED QUEUE and BullMQ does not,
   * so the narrower interface is the one that HAS this method: a BullMQ adapter
   * implements it as a no-op, while a pg-boss adapter cannot invent it. An
   * interface without it would be expressible on Redis and unimplementable on
   * Postgres, which is the wrong direction for a system whose queue is ruled.
   */
  declareQueue(queue: string): Promise<void>;

  /**
   * Enqueue one job INSIDE the caller's transaction.
   *
   * Returns the job's id, or `null` when `key` matched a job already queued.
   *
   * THE TRANSACTION IS THE FIRST ARGUMENT AND IT IS NOT OPTIONAL. See this
   * file's header: this is the one primitive on the interface that a Redis
   * backend cannot honour, it is admitted on ADR-006's ruling, and it is in the
   * required position so that no caller reaches the unsafe form by leaving
   * something out.
   */
  enqueue<P extends JobPayload>(tx: JobTransaction, request: JobRequest<P>): Promise<JobId | null>;

  /** Attach a consumer to a queue. */
  consume<P extends JobPayload>(queue: string, handler: JobHandler<P>): Promise<void>;

  /** Begin polling and maintenance. */
  start(): Promise<void>;

  /** Stop polling and maintenance, and release whatever the adapter holds. */
  stop(): Promise<void>;
}

/**
 * The methods `JobQueue` declares, as data.
 *
 * READ BY THE SURFACE TEST RATHER THAN RESTATED BY IT. ADR-006's narrowness
 * criterion is checkable only against a list something can count, and a list
 * written twice is the drift class this corpus keeps finding (ADR-034). An
 * interface is erased at runtime, so the list lives here and the adapter is
 * asserted to implement exactly it, in both directions.
 */
export const JOB_QUEUE_METHODS = [
  'declareQueue',
  'enqueue',
  'consume',
  'start',
  'stop',
] as const satisfies readonly (keyof JobQueue)[];

/** Resolves only when `T` is `never`. The `satisfies` above checks one direction. */
type AssertNever<T extends never> = T;

/**
 * TOTALITY IS A COMPILE ERROR, in the direction `satisfies` cannot check.
 *
 * `satisfies readonly (keyof JobQueue)[]` rejects a name that is not a method.
 * This alias rejects a METHOD THAT IS NOT A NAME: add a sixth method to
 * `JobQueue` and leave the list at five, and `Exclude` stops being `never` and
 * this line fails to resolve. Without it the surface test would count five and
 * report five while the interface carried six, which is a gate asserting its own
 * input (ADR-084 section 7 is what that costs).
 */
export type EveryJobQueueMethodIsListed = AssertNever<
  Exclude<keyof JobQueue, (typeof JOB_QUEUE_METHODS)[number]>
>;
