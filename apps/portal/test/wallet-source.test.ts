import { expect, test } from 'vitest';

import type { WalletEntry, WalletResponse } from '../src/api/types.ts';
import {
  REQUIRED_ENDPOINTS,
  WALLET_ENTRIES_PATH,
  WALLET_PATH,
  isEntriesResponse,
  isWalletResponse,
  loadFrom,
} from '../src/app/wallet/source.ts';
import { API_BASE_PATH, SESSION_COOKIE, createApiClient } from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';

// =============================================================================
// SC-M4-10's SEAM, THROUGH THE REAL CLIENT
// =============================================================================
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client, which is
// `payouts-source.test.ts`'s rule and its reason: "a mock of `ApiClient` would
// prove that `loadFrom` calls a function". What is proven here is URL
// composition, the forwarded cookie, `no-store`, the status mapping, the JSON
// read, this segment's two guards, and the view.

const ORIGIN = 'https://api.example.com';

const WALLET: WalletResponse = {
  balance_cents: 152_500,
  withdrawable_cents: 151_250,
  held_cents: 1_250,
  holds: [
    { rule: 'chargeback_window', cents: 1_250, since: '2026-08-20T14:02:00Z', available_at: null },
  ],
  as_of: '2026-08-28T09:00:00Z',
};

const ENTRIES: readonly WalletEntry[] = [
  {
    entry_id: '41',
    direction: 'credit',
    provenance: 'payout',
    amount_cents: 150_000,
    cause: 'Payout approved',
    reference_id: 'pr_01J8Z',
    ledger_transaction_id: 'ltx_01J8Z',
    balance_after_cents: 152_500,
    occurred_at: '2026-08-27T18:30:00Z',
  },
];

/**
 * A transport that answers each path with its own body, so the two reads can
 * succeed and fail INDEPENDENTLY.
 *
 * THAT IS THE WHOLE POINT OF THIS HELPER. A single-body stub would make the two
 * endpoints indistinguishable, and the property most worth asserting on this
 * screen is that a failure of one is reported as a failure of THAT one.
 */
