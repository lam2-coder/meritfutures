// =============================================================================
// apps/api/src/routes/catalog.ts
// =============================================================================
// API_CONTRACT SECTION 4's TWO CATALOGUE READS AND SECTION 5's `GET /purchases`,
// AND THE REASON THEY ARE ONE FILE IS THE REASON THEY ARE INTERESTING:
//
//   GET /plans                            firm door,   auth none
//   GET /plans/:planId/versions/:version  firm door,   auth none
//   GET /purchases                        SCOPED door, auth session, and then
//                                         the firm door, in that order
//
// -----------------------------------------------------------------------------
// THE CROSSING, WHICH IS THE WHOLE DESIGN
// -----------------------------------------------------------------------------
// `plans`, `plan_versions` and `plan_version_sizes` are all registered `firm` in
// `packages/db/src/scope.ts`, in that file's own words: "there is no identity
// column and there is no correct one: EVERY identity is sold the same plan
// version, and THE LINK RUNS THE OTHER WAY -- `accounts.plan_version_id` names
// the version an account was bought under -- so ownership flows FROM the
// catalogue rather than to it."
//
// `purchases` is registered `owned` on `identity_id`.
//
// So `GET /purchases` composes a response out of BOTH doors, and this file is
// the first request handler in this deployable that does. ADR-141 is the ruling
// that states what that costs and what makes it safe; the two properties it
// fixes are implemented here rather than remembered:
//
//   1. THE SCOPED READ RUNS FIRST AND ITS RESULT KEYS THE FIRM READ. The
//      handler resolves the caller's purchases, collects the DISTINCT
//      `plan_version_id` values off those rows, and asks the catalogue about
//      exactly those. `plansOfVersions` takes those ids as its ARGUMENT, so it
//      can annotate what the scoped read returned and cannot widen it.
//
//   2. THE PORT IS SPLIT SO THAT THE WRONG DOOR HAS NO METHOD ON IT.
//      `CatalogFirmReads` and `CatalogScopedReads` are two interfaces, not one
//      with six methods, so a handler holding the firm half has nothing to call
//      that reaches a purchase.
//
// WHAT THE COMPILER ALREADY REFUSES, MEASURED RATHER THAN ASSUMED, BECAUSE THE
// FIRST DRAFT OF THIS HEADER OVERSTATED THE HAZARD. Replacing this file's
// `db.scoped(identityId, ...)` with `db.firm(...)` does not compile:
//
//   error TS2345: Argument of type '"purchases"' is not assignable to
//                 parameter of type 'FirmTableKey'.
//   error TS2345: Argument of type '"accounts"' is not assignable to
//                 parameter of type 'FirmTableKey'.
//
// That is ADR-106 clause 3's key-type partition holding at this call site, and
// it means the blunt version of the leak -- reading a purchase unscoped -- is a
// compile error rather than a convention. Point 2 above is therefore a SECOND
// guard over a door the accessor had already shut, and it is kept because it
// shuts it one layer earlier, where the reviewer reads.
//
// WHAT IS LEFT UNREFUSED IS NARROWER AND IS THE PART ADR-141 IS FOR:
//
//   * WHICH identity the scoped door is opened with. `scoped(identityId, ...)`
//     takes a `string`, so `session.identityId` and a path parameter are the
//     same type. Only the call site decides, and this file has exactly one.
//   * The DIRECTION of a composition the compiler sees as two legal reads.
//     `firmDb()` takes no reason (ADR-102 clause 5), so a handler may read the
//     whole catalogue whenever it likes; what stops that from becoming a
//     cross-identity read is that the scoped half is the only half that can
//     name a purchase, and nothing checks that the firm half was keyed by it.
//
// THE TWO READS ARE TWO TRANSACTIONS AND THE RESPONSE IS THEREFORE NOT A
// SNAPSHOT. `ApiDb` hands the whole unit of work to `transaction()` per call, so
// `scoped(...)` commits before `firm(...)` opens. That is survivable on exactly
// these columns and it is survivable BY A TRIGGER IN ANOTHER PACKAGE rather
// than by anything here: `0028`'s published-row guard pins every column of a
// published `plan_versions` row except `status`, `retired_at` and
// `public_visible`, so `code` and `version` -- the only two catalogue facts this
// response carries -- cannot move between the two reads. A later slice that
// wants a MOVABLE catalogue field on a trader-scoped response does not inherit
// that argument and needs its own.
//
// The two SCOPED reads that `GET /purchases` needs -- `purchases` and the
// `accounts` rows that resolve `account_id` -- are in ONE transaction, which is
// why `CatalogScopedReads` has one method returning both rather than two
// methods returning one each.
//
// -----------------------------------------------------------------------------
// THE TWO PUBLIC ROUTES DO NOT GO THROUGH `auth.ts`, AND THAT IS DELIBERATE
// -----------------------------------------------------------------------------
// `endpointHandler` reads the session cookie and calls `sessionByToken` BEFORE
// it consults the declared factor, so a route declared `required: 'none'` still
// resolves a session whenever the request happens to carry a cookie. On a
// cacheable public read that buys nothing and costs two things: a database
// round trip through the auth backend on the hottest public path in the
// contract, and a `503` for a stale cookie whenever that backend is unwired.
// `public-methods.ts` is the precedent and it is a bare `RouteHandler`.
//
// So this module registers two bare handlers and one `EndpointSpec`, and the
// mixture is the scope crossing showing up one layer higher than the doors.
//
// -----------------------------------------------------------------------------
// THE ALLOWLIST IS NOT DECORATION HERE, AND ADR-102 SECTION 7 IS WHY
// -----------------------------------------------------------------------------
// That section records a live blind spot: the assertion `no firm table carries
// a column referencing identities` reads the `CREATE TABLE` body and MISSES a
// column added later by `ALTER`. `plan_versions` has three such columns --
// `fee_back_repeats` (`0044`), `decided_on_simulation_run_id` and
// `simulation_waiver_reason` (`0045`) -- so this file went looking for the
// finding that would have been worth more than the route.
//
// IT IS NOT THERE, AND THE NEGATIVE RESULT IS WORTH STATING. None of the three
// reaches `identities`, so the `firm` classification of the catalogue is
// correct and is correct for a reason the blind check happens not to cover.
// What IS there is a smaller thing pointing the same way:
// `simulation_waiver_reason` is free text an operator wrote about MERIT'S OWN
// publish decision, sitting on a table two of these three routes serve to
// anybody with a socket. It is firm-internal rather than identity-shaped, so no
// scope class would ever have withheld it. THE ONLY THING BETWEEN IT AND THE
// PUBLIC IS SECTION 1's RESPONSE-SHAPE POLICY -- "a field that is not in the
// schema is not in the response" -- which is what `renderPlanVersion` below is.
// A `SELECT *` here would publish it, and a scoped read would not have helped:
// "a scoped read is a FILTER and not a PROJECTION" (ADR-106 section 4).
//
// -----------------------------------------------------------------------------
// TWO FIELDS IN SECTION 4's OWN SHAPE ARE NOT COLUMNS, AND ARE DERIVED HERE
// -----------------------------------------------------------------------------
// `PlansResponse.sizes[]` declares `payout_cap_cents` and `min_payout_cents`.
// `plan_version_sizes` (`0004`) declares NEITHER.
//
//   * `payout_cap_cents` is the FIRST RUNG of `payout_cap_schedule_cents`, a
//     jsonb array of `{ from_ordinal, cap_cents }`. DATA_MODEL section 12 rows
//     that array as a deliberate reservation -- "array instead of scalar" buys
//     "progressive cap release (M14)" -- and section 4's shape flattens it back
//     to the scalar it was reserved against. The endpoint therefore cannot
//     express a schedule with a second rung, and the day M14 publishes one this
//     response is wrong rather than incomplete. `capAtFirstOrdinal` refuses a
//     schedule whose first rung is not ordinal 1 rather than quietly reporting
//     rung two as the cap.
//
//   * `min_payout_cents` is not on the size row at all. It is
//     `plan_versions.rules.phase_funded.min_payout_cents` (DATA_MODEL section
//     11), which is a PER-VERSION value, so section 4 places it one level below
//     where it lives. Every size of one version carries the same number here,
//     and that is a faithful rendering rather than a bug in this file.
//
// Both are reported to ADR-141 rather than repaired, because repairing either
// edits an `approved` document.
//
// -----------------------------------------------------------------------------
// THE CURSOR IS APPLIED AFTER THE READ, BECAUSE THE DOOR HAS NO OTHER SHAPE
// -----------------------------------------------------------------------------
// Section 1: "Cursor only, never offset: `?limit=50&cursor=<opaque>`."
//
// ADR-112's keyed accessor offers `rows`, `rowsWhere`, `rowAt`, `insert`,
// `updateAt` and `deleteAt`, and `RowFilter` is "equality, ANDed, and nothing
// else. There is no `OR`, no `IN`, no range and no `IS NULL`." There is also no
// `ORDER BY` and no `LIMIT`. A keyset cursor is a RANGE plus an ORDER plus a
// LIMIT, so the scoped door cannot express one, and the alternatives are both
// refused by the brief: `sqlExecutor` is reasoned `'job-enqueue'` and widening
// `SqlExecutorReason` to run raw SQL from a request handler is exactly the
// widening ADR-102 clause 3 and ADR-109 clause 1 each refused once.
//
// SO THE HANDLER READS EVERY PURCHASE OF THE CALLER AND PAGES IN MEMORY, AND
// THE COST IS STATED RATHER THAN HIDDEN: each page is O(all of this identity's
// purchases). It is bounded in practice -- `limits.max_accounts_per_entity` is
// 10 and a purchase is one account or one reset of one -- and it is NOT bounded
// by anything the database enforces. Nothing here is a leak: the rows are all
// this identity's, because the tenancy predicate was applied by the accessor
// before this file saw a row. It is a performance ruling owed to a later slice
// and ADR-141 records it.
//
// -----------------------------------------------------------------------------
// NO `@merit/db` IMPORT, AND ONE LOCAL COPY OF THE MONEY GUARD
// -----------------------------------------------------------------------------
// `db.ts`'s header asks that `grep -rln '@merit/db' apps/api/src` return exactly
// one file, so this one takes `ApiDb` and the table keys are plain strings the
// accessor's own key types check.
//
// `centsToJson` IS A SECOND COPY OF `checkout.ts`'s AND THE DUPLICATION IS THE
// CHEAPER SIDE. Importing it would put `@merit/psp`, `@merit/affiliate` and
// `@merit/enrichment` -- checkout's runtime imports -- into the module graph of
// the cacheable public read the marketing site renders from, and would make a
// catalogue defect surface as a `CheckoutMoneyError` in an incident log. Six
// lines against a vendor adapter on the pricing page is not a close call.
// =============================================================================

