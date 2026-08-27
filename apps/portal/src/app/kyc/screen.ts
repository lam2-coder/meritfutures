// =============================================================================
// apps/portal/src/app/kyc/screen.ts
// =============================================================================
// SC-M4-07 AS A RENDERED DOCUMENT. M04 section 3.1's one thing it must get
// right: "Four honest states, and what to do in each", against the five the
// `kyc_status` enum declares.
//
// THIS FILE RENDERS STATUS AND NEVER A DOCUMENT. There is no element below that
// takes an image source, no element that takes a provider URL, and nothing that
// reads a field outside `KycStatusView`. `source.ts` carries the argument and
// the two enforcement points; what this file adds is that the render path
// itself names five fields and has no line that could emit a sixth.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO JSX IN A REACT FILE, WHICH WAS MEASURED RATHER THAN PREFERRED
// -----------------------------------------------------------------------------
// ADR-095 foreclosure F7: ".tsx arrives with the first page, so
// tsconfig.base.json's 'the apps are bundled by their own frameworks' stops
// being a forward reference and each app's tsconfig gains `jsx` and a `dom`
// lib", and it assigns that edit to the slice that writes the first page.
//
// SIX SLICES ARE WRITING A FIRST PAGE AT ONCE. Sessions 250 and 259 to 264 hold
// six segments under one `apps/portal/tsconfig.json`, which is in none of their
// fences, and it is ADR-114 section 6's collision in a different file: six
// branches editing one line. Executed on this tree rather than assumed:
//
//   a `.tsx` file imported from a `.ts` one, with the tsconfig untouched:
//     error TS6142: Module './probe.tsx' was resolved to ... but '--jsx' is
//     not set.
//
//   the same component written with `createElement` in a `.ts` file:
//     `pnpm --filter @merit/portal run typecheck` exits 0, unchanged.
//
// So this segment is written in the spelling that needs no shared edit, and the
// tsconfig line is reported to whoever holds it rather than taken. JSX compiles
// to exactly these calls; nothing about the rendered output differs.
//
// -----------------------------------------------------------------------------
// THE SHELL IS RENDERED HERE BECAUSE THERE IS NO LAYOUT YET, AND THAT IS ONE
// LINE TO UNDO
// -----------------------------------------------------------------------------
// ADR-068 requirement 4, through M04 section 3.9, makes the impersonation band
// SHELL CHROME: "on all of section 3.1's screens AND ON EVERY ERROR, EMPTY AND
// LOADING STATE." INV-M4-09 makes the disclosure the same kind of thing.
// SC-M4-07 is one of section 3.1's screens, so this page cannot render without
// both, and `app/layout.tsx` is session 250's and has not landed.
//
// `KycShell` below is therefore a component of this segment rather than a
// borrowed layout, and when the root layout arrives the page composes that
// instead. Nothing is invented in the meantime: the chrome is assembled by
// `toShellView`, which is the shell module's own function, and both obligations
// are its required fields.
// =============================================================================

import { createElement, type ReactElement, type ReactNode } from 'react';

import type { ContentState, ShellView } from '../../shell/app-shell.ts';
import type { ImpersonationBannerView } from '../../shell/impersonation-banner.ts';
import type { KycStatus } from '../../api/types.ts';
import { toShellView } from '../../shell/app-shell.ts';
import { toKycStatusView, type KycStatusView } from '../../view/kyc.ts';
import {
  KYC_CONTENT_COPY,
  KYC_NEXT_STEP_COPY,
  KYC_PLACEMENTS,
  KYC_PLACEMENT_PROMPT,
  KYC_PLACEMENT_REASON,
  KYC_SCREEN_COPY,
  KYC_STATE_COPY,
  type KycPlacement,
} from './copy.ts';
import type { PublishedDisclosure } from './source.ts';

const h = createElement;

/** A `placement` the `0003_kyc.sql` CHECK cannot produce. */
export class UnknownPlacementError extends Error {
  constructor(readonly placement: string) {
    super(
      `"${placement}" is not a member of the kyc_verifications.placement CHECK ` +
        `(${KYC_PLACEMENTS.join(', ')}, declared at 0003_kyc.sql:77-85). The screen refuses ` +
        'rather than rendering the raw token, because the trigger line is a sentence written ' +
        'for a person and an unmapped member has none.',
    );
    this.name = 'UnknownPlacementError';
  }
}

