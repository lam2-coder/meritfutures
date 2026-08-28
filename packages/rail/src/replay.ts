// =============================================================================
// packages/rail/src/replay.ts
// =============================================================================
// "A SETTLEMENT DELIVERED TWICE MUST SETTLE ONCE", AND THE CONTRACT ASKS FOR TWO
// DIFFERENT CONTROLS TO GET THERE. Reading API_CONTRACT section 10 slowly,
// because the sentence names both in one breath and they are not the same thing:
//
//   "... timestamp within a 5 minute window, NONCE RECORDED FOR REPLAY
//    PROTECTION, raw payload stored, PROCESSING IDEMPOTENT ON THE PROVIDER EVENT
//    ID, and A 200 RETURNED FOR DUPLICATES so providers stop retrying."
//
//   THE NONCE      refuses a CAPTURED DELIVERY re-presented by somebody who is
//                  not the rail. The exact bytes verify, and the window is still
//                  open, so the MAC and the clock both say yes. What says no is
//                  that this nonce has been seen. A refusal, and it is 401.
//   THE EVENT ID   recognises the RAIL'S OWN RETRY. A rail that did not hear the
//                  200 sends the same event again, with a FRESH nonce and a
//                  fresh timestamp because it re-signs each attempt. That is not
//                  an attack and refusing it is how a rail retries forever. It
//                  is 200 and stop, which is S-2.
//
// TELLING THEM APART IS THE WHOLE VALUE OF THIS FILE. Fold them together on the
// event id and a captured delivery inside the window reads as a retry and is
// answered 200 after being applied a second time. Fold them together on the
// nonce and a legitimate retry is answered 401 and the rail keeps sending.
// `test/replay.test.ts` drives both directions and each seed turns exactly one
// of them red.
//
// -----------------------------------------------------------------------------
// THIS IS NOT AN `IdempotencyStore` AND IT MUST NOT BECOME ONE
// -----------------------------------------------------------------------------
// `apps/api/src/idempotency.ts`'s `IdempotencyStore` finds a row by a key IN A
// SCOPE, claims it by INSERT, and STAMPS A RESPONSE onto that one row. Its
// question, whether the accessor can name one row to update, is session 307's
// and is in flight as `ADR-172`.
//
// NOTHING HERE STAMPS A RESPONSE, NOTHING HERE IS SCOPED TO AN IDENTITY, AND
// NOTHING HERE STORES A BODY. `record` answers one question about one delivery
// and returns an enum. It is the `(provider, provider_event_id)` UNIQUE INDEX
// expressed as a type a receiver must satisfy, and a receiver satisfying it with
// a database is satisfying it with an index rather than with a store. A store
// improvised on the payout rail is the defect session 303 refused on the cash
// door, and this file is the shape that refuses it by having nowhere to put one.
//
// THE PRODUCTION IMPLEMENTATION DOES NOT EXIST AND THAT IS MEASURED, NOT
// ASSUMED. Session 258 re-derived it at source for the same rail: over all the
// migrations the only inbound-webhook table is `psp_webhook_events`, whose
// `purchase_id uuid REFERENCES purchases(id)` makes it the PAYMENT rail's rather
// than a general one, so "a Rise event has nowhere to be claimed". The interface
// is declared here so that the day a table exists, the receiver that writes it
// is implementing something rather than inventing it.
// =============================================================================

import { RailWebhookVerificationError, type VerifiedRailEvent } from './port.ts';
import { RAIL_WEBHOOK_WINDOW_SECONDS } from './webhook.ts';

/**
 * What one delivery turned out to be.
 *
 * THREE MEMBERS AND NOT TWO, because "seen before" is two different facts with
 * two different HTTP answers, and a boolean would have forced a receiver to
 * guess which.
 */
export type DeliveryDisposition =
  /** Never seen. Apply it. */
  | 'first_delivery'
  /** The rail's own retry of an event already applied. 200, and stop. S-2. */
  | 'duplicate_event'
  /** This nonce has been presented before. Refuse. */
  | 'replay';

/**
 * The record a receiver keeps of what it has been delivered.
 *
 * ONE INTERFACE AND NOT TWO, because the two questions are two reads of ONE
 * delivery and answering them out of two stores is two things to keep
 * consistent. A receiver backed by a database renders both as predicates over
 * one row.
 */
