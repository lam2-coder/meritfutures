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
import type { LedgerTx } from '@merit/ledger';
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
  DAILY_WINDOW_MS,
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHODS,
  RESET_PATH,
  ROLLING_7D_WINDOW_MS,
  centsToJson,
  lt08,
  lt08KeyOf,
  recomputeDiscount,
  resetCheckoutWiring,
  useCheckoutAdapters,
  useCheckoutBackend,
  velocityOf,
} from '../src/routes/checkout.ts';
import type {
  AccountCapRow,
  CheckoutAdapters,
  CheckoutBackend,
  CheckoutEnrichment,
  CheckoutTx,
  CouponRow,
  GeoDecisionRow,
  IdentityStatus,
  PaymentMethod,
  PlanVersionRow,
  PlanVersionSizeRow,
  PurchaseInsert,
  ResetTargetRow,
  WalletDebitHistoryRow,
  WalletDebitInsert,
  WalletSpendGates,
  WalletSpendLimitRow,
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

// SOMEBODY ELSE, AS A BIT (ADR-262). An `AffiliateRef` carries no identity any
// more: `packages/db` resolves the affiliate inside the checkout transaction and
// hands this handler `isBuyer` rather than `affiliates.identity_id`.
const CODE_AFFILIATE: AffiliateRef = {
  affiliateId: 'affiliate-code',
  isBuyer: false,
};

const CLICK_AFFILIATE: AffiliateRef = {
  affiliateId: 'affiliate-click',
  isBuyer: false,
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
// The wallet seed. SD-M3-06, and every figure integer cents.
// -----------------------------------------------------------------------------

/** `INV-M20-06`'s set, all five members open. Each case below closes exactly one. */
const WALLET_OPEN: WalletSpendGates = {
  identityStatus: 'active',
  identityPayoutsFrozen: false,
  accountPayoutsFrozen: false,
  accountReconBlocked: false,
  kycState: 'verified',
};

/** The seeded wallet position: comfortably above `SIZE.priceCents`, and derived from it. */
const WALLET_BALANCE_CENTS = SIZE.priceCents * 3n;

/**
 * `ledger_accounts`, the two rows `LT-08` resolves.
 *
 * `readChart` builds its key FROM THE ROW and not from the package's opinion of
 * the class, so these carry `scope` and `identityId` exactly as `0009`'s
 * `ledger_accounts_scope_identity` constrains them.
 */
const LEDGER_ACCOUNTS: readonly Record<string, unknown>[] = [
  {
    id: 'acct-trader-wallet',
    code: 'trader_wallet',
    scope: 'identity',
    identityId: BUYER_IDENTITY,
  },
  { id: 'acct-fees-revenue', code: 'fees_revenue', scope: 'firm', identityId: null },
];

// -----------------------------------------------------------------------------
// The store, and a transaction that really rolls back
// -----------------------------------------------------------------------------

interface SignalRow {
  id: string;
  kind: unknown;
  valueHash: unknown;
  observationCount: number;
}

/**
 * One `wallet_entries` row, as the fixture holds it.
 *
 * IT CARRIES NO `provenance` AND THAT IS THE SCHEMA FINDING MODELLED RATHER THAN
 * A FIELD OMITTED FROM A FAKE. ADR-158 finding 3: the column is `NOT NULL` and
 * its three members are the CREDIT list, so no value describes the `LT-08`
 * debit this suite writes. A fixture that invented one would make the route's
 * `WalletDebitInsert` look complete.
 */
interface WalletEntryStoreRow {
  id: bigint;
  direction: 'credit' | 'debit';
  amountCents: bigint;
  cause: string;
  referenceId: string;
  ledgerTransactionId: string;
  balanceAfterCents: bigint;
  occurredAt: Date;
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
  /** SD-M20-01. The wallet's own statement, which the ledger is not. */
  walletEntries: WalletEntryStoreRow[];
  /**
   * `ledger_transactions` and `ledger_entries`, STAGED WITH EVERYTHING ELSE.
   *
   * THAT IS THE PART THAT COULD HAVE BEEN FAKED AND MUST NOT BE. `INV-M3-13`
   * says a wallet purchase debits the wallet IN THE SAME TRANSACTION that
   * creates it, and a ledger fake that wrote straight through would pass every
   * happy-path assertion while making the rollback case unfalsifiable, which is
   * this file's own rule about `transact` applied one table down.
   */
  ledgerTransactions: Record<string, unknown>[];
  ledgerEntries: Record<string, unknown>[];
}

function emptyStore(): Store {
  return {
    purchases: [],
    attributions: [],
    redemptions: [],
    tos: [],
    signals: [],
    dispatches: [],
    walletEntries: [],
    ledgerTransactions: [],
    ledgerEntries: [],
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
    walletEntries: store.walletEntries.map((row) => ({ ...row })),
    ledgerTransactions: store.ledgerTransactions.map((row) => ({ ...row })),
    ledgerEntries: store.ledgerEntries.map((row) => ({ ...row })),
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

  // --- the wallet leg -------------------------------------------------------

  /** `INV-M20-06`'s set. A case closes one member and asserts the refusal. */
  walletGates: WalletSpendGates;
  /** `INV-M20-02`. Which accounts the SERVER says this identity holds. */
  ownedAccounts: Set<string>;
  /** `INV-M20-07`'s current limit, or `null` for the unlimited case (no row). */
  walletLimit: WalletSpendLimitRow | null;
  /** `ledger_halts`, read by `assertNoLiveHalt` through the posting handle. */
  ledgerHalts: Record<string, unknown>[];
  /** When false, `CheckoutTx.ledger` is `null` and the wallet arm answers 503. */
  ledgerInstalled: boolean;
  /**
   * EVERY WALLET-ARM PORT CALL, IN ORDER.
   *
   * It is what makes `INV-M20-01`'s "under the lock" assertable at all. A
   * position read is indistinguishable from a position read under a lock by its
   * RESULT, so the only observable difference is the order of the two calls, and
   * a suite that did not record it would pass with `lockScope()` deleted.
   */
  trace: string[];
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
    walletGates: { ...WALLET_OPEN },
    ownedAccounts: new Set<string>([RESET_TARGET.accountId]),
    walletLimit: null,
    ledgerHalts: [],
    ledgerInstalled: true,
    trace: [],
  };
}

/**
 * A store seeded with one wallet CREDIT, so the buyer has a position to spend.
 *
 * THE BALANCE IS THE LAST ROW'S `balance_after_cents` AND NOT A SUM, which is
 * `routes/wallet.ts`'s `balanceOf` and `0011`'s stored running balance. The
 * fixture obeys the same rule the port's docstring requires an implementation to
 * obey, and a case below binds that rule to `wallet.ts` by reading the file.
 */
function storeWithWallet(
  balanceCents: bigint,
  debits: readonly WalletDebitHistoryRow[] = [],
): Store {
  const store = emptyStore();
  let id = 0n;
  let running = 0n;
  id += 1n;
  running += balanceCents;
  store.walletEntries.push({
    id,
    direction: 'credit',
    amountCents: balanceCents,
    cause: 'payout settled',
    referenceId: 'payout-request-seed',
    ledgerTransactionId: 'ltx-seed',
    balanceAfterCents: running,
    occurredAt: new Date(Date.now() - 30 * DAILY_WINDOW_MS),
  });
  for (const debit of debits) {
    id += 1n;
    running -= debit.amountCents;
    store.walletEntries.push({
      id,
      direction: 'debit',
      amountCents: debit.amountCents,
      cause: 'checkout: wallet-funded purchase',
      referenceId: `purchase-seed-${id.toString()}`,
      ledgerTransactionId: `ltx-seed-${id.toString()}`,
      balanceAfterCents: running,
      occurredAt: debit.occurredAt,
    });
  }
  return store;
}

/**
 * `LedgerTx` over the SAME staging store, for `enrichmentTxOver`'s reason.
 *
 * `postTransaction` takes the caller's OPEN transaction with no overload that
 * omits it, so a posting commits with the purchase that caused it or not at all.
 * A fake that wrote to its own array would satisfy the type and make the
 * rollback case below unfalsifiable.
 */
function ledgerTxOver(staging: Store): LedgerTx {
  return {
    rows: (key) =>
      Promise.resolve(key === 'ledgerAccounts' ? [...LEDGER_ACCOUNTS] : [...fixture.ledgerHalts]),
    insert: (key, values) => {
      if (key === 'ledgerTransactions') {
        const row = {
          id: `ltx-${String(staging.ledgerTransactions.length + 1)}`,
          ...values,
        };
        staging.ledgerTransactions.push(row);
        return Promise.resolve([row]);
      }
      const entry = { ...values };
      staging.ledgerEntries.push(entry);
      return Promise.resolve([entry]);
    },
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

    // --- the wallet leg. SD-M3-06 -------------------------------------------

    walletSpendGates: () => {
      fixture.trace.push('walletSpendGates');
      return Promise.resolve(fixture.walletGates);
    },

    ownsAccount: (accountId: string) => {
      fixture.trace.push('ownsAccount');
      return Promise.resolve(fixture.ownedAccounts.has(accountId));
    },

    lockScope: () => {
      fixture.trace.push('lockScope');
      return Promise.resolve();
    },

    walletBalanceCents: () => {
      fixture.trace.push('walletBalanceCents');
      // `routes/wallet.ts`'s `balanceOf`: the greatest `id`'s stored running
      // balance, and `0n` for an identity with no row at all.
      let latest: WalletEntryStoreRow | null = null;
      for (const row of staging.walletEntries) {
        if (latest === null || row.id > latest.id) latest = row;
      }
      return Promise.resolve(latest === null ? 0n : latest.balanceAfterCents);
    },

    walletSpendLimit: (at: Date) => {
      fixture.trace.push('walletSpendLimit');
      const limit = fixture.walletLimit;
      // Supersession is a NEW ROW at a later `effective_from`, so a limit dated
      // in the future has not arrived and does not bind yet.
      return Promise.resolve(
        limit !== null && limit.effectiveFrom.getTime() <= at.getTime() ? limit : null,
      );
    },

    walletDebitsSince: (since: Date) => {
      fixture.trace.push('walletDebitsSince');
      return Promise.resolve(
        staging.walletEntries
          .filter((row) => row.direction === 'debit' && row.occurredAt.getTime() >= since.getTime())
          .map((row) => ({ amountCents: row.amountCents, occurredAt: row.occurredAt })),
      );
    },

    insertWalletDebit: (row: WalletDebitInsert) => {
      fixture.trace.push('insertWalletDebit');
      let greatest = 0n;
      for (const existing of staging.walletEntries) {
        if (existing.id > greatest) greatest = existing.id;
      }
      staging.walletEntries.push({
        id: greatest + 1n,
        direction: 'debit',
        amountCents: row.amountCents,
        cause: row.cause,
        referenceId: row.referenceId,
        ledgerTransactionId: row.ledgerTransactionId,
        balanceAfterCents: row.balanceAfterCents,
        occurredAt: new Date(),
      });
      return Promise.resolve();
    },

    get ledger(): LedgerTx | null {
      return fixture.ledgerInstalled ? ledgerTxOver(staging) : null;
    },
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
      affiliate: { affiliateId: 'affiliate-self', isBuyer: true },
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

// =============================================================================
// THE WALLET LEG. SD-M3-06, P5-i
// =============================================================================
// M20 SECTION 3.7 IS THE ORDERING RULE AND THE FIRST BLOCK BELOW IS IT, ASSERTED
// FROM THE DIRECTION THAT CATCHES THE DEFECT. The rule is that "one
// authorization decision before the branch refuses all three, AND THE ASSERTION
// SHOULD BE RUN AGAINST ALL THREE", and the reason is measured rather than
// feared: M03 section 3.5.1 records that before ADR-041's fold a restricted
// identity was refused on `wallet`, COMPLETED on `psp`, and on `mixed` was
// "refused, on the wallet leg, after the card leg is underway".
//
// So a suite that asserted the refusal only on the method this slice added would
// pass with the refusal moved INSIDE the wallet arm, which is exactly the
// defect. Every hard-limit case below runs over all three methods.
// =============================================================================

/** The three methods, read from the exported vocabulary rather than restated. */
const EVERY_METHOD: readonly PaymentMethod[] = PAYMENT_METHODS;

/** A body that names a method. `undefined` omits the field entirely. */
function bodyWith(method: PaymentMethod | undefined): Record<string, unknown> {
  return method === undefined ? checkoutBody() : checkoutBody({ payment_method: method });
}

/** Nothing was written, on any table this transaction can reach. */
function expectNothingWritten(): void {
  expect(fixture.committed.purchases).toEqual([]);
  expect(fixture.committed.walletEntries.filter((row) => row.direction === 'debit')).toEqual([]);
  expect(fixture.committed.ledgerTransactions).toEqual([]);
  expect(fixture.committed.ledgerEntries).toEqual([]);
  expect(fixture.committed.tos).toEqual([]);
}

describe('M20 section 3.7: the hard limit sits BEFORE the payment-method branch', () => {
  beforeEach(() => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
  });

  for (const status of ['restricted', 'closed'] as const satisfies readonly IdentityStatus[]) {
    for (const method of EVERY_METHOD) {
      it(`refuses a ${status} identity asking for ${method}, and writes nothing`, async () => {
        fixture.cap = { ...fixture.cap, identityStatus: status };

        const res = await call({
          method: 'POST',
          path: CHECKOUT_PATH,
          token: TOKEN,
          payload: bodyWith(method),
        });

        // ADR-075's predicate is `= 'active'` and NOT an enumeration of what is
        // refused, so `closed` is refused for the same reason `restricted` is.
        // `INV-M20-06` carried `= 'restricted'` until 2026-08-21 and "a closed
        // identity therefore passed it".
        expect(res.statusCode).toBe(403);
        const body = res.json() as { code: string; detail?: string };
        // A DEFECT THIS SESSION REPORTS AND DOES NOT REPAIR. API_CONTRACT
        // section 2 defines `identity_restricted` at 422 for this exact
        // refusal, "on EVERY payment method", and `routes/payouts.ts` already
        // answers it on the sibling money route. Changing it here is a
        // wire-visible change to the CARD leg, which P5 section 6 says this
        // slice touches neither of. Today's behaviour is pinned so that the day
        // somebody takes the two-line patch in `gateIdentity`, this assertion
        // says why it moved.
        expect(body.code).toBe('forbidden');
        expect(body.detail).toContain(status);
        expectNothingWritten();
      });
    }
  }

  it('refuses the SAME WAY on all three methods, which is the property the rule is about', async () => {
    fixture.cap = { ...fixture.cap, identityStatus: 'restricted' };
    const answers: { method: PaymentMethod; status: number; code: string }[] = [];
    for (const method of EVERY_METHOD) {
      fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
      const res = await call({
        method: 'POST',
        path: CHECKOUT_PATH,
        token: TOKEN,
        payload: bodyWith(method),
      });
      answers.push({ method, status: res.statusCode, code: (res.json() as { code: string }).code });
    }
    // ONE ANSWER, THREE METHODS. A refusal written inside the wallet arm makes
    // this array carry a 200 for `psp` and a 503 for `mixed`.
    expect(new Set(answers.map((a) => `${String(a.status)} ${a.code}`)).size).toBe(1);
  });

  it('never reaches the wallet gate set at all, because the hard limit is above the branch', async () => {
    fixture.cap = { ...fixture.cap, identityStatus: 'restricted' };
    // Both controls would refuse. GS-302's own note is that when both do, the
    // outcome cannot say which; the TRACE can, and the ordering rule is about
    // which one runs.
    fixture.walletGates = { ...WALLET_OPEN, identityPayoutsFrozen: true };

    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(fixture.trace).toEqual([]);
  });

  it('refuses on the RESET endpoint too, on all three methods', async () => {
    fixture.cap = { ...fixture.cap, identityStatus: 'restricted' };
    for (const method of EVERY_METHOD) {
      const res = await call({
        method: 'POST',
        path: `/accounts/${RESET_TARGET.accountId}/reset`,
        token: TOKEN,
        payload: { accept_tos_version_ids: ['tos-v3'], payment_method: method },
      });
      // M03 section 3.5's coverage row: "POST /checkout and
      // POST /accounts/:id/reset, all three payment_method values".
      expect(res.statusCode).toBe(403);
    }
    expectNothingWritten();
  });

  it('refuses a restricted identity asking for `mixed` with the IDENTITY refusal and not the mixed one', async () => {
    fixture.cap = { ...fixture.cap, identityStatus: 'restricted' };
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('mixed'),
    });
    // THE ORDERING RULE FROM THE OTHER SIDE. Refusing `mixed` at the wire would
    // answer 400, and refusing it above `gateIdentity` would answer 503; the
    // contract requires the identity refusal to answer first.
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('forbidden');
  });
});

describe('the contract-conformant body is untouched, which is what makes this a superset', () => {
  beforeEach(() => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
  });

  it('answers a five-member body exactly as it does today and funds it with a card', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // API_CONTRACT section 5's `CheckoutResponse`, field for field and no sixth.
    expect(Object.keys(body).sort()).toEqual(
      [
        'amount_cents',
        'discount_cents',
        'payment_session',
        'plan_version_id',
        'psp',
        'purchase_id',
      ].sort(),
    );
    expect(body['payment_method']).toBeUndefined();

    const written = fixture.committed.purchases[0];
    expect(written?.paymentMethod).toBe(DEFAULT_PAYMENT_METHOD);
    expect(written?.paymentMethod).toBe('psp');
    // `purchases_wallet_leg_matches_method`: `'psp'` requires a zero wallet leg,
    // and `purchases_wallet_debit_is_posted` then permits the null pointer.
    expect(written?.walletDebitCents).toBe(0n);
    expect(written?.walletLedgerTransactionId).toBeNull();
    expect(written?.status).toBe('pending');
    expect(written?.paidAt).toBeNull();
    // NOTHING WAS POSTED. A card purchase writes no ledger row at checkout.
    expect(fixture.committed.ledgerTransactions).toEqual([]);
  });

  it('refuses a fourth `payment_method` word, because the CHECK list is closed at three', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ payment_method: 'crypto' }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string; errors: { path: string }[] };
    expect(body.code).toBe('validation_failed');
    expect(body.errors.map((e) => e.path)).toContain('payment_method');
    expectNothingWritten();
  });
});

