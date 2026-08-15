// =============================================================================
// packages/golden-loader/src/run.ts
// =============================================================================
// The fold, and the one import of the engine in this package.
//
// `@merit/rules-engine` resolves through that package's `exports` map, which
// publishes `.` and nothing else. There is no path from here to
// packages/rules-engine/src/anything-else, which is P1 section 2.2's structural
// obligation discharged by the module resolver rather than by a convention:
// "the loader reads a directory and imports the engine's public entry point
// only".

import { evaluate } from '@merit/rules-engine';
import type {
  AccountState,
  EngineResult,
  PlanConfigVersion,
  TradingDay,
} from '@merit/rules-engine';

import { diffEndState, diffEvents, type Diff } from './compare.js';
import type { GoldenFixture } from './loader.js';

export interface FixtureOutcome {
  readonly fixture: GoldenFixture;
  readonly result: EngineResult;
  /** Empty when the engine agrees with the fixture on every field it pins. */
  readonly diffs: readonly Diff[];
}

/** Fold one fixture's day stream through the engine and diff the end state. */
export function runFixture(fixture: GoldenFixture): FixtureOutcome {
  const result = evaluate(fixture.input);
  const state = result.newState as unknown as Readonly<Record<string, unknown>>;

  return {
    fixture,
    result,
    diffs: [
      ...diffEndState(state, fixture.expected.end_state),
      ...diffEvents(result.events, fixture.expected.events),
    ],
  };
}

// -----------------------------------------------------------------------------
// The polarity of the golden assertions is DERIVED, not declared
// -----------------------------------------------------------------------------
// TR-02: "Tests first on any money path. The fixture exists, and FAILS, before
// the function does." packages/rules-engine ships the identity evaluation, so
// every fixture here is in that window and every one of them must currently
// fail. STRATEGY section 1 is equally clear that a permanently red required
// stage is worse than a smaller one nobody clicks through.
//
// SO CI-03 ASSERTS THE FAILURE INSTEAD OF SUFFERING IT, and the direction is
// read off the engine rather than set by a flag in a fixture. A per-fixture
// `pending: true` would be the weakening TR-03 forbids: the escape hatch a
// future session reaches for at 11pm when one scenario will not go green.
//
// Under the stub, a fixture that MATCHES is the failure, because a fixture
// matching an engine that computes nothing is a fixture that pins nothing. When
// M01 lands, this probe stops holding, the polarity flips, and every fixture
// becomes a live assertion WITH NO FIXTURE EDITED AND NO FLAG REMOVED.
//
// WHAT THE PROBE DOES NOT COVER, stated rather than implied: an engine that
// returns its input state by reference AND emits no event for a day that moves
// the floor would be read as the stub. That engine is broken in a way GS-009
// and GS-011 both fail on the moment the polarity flips, so the failure mode is
// a loud one rather than a silent pass.

const PROBE_PLAN = { planVersionId: 'probe' } as unknown as PlanConfigVersion;
const PROBE_STATE = {
  accountId: 'probe',
  planVersionId: 'probe',
  sizeCents: 5_000_000,
} as unknown as AccountState;

/**
 * `true` while `evaluate` is still the scaffold's identity function.
 *
 * The probe supplies one day that closes above the opening balance, which any
 * implemented engine must react to: the trailing floor moves by R-13 and the
 * day closes by the day-outcome sequence in M01 section 3.4.
 */
export function engineIsIdentityStub(): boolean {
  const probe = evaluate({
    planConfigVersion: PROBE_PLAN,
    accountState: PROBE_STATE,
    dayMarks: [
      {
        tradingDay: '2026-11-03' as TradingDay,
        openingBalanceCents: 5_000_000,
        closingBalanceCents: 5_020_000,
        highBalanceCents: 5_090_000,
        lowBalanceCents: 4_995_000,
        realizedPnlCents: 20_000,
        fillCount: 4,
        tradedDay: true,
      } as never,
    ],
  });

  return probe.newState === PROBE_STATE && probe.events.length === 0;
}
