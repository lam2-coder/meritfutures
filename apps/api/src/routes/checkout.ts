// =============================================================================
// apps/api/src/routes/checkout.ts
// =============================================================================
// API_CONTRACT SECTION 5's `POST /checkout` AND `POST /accounts/:accountId/reset`,
// AND THE SENTENCE THAT SECTION ENDS WITH IS THE WHOLE DESIGN:
//
//   "Server-authoritative rules that the client cannot influence: PRICE COMES
//    FROM `plan_version_sizes`, NEVER FROM THE REQUEST; THE COUPON DISCOUNT IS
//    RECOMPUTED SERVER-SIDE; the account cap is checked against the RESOLVED
//    IDENTITY, not the email."
//
// Section 12 rows the first of those as a required negative-authz test --
// "Checkout with a client-supplied price field -> field ignored; server price
// used" -- and `test/checkout.test.ts` asserts that row IN BOTH DIRECTIONS,
// because a test that only watches a tampered price refused cannot tell a
// working price lookup from one that refuses everything.
//
// -----------------------------------------------------------------------------
// THE PRICE IS NOT DEFENDED HERE. IT IS DEFENDED BY HAVING NO PATH FROM THE BODY
// -----------------------------------------------------------------------------
// INV-M3-02's enforcement column is one sentence and it is the design:
// "Zod schema has no price field at all. THE ABSENCE IS THE CONTROL."
//
// `CheckoutRequest` below declares `plan_id`, `size_cents`, `coupon_code`,
// `affiliate_click_token` and `accept_tos_version_ids`, which is section 5's
// list and no sixth member. `size_cents` IS AN INPUT TO A LOOKUP AND NEVER A
// PRICE: it selects a row of `plan_version_sizes` through
// `plan_version_sizes_version_size_uq (plan_version_id, size_cents)`, and the
// price is that row's `price_cents` for a new purchase or its
// `reset_price_cents` for a reset. `validateCheckoutRequest` drops every other
// key, so a body carrying `amount_cents`, `price_cents` or `discount_cents`
// reaches nothing that could read it.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` CENTS EVERYWHERE INSIDE THIS FILE, AND THE WIRE IS THE ONLY
// PLACE A `number` APPEARS
// -----------------------------------------------------------------------------
// API_CONTRACT section 1: "`*_cents` are JSON integers. `*_bp` are JSON
// integers. NO FLOATS, no formatted strings." The schema is `bigint` on all
// four money columns of `purchases` (`0006_commerce.sql`), so the arithmetic
// here is `bigint` and the two conversions live in `centsFromJson` and
// `centsToJson`, which refuse rather than round. A `number` that is not an
// integer, or a `bigint` past `Number.MAX_SAFE_INTEGER`, is an error and never
// a nearest value.
//
// -----------------------------------------------------------------------------
// ATTRIBUTION RESOLVES INSIDE THE CHECKOUT TRANSACTION, WHICH IS WHY THIS FILE
// AND `packages/affiliate` ARE ONE SLICE
// -----------------------------------------------------------------------------
// M08 section 3.1: "RESOLUTION HAPPENS AT CHECKOUT START, in the same step that
// pins the plan version, so an affiliate cannot be added or changed after the
// buyer has seen a price. And IT HAPPENS ONCE."
//
// `resolveAttribution` is a pure fold in `@merit/affiliate` and this file holds
// none of its logic: the handler reads the coupon's affiliate and the click the
// token names, hands both to the fold, and writes the row the fold returns. A
// fold that failed leaves NO PURCHASE ROW, because the write is on the same
// transaction as the purchase insert and the handler does not catch it. That is
// this session's approval line and the suite drives it by seeding a failure in
// the attribution write.
//
// -----------------------------------------------------------------------------
// THIS FILE IMPORTS NO DATABASE ACCESSOR AND THAT IS A FENCE FACT WITH A FINDING
// BEHIND IT
// -----------------------------------------------------------------------------
// `apps/api` declares no `@merit/db` and this slice does not add one, so
// checkout reaches its rows through `CheckoutTx`, exactly as
// `routes/webhooks-psp.ts` reaches its rows through `PspWebhookTx` and
// `routes/auth.ts` reaches its rows through `AuthBackend`.
//
// THE WIRING SESSION THAT BINDS THIS PORT MEETS A WALL THAT IS STILL STANDING,
// and it is named here rather than discovered there. `attributions` is scope
// class `pair` (ADR-106): a `pair` key is in NEITHER the scoped key set NOR the
// firm one, so the only remaining door is `systemDb(reason)`, whose vocabulary
// is `'nightly-batch' | 'operator-console'`. A checkout request handler is
// neither. Session 216 reported it, session 215 attached `attributions` to it,
// and ADR-112 -- which gave the accessor an ADDRESS -- says in its own section
// 10 that it did not move the AUTHORITY. `insertAttribution` below is where
// that decision lands and it is a port until somebody takes it.
//
// -----------------------------------------------------------------------------
// A THIRD PARTY IS CALLED INSIDE AN OPEN TRANSACTION AND THE COST IS STATED
// -----------------------------------------------------------------------------
// `purchases.psp_reference` is `text NOT NULL` and
// `purchases_psp_reference_uq (psp, psp_reference)` is, in `0006`'s own words,
// "THE IDEMPOTENCY ANCHOR FOR WEBHOOKS"; M03 section 6 requires that
// `purchase.paid` match "a `purchases` row MERIT CREATED AT CHECKOUT, matched
// by `(psp, psp_reference)`". So the provider's session id is known before the
// row is inserted, and the row is inserted in the same transaction as the
// attribution. Those two together put `createSession` inside the transaction.
//
// THE TWO ALTERNATIVES WERE PRICED AND NEITHER IS AVAILABLE IN THIS FENCE.
// Inserting first and stamping the reference afterwards needs the row to exist
// with a reference it does not have yet, which is a nullable column and a
// migration; `0048` stays free. Committing first and calling the provider
// afterwards produces a committed `pending` purchase with no payment session
// whenever the provider is slow, which is a charge the buyer can never
// complete and a row the contract has no response for. The hazard that remains
// is a transaction held open across a network call, and it is REPORTED rather
// than routed around.
//
// -----------------------------------------------------------------------------
// NO VENDOR EXISTS AND THIS ROUTE SAYS SO WITH A STATUS CODE
// -----------------------------------------------------------------------------
// `packages/psp` ships a port and TWO FAKES (ADR-105, session 217). There is no
// adapter for a real provider, so `currentCheckoutAdapters` resolves nothing in
// a live deployment and checkout answers `503 service_unavailable`, which is
// section 2's code for a dependency that is not there. THE SUITE PROVES THE
// PIPELINE AND NOT THE PROVIDER: every `payment_session` in this file's tests
// comes from a fake, and shipping this to a real customer needs a procurement
// decision nobody has taken.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { resolveAttribution } from '@merit/affiliate';
import type { AffiliateRef, AttributionRow, ClickRef, LinkConfidence } from '@merit/affiliate';
import { BothMidsUnhealthyError, cardLegOf, chooseMidForNewAttempt } from '@merit/psp';
import type { MidCandidate, PaymentSession, PspAdapter, PspId } from '@merit/psp';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, PROBLEM_TYPE_PREFIX, problem } from '../server.ts';
import type { Problem } from '../server.ts';
import {
  type AuthSession,
  type EndpointSpec,
  type FieldError,
  requiredFactorTable,
  toRoutes,
  withSessionContext,
} from './auth.ts';

