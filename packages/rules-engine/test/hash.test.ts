// =============================================================================
// packages/rules-engine/test/hash.test.ts
// =============================================================================
// SD-08's CANONICAL SERIALIZATION, as ADR-026 C-07 declares it and ADR-081
// moved it. The primitive underneath is `hash-sha256.test.ts`'s; this file is
// about the nineteen columns, the twenty-five leaves, the framing and the
// sentinel.
//
// WHAT IT DELIBERATELY DOES NOT DUPLICATE. `apps/worker/test/state-hash.test.ts`
// transcribes the whole serialization by hand from C-07 and hashes it with
// `node:crypto`, then mutates all nineteen columns and all twenty-five leaves
// and asserts the digest moves. That file is the differential oracle and it is
// worth more than any assertion written here, because its expectation was
// derived from the ADR and not from this code. It cannot live in this package:
// `"types": []` means `node:crypto` does not typecheck here.
//
// THE ONE ASSERTION THIS FILE EXISTS FOR IS THE FIRST ONE BELOW. A canonical
// digest is a compatibility surface (ADR-081): if the serialization changes,
// every stored hash becomes unequal to a recomputation of the same state, and
// the nightly reports replay divergence that did not happen on every row of
// every account at once. So the digest is PINNED, at the value measured on
// `origin/main` before the move, through the `node:crypto` path that produced
// it there.

import { describe, expect, it } from 'vitest';

import {
  canonicalStateSerialization,
  ENGINE_GATE_LEAVES,
  EXCLUDED_COLUMNS,
  HASHED_COLUMNS,
  StateHashError,
  stateHash,
  type StateHashSubject,
} from '../src/hash.ts';
import type { EngineGateResults, TradingDay } from '../src/types.ts';

const td = (s: string): TradingDay => s as TradingDay;

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const ACCOUNT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/**
 * The same funded, mid-consistency-period day `apps/worker/test` uses, so the
 * two files pin ONE state and a divergence between them is visible rather than
 * arguable. All three nullable columns are null, so the sentinel is exercised
 * on every one of them.
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

const SUBJECT: StateHashSubject = {
  accountId: ACCOUNT_ID,
  state: {
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
    engineGates: GATES,
    engineEligible: false,
  },
};

const withState = (patch: Partial<StateHashSubject['state']>): StateHashSubject => ({
  accountId: SUBJECT.accountId,
  state: { ...SUBJECT.state, ...patch },
});

describe('ADR-081: the move changed no digest', () => {
  it('reproduces the digest measured on origin/main before the move', () => {
    // Measured at acd65a6 through `apps/worker/src/batch/state-hash.ts`'s
    // `createHash('sha256')`, BEFORE `hash.ts` existed. If this line ever has
    // to change, that is not a test to update: it is the finding.
    expect(hex(stateHash(SUBJECT))).toBe(
      '6f640ab71dacea9cb5f7c8502e2e11cafb8ab126d1c79c9c9761087112f60d60',
    );
  });

  it('serializes to the 309 bytes that digest was taken over', () => {
    expect(canonicalStateSerialization(SUBJECT)).toHaveLength(309);
  });

  it('produces the 32 bytes rule_states_hash_is_sha256 checks', () => {
    expect(stateHash(SUBJECT)).toHaveLength(32);
  });

  it('is a function of the subject and nothing else', () => {
    expect(hex(stateHash(SUBJECT))).toBe(hex(stateHash(SUBJECT)));
  });
});

// -----------------------------------------------------------------------------
// The framing, which is the choice the sources do not make
// -----------------------------------------------------------------------------
describe('the length prefix is what makes the serialization injective', () => {
  it('separates a counter pair that plain concatenation would collide', () => {
    // C-07 gives three rendering rules and NO separator. `traded_days_count = 1,
    // win_days_count = 23` and `12, 3` both render "123" concatenated, and they
    // are exactly the pair R-33 and R-34 gate on.
    const a = stateHash(withState({ tradedDaysCount: 1, winDaysCount: 23 }));
    const b = stateHash(withState({ tradedDaysCount: 12, winDaysCount: 3 }));
    expect(hex(a)).not.toBe(hex(b));
  });

  it('frames every field as <utf8 byte length>:<value> and holds "no whitespace"', () => {
    const serialization = canonicalStateSerialization(SUBJECT);
    expect(serialization.startsWith(`36:${ACCOUNT_ID}`)).toBe(true);
    expect(serialization).not.toMatch(/\s/);
  });

  it("renders null as C-07's explicit sentinel on all three nullable columns", () => {
    const serialization = canonicalStateSerialization(SUBJECT);
    // FIVE, not three, and the difference is the point. Columns 14, 16 and 17
    // are the nullable COLUMNS (consistency_period_start_day and the two
    // anchors); the other two sentinels are nullable LEAVES inside column 19,
    // `cadenceGap.tradingDaysSinceLastPayout` and `.nextEligibleTradingDay`.
    expect([...serialization.matchAll(/5:~null/g)]).toHaveLength(5);
    expect(canonicalStateSerialization(withState({ payoutAnchorDay: td('2026-08-03') }))).not.toBe(
      serialization,
    );
  });
});

// -----------------------------------------------------------------------------
// The nineteen and the twenty-five, against the ADR rather than against the code
// -----------------------------------------------------------------------------
/** ADR-026 C-07's numbered list, transcribed. `0015`'s column comment agrees. */
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

