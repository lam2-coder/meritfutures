// =============================================================================
// e2e/tokens.ts
// =============================================================================
// THE DESIGN SYSTEM'S VOCABULARY, IN THE ONE FORM A BROWSER CAN BE ASKED ABOUT.
//
// [DESIGN_SYSTEM](../docs/design/DESIGN_SYSTEM.md) sections 2, 3 and 4 are the
// source and this file is a transcription of them. That is a second copy of a
// list, which this corpus is right to be suspicious of, so the reason it is
// permitted here is written down rather than assumed: SS-04 asks whether a
// COMPUTED color is in the token set, and a computed color is `rgb(7, 12, 10)`
// rather than `ink-950`. The comparison happens in JavaScript at test time, so
// the set has to exist as JavaScript. A stylesheet cannot be interrogated for
// it, because the whole failure SS-04 catches is a component that never read
// the stylesheet.
//
// THE DRIFT THIS OPENS IS REAL AND IT IS NAMED. If DESIGN_SYSTEM's palette
// moves and this file does not, the pass enforces a palette nobody chose. No
// gate reconciles the two today. That is recorded as a finding in ADR-116
// section 8 rather than papered over, and the honest mitigation is that the
// values below carry their token names, so a reviewer diffing section 2.1
// against this block is reading two lists in the same order.
// =============================================================================

/** A color in the form `getComputedStyle` returns, reduced to its channels. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A token: the name a reviewer cites and the value a browser reports. */
export interface Token {
  readonly name: string;
  readonly hex: string;
  readonly rgb: Rgb;
}

const token = (name: string, hex: string): Token => {
  const n = hex.replace('#', '');
  const at = (i: number) => Number.parseInt(n.slice(i, i + 2), 16);
  return { name, hex, rgb: { r: at(0), g: at(2), b: at(4) } };
};

/**
 * DT-01 section 2.1, the dominant scale, in the document's own order.
 *
 * SS-02 reads THIS list and not the whole token set, because its rule is "a
 * left border wider than 2px whose color is outside THE INK SCALE". A brass
 * left border at 3px is a finding under SS-02 and is inside the token set
 * under SS-04, and the two checks are different questions.
 */
export const INK_SCALE: readonly Token[] = [
  token('ink-950', '#070C0A'),
  token('ink-900', '#0C1512'),
  token('ink-800', '#13211D'),
  token('ink-700', '#1C2E28'),
  token('ink-600', '#2A413A'),
  token('ink-500', '#3D5A50'),
  token('ink-400', '#5C7D72'),
  token('ink-300', '#89A79C'),
  token('ink-200', '#B9CEC6'),
  token('ink-100', '#DCE7E2'),
  token('ink-050', '#F0F5F3'),
];

/** DT-01 section 2.2, the single accent. */
export const BRASS_SCALE: readonly Token[] = [
  token('brass-600', '#7A5314'),
  token('brass-500', '#9A6A1F'),
  token('brass-400', '#BE862C'),
  token('brass-300', '#D6A657'),
  token('brass-200', '#EBD3A4'),
];

/** DT-01 section 2.3. Two semantic colors, not four: no warning, no info. */
export const SEMANTIC_SCALE: readonly Token[] = [
  token('moss-500', '#2F6F4F'),
  token('moss-100', '#DCEAE2'),
  token('oxide-500', '#96322B'),
  token('oxide-100', '#F2DEDC'),
];

/** Every color SS-04 permits. Twenty values, and nothing else. */
export const TOKEN_SET: readonly Token[] = [...INK_SCALE, ...BRASS_SCALE, ...SEMANTIC_SCALE];

/**
 * DT-03 section 4.1. `radius-sm` is 2px and SS-05's rule is "ABOVE
 * `radius-sm`", so 2px is compliant and 3px is not. `radius-md` (4px) is
 * above it and is permitted on the primary action alone, which is why SS-05
 * is a COUNT rather than a ban: the check that fires on one rounded element
 * fires on the button the system allows.
 */
export const RADIUS_SM_PX = 2;

/**
 * SS-05's configured number, and DESIGN_SYSTEM deliberately does not fix it:
 * the row reads "fewer than A CONFIGURED NUMBER of elements per viewport".
 *
 * THREE, and the arithmetic is section 4.2's. There is exactly one shadow in
 * the system and it is for overlays only, so a compliant viewport carries a
 * shadowed rounded element only when a modal, a menu or a popover is open.
 * Zero would fail the surface the system permits; three admits an open overlay
 * with its own rounded affordance and refuses the fourth, which is the point
 * at which "an overlay" has become "cards with shadows" (DG-08, DG-09).
 */
export const SHADOWED_ROUNDED_LIMIT = 3;

/**
 * DT-02 section 3, banned BY NAME. Five faces plus the untouched shadcn
 * default stack, which is not a face and is caught by `BANNED_STACK_HEAD`.
 */
export const BANNED_FACES: readonly string[] = [
  'Inter',
  'Poppins',
  'Space Grotesk',
  'Geist',
  'Montserrat',
];

/**
 * The untouched shadcn/Tailwind default sans stack, identified by its opening
 * pair. A stack that begins `ui-sans-serif, system-ui` is the one nobody
 * chose, which is DG-03 and DG-10's shared subject: a component shipped with a
 * library default. A stack that names a Merit face first and falls back
 * through `system-ui` is a choice and is not this.
 */
export const BANNED_STACK_HEAD: readonly string[] = ['ui-sans-serif', 'system-ui'];

/**
 * Section 6's copy rule, verbatim: "No sentence opens with Empower, Unlock,
 * Transform, Elevate, Revolutionize, or Discover".
 */
export const BANNED_OPENING_VERBS: readonly string[] = [
  'Empower',
  'Unlock',
  'Transform',
  'Elevate',
  'Revolutionize',
  'Discover',
];
