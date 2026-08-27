// =============================================================================
// apps/portal/src/app/calendar/screen-frame.tsx
// =============================================================================
// THE SCREEN'S OWN FRAME, INSIDE CHROME THE ROOT LAYOUT OWNS.
//
// -----------------------------------------------------------------------------
// THIS FILE USED TO RENDER THE BAND AND THE FOOTER, AND IT NO LONGER MAY
// -----------------------------------------------------------------------------
// It was written while `src/app/layout.tsx` did not exist, when nothing in the
// tree had ever drawn a `ShellView` and ADR-068 requirement 4 and INV-M4-09 were
// types rather than pixels. Session 250 landed the root layout and it draws
// both, around every page in this application:
//
//   <ImpersonationBand view={shell.impersonation} />
//   <main>{children}</main>
//   <footer data-testid="simulated-environment-disclosure">...</footer>
//
// App Router renders that file around every route in this app, so a second band
// and a second disclosure emitted here would not be defence in depth. They would
// be TWO disclosures on one screen, and the layout's own header gives the reason
// the first one is sufficient: "there is nowhere for a screen to render that is
// outside this file."
//
// SO THE CHROME IS GONE FROM HERE AND THE OBLIGATIONS ARE NOT WEAKENED, they
// moved to the file that can actually guarantee them. A frame that kept its own
// copy would make INV-M4-09 a thing two files do, which is the shape that ends
// with each believing the other has it.
//
// -----------------------------------------------------------------------------
// WHAT IT STILL OWNS, AND WHY THAT IS NOT THE LAYOUT'S
// -----------------------------------------------------------------------------
// The CONTENT STATE and the screen's own title. `shell/app-shell.ts` splits them
// exactly this way and the layout's header says so in its own words: `content`
// is "the SCREEN's: a page decides whether it is showing data, an empty set, a
// spinner or an error", and the layout can only assert `ready` because App
// Router renders it around `children` and nothing more.
//
// `empty` STAYS A STATE AND NOT A ZERO-LENGTH `ready`, per `app-shell.ts`: "a
// calendar with nothing scheduled and a calendar nobody loaded" must not look
// alike, which is section 3.8's argument arriving one level up.
//
// -----------------------------------------------------------------------------
// NO ROUTE HANDLER, NO SERVER ACTION, NO OPERATOR PATH
// -----------------------------------------------------------------------------
// ADR-083 section 3 and ADR-095 ruling 3. Nothing here submits anything, and the
// segment holds no file with a `route` stem.

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
  /**
   * The shell, for its `content` field and for nothing else.
   *
   * IT IS STILL THE WHOLE `ShellView` AND NOT A BARE `ContentState`, which is a
   * deliberate refusal to narrow. `toShellView` is the one constructor, and a
   * screen that took a loose `ContentState` could be handed one nobody built
   * through it. The band and the disclosure travel on this object and are
   * rendered by the layout; this file reads `content` and leaves them alone.
   */
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
  const { content } = shell;
  return (
    <div className="merit-screen" data-content-state={content.kind}>
      <style>{SEGMENT_STYLES}</style>

      <h1>{title}</h1>

      {content.kind === 'ready' ? children : null}
      {content.kind === 'loading' ? <p className="merit-empty">Loading.</p> : null}
      {content.kind === 'empty' ? <p className="merit-empty">There is nothing here yet.</p> : null}
      {content.kind === 'error' ? (
        <p className="merit-empty" data-error-kind={content.error}>
          {ERROR_SENTENCE[content.error] ?? ERROR_SENTENCE['unexpected']}
        </p>
      ) : null}
    </div>
  );
}
