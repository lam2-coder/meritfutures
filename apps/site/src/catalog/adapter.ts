// =============================================================================
// apps/site/src/catalog/adapter.ts
// =============================================================================
// THE ADAPTER BEHIND `SitePorts`, AND IT IS AN HTTP CLIENT BECAUSE ADR-096 SAYS
// SO IN THE WORDS OF ITS OWN TITLE.
//
// [ADR-096](docs/decisions/ADR-096.md) ruling 1: "`apps/site` reads over HTTP,
// against the public API, and holds no database connection of any kind. The
// adapter `P4-e` writes implements the four ports in `ports.ts` as HTTP calls.
// It opens no pool, holds no credential, and imports nothing from
// `packages/db`."
//
// [P4](docs/plans/P4-portal-and-site.md) section 8's `P4-e` row, written before
// that ruling existed, says the four ports "resolve against `systemDb`". THE
// TWO DO NOT DISAGREE AND THE ORDER IS WHY: P4 section 10 item 6 named the
// question OPEN, offered three readings, took none, and said "`P4-e` cannot
// start without an answer". ADR-096 is that answer, it is `accepted` and
// signed, and its section 2 shows readings 1 and 2 do not reach a single table
// this site needs -- `systemDb(...).rows()` is generic over `TableKey` and none
// of M9's eight tables is one. So the row states an expectation of an
// unanswered question and the entry answers it. Nothing here splits the
// difference: there is no `packages/db` import in this file, and the manifest
// half is asserted by `test/manifest.test.ts`.
//
// -----------------------------------------------------------------------------
// THE BASE URL IS SUPPLIED AND THE BASE PATH IS NEVER SPELLED HERE
// -----------------------------------------------------------------------------
// `apps/api/src/surface.ts` declares `BASE_PATH = '/api/v1'` and its own
// `assertContractPath` says why it is one string in one place: "a path that
// carries its own copy is a second one". `RI-04` forbids a deployable
// depending on a deployable, so this app cannot import that constant, and
// writing `/api/v1` here would be exactly the second copy that file refuses.
// So `apiBaseUrl` is CONFIGURATION: the deployment supplies origin plus base
// path, and every path below is a contract path as API_CONTRACT writes it.
//
// -----------------------------------------------------------------------------
// NOTHING IS INVENTED, AND WHAT IS MISSING FAILS LOUDLY
// -----------------------------------------------------------------------------
// Three of the five endpoints M9 consumes are in no contract, one port's read
// is in no document at all, and two fields the site cannot render without are
// in neither response shape. ADR-096 section 7 measured the first two and this
// file does not repair either. What it does instead, at every one of those
// seams, is REFUSE:
//
//   * A response missing a field throws `SiteAdapterError` naming the field,
//     the endpoint and the dependency that owes it. It never substitutes a
//     default. `public_slug` in particular is NEVER derived from the version
//     number: `types.ts` says "Never derived from `version`" and SD-M9-01's
//     whole reason is that the archive URL must survive renumbering.
//   * A read no document gives an address to throws `UnservedEndpointError`
//     rather than guessing a URL. `readRestrictedCountries` is ADR-096 section
//     7's port with "exactly one site in the whole tree, its own declaration",
//     and `listAll` needs a collection address the `:slug` path template cannot
//     express.
//
// A build that stops with "the catalog response carries no `public_slug`" is a
// build somebody fixes. A build that renders `merit-rapid-v1` because this file
// derived it is a permanent URL invented by an adapter.
//
// -----------------------------------------------------------------------------
// THE ARCHIVE HALF OF `CatalogReadPort` HAS NO ENDPOINT AND IS NOT FAKED
// -----------------------------------------------------------------------------
// `ports.ts` says the catalog port "RETURNS SUPERSEDED VERSIONS TOO ... the
// build needs the archive and not only the shelf" (DEP-M9-01), and INV-M9-11
// requires every version to keep a page forever. `GET /plans` returns the
// currently sellable versions and there is no list-the-versions-of-a-plan row
// in API_CONTRACT or in M9's own endpoint table:
//
//   $ grep -rn 'versions' docs/architecture/API_CONTRACT.md   ->  no collection read
//
// So what this adapter reaches is the SHELF, every entry of it carrying
// `superseded_by: null` by construction, and `test/adapter.test.ts` asserts
// that as a property rather than leaving a partial archive to look like a whole
// one. The endpoint that would close it is an API_CONTRACT amendment, which
// ADR-096 section 10 puts outside a session that is not amending the contract.
//
// -----------------------------------------------------------------------------
// MONEY ON THE WIRE
// -----------------------------------------------------------------------------
// `apps/portal/src/api/types.ts` records the disagreement this file inherits:
// INV-02 makes money `bigint` at every boundary, API_CONTRACT declares the same
// quantities `number` because JSON has one number type, and both documents are
// approved. The portal routes around it by never computing; this file has to
// CONSTRUCT the `Cents` the renderers take, so it decodes rather than casts.
// `bigintCents` accepts an integer `number` or a string of digits and refuses
// everything else, including a float: a fractional cent arriving from the wire
// is a value somebody computed, and rendering it would put a rounded price on
// the pricing page. The string form is accepted because ADR-031 rules the
// public statistic surface `bigint` with a unit, and JSON cannot carry one
// above 2^53 any other way.
// =============================================================================