// GS-223, "a payouts-frozen identity attempts a wallet-funded purchase", and the
// row's expectation is that it is REFUSED, and that "expired KYC, `recon_blocked`,
// and an active restriction do the same". The block below is that row one case
// per member, over a WALLET-FUNDED body, asserting on every one that no purchase,
// no wallet debit and no ledger entry was written. The sixth case counts the
// cases against `WalletSpendGates`'s own field list, so a member added to the
// gate set and not refused turns this red rather than passing quietly. The
// identity half runs again across all three payment methods and on the reset
// endpoint above.
//
// AS-M20-02 IS WHY THE WALLET BODY MATTERS: a freeze that covers the payout exit
// and not the spend exit is not a freeze, because spending converts frozen value
// into accounts that produce fresh unfrozen credits.
//
// ONE RESIDUAL, STATED. The KYC member is exercised at `pending` and the row
// says `expired`. Both refuse through the same `kycState !== 'verified'` at
// `checkout.ts:1707`, and `KycState` carries `expired` at `checkout.ts:610`, so
// no case names the row's own word.
describe('INV-M20-06: the enumerated gate set, one case per member', () => {
  beforeEach(() => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
  });

  const CASES: readonly {
    readonly member: string;
    readonly gates: Partial<WalletSpendGates>;
    readonly code: string;
  }[] = [
    {
      member: 'identities.status',
      gates: { identityStatus: 'restricted' },
      code: 'identity_restricted',
    },
    {
      member: 'identities.payouts_frozen',
      gates: { identityPayoutsFrozen: true },
      code: 'payouts_frozen',
    },
    {
      member: 'accounts.payouts_frozen',
      gates: { accountPayoutsFrozen: true },
      code: 'payouts_frozen',
    },
    {
      member: 'accounts.recon_blocked',
      gates: { accountReconBlocked: true },
      code: 'payouts_frozen',
    },
    { member: 'kyc not verified', gates: { kycState: 'pending' }, code: 'kyc_required' },
  ];

  for (const testCase of CASES) {
    it(`refuses a wallet spend on ${testCase.member}, and posts nothing`, async () => {
      // The identity-status member is reached here only because `gateIdentity`
      // reads `AccountCapRow` and this reads `WalletSpendGates`: the fixture
      // closes the member on the wallet row alone, which is how a set that
      // dropped it because another control covers it would be caught.
      fixture.walletGates = { ...WALLET_OPEN, ...testCase.gates };

      const res = await call({
        method: 'POST',
        path: CHECKOUT_PATH,
        token: TOKEN,
        payload: bodyWith('wallet'),
      });

      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe(testCase.code);
      expectNothingWritten();
    });
  }

  it('covers every member of WalletSpendGates, counted rather than assumed', () => {
    // A guard with nothing to find looks exactly like a guard finding nothing
    // wrong: this counts what the block above covered and asserts the count
    // against the type's own field list, so a sixth member added to the gate set
    // and not refused turns this red.
    expect(CASES).toHaveLength(Object.keys(WALLET_OPEN).length);
  });

  it('refuses BEFORE consulting whether this deployment can post at all', async () => {
    fixture.walletGates = { ...WALLET_OPEN, identityPayoutsFrozen: true };
    fixture.ledgerInstalled = false;

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    // A frozen identity is told it is frozen. Answering 503 would tell them the
    // service is down and teach them to retry, which is the silent-decline shape
    // OQ-M3-03 argues against one code over.
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe('payouts_frozen');
  });
});

