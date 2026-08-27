// =============================================================================
// apps/api/src/routes/economic-calendar.ts
// =============================================================================
// API_CONTRACT SECTION 6.1's `GET /economic-calendar`, THE DASHBOARD'S TIER-1
// ECONOMIC CALENDAR PANEL (M04 section 3.8, ADR-066 section 5.1, `DEP-M4-09`,
// `GS-285`).
//
// -----------------------------------------------------------------------------
// THE ONE THING THIS FILE EXISTS TO GET RIGHT: TWO DATE STRINGS, TWO VOCABULARIES
// -----------------------------------------------------------------------------
// API_CONTRACT section 1 states the rule in one line and states it for the whole
// contract:
//
//   "Time. `*_at` are RFC 3339 UTC strings. `*_day` and `*_on` are `YYYY-MM-DD`
//    EXCHANGE TRADING DAYS, never UTC dates."
//
// This response carries one of each, side by side, on the same object:
// `scheduled_release_at` is the stored UTC instant and `release_trading_day` is
// the exchange CT trading day the release falls in. `0039_economic_calendar.sql`
// header item 5 is why the second is a COLUMN rather than a derivation, and it
// gives the example: "a release at 23:30 UTC is not on the UTC calendar date the
// engine counts in". `trading_calendar`'s own table comment says the same thing
// from the other end: "The exchange session calendar (CT) is authoritative;
// storage is UTC", and `0032` adds the mechanism, "the next session opens at
// 17:00 CT regardless". A release at 23:30 UTC on a March evening is 17:30 CT,
// which is inside the session that opened at 17:00 CT, whose trading day is the
// NEXT date.
//
// SO THE TWO AGREE ON MOST ROWS AND DISAGREE ON EVENING ONES, which is the worst
// available failure shape: a route that derived the day from the instant would
// be right all afternoon and wrong at 23:30, and the wrongness would show up as
// a panel that quietly disagrees with `D-04`'s window on some days and not
// others. `0039` header item 1 is the property that makes that unacceptable
// rather than merely untidy: the panel and the detector read ONE view so that a
// revised release time moves both or neither. A route that recomputed either
// field would be a second answer to "when was the news", which is exactly what
// `FM-M7-08` guards and what `INV-M4-16` refuses an embed for, reached from
// inside the building instead of from a third party.
//
// THIS FILE THEREFORE DERIVES NEITHER FIELD FROM THE OTHER AND CHECKS BOTH
// SHAPES. `assertInstant` refuses anything that is not an RFC 3339 UTC instant
// and `assertDay` refuses anything that is not a `YYYY-MM-DD` day, so the
// contract's suffix rule stops being a naming convention a reviewer has to hold
// in their head and becomes a refusal with a message. ADR-146 is the ruling.
//
// -----------------------------------------------------------------------------
// THE CALENDAR IS NOT COMPUTED HERE, AND THAT INCLUDES THE FRESHNESS DECISION
// -----------------------------------------------------------------------------
// `CLAUDE.md`: "trading day follows the exchange session calendar (CT),
// maintained as data". `CRON_INVENTORY`'s staleness row states the query and
// states which day it is against: "the newest `economic_calendar_loads.
// coverage_end_day` still runs ahead of today by the CONFIGURED HORIZON". Both
// halves of that comparison are things this file does not hold. `coverage_end_day`
// is in `trading_calendar.trading_day`'s date domain (`0032`: "the exchange's CT
// trading day, never a UTC calendar date derived from a timestamp"), so "today"
// on the other side of it is a TRADING day, and a route that reached for a clock
// would have produced a UTC date and compared two different vocabularies. The
// horizon is configured and lives with the alarm.
//
// SO `freshness` ARRIVES AS DATA, decided where the calendar and the horizon
// both are, and this route renders it. API_CONTRACT's "`stale` is the server's
// own answer against its own threshold; the portal reads it and evaluates
// nothing" is satisfied by the SERVER answering, which is the deployment and not
// this file. What this file does with it is the one thing a renderer can do
// wrong: it refuses `stale: false` beside `covered_through_day: null`, because
// that pair is `DEP-M4-09`'s sentence exactly -- "the dangerous failure is not
// the empty panel, it is the confident one".
//
// -----------------------------------------------------------------------------
// THE ORDER IS THE QUERY'S AND THIS FILE DOES NOT SORT
// -----------------------------------------------------------------------------
// `economic_calendar_release_idx` is `0039`'s "the panel's read: upcoming
// releases by instant", so the ordering has an index and a home. Sorting here
// would mean comparing RFC 3339 strings, and lexicographic order is chronological
// order only when every string is written to the same precision, which section 1
// does not fix: `...:00Z` sorts AFTER `...:00.000Z` while naming the same
// instant. `calendar.ts` relies on the lexicographic trick and can, because a
// zero-padded ISO DAY has one spelling. An instant does not, so the trick is not
// reused and the rows are rendered in the order the source supplied them.
//
// -----------------------------------------------------------------------------
// `tier` IS RENDERED AND NOT FILTERED
// -----------------------------------------------------------------------------
// API_CONTRACT types it `number` with the comment "1 to 3. A column, not an
// import filter (0039 header item 3)". A route that dropped everything but tier
// 1 would make the field a constant, which is the narrow import `0039` rejected
// wearing a route's clothes. `economic_calendar_tier1_day_idx` is a PARTIAL
// index, so which tiers a deployment renders is the query's decision; the range
// is checked here because `economic_calendar_tier_is_ranked` is `BETWEEN 1 AND 3`
// and a fourth value is a source that is not reading the table.
//
// -----------------------------------------------------------------------------
// AUTHENTICATED, THOUGH NOTHING IN THE RESPONSE IS PER-TRADER
// -----------------------------------------------------------------------------
// API_CONTRACT: "Auth: session. Nothing in the response is per-trader and a
// public row would work; it is authenticated anyway, because widening later is a
// decision and narrowing later is a break (ADR-111 clause 3)." The handler below
// therefore takes the session and READS NOTHING OUT OF IT, and that is the
// shape rather than an oversight: `economic_calendar` is classified `firm` in
// `packages/db/src/scope.ts` ("a fact about the world rather than about
// anybody"), so there is no identity filter for a session to supply. The
// declaration is what the endpoint requires; the row is nobody's either way.
// =============================================================================

