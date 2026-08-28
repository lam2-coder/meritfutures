// =============================================================================
// apps/portal/src/app/(purchases)/source.ts
// =============================================================================
// WHERE THIS SEGMENT'S DATA COMES FROM, AND ONE OF ITS TWO SCREENS IS NOW A REAL
// REQUEST.
//
// ./fixtures.ts said "THE DATA THESE TWO PAGES RENDER UNTIL THEIR ROUTES EXIST",
// and ADR-162 is the client those routes were waiting for. That entry landed
// ../../http/client.ts, the one file under `apps/portal/src` permitted to call
// `fetch(`, and named exactly this work: "the other five segments are not wired
// here; each is one `load` and one guard." `(purchases)` is the sixth and last.
//
// NOTHING ELSE IN THIS SEGMENT IS RESTRUCTURED. ./model.ts, ./purchases-screen.ts
// and ./certificates-screen.ts already turn a wire shape into a screen and none
// of them is touched: what changed is where their input comes from and what the
// two `page.ts` files do when it does not arrive. ./fixtures.ts stays, because
// the suite renders both screens from it and a fixture read by tests is not a
// fixture served to traffic.
//
// -----------------------------------------------------------------------------
// FIVE ENDPOINTS, AND THE COUNT WAS BUILT RATHER THAN GREPPED
// -----------------------------------------------------------------------------
// `discoverRouteModules()` then `buildServer({ surface, modules })` for `public`
// and `operator`, reading `CompositionReport.registered`, run against this tree:
//
//   GET /purchases                          REGISTERED, public
//   GET /plans/:planId/versions/:version     REGISTERED, public
//   GET /accounts/:accountId/certificate     REGISTERED, public
//   GET /certificates                        REGISTERED, public
//   GET /certificates/:code/image.png        REGISTERED, public
//
// ALL FIVE. This segment's ./ports.ts was written when three of them did not
// exist and its header says so at length; session 297 registered the last two
// and this file is the measurement rather than the dispatch's word for it,
// because a dispatch has been wrong about a registration twice in this
// repository (../accounts/source.ts's header carries both).
//
// REGISTERED IS NOT SERVED, AND THAT DISTINCTION IS THIS FILE'S TO RESPECT AND
// NOT TO ENCODE. `apps/api/src/routes/account-reads.ts`'s `readCertificate`
// rejects with a stated blocker and `apps/api/src/routes/certificates.ts` ships
// `UNWIRED_CERTIFICATE_BACKEND` as its default, so both certificate rows answer
// 503 until a wiring slice installs a backend. A 503 IS A REGISTERED ENDPOINT
// FAILING, which is the `error` arm, and it is NOT `unavailable`: the portal
// learns that from the status line it was given and never from a table of what
// this repository happens to have wired today. A client that special-cased a
// 503 into "waiting on an endpoint" would report every real outage as a screen
// still being built.
//
// -----------------------------------------------------------------------------
// SC-M4-06 IS WIRED END TO END. SC-M4-08 IS WIRED AS FAR AS IT GOES
// -----------------------------------------------------------------------------
// The purchases screen reads `GET /purchases` and one `GET /plans/:planId/
// versions/:version` per side of each rule diff, and reaches `ready`.
//
// The certificates screen needs a LIST OF REQUESTS -- one account id and one
// kind per card -- and this segment has no wire source for one. Both halves of
// that were already written down before this session:
//
//   ./fixtures.ts, on `CERTIFICATE_REQUESTS`: "The accounts a trader holds are
//   `GET /accounts`, which is SC-M4-02's read and session 259's segment; asking
//   for it here would be this page reaching into that one."
//
//   ./ports.ts, on the list endpoint M11 wrote so that this screen would not
//   need account ids at all: "the day a handler exists, this port gains a method
//   and the assembly above is what it replaces."
//
// THE HANDLER NOW EXISTS AND THE PORTAL STILL CANNOT READ IT, for a reason that
// is somebody else's file rather than a gap in this one. `GET /certificates`
// answers section 6.3's `CertificateListResponse`, whose item carries `state`,
// `code`, `deferred` and `revoked`; ../../api/types.ts transcribes
// `CertificateResponse` and no list item, and ./model.ts and ../../view/
// certificates.ts consume the singular row's shape. Reading the list means a
// transcription in the contract's file and a second shape through two rendering
// files, which is a restructuring of this segment rather than a `load` and a
// guard. It is REPORTED, with the read named, rather than half-built here.
//
// So `loadCertificates()` passes `requests: null`, which is ../accounts/
// source.ts's `marks` and ../referrals/data.ts's `disclosureText` exactly: a
// MEASUREMENT and not a placeholder, and the shape that makes landing the read
// a guard and a call rather than a rewrite. `loadCertificatesFrom` is exported
// so the wired path runs today, through the real client, in
// `apps/portal/test/purchases-source.test.ts`.
//
// -----------------------------------------------------------------------------
// THE `.png` ROW IS REGISTERED AND THIS SEGMENT DOES NOT CALL IT. TWO REASONS,
// AND EITHER ALONE IS ENOUGH
// -----------------------------------------------------------------------------
// ADR-168 clause 2 admitted `GET /certificates/:code/image.png` and its finding
// 5 says why the extension is in the path. It is API_CONTRACT section 1's first
// non-JSON success response, and section 1's conventions presume a JSON body.
//
//   ONE. THIS SCREEN HAS NO `code` TO ASK WITH. The row is served off
//   `certificates.code`, and `CertificateResponse` does not carry it --
//   ./model.ts states that in the field comment on `image_url` and it is still
//   true. The image this screen renders is the response's own signed,
//   time-limited `image_url`.
//
//   TWO. ../../http/client.ts CANNOT READ IT AND MUST NOT BE TAUGHT TO HERE.
//   `get` performs `await response.json()` on every 2xx and maps a body that is
//   not JSON to `server_error` (ADR-162 clause 3). So a PNG fetched through this
//   client is an error, correctly, and the repair is a second method on a file
//   ADR-162 owns and this fence does not hold. THE TEST ASSERTS THAT DIRECTION
//   rather than leaving it as a claim: a 200 carrying image bytes comes back
//   `server_error`.
//
// -----------------------------------------------------------------------------
// THE PAGE THIS SCREEN READS, AND THE HALF OF SESSION 289'S DECISION IT CANNOT
// KEEP
// -----------------------------------------------------------------------------
// `GET /purchases` is a cursor list. `app/calendar/load.ts` took the paging
// decision for this application and it is three parts: ONE page rather than
// following the cursor to exhaustion, the CONTRACT'S MAXIMUM as the limit, and
// THE SCREEN SAYS WHICH IT GOT. The first two are kept here and are argued at
// {@link PURCHASES_PAGE_LIMIT}.
//
// THE THIRD IS NOT KEPT AND IT IS REPORTED RATHER THAN QUIETLY DROPPED.
// `PurchaseHistoryView` has no truncation field and `PurchasesScreen` has no
// prop for one, so a trader holding more purchases than one page renders a
// history that does not say it is a page. That is an omission that reads as a
// positive claim, which is the failure ../../view/purchases.ts names as the
// worst available on this screen, and the repair is a required prop on
// ./purchases-screen.ts and a field on ./model.ts -- both of which this fence
// holds as READ-ONLY. It is reported in the pull request, on ADR-162 section 5
// item 1's own precedent for the payout centre's missing error arm.
//
// WHAT THE SCREEN DOES SAY IS THE HALF THAT MATTERS MOST, AND IT WAS ALREADY
// THERE. ./model.ts renders a reset whose earlier purchase is not on the page as
// `unpairable`, in its own words: "A cursor list has a second page, so the
// earlier purchase is legitimately absent, and a diff panel that rendered
// nothing there would say 'your terms did not change' about a comparison it
// never made."

