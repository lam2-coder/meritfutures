// =============================================================================
// apps/site/src/render/cents.ts
// =============================================================================
// THE ONE HELPER EVERY CENTS VALUE ON A PUBLIC PAGE GOES THROUGH.
//
// M9 section 2.1 names it in the sentence that decides GS-310: the absent
// marketed label renders "the capital figure derived from `size_cents`,
// formatted by the same helper every other cents value on the page goes
// through". One helper is the requirement, not an implementation detail: a
// second formatter is how a price page and a rules page come to state the same
// figure two ways, which is the marketing-versus-implementation gap constitution
// 0.5 names, arrived at through typography.
//
// THREE RULES, AND THEY ARE `scripts/demo/render.ts`'s THREE.
//
//   NO FLOATS. CLAUDE.md's conventions: money is integer cents, no floats in
//   financial paths, and doc examples too. `Number(cents) / 100` is correct up
//   to 2^53 cents and wrong afterwards in a way nobody notices until it is on
//   the pricing page. This divides `bigint` by `100n` and pads the remainder.
//
//   NO `toLocaleString`. It reads the environment's locale, so a build machine
//   with a different `LC_ALL` renders different bytes. FM-M9-08's recovery is
//   "the build digest asserted post-deploy", and a digest over locale-dependent
//   output is a digest that alarms on the runner rather than on an attacker.
//   The thousands separator is inserted by hand.
//
//   NO ROUNDING, EVER, AND NO ABBREVIATION. `$25,000.00` and never `$25K`. An
//   abbreviation is a rounding with a friendly face, and INV-M9-12 forbids the
//   label being "rounded, or converted back into a number" in the other
//   direction for the same reason. A firm whose brand is that the rules do not
//   surprise you does not publish a figure that is close.
//
// THIS IS THE SECOND COPY OF `money()` IN THE TREE and the duplication is
// deliberate rather than unnoticed. The first is `scripts/demo/render.ts`,
// which is DELIBERATELY NOT A WORKSPACE PACKAGE (its own tsconfig says so, and
// the root manifest spends a paragraph on why), so there is nothing to import
// it from. Appendix F2's rule of three says two copies is not yet a shared
// module; when a third caller appears, the shared home is `packages/`, and the
// note is written here so the third author does not have to rediscover it.
// =============================================================================

import type { Cents } from '@merit/rules-engine';

/**
 * `$50,000.00`, from integer cents, with no float anywhere on the path.
 *
 * Negative is rendered with a leading minus rather than with parentheses,
 * because a public page's figures are prices, caps and sizes and none of them
 * is an accounting entry. A negative reaching here is a defect upstream, and it
 * renders honestly instead of being clamped.
 */
export function money(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = grouped(abs / 100n);
  const fraction = String(abs % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${fraction}`;
}

/** Thousands separators, inserted by hand because `toLocaleString` reads a locale. */
function grouped(value: bigint): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return out;
}

/**
 * A ratio stored in basis points, rendered as a percentage.
 *
 * BASIS POINTS ARE INTEGERS AND SO IS THIS OUTPUT'S FRACTION. CLAUDE.md:
 * "thresholds in basis points / integer cents. No floats in financial paths."
 * `1470` renders `14.7%` and `1400` renders `14%`; the trailing zeroes are
 * dropped because a percentage is a ratio rather than money, and `14.00%` on a
 * rules page reads as a precision the config does not claim. The digits
 * themselves are exact: the integer is split, never divided into a float.
 *
 * It is here rather than in the rules page because ST-01, ST-02 and ST-07
 * publish rates in basis points too (`0021_transparency.sql`), so the stats
 * page and the rules page must render a ratio the same way or the same number
 * reads as two.
 */
export function basisPoints(bp: number): string {
  if (!Number.isInteger(bp)) {
    throw new CentsFormatError(
      `basis points are an integer unit and ${bp} is not an integer. ` +
        'A ratio that arrived as a float was computed somewhere it should have been read.',
    );
  }
  const negative = bp < 0;
  const abs = Math.abs(bp);
  const whole = Math.trunc(abs / 100);
  const remainder = abs % 100;

  // THE THREE CASES ARE WRITTEN OUT because the tempting one-liner is a
  // `replace(/0$/, '')` over the padded pair, and that turns `00` into `0` and
  // renders `14.0%`. Two of these branches produce a single fraction digit and
  // one produces two, and there is no string operation that does all three.
  const tail =
    remainder === 0
      ? ''
      : remainder % 10 === 0
        ? `.${remainder / 10}`
        : `.${String(remainder).padStart(2, '0')}`;

  return `${negative ? '-' : ''}${whole}${tail}%`;
}

/** Thrown when a value reaches a formatter in a unit it cannot be in. */
export class CentsFormatError extends Error {
  override readonly name = 'CentsFormatError';
}
