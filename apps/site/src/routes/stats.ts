// =============================================================================
// apps/site/src/routes/stats.ts
// =============================================================================
// PG-M9-05. THE ONE NUMBER A MISTAKE ON IS UNFORGIVABLE.
//
// M9 section 1.1: "A number Merit publishes about its own honesty is the one
// number a mistake on is unforgivable."
//
// THE VALUE AND ITS WINDOW ARE ONE VALUE HERE, NOT TWO FIELDS A LAYOUT CAN
// SEPARATE. AS-M9-03's first counter: "Every published statistic carries its
// trailing window and its as-of trading day **in the same visual unit as the
// number**, not in a caption and not in a footnote. This binds the OG image and
// every social card too, **which is where screenshots actually come from**."
// GS-144 makes a statistic rendered without its window a build failure,
// including in the OG image path, so `statisticText` below is the accessor and
// there is deliberately no `justTheValue`: a template that could reach the
// figure alone is a template that will, on the one surface that gets cropped.
//
// THE ADVERSARY IS AN ARTIFACT MERIT DOES NOT CONTROL. AS-M9-03's inverse "is
// the version that actually hurts": a bad quarter publishes honestly, gets
// screenshotted, and circulates as the permanent characterization of the firm.
// That is the price of the trust moat and is worth paying with eyes open, which
// is why the counter is binding the window to the number rather than publishing
// less.
//
// THERE IS NO ARITHMETIC ON A STATISTIC IN THIS FILE (INV-M9-06). What the
// formatters do is DECOMPOSE A STORED INTEGER INTO ITS OWN UNIT'S digits:
// `money` divides cents by 100 to write dollars and nobody calls that computing
// a price, and `duration` divides whole seconds into hours and minutes on the
// same footing. No numerator meets a denominator anywhere in this package; the
// ratio arrives as `value` with a `value_unit` and the components sit beside it
// unreduced so a reader can check it.
//
// FM-M9-03'S RECOVERY IS RENDER-LAST-GOOD OR RENDER-NOTHING, AND NEVER RENDER-A-
// NUMBER-WITHOUT-ITS-WINDOW. That is the same sentence as GS-144 read from the
// failure side, which is why one accessor serves both.
// =============================================================================

import type { BuiltAt } from '../catalog/types.js';
import { basisPoints, money } from '../render/cents.js';
import type { SimulatedEnvironmentDisclosure } from '../render/disclosure.js';
import type { PublishedStatistic, StatsPublication, StatsStaleEvent } from '../stats/published.js';
import type { PageEnvelope } from './page.js';
import { page } from './page.js';

/**
 * One statistic, rendered.
 *
 * `value` is `null` exactly when the row is suppressed, and `not_meaningful`
 * carries the reason in its place. INV-M12-05: "Below a per-statistic minimum
 * sample, the surface publishes 'not yet meaningful' **with the sample size
 * shown**, never a number and never a blank." Showing the sample while
 * withholding the ratio is what distinguishes a stated limitation from a
 * concealment.
 */
export interface RenderedStatistic {
  readonly stat_code: string;
  readonly measure: PublishedStatistic['measure'];
  /** The figure, in its own unit. `null` when the row is suppressed. */
  readonly value: string | null;
  /** M12's reason, when the value is withheld. `null` when there is a value. */
  readonly not_meaningful: string | null;
  /** INV-M12-04. Never optional, and never a caption. */
  readonly window: string;
  readonly as_of_trading_day: string;
  readonly sample_size: number;
  /** The components, unreduced. */
  readonly numerator: string | null;
  readonly denominator: string | null;
  /** AS-M9-03's second counter. */
  readonly method_path: string;
  /** INV-M12-03. Present when this value restates an earlier one. */
  readonly restates: string | null;
}

/** PG-M9-05's model. */
export interface StatsPage {
  readonly envelope: PageEnvelope;
  readonly statistics: readonly RenderedStatistic[];
  /** The moment M12's run produced these, distinct from the build moment. */
  readonly computed_at: string;
}

/** PG-M9-05, rendered from M12's publication and from nothing else. */
export function statsPage(
  publication: StatsPublication,
  disclosure: SimulatedEnvironmentDisclosure | null,
  built_at: BuiltAt,
): StatsPage {
  return {
    envelope: page({
      path: '/stats',
      title: 'Published statistics',
      indexable: true,
      built_at,
      disclosure,
    }),
    statistics: publication.statistics.map(renderStatistic),
    computed_at: publication.computed_at,
  };
}

/** One row, rendered. The window travels with the value and cannot be dropped. */
export function renderStatistic(stat: PublishedStatistic): RenderedStatistic {
  const suppressed = stat.suppressed_reason !== null;

  return {
    stat_code: stat.stat_code,
    measure: stat.measure,
    value: suppressed ? null : formatValue(stat.value, stat.value_unit),
    not_meaningful: stat.suppressed_reason,
    window: `${stat.window_start_day} to ${stat.window_end_day}`,
    as_of_trading_day: stat.as_of_trading_day,
    sample_size: stat.sample_size,
    numerator: formatValue(stat.numerator, stat.numerator_unit),
    denominator: stat.denominator === null ? null : count(stat.denominator),
    method_path: stat.method_path,
    restates: stat.restatement_of,
  };
}

/**
 * GS-144's accessor: the figure, with its window and its as-of day, as one
 * string.
 *
 * THIS IS THE ONLY WAY TO GET THE FIGURE OUT, and the absence of a bare-value
 * accessor is the control rather than an oversight. An OG image, a social card
 * and an email subject are all templates that take a string, and a template
 * that could take the number alone is one crop away from AS-M9-03's screenshot
 * circulating without the window that makes it true.
 *
 * A suppressed row renders its reason with the sample size, which is
 * INV-M12-05's "never a number and never a blank" in one branch.
 */
