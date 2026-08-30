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
// THERE IS NO ZOD SCHEMA IN THIS TREE AND THE CONTROL IS UNAFFECTED, WHICH IS
// ADR-225's separation. `zod` is a dependency of no `package.json` in this
// workspace and no file under `apps/**` or `packages/**` imports it, so the
// quoted sentence names the MECHANISM `M03:52` assumed rather than the property
// it enforces. The property is structural, it is held by the paragraph below,
// and a parser would not have made it stronger: what defends the price is that
// `CheckoutRequest` has no member to carry one.
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
// THIS PARAGRAPH SAID `apps/api` DECLARES NO `@merit/db` AND THAT HAS BEEN
// FALSE SINCE ADR-120 (ADR-238 finding 4). The manifest carries the dependency,
// `src/db.ts` imports `scopedDb`, `firmDb` and four more, and the sentence
// survived here because nothing checks a manifest claim written in prose. What
// is TRUE, and is what the paragraph was for, is that THIS FILE imports no
// accessor: checkout reaches its rows through `CheckoutTx`, exactly as
// `routes/webhooks-psp.ts` reaches its rows through `PspWebhookTx` and
// `routes/auth.ts` reaches its rows through `AuthBackend`. The port is the
// fence, and after ADR-120 the manifest is not one.
//
// THE WALL THIS PARAGRAPH NAMED HAS COME DOWN, AND WHAT IT WAS HIDING IS WORTH
// MORE THAN THE WALL WAS. It read that a wiring session "MEETS A WALL THAT IS
// STILL STANDING": `attributions` is scope class `pair` (ADR-106), a `pair` key
// is in NEITHER the scoped key set NOR the firm one, so the only remaining door
// was `systemDb(reason)` and a checkout request handler is neither of its two
// words. Session 216 reported it, session 215 attached `attributions` to it, and
// ADR-112 said in its own section 10 that giving the accessor an ADDRESS did not
// move the AUTHORITY.
//
// ADR-230 MOVED THE AUTHORITY, AND ONLY FOR THE WRITE. `ScopedTx.insertAsParty`
// inserts one row of a `pair` table whose registry rule declares
// `writer.by === 'party'`, stamping the handle's own identity into the column
// that rule names; `attributions`' writer is the BUYER, which is the identity a
// checkout transaction is already bound to. Reading a `pair` row is refused
// exactly as it was: `scopePredicate` still throws on every key in the class.
//
// SO THE PARAGRAPH IS REPLACED RATHER THAN DELETED, because the obstructions it
// was standing in front of are the ones a wiring session actually meets.
//
// THE FIRST ONE THIS LIST CARRIED IS DISCHARGED AND IS DELETED RATHER THAN KEPT
// BESIDE A DOOR THAT LANDED. It read that FIVE methods below reach `firm` tables
// -- `publishedPlanVersion`, `planVersionSize`, `couponByCode`, `geoDecision`
// and `midCandidates` -- and that `ScopedTableKey` excludes every `firm` key, so
// no `ScopedTx` reads one. ADR-233 built `catalogRows`, `catalogRowsWhere` and
// `catalogRowAt` over `CATALOG_TABLE_KEYS`, whose five members are exactly the
// five tables those five methods read.
//
// THE ONE UNDERNEATH IT WAS NEVER IN THIS LIST, AND IT IS THE FIRST LINE OF BOTH
// HANDLERS, which is the second time this file has named its second-cheapest
// blocker and missed its cheapest (ADR-238 ruling 1). TWO REMAIN, AND THE
// SECOND OF THE THREE IS DISCHARGED BY ADR-262:
//
//   1. A CAP WITH NO SOURCE. `accountCap()` runs before anything else on the
//      purchase path and on the reset path alike, and its `maxAccounts` has no
//      column in any migration: the one line a search for the name reaches is
//      `identities.max_accounts_override`, the per-entity EXCEPTION.
//      `databaseAuthBackend` refuses `readMe` for the identical finding about
//      the same number on `GET /me`. ADR-238 ruling 1 rules the BASE cap the
//      firm's number rather than a plan's, and rules that it is not read from
//      `plan_versions.rules` in any of the three forms available. ADR-252 built
//      the home and wired nothing to it, so what remains is a DOOR.
//
//   2. THE LEDGER ARM, UNCHANGED. See `ledger` below, and ADR-238 ruling 3 for
//      why ADR-176's remedy for `LT-01` does not transfer to `LT-08`.
//
// AND THE ONE THAT WAS SECOND IS GONE RATHER THAN NARROWED (ADR-262). It read
// that `clickByToken` and `couponByCode` both reach `affiliates.identity_id`, a
// row `owned` by the AFFILIATE, so a buyer-scoped read of either returns nothing
// silently and `resolveAttribution` folds an organic sale over every referral.
// THE REMEDY ADR-238 RULING 2 NAMED IS BUILT AND IT IS NOT A READ GRANT: an
// `AffiliateRef` carries `isBuyer` instead of `identityId`, `ScopedTx` gained
// `attributionAffiliate` and `attributionClick`, which resolve the affiliate
// inside the transaction and project the answer to a bit, and
// `insertAsParty` STAMPS `attributions.affiliate_identity_id` by following
// `affiliate_id` through the registry. So this file never holds the uuid, and
// the property is structural rather than careful: there is no field on either
// shape to put one in. THIS DID NOT WIRE THE PORT, and clauses 1 and 2 above are
// why.
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
//
// -----------------------------------------------------------------------------
// ENRICHMENT IS CALLED HERE AND DECIDES NOTHING, WHICH IS A PROPERTY OF THIS
// FILE AND NOT OF THE PACKAGE
// -----------------------------------------------------------------------------
// `packages/enrichment` was shipped complete, tested and UNWIRED by session 223,
// deliberately: this file did not exist when that branch was cut and inventing
// it would have cost both branches. ADR-115 records the shape and this session
// is the call.
//
// ADR-023 STEP 1 IS OBSERVE MODE AND NO ENRICHMENT OUTCOME MAY CHANGE WHAT
// CHECKOUT RETURNS. ADR-115's title names the two places that could quietly stop
// being true, and BOTH OF THEM ARE HERE: a package that decides nothing becomes
// enforcement at the site that calls it, either by branching on something it
// returned or by letting something it threw reach this transaction, where a
// throw is a `ROLLBACK` and a rollback the buyer is not told about is a silent
// decline. The call site's own comment states both and names the assertions;
// what matters at this altitude is that **a vendor timeout must not roll back a
// purchase**, and it does not.
//
// -----------------------------------------------------------------------------
// THE WALLET LEG (SD-M3-06, P5-i), AND THE ORDERING RULE THAT IS THE WHOLE OF IT
// -----------------------------------------------------------------------------
// `payment_method = 'wallet'` posts `LT-08` in this transaction. M20 section 3.7
// is the ordering rule and it is the thing most likely to be got wrong:
//
//   "The refusal is placed BEFORE the payment-method branch ... every hard limit
//    is asserted against all three payment methods, because a case asserted
//    against one passes while another refuses for an unrelated reason. ONE
//    AUTHORIZATION DECISION BEFORE THE BRANCH REFUSES ALL THREE, and the
//    assertion should be run against all three."
//
// `gateIdentity` is that decision, it is already the first thing inside both
// transactions, and the branch is added strictly below it. A refusal written
// inside the wallet arm passes a careless test and is wrong for the other two,
// which is M03 section 3.5.1 measured rather than feared.
//
// `INV-M20-06` is a DIFFERENT refusal and belongs INSIDE the arm, because the
// two "fire at different moments against different subjects": the impersonation
// refusal at authorization against the SESSION, `INV-M20-06` inside the spend
// transaction against the IDENTITY. `gateWalletSpend` is the second and there is
// no first; see below.
//
// -----------------------------------------------------------------------------
// FIVE THINGS THIS FILE CANNOT DO, REPORTED RATHER THAN REACHED AROUND
// -----------------------------------------------------------------------------
//   1. `purchases.psp` AND `purchases.psp_reference` ARE BOTH `NOT NULL`, so a
//      wallet row is unwritable without naming a processor that was never
//      called. `PurchaseInsert` types both `| null` and the wallet path writes
//      null. A superseding migration is owed; see that interface.
//
//   2. `wallet_entries.provenance` HAS NO MEMBER THAT DESCRIBES A DEBIT, which
//      is ADR-158 finding 3 and is already recorded there as unrepaired.
//      `WalletDebitInsert` declares no such field.
//
//   3. `payment_method` IS NOT ON API_CONTRACT SECTION 5's `CheckoutRequest`,
//      and `CheckoutResponse` requires a `psp` and a `payment_session` that a
//      wallet purchase does not have. M03 section 4 says this endpoint "Accepts
//      `payment_method` of `psp`, `wallet`, or `mixed`"; ADR-158 took eight
//      contract rows and none of them is this one. The contract is `approved`
//      and outside `P5-i`'s fence, so the code is written as a STRICT SUPERSET
//      NO CONTRACT-CONFORMANT REQUEST CAN REACH: the field is optional and
//      defaults to `'psp'`, so a five-member body behaves and answers exactly as
//      it does today, and the wallet response is reachable only through a field
//      the contract does not declare.
//
//   4. THE IMPERSONATION REFUSAL (`INV-M20-16`, `M6-N-02`) CANNOT BE
//      IMPLEMENTED. `AuthSession` has six fields and none of them is a session
//      type, so there is nothing to refuse on. That is `routes/payouts.ts`'s
//      finding about `INV-M5-23` arriving on a second money route, and M05
//      section 3.6's corollary applies here too: a refusal nothing asserts
//      disappears silently.
//
//   5. `payment_method = 'mixed'` NEEDS A RULING AND IS REFUSED RATHER THAN
//      HALF-BUILT. See `refuseMixed` for the three-line argument.
//
// NOTHING HERE WIDENS THE ACCESSOR. No `SqlExecutorReason` member, no
// `SystemReason` member, no `pg` import, no cast past a key type, and no
// advisory lock: ADR-157 clause 4 rules `INV-M20-01`'s lock a ROW lock taken
// through the handle, and P5 section 11 rule 10 forecloses the alternative by
// name.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { resolveAttribution } from '@merit/affiliate';
import type { AffiliateRef, AttributionRow, ClickRef, LinkConfidence } from '@merit/affiliate';
import { observeEnrichment } from '@merit/enrichment';
import type {
  ContractSource,
  EnrichmentAdapter,
  EnrichmentTx,
  ObserveReporter,
} from '@merit/enrichment';
import {
  firmAccount,
  identityAccount,
  posting,
  postTransaction,
  readChart,
  transfer,
  type LedgerTx,
  type Posting,
} from '@merit/ledger';
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

