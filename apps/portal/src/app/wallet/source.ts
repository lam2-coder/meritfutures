// =============================================================================
// apps/portal/src/app/wallet/source.ts
// =============================================================================
// WHERE SC-M4-10's DATA COMES FROM. BOTH ENDPOINTS EXIST, BOTH ARE WIRED, AND
// BOTH WERE MEASURED RATHER THAN GREPPED.
//
// The dispatch protocol section 5: "`CompositionReport.registered` over a real
// `compose()` is the only reliable source for which routes exist. A grep over
// route files has been wrong twice." So `discoverRouteModules()` then
// `buildServer({ surface: 'public', modules })`, reading the report:
//
//   `GET /wallet`           REGISTERED
//   `GET /wallet/entries`   REGISTERED
//
// AND REGISTRATION IS NOT THE SAME QUESTION AS WIRING, so the second half was
// checked too. `apps/api/src/start.ts` calls
// `useWalletBackend(databaseWalletBackend(LIVE_DB))`, so both reads answer from
// the scoped accessor rather than raising `WalletBackendUnwired`. THIS SCREEN IS
// THE FIRST IN THIS APPLICATION WHOSE EVERY ENDPOINT IS BOTH REGISTERED AND
// WIRED: the payout centre waits on `GET /accounts/:accountId/eligibility` and
// the account detail waits on `GET /accounts/:accountId/marks`.
//
// -----------------------------------------------------------------------------
// TWO REQUESTS, NOT ONE, AND THE CONTRACT ASKED FOR IT IN THOSE WORDS
// -----------------------------------------------------------------------------
// API_CONTRACT section 6.2 keeps promotional credit off `GET /wallet` and
// explains the composition it expects instead: "a `promotional_credit_cents`
// field beside `balance_cents` is one client-side addition away from AS-M20-01,
// credit converted to cash, so THE WALLET SCREEN COMPOSES TWO READS rather than
// one response mixing two kinds of money."
//
// -----------------------------------------------------------------------------
// THE COPY IS THE THIRD READ AND IT HAS NO ENDPOINT, WHICH IS A REAL FINDING
// -----------------------------------------------------------------------------
// M04 section 3.5 rules the wallet's framing and its two exits' wording a
// `copy_blocks` entry (INV-M4-08) and a counsel-review item. ../../view/wallet.ts
// carries the slot; nothing can fill it, and the reason is structural rather
// than a missing endpoint:
//
//   `copy_blocks` IS A COLUMN ON `plan_versions`
//   (`packages/db/migrations/0004_catalog.sql`), and ../../copy/copy-block.ts's
//   `PinnedPlanCopy` is keyed on a plan id and a version because that is what
//   the column hangs off. A WALLET HAS NO PLAN VERSION. It is per-identity, it
//   outlives every account, and `GET /wallet` returns no copy field of any kind.
//
// SO THERE IS NO ROW FOR THE WALLET'S SENTENCES TO LIVE ON, and the portal may
// not substitute sentences of its own for them. `load` passes `copy: null` and
// the screen renders the absence. Reported rather than repaired: giving the
// wallet a copy source is a schema and contract question, not a portal one.
//
// -----------------------------------------------------------------------------
// AND THE SCREEN CAN NOW SAY "THIS FAILED", WHICH IT COULD NOT BEFORE
// -----------------------------------------------------------------------------
// `WalletLoad` HAD TWO ARMS AND A 401 RENDERED THROUGH THE UNAVAILABLE ONE,
// which reads "Your wallet cannot be shown right now. This is a problem on our
// side and your balance is unaffected." BOTH HALVES OF THAT SENTENCE ARE FALSE
// TO A TRADER WHOSE SESSION EXPIRED: it is not a problem on our side,
// and telling someone who is signed out that we are broken is the screen
// authoring a fault that did not happen.
//
// ADR-162 FORECLOSURE 1 RECORDED THIS GAP ON `app/payouts/source.ts` AND SAID
// THE REPAIR "IS NOT ONE FILE": an error arm needs ./sections.ts to render it
// and ./page.ts to branch on it, and that session's fence held neither. This
// session's fence holds all three, which is the only thing that changed.
// ADR-217 is the ruling and it was taken because the segments DISAGREE rather
// than because one was missing a spelling.
//
// THE BOUNDARY IS 404 AND IT IS THE CONTRACT'S OWN, NOT A PREFERENCE.
// API_CONTRACT section 6.2 rules that "an identity with no `wallet_entries` row
// is `0` and not a `404`", so on THIS screen a 404 can never be a data
// condition: it can only mean the route is not served. That is what
// `unavailable` has always meant here, so 404 keeps it and keeps naming WHICH
// endpoint. Everything that reached a server which then refused or failed --
// 401, 429, 5xx, a transport that never connected, a 2xx whose body is not
// JSON -- is `error`, carrying the `PortalErrorKind` ../../shell/app-shell.ts
// already derived.

