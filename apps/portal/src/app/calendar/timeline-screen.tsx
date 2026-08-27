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

import type { ShellView } from '../../shell/app-shell.ts';
import type { TimelineView } from '../../view/timeline.ts';
import { AsOfStamp, type AsOfFreshness } from './as-of-stamp.tsx';
import { ScreenFrame } from './screen-frame.tsx';
import { TradingDay } from './trading-day.tsx';

export type TimelineScreenProps = {
  readonly shell: ShellView;
  readonly timeline: TimelineView;

  /**
   * REQUIRED, AND THERE IS NO DEFAULT. See `as-of-stamp.tsx`: the portal may not
   * decide whether the account's day is the last closed one, so the caller has
   * to have been given a freshness fact or has to say it was not.
   */
  readonly freshness: AsOfFreshness;
};

/** The account timeline, entry for entry. */
export function TimelineScreen({ shell, timeline, freshness }: TimelineScreenProps) {
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

      {timeline.entries.length === 0 ? (
        <p className="merit-empty" data-entries="none">
          Nothing has happened on this account yet.
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
