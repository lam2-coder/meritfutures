// =============================================================================
// apps/portal/src/view/sign-in.ts
// =============================================================================
// SC-M4-01's VIEW MODEL. `M04:80`: "Auth (passkey, email OTP, SMS OTP). No
// password field exists anywhere. There is no password database to stuff (D2),
// and widening to a third factor did not change that."
//
// It is the last row of section 3.1's table with no route in this application,
// and it is the only screen here that reads NOTHING: every endpoint behind it is
// a POST, and a caller arriving at it has no session by definition. So this file
// is a pure function from a MEASUREMENT of what a deployment can serve to the
// screen that states it, and ../../app/sign-in/availability.ts is where that
// measurement is taken and cited.
//
// -----------------------------------------------------------------------------
// THERE IS NO PASSWORD FIELD, NO RESET LINK AND NO "FORGOT PASSWORD"
// -----------------------------------------------------------------------------
// MERIT IS PASSWORDLESS IN THE SCHEMA AND NOT MERELY IN THE UI. `0002` says it
// in the schema's own words, on the table where a password would have to live:
// "Merit is passwordless only, so THERE IS NO PASSWORD TABLE ANYWHERE IN THIS
// SCHEMA, by design. Adding one is a security architecture change requiring an
// ADR, not a convenience." ADR-039 is the ruling and C-01 is the invariant.
//
// A SIGN-IN SCREEN IS THE SINGLE MOST LIKELY PLACE IN THIS PRODUCT FOR A
// PASSWORD FIELD TO APPEAR WITHOUT ANYBODY DECIDING TO ADD ONE, because every
// other product's sign-in screen has one and a builder transcribing a familiar
// layout would type it before noticing. `view/sessions.ts` made the same
// argument about the security screen one row down and asserted the absence
// rather than trusting it; this file is the row that argument was really about.
// `test/sign-in.test.ts` renders this tree and fails on the words a password
// control, a reset link or a recovery flow would have to carry.
//
// -----------------------------------------------------------------------------
// THE THREE FACTORS ARE PEERS AND THIS FILE RANKS NONE OF THEM
// -----------------------------------------------------------------------------
// `M04:263`, M4's obligation against `POST /auth/otp`: the portal "offers email
// and SMS as peers rather than as a fallback, because C-01 makes any single
// factor sufficient and a UI that calls one of them 'fallback' is describing a
// hierarchy the server does not have". ADR-039 (the ruling) makes "any single
// factor sufficient for login" the decision itself.
//
// THE ORDER BELOW IS TRANSCRIBED RATHER THAN CHOSEN. `M04:80` names them
// "passkey, email OTP, SMS OTP" and that is the order {@link SIGN_IN_FACTORS}
// carries, so the sequence on the screen is the plan's sentence and not a
// judgement taken in a view model. No factor is marked recommended, preferred,
// primary or fallback, and the suite fails on each of those words.
//
// -----------------------------------------------------------------------------
// ONE CONTROL SIGNS IN AND SIGNS UP, AND THAT IS ADR-196 RATHER THAN A LAYOUT
// -----------------------------------------------------------------------------
// ADR-196 clause 1 rules that "an identity comes into existence at `POST
// /auth/verify`, on a code that verifies, when the address resolves to no
// existing `users` row. Nowhere else." Its section 3 refuses a registration
// endpoint in those terms: "the sign-up is a branch inside a handler that
// already exists in the contract, not a surface of its own."
//
// A SCREEN WITH A SEPARATE "CREATE ACCOUNT" CONTROL WOULD BE THAT REFUSED
// SURFACE, DRAWN. It would also leak: a person choosing between two controls
// learns from the outcome which one applied to their address, which is exactly
// what `API_CONTRACT` section 3 withholds when it says `POST /auth/otp`
// "deliberately does not reveal whether the destination exists". So there is one
// email control, {@link SignInFactorView.creates_an_account} records that it is
// both, and the screen says the answer is the same either way.
//
// -----------------------------------------------------------------------------
// AND THIS FILE CANNOT DISCLOSE WHETHER AN ADDRESS EXISTS, STRUCTURALLY
// -----------------------------------------------------------------------------
// {@link toSignInView} TAKES NO ADDRESS. Not an email, not a phone, not a
// submitted value of any kind. Every sentence this screen can render is fixed
// before a trader types anything, so there is no branch for an existence check
// to be smuggled into and no copy that can vary with the address.
//
// THAT IS THE STRONGEST FORM THE PROPERTY CAN TAKE HERE and it is deliberately
// structural rather than asserted: a test that checked two addresses produce the
// same copy would pass over a function that could still tell them apart, and
// timing is the other half of the disclosure this shape also forecloses.

