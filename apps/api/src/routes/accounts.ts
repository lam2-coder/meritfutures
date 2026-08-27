// =============================================================================
// apps/api/src/routes/accounts.ts
// =============================================================================
// API_CONTRACT SECTION 6's `GET /accounts` AND `GET /accounts/:accountId`.
//
// TWO ROUTES AND NOT THE FOUR THIS SESSION WAS DISPATCHED FOR, and both
// subtractions are measurements rather than judgement calls:
//
//   * `POST /accounts/:accountId` IS NOT IN API_CONTRACT. Section 6 declares
//     `GET /accounts`, `GET /accounts/:accountId`, `/marks`, `/timeline`,
//     `/eligibility`, `/payout` and `/certificate`, and section 5 declares
//     `/reset`. There is no bare `POST /accounts/:accountId` in the document.
//     STATE: "A behavior not in the corpus is not in scope."
//   * `POST /accounts/:accountId/reset` ALREADY EXISTS, in
//     `routes/checkout.ts`, declared through its `RESET_PATH`. Declaring it
//     here a second time is not a merge conflict, it is a STARTUP FAILURE:
//     `compose` refuses a duplicate `METHOD /path` across the whole module set
//     by design, so the deployable would not boot.
//
// ADR-139 records both, with the measurement beside each.
//
// -----------------------------------------------------------------------------
// THE FOUR MONEY FIELDS ARE NOT ON `accounts`, AND THAT IS THE ONE THING A
// READER OF THE CONTRACT ALONE GETS WRONG
// -----------------------------------------------------------------------------
// `AccountListItem` carries `balance_cents`, `floor_cents`,
// `withdrawable_cents` and `as_of_trading_day`. NONE of them is a column of
// `accounts` (`0007_accounts.sql`). All four come from `rule_states`
// (`0015_rule_states.sql`), whose grain is ONE ROW PER ACCOUNT PER TRADING DAY,
// and the row this endpoint reads is the one for the latest `trading_day`:
//
//   balance_cents       <- rule_states.balance_cents, "end-of-day balance"
//   floor_cents         <- rule_states.floor_cents,   "the floor AFTER this day"
//   withdrawable_cents  <- rule_states.withdrawable_cents, CHECK (>= 0)
//   as_of_trading_day   <- that row's trading_day
//
// `floor_open_cents` IS THE TRAP AND IT IS NOT THIS FIELD. SD-04 put two floors
// on the row on purpose: `floor_cents` survived the day and `floor_open_cents`
// is the one the day was JUDGED against, and 0015 says why the distinction is
// load bearing -- "a breach explanation reads 'your low was below the floor'
// while showing a floor the low was never compared to". The dashboard shows the
// floor that is open NOW, which is the one that survived.
//
// ALL FOUR COME OFF ONE ROW AND THAT IS DELIBERATE. Taking the balance from
// `daily_marks.closing_balance_cents` and the floor from `rule_states` would be
// two rows and possibly two days, and section 6's own sentence -- "the last
// closed day; EVERY NUMBER ABOVE IS AS OF THIS DATE" -- is a promise that they
// are one.
//
// AN ACCOUNT WITH NO `rule_states` ROW HAS NO AS-OF DAY AND SAYS SO. A freshly
// provisioned account has none, and the alternative to reporting absence is
// reporting zeroes: a zero balance beside a zero floor is a readable, false
// statement about somebody's money.
//
// -----------------------------------------------------------------------------
// MONEY IS `bigint` INSIDE THIS FILE AND `number` ONLY ON THE WIRE
// -----------------------------------------------------------------------------
// `checkout.ts`'s rule and the schema's: every money column named above is
// `bigint NOT NULL` in `0015`. `centsToJson` is imported from `checkout.ts`
// rather than transcribed, because a second copy of "refuse past
// MAX_SAFE_INTEGER rather than round" is a second thing to get wrong.
//
// -----------------------------------------------------------------------------
// THE BOLA PROPERTY IS STRUCTURAL AND IS NOT A CHECK THIS FILE MAKES
// -----------------------------------------------------------------------------
// Section 1: "A path parameter naming a resource the caller does not own
// returns 404 (not 403) on trader surfaces, so the API does not confirm the
// existence of other people's resources." Section 6 repeats it on this exact
// endpoint: "not_found (including for accounts owned by someone else,
// deliberately)."
//
// THIS FILE COMPARES NO IDENTITY WITH ANY OTHER IDENTITY, AND THAT IS THE
// DESIGN. `scopedDb(identityId)` ANDs tenancy onto the address (ADR-112), so
// `rowAt('accounts', { id })` on identity A naming identity B's account reaches
// ZERO ROWS. `undefined` becomes the 404. An ownership comparison written here
// would be a second control over the same fact, and the failure mode of two
// controls is that the weaker one is the one that runs.
//
// -----------------------------------------------------------------------------
// `AccountDetail.progress` IS REFUSED BY NAME, AND THE CONTRACT'S OWN
// NULLABILITY IS WHAT FORCES THE REFUSAL RATHER THAN THIS SESSION'S FENCE
// -----------------------------------------------------------------------------
// Section 6 types five members of `progress` as NON-NULLABLE and every one of
// them is a plan parameter:
//
//   win_days.need, win_days.floor_cents, traded_days.need, cadence.need,
//   ladder.payouts_to_graduate
//
// `0004_catalog.sql` states the rule they fall under: "THERE IS NO PLAN
// PARAMETER ANYWHERE IN APPLICATION CODE." The sanctioned reader of
// `plan_versions.rules` is `resolvePlan` in `@merit/rules-engine`, and
// `apps/api/package.json` does not declare that package; `.npmrc` sets
// `node-linker=isolated`, so an undeclared import fails at run time and, since
// ADR-120, under `tsc` as well.
//
// So the contract permits no null there, the corpus permits no literal here,
// and the dependency line is outside this session's fence. A SIXTH MEMBER,
// `cadence.next_eligible_trading_day`, IS UNREACHABLE THROUGH EVERY DOOR:
// `trading_calendar` is refused registration in `packages/db/src/schema.ts`
// because `0032` carries an `ALTER TABLE ... DROP NOT NULL` that ADR-094's
// one-member vocabulary refuses, so the table is in neither `TABLES` nor
// `SCOPE_RULES` and no scope class reaches it.
//
// `readProgress` therefore raises `AccountsBackendUnwired` from the database
// adapter, carrying both blockers, and the route answers `503
// service_unavailable`. That is `databaseAuthBackend`'s shape exactly: it
// implements four of sixteen methods and refuses the other twelve by name. A
// fixture serving real traffic is worse than a 503, and a hardcoded `need` is
// the fixture the invariant exists to lock out.
//
// `GET /accounts` NEEDS NO PLAN PARAMETER AND NO CALENDAR, AND IS SERVED END TO
// END. That asymmetry is the whole reason the two endpoints have separate port
// methods rather than one.
//
// -----------------------------------------------------------------------------
// THE PORT RETURNS ROWS AND THIS FILE FOLDS THEM
// -----------------------------------------------------------------------------
// The accessor offers no ORDER BY and no LIMIT, so "the latest trading day" is
// a fold rather than a query, and the fold is money arithmetic: which row the
// balance comes off, and `balance - floor`. Putting it in the adapter would put
// it behind a database in the suite. It is here, and `latestByAccount` and
// `floorDistanceCents` are exported so the suite names them directly.
// =============================================================================

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiDb } from '../db.ts';
import { defineRoutes } from '../registry.ts';
import {
  AuthBackendUnwired,
  problemNotFound,
  requiredFactorTable,
  toRoutes,
  withSessionContext,
  type AuthSession,
  type EndpointSpec,
} from './auth.ts';
import { centsToJson } from './checkout.ts';

