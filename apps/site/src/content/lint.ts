// =============================================================================
// apps/site/src/content/lint.ts
// =============================================================================
// VG-M9-2. THE CONTENT LINT, WHICH IS INV-M9-07's "single most important
// control in the module and the one most likely to be argued with".
//
// [M09](M09) section 5, AS-M9-02: "A currency amount, a percentage, or a day
// count appearing in prose fails the build unless it is emitted by
// `<PlanValue plan="core_eod" size="50K" field="payout_cap_cents"/>`, which
// reads config at render. The component is deliberately verbose to use, because
// the friction is the point: an author who wants to state a number must state
// which number, from which plan, at which size."
//
// THE ADVERSARY IS TIME AND THE VICTIM IS A SENTENCE. A launch post says the
// 50K plan pays up to $1,500 and requires 5 winning days. Eighteen months later
// the cap schedule has moved. The plans page is correct because it reads
// config, the rules page is correct because it renders `copy_blocks`, and the
// post is wrong, indexed, and ranks for exactly those queries. GS-143 makes
// that a build failure rather than a copy review, because prose decays and
// configuration moves.
//
// -----------------------------------------------------------------------------
// THE OG SURFACE IS LINTED AND IT IS THE HALF A LINT WRITTEN IN A HURRY DROPS
// -----------------------------------------------------------------------------
// GS-144 is "a published statistic rendered without its trailing window. The
// build fails, INCLUDING ON THE OG IMAGE PATH", and AS-M9-03 says why in one
// clause: the OG image and the social card are "where screenshots actually come
// from". A lint that reads the body and not the card is a lint that guards the
// surface nobody screenshots and leaves the surface everybody does.
//
// So the unit this file lints is not "the body". It is EVERY SURFACE THE
// DOCUMENT CARRIES, and the surfaces are discovered rather than listed: any
// `og_*` key in the frontmatter is a surface, so a new social field cannot be
// added without being covered by being new. That is INV-M9-05's shape
// (`page()` refusing a page with no disclosure) pointed at content, and it is
// the same argument [`disclosure.ts`](./../render/disclosure.ts) makes for
// GS-147, whose row fails "on headline, social card, email subject, and OG
// image".
//
// -----------------------------------------------------------------------------
// THE CEILING, STATED RATHER THAN DISCOVERED LATER
// -----------------------------------------------------------------------------
// [P1](P1) section 2.3 already wrote it: "A numeric-literal lint is evadable by
// arithmetic and by naming". An author who writes "five winning days" passes
// this lint, and so does an author who writes "fifteen hundred dollars". P1
// names the stronger check and gives it to P2: a property asserting that every
// parameter in the config changes some output. This file is tier 3 of three and
// it is not the strongest tier; saying so here is better than a reader
// inferring that a green lint means no parameter is stated in prose.
//
// The image case is not covered either and cannot be: M09 section 5 makes it a
// standing rule rather than a gate, "no marketing image contains a parameter
// value", because a number burned into a thumbnail is not text.
// =============================================================================

/**
 * A surface of an authored document, as the lint names it in a finding.
 *
 * `body` is the prose. Everything else is an `og_*` frontmatter key, carried
 * verbatim so a finding names the field an author has to go and edit.
 */
export type ContentSurface = string;

/** Which golden scenario a finding is an instance of. */
export type ContentRule = 'GS-143' | 'GS-144';

/** One refusal, with the text that caused it. */
export interface ContentFinding {
  readonly rule: ContentRule;
  /** `body`, or the `og_*` key. */
  readonly surface: ContentSurface;
  /** The offending text, quoted so the author can find it. */
  readonly quote: string;
  readonly message: string;
}

/** The build's refusal. A document that produces one never becomes a page. */
export class ContentLintError extends Error {
  readonly findings: readonly ContentFinding[];

  constructor(where: string, findings: readonly ContentFinding[]) {
    super(
      `VG-M9-2: ${where} fails the content lint with ${findings.length} ` +
        `finding(s).\n` +
        findings.map((f) => `  ${f.rule} in ${f.surface}: ${f.message}`).join('\n'),
    );
    this.name = 'ContentLintError';
    this.findings = findings;
  }
}

