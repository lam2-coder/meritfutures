// =============================================================================
// apps/portal/src/app/page.tsx
// =============================================================================
// THE ROOT SCREEN, AND WHAT IT RENDERS IS THE ONLY THING THAT IS TRUE TODAY.
//
// -----------------------------------------------------------------------------
// WHY THIS PAGE INVENTS NO ACCOUNT
// -----------------------------------------------------------------------------
// M04's governing sentence is "render exactly what the engine computed, never
// recompute it, and never round it", and M04 section 1.1 makes this app one
// "consuming `/api/v1` and nothing else". There is no API client in this app and
// no `/api/v1` to call: `apps/portal/src/index.ts` records that "everything that
// changes anything is absent, and deliberately", and SC-M4-01, the auth surface,
// is money path and belongs to its own session under ADR-003.
//
// So a root page showing a balance, a gate or a payout would be showing a number
// this app did not receive, on the one product whose entire promise is that it
// never does that. The state that IS true with no session is the one this page
// renders, and it is computed rather than typed: `toPortalErrorKind(401)` maps
// the status API_CONTRACT specifies for an unauthenticated read onto the
// portal's own error vocabulary.
//
// -----------------------------------------------------------------------------
// WHY THE VOCABULARY IS RENDERED BESIDE IT
// -----------------------------------------------------------------------------
// INV-M4-07 is a WORDING rule -- "cross-trader resource access returns `404`,
// and the portal renders it as 'not found', not 'forbidden'" -- and
// `shell/app-shell.ts` enforces it by having no `forbidden` member for a `403`
// to be mapped onto. A rule about words is worth showing as words. The rows
// below are `toPortalErrorKind` run over the statuses the contract names, so
// `403` landing on `unexpected` is visible on a screen rather than asserted in a
// comment, which is the shape section 9.2 wants: a `403` on a read surface is
// FM-M4-10 firing and not a state with its own copy.
//
// Five calls into one module is a thin proof and it is an HONEST one. The wider
// screens are section 3.1's and each belongs to the segment that owns its route.

import { toPortalErrorKind, toShellView } from '../shell/app-shell.ts';
import type { PortalErrorKind } from '../shell/app-shell.ts';

/**
 * The statuses API_CONTRACT section 12 names on a read surface, plus the one it
 * refuses to name.
 *
 * `403` IS IN THIS LIST ON PURPOSE. It is what the vocabulary declines to have
 * a word for, and a list that left it out would render a mapping that looks
 * complete and hides the only interesting row.
 */
const CONTRACT_STATUSES = [401, 404, 429, 503] as const;

/** What the portal says when it has no session to read anything with. */
const UNAUTHENTICATED: PortalErrorKind = toPortalErrorKind(401);

export default function PortalIndex() {
  const shell = toShellView({
    impersonation: null,
    simulated_environment_disclosure: '',
    content: { kind: 'error', error: UNAUTHENTICATED },
  });

  const state = shell.content.kind === 'error' ? shell.content.error : shell.content.kind;

  return (
    <>
      <h1>Merit</h1>

      <section data-testid="content-state" data-state={state}>
        <h2>No session</h2>
        <p>
          This portal reads <code>/api/v1</code> and nothing else, and there is no session to read
          it with. Sign-in is not built here yet, so the state below is the state that is true
          rather than a screen standing in for one.
        </p>
        <p>
          Content state: <strong>{state}</strong>
        </p>
      </section>

      <section data-testid="error-vocabulary">
        <h2>How this portal words a refusal</h2>
        <p>
          Every row is <code>toPortalErrorKind</code> run over the status on the left. There is no{' '}
          <em>forbidden</em> in the vocabulary, so <code>403</code> has nowhere to land: on a read
          surface a permission refusal is a defect to page on and not a screen to write copy for.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Rendered as</th>
            </tr>
          </thead>
          <tbody>
            {[...CONTRACT_STATUSES, 403].map((status) => (
              <tr key={status}>
                <th scope="row">{status}</th>
                <td>{toPortalErrorKind(status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