/** API_CONTRACT section 6's rows, as the contract writes them. No base path. */
export const ACCOUNTS_PATH = '/accounts';
export const ACCOUNT_PATH = '/accounts/:accountId';

// -----------------------------------------------------------------------------
// The wire, section 6's own shapes
// -----------------------------------------------------------------------------

/**
 * `account_phase`, the enum's four members.
 *
 * `0001_extensions_and_enums.sql`:
 * `CREATE TYPE account_phase AS ENUM ('eval', 'funded', 'closed', 'graduated')`.
 * Section 6's union is this list member for member, which is worth recording:
 * the contract and the schema AGREE here, and ADR-113's precedent only bites
 * where they do not.
 */
export type AccountPhase = 'eval' | 'funded' | 'closed' | 'graduated';

/** `account_status`, the enum's seven members. `0001`, and section 6's union. */
export type AccountStatus =
  | 'provisioning_pending'
  | 'active'
  | 'breached'
  | 'expired'
  | 'closed_admin'
  | 'closed_chargeback'
  | 'graduated';

/** `accounts.platform`'s CHECK list. `0007_accounts.sql`, and section 6's union. */
export type AccountPlatform = 'rithmic' | 'tradovate' | 'cqg';

/** `kyc_status`, the enum's five members. `0001`, and section 3's `Me.kyc.state`. */
export type KycState = 'kyc_required' | 'pending' | 'verified' | 'rejected' | 'expired';

/** Section 6's `plan` block: what the card names the account's product. */
export interface AccountPlanRef {
  readonly plan_id: string;
  readonly code: string;
  readonly name: string;
  readonly version: number;
}

/**
 * Section 6's `blocked` block.
 *
 * TWO OF THE THREE ARE ACCOUNT LEVEL AND THE THIRD IS IDENTITY LEVEL, and 0007
 * says why the first two are not the identity's: "an investigation can be about
 * one account or about a person". `kyc_required` has no account column and no
 * correct one, because verification is of the person.
 */
export interface AccountBlocked {
  readonly payouts_frozen: boolean;
  readonly recon_blocked: boolean;
  readonly kyc_required: boolean;
}

