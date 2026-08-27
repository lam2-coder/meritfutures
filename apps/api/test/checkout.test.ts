// =============================================================================
// apps/api/test/checkout.test.ts
// =============================================================================
// CI-02, the `unit` project.
//
// TWO CLAIMS ARE ASSERTED HERE AND EVERYTHING ELSE IN THIS FILE EXISTS TO MAKE
// THEM MEAN SOMETHING.
//
//   1. API_CONTRACT SECTION 12's CHECKOUT ROW, IN BOTH DIRECTIONS. "Checkout
//      with a client-supplied price field -> field ignored; server price used."
//      Asserting only that a tampered price is refused cannot tell a working
//      price lookup from one that refuses everything, so the honest path is
//      asserted to produce THE PRICE THE SERVER COMPUTED, from the same seed,
//      in the same shape.
//
//   2. THIS SESSION'S APPROVAL LINE. "A checkout whose attribution write fails
//      leaves NO purchase row." It is driven by SEEDING A FAILURE IN THE
//      ATTRIBUTION WRITE and asserting the purchase absent, and its opposite is
//      asserted from the same fixture with the seed removed, because a store
//      that never held a purchase would pass the first half on its own.
//
// THE FIXTURE'S TRANSACTION IS A REAL ONE, WHICH IS THE PART THAT COULD HAVE
// BEEN FAKED AND MUST NOT BE. `transact` runs the handler against a STAGING
// copy of the store and merges it into the committed store only if the handler
// returns. A fake that wrote straight through would pass every assertion about
// the happy path and would silently make claim 2 unfalsifiable.
//
// EVERY ASSERTION GOES THROUGH FASTIFY'S REAL ROUTER by way of `inject`, and
// the modules come from `discoverRouteModules`, so what is exercised is what
// the deployment composes rather than a hand-built list that could omit the
// file under test.
//
// MONEY IS `bigint` CENTS IN EVERY SEED AND EVERY EXPECTATION IN THIS FILE. The
// wire carries JSON integers, per API_CONTRACT section 1, and the only place a
// `number` appears is at that boundary.
// =============================================================================

import { readFileSync } from 'node:fs';

import {
  ENRICHMENT_CONTRACT_VERSION,
  ENRICHMENT_EVENT_NAME,
  ENRICHMENT_FIELD_ALLOWLIST,
  ENRICHMENT_INTEGRATION,
  ENRICHMENT_TIMEOUT_MS,
  SCORE_SCALE_BP,
  answeringVendor,
  failingVendor,
  hangingVendor,
} from '@merit/enrichment';
import type { EnrichmentAdapter, EnrichmentTx, ObserveOutcome } from '@merit/enrichment';
import { createPspAFake } from '@merit/psp';
import type { MidCandidate, PspAdapter, PspId } from '@merit/psp';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  resetAuthBackend,
  useAuthBackend,
} from '../src/routes/auth.ts';
import type { AuthBackend, AuthSession } from '../src/routes/auth.ts';
import {
  CHECKOUT_PATH,
  CHECKOUT_REQUIRED_FACTORS,
  RESET_PATH,
  centsToJson,
  recomputeDiscount,
  resetCheckoutWiring,
  useCheckoutAdapters,
  useCheckoutBackend,
} from '../src/routes/checkout.ts';
import type {
  AccountCapRow,
  CheckoutAdapters,
  CheckoutBackend,
  CheckoutEnrichment,
  CheckoutTx,
  CouponRow,
  GeoDecisionRow,
  PlanVersionRow,
  PlanVersionSizeRow,
  PurchaseInsert,
  ResetTargetRow,
} from '../src/routes/checkout.ts';
import type { AffiliateRef, AttributionRow, ClickRef } from '@merit/affiliate';

// -----------------------------------------------------------------------------
// The seed. Every figure is integer cents and every one is read, never restated.
// -----------------------------------------------------------------------------

const BUYER_IDENTITY = 'identity-buyer';
const TOKEN = 'session-token-buyer';

const SESSION: AuthSession = {
  id: 'session-1',
  identityId: BUYER_IDENTITY,
  userId: 'user-1',
  authFactor: 'email_otp',
  elevatedAt: null,
  elevatedByFactor: null,
};

const PLAN_ID = 'plan-core-eod';
const PLAN_VERSION_ID = 'plan-version-core-eod-1';

/**
 * One `plan_version_sizes` row. THE ONLY PRICE IN THIS FILE.
 *
 * Every expectation below is derived from these two figures rather than
 * restating them, so a seed that moves moves the assertions with it. That is
 * `auth.test.ts`'s rule about `send_limit` applied to money.
 */
const SIZE: PlanVersionSizeRow = {
  sizeCents: 5_000_000n,
  priceCents: 34_900n,
  resetPriceCents: 24_900n,
};

const CODE_AFFILIATE: AffiliateRef = {
  affiliateId: 'affiliate-code',
  identityId: 'identity-code-affiliate',
};

const CLICK_AFFILIATE: AffiliateRef = {
  affiliateId: 'affiliate-click',
  identityId: 'identity-click-affiliate',
};

const CLICK_TOKEN = 'click-token-live';

function baseCoupon(over: Partial<CouponRow>): CouponRow {
  return {
    couponId: 'coupon-launch',
    discountKind: 'percent',
    discountBp: 2_000,
    discountCents: null,
    appliesToKind: 'any',
    firstPurchaseOnly: false,
    isActive: true,
    startsAt: null,
    expiresAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    perIdentityLimit: 1,
    affiliate: null,
    ...over,
  };
}

