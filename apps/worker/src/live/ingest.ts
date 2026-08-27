// =============================================================================
// apps/worker/src/live/ingest.ts
// =============================================================================
// THE STREAMING INGEST. ADR-020's TIER 2, P6 `P6-f`.
//
// -----------------------------------------------------------------------------
// INV-M2-14, AND IT IS THE HEADER RATHER THAN A FOOTNOTE
// -----------------------------------------------------------------------------
// M02 `INV-M2-14`: the streaming path is **write-only into the live cache**, and
// **it has no grant on `fills`, `raw_ingest_rows`, `daily_marks` or
// `rule_states`**. ADR-020's hard rule: indicative data never feeds an
// eligibility, breach or money decision, "not as an input, not as a pre-check,
// not as an optimization". SECURITY `C-26` requires that be "structurally
// impossible rather than defended".
//
// **THIS MODULE WRITES ONE TABLE AND READS ONE, AND THE FOUR NAMES ABOVE OCCUR
// IN THIS COMMENT AND NOWHERE ELSE IN IT.** `test/live-ingest.test.ts` derives
// the four from `0050`'s own closing `REVOKE`, strips every comment from this
// file and from `ports.ts`, and asserts each name is PRESENT in the raw text and
// ABSENT from the stripped text. The claim is about what this code CANNOT reach,
// so it is asserted mechanically. A comment saying so is what that test exists
// to replace.
//
// The suite also walks the imports: this file imports `./ports.ts` and that file
// imports nothing, so the graph is two nodes and is closed. There is no path
// from here to `apps/worker/src/batch/`, to `@merit/rules-engine`, to
// `@merit/db` or to any table in the estate, by any name.
//
// -----------------------------------------------------------------------------
// THE PREDICATE IS IN `ports.ts` BESIDE ITS SQL, AND THIS FILE IS ITS CALLER
// -----------------------------------------------------------------------------
// `supersedes` and `LIVE_CACHE_UPSERT_SQL` are adjacent there so a change to one
// is a diff beside the other. What lives here is WHEN it is consulted, and there
// are two consultations doing two different jobs:
//
//   IN THE DATABASE, in the `ON CONFLICT ... WHERE`. That is the real guard,
//   because two ingest processes and a restarted one share no memory and only
//   the database can order their writes.
//
//   IN THIS PROCESS, before the write, against what THIS process last got
//   accepted. **IT IS SOUND IN ONE DIRECTION ONLY AND THAT IS THE DIRECTION IT
//   IS USED IN.** If our local high-water mark is `(d, s)`, the row is at least
//   `(d, s)`, so a candidate that does not beat our mark cannot beat the row
//   either and skipping the round trip changes no outcome. The converse does not
//   hold, because another writer may be ahead of us, so a candidate that DOES
//   beat our mark is still sent and the database decides.
//
// -----------------------------------------------------------------------------
// THE HANDLER RETURNS `void`, SO THIS INGEST QUEUES, AND THE QUEUE COALESCES
// -----------------------------------------------------------------------------
// `LiveTickHandler` is `(tick) => void` and `packages/rithmic/src/index.ts` says
// why: "a handler the feed awaited would make delivery order a property of the
// consumer's slowest write ... A consumer that needs to do I/O per tick QUEUES
// IT AND SAYS SO." This one does I/O per tick. This is the saying so.
//
// **THE QUEUE IS ONE PENDING TICK PER ACCOUNT, NOT A LIST OF EVERY TICK, AND
// THAT IS A BOUND RATHER THAN A CAP.** A plain list grows without limit whenever
// the sink is slower than the feed, which for a per-tick round trip across a few
// thousand accounts is the ordinary case rather than the pathological one, and
// the usual answer, a maximum depth, is a number nobody here has measured.
// Coalescing gives a bound that is DERIVED: the queue can never hold more
// entries than the feed has accounts.
//
// **COALESCING IS OBSERVATIONALLY EQUIVALENT ON THE CACHE, WHICH IS WHY IT IS
// SAFE RATHER THAN MERELY CHEAP.** The row holds one tick per account and the
// predicate accepts only a strictly greater ordinal, so writing `n` and then
// `n + 1` leaves exactly what writing `n + 1` alone leaves. The one thing
// dropping `n` would lose is the evidence that `n` was DELIVERED, which is why
// gap detection happens at ENQUEUE and never at write: a gap is a property of
// the feed's delivery and not of this module's scheduling.
//
// -----------------------------------------------------------------------------
// THIS MODULE EMITS NO EVENT, AND THE ABSENCE IS RULED
// -----------------------------------------------------------------------------
// EVENTS section 5.4 and ADR-161 clause 7: `feed.stalled`, `feed.resumed` and
// `feed.gap_detected` are produced by the EXPECTATION SWEEP and never by the
// feed or by this ingest, because "a feed that stops opens no transaction" and
// because a streaming ingest that also wrote `events` would be a second writer
// where the corpus describes one.
//
// **{@link LiveIngestReport} IS A RETURN VALUE AND NOT AN EVENT.** It carries
// gaps in `feed.gap_detected`'s own field names so the sweep can lift them
// without a translation, and carrying them is not producing them. Nothing here
// writes `events`, and `merit_live` holds no grant on that table in any case.
// =============================================================================

