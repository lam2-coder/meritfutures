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
// THE GLOBAL PROBE IS SUPERSEDED AND SURVIVES AS ONE INPUT TO A CROSS-CHECK
// -----------------------------------------------------------------------------
// ADR-048 retired this as the source of polarity. It was global and
// all-or-nothing, so the moment the first rule landed the whole directory
// flipped to `direct` at once, including fixtures for rules not yet written,
// and M01 is fifty rules across eight groups that cannot land in one commit
// under ADR-003. Polarity is now derived PER FIXTURE in ./polarity.ts, from the
// rules each fixture cites against the set the engine declares.
//
// WHAT THE PROBE STILL DOES IS THE THING ITS OLD HEADER WARNED ABOUT. That
// header named a case it could not cover: "an engine that returns its input
// state by reference AND emits no event for a day that moves the floor would be
// read as the stub". ADR-048 says the warning is "still worth a comment where
// the new derivation lives", and it turned out to be worth more than a comment.
// Paired with the engine's declared rule count it is a CONTRADICTION DETECTOR:
// a fold that behaves as the identity while the engine declares rules it
// implements means the declaration is true of the package and false of the
// function this stage folds. `checkDeclarationAgainstFold` is where that is
// read, and it consults no fixture, exactly as ADR-048 says a declaration check
// should.
//
// A PER-FIXTURE `pending: true` REMAINS THE WEAKENING TR-03 FORBIDS: the escape
// hatch a future session reaches for at 11pm when one scenario will not go
// green. Nothing here or in ./polarity.ts is written in a fixture at all.

const PROBE_PLAN = { planVersionId: 'probe' } as unknown as PlanConfigVersion;
const PROBE_STATE = {
  accountId: 'probe',
  planVersionId: 'probe',
  sizeCents: 5_000_000,
} as unknown as AccountState;

/**
 * `true` while the folded function returns its input by reference and emits
 * nothing, which is what `evaluate` still does.
 *
 * The probe supplies one day that closes above the opening balance, which any
 * implemented engine must react to: the trailing floor moves by R-13 and the
 * day closes by the day-outcome sequence in M01 section 3.4.
 *
 * NO LONGER THE POLARITY. It is one input to the declaration cross-check in
 * ./polarity.ts and has no other caller.
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
