// =============================================================================
// apps/portal/src/app/kyc/copy.ts
// =============================================================================
// THE STRING CATALOGUE M04 SECTION 7.9 ASKS FOR, CREATED BECAUSE RENDERING
// FORCED IT INTO EXISTENCE.
//
//   "The vocabulary rule is binding on this module's copy and is testable: no
//    trader-facing verification string contains 'fraud', 'suspicious', 'risk',
//    'flagged', or 'review'. Those words are internal-tier. A LINT OVER THE
//    PORTAL'S STRING CATALOGUE is the cheapest possible enforcement and it
//    belongs in CI alongside the Appendix F em-dash check."
//
// `src/view/kyc.ts` reported that lint as owed and unbuildable, in its own
// words: "Section 7.9 asks for a lint over the portal's string catalogue.
// THERE IS NO STRING CATALOGUE HERE AND THE STRING IS NOT THIS MODULE'S." It
// was right on both counts, and the second half is why: a view model that
// projects a wire shape authors no sentences, so there was nothing to lint.
//
// A PAGE AUTHORS SENTENCES. Every label below is a string a trader reads and
// no server sent, which is exactly the population section 7.9 binds, and this
// file is that population gathered into one object so a check can read it.
// `kyc-page.test.ts` runs section 7.9's rule over every member, using
// `INTERNAL_TIER_TERMS` from `view/kyc.ts` rather than a second copy of the
// word list.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT
// -----------------------------------------------------------------------------
// IT IS NOT `CopyBlock` AND IT IS NOT A DISCLOSURE. `CopyBlock`'s provenance is
// `plan_versions.copy_blocks` (INV-M4-08) and a rule sentence belongs to the
// account's pinned plan version; none of these strings is a rule. A required
// disclosure is legal copy in `content_documents` and reaches this segment as a
// `DisclosureBlock` through the source port, never as a literal here.
//
// IT IS NOT THE SERVER'S SENTENCE EITHER. `KycStatus.action_required` is
// written by the handler and is rendered verbatim, checked but never
// paraphrased, because a rewritten refusal is a refusal nobody can reconcile
// with the record. Nothing below restates it.
//
// -----------------------------------------------------------------------------
// THE TWO PROMPTS THAT ARE TRANSCRIPTIONS AND NOT DRAFTS
// -----------------------------------------------------------------------------
// `pre_funded` and `second_distinct_account_purchase` are the frozen v1 trigger
// set, and the corpus writes both prompts itself. They are copied character for
// character rather than reworded:
//
//   M04 section 7.9, and M19 section 7.9 in the same words: "You passed. One
//   quick step to activate your funded account, about 2 minutes."
//
//   M19 section 7.9: "Verify once to unlock multiple accounts", "because that
//   is literally what it does".
//
// The other five members of the `placement` CHECK have no drafted sentence in
// the corpus, so theirs are written here under section 7.9's four stated rules:
// lead with what the trader reached, say why in the trader's interest, state
// the time expectation, and never name a suspicion.
// =============================================================================

import type { KycNextStep, KycState } from '../../view/kyc.ts';
import type { PortalErrorKind } from '../../shell/app-shell.ts';

/**
 * `kyc_verifications.placement`, the CHECK list at `0003_kyc.sql:77-85`.
 *
 * TRANSCRIBED FROM THE DDL, and `kyc-page.test.ts` re-derives it from the
 * migration on every run, which is the idiom `apps/portal/test/kyc.test.ts`
 * already uses for `KYC_STATES`. The alternative was importing `@merit/kyc`,
 * which would add a line to `apps/portal/package.json` and that manifest is
 * another session's.
 */
export const KYC_PLACEMENTS = [
  'first_purchase',
  'second_distinct_account_purchase',
  'second_purchase_any',
  'eval_pass',
  'pre_funded',
  'direct_purchase',
  'payout_request',
] as const;

/** One member of the `placement` CHECK. */
export type KycPlacement = (typeof KYC_PLACEMENTS)[number];

/** The screen's own heading and its structural labels. */
export const KYC_SCREEN_COPY = {
  heading: 'Identity verification',
  trigger_label: 'Why you were asked',
  verified_on_label: 'Verified on',
  expires_label: 'Verify again by',
  verified_badge: 'Verified',
  disclosure_label: 'About Merit',
} as const;

/**
 * The state, in a trader's words.
 *
 * `rejected` READS "Not completed" AND THAT IS A DELIBERATE CHOICE OF WORD.
 * Section 7.9's failure row routes to a human and forbids "decisions are
 * final"; a state label that reads as a verdict is the same sentence in a
 * smaller font. What is true is that the check did not complete, and that a
 * person will take it from here.
 */
export const KYC_STATE_COPY: Readonly<Record<KycState, string>> = {
  kyc_required: 'Not started',
  pending: 'In progress',
  verified: 'Verified',
  rejected: 'Not completed',
  expired: 'Out of date',
};

