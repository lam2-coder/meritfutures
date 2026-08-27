// =============================================================================
// apps/portal/src/app/calendar/trading-day.tsx
// =============================================================================
// THE TRADING DAY IS NOT THE CALENDAR DAY, AND THIS FILE IS WHERE THE PORTAL
// STOPS BEING ABLE TO CONFUSE THEM.
//
//   CLAUDE.md, binding: "Timestamps UTC in storage; trading day follows the
//   exchange session calendar (CT), maintained as data."
//
//   GLOSSARY, `session`: "The exchange trading period bounded by the CME
//   session open and close for a trading day, expressed in exchange time (CT).
//   Merit stores all timestamps in UTC and derives session membership from the
//   CALENDAR, NEVER FROM WALL-CLOCK ARITHMETIC. A fill belongs to the trading
//   day whose session CONTAINS its execution timestamp."
//
// -----------------------------------------------------------------------------
// WHY A COMPONENT AND NOT A CONVENTION
// -----------------------------------------------------------------------------
// A screen that renders `new Date(occurred_at).toISOString().slice(0, 10)` as a
// trading day is WRONG ON SOME DAYS AND RIGHT ON MOST, which is the worst
// available failure: it survives review, it survives a demo, and it surfaces
// when a trader disputes a day and the firm's own screen agrees with the
// trader's broker instead of with the firm's engine.
//
// The measured case, which is the one the suite asserts and not a hypothetical:
// `2026-03-12T22:30:00Z` is 17:30 CT on 12 March 2026 (CDT, UTC-5). The evening
// session has opened, and
// packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql
// records the open as "session opens at 17:00 CT regardless" while its own
// comment states the rule this file exists to hold up: "session calendar (CT)
// is authoritative; storage is UTC". So that instant belongs to trading day
// 2026-03-13 while its UTC calendar date reads 2026-03-12, and a viewer in New
// York reads 18:30 on 12 March. THREE ANSWERS, TWO OF WHICH ARE NOT THE
// TRADING DAY.
//
// -----------------------------------------------------------------------------
// THE MECHANISM IS THE ABSENCE OF AN INPUT, WHICH IS THIS MODULE'S OWN IDIOM
// -----------------------------------------------------------------------------
// `TradingDay` takes a STRING the server sent and has no other input. There is
// no instant on its props, so there is nothing for a conversion to convert, and
// a caller holding only a timestamp cannot render a trading day at all: they
// have to go and get the server's. That is the same shape
// `view/economic-calendar.ts` uses for INV-M4-16 (no URL field, so no embed)
// and `shell/app-shell.ts` uses for INV-M4-07 (no `forbidden` member, so no
// wording to reach for).
//
// The portal owns no calendar and must not grow one. `view/as-of.ts` states it
// at the point of declaration: "the portal has no trading calendar. A `Date`
// here would be the client deciding what day a timestamp falls in." And
// packages/rules-engine/src/calendar.ts, which is where the real calendar
// queries live, does not offer a timestamp-to-trading-day function to anybody:
// its `CalendarSlice` is DATA the caller loaded, and the engine's own header
// refuses to make it a capability precisely so no consumer can derive a day
// from a clock. There is nothing to import even if this file wanted to.
//
// THE SERVER IS THE SOURCE, PER ROW. `EconomicCalendarOccurrence` carries
// `release_trading_day` STORED rather than derived (0039 header item 5) and
// `TimelineItem` carries `trading_day`. Both arrive already answered. Session
// 258 is writing the endpoint that serves the first of them and is cited
// unlinked here because it has not landed.

/** The trading-day vocabulary, so a screen never spells the absence twice. */
export const NO_TRADING_DAY = 'no trading day';

export type TradingDayProps = {
  /**
   * The server's trading day, exactly as it arrived. NOT AN INSTANT AND NOT A
   * `Date`: see the file header. A null is an event the server did not place in
   * a session, which is a fact about the event and never a gap to fill in here.
   */
  readonly trading_day: string | null;

  /** Rendered before the day. Defaults to nothing, for use inside a sentence. */
  readonly label?: string;
};

/**
 * One trading day, rendered as the trading day it is.
 *
 * `dateTime` IS DELIBERATELY NOT SET ON THE `<time>` ELEMENT. The HTML
 * `datetime` attribute means a calendar date in the reader's own reckoning, and
 * a trading day is a date on the exchange session calendar that can differ from
 * it. Setting it would hand an assistive technology and every scraper the exact
 * substitution this file exists to prevent, in a machine-readable field where
 * nobody would look for it. The text carries the day; the attribute would carry
 * a claim Merit is not making.
 */
export function TradingDay({ trading_day, label }: TradingDayProps) {
  if (trading_day === null) {
    return (
      <span className="merit-trading-day merit-trading-day--absent" data-trading-day="none">
        {label === undefined ? null : `${label} `}
        {NO_TRADING_DAY}
      </span>
    );
  }
  return (
    <span className="merit-trading-day" data-trading-day={trading_day}>
      {label === undefined ? null : `${label} `}
      <time>{trading_day}</time>
      <span className="merit-trading-day__unit"> (trading day)</span>
    </span>
  );
}

export type LocalClockProps = {
  /** The viewer's local calendar date for the stored instant. `view/economic-calendar.ts` produced it. */
  readonly local_day: string;

  /** The viewer's local wall-clock time, 24 hour. */
  readonly local_time: string;

  /** The short zone name the viewer recognises, for example `EDT`. */
  readonly timezone_label: string;
};

/**
 * The viewer's wall clock, LABELLED AS THE VIEWER'S.
 *
 * This is the half of the render that legitimately differs per trader (GS-285,
 * one row on two dashboards in two timezones, both correct). It is a separate
 * component from `TradingDay` so the two can never be styled into looking like
 * one field: they answer different questions and on the case above they carry
 * different dates. The zone label is not decoration for the same reason. A local
 * time with no zone beside it is a number two traders will read as the same
 * moment and will not be.
 */
export function LocalClock({ local_day, local_time, timezone_label }: LocalClockProps) {
  return (
    <span className="merit-local-clock" data-local-day={local_day}>
      <time>{`${local_day} ${local_time}`}</time> {timezone_label}
      <span className="merit-local-clock__unit"> (your local time)</span>
    </span>
  );
}
