// =============================================================================
// apps/site/test/adapter.test.ts
// =============================================================================
// M9 SECTION 8.3, EXECUTED: "Every value rendered on a public page is asserted
// equal to the same value fetched from the API in the same test run. Not a
// snapshot of an expected number: a comparison against the source."
//
// SO THERE IS A REAL SERVER HERE AND NOT A STUBBED `fetch`. ADR-096 section 8
// states the reason in the sentence that decided the ruling: if the page were
// rendered from the same place the expectation comes from, the assertion
// "compares a row with the same row through two spellings of one query. It
// would pass on a wrong page." The two sides have to come from different
// places, so the page goes adapter -> decode -> renderer, the expectation goes
// `fetch` -> the raw JSON, and the only thing they share is the listener on
// `127.0.0.1`.
//
// THE SERVED ROWS ARE DELIBERATELY NOT THE FAMILIAR ONES. Three winning days
// and a $25,000 size are the figures every other suite in this package uses, so
// a page that had stopped reading config would still look right against them.
// The rows below say FOUR winning days at a $310,000 size, and INV-M9-08's
// "never the digit 3" is asserted against the number the server sent.
// =============================================================================

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, expect, test } from 'vitest';

import {
  SiteAdapterError,
  UnservedEndpointError,
  createSitePorts,
} from '../src/catalog/adapter.ts';
import type { BuiltAt } from '../src/catalog/types.ts';
import type { SitePorts } from '../src/catalog/ports.ts';
import { money } from '../src/render/cents.ts';
import type { SimulatedEnvironmentDisclosure } from '../src/render/disclosure.ts';
import { DisclosureError } from '../src/render/disclosure.ts';
import { contentPage } from '../src/routes/legal.ts';
import { plansPage } from '../src/routes/plans.ts';
import { assertRuleTextIsPublished, rulesPage } from '../src/routes/rules.ts';
import { statsPage } from '../src/routes/stats.ts';

// -----------------------------------------------------------------------------
// The rows this API serves
// -----------------------------------------------------------------------------
// Written as the JSON the endpoints return, because that is what the adapter
// reads. Every expectation below is fetched back OVER HTTP rather than read off
// these constants, so editing a figure here moves both sides and the assertion
// still proves something.

const PLAN_ID = '00000000-0000-4000-8000-0000000000b1';
const PLAN_VERSION_ID = '00000000-0000-4000-8000-0000000000c4';

const SIZE_LABELLED = {
  size_cents: 31_000_000,
  price_cents: 79_900,
  reset_price_cents: 49_900,
  drawdown_cents: 1_240_000,
  profit_target_cents: 1_860_000,
  buffer_cents: 248_000,
  win_day_floor_cents: 186_000,
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: 1_860_000 }],
  daily_loss_limit_cents: null,
  floor_lock_enabled: false,
  floor_lock_at_profit_cents: null,
  floor_lock_floor_at_cents: null,
  marketed_size_label: 'The 310 Desk',
};

/** GS-310's one absent case, and its label is `null` rather than missing. */
const SIZE_UNLABELLED = {
  ...SIZE_LABELLED,
  size_cents: 7_500_000,
  price_cents: 21_900,
  drawdown_cents: 300_000,
  profit_target_cents: 450_000,
  buffer_cents: 60_000,
  win_day_floor_cents: 45_000,
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: 450_000 }],
  marketed_size_label: null,
};

const RULES = {
  schema_version: 1,
  phase_eval: {
    enabled: true,
    profit_target_bp: 600,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 400,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 1,
    consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
    max_days: null,
  },
  phase_funded: {
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 400,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 0,
    // FOUR, and not the three every other fixture in this package carries.
    win_days: { required_count: 4, floor_bp: 60, reset_on_payout: true },
    consistency: { enabled: true, max_day_share_bp: 4000, mode: 'payout_gated' },
    buffer_bp: 80,
    cadence_gap_trading_days: 1,
    min_settlement_lag_trading_days: 0,
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 600 }],
    min_payout_cents: 50_000,
    split_bp: 9000,
    max_payouts: 5,
    post_payout_floor_rule: { mode: 'retained' },
  },
};