import type { AuthFactor } from '../api/types.ts';
import { factorLabel } from './sessions.ts';

// -----------------------------------------------------------------------------
// 1. What a deployment can serve, which is the caller's measurement
// -----------------------------------------------------------------------------

/**
 * Whether the endpoint behind one factor answers in this deployment.
 *
 * A UNION RATHER THAN A BOOLEAN AND A NULLABLE STRING, so a factor that is not
 * served cannot be built without saying why. The two-field shape admits
 * `{ served: false, because: null }`, which is the shape of a screen that
 * refuses and does not explain.
 *
 * `because` IS TRADER-SAFE AND NEVER THE OPERATOR'S BLOCKER. API_CONTRACT
 * section 2 keeps internals out of a problem document and ADR-120 ruling 4 says
 * the same of `AuthBackendUnwired.reason`: "the reason never reaches the
 * response", because every one of them names a table, a scope class or a
 * construction. The sentences ../../app/sign-in/availability.ts supplies say
 * what a person cannot do, never which method raised.
 */
export type FactorAvailability =
  { readonly served: true } | { readonly served: false; readonly because: string };

// -----------------------------------------------------------------------------
// 2. The three constants that are the schema's and not a deployment's
// -----------------------------------------------------------------------------

/**
 * The order `M04:80` names, transcribed.
 *
 * `Record<AuthFactor, ...>` ELSEWHERE IN THIS FILE KEEPS THE COMPILER COMPLETE;
 * this array keeps the ORDER, which a record does not carry. The two are
 * reconciled by {@link toSignInView}, which reads this array and indexes the
 * records, so a factor added to the union and not to this array renders nowhere
 * while every record already refuses to compile without it.
 */
export const SIGN_IN_FACTORS: readonly AuthFactor[] = ['passkey', 'email_otp', 'sms_otp'];

/**
 * The endpoint each factor's control would call. API_CONTRACT section 3.
 *
 * EMAIL AND SMS SHARE ONE ROUTE AND THAT IS THE CONTRACT'S SHAPE RATHER THAN A
 * COLLAPSE HERE. `M04:263` states M4's obligation against `POST /auth/otp` as
 * "carries the channel", and API_CONTRACT gives `OtpRequest` a `channel` field
 * that "takes no default" precisely so the destination and the channel are one
 * decision. Two routes here would be this file inventing a distinction the
 * server does not make.
 */
const ENDPOINT: Readonly<Record<AuthFactor, string>> = {
  passkey: 'POST /auth/passkey/login/options',
  email_otp: 'POST /auth/otp',
  sms_otp: 'POST /auth/otp',
};

