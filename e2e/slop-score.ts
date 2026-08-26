// =============================================================================
// e2e/slop-score.ts
// =============================================================================
// SS-01 TO SS-08, THE APPENDIX F SLOP SCORE, WIRED RATHER THAN REMEMBERED.
// `M4-F-01` is this pass's identifier ([M04](../docs/plans/M04-trader-portal.md)
// section 8) and [DESIGN_SYSTEM](../docs/design/DESIGN_SYSTEM.md) section 8 is
// its specification, whose first sentence is "A Playwright pass".
//
// WHY THIS FILE IS AT THE ROOT AND NOT INSIDE A DEPLOYABLE. The slop score is
// ONE gate over the whole UI estate rather than two gates that happen to agree.
// Putting it in `apps/site` and importing it from `apps/portal` would be a
// deployable reaching into a deployable, which RI-04's prose refuses in the one
// sentence it is famous for; putting a copy in each would be two lists of
// twenty color tokens, which is the drift every register in this corpus exists
// to prevent. So it sits beside `vitest.config.ts` and `eslint.config.js`,
// which are the other two repository-wide gate implementations, and
// `scripts/demo`'s precedent is followed exactly for the consequence: a
// TypeScript directory no `tsc` invocation reaches is a directory that rots, so
// `e2e/tsconfig.json` exists and the root `typecheck` script names it.
//
// -----------------------------------------------------------------------------
// THE PASS IS TWO-SIDED IN-BAND, AND THAT IS THE WHOLE DESIGN
// -----------------------------------------------------------------------------
// P1 section 6: "Every gate any of these sessions wires ships with a seeded
// violation, and must fail on that finding rather than merely exit non-zero."
// Every other gate in this corpus satisfies that through `falsify.mjs`, which
// mutates the working tree. THIS ONE CARRIES ITS OWN SEED. Each surface ships a
// compliant fixture and a deliberately non-compliant one, and the pass asserts
// BOTH directions on every run: the compliant fixture produces no finding, and
// the non-compliant fixture produces at least one finding for EVERY ONE of the
// eight checks. A check that silently stopped working turns the second
// direction red in the same run, rather than waiting for somebody to run a
// separate harness.
//
// THIS IS ALSO WHY THE PASS DOES NOT RENDER A PAGE, AND THE REASON IS MEASURED
// RATHER THAN CHOSEN. `apps/site/src/app/` and `apps/portal/src/app/` DO NOT
// EXIST at this commit: `CI-07`'s activation condition is "a page, layout or
// route file under `apps/*/src/app/`" and `CI-06/gate-inventory` probes for
// exactly that and reports it ABSENT. There is no page to render. What the
// fixtures are is the design system rendered as the DOM a page will produce,
// which is what the eight checks read, and the pass grows a real page's URL the
// day one exists without any check changing. ADR-116 section 6 carries this as
// a stated limit rather than a claim.
// =============================================================================

import type { ElementReport, PageReport, TextReport } from './extract.ts';
import {
  BANNED_FACES,
  BANNED_OPENING_VERBS,
  BANNED_STACK_HEAD,
  INK_SCALE,
  RADIUS_SM_PX,
  SHADOWED_ROUNDED_LIMIT,
  TOKEN_SET,
  type Token,
} from './tokens.ts';

/** The eight, in DESIGN_SYSTEM section 8's order. */
export const SS_IDS = [
  'SS-01',
  'SS-02',
  'SS-03',
  'SS-04',
  'SS-05',
  'SS-06',
  'SS-07',
  'SS-08',
] as const;

export type SlopCheckId = (typeof SS_IDS)[number];

/** One violation, named so a reviewer can cite it rather than argue about it. */
export interface Finding {
  readonly check: SlopCheckId;
  readonly where: string;
  readonly detail: string;
}

// -----------------------------------------------------------------------------
// Color
// -----------------------------------------------------------------------------

interface ParsedColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Chromium computes a color as `rgb(r, g, b)` or `rgba(r, g, b, a)`, and the
 * space-separated `rgb(r g b / a)` form is accepted here because it is what a
 * newer engine may return and a parser that silently returned `null` on it
 * would make every check pass by being unable to read anything.
 */
export function parseColor(value: string): ParsedColor | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!m || m[1] === undefined) return null;
  const parts = m[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  const nums = parts.map((p) =>
    p.endsWith('%') ? Number.parseFloat(p) * 2.55 : Number.parseFloat(p),
  );
  const [r, g, b, a] = nums;
  if (r === undefined || g === undefined || b === undefined) return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: a === undefined ? 1 : a };
}

