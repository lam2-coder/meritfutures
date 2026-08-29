// =============================================================================
// apps/api/src/routes/account-reads.ts
// =============================================================================
// API_CONTRACT SECTION 6's FOUR SUB-RESOURCE READS OF ONE ACCOUNT:
// `/marks`, `/timeline`, `/eligibility` and `/certificate`. All four are
// declared in the contract with their own `### GET ...` headings and their own
// response shapes, and until this file none of them was registered on either
// surface.
//
// -----------------------------------------------------------------------------
// WHY A NEW MODULE AND NOT `accounts.ts`, ARGUED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// `routes/accounts.ts` is the obvious home: its header lists all four of these
// paths as belonging to the contract's account section, and it registers two
// routes and stops. IT ALREADY THOUGHT ABOUT THIS AND DECLINED IN WRITING --
// its `RuleStateRow` note says of `engine_gates` and `context_gates` that they
// "are `/eligibility`'s and are somebody else's endpoint". This file is that
// somebody, and the reasons the split is right rather than merely inherited:
//
//   1. ADR-100's REGISTRY MAKES A NEW FILE FREE AND AN EDIT EXPENSIVE. The
//      module list is the directory listing and is never written down, so a new
//      `routes/*.ts` collides with nothing, while four more endpoints inside
//      `accounts.ts` would put this session's diff in the same file as every
//      later edit to `GET /accounts`.
//   2. THE PORTS ARE DISJOINT AND THE TABLES ARE DIFFERENT. `AccountsBackend`'s
//      three methods all render `AccountListItem`/`AccountDetail` off
//      `accounts`, `rule_states`, `plan_versions` and `kyc_verifications`. Of
//      the four here, ONE reads `daily_marks`, one needs `events`, one needs the
//      rules engine and one reads `certificates`. Merging them would give
//      `start.ts`'s single `useAccountsBackend(...)` line a backend most of
//      which refuses, and would make `resetAccountsBackend()` a shared fixture
//      for two unrelated slices in one suite file.
//   3. THE PATHS ARE DISJOINT, WHICH IS WHAT ADR-100 ACTUALLY REQUIRES. Not one
//      of the four paths below is declared anywhere else, so `compose`'s
//      duplicate `METHOD /path` refusal has nothing to catch.
//
// The four are ONE module rather than four because they are one path family
// (`/accounts/:accountId/*`), they share one tenancy resolution and one 404
// shape, and they land on one branch in one session: four files would be four
// copies of the same port scaffolding bought with no concurrency at all.
//
// -----------------------------------------------------------------------------
// ONE OF FOUR IS SERVED END TO END AND THREE REFUSE BY NAME. THE COUNT IS
// REPORTED RATHER THAN ROUNDED
// -----------------------------------------------------------------------------
// `readMarks` reads real rows through the real accessor. The other three raise
// `AccountReadsBackendUnwired` carrying the blocker, and the route answers 503
// `service_unavailable`. That is `databaseAuthBackend`'s shape and
// `accounts.ts`'s `readProgress`'s shape exactly, and each blocker below was
// measured against the primary source rather than inferred:
//
//   `/timeline`  `events` IS NOT A REGISTERED TABLE. `packages/db/src/scope.ts`
//                states the refusal and its reason: `identity_id` and
//                `account_id` are BOTH nullable with no CHECK tying them, so
//                "a rule naming `identity_id` drops every account-level row and
//                a rule hopping `account_id` drops every identity-level row",
//                and the payload names third-party identities inside `jsonb`
//                besides. `events` is in neither `TABLES` (104 members, checked)
//                nor `SCOPE_RULES`, so NO SCOPE CLASS REACHES IT and there is no
//                door to open. Registering it is `packages/db`'s file and this
//                session does not hold it.
//
//   `/eligibility`  `evaluatePayout` IS THE ONE EVALUATOR (`INV-M5-02`: both
//                payout endpoints call the identical function with identical
//                inputs) AND ITS `RuleState` ARGUMENT HAS NO PRODUCER HERE.
//                THE SCHEMA DELTA THIS REASON USED TO NAME IS SPENT:
//                `0065_rule_state_lifetime_and_breach.sql` declares all three
//                columns and `apps/worker/src/batch/state-writer.ts` maps
//                them, so the engine's type IS persistable now. What refuses
//                today is that `rule_states` holds no rows, nothing in a
//                deployment writes one, and the stored encoding of
//                `engine_gates` is undeclared, which stops the writer and this
//                reader alike. `ELIGIBILITY_BLOCKER` carries the three clauses
//                and `account-reads.test.ts` derives each at its own source.
//
//   `/certificate`  `image_url` IS NON-NULLABLE IN THE CONTRACT AND NOTHING IN
//                THIS TREE CAN PRODUCE ONE. It is "signed, time-limited", and
//                `certificates` (0020_public_surface.sql) carries `code`,
//                `claims`, `signature` and `signing_key_id` but NO image
//                location column, so there is not even a stored value to sign.
//                `M11` section 5 rows this endpoint as shared with M4 and says
//                "M11 owns what is behind both". A card renderer, a CDN origin
//                and a URL signer are all M11's and none exists; inventing an
//                origin here would also break `apps/admin/src/origin.ts`'s rule
//                that a real hostname is a deployment fact and never a value
//                this repository writes down. EVERY OTHER FIELD IS READABLE
//                TODAY, which is why the refusal is one named field rather than
//                a shrug, and why the port is shaped to serve the moment M11
//                lands.
//
// THE SHAPES ARE DECLARED IN FULL FOR ALL FOUR, on `accounts.ts`'s ruling about
// `AccountProgress`: the refusal is about WIRING and not about SHAPE, and a
// port whose type was also missing would be a blocker nobody could measure.
//
// -----------------------------------------------------------------------------
// TENANCY IS THE ACCESSOR'S ON ALL FOUR, AND NOTHING HERE COMPARES AN IDENTITY
// -----------------------------------------------------------------------------
// Section 1: "A path parameter naming a resource the caller does not own
// returns 404 (not 403) on trader surfaces." `accounts.ts` states the mechanism
// and this file follows it rather than inventing a second shape:
// `scopedDb(identityId)` ANDs tenancy onto the address, so
// `rowAt('accounts', { id })` on identity A naming identity B's account reaches
// ZERO ROWS and comes back `undefined`, which becomes the 404.
//
// EVERY ONE OF THE FOUR RESOLVES THE ACCOUNT THROUGH THAT ADDRESS FIRST, and
// that is the whole BOLA control. A read that narrowed only by the id in the
// path -- `rowsWhere('dailyMarks', { accountId })` with no account resolution --
// would still be scoped by the accessor, but it would answer 200 with an empty
// page for a stranger's account id where the contract requires 404, which is
// the existence oracle section 1 forbids. The account read is therefore not a
// convenience and must not be removed as one.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` INSIDE THIS FILE AND `number` ONLY ON THE WIRE
// -----------------------------------------------------------------------------
// Every money column read here is `bigint NOT NULL` in its migration.
// `centsToJson` is imported from `checkout.ts` rather than transcribed, for
// `accounts.ts`'s reason: a second copy of "refuse past MAX_SAFE_INTEGER rather
// than round" is a second thing to get wrong.
//
// -----------------------------------------------------------------------------
// TWO PLACES THE CONTRACT UNDERDETERMINES `/marks`, RULED HERE AND REPORTED
// -----------------------------------------------------------------------------
// Section 6 gives `/marks` one line of behaviour -- "Cursor paginated by
// `trading_day` descending" -- and section 1 supplies the envelope and the
// bounds. What neither states is settled at `projectMarks` and at `pageOf`
// below, each with the argument beside it, and both are findings for the pull
// request rather than rulings this file claims authority for.
// =============================================================================

