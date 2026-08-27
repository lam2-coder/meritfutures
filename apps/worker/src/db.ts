// =============================================================================
// apps/worker/src/db.ts
// =============================================================================
// THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/db`, AND THE ADMISSION
// THAT LETS IT IS A RULING RATHER THAN A LINE. ADR-165.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A FILE HERE AT ALL, RATHER THAN AN IMPORT IN EACH ADAPTER
// -----------------------------------------------------------------------------
// `RI-08` guards the MANIFEST and says so in its own `covers`: it does not read
// source, and the day `@merit/worker` joined `DB_ADMITTED` is the day this
// deployable acquired the capability everywhere at once. A reviewer asking
// "where does apps/worker reach the database" should get one answer with a path
// in it, and `grep -rln '@merit/db' apps/worker/src` returning exactly this file
// is that answer.
//
// `apps/api/src/db.ts` STATES THE SAME THING AND CALLS IT "a convention and not
// a control", because nothing there checks it. HERE IT IS CHECKED:
// `test/db.test.ts` walks this deployable's `src/` tree and asserts the name
// occurs in one file. That is a small thing and it is the difference between a
// convention and an assertion, and the identical assertion does NOT exist for
// `apps/api`, which is reported rather than repaired because that file is
// outside this slice's fence.
//
// -----------------------------------------------------------------------------
// ONE DOOR, AND THE OTHER THREE ARE ABSENT ON PURPOSE
// -----------------------------------------------------------------------------
// `batch(fn)`   every read and every write a scheduled job makes.
//
// THERE IS NO `scoped(identityId, fn)` AND ITS ABSENCE IS THE POINT. A request
// handler resolves a caller and acts on that caller's behalf; a scheduled job
// has nobody to resolve. `CRON_INVENTORY`'s scheduled-work table is this
// deployable's whole subject and not one of its rows arrives with an identity:
// the nightly batch partitions across every account that has ever existed, the
// ledger assertions are firm-wide by construction, and a detector run reads
// `fills` and `identity_links` ACROSS identities, which is the one thing a
// per-identity scope cannot express. A `scoped` door here would be a door
// somebody uses, and the only way to reach it would be to invent an identity
// out of a row this deployable just read, which is the shape `apps/api/src/db.ts`
// puts a UUID guard in front of precisely because it is dangerous.
//
// THERE IS NO `firm(fn)` AND THE REASON IS SUBSUMPTION RATHER THAN POLICY.
// `SystemTx.rows` and `SystemTx.insert` are declared over `TableKey`, which
// contains `FirmTableKey`, so every row a `FirmTx` could reach is already
// reachable through the one door below. A second door would buy nothing and
// cost a word somebody could use.
//
// THERE IS NO REASON PARAMETER, AND THAT IS WHAT FORECLOSES `'operator-console'`
// FROM THIS DEPLOYABLE. `SystemReason` has exactly two members and this file
// spends one of them at the call site rather than accepting it as an argument,
// so the operator reason is unreachable from `apps/worker` BY CONSTRUCTION and
// not by convention: there is no argument position a caller could put it in.
// **`SystemReason` GAINED NO MEMBER.** `'nightly-batch'` already names what a
// detector run, a fold, a sweep and a nightly assertion each are, and a third
// member taken for the detector service would be the vocabulary joining itself
// (P7 section 8, `P7-a`). `systemDb`'s own docstring in `packages/db` justifies
// `'nightly-batch'` by citing THIS deployable's `batch/ports.ts`, so the word
// was written for this caller before this caller could name the package the
// word lives in.
//
// -----------------------------------------------------------------------------
// THERE IS NO CAST HERE AND NOTHING TO GUARD
// -----------------------------------------------------------------------------
// `apps/api/src/db.ts` carries the workspace's one `IdentityId` assertion and a
// UUID check in front of it, because a scoped door takes a string that has to
// BE an identity. This door takes no argument at all. There is nothing to
// validate, nothing to assert past, and no malformed value that could reach a
// predicate and read like an empty account. That is a property of the door's
// SHAPE rather than of any discipline at the call sites.
//
// -----------------------------------------------------------------------------
// WHY THE DOOR IS AN INTERFACE AND NOT A FREE FUNCTION
// -----------------------------------------------------------------------------
// `transaction()` opens a real connection out of a real pool the first time it
// is called and `client()` throws when `DATABASE_URL` is unset, so every adapter
// in this deployable would be untestable except against a live database.
// `ci.yml`'s `integration` job has none (ADR-102 section 16, ADR-112 section 9).
// So the door is a parameter with a live default and a suite substitutes a
// recorder, which is `apps/api/src/db.ts`'s seam applied one deployable over.
//
// WHAT THAT SEAM CAN AND CANNOT PROVE. A recorder proves which key was named,
// which address was written, which values were set and which reason the handle
// carried. It proves NOTHING about whether the composed predicate reaches one
// row or many, because that is `packages/db`'s and is asserted in
// `packages/db/test/keyed-accessor.test.ts`. A case here that claimed it would
// be agreeing with its own fake.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO, AND MUST NOT GROW
// -----------------------------------------------------------------------------
// It does not import `pg` (`merit/no-raw-db-client` is attached to `apps/**`
// and this path is inside it), it does not import `drizzle-orm`, it reaches for
// no `sqlExecutor`, and it casts past no key type. P7 section 11 rule 10:
// `packages/db/src/scoped-db.ts` is `P5-a`'s file and no P7 slice moves it. If a
// detector needs a shape the accessor does not offer -- and ADR-157 section 5
// REFUSED the aggregate P7 asked for, on the evidence that a detector's blocker
// is the JOIN rather than the aggregate -- that is a finding for a pull-request
// body and a stop, not a widening here.
// =============================================================================

import { systemDb, transaction } from '@merit/db';
import type { SystemDb, SystemReason, SystemTx } from '@merit/db';

/**
 * The one reason this deployable ever runs at, spelled once.
 *
 * TYPED AS `SystemReason` RATHER THAN INFERRED AS A LITERAL, so a member
 * disappearing from that union is a compile error here rather than a silent
 * widening. It is `as const` as well, so the value stays a literal for anything
 * that compares against it.
 */
export const WORKER_REASON: SystemReason = 'nightly-batch' as const;

/**
 * The handle this deployable's one door is opened with.
 *
 * SEPARATE FROM `LIVE_DB` BECAUSE IT IS THE HALF THAT IS ASSERTABLE WITHOUT A
 * DATABASE. `systemDb(reason)` builds a value and connects nothing; the
 * connection is `transaction()`'s. So a suite can read the reason this
 * deployable would have run at without a `DATABASE_URL`, which is the only
 * property of this file that could silently become `'operator-console'`.
 */
export function workerHandle(): SystemDb {
  return systemDb(WORKER_REASON);
}

/**
 * The one door this deployable opens onto the trader database.
 *
 * It takes the whole unit of work rather than handing back a handle, so a
 * transaction cannot outlive the function that opened it and no caller has a
 * `commit` to forget.
 */
export interface WorkerDb {
  /**
   * Everything a scheduled job reads and writes.
   *
   * NO IDENTITY AND NO REASON, and both absences are the ruling rather than a
   * simplification. The header says why.
   */
  batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T>;
}

/**
 * The door, opened onto the real pool.
 *
 * One line of delegation, which is the whole of what this package adds to the
 * accessor. There is no guard because there is no argument to guard.
 */
export const LIVE_DB: WorkerDb = {
  batch<T>(fn: (tx: SystemTx) => Promise<T>): Promise<T> {
    return transaction(workerHandle(), fn);
  },
};
