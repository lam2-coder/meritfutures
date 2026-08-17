// =============================================================================
// packages/rules-engine/test/plan-resolve.test.ts
// =============================================================================
// `resolvePlan`, ASSERTED AGAINST A TRANSCRIPTION IT DID NOT PRODUCE.
//
// `fixtures-in-code.ts` holds `CORE_50K` and `MERIT_RAPID_50K` as `ResolvedPlan`
// values, transcribed from M01 Appendix A by a session that had not written this
// function and could not have. `published-plans-in-code.ts` holds the same two
// plans in the shape they are STORED in. The first assertion below is that
// resolving one produces the other, field for field.
//
// THAT IS THE WHOLE VALUE OF THIS FILE. A resolver tested against expectations
// written beside it proves that a copy is a copy. Tested against a transcription
// made from the same appendix by someone reading the document instead of the
// code, it proves the two readings of Appendix A agree, which is the property
// TR-01 is about and the one a golden file cannot supply here.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { EngineInvariantError } from '../src/errors.js';
import { resolvePlan } from '../src/plan/resolve.js';
import type { PlanVersionId, PlanVersionSizeRow } from '../src/types.js';

import { CORE_50K, MERIT_RAPID_50K } from './fixtures-in-code.js';
import {
  CORE_50K_SIZE,
  CORE_EVAL,
  CORE_FUNDED,
  DIRECT_50K_SIZE,
  DIRECT_RULES,
  RAPID_50K_SIZE,
  RAPID_RULES,
  c,
  coreRules,
  coreSize,
} from './published-plans-in-code.js';

describe('resolvePlan  two transcriptions of Appendix A agree', () => {
  it('CORE-50K resolves to the value the unit suite has been folding since group B', () => {
    expect(resolvePlan(coreRules(), CORE_50K_SIZE)).toEqual(CORE_50K);
  });

  it('MERIT-RAPID-50K resolves to its Appendix A.2 transcription', () => {
    // Merit Rapid is the only v1 plan with an ENABLED EVAL CONSISTENCY, so it is
    // the only one whose eval `ConsistencyRules` resolves to the populated arm
    // of the union rather than `{ enabled: false }`.
    const resolved = resolvePlan(RAPID_RULES, {
      ...RAPID_50K_SIZE,
      plan_version_id: '0199c7a1-0000-7000-8000-000000000002' as PlanVersionId,
    });
    expect(resolved).toEqual(MERIT_RAPID_50K);
  });
});

describe('resolvePlan  no percentage is applied to a money value', () => {
  it('the cents come from the size row even when they contradict the bp figures', () => {
    // M01 section 2.4's rule is not "the cents agree with the bp"; it is that
    // the engine reads the MATERIALIZED number and never recomputes it. So a
    // size row whose drawdown is nothing like 500bp of its size must resolve to
    // the row's number, because that is the number the marketing page published.
    const odd = coreSize({ drawdown_cents: c(123_457), buffer_cents: c(7) });
    const resolved = resolvePlan(coreRules(), odd);
    expect(resolved.funded.drawdown.drawdownCents).toBe(c(123_457));
    expect(resolved.funded.bufferCents).toBe(c(7));

    // And nothing anywhere equals `size * bp / 10000`, which is the expression
    // this rule exists to keep out of the runtime.
    expect(resolved.funded.drawdown.drawdownCents).not.toBe(c(250_000));
  });

  it('the win-day floor is one published value copied onto both phases', () => {
    // `plan_versions.rules.win_days` is a plan-level block and Appendix A lists
    // one win-day floor per plan. R-09 reads it off whichever phase the day is
    // in, so both phases must carry it or the eval path reads a funded field.
    const resolved = resolvePlan(coreRules(), coreSize({ win_day_floor_cents: c(4_321) }));
    expect(resolved.eval?.winDayFloorCents).toBe(c(4_321));
    expect(resolved.funded.winDayFloorCents).toBe(c(4_321));
  });
});