/** API_CONTRACT section 5's rows, as the contract writes them. No base path. */
export const CHECKOUT_PATH = '/checkout';
export const RESET_PATH = '/accounts/:accountId/reset';

// -----------------------------------------------------------------------------
// The wire, section 5's own shapes
// -----------------------------------------------------------------------------

/** `CheckoutRequest`. Five members, and there is no price among them. */
export interface CheckoutRequest {
  readonly plan_id: string;
  /**
   * WHICH ROW OF THE PRICE GRID, AND NEVER A PRICE.
   *
   * `plan_version_sizes_version_size_uq (plan_version_id, size_cents)`
   * (`0004_catalog.sql:220`) makes this a lookup key. A `size_cents` naming no
   * row is `validation_failed`, not a purchase at a price the client chose.
   */
  readonly size_cents: number;
  readonly coupon_code?: string;
  readonly affiliate_click_token?: string;
  readonly accept_tos_version_ids: readonly string[];
}

/** `ResetRequest`. The plan version comes from the account, so it is not here. */
export interface ResetRequest {
  readonly coupon_code?: string;
  readonly accept_tos_version_ids: readonly string[];
}

/** `CheckoutResponse`, field for field, as an allowlist. Section 1's API3 control. */
export interface CheckoutResponse {
  readonly purchase_id: string;
  /** Resolved now and pinned. B4 #12, INV-M3-01. */
  readonly plan_version_id: string;
  readonly amount_cents: number;
  readonly discount_cents: number;
  readonly psp: PspId;
  readonly payment_session: {
    readonly provider_session_id: string;
    readonly redirect_url: string;
    readonly expires_at: string;
  };
}

/** `ResetResponse = CheckoutResponse & { parent_account_id }`. */
export interface ResetResponse extends CheckoutResponse {
  readonly parent_account_id: string;
}

// -----------------------------------------------------------------------------
// The rows this handler reads, in this handler's terms
// -----------------------------------------------------------------------------

/** `purchases.kind`'s CHECK list. `0006_commerce.sql:110`. */
export type PurchaseKind = 'new' | 'reset';

/** The published `plan_versions` row a checkout pins. */
export interface PlanVersionRow {
  /** `plan_versions.id`. Written to `purchases.plan_version_id`, write-once. */
  readonly planVersionId: string;
}

/**
 * One `plan_version_sizes` row. THE PRICE LIVES HERE AND NOWHERE ELSE.
 *
 * Both columns are `bigint NOT NULL CHECK (> 0)` (`0004_catalog.sql:150`), so
 * both are `bigint` here. A zero price is unrepresentable in the schema and is
 * therefore not a case this file handles.
 */
export interface PlanVersionSizeRow {
  readonly sizeCents: bigint;
  readonly priceCents: bigint;
  readonly resetPriceCents: bigint;
}

/**
 * One `coupons` row, plus the affiliate its `affiliate_id` names.
 *
 * THE AFFILIATE IS RESOLVED BY THE SAME READ AND NOT BY A SECOND ONE, because
 * `coupons.affiliate_id` is NULLABLE and most codes name no affiliate at all: a
 * launch code is an offer Merit makes, and `scope.ts` says so about this exact
 * column. `null` here means the code is a discount and not a referral, which is
 * the ordinary case and not a missing branch.
 */
export interface CouponRow {
  readonly couponId: string;
  /** `coupons.discount_kind`'s CHECK list. */
  readonly discountKind: 'percent' | 'fixed';
  /** `coupons.discount_bp`. Set exactly when `discountKind` is `percent`. */
  readonly discountBp: number | null;
  /** `coupons.discount_cents`. Set exactly when `discountKind` is `fixed`. */
  readonly discountCents: bigint | null;
  /** SD-M3-04. `coupons.applies_to_kind`. */
  readonly appliesToKind: 'new' | 'reset' | 'any';
  /** SD-M3-04. `coupons.first_purchase_only`. */
  readonly firstPurchaseOnly: boolean;
  readonly isActive: boolean;
  readonly startsAt: Date | null;
  readonly expiresAt: Date | null;
  readonly maxRedemptions: number | null;
  readonly redemptionCount: number;
  readonly perIdentityLimit: number;
  /** `affiliates` through `coupons.affiliate_id`, or `null`. */
  readonly affiliate: AffiliateRef | null;
}

/**
 * `identity_status`, the enum's three members.
 *
 * `0001_extensions_and_enums.sql:27`:
 * `CREATE TYPE identity_status AS ENUM ('active', 'restricted', 'closed')`.
 * A fourth member is a migration before it is a type change.
 */
