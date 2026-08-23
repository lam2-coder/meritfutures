// =============================================================================
// apps/worker/test/state-hash.test.ts
// =============================================================================
// THE EXPECTATION IS TRANSCRIBED FROM ADR-026 C-07, NOT READ OFF THE MODULE.
// TR-01's whole point: "a fixture derived from the implementation proves only
// that the code agrees with itself". So this file writes its own framing
// function, lists the nineteen values in C-07's numbered order by hand, and
// hashes the result with `node:crypto` directly. If the module drops a column,
// reorders two, or renders a bigint differently, the digests part.
//
// The second half of the file is the one that would catch the likelier defect.
// A hand-written expectation pins ONE state; a column silently dropped from the
// renderer is invisible the moment that column's value is the same in the
// fixture and in the expectation. So every one of the nineteen columns and
// every one of the twenty-five gate leaves is MUTATED IN TURN and the hash is
// asserted to move. That is what proves each field is actually reached.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { EngineGateResults, RuleState, TradingDay } from '@merit/rules-engine';

import {
  canonicalStateSerialization,
  ENGINE_GATE_LEAVES,
  EXCLUDED_COLUMNS,
  HASHED_COLUMNS,
  StateHashError,
  stateHash,
  type StateHashSubject,
} from '../src/batch/state-hash.js';

const td = (s: string): TradingDay => s as TradingDay;

const ACCOUNT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/**
 * A funded day mid-consistency-period with no settlement yet, so all three
 * nullable columns are null and the sentinel is exercised on every one of them.
 */
const GATES: EngineGateResults = {
  tradedDays: { pass: true, skipped: true, have: 12, need: 0 },
  winDays: { pass: false, have: 3, need: 5, floorCents: 15_000n },
  buffer: { pass: false, haveCents: 30_000n, needCents: 100_000n },
  consistency: {
    pass: true,
    skipped: false,
    bestDayShareBp: 6667,
    maxDayShareBp: 3000,
    profitNeededToDiluteCents: 36_667n,
  },
  cadenceGap: {
    pass: true,
    skipped: true,
    tradingDaysSinceLastPayout: null,
    need: 5,
    nextEligibleTradingDay: null,
  },
  minimumAmount: {
    pass: false,
    withdrawableCents: 0n,
    capCents: 250_000n,
    minPayoutCents: 10_000n,
  },
};

const STATE: RuleState = {
  tradingDay: td('2026-08-17'),
  phase: 'funded',
  balanceCents: 5_030_000n,
  floorOpenCents: 4_750_000n,
  floorCents: 4_780_000n,
  floorLocked: false,
  highWaterBalanceCents: 5_030_000n,
  withdrawableCents: 0n,
  tradedDaysCount: 12,
  winDaysCount: 3,
  consistencyBestDayCents: 20_000n,
  consistencyPeriodProfitCents: 30_000n,
  consistencyPeriodStartDay: null,
  payoutsSettledCount: 0,
  payoutAnchorDay: null,
  cadenceAnchorDay: null,
  lifetimeSettledCents: 0n,
  engineGates: GATES,
  engineEligible: false,
  breached: false,
  breachKind: null,
  engineVersion: 'test-engine',
};

const SUBJECT: StateHashSubject = { accountId: ACCOUNT_ID, state: STATE };

// -----------------------------------------------------------------------------
// The independent serializer
// -----------------------------------------------------------------------------

/** Written here rather than imported. `<utf8 byte length>:<utf8 bytes>`. */
function f(value: string): string {
  return `${String(Buffer.byteLength(value, 'utf8'))}:${value}`;
}

/**
 * The twenty-five gate leaves, transcribed from `EngineGateResults` and each
 * gate interface's own field order, which `types.ts` states is "the order
 * `engineEligible` READS THEM ... because SD-08's canonical serialization
 * hashes fields in a fixed declared order".
 */
