// =============================================================================
// apps/portal/src/view/economic-calendar.ts
// =============================================================================
// M04 SECTION 3.8, ADR-066 section 5.1, GS-285. A dashboard panel rendering
// Tier-1 economic events in the trader's timezone. "It is a panel on the
// dashboard beside section 3.6's indicative layer, NOT A TWELFTH SCREEN, so
// section 3.1's table does not move and no `SC-M4-nn` is claimed."
//
// -----------------------------------------------------------------------------
// INV-M4-16, AND WHY THE ABSENCE OF A FIELD IS THE ENFORCEMENT
// -----------------------------------------------------------------------------
//   "The economic calendar panel's source is `economic_calendar` and no
//   external origin. NO EMBED, IFRAME, OR THIRD-PARTY CALENDAR WIDGET RENDERS
//   ANYWHERE IN THE PORTAL."
//
// There is no URL on any type in this file, and there is nothing for one to be
// assigned to. An embed "cannot carry a revision, cannot be staleness-monitored
// and cannot be joined to `fills`", so one rendered beside this panel would
// satisfy the display and satisfy none of DEP-M7-06, D-04 or FM-M7-08. The
// suite walks the built view and fails on any key that looks like an origin,
// which is the same idiom ADR-068 uses for the banner's dismiss control: the
// absence of the prop is the control.
//
// -----------------------------------------------------------------------------
// AUTHORITATIVE, NOT INDICATIVE, AND SECTION 3.8 ARGUES IT RATHER THAN ASSUMES
// -----------------------------------------------------------------------------
//   "Section 3.6's tiering separates 'a number a moment ago' from 'a number the
//   rules used'. A scheduled release time is neither: it is a PUBLISHED FACT
//   MERIT TRANSCRIBED, and it does not move with the market. Rendering it as
//   indicative would teach the trader that release times are approximate, which
//   is the opposite of true and the opposite of useful."
//
// So `tier` is the literal `'authoritative'` on both arms of the union below.
//
// -----------------------------------------------------------------------------
// GS-285: ONE ROW, TWO TIMEZONES, NO SECOND ANSWER
// -----------------------------------------------------------------------------
//   "The timezone conversion is a RENDERING and never a stored value. One row,
//   one UTC instant, converted per trader at the point of display. GS-285 is
//   exactly this: the same row on two dashboards in two timezones, both
//   correct, with no second row and no timezone column anywhere."
//
// This file is the conversion. It takes the timezone as an argument because a
// timezone is a property of the VIEWER and never of the event, and it holds the
// stored instant unchanged on every release it renders, so the row and its
// rendering are both on screen and cannot silently disagree.
//
// THE ORDER IS BY THE STORED INSTANT AND THAT IS PART OF THE SAME PROPERTY.
// Sorting by a converted local time would be sorting by something that differs
// per viewer, so two traders could see the same two releases in opposite
// orders. Sorting by the UTC instant is the one comparison that is the same
// everywhere, which is GS-285's "both correct" applied to sequence rather than
// to a clock face.
//
// -----------------------------------------------------------------------------
// WHAT THE PANEL DELIBERATELY DOES NOT SAY
// -----------------------------------------------------------------------------
//   "It does not tell the trader that trading a news window is prohibited,
//   because it is not: D-04 detects a PATTERN ACROSS MANY EVENTS and M07 is
//   explicit that 'one trade around a release is a normal trading day'. A panel
//   that implied otherwise would be a rule the corpus does not contain,
//   rendered in the client, which is INV-M4-08's failure in a new place."
//
// The structural version of that: the only free text on any type here is
// `revision_reason`, which is a column, and there is no field a warning
// sentence could be written into.

import type { EconomicCalendarOccurrence, EconomicCalendarPanelResponse } from '../api/types.js';

/** DEP-M7-06 and D-04 read Tier-1. So does the panel. */
const TIER_ONE = 1;

/** One release, as one trader sees it. */
export type ReleaseView = {
  readonly event_key: string;
  readonly occurrence_key: string;

  /**
   * THE STORED INSTANT, UNCHANGED. Kept beside its own rendering so the row and
   * the conversion are both on screen: a converted time with its source
   * discarded is a number nobody can check.
   */
  readonly scheduled_release_at: string;

  /** The exchange-session day the release falls in. Stored, never derived (0039 header item 5). */
  readonly release_trading_day: string;

  /** The viewer's local calendar date for that instant. `YYYY-MM-DD`. */
  readonly local_day: string;

  /** The viewer's local wall-clock time, 24 hour. `HH:MM`. */
  readonly local_time: string;

  /** The short zone name the viewer would recognise, for example `CDT` or `JST`. */
  readonly timezone_label: string;

  /**
   * `revision > 0`. Section 3.8's table: a release whose time has been revised
   * renders "the CURRENT revision, and THAT IT MOVED".
   *
   * A revision is a row rather than an update (0039 header item 1), and the
   * panel reads `economic_calendar_current`, so this flag says the trader is
   * looking at the latest transcription of a time that changed.
   */
  readonly revised: boolean;

  /** The reason, when the load carried one. A column, never composed here. */
  readonly revision_reason: string | null;
};

