import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import { SESSION_COOKIE, resetAuthBackend, useAuthBackend } from '../src/routes/auth.ts';
import type { AuthBackend, AuthSession } from '../src/routes/auth.ts';
import {
  CatalogRowError,
  CatalogUnwired,
  PLAN_VERSION_PATH,
  PLANS_PATH,
  PURCHASES_MAX_LIMIT,
  PURCHASES_PATH,
  capAtFirstOrdinal,
  currentCatalogReads,
  databaseCatalogReads,
  decodeCursor,
  encodeCursor,
  minPayoutCentsOf,
  renderPlans,
  renderPurchases,
  useCatalogReads,
  validatePurchaseQuery,
} from '../src/routes/catalog.ts';
import type {
  AccountLinkRow,
  CatalogReads,
  PlanPin,
  PlanRow,
  PlansResponse,
  PlanVersionResponse,
  PlanVersionRow,
  PlanVersionSizeRow,
  PurchaseListResponse,
  PurchaseRow,
} from '../src/routes/catalog.ts';
import type { ApiDb } from '../src/db.ts';
import { NO_PRE_IDENTITY_DOORS, recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project.
//
// -----------------------------------------------------------------------------
// WHAT THE THREE KINDS OF CASE BELOW EACH PROVE, STATED SO NONE IS MISTAKEN FOR
// ANOTHER
// -----------------------------------------------------------------------------
// 1. THROUGH FASTIFY'S REAL ROUTER (`inject`). The response shapes, the
//    allowlist, the 404s, the cursor and the surface filter. A 404 produced here
//    is produced the way a socket's is.
//
// 2. THROUGH `db-recorder.ts`. WHICH DOOR each read opened and WHOSE IDENTITY
//    the scoped one was opened with. That is a property of `apps/api` and it
//    fails in the direction ADR-008 was accepted for. It proves NOTHING about
//    whether a composed predicate reaches one row or many; that is
//    `packages/db`'s and is asserted in `packages/db/test/keyed-accessor.test.ts`.
//
// 3. THROUGH `filteringDb` BELOW, WHICH IS NOT THE RECORDER AND IS NOT A SECOND
//    ACCESSOR. Its scoped door applies ONE rule -- `WHERE identity_id = $1` over
//    a fixture holding two identities' rows -- and its firm door applies none.
//    What that proves is the property this FILE owns and that the recorder
//    cannot see: the handler does not RE-WIDEN what the door narrowed. If
//    `purchasesOf` had been written on the firm door, or if `account_id` had
//    been resolved across identities, every case in that section goes red. What
//    it does not prove is that the real accessor narrows in the first place,
//    and that is said here rather than implied.

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

const CORE_EOD = 'aaaaaaaa-0001-4000-8000-000000000001';
const RAPID = 'aaaaaaaa-0001-4000-8000-000000000002';
const CORE_V2 = 'bbbbbbbb-0002-4000-8000-000000000002';
const CORE_V1 = 'bbbbbbbb-0001-4000-8000-000000000001';
const RAPID_V1 = 'bbbbbbbb-0003-4000-8000-000000000003';

// -----------------------------------------------------------------------------
// Fixtures, on the corpus's own frozen numbers where the corpus states them
// -----------------------------------------------------------------------------
// Money is integer cents everywhere, which is API_CONTRACT section 1 and INV-02.
// `min_payout_cents: 10000` and the flat `payout_cap_schedule` are DATA_MODEL
// section 11's Core EOD example; `size_cents: 5_000_000` is one of the four v1
// sizes `0004` names.

function rules(minPayoutCents: number): unknown {
  return {
    schema_version: 1,
    phase_eval: { enabled: true, min_trading_days: 1 },
    phase_funded: { min_payout_cents: minPayoutCents, max_payouts: 5 },
    limits: { max_accounts_per_entity: 10 },
    kyc: { triggers: ['second_distinct_account_purchase', 'pre_funded'] },
  };
}

const PLANS: readonly PlanRow[] = [
  { id: CORE_EOD, code: 'core_eod', name: 'Core EOD', is_active: true, sort_order: 0 },
  { id: RAPID, code: 'merit_rapid', name: 'Merit Rapid', is_active: true, sort_order: 1 },
];

function version(over: Partial<PlanVersionRow> = {}): PlanVersionRow {
  return {
    id: CORE_V2,
    plan_id: CORE_EOD,
    version: 2,
    status: 'published',
    rules: rules(10000),
    copy_blocks: { 'phase_funded.split_bp': 'You keep 90 percent.' },
    public_visible: true,
    published_at: '2026-08-01T00:00:00.000Z',
    retired_at: null,
    ...over,
  };
}

function size(over: Partial<PlanVersionSizeRow> = {}): PlanVersionSizeRow {
  return {
    plan_version_id: CORE_V2,
    size_cents: 5_000_000n,
    price_cents: 9_900n,
    reset_price_cents: 8_900n,
    drawdown_cents: 250_000n,
    profit_target_cents: 300_000n,
    buffer_cents: 100_000n,
    win_day_floor_cents: 15_000n,
    payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: 150_000n }],
    ...over,
  };
}

