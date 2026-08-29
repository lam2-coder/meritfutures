// =============================================================================
// packages/rules-engine/test/gates-codec.test.ts
// =============================================================================
// `ADR-206`'s ruling, EXECUTED. `src/gates-codec.ts` transcribes an encoding a
// primary source already fixed, so what this file asserts is not that the
// transcription is reasonable but that it is FAITHFUL, and it takes its subject
// from the engine rather than from a literal wherever it can.
//
// THE ASSERTION IS A ROUND TRIP AND NOT AN ENCODE. `usePayoutBackend` READS
// this column: `PayoutSubject.state` is a `RuleState`, whose `engineGates` is an
// `EngineGateResults` whose cents are `bigint`. An encoder watched alone would
// be green on a bag no decoder can rebuild, which is exactly the failure
// `ADR-206` section 5 measured, so every case below that matters goes out
// through `JSON.stringify` and back through `JSON.parse` before it is compared.
// That is the leg where a JSON number loses a cent and an object copy does not.
//
// THE FOUR SEEDS IN SECTION 3 ARE NOT ARBITRARY MUTATIONS. Three of them are
// the three ways `projectGates` -- the WIRE shape, the nearest thing in this
// tree to this codec -- differs from the store, which is what makes them worth
// applying: each one is a defect a session that reused the wire shape would
// have shipped into `state_hash` column 19. `ADR-206` section 7 fired the same
// three against a live row and this file fires them against the codec.
// =============================================================================

import { describe, expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.ts';
import { EngineGatesCodecError, decodeEngineGates, encodeEngineGates } from '../src/gates-codec.ts';
import type { StoredEngineGates } from '../src/gates-codec.ts';
import { ENGINE_GATE_LEAVES } from '../src/hash.ts';
import type { EngineGateResults } from '../src/types.ts';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.ts';

// -----------------------------------------------------------------------------
// The subject: gates the ENGINE produced, never a bag this file typed out
// -----------------------------------------------------------------------------
// `apps/worker/test/rule-state-writer.test.ts` states the reason for its own
// row and it holds here: "a hand-built row would let a field drift out of the
// fold and into this file, and the writer would then be asserted against a
// shape nothing produces". The one literal bag in this file is `ADR-206`
// section 6's specimen, and it is a literal ON PURPOSE, because its whole job
// is to be the ADR's bytes rather than this tree's.

function foldedGates(): EngineGateResults {
  const output = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K),
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 20_000n,
    }),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  return output.state.engineGates;
}

/**
 * What Postgres gives a reader back: text in, parsed value out.
 *
 * THE JSON LEG IS THE POINT. An object copy would carry the `bigint` this codec
 * is here to keep out of the column, so a round trip that skipped it would be
 * green on the one encoding `ADR-206` section 5 measured failing.
 */
function throughJson(value: StoredEngineGates): StoredEngineGates {
  return JSON.parse(JSON.stringify(value)) as StoredEngineGates;
}

/** A stored bag as this file mutates it: the seeds put shapes in it the type forbids. */
function asBag(value: StoredEngineGates): Record<string, Record<string, unknown>> {
  return value as unknown as Record<string, Record<string, unknown>>;
}

/** The dotted paths a stored bag actually carries, which is `ADR-206` section 7's query. */
function storedPaths(bag: StoredEngineGates): string[] {
  const out: string[] = [];
  for (const [groupKey, group] of Object.entries(asBag(bag)))
    for (const leafKey of Object.keys(group)) out.push(`${groupKey}.${leafKey}`);
  return out.sort();
}

// =============================================================================
// 1. The round trip
// =============================================================================