/**
 * Hue in degrees, plus the two figures that decide whether the hue MEANS
 * anything. A near-grey has a hue and it is noise, and `ink-500` is a green
 * with enough grey in it that a naive hue test would classify it as something.
 */
function hsl(c: ParsedColor): { hue: number; saturation: number; lightness: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const lightness = (max + min) / 2;
  if (d === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = d / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation, lightness };
}

const sameRgb = (c: ParsedColor, t: Token): boolean =>
  c.r === t.rgb.r && c.g === t.rgb.g && c.b === t.rgb.b;

/**
 * A token AT ANY ALPHA is the token. DT-03 section 4.2 puts the hairline on
 * dark at "`ink-300` at 30 percent", so an alpha test would fail the rule the
 * system states. What alpha decides is whether a color is PAINTED at all:
 * fully transparent is the absence of a color, not a color outside the set,
 * and `rgba(0, 0, 0, 0)` is what Chromium reports for every unpainted
 * background in the tree.
 */
const inSet = (c: ParsedColor, set: readonly Token[]): Token | null =>
  set.find((t) => sameRgb(c, t)) ?? null;

const painted = (c: ParsedColor): boolean => c.a > 0;

// -----------------------------------------------------------------------------
// SS-01  No blue-to-purple gradient
// -----------------------------------------------------------------------------
// DG-01 and DG-04. Appendix F's single most reliable tell, and the one every
// generated landing page reaches for.
//
// THE FAMILIES ARE HUE RANGES AND THE BOUNDARY IS NAMED. Blue runs to 258
// degrees and purple from there to 320, which puts indigo (`#4f46e5`, 243) on
// the blue side and violet (`#a855f7`, 271) on the purple side: the canonical
// pair straddles the boundary, which is what makes the check fire on it. A
// gradient wholly inside one family is not this tell and is not reported here.

const BLUE_FAMILY = { from: 195, to: 258 };
const PURPLE_FAMILY = { from: 258, to: 320 };

/** A hue this washed out or this close to black or white is not a family member. */
const HUE_MIN_SATURATION = 0.15;
const HUE_MIN_LIGHTNESS = 0.08;
const HUE_MAX_LIGHTNESS = 0.92;

function family(c: ParsedColor): 'blue' | 'purple' | null {
  const { hue, saturation, lightness } = hsl(c);
  if (saturation < HUE_MIN_SATURATION) return null;
  if (lightness < HUE_MIN_LIGHTNESS || lightness > HUE_MAX_LIGHTNESS) return null;
  if (hue >= BLUE_FAMILY.from && hue < BLUE_FAMILY.to) return 'blue';
  if (hue >= PURPLE_FAMILY.from && hue < PURPLE_FAMILY.to) return 'purple';
  return null;
}

function ss01(el: ElementReport): Finding[] {
  if (!el.backgroundImage.includes('gradient(')) return [];
  const stops = [...el.backgroundImage.matchAll(/rgba?\([^)]+\)/g)]
    .map((m) => parseColor(m[0]))
    .filter((c): c is ParsedColor => c !== null && painted(c));
  const families = new Set(stops.map(family).filter((f): f is 'blue' | 'purple' => f !== null));
  if (!families.has('blue') || !families.has('purple')) return [];
  return [
    {
      check: 'SS-01',
      where: el.selector,
      detail:
        `background-image is a gradient running between the blue and purple families: ` +
        `${el.backgroundImage}. DG-01 and DG-04, and DESIGN_SYSTEM section 1.1 puts the ` +
        'palette deliberately "nowhere near indigo"',
    },
  ];
}

// -----------------------------------------------------------------------------
// SS-02  No colored left border wider than 2px
// -----------------------------------------------------------------------------
// DG-07, which DESIGN_SYSTEM calls "almost as reliable a sign of AI design as
// em-dashes are for AI text". Section 1.3 states the structural defense: the
// layout primitive is a ruled row, which has no border and no color on its
// edge, and the gate exists so that "nobody re-derives the banned thing by
// adding one accent stripe to a row and calling it a variant".

function ss02(el: ElementReport): Finding[] {
  if (el.borderLeftWidthPx <= RADIUS_SM_PX) return [];
  if (el.borderLeftStyle === 'none' || el.borderLeftStyle === 'hidden') return [];
  const c = parseColor(el.borderLeftColor);
  if (c === null || !painted(c)) return [];
  const ink = inSet(c, INK_SCALE);
  if (ink !== null) return [];
  return [
    {
      check: 'SS-02',
      where: el.selector,
      detail:
        `border-left is ${el.borderLeftWidthPx}px of ${el.borderLeftColor}, which is wider ` +
        `than radius-sm (${RADIUS_SM_PX}px) and outside the ink scale. DG-07 bans a colored ` +
        'left border on a card or a blockquote at any width and any color',
    },
  ];
}