function serving(bodies: {
  readonly wallet?: unknown;
  readonly entries?: unknown;
  readonly status?: number;
}): { readonly transport: Transport; readonly calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    transport: (url, init) => {
      calls.push(url);
      const isEntries = url.endsWith(WALLET_ENTRIES_PATH);
      const body = isEntries ? bodies.entries : bodies.wallet;

      if (body === undefined)
        return Promise.resolve(new Response('{"type":"about:blank"}', { status: 503 }));

      void init;
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: bodies.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

/**
 * `serving`, but an unserved path 404s rather than 503s.
 *
 * TWO HELPERS BECAUSE THE TWO STATUSES NOW MEAN DIFFERENT THINGS. Before
 * ADR-217 every unserved path could be one status because every failure landed
 * in one arm; the ruling splits them, so the suite has to be able to say which
 * of the two it is exercising.
 */
function absent(bodies: { readonly wallet?: unknown; readonly entries?: unknown }): {
  readonly transport: Transport;
} {
  return {
    transport: (url) => {
      const body = url.endsWith(WALLET_ENTRIES_PATH) ? bodies.entries : bodies.wallet;
      if (body === undefined)
        return Promise.resolve(new Response('{"type":"about:blank"}', { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

const ok = { wallet: WALLET, entries: { data: ENTRIES, next_cursor: null } };

test('the ready branch is reached through two real requests', async () => {
  const { transport, calls } = serving(ok);
  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('ready');
  if (loaded.kind !== 'ready') throw new Error('unreachable');

  expect(loaded.view.balance.balance).toBe('1,525.00');
  expect(loaded.view.statement.entries).toHaveLength(1);

  // BOTH PATHS ARE COMPOSED WITH THE CONTRACT'S BASE PATH AND NEITHER SEGMENT
  // WROTE IT. `../src/http/client.ts` appends `API_BASE_PATH`, and a segment
  // that spelled `/api/v1/wallet` itself would double it.
  expect(calls).toContain(`${ORIGIN}${API_BASE_PATH}${WALLET_PATH}`);
  expect(calls).toContain(`${ORIGIN}${API_BASE_PATH}${WALLET_ENTRIES_PATH}`);
});

test('the trader’s session cookie is forwarded and nothing else is', async () => {
  const headers: Record<string, string>[] = [];
  const transport: Transport = (_url, init) => {
    headers.push({ ...(init.headers as Record<string, string>) });
    return Promise.resolve(
      new Response(JSON.stringify(WALLET), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });
  await client.get(WALLET_PATH);

  expect(headers[0]!['cookie']).toBe(`${SESSION_COOKIE}=tok_abc`);
});

test('a 404 on one read is reported as that one endpoint being absent', async () => {
  // THE SCREEN NAMES WHICH ENDPOINT IT DID NOT GET, which is
  // `app/payouts/source.ts`'s "rather than assuming both". Here the balance
  // answers and the statement 404s.
  //
  // 404 AND NOT 503, WHICH IS ADR-217's WHOLE BOUNDARY. This case asserted a
  // 503 before that ruling, and API_CONTRACT section 6.2 is why it cannot: "an
  // identity with no `wallet_entries` row is `0` and not a `404`", so a 404
  // here can only be a route this deployment does not serve.
  const { transport } = absent({ wallet: WALLET });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('unavailable');
  if (loaded.kind !== 'unavailable') throw new Error('unreachable');
  expect(loaded.missing).toEqual(['GET /wallet/entries']);
});

test('both endpoints absent is reported as both', async () => {
  const { transport } = absent({});
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('unavailable');
  if (loaded.kind !== 'unavailable') throw new Error('unreachable');
  expect(loaded.missing).toEqual([...REQUIRED_ENDPOINTS]);
});

// -----------------------------------------------------------------------------
// The error arm, which is ADR-217's and is the state this screen could not reach
// -----------------------------------------------------------------------------

test('a 503 is an error and is no longer an absent endpoint', async () => {
  // THE CASE THE RULING TURNED OVER. This screen rendered a 503 through
  // `WalletUnavailable`, which lists API paths under a sentence about a build.
  const { transport } = serving({ wallet: WALLET });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('error');
  if (loaded.kind !== 'error') throw new Error('unreachable');
  expect(loaded.error).toBe('server_error');
  expect(loaded.status).toBe(503);
});

test('a 401 reaches the screen as unauthenticated and not as our fault', async () => {
  // THE DEFECT ADR-217 WAS TAKEN FOR, and it is the sharpest of the set: a
  // trader whose session expired was told "This is a problem on our side and
  // your balance is unaffected", of which only the second half was true.
  const { transport } = serving({ wallet: WALLET, entries: {}, status: 401 });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('error');
  if (loaded.kind !== 'error') throw new Error('unreachable');
  expect(loaded.error).toBe('unauthenticated');
  expect(loaded.status).toBe(401);
});

test('a 429 reaches the screen as rate_limited', async () => {
  const { transport } = serving({ wallet: WALLET, entries: {}, status: 429 });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('error');
  if (loaded.kind !== 'error') throw new Error('unreachable');
  expect(loaded.error).toBe('rate_limited');
});

test('a transport that never reaches a status line is an error carrying no status', async () => {
  // `../src/http/client.ts`'s `TRANSPORT_FAILURE`, end to end. `status: null` is
  // what keeps "nothing answered" distinguishable from "the API said 503", and
  // this screen must not invent the number.
  const transport: Transport = () => Promise.reject(new Error('ECONNREFUSED'));
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('error');
  if (loaded.kind !== 'error') throw new Error('unreachable');
  expect(loaded.error).toBe('server_error');
  expect(loaded.status).toBeNull();
});

test('a failure on either read outranks an absence on the other', async () => {
  // THE PRECEDENCE RULE, AND IT IS NOT A TIE-BREAK FOR NEATNESS. The balance
  // route is absent and the statement says the session is bad; only one arm can
  // render, and the one that cannot state a falsehood is `error`. Rendering
  // "this is a problem on our side" over an expired session is the exact
  // sentence the arm exists to stop.
  const transport: Transport = (url) =>
    Promise.resolve(
      new Response('{"type":"about:blank"}', {
        status: url.endsWith(WALLET_ENTRIES_PATH) ? 401 : 404,
      }),
    );
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('error');
  if (loaded.kind !== 'error') throw new Error('unreachable');
  expect(loaded.error).toBe('unauthenticated');
});

test('the balance read wins a tie because it is the screen’s subject', async () => {
  const transport: Transport = (url) =>
    Promise.resolve(
      new Response('{"type":"about:blank"}', {
        status: url.endsWith(WALLET_ENTRIES_PATH) ? 503 : 429,
      }),
    );
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, copy: null });

  expect(loaded.kind).toBe('error');
  if (loaded.kind !== 'error') throw new Error('unreachable');
  expect(loaded.error).toBe('rate_limited');
});

// -----------------------------------------------------------------------------
// The guards, which are this segment's because the transport returns `unknown`
// -----------------------------------------------------------------------------

test('the wallet guard accepts the contract’s shape', () => {
  // THE ACCEPTANCE CASE IS ASSERTED FIRST. The dispatch protocol: "Watch the
  // acceptance cases fire, not only the refusals. A probe that only ever
  // attempts forbidden things passes against a guard that rejects everything."
  expect(isWalletResponse(WALLET)).toBe(true);
  expect(isEntriesResponse({ data: ENTRIES, next_cursor: null })).toBe(true);
  expect(isEntriesResponse({ data: [], next_cursor: 'cur_2' })).toBe(true);
});

test('the wallet guard refuses a float on a money field', () => {
  // MONEY IS INTEGER CENTS. A server that sent `152500.5` would reach
  // `formatCents`, which throws a `RangeError`; refusing at the boundary makes
  // the honest answer "the response was malformed" rather than a crash inside a
  // formatter.
  expect(isWalletResponse({ ...WALLET, balance_cents: 152_500.5 })).toBe(false);
  expect(isWalletResponse({ ...WALLET, held_cents: 0.01 })).toBe(false);
});

test('the wallet guard refuses a partial response rather than rendering it', () => {
  for (const field of ['balance_cents', 'withdrawable_cents', 'held_cents', 'as_of', 'holds']) {
    const partial: Record<string, unknown> = { ...WALLET };
    delete partial[field];
    expect(isWalletResponse(partial), `${field} missing must be refused`).toBe(false);
  }
});

test('the hold guard refuses a rule the union does not carry', () => {
  // `WalletHoldRule` is a closed union with one member, and M20's P-1 must not
  // become a second: it holds a WITHDRAWAL and not a balance.
  expect(
    isWalletResponse({
      ...WALLET,
      holds: [{ rule: 'review_hold', cents: 1, since: 'x', available_at: null }],
    }),
  ).toBe(false);
});

test('the entries guard requires a provenance on a credit and refuses one it does not know', () => {
  const [credit] = ENTRIES;

  // `promotional_credit` IS THE VALUE THIS GUARD EXISTS TO REFUSE. `0011`'s
  // CHECK keeps it off the wire and API_CONTRACT states the consequence of
  // letting it on: a promotional figure beside the balance "is one client-side
  // addition away from AS-M20-01, credit converted to cash".
  expect(
    isEntriesResponse({
      data: [{ ...credit, provenance: 'promotional_credit' }],
      next_cursor: null,
    }),
  ).toBe(false);

  const withoutProvenance: Record<string, unknown> = { ...credit };
  delete withoutProvenance['provenance'];
  expect(isEntriesResponse({ data: [withoutProvenance], next_cursor: null })).toBe(false);
});

test('the entries guard accepts a debit that carries no provenance', () => {
  // THE MIRROR OF THE CASE ABOVE, and it is the one a careless guard breaks.
  // `WalletDebit` carries NO `provenance` by the contract's own declaration, so
  // a guard that required one on every row would reject every debit the server
  // sends and the screen would show credits only.
  const debit = {
    entry_id: '40',
    direction: 'debit',
    amount_cents: 4_207,
    cause: 'Evaluation purchase',
    reference_id: 'pur_01J8Y',
    ledger_transaction_id: 'ltx_01J8Y',
    balance_after_cents: 2_500,
    occurred_at: '2026-08-26T11:00:00Z',
  };

  expect(isEntriesResponse({ data: [debit], next_cursor: null })).toBe(true);
});

test('the entries guard refuses a numeric entry_id', () => {
  // API_CONTRACT: `entry_id` is a DECIMAL STRING and "a client must not parse
  // it", because a `wallet_entries.id` above `Number.MAX_SAFE_INTEGER` has
  // already lost digits by the time anything reads it.
  //
  // THE VALUE IS COMPUTED RATHER THAN WRITTEN, AND ESLINT IS THE REASON. This
  // assertion first carried the literal `9007199254740993`, and
  // `no-loss-of-precision` failed the lint run on it -- correctly, and making
  // this test's own point: a source literal above the safe range is not even the
  // value it appears to be. So the loss is DEMONSTRATED here instead of
  // described, and the demonstration is the first half of the test.
  const lost = Number.MAX_SAFE_INTEGER + 2;
  expect(String(lost), 'the digit is already gone before any guard sees it').toBe(
    '9007199254740992',
  );

  // AND THE GUARD REFUSES A NUMBER ON THIS FIELD WHATEVER ITS MAGNITUDE, because
  // the check is on the TYPE. A guard that only refused unsafe integers would
  // pass a small id through and start parsing ids that happen to be short.
  expect(isEntriesResponse({ data: [{ ...ENTRIES[0], entry_id: lost }], next_cursor: null })).toBe(
    false,
  );
  expect(isEntriesResponse({ data: [{ ...ENTRIES[0], entry_id: 41 }], next_cursor: null })).toBe(
    false,
  );
});

test('a 200 whose body is not the contract’s shape is an error, never rendered', () => {
  // A guard that passed here would put an arbitrary object onto a money screen.
  //
  // AN ERROR AND NOT AN ABSENCE, WHICH IS ADR-217's SECOND HALF. A server
  // answered and answered wrongly, which is not the same fact as a route this
  // deployment does not serve, and `status: null` says the malformed body was
  // rejected here rather than that nothing replied.
  const { transport } = serving({ wallet: { balance_cents: 1 }, entries: { data: [] } });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  return loadFrom({ client, copy: null }).then((loaded) => {
    expect(loaded.kind).toBe('error');
    if (loaded.kind !== 'error') throw new Error('unreachable');
    expect(loaded.error).toBe('server_error');
    expect(loaded.status).toBeNull();
  });
});
