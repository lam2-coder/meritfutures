// =============================================================================
// apps/admin/src/figure.ts
// =============================================================================
// A NUMBER ON THIS PAGE IS NOT A NUMBER. It is a number, its definition, the
// moment it was true, and where it came from, and the four travel together
// because two invariants say they must.
//
//   INV-M6-04   "Every number on the liability page names its AS-OF moment and
//               its SOURCE. A figure whose freshness is unstated is a figure
//               that will eventually be quoted stale in a decision that
//               mattered" (M06 section 1.3)
//   AS-M6-04    "Three named numbers, never one, EACH WITH ITS OWN DEFINITION
//               PRINTED NEXT TO IT" (M06 section 7)
//
// SO THE DEFINITION IS A FIELD AND NOT A COMMENT, AND THE RENDERER CANNOT DROP
// IT. The tempting shape is `{ label, cents }` with the definition living in a
// tooltip, a legend or a design file. That shape renders a bare number the
// moment anything reuses the value, which is precisely how "open liability"
// comes to mean whichever of the three numbers the caller had to hand. Here a
// figure that cannot state its own definition cannot be constructed, and a
// rendering that omits it cannot be produced, because `render` takes the whole
// record and there is no accessor that returns the cents alone as text.
//
// ABSENT IS A VALUE AND ZERO IS NOT. `readingIsPresent` narrows a union whose
// other arm carries no `cents` field at all, so a panel with no data cannot be
// read as a panel reporting nothing owed. That is `packages/harness`'s `HO-07`
// rule in the one place it matters most: "the field is ABSENT rather than zero,
// because a zero here would read as 'no correlation measured'". On this page a
// zero would read as "Merit owes nobody anything", which is the confidently
// wrong answer AS-M6-04 is entirely about.
//
// AUTHORITY IS ON THE FIGURE BECAUSE INV-M6-12 IS ENFORCED RATHER THAN INTENDED.
// ADR-020 puts a live indicative Open Liability on this page beside the
// authoritative one, and rules that "no breaker, alarm, or task threshold reads
// one". A caller that decides something calls `authoritative()`, which refuses
// an indicative figure by construction rather than by review.
// =============================================================================

import type { Cents } from '@merit/rules-engine';

/** Thrown when a figure cannot be formed or rendered. Never approximated away. */
export class FigureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigureError';
  }
}

/**
 * WHERE ON THE PAGE A FIGURE COMES FROM, and it is a closed roster because the
 * roster is what a reader of a stale screenshot matches against the plan.
 *
 * M06 section 3.1 names ten panels, `P-M6-01` to `P-M6-10`.
 *
 * `AS-M6-04` IS THE ELEVENTH MEMBER AND IT IS A CITATION RATHER THAN A CLAIM.
 * AS-M6-04's counter is "three named numbers, never one, each with its own
 * definition printed next to it", and its third number is **remaining ladder
 * exposure**, `sum((ladder - payouts_settled) * cap)`. That number is stored:
 * `0009` carries `remaining_ladder_exposure_cents NOT NULL`. **Section 3.1's
 * panel table has no row for it**, so the page owes a figure that the panel
 * roster cannot name.
 *
 * The remedy available to a session fenced to `apps/admin` is to cite the
 * identifier that already exists rather than to mint `P-M6-11`. ADR-034's rule
 * is the reason: a `P-M6-nn` written here is a claim on a series with no
 * allocation table, made by a session that cannot add the row to the document
 * that owns it. So the third number's origin is the scenario that requires it,
 * and the gap is recorded in the session log for whoever holds M06 next.
 */
const ORIGIN_ID = /^(P-M6-(0[1-9]|10)|AS-M6-04)$/;

/**
 * WHEN A FIGURE WAS TRUE, AND WHAT IT WAS READ FROM. Both halves are required
 * by INV-M6-04 and neither is derivable from the other: a snapshot row read at
 * noon carries the morning's `as_of`, and that gap is the whole subject of
 * `admin.liability_snapshot_age` in M06 section 9.
 */
export interface AsOf {
  /**
   * The instant the figure was true, UTC, ISO-8601, `Z`-suffixed.
   *
   * CLAUDE.md: "Timestamps UTC in storage". A local-offset instant here is a
   * figure whose freshness is stated in a timezone the reader has to know,
   * which is a freshness that will be misread rather than one that is unstated.
   */
  readonly instant: string;
  /**
   * The primary source. A table name, a view name, or the module that supplied
   * it. `liability_snapshots` and `M2 recon status` are both answers; "the
   * dashboard" is not, which is why this is prose rather than an enum: the
   * suppliers are several modules wide (DEP-M6-01 to DEP-M6-05) and a closed
   * vocabulary written now would be wrong by the second supplier.
   */
  readonly source: string;
}

/**
 * ADR-020's two tiers, carried on the value rather than beside it.
 *
 * `authoritative` is computed from closed data. `indicative` is section 3.5's
 * live figure: "for the founder's eyes between batches; the same number decides
 * nothing automatically" (INV-M6-12).
 */
export type Authority = 'authoritative' | 'indicative';

/** A number this page may render, with everything INV-M6-04 requires beside it. */
export interface Figure {
  /** `P-M6-01` to `P-M6-10`, or `AS-M6-04` for the number no panel names. */
  readonly origin: string;
  /** What the number is called on the page. */
  readonly label: string;
  /** What the number MEANS, printed beside it. AS-M6-04. */
  readonly definition: string;
  readonly cents: Cents;
  readonly asOf: AsOf;
  readonly authority: Authority;
}

