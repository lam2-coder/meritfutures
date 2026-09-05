// =============================================================================
// apps/api/src/certificate-card.ts
// =============================================================================
// THE CARD RENDERER. ADR-249 RULED IT ENTIRE AND LANDED NONE; THIS FILE IS THAT
// RULING TRANSCRIBED, AND IT DECIDES NOTHING THE RULING ALREADY DECIDED.
//
// ADR-249 answered four questions about this artefact and this file implements
// all four rather than reopening any:
//
//   WHAT RENDERS IT   whatever answers `CertificateImageSource.lookup`, which
//                     is a PORT rather than a process (ADR-249 clause 1). So
//                     this module is a PURE FUNCTION FROM A VALUE TO BYTES and
//                     imports nothing from `routes/`. Whether the bytes are
//                     produced in this deployable or by a render service it
//                     calls stays the deployment's choice, exactly as the
//                     ruling left it: a service would call this same function
//                     across a wire, and moving it is a MOVE rather than a
//                     rewrite.
//   WHEN              on fetch, from the live row (`INV-M11-08`). Nothing here
//                     schedules, caches or stores; the caller renders when it
//                     is asked, and `imageHandler` already refuses a
//                     non-deferred lookup that carried no card.
//   INTO WHAT STORE   none. This function returns bytes to its caller and
//                     writes nothing anywhere (ADR-249 clause 4).
//   WHAT ADDRESSES IT nothing here. `image_url` is `origin` plus the path
//                     `routes/certificates.ts` already serves, derived from
//                     `code` at projection time (ADR-249 clause 6). This module
//                     names no origin, no bucket, no hostname and no key, and
//                     it reads no environment variable at all.
//
// -----------------------------------------------------------------------------
// THE INPUT IS THE WHOLE OF WHAT IS DRAWN, AND THAT IS THE SENTENCE ADR-249
// SAID WOULD BE THE ONE TO FALL
// -----------------------------------------------------------------------------
// ADR-249 clause 8 rules the cache version DERIVED rather than stored: a digest
// over the value handed to the template IS the version, and it cannot drift
// from what was drawn because it is computed from the drawn input. Its own
// founder block names the condition that reasoning rests on: "that reasoning
// holds only while the template draws NOTHING the digest did not see", and "a
// renderer that reaches for the clock, for a plan-version lookup, or for a logo
// it fetches, has a rendering input the row does not carry".
//
// THAT CONDITION IS STRUCTURAL HERE RATHER THAN PROMISED. `renderCertificateCard`
// takes ONE argument, every function below it takes what it is given, and this
// module reads NO clock, NO environment, NO file, NO network and NO random
// source: the only imports are a hash and a deflate. `test/certificate-card.test.ts`
// asserts that over this file's own source, and asserts the other direction
// case by case: EVERY field of the input changes the bytes or is refused, so a
// field the digest sees and the template ignores fails with its own name.
//
// -----------------------------------------------------------------------------
// A REVOKED CERTIFICATE RENDERS. THE STATE CHANGES WHAT IT SAYS AND NEVER
// WHETHER IT SAYS ANYTHING
// -----------------------------------------------------------------------------
// `INV-M11-08` makes the re-render the only path by which a revocation reaches
// an image already in circulation, and `imageHandler` states the consequence in
// its own words: "a revoked certificate that does not render is the revocation
// failing to arrive". So a renderer that answers nothing for a revoked row
// turns the revocation INTO the failure, which is the trap this module is
// written against.
//
// IT IS SHUT BY MAKING EVERY REFUSAL STATE-INDEPENDENT. `assertCopy` checks ALL
// FIVE published sentences and the disclosure on EVERY render, including the
// four sentences this particular card will not draw, which is `routes/verify.ts`'
// own rule transcribed: "Every sentence is checked on every path, because a
// sentence missing only for the result it describes is a hit-versus-miss oracle
// built out of the configuration error". A deployment that misconfigures the
// `fact_untrue` sentence therefore fails the ISSUED card too, loudly and on the
// first fetch, instead of failing only the cards whose revocation it was about
// to publish. THE LAYOUT IS FIXED FOR THE SAME REASON: every block sits at the
// same y on every card, so an issued card and a revoked card draw the same
// blocks in the same places and differ only in what those blocks say.
//
// -----------------------------------------------------------------------------
// NO COPY IS INVENTED HERE. THE SENTENCES ARRIVE AS CONFIGURATION, WHICH IS
// `routes/verify.ts`' SHAPE
// -----------------------------------------------------------------------------
// `INV-M11-07` gives `revocation_class` four values and four distinct published
// sentences, and `AS-M11-05` is why the wording matters: `account_enforced`
// means "the claim stands and the account was later closed", and a card that
// says the certificate is invalid is a retroactive denial of an achievement
// that happened. `INV-M11-04` requires the simulated-environment disclosure in
// the image.
//
// NONE OF THOSE SENTENCES IS WRITTEN IN THIS FILE. `routes/verify.ts` already
// reads all five statements and the disclosure from named environment
// variables and refuses a blank one, and a second copy of Merit's published
// wording living in a renderer would be one sentence maintained twice. This
// module takes them as `CertificateCardCopy` and SELECTS BY CLASS, so
// `revocation_class` DRIVES the published sentence (`INV-M11-07` in its own
// words) rather than a caller choosing one that may not match the class.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE DECIDES THAT NO APPROVED DOCUMENT DECIDES, NAMED RATHER THAN
// SLIPPED IN
// -----------------------------------------------------------------------------
//   1. THE PIXEL DIMENSIONS. No approved document fixes them. 1200 by 630 is
//      the ratio the sharing surfaces read, and it is this module's choice.
//   2. THE TYPEFACE, which is a 5 by 8 bitmap in `GLYPHS` below. A font file is
//      a binary dependency and a font service is a network read, and the second
//      one would break the purity the paragraph above rests on.
//   3. THE DIGEST, SHA-256, taken over the canonical input. `routes/verify.ts`
//      states the estate's reason for that algorithm on its own digest: a
//      second algorithm in one deployable is a vocabulary nothing shares.
//
// THE FOUR COLOURS ARE NOT THIS FILE'S CHOICE AND ARE CITED RATHER THAN PICKED.
// DESIGN_SYSTEM sections 2.1 and 2.2 name them, and the suite reads the tokens
// out of that document. REVOCATION IS DRAWN IN WEIGHT AND A RULE AND NEVER IN A
// HUE, which is that document's section 1.2 ("attention is expressed with
// weight, a hairline rule, and position, never with a third hue") and is also
// `AS-M11-05`: painting a revocation in the negative colour is the over-claim
// that scenario is opened to refuse.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS NOT, AND WHERE IT DELIBERATELY IS NOT
// -----------------------------------------------------------------------------
// IT IS NOT UNDER `routes/`. Every file there is a surface: it registers a
// path, reads a request or projects a response. This one has no idea an HTTP
// request exists, and `routes/certificates.ts` does not import it, which is
// what keeps `assertPng` there a VALIDATOR at the boundary rather than a
// producer checking its own work.
//
// IT IS NOT A WORKSPACE PACKAGE EITHER, AND THAT IS AN ARGUMENT RATHER THAN A
// CONVENIENCE. `apps/api/package.json` records what a workspace dependency
// means in this tree: the declaration "is THE ONLY PLACE THE CAPABILITY CAN BE
// ACQUIRED", which is what makes `RI-08`'s manifest check the whole control. A
// package is therefore a claim that MORE THAN ONE deployable renders cards, and
// exactly one thing in this estate needs card bytes: the image row this
// deployable serves. ADR-249 clause 1 rules that where the bytes are produced
// is a DEPLOYMENT shape, and a package boundary would look like this session
// deciding it. A module inside the one consumer decides nothing, and the day a
// render service exists this file moves with no caller rewritten, because it
// imports nothing from this deployable at all.
// =============================================================================

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

