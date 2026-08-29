// =============================================================================
// apps/worker/src/batch/state-writer.ts
// =============================================================================
// `BatchWritePort.writeRuleState`, IMPLEMENTED OVER A REAL TRANSACTION.
//
// `B5` term 1 in `apps/api/src/admin-source/liability.ts` reads: "A
// `writeRuleState` IMPLEMENTATION. `nightly.ts` calls the port and the only
// things satisfying it are test doubles and `scripts/demo/world.ts`, which
// refuses." This file is that implementation, and everything below is either
// the door it goes through, the one column it cannot fill on its own authority,
// or a refusal.
//
// NOTHING HERE ADDS A `SystemReason` MEMBER, ADDS A `SqlExecutorReason` MEMBER,
// IMPORTS `pg`, IMPORTS `@merit/db`, OR CASTS PAST A KEY TYPE.
//
// -----------------------------------------------------------------------------
// 1. THE DOOR, MEASURED RATHER THAN ASSUMED, AND IT DECIDES THE DEPLOYABLE
// -----------------------------------------------------------------------------
// `recon/ports.ts` section 1 asked this question about two tables and this file
// asks it about one, because the handle is the whole of what a writer is.
//
//   `rule_states`  `derived` through `account_id` (`packages/db/src/scope.ts`,
//                  the `ruleStates` entry: `class: 'derived', via: 'accounts'`).
//                  NOT a `FirmTableKey`, so `apps/api/src/db.ts`'s `firm` door
//                  cannot name it; and its `scoped` door takes an identity,
//                  which a fold over every account with a live mark does not
//                  have. `SystemTx.insert` is generic over `TableKey`, which
//                  contains the derived class, and `src/db.ts`'s `LIVE_DB.batch`
//                  yields exactly that handle at `systemDb('nightly-batch')`.
//
// SO THE DOOR EXISTS, IT IS THIS DEPLOYABLE'S, AND IT IS ALREADY OPEN. Nothing
// here widens it and no manifest line is added: `apps/worker/package.json`
// declares `@merit/db` and `@merit/rules-engine`, and both halves of this file
// resolve through those two.
//
// **THAT IS NOT THE ANSWER THE EVENT SINK GOT AND THE CONTRAST IS WORTH THE
// PARAGRAPH.** `test/event-sink.test.ts` records that this deployable holds
// every `emit` call and no producer, that the producer is `apps/api`'s, and that
// `RI-04` plus `node-linker=isolated` leave no specifier that reaches it. A
// `rule_states` row needs no producer one deployable over: it is a table write
// and the accessor already names the table. `rule_states` also carries NO
// TRIGGER -- derived live over all 60 migrations from `pg_trigger`, zero
// non-internal rows -- so an insert here emits nothing and needs no sink.
//
// -----------------------------------------------------------------------------
// 2. THE COLUMN THAT NEEDED A RULING, AND THE RULING THAT LANDED
// -----------------------------------------------------------------------------
// `rule_states` has TWO `jsonb` columns and they arrived at a declared shape by
// two different routes.
//
//   `context_gates`  DECLARED IN CODE. `ports.ts`'s {@link StoredContextGates}
//                    is the stored shape, its own comment rules the engine's
//                    five fields over `0015`'s four, and every leaf is a
//                    boolean, a string or `null`. It goes to the column as it
//                    stands.
//   `engine_gates`   DECLARED BY A RULING, `ADR-206`, and {@link encodeEngineGates}
//                    below is that ruling as code.
//
// **WHAT THIS FILE SAID BEFORE `ADR-206` MERGED, KEPT RATHER THAN DELETED**,
// because a refuted sentence deleted leaves nothing for the next reader to
// check. It read: "THIS FILE THEREFORE TAKES THE ENCODING AS A PARAMETER AND
// SUPPLIES NONE ... a landed writer clears term 1 and leaves term 2 standing.
// THE DEPENDENCY RUNS BOTH WAYS. A writer cannot fill column 19 either." **THE
// PREMISE WAS TRUE WHEN WRITTEN AND IS NOW SPENT.** Both halves of the argument
// were right: no primary source declared the bag, `EngineGateResults` types
// seven of its twenty-five leaves as `Cents`, and `hash.ts` states that its own
// canonical serialization is NOT the column. `ADR-206` ruled it while this
// branch was open, so the seam has a supplier and the parameter is gone: an
// injected encoding with a refusing default, kept after its reason expired,
// would be an invitation to a SECOND encoding, which is the defect that entry
// was written to end.
//
// **THE RULING, AS THIS FILE MUST BE ABLE TO SATISFY IT.** `ADR-206` ruling 1
// through 5: the engine's own `EngineGateResults` value, six groups and
// twenty-five leaves and no others, in the ENGINE's field names rather than
// `API_CONTRACT`'s; every `*Cents` leaf a JSON string holding the base-10
// integer, on the round-trip evidence in that entry's section 5 that a JSON
// number loses a `Cents` at the READ port rather than in Postgres; every other
// leaf its JSON primitive with `null` as JSON `null` and never as the hash's
// `~null` sentinel; and `skipped` on `tradedDays`, `consistency` and
// `cadenceGap` and on no other group.
//
// **THE LEAF SET IS BOUND TO THE ENGINE'S OWN LIST RATHER THAN RE-TYPED HERE.**
// Ruling 1 says the leaves "are exactly `ENGINE_GATE_LEAVES`' dotted paths", so
// `test/rule-state-writer.test.ts` walks what {@link encodeEngineGates} produces,
// flattens it to dotted paths and compares that set with `ENGINE_GATE_LEAVES` in
// BOTH directions. A leaf added to a gate interface without a line here is a red
// suite rather than a column quietly one field short of the hash beside it.
//
// **KEY ORDER IS NOT PART OF THE ENCODING** (ruling 6), because `jsonb` does not
// preserve it. Measured on a live row by this session and independently by
// `ADR-206` section 6: written in declaration order, stored sorted by length
// then bytewise. The consequence is `hash.ts`'s and it is why {@link ruleStateValues}
// passes `state_hash` through by REFERENCE: the column and the hash are written
// from one in-memory value in one step, and a hash recomputed from a round trip
// would be a different serializer.
//
// -----------------------------------------------------------------------------
// 3. THE GUARD IS OVER ANY ENCODING RATHER THAN OVER THE ONE THAT WAS RULED
// -----------------------------------------------------------------------------
// **IT OUTLIVED THE SEAM IT WAS WRITTEN FOR AND IT IS KEPT DELIBERATELY.** With
// the encoding ruled, the guard no longer stands between this file and an
// encoder somebody else installs; it stands between this file and its own next
// edit. A leaf added to a gate interface and transcribed here as a raw `Cents`
// is a `TypeError: Do not know how to serialize a BigInt` raised inside a query
// builder, with no column name in it.
// Worse, two of the shapes that DO serialize are silent: `undefined` makes
// `JSON.stringify` DROP the key, so a gate leaf disappears rather than failing,
// and `NaN` and `Infinity` both render as `null`, so a money figure becomes an
// absence.
//
// {@link refuseUnstorableJson} therefore walks the encoded value and refuses
// bigint, `undefined`, a function, a symbol, a non-finite number, a
// non-integer number, a number outside the safe-integer range, and a cycle,
// NAMING THE PATH. It admits every shape a ruling could reasonably choose:
// base-10 strings, integer numbers, nested objects, arrays, `null`.
//
// **IT CONSTRAINS NO RULING AND ENFORCES ONE THIS CORPUS ALREADY MADE.**
// `CLAUDE.md`: "Money is integer cents ... No floats in financial paths". Every
// numeric leaf of `EngineGateResults` is a `Cents`, a count or a basis-point
// figure, so an encoding that produced a fractional or unsafe number would be
// producing one the constitution forbids before it was one this file disliked.
// The same walk runs over `context_gates`, where it asserts today and guards the
// day a field is added to {@link StoredContextGates}.
//
// -----------------------------------------------------------------------------
// 4. ONE TRANSACTION PER ROW, AND THE UNIQUE INDEX IS NOT SWALLOWED
// -----------------------------------------------------------------------------
// `OVERVIEW` section 5.2: "Any stage failing leaves prior stages committed per
// account and the batch resumable at the account boundary, so a crash at account
// 2,341 of 5,000 resumes without double-applying a day." `recon/sweep.ts` takes
// that as one transaction per account and so does this, for the same reason: one
// transaction around the population would make the sentence false.
//
// **`rule_states_account_day_uq` EXISTS AND THIS FILE DOES NOT `ON CONFLICT`
// PAST IT.** Derived live: `(account_id, trading_day)` unique over all 60
// migrations. `0015`'s rule is that "a rule state is never superseded", so a
// second write for one account-day is either a resumed run re-attempting a day
// it already closed or a fold that disagrees with a stored row, and those two
// have different remedies: the first is a SKIP the caller must decide, the
// second is `INV-04`'s divergence. `ON CONFLICT DO NOTHING` reports both as
// success and `ON CONFLICT DO UPDATE` is a grant `0026` revoked. So the
// collision surfaces as {@link RuleStateAlreadyWritten}, which names the
// account-day.
//
// **AND THE CALLER HAS NO SKIP TODAY, WHICH IS REPORTED RATHER THAN REPAIRED.**
// `runNightlyBatch` folds every account `accountsWithLiveMark` returns and reads
// no stored row first, so a resumed run re-attempts every account it already
// wrote. That is `nightly.ts`'s decision and not this file's; the typed refusal
// is what makes it visible instead of a `23505` at 02:00.
//
// -----------------------------------------------------------------------------
// 5. WHAT THIS FILE IS NOT
// -----------------------------------------------------------------------------
// It implements ONE of `BatchWritePort`'s three methods. `raiseReconciliation`
// and `raiseDivergence` are NOT here and the reason is the door again rather
// than the effort: `EVENTS.md:194` makes `replay.divergence_detected` one of
// "the two events that must never be quiet", `ports.ts` says the adapter
// "expands one finding into one event per diverging field", and
// `test/event-sink.test.ts` records that no event producer is reachable from
// this deployable at all. A `BatchWritePort` composed from this file plus two
// silent stubs would be a batch whose audit channel is a no-op, so this file
// composes no `BatchWritePort` and exports the one method it can serve.
//
// It also reads nothing. `BatchReadPort` is nine methods over five tables and
// none of them is term 1.
// =============================================================================

