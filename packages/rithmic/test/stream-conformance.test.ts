import { expect, test } from 'vitest';

import { CANONICAL_SESSIONS, canonicalInput } from './canonical.ts';
import { simulate } from '../src/simulator/session.ts';
import { simulatorLiveFeed, StreamError } from '../src/simulator/stream.ts';
import { parseInstantUtc } from '../src/simulator/time.ts';
import type { LiveAccountTick } from '../src/simulator/stream.ts';
import type { PlatformAdapter, Subscription } from '../src/index.ts';
import type { SimSession } from '../src/simulator/types.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// THE TIER-2 CONFORMANCE SUITE, AND IT REPLACES A PROPERTY RATHER THAN COPYING
// ONE
// =============================================================================
// `GS-084` pins tier 1: "Simulator file and vendor file traverse the identical
// parser", asserted as "the simulator writes CSV into the ingest path and no
// downstream code branches on source". **That property has no tier-2 analogue
// and ADR-154 clause 4 forbids claiming one.** It is purchasable only where both
// sources write into one directory; with two implementations of one method
// there is nothing to branch on and nothing proved by saying so.
//
// What replaces it, in clause 4's words: "the assertion worth running is that
// every `streamLive` implementation emits ticks satisfying the same stated
// invariants (monotone `sequence` per account and trading day, `indicative:
// true`, `atUtc` inside the session bounds), RUN OVER EACH IMPLEMENTATION rather
// than asserted of the interface."
//
// -----------------------------------------------------------------------------
// WHY A SUITE AND NOT A TYPE. THE TYPE ALREADY SAYS MOST OF THIS
// -----------------------------------------------------------------------------
// `LiveAccountTick.indicative` is a required `true` literal and `equityCents` is
// `Cents`, so a TypeScript implementation cannot construct a violating tick
// without a cast. **A vendor implementation is not going to be constructing
// them**: it will be parsing them off a wire or out of a JSON body, where every
// field arrives as `unknown` and one `as` restores each guarantee by assertion.
// That is the reason the invariants are checked at runtime over delivered ticks
// rather than declared once at the interface, and it is the reason
// `equityCents` is checked for `bigint` here even though the type says so:
// `JSON.parse` returns `number` and the cast that hides it is one character.
//
// -----------------------------------------------------------------------------
// THE REGISTRY IS HONEST ABOUT WHAT IS IN IT
// -----------------------------------------------------------------------------
// Today it holds the simulator delivering in each of the two mechanisms
// `V-M2-16` names, PUSH and POLLED, which is one implementation and two
// cadences rather than two implementations. **Saying so is the point**: a suite
// that read as covering a vendor adapter while no vendor adapter exists is the
// class of defect `ADR-154` `F4` names one invariant over. `V-M2-16` is
// unanswered, M02 `OQ-M2-05` recommends shipping the simulator-backed layer
// regardless, and the vendor implementation joins this array on the day it
// exists.
// =============================================================================

/** The session window each trading day is asserted against, from the fixture. */
const WINDOWS = new Map<string, SimSession>(
  CANONICAL_SESSIONS.map((session) => [session.tradingDay, session]),
);

/**
 * Every way a delivered tick can violate the stated tier-2 invariants.
 *
 * Returns findings rather than throwing, so a failing implementation reports
 * every violation it has instead of the first one, and so the seeded-violation
 * tests below can drive THIS function rather than a copy of it.
 */
function violations(ticks: readonly LiveAccountTick[]): readonly string[] {
  const found: string[] = [];
  const lastSequence = new Map<string, number>();

  for (const tick of ticks) {
    const where = `${tick.tradingDay} ${tick.platformAccountRef} #${tick.sequence}`;

    // ADR-020: every surface is labeled at the point of use, and the label is
    // carried by the tick rather than looked up beside it.
    if (tick.indicative !== true) found.push(`${where}: indicative is not true`);

    // INV-02, and `stream.ts`'s own reason: a tick that narrowed to `number`
    // would be the one place in this package where a cents value could lose
    // precision, on the surface a trader watches.
    if (typeof tick.equityCents !== 'bigint') {
      found.push(`${where}: equityCents is ${typeof tick.equityCents} rather than bigint`);
    }

    // Monotone per account per trading day, 1-based. A consumer that has seen n
    // and receives n+2 has lost a tick; one that receives n again cannot tell a
    // replay from a quiet market, which is M02 section 3.5 rule 3's failure.
    const key = `${tick.tradingDay}\0${tick.platformAccountRef}`;
    const previous = lastSequence.get(key);
    if (previous === undefined) {
      if (tick.sequence !== 1) found.push(`${where}: first sequence is not 1`);
    } else if (tick.sequence <= previous) {
      found.push(`${where}: sequence did not advance past ${previous}`);
    }
    lastSequence.set(key, tick.sequence);

    // `[sessionOpen, sessionClose)`, which is the window `LiveAccountTick.atUtc`
    // documents and the one `session.ts` keeps its last exit strictly inside.
    const window = WINDOWS.get(tick.tradingDay);
    if (window === undefined) {
      found.push(`${where}: trading day is not a session of this run`);
      continue;
    }
    const at = parseInstantUtc(tick.atUtc);
    if (at < parseInstantUtc(window.sessionOpenUtc)) {
      found.push(`${where}: ${tick.atUtc} is before the session opens`);
    }
    if (at >= parseInstantUtc(window.sessionCloseUtc)) {
      found.push(`${where}: ${tick.atUtc} is at or after the session close`);
    }
  }

  return found;
}

