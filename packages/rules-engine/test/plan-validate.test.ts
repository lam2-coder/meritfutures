// =============================================================================
// packages/rules-engine/test/plan-validate.test.ts
// =============================================================================
// `RE-C-01` TO `RE-C-19`, M01 SECTION 8.1's "Config validation | RE-C-nn | 19,
// one per CV rule".
//
// EVERY CASE ASSERTS BOTH SIDES OF ITS OPERATOR, which is section 8.4's coverage
// rule applied to the CV series: "every rule whose operator could plausibly be
// written the other way (`>` versus `>=`, `<` versus `<=`) has a fixture pair".
// A test that only shows a rule firing cannot tell a correct `>` from a `>=`
// that happens to reject the same bad value.
//
// THE BASE PLANS ARE APPENDIX A's THREE, TRANSCRIBED AT 50K AND FROM NOWHERE
// ELSE. `fixtures-in-code.ts` states the rule this file follows: "A number here
// that cannot be traced is the defect this comment exists to make visible,
// because a unit suite that invents a parameter is a unit suite asserting the
// engine agrees with itself." Every figure below carries its Appendix A row.
//
// AND THE BASE PLANS BEING VALID IS ITSELF THE FIRST ASSERTION. Appendix A.4 is
// "the validation walk of the approved lineup", written so "the first
// `validatePlan` run is a confirmation rather than a discovery". This file is
// that run, and it reproduces A.4's table row by row including which publish
// warnings fire on which plan.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { resolvePlan } from '../src/plan/resolve.js';
import { validatePlan } from '../src/plan/validate.js';
import type {
  BreachDetectedEvent,
  Cents,
  CvId,
  DayOutput,
  PlanRulesJson,
  PlanVersionSizeRow,
  PublishedFundedPhase,
  PwId,
  ResolvedPlan,
  RuleState,
  SettlementFact,
  ValidationResult,
} from '../src/types.js';

import { validatePlan as oracleValidatePlan } from './generators/validate-plan.js';
import type { MaterializedPlan } from './generators/plan-config.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.js';

// -----------------------------------------------------------------------------
// The registry, exhaustive by construction
// -----------------------------------------------------------------------------
// A `Record<CvId, string>` DOES NOT COMPILE WITH A MEMBER MISSING, which is what
// makes "19, one per CV rule" checkable rather than counted by hand. ADR-034
// exists because hand-maintained counts drift; this one cannot.
//
// AND THREE OF THESE RULES DISCHARGE A GOLDEN-SCENARIO ROW, WHICH THE ENTRIES NOW
// SAY. ADR-076 section 2 rules `GS-076`, `GS-077` and `GS-078` `covered-elsewhere`,
// alongside `GS-083` at its own block below: the scenario has no golden fixture AND
// its assertion is executed here, which are answers to two different questions. A
// registry row is discharged when its assertion RUNS somewhere a gate can read, not
// when a file appears in `fixtures/`. `CI-06/fixture-inventory` grows a reading that
// greps this file for the id (WAVE-05 `X8`), so the id is written at the rule it
// belongs to rather than in a plan.

const CV_ASSERTIONS: Record<CvId, string> = {
  // GS-078: intraday trailing drawdown selected in v1. "Config-supported and
  // explicitly unimplemented. Publishing it fails loudly rather than computing
  // something plausible." Asserted by `RE-C-01` below and by `SEEDS['CV-01']`.
  'CV-01': 'drawdown.type is trailing_eod or static, on BOTH phases (R-17)',
  'CV-02': 'drawdown_cents > 0, strict',
  'CV-03': 'profit_target_cents > 0 when the eval phase is enabled',
  'CV-04': 'phase_eval.min_trading_days >= 1',
  'CV-05': 'required_count >= 1 and win_day_floor_cents > 0',
  // GS-077: a consistency threshold of 0 bp or above 10000 bp, "impossible and
  // meaningless configurations respectively". BOTH of the row's halves are
  // asserted by `RE-C-06` below, at 0 and at 10001, against 1 and 10000 passing.
  'CV-06': '0 < max_day_share_bp <= 10000 when consistency is enabled',
  'CV-07': 'buffer_cents >= 0',
  'CV-08': 'cadence_gap_trading_days >= 0',
  'CV-09': 'the cap schedule is non-empty, starts at ordinal 1, increases, every cap > 0',
  // GS-076: a cap below the minimum payout, under which "nobody can ever be paid".
  // "Publish fails with the failing validation rule named", which `RE-C-10` below
  // asserts with `toContain` and `SEEDS['CV-10']` asserts in both validators.
  'CV-10': 'every cap_cents >= min_payout_cents',
  'CV-11': 'buffer_cents > floor_lock_floor_at_cents - size_cents, when locked',
  'CV-12': 'floor_lock_at_profit_cents == drawdown + (floor_at - size), when locked',
  'CV-13': '0 < split_bp <= 10000',
  'CV-14': 'max_payouts >= 1',
  'CV-15': 'min_payout_cents == 10000, exactly',
  'CV-16': 'the loss-limit type is one of three, and the amount is present when it is not none',
  'CV-17': 'every cap_cents < drawdown_cents when trailing and unlocked',
  'CV-18': 'post_payout_floor_rule.mode == "none"',
  'CV-19': 'phase_funded.min_trading_days >= 0',
};

/** `RE-C-01  CV-01  drawdown.type is ...`, the two series navigable without a table. */
const reC = (cv: CvId): string => `RE-C-${cv.slice(3)}  ${cv}  ${CV_ASSERTIONS[cv]}`;

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

/** The whole lineup's shape: one rules jsonb, N size rows. */
const check = (
  rules: PlanRulesJson = coreRules(),
  sizes: readonly PlanVersionSizeRow[] = [coreSize()],
): ValidationResult => validatePlan(rules, sizes);

const idsOf = (r: ValidationResult): readonly CvId[] => r.errors.map((e) => e.id);
const diffIds = (r: ValidationResult): readonly PwId[] => r.diffs.map((d) => d.id);

// =============================================================================
// Appendix A.4, the validation walk of the approved lineup
// =============================================================================