import type { EngineGateResults } from '@merit/rules-engine';

import type { BatchWritePort, RuleStateRow } from './ports.ts';

// -----------------------------------------------------------------------------
// The table, and no others
// -----------------------------------------------------------------------------

/**
 * The tables this writer may WRITE, as a closed union of ONE.
 *
 * A UNION OF ONE RATHER THAN A BARE LITERAL, in `recon/ports.ts`'s and
 * `detectors/ports.ts`'s idiom: `SystemTx.insert` is declared over `TableKey`
 * and reaches every table in the estate with one word, and a port accepting that
 * reach would spend `ADR-102` section 8's widening for a file that writes one
 * row. A wider handle is assignable to a narrower shape, so the narrowing costs
 * the wiring nothing.
 */
export const RULE_STATE_WRITE_TABLES = ['ruleStates'] as const;

/** One of {@link RULE_STATE_WRITE_TABLES}. */
export type RuleStateWriteTable = (typeof RULE_STATE_WRITE_TABLES)[number];

// -----------------------------------------------------------------------------
// The columns, as the accessor spells them
// -----------------------------------------------------------------------------

/**
 * Every `rule_states` column this writer sets, by Drizzle property name.
 *
 * TWENTY-THREE, AND THE THREE ABSENCES ARE THE DATABASE'S. `ports.ts` states the
 * rule this list obeys: "`id`, `computed_at` and `created_at` are absent because
 * they are the database's: `id` is `GENERATED ALWAYS AS IDENTITY` and both
 * timestamps default to `now()`. THE BATCH THEREFORE READS NO CLOCK."
 *
 * **IT IS DATA SO A SUITE CAN COMPARE IT WITH THE SCHEMA RATHER THAN WITH THIS
 * FILE.** `test/rule-state-writer.test.ts` parses the `ruleStates` block of
 * `packages/db/src/schema.ts` and asserts the partition in both directions: each
 * name here is a property there, and the properties not here are exactly `id`,
 * `computedAt` and `createdAt`. So a column a later migration adds is a red
 * suite rather than a value nobody writes, which is `ADR-034`'s remedy applied
 * to a transcription this file would otherwise be the only copy of.
 *
 * The order is `RuleStateRow`'s, which is `0015`'s, which is `ADR-026` C-07's
 * for the eighteen it shares with the hash.
 */