function purchase(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: 'cccccccc-0001-4000-8000-000000000001',
    plan_version_id: CORE_V2,
    created_at: '2026-08-20T10:00:00.000Z',
    kind: 'new',
    size_cents: 5_000_000n,
    amount_paid_cents: 9_900n,
    discount_cents: 0n,
    status: 'paid',
    ...over,
  };
}

const CORE_PIN: PlanPin = {
  plan_version_id: CORE_V2,
  plan_id: CORE_EOD,
  code: 'core_eod',
  version: 2,
};

/** Reads over fixed rows, with both halves supplied. */
function readsOf(over: Partial<CatalogReads['firm']> = {}): CatalogReads {
  return {
    firm: {
      catalogue: () =>
        Promise.resolve({
          plans: PLANS,
          versions: [version(), version({ id: RAPID_V1, plan_id: RAPID, version: 1 })],
          sizes: [size(), size({ plan_version_id: RAPID_V1 })],
        }),
      versionAt: (planId, v) =>
        Promise.resolve(
          planId === CORE_EOD && v === 2 ? { version: version(), sizes: [size()] } : null,
        ),
      plansOfVersions: () => Promise.resolve([CORE_PIN]),
      ...over,
    },
    scoped: {
      purchasesOf: () => Promise.resolve({ purchases: [purchase()], accounts: [] }),
    },
  };
}

/** A session-bearing backend over one token per identity. */
function sessionsFor(...identityIds: readonly string[]): AuthBackend {
  const byToken = new Map<string, AuthSession>();
  for (const identityId of identityIds)
    byToken.set(`t-${identityId}`, {
      id: `s-${identityId}`,
      identityId,
      userId: `u-${identityId}`,
      authFactor: 'email_otp',
      elevatedAt: null,
      elevatedByFactor: null,
    });
  return {
    sessionByToken: (token: string) => Promise.resolve(byToken.get(token) ?? null),
  } as unknown as AuthBackend;
}

// A source set by one case and read by the next is a suite that passes for the
// wrong reason, so both wirings are cleared after every case.
afterEach(() => {
  useCatalogReads(null);
  resetAuthBackend();
});

// -----------------------------------------------------------------------------
// The module, as the directory listing hands it over
// -----------------------------------------------------------------------------

test('the three routes are on disk under one module name, ordered by path', () => {
  const module = onDisk.find((m) => m.name === 'catalog');
  expect(module).toBeDefined();
  expect(module?.routes.map((r) => `${r.method} ${r.path}`)).toStrictEqual([
    `GET ${PLANS_PATH}`,
    `GET ${PLAN_VERSION_PATH}`,
    `GET ${PURCHASES_PATH}`,
  ]);
});

test('the version path carries BOTH segments, because one does not name a version', () => {
  // `plan_versions_plan_version_uq (plan_id, version)` makes the PAIR the
  // address of one version. A single-segment `/plans/:plan` is half of it, and
  // API_CONTRACT section 4 spells the whole thing.
  expect(PLAN_VERSION_PATH).toBe('/plans/:planId/versions/:version');
});

