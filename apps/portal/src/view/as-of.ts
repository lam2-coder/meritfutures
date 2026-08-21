// =============================================================================
// apps/portal/src/view/as-of.ts
// =============================================================================
// INV-M4-02, AS A TYPE RATHER THAN AS A HABIT.
//
//   "Every screen showing account state labels the last closed day it is as of
//   | `as_of_trading_day` is a REQUIRED PROP on every account-state component.
//   A component that renders a balance without it does not compile (ADR-002's
//   T+1 posture)."
//
// The enforcement clause is the whole of this file. `AccountState` below is the
// required prop expressed as a type, and every view model in this directory
// that carries a money number extends it. A component whose props are one of
// those view models therefore cannot be rendered without the day, because the
// day is not optional on the object it was handed.
//
// THE FAILURE THIS PREVENTS IS NOT A MISSING CAPTION. Merit's numbers are T+1:
// a balance is the balance as of the last closed session, and it is not what
// the account is worth right now. A trader who reads an unlabelled balance as
// live has been told something false by a screen that contains no false
// statement, and the whole of section 3.6's indicative tiering rests on the
// authoritative side being unambiguous about which day it speaks for.
//
// THE DAY IS A STRING AND IS NOT PARSED. It is the server's trading day in the
// exchange session vocabulary (CT), and the portal has no trading calendar. A
// `Date` here would be the client deciding what day a timestamp falls in, which
// is the error the corpus has warned about in `trading_calendar` three separate
// times and the reason `release_trading_day` is stored rather than derived
// (packages/db/migrations/0039_economic_calendar.sql, header item 5).

/**
 * The required label. Every view model carrying an account-state number extends
 * this, so the day travels with the numbers rather than beside them.
 */
export type AccountState = {
  /**
   * The last closed trading day, exactly as the server sent it.
   *
   * NOT A `Date`. See the file header: the portal owns no calendar and a
   * conversion here would be the client deciding which day a moment belongs to.
   */
  readonly as_of_trading_day: string;
};

/**
 * The tier vocabulary, which is INV-M4-11's required prop.
 *
 *   "Every value sourced from the indicative layer is rendered with an
 *   indicative label, IN THE SAME COMPONENT, at the point of use | Enforced the
 *   same way INV-M4-02 enforces `as_of_trading_day`: an indicative component
 *   takes a required `tier` prop and a component that renders a live value
 *   without it does not compile. A label in a page footer is not a label on a
 *   number."
 *
 * ONLY `authoritative` IS USED IN THIS SESSION AND THE OTHER VALUE IS STILL
 * DECLARED. The indicative layer is ADR-020's socket, which does not exist:
 * nothing in this application subscribes to anything. What does exist is the
 * economic-calendar panel, and M04 section 3.8 rules it AUTHORITATIVE in a
 * table whose whole subject is the distinction, with an argument that "a
 * scheduled release time is neither" a live number nor a decided one and is a
 * published fact Merit transcribed. A panel that declares its tier is a panel
 * that has answered the question; one that carries no tier field has left it
 * for whoever styles it, which is where INV-M4-11 says the label must not live.
 */
export type Tier = 'authoritative' | 'indicative';

/** A surface that has declared which tier its numbers are. INV-M4-11. */
export type Tiered = {
  readonly tier: Tier;
};