export type IdentityStatus = 'active' | 'restricted' | 'closed';

/**
 * SD-M3-05's geo triangle, as checkout decides it.
 *
 * `geo_restrictions.rule` is `'block_purchase' | 'block_all' | 'warn'`
 * (`0004_catalog.sql:270`) and `purchases.geo_decision` is
 * `'allowed' | 'warned' | 'blocked'` (`0006_commerce.sql:145`). They are two
 * vocabularies over one fact: the first is the RULE Merit publishes and the
 * second is THE DECISION MERIT MADE, which SD-M3-05 requires be recorded at
 * checkout because "reconstructing it later from an IP log is not the same
 * artifact: it tells you where they were, not what we decided."
 */
export interface GeoDecisionRow {
  /** `purchases.checkout_ip_country`, `char(2)`, or `null` when unresolved. */
  readonly countryCode: string | null;
  readonly decision: 'allowed' | 'warned' | 'blocked';
}

/** What the cap check reads. INV-M3-08: per resolved identity, never per email. */
export interface AccountCapRow {
  /** Live accounts this IDENTITY holds. */
  readonly liveAccounts: number;
  /** The identity's cap, `max_accounts_override` folded over the plan default. */
  readonly maxAccounts: number;
  /** `identities.status`. INV-M3-15 refuses `restricted`. */
  readonly identityStatus: IdentityStatus;
  /** Whether this identity has ever completed a purchase. SD-M3-04. */
  readonly hasPriorPurchase: boolean;
}

/** The account a reset repurchases onto. */
export interface ResetTargetRow {
  readonly accountId: string;
  readonly planVersionId: string;
  readonly sizeCents: bigint;
  /** Section 5's `conflict`: "account is not resettable". */
  readonly resettable: boolean;
}

/** The `purchases` row this handler writes. Every money field is `bigint`. */
export interface PurchaseInsert {
  readonly id: string;
  readonly identityId: string;
  readonly userId: string;
  readonly planVersionId: string;
  readonly sizeCents: bigint;
  readonly kind: PurchaseKind;
  readonly parentAccountId: string | null;
  readonly listPriceCents: bigint;
  readonly discountCents: bigint;
  readonly amountPaidCents: bigint;
  readonly couponId: string | null;
  /** `purchases.affiliate_id`. Null when attribution resolved to none OR voided. */
  readonly affiliateId: string | null;
  readonly psp: PspId;
  readonly pspReference: string;
  readonly ip: string | null;
  /** SD-M3-05. Recorded at checkout, never reconstructed. */
  readonly checkoutIpCountry: string | null;
  /** SD-M3-05. */
  readonly geoDecision: 'allowed' | 'warned' | 'blocked';
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/**
 * One open transaction, as checkout needs to see it.
 *
 * EVERY METHOD HERE RUNS ON ONE TRANSACTION AND THAT IS THE WHOLE POINT. The
 * cap check, the coupon claim, the purchase insert and the attribution insert
 * are one atomic act, so a cap that passed cannot be exceeded by a concurrent
 * checkout between the read and the write, and an attribution that failed
 * cannot leave a purchase standing.
 *
 * THE READS ARE ALREADY SCOPED BY THE HANDLE AND THIS INTERFACE CARRIES NO
 * IDENTITY PARAMETER. `CheckoutBackend.transact` is handed the session, so an
 * implementation binds the identity once. A method here taking an identity
 * would be a method a caller could hand somebody else's.
 */
export interface CheckoutTx {
  /**
   * The plan's currently published version, or `null` when the plan has none.
   *
   * `null` is section 5's `precondition_failed`: "plan version retired between
   * page load and submit". It is a distinct answer from a plan that never
   * existed, which is `validation_failed`, and the two are not collapsed.
   */
  publishedPlanVersion(planId: string): Promise<PlanVersionRow | null>;

  /** The price grid row, or `null` when this version sells no such size. */
  planVersionSize(planVersionId: string, sizeCents: bigint): Promise<PlanVersionSizeRow | null>;

  /** INV-M3-08 and INV-M3-15, read together because they are checked together. */
  accountCap(): Promise<AccountCapRow>;

  /** The coupon this code names, or `null`. `coupons.code` is `citext`. */
  couponByCode(code: string): Promise<CouponRow | null>;

  /**
   * Claim the coupon by INSERTING `coupon_redemptions`, bound to this purchase.
   *
   * `'already_claimed'` when `coupon_redemptions_live_claim_uq` refused it.
   * THE INSERT IS THE RACE AND THIS IS NOT A CHECKED WRITE: INV-M3-06 says the
   * claim is "decided by the database", and `0006` says the same in capitals --
   * "THIS TABLE IS WHY TWO TABS CANNOT BOTH WIN A SINGLE-USE CODE. Redemption
   * is an ATOMIC CLAIM, never a read-then-write (B4 #11)."
   */
  claimCoupon(couponId: string, purchaseId: string): Promise<'claimed' | 'already_claimed'>;

  /** The click this token names, or `null`. `affiliate_clicks_token_uq`. */
  clickByToken(token: string): Promise<ClickRef | null>;

  /** The account a reset targets, or `null` when it is not this caller's. */
  resetTarget(accountId: string): Promise<ResetTargetRow | null>;

  /**
   * SD-M3-05. What this request's origin resolves to, and what Merit decided.
   *
   * IT IS ASKED EVEN WHEN THE ANSWER IS `allowed`, because the column is
   * `purchases.geo_decision` and a null there would mean the check did not run
   * rather than that it passed.
   */
  geoDecision(ip: string): Promise<GeoDecisionRow>;

  /** `mid_health`, as `chooseMidForNewAttempt` reads it. SD-M3-03. */
  midCandidates(): Promise<readonly MidCandidate[]>;

  /** INV-M3-09. Append-only, unique per identity per version, with the IP. */
  recordTosAcceptance(versionIds: readonly string[], ip: string): Promise<void>;

  /** INSERT the purchase. The id is supplied: see `newPurchaseId`. */
  insertPurchase(row: PurchaseInsert): Promise<void>;