test('all three are public paths: the operator deployment withholds every one', () => {
  const endpoints = [`GET ${PLANS_PATH}`, `GET ${PLAN_VERSION_PATH}`, `GET ${PURCHASES_PATH}`];

  const publicSide = buildServer({ surface: 'public', modules: onDisk });
  for (const endpoint of endpoints) expect(publicSide.report.registered).toContain(endpoint);

  // ADR-083: the admin origin answers 404 by having nothing there. `/purchases`
  // is a trader route rather than an operator one, so it belongs on the public
  // surface with the two catalogue reads.
  const operatorSide = buildServer({ surface: 'operator', modules: onDisk });
  for (const endpoint of endpoints) expect(operatorSide.report.withheld).toContain(endpoint);
});

// -----------------------------------------------------------------------------
// GET /plans
// -----------------------------------------------------------------------------

test('the plan list renders section 4s shape, ordered by sort_order', async () => {
  useCatalogReads(readsOf());
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}${PLANS_PATH}` });
  expect(res.statusCode).toBe(200);
  const body = res.json() as PlansResponse;

  expect(body.data.map((p) => p.code)).toStrictEqual(['core_eod', 'merit_rapid']);
  expect(body.data[0]?.current_version).toStrictEqual({ plan_version_id: CORE_V2, version: 2 });
  expect(body.data[0]?.sizes[0]).toStrictEqual({
    size_cents: 5_000_000,
    price_cents: 9_900,
    reset_price_cents: 8_900,
    drawdown_cents: 250_000,
    profit_target_cents: 300_000,
    buffer_cents: 100_000,
    win_day_floor_cents: 15_000,
    // The first rung of the schedule, and the per-VERSION minimum out of the
    // rules jsonb. Neither is a column of `plan_version_sizes`.
    payout_cap_cents: 150_000,
    min_payout_cents: 10_000,
  });

  await app.close();
});

test('current_version is the ON SALE version and not the highest number', () => {
  // SD-M9-01, in `0004`'s own words: "A version can be published-for-engine
  // while not yet being the one on sale. Two different facts, and one boolean
  // cannot hold both." So version 3 is `published` and invisible, and version 2
  // is the one a price is quoted from.
  const rendered = renderPlans({
    plans: [PLANS[0]!],
    versions: [
      version(),
      version({ id: 'bbbbbbbb-0003-4000-8000-00000000000a', version: 3, public_visible: false }),
    ],
    sizes: [size()],
  });
  expect(rendered.data[0]?.current_version.version).toBe(2);
});

test('two versions on sale for one plan is a refusal, because the index is not unique', () => {
  // `plan_versions_on_sale_idx` is a PARTIAL PLAIN index whose comment reads
  // "the one version on sale per plan". A comment is not a constraint, so the
  // database admits this row set and the catalogue must not.
  expect(() =>
    renderPlans({
      plans: [PLANS[0]!],
      versions: [version(), version({ id: 'bbbbbbbb-0004-4000-8000-00000000000b', version: 3 })],
      sizes: [size()],
    }),
  ).toThrow(CatalogRowError);
});

test('a delisted plan and a plan with no visible version are both omitted', () => {
  const rendered = renderPlans({
    plans: [
      { ...PLANS[0]!, is_active: false },
      PLANS[1]!,
      {
        id: 'aaaaaaaa-0001-4000-8000-000000000003',
        code: 'direct',
        name: 'Direct',
        is_active: true,
        sort_order: 2,
      },
    ],
    // Merit Rapid has a visible version; Direct has none at all.
    versions: [version(), version({ id: RAPID_V1, plan_id: RAPID, version: 1 })],
    sizes: [size({ plan_version_id: RAPID_V1 })],
  });
  // `is_active` DELISTS AND NEVER DELETES, so the row is readable and the
  // pricing page still must not offer it; Direct is ordinary authoring.
  expect(rendered.data.map((p) => p.code)).toStrictEqual(['merit_rapid']);
});

test('a plan code the contract does not declare is refused rather than dropped', () => {
  // `plans.code` is `text NOT NULL UNIQUE` with no CHECK, so a fourth code is
  // storable. A purchasable plan silently missing from the page it is sold on
  // is worse than a page that fails loudly.
  expect(() =>
    renderPlans({
      plans: [{ ...PLANS[0]!, code: 'core_intraday' }],
      versions: [version()],
      sizes: [size()],
    }),
  ).toThrow(/core_intraday/);
});

test('a cap schedule that does not start at ordinal 1 is refused, not read by position', () => {
  // CV-09 requires the first `from_ordinal` to be 1. The rung is SELECTED by
  // ordinal rather than taken by position, because jsonb array order survives a
  // round trip only as well as whoever wrote it.
  expect(() => capAtFirstOrdinal([{ from_ordinal: 2, cap_cents: 1n }], CORE_V2, 5n)).toThrow(
    CatalogRowError,
  );
  expect(() => capAtFirstOrdinal([], CORE_V2, 5n)).toThrow(/empty/);
  expect(
    capAtFirstOrdinal(
      [
        { from_ordinal: 3, cap_cents: 300n },
        { from_ordinal: 1, cap_cents: 100n },
      ],
      CORE_V2,
      5n,
    ),
  ).toBe(100n);
});

test('a version whose rules carry no min_payout_cents cannot be rendered as a price', () => {
  expect(() => minPayoutCentsOf({ phase_funded: {} }, CORE_V2)).toThrow(CatalogRowError);
  expect(() => minPayoutCentsOf(null, CORE_V2)).toThrow(CatalogRowError);
  expect(minPayoutCentsOf(rules(25_000), CORE_V2)).toBe(25_000);
});

// -----------------------------------------------------------------------------
// GET /plans/:planId/versions/:version
// -----------------------------------------------------------------------------

test('one version renders with its rules and copy, and section 1s allowlist holds', async () => {
  useCatalogReads(readsOf());
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}/plans/${CORE_EOD}/versions/2`,
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as PlanVersionResponse;

  expect(Object.keys(body).sort()).toStrictEqual([
    'copy_blocks',
    'plan_id',
    'plan_version_id',
    'published_at',
    'retired_at',
    'rules',
    'sizes',
    'status',
    'version',
  ]);
  expect(body.status).toBe('published');
  expect(body.rules).toStrictEqual(rules(10000));

  await app.close();
});