/** Section 6's `AccountListItem`, field for field. */
export interface AccountListItem {
  readonly account_id: string;
  readonly plan: AccountPlanRef;
  readonly size_cents: number;
  readonly phase: AccountPhase;
  readonly status: AccountStatus;
  readonly balance_cents: number;
  readonly floor_cents: number;
  /** `balance - floor`, "the number traders actually watch". Computed here. */
  readonly floor_distance_cents: number;
  readonly withdrawable_cents: number;
  /** "The last closed day; every number above is as of this date." */
  readonly as_of_trading_day: string;
  readonly blocked: AccountBlocked;
}

/**
 * Section 6's `progress`.
 *
 * DECLARED IN FULL AND SERVED BY NOTHING IN THIS TREE. See the header: five of
 * its members are non-nullable plan parameters and a sixth needs a calendar no
 * scope class reaches. The type is written because the refusal is about WIRING
 * and not about SHAPE, and a port whose type was also missing would be a
 * blocker nobody could measure the size of.
 */
export interface AccountProgress {
  readonly profit_target_cents: number | null;
  readonly profit_cents: number | null;
  readonly buffer_cents: number | null;
  readonly buffer_progress_cents: number | null;
  readonly win_days: { readonly have: number; readonly need: number; readonly floor_cents: number };
  readonly traded_days: { readonly have: number; readonly need: number };
  readonly consistency: {
    readonly best_day_share_bp: number | null;
    readonly max_bp: number | null;
    readonly skipped: boolean;
  };
  readonly cadence: {
    readonly days_since_last_payout: number | null;
    readonly need: number;
    readonly next_eligible_trading_day: string | null;
  };
  readonly ladder: {
    readonly payouts_settled: number;
    readonly payouts_to_graduate: number;
  };
}

/** Section 6's `AccountDetail = AccountListItem & {...}`. */
export interface AccountDetail extends AccountListItem {
  readonly platform: AccountPlatform;
  readonly platform_account_ref: string | null;
  readonly front_end_permissions: readonly string[];
  readonly opened_on: string;
  readonly funded_on: string | null;
  readonly closed_on: string | null;
  readonly close_reason: string | null;
  readonly progress: AccountProgress;
  /** "The account's pinned plan version, rendered." */
  readonly rules_url: string;
}

// -----------------------------------------------------------------------------
// The rows this handler reads, in this handler's terms
// -----------------------------------------------------------------------------

/**
 * One `accounts` row, `0007_accounts.sql`.
 *
 * `identityId` IS ABSENT AND ITS ABSENCE IS THE POINT. The handler never sees a
 * tenancy column, so it cannot compare one, so the only thing standing between
 * identity A and identity B's account is the accessor's predicate, which is
 * where the corpus put it.
 */
export interface AccountRow {
  readonly accountId: string;
  readonly planVersionId: string;
  readonly sizeCents: bigint;
  readonly phase: AccountPhase;
  readonly status: AccountStatus;
  readonly platform: AccountPlatform;
  readonly platformAccountRef: string | null;
  readonly frontEndPermissions: readonly string[];
  readonly openedOn: string;
  readonly fundedOn: string | null;
  readonly closedOn: string | null;
  readonly closeReason: string | null;
  readonly payoutsFrozen: boolean;
  readonly reconBlocked: boolean;
}

/**
 * One `rule_states` row, reduced to what section 6 renders.
 *
 * The other twenty columns are not here, on section 1's allowlist rule read one
 * layer earlier than the response: a field that never enters the process cannot
 * leave it. `engine_gates` and `context_gates` in particular are
 * `/eligibility`'s and are somebody else's endpoint.
 */
export interface RuleStateRow {
  readonly accountId: string;
  /** `YYYY-MM-DD`, an exchange trading day and never a UTC date. */
  readonly tradingDay: string;
  readonly balanceCents: bigint;
  readonly floorCents: bigint;
  readonly withdrawableCents: bigint;
}

/** A `plan_versions` row joined to its `plans` row. Both are scope class `firm`. */
export interface PlanRow {
  readonly planVersionId: string;
  readonly planId: string;
  readonly code: string;
  readonly name: string;
  readonly version: number;
  /** `plan_versions.public_slug`. SD-M9-01: stable and permanent. */
  readonly publicSlug: string;
}

/**
 * Everything one response is rendered from, read in one unit of work.
 *
 * `ruleStates` IS EVERY ROW RATHER THAN THE LATEST ONE, because the accessor
 * offers no ORDER BY and no LIMIT and the fold is this file's (see the header).
 */
