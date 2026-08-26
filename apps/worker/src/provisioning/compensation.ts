// =============================================================================
// apps/worker/src/provisioning/compensation.ts
// =============================================================================
// A SAGA IS COMPENSATION, AND COMPENSATION IS WHERE MONEY PATHS ROT. So this
// file states which steps are compensatable, which are not, and what happens
// when compensation itself fails, rather than leaving any of the three to be
// discovered.
//
// -----------------------------------------------------------------------------
// 1. NOTHING HANDED TO THE VENDOR IS ROLLED BACK. EVER.
// -----------------------------------------------------------------------------
// The queue's whole subject is an intent Merit has SENT. Once a file is on the
// vendor's SFTP endpoint the act is theirs, and there is no operation in
// `provisioning_queue.operation`'s CHECK list that un-sends one. So
// "compensation" here means A FORWARD OPERATION THAT COUNTERACTS AN EARLIER
// ONE, never an undo, and the table below is an inverse map over a vocabulary
// that is mostly not invertible.
//
// -----------------------------------------------------------------------------
// 2. FIVE OF THE SEVEN OPERATIONS HAVE NO INVERSE, AND THAT IS WHY THE EXIT
//    MATTERS MORE THAN THIS FILE
// -----------------------------------------------------------------------------
// `create_account` has `disable_account` and `set_entitlement` has
// `disable_entitlement`. The other five do not, for three different reasons,
// each recorded on its row below. A saga that could compensate everything would
// be safe because it could undo; this one is safe because it cannot ADMIT --
// `admission.ts`'s exit requires positive evidence, and no compensation
// outcome, including compensation failing outright, ever produces any.
//
// **THAT IS THE PROPERTY THIS FILE IS FOR AND IT IS ASSERTED RATHER THAN
// ARGUED.** For every `CompensationOutcome` below, `admitToTrading` still
// refuses. Compensation failing degrades to "not admitted", which is the state
// the account was already in.
//
// -----------------------------------------------------------------------------
// 3. THERE IS NO PARTIAL ROLLBACK AND ADR-102 FORECLOSED IT
// -----------------------------------------------------------------------------
// ADR-102 section 8 item 5: "Nested transactions are foreclosed. No savepoint,
// no partial rollback inside a callback. A saga that wants to compensate one
// step without abandoning the transaction cannot, and `P3-l`'s compensation
// path is the first place that could bite." It bit exactly there and the
// consequence is the shape of `saga.ts`: **each step's local write is its own
// transaction**, and the saga is a SEQUENCE of transactions rather than one.
//
// That does not weaken ADR-006's guarantee, which is about one step: the
// `provisioning_queue` INSERT and the job enqueue ride ONE transaction, so
// "committed the purchase, lost the provisioning job" cannot happen. What it
// means is that ACROSS steps the saga can be interrupted between two committed
// transactions, which is what makes it a saga at all and what compensation is
// for.

import type { ProvisioningOperation } from './vocabulary.ts';

/**
 * The inverse of each operation within the queue's own vocabulary, or `null`.
 *
 * TOTAL OVER `ProvisioningOperation` BY THE TYPE. An eighth member added to
 * `0007`'s CHECK is a compile error here rather than an operation whose
 * compensation is silently nothing.
 */
export const COMPENSATING_OPERATION: {
  readonly [O in ProvisioningOperation]: ProvisioningOperation | null;
} = {
  // NO INVERSE, AND THE VOCABULARY IS RIGHT NOT TO HAVE ONE. A platform login
  // is per human and is shared across every account that human holds
  // (`SD-M2-05`: the vendor bills per login-month per USER while the row stays
  // per account). Deleting a user to compensate one account's provisioning
  // would revoke every other account that user holds.
  create_user: null,

  // M02 section 3.6's revocation leg, and the ORDER there is the reason this
  // one is second rather than first: `disable_entitlement` then
  // `disable_account`, "fail-closed on the way out ... if the second operation
  // fails the account is already unable to reach the platform".
  create_account: 'disable_account',

  // NO INVERSE, AND ATTEMPTING ONE WOULD BE THE FAILURE. A risk floor is a
  // SETPOINT rather than an act: the compensation for a wrong floor is another
  // `set_risk` carrying the right one, which is a re-push and not an undo, and
  // "undoing" a setpoint by pushing the previous value is how an account ends
  // up enforced at a floor nobody currently believes in. INV-M2-08 says the
  // pushed setting equals the account's CURRENT floor; there is no earlier
  // floor to return to that satisfies it.
  set_risk: null,

  set_entitlement: 'disable_entitlement',

  // NO INVERSE. The permission set is absolute rather than incremental, so its
  // compensation is another `set_permissions` naming the correct set, which is
  // the same argument as `set_risk` and has the same answer.
  set_permissions: null,

  // THESE TWO ARE THE COMPENSATIONS. Nothing compensates them, because failing
  // to disable an account is not repaired by re-enabling it, and M02 section
  // 3.6.3 is why the asymmetry is admitted rather than smoothed: "Revocation is
  // always available. Restoration is contingent on `V-M2-15`."
  disable_account: null,
  disable_entitlement: null,
};

