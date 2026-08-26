// =============================================================================
// apps/portal/src/view/kyc.ts
// =============================================================================
// SC-M4-07, KYC STATUS. M04 section 3.1's one thing it must get right: "Four
// honest states, and what to do in each."
//
// -----------------------------------------------------------------------------
// THE PLAN SAYS FOUR AND THE DATABASE DECLARES FIVE
// -----------------------------------------------------------------------------
// `kyc_status` at packages/db/migrations/0001_extensions_and_enums.sql:29 is
// ('kyc_required', 'pending', 'verified', 'rejected', 'expired'). M04:86 says
// four. API_CONTRACT section 7 declares `KycStatus.state` as an open `string`
// and therefore settles nothing.
//
// THIS SCREEN IS BUILT AGAINST THE FIVE, and the reason is not a preference
// between two approved documents. The enum is what will actually arrive, so a
// view handling four of five renders the fifth as nothing, and "nothing" on a
// verification screen is the state where the trader has no idea what to do. The
// discrepancy is recorded in ADR-111 section 7 as a finding for the founder and
// is NOT ruled here: amending an approved plan takes its own ADR.
//
// AN UNKNOWN STATE THROWS. It does not fall back to `pending`, which would tell
// a rejected trader to wait, and it does not fall back to a generic card, which
// would tell nobody anything. A state the enum cannot produce means the server
// and this file disagree about the vocabulary, and that is a defect to report
// rather than a screen to render.
//
// -----------------------------------------------------------------------------
// M04 SECTION 7.9's VOCABULARY RULE, ENFORCED RATHER THAN DOCUMENTED
// -----------------------------------------------------------------------------
//   "The vocabulary rule is binding on this module's copy and is testable: no
//   trader-facing verification string contains 'fraud', 'suspicious', 'risk',
//   'flagged', or 'review'. Those words are internal-tier."
//
// and, on the failure surface:
//
//   "Routes to a human. The words 'decisions are final' may not appear in any
//   string this module renders."
//
// Section 7.9 asks for "a lint over the portal's string catalogue". THERE IS NO
// STRING CATALOGUE HERE AND THE STRING IS NOT THIS MODULE'S: `action_required`
// arrives on the wire, written by whoever wrote the handler, and a lint over
// portal source would not have read it. So the check is a REFUSAL at the point
// the server's string enters the trader's screen, which is the only place it
// can be made about the string that will actually render.
//
// IT IS NOT A SUBSTITUTE FOR 7.9's LINT AND IT IS NOT PRETENDING TO BE. A lint
// covers strings this module authors; this covers the one string it renders and
// did not author. Both are owed and this is the half that is buildable today.

import type { KycStatus } from '../api/types.ts';

/**
 * `kyc_status` at 0001:29, in the enum's own order.
 *
 * TRANSCRIBED FROM THE DDL AND NOT FROM THE CONTRACT, because the contract
 * declares the field as `string`. When a row gives `KycStatus.state` a union,
 * this constant is the thing to reconcile against it.
 */
export const KYC_STATES = ['kyc_required', 'pending', 'verified', 'rejected', 'expired'] as const;

/** One member of `kyc_status`. */
export type KycState = (typeof KYC_STATES)[number];

/**
 * The internal-tier vocabulary M04 section 7.9 bans from trader-facing
 * verification strings, plus the phrase the failure surface bans outright.
 *
 * MATCHED CASE-INSENSITIVELY AND AS A SUBSTRING, deliberately over-broad. A
 * word-boundary match would let "under-review" through, and the cost of a false
 * positive here is a handler's sentence being rewritten, while the cost of a
 * false negative is a trader reading that they were flagged.
 */
export const INTERNAL_TIER_TERMS = [
  'fraud',
  'suspicious',
  'risk',
  'flagged',
  'review',
  'decisions are final',
] as const;

/** A wire string that carries a word M04 section 7.9 keeps off this surface. */
export class InternalTierLanguageError extends Error {
  constructor(
    readonly field: string,
    readonly term: string,
  ) {
    super(
      `${field} contains "${term}", which M04 section 7.9 keeps off every ` +
        'trader-facing verification surface. The words are internal-tier and the ' +
        'fix is upstream, in the handler that wrote the string: this screen may ' +
        'not paraphrase it, because a rewritten refusal is a refusal nobody can ' +
        'reconcile with the record.',
    );
    this.name = 'InternalTierLanguageError';
  }
}