import { supersedes } from './ports.ts';
import type {
  IngestTick,
  LiveCacheRow,
  LiveIngestIo,
  LiveOrdinal,
  LiveSubscription,
} from './ports.ts';

// -----------------------------------------------------------------------------
// What a tick can be refused for, before it ever reaches the cache
// -----------------------------------------------------------------------------

/**
 * The four refusals, as a closed union.
 *
 * **THREE OF THE FOUR ARE `0050`'s CONSTRAINTS CHECKED ONE LAYER EARLY, AND THE
 * REASON IS THAT A CONSTRAINT VIOLATION STOPS A FEED.** `sequence > 0` and
 * `CHECK (indicative)` are declared on the table, so a malformed tick reaching
 * the database raises `23514`, and a raised error in a per-tick write path is
 * one trader's bad tick taking out every other trader's surface for as long as
 * it keeps arriving. Refusing it here by name turns that into a counted row in
 * the report.
 *
 * **THEY ARE RUNTIME CHECKS AGAINST TYPES THE COMPILER ALREADY DECLARES, AND
 * THAT IS NOT REDUNDANT.** `IngestTick` describes a value that arrives from
 * outside this program: a vendor feed, a socket frame, a JSON parse.
 * `indicative` is typed as the literal `true` and `equityCents` as `bigint`, and
 * neither declaration survives that boundary. `JSON.parse` in particular cannot
 * produce a `bigint` at all, so a tick that came through one carries a `number`,
 * which is the exact loss of precision `stream.ts` says the `bigint` exists to
 * prevent, arriving on "the surface a trader watches". It is refused rather than
 * coerced.
 */
export const TICK_REFUSALS = [
  'not-indicative',
  'sequence-not-positive',
  'equity-not-integer-cents',
  'unknown-ref',
] as const;

/** One of {@link TICK_REFUSALS}. */
export type TickRefusal = (typeof TICK_REFUSALS)[number];

/**
 * Why this tick cannot be written, or `null`.
 *
 * `unknown-ref` IS NOT DECIDABLE HERE and is absent from this function on
 * purpose: it needs the burn list, which is I/O, and this function is pure so
 * the suite can drive it over a table of shapes.
 */
export function refuseTick(tick: IngestTick): Exclude<TickRefusal, 'unknown-ref'> | null {
  if (tick.indicative !== true) return 'not-indicative';
  if (!Number.isSafeInteger(tick.sequence) || tick.sequence <= 0) return 'sequence-not-positive';
  if (typeof tick.equityCents !== 'bigint') return 'equity-not-integer-cents';
  return null;
}

// -----------------------------------------------------------------------------
// The report
// -----------------------------------------------------------------------------

/**
 * One lost tick, in `feed.gap_detected`'s own field names.
 *
 * EVENTS section 5.4: the event "reads an ordinal and never a timestamp ... a
 * timestamp comparison cannot tell a lost tick from a quiet market, which is the
 * whole reason the ordinal exists". This shape is that payload minus `feed`,
 * which the report carries once for all of them.
 *
 * `accountId` IS NULLABLE BECAUSE A GAP IS DETECTED BEFORE A REF IS RESOLVED. It
 * is filled from the resolution cache when the report is built, and stays `null`
 * for a ref the burn list never resolved, which is a stronger finding than the
 * gap and is counted separately.
 *
 * **AT MOST ONE PER ACCOUNT AND TRADING DAY**, which is EVENTS section 5.4's own
 * rule for the event: "the second gap in a session tells an operator nothing the
 * first did not". Holding to it here means the sweep does not have to dedupe a
 * list this module could have deduped.
 */
export interface FeedGap {
  readonly platformAccountRef: string;
  readonly accountId: string | null;
  readonly tradingDay: string;
  readonly lastSequence: number;
  readonly receivedSequence: number;
}