describe('INV-M20-02: own accounts only, resolved SERVER SIDE in the debit transaction', () => {
  it('refuses a reset onto an account the server says this identity does not hold', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
    // THE SCOPED READ IS SEEDED TO LEAK, which is the only way to exercise the
    // check at all: `resetTarget` is a scoped read and already answers `null`
    // for a foreign account. DEP-M20-02 asks M3 to resolve ownership server side
    // in this transaction precisely so the control does not depend on an earlier
    // read having stayed scoped, and AS-M20-06 is what it costs when it does.
    fixture.ownedAccounts = new Set<string>();

    const res = await call({
      method: 'POST',
      path: `/accounts/${RESET_TARGET.accountId}/reset`,
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'], payment_method: 'wallet' },
    });

    expect(res.statusCode).toBe(403);
    expectNothingWritten();
  });

  it('completes the same reset when the server DOES hold the account', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
    const res = await call({
      method: 'POST',
      path: `/accounts/${RESET_TARGET.accountId}/reset`,
      token: TOKEN,
      payload: { accept_tos_version_ids: ['tos-v3'], payment_method: 'wallet' },
    });

    // The opposite direction from the same fixture, because a check that refuses
    // everything passes the case above on its own.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { payment_method: string; parent_account_id: string };
    expect(body.payment_method).toBe('wallet');
    expect(body.parent_account_id).toBe(RESET_TARGET.accountId);
    expect(fixture.committed.purchases[0]?.amountPaidCents).toBe(SIZE.resetPriceCents);
  });

  it('checks nothing on a NEW purchase, because there is no other identity it could be for', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
    fixture.ownedAccounts = new Set<string>();

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(200);
    expect(fixture.trace).not.toContain('ownsAccount');
  });
});

