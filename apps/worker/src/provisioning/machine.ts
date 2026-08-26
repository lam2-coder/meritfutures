// =============================================================================
// apps/worker/src/provisioning/machine.ts
// =============================================================================
// M02 SECTION 3.2's MACHINE, TOTAL, WITH REFUSAL AS THE SEED RATHER THAN AS A
// BRANCH.
//
//   [*]      -> queued
//   queued   -> written             (file built, idempotent name assigned)
//   written  -> delivered           (SFTP upload returned success)
//   written  -> failed              (SFTP error)
//   delivered-> confirmed           (G-VENDOR-CONFIRMED, ack artifact)
//   delivered-> confirmed_inferred  (G-INFERRED, account appears in next EOD)
//   delivered-> failed              (no ack and no inference within the window)
//   failed   -> queued              (operator retry, same payload_hash, same file name)
//   confirmed, confirmed_inferred   -> [*]
//
// -----------------------------------------------------------------------------
// WHY THE TABLE IS A MAP OF PERMITTED EDGES AND NOT A SWITCH OF REFUSED ONES
// -----------------------------------------------------------------------------
// A `switch` that refuses the edges somebody thought of admits every edge
// nobody did, and the edge nobody thinks of on this machine is
// `queued -> confirmed`: an intent confirmed without ever having been written
// or delivered, which under `INV-M2-13` is an account admitted to trading on a
// setpoint that was never sent. So the table below lists what is PERMITTED, and
// `advance` answers `refused` for everything else including every status pair a
// later enum member would create.
//
// THE BINDING RULE IS ENFORCED TWICE ON PURPOSE. `set_risk` may never reach
// `confirmed_inferred` (AS-M2-03, INV-M2-13, INV-M2-15) and the database
// already refuses it: `provisioning_queue_set_risk_never_inferred` in `0007` is
// `operation <> 'set_risk' OR status <> 'confirmed_inferred'`. This file
// refuses it as well, and the duplication is deliberate rather than redundant:
// the CHECK fires at the moment of the write and this fires at the moment of
// the DECISION, and a saga that decided to write it and was stopped by the
// database is a saga whose next line is a caught exception rather than a
// refusal it planned for.

import type { ProvisioningOperation, ProvisioningStatus } from './vocabulary.ts';

/**
 * The permitted edges, by source status.
 *
 * TOTAL OVER `ProvisioningStatus` BY THE TYPE, so a seventh enum member added
 * to `0001` is a compile error here rather than a status with no row. The two
 * terminal states carry an EMPTY list rather than being absent, for the same
 * reason: absence and "nothing may follow" are different claims and only one of
 * them is checkable.
 */
export const PERMITTED_TRANSITIONS: {
  readonly [S in ProvisioningStatus]: readonly ProvisioningStatus[];
} = {
  queued: ['written'],
  written: ['delivered', 'failed'],
  delivered: ['confirmed', 'confirmed_inferred', 'failed'],
  // M02 section 3.2: `failed --> queued: operator retry, same payload_hash,
  // same file name`. It is the one edge that moves BACKWARDS and the two
  // "same"s are what keep it from being a second intent.
  failed: ['queued'],
  confirmed: [],
  confirmed_inferred: [],
};

/** The statuses a row can still move out of. DERIVED, so it cannot disagree. */
export const LIVE_STATUSES: readonly ProvisioningStatus[] = (
  Object.keys(PERMITTED_TRANSITIONS) as ProvisioningStatus[]
).filter((s) => PERMITTED_TRANSITIONS[s].length > 0);

/** Why a transition was refused. A closed set, so a refusal is a value and not a sentence. */
export const TRANSITION_REFUSALS = [
  /** The machine has no such edge, including every edge out of a terminal state. */
  'not_a_permitted_edge',
  /** AS-M2-03, INV-M2-13. `set_risk` may never reach `confirmed_inferred`. */
  'set_risk_may_never_be_inferred',
] as const;

export type TransitionRefusal = (typeof TRANSITION_REFUSALS)[number];

export type Transition =
  | { readonly permitted: true; readonly from: ProvisioningStatus; readonly to: ProvisioningStatus }
  | {
      readonly permitted: false;
      readonly from: ProvisioningStatus;
      readonly to: ProvisioningStatus;
      readonly refusal: TransitionRefusal;
    };

/**
 * One step of the machine, for one operation.
 *
 * THE OPERATION IS A REQUIRED ARGUMENT AND NOT AN OPTIONAL ONE, because the one
 * rule that distinguishes the operations is the one whose absence is silent:
 * an unenforced `set_risk -> confirmed_inferred` is an account believed
 * protected on evidence that says nothing about whether the risk setting
 * applied. A caller that does not have the operation to hand does not have
 * enough to decide.
 */
export function advance(
  operation: ProvisioningOperation,
  from: ProvisioningStatus,
  to: ProvisioningStatus,
): Transition {
  if (operation === 'set_risk' && to === 'confirmed_inferred') {
    return { permitted: false, from, to, refusal: 'set_risk_may_never_be_inferred' };
  }
  if (!PERMITTED_TRANSITIONS[from].includes(to)) {
    return { permitted: false, from, to, refusal: 'not_a_permitted_edge' };
  }
  return { permitted: true, from, to };
}