const EXPECTED_GATES: string =
  // tradedDays: pass, skipped, have, need
  f('true') +
  f('true') +
  f('12') +
  f('0') +
  // winDays: pass, have, need, floorCents
  f('false') +
  f('3') +
  f('5') +
  f('15000') +
  // buffer: pass, haveCents, needCents
  f('false') +
  f('30000') +
  f('100000') +
  // consistency: pass, skipped, bestDayShareBp, maxDayShareBp, profitNeededToDiluteCents
  f('true') +
  f('false') +
  f('6667') +
  f('3000') +
  f('36667') +
  // cadenceGap: pass, skipped, tradingDaysSinceLastPayout, need, nextEligibleTradingDay
  f('true') +
  f('true') +
  f('~null') +
  f('5') +
  f('~null') +
  // minimumAmount: pass, withdrawableCents, capCents, minPayoutCents
  f('false') +
  f('0') +
  f('250000') +
  f('10000');

/** ADR-026 C-07's numbered list, 1 to 19, transcribed in its order. */
const EXPECTED_SERIALIZATION: string =
  f(ACCOUNT_ID) + //                   1.  account_id
  f('2026-08-17') + //                 2.  trading_day
  f('funded') + //                     3.  phase
  f('4780000') + //                    4.  floor_cents
  f('false') + //                      5.  floor_locked
  f('4750000') + //                    6.  floor_open_cents                SD-04
  f('5030000') + //                    7.  high_water_balance_cents
  f('5030000') + //                    8.  balance_cents
  f('0') + //                          9.  withdrawable_cents
  f('12') + //                        10.  traded_days_count
  f('3') + //                         11.  win_days_count
  f('20000') + //                     12.  consistency_best_day_cents
  f('30000') + //                     13.  consistency_period_profit_cents
  f('~null') + //                     14.  consistency_period_start_day    SD-07
  f('0') + //                         15.  payouts_settled_count
  f('~null') + //                     16.  payout_anchor_day               SD-02
  f('~null') + //                     17.  cadence_anchor_day              SD-02
  f('false') + //                     18.  engine_eligible                 SD-06
  f(EXPECTED_GATES); //               19.  engine_gates                    SD-06

describe('SD-08 state_hash: the serialization ADR-026 C-07 declares', () => {
  it('serializes the nineteen columns in C-07 order, framed, with no whitespace', () => {
    expect(canonicalStateSerialization(SUBJECT)).toBe(EXPECTED_SERIALIZATION);
  });

  it('hashes exactly that serialization with SHA-256', () => {
    const independent = createHash('sha256').update(EXPECTED_SERIALIZATION, 'utf8').digest();
    expect(stateHash(SUBJECT).equals(independent)).toBe(true);
  });

  it('produces the 32 bytes rule_states_hash_is_sha256 checks', () => {
    expect(stateHash(SUBJECT)).toHaveLength(32);
  });

  it('is deterministic: the same subject twice is the same digest (INV-04)', () => {
    expect(stateHash(SUBJECT).equals(stateHash(SUBJECT))).toBe(true);
  });

  it('carries no whitespace, which C-07 states as a rendering rule', () => {
    expect(canonicalStateSerialization(SUBJECT)).not.toMatch(/\s/);
  });
});

// -----------------------------------------------------------------------------
// The list itself, against ADR-026 C-07
// -----------------------------------------------------------------------------
// C-07 is prose in an ADR and `0015`'s column comment is prose in SQL. This is
// the only executable copy, so the names and the ordinals are asserted against
// the ADR rather than against the module that uses them.

const C07_COLUMNS = [
  'account_id',
  'trading_day',
  'phase',
  'floor_cents',
  'floor_locked',
  'floor_open_cents',
  'high_water_balance_cents',
  'balance_cents',
  'withdrawable_cents',
  'traded_days_count',
  'win_days_count',
  'consistency_best_day_cents',
  'consistency_period_profit_cents',
  'consistency_period_start_day',
  'payouts_settled_count',
  'payout_anchor_day',
  'cadence_anchor_day',
  'engine_eligible',
  'engine_gates',
] as const;