import { PAGE_LIMIT_MAX } from '../../api/types.ts';
import type {
  CertificateResponse,
  CursorPage,
  JsonValue,
  PlanVersionResponse,
  PurchaseListItem,
} from '../../api/types.ts';
import type { ApiClient, ApiResult } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';
import type { CertificatesPageModel, PurchasesPageModel } from './model.ts';
import { certificatesPageModel, purchasesPageModel } from './model.ts';
import type { CertificateRequest, PurchasesSegmentPorts } from './ports.ts';

// -----------------------------------------------------------------------------
// The paths, as API_CONTRACT spells them
// -----------------------------------------------------------------------------
// NO BASE PATH ANYWHERE BELOW. ../../http/client.ts appends `/api/v1` and its
// header calls that "one string in one file"; a segment that spelled it here
// would be a third copy of `apps/api/src/surface.ts`'s `BASE_PATH` that nothing
// asserts against. Every string below is asserted against the handler that
// serves it in `apps/portal/test/purchases-source.test.ts`, which is the
// treatment ADR-162 gives `API_BASE_PATH` and `SESSION_COOKIE` and the treatment
// ../referrals/data.ts and ../kyc/source.ts give their own paths.

/** `GET /purchases`. API_CONTRACT section 5, the caller's own purchases. */
export const PURCHASES_PATH = '/purchases';

/**
 * ONE PAGE, AT THE CONTRACT'S MAXIMUM.
 *
 * `app/calendar/load.ts` took this decision for this application and its
 * argument transfers whole: following the cursor to exhaustion is unbounded
 * round trips inside one server render, every one of them uncached by ADR-162
 * clause 4, on a list that grows for the life of an account.
 *
 * THE MAXIMUM RATHER THAN THE DEFAULT, AND THE ARGUMENT IS STRONGER HERE THAN
 * IT WAS THERE. That file's reason was that "the cost of a bigger page is one
 * response and the cost of a smaller one is a truncation statement on a screen
 * that did not need one". This screen cannot make a truncation statement at all
 * (see the header), so the page size is the only thing standing between a
 * trader and a silently short history, and 25 would put four times as many
 * traders behind it as 100 does.
 *
 * `PAGE_LIMIT_MAX` IS IMPORTED AND NOT SPELLED. Section 1's "`limit` maximum
 * 100" is transcribed once in ../../api/types.ts and `apps/api/src/routes/
 * catalog.ts` declares `PURCHASES_MAX_LIMIT` from the same sentence; a literal
 * here would be a third copy, and a limit above the maximum is a
 * `validation_failed` rather than a clamp.
 */
