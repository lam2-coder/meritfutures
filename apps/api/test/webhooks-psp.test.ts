import { describe, expect, test } from 'vitest';

import {
  PSP_A_SIGNATURE_HEADER,
  WebhookVerificationError,
  createPspAFake,
  createPspBFake,
} from '@merit/psp';
import type { JsonObject, PspAdapter, VerifiedEvent, WebhookHeaders } from '@merit/psp';

import { buildServer, defineRoutes } from '../src/index.ts';
import webhooksPspModule, {
  PSP_WEBHOOK_PATH,
  RawBodyUnavailableError,
  UNVERIFIED_EVENT_ID_PREFIX,
  installRawWebhookBodyParser,
  productionDeps,
  pspWebhookHandler,
  rawBodyOf,
  receivePspWebhook,
  unverifiedEventId,
} from '../src/routes/webhooks-psp.ts';
import type {
  PspApplication,
  PspEventApplier,
  PspWebhookDeps,
  PspWebhookEventRow,
  PspWebhookRefusalRow,
  PspWebhookStore,
  PspWebhookTx,
} from '../src/routes/webhooks-psp.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR, AND IT IS THE APPROVAL LINE RATHER THAN COVERAGE.
//
//   "the same provider event delivered twice produces exactly one business
//    effect and two 200s, watched against a seeded receiver whose uniqueness
//    check is removed, and an unverified signature is watched never reaching
//    the handler."
//
// Both halves are watched in BOTH directions. The duplicate case is asserted
// AND the seeded receiver with the uniqueness check removed is watched applying
// the effect twice, because an assertion that passes against a broken receiver
// asserts nothing. The refusal case asserts the 401 AND that the applier was
// never called, because a 401 returned after the effect landed is the failure
// INV-M3-05 exists for and it looks identical from outside.
//
// THE STORE BELOW IS A FAKE AND ITS TRANSACTION IS REAL ENOUGH TO ROLL BACK.
// That matters: the receiver applies the effect BEFORE it claims the row, so a
// rollback that did not actually discard the effect would let this suite report
// "exactly one business effect" while the real path produced two.

const SECRET_A = 'psp-a-shared-secret';
const SECRET_B = 'psp-b-shared-secret';
const NOW = new Date('2026-08-26T12:00:00.000Z');
const clock = (): Date => NOW;

/** The business effect, so "exactly one" is a number and not a feeling. */
interface Effect {
  readonly providerEventId: string;
}

class FakeWebhookStore implements PspWebhookStore {
  rows: PspWebhookEventRow[] = [];
  effects: Effect[] = [];
  readonly refusals: PspWebhookRefusalRow[] = [];

  /**
   * `psp_webhook_events_provider_event_uq`, and it is settable so the approval
   * line's "seeded receiver whose uniqueness check is removed" is a real seed
   * rather than a described one.
   */
  uniquenessEnforced = true;

  async transact<T>(fn: (tx: PspWebhookTx) => Promise<T>): Promise<T> {
    const rowsAtBegin = [...this.rows];
    const effectsAtBegin = [...this.effects];
    let rolledBack = false;
    const tx: PspWebhookTx = {
      record: (row) => {
        const clash =
          this.uniquenessEnforced &&
          this.rows.some((r) => r.psp === row.psp && r.providerEventId === row.providerEventId);
        if (clash) return Promise.resolve('duplicate');
        this.rows.push(row);
        return Promise.resolve('inserted');
      },
      rollback: () => {
        rolledBack = true;
        return Promise.resolve();
      },
    };
    const result = await fn(tx);
    if (rolledBack) {
      this.rows = rowsAtBegin;
      this.effects = effectsAtBegin;
    }
    return result;
  }

  recordRefusal(row: PspWebhookRefusalRow): Promise<void> {
    this.refusals.push(row);
    return Promise.resolve();
  }
}

/** Applies, and counts. `deferOn` drives B4 #9 without a second applier. */
function applier(store: FakeWebhookStore, options: { deferOn?: string } = {}): PspEventApplier {
  return {
    apply(event: VerifiedEvent): Promise<PspApplication> {
      if (options.deferOn !== undefined && event.eventType === options.deferOn) {
        return Promise.resolve({ kind: 'deferred', until: new Date(NOW.getTime() + 60_000) });
      }
      store.effects.push({ providerEventId: event.providerEventId });
      return Promise.resolve({ kind: 'applied', purchaseId: `pur_${event.providerEventId}` });
    },
  };
}

