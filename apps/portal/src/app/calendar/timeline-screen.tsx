// =============================================================================
// apps/portal/src/app/calendar/timeline-screen.tsx
// =============================================================================
// `GET /accounts/:accountId/timeline`, DRAWN. `view/timeline.ts` built the view
// model and its central property is a count: "`entries.length ===
// items.length` IS THE ASSERTION THE SUITE MAKES, and it is INV-M4-06 stated as
// a number."
//
// -----------------------------------------------------------------------------
// THE RENDERER DROPS NOTHING EITHER, AND THAT IS WHERE THE PROPERTY WOULD LEAK
// -----------------------------------------------------------------------------
// A view model that carries every entry and a renderer that draws the ones it
// recognises is the same defect one layer down, and it is easier to write by
// accident: a `switch` on `kind` with a `default: return null` looks like
// defensive rendering and is a client-side filter.
//
//   `view/timeline.ts`: "A portal that renders everything it is given fails
//   LOUDLY when the server sends something it should not have." And: "AN
//   UNKNOWN `kind` STILL RENDERS. `summary` is composed server side, so an
//   event type this build has never heard of arrives with its own sentence
//   already written."
//
// So there is no `switch` in this file and no map from `kind` to anything.
// `kind` is rendered as the string it is, beside the server's own sentence, and
// the suite counts the rendered entries against the input length.
//
// -----------------------------------------------------------------------------
// THE DAY HEADING IS THE ENTRY'S `trading_day`, WHICH IS NULLABLE ON PURPOSE
// -----------------------------------------------------------------------------
// `TimelineItem.trading_day` is `string | null`, and `occurred_at` is always
// present. Deriving the heading from `occurred_at` would produce a heading for
// every entry, including the ones the server deliberately did not place in a
// session, and it would produce the WRONG heading for any entry whose instant
// falls after the evening session open. Both failures read as a tidier screen.
//
// A null is rendered as an absence by `TradingDay` and never filled in. An
// event with no trading day is an event Merit did not attribute to a session,
// and inventing one here would be the client answering a question the server
// declined to answer.
//
// -----------------------------------------------------------------------------
// THE DETAIL MAP IS RENDERED AS THE VIEW MODEL FORMATTED IT
// -----------------------------------------------------------------------------
// INV-M4-01: no money value displayed anywhere is computed client side.
// `toTimelineView` already routed every `_cents` and `_bp` key through
// `format/money.ts` and set `is_money`, so this file prints strings and does no
// arithmetic. `is_money` becomes a data attribute rather than a class alone, so
// the suite can assert that a money detail arrived formatted rather than raw.
//
// -----------------------------------------------------------------------------
// A PAGE OF A TIMELINE IS NOT A TIMELINE, AND THE SCREEN HAS TO SAY WHICH IT GOT
// -----------------------------------------------------------------------------
// `GET /accounts/:accountId/timeline` answers API_CONTRACT section 1's envelope,
// `{ data, next_cursor }`, and `./load.ts` reads ONE page of it and argues why.
// The consequence lands here: the list below drew a page's worth of entries and
// said nothing about whether it was all of them, and "nothing has happened on
// this account yet" is a POSITIVE CLAIM that a truncated read must never make.
//
// SO `paging` IS A REQUIRED PROP WITH NO DEFAULT, WHICH IS `freshness`'S
// MECHANISM BESIDE IT AND IS THERE FOR THE SAME REASON. `as-of-stamp.tsx`: "a
// two-valued union forces every caller that has no fact to pick one, and the
// one they will pick is the one that renders cleanly." A caller that read one
// page cannot compile its way past saying so.
//
// NEITHER ARM NAMES AN END OF THE LIST. API_CONTRACT section 6 gives this
// endpoint the word "Chronological" and no direction, unlike `/marks`, whose
// row states "`trading_day` descending". So the sentence says a page was read
// and does not say whether the missing entries are older or newer, because this
// screen does not know.
//
// AND THERE IS NO CONTROL TO LOAD THE REST. A next page needs a navigation
// carrying a cursor, which is a route shape, and this segment's URLs are
// PROVISIONAL by `[accountId]/timeline/page.tsx`'s own note. Stating the
// truncation without offering a way past it is the honest half of the pair and
// the other half is reported rather than invented.