export interface AccountsSnapshot {
  readonly accounts: readonly AccountRow[];
  readonly ruleStates: readonly RuleStateRow[];
  /** One per distinct `planVersionId` among `accounts`. */
  readonly plans: readonly PlanRow[];
  /** The identity's current verification state. `kyc_required` when there is none. */
  readonly kycState: KycState;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * Thrown by a backend that cannot serve one method. Answered as 503, never 500.
 *
 * IT EXTENDS `AuthBackendUnwired` AND THE INHERITANCE IS THE WHOLE REASON IT
 * EXISTS. `endpointHandler` is the one place a 503 is produced -- its own
 * comment says so -- and it selects on that class. A sibling class would
 * type-check, read better, and escape that catch as an uncaught 500 carrying
 * the reason string into a response, which is exactly what API_CONTRACT section
 * 2 forbids: "never leaks internals". The name is wrong for this backend and
 * the behaviour is right, so the message is restated and the class is kept.
 *
 * THE REASON NEVER REACHES THE RESPONSE. It names tables, packages and ADRs.
 * `endpointHandler` logs the error and sends a bare 503.
 */
export class AccountsBackendUnwired extends AuthBackendUnwired {
  constructor(method: string, reason: string) {
    super(method, reason);
    this.name = 'AccountsBackendUnwired';
    this.message = `AccountsBackend.${method} cannot be served by this deployment: ${reason}`;
  }
}

/**
 * Everything section 6's two reads need from outside the process.
 *
 * `readAccount` RETURNS `null` FOR AN ACCOUNT THAT IS NOT THIS IDENTITY'S AND
 * FOR ONE THAT DOES NOT EXIST, and the two are deliberately the same value: a
 * port that distinguished them would hand the handler a fact section 1 forbids
 * it to reveal, and a fact a handler holds is a fact a later edit can leak.
 */
export interface AccountsBackend {
  /** Every account this identity holds. Section 6's `GET /accounts`. */
  readAccounts(session: AuthSession): Promise<AccountsSnapshot>;
  /** ONE account of this identity's, or `null`. Tenancy is the accessor's. */
  readAccount(session: AuthSession, accountId: string): Promise<AccountsSnapshot | null>;
  /** Section 6's `progress` block, for an account already resolved. */
  readProgress(session: AuthSession, account: AccountRow): Promise<AccountProgress>;
}

const NO_BACKEND_AT_ALL =
  'no accounts backend is installed. `useAccountsBackend` was never called, so this process ' +
  'holds the fail-closed default rather than an implementation. A deployment reaching this ' +
  'line has not run its wiring, which is `start.ts`';

function unwired(method: string): () => Promise<never> {
  return () => Promise.reject(new AccountsBackendUnwired(method, NO_BACKEND_AT_ALL));
}

/**
 * The fail-closed default.
 *
 * A process that never ran `start.ts` answers 503 on every accounts route,
 * saying so rather than pretending. `index.ts` is this package's `exports`
 * target and importing it must have no effect, which is the same separation
 * `UNWIRED_AUTH_BACKEND` draws.
 */
export const UNWIRED_ACCOUNTS_BACKEND: AccountsBackend = {
  readAccounts: unwired('readAccounts'),
  readAccount: unwired('readAccount'),
  readProgress: unwired('readProgress'),
};

let backend: AccountsBackend = UNWIRED_ACCOUNTS_BACKEND;

/** Install the backend. The wiring slice calls this; so does the suite. */
export function useAccountsBackend(next: AccountsBackend): void {
  backend = next;
}

/** Restore the fail-closed default. */
export function resetAccountsBackend(): void {
  backend = UNWIRED_ACCOUNTS_BACKEND;
}

/** The installed backend. */
export function currentAccountsBackend(): AccountsBackend {
  return backend;
}

// -----------------------------------------------------------------------------
// The folds. Money arithmetic, and it is here rather than in the adapter.
// -----------------------------------------------------------------------------

/**
 * The latest `rule_states` row per account.
 *
 * THE COMPARISON IS ON THE TRADING DAY AND NOT ON A ROW ID. `id` is
 * `GENERATED ALWAYS AS IDENTITY` and ascends with INSERT order, so a backfilled
 * or recomputed day would win an id comparison while describing an earlier day.
 * `trading_day` is `date`, rendered `YYYY-MM-DD`, so a lexical comparison IS the
 * chronological one for the whole domain.
 *
 * TIES ARE IMPOSSIBLE AND ARE NOT RESOLVED. `rule_states_account_day_uq` makes
 * `(account_id, trading_day)` unique, so a strict `>` cannot be reached twice
 * for one day. A tie-break written here would be dead code standing in for a
 * constraint.
 */
export function latestByAccount(rows: readonly RuleStateRow[]): ReadonlyMap<string, RuleStateRow> {
  const latest = new Map<string, RuleStateRow>();
  for (const row of rows) {
    const held = latest.get(row.accountId);
    if (held === undefined || row.tradingDay > held.tradingDay) latest.set(row.accountId, row);
  }
  return latest;
}

/**
 * Section 6's `floor_distance_cents`: "balance - floor, the number traders
 * actually watch".
 *
 * `bigint` SUBTRACTION AND NOT A `number` ONE. Both columns are `bigint NOT
 * NULL` in `0015` and the difference is signed: an account trading below its
 * floor between the breach and the status write has a negative distance, which
 * is a real state and not an error.
 */
export function floorDistanceCents(balanceCents: bigint, floorCents: bigint): bigint {
  return balanceCents - floorCents;
}

/**
 * `kyc_required`, as section 6's `blocked` block means it.
 *
 * ANYTHING BUT `verified` BLOCKS, and the word is the enum's own:
 * `kyc_status` is `('kyc_required','pending','verified','rejected','expired')`.
 * No verification at all is `kyc_required`, which is the fail-closed direction
 * and is what a person with no row has actually got.
 *
 * WHETHER THE GATE HAS FIRED YET IS A DIFFERENT QUESTION AND IS NOT ASKED HERE.
 * ADR-021 made placement a set of trigger events and `@merit/kyc`'s
 * `evaluateGate` is the one evaluator; `routes/kyc.ts` calls it. This field
 * reports the verification state and never re-decides the placement.
 */
export function kycRequired(state: KycState): boolean {
  return state !== 'verified';
}

// -----------------------------------------------------------------------------
// The projection. Section 1's API3 control: an allowlist, and it is a copy.
// -----------------------------------------------------------------------------

/** Raised when a snapshot cannot render the response the contract declares. */
export class AccountsRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountsRowError';
  }
}