/**
 * Whether completing this factor can bring an account into existence.
 *
 * TRUE FOR EXACTLY ONE OF THE THREE, AND THE OTHER TWO ARE FALSE FOR TWO
 * DIFFERENT REASONS. Neither is a policy this file chose and neither is a
 * property of how far the build has got: both are consequences of documents that
 * are merged and frozen.
 *
 * `sms_otp` IS FALSE BECAUSE OF A `NOT NULL`. ADR-196 clause 5: "`is_new` is
 * ALWAYS `false` on the `sms` channel. This is derived, not chosen." Its section
 * 6 gives the derivation: `0002` declares `users.email citext NOT NULL UNIQUE`,
 * so "a verification arriving on the `sms` channel for an unknown number has no
 * value to write into `users.email` and cannot create the login clause 2
 * requires". ADR-200 section 4.4 found the other half, that `sms` cannot log
 * anybody in either at any door this tree admits, and that half IS a property of
 * the build: it belongs in the availability measurement and not here.
 *
 * **THE SCREEN MUST THEREFORE NOT OFFER SMS AS A WAY TO SIGN UP**, and the
 * reason it is stated in a type rather than in copy is that copy is where this
 * gets forgotten. A person who signed up on SMS would meet the `NOT NULL` as a
 * refusal at the end of a flow that had already asked them for a code.
 *
 * `passkey` IS FALSE BECAUSE OF A SESSION REQUIREMENT. API_CONTRACT section 3:
 * for the passkey ceremonies, "register requires a session; login does not". A
 * passkey is therefore something an identity that already exists adds to itself,
 * and `POST /auth/passkey/login/verify` resolves an existing credential rather
 * than minting a person to hang one on.
 *
 * SO EMAIL IS THE ONLY DOOR INTO MERIT, and a screen that did not say so would
 * leave a person with neither an account nor an email address believing they had
 * three ways in.
 */
const CREATES_AN_ACCOUNT: Readonly<Record<AuthFactor, boolean>> = {
  passkey: false,
  email_otp: true,
  sms_otp: false,
};

/**
 * The address a person supplies to begin this factor, or `null` where there is
 * none. API_CONTRACT section 3.
 *
 * IT IS A CONTRACT FACT AND NOT A LAYOUT ONE, which is why it is derived here
 * rather than decided in the element tree. `OtpRequest` carries "exactly one of
 * email / phone, and it must match `channel`", so each OTP factor has exactly
 * one destination and the channel names which. The passkey ceremonies take a
 * `PublicKeyCredentialJSON` and no address at all: the authenticator holds the
 * credential, and `POST /auth/passkey/login/options` is a challenge request with
 * nothing to address it to.
 *
 * A RENDERER DECIDING THIS FROM `creates_an_account` WOULD BE COUPLING TWO
 * UNRELATED FACTS. They coincide today only because email is the one factor that
 * both registers and takes an address.
 */
const DESTINATION: Readonly<Record<AuthFactor, 'email' | 'phone' | null>> = {
  passkey: null,
  email_otp: 'email',
  sms_otp: 'phone',
};

// -----------------------------------------------------------------------------
// 3. One factor
// -----------------------------------------------------------------------------

/** One of the three ways into Merit, with everything the screen states about it. */
export type SignInFactorView = {
  /** The server's token, carried through and never re-spelled. */
  readonly factor: AuthFactor;

  /**
   * {@link factorLabel} of the same token, and never a second vocabulary.
   *
   * IT IS IMPORTED FROM `view/sessions.ts` RATHER THAN RE-DERIVED. A trader who
   * signs in here reads the factor again on SC-M4-11's session list, and two
   * files spelling `email_otp` two ways would make the row that proves a session
   * was theirs look like a row about something else.
   */
  readonly label: string;

  /** `METHOD /path`, as API_CONTRACT spells it. */
  readonly endpoint: string;

  /** Whether {@link endpoint} answers in this deployment. Measured, not assumed. */
  readonly served: boolean;

  /**
   * What a person cannot do, in their own terms, and `null` exactly when
   * {@link served}.
   */
  readonly unavailable: string | null;

  /**
   * Whether this factor can create an account that does not exist yet.
   *
   * ADR-196 clause 5 for `sms_otp`, API_CONTRACT section 3 for `passkey`. See
   * {@link CREATES_AN_ACCOUNT}.
   */
  readonly creates_an_account: boolean;

  /**
   * The address this factor begins with, or `null` where the contract defines
   * none. See {@link DESTINATION}.
   */
  readonly destination: 'email' | 'phone' | null;

  /**
   * THE ROUTE THIS CONTROL SUBMITS TO, TYPED AS THE LITERAL `null` SO THAT
   * WIRING IT IS A TYPE CHANGE A REVIEWER READS.
   *
   * IT IS A SECOND AND INDEPENDENT ABSENCE FROM {@link served}, and conflating
   * them would be the defect ADR-120 ruling 4 named one layer down: a single
   * shared sentence for two different facts. `served` is a property of `apps/api`
   * and this is a property of `apps/portal`. Both are false for all three factors
   * today, and they would stop being false on different days, in different
   * repositories' worth of work.
   *
   * ../../http/client.ts declares an `ApiClient` with `get` and nothing else,
   * `test/surface.test.ts` fails on a second file in this application growing a
   * `fetch(`, and ADR-083 section 3 with ADR-095 ruling 3 forbid a route handler
   * or a Server Action here. Giving this application its first write verb is a
   * transport ruling with a CSRF posture, an unsafe-method cookie policy and an
   * idempotency question attached, and `app/security/source.ts` declined exactly
   * that widening for `POST /sessions/:id/revoke` one screen over. This screen
   * declines it on a heavier path: `POST /auth/verify` sets the session cookie.
   */
  readonly submits_to: null;
};