describe('the round trip, which is what the read port needs and an encoder alone does not prove', () => {
  test('an engine-produced value survives encode, JSON and decode unchanged', () => {
    const gates = foldedGates();

    expect(decodeEngineGates(throughJson(encodeEngineGates(gates)))).toStrictEqual(gates);
  });

  test('the cents leaves come back as the SAME base-10 strings and as `bigint`', () => {
    const gates = foldedGates();
    const stored = throughJson(encodeEngineGates(gates));

    // The seven `Cents` leaves ADR-206 ruling 3 names, and no eighth. Asserted
    // AFTER the JSON leg, where the type has stopped being evidence.
    expect(typeof stored.winDays.floorCents).toBe('string');
    expect(typeof stored.buffer.haveCents).toBe('string');
    expect(typeof stored.buffer.needCents).toBe('string');
    expect(typeof stored.consistency.profitNeededToDiluteCents).toBe('string');
    expect(typeof stored.minimumAmount.withdrawableCents).toBe('string');
    expect(typeof stored.minimumAmount.capCents).toBe('string');
    expect(typeof stored.minimumAmount.minPayoutCents).toBe('string');

    const back = decodeEngineGates(stored);
    expect(typeof back.minimumAmount.capCents).toBe('bigint');
    expect(back.minimumAmount.capCents).toBe(gates.minimumAmount.capCents);
  });

  test('a cent no JSON number can hold survives, which is the whole reason for the string', () => {
    // ADR-206 section 5's measured value: stored as a JSON NUMBER this comes
    // back 9007199254740992 and the read port rebuilds the wrong `bigint`.
    const beyond = 9_007_199_254_740_993n;
    const gates: EngineGateResults = {
      ...foldedGates(),
      minimumAmount: {
        ...foldedGates().minimumAmount,
        capCents: beyond,
      },
    };

    const stored = throughJson(encodeEngineGates(gates));
    expect(stored.minimumAmount.capCents).toBe('9007199254740993');
    expect(decodeEngineGates(stored).minimumAmount.capCents).toBe(beyond);

    // And the same figure as a JSON number is REFUSED rather than silently
    // rounded, because rounding here is a wrong cap on a money door.
    expect(() =>
      decodeEngineGates({
        ...stored,
        minimumAmount: { ...stored.minimumAmount, capCents: Number(beyond) },
      }),
    ).toThrow(EngineGatesCodecError);
  });

  test('a negative cent round-trips, because `money()` renders a sign and nothing bans one', () => {
    const base = foldedGates();
    const gates: EngineGateResults = {
      ...base,
      buffer: { ...base.buffer, haveCents: -1n },
    };
    const stored = throughJson(encodeEngineGates(gates));

    expect(stored.buffer.haveCents).toBe('-1');
    expect(decodeEngineGates(stored).buffer.haveCents).toBe(-1n);
  });

  test('the nullable leaves round-trip as JSON `null` and never as the hash sentinel', () => {
    const base = foldedGates();
    const gates: EngineGateResults = {
      ...base,
      consistency: { ...base.consistency, bestDayShareBp: null, maxDayShareBp: null },
      cadenceGap: {
        ...base.cadenceGap,
        skipped: true,
        tradingDaysSinceLastPayout: null,
        nextEligibleTradingDay: null,
      },
    };

    const stored = throughJson(encodeEngineGates(gates));
    expect(stored.consistency.bestDayShareBp).toBeNull();
    expect(stored.cadenceGap.nextEligibleTradingDay).toBeNull();
    expect(decodeEngineGates(stored)).toStrictEqual(gates);
  });

  test('a resolved `nextEligibleTradingDay` round-trips as YYYY-MM-DD', () => {
    const base = foldedGates();
    const gates: EngineGateResults = {
      ...base,
      cadenceGap: { ...base.cadenceGap, nextEligibleTradingDay: day('2026-11-17') },
    };

    const stored = throughJson(encodeEngineGates(gates));
    expect(stored.cadenceGap.nextEligibleTradingDay).toBe('2026-11-17');
    expect(decodeEngineGates(stored)).toStrictEqual(gates);
  });
});

// =============================================================================
// 2. The leaf set, against the executable list rather than against this file
// =============================================================================