import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { ApiDb } from '../db.ts';
import type { RouteHandler } from '../registry.ts';
import {
  type EndpointSpec,
  type FieldError,
  problemNotFound,
  requiredFactorTable,
  toRoutes,
  withSessionContext,
} from './auth.ts';

// -----------------------------------------------------------------------------
// The paths, as API_CONTRACT writes them. No base path (`surface.ts` refuses one)
// -----------------------------------------------------------------------------

/** Section 4's first row. */
export const PLANS_PATH = '/plans';

/**
 * Section 4's second row, spelled as that document spells it.
 *
 * BOTH SEGMENTS, BECAUSE ONE DOES NOT NAME A VERSION. `plan_versions` is keyed
 * `(plan_id, version)` by `plan_versions_plan_version_uq`, so the address of one
 * version is the pair and a single-segment `/plans/:plan` would be half of it.
 */
export const PLAN_VERSION_PATH = '/plans/:planId/versions/:version';

/** Section 5's list. */
export const PURCHASES_PATH = '/purchases';

// -----------------------------------------------------------------------------
// Closed vocabularies, each traced to the thing that closes it
// -----------------------------------------------------------------------------

/**
 * Section 4: `code: "core_eod" | "merit_rapid" | "direct"`, renamed at the M1
 * gate (ADR-013).
 *
 * IT IS CLOSED IN THE CONTRACT AND OPEN IN THE DATABASE, which is the one place
 * this file refuses a row the schema can legitimately hold. `plans.code` is
 * `text NOT NULL UNIQUE` with NO `CHECK`, where `plan_version_status` and
 * `purchase_status` beside it are real enums. So a fourth code is storable, and
 * `renderPlans` throws on one rather than dropping the plan: this endpoint is
 * what the pricing page renders from, and a purchasable plan silently missing
 * from the page it is sold on is worse than a page that fails loudly.
 */
export const PLAN_CODES = ['core_eod', 'merit_rapid', 'direct'] as const;

/** One of {@link PLAN_CODES}. */
export type PlanCode = (typeof PLAN_CODES)[number];

/**
 * `plan_version_status` (`0001`), MINUS `draft`.
 *
 * Section 4's `PlanVersionResponse.status` is `"published" | "retired"` and the
 * enum has a third member. A draft is a contract nobody was ever sold and the
 * response has no value to render it as, so `GET /plans/:planId/versions/:version`
 * answers `404` for one. Section 1's 404 already means "unknown resource, or a
 * resource the caller does not own"; on a public catalogue there is no owner, so
 * here it means only the first.
 */
export const PUBLISHED_VERSION_STATUSES = ['published', 'retired'] as const;

/** One of {@link PUBLISHED_VERSION_STATUSES}. */
export type PublishedVersionStatus = (typeof PUBLISHED_VERSION_STATUSES)[number];

/** `purchase_status` (`0001`), which is section 5's union exactly. */
export const PURCHASE_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'charged_back'] as const;

/** One of {@link PURCHASE_STATUSES}. */
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** `purchases.kind`, whose `CHECK` closes it at two. */
export const PURCHASE_KINDS = ['new', 'reset'] as const;

/** One of {@link PURCHASE_KINDS}. */
export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

// -----------------------------------------------------------------------------
// The rows, transcribed column for column in the database's own snake_case
// -----------------------------------------------------------------------------
// Named after the SQL rather than after Drizzle's property names for
// `public-methods.ts`' stated reason: a paraphrase of the shape is the first
// step toward a paraphrase of the meaning. The readers below translate.

/** One `plans` row, as the source hands it over. */
export interface PlanRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly is_active: boolean;
  readonly sort_order: number;
}

/** One `plan_versions` row, in the fields this contract's two shapes reach. */
export interface PlanVersionRow {
  readonly id: string;
  readonly plan_id: string;
  readonly version: number;
  readonly status: string;
  /** `plan_versions.rules`, the exact stored JSON. DATA_MODEL section 11. */
  readonly rules: unknown;
  readonly copy_blocks: Readonly<Record<string, string>>;
  readonly public_visible: boolean;
  readonly published_at: string | null;
  readonly retired_at: string | null;
}

