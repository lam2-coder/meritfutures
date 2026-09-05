// =============================================================================
// apps/worker/src/batch/statistics-adapter.ts
// =============================================================================
// **M12'S STATISTICS RUN, OVER THE ONE DOOR. THE PORTS THIS DEPLOYMENT CAN
// SERVE, AND THE TWO IT REFUSES BY NAME.**
//
// `batch/adapter.ts` is this file's sibling and its precedent: the fold is
// written against ports, the ports are implemented here, and the implementation
// reaches the database through `src/db.ts` and through nothing else. What is
// different here is that the sibling implements every port it declares and this
// one does NOT, so the shape of the gap is the first thing the header owes.
//
// -----------------------------------------------------------------------------
// THE ADAPTER IS TOTAL OR THE RUN DOES NOT PUBLISH, AND THAT IS THE RULING
// -----------------------------------------------------------------------------
// `runStatisticsRun` reads ALL FIVE fact sets for every window it touches,
// before it knows which statistic wants which, and memoizes them per window.
// So a read port that refuses does not remove one statistic from the run: it
// ends the run. **THAT TOTALITY IS CORRECT RATHER THAN INCIDENTAL AND THIS FILE
// DEPENDS ON IT.** `FM-M12-02` is "a halt publishes NOTHING and pages. It never
// publishes a partial set, BECAUSE A PARTIAL SET IS A SELECTED SET, and
// selection is the failure this module exists to prevent", and a run that
// published only the statistics whose facts happened to be constructible would
// be exactly that set with the selection made by an adapter instead of by a
// person. Nobody would have chosen it and nothing would report it.
//
// The corpus states the same coupling once more, in `ports.ts`, and it lands on
// one of the two refusals below: "`ST-06` EXISTS BECAUSE `ST-05` WITHOUT IT IS
// A LIE BY OMISSION." `ST-05` is servable here and `ST-06` is not, so an
// adapter that answered five ports and shrugged at the sixth would publish
// Merit's near-zero internal leg with the multi-day external one missing. The
// eager read is what stops that, and it stops it without a line of policy.
//
// -----------------------------------------------------------------------------
// WHAT THIS DEPLOYMENT CAN SERVE, MEASURED AGAINST THE COLUMNS
// -----------------------------------------------------------------------------
//   `effectiveDefinitions`   `statistic_definitions`, whole registry, with
//                            `INV-M12-07`'s predicate applied here because the
//                            port says the adapter owes it.
//   `evaluationOutcomes`     `accounts`, plus the plan catalogue for the grain
//                            key. `ST-01`.
//   `settledPayouts`         `payout_requests` at `status = 'settled'`, plus
//                            the WALLET CREDIT that is the recognition point.
//                            `ST-03`, `ST-04`, `ST-05`.
//   `eligibleRequests`       `payout_requests`, every row, because a request
//                            that failed a gate was never written. `ST-07`.
//   `publishRun`             one call, one transaction, every row.
//
// AND THE THREE IT REFUSES:
//
//   `fundedLives`            `ST-02`'s denominator has a second part and no
//                            column, no plan rule and no config row carries it.
//   `withdrawalSettlements`  `ST-06` anchors on a TRADING DAY and a rail
//                            settlement is not an exchange event.
//   `raiseStatisticsHalt`    the event sink this deployable does not have.
//
// -----------------------------------------------------------------------------
// EVERY READ IS AN EQUALITY OR A WHOLE TABLE, WHICH IS THE SIBLING'S CONSTRAINT
// -----------------------------------------------------------------------------
// `SystemTx.rowsWhere` narrows by EQUALITY on a column or by a `FilterTerm`, and
// the term constructors live in `@merit/db`, which this file may not import
// (`ADR-165`, `test/db.test.ts`). So `effective_from <= $1` and
// `window_start_day <= effective_trading_day <= window_end_day` are applied in
// this process, over rows the accessor returned. Two of those reads GROW WITH
// THE ESTATE rather than with the window and each says so at its own site, in
// `accountsWithStoredState`'s idiom one file over: the repair is a read on
// `packages/db` and not a filter here, and it is owed before this job runs
// nightly rather than before this file lands.
//
// -----------------------------------------------------------------------------
// NO CLOCK, NO FLOAT, NO TRADING DAY DERIVED FROM AN INSTANT
// -----------------------------------------------------------------------------
// Nothing here reads a clock: the as-of day arrives on the config and every
// window bound arrives on the window. Every money value crosses as `bigint` and
// every elapsed bound crosses as whole epoch seconds, because `ADR-031` retired
// this surface's no-floats exemption and `ST-03` and `ST-04` publish MONEY ON A
// PUBLIC SURFACE.
//
// **AND NO FUNCTION HERE TURNS AN INSTANT INTO A TRADING DAY.** Every trading
// day this file returns is read off a `date` column that already holds one:
// `accounts.funded_on`, `accounts.closed_on`, `payout_requests.
// effective_trading_day`, `payout_requests.basis_trading_day`. That is what
// keeps this file off `RI-27`'s register and it is the reason
// `withdrawalSettlements` refuses rather than folding one.
// =============================================================================

import type { TradingDay } from '@merit/rules-engine';

import type { WorkerDb } from '../db.ts';
import type { BatchTx } from './adapter.ts';
import type {
  EligibleRequestFact,
  EvaluationOutcomeFact,
  PublishedStatisticRow,
  SettledPayoutFact,
  StatisticDefinitionRow,
  StatisticMeasure,
  StatisticWindow,
  StatisticsPorts,
  StatisticsReadPort,
  StatisticsWritePort,
} from './ports.ts';
import { STATISTIC_MEASURES } from './statistics.ts';

// -----------------------------------------------------------------------------
// The refusals, each with the blocker that would discharge it
// -----------------------------------------------------------------------------