const COUPONS: Readonly<Record<string, CouponRow>> = {
  LAUNCH20: baseCoupon({}),
  AFF10: baseCoupon({
    couponId: 'coupon-aff',
    discountBp: 1_000,
    affiliate: CODE_AFFILIATE,
  }),
  RESETONLY: baseCoupon({ couponId: 'coupon-reset', appliesToKind: 'reset' }),
  FIVER: baseCoupon({
    couponId: 'coupon-fixed',
    discountKind: 'fixed',
    discountBp: null,
    discountCents: 500n,
  }),
  SPENT: baseCoupon({ couponId: 'coupon-spent', maxRedemptions: 1, redemptionCount: 1 }),
};

const RESET_TARGET: ResetTargetRow = {
  accountId: 'account-breached-1',
  planVersionId: PLAN_VERSION_ID,
  sizeCents: SIZE.sizeCents,
  resettable: true,
};

// -----------------------------------------------------------------------------
// The store, and a transaction that really rolls back
// -----------------------------------------------------------------------------

interface SignalRow {
  id: string;
  kind: unknown;
  valueHash: unknown;
  observationCount: number;
}

interface Store {
  purchases: PurchaseInsert[];
  attributions: { purchaseId: string; row: AttributionRow }[];
  redemptions: { couponId: string; purchaseId: string }[];
  tos: { versionIds: readonly string[]; ip: string }[];
  /** `identity_signals`, as `packages/enrichment` writes them. */
  signals: SignalRow[];
  /** `integration_dispatches`. One per purchase, per ADR-115 clause 4. */
  dispatches: Readonly<Record<string, unknown>>[];
}

function emptyStore(): Store {
  return {
    purchases: [],
    attributions: [],
    redemptions: [],
    tos: [],
    signals: [],
    dispatches: [],
  };
}

function copyStore(store: Store): Store {
  return {
    purchases: [...store.purchases],
    attributions: [...store.attributions],
    redemptions: [...store.redemptions],
    tos: [...store.tos],
    // THE ENRICHMENT ROWS STAGE WITH EVERYTHING ELSE, which is the half of
    // `packages/enrichment/src/tx.ts`'s ruling this fixture can actually model:
    // "an observation of a checkout that did not happen is worse than no
    // observation". A signal written on a checkout that rolls back is discarded
    // with it, and a case below asserts exactly that.
    signals: store.signals.map((row) => ({ ...row })),
    dispatches: [...store.dispatches],
  };
}

/** What a test steers. Everything else is the seed. */
interface Fixture {
  committed: Store;
  cap: AccountCapRow;
  geo: GeoDecisionRow;
  mids: MidCandidate[];
  planPublished: boolean;
  resetTarget: ResetTargetRow | null;
  /** Live claims, so a second claim of one code by this identity loses. */
  claimed: Set<string>;
  /** THE SEED FOR SESSION 220's APPROVAL LINE. When set, `insertAttribution` throws it. */
  attributionFailure: Error | null;
  /** ADR-023 step 1's wiring, or `null` for a deployment that observes nothing. */
  enrichment: CheckoutEnrichment | null;
  /** Every `ObserveOutcome` the call site reported, in order. */
  outcomes: ObserveOutcome[];
  /** When set, the enrichment writer's `insert` rejects with it. */
  enrichmentWriteFailure: Error | null;
  /** When set, the enrichment REPORTER throws it. ADR-115's control 3. */
  reporterFailure: Error | null;
}

let fixture: Fixture;

function freshFixture(): Fixture {
  return {
    committed: emptyStore(),
    cap: {
      liveAccounts: 1,
      maxAccounts: 3,
      identityStatus: 'active',
      hasPriorPurchase: false,
    },
    geo: { countryCode: 'US', decision: 'allowed' },
    mids: [
      { psp: 'psp_a', state: 'healthy' },
      { psp: 'psp_b', state: 'healthy' },
    ],
    planPublished: true,
    resetTarget: RESET_TARGET,
    claimed: new Set<string>(),
    attributionFailure: null,
    enrichment: null,
    outcomes: [],
    enrichmentWriteFailure: null,
    reporterFailure: null,
  };
}

function txOver(staging: Store): CheckoutTx {
  return {
    publishedPlanVersion: (planId: string): Promise<PlanVersionRow | null> =>
      Promise.resolve(
        fixture.planPublished && planId === PLAN_ID ? { planVersionId: PLAN_VERSION_ID } : null,
      ),

    planVersionSize: (planVersionId: string, sizeCents: bigint) =>
      Promise.resolve(
        planVersionId === PLAN_VERSION_ID && sizeCents === SIZE.sizeCents ? SIZE : null,
      ),

    accountCap: () => Promise.resolve(fixture.cap),

    couponByCode: (code: string) => Promise.resolve(COUPONS[code.toUpperCase()] ?? null),

    claimCoupon: (couponId: string, purchaseId: string) => {
      // `coupon_redemptions_live_claim_uq (coupon_id, identity_id) WHERE
      // released_at IS NULL`, as the database decides it: the INSERT is the
      // race, never a read-then-write.
      if (fixture.claimed.has(couponId)) return Promise.resolve('already_claimed' as const);
      fixture.claimed.add(couponId);
      staging.redemptions.push({ couponId, purchaseId });
      return Promise.resolve('claimed' as const);
    },

    clickByToken: (token: string): Promise<ClickRef | null> =>
      Promise.resolve(
        token === CLICK_TOKEN
          ? {
              clickId: 991n,
              affiliate: CLICK_AFFILIATE,
              clickedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            }
          : null,
      ),

    resetTarget: (accountId: string) =>
      Promise.resolve(
        fixture.resetTarget !== null && fixture.resetTarget.accountId === accountId
          ? fixture.resetTarget
          : null,
      ),

    geoDecision: () => Promise.resolve(fixture.geo),

    midCandidates: () => Promise.resolve(fixture.mids),

    recordTosAcceptance: (versionIds: readonly string[], ip: string) => {
      staging.tos.push({ versionIds, ip });
      return Promise.resolve();
    },

    insertPurchase: (row: PurchaseInsert) => {
      staging.purchases.push(row);
      return Promise.resolve();
    },

    insertAttribution: (purchaseId: string, row: AttributionRow) => {
      if (fixture.attributionFailure !== null) return Promise.reject(fixture.attributionFailure);
      staging.attributions.push({ purchaseId, row });
      return Promise.resolve();
    },

    // The producer does not exist in this workspace, so every implementation in
    // this tree answers `null` and `@merit/affiliate` refuses to read that as a
    // verdict of zero.
    linkConfidence: () => Promise.resolve(null),

    enrichment: enrichmentTxOver(staging),
  };
}