/** One step of `plan_version_sizes.payout_cap_schedule_cents`. */
export interface CapScheduleStep {
  readonly from_ordinal: number;
  readonly cap_cents: bigint;
}

/**
 * One `plan_version_sizes` row.
 *
 * MONEY IS `bigint` ON EVERY COLUMN THE DDL DECLARES `bigint`, which is all of
 * them, and `schema.ts` reads them `{ mode: 'bigint' }` so that is what arrives.
 * The wire conversion happens once, in `centsToJson`.
 */
export interface PlanVersionSizeRow {
  readonly plan_version_id: string;
  readonly size_cents: bigint;
  readonly price_cents: bigint;
  readonly reset_price_cents: bigint;
  readonly drawdown_cents: bigint;
  /** `null` on Direct: no evaluation, so no target. A zero would be a target. */
  readonly profit_target_cents: bigint | null;
  readonly buffer_cents: bigint;
  readonly win_day_floor_cents: bigint;
  readonly payout_cap_schedule_cents: readonly CapScheduleStep[];
}

/** One `purchases` row, in the fields section 5's list item reaches. */
export interface PurchaseRow {
  readonly id: string;
  readonly plan_version_id: string;
  readonly created_at: string;
  readonly kind: string;
  readonly size_cents: bigint;
  readonly amount_paid_cents: bigint;
  readonly discount_cents: bigint;
  readonly status: string;
}

/**
 * The two columns of `accounts` this file reads, and NOT ONE MORE.
 *
 * `PurchaseListItem.account_id` is the account a purchase produced, and the
 * link runs FROM the account: `accounts.purchase_id uuid NOT NULL UNIQUE
 * REFERENCES purchases(id)` (`0007`). So the pointer is inverted here, and the
 * `UNIQUE` is what makes the inversion single-valued rather than a guess.
 *
 * IT IS A DELIBERATELY NARROW SHAPE. `accounts` carries balances, floors and a
 * platform reference, and `GET /accounts` is another session's endpoint. A wide
 * row transiting this file would be a second, undeclared account read.
 */
export interface AccountLinkRow {
  readonly id: string;
  readonly purchase_id: string;
}

// -----------------------------------------------------------------------------
// The two ports, and the split IS the ruling
// -----------------------------------------------------------------------------

/** The active plans, their on-sale versions and those versions' sizes. */
export interface CatalogueSnapshot {
  readonly plans: readonly PlanRow[];
  readonly versions: readonly PlanVersionRow[];
  readonly sizes: readonly PlanVersionSizeRow[];
}

/** One version and its price grid. */
export interface VersionSnapshot {
  readonly version: PlanVersionRow;
  readonly sizes: readonly PlanVersionSizeRow[];
}

/**
 * What a purchase's `plan` block needs, resolved out of the catalogue.
 *
 * THREE FIELDS AND NO FOURTH. Section 5 declares `plan: { plan_id, code,
 * version }` on a purchase, where section 6 declares `plan: { plan_id, code,
 * name, version }` on an account. The `name` is absent here and it is absent on
 * purpose: this is the allowlist, and a field the contract does not declare on
 * this shape does not travel just because the row it came from carries it.
 */
export interface PlanPin {
  readonly plan_version_id: string;
  readonly plan_id: string;
  readonly code: string;
  readonly version: number;
}

/**
 * Reads through `firmDb()`. ROWS THAT BELONG TO NOBODY, AND NOTHING ELSE.
 *
 * There is no method here that takes an identity. The accessor already refuses
 * the blunt version -- `firmTx.rows('purchases')` is `TS2345` naming
 * `FirmTableKey` -- so this split is a second guard one layer earlier, where a
 * reviewer reads, rather than the only one.
 *
 * EACH METHOD IS ONE TRANSACTION. The port is shaped around the READ rather than
 * around the row for that reason: a per-row port would make `GET /plans` open
 * one transaction per size grid.
 */
export interface CatalogFirmReads {
  /** Section 4's list, in one transaction. */
  catalogue(): Promise<CatalogueSnapshot>;
  /** One version addressed by `(plan_id, version)`, or `null`. */
  versionAt(planId: string, version: number): Promise<VersionSnapshot | null>;
  /**
   * The catalogue facts naming a set of versions.
   *
   * THE ARGUMENT IS THE DIRECTION OF THE CROSSING. These ids come off rows the
   * SCOPED door already returned, so this call cannot widen what the caller
   * sees: it can only annotate it. A method taking a plan and returning
   * purchases would be the same two tables in the order that leaks.
   */
  plansOfVersions(planVersionIds: readonly string[]): Promise<readonly PlanPin[]>;
}

/** What one scoped transaction returns for `GET /purchases`. */
export interface PurchaseSnapshot {
  readonly purchases: readonly PurchaseRow[];
  readonly accounts: readonly AccountLinkRow[];
}

/**
 * Reads through `scopedDb(identityId)`. ONE PERSON'S ROWS.
 *
 * ONE METHOD RETURNING TWO TABLES, so both reads land in one transaction and the
 * `account_id` a purchase reports is the account that existed when the purchase
 * was read.
 */
export interface CatalogScopedReads {
  purchasesOf(identityId: string): Promise<PurchaseSnapshot>;
}

/** Both doors, held apart. */
export interface CatalogReads {
  readonly firm: CatalogFirmReads;
  readonly scoped: CatalogScopedReads;
}

// -----------------------------------------------------------------------------
// Failures
// -----------------------------------------------------------------------------

/**
 * Raised when this deployment has not been wired to a database.
 *
 * A 503 and not a 404: "this deployment does not serve that yet" is true, and
 * "no such plan" would be a lie about a catalogue nobody looked in.
 */
export class CatalogUnwired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogUnwired';
  }
}

/**
 * Raised when the rows read cannot be rendered into the contract's shape.
 *
 * EVERY CASE IS A DEFECT RATHER THAN A REQUEST THE CALLER GOT WRONG, so every
 * one becomes a 500 through `server.ts`'s error handler. A caller can cause none
 * of them: the two public routes take a path segment and the third takes a
 * cursor, and each is validated before any row is read.
 */
export class CatalogRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogRowError';
  }
}

/** Raised when a value on the money path is not integer cents. */
export class CatalogMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogMoneyError';
  }
}

// -----------------------------------------------------------------------------
// The wiring, on `public-methods.ts`' shape
// -----------------------------------------------------------------------------
// ADR-100 rule 1 makes a module's whole contribution the object it default
// exports and `compose` hands a handler nothing but the request, so a dependency
// cannot be supplied at composition time without the module being RUN at
// composition time. It lives beside the module and the handler reads it at
// REQUEST time, so wiring order cannot capture the unset value.

let reads: CatalogReads | null = null;

/** Wire the reads, or pass `null` to unwire. The unwire arm is the suite's. */
export function useCatalogReads(next: CatalogReads | null): void {
  reads = next;
}

/** What is wired, or `null`. */
export function currentCatalogReads(): CatalogReads | null {
  return reads;
}

function wired(): CatalogReads {
  if (reads === null)
    throw new CatalogUnwired(
      'no catalog reads are wired, so this deployment cannot serve the plan catalogue or a ' +
        'purchase list. `start.ts` is the wiring slice and installs the database-backed reads; a ' +
        'process that never ran it holds none',
    );
  return reads;
}

// -----------------------------------------------------------------------------
// Money at the boundary. One direction, and it refuses rather than rounds
// -----------------------------------------------------------------------------