test('the firm-internal ALTER columns never reach the wire, which is the allowlist working', async () => {
  // ADR-102 section 7's blind spot is a column added by ALTER that the firm
  // check does not read. `plan_versions` has three. None reaches `identities`,
  // so no scope class would have withheld them; `simulation_waiver_reason` is
  // free text about MERIT'S OWN publish decision and this is a public read.
  useCatalogReads(
    readsOf({
      versionAt: () =>
        Promise.resolve({
          version: {
            ...version(),
            // Extra fields the row carries and the shape does not declare.
            ...({
              simulation_waiver_reason: 'no run: the founder waived it on a call',
              decided_on_simulation_run_id: 'dddddddd-0001-4000-8000-000000000001',
              public_slug: 'core-eod-v2',
              created_by: 'ops@meritfutures.com',
            } as Partial<PlanVersionRow>),
          },
          sizes: [size()],
        }),
    }),
  );
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/plans/${CORE_EOD}/versions/2` });
  expect(res.body).not.toContain('waived');
  expect(res.body).not.toContain('simulation');
  expect(res.body).not.toContain('core-eod-v2');
  expect(res.body).not.toContain('ops@meritfutures.com');

  await app.close();
});

test('a retired version is still served, which is the whole point of the row', async () => {
  useCatalogReads(
    readsOf({
      versionAt: () =>
        Promise.resolve({
          version: version({
            id: CORE_V1,
            version: 1,
            status: 'retired',
            retired_at: '2026-08-01T00:00:00.000Z',
            public_visible: false,
          }),
          sizes: [size({ plan_version_id: CORE_V1 })],
        }),
    }),
  );
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  // Section 4: "including for retired versions, so a trader can always retrieve
  // the contract they bought."
  const res = await app.inject({ method: 'GET', url: `${BASE_PATH}/plans/${CORE_EOD}/versions/1` });
  expect(res.statusCode).toBe(200);
  expect((res.json() as PlanVersionResponse).status).toBe('retired');

  await app.close();
});

test('a draft, an unknown pair and a non-integer version are each a 404', async () => {
  useCatalogReads(
    readsOf({
      versionAt: (_planId, v) =>
        Promise.resolve(
          v === 9 ? { version: version({ version: 9, status: 'draft' }), sizes: [] } : null,
        ),
    }),
  );
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  for (const url of [
    `${BASE_PATH}/plans/${CORE_EOD}/versions/9`, // a draft
    `${BASE_PATH}/plans/${CORE_EOD}/versions/7`, // no such pair
    `${BASE_PATH}/plans/${CORE_EOD}/versions/0`, // `version > 0` is a CHECK
    `${BASE_PATH}/plans/${CORE_EOD}/versions/abc`,
    `${BASE_PATH}/plans/${CORE_EOD}/versions/99999999999999`, // past int4
  ]) {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  }

  await app.close();
});

// -----------------------------------------------------------------------------
// GET /purchases: the wire
// -----------------------------------------------------------------------------

function withSession(identityId: string): { cookie: string } {
  useAuthBackend(sessionsFor(ALICE, BOB));
  return { cookie: `${SESSION_COOKIE}=t-${identityId}` };
}

test('the purchase list renders section 5s shape and answers 401 with no session', async () => {
  useCatalogReads(readsOf());
  useAuthBackend(sessionsFor(ALICE));
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const anonymous = await app.inject({ method: 'GET', url: `${BASE_PATH}${PURCHASES_PATH}` });
  expect(anonymous.statusCode).toBe(401);

  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}`,
    headers: { cookie: `${SESSION_COOKIE}=t-${ALICE}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as PurchaseListResponse;
  expect(body.next_cursor).toBeNull();
  expect(body.data[0]).toStrictEqual({
    purchase_id: 'cccccccc-0001-4000-8000-000000000001',
    created_at: '2026-08-20T10:00:00.000Z',
    kind: 'new',
    // Section 5 declares `plan: { plan_id, code, version }`. Section 6 declares
    // a `name` on the account's; this shape has none and none travels.
    plan: { plan_id: CORE_EOD, code: 'core_eod', version: 2 },
    size_cents: 5_000_000,
    amount_paid_cents: 9_900,
    discount_cents: 0,
    status: 'paid',
    account_id: null,
  });

  await app.close();
});

test('the cursor is keyset on the PAIR, because created_at is not a total order', () => {
  const sameSecond = [
    purchase({ id: 'cccccccc-0001-4000-8000-00000000000a' }),
    purchase({ id: 'cccccccc-0001-4000-8000-00000000000b' }),
    purchase({ id: 'cccccccc-0001-4000-8000-00000000000c' }),
  ];
  const snapshot = { purchases: sameSecond, accounts: [] };

  const first = renderPurchases(snapshot, [CORE_PIN], { limit: 2, cursor: null });
  expect(first.data.map((p) => p.purchase_id)).toStrictEqual([
    'cccccccc-0001-4000-8000-00000000000c',
    'cccccccc-0001-4000-8000-00000000000b',
  ]);
  expect(first.next_cursor).not.toBeNull();

  const second = renderPurchases(snapshot, [CORE_PIN], {
    limit: 2,
    cursor: decodeCursor(first.next_cursor!),
  });
  // No repeat and no skip across a shared timestamp, which is what the id half
  // of the cursor is for.
  expect(second.data.map((p) => p.purchase_id)).toStrictEqual([
    'cccccccc-0001-4000-8000-00000000000a',
  ]);
  expect(second.next_cursor).toBeNull();
});

test('the cursor round trips and is opaque on the wire', () => {
  const cursor = { created_at: '2026-08-20T10:00:00.000Z', purchase_id: ALICE };
  const encoded = encodeCursor(cursor);
  expect(encoded).not.toContain('2026');
  expect(decodeCursor(encoded)).toStrictEqual(cursor);
});

test('a cursor this endpoint did not issue is a validation_failed, not an empty page', async () => {
  useCatalogReads(readsOf());
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  // An empty page for an unreadable cursor is a list that silently ends early,
  // and a client cannot tell that from having reached the end.
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}?cursor=%21%21%21`,
    headers: withSession(ALICE),
  });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: 'validation_failed' });

  await app.close();
});