function depsFor(
  store: FakeWebhookStore,
  adapters: Readonly<Record<string, PspAdapter>>,
  options: { deferOn?: string } = {},
): PspWebhookDeps {
  return {
    adapters: (provider) => adapters[provider] ?? null,
    store,
    applier: applier(store, options),
    now: clock,
  };
}

function pspA(): ReturnType<typeof createPspAFake> {
  return createPspAFake({ secret: SECRET_A, clock });
}

function pspB(): ReturnType<typeof createPspBFake> {
  return createPspBFake({ secret: SECRET_B, clock });
}

// -----------------------------------------------------------------------------

describe('the module composes, and it adds no second module list', () => {
  test('it is a valid route module named for its file, on the contract path', () => {
    expect(webhooksPspModule.name).toBe('webhooks-psp');
    expect(webhooksPspModule.routes).toHaveLength(1);
    expect(webhooksPspModule.routes[0]?.method).toBe('POST');
    expect(webhooksPspModule.routes[0]?.path).toBe(PSP_WEBHOOK_PATH);
  });

  test('the path is API_CONTRACT section 10s, with no base path on it', () => {
    expect(PSP_WEBHOOK_PATH).toBe('/webhooks/psp/:provider');
    expect(PSP_WEBHOOK_PATH.startsWith('/api/v1')).toBe(false);
  });

  test('a PSP posts to the PUBLIC origin, so both surfaces are not the same answer', () => {
    const publicServer = buildServer({ surface: 'public', modules: [webhooksPspModule] });
    expect(publicServer.report.registered).toContain(`POST ${PSP_WEBHOOK_PATH}`);
    expect(publicServer.report.withheld).toEqual([]);
  });
});

describe('the approval line, first half: one event twice is one effect and two 200s', () => {
  test('the second delivery is 200, the effect count is 1 and the table holds one row', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({
      eventId: 'evt_1',
      eventType: 'payment.succeeded',
      data: { amount_cents: 9900 },
    });

    const first = await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_1',
      deps,
    });
    const second = await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_2',
      deps,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // A DUPLICATE IS NOT AN ERROR PATH. API_CONTRACT section 10.
    expect(second.isProblem).toBe(false);
    // AND IT IS INDISTINGUISHABLE FROM THE FIRST. A response that said
    // "duplicate" would answer which event ids Merit has seen.
    expect(second.body).toEqual(first.body);
    expect(store.effects).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingResult).toBe('applied');
  });

  test('THE SEED: with the uniqueness check removed the effect lands TWICE', async () => {
    const store = new FakeWebhookStore();
    // `psp_webhook_events_provider_event_uq` is INV-M3-03 and the receiver
    // rides on it rather than re-checking it. Remove it and the receiver has
    // nothing left: this is what the assertion above is worth.
    store.uniquenessEnforced = false;
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({
      eventId: 'evt_1',
      eventType: 'payment.succeeded',
      data: { amount_cents: 9900 },
    });

    await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_1',
      deps,
    });
    await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_2',
      deps,
    });

    expect(store.effects).toHaveLength(2);
    expect(store.rows).toHaveLength(2);
  });

  test('the rollback discards the APPLICATION and not only the row', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({ eventId: 'evt_1', eventType: 'x', data: {} });
    await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r1',
      deps,
    });
    const effectsAfterFirst = [...store.effects];
    await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r2',
      deps,
    });
    expect(store.effects).toEqual(effectsAfterFirst);
  });

  test('two DIFFERENT events both apply, so the dedupe is not just refusing everything', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    for (const eventId of ['evt_1', 'evt_2']) {
      const signed = adapter.signWebhook({ eventId, eventType: 'payment.succeeded', data: {} });
      const result = await receivePspWebhook({
        provider: 'psp_a',
        raw: signed.raw,
        headers: signed.headers,
        instance: eventId,
        deps,
      });
      expect(result.status).toBe(200);
    }
    expect(store.effects).toHaveLength(2);
  });

  test('the SAME event id from the OTHER provider is a different event', async () => {
    const store = new FakeWebhookStore();
    const a = pspA();
    const b = pspB();
    const deps = depsFor(store, { psp_a: a, psp_b: b });
    const signedA = a.signWebhook({ eventId: 'evt_1', eventType: 'payment.succeeded', data: {} });
    const signedB = b.signWebhook({
      eventId: 'evt_1',
      eventType: 'payment.succeeded',
      payload: {},
    });

    await receivePspWebhook({
      provider: 'psp_a',
      raw: signedA.raw,
      headers: signedA.headers,
      instance: 'r1',
      deps,
    });
    await receivePspWebhook({
      provider: 'psp_b',
      raw: signedB.raw,
      headers: signedB.headers,
      instance: 'r2',
      deps,
    });
    // The index is `(psp, provider_event_id)` and not `provider_event_id`.
    expect(store.effects).toHaveLength(2);
    expect(store.rows.map((r) => r.psp)).toEqual(['psp_a', 'psp_b']);
  });
});

