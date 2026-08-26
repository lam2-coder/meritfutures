// =============================================================================
// apps/api/test/kyc.test.ts
// =============================================================================
// CI-02, the `unit` project. THREE ENDPOINTS AND ONE APPROVAL LINE.
//
//   "verification fires at each configured trigger and at the EARLIEST of them,
//    watched against a fixture where both trigger conditions become true in
//    either order and in the same evaluation, with the same trigger named in
//    all three; a second verification of the same applicant writes a NEW row
//    rather than updating one; and no document-bearing key in a verified
//    webhook payload reaches any store."
//
// EVERY ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of `inject`, and
// every webhook payload is signed FOR REAL by the fake provider. A suite that
// stubbed the verifier would assert that a stub returns true.
//
// BOTH DIRECTIONS, WHERE THERE ARE TWO. The duplicate case is asserted AND a
// store whose uniqueness check is removed is watched applying the effect twice,
// because an assertion that passes against a broken store asserts nothing. The
// refusal cases assert the status code AND that the applier was never called,
// because a 401 returned after the effect landed looks identical from outside.
// =============================================================================

import { createHmac } from 'node:crypto';

import {
  FAKE_KYC_HEADERS,
  fakeKycProvider,
  fakeSignedBytes,
  type JsonObject,
  type KycProvider,
  type VerifiedKycEvent,
} from '@merit/kyc';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  resetAuthBackend,
  useAuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import {
  KYC_REQUIRED_FACTORS,
  KYC_SESSION_PATH,
  KYC_STATUS_PATH,
  attemptKey,
  productionKycDeps,
  resetKycDeps,
  useKycDeps,
  type KycBackend,
  type KycGateFacts,
  type KycVerificationDraft,
  type KycVerificationRow,
} from '../src/routes/kyc.ts';
import kycWebhookModule, {
  KYC_WEBHOOK_PATH,
  kycWebhookHandler,
  receiveKycWebhook,
  type KycEventApplier,
  type KycWebhookDeps,
  type KycWebhookEventRow,
  type KycWebhookRefusalRow,
  type KycWebhookStore,
  type KycWebhookTx,
} from '../src/routes/webhooks-kyc.ts';
import { installRawWebhookBodyParser } from '../src/routes/webhooks-psp.ts';

