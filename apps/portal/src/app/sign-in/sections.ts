// =============================================================================
// apps/portal/src/app/sign-in/sections.ts
// =============================================================================
// THE ELEMENT TREE FOR SC-M4-01. Every component is a pure function from the
// view model built in ../../view/sign-in.ts to a React element.
//
// -----------------------------------------------------------------------------
// THE SCREEN SAYS MERIT IS PASSWORDLESS BY ITS SHAPE AND NOT BY A SENTENCE
// -----------------------------------------------------------------------------
// `M04:80`'s SC-M4-01 row is "No password field exists anywhere", `0002` records
// that there is no password table anywhere in the schema by design, and ADR-039
// is the ruling. THE ABSENCE IS THE STATEMENT: there is no field, no link and no
// recovery step, and no sentence here explains why.
//
// EXPLAINING WOULD BE WEAKER, WHICH IS THE PART WORTH WRITING DOWN. A screen
// carrying "Merit does not use passwords" is a screen where the next builder
// adds the field and edits the sentence, and it puts the word on the page that
// every credential-stuffing tool and every phishing template is built around.
// It also makes the blunt form of the assertion impossible:
// `test/sign-in.test.ts` renders this tree and fails on the word itself, which
// is the strongest check available and only stays available while no honest
// sentence needs the word.
//
// WHAT THE SCREEN SAYS INSTEAD IS WHAT A PERSON ACTUALLY NEEDS: that there is
// nothing to remember, and what the three ways in are.
//
// -----------------------------------------------------------------------------
// ONE CONTROL PER FACTOR, THREE FACTORS, NO HIERARCHY
// -----------------------------------------------------------------------------
// `M04:263`: the portal "offers email and SMS as peers rather than as a
// fallback, because C-01 makes any single factor sufficient and a UI that calls
// one of them 'fallback' is describing a hierarchy the server does not have".
// So no factor here is styled primary, marked recommended, put behind a "more
// options" disclosure or given a larger control, and the suite fails on each of
// those words. The order is `M04:80`'s own and ../../view/sign-in.ts carries it.
//
// -----------------------------------------------------------------------------
// AND THERE IS NO SEPARATE "CREATE ACCOUNT" CONTROL
// -----------------------------------------------------------------------------
// ADR-196 section 3 refuses the surface in its own words: "the sign-up is a
// branch inside a handler that already exists in the contract, not a surface of
// its own." Drawing two controls would draw that refused surface, and it would
// disclose: a person choosing between "sign in" and "create account" learns from
// the outcome which one applied to their address, which is exactly what
// API_CONTRACT section 3 withholds when it says `POST /auth/otp` "deliberately
// does not reveal whether the destination exists".
//
// SO THE EMAIL CONTROL SAYS IT IS BOTH, AND SAYS THE ANSWER DOES NOT DEPEND ON
// WHICH ONE YOU ARE. That sentence is the disclosure posture stated to the
// person it protects, and it also stops the next builder reading a uniform
// response as a bug worth fixing.
//
// -----------------------------------------------------------------------------
// SMS IS NEVER OFFERED AS A WAY TO SIGN UP
// -----------------------------------------------------------------------------
// ADR-196 clause 5 and its section 6: `users.email` is `citext NOT NULL UNIQUE`,
// so "a verification arriving on the `sms` channel for an unknown number has no
// value to write" and the `sms` channel "is therefore a LOGIN channel and never
// a registration one". A person who signed up by text would meet a `NOT NULL` as
// a refusal at the end of a flow that had already asked them for a code, so the
// SMS control states the limit before it is reached rather than after.
//
// THIS SEGMENT SHIPS NO WIDTH, NO COLUMN, NO GRID AND NO FIXED DIMENSION, which
// is `app/payouts/sections.ts`'s FM-M4-08 argument: a screen with no layout
// cannot have a layout bug, and semantic blocks in normal flow are single-column
// at every viewport.

import { createElement } from 'react';
import type { ReactElement } from 'react';

import type { SignInFactorView, SignInView } from '../../view/sign-in.ts';

const el = createElement;

/**
 * The lead, and it names no secret because there is none.
 *
 * IT IS ONE SENTENCE ABOUT WHAT HAPPENS AND ONE ABOUT WHAT DOES NOT EXIST TO
 * REMEMBER, in that order, because the second only makes sense after the first.
 */
const LEAD =
  'You sign in with a passkey, or with a one-time code. Merit keeps no secret you have to remember.';

/**
 * What the email control says about being the sign-up too.
 *
 * BOTH HALVES ARE LOAD BEARING. The first is ADR-196 clause 1, which puts
 * account creation inside this exact request. The second is API_CONTRACT section
 * 3's disclosure posture, said to the person it protects: a uniform answer is
 * the design and not a screen that failed to tell them something.
 */
export const EMAIL_IS_ALSO_SIGN_UP =
  'This is also how you create an account. The answer is the same whether or not you already have one.';

