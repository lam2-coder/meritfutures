// =============================================================================
// apps/api/test/money-out-refusal.test.ts -- CI-02, `unit`.
// =============================================================================
// THE TWO WAYS MONEY LEAVES MERIT, MEASURED AS ONE QUESTION. `usePayoutBackend`
// and `useWithdrawalBackend` are two of the fourteen ports `start.ts` does not
// call, and between them they are the whole of the trader's cash exit: the
// payout request that turns an eligible account into an approved
// `payout_requests` row, and the withdrawal that turns a wallet balance into an
// instruction to pay. What this file asserts is what a request MEETS at each of
// them, derived by driving the routes rather than by reading their docblocks.
//
// -----------------------------------------------------------------------------
// WHY THE CENSUS IS BRACE MATCHED AND NOT GREPPED
// -----------------------------------------------------------------------------
// A line pattern over an interface body counts the members whose signatures
// happen to start a line and MISSES the rest. `PayoutBackend`'s third member is
// `readonly idempotency: IdempotencyStore` and matches no call-signature
// pattern; `PayoutTx.subject` and `WithdrawalTx.approvalCandidates` each sit
// behind a doc comment long enough to hide them from a windowed read. The
// counts below are taken by matching braces over a comment-stripped body, and
// the naive pattern is RUN BESIDE the real one and asserted to disagree, so the
// reason for the method is executed rather than stated. ADR-357 section 3 is the
// precedent: a probe that reads the WORD classified thirteen ports correctly and
// the fourteenth wrongly.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE
// -----------------------------------------------------------------------------
// It drives the routes over `app.inject` against the SHIPPED module-scope
// defaults. It proves what those defaults do and in what order they are
// touched. It proves NOTHING about a deployment: whether the process that serves
// real traffic holds these defaults is `start.ts`'s question, and `start.ts` is
// read here as text and never executed.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import type { IdempotencyScope } from '../src/idempotency.ts';
import {
  SESSION_COOKIE,
  UNWIRED_AUTH_BACKEND,
  resetAuthBackend,
  useAuthBackend,
  type AuthBackend,
  type AuthSession,
} from '../src/routes/auth.ts';
import {
  PAYOUTS_PATH,
  PayoutBackendUnwired,
  UNWIRED_PAYOUT_BACKEND,
  resetPayoutBackend,
  usePayoutBackend,
  type PayoutBackend,
} from '../src/routes/payouts.ts';
import {
  UNWIRED_WITHDRAWAL_BACKEND,
  WITHDRAWALS_PATH,
  WITHDRAWAL_CANCEL_PATH,
  WithdrawalBackendUnwired,
  resetWithdrawalBackend,
  useWithdrawalBackend,
  type WithdrawalBackend,
} from '../src/routes/wallet-withdrawals.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const API_SRC = join(ROOT, 'apps/api/src');
const ROUTES = join(API_SRC, 'routes');
const PAYOUTS_SRC = readFileSync(join(ROUTES, 'payouts.ts'), 'utf8');
const WITHDRAWALS_SRC = readFileSync(join(ROUTES, 'wallet-withdrawals.ts'), 'utf8');
const START_SRC = stripComments(readFileSync(join(API_SRC, 'start.ts'), 'utf8'));

// -----------------------------------------------------------------------------
// The census, taken at the braces
// -----------------------------------------------------------------------------

/** The comment-stripped body of one interface, declaration line to its closer. */
function interfaceBody(source: string, name: string): readonly string[] {
  const lines = stripComments(source).split('\n');
  const start = lines.findIndex((line) => new RegExp(`\\binterface ${name}\\s*\\{`).test(line));
  if (start < 0) throw new Error(`no \`interface ${name}\` in this source`);
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth === 0 && i > start) return lines.slice(start + 1, i);
  }
  throw new Error(`\`interface ${name}\` is not closed`);
}

/**
 * Every member NAME an interface declares, at depth one of its own body.
 *
 * IT COUNTS `readonly x: T` AND `x(): T` ALIKE, which is the whole reason this
 * is not a pattern over signature lines: two of the six members across the two
 * backend interfaces are fields rather than methods.
 */
