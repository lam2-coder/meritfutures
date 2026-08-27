import { expect, test } from 'vitest';

import type { EligibilityGates, EligibilityResponse } from '../src/api/types.ts';
import {
  PAYOUTS_PATH,
  REQUIRED_ENDPOINTS,
  isPayoutList,
  load,
  loadFrom,
  readyFrom,
} from '../src/app/payouts/source.ts';
import type { PayoutListItem } from '../src/app/payouts/wire.ts';
import {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  SESSION_COOKIE,
  createApiClient,
} from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';

// =============================================================================
// THE SEAM. ADR-162, and the one segment wired to the client.
// =============================================================================
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client. What is being proven is the
// whole path -- URL composition, the forwarded cookie, `no-store`, the status
// mapping, the JSON read, this segment's guard and ./view.ts -- because a mock
// of `ApiClient` would prove that `loadFrom` calls a function.

const ORIGIN = 'https://api.example.com';

const PASSING: EligibilityGates = {
  account_active: { pass: true },
  kyc_verified: { pass: true, state: 'verified' },
  not_frozen: { pass: true, reason: null },
  recon_clear: { pass: true },
  traded_days: { pass: true, have: 14, need: 10 },
  win_days: { pass: true, have: 6, need: 5, floor_cents: 20000 },
  buffer: { pass: true, have_cents: 480000, need_cents: 250000 },
  consistency: {
    pass: true,
    skipped: false,
    best_day_share_bp: 2150,
    max_bp: 4000,
    profit_needed_to_dilute_cents: null,
  },
  cadence_gap: {
    pass: true,
    days_since_last_payout: 21,
    need: 14,
    next_eligible_trading_day: null,
  },
  minimum_amount: { pass: true, withdrawable_cents: 480000, min_payout_cents: 10000 },
};

/** API_CONTRACT's shape, transcribed. `payout-center.test.ts`'s `ELIGIBLE`. */
const ELIGIBILITY: EligibilityResponse = {
  account_id: 'acc_01J8XQ7K9M2N4P6R8T0V2W4Y',
  as_of_trading_day: '2026-08-26',
  eligible: true,
  max_payout_cents: 250000,
  min_payout_cents: 10000,
  gates: PASSING,
  cap: {
    cap_cents: 250000,
    ordinal: 2,
    schedule_note: 'Second payout on this account. The cap rises with the ordinal.',
  },
};

const PAYOUTS: readonly PayoutListItem[] = [
  {
    payout_request_id: 'pr_01J8A0B1C2D3E4F5G6H7J8K9',
    account_id: ELIGIBILITY.account_id,
    approved_cents: 180000,
    trader_cents: 144000,
    status: 'settled',
    approved_at: '2026-07-14T15:04:05Z',
    settled_at: '2026-07-17T09:31:22Z',
    hold: null,
    timeline: [
      { state: 'approved', at: '2026-07-14T15:04:05Z' },
      { state: 'settled', at: '2026-07-17T09:31:22Z' },
    ],
    failure_note: null,
  },
];

function serving(
  body: unknown,
  status = 200,
): {
  readonly transport: Transport;
  readonly calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

// -----------------------------------------------------------------------------
// The ready branch, reached through the client
// -----------------------------------------------------------------------------

test('the ready branch is reached through a real request and is the same screen', async () => {
  const { transport, calls } = serving(PAYOUTS);
  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });

  const loaded = await loadFrom({ client, eligibility: ELIGIBILITY });

  // THE REQUEST. Base path appended here and not by the caller, the trader's
  // one cookie forwarded, and `no-store` on a screen that renders money.
  expect(calls.length).toBe(1);
  expect(calls[0]?.url).toBe(`${ORIGIN}${API_BASE_PATH}${PAYOUTS_PATH}`);
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBe(
    `${SESSION_COOKIE}=tok_abc`,
  );
  expect(calls[0]?.init.cache).toBe('no-store');

  // THE SCREEN. Byte-identical to what `readyFrom` builds from the same two
  // responses, which is what `payout-center.test.ts` already renders and
  // asserts over. The transport changed how the data arrives and nothing else.
  expect(loaded.kind).toBe('ready');
  expect(loaded).toEqual(readyFrom({ eligibility: ELIGIBILITY, payouts: PAYOUTS }));
});

// -----------------------------------------------------------------------------
// The unavailable branch, and which endpoint it names
// -----------------------------------------------------------------------------

