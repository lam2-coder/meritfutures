// =============================================================================
// apps/api/src/admin-source/liability.ts
// =============================================================================
// `GET /admin/liability`'s ROWS, AND IT IS NOT `AdminReadSource.readLiability`.
//
// THE DISTINCTION IS THE WHOLE POINT OF THIS FILE AND IT IS STATED FIRST. This
// module produces most of `LiabilityResponse` from live rows through ADR-112's
// keyed accessor and NOT ALL OF IT, and **NO NUMERAL IS WRITTEN HERE**:
// `test/admin-source-liability-book.test.ts` derives the declared, blocked and
// produced counts from API_CONTRACT through `RI-18`'s own reader, every count in
// this header went stale at least once, and a numeral in a comment beside a
// derivation is the derivation's reader believing the comment.
//
// **THE BLOCKED-LEAF COUNT IS WHAT IS PRODUCED AND NEVER WHAT IS PERMITTED.**
// B1 lifted and the count did not move (session 380: it was one of TWO blockers
// on the same five leaves). B2 lifted by ADR-201 and the count did not move
// either. ADR-203 moved the DECLARED count and left production alone, which was
// that ruling's own point. **B4 IS THE FIRST BLOCKER IN FOUR SESSIONS WHOSE LIFT
// MOVED PRODUCTION**, because `0064` plus session 387's producer plus
// {@link readRecon} is a leaf with a source where yesterday it had none.
//
// So the method is NOT composed, the array `IMPLEMENTED_ADMIN_READS` does not
// name it, and `composeAdminReadSource` still fills the gap with
// `AdminSourceNotComposed('readLiability')`.
//
// -----------------------------------------------------------------------------
// WHY A MODULE THAT COMPOSES NOTHING EXISTS AT ALL, WHICH SESSION 363 ARGUED
// AGAINST AND THE ARGUMENT HAS CHANGED UNDER IT
// -----------------------------------------------------------------------------
// Session 363 wrote: "a `liability.ts` producing what it can would satisfy no
// method of `AdminReadSource`, so it could not enter
// `composeImplementedAdminReads`, so nothing would import it". That was written
// when FIVE of the six groups had no producible source and the module would
// have been the seven top-level fields alone.
//
// ADR-199 moved the count. `reserve` is a keyed read now, and `integrations.batch`
// turned out to be an EVENT rather than an owed column. Most of the response is
// what is left, and the balance of that argument moves with the number: a reader
// that produces the leaves it can and MEASURES the ones it cannot is worth more
// than a paragraph saying the same thing, because the produced ones are RUN and
// the blocked ones are pinned with clearing conditions rather than asserted.
//
// **AND THE TYPE STATES THE GAP RATHER THAN THIS COMMENT.** {@link LiabilityBook}
// is `LiabilityResponse` minus exactly the blocked paths, written as a mechanical
// subtraction rather than as a hand-copied shape, so the day a blocker lifts the
// widening is a type error and never a judgement call. `test/admin-source-liability.test.ts`
// asserts the arithmetic: the book's leaves plus the blocked leaves are the
// response's leaves, counted from the CONTRACT rather than from either type.
//
// -----------------------------------------------------------------------------
// THE FIVE BLOCKERS, EACH AT ITS PRIMARY SOURCE, AND NOT ONE OF THEM IS A COLUMN
// -----------------------------------------------------------------------------
// ADR-199 ruled `per_plan[].cusum`, `integrations.batch` and `eligible_next_7d`
// DERIVABLE rather than owed a migration, and it is right about all three. It
// did not rule them READABLE, and for two of the three it says so in its own
// words. What follows is what stands between a derivation and a row.
//
//   B1. `eligible_next_7d` (5 leaves). **LIFTED, AND THE HALF IT BLOCKED IS
//       BUILT.** `trading_calendar` was not a `TableKey`, so a `Tx` naming it was
//       `TS2322` and the fold's fourth input could not be named. Session 377
//       registered it `firm` under ADR-103 clause 2 and
//       {@link readTradingHorizon} below is the read that spends it: the next
//       seven TRADING days off `trading_calendar`, bounded by
//       `trading_calendar_loads`, executed against a live database. **THE GROUP
//       IS STILL NOT PRODUCED, AND THE REASON IS B5 RATHER THAN B1.**
//
//   B2. `payout_velocity` (4 leaves, and the group goes whole). The NUMERATOR is
//       producible on its own --
//       `payout_transfers.amount_cents` over `settled_at` inside seven days is a
//       range term ADR-157 admits on the read path. THE DENOMINATOR HAS NO
//       DEFINITION. MERIT_BUILD_MASTER_PROMPT:166 fixes the threshold ("payout
//       velocity vs 30-day avg (alarm >2.5x)"), M06:95 restates it and
//       INFRA:160 pages on it, and NO DOCUMENT SAYS WHETHER `avg_30d_cents` IS
//       THE 30-DAY TOTAL, ITS DAILY MEAN, OR THAT MEAN SCALED TO SEVEN DAYS.
//       The three readings are not a rounding difference: against a daily mean a
//       seven-day total sits near 7.0 in steady state and the 2.5x pager fires
//       every day forever, and against a seven-day-equivalent mean it sits near
//       1.0 and the same threshold means what the constitution says. FM-M6-07's
//       words for the CUSUM ("either constant alarms or none, which is the same
//       as no chart") are the exact failure, on a control that pages.
//       **LIFTED BY ADR-201 WHILE THIS BRANCH WAS OPEN, AND THE PARAGRAPH ABOVE
//       IS KEPT RATHER THAN DELETED** because the reading it records is what the
//       ruling was written against. ADR-201 ruling 2: `avg_30d_cents` is "the
//       trailing thirty-day settled total scaled to seven days", which is the
//       third of the three readings above and the only one that leaves 2.5x
//       meaning what four documents say it means; ruling 6 answers the empty
//       denominator with `ratio_bp` 0 and `alarm` false. The entry is
//       `status: proposed` with an UNSIGNED approval line, which is what an ADR
//       ships as. **THE FOUR LEAVES ARE STILL BLOCKED AND THAT IS NOT A
//       CONTRADICTION**: the ruling landed and the fold is unwritten, which is
//       B1's shape exactly. A lifted blocker is a session's work, not a field.
//
//   B3. `per_plan[].cusum` (3 leaves). ADR-167 clause 1 folds `S_t` at read time
//       from a landed series, and clause 5 rules that the field is rendered
//       ABSENT until `DEP-M6-05` supplies `mu_0` and `sigma`, which M06:556 puts
//       in Wave 4. All three members need the calibration: `statistic` is the
//       recurrence, `threshold` is "4 to 5 sigma". `apps/worker/src/digests/produce.ts`
//       already renders that absence in terms -- "absent: blocked on ...
//       (ADR-167 clause 5, FM-M6-07)" -- so the absence is the answer this tree
//       already gives on the one surface that has a shape for it.
//       **THE WIRE HAD NO SHAPE FOR IT AND NOW IT DOES, WHICH IS THE SECOND OF
//       THE TWO CLEARING CONDITIONS AND NOT THE FIRST.** All three declarations
//       of `LiabilityResponse` typed `cusum` as a REQUIRED object of two numbers
//       and a boolean, so the only two answers were to manufacture a statistic
//       clause 5 refuses or to change a shape `RI-18` binds in three copies.
//       ADR-167 clause 5's own last sentence -- "the wire shape is `P7-b`'s to
//       carry, not this entry's to invent" -- named a shape nobody had carried.
//       ADR-202 ruled the form and ADR-203 transcribed it, atomically across the
//       three copies. So `cusum` is `{...} | null` and {@link readGaps} writes
//       the reason once on the body.
//       **THE CALIBRATION HAS NOT LANDED AND THE FIGURE IS EXACTLY AS ABSENT AS
//       IT WAS.** `DEP-M6-05` is still M06 Wave 4. What the lift bought is that
//       the response can SAY the figure is missing, name the deliverable that
//       would supply it, and be refused by `assertLiabilityGapsPaired` if it
//       ever says so about a figure it is actually carrying. A shape that can
//       carry an answer is not an answer, and this is the other half of that
//       sentence: a shape that can carry an ABSENCE is the whole of what an
//       absence needs.
//       CLEARING CONDITION, RESTATED: `DEP-M6-05` lands and the three members
//       become numbers.
//
//   B4. `integrations.recon.last_run_at` (1 leaf). **LIFTED, AND THE LEAF IS
//       PRODUCED.** The paragraph this replaces read "NOTHING IN THIS SCHEMA
//       RECORDS A RECONCILIATION RUN", and it was true of a 59-migration schema:
//       `reconciliations` (0014) is one row per account per trading day, so the
//       only fold across it is `max(created_at)`, and that is the fold ADR-199
//       section 5 refuses one field to the left, because OVERVIEW section 5.2
//       makes the nightly run resumable at the account boundary and "a fold over
//       per-account clocks reports a SUCCESS for a run that crashed".
//       **THE CLEARING CONDITION WAS "a `recon.completed` event OR A RUN
//       RECORD", AND THE SECOND HALF ARRIVED IN TWO PIECES**: `0064` created
//       `reconciliation_runs`, and session 387 wrote its first producer in
//       `apps/worker/src/recon/sweep.ts`. This module is the third piece and the
//       last one: {@link readRecon} dates the field off the newest COMPLETED
//       run's `started_at`, which is the column `0064`'s own index comment names
//       for this field and the predicate `reconciliation_runs_completed_is_whole`
//       names for its reader.
//       **THE `recon.completed` EVENT IS STILL OWED AND IS NOT THIS FIELD'S.**
//       EVENTS section 5.3 carries `recon.mismatch_detected` and `recon.resolved`
//       and no completion event, and data-model/README section 1 says a mutable
//       table emits one on every meaningful transition. That is an amendment to a
//       frozen document and therefore an ADR; it is REPORTED here and it blocks
//       nothing on this response.
//
//   B5. `eligible_next_7d` AGAIN (the same 5 leaves), AND IT IS THE HALF NOBODY
//       HAD LOOKED AT. The group is a FORECAST: "which accounts clear their
//       payout gates on each of the next seven trading days, and for how much"
//       (ADR-199 section 6), which EC-074 and P-M6-02 both phrase as "eligible
//       now or inside 7 trading days". The horizon is producible and the
//       PER-ACCOUNT half is not, on two INDEPENDENT legs, either of which alone
//       blocks the group.
//
//       LEG 1, THE ENGINE'S OWN FORECAST IS UNWRITTEN AND UNSPECIFIED. Six gate
//       groups decide eligibility (`tradedDays`, `winDays`, `buffer`,
//       `consistency`, `cadenceGap`, `minimumAmount`) and exactly ONE of them
//       carries a forward-looking date: `cadenceGap.nextEligibleTradingDay`,
//       which AS-06 requires be published as a resolved date. Every other gate
//       clears only when the trader TRADES, so no stored row says when. That one
//       date lives in `rule_states.engine_gates`, a `jsonb NOT NULL` bag, and
//       **NOTHING IN THIS TREE WRITES IT**: `writeRuleState` is a port
//       (`apps/worker/src/batch/ports.ts`) whose only implementations are test
//       doubles and `scripts/demo/world.ts`, which REFUSES. Its JSON encoding is
//       fixed by no document either -- `EngineGateResults` types every cents
//       member `bigint`, which JSON cannot carry, and `0015`'s own column comment
//       names EIGHT gates ("profit target, drawdown, win days, minimum days,
//       consistency, cadence, cap, minimum payout") where the engine produces
//       six. So the path `engine_gates.cadenceGap.nextEligibleTradingDay` is one
//       no primary source declares and no producer writes. **THIS IS NOT
//       `integrations.batch`'s CASE AND THE CONTRAST IS THE POINT**: EVENTS
//       section 5 DECLARES the `batch.completed` body in the approved catalogue,
//       which is why ADR-199 clause 4 could rule those two figures readable off
//       an event nothing has emitted yet.
//
//       LEG 2, RECOMPUTING THE GATE NEEDS A COLUMN THAT DOES NOT EXIST. ADR-199
//       section 6's own input table offers the other route: `plan_versions.rules`
//       for `cadence_gap_trading_days` and the ladder caps, `accounts` for the
//       pinned version, `rule_states` for the anchors. Every one of those is a
//       real column and a registered `TableKey`. **`CalendarDay.sequence` IS
//       NOT.** R-37 counts the gap by `sequence` subtraction and R-02 fixes that
//       "gap counting is `calendar.sequence` subtraction, NEVER date arithmetic";
//       `trading_calendar` declares no such column in `0004` or in any of the 59
//       migrations, and `packages/db/src/seed/calendars/` assigns none. The
//       engine gets its slice from a PORT (`BatchPorts.read.calendarSlice`) that
//       the caller supplies, never from a table. So the substitute available here
//       is date arithmetic, which is the one thing AS-06 says publishes "a rule
//       its own traders cannot evaluate".
//
//       **AND RECOMPUTING IT WOULD BE THE WRONG SHAPE EVEN IF THE COLUMN
//       EXISTED.** `admin-source/account.ts` states this directory's rule for the
//       same column: "Nothing in this module derives an eligibility, recomputes a
//       gate or summarises one". A second evaluator of a money gate living in an
//       admin read adapter is FM-M6-07's shape on the pager one field over.
//
//       **THE GROUP GOES WHOLE OR NOT AT ALL**, on B2's stated reason. Producing
//       only the accounts eligible TODAY would understate `total_cents`, and that
//       figure is the one the payout wallet is funded against (EC-074, P-M6-02,
//       ADR-011's top-up trigger). EC-074's own words for understating it:
//       "Funding the wallet against the overstatement starves operations".
//       CLEARING CONDITION: a `rule_states` writer lands and a primary source
//       declares the stored `engine_gates` shape, or a ruling defines the
//       forecast over columns that exist.
//
// **`withdrawals_in_flight_cents` IS ABSENT AND IS NOT A FIFTH BLOCKER**, because
// it is not on the response. ADR-195 section 6 row 1 owes the column, no migration
// declares it, and ADR-188 clause 5 refuses the field until it exists. Nothing here
// invents it and nothing here is owed for it.
//
// -----------------------------------------------------------------------------
// WHAT THIS MODULE MAY REACH, AND THE ONE PLACE THE ANCHOR IS A FILTER
// -----------------------------------------------------------------------------
// `flags.ts`'s handle shape and `flags.ts`'s reason: `insert`, `updateAt`,
// `deleteAt` and `sqlExecutor` are ABSENT rather than unused, `SystemTx`
// satisfies {@link LiabilityTx} structurally, and a handle narrowed to it cannot
// write. `liability_snapshots` and `reserve_coverage_snapshots` are both
// append-only by ruling, so on these tables a writable handle would be a shape
// the storage rule forbids.
//
// **THE TREASURY ANCHOR IS READ BY `rowsWhere` AND NOT BY `rowAt`, AND THAT IS
// NOT A STYLE CHOICE.** `scoped-db.ts`'s `refuseUnaddressed` names this table in
// its own docblock: "`treasury_balances` is the extreme case and the only
// registered table with no addressable key at all, because `0009` gives it
// `PRIMARY KEY (account_code, as_of)` and `schema.ts` declares none." So
// `rowAt('treasuryBalances', ...)` throws at run time on a predicate the database
// would have honoured. The equality pair is the same predicate; what it loses is
// the accessor's promise of at most one row, so {@link readTreasuryAnchor}
// asserts that itself and says which anchor was ambiguous. **The transcription
// gap is REGISTERED AND NOT REPAIRED: `packages/db` is another fence.**
//
// -----------------------------------------------------------------------------
// EVERY READ IS A WHOLE-TABLE SCAN OR A TYPED EQUALITY, AND THE COST IS RETURNED
// -----------------------------------------------------------------------------
// The accessor offers `rows`, `rowsWhere` and `rowAt` and NO ORDER BY and NO
// LIMIT (ADR-112, ADR-157). "The latest snapshot" is therefore a fold in this
// module rather than a clause in a query, and reaching for one would mean
// widening a vocabulary two entries closed on evidence.
//
// `readFlagQueue` and `readIdentityGraph` measure what they read and this does
// the same, in {@link LiabilityReadCost}, because the composition drops the cost
// object and a measurement a suite asserts on is worth more than one only a log
// carries. **The unbounded terms are named rather than hidden**: `liability_snapshots`
// and `reserve_coverage_snapshots` grow one row per snapshot, `plan_breaker_state`
// one row per plan per evaluation day, `mid_health` one row per PSP per window,
// and `events` filtered to `batch.completed` one row per nightly run. A bound on
// any of them is a retention window no document states, and inventing one here
// would drop the row an operator is looking at during the incident where the
// producer stopped running.
// =============================================================================