/**
 * `purchases.payment_method`'s CHECK list, `0006_commerce.sql:158`.
 *
 * `SD-M3-06`, ADR-019. THE METHOD IS THE BUYER'S CHOICE AND THE LEG IS NOT:
 * M03 section 4 says this endpoint *"Accepts `payment_method` of `psp`,
 * `wallet`, or `mixed`"* and, in the same sentence, that *"the wallet leg is
 * server-computed from the identity's balance and is never supplied by the
 * client, for the same reason no price is"*. Those are two different facts
 * about two different fields: `payment_method` selects WHICH FUNDING SOURCE,
 * and `wallet_debit_cents` is computed here from the identity's position and
 * never read off a body. `CheckoutRequest` therefore carries the first and no
 * shape in this file carries the second.
 */
export const PAYMENT_METHODS = ['psp', 'wallet', 'mixed'] as const;

/** One of {@link PAYMENT_METHODS}. */
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The method an omitted field means, which is `0006`'s own column default.
 *
 * IT IS WHAT MAKES THIS SLICE A STRICT SUPERSET OF THE CONTRACT. API_CONTRACT
 * section 5's `CheckoutRequest` has FIVE members and no `payment_method`, so a
 * contract-conformant body cannot reach the wallet arm at all and receives
 * today's behaviour and today's response shape byte for byte. See this file's
 * header: the contract owes the row and this session does not write it.
 */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'psp';

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
  /**
   * WHICH FUNDING SOURCE, and never how much of it. Optional, `'psp'` when
   * absent, so every contract-conformant body means exactly what it means today.
   */
  readonly payment_method?: PaymentMethod;
}

/**
 * `ResetRequest`. The plan version comes from the account, so it is not here.
 *
 * IT CARRIES `payment_method` FOR THE SAME REASON `POST /checkout` DOES.
 * M03 section 3.5's *"What it covers"* row is *"`POST /checkout` and
 * `POST /accounts/:id/reset`, all three `payment_method` values"*, so a reset
 * bought out of the wallet is the same product as a new purchase bought out of
 * it and the two paths differ in nothing this field touches.
 */
export interface ResetRequest {
  readonly coupon_code?: string;
  readonly accept_tos_version_ids: readonly string[];
  readonly payment_method?: PaymentMethod;
}

/** What both response shapes carry. Section 1's API3 allowlist, the common half. */
export interface CheckoutResponseBase {
  readonly purchase_id: string;
  /** Resolved now and pinned. B4 #12, INV-M3-01. */
  readonly plan_version_id: string;
  readonly amount_cents: number;
  readonly discount_cents: number;
}

/**
 * `CheckoutResponse` as API_CONTRACT section 5 declares it, field for field.
 *
 * UNCHANGED, AND IT IS WHAT EVERY CONTRACT-CONFORMANT REQUEST STILL RECEIVES.
 * `psp` and `payment_session` are the CARD LEG's artifacts and they are required
 * here because the contract requires them.
 */
export interface CardCheckoutResponse extends CheckoutResponseBase {
  readonly psp: PspId;
  readonly payment_session: {
    readonly provider_session_id: string;
    readonly redirect_url: string;
    readonly expires_at: string;
  };
}

/**
 * What a wallet-funded purchase answers, WHICH THE CONTRACT DOES NOT YET
 * DECLARE, and the omission of two fields is the point rather than an oversight.
 *
 * `INV-M3-13`: a wallet purchase *"debits the wallet IN THE SAME TRANSACTION
 * that creates the purchase"*, which *"makes the entire PSP webhook machinery
 * INAPPLICABLE to this path rather than merely unused"*. There is no third
 * party, no session and no asynchronous confirmation (M03 section 3.4), so
 * there is no `provider_session_id` to return and no `psp` that was chosen.
 * `cardLegOf` says the same thing from the other side by REFUSING a wallet row
 * with `wallet_funded_purchase_has_no_card_leg` rather than returning zero: *"a
 * zero-amount session at a processor is the shape that path must not be able to
 * reach, so it is an error and not a value"*. A response carrying an invented
 * `psp` and an invented `payment_session` would be that same shape one layer up.
 *
 * SECTION 5 OF API_CONTRACT DECLARES BOTH FIELDS REQUIRED AND IS `approved`, so
 * this shape is owed a contract row and this session does not write one. It is
 * reachable ONLY through `payment_method`, which the contract also does not
 * declare, so no client following the contract can receive it.
 */
export interface WalletCheckoutResponse extends CheckoutResponseBase {
  readonly payment_method: 'wallet';
  /**
   * `purchases.wallet_debit_cents`. Equal to `amount_cents` on this path by
   * `purchases_wallet_leg_matches_method`, and returned anyway rather than left
   * to a client to infer, because the day `mixed` is ruled the two differ.
   */
  readonly wallet_debit_cents: number;
}

/** Section 5's response, discriminated by which funding source paid. */
export type CheckoutResponse = CardCheckoutResponse | WalletCheckoutResponse;

/** `ResetResponse = CheckoutResponse & { parent_account_id }`. */
export type ResetResponse = CheckoutResponse & { readonly parent_account_id: string };

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
  /**
   * The affiliate `coupons.affiliate_id` names, or `null`.
   *
   * AN `AffiliateRef` IS AN ID AND A BIT AND NOT AN IDENTITY (ADR-262).
   * `coupons` is a `firm` catalogue row and `affiliate_id` comes back with it,
   * so an implementation already holds that value; `ScopedTx.attributionAffiliate`
   * turns it into this shape without the uuid crossing into this file.
   */
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
  /** Live accounts this IDENTITY holds. Every plan, not the one being bought. */
  readonly liveAccounts: number;
  /**
   * The identity's cap. THE BASE NOW HAS A ROW AND THIS TRANSACTION STILL
   * CANNOT REACH IT.
   *
   * THIS DOCBLOCK SAID `max_accounts_override` FOLDED OVER "THE PLAN DEFAULT"
   * AND ADR-238 RULING 1 RULED THAT SOURCE WRONG RATHER THAN MISSING. The
   * override half is real and is `identities.max_accounts_override`, the one
   * line in the migration set that names a per-entity cap. The base half was
   * `limits.max_accounts_per_entity` in the `plan_versions.rules` jsonb, a
   * PER-PLAN-VERSION number, while `liveAccounts` beside it is this identity's
   * total across every plan; comparing the two makes an identity's effective
   * cap the MAXIMUM over every published version, and on the reset path the
   * version read is the one an account was PINNED to, which may have been
   * retired years earlier.
   *
   * ADR-252 BUILT THE HOME THAT RULING NAMED AND WIRED NOTHING TO IT.
   * `firm_parameters` (`0074`) holds `base_account_cap` on `price_floors`'
   * shape, effective dated, superseded rather than updated, its approver a
   * foreign key into `operators`. It is registered `firm` in
   * `packages/db/src/scope.ts`, so `ApiDb.firm` reaches it and `FirmTx.rowsWhere`
   * types against it. WHAT REMAINS IS A DOOR AND NOT A COLUMN, and it is
   * narrower than what stood here: `accountCap()` is a method of `CheckoutTx`,
   * which is a SCOPED transaction, and a scoped transaction refuses every firm
   * key that is not in `CATALOG_TABLE_KEYS`. That list is five members and this
   * key is deliberately not one of them.
   *
   * THE READ CANNOT SIMPLY MOVE OUTSIDE THE TRANSACTION, which is the shortcut
   * to check before reaching for `db.firm` beside it. `INV-M3-15` requires the
   * restriction check at the same point in the transaction as the cap and
   * `gateIdentity` performs both in one call, so a cap read before the
   * transaction opens is a cap that may have been superseded by the time the
   * purchase commits. `refuseUncatalogued` in `packages/db/src/scoped-db.ts`
   * states the admission argument in its own message and this table satisfies
   * it: a request handler holding an identity must read the row INSIDE its own
   * transaction. Making that argument is a diff on `packages/db` with an ADR,
   * and ADR-252 did not make it.
   *
   * AND THE TABLE SHIPS EMPTY, WHICH IS THE HALF NO DOOR FIXES. Nothing in this
   * repository writes a `firm_parameters` row, so an implementation with the
   * door in hand reads NOTHING. AN ABSENT ROW IS NO CAP AND IT IS NOT AN
   * UNLIMITED ONE: folding an absent row into `Infinity`, or skipping the
   * comparison when the read returns nothing, is a control that answers yes to
   * everybody on the endpoint that sells accounts. Whichever slice writes this
   * read owes a REFUSAL there, on `IdentityStatus`' precedent elsewhere in this
   * file, and it owes it before it owes anything else.
   */
  readonly maxAccounts: number;
  /** `identities.status`. INV-M3-15 refuses `restricted`. */
  readonly identityStatus: IdentityStatus;
  /** Whether this identity has ever completed a purchase. SD-M3-04. */
  readonly hasPriorPurchase: boolean;
}

/**
 * `kyc_verifications.state`, the `kyc_status` enum's five members.
 *
 * `0001_extensions_and_enums.sql`. `INV-M20-06` names *"KYC not `verified`"*,
 * so the whole enum is carried and the gate compares against the one member
 * rather than enumerating the four it refuses: that is `ADR-075`'s form for
 * `identities.status`, where *"the ruled predicate is `= 'active'` and not an
 * enumeration of what is refused"*, and a sixth member added by a migration
 * would otherwise pass a gate written the other way round.
 */
export type KycState = 'kyc_required' | 'pending' | 'verified' | 'rejected' | 'expired';