import { atMost } from '@merit/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiDb } from '../db.ts';
import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import {
  AuthBackendUnwired,
  problemNotFound,
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthSession,
  type EndpointSpec,
  type FieldError,
} from './auth.ts';
import { centsToJson } from './checkout.ts';

/** API_CONTRACT section 6's rows, as the contract writes them. No base path. */
export const MARKS_PATH = '/accounts/:accountId/marks';
export const TIMELINE_PATH = '/accounts/:accountId/timeline';
export const ELIGIBILITY_PATH = '/accounts/:accountId/eligibility';
export const CERTIFICATE_PATH = '/accounts/:accountId/certificate';

// -----------------------------------------------------------------------------
// The wire, section 6's own shapes
// -----------------------------------------------------------------------------

/** Section 6's `MarkListItem`, field for field. */
export interface MarkListItem {
  /** `YYYY-MM-DD`, an exchange trading day and never a UTC date. */
  readonly trading_day: string;
  readonly opening_balance_cents: number;
  readonly closing_balance_cents: number;
  readonly high_balance_cents: number;
  /** The breach comparison input: the day's low against the floor open that day. */
  readonly low_balance_cents: number;
  /** SIGNED. A movement, so it may be negative. */
  readonly realized_pnl_cents: number;
  readonly traded_day: boolean;
  readonly win_day: boolean;
  readonly floor_cents: number;
  readonly withdrawable_cents: number;
  /** "True when this day has a superseding mark." See `projectMarks`. */
  readonly corrected: boolean;
}

/**
 * Section 1's list envelope: "Responses carry `{ data, next_cursor }`".
 *
 * SECTION 6 TYPES THE ITEM AND SECTION 1 TYPES THE ENVELOPE, and section 6's
 * own `GET /wallet/entries` row writes the pair out longhand
 * (`{ data: WalletEntry[]; next_cursor: string | null }`) for a list whose item
 * type it declares the same way. So the envelope is transcription rather than
 * invention, and a bare array here would be the one list response on this
 * surface that does not carry a cursor.
 */
export interface MarksPage {
  readonly data: readonly MarkListItem[];
  readonly next_cursor: string | null;
}

/** Section 6's `TimelineItem`, field for field. */
export interface TimelineItem {
  readonly occurred_at: string;
  readonly trading_day: string | null;
  /** `event_name`, TRADER-SAFE SUBSET ONLY. The subsetting is the server's. */
  readonly kind: string;
  /** Rendered from the payload, never raw internals. */
  readonly summary: string;
  readonly detail: Readonly<Record<string, number | string | boolean | null>>;
}

/** Section 1's envelope again. `/timeline` is "chronological" and is a list. */
export interface TimelinePage {
  readonly data: readonly TimelineItem[];
  readonly next_cursor: string | null;
}

/**
 * Section 6's `gates`, cell for cell.
 *
 * TEN CELLS AND NO ELEVENTH. `PayoutEvaluation.noPayoutInFlight` is reported
 * beside this object in the engine and not inside it, because "API_CONTRACT's
 * `gates` has no slot", and `routes/payouts.ts` already renders exactly these
 * ten from exactly this evaluation.
 */
