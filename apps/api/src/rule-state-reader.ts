// =============================================================================
// apps/api/src/rule-state-reader.ts
// =============================================================================
// **ONE `rule_states` ROW, READ BACK INTO THE ENGINE'S `RuleState`.**
//
// `PayoutSubject.state` (`routes/payouts.ts`) is a `RuleState`, and for fifteen
// revisions `usePayoutBackend`'s entry has named what stands between this
// deployment and one. `ADR-233` discharged `plan`, `ADR-260` discharged
// `gates`, and what was left was "a `rule_states` ROW, which is a scheduled run
// and a reader". `ADR-264` establishes the run by RUNNING it. **This file is
// the reader.**
//
// -----------------------------------------------------------------------------
// IT IS PURE, AND THE SPLIT IS `resolveExternalGates`'s SPLIT UNCHANGED
// -----------------------------------------------------------------------------
// Nothing here opens a transaction, names a table key or reaches `@merit/db`.
// The CALLER reads the rows on the handle it already holds -- `ruleStates` is
// registered `derived` via `accounts` (`packages/db/src/scope.ts`), so a payout
// transaction reaches them one hop out and no second door is implied -- and
// what it gets back from this module is the NARROWING.
//
// That is the shape `ADR-260` ruled for the gates and the reason is the same
// here: a reader that opened its own transaction would be a second snapshot,
// and a payout evaluated across two snapshots can read a state written after
// the account row it is being folded against.
//
// -----------------------------------------------------------------------------
// AN ABSENT ROW IS A REFUSAL AND IT IS NEVER A DEFAULT VERDICT
// -----------------------------------------------------------------------------
// **THIS IS THE TRAP THE PAYOUT PORT HAS REFUSED FIVE TIMES AND IT IS THE WHOLE
// REASON THIS MODULE HAS TWO ERROR CLASSES AND NO FALLBACK ARM.** `rule_states`
// holds no row for an account-day until a nightly fold has closed that day. A
// reader that answered such a day with a zeroed state, with the latest row it
// could find, or with anything at all would put a CONFIDENT payout verdict in
// front of a trader on inputs nobody computed. **A wrong answer that returns
// 200 is worse than an honest 503**, and every field of a fabricated state is a
// gate that never fires: `R-41` conjoins the context gates as vetoes and
// `evaluatePayout` reads the rest of this value for the engine gates.
//
// So `ruleStateOn` has exactly two outcomes, a `RuleState` and a throw, and
// `RuleStateAbsent` is a distinct class from `RuleStateUnreadable` because a
// caller must be able to tell "the fold has not closed this day" from "this row
// is malformed". They are different operational days and the first one is not
// an error in the estate at all.
//
// **`R-06` IS WHY THE DAY IS AN ARGUMENT RATHER THAN AN ORDERING.** "No
// endpoint may evaluate eligibility against anything other than the last closed
// day, whatever the batch is doing at the time." A reader that fell back to the
// most recent row it could find would answer a payout request out of a state
// computed before the nights in between, which looks like a working endpoint
// and pays against a floor that has moved. There is no `latest` function here
// and there must not be one.
//
// -----------------------------------------------------------------------------
// THE SECOND TRANSCRIPTION OF THIS ROW IN THIS REPOSITORY, STATED RATHER THAN
// DISCOVERED
// -----------------------------------------------------------------------------
// `toRuleState` in `apps/worker/src/batch/adapter.ts` reads the same twenty-two
// values to build an `AccountDay.prior`. `apps/api` cannot import
// `apps/worker`, so this file is `FM-16`'s shape by name: two statements of one
// predicate. **ITS HOME IS `packages/rules-engine`, BESIDE `gates-codec.ts`,
// ON `ADR-239` SLICE A's ARGUMENT UNCHANGED** -- both deployables need the one
// rebuilding and the engine is the only place both arrows already point.
// `ADR-264`'s row does not fence that package, so the finding is REGISTERED and
// not taken, which is `adapter.ts`'s own precedent for the second
// `plan_versions.rules` decoder.
//
// **WHAT `FM-16` ACTUALLY COSTS IS "WITH NOTHING COMPARING THEM", AND THAT HALF
// IS PAID.** `SD-08`'s digest is computed by `apps/worker` from the state the
// engine folded and stored in `rule_states.state_hash`;
// `apps/api/test/rule-state-reader.test.ts` re-hashes the state THIS module
// rebuilds from a row a real fold wrote and compares the thirty-two bytes. The
// two transcriptions therefore have a comparator that runs on every `CI-01`
// pass, over a value neither of them can adjust. A shared module would make
// them agree by construction and would prove nothing about the stored row.
//
// -----------------------------------------------------------------------------
// THREE COLUMNS ARE NOT READ AND THEIR ABSENCE IS DELIBERATE
// -----------------------------------------------------------------------------
// `context_gates` is `INV-23`'s half that never enters the replayed state,
// `state_hash` is computed FROM a state rather than carried by one, and
// `calendar_revision_id` is `ADR-047`'s stamp on the row. A `RuleState` has no
// field for any of the three. `id`, `computed_at` and `created_at` are the
// database's.
// =============================================================================