const NOW = new Date('2026-08-26T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const SECRET = 'kyc-shared-secret';
const TOKEN = 'session-token-1';

const SESSION: AuthSession = {
  id: 'sess_1',
  identityId: 'id_42',
  userId: 'usr_42',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

// -----------------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------------

/** The frozen v1 configuration, written as a plan version holds it: raw jsonb. */
const FROZEN_CONFIG: unknown = ['second_distinct_account_purchase', 'pre_funded'];

function facts(over: Partial<KycGateFacts> = {}): KycGateFacts {
  return {
    triggersConfig: FROZEN_CONFIG,
    planCode: 'CORE_EOD_50K',
    instantFunded: false,
    purchaseCount: 0,
    distinctConcurrentAccounts: 0,
    evaluationPassed: false,
    payoutRequested: false,
    attemptNumber: 1,
    retriesExhausted: false,
    ...over,
  };
}

/** What the fake backend wrote, so "a NEW row" is a number and not a feeling. */
interface BackendState {
  gate: KycGateFacts;
  current: KycVerificationRow | null;
  readonly drafts: KycVerificationDraft[];
}

let state: BackendState;

const backend: KycBackend = {
  gateFacts: () => Promise.resolve(state.gate),
  currentVerification: () => Promise.resolve(state.current),
  openVerification: (_session, draft) => {
    // THE ROWS ARE APPENDED AND NEVER REPLACED. INV-M19-06: a verification is a
    // new row and never a re-read of a stored result, and the port has no
    // update for a fixture to have implemented instead.
    state.drafts.push(draft);
    return Promise.resolve();
  },
};

const provider: KycProvider = fakeKycProvider({
  secret: SECRET,
  now: () => NOW,
  applicantRef: (applicant) => `app_${applicant.identityId}`,
  sessionTtlSeconds: 900,
  hostedBaseUrl: 'https://vendor.example/flow',
});

/** The provider, with the attempt key it was handed recorded for assertion. */
const keysSeen: string[] = [];
const recordingProvider: KycProvider = {
  provider: provider.provider,
  createSession: (applicant) => {
    keysSeen.push(applicant.idempotencyKey);
    return provider.createSession(applicant);
  },
  verifyWebhook: (raw, headers) => provider.verifyWebhook(raw, headers),
};

const onDisk = await discoverRouteModules();

async function call(options: {
  method: 'GET' | 'POST';
  path: string;
  token?: string | undefined;
  headers?: Record<string, string> | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: options.method, url: `${BASE_PATH}${options.path}` };
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token !== undefined) headers['cookie'] = `${SESSION_COOKIE}=${options.token}`;
  inject.headers = headers;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

beforeEach(() => {
  state = { gate: facts(), current: null, drafts: [] };
  keysSeen.length = 0;
  useAuthBackend({
    ...UNWIRED_AUTH_BACKEND,
    sessionByToken: (token) => Promise.resolve(token === TOKEN ? SESSION : null),
  });
  useKycDeps({
    provider: recordingProvider,
    backend,
    returnUrl: 'https://merit.example/kyc/done',
  });
});

afterEach(() => {
  resetAuthBackend();
  resetKycDeps();
});

// -----------------------------------------------------------------------------
// The declaration, which is API_CONTRACT section 12's column
// -----------------------------------------------------------------------------

describe('the declared factor is `session` on both, and is stated as data', () => {
  test('both endpoints declare `session` and neither declares elevation', () => {
    // Starting an identity check is not one of C-27's three sensitive actions,
    // and requiring a passkey to begin one would put elevation in front of the
    // gate that exists to establish who the person is.
    expect(KYC_REQUIRED_FACTORS).toEqual({
      [`POST ${KYC_SESSION_PATH}`]: 'session',
      [`GET ${KYC_STATUS_PATH}`]: 'session',
    });
  });

  test('an unauthenticated caller gets 401 on both, never 403', () => {
    return Promise.all([
      call({ method: 'POST', path: KYC_SESSION_PATH }).then((res) => {
        expect(res.statusCode).toBe(401);
      }),
      call({ method: 'GET', path: KYC_STATUS_PATH }).then((res) => {
        expect(res.statusCode).toBe(401);
      }),
    ]);
  });
});

// -----------------------------------------------------------------------------
// POST /kyc/session
// -----------------------------------------------------------------------------

describe('POST /kyc/session hands the trader to the vendor and keeps a reference', () => {
  test('a reached gate answers API_CONTRACT section 7s four fields and no fifth', async () => {
    state.gate = facts({ purchaseCount: 2, distinctConcurrentAccounts: 2 });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      provider: 'fake_kyc_a',
      hosted_url: 'https://vendor.example/flow/app_id_42',
      expires_at: '2026-08-26T12:15:00.000Z',
      applicant_ref: 'app_id_42',
    });
  });

  test('MERIT NEVER PROXIES: the response is a URL and carries no document field', async () => {
    state.gate = facts({ purchaseCount: 2, distinctConcurrentAccounts: 2 });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    const body = res.json() as Record<string, unknown>;
    // INV-M19-07 at the surface: there is no field here a document could be in,
    // and the only thing pointing at the provider is a link the client follows.
    expect(Object.keys(body).sort()).toEqual([
      'applicant_ref',
      'expires_at',
      'hosted_url',
      'provider',
    ]);
    expect(String(body['hosted_url'])).toMatch(/^https:\/\/vendor\.example\//);
  });

  test('the row records the TRIGGER THAT FIRED and the plan that configured it', async () => {
    state.gate = facts({ purchaseCount: 2, distinctConcurrentAccounts: 2 });
    await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0]).toMatchObject({
      provider: 'fake_kyc_a',
      providerApplicantId: 'app_id_42',
      placement: 'second_distinct_account_purchase',
      planCode: 'CORE_EOD_50K',
      attemptNumber: 1,
    });
  });

  test('BOTH TRIGGERS TRUE IN EITHER ORDER RECORD THE SAME PLACEMENT', async () => {
    // The approval line at the route level. The two orders are the two ways a
    // trader can arrive here, and the recorded placement has to be the one that
    // fired FIRST in time or the funnel data means nothing.
    const secondAccountThenEval = facts({
      purchaseCount: 2,
      distinctConcurrentAccounts: 2,
      evaluationPassed: true,
    });
    const evalThenSecondAccount = facts({
      evaluationPassed: true,
      distinctConcurrentAccounts: 2,
      purchaseCount: 2,
    });

    state.gate = secondAccountThenEval;
    await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    state = { gate: evalThenSecondAccount, current: null, drafts: [] };
    await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });

    expect(state.drafts[0]?.placement).toBe('second_distinct_account_purchase');
  });

  test('`pre_funded` alone fires it, and records ITS name', async () => {
    state.gate = facts({ purchaseCount: 1, distinctConcurrentAccounts: 1, evaluationPassed: true });
    await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(state.drafts[0]?.placement).toBe('pre_funded');
  });

  test('INV-M19-02: an instant-funded plan fires at purchase whatever is configured', async () => {
    state.gate = facts({ instantFunded: true, purchaseCount: 1, distinctConcurrentAccounts: 1 });
    await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(state.drafts[0]?.placement).toBe('direct_purchase');
  });

  test('no trigger reached is 409 and the detail names what this plan watches', async () => {
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json() as Record<string, unknown>;
    expect(body['code']).toBe('conflict');
    expect(String(body['detail'])).toContain('second_distinct_account_purchase');
    expect(state.drafts).toHaveLength(0);
  });

  test('a first purchase does NOT fire the frozen set, and that is the ruling', async () => {
    // ADR-021 rejected lineup-wide `pre_eval`: a $2 identity check in front of a
    // $79 impulse purchase that no major competitor gates.
    state.gate = facts({ purchaseCount: 1, distinctConcurrentAccounts: 1 });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(409);
  });
});