export const RULE_STATE_WRITE_COLUMNS = [
  'accountId',
  'tradingDay',
  'phase',
  'floorCents',
  'floorLocked',
  'floorOpenCents',
  'highWaterBalanceCents',
  'balanceCents',
  'withdrawableCents',
  'tradedDaysCount',
  'winDaysCount',
  'consistencyBestDayCents',
  'consistencyPeriodProfitCents',
  'consistencyPeriodStartDay',
  'payoutsSettledCount',
  'payoutAnchorDay',
  'cadenceAnchorDay',
  'engineEligible',
  'engineGates',
  'contextGates',
  'stateHash',
  'engineVersion',
  'calendarRevisionId',
] as const;

/** One of {@link RULE_STATE_WRITE_COLUMNS}. */
export type RuleStateWriteColumn = (typeof RULE_STATE_WRITE_COLUMNS)[number];

/**
 * The values of one `rule_states` insert, TOTAL over {@link RULE_STATE_WRITE_COLUMNS}.
 *
 * A MAPPED TYPE RATHER THAN `Record<string, unknown>`, which is what every other
 * port in this deployable uses and is the right shape THERE: those ports write
 * several tables and cannot name one column set. This one writes a single table
 * whose column list is fixed by a merged migration, so the mapped type makes a
 * MISSING column a compile error and a MISSPELT one a compile error, neither of
 * which a `Record` can see. A misspelt property name is the failure that
 * matters: Drizzle would map it to no column and Postgres would apply the
 * column's default or its `NOT NULL`, so `floor_cent` is either a silent zero or
 * an error naming a column the writer never mentioned.
 */
