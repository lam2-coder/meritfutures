// =============================================================================
// apps/admin/src/app/liability-home.tsx
// =============================================================================
// M06 SECTION 3.1 AS A DOCUMENT, BUILT FROM THE PAGE VALUE AND NEVER FROM A
// LINE ARRAY.
//
// `buildLiabilityHome` (`../page.ts`) returns a `LiabilityHomePage`: a
// verdict, a banner, panels in page order, the live figure and the panels
// nobody supplies. THIS FILE IS THE ONLY THING IN THIS PACKAGE THAT TURNS THAT
// VALUE INTO BYTES A BROWSER RECEIVES, and everything below follows from that
// one sentence.
//
// -----------------------------------------------------------------------------
// 1. THE VERDICT IS INHERITED. IT IS NEVER RECOMPUTED HERE
// -----------------------------------------------------------------------------
// This module imports nothing from `../data-trust.ts` and calls
// `assessDataTrust` nowhere. It reads `page.dataTrust.verdict`, `page.banner`
// and `panel.suspect`, all of which were decided once, by the read that
// produced the numbers. A console that recomputed the verdict would be a second
// opinion where M06 section 3.1 requires one: "If anything here is red, every
// number above it is suspect and the page says so."
//
// -----------------------------------------------------------------------------
// 2. THE FIGURES ARE RENDERED BY `figure.ts` AND NOT BY THIS FILE
// -----------------------------------------------------------------------------
// `PanelRendering.lines` is already the figure text: the label, the amount
// through `formatCents`, the definition, the as-of, the source, the age at
// render, and the `SUSPECT, data trust is red: ` prefix on every line of every
// panel below a red board (FM-M6-01, "a screenshot of a styled page pasted into
// a message loses the style and keeps the number").
//
// So the document renders those strings as its leaves and builds STRUCTURE
// around them. Reading `panel.readings` and formatting them here would be a
// second renderer of a `Figure` in a package whose whole subject is that a
// number carries its definition, its as-of and its source (INV-M6-04), and the
// two copies would diverge on the first change to either.
//
// **THAT IS NOT THE SAME AS RENDERING `renderLiabilityHome`'s OUTPUT.** That
// function flattens the page into one array of strings, in page order, and
// WAVE-06 section 5.2 is explicit that the lines are not deleted and are not
// the page. It stays: `test/page.test.ts` reads it, and a flat transcript of
// the page is the right shape for an assertion over words. What this document
// takes from the value is its SHAPE, and only the leaves are its strings.
//
// -----------------------------------------------------------------------------
// 3. THE `INV-M6-10` ASSERTION IS RE-POINTED AT WHAT THE BROWSER RECEIVES
// -----------------------------------------------------------------------------
// WAVE-06 rule 4: "AN ASSERTION THAT CANNOT REACH THE SERVED BYTES IS NOT AN
// ASSERTION." Section 5.2 states the failure it exists to prevent: a React page
// renders a DOM rather than a line array, so an `assertNamesNoSubject` still
// reading the array after the page exists is an assertion about something
// nobody serves, and both suites stay green.
//
// `assertServedLiabilityHomeStrings` runs the SAME exported assertion over
// every string this document serves: each text node AND each attribute value,
// collected from the element tree the route returns.
//
// **IT IS THE ELEMENT TREE AND NOT `renderToStaticMarkup`'s STRING, AND THAT IS
// THE FRAMEWORK'S RULING RATHER THAN A PREFERENCE.** The first shape written
// here rendered the tree to markup and swept the markup. `next build` refuses
// it, in its own words: "You're importing a component that imports
// react-dom/server. To fix it, render or return the content directly as a
// Server Component instead for perf and security." Measured, not predicted: the
// build exited 1 naming this file and the import trace through `page.tsx`. So
// the walk below reads the same tree that renderer would have read, one step
// before it becomes bytes, and `test/render.test.ts` proves the two agree by
// doing the markup render THERE, where the restriction does not apply, and
// asserting that every string this walk collects is in it.
//
// **IT REFUSES WHAT IT CANNOT RESOLVE RATHER THAN SKIPPING IT.** A walk that
// silently ignored a node shape it did not understand would be a control that
// stops covering a screen on the day that screen grows a new kind of node,
// while staying green. Every branch is either collected, recursed into, or
// thrown on.
//
// THREE PROPERTIES OF THE RESULT, each covered in `test/render.test.ts`:
//
//   IT IS WIDER THAN THE CALL INSIDE THE BUILDER. `buildLiabilityHome` applies
//   `assertNamesNoSubject` to `panels.flatMap(lines)` (`../page.ts`), which is
//   the panels and nothing else. The live figure's line and the pending panels'
//   lines are on the page and are not in that array, and the live figure's
//   `source` is a string a FEED SUPPLIES (`movement.feed`, reaching
//   `asOf.source` in `../live-liability.ts`). A subject name arriving that way
//   is served today and the builder's own assertion cannot see it. The suite
//   watches exactly that seed fail here and pass there.
//
//   IT IS WIDER THAN THE TEXT. An attribute value is served too, so a subject
//   id on a `data-` attribute or an `href` is inside the sweep. This document
//   puts nothing in an attribute that is not also in its text, so that width is
//   scope rather than a defect it alone catches today; the screens `W6-f` and
//   `W6-g` add are where a subject id reaches a link.
//
//   IT COSTS ONE WALK OF A TREE ALREADY IN HAND, on a value the route just
//   built, with no second render and no second copy of the document.
//
// -----------------------------------------------------------------------------
// 4. NO ORIGIN AND NO SUBJECT IS RENDERED
// -----------------------------------------------------------------------------
// `page.origin` is `resolveAdminOrigin`'s value and it is deliberately absent
// from the document. ADR-012 keeps the admin domain out of every artifact, and
// a console printing its own hostname into a page an operator screenshots is
// the one artifact that leaves the origin looking like a caption. Nothing here
// needs it: every URL this console builds is root relative
// (`../http/client.ts`), which is ADR-182 section 5 clause 2.