export const PURCHASES_PAGE_LIMIT = PAGE_LIMIT_MAX;

/** `GET /purchases?limit=`, section 1's query. No cursor is ever sent. */
export function purchasesPagePath(limit: number): string {
  return `${PURCHASES_PATH}?limit=${String(limit)}`;
}

/**
 * `GET /plans/:planId/versions/:version`.
 *
 * `version` IS A NUMBER FROM A GUARDED RESPONSE rather than a string from a
 * URL, so it is stringified rather than encoded: {@link isPurchaseListItem}
 * refuses a `plan.version` that is not an integer, so there is no separator
 * this template can be handed. The plan id is a server-issued string and IS
 * encoded, because a value carrying `/`, `?` or `#` would reshape the path and
 * read an endpoint nobody asked for. That is ../accounts/source.ts's rule and
 * it is the same rule here.
 */
export function planVersionPath(plan_id: string, version: number): string {
  return `/plans/${encodeURIComponent(plan_id)}/versions/${String(version)}`;
}

/**
 * `GET /accounts/:accountId/certificate?kind=pass|payout`.
 *
 * THE `kind` IS REQUIRED AND HAS NO DEFAULT. `apps/api/src/routes/
 * account-reads.ts` answers `validation_failed` for an absent one, on the
 * ground that "the two kinds are different artifacts", so the query is built
 * from the request rather than being optional here.
 */
export function accountCertificatePath(request: CertificateRequest): string {
  return `/accounts/${encodeURIComponent(request.account_id)}/certificate?kind=${request.kind}`;
}

/** `GET /certificates`. REGISTERED, and named here because it is not read. */
export const CERTIFICATE_LIST_PATH = '/certificates';

/** `GET /certificates/:code/image.png`. REGISTERED, and not this screen's read. */
export const CERTIFICATE_IMAGE_PATH = '/certificates/:code/image.png';

/** SC-M4-06's two reads, in the order the screen forces them. */
export const PURCHASES_REQUIRED_ENDPOINTS = [
  'GET /purchases',
  'GET /plans/:planId/versions/:version',
] as const;

/** SC-M4-08's one read per card. */
export const CERTIFICATES_REQUIRED_ENDPOINTS = ['GET /accounts/:accountId/certificate'] as const;

// -----------------------------------------------------------------------------
// The absences, measured, and the vocabulary is session 290's
// -----------------------------------------------------------------------------

/**
 * A read this screen needs, did not make, and COULD MAKE ONE DAY.
 *
 * THE TYPE IS ../referrals/data.ts's AND THE SPELLING IS DELIBERATELY
 * IDENTICAL. That file separated a read that is LATE from a read a RULING
 * REFUSED, so that a refusal could not be assigned to a `missing` list and
 * rendered to a trader as something Merit is still building. This segment has
 * no refused read -- ADR-168 clause 3's refusal is `GET /affiliate/creatives`
 * and is that segment's -- so `RefusedRead` is NOT declared here. An empty
 * second copy of a type is not the vocabulary being kept; it is a shape waiting
 * to be filled by whatever the next author has to hand.
 *
 * IT IS DECLARED HERE RATHER THAN IMPORTED, because a segment importing another
 * segment's load types couples two screens' states to one edit, which is
 * ../accounts/states.ts's stated reason for not importing ../kyc/copy.ts. The
 * duplication is reported in the pull request so a shared vocabulary under
 * `src/shell/` is somebody's decision rather than somebody's copy and paste.
 */
export type PendingRead = {
  readonly kind: 'pending';

  /** The read, as the document that owns it spells it. */
  readonly read: string;

  /**
   * `no_api_origin`     `MERIT_API_ORIGIN` is unset, so NOTHING is reachable.
   *                     ADR-162 clause 1 refuses a default rather than guessing
   * `nothing_serves_it` No approved document defines a read that would answer
   *                     this, so no request was made and none would have helped
   * `no_transcription`  AN ENDPOINT IS REGISTERED AND ANSWERS, and this
   *                     application holds no transcription of its response
   *                     shape. THE THIRD MEMBER IS MEASURED AND NOT INVENTED:
   *                     ../accounts/source.ts refused `GET /accounts/:accountId/
   *                     marks` on exactly this fact an hour before session 290
   *                     wrote the other two -- "`../../api/types.ts` declares
   *                     `MarkListItem` and NO envelope type at all, and that
   *                     file is the transcription of the contract and is outside
   *                     this segment" -- and had no word for it. Folding it into
   *                     `nothing_serves_it` would say something false about a
   *                     row `CompositionReport.registered` lists
   */
  readonly why: 'no_api_origin' | 'nothing_serves_it' | 'no_transcription';
};

