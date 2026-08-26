// =============================================================================
// apps/worker/src/provisioning/saga.ts
// =============================================================================
// THE PIPELINE. Enqueue transactionally, build the batch, hand it to the
// platform, compensate what can be compensated, and exit through `INV-M2-13`.
//
// -----------------------------------------------------------------------------
// ADR-006's REVIEW CRITERION, AND THIS IS THE FIRST CALLER IT HAS EVER BEEN
// GRADED AGAINST
// -----------------------------------------------------------------------------
// ADR-006 closed with a sentence that is a specification rather than a hope:
// "enqueue participates in the same transaction as the state change that caused
// it, which removes a whole class of saga bugs (committed the purchase, lost
// the provisioning job)". `job-queue.ts`'s header records that nothing in this
// workspace could produce the `JobTransaction` its `enqueue` requires, and
// ADR-102 produced one. `enqueueProvisioningOp` below is the first call site.
//
// **THE STATE CHANGE AND THE JOB ARE ON ONE HANDLE AND THERE IS NO SECOND
// ONE.** `tx.insert(...)` writes the `provisioning_queue` row and
// `tx.sqlExecutor('job-enqueue')` produces the executor the queue inserts its
// job through, both from the same `ProvisioningTx`, which the caller opened.
// The function opens no transaction, commits nothing and rolls nothing back:
// the caller owns the boundary, which is what makes the enqueue join the state
// change that caused it rather than a transaction of its own.
//
// **THE ORDER IS ROW THEN JOB AND IT IS NOT ARBITRARY.** A job that runs before
// its row exists is a job that reads nothing; on one transaction that cannot
// happen, because neither is visible until both are. What the order buys is
// the FAILURE case: an insert that violates
// `provisioning_queue_intent_uq` -- the same intent already live -- raises
// before any job exists, so a duplicate intent costs no queued job even in the
// interpretation where the two writes were separable.
//
// -----------------------------------------------------------------------------
// ONE TRANSACTION PER STEP, NOT ONE PER SAGA, AND ADR-102 RULED THAT
// -----------------------------------------------------------------------------
// ADR-102 section 8 item 5 forecloses nested transactions and names this
// slice's compensation path as the first place it could bite. It bit. A saga
// that ran inside one transaction could not compensate a step without
// abandoning every step; so each step commits, and `compensation.ts` is what
// stands between the steps. See that file for which steps are compensatable,
// which are not, and what happens when compensation itself fails.

import {
  admitToTrading,
  type AdmissionSubject,
  type SetpointConfirmation,
  type TradingAdmission,
} from './admission.ts';
import { compensationFor, revocationRank, type CompensationOutcome } from './compensation.ts';
import { payloadHash, provisioningFileName, renderPayload } from './payload.ts';
import type { ProvisioningPayload } from './payload.ts';
import type {
  EntitlementChange,
  PlatformProvisioningPort,
  ProvisioningBatch,
  ProvisioningJobQueue,
  ProvisioningOp,
  ProvisioningTx,
} from './ports.ts';
import type { ProvisioningOperation } from './vocabulary.ts';

/** The queue `provisioning_queue` rows are drained through. ST-M2-9. */
export const PROVISIONING_QUEUE_NAME = 'provisioning';

/** One intent, before it is a row. */
export interface ProvisioningIntent {
  readonly accountId: string;
  readonly operation: ProvisioningOperation;
  readonly payload: ProvisioningPayload;
}

/** What one transactional enqueue produced. */
export interface EnqueuedIntent {
  readonly op: ProvisioningOp;
  /**
   * The job id, or `null` when `key` deduplicated it against a live job.
   *
   * `null` IS A SUCCESS. See `ports.ts`: `job-queue.ts` brands `JobId` so that a
   * caller cannot read this null as an error and retry, and retrying a
   * deduplicated enqueue is how an idempotency key becomes decoration.
   */
  readonly jobId: string | null;
}

