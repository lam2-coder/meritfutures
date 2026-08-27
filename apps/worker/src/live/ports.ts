// =============================================================================
// apps/worker/src/live/ports.ts
// =============================================================================
// THE STREAMING INGEST'S I/O BOUNDARY, AND THE UPSERT PREDICATE `0050` RECORDED
// AS OWED TO THIS SLICE.
//
// -----------------------------------------------------------------------------
// INV-M2-14, CARRIED HERE AS THE FORECLOSURE RATHER THAN AS AN INTENTION
// -----------------------------------------------------------------------------
// M02 `INV-M2-14`: the streaming path is **write-only into the live cache**, and
// **it has no grant on `fills`, `raw_ingest_rows`, `daily_marks` or
// `rule_states`**. SECURITY `C-26` makes that "structurally impossible rather
// than defended", and ADR-164 clause 2 spends it: `merit_live` holds
// `SELECT, INSERT, UPDATE` on the live cache, `SELECT` on the burn list, and
// NOTHING ELSE IN THE DATABASE.
//
// **THIS PARAGRAPH IS THE ONLY PLACE IN THIS MODULE THOSE FOUR NAMES OCCUR, AND
// A TEST ASSERTS EXACTLY THAT.** `test/live-ingest.test.ts` derives the four
// names from `0050`'s own closing `REVOKE`, strips every comment from this file
// and from `ingest.ts`, and asserts each name is PRESENT in the raw text and
// ABSENT from the stripped text. A comment saying the ingest cannot reach the
// engine is what that assertion exists to replace: the claim is about what this
// code CANNOT reach, so it is asserted mechanically or it is not asserted.
//
// The same suite walks this module's imports. `ingest.ts` imports `./ports.ts`
// and this file imports nothing at all, so the import graph is two nodes and is
// CLOSED: there is no path from here to any table in the estate, by any name.
//
// -----------------------------------------------------------------------------
// WHY EVERY SHAPE IS DECLARED HERE RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `batch/ports.ts`, `provisioning/ports.ts` and `sweeps/ports.ts` are the idiom.
// Their stated reason has since MOVED and the new one is stronger:
//
//   THE OLD REASON, now false in part. Those headers say `apps/worker` declares
//   `@merit/rules-engine` and nothing else. ADR-165 (session 292) admitted this
//   deployable to `@merit/db`, so the manifest names two workspace packages
//   today. It still does not name `@merit/rithmic`, and the manifest is outside
//   this fence, so `LiveAccountTick` cannot be imported here whatever the
//   reason.
//
//   THE REASON THAT ACTUALLY BINDS THIS MODULE. `@merit/db` IS declared and this
//   file still must not touch it. `src/db.ts` is the ONE file in this deployable
//   permitted to name the accessor (ADR-165), `test/db.test.ts` asserts that by
//   walking `src/`, and the accessor could not serve this port anyway:
//   `client.ts` opens ONE pool from ONE `DATABASE_URL` so **one process is one
//   role**, `apps/worker` holds `merit_app`, and `merit_app` holds NOTHING on
//   the live cache (`0050`'s `REVOKE ALL`). An adapter for the port below is a
//   process that connects as `merit_live`, which is `P6-b`'s address and
//   `P6-g`'s mechanism. **`0050`'s `F1` -- granting `merit_app` `SELECT` -- is
//   the cheap escape and it is not taken here.**
//
// So every shape is DECLARED structurally and SATISFIED by whatever the wiring
// supplies. `LiveAccountTick` is assignable to {@link IngestTick} with no import
// in either direction, and the suite binds the two by reading
// `packages/rithmic/src/simulator/stream.ts` as text.
//
// NOTHING HERE IMPORTS `pg` (`merit/no-raw-db-client` is attached to `apps/**`),
// ADDS A `SqlExecutorReason` MEMBER, ADDS A `SystemReason` MEMBER, OR CASTS PAST
// A KEY TYPE.
//
// -----------------------------------------------------------------------------
// THREE COLUMNS `0050` REFUSED, AND THE REFUSAL IS STRUCTURAL HERE TOO
// -----------------------------------------------------------------------------
// `0050` declines `kind`, `at_utc` and `projected_floor_distance_cents`, each
// with a reason, and a merged migration can never be edited. **{@link IngestTick}
// therefore declares NEITHER `kind` NOR `atUtc`**, though the tick carries both:
// a shape that read them would be the first half of writing them, and the
// second half is one session away. Structural assignability makes the narrowing
// free -- a wider tick satisfies a narrower port -- and the suite asserts both
// absences against `0050`'s stated refusals.
//
// `projected_floor_distance_cents` is composed at the READ layer for the reason
// `0050` gives: computing it needs a rule threshold the engine owns and a grant
// on a table `INV-M2-14` forbids by name. Nothing here approaches it.
// =============================================================================