  /**
   * INSERT the attribution. INV-M8-01's unique `purchase_id` is the control.
   *
   * SEE THIS FILE'S HEADER FOR WHY THIS METHOD IS STILL A PORT. `attributions`
   * is a `pair` table and no authority in `packages/db` admits a request
   * handler writing one.
   */
  insertAttribution(purchaseId: string, row: AttributionRow): Promise<void>;

  /**
   * M07's `D-16` verdict about this buyer and this affiliate, or `null`.
   *
   * `null` means NO RESOLVER RAN. The producer does not exist in this workspace
   * (M07 section 3.2, ADR-022), so every implementation in this tree returns
   * `null` today and `@merit/affiliate` refuses to read that as a verdict of
   * zero.
   */
  linkConfidence(affiliate: AffiliateRef): Promise<LinkConfidence | null>;
}

/** What opens a transaction. One method, and it takes the session. */
export interface CheckoutBackend {
  /**
   * Run `fn` on one transaction. IT COMMITS ONLY IF `fn` RETURNS.
   *
   * An implementation that swallowed a throw would break this session's
   * approval line, so the suite drives a fake whose `transact` rolls back on a
   * throw and asserts the purchase absent afterwards.
   */
  transact<T>(session: AuthSession, fn: (tx: CheckoutTx) => Promise<T>): Promise<T>;
}

/** Where a provider's adapter comes from. Section 5's `psp` union is closed. */
export interface CheckoutAdapters {
  /** The adapter for this MID, or `undefined` when none is configured. */
  adapterFor(psp: PspId): PspAdapter | undefined;
  /** Where the provider returns the buyer. Configuration, never a request field. */
  readonly returnUrl: string;
  readonly cancelUrl: string;
}

/** Thrown by the unwired backend. Answered as 503 rather than 500. */
export class CheckoutBackendUnwired extends Error {
  constructor(method: string) {
    super(
      `CheckoutBackend.${method} is not wired. Checkout is declared and its persistence is not ` +
        'installed, so this deployment answers 503 rather than serving a purchase it cannot record',
    );
    this.name = 'CheckoutBackendUnwired';
  }
}

/**
 * A backend that refuses every call.
 *
 * ON `routes/auth.ts`'s PRECEDENT AND FOR ITS REASON: a backend that returned
 * plausible values would be a fixture serving real traffic. The route is
 * REGISTERED because the contract row exists, and a missing route would answer
 * 404 and look like a contract Merit never wrote.
 */
export const UNWIRED_CHECKOUT_BACKEND: CheckoutBackend = {
  transact: () => Promise.reject(new CheckoutBackendUnwired('transact')),
};

/**
 * The adapter set a live deployment resolves, which is EMPTY.
 *
 * `packages/psp` ships a port and two fakes and no vendor adapter, so this
 * resolves nothing and checkout answers 503. The URLs are empty for the same
 * reason `resolveSurface` refuses a default: a value this file would have to
 * invent is one that decides where a buyer's browser is sent after paying.
 */
export const PRODUCTION_CHECKOUT_ADAPTERS: CheckoutAdapters = {
  adapterFor: () => undefined,
  returnUrl: '',
  cancelUrl: '',
};

let backend: CheckoutBackend = UNWIRED_CHECKOUT_BACKEND;
let adapters: CheckoutAdapters = PRODUCTION_CHECKOUT_ADAPTERS;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useCheckoutBackend(next: CheckoutBackend): void {
  backend = next;
}

/** Install the adapter set. */
export function useCheckoutAdapters(next: CheckoutAdapters): void {
  adapters = next;
}

/** Put both back. The suite calls this between cases. */
export function resetCheckoutWiring(): void {
  backend = UNWIRED_CHECKOUT_BACKEND;
  adapters = PRODUCTION_CHECKOUT_ADAPTERS;
}

/** The installed backend. */
export function currentCheckoutBackend(): CheckoutBackend {
  return backend;
}

/** The installed adapter set. */
export function currentCheckoutAdapters(): CheckoutAdapters {
  return adapters;
}

// -----------------------------------------------------------------------------
// Money at the boundary. Two functions, and both refuse rather than round.
// -----------------------------------------------------------------------------

/** Raised when a value on the money path is not integer cents. */
export class CheckoutMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutMoneyError';
  }
}

/**
 * A JSON integer to `bigint` cents.
 *
 * IT REFUSES A NON-INTEGER RATHER THAN TRUNCATING ONE. `99.5` is not a number
 * of cents, and `BigInt(99.5)` throws a `RangeError` that would surface as a
 * 500 where a `validation_failed` is correct, so the check is explicit.
 */
export function centsFromJson(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return BigInt(value);
}

/**
 * `bigint` cents back to a JSON integer.
 *
 * IT THROWS PAST `Number.MAX_SAFE_INTEGER` RATHER THAN SERIALISING A WRONG
 * NUMBER. The columns are `bigint`, so a value that cannot be a JSON integer is
 * expressible in the schema; at 2^53 cents that is ninety trillion dollars and
 * it will not happen, which is a reason to assert it cheaply rather than a
 * reason to skip it.
 */
export function centsToJson(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CheckoutMoneyError(
      `${value.toString()} cents cannot be a JSON integer; API_CONTRACT section 1 says *_cents are JSON integers`,
    );
  }
  return Number(value);
}

// -----------------------------------------------------------------------------
// The discount, recomputed. Section 5's second server-authoritative rule.
// -----------------------------------------------------------------------------

/** Why a coupon does not apply. Closed, and each member is a refusal with a code. */
export type CouponRefusal =
  | 'coupon_not_found'
  | 'coupon_inactive'
  | 'coupon_not_started'
  | 'coupon_expired'
  | 'coupon_exhausted'
  | 'coupon_wrong_purchase_kind'
  | 'coupon_first_purchase_only';

/** What the recompute decided. */
export type DiscountOutcome =
  | { readonly kind: 'applied'; readonly discountCents: bigint }
  | { readonly kind: 'refused'; readonly refusal: CouponRefusal };