/**
 * `EnrichmentTx` over the SAME staging store, which is the point.
 *
 * `packages/enrichment` takes the caller's open transaction with no overload
 * that omits it, so an observation commits with the purchase that caused it or
 * not at all. A fake that wrote to its own array would satisfy every type here
 * and would make that property untestable, which is this file's own rule about
 * `transact` applied one table down.
 *
 * WHAT IT CANNOT MODEL, SAID HERE RATHER THAN IMPLIED. ADR-115 clause 2 states
 * that when a write THIS PACKAGE issues fails, the caller's transaction is
 * ALREADY aborted before `observeEnrichment`'s catch runs: Postgres puts the
 * transaction into the aborted state at the failing statement and turns its
 * `COMMIT` into a `ROLLBACK`. Nothing in a JavaScript staging store does that.
 * So the write-failure case below asserts what is true HERE, that the throw does
 * not escape and the outcome is reported as `record_failed`, and says in its own
 * comment that the rollback is Postgres's and is not observable in this suite. A
 * test that claimed otherwise would be asserting a fact about a database this
 * file never opens.
 */
function enrichmentTxOver(staging: Store): EnrichmentTx {
  let next = 0;
  return {
    rowsWhere: (_key, where) =>
      Promise.resolve(
        staging.signals.filter(
          (row) => row.kind === where['kind'] && row.valueHash === where['valueHash'],
        ),
      ),

    insert: (key, values) => {
      if (fixture.enrichmentWriteFailure !== null) {
        return Promise.reject(fixture.enrichmentWriteFailure);
      }
      if (key === 'identitySignals') {
        next += 1;
        const row: SignalRow = {
          id: `signal-${String(next)}`,
          kind: values['kind'],
          valueHash: values['valueHash'],
          observationCount: 1,
        };
        staging.signals.push(row);
        return Promise.resolve([row]);
      }
      staging.dispatches.push(values);
      return Promise.resolve([values]);
    },

    updateAt: (_key, at, values) => {
      const row = staging.signals.find((candidate) => candidate.id === at['id']);
      if (row === undefined) return Promise.resolve([]);
      row.observationCount = values['observationCount'] as number;
      return Promise.resolve([row]);
    },
  };
}

/**
 * The wiring a deployment that observes would install, over a fake vendor.
 *
 * THE CLOCK IS FIXED AND THE TIMEOUT IS NOT PASSED. `ENRICHMENT_TIMEOUT_MS` is
 * 800 and `ObserveDeps.timeoutMs` is documented "for suites, not for routes", so
 * a route that passed one would be moving a shared budget into one caller. The
 * hanging-vendor case below therefore waits the real 800ms, which is the honest
 * price of asserting the route's own budget rather than a shortened one.
 */
function enrichmentWith(adapter: EnrichmentAdapter): CheckoutEnrichment {
  return {
    adapter,
    contracts: {
      rows: () =>
        Promise.resolve([
          {
            integration: ENRICHMENT_INTEGRATION,
            eventName: ENRICHMENT_EVENT_NAME,
            fieldAllowlist: [...ENRICHMENT_FIELD_ALLOWLIST],
            enabled: true,
            version: ENRICHMENT_CONTRACT_VERSION,
          },
        ]),
    },
    now: () => new Date(),
    report: (outcome) => {
      fixture.outcomes.push(outcome);
      if (fixture.reporterFailure !== null) throw fixture.reporterFailure;
    },
  };
}

/**
 * A transaction that COMMITS ON RETURN AND DISCARDS ON THROW.
 *
 * This is the fixture's load-bearing part. Without it the approval line cannot
 * fail, and a claim that cannot fail is not asserted.
 */
const backend: CheckoutBackend = {
  transact: async <T>(_session: AuthSession, fn: (tx: CheckoutTx) => Promise<T>): Promise<T> => {
    const staging = copyStore(fixture.committed);
    const claimedBefore = new Set(fixture.claimed);
    try {
      const value = await fn(txOver(staging));
      fixture.committed = staging;
      return value;
    } catch (err) {
      fixture.claimed = claimedBefore;
      throw err;
    }
  },
};

const CLOCK = (): Date => new Date('2026-08-26T12:00:00.000Z');

function adaptersFor(psps: readonly PspId[]): CheckoutAdapters {
  const fake = createPspAFake({ secret: 'fixture-secret', clock: CLOCK });
  const table = new Map<PspId, PspAdapter>();
  for (const psp of psps) table.set(psp, fake);
  return {
    adapterFor: (psp: PspId) => table.get(psp),
    returnUrl: 'https://merit.test/checkout/return',
    cancelUrl: 'https://merit.test/checkout/cancel',
    // Read from the fixture rather than captured, so a case can install the
    // wiring after the adapters are.
    get enrichment(): CheckoutEnrichment | null {
      return fixture.enrichment;
    },
  };
}

const AUTH_FIXTURE: AuthBackend = {
  ...UNWIRED_AUTH_BACKEND,
  sessionByToken: (token: string) => Promise.resolve(token === TOKEN ? SESSION : null),
};