import {
  decodeEngineGates,
  type BreachKind,
  type Phase,
  type RuleState,
  type TradingDay,
} from '@merit/rules-engine';

/**
 * No `rule_states` row exists for this account on this day.
 *
 * **IT IS NOT AN ERROR IN THE ESTATE AND IT IS NOT A VERDICT EITHER.** The
 * nightly fold has not closed that day for that account, which is the ordinary
 * state of every account before its first fold and of every account on a day
 * the batch has not yet run. The caller's only correct answers are to refuse
 * the request or to answer that eligibility is not yet computed; there is no
 * third answer this class permits, because the value that would be needed to
 * give one does not exist.
 */
export class RuleStateAbsent extends Error {
  /** `rule_states.account_id` that was looked for. */
  readonly accountId: string;

  /** `rule_states.trading_day` that was looked for. */
  readonly tradingDay: string;

  // ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on
  // `ExternalGatesRefusal`'s and `EngineGatesCodecError`'s own reason: `ADR-083`
  // runs every deployable under `node --experimental-strip-types`, where a
  // TypeScript parameter property is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load
  // time while `tsc --noEmit` accepts it, so the failure is invisible to CI-01.
  constructor(accountId: string, tradingDay: string) {
    super(
      `no \`rule_states\` row exists for account ${accountId} on ${tradingDay}. The nightly ` +
        'fold has not closed that day for that account, so this deployment holds no state to ' +
        'evaluate against. R-06 permits no other day and no default state exists: a verdict ' +
        'computed off an absent row is a confident answer nobody computed',
    );
    this.name = 'RuleStateAbsent';
    this.accountId = accountId;
    this.tradingDay = tradingDay;
  }
}

/**
 * A row exists and this deployment will not read it.
 *
 * DISTINCT FROM ABSENCE BECAUSE THE OPERATIONAL DAY IS DIFFERENT. An absence is
 * a fold that has not run; this is a row whose columns disagree with the schema
 * that wrote them, which is a database question rather than a scheduling one.
 */
export class RuleStateUnreadable extends Error {
  /** Where in the row the refusal is, so a report names a column. */
  readonly at: string;

  constructor(at: string, why: string) {
    super(
      `\`rule_states\` cannot be read at ${at}: ${why}. The row is refused rather than ` +
        'repaired, because every value on it is an input to a payout verdict and a repaired ' +
        'column is a number nobody folded',
    );
    this.name = 'RuleStateUnreadable';
    this.at = at;
  }
}

/** `account_phase`, as `0001:45` declares it and `types.ts` declares the union. */
const PHASES = ['eval', 'funded', 'closed', 'graduated'] as const satisfies readonly Phase[];

/**
 * `breach_kind`, as `0065`'s CHECK declares it.
 *
 * The column is `text` and the vocabulary is closed here, which is
 * `adapter.ts`'s reading of the same column and `packages/db`'s
 * `rule-state-breach-vocabulary.test.ts` is what compares the engine's union
 * with the migration.
 */
