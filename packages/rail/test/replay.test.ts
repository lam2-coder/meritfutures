// =============================================================================
// packages/rail/test/replay.test.ts
// =============================================================================
// THE THIRD SEED: A SETTLEMENT DELIVERED TWICE MUST SETTLE ONCE.
//
// AND THE CASE THAT MAKES IT MEAN SOMETHING, WHICH IS THE RAIL'S OWN RETRY. A
// suite that only seeded the capture would be satisfied by a ledger that refused
// every second delivery, and that ledger answers 401 to a rail which then
// retries forever. Both directions run here, and `the two controls are not one`
// below is the pair of seeds that turns exactly one of them red each.
// =============================================================================

import { describe, expect, test } from 'vitest';

import {
  InMemoryDeliveryLedger,
  RAIL_WEBHOOK_WINDOW_SECONDS,
  RailWebhookVerificationError,
  createSandboxRail,
  refuseReplay,
  type VerifiedRailEvent,
} from '../src/index.ts';

const AT = new Date('2026-08-28T12:00:00.000Z');
const NOW_SECONDS = Math.floor(AT.getTime() / 1000);
const SECRET = 'rail-shared-secret';

const DELIVERY = {
  eventId: 'evt_settle_1',
  providerTransferId: 'rise_tr_1_wd-1',
  eventType: 'transfer.settled',
  data: { amount_cents: 12500 },
} as const;

describe('SEED: a replayed delivery, and it is refused', () => {
  test('the exact captured bytes verify a second time and the LEDGER refuses them', async () => {
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const ledger = new InMemoryDeliveryLedger();

    const sent = rail.deliver(DELIVERY);
    const first = await rail.verifyWebhook(sent.raw, sent.headers);
    expect(await ledger.record(first)).toBe('first_delivery');
    expect(() => refuseReplay(first, 'first_delivery')).not.toThrow();

    // THE CAPTURE. Nothing re-signed, nothing re-stamped: the MAC still agrees
    // and the clock has not moved, so both of the other two controls say yes.
    const captured = rail.redeliver(DELIVERY.eventId);
    expect(captured.raw).toBe(sent.raw);
    expect(captured.headers).toStrictEqual(sent.headers);

    const second = await rail.verifyWebhook(captured.raw, captured.headers);
    expect(second.nonce).toBe(first.nonce);

    const disposition = await ledger.record(second);
    expect(disposition).toBe('replay');
    expect(() => refuseReplay(second, disposition)).toThrow(RailWebhookVerificationError);
    try {
      refuseReplay(second, disposition);
      expect.unreachable('a replayed delivery must be refused');
    } catch (error) {
      expect((error as RailWebhookVerificationError).refusal).toBe('replay_detected');
      expect((error as RailWebhookVerificationError).provider).toBe('rise');
      expect((error as RailWebhookVerificationError).raw).toBe(captured.raw);
    }
  });

  test('a THIRD presentation of the same capture is refused too, not silently admitted', async () => {
    // The ledger records even when it refuses. Without that, an attacker who
    // presents a capture twice gets one refusal and one silence.
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const ledger = new InMemoryDeliveryLedger();
    const sent = rail.deliver(DELIVERY);

    const dispositions: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const event = await rail.verifyWebhook(sent.raw, sent.headers);
      dispositions.push(await ledger.record(event));
    }
    expect(dispositions).toStrictEqual(['first_delivery', 'replay', 'replay']);
  });
});

describe('the rails OWN retry is not a replay, and is answered 200', () => {
  test('the same event with a fresh nonce is duplicate_event and refuses nothing', async () => {
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const ledger = new InMemoryDeliveryLedger();

    const sent = rail.deliver(DELIVERY);
    const first = await rail.verifyWebhook(sent.raw, sent.headers);
    expect(await ledger.record(first)).toBe('first_delivery');

    // What a real rail does when it did not hear the 200: same `event_id`, a
    // fresh nonce, a fresh timestamp, a fresh signature.
    const retried = rail.retry({ ...DELIVERY, timestampEpochSeconds: NOW_SECONDS + 30 });
    expect(retried.headers['rail-nonce']).not.toBe(sent.headers['rail-nonce']);

    const second = await rail.verifyWebhook(retried.raw, retried.headers);
    expect(second.providerEventId).toBe(first.providerEventId);

    const disposition = await ledger.record(second);
    expect(disposition).toBe('duplicate_event');
    // S-2: return 200 and stop. Not a refusal.
    expect(() => refuseReplay(second, disposition)).not.toThrow();
  });

  test('a DIFFERENT event about the same transfer is a first delivery', async () => {
    // `payout_transfers.status` runs queued, sent, settled, failed, retrying, so
    // one transfer emits more than one event. Anchoring on the transfer alone
    // would make the second event look like a duplicate of the first.
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const ledger = new InMemoryDeliveryLedger();

    const sentEvent = rail.deliver({
      ...DELIVERY,
      eventId: 'evt_sent',
      eventType: 'transfer.sent',
    });
    const settledEvent = rail.deliver(DELIVERY);

    expect(await ledger.record(await rail.verifyWebhook(sentEvent.raw, sentEvent.headers))).toBe(
      'first_delivery',
    );
    expect(
      await ledger.record(await rail.verifyWebhook(settledEvent.raw, settledEvent.headers)),
    ).toBe('first_delivery');
  });
});