export interface EligibilityGates {
  readonly account_active: { readonly pass: boolean };
  readonly kyc_verified: { readonly pass: boolean; readonly state: string };
  readonly not_frozen: { readonly pass: boolean; readonly reason: string | null };
  readonly recon_clear: { readonly pass: boolean };
  readonly traded_days: { readonly pass: boolean; readonly have: number; readonly need: number };
  readonly win_days: {
    readonly pass: boolean;
    readonly have: number;
    readonly need: number;
    readonly floor_cents: number;
  };
  readonly buffer: {
    readonly pass: boolean;
    readonly have_cents: number;
    readonly need_cents: number;
  };
  readonly consistency: {
    readonly pass: boolean;
    /** INV-M4-05: a skipped gate renders DISABLED, never as satisfied. */
    readonly skipped: boolean;
    readonly best_day_share_bp: number | null;
    readonly max_bp: number | null;
    readonly profit_needed_to_dilute_cents: number | null;
  };
  readonly cadence_gap: {
    readonly pass: boolean;
    readonly days_since_last_payout: number | null;
    readonly need: number;
    /** EC-046: a DATE, because a count of trading days is a rule a trader cannot evaluate. */
    readonly next_eligible_trading_day: string | null;
  };
  readonly minimum_amount: {
    readonly pass: boolean;
    readonly withdrawable_cents: number;
    readonly min_payout_cents: number;
  };
}

/** Section 6's `EligibilityResponse`, field for field. */
export interface EligibilityResponse {
  readonly account_id: string;
  readonly as_of_trading_day: string;
  readonly eligible: boolean;
  /** `min(withdrawable, cap)` after clamp, `0` when not eligible. */
  readonly max_payout_cents: number;
  readonly min_payout_cents: number;
  readonly gates: EligibilityGates;
  readonly cap: {
    readonly cap_cents: number;
    readonly ordinal: number;
    readonly schedule_note: string;
  };
}

/** `?kind=`, section 6's two values and no others. */
export type CertificateKind = 'pass' | 'payout';

/** Section 6's `CertificateResponse`, field for field. */
export interface CertificateResponse {
  readonly certificate_id: string;
  readonly kind: CertificateKind;
  /** Signed and time limited. A RENDERING, and never the authority (AS-M4-03). */
  readonly image_url: string;
  /** The public verification page. THE AUTHORITY. */
  readonly verify_url: string;
  readonly issued_at: string;
  /**
   * "Claims are minimal by construction: no identity, no email, no cumulative
   * totals" (AS-M4-03). The absence of a field here is a control.
   */
  readonly claims: {
    readonly plan_code: string;
    readonly size_cents: number;
    /** Payout cards only. A pass card claims no amount. */
    readonly amount_cents?: number;
    readonly trading_day: string;
  };
}

// -----------------------------------------------------------------------------
// The rows `/marks` reads, in this handler's terms
// -----------------------------------------------------------------------------

/**
 * One `daily_marks` row, `0014_marks.sql`.
 *
 * `accountId` IS ABSENT AND ITS ABSENCE IS THE POINT, which is `AccountRow`'s
 * ruling one table over: the handler never sees a tenancy column, so it cannot
 * compare one, so the only thing between identity A and identity B's marks is
 * the accessor's predicate.
 *
 * `superseded` IS A BOOLEAN AND NOT THE `bigint` THE COLUMN HOLDS. The id of
 * the row that superseded this one is not rendered anywhere and is not needed
 * to answer `corrected`, so it does not enter the process: section 1's
 * allowlist read one layer earlier than the response.
 */
export interface MarkRow {
  readonly tradingDay: string;
  readonly openingBalanceCents: bigint;
  readonly closingBalanceCents: bigint;
  readonly highBalanceCents: bigint;
  readonly lowBalanceCents: bigint;
  readonly realizedPnlCents: bigint;
  readonly tradedDay: boolean;
  readonly winDay: boolean;
  /** `superseded_by IS NOT NULL`: this row has been replaced by a correction. */
  readonly superseded: boolean;
}

/**
 * The two `rule_states` columns a mark cannot supply.
 *
 * `floor_cents` AND `withdrawable_cents` ARE NOT COLUMNS OF `daily_marks`.
 * Both are `rule_states`' (`0015_rule_states.sql`), whose grain is the same one
 * row per account per trading day, so the join is by day and cannot multiply.
 *
 * `floor_open_cents` IS THE TRAP AND IT IS NOT THIS FIELD, on `accounts.ts`'s
 * reading of SD-04: `floor_open_cents` is the floor the day was JUDGED against
 * and `floor_cents` is the one that survived it. The contract's field is
 * `floor_cents`, so the surviving floor is what is rendered, and the day's low
 * beside it is `low_balance_cents` rather than a comparison this file makes.
 */
export interface MarkRuleStateRow {
  readonly tradingDay: string;
  readonly floorCents: bigint;
  readonly withdrawableCents: bigint;
}

/**
 * Everything one `/marks` response is rendered from, read in one unit of work.
 *
 * BOTH SIDES ARE EVERY ROW AT OR BELOW THE CURSOR RATHER THAN ONE PAGE,
 * because the accessor offers no ORDER BY and no LIMIT: `atMost` (ADR-157's
 * range term, reads only) bounds the read ABOVE and the page is a fold. See
 * `pageOf`.
 */
export interface MarksSnapshot {
  readonly marks: readonly MarkRow[];
  readonly ruleStates: readonly MarkRuleStateRow[];
}

