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
// behind the screen is a POST, and this file calls none of them. THE PAGE IS
// THEREFORE STATIC AND CORRECTLY SO, on
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
// here: all four routes behind SC-M4-01 are REGISTERED, and TWO of the four are
// wired. A grep, or a route table, would report this screen as fully served.
//
// THE SENTENCE ABOVE USED TO READ "NOT ONE of them is wired" AND THAT WAS FALSE
// AGAINST THE MEASUREMENT SIX LINES BELOW IT IN THIS SAME FILE. `verifyOtp` has
// been wired since ADR-200 and the WIRING block already said so; only the
// summary above it did not. Session 408 derived the split at the backend rather
// than reading this paragraph, which is the only reason it was caught: a
// summary and the measurement it summarises drifted apart inside one file, and
// the summary is the half a reader trusts. IT THEN READ "EXACTLY ONE" UNTIL
// ADR-229 WIRED `requestOtp`, and the cross-check below is what caught THAT one,
// which is the same drift stopped by a runner instead of by a reader.
//
// AND THE TWO ARE NOW THE PAIR A READER GUESSES, WHICH THEY WERE NOT BEFORE. The
// four fall into two obvious pairs, an OTP pair and a passkey pair. Until
// ADR-229 the OTP pair was SPLIT down the middle -- the route that ISSUES a code
// blocked and the route that CONSUMES one wired -- and the guess that follows
// from the shape was wrong in both halves. The issuing half is wired now, so the
// OTP pair is whole and the passkey pair is still both blocked. See
// {@link ENDPOINT_WIRING}.
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
//   passkeyLoginOptions   BLOCKED on `NO_WEBAUTHN`
//   passkeyLoginVerify    BLOCKED on `NO_WEBAUTHN`
//   requestOtp            WIRED (ADR-229), and the `sms` arm raises anyway
//   verifyOtp             WIRED, and the `sms` arm raises anyway; see below
//
// `apps/api/test/auth-backend.test.ts` asserts that ten of the sixteen methods
// refuse this way, each with its own reason, so the measurement above is a
// property that suite already holds rather than one this file claims.
//
// -----------------------------------------------------------------------------
// THE SERVED SET ADMITS A COMPLETE SIGN-IN AT THE API, AND THIS SCREEN STILL
// CANNOT PERFORM ONE
// -----------------------------------------------------------------------------
// THE PARAGRAPH THAT STOOD HERE IS QUOTED RATHER THAN DELETED, because it was
// the whole reason this screen exists in the shape it does and ADR-229 has made
// exactly one of its two halves false:
//
//   "ONE OF THE FOUR IS SERVED AND IT CANNOT BE REACHED. `POST /auth/verify`
//   consumes an `otp_challenges` row. The only thing in the port that WRITES one
//   is `requestOtp`, and `requestOtp` is blocked on `NO_DELIVERY`."
//
// THAT IS NO LONGER TRUE. `requestOtp` writes the row and hands the code to
// `apps/api/src/otp-delivery.ts`, so the OTP pair is whole at the API and an
// `api` service holding the mail vendor's token signs an email trader in end to
// end. WHAT IS OWED THERE IS A CREDENTIAL AND NOT A CONSTRUCTION, which is a
// different kind of missing: an unconfigured deployment answers 503 rather than
// pretending, so the route is honest in both states.
//
// AND THIS SCREEN IS STILL NOT WIRED, ON THE OTHER REFUSAL AND NOT ON THIS ONE.
// The two refusals were always independent and the file said so before either
// lifted: `next@16.3.2` permits a cookie write only in a Server Action or a
// Route Handler, `ADR-138` section 3 refuses the first outright, and all three
// registered POSTs that establish a session answer with a `Set-Cookie` this
// application cannot deliver (ADR-219 section 6.2). So the sentence "a button
// whose only reachable outcome is a failure" survives its own premise changing,
// and it survives for a reason that has nothing to do with delivery.
//
// PASSKEYS ARE UNMOVED AND MERIT IS STILL PASSWORDLESS. `0002_identity.sql`
// records it on the table where a password would have to live: "Merit is
// passwordless only, so THERE IS NO PASSWORD TABLE ANYWHERE IN THIS SCHEMA, by
// design." Both passkey ceremonies are blocked on `NO_WEBAUTHN`, so OTP is the
// whole of what this deployment could serve and email is the whole of OTP.
//
// A SECOND REFUSAL STOOD HERE INDEPENDENTLY AND ADR-219 HAS LIFTED HALF OF IT.
// All four routes are POST and ../../http/client.ts declared an `ApiClient` with
// `get` and NOTHING ELSE, so this application could not express any of the four
// even for the one that answers. `post` exists from ADR-219, WHICH CHANGES
// NOTHING ON THIS SCREEN: that entry ships the transport and wires no page, so
// nothing here calls it, and the refusal above stands on its own. It is also
// still not sufficient for sign-in, and ADR-219 section 6.2 is why: three
// registered POSTs answer with a `Set-Cookie` and this deployable can deliver
// none of them, because `next@16.3.2` permits a cookie write only in a Server
// Action or a Route Handler and ADR-138 section 3 refuses the first outright.
// The two refusals are independent and lift on different days, which is why
// `view/sign-in.ts`'s `submits_to` is a separate field from `served` and not a
// second spelling of it.
//
// -----------------------------------------------------------------------------
// THE THREE BLOCKERS, QUOTED, AND WHAT EACH ONE MEANS ON A SCREEN
// -----------------------------------------------------------------------------
// `NO_DELIVERY` STOOD HERE AND IT IS RETIRED. It read, and the sentence is kept
// because it decided this whole screen for twenty-six waves:
//
//   "nothing in this deployable delivers a code. A handler that writes an
//   `otp_challenges` row and answers `sent: true` having sent nothing is a worse
//   answer than 503, and the SMS branch also needs a per-send price to charge
//   against `otp_send_budget.spend_cents`, which is config that has no source in
//   this tree"
//
// WHAT REPLACES IT IS `NO_SMS_DELIVERY` AND IT IS NARROWER IN THE ONE DIRECTION
// THAT MATTERS: the email branch is wired, and what survives is the SMS branch,
// where a code cannot be verified even if it were sent and the per-send price
// still has a name and no value. ADR-229. So the honest state of this screen is
// no longer "the code cannot be sent"; it is that this application cannot
// deliver the cookie a sign-in answers with, which is ADR-219 section 6.2 and is
// quoted above.
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
 * One route behind SC-M4-01, and what the installed backend does with it.
 *
 * THE FOUR FIELDS ARE FOUR DIFFERENT FACTS AND THE FILE USED TO CARRY ONLY THE
 * FIRST. `endpoint` is API_CONTRACT's, `method` is the port's, and `served` is
 * the installed backend's; keeping them in one row is what lets a test check the
 * third against `apps/api` instead of against a comment that can go stale the
 * way this file's own summary did.
 */
