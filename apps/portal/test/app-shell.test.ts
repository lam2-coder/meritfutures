import { expect, test } from 'vitest';

import type { ImpersonationSession } from '../src/api/types.js';
import type { ContentState } from '../src/shell/app-shell.js';
import { toPortalErrorKind, toShellView } from '../src/shell/app-shell.js';
import { toImpersonationBanner } from '../src/shell/impersonation-banner.js';

// =============================================================================
// ADR-068 requirement 4, INV-M4-07 and INV-M4-09: the shell
// =============================================================================

const SESSION: ImpersonationSession = {
  admin_user_id: 'admin_ops_14',
  subject_identity_id: 'idn_88213',
  reason_code: 'trader_reported_display_issue',
  reason_detail: 'Trader cannot describe what the payout screen shows on their phone.',
  expires_at: '2026-08-21T15:30:00Z',
};

const DISCLOSURE = 'Merit accounts are simulated. No trade reaches a live exchange.';

const ALL_STATES: readonly ContentState[] = [
  { kind: 'ready' },
  { kind: 'loading' },
  { kind: 'empty' },
  { kind: 'error', error: 'not_found' },
];

test('the banner renders on every content state, including error, empty and loading', () => {
  // Section 3.9: "A banner absent from the error page is absent exactly when an
  // operator is somewhere unexpected." The mechanism is that the band is a
  // field of the SHELL rather than of the content, so there is no branch that
  // can drop it.
  const banner = toImpersonationBanner(SESSION);
  for (const content of ALL_STATES) {
    const shell = toShellView({
      impersonation: banner,
      simulated_environment_disclosure: DISCLOSURE,
      content,
    });
    expect(shell.impersonation, `banner present on ${content.kind}`).toEqual(banner);
    expect(shell.simulated_environment_disclosure, `disclosure present on ${content.kind}`).toBe(
      DISCLOSURE,
    );
  }
});

test('there is no dismiss control, and the key set is asserted exactly', () => {
  // "The component takes no `dismissible` prop and no `onDismiss`. THE ABSENCE
  // OF THE PROP IS THE CONTROL... A disabled close button is a close button
  // somebody re-enables."
  //
  // Asserted as an exact key set rather than as five absences, so a sixth way
  // of spelling "close" fails this test too.
  const banner = toImpersonationBanner(SESSION);
  expect(Object.keys(banner).sort()).toEqual([
    'admin_user_id',
    'exit',
    'expires_at',
    'placement',
    'reason_code',
    'reason_detail',
    'subject_identity_id',
  ]);

  for (const forbidden of ['dismissible', 'onDismiss', 'closable', 'hidden', 'collapsed']) {
    expect(banner, `no ${forbidden} prop`).not.toHaveProperty(forbidden);
  }
});

test('the band occupies layout and cannot be promoted to an overlay', () => {
  // "A reserved band in the app shell, never an overlay. Nothing stacks over
  // it, nothing scrolls it away, and no z-index accident can lose it." The
  // literal type is the enforcement; this is its runtime witness.
  expect(toImpersonationBanner(SESSION).placement).toBe('shell-band');
});

test('every field on the band is a column, and the exit is an action rather than a close', () => {
  // Section 3.9: every field is a column on `impersonation_sessions` "rather
  // than a string the portal composes".
  const banner = toImpersonationBanner(SESSION);
  expect(banner.admin_user_id).toBe(SESSION.admin_user_id);
  expect(banner.subject_identity_id).toBe(SESSION.subject_identity_id);
  expect(banner.reason_code).toBe(SESSION.reason_code);
  expect(banner.reason_detail).toBe(SESSION.reason_detail);
  expect(banner.expires_at).toBe(SESSION.expires_at);

  // FOLD-04 section 4.1's explicit exit, which writes ended_at, ended_by and
  // end_reason server side. Ending the session removes the reason the banner
  // exists; dismissing it would leave the session running with nothing on
  // screen to say so.
  expect(banner.exit).toEqual({ action: 'end_impersonation' });
});

test('the expiry is the instant the server declared, and nothing counts down', () => {
  // Section 3.7 refuses a countdown for the elevation window; section 3.9
  // argues for showing THIS box because "an operator surprised by an expiry
  // re-initiates". Both hold if the instant is rendered and no remaining time
  // is computed: "a client that believes the session is live is not evidence
  // that it is."
  const banner = toImpersonationBanner(SESSION);
  expect(banner.expires_at).toBe('2026-08-21T15:30:00Z');
  for (const ticking of ['remaining', 'remaining_seconds', 'expires_in', 'ttl', 'countdown']) {
    expect(banner, `no ${ticking} field`).not.toHaveProperty(ticking);
  }
});

test('a trader session carries no band, and that is a consequence rather than a rule', () => {
  // ADR-068 requirement 7 and section 3.9: IMPERSONATION-C1 refuses a shared
  // token hash in both directions, so an impersonation token can never be the
  // token a trader session carries and "there is no other session the banner
  // could reach". Non-disclosure is the session-type boundary, not a check.
  for (const content of ALL_STATES) {
    const shell = toShellView({
      impersonation: null,
      simulated_environment_disclosure: DISCLOSURE,
      content,
    });
    expect(shell.impersonation).toBeNull();
  }
});

test('INV-M4-07: a cross-trader 404 is not found, and the vocabulary has no forbidden', () => {
  // "Existence is not confirmed to a stranger, and the UI must not undo that by
  // wording." There is no `forbidden` member for a 404 to be mapped onto.
  expect(toPortalErrorKind(404)).toBe('not_found');
  expect(toPortalErrorKind(401)).toBe('unauthenticated');
  expect(toPortalErrorKind(429)).toBe('rate_limited');
  expect(toPortalErrorKind(500)).toBe('server_error');
  expect(toPortalErrorKind(503)).toBe('server_error');
});

test('a 403 on a read surface is unexpected, because it is FM-M4-10 firing', () => {
  // C-27 makes every read surface available to any single factor, so a 403 on a
  // read is not a state with copy: section 9.2 PAGES on it and calls it "a
  // rendering bug until proven otherwise". Naming it would create the forbidden
  // vocabulary INV-M4-07 keeps off the screen, and would make an alertable
  // defect look like a normal page.
  expect(toPortalErrorKind(403)).toBe('unexpected');
  expect(toPortalErrorKind(418)).toBe('unexpected');
  expect(toPortalErrorKind(0)).toBe('unexpected');
});

test('the disclosure is required, so a screen cannot be assembled without it', () => {
  // INV-M4-09 is a compliance obligation rather than a design preference. The
  // compile-time half is that `simulated_environment_disclosure` is a required
  // field; this is the runtime witness that it survives into the shell.
  const shell = toShellView({
    impersonation: null,
    simulated_environment_disclosure: DISCLOSURE,
    content: { kind: 'error', error: 'server_error' },
  });
  expect(shell.simulated_environment_disclosure).toBe(DISCLOSURE);
});