/** `?limit=` and `?cursor=`, resolved. Section 1's pagination rule. */
export interface PageRequest {
  readonly limit: number;
  /** The trading day to read AT OR BEFORE, or `null` for the newest page. */
  readonly cursor: string | null;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Thrown by a backend that cannot serve one method. Answered as 503, never 500.
 *
 * IT EXTENDS `AuthBackendUnwired` AND THE INHERITANCE IS WHY IT EXISTS, which
 * is `AccountsBackendUnwired`'s reason repeated because it is load bearing
 * rather than stylistic: `endpointHandler` is the ONE place a 503 is produced
 * and it selects on that class, so a sibling class would type-check, read
 * better, and escape that catch as an uncaught 500 carrying the reason string
 * into a response -- exactly what section 2 forbids.
 *
 * IT IS A SEPARATE CLASS FROM `AccountsBackendUnwired` RATHER THAN AN IMPORT OF
 * IT, because that class's message names `AccountsBackend.<method>` and these
 * methods are not on that port. Both extend the one class the catch selects on,
 * so the behaviour is identical and only the operator's line differs.
 *
 * THE REASON NEVER REACHES THE RESPONSE. It names tables, columns and ADRs.
 * `endpointHandler` logs the error and sends a bare 503.
 */
export class AccountReadsBackendUnwired extends AuthBackendUnwired {
  constructor(method: string, reason: string) {
    super(method, reason);
    this.name = 'AccountReadsBackendUnwired';
    this.message = `AccountReadsBackend.${method} cannot be served by this deployment: ${reason}`;
  }
}

/**
 * Everything section 6's four sub-resource reads need from outside the process.
 *
 * EVERY METHOD RETURNS `null` FOR AN ACCOUNT THAT IS NOT THIS IDENTITY'S AND
 * FOR ONE THAT DOES NOT EXIST, and the two are deliberately the same value: a
 * port that distinguished them would hand the handler a fact section 1 forbids
 * it to reveal, and a fact a handler holds is a fact a later edit can leak.
 */
export interface AccountReadsBackend {
  /** Section 6's `GET /accounts/:accountId/marks`. Rows, not a page. */
  readMarks(
    session: AuthSession,
    accountId: string,
    page: PageRequest,
  ): Promise<MarksSnapshot | null>;
  /** Section 6's `GET /accounts/:accountId/timeline`. */
  readTimeline(
    session: AuthSession,
    accountId: string,
    page: PageRequest,
  ): Promise<TimelinePage | null>;
  /** Section 6's `GET /accounts/:accountId/eligibility`. */
  readEligibility(session: AuthSession, accountId: string): Promise<EligibilityResponse | null>;
  /** Section 6's `GET /accounts/:accountId/certificate?kind=`. */
  readCertificate(
    session: AuthSession,
    accountId: string,
    kind: CertificateKind,
  ): Promise<CertificateResponse | null>;
}

const NO_BACKEND_AT_ALL =
  'no account-reads backend is installed. `useAccountReadsBackend` was never called, so this ' +
  'process holds the fail-closed default rather than an implementation. A deployment reaching ' +
  'this line has not run its wiring, which is `start.ts`';

function unwired(method: string): () => Promise<never> {
  return () => Promise.reject(new AccountReadsBackendUnwired(method, NO_BACKEND_AT_ALL));
}

/**
 * The fail-closed default.
 *
 * A process that never ran `start.ts` answers 503 on all four routes, saying so
 * rather than pretending. `index.ts` is this package's `exports` target and
 * importing it must have no effect.
 */
export const UNWIRED_ACCOUNT_READS_BACKEND: AccountReadsBackend = {
  readMarks: unwired('readMarks'),
  readTimeline: unwired('readTimeline'),
  readEligibility: unwired('readEligibility'),
  readCertificate: unwired('readCertificate'),
};

let backend: AccountReadsBackend = UNWIRED_ACCOUNT_READS_BACKEND;

/** Install the backend. `start.ts` calls this; so does the suite. */
export function useAccountReadsBackend(next: AccountReadsBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetAccountReadsBackend(): void {
  backend = UNWIRED_ACCOUNT_READS_BACKEND;
}

/** The installed backend. */
export function currentAccountReadsBackend(): AccountReadsBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// Query parsing. Section 1's pagination rule, and section 6's `?kind=`
// -----------------------------------------------------------------------------

/** Section 1: "`limit` maximum 100, default 25". */
export const LIMIT_DEFAULT = 25;
export const LIMIT_MAX = 100;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One query parameter as a string, or `null` when absent or repeated. */
function queryParam(request: FastifyRequest, name: string): string | null {
  const query = asRecord(request.query);
  if (query === null) return null;
  const value = query[name];
  return typeof value === 'string' ? value : null;
}

function accountIdParam(request: FastifyRequest): string | null {
  const params = asRecord(request.params);
  if (params === null) return null;
  const value = params['accountId'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `YYYY-MM-DD`. A trading day is `date` in every migration that stores one. */
const TRADING_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `?limit=` and `?cursor=`, section 1's rule.
 *
 * CURSOR ONLY, NEVER OFFSET, so there is no `?page=` and no `?offset=` to parse
 * and a caller sending one is not quietly served page one.
 *
 * THE CURSOR IS VALIDATED AS A TRADING DAY AND THAT IS NOT A LEAK OF ITS
 * FORMAT. Section 1 calls it `<opaque>`, which binds the CLIENT -- it must not
 * construct one -- and not the server, which has to reject a malformed one with
 * something. An unvalidated cursor reaches `atMost` and becomes a `date`
 * comparison against arbitrary text, which is a database error answered 500
 * where the contract wants `validation_failed`.
 */
export function readPaging(
  request: FastifyRequest,
  errors: FieldError[],
): { limit: number; cursor: string | null } {
  const rawLimit = queryParam(request, 'limit');
  let limit = LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > LIMIT_MAX)
      errors.push({ path: 'limit', message: `must be an integer from 1 to ${String(LIMIT_MAX)}` });
    else limit = parsed;
  }
  const rawCursor = queryParam(request, 'cursor');
  let cursor: string | null = null;
  if (rawCursor !== null && rawCursor.trim() !== '') {
    if (!TRADING_DAY.test(rawCursor))
      errors.push({ path: 'cursor', message: 'must be a cursor this endpoint issued' });
    else cursor = rawCursor;
  }
  return { limit, cursor };
}

/**
 * `?kind=pass|payout`, section 6's heading.
 *
 * THERE IS NO DEFAULT AND AN ABSENT `kind` IS A VALIDATION FAILURE. The
 * contract writes the parameter into the endpoint's own heading rather than
 * into an optional-query note, and the two kinds are different artifacts: a
 * pass card claims no amount and a payout card does. Guessing one would hand a
 * trader whichever card this file preferred.
 */
export function readKind(request: FastifyRequest, errors: FieldError[]): CertificateKind | null {
  const raw = queryParam(request, 'kind');
  if (raw === 'pass' || raw === 'payout') return raw;
  errors.push({ path: 'kind', message: 'must be `pass` or `payout`' });
  return null;
}

function sendValidationFailed(
  reply: FastifyReply,
  requestId: string,
  errors: readonly FieldError[],
): FastifyReply {
  return reply
    .code(400)
    .type(PROBLEM_MEDIA_TYPE)
    .send({ ...problem('validation_failed', 400, requestId), errors });
}

// -----------------------------------------------------------------------------
// The folds. `/marks` is the one served endpoint and the arithmetic is here
// -----------------------------------------------------------------------------

/** Raised when a snapshot cannot render the response the contract declares. */
export class AccountReadsRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountReadsRowError';
  }
}