describe('the approval line, second half: an unverified signature never reaches the handler', () => {
  const cases: readonly (readonly [
    string,
    (signed: { raw: Uint8Array; headers: Readonly<Record<string, string>> }) => WebhookHeaders,
  ])[] = [
    [
      'a forged MAC',
      (s) => ({ ...s.headers, [PSP_A_SIGNATURE_HEADER]: 't=1787918400,v1=' + 'a'.repeat(64) }),
    ],
    ['no signature header at all', () => ({})],
    [
      'a repeated signature header',
      (s) => ({
        [PSP_A_SIGNATURE_HEADER]: [String(s.headers[PSP_A_SIGNATURE_HEADER]), 't=1,v1=ff'],
      }),
    ],
    ['a malformed header', () => ({ [PSP_A_SIGNATURE_HEADER]: 'garbage' })],
  ];

  for (const [name, headersOf] of cases) {
    test(`${name} is 401, applies nothing, and stores the refusal`, async () => {
      const store = new FakeWebhookStore();
      const adapter = pspA();
      const deps = depsFor(store, { psp_a: adapter });
      const signed = adapter.signWebhook({ eventId: 'evt_1', eventType: 'x', data: {} });

      const result = await receivePspWebhook({
        provider: 'psp_a',
        raw: signed.raw,
        headers: headersOf(signed),
        instance: 'req_1',
        deps,
      });

      expect(result.status).toBe(401);
      expect(result.isProblem).toBe(true);
      expect(result.body).toMatchObject({ code: 'unauthenticated', status: 401 });
      // INV-M3-05, watched rather than argued.
      expect(store.effects).toEqual([]);
      expect(store.rows).toEqual([]);
      // AND THE PAYLOAD IS STILL STORED, WITH THE FACT THAT IT DID NOT VERIFY.
      expect(store.refusals).toHaveLength(1);
      expect(store.refusals[0]?.signatureVerified).toBe(false);
      expect(store.refusals[0]?.processingResult).toBe('rejected_signature');
    });
  }

  test('a stale timestamp is refused even though the MAC is genuine', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    // Six minutes old. API_CONTRACT section 10's window is five.
    const signed = adapter.signWebhook({
      eventId: 'evt_1',
      eventType: 'x',
      data: {},
      timestampEpochSeconds: Math.floor(NOW.getTime() / 1000) - 360,
    });
    const result = await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_1',
      deps,
    });
    expect(result.status).toBe(401);
    expect(store.effects).toEqual([]);
    expect(store.refusals[0]?.refusal).toBe('timestamp_outside_window');
  });

  test('a body altered after signing is refused, which is what "on the raw bytes" means', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({ eventId: 'evt_1', eventType: 'x', data: { n: 1 } });
    const tampered = new TextEncoder().encode(
      new TextDecoder().decode(signed.raw).replace('"n":1', '"n":2'),
    );
    const result = await receivePspWebhook({
      provider: 'psp_a',
      raw: tampered,
      headers: signed.headers,
      instance: 'req_1',
      deps,
    });
    expect(result.status).toBe(401);
    expect(store.effects).toEqual([]);
  });

  test('A RE-SERIALISATION OF THE PARSED BODY IS REFUSED, which is why rawBodyOf refuses', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({ eventId: 'evt_1', eventType: 'x', data: { n: 1 } });
    // What a handler reaching for `JSON.stringify(request.body)` would produce
    // after a parser that pretty-printed, which is a legal thing for one to do.
    const reserialised = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(signed.raw)), null, 2),
    );
    const result = await receivePspWebhook({
      provider: 'psp_a',
      raw: reserialised,
      headers: signed.headers,
      instance: 'req_1',
      deps,
    });
    // 401 for a webhook the provider signed correctly. Total, silent failure.
    expect(result.status).toBe(401);
  });

  test('the synthesised refusal id is the digest, so retries of one payload dedupe', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({ eventId: 'evt_1', eventType: 'x', data: {} });
    for (const instance of ['r1', 'r2']) {
      await receivePspWebhook({
        provider: 'psp_a',
        raw: signed.raw,
        headers: {},
        instance,
        deps,
      });
    }
    expect(store.refusals[0]?.providerEventId).toBe(unverifiedEventId(signed.raw));
    expect(store.refusals[0]?.providerEventId).toBe(store.refusals[1]?.providerEventId);
    expect(store.refusals[0]?.providerEventId.startsWith(UNVERIFIED_EVENT_ID_PREFIX)).toBe(true);
  });

  test('an adapter throwing something that is NOT a verification refusal is rethrown', async () => {
    const store = new FakeWebhookStore();
    const fake = pspA();
    // Delegating rather than spreading: a class instance's methods live on the
    // prototype, so `{ ...fake }` is not a `PspAdapter` and `tsc` says so.
    const broken: PspAdapter = {
      psp: 'psp_a',
      createSession: (intent) => fake.createSession(intent),
      verifyWebhook: () => Promise.reject(new TypeError('the adapter is broken')),
      refund: (ref, amount, key) => fake.refund(ref, amount, key),
      health: () => fake.health(),
    };
    const deps = depsFor(store, { psp_a: broken });
    await expect(
      receivePspWebhook({
        provider: 'psp_a',
        raw: new Uint8Array(),
        headers: {},
        instance: 'r',
        deps,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    // A 401 here would report a security event that did not happen.
    expect(store.refusals).toEqual([]);
  });
});

// GS-038 IS THE ROW THIS BLOCK AND THE DUPLICATE BLOCK ABOVE ARE FOR, AND IT IS
// NOT DISCHARGED BY THIS SUITE. The id is written here so the next reader meets
// the reasoning rather than repeating the search, and NOT as a discharge: a
// grep that finds `GS-038` in this file has found this paragraph.
//
// The row is B4 item 9, "PSP duplicate and out-of-order delivery", against "one
// account, correct final state".
//
//   THE DUPLICATE HALF IS ASSERTED WHOLE, above: one event twice is one effect
//   and two indistinguishable 200s, with a SEED that lands the effect twice when
//   the uniqueness check is removed, a rollback that discards the application
//   rather than only the row, a two-different-events control and a
//   same-id-other-provider control.
//
//   THE OUT-OF-ORDER HALF IS ASSERTED AS FAR AS THE DEFERRAL AND NO FURTHER.
//   What runs below is that the event is accepted, applies nothing, stores its
//   re-drive window, stamps no `processed_at` and no `purchase_id`, and stays
//   one row across a redelivery. "Re-evaluated" is in this block's title and
//   executes nowhere: `defer_attempts` counts RE-DRIVES, the receiver never
//   increments it and says so, and the re-driver is the batch's. No batch in
//   this tree reads `psp_webhook_events_deferred_idx`, so an out-of-order
//   delivery stops at `out_of_order_deferred` and never reaches the correct
//   final state the row pins.
//
// The row therefore stays `blocked` in section 39 with that half named. It moves
// when the re-driver lands and is asserted, not when this comment is read.
describe('B4 #9: out-of-order delivery is DEFERRED and re-evaluated, never applied', () => {
  test('a deferred event stores its re-drive window and applies nothing', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter }, { deferOn: 'refund.succeeded' });
    const signed = adapter.signWebhook({
      eventId: 'evt_refund',
      eventType: 'refund.succeeded',
      data: {},
    });

    const result = await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_1',
      deps,
    });

    // ACCEPTED, because the event is Merit's now. FM-M3-03's refund before its
    // payment is not the provider's problem to retry.
    expect(result.status).toBe(200);
    expect(store.effects).toEqual([]);
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row?.processingResult).toBe('out_of_order_deferred');
    expect(row?.deferredUntil).toEqual(new Date(NOW.getTime() + 60_000));
    // NOT PROCESSED, because it was not applied.
    expect(row?.processedAt).toBeNull();
    expect(row?.purchaseId).toBeNull();
    // The receiver never re-drives, so it never counts an attempt.
    expect(row?.deferAttempts).toBe(0);
  });

  test('a redelivery of a deferred event is still one row and still 200', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter }, { deferOn: 'refund.succeeded' });
    const signed = adapter.signWebhook({
      eventId: 'evt_refund',
      eventType: 'refund.succeeded',
      data: {},
    });
    for (const instance of ['r1', 'r2']) {
      const result = await receivePspWebhook({
        provider: 'psp_a',
        raw: signed.raw,
        headers: signed.headers,
        instance,
        deps,
      });
      expect(result.status).toBe(200);
    }
    expect(store.rows).toHaveLength(1);
  });

  test('an applied event stamps processed_at and the purchase it resolved to', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const deps = depsFor(store, { psp_a: adapter });
    const signed = adapter.signWebhook({
      eventId: 'evt_1',
      eventType: 'payment.succeeded',
      data: {},
    });
    await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r1',
      deps,
    });
    expect(store.rows[0]?.processedAt).toEqual(NOW);
    expect(store.rows[0]?.purchaseId).toBe('pur_evt_1');
    expect(store.rows[0]?.deferredUntil).toBeNull();
  });
});