/**
 * A port this deployment cannot serve, and the blocker it is waiting on.
 *
 * `BatchPortUnwired`'s shape one file over and deliberately a SECOND class
 * rather than that one imported: these two refusals are about facts Merit
 * cannot yet produce ABOUT ITSELF, and a caller catching a batch refusal has no
 * business catching a publication refusal by the same name.
 *
 * IT IS A THROW AND NOT A HALT, WHICH IS A CHOICE AND NOT AN OVERSIGHT.
 * `StatisticsHaltReason` has nine members and every one of them is about the
 * DATA or the DEFINITIONS: an unreadable window spec, a ratio with no
 * denominator, a day the engine does not vouch for. "This deployment cannot
 * serve a port" is a fact about the DEPLOYMENT, and inventing a tenth member
 * for it would put a wiring state into a vocabulary that a published surface
 * reads. The sibling adapter reaches the same conclusion for the same reason
 * and the exit code is the signal in both.
 */
export class StatisticsPortUnwired extends Error {
  /** The `StatisticsPorts` method that refused. */
  readonly port: string;

  // ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on `BatchPortUnwired`'s
  // own reason: `ADR-083` runs every deployable under
  // `node --experimental-strip-types`, and a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time while `tsc --noEmit`
  // accepts it.
  constructor(port: string, blocker: string) {
    super(
      `StatisticsPorts.${port} cannot be served by this deployment: ${blocker}. The run refuses ` +
        'rather than returning a smaller set, because a published statistic is the firm making a ' +
        'claim about its own performance and a figure computed over the part of its own ' +
        'definition that happened to be constructible is a claim nobody made.',
    );
    this.name = 'StatisticsPortUnwired';
    this.port = port;
  }
}

/** A row the accessor returned that this adapter will not read past. */
export class StatisticsRowError extends Error {
  override readonly name = 'StatisticsRowError';
}

/**
 * `fundedLives`' blocker. **`ST-02`'s DENOMINATOR HAS TWO PARTS AND NO COLUMN
 * CARRIES THE SECOND.**
 *
 * [M12-statistic-definitions] rules it: "Funded accounts whose funded life
 * ENDED in the window (first payout, breach, or closure), PLUS THOSE STILL
 * FUNDED PAST THE PLAN'S MAXIMUM PLAUSIBLE TIME-TO-FIRST-PAYOUT." `ports.ts`
 * already puts the second part on this adapter rather than on the machine,
 * because it is a PLAN PARAMETER and the machine holds no plan.
 *
 * **IT IS NOT A PLAN PARAMETER THIS TREE HAS.** `PublishedFundedPhase` declares
 * `min_trading_days`, `win_days.required_count`, `cadence_gap_trading_days`,
 * `consistency`, `buffer_bp` and the drawdown, and NONE of them is a maximum
 * plausible time to a first payout. The three that bear on it bound the EARLIEST
 * a first payout can occur, and the definition asks for the latest one that is
 * still plausible, which is a judgement about the tail of a distribution rather
 * than an arithmetic consequence of a gate. `firm_parameters` carries no such
 * row either.
 *
 * SO THE THREE WAYS TO SERVE THIS PORT TODAY ARE ALL REFUSED. Returning the
 * ENDED lives alone publishes a rate under a denominator its own method page
 * does not describe, on the one surface whose entire product is that the
 * denominator is checkable. Returning an EMPTY set publishes a suppressed
 * `below_min_sample` row saying "not yet meaningful, sample 0" when the truth is
 * that the figure cannot be computed at all, which is a stated limitation
 * standing in for a concealment. And deriving the threshold from the gates
 * above would be this worker choosing where the plausible cycle ends, which is
 * `INV-16`'s and `M12` section 1.3's line exactly.
 *
 * WHAT DISCHARGES IT IS A RULED PARAMETER AND NOT A LINE OF CODE: a value per
 * plan, taken deliberately, in the shape the corpus already uses for every other
 * launch candidate, which is a config row rather than a constant.
 */
export const FUNDED_LIVES_BLOCKER =
  "ST-02's ruled denominator is the funded lives that ENDED in the window PLUS those still " +
  "funded past the plan's MAXIMUM PLAUSIBLE TIME-TO-FIRST-PAYOUT, and no column, no key of " +
  '`plan_versions.rules` and no `firm_parameters` row carries that threshold. ' +
  '`PublishedFundedPhase` carries `min_trading_days`, `win_days.required_count` and ' +
  '`cadence_gap_trading_days`, which bound the EARLIEST a first payout can occur and say ' +
  'nothing about the latest one that is still plausible. Serving the ended part alone would ' +
  'publish a rate under a denominator its own method page does not describe, and an empty set ' +
  'would publish a `below_min_sample` suppression whose stated reason is false. The threshold ' +
  'is a launch-candidate parameter somebody sets, per plan, and this adapter will not choose it';

/**
 * `withdrawalSettlements`' blocker. **A RAIL SETTLEMENT IS NOT AN EXCHANGE
 * EVENT AND `ST-06` ANCHORS ON A TRADING DAY.**
 *
 * `WithdrawalSettlementFact.settledTradingDay` is "the trading day the
 * settlement counts for", on `G-5`'s outcome anchor, and `wallet_withdrawals`
 * carries NO trading-day column: `requested_at`, `approved_at`, `settled_at`,
 * `cancelled_at` and `frozen_at` are all `timestamptz`.
 *
 * **THE FOLD FROM AN INSTANT TO A DAY EXISTS AND IT IS NOT THE MISSING PIECE.**
 * `tradingDayAt` in `packages/rules-engine` answers a session calendar in three
 * outcomes, and the third is the one that decides this: an instant inside a
 * loaded span and inside no session is POSITIVELY `not_a_session`. A bank moves
 * money on its own hours, so a large share of settlements land on a weekend, a
 * holiday or the overnight gap, and for every one of those the fold correctly
 * answers that there is no trading day. **NO DOCUMENT RULES WHICH DAY THOSE
 * SETTLEMENTS COUNT FOR.** Rounding forward invents an anchor, rounding back
 * moves a settlement across a window boundary into a cohort it was not in, and
 * either choice is this adapter deciding a published window's membership.
 *
 * WHAT DISCHARGES IT is a ruling on the anchor, and the cheapest shape for it is
 * the one the payout leg already has: `payout_requests` carries
 * `effective_trading_day` as a stored column precisely because "the day it
 * counts FOR" is a decision taken once, at the write, by the code that knows the
 * business event. A `settled_trading_day` on `wallet_withdrawals` would be the
 * same repair, and it is a migration rather than a read.
 */