function planFor(snapshot: AccountsSnapshot, account: AccountRow): PlanRow {
  const plan = snapshot.plans.find((row) => row.planVersionId === account.planVersionId);
  if (plan === undefined)
    throw new AccountsRowError(
      `account ${account.accountId} is pinned to plan version ${account.planVersionId} and the ` +
        'snapshot carries no such version. `accounts.plan_version_id` is `NOT NULL REFERENCES ' +
        'plan_versions(id) ON DELETE RESTRICT`, so this is a read that missed rather than a ' +
        'trader whose plan was deleted',
    );
  return plan;
}

/**
 * One `AccountListItem`, field by field.
 *
 * IT IS A COPY AND THAT IS THE POINT (`me.ts`'s words). Section 1: "Responses
 * list fields explicitly (allowlist), never `SELECT *` serialized ... a field
 * that is not in the schema below is not in the response, so an added column
 * never leaks by default."
 *
 * `null` WHEN THE ACCOUNT HAS NO MARK YET, rather than a zeroed item. See the
 * header: zeroes here are a false statement about money.
 */
export function projectListItem(
  snapshot: AccountsSnapshot,
  account: AccountRow,
  latest: ReadonlyMap<string, RuleStateRow>,
): AccountListItem | null {
  const state = latest.get(account.accountId);
  if (state === undefined) return null;
  const plan = planFor(snapshot, account);
  return {
    account_id: account.accountId,
    plan: {
      plan_id: plan.planId,
      code: plan.code,
      name: plan.name,
      version: plan.version,
    },
    size_cents: centsToJson(account.sizeCents),
    phase: account.phase,
    status: account.status,
    balance_cents: centsToJson(state.balanceCents),
    floor_cents: centsToJson(state.floorCents),
    floor_distance_cents: centsToJson(floorDistanceCents(state.balanceCents, state.floorCents)),
    withdrawable_cents: centsToJson(state.withdrawableCents),
    as_of_trading_day: state.tradingDay,
    blocked: {
      payouts_frozen: account.payoutsFrozen,
      recon_blocked: account.reconBlocked,
      kyc_required: kycRequired(snapshot.kycState),
    },
  };
}

/**
 * The rules page for a pinned plan version.
 *
 * PG-M9-03's path, transcribed rather than imported: `apps/site` owns
 * `planVersionRulesPath` and `RI-04` forbids an app depending on an app. It is
 * a PATH and not an absolute URL, for `origin.ts`'s reason about
 * `ADMIN_ORIGIN`: the public origin's real hostname is a deployment fact and
 * never a value this repository writes down.
 */
export function rulesPath(plan: PlanRow): string {
  return `/plans/${plan.publicSlug}/rules`;
}

/** One `AccountDetail`, field by field, on the same allowlist discipline. */
export function projectDetail(
  snapshot: AccountsSnapshot,
  account: AccountRow,
  latest: ReadonlyMap<string, RuleStateRow>,
  progress: AccountProgress,
): AccountDetail | null {
  const item = projectListItem(snapshot, account, latest);
  if (item === null) return null;
  return {
    ...item,
    platform: account.platform,
    platform_account_ref: account.platformAccountRef,
    front_end_permissions: [...account.frontEndPermissions],
    opened_on: account.openedOn,
    funded_on: account.fundedOn,
    closed_on: account.closedOn,
    close_reason: account.closeReason,
    progress: {
      profit_target_cents: progress.profit_target_cents,
      profit_cents: progress.profit_cents,
      buffer_cents: progress.buffer_cents,
      buffer_progress_cents: progress.buffer_progress_cents,
      win_days: {
        have: progress.win_days.have,
        need: progress.win_days.need,
        floor_cents: progress.win_days.floor_cents,
      },
      traded_days: { have: progress.traded_days.have, need: progress.traded_days.need },
      consistency: {
        best_day_share_bp: progress.consistency.best_day_share_bp,
        max_bp: progress.consistency.max_bp,
        skipped: progress.consistency.skipped,
      },
      cadence: {
        days_since_last_payout: progress.cadence.days_since_last_payout,
        need: progress.cadence.need,
        next_eligible_trading_day: progress.cadence.next_eligible_trading_day,
      },
      ladder: {
        payouts_settled: progress.ladder.payouts_settled,
        payouts_to_graduate: progress.ladder.payouts_to_graduate,
      },
    },
    rules_url: rulesPath(planFor(snapshot, account)),
  };
}