test('limit is bounded by section 1s ceiling and defaults to its default', () => {
  expect(validatePurchaseQuery({})).toStrictEqual({ ok: true, value: { limit: 25, cursor: null } });
  expect(validatePurchaseQuery({ limit: '100' })).toMatchObject({ ok: true });
  expect(validatePurchaseQuery({ limit: String(PURCHASES_MAX_LIMIT + 1) })).toMatchObject({
    ok: false,
  });
  expect(validatePurchaseQuery({ limit: '0' })).toMatchObject({ ok: false });
  expect(validatePurchaseQuery({ limit: '1.5' })).toMatchObject({ ok: false });
});

test('a purchase whose plan version the catalogue read did not return is a defect', () => {
  // `purchases.plan_version_id` is `NOT NULL REFERENCES plan_versions(id) ON
  // DELETE RESTRICT`, so the version cannot be gone. Dropping the row would
  // shorten a person's purchase history without saying so.
  expect(() =>
    renderPurchases({ purchases: [purchase()], accounts: [] }, [], { limit: 25, cursor: null }),
  ).toThrow(CatalogRowError);
});

test('account_id inverts accounts.purchase_id, which is what makes it single valued', () => {
  const account: AccountLinkRow = {
    id: 'eeeeeeee-0001-4000-8000-000000000001',
    purchase_id: 'cccccccc-0001-4000-8000-000000000001',
  };
  const rendered = renderPurchases({ purchases: [purchase()], accounts: [account] }, [CORE_PIN], {
    limit: 25,
    cursor: null,
  });
  expect(rendered.data[0]?.account_id).toBe(account.id);

  // `accounts.purchase_id` is `NOT NULL UNIQUE`, so two accounts on one purchase
  // is a row set contradicting its own table.
  expect(() =>
    renderPurchases(
      {
        purchases: [purchase()],
        accounts: [account, { ...account, id: 'eeeeeeee-0002-4000-8000-000000000002' }],
      },
      [CORE_PIN],
      { limit: 25, cursor: null },
    ),
  ).toThrow(CatalogRowError);
});

