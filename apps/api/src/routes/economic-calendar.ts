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
// THE DEPLOYMENT THAT ANSWERS IS `databaseEconomicCalendar` BELOW, AND ADR-240
// IS WHERE THE HORIZON STOPPED BEING A SENTENCE
// -----------------------------------------------------------------------------
// The paragraph above says the SERVER answers and not this file, and until
// ADR-240 no server did: the port had no implementation, so `stale` was a field
// nothing in this repository could produce and the horizon was a word in a
// runbook. The adapter at the foot of this file is that server, and it is
// separated from the HANDLER by exactly the line ADR-146 clause 4 draws.
//
// THE HANDLER STILL READS NO CLOCK AND STILL DERIVES NO DAY. What the adapter
// reads is `MERIT_ECONOMIC_CALENDAR_HORIZON_TRADING_DAYS`, which the deployment
// sets and this repository never values (ADR-012); an absent one is
// `unconfigured` and answers 503, on ADR-226's rule that an absent
// configuration REFUSES rather than switching a control off. There is no
// default, because a defaulted horizon is a freshness verdict nobody decided.
//
// AND IT COMPARES AN INSTANT WITH AN INSTANT, WHICH IS THE WHOLE OF WHY CLAUSE
// 4 SURVIVES IT. The adapter never converts a timestamp into a day. It counts
// the `trading_calendar` rows whose session has NOT YET OPENED at the moment of
// the read and whose `trading_day` is at or before `covered_through_day`, and
// compares that COUNT with the horizon. `session_open_at` is a `timestamptz`
// and so is the clock, `trading_day` is a day and so is `coverage_end_day`, and
// no value ever crosses from one vocabulary to the other. The failure clause 4
// forbids -- `new Date()` yielding a UTC calendar date and being compared with
// an exchange CT trading day -- has no site here to happen at.
//
// A HOLIDAY AND A WEEKEND NEED NO RULING UNDER THAT SHAPE, and that is the
// reason it was taken over the obvious one. "What is today's trading day" has
// no answer at 03:00 on a Saturday, and a route serving a dashboard is asked
// the question at 03:00 on a Saturday; a COUNT OF SESSIONS STILL AHEAD is
// defined at every instant. `0032` made a holiday's `session_open_at` NULL, and
// `NULL >= $1` is not true, so a holiday is excluded by the comparison rather
// than by a branch somebody has to remember to write.
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

import { atLeast, atMost } from '@merit/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiDb } from '../db.ts';
import { defineRoutes } from '../registry.ts';
import { PROBLEM_MEDIA_TYPE, problem } from '../server.ts';
import type { Environment } from '../surface.ts';
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
 * Raised when no source is wired. Answered 503, never a 500.
 *
 * IT USED TO BE AN `EconomicCalendarError` AND THEREFORE A 500, and ADR-240
 * separates the two because they are two different facts. Every other case of
 * that class is a row the source handed over that cannot be rendered, which is
 * a defect; this one is a deployment nobody finished, which is the sentence
 * `VerifySourceUnwired` and `CertificateBackendUnwired` both already carry on
 * their own ports. A 500 tells an operator to look for a bug and a 503 tells
 * them to look at the deployment, and only one of those is true here.
 */
export class EconomicCalendarUnwired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EconomicCalendarUnwired';
  }
}

/**
 * Raised when the source is wired and the DEPLOYMENT supplied no horizon.
 *
 * A SEPARATE CLASS FROM {@link EconomicCalendarUnwired} AND THE SAME STATUS
 * CODE, on `verify.ts`'s split between `VerifySourceUnwired` and
 * `VerifyPresentationError`: the caller is told the same thing either way and
 * an operator is told which half to go and fix. Both are a deploy that has not
 * been finished; one is missing a line in `start.ts` and the other is missing a
 * variable in a vault.
 *
 * THERE IS NO OUTCOME UNDER WHICH AN ABSENT HORIZON RENDERS A PANEL.
 * `freshness.stale` would have to be answered, and both answers are wrong: a
 * `false` is `DEP-M4-09`'s confident failure and a `true` is a permanent alarm
 * a deployment cannot switch off by configuring the thing it forgot. ADR-226:
 * an absent configuration refuses rather than switching the control off.
 */