describe('an existing verification decides whether a new session may open', () => {
  const row = (over: Partial<KycVerificationRow>): KycVerificationRow => ({
    state: 'pending',
    placement: 'pre_funded',
    verifiedAt: null,
    expiresAt: null,
    providerApplicantId: 'app_id_42',
    providerRejectionCode: null,
    ...over,
  });

  const reached = (): KycGateFacts =>
    facts({ purchaseCount: 2, distinctConcurrentAccounts: 2, attemptNumber: 2 });

  test('a pending verification refuses a second one', async () => {
    state.gate = reached();
    state.current = row({ state: 'pending' });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(409);
    expect(String((res.json() as Record<string, unknown>)['detail'])).toContain('already open');
  });

  test('a verified identity refuses another', async () => {
    state.gate = reached();
    state.current = row({ state: 'verified', verifiedAt: '2026-08-01T00:00:00Z' });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(409);
  });

  test('an EXPIRED verification refuses, because re-verification is not this endpoint', async () => {
    // SD-M19-01 requires a new row with `verification_purpose = reverify_expiry`
    // and `supersedes` set. Writing an `initial` row here would break the
    // supersession chain INV-M19-06 exists to keep.
    state.gate = reached();
    state.current = row({ state: 'expired', expiresAt: '2026-08-01T00:00:00Z' });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(409);
    expect(String((res.json() as Record<string, unknown>)['detail'])).toContain('re-verification');
  });

  test('A REJECTED VERIFICATION WITH RETRIES LEFT WRITES A NEW ROW, NOT AN UPDATE', async () => {
    // The approval line's second clause. M19 section 3.1: rejection is not
    // terminal, because the overwhelming majority of rejections are document
    // quality, lighting and expired identification rather than fraud.
    state.gate = reached();
    state.current = row({ state: 'rejected', providerRejectionCode: 'BLURRY_DOC' });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(state.drafts).toHaveLength(1);
    // A NEW attempt against the SAME applicant reference.
    expect(state.drafts[0]?.attemptNumber).toBe(2);
    expect(state.drafts[0]?.providerApplicantId).toBe('app_id_42');
  });

  test('a rejected verification with the retries exhausted reaches a human', async () => {
    state.gate = facts({
      purchaseCount: 2,
      distinctConcurrentAccounts: 2,
      retriesExhausted: true,
    });
    state.current = row({ state: 'rejected' });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(409);
    expect(String((res.json() as Record<string, unknown>)['detail'])).toContain('Support');
  });
});