export type RuleStateValues = { readonly [K in RuleStateWriteColumn]: unknown };

// -----------------------------------------------------------------------------
// One open transaction, as a rule-state writer needs to see it
// -----------------------------------------------------------------------------

/**
 * One open transaction.
 *
 * **ONE METHOD, AND THE FOUR ABSENCES ARE THE MIGRATIONS.** There is no
 * `updateAt` and no `deleteAt` because `0026` revoked `UPDATE, DELETE` on
 * `rule_states` from `merit_app` and PUBLIC, so a handle carrying either would
 * be a shape the grant refuses at run time and the type would be describing a
 * capability this role does not have. There is no `rowsWhere` because this file
 * reads nothing. There is no `lockAt` because `FM-10`'s per-account advisory
 * lock, which `nightly.ts` names in terms, is a LOCK ON THE ACCOUNT taken around
 * the whole fold, not a row lock on a table that has no row to contend for
 * before this insert creates it; taking it here would be taking it after the
 * fold it exists to serialize.
 */
export interface RuleStateTx {
  /** Write one row, returning it. */
  insert(key: RuleStateWriteTable, values: RuleStateValues): Promise<unknown[]>;
}

/**
 * Everything the writer needs from the world.
 *
 * **ONE MEMBER, AND IT USED TO BE TWO.** `encodeEngineGates` was here while
 * `B5` term 2 was open; `ADR-206` ruled the encoding, so the encoder is a
 * function in this file rather than a parameter a deployment supplies. Header
 * section 2 keeps the argument that put it here in the first place.
 */
export interface RuleStateWriterIo {
  /**
   * One unit of work. Called ONCE PER ROW; header section 4 is why.
   */
  transact<T>(fn: (tx: RuleStateTx) => Promise<T>): Promise<T>;
}

// -----------------------------------------------------------------------------
// The refusals
// -----------------------------------------------------------------------------

/**
 * Raised by a port that is not installed.
 *
 * A WRITER THAT SILENTLY DID NOTHING WOULD BE THE WORST OF THE THREE OPTIONS.
 * `runNightlyBatch` counts a `written` outcome per account that did not throw,
 * so a no-op adapter produces a report saying 5,000 rows were written on a night
 * on which the book gained none, and `INV-04`'s replay audit then reads an empty
 * table as an estate with nothing to audit. Refusing turns that into a batch
 * that fails.
 */
export class RuleStateWriterUnwired extends Error {
  constructor(what: string) {
    super(
      `RuleStateWriterIo.${what} cannot be served by this deployment: no adapter is installed. ` +
        'The rule-state writer refuses rather than returning, because a batch that reports 5,000 ' +
        'rows written on a night it wrote none is indistinguishable from a batch that worked.',
    );
    this.name = 'RuleStateWriterUnwired';
  }
}

/** The unwired default, which serves nothing. */
export const UNWIRED_RULE_STATE_WRITER_IO: RuleStateWriterIo = {
  transact: () => Promise.reject(new RuleStateWriterUnwired('transact')),
};

/**
 * A `jsonb` value this writer will not send to Postgres. Header section 3.
 *
 * SEPARATE FROM {@link RuleStateWriterUnwired} because they are different
 * events: one says a deployment installed nothing, the other says a deployment
 * installed something that would corrupt a money figure on the way through
 * `JSON.stringify`.
 */
export class RuleStateEncodingRefusal extends Error {
  /** The `jsonb` column whose value was refused. */
  readonly column: 'engine_gates' | 'context_gates';
  /** Where in that value the offending leaf sits, from `$`. */
  readonly path: string;

  // **THE FIELDS ARE ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, AND
  // THAT IS A RUNTIME REQUIREMENT RATHER THAN A STYLE.** `ADR-083` rules that
  // every deployable runs under `node --experimental-strip-types`, which erases
  // types and rewrites nothing: a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time. `tsc --noEmit` accepts it,
  // so the failure is invisible to `CI-01` and to every suite Vitest transforms.
  // FOUND BY RUNNING THIS FILE, on the first execution of it.
  constructor(column: 'engine_gates' | 'context_gates', path: string, why: string) {
    super(`rule_states.${column} at ${path}: ${why}`);
    this.name = 'RuleStateEncodingRefusal';
    this.column = column;
    this.path = path;
  }
}