function members(source: string, name: string): readonly string[] {
  const found: string[] = [];
  let depth = 0;
  for (const line of interfaceBody(source, name)) {
    const before = depth;
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
    if (before !== 0) continue;
    const match = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[(<:]/.exec(line);
    if (match?.[1] !== undefined) found.push(match[1]);
  }
  return found;
}

/** What a line pattern over the same body would have counted. The wrong number. */
function signatureLines(source: string, name: string): number {
  return interfaceBody(source, name).filter((line) => /^\s{2}[A-Za-z_$][\w$]*\s*[(<]/.test(line))
    .length;
}

describe('the census of both money-out ports, matched at the braces', () => {
  it('`PayoutBackend` declares three members and `PayoutTx` declares five', () => {
    expect(members(PAYOUTS_SRC, 'PayoutBackend')).toStrictEqual([
      'transact',
      'listPayouts',
      'idempotency',
    ]);
    expect(members(PAYOUTS_SRC, 'PayoutTx')).toStrictEqual([
      'lockScope',
      'identityStatus',
      'subject',
      'holdFlag',
      'insertPayoutRequest',
    ]);
  });

  it('`WithdrawalBackend` declares three members and `WithdrawalTx` declares eleven', () => {
    expect(members(WITHDRAWALS_SRC, 'WithdrawalBackend')).toStrictEqual([
      'transact',
      'idempotency',
      'now',
    ]);
    expect(members(WITHDRAWALS_SRC, 'WithdrawalTx')).toStrictEqual([
      'lockScope',
      'identity',
      'kycVerifications',
      'withdrawals',
      'entries',
      'destination',
      'registerDestination',
      'insertWithdrawal',
      'approvalCandidates',
      'approveWithdrawal',
      'cancelWithdrawal',
    ]);
  });

  it('the two pairs carry EIGHT and FOURTEEN members, which is what a session must build', () => {
    const payout =
      members(PAYOUTS_SRC, 'PayoutBackend').length + members(PAYOUTS_SRC, 'PayoutTx').length;
    const withdrawal =
      members(WITHDRAWALS_SRC, 'WithdrawalBackend').length +
      members(WITHDRAWALS_SRC, 'WithdrawalTx').length;
    expect({ payout, withdrawal }).toStrictEqual({ payout: 8, withdrawal: 14 });
  });

  it('THE LINE PATTERN DISAGREES, which is why the census is not one', () => {
    // Both backend interfaces carry a field the pattern cannot see, so it
    // undercounts each by exactly the fields it declares. This case is the
    // executed form of ADR-357's finding that a probe reading the SHAPE of a
    // line is not a measurement of what an interface declares.
    expect(signatureLines(PAYOUTS_SRC, 'PayoutBackend')).toBe(2);
    expect(members(PAYOUTS_SRC, 'PayoutBackend')).toHaveLength(3);
    expect(signatureLines(WITHDRAWALS_SRC, 'WithdrawalBackend')).toBe(1);
    expect(members(WITHDRAWALS_SRC, 'WithdrawalBackend')).toHaveLength(3);
  });

  it('the reader is NON-VACUOUS in both directions', () => {
    expect(() => members(PAYOUTS_SRC, 'NoSuchInterface')).toThrow(/no `interface NoSuchInterface`/);
    // The two members that sit behind the longest doc comments in their files.
    expect(members(PAYOUTS_SRC, 'PayoutTx')).toContain('subject');
    expect(members(WITHDRAWALS_SRC, 'WithdrawalTx')).toContain('approvalCandidates');
  });
});

// -----------------------------------------------------------------------------
// What each default HOLDS, called rather than read
// -----------------------------------------------------------------------------

/** One probe of one member: what it produced, or the error class that refused. */
type Probe =
  | { readonly member: string; readonly refused: string }
  | { readonly member: string; readonly served: unknown };

async function probe(member: string, call: () => unknown): Promise<Probe> {
  try {
    return { member, served: await call() };
  } catch (err) {
    return { member, refused: err instanceof Error ? err.name : typeof err };
  }
}

const SCOPE: IdempotencyScope = {
  kind: 'identity',
  identityId: '0199c7a1-1111-7000-8000-00000000000a',
};
const RECORD = {
  key: 'k',
  endpoint: 'e',
  requestHash: new Uint8Array(32),
  responseStatus: null,
  responseBody: null,
} as const;

function payoutProbes(port: PayoutBackend): Promise<readonly Probe[]> {
  return Promise.all([
    probe('transact', () => port.transact({} as AuthSession, () => Promise.resolve(null))),
    probe('listPayouts', () => port.listPayouts({} as AuthSession)),
    probe('idempotency.find', () => port.idempotency.find(SCOPE, 'k')),
    probe('idempotency.begin', () => port.idempotency.begin(SCOPE, RECORD)),
    probe('idempotency.complete', () => port.idempotency.complete(SCOPE, 'k', 200, null)),
  ]);
}

function withdrawalProbes(port: WithdrawalBackend): Promise<readonly Probe[]> {
  return Promise.all([
    probe('transact', () => port.transact({} as AuthSession, () => Promise.resolve(null))),
    probe('idempotency.find', () => port.idempotency.find(SCOPE, 'k')),
    probe('idempotency.begin', () => port.idempotency.begin(SCOPE, RECORD)),
    probe('idempotency.complete', () => port.idempotency.complete(SCOPE, 'k', 200, null)),
    probe('now', () => port.now()),
  ]);
}

describe('THE REFUSAL IS LOUD AND IT CANNOT QUOTE A NUMBER', () => {
  it('`UNWIRED_PAYOUT_BACKEND` refuses on EVERY member and serves nothing at all', async () => {
    const probes = await payoutProbes(UNWIRED_PAYOUT_BACKEND);
    expect(probes.filter((p) => 'served' in p)).toStrictEqual([]);
    expect(probes.map((p) => ('refused' in p ? p.refused : 'SERVED'))).toStrictEqual([
      'PayoutBackendUnwired',
      'PayoutBackendUnwired',
      'PayoutBackendUnwired',
      'PayoutBackendUnwired',
      'PayoutBackendUnwired',
    ]);
  });

  it('each payout refusal NAMES the member that refused, so a 503 points somewhere', async () => {
    const messages = await Promise.all(
      [
        () => UNWIRED_PAYOUT_BACKEND.transact({} as AuthSession, () => Promise.resolve(null)),
        () => UNWIRED_PAYOUT_BACKEND.listPayouts({} as AuthSession),
        () => UNWIRED_PAYOUT_BACKEND.idempotency.find(SCOPE, 'k'),
      ].map(async (call) => {
        try {
          await call();
          return 'SERVED';
        } catch (err) {
          return err instanceof PayoutBackendUnwired ? err.message : 'WRONG CLASS';
        }
      }),
    );
    expect(messages[0]).toContain('PayoutBackend.transact is not wired');
    expect(messages[1]).toContain('PayoutBackend.listPayouts is not wired');
    expect(messages[2]).toContain('PayoutBackend.idempotency.find is not wired');
  });

  it('`UNWIRED_WITHDRAWAL_BACKEND` refuses on four members and SERVES ON ONE', async () => {
    const probes = await withdrawalProbes(UNWIRED_WITHDRAWAL_BACKEND);
    const served = probes.filter((p) => 'served' in p);
    expect(served.map((p) => p.member)).toStrictEqual(['now']);
    expect(probes.filter((p) => 'refused' in p).map((p) => p.refused)).toStrictEqual([
      'WithdrawalBackendUnwired',
      'WithdrawalBackendUnwired',
      'WithdrawalBackendUnwired',
      'WithdrawalBackendUnwired',
    ]);
    expect(UNWIRED_WITHDRAWAL_BACKEND.now()).toBeInstanceOf(Date);
  });

  it('NO FIGURE ESCAPES EITHER DEFAULT: nothing served is a number or a bigint', async () => {
    const all = [
      ...(await payoutProbes(UNWIRED_PAYOUT_BACKEND)),
      ...(await withdrawalProbes(UNWIRED_WITHDRAWAL_BACKEND)),
    ];
    const values = all.flatMap((p) => ('served' in p ? [p.served] : []));
    // The whole of what the two fail-closed defaults will produce, for any
    // caller, on any member, is ONE `Date`. A balance, an amount, a threshold,
    // a fee and a cent count are each a `number` or a `bigint` in this tree
    // (`Cents` is `bigint`), and none of them is reachable from here.
    expect(values).toHaveLength(1);
    expect(values.every((v) => typeof v !== 'number' && typeof v !== 'bigint')).toBe(true);
    expect(values[0]).toBeInstanceOf(Date);
  });
});

// -----------------------------------------------------------------------------
// The clock split, measured across every unwired default in this deployable
// -----------------------------------------------------------------------------

/** Every `.ts` file under `apps/api/src`, recursively. */
function sources(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The initializer text of one depth-one property of one `UNWIRED_*` literal. */
interface Clock {
  readonly file: string;
  readonly constant: string;
  readonly refuses: boolean;
}

/**
 * Every `UNWIRED_*` object literal in this deployable that declares a `now`,
 * with whether that member REFUSES or serves.
 *
 * DERIVED RATHER THAN LISTED, so a sixth clock arriving, or one of these
 * changing hands, turns the case below red on the day it happens.
 */
function clocks(): readonly Clock[] {
  const found: Clock[] = [];
  for (const file of sources(API_SRC)) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const decl = /^(?:export )?const (UNWIRED_[A-Z_]+)\s*:\s*[\w<>, ]+=\s*\{/.exec(
        lines[i] ?? '',
      );
      if (decl?.[1] === undefined) continue;
      let depth = 0;
      let end = i;
      for (let j = i; j < lines.length; j += 1) {
        for (const ch of lines[j] ?? '') {
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
        }
        if (depth === 0 && j > i) {
          end = j;
          break;
        }
      }
      const body = lines.slice(i, end + 1).join('\n');
      const now = /\n\s{2}now:\s*\(\)\s*=>\s*(\{[\s\S]*?\n\s{2}\}|[^\n]*)/.exec(body);
      if (now?.[1] === undefined) continue;
      found.push({
        file: file.slice(ROOT.length + 1),
        constant: decl[1],
        refuses: /throw new \w*Unwired\(/.test(now[1]),
      });
    }
  }
  return found;
}

describe('the clock on an unwired default, across the whole deployable', () => {
  const CLOCKS = clocks();

  it('SIX unwired defaults declare a `now` and the reader is non-vacuous', () => {
    expect(CLOCKS.length).toBe(6);
    expect(CLOCKS.map((c) => c.constant)).toContain('UNWIRED_WITHDRAWAL_BACKEND');
  });

  it('FOUR of the six refuse the clock by name and TWO return the wall clock', () => {
    const serving = CLOCKS.filter((c) => !c.refuses)
      .map((c) => c.constant)
      .sort();
    expect(CLOCKS.filter((c) => c.refuses)).toHaveLength(4);
    expect(serving).toStrictEqual(['UNWIRED_WALLET_BACKEND', 'UNWIRED_WITHDRAWAL_BACKEND']);
  });

  it('`start.ts` installs one of the two serving clocks away and NOT the other', () => {
    // `useWalletBackend` is called, so `UNWIRED_WALLET_BACKEND`'s clock is not
    // what a deployment holds. `useWithdrawalBackend` is not, so among the
    // ports `start.ts` does not call, EXACTLY ONE holds a clock that serves.
    expect(START_SRC).toMatch(/\buseWalletBackend\(/);
    expect(START_SRC).not.toMatch(/\buseWithdrawalBackend\(/);
    expect(START_SRC).not.toMatch(/\busePayoutBackend\(/);
  });
});

// -----------------------------------------------------------------------------
// What a request MEETS today, driven over the transport
// -----------------------------------------------------------------------------

const IDENTITY = '0199c7a1-1111-7000-8000-000000000901';
const TOKEN = 'session-token-361';
const ELEVATED: AuthSession = {
  id: '0199c7a1-3333-7000-8000-000000000901',
  identityId: IDENTITY,
  userId: '0199c7a1-4444-7000-8000-000000000901',
  authFactor: 'passkey',
  elevatedAt: '2026-09-06T11:55:00.000Z',
  elevatedByFactor: 'passkey',
};
const UNELEVATED: AuthSession = { ...ELEVATED, elevatedAt: null, elevatedByFactor: null };

let sessionFor: AuthSession = ELEVATED;

const AUTH_FIXTURE: AuthBackend = {
  ...UNWIRED_AUTH_BACKEND,
  sessionByToken: (token: string) => Promise.resolve(token === TOKEN ? sessionFor : null),
};

const onDisk = await discoverRouteModules();

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `idem-361-${String(keyCounter)}`;
}

async function call(options: {
  method: 'GET' | 'POST';
  path: string;
  payload?: object;
  key?: boolean;
}): Promise<LightMyRequestResponse> {
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${TOKEN}` };
  if (options.key === true) headers['idempotency-key'] = nextKey();
  const inject: InjectOptions = {
    method: options.method,
    url: `${BASE_PATH}${options.path}`,
    headers,
  };
  if (options.payload !== undefined) inject.payload = options.payload;
  const res = await app.inject(inject);
  await app.close();
  return res;
}

/** The shipped default, wrapped so the ORDER of the members touched is recorded. */
function recording<T extends object>(port: T, calls: string[]): T {
  return new Proxy(port, {
    get(target, property, receiver) {
      const name = String(property);
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          calls.push(name);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (name === 'idempotency' && typeof value === 'object' && value !== null) {
        return recording(value as object, calls);
      }
      return value;
    },
  }) as T;
}

beforeEach(() => {
  sessionFor = ELEVATED;
  useAuthBackend(AUTH_FIXTURE);
  usePayoutBackend(UNWIRED_PAYOUT_BACKEND);
  useWithdrawalBackend(UNWIRED_WITHDRAWAL_BACKEND);
});

afterEach(() => {
  resetAuthBackend();
  resetPayoutBackend();
  resetWithdrawalBackend();
});

describe('the payout door: what an authenticated trader meets today', () => {
  it('`GET /payouts` answers 503 and the member touched is `listPayouts`', async () => {
    const calls: string[] = [];
    usePayoutBackend(recording(UNWIRED_PAYOUT_BACKEND, calls));
    const res = await call({ method: 'GET', path: PAYOUTS_PATH });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable', status: 503 });
    expect(calls).toStrictEqual(['listPayouts']);
  });

  it('`POST /accounts/:accountId/payout` answers 503 FROM THE IDEMPOTENCY STORE', async () => {
    // THE ORDER IS THE FINDING. `transact` is the member the port is named for
    // and it is never reached: the key is claimed BEFORE the handler opens a
    // transaction, so the refusal a trader meets is `idempotency.find`'s. A
    // reader predicting the message from `UNWIRED_PAYOUT_BACKEND.transact`
    // predicts the wrong member, which is ADR-359's shape one door over.
    const calls: string[] = [];
    usePayoutBackend(recording(UNWIRED_PAYOUT_BACKEND, calls));
    const res = await call({
      method: 'POST',
      path: '/accounts/0199c7a1-2222-7000-8000-000000000901/payout',
      payload: {},
      key: true,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable', status: 503 });
    expect(calls).toStrictEqual(['find']);
    expect(calls).not.toContain('transact');
  });

  it('the payout 503 carries NO amount, NO balance and NO gate breakdown', async () => {
    const res = await call({
      method: 'POST',
      path: '/accounts/0199c7a1-2222-7000-8000-000000000901/payout',
      payload: { amount_cents: 150_000 },
      key: true,
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual(['code', 'instance', 'status', 'title', 'type']);
    expect(JSON.stringify(body)).not.toMatch(/150000|cents|gates|amount/i);
  });
});

describe('the withdrawal door: C-27 answers before the port does', () => {
  it('a NON-elevated session is refused 403 and NOT ONE member is touched', async () => {
    sessionFor = UNELEVATED;
    const calls: string[] = [];
    useWithdrawalBackend(recording(UNWIRED_WITHDRAWAL_BACKEND, calls));
    const res = await call({
      method: 'POST',
      path: WITHDRAWALS_PATH,
      payload: { amount_cents: 150_000, destination_ref: 'dest-361' },
      key: true,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'forbidden',
      required_factor: 'passkey or dual_channel',
    });
    // THE 503 IS UNREACHABLE FROM HERE, which is `INSTALL_BLOCKING_FINDINGS`
    // finding `E` executed rather than read: the factor gate runs before
    // `spec.handle`, so the port is not consulted at all.
    expect(calls).toStrictEqual([]);
  });

  it('the cancel row refuses the same way and touches nothing either', async () => {
    sessionFor = UNELEVATED;
    const calls: string[] = [];
    useWithdrawalBackend(recording(UNWIRED_WITHDRAWAL_BACKEND, calls));
    const res = await call({
      method: 'POST',
      path: WITHDRAWAL_CANCEL_PATH.replace(':withdrawalId', '0199c7a1-5555-7000-8000-000000000901'),
    });
    expect(res.statusCode).toBe(403);
    expect(calls).toStrictEqual([]);
  });

  it('an ELEVATED session reaches the port, meets 503, and touches `now` FIRST', async () => {
    const calls: string[] = [];
    useWithdrawalBackend(recording(UNWIRED_WITHDRAWAL_BACKEND, calls));
    const res = await call({
      method: 'POST',
      path: WITHDRAWALS_PATH,
      payload: { amount_cents: 150_000, destination_ref: 'dest-361' },
      key: true,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'service_unavailable', status: 503 });
    // `now` is the first member of this port any request touches, on BOTH rows,
    // and it is the one member of the four that does not refuse.
    expect(calls[0]).toBe('now');
    expect(calls).toStrictEqual(['now', 'find']);
    expect(calls).not.toContain('transact');
  });

  it('the withdrawal 503 carries NO balance, NO amount and NO destination', async () => {
    const res = await call({
      method: 'POST',
      path: WITHDRAWALS_PATH,
      payload: { amount_cents: 390_000, destination_ref: 'dest-361' },
      key: true,
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual(['code', 'instance', 'status', 'title', 'type']);
    expect(JSON.stringify(body)).not.toMatch(/390000|dest-361|cents|balance/i);
  });
});

// -----------------------------------------------------------------------------
// WHY THE SERVING CLOCK IS LOAD BEARING, which is this file's finding
// -----------------------------------------------------------------------------

describe('the clock cannot be made to refuse without moving the call that reads it', () => {
  it('A REFUSING CLOCK TURNS THE 503 INTO A 500, measured rather than argued', async () => {
    // `const at = active.now()` sits OUTSIDE the handler's only `try`, so a
    // `now` written the way the other four unwired defaults in this deployable
    // write it throws past `unwiredOrThrow` and past `endpointHandler`, which
    // rethrows anything that is not an `AuthBackendUnwired`. The server's error
    // handler then answers `internal_error`.
    //
    // SO THE DEFAULT'S OWN DOCBLOCK, "a backend that refuses every call", is
    // NOT ACHIEVABLE AT THIS MEMBER WITHOUT MOVING THE CALL. The serving clock
    // is what keeps the money-out refusal a retryable 503, and that is a
    // property of the HANDLER rather than a choice about the clock.
    useWithdrawalBackend({
      ...UNWIRED_WITHDRAWAL_BACKEND,
      now: () => {
        throw new WithdrawalBackendUnwired('now');
      },
    });
    const res = await call({
      method: 'POST',
      path: WITHDRAWALS_PATH,
      payload: { amount_cents: 150_000, destination_ref: 'dest-361' },
      key: true,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error', status: 500 });
  });

  it('and the shipped default answers 503 on the same request, which is the pair', async () => {
    const res = await call({
      method: 'POST',
      path: WITHDRAWALS_PATH,
      payload: { amount_cents: 150_000, destination_ref: 'dest-361' },
      key: true,
    });
    expect(res.statusCode).toBe(503);
  });
});