describe('the attempt key, and what it is not', () => {
  test('a supplied Idempotency-Key reaches the vendor verbatim', async () => {
    state.gate = facts({ purchaseCount: 2, distinctConcurrentAccounts: 2 });
    await call({
      method: 'POST',
      path: KYC_SESSION_PATH,
      token: TOKEN,
      headers: { 'idempotency-key': 'client-chosen-1' },
    });
    expect(keysSeen).toEqual(['client-chosen-1']);
  });

  test('with no header the key is DERIVED from the attempt and never generated', async () => {
    state.gate = facts({ purchaseCount: 2, distinctConcurrentAccounts: 2, attemptNumber: 3 });
    await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(keysSeen).toEqual([attemptKey('id_42', 3)]);
  });

  test('a new attempt is a new key, which is what makes a retry not a duplicate', () => {
    expect(attemptKey('id_42', 1)).not.toBe(attemptKey('id_42', 2));
  });
});

describe('the deployment answers 503 rather than running a fake', () => {
  test('no vendor and no return URL is service_unavailable', async () => {
    useKycDeps(productionKycDeps);
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(503);
    expect((res.json() as Record<string, unknown>)['code']).toBe('service_unavailable');
  });

  test('a vendor with no return URL is also 503: ADR-012 holds no hostname', async () => {
    useKycDeps({ provider: recordingProvider, backend, returnUrl: null });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(503);
  });

  test('an unwired backend is 503 and not a plausible value', async () => {
    useKycDeps({ provider: recordingProvider, backend: productionKycDeps.backend, returnUrl: 'x' });
    const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
    expect(res.statusCode).toBe(503);
  });
});

describe('INV-M19-01: a configuration this route cannot read is a 500, never a default', () => {
  const bad: readonly (readonly [string, unknown])[] = [
    ['a missing key', undefined],
    ['the retired singular', 'pre_funded'],
    ['an empty set', []],
    ['a retired member', ['pre_eval']],
    ['`payout_request` alone', ['payout_request']],
  ];
  for (const [what, config] of bad) {
    test(`${what} answers 500 and gates nobody`, async () => {
      state.gate = facts({
        triggersConfig: config,
        purchaseCount: 3,
        distinctConcurrentAccounts: 3,
        evaluationPassed: true,
      });
      const res = await call({ method: 'POST', path: KYC_SESSION_PATH, token: TOKEN });
      // A reader that substituted the frozen set here would gate a trader under
      // a configuration nobody pinned, which is the hardcode INV-M19-01 locks.
      expect(res.statusCode).toBe(500);
      expect(state.drafts).toHaveLength(0);
    });
  }
});

// -----------------------------------------------------------------------------
// GET /kyc/status
// -----------------------------------------------------------------------------