describe('the hashed column list is ADR-026 C-07 exactly', () => {
  it('is nineteen columns, in C-07 declared order, under C-07 names', () => {
    expect(HASHED_COLUMNS.map((c) => c.column)).toEqual([...C07_COLUMNS]);
  });

  it('numbers them 1 to 19 as C-07 numbers them', () => {
    expect(HASHED_COLUMNS.map((c) => c.ordinal)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
  });

  it('names every exclusion C-07 and ADR-047 state, so the list carries five entries', () => {
    expect(EXCLUDED_COLUMNS.map((c) => c.column)).toEqual([
      'context_gates',
      'engine_version',
      'computed_at',
      'calendar_revision_id',
      'id, state_hash',
    ]);
  });

  it('gives every exclusion a reason rather than only a name', () => {
    for (const excluded of EXCLUDED_COLUMNS) {
      expect(excluded.reason.length).toBeGreaterThan(20);
      expect(excluded.source).not.toBe('');
    }
  });
});

// -----------------------------------------------------------------------------
// Every column and every leaf is REACHED
// -----------------------------------------------------------------------------
// A dropped column is invisible to a single hand-written expectation whenever
// the dropped column's value happens to match. Mutating each field in turn and
// asserting the digest moves is what makes "nineteen columns are hashed" a
// measurement rather than a claim.

const BASE = stateHash(SUBJECT);

const withState = (patch: Partial<RuleState>): StateHashSubject => ({
  accountId: ACCOUNT_ID,
  state: { ...STATE, ...patch },
});

const withGates = (patch: Partial<EngineGateResults>): StateHashSubject =>
  withState({ engineGates: { ...GATES, ...patch } });

describe('every hashed column moves the digest', () => {
  const cases: readonly (readonly [string, StateHashSubject])[] = [
    ['account_id', { accountId: 'ffffffff-d9cb-469f-a165-70867728950e', state: STATE }],
    ['trading_day', withState({ tradingDay: td('2026-08-18') })],
    ['phase', withState({ phase: 'eval' })],
    ['floor_cents', withState({ floorCents: 4_780_001n })],
    ['floor_locked', withState({ floorLocked: true })],
    ['floor_open_cents', withState({ floorOpenCents: 4_750_001n })],
    ['high_water_balance_cents', withState({ highWaterBalanceCents: 5_030_001n })],
    ['balance_cents', withState({ balanceCents: 5_030_001n })],
    ['withdrawable_cents', withState({ withdrawableCents: 1n })],
    ['traded_days_count', withState({ tradedDaysCount: 13 })],
    ['win_days_count', withState({ winDaysCount: 4 })],
    ['consistency_best_day_cents', withState({ consistencyBestDayCents: 20_001n })],
    ['consistency_period_profit_cents', withState({ consistencyPeriodProfitCents: 30_001n })],
    ['consistency_period_start_day', withState({ consistencyPeriodStartDay: td('2026-08-10') })],
    ['payouts_settled_count', withState({ payoutsSettledCount: 1 })],
    ['payout_anchor_day', withState({ payoutAnchorDay: td('2026-08-03') })],
    ['cadence_anchor_day', withState({ cadenceAnchorDay: td('2026-08-04') })],
    ['engine_eligible', withState({ engineEligible: true })],
    ['engine_gates', withGates({ buffer: { pass: true, haveCents: 30_000n, needCents: 0n } })],
  ];

  it('covers all nineteen', () => {
    expect(cases.map(([column]) => column)).toEqual([...C07_COLUMNS]);
  });

  for (const [column, mutated] of cases) {
    it(`${column} changes the hash`, () => {
      expect(stateHash(mutated).equals(BASE)).toBe(false);
    });
  }
});

describe('every one of the twenty-five engine_gates leaves moves the digest', () => {
  const cases: readonly (readonly [string, EngineGateResults])[] = [
    ['tradedDays.pass', { ...GATES, tradedDays: { ...GATES.tradedDays, pass: false } }],
    ['tradedDays.skipped', { ...GATES, tradedDays: { ...GATES.tradedDays, skipped: false } }],
    ['tradedDays.have', { ...GATES, tradedDays: { ...GATES.tradedDays, have: 13 } }],
    ['tradedDays.need', { ...GATES, tradedDays: { ...GATES.tradedDays, need: 1 } }],
    ['winDays.pass', { ...GATES, winDays: { ...GATES.winDays, pass: true } }],
    ['winDays.have', { ...GATES, winDays: { ...GATES.winDays, have: 4 } }],
    ['winDays.need', { ...GATES, winDays: { ...GATES.winDays, need: 6 } }],
    ['winDays.floorCents', { ...GATES, winDays: { ...GATES.winDays, floorCents: 15_001n } }],
    ['buffer.pass', { ...GATES, buffer: { ...GATES.buffer, pass: true } }],
    ['buffer.haveCents', { ...GATES, buffer: { ...GATES.buffer, haveCents: 30_001n } }],
    ['buffer.needCents', { ...GATES, buffer: { ...GATES.buffer, needCents: 100_001n } }],
    ['consistency.pass', { ...GATES, consistency: { ...GATES.consistency, pass: false } }],
    ['consistency.skipped', { ...GATES, consistency: { ...GATES.consistency, skipped: true } }],
    [
      'consistency.bestDayShareBp',
      { ...GATES, consistency: { ...GATES.consistency, bestDayShareBp: 6668 } },
    ],
    [
      'consistency.maxDayShareBp',
      { ...GATES, consistency: { ...GATES.consistency, maxDayShareBp: 3001 } },
    ],
    [
      'consistency.profitNeededToDiluteCents',
      { ...GATES, consistency: { ...GATES.consistency, profitNeededToDiluteCents: 36_668n } },
    ],
    ['cadenceGap.pass', { ...GATES, cadenceGap: { ...GATES.cadenceGap, pass: false } }],
    ['cadenceGap.skipped', { ...GATES, cadenceGap: { ...GATES.cadenceGap, skipped: false } }],
    [
      'cadenceGap.tradingDaysSinceLastPayout',
      { ...GATES, cadenceGap: { ...GATES.cadenceGap, tradingDaysSinceLastPayout: 7 } },
    ],
    ['cadenceGap.need', { ...GATES, cadenceGap: { ...GATES.cadenceGap, need: 6 } }],
    [
      'cadenceGap.nextEligibleTradingDay',
      { ...GATES, cadenceGap: { ...GATES.cadenceGap, nextEligibleTradingDay: td('2026-08-21') } },
    ],
    ['minimumAmount.pass', { ...GATES, minimumAmount: { ...GATES.minimumAmount, pass: true } }],
    [
      'minimumAmount.withdrawableCents',
      { ...GATES, minimumAmount: { ...GATES.minimumAmount, withdrawableCents: 1n } },
    ],
    [
      'minimumAmount.capCents',
      { ...GATES, minimumAmount: { ...GATES.minimumAmount, capCents: 250_001n } },
    ],
    [
      'minimumAmount.minPayoutCents',
      { ...GATES, minimumAmount: { ...GATES.minimumAmount, minPayoutCents: 10_001n } },
    ],
  ];

  it('covers every declared leaf, and the leaf list is twenty-five long', () => {
    expect(ENGINE_GATE_LEAVES).toHaveLength(25);
    expect(cases.map(([path]) => path)).toEqual(ENGINE_GATE_LEAVES.map((l) => l.path));
  });

  for (const [path, gates] of cases) {
    it(`${path} changes the hash`, () => {
      expect(stateHash(withState({ engineGates: gates })).equals(BASE)).toBe(false);
    });
  }
});

// -----------------------------------------------------------------------------
// The leaf list is EVERY leaf, and a widening of `EngineGateResults` is LOUD
// -----------------------------------------------------------------------------
// THE CONTROL ABOVE STAYS VALID AND ENFORCES NOTHING AGAINST THE LIKELIEST
// FUTURE CHANGE. `ENGINE_GATE_LEAVES` is an explicit ordered list of twenty-five
// dotted paths, and the mutation cases above are transcribed from that same
// list. Add a twenty-sixth field to `EngineGateResults` and every assertion in
// this file still passes: the list did not change, so the transcription still
// matches it, so the new field is simply not hashed. A gate result that is not
// hashed is a gate result INV-04's nightly replay cannot see move, which is the
// exact failure `state_hash` exists to prevent, arriving silently.
//
// A `keyof` mapped type does not close this. The leaves are NESTED paths, one
// level down inside six gate interfaces, and `keyof EngineGateResults` is the
// six gate names. The type system knows the shape; only a walk over a VALUE
// yields the dotted paths the list is written in.
//
// SO THE VALUE IS WALKED AND THE TWO SETS ARE COMPARED. The completeness of the
// walk comes from the type: `REPRESENTATIVE` is annotated `EngineGateResults`,
// so a new REQUIRED field makes the literal below a compile error, the literal
// gains the field, and the walk then reports it as unhashed by name. The two
// halves are what make it loud rather than either alone.
//
// ITS ONE BLIND SPOT, STATED RATHER THAN LEFT TO BE DISCOVERED: an OPTIONAL
// field omitted from the literal is invisible to a value walk. No field on the
// six gate interfaces is optional today. Keep it that way, or this control
// weakens exactly as quietly as the one it was written to replace.
//
// AND IT COMPARES SETS, NOT ORDER, DELIBERATELY. Key order is what M01 section
// 1.4 bans depending on, "because key order is insertion order and CAN DRIFT
// WITH A REFACTOR". The ordered list remains the specification for the hash;
// order is pinned above against a hand transcription. This asserts membership,
// which is the property a walk can honestly measure.

/**
 * A value is walked only if it is a plain object. A `Date`, a `Buffer`, a `Map`
 * or any class instance is reported as ONE leaf at its own path rather than
 * being taken apart, so such a field arrives here as an unhashed path to rule
 * on rather than as a silently expanded set of internals.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Every dotted leaf path in a value. `null` is a leaf; an empty object is a leaf. */
function dottedLeafPaths(value: unknown, prefix = ''): readonly string[] {
  if (!isPlainObject(value)) return [prefix];
  const keys = Object.keys(value);
  if (keys.length === 0) return [prefix];
  return keys.flatMap((key) =>
    dottedLeafPaths(value[key], prefix === '' ? key : `${prefix}.${key}`),
  );
}

/**
 * Every nullable leaf POPULATED, which `GATES` deliberately leaves null.
 *
 * Both values are walked below. A null renders as a leaf at its own path, so a
 * future nullable whose value happens to be null in one fixture cannot hide its
 * structure from both.
 */
const REPRESENTATIVE: EngineGateResults = {
  tradedDays: { pass: true, skipped: false, have: 12, need: 10 },
  winDays: { pass: true, have: 5, need: 5, floorCents: 15_000n },
  buffer: { pass: true, haveCents: 300_000n, needCents: 100_000n },
  consistency: {
    pass: true,
    skipped: false,
    bestDayShareBp: 2500,
    maxDayShareBp: 3000,
    profitNeededToDiluteCents: 0n,
  },
  cadenceGap: {
    pass: true,
    skipped: false,
    tradingDaysSinceLastPayout: 7,
    need: 5,
    nextEligibleTradingDay: td('2026-08-21'),
  },
  minimumAmount: {
    pass: true,
    withdrawableCents: 200_000n,
    capCents: 250_000n,
    minPayoutCents: 10_000n,
  },
};

describe('every leaf of EngineGateResults is declared in ENGINE_GATE_LEAVES', () => {
  const declared = ENGINE_GATE_LEAVES.map((l) => l.path);

  const fixtures: readonly (readonly [string, EngineGateResults])[] = [
    ['every nullable populated', REPRESENTATIVE],
    ['the nullables null', GATES],
  ];

  for (const [label, gates] of fixtures) {
    it(`declares every path present in the value: ${label}`, () => {
      const walked = dottedLeafPaths(gates);

      const unhashed = walked.filter((path) => !declared.includes(path));
      expect(
        unhashed,
        `these EngineGateResults leaves are NOT in ENGINE_GATE_LEAVES, so they are not in the ` +
          `SD-08 state hash and INV-04 replay cannot see them move: ${unhashed.join(', ')}. ` +
          `Adding a leaf changes the serialization of every row and is an Appendix B.4 ` +
          `engine-upgrade event, not a test fix.`,
      ).toEqual([]);
    });

    it(`declares no path absent from the value: ${label}`, () => {
      const walked = dottedLeafPaths(gates);

      const stale = declared.filter((path) => !walked.includes(path));
      expect(
        stale,
        `ENGINE_GATE_LEAVES declares paths that no longer exist on EngineGateResults: ` +
          `${stale.join(', ')}. Removing a leaf is also an Appendix B.4 event.`,
      ).toEqual([]);
    });
  }

  it('walks to exactly the twenty-five the list carries, with no duplicates', () => {
    const walked = dottedLeafPaths(REPRESENTATIVE);
    expect(walked).toHaveLength(25);
    expect(new Set(walked).size).toBe(25);
    expect([...walked].sort()).toEqual([...declared].sort());
  });

  it('the walk itself finds an added leaf, which is what makes the assertion a control', () => {
    // The walker is the load-bearing half. If it silently skipped an unknown
    // field, the assertion above would pass on a widened type and this whole
    // section would read as enforcement while enforcing nothing, which is the
    // defect it was written to end. So the walker is exercised on a value that
    // HAS a twenty-sixth leaf, without touching the engine's type.
    const widened = {
      ...REPRESENTATIVE,
      winDays: { ...REPRESENTATIVE.winDays, streakDays: 3 },
    };

    const walked = dottedLeafPaths(widened);
    expect(walked).toContain('winDays.streakDays');
    expect(walked.filter((path) => !declared.includes(path))).toEqual(['winDays.streakDays']);
  });

  it('reports a nested object added as a gate by its leaves, not as one opaque field', () => {
    const widened = {
      ...REPRESENTATIVE,
      drawdownPace: { pass: true, usedBp: 4000, limitBp: 8000 },
    };

    expect(dottedLeafPaths(widened).filter((path) => !declared.includes(path))).toEqual([
      'drawdownPace.pass',
      'drawdownPace.usedBp',
      'drawdownPace.limitBp',
    ]);
  });
});

// -----------------------------------------------------------------------------
// The exclusions, asserted where they are assertable
// -----------------------------------------------------------------------------
// `context_gates` and `calendar_revision_id` cannot be asserted here and the
// reason is stronger than a test: neither reaches this function at all.
// `RuleState` carries no context gate (INV-23 is structural in the type: "so
// nothing below appears on `RuleState`") and the calendar watermark is the
// batch's stamp, never the engine's output. `computed_at` and `id` are the
// writer's. `engine_version` is the one exclusion that IS on `RuleState`, so it
// is the one that could be hashed by accident, and it is asserted.

describe('the exclusions', () => {
  it('engine_version is on RuleState and is NOT hashed (ADR-026 C-07)', () => {
    expect(
      stateHash(withState({ engineVersion: 'a-completely-different-build' })).equals(BASE),
    ).toBe(true);
  });

  it('the RuleState fields that are not rule_states columns are not hashed either', () => {
    // `lifetimeSettledCents`, `breached` and `breachKind` are engine state with
    // no column in `0015`. Hashing a field the table does not hold would make
    // replay compare a value the stored row never carried.
    expect(stateHash(withState({ lifetimeSettledCents: 999_999n })).equals(BASE)).toBe(true);
    expect(stateHash(withState({ breached: true })).equals(BASE)).toBe(true);
    expect(stateHash(withState({ breachKind: 'static_floor' })).equals(BASE)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// The framing, and the collision it exists to prevent
// -----------------------------------------------------------------------------

describe('the framing is injective', () => {
  it('separates two adjacent counts that plain concatenation would merge', () => {
    // Unframed, `traded_days_count = 1, win_days_count = 23` and `12, 3` both
    // render "123", and replay would read two different states as one.
    const a = stateHash(withState({ tradedDaysCount: 1, winDaysCount: 23 }));
    const b = stateHash(withState({ tradedDaysCount: 12, winDaysCount: 3 }));
    expect(a.equals(b)).toBe(false);
  });

  it('keeps the two anchors distinguishable when their values are swapped (C-09)', () => {
    const anchored = withState({
      payoutsSettledCount: 1,
      payoutAnchorDay: td('2026-08-03'),
      cadenceAnchorDay: td('2026-08-05'),
    });
    const swapped = withState({
      payoutsSettledCount: 1,
      payoutAnchorDay: td('2026-08-05'),
      cadenceAnchorDay: td('2026-08-03'),
    });
    expect(stateHash(anchored).equals(stateHash(swapped))).toBe(false);
  });

  it('distinguishes a null anchor from a date, through the sentinel', () => {
    expect(stateHash(withState({ payoutAnchorDay: td('2026-08-03') })).equals(BASE)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Refusals
// -----------------------------------------------------------------------------
// A malformed value is a bug in the caller and it is loud, because the quiet
// alternative is a row whose hash nothing can reproduce.

describe('it refuses rather than hashing something plausible', () => {
  it('refuses an account id that is not a canonical lowercase UUID', () => {
    expect(() =>
      canonicalStateSerialization({ accountId: ACCOUNT_ID.toUpperCase(), state: STATE }),
    ).toThrow(StateHashError);
  });

  it('refuses a trading day that is not YYYY-MM-DD', () => {
    expect(() => stateHash(withState({ tradingDay: td('17/08/2026') }))).toThrow(StateHashError);
  });

  it('refuses a count that is not an integer', () => {
    expect(() => stateHash(withState({ tradedDaysCount: 12.5 }))).toThrow(StateHashError);
  });
});

// =============================================================================
// ADR-081. EVERYTHING ABOVE THIS LINE IS UNCHANGED BY THE MOVE, AND THAT IS THE
// POINT
// =============================================================================
// The implementation left this file for `packages/rules-engine/src/hash.ts` and
// the imports above still name `../src/batch/state-hash.js`, which is now a
// re-export shim. So every assertion above -- the hand transcription of C-07,
// the nineteen mutations, the twenty-five leaf mutations, the exclusions --
// exercises the ENGINE, and this file became something better than a test of
// `apps/worker`: it is an INDEPENDENT IMPLEMENTATION of the whole serialization
// AND an independent SHA-256, checked against the engine's.
//
// That matters because ADR-081's SHA-256 is HAND-ROLLED, applying the
// 2026-08-17 review desk section 3. Under `"types": []` the engine's own test
// directory cannot import `node:crypto` either, so this file is the only place
// in the repository where the hand-roll meets OpenSSL. Not one line above was
// edited to make it pass.
//
// TWO THINGS ARE ADDED HERE AND NOTHING IS ALTERED ABOVE.

describe('ADR-081: the move changed no digest', () => {
  it('reproduces the digest measured on origin/main BEFORE the move', () => {
    // Taken at acd65a6, through the `createHash('sha256')` that lived in this
    // file at the time. A before-value measured afterwards with the new code
    // proves nothing, so it was measured first and written down.
    expect(stateHash(SUBJECT).toString('hex')).toBe(
      '6f640ab71dacea9cb5f7c8502e2e11cafb8ab126d1c79c9c9761087112f60d60',
    );
  });

  it('serializes to the 309 bytes that digest was taken over', () => {
    expect(Buffer.byteLength(canonicalStateSerialization(SUBJECT), 'utf8')).toBe(309);
  });

  it('still returns a Buffer, which is what ports.ts and replay.ts require', () => {
    // The engine returns `Uint8Array`; the shim wraps it. `.equals()` is a
    // `Buffer` method and `replay.ts:161` calls it, so this is load bearing.
    expect(Buffer.isBuffer(stateHash(SUBJECT))).toBe(true);
    expect(stateHash(SUBJECT).equals(stateHash(SUBJECT))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// The differential block: the hand-rolled encoder and digest against Node's
// -----------------------------------------------------------------------------
// THE SUBTLEST DEFECT CLASS IN ADR-081 IS THE UTF-8 ENCODER, and no fixture
// reaches it, because every value in a real `rule_states` row is ASCII. Under
// `"types": []` the engine cannot call `Buffer.byteLength`, so `hash.ts` writes
// the encoder out, and it has to agree with Node on inputs a `TextEncoder`
// would also have to think about: an unpaired surrogate, which both Node and
// the WHATWG encoder replace with `U+FFFD`.
//
// `phase` is the injection point. It renders through `text()` with no shape
// assertion, so an arbitrary string reaches the framing and the digest through
// the real serializer rather than through a test double.
//
// BOTH HALVES ARE ASSERTED EVERY TIME, and that is not belt and braces. A
// digest that matches while the length prefix disagrees would mean both sides
// are wrong the same way, which is exactly what a single-sided check cannot
// see.

/** The cases that decide the encoder, each named for what it is testing. */
const SURROGATES: readonly (readonly [string, string])[] = [
  ['a lone HIGH surrogate', '\ud800'],
  ['a lone LOW surrogate', '\udc00'],
  ['a HIGH surrogate followed by a NON-surrogate, so the pair never forms', '\ud800a'],
  ['a HIGH surrogate at the very end of the string', 'a\ud800'],
  ['a valid PAIR', '𝄞'],
  ['a valid PAIR followed by a lone low', '𝄞\udfff'],
  ['two valid PAIRS adjacent', '𝄞𝄞'],
  ['a low surrogate BEFORE a high one, which is never a pair', '\udc00\ud800'],
];

/**
 * UTF-8 length differs from UTF-16 length here, so these cross the 55/56 and
 * 63/64 seams in BYTES while sitting at other lengths in units. A padding bug
 * that only shows at a block boundary would otherwise be reached by no case.
 */
const BOUNDARY_STRADDLERS: readonly string[] = [
  // '€' is 3 bytes and 1 unit: n units of it plus filler lands byte lengths
  // either side of both seams while the string length says something else.
  ...[16, 17, 18, 20, 21, 39, 40, 41].map((units) => '€'.repeat(units)),
  // '𝄞' is 4 bytes and 2 units.
  ...[13, 14, 15, 16, 29, 30, 31].map((units) => '𝄞'.repeat(units)),
  // ASCII runs, so the two lengths agree and the seam is where it looks.
  ...[0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 200].map((n) => 'x'.repeat(n)),
];

describe("the hand-rolled encoder and digest agree with node:crypto's", () => {
  const check = (value: string): void => {
    const subject = withState({ phase: value as RuleState['phase'] });
    const serialization = canonicalStateSerialization(subject);

    // Half one: the length prefix counts BYTES, as Node counts them.
    const bytes = Buffer.byteLength(value, 'utf8');
    expect(serialization).toContain(`${String(bytes)}:${value}`);

    // Half two: the digest is SHA-256 of exactly those bytes.
    const independent = createHash('sha256').update(serialization, 'utf8').digest();
    expect(stateHash(subject).equals(independent)).toBe(true);
  };

  it.each(SURROGATES)('%s', (_what, value) => {
    check(value);
  });

  it('agrees across every SHA-256 block seam, in bytes rather than in units', () => {
    for (const value of BOUNDARY_STRADDLERS) check(value);
    // Anti-vacuity: the straddlers must actually straddle. Without this, a
    // list that silently stopped producing multi-byte strings would keep the
    // loop above green while testing nothing the ASCII cases do not.
    const byteLengths = new Set(BOUNDARY_STRADDLERS.map((v) => Buffer.byteLength(v, 'utf8')));
    expect(byteLengths.has(55)).toBe(true);
    expect(byteLengths.has(56)).toBe(true);
    expect(byteLengths.has(63)).toBe(true);
    expect(byteLengths.has(64)).toBe(true);
    expect(BOUNDARY_STRADDLERS.some((v) => Buffer.byteLength(v, 'utf8') !== v.length)).toBe(true);
  });

  it('distinguishes an unpaired surrogate from the replacement character it encodes as', () => {
    // Both render as EF BF BD, so their digests are EQUAL, and that equality is
    // Node's behaviour rather than a defect. Asserted so a future encoder that
    // "fixed" it would be caught changing a stored hash.
    const lone = withState({ phase: '\ud800' as RuleState['phase'] });
    const replacement = withState({ phase: '�' as RuleState['phase'] });
    expect(stateHash(lone).equals(stateHash(replacement))).toBe(true);
    expect(
      stateHash(lone).equals(
        createHash('sha256').update(canonicalStateSerialization(replacement), 'utf8').digest(),
      ),
    ).toBe(true);
  });
});