import { AdminReadError } from '../routes/admin-reads.ts';
import type { LiabilityResponse } from '../routes/admin-reads.ts';
import type { AdminRowFilter } from './flags.ts';

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others.
 *
 * EIGHT, FOR A RESPONSE THAT IS SEVEN GROUPS. `routes/admin-writes.ts`'s
 * `ADMIN_WRITE_TABLES` idiom, for its reason: a typo is a compile error here,
 * and the suite asserts every member is a real `TableKey` of `packages/db`,
 * which is the half this module cannot make about itself because it holds no
 * import of that package.
 *
 * `tradingCalendar` AND `tradingCalendarLoads` ARE HERE AS OF SESSION 380, AND
 * THE FIRST OF THEM IS WHAT B1 BOUGHT. While `trading_calendar` was not a
 * `TableKey` this array could not carry it even to try, which is what made B1 a
 * registration rather than a design gap; session 377 registered it `firm` under
 * `ADR-103` clause 2 and {@link readTradingHorizon} is the read that spends it.
 * **BOTH ARE NEEDED AND ONE IS NOT ENOUGH**: `ADR-042` F-4 puts coverage in
 * `trading_calendar_loads`, so a day outside it is UNKNOWN rather than a
 * holiday.
 *
 * THEY ARE READ BY {@link readTradingHorizon} AND NOT BY {@link readLiabilityBook},
 * which is stated here because the array would otherwise imply the second. The
 * book carries no `eligible_next_7d` (blocker B5), so paying two whole-table
 * reads inside it would buy a group it cannot return.
 */
export const LIABILITY_READ_TABLES = [
  'events',
  'liabilitySnapshots',
  'midHealth',
  'planBreakerState',
  'plans',
  'reconciliationRuns',
  'reconciliations',
  'reserveCoverageSnapshots',
  'tradingCalendar',
  'tradingCalendarLoads',
  'treasuryBalances',
] as const;

/** One of {@link LIABILITY_READ_TABLES}. */
export type LiabilityReadTable = (typeof LIABILITY_READ_TABLES)[number];

/**
 * ADR-112's keyed accessor, READ HALF ONLY, over this module's eight tables.
 *
 * `rowAt` IS DELIBERATELY ABSENT, which is one method fewer than `FlagsTx`
 * carries. The one address this module would take is the treasury anchor, and
 * the header records why that read is a filter instead. A method the module
 * cannot use correctly is a method the next reader will use incorrectly.
 */