describe('GET /kyc/status says what is true and what to do next', () => {
  test('no verification and no gate reached: kyc_required and the trigger that WILL fire', async () => {
    const res = await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      state: 'kyc_required',
      placement: 'second_distinct_account_purchase',
      verified_at: null,
      expires_at: null,
      action_required: null,
    });
  });

  test('a gate reached with nothing started asks the trader to start', async () => {
    state.gate = facts({ purchaseCount: 2, distinctConcurrentAccounts: 2 });
    const res = await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN });
    expect(res.json()).toMatchObject({
      state: 'kyc_required',
      placement: 'second_distinct_account_purchase',
      action_required: 'start_verification',
    });
  });

  test('a verified identity reports its own placement and its verified_at', async () => {
    state.current = {
      state: 'verified',
      placement: 'pre_funded',
      verifiedAt: '2026-08-20T09:00:00Z',
      expiresAt: '2027-08-20T09:00:00Z',
      providerApplicantId: 'app_id_42',
      providerRejectionCode: null,
    };
    expect((await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN })).json()).toEqual({
      state: 'verified',
      placement: 'pre_funded',
      verified_at: '2026-08-20T09:00:00Z',
      expires_at: '2027-08-20T09:00:00Z',
      action_required: null,
    });
  });

  test("INV-M19-09: THE PROVIDER'S OWN REASON REACHES NO RESPONSE", async () => {
    const vendorReason = 'DOC_UNSUPPORTED_COUNTRY_SUBTYPE_7';
    state.current = {
      state: 'rejected',
      placement: 'pre_funded',
      verifiedAt: null,
      expiresAt: null,
      providerApplicantId: 'app_id_42',
      providerRejectionCode: vendorReason,
    };
    const res = await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN });
    // The row this handler read HAS the reason, and the body does not contain
    // it anywhere: not in a field, not in a message, not in a detail.
    expect(res.body).not.toContain(vendorReason);
    expect(res.json()).toMatchObject({ action_required: 'retry_verification' });
  });

  test('the applicant reference is not in the status body either', async () => {
    state.current = {
      state: 'pending',
      placement: 'pre_funded',
      verifiedAt: null,
      expiresAt: null,
      providerApplicantId: 'app_secret_ref',
      providerRejectionCode: null,
    };
    const res = await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN });
    // API_CONTRACT section 1's allowlist: a field not in the schema is not in
    // the response, so an added column never leaks by default.
    expect(res.body).not.toContain('app_secret_ref');
    expect(res.json()).toMatchObject({ action_required: 'continue_verification' });
  });

  const actions: readonly (readonly [KycVerificationRow['state'], boolean, string | null])[] = [
    ['pending', false, 'continue_verification'],
    ['rejected', false, 'retry_verification'],
    ['rejected', true, 'contact_support'],
    ['expired', false, 'reverify'],
    ['verified', false, null],
  ];
  for (const [rowState, exhausted, expected] of actions) {
    test(`${rowState}${exhausted ? ' with retries exhausted' : ''} asks for ${String(expected)}`, async () => {
      state.gate = facts({ retriesExhausted: exhausted });
      state.current = {
        state: rowState,
        placement: 'pre_funded',
        verifiedAt: null,
        expiresAt: null,
        providerApplicantId: 'app_id_42',
        providerRejectionCode: null,
      };
      const res = await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN });
      expect((res.json() as Record<string, unknown>)['action_required']).toBe(expected);
    });
  }

  test('the pending trigger on an instant plan is the one INV-M19-02 imposes', async () => {
    state.gate = facts({ instantFunded: true });
    const res = await call({ method: 'GET', path: KYC_STATUS_PATH, token: TOKEN });
    expect((res.json() as Record<string, unknown>)['placement']).toBe('direct_purchase');
  });
});

// -----------------------------------------------------------------------------
// POST /webhooks/kyc/:provider
// -----------------------------------------------------------------------------

/** The business effect, so "exactly one" is a number. */
interface Effect {
  readonly providerEventId: string;
}