test('eligibility has no endpoint, so it is the one the screen names', async () => {
  const { transport } = serving(PAYOUTS);
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadFrom({ client, eligibility: null });

  expect(loaded.kind).toBe('unavailable');
  if (loaded.kind !== 'unavailable') return;

  // `GET /payouts` IS REGISTERED AND WAS FETCHED, so it is NOT in the list.
  // That is the whole observable difference this session makes to this screen:
  // the missing list shrank from a constant to a measurement.
  expect(loaded.missing).toEqual([REQUIRED_ENDPOINTS[0]]);
});

test('a refused read puts its endpoint back on the list', async () => {
  for (const status of [401, 404, 429, 500]) {
    const { transport } = serving({ type: 'about:blank' }, status);
    const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });
    const loaded = await loadFrom({ client, eligibility: ELIGIBILITY });

    expect(loaded.kind, String(status)).toBe('unavailable');
    if (loaded.kind !== 'unavailable') continue;
    expect(loaded.missing, String(status)).toEqual([REQUIRED_ENDPOINTS[1]]);
  }
});

test('a 200 that does not satisfy the guard is not rendered', async () => {
  // A SERVER THAT ANSWERED WRONGLY IS NOT A SERVER THAT ANSWERED. The guard is
  // this segment's because the client returns `unknown` on purpose, and the
  // screen it protects is the one where a wrong number is expensive.
  for (const body of [
    { not: 'an array' },
    [{ ...PAYOUTS[0], approved_cents: 180000.5 }],
    [{ ...PAYOUTS[0], status: 'transferring' }],
    [{ ...PAYOUTS[0], timeline: 'soon' }],
  ]) {
    const { transport } = serving(body);
    const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });
    const loaded = await loadFrom({ client, eligibility: ELIGIBILITY });

    expect(loaded.kind, JSON.stringify(body).slice(0, 60)).toBe('unavailable');
  }
});

test('the guard accepts every shape ./wire.ts declares and refuses what it does not', () => {
  expect(isPayoutList(PAYOUTS)).toBe(true);
  expect(isPayoutList([])).toBe(true);

  // `transferring` LEFT `payout_requests` ON 2026-08-14 AND IS NOT A MEMBER.
  // ./wire.ts spends a paragraph on it: a client written against the old union
  // "would have had a branch that never fires and no branch for the state that
  // does", and this is where that stops being a comment.
  expect(isPayoutList([{ ...PAYOUTS[0], status: 'transferring' }])).toBe(false);

  // Money is integer cents.
  expect(isPayoutList([{ ...PAYOUTS[0], trader_cents: 144000.01 }])).toBe(false);

  // Every field ./view.ts reads, one at a time.
  for (const field of [
    'payout_request_id',
    'account_id',
    'approved_cents',
    'trader_cents',
    'status',
    'approved_at',
    'settled_at',
    'failure_note',
    'hold',
    'timeline',
  ]) {
    const row: Record<string, unknown> = { ...PAYOUTS[0] };
    delete row[field];
    expect(isPayoutList([row]), `${field} is required`).toBe(false);
  }

  // The two nested shapes.
  expect(isPayoutList([{ ...PAYOUTS[0], hold: { held_at: '2026-08-25T18:02:11Z' } }])).toBe(false);
  expect(isPayoutList([{ ...PAYOUTS[0], timeline: [{ state: 'approved' }] }])).toBe(false);
});

// -----------------------------------------------------------------------------
// `load`, and the one error it converts
// -----------------------------------------------------------------------------

test('an unconfigured deployment reaches neither endpoint and the screen says so', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    const loaded = await load();
    expect(loaded.kind).toBe('unavailable');
    if (loaded.kind !== 'unavailable') return;
    expect(loaded.missing).toEqual([...REQUIRED_ENDPOINTS]);
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('the conversion is narrow: anything that is not a configuration error propagates', async () => {
  // WITH AN ORIGIN SET, `load` GETS PAST `resolveApiOrigin` AND REACHES
  // `cookies()`, WHICH HAS NO REQUEST SCOPE HERE. That failure is NOT an
  // `ApiConfigError` and must not be rendered as a pending endpoint: a screen
  // that reported every fault in this application as "waiting on GET /payouts"
  // would be the quiet failure this file's header refuses.
  const saved = process.env[API_ORIGIN_VAR];
  process.env[API_ORIGIN_VAR] = ORIGIN;
  try {
    await expect(load()).rejects.toBeDefined();
  } finally {
    if (saved === undefined) delete process.env[API_ORIGIN_VAR];
    else process.env[API_ORIGIN_VAR] = saved;
  }
});
