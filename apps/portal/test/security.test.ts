import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import type { SessionRow } from '../src/api/types.ts';
import { Security, SecurityUnavailable } from '../src/app/security/sections.ts';
import { GAPS, REQUIRED_ENDPOINTS, readyFrom } from '../src/app/security/source.ts';
import { factorLabel, isRevocable, toSecurityView } from '../src/view/sessions.ts';

// =============================================================================
// SC-M4-11, RENDERED OVER ROWS TRANSCRIBED FROM API_CONTRACT SECTION 3.1
// =============================================================================
// THE THREE FACTORS ARE ALL PRESENT IN THIS FIXTURE ON PURPOSE. `auth_factor` is
// a closed three-member CHECK and `SD-M4-04` makes its membership the
// enforcement of C-27, so a fixture carrying only one member would let a
// rendering that handled one member pass. The SMS row is the one the screen
// exists for: API_CONTRACT says the factor on every row "is what makes a
// SIM-swapped session visible to the person it was taken from".

const SESSIONS: readonly SessionRow[] = [
  {
    id: '0199a1c4-0000-7000-8000-000000000001',
    auth_factor: 'passkey',
    elevated: true,
    created_at: '2026-08-28T08:00:00Z',
    last_seen_at: '2026-08-28T09:30:00Z',
    user_agent_family: 'Chrome on macOS',
    is_current: true,
  },
  {
    id: '0199a1c4-0000-7000-8000-000000000002',
    auth_factor: 'sms_otp',
    elevated: false,
    created_at: '2026-08-27T22:14:00Z',
    last_seen_at: '2026-08-27T22:14:00Z',
    user_agent_family: 'Safari on iOS',
    is_current: false,
  },
  {
    id: '0199a1c4-0000-7000-8000-000000000003',
    auth_factor: 'email_otp',
    elevated: false,
    created_at: '2026-08-26T10:00:00Z',
    last_seen_at: '2026-08-26T10:00:00Z',
    user_agent_family: 'Firefox on Windows',
    is_current: false,
  },
];

function render(sessions: readonly SessionRow[] = SESSIONS): string {
  const view = toSecurityView({ sessions, gaps: GAPS });
  return renderToStaticMarkup(createElement(Security, { view }));
}

describe('ADR-039, and the row that is not on this screen', () => {
  test('there is no password control and no reset link anywhere', () => {
    // MERIT IS PASSWORDLESS IN THE SCHEMA AND NOT MERELY IN THE UI. `0002:280`
    // records that there is no password table anywhere in this schema by design.
    // A SECURITY SCREEN IS EXACTLY WHERE A PASSWORD ROW GETS ADDED WITHOUT
    // THOUGHT, because every other product's security screen has one, so the
    // absence is asserted rather than trusted to a reviewer noticing.
    const html = render().toLowerCase();

    for (const forbidden of [
      'password',
      'passphrase',
      'reset link',
      'change your password',
      'forgot',
      'current password',
      'new password',
    ])
      expect(html, `${forbidden} has no schema behind it (ADR-039, 0002:280)`).not.toContain(
        forbidden,
      );

    // `type="password"` is the specific input a transcribed layout would bring.
    expect(html).not.toContain('type="password"');
  });
});

describe('every active session, with the factor that established it', () => {
  test('every row renders its factor as a word', () => {
    const html = render();

    expect(html).toContain('Passkey');
    expect(html).toContain('SMS OTP');
    expect(html).toContain('Email OTP');

    // And as a token a guard or a stylesheet can key on, without a second
    // vocabulary being invented for it.
    expect(html).toContain('data-factor="passkey"');
    expect(html).toContain('data-factor="sms_otp"');
    expect(html).toContain('data-factor="email_otp"');
  });

  test('the label is derived from the token and changes case, never words', () => {
    // `app/payouts/view.ts`'s `humanise` argument: the label set is the
    // contract's own key set, so changing a label means changing a contract key.
    expect(factorLabel('email_otp')).toBe('Email OTP');
    expect(factorLabel('sms_otp')).toBe('SMS OTP');
    expect(factorLabel('passkey')).toBe('Passkey');
  });

  test('no factor is ranked, marked weak, or called a fallback', () => {
    // `M04:263`: the portal "offers email and SMS as peers rather than as a
    // fallback, because C-01 makes any single factor sufficient and a UI that
    // calls one of them 'fallback' is describing a hierarchy the server does not
    // have". An SMS row here is not an alarm, and marking it one would also be
    // Merit telling a trader their own normal login is a threat.
    const html = render().toLowerCase();

    for (const forbidden of ['weak', 'insecure', 'fallback', 'less secure', 'unsafe', 'warning'])
      expect(html, `${forbidden} describes a hierarchy the server does not have`).not.toContain(
        forbidden,
      );
  });

  test('every row carries what AS-M4-05 counter 2 says a trader recognises it by', () => {
    const html = render();

    // Two of the three. The third, creation IP, is absent from API_CONTRACT
    // section 3.1's `SessionRow` although `SD-M4-03` added `created_ip` to
    // `sessions` for it, and ../src/api/types.ts records the divergence rather
    // than inventing the field onto a response.
    expect(html).toContain('Chrome on macOS');
    expect(html).toContain('Safari on iOS');
    expect(html).toContain('Signed in 2026-08-27T22:14:00Z');
    expect(html).toContain('Last seen 2026-08-28T09:30:00Z');
  });

  test('the raw user agent never reaches this screen', () => {
    // API_CONTRACT: `user_agent_family` is "coarse, never the raw string", which
    // keeps a fingerprint off the response. Nothing here reassembles one.
    const html = render();
    expect(html).not.toContain('Mozilla/5.0');
    expect(html).not.toContain('AppleWebKit');
  });
});