describe('Appendix A.4  the approved lineup publishes', () => {
  it.each([
    ['Core EOD 50K', coreRules(), CORE_50K_SIZE],
    ['Merit Rapid 50K', RAPID_RULES, RAPID_50K_SIZE],
    ['Direct 50K', DIRECT_RULES, DIRECT_50K_SIZE],
  ])('%s passes every CV rule and every materialization check', (_name, rules, size) => {
    const result = validatePlan(rules, [size]);
    expect(result.errors).toEqual([]);
    expect(result.materialization).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // A.4's PW row, reproduced verbatim:
  //   PW-01           warning on all three
  //   PW-02, lag 0    Core EOD: PW-02a info (0+5 = 5), co-binding
  //                   Merit Rapid: PW-02b warning (0+1 < 3), dominated
  //                   Direct: PW-02a info (0+5 = 5), co-binding
  //   PW-03           Core EOD: info (150,000 > 100,000)
  //                   Merit Rapid: not fired (100,000 = 100,000)
  //                   Direct: not fired (150,000 = 150,000)
  //
  // GS-141, "the publish diff types co-binding apart from dominated", is discharged
  // HERE and only in part, which ADR-076 section 2 rules `covered-elsewhere` and
  // records the residual of in the same breath. The block below asserts the row's
  // first half as an EXACT-SET equality rather than a containment: `PW-02a` on Core
  // EOD and Direct, `PW-02b` on Merit Rapid, and nothing else emitted.
  //
  // WHAT IT DOES NOT ASSERT IS THE ROW'S LAST SENTENCE. "Asserts the two are never
  // rendered identically" is a claim about the `info` against `warning` severity and
  // the distinct text; `diffIds` compares ids, so both are unasserted today. Both
  // values are constructed in `validate.ts` (`PW-02a` and `PW-02b`), so the missing
  // assertion is one `expect` in this describe and it is WAVE-05 `X3`, not this file
  // being unable to reach it.
  it.each([
    ['Core EOD 50K', coreRules(), CORE_50K_SIZE, ['PW-01', 'PW-02a', 'PW-03']],
    ['Merit Rapid 50K', RAPID_RULES, RAPID_50K_SIZE, ['PW-01', 'PW-02b']],
    ['Direct 50K', DIRECT_RULES, DIRECT_50K_SIZE, ['PW-01', 'PW-02a']],
  ])('%s emits exactly A.4 publish diff', (_name, rules, size, expected) => {
    expect([...diffIds(validatePlan(rules, [size]))].sort()).toEqual([...expected].sort());
  });

  it('PW-03 fires on Core EOD and on neither of the other two, which is A.4 row three', () => {
    // "The `cap > buffer` warning firing on Core EOD alone is the plain statement
    // that a Core trader's first extraction takes more out than the cushion the
    // plan leaves behind." A strict `>`: Rapid and Direct tie and do not fire.
    expect(diffIds(validatePlan(coreRules(), [CORE_50K_SIZE]))).toContain('PW-03');
    expect(diffIds(validatePlan(RAPID_RULES, [RAPID_50K_SIZE]))).not.toContain('PW-03');
    expect(diffIds(validatePlan(DIRECT_RULES, [DIRECT_50K_SIZE]))).not.toContain('PW-03');
  });

  it('a publish diff never blocks, which is what separates it from a CV rule', () => {
    const result = validatePlan(coreRules(), [CORE_50K_SIZE]);
    expect(result.diffs.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });

  it('PW-04 fires only at a zero gap with at most one win day (AS-01)', () => {
    const armed = coreRules({
      funded: {
        cadence_gap_trading_days: 0,
        win_days: { required_count: 1, floor_bp: 30, reset_on_payout: true },
      },
    });
    expect(diffIds(check(armed))).toContain('PW-04');

    const gapOnly = coreRules({ funded: { cadence_gap_trading_days: 0 } });
    expect(diffIds(check(gapOnly))).not.toContain('PW-04');
  });
});

// =============================================================================
// RE-C-01 to RE-C-19, one per CV rule, both sides of every operator
// =============================================================================

describe('RE-C  config validation, one case per CV rule', () => {
  it(reC('CV-01'), () => {
    // R-17's operator is a membership test, so both sides are "the two admitted
    // values pass" and "the third rejects". The third is the whole rule.
    expect(
      idsOf(
        check(coreRules({ funded: { drawdown: { ...CORE_FUNDED.drawdown, type: 'static' } } })),
      ),
    ).not.toContain('CV-01');
    const bad = coreRules({
      funded: { drawdown: { ...CORE_FUNDED.drawdown, type: 'intraday_trailing' } },
    });
    expect(idsOf(check(bad))).toContain('CV-01');

    // AND ON THE EVAL PHASE TOO. The oracle's own reason: "Checking only the
    // funded one would leave an eval phase publishable with `intraday_trailing`."
    const badEval = coreRules({
      evalPhase: { drawdown: { ...CORE_EVAL.drawdown, type: 'intraday_trailing' } },
    });
    expect(check(badEval).errors.filter((e) => e.id === 'CV-01')[0]?.path).toBe(
      'phase_eval.drawdown.type',
    );
  });

  it(reC('CV-02'), () => {
    // Strict `>`. One cent passes, zero does not.
    expect(idsOf(check(coreRules(), [coreSize({ drawdown_cents: c(1) })]))).not.toContain('CV-02');
    expect(idsOf(check(coreRules(), [coreSize({ drawdown_cents: c(0) })]))).toContain('CV-02');
  });

  it(reC('CV-03'), () => {
    const zeroTarget = [coreSize({ profit_target_cents: c(0) })];
    expect(idsOf(check(coreRules(), zeroTarget))).toContain('CV-03');
    expect(idsOf(check(coreRules(), [coreSize({ profit_target_cents: c(1) })]))).not.toContain(
      'CV-03',
    );

    // THE PRECONDITION IS LOAD BEARING AND IS ASSERTED FALSE AS WELL. A null
    // target on a DISABLED eval phase is Direct, and Direct publishes.
    const disabled = coreRules({ evalPhase: { enabled: false } });
    expect(idsOf(check(disabled, [coreSize({ profit_target_cents: null })]))).not.toContain(
      'CV-03',
    );
  });

  it(reC('CV-04'), () => {
    expect(idsOf(check(coreRules({ evalPhase: { min_trading_days: 1 } })))).not.toContain('CV-04');
    expect(idsOf(check(coreRules({ evalPhase: { min_trading_days: 0 } })))).toContain('CV-04');

    // REPORTED, NOT CORRECTED. M01 gives CV-03 the qualifier "when
    // `phase_eval.enabled`" and gives CV-04 none, one row apart. Transcribed
    // literally, a Direct plan must publish `min_trading_days >= 1` for a phase
    // it never runs. This asserts the consequence so that a later session
    // reading the suite finds the asymmetry rather than rediscovering it.
    const disabledAndZero = coreRules({ evalPhase: { enabled: false, min_trading_days: 0 } });
    expect(idsOf(check(disabledAndZero))).toContain('CV-04');
  });

  it(reC('CV-05'), () => {
    const winDays = (required_count: number): PublishedFundedPhase['win_days'] => ({
      required_count,
      floor_bp: 30,
      reset_on_payout: true,
    });
    expect(idsOf(check(coreRules({ funded: { win_days: winDays(1) } })))).not.toContain('CV-05');
    expect(idsOf(check(coreRules({ funded: { win_days: winDays(0) } })))).toContain('CV-05');

    // The floor half. "A zero floor makes every traded day a win day, including
    // losing ones, since `0 >= 0`." Strict `>`, so one cent passes.
    expect(idsOf(check(coreRules(), [coreSize({ win_day_floor_cents: c(1) })]))).not.toContain(
      'CV-05',
    );
    expect(idsOf(check(coreRules(), [coreSize({ win_day_floor_cents: c(0) })]))).toContain('CV-05');
  });

  it(reC('CV-06'), () => {
    const con = (bp: number | null): PublishedFundedPhase['consistency'] =>
      bp === null
        ? { enabled: true, max_day_share_bp: null, mode: 'payout_gated' }
        : { enabled: true, max_day_share_bp: bp, mode: 'payout_gated' };

    // Both bounds, both sides. 1 and 10000 pass; 0 and 10001 do not.
    expect(idsOf(check(coreRules({ funded: { consistency: con(1) } })))).not.toContain('CV-06');
    expect(idsOf(check(coreRules({ funded: { consistency: con(10_000) } })))).not.toContain(
      'CV-06',
    );
    expect(idsOf(check(coreRules({ funded: { consistency: con(0) } })))).toContain('CV-06');
    expect(idsOf(check(coreRules({ funded: { consistency: con(10_001) } })))).toContain('CV-06');
    expect(idsOf(check(coreRules({ funded: { consistency: con(null) } })))).toContain('CV-06');

    // The precondition asserted false: a DISABLED gate with a nonsense share is
    // not a violation, because nothing reads the share.
    const off: PublishedFundedPhase['consistency'] = {
      enabled: false,
      max_day_share_bp: 0,
      mode: 'payout_gated',
    };
    expect(idsOf(check(coreRules({ funded: { consistency: off } })))).not.toContain('CV-06');
  });

  it(reC('CV-07'), () => {
    // `>=`, so a zero buffer is legal and a negative one is not. The zero case is
    // the side that matters: it is a plan with no cushion, which CV-07 permits
    // and PW-03 then reports.
    expect(idsOf(check(coreRules(), [coreSize({ buffer_cents: c(0) })]))).not.toContain('CV-07');
    expect(idsOf(check(coreRules(), [coreSize({ buffer_cents: c(-1) })]))).toContain('CV-07');
  });

  it(reC('CV-08'), () => {
    expect(idsOf(check(coreRules({ funded: { cadence_gap_trading_days: 0 } })))).not.toContain(
      'CV-08',
    );
    expect(idsOf(check(coreRules({ funded: { cadence_gap_trading_days: -1 } })))).toContain(
      'CV-08',
    );
  });

  it(reC('CV-09'), () => {
    const sched = (steps: readonly { from_ordinal: number; cap_cents: Cents }[]) => [
      coreSize({ payout_cap_schedule_cents: steps }),
      // The rules-side rungs must track, or MZ-cap-ordinals fires instead and
      // the case would be testing the wrong finding.
    ];
    const withRungs = (ordinals: readonly number[]): PlanRulesJson =>
      coreRules({
        funded: {
          payout_cap_schedule: ordinals.map((from_ordinal) => ({ from_ordinal, cap_bp: 300 })),
        },
      });

    // Non-empty, starts at 1, strictly increasing, every cap > 0: four clauses,
    // each with its passing twin.
    expect(
      idsOf(check(withRungs([1]), sched([{ from_ordinal: 1, cap_cents: c(150_000) }]))),
    ).not.toContain('CV-09');
    expect(idsOf(check(withRungs([]), sched([])))).toContain('CV-09');
    expect(
      idsOf(check(withRungs([2]), sched([{ from_ordinal: 2, cap_cents: c(150_000) }]))),
    ).toContain('CV-09');
    expect(
      idsOf(
        check(
          withRungs([1, 2]),
          sched([
            { from_ordinal: 1, cap_cents: c(150_000) },
            { from_ordinal: 2, cap_cents: c(150_000) },
          ]),
        ),
      ),
    ).not.toContain('CV-09');
    expect(
      idsOf(
        check(
          withRungs([1, 1]),
          sched([
            { from_ordinal: 1, cap_cents: c(150_000) },
            { from_ordinal: 1, cap_cents: c(150_000) },
          ]),
        ),
      ),
    ).toContain('CV-09');
    expect(idsOf(check(withRungs([1]), sched([{ from_ordinal: 1, cap_cents: c(0) }])))).toContain(
      'CV-09',
    );
  });

  it(reC('CV-10'), () => {
    // `>=`, so a cap EXACTLY at the minimum is publishable. CV-17 would bite a
    // 10,000c cap under an unlocked trailing drawdown, so the lock stays on.
    expect(
      idsOf(
        check(coreRules(), [
          coreSize({ payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(10_000) }] }),
        ]),
      ),
    ).not.toContain('CV-10');
    expect(
      idsOf(
        check(coreRules(), [
          coreSize({ payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(9_999) }] }),
        ]),
      ),
    ).toContain('CV-10');
  });

  it(reC('CV-11'), () => {
    // Strict `>`. The offset here is 10,000c (5,010,000 - 5,000,000), so a
    // buffer of 10,001c passes and 10,000c does not. An EQUAL buffer failing is
    // the half that matters: it is a post-payout balance sitting exactly ON the
    // locked floor, and R-21 is a strict `<`, so it would not breach today and
    // one cent of drift tomorrow would.
    expect(idsOf(check(coreRules(), [coreSize({ buffer_cents: c(10_001) })]))).not.toContain(
      'CV-11',
    );
    expect(idsOf(check(coreRules(), [coreSize({ buffer_cents: c(10_000) })]))).toContain('CV-11');

    // The precondition asserted false: with the lock DISABLED there is no offset
    // to clear. CV-17 then applies instead, which is the pairing INV-21 rests on.
    const unlocked = coreRules({
      funded: {
        drawdown: {
          ...CORE_FUNDED.drawdown,
          lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
        },
      },
    });
    const unlockedSize = coreSize({
      buffer_cents: c(10_000),
      floor_lock_enabled: false,
      floor_lock_at_profit_cents: null,
      floor_lock_floor_at_cents: null,
      payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(150_000) }],
    });
    expect(idsOf(check(unlocked, [unlockedSize]))).not.toContain('CV-11');
  });

  it(reC('CV-12'), () => {
    // Equality, so both sides are one cent either way. CV-12 "forces the lock to
    // engage exactly where the trailing floor already sits, so the floor never
    // jumps"; one cent of slack IS a jump.
    expect(idsOf(check())).not.toContain('CV-12');
    expect(
      idsOf(check(coreRules(), [coreSize({ floor_lock_at_profit_cents: c(260_001) })])),
    ).toContain('CV-12');
    expect(
      idsOf(check(coreRules(), [coreSize({ floor_lock_at_profit_cents: c(259_999) })])),
    ).toContain('CV-12');

    // SD-10's null case reports BOTH CV-11 and CV-12, because neither
    // inequality is evaluable and reporting one would imply the other was tested.
    const nulled = check(coreRules(), [
      coreSize({ floor_lock_at_profit_cents: null, floor_lock_floor_at_cents: null }),
    ]);
    expect(idsOf(nulled)).toContain('CV-11');
    expect(idsOf(nulled)).toContain('CV-12');
  });

  it(reC('CV-13'), () => {
    expect(idsOf(check(coreRules({ funded: { split_bp: 1 } })))).not.toContain('CV-13');
    expect(idsOf(check(coreRules({ funded: { split_bp: 10_000 } })))).not.toContain('CV-13');
    expect(idsOf(check(coreRules({ funded: { split_bp: 0 } })))).toContain('CV-13');
    expect(idsOf(check(coreRules({ funded: { split_bp: 10_001 } })))).toContain('CV-13');
  });

  it(reC('CV-14'), () => {
    expect(idsOf(check(coreRules({ funded: { max_payouts: 1 } })))).not.toContain('CV-14');
    expect(idsOf(check(coreRules({ funded: { max_payouts: 0 } })))).toContain('CV-14');
  });

  it(reC('CV-15'), () => {
    // Equality against a literal, and the literal is the point: "a well-meaning
    // config edit cannot quietly move it". Both neighbours fail.
    expect(idsOf(check(coreRules({ funded: { min_payout_cents: c(10_000) } })))).not.toContain(
      'CV-15',
    );
    expect(idsOf(check(coreRules({ funded: { min_payout_cents: c(10_001) } })))).toContain('CV-15');
    expect(idsOf(check(coreRules({ funded: { min_payout_cents: c(9_999) } })))).toContain('CV-15');
  });

  it(reC('CV-16'), () => {
    // Clause one, the vocabulary.
    const hard = coreRules({ funded: { daily_loss_limit: { type: 'hard', amount_bp: 100 } } });
    expect(idsOf(check(hard, [coreSize({ daily_loss_limit_cents: c(50_000) })]))).not.toContain(
      'CV-16',
    );
    const unknown = coreRules({
      funded: { daily_loss_limit: { type: 'intraday', amount_bp: 100 } },
    });
    expect(idsOf(check(unknown))).toContain('CV-16');

    // Clause two, the amount. Present when the type is not `none`, and NOT
    // required when it is, which is every v1 plan.
    expect(idsOf(check(hard, [coreSize({ daily_loss_limit_cents: null })]))).toContain('CV-16');
    expect(idsOf(check(coreRules(), [coreSize({ daily_loss_limit_cents: null })]))).not.toContain(
      'CV-16',
    );
  });

  it(reC('CV-17'), () => {
    // Strict `<`, and only when trailing AND unlocked. A drawdown of 150,001c
    // admits a 150,000c cap; a drawdown of exactly the cap does not, which is
    // "if `cap >= drawdown`, the payout breaches the account that earned it".
    const unlocked = coreRules({
      funded: {
        drawdown: {
          type: 'trailing_eod',
          amount_bp: 500,
          lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
        },
      },
    });
    const unlockedSize = (drawdown_cents: Cents): PlanVersionSizeRow =>
      coreSize({
        drawdown_cents,
        floor_lock_enabled: false,
        floor_lock_at_profit_cents: null,
        floor_lock_floor_at_cents: null,
      });
    expect(idsOf(check(unlocked, [unlockedSize(c(150_001))]))).not.toContain('CV-17');
    expect(idsOf(check(unlocked, [unlockedSize(c(150_000))]))).toContain('CV-17');

    // BOTH HALVES OF THE PRECONDITION ASSERTED FALSE, because the generator
    // caught exactly this: "the CV-17 cases drew a disabled eval phase and a
    // `static` drawdown roughly half the time and emitted a plan the oracle
    // correctly accepted."
    expect(idsOf(check(coreRules(), [coreSize({ drawdown_cents: c(150_000) })]))).not.toContain(
      'CV-17',
    );
    const staticUnlocked = coreRules({
      funded: {
        drawdown: {
          type: 'static',
          amount_bp: 500,
          lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
        },
      },
    });
    expect(idsOf(check(staticUnlocked, [unlockedSize(c(150_000))]))).not.toContain('CV-17');
  });

  it(reC('CV-18'), () => {
    expect(idsOf(check())).not.toContain('CV-18');
    const revived = coreRules({
      funded: { post_payout_floor_rule: { mode: 'reset_to_balance_minus_dd' } },
    });
    expect(idsOf(check(revived))).toContain('CV-18');
  });

  it(reC('CV-19'), () => {
    // `>=`, and zero is the LIVE value on all three plans rather than an edge:
    // ADR-015 disables the gate that way and CV-19 exists to keep it legal.
    expect(idsOf(check(coreRules({ funded: { min_trading_days: 0 } })))).not.toContain('CV-19');
    expect(idsOf(check(coreRules({ funded: { min_trading_days: -1 } })))).toContain('CV-19');
  });
});