import { Fragment, type ReactElement, isValidElement } from 'react';

import { readingIsPresent, render } from '../figure.ts';
import {
  type LiabilityHomePage,
  PageError,
  type PanelRendering,
  ageAtRender,
  assertNamesNoSubject,
} from '../page.ts';

/**
 * One panel, with its lines as list items.
 *
 * `data-suspect` CARRIES THE FLAG AND THE LINES CARRY THE WORD. The attribute
 * is for a test and for a stylesheet; the word `SUSPECT` is already inside
 * every line `../page.ts` produced under a red board, which is FM-M6-01's
 * requirement that the refusal survive a screenshot.
 */
function Panel({ panel, banner }: { readonly panel: PanelRendering; readonly banner: string }) {
  return (
    <section data-origin={panel.origin} data-suspect={String(panel.suspect)}>
      <h2>
        [{panel.origin}] {panel.title}
      </h2>
      <ul>
        {/*
          THE BANNER IS DROPPED HERE AND NOWHERE ELSE. `page.banner` and the
          trust panel's statement are the same string by construction, so the
          document would otherwise print one sentence twice: once where every
          number is below it and once inside the panel that produced it. The
          filter is on VALUE rather than on an index, so if the two ever stop
          being the same string both are printed rather than one silently lost.
        */}
        {panel.lines
          .filter((line) => line !== banner)
          .map((line) => (
            <li key={line}>{line}</li>
          ))}
      </ul>
    </section>
  );
}

/** Section 3.5's figure, or the stated refusal to compute one. */
function LiveOpenLiabilityLine({ page }: { readonly page: LiabilityHomePage }) {
  if (page.live.kind === 'suppressed')
    return (
      <p data-testid="live-open-liability" data-live="suppressed">
        Open liability, live: {page.live.reason}
      </p>
    );

  // An absent reading prints nothing, which is `renderLiabilityHome`'s own
  // branch and is mirrored rather than re-decided: the live figure is either a
  // number with its terms or a stated suppression, and a third rendering would
  // be a state M06 section 3.5 does not name.
  const { reading } = page.live;
  if (!readingIsPresent(reading)) return null;

  return (
    <p data-testid="live-open-liability" data-live="indicative">
      {`${render(reading)} (${ageAtRender(reading.figure.asOf, page.renderedAt)})`}
    </p>
  );
}

/**
 * The whole document for one `LiabilityHomePage`.
 *
 * PURE, AND A FUNCTION OF THE VALUE ALONE. No clock, no environment and no
 * read: `renderedAt` is on the page because `../page.ts` refused an ambient
 * one, and this file inherits that refusal by having nothing else to read.
 */