/**
 * A number the page must name and cannot supply.
 *
 * IT CARRIES NO `cents` FIELD, WHICH IS THE POINT. A caller that wants the
 * amount must narrow the union first, and narrowing forces it past the reason.
 * The label and definition survive because a panel that vanishes when its
 * supplier is late is a panel nobody notices is missing.
 */
export interface AbsentFigure {
  readonly origin: string;
  readonly label: string;
  readonly definition: string;
  /** Why there is no number. Names the missing supplier, never "unavailable". */
  readonly reason: string;
}

/** Either a number with its provenance, or the stated absence of one. */
export type Reading =
  | { readonly kind: 'figure'; readonly figure: Figure }
  | {
      readonly kind: 'absent';
      readonly absent: AbsentFigure;
    };

function requireText(value: string, field: string): string {
  if (value.trim() === '') throw new FigureError(`${field} is blank, and INV-M6-04 requires it`);
  return value;
}

/**
 * A `Z`-suffixed ISO-8601 instant that round-trips.
 *
 * `Date.parse` alone accepts `2026-08-21` and a local-offset stamp, and both
 * are wrong here for the same reason: the first is a day rather than a moment
 * and the second is a moment in a timezone the page does not state.
 */
function requireUtcInstant(instant: string): string {
  const parsed = new Date(instant);
  if (!instant.endsWith('Z') || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== instant)
    throw new FigureError(
      `as-of instant ${JSON.stringify(instant)} is not a UTC ISO-8601 instant; ` +
        'CLAUDE.md stores timestamps in UTC and INV-M6-04 renders them',
    );
  return instant;
}

function requireOrigin(origin: string): string {
  if (!ORIGIN_ID.test(origin))
    throw new FigureError(
      `${JSON.stringify(origin)} is not one of P-M6-01 to P-M6-10 or AS-M6-04, ` +
        'and M06 section 3.1 fixes the roster this page renders',
    );
  return origin;
}

/**
 * Build a figure. Every field is checked, because each one is an invariant
 * rather than a convenience.
 */
export function figure(fields: {
  origin: string;
  label: string;
  definition: string;
  cents: Cents;
  asOf: AsOf;
  authority: Authority;
}): Reading {
  return {
    kind: 'figure',
    figure: {
      origin: requireOrigin(fields.origin),
      label: requireText(fields.label, 'label'),
      definition: requireText(fields.definition, 'definition'),
      cents: fields.cents,
      asOf: {
        instant: requireUtcInstant(fields.asOf.instant),
        source: requireText(fields.asOf.source, 'source'),
      },
      authority: fields.authority,
    },
  };
}

/**
 * Declare a number absent, with the reason a reader needs in order to know who
 * owes it. The reason is required and blank is refused: "unavailable" written
 * by the schema is the same silence, spelled.
 */
export function absent(fields: {
  origin: string;
  label: string;
  definition: string;
  reason: string;
}): Reading {
  return {
    kind: 'absent',
    absent: {
      origin: requireOrigin(fields.origin),
      label: requireText(fields.label, 'label'),
      definition: requireText(fields.definition, 'definition'),
      reason: requireText(fields.reason, 'reason'),
    },
  };
}

/** Narrow a reading to the arm that has a number. */
export function readingIsPresent(
  reading: Reading,
): reading is { readonly kind: 'figure'; readonly figure: Figure } {
  return reading.kind === 'figure';
}

/**
 * THE GATE INV-M6-12 NEEDS, and the reason `authority` is a field.
 *
 * "No breaker reads it. The plan loss-ratio breaker, the RCR trigger, the
 * payout-velocity alarm, and ADR-011's same-day top-up task all read
 * authoritative figures only" (M06 section 3.5). Anything that DECIDES calls
 * this and gets a refusal rather than a plausible number.
 */
export function authoritative(figureValue: Figure): Figure {
  if (figureValue.authority !== 'authoritative')
    throw new FigureError(
      `${figureValue.label} is an indicative figure and INV-M6-12 forbids a control reading one: ` +
        'a live number that could pause sales would be an intraday vendor feed with a revenue lever attached',
    );
  return figureValue;
}

/**
 * Integer cents to a decimal string, by `bigint` division.
 *
 * CLAUDE.md: "Money is integer cents ... No floats in financial paths". A
 * `Number(cents) / 100` here is the float that reaches the one number a founder
 * reads and then quotes, which is `packages/harness/src/ratio.ts`'s argument
 * arriving one package over.
 */
export function formatCents(cents: Cents): string {
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const whole = magnitude / 100n;
  const part = magnitude % 100n;
  return `${negative ? '-' : ''}${whole}.${part.toString().padStart(2, '0')}`;
}

/**
 * The ONLY way to turn a reading into a line of display text, and it cannot
 * omit the definition, the as-of or the source.
 *
 * An indicative figure says so IN THE TEXT rather than in a class name, because
 * INV-M6-12's requirement is that it is "never presented as an as-of-last-closed
 * figure" and a style is not a presentation a screenshot preserves.
 */
export function render(reading: Reading): string {
  if (!readingIsPresent(reading)) {
    const { absent: gap } = reading;
    return `${gap.label}: not available (${gap.reason}) [${gap.definition}]`;
  }
  const { figure: value } = reading;
  const tier = value.authority === 'indicative' ? 'INDICATIVE, ' : '';
  return (
    `${value.label}: ${formatCents(value.cents)} ` +
    `[${value.definition}] ` +
    `(${tier}as of ${value.asOf.instant}, source ${value.asOf.source})`
  );
}