function toFactor(factor: AuthFactor, availability: FactorAvailability): SignInFactorView {
  return {
    factor,
    label: factorLabel(factor),
    endpoint: ENDPOINT[factor],
    served: availability.served,
    unavailable: availability.served ? null : availability.because,
    creates_an_account: CREATES_AN_ACCOUNT[factor],
    destination: DESTINATION[factor],
    submits_to: null,
  };
}

// -----------------------------------------------------------------------------
// 4. The screen
// -----------------------------------------------------------------------------

/** SC-M4-01, whole. */
export type SignInView = {
  /**
   * The three factors, in `M04:80`'s order, ranked in no way.
   *
   * ALL THREE ARE ALWAYS PRESENT, INCLUDING THE ONES THAT CANNOT BE COMPLETED. A
   * screen that hid an unavailable factor would be indistinguishable from a
   * screen that had decided the factor does not exist, which is
   * `app/payouts/source.ts`'s rule about naming what a screen failed to get
   * rather than assuming, and here it also erases the peer relationship C-01
   * establishes.
   */
  readonly factors: readonly SignInFactorView[];

  /**
   * The factors that could bring an account into existence, derived.
   *
   * IT IS DERIVED FROM {@link factors} RATHER THAN STATED, so the screen and the
   * per-factor flag cannot disagree, and a fourth factor added to the union
   * arrives here without anybody remembering to add it.
   */
  readonly registration_factors: readonly AuthFactor[];

  /**
   * Whether anybody can complete a sign-in in this deployment at all.
   *
   * BOTH HALVES ARE REQUIRED AND BOTH ARE FALSE TODAY: the server has to answer
   * and this application has to be able to ask. See
   * {@link SignInFactorView.submits_to}.
   */
  readonly can_complete: boolean;
};

/**
 * Build SC-M4-01.
 *
 * @param input.availability what each factor's endpoint does in this deployment,
 *                           measured by the caller. Keyed by `AuthFactor`, so a
 *                           member added to the union and not measured is
 *                           `error TS2741` rather than a factor that renders as
 *                           available because nobody looked.
 *
 * IT TAKES NO ADDRESS AND NO SUBMITTED VALUE OF ANY KIND. See this file's header:
 * that is what makes the existence of an account undisclosable by this screen
 * rather than merely undisclosed by its current copy.
 */
export function toSignInView(input: {
  readonly availability: Readonly<Record<AuthFactor, FactorAvailability>>;
}): SignInView {
  const factors = SIGN_IN_FACTORS.map((factor) => toFactor(factor, input.availability[factor]));

  return {
    factors,
    registration_factors: factors.filter((f) => f.creates_an_account).map((f) => f.factor),

    // `submits_to` is the literal `null`, so this reads false for every factor
    // today whatever the measurement says. It is written as a conjunction rather
    // than as `false` because the day the transport gains a verb, this line
    // starts answering the question instead of restating the answer.
    can_complete: factors.some((f) => f.served && f.submits_to !== null),
  };
}