// -----------------------------------------------------------------------------
// The wire this module answers on
// -----------------------------------------------------------------------------

/**
 * What the route labels these bytes.
 *
 * NAMED HERE SO THE PRODUCER AND THE LABEL AGREE. `routes/certificates.ts`
 * sends `image/png` and `assertPng` there refuses bytes that do not open with
 * the signature; this module is the thing that has to satisfy it.
 */
export const CERTIFICATE_CARD_MEDIA_TYPE = 'image/png';

/** The card, in pixels. This module's choice; see the header. */
export const CARD_WIDTH_PX = 1200;
export const CARD_HEIGHT_PX = 630;

// -----------------------------------------------------------------------------
// The values the card draws
// -----------------------------------------------------------------------------

/** `certificates.kind`'s CHECK. Two cards, and M11 section 3.1 keeps them apart. */
export const CARD_KINDS = ['pass', 'payout'] as const;

/** One of {@link CARD_KINDS}. */
export type CertificateCardKind = (typeof CARD_KINDS)[number];

/**
 * The states that RENDER, and there are two.
 *
 * `deferred` IS NOT A MEMBER AND MUST NOT BE ADDED. "A deferral is a claim
 * Merit has not made yet" (ADR-168 foreclosure 4), so there is nothing to draw,
 * and `imageHandler` throws when a lookup hands it a card for one. The
 * withholding is structural here for the same reason it is structural in
 * `projectCertificate`: a deferred row cannot be handed to this function at
 * all, so no later edit can render one by forgetting the rule.
 */
export const CARD_STATES = ['issued', 'revoked'] as const;

/** One of {@link CARD_STATES}. */
export type CertificateCardState = (typeof CARD_STATES)[number];

/** `certificates.revocation_class`'s four-member CHECK (`SD-M11-02`). */
export const CARD_REVOCATION_CLASSES = [
  'fact_untrue',
  'account_enforced',
  'issued_in_error',
  'trader_request',
] as const;

/** One of {@link CARD_REVOCATION_CLASSES}. */
export type CertificateCardRevocationClass = (typeof CARD_REVOCATION_CLASSES)[number];

/**
 * `INV-M11-01`'s minimal claim, and the whole of it.
 *
 * INTEGER CENTS AND NEVER A FLOAT, which {@link formatCents} enforces by
 * refusing anything that is not a non-negative safe integer and then formatting
 * by STRING SURGERY rather than by dividing. A card is a published number.
 */
export interface CertificateCardClaims {
  readonly plan_code: string;
  readonly size_cents: number;
  /** The payout card's kind-specific value. Absent on a pass card. */
  readonly amount_cents?: number;
  readonly trading_day: string;
}

/** A revocation, as the card draws it. Both fields are `certificates` columns. */
export interface CertificateCardRevocation {
  readonly class: CertificateCardRevocationClass;
  readonly at: string;
}

/**
 * The five published sentences, keyed as `routes/verify.ts` keys them.
 *
 * THE KEY SET IS ASSERTED EQUAL TO `VERIFY_PRESENTATION_VARS`' IN THE SUITE, so
 * the card and the verify page cannot drift into two vocabularies for one
 * revocation.
 */
export interface CertificateCardStatements {
  readonly valid: string;
  readonly fact_untrue: string;
  readonly account_enforced: string;
  readonly issued_in_error: string;
  readonly trader_request: string;
}

/** The statement keys, in the order every check below walks them. */
export const CARD_STATEMENT_KEYS = [
  'valid',
  'fact_untrue',
  'account_enforced',
  'issued_in_error',
  'trader_request',
] as const satisfies readonly (keyof CertificateCardStatements)[];