/**
 * ONE `MarkListItem` PER TRADING DAY, AND THE ROW IS THE CURRENT ONE.
 *
 * THE CONTRACT UNDERDETERMINES THIS AND THE RULING IS REPORTED RATHER THAN
 * MADE QUIETLY. Section 6 says `corrected` is "true when this day has a
 * superseding mark", and `daily_marks`' grain is one row per account per
 * trading day WITH CORRECTIONS AS NEW ROWS, so a corrected day holds two rows
 * and the sentence reads two ways:
 *
 *   (a) EVERY ROW IS AN ITEM, `corrected = superseded_by IS NOT NULL`. The day
 *       appears twice, the chart draws two balances at one x, and the marked
 *       one is the SUPERSEDED row -- a balance Merit no longer asserts, plotted
 *       as if it did.
 *   (b) THE CURRENT ROW IS THE ITEM AND `corrected` SAYS THE DAY WAS CORRECTED.
 *       One point per day, the shape is what Merit asserts today, and the day
 *       whose shape changed is flagged.
 *
 * (b) IS TAKEN, on the money rule rather than on taste. `apps/portal`'s
 * `view/marks.ts` plots the series with NO deduplication and NO gap filling by
 * design, so under (a) the equity chart states a superseded balance as a fact
 * about somebody's money, and M04 section 4's obligation -- "a day carrying
 * `corrected: true` is VISIBLY MARKED, because a chart that silently changes
 * shape is how trust in the data goes" -- is about the day whose shape CHANGED,
 * which under (a) is the row the client is told is fine.
 *
 * (b) also makes the field non-trivial: the current row of a corrected day has
 * no superseding mark of its own, so a literal per-row reading of the sentence
 * against the rows this function returns would make `corrected` always false.
 *
 * A DAY WITH MORE THAN ONE UNSUPERSEDED MARK IS A BROKEN CHAIN AND IS REFUSED.
 * Guessing which of two current rows is current is guessing at somebody's
 * closing balance.
 */
export function projectMarks(snapshot: MarksSnapshot): readonly MarkListItem[] {
  const floors = new Map<string, MarkRuleStateRow>();
  for (const state of snapshot.ruleStates) floors.set(state.tradingDay, state);

  const currentByDay = new Map<string, MarkRow>();
  const correctedDays = new Set<string>();
  for (const mark of snapshot.marks) {
    if (mark.superseded) {
      correctedDays.add(mark.tradingDay);
      continue;
    }
    if (currentByDay.has(mark.tradingDay))
      throw new AccountReadsRowError(
        `trading day ${mark.tradingDay} carries two marks that nothing supersedes. A correction ` +
          'is a NEW row pointing the old one at it (0014_marks.sql), so exactly one row per day ' +
          'is current and choosing between two is guessing at a closing balance',
      );
    currentByDay.set(mark.tradingDay, mark);
  }

  const items: MarkListItem[] = [];
  for (const [tradingDay, mark] of currentByDay) {
    const state = floors.get(tradingDay);
    // NO `rule_states` ROW MEANS NO FLOOR AND NO WITHDRAWABLE, AND THE DAY IS
    // OMITTED RATHER THAN ZEROED. `accounts.ts`'s ruling, applied to the same
    // two columns: "a zero balance beside a zero floor is a readable, false
    // statement about somebody's money", and a floor of zero on a chart is a
    // breach line drawn where no breach line is.
    if (state === undefined) continue;
    items.push({
      trading_day: tradingDay,
      opening_balance_cents: centsToJson(mark.openingBalanceCents),
      closing_balance_cents: centsToJson(mark.closingBalanceCents),
      high_balance_cents: centsToJson(mark.highBalanceCents),
      low_balance_cents: centsToJson(mark.lowBalanceCents),
      realized_pnl_cents: centsToJson(mark.realizedPnlCents),
      traded_day: mark.tradedDay,
      win_day: mark.winDay,
      floor_cents: centsToJson(state.floorCents),
      withdrawable_cents: centsToJson(state.withdrawableCents),
      corrected: correctedDays.has(tradingDay),
    });
  }
  // "Cursor paginated by `trading_day` DESCENDING". `trading_day` is `date`,
  // rendered `YYYY-MM-DD`, so a lexical comparison IS the chronological one for
  // the whole domain -- `latestByAccount`'s reason for comparing days rather
  // than ids, taken as an ordering.
  items.sort((left, right) => (left.trading_day < right.trading_day ? 1 : -1));
  return items;
}