describe('INV-M20-01: the position, checked under ADR-157 clause 4 ROW lock', () => {
  it('refuses a purchase the position does not cover, and posts nothing', async () => {
    fixture.committed = storeWithWallet(SIZE.priceCents - 1n);

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe('insufficient_funds');
    expectNothingWritten();
  });

  it('admits a purchase the position covers EXACTLY, and leaves the balance at zero', async () => {
    fixture.committed = storeWithWallet(SIZE.priceCents);

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(200);
    const debit = fixture.committed.walletEntries.find((row) => row.direction === 'debit');
    // `CHECK (balance_after_cents >= 0)` reached from above rather than from
    // below: the boundary case is the one that proves the comparison is `<` and
    // not `<=`.
    expect(debit?.balanceAfterCents).toBe(0n);
  });

  it('TAKES THE LOCK BEFORE IT READS THE POSITION, which is the whole of the invariant', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);

    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    // FM-M20-01 is the concurrent overdraw, and a position read before the lock
    // is a position another transaction may already have spent. The RESULT of
    // the two orders is identical, so the order is the only observable, and this
    // suite would pass with `lockScope()` deleted if it did not read it.
    expect(fixture.trace.indexOf('lockScope')).toBeGreaterThanOrEqual(0);
    expect(fixture.trace.indexOf('lockScope')).toBeLessThan(
      fixture.trace.indexOf('walletBalanceCents'),
    );
  });

  it('takes the lock through the accessor and never as an advisory lock', () => {
    // ADR-157 clause 4 and P5 section 11 rule 10 each foreclose the alternative
    // BY NAME: `pg_advisory_xact_lock` can only be sent through `sqlExecutor`.
    //
    // THIS WAS WRITTEN AS A BARE SUBSTRING TEST FIRST AND THE TREE REFUTED IT,
    // which is session 292's finding on a different file arriving here: this
    // file's header NAMES `sqlExecutor`, `SqlExecutorReason` and `SystemReason`
    // in order to say it does not widen them, so a mention test fails on the
    // sentence that promises the thing it is checking. What is asserted instead
    // is the SYNTAX a reach-around would have to take.
    const source = readFileSync(new URL('../src/routes/checkout.ts', import.meta.url), 'utf8');
    //
    // A `pg_advisory` mention test fails for the same reason, on the two
    // docstrings that quote ADR-157's own argument, so what is forbidden is the
    // ONLY MECHANISM by which one could be sent: an advisory lock reaches the
    // connection through `sqlExecutor().executeSql(...)` and by no other route,
    // and this file cannot even import a client.
    expect(source).not.toMatch(/\.sqlExecutor\(/);
    expect(source).not.toContain('executeSql');
    expect(source).not.toMatch(/from 'pg'/);
    expect(source).not.toMatch(/from '@merit\/db'/);
    // And the positive half, because an assertion that only forbids passes on a
    // file that takes no lock at all.
    expect(source).toContain('await tx.lockScope();');
  });
});