describe('the covered set is C-07 exactly', () => {
  it('hashes the nineteen columns C-07 declares, in C-07 order', () => {
    expect(HASHED_COLUMNS.map((c) => c.column)).toEqual([...C07_COLUMNS]);
  });

  it('carries C-07 ordinals 1 to 19, so the order is checkable and not merely true', () => {
    expect(HASHED_COLUMNS.map((c) => c.ordinal)).toEqual(C07_COLUMNS.map((_, index) => index + 1));
  });

  it('walks twenty-five gate leaves with unique dotted paths', () => {
    expect(ENGINE_GATE_LEAVES).toHaveLength(25);
    expect(new Set(ENGINE_GATE_LEAVES.map((l) => l.path)).size).toBe(25);
  });

  it('records the five exclusions, each with a reason and a source', () => {
    expect(EXCLUDED_COLUMNS.map((c) => c.column)).toEqual([
      'context_gates',
      'engine_version',
      'computed_at',
      'calendar_revision_id',
      'id, state_hash',
    ]);
    for (const excluded of EXCLUDED_COLUMNS) {
      expect(excluded.reason.length).toBeGreaterThan(20);
      expect(excluded.source).not.toBe('');
    }
  });

  it('reaches every column: mutating any one of the nineteen moves the digest', () => {
    const base = hex(stateHash(SUBJECT));
    const mutations: readonly StateHashSubject[] = [
      { accountId: '0f8fad5b-d9cb-469f-a165-70867728950f', state: SUBJECT.state },
      withState({ tradingDay: td('2026-08-18') }),
      withState({ phase: 'eval' }),
      withState({ floorCents: 4_780_001n }),
      withState({ floorLocked: true }),
      withState({ floorOpenCents: 4_750_001n }),
      withState({ highWaterBalanceCents: 5_030_001n }),
      withState({ balanceCents: 5_030_001n }),
      withState({ withdrawableCents: 1n }),
      withState({ tradedDaysCount: 13 }),
      withState({ winDaysCount: 4 }),
      withState({ consistencyBestDayCents: 20_001n }),
      withState({ consistencyPeriodProfitCents: 30_001n }),
      withState({ consistencyPeriodStartDay: td('2026-08-01') }),
      withState({ payoutsSettledCount: 1 }),
      withState({ payoutAnchorDay: td('2026-08-01') }),
      withState({ cadenceAnchorDay: td('2026-08-01') }),
      withState({ engineEligible: true }),
      withState({ engineGates: { ...GATES, buffer: { ...GATES.buffer, pass: true } } }),
    ];
    expect(mutations).toHaveLength(19);
    for (const mutated of mutations) expect(hex(stateHash(mutated))).not.toBe(base);
  });

  it('excludes the three RuleState fields no rule_states column holds', () => {
    // `lifetimeSettledCents`, `breached` and `breachKind` are not in
    // `HashedState` at all, which is the type-level half of the exclusion. The
    // assertion that matters is that a caller passing a full `RuleState` still
    // hashes the same eighteen: `Pick` is erased, so only the renderers decide.
    const widened = { ...SUBJECT.state, lifetimeSettledCents: 999_999n, breached: true };
    expect(hex(stateHash({ accountId: ACCOUNT_ID, state: widened }))).toBe(hex(stateHash(SUBJECT)));
  });
});

// -----------------------------------------------------------------------------
// A malformed input is loud, never hashed
// -----------------------------------------------------------------------------
describe('StateHashError', () => {
  it('refuses an account id that is not a canonical lowercase UUID', () => {
    expect(() => stateHash({ accountId: ACCOUNT_ID.toUpperCase(), state: SUBJECT.state })).toThrow(
      StateHashError,
    );
  });

  it('refuses a trading day that is not YYYY-MM-DD', () => {
    expect(() => stateHash(withState({ tradingDay: td('17/08/2026') }))).toThrow(StateHashError);
  });

  it('refuses a count that is not a safe integer, rather than rounding it', () => {
    expect(() => stateHash(withState({ tradedDaysCount: 12.5 }))).toThrow(StateHashError);
  });

  it('refuses a nullable day inside the gates that is malformed', () => {
    const gates: EngineGateResults = {
      ...GATES,
      cadenceGap: { ...GATES.cadenceGap, nextEligibleTradingDay: td('2026-8-3') },
    };
    expect(() => stateHash(withState({ engineGates: gates }))).toThrow(StateHashError);
  });
});