// =============================================================================
// The three findings that carry no CV-nn
// =============================================================================

describe('MZ  the size row must say what the rules say', () => {
  it('MZ-lock-flag  SD-10s materialized flag disagreeing with the jsonb blocks', () => {
    const result = check(coreRules(), [coreSize({ floor_lock_enabled: false })]);
    expect(result.materialization.map((m) => m.id)).toContain('MZ-lock-flag');
    expect(result.ok).toBe(false);

    // AND IT BLOCKS THROUGH ITS OWN CHANNEL, not by borrowing a CV id. `ok` is
    // false while `errors` is untouched, which is what makes the finding
    // legible in a publish diff rather than mistaken for a ruled validation.
    expect(idsOf(result)).toEqual(idsOf(check()));
  });

  it('MZ-per-phase  one drawdown_cents column cannot serve two different bp figures', () => {
    const split = coreRules({
      evalPhase: { drawdown: { ...CORE_EVAL.drawdown, amount_bp: 400 } },
    });
    expect(check(split).materialization.map((m) => m.id)).toContain('MZ-per-phase');

    // Gated on the eval phase being ENABLED, because `ResolvedPlan.eval` is null
    // on Direct and no eval drawdown is ever resolved there.
    const disabled = coreRules({
      evalPhase: { enabled: false, drawdown: { ...CORE_EVAL.drawdown, amount_bp: 400 } },
    });
    expect(check(disabled).materialization).toEqual([]);
  });

  it('MZ-per-phase  and one daily_loss_limit_cents column cannot either', () => {
    const split = coreRules({
      funded: { daily_loss_limit: { type: 'hard', amount_bp: 100 } },
    });
    expect(
      check(split, [coreSize({ daily_loss_limit_cents: c(50_000) })]).materialization.map(
        (m) => m.id,
      ),
    ).toContain('MZ-per-phase');
  });

  it('MZ-cap-ordinals  the published rungs and the executed rungs are one list', () => {
    const twoRungs = coreRules({
      funded: {
        payout_cap_schedule: [
          { from_ordinal: 1, cap_bp: 300 },
          { from_ordinal: 3, cap_bp: 400 },
        ],
      },
    });
    // The size row still materializes one rung: CV-09 is satisfied on what R-42
    // will read, and the version is still unpublishable.
    const result = check(twoRungs, [coreSize()]);
    expect(idsOf(result)).not.toContain('CV-09');
    expect(result.materialization.map((m) => m.id)).toContain('MZ-cap-ordinals');
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// Every size row is validated, which is why the signature takes an array
// =============================================================================

describe('the version, not one size', () => {
  it('a violation on the 150K row fails the version while 50K passes', () => {
    // Appendix A.1's 150K column, with its floor lock trigger left at the 50K
    // value. CV-12 is an equality, so the wrong size's constant is a violation
    // that only the 150K row can see.
    const bad150k = coreSize({
      size_cents: c(15_000_000),
      drawdown_cents: c(750_000),
      profit_target_cents: c(900_000),
      buffer_cents: c(300_000),
      win_day_floor_cents: c(45_000),
      payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(450_000) }],
      floor_lock_at_profit_cents: c(260_000), //  A.1 says 760,000 at this size
      floor_lock_floor_at_cents: c(15_010_000),
    });
    const result = check(coreRules(), [CORE_50K_SIZE, bad150k]);
    expect(result.ok).toBe(false);

    const cv12 = result.errors.filter((e) => e.id === 'CV-12');
    expect(cv12).toHaveLength(1);
    expect(cv12[0]!.sizeCents).toBe(c(15_000_000));
  });

  it('a rules-level violation is reported once, not once per size', () => {
    const result = check(coreRules({ funded: { split_bp: 0 } }), [CORE_50K_SIZE, coreSize()]);
    expect(result.errors.filter((e) => e.id === 'CV-13')).toHaveLength(1);
    expect(result.errors.filter((e) => e.id === 'CV-13')[0]!.sizeCents).toBeNull();
  });

  it('Appendix A.1 at all four sizes publishes', () => {
    // Sizes preamble: "25K is 2,500,000c, 50K is 5,000,000c, 100K is
    // 10,000,000c, 150K is 15,000,000c", and ADR-024 confirms percent-of-size
    // scaling across all four. Each row is the bp figure applied to its size,
    // with the lock trigger at drawdown + 10,000 by CV-12.
    const at = (size: number): PlanVersionSizeRow =>
      coreSize({
        size_cents: c(size),
        drawdown_cents: c(size / 20), //           500bp
        profit_target_cents: c((size * 6) / 100), // 600bp
        buffer_cents: c(size / 50), //             200bp
        win_day_floor_cents: c((size * 3) / 1000), // 30bp
        payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c((size * 3) / 100) }], // 300bp
        floor_lock_at_profit_cents: c(size / 20 + 10_000),
        floor_lock_floor_at_cents: c(size + 10_000),
      });
    const sizes = [at(2_500_000), at(5_000_000), at(10_000_000), at(15_000_000)];

    // The transcribed 50K and 150K rows must equal what the bp figures produce,
    // or Appendix A's own arithmetic is wrong somewhere.
    expect(at(5_000_000)).toEqual(CORE_50K_SIZE);
    expect(at(15_000_000).floor_lock_at_profit_cents).toBe(c(760_000)); // A.1's 150K column

    const result = validatePlan(coreRules(), sizes);
    expect(result.errors).toEqual([]);
    expect(result.materialization).toEqual([]);
  });
});