/**
 * THE DISCOUNT, RECOMPUTED FROM THE COUPON ROW AND THE SERVER'S LIST PRICE.
 *
 * NOTHING THE CLIENT SENT REACHES THIS FUNCTION. Its inputs are a `coupons` row
 * and a `plan_version_sizes` price, and the only thing the request contributed
 * is which code to look up.
 *
 * THE PERCENT BRANCH IS INTEGER ARITHMETIC AND ROUNDS DOWN, WHICH IS A CHOICE
 * WITH A DIRECTION. `list * bp / 10000` in `bigint` truncates, so a rounding
 * remainder is a cent Merit keeps rather than a cent it gives away. The
 * alternative rounds a discount UP against the firm on every fractional cent,
 * forever, and no document asks for that.
 *
 * THE RESULT IS CLAMPED AT THE LIST PRICE, which is `purchases_discount_within_list`
 * (`0006_commerce.sql:182`) satisfied by construction rather than hoped for. A
 * fixed coupon worth more than the plan makes the purchase free and never
 * negative: `amount_paid_cents` is CHECKed `>= 0`.
 */
export function recomputeDiscount(
  coupon: CouponRow,
  listPriceCents: bigint,
  kind: PurchaseKind,
  cap: AccountCapRow,
  at: Date,
): DiscountOutcome {
  if (!coupon.isActive) return { kind: 'refused', refusal: 'coupon_inactive' };
  if (coupon.startsAt !== null && at < coupon.startsAt) {
    return { kind: 'refused', refusal: 'coupon_not_started' };
  }
  if (coupon.expiresAt !== null && at >= coupon.expiresAt) {
    return { kind: 'refused', refusal: 'coupon_expired' };
  }
  if (coupon.maxRedemptions !== null && coupon.redemptionCount >= coupon.maxRedemptions) {
    return { kind: 'refused', refusal: 'coupon_exhausted' };
  }

  // SD-M3-04, AS-M3-04's "immortal launch code". Reset pricing and new-purchase
  // pricing are DIFFERENT PRODUCTS WITH DIFFERENT MARGINS, and without this one
  // leaked launch code discounts resets forever, which is the highest-volume
  // repeat purchase in the business.
  if (coupon.appliesToKind !== 'any' && coupon.appliesToKind !== kind) {
    return { kind: 'refused', refusal: 'coupon_wrong_purchase_kind' };
  }
  if (coupon.firstPurchaseOnly && cap.hasPriorPurchase) {
    return { kind: 'refused', refusal: 'coupon_first_purchase_only' };
  }

  const raw =
    coupon.discountKind === 'percent'
      ? (listPriceCents * BigInt(coupon.discountBp ?? 0)) / 10_000n
      : (coupon.discountCents ?? 0n);

  return { kind: 'applied', discountCents: raw > listPriceCents ? listPriceCents : raw };
}

// -----------------------------------------------------------------------------
// Validation. Total over section 5's shapes, hand written, on `auth.ts`'s model.
// -----------------------------------------------------------------------------

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The accepted ToS version ids. INV-M3-09.
 *
 * "Every purchase records the EXACT `tos_version_id` SET the buyer accepted,
 * with IP and timestamp ... It is the first artifact any enforcement dispute
 * asks for." So an empty array is a validation failure and never an implicit
 * acceptance.
 */
function validateTosIds(row: Record<string, unknown>, errors: FieldError[]): string[] | null {
  const raw = row['accept_tos_version_ids'];
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push({
      path: 'accept_tos_version_ids',
      message: 'must be a non-empty array of tos_version ids',
    });
    return null;
  }
  if (!raw.every((each) => nonEmptyString(each))) {
    errors.push({ path: 'accept_tos_version_ids', message: 'every entry must be a non-empty id' });
    return null;
  }
  return raw as string[];
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
  errors: FieldError[],
): string | undefined | null {
  const raw = row[key];
  if (raw === undefined) return undefined;
  if (!nonEmptyString(raw)) {
    errors.push({ path: key, message: 'must be a non-empty string when present' });
    return null;
  }
  return raw;
}

/**
 * `POST /checkout`'s body.
 *
 * IT BUILDS THE VALUE FIELD BY FIELD AND NEVER SPREADS THE BODY. A spread would
 * be one character shorter and would carry every key the client invented into
 * the handler, which is the shape INV-M3-02 calls the control by its absence.
 */
export function validateCheckoutRequest(body: unknown): Validated<CheckoutRequest> {
  const errors: FieldError[] = [];
  const row = asRecord(body);
  if (row === null) {
    return { ok: false, errors: [{ path: '', message: 'body must be a JSON object' }] };
  }

  const planId = row['plan_id'];
  if (!nonEmptyString(planId)) errors.push({ path: 'plan_id', message: 'must be a non-empty id' });

  const sizeCents = centsFromJson(row['size_cents']);
  if (sizeCents === null || sizeCents <= 0n) {
    errors.push({ path: 'size_cents', message: 'must be a positive integer number of cents' });
  }

  const couponCode = optionalString(row, 'coupon_code', errors);
  const clickToken = optionalString(row, 'affiliate_click_token', errors);
  const tosIds = validateTosIds(row, errors);

  if (errors.length > 0 || !nonEmptyString(planId) || sizeCents === null || tosIds === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      plan_id: planId,
      size_cents: Number(sizeCents),
      ...(couponCode === undefined || couponCode === null ? {} : { coupon_code: couponCode }),
      ...(clickToken === undefined || clickToken === null
        ? {}
        : { affiliate_click_token: clickToken }),
      accept_tos_version_ids: tosIds,
    },
  };
}

/** `POST /accounts/:accountId/reset`'s body. Two members and no plan. */
export function validateResetRequest(body: unknown): Validated<ResetRequest> {
  const errors: FieldError[] = [];
  const row = asRecord(body);
  if (row === null) {
    return { ok: false, errors: [{ path: '', message: 'body must be a JSON object' }] };
  }
  const couponCode = optionalString(row, 'coupon_code', errors);
  const tosIds = validateTosIds(row, errors);
  if (errors.length > 0 || tosIds === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...(couponCode === undefined || couponCode === null ? {} : { coupon_code: couponCode }),
      accept_tos_version_ids: tosIds,
    },
  };
}