function toPlacement(placement: string): KycPlacement {
  const found = KYC_PLACEMENTS.find((member) => member === placement);
  if (found === undefined) throw new UnknownPlacementError(placement);
  return found;
}

/** What the ready screen shows, and there is nothing else it can show. */
export type KycScreenContent = {
  readonly status: KycStatusView;
  readonly placement: KycPlacement;
};

/** SC-M4-07 assembled: the chrome, and the content when there is any. */
export type KycScreenView = {
  readonly shell: ShellView;
  /** Present exactly when `shell.content.kind` is `ready`. */
  readonly content: KycScreenContent | null;
};

/**
 * The ready screen, from the wire.
 *
 * THE STATUS GOES THROUGH `toKycStatusView` AND NOT AROUND IT. That function is
 * SC-M4-07's two refusals, an unknown state and M04 section 7.9's vocabulary,
 * and a page that projected the wire shape itself would be a second, weaker
 * copy of a check that already exists.
 */
export function toKycScreenView(input: {
  readonly status: KycStatus;
  readonly impersonation: ImpersonationBannerView | null;
  readonly disclosure: PublishedDisclosure;
}): KycScreenView {
  const status = toKycStatusView(input.status);
  return {
    shell: toShellView({
      impersonation: input.impersonation,
      simulated_environment_disclosure: input.disclosure.text,
      content: { kind: 'ready' },
    }),
    content: { status, placement: toPlacement(status.placement) },
  };
}

/**
 * Every state that carries no status.
 *
 * `ready` IS EXCLUDED BY THE TYPE. A placeholder built with `kind: 'ready'`
 * would render chrome around nothing, which is the blank screen SC-M4-07 exists
 * to prevent, and the exclusion means it cannot be written.
 */
export function toKycScreenPlaceholder(input: {
  readonly content: Exclude<ContentState, { readonly kind: 'ready' }>;
  readonly impersonation: ImpersonationBannerView | null;
  readonly disclosure: PublishedDisclosure;
}): KycScreenView {
  return {
    shell: toShellView({
      impersonation: input.impersonation,
      simulated_environment_disclosure: input.disclosure.text,
      content: input.content,
    }),
    content: null,
  };
}

function band(impersonation: ImpersonationBannerView | null): ReactNode {
  if (impersonation === null) return null;
  // A RESERVED BAND AND NEVER AN OVERLAY, which is the banner module's own
  // literal type. It is first in document order so it is first for a screen
  // reader too, and it carries no dismiss control because there is no field
  // for one.
  return h(
    'aside',
    { 'data-band': impersonation.placement, role: 'status' },
    h('p', null, impersonation.reason_detail),
  );
}

function definition(term: string, value: ReactNode): readonly ReactElement[] {
  return [h('dt', { key: `${term}-t` }, term), h('dd', { key: `${term}-d` }, value)];
}

function stamp(value: string): ReactElement {
  // THE TIMESTAMP IS RENDERED AS THE SERVER SENT IT, inside the element that
  // carries a machine-readable copy. Formatting a UTC instant into a trading
  // day is `view/as-of.ts`'s subject and another segment's, and a page that
  // guessed a timezone here would be making a claim about when Merit did
  // something.
  return h('time', { dateTime: value }, value);
}