// -----------------------------------------------------------------------------
// SS-03  No banned face in the resolved stack
// -----------------------------------------------------------------------------
// DG-10. The five faces are banned BY NAME in DESIGN_SYSTEM section 3, and the
// sixth entry on that list is "the untouched shadcn default stack", which is
// not a face: it is caught by its opening pair.

const familyNames = (stack: string): string[] =>
  stack
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

function ss03(el: ElementReport): Finding[] {
  const names = familyNames(el.fontFamily);
  const lower = names.map((n) => n.toLowerCase());
  const banned = BANNED_FACES.filter((f) => lower.includes(f.toLowerCase()));
  const findings: Finding[] = [];
  if (banned.length > 0) {
    findings.push({
      check: 'SS-03',
      where: el.selector,
      detail:
        `the resolved font stack names ${banned.join(', ')}: ${el.fontFamily}. DESIGN_SYSTEM ` +
        'section 3 bans those faces by name and DG-10 is a hard fail',
    });
  }
  const headMatches = BANNED_STACK_HEAD.every((h, i) => lower[i] === h.toLowerCase());
  if (headMatches && lower.length >= BANNED_STACK_HEAD.length) {
    findings.push({
      check: 'SS-03',
      where: el.selector,
      detail:
        `the resolved font stack opens \`${BANNED_STACK_HEAD.join(', ')}\`, which is the ` +
        `untouched shadcn default stack: ${el.fontFamily}. DG-03 and DG-10 share a subject, ` +
        'a component that shipped with a library default nobody looked at',
    });
  }
  return findings;
}

// -----------------------------------------------------------------------------
// SS-04  Every painted color is a token
// -----------------------------------------------------------------------------
// DG-02, DG-03, DG-05 and DG-06 at once. DESIGN_SYSTEM section 8 calls this
// "the strongest one" and says why: the four have one cause in common, which is
// a component that shipped with a library default nobody looked at.

function ss04(el: ElementReport): Finding[] {
  const findings: Finding[] = [];
  for (const use of el.colors) {
    const c = parseColor(use.value);
    if (c === null || !painted(c)) continue;
    if (inSet(c, TOKEN_SET) !== null) continue;
    findings.push({
      check: 'SS-04',
      where: el.selector,
      detail:
        `${use.property} computes to ${use.value}, which is not in the token set. ` +
        'DESIGN_SYSTEM section 2: "No component uses a raw hex, ever, and none uses a ' +
        'library default"',
    });
  }
  return findings;
}

// -----------------------------------------------------------------------------
// SS-05  Cardocalypse, counted
// -----------------------------------------------------------------------------
// DG-08 and DG-09. A COUNT rather than a ban, because DT-03 permits `radius-md`
// on the primary action and one shadow for overlays: the element that carries
// both legitimately exists, and it is the FOURTH one that means the surface has
// become cards.

function ss05(elements: readonly ElementReport[]): Finding[] {
  const offenders = elements.filter(
    (el) => el.maxRadiusPx > RADIUS_SM_PX && el.boxShadow !== 'none',
  );
  if (offenders.length < SHADOWED_ROUNDED_LIMIT) return [];
  return [
    {
      check: 'SS-05',
      where: offenders.map((o) => o.selector).join(', '),
      detail:
        `${offenders.length} element(s) in this viewport carry BOTH a radius above ` +
        `radius-sm (${RADIUS_SM_PX}px) and a box shadow, and the configured limit is ` +
        `${SHADOWED_ROUNDED_LIMIT}. DT-03 section 4.2: there is exactly one shadow in the ` +
        'system and it is for overlays only, so this many is DG-08 cardocalypse',
    },
  ];
}

// -----------------------------------------------------------------------------
// SS-06  No sentence opens with a banned verb
// -----------------------------------------------------------------------------
// DESIGN_SYSTEM section 6, verbatim. The row in section 8 reads "no TEXT NODE
// opens with a banned verb" and the copy rule one section up reads "no SENTENCE
// opens with"; the sentence reading is implemented, because it is the rule the
// other is an approximation of and it is strictly the stronger of the two. A
// banned verb opening the second sentence of a paragraph is the same tell.