const onDisk = await discoverRouteModules();

async function call(options: {
  method: 'POST';
  path: string;
  token?: string | undefined;
  payload?: object | undefined;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const inject: InjectOptions = { method: options.method, url: `${BASE_PATH}${options.path}` };
  if (options.token !== undefined)
    inject.headers = { cookie: `${SESSION_COOKIE}=${options.token}` };
  if (options.payload !== undefined) inject.payload = options.payload;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

/** The honest body. Five members, and there is no price among them. */
function checkoutBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan_id: PLAN_ID,
    size_cents: Number(SIZE.sizeCents),
    accept_tos_version_ids: ['tos-v3'],
    ...over,
  };
}

beforeEach(() => {
  fixture = freshFixture();
  useAuthBackend(AUTH_FIXTURE);
  useCheckoutBackend(backend);
  useCheckoutAdapters(adaptersFor(['psp_a', 'psp_b']));
});

afterEach(() => {
  resetAuthBackend();
  resetCheckoutWiring();
});

// -----------------------------------------------------------------------------
// API_CONTRACT section 12's checkout row, in both directions
// -----------------------------------------------------------------------------

describe("the price is the server's, and section 12 rows it", () => {
  it('produces THE PRICE THE SERVER COMPUTED on the honest path', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { amount_cents: number; discount_cents: number };
    expect(body.amount_cents).toBe(centsToJson(SIZE.priceCents));
    expect(body.discount_cents).toBe(0);
    expect(fixture.committed.purchases).toHaveLength(1);
    expect(fixture.committed.purchases[0]?.listPriceCents).toBe(SIZE.priceCents);
    expect(fixture.committed.purchases[0]?.amountPaidCents).toBe(SIZE.priceCents);
  });

  it('IGNORES a client-supplied price and charges the server price', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ amount_cents: 1, price_cents: 1, list_price_cents: 1 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { amount_cents: number };
    expect(body.amount_cents).toBe(centsToJson(SIZE.priceCents));
    expect(body.amount_cents).not.toBe(1);
    const written = fixture.committed.purchases[0];
    expect(written?.amountPaidCents).toBe(SIZE.priceCents);
    expect(written?.listPriceCents).toBe(SIZE.priceCents);
  });

  it('IGNORES a client-supplied discount and recomputes it from the coupon row', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'LAUNCH20', discount_cents: 34_899 }),
    });
    expect(res.statusCode).toBe(200);
    // 20 percent of 34,900c is 6,980c, in integer cents.
    const expected = (SIZE.priceCents * 2_000n) / 10_000n;
    const body = res.json() as { discount_cents: number; amount_cents: number };
    expect(body.discount_cents).toBe(centsToJson(expected));
    expect(body.amount_cents).toBe(centsToJson(SIZE.priceCents - expected));
    expect(body.discount_cents).not.toBe(34_899);
  });

  it('carries no client key into the written row', async () => {
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ amount_cents: 1, affiliate_id: 'affiliate-attacker' }),
    });
    const written = fixture.committed.purchases[0];
    expect(written).toBeDefined();
    expect(written?.affiliateId).toBeNull();
    expect(Object.keys(written ?? {})).not.toContain('affiliate_id');
  });

  it('refuses a size the price grid does not sell rather than pricing it', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ size_cents: 1 }),
    });
    expect(res.statusCode).toBe(400);
    expect(fixture.committed.purchases).toHaveLength(0);
  });

  it('every money figure on the response is a JSON integer', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'FIVER' }),
    });
    const body = res.json() as { amount_cents: number; discount_cents: number };
    expect(Number.isInteger(body.amount_cents)).toBe(true);
    expect(Number.isInteger(body.discount_cents)).toBe(true);
    expect(body.discount_cents).toBe(500);
    expect(body.amount_cents).toBe(centsToJson(SIZE.priceCents - 500n));
  });
});

// -----------------------------------------------------------------------------
// THE APPROVAL LINE
// -----------------------------------------------------------------------------

describe('a checkout whose attribution write fails leaves NO purchase row', () => {
  it('commits the purchase AND the attribution together when the write succeeds', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ affiliate_click_token: CLICK_TOKEN }),
    });
    expect(res.statusCode).toBe(200);
    expect(fixture.committed.purchases).toHaveLength(1);
    expect(fixture.committed.attributions).toHaveLength(1);
    const purchaseId = fixture.committed.purchases[0]?.id;
    expect(fixture.committed.attributions[0]?.purchaseId).toBe(purchaseId);
    expect(fixture.committed.attributions[0]?.row.model).toBe('last_touch');
  });

  it('LEAVES NO PURCHASE ROW when the attribution write is seeded to fail', async () => {
    fixture.attributionFailure = new Error('seeded: the attribution write fails');
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ affiliate_click_token: CLICK_TOKEN }),
    });
    expect(res.statusCode).toBe(500);
    expect(fixture.committed.purchases).toEqual([]);
    expect(fixture.committed.attributions).toEqual([]);
    expect(fixture.committed.tos).toEqual([]);
  });

  it('rolls back the coupon claim with it, so a failed checkout burns no code', async () => {
    fixture.attributionFailure = new Error('seeded: the attribution write fails');
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'AFF10' }),
    });
    expect(fixture.committed.redemptions).toEqual([]);
    expect(fixture.claimed.size).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Attribution, resolved inside the transaction
// -----------------------------------------------------------------------------