/**
 * `bigint` cents to a JSON integer.
 *
 * IT THROWS PAST `Number.MAX_SAFE_INTEGER` RATHER THAN SERIALISING A WRONG
 * NUMBER. The columns are `bigint`, so a value that cannot be a JSON integer is
 * expressible in the schema; at 2^53 cents that is ninety trillion dollars and
 * will not happen, which is a reason to assert it cheaply rather than skip it.
 * API_CONTRACT section 1: "`*_cents` are JSON integers. No floats."
 */
export function centsToJson(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new CatalogMoneyError(
      `${value.toString()} cents cannot be a JSON integer; API_CONTRACT section 1 says ` +
        '*_cents are JSON integers',
    );
  return Number(value);
}

// -----------------------------------------------------------------------------
// The wire shapes, section 4 and section 5 field for field
// -----------------------------------------------------------------------------

/**
 * Section 4's `sizes[]` member.
 *
 * API_CONTRACT NAMES A TYPE `PlanSize` AT SECTION 4's SECOND ROW AND DECLARES IT
 * NOWHERE, so the two rows' size shapes are one shape here. That is the reading
 * the document supports -- both are `plan_version_sizes` rendered -- and it is
 * recorded because a reader looking for `PlanSize` will not find it.
 */
export interface PlanSizeView {
  readonly size_cents: number;
  readonly price_cents: number;
  readonly reset_price_cents: number;
  readonly drawdown_cents: number;
  readonly profit_target_cents: number | null;
  readonly buffer_cents: number;
  readonly win_day_floor_cents: number;
  /** The first rung of `payout_cap_schedule_cents`. See this file's header. */
  readonly payout_cap_cents: number;
  /** `rules.phase_funded.min_payout_cents`, a per-VERSION value. */
  readonly min_payout_cents: number;
}

/** Section 4's `PlansResponse.data[]`. */
export interface PlanListItem {
  readonly plan_id: string;
  readonly code: PlanCode;
  readonly name: string;
  readonly current_version: { readonly plan_version_id: string; readonly version: number };
  readonly sizes: readonly PlanSizeView[];
}

/**
 * Section 4's `PlansResponse`.
 *
 * `data` AND NO `next_cursor`. Section 1's cursor convention governs LISTS that
 * grow; the catalogue is three rows and the contract's own shape declares no
 * cursor member, so none is invented.
 */
export interface PlansResponse {
  readonly data: readonly PlanListItem[];
}

/** Section 4's `PlanVersionResponse`. */
export interface PlanVersionResponse {
  readonly plan_version_id: string;
  readonly plan_id: string;
  readonly version: number;
  readonly status: PublishedVersionStatus;
  readonly published_at: string;
  readonly retired_at: string | null;
  /** The exact stored JSON. DATA_MODEL section 11. */
  readonly rules: unknown;
  readonly copy_blocks: Readonly<Record<string, string>>;
  readonly sizes: readonly PlanSizeView[];
}

/** Section 5's `PurchaseListItem`. */
export interface PurchaseListItem {
  readonly purchase_id: string;
  readonly created_at: string;
  readonly kind: PurchaseKind;
  readonly plan: { readonly plan_id: string; readonly code: string; readonly version: number };
  readonly size_cents: number;
  readonly amount_paid_cents: number;
  readonly discount_cents: number;
  readonly status: PurchaseStatus;
  readonly account_id: string | null;
}

/** Section 1's cursor envelope, which section 5's row inherits. */
export interface PurchaseListResponse {
  readonly data: readonly PurchaseListItem[];
  readonly next_cursor: string | null;
}

// -----------------------------------------------------------------------------
// Pure rendering. Exported so the suite asserts the refusals directly
// -----------------------------------------------------------------------------

function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value);
}

function isPurchaseStatus(value: string): value is PurchaseStatus {
  return (PURCHASE_STATUSES as readonly string[]).includes(value);
}

function isPurchaseKind(value: string): value is PurchaseKind {
  return (PURCHASE_KINDS as readonly string[]).includes(value);
}

/**
 * `rules.phase_funded.min_payout_cents`, read rather than assumed.
 *
 * `rules` is `jsonb NOT NULL` and this file is handed it as `unknown`, so every
 * hop is checked. A version whose rules do not carry the key is a version
 * `validatePlan` would have refused at publish (`CV`-series, `packages/rules-
 * engine`), which is why the absence is a 500 here rather than a `null` on the
 * wire: the field is not optional in section 4's shape and there is no honest
 * value to put in it.
 */
export function minPayoutCentsOf(rules: unknown, planVersionId: string): number {
  const root = rules as { phase_funded?: { min_payout_cents?: unknown } } | null;
  const value = root?.phase_funded?.min_payout_cents;
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new CatalogRowError(
      `plan version ${planVersionId} carries no integer \`rules.phase_funded.min_payout_cents\`. ` +
        'API_CONTRACT section 4 declares `min_payout_cents` on every size and DATA_MODEL section ' +
        '11 puts the value there, so a version without one cannot be rendered as a price',
    );
  return value;
}

/**
 * The cap at the first payout, out of the materialized schedule.
 *
 * IT REFUSES A SCHEDULE WHOSE FIRST RUNG IS NOT ORDINAL 1 rather than reporting
 * rung two as "the cap". `CV-09` requires the first `from_ordinal` to be 1 and
 * the ordinals to increase strictly, so on a validated plan this refusal never
 * fires; it exists because the array is jsonb and jsonb order survives a round
 * trip only as well as whoever wrote it, so the rung is SELECTED by ordinal
 * here and never taken by position.
 */
export function capAtFirstOrdinal(
  schedule: readonly CapScheduleStep[],
  planVersionId: string,
  sizeCents: bigint,
): bigint {
  let lowest: CapScheduleStep | null = null;
  for (const step of schedule)
    if (lowest === null || step.from_ordinal < lowest.from_ordinal) lowest = step;
  if (lowest === null || lowest.from_ordinal !== 1)
    throw new CatalogRowError(
      `plan version ${planVersionId} at size ${sizeCents.toString()} has a ` +
        '`payout_cap_schedule_cents` whose lowest `from_ordinal` is ' +
        `${lowest === null ? 'absent (the schedule is empty)' : String(lowest.from_ordinal)}. ` +
        'CV-09 requires the schedule to start at ordinal 1, and API_CONTRACT section 4 flattens ' +
        'it to one `payout_cap_cents`, so a schedule that does not start there has no first cap ' +
        'to publish',
    );
  return lowest.cap_cents;
}

/** One size row, rendered. The two derived fields carry their own refusals. */
function renderSize(size: PlanVersionSizeRow, minPayoutCents: number): PlanSizeView {
  return {
    size_cents: centsToJson(size.size_cents),
    price_cents: centsToJson(size.price_cents),
    reset_price_cents: centsToJson(size.reset_price_cents),
    drawdown_cents: centsToJson(size.drawdown_cents),
    profit_target_cents:
      size.profit_target_cents === null ? null : centsToJson(size.profit_target_cents),
    buffer_cents: centsToJson(size.buffer_cents),
    win_day_floor_cents: centsToJson(size.win_day_floor_cents),
    payout_cap_cents: centsToJson(
      capAtFirstOrdinal(size.payout_cap_schedule_cents, size.plan_version_id, size.size_cents),
    ),
    min_payout_cents: minPayoutCents,
  };
}