export interface DeliveryLedger {
  /**
   * Record this delivery and say what it was.
   *
   * ORDER IS PART OF THE CONTRACT: the nonce is checked FIRST. A captured
   * delivery carries both a seen nonce and a seen event id, and answering
   * `duplicate_event` to it would be answering 200 to a replay.
   *
   * IT RECORDS EVEN WHEN IT REFUSES. A replay that was not recorded is a replay
   * the next call cannot see, and an attacker who presents the same capture
   * twice would get one refusal and one silence.
   */
  record(event: VerifiedRailEvent): Promise<DeliveryDisposition>;
}

/**
 * Turn a disposition into the refusal the port declares, or into nothing.
 *
 * IT IS A SEPARATE FUNCTION AND NOT A THROW INSIDE `record`, because
 * `duplicate_event` is a 200 and a `record` that threw on it would make the
 * common, correct, boring case an exception. A receiver calls `record`, calls
 * this, and then branches on `duplicate_event` itself.
 *
 * @throws {RailWebhookVerificationError} `replay_detected`, and only on
 * `'replay'`.
 */
export function refuseReplay(event: VerifiedRailEvent, disposition: DeliveryDisposition): void {
  if (disposition !== 'replay') return;
  throw new RailWebhookVerificationError(
    event.provider,
    'replay_detected',
    event.raw,
    `nonce ${JSON.stringify(event.nonce)} was presented before. A settlement delivered twice ` +
      'settles once, and the rail re-signs its own retries with a fresh nonce, so a repeated ' +
      'nonce inside the window is a capture rather than a retry.',
  );
}

/**
 * The in-memory ledger, FOR THE SANDBOX AND FOR TESTS, and its two halves have
 * two different lifetimes on purpose.
 *
 * THE NONCE HALF IS PRUNED BY THE WINDOW AND THAT IS SOUND RATHER THAN
 * CONVENIENT. A delivery whose timestamp is older than the freshness window is
 * already refused by `verifyRailWebhook` step 3 before it ever reaches here, so
 * forgetting nonces older than the window cannot admit anything: the clock
 * refuses them first. Without the prune this set grows without bound, which is
 * how a replay control becomes a memory leak and then gets deleted.
 *
 * THE EVENT-ID HALF IS NOT PRUNED AND CANNOT BE. A rail may retry an hour later,
 * or a day later, and the whole point of the anchor is that the answer is the
 * same whenever it arrives. SO THIS HALF GROWS, AND THAT IS THE HONEST REASON
 * THIS CLASS IS A FAKE'S MEMORY RATHER THAN AN IMPLEMENTATION: the production
 * answer is a UNIQUE INDEX on a table that does not exist yet, not a `Set` in a
 * process that forgets on a restart.
 */
export class InMemoryDeliveryLedger implements DeliveryLedger {
  /** nonce to the timestamp it was presented under, which the prune reads. */
  readonly #nonces = new Map<string, number>();
  readonly #eventIds = new Set<string>();
  readonly #windowSeconds: number;

  constructor(options?: { readonly windowSeconds?: number }) {
    this.#windowSeconds = options?.windowSeconds ?? RAIL_WEBHOOK_WINDOW_SECONDS;
  }

  record(event: VerifiedRailEvent): Promise<DeliveryDisposition> {
    this.#prune(event.timestampEpochSeconds);

    const nonceKey = `${event.provider} ${event.nonce}`;
    const eventKey = `${event.provider} ${event.providerEventId}`;

    // RECORDED BEFORE IT IS ANSWERED, so a refusal is remembered too.
    const nonceSeen = this.#nonces.has(nonceKey);
    this.#nonces.set(nonceKey, event.timestampEpochSeconds);
    const eventSeen = this.#eventIds.has(eventKey);
    this.#eventIds.add(eventKey);

    // THE NONCE FIRST. See `record`'s doc comment: a capture carries both.
    if (nonceSeen) return Promise.resolve('replay');
    if (eventSeen) return Promise.resolve('duplicate_event');
    return Promise.resolve('first_delivery');
  }

  /** How many nonces are held. Exposed so the prune can be watched working. */
  get noncesHeld(): number {
    return this.#nonces.size;
  }

  /** Drop every nonce the freshness window would already have refused. */
  #prune(nowEpochSeconds: number): void {
    const floor = nowEpochSeconds - this.#windowSeconds;
    for (const [nonce, at] of this.#nonces) {
      if (at < floor) this.#nonces.delete(nonce);
    }
  }
}
