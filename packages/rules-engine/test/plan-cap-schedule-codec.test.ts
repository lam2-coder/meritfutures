// =============================================================================
// packages/rules-engine/test/plan-cap-schedule-codec.test.ts
// =============================================================================
// `ADR-302`. THE SUITE FOR `plan/cap-schedule-codec.ts`.
//
// **ITS SPINE IS THE ROUND TRIP, on `plan-rules-codec.test.ts`'s idiom and for
// its reason.** `published-plans-in-code.ts` holds Appendix A's three sizes as
// `PlanVersionSizeRow` values, transcribed from the appendix by a session that
// had not written this decoder, so a case that renders one of those schedules
// into JSON and reads it back is comparing TWO independent transcriptions of one
// document rather than a function against its own output.
//
// **THE JSON LEG IS NEVER SKIPPED AND `ADR-250` SECTION 3 IS WHY.** An object
// copy would carry the `bigint` that no `jsonb` column can hold, and a suite that
// skipped `JSON.parse` would be green on a rendering the store cannot produce.
//
// **AND THE DIVERGENCE THIS CODEC EXISTS TO END IS EXECUTED HERE RATHER THAN
// DESCRIBED.** Section 4 below runs the exact stored bytes that
// `apps/api/src/routes/catalog.ts`'s retired `readCapSchedule` admitted and
// rounded, and the exact string it refused, so this file states the repair as
// two behaviours rather than as a claim about a double.
// =============================================================================

import { describe, expect, test } from 'vitest';

import { CapScheduleCodecError, decodeCapScheduleCents } from '../src/plan/cap-schedule-codec.ts';
import type { Cents, SizeCapScheduleStep } from '../src/types.ts';
import { CORE_50K_SIZE, DIRECT_50K_SIZE, RAPID_50K_SIZE } from './published-plans-in-code.ts';

/**
 * One schedule, rendered the way `jsonb` holds it and read back.
 *
 * `JSON.stringify` THROWS ON A `bigint`, which is the whole reason this helper
 * exists: the cents leaf is rendered as the JSON number DATA_MODEL section 11
 * writes, and the round trip is therefore through a value the store can hold.
 */
function roundTrip(schedule: readonly SizeCapScheduleStep[]): readonly SizeCapScheduleStep[] {
  const rendered = JSON.stringify(
    schedule.map((step) => ({
      from_ordinal: step.from_ordinal,
      cap_cents: Number(step.cap_cents),
    })),
  );
  return decodeCapScheduleCents(JSON.parse(rendered));
}

// -----------------------------------------------------------------------------
// 1. The three published schedules, round-tripped
// -----------------------------------------------------------------------------