export type EndpointWiring = {
  /** `METHOD /path`, in the spelling API_CONTRACT section 3 uses. */
  readonly endpoint: string;

  /**
   * The `AuthBackend` method behind it, spelled as `routes/auth.ts` declares it.
   *
   * IT IS THE JOIN KEY AND THAT IS ITS WHOLE PURPOSE. Wiring is a property of a
   * METHOD and this screen names ROUTES, so without the method in the row there
   * is nothing a check can match `databaseAuthBackend` on, and `served` below
   * would be an unverifiable assertion in a file whose unverifiable assertion
   * was already wrong once.
   */
  readonly method: string;

  /** Whether `databaseAuthBackend` implements {@link method} rather than raising. */
  readonly served: boolean;

  /**
   * The operator's blocker CONSTANT, or `null` exactly when {@link served}.
   *
   * THE NAME AND NEVER THE PROSE, AND IT REACHES NO SCREEN. ADR-120 ruling 4:
   * "the reason never reaches the response", because every blocker names a
   * table, a scope class or a construction. This field exists so a check can
   * match `blocked('<method>', <BLOCKER>)` in `apps/api/src/auth-backend.ts`;
   * the trader-facing sentences are {@link AVAILABILITY}'s and say what a person
   * cannot do. `test/sign-in.test.ts` asserts no value of this field renders.
   */
  readonly blocker: string | null;
};

/**
 * Every route SC-M4-01 would call, and which of them this deployment serves.
 *
 * ALL FOUR ARE REGISTERED AND TWO ARE WIRED, WHICH IS THE OTP PAIR WHOLE. It
 * read "EXACTLY ONE IS WIRED, AND IT IS NOT THE PAIR THE SHAPE SUGGESTS" until
 * ADR-229: the OTP pair was SPLIT, with the route that ISSUES a code blocked and
 * the route that CONSUMES one wired. The issuing half is wired now, so the free
 * reading -- "OTP works, passkeys do not" -- is correct for the first time, and
 * the passkey pair is still both blocked on `NO_WEBAUTHN`.
 *
 * WHICH DOES NOT MOVE THE SCREEN, AND THE HEADER SAYS WHY: `served: true` on a
 * row is a statement about `apps/api` and never a licence for this screen to
 * call it. What holds this one closed is ADR-219 section 6.2's cookie refusal,
 * which was always the second and independent half.
 *
 * CARRIED AS DATA SO IT IS CHECKABLE, AND THE CHECK IS WHAT CAUGHT THIS EDIT.
 * `test/sign-in.test.ts` matches every row against
 * `apps/api/src/auth-backend.ts`'s own text and fails when the two disagree in
 * either direction. This docblock predicted the case exactly -- "a session that
 * wires `requestOtp` over there cannot leave this screen quietly claiming it is
 * still blocked" -- and that session is ADR-229's, which arrived to a red suite
 * rather than to a stale comment.
 */
