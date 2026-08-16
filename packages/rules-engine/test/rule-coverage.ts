// =============================================================================
// packages/rules-engine/test/rule-coverage.ts
// =============================================================================
// THE `RE-U-nn` SERIES, AND WHAT EACH ONE CLAIMS TO ASSERT.
//
// M01 section 8.4's coverage rule is not a percentage: "Every rule R-01 to R-50
// has at least one unit test asserting its operator at the boundary on both
// sides, and every rule whose operator could plausibly be written the other way
// (`>` versus `>=`, `<` versus `<=`) has a fixture pair."
//
// ADR-048 then makes that series load bearing beyond coverage: "The declared set
// is cross-checked against the PASSING `RE-U-nn` set, and a declared rule with
// no passing unit test fails the stage."
//
// THIS FILE IS THE HALF OF THAT CROSS-CHECK A UNIT SUITE CAN HOLD, AND ITS LIMIT
// IS STATED RATHER THAN IMPLIED. The map below is the single source of both the
// test titles (the group suites build their titles from it, so an entry with no
// test is an unused export and a test for an unclaimed rule cannot get a title)
// and of `implemented-rules.test.ts`'s comparison against `IMPLEMENTED_RULES`.
// WHAT IT DOES NOT PROVE is that a test asserts what its title says. Nothing
// inside a test file can prove that, which is why ADR-048 puts the real
// cross-check in the STAGE, against the passing set, and why the seeded mutants
// in `scripts/ci/falsify-ci.mjs` are what make these titles worth reading: a
// test that does not fail when its operator is flipped is a test that asserts
// nothing, and that is checkable from outside.
// =============================================================================

import type { RuleId } from '../src/rules.js';

/**
 * Rule id to the sentence its `RE-U-nn` test asserts, in the spelling M01
 * section 3.5's operator column uses.
 */
export const RULE_ASSERTIONS = {
  'R-03': 'a half day is a full trading day for every counter, and reaches no comparison',
  'R-04': 'on a halted session the day counters advance and win days do not',
  'R-07': 'opening == prior.balance + adjustment, and a failure refuses the day (INV-18)',
  'R-08': 'a traded day is fill_count > 0, strict',
  'R-09': 'a win day is realized_pnl_cents >= win_day_floor_cents, so exactly at the floor counts',
  'R-12': 'the initial floor is size_cents - drawdown_cents',
  'R-13': 'the trailing floor follows the CLOSING balance and never the intraday high',
  'R-14': 'the floor never retreats, and an attempt to lower it throws INV-06',
  'R-15': 'the lock engages at closing - size >= at_profit_cents, and is permanent',
  'R-16': 'a static drawdown holds floor = size_cents - drawdown_cents for life',
  'R-18': 'the breach comparator is the floor AT THE OPEN, trailed strictly afterwards',
  'R-21': 'a floor breach is low_balance_cents < floorOpen, strict: touching survives',
  'R-22':
    'a hard daily loss limit breaches at -realized_pnl > limit, strict: exactly at it survives',
  'R-23': 'a soft daily loss limit is never a breach and emits a fact',
  'R-24': 'breach is terminal: no state is ever advanced after it',
  'R-25': 'breach beats every other outcome the same day could also have had',
  'R-26': 'the eval target is closing - size >= profit_target_cents, so exactly at it passes',
  'R-27': 'the eval minimum-trading-days gate is tradedDaysCount >= min_trading_days',
  'R-28': 'an eval consistency violation DEFERS the pass and never fails the account',
  'R-29': 'consistency is best * 10000 <= max_bp * profit, cross multiplied, so a tie passes',
  'R-30': 'the denominator rule skips the gate unless period profit > 0, strict',
  'R-31': 'the eval pass resets the funded phase to size and carries no eval profit',
} as const satisfies Partial<Record<RuleId, string>>;

/** The rules this suite claims. `implemented-rules.test.ts` compares it to the engine's. */
export const COVERED_RULES = Object.keys(RULE_ASSERTIONS) as readonly RuleId[];

/**
 * The title of a rule's unit test: `RE-U-013  R-13  the trailing floor ...`.
 *
 * The `RE-U-nn` number is the rule's own number, which is what M01 section 8.1's
 * "50, one per rule R-01 to R-50" means and what makes the two series navigable
 * against each other without a table.
 */
export function reU(rule: keyof typeof RULE_ASSERTIONS): string {
  return `RE-U-0${rule.slice(2)}  ${rule}  ${RULE_ASSERTIONS[rule]}`;
}