import { defineRoutes } from '../registry.ts';
import { requiredFactorTable, toRoutes, withSessionContext } from './auth.ts';
import type { EndpointSpec } from './auth.ts';

/** API_CONTRACT section 6.1's path, without the base path. */
export const ECONOMIC_CALENDAR_PATH = '/economic-calendar';

/**
 * `YYYY-MM-DD`, and nothing else.
 *
 * The month and day ranges are checked because `2026-19-40` matches a looser
 * pattern and is not a date. WHAT IS DELIBERATELY NOT CHECKED IS WHETHER THE DAY
 * IS A SESSION: that is `trading_calendar`'s question, `lookupCalendarDay` is
 * where it is asked, and asking it here would be this route computing the
 * calendar. A day that is not a session is data this route renders and the
 * loader should not have written; a string that is not a day at all is a
 * vocabulary error, which is the one this file is placed to catch.
 */
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * An RFC 3339 UTC instant, spelled with `Z`.
 *
 * `+00:00` NAMES THE SAME INSTANT AND IS REFUSED ANYWAY. Section 1 says `*_at`
 * are "RFC 3339 UTC strings" and a surface that admitted two spellings of one
 * instant would hand every consumer a normalisation step, which is a second
 * place for the timezone question to be answered. An offset that is not zero at
 * all is the failure this refusal is really for: it would be a stored zone
 * arriving through the API rather than through the column `0039` header item 4
 * refused to create.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * One `economic_calendar_current` row, as the source hands it over.
 *
 * Transcribed column for column from `0039_economic_calendar.sql` in the
 * database's own snake_case, on `routes/public-methods.ts`' stated reason: a
 * paraphrase of the shape is the first step toward a paraphrase of the meaning.
 * `id`, `load_id` and `created_at` are the view's provenance columns and are the
 * three that do not reach the response.
 */
export interface EconomicCalendarRow {
  readonly event_key: string;
  readonly occurrence_key: string;
  /** `smallint`, `BETWEEN 1 AND 3`. */
  readonly tier: number;
  /** THE ONE STORED UTC INSTANT. RFC 3339, `Z`. */
  readonly scheduled_release_at: string;
  /** THE EXCHANGE CT TRADING DAY. Stored by the loader, never derived here. */
  readonly release_trading_day: string;
  /** `0` is the original publication. `> 0` means the time moved. */
  readonly revision: number;
  /** Required on a revision, refused on an original. `0039`'s equivalence. */
  readonly revision_reason: string | null;
}

/**
 * The coverage fact, which is what makes the panel safe to render at all.
 *
 * `covered_through_day` is the last day any `economic_calendar_loads` row covers
 * and is `null` when nothing has ever been loaded. `stale` is the answer the
 * deployment already computed against the configured horizon; see this file's
 * header for why it is not computed here.
 */
export interface EconomicCalendarFreshness {
  readonly stale: boolean;
  readonly covered_through_day: string | null;
}

/** What one read of the panel's data returns. */
export interface EconomicCalendarPanel {
  readonly freshness: EconomicCalendarFreshness;
  readonly occurrences: readonly EconomicCalendarRow[];
}

