// =============================================================================
// packages/rules-engine/test/generators/plan.ts
// =============================================================================
// THE PLAN GENERATOR. P2 section 5: "arbitrary plans satisfying CV-01 to CV-19.
// A generator that emits only valid plans is the config contract made
// executable, it depends on nothing but the ruled parameter set, and every one
// of the eight consumes it."
//
// It builds valid plans BY CONSTRUCTION and never by rejection sampling.
// `fc.filter` over a 19-rule contract would discard almost every candidate,
// shrink badly, and — the part that matters — would make the generator's
// correctness an accident of the filter rather than a property of the
// construction. Every step below states the rule it satisfies.
//
// -----------------------------------------------------------------------------
// THE `omit` PARAMETER IS THE POINT, NOT A CONVENIENCE
// -----------------------------------------------------------------------------
// A generator asserted to emit only valid plans, never watched emitting an
// invalid one, is vacuous: `fc.constant(SOME_KNOWN_GOOD_PLAN)` passes that
// assertion forever. So every rule's construction step is individually
// removable, and `plan.property.test.ts` watches each removal produce a plan
// the ORACLE rejects, citing that rule.
//
// When a rule is omitted the step does not merely relax, it INVERTS: it draws
// from values that always violate. A relaxed step would sometimes still emit a
// valid plan, and a counterfactual that only sometimes fires is one that will
// eventually be quarantined as flaky and deleted.
//
// -----------------------------------------------------------------------------
// SCOPE, AND WHAT IS DELIBERATELY ABSENT
// -----------------------------------------------------------------------------
// THE PLAN GENERATOR ONLY. The arbitrary day-sequence and settlement-sequence
// generators P2 section 5 names alongside this one are NOT here: they depend on
// `DayInput`'s shape, which OQ-P2-01 is about to widen, and building them now
// means building them twice.
// =============================================================================

import fc from 'fast-check';

import type {
  CapScheduleStep,
  Consistency,
  DailyLossLimit,
  Drawdown,
  MaterializedPlan,
} from './plan-config.js';
import type { CvId } from './validate-plan.js';

/**
 * The four ruled sizes, from M01 Appendix A: "25K is 2,500,000c, 50K is
 * 5,000,000c, 100K is 10,000,000c, 150K is 15,000,000c."
 *
 * They are drawn alongside arbitrary sizes rather than instead of them. A
 * generator that only ever emits the four shipped sizes would pass every
 * property while proving nothing about the contract, since CV-11 and CV-12 are
 * inequalities in `size_cents` and the shipped four satisfy them comfortably.
 */
export const RULED_SIZES_CENTS: readonly number[] = [2_500_000, 5_000_000, 10_000_000, 15_000_000];

/** CV-15's fixed value. Never scaled by size (GLOSSARY, and Appendix A restates it). */
const MIN_PAYOUT_CENTS = 10_000;

export interface PlanArbitraryOptions {
  /**
   * Rules whose construction step is INVERTED, so the emitted plan violates
   * them. Empty in every ordinary use; non-empty only in the counterfactual.
   */
  readonly omit?: ReadonlySet<CvId>;
}

const has = (omit: ReadonlySet<CvId>, id: CvId): boolean => omit.has(id);

// -----------------------------------------------------------------------------
// Leaf arbitraries
// -----------------------------------------------------------------------------

const sizeCents = (): fc.Arbitrary<number> =>
  fc.oneof(fc.constantFrom(...RULED_SIZES_CENTS), fc.integer({ min: 100_000, max: 100_000_000 }));

const consistency = (
  omit: ReadonlySet<CvId>,
  mode: Consistency['mode'],
): fc.Arbitrary<Consistency> => {
  if (has(omit, 'CV-06')) {
    // Always enabled, always out of range: 0 is unsatisfiable and >10000 is
    // meaningless, and `null` under an enabled gate is the third way to fail it.
    return fc
      .oneof(
        fc.constant(0),
        fc.integer({ min: 10_001, max: 50_000 }),
        fc.constant(null as unknown as number),
      )
      .map((bp) => ({ enabled: true, max_day_share_bp: bp, mode }));
  }
  return fc.oneof(
    fc.constant<Consistency>({ enabled: false, max_day_share_bp: null, mode }),
    // CV-06: 0 < bp <= 10000 when enabled.
    fc
      .integer({ min: 1, max: 10_000 })
      .map((bp) => ({ enabled: true, max_day_share_bp: bp, mode }) as Consistency),
  );
};

