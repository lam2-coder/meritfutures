// =============================================================================
// packages/harness/src/ratio.ts
// =============================================================================
// EXACT RATIONALS OVER `bigint`, BECAUSE AN AGGREGATE IS A FINANCIAL PATH.
//
// CLAUDE.md's convention is "money is integer cents; thresholds in basis points
// / integer cents. No floats in financial paths", and the sentence that decides
// this file is the parenthetical the session brief adds: **including in an
// aggregate.** A mean is a division, a rate is a division, and a division of
// integers is where a float enters a system that had none.
//
// The alternative shapes were both worse:
//
//   basis points only     `payoutsSettled * 10000 / payers` discards the
//                         remainder at the first division, and every later
//                         operation compounds a rounding nobody chose. RE-S-03's
//                         band is 1.8 to 2.4 and the difference between 2.0999
//                         and 2.1 is inside it
//   floats at the edge    "just for the report" is how a float reaches a number
//                         a founder reads and then quotes. The corpus's own
//                         calibration table is quoted to two decimals in four
//                         documents, and a figure that moves in the last place
//                         between two runs of the same seed is a figure nobody
//                         can reconcile
//
// SO A RESULT IS A PAIR AND A RENDERING IS DERIVED FROM IT. `Ratio` carries the
// numerator and the denominator that produced it, both `bigint`, and every
// comparison is a cross-multiplication rather than a division. `toBasisPoints`
// and `format` exist for a surface that needs one number; neither is ever the
// value, and the pair is always carried beside them so a reader never has to
// trust a rendering.
//
// EVERY RATIO IS REDUCED AND ITS DENOMINATOR IS POSITIVE. Reduction is not
// tidiness: `mul` chains three ratios in `aggregate.ts` and an unreduced
// denominator grows without bound across a sweep, and structural equality is
// what `run.ts` uses to report that two sweep arms returned the SAME number
// (SIMULATION_HARNESS section 9.3's flat-line warning). Two spellings of one
// value would make that report wrong in the direction that matters.
// =============================================================================

/** Thrown when a ratio cannot be formed or rendered. Never approximated away. */
export class RatioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatioError';
  }
}

/**
 * An exact rational. `denominator` is always positive and the pair is reduced.
 *
 * THE DENOMINATOR IS PART OF THE RESULT AND NOT AN IMPLEMENTATION DETAIL. On
 * every output in `outputs.ts` it is the sample the figure was computed over,
 * which is `INV-M21-04`'s second required field: "a simulation result without a
 * calibration identity AND A SAMPLE SIZE cannot be rendered".
 */
export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Build a ratio.
 *
 * A ZERO DENOMINATOR THROWS AND IS NEVER COERCED TO ZERO. `HO-07`'s rule is the
 * general one: "the field is ABSENT rather than zero, because a zero here would
 * read as 'no correlation measured'". An output with no sample is `null` at the
 * call site in `aggregate.ts`, which is a different value from `0`; a ratio that
 * quietly answered `0/1` for `0/0` would erase that distinction in the one place
 * a reader cannot see it.
 */
export function ratio(numerator: bigint, denominator: bigint): Ratio {
  if (denominator === 0n) {
    throw new RatioError(
      'a ratio with a zero denominator is not a measurement. An output with no sample is ' +
        'null (INV-M21-04, HO-07), never a zero',
    );
  }
  const sign = denominator < 0n ? -1n : 1n;
  const n = numerator * sign;
  const d = denominator * sign;
  const g = gcd(n, d);
  if (g === 0n) return { numerator: 0n, denominator: 1n };
  return { numerator: n / g, denominator: d / g };
}

/** An integer as a ratio. */
export function fromInteger(value: bigint): Ratio {
  return { numerator: value, denominator: 1n };
}

export const ZERO: Ratio = { numerator: 0n, denominator: 1n };

export function add(a: Ratio, b: Ratio): Ratio {
  return ratio(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function subtract(a: Ratio, b: Ratio): Ratio {
  return ratio(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function multiply(a: Ratio, b: Ratio): Ratio {
  return ratio(a.numerator * b.numerator, a.denominator * b.denominator);
}

/**
 * `-1`, `0` or `1`, by CROSS MULTIPLICATION.
 *
 * Both denominators are positive by construction, so the inequality direction is
 * preserved and no division is needed. This is what makes `RE-S-05`'s ceiling a
 * MAXIMUM OVER RATES rather than a maximum over roundings: 135,000c over 5
 * trading days and 27,000c over 1 are the same rate and compare equal here,
 * which a basis-point rendering would only manage by luck.
 */
export function compare(a: Ratio, b: Ratio): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function equals(a: Ratio, b: Ratio): boolean {
  return compare(a, b) === 0;
}

/** The larger of two ratios, exactly. */
export function maximum(a: Ratio, b: Ratio): Ratio {
  return compare(a, b) >= 0 ? a : b;
}

/** Floor division for `bigint`, which the language's `/` is not for negatives. */
export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RatioError('floorDiv needs a non-zero denominator');
  const sign = denominator < 0n ? -1n : 1n;
  const n = numerator * sign;
  const d = denominator * sign;
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
}

/**
 * The ratio in basis points, FLOORED, as an integer.
 *
 * FLOOR RATHER THAN NEAREST, AND THE CHOICE IS STATED RATHER THAN INHERITED.
 * Nearest-rounding a rate makes 14.99500 percent render as 15.00 percent, and
 * `RE-S-01`'s band edge is 12 to 20 percent: a value one ten-thousandth outside
 * a band that renders inside it is a failed band reported green, which is
 * exactly the failure `TR-03` names. Floor is uniform, and it is the same
 * direction for every output rather than a different direction per sign.
 *
 * The exact pair is always carried beside this on the output record, so nothing
 * downstream has to reconstruct what was discarded.
 */
export function toBasisPoints(value: Ratio): bigint {
  return floorDiv(value.numerator * 10_000n, value.denominator);
}

/**
 * A fixed-point rendering, for a report. Integer arithmetic throughout.
 *
 * The magnitude is truncated toward zero and the sign is carried separately,
 * which is what a reader expects of a printed figure: `-2.5` renders as `-2.50`
 * and not as `-2.51`. `toBasisPoints` floors instead because it is compared
 * against a band; this one is only ever read.
 */
export function format(value: Ratio, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new RatioError(`${String(decimals)} is not a decimal count in 0..12`);
  }
  const negative = value.numerator < 0n;
  const magnitude = negative ? -value.numerator : value.numerator;
  const scale = 10n ** BigInt(decimals);
  const scaled = (magnitude * scale) / value.denominator;
  const whole = scaled / scale;
  const fraction = scaled % scale;
  const sign = negative && scaled !== 0n ? '-' : '';
  if (decimals === 0) return `${sign}${whole.toString()}`;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(decimals, '0')}`;
}
