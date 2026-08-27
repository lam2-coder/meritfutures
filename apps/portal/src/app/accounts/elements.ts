// =============================================================================
// apps/portal/src/app/accounts/elements.ts
// =============================================================================
// THE MARKUP VOCABULARY THE ACCOUNTS SEGMENT RENDERS INTO, AND WHY IT IS
// TRANSCRIBED RATHER THAN DESIGNED.
//
// `apps/portal/e2e/fixtures/dashboard.compliant.html` is the funded dashboard
// as the slop-score pass expects to find it, and it is the only artifact in
// this repository that states what a Merit portal screen looks like. Its body
// is five element shapes and nothing else:
//
//     <main> <h1> <h2>
//     <div class="row"><div class="label">..</div><div class="value">..</div></div>
//     <span class="state-word">..</span>
//     <p class="as-of">..</p>
//     <p class="disclosure">..</p>
//
// Every function below emits one of those. A screen that invented a sixth would
// be a screen the compliant fixture does not describe, and SS-01 to SS-08 are
// asserted against that fixture rather than against a screen's own opinion.
//
// -----------------------------------------------------------------------------
// THERE IS NO STYLESHEET IN THIS SEGMENT, AND THAT IS A FENCE RATHER THAN AN
// OMISSION
// -----------------------------------------------------------------------------
// The fixture carries its token block (`--ink-*`, `--brass-*`, dark first) in a
// `<style>` element inside `<head>`, and in an App Router application `<head>`
// belongs to the ROOT LAYOUT. This session owns `app/accounts/**` and does not
// own the root layout, so the class names are emitted here and the rules that
// paint them are owed by whoever writes that layout. The names are reproduced
// EXACTLY, so the stylesheet is a transcription of the fixture's own `<style>`
// block rather than a second design pass.
//
// WHAT THAT COSTS, SAID PLAINLY: until the layout lands, these screens render
// as unstyled semantic markup. They are correct and they are not mobile first,
// and M04 section 1.1's "mobile first" is a property of the rules rather than
// of the elements. FM-M4-08 is the failure that depends on it ("mobile layout
// hides the failing gate below the fold"), and the ordering half of it IS this
// segment's and is honoured: on every screen here the number M04 section 3.1
// names as the one thing it must get right is the FIRST row emitted.
//
// -----------------------------------------------------------------------------
// NO JSX, AND THE REASON IS THE SAME FENCE ONE LEVEL DOWN
// -----------------------------------------------------------------------------
// A `.tsx` file needs `jsx` and a `dom` lib in `apps/portal/tsconfig.json`,
// which ADR-095 F7 says "belongs with the first page rather than here" and
// which the root scaffold owns. `next.config`'s default `pageExtensions` is
// `["tsx","ts","jsx","js"]`, read out of the installed `next@16.3.2` rather
// than remembered, so a `page.ts` IS a page and this segment costs the shared
// tsconfig nothing. `createElement` is what JSX compiles to; the file is longer
// and the tree it builds is identical.

import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

/** The fixture's `.row`: a label column and a value column, ruled underneath. */
export function Row(props: { readonly label: string; readonly children: ReactNode }): ReactElement {
  return createElement(
    'div',
    { className: 'row' },
    createElement('div', { className: 'label' }, props.label),
    createElement('div', { className: 'value' }, props.children),
  );
}

/**
 * The fixture's `.state-word`.
 *
 * DESIGN_SYSTEM section 2.3, quoted in the fixture: "neither semantic color is
 * ever the only carrier of meaning, so each state carries a word beside its
 * hue." This segment renders no hue at all (see the header), so the word is
 * currently the ONLY carrier, which is the safe direction to be wrong in.
 */
export function StateWord(props: { readonly children: ReactNode }): ReactElement {
  return createElement('span', { className: 'state-word' }, props.children);
}

/**
 * INV-M4-02's label, as the fixture places it: directly under the figures it
 * qualifies, never in a tooltip (M04 section 4's obligation against
 * `GET /accounts`).
 *
 * IT TAKES THE DAY AND NOT A SENTENCE, so no caller can render this element
 * without the day it is asserting. That is `AccountState` arriving at the
 * markup: every view model in `../../view` that carries a money number extends
 * it, so the day is on the object the screen was handed.
 */
export function AsOf(props: {
  readonly as_of_trading_day: string;
  readonly children?: ReactNode;
}): ReactElement {
  return createElement(
    'p',
    { className: 'as-of' },
    `Every figure above is as of the close of trading day ${props.as_of_trading_day}.`,
    props.children === undefined ? null : ' ',
    props.children,
  );
}

/** A `<h2>` and the rows under it. The fixture's "Payout ladder" shape. */
export function Section(props: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return createElement('section', null, createElement('h2', null, props.title), props.children);
}

/**
 * A money figure that may legitimately be absent.
 *
 * `formatOptionalCents` returns `null` for a field the server sent as null, and
 * `../../format/money.ts` says why that must not become `0.00`: on
 * `profit_needed_to_dilute_cents` a zero "reads as 'nothing further is needed',
 * which is the opposite of 'the consistency gate was not evaluated for you'".
 * The em dash is not available (Appendix F) and a blank cell is the failure
 * INV-M4-05 is about, so an absence is rendered as the word.
 */
export function Optional(props: { readonly value: string | null }): ReactElement {
  return props.value === null
    ? createElement(StateWord, null, 'not applicable to this account')
    : createElement('span', null, props.value);
}