/**
 * What one run of the ingest did.
 *
 * IT IS RETURNED AND NEVER WRITTEN. See the header: every `feed.*` event belongs
 * to the expectation sweep.
 *
 * `coalesced` IS NOT A LOSS AND THE FIELD EXISTS SO NOBODY READS IT AS ONE. It
 * counts ticks a later tick for the same account overtook while both were
 * queued; the cache lands on exactly the row it would have landed on had every
 * one been written in turn, and the delivery those ticks evidence is already
 * counted in `received` and already checked for gaps.
 *
 * `failed` COUNTS WRITES THAT RAISED, AND THE RUN CONTINUES. One account's write
 * failing must not take every other trader's surface down with it, so the error
 * is counted, the first message is kept, and the next tick is attempted. **The
 * run does not stop and it does not swallow**: a run whose writes all failed is
 * a report of nothing but failures, and `CRON_INVENTORY`'s feed-health row
 * alarms on the heartbeat's absence rather than on this object, so a process
 * that is failing silently is already a process something is paging about.
 */
export interface LiveIngestReport {
  readonly feed: string;
  readonly received: number;
  readonly written: number;
  readonly refusedStale: number;
  readonly coalesced: number;
  readonly failed: number;
  readonly firstFailure: string | null;
  readonly refused: Readonly<Record<TickRefusal, number>>;
  readonly gaps: readonly FeedGap[];
}

/** What the ingest is configured with, which is one word. */
export interface LiveIngestConfig {
  /**
   * `LiveFreshness.feed`: "which feed the value came from".
   *
   * A CONFIGURED STRING AND NOT A DERIVED ONE. `0050` puts no `CHECK` over a
   * value list on the column and says why: `V-M2-16` is unanswered and "a merged
   * CHECK naming today's feeds could never be corrected". The same argument
   * forbids a closed union here.
   */
  readonly feed: string;
}

/** A running ingest. */
export interface LiveIngestRun {
  /**
   * Everything delivered so far has been written or accounted for.
   *
   * NO TIMER AND NO CLOCK. It resolves when the queue is empty and no write is
   * in flight, which is what a test needs to assert on a deterministic pump and
   * what an operator needs to drain before a deploy.
   */
  drained(): Promise<void>;
  /**
   * Stop delivery, finish what is queued, and report.
   *
   * IT DRAINS RATHER THAN DISCARDS. Those ticks were delivered, and a trader's
   * number that was received and dropped on shutdown is a surface that goes
   * backwards at deploy time.
   */
  close(): Promise<LiveIngestReport>;
}

// -----------------------------------------------------------------------------
// The ingest
// -----------------------------------------------------------------------------

/**
 * Open the feed and write every tick into the live cache.
 *
 * **IT WRITES `live_account_state` AND NOTHING ELSE, PLUS THE HEARTBEAT THE
 * EXPECTATION SWEEP NEEDS, WHICH HAS NO TABLE YET.** `ports.ts`' expectation
 * section is the measurement: the sweep runs as `merit_app`, `merit_app` holds
 * nothing on the live cache, so the absence the sweep alarms on cannot be seen
 * by reading the cache and must be recorded somewhere both roles reach. That is
 * a table and a grant, which is a migration, and no migration number is
 * allocated to this fence. The port is declared and refuses.
 *
 * **THE OPENING EQUITY IS SENT ON EVERY ROW AND DECIDED BY THE DATABASE.** This
 * function keeps no per-day opening in memory, which is what makes a process
 * restart at noon harmless: the row's own opening survives, and the upsert's
 * `CASE` replaces it only when the trading day advances. ADR-164 clause 6
 * requires the opening to be "the day's FIRST TICK and never an authoritative
 * baseline", and the honest reading of that in a process that can start
 * mid-session is **the first tick this ingest observed for that day**. A truer
 * opening would need the marks table, which is the grant `INV-M2-14` forbids by
 * name.
 */