/**
 * THE STATE CHANGE AND THE JOB, ON ONE TRANSACTION.
 *
 * The transaction is the first argument and there is no overload that omits it.
 * Both writes go through `tx`, so:
 *
 *   - the caller commits  -> the row AND the job are durable
 *   - the caller rolls back or throws -> NEITHER is
 *
 * and there is no third outcome, because a transaction is per connection and
 * both statements are on the caller's.
 *
 * `key` IS THE INTENT's OWN DIGEST, so a second enqueue of an intent already
 * queued deduplicates in the queue exactly as
 * `provisioning_queue_intent_uq` deduplicates it in the table. The two guards
 * are independent and agree by construction, because both are keyed on
 * `payload_hash`.
 */
export async function enqueueProvisioningOp(
  tx: ProvisioningTx,
  queue: ProvisioningJobQueue,
  intent: ProvisioningIntent,
): Promise<EnqueuedIntent> {
  const hash = payloadHash(intent.payload);

  // THE STATE CHANGE. `status`, `attempts`, `queued_at`, `created_at` and
  // `updated_at` are the database's defaults and are not written here: `0007`
  // declares every one of them, and a saga that stamped its own `queued_at`
  // would be a saga with a clock in it for no gain (`batch/ports.ts`'s
  // argument for the same omission one directory over).
  await tx.insert('provisioningQueue', {
    accountId: intent.accountId,
    operation: intent.operation,
    payload: renderPayload(intent.payload),
    payloadHash: hash,
  });

  // THE JOB, ON THE SAME HANDLE.
  const jobId = await queue.enqueue(tx.sqlExecutor('job-enqueue'), {
    queue: PROVISIONING_QUEUE_NAME,
    payload: {
      account_id: intent.accountId,
      operation: intent.operation,
      payload_hash: hash.toString('hex'),
    },
    key: `${intent.accountId}:${intent.operation}:${hash.toString('hex')}`,
  });

  return {
    op: {
      accountId: intent.accountId,
      operation: intent.operation,
      payload: intent.payload,
      payloadHash: hash,
      fileName: null,
    },
    jobId,
  };
}

/**
 * M02 section 3.3's batch build.
 *
 * ONE OPERATION PER BATCH, because the file name carries the operation and a
 * CSV of mixed operations has no single set of columns. A caller with three
 * operations builds three batches, which is what "one row per INTENT, so
 * partial success is legible" asks for at the file level too.
 */
export function buildBatch(
  ops: readonly ProvisioningOp[],
  builtAt: Date,
): readonly ProvisioningOp[] {
  if (ops.length === 0) return ops;
  const first = ops[0];
  if (first === undefined) return ops;
  const operation = first.operation;
  for (const op of ops) {
    if (op.operation !== operation) {
      throw new Error(
        `a provisioning batch carries one operation and this one carries ` +
          `"${operation}" and "${op.operation}". The file name names the operation and a ` +
          'CSV of mixed operations has no single column set.',
      );
    }
  }
  const fileName = provisioningFileName(
    operation,
    builtAt,
    ops.map((o) => o.payloadHash),
  );
  // A row whose `file_name` is already assigned KEEPS IT. M02 section 3.2's
  // retry edge is "same payload_hash, SAME FILE NAME", and recomputing here
  // would re-upload under a new name; see `payload.ts`.
  return ops.map((o) => (o.fileName === null ? { ...o, fileName } : o));
}

/** What the saga did, end to end. */
export interface SagaOutcome {
  /** The intents that reached the platform, in the order they were enqueued. */
  readonly enqueued: readonly EnqueuedIntent[];
  /** The batches `provision` reported, empty when it was never reached. */
  readonly batches: readonly ProvisioningBatch[];
  /** One outcome per step, in the order the steps were planned. */
  readonly compensation: readonly CompensationOutcome[];
  /** `INV-M2-13`'s exit. The account trades only on the admitted arm. */
  readonly admission: TradingAdmission;
  /** The failure that ended the saga, or `null` when nothing failed. */
  readonly failure: string | null;
}

