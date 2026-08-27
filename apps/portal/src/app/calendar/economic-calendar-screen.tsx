// =============================================================================
// apps/portal/src/app/calendar/economic-calendar-screen.tsx
// =============================================================================
// M04 SECTION 3.8's PANEL, DRAWN. `view/economic-calendar.ts` built the view
// model; this is the render, and the two decisions it makes that are not
// styling are the two the module's whole argument rests on.
//
// -----------------------------------------------------------------------------
// 1. THE GROUPING IS BY `release_trading_day` AND NEVER BY `local_day`
// -----------------------------------------------------------------------------
// Both are on `ReleaseView` and either one would produce a plausible list of
// day headings. Only one of them is the day the rules use.
//
//   `EconomicCalendarOccurrence.release_trading_day`: "The exchange-session day
//   the release falls in. STORED, NEVER DERIVED (0039 header item 5)."
//
// `local_day` is the viewer's calendar date for the same instant, and on the
// case the suite asserts the two differ: a release at `2026-03-12T22:30:00Z` is
// trading day `2026-03-13` and reads `2026-03-12` on a New York clock. Grouping
// by the local day would put that release under a heading no counter in the
// rules engine has ever used, and it would do it CORRECTLY on most days, which
// is why a test on a date where the two agree proves nothing at all.
//
// The local clock is still on screen, on the row, labelled as the viewer's, per
// GS-285: one row, two dashboards, two timezones, both correct. What moved is
// which of the two answers the HEADING is allowed to be.
//
// THE GROUPING IS A WALK AND NOT A SORT. `toEconomicCalendarPanel` already
// ordered the releases by the stored UTC instant, and re-sorting here by the
// day string would be a second ordering that can disagree with the first. So
// this file walks the list it was given and starts a group when the trading day
// changes, which preserves the panel's ordering by construction.
//
// -----------------------------------------------------------------------------
// 2. A STALE PANEL HAS NO LIST TO DRAW, AND THE UNION IS WHY
// -----------------------------------------------------------------------------
//   Section 3.8: "An empty calendar panel looks exactly like a quiet week, and
//   it is the same failure: the trader reads 'nothing scheduled' and trades
//   into a release. So when the calendar is past its staleness threshold THE
//   PANEL SAYS SO, IN THE SAME RENDER."
//
// `EconomicCalendarPanelView`'s stale arm carries no `releases` field, so the
// stale branch below cannot render a list even by mistake: there is nothing to
// map. That is `view/economic-calendar.ts`'s "unrepresentable rather than
// merely discouraged" arriving in the renderer intact.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCREEN DOES NOT SAY
// -----------------------------------------------------------------------------
// Nothing about whether trading a news window is permitted. M07:109 is explicit
// that "one trade around a release is a normal trading day", D-04 detects a
// PATTERN ACROSS MANY EVENTS, and a warning here would be a rule the corpus
// does not contain, rendered in the client. There is no free text on this
// screen that is not a column or a state label.
//
// And no embed, iframe or third-party widget (INV-M4-16). There is no URL on
// any type this file reads, so there is nothing for one to be built from.

import type { EconomicCalendarPanelView, ReleaseView } from '../../view/economic-calendar.ts';
import type { ShellView } from '../../shell/app-shell.ts';
import { AsOfStamp } from './as-of-stamp.tsx';
import { ScreenFrame } from './screen-frame.tsx';
import { LocalClock, TradingDay } from './trading-day.tsx';

/** One heading and the releases that fall under it. Built by a walk, never a sort. */
type DayGroup = {
  readonly release_trading_day: string;
  readonly releases: readonly ReleaseView[];
};

/**
 * Group consecutive releases by their trading day.
 *
 * The input is already ordered by the stored instant and this preserves that
 * order, so a group is a run rather than a bucket. Two runs carrying the same
 * day cannot occur in an ordered list, and if the server ever sent one they
 * would render as two headings, which is the honest rendering of a response
 * whose ordering and whose days disagree.
 */
export function groupByTradingDay(releases: readonly ReleaseView[]): readonly DayGroup[] {
  const groups: DayGroup[] = [];
  for (const release of releases) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.release_trading_day === release.release_trading_day) {
      groups[groups.length - 1] = {
        release_trading_day: last.release_trading_day,
        releases: [...last.releases, release],
      };
      continue;
    }
    groups.push({ release_trading_day: release.release_trading_day, releases: [release] });
  }
  return groups;
}

export type EconomicCalendarScreenProps = {
  readonly shell: ShellView;
  readonly panel: EconomicCalendarPanelView;
};

/** Section 3.8's panel, as a screen. */
export function EconomicCalendarScreen({ shell, panel }: EconomicCalendarScreenProps) {
  return (
    <ScreenFrame shell={shell} title="Economic calendar">
      <p data-tier={panel.tier}>
        Tier 1 releases Merit has transcribed. These are scheduled times, not forecasts, and this
        screen is {panel.tier}.
      </p>

      {panel.state === 'stale' ? (
        <div className="merit-stale" data-panel-state="stale">
          <p>
            <strong>Merit&rsquo;s economic calendar is stale.</strong> This screen is not showing
            you an empty week. It is telling you that Merit cannot stand behind what it holds, so
            treat it as though there may be a release it does not know about.
          </p>
          <AsOfStamp
            subject="Merit&rsquo;s calendar coverage"
            as_of_trading_day={panel.covered_through_day}
            freshness={{ kind: 'stale', closed_through_day: null }}
          />
        </div>
      ) : null}

      {panel.state === 'covered' ? (
        <div data-panel-state="covered" data-timezone={panel.timezone}>
          <AsOfStamp
            subject="Merit&rsquo;s calendar coverage"
            as_of_trading_day={panel.covered_through_day}
            freshness={{ kind: 'current' }}
          />

          {panel.releases.length === 0 ? (
            <p className="merit-empty" data-releases="none">
              Merit&rsquo;s calendar covers this window and holds no Tier 1 release in it. That is a
              positive statement about a quiet window rather than an absence of data.
            </p>
          ) : (
            groupByTradingDay(panel.releases).map((group) => (
              <section className="merit-day-group" key={group.release_trading_day}>
                <h2 data-group-trading-day={group.release_trading_day}>
                  <TradingDay trading_day={group.release_trading_day} />
                </h2>
                {group.releases.map((release) => (
                  <article className="merit-release" key={release.occurrence_key}>
                    <h3>{release.event_key}</h3>
                    <p>
                      <LocalClock
                        local_day={release.local_day}
                        local_time={release.local_time}
                        timezone_label={release.timezone_label}
                      />
                    </p>
                    <dl className="merit-detail">
                      <dt>Merit&rsquo;s stored instant</dt>
                      <dd>
                        <time>{release.scheduled_release_at}</time>
                      </dd>
                      <dt>Trading day</dt>
                      <dd>
                        <TradingDay trading_day={release.release_trading_day} />
                      </dd>
                    </dl>
                    {release.revised ? (
                      <span className="merit-release__revised" data-revised="true">
                        This release time has been revised.
                        {release.revision_reason === null
                          ? null
                          : ` Reason given: ${release.revision_reason}`}
                      </span>
                    ) : null}
                  </article>
                ))}
              </section>
            ))
          )}
        </div>
      ) : null}
    </ScreenFrame>
  );
}