const BREACH_KINDS = [
  'trailing_eod_floor',
  'static_floor',
  'hard_daily_loss_limit',
] as const satisfies readonly BreachKind[];

function asRow(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RuleStateUnreadable(at, 'the accessor returned something that is not a row');
  return value as Record<string, unknown>;
}

/** A `text` or `date` column the schema declares NOT NULL. */
function text(row: Record<string, unknown>, column: string, at: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new RuleStateUnreadable(`${at}.${column}`, 'the column is not text');
  return value;
}

/** A `text` or `date` column the schema declares NULLABLE. */
function textOrNull(row: Record<string, unknown>, column: string, at: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new RuleStateUnreadable(`${at}.${column}`, 'the column is neither text nor null');
}

/** A `boolean NOT NULL` column. */
function flag(row: Record<string, unknown>, column: string, at: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean')
    throw new RuleStateUnreadable(`${at}.${column}`, 'the column is not a boolean');
  return value;
}

/**
 * A `bigint NOT NULL` money column.
 *
 * **A `number` IS REFUSED RATHER THAN COERCED AND THAT IS `INV-02`.** The
 * driver is configured to hand `bigint` columns back as `bigint`; a `number`
 * arriving here is a value that has already passed through a conversion this
 * module did not make, and past 2^53 it has already lost digits. A string of
 * digits IS admitted, because that is what a `bigint` looks like on the way out
 * of some drivers and it is lossless.
 */
function cents(row: Record<string, unknown>, column: string, at: string): bigint {
  const value = row[column];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new RuleStateUnreadable(
    `${at}.${column}`,
    'the column is not integer cents as a `bigint` or a string of digits. INV-02 keeps money ' +
      'in `bigint` and a `number` here has already been converted by something else',
  );
}

/** An `integer NOT NULL` column. A COUNT, never money. */
function count(row: Record<string, unknown>, column: string, at: string): number {
  const value = row[column];
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new RuleStateUnreadable(`${at}.${column}`, 'the column is not a safe integer count');
}

/** A closed-vocabulary column, refused rather than widened. */
function member<T extends string>(
  row: Record<string, unknown>,
  column: string,
  allowed: readonly T[],
  at: string,
): T {
  const value = text(row, column, at);
  for (const one of allowed) if (one === value) return one;
  throw new RuleStateUnreadable(
    `${at}.${column}`,
    `it is "${value}", which is outside {${allowed.join(', ')}}`,
  );
}

/**
 * `breach_kind`, with `0065`'s own pairing checked on the way past.
 *
 * `rule_states_breach_flag_matches_kind` is `breached = (breach_kind IS NOT
 * NULL)` at the store, so a row reaching this reader with the pair split is a
 * row the database says cannot exist. It is refused rather than repaired: a
 * `null` kind on a breached row would tell a consumer about a drawdown type
 * that never happened, and a kind on an unbreached row hides one that did.
 */
function breachKindOf(row: Record<string, unknown>, at: string): BreachKind | null {
  const raw = textOrNull(row, 'breachKind', at);
  const breached = flag(row, 'breached', at);
  if (raw === null) {
    if (breached)
      throw new RuleStateUnreadable(
        `${at}.breachKind`,
        'the row carries breached=true with breach_kind NULL, which ' +
          '`rule_states_breach_flag_matches_kind` refuses at the store (0065)',
      );
    return null;
  }
  if (!breached)
    throw new RuleStateUnreadable(
      `${at}.breached`,
      `the row carries breached=false with breach_kind="${raw}", which ` +
        '`rule_states_breach_flag_matches_kind` refuses at the store (0065)',
    );
  for (const kind of BREACH_KINDS) if (kind === raw) return kind;
  throw new RuleStateUnreadable(
    `${at}.breachKind`,
    `it is "${raw}", which is outside {${BREACH_KINDS.join(', ')}}, the set 0065's CHECK declares`,
  );
}