export class EconomicCalendarUnconfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EconomicCalendarUnconfigured';
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
    const address = `${row.event_key}\0${row.occurrence_key}`;
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

// -----------------------------------------------------------------------------
// The adapter (ADR-240)
// -----------------------------------------------------------------------------

/**
 * The variable a deployment sets to supply the staleness horizon.
 *
 * NAMED HERE AND VALUED NOWHERE IN THIS REPOSITORY (ADR-012), exactly as
 * `MERIT_TURNSTILE_SECRET` (ADR-226) and `MERIT_POSTMARK_SERVER_TOKEN`
 * (ADR-229) are. It is not a credential, so INFRA section 7's vault scoping is
 * not what governs it; INFRA section 8 rows it beside the alarm that reads the
 * same column, which is where CRON_INVENTORY already puts the horizon.
 *
 * THE UNIT IS IN THE NAME AND THAT IS THE POINT RATHER THAN A STYLE. ADR-146
 * exists because two date vocabularies met on one object and nothing said which
 * was which. `..._HORIZON_DAYS` would have been the same defect in a variable
 * name: a deployment setting `10` would have no way to know whether it had
 * bought ten calendar days or ten sessions, and the two differ by every weekend
 * and every holiday in the window. The value is a number of TRADING DAYS.
 *
 * NO NUMBER IS WRITTEN HERE AND ADR-146 CLAUSE 7 IS WHY. That clause found no
 * horizon value anywhere in the corpus and refused to invent one in a route.
 * ADR-240 does not overturn it: the value is still not in this repository, and
 * what lands is the NAME the deployment sets it under.
 */
export const ECONOMIC_CALENDAR_HORIZON_VAR = 'MERIT_ECONOMIC_CALENDAR_HORIZON_TRADING_DAYS';

/**
 * What {@link resolveEconomicCalendarHorizon} answers.
 *
 * A RESULT RATHER THAN A THROW, on `resolveOtpSmsPriceCents`' shape: the caller
 * decides what a refusal becomes, and here it becomes
 * {@link EconomicCalendarUnconfigured} and a 503.
 */
export type EconomicCalendarHorizon =
  { readonly tradingDays: number } | { readonly refusal: string };

/**
 * The horizon a deployment configured, or the reason there is none.
 *
 * STRICT, AND EVERY REFUSAL BELOW IS A VALUE THAT WOULD HAVE MADE THE PANEL LIE
 * RATHER THAN FAIL.
 *
 *   - AN ABSENT VALUE IS A REFUSAL AND NEVER A DEFAULT. A defaulted horizon is
 *     a freshness verdict nobody decided, published to a trader as the server's
 *     own answer against its own threshold. ADR-226's rule, on a threshold
 *     instead of a secret.
 *   - A DECIMAL POINT IS REFUSED RATHER THAN ROUNDED. A session is a row and
 *     half a row is not a quantity this comparison has; `resolveOtpSmsPriceCents`
 *     refuses the same shape for the same reason one vocabulary over.
 *   - ZERO IS REFUSED, because a horizon of zero is satisfied by a calendar
 *     covering nothing ahead at all, which is a staleness check that can never
 *     fire -- the fail-open dressed as a configured control.
 *   - A NEGATIVE IS REFUSED, and it would be satisfied by every calendar there
 *     is, including one whose coverage ended last year.
 */