// -----------------------------------------------------------------------------
// The tick, as this module needs to see it
// -----------------------------------------------------------------------------

/**
 * One indicative observation, narrowed to what the ingest reads.
 *
 * `LiveAccountTick` (`packages/rithmic/src/simulator/stream.ts`) is assignable
 * to this and carries two more fields. The narrowing is the point and the header
 * says why.
 *
 * `equityCents` IS `bigint` AND A `number` IS REFUSED RATHER THAN COERCED.
 * `stream.ts`: a tick that narrowed to `number` "would be the one place in the
 * package where a cents value could silently lose precision, on the surface a
 * trader watches". `INV-02` makes cents the money type at every boundary, and
 * `equity_cents` and `opening_equity_cents` are `bigint` columns. The ingest
 * checks the runtime type per tick rather than trusting the declaration,
 * because a tick arrives from outside this program.
 *
 * `indicative` IS A REQUIRED LITERAL AND IS CHECKED AT RUNTIME TOO. ADR-020
 * labels at the point of use; `stream.ts` makes the field required "so a
 * consumer destructuring a tick cannot fail to see it"; `0050` carries the same
 * label as a column with a `CHECK (indicative)` beside it. A tick reaching this
 * ingest without it is not a tier-2 tick and is refused.
 */
export interface IngestTick {
  readonly platformAccountRef: string;
  /** `yyyy-mm-dd`. The tick's trading day, and half of its ordinal. */
  readonly tradingDay: string;
  /** 1-based, PER ACCOUNT PER DAY, in delivery order. The other half. */
  readonly sequence: number;
  /** Integer cents. */
  readonly equityCents: bigint;
  readonly indicative: true;
}

/**
 * An open live feed, as this module needs to see it.
 *
 * `PlatformAdapter.streamLive` satisfies this. `close()` is the one operation a
 * consumer genuinely has, and `packages/rithmic/src/index.ts` says why feed loss
 * is NOT a method here: "the shape of a staleness claim is the SERVER's under
 * ADR-152".
 */
export interface LiveSubscription {
  /** Stop delivery. Idempotent, and no tick is delivered after it returns. */
  close(): void;
}

/**
 * The feed, as a port.
 *
 * THE HANDLER RETURNS `void` AND NOT `Promise<void>`, WHICH IS A CONSTRAINT ON
 * THIS INGEST RATHER THAN A DETAIL OF THE PORT. `LiveTickHandler`'s own
 * docstring: "a handler the feed awaited would make delivery order a property of
 * the consumer's slowest write ... A consumer that needs to do I/O per tick
 * QUEUES IT AND SAYS SO." This ingest does I/O per tick, so it queues, and
 * `ingest.ts` says so where the queue is.
 *
 * DELIVERY IS ONE TICK PER TURN OF THE EVENT LOOP and `stream.ts` records why it
 * is a turn rather than a microtask: a microtask pump runs BEFORE the caller's
 * `await` continuation, so the first tick would be delivered while the consumer
 * is still waiting for the `Subscription` that would let it close, and a
 * `close()` from inside the handler would be a reference to a variable that has
 * not been assigned. Nothing in this module closes from inside the handler, and
 * that is a property of the queue rather than luck.
 */
export interface LiveFeedPort {
  streamLive(handler: (tick: IngestTick) => void): Promise<LiveSubscription>;
}

// -----------------------------------------------------------------------------
// The burn list, read-only
// -----------------------------------------------------------------------------