// -----------------------------------------------------------------------------
// The handlers
// -----------------------------------------------------------------------------

function accountIdParam(request: FastifyRequest): string | null {
  const params: unknown = request.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const value = (params as Record<string, unknown>)['accountId'];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Section 6's `GET /accounts`.
 *
 * AN ACCOUNT WITH NO MARK IS OMITTED RATHER THAN RENDERED WITH ZEROES, which is
 * the same ruling `projectListItem` makes and is applied here to the LIST: a
 * dashboard that showed a provisioning account at a zero balance beside a
 * floor of zero would be showing a breach that has not happened.
 */
export async function handleListAccounts(
  active: AccountsBackend,
  session: AuthSession,
): Promise<readonly AccountListItem[]> {
  const snapshot = await active.readAccounts(session);
  const latest = latestByAccount(snapshot.ruleStates);
  const items: AccountListItem[] = [];
  for (const account of snapshot.accounts) {
    const item = projectListItem(snapshot, account, latest);
    if (item !== null) items.push(item);
  }
  return items;
}

/**
 * Section 6's `GET /accounts/:accountId`.
 *
 * THE ORDER OF THE TWO PORT CALLS IS A SECURITY PROPERTY AND NOT A STYLE. The
 * account is resolved FIRST, so an account that is not this identity's is a 404
 * before `readProgress` is ever reached. Reversed, `readProgress`'s 503 would
 * answer for every id, and a 503 where a stranger's id gives 404 and a real id
 * gives 503 is the existence oracle section 1 forbids.
 */
export async function handleReadAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  active: AccountsBackend,
  session: AuthSession,
): Promise<unknown> {
  const accountId = accountIdParam(request);
  if (accountId === null) return problemNotFound(reply, request.id);

  const snapshot = await active.readAccount(session, accountId);
  if (snapshot === null) return problemNotFound(reply, request.id);
  const account = snapshot.accounts[0];
  if (account === undefined) return problemNotFound(reply, request.id);

  const progress = await active.readProgress(session, account);
  const latest = latestByAccount(snapshot.ruleStates);
  const detail = projectDetail(snapshot, account, latest, progress);
  if (detail === null) return problemNotFound(reply, request.id);
  return detail;
}

// -----------------------------------------------------------------------------
// The adapter. `apps/api` is in DB_ADMITTED as of ADR-120.
// -----------------------------------------------------------------------------