describe('resolvePlan  R-17, the narrowing that refuses', () => {
  it('an intraday_trailing funded drawdown throws rather than resolving to trailing_eod', () => {
    const bad = coreRules({
      funded: { drawdown: { ...CORE_FUNDED.drawdown, type: 'intraday_trailing' } },
    });
    expect(() => resolvePlan(bad, CORE_50K_SIZE)).toThrow(EngineInvariantError);
    expect(() => resolvePlan(bad, CORE_50K_SIZE)).toThrow(/CV-01/);

    // THE FAILURE MODE THIS REPLACES IS THE ONE R-17 NAMES: "Publishing it must
    // fail loudly, NEVER COMPUTE SOMETHING PLAUSIBLE." A resolver that mapped
    // the third member onto the first would produce a perfectly usable plan
    // running a drawdown nobody published.
    try {
      resolvePlan(bad, CORE_50K_SIZE);
      expect.unreachable('resolvePlan accepted an unimplemented drawdown type');
    } catch (error) {
      expect((error as EngineInvariantError).invariant).toBe('CV-01');
      expect((error as Error).message).toContain('phase_funded');
    }
  });

  it('an intraday_trailing EVAL drawdown throws too, and names the eval phase', () => {
    const bad = coreRules({
      evalPhase: { drawdown: { ...CORE_EVAL.drawdown, type: 'intraday_trailing' } },
    });
    expect(() => resolvePlan(bad, CORE_50K_SIZE)).toThrow(/phase_eval/);
  });

  it('a DISABLED eval phase carrying intraday_trailing does not throw', () => {
    // The eval phase is not resolved at all when it is disabled, so there is
    // nothing to narrow. `validatePlan`'s CV-01 still refuses the publish, which
    // is where a dead config block belongs: at the gate, not at the fold.
    const bad = coreRules({
      evalPhase: { enabled: false, drawdown: { ...CORE_EVAL.drawdown, type: 'intraday_trailing' } },
    });
    expect(() => resolvePlan(bad, CORE_50K_SIZE)).not.toThrow();
  });

  it('both admitted members resolve', () => {
    for (const type of ['trailing_eod', 'static'] as const) {
      const rules = coreRules({ funded: { drawdown: { ...CORE_FUNDED.drawdown, type } } });
      expect(resolvePlan(rules, CORE_50K_SIZE).funded.drawdown.type).toBe(type);
    }
  });
});

describe('resolvePlan  the eval phase is null exactly when it is disabled', () => {
  it('Direct resolves with no eval phase and a populated funded phase', () => {
    const resolved = resolvePlan(DIRECT_RULES, DIRECT_50K_SIZE);
    expect(resolved.eval).toBeNull();
    expect(resolved.funded.drawdown.drawdownCents).toBe(c(200_000)); // A.3, 400bp
    expect(resolved.funded.bufferCents).toBe(c(150_000)); //           A.3, 300bp
    expect(resolved.funded.maxPayouts).toBe(4); //                     A.3, ADR-024
  });

  it('a null profit target on a DISABLED eval phase is not an error', () => {
    // `0004_catalog.sql`: "Null on Direct: there is no evaluation, so there is
    // no profit target."
    expect(() =>
      resolvePlan(DIRECT_RULES, { ...DIRECT_50K_SIZE, profit_target_cents: null }),
    ).not.toThrow();
  });

  it('a null profit target on an ENABLED eval phase throws rather than defaulting to zero', () => {
    // The same comment's second sentence, which is the load-bearing one: "A ZERO
    // HERE WOULD BE A TARGET OF ZERO, which is a different and reachable thing."
    // R-26 is `closing - size >= profitTargetCents`, so a defaulted zero passes
    // on day one and funds an account that traded nothing.
    expect(() => resolvePlan(coreRules(), coreSize({ profit_target_cents: null }))).toThrow(
      /CV-03/,
    );
  });
});

