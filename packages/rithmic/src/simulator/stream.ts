// =============================================================================
// packages/rithmic/src/simulator/stream.ts
// =============================================================================
// THE SYNTHETIC SIMULATOR, STREAMING MODE. ADR-020's TIER 2.
//
// M02 section 3.5 rule 4: "The simulator streams too. The synthetic simulator
// gains a streaming mode alongside its file output, so the live layer is
// developable and testable before any vendor agreement exists. This is
// INV-M2-11's discipline extended to tier 2, and it is what stops ADR-020 from
// becoming a second reason the vendor call blocks engineering."
//
// -----------------------------------------------------------------------------
// IT ATTACHES AT THE SEAM FILE MODE LEFT, AND THAT SEAM IS `SimDay.waypoints`
// -----------------------------------------------------------------------------
// `session.ts` line 20: "high / low = max and min over the waypoints, opening
// included", and line 27: "`SimDay.waypoints` is the intraday path. File mode
// summarises it into two [numbers]".
//
// So the two modes are not two producers of similar data. They are TWO VIEWS OF
// ONE PATH: file mode reports the summary, streaming mode replays the path.
// That is what makes the equivalence in `stream.test.ts` a real assertion
// rather than a coincidence worth checking. Fold the stream and you get the
// file, exactly, in integer cents.
//
// A streaming mode that RE-SIMULATED from the seed would produce a plausible
// path that agreed with the file about nothing in particular, and the two would
// drift the first time either changed. Nothing here draws, and nothing here
// re-derives a balance: every number below is read from a `SimDay` that
// `simulate` already produced.
//
// -----------------------------------------------------------------------------
// THE HARD RULE, WHICH IS ADR-020'S WHOLE SAFETY ARGUMENT
// -----------------------------------------------------------------------------
// **Indicative data never feeds any eligibility, breach, or money decision.**
// Not as an input, not as a pre-check, not as an optimization. `INV-M2-14`, and
// `SECURITY` `C-26` makes it a grant rather than a convention: the streaming
// path holds no write grant on `fills`, `raw_ingest_rows`, `daily_marks` or
// `rule_states`.
//
// THIS FILE CANNOT ENFORCE THAT, AND SAYING SO IS THE POINT. It is a producer
// of ticks; the boundary is a database grant and a consumer that never reaches
// for the engine. What this file can do is refuse to be mistaken for the
// authoritative path, which is why `LiveAccountTick` carries `indicative: true`
// as a required literal field: a consumer destructuring a tick cannot fail to
// see it, and a surface rendering one without its label is the build failure
// ADR-020 asked for.
//
// -----------------------------------------------------------------------------
// V-M2-16 IS THE MECHANISM AND IT IS UNCONFIRMED
// -----------------------------------------------------------------------------
// M02 section 11: a streaming or high-frequency snapshot mechanism is available
// at all, "whether R|API+ admin, a market-data entitlement we already pay for,
// or frequent report snapshots". M02 section 3.5: "Mechanism is vendor-
// dependent and is `V-M2-16`". `OQ-M2-05` carries the cost question.
//
// **What moves if the call says otherwise.** The TICK SHAPE and the DELIVERY
// CADENCE are the two things a mechanism decides, and this file fixes neither
// by accident:
//
//   - a push stream delivers on change, which is what `streamRun` emits
//   - a POLLED mechanism delivers on an interval, and the same path sampled at
//     a fixed cadence is `sampleTicks`, below, which exists so the polled shape
//     is expressible TODAY rather than being a redesign later
//
// If the mechanism turns out to be neither, what moves is this file and nothing
// upstream of it: `simulate` is untouched and the file mode is untouched.
// =============================================================================

import type { Cents, SimDay, SimRun, SimWaypoint, TradingDay } from './types.js';
import { parseInstantUtc } from './time.js';

/** Thrown when a run cannot be streamed as asked. */
export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamError';
  }
}

/**
 * One indicative observation of one account, as ADR-020's tier 2 carries it.
 *
 * M02 section 3.5 names the type `LiveAccountTick` in the `streamLive`
 * signature it adds to `PlatformAdapter`. The name here is the plan's.
 */