/**
 * `platform_account_refs`, which is the only other grant `merit_live` holds.
 *
 * `INV-M2-10` MAKES THE RESOLUTION PERMANENT AND THAT IS WHY THE INGEST MAY
 * CACHE IT. `platform_account_refs` is the BURN LIST: a ref is never reused
 * across accounts and the primary key is the burn, so a ref that resolved to one
 * account today resolves to that account forever. `0050`'s own comment states
 * the consequence this port exists for: the lookup "cannot silently route one
 * trader's ticks onto another trader's row".
 *
 * `null` FOR AN UNKNOWN REF RATHER THAN A THROW. A ref the burn list does not
 * carry is a fact about the feed, not a failure of the ingest, and one unknown
 * ref must not stop every other trader's surface. `ingest.ts` counts it and the
 * report carries it.
 */
export interface LiveAccountRefPort {
  accountIdForRef(platformAccountRef: string): Promise<string | null>;
}

// -----------------------------------------------------------------------------
// THE PREDICATE. `0050` recorded it as owed and named this slice
// -----------------------------------------------------------------------------
// `0050`'s header, refusing a monotonicity trigger:
//
//   "the guard belongs in the ingest's `ON CONFLICT ... DO UPDATE ... WHERE
//   excluded.sequence > live_account_state.sequence` predicate. It is `P6-f`'s
//   and is recorded as owed rather than added to a migration that cannot be
//   edited."
//
// **THAT SKETCH FREEZES THE SURFACE AT THE DAY BOUNDARY, AND THE SAME MIGRATION
// SUPPLIES THE CORRECTION.** `sequence` is 1-based PER ACCOUNT PER DAY, so the
// first tick of a new trading day carries `sequence = 1`. Against yesterday's
// surviving row at `sequence = 400`, `1 > 400` is FALSE: the row never moves and
// the trader reads yesterday's equity through the whole of today. That is
// ADR-020 rule 3's named failure exactly -- "a live surface that silently
// freezes at its last value ... looks exactly like a quiet market" -- and it
// would freeze at the moment the number matters most.
//
// `0050`'s comment on the column it added for this says so in advance:
//
//   "The tick's trading day. Carried because `LiveAccountTick.sequence` is
//   1-based PER ACCOUNT PER DAY, so A SEQUENCE WITHOUT ITS DAY IS NOT AN ORDINAL
//   AT ALL, and because a row left over from yesterday must be distinguishable
//   from a quiet market today."
//
// **SO THE ORDINAL IS THE PAIR `(trading_day, sequence)`, COMPARED
// LEXICOGRAPHICALLY**, and the guard is that pair strictly increasing. This is
// the sketch widened in the direction its own file argues for rather than a
// departure from it, and it is the one line in this slice worth reading twice.
//
// FOUR CASES, AND EACH IS A DIFFERENT DEFECT IF IT GOES THE OTHER WAY:
//
//   same day, higher sequence   WRITE.    the ordinary tick
//   same day, same or lower     REFUSE.   an out-of-order tick rewinding the row
//   later day                   WRITE.    the day rollover the sketch loses
//   earlier day                 REFUSE.   yesterday's straggler arriving after
//                                         today's open, which would rewind the
//                                         row by a whole session
//
// An out-of-order tick that rewound the row is a display defect on a LABELED
// INDICATIVE number and never a money defect, because `INV-M2-14` keeps the
// figure off every money decision (ADR-164 `F3`). It is still a defect.

/**
 * One candidate row's ordinal: the pair, and nothing else.
 *
 * Declared as its own shape so {@link supersedes} takes exactly the two columns
 * it compares. A predicate that accepted a whole row could read a third column
 * by accident and nobody would see it in the signature.
 */
export interface LiveOrdinal {
  readonly tradingDay: string;
  readonly sequence: number;
}

/**
 * Does `candidate` supersede `held`? The predicate, in TypeScript.
 *
 * **TWO RENDERINGS OF ONE PREDICATE STAND IN THIS FILE AND THAT IS DELIBERATE**:
 * this function and {@link LIVE_CACHE_UPSERT_SQL}'s `WHERE`. Neither is
 * removable. The SQL is where the guard actually runs, because two ingest
 * processes and a restarted one share no memory and only the database can order
 * their writes; this function is what the suite can execute, what a fake applies
 * so the tests are about the RULE rather than about a mock, and what a reviewer
 * reads. **They are adjacent so that a change to one is a diff beside the
 * other, and the suite asserts the SQL carries this function's exact two
 * comparisons.**
 *
 * `tradingDay` is `yyyy-mm-dd`, so lexicographic string comparison IS date
 * order. That is a property of the format rather than a coincidence, and it is
 * the same property PostgreSQL's `date` comparison gives the SQL arm.
 */