function asRow(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new AccountsRowError(`a ${key} row is not an object`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, column: string, key: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new AccountsRowError(`${key}.${column} is not text on the row the accessor returned`);
  return value;
}

function nullableText(row: Record<string, unknown>, column: string, key: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new AccountsRowError(`${key}.${column} is neither text nor null`);
  return value;
}

function flag(row: Record<string, unknown>, column: string, key: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean') throw new AccountsRowError(`${key}.${column} is not a boolean`);
  return value;
}

/**
 * A `bigint` money column.
 *
 * `pg` HANDS `bigint` BACK AS A STRING BY DEFAULT AND DRIZZLE'S
 * `{ mode: 'bigint' }` CONVERTS IT, so both spellings are accepted and a
 * `number` is REFUSED: a `number` here would mean the column was read through a
 * path that already lost precision, and rounding it a second time would hide
 * that rather than report it.
 */
function cents(row: Record<string, unknown>, column: string, key: string): bigint {
  const value = row[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new AccountsRowError(
    `${key}.${column} is not an integer number of cents; it is ${typeof value}. Money is ` +
      'integer cents and no float reaches a financial path',
  );
}

function count(row: Record<string, unknown>, column: string, key: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new AccountsRowError(`${key}.${column} is not an integer`);
  return value;
}

function permissions(row: Record<string, unknown>, key: string): readonly string[] {
  const value = row['frontEndPermissions'];
  if (!Array.isArray(value))
    throw new AccountsRowError(`${key}.frontEndPermissions is not an array`);
  return value.map((entry) => {
    if (typeof entry !== 'string')
      throw new AccountsRowError(`${key}.frontEndPermissions holds a non-string entry`);
    return entry;
  });
}

/** `phase`, `status` and `platform` are closed vocabularies and are checked as such. */
function member<T extends string>(
  row: Record<string, unknown>,
  column: string,
  key: string,
  allowed: readonly T[],
): T {
  const value = text(row, column, key);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined)
    throw new AccountsRowError(
      `${key}.${column} is \`${value}\`, which is not one of ${allowed.join(' | ')}. The set is ` +
        'the enum the migration declares, so a new member is a migration before it is a type',
    );
  return match;
}

const PHASES: readonly AccountPhase[] = ['eval', 'funded', 'closed', 'graduated'];
const STATUSES: readonly AccountStatus[] = [
  'provisioning_pending',
  'active',
  'breached',
  'expired',
  'closed_admin',
  'closed_chargeback',
  'graduated',
];
const PLATFORMS: readonly AccountPlatform[] = ['rithmic', 'tradovate', 'cqg'];
const KYC_STATES: readonly KycState[] = [
  'kyc_required',
  'pending',
  'verified',
  'rejected',
  'expired',
];

function toAccountRow(value: unknown): AccountRow {
  const row = asRow(value, 'accounts');
  return {
    accountId: text(row, 'id', 'accounts'),
    planVersionId: text(row, 'planVersionId', 'accounts'),
    sizeCents: cents(row, 'sizeCents', 'accounts'),
    phase: member(row, 'phase', 'accounts', PHASES),
    status: member(row, 'status', 'accounts', STATUSES),
    platform: member(row, 'platform', 'accounts', PLATFORMS),
    platformAccountRef: nullableText(row, 'platformAccountRef', 'accounts'),
    frontEndPermissions: permissions(row, 'accounts'),
    openedOn: text(row, 'openedOn', 'accounts'),
    fundedOn: nullableText(row, 'fundedOn', 'accounts'),
    closedOn: nullableText(row, 'closedOn', 'accounts'),
    closeReason: nullableText(row, 'closeReason', 'accounts'),
    payoutsFrozen: flag(row, 'payoutsFrozen', 'accounts'),
    reconBlocked: flag(row, 'reconBlocked', 'accounts'),
  };
}

function toRuleStateRow(value: unknown): RuleStateRow {
  const row = asRow(value, 'ruleStates');
  return {
    accountId: text(row, 'accountId', 'ruleStates'),
    tradingDay: text(row, 'tradingDay', 'ruleStates'),
    balanceCents: cents(row, 'balanceCents', 'ruleStates'),
    floorCents: cents(row, 'floorCents', 'ruleStates'),
    withdrawableCents: cents(row, 'withdrawableCents', 'ruleStates'),
  };
}

/**
 * The identity's current verification state.
 *
 * A RE-VERIFICATION IS A NEW ROW AND NOT A RE-READ (SD-M19-01, INV-M19-06), so
 * a scoped read returns the whole chain and the current row is the one NOTHING
 * SUPERSEDES. That is a property of the rows rather than of an ordering, so it
 * is read as one: `supersedes` reaches only other rows of this same table, and
 * `scope.ts` says so, so the chain never leaves the identity.
 *
 * NO ROW AT ALL IS `kyc_required`, which is the enum's own word for it.
 */
export function currentKycState(rows: readonly unknown[]): KycState {
  const parsed = rows.map((value) => {
    const row = asRow(value, 'kycVerifications');
    return {
      id: text(row, 'id', 'kycVerifications'),
      state: member(row, 'state', 'kycVerifications', KYC_STATES),
      supersedes: nullableText(row, 'supersedes', 'kycVerifications'),
    };
  });
  if (parsed.length === 0) return 'kyc_required';
  const superseded = new Set(
    parsed.map((row) => row.supersedes).filter((id): id is string => id !== null),
  );
  const live = parsed.filter((row) => !superseded.has(row.id));
  // A chain whose head cannot be named is not resolved by guessing at one. It
  // fails closed, because the alternative is reporting somebody verified on the
  // strength of an ordering this table does not declare.
  if (live.length !== 1) return 'kyc_required';
  return live[0]?.state ?? 'kyc_required';
}

function toPlanRow(planVersion: unknown, plan: unknown): PlanRow {
  const version = asRow(planVersion, 'planVersions');
  const root = asRow(plan, 'plans');
  return {
    planVersionId: text(version, 'id', 'planVersions'),
    planId: text(root, 'id', 'plans'),
    code: text(root, 'code', 'plans'),
    name: text(root, 'name', 'plans'),
    version: count(version, 'version', 'planVersions'),
    publicSlug: text(version, 'publicSlug', 'planVersions'),
  };
}

/**
 * The catalogue half of a snapshot, through the FIRM door.
 *
 * TWO DOORS AND TWO TRANSACTIONS FOR ONE RESPONSE, and that is what
 * `scope.ts` costs on purpose: `plans` and `plan_versions` are `class: 'firm'`
 * because "EVERY identity is sold the same plan version", and a `derived` rule
 * through them would not be a milder mistake, it would THROW.
 */
async function readCatalogue(
  db: ApiDb,
  planVersionIds: readonly string[],
): Promise<readonly PlanRow[]> {
  if (planVersionIds.length === 0) return [];
  return await db.firm(async (tx) => {
    const rows: PlanRow[] = [];
    for (const id of planVersionIds) {
      const version = await tx.rowAt('planVersions', { id });
      if (version === undefined) continue;
      const planId = text(asRow(version, 'planVersions'), 'planId', 'planVersions');
      const plan = await tx.rowAt('plans', { id: planId });
      if (plan === undefined) continue;
      rows.push(toPlanRow(version, plan));
    }
    return rows;
  });
}

/** The distinct plan versions a set of accounts is pinned to, in first-seen order. */
function pinnedVersions(accounts: readonly AccountRow[]): readonly string[] {
  return [...new Set(accounts.map((account) => account.planVersionId))];
}

/**
 * The backend, against the real accessor.
 *
 * TWO OF THREE METHODS ARE SERVED AND THE THIRD REFUSES BY NAME, which is
 * `databaseAuthBackend`'s shape: four of sixteen there, two of three here, and
 * in both cases the refusal carries the blocker rather than a shrug.
 */
export function databaseAccountsBackend(db: ApiDb): AccountsBackend {
  const snapshotFrom = async (
    accounts: readonly AccountRow[],
    ruleStates: readonly RuleStateRow[],
    kycRows: readonly unknown[],
  ): Promise<AccountsSnapshot> => ({
    accounts,
    ruleStates,
    plans: await readCatalogue(db, pinnedVersions(accounts)),
    kycState: currentKycState(kycRows),
  });

  return {
    async readAccounts(session: AuthSession): Promise<AccountsSnapshot> {
      const read = await db.scoped(session.identityId, async (tx) => ({
        accounts: (await tx.rows('accounts')).map(toAccountRow),
        // EVERY rule_states row this identity's accounts hold, in ONE read
        // rather than one per account: the fold is `latestByAccount`'s and the
        // accessor has no ORDER BY to push it into.
        ruleStates: (await tx.rows('ruleStates')).map(toRuleStateRow),
        kyc: await tx.rows('kycVerifications'),
      }));
      return await snapshotFrom(read.accounts, read.ruleStates, read.kyc);
    },

    async readAccount(session: AuthSession, accountId: string): Promise<AccountsSnapshot | null> {
      const read = await db.scoped(session.identityId, async (tx) => {
        // THE WHOLE BOLA CONTROL IS THIS LINE. `scopedDb(identityId)` ANDs
        // tenancy onto the address, so an id belonging to somebody else names
        // ZERO ROWS and comes back `undefined`. Nothing below compares an
        // identity with an identity, because nothing below has one to compare.
        const row = await tx.rowAt('accounts', { id: accountId });
        if (row === undefined || row === null) return null;
        const account = toAccountRow(row);
        return {
          account,
          ruleStates: (await tx.rowsWhere('ruleStates', { accountId })).map(toRuleStateRow),
          kyc: await tx.rows('kycVerifications'),
        };
      });
      if (read === null) return null;
      return await snapshotFrom([read.account], read.ruleStates, read.kyc);
    },

    // IT REJECTS RATHER THAN THROWING SYNCHRONOUSLY, which is `db.ts`'s own
    // ruling about its guard: "a method whose type says `Promise<T>` and which
    // sometimes throws before returning one is the shape a caller writing
    // `db.scoped(...).catch(...)` gets wrong".
    readProgress(): Promise<AccountProgress> {
      return Promise.reject(
        new AccountsBackendUnwired(
          'readProgress',
          'section 6 types `win_days.need`, `win_days.floor_cents`, `traded_days.need`, ' +
            '`cadence.need` and `ladder.payouts_to_graduate` as NON-NULLABLE, and every one is a ' +
            'plan parameter. `0004_catalog.sql`: there is no plan parameter anywhere in ' +
            'application code, and the sanctioned reader of `plan_versions.rules` is ' +
            '`resolvePlan` in `@merit/rules-engine`, which `apps/api` does not declare. ' +
            '`cadence.next_eligible_trading_day` is worse than undeclared: `trading_calendar` is ' +
            'refused registration in `packages/db/src/schema.ts` because `0032` carries an ' +
            '`ALTER TABLE ... DROP NOT NULL` that ADR-094 refuses, so it is in neither `TABLES` ' +
            'nor `SCOPE_RULES` and no scope class reaches it. See ADR-139',
        ),
      );
    },
  };
}

// -----------------------------------------------------------------------------
// The endpoints
// -----------------------------------------------------------------------------

/**
 * API_CONTRACT section 6, in the document's order.
 *
 * BOTH ARE `session` AND NEITHER IS ELEVATED. Section 6 states "Auth: session"
 * on `GET /accounts` and section 12's matrix rows the failure directions:
 * unauthenticated to any `/accounts/*` is 401, and user B reading
 * `GET /accounts/{A}` is 404. Neither row asks for a second factor, and reading
 * your own dashboard is not one of section 12's `C-27:` actions.
 */
export const ACCOUNTS_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: ACCOUNTS_PATH,
    required: 'session',
    handle: withSessionContext(
      async ({ session }) => await handleListAccounts(currentAccountsBackend(), session),
    ),
  },
  {
    method: 'GET',
    path: ACCOUNT_PATH,
    required: 'session',
    handle: withSessionContext(
      async ({ request, reply, session }) =>
        await handleReadAccount(request, reply, currentAccountsBackend(), session),
    ),
  },
];

/** The declaration as data, on `auth.ts`'s shape. */
export const ACCOUNTS_REQUIRED_FACTORS = requiredFactorTable(ACCOUNTS_ENDPOINTS);

export default defineRoutes({
  name: 'accounts',
  routes: toRoutes(ACCOUNTS_ENDPOINTS),
});