// -----------------------------------------------------------------------------
// The doors, through the recorder. Kind 2 in this file's header
// -----------------------------------------------------------------------------

test('the catalogue reads open the FIRM door and hand it no identity', async () => {
  const { db, calls } = recordingDb({ rowsWhere: [] });
  await databaseCatalogReads(db).firm.catalogue();

  expect(calls.map((c) => `${c.door} ${c.verb} ${c.key}`)).toStrictEqual([
    'firm rowsWhere plans',
    'firm rowsWhere planVersions',
  ]);
  // `firmDb()` takes no reason and no identity (ADR-102 clause 5). The recorder
  // records the identity the SCOPED door was opened with, and there is none here.
  for (const call of calls) expect(call.identityId).toBeUndefined();
});

test('the version address is rowsWhere and not rowAt, because schema.ts declares no such key', async () => {
  // `refuseUnaddressed` reads the unique keys `schema.ts` declares. `planVersions`
  // declares `id` and nothing else, so `plan_versions_plan_version_uq (plan_id,
  // version)` is one of the 34 keys `scoped-db.ts` measures present in the
  // migrations and absent from the transcription: `rowAt` on the pair throws.
  const { db, calls } = recordingDb({ rowsWhere: [] });
  await databaseCatalogReads(db).firm.versionAt(CORE_EOD, 2);

  expect(calls).toStrictEqual([
    {
      door: 'firm',
      verb: 'rowsWhere',
      key: 'planVersions',
      address: { planId: CORE_EOD, version: 2 },
    },
  ]);
});

test('the purchase read opens the SCOPED door with the identity the session resolved', async () => {
  const { db, calls } = recordingDb({ rows: [] });
  await databaseCatalogReads(db).scoped.purchasesOf(ALICE);

  expect(calls).toStrictEqual([
    { door: 'scoped', identityId: ALICE, verb: 'rows', key: 'purchases' },
    { door: 'scoped', identityId: ALICE, verb: 'rows', key: 'accounts' },
  ]);
  // BOTH TABLES ON ONE HANDLE, so both reads are in one transaction and the
  // account a purchase reports is the account that existed when it was read.
});