/** `GET /purchases`, unreachable only because nothing told this deployment where the API is. */
export const PURCHASES_UNREACHABLE: readonly PendingRead[] = PURCHASES_REQUIRED_ENDPOINTS.map(
  (read) => ({ kind: 'pending', read, why: 'no_api_origin' }),
);

/** The per-card read, unreachable for the same one reason. */
export const CERTIFICATE_READS_UNREACHABLE: readonly PendingRead[] =
  CERTIFICATES_REQUIRED_ENDPOINTS.map((read) => ({ kind: 'pending', read, why: 'no_api_origin' }));

/**
 * The list that would tell this screen WHICH cards to ask for.
 *
 * `no_transcription` AND NOT `nothing_serves_it`, and the difference is a
 * composed server rather than an opinion: `GET /certificates` is in
 * `CompositionReport.registered` on the public surface. What is missing is
 * `CertificateListItem` in ../../api/types.ts and a rendering path for a shape
 * that carries `state`, `deferred` and `revoked`, and both are files this fence
 * holds as read-only. See this file's header.
 */
export const CERTIFICATE_LIST_READ: PendingRead = {
  kind: 'pending',
  read: `GET ${CERTIFICATE_LIST_PATH}, the trader's own certificate list`,
  why: 'no_transcription',
};

/**
 * The simulated-environment disclosure's TEXT, which no contract row serves.
 *
 * IT IS NAMED AS A READ RATHER THAN AS AN ENDPOINT because there is no endpoint
 * to name. ../../view/disclosure.ts records the same absence in its own words --
 * "NO CONTRACT ROW SERVES `content_documents` TO THE PORTAL" -- and ADR-168
 * clause 3 is what happens to a portal segment that invents the row it wishes
 * existed. INV-M4-09 makes this disclosure a compliance obligation on SC-M4-08,
 * so the screen is `unavailable` until the text has a source, and it renders no
 * card without it.
 */
export const DISCLOSURE_READ: PendingRead = {
  kind: 'pending',
  read: 'the simulated-environment disclosure text, from content_documents',
  why: 'nothing_serves_it',
};

// -----------------------------------------------------------------------------
// What a page got
// -----------------------------------------------------------------------------

/**
 * The `error` arm's payload. `ApiFailure` without the discriminant.
 *
 * NOTHING HERE WORDS IT. INV-M4-07 makes the wording one place's job and
 * `toPortalErrorKind` is that place; this carries the kind it already produced
 * and the status it was produced from.
 */
export type PurchasesFailure = {
  readonly error: PortalErrorKind;
  readonly status: number | null;
};

/**
 * What ./purchases/page.ts and ./certificates/page.ts render.
 *
 * THREE ARMS, AND THIS SEGMENT HAD NO LOAD TYPE AT ALL, so the two-arm union is
 * not a thing being repaired here: it is a thing being declined at the moment of
 * authorship. ADR-162 section 5 item 1 reported the hole -- `PayoutCenterLoad`
 * has `ready` and `unavailable` only, so a 500 renders exactly as a missing
 * endpoint does -- session 285 closed it for `accounts` and session 290 for
 * `referrals`, and writing the two-arm union here would be reproducing a known
 * defect on purpose in the last segment positioned to avoid it.
 *
 *   `ready`        the data arrived and the screen renders
 *   `unavailable`  NOTHING FAILED AND NOTHING WAS REFUSED. Either this
 *                  deployment has not been told where its API is, or a read this
 *                  screen needs has no source. ../../shell/app-shell.ts's
 *                  `ContentState` has no member for this and that is deliberate:
 *                  it is not `loading`, not `empty` and not `error`
 *   `error`        A REGISTERED ENDPOINT REFUSED OR FAILED. It carries the
 *                  `PortalErrorKind` ../../http/client.ts already mapped and the
 *                  status it was mapped from
 */
export type PurchasesLoad =
  | ({ readonly kind: 'ready' } & PurchasesPageModel)
  | { readonly kind: 'unavailable'; readonly missing: readonly PendingRead[] }
  | ({ readonly kind: 'error' } & PurchasesFailure);

/** SC-M4-08's three arms, on `PurchasesLoad`'s shape and for its reasons. */
export type CertificatesLoad =
  | ({ readonly kind: 'ready' } & CertificatesPageModel)
  | { readonly kind: 'unavailable'; readonly missing: readonly PendingRead[] }
  | ({ readonly kind: 'error' } & PurchasesFailure);

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------
// ../../http/client.ts returns `unknown` and its section 5 argues why: a generic
// `get<T>` is a cast the compiler cannot check, and a transport that asserted
// wire shapes would have to know all of them. `unknown` cannot be read without a
// check, so the check is here, beside ../../api/types.ts, which is where this
// application already transcribed the shapes being checked for.
//
// EVERY FIELD ../../view/purchases.ts AND ../../view/certificates.ts READ IS
// CHECKED AND NOT A SUBSET. ADR-162 foreclosure 5: "a partial guard reads as a
// complete one at the call site and crashes on the field it skipped, which is
// worse than none because it looks like a control."

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