function ss06(t: TextReport): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of t.text.split(/(?<=[.!?])\s+/)) {
    const opener = /^[\s"'([{“‘]*([A-Za-z][A-Za-z']*)/.exec(sentence);
    if (!opener || opener[1] === undefined) continue;
    const word = opener[1];
    const hit = BANNED_OPENING_VERBS.find((v) => v.toLowerCase() === word.toLowerCase());
    if (hit === undefined) continue;
    findings.push({
      check: 'SS-06',
      where: t.selector,
      detail:
        `a sentence opens with "${word}": ${JSON.stringify(sentence.trim().slice(0, 80))}. ` +
        'DESIGN_SYSTEM section 6 bans that opener by name, and Appendix F calls generic copy ' +
        '"the textual purple gradient"',
    });
  }
  return findings;
}

// -----------------------------------------------------------------------------
// SS-07  No emoji where an icon belongs
// -----------------------------------------------------------------------------
// DESIGN_SYSTEM section 6: "No emoji as icons, anywhere."
//
// A POSITION OCCUPIED BY AN ICON HAS TWO READINGS AND BOTH ARE IMPLEMENTED. A
// page can DECLARE the position (`data-icon`, a class named `icon`, `role=img`),
// and it can OCCUPY one without declaring it, which is a text run that is
// nothing but a pictograph sitting where a glyph goes. Reading only the first
// would let the tell through on any markup that did not name its own slots,
// which is most markup.

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
// AN ALTERNATION RATHER THAN A CHARACTER CLASS, and it is the same language.
// `no-misleading-character-class` refuses a class that can hold a pictograph and
// U+FE0F together, because inside a class those are two members while on screen
// they are one grapheme, and the rule cannot tell an intentional pair from an
// accident. `(?:a|b)+` accepts exactly what `[ab]+` accepts, so the property is
// unchanged and the ambiguity is gone. A disable comment here would have
// silenced a rule that was right about the shape.
const PICTOGRAPH_ONLY = /^(?:\p{Extended_Pictographic}|\u200d|\ufe0f|\s)+$/u;

function ss07(t: TextReport): Finding[] {
  if (!PICTOGRAPH.test(t.text)) return [];
  const solo = PICTOGRAPH_ONLY.test(t.text);
  if (!t.declaredIconSlot && !solo) return [];
  return [
    {
      check: 'SS-07',
      where: t.selector,
      detail:
        (t.declaredIconSlot
          ? 'an element that declares itself an icon slot renders an emoji'
          : 'a text run is nothing but an emoji, which is an emoji standing in an icon slot') +
        `: ${JSON.stringify(t.text.trim().slice(0, 40))}. DESIGN_SYSTEM section 6 bans emoji ` +
        'as icons anywhere',
    },
  ];
}

// -----------------------------------------------------------------------------
// SS-08  No em-dash in rendered text
// -----------------------------------------------------------------------------
// Appendix F names it, constitution convention repeats it, and the corpus
// already obeys it. U+2014 EM DASH and U+2015 HORIZONTAL BAR, which is the same
// character with a different name in the fonts that ship it. THE EN DASH IS NOT
// HERE: it is the correct character for a numeric range, and a check that
// banned it would fail on `2026-08-14 to 2026-08-26` written properly.

const EM_DASH = /[—―]/g;

function ss08(t: TextReport): Finding[] {
  const hits = t.text.match(EM_DASH);
  if (hits === null) return [];
  return [
    {
      check: 'SS-08',
      where: t.selector,
      detail:
        `${hits.length} em-dash character(s) in rendered text: ` +
        `${JSON.stringify(t.text.trim().slice(0, 80))}. Appendix F names it and every Merit ` +
        'surface obeys it',
    },
  ];
}

/**
 * The eight, over one rendering. Order is DESIGN_SYSTEM section 8's, so a
 * failure report reads down the table.
 */
export function runSlopChecks(report: PageReport): Finding[] {
  const findings: Finding[] = [];
  for (const el of report.elements) {
    findings.push(...ss01(el), ...ss02(el), ...ss03(el), ...ss04(el));
  }
  findings.push(...ss05(report.elements));
  for (const t of report.texts) {
    findings.push(...ss06(t), ...ss07(t), ...ss08(t));
  }
  return findings;
}

/** A findings list, rendered for a failure message rather than for a log. */
export function formatFindings(findings: readonly Finding[]): string {
  return findings.map((f) => `  ${f.check}  ${f.where}\n        ${f.detail}`).join('\n');
}