export interface LiabilityTx {
  rows(key: LiabilityReadTable): Promise<unknown[]>;
  rowsWhere(key: LiabilityReadTable, where: AdminRowFilter): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The shape this module can fill
// -----------------------------------------------------------------------------

/**
 * `LiabilityResponse.per_plan`'s element, WHOLE, AND THE CUSUM IS A `null`.
 *
 * IT WAS AN `Omit<..., 'cusum'>` UNTIL `ADR-203` LANDED and it is an index now,
 * which is the whole of what B3's lift bought. `ADR-167` clause 5 renders the
 * field ABSENT until `DEP-M6-05` and said the wire shape was *"`P7-b`'s to
 * carry, not this entry's to invent"*; `ADR-202` ruled the form and `ADR-203`
 * transcribed it into all three declarations. So the absence has a spelling now
 * and this type stops subtracting the member.
 */
export type LiabilityPlanRow = LiabilityResponse['per_plan'][number];

/** One entry of `LiabilityResponse.gaps`. `ADR-203` ruling 2. */
export type LiabilityBookGap = LiabilityResponse['gaps'][number];

/**
 * `LiabilityResponse` MINUS the thirteen leaves nothing in this estate produces.
 *
 * WRITTEN AS A SUBTRACTION AND NEVER AS A COPY. A hand-written shape would be a
 * second declaration of a served type, which is `RI-18`'s whole subject, and it
 * would go stale the first time a field landed. Every member below is `Omit` or
 * an index into `LiabilityResponse`, so a field added to the response is on this
 * type by the rule, and a blocker that lifts is removed from this type by
 * deleting one `Omit`.
 */
export type LiabilityBook = Omit<LiabilityResponse, 'eligible_next_7d' | 'payout_velocity'>;

/**
 * What the read cost, in rows handed to this module.
 *
 * `FlagQueueCost`'s idiom. `readFlagQueue` and `readIdentityGraph` each return
 * one and the composition drops it; the suite is where it earns its place.
 */
export interface LiabilityReadCost {
  readonly liabilitySnapshotsScanned: number;
  readonly reserveSnapshotsScanned: number;
  readonly treasuryAnchorsMatched: number;
  readonly planBreakerRowsScanned: number;
  readonly plansScanned: number;
  readonly midHealthRowsScanned: number;
  readonly openMismatchesScanned: number;
  readonly completedReconRunsScanned: number;
  readonly batchCompletedScanned: number;
}

/** {@link readLiabilityBook}'s answer, or `null` when no snapshot has been written. */
export interface LiabilityBookResult {
  readonly book: LiabilityBook;
  readonly cost: LiabilityReadCost;
}

// -----------------------------------------------------------------------------
// The rows, read defensively
// -----------------------------------------------------------------------------

function field(row: unknown, name: string, at: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where ${at} was expected. A liability panel built ` +
        'out of that would put a number nothing in the estate produced in front of an operator ' +
        'during the incident it exists for',
    );
  return (row as Record<string, unknown>)[name];
}

function text(row: unknown, name: string, at: string): string {
  const value = field(row, name, at);
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${name}\`, and the column is \`NOT NULL\` in the schema. That is the ` +
        'transcription disagreeing with the database rather than a row to render',
    );
  return value;
}

/**
 * A `bigint` money column as the contract's JSON integer.
 *
 * `account.ts`'s `cents` and `search.ts`'s `cents`, for their reason:
 * API_CONTRACT section 1 types every `*_cents` member a JSON integer,
 * `assertContractScalars` refuses the response otherwise, and a value past 2^53
 * silently rounded is wrong in its low digits and right in every digit an
 * operator reads.
 *
 * IT DOES NOT CLAMP AND MUST NOT. `absorbed_corrections_cents` is signed
 * (ADR-188 clause 1, `0009:188`) and it is the one field on this response that
 * may be negative.
 */
function cents(value: unknown, at: string): number {
  const asNumber =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(asNumber))
    throw new AdminReadError(
      `${at} is ${JSON.stringify(typeof value === 'bigint' ? value.toString() : value)}, which ` +
        'is not a safe integer number of cents. API_CONTRACT section 1 types every `_cents` ' +
        'member as a JSON integer and a rounded one is wrong where it is hardest to notice',
    );
  return asNumber;
}

/**
 * A `boolean NOT NULL` column.
 *
 * `drizzle-orm` hands a `boolean` back for a `boolean` column and anything else
 * is the transcription disagreeing with the database. It is checked rather than
 * coerced because the three calendar booleans decide whether a day is IN the
 * horizon at all, and a truthy string would put a holiday in it.
 */
function flag(row: unknown, name: string, at: string): boolean {
  const value = field(row, name, at);
  if (typeof value !== 'boolean')
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is a ` +
        '`boolean NOT NULL`. A day whose holiday flag is not a boolean is a day nothing can ' +
        'decide is a session',
    );
  return value;
}

/** An `integer NOT NULL` count or basis-point column. */
function whole(row: unknown, name: string, at: string): number {
  const value = field(row, name, at);
  const asNumber = typeof value === 'bigint' ? Number(value) : value;
  if (typeof asNumber !== 'number' || !Number.isSafeInteger(asNumber))
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is an ` +
        '`integer NOT NULL`. A basis-point figure that is not an integer is a float that ' +
        'reached a money path',
    );
  return asNumber;
}

/**
 * A `timestamptz` as the contract's instant.
 *
 * `events.ts`'s `instant`. The `Date` branch is what drizzle hands back and the
 * string branch is what a double hands over, and both are checked rather than
 * assumed because `assertContractScalars` refuses anything else at the boundary.
 */
function instant(row: unknown, name: string, at: string): string {
  const value = field(row, name, at);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not an instant. ` +
      'INV-M6-04 makes every number on this page name its as-of moment, and a figure whose ' +
      'freshness is unstated is one that will eventually be quoted stale in a decision that ' +
      'mattered',
  );
}

/** A `timestamptz` for comparison only, as milliseconds since the epoch. */
function instantMs(row: unknown, name: string, at: string): number {
  return Date.parse(instant(row, name, at));
}

/**
 * The row carrying the greatest value of one `timestamptz` column.
 *
 * THE FOLD IS HERE BECAUSE THE ACCESSOR HAS NO `ORDER BY` AND NO `LIMIT`, and
 * that is ADR-112's shape rather than an oversight to route around. A tie is
 * REFUSED rather than broken: `liability_snapshots_as_of_uq` and
 * `reserve_coverage_snapshots_as_of_uq` both make one instant one row, so two
 * rows at one instant is the database disagreeing with its own unique index and
 * picking one would render an arbitrary answer to "what was liability then".
 */
function latestBy(rows: readonly unknown[], column: string, at: string): unknown {
  let best: unknown;
  let bestAt = Number.NEGATIVE_INFINITY;
  let ties = 0;
  for (const row of rows) {
    const when = instantMs(row, column, at);
    if (when > bestAt) {
      best = row;
      bestAt = when;
      ties = 1;
      continue;
    }
    if (when === bestAt) ties += 1;
  }
  if (ties > 1)
    throw new AdminReadError(
      `two ${at} rows share the greatest \`${column}\`, and a unique index on that column says ` +
        'there can be one. Rendering either would answer an operator with a figure chosen by ' +
        'row order',
    );
  return best;
}

/**
 * The greatest value of one `timestamptz` column, as the INSTANT and never as
 * the row that carries it, or `null` when there are no rows.
 *
 * {@link latestBy} REFUSES A TIE AND THIS ONE MUST NOT, and the difference is a
 * property of the tables rather than a relaxation. `latestBy`'s refusal is
 * argued from `liability_snapshots_as_of_uq` and `reserve_coverage_snapshots_as_of_uq`:
 * on those tables one instant IS one row, so two rows at one instant is the
 * database disagreeing with its own unique index. `reconciliation_runs` carries
 * no unique index at all and the absence is RULED rather than forgotten --
 * `0064`'s second E2 note refuses one because `RB-02` section A sends a
 * quarantined day to REDELIVERY and a redelivered day is reconciled again -- so
 * two runs sharing an instant is a state this schema admits and refusing it
 * here would be this module inventing a constraint the database declines.
 *
 * AND THE TIE COSTS NOTHING BECAUSE NO ROW IS SELECTED. The answer is a max over
 * one column, so two rows sharing the greatest `started_at` yield one answer
 * rather than an arbitrary one. That is exactly what `latestBy` cannot do: it
 * returns a ROW, and every other field of that row would then be picked by
 * accessor order.
 */