// -----------------------------------------------------------------------------
// Problem documents. Section 2's codes, and this module's own senders.
// -----------------------------------------------------------------------------

/**
 * Section 2's shape widened by `errors[]` only.
 *
 * `auth.ts` holds the same widening and does not export its sender, and this
 * module does not reach across a fence to borrow one. `problem()` and
 * `PROBLEM_TYPE_PREFIX` are imported rather than respelled.
 */
interface ProblemDocument extends Problem {
  readonly detail?: string;
  readonly errors?: readonly FieldError[];
}

function sendProblem(reply: FastifyReply, body: ProblemDocument): FastifyReply {
  return reply.code(body.status).type(PROBLEM_MEDIA_TYPE).send(body);
}

/**
 * A code section 2 defines that `server.ts`'s closed `TITLE` table does not
 * carry, because that table holds the codes the TRANSPORT can produce.
 */
function handlerProblem(
  code: string,
  title: string,
  status: number,
  instance: string,
): ProblemDocument {
  return { type: `${PROBLEM_TYPE_PREFIX}${code}`, title, status, code, instance };
}

/** Section 5's `account_cap_reached`. */
export const ACCOUNT_CAP_REACHED = 'account_cap_reached';
/** Section 5's `precondition_failed`. */
export const PRECONDITION_FAILED = 'precondition_failed';
/** Section 5's `geo_restricted`, on both endpoints. SD-M3-05. */
export const GEO_RESTRICTED = 'geo_restricted';

// -----------------------------------------------------------------------------
// The purchase, assembled
// -----------------------------------------------------------------------------

/**
 * The purchase id, minted here rather than defaulted by the database.
 *
 * `purchases.id` has `DEFAULT gen_random_uuid()`, and this handler supplies a
 * value anyway for one reason: `PurchaseIntent.purchaseId` is what the provider
 * echoes back to Merit, so the id must exist BEFORE `createSession` is called,
 * and reading it back from an insert would put the insert before the call that
 * produces `psp_reference`, which is `NOT NULL`.
 */
export function newPurchaseId(): string {
  return randomUUID();
}

/** What one checkout, new or reset, resolved to before anything was written. */
interface ResolvedPurchase {
  readonly planVersionId: string;
  readonly sizeCents: bigint;
  readonly listPriceCents: bigint;
  readonly kind: PurchaseKind;
  readonly parentAccountId: string | null;
}

type Refusal = { readonly send: (reply: FastifyReply, requestId: string) => FastifyReply };

function refuse(code: string, title: string, status: number, detail?: string): Refusal {
  return {
    send: (reply, requestId) =>
      sendProblem(reply, {
        ...handlerProblem(code, title, status, requestId),
        ...(detail === undefined ? {} : { detail }),
      }),
  };
}

/**
 * The gates INV-M3-08 and INV-M3-15 put at the same point in the transaction.
 *
 * INV-M3-15 is checked FIRST and it is a HARD LIMIT AND NEVER A FLAG: ADR-041
 * requires "a named refusal with a stated reason and never a silent decline",
 * on OQ-M3-03's reasoning that a silent decline teaches a ring to try a
 * different email while an explicit one does not.
 */
function gateIdentity(cap: AccountCapRow): Refusal | null {
  if (cap.identityStatus !== 'active') {
    return refuse(
      'forbidden',
      'Forbidden',
      403,
      `This identity is ${cap.identityStatus} and cannot complete a purchase.`,
    );
  }
  if (cap.liveAccounts >= cap.maxAccounts) {
    return refuse(
      ACCOUNT_CAP_REACHED,
      'Account cap reached',
      409,
      `This identity holds ${String(cap.liveAccounts)} of ${String(cap.maxAccounts)} accounts.`,
    );
  }
  return null;
}

/**
 * Resolve the coupon and the discount together, or refuse.
 *
 * A CODE THAT NAMES NO COUPON IS A `validation_failed` AND NOT A SILENT ZERO
 * DISCOUNT. A buyer who typed a code and was charged full price with a 200 has
 * been told nothing, and support cannot tell that case from a working one.
 */
async function resolveCoupon(
  tx: CheckoutTx,
  code: string | undefined,
  listPriceCents: bigint,
  kind: PurchaseKind,
  cap: AccountCapRow,
  at: Date,
): Promise<{ coupon: CouponRow | null; discountCents: bigint } | Refusal> {
  if (code === undefined) return { coupon: null, discountCents: 0n };
  const coupon = await tx.couponByCode(code);
  if (coupon === null) {
    return refuse('validation_failed', 'Validation failed', 400, 'No such coupon code.');
  }
  const outcome = recomputeDiscount(coupon, listPriceCents, kind, cap, at);
  if (outcome.kind === 'refused') {
    // Section 5 names `conflict` for "coupon exhausted or already claimed by
    // this identity". The other refusals are properties of the code as it
    // stands rather than of a race, so they are `validation_failed`.
    return outcome.refusal === 'coupon_exhausted'
      ? refuse('conflict', 'Conflict', 409, 'This coupon is exhausted.')
      : refuse(
          'validation_failed',
          'Validation failed',
          400,
          `Coupon refused: ${outcome.refusal}.`,
        );
  }
  return { coupon, discountCents: outcome.discountCents };
}

/** The affiliate a coupon names, folded to `@merit/affiliate`'s shape. */
function codeAffiliateOf(coupon: CouponRow | null): AffiliateRef | null {
  return coupon === null ? null : coupon.affiliate;
}

/**
 * The body of both endpoints, from the gates to the response.
 *
 * IT IS ONE FUNCTION BECAUSE THE CONTRACT MAKES `ResetResponse` EXTEND
 * `CheckoutResponse`, and the two paths differ in exactly three places: which
 * price column is read, what `kind` is written, and whether
 * `parent_account_id` is set. Writing them twice is how the reset path acquires
 * a subtly different cap check.
 */