export const WITHDRAWAL_SETTLEMENTS_BLOCKER =
  'ST-06 anchors on the TRADING DAY a rail settlement counts for and `wallet_withdrawals` ' +
  'carries no trading-day column: `requested_at`, `approved_at` and `settled_at` are all ' +
  'instants. The instant-to-day fold exists (`tradingDayAt`) and answers `not_a_session` for ' +
  'every settlement a bank makes on a weekend, a holiday or an overnight gap, which is most of ' +
  'them, and no document rules which trading day such a settlement counts for. Rounding forward ' +
  'invents the anchor and rounding back moves a settlement into a window it was not in. The ' +
  'repair is the one the payout leg already has, a stored day decided at the write by the code ' +
  'that knows the event, which is a migration rather than a read';

/**
 * `raiseStatisticsHalt`'s blocker, and it is the batch's blocker unchanged.
 *
 * `M12` section 5 gives the halt `stats.run_halted` and the event PAGES.
 * `apps/worker` holds every `emit` call site in this workspace and holds NO
 * producer; `apps/api/src/events.ts` is the only composed writer and this
 * deployable declares `@merit/db` and `@merit/rules-engine` and nothing else, so
 * under `node-linker=isolated` an import of it does not resolve at all.
 * `test/event-sink.test.ts` measures both halves.
 *
 * **AND WIRING THE SINK WOULD NOT MAKE THIS ONE WRITE.** `buildEvent` refuses a
 * name that is not a row of `EVENT_CATALOGUE` (`ADR-159` clause 1), and
 * `stats.run_halted` is not one. So this port owes a catalogue row before it
 * owes an adapter, which is the same finding that suite records for three of the
 * names this deployable already emits.
 */
export const STATISTICS_HALT_SINK_BLOCKER =
  'the halt is an EVENT and this deployable has no writer for one. `apps/api/src/events.ts` is ' +
  'the only composed writer in this tree, `apps/worker` declares `@merit/db` and ' +
  '`@merit/rules-engine` and nothing else, and `stats.run_halted` is not a row of ' +
  'EVENT_CATALOGUE, so wiring a sink would leave this emit refused by name. M12 section 5 says ' +
  'the event PAGES, and a channel that swallowed it would be the silence FM-M12-02 exists to end';

// -----------------------------------------------------------------------------
// The closed vocabularies, transcribed with their DDL
// -----------------------------------------------------------------------------
// EACH IS A COLUMN'S OWN ENUM AND EACH IS TRANSCRIBED RATHER THAN IMPORTED,
// because the generated types live in `@merit/db` and this file may not name it.
// A value outside one of these lists is a THROW and never a default: a statistic
// is the firm's public claim about itself, and a row this adapter could not read
// is a row it must not average over.

/** `account_status` (`0001:47`), in the enum's own declaration order. */
const ACCOUNT_STATUSES = [
  'provisioning_pending',
  'active',
  'breached',
  'expired',
  'closed_admin',
  'closed_chargeback',
  'graduated',
] as const;

type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * The `account_status` members `ST-01`'s outcome vocabulary has no place for.
 *
 * `EvaluationOutcomeFact.outcome` is `'passed' | 'breached' | 'expired'` and the
 * definition's exclusion list is "accounts still in evaluation at window close.
 * NOTHING ELSE". An evaluation account closed under either member below is
 * neither still in evaluation nor one of the three outcomes, so the definition
 * has no place to put it and this adapter refuses rather than choosing one.
 * Counting it as expired invents an outcome; dropping it shrinks a published
 * denominator with nothing reporting the shrink.
 */
const OUTCOMES_WITH_NO_RULED_MEMBER: readonly AccountStatus[] = [
  'closed_admin',
  'closed_chargeback',
];

/**
 * `payout_status` (`0001:91`), every member of which means the request WAS
 * APPROVED.
 *
 * **THE CONSTANT IS NOT HARD-CODED AND THIS LIST IS WHY.** `ST-07` publishes
 * 100 percent structurally, because `M05`'s `INV-M5-01` has no denial path and
 * the enum has no `denied` member. `ports.ts` states the hazard: "a machine that
 * hard-coded the constant would stop being able to report the day the constant
 * stopped holding". This adapter reads the column and maps it through the list
 * below, and a value OUTSIDE the list is a throw. So the day a denial member
 * lands, this run REFUSES instead of quietly counting a denial as an approval,
 * which is the day the figure would matter.
 */
const PAYOUT_STATUSES_MEANING_APPROVED = ['approved', 'settled', 'failed', 'frozen'] as const;

/** `wallet_entries.provenance` (`SD-M20-01`, `0011:71`). `ST-05`'s recognition point. */
const WALLET_PAYOUT_PROVENANCE = 'payout';

/** `wallet_entries.direction` (`0011:52`). A payout ARRIVES in the wallet. */
const WALLET_CREDIT_DIRECTION = 'credit';

// -----------------------------------------------------------------------------
// Reading rows the accessor typed as `unknown`
// -----------------------------------------------------------------------------
// `SystemTx.rows` returns `unknown[]`, so every field below is checked at the
// boundary and a surprise is a named throw rather than an `undefined` travelling
// into a published figure. This is `batch/adapter.ts`'s idiom one file over,
// transcribed rather than exported from there: those helpers are module private
// and widening that file to share them would be a diff on a money-path adapter
// taken for a convenience.

