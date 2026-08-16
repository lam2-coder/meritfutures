// =============================================================================
// packages/rithmic/src/simulator/rng.ts
// =============================================================================
// DETERMINISM IS THE WHOLE VALUE OF THIS PACKAGE, so the randomness is keyed
// rather than streamed, and the difference is the design decision in this file.
//
// A STREAM would be one generator advanced across the whole run: account 1's
// day 1, then account 2's day 1, and so on. It is deterministic in the weak
// sense that one program run reproduces itself. It is NOT stable under any
// change to what is drawn or in what order, so adding a seventh account to a
// six-account population changes every draw after it, and a golden file derived
// against the population moves for a reason that has nothing to do with the
// scenario it pins. A simulator whose output shifts when the population grows
// cannot be the thing goldens are derived against, which is the property the
// session brief names.
//
// A KEYED DRAW is a pure function of (seed, account, trading day, purpose).
// Account A's day is independent of every other account, of the population's
// size, and of iteration order. `determinism.test.ts` asserts that directly:
// the same six accounts drawn out of a population of six and a population of
// twenty produce byte-identical rows.
//
// NO FLOATING POINT ANYWHERE. Constitution and CLAUDE.md: money is integer
// cents and there are no floats in financial paths. Every draw here returns an
// integer or a bigint, and `Math.imul` and the shifts are integer operations.
// The one `Math.floor` is on a byte-count, not on money.
//
// The mixing function is the `lowbias32` finalizer, and the string hash is
// FNV-1a. Both are integer-only, both avalanche well enough for a fixture
// population, and neither is a cryptographic claim: nothing here defends
// against an adversary, it defends against a session that assumed two accounts
// were independent when they were not.
// =============================================================================

/** Thrown by every guard in this file. A draw that cannot be made is never approximated. */
export class DrawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawError';
  }
}

const ASCII_MAX = 0x7f;
const TWO_32 = 0x1_0000_0000;
const TWO_64 = 1n << 64n;

/**
 * FNV-1a over the key's code units.
 *
 * ASCII IS ENFORCED RATHER THAN ASSUMED. Hashing UTF-16 code units means a key
 * containing an astral character hashes its surrogate halves, which is stable
 * but is the sort of thing that stops being stable when someone "fixes" it to
 * hash bytes. Every key this package builds is ASCII by construction, so the
 * guard costs nothing and removes the question.
 */
function fnv1a32(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code > ASCII_MAX) {
      throw new DrawError(
        `draw key ${JSON.stringify(key)} contains a non-ASCII character at ${i}. ` +
          'Keys are built from account refs, trading days and purpose labels, all ASCII',
      );
    }
    hash ^= code;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The `lowbias32` finalizer. Integer only. */
function avalanche32(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x21f0aaad);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x735a2d97);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

/** An inclusive integer interval, stated by the caller rather than defaulted. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** A counter-based draw sequence over one key. Every method is total or throws. */
export interface Draws {
  /** The key this sequence was opened on. Carried for error messages and tests. */
  readonly key: string;
  /** The next 32 bits. */
  uint32(): number;
  /** A uniform integer in `[low, high]`, rejection-sampled so the range is unbiased. */
  intBetween(lowInclusive: number, highInclusive: number): number;
  /** `intBetween` over a caller-stated range. */
  inRange(range: Range): number;
  /** A uniform bigint in `[low, high]`. Cents never pass through a `number`. */
  centsBetween(lowInclusive: bigint, highInclusive: bigint): bigint;
  /** True with probability `basisPoints / 10000`. Basis points, per CLAUDE.md. */
  chanceInBasisPoints(basisPoints: number): boolean;
  /** One element, uniformly. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /**
   * The sum of `count` draws from `[low, high]`, which is Irwin-Hall and is the
   * cheapest integer route to a bell-shaped draw. Used for tick excursions,
   * never for money.
   */
  sumOfDraws(count: number, lowInclusive: number, highInclusive: number): number;
}

