import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { buildServer, discoverRouteModules } from '../src/index.ts';
import {
  RISE_PROVIDER,
  RiseWebhookVerificationError,
  riseConcatBytes,
  riseDecimalInteger,
  riseDecodeMac,
  riseHmacAdapter,
  riseSingleHeader,
  riseUtf8,
  verifyRiseWebhook,
} from '../src/rise-webhook.ts';
import type {
  RiseEventIdentity,
  RiseJsonObject,
  RisePresentedSignature,
  RiseWebhookAdapter,
  RiseWebhookHeaders,
  RiseWebhookScheme,
} from '../src/rise-webhook.ts';
import { installRawWebhookBodyParser } from '../src/routes/webhooks-psp.ts';
import {
  RISE_WEBHOOK_PATH,
  UNVERIFIED_RISE_EVENT_ID_PREFIX,
  productionDeps,
  receiveRiseWebhook,
  riseWebhookHandler,
  unverifiedRiseEventId,
} from '../src/routes/webhooks-rise.ts';
import type {
  RiseApplication,
  RiseEventApplier,
  RiseWebhookDeps,
  RiseWebhookEventRow,
  RiseWebhookRefusalRow,
  RiseWebhookStore,
  RiseWebhookTx,
} from '../src/routes/webhooks-rise.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR, AND THE FIRST DESCRIBE IS THE APPROVAL LINE.
//
// ADR-109 clause 7 is the one clause of that entry that is a PROHIBITION rather
// than a plan: "A HANDLER MAY NEVER RECOVER THE BYTES BY RE-ENCODING
// `request.body`. Two JSON texts that parse equal serialise differently, so a
// re-encoded body is a DIFFERENT DOCUMENT and its MAC will not verify. The
// failure is a `401` for every legitimate webhook, with no line of code looking
// wrong."
//
// SO BOTH DIRECTIONS ARE WATCHED, ON ONE PAYLOAD, IN ONE TEST. The correctly
// signed bytes verify, and the SAME payload re-serialised is refused. Either
// assertion alone proves nothing: a verifier that refuses everything passes the
// second, and a verifier that checks nothing passes the first.

// -----------------------------------------------------------------------------
// A Rise scheme, in a shape a real provider ships
// -----------------------------------------------------------------------------
// API_CONTRACT section 10's Rise row reads "HMAC plus timestamp and NONCE",
// which is the three-header shape rather than the compound-header one: the
// timestamp and the nonce ride in their own headers and the MAC spans both,
// which is what makes the nonce COVERED BY THE SIGNATURE. `packages/psp`'s two
// fakes disagree about exactly this and neither shape is invented.

const RISE_SIGNATURE_HEADER = 'rise-signature';
const RISE_TIMESTAMP_HEADER = 'rise-timestamp';
const RISE_NONCE_HEADER = 'rise-nonce';

const SECRET = 'rise-shared-secret';
const NOW = new Date('2026-08-27T12:00:00.000Z');
const clock = (): Date => NOW;

/** The bytes this provider signs: `<t>\n<nonce>\n` then the body. */
function signedBytes(t: string, nonce: string, raw: Uint8Array): Uint8Array {
  return riseConcatBytes(riseUtf8(`${t}\n${nonce}\n`), raw);
}