test('the identity reaching the scoped door is the sessions, never one off the request', async () => {
  const opened: string[] = [];
  const watching: ApiDb = {
    scoped: (identityId, fn) => {
      opened.push(identityId);
      return recordingDb({ rows: [] }).db.scoped(identityId, fn);
    },
    firm: (fn) => recordingDb({ rowAt: undefined }).db.firm(fn),
    ...NO_PRE_IDENTITY_DOORS,
  };
  useCatalogReads(databaseCatalogReads(watching));
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  // There is no path parameter and no query parameter naming an identity on
  // this route, and a caller inventing one reaches nothing that reads it.
  await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}?identity_id=${BOB}&identityId=${BOB}`,
    headers: withSession(ALICE),
  });
  expect(opened).toStrictEqual([ALICE]);

  await app.close();
});

// -----------------------------------------------------------------------------
// Kind 3: the handler does not re-widen what the door narrowed
// -----------------------------------------------------------------------------

/**
 * A pair of doors over a two-identity fixture.
 *
 * The scoped door applies ONE rule, `WHERE identity_id = $1`. The firm door
 * applies none, which is what `firm` means. It is not the recorder and it is not
 * a second accessor: the only thing it models is the tenancy filter, so that a
 * handler reaching a purchase through the wrong door is visible here.
 */
function filteringDb(rows: {
  readonly purchases: readonly (PurchaseRow & { readonly identity_id: string })[];
  readonly accounts: readonly (AccountLinkRow & { readonly identity_id: string })[];
}): ApiDb {
  const camel = (row: Record<string, unknown>): Record<string, unknown> => ({
    id: row['id'],
    planVersionId: row['plan_version_id'],
    createdAt: row['created_at'] === undefined ? undefined : new Date(row['created_at'] as string),
    kind: row['kind'],
    sizeCents: row['size_cents'],
    amountPaidCents: row['amount_paid_cents'],
    discountCents: row['discount_cents'],
    status: row['status'],
    purchaseId: row['purchase_id'],
  });
  const handle = (identityId: string | null): unknown => ({
    __brand: identityId === null ? 'FirmTx' : 'ScopedTx',
    rows: (key: string) => {
      const all = key === 'purchases' ? rows.purchases : rows.accounts;
      const mine = identityId === null ? all : all.filter((r) => r.identity_id === identityId);
      return Promise.resolve(mine.map((r) => camel(r as unknown as Record<string, unknown>)));
    },
    rowsWhere: () => Promise.resolve([]),
    rowAt: () => Promise.resolve(undefined),
  });
  return {
    scoped: <T>(identityId: string, fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(handle(identityId) as never),
    firm: <T>(fn: (tx: never) => Promise<T>): Promise<T> => fn(handle(null) as never),
    ...NO_PRE_IDENTITY_DOORS,
  };
}

const ALICE_PURCHASE = 'cccccccc-000a-4000-8000-00000000000a';
const BOB_PURCHASE = 'cccccccc-000b-4000-8000-00000000000b';

test('a purchases read scoped to A returns ZERO of Bs rows, end to end over the router', async () => {
  const db = filteringDb({
    purchases: [
      { ...purchase({ id: ALICE_PURCHASE }), identity_id: ALICE },
      { ...purchase({ id: BOB_PURCHASE, amount_paid_cents: 19_900n }), identity_id: BOB },
    ],
    accounts: [
      {
        id: 'eeeeeeee-000a-4000-8000-00000000000a',
        purchase_id: ALICE_PURCHASE,
        identity_id: ALICE,
      },
      { id: 'eeeeeeee-000b-4000-8000-00000000000b', purchase_id: BOB_PURCHASE, identity_id: BOB },
    ],
  });
  const reads = databaseCatalogReads(db);
  // The catalogue half is the fixture's, because `filteringDb` models tenancy
  // and not the plan tables.
  useCatalogReads({ firm: readsOf().firm, scoped: reads.scoped });
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const alice = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}`,
    headers: withSession(ALICE),
  });
  expect(alice.statusCode).toBe(200);
  expect((alice.json() as PurchaseListResponse).data.map((p) => p.purchase_id)).toStrictEqual([
    ALICE_PURCHASE,
  ]);
  // Not one field of Bob's row, including the account id the inversion resolves.
  expect(alice.body).not.toContain(BOB_PURCHASE);
  expect(alice.body).not.toContain('eeeeeeee-000b-4000-8000-00000000000b');
  expect(alice.body).not.toContain('19900');

  const bob = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}`,
    headers: withSession(BOB),
  });
  // The other direction too, because a read that refused everything would pass
  // the first half on its own.
  expect((bob.json() as PurchaseListResponse).data.map((p) => p.purchase_id)).toStrictEqual([
    BOB_PURCHASE,
  ]);
  expect(bob.body).not.toContain(ALICE_PURCHASE);

  await app.close();
});

test('a cursor naming Bs purchase does not reach it, because the read was scoped first', async () => {
  const db = filteringDb({
    purchases: [
      { ...purchase({ id: ALICE_PURCHASE }), identity_id: ALICE },
      {
        ...purchase({ id: BOB_PURCHASE, created_at: '2026-08-25T10:00:00.000Z' }),
        identity_id: BOB,
      },
    ],
    accounts: [],
  });
  useCatalogReads({ firm: readsOf().firm, scoped: databaseCatalogReads(db).scoped });
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  // The cursor is opaque rather than secret: decoding one buys nothing, because
  // it seeks into a set the accessor had already narrowed to the caller.
  const cursor = encodeCursor({
    created_at: '2026-08-26T10:00:00.000Z',
    purchase_id: BOB_PURCHASE,
  });
  const res = await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}?cursor=${cursor}`,
    headers: withSession(ALICE),
  });
  expect(res.statusCode).toBe(200);
  expect((res.json() as PurchaseListResponse).data.map((p) => p.purchase_id)).toStrictEqual([
    ALICE_PURCHASE,
  ]);
  expect(res.body).not.toContain(BOB_PURCHASE);

  await app.close();
});