/** Sizes of one version, ascending by `size_cents`, which is how a grid reads. */
function renderSizes(
  version: PlanVersionRow,
  sizes: readonly PlanVersionSizeRow[],
): PlanSizeView[] {
  const minPayoutCents = minPayoutCentsOf(version.rules, version.id);
  return [...sizes]
    .filter((size) => size.plan_version_id === version.id)
    .sort((a, b) => (a.size_cents < b.size_cents ? -1 : a.size_cents > b.size_cents ? 1 : 0))
    .map((size) => renderSize(size, minPayoutCents));
}

/**
 * Section 4's list, out of one firm snapshot.
 *
 * `current_version` IS THE ON-SALE VERSION AND IS NOT THE HIGHEST NUMBER.
 * `SD-M9-01` states the distinction in `0004`'s own words: "A version can be
 * published-for-engine while not yet being the one on sale. Two different facts,
 * and one boolean cannot hold both." `public_visible` is the second fact and
 * `plan_versions_visible_implies_published` makes it imply the first, so it is
 * read here and `status` is not.
 *
 * TWO VISIBLE VERSIONS ON ONE PLAN IS A REFUSAL AND NOT A CHOICE, and the
 * refusal is load bearing in a way `public-methods.ts`' sibling is not.
 * `statistic_definitions_live_uq` is a partial UNIQUE index, so a second live
 * definition is a row the database rejects. `plan_versions_on_sale_idx` is a
 * partial PLAIN index whose comment reads "the one version on sale per plan",
 * and a comment is not a constraint: two visible versions are storable today,
 * and the honest answer to one is a 500 rather than whichever row sorted first
 * at a different price.
 *
 * AN ACTIVE PLAN WITH NO VISIBLE VERSION IS OMITTED, NOT REFUSED. Section 4's
 * `current_version` is not nullable and an active plan whose next version is
 * still a draft is ordinary authoring, so it is left out of the pricing page
 * until it has something to price.
 */
export function renderPlans(snapshot: CatalogueSnapshot): PlansResponse {
  const visibleByPlan = new Map<string, PlanVersionRow>();
  for (const version of snapshot.versions) {
    if (!version.public_visible) continue;
    const held = visibleByPlan.get(version.plan_id);
    if (held !== undefined)
      throw new CatalogRowError(
        `plan ${version.plan_id} has two versions on sale, ${String(held.version)} and ` +
          `${String(version.version)}. \`plan_versions_on_sale_idx\` is a PLAIN partial index ` +
          'rather than a unique one, so the database admits this and the catalogue cannot: two ' +
          'answers to "what does this plan cost" name neither',
      );
    visibleByPlan.set(version.plan_id, version);
  }

  const data: PlanListItem[] = [];
  // `sort_order` is the column `0004` gives this table for exactly this, and
  // `code` breaks a tie so two plans at one sort order do not swap between
  // requests on a cacheable read.
  const ordered = [...snapshot.plans].sort(
    (a, b) => a.sort_order - b.sort_order || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  for (const plan of ordered) {
    if (!plan.is_active) continue;
    const version = visibleByPlan.get(plan.id);
    if (version === undefined) continue;
    if (!isPlanCode(plan.code))
      throw new CatalogRowError(
        `plan ${plan.id} carries code \`${plan.code}\`, which API_CONTRACT section 4 does not ` +
          `declare. The contract's set is ${PLAN_CODES.join(' | ')} and \`plans.code\` carries ` +
          'no CHECK to hold it, so this row is storable and unpublishable',
      );
    data.push({
      plan_id: plan.id,
      code: plan.code,
      name: plan.name,
      current_version: { plan_version_id: version.id, version: version.version },
      sizes: renderSizes(version, snapshot.sizes),
    });
  }
  return { data };
}

/**
 * Section 4's second row, out of one version and its grid.
 *
 * THE ALLOWLIST IS THE CONTROL AND THIS FUNCTION IS THE ALLOWLIST. `public_slug`,
 * `created_by`, `fee_back_repeats`, `decided_on_simulation_run_id` and
 * `simulation_waiver_reason` are all columns of the row this reads and none of
 * them is section 4's, so none of them travels. See this file's header on why
 * the last of those is the one that matters.
 */
export function renderPlanVersion(snapshot: VersionSnapshot): PlanVersionResponse {
  const version = snapshot.version;
  if (!(PUBLISHED_VERSION_STATUSES as readonly string[]).includes(version.status))
    throw new CatalogRowError(
      `plan version ${version.id} has status \`${version.status}\`, which is not one of ` +
        `${PUBLISHED_VERSION_STATUSES.join(' | ')}. A draft is refused before this point; ` +
        'reaching here means the status vocabulary moved',
    );
  // `plan_versions_published_has_timestamp` pins this for `published` and
  // `plan_versions_retired_has_timestamp` pins only `retired_at` for `retired`,
  // so the two CHECKs together do NOT make a retired row's `published_at`
  // non-null: a draft retired without ever being published is storable. Section
  // 4 declares `published_at: string` with no null, and a version nobody was
  // ever sold has no publication date to report.
  if (version.published_at === null)
    throw new CatalogRowError(
      `plan version ${version.id} is \`${version.status}\` and carries no \`published_at\`. ` +
        '`plan_versions_retired_has_timestamp` constrains only `retired_at`, so a version ' +
        'retired out of draft is storable, and API_CONTRACT section 4 has no shape for one',
    );
  return {
    plan_version_id: version.id,
    plan_id: version.plan_id,
    version: version.version,
    status: version.status as PublishedVersionStatus,
    published_at: version.published_at,
    retired_at: version.retired_at,
    rules: version.rules,
    copy_blocks: version.copy_blocks,
    sizes: renderSizes(version, snapshot.sizes),
  };
}

// -----------------------------------------------------------------------------
// The cursor. Section 1: "Cursor only, never offset"
// -----------------------------------------------------------------------------

/** Section 1: "`limit` maximum 100, default 25." */
export const PURCHASES_DEFAULT_LIMIT = 25;

/** Section 1's ceiling. */
export const PURCHASES_MAX_LIMIT = 100;

/**
 * One page's position, which is a ROW and never an offset.
 *
 * BOTH HALVES, BECAUSE `created_at` IS NOT A TOTAL ORDER. Two purchases can
 * share a timestamp -- a reset and a new purchase in one second is ordinary --
 * and a cursor on the timestamp alone either repeats a row across pages or skips
 * one. `purchases.id` is the primary key, so the pair is total.
 */
export interface PurchaseCursor {
  readonly created_at: string;
  readonly purchase_id: string;
}

/**
 * The cursor as the wire carries it: opaque, which section 1 requires.
 *
 * base64url of `created_at|purchase_id`. OPAQUE IS A PROMISE ABOUT THE CLIENT
 * AND NOT ABOUT AN ATTACKER: a decoded cursor names a purchase id, and naming
 * one buys nothing, because the read it seeks into is scoped to the caller's
 * identity by the accessor before this file sees a row. It is encoded so that a
 * client cannot come to depend on the shape, which is the reason section 1 gives.
 */
export function encodeCursor(cursor: PurchaseCursor): string {
  return Buffer.from(`${cursor.created_at}|${cursor.purchase_id}`, 'utf8').toString('base64url');
}

/** The inverse, or `null` for anything that is not one. */
export function decodeCursor(raw: string): PurchaseCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const split = decoded.lastIndexOf('|');
  if (split <= 0 || split === decoded.length - 1) return null;
  return { created_at: decoded.slice(0, split), purchase_id: decoded.slice(split + 1) };
}