/**
 * An integer.
 *
 * INTEGER RATHER THAN NUMBER, AND ON THE MONEY FIELDS SPECIFICALLY. "Money is
 * integer cents. No floats anywhere, fixtures included." ../../format/money.ts
 * is INV-M4-01's only permitted consumer of a `_cents` field and it THROWS on a
 * value that is not an exact integer, so a fractional `amount_paid_cents` would
 * reach the screen as a `RangeError` inside a component rather than as an honest
 * error state. This refuses it one layer earlier.
 *
 * IT IS ALSO THE CHECK ON `version`, which is not money and which is still a
 * server answering wrongly when it is fractional -- and which additionally
 * composes a URL in {@link planVersionPath}.
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function has(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isMember(table: Readonly<Record<string, true>>, value: unknown): boolean {
  return isString(value) && has(table, value);
}

/**
 * Every member of `PurchaseListItem['kind']`, as a lookup the compiler keeps
 * complete.
 *
 * `Record<..., true>` IS THE MECHANISM and it is ../payouts/source.ts's for
 * `PayoutStatus`. A member added to ../../api/types.ts and not added here is
 * `error TS2741`, so this cannot drift from the union it guards the way a
 * hand-written array of strings would.
 */
const PURCHASE_KINDS: Readonly<Record<PurchaseListItem['kind'], true>> = {
  new: true,
  reset: true,
};

const PURCHASE_STATUSES: Readonly<Record<PurchaseListItem['status'], true>> = {
  pending: true,
  paid: true,
  failed: true,
  refunded: true,
  charged_back: true,
};

const PLAN_VERSION_STATUSES: Readonly<Record<PlanVersionResponse['status'], true>> = {
  published: true,
  retired: true,
};

const CERTIFICATE_KINDS: Readonly<Record<CertificateResponse['kind'], true>> = {
  pass: true,
  payout: true,
};

/**
 * Section 1's envelope, checked once for every list this segment reads.
 *
 * IT CHECKS `next_cursor` AND NOT ONLY `data`, which is app/calendar/load.ts's
 * check and its reason: a response that carried rows and no cursor member would
 * pass an item-only guard, and `undefined !== null` is the only thing separating
 * "there is no more" from "the field was not sent".
 */
function isCursorPage<T>(
  value: unknown,
  item: (entry: unknown) => entry is T,
): value is CursorPage<T> {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value['data']) &&
    value['data'].every(item) &&
    isNullableString(value['next_cursor'])
  );
}

/**
 * A JSON value, checked recursively.
 *
 * THIS IS THE GUARD FOR `PlanRules` AND IT DELIBERATELY KNOWS NO RULE NAME.
 * ../../api/types.ts declares `PlanRules = Readonly<Record<string, JsonValue>>`
 * and spends a paragraph on why: a portal type enumerating the rule schema's
 * keys would be a second copy of it, and "the day a rule gains a key, the diff
 * renders 'nothing changed' about a contract that changed". A guard that
 * enumerated keys would reintroduce exactly that, one layer lower.
 *
 * SO IT CHECKS WHAT `toRuleDiff` ACTUALLY NEEDS, which is that the tree is
 * walkable and serialisable: ../../view/purchases.ts descends objects and calls
 * `JSON.stringify` on every leaf. A body from `response.json()` satisfies this
 * by construction; the check is what makes the TYPE CLAIM true rather than
 * assumed, and it is the difference between a guard and a cast.
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function isRuleObject(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/** The plan stub on a purchase row. Three fields, all three read. */
function isPurchasePlan(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value['plan_id']) &&
    isString(value['code']) &&
    isInteger(value['version'])
  );
}

/** One `GET /purchases` row, narrowed to what `toPurchaseRow` reads. */
export function isPurchaseListItem(value: unknown): value is PurchaseListItem {
  if (!isRecord(value)) return false;

  return (
    isString(value['purchase_id']) &&
    isString(value['created_at']) &&
    isMember(PURCHASE_KINDS, value['kind']) &&
    isPurchasePlan(value['plan']) &&
    isInteger(value['size_cents']) &&
    isInteger(value['amount_paid_cents']) &&
    isInteger(value['discount_cents']) &&
    isMember(PURCHASE_STATUSES, value['status']) &&
    isNullableString(value['account_id'])
  );
}

/** `GET /purchases`, envelope and rows. */
export function isPurchasePage(value: unknown): value is CursorPage<PurchaseListItem> {
  return isCursorPage(value, isPurchaseListItem);
}

/** One `sizes` row. Nine fields, and `profit_target_cents` is the nullable one. */
function isPlanSize(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const target = value['profit_target_cents'];

  return (
    isInteger(value['size_cents']) &&
    isInteger(value['price_cents']) &&
    isInteger(value['reset_price_cents']) &&
    isInteger(value['drawdown_cents']) &&
    (target === null || isInteger(target)) &&
    isInteger(value['buffer_cents']) &&
    isInteger(value['win_day_floor_cents']) &&
    isInteger(value['payout_cap_cents']) &&
    isInteger(value['min_payout_cents'])
  );
}