/**
 * One `rule_states` row as the engine's `RuleState`.
 *
 * TWENTY-TWO FIELDS AND NOT ONE OF THEM TAKES A DEFAULT. Every read above
 * throws where a `??` would have been, because this value is what
 * `evaluatePayout` folds into the verdict on the door where money leaves the
 * firm: a floor defaulted to zero pays a breached account and a
 * `payoutsSettledCount` defaulted to zero restarts a finished ladder.
 */
export function readRuleState(value: unknown, at: string): RuleState {
  const row = asRow(value, at);
  return {
    tradingDay: text(row, 'tradingDay', at) as TradingDay,
    phase: member(row, 'phase', PHASES, at),
    balanceCents: cents(row, 'balanceCents', at),
    floorOpenCents: cents(row, 'floorOpenCents', at),
    floorCents: cents(row, 'floorCents', at),
    floorLocked: flag(row, 'floorLocked', at),
    highWaterBalanceCents: cents(row, 'highWaterBalanceCents', at),
    withdrawableCents: cents(row, 'withdrawableCents', at),
    tradedDaysCount: count(row, 'tradedDaysCount', at),
    winDaysCount: count(row, 'winDaysCount', at),
    consistencyBestDayCents: cents(row, 'consistencyBestDayCents', at),
    consistencyPeriodProfitCents: cents(row, 'consistencyPeriodProfitCents', at),
    consistencyPeriodStartDay: textOrNull(
      row,
      'consistencyPeriodStartDay',
      at,
    ) as TradingDay | null,
    payoutsSettledCount: count(row, 'payoutsSettledCount', at),
    payoutAnchorDay: textOrNull(row, 'payoutAnchorDay', at) as TradingDay | null,
    cadenceAnchorDay: textOrNull(row, 'cadenceAnchorDay', at) as TradingDay | null,
    lifetimeSettledCents: cents(row, 'lifetimeSettledCents', at),
    // `ADR-250`'s codec, IMPORTED rather than written here. `apps/worker`
    // encodes this column through the same module and neither deployable can
    // import the other, so a decoding written in this file would be the FM-16
    // `ADR-239` slice A moved the codec to the engine to close.
    engineGates: decodeEngineGates(row['engineGates']),
    engineEligible: flag(row, 'engineEligible', at),
    breached: flag(row, 'breached', at),
    breachKind: breachKindOf(row, at),
    engineVersion: text(row, 'engineVersion', at),
  };
}

/**
 * The account's state FOR ONE DAY, out of the rows the caller read.
 *
 * **THE DAY IS AN ARGUMENT AND THERE IS NO `latest`.** `R-06` permits one day
 * and the caller is the only thing that knows which day the calendar says is
 * closed. A selection made here by ordering would be this module deciding a
 * calendar question out of a list of rows.
 *
 * **THE ACCOUNT IS CHECKED ON THE ROW RATHER THAN TRUSTED FROM THE CALL.** The
 * caller's read is scoped, so a foreign row cannot arrive through the accessor;
 * the parameter is a `readonly unknown[]` all the same, and a call site that
 * passed the wrong list would otherwise pay a trader against somebody else's
 * state.
 *
 * @throws RuleStateAbsent when no row matches. NEVER a default state.
 * @throws RuleStateUnreadable when two rows match, which `rule_states_account_day_uq` forbids.
 */
export function ruleStateOn(
  rows: readonly unknown[],
  accountId: string,
  tradingDay: string,
): RuleState {
  const at = `rule_states[${accountId}:${tradingDay}]`;

  const matching = rows.filter((value) => {
    const row = asRow(value, at);
    return text(row, 'accountId', at) === accountId && text(row, 'tradingDay', at) === tradingDay;
  });

  if (matching.length === 0) throw new RuleStateAbsent(accountId, tradingDay);
  if (matching.length > 1)
    throw new RuleStateUnreadable(
      at,
      `${String(matching.length)} rows carry this account and this day, which ` +
        '`rule_states_account_day_uq` (0015) makes unwritable. Choosing one would fold a payout ' +
        'against whichever row the accessor returned first',
    );

  return readRuleState(matching[0], at);
}