export interface LiveAccountTick {
  readonly platformAccountRef: string;
  readonly tradingDay: TradingDay;
  /** `yyyy-mm-ddThh:mm:ssZ`, inside `[sessionOpen, sessionClose)`. */
  readonly atUtc: string;
  /**
   * Integer cents, `bigint`, never a rule input.
   *
   * `bigint` because `Cents` is `bigint` throughout this package and INV-02
   * makes that the money type at every boundary. A tick that narrowed to
   * `number` would be the one place in the package where a cents value could
   * silently lose precision, on the surface a trader watches.
   */
  readonly equityCents: Cents;
  readonly kind: SimWaypoint['kind'];
  /**
   * 1-based, per account per day, in delivery order.
   *
   * A consumer that has seen `sequence` n and receives n+2 has lost a tick, and
   * ADR-020 rule 3 makes feed loss a first-class state rather than an error.
   * Without an ordinal the only way to notice a gap is a timestamp comparison,
   * which cannot tell a lost tick from a quiet market: exactly the failure mode
   * M02 section 3.5 rule 3 names ("a live surface that silently freezes at its
   * last value ... looks exactly like a quiet market").
   */
  readonly sequence: number;
  /**
   * ALWAYS `true`, and it is a required literal rather than an optional flag.
   *
   * ADR-020: "Every surface is labeled, indicative versus as-of-last-closed-
   * session, AT THE POINT OF USE rather than in a footnote." A consumer cannot
   * construct or destructure one of these without meeting the word.
   */
  readonly indicative: true;
}

/** What one account's day looked like when the stream had finished with it. */
export interface StreamFold {
  readonly platformAccountRef: string;
  readonly tradingDay: TradingDay;
  readonly openingEquityCents: Cents;
  readonly closingEquityCents: Cents;
  readonly highEquityCents: Cents;
  readonly lowEquityCents: Cents;
  readonly tickCount: number;
}

export interface StreamOptions {
  /**
   * Delivery order across accounts within one session.
   *
   * `time` interleaves every account's ticks by instant, which is what a single
   * vendor connection delivers. `account` groups a whole account's day before
   * the next, which is what per-account polling delivers. Both are orderings of
   * THE SAME TICK SET, asserted in the test, so a consumer that behaves
   * differently under one is a consumer with an ordering bug rather than a
   * simulator with two behaviours.
   */
  readonly order: 'time' | 'account';
}

export const DECLARED_STREAM_OPTIONS: StreamOptions = Object.freeze({
  order: 'time',
});

/** Epoch seconds for an instant this package produced. Strict, per `time.ts`. */
const epoch = (atUtc: string): number => parseInstantUtc(atUtc);

/**
 * Every tick one run produces, in delivery order.
 *
 * PURE: no clock, no filesystem, no randomness. It reads waypoints `simulate`
 * already produced and re-derives nothing, which is what keeps it in agreement
 * with file mode by construction rather than by test.
 *
 * Ordering is total and deterministic. Under `time`, ticks sort by instant,
 * then by POPULATION ORDER, then by the account's own sequence. The second key
 * is what makes this reproducible: two accounts whose waypoints land on the
 * same second are ordered by their position in the population, which is the
 * same key `rng.ts` draws against, so adding an account to the end of a
 * population cannot reorder the ticks of the accounts before it.
 */
export function streamRun(
  run: SimRun,
  options: Partial<StreamOptions> = {},
): readonly LiveAccountTick[] {
  const resolved: StreamOptions = { ...DECLARED_STREAM_OPTIONS, ...options };
  if (resolved.order !== 'time' && resolved.order !== 'account') {
    throw new StreamError(`unknown delivery order ${String(resolved.order)}`);
  }

  const out: LiveAccountTick[] = [];
  for (const [sessionIndex, session] of run.sessions.entries()) {
    const days = run.days[sessionIndex];
    if (days === undefined) {
      throw new StreamError(
        `run has ${run.sessions.length} sessions and no days for ${session.tradingDay}`,
      );
    }

    // Build per account first, so `sequence` is per account per day in every
    // ordering. A sequence that renumbered under `time` would make gap
    // detection an artifact of the delivery order rather than a property of
    // the feed.
    const perAccount = days.map((day) => ticksForDay(day));

    if (resolved.order === 'account') {
      for (const ticks of perAccount) out.push(...ticks);
      continue;
    }

    const merged = perAccount
      .flatMap((ticks, accountIndex) => ticks.map((tick) => ({ tick, accountIndex })))
      .sort((a, b) => {
        const byInstant = epoch(a.tick.atUtc) - epoch(b.tick.atUtc);
        if (byInstant !== 0) return byInstant;
        if (a.accountIndex !== b.accountIndex) return a.accountIndex - b.accountIndex;
        return a.tick.sequence - b.tick.sequence;
      });
    for (const { tick } of merged) out.push(tick);
  }
  return out;
}

function ticksForDay(day: SimDay): readonly LiveAccountTick[] {
  return day.waypoints.map((point, index) => ({
    platformAccountRef: day.account.platformAccountRef,
    tradingDay: day.tradingDay,
    atUtc: point.atUtc,
    equityCents: point.equityCents,
    kind: point.kind,
    sequence: index + 1,
    indicative: true as const,
  }));
}