/**
 * `rule_states_account_day_uq` refused a second row for one account-day.
 *
 * Header section 4. The SQLSTATE is read off the error rather than the message,
 * because a message is localized and a class is not, and `23505` is
 * `unique_violation` in every locale.
 */
export class RuleStateAlreadyWritten extends Error {
  readonly accountId: string;
  readonly tradingDay: string;
  /**
   * The driver error the unique index raised, kept so a caller can read its class.
   *
   * NAMED `driverError` RATHER THAN `cause`, which was the first spelling and
   * which `tsc` refused: `Error` already declares `cause`, so the field was an
   * override rather than a new member (TS4114). Adding `override` would have
   * been the smaller edit and the wrong one -- `Error.cause` is the chain
   * `isUniqueViolation` WALKS, and a field that shadows it would make the class
   * that reports a wrapped error the one thing that cannot be walked.
   */
  readonly driverError: unknown;

  // Assigned rather than declared in the parameter list, for the runtime reason
  // {@link RuleStateEncodingRefusal} states.
  constructor(accountId: string, tradingDay: string, driverError: unknown) {
    super(
      `rule_states already holds a row for account ${accountId} on ${tradingDay}. 0015: "a rule ` +
        'state is never superseded. A correction to the inputs produces a REPLAY, and the ' +
        'replay\'s divergence is the finding." A resumed run must SKIP a day it already closed ' +
        'and this writer will not decide that for its caller, because a skip and a divergence ' +
        'have different remedies and ON CONFLICT DO NOTHING reports both as success.',
    );
    this.name = 'RuleStateAlreadyWritten';
    this.accountId = accountId;
    this.tradingDay = tradingDay;
    this.driverError = driverError;
  }
}

/** PostgreSQL `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * `true` when `error` OR ANY ERROR IT WRAPS carries SQLSTATE {@link UNIQUE_VIOLATION}.
 *
 * **THE CHAIN IS WALKED BECAUSE THE FIRST DRAFT DID NOT WALK IT AND DID NOT
 * FIRE.** Executed against a live database, a second insert for one account-day
 * arrives here as a `DrizzleQueryError` whose own `code` is `undefined` and
 * whose `cause` is the `pg` error carrying `23505`. A guard reading only the
 * top-level `code` therefore let the raw driver error through, and the caller
 * got a 700-character `Failed query:` dump instead of the account and the day.
 * The seed that found it is in `test/rule-state-writer.test.ts`.
 *
 * The walk is bounded rather than open: a cause chain is data from a driver, and
 * a cyclic one would hang a nightly batch inside an error handler.
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

// -----------------------------------------------------------------------------
// The guard
// -----------------------------------------------------------------------------

/**
 * Refuse a value `JSON.stringify` would throw on, drop, or quietly change.
 *
 * EXPORTED SO A SUITE CAN RUN IT OVER SHAPES NO ENCODER IN THIS TREE PRODUCES.
 * The point of the guard is the encoder nobody has written yet.
 *
 * The walk is iterative over an explicit stack rather than recursive: the depth
 * of an encoding this file does not define is not a number this file can bound,
 * and a stack overflow inside a money-path write is a crash whose message names
 * no column.
 */