async function completePurchase(args: {
  readonly tx: CheckoutTx;
  readonly session: AuthSession;
  readonly resolved: ResolvedPurchase;
  readonly cap: AccountCapRow;
  readonly couponCode: string | undefined;
  readonly clickToken: string | undefined;
  readonly tosVersionIds: readonly string[];
  readonly ip: string;
  readonly at: Date;
}): Promise<CheckoutResponse | Refusal> {
  const { tx, session, resolved, cap, couponCode, clickToken, tosVersionIds, ip, at } = args;

  // SD-M3-05. `block_purchase` and `block_all` both reach checkout as
  // `blocked`; `warn` is `warned` and the purchase proceeds, which is why
  // `geo_restrictions.rule` is "a three-value rule rather than a boolean" in
  // `0004`'s own words.
  const geo = await tx.geoDecision(ip);
  if (geo.decision === 'blocked') {
    return refuse(
      GEO_RESTRICTED,
      'Geo restricted',
      403,
      'Purchases are not available from this location.',
    );
  }

  const coupon = await resolveCoupon(
    tx,
    couponCode,
    resolved.listPriceCents,
    resolved.kind,
    cap,
    at,
  );
  if ('send' in coupon) return coupon;

  const amountPaidCents = resolved.listPriceCents - coupon.discountCents;

  // ATTRIBUTION RESOLVES HERE, INSIDE THE TRANSACTION AND BEFORE THE PROVIDER
  // IS CALLED. M08 section 3.1: "in the same step that pins the plan version".
  const click = clickToken === undefined ? null : await tx.clickByToken(clickToken);
  const codeAffiliate = codeAffiliateOf(coupon.coupon);
  const candidate = codeAffiliate ?? click?.affiliate ?? null;
  const decision = resolveAttribution({
    buyerIdentityId: session.identityId,
    codeAffiliate,
    click,
    at,
    linkConfidence: candidate === null ? null : await tx.linkConfidence(candidate),
  });

  // INV-M3-11. Both unhealthy is the one state Merit cannot serve.
  let psp: PspId;
  try {
    psp = chooseMidForNewAttempt(await tx.midCandidates());
  } catch (err) {
    if (!(err instanceof BothMidsUnhealthyError)) throw err;
    return refuse('service_unavailable', 'Service unavailable', 503, err.message);
  }

  const adapter = currentCheckoutAdapters().adapterFor(psp);
  if (adapter === undefined) {
    return refuse(
      'service_unavailable',
      'Service unavailable',
      503,
      'No payment provider adapter is configured for this deployment.',
    );
  }

  const purchaseId = newPurchaseId();

  // `cardLegOf` is the ONLY producer of a `CardAmountCents` in this workspace
  // and it takes the purchase row's money. `payment_method` is `'psp'` here
  // because the wallet leg is SD-M3-06 and is not this slice's content: P3's
  // stated content is billing and checkout, and INV-M3-13's same-transaction
  // wallet debit needs a ledger posting this fence does not hold.
  const cardAmountCents = cardLegOf({
    paymentMethod: 'psp',
    amountPaidCents,
    walletDebitCents: 0n,
  });

  const paymentSession: PaymentSession = await adapter.createSession({
    purchaseId,
    cardAmountCents,
    currency: 'USD',
    returnUrl: currentCheckoutAdapters().returnUrl,
    cancelUrl: currentCheckoutAdapters().cancelUrl,
    // M03 section 3.2: "a new attempt is a NEW SESSION WITH A NEW IDEMPOTENCY
    // KEY", so this is minted per attempt and is never the purchase id.
    idempotencyKey: randomUUID(),
  });

  await tx.recordTosAcceptance(tosVersionIds, ip);

  await tx.insertPurchase({
    id: purchaseId,
    identityId: session.identityId,
    userId: session.userId,
    planVersionId: resolved.planVersionId,
    sizeCents: resolved.sizeCents,
    kind: resolved.kind,
    parentAccountId: resolved.parentAccountId,
    listPriceCents: resolved.listPriceCents,
    discountCents: coupon.discountCents,
    amountPaidCents,
    couponId: coupon.coupon === null ? null : coupon.coupon.couponId,
    // A VOIDED ATTRIBUTION CREDITS NOBODY, so `purchases.affiliate_id` is null
    // on a void. The `attributions` row still records what happened, which is
    // SD-M8-05's whole argument; the purchase simply carries no affiliate.
    affiliateId:
      decision.kind === 'attributed' && !decision.row.voided ? decision.row.affiliateId : null,
    psp,
    pspReference: paymentSession.providerSessionId,
    ip,
    checkoutIpCountry: geo.countryCode,
    geoDecision: geo.decision,
  });

  if (coupon.coupon !== null) {
    const claim = await tx.claimCoupon(coupon.coupon.couponId, purchaseId);
    if (claim === 'already_claimed') {
      // Section 5's `conflict`: "already claimed by this identity". Returning
      // rather than throwing rolls nothing back on its own, so the caller
      // converts a refusal into a rollback: see `runCheckout`.
      return refuse('conflict', 'Conflict', 409, 'This coupon is already claimed.');
    }
  }

  // THE ATTRIBUTION WRITE IS THE LAST THING AND IT IS NOT GUARDED. A throw here
  // rolls the purchase back, which is this session's approval line.
  if (decision.kind === 'attributed') {
    await tx.insertAttribution(purchaseId, decision.row);
  }

  return {
    purchase_id: purchaseId,
    plan_version_id: resolved.planVersionId,
    amount_cents: centsToJson(amountPaidCents),
    discount_cents: centsToJson(coupon.discountCents),
    psp,
    payment_session: {
      provider_session_id: paymentSession.providerSessionId,
      redirect_url: paymentSession.redirectUrl,
      expires_at: paymentSession.expiresAt,
    },
  };
}

/**
 * A refusal that has to ROLL BACK, because it was decided after a write.
 *
 * `completePurchase` returns a `Refusal` for a coupon that lost its claim, and
 * by then the purchase row is inserted. Returning it out of `transact` would
 * COMMIT that row. So the refusal is thrown, carried out of the transaction and
 * unwrapped here, which makes the rollback the transaction's own act rather
 * than a compensating delete.
 */