/** A validated `?limit=&cursor=` pair. */
export interface PurchaseQuery {
  readonly limit: number;
  readonly cursor: PurchaseCursor | null;
}

type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * Section 1's query, validated total.
 *
 * A BAD CURSOR IS A `validation_failed` AND NOT AN EMPTY PAGE. An empty page for
 * a cursor the server cannot read is a list that silently ends early, and the
 * client cannot tell that from having reached the end.
 */
export function validatePurchaseQuery(query: unknown): Validated<PurchaseQuery> {
  const row: Record<string, unknown> =
    typeof query === 'object' && query !== null && !Array.isArray(query)
      ? (query as Record<string, unknown>)
      : {};
  const errors: FieldError[] = [];

  let limit = PURCHASES_DEFAULT_LIMIT;
  const rawLimit = row['limit'];
  if (rawLimit !== undefined) {
    // Fastify hands a query string over as a string; the contract writes it as
    // an integer, so the parse is here and it refuses anything that is not one.
    const parsed =
      typeof rawLimit === 'string' && /^[0-9]+$/.test(rawLimit) ? Number(rawLimit) : -1;
    if (parsed < 1 || parsed > PURCHASES_MAX_LIMIT)
      errors.push({
        path: 'limit',
        message: `must be an integer between 1 and ${String(PURCHASES_MAX_LIMIT)}`,
      });
    else limit = parsed;
  }

  let cursor: PurchaseCursor | null = null;
  const rawCursor = row['cursor'];
  if (rawCursor !== undefined) {
    const parsed = typeof rawCursor === 'string' ? decodeCursor(rawCursor) : null;
    if (parsed === null)
      errors.push({ path: 'cursor', message: 'is not a cursor this endpoint issued' });
    else cursor = parsed;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { limit, cursor } };
}

/**
 * Newest first, which is the order a purchase history reads in.
 *
 * DESCENDING ON BOTH KEYS, so the cursor's "strictly after" is one comparison
 * rather than two rules. `created_at` is an RFC 3339 UTC string, so lexical
 * order is chronological order for as long as every row carries the same
 * precision and offset; `timestamptz` rendered by one code path does.
 */
function newestFirst(a: PurchaseRow, b: PurchaseRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isAfter(row: PurchaseRow, cursor: PurchaseCursor): boolean {
  if (row.created_at !== cursor.created_at) return row.created_at < cursor.created_at;
  return row.id < cursor.purchase_id;
}

/**
 * Section 5's page.
 *
 * THE PAGING IS IN MEMORY AND THE HEADER SAYS WHY. Every row handed here is
 * already this identity's: the accessor applied `scopePredicate` before the
 * handler saw one, so nothing below is a tenancy control and nothing below can
 * become one by accident.
 *
 * `pins` IS A LOOKUP AND NEVER A FILTER. A purchase whose plan version is not in
 * it is a dangling `plan_version_id` against a `NOT NULL REFERENCES
 * plan_versions(id) ON DELETE RESTRICT`, so it is a defect rather than a row to
 * drop: dropping it would shorten a person's purchase history without saying so.
 */
export function renderPurchases(
  snapshot: PurchaseSnapshot,
  pins: readonly PlanPin[],
  query: PurchaseQuery,
): PurchaseListResponse {
  const accountByPurchase = new Map<string, string>();
  for (const account of snapshot.accounts) {
    // `accounts_purchase_id_unique` makes this single valued in the database.
    // Checked anyway, because the source is an interface rather than the schema.
    const held = accountByPurchase.get(account.purchase_id);
    if (held !== undefined && held !== account.id)
      throw new CatalogRowError(
        `purchase ${account.purchase_id} has two accounts, ${held} and ${account.id}. ` +
          '`accounts.purchase_id` is `NOT NULL UNIQUE`, so this row set contradicts its own table',
      );
    accountByPurchase.set(account.purchase_id, account.id);
  }

  const pinByVersion = new Map<string, PlanPin>();
  for (const pin of pins) pinByVersion.set(pin.plan_version_id, pin);

  const ordered = [...snapshot.purchases].sort(newestFirst);
  const cursor = query.cursor;
  const from = cursor === null ? ordered : ordered.filter((row) => isAfter(row, cursor));
  // One past the page, so "is there more" is a fact rather than a guess. A
  // `next_cursor` on a page that turns out to be the last one makes a client
  // fetch an empty page to discover it, and section 1 gives it no other signal.
  const page = from.slice(0, query.limit);
  const more = from.length > page.length;

  const data: PurchaseListItem[] = page.map((row) => {
    const pin = pinByVersion.get(row.plan_version_id);
    if (pin === undefined)
      throw new CatalogRowError(
        `purchase ${row.id} names plan version ${row.plan_version_id}, which the catalogue read ` +
          'did not return. `purchases.plan_version_id` is `NOT NULL REFERENCES plan_versions(id) ' +
          'ON DELETE RESTRICT`, so the version cannot be gone and the two reads disagree',
      );
    if (!isPurchaseKind(row.kind))
      throw new CatalogRowError(
        `purchase ${row.id} has kind \`${row.kind}\`, which \`purchases_reset_has_parent\` and ` +
          "the column's own CHECK close at new | reset",
      );
    if (!isPurchaseStatus(row.status))
      throw new CatalogRowError(
        `purchase ${row.id} has status \`${row.status}\`, which is not a \`purchase_status\` ` +
          `member. The enum is ${PURCHASE_STATUSES.join(' | ')}`,
      );
    return {
      purchase_id: row.id,
      created_at: row.created_at,
      kind: row.kind,
      plan: { plan_id: pin.plan_id, code: pin.code, version: pin.version },
      size_cents: centsToJson(row.size_cents),
      amount_paid_cents: centsToJson(row.amount_paid_cents),
      discount_cents: centsToJson(row.discount_cents),
      status: row.status,
      account_id: accountByPurchase.get(row.id) ?? null,
    };
  });

  const last = page.at(-1);
  return {
    data,
    next_cursor:
      more && last !== undefined
        ? encodeCursor({ created_at: last.created_at, purchase_id: last.id })
        : null,
  };
}

// -----------------------------------------------------------------------------
// The handlers
// -----------------------------------------------------------------------------

// `problemNotFound` comes from `auth.ts`, which its own comment says owns the
// problem-document helpers for this deployable. It is a function and two type
// imports, and `auth.ts` pulls in nothing heavier than `registry.ts` and
// `server.ts`, so the public read's module graph stays where the header put it.

/**
 * `GET /plans`. Auth: none, cacheable (60s).
 *
 * A BARE HANDLER RATHER THAN AN `EndpointSpec`, for the reason this file's
 * header gives: `endpointHandler` resolves a session before it reads the
 * declared factor, and this route has no use for one.
 */
export const plansHandler: RouteHandler = async (_request, _reply) => {
  return renderPlans(await wired().firm.catalogue());
};

/** The `:version` segment, which is an integer and is refused as anything else. */
function versionParam(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const parsed = Number(raw);
  // `plan_versions.version` is `integer NOT NULL CHECK (version > 0)`, so a
  // value past int4 cannot name a row and handing it to the accessor would
  // render a query Postgres refuses with a 500 where a 404 is the honest answer.
  return Number.isSafeInteger(parsed) && parsed <= 2147483647 ? parsed : null;
}

/**
 * `GET /plans/:planId/versions/:version`. Auth: none. Errors: `not_found`.
 *
 * RETIRED VERSIONS ARE SERVED, which is section 4's stated purpose: "including
 * for retired versions, so a trader can always retrieve the contract they
 * bought." A DRAFT is not, and `renderPlanVersion`'s vocabulary is where that
 * lands.
 */
export const planVersionHandler: RouteHandler = async (request, reply) => {
  const params = request.params as { planId?: unknown; version?: unknown };
  const planId = typeof params.planId === 'string' ? params.planId : '';
  const version = versionParam(params.version);
  if (planId === '' || version === null) return problemNotFound(reply, request.id);

  const found = await wired().firm.versionAt(planId, version);
  // A DRAFT ANSWERS 404 AND NOT 403. There is nobody whose draft this could be,
  // so there is nothing to be ambiguous about: the address names no published
  // contract, which is what `not_found` says on a public registry.
  if (found === null || found.version.status === 'draft') return problemNotFound(reply, request.id);
  return renderPlanVersion(found);
};

/**
 * `GET /purchases`. Auth: session.
 *
 * THE ORDER OF THE TWO DOORS IS THE CONTROL AND IT IS THE ONLY ONE. The scoped
 * read runs first, its rows name the versions, and the firm read is asked about
 * exactly those. Reversing it compiles.
 *
 * THE IDENTITY IS THE ONE `endpointHandler` RESOLVED FROM THE SESSION COOKIE and
 * is never read off the request. There is no path parameter and no query
 * parameter naming an identity on this route, so there is nothing here for a
 * caller to point at somebody else.
 */
export const CATALOG_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: PURCHASES_PATH,
    required: 'session',
    handle: withSessionContext(async ({ request, reply, session }) => {
      const query = validatePurchaseQuery(request.query);
      if (!query.ok)
        return reply
          .code(400)
          .type(PROBLEM_MEDIA_TYPE)
          .send({ ...problem('validation_failed', 400, request.id), errors: query.errors });

      const source = wired();
      const snapshot = await source.scoped.purchasesOf(session.identityId);

      // DISTINCT, AND OFF THE SCOPED ROWS. The set handed across the crossing is
      // derived from what this identity bought and from nothing else.
      const versionIds = [...new Set(snapshot.purchases.map((row) => row.plan_version_id))];
      const pins = versionIds.length === 0 ? [] : await source.firm.plansOfVersions(versionIds);

      return renderPurchases(snapshot, pins, query.value);
    }),
  },
];