export function LiabilityHomeDocument({
  page,
}: {
  readonly page: LiabilityHomePage;
}): ReactElement {
  return (
    <article data-testid="liability-home" data-trust={page.dataTrust.verdict}>
      <h1>Liability home</h1>

      {/*
        P-M6-09 ABOVE EVERY NUMBER, WHICH IS M06 SECTION 3.1's LAYOUT AND ITS
        ARGUMENT: "Rendering them adjacent, with the trust panel above, is the
        difference between a dashboard and a dashboard that misleads." The
        position is asserted over the served bytes in `test/render.test.ts`
        rather than over this file, because the requirement is about what an
        operator reads first.
      */}
      <p data-testid="data-trust-banner">{page.banner}</p>

      <p data-testid="render-stamp">
        Rendered at {page.renderedAt}, role {page.role}. Every age below is measured from that
        instant.
      </p>

      {page.panels.map((panel) => (
        <Panel key={panel.origin} panel={panel} banner={page.banner} />
      ))}

      <LiveOpenLiabilityLine page={page} />

      <section data-testid="pending-panels">
        <h2>Panels M06 defines and no supplier fills</h2>
        <ul>
          {page.pending.map((pending) => (
            <li key={pending.origin} data-origin={pending.origin}>
              {`[${pending.origin}] ${pending.title}: NOT BUILT, blocked by ${pending.blockedBy}`}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/**
 * Every string this document serves: each text node and each attribute value.
 *
 * IT RESOLVES FUNCTION COMPONENTS BY CALLING THEM, which is what a renderer
 * does and is sound here for the reason the header gives: every component in
 * this file is a pure synchronous function of its props, with no state, no
 * effect and no read. A component that stopped being one would be a component
 * this walk throws on rather than one it quietly skips.
 */
export function servedLiabilityHomeStrings(page: LiabilityHomePage): readonly string[] {
  const served: string[] = [];
  collectServedStrings(<LiabilityHomeDocument page={page} />, served);
  return served;
}

/**
 * One node's served strings, appended to `served`.
 *
 * EXPORTED SO ITS REFUSAL IS TESTABLE. The header's claim is that this walk
 * refuses what it cannot resolve rather than skipping it, and a refusal nothing
 * exercises is a comment. `test/render.test.ts` feeds it the two shapes it
 * throws on.
 */
export function collectServedStrings(node: unknown, served: string[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string') {
    served.push(node);
    return;
  }
  if (typeof node === 'number') {
    served.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectServedStrings(child, served);
    return;
  }
  if (!isValidElement(node))
    throw new PageError(
      'the liability home document holds a node this sweep cannot read, so INV-M6-10 would ' +
        'stop covering part of what is served. Refused rather than skipped',
    );

  const props: Record<string, unknown> =
    typeof node.props === 'object' && node.props !== null
      ? (node.props as Record<string, unknown>)
      : {};

  // The Fragment check is FIRST because it is the one element type that is
  // neither a string nor a function, and asking about it after the narrowing
  // below is a comparison the type checker refuses.
  if (node.type === Fragment) {
    collectServedStrings(props['children'], served);
    return;
  }

  if (typeof node.type === 'function') {
    const component = node.type as (input: Record<string, unknown>) => unknown;
    collectServedStrings(component(props), served);
    return;
  }

  if (typeof node.type !== 'string')
    throw new PageError(
      'the liability home document holds an element whose type this sweep cannot render, so ' +
        'INV-M6-10 would stop covering it. Refused rather than skipped',
    );

  for (const [name, value] of Object.entries(props)) {
    if (name === 'children') continue;
    if (typeof value === 'string' || typeof value === 'number') served.push(String(value));
  }
  collectServedStrings(props['children'], served);
}

/**
 * `INV-M6-10` over what the browser receives. Section 3 of this file's header.
 *
 * It throws the same `PageError` the builder's own call throws, because it is
 * the same assertion: a second error type for one invariant would be a second
 * place to read what the invariant means.
 */
export function assertServedLiabilityHomeStrings(page: LiabilityHomePage): readonly string[] {
  const served = servedLiabilityHomeStrings(page);
  assertNamesNoSubject(served);
  return served;
}

/**
 * The document, with what it serves asserted before it is served.
 *
 * THE ROUTE CALLS THIS AND NEVER `LiabilityHomeDocument` DIRECTLY, so the
 * control is on the path rather than in the suite. The suite is what proves the
 * control fires (`test/render.test.ts`); this is what puts it in front of an
 * operator.
 */
export function renderLiabilityHomeDocument(page: LiabilityHomePage): ReactElement {
  assertServedLiabilityHomeStrings(page);
  return <LiabilityHomeDocument page={page} />;
}
