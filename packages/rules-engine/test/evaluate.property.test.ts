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

const cents = (): fc.Arbitrary<Cents> =>
  fc.integer({ min: -100_000_000, max: 100_000_000 }).map((n) => n as Cents);

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
// makes an I/O call a compile error. Every field of `EngineInput` is a number,
// string or boolean, so the round trip is lossless.
test('evaluation does not mutate its input', () => {
  fc.assert(
    fc.property(engineInput(), (input) => {
      const before = JSON.stringify(input);
      evaluate(input);
      expect(JSON.stringify(input)).toBe(before);
    }),
  );
});