// =============================================================================
// RE-C-oracle: the independent transcription must agree
// =============================================================================
// `test/generators/validate-plan.ts` transcribed the same nineteen rules from
// the same table in session 40, before any engine code existed. This is C10's
// writer/reviewer split as an executable check: for each CV id, the same seeded
// violation is built in both shapes and both validators must name it.
//
// THE MAPPING IS THE ONLY NEW REASONING HERE and it is deliberately dumb: it
// merges one size row into the jsonb the way `MaterializedPlan`'s header says
// the merged view is composed. If the mapping is wrong, this block fails, which
// is the correct outcome for a mapping nobody has checked.

function toMaterialized(rules: PlanRulesJson, size: PlanVersionSizeRow): MaterializedPlan {
  const num = (v: Cents | null): number => (v === null ? 0 : Number(v));
  const drawdown = (phase: 'phase_eval' | 'phase_funded') => ({
    type: rules[phase].drawdown.type,
    drawdown_cents: num(size.drawdown_cents),
    lock: {
      enabled: size.floor_lock_enabled,
      at_profit_cents:
        size.floor_lock_at_profit_cents === null ? null : Number(size.floor_lock_at_profit_cents),
      floor_at_cents:
        size.floor_lock_floor_at_cents === null ? null : Number(size.floor_lock_floor_at_cents),
    },
  });
  const dll = (phase: 'phase_eval' | 'phase_funded') => ({
    type: rules[phase].daily_loss_limit.type as 'none' | 'soft' | 'hard',
    amount_cents: size.daily_loss_limit_cents === null ? null : Number(size.daily_loss_limit_cents),
  });

  return {
    schema_version: 1,
    size_cents: num(size.size_cents),
    phase_eval: {
      enabled: rules.phase_eval.enabled,
      profit_target_cents: num(size.profit_target_cents),
      drawdown: drawdown('phase_eval'),
      daily_loss_limit: dll('phase_eval'),
      min_trading_days: rules.phase_eval.min_trading_days,
      consistency: rules.phase_eval.consistency,
      max_days: rules.phase_eval.max_days,
    },
    phase_funded: {
      drawdown: drawdown('phase_funded'),
      daily_loss_limit: dll('phase_funded'),
      min_trading_days: rules.phase_funded.min_trading_days,
      win_days: {
        required_count: rules.phase_funded.win_days.required_count,
        win_day_floor_cents: num(size.win_day_floor_cents),
        reset_on_payout: rules.phase_funded.win_days.reset_on_payout,
      },
      consistency: rules.phase_funded.consistency,
      buffer_cents: num(size.buffer_cents),
      cadence_gap_trading_days: rules.phase_funded.cadence_gap_trading_days,
      payout_cap_schedule: size.payout_cap_schedule_cents.map((s) => ({
        from_ordinal: s.from_ordinal,
        cap_cents: Number(s.cap_cents),
      })),
      min_payout_cents: Number(rules.phase_funded.min_payout_cents),
      split_bp: rules.phase_funded.split_bp,
      max_payouts: rules.phase_funded.max_payouts,
      post_payout_floor_rule: rules.phase_funded.post_payout_floor_rule,
    },
  };
}

