// =============================================================================
// packages/psp/src/routing.ts
// =============================================================================
// FAILOVER IS PART OF THE PORT AND NOT PART OF A ROUTE.
//
// API_CONTRACT section 5 lists `service_unavailable` on `POST /checkout` with
// one meaning: "both MIDs unhealthy". A route that computed that for itself
// would be a route that knows what a MID is, and the next surface that needs to
// open a session would compute it again.
//
// -----------------------------------------------------------------------------
// THE ONE SENTENCE M03 SECTION 3.2 CALLS THE MOST IMPORTANT IN IT
// -----------------------------------------------------------------------------
//   "Failover is per-attempt routing, never mid-transaction. A session already
//    created at PSP-A is completed at PSP-A or it fails; Merit does not retry
//    the same purchase at PSP-B, because the buyer's card may have been charged
//    and the provider may simply be slow to say so. A new attempt is a new
//    session with a new idempotency key. RETRYING A PAYMENT AT A DIFFERENT
//    PROVIDER IS HOW ONE PURCHASE BECOMES TWO CHARGES, and the resulting
//    chargeback damages the MID health it was trying to protect (AS-M3-02)."
//
// THE FUNCTION IS NAMED FOR THE ONLY MOMENT A CHOICE IS LEGITIMATE, and there
// is deliberately no second function taking an existing session, a purchase, or
// a previous choice. The absence is the control: a caller that wants to move a
// live session between providers finds nothing here to call, which is a compile
// error rather than an incident.
//
// -----------------------------------------------------------------------------
// IT TAKES THE STATE, IT DOES NOT COMPUTE IT
// -----------------------------------------------------------------------------
// SD-M3-03: "failover needs a DECISION RECORD, not a live computation. A
// routing decision that cannot be explained after the fact is one nobody will
// trust during an incident." `mid_health` is that record, its `state` column is
// CHECKed to the three members below, and its rates are computed against CARD
// VOLUME rather than total volume for the reason `0006_commerce.sql` spells out
// at length. None of that is this function's business. This function is the
// rule that reads the record, it is pure, and it is total.
// =============================================================================

import type { PspId } from './port.ts';

/**
 * `mid_health.state`, verbatim from
 * [`0006_commerce.sql`](../../db/migrations/0006_commerce.sql):
 * `CHECK (state IN ('healthy', 'degraded', 'unhealthy'))`.
 */
export type MidState = 'healthy' | 'degraded' | 'unhealthy';

/** One MID's current decision record, as `mid_health`'s latest window holds it. */
export interface MidCandidate {
  readonly psp: PspId;
  readonly state: MidState;
}

/**
 * `service_unavailable`, and it is the ONLY case that produces it.
 *
 * INV-M3-11: "the two MIDs are never both required for a purchase to succeed,
 * and neither is ever required to be up". A single unhealthy MID routes to the
 * other one and the buyer never learns anything happened; both unhealthy is the
 * one state Merit cannot serve, and it maps to the 503 the contract defines.
 */
export class BothMidsUnhealthyError extends Error {
  /** The candidates as they were read, so an incident has its inputs. */
  readonly candidates: readonly MidCandidate[];
  /** The contract code a route turns this into. API_CONTRACT section 2. */
  readonly code = 'service_unavailable';

  constructor(candidates: readonly MidCandidate[]) {
    super(
      `no MID can take a new attempt: ${candidates
        .map((c) => `${c.psp}=${c.state}`)
        .join(', ')}. INV-M3-11, API_CONTRACT section 5 service_unavailable.`,
    );
    this.name = 'BothMidsUnhealthyError';
    this.candidates = candidates;
  }
}

/** `healthy` beats `degraded`; `unhealthy` is not a candidate at all. */
const PREFERENCE: Readonly<Record<MidState, number>> = { healthy: 0, degraded: 1, unhealthy: 2 };

/**
 * Choose the MID for a NEW attempt. Never for an existing session.
 *
 * DETERMINISTIC, AND THAT IS A DECISION RATHER THAN AN OMISSION. There is no
 * randomness and no round robin here: at equal state the earlier candidate
 * wins, so a caller that wants to spread volume orders the array itself and the
 * spreading policy stays where somebody can read it. A router that shuffled
 * internally would make "why did this purchase go to PSP-B" unanswerable, which
 * is the property SD-M3-03 exists to preserve.
 *
 * IT DOES NOT PROBE. `health()` on the adapter is a reachability probe and this
 * function never calls it: a routing decision made from a live probe is a
 * decision with no record, and it would put a network round trip inside
 * checkout's transaction.
 *
 * @throws {BothMidsUnhealthyError} when no candidate is `healthy` or `degraded`.
 */
export function chooseMidForNewAttempt(candidates: readonly MidCandidate[]): PspId {
  let best: MidCandidate | undefined;
  for (const candidate of candidates) {
    if (candidate.state === 'unhealthy') continue;
    if (best === undefined || PREFERENCE[candidate.state] < PREFERENCE[best.state]) {
      best = candidate;
    }
  }
  if (best === undefined) throw new BothMidsUnhealthyError(candidates);
  return best.psp;
}