const COPY_BLOCKS = {
  'phase_funded.win_days':
    'You earn a payout cycle by closing four winning days at or above the win-day floor.',
  'phase_funded.drawdown': 'Your floor trails your closing balance at the end of every session.',
};

const PLANS_BODY = {
  data: [
    {
      plan_id: PLAN_ID,
      code: 'merit_rapid',
      name: 'Merit Rapid',
      current_version: { plan_version_id: PLAN_VERSION_ID, version: 4 },
      sizes: [SIZE_LABELLED, SIZE_UNLABELLED],
    },
  ],
};

const VERSION_BODY = {
  plan_version_id: PLAN_VERSION_ID,
  plan_id: PLAN_ID,
  version: 4,
  status: 'published',
  published_at: '2026-08-19T00:00:00.000Z',
  retired_at: null,
  // SD-M9-01 and DEP-M9-01. Not in API_CONTRACT's shape, and the adapter
  // refuses the response without them rather than deriving either.
  // DELIBERATELY NOT DERIVABLE FROM THE CODE AND THE VERSION. SD-M9-01 stores
  // the slug precisely so it survives renumbering, so a fixture spelled
  // `merit-rapid-v4` would let an adapter that DERIVED the slug pass the
  // equality below. This one cannot be derived from anything in the response.
  public_slug: 'rapid-desk-310',
  public_visible: true,
  superseded_by: null,
  rules: RULES,
  copy_blocks: COPY_BLOCKS,
  sizes: [SIZE_LABELLED, SIZE_UNLABELLED],
};

const DISCLOSURE_DOC = {
  id: '00000000-0000-4000-8000-0000000000d1',
  kind: 'legal',
  slug: 'simulated-environment',
  locale: 'en',
  title: 'Simulated environment',
  body_mdx: 'All Merit accounts trade in a simulated environment. Counsel wrote this sentence.',
  version: 7,
  published_at: '2026-08-01T00:00:00.000Z',
  superseded_by: null,
  author: 'counsel',
  checksum: 'a1b2c3',
};

const STATS_BODY = {
  computed_at: '2026-08-25T06:00:00.000Z',
  statistics: [
    {
      stat_code: 'ST-01',
      definition_version: 2,
      window_start_day: '2026-05-27',
      window_end_day: '2026-08-24',
      as_of_trading_day: '2026-08-24',
      measure: 'rate',
      value: 1183,
      value_unit: 'bp',
      numerator: 91,
      numerator_unit: 'count',
      denominator: 769,
      sample_size: 769,
      grain_key: null,
      suppressed_reason: null,
      restatement_of: null,
      method_path: '/methods/ST-01/2',
    },
    {
      stat_code: 'ST-04',
      definition_version: 1,
      window_start_day: '2026-05-27',
      window_end_day: '2026-08-24',
      as_of_trading_day: '2026-08-24',
      measure: 'median',
      value: null,
      value_unit: null,
      numerator: null,
      numerator_unit: null,
      denominator: null,
      sample_size: 4,
      grain_key: 'merit_rapid',
      // INV-M12-05. A suppressed row EXISTS and is not a gap in the series.
      suppressed_reason: 'sample below the publication floor',
      restatement_of: null,
      method_path: '/methods/ST-04/1',
    },
  ],
};

const BASE_PATH = '/api/v1';
const BUILT_AT = '2026-08-25T00:00:00.000Z' as BuiltAt;

// -----------------------------------------------------------------------------
// The server
// -----------------------------------------------------------------------------

/** Bodies this run serves, keyed by path and swappable per test. */
let routes: Map<string, unknown>;
/** Paths that answer 500, so the transport failure is a served fact. */
let broken: Set<string>;