/**
 * `INV-M20-06`'s ENUMERATED gate set, read as one row because it is checked as
 * one decision.
 *
 * THE SET IS ENUMERATED RATHER THAN DESCRIBED AND THAT IS THE INVARIANT'S OWN
 * WORD: *"every context gate that blocks the external leg blocks wallet spend
 * too, and the set is enumerated rather than described: `payouts_frozen` on the
 * account or the identity, `recon_blocked`, KYC not `verified`, and
 * `identities.status = 'active'`"*. A freeze that stops the cash door and leaves
 * the product door open is not a freeze.
 *
 * EVERY MEMBER IS A FACT ABOUT THE IDENTITY AND NONE IS A FACT ABOUT THE
 * SESSION, which is `INV-M20-16` and is why the impersonation refusal is not in
 * here. M20 section 3.7: a session-type term *"would make a per-identity gate
 * set answer differently depending on who is looking"*. See this file's header
 * for why that refusal is reported rather than implemented.
 *
 * `identityStatus` IS A MEMBER EVEN THOUGH `gateIdentity` HAS ALREADY REFUSED
 * IT. `GS-302`'s own note is that both controls refuse a restricted identity's
 * wallet spend and the scenario cannot discriminate which one did it; dropping
 * the member here because another control happens to cover it is how a set
 * silently loses a member the day that control moves.
 */
export interface WalletSpendGates {
  /** `identities.status`. ADR-075: the predicate is `= 'active'`. */
  readonly identityStatus: IdentityStatus;
  /** `identities.payouts_frozen`. */
  readonly identityPayoutsFrozen: boolean;
  /**
   * `accounts.payouts_frozen`, over THIS IDENTITY'S accounts.
   *
   * TRUE IF ANY OF THEM CARRIES IT, because `INV-M20-06` says *"`payouts_frozen`
   * on the account OR the identity"* and a wallet balance is per identity rather
   * than per account: there is no one account a wallet spend is "on", and a
   * frozen account beside an unfrozen one would otherwise leave the product
   * door open to exactly the value the freeze was about (`FM-M20-03`).
   */
  readonly accountPayoutsFrozen: boolean;
  /** `accounts.recon_blocked`, over this identity's accounts, on the same reading. */
  readonly accountReconBlocked: boolean;
  /** `kyc_verifications.state`, or `'kyc_required'` when this identity has no row. */
  readonly kycState: KycState;
}

/**
 * One `wallet_spend_limits` row: the CURRENT limit, which is the greatest
 * `effective_from` that has ARRIVED.
 *
 * `SD-M20-02`, `INV-M20-07`, SECURITY `C-23`. The grain is
 * `(identity_id, effective_from)` and supersession is a NEW ROW, so a scoped
 * read returns the whole history and the current one is the latest that is not
 * in the future. `null` from the port means NO ROW, which API_CONTRACT states is
 * what unlimited looks like: *"there is no value that means unlimited: the
 * absence of any row for an identity is what unlimited looks like"*.
 */
export interface WalletSpendLimitRow {
  /** `daily_cents`. `0` is writable and means no wallet spend at all. */
  readonly dailyCents: bigint;
  /** `rolling_7d_cents`. `wallet_spend_limits_weekly_exceeds_daily` keeps it >= `dailyCents`. */
  readonly rolling7dCents: bigint;
  readonly effectiveFrom: Date;
}

/** One `wallet_entries` DEBIT inside a velocity window. Two columns and no more. */
export interface WalletDebitHistoryRow {
  /** `amount_cents`. A MAGNITUDE, `CHECK (amount_cents > 0)`; `direction` carries the sign. */
  readonly amountCents: bigint;
  readonly occurredAt: Date;
}

/**
 * The `wallet_entries` DEBIT one wallet-funded purchase writes.
 *
 * IT DECLARES NO `provenance` FIELD AND THE OMISSION IS THE SCHEMA REPORTED
 * HONESTLY RATHER THAN A FIELD FORGOTTEN. ADR-158 finding 3: the column is
 * `NOT NULL` on a table that stores debits and its three members are the CREDIT
 * list by the DDL's own heading, so *"neither `payout`, `refund_wallet_funded`
 * nor `correction` describes the `LT-06` debit that funds a withdrawal or the
 * `LT-08` debit that funds a purchase"*, and *"every wallet debit in this schema
 * is written carrying a class that does not describe it"*. That entry left the
 * schema half as a finding because the repair is a superseding migration and
 * P5 section 7 forbids this slice a number; this shape declines to be the code
 * that writes the mislabel it named. **What a debit means is `cause` and
 * `reference_id`**, and `reference_id`'s own declaration in `0011` enumerates
 * `purchase` among its referents.
 */
export interface WalletDebitInsert {
  /** A MAGNITUDE, always > 0, matching `CHECK (amount_cents > 0)`. */
  readonly amountCents: bigint;
  /** `cause`, "the business event, human readable" (`0011`). */
  readonly cause: string;
  /** `reference_id`. THE PURCHASE, which is one of the column's declared referents. */
  readonly referenceId: string;
  /** `ledger_transaction_id`. `NOT NULL`: a wallet entry with no posting is money outside the ledger. */
  readonly ledgerTransactionId: string;
  /**
   * `balance_after_cents`, `CHECK (balance_after_cents >= 0)`.
   *
   * Computed here as the position read UNDER `lockScope()` minus this debit, so
   * `INV-M20-01`'s *"never negative"* is a property of the arithmetic that
   * produced the row rather than a constraint the database is left to discover.
   */
  readonly balanceAfterCents: bigint;
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
  /**
   * `purchases.psp`, or `null` ON THE WALLET PATH, AND THE COLUMN IS `NOT NULL`.
   *
   * THIS IS A REPORTED SCHEMA DEFECT AND NOT A LOOSENED TYPE. `0006_commerce.sql`
   * declares `psp text NOT NULL CHECK (psp IN ('psp_a','psp_b'))` and
   * `psp_reference text NOT NULL`. `SD-M3-06` added `payment_method`,
   * `wallet_debit_cents` and `wallet_ledger_transaction_id` to this same table
   * and RELAXED NEITHER, and the only two `ALTER TABLE purchases` in the tree
   * (`0007`, `0011`) add foreign keys. So a `payment_method = 'wallet'` row is
   * UNWRITABLE without naming a processor that was never called and a reference
   * that references nothing.
   *
   * The alternative is to write `'psp_a'` and a minted string onto a row that
   * reached no processor, which is the state `FM-M3-01` pages on wearing a
   * wallet purchase's clothes and is exactly what `SD-M3-06` exists to make
   * unrepresentable: *"without an explicit method the wallet path is
   * indistinguishable from a PSP purchase whose webhook never arrived"*.
   *
   * So the type carries the truth and the write fails closed. The repair is a
   * superseding migration relaxing both columns under a CHECK tied to
   * `payment_method`, and P5 section 7 forbids this slice a migration number.
   * This is ADR-158 clause 2's move on a second table.
   */
  readonly psp: PspId | null;
  /** `purchases.psp_reference`, `NOT NULL`. Null on the wallet path; see `psp`. */
  readonly pspReference: string | null;
  readonly ip: string | null;
  /** SD-M3-05. Recorded at checkout, never reconstructed. */
  readonly checkoutIpCountry: string | null;
  /** SD-M3-05. */
  readonly geoDecision: 'allowed' | 'warned' | 'blocked';
  /** SD-M3-06. `purchases.payment_method`, written rather than defaulted. */
  readonly paymentMethod: PaymentMethod;
  /**
   * SD-M3-06. `purchases.wallet_debit_cents`, SERVER-COMPUTED and never a body
   * field, for the same reason no price is.
   *
   * `purchases_wallet_leg_matches_method` is the shape this obeys: `0` under
   * `'psp'`, and equal to `amount_paid_cents` (which is > 0) under `'wallet'`.
   */
  readonly walletDebitCents: bigint;
  /**
   * SD-M3-06. `purchases.wallet_ledger_transaction_id`, and `LT-08`'s id on the
   * wallet path.
   *
   * `purchases_wallet_debit_is_posted` CHECKs
   * `wallet_debit_cents = 0 OR wallet_ledger_transaction_id IS NOT NULL`,
   * because *"a wallet debit that posted no ledger transaction is money that
   * moved outside the ledger"*.
   */
  readonly walletLedgerTransactionId: string | null;
  /**
   * `purchases.status`, written rather than left to `DEFAULT 'pending'`.
   *
   * `INV-M3-13`. A wallet purchase is `'paid'` in the transaction that creates
   * it: *"no `provisioning_pending` limbo caused by payment uncertainty can
   * exist on this path, because the payment either committed or it did not"*.
   * A card purchase stays `'pending'` until its webhook, which is what this
   * handler wrote by omission before the column was named here.
   */
  readonly status: 'pending' | 'paid';
  /** `purchases.paid_at`. `purchases_paid_has_timestamp` requires it exactly when `status` is `'paid'`. */
  readonly paidAt: Date | null;
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

  /**
   * The click this token names, or `null`. `affiliate_clicks_token_uq`.
   *
   * REFUSED TWICE AND BUILT ON THE THIRD ASKING, AS SOMETHING OTHER THAN A READ
   * GRANT (ADR-262). What ADR-233 section 5 and ADR-238 ruling 2 refused was a
   * buyer reaching `affiliates.identity_id`, a row `owned` by the affiliate: a
   * buyer-scoped read of it returns the empty set silently and folds every
   * referral as organic, which is a wrong answer that returns rows, and an
   * unscoped one hands a stranger's uuid to a caller who proved a different
   * identity.
   *
   * NEITHER HAPPENS NOW, BECAUSE THE `ClickRef` CARRIES NO IDENTITY. Its
   * `AffiliateRef` is `affiliates.id` and one boolean. An implementation is
   * `ScopedTx.attributionClick`, which resolves the affiliate INSIDE this
   * transaction and projects the answer to three fields; the uuid is compared
   * against the handle and discarded in the same expression, and there is no
   * field on this shape to put one in. `attributions.affiliate_identity_id` is
   * stamped by the accessor for the same reason `buyer_identity_id` is.
   *
   * WHAT THE THREE PROJECTED FIELDS ARE IS WORTH STATING, because the row does
   * belong to the affiliate: `clickId` is a surrogate `bigint`, `clickedAt` is
   * when THIS BUYER followed the link, and `isBuyer` is the self-deal bit, which
   * discloses nothing either way. `ip`, `user_agent`, `click_fingerprint`,
   * `referrer_host` and `suspicious_reason` -- the five the registry's own rule
   * calls the trap -- are not projected.
   */
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