test('the version ids handed across the crossing come off the SCOPED rows only', async () => {
  const asked: readonly string[][] = [];
  const seen: string[][] = asked as string[][];
  const db = filteringDb({
    purchases: [
      { ...purchase({ id: ALICE_PURCHASE }), identity_id: ALICE },
      { ...purchase({ id: BOB_PURCHASE, plan_version_id: RAPID_V1 }), identity_id: BOB },
    ],
    accounts: [],
  });
  useCatalogReads({
    firm: {
      ...readsOf().firm,
      plansOfVersions: (ids) => {
        seen.push([...ids]);
        return Promise.resolve([CORE_PIN]);
      },
    },
    scoped: databaseCatalogReads(db).scoped,
  });
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  await app.inject({
    method: 'GET',
    url: `${BASE_PATH}${PURCHASES_PATH}`,
    headers: withSession(ALICE),
  });
  // ADR-141: the scoped read runs FIRST and its rows key the firm read. Bob's
  // version is never asked about, because Bob's row was never read.
  expect(seen).toStrictEqual([[CORE_V2]]);

  await app.close();
});

// -----------------------------------------------------------------------------
// The unwired deployment
// -----------------------------------------------------------------------------

test('an unwired deployment says so on all three routes rather than answering 404', async () => {
  expect(currentCatalogReads()).toBeNull();
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  // A 404 would say the plan does not exist, which is a lie about a catalogue
  // nobody looked in. `server.ts`'s error handler renders the throw.
  for (const url of [`${BASE_PATH}${PLANS_PATH}`, `${BASE_PATH}/plans/${CORE_EOD}/versions/2`]) {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  }

  await app.close();
});

test('CatalogUnwired names the wiring slice rather than the request', () => {
  expect(() => {
    throw new CatalogUnwired('x');
  }).toThrow(CatalogUnwired);
  expect(new CatalogUnwired('x').name).toBe('CatalogUnwired');
});