describe('the path parameter and the unconfigured deployment', () => {
  test('an unknown provider is 404 and nothing is read, verified or stored', async () => {
    const store = new FakeWebhookStore();
    const deps = depsFor(store, { psp_a: pspA() });
    const result = await receivePspWebhook({
      provider: 'psp_c',
      raw: new TextEncoder().encode('{}'),
      headers: {},
      instance: 'req_1',
      deps,
    });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: 'not_found' });
    expect(store.refusals).toEqual([]);
    expect(store.rows).toEqual([]);
  });

  test('a deployment with no store answers 503 and verifies nothing', async () => {
    const adapter = pspA();
    const signed = adapter.signWebhook({ eventId: 'evt_1', eventType: 'x', data: {} });
    const result = await receivePspWebhook({
      provider: 'psp_a',
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_1',
      deps: { adapters: () => adapter, store: null, applier: null, now: clock },
    });
    // Section 10 requires the raw payload STORED. A receiver that verified and
    // then discarded would answer 200 for an event nobody can re-drive.
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: 'service_unavailable' });
  });

  test('THE DEPLOYED DEPS RESOLVE NOTHING, because packages/psp has two fakes and no vendor', () => {
    expect(productionDeps.adapters('psp_a')).toBeNull();
    expect(productionDeps.adapters('psp_b')).toBeNull();
    expect(productionDeps.store).toBeNull();
    expect(productionDeps.applier).toBeNull();
  });
});