// -----------------------------------------------------------------------------
// The two sanctioned emitters
// -----------------------------------------------------------------------------

/**
 * `<PlanValue>`'s three required attributes, and the reason there is no fourth.
 *
 * The verbosity IS the control (M09 section 5). `plan` and `size` are what turn
 * "the cap is $1,500" into "the cap of THIS plan at THIS size", which is the
 * only form that can be read from `plan_versions` and `plan_version_sizes`
 * rather than from an author's memory.
 */
export const PLAN_VALUE_ATTRIBUTES = ['plan', 'size', 'field'] as const;

/**
 * Attributes `<Statistic>` refuses, and every one of them is a way to publish
 * the figure without its tail.
 *
 * `window` is on this list and that is the subtle one. The window is
 * `published_statistics`' own, one column beside the value, and an author who
 * SUPPLIES it is stating a window rather than reading one. A stated window
 * drifts from the computed one on the first day the run moves, which is
 * AS-M9-03's screenshot with the firm's own build as the adversary.
 *
 * This is [`stats.ts`](./../routes/stats.ts)'s rule at the authoring layer:
 * "there is deliberately no `justTheValue`: a template that could reach the
 * figure alone is a template that will, on the one surface that gets cropped".
 */
export const STATISTIC_TAIL_STRIPPING_ATTRIBUTES = [
  'window',
  'value-only',
  'valueonly',
  'bare',
  'hide-window',
  'hidewindow',
  'no-window',
  'nowindow',
  'figure-only',
  'figureonly',
] as const;

/**
 * The one carve-out, exact and cited.
 *
 * [ADR-042](ADR-042)'s settlement window is a BANKING RAIL UNIT that Merit
 * quotes and never computes, and `plan_versions` carries no field a
 * `<PlanValue>` could name for it. AS-M9-06 states this sentence verbatim
 * inside a frozen plan and INV-M9-09 makes omitting either leg the defect, so
 * an author writing the canonical copy onto a social card is doing the thing
 * the corpus requires and must not be refused for it.
 *
 * It is an EXACT SUBSTRING and not a pattern, because an exact carve-out cannot
 * be widened by accident and a pattern can. A different day count in the same
 * sentence is a different sentence and fails.
 */
export const SETTLEMENT_WINDOW_CARVE_OUT =
  'Withdrawing from your wallet to your bank takes 2 to 3 business days.';

// -----------------------------------------------------------------------------
// The needles
// -----------------------------------------------------------------------------

/**
 * A figure, in the three shapes M09 section 5 names.
 *
 * Each is `g`-flagged and each is rebuilt per call rather than shared, because
 * a `g` regex carries `lastIndex` and a shared one skips every other match on
 * its second use. That defect passes every test written against a single
 * document.
 */
function figureNeedles(): readonly { readonly kind: string; readonly re: RegExp }[] {
  return [
    { kind: 'a currency amount', re: /\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?\b/g },
    { kind: 'a currency amount', re: /\b\d[\d,]*(?:\.\d+)?\s?(?:USD|dollars?)\b/gi },
    { kind: 'a percentage', re: /\b\d[\d,]*(?:\.\d+)?\s?%/g },
    {
      kind: 'a percentage',
      re: /\b\d[\d,]*(?:\.\d+)?\s?(?:percent|basis points?|bps?)\b/gi,
    },
    { kind: 'a day count', re: /\b\d[\d,]*(?:\s+[a-z]+){0,2}\s+days?\b/gi },
    { kind: 'a day count', re: /\b\d[\d,]*[- ]day\b/gi },
  ];
}