describe('INV-M20-07: the velocity limit DELAYS and does not refuse', () => {
  const NOW = new Date('2026-08-26T12:00:00.000Z');
  const LIMIT = (over: Partial<WalletSpendLimitRow> = {}): WalletSpendLimitRow => ({
    dailyCents: 50_000n,
    rolling7dCents: 200_000n,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  });

  it('is within the limit when no row exists at all, because absence is unlimited', () => {
    // API_CONTRACT: "there is no value that means unlimited: the absence of any
    // row for an identity is what unlimited looks like."
    expect(velocityOf({ amountCents: 10_000_000n, limit: null, debits: [], at: NOW })).toEqual({
      kind: 'within',
    });
  });

  it('is within when the spend fits under both windows', () => {
    expect(
      velocityOf({
        amountCents: 10_000n,
        limit: LIMIT(),
        debits: [
          { amountCents: 20_000n, occurredAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) },
        ],
        at: NOW,
      }),
    ).toEqual({ kind: 'within' });
  });

  it('DELAYS on the daily window and names the instant the oldest debit rolls off', () => {
    const oldest = new Date(NOW.getTime() - 20 * 60 * 60 * 1000);
    const outcome = velocityOf({
      amountCents: 10_000n,
      limit: LIMIT(),
      debits: [
        { amountCents: 30_000n, occurredAt: oldest },
        { amountCents: 15_000n, occurredAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
      ],
      at: NOW,
    });
    // 45,000c spent against a 50,000c daily limit leaves 5,000c of headroom and
    // the purchase is 10,000c. Dropping the 30,000c debit leaves 15,000c spent,
    // which admits it, so the instant is that debit's own roll-off and NOT "a
    // whole window from now": rounding up would delay this trader by 20 hours
    // more than the rule requires.
    expect(outcome).toEqual({
      kind: 'delayed',
      limitKind: 'daily',
      retryAt: new Date(oldest.getTime() + DAILY_WINDOW_MS),
    });
  });

  it('DELAYS on the rolling 7d window even though the weekly ceiling is the higher one', () => {
    const oldest = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    const outcome = velocityOf({
      amountCents: 10_000n,
      limit: LIMIT({ dailyCents: 200_000n, rolling7dCents: 200_000n }),
      debits: [
        { amountCents: 195_000n, occurredAt: oldest },
        { amountCents: 1_000n, occurredAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
      ],
      at: NOW,
    });
    // `wallet_spend_limits_weekly_exceeds_daily` keeps the weekly CEILING at or
    // above the daily one and says nothing about which WINDOW fills first: the
    // weekly one is seven times longer and holds seven times the spend.
    expect(outcome).toEqual({
      kind: 'delayed',
      limitKind: 'rolling_7d',
      retryAt: new Date(oldest.getTime() + ROLLING_7D_WINDOW_MS),
    });
  });

  it('reports the window that binds LONGEST when both bind', () => {
    const dailyOldest = new Date(NOW.getTime() - 20 * 60 * 60 * 1000);
    const weeklyOldest = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    const outcome = velocityOf({
      amountCents: 10_000n,
      limit: LIMIT({ dailyCents: 50_000n, rolling7dCents: 60_000n }),
      debits: [
        { amountCents: 45_000n, occurredAt: weeklyOldest },
        { amountCents: 45_000n, occurredAt: dailyOldest },
      ],
      at: NOW,
    });
    // The earlier of two retry times is a retry that arrives to be delayed
    // again, so the later one is the honest answer.
    expect(outcome.kind).toBe('delayed');
    if (outcome.kind === 'delayed') {
      expect(outcome.retryAt).toEqual(new Date(weeklyOldest.getTime() + ROLLING_7D_WINDOW_MS));
      expect(outcome.limitKind).toBe('rolling_7d');
    }
  });

  it('reports NO retry instant when the limit itself is below the amount', () => {
    // API_CONTRACT: "daily_cents: 0 is writable and MEANS NO WALLET SPEND AT
    // ALL, not 'no limit'." No amount of window rolling admits a positive spend,
    // and a fabricated Retry-After would send the trader back forever.
    expect(
      velocityOf({ amountCents: 1n, limit: LIMIT({ dailyCents: 0n }), debits: [], at: NOW }),
    ).toEqual({ kind: 'delayed', limitKind: 'daily', retryAt: null });
  });

  it('ignores a debit that has already rolled out of the window', () => {
    expect(
      velocityOf({
        amountCents: 50_000n,
        limit: LIMIT(),
        debits: [
          { amountCents: 50_000n, occurredAt: new Date(NOW.getTime() - DAILY_WINDOW_MS - 1) },
        ],
        at: NOW,
      }),
    ).toEqual({ kind: 'within' });
  });

  it('answers 429 with a Retry-After and WRITES NOTHING, because a delay is not a partial commit', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS, [
      { amountCents: 50_000n, occurredAt: new Date(Date.now() - 60 * 60 * 1000) },
    ]);
    fixture.walletLimit = {
      dailyCents: 60_000n,
      rolling7dCents: 60_000n,
      effectiveFrom: new Date(Date.now() - DAILY_WINDOW_MS * 30),
    };

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(429);
    expect((res.json() as { code: string }).code).toBe('rate_limited');
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // THE DELAY IS THE WHOLE ANSWER. A partial commit here would leave a debit
    // against a purchase that does not exist. `expectNothingWritten` is not used
    // because this fixture SEEDS a debit to fill the window, so what is asserted
    // is that no NEW one arrived.
    expect(fixture.committed.purchases).toEqual([]);
    expect(fixture.committed.ledgerTransactions).toEqual([]);
    expect(fixture.committed.ledgerEntries).toEqual([]);
    expect(fixture.committed.tos).toEqual([]);
    expect(fixture.committed.walletEntries.filter((row) => row.direction === 'debit')).toHaveLength(
      1,
    );
  });

  it('omits Retry-After when no instant exists, rather than inventing one', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
    fixture.walletLimit = {
      dailyCents: 0n,
      rolling7dCents: 0n,
      effectiveFrom: new Date(Date.now() - DAILY_WINDOW_MS * 30),
    };

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeUndefined();
    expect((res.json() as { detail: string }).detail).toContain('no window admits it');
  });

  it('does not bind on a limit whose effective_from has not arrived', async () => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
    // Supersession is a NEW ROW at a later `effective_from`, so a limit dated in
    // the future is a record of a decision that has not taken effect.
    fixture.walletLimit = {
      dailyCents: 0n,
      rolling7dCents: 0n,
      effectiveFrom: new Date(Date.now() + DAILY_WINDOW_MS),
    };

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(200);
  });

  it('is checked AFTER the position, so an empty wallet is refused rather than delayed', async () => {
    fixture.committed = storeWithWallet(SIZE.priceCents - 1n);
    fixture.walletLimit = {
      dailyCents: 0n,
      rolling7dCents: 0n,
      effectiveFrom: new Date(Date.now() - DAILY_WINDOW_MS),
    };

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    // M20 section 3.2 draws `insufficient position` above `velocity limit
    // exceeded`, and the reason is what the trader is told: sending somebody
    // with no balance away for six hours and refusing them on arrival is worse
    // than refusing them now.
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe('insufficient_funds');
  });
});