import type { WalletEntry, WalletProvenance, WalletResponse } from '../../api/types.ts';
import type { ApiClient, ApiFailure, ApiResult } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import { toWalletView } from '../../view/wallet.ts';
import type { WalletCopy, WalletView } from '../../view/wallet.ts';

/** The two endpoints M04 section 3.5 composes this screen from. */
export const REQUIRED_ENDPOINTS = ['GET /wallet', 'GET /wallet/entries'] as const;

/** The paths, without API_CONTRACT's base path. ../../http/client.ts appends it. */
export const WALLET_PATH = '/wallet';
export const WALLET_ENTRIES_PATH = '/wallet/entries';

/**
 * The `error` arm's payload. `ApiFailure` WITHOUT THE DISCRIMINANT, AND DERIVED
 * RATHER THAN DECLARED.
 *
 * `app/accounts/source.ts`, `app/(purchases)/source.ts` and
 * `app/calendar/load.ts` each declare this shape by hand, under three names,
 * carrying the same doc sentence three times. `Omit` states it once and the
 * compiler keeps it true: a field added to `ApiFailure` arrives here, and a
 * hand-written copy would not notice. ADR-217 rules the other three onto this
 * spelling; they are outside this fence and are reported rather than changed.
 */
export type WalletFailure = Omit<ApiFailure, 'ok'>;

/**
 * What the page got.
 *
 * `unavailable` IS STILL NOT AN ERROR STATE and the arm did not change meaning:
 * nothing is in flight, nothing is absent from a populated response, and
 * nothing failed. What changed is that FAILURES NO LONGER ARRIVE HERE. The arm
 * now carries only the two cases that genuinely mean "this deployment cannot
 * reach the endpoint" -- no `MERIT_API_ORIGIN`, or a 404 -- and it still names
 * WHICH one rather than assuming both.
 *
 * `error` IS THE THIRD STATE AND IT IS RULED RATHER THAN INVENTED (ADR-217).
 * It is every read that reached a server which then refused or failed, and it
 * carries the kind so ./sections.ts can say the true sentence rather than the
 * one sentence that used to cover all of them.
 */
export type WalletLoad =
  | { readonly kind: 'ready'; readonly view: WalletView; readonly copy: WalletCopy | null }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] }
  | ({ readonly kind: 'error' } & WalletFailure);

/**
 * Build the screen from two responses.
 *
 * EXPORTED SEPARATELY FROM `load` SO THE READY BRANCH IS EXERCISED BY THE SUITE
 * OVER TRANSCRIBED RESPONSES, which is `app/payouts/source.ts`'s `readyFrom` and
 * the reason that screen was proven against data long before it could fetch any.
 * Here the branch is reachable from a browser too, so this function is the
 * screen's contract test rather than its only exercise.
 */
export function readyFrom(input: {
  readonly wallet: WalletResponse;
  readonly entries: readonly WalletEntry[];
  readonly next_cursor: string | null;
  readonly copy: WalletCopy | null;
}): WalletLoad {
  return { kind: 'ready', view: toWalletView(input), copy: input.copy };
}

// -----------------------------------------------------------------------------
// Narrowing, which is this segment's and not the transport's
// -----------------------------------------------------------------------------
// ../../http/client.ts returns `unknown` and argues why: "a generic `get<T>` is
// a cast the compiler cannot check". So the check is here, beside the shapes
// ../../api/types.ts transcribed.

/**
 * Every member of `WalletProvenance`, as a lookup the compiler keeps complete.
 *
 * `Record<WalletProvenance, true>` IS THE MECHANISM and it is
 * `app/payouts/source.ts`'s `PAYOUT_STATUSES`: a member added to the union in
 * ../../api/types.ts and not added here is `error TS2741`, so this list cannot
 * drift from the union it guards the way a hand-written array of strings would.
 *
 * IT MATTERS MORE HERE THAN IT DOES THERE. `0011`'s CHECK is what keeps
 * `promotional_credit` off this wire, and API_CONTRACT section 6.2 states the
 * consequence of letting it on: a promotional figure beside the balance "is one
 * client-side addition away from AS-M20-01, credit converted to cash". A guard
 * that quietly admitted a fourth value is how it would arrive.
 */