export function supersedes(candidate: LiveOrdinal, held: LiveOrdinal): boolean {
  if (candidate.tradingDay !== held.tradingDay) return candidate.tradingDay > held.tradingDay;
  return candidate.sequence > held.sequence;
}

/**
 * The upsert, as the adapter's obligation.
 *
 * **IT IS A STRING HERE BECAUSE NO ACCESSOR IN THIS WORKSPACE CAN EXPRESS IT AND
 * NOTHING IN THIS FENCE MAY ADD ONE.** ADR-112 gives a transaction handle
 * `rowsWhere`, `lockAt`, `updateAt` and `insert`; none of them is an upsert, and
 * none of them carries an `ON CONFLICT` predicate. `packages/db` is outside this
 * fence (P6 rule 5), so the choice is to state the contract where its reasoning
 * lives or to leave the adapter to invent it. A contract nobody can read is not
 * a contract.
 *
 * **NOTHING IN THIS FENCE EXECUTES IT.** There is no `pg` import, no
 * `sqlExecutor` and no adapter: the port below refuses until a process that
 * connects as `merit_live` exists. This constant is the specification handed to
 * whoever builds that process, and the suite is what stops it drifting from
 * `0050`.
 *
 * WHAT THE SUITE BINDS, by reading `0050` as text:
 *
 *   every column named here is a column `0050` declares
 *   the three columns `0050` REFUSED are named nowhere
 *   `intraday_movement_cents` is named nowhere, because it is GENERATED and a
 *     write would be an error rather than a disagreement (ADR-164 clause 6:
 *     "a figure the database computes cannot disagree with the two numbers
 *     stored beside it")
 *   the `WHERE` carries `0050`'s own quoted fragment AND the trading-day half
 *   no table other than `live_account_state` is named anywhere in it
 *
 * `opening_equity_cents` IS PRESERVED WITHIN A DAY AND REPLACED ACROSS ONE, AND
 * THE `CASE` IS WHY THE INGEST NEEDS NO MEMORY. ADR-164 clause 6: "the opening
 * equity is the day's FIRST TICK and never an authoritative baseline", which is
 * what keeps the grant list at one table -- an ingest that read `daily_marks`
 * for a baseline would need the grant `INV-M2-14` forbids by name. The ingest
 * sends this tick's own equity as the candidate opening on EVERY row; the row's
 * held opening survives every later tick of the same day. So a process that
 * restarts at noon does not reset the day's opening, because the opening lives
 * in the row rather than in the process.
 *
 * `indicative` AND `created_at` ARE ABSENT, AND `0050`'s DEFAULTS ARE WHY. Both
 * are `DEFAULT`ed on insert and neither may move on update: a `created_at` that
 * advanced would make the row look new every tick, and `indicative` is constant
 * `true` under a `CHECK` that cannot be satisfied any other way.
 *
 * `as_of_instant` IS SET ON BOTH ARMS AND THE UPDATE ARM IS THE ONE THAT
 * MATTERS. `0050` declares it `NOT NULL DEFAULT now()`, **and a column default
 * does not fire on `UPDATE`**. A ticking account whose `as_of_instant` never
 * moved would go stale while it was ticking, which is the inverse of the failure
 * the column exists to detect, so the `DO UPDATE SET` names it explicitly. It is
 * OUR clock and never the feed's: ADR-152 clause 1 makes staleness "the SERVER's
 * own answer against its own threshold", so the instant is the ingest's own and
 * a lagging or lying feed cannot move it.
 */
export const LIVE_CACHE_UPSERT_SQL = `
INSERT INTO live_account_state
  (account_id, trading_day, sequence, opening_equity_cents, equity_cents, feed, as_of_instant)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (account_id) DO UPDATE SET
  trading_day = excluded.trading_day,
  sequence = excluded.sequence,
  opening_equity_cents = CASE
    WHEN excluded.trading_day > live_account_state.trading_day
      THEN excluded.opening_equity_cents
    ELSE live_account_state.opening_equity_cents
  END,
  equity_cents = excluded.equity_cents,
  feed = excluded.feed,
  as_of_instant = excluded.as_of_instant
WHERE excluded.trading_day > live_account_state.trading_day
   OR (excluded.trading_day = live_account_state.trading_day
       AND excluded.sequence > live_account_state.sequence)
`.trim();