/**
 * Where the panel's rows come from.
 *
 * ONE METHOD AND NO ARGUMENTS. The contract's path carries no query parameters,
 * so which window is rendered is the query's decision and not a caller's, and an
 * argument here would be a filter the contract does not admit.
 *
 * IT READS `economic_calendar_current` AND NEVER `economic_calendar`. `0039`:
 * the view is "the only definition of that anywhere", and both readers go
 * through it so that a revised release time moves the panel and `D-04` together
 * because there is no "both" to move separately (`GS-286`).
 */
export interface EconomicCalendarSource {
  readPanel(): Promise<EconomicCalendarPanel>;
}

/**
 * Thrown when the panel cannot be rendered from what the source returned.
 *
 * EVERY CASE IS A DEFECT RATHER THAN A REQUEST THE CALLER GOT WRONG, so every
 * one becomes a 500 through `server.ts`'s error handler rather than a 4xx this
 * file invents. The endpoint takes no input at all, so a caller cannot cause any
 * of them.
 */
export class EconomicCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EconomicCalendarError';
  }
}

/**
 * The source, held at module scope because a route module contributes DATA.
 *
 * ADR-100 rule 1 makes a module's whole contribution the object it default
 * exports, and `compose` hands a handler nothing but the request, so a module
 * cannot be given a dependency at composition time without being RUN at
 * composition time. The dependency therefore lives beside the module and the
 * handler reads it at REQUEST time rather than closing over it, so wiring order
 * cannot silently capture the unset value. `routes/public-methods.ts` is the
 * same shape for the same reason.
 */
let source: EconomicCalendarSource | null = null;

/**
 * Wire the source, or pass `null` to unwire it.
 *
 * The unwire direction exists for the suite: a test that sets a source and
 * cannot clear it leaves the next test reading a fixture it did not write.
 */
export function setEconomicCalendarSource(next: EconomicCalendarSource | null): void {
  source = next;
}

/** What is wired, or `null`. */
export function economicCalendarSource(): EconomicCalendarSource | null {
  return source;
}

/** One occurrence, as the response carries it. API_CONTRACT's seven fields. */
export interface EconomicCalendarOccurrence {
  readonly event_key: string;
  readonly occurrence_key: string;
  readonly tier: number;
  readonly scheduled_release_at: string;
  readonly release_trading_day: string;
  readonly revision: number;
  readonly revision_reason: string | null;
}

/** `GET /economic-calendar`'s body. */
export interface EconomicCalendarResponse {
  readonly freshness: EconomicCalendarFreshness;
  readonly occurrences: readonly EconomicCalendarOccurrence[];
}

/** Refuse a `*_day` that is not a day. See {@link DAY}. */
function assertDay(value: string, field: string): string {
  if (!DAY.test(value))
    throw new EconomicCalendarError(
      `\`${field}\` is \`${value}\`, which is not a \`YYYY-MM-DD\` day. API_CONTRACT section 1: ` +
        '`*_day` fields are exchange trading days, NEVER UTC dates, so a value that is not a ' +
        'bare day is a value that came from somewhere other than the column',
    );
  return value;
}

/** Refuse an `*_at` that is not an RFC 3339 UTC instant. See {@link INSTANT}. */
function assertInstant(value: string, field: string): string {
  if (!INSTANT.test(value))
    throw new EconomicCalendarError(
      `\`${field}\` is \`${value}\`, which is not an RFC 3339 UTC instant. API_CONTRACT ` +
        'section 1 requires `Z`, and `0039` header item 4 refused a timezone column so that one ' +
        'row renders in two trader timezones (`GS-285`); an offset here would be that column ' +
        'arriving through the response instead',
    );
  return value;
}

/**
 * Render the response from what the source returned, refusing rather than
 * guessing.
 *
 * Exported so the suite can assert on the refusals directly. Every check below
 * is a shape `0039` already forbids with a CHECK constraint or a unique index.
 * They are checked anyway because the source is an INTERFACE rather than the
 * database, and because the failure that reaches a reader is not "the query was
 * wrong": it is a trader shown the wrong minute for a release they are about to
 * trade into, or an empty panel they read as a quiet week.
 */