/**
 * One page, and the cursor that reaches the next one.
 *
 * THE CURSOR IS THE FIRST TRADING DAY NOT ON THIS PAGE AND IS INCLUSIVE, which
 * is a KEYSET cursor rather than an offset: section 1 says "cursor only, never
 * offset", and an offset would renumber every page behind it the moment a
 * correction landed. A day is a stable key here because
 * `daily_marks_account_day` holds one CURRENT row per day, so a cursor names
 * one boundary whatever else has changed.
 *
 * `next_cursor` IS `null` ON THE LAST PAGE AND NOT AN EMPTY STRING, section
 * 1's shape.
 */
export function pageOf(items: readonly MarkListItem[], limit: number): MarksPage {
  const data = items.slice(0, limit);
  const next = items[limit];
  return { data, next_cursor: next === undefined ? null : next.trading_day };
}

// -----------------------------------------------------------------------------
// The handlers
// -----------------------------------------------------------------------------

/**
 * Section 6's `GET /accounts/:accountId/marks`.
 *
 * THE VALIDATION RUNS BEFORE THE READ AND THAT IS NOT AN EXISTENCE ORACLE. A
 * malformed `?limit=` is 400 whether or not the account is the caller's,
 * because the parameter is wrong on its face and answering 404 first would make
 * the response depend on a fact the caller is not entitled to. What must never
 * be reordered is the account resolution against the DATA read, and there is
 * only one read here.
 */
export async function handleReadMarks(
  request: FastifyRequest,
  reply: FastifyReply,
  active: AccountReadsBackend,
  session: AuthSession,
): Promise<unknown> {
  const accountId = accountIdParam(request);
  if (accountId === null) return problemNotFound(reply, request.id);

  const errors: FieldError[] = [];
  const paging = readPaging(request, errors);
  if (errors.length > 0) return sendValidationFailed(reply, request.id, errors);

  // THE PORT RETURNS ROWS AND THIS FILE PAGES THEM, which is `accounts.ts`'s
  // split: the accessor has no LIMIT to push a page into, so putting the slice
  // in the adapter would put money arithmetic behind a database in the suite.
  const snapshot = await active.readMarks(session, accountId, paging);
  if (snapshot === null) return problemNotFound(reply, request.id);
  return pageOf(projectMarks(snapshot), paging.limit);
}

/** Section 6's `GET /accounts/:accountId/timeline`. */
export async function handleReadTimeline(
  request: FastifyRequest,
  reply: FastifyReply,
  active: AccountReadsBackend,
  session: AuthSession,
): Promise<unknown> {
  const accountId = accountIdParam(request);
  if (accountId === null) return problemNotFound(reply, request.id);

  const errors: FieldError[] = [];
  const paging = readPaging(request, errors);
  if (errors.length > 0) return sendValidationFailed(reply, request.id, errors);

  const page = await active.readTimeline(session, accountId, paging);
  if (page === null) return problemNotFound(reply, request.id);
  return page;
}

/** Section 6's `GET /accounts/:accountId/eligibility`. */
export async function handleReadEligibility(
  request: FastifyRequest,
  reply: FastifyReply,
  active: AccountReadsBackend,
  session: AuthSession,
): Promise<unknown> {
  const accountId = accountIdParam(request);
  if (accountId === null) return problemNotFound(reply, request.id);

  const response = await active.readEligibility(session, accountId);
  if (response === null) return problemNotFound(reply, request.id);
  return response;
}

/** Section 6's `GET /accounts/:accountId/certificate?kind=pass|payout`. */
export async function handleReadCertificate(
  request: FastifyRequest,
  reply: FastifyReply,
  active: AccountReadsBackend,
  session: AuthSession,
): Promise<unknown> {
  const accountId = accountIdParam(request);
  if (accountId === null) return problemNotFound(reply, request.id);

  const errors: FieldError[] = [];
  const kind = readKind(request, errors);
  if (kind === null) return sendValidationFailed(reply, request.id, errors);

  const response = await active.readCertificate(session, accountId, kind);
  if (response === null) return problemNotFound(reply, request.id);
  return response;
}

// -----------------------------------------------------------------------------
// The adapter. `apps/api` is in DB_ADMITTED as of ADR-120
// -----------------------------------------------------------------------------