describe('resolvePlan  the discriminated unions carry what the flag promises', () => {
  it('the floor lock resolves from the size row, on BOTH phases', () => {
    // SD-10 materializes ONE `floor_lock_enabled`, and `0004_catalog.sql` names
    // its source as `phase_funded.drawdown.lock.enabled`. So the eval phase's
    // `lock` block in the jsonb is never read, and both resolved phases carry
    // the size row's lock.
    //
    // THAT THE EVAL FLOOR LOCKS IS RULED RATHER THAN INFERRED. ADR-050: "the
    // lock triggers at 260,000c of profit and the eval target is 300,000c, so
    // EVERY v1 eval pass is also a lock day", and it computes GS-019's eval
    // floor at 5,150,000c on the pass day off exactly that.
    const resolved = resolvePlan(coreRules(), CORE_50K_SIZE);
    expect(resolved.eval?.drawdown.lock).toEqual({
      enabled: true,
      atProfitCents: c(260_000),
      floorAtCents: c(5_010_000),
    });
    expect(resolved.funded.drawdown.lock).toEqual(resolved.eval?.drawdown.lock);
  });

  it('a disabled lock resolves to the arm that carries no values', () => {
    const unlocked: PlanVersionSizeRow = coreSize({
      floor_lock_enabled: false,
      floor_lock_at_profit_cents: null,
      floor_lock_floor_at_cents: null,
    });
    expect(resolvePlan(coreRules(), unlocked).funded.drawdown.lock).toEqual({ enabled: false });
  });

  it('an enabled lock with a null value throws SD-10 rather than resolving half a lock', () => {
    // R-15's lock is permanent, so resolving it against a missing number would
    // pin the floor at a value nobody published for the life of the account.
    expect(() => resolvePlan(coreRules(), coreSize({ floor_lock_floor_at_cents: null }))).toThrow(
      /SD-10/,
    );
  });

  it('a daily loss limit resolves its cents from the size row', () => {
    const hard = coreRules({ funded: { daily_loss_limit: { type: 'hard', amount_bp: 100 } } });
    const resolved = resolvePlan(hard, coreSize({ daily_loss_limit_cents: c(50_000) }));
    expect(resolved.funded.dailyLossLimit).toEqual({ type: 'hard', limitCents: c(50_000) });

    // `none` carries no amount, which is CV-16 made structural: R-22 can never
    // read a limit off a plan that has none.
    expect(resolvePlan(coreRules(), CORE_50K_SIZE).funded.dailyLossLimit).toEqual({
      type: 'none',
    });
  });

  it('consistency resolves to the arm that carries the share', () => {
    expect(resolvePlan(coreRules(), CORE_50K_SIZE).funded.consistency).toEqual({
      enabled: true,
      maxDayShareBp: 3000,
    });
    expect(resolvePlan(coreRules(), CORE_50K_SIZE).eval?.consistency).toEqual({ enabled: false });
  });
});

describe('resolvePlan  the cap schedule reaches R-42 in ordinal order', () => {
  it('an out-of-order jsonb array resolves sorted', () => {
    // `capForOrdinal` takes "the last schedule entry whose `from_ordinal <=
    // ordinal`", which is the right rung only if the array is ordered. CV-09
    // requires strictly increasing ordinals, so this sort is a no-op on a
    // validated plan and a guard on a jsonb round trip that lost its order.
    const scrambled = coreSize({
      payout_cap_schedule_cents: [
        { from_ordinal: 3, cap_cents: c(300_000) },
        { from_ordinal: 1, cap_cents: c(150_000) },
        { from_ordinal: 2, cap_cents: c(200_000) },
      ],
    });
    expect(resolvePlan(coreRules(), scrambled).funded.payoutCapSchedule).toEqual([
      { fromOrdinal: 1, capCents: c(150_000) },
      { fromOrdinal: 2, capCents: c(200_000) },
      { fromOrdinal: 3, capCents: c(300_000) },
    ]);
  });

  it('the input row is not mutated', () => {
    // M01 section 1.4 bans mutation of an input outright: "Aliasing bugs are
    // non-deterministic in practice." The sort above is on a copy.
    const scrambled = coreSize({
      payout_cap_schedule_cents: [
        { from_ordinal: 2, cap_cents: c(200_000) },
        { from_ordinal: 1, cap_cents: c(150_000) },
      ],
    });
    resolvePlan(coreRules(), scrambled);
    expect(scrambled.payout_cap_schedule_cents[0]!.from_ordinal).toBe(2);
  });
});

describe('resolvePlan  INV-16, the plan version is carried and never chosen', () => {
  it('the resolved plan names the size rows own version', () => {
    const other = '0199c7a1-0000-7000-8000-000000000003' as PlanVersionId; // CORE-150K.json
    expect(resolvePlan(coreRules(), coreSize({ plan_version_id: other })).planVersionId).toBe(
      other,
    );
  });
});