const SCHEME: RiseWebhookScheme = {
  presentedSignature(raw: Uint8Array, headers: RiseWebhookHeaders): RisePresentedSignature {
    const mac = riseSingleHeader(headers, RISE_SIGNATURE_HEADER, raw);
    const t = riseSingleHeader(headers, RISE_TIMESTAMP_HEADER, raw);
    const nonce = riseSingleHeader(headers, RISE_NONCE_HEADER, raw);
    return {
      signedBytes: signedBytes(t, nonce, raw),
      mac: riseDecodeMac(mac, 'base64', raw),
      timestampEpochSeconds: riseDecimalInteger(t, raw, RISE_TIMESTAMP_HEADER),
      headerNonce: nonce,
    };
  },

  eventIdentity(
    payload: RiseJsonObject,
    presented: RisePresentedSignature,
  ): RiseEventIdentity | null {
    const id = payload['event_id'];
    const transfer = payload['transfer_id'];
    const type = payload['type'];
    const nonce = presented.headerNonce;
    if (typeof id !== 'string' || id.length === 0) return null;
    // HALF THE ANCHOR. API_CONTRACT section 10 anchors this row on
    // `provider_transfer_id` plus event id, so a verified payload naming no
    // transfer has nothing for the receiver to attach an outcome to.
    if (typeof transfer !== 'string' || transfer.length === 0) return null;
    if (typeof type !== 'string' || type.length === 0) return null;
    if (nonce === undefined || nonce.length === 0) return null;
    return { providerEventId: id, providerTransferId: transfer, eventType: type, nonce };
  },
};

interface SignRequest {
  readonly eventId: string;
  readonly transferId: string;
  readonly eventType: string;
  readonly data?: RiseJsonObject;
  readonly nonce?: string;
  readonly timestampEpochSeconds?: number;
}

interface Signed {
  readonly raw: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

/** The PROVIDER side of the fake. It holds a real secret and really MACs. */
function sign(request: SignRequest): Signed {
  const body: RiseJsonObject = {
    event_id: request.eventId,
    transfer_id: request.transferId,
    type: request.eventType,
    ...(request.data ?? {}),
  };
  // The bytes are minted here and never re-derived, which is the whole subject
  // of this file: `raw` below is the only spelling of this document that has a
  // valid MAC.
  const raw = riseUtf8(JSON.stringify(body));
  const t = String(request.timestampEpochSeconds ?? Math.floor(clock().getTime() / 1000));
  const nonce = request.nonce ?? `nonce-${request.eventId}`;
  const mac = createHmac('sha256', SECRET)
    .update(signedBytes(t, nonce, raw))
    .digest('base64');
  return {
    raw,
    headers: {
      [RISE_SIGNATURE_HEADER]: mac,
      [RISE_TIMESTAMP_HEADER]: t,
      [RISE_NONCE_HEADER]: nonce,
    },
  };
}

const adapter: RiseWebhookAdapter = riseHmacAdapter({ scheme: SCHEME, secret: SECRET, clock });

// -----------------------------------------------------------------------------
// The store, real enough to roll back
// -----------------------------------------------------------------------------
// The receiver applies the effect BEFORE it claims the row, so a rollback that
// did not actually discard the effect would let this suite report "exactly one
// business effect" while the real path produced two.

class FakeRiseStore implements RiseWebhookStore {
  rows: RiseWebhookEventRow[] = [];
  effects: string[] = [];
  readonly refusals: RiseWebhookRefusalRow[] = [];

  /**
   * The unique index the anchor would ride on, SETTABLE, so "exactly one effect"
   * is watched against a receiver whose uniqueness check is removed. An
   * assertion that passes against a broken receiver asserts nothing.
   */
  uniquenessEnforced = true;

  async transact<T>(fn: (tx: RiseWebhookTx) => Promise<T>): Promise<T> {
    const rowsAtBegin = [...this.rows];
    const effectsAtBegin = [...this.effects];
    let rolledBack = false;
    const tx: RiseWebhookTx = {
      record: (row) => {
        const clash =
          this.uniquenessEnforced &&
          this.rows.some(
            (r) =>
              r.providerTransferId === row.providerTransferId &&
              r.providerEventId === row.providerEventId,
          );
        if (clash) return Promise.resolve('duplicate');
        this.rows.push(row);
        return Promise.resolve('inserted');
      },
      rollback: () => {
        rolledBack = true;
        return Promise.resolve();
      },
    };
    const out = await fn(tx);
    if (rolledBack) {
      this.rows = rowsAtBegin;
      this.effects = effectsAtBegin;
    }
    return out;
  }