const PROVENANCES: Readonly<Record<WalletProvenance, true>> = {
  payout: true,
  refund_wallet_funded: true,
  correction: true,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * An integer.
 *
 * INTEGER RATHER THAN NUMBER, AND ON THE MONEY FIELDS SPECIFICALLY. A server
 * that sent `180000.5` would reach ../../format/money.ts, which throws a
 * `RangeError` rather than rendering it -- so this check is not what makes the
 * screen safe, it is what makes the refusal happen at the boundary where the
 * honest answer is "the response was malformed" instead of inside a formatter
 * where it is a crash.
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isHold(value: unknown): boolean {
  return (
    isRecord(value) &&
    value['rule'] === 'chargeback_window' &&
    isInteger(value['cents']) &&
    isString(value['since']) &&
    (value['available_at'] === null || isString(value['available_at']))
  );
}

/**
 * `GET /wallet`, narrowed.
 *
 * EVERY FIELD THE VIEW READS IS CHECKED AND NOT A SUBSET, which is
 * `app/payouts/source.ts`'s rule: "A partial guard reads as a complete one at
 * the call site and crashes on the field it skipped, which is worse than no
 * guard at all because it looks like a control."
 *
 * THE SUM IS NOT CHECKED HERE AND THE OMISSION IS DELIBERATE. Asserting
 * `balance_cents === withdrawable_cents + held_cents` would be arithmetic on
 * three `_cents` fields in portal source, which is exactly what INV-M4-01 bans
 * and what `test/inv-m4-01.test.ts` fails on. The contract states the identity
 * so that the SERVER holds it; a client that verified it would be the second
 * place it is computed, and the disagreement would render as a crash on a screen
 * whose whole job is to be trusted about a balance.
 */
export function isWalletResponse(value: unknown): value is WalletResponse {
  if (!isRecord(value)) return false;
  const holds = value['holds'];
  return (
    isInteger(value['balance_cents']) &&
    isInteger(value['withdrawable_cents']) &&
    isInteger(value['held_cents']) &&
    Array.isArray(holds) &&
    holds.every(isHold) &&
    isString(value['as_of'])
  );
}

function isEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const direction = value['direction'];
  if (direction !== 'credit' && direction !== 'debit') return false;

  // THE CLOSED CREDIT LIST, CHECKED ON CREDITS AND NOT ON DEBITS, because that
  // is what the contract declares: `WalletDebit` carries NO `provenance` and its
  // absence "is the schema reported honestly rather than a field forgotten".
  // Requiring one on a debit would reject every debit the server sends.
  if (direction === 'credit') {
    const provenance = value['provenance'];
    if (typeof provenance !== 'string') return false;
    if (!Object.prototype.hasOwnProperty.call(PROVENANCES, provenance)) return false;
  }

  return (
    // A DECIMAL STRING AND NEVER PARSED. API_CONTRACT: `wallet_entries.id` is a
    // bigint and a JSON number "admits a value above `Number.MAX_SAFE_INTEGER`
    // that has already lost digits by the time anything reads it".
    isString(value['entry_id']) &&
    isInteger(value['amount_cents']) &&
    isString(value['cause']) &&
    isString(value['reference_id']) &&
    isString(value['ledger_transaction_id']) &&
    isInteger(value['balance_after_cents']) &&
    isString(value['occurred_at'])
  );
}

/** `GET /wallet/entries`, narrowed to section 1's envelope over section 6.2's items. */
export function isEntriesResponse(
  value: unknown,
): value is { readonly data: readonly WalletEntry[]; readonly next_cursor: string | null } {
  if (!isRecord(value)) return false;
  const data = value['data'];
  const cursor = value['next_cursor'];
  return Array.isArray(data) && data.every(isEntry) && (cursor === null || isString(cursor));
}

// -----------------------------------------------------------------------------
// The seam
// -----------------------------------------------------------------------------

/**
 * The screen, from a client.
 *
 * EXPORTED SO THE SUITE REACHES IT THROUGH THE REAL CLIENT rather than through a
 * mock of it: `test/wallet-source.test.ts` calls this with a client built by
 * `createApiClient` over a stub transport, which exercises the whole seam --
 * URL composition, the session cookie, `no-store`, status mapping, JSON, the
 * guards, and the view.
 *
 * BOTH READS ARE ISSUED AND NEITHER IS SKIPPED ON THE OTHER'S FAILURE. They are
 * independent endpoints and a balance that renders without its statement is
 * still the balance; reporting both misses at once is what lets the screen name
 * which one is missing.
 */