export const ENDPOINT_WIRING: readonly EndpointWiring[] = [
  // THE HALF THAT PUTS A CODE IN FRONT OF A PERSON, WIRED BY ADR-229 AFTER
  // TWENTY-SIX WAVES. Its `sms` arm still raises `NO_SMS_DELIVERY`, which is a
  // per-FACTOR fact and lands in {@link AVAILABILITY}.sms_otp rather than here,
  // exactly as `verifyOtp`'s `sms` arm does one row down: the ROUTE answers, and
  // it is the email channel that it answers for.
  { endpoint: 'POST /auth/otp', method: 'requestOtp', served: true, blocker: null },

  // THE ONE THAT ANSWERS. ADR-200 wired it, and `auth-backend.ts` implements it
  // as `async verifyOtp`. Its `sms` arm still raises `NO_PHONE_RESOLUTION`
  // (ADR-200 section 4.4), which is a per-FACTOR fact and lands in
  // {@link AVAILABILITY}.sms_otp rather than here: the ROUTE answers, and it is
  // the email channel that it answers for.
  { endpoint: 'POST /auth/verify', method: 'verifyOtp', served: true, blocker: null },

  {
    endpoint: 'POST /auth/passkey/login/options',
    method: 'passkeyLoginOptions',
    served: false,
    blocker: 'NO_WEBAUTHN',
  },
  {
    endpoint: 'POST /auth/passkey/login/verify',
    method: 'passkeyLoginVerify',
    served: false,
    blocker: 'NO_WEBAUTHN',
  },
];

/**
 * The same four routes as a flat list, DERIVED so the two cannot disagree.
 *
 * It is the shape the other five segments carry, which is why it survives the
 * table landing above it: `app/wallet/source.ts`, `app/payouts/source.ts`,
 * `app/accounts/source.ts`, `app/calendar/load.ts` and `app/security/source.ts`
 * all export a `REQUIRED_ENDPOINTS`, and a sixth spelling of that name would be
 * this segment describing the same thing differently for no reason.
 */
export const REQUIRED_ENDPOINTS: readonly string[] = ENDPOINT_WIRING.map((row) => row.endpoint);

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

  // THIS ENTRY READ "Merit cannot send a code to an email address yet." AND
  // ADR-229 HAS MADE THAT FALSE. Both halves of the factor are wired at the API:
  // `requestOtp` issues and delivers, `verifyOtp`'s email arm consumes.
  //
  // IT STAYS `served: false` AND THE REASON IS THIS APPLICATION'S RATHER THAN
  // THE API'S, which is the distinction `served` on an {@link ENDPOINT_WIRING}
  // row and `served` here have always carried separately. Two facts hold it
  // closed and neither is delivery: this deployable cannot deliver the
  // `Set-Cookie` a sign-in answers with (ADR-219 section 6.2), so nothing here
  // can complete one; and no environment in this repository holds the mail
  // vendor's token, so a deployment would answer 503 today anyway. A factor
  // rendered available that cannot complete is ADR-190's wrong answer dressed as
  // a working control, which is the thing this file exists to refuse.
  //
  // THE SENTENCE NAMES NEITHER, ON THE RULE THREE SECTIONS UP: the trader-facing
  // copy says what a person cannot do, and cookies and vendor tokens are the
  // operator's version.
  email_otp: {
    served: false,
    because: 'Merit cannot complete a sign-in yet.',
  },

  // TWO BLOCKERS, AND THE SECOND OUTLIVING THE FIRST IS NOW A MEASUREMENT AND
  // NOT A PREDICTION. Delivery landed for email and this factor did not move:
  // `requestOtp`'s `sms` arm raises `NO_SMS_DELIVERY`, and `verifyOtp`'s `sms`
  // arm raises separately because a phone has no address in `RESOLUTION_ADDRESS`
  // (ADR-200 section 4.4). ADR-229 declined to take an SMS vendor on exactly
  // that ground: a code sent to a phone could not be verified by anything here,
  // so the send would be money spent for nothing.
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