export async function startLiveIngest(
  io: LiveIngestIo,
  config: LiveIngestConfig,
): Promise<LiveIngestRun> {
  const counts = {
    received: 0,
    written: 0,
    refusedStale: 0,
    coalesced: 0,
    failed: 0,
  };
  const refused: Record<TickRefusal, number> = {
    'not-indicative': 0,
    'sequence-not-positive': 0,
    'equity-not-integer-cents': 0,
    'unknown-ref': 0,
  };
  let firstFailure: string | null = null;

  /** Newest pending tick per platform ref. The queue, and its bound. */
  const pending = new Map<string, IngestTick>();
  /** Resolutions, permanent under `INV-M2-10`'s burn list. `null` is a miss. */
  const resolved = new Map<string, string | null>();
  /** Last DELIVERED ordinal per ref, for gap detection at enqueue. */
  const delivered = new Map<string, LiveOrdinal>();
  /** Last ordinal THIS process got accepted per ref, for the local pre-check. */
  const accepted = new Map<string, LiveOrdinal>();
  /** At most one gap per ref and trading day. */
  const gaps = new Map<string, FeedGap>();

  let draining = false;
  let idle: (() => void)[] = [];

  const settleIdle = (): void => {
    const waiting = idle;
    idle = [];
    for (const resolve of waiting) resolve();
  };

  const resolveRef = async (ref: string): Promise<string | null> => {
    const seen = resolved.get(ref);
    if (seen !== undefined) return seen;
    const accountId = await io.refs.accountIdForRef(ref);
    resolved.set(ref, accountId);
    return accountId;
  };

  const writeOne = async (tick: IngestTick): Promise<void> => {
    const accountId = await resolveRef(tick.platformAccountRef);
    if (accountId === null) {
      refused['unknown-ref'] += 1;
      return;
    }

    const candidate: LiveOrdinal = { tradingDay: tick.tradingDay, sequence: tick.sequence };
    const mark = accepted.get(tick.platformAccountRef);
    if (mark !== undefined && !supersedes(candidate, mark)) {
      // Sound in one direction: the row is at least our mark, so this cannot
      // beat the row either. See the header.
      counts.refusedStale += 1;
      return;
    }

    const asOfInstant = io.now();
    const row: LiveCacheRow = {
      accountId,
      tradingDay: tick.tradingDay,
      sequence: tick.sequence,
      // The CANDIDATE opening. The `CASE` decides whether it becomes one.
      openingEquityCents: tick.equityCents,
      equityCents: tick.equityCents,
      feed: config.feed,
      asOfInstant,
    };

    const outcome = await io.cache.upsertIfNewer(row);
    if (outcome === 'refused-stale') {
      counts.refusedStale += 1;
      return;
    }

    counts.written += 1;
    accepted.set(tick.platformAccountRef, candidate);

    // THE HEARTBEAT IS RECORDED ONLY ON AN ACCEPTED WRITE. A heartbeat on a
    // refused tick would report a feed as healthy while it delivered nothing
    // new, which is exactly the state ADR-020 rule 3 says must be visible.
    await io.expectations.record({
      feed: config.feed,
      tradingDay: tick.tradingDay,
      accountId,
      lastTickAt: asOfInstant,
      lastSequence: tick.sequence,
    });
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const next = pending.entries().next();
        if (next.done === true) break;
        const [ref, tick] = next.value;
        pending.delete(ref);
        try {
          await writeOne(tick);
        } catch (error) {
          counts.failed += 1;
          firstFailure ??= error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      draining = false;
      settleIdle();
    }
  };

  /**
   * The feed's handler. SYNCHRONOUS, TOTAL, AND IT NEVER AWAITS.
   *
   * It validates, records the delivery, coalesces and kicks the drain. Every
   * branch is bookkeeping on a `Map`, so nothing here can throw into the feed's
   * pump, which matters because `stream.ts` deliberately does not catch a
   * handler's exception: "a feed that swallowed a consumer's error would turn a
   * broken live surface into a silent one".
   */
  const handler = (tick: IngestTick): void => {
    counts.received += 1;

    const refusal = refuseTick(tick);
    if (refusal !== null) {
      refused[refusal] += 1;
      return;
    }

    const ref = tick.platformAccountRef;
    const ordinal: LiveOrdinal = { tradingDay: tick.tradingDay, sequence: tick.sequence };
    const last = delivered.get(ref);
    if (
      last !== undefined &&
      last.tradingDay === tick.tradingDay &&
      tick.sequence > last.sequence + 1
    ) {
      const key = `${ref} ${tick.tradingDay}`;
      if (!gaps.has(key)) {
        gaps.set(key, {
          platformAccountRef: ref,
          accountId: null,
          tradingDay: tick.tradingDay,
          lastSequence: last.sequence,
          receivedSequence: tick.sequence,
        });
      }
    }
    if (last === undefined || supersedes(ordinal, last)) delivered.set(ref, ordinal);

    if (pending.has(ref)) counts.coalesced += 1;
    pending.set(ref, tick);
    void drain();
  };

  const subscription: LiveSubscription = await io.feed.streamLive(handler);

  const report = (): LiveIngestReport => ({
    feed: config.feed,
    received: counts.received,
    written: counts.written,
    refusedStale: counts.refusedStale,
    coalesced: counts.coalesced,
    failed: counts.failed,
    firstFailure,
    refused: { ...refused },
    gaps: [...gaps.values()].map((gap) => ({
      ...gap,
      accountId: resolved.get(gap.platformAccountRef) ?? null,
    })),
  });

  const drained = (): Promise<void> => {
    if (!draining && pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => idle.push(resolve));
  };

  return {
    drained,
    async close(): Promise<LiveIngestReport> {
      subscription.close();
      await drained();
      return report();
    },
  };
}

/** A report with nothing in it, for a run that received no tick. */
export function liveIngestClean(report: LiveIngestReport): boolean {
  return (
    report.received === 0 &&
    report.written === 0 &&
    report.failed === 0 &&
    report.gaps.length === 0 &&
    TICK_REFUSALS.every((refusal) => report.refused[refusal] === 0)
  );
}