export function renderEconomicCalendar(panel: EconomicCalendarPanel): EconomicCalendarResponse {
  const { freshness } = panel;

  // `DEP-M4-09`: "the dangerous failure is not the empty panel, it is the
  // confident one." A deployment that has never loaded the calendar has no
  // ground to call it fresh, and this pair is exactly that claim.
  if (!freshness.stale && freshness.covered_through_day === null)
    throw new EconomicCalendarError(
      'the freshness fact claims the calendar is not stale while no `economic_calendar_loads` ' +
        'row covers anything. `DEP-M4-09`: the dangerous failure is not the empty panel, it is ' +
        'the confident one, and a panel that renders this pair tells a trader nothing is ' +
        'scheduled on the authority of a calendar that was never loaded',
    );

  const coveredThroughDay =
    freshness.covered_through_day === null
      ? null
      : assertDay(freshness.covered_through_day, 'freshness.covered_through_day');

  // The view is `DISTINCT ON (event_key, occurrence_key)`, so it answers with at
  // most one row per occurrence BY CONSTRUCTION. A second row is therefore not a
  // second revision, it is a second answer to "when is this release", which is
  // the failure the view exists to make impossible.
  const seen = new Set<string>();
  const occurrences: EconomicCalendarOccurrence[] = [];

  for (const row of panel.occurrences) {
    const address = `${row.event_key} ${row.occurrence_key}`;
    if (seen.has(address))
      throw new EconomicCalendarError(
        `\`${row.event_key}\` occurrence \`${row.occurrence_key}\` arrived twice. ` +
          '`economic_calendar_current` is `DISTINCT ON (event_key, occurrence_key)`, so two rows ' +
          'for one occurrence are two release times for one release and the panel can render ' +
          'neither',
      );
    seen.add(address);

    if (!Number.isInteger(row.tier) || row.tier < 1 || row.tier > 3)
      throw new EconomicCalendarError(
        `\`${row.event_key}\` occurrence \`${row.occurrence_key}\` carries tier ` +
          `\`${String(row.tier)}\`. \`economic_calendar_tier_is_ranked\` is \`BETWEEN 1 AND 3\`, ` +
          'so a fourth rank is a source that is not reading this table',
      );

    if (!Number.isInteger(row.revision) || row.revision < 0)
      throw new EconomicCalendarError(
        `\`${row.event_key}\` occurrence \`${row.occurrence_key}\` carries revision ` +
          `\`${String(row.revision)}\`. \`economic_calendar_revision_is_ordinal\` is ` +
          '`revision >= 0`, and a revision is an ordinal rather than a flag',
      );

    // `economic_calendar_revision_states_its_reason` is an EQUIVALENCE and is
    // checked as one: an original may not claim a reason it did not have, and a
    // revision may not omit one. A revision with no reason records that the
    // calendar moved and not that anybody decided it should.
    if ((row.revision === 0) !== (row.revision_reason === null))
      throw new EconomicCalendarError(
        `\`${row.event_key}\` occurrence \`${row.occurrence_key}\` is at revision ` +
          `${String(row.revision)} and ` +
          (row.revision_reason === null ? 'states no reason' : 'states a reason') +
          '. `economic_calendar_revision_states_its_reason` closes both directions: an original ' +
          'has no reason and a revision has one',
      );

    occurrences.push({
      event_key: row.event_key,
      occurrence_key: row.occurrence_key,
      tier: row.tier,
      // THE INSTANT AND THE DAY, EACH CHECKED AGAINST ITS OWN VOCABULARY AND
      // NEITHER DERIVED FROM THE OTHER. This is the whole file. ADR-146.
      scheduled_release_at: assertInstant(row.scheduled_release_at, 'scheduled_release_at'),
      release_trading_day: assertDay(row.release_trading_day, 'release_trading_day'),
      revision: row.revision,
      revision_reason: row.revision_reason,
    });
  }

  return {
    freshness: { stale: freshness.stale, covered_through_day: coveredThroughDay },
    occurrences,
  };
}

/**
 * API_CONTRACT section 6.1, one row.
 *
 * `required: 'session'` is the contract's own word and the handler uses nothing
 * from the session it is handed; see this file's header. The declaration is what
 * `requiredFactorTable` publishes and what a later gate reads, so it is the
 * statement rather than the usage.
 */
export const ECONOMIC_CALENDAR_ENDPOINTS: readonly EndpointSpec[] = [
  {
    method: 'GET',
    path: ECONOMIC_CALENDAR_PATH,
    required: 'session',
    handle: withSessionContext(async () => {
      const wired = source;
      if (wired === null)
        throw new EconomicCalendarError(
          'no economic calendar source is wired, so `GET /economic-calendar` cannot read the ' +
            'panel it renders. This is a deployment that has not been finished rather than a ' +
            'request that failed: the process that builds this server is what supplies one',
        );
      return renderEconomicCalendar(await wired.readPanel());
    }),
  },
];

/** The declaration as data, on `auth.ts`'s shape. */
export const ECONOMIC_CALENDAR_REQUIRED_FACTORS = requiredFactorTable(ECONOMIC_CALENDAR_ENDPOINTS);

export default defineRoutes({
  name: 'economic-calendar',
  routes: toRoutes(ECONOMIC_CALENDAR_ENDPOINTS),
});
