// =============================================================================
// apps/site/src/stats/published.ts
// =============================================================================
// M12'S PUBLISHED AGGREGATE, AS THE SITE RECEIVES IT.
//
// Transcribed column for column from `0021_transparency.sql`'s
// `published_statistics`, for the same reason `SiteSizeView` wraps the engine's
// own row rather than restating it: the site renders what M12 publishes and a
// paraphrase of the shape is the first step toward a paraphrase of the number.
//
// INV-M9-06 IS THE WHOLE BOUNDARY. "No number on the stats page is computed
// here. The page fetches M12's published aggregate and renders it with its
// window and as-of date attached. There is no arithmetic in this module." So
// there is no `numerator / denominator` anywhere in this package: the ratio is
// a stored column with a stored unit, and the components sit beside it because
// "a published ratio without its components cannot be checked by the reader,
// and a reader who cannot check is being asked to trust, which is the thing
// this module exists to avoid".
//
// THE VALUE IS NULLABLE AND SO IS THE UNIT, AND THAT PAIRING IS THE ONE THING A
// CONSUMER MUST NOT FLATTEN. `published_statistics_value_or_suppression`: "A row
// either publishes a value with its components, or states why it did not. Never
// neither." A suppressed row EXISTS, which is what makes suppression visible
// rather than a gap in a series (INV-M12-05), and rendering it as a blank would
// convert a stated limitation into a concealment.
// =============================================================================

/** `statistic_unit`. A bare bigint is ambiguous and this is what disambiguates it. */
export type StatisticUnit = 'count' | 'bp' | 'cents' | 'duration_seconds';

/** `statistic_measure`. ADR-032: which figure this row carries. */
export type StatisticMeasure = 'rate' | 'total' | 'mean' | 'median' | 'p50' | 'p95' | 'count';

/**
 * One `published_statistics` row.
 *
 * `method_path` is NOT a column and is the one field here that is not. AS-M9-03's
 * second counter is "Every stat links to its method, so a disputed figure
 * resolves against a published definition rather than an argument", and the
 * method page is a `statistic_definitions` row addressed by `stat_code` and
 * `definition_version`. The address is resolved by whoever reads the aggregate
 * and is carried alongside so that no surface has to build one, which is the
 * same reason `superseded_by` on a plan version carries its successor's slug.
 */
export interface PublishedStatistic {
  readonly stat_code: string;
  readonly definition_version: number;

  /** The trailing window, both ends. INV-M12-04. */
  readonly window_start_day: string;
  readonly window_end_day: string;
  /** The day the data closed at. Not the day it was computed. */
  readonly as_of_trading_day: string;

  readonly measure: StatisticMeasure;

  /** `null` exactly when `suppressed_reason` is set. */
  readonly value: bigint | null;
  readonly value_unit: StatisticUnit | null;

  /** The components, so a reader can check the ratio rather than trust it. */
  readonly numerator: bigint | null;
  readonly numerator_unit: StatisticUnit | null;
  readonly denominator: bigint | null;

  /** INV-M12-05. Shown even when the value is withheld. */
  readonly sample_size: number;

  /** Per plan, per size, or `null` for global. */
  readonly grain_key: string | null;

  /** Set when the value is withheld. INV-M12-05, and never rendered as a blank. */
  readonly suppressed_reason: string | null;

  /** INV-M12-03. A correction is a new row pointing at what it restates. */
  readonly restatement_of: string | null;

  /** Where the definition that produced this value is published. */
  readonly method_path: string;
}

/**
 * What `GET /public/stats` returns: the rows, and the moment M12 computed them.
 *
 * `computed_at` and `as_of_trading_day` are BOTH carried and they are different
 * facts. The as-of day is what the number describes and is what INV-M12-04 binds
 * to the value; `computed_at` is when the run happened and is what FM-M9-03's
 * freshness budget is measured against. A page that showed one and alarmed on
 * the other would be reporting the wrong staleness in whichever direction the
 * run lagged the data.
 */
export interface StatsPublication {
  readonly statistics: readonly PublishedStatistic[];
  /** ISO-8601 UTC. `published_statistics.computed_at` for this run. */
  readonly computed_at: string;
}

/**
 * `site.stats_stale`. Emitted when the rendered payload is older than its
 * freshness budget.
 *
 * The field names are M9 section 5's, verbatim: `{ as_of_trading_day, age_hours,
 * budget_hours }`. Consumers are ALERT and FEED.
 */
export interface StatsStaleEvent {
  readonly as_of_trading_day: string;
  readonly age_hours: number;
  readonly budget_hours: number;
}