export function resolveEconomicCalendarHorizon(env: Environment): EconomicCalendarHorizon {
  const raw = env[ECONOMIC_CALENDAR_HORIZON_VAR];
  if (raw === undefined || raw.trim() === '')
    return {
      refusal:
        `no \`${ECONOMIC_CALENDAR_HORIZON_VAR}\` is set, so \`freshness.stale\` has no threshold ` +
        'to be decided against. There is deliberately no default: a horizon nobody chose is a ' +
        "freshness verdict published as the server's own answer against a threshold nobody " +
        'wrote down. ADR-240, and ADR-146 clause 7 is why no number lives in this file',
    };
  const value = raw.trim();
  // WHOLE DIGITS ONLY, CHECKED BEFORE THE NUMBER IS READ. `Number(' 7 ')` and
  // `Number('7.5')` both succeed and neither is a count of sessions, so the
  // SHAPE is refused first rather than after a coercion has hidden it.
  if (!/^\d+$/.test(value))
    return {
      refusal:
        `\`${ECONOMIC_CALENDAR_HORIZON_VAR}\` is not a whole number of trading days. The ` +
        'horizon counts SESSIONS, which are rows of `trading_calendar`, and a fraction of a ' +
        'session is not a quantity this comparison has',
    };
  const tradingDays = Number(value);
  if (!Number.isSafeInteger(tradingDays) || tradingDays <= 0)
    return {
      refusal:
        `\`${ECONOMIC_CALENDAR_HORIZON_VAR}\` must be a positive whole number of trading days. ` +
        'A horizon of zero is satisfied by a calendar that covers nothing ahead at all, which ' +
        'is a staleness check that can never fire',
    };
  return { tradingDays };
}

function asRow(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new EconomicCalendarError(`a \`${key}\` row is not an object`);
  return value as Record<string, unknown>;
}

function column(row: Record<string, unknown>, field: string, key: string): string {
  const value = row[field];
  if (typeof value !== 'string')
    throw new EconomicCalendarError(
      `\`${key}.${field}\` is not a string on the row the accessor returned`,
    );
  return value;
}

function count(row: Record<string, unknown>, field: string, key: string): number {
  const value = row[field];
  if (typeof value === 'number') return value;
  // `pg` HANDS `bigint` BACK AS A STRING and `smallint` and `integer` back as
  // numbers, so both spellings are read. `tier` and `revision` are `smallint`
  // and `integer`; nothing here is money, and `renderEconomicCalendar` is what
  // holds each to its own CHECK.
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  throw new EconomicCalendarError(`\`${key}.${field}\` is not an integer`);
}

/**
 * One `economic_calendar_current` row, off the accessor.
 *
 * `scheduled_release_at` IS A `Date` AND `release_trading_day` IS A STRING, and
 * that asymmetry is the two column types rather than an inconsistency: `pg`
 * hands a `timestamptz` back as a `Date` and drizzle's `date()` hands a `date`
 * back as the `YYYY-MM-DD` text the column holds. THE DAY IS NEVER BUILT FROM
 * THE INSTANT. `toISOString()` renders the instant and the day is copied
 * across, so the two fields of the response come from the two columns of the
 * row and neither is a function of the other (ADR-146 clause 1).
 */
function toEconomicCalendarRow(value: unknown): EconomicCalendarRow {
  const row = asRow(value, 'economicCalendarCurrent');
  const releaseAt = row['scheduledReleaseAt'];
  if (!(releaseAt instanceof Date) || Number.isNaN(releaseAt.getTime()))
    throw new EconomicCalendarError(
      '`economicCalendarCurrent.scheduledReleaseAt` is not a Date. The column is `timestamptz`, ' +
        "and a value that is not one cannot be rendered as section 1's RFC 3339 UTC string",
    );
  const reason = row['revisionReason'];
  if (reason !== null && reason !== undefined && typeof reason !== 'string')
    throw new EconomicCalendarError(
      '`economicCalendarCurrent.revisionReason` is neither text nor null',
    );
  return {
    event_key: column(row, 'eventKey', 'economicCalendarCurrent'),
    occurrence_key: column(row, 'occurrenceKey', 'economicCalendarCurrent'),
    tier: count(row, 'tier', 'economicCalendarCurrent'),
    scheduled_release_at: releaseAt.toISOString(),
    release_trading_day: column(row, 'releaseTradingDay', 'economicCalendarCurrent'),
    revision: count(row, 'revision', 'economicCalendarCurrent'),
    revision_reason: reason === undefined ? null : reason,
  };
}

