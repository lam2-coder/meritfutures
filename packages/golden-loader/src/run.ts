// =============================================================================
// packages/golden-loader/src/run.ts
// =============================================================================
// THE FOLD, AND IT IS NOW A FOLD. This file called `evaluate`, the scaffold's
// identity stub, so thirty fixtures diffed the output of `return { newState:
// input.accountState, events: [] }` and CI-03's end-to-end half was vacuous.
// ADR-038 recorded it and `describe.runIf(!declaration.holds)` was written to
// survive it; this session removes the reason for both.
//
// `advanceDay` IS WHAT M01 SECTION 3.1 SPECIFIES AND WHAT THE DECLARED RULES
// LIVE IN. The fold below is the loop STRATEGY section 3.2 describes in one
// sentence: the day stream, in order, carrying the state.
//
// `@merit/rules-engine` resolves through that package's `exports` map, which
// publishes `.` and nothing else. There is no path from here to
// packages/rules-engine/src/anything-else, which is P1 section 2.2's structural
// obligation discharged by the module resolver rather than by a convention.
//
// -----------------------------------------------------------------------------
// TWO DECISIONS IN THE LOOP, BOTH VISIBLE IN WHAT A FAILING FIXTURE REPORTS
// -----------------------------------------------------------------------------
// A REFUSAL STOPS THE FOLD. `DayOutput.assertions` is non-empty exactly when no
// state was written for the day (FM-05), and the state it carries is "the state
// the fold arrived with". Folding on would mean folding tomorrow against a state
// today declined to produce. So the fold stops, the outcome names the day and
// the assertion, and the diff is taken against the last state the engine
// actually wrote.
//
// THE EVENTS ARE ACCUMULATED ACROSS THE WHOLE STREAM, not taken from the last
// day. `expected.events` is an ordered sequence for the scenario, and a
// multi-day fixture pins events emitted on different days.
// =============================================================================