const dailyLossLimit = (omit: ReadonlySet<CvId>): fc.Arbitrary<DailyLossLimit> => {
  if (has(omit, 'CV-16')) {
    return fc.oneof(
      // A type outside the vocabulary.
      fc.constant<DailyLossLimit>({
        type: 'intraday' as DailyLossLimit['type'],
        amount_cents: 5_000,
      }),
      // In-vocabulary but not `none`, with the amount CV-16 requires missing.
      fc.constantFrom<DailyLossLimit['type']>('soft', 'hard').map((type) => ({
        type,
        amount_cents: null,
      })),
    );
  }
  return fc.oneof(
    fc.constant<DailyLossLimit>({ type: 'none', amount_cents: null }),
    fc
      .tuple(
        fc.constantFrom<DailyLossLimit['type']>('soft', 'hard'),
        fc.integer({ min: 1, max: 5_000_000 }),
      )
      .map(([type, amount_cents]) => ({ type, amount_cents })),
  );
};

/** CV-01's type, and the value it exists to refuse. */
const drawdownType = (omit: ReadonlySet<CvId>): fc.Arbitrary<Drawdown['type']> =>
  has(omit, 'CV-01')
    ? fc.constant('intraday_trailing')
    : fc.constantFrom<Drawdown['type']>('trailing_eod', 'static');

/** CV-02's amount. */
const drawdownCents = (omit: ReadonlySet<CvId>, min: number): fc.Arbitrary<number> =>
  has(omit, 'CV-02')
    ? fc.oneof(fc.constant(0), fc.integer({ min: -5_000_000, max: -1 }))
    : fc.integer({ min, max: 5_000_000 });

// -----------------------------------------------------------------------------
// The plan
// -----------------------------------------------------------------------------

/**
 * An arbitrary published plan.
 *
 * With no options the emitted plan satisfies every one of CV-01 to CV-19, which
 * `plan.property.test.ts` asserts against the independent oracle rather than
 * against this module's own reasoning.
 */