describe('the twenty-five leaves, pinned to `ENGINE_GATE_LEAVES`', () => {
  test('a stored bag carries exactly the dotted paths the hash reads', () => {
    // ADR-206 section 7 ran this as SQL over a live row; section 8 recommends
    // "the suite-side check over the executable list" and this is it. The two
    // copies of the leaf set are COMPARED here rather than merged, which is why
    // `gates-codec.ts` does not import the array.
    const declared = ENGINE_GATE_LEAVES.map((leaf) => leaf.path).sort();

    expect(declared).toHaveLength(25);
    expect(storedPaths(throughJson(encodeEngineGates(foldedGates())))).toStrictEqual(declared);
  });

  test('the six groups are the interface`s six, and there is no seventh', () => {
    expect(Object.keys(encodeEngineGates(foldedGates())).sort()).toStrictEqual(
      ['buffer', 'cadenceGap', 'consistency', 'minimumAmount', 'tradedDays', 'winDays'].sort(),
    );
  });

  test('every cents leaf renders the string `hash.ts` puts in the hash, character for character', () => {
    // The codec restates `money()` rather than importing it, so the two are
    // bound HERE. If either rendering ever moves, this case is what fires.
    const gates = foldedGates();
    const stored = encodeEngineGates(gates);

    // THE READERS ARE FUNCTIONS AND NOT DOTTED PATHS SPLIT AT RUNTIME, which is
    // the same reason `gates-codec.ts` does not build the bag from the array:
    // a split path indexes back into the value and no type checker sees through
    // it, so a leaf renamed in the interface would fail HERE at runtime instead
    // of failing in `tsc` at the site that renamed it.
    const centsLeaves: readonly (readonly [string, (b: typeof stored) => string])[] = [
      ['winDays.floorCents', (b) => b.winDays.floorCents],
      ['buffer.haveCents', (b) => b.buffer.haveCents],
      ['buffer.needCents', (b) => b.buffer.needCents],
      ['consistency.profitNeededToDiluteCents', (b) => b.consistency.profitNeededToDiluteCents],
      ['minimumAmount.withdrawableCents', (b) => b.minimumAmount.withdrawableCents],
      ['minimumAmount.capCents', (b) => b.minimumAmount.capCents],
      ['minimumAmount.minPayoutCents', (b) => b.minimumAmount.minPayoutCents],
    ];
    expect(centsLeaves).toHaveLength(7);

    for (const [path, read] of centsLeaves) {
      const leaf = ENGINE_GATE_LEAVES.find((candidate) => candidate.path === path);
      if (leaf === undefined) throw new Error(`ENGINE_GATE_LEAVES has no leaf at ${path}`);
      expect(read(stored)).toBe(leaf.render(gates));
    }
  });
});

// =============================================================================
// 3. The seeds: the three ways the WIRE shape differs from the store
// =============================================================================

