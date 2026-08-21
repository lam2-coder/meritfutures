// =============================================================================
// apps/portal/src/shell/app-shell.ts
// =============================================================================
// THE CHROME EVERY SCREEN RENDERS INSIDE, WHICH IS TWO OBLIGATIONS AND NOT ONE.
//
//   ADR-068 requirement 4, through M04 section 3.9: the impersonation banner is
//   SHELL CHROME, "so it is on all of section 3.1's screens AND ON EVERY ERROR,
//   EMPTY AND LOADING STATE. A banner absent from the error page is absent
//   exactly when an operator is somewhere unexpected."
//
//   INV-M4-09: "The simulated-environment disclosure appears in the footer, at
//   checkout entry, on certificates, and on the funded dashboard | Constitution
//   section 6, and it is A COMPLIANCE OBLIGATION rather than a design
//   preference."
//
// Both are properties of the SHELL rather than of any screen, which is why they
// are together here: the shell holds them, the content state is a separate
// field, and nothing a screen does can remove either. The suite renders all four
// content states and asserts the chrome is present in every one.
//
// -----------------------------------------------------------------------------
// THE DISCLOSURE TEXT IS NOT IN THIS FILE AND THAT IS INV-M4-08's SHAPE
// -----------------------------------------------------------------------------
// `simulated_environment_disclosure` below is a required `string` the caller
// supplies, not a sentence written here. The constitution and counsel own the
// wording; what this module owns is that there is nowhere to render the footer
// without it. It is deliberately NOT typed `CopyBlock`: a `CopyBlock` comes
// from a plan version, and this disclosure is a firm-level compliance statement
// that is true of every plan, so sourcing it from `plan_versions.copy_blocks`
// would tie a compliance obligation to whether a trader happens to hold an
// account. Where it does come from is a question for the content session; that
// it is required is settled here.
//
// -----------------------------------------------------------------------------
// INV-M4-07, AND WHY THERE IS NO `forbidden` IN THIS FILE'S VOCABULARY
// -----------------------------------------------------------------------------
//   "Cross-trader resource access returns `404`, and the portal renders it as
//   'not found', NOT 'forbidden' | Confirmed at the Wave 2 gate. Existence is
//   not confirmed to a stranger, AND THE UI MUST NOT UNDO THAT BY WORDING."
//
// The server's half is settled: API_CONTRACT's negative-authz matrix reads
// "User B reads `GET /accounts/{A}` and every subresource | `session` | 404".
// The portal's half is a wording decision, and a wording decision made in ten
// components is a wording decision that is eventually made wrong in one. So the
// error vocabulary below has no `forbidden` member for a `404` to be mapped
// onto, which is the same "absence of the field is the control" idiom the
// banner uses for its dismiss control.

import type { ImpersonationBannerView } from './impersonation-banner.js';

/**
 * What a read surface can be showing.
 *
 * `empty` IS A STATE AND NOT A ZERO-LENGTH `ready`. A trader with no accounts
 * and a trader whose accounts failed to load must not look alike, and neither
 * must a calendar with nothing scheduled and a calendar nobody loaded, which is
 * section 3.8's whole argument arriving one level up.
 */
export type ContentState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly error: PortalErrorKind };

/**
 * The error vocabulary, which has no `forbidden` and never will.
 *
 * `403` IS DELIBERATELY UNMAPPED AND FALLS TO `unexpected`, and that is an
 * argument rather than an oversight. On a read surface C-27 makes every read
 * available to any single factor, so a `403` here is not a state with copy: it
 * is FM-M4-10 firing, which section 9.2 pages on and calls "a rendering bug
 * until proven otherwise and an authorization bug if it is not". Giving it a
 * named state with its own sentence would create exactly the "forbidden"
 * vocabulary INV-M4-07 spends its whole row keeping off the screen, and it
 * would make an alertable defect look like a normal screen.
 */
export type PortalErrorKind =
  'not_found' | 'unauthenticated' | 'rate_limited' | 'server_error' | 'unexpected';

/**
 * HTTP status to the portal's own vocabulary.
 *
 * The mapping is here, once, so no component decides how to word a refusal.
 */
export function toPortalErrorKind(status: number): PortalErrorKind {
  if (status === 404) return 'not_found';
  if (status === 401) return 'unauthenticated';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status <= 599) return 'server_error';
  return 'unexpected';
}

/** What every screen is rendered inside. */
export type ShellView = {
  /**
   * The impersonation band, or its absence.
   *
   * NULL IS THE TRADER'S OWN SESSION AND IS THE ORDINARY CASE. The trader is
   * never told an impersonation session happened (ADR-068 requirement 7), and
   * section 3.9 shows that non-disclosure is a CONSEQUENCE of the session-type
   * boundary rather than a rule this file follows: IMPERSONATION-C1 refuses a
   * shared token hash in both directions, so an impersonation token can never
   * be the token a trader's own session carries and "there is no other session
   * the banner could reach".
   */
  readonly impersonation: ImpersonationBannerView | null;

  /**
   * INV-M4-09's footer. Required, so a screen cannot be assembled without it.
   * Constitution section 6, and a compliance obligation rather than a design
   * preference.
   */
  readonly simulated_environment_disclosure: string;

  readonly content: ContentState;
};

/**
 * Assemble the chrome.
 *
 * THE BANNER IS A FIELD OF THE SHELL AND NOT OF THE CONTENT, WHICH IS THE WHOLE
 * MECHANISM. `content` can be anything, including an error, and the band and
 * the disclosure are returned unchanged either way. There is no branch in this
 * function that can drop either, and the suite runs all four states.
 */
export function toShellView(input: {
  readonly impersonation: ImpersonationBannerView | null;
  readonly simulated_environment_disclosure: string;
  readonly content: ContentState;
}): ShellView {
  return {
    impersonation: input.impersonation,
    simulated_environment_disclosure: input.simulated_environment_disclosure,
    content: input.content,
  };
}
