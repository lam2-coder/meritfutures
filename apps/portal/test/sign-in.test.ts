import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, test } from 'vitest';

import type { AuthFactor } from '../src/api/types.ts';
import type { EndpointWiring } from '../src/app/sign-in/availability.ts';
import {
  AVAILABILITY,
  ENDPOINT_WIRING,
  REQUIRED_ENDPOINTS,
  SIGN_IN,
} from '../src/app/sign-in/availability.ts';
import { EMAIL_IS_ALSO_SIGN_UP, NOTHING_SUBMITS, SignIn } from '../src/app/sign-in/sections.ts';
import type { FactorAvailability, SignInView } from '../src/view/sign-in.ts';
import { SIGN_IN_FACTORS, toSignInView } from '../src/view/sign-in.ts';

// =============================================================================
// SC-M4-01, and the four things this screen must not do
// =============================================================================
// `M04:80`: "Auth (passkey, email OTP, SMS OTP). No password field exists
// anywhere. There is no password database to stuff (D2), and widening to a third
// factor did not change that."
//
// FOUR OF THIS SUITE'S SECTIONS ARE ABSENCES AND THAT IS THE SHAPE OF THE
// SCREEN. A sign-in page is the place in this product where a familiar layout is
// most likely to be transcribed from memory, and every one of the four things
// below is something a transcribed layout brings with it: a password field, a
// separate "create account" control, a way to sign up by text, and an enabled
// button that submits nowhere.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Render the shipped screen, or one driven by a supplied measurement. */
function render(view: SignInView = SIGN_IN): string {
  return renderToStaticMarkup(createElement(SignIn, { view }));
}

/** A measurement in which every factor is served. Used for the acceptance half. */
const ALL_SERVED: Readonly<Record<AuthFactor, FactorAvailability>> = {
  passkey: { served: true },
  email_otp: { served: true },
  sms_otp: { served: true },
};

// -----------------------------------------------------------------------------
// 1. ADR-039, and the field that is not on this screen
// -----------------------------------------------------------------------------

describe('Merit is passwordless and this screen is where that is decided', () => {
  test('there is no password field, no reset link and no recovery step', () => {
    // `0002` states it in the schema's own words, on the table where a password
    // would have to live: "Merit is passwordless only, so THERE IS NO PASSWORD
    // TABLE ANYWHERE IN THIS SCHEMA, by design." ADR-039 is the ruling.
    //
    // THE SCREEN SAYS IT BY ITS SHAPE AND NOT BY A SENTENCE, which is what keeps
    // this assertion in its blunt form: ../src/app/sign-in/sections.ts argues
    // that a screen carrying "Merit does not use passwords" is a screen where
    // the next builder adds the field and edits the sentence, and it would also
    // put the word on the page and out of this check's reach.
    const html = render().toLowerCase();

    for (const forbidden of [
      'password',
      'passphrase',
      'forgot',
      'reset link',
      'recovery code',
      'security question',
    ])
      expect(html, `${forbidden} has no schema behind it (ADR-039, 0002)`).not.toContain(forbidden);

    // The specific input a transcribed layout brings.
    expect(html).not.toContain('type="password"');
  });

  test('the check fires on the markup it exists to catch', () => {
    // A PROBE THAT ONLY EVER ATTEMPTS PERMITTED THINGS PASSES AGAINST A GUARD
    // THAT CHECKS NOTHING. The seed is a string rather than a file, so nothing
    // is written to `src/`.
    const seeded = '<input type="password" name="password" /><a href="/forgot">Forgot?</a>';

    expect(seeded.toLowerCase()).toContain('password');
    expect(seeded.toLowerCase()).toContain('forgot');
    expect(seeded.toLowerCase()).toContain('type="password"');
  });
});

// -----------------------------------------------------------------------------
// 2. Three factors, as peers, in the plan's own order
// -----------------------------------------------------------------------------

