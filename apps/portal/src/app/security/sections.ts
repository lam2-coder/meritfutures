// =============================================================================
// apps/portal/src/app/security/sections.ts
// =============================================================================
// THE ELEMENT TREE FOR SC-M4-11. Every component is a pure function from a view
// model built in ../../view/sessions.ts to a React element.
//
// -----------------------------------------------------------------------------
// THERE IS NO PASSWORD ROW HERE AND THERE IS NO RESET LINK
// -----------------------------------------------------------------------------
// MERIT IS PASSWORDLESS IN THE SCHEMA AND NOT MERELY IN THE UI. `0002:280`
// records that there is no password table anywhere in this schema by design,
// ADR-039 is the ruling, and `M04:80` states the consequence for the auth screen
// one row up: "No password field exists anywhere. There is no password database
// to stuff (D2)."
//
// A SECURITY SCREEN IS EXACTLY WHERE A PASSWORD ROW GETS ADDED WITHOUT THOUGHT,
// because every other product's security screen has one and a builder
// transcribing a familiar layout would add it before noticing. So the absence is
// asserted rather than trusted: `test/security.test.ts` renders this tree and
// fails on the words a password control would have to carry.
//
// -----------------------------------------------------------------------------
// THE FACTOR AND THE REVOKE CONTROL ARE ON THE SAME ROW
// -----------------------------------------------------------------------------
// `M04:185`: what a SIM-swapped session still sees is everything, that is C-27's
// priced trade, "and the trader's own defence is SC-M4-11's session list, WHICH
// IS WHY REVOCATION IS ON THE SAME SCREEN AS THE FACTOR THAT ESTABLISHED THE
// SESSION". This file puts them on the same ROW, one step further, because a
// trader recognises a session by its factor and its device and disowns it in one
// movement, and splitting them adds a step to the only action that matters here.
//
// -----------------------------------------------------------------------------
// AND NO ROW IS STYLED AS AN ALARM
// -----------------------------------------------------------------------------
// `M04:265`: the portal "offers email and SMS as peers rather than as a
// fallback, because C-01 makes any single factor sufficient and a UI that calls
// one of them 'fallback' is describing a hierarchy the server does not have."
// An SMS row here is not marked suspicious and a passkey row is not marked safe:
// every row carries its factor as a word, and the trader decides which ones they
// recognise. Marking one factor as dangerous would also be Merit telling a
// trader their own normal login is a threat, on the screen where a real threat
// has to stand out.
//
// THIS SEGMENT SHIPS NO WIDTH, NO COLUMN, NO GRID AND NO FIXED DIMENSION, which
// is `app/payouts/sections.ts`'s FM-M4-08 argument: a screen with no layout
// cannot have a layout bug, and semantic blocks in normal flow are single-column
// at every viewport.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import { isRevocable } from '../../view/sessions.ts';
import type { ActiveSessionView, SecurityGap, SecurityView } from '../../view/sessions.ts';

const el = createElement;

/**
 * The sentence an inert control carries.
 *
 * `POST /sessions/:id/revoke` IS REGISTERED AND WIRED AND THIS APPLICATION
 * CANNOT CALL IT, because ../../http/client.ts's `ApiClient` declares `get` and
 * nothing else (./source.ts carries the measurement and the refusal). The
 * control renders and is disabled.
 *
 * SAYING SO IS NOT OPTIONAL ON THIS SCREEN. `app/payouts/view.ts`'s rule is that
 * "an enabled control that silently does nothing is a promise to a trader that
 * the code cannot keep", and the promise this particular control would make is
 * the worst one in the product: a trader who believes they have just thrown an
 * attacker out of their account and has not.
 */
const REVOKE_UNAVAILABLE = 'Sign-out of other sessions is not available in this build.';

/**
 * One session, with everything `AS-M4-05` counter 2 says a trader needs to
 * "recognise or disown it".
 *
 * THREE OF THE FOUR FIELDS ARE HERE AND THE FOURTH IS ABSENT FROM THE CONTRACT.
 * Counter 2 promises "every active session with its creation IP, user agent, and
 * last-seen time", and `SD-M4-03` added `created_ip inet` to `sessions` to serve
 * it; API_CONTRACT section 3.1's `SessionRow` carries no IP field at all.
 * ../../api/types.ts transcribes the contract, as M04 section 4 binds it to, and
 * the divergence between two approved documents is reported rather than closed
 * by inventing a field onto a response.
 *
 * AND `last_seen_at` EQUALS `created_at` ON EVERY ROW IN THIS TREE, which this
 * screen cannot detect and a trader cannot either. `apps/api/src/auth-backend.ts`
 * says why in its own comment -- "NOTHING STAMPS `last_seen_at` IN THIS TREE" --
 * and prices the repair as a write on the hottest path the API has. It is
 * ADR-120's owed ruling and it lands on this screen: last-seen is one of the
 * three things counter 2 says a trader recognises a session by, and it is
 * currently the one that carries no information.
 */