describe('elevation, shown as a state and never as a clock', () => {
  test('an elevated session says so and a non-elevated one says nothing', () => {
    const html = render();
    expect(html).toContain('Confirmed for sensitive actions');

    // One row is elevated in the fixture, so exactly one such label renders.
    expect([...html.matchAll(/Confirmed for sensitive actions/g)]).toHaveLength(1);
  });

  test('no countdown, no expiry and no remaining time appears', () => {
    // SECTION 3.7: the portal "shows that an action is currently available and
    // does not show WHEN IT STOPS BEING AVAILABLE, because a visible countdown
    // is a prompt to hurry and hurrying is the attacker's ally on exactly these
    // three actions." `SD-M4-04` records that the schema has no
    // `elevation_expires_at` either.
    const html = render().toLowerCase();

    for (const forbidden of ['expires', 'remaining', 'countdown', 'minutes left', 'time left'])
      expect(html, `${forbidden} is a prompt to hurry`).not.toContain(forbidden);

    // And the view model carries no clock for a component to render one from.
    const view = toSecurityView({ sessions: SESSIONS, gaps: GAPS });
    expect(JSON.stringify(view)).not.toContain('elevated_at');
    expect(JSON.stringify(view)).not.toContain('expires');
  });
});

describe('revocation', () => {
  test('the current session is labelled and is never offered for revocation', () => {
    // `isRevocable`'s reason: the server would carry out a self-revocation, so
    // the control would sign the trader out while they were looking at the
    // screen they opened to sign somebody ELSE out, which reads as the
    // revocation having failed on the one screen where that must be legible.
    const view = toSecurityView({ sessions: SESSIONS, gaps: GAPS });

    const current = view.sessions.find((session) => session.is_current);
    expect(current).toBeDefined();
    expect(isRevocable(current!)).toBe(false);
    expect(view.sessions.filter(isRevocable)).toHaveLength(2);

    const html = render();
    expect(html).toContain('This device');

    // Two revocable rows, so exactly two controls.
    expect([...html.matchAll(/<button[^>]*>/g)]).toHaveLength(2);
  });

  test('every revoke control is inert, typed null, and says so', () => {
    const view = toSecurityView({ sessions: SESSIONS, gaps: GAPS });
    for (const session of view.sessions) expect(session.revokes_at).toBeNull();

    const html = render();

    // `POST /sessions/:id/revoke` IS REGISTERED AND WIRED and this application
    // has no write verb to call it with. The promise an enabled-but-dead control
    // would make here is the worst one in the product: a trader who believes
    // they have just thrown an attacker out and has not.
    for (const button of [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]))
      expect(button).toContain('disabled=""');

    expect(html).toContain('not available in this build');
    expect(html).not.toContain('<form');
  });

  test('a single-session trader is not told about a limitation that cannot affect them', () => {
    const html = render([SESSIONS[0]!]);

    expect(html).toContain('This device');
    expect(html).not.toContain('not available in this build');
    expect([...html.matchAll(/<button[^>]*>/g)]).toHaveLength(0);
  });
});

describe('the two requirements no wired endpoint serves', () => {
  test('the phone and the ceremony are named rather than omitted', () => {
    // `app/payouts/source.ts`'s precedent for naming what a screen failed to get
    // rather than assuming. A screen that silently dropped the phone section
    // would be indistinguishable from one that had decided the trader has none.
    const html = render();

    expect(html).toContain('data-endpoint="GET /me"');
    expect(html).toContain('data-endpoint="GET /phone/change"');
    expect(html).toContain('verified phone number');
    expect(html).toContain('withdrawal hold lifts');
  });

  test('the gap list is data, so unblocking a backend deletes an entry', () => {
    expect(GAPS.map((gap) => gap.endpoint)).toEqual(['GET /me', 'GET /phone/change']);

    // An empty list renders no section at all rather than an empty heading.
    const view = toSecurityView({ sessions: SESSIONS, gaps: [] });
    const html = renderToStaticMarkup(createElement(Security, { view }));
    expect(html).not.toContain('Not shown yet');
  });
});

describe('the unavailable arm', () => {
  test('it never renders an empty list, because an empty list is a claim', () => {
    // ON THIS SCREEN AN EMPTY LIST SAYS "you are signed in nowhere else", and
    // that is the claim a trader came here to check. Getting it wrong in the
    // reassuring direction is the failure this arm exists to prevent.
    const html = renderToStaticMarkup(
      createElement(SecurityUnavailable, { missing: [...REQUIRED_ENDPOINTS] }),
    );

    expect(html).toContain('GET /sessions');
    expect(html).toContain('cannot tell you where you are signed in');
    expect(html).not.toContain('merit-sessions__list');
  });

  test('readyFrom defaults its gaps to the measured list', () => {
    const loaded = readyFrom({ sessions: SESSIONS });
    expect(loaded.kind).toBe('ready');
    if (loaded.kind !== 'ready') throw new Error('unreachable');
    expect(loaded.view.gaps).toEqual(GAPS);
    expect(loaded.view.sessions).toHaveLength(3);
  });
});