import type {
  Cents,
  PlanRulesJson,
  PlanVersionId,
  PlanVersionSizeRow,
  PublishedCapScheduleStep,
  PublishedConsistency,
  PublishedDailyLossLimit,
  PublishedDrawdown,
  PublishedDrawdownType,
  PublishedEvalPhase,
  PublishedFloorLock,
  PublishedFundedPhase,
  PublishedWinDays,
} from '@merit/rules-engine';

import { decodeCapScheduleCents } from '@merit/rules-engine';

import type { ContentDocument, ContentKind } from '../content/documents.ts';
import type { PublishedStatistic, StatisticMeasure, StatisticUnit } from '../stats/published.ts';
import type { StatsPublication } from '../stats/published.ts';
import type {
  CatalogReadPort,
  ContentReadPort,
  GeoLookupPort,
  SitePorts,
  StatsReadPort,
} from './ports.ts';
import type {
  BuiltAt,
  CopyBlocks,
  SiteCatalog,
  SitePlanVersionView,
  SiteSizeView,
  SupersededBy,
} from './types.ts';
import { marketedSizeLabel } from './types.ts';

// -----------------------------------------------------------------------------
// The transport
// -----------------------------------------------------------------------------

/** What this adapter needs a response to be. Structurally satisfied by `fetch`. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * The one I/O capability this file uses, as an argument.
 *
 * Typed structurally rather than as `typeof fetch` so that a test supplies a
 * server and not a mock of the global: `test/adapter.test.ts` runs a real
 * `node:http` listener, because M9 section 8.3's coverage rule is only a
 * control when the two sides come from different places, and a stubbed fetch
 * puts the expected bytes back in the test file.
 */
export type FetchLike = (url: string) => Promise<HttpResponse>;

/** What a deployment supplies to build the site's ports. */
export interface SiteAdapterConfig {
  /**
   * Origin plus base path, no trailing slash: `https://api.example/api/v1`.
   *
   * The base path is the API's own string and is never written in this package
   * (see the header). A trailing slash is REFUSED rather than trimmed, because
   * trimming makes two configurations that render the same pages differ in the
   * bytes they request, and FM-M9-08's post-deploy digest is about bytes.
   */
  readonly apiBaseUrl: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /**
   * The edge's geo lookup. ADR-096 section 7: `lookupCountry()` "is an edge
   * lookup and reads no Merit table at all", so it is not this adapter's to
   * implement and is injected by whatever runs at the edge. Absent, the
   * default reports that the edge could not say, which is FM-M9-04's
   * fail-open-on-the-notice shape and never a control.
   */
  readonly geo?: GeoLookupPort;
}

// -----------------------------------------------------------------------------
// The failures
// -----------------------------------------------------------------------------

/** Thrown when a response cannot be read as the shape the site's types declare. */
export class SiteAdapterError extends Error {
  override readonly name: string = 'SiteAdapterError';
}

/**
 * Thrown by a port method whose address exists in no approved document.
 *
 * It is a distinct class because it is a distinct fact: the response was not
 * wrong and the network did not fail. Nothing serves this read, and ADR-096
 * section 7 says so by name for `readRestrictedCountries`. A caller that
 * catches `SiteAdapterError` broadly would otherwise treat "no endpoint exists"
 * as a transient read failure and retry it forever.
 */
export class UnservedEndpointError extends SiteAdapterError {
  override readonly name: string = 'UnservedEndpointError';
}

// -----------------------------------------------------------------------------
// The contract paths, as API_CONTRACT and M9 section 4 write them
// -----------------------------------------------------------------------------

/** `GET /plans`. API_CONTRACT section 4, `Auth: none`, cacheable 60s. */
export const PLANS_PATH = '/plans';

/** `GET /public/stats`. M9 section 4, and in NO contract (ADR-096 section 7). */
export const PUBLIC_STATS_PATH = '/public/stats';

/** `GET /plans/:planId/versions/:version`. API_CONTRACT section 4. */
export function planVersionEndpoint(planId: string, version: number): string {
  return `/plans/${encodeURIComponent(planId)}/versions/${encodeURIComponent(String(version))}`;
}

/** `GET /public/content/:kind/:slug`. M9 section 4, and in NO contract. */
export function contentEndpoint(kind: ContentKind, slug: string): string {
  return `/public/content/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}`;
}

/**
 * THE ONE WIRE DETAIL THIS FILE CHOOSES, AND IT IS NAMED SO IT CAN BE REPLACED.
 *
 * M9 section 4 rows `GET /public/content/:kind/:slug` and calls it "versioned
 * content retrieval for build and for permanent archive URLs". The path
 * template carries neither the locale nor the version, and no document anywhere
 * states how they travel:
 *
 *   $ grep -rn 'public/content' docs/           ->  M09 section 4, and ADR-096
 *
 * Both are therefore query parameters, declared here as two constants rather
 * than spelled at three call sites, so the contract amendment that settles it
 * is a two-line diff instead of a search. This is the only place in this file
 * where an address is not read off a document.
 */
export const CONTENT_LOCALE_PARAM = 'locale';
/** See {@link CONTENT_LOCALE_PARAM}. */
export const CONTENT_VERSION_PARAM = 'version';