import type { ShellView } from '../../shell/app-shell.ts';
import type { TimelineView } from '../../view/timeline.ts';
import { AsOfStamp, type AsOfFreshness } from './as-of-stamp.tsx';
import { ScreenFrame } from './screen-frame.tsx';
import { TradingDay } from './trading-day.tsx';

/**
 * How much of the timeline this render is looking at.
 *
 * PRODUCED FROM `next_cursor` AND FROM NOTHING ELSE. `./load.ts` reads the
 * envelope's cursor: `null` is the end of the list and any string means the
 * server holds more. A row count against the requested limit is NOT the same
 * test, and using it would report an exactly-full final page as truncated
 * forever.
 *
 * THE CURSOR ITSELF IS NOT CARRIED. Section 1 calls it `<opaque>`, this screen
 * has no navigation to spend it on, and a token on a prop is a token somebody
 * renders.
 */
export type TimelinePaging =
  /** `next_cursor` was `null`. Every entry the account has is below. */
  | { readonly kind: 'complete' }
  /** The server holds entries this render did not read. */
  | { readonly kind: 'partial' };

export type TimelineScreenProps = {
  readonly shell: ShellView;
  readonly timeline: TimelineView;

  /**
   * REQUIRED, AND THERE IS NO DEFAULT. See the file header: the entries below
   * are one page of a cursor-paginated list, and a screen that cannot say so
   * renders a truncated timeline exactly as a whole one.
   */
  readonly paging: TimelinePaging;

  /**
   * REQUIRED, AND THERE IS NO DEFAULT. See `as-of-stamp.tsx`: the portal may not
   * decide whether the account's day is the last closed one, so the caller has
   * to have been given a freshness fact or has to say it was not.
   */
  readonly freshness: AsOfFreshness;
};

/** The account timeline, entry for entry. */
export function TimelineScreen({ shell, timeline, freshness, paging }: TimelineScreenProps) {
  return (
    <ScreenFrame shell={shell} title="Account timeline">
      <p>
        Account <code>{timeline.account_id}</code>
      </p>

      <AsOfStamp
        subject="This timeline"
        as_of_trading_day={timeline.as_of_trading_day}
        freshness={freshness}
      />

      <p className="merit-paging" data-paging={paging.kind}>
        {paging.kind === 'complete'
          ? 'This is the whole timeline for this account. There is nothing Merit holds that is not below.'
          : 'This is one page of this account\u2019s timeline. Merit holds further entries that this screen has not loaded, and it cannot tell you whether they are older or newer than these.'}
      </p>

      {timeline.entries.length === 0 ? (
        <p className="merit-empty" data-entries="none">
          {paging.kind === 'complete'
            ? 'Nothing has happened on this account yet.'
            : 'This page carried no entries. That is not a claim that nothing has happened on this account.'}
        </p>
      ) : (
        <ol data-entry-count={timeline.entries.length}>
          {timeline.entries.map((entry) => (
            <li className="merit-entry" key={`${entry.occurred_at}:${entry.kind}`}>
              <h2 data-kind={entry.kind}>{entry.kind}</h2>
              <p>{entry.summary}</p>
              <p>
                <TradingDay trading_day={entry.trading_day} />
              </p>
              <p>
                Recorded at <time>{entry.occurred_at}</time> (UTC, which is how Merit stores every
                timestamp and is not the trading day above)
              </p>
              {entry.detail.length === 0 ? null : (
                <dl className="merit-detail">
                  {entry.detail.map((detail) => (
                    <div key={detail.key}>
                      <dt>{detail.key}</dt>
                      <dd data-is-money={detail.is_money ? 'true' : 'false'}>
                        {detail.value === null ? 'none' : String(detail.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}
    </ScreenFrame>
  );
}