describe('the shapes a reused `projectGates` would have stored, each refused by path', () => {
  function stored(): StoredEngineGates {
    return throughJson(encodeEngineGates(foldedGates()));
  }

  test('a DROPPED leaf is refused and named: the wire shape omits `minimumAmount.capCents`', () => {
    const bag = stored();
    const { capCents: _dropped, ...withoutCap } = bag.minimumAmount;

    expect(() => decodeEngineGates({ ...bag, minimumAmount: withoutCap })).toThrow(
      /\$\.minimumAmount.*capCents/s,
    );
  });

  test('a RENAMED leaf is refused twice over: `maxDayShareBp` is `max_bp` on the wire', () => {
    const bag = stored();
    const { maxDayShareBp, ...rest } = bag.consistency;
    const renamed = { ...rest, max_bp: maxDayShareBp };

    let raised: unknown;
    try {
      decodeEngineGates({ ...bag, consistency: renamed });
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeInstanceOf(EngineGatesCodecError);
    // The MISSING name is what the message must carry: a reader holding the row
    // can see `max_bp` in it and cannot see what is absent.
    expect((raised as EngineGatesCodecError).message).toContain('maxDayShareBp');
    expect((raised as EngineGatesCodecError).path).toBe('$.consistency');
  });

  test('an ADDED context gate is refused, which is `INV-23` executed', () => {
    // `accountActive` is one of R-40's four, and `SD-06` split the column in two
    // precisely so that none of them reaches the replayed state or its hash.
    expect(() => decodeEngineGates({ ...stored(), accountActive: { pass: true } })).toThrow(
      /accountActive/,
    );
  });

  test('a FOURTH `skipped` is refused, because the engine never produced one', () => {
    // `CV-19` puts `skipped` on the three gates that can go unevaluated.
    // `winDays` is always evaluated, so a bag carrying it there is carrying a
    // fact with no producer.
    const bag = stored();

    expect(() =>
      decodeEngineGates({ ...bag, winDays: { ...bag.winDays, skipped: false } }),
    ).toThrow(/\$\.winDays.*skipped/s);
  });
});

// =============================================================================
// 4. The decoder refuses what a `jsonb` column can actually hand it
// =============================================================================

describe('what the decoder refuses, because the column is `jsonb` and not this codec`s output', () => {
  function bagWithCap(capCents: unknown): unknown {
    const bag = throughJson(encodeEngineGates(foldedGates()));
    return { ...bag, minimumAmount: { ...bag.minimumAmount, capCents } };
  }

  test.each([
    ['a JSON number', 1000],
    ['an empty string, which `BigInt` reads as zero', ''],
    ['a padded string, whose whitespace `BigInt` discards', ' 1000'],
    ['a leading zero, which is not `money()`s rendering', '0100'],
    ['an explicit plus sign', '+1000'],
    ['negative zero, which `toString(10)` never emits', '-0'],
    ['hexadecimal, which `BigInt` accepts and `money()` never writes', '0x10'],
    ['exponential notation', '1e3'],
    ['null on a leaf that is not nullable', null],
  ])('a cents leaf refuses %s', (_label, value) => {
    expect(() => decodeEngineGates(bagWithCap(value))).toThrow(EngineGatesCodecError);
  });

  test('a count leaf refuses a non-integer and a value past the safe range', () => {
    const bag = throughJson(encodeEngineGates(foldedGates()));

    for (const bad of [1.5, Number.MAX_SAFE_INTEGER + 2])
      expect(() =>
        decodeEngineGates({ ...bag, tradedDays: { ...bag.tradedDays, have: bad } }),
      ).toThrow(/\$\.tradedDays\.have/);
  });

  test('a malformed trading day is refused rather than branded', () => {
    const bag = throughJson(encodeEngineGates(foldedGates()));

    expect(() =>
      decodeEngineGates({
        ...bag,
        cadenceGap: { ...bag.cadenceGap, nextEligibleTradingDay: '2026-11-17T00:00:00Z' },
      }),
    ).toThrow(/nextEligibleTradingDay/);
  });

  test('a bag that is not an object at all is refused at `$`', () => {
    for (const bad of [null, 42, 'gates', []])
      expect(() => decodeEngineGates(bad)).toThrow(EngineGatesCodecError);
  });

  test('key order is not part of the encoding, which is how `jsonb` returns a row', () => {
    // ADR-206 ruling 6, and section 6 observed Postgres returning the groups
    // sorted by length and then bytewise rather than as written.
    const gates = foldedGates();
    const written = throughJson(encodeEngineGates(gates));
    const entries = Object.entries(asBag(written));
    const resorted = Object.fromEntries(
      entries.sort(([a], [b]) => (a.length === b.length ? (a < b ? -1 : 1) : a.length - b.length)),
    );

    expect(Object.keys(resorted)).not.toStrictEqual(Object.keys(written));
    expect(decodeEngineGates(resorted)).toStrictEqual(gates);
  });
});

// =============================================================================
// 5. `ADR-206` section 6's specimen, which was written into a real row
// =============================================================================

test('the ADR`s own specimen decodes and re-encodes to itself', () => {
  // Transcribed from `docs/decisions/ADR-206.md` section 6, which states it was
  // inserted into `rule_states` through the whole foreign-key chain against
  // every migration in the tree and read back. It is the one literal bag in
  // this file and its job is to be the ADR's bytes rather than this tree's.
  const specimen = {
    tradedDays: { pass: true, skipped: false, have: 12, need: 5 },
    winDays: { pass: false, have: 3, need: 5, floorCents: '5000' },
    buffer: { pass: true, haveCents: '150000', needCents: '100000' },
    consistency: {
      pass: true,
      skipped: false,
      bestDayShareBp: 2200,
      maxDayShareBp: 4000,
      profitNeededToDiluteCents: '0',
    },
    cadenceGap: {
      pass: true,
      skipped: true,
      tradingDaysSinceLastPayout: null,
      need: 14,
      nextEligibleTradingDay: null,
    },
    minimumAmount: {
      pass: true,
      withdrawableCents: '100000',
      capCents: '250000',
      minPayoutCents: '10000',
    },
  };

  expect(encodeEngineGates(decodeEngineGates(specimen))).toStrictEqual(specimen);
});