class FakeKycWebhookStore implements KycWebhookStore {
  rows: KycWebhookEventRow[] = [];
  effects: Effect[] = [];
  readonly refusals: KycWebhookRefusalRow[] = [];
  /** The unique index this port rides on. Settable, so the seed is real. */
  uniquenessEnforced = true;

  async transact<T>(fn: (tx: KycWebhookTx) => Promise<T>): Promise<T> {
    const rowsAtBegin = [...this.rows];
    const effectsAtBegin = [...this.effects];
    let rolledBack = false;
    const tx: KycWebhookTx = {
      record: (row) => {
        const clash =
          this.uniquenessEnforced &&
          this.rows.some(
            (r) => r.provider === row.provider && r.providerEventId === row.providerEventId,
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
    const result = await fn(tx);
    if (rolledBack) {
      this.rows = rowsAtBegin;
      this.effects = effectsAtBegin;
    }
    return result;
  }

  recordRefusal(row: KycWebhookRefusalRow): Promise<void> {
    this.refusals.push(row);
    return Promise.resolve();
  }
}

const DECIDED: JsonObject = {
  event_id: 'evt_0001',
  applicant_id: 'app_id_42',
  type: 'applicant.reviewed',
  outcome: 'verified',
  liveness_passed: true,
  liveness_method: 'passive_3d',
  face_match_score: 9820,
};

function bodyOf(payload: JsonObject): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function signedHeaders(raw: Uint8Array, seconds = NOW_SECONDS): Record<string, string> {
  const nonce = 'nonce-0001';
  return {
    [FAKE_KYC_HEADERS.signature]: createHmac('sha256', SECRET)
      .update(fakeSignedBytes(seconds, nonce, raw))
      .digest('base64'),
    [FAKE_KYC_HEADERS.timestamp]: String(seconds),
    [FAKE_KYC_HEADERS.nonce]: nonce,
  };
}

function webhookDeps(store: FakeKycWebhookStore, applier: KycEventApplier): KycWebhookDeps {
  return {
    providers: (name) => (name === 'fake_kyc_a' ? provider : null),
    store,
    applier,
    now: () => NOW,
  };
}

/** An applier that records what it was asked to apply, and applies it. */
function recordingApplier(store: FakeKycWebhookStore): KycEventApplier & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    apply: (event: VerifiedKycEvent) => {
      seen.push(event.providerEventId);
      store.effects.push({ providerEventId: event.providerEventId });
      return Promise.resolve({ kind: 'applied' as const });
    },
  };
}

describe('the KYC webhook, on the receiver directly', () => {
  test('an unknown provider is 404 before a byte of the body is read', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const result = await receiveKycWebhook({
      provider: 'not_a_vendor',
      raw: bodyOf(DECIDED),
      headers: {},
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result.status).toBe(404);
    expect(applier.seen).toEqual([]);
    expect(store.refusals).toEqual([]);
  });

  test('a deployment with no store answers 503 and verifies NOTHING', async () => {
    const raw = bodyOf(DECIDED);
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: { providers: () => provider, store: null, applier: null, now: () => NOW },
    });
    // Section 10 requires the raw payload stored. A receiver that verified and
    // then discarded would answer 200 for an event nobody can re-drive.
    expect(result.status).toBe(503);
  });