/** A row the accessor returned, as a bag of columns. */
function asRow(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new StatisticsRowError(`a ${key} row is not an object`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, column: string, key: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new StatisticsRowError(`${key}.${column} is ${typeof value} and the column is text`);
  return value;
}

function textOrNull(row: Record<string, unknown>, column: string, key: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return text(row, column, key);
}

function count(row: Record<string, unknown>, column: string, key: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new StatisticsRowError(
      `${key}.${column} is ${JSON.stringify(value)} and the column is integer`,
    );
  return value;
}

/**
 * A `bigint` column, as a `bigint`.
 *
 * `mode: 'bigint'` on every money column in `schema.ts`, so the driver hands
 * back a `bigint` and a `number` here would mean the column was declared
 * differently from what this file believes. It is a throw rather than a
 * coercion, because a coercion is where the digits go.
 */
function cents(row: Record<string, unknown>, column: string, key: string): bigint {
  const value = row[column];
  if (typeof value !== 'bigint')
    throw new StatisticsRowError(
      `${key}.${column} is ${typeof value} and the column is bigint. A published money figure ` +
        'is never read through a number',
    );
  return value;
}

/**
 * A `date` column, as a `TradingDay`.
 *
 * **THE VALUE ARRIVES AS THE WIRE TEXT AND IS NOT PARSED HERE** (`ADR-271`,
 * `packages/db/src/client.ts`): the OID 1082 parser hands back `YYYY-MM-DD`
 * verbatim so that no `Date` is ever constructed for a calendar day. The shape
 * is checked because the brand is a lie otherwise, and `ADR-146` clause 4 is
 * the rule the shape check protects.
 */
function tradingDay(row: Record<string, unknown>, column: string, key: string): TradingDay {
  const value = text(row, column, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new StatisticsRowError(
      `${key}.${column} is ${JSON.stringify(value)} and a trading day is YYYY-MM-DD`,
    );
  return value as TradingDay;
}

function tradingDayOrNull(
  row: Record<string, unknown>,
  column: string,
  key: string,
): TradingDay | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return tradingDay(row, column, key);
}

function instant(row: Record<string, unknown>, column: string, key: string): Date {
  const value = row[column];
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new StatisticsRowError(`${key}.${column} is not a timestamp`);
  return value;
}

function instantOrNull(row: Record<string, unknown>, column: string, key: string): Date | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return instant(row, column, key);
}

function textList(row: Record<string, unknown>, column: string, key: string): readonly string[] {
  const value = row[column];
  if (!Array.isArray(value))
    throw new StatisticsRowError(`${key}.${column} is not an array and the column is text[]`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string')
      throw new StatisticsRowError(`${key}.${column}[${String(index)}] is ${typeof entry}`);
    return entry;
  });
}

function member<T extends string>(
  value: string,
  allowed: readonly T[],
  column: string,
  key: string,
): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new StatisticsRowError(
      `${key}.${column} is ${JSON.stringify(value)} and this build reads ` +
        `${allowed.join(', ')}. A value outside the declared set is refused rather than ` +
        'defaulted, because the default would become a published number',
    );
  return value as T;
}

/**
 * Whole epoch seconds, as a `bigint`.
 *
 * FLOOR AND NOT ROUND, and it is the same floor at both ends of every duration
 * this file feeds, so the elapsed value a percentile is taken over is the floor
 * of a difference of floors and never a value that grew by rounding. `ST-05` and
 * `ST-06` publish `duration_seconds`, so sub-second precision is outside the
 * published unit and discarding it here is where the discard belongs.
 */
function epochSeconds(at: Date): bigint {
  return BigInt(Math.floor(at.getTime() / 1000));
}

/** Inclusive at both ends, on string ordering, which is chronological on `YYYY-MM-DD`. */
function withinWindow(day: TradingDay, window: StatisticWindow): boolean {
  return day >= window.startDay && day <= window.endDay;
}

// -----------------------------------------------------------------------------
// The plan catalogue, which is the `plan` grain's key and nothing else
// -----------------------------------------------------------------------------
// `StatisticGrain` is `'lineup' | 'plan'` and the plan cell's key is
// `plans.code`. Two whole-table reads build it, and both tables are CONFIGURATION
// rather than estate: one row per plan and one per published version of one, so
// this is the read that does NOT grow with the number of traders.
//
// **THE UNIVERSE OF CELLS STILL COMES FROM THE FACTS AND NOT FROM HERE**, which
// `statistics.ts` states at `planCells`: a plan with no activity in the window
// produces no cell. This map answers "which plan is this row's", never "which
// plans exist".

interface PlanCatalogue {
  /** `plan_versions.id` to `plans.code`. */
  readonly codeByVersion: ReadonlyMap<string, string>;
}

async function readPlanCatalogue(tx: BatchTx): Promise<PlanCatalogue> {
  const codeByPlan = new Map<string, string>();
  for (const value of await tx.rows('plans')) {
    const row = asRow(value, 'plans');
    codeByPlan.set(text(row, 'id', 'plans'), text(row, 'code', 'plans'));
  }

  const codeByVersion = new Map<string, string>();
  for (const value of await tx.rows('planVersions')) {
    const row = asRow(value, 'planVersions');
    const planId = text(row, 'planId', 'planVersions');
    const code = codeByPlan.get(planId);
    if (code === undefined)
      throw new StatisticsRowError(
        `plan_versions.plan_id ${planId} names no row in plans. The plan grain's key is ` +
          '`plans.code` and a version whose plan is missing has no cell to be counted in',
      );
    codeByVersion.set(text(row, 'id', 'planVersions'), code);
  }

  return { codeByVersion };
}

function planCodeOf(catalogue: PlanCatalogue, planVersionId: string, at: string): string {
  const code = catalogue.codeByVersion.get(planVersionId);
  if (code === undefined)
    throw new StatisticsRowError(
      `${at} pins plan_version_id ${planVersionId} and the catalogue holds no such version. A ` +
        'fact with no plan code cannot be placed in a plan cell, and placing it in the lineup ' +
        'total alone would make the cells disagree with their own sum',
    );
  return code;
}

// -----------------------------------------------------------------------------
// `statistic_definitions`, and `INV-M12-07`'s predicate, which the port says is
// the adapter's
// -----------------------------------------------------------------------------

/** One `statistic_definitions` row, plus the two columns the predicate needs. */
interface DefinitionRow extends StatisticDefinitionRow {
  readonly id: string;
  readonly supersededBy: string | null;
}