  // ---------------------------------------------------------------------------
  // The wallet leg. SD-M3-06, and every method below runs on the SAME
  // transaction as the purchase, which is INV-M3-13 stated as a type.
  // ---------------------------------------------------------------------------

  /** `INV-M20-06`'s enumerated set, read as one row because it is one decision. */
  walletSpendGates(): Promise<WalletSpendGates>;

  /**
   * `INV-M20-02`. Does THIS identity hold this account, asked INSIDE the debit
   * transaction?
   *
   * IT IS A SECOND CHECK OF A FACT `resetTarget` ALREADY ESTABLISHED AND THAT IS
   * THE POINT. `resetTarget` is a scoped read, so an account this identity does
   * not hold already comes back `null` and answers 404; this asks the same
   * question again at the moment the money moves, because `INV-M20-02` is not a
   * routing rule, it is *"wallet value may be spent ONLY on products for the
   * spending identity's own accounts"*, and `AS-M20-06`'s whole scenario is that
   * *"a wallet that can fund another identity's purchase is a transfer
   * instrument with a checkout in front of it, which `INV-M5-14` forbids"*.
   * `FM-M20-07`'s detection column names this check by name.
   *
   * THE ARGUMENT IS THE ONE THIS FILE ALREADY MAKES ABOUT THE PRICE. A control
   * that holds only because an earlier read happened to be scoped is a control
   * that disappears the day somebody widens that read, with nothing turning red.
   * `DEP-M20-02` asks `M3` for exactly this: *"M3 resolves target-account
   * ownership server side and posts `LT-08` in the purchase transaction"*, and
   * its consequence column is *"`INV-M20-02` fails, and the wallet becomes a
   * transfer instrument"*.
   *
   * THE ACCOUNT ID IS THE ONE THE SCOPED READ RETURNED AND NEVER THE PATH
   * PARAMETER. `completePurchase` is handed `ResolvedPurchase`, whose
   * `parentAccountId` is `ResetTargetRow.accountId`; the request's own
   * `accountId` never reaches this arm at all.
   */
  ownsAccount(accountId: string): Promise<boolean>;

  /**
   * Lock THIS HANDLE'S OWN `identities` row until this transaction ends.
   *
   * ADR-157 clause 4 AND ITS ARGUMENT VERBATIM, because a later reader will be
   * tempted by the invariant's own prose instead: `INV-M20-01` and `FM-M20-01`
   * both say *"per-identity advisory lock"*, and the accessor's answer is a ROW
   * lock rather than an advisory one. *"The difference from an advisory lock is
   * which door it goes through: `pg_advisory_xact_lock` can only be sent through
   * `sqlExecutor`, which is the reach-around P5 section 11 rule 10 and P7
   * section 11 rule 10 each foreclose by name. A row lock says the same thing
   * and says it with the tenancy conjunct attached."*
   *
   * IT TAKES NO ARGUMENT, AND THAT IS THE WHOLE OF ITS SAFETY: `lockScope()`
   * locks the identity the handle is already bound to, so *"there is no address
   * here to point at somebody else"*. An implementation is `ScopedTx.lockScope`
   * and nothing else; an advisory lock through `sqlExecutor` is refused by name
   * in ADR-157 and in P5 rule 10 and is not reachable from this file.
   */
  lockScope(): Promise<void>;

  /**
   * This identity's wallet position, in `bigint` cents.
   *
   * READ IT UNDER {@link lockScope} AND NOT BEFORE. `INV-M20-01`: the balance is
   * *"never negative, and every debit is checked against the live position
   * inside the same transaction"*, and a position read before the lock is a
   * position another transaction may have spent by the time the debit lands.
   * `FM-M20-01` is exactly that race and it is *"structurally prevented, and
   * asserted by a concurrency test rather than assumed"*.
   *
   * THE BALANCE IS THE LAST ROW APPENDED'S STORED RUNNING BALANCE AND NOT A SUM,
   * AND AN IDENTITY WITH NO ROW IS `0` RATHER THAN ABSENT. That is
   * `routes/wallet.ts`'s `balanceOf` and this file does NOT derive a second
   * shape for it: `wallet_entries.balance_after_cents` is stored precisely *"so
   * a statement renders without a window function over an append-only table,
   * and so a divergence between the stored balance and the recomputed one is a
   * detectable tamper indication"* (`0011`), and two code paths disagreeing
   * about which is authoritative is that indicator read two ways. An
   * implementation returns the `balance_after_cents` of this identity's greatest
   * `wallet_entries.id`, or `0n`.
   */
  walletBalanceCents(): Promise<bigint>;

  /**
   * The CURRENT `wallet_spend_limits` row, or `null` when this identity has none.
   *
   * `null` IS UNLIMITED AND IS NOT AN ERROR, on API_CONTRACT's own sentence
   * about this table. The current row is the greatest `effective_from` that is
   * not after `at`: supersession is a new row rather than an update, so a limit
   * dated in the future has not arrived and does not bind yet.
   */
  walletSpendLimit(at: Date): Promise<WalletSpendLimitRow | null>;

  /**
   * This identity's `wallet_entries` DEBITS with `occurred_at` at or after
   * `since`, which is the velocity window's input.
   *
   * DEBITS ONLY. A credit that arrived inside the window did not spend anything,
   * and folding one in would let a payout settling on Tuesday buy back the
   * headroom a compromised session used on Monday, which is `C-23`'s scenario
   * with the limit removed.
   */
  walletDebitsSince(since: Date): Promise<readonly WalletDebitHistoryRow[]>;

  /**
   * INSERT the `wallet_entries` debit row this purchase caused.
   *
   * SEPARATE FROM THE POSTING AND NOT DERIVED FROM IT, because they answer
   * different questions: `0011`'s header says *"the ledger knows an amount moved
   * into `trader_wallet`, and only this table knows it arrived as a payout
   * rather than as a refund"*. The ledger is the money and this is the wallet's
   * own statement.
   */
  insertWalletDebit(row: WalletDebitInsert): Promise<void>;

  /**
   * THIS transaction, as `packages/ledger` posts through one, or `null` when
   * this deployment cannot post.
   *
   * SUPPLIED BY THE WIRING AND NOT OPENED HERE, on `routes/payouts.ts`'s
   * precedent for `LT-01` and for its reason. `postTransaction` takes a
   * `LedgerTx`, which only ADR-102's `SystemTx` satisfies, and `SystemReason` is
   * `'nightly-batch' | 'operator-console'`. `packages/ledger/src/tx.ts`'s own
   * header states the consequence: *"A CHECKOUT POSTING FROM `apps/api` IS
   * NEITHER OF THOSE WORDS ... On the WRITE side the gap is open."*
   *
   * `null` RATHER THAN A NON-NULL FIELD EVERY FAKE MUST FILL, because only the
   * wallet arm posts: a card checkout writes no ledger row, so a required handle
   * would be a dependency the psp path does not have. That is this same
   * interface's `enrichment` property one method down, for the same reason.
   * The wallet arm answers 503 when it is `null`, and NOTHING HERE WIDENS
   * `SystemReason`.
   *
   * AND ADR-176's REMEDY FOR THE SAME OBSTRUCTION DOES NOT TRANSFER HERE, which
   * ADR-238 ruling 3 re-derived rather than assumed. That entry cleared
   * `PayoutTx.ledger` by DELETING it: the `LT-01` posting moved out of the
   * request path to a system authority and the handler stored the client's key
   * for the door that posts it. `LT-08` cannot follow, because M20 pins it to
   * the purchase transaction by name and `DEP-M20-02` states the consequence of
   * moving it, which is that the wallet becomes a transfer instrument. So the
   * arm waits on a ruling in `packages/ledger` and `packages/db` rather than on
   * a wiring here.
   */
  readonly ledger: LedgerTx | null;