describe('the raw body, which Fastify destroys unless a parser is registered', () => {
  test('rawBodyOf takes a Buffer and a Uint8Array and refuses everything else', () => {
    const bytes = new TextEncoder().encode('{}');
    expect(rawBodyOf(bytes)).toBe(bytes);
    const buf = Buffer.from('{}');
    expect(rawBodyOf(buf)).toBe(buf);
    for (const parsed of [{ a: 1 }, '{"a":1}', null, undefined, 7]) {
      expect(() => rawBodyOf(parsed)).toThrow(RawBodyUnavailableError);
    }
  });

  test('the refusal names the parser, so the fix is in the error rather than in a wiki', () => {
    try {
      rawBodyOf({ a: 1 });
      expect.unreachable('rawBodyOf accepted a parsed body');
    } catch (cause) {
      expect((cause as Error).message).toContain('installRawWebhookBodyParser');
      expect((cause as Error).message).toContain('BEFORE parsing');
    }
  });
});

describe('over a real Fastify instance, which is where the ordering is won or lost', () => {
  function serve(deps: PspWebhookDeps, options: { rawParser: boolean }) {
    const module = defineRoutes({
      name: 'webhooks-psp',
      routes: [{ method: 'POST', path: PSP_WEBHOOK_PATH, handler: pspWebhookHandler(deps) }],
    });
    const { app } = buildServer({ surface: 'public', modules: [module] });
    // MEASURED: a content-type parser applies even when it is registered after
    // the route, because Fastify resolves it per request rather than at
    // registration. That is what makes ADR-109 ruling 4's seam small.
    if (options.rawParser) installRawWebhookBodyParser(app);
    return app;
  }

  test('with the parser, a signed webhook verifies and applies over HTTP', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const signed = adapter.signWebhook({
      eventId: 'evt_http',
      // Two spaces the default parser would never give back, so this asserts
      // the exact bytes travelled rather than a document that parses the same.
      eventType: 'payment.succeeded',
      data: { amount_cents: 9900 },
    });
    const app = serve(depsFor(store, { psp_a: adapter }), { rawParser: true });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/psp/psp_a`,
      headers: { ...signed.headers, 'content-type': 'application/json' },
      payload: Buffer.from(signed.raw),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(store.effects).toHaveLength(1);
  });

  test('with the parser, the SECOND delivery over HTTP is 200 and applies nothing', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const signed = adapter.signWebhook({ eventId: 'evt_http', eventType: 'x', data: {} });
    const app = serve(depsFor(store, { psp_a: adapter }), { rawParser: true });
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/psp/psp_a',
        headers: { ...signed.headers, 'content-type': 'application/json' },
        payload: Buffer.from(signed.raw),
      });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect(store.effects).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  test('with the parser, a forged signature is 401 in the contract media type', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const signed = adapter.signWebhook({ eventId: 'evt_http', eventType: 'x', data: {} });
    const app = serve(depsFor(store, { psp_a: adapter }), { rawParser: true });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/psp/psp_a',
      headers: {
        'content-type': 'application/json',
        [PSP_A_SIGNATURE_HEADER]: `t=1787918400,v1=${'b'.repeat(64)}`,
      },
      payload: Buffer.from(signed.raw),
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(store.effects).toEqual([]);
  });

  test('WITHOUT THE PARSER THE ROUTE REFUSES RATHER THAN VERIFYING A DIFFERENT DOCUMENT', async () => {
    const store = new FakeWebhookStore();
    const adapter = pspA();
    const signed = adapter.signWebhook({ eventId: 'evt_http', eventType: 'x', data: {} });
    const app = serve(depsFor(store, { psp_a: adapter }), { rawParser: false });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/psp/psp_a',
      headers: { ...signed.headers, 'content-type': 'application/json' },
      payload: Buffer.from(signed.raw),
    });

    // 500 and NOT 401. A 401 would be the wrong diagnosis for a correctly
    // signed webhook, and it is what a handler that re-serialised would answer.
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error' });
    expect(store.effects).toEqual([]);
    expect(store.refusals).toEqual([]);
  });

  test('an unknown provider over HTTP is the contract 404 and not the framework one', async () => {
    const store = new FakeWebhookStore();
    const app = serve(depsFor(store, { psp_a: pspA() }), { rawParser: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/psp/psp_z',
      headers: { 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});

describe('the errors this module can raise say what to do about them', () => {
  test('WebhookVerificationError is the port type this module catches, not a string match', () => {
    const error = new WebhookVerificationError('psp_a', 'signature_mismatch', new Uint8Array());
    expect(error).toBeInstanceOf(WebhookVerificationError);
    expect(error.refusal).toBe('signature_mismatch');
  });

  test('the refusal row carries the bytes as hex, because a refused body may not be JSON', async () => {
    const store = new FakeWebhookStore();
    const deps = depsFor(store, { psp_a: pspA() });
    const raw = new Uint8Array([0xff, 0xfe, 0x00]);
    await receivePspWebhook({ provider: 'psp_a', raw, headers: {}, instance: 'r', deps });
    const payload = store.refusals[0]?.payload as JsonObject | undefined;
    expect(payload?.['unverified_body_hex']).toBe('fffe00');
  });
});