function toDefinitionRow(value: unknown): DefinitionRow {
  const row = asRow(value, 'statisticDefinitions');
  const measures = textList(row, 'measures', 'statisticDefinitions').map(
    (entry): StatisticMeasure =>
      member(entry, STATISTIC_MEASURES, 'measures', 'statisticDefinitions'),
  );
  return {
    id: text(row, 'id', 'statisticDefinitions'),
    supersededBy: textOrNull(row, 'supersededBy', 'statisticDefinitions'),
    statCode: text(row, 'statCode', 'statisticDefinitions'),
    version: count(row, 'version', 'statisticDefinitions'),
    minSample: count(row, 'minSample', 'statisticDefinitions'),
    measures,
    grain: text(row, 'grain', 'statisticDefinitions'),
    windowSpec: text(row, 'windowSpec', 'statisticDefinitions'),
    numeratorSpec: text(row, 'numeratorSpec', 'statisticDefinitions'),
    denominatorSpec: text(row, 'denominatorSpec', 'statisticDefinitions'),
    exclusions: textList(row, 'exclusions', 'statisticDefinitions'),
    effectiveFrom: tradingDay(row, 'effectiveFrom', 'statisticDefinitions'),
  };
}

/**
 * The definitions effective for the day being published, one per `stat_code`.
 *
 * THE PREDICATE IS APPLIED HERE BECAUSE THE PORT SAYS IT MUST BE. "`INV-M12-07`'s
 * forward-only rule is a property of WHICH ROW IS RETURNED rather than of what
 * is done with it: a machine that filtered by date after the fact could be
 * handed a superseded row and would publish under it."
 *
 * EFFECTIVE IS TWO CLAUSES AND THE SECOND ONE IS SCOPED TO THE FIRST.
 * `effective_from <= asOfTradingDay`, and not superseded BY A ROW THAT IS ALSO
 * EFFECTIVE. A future-dated successor does not retire its predecessor before its
 * own date arrives, which is the whole content of a forward-only registry: the
 * figure published for a day in the past stays published under the definition
 * that was live on that day.
 *
 * TWO SURVIVORS FOR ONE `stat_code` IS A THROW AND NOT A CHOICE.
 * `statistic_definitions_live_uq` is `UNIQUE (stat_code) WHERE superseded_by IS
 * NULL`, so the database guarantees at most one LIVE row and guarantees nothing
 * about the effective set at an arbitrary past day: a chain whose links are
 * dated out of order can leave two, and picking the higher version would be this
 * adapter repairing a registry by guessing at its intent.
 */
function effectiveSet(rows: readonly DefinitionRow[], asOf: TradingDay): readonly DefinitionRow[] {
  const effective = rows.filter((row) => row.effectiveFrom <= asOf);
  // **THE POINTER RUNS FORWARD AND THE FIRST VERSION OF THIS READ IT
  // BACKWARDS.** `superseded_by` holds the id of the row that REPLACED this one
  // (`statistic_definitions_live_uq` is `UNIQUE (stat_code) WHERE superseded_by
  // IS NULL`, so the live row is the one pointing at nothing). Collecting the
  // pointed-AT ids and calling them retired retires the SUCCESSOR and keeps the
  // predecessor, which publishes every figure under the method it replaced. The
  // suite watched that red before this line was written.
  const effectiveIds = new Set(effective.map((row) => row.id));
  const live = effective.filter(
    (row) => row.supersededBy === null || !effectiveIds.has(row.supersededBy),
  );

  const byCode = new Map<string, DefinitionRow[]>();
  for (const row of live) {
    const bucket = byCode.get(row.statCode);
    if (bucket === undefined) byCode.set(row.statCode, [row]);
    else bucket.push(row);
  }
  for (const [statCode, bucket] of byCode) {
    if (bucket.length > 1)
      throw new StatisticsRowError(
        `statistic_definitions holds ${String(bucket.length)} rows effective for ${statCode} on ` +
          `${asOf} (versions ${bucket.map((row) => String(row.version)).join(', ')}) and none ` +
          'supersedes another. INV-M12-07 gives a statistic one effective definition per day, ' +
          'and choosing between two here would be this adapter deciding which method a figure ' +
          'was published under',
      );
  }

  return live;
}

// -----------------------------------------------------------------------------
// The read port
// -----------------------------------------------------------------------------