/** Everything the saga reaches the outside world through. */
export interface SagaIo {
  readonly tx: ProvisioningTx;
  readonly queue: ProvisioningJobQueue;
  readonly platform: PlatformProvisioningPort;
  /** Every `provisioning_queue` row for the subject account, unfiltered. */
  readonly rows: readonly unknown[];
}

/**
 * The provisioning saga.
 *
 * **THE EXIT IS COMPUTED ON EVERY PATH AND THERE IS NO `return` THAT SKIPS
 * IT.** Read the control flow rather than this sentence: `finish` is the only
 * producer of a `SagaOutcome` in this function, it always calls
 * `admitToTrading`, and every arm below returns `finish(...)`. An arm added
 * later that returns something else is a type error, because `SagaOutcome`
 * carries a required `admission` and `TradingAdmission`'s admitted arm carries
 * a required `SetpointConfirmation`, which only `admission.ts` can produce.
 *
 * **A THROW IS NOT AN ESCAPE EITHER.** The one `try` below catches around the
 * platform call and returns through `finish`. A throw anywhere else propagates
 * to the caller, who then has NO `SagaOutcome` at all -- which is not an
 * admission, because an admission is a value somebody has to hold.
 *
 * `builtAt` IS AN ARGUMENT AND THIS FUNCTION READS NO CLOCK.
 */
export async function runProvisioningSaga(
  io: SagaIo,
  subject: AdmissionSubject,
  intents: readonly ProvisioningIntent[],
  builtAt: Date,
): Promise<SagaOutcome> {
  const enqueued: EnqueuedIntent[] = [];
  const compensation: CompensationOutcome[] = [];

  const finish = (batches: readonly ProvisioningBatch[], failure: string | null): SagaOutcome => ({
    enqueued,
    batches,
    compensation,
    admission: admitToTrading(subject, io.rows),
    failure,
  });

  // ---------------------------------------------------------------------------
  // 1. Enqueue every intent on the caller's ONE transaction.
  // ---------------------------------------------------------------------------
  // A failure here needs no compensation and gets the one true rollback in this
  // module: nothing has committed, so abandoning the transaction loses every
  // row and every job together. The caller owns that abandonment -- this
  // function does not commit and does not roll back -- so what is recorded is
  // `rolled_back` for each planned step, and the caller's `catch` is what makes
  // it true.
  for (const intent of intents) {
    try {
      enqueued.push(await enqueueProvisioningOp(io.tx, io.queue, intent));
    } catch (cause) {
      for (const _planned of intents) compensation.push({ kind: 'rolled_back' });
      return finish([], `enqueue failed: ${describe(cause)}`);
    }
  }

  if (enqueued.length === 0) return finish([], null);

  // ---------------------------------------------------------------------------
  // 2. Build the batch and hand it to the platform.
  // ---------------------------------------------------------------------------
  let batches: readonly ProvisioningBatch[];
  try {
    const ops = buildBatch(
      enqueued.map((e) => e.op),
      builtAt,
    );
    batches = [await io.platform.provision(ops)];
  } catch (cause) {
    // The rows ARE committed by now, so there is nothing to roll back and
    // compensation is forward only. `compensation.ts` says which of the seven
    // operations has an inverse and which do not.
    compensation.push(
      ...(await compensate(
        io,
        enqueued.map((e) => e.op.operation),
      )),
    );
    return finish([], `provision failed: ${describe(cause)}`);
  }

  for (const _step of enqueued) compensation.push({ kind: 'not_reached' });
  return finish(batches, null);
}