function asRow(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new AccountReadsRowError(`a ${key} row is not an object`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, column: string, key: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new AccountReadsRowError(`${key}.${column} is not text on the row the accessor returned`);
  return value;
}

function flag(row: Record<string, unknown>, column: string, key: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean')
    throw new AccountReadsRowError(`${key}.${column} is not a boolean`);
  return value;
}

/**
 * A `bigint` money column.
 *
 * `accounts.ts`'s `cents`, and it is transcribed rather than imported for one
 * reason: that function is not exported, and exporting it would edit a file
 * outside this session's fence. Both spellings are accepted because `pg` hands
 * `bigint` back as a string by default and drizzle's `{ mode: 'bigint' }`
 * converts it; a `number` is REFUSED, because a `number` here would mean the
 * column was read through a path that already lost precision, and rounding it a
 * second time would hide that rather than report it.
 */
function cents(row: Record<string, unknown>, column: string, key: string): bigint {
  const value = row[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new AccountReadsRowError(
    `${key}.${column} is not an integer number of cents; it is ${typeof value}. Money is ` +
      'integer cents and no float reaches a financial path',
  );
}

/** `superseded_by`: present and non-null means a correction replaced this row. */
function superseded(row: Record<string, unknown>): boolean {
  const value = row['supersededBy'];
  return value !== null && value !== undefined;
}

function toMarkRow(value: unknown): MarkRow {
  const row = asRow(value, 'dailyMarks');
  return {
    tradingDay: text(row, 'tradingDay', 'dailyMarks'),
    openingBalanceCents: cents(row, 'openingBalanceCents', 'dailyMarks'),
    closingBalanceCents: cents(row, 'closingBalanceCents', 'dailyMarks'),
    highBalanceCents: cents(row, 'highBalanceCents', 'dailyMarks'),
    lowBalanceCents: cents(row, 'lowBalanceCents', 'dailyMarks'),
    realizedPnlCents: cents(row, 'realizedPnlCents', 'dailyMarks'),
    tradedDay: flag(row, 'tradedDay', 'dailyMarks'),
    winDay: flag(row, 'winDay', 'dailyMarks'),
    superseded: superseded(row),
  };
}

function toMarkRuleStateRow(value: unknown): MarkRuleStateRow {
  const row = asRow(value, 'ruleStates');
  return {
    tradingDay: text(row, 'tradingDay', 'ruleStates'),
    floorCents: cents(row, 'floorCents', 'ruleStates'),
    withdrawableCents: cents(row, 'withdrawableCents', 'ruleStates'),
  };
}

const TIMELINE_BLOCKER =
  '`events` is not a registered table. `packages/db/src/scope.ts` refuses it on the schema: ' +
  '`identity_id` and `account_id` are both nullable with no CHECK tying them, so a rule naming ' +
  '`identity_id` drops every account-level row and a rule hopping `account_id` drops every ' +
  'identity-level row, while EVENTS.md section 2 rows the portal timeline as PER-ACCOUNT and ' +
  'M04 section 5 consumes identity-level events on the same screen. The payload is the second ' +
  'refusal: `kyc.dedupe_hit` carries `matched_identity_id` inside `jsonb`, which no scope rule ' +
  'can express and which INV-M4-06 forbids the portal to receive. The table is in neither ' +
  '`TABLES` nor `SCOPE_RULES`, so no scope class reaches it and there is no door to open. ' +
  'Registering it is `packages/db/src/scope.ts`, which this session does not hold';

const ELIGIBILITY_BLOCKER =
  '`INV-M5-02` requires both payout endpoints to call `evaluatePayout` with identical inputs, ' +
  'and its `RuleState` argument has NO PRODUCER in this deployment. THE SCHEMA DELTA THIS ' +
  'REASON USED TO NAME IS SPENT: `0065_rule_state_lifetime_and_breach.sql` declares ' +
  '`lifetime_settled_cents`, `breached` and `breach_kind`, and ' +
  '`apps/worker/src/batch/state-writer.ts` maps all three, so `lifetimeSettledCents`, ' +
  '`breached` and `breachKind` ARE persistable now. Three things refuse instead, each measured ' +
  'rather than inherited. (1) `rule_states` HOLDS NO ROWS AND NOTHING IN A DEPLOYMENT WRITES ' +
  'ONE: the single insert site in this tree is `writeRuleStateVia`, its only caller is ' +
  '`runNightlyBatch`, no adapter implements `BatchPorts` over Postgres, and ' +
  '`apps/worker/src/index.ts` exports the batch without scheduling it. (2) EVEN GIVEN AN ' +
  'ADAPTER THE WRITER WOULD REFUSE: `RuleStateWriterIo.encodeEngineGates` has no ' +
  'implementation under any `src/`, and `UNWIRED_RULE_STATE_WRITER_IO` throws ' +
  '`RuleStateWriterUnwired` by name, because the stored encoding of `engine_gates` is `B5` ' +
  'term 2 and is a corpus amendment rather than a line of code. (3) THAT SAME ABSENCE BINDS ' +
  'THIS READER: `RuleState.engineGates` is `EngineGateResults`, `rule_states.engine_gates` is ' +
  '`jsonb`, and with a row in hand this adapter would still have to INVENT a decoding for that ' +
  'column. So the refusal is no longer about the schema and it is not weaker for that: serving ' +
  'a confident verdict computed off an empty table is a wrong answer where a 503 is an honest ' +
  'one. It clears when a row exists and its `engine_gates` encoding is declared, not before';

const CERTIFICATE_BLOCKER =
  'section 6 types `image_url` as a non-nullable "signed, time-limited" URL and nothing in this ' +
  'tree can produce one. `certificates` (0020_public_surface.sql) carries `code`, `claims`, ' +
  '`signature` and `signing_key_id` and NO image location column, so there is not even a stored ' +
  'value to sign; M11 section 5 rows this endpoint as shared with M4 and states that "M11 owns ' +
  'what is behind both", and the card renderer, the CDN origin and the URL signer are all M11 ' +
  "and none exists. Inventing an origin here would also break `apps/admin/src/origin.ts`'s rule " +
  'that a real hostname is a deployment fact and never a value this repository writes down. ' +
  'EVERY OTHER FIELD OF THE RESPONSE IS READABLE FROM `certificates` TODAY, so the blocker is ' +
  'one named field rather than the endpoint';

/**
 * The backend, against the real accessor.
 *
 * ONE OF FOUR METHODS IS SERVED AND THREE REFUSE BY NAME, which is
 * `databaseAuthBackend`'s shape and `databaseAccountsBackend`'s (two of three):
 * in every case the refusal carries the blocker rather than a shrug, and a
 * fixture serving real traffic is worse than a 503. THE AUTH COUNT IS NOT
 * RESTATED HERE and it read "(four of sixteen)" until session 410, stale since
 * ADR-200; `routes/auth.ts`'s port docblock states it once, in the form `RI-20`
 * settles.
 *
 * THE THREE REJECT RATHER THAN THROWING SYNCHRONOUSLY, which is `db.ts`'s own
 * ruling about its guard: "a method whose type says `Promise<T>` and which
 * sometimes throws before returning one is the shape a caller writing
 * `db.scoped(...).catch(...)` gets wrong".
 */
export function databaseAccountReads(db: ApiDb): AccountReadsBackend {
  return {
    async readMarks(
      session: AuthSession,
      accountId: string,
      page: PageRequest,
    ): Promise<MarksSnapshot | null> {
      return await db.scoped(session.identityId, async (tx) => {
        // THE WHOLE BOLA CONTROL IS THIS LINE, and it is `accounts.ts`'s line
        // rather than a second shape. `scopedDb(identityId)` ANDs tenancy onto
        // the address, so an id belonging to somebody else names ZERO ROWS and
        // comes back `undefined`. Nothing below compares an identity with an
        // identity, because nothing below has one to compare.
        //
        // IT IS ALSO WHAT MAKES THE 404 A 404. Without it a stranger's account
        // id would answer 200 with an empty page, which is the existence oracle
        // section 1 forbids stated in the other direction.
        const account = await tx.rowAt('accounts', { id: accountId });
        if (account === undefined || account === null) return null;

        // ADR-157's RANGE TERM, ON THE READ PATH, WHICH IS THE ONLY PLACE IT
        // EXISTS. `atMost` bounds the read ABOVE at the cursor; the accessor
        // still offers no ORDER BY and no LIMIT, so the ORDER and the PAGE are
        // `projectMarks` and `pageOf`. Both halves are filtered by the same
        // bound so the join cannot see a floor for a day whose mark was cut.
        const marks =
          page.cursor === null ? { accountId } : { accountId, tradingDay: atMost(page.cursor) };
        return {
          marks: (await tx.rowsWhere('dailyMarks', marks)).map(toMarkRow),
          ruleStates: (await tx.rowsWhere('ruleStates', marks)).map(toMarkRuleStateRow),
        };
      });
    },

    readTimeline(): Promise<TimelinePage | null> {
      return Promise.reject(new AccountReadsBackendUnwired('readTimeline', TIMELINE_BLOCKER));
    },

    readEligibility(): Promise<EligibilityResponse | null> {
      return Promise.reject(new AccountReadsBackendUnwired('readEligibility', ELIGIBILITY_BLOCKER));
    },

    readCertificate(): Promise<CertificateResponse | null> {
      return Promise.reject(new AccountReadsBackendUnwired('readCertificate', CERTIFICATE_BLOCKER));
    },
  };
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 6, in the document's order.
 *
 * ALL FOUR ARE `session` AND NONE IS ELEVATED. Section 6 states "Auth: session,
 * owner" on `/eligibility` in terms, and section 12's matrix rows the failure
 * directions for the whole family: unauthenticated to any `/accounts/*` is 401,
 * and user B reading user A's account is 404. NONE of the four is one of
 * section 12's `C-27:` actions -- they are reads of your own dashboard, and a
 * second factor in front of the screen a compromised account's owner loads TO
 * SEE that something is wrong is a control pointed the wrong way.
 *
 * "OWNER" IS NOT A SECOND `required` VALUE AND MUST NOT BECOME ONE. It is the
 * accessor's predicate, discharged in `databaseAccountReads` above, and a
 * factor table that spelled it would be a second control over one fact.
 */
export const ACCOUNT_READS_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: MARKS_PATH,
    required: 'session',
    handle: withSessionContext(
      async ({ request, reply, session }) =>
        await handleReadMarks(request, reply, currentAccountReadsBackend(), session),
    ),
  },
  {
    method: 'GET',
    path: TIMELINE_PATH,
    required: 'session',
    handle: withSessionContext(
      async ({ request, reply, session }) =>
        await handleReadTimeline(request, reply, currentAccountReadsBackend(), session),
    ),
  },
  {
    method: 'GET',
    path: ELIGIBILITY_PATH,
    required: 'session',
    handle: withSessionContext(
      async ({ request, reply, session }) =>
        await handleReadEligibility(request, reply, currentAccountReadsBackend(), session),
    ),
  },
  {
    method: 'GET',
    path: CERTIFICATE_PATH,
    required: 'session',
    handle: withSessionContext(
      async ({ request, reply, session }) =>
        await handleReadCertificate(request, reply, currentAccountReadsBackend(), session),
    ),
  },
];

/** The declaration as data, on `auth.ts`'s shape. */
export const ACCOUNT_READS_REQUIRED_FACTORS = requiredFactorTable(ACCOUNT_READS_ENDPOINTS);

export default defineRoutes({
  name: 'account-reads',
  routes: toRoutes(ACCOUNT_READS_ENDPOINTS),
});