/**
 * One read, sorted into the three things it can be.
 *
 * `not_found` IS THE ONLY STATUS THAT BECOMES `absent`, and the contract is
 * what makes that safe rather than a preference. API_CONTRACT section 6.2:
 * "an identity with no `wallet_entries` row is `0` and not a `404`". A 404 on
 * either of these paths therefore cannot be a trader with an empty wallet; it
 * can only be a route this deployment does not serve, which is what
 * `unavailable` has always meant on this screen.
 *
 * A MALFORMED 2xx IS A FAILURE AND NOT AN ABSENCE. The guard rejecting a body
 * means a server answered and answered wrongly, which is `server_error` for
 * `../../http/client.ts`'s own reason -- the trader can do nothing about it and
 * no other member of the vocabulary is true. `status` is carried because there
 * WAS one, which is what keeps it distinguishable from a transport that never
 * reached a status line.
 */
function sorted<T>(
  result: ApiResult,
  guard: (value: unknown) => value is T,
):
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly failure: WalletFailure } {
  if (!result.ok) {
    if (result.error === 'not_found') return { kind: 'absent' };
    return { kind: 'failed', failure: { error: result.error, status: result.status } };
  }
  if (guard(result.body)) return { kind: 'value', value: result.body };
  return { kind: 'failed', failure: { error: 'server_error', status: null } };
}

export async function loadFrom(input: {
  readonly client: ApiClient;
  readonly copy: WalletCopy | null;
}): Promise<WalletLoad> {
  const [walletResponse, entriesResponse] = await Promise.all([
    input.client.get(WALLET_PATH),
    input.client.get(WALLET_ENTRIES_PATH),
  ]);

  const wallet = sorted(walletResponse, isWalletResponse);
  const entries = sorted(entriesResponse, isEntriesResponse);

  // A FAILURE ON EITHER READ DECIDES THE SCREEN, AND IT OUTRANKS AN ABSENCE ON
  // THE OTHER. The two arms say different things to a trader and only one of
  // them can be shown, so the rule is the one that cannot state a falsehood: a
  // 401 on the statement beside a 404 on the balance is a trader who is signed
  // out, and rendering "this is a problem on our side" over it would be the
  // exact sentence this arm exists to stop.
  //
  // THE BALANCE READ WINS A TIE BECAUSE IT IS THE SCREEN'S SUBJECT. `GET
  // /wallet` is what SC-M4-10 is; the statement is what it is composed with.
  if (wallet.kind === 'failed') return { kind: 'error', ...wallet.failure };
  if (entries.kind === 'failed') return { kind: 'error', ...entries.failure };

  const missing: string[] = [];
  if (wallet.kind === 'absent') missing.push(REQUIRED_ENDPOINTS[0]);
  if (entries.kind === 'absent') missing.push(REQUIRED_ENDPOINTS[1]);

  if (wallet.kind !== 'value' || entries.kind !== 'value') return { kind: 'unavailable', missing };

  return readyFrom({
    wallet: wallet.value,
    entries: entries.value.data,
    next_cursor: entries.value.next_cursor,
    copy: input.copy,
  });
}

/**
 * What ./page.ts calls.
 *
 * `copy: null` IS A MEASUREMENT AND NOT A PLACEHOLDER. See this file's header:
 * `copy_blocks` hangs off `plan_versions` and a wallet has no plan version, so
 * there is no row the wallet's sentences could be published on. Whoever gives
 * them a source passes them here and nothing else in this segment changes.
 */
export async function load(): Promise<WalletLoad> {
  let client: ApiClient;
  try {
    client = await serverApiClient();
  } catch (error) {
    // ONLY `ApiConfigError`, WHICH IS `app/payouts/source.ts`'s NARROWNESS AND
    // ITS ARGUMENT: `MERIT_API_ORIGIN` unset means this deployment has no API,
    // so both endpoints are unreachable, which is what `unavailable` already
    // says. Anything else propagates, because converting it would make every
    // fault in this application look like a pending endpoint.
    if (!(error instanceof ApiConfigError)) throw error;
    return { kind: 'unavailable', missing: [...REQUIRED_ENDPOINTS] };
  }

  return loadFrom({ client, copy: null });
}