/** Every sentence the deployment supplies. None of it is written in this repository. */
export interface CertificateCardCopy {
  readonly statements: CertificateCardStatements;
  /** `INV-M11-04`'s simulated-environment disclosure, in the image. */
  readonly disclosure: string;
}

/**
 * Everything the card is drawn from, and nothing else exists to draw it from.
 *
 * EVERY FIELD IS A `certificates` COLUMN OR THE DEPLOYMENT'S COPY.
 * `certificate-card-home.test.ts` partitions the table's seventeen columns into
 * the eight the card renders and the nine it does not; seven of the eight are
 * fields here, and the eighth is `deferred_until`, which is absent because a
 * deferred row does not render at all.
 *
 * `identity_id`, `account_id`, `payout_request_id`, `signature`,
 * `signing_key_id`, `revoked_reason` AND `created_at` HAVE NO FIELD HERE, which
 * is `CertificateRow`'s own discipline one file over: a value with no field
 * cannot be drawn by an edit that widens a spread.
 */
export interface CertificateCardInput {
  readonly kind: CertificateCardKind;
  readonly claims: CertificateCardClaims;
  /** `SD-M11-01`. The claim shape may evolve; an unknown one is refused. */
  readonly claimsSchemaVersion: number;
  /** `SD-M11-01`: the token "appears in the image and resolves on the verify page". */
  readonly code: string;
  readonly issuedAt: string;
  readonly state: CertificateCardState;
  /** Set exactly when `state` is `revoked`, and never otherwise. */
  readonly revocation: CertificateCardRevocation | null;
  readonly copy: CertificateCardCopy;
}

/**
 * The input's keys, as the digest walks them.
 *
 * THE DIGEST IS TOTAL OVER THIS LIST AND THE SUITE ASSERTS THE LIST IS TOTAL
 * OVER THE TYPE. A field added to the input and forgotten here would be a
 * rendering input the version cannot see, which is the one failure ADR-249
 * clause 8 does not survive.
 */
export const CARD_INPUT_KEYS = [
  'kind',
  'claims',
  'claimsSchemaVersion',
  'code',
  'issuedAt',
  'state',
  'revocation',
  'copy',
] as const satisfies readonly (keyof CertificateCardInput)[];

/** The claim schema versions this template can draw. `SD-M11-01`. */
export const SUPPORTED_CLAIMS_SCHEMA_VERSIONS: readonly number[] = [1];

/** What one render produced: the bytes, and the version they were drawn at. */
export interface RenderedCertificateCard {
  /** `image/png`, opening with the eight-byte signature. */
  readonly bytes: Uint8Array;
  /**
   * `FM-M11-05`'s cache key, second half.
   *
   * DERIVED AND NEVER STORED (ADR-249 clause 8). `certificates` carries no
   * `row_version`; this is a digest over the value the template was handed, so
   * a cache keyed on `(code, version)` misses whenever the drawing inputs
   * changed and misses with NOBODY INVALIDATING ANYTHING. THE CACHE ITSELF IS
   * STILL OWED and this module does not build one.
   */
  readonly version: string;
}

/**
 * Raised when a card cannot be drawn. Every case is a defect or a misconfigured
 * deployment, and NONE of them is state-dependent: see the header.
 */
export class CertificateCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificateCardError';
  }
}

// -----------------------------------------------------------------------------
// The typeface, which is data
// -----------------------------------------------------------------------------

/** One glyph cell. Rows 0 to 6 are the cap area; row 7 carries descenders. */
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 8;