export function Session({ session }: { readonly session: ActiveSessionView }): ReactElement {
  return el(
    'li',
    {
      className: 'merit-session',
      'data-factor': session.factor,
      'data-current': String(session.is_current),
    },
    // The device, coarse at the server. The portal never receives the raw
    // user-agent string, which is API_CONTRACT's own "coarse, never the raw
    // string" and keeps a fingerprint off this response.
    el('span', { className: 'merit-session__agent' }, session.user_agent_family),

    // The establishing factor, as a word. API_CONTRACT: it "is what makes a
    // SIM-swapped session visible to the person it was taken from".
    el('span', { className: 'merit-session__factor' }, session.factor_label),

    el('span', { className: 'merit-session__created' }, `Signed in ${session.created_at}`),
    el('span', { className: 'merit-session__last-seen' }, `Last seen ${session.last_seen_at}`),

    // Elevation as a state and never as a countdown. Section 3.7: the portal
    // "shows that an action is currently available and does not show when it
    // stops being available, because a visible countdown is a prompt to hurry
    // and hurrying is the attacker's ally on exactly these three actions."
    session.elevated
      ? el('span', { className: 'merit-session__elevated' }, 'Confirmed for sensitive actions')
      : null,

    session.is_current
      ? // THE CURRENT SESSION IS LABELLED AND IS NOT OFFERED FOR REVOCATION.
        // ../../view/sessions.ts's `isRevocable` carries the reason: the server
        // would carry out a self-revocation, so the control would sign the
        // trader out while they were looking at the screen they opened to sign
        // somebody else out, and that reads as the revocation having failed.
        el('span', { className: 'merit-session__current' }, 'This device')
      : el(
          'button',
          { type: 'button', disabled: true, className: 'merit-session__revoke' },
          'Sign out this session',
        ),
  );
}

/** Every live session, newest first, in the order the server sorted them. */
export function SessionList({
  sessions,
}: {
  readonly sessions: readonly ActiveSessionView[];
}): ReactElement {
  const revocable = sessions.filter(isRevocable);

  return el(
    'section',
    { className: 'merit-sessions', 'aria-labelledby': 'merit-sessions-heading' },
    el('h2', { id: 'merit-sessions-heading' }, 'Where you are signed in'),
    el(
      'ol',
      { className: 'merit-sessions__list' },
      ...sessions.map((session) => el(Session, { key: session.id, session })),
    ),
    // The note is rendered only when there is a control it could describe, so a
    // trader signed in on one device is not told about a limitation that does
    // not affect them.
    revocable.length === 0
      ? null
      : el('p', { className: 'merit-sessions__inert' }, REVOKE_UNAVAILABLE),
  );
}

/**
 * A requirement of this screen that no wired endpoint serves.
 *
 * NAMED RATHER THAN OMITTED, on `app/payouts/source.ts`'s precedent. A screen
 * that silently dropped the phone section would be indistinguishable from one
 * that had decided the trader has no phone, and on a security screen an absence
 * a trader reads as a fact is exactly the wrong kind of quiet.
 */
export function Gap({ gap }: { readonly gap: SecurityGap }): ReactElement {
  return el(
    'li',
    { className: 'merit-security-gap', 'data-endpoint': gap.endpoint },
    el('span', { className: 'merit-security-gap__shows' }, gap.shows),
  );
}

/** SC-M4-11, whole. */
export function Security({ view }: { readonly view: SecurityView }): ReactElement {
  return el(
    'main',
    { className: 'merit-security' },
    el('h1', null, 'Security'),
    el(SessionList, { sessions: view.sessions }),
    view.gaps.length === 0
      ? null
      : el(
          'section',
          { className: 'merit-security-gaps', 'aria-labelledby': 'merit-security-gaps-heading' },
          el('h2', { id: 'merit-security-gaps-heading' }, 'Not shown yet'),
          el(
            'ul',
            { className: 'merit-security-gaps__list' },
            ...view.gaps.map((gap) => el(Gap, { key: gap.endpoint, gap })),
          ),
        ),
  );
}

/**
 * What renders when the session list did not answer.
 *
 * IT DOES NOT RENDER AN EMPTY LIST. On this screen an empty list is a claim --
 * "you are signed in nowhere else" -- and it is the claim a trader came here to
 * check. Getting it wrong in the reassuring direction is the failure this arm
 * exists to prevent.
 */
export function SecurityUnavailable({
  missing,
}: {
  readonly missing: readonly string[];
}): ReactElement {
  return el(
    'main',
    { className: 'merit-security merit-security--unavailable' },
    el('h1', null, 'Security'),
    el(
      'p',
      null,
      'Your sessions cannot be listed right now, so this page cannot tell you where you are signed in. This is a problem on our side.',
    ),
    el(
      'ul',
      { className: 'merit-security__missing' },
      ...missing.map((endpoint) => el('li', { key: endpoint }, endpoint)),
    ),
  );
}