let server: Server;
let origin: string;
let ports: SitePorts;

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '';
    if (broken.has(path)) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":"upstream"}');
      return;
    }
    if (!routes.has(path)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"not_found"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(routes.get(path)));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  ports = createSitePorts({ apiBaseUrl: `${origin}${BASE_PATH}` });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

/** Every test starts from the same served catalog and mutates its own copy. */
function serveTheCatalog(): void {
  routes = new Map<string, unknown>([
    [`${BASE_PATH}/plans`, PLANS_BODY],
    [`${BASE_PATH}/plans/${PLAN_ID}/versions/4`, VERSION_BODY],
    [`${BASE_PATH}/public/stats`, STATS_BODY],
    [`${BASE_PATH}/public/content/legal/simulated-environment?locale=en`, DISCLOSURE_DOC],
    [`${BASE_PATH}/public/content/legal/simulated-environment?locale=en&version=7`, DISCLOSURE_DOC],
  ]);
  broken = new Set<string>();
}

/**
 * The OTHER side of every parity assertion: the same endpoint, read raw.
 *
 * It shares no code with the adapter. That is the whole point of it existing.
 */
async function fetchedFromTheApi(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}${BASE_PATH}${path}`);
  expect(response.ok, `GET ${path}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/** A reader for one nested key, so an assertion reads like the JSON does. */
function dig(source: Record<string, unknown>, path: readonly (string | number)[]): unknown {
  let cursor: unknown = source;
  for (const step of path) {
    expect(cursor, `${String(step)} in ${JSON.stringify(path)}`).not.toBeUndefined();
    cursor =
      typeof step === 'number'
        ? (cursor as readonly unknown[])[step]
        : (cursor as Record<string, unknown>)[step];
  }
  return cursor;
}

/** The disclosure INV-M9-05 requires, built from a document read over HTTP. */
async function disclosureFromContent(): Promise<SimulatedEnvironmentDisclosure> {
  const document = await ports.content.readLive('legal', 'simulated-environment', 'en');
  expect(document, 'the simulated-environment document').not.toBeNull();
  if (document === null) throw new Error('unreachable');
  return {
    form: 'short',
    body: document.body_mdx,
    document_version: document.version,
    document_slug: document.slug,
  };
}

// -----------------------------------------------------------------------------
// The pages, against the rows the API served
// -----------------------------------------------------------------------------