export function refuseUnstorableJson(
  column: 'engine_gates' | 'context_gates',
  value: unknown,
): void {
  const seen = new Set<object>();
  const stack: { readonly path: string; readonly value: unknown }[] = [{ path: '$', value }];

  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    const { path, value: current } = next;

    switch (typeof current) {
      case 'bigint':
        // THE ONE THAT MADE THIS SEAM NECESSARY. `hash.ts`: "`JSON.stringify`
        // THROWS ON A BIGINT, and four of the twenty-five leaf fields below are
        // `Cents`."
        throw new RuleStateEncodingRefusal(
          column,
          path,
          'a bigint. JSON.stringify throws on one, so this value cannot reach a jsonb column at ' +
            'all. An encoding renders cents as a base-10 string or as an integer number, and ' +
            'which of those it is, is a ruling this file does not hold',
        );
      case 'undefined':
        // SILENT. `JSON.stringify({a: undefined})` is `'{}'`, so a gate leaf
        // would VANISH rather than fail, and the column would still be valid
        // jsonb.
        throw new RuleStateEncodingRefusal(
          column,
          path,
          'undefined. JSON.stringify DROPS the key, so this leaf would be absent from the stored ' +
            'bag and the write would still succeed. An absent gate is not a failed write',
        );
      case 'function':
      case 'symbol':
        throw new RuleStateEncodingRefusal(
          column,
          path,
          `a ${typeof current}, which JSON.stringify drops the same way undefined is dropped`,
        );
      case 'number':
        if (!Number.isFinite(current))
          // ALSO SILENT, AND WORSE. `JSON.stringify(NaN)` is `'null'`, so a
          // money figure becomes an absence rather than a wrong number.
          throw new RuleStateEncodingRefusal(
            column,
            path,
            `${String(current)}. JSON.stringify renders it as null, so a figure becomes an ` +
              'absence and nothing downstream can tell that apart from a leaf the encoding ' +
              'deliberately omitted',
          );
        if (!Number.isInteger(current))
          throw new RuleStateEncodingRefusal(
            column,
            path,
            `${String(current)}, which is not an integer. CLAUDE.md: "Money is integer cents; ` +
              'thresholds in basis points / integer cents. No floats in financial paths." Every ' +
              'numeric leaf of EngineGateResults is a Cents, a count or a basis-point figure',
          );
        if (!Number.isSafeInteger(current))
          throw new RuleStateEncodingRefusal(
            column,
            path,
            `${String(current)}, which is outside the safe-integer range. A cents figure past ` +
              '2^53 - 1 rendered as a JSON number is a figure that has already lost its low ' +
              'digits, and it round-trips as a plausible number rather than as an error',
          );
        break;
      case 'object': {
        if (current === null) break;
        if (seen.has(current))
          throw new RuleStateEncodingRefusal(
            column,
            path,
            'a cycle. JSON.stringify throws on one, and a walk that did not track this would ' +
              'not reach the throw',
          );
        seen.add(current);
        if (Array.isArray(current)) {
          for (let i = current.length - 1; i >= 0; i -= 1)
            stack.push({ path: `${path}[${String(i)}]`, value: current[i] });
          break;
        }
        // THE KEYS ARE READ AND THE ORDER IS NOT USED. `M01` section 1.4 bans
        // "iteration over an object's keys WHERE THE RESULT AFFECTS OUTPUT";
        // this walk returns nothing and throws on the first offender it meets,
        // so the only thing key order can change is which of several bad leaves
        // is named first.
        for (const [key, member] of Object.entries(current))
          stack.push({ path: `${path}.${key}`, value: member });
        break;
      }
      default:
        // `string` and `boolean`. Both survive a round trip unchanged.
        break;
    }
  }
}

// -----------------------------------------------------------------------------
// `ADR-206`: the stored `engine_gates` bag
// -----------------------------------------------------------------------------

/**
 * `rule_states.engine_gates` as `ADR-206` rules it.
 *
 * SIX GROUPS AND TWENTY-FIVE LEAVES, in the ENGINE's field names. The groups
 * and their field order are `EngineGateResults`' own, which is what
 * `docs/architecture/data-model/rule_states.md` reproduces; the ORDER is not
 * part of the encoding (`ADR-206` ruling 6) and is written this way so a
 * reviewer can read this type beside the interface it stores.
 *
 * **THE SEVEN `string` MEMBERS ARE THE CENTS LEAVES AND THE TYPE IS THE POINT.**
 * `ADR-206` ruling 3 makes every `*Cents` leaf a base-10 string, so a `number`
 * here is a compile error rather than a value that survives to a round trip and
 * loses its low digits at the read port.
 */
export interface StoredEngineGates {
  readonly tradedDays: {
    readonly pass: boolean;
    readonly skipped: boolean;
    readonly have: number;
    readonly need: number;
  };
  readonly winDays: {
    readonly pass: boolean;
    readonly have: number;
    readonly need: number;
    readonly floorCents: string;
  };
  readonly buffer: {
    readonly pass: boolean;
    readonly haveCents: string;
    readonly needCents: string;
  };
  readonly consistency: {
    readonly pass: boolean;
    readonly skipped: boolean;
    readonly bestDayShareBp: number | null;
    readonly maxDayShareBp: number | null;
    readonly profitNeededToDiluteCents: string;
  };
  readonly cadenceGap: {
    readonly pass: boolean;
    readonly skipped: boolean;
    readonly tradingDaysSinceLastPayout: number | null;
    readonly need: number;
    readonly nextEligibleTradingDay: string | null;
  };
  readonly minimumAmount: {
    readonly pass: boolean;
    readonly withdrawableCents: string;
    readonly capCents: string;
    readonly minPayoutCents: string;
  };
}