describe('the two controls are not one, and each seed turns exactly one direction red', () => {
  /**
   * A ledger keyed ONLY on the event id, which is the fold a reader is most
   * likely to write. It gets the retry right and the capture WRONG.
   */
  const eventIdOnly = (): { record: (e: VerifiedRailEvent) => string } => {
    const seen = new Set<string>();
    return {
      record: (event) => {
        const key = `${event.provider} ${event.providerEventId}`;
        const already = seen.has(key);
        seen.add(key);
        return already ? 'duplicate_event' : 'first_delivery';
      },
    };
  };

  /**
   * A ledger keyed ONLY on the nonce. It gets the capture right and the retry
   * WRONG, because a retry carries a nonce nobody has seen.
   */
  const nonceOnly = (): { record: (e: VerifiedRailEvent) => string } => {
    const seen = new Set<string>();
    return {
      record: (event) => {
        const key = `${event.provider} ${event.nonce}`;
        const already = seen.has(key);
        seen.add(key);
        return already ? 'replay' : 'first_delivery';
      },
    };
  };

  test('an event-id-only ledger calls a CAPTURE a duplicate, and would answer it 200', async () => {
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const folded = eventIdOnly();
    const sent = rail.deliver(DELIVERY);

    folded.record(await rail.verifyWebhook(sent.raw, sent.headers));
    const captured = rail.redeliver(DELIVERY.eventId);
    const verdict = folded.record(await rail.verifyWebhook(captured.raw, captured.headers));

    expect(verdict).toBe('duplicate_event');
    // The real ledger says `replay` about the identical input.
    const real = new InMemoryDeliveryLedger();
    await real.record(await rail.verifyWebhook(sent.raw, sent.headers));
    expect(await real.record(await rail.verifyWebhook(captured.raw, captured.headers))).toBe(
      'replay',
    );
  });

  test('a nonce-only ledger calls a RETRY a first delivery, and would apply it twice', async () => {
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const folded = nonceOnly();
    const sent = rail.deliver(DELIVERY);

    folded.record(await rail.verifyWebhook(sent.raw, sent.headers));
    const retried = rail.retry({ ...DELIVERY, timestampEpochSeconds: NOW_SECONDS + 30 });
    const verdict = folded.record(await rail.verifyWebhook(retried.raw, retried.headers));

    expect(verdict).toBe('first_delivery');
    // The real ledger says `duplicate_event` about the identical input, which is
    // the difference between settling once and settling twice.
    const real = new InMemoryDeliveryLedger();
    await real.record(await rail.verifyWebhook(sent.raw, sent.headers));
    expect(await real.record(await rail.verifyWebhook(retried.raw, retried.headers))).toBe(
      'duplicate_event',
    );
  });
});

describe('the nonce half is pruned by the window and the event-id half is not', () => {
  test('a nonce older than the window is forgotten, because the clock already refuses it', async () => {
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const ledger = new InMemoryDeliveryLedger();

    const old = rail.deliver({ ...DELIVERY, timestampEpochSeconds: NOW_SECONDS });
    await ledger.record(await rail.verifyWebhook(old.raw, old.headers));
    expect(ledger.noncesHeld).toBe(1);

    // A delivery well past the window arrives. `verifyRailWebhook` would have
    // refused the OLD one on its clock by now, so forgetting it admits nothing.
    const later = new Date(AT.getTime() + (RAIL_WEBHOOK_WINDOW_SECONDS + 60) * 1000);
    const laterRail = createSandboxRail({ secret: SECRET, clock: () => later });
    const fresh = laterRail.deliver({ ...DELIVERY, eventId: 'evt_2' });
    await ledger.record(await laterRail.verifyWebhook(fresh.raw, fresh.headers));

    expect(ledger.noncesHeld).toBe(1);
  });

  test('an event id is remembered past the window, because a rail may retry an hour later', async () => {
    const ledger = new InMemoryDeliveryLedger();
    const rail = createSandboxRail({ secret: SECRET, clock: () => AT });
    const sent = rail.deliver(DELIVERY);
    await ledger.record(await rail.verifyWebhook(sent.raw, sent.headers));

    const muchLater = new Date(AT.getTime() + 3600 * 1000);
    const laterRail = createSandboxRail({ secret: SECRET, clock: () => muchLater });
    const retried = laterRail.retry(DELIVERY);
    const event = await laterRail.verifyWebhook(retried.raw, retried.headers);

    expect(await ledger.record(event)).toBe('duplicate_event');
  });
});