/**
 * Yield exactly one turn of the event loop.
 *
 * The pump schedules one `setImmediate` per tick, and this one is queued after
 * it, so a single call advances the feed by exactly one delivery. Nothing here
 * waits out a duration.
 */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Drive one implementation until it stops delivering, and return what it gave.
 *
 * **THE STOP CONDITION IS A QUIET TURN, AND IT IS EXACT RATHER THAN A
 * HEURISTIC.** The pump delivers exactly one tick per turn or stops, so a turn
 * in which nothing arrived is a turn after the last one. A `Subscription`
 * carries no completion signal because a feed with a wire behind it does not
 * end, and inventing one here would be this slice deciding the shape of feed
 * loss, which `P6` section 3.4 holds.
 */
async function drive(
  feed: Pick<PlatformAdapter, 'streamLive'>,
  onTick?: (seen: readonly LiveAccountTick[], subscription: Subscription) => void,
): Promise<readonly LiveAccountTick[]> {
  const seen: LiveAccountTick[] = [];
  const subscription = await feed.streamLive((tick) => {
    seen.push(tick);
    if (onTick !== undefined) onTick(seen, subscription);
  });
  for (;;) {
    const before = seen.length;
    await turn();
    if (seen.length === before) break;
  }
  subscription.close();
  return seen;
}

const run = simulate(canonicalInput());

/** One implementation of `streamLive`, and the cadence it is opened in. */
const IMPLEMENTATIONS: readonly {
  readonly name: string;
  readonly open: () => Pick<PlatformAdapter, 'streamLive'>;
}[] = [
  {
    name: 'the simulator, push delivery on every waypoint',
    open: () => simulatorLiveFeed(run),
  },
  {
    name: 'the simulator, polled delivery at a 300s cadence',
    open: () => simulatorLiveFeed(run, { pollSeconds: 300 }),
  },
];

for (const { name, open } of IMPLEMENTATIONS) {
  test(`${name}: every delivered tick satisfies the tier-2 invariants`, async () => {
    const ticks = await drive(open());

    // A feed that delivered NOTHING would satisfy every invariant above
    // vacuously, which is the cheapest way for a conformance suite to become
    // decoration. The floor is DERIVED from the run rather than typed: every
    // account gets at least its opening waypoint in every session, under either
    // cadence.
    expect(ticks.length).toBeGreaterThanOrEqual(run.sessions.length * run.population.length);

    const found = violations(ticks);
    expect(found, found.join('\n')).toEqual([]);
  });

  test(`${name}: closing the subscription stops delivery`, async () => {
    // The assertion `Subscription.close` exists for. A feed that delivered its
    // whole day inside `streamLive` would pass every test above and fail this
    // one, which is why delivery is a pump rather than a loop.
    const stopAfter = 3;
    const ticks = await drive(open(), (seen, subscription) => {
      if (seen.length === stopAfter) subscription.close();
    });
    expect(ticks).toHaveLength(stopAfter);
  });
}

test('a poll cadence and a per-account order are refused rather than silently resolved', () => {
  // `sampleTicks` states its own total order and it is the instant order, so
  // honouring both is impossible. Ignoring the one the caller wrote is the
  // failure this refuses: a consumer that asked for per-account delivery and
  // silently got interleaved delivery has an ordering bug with no error in it.
  expect(() => simulatorLiveFeed(run, { pollSeconds: 300, order: 'account' })).toThrow(StreamError);
});

test('the conformance check fires on each violation it claims to see', async () => {
  // A check that has only ever been seen pass is indistinguishable from a check
  // that cannot fail, which is `falsify.mjs`'s discipline. Each seed is fed to
  // the same `violations` the real runs use, not to a copy, and each is a
  // MUTATION of a genuinely delivered tick so the seed cannot drift from the
  // shape the feed actually produces.
  const [first, second] = await drive(simulatorLiveFeed(run));
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  const real = first!;

  const seeds: readonly { readonly why: string; readonly tick: LiveAccountTick }[] = [
    {
      why: 'indicative is not true',
      tick: { ...real, indicative: false as unknown as true },
    },
    {
      why: 'equityCents is number rather than bigint',
      tick: { ...real, equityCents: 12_345 as unknown as bigint },
    },
    { why: 'first sequence is not 1', tick: { ...real, sequence: 2 } },
    {
      why: 'is before the session opens',
      tick: { ...real, atUtc: '2026-11-02T13:29:59Z' },
    },
    {
      why: 'is at or after the session close',
      tick: { ...real, atUtc: '2026-11-02T20:00:00Z' },
    },
    {
      why: 'trading day is not a session of this run',
      tick: { ...real, tradingDay: '2026-11-05' },
    },
  ];

  for (const { why, tick } of seeds) {
    const found = violations([tick]);
    expect(found.join('\n'), why).toContain(why);
  }

  // And the non-advancing sequence, which needs two ticks to be visible at all.
  expect(violations([real, real]).join('\n')).toContain('sequence did not advance past 1');

  // The other direction: the unmutated pair the seeds were built from is clean,
  // so the checks above are firing on the mutation rather than on the fixture.
  expect(violations([real, second!])).toEqual([]);
});