describe('LT-08, posted in the purchase transaction', () => {
  beforeEach(() => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
  });

  it('posts ONE transaction with TWO entries that sum to zero', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });
    expect(res.statusCode).toBe(200);

    expect(fixture.committed.ledgerTransactions).toHaveLength(1);
    const header = fixture.committed.ledgerTransactions[0];
    const purchaseId = fixture.committed.purchases[0]?.id;
    expect(header?.['kind']).toBe('wallet_purchase_debit');
    expect(header?.['referenceKind']).toBe('purchase');
    expect(header?.['referenceId']).toBe(purchaseId);
    expect(header?.['idempotencyKey']).toBe(lt08KeyOf(purchaseId ?? ''));
    expect(header?.['reversalOf']).toBeNull();

    const entries = fixture.committed.ledgerEntries;
    expect(entries).toHaveLength(2);
    let net = 0n;
    for (const entry of entries) net += entry['amountCents'] as bigint;
    // The imbalance is UNREPRESENTABLE rather than refused, because an entry
    // exists only as one half of a `transfer()`.
    expect(net).toBe(0n);

    // DEBIT trader_wallet, CREDIT fees_revenue. M05:137's own words, and
    // `psp_clearing` is deliberately untouched: there is no processor in this
    // transaction, so there is nothing in clearing.
    const byAccount = new Map(
      entries.map((entry) => [entry['ledgerAccountId'] as string, entry['amountCents'] as bigint]),
    );
    expect(byAccount.get('acct-trader-wallet')).toBe(SIZE.priceCents);
    expect(byAccount.get('acct-fees-revenue')).toBe(-SIZE.priceCents);
    expect(byAccount.has('acct-psp-clearing')).toBe(false);
  });

  it('writes the wallet statement row with the running balance and NO provenance', async () => {
    await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    const debit = fixture.committed.walletEntries.find((row) => row.direction === 'debit');
    expect(debit?.amountCents).toBe(SIZE.priceCents);
    expect(debit?.balanceAfterCents).toBe(WALLET_BALANCE_CENTS - SIZE.priceCents);
    expect(debit?.referenceId).toBe(fixture.committed.purchases[0]?.id);
    expect(debit?.ledgerTransactionId).toBe(fixture.committed.ledgerTransactions[0]?.['id']);
    // ADR-158 finding 3 and clause 2: the column's three members are the CREDIT
    // list and none describes this row, so the shape declares no such field and
    // what the debit MEANS is `cause` and `reference_id`.
    expect(Object.keys(debit ?? {})).not.toContain('provenance');
    expect(debit?.cause).toContain('wallet-funded purchase');
  });

  it('writes a purchase row that could not be mistaken for a stalled PSP purchase', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    const written = fixture.committed.purchases[0];
    expect(written?.paymentMethod).toBe('wallet');
    // `purchases_wallet_leg_matches_method`: `'wallet'` requires
    // `wallet_debit_cents = amount_paid_cents > 0`.
    expect(written?.walletDebitCents).toBe(SIZE.priceCents);
    expect(written?.amountPaidCents).toBe(SIZE.priceCents);
    // `purchases_wallet_debit_is_posted`: a wallet debit that posted no ledger
    // transaction is money that moved outside the ledger.
    expect(written?.walletLedgerTransactionId).toBe(
      fixture.committed.ledgerTransactions[0]?.['id'],
    );
    // INV-M3-13: the payment either committed or it did not, so there is no
    // `provisioning_pending` limbo on this path.
    expect(written?.status).toBe('paid');
    expect(written?.paidAt).toBeInstanceOf(Date);

    // THE TWO NOT NULL COLUMNS THIS SESSION CANNOT WRITE. `0006` declares
    // `psp text NOT NULL CHECK (psp IN ('psp_a','psp_b'))` and
    // `psp_reference text NOT NULL`, and SD-M3-06 relaxed neither. Writing
    // `'psp_a'` onto a row that reached no processor is exactly the state
    // SD-M3-06 exists to make unrepresentable, so the type carries the truth and
    // the write fails closed. A superseding migration is owed.
    expect(written?.psp).toBeNull();
    expect(written?.pspReference).toBeNull();

    // NO SESSION WAS CREATED AT A PROCESSOR, which is `cardLegOf`'s refusal
    // honoured by never reaching it.
    const body = res.json() as Record<string, unknown>;
    expect(body['payment_session']).toBeUndefined();
    expect(body['psp']).toBeUndefined();
    expect(body['payment_method']).toBe('wallet');
    expect(body['wallet_debit_cents']).toBe(centsToJson(SIZE.priceCents));
  });

  it('ROLLS THE POSTING BACK when a later step refuses, and leaves no orphan entry', async () => {
    // The coupon claim is the file's own after-a-write refusal, and on this path
    // the write it comes after is a LEDGER POSTING. A wallet arm that committed
    // its posting independently would leave a debit against a purchase that does
    // not exist, which is the class of error INV-M20-10's nightly per-identity
    // reconciliation exists to find the morning after.
    fixture.claimed.add('coupon-launch');

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: checkoutBody({ payment_method: 'wallet', coupon_code: 'LAUNCH20' }),
    });

    expect(res.statusCode).toBe(409);
    expect(fixture.committed.purchases).toEqual([]);
    expect(fixture.committed.ledgerTransactions).toEqual([]);
    expect(fixture.committed.ledgerEntries).toEqual([]);
    expect(fixture.committed.walletEntries.filter((row) => row.direction === 'debit')).toEqual([]);
  });

  it('refuses the whole purchase when a ledger halt is live against this identity', async () => {
    // ADR-016 and INV-M5-16 make the halt identity-scoped, and NOTHING IN THE
    // DATABASE HONOURS IT: `postTransaction` is the code path that does. A throw
    // here is a rollback, which on this route is the correct outcome.
    fixture.ledgerHalts = [
      {
        identityId: BUYER_IDENTITY,
        reasonCode: 'recon_divergence',
        reasonNote: 'nightly assertion failed',
        releasedAt: null,
        escalateAt: new Date(),
      },
    ];

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(500);
    expectNothingWritten();
  });

  it('builds LT-08 from M05 section 2.1 and refuses a non-positive amount at construction', () => {
    const post = lt08({
      identityId: BUYER_IDENTITY,
      purchaseId: 'purchase-1',
      idempotencyKey: lt08KeyOf('purchase-1'),
      walletDebitCents: SIZE.priceCents,
    });
    expect(post.transfers).toHaveLength(1);
    expect(post.transfers[0]?.debit).toEqual({
      scope: 'identity',
      code: 'trader_wallet',
      identityId: BUYER_IDENTITY,
    });
    expect(post.transfers[0]?.credit).toEqual({ scope: 'firm', code: 'fees_revenue' });

    // `transfer()` refuses a non-positive amount, so a zero-value wallet purchase
    // is unrepresentable rather than a row somebody has to notice.
    expect(() =>
      lt08({
        identityId: BUYER_IDENTITY,
        purchaseId: 'purchase-1',
        idempotencyKey: 'k',
        walletDebitCents: 0n,
      }),
    ).toThrow(RangeError);
  });
});