import { advanceDay, initialState } from '@merit/rules-engine';
import type {
  AssertionFailure,
  BasisPoints,
  EngineEvent,
  PlanVersionId,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '@merit/rules-engine';
import { buildCalendarSlice } from '@merit/rules-engine';

import { diffEndState, diffEvents, type Diff } from './compare.js';
import type { GoldenFixture } from './loader.js';

/**
 * The `engine_version` every fixture folds under.
 *
 * IT NAMES THE STAGE RATHER THAN A BUILD. Replay scopes divergence detection to
 * rows computed under the running version (M01 Appendix B.4), and a loader
 * reading a package version would be claiming these rows came from one.
 */
export const GOLDEN_ENGINE_VERSION = 'ci-03-golden';

export interface FixtureOutcome {
  readonly fixture: GoldenFixture;
  /** The last state the engine WROTE. On a refusal, the day before the refusal. */
  readonly state: RuleState;
  readonly events: readonly EngineEvent[];
  /** Non-empty exactly when a day refused, in which case the fold stopped there. */
  readonly assertions: readonly AssertionFailure[];
  /** The day that refused, or `null`. */
  readonly refusedOn: string | null;
  /** Empty when the engine agrees with the fixture on every field it pins. */
  readonly diffs: readonly Diff[];
}

/**
 * The state the account is in before the first mark.
 *
 * THE FUNDED START IS `initialState` AGAINST A PLAN WITH NO EVALUATION PHASE,
 * AND THAT IS A CHOICE OF ARGUMENT RATHER THAN A REIMPLEMENTATION. `initialState`
 * opens an account in `funded` exactly when `plan.eval === null`, which is
 * Direct (Appendix A.3), and it then takes its floor from `plan.eval ??
 * plan.funded`, which is the FUNDED drawdown. Every field of the funded start
 * therefore comes out of the engine's own arithmetic: the loader picks which
 * plan shape the account is opened against and computes nothing.
 *
 * THE ALTERNATIVE WAS TO BUILD THE STATE HERE, and it is the one thing this
 * package may not do. A loader writing `floorCents: size - drawdown` has
 * implemented R-12, and a fixture graded against it would be checking the engine
 * against the loader's reading of the rule rather than against the document's.
 */
function openingState(fixture: GoldenFixture): RuleState {
  const { plan, openedOn, startingPhase } = fixture.input;

  if (startingPhase === 'funded' && plan.eval !== null) {
    return initialState({ ...plan, eval: null }, openedOn, GOLDEN_ENGINE_VERSION);
  }
  return initialState(plan, openedOn, GOLDEN_ENGINE_VERSION);
}

/** Fold one fixture's day stream through the engine and diff the end state. */
export function runFixture(fixture: GoldenFixture): FixtureOutcome {
  const { plan, marks, settlements, startingPhase } = fixture.input;

  // THE SLICE IS CONSTRUCTED HERE AND NOT IN THE LOADER, and the boundary is the
  // falsification harness's rather than a preference. `check.mjs` imports
  // `./src/loader.ts` in a tree copy that has no `node_modules`, so nothing
  // reachable from the loader may import the engine as a VALUE.
  // `buildCalendarSlice` is one, this module already holds several, and ADR-049
  // still requires the slice to come from its own pure constructor.
  const calendar = buildCalendarSlice(fixture.input.calendar);

  const opening = openingState(fixture);
  let state: RuleState = opening;

  // `prior` IS NULL ON AN EVAL FIXTURE'S FIRST DAY, AND THE ASYMMETRY IS THE
  // ENGINE'S. `advanceDay` reads `input.prior ?? initialState(plan,
  // mark.tradingDay, engineVersion)` and skips the INV-14 forward check when the
  // prior is null, which is its designed entry path for an account being opened:
  // a brand-new account may be folded on its own opening day. A funded start has
  // no such path, because `initialState` cannot open an account in `funded` on a
  // plan that has an evaluation phase, so a funded fixture is handed an explicit
  // prior anchored at `opened_on` and its first mark must be strictly after it.
  let prior: RuleState | null = startingPhase === 'funded' ? opening : null;

  const events: EngineEvent[] = [];
  let assertions: readonly AssertionFailure[] = [];
  let refusedOn: string | null = null;

  for (const mark of marks) {
    const output = advanceDay({
      engineVersion: GOLDEN_ENGINE_VERSION,
      plan,
      prior,
      mark,
      calendar,
      settlements,
    });

    events.push(...output.events);

    if (output.assertions.length > 0) {
      assertions = output.assertions;
      refusedOn = mark.tradingDay;
      break;
    }

    state = output.state;
    prior = output.state;
  }

  const asRecord = state as unknown as Readonly<Record<string, unknown>>;

  return {
    fixture,
    state,
    events,
    assertions,
    refusedOn,
    diffs: [
      ...diffEndState(asRecord, fixture.expected.end_state),
      ...diffEvents(events, fixture.expected.events),
    ],
  };
}

// -----------------------------------------------------------------------------
// THE PROBE, WHICH NOW PROBES THE FUNCTION THE STAGE ACTUALLY FOLDS
// -----------------------------------------------------------------------------
// ADR-048 retired this as the SOURCE of polarity: it was global and
// all-or-nothing, so the moment the first rule landed the whole directory
// flipped to `direct` at once, including fixtures for rules not yet written.
// Polarity is derived per fixture in ./polarity.ts.
//
// WHAT IT STILL DOES IS THE CROSS-CHECK ITS OLD HEADER WARNED ABOUT, and until
// this commit that warning was the repository's actual condition: rules were
// implemented in `advanceDay` with passing `RE-U-nn` tests, and the function
// this stage folded was `evaluate`, which computes none of them. The
// declaration was true of the PACKAGE and false of the FOLD.
//
// SO THE PROBE HAD TO MOVE WITH THE FOLD. A probe still calling `evaluate` would
// report the fold as the identity forever, `declaration.holds` would stay false,
// and the derived assertions would never switch on: the stage would sit in its
// own escape hatch with nothing left to escape.
//
// NO NUMBER BELOW DECIDES ANYTHING. The probe asks one question -- does the
// folded function return its input by reference and emit nothing -- and every
// value exists only to make a fold legal. It consults no fixture, exactly as
// ADR-048 says a declaration check should.

const PROBE_DAY = '2026-11-03' as TradingDay;

/** A plan shaped only so `advanceDay` will run. Not a config and not a lineup plan. */
const PROBE_PLAN: ResolvedPlan = {
  planVersionId: 'probe' as PlanVersionId,
  sizeCents: 1_000_000n,
  eval: null,
  funded: {
    drawdown: { type: 'trailing_eod', drawdownCents: 100_000n, lock: { enabled: false } },
    dailyLossLimit: { type: 'none' },
    winDayFloorCents: 1_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 1,
    consistency: { enabled: false },
    bufferCents: 0n,
    cadenceGapTradingDays: 1,
    payoutCapSchedule: [{ fromOrdinal: 1, capCents: 100_000n }],
    minPayoutCents: 1_000n,
    splitBp: 9_000 as BasisPoints,
    maxPayouts: 1,
  },
};

const PROBE_CALENDAR = buildCalendarSlice({
  days: [{ tradingDay: PROBE_DAY, isHalfDay: false, halted: false, sequence: 1 }],
  coverage: { from: PROBE_DAY, to: PROBE_DAY },
});

/**
 * `true` while the folded function returns its input by reference and emits
 * nothing.
 *
 * The probe supplies one day that closes above the opening balance, which any
 * implemented engine must react to: the trailing floor moves by R-13 and the day
 * closes by the day-outcome sequence in M01 section 3.4.
 *
 * NO LONGER THE POLARITY. It is one input to the declaration cross-check in
 * ./polarity.ts and has no other caller.
 */
export function engineIsIdentityStub(): boolean {
  const prior = initialState(PROBE_PLAN, '2026-11-02' as TradingDay, 'probe');

  const output = advanceDay({
    engineVersion: 'probe',
    plan: PROBE_PLAN,
    prior,
    mark: {
      tradingDay: PROBE_DAY,
      openingBalanceCents: 1_000_000n,
      closingBalanceCents: 1_020_000n,
      highBalanceCents: 1_090_000n,
      lowBalanceCents: 995_000n,
      realizedPnlCents: 20_000n,
      adjustmentCents: 0n,
      fillCount: 4,
      sourceHash: 'probe',
    },
    calendar: PROBE_CALENDAR,
    settlements: [],
  });

  return output.state === prior && output.events.length === 0;
}