  recordRefusal(row: RiseWebhookRefusalRow): Promise<void> {
    this.refusals.push(row);
    return Promise.resolve();
  }
}

/** The applier. It counts calls so "never reached business logic" is a number. */
function applierOver(
  store: FakeRiseStore,
  decide: () => RiseApplication = () => ({ kind: 'applied' }),
) {
  let calls = 0;
  const applier: RiseEventApplier = {
    apply: (event) => {
      calls += 1;
      store.effects.push(event.providerEventId);
      return Promise.resolve(decide());
    },
  };
  return { applier, calls: () => calls };
}

function depsFor(store: FakeRiseStore, applier: RiseEventApplier): RiseWebhookDeps {
  return { adapter, store, applier, now: clock };
}

// -----------------------------------------------------------------------------
// THE WEBHOOK CLAUSE
// -----------------------------------------------------------------------------

describe('the bytes are the document, and a re-serialisation is a different one', () => {
  test('the signed bytes VERIFY, and the same payload re-serialised is REFUSED', async () => {
    const store = new FakeRiseStore();
    const { applier, calls } = applierOver(store);
    const deps = depsFor(store, applier);
    const signed = sign({ eventId: 'evt_1', transferId: 'tr_1', eventType: 'transfer.settled' });

    // 1. THE PAYLOAD VERIFIES ON ITS OWN BYTES. Without this the refusal below
    //    would be satisfied by a verifier that refuses everything.
    const ok = await receiveRiseWebhook({
      raw: signed.raw,
      headers: signed.headers,
      instance: 'req_ok',
      deps,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ received: true });
    expect(calls()).toBe(1);

    // 2. THE SAME PAYLOAD, RE-SERIALISED. This is exactly what a handler
    //    reaching for `JSON.stringify(request.body)` produces after a parser
    //    that pretty-printed, which is a legal thing for one to do. The two
    //    texts PARSE EQUAL and are different documents.
    const text = new TextDecoder().decode(signed.raw);
    const reserialised = riseUtf8(JSON.stringify(JSON.parse(text), null, 2));
    expect(JSON.parse(new TextDecoder().decode(reserialised))).toEqual(JSON.parse(text));
    expect(Buffer.from(reserialised).equals(Buffer.from(signed.raw))).toBe(false);

    const refused = await receiveRiseWebhook({
      raw: reserialised,
      headers: signed.headers,
      instance: 'req_reserialised',
      deps,
    });

    // 401 for a webhook the provider signed correctly. Total, silent failure,
    // and the reason ADR-109 clause 7 is a prohibition.
    expect(refused.status).toBe(401);
    // The business logic was NOT reached a second time.
    expect(calls()).toBe(1);
    expect(store.refusals.map((r) => r.refusal)).toEqual(['signature_mismatch']);
  });

  test('a re-serialisation that only reorders keys is refused too', async () => {
    const store = new FakeRiseStore();
    const { applier, calls } = applierOver(store);
    const signed = sign({ eventId: 'evt_2', transferId: 'tr_2', eventType: 'transfer.sent' });
    const parsed = JSON.parse(new TextDecoder().decode(signed.raw)) as Record<string, unknown>;
    const reordered = riseUtf8(
      JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())),
    );
    expect(reordered.length).toBe(signed.raw.length);

    const result = await receiveRiseWebhook({
      raw: reordered,
      headers: signed.headers,
      instance: 'req_reordered',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(401);
    expect(calls()).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// The rest of section 10's ordering
// -----------------------------------------------------------------------------

describe('the refusals, and the row each one still writes', () => {
  test('a tampered body is refused and the applier is never called', async () => {
    const store = new FakeRiseStore();
    const { applier, calls } = applierOver(store);
    const signed = sign({
      eventId: 'evt_3',
      transferId: 'tr_3',
      eventType: 'transfer.settled',
      data: { amount_cents: 100 },
    });
    const tampered = riseUtf8(
      new TextDecoder().decode(signed.raw).replace('"amount_cents":100', '"amount_cents":900'),
    );
    const result = await receiveRiseWebhook({
      raw: tampered,
      headers: signed.headers,
      instance: 'req_t',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(401);
    expect(calls()).toBe(0);
    expect(store.effects).toEqual([]);
  });

  test('a payload outside the five minute window is refused', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const stale = sign({
      eventId: 'evt_4',
      transferId: 'tr_4',
      eventType: 'transfer.settled',
      timestampEpochSeconds: Math.floor(NOW.getTime() / 1000) - 301,
    });
    const result = await receiveRiseWebhook({
      raw: stale.raw,
      headers: stale.headers,
      instance: 'req_w',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(401);
    expect(store.refusals.map((r) => r.refusal)).toEqual(['timestamp_outside_window']);
  });

  test('a payload stamped in the FUTURE is refused, which bounds the replay', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const ahead = sign({
      eventId: 'evt_5',
      transferId: 'tr_5',
      eventType: 'transfer.settled',
      timestampEpochSeconds: Math.floor(NOW.getTime() / 1000) + 301,
    });
    const result = await receiveRiseWebhook({
      raw: ahead.raw,
      headers: ahead.headers,
      instance: 'req_f',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(401);
  });

  test('a repeated signature header is its own refusal and not signature_malformed', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const signed = sign({ eventId: 'evt_6', transferId: 'tr_6', eventType: 'transfer.sent' });
    const result = await receiveRiseWebhook({
      raw: signed.raw,
      headers: { ...signed.headers, [RISE_SIGNATURE_HEADER]: ['a', 'b'] },
      instance: 'req_r',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(401);
    expect(store.refusals.map((r) => r.refusal)).toEqual(['signature_header_repeated']);
  });

  test('a verified payload naming no transfer is event_identity_missing', async () => {
    const store = new FakeRiseStore();
    const { applier, calls } = applierOver(store);
    // Signed correctly, so it gets past the digest and the window, and is
    // refused on the half of the anchor the contract names.
    const raw = riseUtf8(JSON.stringify({ event_id: 'evt_7', type: 'transfer.sent' }));
    const t = String(Math.floor(NOW.getTime() / 1000));
    const nonce = 'nonce-7';
    const mac = createHmac('sha256', SECRET)
      .update(signedBytes(t, nonce, raw))
      .digest('base64');
    const result = await receiveRiseWebhook({
      raw,
      headers: {
        [RISE_SIGNATURE_HEADER]: mac,
        [RISE_TIMESTAMP_HEADER]: t,
        [RISE_NONCE_HEADER]: nonce,
      },
      instance: 'req_i',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(401);
    expect(calls()).toBe(0);
    expect(store.refusals.map((r) => r.refusal)).toEqual(['event_identity_missing']);
  });

  test('a refusal is STORED, with the fact that it did not verify and the bytes', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const signed = sign({ eventId: 'evt_8', transferId: 'tr_8', eventType: 'transfer.sent' });
    const tampered = riseUtf8(`${new TextDecoder().decode(signed.raw)} `);
    await receiveRiseWebhook({
      raw: tampered,
      headers: signed.headers,
      instance: 'req_s',
      deps: depsFor(store, applier),
    });
    const row = store.refusals[0];
    expect(row).toBeDefined();
    expect(row?.provider).toBe(RISE_PROVIDER);
    expect(row?.signatureVerified).toBe(false);
    expect(row?.processingResult).toBe('rejected_signature');
    expect(row?.providerEventId).toBe(unverifiedRiseEventId(tampered));
    expect(row?.providerEventId.startsWith(UNVERIFIED_RISE_EVENT_ID_PREFIX)).toBe(true);
    expect(row?.evidence).toEqual({
      unverified_body_hex: Buffer.from(tampered).toString('hex'),
    });
  });

  test('the synthesised refusal id is the digest, so retries of one payload dedupe', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const signed = sign({ eventId: 'evt_9', transferId: 'tr_9', eventType: 'transfer.sent' });
    const tampered = riseUtf8(`${new TextDecoder().decode(signed.raw)} `);
    for (const instance of ['r1', 'r2']) {
      await receiveRiseWebhook({
        raw: tampered,
        headers: signed.headers,
        instance,
        deps: depsFor(store, applier),
      });
    }
    expect(new Set(store.refusals.map((r) => r.providerEventId)).size).toBe(1);
  });
});

describe('one provider event, one business effect', () => {
  test('a redelivery produces two 200s and exactly one effect', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const deps = depsFor(store, applier);
    const signed = sign({ eventId: 'evt_d', transferId: 'tr_d', eventType: 'transfer.settled' });

    const first = await receiveRiseWebhook({
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r1',
      deps,
    });
    const second = await receiveRiseWebhook({
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r2',
      deps,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // BYTE IDENTICAL. A response that said "duplicate" would be an oracle.
    expect(second.body).toEqual(first.body);
    expect(store.effects).toEqual(['evt_d']);
    expect(store.rows.length).toBe(1);
  });

  test('with the uniqueness check removed the effect lands TWICE, so the assertion can fail', async () => {
    const store = new FakeRiseStore();
    store.uniquenessEnforced = false;
    const { applier } = applierOver(store);
    const deps = depsFor(store, applier);
    const signed = sign({ eventId: 'evt_d', transferId: 'tr_d', eventType: 'transfer.settled' });
    for (const instance of ['r1', 'r2']) {
      await receiveRiseWebhook({ raw: signed.raw, headers: signed.headers, instance, deps });
    }
    expect(store.effects).toEqual(['evt_d', 'evt_d']);
  });

  test('a deferred event is stored unprocessed, with zero attempts', async () => {
    const store = new FakeRiseStore();
    const until = new Date('2026-08-27T12:05:00.000Z');
    const { applier } = applierOver(store, () => ({ kind: 'deferred', until }));
    const signed = sign({ eventId: 'evt_o', transferId: 'tr_o', eventType: 'transfer.settled' });
    const result = await receiveRiseWebhook({
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r1',
      deps: depsFor(store, applier),
    });
    expect(result.status).toBe(200);
    const row = store.rows[0];
    expect(row?.processingResult).toBe('out_of_order_deferred');
    expect(row?.processedAt).toBeNull();
    expect(row?.deferredUntil).toBe(until);
    expect(row?.deferAttempts).toBe(0);
  });

  test('an applied event carries the anchor and both halves of it', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const signed = sign({ eventId: 'evt_a', transferId: 'tr_a', eventType: 'transfer.settled' });
    await receiveRiseWebhook({
      raw: signed.raw,
      headers: signed.headers,
      instance: 'r1',
      deps: depsFor(store, applier),
    });
    const row = store.rows[0];
    expect(row?.providerEventId).toBe('evt_a');
    expect(row?.providerTransferId).toBe('tr_a');
    expect(row?.signatureVerified).toBe(true);
    expect(row?.processedAt).toEqual(NOW);
  });
});

// -----------------------------------------------------------------------------
// The port's own refusals, reached directly
// -----------------------------------------------------------------------------

describe('the port refuses rather than returning a boolean', () => {
  test('a MAC that is not base64 is signature_malformed', () => {
    const signed = sign({ eventId: 'evt_m', transferId: 'tr_m', eventType: 'x' });
    expect(() =>
      verifyRiseWebhook({
        scheme: SCHEME,
        secret: SECRET,
        raw: signed.raw,
        headers: { ...signed.headers, [RISE_SIGNATURE_HEADER]: 'not base64!!' },
        now: NOW,
      }),
    ).toThrow(RiseWebhookVerificationError);
  });

  test('a body that is not a JSON object is refused after the digest agreed', () => {
    const raw = riseUtf8('[1, 2, 3]');
    const t = String(Math.floor(NOW.getTime() / 1000));
    const nonce = 'n';
    const mac = createHmac('sha256', SECRET)
      .update(signedBytes(t, nonce, raw))
      .digest('base64');
    try {
      verifyRiseWebhook({
        scheme: SCHEME,
        secret: SECRET,
        raw,
        headers: {
          [RISE_SIGNATURE_HEADER]: mac,
          [RISE_TIMESTAMP_HEADER]: t,
          [RISE_NONCE_HEADER]: nonce,
        },
        now: NOW,
      });
      expect.unreachable('a top-level array is not a webhook body');
    } catch (error) {
      expect(error).toBeInstanceOf(RiseWebhookVerificationError);
      expect((error as RiseWebhookVerificationError).refusal).toBe('payload_not_json_object');
    }
  });

  test('a missing header is its own refusal and carries the raw bytes', () => {
    const raw = riseUtf8('{}');
    try {
      riseSingleHeader({}, RISE_SIGNATURE_HEADER, raw);
      expect.unreachable('an absent header is a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(RiseWebhookVerificationError);
      expect((error as RiseWebhookVerificationError).refusal).toBe('signature_header_missing');
      expect((error as RiseWebhookVerificationError).raw).toBe(raw);
    }
  });

  test('a timestamp that is not an integer is refused rather than truncated', () => {
    const raw = riseUtf8('{}');
    // `Number.parseInt('12abc')` is 12, which on a timestamp is a silently
    // wrong window.
    expect(() => riseDecimalInteger('12abc', raw, 't')).toThrow(RiseWebhookVerificationError);
  });
});

// -----------------------------------------------------------------------------
// The framework edge
// -----------------------------------------------------------------------------

const onDisk = await discoverRouteModules();

function serve(deps: RiseWebhookDeps, options: { readonly rawParser: boolean }) {
  const { app } = buildServer({
    surface: 'public',
    modules: onDisk.map((module) =>
      module.name === 'webhooks-rise'
        ? {
            name: module.name,
            routes: [
              {
                method: 'POST' as const,
                path: RISE_WEBHOOK_PATH,
                handler: riseWebhookHandler(deps),
              },
            ],
          }
        : module,
    ),
  });
  if (options.rawParser) installRawWebhookBodyParser(app);
  return app;
}

describe('over HTTP', () => {
  test('a correctly signed payload reaches the receiver and answers 200', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const signed = sign({ eventId: 'evt_http', transferId: 'tr_http', eventType: 'transfer.sent' });
    const app = serve(depsFor(store, applier), { rawParser: true });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1${RISE_WEBHOOK_PATH}`,
      headers: { ...signed.headers, 'content-type': 'application/json' },
      payload: Buffer.from(signed.raw),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(store.effects).toEqual(['evt_http']);

    await app.close();
  });

  test('without the raw parser it is 500 and NOT 401, because rawBodyOf refuses', async () => {
    const store = new FakeRiseStore();
    const { applier } = applierOver(store);
    const signed = sign({ eventId: 'evt_np', transferId: 'tr_np', eventType: 'transfer.sent' });
    const app = serve(depsFor(store, applier), { rawParser: false });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1${RISE_WEBHOOK_PATH}`,
      headers: { ...signed.headers, 'content-type': 'application/json' },
      payload: Buffer.from(signed.raw),
    });

    // A 401 would be the wrong diagnosis for a correctly signed webhook, and it
    // is what a handler that re-serialised would answer.
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error' });
    expect(store.effects).toEqual([]);
    expect(store.refusals).toEqual([]);

    await app.close();
  });

  test('the production dependencies resolve nothing, so a live deployment is 503', async () => {
    expect(productionDeps.adapter).toBeNull();
    expect(productionDeps.store).toBeNull();
    expect(productionDeps.applier).toBeNull();

    const { app } = buildServer({ surface: 'public', modules: onDisk });
    installRawWebhookBodyParser(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1${RISE_WEBHOOK_PATH}`,
      headers: { 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });
    // 503 and not 404: this path carries no `:provider`, so nothing names a
    // resource that could be absent. Section 2's code for a dependency that is
    // not there.
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'service_unavailable' });

    await app.close();
  });

  test('the operator surface does not serve it', async () => {
    const { app } = buildServer({ surface: 'operator', modules: onDisk });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1${RISE_WEBHOOK_PATH}`,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