describe('1. Appendix A`s own schedules survive the store', () => {
  test.each([
    ['Core EOD 50K', CORE_50K_SIZE],
    ['Merit Rapid 50K', RAPID_50K_SIZE],
    ['Direct 50K', DIRECT_50K_SIZE],
  ])('1.1 %s round-trips to the transcription this suite did not write', (_name, size) => {
    expect(roundTrip(size.payout_cap_schedule_cents)).toEqual(size.payout_cap_schedule_cents);
  });

  test('1.2 the cents leaf comes back a `bigint` and never a number', () => {
    const [step] = roundTrip(CORE_50K_SIZE.payout_cap_schedule_cents);
    expect(typeof step?.cap_cents).toBe('bigint');
    expect(typeof step?.from_ordinal).toBe('number');
  });

  test('1.3 a MULTI-RUNG schedule keeps its order and is NOT sorted here', () => {
    // `resolvePlan` sorts, and `apps/api`'s `capAtFirstOrdinal` SELECTS by
    // ordinal rather than taking a position, both because `jsonb` order survives
    // a round trip only as well as whoever wrote it. A decoder that sorted would
    // hide that from both of them.
    expect(
      decodeCapScheduleCents([
        { from_ordinal: 3, cap_cents: 300 },
        { from_ordinal: 1, cap_cents: 100 },
      ]),
    ).toEqual([
      { from_ordinal: 3, cap_cents: 300n },
      { from_ordinal: 1, cap_cents: 100n },
    ]);
  });

  test('1.4 an EMPTY array is a value and not a refusal', () => {
    // `CV-09` requires a first rung at ordinal 1 and `validatePlan` owns it at
    // publish; `capAtFirstOrdinal` refuses an empty schedule at render with its
    // own message. A decoder that refused here would take a `CV-nn`'s job on a
    // read that cannot see the plan.
    expect(decodeCapScheduleCents([])).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 2. The shape is refused rather than coerced
// -----------------------------------------------------------------------------

describe('2. what is not the shape `0004` stores', () => {
  test.each([
    ['null', null],
    ['an object', { from_ordinal: 1, cap_cents: 1 }],
    ['a number', 1],
    ['a string', '[]'],
  ])('2.1 %s is not the array `0004` declares from day one', (_name, value) => {
    expect(() => decodeCapScheduleCents(value)).toThrow(CapScheduleCodecError);
  });

  test.each([
    ['null', null],
    ['an array', []],
    ['a number', 1],
  ])('2.2 a step that is %s is refused with its index', (_name, value) => {
    expect(() => decodeCapScheduleCents([value])).toThrow(/\$\[0\]/);
  });

  test('2.3 an ABSENT key is refused and never defaulted', () => {
    // `ADR-258` section 6: a default is a plan parameter written into
    // application code, and it is invisible.
    expect(() => decodeCapScheduleCents([{ cap_cents: 1 }])).toThrow(
      /\$\[0\]\.from_ordinal.*is absent/,
    );
    expect(() => decodeCapScheduleCents([{ from_ordinal: 1 }])).toThrow(
      /\$\[0\]\.cap_cents.*is absent/,
    );
  });

  test('2.4 a null is a VALUE and is refused as one rather than read as absent', () => {
    expect(() => decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: null }])).toThrow(
      /found null/,
    );
  });

  test('2.5 `at` locates the row for whoever is holding one', () => {
    expect(() => decodeCapScheduleCents([{ from_ordinal: 1.5, cap_cents: 1 }], 'size[7]')).toThrow(
      /size\[7\]\[0\]\.from_ordinal/,
    );
  });

  test('2.6 an UNDECLARED key is ignored rather than refused', () => {
    // `rules-codec.ts` section 2's ruling on the same question: this array is
    // `0004`'s, and a decoder that refused a stray key would be this module
    // claiming a column it does not own.
    expect(decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: 1, note: 'x' }])).toEqual([
      { from_ordinal: 1, cap_cents: 1n },
    ]);
  });
});

// -----------------------------------------------------------------------------
// 3. `from_ordinal` selects a rung, so it is held to the safe-integer test
// -----------------------------------------------------------------------------

describe('3. the rung selector', () => {
  test.each([
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['past 2^53', 2 ** 53],
    ['a string', '1'],
    ['a boolean', true],
  ])('3.1 %s is not a `from_ordinal`', (_name, value) => {
    expect(() => decodeCapScheduleCents([{ from_ordinal: value, cap_cents: 1 }])).toThrow(
      CapScheduleCodecError,
    );
  });

  test('3.2 zero and a negative ordinal are ADMITTED here, because `CV-09` owns them', () => {
    // The decoder is strictly prior to validation and a read holds one size, so
    // it could not construct `CV-09`'s question. `validatePlan` refuses a
    // schedule that does not start at 1 and `capAtFirstOrdinal` refuses one at
    // render; a decoder that narrowed here would make both refusals unreachable
    // and their tests vacuous.
    expect(decodeCapScheduleCents([{ from_ordinal: 0, cap_cents: 1 }])).toEqual([
      { from_ordinal: 0, cap_cents: 1n },
    ]);
  });
});