function readPort(db: WorkerDb): StatisticsReadPort {
  return {
    /**
     * Every definition effective for the day, read as one registry.
     *
     * A WHOLE-TABLE READ THAT DOES NOT GROW WITH THE ESTATE. The table holds one
     * row per version of each of the seven ruled statistics, so it grows with
     * DEFINITION CHANGES and not with traders, and narrowing it would need a
     * predicate the door does not publish anyway.
     */
    async effectiveDefinitions(asOfTradingDay: TradingDay) {
      const rows = await db.batch(async (tx) =>
        (await tx.rows('statisticDefinitions')).map(toDefinitionRow),
      );
      return effectiveSet(rows, asOfTradingDay);
    },

    /**
     * `ST-01`. Evaluation accounts whose outcome occurred in the window.
     *
     * **THE OUTCOME DAY IS READ AND NEVER DERIVED**, on `G-5`: an account is in
     * a window because its outcome landed in it and never because it was sold
     * in it. `funded_on` is the day the evaluation was PASSED and `closed_on`
     * is the day it ended otherwise, and both are `date` columns.
     *
     * **`funded_on` DECIDES FIRST AND THAT IS THE WHOLE ORDERING.** An account
     * that passed and later breached WHILE FUNDED has both columns set, and its
     * EVALUATION outcome is the pass. Reading `status` first would report a
     * funded account's later breach as an evaluation failure, which is `ST-02`'s
     * subject arriving inside `ST-01`'s denominator.
     *
     * **G-1, G-2 AND G-3 NEED NO CODE HERE** and `statistics.ts` says why: a
     * never-traded account has an outcome like any other, an account still in
     * evaluation has none and so produces no fact, and `accounts.purchase_id` is
     * `NOT NULL UNIQUE` so a reset is a second row.
     *
     * **THIS READ GROWS WITH THE ESTATE, SAID AT ITS OWN SITE.** It is every
     * account that has ever existed, filtered in this process, because the door
     * narrows by equality and an outcome day is a RANGE over two different
     * columns. The repair is a read on `packages/db` and it is owed before this
     * job runs nightly, exactly as `accountsWithStoredState` states one file
     * over.
     */
    async evaluationOutcomes(window: StatisticWindow) {
      return await db.batch(async (tx) => {
        const catalogue = await readPlanCatalogue(tx);
        const facts: EvaluationOutcomeFact[] = [];

        for (const value of await tx.rows('accounts')) {
          const row = asRow(value, 'accounts');
          const accountId = text(row, 'id', 'accounts');
          const fundedOn = tradingDayOrNull(row, 'fundedOn', 'accounts');
          const closedOn = tradingDayOrNull(row, 'closedOn', 'accounts');
          const status = member(
            text(row, 'status', 'accounts'),
            ACCOUNT_STATUSES,
            'status',
            'accounts',
          );

          const common = {
            accountId,
            identityId: text(row, 'identityId', 'accounts'),
            planCode: planCodeOf(
              catalogue,
              text(row, 'planVersionId', 'accounts'),
              `accounts ${accountId}`,
            ),
          };

          if (fundedOn !== null) {
            if (withinWindow(fundedOn, window))
              facts.push({ ...common, outcomeDay: fundedOn, outcome: 'passed' });
            continue;
          }

          // G-2. Still in evaluation, so there is no outcome and no fact. This
          // is the ONE exclusion the definition names, and it needs no branch of
          // its own beyond this one.
          if (closedOn === null) continue;
          if (!withinWindow(closedOn, window)) continue;

          if (status === 'breached' || status === 'expired') {
            facts.push({ ...common, outcomeDay: closedOn, outcome: status });
            continue;
          }

          // EVERY REMAINING SHAPE IS REFUSED AND THE TWO CLASSES ARE DIFFERENT.
          // An admin or chargeback closure is a real terminal state the ruled
          // outcome vocabulary has no member for; anything else is a row that
          // carries a closing day under a status that says it is not closed.
          // Both would otherwise leave a published denominator short by one with
          // nothing reporting the shortfall.
          throw new StatisticsRowError(
            `account ${accountId} closed on ${closedOn}, inside the window ${window.startDay} to ` +
              `${window.endDay}, at status ${status}, and never reached funded. ST-01's ruled ` +
              'outcome vocabulary is passed, breached and expired, and its exclusion list is ' +
              '"accounts still in evaluation at window close. NOTHING ELSE", so this account is ' +
              'neither excluded nor expressible. ' +
              (OUTCOMES_WITH_NO_RULED_MEMBER.includes(status)
                ? 'The status is a ruled terminal state with no member in the statistic, so what ' +
                  'is owed is a ruling on whether an administratively closed evaluation is in ' +
                  'the denominator, not a line of code here.'
                : 'The row carries a closing day under a status that does not say it closed, ' +
                  'which is a data finding rather than a definition gap.'),
          );
        }

        return facts;
      });
    },

    fundedLives(): Promise<never> {
      return Promise.reject(new StatisticsPortUnwired('fundedLives', FUNDED_LIVES_BLOCKER));
    },

    /**
     * `ST-03`, `ST-04`, `ST-05`. Payouts credited to a wallet in the window.
     *
     * **THE WINDOW ANCHOR IS `effective_trading_day` AND NOT
     * `settled_trading_day`**, which `ports.ts` states and `SD-03` rules:
     * one is when the settlement was RECORDED and the other is the day it counts
     * FOR, and only the second can anchor a trailing window of trading days
     * without a late-recorded settlement landing in the wrong one.
     *
     * **THE RECOGNITION POINT IS THE WALLET CREDIT AND IT IS READ FROM THE
     * WALLET.** `S-09` signed off "that is when the trader has the money under
     * ADR-019", and the wallet's own statement is where that instant lives:
     * `wallet_entries` at `provenance = 'payout'`, `direction = 'credit'`,
     * `reference_id` = the request. A settled payout with no such entry is money
     * the database says arrived and the wallet has no record of, so it is a
     * throw rather than a payout published with the approval time standing in
     * for the credit time.
     *
     * **ONE INDEX-BACKED READ PER PAYOUT IN THE WINDOW, WHICH IS THE BOUND
     * WORTH HAVING.** `wallet_entries_reference_idx` is on `reference_id`
     * (`0011`), so each of these is a point lookup, and the number of them is
     * the number of payouts in a 30 or 90 day window rather than every wallet
     * movement the estate has ever made. A whole-table read would be one round
     * trip and an unbounded row count, and this surface is published from a
     * window rather than from a history.
     */
    async settledPayouts(window: StatisticWindow) {
      return await db.batch(async (tx) => {
        const catalogue = await readPlanCatalogue(tx);

        const terminalByAccount = new Map<string, string | null>();
        for (const value of await tx.rows('accounts')) {
          const row = asRow(value, 'accounts');
          terminalByAccount.set(
            text(row, 'id', 'accounts'),
            textOrNull(row, 'terminalSettlementId', 'accounts'),
          );
        }

        const settled = await tx.rowsWhere('payoutRequests', { status: 'settled' });
        const facts: SettledPayoutFact[] = [];

        for (const value of settled) {
          const row = asRow(value, 'payoutRequests');
          const payoutRequestId = text(row, 'id', 'payoutRequests');
          const creditedTradingDay = tradingDayOrNull(row, 'effectiveTradingDay', 'payoutRequests');
          if (creditedTradingDay === null)
            throw new StatisticsRowError(
              `payout_requests ${payoutRequestId} is settled and carries no ` +
                'effective_trading_day. SD-03 makes that column the day a settlement counts FOR, ' +
                'and a settled row without one cannot be placed in any window',
            );
          if (!withinWindow(creditedTradingDay, window)) continue;

          const accountId = text(row, 'accountId', 'payoutRequests');
          if (!terminalByAccount.has(accountId))
            throw new StatisticsRowError(
              `payout_requests ${payoutRequestId} names account ${accountId}, which accounts ` +
                'does not hold',
            );

          const entries = await tx.rowsWhere('walletEntries', { referenceId: payoutRequestId });
          // **`provenance` IS READ AS NULLABLE AND THE COLUMN IS WHY.** `0080`
          // made it `NULL` ON A DEBIT ONLY, so a wallet debit referencing this
          // same payout carries no provenance at all, and a reader that
          // demanded text here would throw on a row it merely meant to skip.
          // The direction and the provenance are BOTH tested because either one
          // alone admits a row the recognition point is not: a refund credit
          // carries the wrong provenance and a debit carries the wrong
          // direction.
          const credits = entries.filter((entry) => {
            const walletRow = asRow(entry, 'walletEntries');
            return (
              textOrNull(walletRow, 'provenance', 'walletEntries') === WALLET_PAYOUT_PROVENANCE &&
              text(walletRow, 'direction', 'walletEntries') === WALLET_CREDIT_DIRECTION
            );
          });
          const credit = credits[0];
          if (credit === undefined || credits.length !== 1)
            throw new StatisticsRowError(
              `payout_requests ${payoutRequestId} is settled and wallet_entries holds ` +
                `${String(credits.length)} payout credits referencing it, where exactly one is ` +
                'the recognition point. ST-03, ST-04 and ST-05 are all published off the wallet ' +
                'credit (S-09, ADR-019), so a payout without exactly one is not a payout this ' +
                'run can date',
            );

          facts.push({
            payoutRequestId,
            accountId,
            identityId: text(row, 'identityId', 'payoutRequests'),
            // THE PAYOUT'S OWN PINNED VERSION AND NOT THE ACCOUNT'S. `0010`
            // copies `plan_version_id` onto the request "for provability", so
            // the contract this payout was made under is on the row, and reading
            // the account would answer with the contract in force TODAY.
            planCode: planCodeOf(
              catalogue,
              text(row, 'planVersionId', 'payoutRequests'),
              `payout_requests ${payoutRequestId}`,
            ),
            creditedTradingDay,
            traderCents: cents(row, 'traderCents', 'payoutRequests'),
            // **THE FLAG IS AN EQUALITY AND NOT A NULL TEST, AND THE DIFFERENCE
            // IS EVERY EARLIER PAYOUT OF A GRADUATED ACCOUNT.**
            // `accounts.terminal_settlement_id` REFERENCES `payout_requests(id)`
            // (`0010:306`), so it names WHICH payout closed the account. Reading
            // it as `IS NOT NULL` would mark every payout that account ever
            // received as terminal, and `ST-04` EXCLUDES terminal settlements,
            // so a graduated trader's ordinary payouts would vanish from the
            // mean and the median.
            terminalSettlement: terminalByAccount.get(accountId) === payoutRequestId,
            requestedAtEpochSeconds: epochSeconds(instant(row, 'createdAt', 'payoutRequests')),
            creditedAtEpochSeconds: epochSeconds(
              instant(asRow(credit, 'walletEntries'), 'occurredAt', 'walletEntries'),
            ),
            frozen: instantOrNull(row, 'frozenAt', 'payoutRequests') !== null,
          });
        }

        return facts;
      });
    },

    withdrawalSettlements(): Promise<never> {
      return Promise.reject(
        new StatisticsPortUnwired('withdrawalSettlements', WITHDRAWAL_SETTLEMENTS_BLOCKER),
      );
    },

    /**
     * `ST-07`. Payout requests meeting the published gates, resolved in the
     * window.
     *
     * **EVERY ROW OF THE TABLE IS IN THE ELIGIBLE SET AND THAT IS A PROPERTY OF
     * `M05` RATHER THAN A FILTER OMITTED HERE.** `ports.ts`: "a request failing
     * a gate was never eligible and is not in it, which is `ST-07`'s stated
     * exclusion of None", and `INV-M5-01` has no denial path, so a request that
     * failed a gate was never written. There is nothing to filter out.
     *
     * **THE RESOLUTION DAY IS `basis_trading_day` AND THE ALTERNATIVE IS
     * REFUSED RATHER THAN OVERLOOKED.** That column is "the LAST CLOSED DAY the
     * decision used" (`0010`), which is the trading day the resolution was taken
     * on the authority of, and it is `NOT NULL` on every row. The alternative is
     * folding `approved_at` through a session calendar, which lands
     * `not_a_session` for every approval taken outside a session and is the same
     * unruled anchor `withdrawalSettlements` refuses over. A stored trading day
     * beats a derived one on a published surface, and this one is stored.
     *
     * **THE APPROVAL BIT IS READ AND NOT ASSUMED.** See
     * {@link PAYOUT_STATUSES_MEANING_APPROVED}: a status outside the declared
     * set throws, so the day a denial member joins the enum this run refuses
     * instead of counting the denial as an approval.
     *
     * **THIS READ GROWS WITH THE ESTATE**, on `evaluationOutcomes`' terms and
     * for the same reason: the window is a range over `basis_trading_day` and
     * the door narrows by equality.
     */
    async eligibleRequests(window: StatisticWindow) {
      return await db.batch(async (tx) => {
        const catalogue = await readPlanCatalogue(tx);
        const facts: EligibleRequestFact[] = [];

        for (const value of await tx.rows('payoutRequests')) {
          const row = asRow(value, 'payoutRequests');
          const resolvedTradingDay = tradingDay(row, 'basisTradingDay', 'payoutRequests');
          if (!withinWindow(resolvedTradingDay, window)) continue;

          const payoutRequestId = text(row, 'id', 'payoutRequests');
          member(
            text(row, 'status', 'payoutRequests'),
            PAYOUT_STATUSES_MEANING_APPROVED,
            'status',
            'payoutRequests',
          );

          facts.push({
            payoutRequestId,
            accountId: text(row, 'accountId', 'payoutRequests'),
            planCode: planCodeOf(
              catalogue,
              text(row, 'planVersionId', 'payoutRequests'),
              `payout_requests ${payoutRequestId}`,
            ),
            resolvedTradingDay,
            approved: true,
          });
        }

        return facts;
      });
    },
  };
}