  /**
   * INSERT the attribution. INV-M8-01's unique `purchase_id` is the control.
   *
   * THIS DOCBLOCK SAID `packages/db` ADMITS NO REQUEST HANDLER WRITING A `pair`
   * ROW AND ADR-230 MADE THAT FALSE. It is still a port, for the reason every
   * method here is one, which is that THIS FILE imports no accessor and not
   * that the deployable could not (ADR-238 finding 4: the manifest has carried
   * `@merit/db` since ADR-120 and this docblock said otherwise), and not for
   * want of an authority any more:
   * `ScopedTx.insertAsParty` stamps the buyer's own identity into
   * `attributions.buyer_identity_id` and refuses a caller naming it, so an
   * implementation is one call and needs no reason word.
   *
   * WHAT AN IMPLEMENTATION MUST NOT DO IS PASS `row.buyerIdentityId` THROUGH.
   * The door refuses that key in both spellings, deliberately: the handle
   * supplies the buyer and a value the fold computed is a second statement of
   * the same fact. Assert the two agree if you like, then drop it.
   *
   * AND THERE IS NO AFFILIATE IDENTITY ON THE ROW TO PASS THROUGH AT ALL
   * (ADR-262). `attributions.affiliate_identity_id` is `NOT NULL` in the DDL and
   * `AttributionRow` does not carry it: the registry records that this row's
   * counterparty is RESOLVED from `affiliate_id`, and `insertAsParty` follows
   * that edge to `affiliates` inside the same transaction and stamps what it
   * finds. So an `attributions` insert now takes NEITHER identity from the
   * caller, and the door refuses the affiliate column in both spellings too.
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

  /**
   * THIS transaction, as `packages/enrichment` writes through one, or `null`
   * when the deployment records no observation.
   *
   * IT IS A HANDLE AND NOT A QUERY, which is why it is a property beside twelve
   * methods. `observeEnrichment` takes the caller's OPEN transaction as its
   * first argument with no overload that omits it, and `packages/enrichment`
   * declares no `@merit/db` and cannot import `client()`, `drizzle-orm` or `pg`
   * at all. So an observation commits with the purchase that caused it or not at
   * all, and an observation of a checkout that DID NOT HAPPEN is unreachable
   * rather than merely avoided. `tx.ts`'s header states why that matters: a
   * distribution polluted by abandoned checkouts is not the distribution
   * ADR-023's observe mode exists to learn.
   *
   * `null` IS THE SAME ANSWER `adapterFor` GIVES FOR AN UNCONFIGURED PROVIDER
   * and it is not a second kill switch dressed as a port. ADR-115 clause 4 rules
   * that no enabled `integration_contracts` row means no call at all; a backend
   * that cannot write `identity_signals` is that condition met one step earlier,
   * and the two agree on the outcome, which is a checkout that commits exactly
   * as it would have.
   */
  readonly enrichment: EnrichmentTx | null;
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

/**
 * Everything an enrichment observation needs that is not the transaction.
 *
 * FOUR FIELDS AND NOT ONE, because `ObserveDeps` takes four things this route
 * cannot invent: a vendor, the `firm` reader that holds the contract row, a
 * clock and a sink. `timeoutMs` IS DELIBERATELY ABSENT: `ENRICHMENT_TIMEOUT_MS`
 * is exported "so the number is read in one place by whoever is answering how
 * long a purchase may wait on a fraud signal", and a route that passed its own
 * would be moving a shared budget into one caller.
 */
export interface CheckoutEnrichment {
  readonly adapter: EnrichmentAdapter;
  /** The `firm` reader for `integration_contracts`. `firmDb()` satisfies it. */
  readonly contracts: ContractSource;
  /** The clock. Injected so a suite is deterministic; `() => new Date()` in a deployment. */
  readonly now: () => Date;
  /** Where the outcome is reported. Its own throw is caught by `observeEnrichment`. */
  readonly report: ObserveReporter;
}

/** Where a provider's adapter comes from. Section 5's `psp` union is closed. */
export interface CheckoutAdapters {
  /** The adapter for this MID, or `undefined` when none is configured. */
  adapterFor(psp: PspId): PspAdapter | undefined;
  /** Where the provider returns the buyer. Configuration, never a request field. */
  readonly returnUrl: string;
  readonly cancelUrl: string;
  /**
   * ADR-023 step 1's enrichment wiring, or `null` when this deployment observes
   * nothing.
   *
   * `null` IS WHAT A LIVE DEPLOYMENT RESOLVES TODAY, for `adapterFor`'s reason
   * one line up: `packages/enrichment` ships a port and FOUR FAKES and no vendor
   * adapter, and a route that invented one would be a fixture serving real
   * traffic. There is also no `integration_contracts` row installed anywhere in
   * this tree, and ADR-115 clause 4 makes that row's absence the same answer.
   */
  readonly enrichment: CheckoutEnrichment | null;
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
  enrichment: null,
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
/**
 * `payment_method`, or `undefined` when absent, or `null` when it is a word this
 * schema has no value for.
 *
 * MEMBERSHIP IS ALL THAT IS CHECKED HERE AND THAT IS DELIBERATE. A fourth word
 * is a body that does not typecheck against `purchases.payment_method`'s CHECK
 * list, which is `validation_failed` in anybody's ordering. Whether one of the
 * THREE declared words is servable is a different question with a different
 * answer, and M20 section 3.7 says it must be asked AFTER the hard limit:
 * refusing `'mixed'` at the wire would answer 400 to a restricted identity where
 * the contract requires the identity refusal to answer first. See
 * `refusePaymentMethod`.
 */
function optionalPaymentMethod(
  row: Record<string, unknown>,
  errors: FieldError[],
): PaymentMethod | undefined | null {
  const raw = row['payment_method'];
  if (raw === undefined) return undefined;
  const found = PAYMENT_METHODS.find((member) => member === raw);
  if (found === undefined) {
    errors.push({
      path: 'payment_method',
      message: `must be one of ${PAYMENT_METHODS.join(', ')} when present`,
    });
    return null;
  }
  return found;
}

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
  const method = optionalPaymentMethod(row, errors);

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
      ...(method === undefined || method === null ? {} : { payment_method: method }),
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
  const method = optionalPaymentMethod(row, errors);
  if (errors.length > 0 || tosIds === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...(couponCode === undefined || couponCode === null ? {} : { coupon_code: couponCode }),
      accept_tos_version_ids: tosIds,
      ...(method === undefined || method === null ? {} : { payment_method: method }),
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
/** Section 2's `payouts_frozen`, 422. `INV-M20-06`'s two freeze members. */
export const PAYOUTS_FROZEN = 'payouts_frozen';
/** Section 2's `kyc_required`, 422. `INV-M20-06`'s verification member. */
export const KYC_REQUIRED = 'kyc_required';
/**
 * Section 2's `identity_restricted`, 422. `INV-M20-06`'s `identities.status` member.
 *
 * IT IS USED ON THE WALLET ARM AND NOT BY `gateIdentity`, WHICH IS A DEFECT IN
 * THIS FILE REPORTED RATHER THAN REPAIRED. See `gateIdentity`.
 */
export const IDENTITY_RESTRICTED = 'identity_restricted';
/** Section 2's `insufficient_funds`, 422. `INV-M20-01`'s refusal. */
export const INSUFFICIENT_FUNDS = 'insufficient_funds';
/** Section 2's `rate_limited`, 429. `INV-M20-07`'s DELAY, which is not a refusal. */
export const RATE_LIMITED = 'rate_limited';

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
 *
 * -----------------------------------------------------------------------------
 * THIS IS THE REFUSAL M20 SECTION 3.7 PUTS BEFORE THE PAYMENT-METHOD BRANCH, AND
 * IT ALREADY IS
 * -----------------------------------------------------------------------------
 * Both endpoint handlers call this as the FIRST thing inside the transaction,
 * above the plan lookup and above `completePurchase`, so it refuses a `psp`, a
 * `wallet` and a `mixed` request identically and for the same reason. That is
 * "the resolved-identity step where every other hard limit sits", and M03
 * section 3.5.1 is the measurement of what it costs when a hard limit lives in
 * one arm instead: before ADR-041's fold a restricted identity was refused on
 * `wallet`, COMPLETED on `psp`, and half-failed on `mixed`. The suite asserts it
 * against all three methods rather than against the one this slice added.
 *
 * -----------------------------------------------------------------------------
 * A DEFECT REPORTED AND NOT REPAIRED: THE CODE IS `forbidden` 403 AND THE
 * CONTRACT SAYS `identity_restricted` 422
 * -----------------------------------------------------------------------------
 * API_CONTRACT section 2 defines `identity_restricted` at 422 in these words:
 * "The identity is restricted. Refused SERVER SIDE at the resolved-identity
 * step, on EVERY payment method and on every surface ADR-041 enumerates", and
 * adds that it "is a distinct code and not a reuse of `payouts_frozen`" because
 * "a client that cannot tell them apart renders the wrong remedy". M03 section
 * 3.5's refusal-shape row says "422, in `geo_restricted`'s and
 * `account_cap_reached`'s shape", and `routes/payouts.ts` already answers
 * `identity_restricted` 422 on the sibling money route.
 *
 * IT IS LEFT AS IT IS BECAUSE CHANGING IT IS A WIRE-VISIBLE CHANGE TO THE CARD
 * LEG, which P5 section 6 says this slice "touches neither other branch" of, and
 * because `gateWalletSpend` below shows what the corrected shape looks like on
 * the arm this slice does own. The patch is two lines and the suite pins today's
 * behaviour with this finding named beside the assertion, so the day somebody
 * takes it the test says why it moved.
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

// -----------------------------------------------------------------------------
// THE WALLET LEG. SD-M3-06, and M20 section 3.2's order rather than one of mine
// -----------------------------------------------------------------------------

/**
 * `INV-M20-06`, applied. The whole enumerated set, in the diagram's own order.
 *
 * `null` IS THE ONLY WAY PAST, so a member added to `WalletSpendGates` and not
 * read here is a compile error at the destructure rather than a gate that
 * silently stopped covering it.
 *
 * `identities.status` IS CHECKED AGAINST `= 'active'` AND NOT AGAINST A LIST OF
 * WHAT IS REFUSED. ADR-075 moved this predicate for exactly that reason: it read
 * `= 'restricted'` until 2026-08-21, "and a `closed` identity therefore passed
 * it". An enumeration of the refused values is one migration away from admitting
 * a fourth `identity_status` member to a door that moves value.
 */
function gateWalletSpend(gates: WalletSpendGates): Refusal | null {
  const {
    identityStatus,
    identityPayoutsFrozen,
    accountPayoutsFrozen,
    accountReconBlocked,
    kycState,
  } = gates;

  if (identityStatus !== 'active') {
    return refuse(
      IDENTITY_RESTRICTED,
      'Identity restricted',
      422,
      `This identity is ${identityStatus} and cannot spend its wallet.`,
    );
  }
  if (identityPayoutsFrozen) {
    return refuse(
      PAYOUTS_FROZEN,
      'Payouts frozen',
      422,
      'This identity is under investigation and cannot spend its wallet.',
    );
  }
  if (accountPayoutsFrozen) {
    return refuse(
      PAYOUTS_FROZEN,
      'Payouts frozen',
      422,
      'An account held by this identity is under investigation.',
    );
  }
  if (accountReconBlocked) {
    return refuse(
      PAYOUTS_FROZEN,
      'Payouts frozen',
      422,
      'An account held by this identity is blocked pending reconciliation.',
    );
  }
  if (kycState !== 'verified') {
    return refuse(
      KYC_REQUIRED,
      'KYC required',
      422,
      `Verification is ${kycState} and wallet spend needs it verified.`,
    );
  }
  return null;
}

/** 24 hours, in integer milliseconds. `wallet_spend_limits.daily_cents`'s window. */
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 7 days, in integer milliseconds. `wallet_spend_limits.rolling_7d_cents`'s window. */
export const ROLLING_7D_WINDOW_MS = 7 * DAILY_WINDOW_MS;

/** Which of the two limits bound. Closed at two because the table declares two. */
export type VelocityLimitKind = 'daily' | 'rolling_7d';

/**
 * What the velocity check concluded. `'delayed'` IS NOT `'refused'`.
 *
 * `INV-M20-07` and SECURITY `C-23`: spend above the limit is **delayed rather
 * than refused**, and API_CONTRACT states the reason in the row that sets the
 * limit so that "nobody implements this write as a refusal switch": *"the blast
 * radius of a compromised session is contained and the cost of a false positive
 * is a legitimate trader unable to buy a reset at the moment they most want
 * one."* M20 section 3.2 draws it as a distinct edge, `requested --> delayed`,
 * with `delayed --> authorized: window elapses, checks re-run`.
 *
 * SO THE DIFFERENCE IS WHAT THE TRADER IS TOLD, AND `retryAt` IS THE DIFFERENCE.
 * A refusal is terminal and carries no way back; a delay names the instant the
 * window has rolled off enough spend to admit this purchase.
 */
export type VelocityOutcome =
  | { readonly kind: 'within' }
  | {
      readonly kind: 'delayed';
      readonly limitKind: VelocityLimitKind;
      /**
       * When the window admits this amount, or `null` when NO window ever does.
       *
       * `null` IS THE `daily_cents: 0` CASE AND IT IS REPORTED RATHER THAN
       * ROUNDED TO A TIMESTAMP. API_CONTRACT: *"`daily_cents: 0` is writable and
       * means no wallet spend at all"*, so no amount of window rolling admits a
       * positive spend, and the same is true of any limit below the purchase
       * price. A fabricated `Retry-After` would send the trader back to be
       * refused again forever, which is worse than saying there is no such
       * instant.
       */
      readonly retryAt: Date | null;
    };

/**
 * One window, evaluated. `null` means the spend fits.
 *
 * THE ROLL-OFF INSTANT IS COMPUTED FROM THE DEBITS RATHER THAN GUESSED. Walking
 * the window's debits oldest first and subtracting each in turn gives the first
 * moment at which `spent + amount` fits under the limit, and that moment is that
 * debit's `occurred_at` plus the window. Rounding it up to "the whole window
 * from now" would delay a trader who is one small debit away from headroom by up
 * to seven days.
 */
function windowDelay(args: {
  readonly limitCents: bigint;
  readonly windowMs: number;
  readonly amountCents: bigint;
  readonly debits: readonly WalletDebitHistoryRow[];
  readonly at: Date;
}): { readonly retryAt: Date | null } | null {
  const from = args.at.getTime() - args.windowMs;
  const inWindow = args.debits
    .filter((row) => row.occurredAt.getTime() > from)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let spent = 0n;
  for (const row of inWindow) spent += row.amountCents;
  if (spent + args.amountCents <= args.limitCents) return null;

  for (const row of inWindow) {
    spent -= row.amountCents;
    if (spent + args.amountCents <= args.limitCents) {
      return { retryAt: new Date(row.occurredAt.getTime() + args.windowMs) };
    }
  }
  // An EMPTY window still does not admit it, so the limit itself is below the
  // amount and no instant exists. `daily_cents: 0` is the deliberate case.
  return { retryAt: null };
}

/**
 * `INV-M20-07`, applied over both windows.
 *
 * NO ROW IS UNLIMITED, on API_CONTRACT's own sentence about this table: *"there
 * is no value that means unlimited: the absence of any row for an identity is
 * what unlimited looks like"*.
 *
 * BOTH WINDOWS ARE EVALUATED EVEN THOUGH `wallet_spend_limits_weekly_exceeds_daily`
 * KEEPS THE WEEKLY LIMIT ABOVE THE DAILY ONE. The weekly window is seven times
 * longer, so it holds seven times the spend; a constraint on the two CEILINGS
 * says nothing about which window fills first. When both bind, the one that
 * binds LONGEST is the one reported, because the earlier of two retry times is a
 * retry that will be refused again on arrival.
 */
export function velocityOf(args: {
  readonly amountCents: bigint;
  readonly limit: WalletSpendLimitRow | null;
  readonly debits: readonly WalletDebitHistoryRow[];
  readonly at: Date;
}): VelocityOutcome {
  const { amountCents, limit, debits, at } = args;
  if (limit === null) return { kind: 'within' };

  const daily = windowDelay({
    limitCents: limit.dailyCents,
    windowMs: DAILY_WINDOW_MS,
    amountCents,
    debits,
    at,
  });
  const weekly = windowDelay({
    limitCents: limit.rolling7dCents,
    windowMs: ROLLING_7D_WINDOW_MS,
    amountCents,
    debits,
    at,
  });

  if (daily === null && weekly === null) return { kind: 'within' };
  if (weekly === null) {
    // `daily` is non-null here; the two are checked in the same expression so
    // that a reader can see the exhaustiveness rather than take it on trust.
    return daily === null
      ? { kind: 'within' }
      : { kind: 'delayed', limitKind: 'daily', retryAt: daily.retryAt };
  }
  if (daily === null) {
    return { kind: 'delayed', limitKind: 'rolling_7d', retryAt: weekly.retryAt };
  }

  // Both bind. `null` binds forever, so it wins over any instant; otherwise the
  // later instant wins.
  if (daily.retryAt === null) return { kind: 'delayed', limitKind: 'daily', retryAt: null };
  if (weekly.retryAt === null) return { kind: 'delayed', limitKind: 'rolling_7d', retryAt: null };
  return weekly.retryAt.getTime() > daily.retryAt.getTime()
    ? { kind: 'delayed', limitKind: 'rolling_7d', retryAt: weekly.retryAt }
    : { kind: 'delayed', limitKind: 'daily', retryAt: daily.retryAt };
}

/**
 * `LT-08`, as M05 section 2.1's table declares it and not as this file imagines it.
 *
 *   `LT-08 | wallet_purchase_debit | debit trader_wallet; credit revenue.
 *    Posted by M3 when a purchase is wallet-funded, in the same transaction as
 *    the purchase (M3's INV-M3-13)`
 *
 * `revenue` IS `fees_revenue`, WHICH IS A LOOKUP RATHER THAN A CHOICE.
 * `ledger_accounts_code_is_declared` closes the chart at eight codes and
 * `fees_revenue` is the only one of the eight whose `kind` is `revenue`; the
 * other four firm codes are `firm_treasury`, `psp_clearing`, `reserve` and
 * `withdrawals_in_flight`, and none of them is where a product sale is
 * recognized.
 *
 * THE COUNT MOVED FROM SEVEN TO EIGHT AND THE LOOKUP DID NOT (ADR-187, `0056`).
 * The eighth code is a firm-scoped `liability` for the external leg's in-flight
 * obligation, so it is eliminated here by the same step as the other three: a
 * wallet purchase recognizes revenue, and an obligation to pay a withdrawal
 * onward is not revenue. `ledger_accounts_kind_matches_code`'s `ELSE false`
 * makes the elimination checkable rather than asserted -- every declared code
 * has a ruled kind, so "the only one whose kind is revenue" is a fact the
 * database enforces.
 *
 * `psp_clearing` IS DELIBERATELY NOT TOUCHED, and this is the leg most likely to
 * be written wrong by analogy with the card path. There is no processor in this
 * transaction, so there is nothing in clearing: M03 section 3.4's whole table is
 * that a wallet purchase has *"no third party, no session, no webhook, no
 * signature, and no asynchronous confirmation"*. Crediting a clearing account
 * would book a receivable from a processor that was never asked for money.
 *
 * ONE TRANSFER AND NOT TWO, because there is no split. `LT-01` has two legs
 * because `INV-M5-03` splits an approval between the trader and the firm; a
 * purchase moves one amount from one position to one account.
 */
export function lt08(args: {
  readonly identityId: string;
  readonly purchaseId: string;
  readonly idempotencyKey: string;
  readonly walletDebitCents: bigint;
}): Posting {
  return posting(
    {
      kind: 'wallet_purchase_debit',
      referenceKind: 'purchase',
      referenceId: args.purchaseId,
      idempotencyKey: args.idempotencyKey,
    },
    [
      transfer(
        identityAccount('trader_wallet', args.identityId),
        firmAccount('fees_revenue'),
        args.walletDebitCents,
        'LT-08 wallet-funded purchase: the wallet position pays for the product',
      ),
    ],
  );
}

/**
 * The `ledger_transactions.idempotency_key` this path mints.
 *
 * `idempotency_key text NOT NULL UNIQUE` (`0009`), and the anchor M03 section
 * 3.4's table names for this path is *"the transaction itself, plus the request
 * idempotency key"*. The purchase id is minted once per checkout attempt by
 * `newPurchaseId`, so it is that anchor spelled with a value this transaction
 * already holds, and the prefix is what keeps two different postings about one
 * purchase from colliding on the same key the day a second one exists.
 */
export function lt08KeyOf(purchaseId: string): string {
  return `LT-08 ${purchaseId}`;
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
 * `payment_method = 'mixed'` IS DECLARED, IS NOT SERVED, AND SAYS BOTH.
 *
 * `SD-M3-06` admits `mixed` because *"a trader with $60 in the wallet buying a
 * $99 evaluation is THE COMMON CASE, not an edge one"*, and this session builds
 * the wallet leg and not that one. **`mixed` needs a ruling and P5 section 8's
 * `P5-i` fence admits an ADR only if it does**, so the finding is reported and
 * the number is not taken. The argument, against the landed tree:
 *
 *   1. M03 section 3.4 specifies the wallet leg of a `mixed` purchase as *"held
 *      pending the PSP result"*, and **there is no held representation**.
 *      `wallet_entries` is append-only, `purchases_wallet_debit_is_posted`
 *      requires `wallet_ledger_transaction_id` the instant `wallet_debit_cents`
 *      is above zero, and `ledger_entries` has no UPDATE or DELETE grant
 *      (`0026`). The leg is POSTED and not held, from the moment the row exists.
 *
 *   2. The release is therefore a COMPENSATING CREDIT days later, and
 *      `wallet_entries.provenance` has no member for it: `refund_wallet_funded`
 *      describes a refund of a purchase THE WALLET ITSELF FUNDED and a `mixed`
 *      purchase is funded partly by card, while `correction` is `WF-M20-05`,
 *      *"Admin, dual controlled"*, and a PSP webhook is not an admin. That is
 *      ADR-158 finding 3 arriving on a second row.
 *
 *   3. The compensation site is `routes/webhooks-psp.ts`, which no `P5-i` fence
 *      holds.
 *
 * SO REFUSING IT FORECLOSES NOTHING AND WEAKENS NOTHING. Nothing in this tree
 * sends `payment_method` at all, so `mixed` is unreachable either way; a `mixed`
 * that posted a debit it cannot release is a real loss rather than a missing
 * feature, and it is `AS-M20-03`'s rail-crossing with a compensation path's
 * paperwork.
 *
 * `503` IS THIS FILE'S OWN CODE FOR DECLARED AND NOT INSTALLED, on the precedent
 * two functions down: `UNWIRED_CHECKOUT_BACKEND` answers 503 because *"the route
 * is REGISTERED because the contract row exists, and a missing route would
 * answer 404 and look like a contract Merit never wrote"*, and an unconfigured
 * adapter answers the same. It is NOT `validation_failed`, and the difference is
 * the ordering rule: `mixed` is a word this schema declares, so refusing it at
 * the wire would answer 400 to a restricted identity where M20 section 3.7
 * requires the identity refusal to answer first.
 */
function refuseMixed(): Refusal {
  return refuse(
    'service_unavailable',
    'Service unavailable',
    503,
    'Mixed wallet and card funding is declared by SD-M3-06 and is not served by this ' +
      'deployment: the wallet leg of a mixed purchase posts rather than holds, and the ' +
      'compensating release has no provenance in wallet_entries and no site in this module.',
  );
}

/**
 * `INV-M20-07`'s DELAY, rendered.
 *
 * IT IS A DELAY AND NOT A REFUSAL AND THE WIRE SAYS SO. API_CONTRACT section 2:
 * *"Exceeding returns `429` with `Retry-After`"*, and `rate_limited` is the code
 * that table gives a velocity throttle. `Retry-After` carries the instant M20
 * section 3.2's `delayed --> authorized: window elapses, checks re-run` edge is
 * about, so the trader is told when rather than merely no.
 *
 * THE HEADER IS OMITTED WHEN THERE IS NO SUCH INSTANT, and the case is real
 * rather than defensive: API_CONTRACT states that `daily_cents: 0` *"is writable
 * and means no wallet spend at all"*, so no amount of window rolling admits a
 * positive spend. A fabricated `Retry-After` would send the trader back to be
 * refused again, forever. The detail says which limit bound either way.
 */
function refuseDelayed(outcome: VelocityOutcome & { kind: 'delayed' }, at: Date): Refusal {
  const seconds =
    outcome.retryAt === null
      ? null
      : // At least one second: a `Retry-After: 0` reads as "immediately", which
        // is the one thing this answer does not mean.
        Math.max(1, Math.ceil((outcome.retryAt.getTime() - at.getTime()) / 1000));
  const detail =
    outcome.retryAt === null
      ? `The ${outcome.limitKind} wallet spend limit is below this amount, so no window admits it.`
      : `The ${outcome.limitKind} wallet spend limit is reached. This purchase is delayed rather ` +
        `than refused and may be retried at ${outcome.retryAt.toISOString()}.`;
  return {
    send: (reply, requestId) => {
      if (seconds !== null) reply.header('Retry-After', String(seconds));
      return sendProblem(reply, {
        ...handlerProblem(RATE_LIMITED, 'Rate limited', 429, requestId),
        detail,
      });
    },
  };
}

/**
 * THE WALLET LEG. M20 section 3.2's order, followed literally.
 *
 * ```
 * requested --> refused: identity restricted (INV-M20-06, ADR-041)
 * requested --> refused: identity payouts_frozen (INV-M20-06)
 * requested --> refused: recon_blocked or KYC not verified (INV-M20-06)
 * requested --> refused: target account belongs to another identity (INV-M20-02)
 * requested --> refused: insufficient position (INV-M20-01)
 * requested --> delayed: velocity limit exceeded (INV-M20-07)
 * requested --> authorized: all checks pass
 * authorized --> settled: LT-08 posted in the same transaction as the purchase
 * ```
 *
 * THE POSITION CHECK COMES BEFORE THE VELOCITY DELAY AND THE ORDER IS THE
 * DIAGRAM'S RATHER THAN A PREFERENCE. Telling a trader with no balance to come
 * back in six hours and then refusing them is worse than refusing them now, and
 * the diagram draws `insufficient position` above `velocity limit exceeded`.
 *
 * EVERY READ AND EVERY WRITE BELOW IS ON THE CALLER'S OPEN TRANSACTION, WHICH IS
 * `INV-M3-13`: a wallet purchase *"debits the wallet IN THE SAME TRANSACTION
 * that creates the purchase"*. A refusal returned from here becomes a
 * `RefusalThrown` in `runCheckout` and the transaction rolls back, so a posting
 * made before a later refusal is not a posting anybody has to compensate.
 */
async function walletLeg(args: {
  readonly tx: CheckoutTx;
  readonly session: AuthSession;
  readonly resolved: ResolvedPurchase;
  readonly amountPaidCents: bigint;
  readonly purchaseId: string;
  readonly at: Date;
}): Promise<{ readonly ledgerTransactionId: string } | Refusal> {
  const { tx, session, resolved, amountPaidCents, purchaseId, at } = args;

  // 1. INV-M20-06, the whole enumerated set, BEFORE anything is read about the
  //    money and before the deployment's ability to post is even consulted: a
  //    frozen identity is told it is frozen rather than told the service is
  //    unavailable.
  const gate = gateWalletSpend(await tx.walletSpendGates());
  if (gate !== null) return gate;

  // 2. INV-M20-02, RESOLVED SERVER SIDE IN THE DEBIT TRANSACTION. See
  //    `CheckoutTx.ownsAccount` for why this is asked a second time.
  //
  //    A `new` purchase has no target account and the check is vacuous rather
  //    than skipped: the account this purchase will create carries this row's
  //    own `purchases.identity_id`, so there is no other identity it could be
  //    for. A `reset` names one, and that one is checked.
  if (resolved.parentAccountId !== null && !(await tx.ownsAccount(resolved.parentAccountId))) {
    return refuse(
      'forbidden',
      'Forbidden',
      403,
      'Wallet value may be spent only on this identity own accounts.',
    );
  }

  // 3. ADR-157 clause 4's ROW lock, taken through the accessor and taking no
  //    argument. Everything below reads under it.
  await tx.lockScope();

  // 4. INV-M20-01, checked against the LIVE position inside this transaction and
  //    under that lock. `FM-M20-01` is the concurrent overdraw and this ordering
  //    is what makes it structurally prevented rather than merely unlikely.
  const balanceCents = await tx.walletBalanceCents();
  if (balanceCents < amountPaidCents) {
    return refuse(
      INSUFFICIENT_FUNDS,
      'Insufficient funds',
      422,
      'The wallet position does not cover this purchase.',
    );
  }

  // 5. INV-M20-07, which DELAYS. The window read is the LONGER of the two, so
  //    one read serves both limits.
  const velocity = velocityOf({
    amountCents: amountPaidCents,
    limit: await tx.walletSpendLimit(at),
    debits: await tx.walletDebitsSince(new Date(at.getTime() - ROLLING_7D_WINDOW_MS)),
    at,
  });
  if (velocity.kind === 'delayed') return refuseDelayed(velocity, at);

  // 6. LT-08. The door is the wiring's and this file does not open one; see
  //    `CheckoutTx.ledger`. It is consulted AFTER every authorization decision so
  //    that a refused caller is told why they were refused rather than told the
  //    deployment cannot post.
  const ledger = tx.ledger;
  if (ledger === null) {
    return refuse(
      'service_unavailable',
      'Service unavailable',
      503,
      'No ledger posting handle is installed for this deployment, and a wallet purchase ' +
        'commits with its LT-08 posting or not at all.',
    );
  }

  const posted = await postTransaction(
    ledger,
    await readChart(ledger),
    lt08({
      identityId: session.identityId,
      purchaseId,
      idempotencyKey: lt08KeyOf(purchaseId),
      walletDebitCents: amountPaidCents,
    }),
  );

  // 7. The wallet's own statement, which the ledger is not. `0011`: "the ledger
  //    knows an amount moved into trader_wallet, and only this table knows it
  //    arrived as a payout rather than as a refund".
  await tx.insertWalletDebit({
    amountCents: amountPaidCents,
    cause: 'checkout: wallet-funded purchase',
    referenceId: purchaseId,
    ledgerTransactionId: posted.transactionId,
    // INV-M20-01 as arithmetic rather than as a constraint the database is left
    // to discover: the position read under the lock, minus this debit, which the
    // check above has already established is not negative.
    balanceAfterCents: balanceCents - amountPaidCents,
  });

  return { ledgerTransactionId: posted.transactionId };
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
  /** SD-M3-06. `'psp'` when the body named none: see {@link DEFAULT_PAYMENT_METHOD}. */
  readonly paymentMethod: PaymentMethod;
}): Promise<CheckoutResponse | Refusal> {
  const { tx, session, resolved, cap, couponCode, clickToken, tosVersionIds, ip, at } = args;
  const paymentMethod = args.paymentMethod;

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

  const purchaseId = newPurchaseId();

  // ---------------------------------------------------------------------------
  // THE PAYMENT-METHOD BRANCH, AND EVERY HARD LIMIT IS ALREADY ABOVE IT
  // ---------------------------------------------------------------------------
  // M20 section 3.7 IS THE ORDERING RULE AND IT IS THE THING MOST LIKELY TO BE
  // GOT WRONG: "The refusal is placed before the payment-method branch, and this
  // module has already paid for learning that once."
  //
  // What it paid for is M03 section 3.5.1, measured rather than feared: before
  // ADR-041's fold, a `restricted` identity was refused on `wallet`, COMPLETED
  // on `psp`, and on `mixed` was "refused, on the wallet leg, AFTER THE CARD LEG
  // IS UNDERWAY", reaching the right answer through a compensation path. "A
  // restricted trader could buy with a card and could not buy with money Merit
  // already owes them. That is the wrong way round on every reading."
  //
  // So the rule is: "every hard limit is asserted against all three payment
  // methods, because a case asserted against one passes while another refuses
  // for an unrelated reason ... ONE AUTHORIZATION DECISION BEFORE THE BRANCH
  // REFUSES ALL THREE, and the assertion should be run against all three."
  //
  // `gateIdentity` IS THAT DECISION AND IT IS ALREADY AT THE TOP OF BOTH
  // HANDLERS' TRANSACTIONS, above the plan lookup and above this function. It
  // is not moved, not copied and not re-asked here, because a hard limit checked
  // twice in two places is a hard limit that can disagree with itself. What is
  // added below it is the branch, and NOTHING REFUSAL-SHAPED SITS BETWEEN THEM
  // that depends on which method was asked for: the geo decision and the coupon
  // above are the same for all three.
  //
  // `INV-M20-06` IS A DIFFERENT REFUSAL AND IT BELONGS INSIDE THE ARM. Section
  // 3.7: "The two refusals fire at different moments against different subjects:
  // the impersonation refusal at authorization, against the session; INV-M20-06
  // inside the spend transaction, against the identity."
  if (paymentMethod === 'mixed') return refuseMixed();

  if (paymentMethod === 'wallet') {
    const leg = await walletLeg({
      tx,
      session,
      resolved,
      amountPaidCents,
      purchaseId,
      at,
    });
    if ('send' in leg) return leg;

    await tx.recordTosAcceptance(tosVersionIds, ip);

    return completePurchaseTail({
      tx,
      session,
      resolved,
      coupon,
      amountPaidCents,
      decision,
      purchaseId,
      ip,
      geo,
      funding: {
        paymentMethod: 'wallet',
        psp: null,
        pspReference: null,
        walletDebitCents: amountPaidCents,
        walletLedgerTransactionId: leg.ledgerTransactionId,
        // INV-M3-13. The payment either committed or it did not, so there is no
        // `provisioning_pending` limbo on this path and the row is `paid` in the
        // transaction that creates it.
        status: 'paid',
        paidAt: at,
      },
      respond: (base) => ({
        ...base,
        payment_method: 'wallet',
        wallet_debit_cents: centsToJson(amountPaidCents),
      }),
    });
  }

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

  // `cardLegOf` is the ONLY producer of a `CardAmountCents` in this workspace
  // and it takes the purchase row's money. `payment_method` is `'psp'` here
  // because the two other members are handled above and neither reaches this
  // line: `'wallet'` returns from its own arm and `'mixed'` is refused. Passing
  // the branch's own variable instead would be spelling a value the control
  // flow has already narrowed, and `cardLegOf` REFUSES a wallet row rather than
  // returning zero, so a future edit that let one through fails loudly here.
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

  return completePurchaseTail({
    tx,
    session,
    resolved,
    coupon,
    amountPaidCents,
    decision,
    purchaseId,
    ip,
    geo,
    funding: {
      paymentMethod: 'psp',
      psp,
      pspReference: paymentSession.providerSessionId,
      // `purchases_wallet_leg_matches_method`: `payment_method = 'psp'` requires
      // `wallet_debit_cents = 0`, and `purchases_wallet_debit_is_posted` then
      // permits the null pointer.
      walletDebitCents: 0n,
      walletLedgerTransactionId: null,
      // Unchanged from what this handler wrote by omission before the column was
      // named: a card purchase is `pending` until its webhook says otherwise,
      // which is the `provisioning_pending` limbo `INV-M3-13` says the wallet
      // path cannot reach.
      status: 'pending',
      paidAt: null,
    },
    respond: (base) => ({
      ...base,
      psp,
      payment_session: {
        provider_session_id: paymentSession.providerSessionId,
        redirect_url: paymentSession.redirectUrl,
        expires_at: paymentSession.expiresAt,
      },
    }),
  });
}

/**
 * What one arm of the branch resolved about how this purchase is funded.
 *
 * IT IS EXACTLY THE COLUMNS `purchases_wallet_leg_matches_method` AND
 * `purchases_wallet_debit_is_posted` CONSTRAIN, plus the two `SD-M3-06` columns
 * the card path leaves empty, gathered into one object so that the two arms
 * cannot disagree about which of them each one writes.
 */
interface FundingLeg {
  readonly paymentMethod: PaymentMethod;
  readonly psp: PspId | null;
  readonly pspReference: string | null;
  readonly walletDebitCents: bigint;
  readonly walletLedgerTransactionId: string | null;
  readonly status: 'pending' | 'paid';
  readonly paidAt: Date | null;
}

/**
 * Everything both arms do AFTER the branch, in one place and in one order.
 *
 * IT IS ONE FUNCTION FOR THE REASON `completePurchase` IS ONE FUNCTION, which
 * that function's own docstring gives: writing the paths twice is how one of
 * them acquires a subtly different cap check. Here the risk is sharper, because
 * what follows is the purchase INSERT, the coupon claim and the attribution
 * write, and a wallet arm with its own copy of those is a wallet arm that can
 * stop rolling back when a coupon claim is lost.
 *
 * SO THE TWO ARMS DIFFER IN EXACTLY TWO VALUES, both parameters here: the
 * {@link FundingLeg} they resolved and the response half they build.
 */
async function completePurchaseTail(args: {
  readonly tx: CheckoutTx;
  readonly session: AuthSession;
  readonly resolved: ResolvedPurchase;
  readonly coupon: { readonly coupon: CouponRow | null; readonly discountCents: bigint };
  readonly amountPaidCents: bigint;
  readonly decision: ReturnType<typeof resolveAttribution>;
  readonly purchaseId: string;
  readonly ip: string;
  readonly geo: GeoDecisionRow;
  readonly funding: FundingLeg;
  /**
   * The arm's own response, built from the four fields both shapes share.
   *
   * IT TAKES THE BASE AND RETURNS THE WHOLE THING RATHER THAN RETURNING A HALF
   * TO BE SPREAD, so each arm names a COMPLETE member of the union and the
   * compiler checks it. Spreading two objects produces an intersection TypeScript
   * cannot narrow back to a discriminated union without a cast, and a cast on the
   * one function that decides what a buyer is told is the wrong place to spend
   * one.
   */
  readonly respond: (base: CheckoutResponseBase) => CheckoutResponse;
}): Promise<CheckoutResponse | Refusal> {
  const { tx, session, resolved, coupon, amountPaidCents, decision, purchaseId, ip, geo, funding } =
    args;

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
    psp: funding.psp,
    pspReference: funding.pspReference,
    ip,
    checkoutIpCountry: geo.countryCode,
    geoDecision: geo.decision,
    paymentMethod: funding.paymentMethod,
    walletDebitCents: funding.walletDebitCents,
    walletLedgerTransactionId: funding.walletLedgerTransactionId,
    status: funding.status,
    paidAt: funding.paidAt,
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

  // THE ATTRIBUTION WRITE IS THE LAST WRITE AND IT IS NOT GUARDED. A throw here
  // rolls the purchase back, which is session 220's approval line.
  if (decision.kind === 'attributed') {
    await tx.insertAttribution(purchaseId, decision.row);
  }

  // ---------------------------------------------------------------------------
  // ADR-023 STEP 1: ENRICHMENT OBSERVES, AND THIS IS THE PLACE IT COULD STOP
  // ---------------------------------------------------------------------------
  // ADR-023 step 1 is observe mode: "Signals recorded, scored, and reported;
  // nothing is blocked. The purpose is to learn the distribution on Merit's own
  // traffic." ADR-115's title names the TWO PLACES that could quietly stop being
  // true, and both of them are HERE rather than in `packages/enrichment`: a
  // package that decides nothing becomes enforcement at the site that calls it.
  //
  //   1. A RETURN VALUE A CALL SITE COULD BRANCH ON. `observeEnrichment` returns
  //      `Promise<void>`, so there is nothing to branch on and this line binds
  //      nothing. That is ADR-105's second rule for the payment port tightened
  //      one notch, and it is asserted BY READING THIS FILE in
  //      `checkout.test.ts`, because a call site that ignored a returned
  //      decision looks identical from outside until somebody reads it.
  //
  //   2. A THROW THAT PROPAGATES INTO THIS TRANSACTION. A throw here is a
  //      `ROLLBACK`, so a propagating enrichment failure is enforcement by
  //      EXCEPTION, and enforcement by exception is a SILENT decline: the buyer
  //      is refused and told nothing, which ADR-023 forbids even in step 3 where
  //      declining is permitted at all. `observeEnrichment` is total: its `try`
  //      catches everything `run` can throw, including the reporter's own throw
  //      one layer in. A hanging vendor, a failing vendor and a throwing sink
  //      each commit this purchase, watched in `checkout.test.ts`.
  //
  // SO IT IS THE LAST THING THE TRANSACTION DOES, AND THE POSITION IS PART OF
  // THE ARGUMENT. Nothing below reads an outcome because there is no outcome to
  // read, and nothing below runs at all except building the response out of
  // figures computed before this line.
  //
  // A VENDOR TIMEOUT MUST NOT ROLL BACK A PURCHASE, and what happens when the
  // vendor is slow is stated rather than hoped for: `ENRICHMENT_TIMEOUT_MS` is
  // 800 integer milliseconds, the race is against the adapter's PROMISE and not
  // against its manners, the abandoned call is given its rejection handler at
  // the moment it is made so a late failure settles a promise nobody awaits, the
  // dispatch row is still written because the subject left Merit either way, the
  // outcome is reported as `timed_out`, and the purchase commits. The cost is
  // one open transaction held up to 800ms longer, which is the same hazard this
  // file's header already REPORTS about `createSession` rather than routes
  // around.
  //
  // WHAT THIS CALL SITE DOES NOT DO. It sends no email, no phone, no device and
  // no BIN, because checkout holds none of them: `CheckoutRequest` carries a
  // plan, a size, a coupon code, a click token and TOS ids, and `AuthSession`
  // carries ids. Four of `EnrichmentSubject`'s five facets are therefore ABSENT
  // rather than empty, and `redactToAllowlist` narrows even the one to what the
  // contract row permits before an adapter sees it.
  const enrichment = currentCheckoutAdapters().enrichment;
  if (enrichment !== null && tx.enrichment !== null) {
    await observeEnrichment(tx.enrichment, {
      adapter: enrichment.adapter,
      contracts: enrichment.contracts,
      subject: { ip },
      // `purchases.id`. ADR-115 clause 4: `integration_dispatches_idempotency_uq`
      // makes ONE enrichment disclosure per purchase a fact rather than a
      // convention, and a retried payment attempt is a new session against the
      // same purchase (M03 section 3.2).
      purchaseId,
      now: enrichment.now,
      report: enrichment.report,
    });
  }

  return args.respond({
    purchase_id: purchaseId,
    plan_version_id: resolved.planVersionId,
    amount_cents: centsToJson(amountPaidCents),
    discount_cents: centsToJson(coupon.discountCents),
  });
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
          paymentMethod: body.payment_method ?? DEFAULT_PAYMENT_METHOD,
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
          paymentMethod: body.payment_method ?? DEFAULT_PAYMENT_METHOD,
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