test('the pricing page renders the figures GET /plans and the version read returned', async () => {
  serveTheCatalog();
  const catalog = await ports.catalog.readCatalog(BUILT_AT);
  const page = plansPage(catalog, await disclosureFromContent());

  const shelf = await fetchedFromTheApi('/plans');
  const version = await fetchedFromTheApi(`/plans/${PLAN_ID}/versions/4`);

  const card = page.plans[0];
  expect(card, 'one sellable plan').toBeDefined();
  if (card === undefined) throw new Error('unreachable');

  // The two identity fields are string equality with the API's own strings.
  expect(card.plan_name).toBe(dig(shelf, ['data', 0, 'name']));
  expect(card.plan_code).toBe(dig(shelf, ['data', 0, 'code']));
  expect(card.version).toBe(dig(version, ['version']));

  // INV-M9-08. The cadence names the count the API sent, and the digit 3 -- the
  // number every other fixture in this package carries -- appears nowhere.
  const required = dig(version, ['rules', 'phase_funded', 'win_days', 'required_count']);
  expect(card.cadence_copy).toContain(`${String(required)} winning days`);
  expect(card.cadence_copy).not.toContain('3 winning days');

  const labelled = card.sizes[0];
  expect(labelled, 'the labelled size').toBeDefined();
  if (labelled === undefined) throw new Error('unreachable');

  // GS-309. The label is Merit's words and every figure is money() over the
  // cents the API sent, reached through a different path on each side.
  expect(labelled.label).toBe(dig(version, ['sizes', 0, 'marketed_size_label']));
  expect(labelled.label_is_marketed).toBe(true);
  expect(labelled.figures.size).toBe(
    money(BigInt(Number(dig(version, ['sizes', 0, 'size_cents'])))),
  );
  expect(labelled.figures.price).toBe(
    money(BigInt(Number(dig(version, ['sizes', 0, 'price_cents'])))),
  );
  expect(labelled.figures.reset_price).toBe(
    money(BigInt(Number(dig(version, ['sizes', 0, 'reset_price_cents'])))),
  );
  expect(labelled.figures.drawdown).toBe(
    money(BigInt(Number(dig(version, ['sizes', 0, 'drawdown_cents'])))),
  );
  expect(labelled.figures.win_day_floor).toBe(
    money(BigInt(Number(dig(version, ['sizes', 0, 'win_day_floor_cents'])))),
  );
  expect(labelled.figures.payout_caps[0]?.cap).toBe(
    money(BigInt(Number(dig(version, ['sizes', 0, 'payout_cap_schedule_cents', 0, 'cap_cents'])))),
  );
  // Carried through rather than defaulted: `$0.00` is a limit of zero and that
  // is a different, reachable thing.
  expect(labelled.figures.daily_loss_limit).toBeNull();

  // GS-310. The absent label renders the capital figure, from the same helper.
  const unlabelled = card.sizes[1];
  expect(unlabelled, 'the unlabelled size').toBeDefined();
  if (unlabelled === undefined) throw new Error('unreachable');
  expect(unlabelled.label_is_marketed).toBe(false);
  expect(unlabelled.label).toBe(money(BigInt(Number(dig(version, ['sizes', 1, 'size_cents'])))));

  // INV-M9-03 and INV-M9-05, on the page the build actually produced.
  expect(page.envelope.built_at).toBe(BUILT_AT);
  expect(page.envelope.disclosure.body).toBe(
    dig(await fetchedFromTheApi('/public/content/legal/simulated-environment?locale=en'), [
      'body_mdx',
    ]),
  );
});

test('the rules page states the version`s own copy_blocks, fetched in the same run', async () => {
  serveTheCatalog();
  const catalog = await ports.catalog.readCatalog(BUILT_AT);
  const version = catalog.versions[0];
  expect(version, 'one version').toBeDefined();
  if (version === undefined) throw new Error('unreachable');
  const size = version.sizes[0];
  if (size === undefined) throw new Error('unreachable');

  const page = rulesPage(
    { version, size, disclosure: await disclosureFromContent() },
    catalog.built_at,
  );
  const served = await fetchedFromTheApi(`/plans/${PLAN_ID}/versions/4`);

  // INV-M9-02, asserted against the API's own object rather than a literal.
  const blocks = dig(served, ['copy_blocks']) as Record<string, string>;
  expect(page.blocks.map((block) => block.rule_path)).toEqual(Object.keys(blocks).sort());
  for (const block of page.blocks) {
    expect(block.body).toBe(blocks[block.rule_path]);
  }
  expect(() => assertRuleTextIsPublished(page, version)).not.toThrow();

  // INV-M9-03. The stamp is the slug and the version the API sent, and the slug
  // is NOT `merit-rapid-v` plus the number: it is the string SD-M9-01 stores.
  expect(page.envelope.renders_version?.public_slug).toBe(dig(served, ['public_slug']));
  expect(page.envelope.renders_version?.version).toBe(dig(served, ['version']));
  expect(page.envelope.renders_version?.superseded).toBe(false);
  expect(page.size_label).toBe(dig(served, ['sizes', 0, 'marketed_size_label']));
  expect(page.size_choices).toHaveLength(2);
});

