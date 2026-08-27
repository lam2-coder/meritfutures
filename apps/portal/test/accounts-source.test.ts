import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';

import type { AccountDetail, AccountListItem, MarkListItem } from '../src/api/types.ts';
import AccountPage from '../src/app/accounts/[account]/page.ts';
import AccountsPage from '../src/app/accounts/page.ts';
import {
  ACCOUNTS_PATH,
  DETAIL_REQUIRED_ENDPOINTS,
  LIST_REQUIRED_ENDPOINTS,
  MARKS_ENDPOINT,
  accountPath,
  isAccountDetail,
  isAccountList,
  isPinnedPlanSource,
  load,
  loadDetail,
  loadDetailFrom,
  loadListFrom,
  planVersionPath,
  toPinnedPlanCopy,
} from '../src/app/accounts/source.ts';
import { ACCOUNTS_ERROR_COPY, AccountsError } from '../src/app/accounts/states.ts';
import {
  API_BASE_PATH,
  API_ORIGIN_VAR,
  SESSION_COOKIE,
  createApiClient,
} from '../src/http/client.ts';
import type { Transport } from '../src/http/client.ts';

// =============================================================================
// THE SEAM, FOR THE ACCOUNTS SEGMENT. ADR-162, executed.
// =============================================================================
// EVERY ASSERTION BELOW GOES THROUGH THE REAL `createApiClient` OVER A STUB
// TRANSPORT, never through a mock of the client. What is being proven is the
// whole path -- URL composition, the forwarded cookie, `no-store`, the status
// mapping, the JSON read, this segment's guards and the screen -- because a
// mock of `ApiClient` would prove that `loadListFrom` calls a function.
//
// `apps/portal/test/accounts-screen.test.ts` asserts the MARKUP and
// `apps/portal/test/accounts.test.ts` asserts the VIEW MODELS. This file
// asserts what arrives and what happens when it does not.

const ORIGIN = 'https://api.example.com';

/** API_CONTRACT section 6, transcribed. `accounts-screen.test.ts`'s `ITEM`. */
const ITEM: AccountListItem = {
  account_id: 'acc_01J8XQ7K9M2N4P6R8T0V2W4Y',
  plan: { plan_id: 'plan_core_eod', code: 'CORE_EOD', name: 'Core EOD', version: 7 },
  size_cents: 5000000,
  phase: 'funded',
  status: 'active',
  balance_cents: 5120000,
  floor_cents: 5000000,

  // NOT the difference of the two above it, which is the only way to prove the
  // guard and the screen read the server's own subtraction (INV-M4-01).
  floor_distance_cents: 111111,
  withdrawable_cents: 120000,
  as_of_trading_day: '2026-08-20',
  blocked: { payouts_frozen: false, recon_blocked: false, kyc_required: false },
};

const DETAIL: AccountDetail = {
  ...ITEM,
  platform: 'rithmic',
  platform_account_ref: 'RITH-9911',
  front_end_permissions: ['R|Trader'],
  opened_on: '2026-05-02',
  funded_on: '2026-06-11',
  closed_on: null,
  close_reason: null,
  progress: {
    profit_target_cents: null,
    profit_cents: null,
    buffer_cents: 250000,
    buffer_progress_cents: 120000,
    win_days: { have: 6, need: 5, floor_cents: 20000 },
    traded_days: { have: 14, need: 10 },
    consistency: { best_day_share_bp: 2150, max_bp: 4000, skipped: false },
    cadence: { days_since_last_payout: 21, need: 14, next_eligible_trading_day: null },
    ladder: { payouts_settled: 1, payouts_to_graduate: 4 },
  },
  rules_url: 'https://merit.example/plans/plan_core_eod/versions/7',
};

/** The three fields of `GET /plans/:planId/versions/:version` this segment reads. */
const PLAN = {
  plan_id: 'plan_core_eod',
  version: 7,
  copy_blocks: {
    'eval.funded_reset':
      'Your funded account starts at the account size. Profit from the evaluation is not carried over.',
  },
};

const MARKS: readonly MarkListItem[] = [
  {
    trading_day: '2026-08-20',
    opening_balance_cents: 5100000,
    closing_balance_cents: 5120000,
    high_balance_cents: 5130000,
    low_balance_cents: 5090000,
    realized_pnl_cents: 20000,
    traded_day: true,
    win_day: true,
    floor_cents: 5000000,
    withdrawable_cents: 120000,
    corrected: false,
  },
];