/** One seeded violation per CV rule, in the two-shape form both validators read. */
const SEEDS: Record<CvId, { rules: PlanRulesJson; size: PlanVersionSizeRow }> = {
  'CV-01': {
    rules: coreRules({
      funded: { drawdown: { ...CORE_FUNDED.drawdown, type: 'intraday_trailing' } },
    }),
    size: coreSize(),
  },
  'CV-02': { rules: coreRules(), size: coreSize({ drawdown_cents: c(0) }) },
  'CV-03': { rules: coreRules(), size: coreSize({ profit_target_cents: c(0) }) },
  'CV-04': { rules: coreRules({ evalPhase: { min_trading_days: 0 } }), size: coreSize() },
  'CV-05': {
    rules: coreRules({
      funded: { win_days: { required_count: 0, floor_bp: 30, reset_on_payout: true } },
    }),
    size: coreSize(),
  },
  'CV-06': {
    rules: coreRules({
      funded: { consistency: { enabled: true, max_day_share_bp: 0, mode: 'payout_gated' } },
    }),
    size: coreSize(),
  },
  'CV-07': { rules: coreRules(), size: coreSize({ buffer_cents: c(-1) }) },
  'CV-08': { rules: coreRules({ funded: { cadence_gap_trading_days: -1 } }), size: coreSize() },
  'CV-09': { rules: coreRules(), size: coreSize({ payout_cap_schedule_cents: [] }) },
  'CV-10': {
    rules: coreRules(),
    size: coreSize({ payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(9_999) }] }),
  },
  'CV-11': { rules: coreRules(), size: coreSize({ buffer_cents: c(10_000) }) },
  'CV-12': { rules: coreRules(), size: coreSize({ floor_lock_at_profit_cents: c(260_001) }) },
  'CV-13': { rules: coreRules({ funded: { split_bp: 0 } }), size: coreSize() },
  'CV-14': { rules: coreRules({ funded: { max_payouts: 0 } }), size: coreSize() },
  'CV-15': { rules: coreRules({ funded: { min_payout_cents: c(9_999) } }), size: coreSize() },
  'CV-16': {
    rules: coreRules({ funded: { daily_loss_limit: { type: 'hard', amount_bp: 100 } } }),
    size: coreSize({ daily_loss_limit_cents: null }),
  },
  'CV-17': {
    rules: coreRules({
      funded: {
        drawdown: {
          type: 'trailing_eod',
          amount_bp: 500,
          lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
        },
      },
    }),
    size: coreSize({
      drawdown_cents: c(150_000),
      floor_lock_enabled: false,
      floor_lock_at_profit_cents: null,
      floor_lock_floor_at_cents: null,
    }),
  },
  'CV-18': {
    rules: coreRules({ funded: { post_payout_floor_rule: { mode: 'lock_at_size_plus' } } }),
    size: coreSize(),
  },
  'CV-19': { rules: coreRules({ funded: { min_trading_days: -1 } }), size: coreSize() },
};