test('the stats page renders M12`s published aggregate and never computes one', async () => {
  serveTheCatalog();
  const publication = await ports.stats.readPublishedStats();
  const page = statsPage(publication, await disclosureFromContent(), BUILT_AT);
  const served = await fetchedFromTheApi('/public/stats');

  expect(publication.computed_at).toBe(dig(served, ['computed_at']));

  const first = page.statistics[0];
  expect(first, 'the first statistic').toBeDefined();
  if (first === undefined) throw new Error('unreachable');
  expect(first.stat_code).toBe(dig(served, ['statistics', 0, 'stat_code']));
  // The window is attached to the value, which is what INV-M9-06 and AS-M9-03
  // both turn on, and both ends come off the served row.
  expect(first.window).toContain(String(dig(served, ['statistics', 0, 'window_start_day'])));
  expect(first.window).toContain(String(dig(served, ['statistics', 0, 'window_end_day'])));
  expect(first.as_of_trading_day).toBe(dig(served, ['statistics', 0, 'as_of_trading_day']));
  expect(first.sample_size).toBe(dig(served, ['statistics', 0, 'sample_size']));
  expect(first.method_path).toBe(dig(served, ['statistics', 0, 'method_path']));

  // INV-M12-05. The suppressed row is present and states its reason.
  const second = page.statistics[1];
  expect(second, 'the suppressed statistic').toBeDefined();
  expect(second?.value).toBeNull();
  expect(second?.not_meaningful).toBe(dig(served, ['statistics', 1, 'suppressed_reason']));
  expect(second?.sample_size).toBe(dig(served, ['statistics', 1, 'sample_size']));
});

test('a legal document renders at its permanent address, from the row the API served', async () => {
  serveTheCatalog();
  const document = await ports.content.readVersion('legal', 'simulated-environment', 'en', 7);
  expect(document, 'version 7').not.toBeNull();
  if (document === null) throw new Error('unreachable');

  const served = await fetchedFromTheApi(
    '/public/content/legal/simulated-environment?locale=en&version=7',
  );
  const page = contentPage({
    document,
    disclosure: await disclosureFromContent(),
    built_at: BUILT_AT,
  });

  expect(page.title).toBe(dig(served, ['title']));
  expect(page.body_mdx).toBe(dig(served, ['body_mdx']));
  expect(page.checksum).toBe(dig(served, ['checksum']));
  expect(page.version).toBe(dig(served, ['version']));
  expect(page.supersession_notice).toBeNull();
});

test('a content read answers null when the document is absent, and throws when the server does', async () => {
  serveTheCatalog();
  expect(await ports.content.readLive('legal', 'no-such-document', 'en')).toBeNull();

  broken.add(`${BASE_PATH}/public/content/legal/simulated-environment?locale=en`);
  await expect(ports.content.readLive('legal', 'simulated-environment', 'en')).rejects.toThrow(
    SiteAdapterError,
  );
});

// -----------------------------------------------------------------------------
// INV-M9-05 refuses, and this suite lets it
// -----------------------------------------------------------------------------

test('a page with no disclosure fails the build rather than rendering', async () => {
  serveTheCatalog();
  const catalog = await ports.catalog.readCatalog(BUILT_AT);
  expect(() => plansPage(catalog, null)).toThrow(DisclosureError);
});

// -----------------------------------------------------------------------------
// What the adapter refuses
// -----------------------------------------------------------------------------

test('a version response without SD-M9-01`s columns stops the build and names them', async () => {
  serveTheCatalog();
  const { public_slug: _slug, ...withoutSlug } = VERSION_BODY;
  routes.set(`${BASE_PATH}/plans/${PLAN_ID}/versions/4`, withoutSlug);

  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/public_slug/);
  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/SD-M9-01/);
});

test('a size without DEP-M9-07`s label is refused rather than rendered as absent', async () => {
  serveTheCatalog();
  const { marketed_size_label: _label, ...sizeWithoutLabel } = SIZE_LABELLED;
  routes.set(`${BASE_PATH}/plans/${PLAN_ID}/versions/4`, {
    ...VERSION_BODY,
    sizes: [sizeWithoutLabel],
  });

  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/marketed_size_label/);
  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/DEP-M9-07/);
});