/** The columns {@link LIVE_CACHE_UPSERT_SQL} writes, in its own order. */
export const LIVE_CACHE_WRITTEN_COLUMNS = [
  'account_id',
  'trading_day',
  'sequence',
  'opening_equity_cents',
  'equity_cents',
  'feed',
  'as_of_instant',
] as const;

/** One of {@link LIVE_CACHE_WRITTEN_COLUMNS}. */
export type LiveCacheWrittenColumn = (typeof LIVE_CACHE_WRITTEN_COLUMNS)[number];

// -----------------------------------------------------------------------------
// The cache, as a port
// -----------------------------------------------------------------------------

/**
 * One candidate row, by the column names `0050` declares.
 *
 * COLUMN NAMES AND NOT DRIZZLE PROPERTY NAMES, which is the opposite of
 * `sweeps/ports.ts`'s `ExpiryFilter` and is right for the opposite reason: that
 * port addresses rows through an accessor keyed by `TableKey`, and this one
 * cannot, because ADR-164 section 6 records that `live_account_state` is
 * DELIBERATELY NOT REGISTERED in `schema.ts` -- "the first session that NEEDS a
 * table registers it" (ADR-092) and the reader is `P6-g`'s and `P6-j`'s. There
 * is no property name to use. Registering it is not this fence's either:
 * `packages/db` is outside it.
 *
 * `openingEquityCents` IS THIS TICK'S OWN EQUITY ON EVERY ROW. It is a
 * CANDIDATE opening, not a claim about the day, and the `CASE` in
 * {@link LIVE_CACHE_UPSERT_SQL} decides whether it becomes one.
 */
export interface LiveCacheRow {
  readonly accountId: string;
  readonly tradingDay: string;
  readonly sequence: number;
  readonly openingEquityCents: bigint;
  readonly equityCents: bigint;
  readonly feed: string;
  readonly asOfInstant: Date;
}

/**
 * What the database did with one candidate row.
 *
 * `refused-stale` IS A NORMAL OUTCOME AND NOT AN ERROR. It is the predicate
 * doing its job: an out-of-order or a straggling tick that would have rewound
 * the row. The adapter reports it by the statement affecting no row.
 */
export type LiveCacheOutcome = 'written' | 'refused-stale';

/**
 * The live cache. THE ONLY THING THIS MODULE WRITES, ANYWHERE.
 *
 * ONE METHOD, AND THE ABSENCES ARE THE POINT. There is no `read`, no `delete`
 * and no second table:
 *
 *   NO `delete`, because `merit_live` HAS NO `DELETE` and `0050` takes it back
 *     explicitly after the grant list. ADR-164 clause 5: the store is not
 *     append-only and needs no expiry sweep, and "a live tier that can delete
 *     rows can also remove the evidence that it was ever wrong".
 *   NO `read`, because nothing in the ingest needs one. The `CASE` keeps the
 *     day's opening in the row and the `WHERE` keeps the ordinal monotone, so
 *     the ingest reads no state back to decide either. That is what makes the
 *     write idempotent under replay and safe under a restart.
 *   NO SECOND TABLE, which is `INV-M2-14` as the module's shape rather than as
 *     its comment.
 *
 * IT TAKES ONE ROW AND NOT A BATCH. `stream.ts` delivers one tick per turn of
 * the event loop, `sequence` is the FEED's statement of order, and a batch would
 * make the unit of atomicity a window this module chose rather than a tick the
 * feed sent.
 */
export interface LiveCacheWritePort {
  upsertIfNewer(row: LiveCacheRow): Promise<LiveCacheOutcome>;
}

