// =============================================================================
// apps/portal/src/shell/impersonation-banner.ts
// =============================================================================
// ADR-068 requirement 4 and M04 section 3.9. A PERSISTENT banner for the whole
// session, NOT A DISMISSIBLE TOAST.
//
// "This module writes the surface and rules none of it." ADR-068 rules the
// properties, migration 0042 enforces the box, and the four explicit refusals
// are server-side authorization decisions in M05, M19 and M20. NOTHING IN THIS
// FILE REFUSES ANYTHING, and the banner's absence would be "a disclosure defect
// and never an authorization defect" (section 3.9's last paragraph).
//
// -----------------------------------------------------------------------------
// SECTION 3.9'S FOUR MECHANICAL PROPERTIES, AND WHERE EACH ONE LIVES
// -----------------------------------------------------------------------------
//   "IT OCCUPIES LAYOUT | A reserved band in the app shell, never an overlay.
//   Nothing stacks over it, nothing scrolls it away, and no `z-index` accident
//   can lose it."
//     -> `placement` is the literal type `'shell-band'`. There is no other
//        value to assign, so "never an overlay" is not a convention a later
//        change can drift off.
//
//   "IT HAS NO DISMISS CONTROL | The component takes no `dismissible` prop and
//   no `onDismiss`. THE ABSENCE OF THE PROP IS THE CONTROL, in the idiom
//   INV-M4-02 and INV-M4-11 already use. A disabled close button is a close
//   button somebody re-enables."
//     -> neither prop exists on `ImpersonationBannerView`, and the suite
//        asserts the built object's key set exactly rather than approximately,
//        so adding one is a failing test rather than a review comment.
//
//   "IT RENDERS ON EVERY SCREEN | Shell chrome, so it is on all of section
//   3.1's screens AND ON EVERY ERROR, EMPTY AND LOADING STATE. A banner absent
//   from the error page is absent exactly when an operator is somewhere
//   unexpected."
//     -> ./app-shell.ts, where the banner is a field of the shell rather than
//        of the content, and the suite renders all four content states.
//
//   "IT SURVIVES RELOAD AND DEEP LINK | It renders from the session the server
//   resolved, never from client state. A banner held in memory is gone on the
//   first hard refresh, which is the ordinary way an operator works."
//     -> `toImpersonationBanner` takes the resolved session and nothing else.
//        There is no store, no flag, and nothing to persist.
//
// -----------------------------------------------------------------------------
// THE EXPIRY IS SHOWN AND IT IS NOT A COUNTDOWN, WHICH IS TWO RULINGS AT ONCE
// -----------------------------------------------------------------------------
// Section 3.7 keeps the ELEVATION window off the screen: "a visible countdown
// is a prompt to hurry and hurrying is the attacker's ally". Section 3.9 argues
// the opposite for THIS clock and says why: "This clock has the opposite
// audience and the opposite meaning. It is a BOX rather than a window of
// opportunity, its subject is the operator rather than the target", and
// GS-301's failure is "a session that reaches expiry mid-view, whose next
// request is refused, on a page that still looks live."
//
// BOTH RULINGS ARE HONOURED BY RENDERING THE INSTANT AND COMPUTING NO
// REMAINING TIME. `expires_at` is on the banner, exactly as the server declared
// it. There is no `remaining_seconds`, no `expires_in`, and nothing that ticks:
// "The clock is displayed and is never authoritative... A client that believes
// the session is live is not evidence that it is", which is INV-M4-15's
// sentence applied to a clock. A countdown would be the portal owning a clock
// it does not own, and IMPERSONATION-C2 already makes a page view outside the
// box unwritable, so the real refusal is the server's either way.
//
// Formatting the instant for an operator's locale is a design-system concern
// and is deliberately not decided here.

import type { ImpersonationSession } from '../api/types.js';

/**
 * The exit, which is a CONTROL ON THE BANNER rather than a closed browser tab.
 *
 * FOLD-04 section 4.1 "requires an explicit exit that is its own audited
 * event", and section 3.9 lists the columns it writes: `ended_at`, `ended_by`
 * and `end_reason`. The write is the server's; what the banner carries is the
 * affordance.
 *
 * IT IS NOT A DISMISS. Ending the session removes the reason the banner exists;
 * hiding the banner would leave the session running with nothing on screen to
 * say so, which is the exact failure requirement 4 is about.
 */
export type ImpersonationExit = {
  readonly action: 'end_impersonation';
};

/**
 * The band. Every field is a column on `impersonation_sessions` (migration
 * 0042), "rather than a string the portal composes" (section 3.9).
 */
export type ImpersonationBannerView = {
  /**
   * A RESERVED BAND, NEVER AN OVERLAY. The literal type is the enforcement:
   * there is no second value, so nothing can promote this to a floating layer
   * where a `z-index` accident can lose it.
   */
  readonly placement: 'shell-band';

  /** `admin_user_id`. Whose session this is, without leaving the page. */
  readonly admin_user_id: string;

  /** `subject_identity_id`. The wrong subject, surfaced in one second. */
  readonly subject_identity_id: string;

  /** `reason_code`, a closed vocabulary. ADR-068 requirement 5. */
  readonly reason_code: string;

  /** `reason_detail`, NOT NULL and non-blank, so there is always something true to render. */
  readonly reason_detail: string;

  /** The box, as the server declared it. Never a countdown. See the file header. */
  readonly expires_at: string;

  readonly exit: ImpersonationExit;
};

/**
 * The banner, from the session the server resolved.
 *
 * ONE ARGUMENT, AND IT IS THE SERVER'S. No options object, no flags, nothing
 * from client state. That is "it survives reload and deep link" expressed as a
 * signature: there is no second input a refresh could lose.
 */
export function toImpersonationBanner(session: ImpersonationSession): ImpersonationBannerView {
  return {
    placement: 'shell-band',
    admin_user_id: session.admin_user_id,
    subject_identity_id: session.subject_identity_id,
    reason_code: session.reason_code,
    reason_detail: session.reason_detail,
    expires_at: session.expires_at,
    exit: { action: 'end_impersonation' },
  };
}