/**
 * The typeface, one line per glyph, eight rows of five.
 *
 * A BITMAP RATHER THAN A FONT FILE, and the header says why: a font file is a
 * binary dependency and a font service is a network read, and a network read
 * inside the template is the exact failure ADR-249's founder block names as the
 * one that would falsify clause 8.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  ' ': '..... ..... ..... ..... ..... ..... ..... .....',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###. .....',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###. .....',
  '2': '.###. #...# ....# ...#. ..#.. .#... ##### .....',
  '3': '##### ...#. ..##. ....# ....# #...# .###. .....',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#. .....',
  '5': '##### #.... ####. ....# ....# #...# .###. .....',
  '6': '..##. .#... #.... ####. #...# #...# .###. .....',
  '7': '##### ....# ...#. ..#.. .#... .#... .#... .....',
  '8': '.###. #...# #...# .###. #...# #...# .###. .....',
  '9': '.###. #...# #...# .#### ....# ...#. .##.. .....',
  A: '.###. #...# #...# ##### #...# #...# #...# .....',
  B: '####. #...# #...# ####. #...# #...# ####. .....',
  C: '.###. #...# #.... #.... #.... #...# .###. .....',
  D: '###.. #..#. #...# #...# #...# #..#. ###.. .....',
  E: '##### #.... #.... ####. #.... #.... ##### .....',
  F: '##### #.... #.... ####. #.... #.... #.... .....',
  G: '.###. #...# #.... #.### #...# #...# .###. .....',
  H: '#...# #...# #...# ##### #...# #...# #...# .....',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###. .....',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##.. .....',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...# .....',
  L: '#.... #.... #.... #.... #.... #.... ##### .....',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...# .....',
  N: '#...# ##..# #.#.# #..## #...# #...# #...# .....',
  O: '.###. #...# #...# #...# #...# #...# .###. .....',
  P: '####. #...# #...# ####. #.... #.... #.... .....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.# .....',
  R: '####. #...# #...# ####. #.#.. #..#. #...# .....',
  S: '.###. #...# #.... .###. ....# #...# .###. .....',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#.. .....',
  U: '#...# #...# #...# #...# #...# #...# .###. .....',
  V: '#...# #...# #...# #...# #...# .#.#. ..#.. .....',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...# .....',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...# .....',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#.. .....',
  Z: '##### ....# ...#. ..#.. .#... #.... ##### .....',
  a: '..... ..... .###. ....# .#### #...# .#### .....',
  b: '#.... #.... ####. #...# #...# #...# ####. .....',
  c: '..... ..... .###. #.... #.... #...# .###. .....',
  d: '....# ....# .#### #...# #...# #...# .#### .....',
  e: '..... ..... .###. #...# ##### #.... .###. .....',
  f: '..##. .#..# .#... ###.. .#... .#... .#... .....',
  g: '..... ..... .#### #...# #...# .#### ....# .###.',
  h: '#.... #.... ####. #...# #...# #...# #...# .....',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###. .....',
  j: '...#. ..... ..##. ...#. ...#. ...#. ...#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#. .....',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###. .....',
  m: '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.# .....',
  n: '..... ..... ####. #...# #...# #...# #...# .....',
  o: '..... ..... .###. #...# #...# #...# .###. .....',
  p: '..... ..... ####. #...# #...# ####. #.... #....',
  q: '..... ..... .#### #...# #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #.... .....',
  s: '..... ..... .#### #.... .###. ....# ####. .....',
  t: '.#... .#... ###.. .#... .#... .#..# ..##. .....',
  u: '..... ..... #...# #...# #...# #..## .##.# .....',
  v: '..... ..... #...# #...# #...# .#.#. ..#.. .....',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#. .....',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...# .....',
  y: '..... ..... #...# #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... ##### .....',
  '.': '..... ..... ..... ..... ..... .##.. .##.. .....',
  ',': '..... ..... ..... ..... ..... .##.. .##.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. ..... .....',
  ';': '..... .##.. .##.. ..... .##.. .##.. ..#.. .#...',
  "'": '..#.. ..#.. ..#.. ..... ..... ..... ..... .....',
  '"': '.#.#. .#.#. ..... ..... ..... ..... ..... .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#. .....',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#... .....',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#. .....',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#... .....',
  '-': '..... ..... ..... ##### ..... ..... ..... .....',
  '/': '....# ....# ...#. ..#.. .#... #.... #.... .....',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#.. .....',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..## .....',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#.. .....',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#.. .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. ..... .....',
  '=': '..... ..... ##### ..... ##### ..... ..... .....',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#. .....',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.# .....',
  '@': '.###. #...# #.### #.#.# #.### #.... .###. .....',
  '*': '..... #.#.# .###. ##### .###. #.#.# ..... .....',
  _: '..... ..... ..... ..... ..... ..... ..... #####',
};

/**
 * What a character the typeface has no glyph for draws AS, on ROW-DERIVED text.
 *
 * A HOLLOW BOX, WHICH IS A SHAPE NO OTHER GLYPH IS. It exists so that a value
 * read out of the database can always be drawn: refusing an unexpected byte in
 * `plan_code` would turn one odd row into a REVOCATION THAT NEVER RENDERS,
 * which is the trap this file is written against. CONFIGURED COPY DOES NOT GET
 * THIS TREATMENT and is refused instead, because a refusal there is
 * state-independent and reaches every card at once.
 */
const REPLACEMENT = '�';

const REPLACEMENT_GLYPH = '##### #...# #...# #...# #...# #...# ##### .....';

/** Every character this typeface draws as itself, sorted, for the suite to read. */
export const CARD_CHARSET: readonly string[] = Object.keys(GLYPHS).sort();

/**
 * The typeface, decoded once and refused at load if it is malformed.
 *
 * A REFUSAL TO LOAD RATHER THAN A GLYPH DRAWN WRONG, which is
 * `packages/db/src/certificate-code.ts`' shape for its alphabet: a data table
 * whose defect is invisible in the output is checked where it is written.
 */
const BITMAP: ReadonlyMap<string, readonly string[]> = (() => {
  const source: readonly (readonly [string, string])[] = [
    ...Object.entries(GLYPHS),
    [REPLACEMENT, REPLACEMENT_GLYPH],
  ];
  const decoded = new Map<string, readonly string[]>();
  for (const [character, encoded] of source) {
    const rows = encoded.split(' ');
    if (rows.length !== GLYPH_HEIGHT)
      throw new Error(
        `the glyph for \`${character}\` carries ${String(rows.length)} rows and a cell is ` +
          `${String(GLYPH_HEIGHT)}. A short glyph draws the next one's pixels`,
      );
    for (const row of rows)
      if (row.length !== GLYPH_WIDTH || /[^#.]/.test(row))
        throw new Error(
          `the glyph for \`${character}\` carries the row \`${row}\`, which is not ` +
            `${String(GLYPH_WIDTH)} characters of \`#\` and \`.\``,
        );
    decoded.set(character, rows);
  }
  return decoded;
})();

// -----------------------------------------------------------------------------
// The palette, cited rather than picked
// -----------------------------------------------------------------------------

/**
 * The four colours, from DESIGN_SYSTEM sections 2.1 and 2.2 by token name.
 *
 * THE SUITE READS THE HEX OUT OF THAT DOCUMENT, so a token retuned there and
 * not here fails rather than shipping a card in last month's palette.
 *
 * THERE IS NO NEGATIVE COLOUR IN THIS LIST AND ITS ABSENCE IS THE DECISION.
 * `oxide-500` is the system's negative and a revoked card does not use it:
 * DESIGN_SYSTEM section 1.2 expresses attention "with weight, a hairline rule,
 * and position, never with a third hue", and `AS-M11-05` is the harder reason.
 * An `account_enforced` revocation means the claim STANDS, and painting it in
 * the breach colour is the retroactive denial that scenario exists to refuse.
 */
export const CARD_PALETTE = {
  /** `ink-050`, the light page background. */
  paper: '#F0F5F3',
  /** `ink-900`, primary text on light. */
  ink: '#0C1512',
  /** `ink-200`, hairline rules on light. */
  rule: '#B9CEC6',
  /** `brass-400`, THE accent. It appears once on this card. */
  brass: '#BE862C',
} as const;

/** Palette indices, in the order {@link CARD_PALETTE} declares them. */
const PAPER = 0;
const INK = 1;
const RULE = 2;
const BRASS = 3;

// -----------------------------------------------------------------------------
// The canvas
// -----------------------------------------------------------------------------

/** A rectangle of palette indices. One byte per pixel; PNG colour type 3. */
interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

function blankCanvas(width: number, height: number): Canvas {
  const pixels = new Uint8Array(width * height);
  pixels.fill(PAPER);
  return { width, height, pixels };
}

/** One pixel, dropped when it falls outside the canvas. */
function plot(canvas: Canvas, x: number, y: number, colour: number): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  canvas.pixels[y * canvas.width + x] = colour;
}

/** A filled rectangle. Rules and the state band are the only callers. */
function fill(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: number,
): void {
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1) plot(canvas, x + column, y + row, colour);
}