function latestInstant(rows: readonly unknown[], column: string, at: string): string | null {
  let best: string | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const when = instant(row, column, at);
    const ms = Date.parse(when);
    if (ms > bestAt) {
      best = when;
      bestAt = ms;
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// The groups
// -----------------------------------------------------------------------------

/** ADR-188 clause 1: the top-level fields are one `liability_snapshots` row, column for column. */
function readSnapshot(
  row: unknown,
): Omit<LiabilityBook, 'reserve' | 'per_plan' | 'integrations' | 'gaps'> {
  const at = 'the liability snapshot';
  return {
    as_of: instant(row, 'asOf', at),
    open_liability_cents: cents(field(row, 'openLiabilityCents', at), `${at} open_liability_cents`),
    wallet_balances_cents: cents(
      field(row, 'walletBalancesCents', at),
      `${at} wallet_balances_cents`,
    ),
    bounded_near_term_cents: cents(
      field(row, 'boundedNearTermCents', at),
      `${at} bounded_near_term_cents`,
    ),
    remaining_ladder_exposure_cents: cents(
      field(row, 'remainingLadderExposureCents', at),
      `${at} remaining_ladder_exposure_cents`,
    ),
    absorbed_corrections_cents: cents(
      field(row, 'absorbedCorrectionsCents', at),
      `${at} absorbed_corrections_cents`,
    ),
    funded_accounts: whole(row, 'fundedAccounts', at),
  };
}

/**
 * `rcr_bp`, and the one column on this read that may arrive NULL.
 *
 * `0049` makes it `GENERATED ALWAYS AS ((reserve_cents * 10000) / NULLIF(cvar99_cents, 0))`,
 * and its founder-read item 2 records why the `NULLIF` is load-bearing: a
 * generated column is computed BEFORE the row's CHECK constraints, so without it
 * a zero denominator raises a bare `division by zero` and the named constraint
 * never fires. `reserve_coverage_snapshots_cvar99_is_positive` means a stored
 * row cannot have one -- so a NULL here is a row that got in around the check,
 * and inventing a coverage ratio for it is the one number `0049` says must never
 * be invented.
 */
function coverageRatioBp(row: unknown, at: string): number {
  const value = field(row, 'rcrBp', at);
  if (value === null || value === undefined)
    throw new AdminReadError(
      `${at} carries \`rcr_bp\` as null, which 0049 produces only when \`cvar99_cents\` is zero ` +
        'and a CHECK forbids that. A zero denominator is not a coverage of infinity, it is a ' +
        'CVaR99 nobody computed',
    );
  return whole(row, 'rcrBp', at);
}

/**
 * ADR-188 clause 4: one `reserve_coverage_snapshots` row joined to its anchor.
 *
 * `breaker_armed` IS RECOMPUTED HERE AND IS NOT A COLUMN, which `0049`'s header
 * rules in terms: "Armed is `rcr_bp < 10000`, a rendering of a stored number
 * against a threshold the GLOSSARY fixes at 1.0, and storing it would recreate
 * in one column exactly the drift item 1 removes from another." The literal is
 * one basis-point rendering of that 1.0 and no float enters it.
 */
function readReserve(row: unknown, anchor: unknown): LiabilityBook['reserve'] {
  const at = 'the reserve coverage snapshot';
  const rcrBp = coverageRatioBp(row, at);
  const source = text(anchor, 'source', 'the treasury balance');
  if (source !== 'provider_api' && source !== 'manual_attestation')
    throw new AdminReadError(
      `the treasury balance carries \`source\` as ${JSON.stringify(source)}, and 0009 closes the ` +
        'column at `provider_api` and `manual_attestation`. P-M6-07 needs to know which of the ' +
        'two it is and a third name answers neither',
    );
  return {
    as_of: instant(row, 'asOf', at),
    reserve_cents: cents(field(row, 'reserveCents', at), `${at} reserve_cents`),
    cvar99_cents: cents(field(row, 'cvar99Cents', at), `${at} cvar99_cents`),
    rcr_bp: rcrBp,
    breaker_armed: rcrBp < 10000,
    treasury_account_code: text(row, 'treasuryAccountCode', at),
    treasury_as_of: instant(row, 'treasuryAsOf', at),
    treasury_source: source,
  };
}

/**
 * The treasury row `reserve_coverage_snapshots` names, by EQUALITY on both halves
 * of its primary key.
 *
 * NOT `rowAt`, AND THE HEADER SAYS WHY AT LENGTH. `refuseUnaddressed` reads
 * uniqueness out of `schema.ts` and `schema.ts` declares none on this table,
 * so the address the database would honour is refused before it is sent. The
 * equality pair is the same predicate and it is the accessor's ONE-ROW PROMISE
 * that is lost, so it is asserted here instead: `reserve_coverage_snapshots_anchor_fk`
 * is `ON DELETE RESTRICT` against `treasury_balances (account_code, as_of)`, so
 * a snapshot with no anchor is a foreign key that stopped holding, and two
 * anchors is a primary key that did.
 */
async function readTreasuryAnchor(
  tx: LiabilityTx,
  accountCode: string,
  asOf: unknown,
): Promise<readonly unknown[]> {
  if (typeof asOf !== 'object' && typeof asOf !== 'string')
    throw new AdminReadError(
      'the reserve coverage snapshot carries `treasury_as_of` as neither an instant nor a ' +
        'string, so there is no anchor to look up. RESERVE-C1 asserts the stored numerator IS ' +
        'the referenced balance and an unresolvable reference cannot be checked against anything',
    );
  return await tx.rowsWhere('treasuryBalances', {
    accountCode,
    asOf: asOf as NonNullable<unknown>,
  });
}

/** A `date NOT NULL` column, as the `YYYY-MM-DD` string a lexical compare orders. */
function day(row: unknown, name: string, at: string): string {
  const value = field(row, name, at);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString().slice(0, 10);
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, and API_CONTRACT section 1 declares ` +
      'every day-shaped value a `YYYY-MM-DD` exchange trading day: never a UTC date and never a ' +
      'timestamp',
  );
}

/**
 * `per_plan`, WITH THE CUSUM RENDERED ABSENT, WHICH IS BLOCKER B3 LIFTED.
 *
 * **THE FIGURE IS EXACTLY AS UNAVAILABLE AS IT WAS AND THE RESPONSE CAN SAY SO,
 * WHICH IS THE DIFFERENCE `ADR-203` MADE AND IS NOT A SMALLER ONE.** `ADR-167`
 * clause 1 folds `S_t` at read time from a landed series and clause 5 rules the
 * field ABSENT until `DEP-M6-05` supplies `mu_0` and `sigma`, which `M06` puts
 * in Wave 4. That did not move. What moved is that clause 5's own last sentence,
 * *"the wire shape is `P7-b`'s to carry, not this entry's to invent"*, has been
 * carried: `ADR-202` ruled the form and `ADR-203` put `{...} | null` into all
 * three declarations with a `gaps` entry carrying the reason.
 *
 * **THE `null` IS AT THE OBJECT AND NEVER AT A MEMBER**, which is `ADR-202`
 * ruling 3's second refusal: `{ statistic: null, threshold: 4, alarm: false }`
 * is a half-calibrated chart, a shape nothing in the corpus describes. All three
 * members stay non-nullable and the object is the thing that is absent.
 *
 * **AND THE GAP IS ONE ENTRY AND NOT ONE PER PLAN.** The absence is a property
 * of the CALIBRATION rather than of a plan, so {@link readGaps} writes the path
 * with the index elided, which is what `assertLiabilityGapsPaired` reads and
 * what `CUSUM_GAPS` in `routes/admin-breaker.ts` already spells.
 *
 * ONE ROW PER PLAN, THE LATEST `evaluated_on`, AND NO NARROWING ON `metric`.
 * `0016` declares `metric text NOT NULL` with NO CHECK and no document states a
 * vocabulary for it, so a filter on a literal here would be inventing one. What
 * makes the read safe instead is ADR-167 clause 2, which keeps the primary key
 * `(plan_id, evaluated_on)` -- one plan-day is ONE row -- and clause 3, which
 * forecloses the CUSUM ever writing this table at all. Every row of it is the
 * loss-ratio breaker's.
 *
 * `sales_paused` IS `state = 'paused'` AND IS NOT `cusum.alarm`. ADR-167 finding
 * 5 makes them separate fields on the wire and clause 3 makes them separate
 * facts: `'paused'` on this column is a REVENUE PAUSE and `INV-M5-12` is written
 * about the difference. `'manually_overridden'` is not paused, and neither is
 * `'insufficient_data'`, which `0016`'s header calls a first-class state and the
 * correct answer during launch week.
 *
 * A PLAN WITH NO BREAKER ROW HAS NO ENTRY, which is the panel's own grain: the
 * table has never held a row (ADR-167 finding 9), so the empty array is the
 * honest answer today and a row per plan invented from `plans` alone would put
 * a loss ratio of zero under a breaker nobody has evaluated.
 */
function readPerPlan(
  breakerRows: readonly unknown[],
  planRows: readonly unknown[],
): readonly LiabilityPlanRow[] {
  const codeById = new Map<string, string>();
  for (const row of planRows) codeById.set(text(row, 'id', 'a plan'), text(row, 'code', 'a plan'));

  const latestByPlan = new Map<string, { readonly row: unknown; readonly on: string }>();
  for (const row of breakerRows) {
    const at = 'a plan breaker state';
    const planId = text(row, 'planId', at);
    const on = day(row, 'evaluatedOn', at);
    const held = latestByPlan.get(planId);
    if (held === undefined || on > held.on) latestByPlan.set(planId, { row, on });
  }

  const plans: LiabilityPlanRow[] = [];
  for (const [planId, held] of latestByPlan) {
    const code = codeById.get(planId);
    if (code === undefined)
      throw new AdminReadError(
        `plan breaker state names plan \`${planId}\` and no plans row carries that id, though ` +
          '`plan_breaker_state.plan_id` REFERENCES plans(id) ON DELETE RESTRICT. A per-plan ' +
          'panel with an unnamed plan on it names nothing an operator can act on',
      );
    const at = `the plan breaker state for \`${code}\``;
    plans.push({
      plan_id: planId,
      code,
      loss_ratio_bp: whole(held.row, 'ratioBp', at),
      threshold_bp: whole(held.row, 'thresholdBp', at),
      sales_paused: text(held.row, 'state', at) === 'paused',
      // ADR-167 clause 5, and it is a VALUE this response asserts rather than a
      // key it withholds. An omitted key would make "absent, blocked on
      // DEP-M6-05" and "this deployment did not fill the field" the same body.
      cusum: null,
    });
  }
  // ORDERED BY CODE, because the accessor returns rows in no promised order and
  // a panel whose plan order moves between two reads of one book reads as a
  // change in the estate.
  return plans.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * `integrations.mid_health`, one row per PSP, the latest window.
 *
 * `healthy` IS `state = 'healthy'` AND THE OTHER TWO STATES ARE BOTH NOT-HEALTHY.
 * `0006` closes the column at `healthy`, `degraded` and `unhealthy`, and the
 * contract carries a boolean, so `degraded` renders false. That is a narrowing
 * this module performs and cannot avoid: the wire has one bit where the column
 * has three states, and reporting `degraded` as healthy would be the other
 * direction of the same lossy map and the wrong one on a processor relationship
 * `MERIT_BUILD_MASTER_PROMPT:228` prices at a 0.65% chargeback ratio.
 */
function readMidHealth(rows: readonly unknown[]): LiabilityBook['integrations']['mid_health'] {
  const latestByPsp = new Map<string, { readonly row: unknown; readonly at: number }>();
  for (const row of rows) {
    const at = 'a MID health window';
    const psp = text(row, 'psp', at);
    const endsAt = instantMs(row, 'windowEnd', at);
    const held = latestByPsp.get(psp);
    if (held === undefined || endsAt > held.at) latestByPsp.set(psp, { row, at: endsAt });
  }

  const health = [...latestByPsp].map(([psp, held]) => ({
    psp,
    decline_rate_bp: whole(held.row, 'declineRateBp', `the MID health window for \`${psp}\``),
    chargeback_rate_bp: whole(held.row, 'chargebackRateBp', `the MID health window for \`${psp}\``),
    healthy: text(held.row, 'state', `the MID health window for \`${psp}\``) === 'healthy',
  }));
  return health.sort((a, b) => (a.psp < b.psp ? -1 : a.psp > b.psp ? 1 : 0));
}

/**
 * `integrations.recon`, WHICH IS NOW A CLOCK AS WELL AS A COUNT. Blocker `B4`,
 * lifted, and the half that lifted it is not in this file.
 *
 * **THE BLOCKER WAS NEVER A COLUMN AND IT WAS NEVER A SHAPE.** Session 374 read
 * it as `NOTHING IN THIS SCHEMA RECORDS A RECONCILIATION RUN`, and it was right:
 * `reconciliations` is one row per account per trading day, so the only fold
 * across it is `max(created_at)`, which is the fold `ADR-199` section 5 refuses
 * one field to the left because `OVERVIEW` section 5.2 leaves the nightly run
 * *"resumable at the account boundary"* and a fold over per-account clocks
 * *"reports a SUCCESS for a run that crashed"*. `0064_reconciliation_runs.sql`
 * is the row that fold was missing and session 387 wrote its first producer
 * (`apps/worker/src/recon/sweep.ts`). What was left after those two is the
 * READER, which is this function.
 *
 * -----------------------------------------------------------------------------
 * TWO PRIMARY SOURCES FIX THIS READ AND NEITHER OF THEM IS A JUDGEMENT MADE HERE
 * -----------------------------------------------------------------------------
 * **THE COLUMN IS `started_at`.** `0064`'s index comment names this very field:
 * *"The panel's read, which is `integrations.recon.last_run_at`: the newest run,
 * one index scan"*, over `reconciliation_runs_latest_idx (started_at DESC)`, and
 * `data-model/reconciliation_runs.md` says it a second time. `finished_at` is
 * NOT taken and the field name is the reason -- `last_run_at` is when the run
 * WAS, and the run is what `started_at` dates.
 *
 * **THE PREDICATE IS `status = 'completed'`, AND IT IS THE CONTROL RATHER THAN A
 * FILTER.** `reconciliation_runs_completed_is_whole` states its own reader in
 * terms: *"a reader taking the latest completed run gets a sweep that actually
 * covered the book"*. Without the predicate this clock reads the `started_at` of
 * a sweep that died at account 2,341 of 5,000 -- `OVERVIEW` section 5.2 makes
 * that ORDINARY rather than exotic -- and reports it as a reconciliation that
 * happened. That is `ADR-199` section 5's refusal reproduced inside the table
 * built to answer it, and it is `FM-M6-01` on the panel `P-M6-09` gates every
 * other number with: *"The page must refuse to look healthy while data trust is
 * red"*. A `running` row hours old and a `failed` row are both visible through
 * `reconciliation_runs_unhealthy_idx`; neither is a run this field may date.
 *
 * **AND THE TWO NUMBERS BESIDE EACH OTHER ARE DELIBERATELY NOT THE SAME NUMBER.**
 * `mismatches_open` is a count of the CURRENT state of `reconciliations` and
 * moves when a human resolves one; `reconciliation_runs.mismatches_found` is
 * what one run saw and nothing may change it afterwards (`0064`'s fifth E2
 * note). This response carries the first, so the run row is read for its clock
 * and for nothing else.
 *
 * **NO COMPLETED RUN IS A REFUSAL AND NOT A FIELD TO FILL**, which is
 * {@link readBatch}'s answer two lines down and for the same reason. All three
 * declarations of `LiabilityResponse` type `last_run_at` a required `string`,
 * `ADR-203` puts an absence at a NULLABLE FIGURE and this member is not one, and
 * `ADR-202` ruling 3's second refusal forbids the alternative of a half-null
 * object. An estate that has never completed a reconciliation is `P-M6-09` red
 * rather than a panel with a blank on it.
 */
function readRecon(
  completedRuns: readonly unknown[],
  openMismatches: readonly unknown[],
): LiabilityBook['integrations']['recon'] {
  const lastRunAt = latestInstant(completedRuns, 'startedAt', 'a completed reconciliation run');
  if (lastRunAt === null)
    throw new AdminReadError(
      'no reconciliation run has ever completed, so `integrations.recon.last_run_at` has no ' +
        'source. 0064 records the sweep and reconciliation_runs_completed_is_whole is what makes ' +
        'a completed row trustworthy; an estate holding none has not reconciled, which P-M6-09 ' +
        'renders above every figure on this page rather than beside one',
    );
  return { last_run_at: lastRunAt, mismatches_open: openMismatches.length };
}

/**
 * `integrations.batch`, off the EVENT rather than off a column (ADR-199 clause 4).
 *
 * `last_success_at` is the `occurred_at` of the latest `batch.completed` row and
 * `last_duration_ms` is that row's `payload->>'duration_ms'`, which EVENTS
 * section 5 declares in the approved catalogue. The alternative is named and
 * refused in that entry's own section 5 and in this file's header: a fold over
 * per-account clocks reports a success for a run that crashed.
 *
 * THE FILTER IS A TYPED EQUALITY ON `event_name` AND NOTHING ELSE. ADR-157
 * admits a range term on the read path and this read does not need one: bounding
 * `occurred_at` would be a retention window no document states, and the row this
 * field exists to show is the LAST one, which a lower bound is exactly able to
 * drop on the morning the producer stopped running.
 *
 * `duration_ms` IS NOT A `_cents` KEY, so ADR-198's decimal-string format does
 * not reach it and a JSON number is what EVENTS declares. It is read as one and
 * as its digits, because `assertPayloadRules` constrains what may be WRITTEN and
 * this is a read of rows some other producer wrote.
 */
function readBatch(rows: readonly unknown[]): LiabilityBook['integrations']['batch'] | null {
  if (rows.length === 0) return null;
  const at = 'the latest `batch.completed` event';
  const row = latestBy(rows, 'occurredAt', at);

  const payload = field(row, 'payload', at);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    throw new AdminReadError(
      `${at} carries a \`payload\` that is not an object, and 0017 declares the column ` +
        '`jsonb NOT NULL`. EVENTS section 5 fixes this event body at ' +
        '`{ run_id, trading_day, accounts_total, accounts_done, duration_ms }`',
    );
  const raw = (payload as Record<string, unknown>)['duration_ms'];
  const durationMs =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw)
        ? Number(raw)
        : Number.NaN;
  if (!Number.isSafeInteger(durationMs) || durationMs < 0)
    throw new AdminReadError(
      `${at} carries \`payload.duration_ms\` as ${JSON.stringify(raw)}. EVENTS section 5 declares ` +
        'it on this event body, and ADR-199 clause 4 rules it the source of `last_duration_ms`: ' +
        'a batch whose duration is unreadable is a run whose completion nothing can be checked ' +
        'against',
    );

  return { last_success_at: instant(row, 'occurredAt', at), last_duration_ms: durationMs };
}