/**
 * `GET /plans/:planId/versions/:version`, ALL OF IT.
 *
 * THE WHOLE RESPONSE IS CHECKED WHERE ../accounts/source.ts CHECKED THREE
 * FIELDS, and the difference is the consumer rather than a difference of
 * opinion. That segment declared a `PinnedPlanSource` naming exactly what it
 * verified, because `toAccountDetail` takes a `PinnedPlanCopy` and reads three
 * fields. `toRuleDiff` takes two whole `PlanVersionResponse`s, so a predicate
 * returning `value is PlanVersionResponse` after checking three of them would be
 * ADR-162 foreclosure 5's partial guard with the sign flipped: not a guard that
 * skipped a field the view reads, but one that CLAIMED five fields nobody
 * checked, and the next reader of that type is entitled to `sizes`.
 */
export function isPlanVersionResponse(value: unknown): value is PlanVersionResponse {
  if (!isRecord(value)) return false;
  const sizes = value['sizes'];
  const copy = value['copy_blocks'];

  return (
    isString(value['plan_version_id']) &&
    isString(value['plan_id']) &&
    isInteger(value['version']) &&
    isMember(PLAN_VERSION_STATUSES, value['status']) &&
    isString(value['published_at']) &&
    isNullableString(value['retired_at']) &&
    isRuleObject(value['rules']) &&
    isRecord(copy) &&
    Object.values(copy).every(isString) &&
    Array.isArray(sizes) &&
    sizes.every(isPlanSize)
  );
}

/**
 * `claims`, INV-M11-01's minimal claim and the whole of it.
 *
 * `amount_cents` IS OPTIONAL AND AN ABSENT ONE IS NOT A NULL ONE. A pass card
 * claims no money; ../../view/certificates.ts renders `certificate.claims
 * .amount_cents ?? null` and states that rendering an absent amount as `0.00`
 * "would turn the first into a false claim about the second". So the field is
 * admitted when it is absent and refused when it is present and not an integer,
 * and a `null` is refused too: the contract declares `number | undefined` and a
 * server sending `null` has answered a shape nobody agreed.
 */
function isCertificateClaims(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const amount = value['amount_cents'];

  return (
    isString(value['plan_code']) &&
    isInteger(value['size_cents']) &&
    (amount === undefined || isInteger(amount)) &&
    isString(value['trading_day'])
  );
}

/**
 * `GET /accounts/:accountId/certificate`, narrowed to what SC-M4-08 renders.
 *
 * `verify_url` IS CHECKED AS A STRING AND NOT AS A NON-BLANK ONE, deliberately.
 * A blank one is the case AS-M4-03 is about and ../../view/certificates.ts
 * already refuses it by throwing `UnverifiableCertificateError`, which ./model.ts
 * turns into a card-level REFUSAL with a reason. Refusing it here instead would
 * turn one bad card into a whole-page `server_error`, which is the outage this
 * segment's rendering path exists to avoid.
 */