  test('a verified decision is applied, claimed and answered 200', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result).toEqual({ status: 200, body: { received: true }, isProblem: false });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      provider: 'fake_kyc_a',
      providerEventId: 'evt_0001',
      providerApplicantId: 'app_id_42',
      processingResult: 'applied',
      processedAt: NOW,
      deferAttempts: 0,
    });
    expect(store.effects).toHaveLength(1);
  });

  test('THE SAME EVENT TWICE IS ONE EFFECT AND TWO IDENTICAL 200s', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const args = {
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    };
    const first = await receiveKycWebhook(args);
    const second = await receiveKycWebhook(args);
    expect(second).toEqual(first);
    expect(store.rows).toHaveLength(1);
    expect(store.effects).toHaveLength(1);
    // The applier RAN twice and its effect survived once, which is the rollback
    // doing the work rather than a check somebody remembered.
    expect(applier.seen).toEqual(['evt_0001', 'evt_0001']);
  });

  test('SEEDED: with the uniqueness check removed the effect lands TWICE', async () => {
    // The other direction. An assertion that passes against a broken store
    // asserts nothing, and this is what the previous test would look like if
    // the index this receiver rides on were not there.
    const store = new FakeKycWebhookStore();
    store.uniquenessEnforced = false;
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const args = {
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    };
    await receiveKycWebhook(args);
    await receiveKycWebhook(args);
    expect(store.rows).toHaveLength(2);
    expect(store.effects).toHaveLength(2);
  });

  test('an unverified signature is 401, is recorded, and NEVER reaches the applier', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const headers = signedHeaders(raw);
    headers[FAKE_KYC_HEADERS.signature] = 'AAAA';
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers,
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result.status).toBe(401);
    expect(applier.seen).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(store.refusals).toHaveLength(1);
    expect(store.refusals[0]).toMatchObject({
      signatureVerified: false,
      processingResult: 'rejected_signature',
      refusal: 'signature_mismatch',
    });
  });

  test('a refused payload retried writes ONE row, because the id is its digest', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const headers = signedHeaders(raw);
    headers[FAKE_KYC_HEADERS.signature] = 'AAAA';
    const args = {
      provider: 'fake_kyc_a',
      raw,
      headers,
      instance: 'r',
      deps: webhookDeps(store, applier),
    };
    await receiveKycWebhook(args);
    await receiveKycWebhook(args);
    const ids = new Set(store.refusals.map((r) => r.providerEventId));
    expect(ids.size).toBe(1);
  });

  test('a stale timestamp is refused and reported as the window, not the signature', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw, NOW_SECONDS - 301),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result.status).toBe(401);
    expect(store.refusals[0]).toMatchObject({ refusal: 'timestamp_outside_window' });
  });

  test('an out-of-order event is DEFERRED and its row is not marked processed', async () => {
    const store = new FakeKycWebhookStore();
    const until = new Date('2026-08-26T12:05:00.000Z');
    const applier: KycEventApplier = {
      apply: () => Promise.resolve({ kind: 'deferred' as const, until }),
    };
    const raw = bodyOf(DECIDED);
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result.status).toBe(200);
    expect(store.rows[0]).toMatchObject({
      processingResult: 'out_of_order_deferred',
      processedAt: null,
      deferredUntil: until,
      deferAttempts: 0,
    });
  });
});

describe('INV-M19-07: a document in a VERIFIED payload never reaches a store', () => {
  // NOT A REAL BASE64 IMAGE HEADER. `CI-05`'s `generic-api-key` rule read the
  // first draft's copy of one as a credential, and a fixture standing in for a
  // document does not need to be a convincing document to a scanner. It needs
  // to be a value the assertion can prove did not travel.
  const documentBytes = 'FAKE-PNG-BYTES-NOT-A-CREDENTIAL';
  const withDocument: JsonObject = { ...DECIDED, document_image: documentBytes };

  test('the event is refused with 400 and the applier is never called', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(withDocument);
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result.status).toBe(400);
    expect(applier.seen).toEqual([]);
    // NOTHING WAS STORED. `kyc_verifications` is retained forever under an AML
    // obligation, which is exactly why nothing that must not be kept forever
    // may enter it.
    expect(store.rows).toEqual([]);
  });

  test('THE REFUSAL RECORD CARRIES PATHS AND NEVER VALUES', async () => {
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(withDocument);
    await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(store.refusals).toHaveLength(1);
    const refusal = store.refusals[0];
    expect(refusal).toMatchObject({
      signatureVerified: true,
      processingResult: 'rejected_document',
      refusal: 'document_in_payload',
      providerEventId: 'evt_0001',
    });
    expect(refusal?.evidence).toEqual({ document_bearing_paths: ['document_image'] });
    // The image is nowhere in what was written down.
    expect(JSON.stringify(refusal)).not.toContain(documentBytes);
  });

  test('a clean decision with scores is NOT refused, which is INV-M19-12', async () => {
    // `evidence_snapshot` holds "scores, method, timestamps. NEVER images", so a
    // screen that refused a score would refuse the payload M19 exists to record.
    const store = new FakeKycWebhookStore();
    const applier = recordingApplier(store);
    const raw = bodyOf(DECIDED);
    const result = await receiveKycWebhook({
      provider: 'fake_kyc_a',
      raw,
      headers: signedHeaders(raw),
      instance: 'req_1',
      deps: webhookDeps(store, applier),
    });
    expect(result.status).toBe(200);
    expect(store.rows[0]?.payload).toEqual(DECIDED);
  });
});