/**
 * What each factor is for, one sentence, keyed so the compiler keeps it complete.
 *
 * TWO OF THE THREE SAY THEY CANNOT CREATE AN ACCOUNT AND THEY SAY IT FOR
 * DIFFERENT REASONS. ADR-196 clause 5 for SMS, which is a `NOT NULL` on
 * `users.email` and survives every amount of building; API_CONTRACT section 3
 * for a passkey, whose registration ceremony "requires a session" and so
 * presupposes the account it could otherwise have made.
 *
 * `test/sign-in.test.ts` TIES THIS RECORD TO
 * `SignInFactorView.creates_an_account` rather than trusting the two to agree:
 * exactly the factors flagged true must render {@link EMAIL_IS_ALSO_SIGN_UP},
 * and the drift this catches is the copy saying one thing while the view model
 * says the other.
 */
const SCOPE: Readonly<Record<string, string>> = {
  passkey: 'A passkey is something you add once you are signed in. It cannot create an account.',
  email_otp: EMAIL_IS_ALSO_SIGN_UP,
  sms_otp: 'A text signs you in to an account you already have. It cannot create one.',
};

/**
 * The sentence every control on this screen carries.
 *
 * IT IS A SECOND AND SEPARATE ABSENCE FROM THE PER-FACTOR ONE, and the screen
 * says both rather than the nearer of the two. A person told only "Merit cannot
 * send a code yet" would reasonably expect the passkey button to work.
 * `app/payouts/view.ts`'s rule is the reason it is said at all: "an enabled
 * control that silently does nothing is a promise to a trader that the code
 * cannot keep."
 */
export const NOTHING_SUBMITS = 'No control on this page submits anything in this build.';

/**
 * One factor, with its control and the reason the control is inert.
 *
 * THE CONTROL IS RENDERED AND DISABLED RATHER THAN OMITTED. A factor left off
 * the screen would be indistinguishable from a factor Merit does not offer,
 * which is `app/payouts/source.ts`'s rule about naming what is missing rather
 * than assuming, and here it would also erase the peer relationship C-01
 * establishes between the three.
 *
 * THE FIELD IS DISABLED TOO, WHICH IS THE OPPOSITE OF `M04:173` AND FOR
 * `M04:173`'s OWN REASON. There, an external withdrawal keeps its amount field
 * usable while the submit is disabled, "because a trader who cannot yet submit
 * can still legitimately want to know what they would be withdrawing": typing
 * computes something. Typing an address here computes nothing, so an enabled
 * field would only collect a personal address into a page that can do nothing
 * with it.
 */
export function Factor({ factor }: { readonly factor: SignInFactorView }): ReactElement {
  const inputId = `merit-sign-in-${factor.factor}`;

  return el(
    'li',
    {
      className: 'merit-sign-in__factor',
      'data-factor': factor.factor,
      'data-served': String(factor.served),
    },

    // The factor as a word, in the server's own vocabulary. ../../view/
    // sessions.ts derives the label from the token, so this screen and the
    // session list on SC-M4-11 name a factor identically.
    el('h3', { className: 'merit-sign-in__label' }, factor.label),

    // The destination field, for the two factors the contract gives one. A
    // passkey ceremony takes no address: the authenticator holds the credential,
    // and ../../view/sign-in.ts derives that from API_CONTRACT section 3 rather
    // than letting this file infer it.
    factor.destination === null
      ? null
      : el(
          'p',
          { className: 'merit-sign-in__field' },
          el(
            'label',
            { htmlFor: inputId },
            factor.destination === 'phone' ? 'Phone number' : 'Email address',
          ),
          el('input', {
            id: inputId,
            name: inputId,
            type: factor.destination === 'phone' ? 'tel' : 'email',
            disabled: true,
            autoComplete: factor.destination === 'phone' ? 'tel' : 'email',
          }),
        ),

    el(
      'button',
      { type: 'button', disabled: true, className: 'merit-sign-in__submit' },
      factor.destination === null ? 'Use a passkey' : 'Send a code',
    ),

    // Why this one cannot be completed, in the person's own terms. Never the
    // operator's blocker: API_CONTRACT section 2 and ADR-120 ruling 4.
    factor.unavailable === null
      ? null
      : el('p', { className: 'merit-sign-in__unavailable' }, factor.unavailable),

    el('p', { className: 'merit-sign-in__scope' }, SCOPE[factor.factor]),
  );
}

/** The three factors, in `M04:80`'s order, ranked in no way. */
export function Factors({
  factors,
}: {
  readonly factors: readonly SignInFactorView[];
}): ReactElement {
  return el(
    'section',
    { className: 'merit-sign-in__factors', 'aria-labelledby': 'merit-sign-in-factors-heading' },
    el('h2', { id: 'merit-sign-in-factors-heading' }, 'How you sign in'),
    el(
      'ul',
      { className: 'merit-sign-in__list' },
      ...factors.map((factor) => el(Factor, { key: factor.factor, factor })),
    ),
  );
}

/** SC-M4-01, whole. */
export function SignIn({ view }: { readonly view: SignInView }): ReactElement {
  return el(
    'main',
    { className: 'merit-sign-in', 'data-can-complete': String(view.can_complete) },
    el('h1', null, 'Sign in to Merit'),
    el('p', { className: 'merit-sign-in__lead' }, LEAD),
    el(Factors, { factors: view.factors }),

    // Said once, for the whole screen, and separately from every per-factor
    // reason. See NOTHING_SUBMITS.
    view.can_complete ? null : el('p', { className: 'merit-sign-in__inert' }, NOTHING_SUBMITS),
  );
}