/** How wide one character is at a scale, including the gap after it. */
function advance(scale: number): number {
  return (GLYPH_WIDTH + 1) * scale;
}

/** How many characters fit in a width at a scale. */
function columnsIn(width: number, scale: number): number {
  return Math.floor(width / advance(scale));
}

/**
 * One glyph, with each source pixel drawn as a scale by scale block.
 *
 * INTEGER SCALING AND NO INTERPOLATION. A bitmap scaled by a whole number is
 * the same bitmap; anything else needs a filter, and a filter is a second thing
 * to get wrong on a public artefact carrying Merit's claim.
 */
function drawGlyph(
  canvas: Canvas,
  character: string,
  x: number,
  y: number,
  scale: number,
  colour: number,
): void {
  const rows = BITMAP.get(character) ?? BITMAP.get(REPLACEMENT) ?? [];
  for (let row = 0; row < rows.length; row += 1) {
    const bits = rows[row] ?? '';
    for (let column = 0; column < bits.length; column += 1) {
      if (bits.charAt(column) !== '#') continue;
      fill(canvas, x + column * scale, y + row * scale, scale, scale, colour);
    }
  }
}

/**
 * One line of text, left aligned at `x`, truncated VISIBLY at `limit`.
 *
 * TRUNCATION IS MARKED AND NEVER SILENT. A value that runs past the margin
 * draws a `>` in the last cell it has room for, so a card that could not show
 * the whole of something says so. Row-derived values take this path; configured
 * copy never reaches it, because {@link assertCopy} refused it already.
 */
function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  colour: number,
  limit: number,
): void {
  const room = columnsIn(limit - x, scale);
  const characters = [...text];
  const truncated = characters.length > room;
  const shown = truncated ? characters.slice(0, Math.max(room - 1, 0)) : characters;
  let cursor = x;
  for (const character of shown) {
    drawGlyph(canvas, BITMAP.has(character) ? character : REPLACEMENT, cursor, y, scale, colour);
    cursor += advance(scale);
  }
  if (truncated) drawGlyph(canvas, '>', cursor, y, scale, colour);
}

/**
 * A sentence, wrapped on whitespace to a character budget.
 *
 * A WORD LONGER THAN THE BUDGET IS NOT BROKEN. It is returned as its own
 * over-long line, so {@link assertCopy}'s check catches it rather than the card
 * silently hyphenating Merit's published wording.
 */
function wrap(text: string, columns: number): readonly string[] {
  if (columns <= 0) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((piece) => piece !== '')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if ([...candidate].length <= columns) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = word;
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

// -----------------------------------------------------------------------------
// Money, which is integer cents and is never divided
// -----------------------------------------------------------------------------

/**
 * Integer cents, as a card prints them.
 *
 * NO FLOAT IS CONSTRUCTED AT ANY POINT. The whole and fractional parts are cut
 * out of the DECIMAL STRING of the integer, so there is no division to round
 * and no intermediate a `toFixed` could carry. A published number is the one
 * place this repository's rule about floats is visible to a stranger.
 */
export function formatCents(cents: number, field: string): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new CertificateCardError(
      `\`${field}\` is \`${String(cents)}\`, which is not a non-negative whole number of cents. ` +
        'Money is integer cents everywhere in this estate and a card is a published number',
    );
  const digits = String(cents).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  let grouped = '';
  for (let i = 0; i < whole.length; i += 1) {
    grouped += whole.charAt(i);
    const remaining = whole.length - 1 - i;
    if (remaining > 0 && remaining % 3 === 0) grouped += ',';
  }
  return `$${grouped}.${fraction}`;
}

// -----------------------------------------------------------------------------
// PNG, encoded here because nothing in this deployable encodes one
// -----------------------------------------------------------------------------

/** ISO 15948 clause 5.2. The same eight bytes `assertPng` checks for. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** ISO 15948 clause 5.5's CRC-32 table, built once from the stated polynomial. */
const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function beUint32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** One PNG chunk: length, type, data, and the CRC over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const tag = new Uint8Array([...type].map((character) => character.charCodeAt(0)));
  const body = concat([tag, data]);
  return concat([beUint32(data.length), body, beUint32(crc32(body))]);
}

/** `#RRGGBB` to three bytes. The palette is the only caller. */
function rgb(hex: string): readonly number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