export function isCertificateResponse(value: unknown): value is CertificateResponse {
  if (!isRecord(value)) return false;

  return (
    isString(value['certificate_id']) &&
    isMember(CERTIFICATE_KINDS, value['kind']) &&
    isString(value['image_url']) &&
    isString(value['verify_url']) &&
    isString(value['issued_at']) &&
    isCertificateClaims(value['claims'])
  );
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * A read that refused or failed, carried out of a PORT.
 *
 * IT IS A THROW BECAUSE THE PORT CANNOT RETURN ONE, and that is a fact about
 * ./ports.ts rather than a preference. `readPurchases()` returns
 * `Promise<readonly PurchaseListItem[]>` and ./model.ts is what CALLS it -- the
 * rule diff's two reads per reset are chosen from the first response, so no
 * caller can prefetch them and hand them in. ../accounts/source.ts and
 * ../referrals/data.ts both return a narrowed union from the load because their
 * loads make the requests; this one does not, and a port signature widened to
 * carry a failure is a change to every implementation of it, ./fixtures.ts
 * included.
 *
 * SO THE FAILURE CROSSES ./model.ts AS AN EXCEPTION AND IS CAUGHT BY CLASS AT
 * THE OTHER SIDE. Exactly this class and nothing else: anything else propagates,
 * which is ADR-162 foreclosure 6's rule stated at a second boundary, and the
 * test asserts both directions. `MissingDisclosureError` from ../../view/
 * disclosure.ts is one of the things that must keep propagating -- a required
 * disclosure that arrived blank is not a transport failure and must not render
 * as one.
 */
class PortRefusal extends Error {
  public readonly failure: PurchasesFailure;

  public constructor(failure: PurchasesFailure) {
    super(
      `a read this screen needs answered \`${failure.error}\`` +
        (failure.status === null ? ' with no status' : ` (status ${String(failure.status)})`),
    );
    this.name = 'PortRefusal';
    this.failure = failure;
  }
}

/**
 * A read, narrowed, or the refusal that stops the screen.
 *
 * A `2xx` WHOSE BODY DOES NOT SATISFY THE GUARD IS `server_error`.
 * ../../http/client.ts already answers exactly that for a `2xx` whose body is
 * not JSON, on the ground that a server which answered wrongly is not a server
 * that answered, and a body that parses and does not match the shape is the same
 * fact one layer up. It is NOT `unavailable`: the endpoint is registered and it
 * replied, so "waiting on a read" would be false about a real answer.
 *
 * ITS `status` IS `null` AND THAT IS A LIMIT RATHER THAN A CLAIM. `ApiSuccess`
 * is `{ ok: true, body: unknown }` and carries no status, so the response's own
 * number is not available at this layer; inventing `200` would put a number in
 * the server's mouth to satisfy a field, and widening `ApiSuccess` is a change
 * to ADR-162's file, which this fence does not hold.
 */
function narrowed<T>(result: ApiResult, guard: (value: unknown) => value is T): T {
  if (!result.ok) throw new PortRefusal({ error: result.error, status: result.status });
  if (!guard(result.body)) throw new PortRefusal({ error: 'server_error', status: null });
  return result.body;
}

/**
 * One certificate, or the honest absence.
 *
 * A `404` IS `null` AND NOT AN ERROR, WHICH IS THE PORT'S OWN CONTRACT AND IS
 * ALSO A COLLISION THIS FILE CANNOT RESOLVE. ./ports.ts: `readCertificate`
 * "returns `null` for an account that has no certificate of that kind, which is
 * the ordinary case and not an error: a trader who has not passed has no pass
 * card." `apps/api/src/routes/account-reads.ts` answers that case with
 * `problemNotFound`, and INV-M4-07 gives an account id that is not the caller's
 * the SAME 404 so that existence is not confirmed to a stranger.
 *
 * SO ONE STATUS CARRIES TWO FACTS AND THE SCREEN RENDERS THE COMMON ONE. The
 * requests this screen makes are built from the trader's own accounts (see the
 * header), so the second reading is not reachable through this path, and the
 * price of getting it wrong the other way is telling a trader who simply has no
 * pass card that something failed. The collision is REPORTED rather than
 * papered over: distinguishing the two needs a field the response does not
 * carry, and inventing one is API_CONTRACT's business and not a segment's.
 */
async function readCertificate(
  client: ApiClient,
  request: CertificateRequest,
): Promise<CertificateResponse | null> {
  const result = await client.get(accountCertificatePath(request));
  if (!result.ok && result.status === 404) return null;
  return narrowed(result, isCertificateResponse);
}

/**
 * ./ports.ts, backed by the API rather than by ./fixtures.ts.
 *
 * ONE ADAPTER FOR BOTH SCREENS, because ./model.ts takes the whole
 * `PurchasesSegmentPorts` on both of its page models. Each screen calls the two
 * methods it needs and neither method is a stub: `certificatesPageModel` never
 * reaches `readPurchases`, and it is a real read when something does.
 *
 * `readDisclosure` REJECTS RATHER THAN RETURNING A PLAUSIBLE STRING WHEN THERE
 * IS NO TEXT, and both loads check before they call the model, so this is a
 * fail-closed guard rather than a path. Returning a sentence typed in this
 * repository is the single thing ../../view/disclosure.ts exists to make
 * impossible, and returning a blank one reaches `disclosureBlock()`'s refusal
 * one call later with the reason lost.
 */
function apiPorts(input: {
  readonly client: ApiClient;
  readonly disclosureText: string | null;
}): PurchasesSegmentPorts {
  return {
    async readPurchases(): Promise<readonly PurchaseListItem[]> {
      const page = narrowed(
        await input.client.get(purchasesPagePath(PURCHASES_PAGE_LIMIT)),
        isPurchasePage,
      );
      // `next_cursor` IS READ AND DROPPED, AND THE HEADER SAYS WHAT THAT COSTS.
      // The port returns rows because ./ports.ts declared it that way and
      // nothing in this segment can render a truncation statement; the envelope
      // is still GUARDED, because a response missing the member is a server
      // answering wrongly whether or not this screen can use the answer.
      return page.data;
    },

    async readPlanVersion(plan_id: string, version: number): Promise<PlanVersionResponse> {
      return narrowed(
        await input.client.get(planVersionPath(plan_id, version)),
        isPlanVersionResponse,
      );
    },

    readCertificate(request: CertificateRequest): Promise<CertificateResponse | null> {
      return readCertificate(input.client, request);
    },

    readDisclosure(): Promise<string> {
      if (input.disclosureText === null)
        return Promise.reject(
          new Error(
            'readDisclosure was called with no text. Both loads check before calling the page ' +
              'model, and INV-M4-09 forbids this file to author the sentence itself',
          ),
        );
      return Promise.resolve(input.disclosureText);
    },
  };
}

/**
 * SC-M4-06, from a client.
 *
 * EXPORTED SEPARATELY FROM `loadPurchases` SO THE READY BRANCH IS REACHED
 * THROUGH THE REAL CLIENT. `apps/portal/test/purchases-source.test.ts` calls it
 * with a client built by `createApiClient` over a stub transport, which
 * exercises the whole seam -- URL composition, the forwarded cookie, `no-store`,
 * the status mapping, the JSON read, this segment's guards -- rather than a mock
 * of it.
 */
export async function loadPurchasesFrom(input: {
  readonly client: ApiClient;
}): Promise<PurchasesLoad> {
  try {
    return {
      kind: 'ready',
      ...(await purchasesPageModel(apiPorts({ ...input, disclosureText: null }))),
    };
  } catch (error) {
    if (!(error instanceof PortRefusal)) throw error;
    return { kind: 'error', ...error.failure };
  }
}

/**
 * SC-M4-08, from a client and whatever the caller could obtain elsewhere.
 *
 * `requests` AND `disclosureText` ARE PARAMETERS AND BOTH `null`s ARE
 * MEASUREMENTS RATHER THAN PLACEHOLDERS. The header has both: this segment has
 * no wire source for the trader's account ids, and no contract row serves
 * `content_documents` to the portal at all. ../accounts/source.ts took `marks`
 * and ../referrals/data.ts took `disclosureText` the same way for the same
 * reason, and the shape is what makes landing either one a guard and a call
 * rather than a rewrite.
 *
 * THE READS THIS SCREEN CAN MAKE ARE PERFORMED EVEN WHEN `ready` IS OUT OF
 * REACH, AND THAT IS DELIBERATE. Short-circuiting before the requests would
 * render the same words for less work. What it would cost is the two things that
 * make the difference between a screen and a placeholder: a refusal on a
 * registered endpoint would never be reported as a refusal, and the wired path
 * would first run in production on the day the missing read lands, which is the
 * worst possible day to discover a misconfigured origin. That is
 * ../accounts/source.ts's argument on the identical shape.
 */
export async function loadCertificatesFrom(input: {
  readonly client: ApiClient;
  readonly requests: readonly CertificateRequest[] | null;
  readonly disclosureText: string | null;
}): Promise<CertificatesLoad> {
  try {
    if (input.requests !== null && input.disclosureText !== null)
      return {
        kind: 'ready',
        ...(await certificatesPageModel(
          apiPorts({ client: input.client, disclosureText: input.disclosureText }),
          input.requests,
        )),
      };

    for (const request of input.requests ?? []) await readCertificate(input.client, request);

    // THE LIST IS A MEASUREMENT AND NOT A CONSTANT. It names what this load
    // could not obtain on THIS call, so a deployment that lands one of the two
    // reads sees the other one alone rather than a fixed pair.
    const missing: PendingRead[] = [];
    if (input.requests === null) missing.push(CERTIFICATE_LIST_READ);
    if (input.disclosureText === null) missing.push(DISCLOSURE_READ);
    return { kind: 'unavailable', missing };
  } catch (error) {
    if (!(error instanceof PortRefusal)) throw error;
    return { kind: 'error', ...error.failure };
  }
}

/**
 * THE ONE CONVERSION, AND ITS NARROWNESS IS THE ARGUMENT.
 *
 * `MERIT_API_ORIGIN` unset means this deployment has no API, so EVERY read this
 * segment needs is unreachable, which is what `unavailable` says and is not a
 * fault the trader caused or can act on. ADR-162 foreclosure 6 rules exactly
 * this and rules the rest of it too: anything else -- a transport failure, a bug
 * in a path, a `cookies()` called outside a request scope -- is NOT converted
 * and PROPAGATES, because converting it would make every fault in this
 * application look like a pending read.
 *
 * BOTH DIRECTIONS ARE ASSERTED in `apps/portal/test/purchases-source.test.ts`.
 */
async function clientOrUnavailable(): Promise<
  { readonly ok: true; readonly client: ApiClient } | { readonly ok: false }
> {
  try {
    return { ok: true, client: await serverApiClient() };
  } catch (error) {
    if (!(error instanceof ApiConfigError)) throw error;
    return { ok: false };
  }
}

/** What ./purchases/page.ts calls. `GET /api/v1/purchases`, with the trader's cookie. */
export async function loadPurchases(): Promise<PurchasesLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok) return { kind: 'unavailable', missing: PURCHASES_UNREACHABLE };
  return loadPurchasesFrom({ client: resolved.client });
}

/**
 * What ./certificates/page.ts calls.
 *
 * THE UNAVAILABLE LIST IS DIFFERENT IN THE TWO DIRECTIONS AND BOTH ARE TRUE. An
 * unset origin makes the per-card read unreachable as well as the two this
 * segment has no source for, so all three are named; once an origin is set, the
 * per-card read is made and the other two are what remain.
 */
export async function loadCertificates(): Promise<CertificatesLoad> {
  const resolved = await clientOrUnavailable();
  if (!resolved.ok)
    return {
      kind: 'unavailable',
      missing: [...CERTIFICATE_READS_UNREACHABLE, CERTIFICATE_LIST_READ, DISCLOSURE_READ],
    };
  return loadCertificatesFrom({ client: resolved.client, requests: null, disclosureText: null });
}