/**
 * A STALE CALENDAR IS A STATE AND NOT AN EMPTY LIST, WHICH IS THE WHOLE UNION.
 *
 * Section 3.8: "An empty calendar panel looks exactly like a quiet week, and it
 * is the same failure: the trader reads 'nothing scheduled' and trades into a
 * release. So when the calendar is past its staleness threshold the panel says
 * so, IN THE SAME RENDER, rather than showing an empty list it cannot stand
 * behind."
 *
 * As a discriminated union, a `covered` panel with zero releases is a positive
 * claim that nothing is scheduled, and a stale panel has no `releases` field to
 * render as empty. DEP-M4-09's "the dangerous failure is not the empty panel,
 * it is the confident one" is then unrepresentable rather than merely
 * discouraged. It is INV-M4-12's rule (a live surface changes its LABEL in the
 * same render on feed loss) applied to a second surface, as section 3.8 says.
 */
export type EconomicCalendarPanelView =
  | {
      readonly state: 'stale';
      readonly tier: 'authoritative';

      /** The last day any load covers, or null when nothing has ever been loaded. */
      readonly covered_through_day: string | null;
    }
  | {
      readonly state: 'covered';
      readonly tier: 'authoritative';

      /** The IANA zone this render was made for. Echoed so a mis-set zone is visible. */
      readonly timezone: string;
      readonly covered_through_day: string | null;

      /** Tier-1 only, ordered by the stored instant. Empty means nothing is scheduled. */
      readonly releases: readonly ReleaseView[];
    };

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const found = parts.find((p) => p.type === type);
  if (found === undefined) {
    throw new RangeError(
      `the platform's Intl produced no ${type} part for the economic calendar panel. ` +
        'The panel renders a scheduled release time and cannot fall back to an ' +
        'approximate one (M04 section 3.8).',
    );
  }
  return found.value;
}

/**
 * One UTC instant, rendered for one viewer.
 *
 * `hourCycle: 'h23'` AND NUMERIC PARTS, DELIBERATELY. A locale-formatted string
 * would carry a month name and an am/pm marker that differ by ICU version, and
 * the panel's whole claim is that two viewers see the same fact. Numeric parts
 * are the same everywhere the zone data agrees, which is what is actually being
 * asserted. The zone NAME is taken from Intl because that is the string a
 * trader recognises and it is the one part that legitimately varies by zone.
 */
function localise(
  instant: string,
  timezone: string,
): { local_day: string; local_time: string; timezone_label: string } {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(
      `scheduled_release_at "${instant}" is not a parsable instant. The panel ` +
        'renders the time Merit transcribed and has nothing to substitute for it.',
    );
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(at);

  return {
    local_day: `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`,
    local_time: `${part(parts, 'hour')}:${part(parts, 'minute')}`,
    timezone_label: part(parts, 'timeZoneName'),
  };
}

function toRelease(occurrence: EconomicCalendarOccurrence, timezone: string): ReleaseView {
  return {
    event_key: occurrence.event_key,
    occurrence_key: occurrence.occurrence_key,
    scheduled_release_at: occurrence.scheduled_release_at,
    release_trading_day: occurrence.release_trading_day,
    ...localise(occurrence.scheduled_release_at, timezone),
    revised: occurrence.revision > 0,
    revision_reason: occurrence.revision_reason,
  };
}

/**
 * The dashboard panel, for one viewer's timezone.
 *
 * `timezone` IS AN IANA ZONE ID AND AN INVALID ONE THROWS, from `Intl` itself.
 * That refusal is the right one: a panel that fell back to UTC on a bad zone
 * would show a Tier-1 release at the wrong hour to a trader who had no way to
 * know, which is FM-M7-08's "wrong window" failure produced by a default.
 *
 * THE TIER FILTER IS A QUERY BECAUSE THE TIER IS A COLUMN. 0039 header item 3
 * keeps `tier` on the row rather than making Tier-1 a property of what was
 * loaded, so this filter is re-derivable and a load carrying lower tiers is
 * rendered correctly rather than accidentally.
 */
export function toEconomicCalendarPanel(
  response: EconomicCalendarPanelResponse,
  timezone: string,
): EconomicCalendarPanelView {
  if (response.freshness.stale) {
    return {
      state: 'stale',
      tier: 'authoritative',
      covered_through_day: response.freshness.covered_through_day,
    };
  }

  const releases = response.occurrences
    .filter((occurrence) => occurrence.tier === TIER_ONE)
    .map((occurrence) => toRelease(occurrence, timezone))
    .sort((a, b) => Date.parse(a.scheduled_release_at) - Date.parse(b.scheduled_release_at));

  return {
    state: 'covered',
    tier: 'authoritative',
    timezone,
    covered_through_day: response.freshness.covered_through_day,
    releases,
  };
}
