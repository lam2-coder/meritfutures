// =============================================================================
// apps/portal/src/app/sign-in/availability.ts
// =============================================================================
// WHAT A DEPLOYMENT CAN ACTUALLY SERVE BEHIND SC-M4-01, MEASURED.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE IS NOT CALLED `source.ts`
// -----------------------------------------------------------------------------
// EVERY OTHER SEGMENT'S `source.ts` READS THE WIRE AND THIS SCREEN READS
// NOTHING, so a file called `source.ts` here would put a familiar name on a file
// that does the opposite of what the name promises everywhere else in this
// application.
//
// The reason it reads nothing is not a shortcut. SC-M4-01 is PRE-IDENTITY: a
// person arriving at it has no session, so there is no identity-scoped read to
// perform and API_CONTRACT gives this surface no GET at all. Every endpoint
// behind the screen is a POST, and ../../http/client.ts's `ApiClient` declares
// `get` and nothing else. THE PAGE IS THEREFORE STATIC AND CORRECTLY SO, on
// `app/page.tsx`'s argument: it reads no trader data, and forcing it dynamic
// would assert a requirement it does not have. `test/route-rendering.test.ts`
// DERIVES that exemption rather than listing it, so nothing here has to be
// added to an allowlist and nothing here may quietly acquire a client import.
//
// -----------------------------------------------------------------------------
// REGISTRATION AND WIRING ARE DIFFERENT QUESTIONS, AND THIS SCREEN IS WHERE THE
// DIFFERENCE IS THE WHOLE ANSWER
// -----------------------------------------------------------------------------
// `app/security/source.ts` made this split one screen over and it is sharper
// here: all four routes behind SC-M4-01 are REGISTERED, and NOT ONE of them is
// wired. A grep, or a route table, would report this screen as fully served.
//
// REGISTRATION, measured through `CompositionReport.registered` over a real
// `compose()` (dispatch protocol section 5, "a grep over route files has been
// wrong twice"), on the `public` surface:
//
//   POST /auth/otp                        REGISTERED
//   POST /auth/verify                     REGISTERED
//   POST /auth/passkey/login/options      REGISTERED
//   POST /auth/passkey/login/verify       REGISTERED
//
// WIRING, read from `databaseAuthBackend` in `apps/api/src/auth-backend.ts`,
// which is the backend a deployment installs. Each blocked method rejects with
// `AuthBackendUnwired` and `endpointHandler` in `apps/api/src/routes/auth.ts`
// turns that into `503 service_unavailable` in one place:
//
//   requestOtp            BLOCKED on `NO_DELIVERY`
//   passkeyLoginOptions   BLOCKED on `NO_WEBAUTHN`
//   passkeyLoginVerify    BLOCKED on `NO_WEBAUTHN`
//   verifyOtp             WIRED, and the `sms` arm raises anyway; see below
//
// `apps/api/test/auth-backend.test.ts` asserts that eleven of the sixteen
// methods refuse this way, each with its own reason, so the measurement above is
// a property that suite already holds rather than one this file claims.
//
// -----------------------------------------------------------------------------
// THE THREE BLOCKERS, QUOTED, AND WHAT EACH ONE MEANS ON A SCREEN
// -----------------------------------------------------------------------------
// `NO_DELIVERY`, which is the one that decides this whole screen:
//
//   "nothing in this deployable delivers a code. A handler that writes an
//   `otp_challenges` row and answers `sent: true` having sent nothing is a worse
//   answer than 503, and the SMS branch also needs a per-send price to charge
//   against `otp_send_budget.spend_cents`, which is config that has no source in
//   this tree"
//
// SO THE HONEST STATE OF THIS SCREEN IS "THE CODE CANNOT BE SENT YET" AND THE
// SCREEN SAYS THAT. ADR-200's own opening states the same fact from the API
// side and puts it first rather than last: "A TRADER STILL CANNOT SIGN UP ...
// nothing in this deployable writes the `otp_challenges` row this handler
// reads." Delivery is a vendor integration in nobody's fence.
//
// `NO_WEBAUTHN`:
//
//   "no WebAuthn verifier is admitted in this workspace. A registration or
//   assertion ceremony needs CBOR and COSE parsing and a signature check over
//   the authenticator data, none of which is hand-rollable on the money path and
//   none of which any dependency here provides. Admitting one is a VG-12
//   decision with an entry of its own, not a line in a wiring slice"
//
// And the third is `sms`-only and is NOT about delivery. ADR-200 section 4.4:
// "`sms` cannot LOG ANYBODY IN EITHER, at any door this tree admits. Resolving a
// phone to an identity means reading `identity_phones` by a hash, and
// `RESOLUTION_ADDRESS` is `{ users: ['email'] }`. There is no address in that
// vocabulary a phone can be presented at." `verifyOtp` raises for that arm
// specifically, so SMS is the one factor here with two independent blockers, and
// the second would survive delivery landing.
//
// -----------------------------------------------------------------------------
// AND NONE OF THE THREE SENTENCES BELOW SAYS ANY OF THAT
// -----------------------------------------------------------------------------
// API_CONTRACT section 2 keeps internals out of a problem document, and ADR-120
// ruling 4 says the same of the blockers themselves: "the reason never reaches
// the response", because each one names a table, a scope class or a
// construction. The trader-facing sentences say what a person cannot do. The
// operator's version is the block quoted above, and it stays in a comment.
//
// -----------------------------------------------------------------------------
// NOTHING HERE VARIES WITH AN ADDRESS
// -----------------------------------------------------------------------------
// API_CONTRACT section 3: `POST /auth/otp` "deliberately does not reveal whether
// the destination exists". Every value in this file is a constant fixed before
// any trader types anything, so this screen has no branch an existence check
// could be smuggled into, no copy that can vary with a destination, and no work
// whose duration could differ between a known address and an unknown one.
//
// -----------------------------------------------------------------------------
// AND NOTHING HERE IS REPAIRED
// -----------------------------------------------------------------------------
// `apps/api/**` is another live session's ground this wave: `auth.ts`,
// `verify.ts` and `auth-backend.ts` all moved under ADR-200 on the day this
// screen was built. If SC-M4-01 needs an API change, it is REPORTED. What this
// file does instead is state the measurement as data, so that whoever lands
// delivery flips one entry here and the screen changes with it.