/**
 * A statistic that ALREADY CARRIES ITS TAIL, which is the shape GS-144 permits.
 *
 * THIS EXISTS BECAUSE THE TWO HALVES OF THE CONTROL WOULD OTHERWISE CONTRADICT
 * EACH OTHER, and the contradiction was found by asserting it rather than by
 * reasoning about it. `statisticText` in [`stats.ts`](./../routes/stats.ts)
 * emits `14.70% (2026-04-14 to 2026-08-20, as of 2026-08-20, n=2803)`: the
 * value, the window, the as-of trading day and the sample as ONE string, which
 * is precisely AS-M9-03's "in the same visual unit as the number". A lint that
 * refused that string would refuse the only sanctioned output of the only
 * sanctioned accessor, and a lint that is wrong about the correct case is a
 * lint somebody disables in its first week, correctly.
 *
 * GS-144's sentence is "a published statistic rendered WITHOUT its trailing
 * window". A figure carrying its window is the passing case and has to read as
 * one here.
 *
 * NONE OF THE FIGURE ALTERNATIVES BELOW CAN CONTAIN A SECOND BARE FIGURE, which
 * is what keeps this from being a hole: the numeric shapes stop at their own
 * token and the word shape matches no digit, so "the cap is $1,500 and the rate
 * is 14.70% (window, as of day, n=N)" blanks the rate and leaves the cap to be
 * refused.
 *
 * IT IS PINNED AGAINST `statisticText` BY AN ASSERTION AND NOT BY A COMMENT.
 * The suite feeds real `statisticText` output through this expression, so a
 * change to that format breaks a test rather than silently widening a carve-out.
 * That is this repository's own rule: prefer a mechanical assertion over a
 * second reading of the source.
 */
const RENDERED_TAIL = String.raw`\(\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}, as of \d{4}-\d{2}-\d{2}, n=[\d,]+\)`;

/** `money`, `basisPoints`, `count`, `duration`, or INV-M12-05's reason. */
const RENDERED_FIGURE = String.raw`(?:-?\$?[\d,]+(?:\.\d+)?%?|-?[\d,]+h \d+m|-?\d+m \d+s|-?\d+s|[A-Za-z][A-Za-z -]*)`;

/** The whole sanctioned shape: a figure and the tail that makes it statable. */
export function statisticWithTail(): RegExp {
  return new RegExp(`${RENDERED_FIGURE} ${RENDERED_TAIL}`, 'g');
}

/** `<PlanValue ... />` and `<Statistic ... />`, self-closing or paired. */
const SANCTIONED_ELEMENT = /<(PlanValue|Statistic)\b([^>]*)\/?>/g;

/** A fenced code block. A code sample is not prose and M09 says prose. */
const FENCED_CODE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

// -----------------------------------------------------------------------------
// The document
// -----------------------------------------------------------------------------

/** One authored surface: a name and the text the lint reads. */
export interface AuthoredSurface {
  readonly name: ContentSurface;
  readonly text: string;
}

/**
 * Split an authored MDX source into the surfaces the lint reads.
 *
 * THE OG KEYS ARE DISCOVERED AND NOT LISTED. Any frontmatter key beginning
 * `og_` is a surface. A future `og_image_alt`, `og_card_headline` or
 * `og_twitter_summary` is covered on the day it is authored rather than on the
 * day somebody remembers to extend a list, which is the difference between this
 * and the lint GS-144 exists because somebody wrote in a hurry.
 */
export function authoredSurfaces(source: string): readonly AuthoredSurface[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  const frontmatter = match === null ? '' : (match[1] ?? '');
  const body = match === null ? source : source.slice(match[0].length);

  const surfaces: AuthoredSurface[] = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    const key = kv?.[1] ?? '';
    if (!key.toLowerCase().startsWith('og_')) continue;
    surfaces.push({ name: key, text: unquote(kv?.[2] ?? '') });
  }
  surfaces.push({ name: 'body', text: body });
  return surfaces;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : (quoted[2] ?? '');
}

// -----------------------------------------------------------------------------
// The lint
// -----------------------------------------------------------------------------

/**
 * Every refusal this document earns, over every surface it carries.
 *
 * Returns findings rather than throwing, so a caller can report all of them at
 * once. {@link assertAuthoredContentIsClean} is the build's half.
 */
export function lintAuthoredContent(source: string): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];
  for (const surface of authoredSurfaces(source)) {
    findings.push(...lintSurface(surface));
  }
  return findings;
}