describe('the webhook through the real router', () => {
  async function inject(options: {
    body: JsonObject;
    rawParser: boolean;
    deps: KycWebhookDeps;
  }): Promise<LightMyRequestResponse> {
    const module = {
      name: 'webhooks-kyc',
      routes: [
        {
          method: 'POST' as const,
          path: KYC_WEBHOOK_PATH,
          handler: kycWebhookHandler(options.deps),
        },
      ],
    };
    const { app } = buildServer({ surface: 'public', modules: [module] });
    if (options.rawParser) installRawWebhookBodyParser(app);
    await app.ready();
    const raw = bodyOf(options.body);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE_PATH}/webhooks/kyc/fake_kyc_a`,
      headers: { ...signedHeaders(raw), 'content-type': 'application/json' },
      payload: Buffer.from(raw),
    });
    await app.close();
    return res;
  }

  test('with the raw parser installed a signed decision answers 200', async () => {
    const store = new FakeKycWebhookStore();
    const res = await inject({
      body: DECIDED,
      rawParser: true,
      deps: webhookDeps(store, recordingApplier(store)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });

  test('WITHOUT IT THE HANDLER REFUSES RATHER THAN RECONSTRUCTING THE BYTES', async () => {
    // A handler that reached for JSON.stringify(request.body) would verify a
    // DIFFERENT DOCUMENT, every legitimate webhook would answer 401, and the
    // diagnosis a reader reaches for is "the provider's secret is wrong". The
    // 500 is loud on purpose.
    const store = new FakeKycWebhookStore();
    const res = await inject({
      body: DECIDED,
      rawParser: false,
      deps: webhookDeps(store, recordingApplier(store)),
    });
    expect(res.statusCode).toBe(500);
    expect(store.rows).toEqual([]);
  });

  test('THE REGISTERED PRODUCTION ROUTE ANSWERS 404, BECAUSE NO VENDOR IS SELECTED', async () => {
    const { app } = buildServer({ surface: 'public', modules: [kycWebhookModule] });
    installRawWebhookBodyParser(app);
    await app.ready();
    const raw = bodyOf(DECIDED);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE_PATH}/webhooks/kyc/fake_kyc_a`,
      headers: { ...signedHeaders(raw), 'content-type': 'application/json' },
      payload: Buffer.from(raw),
    });
    await app.close();
    // THE ROUTE IS REGISTERED AND ITS 404 IS THE RESOLVER'S, NOT THE ROUTER'S,
    // and the difference is worth an assertion rather than a shrug. `:provider`
    // names a resource, no vendor has been selected (ADR-021 makes that a
    // DISCLOSURE decision), so every provider name is genuinely not found. The
    // 503 is the other leg: a deployment that HAS a vendor and no store.
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.json() as Record<string, unknown>)['code']).toBe('not_found');
  });
});