/**
 * What a POLLED mechanism would have delivered: the path sampled at a fixed
 * cadence rather than on every change.
 *
 * `V-M2-16` is unconfirmed and names three candidate mechanisms, one of which
 * is "frequent report snapshots". A polled feed does not see every waypoint; it
 * sees whatever the path was at each sample instant. This function exists so
 * that shape is expressible today, because discovering after the vendor call
 * that the whole streaming mode assumed push delivery is the redesign the
 * citation discipline exists to prevent.
 *
 * **The last observation is carried forward, and the extremes between samples
 * are LOST.** That is not a defect to fix here: it is the property that makes a
 * polled feed different from a stream, and a consumer computing a projected
 * floor distance from sampled data is reading a number that never touched a
 * rule. Under ADR-020 that is safe by construction, which is the point of tier
 * 2 being a view.
 *
 * **THE FINAL OBSERVATION IS ALWAYS DELIVERED, and that is a decision rather
 * than an accident of the arithmetic.** A fixed cadence starting at the first
 * tick generally does not land on the last one, so a naive sampler stops up to
 * one interval short and the surface holds a stale number through the close.
 * That is precisely ADR-020 rule 3's named failure: "a live surface that
 * silently freezes at its last value ... looks exactly like a quiet market",
 * and it would freeze at the moment the number matters most. So the close is
 * appended when the cadence misses it, which also makes the closing equity
 * agree between the two mechanisms and leaves the extremes as the only thing
 * polling loses.
 */
export function sampleTicks(
  ticks: readonly LiveAccountTick[],
  intervalSeconds: number,
): readonly LiveAccountTick[] {
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds <= 0) {
    throw new StreamError(`sample interval ${intervalSeconds} is not a positive whole number`);
  }

  // Per account per day: the last tick at or before each sample instant.
  const byKey = new Map<string, LiveAccountTick[]>();
  for (const tick of ticks) {
    const key = `${tick.tradingDay} ${tick.platformAccountRef}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [tick]);
    else list.push(tick);
  }

  const out: LiveAccountTick[] = [];
  for (const list of byKey.values()) {
    const first = list[0];
    const last = list[list.length - 1];
    if (first === undefined || last === undefined) continue;
    let cursor = epoch(first.atUtc);
    const end = epoch(last.atUtc);
    let index = 0;
    let sequence = 0;
    let held: LiveAccountTick = first;
    while (cursor <= end) {
      while (index < list.length && epoch(list[index]!.atUtc) <= cursor) {
        held = list[index]!;
        index += 1;
      }
      sequence += 1;
      out.push({ ...held, sequence });
      cursor += intervalSeconds;
    }
    // The close, when the cadence stepped over it. See the note above.
    const delivered = out[out.length - 1];
    if (delivered === undefined || delivered.atUtc !== last.atUtc) {
      sequence += 1;
      out.push({ ...last, sequence });
    }
  }

  // Same total order as `streamRun`'s `time` mode, so the two are comparable.
  return out
    .map((tick, i) => ({ tick, i }))
    .sort((a, b) => {
      const byInstant = epoch(a.tick.atUtc) - epoch(b.tick.atUtc);
      if (byInstant !== 0) return byInstant;
      return a.i - b.i;
    })
    .map(({ tick }) => tick);
}

/**
 * Summarise a stream the way file mode summarises the path.
 *
 * THIS IS THE FUNCTION THE EQUIVALENCE TEST IS BUILT ON, and it deliberately
 * knows nothing about `SimDay`: it folds ticks and nothing else. A fold that
 * reached back into the run would be asserting that the run equals itself.
 */
export function foldStream(ticks: readonly LiveAccountTick[]): readonly StreamFold[] {
  const byKey = new Map<string, StreamFold>();
  const order: string[] = [];

  for (const tick of ticks) {
    const key = `${tick.tradingDay} ${tick.platformAccountRef}`;
    const seen = byKey.get(key);
    if (seen === undefined) {
      order.push(key);
      byKey.set(key, {
        platformAccountRef: tick.platformAccountRef,
        tradingDay: tick.tradingDay,
        openingEquityCents: tick.equityCents,
        closingEquityCents: tick.equityCents,
        highEquityCents: tick.equityCents,
        lowEquityCents: tick.equityCents,
        tickCount: 1,
      });
      continue;
    }
    byKey.set(key, {
      ...seen,
      closingEquityCents: tick.equityCents,
      highEquityCents:
        tick.equityCents > seen.highEquityCents ? tick.equityCents : seen.highEquityCents,
      lowEquityCents:
        tick.equityCents < seen.lowEquityCents ? tick.equityCents : seen.lowEquityCents,
      tickCount: seen.tickCount + 1,
    });
  }

  return order.map((key) => byKey.get(key)!);
}