// -----------------------------------------------------------------------------
// THE EXPECTATION ROW, DECLARED AND NOT WIRED, AND SECTION 3 OF THE LOG IS WHY
// -----------------------------------------------------------------------------
// P6 section 3.4: "**The live feed has no expectation row of either kind**, and
// `P6-f` is where one is written." The shape is `report_deliveries.due_at`'s,
// whose own data-model row states the sentence: "Without a stored window,
// 'nothing arrived' and 'not due yet' are the same empty result set."
//
// **THE SHAPE IS WRITTEN HERE AND THE ROW IS NOT, AND THE REASON IS A GRANT
// RATHER THAN A PREFERENCE.** Three facts, each at its source:
//
//   1. EVENTS section 5.4 and ADR-161 clause 7: every `feed.*` event's producer
//      is the EXPECTATION SWEEP, "whose own expectation row changing state IS
//      the transaction the event is written in", and NEITHER the feed NOR this
//      ingest produces any of them. So this module emits nothing, and it holds
//      no event port at all.
//   2. A sweep that writes `events` runs as `merit_app`. `merit_app` holds
//      NOTHING on `live_account_state` (`0050`'s `REVOKE ALL`, which is
//      `FM-M12-08` and `FM-M13-07` as permissions), so **THE SWEEP CANNOT READ
//      THE LIVE CACHE**. It cannot see the absence it is meant to alarm on by
//      looking at the cache, and granting it `SELECT` to fix that is `0050`'s
//      `F1` -- the one that "will be reached for" and that makes `FM-M12-08`
//      false silently. NOT TAKEN.
//   3. So the expectation must live in a table BOTH roles can reach: written by
//      `merit_live` (this ingest's heartbeat) and read by `merit_app` (the
//      sweep). That table does not exist, and **`merit_live` could not write it
//      if it did**: ADR-164 clause 2 gives it three verbs on one table and
//      `SELECT` on one more, deliberately with NO default privileges, so a new
//      table is invisible to the live tier until somebody grants it (`0050`
//      header item 5).
//
// **A TABLE AND A GRANT IS A MIGRATION, AND NO MIGRATION NUMBER IS ALLOCATED TO
// THIS SLICE.** P6 rule 5: if the work needs a file outside the fence, stop and
// report it. So the port below declares WHAT is written and refuses to invent a
// sink, which is `sweeps/ports.ts`'s disposition for the event sink one
// directory over, made for the same reason.
//
// **AND `merit_app` READING THIS TABLE IS NOT `F1`.** `F1` forbids a grant on
// `live_account_state`. This row carries a heartbeat and an ordinal and no
// equity, no movement and no money of any kind: what makes it safe is not its
// name but that no figure on it is one `FM-M12-08` is about. The migration that
// takes it should say so in those terms, and should say what it costs if it is
// wrong.

/**
 * One expectation row, at the grain the sweep needs.
 *
 * THE GRAIN IS `(feed, trading_day, account_id)` AND THE FEED-WIDE ROLL-UP IS A
 * `GROUP BY`. Two of the three `feed.*` payloads are per feed (`feed.stalled`,
 * `feed.resumed`) and one is per account (`feed.gap_detected`), so the finer
 * grain serves all three and the coarser serves one. `accounts_expected` is then
 * a count of rows rather than a stored number that can disagree with them, which
 * is `0049`'s and ADR-164 clause 6's idiom applied to a figure instead of to a
 * money value.
 *
 * **THE ROLL-UP IS AN AGGREGATE AND ADR-157 SECTION 5 REFUSED ONE ON THE READ
 * PATH.** That refusal is the sweep's problem rather than this module's and is
 * named here so the session that meets it does not read it as new.
 *
 * `expectedBy` IS THE `due_at` ANALOGUE AND IS NOT THIS INGEST'S TO WRITE. It is
 * a calendar fact -- a session is open for this trading day, so ticks are
 * expected -- and it comes from the trading calendar, which no code in this tree
 * has (session 291 measured the same absence for a different clock). The ingest
 * writes the heartbeat half: `lastTickAt` and `lastSequence`.
 */
export interface FeedExpectation {
  readonly feed: string;
  readonly tradingDay: string;
  readonly accountId: string;
  /** OUR clock at the last write for this account, never the feed's. */
  readonly lastTickAt: Date;
  /** The last ordinal accepted for this account on this day. */
  readonly lastSequence: number;
}