/**
 * `gaps`, WHICH IS `ADR-203` RULING 2 AND IS BUILT FROM THE BOOK RATHER THAN
 * WRITTEN AS A CONSTANT.
 *
 * **`CUSUM_GAPS` IN `routes/admin-breaker.ts` IS A CONSTANT AND THIS IS NOT, AND
 * THE DIFFERENCE IS A CONTROL RATHER THAN A STYLE.** That endpoint has no
 * pairing validator; this response has {@link assertLiabilityGapsPaired}, which
 * refuses BOTH a `null` nothing names AND a name over a figure that is present.
 * A constant array cannot satisfy the second direction, and the case where it
 * fails is not exotic:
 *
 * **A BOOK WITH NO PLANS HAS NO ABSENT CUSUM, AND THE VALIDATOR IS WHERE THAT IS
 * DECIDED.** `plan_breaker_state` has never held a row (`ADR-167` finding 9), so
 * `per_plan` is `[]` today and the validator's `absent` set is built with
 * `.some(...)`: over an empty array nothing is null, so a gap naming
 * `per_plan[].cusum` would be a gap over a figure this response is not
 * withholding. That is the failure `ADR-203` ruling 2's second direction exists
 * for, arriving on the very first read. So the entry is conditioned on the array
 * the validator reads and not on the calibration's state.
 *
 * **THE PATH ELIDES THE INDEX AND THAT IS THE RULING RATHER THAN A SHORTHAND.**
 * One entry per absent FIGURE, and the CUSUM is absent on every plan for one
 * reason, so a per-plan entry would put the identical sentence on the body once
 * per plan and give an operator a list to read instead of a fact.
 */