export function statisticText(rendered: RenderedStatistic): string {
  const tail = `${rendered.window}, as of ${rendered.as_of_trading_day}, n=${rendered.sample_size}`;

  if (rendered.value === null) {
    return `${rendered.not_meaningful ?? 'not yet meaningful'} (${tail})`;
  }
  return `${rendered.value} (${tail})`;
}

/**
 * GS-144, as a build check.
 *
 * "A statistic rendered without its window is a build failure", and this is
 * that sentence executable. It refuses an empty window, an empty as-of day, and
 * a row that carries neither a value nor a reason, which is the third state
 * `published_statistics_value_or_suppression` says cannot exist and which a
 * mapping bug can still produce on the way here.
 */
export function assertWindowAttached(rendered: RenderedStatistic): void {
  if (rendered.window.trim() === '' || rendered.as_of_trading_day.trim() === '') {
    throw new StatsRenderError(
      `GS-144: ${rendered.stat_code} would render without its window or its as-of ` +
        'trading day. A number Merit publishes about its own honesty is not ' +
        'publishable without the period it describes.',
    );
  }
  if (rendered.value === null && rendered.not_meaningful === null) {
    throw new StatsRenderError(
      `${rendered.stat_code} carries neither a value nor a reason for withholding ` +
        'one. INV-M12-05: never a number and never a blank.',
    );
  }
  if (rendered.method_path.trim() === '') {
    throw new StatsRenderError(
      `AS-M9-03: ${rendered.stat_code} would render with no link to its method, so ` +
        'a disputed figure would resolve against an argument rather than a definition.',
    );
  }
}

/**
 * FM-M9-03's detector, and the payload of `site.stats_stale`.
 *
 * BOTH TIMESTAMPS ARE ARGUMENTS AND NEITHER IS READ FROM A CLOCK, for the same
 * reason `built_at` is supplied everywhere else in this package: two builds of
 * one input must produce the same bytes and the same alarms.
 *
 * THE AGE IS WALL-CLOCK HOURS AND NOT TRADING DAYS, which is a deliberate
 * narrowing. A trading-day-aware age needs the exchange session calendar, which
 * is TradingCalendar's data and is not this module's to hold; a freshness budget
 * is a wall-clock operational quantity in the same sense
 * [ADR-042](docs/decisions/ADR-042.md) makes a release deadline one. A weekend
 * therefore ages the payload, and that is correct: a stats page two days old on
 * a Sunday is two days old.
 */
export function statsStaleness(
  publication: StatsPublication,
  now_iso: string,
  budget_hours: number,
): StatsStaleEvent | null {
  const computed = Date.parse(publication.computed_at);
  const now = Date.parse(now_iso);

  if (Number.isNaN(computed) || Number.isNaN(now)) {
    throw new StatsRenderError(
      'a stats freshness check needs two parseable ISO-8601 timestamps, and one of ' +
        `them was not: computed_at=${publication.computed_at}, now=${now_iso}`,
    );
  }

  const age_hours = Math.floor((now - computed) / 3_600_000);
  if (age_hours <= budget_hours) return null;

  const first = publication.statistics[0];
  return {
    as_of_trading_day: first?.as_of_trading_day ?? '',
    age_hours,
    budget_hours,
  };
}

/** A stored integer, in whatever unit it says it is in. */
function formatValue(value: bigint | null, unit: PublishedStatistic['value_unit']): string | null {
  if (value === null || unit === null) return null;

  switch (unit) {
    case 'cents':
      return money(value);
    case 'bp':
      return basisPoints(asSafeInteger(value, 'bp'));
    case 'count':
      return count(value);
    case 'duration_seconds':
      return duration(value);
  }
}

/** A count, with the same hand-inserted separators every other figure uses. */
function count(value: bigint): string {
  const digits = String(value < 0n ? -value : value);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return `${value < 0n ? '-' : ''}${out}`;
}

/**
 * Whole seconds, decomposed. ST-05 and ST-06 publish request-to-credit and
 * request-to-settlement durations, and "17,340 seconds" is a true statement
 * nobody can read.
 *
 * INTEGER DIVISION THROUGHOUT. The unit is whole seconds by ADR-031's own
 * enumeration, so there is no remainder to lose and no float to introduce.
 */
function duration(seconds: bigint): string {
  const abs = seconds < 0n ? -seconds : seconds;
  const hours = abs / 3600n;
  const minutes = (abs % 3600n) / 60n;
  const rest = abs % 60n;
  const sign = seconds < 0n ? '-' : '';

  if (hours > 0n) return `${sign}${count(hours)}h ${minutes}m`;
  if (minutes > 0n) return `${sign}${minutes}m ${rest}s`;
  return `${sign}${rest}s`;
}

/**
 * `basisPoints` takes a `number` because basis points are small by
 * construction, and this is the boundary where a `bigint` column meets it. A
 * value past the safe range is a mapping defect rather than a rate, and it says
 * so instead of silently losing digits.
 */
function asSafeInteger(value: bigint, unit: string): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new StatsRenderError(
      `a ${unit} value of ${value} is outside the safe integer range, so it is a ` +
        'mapping defect rather than a rate.',
    );
  }
  return asNumber;
}

/** Thrown by the stats page's build checks. */
export class StatsRenderError extends Error {
  override readonly name = 'StatsRenderError';
}