describe('attribution resolves inside the checkout transaction', () => {
  it('writes a last-touch attribution from the click token', async () => {
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ affiliate_click_token: CLICK_TOKEN }),
    });
    const written = fixture.committed.attributions[0]?.row;
    expect(written?.model).toBe('last_touch');
    expect(written?.affiliateId).toBe(CLICK_AFFILIATE.affiliateId);
    expect(written?.clickId).toBe(991n);
    expect(fixture.committed.purchases[0]?.affiliateId).toBe(CLICK_AFFILIATE.affiliateId);
  });

  it('PREFERS THE CODE over a live click, which is INV-M8-02', async () => {
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'AFF10', affiliate_click_token: CLICK_TOKEN }),
    });
    const written = fixture.committed.attributions[0]?.row;
    expect(written?.model).toBe('code_override');
    expect(written?.affiliateId).toBe(CODE_AFFILIATE.affiliateId);
  });

  it('writes no attribution when the code names no affiliate and no token was sent', async () => {
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'LAUNCH20' }),
    });
    expect(fixture.committed.purchases).toHaveLength(1);
    expect(fixture.committed.attributions).toEqual([]);
    expect(fixture.committed.purchases[0]?.affiliateId).toBeNull();
  });

  it('CREDITS NOBODY on a voided attribution while still recording it', async () => {
    // The buyer IS the affiliate the code names. The row is written voided and
    // `purchases.affiliate_id` stays null, so nothing is credited.
    fixture = { ...fixture, committed: emptyStore() };
    const selfCoupon = baseCoupon({
      couponId: 'coupon-self',
      affiliate: { affiliateId: 'affiliate-self', identityId: BUYER_IDENTITY },
    });
    (COUPONS as Record<string, CouponRow>)['SELFDEAL'] = selfCoupon;
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'SELFDEAL' }),
    });
    const written = fixture.committed.attributions[0]?.row;
    expect(written?.voided).toBe(true);
    expect(written?.voidReason).not.toBeNull();
    expect(fixture.committed.purchases[0]?.affiliateId).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The gates the contract names, each asserted to leave nothing behind
// -----------------------------------------------------------------------------

