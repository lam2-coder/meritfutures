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

import type { WalletEntry, WalletProvenance, WalletResponse } from '../../api/types.ts';
import type { ApiClient } from '../../http/client.ts';
import { ApiConfigError, serverApiClient } from '../../http/client.ts';
import { toWalletView } from '../../view/wallet.ts';
import type { WalletCopy, WalletView } from '../../view/wallet.ts';

/** The two endpoints M04 section 3.5 composes this screen from. */
export const REQUIRED_ENDPOINTS = ['GET /wallet', 'GET /wallet/entries'] as const;

/** The paths, without API_CONTRACT's base path. ../../http/client.ts appends it. */
export const WALLET_PATH = '/wallet';
export const WALLET_ENTRIES_PATH = '/wallet/entries';

/**
 * What the page got.
 *
 * `unavailable` IS NOT AN ERROR STATE, which is `app/payouts/source.ts`'s
 * argument and applies here unchanged: nothing is in flight, nothing is absent
 * from a populated response, and nothing failed. It is what this screen shows
 * when a read did not answer, and it names WHICH one rather than assuming both.
 */
export type WalletLoad =
  | { readonly kind: 'ready'; readonly view: WalletView; readonly copy: WalletCopy | null }
  | { readonly kind: 'unavailable'; readonly missing: readonly string[] };

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
  return (
    Array.isArray(data) &&
    data.every(isEntry) &&
    (cursor === null || isString(cursor))
  );
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
export async function loadFrom(input: {
  readonly client: ApiClient;
  readonly copy: WalletCopy | null;
}): Promise<WalletLoad> {
  const [walletResponse, entriesResponse] = await Promise.all([
    input.client.get(WALLET_PATH),
    input.client.get(WALLET_ENTRIES_PATH),
  ]);

  const wallet =
    walletResponse.ok && isWalletResponse(walletResponse.body) ? walletResponse.body : null;
  const entries =
    entriesResponse.ok && isEntriesResponse(entriesResponse.body) ? entriesResponse.body : null;

  const missing: string[] = [];
  if (wallet === null) missing.push(REQUIRED_ENDPOINTS[0]);
  if (entries === null) missing.push(REQUIRED_ENDPOINTS[1]);

  if (wallet === null || entries === null) return { kind: 'unavailable', missing };

  return readyFrom({
    wallet,
    entries: entries.data,
    next_cursor: entries.next_cursor,
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