/** The declaration as data, on `auth.ts`'s shape. */
export const CATALOG_REQUIRED_FACTORS = requiredFactorTable(CATALOG_ENDPOINTS);

// -----------------------------------------------------------------------------
// The database-backed reads
// -----------------------------------------------------------------------------
// Both halves live here rather than in a sibling `catalog-backend.ts`, because
// this slice's fence is one route file: `auth-backend.ts` is the shape a wider
// fence produces and it is not a rule.

/** `TableKey`s, as plain strings the accessor's own key types check. */
const PLANS = 'plans';
const PLAN_VERSIONS = 'planVersions';
const PLAN_VERSION_SIZES = 'planVersionSizes';
const PURCHASES = 'purchases';
const ACCOUNTS = 'accounts';

function asRow(value: unknown, table: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CatalogRowError(`a ${table} read returned something that is not a row`);
  return value as Record<string, unknown>;
}

function str(row: Record<string, unknown>, key: string, table: string): string {
  const value = row[key];
  if (typeof value !== 'string')
    throw new CatalogRowError(`${table}.${key} did not read back as a string`);
  return value;
}

function bool(row: Record<string, unknown>, key: string, table: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean')
    throw new CatalogRowError(`${table}.${key} did not read back as a boolean`);
  return value;
}

function int(row: Record<string, unknown>, key: string, table: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new CatalogRowError(`${table}.${key} did not read back as an integer`);
  return value;
}

/**
 * A `bigint` money column, and it accepts NOTHING ELSE.
 *
 * `schema.ts` declares every one of these `{ mode: 'bigint' }`, so a `number`
 * arriving here means the transcription changed and the value has already been
 * through a float. INV-02 is "all money is `bigint` integer cents AT EVERY
 * BOUNDARY", and coercing quietly is how a boundary stops being one.
 */
function cents(row: Record<string, unknown>, key: string, table: string): bigint {
  const value = row[key];
  if (typeof value !== 'bigint')
    throw new CatalogRowError(
      `${table}.${key} did not read back as a bigint. Money is integer cents at every boundary ` +
        'and a money column that arrives as anything else has already lost precision somewhere',
    );
  return value;
}

function maybeCents(row: Record<string, unknown>, key: string, table: string): bigint | null {
  return row[key] === null || row[key] === undefined ? null : cents(row, key, table);
}

/** A `timestamptz` as section 1's RFC 3339 UTC string. */
function instant(row: Record<string, unknown>, key: string, table: string): string {
  const value = row[key];
  if (!(value instanceof Date))
    throw new CatalogRowError(`${table}.${key} did not read back as a timestamp`);
  return value.toISOString();
}

function maybeInstant(row: Record<string, unknown>, key: string, table: string): string | null {
  return row[key] === null || row[key] === undefined ? null : instant(row, key, table);
}

function readPlan(raw: unknown): PlanRow {
  const row = asRow(raw, PLANS);
  return {
    id: str(row, 'id', PLANS),
    code: str(row, 'code', PLANS),
    name: str(row, 'name', PLANS),
    is_active: bool(row, 'isActive', PLANS),
    sort_order: int(row, 'sortOrder', PLANS),
  };
}

function readPlanVersion(raw: unknown): PlanVersionRow {
  const row = asRow(raw, PLAN_VERSIONS);
  const copy = row['copyBlocks'];
  if (typeof copy !== 'object' || copy === null || Array.isArray(copy))
    throw new CatalogRowError('plan_versions.copy_blocks did not read back as a JSON object');
  return {
    id: str(row, 'id', PLAN_VERSIONS),
    plan_id: str(row, 'planId', PLAN_VERSIONS),
    version: int(row, 'version', PLAN_VERSIONS),
    status: str(row, 'status', PLAN_VERSIONS),
    rules: row['rules'],
    copy_blocks: copy as Readonly<Record<string, string>>,
    public_visible: bool(row, 'publicVisible', PLAN_VERSIONS),
    published_at: maybeInstant(row, 'publishedAt', PLAN_VERSIONS),
    retired_at: maybeInstant(row, 'retiredAt', PLAN_VERSIONS),
  };
}

/**
 * The materialized cap schedule, read step by step.
 *
 * `cap_cents` ARRIVES AS A JSON NUMBER AND NOT AS A `bigint`, because it lives
 * inside `jsonb` rather than in a `bigint` column, and JSON has one number type.
 * That is a real narrowing of INV-02 and it is the schema's rather than this
 * file's: it is checked for integrality here and converted once, which is the
 * most a reader can do about a value the database stored as a double.
 */