describe('the refusals section 5 names', () => {
  it('answers 401 with no session at all', async () => {
    const res = await call({ method: 'POST', path: CHECKOUT_PATH, payload: checkoutBody() });
    expect(res.statusCode).toBe(401);
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('answers account_cap_reached against the RESOLVED IDENTITY', async () => {
    fixture.cap = { ...fixture.cap, liveAccounts: 3, maxAccounts: 3 };
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('account_cap_reached');
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('refuses a restricted identity with a NAMED refusal, never a silent decline', async () => {
    fixture.cap = { ...fixture.cap, identityStatus: 'restricted' };
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code: string; detail?: string };
    expect(body.code).toBe('forbidden');
    expect(body.detail).toContain('restricted');
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('answers geo_restricted on a blocked origin', async () => {
    fixture.geo = { countryCode: 'XX', decision: 'blocked' };
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('geo_restricted');
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('PROCEEDS on a warned origin and records the decision, which is SD-M3-05', async () => {
    fixture.geo = { countryCode: 'CA', decision: 'warned' };
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(200);
    expect(fixture.committed.purchases[0]?.geoDecision).toBe('warned');
    expect(fixture.committed.purchases[0]?.checkoutIpCountry).toBe('CA');
  });

  it('answers precondition_failed when the plan has no published version', async () => {
    fixture.planPublished = false;
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(412);
    expect((res.json() as { code: string }).code).toBe('precondition_failed');
  });

  it('answers service_unavailable ONLY when BOTH MIDs are unhealthy, which is INV-M3-11', async () => {
    fixture.mids = [
      { psp: 'psp_a', state: 'unhealthy' },
      { psp: 'psp_b', state: 'degraded' },
    ];
    const one = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(one.statusCode).toBe(200);
    expect(fixture.committed.purchases[0]?.psp).toBe('psp_b');

    fixture = freshFixture();
    fixture.mids = [
      { psp: 'psp_a', state: 'unhealthy' },
      { psp: 'psp_b', state: 'unhealthy' },
    ];
    const both = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(both.statusCode).toBe(503);
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('answers conflict and WRITES NOTHING when the coupon claim loses the race', async () => {
    fixture.claimed.add('coupon-launch');
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'LAUNCH20' }),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('conflict');
    // THE PURCHASE WAS ALREADY INSERTED WHEN THE CLAIM LOST, so this assertion
    // is what proves the refusal rolled back rather than returned.
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('answers conflict on an exhausted coupon', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'SPENT' }),
    });
    expect(res.statusCode).toBe(409);
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('refuses a reset-only coupon on a new purchase, which is AS-M3-04', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ coupon_code: 'RESETONLY' }),
    });
    expect(res.statusCode).toBe(400);
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('refuses a body with no accepted ToS version, which is INV-M3-09', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: { plan_id: PLAN_ID, size_cents: Number(SIZE.sizeCents) },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('validation_failed');
  });

  it('answers 503 when the backend is not wired', async () => {
    resetCheckoutWiring();
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('service_unavailable');
  });

  it('answers 503 when no adapter is configured for the chosen MID', async () => {
    useCheckoutAdapters(adaptersFor([]));
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    expect(res.statusCode).toBe(503);
    expect(fixture.committed.purchases).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// POST /accounts/:accountId/reset
// -----------------------------------------------------------------------------

describe('the reset path', () => {
  const resetPath = `/accounts/${RESET_TARGET.accountId}/reset`;

  it('charges reset_price_cents and NOT price_cents, which is SD-M3-04', async () => {
    const res = await call({
      method: 'POST',
      path: resetPath,
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { amount_cents: number; parent_account_id: string };
    expect(body.amount_cents).toBe(centsToJson(SIZE.resetPriceCents));
    expect(body.amount_cents).not.toBe(centsToJson(SIZE.priceCents));
    expect(body.parent_account_id).toBe(RESET_TARGET.accountId);
  });

  it('writes kind=reset with the parent account, which the purchases CHECK requires', async () => {
    await call({
      method: 'POST',
      path: resetPath,
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'] },
    });
    const written = fixture.committed.purchases[0];
    expect(written?.kind).toBe('reset');
    expect(written?.parentAccountId).toBe(RESET_TARGET.accountId);
  });

  it('accepts a reset-only coupon here, which is the other half of SD-M3-04', async () => {
    const res = await call({
      method: 'POST',
      path: resetPath,
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'], coupon_code: 'RESETONLY' },
    });
    expect(res.statusCode).toBe(200);
    const expected = (SIZE.resetPriceCents * 2_000n) / 10_000n;
    expect((res.json() as { discount_cents: number }).discount_cents).toBe(centsToJson(expected));
  });

  it('answers 404 for an account this caller does not own, never 403', async () => {
    const res = await call({
      method: 'POST',
      path: '/accounts/account-somebody-else/reset',
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'] },
    });
    expect(res.statusCode).toBe(404);
    expect(fixture.committed.purchases).toEqual([]);
  });

  it('answers conflict for an account that is not resettable', async () => {
    fixture.resetTarget = { ...RESET_TARGET, resettable: false };
    const res = await call({
      method: 'POST',
      path: resetPath,
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'] },
    });
    expect(res.statusCode).toBe(409);
    expect(fixture.committed.purchases).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The declaration, as data
// -----------------------------------------------------------------------------

describe('the required-factor declaration, which CI-06k reads', () => {
  it('declares session on both rows, as section 12 does', () => {
    expect(CHECKOUT_REQUIRED_FACTORS).toEqual({
      [`POST ${CHECKOUT_PATH}`]: 'session',
      [`POST ${RESET_PATH}`]: 'session',
    });
  });

  it('registers both routes on the public surface', () => {
    const { report } = buildServer({ surface: 'public', modules: onDisk });
    expect(report.registered).toContain(`POST ${CHECKOUT_PATH}`);
    expect(report.registered).toContain(`POST ${RESET_PATH}`);
  });
});

// -----------------------------------------------------------------------------
// The recompute, driven directly where the route cannot reach the branch
// -----------------------------------------------------------------------------

describe('recomputeDiscount', () => {
  const CAP: AccountCapRow = {
    liveAccounts: 0,
    maxAccounts: 3,
    identityStatus: 'active',
    hasPriorPurchase: false,
  };
  const NOW = new Date('2026-08-26T12:00:00.000Z');

  it('rounds a percent discount DOWN, so a remainder is a cent Merit keeps', () => {
    // 33.33 percent of 1,001c is 333.6333c. Integer arithmetic gives 333c.
    const outcome = recomputeDiscount(baseCoupon({ discountBp: 3_333 }), 1_001n, 'new', CAP, NOW);
    expect(outcome).toEqual({ kind: 'applied', discountCents: 333n });
  });

  it('clamps a fixed discount at the list price rather than going negative', () => {
    const outcome = recomputeDiscount(
      baseCoupon({ discountKind: 'fixed', discountBp: null, discountCents: 999_999n }),
      34_900n,
      'new',
      CAP,
      NOW,
    );
    expect(outcome).toEqual({ kind: 'applied', discountCents: 34_900n });
  });

  it('refuses an inactive, unstarted or expired coupon by name', () => {
    expect(recomputeDiscount(baseCoupon({ isActive: false }), 100n, 'new', CAP, NOW)).toEqual({
      kind: 'refused',
      refusal: 'coupon_inactive',
    });
    expect(
      recomputeDiscount(
        baseCoupon({ startsAt: new Date('2026-09-01T00:00:00Z') }),
        100n,
        'new',
        CAP,
        NOW,
      ),
    ).toEqual({ kind: 'refused', refusal: 'coupon_not_started' });
    expect(
      recomputeDiscount(
        baseCoupon({ expiresAt: new Date('2026-08-01T00:00:00Z') }),
        100n,
        'new',
        CAP,
        NOW,
      ),
    ).toEqual({ kind: 'refused', refusal: 'coupon_expired' });
  });

  it('refuses a first-purchase-only coupon to an identity that has bought before', () => {
    expect(
      recomputeDiscount(
        baseCoupon({ firstPurchaseOnly: true }),
        100n,
        'new',
        { ...CAP, hasPriorPurchase: true },
        NOW,
      ),
    ).toEqual({ kind: 'refused', refusal: 'coupon_first_purchase_only' });
  });

  it('never returns a discount above the list price on any seeded coupon', () => {
    for (const coupon of Object.values(COUPONS)) {
      const outcome = recomputeDiscount(
        coupon,
        SIZE.priceCents,
        'any' === coupon.appliesToKind ? 'new' : coupon.appliesToKind,
        CAP,
        NOW,
      );
      if (outcome.kind !== 'applied') continue;
      expect(outcome.discountCents).toBeLessThanOrEqual(SIZE.priceCents);
      expect(outcome.discountCents).toBeGreaterThanOrEqual(0n);
    }
  });
});

// =============================================================================
// ADR-023 STEP 1: ENRICHMENT OBSERVES, AND THE TWO PLACES IT COULD STOP
// =============================================================================
// ADR-115's title is "the two places observe mode could quietly become
// enforcement are closed by shape rather than by discipline", and its clause 2
// is both of them:
//
//   1. A RETURN VALUE A CALL SITE COULD BRANCH ON, closed by `Promise<void>`.
//   2. A THROW THAT PROPAGATES INTO CHECKOUT'S TRANSACTION, closed by a `catch`
//      that makes `observeEnrichment` total. A throw inside the transaction is a
//      `ROLLBACK`, so a propagating enrichment failure is enforcement by
//      exception, and enforcement by exception is a SILENT decline.
//
// BOTH ARE PROPERTIES OF THE CALL SITE AND NOT OF THE PACKAGE, which is why they
// are asserted here as well as in `packages/enrichment/test/observe.test.ts`. A
// package that decides nothing becomes enforcement at the site that calls it.
//
// THE NEGATIVE CONTROL IS THE `answeringVendor('maximal')` CASE AND IT IS NOT
// OPTIONAL. A suite that only ever seeded failures would pass against a call
// site that never calls enrichment at all, which is DELTA_MANIFEST section 13's
// own lesson: "every probe in section 10 attempted a forbidden thing and
// asserted a rejection, so EVERY ONE OF THEM PASSES AGAINST A GUARD THAT REJECTS
// EVERYTHING." So the worst answer a vendor can give is asserted to commit the
// same purchase AND to have been recorded.

/** The response with enrichment unwired, which every enrichment case compares against. */
async function baselineCheckout(): Promise<Record<string, unknown>> {
  fixture.enrichment = null;
  const res = await call({
    method: 'POST',
    path: CHECKOUT_PATH,
    token: TOKEN,
    payload: checkoutBody(),
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as Record<string, unknown>;
  fixture = freshFixture();
  return body;
}

/** A response with the two per-attempt fields dropped, so two runs are comparable. */
function comparable(body: Record<string, unknown>): Record<string, unknown> {
  const { purchase_id: _id, payment_session: _session, ...rest } = body;
  return rest;
}

describe('enrichment observes and decides nothing (ADR-023 step 1, ADR-115)', () => {
  it('PLACE 1: the call site binds nothing, and this file says no decision word', () => {
    // A SOURCE-READING ASSERTION, because a behavioural one cannot see this.
    // `observeEnrichment` returns `Promise<void>`, so a call site that bound and
    // branched on its result would not compile today; the failure mode this
    // guards is the day somebody widens the return type and the nearest caller
    // quietly starts reading it. ADR-115's seed `S-1` is that shape.
    const source = readFileSync(new URL('../src/routes/checkout.ts', import.meta.url), 'utf8');

    const calls = source.split('\n').filter((line) => line.includes('observeEnrichment('));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.trim()).toBe('await observeEnrichment(tx.enrichment, {');

    // No `const x = await observeEnrichment`, no `void`, and no `.then` or
    // `.catch` chained onto the statement: the call is awaited and its value
    // goes nowhere, which is the only shape `Promise<void>` should ever have.
    expect(source).not.toMatch(/=\s*await\s+observeEnrichment/);
    expect(source).not.toMatch(/void\s+observeEnrichment/);
    expect(source).not.toMatch(/observeEnrichment\([\s\S]*?\}\);\s*\./);

    // And nothing in this route reads a score, a band or a threshold. ADR-115
    // clause 1: observe mode writes no `risk_flags` row and the score has no
    // persisted column, so a checkout that named one would be inventing it.
    for (const word of ['riskBp', 'FootprintScore', 'scoreAssessment', 'severity']) {
      expect(source).not.toContain(word);
    }
  });

  it('PLACE 2: a vendor that never answers does not roll back the purchase', async () => {
    // THE APPROVAL LINE'S SECOND HALF. `hangingVendor` returns a promise that
    // never settles and IGNORES the abort signal deliberately, so what is
    // measured is the route's own 800ms budget rather than an adapter's manners.
    const baseline = await baselineCheckout();
    fixture.enrichment = enrichmentWith(hangingVendor());

    const startedAt = Date.now();
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });
    const elapsedMs = Date.now() - startedAt;

    expect(res.statusCode).toBe(200);
    expect(comparable(res.json() as Record<string, unknown>)).toEqual(comparable(baseline));
    expect(fixture.committed.purchases).toHaveLength(1);
    expect(fixture.committed.purchases[0]?.amountPaidCents).toBe(SIZE.priceCents);

    // The outcome is REPORTED and not returned, which is the whole shape.
    expect(fixture.outcomes.map((o) => o.kind)).toEqual(['timed_out']);
    expect(fixture.outcomes[0]?.failure).toBe(
      `no answer within ${String(ENRICHMENT_TIMEOUT_MS)}ms`,
    );

    // The transaction really was held open for the budget and no longer. The
    // upper bound is generous because it is a wall clock on shared CI; the point
    // of the lower bound is that the race was actually run.
    expect(elapsedMs).toBeGreaterThanOrEqual(ENRICHMENT_TIMEOUT_MS - 50);

    // THE SUBJECT LEFT MERIT, SO THE DISCLOSURE IS RECORDED EVEN THOUGH NOTHING
    // CAME BACK. ADR-115 clause 4: "a vendor that received a buyer's email and
    // then failed to answer received it exactly as much as one that answered."
    expect(fixture.committed.dispatches).toHaveLength(1);
    expect(fixture.committed.dispatches[0]?.['status']).toBe('failed');
    expect(fixture.committed.dispatches[0]?.['idempotencyKey']).toBe(
      `${ENRICHMENT_EVENT_NAME}:${String(fixture.committed.purchases[0]?.id)}`,
    );
  });

  it('PLACE 2: a vendor that throws does not roll back the purchase', async () => {
    const baseline = await baselineCheckout();
    fixture.enrichment = enrichmentWith(failingVendor('vendor exploded'));

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(comparable(res.json() as Record<string, unknown>)).toEqual(comparable(baseline));
    expect(fixture.committed.purchases).toHaveLength(1);
    expect(fixture.outcomes.map((o) => o.kind)).toEqual(['vendor_error']);
    expect(fixture.outcomes[0]?.failure).toBe('vendor exploded');
  });

  it('PLACE 2: a REPORTER that throws does not roll back the purchase', async () => {
    // ADR-115's control 3, one layer out: "an observability call that can abort a
    // purchase is the identical defect wearing a different hat." Seeded here
    // rather than in the package because the sink is the ROUTE's, not the
    // package's.
    const baseline = await baselineCheckout();
    fixture.enrichment = enrichmentWith(answeringVendor('clean'));
    fixture.reporterFailure = new Error('the log sink is down');

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(comparable(res.json() as Record<string, unknown>)).toEqual(comparable(baseline));
    expect(fixture.committed.purchases).toHaveLength(1);
  });

  it('THE NEGATIVE CONTROL: a MAXIMAL risk score commits the same purchase', async () => {
    // Every reading at its worst: `reputationBp: 0`, `footprintPresent: false`,
    // `datacenter: true`. ADR-115 clause 1 rules that no `risk_flags` row is
    // written and the score has no persisted column, so the worst answer
    // available changes exactly nothing about what checkout returns.
    const baseline = await baselineCheckout();
    fixture.enrichment = enrichmentWith(answeringVendor('maximal'));

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(comparable(res.json() as Record<string, unknown>)).toEqual(comparable(baseline));
    expect(fixture.committed.purchases).toHaveLength(1);

    // AND IT WAS ACTUALLY REACHED. Without this the four cases above would pass
    // against a route that never calls enrichment at all.
    expect(fixture.outcomes.map((o) => o.kind)).toEqual(['recorded']);
    expect(fixture.outcomes[0]?.signalsInserted).toBe(1);
    expect(fixture.committed.signals).toHaveLength(1);

    // The score is CARRIED IN THE OUTCOME AND STORED NOWHERE, which is ADR-115
    // clause 1: no `risk_flags` row, no `severity`, no persisted column, and no
    // mapping from one to the other. It is integer basis points on
    // `identity_links.confidence_bp`'s 0 to 10000 scale, never a float.
    const score = fixture.outcomes[0]?.score;
    expect(score?.kind).toBe('scored');
    if (score?.kind === 'scored') {
      expect(Number.isInteger(score.riskBp)).toBe(true);
      expect(score.riskBp).toBeGreaterThan(0);
      expect(score.riskBp).toBeLessThanOrEqual(SCORE_SCALE_BP);
    }
  });

  it('sends the IP and nothing else, because checkout holds nothing else', async () => {
    fixture.enrichment = enrichmentWith(answeringVendor('clean'));

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    // Four of the five facets are ABSENT rather than empty: `CheckoutRequest`
    // carries a plan, a size, a coupon code, a click token and TOS ids, and
    // `AuthSession` carries ids. The contract row below permits all five, so
    // what narrows the disclosure here is what the route HAS.
    expect(fixture.outcomes[0]?.fieldsSent).toEqual(['ip']);
    expect(ENRICHMENT_FIELD_ALLOWLIST).toContain('ip');
    expect(ENRICHMENT_CONTRACT_VERSION).toBe(1);
    expect(ENRICHMENT_INTEGRATION).toBe('enrichment');
  });

  it('records NOTHING when the deployment wires no vendor, and commits anyway', async () => {
    // `PRODUCTION_CHECKOUT_ADAPTERS.enrichment` is `null`, which is ADR-115
    // clause 4's "no enabled contract row means no call at all" reached one step
    // earlier: no vendor, no disclosure, no signal, and a checkout that commits
    // exactly as it would have.
    fixture.enrichment = null;

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(fixture.committed.purchases).toHaveLength(1);
    expect(fixture.outcomes).toEqual([]);
    expect(fixture.committed.signals).toEqual([]);
    expect(fixture.committed.dispatches).toEqual([]);
  });

  it('discards the observation when the purchase itself rolls back', async () => {
    // The direction `packages/enrichment/src/tx.ts` exists for: "an observation
    // of a checkout that DID NOT HAPPEN is worse than no observation, because
    // ADR-023's whole purpose in observe mode is to learn the distribution on
    // Merit's own traffic and a distribution polluted by abandoned checkouts is
    // not that." Session 220's attribution seed is what rolls this one back.
    fixture.enrichment = enrichmentWith(answeringVendor('clean'));
    fixture.attributionFailure = new Error('attribution write failed');

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ affiliate_click_token: CLICK_TOKEN }),
    });

    expect(res.statusCode).toBe(500);
    expect(fixture.committed.purchases).toEqual([]);
    expect(fixture.committed.signals).toEqual([]);
    expect(fixture.committed.dispatches).toEqual([]);
    // The attribution write is BEFORE the observation, so enrichment never ran.
    expect(fixture.outcomes).toEqual([]);
  });

  it('reports a failed enrichment write rather than throwing it at checkout', async () => {
    // WHAT THIS FIXTURE CAN AND CANNOT SHOW. ADR-115 clause 2: when a write this
    // package issues fails, the caller's transaction is ALREADY aborted before
    // the catch runs, its `COMMIT` is already a `ROLLBACK`, and swallowing the
    // error changes only that checkout is not ALSO handed a second exception
    // from a path that decides nothing. A JavaScript staging store does not
    // enter an aborted state, so what is asserted here is the half that IS true
    // here: the throw does not escape `observeEnrichment`, and the failure is
    // reported as `record_failed` rather than being absent. THE ROLLBACK IS
    // POSTGRES'S AND IS NOT OBSERVABLE IN THIS SUITE.
    fixture.enrichment = enrichmentWith(answeringVendor('clean'));
    fixture.enrichmentWriteFailure = new Error('identity_signals insert failed');

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(fixture.outcomes.map((o) => o.kind)).toEqual(['record_failed']);
    expect(fixture.outcomes[0]?.failure).toBe('identity_signals insert failed');
  });
});