describe('RE-C-oracle  the engine and the independent transcription agree', () => {
  it('the lineup is clean under the oracle too', () => {
    expect(oracleValidatePlan(toMaterialized(coreRules(), CORE_50K_SIZE))).toEqual([]);
    expect(oracleValidatePlan(toMaterialized(RAPID_RULES, RAPID_50K_SIZE))).toEqual([]);
    expect(oracleValidatePlan(toMaterialized(DIRECT_RULES, DIRECT_50K_SIZE))).toEqual([]);
  });

  it.each(Object.keys(SEEDS) as CvId[])('%s fires in both validators', (id) => {
    const seed = SEEDS[id];
    expect(idsOf(validatePlan(seed.rules, [seed.size]))).toContain(id);
    expect(oracleValidatePlan(toMaterialized(seed.rules, seed.size)).map((v) => v.id)).toContain(
      id,
    );
  });
});

// =============================================================================
// GS-083, the golden scenario that is not a golden fixture
// =============================================================================
// THE REGISTRY ROW: "Plan config rejected at publish: trailing drawdown, lock
// disabled, cap at or above the drawdown. Publishing fails with CV-17 named.
// The fixture also carries the arithmetic of what would have happened: an
// account paid on a new closing high would open the next session below its own
// floor and breach on the day it was paid. This is the file that keeps INV-21
// true now that no post-payout recompute exists to rescue it."
//
// IT LIVES HERE BECAUSE IT CANNOT LIVE IN `fixtures/`. A publish validation
// returns a `ValidationResult` against `(rules, sizes[])`; the golden format's
// `EXPECTATION_KEYS` is `{end_state, events, pins, note}`, the loader folds one
// account's day stream and diffs a `RuleState`, and `validatePlan` is never
// called anywhere in that fold. There is no shape in that directory that can
// state "publishing fails with CV-17 named", which is why the fixture README's
// held-back table routes this row to the `RE-C-nn` suite and why the row above
// now names this file.
//
// BOTH HALVES ARE ASSERTED AND THE SECOND IS WHY. "Publishing failed" alone
// would pass if some other rule rejected the config, which is the vacuous shape
// this repository keeps finding; so the block below pins CV-17 as the SOLE
// error and an empty materialization set beside it. The config is otherwise
// Appendix A.1 to the cent, and CV-17 is the only thing standing between it and
// an account.
//
// THE ARITHMETIC IS EXECUTED RATHER THAN RECITED. `resolvePlan` takes the same
// `(rules, size)` pair `validatePlan` rejected and the day fold runs on it, so
// the breach below is the engine's own R-13, R-48 and R-21 rather than a
// subtraction typed into a comment. One transcription, both halves.
//
// AND THE ARITHMETIC IS CV-17's OWN, NOT CV-11's. ADR-052 section 2 carries a
// complete worked INV-21 counterexample and it belongs to the OTHER half:
// MERIT-RAPID-50K with the lock ENABLED, landing one cent under a LOCKED floor
// at 5,100,001. CV-17 is the lock DISABLED, landing under a TRAILING floor
// because `cap >= drawdown`. The numbers below are derived from CV-17's own
// M01 row and share none of ADR-052's; transcribing that counterexample into
// this block would file one of INV-21's two halves under the other.
// =============================================================================