// -----------------------------------------------------------------------------
// 4. THE MONEY, WHICH IS THE DIVERGENCE THIS FILE EXISTS TO END
// -----------------------------------------------------------------------------

describe('4. `cap_cents` on `INV-02`s terms, in both directions', () => {
  test('4.1 a cents value past `Number.MAX_SAFE_INTEGER` is REFUSED rather than rounded', () => {
    // **THIS IS THE EXACT VALUE `apps/api/src/routes/catalog.ts` USED TO ADMIT.**
    // Its retired `readCapSchedule` tested `Number.isInteger`, which is TRUE
    // here, and then converted with `BigInt`, which takes the rounded double. The
    // rounding is executed first so this case asserts a repair rather than a
    // claim about a double.
    const stored = JSON.parse('{"cap_cents":9007199254740993}') as { cap_cents: number };
    expect(Number.isInteger(stored.cap_cents)).toBe(true);
    expect(BigInt(stored.cap_cents)).toBe(9_007_199_254_740_992n);

    expect(() =>
      decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: stored.cap_cents }]),
    ).toThrow(/integer cents were required/);
  });

  test('4.2 a base-10 STRING is ADMITTED, exactly, above that ceiling', () => {
    // `ADR-283` ruling 5: the string is the only rendering that survives above
    // `Number.MAX_SAFE_INTEGER`, because `jsonb` has one number type and
    // `JSON.parse` has already rounded by the time any reader runs. The retired
    // `apps/api` reader refused it outright.
    expect(decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: '9007199254740993' }])).toEqual([
      { from_ordinal: 1, cap_cents: 9_007_199_254_740_993n },
    ]);
  });

  test.each([
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an object', {}],
    ['an array', []],
  ])('4.3 %s is refused where integer cents were required', (_name, value) => {
    expect(() => decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: value }])).toThrow(
      CapScheduleCodecError,
    );
  });

  test.each([
    ['a decimal point', '100.0'],
    ['a hex literal', '0x64'],
    ['leading zeroes', '0100'],
    ['whitespace', ' 100 '],
    ['empty', ''],
    ['not a number', 'lots'],
  ])('4.4 %s is not the base-10 rendering of an integer', (_name, value) => {
    expect(() => decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: value }])).toThrow(
      CapScheduleCodecError,
    );
  });

  test('4.5 zero and a negative cap DECODE, because no `CV-nn` runs here', () => {
    // `CV-09`'s "every `cap_cents > 0`" is `validatePlan`'s and it needs the
    // whole plan. A decoder that ran half of it would return an `ok` about a
    // different question from the one the publish gate answered.
    expect(decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: 0 }])).toEqual([
      { from_ordinal: 1, cap_cents: 0n },
    ]);
    expect(decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: '-100' }])).toEqual([
      { from_ordinal: 1, cap_cents: -100n },
    ]);
  });

  test('4.6 the error carries the dotted path as a field and not only in the message', () => {
    // `PlanRulesCodecError`'s and `EngineGatesCodecError`'s reason unchanged: the
    // value that came back wrong is read by somebody holding a row.
    try {
      decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: 2 ** 53 }], 'size[3]');
      expect.unreachable('an unsafe cap decoded');
    } catch (error) {
      expect(error).toBeInstanceOf(CapScheduleCodecError);
      expect((error as CapScheduleCodecError).path).toBe('size[3][0].cap_cents');
    }
  });

  test('4.7 the boundary itself is ADMITTED on both signs', () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER) as Cents;
    expect(
      decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: Number.MAX_SAFE_INTEGER }]),
    ).toEqual([{ from_ordinal: 1, cap_cents: max }]);
    expect(
      decodeCapScheduleCents([{ from_ordinal: 1, cap_cents: -Number.MAX_SAFE_INTEGER }]),
    ).toEqual([{ from_ordinal: 1, cap_cents: -max }]);
  });
});