function ready(content: KycScreenContent): ReactElement {
  const { status, placement } = content;
  const nextStep = KYC_NEXT_STEP_COPY[status.next_step];

  const rows: ReactElement[] = [
    ...definition(KYC_SCREEN_COPY.trigger_label, KYC_PLACEMENT_REASON[placement]),
  ];
  if (status.verified_at !== null)
    rows.push(...definition(KYC_SCREEN_COPY.verified_on_label, stamp(status.verified_at)));
  if (status.expires_at !== null)
    rows.push(...definition(KYC_SCREEN_COPY.expires_label, stamp(status.expires_at)));

  return h(
    'section',
    { 'data-state': status.state },

    // ONE CONTEXTUAL PROMPT, LEADING WITH THE ACHIEVEMENT, and only where the
    // trader is actually being asked. M04 section 7.9's first row, and its
    // second row is why there is exactly one: after the prompt, "a dashboard
    // card that waits", because "repeated prompting reads as accusation
    // regardless of wording".
    //
    // THE CONDITION IS THE CONTROL SHAPE AND NOT THE STATE, so `kyc_required`
    // and `expired` both lead with it and a finished check never does. Reading
    // the state here would be a second, drifting copy of `NEXT_STEP`.
    status.next_step === 'verify'
      ? h('p', { 'data-field': 'prompt' }, KYC_PLACEMENT_PROMPT[placement])
      : null,

    h('p', { 'data-field': 'state' }, KYC_STATE_COPY[status.state]),

    // THE VERIFIED BADGE IS PERMANENT AND VISIBLE. M04 section 7.9: "A status
    // the trader keeps, not a gate they passed and cannot confirm." It follows
    // `verified`, which the view model reads off the STATE, so an expired
    // verification carrying a `verified_at` does not show one.
    status.verified ? h('p', { 'data-badge': 'verified' }, KYC_SCREEN_COPY.verified_badge) : null,

    h('dl', null, rows),

    // THE SERVER'S SENTENCE, VERBATIM. `toKycStatusView` has already refused it
    // if it carries an internal-tier word; this file does not paraphrase it,
    // because a rewritten refusal is a refusal nobody can reconcile with the
    // record.
    status.action_required !== null
      ? h('p', { 'data-field': 'action_required' }, status.action_required)
      : null,

    // THE CONTROL IS A SHAPE AND ITS WORDS COME FROM THE CATALOGUE. `wait` and
    // `none` render no control at all, which is section 7.9's rule that
    // repeated prompting reads as accusation regardless of wording.
    //
    // IT CARRIES NO HANDLER AND MUST NEVER CARRY A SERVER ACTION. Starting a
    // hosted flow is `POST /kyc/session` on the API origin; a Server Action
    // here would serve that surface from this deployable, which ADR-095 ruling
    // 3 forbids, and one that went and got a document would break ADR-114
    // clause 6 in the same line.
    nextStep === null
      ? null
      : h('button', { type: 'button', 'data-next-step': status.next_step }, nextStep),
  );
}

function placeholder(content: ContentState): ReactElement {
  if (content.kind === 'ready')
    // Unreachable through `toKycScreenPlaceholder`, whose type excludes it.
    // Kept honest rather than cast away: an exhaustive switch that lies about
    // one branch is how the blank screen arrives.
    throw new Error('a ready content state carries a status and is not a placeholder');
  const key = content.kind === 'error' ? content.error : content.kind;
  return h('section', { 'data-content': key }, h('p', null, KYC_CONTENT_COPY[key]));
}

/**
 * SC-M4-07.
 *
 * ONE ARGUMENT AND IT IS THE ASSEMBLED VIEW. No options, no flags, nothing from
 * client state, and no `Promise` anywhere in this file: the whole render is
 * synchronous and pure, which is what lets the suite hand it a payload and read
 * the bytes it produced.
 */
export function KycScreen(props: { readonly view: KycScreenView }): ReactElement {
  const { shell, content } = props.view;
  return h(
    'article',
    { 'data-screen': 'SC-M4-07' },
    band(shell.impersonation),
    h(
      'main',
      null,
      h('h1', null, KYC_SCREEN_COPY.heading),
      content === null ? placeholder(shell.content) : ready(content),
    ),

    // INV-M4-09'S FOOTER, AND IT IS OUTSIDE EVERY BRANCH ABOVE. Constitution
    // section 6 makes it a compliance obligation rather than a design
    // preference, so there is no content state that can drop it: the shell's
    // field is required, `disclosureBlock()` refuses a blank one, and this
    // element is a sibling of the branch rather than inside it.
    h(
      'footer',
      { 'data-disclosure': 'simulated-environment' },
      h('h2', null, KYC_SCREEN_COPY.disclosure_label),
      h('p', null, shell.simulated_environment_disclosure),
    ),
  );
}