function lintSurface(surface: AuthoredSurface): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];

  // A fenced block is a code sample. An INLINE span is NOT stripped, and that
  // is deliberate: backticks around a price are typography, and a lint that
  // ignored them would be one keystroke from being evadable.
  const prose = surface.name === 'body' ? surface.text.replace(FENCED_CODE, blank) : surface.text;

  // The sanctioned elements are checked, then blanked, so their own attributes
  // (`size="50K"`, which IS config under INV-M9-12) cannot read as bare prose.
  const masked = prose.replace(SANCTIONED_ELEMENT, (whole, name: string, attrs: string) => {
    findings.push(...lintElement(surface.name, name, attrs, whole));
    return blank(whole);
  });

  const carved = masked.split(SETTLEMENT_WINDOW_CARVE_OUT).join(blank(SETTLEMENT_WINDOW_CARVE_OUT));

  // A statistic that already carries its window is the PASSING case of GS-144,
  // so it is blanked before the figure scan rather than refused by it.
  const scannable = carved.replace(statisticWithTail(), blank);

  for (const needle of figureNeedles()) {
    for (const hit of scannable.matchAll(needle.re)) {
      findings.push({
        rule: 'GS-143',
        surface: surface.name,
        quote: hit[0].trim(),
        message:
          `${needle.kind}, "${hit[0].trim()}", is stated in prose. INV-M9-07: a ` +
          'figure on a public surface is READ from the pinned plan version, never ' +
          'copied into a sentence. Emit it with <PlanValue plan="..." size="..." ' +
          'field="..."/>, or with <Statistic code="..."/> if it is a published statistic.',
      });
    }
  }
  return findings;
}

function lintElement(
  surface: ContentSurface,
  name: string,
  attrs: string,
  whole: string,
): readonly ContentFinding[] {
  const present = new Set(
    [...attrs.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => (m[1] ?? '').toLowerCase()),
  );

  if (name === 'PlanValue') {
    const missing = PLAN_VALUE_ATTRIBUTES.filter((a) => !present.has(a));
    if (missing.length === 0) return [];
    return [
      {
        rule: 'GS-143',
        surface,
        quote: whole.trim(),
        message:
          `<PlanValue> is missing ${missing.join(', ')}. All three are required, and ` +
          'the verbosity is the control: an author who wants to state a number must ' +
          'state which number, from which plan, at which size (AS-M9-02).',
      },
    ];
  }

  // `<Statistic>`.
  const findings: ContentFinding[] = [];
  if (!present.has('code')) {
    findings.push({
      rule: 'GS-144',
      surface,
      quote: whole.trim(),
      message:
        '<Statistic> is missing code. A statistic is addressed by its ' +
        '`published_statistics.stat_code` and by nothing else, so a card cannot ' +
        'name a figure the transparency run never published.',
    });
  }
  for (const banned of STATISTIC_TAIL_STRIPPING_ATTRIBUTES) {
    if (!present.has(banned)) continue;
    findings.push({
      rule: 'GS-144',
      surface,
      quote: whole.trim(),
      message:
        `<Statistic> carries ${banned}, which would publish the figure without its ` +
        'trailing window. The window, the as-of trading day and the sample travel ' +
        'with the value as one unit (INV-M12-04, AS-M9-03), and they come off the ' +
        'published row rather than from the author. A statistic rendered without ' +
        'its window is a build failure, including on the OG image path.',
    });
  }
  return findings;
}

/** Same length, no content, so every offset in a later match still points home. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * The build's half of VG-M9-2. GS-143 and GS-144, as a compiler refusal.
 *
 * A document that reaches this and fails never becomes a page, which is what
 * "the build fails" means in a tree whose authored content arrives as
 * `content_documents.body_mdx` over HTTP ([ADR-096](ADR-096)) rather than as a
 * file the framework compiles.
 */
export function assertAuthoredContentIsClean(source: string, where: string): void {
  const findings = lintAuthoredContent(source);
  if (findings.length > 0) throw new ContentLintError(where, findings);
}