/**
 * The heartbeat sink.
 *
 * IT TAKES NO TRANSACTION, WHICH IS THE ONE PLACE THIS MODULE DEPARTS FROM
 * ADR-006's TRANSACTIONAL-ENQUEUE CRITERION, AND THE DEPARTURE IS FORCED. The
 * criterion is that a record commits with the state change that caused it; here
 * the state change is in `live_account_state`, which `merit_live` reaches, and
 * the record is in a table `merit_app` must read. Whether one transaction can
 * span both depends on whether one process holds both roles, and ADR-164 clause
 * 4 rules that **no process holds both**. So the two writes cannot be atomic,
 * and what that costs is bounded: a heartbeat that lags its cache row by one
 * tick makes the sweep alarm a moment early, and an alarm a moment early on an
 * indicative surface is not a money incident (EVENTS section 5.4: "tier 2
 * failing is not a money incident").
 *
 * **STATED RATHER THAN HIDDEN, because the shape of the fix is a ruling and not
 * a retry**: either the expectation row lives somewhere both roles reach in one
 * transaction, or the sweep tolerates a lagging heartbeat by design. The
 * migration that takes this row decides which, and this docstring is the
 * question written where that session will read it.
 */
export interface FeedExpectationPort {
  record(expectation: FeedExpectation): Promise<void>;
}

// -----------------------------------------------------------------------------
// Everything the ingest cannot do for itself
// -----------------------------------------------------------------------------

/**
 * The ingest's whole outside world.
 *
 * `now` IS INJECTED AND IS THE ONLY CLOCK IN THIS MODULE. It is what
 * `as_of_instant` and `lastTickAt` are stamped from, so a fixture pins it and
 * neither the database nor the feed supplies one. ADR-152 clause 1 is why it is
 * ours: staleness is the server's own answer against its own threshold, and a
 * threshold measured from a clock the feed controls is a threshold the feed can
 * satisfy by lying.
 *
 * THERE IS NO EVENT PORT AND THE ABSENCE IS ADR-161 CLAUSE 7. Every `feed.*`
 * event is the expectation sweep's, and a streaming ingest that also wrote
 * `events` would be a second writer in the one place the corpus describes as
 * having exactly one -- and `merit_live` holds no grant on `events` in any case.
 *
 * THERE IS NO TRANSACTION PORT. `INV-M2-14` makes this path write one table, so
 * there is no second write for a transaction to be atomic with. A `transact`
 * here would be an argument position a later session could put a second table
 * in.
 */
export interface LiveIngestIo {
  readonly feed: LiveFeedPort;
  readonly refs: LiveAccountRefPort;
  readonly cache: LiveCacheWritePort;
  readonly expectations: FeedExpectationPort;
  now(): Date;
}

/**
 * Raised by a port that is not installed.
 *
 * IT REFUSES RATHER THAN RETURNING A PLAUSIBLE VALUE, which is
 * `UNWIRED_EXPIRY_SWEEP_IO`'s sentence one directory over. The value this one
 * would have to invent is a trader's live equity, and a fabricated number on the
 * surface a trader watches is worse than a surface that says it is not there:
 * ADR-020 rule 3 makes feed loss a first-class STATE precisely so it can be
 * shown rather than papered over.
 */
export class LiveIngestUnwired extends Error {
  constructor(what: string) {
    super(
      `LiveIngestIo.${what} cannot be served by this deployment: no adapter is installed. The ` +
        'live cache is reachable only by merit_live and no process in this tree connects as it ' +
        '(ADR-164 clause 4); the expectation row has no table and no grant. The streaming ingest ' +
        'refuses rather than returning a plausible value, because the value it would have to ' +
        "invent is a trader's live equity.",
    );
    this.name = 'LiveIngestUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * `CRON_INVENTORY`'s feed-health row alarms on the ABSENCE of the heartbeat
 * rather than on this object, which is the same separation the expiry sweep's
 * row makes and for the same reason: a deployment holding this default is a
 * deployment whose ingest is absent, and it is alarmed as such rather than
 * trusted to report its own silence.
 */
export const UNWIRED_LIVE_INGEST_IO: LiveIngestIo = {
  feed: { streamLive: () => Promise.reject(new LiveIngestUnwired('feed.streamLive')) },
  refs: { accountIdForRef: () => Promise.reject(new LiveIngestUnwired('refs.accountIdForRef')) },
  cache: { upsertIfNewer: () => Promise.reject(new LiveIngestUnwired('cache.upsertIfNewer')) },
  expectations: { record: () => Promise.reject(new LiveIngestUnwired('expectations.record')) },
  now: () => {
    throw new LiveIngestUnwired('now');
  },
};