/**
 * The canvas, as `image/png`.
 *
 * COLOUR TYPE 3 AT BIT DEPTH 8, which is one byte per pixel against a four
 * entry palette. The alternative, truecolour, triples the bytes handed to
 * `deflate` for an artefact carrying four colours; ADR-249 section 2.2 accepted
 * a render cost on an unauthenticated public path, and this sentence read "WITH
 * THE RATE LIMIT STILL OWED" until ADR-347 landed one. The limit is now the
 * bound on HOW MANY encodes an attacker can drive and this choice is still the
 * bound on WHAT EACH ONE COSTS, so the cheap encoding is the one that respects
 * the acceptance rather than the one the limit made unnecessary.
 *
 * EVERY SCANLINE CARRIES FILTER TYPE 0. A predictor would compress better and
 * would be a second algorithm to get wrong; the deflate is doing the work.
 */
function encodePng(canvas: Canvas, palette: readonly string[]): Uint8Array {
  const header = concat([
    beUint32(canvas.width),
    beUint32(canvas.height),
    Uint8Array.of(8, 3, 0, 0, 0),
  ]);
  const plte = new Uint8Array(palette.flatMap((hex) => [...rgb(hex)]));
  const stride = canvas.width + 1;
  const raw = new Uint8Array(stride * canvas.height);
  for (let row = 0; row < canvas.height; row += 1) {
    raw[row * stride] = 0;
    raw.set(canvas.pixels.subarray(row * canvas.width, (row + 1) * canvas.width), row * stride + 1);
  }
  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('PLTE', plte),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// -----------------------------------------------------------------------------
// The layout, which is FIXED so that no block moves with the state
// -----------------------------------------------------------------------------

const MARGIN = 48;
const CONTENT_WIDTH = CARD_WIDTH_PX - MARGIN * 2;
const RIGHT = CARD_WIDTH_PX - MARGIN;

/** The four type sizes. Integer scales; see {@link drawGlyph}. */
const HEADING_SCALE = 5;
const CODE_SCALE = 6;
const BODY_SCALE = 3;
const SMALL_SCALE = 2;

/** Where each block starts, in pixels from the top. Nothing here is state-dependent. */
const HEADING_Y = 48;
const ACCENT_RULE_Y = 100;
const CLAIM_Y = 130;
/** Five slots, whether the card has five rows or four. A pass card leaves one empty. */
const CLAIM_SLOTS = 5;
const CLAIM_SLOT_HEIGHT = 30;
const STATE_RULE_Y = 296;
const STATE_Y = 316;
const STATEMENT_Y = 352;
const STATEMENT_LINE_HEIGHT = 30;
const STATEMENT_LINES = 3;
const CODE_RULE_Y = 452;
const CODE_Y = 464;
const DISCLOSURE_Y = 532;
const DISCLOSURE_LINE_HEIGHT = 20;
const DISCLOSURE_LINES = 2;

/** The label column, and where the value beside it begins. */
const LABEL_WIDTH = 200;
const VALUE_X = MARGIN + 220;

function statementColumns(): number {
  return columnsIn(CONTENT_WIDTH, BODY_SCALE);
}

function disclosureColumns(): number {
  return columnsIn(CONTENT_WIDTH, SMALL_SCALE);
}

// -----------------------------------------------------------------------------
// The refusals, every one of them state-independent
// -----------------------------------------------------------------------------

/**
 * EVERY sentence, on EVERY render, including the four this card will not draw.
 *
 * `routes/verify.ts` states the reason in its own words and this is that reason
 * transcribed: "Every sentence is checked on every path, because a sentence
 * missing only for the result it describes is a hit-versus-miss oracle built
 * out of the configuration error." Here it buys something further. A check that
 * ran only on the sentence being drawn would let a deployment ship a broken
 * `fact_untrue` string and discover it on the first card that had to publish a
 * revocation, WHICH IS THE REVOCATION FAILING TO ARRIVE (`INV-M11-08`). Checked
 * this way, the deployment fails its very first fetch of any card at all.
 */
export function assertCopy(copy: CertificateCardCopy): void {
  const checks: readonly (readonly [string, string, number, number])[] = [
    ...CARD_STATEMENT_KEYS.map(
      (key) =>
        [`statements.${key}`, copy.statements[key], statementColumns(), STATEMENT_LINES] as const,
    ),
    ['disclosure', copy.disclosure, disclosureColumns(), DISCLOSURE_LINES] as const,
  ];

  for (const [field, sentence, columns, lines] of checks) {
    if (typeof sentence !== 'string' || sentence.trim() === '')
      throw new CertificateCardError(
        `\`copy.${field}\` is not a non-empty sentence. \`INV-M11-04\` puts the ` +
          'simulated-environment disclosure in the image and `INV-M11-07` gives every revocation ' +
          "class its own published sentence, and both are the deployment's copy rather than " +
          "this repository's",
      );

    const undrawable = [...sentence].filter((character) => !Object.hasOwn(GLYPHS, character));
    if (undrawable.length > 0)
      throw new CertificateCardError(
        `\`copy.${field}\` carries ${String(undrawable.length)} character(s) this typeface ` +
          `cannot draw, the first being \`${undrawable[0] ?? ''}\`. Merit's published wording is ` +
          'not silently replaced on a public artefact carrying its claim',
      );

    const wrapped = wrap(sentence, columns);
    if (wrapped.length > lines || wrapped.some((line) => [...line].length > columns))
      throw new CertificateCardError(
        `\`copy.${field}\` needs ${String(wrapped.length)} line(s) of ${String(columns)} ` +
          `characters and the card gives it ${String(lines)}. The box is the same size on every ` +
          'card, so this refusal reaches every card rather than only the one this sentence ' +
          'describes',
      );
  }
}

/** The row half of the input, refused before anything is drawn. */
function assertRow(input: CertificateCardInput): void {
  if (!(CARD_KINDS as readonly string[]).includes(input.kind))
    throw new CertificateCardError(`\`kind\` is \`${String(input.kind)}\`, which is not a card`);

  if (!(CARD_STATES as readonly string[]).includes(input.state))
    throw new CertificateCardError(
      `\`state\` is \`${String(input.state)}\`, and the states that RENDER are ` +
        `${CARD_STATES.join(' and ')}. A deferral is a claim Merit has not made yet (ADR-168 ` +
        'foreclosure 4), so there is nothing to draw and no field here to draw it from',
    );

  // THE BICONDITIONAL, BOTH WAYS. A revoked card with no revocation would draw
  // the valid sentence over a revoked row, and an issued card carrying one
  // would publish a revocation the row does not have.
  if ((input.state === 'revoked') !== (input.revocation !== null))
    throw new CertificateCardError(
      `\`state\` is \`${input.state}\` and \`revocation\` is ` +
        `${input.revocation === null ? 'null' : 'set'}. \`INV-M11-07\` makes the class drive the ` +
        'published sentence, so the two are one fact and a card that disagrees with itself ' +
        'publishes the wrong one',
    );

  if (
    input.revocation !== null &&
    !(CARD_REVOCATION_CLASSES as readonly string[]).includes(input.revocation.class)
  )
    throw new CertificateCardError(
      `\`revocation.class\` is \`${String(input.revocation.class)}\`, which is not one of ` +
        `${CARD_REVOCATION_CLASSES.join(', ')} (\`SD-M11-02\`)`,
    );

  if (!SUPPORTED_CLAIMS_SCHEMA_VERSIONS.includes(input.claimsSchemaVersion))
    throw new CertificateCardError(
      `\`claimsSchemaVersion\` is \`${String(input.claimsSchemaVersion)}\` and this template ` +
        `draws ${SUPPORTED_CLAIMS_SCHEMA_VERSIONS.join(', ')}. \`SD-M11-01\` exists so the claim ` +
        'shape can evolve, and a template that draws a shape it does not know is a card ' +
        'asserting a claim it did not read',
    );

  for (const [field, value] of [
    ['code', input.code],
    ['issuedAt', input.issuedAt],
    ['claims.plan_code', input.claims.plan_code],
    ['claims.trading_day', input.claims.trading_day],
  ] as const)
    if (value.trim() === '')
      throw new CertificateCardError(`\`${field}\` is blank and the card draws it`);

  if (input.revocation !== null && input.revocation.at.trim() === '')
    throw new CertificateCardError('`revocation.at` is blank and the card draws it');

  // THE KIND-SPECIFIC VALUE IS A BICONDITIONAL TOO, and `CertificateClaims` one
  // file over states it: "the payout card's kind-specific value. Absent on a
  // pass card."
  if ((input.kind === 'payout') !== (input.claims.amount_cents !== undefined))
    throw new CertificateCardError(
      `\`kind\` is \`${input.kind}\` and \`claims.amount_cents\` is ` +
        `${input.claims.amount_cents === undefined ? 'absent' : 'present'}. The amount is the ` +
        "PAYOUT card's kind-specific value (`INV-M11-01`), so a pass card carrying one draws a " +
        'figure the claim does not make',
    );
}

// -----------------------------------------------------------------------------
// The version, derived rather than stored (ADR-249 clause 8)
// -----------------------------------------------------------------------------

/**
 * The canonical form of the input, walked in {@link CARD_INPUT_KEYS}' order.
 *
 * BUILT BY NAMING EVERY KEY rather than by serialising the object, because
 * `JSON.stringify` over an object literal is key-INSERTION ordered: two callers
 * that built the same input in a different order would digest differently and a
 * cache would miss on a card that had not changed. The suite asserts this list
 * is total over the type.
 */
function canonical(input: CertificateCardInput): string {
  return JSON.stringify([
    ['kind', input.kind],
    [
      'claims',
      [
        ['plan_code', input.claims.plan_code],
        ['size_cents', input.claims.size_cents],
        ['amount_cents', input.claims.amount_cents ?? null],
        ['trading_day', input.claims.trading_day],
      ],
    ],
    ['claimsSchemaVersion', input.claimsSchemaVersion],
    ['code', input.code],
    ['issuedAt', input.issuedAt],
    ['state', input.state],
    [
      'revocation',
      input.revocation === null
        ? null
        : [
            ['class', input.revocation.class],
            ['at', input.revocation.at],
          ],
    ],
    [
      'copy',
      [
        ...CARD_STATEMENT_KEYS.map((key) => [key, input.copy.statements[key]]),
        ['disclosure', input.copy.disclosure],
      ],
    ],
  ]);
}

/**
 * `FM-M11-05`'s `row_version`, derived.
 *
 * THE CONFIGURED COPY IS INSIDE THE DIGEST AND THAT IS DELIBERATE. A deployment
 * that retunes the disclosure has changed what every card says, so every cached
 * card must miss; a version taken over the row alone would keep serving the old
 * sentence until something remembered to invalidate, which is `INV-M9-04`'s
 * "an invalidation that is fire-and-forget is a cache that is USUALLY RIGHT"
 * arriving one table later.
 *
 * SHA-256, WHICH IS THE ESTATE'S DIGEST RATHER THAN A CHOICE MADE HERE.
 */
export function certificateCardVersion(input: CertificateCardInput): string {
  return createHash('sha256').update(canonical(input), 'utf8').digest('hex');
}

// -----------------------------------------------------------------------------
// The template
// -----------------------------------------------------------------------------

/** The heading, by kind. Two cards, and M11 section 3.1 keeps them different. */
const HEADINGS: Readonly<Record<CertificateCardKind, string>> = {
  pass: 'EVALUATION PASS',
  payout: 'PAYOUT',
};

/** The sentence this card publishes, SELECTED BY THE CLASS (`INV-M11-07`). */
function statementFor(input: CertificateCardInput): string {
  return input.revocation === null
    ? input.copy.statements.valid
    : input.copy.statements[input.revocation.class];
}

/** The state line, which every card draws in the same place. */
function stateLine(input: CertificateCardInput): string {
  if (input.revocation === null) return 'ISSUED';
  const named = input.revocation.class.toUpperCase().split('_').join(' ');
  return `REVOKED ${input.revocation.at} (${named})`;
}

/**
 * The card.
 *
 * ONE ARGUMENT, AND EVERY VALUE DRAWN BELOW COMES OUT OF IT. That is the whole
 * of ADR-249 clause 8's condition and it is visible in the signature.
 */
export function renderCertificateCard(input: CertificateCardInput): RenderedCertificateCard {
  // BOTH HALVES OF THE INPUT ARE REFUSED BEFORE A PIXEL IS DRAWN, and the copy
  // half is checked WHOLE. See {@link assertCopy}.
  assertRow(input);
  assertCopy(input.copy);

  const canvas = blankCanvas(CARD_WIDTH_PX, CARD_HEIGHT_PX);

  // 1. THE HEADING, and the brass hairline under it. This is the one place the
  //    accent appears: DESIGN_SYSTEM section 2.2, "brass appears at most twice
  //    per viewport".
  drawText(canvas, HEADINGS[input.kind], MARGIN, HEADING_Y, HEADING_SCALE, INK, RIGHT);
  fill(canvas, MARGIN, ACCENT_RULE_Y, CONTENT_WIDTH, 4, BRASS);

  // 2. THE CLAIM, which is `INV-M11-01` and the whole of it. `amount_cents` is
  //    drawn on the payout card only, and `assertRow` already refused a pass
  //    card carrying one, so this branch cannot draw a figure the claim does
  //    not make. THE BLOCK IS FIVE SLOTS TALL EITHER WAY, so nothing below it
  //    moves with the kind.
  const rows: readonly (readonly [string, string])[] = [
    ['PLAN', input.claims.plan_code],
    ['SIZE', formatCents(input.claims.size_cents, 'claims.size_cents')],
    ...(input.claims.amount_cents === undefined
      ? []
      : ([['PAYOUT', formatCents(input.claims.amount_cents, 'claims.amount_cents')]] as const)),
    ['TRADING DAY', input.claims.trading_day],
    ['ISSUED', input.issuedAt],
  ];
  if (rows.length > CLAIM_SLOTS)
    throw new CertificateCardError(
      `the claim block draws ${String(rows.length)} rows and the card reserves ` +
        `${String(CLAIM_SLOTS)}. A block that grows past its reservation moves every block ` +
        'below it, and a layout that moves is a layout that can move with the state',
    );
  for (const [index, row] of rows.entries()) {
    const y = CLAIM_Y + index * CLAIM_SLOT_HEIGHT;
    drawText(canvas, row[0], MARGIN, y + SMALL_SCALE, SMALL_SCALE, INK, MARGIN + LABEL_WIDTH);
    drawText(canvas, row[1], VALUE_X, y, BODY_SCALE, INK, RIGHT);
  }

  // 3. THE STATE, DRAWN FOR BOTH STATES IN THE SAME PLACE. A revoked card is
  //    not a card with an extra block: it is the same block saying something
  //    else, under a rule that is heavier. `AS-M11-05` is why the difference is
  //    weight and never a hue.
  fill(canvas, MARGIN, STATE_RULE_Y, CONTENT_WIDTH, input.state === 'revoked' ? 6 : 1, INK);
  drawText(canvas, stateLine(input), MARGIN, STATE_Y, BODY_SCALE, INK, RIGHT);

  // 4. THE PUBLISHED SENTENCE, in a box of a fixed height. `assertCopy` has
  //    already established that every one of the five fits it.
  const statement = wrap(statementFor(input), statementColumns());
  for (const [index, line] of statement.entries())
    drawText(
      canvas,
      line,
      MARGIN,
      STATEMENT_Y + index * STATEMENT_LINE_HEIGHT,
      BODY_SCALE,
      INK,
      RIGHT,
    );

  // 5. THE CODE, which `SD-M11-01` requires to appear IN the image, above a
  //    hairline. `AS-M11-02` is why it is the largest thing on the card after
  //    the heading: a screenshot cannot be recalled, and the code printed
  //    inside it is what makes that recoverable.
  fill(canvas, MARGIN, CODE_RULE_Y, CONTENT_WIDTH, 1, RULE);
  drawText(canvas, input.code, MARGIN, CODE_Y, CODE_SCALE, INK, RIGHT);

  // 6. THE DISCLOSURE, on every card because `INV-M11-04` says every card, and
  //    the claim schema version the shape was drawn at (`SD-M11-01`).
  for (const [index, line] of wrap(input.copy.disclosure, disclosureColumns()).entries())
    drawText(
      canvas,
      line,
      MARGIN,
      DISCLOSURE_Y + index * DISCLOSURE_LINE_HEIGHT,
      SMALL_SCALE,
      INK,
      RIGHT,
    );
  drawText(
    canvas,
    `CLAIM SCHEMA ${String(input.claimsSchemaVersion)}`,
    RIGHT - advance(SMALL_SCALE) * 18,
    HEADING_Y,
    SMALL_SCALE,
    INK,
    RIGHT,
  );

  return {
    bytes: encodePng(canvas, [
      CARD_PALETTE.paper,
      CARD_PALETTE.ink,
      CARD_PALETTE.rule,
      CARD_PALETTE.brass,
    ]),
    version: certificateCardVersion(input),
  };
}