// -----------------------------------------------------------------------------
// The write port
// -----------------------------------------------------------------------------

/** `23505`. `packages/db`'s own constant, transcribed for the reason above. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether a driver error is a unique violation, WALKING THE CAUSE CHAIN.
 *
 * `state-writer.ts` measured why the walk is necessary rather than tidy: a
 * second insert arrives as a `DrizzleQueryError` whose own `code` is `undefined`
 * and whose `cause` is the `pg` error carrying `23505`, so a guard reading only
 * the top-level `code` lets the raw driver error through and the caller gets a
 * query dump instead of the window that was already published. The walk is
 * bounded because a cause chain is data from a driver and a cyclic one would
 * hang a nightly run inside an error handler.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    if (!('cause' in current)) return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * `published_statistics_window_uq` refused a second row for a published cell.
 *
 * **THE MACHINE DID NOT LOOK AND THAT IS THE DESIGN.** `statistics.ts` states
 * it: the run computes and writes, the unique index decides, and an application
 * pre-check would be a second control that can drift from the first. This class
 * is the adapter doing the one thing left, which is surfacing the refusal with
 * the cell in it rather than a driver dump.
 *
 * IT IS NOT A CORRECTION AND THE CALLER MUST NOT TREAT IT AS ONE. `INV-M12-03`
 * makes a published row immutable, `0026` REVOKES `UPDATE, DELETE` from
 * `merit_app` and from `PUBLIC`, and a restatement is `M12` section 3.3's own
 * machine with a `restatement_of` pointer. A run that met this has already been
 * published for this window and there is nothing to retry.
 */