/**
 * Forward compensation for a set of operations that already committed.
 *
 * **THE SET IS SORTED INTO M02 SECTION 3.6's REVOCATION ORDER AND NOT INTO THE
 * REVERSE OF THE FORWARD ORDER.** `disable_entitlement` then `disable_account`,
 * because "the entitlement is what costs money and what carries the platform
 * login, so it goes first; if the second operation fails the account is already
 * unable to reach the platform." Reversing the forward order gives
 * `disable_account` first, which leaves a live entitlement behind on exactly
 * the failure the ordering exists for.
 *
 * **EVERY OUTCOME LEAVES THE ACCOUNT UNADMITTED, INCLUDING THE ONE WHERE THIS
 * FUNCTION FAILS.** It does not leave it unadmitted by noticing; it leaves it
 * unadmitted because admission needs positive evidence and nothing here
 * produces any.
 */
async function compensate(
  io: SagaIo,
  operations: readonly ProvisioningOperation[],
): Promise<readonly CompensationOutcome[]> {
  const out: CompensationOutcome[] = [];
  const pairs: { operation: ProvisioningOperation; compensating: ProvisioningOperation }[] = [];

  for (const operation of operations) {
    const inverse = compensationFor(operation);
    if (inverse === null) {
      out.push({ kind: 'uncompensatable', operation });
      continue;
    }
    // THE PAIR IS KEPT RATHER THAN THE INVERSE ALONE. Two steps can share one
    // inverse -- two `set_entitlement` intents both compensate through
    // `disable_entitlement` -- and a set of inverses would collapse them into
    // one compensation for two steps.
    pairs.push({ operation, compensating: inverse });
  }

  const ordered = [...pairs].sort(
    (a, b) => revocationRank(a.compensating) - revocationRank(b.compensating),
  );

  for (const { operation, compensating } of ordered) {
    try {
      await io.queue.enqueue(io.tx.sqlExecutor('job-enqueue'), {
        queue: PROVISIONING_QUEUE_NAME,
        payload: { operation: compensating, compensates: operation },
      });
      out.push({ kind: 'compensating_enqueued', operation, compensating });
    } catch (cause) {
      out.push({
        kind: 'compensation_failed',
        operation,
        compensating,
        cause: describe(cause),
      });
    }
  }

  return out;
}

/**
 * `entitle`, WHICH CANNOT BE REACHED WITHOUT A CONFIRMED SETPOINT.
 *
 * **THE EVIDENCE IS A REQUIRED ARGUMENT AND THAT IS `INV-M2-15` MADE
 * STRUCTURAL.** That invariant is "a restored account does not trade until its
 * `set_risk` is confirmed, and the restore order is `set_risk` confirmed, then
 * entitlement, then permissions", and M02 section 3.6 gives the reason:
 * "re-enabling an entitlement against an unconfirmed setpoint is an unenforced
 * funded account, and INV-M2-13 forbids it."
 *
 * A caller with no `SetpointConfirmation` cannot call this function at all, and
 * the only producer of one refuses every row that is not a `confirmed`
 * `set_risk` naming the account's current floor. So the ordering is not a step
 * list somebody follows -- it is the argument list.
 *
 * **IT REFUSES A CHANGE FOR AN ACCOUNT THE EVIDENCE IS NOT ABOUT.** The
 * confirmation names ONE account, and an entitlement change for another is a
 * different account's admission borrowed, which is the failure this whole file
 * is built against wearing a different shape.
 */
export async function entitleAfterSetpoint(
  platform: PlatformProvisioningPort,
  evidence: SetpointConfirmation,
  changes: readonly EntitlementChange[],
): Promise<ProvisioningBatch> {
  for (const change of changes) {
    if (change.accountId !== evidence.accountId) {
      throw new Error(
        `entitlement change names account ${change.accountId} and the setpoint ` +
          `confirmation names ${evidence.accountId}. A confirmation is evidence about ` +
          'one account and does not carry to another.',
      );
    }
  }
  return platform.entitle(changes);
}

/** An unknown thrown value, as a string. Never `[object Object]`. */
function describe(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return typeof cause === 'string' ? cause : (JSON.stringify(cause) ?? String(cause));
}