function readCapSchedule(raw: unknown, planVersionId: string): readonly CapScheduleStep[] {
  if (!Array.isArray(raw))
    throw new CatalogRowError(
      `plan version ${planVersionId} has a \`payout_cap_schedule_cents\` that is not an array. ` +
        '`0004` declares it "ordered steps keyed by payout ordinal", an array from day one',
    );
  return raw.map((entry): CapScheduleStep => {
    const step = asRow(entry, 'plan_version_sizes.payout_cap_schedule_cents');
    const ordinal = step['from_ordinal'];
    const cap = step['cap_cents'];
    if (typeof ordinal !== 'number' || !Number.isInteger(ordinal))
      throw new CatalogRowError(
        `plan version ${planVersionId} has a cap schedule step with no integer \`from_ordinal\``,
      );
    if (typeof cap !== 'number' || !Number.isInteger(cap))
      throw new CatalogRowError(
        `plan version ${planVersionId} has a cap schedule step whose \`cap_cents\` is not an ` +
          'integer. Money is integer cents even inside jsonb',
      );
    return { from_ordinal: ordinal, cap_cents: BigInt(cap) };
  });
}

function readSize(raw: unknown): PlanVersionSizeRow {
  const row = asRow(raw, PLAN_VERSION_SIZES);
  const planVersionId = str(row, 'planVersionId', PLAN_VERSION_SIZES);
  return {
    plan_version_id: planVersionId,
    size_cents: cents(row, 'sizeCents', PLAN_VERSION_SIZES),
    price_cents: cents(row, 'priceCents', PLAN_VERSION_SIZES),
    reset_price_cents: cents(row, 'resetPriceCents', PLAN_VERSION_SIZES),
    drawdown_cents: cents(row, 'drawdownCents', PLAN_VERSION_SIZES),
    profit_target_cents: maybeCents(row, 'profitTargetCents', PLAN_VERSION_SIZES),
    buffer_cents: cents(row, 'bufferCents', PLAN_VERSION_SIZES),
    win_day_floor_cents: cents(row, 'winDayFloorCents', PLAN_VERSION_SIZES),
    payout_cap_schedule_cents: readCapSchedule(row['payoutCapScheduleCents'], planVersionId),
  };
}

function readPurchase(raw: unknown): PurchaseRow {
  const row = asRow(raw, PURCHASES);
  return {
    id: str(row, 'id', PURCHASES),
    plan_version_id: str(row, 'planVersionId', PURCHASES),
    created_at: instant(row, 'createdAt', PURCHASES),
    kind: str(row, 'kind', PURCHASES),
    size_cents: cents(row, 'sizeCents', PURCHASES),
    amount_paid_cents: cents(row, 'amountPaidCents', PURCHASES),
    discount_cents: cents(row, 'discountCents', PURCHASES),
    status: str(row, 'status', PURCHASES),
  };
}

function readAccountLink(raw: unknown): AccountLinkRow {
  const row = asRow(raw, ACCOUNTS);
  return { id: str(row, 'id', ACCOUNTS), purchase_id: str(row, 'purchaseId', ACCOUNTS) };
}

/**
 * The reads, over the two doors `db.ts` opens.
 *
 * `rowsWhere` AND NOT `rowAt` FOR `(plan_id, version)`, AND THAT IS A FINDING
 * RATHER THAN A PREFERENCE. `rowAt` calls `refuseUnaddressed`, which reads the
 * unique keys `schema.ts` declares through Drizzle's table config;
 * `plan_versions` declares `id` and NOTHING ELSE there, so
 * `plan_versions_plan_version_uq (plan_id, version)` -- the constraint that
 * makes the pair an address at all -- is one of the 34 keys `scoped-db.ts`
 * measures present in the migrations and absent from the transcription. Passing
 * the pair to `rowAt` throws. `rowsWhere` renders the same predicate without the
 * uniqueness claim, so the arity is checked here instead, once, and refused
 * loudly rather than resolved by whichever row came back first.
 *
 * @param db the two doors. Injected so the suite can watch which one each read
 *           opened and with whose identity, which is the property that is this
 *           package's rather than `packages/db`'s.
 */
export function databaseCatalogReads(db: ApiDb): CatalogReads {
  return {
    firm: {
      catalogue: () =>
        db.firm(async (tx) => {
          const plans = (await tx.rowsWhere(PLANS, { isActive: true })).map(readPlan);
          const versions = (await tx.rowsWhere(PLAN_VERSIONS, { publicVisible: true })).map(
            readPlanVersion,
          );
          const sizes: PlanVersionSizeRow[] = [];
          for (const version of versions)
            for (const raw of await tx.rowsWhere(PLAN_VERSION_SIZES, { planVersionId: version.id }))
              sizes.push(readSize(raw));
          return { plans, versions, sizes };
        }),

      versionAt: (planId, version) =>
        db.firm(async (tx) => {
          const found = (await tx.rowsWhere(PLAN_VERSIONS, { planId, version })).map(
            readPlanVersion,
          );
          if (found.length > 1)
            throw new CatalogRowError(
              `plan ${planId} has ${String(found.length)} rows at version ${String(version)}. ` +
                '`plan_versions_plan_version_uq` makes the pair unique in the database, so the ' +
                'pair is the address of one version and two answers to it name neither',
            );
          const one = found[0];
          if (one === undefined) return null;
          const sizes = (await tx.rowsWhere(PLAN_VERSION_SIZES, { planVersionId: one.id })).map(
            readSize,
          );
          return { version: one, sizes };
        }),

      plansOfVersions: (planVersionIds) =>
        db.firm(async (tx) => {
          const pins: PlanPin[] = [];
          // ONE ADDRESSED READ PER DISTINCT VERSION, because `RowFilter` is
          // "equality, ANDed, and nothing else" and there is no `IN`. The set is
          // the distinct versions ONE PERSON bought under, so it is bounded by
          // the account cap and not by the size of the catalogue.
          for (const planVersionId of planVersionIds) {
            const version = await tx.rowAt(PLAN_VERSIONS, { id: planVersionId });
            if (version === undefined || version === null) continue;
            const parsed = readPlanVersion(version);
            const plan = await tx.rowAt(PLANS, { id: parsed.plan_id });
            if (plan === undefined || plan === null)
              throw new CatalogRowError(
                `plan version ${parsed.id} names plan ${parsed.plan_id}, which does not exist. ` +
                  '`plan_versions.plan_id` is `NOT NULL REFERENCES plans(id) ON DELETE RESTRICT`',
              );
            pins.push({
              plan_version_id: parsed.id,
              plan_id: parsed.plan_id,
              code: readPlan(plan).code,
              version: parsed.version,
            });
          }
          return pins;
        }),
    },

    scoped: {
      // BOTH TABLES IN ONE TRANSACTION, so the account a purchase reports is the
      // account that existed when the purchase was read. Both are `owned` on
      // `identity_id`, so the accessor puts the same tenancy conjunct on each.
      purchasesOf: (identityId) =>
        db.scoped(identityId, async (tx) => ({
          purchases: (await tx.rows(PURCHASES)).map(readPurchase),
          accounts: (await tx.rows(ACCOUNTS)).map(readAccountLink),
        })),
    },
  };
}

// -----------------------------------------------------------------------------
// The module
// -----------------------------------------------------------------------------
// ORDERED BY PATH, which is what makes this file's contribution readable beside
// seven other route slices landing in the same directory. The registry itself is
// a DIRECTORY LISTING (`discoverRouteModules`), so those slices collide on
// nothing: adding a route here is adding a file, and `compose` refuses a
// duplicate `METHOD /path` across the whole set if two of them ever pick one.

export default defineRoutes({
  name: 'catalog',
  routes: [
    { method: 'GET', path: PLANS_PATH, handler: plansHandler },
    { method: 'GET', path: PLAN_VERSION_PATH, handler: planVersionHandler },
    ...toRoutes(CATALOG_ENDPOINTS),
  ],
});
