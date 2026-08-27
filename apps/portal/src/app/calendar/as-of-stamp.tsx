// =============================================================================
// apps/portal/src/app/calendar/as-of-stamp.tsx
// =============================================================================
// AN AS-OF STAMP IS A CLAIM ABOUT WHEN THE FIRM LAST COMPUTED SOMETHING, AND A
// STALE ONE RENDERED AS CURRENT IS A SMALL LIE ON THE SURFACE WHOSE WHOLE
// PURPOSE IS THAT THE TRADER CAN CHECK THE FIRM'S WORK.
//
//   INV-M4-02: "Every screen showing account state labels the last closed day
//   it is as of | `as_of_trading_day` is a REQUIRED PROP on every account-state
//   component."
//
//   `view/as-of.ts`, on what the failure actually is: "THE FAILURE THIS
//   PREVENTS IS NOT A MISSING CAPTION. A trader who reads an unlabelled balance
//   as live has been told something false BY A SCREEN THAT CONTAINS NO FALSE
//   STATEMENT."
//
// INV-M4-02 gets the day onto the screen. IT DOES NOT GET THE STALENESS ONTO
// THE SCREEN, and that is the gap this file closes. A correctly labelled
// `as_of_trading_day` that is four sessions behind renders exactly like one
// computed an hour ago: same field, same words, same confidence. The trader
// reading it has no way to tell, and the screen still contains no false
// statement, which is the sentence above arriving one level up.
//
// -----------------------------------------------------------------------------
// THE PORTAL MAY NOT DECIDE THIS, SO THE TYPE MAKES IT SOMEBODY ELSE'S ANSWER
// -----------------------------------------------------------------------------
// The obvious implementation is to compare the day against today. It is banned
// twice over: the portal owns no trading calendar (`view/as-of.ts`, and
// `trading-day.tsx` beside this file), and "today" is a clock, so the answer
// would move at midnight in a timezone nobody chose. What the portal MAY do is
// compare two trading days THE SERVER SUPPLIED, as strings, because
// packages/rules-engine/src/calendar.ts records that comparison as the engine's
// own: "every day comparison in the engine is LEXICOGRAPHIC on a zero-padded
// ISO day, which is chronological order with NO ARITHMETIC". No calendar is
// consulted and no clock is read; two published facts are ordered.
//
// So `AsOfFreshness` is a required prop, enforced the way INV-M4-02, INV-M4-11
// and INV-M4-14 are all enforced: a screen that renders an as-of day without a
// freshness claim does not compile.
//
// -----------------------------------------------------------------------------
// `unstated` IS AN ARM BECAUSE THE CONFIDENT ANSWER IS THE DANGEROUS ONE
// -----------------------------------------------------------------------------
// DEP-M4-09, quoted by `view/economic-calendar.ts`: "the dangerous failure is
// not the empty panel, it is the confident one." A two-valued fresh/stale union
// forces every caller that has no freshness fact to pick one, and the one they
// will pick is `current`, because it is the one that renders cleanly. So "the
// server did not say" is its own arm and its own sentence on screen.
//
// IT IS ALSO THE STATE EVERY ACCOUNT-STATE SURFACE IS IN TODAY, and putting it
// on screen is the point rather than a defect. `api/types.ts` publishes no
// field carrying the firm's last closed trading day: `AccountDetail` and the
// timeline carry the day a figure speaks FOR and nothing carries the day the
// firm has closed THROUGH, so no caller outside the economic-calendar panel can
// construct anything but `unstated`. ADR-152 is that gap ruled rather than
// discovered by a reader, and this arm is what keeps it visible while it is
// open instead of letting a screen quietly claim to be current.

/**
 * What the SERVER said about whether a figure is at the last closed day.
 *
 * Never computed from a clock, never computed from a calendar, and never
 * defaulted. See the file header for all three refusals.
 */
export type AsOfFreshness =
  /** The figure is at the day the firm has closed through. */
  | { readonly kind: 'current' }
  /**
   * The figure is behind, because the server said so.
   *
   * `closed_through_day` IS NULLABLE AND THE NULL IS NOT A CONVENIENCE. Two
   * different endpoints produce this arm and only one of them can name a later
   * day. An account-state surface reaches it by ordering two trading days, so
   * it has the later one in hand. The economic-calendar panel reaches it from
   * `freshness.stale`, which is "the server's answer, EVALUATED AGAINST ITS OWN
   * THRESHOLD" (`api/types.ts`) and names no day at all. Forcing a day here
   * would make the second caller invent one.
   */
  | { readonly kind: 'stale'; readonly closed_through_day: string | null }
  /** No endpoint published a freshness fact. NOT the same as current. */
  | { readonly kind: 'unstated' };