/** What became of one step's compensation. A closed set. */
export type CompensationOutcome =
  /** The step never ran. There is nothing to counteract. */
  | { readonly kind: 'not_reached' }
  /**
   * The step's write never committed, so the transaction did the whole job.
   *
   * THE ONLY TRUE ROLLBACK IN THIS FILE, and it is available only while the
   * transaction is open. ADR-006's transactional enqueue is what makes it
   * total: the row and the job are on one connection, so an abandoned
   * transaction loses both or neither.
   */
  | { readonly kind: 'rolled_back' }
  /** A counteracting intent was enqueued. It is an intent, not an outcome. */
  | {
      readonly kind: 'compensating_enqueued';
      readonly operation: ProvisioningOperation;
      readonly compensating: ProvisioningOperation;
    }
  /** The operation has no inverse in the vocabulary. Named, never silent. */
  | { readonly kind: 'uncompensatable'; readonly operation: ProvisioningOperation }
  /**
   * The compensating enqueue itself failed.
   *
   * THE ACCOUNT IS NOT ADMITTED AND THAT IS THE WHOLE ANSWER TO "what happens
   * when compensation fails". It is not admitted because admission needs
   * evidence and this produced none, rather than because something noticed the
   * failure and blocked. The failure is recorded so an operator can retry it;
   * nothing waits on the retry to stay safe.
   */
  | {
      readonly kind: 'compensation_failed';
      readonly operation: ProvisioningOperation;
      readonly compensating: ProvisioningOperation;
      readonly cause: string;
    };

/**
 * The plan for one step, decided before anything is attempted.
 *
 * DECIDED BEFORE, because a compensation chosen while handling a failure is a
 * compensation chosen by whoever was on call.
 */
export function compensationFor(operation: ProvisioningOperation): ProvisioningOperation | null {
  return COMPENSATING_OPERATION[operation];
}

/**
 * The revocation order, M02 section 3.6.
 *
 * `disable_entitlement` BEFORE `disable_account`, and the plan states the
 * reason as a property rather than a preference: "The entitlement is what costs
 * money and what carries the platform login, so it goes first; if the second
 * operation fails the account is already unable to reach the platform."
 *
 * SO A COMPENSATION SET IS SORTED BY THIS ORDER RATHER THAN BY THE ORDER THE
 * STEPS RAN IN. Reversing the forward order would give `disable_account` first,
 * which leaves a live entitlement behind on the failure this ordering exists
 * for.
 */
export const REVOCATION_ORDER: readonly ProvisioningOperation[] = [
  'disable_entitlement',
  'disable_account',
];

/**
 * Where one compensating operation sits in M02 section 3.6's order.
 *
 * An operation the revocation order does not name ranks LAST rather than
 * first. It is not a revocation, so it must not preempt one.
 */
export function revocationRank(operation: ProvisioningOperation): number {
  const i = REVOCATION_ORDER.indexOf(operation);
  return i === -1 ? REVOCATION_ORDER.length : i;
}

/**
 * Sort a set of compensating operations into M02 section 3.6's order.
 *
 * `Array.prototype.sort` IS STABLE in every engine this runs on, so two
 * compensations of equal rank keep the order their steps ran in. That matters
 * when one account contributes two `set_entitlement` steps: they compensate in
 * the order they were applied rather than in an order the sort invented.
 */
export function inRevocationOrder(
  operations: readonly ProvisioningOperation[],
): readonly ProvisioningOperation[] {
  return [...operations].sort((a, b) => revocationRank(a) - revocationRank(b));
}
