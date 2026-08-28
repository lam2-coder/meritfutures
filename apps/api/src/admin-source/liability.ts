// =============================================================================
// apps/api/src/admin-source/liability.ts
// =============================================================================
// `GET /admin/liability`'s ROWS, AND IT IS NOT `AdminReadSource.readLiability`.
//
// THE DISTINCTION IS THE WHOLE POINT OF THIS FILE AND IT IS STATED FIRST.
// `LiabilityResponse` projects 40 leaf paths under 10 containers. This module
// produces 27 of the 40 from live rows through ADR-112's keyed accessor. The
// other 13 are FOUR SEPARATE BLOCKERS, none of which is a missing column and
// none of which this fence can clear. So the method is NOT composed, the array
// `IMPLEMENTED_ADMIN_READS` does not name it, and `composeAdminReadSource` still
// fills the gap with `AdminSourceNotComposed('readLiability')`.
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
// turned out to be an EVENT rather than an owed column. What is left is 27 of 40,
// and the balance of that argument moves with the number: a reader that produces
// 27 leaves and MEASURES the 13 it cannot is worth more than a paragraph saying
// the same thing, because the 27 are RUN and the 13 are pinned with clearing
// conditions rather than asserted.
//
// **AND THE TYPE STATES THE GAP RATHER THAN THIS COMMENT.** {@link LiabilityBook}
// is `LiabilityResponse` minus exactly the blocked paths, written as a mechanical
// subtraction rather than as a hand-copied shape, so the day a blocker lifts the
// widening is a type error and never a judgement call. `test/admin-source-liability.test.ts`
// asserts the arithmetic: the book's leaves plus the four blockers' leaves are
// the response's leaves, counted from the CONTRACT rather than from either type.
//
// -----------------------------------------------------------------------------
// THE FOUR BLOCKERS, EACH AT ITS PRIMARY SOURCE, AND NOT ONE OF THEM IS A COLUMN
// -----------------------------------------------------------------------------
// ADR-199 ruled `per_plan[].cusum`, `integrations.batch` and `eligible_next_7d`
// DERIVABLE rather than owed a migration, and it is right about all three. It
// did not rule them READABLE, and for two of the three it says so in its own
// words. What follows is what stands between a derivation and a row.
//
//   B1. `eligible_next_7d` (5 leaves). The fold needs the NEXT SEVEN TRADING
//       DAYS and `trading_calendar` is not a `TableKey`: `packages/db/src/scope.ts`
//       registers `tradingCalendarLoads` and `tradingCalendarRevisions` and not
//       the calendar itself. A `Tx` naming it is `TS2322`, which is session
//       349's wall on `events` and session 363's on `reserve_coverage_snapshots`,
//       for the third time. ADR-199 section 6: "ONE INPUT IS NOT YET A `TableKey`
//       AND IT IS NAMED RATHER THAN TAKEN ... the session that NEEDS it registers
//       it, and this one does not read it." This session needs it and cannot take
//       it: the registration is `packages/db`, which is not this fence, and it is
//       an ADR-092-shaped entry, which is a number this session does not hold.
//       CLEARING CONDITION: `TABLE_KEYS` contains `tradingCalendar`.
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
//       CLEARING CONDITION: a ruling fixes the window. Choosing one here would be
//       calibrating a firm-wide pager inside an adapter.
//
//   B3. `per_plan[].cusum` (3 leaves). ADR-167 clause 1 folds `S_t` at read time
//       from a landed series, and clause 5 rules that the field is rendered
//       ABSENT until `DEP-M6-05` supplies `mu_0` and `sigma`, which M06:556 puts
//       in Wave 4. All three members need the calibration: `statistic` is the
//       recurrence, `threshold` is "4 to 5 sigma". `apps/worker/src/digests/produce.ts`
//       already renders that absence in terms -- "absent: blocked on ...
//       (ADR-167 clause 5, FM-M6-07)" -- so the absence is the answer this tree
//       already gives on the one surface that has a shape for it.
//       **AND THE WIRE HAS NO SHAPE FOR IT.** All three declarations of
//       `LiabilityResponse` type `cusum` as a REQUIRED object of two numbers and
//       a boolean, so the only two ways to answer are to manufacture a statistic
//       clause 5 refuses or to change a shape `RI-18` binds in three copies.
//       ADR-167 clause 5's own last sentence -- "the wire shape is `P7-b`'s to
//       carry, not this entry's to invent" -- is a shape nobody has carried.
//       CLEARING CONDITION: `DEP-M6-05` lands, or a ruling gives the absence a
//       wire shape.
//
//   B4. `integrations.recon.last_run_at` (1 leaf). NOTHING IN THIS SCHEMA RECORDS
//       A RECONCILIATION RUN. `reconciliations` (0014) is one row per account per
//       trading day, and EVENTS section 5 carries `recon.mismatch_detected` and
//       `recon.resolved`, both per account, and no `recon.completed`. The
//       available fold is `max(reconciliations.created_at)`, and IT IS THE FOLD
//       ADR-199 SECTION 5 REFUSES ONE FIELD TO THE RIGHT: it refuses
//       `max(rule_states.computed_at)` for the batch because OVERVIEW section 5.2
//       makes the run resumable at the account boundary, "so a fold over
//       per-account clocks reports a SUCCESS for a run that crashed". The
//       reconciliation sweep is per account too. Taking the fold here would
//       overturn that reasoning by writing code, one field from where the entry
//       wrote it down. `mismatches_open` is a COUNT of a state rather than a
//       clock and is produced.
//       CLEARING CONDITION: a `recon.completed` event or a run record.
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
 * `tradingCalendar` IS NOT HERE AND COULD NOT BE. It is blocker B1 and it is
 * the reason `eligible_next_7d` is not on {@link LiabilityBook}: the name is not
 * a `TableKey`, so this array could not carry it even to try.
 */