describe('the doors this slice reports rather than opens', () => {
  beforeEach(() => {
    fixture.committed = storeWithWallet(WALLET_BALANCE_CENTS);
  });

  it('answers 503 for a deployment with no posting handle, and writes nothing', async () => {
    // `postTransaction` takes a `LedgerTx`, which only `SystemTx` satisfies, and
    // `SystemReason` is 'nightly-batch' | 'operator-console'. A checkout posting
    // from `apps/api` is neither of those words, and `packages/ledger/src/tx.ts`
    // says so in its own header. Nothing here widens that vocabulary.
    fixture.ledgerInstalled = false;

    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('wallet'),
    });

    expect(res.statusCode).toBe(503);
    expectNothingWritten();
  });

  it('refuses `mixed` with a stated reason rather than half-building it', async () => {
    const res = await call({
      method: 'POST',
      path: CHECKOUT_PATH,
      token: TOKEN,
      payload: bodyWith('mixed'),
    });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { detail: string };
    // The refusal states WHY, because `mixed` needs a ruling and P5 section 8's
    // `P5-i` fence admits an ADR only if it does: the wallet leg of a mixed
    // purchase POSTS rather than holds, and the compensating release has no
    // provenance in `wallet_entries` and no site in this module.
    expect(body.detail).toContain('posts rather than holds');
    expectNothingWritten();
  });

  it('has no session type to refuse an impersonation on, and does not invent one', () => {
    // INV-M20-16 and M6-N-02. `AuthSession` has six fields and none of them is a
    // session type, so the refusal M20 section 3.7 requires cannot be
    // implemented here. That is `routes/payouts.ts`'s finding about INV-M5-23
    // arriving on a second money route, and M05 section 3.6's corollary applies:
    // a refusal nothing asserts disappears silently. It is REPORTED, in this
    // file's header and in this assertion, rather than faked.
    const auth = readFileSync(new URL('../src/routes/auth.ts', import.meta.url), 'utf8');
    expect(auth).not.toContain('impersonation');
    const source = readFileSync(new URL('../src/routes/checkout.ts', import.meta.url), 'utf8');
    expect(source).toContain('CANNOT BE');
    expect(source).toContain('INV-M20-16');
  });

  it('states the balance rule `routes/wallet.ts` owns rather than deriving a second one', () => {
    // The dispatch's own instruction, made mechanical: two code paths disagreeing
    // about whether the balance is the stored running total or a recomputed sum
    // is `0011`'s tamper indicator read two ways.
    const wallet = readFileSync(new URL('../src/routes/wallet.ts', import.meta.url), 'utf8');
    expect(wallet).toContain('LAST ROW APPENDED');
    expect(wallet).toContain('export function balanceOf');
    const source = readFileSync(new URL('../src/routes/checkout.ts', import.meta.url), 'utf8');
    expect(source).toContain('LAST ROW APPENDED');
    expect(source).toContain("routes/wallet.ts`'s `balanceOf`");
  });
});