// -----------------------------------------------------------------------------
// The adapter
// -----------------------------------------------------------------------------

/**
 * The four ports, resolved over HTTP against the public API.
 *
 * Assembled once and passed down, which is `SitePorts`' own instruction:
 * "Everything a build reads. Assembled once, passed down, never widened."
 */
export function createSitePorts(config: SiteAdapterConfig): SitePorts {
  const base = assertBaseUrl(config.apiBaseUrl);
  const get = reader(base, config.fetch ?? defaultFetch());

  return {
    catalog: catalogPort(get),
    stats: statsPort(get),
    content: contentPort(get),
    geo: config.geo ?? unservedGeo(),
  };
}

/** `https://api.example/api/v1`, and never with a trailing slash. */
function assertBaseUrl(raw: string): string {
  if (raw.trim() === '' || !/^https?:\/\//.test(raw)) {
    throw new SiteAdapterError(
      `apiBaseUrl is \`${raw}\`, which is not an absolute http(s) URL. It carries the API's ` +
        'origin and its base path, and this package deliberately holds no copy of either ' +
        '(apps/api/src/surface.ts owns BASE_PATH).',
    );
  }
  if (raw.endsWith('/')) {
    throw new SiteAdapterError(
      `apiBaseUrl is \`${raw}\`, which ends in a slash. It is refused rather than trimmed: ` +
        'two configurations that differ only in a slash would request different bytes for the ' +
        'same page, and FM-M9-08 asserts a build digest after deploy.',
    );
  }
  return raw;
}

/** The global `fetch`, resolved once so a missing one is reported here. */
function defaultFetch(): FetchLike {
  const global = globalThis.fetch as FetchLike | undefined;
  if (global === undefined) {
    throw new SiteAdapterError(
      'no `fetch` was supplied and this runtime has no global one. The site reads over HTTP ' +
        'and has no second transport to fall back to (ADR-096 ruling 1).',
    );
  }
  return global;
}

/** What every read below is: a contract path in, parsed JSON out. */
type Reader = (path: string, options?: { readonly absentIsNull?: boolean }) => Promise<unknown>;