export function planArbitrary(options: PlanArbitraryOptions = {}): fc.Arbitrary<MaterializedPlan> {
  const omit = options.omit ?? new Set<CvId>();

  // -------------------------------------------------------------------------
  // PRECONDITIONS ARE FORCED, NOT JUST CONSEQUENTS INVERTED
  // -------------------------------------------------------------------------
  // SIX of the nineteen rules are CONDITIONAL, and inverting the consequent of
  // a conditional rule proves nothing while its precondition is false.
  //
  // (This comment read "FIVE" above a list of six for the length of one commit,
  // which is the hand-maintained-count defect ADR-034 exists to end, committed
  // inside the file arguing that unverified claims are worthless. The list is
  // the authority; `PRECONDITIONS` in the test file is the executable copy, and
  // it is what fails if a seventh appears and nobody updates a prose count.)
  //
  //   CV-03  binds only when `phase_eval.enabled`
  //   CV-06  binds only when the consistency gate is enabled
  //   CV-11  binds only when the funded lock is enabled
  //   CV-12  binds only when the funded lock is enabled
  //   CV-16  binds only when the loss-limit type is not `none`
  //   CV-17  binds only when the drawdown is `trailing_eod` AND the lock is off
  //
  // THIS WAS FOUND BY THE COUNTERFACTUAL RATHER THAN BY READING. The first
  // version of this file forced the lock branch for CV-11, CV-12 and CV-17 and
  // left `evalEnabled` and the funded drawdown type free, so the CV-03 and
  // CV-17 cases drew a disabled eval phase and a `static` drawdown roughly half
  // the time and emitted a plan the oracle correctly accepted. **A vacuous
  // counterfactual is exactly the shape direction 2 exists to catch, and it
  // caught one in its own generator on the first run.**
  const lockEnabled: fc.Arbitrary<boolean> =
    has(omit, 'CV-11') || has(omit, 'CV-12')
      ? fc.constant(true)
      : has(omit, 'CV-17')
        ? fc.constant(false)
        : fc.boolean();

  // CV-17's other half of its precondition.
  const fundedDrawdownType = has(omit, 'CV-17')
    ? fc.constant<Drawdown['type']>('trailing_eod')
    : drawdownType(omit);

  return lockEnabled.chain((locked) =>
    fc
      .record({ size_cents: sizeCents(), fundedType: fundedDrawdownType })
      .chain(({ size_cents, fundedType }) => {
        // A DERIVED CONSTRAINT THE CV TABLE DOES NOT STATE, and it is load
        // bearing here rather than a remark. With the lock DISABLED and the
        // drawdown trailing, CV-17 requires every cap strictly BELOW the
        // drawdown while CV-10 requires every cap AT OR ABOVE min_payout. Both
        // can hold only if `drawdown_cents > min_payout_cents`. A generator that
        // drew the drawdown freely would produce unsatisfiable cap constraints
        // and either loop or emit an invalid plan.
        const capsBoundedByDrawdown = !locked && fundedType === 'trailing_eod';
        const minDrawdown =
          capsBoundedByDrawdown && !has(omit, 'CV-10') && !has(omit, 'CV-17')
            ? MIN_PAYOUT_CENTS + 1
            : 1;

        return drawdownCents(omit, minDrawdown).chain((funded_drawdown_cents) => {
          // CV-12 fixes the lock's engagement point in terms of this offset, and
          // CV-11 requires the buffer to exceed it. Appendix A ships offset =
          // 10,000 ("size + 10,000", X = $100) on all three plans; it is drawn
          // rather than fixed so the inequalities are exercised.
          const offsetArb = locked ? fc.integer({ min: 0, max: 200_000 }) : fc.constant(0);

          return offsetArb.chain((offset) => {
            // CV-07: buffer >= 0. CV-11, when locked: buffer > offset.
            const bufferArb = has(omit, 'CV-07')
              ? fc.integer({ min: -5_000_000, max: -1 })
              : locked && !has(omit, 'CV-11')
                ? fc.integer({ min: offset + 1, max: offset + 5_000_000 })
                : locked && has(omit, 'CV-11')
                  ? // Invert CV-11 while keeping CV-07 satisfied, so the
                    // counterfactual is attributable to one rule. Needs
                    // `offset >= 0`, which the arbitrary above guarantees.
                    fc.integer({ min: 0, max: offset })
                  : fc.integer({ min: 0, max: 5_000_000 });

            // CV-09, CV-10, CV-17.
            const capUpperExclusive = capsBoundedByDrawdown ? funded_drawdown_cents : Infinity;
            const capArb: fc.Arbitrary<number> = has(omit, 'CV-09')
              ? fc.oneof(fc.constant(0), fc.integer({ min: -1_000_000, max: -1 }))
              : has(omit, 'CV-10')
                ? // Below the minimum but still positive, so CV-09 holds and the
                  // finding is CV-10's alone.
                  fc.integer({ min: 1, max: MIN_PAYOUT_CENTS - 1 })
                : has(omit, 'CV-17')
                  ? // At or above the drawdown, which is what CV-17 refuses. Still
                    // >= min_payout so CV-10 holds.
                    fc.integer({
                      min: Math.max(MIN_PAYOUT_CENTS, funded_drawdown_cents),
                      max: Math.max(MIN_PAYOUT_CENTS, funded_drawdown_cents) + 1_000_000,
                    })
                  : fc.integer({
                      min: MIN_PAYOUT_CENTS,
                      max: capsBoundedByDrawdown
                        ? Math.max(MIN_PAYOUT_CENTS, capUpperExclusive - 1)
                        : 5_000_000,
                    });

            // The schedule is an array from day one (DATA_MODEL section 11), so
            // the generator emits multi-step schedules even though v1 ships one
            // step: CV-09's "ordinals strictly increase" is unreachable with a
            // single-element schedule and would never be exercised.
            const scheduleArb: fc.Arbitrary<readonly CapScheduleStep[]> = has(omit, 'CV-09')
              ? fc.oneof(
                  fc.constant<readonly CapScheduleStep[]>([]),
                  // Does not start at ordinal 1.
                  capArb.map((cap_cents) => [{ from_ordinal: 2, cap_cents }]),
                  // Ordinals do not strictly increase.
                  capArb.map((cap_cents) => [
                    { from_ordinal: 1, cap_cents },
                    { from_ordinal: 1, cap_cents },
                  ]),
                )
              : fc
                  .array(fc.tuple(fc.integer({ min: 1, max: 20 }), capArb), {
                    minLength: 1,
                    maxLength: 4,
                  })
                  .map((steps) => {
                    // Ordinals strictly increase and start at 1, by construction:
                    // the drawn gaps are accumulated onto a base of 1.
                    let ordinal = 1;
                    return steps.map(([gap, cap_cents], i) => {
                      if (i > 0) ordinal += gap;
                      return { from_ordinal: ordinal, cap_cents };
                    });
                  });

            return fc
              .record({
                buffer_cents: bufferArb,
                payout_cap_schedule: scheduleArb,
                // CV-03's precondition, forced when CV-03 is the target.
                evalEnabled: has(omit, 'CV-03') ? fc.constant(true) : fc.boolean(),
                evalType: drawdownType(omit),
                eval_drawdown_cents: drawdownCents(omit, 1),
                // CV-03: > 0 when the eval phase is enabled.
                profit_target_cents: has(omit, 'CV-03')
                  ? fc.constant(0)
                  : fc.integer({ min: 1, max: 5_000_000 }),
                // CV-04: >= 1.
                eval_min_trading_days: has(omit, 'CV-04')
                  ? fc.integer({ min: -10, max: 0 })
                  : fc.integer({ min: 1, max: 60 }),
                // CV-19: >= 0, and 0 disables the gate.
                funded_min_trading_days: has(omit, 'CV-19')
                  ? fc.integer({ min: -10, max: -1 })
                  : fc.integer({ min: 0, max: 60 }),
                // CV-05, both halves.
                win_required_count: has(omit, 'CV-05')
                  ? fc.integer({ min: -5, max: 0 })
                  : fc.integer({ min: 1, max: 30 }),
                win_day_floor_cents: has(omit, 'CV-05')
                  ? fc.constant(0)
                  : fc.integer({ min: 1, max: 500_000 }),
                // CV-08: >= 0.
                cadence_gap_trading_days: has(omit, 'CV-08')
                  ? fc.integer({ min: -30, max: -1 })
                  : fc.integer({ min: 0, max: 30 }),
                // CV-13: 0 < bp <= 10000.
                split_bp: has(omit, 'CV-13')
                  ? fc.oneof(fc.constant(0), fc.integer({ min: 10_001, max: 20_000 }))
                  : fc.integer({ min: 1, max: 10_000 }),
                // CV-14, ADR-030's canonical name.
                max_payouts: has(omit, 'CV-14')
                  ? fc.integer({ min: -5, max: 0 })
                  : fc.integer({ min: 1, max: 20 }),
                // CV-15: exactly 10,000.
                min_payout_cents: has(omit, 'CV-15')
                  ? fc.integer({ min: 10_001, max: 100_000 })
                  : fc.constant(MIN_PAYOUT_CENTS),
                // CV-18: `none`, retired but retained.
                post_payout_mode: has(omit, 'CV-18')
                  ? fc.constantFrom('reset_to_size', 'reset_to_balance')
                  : fc.constant('none'),
                eval_dll: dailyLossLimit(omit),
                funded_dll: dailyLossLimit(omit),
                eval_consistency: consistency(omit, 'pass_time_dilutable'),
                funded_consistency: consistency(omit, 'payout_gated'),
                max_days: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 365 })),
                reset_on_payout: fc.boolean(),
              })
              .map((r): MaterializedPlan => {
                // CV-12: at_profit == drawdown + (floor_at - size), exactly.
                const floor_at_cents = locked ? size_cents + offset : null;
                const at_profit_cents = locked
                  ? has(omit, 'CV-12')
                    ? funded_drawdown_cents + offset + 1 // off by one, deliberately
                    : funded_drawdown_cents + offset
                  : null;

                return {
                  schema_version: 1,
                  size_cents,
                  phase_eval: {
                    enabled: r.evalEnabled,
                    profit_target_cents: r.profit_target_cents,
                    drawdown: {
                      type: r.evalType,
                      drawdown_cents: r.eval_drawdown_cents,
                      // The eval lock is left disabled: CV-11 and CV-12 are
                      // stated against the funded phase, which is the phase that
                      // pays, and an eval lock would add a branch no rule reads.
                      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
                    },
                    daily_loss_limit: r.eval_dll,
                    min_trading_days: r.eval_min_trading_days,
                    consistency: r.eval_consistency,
                    max_days: r.max_days,
                  },
                  phase_funded: {
                    drawdown: {
                      type: fundedType,
                      drawdown_cents: funded_drawdown_cents,
                      lock: { enabled: locked, at_profit_cents, floor_at_cents },
                    },
                    daily_loss_limit: r.funded_dll,
                    min_trading_days: r.funded_min_trading_days,
                    win_days: {
                      required_count: r.win_required_count,
                      win_day_floor_cents: r.win_day_floor_cents,
                      reset_on_payout: r.reset_on_payout,
                    },
                    consistency: r.funded_consistency,
                    buffer_cents: r.buffer_cents,
                    cadence_gap_trading_days: r.cadence_gap_trading_days,
                    payout_cap_schedule: r.payout_cap_schedule,
                    min_payout_cents: r.min_payout_cents,
                    split_bp: r.split_bp,
                    max_payouts: r.max_payouts,
                    post_payout_floor_rule: { mode: r.post_payout_mode },
                  },
                };
              });
          });
        });
      }),
  );
}
