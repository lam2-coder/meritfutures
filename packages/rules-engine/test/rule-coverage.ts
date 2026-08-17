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
  'R-01':
    'a fill belongs to the session containing it, and no value the fold reads carries an instant',
  'R-02':
    'counters advance only on trading days and whether or not the trader traded, and a gap is `sequence` subtraction',
  'R-03': 'a half day is a full trading day for every counter, and reaches no comparison',
  'R-04': 'on a halted session the day counters advance and win days do not',
  'R-05':
    'session bounds are stored UTC instants, and a `CalendarDay` carries neither one nor a zone',
  'R-06':
    'the fold is strictly forward, so the day already closed is never re-evaluated and no later one is seen',
  'R-07': 'opening == prior.balance + adjustment, and a failure refuses the day (INV-18)',
  'R-08': 'a traded day is fill_count > 0, strict',
  'R-09': 'a win day is realized_pnl_cents >= win_day_floor_cents, so exactly at the floor counts',
  'R-10':
    'the adjustment is on INV-18’s OPENING side and absent from INV-19, so it is never inside a session',
  'R-11':
    'the engine reads only live marks, and it does so by having no way to name a superseded one',
  'R-12': 'the initial floor is size_cents - drawdown_cents',
  'R-13': 'the trailing floor follows the CLOSING balance and never the intraday high',
  'R-14': 'the floor never retreats, and an attempt to lower it throws INV-06',
  'R-15':
    'the lock engages at closing - size >= at_profit_cents, is permanent, and never lowers the trailed floor',
  'R-16': 'a static drawdown holds floor = size_cents - drawdown_cents for life',
  'R-17':
    'intraday trailing is unimplemented, and `DrawdownType` is the closed union that makes it unrepresentable',
  'R-18': 'the breach comparator is the floor AT THE OPEN, trailed strictly afterwards',
  'R-19': 'a settlement writes NONE of the floor, the high-water balance or the lock (ADR-014)',
  'R-20':
    'the setpoint equals the CURRENT floor, which `day.closed` carries on every day and the engine never pushes',
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
  'R-32':
    'a plan that sets `max_days` REFUSES the day, because the anchor and the authoritative column are unruled',
  'R-33': 'the funded minimum-days gate is >=, and a configured zero DISABLES it (skipped)',
  'R-34': 'the win-day gate is winDaysCount >= required_count, so exactly at it passes',
  'R-35':
    'withdrawable is max(0, balance - size - buffer), floored at zero, and the buffer is never in it',
  'R-36': 'funded consistency delays eligibility and shares R-29 with the eval variant',
  'R-37': 'the cadence gap is >= by sequence subtraction, and an unanswerable anchor refuses',
  'R-38': 'one payout in flight, on the EXTERNAL leg only, and it binds through context',
  'R-39': 'the minimum payout is min(withdrawable, cap) >= 10000, so exactly 100.00 is eligible',
  'R-41': 'engineEligible is the conjunction of every engine gate, with no shortcut path',
  'R-40': 'the context gates are account active and funded, KYC verified, not frozen, recon clear',
  'R-42': 'the cap is the LAST schedule entry whose from_ordinal <= ordinal',
  'R-43': 'approved is min(effective_request, cap, withdrawable), and a tie names no term',
  'R-44': 'the split ceilings to the trader and the legs sum to approved exactly',
  'R-45': 'the ordinal is payoutsSettledCount + 1, so a failed attempt consumes none',
  'R-46': 'settlement advances BOTH anchors, the basis day and the wallet-credit day',
  'R-47': 'win days and the consistency period reset to the day STRICTLY AFTER the basis day',
  'R-48': 'the floor is untouched by settlement, which is R-19 from the settlement side',
  'R-49': 'the ladder graduates at payoutsSettledCount >= max_payouts, >=, and emits no invitation',
  'R-50': 'lifetime settled accumulates every approved amount, which INV-17 bounds',
} as const satisfies Partial<Record<RuleId, string>>;

/**
 * The rules whose `RE-U-nn` asserts an ABSENCE OR A REFUSAL rather than an
 * operator, and the reason each one is not in `IMPLEMENTED_RULES`.
 *
 * THE TWO SERIES ARE NOT THE SAME SET AND THEY NEVER WERE. M01 section 8.4's
 * coverage rule is over ALL FIFTY rules ("every rule R-01 to R-50 has at least
 * one unit test"), and ADR-048's declared set is over the rules THE ENGINE
 * COMPUTES, which it defines against the opposite failure: "a rule is
 * implemented when the engine computes it, not when a symbol exists". A rule the
 * engine cannot compute still owes a test, and that test's job is to say WHY it
 * cannot, in a form that fails when the reason stops being true.
 *
 * That is RE-U-019's idiom, which the corpus already accepts: "an absence is the
 * one kind of rule a reader cannot check by finding the line". The difference
 * here is that R-19's absence is discharged INSIDE the engine and these are
 * discharged outside it, so they carry a title and no declaration.
 *
 * WHAT WOULD MAKE ONE OF THESE MOVE, stated per row rather than left to a reader
 * to guess, because the previous version of this list had two rows filed against
 * a blocker that would not have unblocked them.
 */
export const DISCHARGED_ELSEWHERE = {
  'R-01':
    'ingest. `DailyMark` carries `fillCount` and no fill, so there is no execution timestamp to contain and no cast to refuse. A transcribed calendar does not change that: it adds rows, not a column on `CalendarDay`',
  'R-05':
    '`trading_calendar.session_open_at` and `session_close_at`, and `0032`’s constraints over them. `CalendarDay` carries neither column, so the timezone conversion R-05 forbids is unwritable here rather than merely unwritten',
  'R-11':
    'the caller’s `superseded_by is null` predicate, and replay recomputing forward. `DailyMark` carries no supersession field, so there is no branch a superseded mark could take and no check the engine could add without a new column',
  'R-17':
    'CV-01 at publish, in `validatePlan`, which is P2-1’s and does not exist yet. What holds it today is stronger and is in this package: `DrawdownType` has two members, so an `intraday_trailing` plan is a compile error rather than a rejected config',
  'R-32':
    'nothing, and that is the finding rather than the blocker. The refusal is implemented and asserted; what is unruled is R-32’s ANCHOR (neither it nor `G-EXPIRED` names the day the trading days elapse from) and WHICH COLUMN BINDS (a count against `max_days`, or the stored `accounts.expires_on` date). Both are founder rulings',
  'R-20':
    'M02’s setpoint push (`DEP-M2-03`), and the engine performs no I/O. What it owes is the number, and `day.closed.floorCents` is the state’s own floor on every day, quiet ones included',
} as const satisfies Partial<Record<RuleId, string>>;

/**
 * The rules this suite claims the ENGINE COMPUTES. `implemented-rules.test.ts`
 * compares it to `IMPLEMENTED_RULES`, and compares `RULE_ASSERTIONS` against all
 * fifty separately, because those are two different claims.
 */
export const COVERED_RULES = (Object.keys(RULE_ASSERTIONS) as readonly RuleId[]).filter(
  (rule) => !(rule in DISCHARGED_ELSEWHERE),
);

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