function reader(base: string, fetchLike: FetchLike): Reader {
  return async (path, options) => {
    const url = `${base}${path}`;
    let response: HttpResponse;
    try {
      response = await fetchLike(url);
    } catch (cause) {
      throw new SiteAdapterError(
        `GET ${path} did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (response.status === 404 && options?.absentIsNull === true) return null;
    if (!response.ok) {
      throw new SiteAdapterError(
        `GET ${path} answered ${response.status}. A public page is built from what the API ` +
          'returns and there is nothing else to render it from.',
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new SiteAdapterError(
        `GET ${path} answered ${response.status} with a body that is not JSON: ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
}

// -----------------------------------------------------------------------------
// CatalogReadPort
// -----------------------------------------------------------------------------

function catalogPort(get: Reader): CatalogReadPort {
  return {
    async readCatalog(built_at: BuiltAt): Promise<SiteCatalog> {
      const shelf = decodePlans(await get(PLANS_PATH));

      // SEQUENTIAL, and the reason is the error rather than the latency: a
      // parallel read reports whichever plan failed first, and "the catalog
      // could not be read" is a message that costs somebody a bisect.
      const versions: SitePlanVersionView[] = [];
      for (const plan of shelf) {
        const path = planVersionEndpoint(plan.plan_id, plan.version);
        versions.push(decodeVersion(plan, await get(path), path));
      }

      return { versions, built_at };
    },
  };
}

/** One row of `GET /plans`, reduced to what the version read needs. */
interface ShelfEntry {
  readonly plan_id: string;
  readonly plan_code: string;
  readonly plan_name: string;
  readonly version: number;
}

/**
 * `PlansResponse`, API_CONTRACT section 4.
 *
 * The SIZES on this response are deliberately not read. The same rows come back
 * on the version read with the fields this site needs and that shape does not
 * carry (`payout_cap_schedule_cents` among them), and reading the same size
 * from two responses is how a pricing page and a rules page come to state one
 * figure two ways.
 */
function decodePlans(body: unknown): readonly ShelfEntry[] {
  const where = `GET ${PLANS_PATH}`;
  const root = record(body, where);
  const data = list(field(root, 'data', where), `${where}.data`);

  return data.map((entry, index) => {
    const at = `${where}.data[${index}]`;
    const plan = record(entry, at);
    const current = record(field(plan, 'current_version', at), `${at}.current_version`);
    return {
      plan_id: text(field(plan, 'plan_id', at), `${at}.plan_id`),
      plan_code: text(field(plan, 'code', at), `${at}.code`),
      plan_name: text(field(plan, 'name', at), `${at}.name`),
      version: integer(
        field(current, 'version', `${at}.current_version`),
        `${at}.current_version.version`,
      ),
    };
  });
}

/**
 * `PlanVersionResponse`, API_CONTRACT section 4, plus the fields M9 depends on
 * and the contract does not carry.
 *
 * THREE FIELDS ARE REQUIRED HERE AND ARE IN NEITHER RESPONSE SHAPE IN THE
 * CONTRACT, and each is refused rather than defaulted. `public_slug` and
 * `public_visible` are SD-M9-01's columns and INV-M9-11 is unbuildable without
 * the first; `superseded_by` carries the successor's slug because "a page that
 * has to query to say what replaced it is a page that renders without saying so
 * when the query fails" (`types.ts`). The contract amendment DEP-M9-07 implies
 * is owed and M9 section 4 says so in the same breath as stating the
 * requirement; until it lands the build stops here with the field's name.
 */
function decodeVersion(plan: ShelfEntry, body: unknown, where: string): SitePlanVersionView {
  const root = record(body, where);
  const sizes = list(field(root, 'sizes', where), `${where}.sizes`);
  const planVersionId = text(field(root, 'plan_version_id', where), `${where}.plan_version_id`);

  return {
    plan_id: plan.plan_id,
    plan_code: plan.plan_code,
    plan_name: plan.plan_name,
    version: integer(field(root, 'version', where), `${where}.version`),
    public_slug: text(
      owed(root, 'public_slug', where, 'SD-M9-01 and DEP-M9-01'),
      `${where}.public_slug`,
    ),
    public_visible: flag(
      owed(root, 'public_visible', where, 'SD-M9-01 and DEP-M9-01'),
      `${where}.public_visible`,
    ),
    published_at: nullable(field(root, 'published_at', where), `${where}.published_at`, text),
    superseded_by: decodeSupersededBy(
      owed(root, 'superseded_by', where, 'INV-M9-11 and DEP-M9-01'),
      `${where}.superseded_by`,
    ),
    rules: decodeRules(field(root, 'rules', where), `${where}.rules`),
    copy_blocks: decodeCopyBlocks(field(root, 'copy_blocks', where), `${where}.copy_blocks`),
    sizes: sizes.map((size, index) => decodeSize(size, planVersionId, `${where}.sizes[${index}]`)),
  };
}

function decodeSupersededBy(value: unknown, where: string): SupersededBy | null {
  return nullable(value, where, (raw) => {
    const source = record(raw, where);
    return {
      version: integer(field(source, 'version', where), `${where}.version`),
      public_slug: text(field(source, 'public_slug', where), `${where}.public_slug`),
    };
  });
}

/**
 * `plan_versions.copy_blocks`. INV-M9-02: every value is rule text a human
 * published with the version, so a non-string value is refused rather than
 * stringified. A number that reached a rules page as prose would be this
 * module writing a sentence, which is the one thing it may not do.
 */
function decodeCopyBlocks(value: unknown, where: string): CopyBlocks {
  const source = record(value, where);
  const blocks: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    blocks[key] = text(source[key], `${where}.${key}`);
  }
  return blocks;
}

/**
 * One size, as the site sees it: the engine's own row, the two commerce
 * columns, and the label outside `row`.
 *
 * THE LABEL IS THE ONE FIELD READ THROUGH ITS CONSTRUCTOR. `marketedSizeLabel`
 * carries SD-M9-04's CHECK, and a blank one arriving from the wire means a row
 * exists the database says cannot exist. It is `null` when the key is present
 * and null, and the key's ABSENCE is refused: DEP-M9-07 requires the endpoint
 * to carry it, and a missing key silently rendering the capital figure is
 * GS-310's default standing in for a contract that was never amended.
 */
function decodeSize(value: unknown, planVersionId: string, where: string): SiteSizeView {
  const source = record(value, where);
  const label = owed(source, 'marketed_size_label', where, 'SD-M9-04 and DEP-M9-07');

  return {
    row: decodeSizeRow(source, planVersionId, where),
    price_cents: bigintCents(field(source, 'price_cents', where), `${where}.price_cents`),
    reset_price_cents: bigintCents(
      field(source, 'reset_price_cents', where),
      `${where}.reset_price_cents`,
    ),
    marketed_size_label: nullable(label, `${where}.marketed_size_label`, (raw) =>
      marketedSizeLabel(text(raw, `${where}.marketed_size_label`)),
    ),
  };
}

/**
 * `PlanVersionSizeRow`, the engine's transcription of `plan_version_sizes`.
 *
 * The object literal is typed as the engine's own interface, so the day that
 * interface grows a column this decoder fails to compile rather than silently
 * dropping it. That is why the shape is decoded here instead of cast: a cast
 * over a wire object is a transcription nothing checks, which is the defect
 * this app's manifest spends a paragraph refusing.
 */
function decodeSizeRow(
  source: Readonly<Record<string, unknown>>,
  planVersionId: string,
  where: string,
): PlanVersionSizeRow {
  return {
    // The brand is asserted at the one boundary that can: the value arrives as
    // a string from a response that already identifies the version it belongs
    // to, and `PlanVersionId` exists so nothing downstream invents one.
    plan_version_id: planVersionId as PlanVersionId,
    size_cents: bigintCents(field(source, 'size_cents', where), `${where}.size_cents`),
    drawdown_cents: bigintCents(field(source, 'drawdown_cents', where), `${where}.drawdown_cents`),
    profit_target_cents: nullableCents(source, 'profit_target_cents', where),
    buffer_cents: bigintCents(field(source, 'buffer_cents', where), `${where}.buffer_cents`),
    win_day_floor_cents: bigintCents(
      field(source, 'win_day_floor_cents', where),
      `${where}.win_day_floor_cents`,
    ),
    // **ADR-302's COLLAPSE, AND THIS SIDE OF IT IS BEHAVIOUR-PRESERVING.**
    // `decodeCapSteps` stood here and stated, in this file's own helpers, exactly
    // what the engine's codec now states once for all three readers of the
    // column. What changes is the class of the refusal, which is
    // `CapScheduleCodecError` and no longer `SiteAdapterError`; `siteCatalog`
    // (`../app/build.ts`) catches every throw from a catalogue read and logs it,
    // and nothing in this app branches on the class.
    payout_cap_schedule_cents: decodeCapScheduleCents(
      field(source, 'payout_cap_schedule_cents', where),
      `${where}.payout_cap_schedule_cents`,
    ),
    daily_loss_limit_cents: nullableCents(source, 'daily_loss_limit_cents', where),
    floor_lock_enabled: flag(
      field(source, 'floor_lock_enabled', where),
      `${where}.floor_lock_enabled`,
    ),
    floor_lock_at_profit_cents: nullableCents(source, 'floor_lock_at_profit_cents', where),
    floor_lock_floor_at_cents: nullableCents(source, 'floor_lock_floor_at_cents', where),
  };
}

// -----------------------------------------------------------------------------
// `plan_versions.rules`, decoded key for key
// -----------------------------------------------------------------------------
// EVERY KEY OF `PlanRulesJson` IS READ HERE AND THE RETURN TYPE IS THE ENGINE'S,
// so this decoder is compile-checked against the shape the engine executes.
// M01 section 2.4's split is preserved without this file knowing about it: the
// jsonb carries STRUCTURE and ratios in basis points, the size row carries every
// cents value, and the two cents fields that do live in `rules` are decoded as
// cents because the engine's type says they are.

const DRAWDOWN_TYPES = [
  'trailing_eod',
  'static',
  'intraday_trailing',
] as const satisfies readonly PublishedDrawdownType[];

const CONSISTENCY_MODES = [
  'pass_time_dilutable',
  'payout_gated',
] as const satisfies readonly PublishedConsistency['mode'][];

function decodeRules(value: unknown, where: string): PlanRulesJson {
  const source = record(value, where);
  const schemaVersion = integer(field(source, 'schema_version', where), `${where}.schema_version`);
  if (schemaVersion !== 1) {
    throw new SiteAdapterError(
      `${where}.schema_version is ${schemaVersion} and this build reads 1. The engine's ` +
        '`PlanRulesJson` declares the literal, so a second schema is a version of the site ' +
        'and not a branch inside it.',
    );
  }

  return {
    schema_version: 1,
    phase_eval: decodeEvalPhase(field(source, 'phase_eval', where), `${where}.phase_eval`),
    phase_funded: decodeFundedPhase(field(source, 'phase_funded', where), `${where}.phase_funded`),
  };
}

function decodeEvalPhase(value: unknown, where: string): PublishedEvalPhase {
  const source = record(value, where);
  return {
    enabled: flag(field(source, 'enabled', where), `${where}.enabled`),
    profit_target_bp: integer(
      field(source, 'profit_target_bp', where),
      `${where}.profit_target_bp`,
    ),
    drawdown: decodeDrawdown(field(source, 'drawdown', where), `${where}.drawdown`),
    daily_loss_limit: decodeDailyLossLimit(
      field(source, 'daily_loss_limit', where),
      `${where}.daily_loss_limit`,
    ),
    min_trading_days: integer(
      field(source, 'min_trading_days', where),
      `${where}.min_trading_days`,
    ),
    consistency: decodeConsistency(field(source, 'consistency', where), `${where}.consistency`),
    max_days: nullable(field(source, 'max_days', where), `${where}.max_days`, integer),
  };
}

function decodeFundedPhase(value: unknown, where: string): PublishedFundedPhase {
  const source = record(value, where);
  return {
    drawdown: decodeDrawdown(field(source, 'drawdown', where), `${where}.drawdown`),
    daily_loss_limit: decodeDailyLossLimit(
      field(source, 'daily_loss_limit', where),
      `${where}.daily_loss_limit`,
    ),
    min_trading_days: integer(
      field(source, 'min_trading_days', where),
      `${where}.min_trading_days`,
    ),
    win_days: decodeWinDays(field(source, 'win_days', where), `${where}.win_days`),
    consistency: decodeConsistency(field(source, 'consistency', where), `${where}.consistency`),
    buffer_bp: integer(field(source, 'buffer_bp', where), `${where}.buffer_bp`),
    cadence_gap_trading_days: integer(
      field(source, 'cadence_gap_trading_days', where),
      `${where}.cadence_gap_trading_days`,
    ),
    min_settlement_lag_trading_days: integer(
      field(source, 'min_settlement_lag_trading_days', where),
      `${where}.min_settlement_lag_trading_days`,
    ),
    payout_cap_schedule: decodeCapScheduleBp(
      field(source, 'payout_cap_schedule', where),
      `${where}.payout_cap_schedule`,
    ),
    min_payout_cents: bigintCents(
      field(source, 'min_payout_cents', where),
      `${where}.min_payout_cents`,
    ),
    split_bp: integer(field(source, 'split_bp', where), `${where}.split_bp`),
    max_payouts: integer(field(source, 'max_payouts', where), `${where}.max_payouts`),
    post_payout_floor_rule: {
      mode: text(
        field(
          record(field(source, 'post_payout_floor_rule', where), `${where}.post_payout_floor_rule`),
          'mode',
          `${where}.post_payout_floor_rule`,
        ),
        `${where}.post_payout_floor_rule.mode`,
      ),
    },
  };
}

function decodeDrawdown(value: unknown, where: string): PublishedDrawdown {
  const source = record(value, where);
  return {
    type: member(field(source, 'type', where), DRAWDOWN_TYPES, `${where}.type`),
    amount_bp: integer(field(source, 'amount_bp', where), `${where}.amount_bp`),
    lock: decodeFloorLock(field(source, 'lock', where), `${where}.lock`),
  };
}

function decodeFloorLock(value: unknown, where: string): PublishedFloorLock {
  const source = record(value, where);
  return {
    enabled: flag(field(source, 'enabled', where), `${where}.enabled`),
    at_profit_cents: nullableCents(source, 'at_profit_cents', where),
    floor_at_cents: nullableCents(source, 'floor_at_cents', where),
  };
}

function decodeDailyLossLimit(value: unknown, where: string): PublishedDailyLossLimit {
  const source = record(value, where);
  return {
    type: text(field(source, 'type', where), `${where}.type`),
    amount_bp: nullable(field(source, 'amount_bp', where), `${where}.amount_bp`, integer),
  };
}

function decodeConsistency(value: unknown, where: string): PublishedConsistency {
  const source = record(value, where);
  return {
    enabled: flag(field(source, 'enabled', where), `${where}.enabled`),
    max_day_share_bp: nullable(
      field(source, 'max_day_share_bp', where),
      `${where}.max_day_share_bp`,
      integer,
    ),
    mode: member(field(source, 'mode', where), CONSISTENCY_MODES, `${where}.mode`),
  };
}

function decodeWinDays(value: unknown, where: string): PublishedWinDays {
  const source = record(value, where);
  return {
    required_count: integer(field(source, 'required_count', where), `${where}.required_count`),
    floor_bp: integer(field(source, 'floor_bp', where), `${where}.floor_bp`),
    reset_on_payout: flag(field(source, 'reset_on_payout', where), `${where}.reset_on_payout`),
  };
}

function decodeCapScheduleBp(value: unknown, where: string): readonly PublishedCapScheduleStep[] {
  return list(value, where).map((step, index) => {
    const at = `${where}[${index}]`;
    const source = record(step, at);
    return {
      from_ordinal: integer(field(source, 'from_ordinal', at), `${at}.from_ordinal`),
      cap_bp: integer(field(source, 'cap_bp', at), `${at}.cap_bp`),
    };
  });
}

// -----------------------------------------------------------------------------
// StatsReadPort
// -----------------------------------------------------------------------------

const STATISTIC_UNITS = [
  'count',
  'bp',
  'cents',
  'duration_seconds',
] as const satisfies readonly StatisticUnit[];

const STATISTIC_MEASURES = [
  'rate',
  'total',
  'mean',
  'median',
  'p50',
  'p95',
  'count',
] as const satisfies readonly StatisticMeasure[];

function statsPort(get: Reader): StatsReadPort {
  return {
    async readPublishedStats(): Promise<StatsPublication> {
      const where = `GET ${PUBLIC_STATS_PATH}`;
      const root = record(await get(PUBLIC_STATS_PATH), where);
      const rows = list(field(root, 'statistics', where), `${where}.statistics`);

      return {
        statistics: rows.map((row, index) => decodeStatistic(row, `${where}.statistics[${index}]`)),
        computed_at: text(field(root, 'computed_at', where), `${where}.computed_at`),
      };
    },
  };
}

/**
 * One `published_statistics` row.
 *
 * THE VALUE AND ITS UNIT ARE READ AS A PAIR AND NEITHER IS DEFAULTED.
 * `published_statistics_value_or_suppression`: "A row either publishes a value
 * with its components, or states why it did not. Never neither." A suppressed
 * row EXISTS, so a null value with a `suppressed_reason` is a legitimate answer
 * and is carried through; what is refused is a row with neither, which would
 * render as a blank and convert a stated limitation into a concealment.
 */
function decodeStatistic(value: unknown, where: string): PublishedStatistic {
  const source = record(value, where);
  const amount = nullable(field(source, 'value', where), `${where}.value`, bigintCents);
  const suppressed = nullable(
    field(source, 'suppressed_reason', where),
    `${where}.suppressed_reason`,
    text,
  );

  if (amount === null && suppressed === null) {
    throw new SiteAdapterError(
      `${where} publishes no value and states no suppression reason. INV-M12-05 and ` +
        '`published_statistics_value_or_suppression` make suppression VISIBLE, and a row ' +
        'that is neither would render as a blank.',
    );
  }

  return {
    stat_code: text(field(source, 'stat_code', where), `${where}.stat_code`),
    definition_version: integer(
      field(source, 'definition_version', where),
      `${where}.definition_version`,
    ),
    window_start_day: text(field(source, 'window_start_day', where), `${where}.window_start_day`),
    window_end_day: text(field(source, 'window_end_day', where), `${where}.window_end_day`),
    as_of_trading_day: text(
      field(source, 'as_of_trading_day', where),
      `${where}.as_of_trading_day`,
    ),
    measure: member(field(source, 'measure', where), STATISTIC_MEASURES, `${where}.measure`),
    value: amount,
    value_unit: nullable(field(source, 'value_unit', where), `${where}.value_unit`, (raw, at) =>
      member(raw, STATISTIC_UNITS, at),
    ),
    numerator: nullable(field(source, 'numerator', where), `${where}.numerator`, bigintCents),
    numerator_unit: nullable(
      field(source, 'numerator_unit', where),
      `${where}.numerator_unit`,
      (raw, at) => member(raw, STATISTIC_UNITS, at),
    ),
    denominator: nullable(field(source, 'denominator', where), `${where}.denominator`, bigintCents),
    sample_size: integer(field(source, 'sample_size', where), `${where}.sample_size`),
    grain_key: nullable(field(source, 'grain_key', where), `${where}.grain_key`, text),
    suppressed_reason: suppressed,
    restatement_of: nullable(
      field(source, 'restatement_of', where),
      `${where}.restatement_of`,
      text,
    ),
    method_path: text(field(source, 'method_path', where), `${where}.method_path`),
  };
}

// -----------------------------------------------------------------------------
// ContentReadPort
// -----------------------------------------------------------------------------

const CONTENT_KINDS = ['page', 'post', 'faq', 'legal'] as const satisfies readonly ContentKind[];

function contentPort(get: Reader): ContentReadPort {
  const read = async (path: string, where: string): Promise<ContentDocument | null> => {
    const body = await get(path, { absentIsNull: true });
    // A 404 is a legitimate answer to "does this document exist", and it is the
    // answer `readLive` and `readVersion` are typed to give: both return
    // `ContentDocument | null`. Section 9.2 makes a legal 404 a PAGE-level
    // alarm, which is the caller's decision and not this decoder's.
    return body === null ? null : decodeDocument(body, where);
  };

  return {
    readLive(kind, slug, locale) {
      const path = `${contentEndpoint(kind, slug)}?${CONTENT_LOCALE_PARAM}=${encodeURIComponent(locale)}`;
      return read(path, `GET ${path}`);
    },

    readVersion(kind, slug, locale, version) {
      const path =
        `${contentEndpoint(kind, slug)}?${CONTENT_LOCALE_PARAM}=${encodeURIComponent(locale)}` +
        `&${CONTENT_VERSION_PARAM}=${encodeURIComponent(String(version))}`;
      return read(path, `GET ${path}`);
    },

    /**
     * REFUSED, AND THE REFUSAL IS THE HONEST IMPLEMENTATION.
     *
     * `listAll` is a COLLECTION read and the only content address any document
     * states is `GET /public/content/:kind/:slug`, which requires the slug it
     * would be enumerating. Nothing in `docs/` addresses the collection, so a
     * URL written here would be one this adapter made up, and the archive it
     * fed to `legalIndex` and to M9-K-01 would be whatever that URL happened to
     * return. ADR-096 section 7 already reports three of the five endpoints as
     * carried by no contract; this is the fourth shape, one step further out.
     */
    listAll(kind, locale) {
      return Promise.reject(
        new UnservedEndpointError(
          `listAll(${kind}, ${locale}) has no endpoint. M9 section 4 rows ` +
            '`GET /public/content/:kind/:slug` and no document anywhere addresses the ' +
            'collection, so this adapter would have to invent the URL. Writing one is an ' +
            "API_CONTRACT amendment (ADR-096 section 10), not an adapter's to choose.",
        ),
      );
    },
  };
}

function decodeDocument(value: unknown, where: string): ContentDocument {
  const source = record(value, where);
  return {
    id: text(field(source, 'id', where), `${where}.id`),
    kind: member(field(source, 'kind', where), CONTENT_KINDS, `${where}.kind`),
    slug: text(field(source, 'slug', where), `${where}.slug`),
    locale: text(field(source, 'locale', where), `${where}.locale`),
    title: text(field(source, 'title', where), `${where}.title`),
    body_mdx: text(field(source, 'body_mdx', where), `${where}.body_mdx`),
    version: integer(field(source, 'version', where), `${where}.version`),
    published_at: nullable(field(source, 'published_at', where), `${where}.published_at`, text),
    superseded_by: nullable(field(source, 'superseded_by', where), `${where}.superseded_by`, text),
    author: text(field(source, 'author', where), `${where}.author`),
    // Hex, and displayed rather than compared. `documents.ts`: carrying a
    // buffer "would invite a comparison at the one layer that must not perform
    // one", so the decode is a string read and nothing else.
    checksum: text(field(source, 'checksum', where), `${where}.checksum`),
  };
}

// -----------------------------------------------------------------------------
// GeoLookupPort
// -----------------------------------------------------------------------------

/**
 * The geo port when the deployment supplies none.
 *
 * `lookupCountry` answers `null`, which the port declares as "the edge could
 * not say" and which FM-M9-04 makes the fail-open direction: the notice is
 * courtesy and the control is server side at M3 and M19, unaffected by
 * anything this port does or fails to do.
 *
 * `readRestrictedCountries` THROWS, and the asymmetry is the point. ADR-096
 * section 7 measured it: the port "maps to no row of M9's own endpoint table
 * and to no endpoint anywhere", with "exactly one site in the whole tree, its
 * own declaration". Returning an empty list would render a page stating that
 * no country is restricted, which is a disclosure this adapter invented; the
 * entry names this exact port as "the shape that produces reading 1 under a
 * deadline", and a refusal is what keeps it from being one.
 */
function unservedGeo(): GeoLookupPort {
  return {
    lookupCountry(): Promise<string | null> {
      return Promise.resolve(null);
    },
    readRestrictedCountries(): Promise<readonly string[]> {
      return Promise.reject(
        new UnservedEndpointError(
          'readRestrictedCountries() has no endpoint. ADR-096 section 7 measured it at one ' +
            'site in the whole tree, its own declaration, mapping to no row of M9 section 4 ' +
            'and to no endpoint anywhere. An empty list here would publish "no country is ' +
            'restricted", which is a disclosure nobody wrote.',
        ),
      );
    },
  };
}

// -----------------------------------------------------------------------------
// The decoders every read above is built from
// -----------------------------------------------------------------------------
// THEY REPORT WHERE, ALWAYS. A build that fails with "expected a string" costs
// whoever reads it the search this file can do for free, and `where` is threaded
// through every call for that one reason.

function record(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SiteAdapterError(`${where} is ${describe(value)}, and an object was required.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function list(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new SiteAdapterError(`${where} is ${describe(value)}, and an array was required.`);
  }
  return value;
}

/** The value at `key`, or a refusal naming it. ABSENT and `null` are different. */
function field(source: Readonly<Record<string, unknown>>, key: string, where: string): unknown {
  if (!(key in source)) {
    throw new SiteAdapterError(
      `${where} carries no \`${key}\`. Nothing is defaulted here: a public page renders what ` +
        'the API returned, and a field this build invented is a promise Merit did not publish.',
    );
  }
  return source[key];
}

/**
 * A field the site's own types require and API_CONTRACT does not declare.
 *
 * Identical to {@link field} except in what it says when it is missing, and the
 * difference is worth a function: "the response carries no `public_slug`" reads
 * as a broken server, and "the response carries no `public_slug`, which
 * SD-M9-01 and DEP-M9-01 owe" reads as the contract amendment it actually is.
 */
function owed(
  source: Readonly<Record<string, unknown>>,
  key: string,
  where: string,
  citation: string,
): unknown {
  if (!(key in source)) {
    throw new SiteAdapterError(
      `${where} carries no \`${key}\`, which ${citation} owe and API_CONTRACT does not yet ` +
        'declare. It is not derivable from anything else in the response and this adapter ' +
        'does not invent it.',
    );
  }
  return source[key];
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new SiteAdapterError(`${where} is ${describe(value)}, and a string was required.`);
  }
  return value;
}