export const LIABILITY_READ_TABLES = [
  'events',
  'liabilitySnapshots',
  'midHealth',
  'planBreakerState',
  'plans',
  'reconciliations',
  'reserveCoverageSnapshots',
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

/** `LiabilityResponse.per_plan`'s element, LESS the CUSUM. Blocker B3. */
export type LiabilityPlanRow = Omit<LiabilityResponse['per_plan'][number], 'cusum'>;

/** `LiabilityResponse.integrations`, LESS the reconciliation clock. Blocker B4. */
export type LiabilityIntegrations = Omit<LiabilityResponse['integrations'], 'recon'> & {
  readonly recon: Omit<LiabilityResponse['integrations']['recon'], 'last_run_at'>;
};

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
export type LiabilityBook = Omit<
  LiabilityResponse,
  'eligible_next_7d' | 'payout_velocity' | 'per_plan' | 'integrations'
> & {
  readonly per_plan: readonly LiabilityPlanRow[];
  readonly integrations: LiabilityIntegrations;
};

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

// -----------------------------------------------------------------------------
// The groups
// -----------------------------------------------------------------------------

/** ADR-188 clause 1: the top-level fields are one `liability_snapshots` row, column for column. */
function readSnapshot(row: unknown): Omit<LiabilityBook, 'reserve' | 'per_plan' | 'integrations'> {
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
 * `per_plan`, LESS the CUSUM, which is blocker B3.
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

  const [breakerRows, planRows, midHealthRows, openMismatches, batchRows] = [
    await tx.rows('planBreakerState'),
    await tx.rows('plans'),
    await tx.rows('midHealth'),
    await tx.rowsWhere('reconciliations', { status: 'mismatch' }),
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

  return {
    book: {
      ...readSnapshot(snapshot),
      reserve: readReserve(reserve, anchors[0]),
      per_plan: readPerPlan(breakerRows, planRows),
      integrations: {
        mid_health: readMidHealth(midHealthRows),
        // A COUNT OF A STATE AND NEVER A CLOCK. Blocker B4 is the clock beside
        // it: `status = 'mismatch'` is what `0014` declares open, and `resolved`
        // and `match` are the other two.
        recon: { mismatches_open: openMismatches.length },
        batch,
      },
    },
    cost: {
      liabilitySnapshotsScanned: snapshots.length,
      reserveSnapshotsScanned: reserves.length,
      treasuryAnchorsMatched: anchors.length,
      planBreakerRowsScanned: breakerRows.length,
      plansScanned: planRows.length,
      midHealthRowsScanned: midHealthRows.length,
      openMismatchesScanned: openMismatches.length,
      batchCompletedScanned: batchRows.length,
    },
  };
}
