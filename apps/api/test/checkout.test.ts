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

interface Store {
  purchases: PurchaseInsert[];
  attributions: { purchaseId: string; row: AttributionRow }[];
  redemptions: { couponId: string; purchaseId: string }[];
  tos: { versionIds: readonly string[]; ip: string }[];
}

function emptyStore(): Store {
  return { purchases: [], attributions: [], redemptions: [], tos: [] };
}

function copyStore(store: Store): Store {
  return {
    purchases: [...store.purchases],
    attributions: [...store.attributions],
    redemptions: [...store.redemptions],
    tos: [...store.tos],
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
  /** THE SEED FOR THE APPROVAL LINE. When set, `insertAttribution` throws it. */
  attributionFailure: Error | null;
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