function integer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SiteAdapterError(
      `${where} is ${describe(value)}, and a safe integer was required. A count or an ordinal ` +
        'that arrived fractional was computed somewhere it should have been read.',
    );
  }
  return value;
}

function flag(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') {
    throw new SiteAdapterError(`${where} is ${describe(value)}, and a boolean was required.`);
  }
  return value;
}

/**
 * Integer cents, from the one number type JSON has or from a string of digits.
 *
 * NO FLOAT IS ACCEPTED AT THIS BOUNDARY EVER. CLAUDE.md: money is integer cents
 * and no floats in financial paths. `Number.isSafeInteger` refuses both a
 * fractional cent and an integer past 2^53, and the string form is what a
 * publisher uses above that bound (ADR-031 rules the public statistic surface
 * `bigint` with a unit, and JSON carries no bigint).
 */
function bigintCents(value: unknown, where: string): Cents {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new SiteAdapterError(
        `${where} is ${describe(value)}, and integer cents were required. A fractional or ` +
          'unsafe cents value is a figure somebody computed; money is integer cents at every ' +
          'boundary (INV-02) and a rounded one on a price page is a price Merit will not honor.',
      );
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);

  throw new SiteAdapterError(
    `${where} is ${describe(value)}, and integer cents were required, as a safe-integer ` +
      'number or a string of digits.',
  );
}

/** A `Cents | null` column, where the key must be present and may be null. */
function nullableCents(
  source: Readonly<Record<string, unknown>>,
  key: string,
  where: string,
): Cents | null {
  return nullable(field(source, key, where), `${where}.${key}`, bigintCents);
}

function nullable<T>(
  value: unknown,
  where: string,
  decode: (value: unknown, where: string) => T,
): T | null {
  return value === null ? null : decode(value, where);
}

/** A closed vocabulary, checked against the members the site's own types declare. */
function member<T extends string>(value: unknown, members: readonly T[], where: string): T {
  const found = members.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new SiteAdapterError(
      `${where} is ${describe(value)}, which is not one of ${members.join(' | ')}. The set is ` +
        'closed in this repository, so a new member is a ruling and not a value.',
    );
  }
  return found;
}

/** What a refusal says the value WAS. Never the value itself: a body may be long. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'string') return `the string \`${value.slice(0, 60)}\``;
  if (typeof value === 'number' || typeof value === 'boolean') return `\`${String(value)}\``;
  return `a ${typeof value}`;
}
