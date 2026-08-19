// =============================================================================
// packages/rules-engine/test/property-harness.ts
// =============================================================================
// THE FOLD `PT-04` AND `PT-07` SHARE, AND NOTHING ELSE.
//
// This file is not a `.test.ts`, so it registers with no Vitest project in
// `vitest.config.ts` and is only ever imported.
//
// -----------------------------------------------------------------------------
// THE THREE ADAPTERS IT ONCE CARRIED NOW LIVE IN `generator-bridge.ts`
// -----------------------------------------------------------------------------
// `materializedFrom`, `toEngineMark` and `sliceOf` were written here because
// `floor-monotonicity.property.test.ts` carried them as PRIVATE copies session
// 62's fence forbade extracting. Session 74 collapsed all four copies into
// `generator-bridge.ts` and this file imports them from there. The twelve
// definitions were diffed before the collapse and were behaviourally identical;
// the bridge's header records the one difference that had to be ruled on.
//
// `fold` (`floor-monotonicity.property.test.ts` line 299) was NOT collapsed and
// neither was `foldSequence` below. The folds carry genuinely different shapes
// and merging them is a different argument than merging three adapters.
//
// -----------------------------------------------------------------------------
// IT IS BUILT FOR TWO CALLERS AND MUST NOT BE GENERALISED FOR MORE
// -----------------------------------------------------------------------------
// `PT-04` and `PT-07` are its callers and the settlement-driven properties have
// their own peer harness in `settlement-fold.ts`. Widening this one to serve
// them would make one harness the parent of its sibling, which is the
// speculative abstraction Appendix F2's rule of three warns about; the shared
// adapters went to a THIRD peer for exactly that reason. `foldSequence`
// therefore carries no settlement stream, because neither `PT-04` nor `PT-07` is
// stated over one.
// =============================================================================

import { advanceDay } from '../src/index.js';
import type { DailyMark, DayOutput, ResolvedPlan, RuleState, TradingDay } from '../src/index.js';
import type { DaySequence } from './generators/day-input.js';
import { sliceOf, toEngineMark } from './generator-bridge.js';

/** One folded day, carrying what both properties read. */
export interface FoldStep {
  readonly tradingDay: TradingDay;
  /** The state the day started from. `null` only on a fold that began with no prior. */
  readonly priorState: RuleState | null;
  readonly mark: DailyMark;
  readonly state: RuleState;
}

export interface FoldResult {
  readonly steps: readonly FoldStep[];
  /** The day the fold stopped on, or `null` if every mark folded. */
  readonly endedOn: { readonly tradingDay: TradingDay; readonly kind: string } | null;
}

export interface FoldOptions {
  /**
   * The state to fold from. `null` lets `advanceDay` build the open state, which
   * starts in the eval phase on any plan carrying one (`advance.ts` line 99).
   */
  readonly prior: RuleState | null;
  readonly engineVersion: string;
  readonly openedOn: TradingDay;
}

/**
 * Fold a generated sequence, stopping at the first day the engine refuses.
 *
 * FOLDING PAST A REFUSAL WOULD BE READING A STATE THE ENGINE DECLINED TO WRITE.
 * `PT-01` stops for the same reason and records it: no state is written for a
 * refused day, so the account's history ends there and anything compared past it
 * is compared against a `prior` that never advanced.
 */
export function foldSequence(
  plan: ResolvedPlan,
  seq: DaySequence,
  options: FoldOptions,
): FoldResult {
  const calendar = sliceOf(seq);
  const steps: FoldStep[] = [];
  let prior: RuleState | null = options.prior;

  for (const generated of seq.marks) {
    const mark = toEngineMark(generated);
    const out: DayOutput = advanceDay({
      engineVersion: options.engineVersion,
      plan,
      prior,
      mark,
      calendar,
      settlements: [],
      openedOn: options.openedOn,
    });

    if (out.assertions.length > 0) {
      return {
        steps,
        endedOn: {
          tradingDay: mark.tradingDay,
          kind: out.assertions.map((a) => a.kind).join(', '),
        },
      };
    }

    steps.push({ tradingDay: mark.tradingDay, priorState: prior, mark, state: out.state });
    prior = out.state;
  }

  return { steps, endedOn: null };
}