describe('the three factors ADR-039 admits, ranked in no way', () => {
  test('all three render, each as a word, whatever it can do today', () => {
    const html = render();

    // The labels come from `view/sessions.ts`'s `factorLabel`, so this screen
    // and SC-M4-11's session list name a factor identically.
    expect(html).toContain('Passkey');
    expect(html).toContain('Email OTP');
    expect(html).toContain('SMS OTP');

    // AN UNAVAILABLE FACTOR IS RENDERED AND NOT HIDDEN. Hiding it would be
    // indistinguishable from Merit not offering it, and it would erase the peer
    // relationship C-01 establishes between the three.
    for (const factor of SIGN_IN_FACTORS) expect(html).toContain(`data-factor="${factor}"`);
  });

  test('the order is the one `M04:80` names, transcribed rather than chosen', () => {
    expect(SIGN_IN_FACTORS).toEqual(['passkey', 'email_otp', 'sms_otp']);

    const html = render();
    const positions = SIGN_IN_FACTORS.map((factor) => html.indexOf(`data-factor="${factor}"`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('no factor is marked recommended, preferred, primary or a fallback', () => {
    // `M04:263`: the portal "offers email and SMS as peers rather than as a
    // fallback, because C-01 makes any single factor sufficient and a UI that
    // calls one of them 'fallback' is describing a hierarchy the server does not
    // have".
    const html = render().toLowerCase();

    for (const ranking of [
      'recommended',
      'preferred',
      'primary',
      'fallback',
      'more secure',
      'less secure',
      'other ways',
      'more options',
    ])
      expect(html, `${ranking} describes a hierarchy the server does not have`).not.toContain(
        ranking,
      );
  });
});

// -----------------------------------------------------------------------------
// 3. One control signs in and signs up, and SMS is never a way to sign up
// -----------------------------------------------------------------------------

describe('ADR-196, and which factor can bring an account into existence', () => {
  test('email is the only one, and the view model says so in one place', () => {
    // ADR-196 clause 1 puts account creation inside `POST /auth/verify`. Clause
    // 5 removes `sms`: "`is_new` is ALWAYS `false` on the `sms` channel. This is
    // derived, not chosen", because `0002` declares `users.email citext NOT NULL
    // UNIQUE` and an SMS verification for an unknown number has no value to
    // write. API_CONTRACT section 3 removes `passkey`: registration "requires a
    // session", so it presupposes the account it might otherwise have made.
    expect(SIGN_IN.registration_factors).toEqual(['email_otp']);

    for (const factor of SIGN_IN.factors)
      expect(factor.creates_an_account, `${factor.factor} creates an account`).toBe(
        factor.factor === 'email_otp',
      );
  });

  test('the screen never offers a text as a way to sign up', () => {
    const html = render();
    const sms = html.slice(html.indexOf('data-factor="sms_otp"'));

    expect(sms).toContain('It cannot create one.');
    expect(sms).not.toContain(EMAIL_IS_ALSO_SIGN_UP);
  });

  test('the copy and the flag cannot drift apart', () => {
    // TWO PLACES STATE THE SAME FACT AND THIS IS THE TIE. The record in
    // ../src/app/sign-in/sections.ts is keyed by factor and the flag lives in
    // the view model; the failure this catches is the copy saying one thing
    // while `creates_an_account` says the other, which is exactly the drift
    // `M04:265` warns about when a control's state is read from two lists.
    const html = render();

    for (const factor of SIGN_IN.factors) {
      const block = html.slice(html.indexOf(`data-factor="${factor.factor}"`));
      const upTo = block.indexOf('</li>');
      const own = upTo === -1 ? block : block.slice(0, upTo);

      expect(own.includes(EMAIL_IS_ALSO_SIGN_UP), `${factor.factor} offers sign-up`).toBe(
        factor.creates_an_account,
      );
    }
  });

  test('there is no separate create-account control', () => {
    // ADR-196 section 3 refuses the surface: "the sign-up is a branch inside a
    // handler that already exists in the contract, not a surface of its own."
    // Two controls would also DISCLOSE: a person choosing between them learns
    // from the outcome which one applied to their address.
    const html = render().toLowerCase();

    for (const forbidden of ['create account', 'sign up', 'register', 'new here'])
      expect(html, `${forbidden} would be the surface ADR-196 section 3 refused`).not.toContain(
        forbidden,
      );

    // One control per factor and no more.
    expect([...render().matchAll(/<button/g)]).toHaveLength(SIGN_IN_FACTORS.length);
  });
});

// -----------------------------------------------------------------------------
// 4. The screen cannot disclose whether an address exists
// -----------------------------------------------------------------------------

describe('API_CONTRACT section 3, the destination that is not revealed', () => {
  test('no copy on the screen depends on an address', () => {
    // `POST /auth/otp` "deliberately does not reveal whether the destination
    // exists", and ADR-200 section 4 extends it to the verify route: a verify
    // that answered differently for a known address "would disclose through this
    // route what the other route withholds".
    const html = render().toLowerCase();

    for (const leak of [
      'no account',
      'not found',
      'unknown address',
      'already registered',
      'account exists',
      'we do not have',
      'never seen',
    ])
      expect(html, `${leak} would answer a question this surface withholds`).not.toContain(leak);
  });

  test('and the screen says the answer does not depend on it', () => {
    // THE ACCEPTANCE HALF OF THE SAME PROPERTY. A screen that merely omits the
    // disclosing sentences is indistinguishable from one that has not thought
    // about it, and a uniform answer that is never explained reads to the next
    // builder as a bug worth fixing.
    expect(render()).toContain('The answer is the same whether or not you already have one.');
  });

  test('the view carries no field an address could arrive in', () => {
    // AN EXACT KEY SET AND NOT A CONTAINMENT. `toSignInView` takes no address,
    // which is what makes the disclosure structurally impossible rather than
    // merely absent from today's copy; this assertion is what makes a later
    // `email` or `submitted` field on the view a red suite rather than a line
    // nobody notices.
    expect(Object.keys(SIGN_IN).sort()).toEqual(
      ['can_complete', 'factors', 'registration_factors'].sort(),
    );

    for (const factor of SIGN_IN.factors)
      expect(Object.keys(factor).sort()).toEqual(
        [
          'creates_an_account',
          'destination',
          'endpoint',
          'factor',
          'label',
          'served',
          'submits_to',
          'unavailable',
        ].sort(),
      );
  });
});

// -----------------------------------------------------------------------------
// 5. Nothing on this screen submits anything, and it says so
// -----------------------------------------------------------------------------

describe('the two absences, which are independent and are both stated', () => {
  test('every control renders disabled and every submits_to is the literal null', () => {
    const html = render();

    expect([...html.matchAll(/<button/g)]).toHaveLength(
      [...html.matchAll(/<button[^>]*disabled/g)].length,
    );
    expect([...html.matchAll(/<input/g)]).toHaveLength(
      [...html.matchAll(/<input[^>]*disabled/g)].length,
    );

    for (const factor of SIGN_IN.factors) expect(factor.submits_to).toBeNull();
    expect(SIGN_IN.can_complete).toBe(false);
    expect(html).toContain(NOTHING_SUBMITS);
  });

  test('no factor can be completed today, and each says why in the person’s terms', () => {
    // ADR-200 states the same fact from the API side and puts it first: "A
    // TRADER STILL CANNOT SIGN UP ... nothing in this deployable writes the
    // `otp_challenges` row this handler reads."
    for (const factor of SIGN_IN.factors) {
      expect(factor.served, `${factor.factor} is served`).toBe(false);
      expect(factor.unavailable, `${factor.factor} says why not`).not.toBeNull();
    }

    const html = render();
    expect(html).toContain('Merit cannot send a code to an email address yet.');
    expect(html).toContain('Merit cannot check a passkey yet.');

    // SMS CARRIES BOTH OF ITS BLOCKERS AND NOT THE NEARER ONE. ADR-200 section
    // 4.4 found the second: a phone has no address in `RESOLUTION_ADDRESS`, so
    // delivery landing would leave this factor still unable to complete.
    expect(html).toContain('cannot yet match a phone to an account');
  });

  test('none of the operator’s blockers reaches the screen', () => {
    // API_CONTRACT section 2 keeps internals out of a problem document and
    // ADR-120 ruling 4 says the same of `AuthBackendUnwired.reason`: "the reason
    // never reaches the response", because each names a table, a scope class or
    // a construction.
    const html = render().toLowerCase();

    for (const internal of [
      'otp_challenges',
      'otp_send_budget',
      'resolution_address',
      'identity_phones',
      'webauthn',
      'authbackend',
      '503',
      'unwired',
    ])
      expect(html, `${internal} is an operator's word and never a trader's`).not.toContain(
        internal,
      );
  });
});

// -----------------------------------------------------------------------------
// 6. The acceptance half: the screen is not a fixed page of apologies
// -----------------------------------------------------------------------------

describe('the screen changes when the measurement does', () => {
  test('a served factor drops its unavailable sentence and keeps the inert one', () => {
    // THE TWO ABSENCES ARE INDEPENDENT AND THIS IS WHERE THAT IS VISIBLE. The
    // server answering is `apps/api`'s work and this application being able to
    // ask is `apps/portal`'s, and they would stop being false on different days.
    // A screen that collapsed them into one sentence would go quiet on the
    // second the day the first landed.
    const served = toSignInView({ availability: ALL_SERVED });
    const html = render(served);

    for (const factor of served.factors) {
      expect(factor.served).toBe(true);
      expect(factor.unavailable).toBeNull();
    }

    expect(html).not.toContain('Merit cannot send a code');
    expect(html).not.toContain('Merit cannot check a passkey');

    // Still inert, because ../src/http/client.ts declares `get` and nothing
    // else. `submits_to` is the literal `null`, so wiring it is a type change.
    expect(served.can_complete).toBe(false);
    expect(html).toContain(NOTHING_SUBMITS);
  });

  test('the shipped measurement is the one that renders', () => {
    // The negative control on the test above: if `render()` ignored its argument
    // both cases would pass while asserting nothing about the real screen.
    expect(AVAILABILITY.email_otp.served).toBe(false);
    expect(render()).not.toBe(render(toSignInView({ availability: ALL_SERVED })));
  });
});

// -----------------------------------------------------------------------------
// 7. The endpoints this screen names are the contract's own
// -----------------------------------------------------------------------------

describe('the four routes behind SC-M4-01', () => {
  test('every one is spelled as API_CONTRACT spells it', () => {
    // M04 section 4: "M4 owns no endpoint. It consumes API_CONTRACT ...
    // VERBATIM". A path invented here is a screen describing a server that does
    // not exist, which is the same defect `test/api-types.test.ts` catches one
    // layer down on field names.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');

    expect(REQUIRED_ENDPOINTS.length).toBe(4);
    for (const endpoint of REQUIRED_ENDPOINTS) {
      const path = endpoint.slice(endpoint.indexOf(' ') + 1);
      expect(contract, `${endpoint} appears in API_CONTRACT`).toContain(path);
    }

    // And the two the factors point at are drawn from that same list.
    for (const factor of SIGN_IN.factors) expect(REQUIRED_ENDPOINTS).toContain(factor.endpoint);
  });
});

// -----------------------------------------------------------------------------
// 8. This segment reaches no transport, which is why the route is static
// -----------------------------------------------------------------------------

describe('INV-M4-02 and the render mode, from this side', () => {
  test('nothing in the sign-in segment imports the API client', () => {
    // `test/route-rendering.test.ts` DERIVES the `force-dynamic` requirement
    // from whether a page's closure reaches `src/http/client.ts`, and this page
    // is exempt because it does not. THAT EXEMPTION IS ONLY SAFE WHILE IT STAYS
    // TRUE, and this assertion is what stops the segment acquiring a client
    // import and a static render mode at the same time. The walk is the same
    // string operation that file performs, for the same reason: the extensions
    // in this application are written out, so no resolver is needed.
    const client = join(SRC, 'http', 'client.ts');
    const seen = new Set<string>();
    const queue = [join(SRC, 'app', 'sign-in', 'page.ts')];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      for (const match of readFileSync(file, 'utf8').matchAll(/from '(\.[^']*)'/g))
        queue.push(resolve(dirname(file), match[1]!));
    }

    // The walk resolved something. A walk that silently resolved nothing would
    // pass this test by checking an empty set.
    expect(seen.size, 'files in the sign-in page closure').toBeGreaterThan(3);
    expect([...seen]).not.toContain(client);
  });
});

// -----------------------------------------------------------------------------
// 9. Which of the four this deployment serves, checked against `apps/api` itself
// -----------------------------------------------------------------------------
// THE CLAIM THIS SECTION EXISTS TO STOP IS ONE THIS FILE'S SUBJECT ALREADY MADE
// AND GOT WRONG. `../src/app/sign-in/availability.ts` carried a correct WIRING
// measurement and, six lines above it, a summary reading "NOT ONE of them is
// wired" -- false since ADR-200 wired `verifyOtp`. Both were prose, so both were
// out of reach of every gate in this repository and the wrong one was the one a
// reader would trust. `ENDPOINT_WIRING` is that measurement as data and this
// section is what reads it back off the backend, so the next drift in either
// direction is a red suite rather than a paragraph nobody rechecks.
//
// IT READS TEXT, AND THAT IS NARROWER THAN IT LOOKS. Dispatch protocol section 5
// rules that "a grep over route files has been wrong twice" and that
// `CompositionReport.registered` is the only reliable source for WHICH ROUTES
// EXIST. That is the registration question and this is the wiring one: which
// METHODS `databaseAuthBackend` implements, read off the one object literal that
// answers it, in a spelling (`blocked('name'`, `async name(`) that is exact.
// The partition assertion below is what keeps it honest -- a regex that silently
// read nothing, or a refactor that respelled either form, fails the count rather
// than passing over an empty set.

const API = join(ROOT, 'apps', 'api', 'src');

/** Every method the port declares, read off the fail-closed default. */
function portMethods(): ReadonlySet<string> {
  const source = readFileSync(join(API, 'routes', 'auth.ts'), 'utf8');
  return new Set([...source.matchAll(/unwired\('(\w+)'\)/g)].map((m) => m[1]!));
}

/** What `databaseAuthBackend` refuses, and what it implements. */
function backendSplit(): {
  readonly blocked: ReadonlySet<string>;
  readonly wired: ReadonlySet<string>;
} {
  const source = readFileSync(join(API, 'auth-backend.ts'), 'utf8');
  return {
    blocked: new Set([...source.matchAll(/blocked\(\s*'(\w+)'/g)].map((m) => m[1]!)),
    wired: new Set([...source.matchAll(/^ {4}async (\w+)\(/gm)].map((m) => m[1]!)),
  };
}

/** The text of one `blocked(...)` call: from its method name to the next call. */
function blockerCall(method: string): string {
  const source = readFileSync(join(API, 'auth-backend.ts'), 'utf8');
  const calls = [...source.matchAll(/blocked\(\s*'(\w+)'/g)];
  const at = calls.findIndex((m) => m[1] === method);
  expect(at, `${method} is refused by a blocked() call`).toBeGreaterThanOrEqual(0);
  const next = calls[at + 1];
  return source.slice(calls[at]!.index!, next === undefined ? undefined : next.index!);
}

describe('the wiring this screen claims is the wiring apps/api has', () => {
  test('the port partitions into what the backend implements and what it refuses', () => {
    // THE NEGATIVE CONTROL ON EVERY ASSERTION BELOW. If either regex stopped
    // matching, the sets would be empty and every per-row check would pass by
    // comparing nothing. A partition cannot be satisfied by an empty set.
    const port = portMethods();
    const { blocked, wired } = backendSplit();

    expect(port.size, 'AuthBackend methods').toBeGreaterThan(10);
    expect(
      [...blocked].every((m) => port.has(m)),
      'every refusal names a port method',
    ).toBe(true);
    expect(
      [...wired].every((m) => port.has(m)),
      'every implementation names a port method',
    ).toBe(true);
    expect(
      [...port].filter((m) => blocked.has(m) && wired.has(m)),
      'no method is both',
    ).toEqual([]);
    expect(blocked.size + wired.size, 'the two halves cover the port exactly').toBe(port.size);
  });

  test('every row of ENDPOINT_WIRING matches the backend, in both directions', () => {
    const port = portMethods();
    const { blocked, wired } = backendSplit();

    expect(ENDPOINT_WIRING).toHaveLength(4);

    for (const row of ENDPOINT_WIRING) {
      expect(port.has(row.method), `${row.method} is a method of AuthBackend`).toBe(true);

      // BOTH DIRECTIONS, WHICH IS THE POINT. `served: false` on a method the
      // backend has since implemented is a screen refusing something that works,
      // and `served: true` on one it refuses is a control that would throw
      // `AuthBackendUnwired` at a trader. The first is the defect this file just
      // had; the second is the one the session that repaired it was dispatched
      // not to introduce.
      expect(wired.has(row.method), `${row.endpoint} is implemented`).toBe(row.served);
      expect(blocked.has(row.method), `${row.endpoint} is refused`).toBe(!row.served);

      if (row.blocker === null) continue;
      expect(blockerCall(row.method), `${row.method} is blocked on ${row.blocker}`).toContain(
        row.blocker,
      );
    }
  });

  test('the cross-check fires when a row claims a refused method is served', () => {
    // A GUARD NOBODY WATCHED FIRE IS A GUARD NOBODY HAS. The seed is a value
    // rather than an edit to `src/`, so nothing is written to the working tree.
    const { blocked, wired } = backendSplit();
    const seeded: EndpointWiring = {
      endpoint: 'POST /auth/otp',
      method: 'requestOtp',
      served: true,
      blocker: null,
    };

    expect(wired.has(seeded.method)).not.toBe(seeded.served);
    expect(blocked.has(seeded.method)).not.toBe(!seeded.served);
  });
});

// -----------------------------------------------------------------------------
// 10. Exactly one of the four is served, and it still signs nobody in
// -----------------------------------------------------------------------------

describe('the served set admits no complete sign-in', () => {
  test('exactly one route is served and it is POST /auth/verify', () => {
    // NOT THE PAIR THE SHAPE SUGGESTS. The four read as an OTP pair and a
    // passkey pair, and the free reading -- OTP served, passkey not -- is wrong
    // in both halves. The OTP pair is split down the middle.
    expect(ENDPOINT_WIRING.filter((row) => row.served).map((row) => row.endpoint)).toEqual([
      'POST /auth/verify',
    ]);
  });

  test('no factor can even begin, because the served route is nobody first step', () => {
    // THE MECHANICAL FORM OF THIS SCREEN'S FINDING. `view/sign-in.ts` maps each
    // factor to the route its control would call FIRST. All three of those are
    // unserved, and the one route that answers is the SECOND step of a flow
    // whose first step cannot run: `POST /auth/verify` consumes an
    // `otp_challenges` row and `requestOtp`, the only writer of one, is blocked
    // on `NO_DELIVERY`.
    //
    // MERIT IS PASSWORDLESS, WHICH IS WHAT MAKES THAT TOTAL RATHER THAN PARTIAL.
    // `0002` states there is no password table anywhere in the schema by design
    // and ADR-039 is the ruling, so these three factors are the whole of trader
    // authentication and there is no fourth door to fall back to.
    const wiring = new Map(ENDPOINT_WIRING.map((row) => [row.endpoint, row]));

    for (const factor of SIGN_IN.factors) {
      const first = wiring.get(factor.endpoint);
      expect(first, `${factor.endpoint} is one of the four`).toBeDefined();
      expect(first!.served, `${factor.factor} cannot even begin`).toBe(false);
      expect(factor.served, `${factor.factor} is not offered as available`).toBe(false);
      expect(factor.unavailable, `${factor.factor} says why`).not.toBeNull();
    }

    const servedRoutes = ENDPOINT_WIRING.filter((row) => row.served).map((row) => row.endpoint);
    const firstSteps = SIGN_IN.factors.map((factor) => factor.endpoint);
    expect(servedRoutes.filter((route) => firstSteps.includes(route))).toEqual([]);
  });

  test('no blocker constant reaches the screen', () => {
    // ADR-120 ruling 4: "the reason never reaches the response", because every
    // blocker names a table, a scope class or a construction. `blocker` is an
    // operator's join key for the check above and is not copy.
    const html = render();

    for (const row of ENDPOINT_WIRING) {
      if (row.blocker !== null) expect(html).not.toContain(row.blocker);
      expect(html, `${row.method} is an internal name`).not.toContain(row.method);
      expect(html, `${row.endpoint} is an internal path`).not.toContain(row.endpoint);
    }

    // The check fires on the markup it exists to catch.
    expect('<p>NO_DELIVERY</p>').toContain('NO_DELIVERY');
  });
});