import type { AuthFactor } from '../../api/types.ts';
import type { FactorAvailability } from '../../view/sign-in.ts';
import { toSignInView } from '../../view/sign-in.ts';
import type { SignInView } from '../../view/sign-in.ts';

/**
 * Every route SC-M4-01 would call, in the spelling API_CONTRACT section 3 uses.
 *
 * ALL FOUR ARE REGISTERED AND NONE IS WIRED. The list is carried so the screen
 * can be checked against the composed surface rather than against this comment.
 */
export const REQUIRED_ENDPOINTS = [
  'POST /auth/otp',
  'POST /auth/verify',
  'POST /auth/passkey/login/options',
  'POST /auth/passkey/login/verify',
] as const;

/**
 * What each factor can do in this deployment today.
 *
 * DERIVED FROM THE MEASUREMENT IN THIS FILE'S HEADER AND NOT FROM A GUESS, and
 * carried as data so that unblocking a backend is a one-entry diff here.
 *
 * `Record<AuthFactor, FactorAvailability>` KEEPS THE COMPILER COMPLETE: a member
 * added to the union in ../../api/types.ts and not measured here is `error
 * TS2741`, rather than a factor that renders as available because nobody looked
 * at it. `AuthFactor` is a closed three-member CHECK in `0029` and `SD-M4-04`
 * makes its membership the enforcement of C-27, so the union does not widen
 * casually and a widening that reached this screen would be worth stopping.
 */
export const AVAILABILITY: Readonly<Record<AuthFactor, FactorAvailability>> = {
  // `passkeyLoginOptions` and `passkeyLoginVerify` both raise on `NO_WEBAUTHN`,
  // so the ceremony cannot begin and could not be completed if it did.
  passkey: {
    served: false,
    because: 'Merit cannot check a passkey yet.',
  },

  // `requestOtp` raises on `NO_DELIVERY`. `verifyOtp`'s email arm IS wired
  // (ADR-200), so the half of this factor that is missing is precisely the half
  // that puts a code in front of a person.
  email_otp: {
    served: false,
    because: 'Merit cannot send a code to an email address yet.',
  },

  // TWO BLOCKERS, AND THE SECOND OUTLIVES THE FIRST. `requestOtp` raises on
  // `NO_DELIVERY` like the email arm, and `verifyOtp`'s `sms` arm raises
  // separately because a phone has no address in `RESOLUTION_ADDRESS`
  // (ADR-200 section 4.4). Delivery landing would leave this factor still
  // unable to complete, so the sentence names both and not just the code.
  sms_otp: {
    served: false,
    because: 'Merit cannot send a code to a phone yet, and cannot yet match a phone to an account.',
  },
};

/**
 * SC-M4-01, built from the measurement above.
 *
 * A CONSTANT AND NOT A LOADER. There is nothing to await, nothing to fail, and
 * therefore no `unavailable` arm on this screen: the arms every other segment
 * carries exist because a read can fail, and this screen performs none. What
 * would be an `unavailable` state elsewhere is the ordinary content here, said
 * per factor.
 */
export const SIGN_IN: SignInView = toSignInView({ availability: AVAILABILITY });