/**
 * Two server-supplied trading days, ordered. The only permitted producer.
 *
 * A `null` closed-through day is `unstated` and never `current`: an absent fact
 * is an absent fact, and the whole of the header's third section is about the
 * direction that mistake goes in.
 */
export function freshnessAgainst(
  as_of_trading_day: string,
  closed_through_day: string | null,
): AsOfFreshness {
  if (closed_through_day === null) return { kind: 'unstated' };
  if (as_of_trading_day === closed_through_day) return { kind: 'current' };
  if (as_of_trading_day < closed_through_day) {
    return { kind: 'stale', closed_through_day };
  }
  throw new AsOfContradictionError(as_of_trading_day, closed_through_day);
}

/**
 * A figure dated AFTER the day the firm says it has closed through.
 *
 * A REFUSAL RATHER THAN A THIRD RENDERING, on the idiom this module already
 * uses twice. `view/economic-calendar.ts` throws on an unparsable instant
 * because "the panel renders the time Merit transcribed and has nothing to
 * substitute for it", and `view/rules.ts` throws on a version that published no
 * copy. Here the server has said two things that cannot both be true, and every
 * available rendering of that is a guess about which one is wrong. A screen
 * that guesses on a transparency surface is the failure this whole file is
 * about, so the render stops and names both days.
 */
export class AsOfContradictionError extends Error {
  constructor(
    readonly as_of_trading_day: string,
    readonly closed_through_day: string,
  ) {
    super(
      `as-of trading day ${as_of_trading_day} is later than the last closed trading day ` +
        `${closed_through_day} the server reported. A figure cannot speak for a session the ` +
        'firm has not closed, and the portal has no calendar with which to decide which of ' +
        'the two the server got wrong.',
    );
    this.name = 'AsOfContradictionError';
  }
}

export type AsOfStampProps = {
  /**
   * INV-M4-02's required prop, carried through to the render.
   *
   * NULLABLE FOR THE COVERAGE CASE AND NOT FOR THE ACCOUNT-STATE ONE, which the
   * types already keep apart: `TimelineView` and every other view model
   * extending `AccountState` declare it `string`, so no account-state caller can
   * reach the null branch even by accident. What can is the economic-calendar
   * panel, whose `covered_through_day` is null "when nothing has ever been
   * loaded", and a screen that printed a blank there would be the confident
   * empty panel DEP-M4-09 names.
   */
  readonly as_of_trading_day: string | null;

  /** Required. See the file header: there is no default and there must not be one. */
  readonly freshness: AsOfFreshness;

  /** What the figure IS, so the sentence names it. For example `This timeline`. */
  readonly subject: string;
};

/**
 * The stamp. One day, one honest sentence about whether it is the current one.
 *
 * `data-freshness` CARRIES THE ARM. The suite asserts on it rather than on the
 * prose, so the wording can be taken to copy review without silently retiring
 * the assertion, and a styling change cannot turn a stale stamp into a quiet
 * one: the attribute is on the element the styles hang off.
 */
export function AsOfStamp({ as_of_trading_day, freshness, subject }: AsOfStampProps) {
  return (
    <p
      className={`merit-as-of merit-as-of--${freshness.kind}`}
      data-freshness={freshness.kind}
      data-as-of-trading-day={as_of_trading_day ?? 'none'}
    >
      {as_of_trading_day === null ? (
        <strong>{subject} carries no trading day at all. Merit has never loaded one.</strong>
      ) : (
        <strong>
          {subject} is as of the close of trading day <time>{as_of_trading_day}</time>.
        </strong>
      )}{' '}
      {freshness.kind === 'current' ? (
        <span className="merit-as-of__note">
          Merit reports that as current: there is no later closed trading day this screen is
          missing.
        </span>
      ) : null}
      {freshness.kind === 'stale' && freshness.closed_through_day !== null ? (
        <span className="merit-as-of__note">
          Merit has since closed trading day <time>{freshness.closed_through_day}</time>, so this is
          behind and is not what your account is worth now.
        </span>
      ) : null}
      {freshness.kind === 'stale' && freshness.closed_through_day === null ? (
        <span className="merit-as-of__note">
          Merit has reported this as stale and has not named the day it is behind by, so treat it as
          out of date rather than as current.
        </span>
      ) : null}
      {freshness.kind === 'unstated' ? (
        <span className="merit-as-of__note">
          Merit has not published which trading day it has closed through, so this screen cannot
          tell you whether that is the most recent one.
        </span>
      ) : null}
    </p>
  );
}