/**
 * The rejected config: Appendix A.1's Core EOD at 50K with exactly two changes,
 * and both are the registry row read literally.
 *
 *   the lock DISABLED    on the jsonb and on the size row together, or
 *                        `MZ-lock-flag` fires and the block below would be
 *                        measuring a materialization finding
 *   the cap AT OR ABOVE  300,000c against A.1's 250,000c drawdown. `cap_bp`
 *   THE DRAWDOWN         moves with it, 300bp to 600bp, because 600bp of
 *                        5,000,000c IS 300,000c. Nothing cross-checks the two
 *                        (`MZ-cap-ordinals` compares ordinals), so leaving the
 *                        bp behind would publish a rules block and a size row
 *                        that disagree about the cap while this file claimed
 *                        the config was otherwise clean
 *
 * 300,000c IS 50,000c ABOVE THE DRAWDOWN AND THAT DIFFERENCE IS THE SHORTFALL.
 * A cap one cent over would breach by one cent and read as a rounding artifact;
 * the excess is stated at a size where the breach is unmistakably the payout's.
 */
const GS083_RULES: PlanRulesJson = coreRules({
  funded: {
    drawdown: {
      type: 'trailing_eod', //                    A.1 funded drawdown, unchanged
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 600 }], // 600bp of 50K = 300,000c
  },
});

const GS083_SIZE: PlanVersionSizeRow = coreSize({
  floor_lock_enabled: false,
  floor_lock_at_profit_cents: null,
  floor_lock_floor_at_cents: null,
  payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(300_000) }],
});

/** One day for one account, on the config `validatePlan` refused to publish. */
function foldDay(
  plan: ResolvedPlan,
  prior: RuleState,
  fields: Parameters<typeof mark>[0],
  settlements: readonly SettlementFact[] = [],
): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan,
    prior,
    mark: mark(fields),
    calendar: CME_WINDOW,
    settlements,
    openedOn: ACCOUNT_OPENED_ON,
  });
}