/**
 * The contextual PROMPT for the trigger that raised this verification.
 *
 * ONE SENTENCE PER MEMBER AND NO DEFAULT, which is `NEXT_STEP`'s shape in
 * `view/kyc.ts` and is the same argument: a placement with no sentence would
 * render as the raw wire token, and `second_distinct_account_purchase` on a
 * trader's screen is worse than nothing.
 *
 * IT IS RENDERED ONLY WHERE THE TRADER IS BEING ASKED, and that separation was
 * forced by reading the actual bytes this page produced. Every sentence here is
 * a call to action in the present tense, and the first render of the `verified`
 * and `rejected` states put "You passed. One quick step to activate your funded
 * account" under a heading reading "Why you were asked" on a check that was
 * already finished. `KYC_PLACEMENT_REASON` is the half that is true in every
 * state, and this half is the prompt M04 section 7.9 asks to LEAD with.
 */
export const KYC_PLACEMENT_PROMPT: Readonly<Record<KycPlacement, string>> = {
  // Section 7.9's own sentence, verbatim. It leads with the achievement
  // because "the gate is the consequence of winning, not a checkpoint before
  // being trusted".
  pre_funded: 'You passed. One quick step to activate your funded account, about 2 minutes.',

  // M19 section 7.9, verbatim: framed as unlocking, "because that is literally
  // what it does".
  second_distinct_account_purchase: 'Verify once to unlock multiple accounts.',

  first_purchase: 'A quick identity check comes with your first purchase, about 2 minutes.',
  second_purchase_any: 'Verify once to unlock further purchases, about 2 minutes.',
  eval_pass: 'You passed your evaluation. One quick step to continue, about 2 minutes.',

  // INV-M19-02: instant funding leaves no later moment, so the check happens
  // at purchase. The sentence says that rather than implying a suspicion.
  direct_purchase: 'Your account funds immediately, so the identity check happens now.',

  // ADR-021 keeps this as a backstop and never as a sole trigger. If a trader
  // ever reads this line, an earlier trigger did not fire, and the sentence is
  // written for the person rather than for the defect.
  payout_request: 'One quick identity check before your first payout, about 2 minutes.',
};

/**
 * Why the trader was asked, in a form that stays true after the check is over.
 *
 * A NOUN PHRASE AND NEVER AN INSTRUCTION. This is the line the `verified`,
 * `pending` and `rejected` states carry, and a trader reading their own
 * finished verification is being told what raised it rather than being asked to
 * do it again.
 */
export const KYC_PLACEMENT_REASON: Readonly<Record<KycPlacement, string>> = {
  first_purchase: 'Your first purchase.',
  second_distinct_account_purchase: 'Unlocking more than one account.',
  second_purchase_any: 'Your second purchase.',
  eval_pass: 'Passing your evaluation.',
  pre_funded: 'Activating your funded account.',
  direct_purchase: 'Your account funds immediately at purchase.',
  payout_request: 'Your first payout.',
};

/**
 * The next control, as a label for the shape `view/kyc.ts` decided.
 *
 * `wait` AND `none` HAVE NO LABEL AND THE ABSENCE IS THE POINT. Section 7.9:
 * "Repeated prompting reads as accusation regardless of wording", so the
 * pending state carries no control at all, and the verified state is a status
 * the trader keeps rather than an action they take.
 */
export const KYC_NEXT_STEP_COPY: Readonly<Record<KycNextStep, string | null>> = {
  verify: 'Start verification, about 2 minutes',
  wait: null,
  contact_support: 'Contact support',
  none: null,
};

/**
 * The three content states that carry no status, plus the error vocabulary.
 *
 * NO MEMBER HERE READS AS A REFUSAL OF PERMISSION. `PortalErrorKind` has no
 * `forbidden` member for INV-M4-07's reasons, and the copy must not reinstate
 * by wording what the type refuses to carry.
 */
export const KYC_CONTENT_COPY: Readonly<Record<PortalErrorKind | 'loading' | 'empty', string>> = {
  loading: 'Loading your verification status.',
  empty: 'There is nothing to show here yet.',
  not_found: 'We could not find that.',
  unauthenticated: 'Please sign in again to see this.',
  rate_limited: 'That was a lot of requests at once. Try again in a moment.',
  server_error: 'We could not load this just now. Try again shortly.',
  unexpected: 'Something did not go as expected. Try again shortly.',
};

/**
 * Every trader-facing string this segment renders, flattened.
 *
 * THE LINT'S INPUT, and it is derived from the objects above rather than
 * maintained beside them, so a string added to any catalogue joins the check
 * without anybody remembering to add it.
 */
export function traderFacingStrings(): readonly string[] {
  return [
    ...Object.values(KYC_SCREEN_COPY),
    ...Object.values(KYC_STATE_COPY),
    ...Object.values(KYC_PLACEMENT_PROMPT),
    ...Object.values(KYC_PLACEMENT_REASON),
    ...Object.values(KYC_NEXT_STEP_COPY).filter((value): value is string => value !== null),
    ...Object.values(KYC_CONTENT_COPY),
  ];
}