export class PublishedWindowAlreadyExists extends Error {
  readonly statCode: string;
  readonly measure: string;
  readonly driverError: unknown;

  // Assigned rather than declared in the parameter list, for the runtime reason
  // {@link StatisticsPortUnwired} states.
  constructor(row: PublishedStatisticRow, driverError: unknown) {
    super(
      `published_statistics already holds ${row.statCode} v${String(row.definitionVersion)} ` +
        `${row.measure} for ${row.windowStartDay} to ${row.windowEndDay} at grain key ` +
        `${row.grainKey ?? 'lineup'}. INV-M12-03: a published figure is immutable and is never ` +
        'overwritten. A window computed twice is not republished and is not repaired here; a ' +
        'correction is a RESTATEMENT, which is a new row pointing at what it restates and is ' +
        'M12 section 3.3s machine rather than this one.',
    );
    this.name = 'PublishedWindowAlreadyExists';
    this.statCode = row.statCode;
    this.measure = row.measure;
    this.driverError = driverError;
  }
}

/**
 * One `published_statistics` row, as the columns `schema.ts` declares.
 *
 * WRITTEN OUT RATHER THAN SPREAD, so a field added to `PublishedStatisticRow`
 * that nobody mapped is a compile error at this function and not a column that
 * silently defaults. `id`, `computed_at` and `created_at` are absent because
 * they are the database's, and `restatement_of` is absent because every row this
 * run writes has it null by scope.
 */
function publishedStatisticValues(row: PublishedStatisticRow): Readonly<Record<string, unknown>> {
  return {
    statCode: row.statCode,
    definitionVersion: row.definitionVersion,
    windowStartDay: row.windowStartDay,
    windowEndDay: row.windowEndDay,
    asOfTradingDay: row.asOfTradingDay,
    measure: row.measure,
    value: row.value,
    valueUnit: row.valueUnit,
    numerator: row.numerator,
    numeratorUnit: row.numeratorUnit,
    denominator: row.denominator,
    sampleSize: row.sampleSize,
    grainKey: row.grainKey,
    suppressedReason: row.suppressedReason,
    inputDigest: row.inputDigest,
  };
}

function writePort(db: WorkerDb): StatisticsWritePort {
  return {
    /**
     * The whole run, in one call, in one transaction.
     *
     * **THE TRANSACTION IS THE POINT AND NOT THE BATCHING.** `STAT-C1` is a
     * `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` (`0027`), so "a
     * publish run emitting one measure emits every measure its definition
     * declares" is only decidable once every row is in. One `db.batch` is one
     * transaction, so the deferred check fires at ITS commit and sees the whole
     * run; a per-row door would let a caller express a partial set by simply
     * stopping, and the check would never see the difference.
     *
     * **AN EMPTY RUN OPENS NO TRANSACTION AND WRITES NOTHING**, which is
     * correct and is also a state worth naming rather than passing over: the
     * machine reports `status: 'published'` over zero rows when every effective
     * definition is `plan` grain and the window held no activity, and there is
     * no halt reason for it. That is `ADR-119`'s "green, every night, over
     * nothing" at a second site, it is reported in `ADR-350` and it is not
     * repaired here, because the repair is a member of a halt vocabulary and
     * that is a ruling rather than an adapter.
     */
    async publishRun(rows: readonly PublishedStatisticRow[]): Promise<void> {
      if (rows.length === 0) return;

      await db.batch(async (tx) => {
        for (const row of rows) {
          let written: unknown[];
          try {
            written = await tx.insert('publishedStatistics', publishedStatisticValues(row));
          } catch (error) {
            if (isUniqueViolation(error)) throw new PublishedWindowAlreadyExists(row, error);
            throw error;
          }
          if (written.length !== 1)
            throw new StatisticsRowError(
              `the insert of ${row.statCode} ${row.measure} returned ` +
                `${String(written.length)} rows and one row was written. A write nobody ` +
                'performed, reported as a write that succeeded, is a published series with a ' +
                'hole in it that every later reader treats as a fact',
            );
        }
      });
    },

    raiseStatisticsHalt(): Promise<never> {
      return Promise.reject(
        new StatisticsPortUnwired('raiseStatisticsHalt', STATISTICS_HALT_SINK_BLOCKER),
      );
    },
  };
}

/**
 * The `StatisticsPorts` value this deployment would run the statistics run
 * against.
 *
 * ONE ARGUMENT, WHICH IS THE DOOR, so a suite substitutes a recorder and a
 * deployment passes `LIVE_DB`. `postgresBatchPorts`' shape one file over and
 * `src/db.ts`'s own seam.
 *
 * **THERE IS NO CALLER AND THE JOB IS STILL `unscheduled`**, which
 * `src/schedule.ts` records with the blockers that keep it there. This value
 * makes the run CONSTRUCTIBLE against a real database; it does not make it
 * publish, and the entry in `schedule.ts` is where the difference is written
 * down.
 */
export function postgresStatisticsPorts(db: WorkerDb): StatisticsPorts {
  return { read: readPort(db), write: writePort(db) };
}