/**
 * `ADR-206` ruling 3's base-10 string. `toString(10)` carries the sign.
 *
 * THE SAME TEXT `hash.ts`'s `money()` PRODUCES, which is ruling 3's own closing
 * argument: "the column and the hash speak one representation of money instead
 * of two". It is spelled again here rather than imported because that function
 * is module-private to the serializer and exporting it would make one helper
 * serve two encodings that are only incidentally the same today.
 */
function centsText(value: bigint): string {
  return value.toString(10);
}

/**
 * The engine's gates as the column holds them (`ADR-206` rulings 1 to 5).
 *
 * **WRITTEN OUT LEAF BY LEAF RATHER THAN WALKED, AND `M01` SECTION 1.4 IS WHY.**
 * That section bans "iteration over an object's keys where the result affects
 * output", and this function's whole output is such a result. `ENGINE_GATE_LEAVES`
 * is the corpus's answer to the same problem one column over and it renders for
 * a HASH rather than for `jsonb`, so its `render` is not reusable here: it
 * writes `null` as a sentinel and frames every leaf as text, both of which
 * ruling 4 refuses.
 *
 * **SO THE LEAF SET IS BOUND MECHANICALLY INSTEAD.** Ruling 1 says the leaves
 * "are exactly `ENGINE_GATE_LEAVES`' dotted paths", and
 * `test/rule-state-writer.test.ts` flattens what this returns and compares the
 * two sets in both directions. That is the check this file cannot perform on
 * itself: a leaf added to a gate interface and forgotten here is a column one
 * field short of the hash beside it, and nothing else in this tree would say so.
 *
 * **NO CONTEXT GATE IS HERE AND `INV-23` IS WHY.** `SD-06` split the column in
 * two precisely so the replayed half carries nothing that "was true on the day
 * and may not be true now", and `ADR-206`'s section 3 records that the wire
 * shape's four `R-40` gates are the reason the wire shape is not this.
 */
export function encodeEngineGates(gates: EngineGateResults): StoredEngineGates {
  return {
    tradedDays: {
      pass: gates.tradedDays.pass,
      skipped: gates.tradedDays.skipped,
      have: gates.tradedDays.have,
      need: gates.tradedDays.need,
    },
    winDays: {
      pass: gates.winDays.pass,
      have: gates.winDays.have,
      need: gates.winDays.need,
      floorCents: centsText(gates.winDays.floorCents),
    },
    buffer: {
      pass: gates.buffer.pass,
      haveCents: centsText(gates.buffer.haveCents),
      needCents: centsText(gates.buffer.needCents),
    },
    consistency: {
      pass: gates.consistency.pass,
      skipped: gates.consistency.skipped,
      // Ruling 4: a nullable JSON integer, and `null` is JSON null. `R-30`'s
      // denominator rule is what makes both of these absent rather than zero.
      bestDayShareBp: gates.consistency.bestDayShareBp,
      maxDayShareBp: gates.consistency.maxDayShareBp,
      profitNeededToDiluteCents: centsText(gates.consistency.profitNeededToDiluteCents),
    },
    cadenceGap: {
      pass: gates.cadenceGap.pass,
      skipped: gates.cadenceGap.skipped,
      tradingDaysSinceLastPayout: gates.cadenceGap.tradingDaysSinceLastPayout,
      need: gates.cadenceGap.need,
      // `AS-06`'s resolved date, and the ONE leaf `ADR-204` reads out of this
      // bag: the only forward-knowable input to the figure the payout wallet is
      // funded against. A `TradingDay` is a branded `YYYY-MM-DD` string, so it
      // reaches the column as ruling 4's string with no conversion.
      nextEligibleTradingDay: gates.cadenceGap.nextEligibleTradingDay,
    },
    minimumAmount: {
      pass: gates.minimumAmount.pass,
      withdrawableCents: centsText(gates.minimumAmount.withdrawableCents),
      capCents: centsText(gates.minimumAmount.capCents),
      minPayoutCents: centsText(gates.minimumAmount.minPayoutCents),
    },
  };
}

// -----------------------------------------------------------------------------
// The mapping
// -----------------------------------------------------------------------------