/**
 * The newest day any load covers, or `null` when nothing has ever been loaded.
 *
 * THE MAXIMUM IS LEXICOGRAPHIC AND THAT IS SOUND HERE WHERE IT WOULD NOT BE ON
 * AN INSTANT. ADR-146 finding 8: a zero-padded ISO DAY has one spelling, so
 * string order is chronological order with no arithmetic; an RFC 3339 instant
 * has more than one and that is why `renderEconomicCalendar` refuses to sort.
 * `coverage_end_day` is a `date`, so it is the first case and not the second.
 *
 * THE FOLD IS IN MEMORY BECAUSE THE ACCESSOR OFFERS NO AGGREGATE, which is
 * `catalog.ts`' and `wallet.ts`' recorded cost on their own pages. The read
 * grows with the number of loads rather than with the calendar, one row per
 * ingested publication, and it is stated here rather than discovered: an
 * aggregate is the shape `ScopedTx` and `FirmTx` deliberately do not offer, and
 * inventing one is `packages/db`'s diff and not a route's.
 */
export function newestCoverageDay(loads: readonly unknown[]): string | null {
  let newest: string | null = null;
  for (const load of loads) {
    const day = column(
      asRow(load, 'economicCalendarLoads'),
      'coverageEndDay',
      'economicCalendarLoads',
    );
    if (newest === null || day > newest) newest = day;
  }
  return newest;
}

/**
 * The source, reading through the accessor.
 *
 * `db.firm` AND NOTHING ELSE, ON ALL THREE READS. `economic_calendar_current`,
 * `economic_calendar_loads` and `trading_calendar` are each scope class `firm`
 * in `packages/db/src/scope.ts`, which is the same fact in three places: a
 * release, a load and a session belong to nobody. The endpoint declares
 * `session` anyway (ADR-111 clause 3) and the handler reads nothing out of it,
 * so no identity reaches this function and there is none for it to filter on.
 *
 * IT READS `economicCalendarCurrent` AND NEVER `economicCalendar`. `0039` calls
 * the view "the only definition of that anywhere", and an adapter over the base
 * table would re-derive the maximum revision in TypeScript, which is the
 * second-source-of-truth failure `FM-M7-08` guards and the exact thing the view
 * was created to make impossible.
 *
 * THE WINDOW IS UPCOMING RELEASES AND THE INDEX IS WHERE THAT WAS ALREADY
 * DECIDED. `economic_calendar_release_idx` is `0039`'s "the panel's read:
 * upcoming releases by instant", and the port's own doc says which window is
 * rendered is the QUERY's decision. This is the query. `atLeast(now)` is an
 * instant compared with an instant, which is the only comparison ADR-146 leaves
 * open on an `*_at`.
 *
 * @param env   where {@link ECONOMIC_CALENDAR_HORIZON_VAR} is read from, PER
 *              READ. A parameter for `cloudflareTurnstileVerifier`'s reason: a
 *              suite that could not vary the environment could assert none of
 *              the configuration behaviour.
 * @param clock the instant both comparisons are made at. Injected so a suite
 *              can put the read on either side of a session open without
 *              waiting for one, and so that one read uses ONE instant: a
 *              function calling `new Date()` twice could count a session as
 *              ahead in the first comparison and behind in the second.
 *
 * THE CONFIGURATION IS READ PER CALL AND NOT MEMOISED, for `resolveOtpMacKeys`'
 * reason: a value captured at import is a value a rotation cannot reach.
 */
