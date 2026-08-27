// =============================================================================
// apps/portal/src/app/calendar/screen-frame.tsx
// =============================================================================
// THE CHROME, RENDERED. `shell/app-shell.ts` built the `ShellView` and nothing
// in the tree has ever drawn one, so the two obligations that file holds have
// been types rather than pixels since it was written. This is the drawing.
//
//   ADR-068 requirement 4, through M04 section 3.9: the impersonation banner is
//   SHELL CHROME, "so it is on all of section 3.1's screens AND ON EVERY ERROR,
//   EMPTY AND LOADING STATE."
//
//   INV-M4-09: the simulated-environment disclosure "appears in the footer ...
//   Constitution section 6, and it is A COMPLIANCE OBLIGATION rather than a
//   design preference."
//
// -----------------------------------------------------------------------------
// THE CONTENT IS A CHILD AND THE CHROME IS NOT CONDITIONAL, WHICH IS THE POINT
// -----------------------------------------------------------------------------
// `shell/app-shell.ts` says of its own builder: "THERE IS NO BRANCH IN THIS
// FUNCTION THAT CAN DROP EITHER, and the suite runs all four states." The
// renderer inherits that obligation and the same shape holds it: the band and
// the footer are emitted outside every branch on `content`, so no content state
// has a path that reaches a return without them. A banner absent from the error
// page is absent exactly when an operator is somewhere unexpected.
//
// AND THE BAND HAS NO DISMISS CONTROL, because `ImpersonationBannerView` has no
// field for one. `impersonation-banner.ts` calls that the enforcement: "it
// cannot be closed rather than being hard to close". Nothing here adds one, and
// there is nothing on the props for one to be built from.
//
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER, NO SERVER ACTION, NO OPERATOR PATH
// -----------------------------------------------------------------------------
// ADR-083 section 3 and ADR-095 ruling 3: no route handler or server action in
// this application may serve `/api/v1` or any operator path. The band's exit
// control is therefore a LINK and never a form: `ImpersonationExit` carries an
// action NAME, `end_impersonation`, which is a thing the admin surface does, and
// a `<form action={...}>` here would be a server action taking an operator
// verb. INV-M4-15's rule is the same one from the other side: the portal
// renders the boundary and decides nothing.

import type { ReactNode } from 'react';

import type { ShellView } from '../../shell/app-shell.ts';
import { SEGMENT_STYLES } from './styles.ts';

/** The error vocabulary, drawn. `PortalErrorKind` has no `forbidden` member (INV-M4-07). */
const ERROR_SENTENCE: Readonly<Record<string, string>> = {
  not_found: 'Not found.',
  unauthenticated: 'Your session has ended. Sign in again to continue.',
  rate_limited: 'Too many requests just now. Try again shortly.',
  server_error: 'Merit could not load this. The failure is ours and it has been recorded.',
  unexpected: 'Merit could not load this.',
};

export type ScreenFrameProps = {
  readonly shell: ShellView;

  /** The screen's own heading. Rendered above the content in every state. */
  readonly title: string;
  readonly children: ReactNode;
};

/**
 * One screen, inside the chrome every screen renders inside.
 *
 * `children` IS RENDERED ONLY IN THE `ready` STATE. A loading or error screen
 * that also rendered its content would be showing a figure while telling the
 * trader it could not load one, and `empty` is a state rather than a zero-length
 * ready for the reason `app-shell.ts` gives: "a calendar with nothing scheduled
 * and a calendar nobody loaded" must not look alike.
 */
export function ScreenFrame({ shell, title, children }: ScreenFrameProps) {
  const { impersonation, content } = shell;
  return (
    <div className="merit-screen" data-content-state={content.kind}>
      <style>{SEGMENT_STYLES}</style>

      {impersonation === null ? null : (
        <aside
          className="merit-band"
          data-placement={impersonation.placement}
          aria-label="Impersonation session"
        >
          <p className="merit-band__line">
            <strong>You are viewing this account as an operator.</strong>
          </p>
          <p className="merit-band__line">
            Operator {impersonation.admin_user_id}, subject {impersonation.subject_identity_id}.
          </p>
          <p className="merit-band__line">
            {impersonation.reason_code}: {impersonation.reason_detail}
          </p>
          <p className="merit-band__line">Expires at {impersonation.expires_at}.</p>
          <p className="merit-band__exit">
            <a href="/admin/impersonation" data-action={impersonation.exit.action}>
              End impersonation
            </a>
          </p>
        </aside>
      )}

      <h1>{title}</h1>

      {content.kind === 'ready' ? children : null}
      {content.kind === 'loading' ? <p className="merit-empty">Loading.</p> : null}
      {content.kind === 'empty' ? <p className="merit-empty">There is nothing here yet.</p> : null}
      {content.kind === 'error' ? (
        <p className="merit-empty" data-error-kind={content.error}>
          {ERROR_SENTENCE[content.error] ?? ERROR_SENTENCE['unexpected']}
        </p>
      ) : null}

      <footer className="merit-footer">{shell.simulated_environment_disclosure}</footer>
    </div>
  );
}