function readGaps(perPlan: readonly LiabilityPlanRow[]): readonly LiabilityBookGap[] {
  const gaps: LiabilityBookGap[] = [];

  if (perPlan.some((plan) => plan.cusum === null))
    gaps.push({
      field: 'per_plan[].cusum',
      // A NAMED DELIVERABLE IS OUTSTANDING, which is the one cause `awaiting`
      // may be non-null for (ADR-203 ruling 4). Nothing in the estate is wrong.
      cause: 'awaiting_dependency',
      awaiting: 'DEP-M6-05',
      detail:
        'ADR-167 clause 5 renders the CUSUM absent until DEP-M6-05 supplies mu_0 and sigma, ' +
        'which M06 puts in Wave 4. FM-M6-07: an uncalibrated CUSUM is either constant alarms ' +
        'or none, which is the same as no chart. The statistic is recomputed at read time and ' +
        'stored nowhere (ADR-167 clause 1), so no column is owed and nothing is lost by waiting.',
    });

  return gaps;
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * The 27 leaves of `LiabilityResponse` this estate can produce, from live rows.
 *
 * `null` WHEN NO SNAPSHOT HAS BEEN WRITTEN, which is `AdminReadSource.readLiability`'s
 * own `Promise<LiabilityResponse | null>` and not a shape invented here: the
 * top-level fields ARE one `liability_snapshots` row (ADR-188 clause 1), so no
 * row is no response rather than a response of zeros. `liability_snapshots` has
 * never held a row in this tree and the empty answer is therefore the one this
 * function returns today.
 *
 * THE RESERVE IS REQUIRED ONCE A SNAPSHOT EXISTS AND THAT IS DELIBERATE.
 * `reserve` is `ADR-188` clause 4's group and every member of it is non-optional
 * on the wire; a book that dropped the group would be a `LiabilityResponse`
 * missing eight paths for a reason no clearing condition names. A liability
 * snapshot with no coverage snapshot behind it is a producer that wrote half a
 * book, and `P-M6-07` cannot be rendered from the half.
 *
 * EACH ARM IS ITS OWN READ AND THEY ARE NOT ONE QUERY. The two `as_of` values
 * are two clocks by construction (`data-model/liability_snapshots.md`: "one row
 * forces one `as_of` on two sources that do not move together"), so the reserve
 * row is the latest reserve row and never the one nearest the book's instant.
 */
export async function readLiabilityBook(tx: LiabilityTx): Promise<LiabilityBookResult | null> {
  const snapshots = await tx.rows('liabilitySnapshots');
  if (snapshots.length === 0) return null;
  const snapshot = latestBy(snapshots, 'asOf', 'liability snapshot');

  const reserves = await tx.rows('reserveCoverageSnapshots');
  if (reserves.length === 0)
    throw new AdminReadError(
      'a liability snapshot exists and no reserve coverage snapshot does, so `reserve` has no ' +
        'row. ADR-188 clause 4 puts eight non-optional paths on that group and P-M6-07 is the ' +
        'panel that cannot be drawn without them',
    );
  const reserve = latestBy(reserves, 'asOf', 'reserve coverage snapshot');

  const anchorCode = text(reserve, 'treasuryAccountCode', 'the reserve coverage snapshot');
  const anchors = await readTreasuryAnchor(
    tx,
    anchorCode,
    field(reserve, 'treasuryAsOf', 'the reserve coverage snapshot'),
  );
  if (anchors.length !== 1)
    throw new AdminReadError(
      `the reserve coverage snapshot names treasury balance \`${anchorCode}\` and ` +
        `${anchors.length} rows carry that (account_code, as_of). 0049's anchor foreign key is ` +
        'ON DELETE RESTRICT and 0009 makes the pair a PRIMARY KEY, so neither zero nor two is a ' +
        'state this schema admits',
    );

  const [breakerRows, planRows, midHealthRows, openMismatches, completedRuns, batchRows] = [
    await tx.rows('planBreakerState'),
    await tx.rows('plans'),
    await tx.rows('midHealth'),
    await tx.rowsWhere('reconciliations', { status: 'mismatch' }),
    // THE PREDICATE IS THE CONTROL AND IT IS APPLIED AT THE ACCESSOR. A typed
    // equality on a closed column, which is what ADR-157 admits on the read
    // path, and it is the same shape as the two reads either side of it.
    await tx.rowsWhere('reconciliationRuns', { status: 'completed' }),
    await tx.rowsWhere('events', { eventName: 'batch.completed' }),
  ];

  const batch = readBatch(batchRows);
  if (batch === null)
    throw new AdminReadError(
      'no `batch.completed` event has ever been recorded, so `integrations.batch` has no source. ' +
        'ADR-199 clause 4 rules those two figures the event rather than a column, and RB-01 ' +
        "already reads the batch's success off that event's absence: the absence is an incident " +
        'rather than a field to fill',
    );

  const perPlan = readPerPlan(breakerRows, planRows);

  return {
    book: {
      ...readSnapshot(snapshot),
      reserve: readReserve(reserve, anchors[0]),
      per_plan: perPlan,
      integrations: {
        mid_health: readMidHealth(midHealthRows),
        // A COUNT OF A STATE AND A CLOCK, WHICH IS `B4` LIFTED. `status =
        // 'mismatch'` is what `0014` declares open and `resolved` and `match`
        // are the other two; the clock is the newest COMPLETED run of `0064`.
        recon: readRecon(completedRuns, openMismatches),
        batch,
      },

      // THE BOOK SPEAKS `ADR-203`'s SPELLING NOW AND NO LONGER ITS OWN. It used
      // to say a figure was absent by OMITTING the group, which is what
      // `LiabilityBook`'s `Omit` list was, and this array was `[]` because a
      // book that omits carries no null and therefore no gap. Those were two
      // spellings of one fact and only one of them can be served. The `Omit`
      // list is one entry long now and every absence below it is a `null` with
      // a reason, which is what `assertLiabilityGapsPaired` reads.
      gaps: readGaps(perPlan),
    },
    cost: {
      liabilitySnapshotsScanned: snapshots.length,
      reserveSnapshotsScanned: reserves.length,
      treasuryAnchorsMatched: anchors.length,
      planBreakerRowsScanned: breakerRows.length,
      plansScanned: planRows.length,
      midHealthRowsScanned: midHealthRows.length,
      openMismatchesScanned: openMismatches.length,
      completedReconRunsScanned: completedRuns.length,
      batchCompletedScanned: batchRows.length,
    },
  };
}

// -----------------------------------------------------------------------------
// The trading-day horizon, which is the half of `eligible_next_7d` B1 unblocked
// -----------------------------------------------------------------------------
// `eligible_next_7d` IS TWO FOLDS AND B1 CLEARED ONE OF THEM. The group is
// `{ total_cents, account_count, by_day: [{ trading_day, cents, accounts }] }`,
// and producing it needs the NEXT SEVEN TRADING DAYS (this section) and then a
// PER-ACCOUNT ELIGIBILITY FORECAST over them (blocker B5, in the header). The
// first is ordinary code the moment `trading_calendar` is a `TableKey`, which
// session 377 made it. The second is not, and the two are separated here so the
// session that clears B5 inherits the calendar work already done and executed.
//
// "NEXT 7 DAYS" OVER CALENDAR DAYS AND OVER TRADING DAYS ARE DIFFERENT ANSWERS
// AND THE DIFFERENCE IS EVERY WEEKEND AND EVERY HOLIDAY. `M01` R-02 fixes which
// one this corpus means: gap counting is calendar subtraction, "never date
// arithmetic", and `AS-06` records what date arithmetic costs, that five trading
// days is 7 calendar days in June and 9 to 10 across the year-end cluster. So
// nothing below adds a day to a date. Every day of the horizon is a ROW of
// `trading_calendar`, read in order.
//
// -----------------------------------------------------------------------------
// AN EXHAUSTED CALENDAR MUST SAY SO, WHICH IS THE WHOLE OF ADR-042 F-4
// -----------------------------------------------------------------------------
// F-4 is the finding this section is shaped by, and it is worth quoting because
// the failure it names is the one a careless horizon walk reproduces exactly:
// coverage had no storage, so "an exhausted calendar is indistinguishable from
// an unbroken holiday: every counter quietly stops advancing, no rule fires,
// nothing breaches, nothing becomes eligible, and NOTHING RAISES".
//
// `0032` answered it with `trading_calendar_loads`, whose `coverage_start_day`
// and `coverage_end_day` are the interval a load is entitled to answer for. So
// THE TWO TABLES ARE READ TOGETHER AND NEITHER IS SUFFICIENT: `trading_calendar`
// says which days are sessions, `trading_calendar_loads` says which days the
// estate has an opinion about at all, and a day outside the second is UNKNOWN
// rather than a holiday. `packages/rules-engine/src/calendar.ts` states the same
// separation one layer up as `not_a_session` against `outside_coverage`, and its
// own words are that they "differ and only one of them is safe to act on".
//
// **RUNNING OUT IS A VALUE HERE AND NEVER A SHORT ARRAY.** {@link TradingHorizon}
// is a discriminated union whose `exhausted` arm carries the days it did find,
// the day coverage runs through, and how many short it is. A `by_day` of four
// entries where seven were asked for is a liability panel that understates the
// figure the payout wallet is funded against (`EC-074`, `P-M6-02`) and looks
// exactly like a quiet week.
//
// **AND A SESSION ROW PAST THE COVERAGE EDGE IS NOT TAKEN**, which is the one
// case where the two tables disagree and the ruling has to be stated rather than
// implied. `nextTradingDayAfter` rules it one layer up in terms: "THE LAST DAY
// IN `days` IS A MISS EVEN WHEN COVERAGE EXTENDS PAST IT", because coverage says
// the slice can answer "is this day a session", not "is there another session
// after this one". The mirror case is this one, and it takes the same answer:
// coverage is the authority on what may be answered, so the walk stops at
// `coveredThroughDay` whatever rows happen to sit past it.
// -----------------------------------------------------------------------------

/**
 * The tables the horizon reads, both of them, and NEITHER ALONE IS ENOUGH.
 *
 * Both are `firm` in `packages/db/src/scope.ts` and both arrived at the same
 * moment for this module's purposes: `tradingCalendarLoads` has been registered
 * since `ADR-092`, and `tradingCalendar` is session 377's registration under
 * `ADR-103` clause 2. `LIABILITY_READ_TABLES` carries both.
 */
export const TRADING_CALENDAR_TABLES = ['tradingCalendar', 'tradingCalendarLoads'] as const;

/**
 * Seven, and it is `EC-074`'s number rather than this module's.
 *
 * `EC-074` defines bounded near-term liability over "accounts eligible now or
 * inside 7 trading days" and `P-M6-02` restates it as "currently eligible or
 * become eligible inside 7 trading days". `0009`'s own column comment on
 * `bounded_near_term_cents` says the same thing a third time. The field name
 * `eligible_next_7d` is the fourth.
 */
export const ELIGIBLE_HORIZON_TRADING_DAYS = 7;

/**
 * One day of the horizon, as the calendar stores it.
 *
 * `is_half_day` AND `halted` ARE CARRIED AND NEITHER EXCLUDES A DAY, which is
 * the pair a reader is most likely to filter on by mistake. `0004`: a half day
 * "counts as a FULL DAY (B4 #3)", because "a half day that counted as half a day
 * would make the minimum-trading-days gate a different promise in November"; and
 * on a halted session "day counters advance and win days do NOT (B4 #2)", so a
 * halted day is a trading day that a trader cannot earn a win day on. ONLY
 * `is_holiday` REMOVES A DAY FROM THE CALENDAR, and after `0032` a holiday is a
 * positive fact rather than an absence.
 */
export interface HorizonDay {
  readonly trading_day: string;
  readonly is_half_day: boolean;
  readonly halted: boolean;
}

/**
 * What a horizon walk can answer, and the three answers are genuinely different.
 *
 * `calendar.ts`'s `CalendarLookup` is the shape and its reason applies here
 * unchanged: collapsing "there are no more sessions" into "here are the four I
 * found" is `ADR-042` F-4's silent failure with a number attached to it.
 *
 *   `resolved`   exactly `span` sessions, every one inside coverage
 *   `exhausted`  fewer than `span`, and it says how many and through what day
 *   `uncovered`  the estate has no opinion about the anchor day at all
 */
export type TradingHorizon =
  | {
      readonly kind: 'resolved';
      readonly anchor_day: string;
      readonly covered_through_day: string;
      readonly days: readonly HorizonDay[];
    }
  | {
      readonly kind: 'exhausted';
      readonly anchor_day: string;
      readonly covered_through_day: string;
      readonly days: readonly HorizonDay[];
      readonly short_by: number;
      readonly detail: string;
    }
  | { readonly kind: 'uncovered'; readonly anchor_day: string | null; readonly detail: string };

/** What the horizon read cost, in rows. `LiabilityReadCost`'s idiom. */
export interface TradingHorizonCost {
  readonly calendarRowsScanned: number;
  readonly calendarLoadsScanned: number;
  readonly coveredIntervals: number;
}

/** {@link readTradingHorizon}'s answer. */
export interface TradingHorizonResult {
  readonly horizon: TradingHorizon;
  readonly cost: TradingHorizonCost;
}

/** ADR-112's keyed accessor over the two calendar tables, READ HALF ONLY. */
export interface TradingCalendarTx {
  rows(key: (typeof TRADING_CALENDAR_TABLES)[number]): Promise<unknown[]>;
}

/**
 * One `trading_calendar` row, with `0032`'s CHECK asserted in BOTH directions.
 *
 * `trading_calendar_holiday_has_no_session` is `CHECK (is_holiday = (session_open_at
 * IS NULL))`, an equality between two booleans and therefore a constraint in both
 * directions at once. It is re-asserted here rather than trusted, and the reason
 * is `0032` itself: the constraint was ADDED by that migration to a table `0004`
 * created without it, so rows predating it are exactly what it was written to
 * make impossible, and a merged migration is never edited (constitution E2), only
 * superseded. A holiday carrying a fabricated session interval is `F-1`'s defect,
 * and `R-01` is a CONTAINMENT lookup, so a fabricated interval is an interval a
 * fill can fall inside.
 */
function horizonRow(row: unknown): {
  readonly day: string;
  readonly isHoliday: boolean;
  readonly closeMs: number | null;
  readonly openMs: number | null;
  readonly entry: HorizonDay;
} {
  const at = 'a trading calendar row';
  const tradingDay = day(row, 'tradingDay', at);
  const isHoliday = flag(row, 'isHoliday', at);
  const openAt = field(row, 'sessionOpenAt', at);
  const closeAt = field(row, 'sessionCloseAt', at);
  const sessionless = openAt === null || openAt === undefined;
  const closeless = closeAt === null || closeAt === undefined;

  if (isHoliday !== sessionless || isHoliday !== closeless)
    throw new AdminReadError(
      `the trading calendar carries ${tradingDay} with \`is_holiday\` ${String(isHoliday)} and a ` +
        `session interval that is ${sessionless && closeless ? 'absent' : 'present'}. 0032's ` +
        '`trading_calendar_holiday_has_no_session` makes those the same fact in both directions, ' +
        'and R-01 is a containment lookup, so a holiday carrying a fabricated session is an ' +
        'interval a fill can fall inside',
    );

  if (isHoliday)
    return {
      day: tradingDay,
      isHoliday: true,
      closeMs: null,
      openMs: null,
      entry: { trading_day: tradingDay, is_half_day: false, halted: false },
    };

  const openMs = instantMs(row, 'sessionOpenAt', `the trading calendar row for ${tradingDay}`);
  const closeMs = instantMs(row, 'sessionCloseAt', `the trading calendar row for ${tradingDay}`);
  if (!(closeMs > openMs))
    throw new AdminReadError(
      `the trading calendar carries ${tradingDay} with a session that closes at or before it ` +
        "opens. 0032's `trading_calendar_session_ordered` forbids that, and the anchor below is " +
        'the latest session that has CLOSED, so an inverted interval moves the day the horizon ' +
        'starts from',
    );

  return {
    day: tradingDay,
    isHoliday: false,
    closeMs,
    openMs,
    entry: {
      trading_day: tradingDay,
      is_half_day: flag(row, 'isHalfDay', at),
      halted: flag(row, 'halted', at),
    },
  };
}

/**
 * The covered intervals of `trading_calendar_loads`, MERGED and sorted.
 *
 * MERGED RATHER THAN UNIONED FLAT, because two loads that abut or overlap cover
 * the days between them and two loads with a gap DO NOT. `0032` puts one row per
 * load with its own `coverage_start_day` and `coverage_end_day` and declares no
 * supersession column, so a load is a positive statement that this range was
 * loaded and never a statement that another range was not. The gap between two
 * disjoint loads is therefore UNKNOWN, which is `F-4`'s answer and not an
 * interpolation this function is entitled to make.
 */
function coveredIntervals(rows: readonly unknown[]): readonly { from: string; to: string }[] {
  const at = 'a trading calendar load';
  const spans = rows
    .map((row) => ({
      from: day(row, 'coverageStartDay', at),
      to: day(row, 'coverageEndDay', at),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const merged: { from: string; to: string }[] = [];
  for (const span of spans) {
    if (span.to < span.from)
      throw new AdminReadError(
        `a trading calendar load declares coverage ${span.from}..${span.to}, which ends before ` +
          'it starts. A backwards coverage interval covers no day at all and would silently ' +
          'make every day of the horizon UNKNOWN',
      );
    const last = merged[merged.length - 1];
    // ADJACENT IS NOT OVERLAPPING AND IS NOT MERGED. `2026-01-01..2026-06-30`
    // and `2026-07-01..2026-12-31` are two loads with no day between them, and
    // merging them on a date successor would be the date arithmetic R-02
    // forbids. They stay two intervals; the walk below crosses neither, because
    // it stops at the end of the interval holding the anchor. A load that means
    // to extend coverage overlaps by a day, which is a fact its own row states.
    if (last !== undefined && span.from <= last.to) {
      if (span.to > last.to) last.to = span.to;
      continue;
    }
    merged.push({ from: span.from, to: span.to });
  }
  return merged;
}

/**
 * The greatest `trading_day` whose session has CLOSED at or before the instant.
 *
 * A TIE IS IMPOSSIBLE AND IS BROKEN ANYWAY. `trading_day` is the PRIMARY KEY of
 * `trading_calendar` and `session_close_at` moves with it, so two days cannot
 * share a close; the later day wins if they ever do, because the anchor is a DAY
 * and the later one is the one a horizon must start after. `latestBy` above
 * refuses its tie instead, and the difference is which fact a unique index
 * carries: there it is an index on the folded column itself.
 */
function lastClosedDay(
  parsed: readonly { readonly day: string; readonly closeMs: number | null }[],
  asOfMs: number,
): string | null {
  let anchor: string | null = null;
  let anchorCloseMs = Number.NEGATIVE_INFINITY;
  for (const row of parsed) {
    if (row.closeMs === null || row.closeMs > asOfMs) continue;
    if (row.closeMs < anchorCloseMs) continue;
    if (row.closeMs === anchorCloseMs && anchor !== null && row.day <= anchor) continue;
    anchorCloseMs = row.closeMs;
    anchor = row.day;
  }
  return anchor;
}

/**
 * One `trading_calendar` row as {@link horizonRow} parsed it.
 *
 * `ReturnType` RATHER THAN A SECOND DECLARATION, on `LiabilityBook`'s reason one
 * scale down: a hand-written copy of this shape would go stale the first time
 * the parser carried a fourth fact.
 */
type ParsedCalendarRow = ReturnType<typeof horizonRow>;

/**
 * The span refusal, ONE COPY, because two walks take a span and refuse it alike.
 *
 * THE NUMBERS DIFFER AND THE PROPERTY DOES NOT. `EC-074` fixes the FORWARD
 * horizon at 7 ({@link ELIGIBLE_HORIZON_TRADING_DAYS}); `ADR-201` ruling 3 fixes
 * the TRAILING windows at 7 and 30. A span that is not a positive whole number
 * of trading days is not a window in either direction.
 */
function refuseSpan(span: number, walk: string): void {
  if (!Number.isSafeInteger(span) || span < 1)
    throw new AdminReadError(
      `a ${walk} of ${JSON.stringify(span)} trading days was asked for. EC-074 fixes the forward ` +
        'horizon at 7 and ADR-201 ruling 3 fixes the trailing windows at 7 and 30, and a span ' +
        'that is not a positive whole number of trading days is not a window in either direction',
    );
}

/** {@link anchorCalendar}'s answer: a day to walk from, or the reason there is none. */
type CalendarAnchor =
  | {
      readonly kind: 'anchored';
      readonly cost: TradingHorizonCost;
      readonly parsed: readonly ParsedCalendarRow[];
      readonly anchorDay: string;
      readonly covering: { readonly from: string; readonly to: string };
    }
  | {
      readonly kind: 'uncovered';
      readonly cost: TradingHorizonCost;
      readonly anchor_day: string | null;
      readonly detail: string;
    };

/**
 * The last closed trading day, the load interval covering it, and every calendar
 * row, read once.
 *
 * **EXTRACTED SO THE TWO WALKS CANNOT DRIFT APART, AND THAT IS THE WHOLE REASON
 * IT EXISTS.** {@link readTradingHorizon} walks FORWARD off this anchor and
 * {@link readTradingLookback} walks BACKWARD off the same one. A second
 * transcription of "which day is the snapshot's" would be two answers to one
 * question inside one module, which is the shape `ADR-201` names one level up as
 * `B2`: the missing half "invented differently by every implementation that
 * meets it". The anchor rule, the coverage rule and the three `uncovered`
 * answers are therefore written ONCE and shared by identity rather than by
 * resemblance.
 *
 * THE ANCHOR IS ALWAYS A SESSION DAY AND NEVER A HOLIDAY, which the trailing
 * walk depends on and the forward walk does not. {@link lastClosedDay} reads
 * only rows carrying a `closeMs`, and {@link horizonRow} gives a holiday a
 * `closeMs` of `null` on `0032`'s two-way CHECK. So the anchor is a day
 * `ADR-201` ruling 3 may count as the first of the trailing thirty; a holiday
 * anchor would make the inclusive window start on a day that is not a trading
 * day at all.
 */
async function anchorCalendar(tx: TradingCalendarTx, asOf: string): Promise<CalendarAnchor> {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs))
    throw new AdminReadError(
      `the window was anchored at ${JSON.stringify(asOf)}, which is not an instant. INV-M6-04 ` +
        'makes every number on this page name its as-of moment, and a window whose own edge is ' +
        'unstated is a span of days measured from nothing',
    );

  const calendarRows = await tx.rows('tradingCalendar');
  const loadRows = await tx.rows('tradingCalendarLoads');
  const intervals = coveredIntervals(loadRows);
  const cost: TradingHorizonCost = {
    calendarRowsScanned: calendarRows.length,
    calendarLoadsScanned: loadRows.length,
    coveredIntervals: intervals.length,
  };

  // NO LOAD IS NOT AN EMPTY CALENDAR, AND THIS IS THE BRANCH F-4 EXISTS FOR. A
  // `trading_calendar` full of rows and a `trading_calendar_loads` with none is
  // an estate that has days and no record of having loaded them, so it is
  // entitled to answer for none of them.
  if (intervals.length === 0)
    return {
      kind: 'uncovered',
      cost,
      anchor_day: null,
      detail:
        `${String(calendarRows.length)} trading calendar rows are present and no ` +
        '`trading_calendar_loads` row declares coverage for any of them. ADR-042 F-4 makes ' +
        'coverage a stored fact precisely so this is a positive answer rather than an ' +
        'unbroken run of non-holidays',
    };

  const parsed = calendarRows.map(horizonRow);
  const anchorDay = lastClosedDay(parsed, asOfMs);

  if (anchorDay === null)
    return {
      kind: 'uncovered',
      cost,
      anchor_day: null,
      detail:
        `no trading calendar session has closed at or before ${asOf}, so there is no last ` +
        'closed day to measure a window from. P-M6-01 dates this figure at "the last closed ' +
        'day" (INV-M6-11) and the calendar holds no such day',
    };

  const covering = intervals.find(
    (interval) => anchorDay >= interval.from && anchorDay <= interval.to,
  );
  if (covering === undefined)
    return {
      kind: 'uncovered',
      cost,
      anchor_day: anchorDay,
      detail:
        `the last closed trading day is ${anchorDay} and no \`trading_calendar_loads\` row ` +
        `covers it. The ${String(intervals.length)} covered interval(s) are ` +
        `${intervals.map((i) => `${i.from}..${i.to}`).join(', ')}. A day outside coverage is ` +
        'UNKNOWN and never a holiday (ADR-042 F-4)',
    };

  return { kind: 'anchored', cost, parsed, anchorDay, covering };
}

/**
 * The next `span` TRADING DAYS after the last closed session, or the reason there
 * are not that many.
 *
 * THE ANCHOR IS THE LATEST SESSION THAT HAS CLOSED, AND THAT IS `P-M6-01`'s OWN
 * PHRASE. `liability_snapshots` carries `as_of timestamptz` and NO `trading_day`
 * column, so the instant has to be resolved to a day through the calendar rather
 * than by taking its UTC date, which is the error `day()` above refuses one
 * value at a time: the exchange trading day is a CT session and never a UTC
 * calendar date. `P-M6-01` fixes the figure "as of the last closed day"
 * (`INV-M6-11`), so the anchor is the greatest `trading_day` whose
 * `session_close_at` is at or before `asOfMs`. A session still OPEN is not a
 * closed day and is not the anchor; it is the first day of the horizon.
 *
 * THE WALK IS STRICTLY AFTER THE ANCHOR, on `AS-12`'s reason applied one field
 * over. `nextTradingDayAfter`'s docblock records what including the anchor costs
 * on the consistency period: "the very day that funded a payout counts against
 * the next cycle ... it looks like the consistency rule working rather than a
 * bug". Here it would put a day the snapshot already accounts for into the
 * forecast of what has not happened yet. **{@link readTradingLookback} IS
 * INCLUSIVE OF THE SAME ANCHOR AND THAT IS NOT AN INCONSISTENCY**: a forecast of
 * what has not happened excludes the day that has, and a trailing measurement of
 * what has happened includes it. `ADR-201` ruling 3 rules the second in terms.
 *
 * NO DAY IS COMPUTED. Every returned day is a row this function read, filtered
 * to `is_holiday = false` and taken in ascending order. The accessor offers no
 * `ORDER BY` and no `LIMIT` (`ADR-112`, `ADR-157`), so the sort is here, on the
 * same reading as `latestBy` above.
 */
export async function readTradingHorizon(
  tx: TradingCalendarTx,
  asOf: string,
  span: number = ELIGIBLE_HORIZON_TRADING_DAYS,
): Promise<TradingHorizonResult> {
  refuseSpan(span, 'horizon');

  const anchor = await anchorCalendar(tx, asOf);
  if (anchor.kind === 'uncovered')
    return {
      horizon: { kind: 'uncovered', anchor_day: anchor.anchor_day, detail: anchor.detail },
      cost: anchor.cost,
    };

  const { parsed, anchorDay, covering, cost } = anchor;

  // THE WALK. Sessions strictly after the anchor and no later than the day
  // coverage runs through, ascending, and at most `span` of them. Every bound
  // here is a comparison between two `YYYY-MM-DD` strings, which is
  // chronological order with no arithmetic (`calendar.ts`: "every day comparison
  // in the engine is lexicographic on a zero-padded ISO day").
  const days = parsed
    .filter((row) => !row.isHoliday && row.day > anchorDay && row.day <= covering.to)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(0, span)
    .map((row) => row.entry);

  if (days.length < span)
    return {
      horizon: {
        kind: 'exhausted',
        anchor_day: anchorDay,
        covered_through_day: covering.to,
        days,
        short_by: span - days.length,
        detail:
          `${String(span)} trading days were asked for after ${anchorDay} and the calendar holds ` +
          `${String(days.length)} inside coverage, which runs through ${covering.to}. ADR-042 ` +
          'F-4: an exhausted calendar is otherwise indistinguishable from an unbroken holiday, ' +
          'and OQ-SE-02 puts the horizon alarm at six months for this reason',
      },
      cost,
    };

  return {
    horizon: {
      kind: 'resolved',
      anchor_day: anchorDay,
      covered_through_day: covering.to,
      days,
    },
    cost,
  };
}

// -----------------------------------------------------------------------------
// THE TRAILING WALK, WHICH IS ADR-201 RULING 3 AND IS NOT THE HORIZON REVERSED
// -----------------------------------------------------------------------------
// `ADR-201` ruling 3: "The numerator is the 7 trading days ending at the trading
// day of the snapshot's `as_of`, inclusive of that day. The denominator is the
// 30 trading days ending at the same day, inclusive."
//
// **THREE THINGS DIFFER FROM {@link readTradingHorizon} AND EACH IS RULED RATHER
// THAN PREFERRED**, which is why the walk is written out instead of being the
// forward one with a flipped comparison hidden in it:
//
//   1. THE ANCHOR IS INCLUDED. The horizon is strictly after it and this is
//      inclusive of it, because a forecast of what has not happened excludes the
//      day that has and a measurement of what has happened does not.
//   2. THE BOUND IS `covering.from` RATHER THAN `covering.to`. Coverage is the
//      authority on what may be answered in BOTH directions (`ADR-042` F-4), and
//      the mirror of "a session row past the coverage edge is not taken" is that
//      a session row BEFORE the covered interval is not taken either.
//   3. RUNNING OUT MEANS SOMETHING ELSE. A short forward horizon understates a
//      forecast; a short TRAILING window understates the DENOMINATOR of a ratio,
//      and a denominator scaled from 12 trading days as though it were 30 makes
//      the pager fire on an ordinary week. So `exhausted` is a verdict here and
//      never a shorter array, on the same reading and a sharper consequence.
//
// **A LOOKBACK OF `span` DAYS IS EXHAUSTED WHENEVER THE CALENDAR HOLDS FEWER
// THAN `span` SESSIONS INSIDE COVERAGE**, and at launch that is the ordinary
// case rather than an error: the thirtieth trading day back does not exist until
// the estate has thirty of them. `ADR-201` section 7 answers an empty
// DENOMINATOR and cannot answer an absent WINDOW, because a window that is not
// there is not a figure at all.
// -----------------------------------------------------------------------------

/**
 * What a trailing walk can answer, and the three answers are genuinely different.
 *
 * {@link TradingHorizon}'s shape with the coverage edge on the other side.
 * `covered_from_day` is the first day of the interval covering the anchor, which
 * is the day the walk stops at, and it is a different fact from
 * `covered_through_day`: one says how far back the estate has an opinion and the
 * other how far forward.
 *
 *   `resolved`   exactly `span` sessions, ascending, the anchor last
 *   `exhausted`  fewer than `span`, and it says how many and from what day
 *   `uncovered`  the estate has no opinion about the anchor day at all
 */
export type TradingLookback =
  | {
      readonly kind: 'resolved';
      readonly anchor_day: string;
      readonly covered_from_day: string;
      readonly days: readonly HorizonDay[];
    }
  | {
      readonly kind: 'exhausted';
      readonly anchor_day: string;
      readonly covered_from_day: string;
      readonly days: readonly HorizonDay[];
      readonly short_by: number;
      readonly detail: string;
    }
  | { readonly kind: 'uncovered'; readonly anchor_day: string | null; readonly detail: string };

/** {@link readTradingLookback}'s answer. */
export interface TradingLookbackResult {
  readonly lookback: TradingLookback;
  readonly cost: TradingHorizonCost;
}

/**
 * The `span` TRADING DAYS ENDING AT the last closed session, INCLUSIVE of it.
 *
 * `ADR-201` ruling 3 in code, and nothing here chooses anything: the anchor rule
 * is {@link anchorCalendar}'s and is shared with the forward walk by identity,
 * the day unit is the ruling's, and the inclusivity is the ruling's own word.
 *
 * THE DAYS COME BACK ASCENDING WITH THE ANCHOR LAST, which is the order the
 * forward walk uses and the order a reader of a window expects. The `slice`
 * takes the `span` days NEAREST the anchor, so the sort is descending and the
 * reversal is at the end; taking an ascending slice would return the OLDEST
 * `span` days of coverage, which is a window over the wrong month and looks
 * exactly right in review.
 *
 * NO DAY IS COMPUTED HERE EITHER. Every returned day is a row this function
 * read, filtered to `is_holiday = false`, and every bound is a lexicographic
 * comparison between two `YYYY-MM-DD` strings.
 */
export async function readTradingLookback(
  tx: TradingCalendarTx,
  asOf: string,
  span: number,
): Promise<TradingLookbackResult> {
  refuseSpan(span, 'lookback');

  const anchor = await anchorCalendar(tx, asOf);
  if (anchor.kind === 'uncovered')
    return {
      lookback: { kind: 'uncovered', anchor_day: anchor.anchor_day, detail: anchor.detail },
      cost: anchor.cost,
    };

  const { parsed, anchorDay, covering, cost } = anchor;

  const days = parsed
    .filter((row) => !row.isHoliday && row.day <= anchorDay && row.day >= covering.from)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, span)
    .map((row) => row.entry)
    .reverse();

  if (days.length < span)
    return {
      lookback: {
        kind: 'exhausted',
        anchor_day: anchorDay,
        covered_from_day: covering.from,
        days,
        short_by: span - days.length,
        detail:
          `${String(span)} trading days were asked for ending at ${anchorDay} and the calendar ` +
          `holds ${String(days.length)} inside coverage, which begins at ${covering.from}. ` +
          'ADR-042 F-4: an exhausted calendar is otherwise indistinguishable from an unbroken ' +
          'holiday, and a denominator scaled from fewer days than it claims is a pager firing ' +
          'on an ordinary week',
      },
      cost,
    };

  return {
    lookback: {
      kind: 'resolved',
      anchor_day: anchorDay,
      covered_from_day: covering.from,
      days,
    },
    cost,
  };
}
