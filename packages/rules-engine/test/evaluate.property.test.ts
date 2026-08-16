import fc from 'fast-check';
import { expect, test } from 'vitest';

import { evaluate } from '../src/index.js';
import type {
  AccountId,
  Cents,
  DayMark,
  EngineInput,
  PlanVersionId,
  TradingDay,
} from '../src/index.js';

// CI-02's second half, the `property` project. fast-check is named by the
// constitution and adopted unchanged (STRATEGY section 2).
//
// THE TWO PROPERTIES HERE ARE PERMANENT, which is why they are the ones the
// scaffold ships. Neither describes a rule, so neither has to be rewritten when
// M01 arrives; both describe the engine's contract, so both would catch the
// first impurity that reaches it. The `PT-nn` suites over the actual rules are
// M01's, per STRATEGY section 3.1.

// `Cents` is `bigint` since the fold landed (M01 section 2.1, INV-02), so the
// arbitrary draws an integer and widens it rather than branding it. The bounds
// are unchanged: they are a plausible money range, not a type constraint.
const cents = (): fc.Arbitrary<Cents> =>
  fc.integer({ min: -100_000_000, max: 100_000_000 }).map((n) => BigInt(n));

const dayMark = (): fc.Arbitrary<DayMark> =>
  fc.record({
    // `noInvalidDate` is not the default: fast-check generates the Invalid Date
    // as an edge case, and `toISOString()` throws on it. That is a correct
    // arbitrary and an incorrect mapper, and the shrink pointed straight at it.
    tradingDay: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10) as TradingDay),
    openingBalanceCents: cents(),
    closingBalanceCents: cents(),
    highBalanceCents: cents(),
    lowBalanceCents: cents(),
    realizedPnlCents: cents(),
    fillCount: fc.nat({ max: 5_000 }),
    tradedDay: fc.boolean(),
  });

const engineInput = (): fc.Arbitrary<EngineInput> =>
  fc.record({
    planConfigVersion: fc.record({ planVersionId: fc.uuid().map((u) => u as PlanVersionId) }),
    accountState: fc.record({
      accountId: fc.uuid().map((u) => u as AccountId),
      planVersionId: fc.uuid().map((u) => u as PlanVersionId),
      sizeCents: cents(),
    }),
    dayMarks: fc.array(dayMark(), { maxLength: 40 }),
  });

// The property the replay self-audit rests on. If it ever fails, something in
// the engine is reading state the caller did not hand it, and the audit's
// byte-identical reproduction claim is no longer true.
test('evaluation is deterministic: the same input twice gives the same result', () => {
  fc.assert(
    fc.property(engineInput(), (input) => {
      expect(evaluate(input)).toStrictEqual(evaluate(input));
    }),
  );
});

// A pure function does not edit its arguments. This one catches the convenient
// in-place mutation of `accountState` long before a caller discovers it by
// having its own copy changed underneath it.
//
// The snapshot is a JSON string rather than `structuredClone`, because this
// package compiles with `types: []` and no DOM lib: neither `structuredClone`
// nor any other ambient global exists here, which is the same boundary that
// makes an I/O call a compile error.
//
// THE REPLACER IS FM-12 ARRIVING ON A TEST INSTEAD OF ON A PAYLOAD. `Cents`
// became `bigint` when the fold landed (M01 section 2.1, INV-02), and
// `JSON.stringify` throws on a `bigint` rather than losing it, which is the
// safe direction and is exactly why the ban exists: "a serialization test
// asserting `bigint` round-trips as a STRING, never as a JSON number". So money
// is rendered as a base-10 string with an `n`, which is Appendix B.2's canonical
// serialization rule one file early, and the snapshot stays lossless.
const snapshot = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? `${v.toString()}n` : v));

test('evaluation does not mutate its input', () => {
  fc.assert(
    fc.property(engineInput(), (input) => {
      const before = snapshot(input);
      evaluate(input);
      expect(snapshot(input)).toBe(before);
    }),
  );
});