/**
 * Open a draw sequence.
 *
 * The key is the whole contract: two calls with the same key produce the same
 * sequence, and no call is influenced by any other key. Callers build keys with
 * `drawKey` so the separator is in one place.
 */
export function draws(key: string): Draws {
  const seed = fnv1a32(key);
  let counter = 0;

  const uint32 = (): number => {
    const mixed = avalanche32((counter + 0x9e3779b9) >>> 0);
    counter += 1;
    return avalanche32((seed ^ mixed) >>> 0);
  };

  const uint64 = (): bigint => (BigInt(uint32()) << 32n) | BigInt(uint32());

  const intBetween = (lowInclusive: number, highInclusive: number): number => {
    if (!Number.isSafeInteger(lowInclusive) || !Number.isSafeInteger(highInclusive)) {
      throw new DrawError(`range ${lowInclusive}..${highInclusive} is not integral`);
    }
    if (highInclusive < lowInclusive) {
      throw new DrawError(`range ${lowInclusive}..${highInclusive} ends before it starts`);
    }
    const span = highInclusive - lowInclusive + 1;
    if (span > TWO_32) {
      throw new DrawError(`range ${lowInclusive}..${highInclusive} is wider than 2^32`);
    }
    if (span === TWO_32) return lowInclusive + uint32();
    // Rejection sampling. `uint32() % span` is biased toward the low end of the
    // range whenever span does not divide 2^32, and a biased trade-count draw
    // is the kind of defect that is invisible in a fixture and visible in a
    // calibration band.
    const limit = TWO_32 - (TWO_32 % span);
    let value = uint32();
    while (value >= limit) value = uint32();
    return lowInclusive + (value % span);
  };

  const centsBetween = (lowInclusive: bigint, highInclusive: bigint): bigint => {
    if (highInclusive < lowInclusive) {
      throw new DrawError(`cents range ${lowInclusive}..${highInclusive} ends before it starts`);
    }
    const span = highInclusive - lowInclusive + 1n;
    if (span > TWO_64) {
      throw new DrawError(`cents range ${lowInclusive}..${highInclusive} is wider than 2^64`);
    }
    if (span === TWO_64) return lowInclusive + uint64();
    const limit = TWO_64 - (TWO_64 % span);
    let value = uint64();
    while (value >= limit) value = uint64();
    return lowInclusive + (value % span);
  };

  return Object.freeze({
    key,
    uint32,
    intBetween,
    inRange: (range: Range) => intBetween(range.min, range.max),
    centsBetween,
    chanceInBasisPoints: (basisPoints: number): boolean => {
      if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
        throw new DrawError(`${basisPoints} is not a basis-point probability in 0..10000`);
      }
      return intBetween(0, 9_999) < basisPoints;
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new DrawError('cannot pick from an empty list');
      const chosen = items[intBetween(0, items.length - 1)];
      // `noUncheckedIndexedAccess` is on and the guard above already makes this
      // unreachable. It is here so the narrowing is a check rather than a `!`.
      if (chosen === undefined) throw new DrawError('pick landed outside the list');
      return chosen;
    },
    sumOfDraws: (count: number, lowInclusive: number, highInclusive: number): number => {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new DrawError(`sumOfDraws needs at least one draw, got ${count}`);
      }
      let total = 0;
      for (let i = 0; i < count; i += 1) total += intBetween(lowInclusive, highInclusive);
      return total;
    },
  });
}

/**
 * The one place a draw key is spelled.
 *
 * `|` is the separator and no component may contain it, which is checked rather
 * than trusted: two different tuples that flatten to one key are two draws that
 * silently correlate, and that is exactly the failure the keying exists to
 * prevent.
 */
export function drawKey(...parts: readonly string[]): string {
  for (const part of parts) {
    if (part.includes('|')) {
      throw new DrawError(`draw key component ${JSON.stringify(part)} contains the separator`);
    }
  }
  return parts.join('|');
}