test('a fractional price never reaches a page', async () => {
  serveTheCatalog();
  routes.set(`${BASE_PATH}/plans/${PLAN_ID}/versions/4`, {
    ...VERSION_BODY,
    sizes: [{ ...SIZE_LABELLED, price_cents: 79_900.5 }],
  });

  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/price_cents/);
});

test('a drawdown type outside the published vocabulary is refused', async () => {
  serveTheCatalog();
  routes.set(`${BASE_PATH}/plans/${PLAN_ID}/versions/4`, {
    ...VERSION_BODY,
    rules: {
      ...RULES,
      phase_funded: {
        ...RULES.phase_funded,
        drawdown: { ...RULES.phase_funded.drawdown, type: 'trailing_intraday_v2' },
      },
    },
  });

  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/trailing_eod/);
});

test('a statistic that publishes neither a value nor a suppression reason is refused', async () => {
  serveTheCatalog();
  const [first] = STATS_BODY.statistics;
  routes.set(`${BASE_PATH}/public/stats`, {
    ...STATS_BODY,
    statistics: [{ ...first, value: null, value_unit: null, suppressed_reason: null }],
  });

  await expect(ports.stats.readPublishedStats()).rejects.toThrow(/INV-M12-05/);
});

test('an API that answers 500 fails the build instead of rendering an empty catalog', async () => {
  serveTheCatalog();
  broken.add(`${BASE_PATH}/plans`);
  await expect(ports.catalog.readCatalog(BUILT_AT)).rejects.toThrow(/500/);
});

// -----------------------------------------------------------------------------
// What has no endpoint, reported rather than invented
// -----------------------------------------------------------------------------

test('the adapter reaches the SHELF and never the archive, and says so in the rows', async () => {
  serveTheCatalog();
  const catalog = await ports.catalog.readCatalog(BUILT_AT);

  // DEP-M9-01 asks this port for superseded versions too and no endpoint
  // anywhere lists the versions of a plan (ADR-096 section 7 measures the
  // neighbouring absence). Every version the adapter can reach is therefore a
  // current one, and this asserts that rather than leaving a partial archive
  // to look like a whole one.
  expect(catalog.versions.length).toBeGreaterThan(0);
  for (const version of catalog.versions) {
    expect(version.superseded_by, `${version.public_slug} is the shelf`).toBeNull();
    expect(version.public_visible).toBe(true);
  }
});

test('the two reads no document addresses refuse rather than guessing a URL', async () => {
  serveTheCatalog();
  await expect(ports.content.listAll('legal', 'en')).rejects.toThrow(UnservedEndpointError);
  await expect(ports.geo.readRestrictedCountries()).rejects.toThrow(UnservedEndpointError);
  await expect(ports.geo.readRestrictedCountries()).rejects.toThrow(/ADR-096/);
});

test('the default geo port answers that the edge could not say, and fails open', async () => {
  expect(await ports.geo.lookupCountry()).toBeNull();
});

// -----------------------------------------------------------------------------
// The configuration
// -----------------------------------------------------------------------------

test('a base URL that is not an absolute origin plus base path is refused', () => {
  expect(() => createSitePorts({ apiBaseUrl: '' })).toThrow(SiteAdapterError);
  expect(() => createSitePorts({ apiBaseUrl: '/api/v1' })).toThrow(/absolute/);
  expect(() => createSitePorts({ apiBaseUrl: 'https://api.example/api/v1/' })).toThrow(/slash/);
});

test('an injected geo port is used instead of the refusing default', async () => {
  const injected = createSitePorts({
    apiBaseUrl: `${origin}${BASE_PATH}`,
    geo: {
      lookupCountry: () => Promise.resolve('CA'),
      readRestrictedCountries: () => Promise.resolve(['CU', 'IR']),
    },
  });

  expect(await injected.geo.lookupCountry()).toBe('CA');
  expect(await injected.geo.readRestrictedCountries()).toEqual(['CU', 'IR']);
});
