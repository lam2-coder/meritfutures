// =============================================================================
// apps/site/src/routes/og.ts
// =============================================================================
// THE OG IMAGE PATH, WHICH UNTIL THIS FILE EXISTED WAS FOUR COMMENTS.
//
// [Session 186](docs/sessions/2026-08-24-session-186.md) measured it and
// recorded the result rather than assuming it: a case-insensitive grep for "og
// image" and for "opengraph" over `apps` and `packages` returned four sites and
// every one of them was a comment. `assertWindowAttached` existed and bound its
// call sites; the surface GS-144 names as the one that matters had none. That
// is why GS-144's row stayed `blocked` on a day when two tests naming it passed.
//
// AS-M9-03, in its own words: "Every published statistic carries its trailing
// window and its as-of trading day **in the same visual unit as the number**,
// not in a caption and not in a footnote. This binds the OG image and every
// social card too, **which is where screenshots actually come from**."
//
// -----------------------------------------------------------------------------
// THE CARD CANNOT BE BUILT WITH A BARE FIGURE, AND THAT IS STRUCTURAL RATHER
// THAN CHECKED
// -----------------------------------------------------------------------------
// There are exactly two ways a number reaches a card built here:
//
//   1. `statisticText`, which is the only accessor `stats.ts` publishes and
//      which emits the value, the window, the as-of day and the sample as ONE
//      string. There is no `justTheValue` there and there is no way to ask for
//      one here.
//   2. Prose, which passes VG-M9-2 first. A bare figure in `title` or
//      `description` fails the build on the same rule and with the same message
//      it would fail on in the body.
//
// A caller cannot pass `RenderedStatistic['value']`, because the input type does
// not accept a string in that position: it accepts the rendered row, and this
// file does the extraction. The adversary AS-M9-03 names is a crop, and a crop
// takes what the template put there.
//
// THE ALT TEXT IS A SURFACE AND NOT A LABEL. It is text an aggregator reads and
// a screen reader speaks, so it carries the same figure and gets the same lint.
// A card whose image is honest and whose alt text says "90% pass rate" has
// published the number without its window in the one place nobody reviews.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT
// -----------------------------------------------------------------------------
// IT RENDERS NO IMAGE. An OG image is produced by the framework at the route
// `CI-07`'s stage compiles, and no framework compiles anything in this package
// yet. What it owns is the MODEL: the strings that go onto the card and the
// refusal that stops a bad one being built. That split is this package's
// throughout ("every surface is a pure function from config to a page model"),
// and it is what makes M9 section 8.3's coverage rule a test over values.
// =============================================================================

import { assertAuthoredContentIsClean } from '../content/lint.ts';
import type { RenderedStatistic } from './stats.ts';
import { assertWindowAttached, statisticText } from './stats.ts';
import type { PageEnvelope } from './page.ts';

/** The social card for one page. Every field is text a crop can carry away. */
export interface OgCard {
  /** The page this card represents. */
  readonly path: string;
  /** The image route the framework will serve, derived rather than passed. */
  readonly image_path: string;
  readonly title: string;
  readonly description: string;
  /**
   * The figure, with its window, its as-of day and its sample, as one string.
   *
   * `null` when the card carries no statistic. Never a bare value: the only
   * producer is `statisticText`.
   */
  readonly statistic: string | null;
  /** Spoken and indexed, so it is linted like every other surface. */
  readonly alt: string;
}

/** What a caller supplies. Note what is ABSENT: any string-typed figure. */
export interface OgCardInput {
  readonly envelope: PageEnvelope;
  readonly title: string;
  readonly description: string;
  readonly alt: string;
  /**
   * The rendered row, never a value pulled off it.
   *
   * Typing this as `RenderedStatistic` rather than `string` is the control.
   * A `string` here would let a call site pass `rendered.value`, and
   * AS-M9-03's screenshot is exactly that call site eighteen months later.
   */
  readonly statistic?: RenderedStatistic | null;
}

/** The refusal a card earns. */
export class OgCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OgCardError';
  }
}

/**
 * INV-M9-04's derivation, one surface further down.
 *
 * The image address is DERIVED from the page's own path rather than passed,
 * for the reason `derivedPaths` exists: an invalidation set that is listed
 * drifts from the set that is served, and a card whose image path was typed by
 * hand is a card that can point at another page's image.
 */
export function ogImagePath(path: string): string {
  return path === '/' ? '/opengraph-image' : `${path}/opengraph-image`;
}

/**
 * Build the social card for a page, or fail the build.
 *
 * GS-144's second leg, executable. Three refusals, and the first two are the
 * ones a lint written in a hurry leaves out.
 */
export function ogCard(input: OgCardInput): OgCard {
  // 1. Every text surface on the card gets VG-M9-2, the same lint the body
  //    gets. A bare figure on a card is the body's defect on the surface that
  //    circulates.
  assertAuthoredContentIsClean(input.title, `${input.envelope.path} og_title`);
  assertAuthoredContentIsClean(input.description, `${input.envelope.path} og_description`);
  assertAuthoredContentIsClean(input.alt, `${input.envelope.path} og_image_alt`);

  // 2. A statistic on the card runs the SAME assertion the page runs. GS-144's
  //    first leg was executable and bound only its call sites; this is a call
  //    site, and it is the one the row names.
  const statistic = input.statistic ?? null;
  if (statistic !== null) assertWindowAttached(statistic);

  // 3. A card that claims nothing is a card with nothing to crop, and an empty
  //    title is how a template failure reaches production looking fine.
  if (input.title.trim() === '') {
    throw new OgCardError(
      `${input.envelope.path} would publish a social card with no title. A card is ` +
        'an artifact Merit does not control once it leaves, and an empty one is ' +
        'still an artifact.',
    );
  }

  return {
    path: input.envelope.path,
    image_path: ogImagePath(input.envelope.path),
    title: input.title,
    description: input.description,
    statistic: statistic === null ? null : statisticText(statistic),
    alt: input.alt,
  };
}

/**
 * Every string a crop can carry away, in one place.
 *
 * A caller that wants to assert something about "what this card says" asserts
 * over this rather than over four fields, which is what stops a fifth field
 * being added and silently going unchecked.
 */
export function ogCardText(card: OgCard): readonly string[] {
  return [
    card.title,
    card.description,
    card.alt,
    ...(card.statistic === null ? [] : [card.statistic]),
  ];
}