describe('GS-083  trailing drawdown, lock disabled, cap at or above the drawdown', () => {
  it('publishing FAILS, and CV-17 is the code named, alone', () => {
    const result = validatePlan(GS083_RULES, [GS083_SIZE]);

    // HALF ONE. M01: `validatePlan` "runs in `POST
    // /admin/plans/versions/:id/publish` and BLOCKS THE PUBLISH. A config that
    // reaches an account is a config that already passed all of these."
    expect(result.ok).toBe(false);

    // HALF TWO, AND IT IS AN EQUALITY RATHER THAN A `toContain`. A `toContain`
    // here would pass on a config that CV-09 or CV-10 also rejected, and then
    // the file would be asserting that SOMETHING blocked rather than that
    // CV-17 did. Nothing else fires and nothing else may: this config is
    // Appendix A.1 apart from the lock flag and the cap.
    expect(idsOf(result)).toEqual(['CV-17']);
    expect(result.materialization).toEqual([]);

    // The finding names the rung it was found on and the size it was found at,
    // because a publish diff that says "CV-17" without either is a founder
    // reading nineteen rules to find one number.
    expect(result.errors[0]!.path).toBe('payout_cap_schedule_cents[0].cap_cents');
    expect(result.errors[0]!.sizeCents).toBe(c(5_000_000));

    // AND THE INDEPENDENT TRANSCRIPTION AGREES, which is the same writer/reviewer
    // split `RE-C-oracle` runs on the nineteen seeds. `test/generators/validate-plan.ts`
    // transcribed CV-17 from M01 in session 40, before `validate.ts` existed.
    expect(oracleValidatePlan(toMaterialized(GS083_RULES, GS083_SIZE)).map((v) => v.id)).toEqual([
      'CV-17',
    ]);
  });

  it('the arithmetic of what would have happened: paid on a new closing high, breached on the day it was paid', () => {
    // The SAME pair `validatePlan` just rejected, resolved by the engine's own
    // resolver. `resolvePlan` applies no CV rule -- CV-01 is the only one it can
    // refuse -- so a config that must never reach an account can still be folded
    // here, which is exactly what a counterfactual needs.
    const plan = resolvePlan(GS083_RULES, GS083_SIZE);
    expect(plan.funded.drawdown.lock.enabled).toBe(false);
    expect(plan.funded.payoutCapSchedule).toEqual([{ fromOrdinal: 1, capCents: 300_000n }]);

    // -------------------------------------------------------------------------
    // The new closing high. CV-17: "a payout taken on a new closing high moves
    // the balance down by `cap` against a floor sitting `drawdown` below the
    // same high."
    // -------------------------------------------------------------------------
    //   5,000,000 + 400,000 = 5,400,000 closing, a new high with no prior one
    //   5,400,000 -  250,000 = 5,150,000 floor, R-13's trail on the CLOSE
    //   5,400,000 - 5,000,000 - 100,000 = 300,000 withdrawable, R-35
    const high = foldDay(plan, fundedPrior(plan), {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 400_000n,
    });
    expect(high.assertions).toEqual([]);
    expect(high.state.breached).toBe(false);
    expect(high.state.balanceCents).toBe(5_400_000n);
    expect(high.state.highWaterBalanceCents).toBe(5_400_000n);
    expect(high.state.floorCents).toBe(5_150_000n);

    // THE LOCK IS OFF AND STAYED OFF, which is CV-17's precondition holding at
    // runtime rather than at publish. A.1's trigger is 260,000c of profit and
    // this day closed 400,000c up, so on the LINEUP's config R-15 would have
    // fired here and the floor would be 5,010,000c instead.
    expect(high.state.floorLocked).toBe(false);

    // The payout below is not an invented amount. It is the whole withdrawable
    // and the whole cap at ordinal 1, which is the largest single payment this
    // config can make and therefore the one CV-17 is stated about.
    expect(high.state.withdrawableCents).toBe(300_000n);

    // -------------------------------------------------------------------------
    // The settlement, and the breach it causes
    // -------------------------------------------------------------------------
    // R-48: "the floor, the high-water balance and the lock are UNTOUCHED", so
    // the floor at the open of the payout day is still 5,150,000c. R-10 puts the
    // withdrawal in `adjustment_cents` at the OPEN of the effective day, so
    // INV-18 reads 5,400,000 - 300,000 = 5,100,000.
    const settlement: SettlementFact = {
      payoutRequestId: 'gs-083',
      ordinal: 1,
      approvedCents: 300_000n,
      basisTradingDay: day('2026-11-03'),
      effectiveTradingDay: day('2026-11-04'),
    };
    const paid = foldDay(
      plan,
      high.state,
      {
        tradingDay: day('2026-11-04'),
        openingBalanceCents: 5_100_000n,
        realizedPnlCents: 0n,
        adjustmentCents: -300_000n,
        // NO FILLS AND NO REALIZED P&L, which is what makes this a reading
        // rather than an inference: the account did not trade on the day it
        // lost, so the only thing that moved the balance was the payout.
        fillCount: 0,
      },
      [settlement],
    );

    expect(paid.assertions).toEqual([]);
    expect(paid.state.breached).toBe(true);
    expect(paid.state.breachKind).toBe('trailing_eod_floor');
    expect(paid.state.phase).toBe('closed');

    // THE SETTLEMENT WAS APPLIED AND THEN KILLED THE ACCOUNT, in that order.
    // R-47's reset fires at DO-2 and the breach at DO-4, so both events are on
    // the row, and no `day.closed` follows: R-24 is terminal.
    expect(paid.events.map((e) => e.type)).toEqual(['payout.win_days_reset', 'breach.detected']);

    // R-48 measured across the settlement: the floor the day was judged against
    // is the one the closing high produced, not one a recompute rescued.
    expect(paid.state.floorOpenCents).toBe(5_150_000n);

    // THE SHORTFALL IS `cap - drawdown` AND NOTHING ELSE, which is the whole of
    // CV-17's inequality expressed as money:
    //   5,150,000 floor at open - 5,100,000 balance = 50,000
    //     300,000 cap          -   250,000 drawdown = 50,000
    const detected = paid.events[1] as BreachDetectedEvent;
    expect(detected.floorCents).toBe(5_150_000n);
    expect(detected.lowBalanceCents).toBe(5_100_000n);
    expect(detected.shortfallCents).toBe(50_000n);
    expect(detected.shortfallCents).toBe(
      GS083_SIZE.payout_cap_schedule_cents[0]!.cap_cents - GS083_SIZE.drawdown_cents,
    );

    // INV-21 IS "a settled payout can never breach the account that earned it",
    // and this is the config on which it is false. It is false at runtime, on
    // the money path, with no losing day anywhere in the stream, and the only
    // thing that ever stops it reaching an account is the rejection above.
  });

  it('a cap EXACTLY at the drawdown is rejected too, and the counterfactual says why', () => {
    // "at or above" is the registry row's phrase and CV-17's operator is a
    // strict `<`, so equality is a rejection. This is the half that decides
    // between `cap < drawdown` and `cap <= drawdown`, and the counterfactual is
    // the argument: at equality the payout lands EXACTLY ON the floor, which
    // R-21's strict `<` survives, and one cent of drift the next session does
    // not. CV-11 carries the identical shape on the locked side.
    const equalRules = coreRules({
      funded: {
        drawdown: {
          type: 'trailing_eod',
          amount_bp: 500,
          lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
        },
        payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 500 }], // 500bp of 50K = 250,000c
      },
    });
    const equalSize = coreSize({
      floor_lock_enabled: false,
      floor_lock_at_profit_cents: null,
      floor_lock_floor_at_cents: null,
      payout_cap_schedule_cents: [{ from_ordinal: 1, cap_cents: c(250_000) }], // == drawdown
    });

    const result = validatePlan(equalRules, [equalSize]);
    expect(result.ok).toBe(false);
    expect(idsOf(result)).toEqual(['CV-17']);

    // And the day fold on the same pair. 5,350,000 is the closing high that
    // makes one full 250,000c cap withdrawable:
    //   5,350,000 - 5,000,000 - 100,000 = 250,000
    //   5,350,000 -   250,000           = 5,100,000 floor
    //   5,350,000 -   250,000 paid      = 5,100,000 balance, the floor exactly
    const plan = resolvePlan(equalRules, equalSize);
    const high = foldDay(plan, fundedPrior(plan), {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 350_000n,
    });
    expect(high.state.floorCents).toBe(5_100_000n);
    expect(high.state.withdrawableCents).toBe(250_000n);

    const settlement: SettlementFact = {
      payoutRequestId: 'gs-083-equal',
      ordinal: 1,
      approvedCents: 250_000n,
      basisTradingDay: day('2026-11-03'),
      effectiveTradingDay: day('2026-11-04'),
    };
    const onTheFloor = foldDay(
      plan,
      high.state,
      {
        tradingDay: day('2026-11-04'),
        openingBalanceCents: 5_100_000n,
        realizedPnlCents: 0n,
        adjustmentCents: -250_000n,
        fillCount: 0,
      },
      [settlement],
    );
    expect(onTheFloor.state.breached).toBe(false);
    expect(onTheFloor.state.balanceCents).toBe(5_100_000n);
    expect(onTheFloor.state.floorOpenCents).toBe(5_100_000n);

    // ONE CENT OF DRIFT ON THE SAME DAY BREACHES. The account was paid onto its
    // own floor with zero room, and a config that publishes an account into that
    // position is what `cap <= drawdown` would have admitted. That is why CV-17
    // rejects equality rather than only the strict excess.
    const drifted = foldDay(
      plan,
      high.state,
      {
        tradingDay: day('2026-11-04'),
        openingBalanceCents: 5_100_000n,
        realizedPnlCents: 0n,
        lowBalanceCents: 5_099_999n,
        adjustmentCents: -250_000n,
      },
      [settlement],
    );
    expect(drifted.state.breached).toBe(true);
    expect(drifted.state.breachKind).toBe('trailing_eod_floor');
  });

  it('no v1 plan can reach CV-17, which is why it is validated rather than remembered', () => {
    // M01's own justification, and the clause that makes GS-083 exist: "No v1
    // plan can reach this (all three enable the lock, and CV-11 covers that
    // case), which is exactly why it has to be validated rather than
    // remembered." The precondition is `size.floor_lock_enabled`, so the claim
    // is checkable on the three published rows directly.
    for (const size of [CORE_50K_SIZE, RAPID_50K_SIZE, DIRECT_50K_SIZE]) {
      expect(size.floor_lock_enabled).toBe(true);
    }

    // AND THE LINEUP CLEARS THE INEQUALITY TOO, WHICH IS A SECOND MARGIN AND NOT
    // THE ONE M01 CITES. Core 150,000 < 250,000, Rapid 100,000 < 250,000, Direct
    // 150,000 < 200,000 (A.3's 400bp drawdown). So turning the lock off on a v1
    // plan does NOT trip CV-17, and it does not need to: the caps already
    // satisfy it. CV-17 evaluated and passed is the rule doing its job on a
    // config nobody publishes, which is a different thing from the rule being
    // unreachable, and the difference is what a `not.toContain` on an unrelated
    // plan would hide.
    const unlockedCore = validatePlan(
      coreRules({
        funded: {
          drawdown: {
            type: 'trailing_eod',
            amount_bp: 500,
            lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
          },
        },
      }),
      [
        coreSize({
          floor_lock_enabled: false,
          floor_lock_at_profit_cents: null,
          floor_lock_floor_at_cents: null,
        }),
      ],
    );
    expect(unlockedCore.errors).toEqual([]);
    expect(unlockedCore.materialization).toEqual([]);
    expect(unlockedCore.ok).toBe(true);
  });
});