/** A `state` value `kyc_status` cannot produce. */
export class UnknownKycStateError extends Error {
  constructor(readonly state: string) {
    super(
      `"${state}" is not a member of kyc_status ` +
        `(${KYC_STATES.join(', ')}, declared at 0001:29). The screen refuses ` +
        'rather than rendering an unknown state as pending, because telling a ' +
        'rejected trader to wait is the one outcome SC-M4-07 exists to prevent.',
    );
    this.name = 'UnknownKycStateError';
  }
}

/**
 * What the trader does next, as a CLOSED vocabulary rather than as copy.
 *
 * The screen decides the SHAPE of the next step and never its words: `verify`
 * routes into the embedded provider flow (M04 section 7.9: "rendered in place,
 * never a redirect to an unfamiliar domain"), `wait` has no control at all, and
 * `contact_support` is section 7.9's "routes to a human". `none` is the
 * verified state, which is a status the trader KEEPS rather than a gate they
 * passed and cannot confirm.
 */
export type KycNextStep = 'verify' | 'wait' | 'contact_support' | 'none';

/** SC-M4-07. Four honest states as the plan puts it, five as the enum declares it. */
export type KycStatusView = {
  readonly state: KycState;

  /** Which trigger raised this verification. ADR-021's set, rendered as the server sent it. */
  readonly placement: string;
  readonly verified_at: string | null;
  readonly expires_at: string | null;

  /**
   * THE VERIFIED BADGE, AND IT IS PERMANENT. M04 section 7.9: "A status the
   * trader keeps, not a gate they passed and cannot confirm." An expired
   * verification is not verified, which is why this reads the state and not
   * `verified_at`: a row can carry both a verification date and an expiry that
   * has passed, and the badge follows the state.
   */
  readonly verified: boolean;

  /** The shape of the next control. Never its words. */
  readonly next_step: KycNextStep;

  /** The server's sentence, unmodified, or null. Checked against section 7.9. */
  readonly action_required: string | null;
};

const NEXT_STEP: Readonly<Record<KycState, KycNextStep>> = {
  // The trigger fired and nothing has been attempted. Section 7.9's contextual
  // prompt leads with the achievement, and the control is the flow itself.
  kyc_required: 'verify',

  // Submitted, awaiting the provider. No control, because "repeated prompting
  // reads as accusation regardless of wording".
  pending: 'wait',

  verified: 'none',

  // Section 7.9: failure "routes to a human". Not a retry, and not a sentence
  // this module writes.
  rejected: 'contact_support',

  // A lapsed verification is re-done rather than appealed, so it routes back
  // into the flow and not to support.
  expired: 'verify',
};

function assertTraderSafe(field: string, value: string | null): void {
  if (value === null) return;
  const haystack = value.toLowerCase();
  for (const term of INTERNAL_TIER_TERMS) {
    if (haystack.includes(term)) throw new InternalTierLanguageError(field, term);
  }
}

function toKycState(state: string): KycState {
  const found = KYC_STATES.find((member) => member === state);
  if (found === undefined) throw new UnknownKycStateError(state);
  return found;
}

/**
 * SC-M4-07, from the wire.
 *
 * THE TWO REFUSALS ARE THE SCREEN. Everything else here is a projection: the
 * state is passed through, the dates are passed through, and `action_required`
 * is passed through verbatim because paraphrasing a server's sentence is how a
 * refusal and its record stop matching. What this function adds is the
 * vocabulary check and the unknown-state check, and both fail loudly.
 */
export function toKycStatusView(status: KycStatus): KycStatusView {
  const state = toKycState(status.state);
  assertTraderSafe('action_required', status.action_required);

  return {
    state,
    placement: status.placement,
    verified_at: status.verified_at,
    expires_at: status.expires_at,
    verified: state === 'verified',
    next_step: NEXT_STEP[state],
    action_required: status.action_required,
  };
}