class RefusalThrown extends Error {
  readonly refusal: Refusal;

  constructor(refusal: Refusal) {
    super('checkout refused after a write; the transaction rolls back');
    this.name = 'RefusalThrown';
    this.refusal = refusal;
  }
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/**
 * Section 5's two commerce mutations, declared with their factor.
 *
 * BOTH DECLARE `session` AND NEITHER DECLARES ELEVATION. Section 12's own
 * checkout row states the factor as `session`, and C-27's sensitive-action list
 * is payout destination change, contact change and external withdrawal. A
 * purchase moves money TOWARD Merit and is reversible by refund and chargeback,
 * which is the asymmetry C-27 is drawn on.
 *
 * OWNERSHIP ON THE RESET PATH IS A 404 AND NOT A FACTOR. Section 1: "A path
 * parameter naming a resource the caller does not own returns 404 (not 403) on
 * trader surfaces, so the API does not confirm the existence of other people's
 * resources", which section 12 rows for `/accounts/{A}`. `resetTarget` returns
 * `null` for an account this handle cannot see and this handler cannot tell
 * that apart from an account that does not exist, which is the point.
 */
export const CHECKOUT_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'POST',
    path: CHECKOUT_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const validated = validateCheckoutRequest(request.body);
      if (!validated.ok) {
        return sendProblem(reply, {
          ...problem('validation_failed', 400, request.id),
          errors: validated.errors,
        });
      }
      const body = validated.value;
      const at = new Date();
      const ip = request.ip;

      return runCheckout(request, reply, session, async (tx) => {
        const cap = await tx.accountCap();
        const gate = gateIdentity(cap);
        if (gate !== null) return gate;

        const version = await tx.publishedPlanVersion(body.plan_id);
        if (version === null) {
          return refuse(
            PRECONDITION_FAILED,
            'Precondition failed',
            412,
            'This plan has no published version.',
          );
        }
        const sizeCents = BigInt(body.size_cents);
        const size = await tx.planVersionSize(version.planVersionId, sizeCents);
        if (size === null) {
          return refuse(
            'validation_failed',
            'Validation failed',
            400,
            'This plan version does not sell that size.',
          );
        }

        return completePurchase({
          tx,
          session,
          resolved: {
            planVersionId: version.planVersionId,
            sizeCents: size.sizeCents,
            // THE PRICE. `plan_version_sizes.price_cents`, and the request's
            // contribution to it was choosing which row to read.
            listPriceCents: size.priceCents,
            kind: 'new',
            parentAccountId: null,
          },
          cap,
          couponCode: body.coupon_code,
          clickToken: body.affiliate_click_token,
          tosVersionIds: body.accept_tos_version_ids,
          ip,
          at,
        });
      });
    }),
  },
  {
    method: 'POST',
    path: RESET_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const validated = validateResetRequest(request.body);
      if (!validated.ok) {
        return sendProblem(reply, {
          ...problem('validation_failed', 400, request.id),
          errors: validated.errors,
        });
      }
      const body = validated.value;
      const accountId = (request.params as { accountId?: string }).accountId ?? '';
      const at = new Date();
      const ip = request.ip;

      return runCheckout(request, reply, session, async (tx) => {
        const cap = await tx.accountCap();
        const gate = gateIdentity(cap);
        if (gate !== null) return gate;

        const target = await tx.resetTarget(accountId);
        if (target === null) return refuse('not_found', 'Not found', 404);
        if (!target.resettable) {
          return refuse('conflict', 'Conflict', 409, 'This account is not resettable.');
        }

        const size = await tx.planVersionSize(target.planVersionId, target.sizeCents);
        if (size === null) {
          return refuse(
            PRECONDITION_FAILED,
            'Precondition failed',
            412,
            'The pinned plan version no longer sells that size.',
          );
        }

        const response = await completePurchase({
          tx,
          session,
          resolved: {
            planVersionId: target.planVersionId,
            sizeCents: target.sizeCents,
            // THE RESET PRICE, which is a different column and not a discount
            // on the first one. SD-M3-04's whole argument is that the two are
            // different products with different margins.
            listPriceCents: size.resetPriceCents,
            kind: 'reset',
            parentAccountId: target.accountId,
          },
          cap,
          couponCode: body.coupon_code,
          clickToken: undefined,
          tosVersionIds: body.accept_tos_version_ids,
          ip,
          at,
        });
        if ('send' in response) return response;
        const reset: ResetResponse = { ...response, parent_account_id: target.accountId };
        return reset;
      });
    }),
  },
];

/**
 * Run one checkout on one transaction and turn its outcome into a response.
 *
 * A `Refusal` DECIDED INSIDE THE TRANSACTION IS THROWN OUT OF IT rather than
 * returned, so the transaction rolls back whatever it had already written. That
 * is why the coupon-claim conflict cannot commit a purchase.
 */
async function runCheckout<T extends CheckoutResponse>(
  request: FastifyRequest,
  reply: FastifyReply,
  session: AuthSession,
  body: (tx: CheckoutTx) => Promise<T | Refusal>,
): Promise<unknown> {
  try {
    return await currentCheckoutBackend().transact(session, async (tx) => {
      const outcome = await body(tx);
      if ('send' in outcome) throw new RefusalThrown(outcome);
      return outcome;
    });
  } catch (err) {
    if (err instanceof RefusalThrown) return err.refusal.send(reply, request.id);
    if (err instanceof CheckoutBackendUnwired) {
      request.log.error({ err }, 'checkout backend is not wired');
      return sendProblem(
        reply,
        handlerProblem('service_unavailable', 'Service unavailable', 503, request.id),
      );
    }
    throw err;
  }
}

/** The declaration as data, on `auth.ts`'s shape. Section 12's factor column. */
export const CHECKOUT_REQUIRED_FACTORS = requiredFactorTable(CHECKOUT_ENDPOINTS);

export default defineRoutes({
  name: 'checkout',
  routes: toRoutes(CHECKOUT_ENDPOINTS),
});