export function databaseEconomicCalendar(
  db: ApiDb,
  env: Environment = process.env,
  clock: () => Date = () => new Date(),
): EconomicCalendarSource {
  return {
    async readPanel(): Promise<EconomicCalendarPanel> {
      // THE HORIZON IS RESOLVED BEFORE THE DOOR IS OPENED. An unconfigured
      // deployment refuses without spending a connection, and the refusal is
      // identical whatever the calendar holds.
      const horizon = resolveEconomicCalendarHorizon(env);
      if ('refusal' in horizon) throw new EconomicCalendarUnconfigured(horizon.refusal);

      // ONE INSTANT FOR THE WHOLE READ. See `clock` above.
      const now = clock();

      return await db.firm(async (tx) => {
        const occurrences = (
          await tx.rowsWhere('economicCalendarCurrent', { scheduledReleaseAt: atLeast(now) })
        ).map(toEconomicCalendarRow);

        const coveredThroughDay = newestCoverageDay(await tx.rows('economicCalendarLoads'));

        // NOTHING EVER LOADED IS STALE, AND IT IS THE ONE BRANCH THAT NEEDS NO
        // HORIZON. `DEP-M4-09`: the dangerous failure is the confident one, and
        // `renderEconomicCalendar` refuses the opposite pair outright, so this
        // is the source agreeing with the renderer rather than being caught by
        // it.
        if (coveredThroughDay === null)
          return { freshness: { stale: true, covered_through_day: null }, occurrences };

        // THE SESSIONS STILL AHEAD AND STILL COVERED. `session_open_at >= now`
        // is an instant against an instant and `trading_day <= covered_through_day`
        // is a day against a day; a holiday's `session_open_at` is NULL since
        // `0032` and `NULL >= $1` is not true, so holidays fall out of the
        // count without a branch. See this file's header.
        const ahead = await tx.rowsWhere('tradingCalendar', {
          sessionOpenAt: atLeast(now),
          tradingDay: atMost(coveredThroughDay),
        });

        return {
          freshness: {
            stale: ahead.length < horizon.tradingDays,
            covered_through_day: coveredThroughDay,
          },
          occurrences,
        };
      });
    },
  };
}

/**
 * An unfinished deployment is a 503 and never a 500. Anything else is the
 * transport's.
 *
 * TWO CLASSES AND ONE STATUS CODE, and an `EconomicCalendarError` IS NOT IN THE
 * SET. That class is a row the source handed over that this file cannot render:
 * a tier of four, two rows for one occurrence, a `*_day` carrying an instant.
 * Every one of those is a defect somebody has to fix in code, and this endpoint
 * takes no input at all, so a caller can cause none of them. They keep their
 * 500 through `server.ts`'s error handler, which is this file's own rule at
 * {@link EconomicCalendarError} and is unchanged by ADR-240.
 *
 * THE REFUSAL CARRIES NO DETAIL, on section 2's rule that a problem document
 * "never leaks internals". Which half is unfinished reaches the LOG, which is
 * where an operator reads it, and `turnstile.ts`'s outcome union is the same
 * split: three refusals kept apart for the operator and collapsed for the
 * caller.
 */
function unfinishedOrThrow(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (!(err instanceof EconomicCalendarUnwired) && !(err instanceof EconomicCalendarUnconfigured))
    throw err;
  request.log.error({ err }, 'economic calendar source is not wired or is not configured');
  return reply
    .code(503)
    .type(PROBLEM_MEDIA_TYPE)
    .send({ ...problem('service_unavailable', 503, request.id), title: 'Service unavailable' });
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
    handle: withSessionContext(async ({ request, reply }) => {
      try {
        const wired = source;
        if (wired === null)
          throw new EconomicCalendarUnwired(
            'no economic calendar source is wired, so `GET /economic-calendar` cannot read the ' +
              'panel it renders. This is a deployment that has not been finished rather than a ' +
              'request that failed: the process that builds this server is what supplies one',
          );
        return renderEconomicCalendar(await wired.readPanel());
      } catch (err) {
        return unfinishedOrThrow(err, request, reply);
      }
    }),
  },
];

/** The declaration as data, on `auth.ts`'s shape. */
export const ECONOMIC_CALENDAR_REQUIRED_FACTORS = requiredFactorTable(ECONOMIC_CALENDAR_ENDPOINTS);

export default defineRoutes({
  name: 'economic-calendar',
  routes: toRoutes(ECONOMIC_CALENDAR_ENDPOINTS),
});