/**
 * One `RuleStateRow` as the values of one insert.
 *
 * PURE, EXPORTED, AND SEPARATE FROM THE WRITE, so a suite can read every value
 * this writer would send without a database and without a fake transaction. That
 * is the half `apps/worker/src/db.ts`'s header says a recorder can prove: "which
 * key was named, which address was written, which values were set".
 *
 * **THE FIELD NAMES ARE `RuleStateRow`'s AND THE COLUMN NAMES ARE THE SAME
 * TWENTY-THREE WORDS**, which is a fact about this schema rather than a rule,
 * and it is asserted in the suite against `packages/db/src/schema.ts` rather
 * than trusted. TWO of the twenty-three are not identity, and both are here:
 *
 *   `engineGates`        header section 2. Encoded by {@link encodeEngineGates}
 *                        to `ADR-206`'s ruling, then guarded.
 *   `calendarRevisionId` `RuleStateRow` types it `number | null` and
 *                        `0035_rule_states_calendar_revision.sql` declares the
 *                        column `bigint`, which the accessor reads in `bigint`
 *                        mode.
 *
 * **THE CONVERSION IS A GUARD AND NOT A COMPATIBILITY SHIM, AND THE DIFFERENCE
 * WAS MEASURED RATHER THAN ASSUMED.** The pass-through was executed against a
 * live database first: Drizzle ACCEPTED a JS number for the `bigint` column,
 * wrote the row, and read it back as a `bigint`. So nothing compels this line.
 * What it buys is that `BigInt()` REFUSES a fractional or non-finite value at
 * the one boundary where the port's `number` meets the column's `bigint`
 * (executed: `BigInt(1.5)` raises `RangeError`), and that the value written and
 * the value read back are one type rather than two.
 */
export function ruleStateValues(row: RuleStateRow): RuleStateValues {
  const engineGates = encodeEngineGates(row.engineGates);
  refuseUnstorableJson('engine_gates', engineGates);
  // `StoredContextGates` is JSON-safe today and this walk asserts it rather than
  // assuming it. The column is `NOT NULL` and the day somebody adds a `Cents`
  // field to that interface, this line is what fails instead of the query
  // builder.
  refuseUnstorableJson('context_gates', row.contextGates);

  return {
    accountId: row.accountId,
    tradingDay: row.tradingDay,
    phase: row.phase,
    floorCents: row.floorCents,
    floorLocked: row.floorLocked,
    floorOpenCents: row.floorOpenCents,
    highWaterBalanceCents: row.highWaterBalanceCents,
    balanceCents: row.balanceCents,
    withdrawableCents: row.withdrawableCents,
    tradedDaysCount: row.tradedDaysCount,
    winDaysCount: row.winDaysCount,
    consistencyBestDayCents: row.consistencyBestDayCents,
    consistencyPeriodProfitCents: row.consistencyPeriodProfitCents,
    consistencyPeriodStartDay: row.consistencyPeriodStartDay,
    payoutsSettledCount: row.payoutsSettledCount,
    payoutAnchorDay: row.payoutAnchorDay,
    cadenceAnchorDay: row.cadenceAnchorDay,
    engineEligible: row.engineEligible,
    engineGates,
    contextGates: row.contextGates,
    // SD-08's bytes AS STORAGE WILL HOLD THEM. `ports.ts`: "THE ADAPTER MUST
    // WRITE THIS VALUE, NOT A RE-DERIVATION OF IT", because a hash recomputed
    // from a `jsonb` round trip is a different serializer. Nothing here touches
    // it.
    stateHash: row.stateHash,
    engineVersion: row.engineVersion,
    calendarRevisionId: row.calendarRevisionId === null ? null : BigInt(row.calendarRevisionId),
  };
}

// -----------------------------------------------------------------------------
// The writer
// -----------------------------------------------------------------------------

/**
 * `BatchWritePort.writeRuleState`, over `io`.
 *
 * **TYPED AS THE PORT'S OWN MEMBER RATHER THAN AS A FUNCTION THAT LOOKS LIKE
 * IT.** `BatchWritePort['writeRuleState']` is the declared signature, so the day
 * that contract changes this file is a compile error rather than a second
 * implementation of a shape nothing compares.
 *
 * IT RETURNS NOTHING AND CHECKS THAT SOMETHING HAPPENED. `insert` returns the
 * row it wrote, and an insert that returned none would be a write nobody
 * performed reported as a write that succeeded, which is the same failure the
 * unwired default refuses one layer up.
 */
export function writeRuleStateVia(io: RuleStateWriterIo): BatchWritePort['writeRuleState'] {
  return async (row: RuleStateRow): Promise<void> => {
    const values = ruleStateValues(row);

    const written = await io.transact(async (tx) => {
      try {
        return await tx.insert('ruleStates', values);
      } catch (error) {
        if (isUniqueViolation(error))
          throw new RuleStateAlreadyWritten(row.accountId, String(row.tradingDay), error);
        throw error;
      }
    });

    if (written.length !== 1)
      throw new Error(
        `rule_states insert for account ${row.accountId} on ${String(row.tradingDay)} returned ` +
          `${String(written.length)} rows and one row was written. A write nobody performed, ` +
          'reported as a write that succeeded, is what the nightly report would then count.',
      );
  };
}