type Call = { url: string; init: RequestInit };

/**
 * A transport that answers per path.
 *
 * KEYED ON THE PATH RATHER THAN ON CALL ORDER, because the detail load performs
 * two reads whose second URL is composed from the first response, and an
 * order-keyed stub would pass while the composition was wrong.
 */
function serving(routes: Readonly<Record<string, { body: unknown; status?: number }>>): {
  readonly transport: Transport;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      const path = url.slice(`${ORIGIN}${API_BASE_PATH}`.length);
      const route = routes[path];
      if (route === undefined)
        return Promise.resolve(
          new Response(JSON.stringify({ type: 'about:blank' }), { status: 404 }),
        );
      return Promise.resolve(
        new Response(typeof route.body === 'string' ? route.body : JSON.stringify(route.body), {
          status: route.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

const DETAIL_PATH = accountPath(DETAIL.account_id);
const PLAN_PATH = planVersionPath(DETAIL.plan.plan_id, DETAIL.plan.version);

// -----------------------------------------------------------------------------
// The paths
// -----------------------------------------------------------------------------

test('the paths are API_CONTRACT`s, and a route parameter cannot reshape one', () => {
  expect(ACCOUNTS_PATH).toBe('/accounts');
  expect(DETAIL_PATH).toBe(`/accounts/${DETAIL.account_id}`);
  expect(PLAN_PATH).toBe('/plans/plan_core_eod/versions/7');

  // THE ID ARRIVES FROM A URL SEGMENT AND IS RE-ENCODED. A value carrying a
  // slash would otherwise read an endpoint nobody asked for, and `..` in a path
  // segment is the shape that reaches one that is not even in this contract.
  expect(accountPath('acc_1/../me')).toBe('/accounts/acc_1%2F..%2Fme');
  expect(accountPath('a?b#c')).toBe('/accounts/a%3Fb%23c');
  expect(planVersionPath('plan/../x', 7)).toBe('/plans/plan%2F..%2Fx/versions/7');
});

// -----------------------------------------------------------------------------
// SC-M4-02, the one screen that is wired end to end
// -----------------------------------------------------------------------------

test('the account list is a real request and the ready branch is the same screen', async () => {
  const { transport, calls } = serving({ [ACCOUNTS_PATH]: { body: [ITEM] } });
  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });

  const loaded = await loadListFrom({ client });

  // THE REQUEST. Base path appended by the client and not by this segment, the
  // trader's one cookie forwarded, and `no-store` on a screen that renders
  // money.
  expect(calls.length).toBe(1);
  expect(calls[0]?.url).toBe(`${ORIGIN}${API_BASE_PATH}${ACCOUNTS_PATH}`);
  expect((calls[0]?.init.headers as Record<string, string>)['cookie']).toBe(
    `${SESSION_COOKIE}=tok_abc`,
  );
  expect(calls[0]?.init.cache).toBe('no-store');

  expect(loaded).toEqual({ kind: 'ready', accounts: [ITEM] });
});

test('a refusal on a registered endpoint is an error and not a pending endpoint', async () => {
  for (const [status, kind] of [
    [401, 'unauthenticated'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [403, 'unexpected'],
  ] as const) {
    const { transport } = serving({ [ACCOUNTS_PATH]: { body: { type: 'about:blank' }, status } });
    const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

    // THIS IS THE ARM THE PAYOUT CENTRE DOES NOT HAVE (ADR-162 section 5 item
    // 1). Without it every one of these five renders as "waiting on an
    // endpoint", which is false on all five.
    expect(await loadListFrom({ client }), String(status)).toEqual({
      kind: 'error',
      error: kind,
      status,
    });
  }
});

test('a transport failure propagates as an error with no status invented', async () => {
  const client = createApiClient({
    origin: ORIGIN,
    sessionToken: null,
    transport: () => Promise.reject(new Error('ECONNREFUSED')),
  });

  // ADR-162 clause 3: a request that never reached a status line has no number,
  // and `503` is the tempting one to invent.
  expect(await loadListFrom({ client })).toEqual({
    kind: 'error',
    error: 'server_error',
    status: null,
  });
});

test('a 200 that does not satisfy the guard is a server that answered wrongly', async () => {
  for (const body of [
    { not: 'an array' },
    [{ ...ITEM, balance_cents: 5120000.5 }],
    [{ ...ITEM, phase: 'promoted' }],
    [{ ...ITEM, blocked: { payouts_frozen: false } }],
    'not json at all',
  ]) {
    const { transport } = serving({ [ACCOUNTS_PATH]: { body } });
    const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });
    const loaded = await loadListFrom({ client });

    // NOT `unavailable`. The endpoint is registered and it replied, so "waiting
    // on an endpoint" would be a false sentence about a real answer.
    expect(loaded.kind, JSON.stringify(body).slice(0, 50)).toBe('error');
    if (loaded.kind !== 'error') continue;
    expect(loaded.error).toBe('server_error');
  }
});

// -----------------------------------------------------------------------------
// SC-M4-03, two reads that exist and one that does not
// -----------------------------------------------------------------------------

test('the detail load performs both registered reads and composes the second from the first', async () => {
  const { transport, calls } = serving({
    [DETAIL_PATH]: { body: DETAIL },
    [PLAN_PATH]: { body: PLAN },
  });
  const client = createApiClient({ origin: ORIGIN, sessionToken: 'tok_abc', transport });

  const loaded = await loadDetailFrom({ client, account: DETAIL.account_id, marks: MARKS });

  // THE PLAN PATH IS BUILT FROM THE ACCOUNT RESPONSE, which is ports.ts's
  // "SECOND ROUND TRIP and no document says so" arriving as two URLs in order.
  expect(calls.map((call) => call.url)).toEqual([
    `${ORIGIN}${API_BASE_PATH}${DETAIL_PATH}`,
    `${ORIGIN}${API_BASE_PATH}${PLAN_PATH}`,
  ]);
  for (const call of calls) {
    expect((call.init.headers as Record<string, string>)['cookie']).toBe(
      `${SESSION_COOKIE}=tok_abc`,
    );
    expect(call.init.cache).toBe('no-store');
  }

  expect(loaded).toEqual({
    kind: 'ready',
    detail: DETAIL,
    pinned: toPinnedPlanCopy(PLAN),
    marks: MARKS,
  });
});

test('the marks endpoint is unregistered, so it is the one the screen names', async () => {
  const { transport } = serving({
    [DETAIL_PATH]: { body: DETAIL },
    [PLAN_PATH]: { body: PLAN },
  });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadDetailFrom({ client, account: DETAIL.account_id, marks: null });

  expect(loaded).toEqual({ kind: 'unavailable', missing: [MARKS_ENDPOINT] });
  expect(MARKS_ENDPOINT).toBe('GET /accounts/:accountId/marks');
});

test('a 404 on the account is not_found and never confirms the account exists', async () => {
  // INV-M4-07: "cross-trader resource access returns 404, and the portal
  // renders it as 'not found', NOT 'forbidden'." The wording is
  // `toPortalErrorKind`'s and the catalogue's, and neither has a member that
  // says permission.
  const { transport, calls } = serving({});
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  const loaded = await loadDetailFrom({ client, account: 'acc_somebody_else', marks: MARKS });

  expect(loaded).toEqual({ kind: 'error', error: 'not_found', status: 404 });

  // AND THE PLAN READ IS NOT ATTEMPTED, because its path parameters were on the
  // response that did not arrive.
  expect(calls.length).toBe(1);
});

test('a refusal on the plan version is reported and the screen is not built without it', async () => {
  const { transport } = serving({
    [DETAIL_PATH]: { body: DETAIL },
    [PLAN_PATH]: { body: { type: 'about:blank' }, status: 500 },
  });
  const client = createApiClient({ origin: ORIGIN, sessionToken: null, transport });

  // `toAccountDetail` takes `PinnedPlanCopy` as a REQUIRED argument on both
  // branches, so there is no half screen to fall back to: section 3.4 placement
  // 2 says a card that could be built without the published sentence is a card
  // that renders without it.
  expect(await loadDetailFrom({ client, account: DETAIL.account_id, marks: MARKS })).toEqual({
    kind: 'error',
    error: 'server_error',
    status: 500,
  });
});

// -----------------------------------------------------------------------------
// The guards, field by field
// -----------------------------------------------------------------------------

test('the list guard accepts the contract shape and refuses every field it needs', () => {
  expect(isAccountList([ITEM])).toBe(true);
  expect(isAccountList([])).toBe(true);
  expect(isAccountList({ accounts: [ITEM] })).toBe(false);

  for (const field of Object.keys(ITEM)) {
    const row: Record<string, unknown> = { ...ITEM };
    delete row[field];
    expect(isAccountList([row]), `${field} is required`).toBe(false);
  }

  // Money is integer cents, on every money field the card renders.
  for (const field of [
    'size_cents',
    'balance_cents',
    'floor_cents',
    'floor_distance_cents',
    'withdrawable_cents',
  ]) {
    expect(isAccountList([{ ...ITEM, [field]: 120000.5 }]), `${field} is an integer`).toBe(false);
  }

  // The two closed unions, which a hand-written string list would let drift.
  expect(isAccountList([{ ...ITEM, phase: 'promoted' }])).toBe(false);
  expect(isAccountList([{ ...ITEM, status: 'suspended' }])).toBe(false);
  for (const phase of ['eval', 'funded', 'closed', 'graduated'])
    expect(isAccountList([{ ...ITEM, phase }]), phase).toBe(true);

  // The two nested shapes.
  expect(isAccountList([{ ...ITEM, plan: { plan_id: 'p', code: 'C', name: 'N' } }])).toBe(false);
  expect(isAccountList([{ ...ITEM, blocked: { payouts_frozen: 'yes' } }])).toBe(false);
});

test('the detail guard checks progress on every phase and not only on the one it was handed', () => {
  expect(isAccountDetail(DETAIL)).toBe(true);
  expect(isAccountDetail(ITEM)).toBe(false);

  for (const field of Object.keys(DETAIL)) {
    const row: Record<string, unknown> = { ...DETAIL };
    delete row[field];
    expect(isAccountDetail(row), `${field} is required`).toBe(false);
  }

  // A PARTIAL GUARD WOULD HAVE PASSED THIS ONE. `toProgress` reads the funded
  // fields only on a funded account, so a guard that checked the phase it
  // happened to see would accept an eval row with no `win_days` and crash on
  // the next funded one.
  const evalAccount = { ...DETAIL, phase: 'eval' } as const;
  expect(
    isAccountDetail({ ...evalAccount, progress: { ...DETAIL.progress, win_days: null } }),
  ).toBe(false);
  expect(isAccountDetail({ ...evalAccount, progress: { ...DETAIL.progress, ladder: {} } })).toBe(
    false,
  );

  // Every nested money and count field, one at a time.
  for (const patch of [
    { profit_target_cents: 1.5 },
    { profit_cents: 'lots' },
    { buffer_cents: 250000.5 },
    { buffer_progress_cents: {} },
    { win_days: { have: 6, need: 5, floor_cents: 20000.5 } },
    { traded_days: { have: 14.5, need: 10 } },
    { consistency: { best_day_share_bp: 2150, max_bp: 4000 } },
    { cadence: { days_since_last_payout: 21, need: 14 } },
    { ladder: { payouts_settled: 1 } },
  ]) {
    expect(
      isAccountDetail({ ...DETAIL, progress: { ...DETAIL.progress, ...patch } }),
      JSON.stringify(patch),
    ).toBe(false);
  }

  // `skipped` is INV-M4-05's field and is a boolean, never absent.
  expect(
    isAccountDetail({
      ...DETAIL,
      progress: { ...DETAIL.progress, consistency: { best_day_share_bp: null, max_bp: null } },
    }),
  ).toBe(false);

  expect(isAccountDetail({ ...DETAIL, platform: 'ninjatrader' })).toBe(false);
  expect(isAccountDetail({ ...DETAIL, front_end_permissions: 'R|Trader' })).toBe(false);
  expect(isAccountDetail({ ...DETAIL, front_end_permissions: [7] })).toBe(false);
});

test('the plan guard names exactly what it verified and nothing else', () => {
  expect(isPinnedPlanSource(PLAN)).toBe(true);
  expect(isPinnedPlanSource({ ...PLAN, copy_blocks: {} })).toBe(true);
  expect(isPinnedPlanSource({ ...PLAN, copy_blocks: { a: 7 } })).toBe(false);
  expect(isPinnedPlanSource({ ...PLAN, version: '7' })).toBe(false);
  expect(isPinnedPlanSource({ plan_id: 'p', version: 7 })).toBe(false);

  // IT IS NOT A `PlanVersionResponse` GUARD, and the type is why: a predicate
  // returning `value is PlanVersionResponse` after checking three of eight
  // fields would entitle the next reader to `rules` and `sizes`, which nothing
  // here checked. This one claims three fields and checks three fields, and
  // `rules` being absent is therefore not a rejection.
  expect(isPinnedPlanSource({ plan_id: 'p', version: 1, copy_blocks: {} })).toBe(true);

  expect(toPinnedPlanCopy(PLAN)).toEqual({
    plan_id: PLAN.plan_id,
    version: PLAN.version,
    blocks: PLAN.copy_blocks,
  });
});

// -----------------------------------------------------------------------------
// `load`, `loadDetail`, and the one error either converts
// -----------------------------------------------------------------------------

test('an unconfigured deployment reaches no endpoint and each screen says which', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    expect(await load()).toEqual({ kind: 'unavailable', missing: [...LIST_REQUIRED_ENDPOINTS] });
    expect(await loadDetail('acc_1')).toEqual({
      kind: 'unavailable',
      missing: [...DETAIL_REQUIRED_ENDPOINTS],
    });
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('the conversion is narrow: anything that is not a configuration error propagates', async () => {
  // WITH AN ORIGIN SET, BOTH LOADS GET PAST `resolveApiOrigin` AND REACH
  // `cookies()`, WHICH HAS NO REQUEST SCOPE HERE. That failure is NOT an
  // `ApiConfigError` and must not be rendered as a pending endpoint: a screen
  // that reported every fault in this application as "waiting on GET /accounts"
  // would be the quiet failure ADR-162 foreclosure 6 refuses.
  const saved = process.env[API_ORIGIN_VAR];
  process.env[API_ORIGIN_VAR] = ORIGIN;
  try {
    await expect(load()).rejects.toBeDefined();
    await expect(loadDetail('acc_1')).rejects.toBeDefined();
  } finally {
    if (saved === undefined) delete process.env[API_ORIGIN_VAR];
    else process.env[API_ORIGIN_VAR] = saved;
  }
});

// -----------------------------------------------------------------------------
// The pages, which is where the three arms become three screens
// -----------------------------------------------------------------------------

test('both pages render the unavailable arm and neither throws', async () => {
  const saved = process.env[API_ORIGIN_VAR];
  delete process.env[API_ORIGIN_VAR];
  try {
    const list = renderToStaticMarkup(await AccountsPage());
    const detail = renderToStaticMarkup(
      await AccountPage({ params: Promise.resolve({ account: DETAIL.account_id }) }),
    );

    // NOT AN EMPTY LIST AND NOT AN EXCEPTION. ports.ts used to throw here, on
    // the argument that an empty list would render "no accounts" and "cannot
    // reach the API" as the same screen. Both sentences are still different and
    // neither page fails loudly at a trader any more.
    for (const html of [list, detail]) {
      expect(html).toContain('Nothing has failed');
      expect(html).not.toContain('You hold no accounts.');
    }
    expect(list).toContain('GET /accounts');
    expect(detail).toContain(MARKS_ENDPOINT);
  } finally {
    if (saved !== undefined) process.env[API_ORIGIN_VAR] = saved;
  }
});

test('no sentence this segment shows a trader words a refusal as a refusal of permission', () => {
  // INV-M4-07: "existence is not confirmed to a stranger, AND THE UI MUST NOT
  // UNDO THAT BY WORDING." `PortalErrorKind` has no `forbidden` member, and a
  // copy catalogue is where that refusal gets reinstated by a sentence.
  for (const [kind, sentence] of Object.entries(ACCOUNTS_ERROR_COPY)) {
    for (const word of ['forbidden', 'not allowed', 'permission', 'denied', 'unauthorized'])
      expect(sentence.toLowerCase(), `${kind} says ${word}`).not.toContain(word);
  }

  // AND THE STATUS IS NOT ON THE SCREEN. A `404` printed beside "we could not
  // find that account" is the number that tells a stranger "no such account"
  // from "not yours". The load carries it for a later observability slice; the
  // markup does not.
  const refused = renderToStaticMarkup(AccountsError({ heading: 'Account', error: 'not_found' }));
  const text = refused.replace(/<[^>]*>/g, ' ');
  expect(text).toContain(ACCOUNTS_ERROR_COPY.not_found);
  expect(text, 'no status number reaches the trader').not.toMatch(/\d/);
});
