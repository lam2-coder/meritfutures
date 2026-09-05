// =============================================================================
// apps/worker/src/recon/adapter.ts
// =============================================================================
// **THE RECONCILIATION SWEEP'S ADAPTER: THE ONE THING THAT STOOD BETWEEN
// `runReconciliationSweep` AND A REAL DATABASE.**
//
// `ports.ts` declared `ReconSweepIo` and `sweep.ts` was written against it, and
// the only inhabitant of that type in this tree was `UNWIRED_RECON_SWEEP_IO`,
// whose three members reject. `schedule.ts` recorded exactly that as the recon
// row's blocker. This file is the blocker discharged and NOTHING ELSE: it makes
// the sweep RUNNABLE and it does not make it RUN, and section 6 is the argument
// for that being two decisions rather than one.
//
// `batch/adapter.ts` is the idiom, one directory over, and every structural
// choice below is transcribed from it rather than invented: the transaction type
// is DERIVED from the door, every row the accessor returns is checked at the
// boundary, and the door is an ARGUMENT so a suite substitutes a recorder.
//
// -----------------------------------------------------------------------------
// 1. THE DOOR IS ALREADY OPEN AND THIS FILE DOES NOT WIDEN IT
// -----------------------------------------------------------------------------
// `src/db.ts`'s `LIVE_DB.batch` yields a `SystemTx` at `systemDb('nightly-batch')`
// whose `rowsWhere`, `insert` and `updateAt` are generic over `TableKey`, and
// `TableKey` contains both of the sweep's scope classes: `reconciliation_runs`
// is `firm` and `reconciliations` is `derived` through `account_id`.
// `ports.ts` header section 1 argued that before this file existed and it is
// EXECUTED here rather than re-argued.
//
// **NO `SystemReason` MEMBER IS ADDED, NO `SqlExecutorReason` MEMBER IS ADDED,
// `pg` IS NOT IMPORTED, `drizzle-orm` IS NOT IMPORTED, AND NOTHING IS CAST PAST
// A KEY TYPE.** `test/db.test.ts` asserts that exactly one file under this
// deployable's `src/` names `@merit/db` and this file is not it; every
// capability it holds arrives through `../db.ts`.
//
// **THE TERM CONSTRUCTOR ARRIVES THROUGH THAT SAME FILE AND THIS ROW DID NOT PUT
// IT THERE.** `src/db.ts` re-exports `atMost` and `isNull` from `packages/db`
// and argues at length why a term is not a door: it reaches no table, it has no
// key vocabulary and no scope predicate, and there is no argument position in
// the accessor where a term becomes a scope. This file uses one of the two, and
// {@link reconIsNull} narrows it against its own discriminant rather than
// wrapping it, because that file's rule is that a term is passed through
// UNTOUCHED or the accessor stops recognising it.
//
// -----------------------------------------------------------------------------
// 2. `ADR-102`'s `WHERE`-LESS WRITE PATH IS NOT THIS PORT'S BLOCKER, AND THE
//    DIFFERENCE IS THE METHOD NAME
// -----------------------------------------------------------------------------
// `provisioning/ports.ts` measures `SystemTx.update(key, values)` rendering
// `update "provisioning_queue" set "status" = $1 returning ...` WITH NO `WHERE`,
// and `SystemTx.rows(key)` selecting every row in the table, and declares two
// ports blocked on it. That finding is real and it is about the UNADDRESSED
// forms.
//
// **`ReconTx` NAMES NEITHER OF THEM.** Its three methods are `rowsWhere`,
// `insert` and `updateAt`, and the accessor composes a predicate for the first
// and the third out of the address the caller passed: `systemTx.rowsWhere` calls
// `unscopedFilterPredicate(key, where)` and `systemTx.updateAt` calls
// `addressPredicate`, which additionally REFUSES a filter term and refuses an
// empty address. So the sweep's every read is narrowed and its every write names
// one row, and the port that would have been blocked by that finding is the one
// `ports.ts` deliberately did not declare.
//
// -----------------------------------------------------------------------------
// 3. THE FILTER IS TRANSLATED AND NOT FORWARDED, AND THE TRANSLATION IS THE
//    WHOLE OF WHY THIS FILE IS LONGER THAN A DELEGATION
// -----------------------------------------------------------------------------
// `ReconFilter` is `Readonly<Record<string, unknown>>` and `RowFilter<K>` is
// `Readonly<Partial<Record<AddressableColumn<K>, unknown>>>`. THE FIRST IS NOT
// ASSIGNABLE TO THE SECOND and that is the accessor's design rather than a
// friction: a column name is checked by `tsc` at the call site or it is checked
// nowhere.
//
// So every filter this adapter passes on is CONSTRUCTED HERE from column
// literals, one shape per table, and a filter naming anything else is a THROW.
// **DROPPING AN UNRECOGNISED COLUMN WOULD BE THE DEFECT THIS FILE MOST EASILY
// COULD HAVE HAD**: a filter silently reduced from `{tradingDay, supersededBy}`
// to `{tradingDay}` reads every superseded correction as though it were live,
// compares Merit's stored state against a mark the estate has already replaced,
// and reports a mismatch for every account that was ever corrected. A read that
// silently WIDENS is worse than a read that fails, because the sweep's whole
// output is a list of accounts to distrust.
//
// -----------------------------------------------------------------------------
// 4. WHAT THE ADAPTER REFUSES, WHICH IS ONE WRITE THE PORT TYPE ALLOWS
// -----------------------------------------------------------------------------
// `RECON_WRITE_TABLES` holds `accounts` because `0014_marks.sql` makes the block
// the consequence of a mismatch, and the port's `insert` is declared over that
// same union. **A RECONCILIATION SWEEP MUST NEVER CREATE AN ACCOUNT.** The type
// cannot say so without splitting the union, and `ports.ts` is a merged file
// this row does not hold, so the refusal is here and
// `test/recon-adapter.test.ts` walks it.
//
// -----------------------------------------------------------------------------
// 5. MONEY IS INTEGER CENTS AND THIS FILE PERFORMS NO ARITHMETIC AT ALL
// -----------------------------------------------------------------------------
// Every `*_cents` column the sweep touches is `bigint` in the DDL and the
// Drizzle declaration pins `{ mode: 'bigint' }`, so the values crossing this
// boundary are `bigint` in both directions and this file neither reads them nor
// converts them. `sweep.ts`'s `requireCents` REFUSES a `number` at the row
// boundary, which is the check that would fire if a future accessor change lost
// the mode pin. There is no `Number(`, no arithmetic operator on a balance and
// no float anywhere below.
//
// -----------------------------------------------------------------------------
// 6. THIS WIRES THE JOB AND DOES NOT SCHEDULE IT, AND THE SPLIT IS DELIBERATE
// -----------------------------------------------------------------------------
// `test/schedule.test.ts` case 3.1 derives a job's disposition from a CALLER
// CENSUS over `src/`: an entry point has a caller if and only if it is
// registered `scheduled`. **NOTHING IN THIS FILE CALLS
// `runReconciliationSweep`**, so the census still reports the recon row
// unscheduled, and it reports it correctly.
//
// THE THREE REASONS ARE `ADR-345`'s and are summarised here rather than left in
// a document nobody opens next to the code:
//
//   1. **THE BLOCK HAS NO RELEASE.** `sweep.ts` sets `accounts.recon_blocked`
//      on a mismatch and never clears it, because `0014_marks.sql` reserves the
//      clearing for a human. NOTHING IN THIS TREE CLEARS IT EITHER, in code or
//      in a route, which `test/recon-sweep.test.ts` asserts over every
//      `apps/*/src` and `packages/*/src` file. A clock in front of this today
//      is a control that can block an account's eligibility and no control that
//      can unblock it.
//   2. **THE RUN NEEDS A `batch_run_id` NOBODY IS MINTING.**
//      `ReconSweepConfig.batchRunId` is the nightly batch's own run id and
//      `runReconciliationSweep` REFUSES one that is not a uuid rather than
//      generating a plausible one. `OVERVIEW` section 5.2 puts this stage
//      INSIDE that batch, so the caller is `runNightlyBatch`'s and lives in
//      `batch/`, which is a different fence.
//   3. **THE DEAD-MAN SWITCH WOULD BE SATISFIED BY THE WRONG CHECK.** The
//      `CRON_INVENTORY` row `schedule.ts` maps this entry point to is
//      "per-identity ledger reconciliation", whose S1 alarm is `INV-M20-10`'s
//      per-identity wallet assertion (`GS-231`). This sweep compares a rule
//      state against a vendor mark per ACCOUNT-DAY. Scheduling it would silence
//      an S1 switch with a check that does not perform the assertion the row
//      names, which is quieter than the silence it replaced. **THAT
//      MISMATCH IS REPORTED AND NOT REPAIRED**: the registration is
//      `schedule.ts`'s and `ADR-345` records it as an open question.
// =============================================================================

import { isNull } from '../db.ts';
import type { WorkerDb } from '../db.ts';
import type {
  ReconFilter,
  ReconFilterTerm,
  ReconReadTable,
  ReconSweepIo,
  ReconTerms,
  ReconTx,
  ReconValues,
  ReconWriteTable,
} from './ports.ts';

/**
 * The transaction the one door hands out, named without importing `@merit/db`.
 *
 * `batch/adapter.ts`'s `BatchTx`, transcribed rather than imported, because that
 * file is a leg of a different slice and re-exporting a type through it would
 * make this module depend on the batch adapter for nothing but a name. If the
 * door's callback signature changes, this alias changes with it and every use
 * below stops compiling.
 */
export type ReconDbTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * Raised by the adapter, for an argument it will not pass to the accessor.
 *
 * SEPARATE FROM `ReconRowError` AND FROM `ReconSweepUnwired`. That first one
 * says the DATABASE returned a row the DDL says it cannot; the second says a
 * deployment installed no adapter at all. This one says a deployment installed
 * THIS adapter and the sweep asked it for something the translation below does
 * not cover, which is a code defect in the caller rather than a state of the
 * world.
 */
export class ReconAdapterError extends Error {
  /** The table key the refused call named. */
  readonly key: string;

  // ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on `BatchPortUnwired`'s
  // measured reason: ADR-083 runs every deployable under
  // `node --experimental-strip-types`, where a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time while `tsc --noEmit`
  // accepts it.
  constructor(key: string, why: string) {
    super(
      `the reconciliation adapter refuses a ${key} call: ${why}. A reconciliation sweep reports ` +
        'which accounts Merit may not trust, so a read this adapter widened or a write it ' +
        'redirected would corrupt exactly the list somebody acts on.',
    );
    this.name = 'ReconAdapterError';
    this.key = key;
  }
}

// -----------------------------------------------------------------------------
// The columns each shape may name, as data, so the refusal can print them
// -----------------------------------------------------------------------------

/**
 * The filter shape each read table is narrowed by, by Drizzle property name.
 *
 * TRANSCRIBED FROM `sweep.ts`'s CALL SITES AND FROM NOTHING ELSE. `readPopulation`
 * reads `dailyMarks` by `{tradingDay, supersededBy}` and `ruleStates` by
 * `{tradingDay}`; `recordComparison` reads `reconciliations` by
 * `{accountId, tradingDay}`. A fourth shape is a caller this adapter has not
 * met, and it stops here rather than reaching the accessor with a column
 * dropped.
 */
export const RECON_READ_FILTERS: Readonly<Record<ReconReadTable, readonly string[]>> = {
  dailyMarks: ['tradingDay', 'supersededBy'],
  ruleStates: ['tradingDay'],
  reconciliations: ['accountId', 'tradingDay'],
};

/**
 * The address every write table is written by. ONE COLUMN AND IT IS THE PRIMARY
 * KEY, on all three.
 *
 * `sweep.ts` states why for `reconciliations`, having executed the refusal it is
 * avoiding: `reconciliations_account_day_uq` is a `CREATE UNIQUE INDEX`, which
 * `uniqueKeys` in `packages/db/src/scoped-db.ts` does not read, so the natural
 * key is not an address the accessor accepts. `reconciliation_runs` and
 * `accounts` are addressed by `id` for the ordinary reason.
 */
export const RECON_WRITE_ADDRESS = 'id' as const;

/** Every column of a filter that is not in `allowed`, in the order they appear. */
function unexpectedColumns(where: ReconFilter, allowed: readonly string[]): readonly string[] {
  return Object.keys(where).filter((column) => !allowed.includes(column));
}

/**
 * Refuse a filter that names a column this adapter does not translate.
 *
 * **IT IS A THROW AND NEVER A DROP**, header section 3. It also refuses a
 * MISSING column, because a filter short of one narrows less than the caller
 * asked for and the accessor cannot tell the difference: `{tradingDay}` on
 * `dailyMarks` is a syntactically perfect read of every superseded correction
 * ever written.
 */
function requireExactColumns(key: string, where: ReconFilter, allowed: readonly string[]): void {
  const extra = unexpectedColumns(where, allowed);
  if (extra.length > 0) {
    throw new ReconAdapterError(
      key,
      `the filter names ${extra.join(', ')}, which this adapter does not translate. It narrows ` +
        `${key} by ${allowed.join(', ')} and by nothing else, and passing a column on without ` +
        'translating it is how a read reaches the accessor with the narrowing removed',
    );
  }
  const missing = allowed.filter((column) => !Object.hasOwn(where, column));
  if (missing.length > 0) {
    throw new ReconAdapterError(
      key,
      `the filter does not name ${missing.join(', ')}. A read short of a narrowing returns MORE ` +
        'rows than the caller asked for, and every one of them looks like a row it wanted',
    );
  }
}

/** One filter value, refused when it is absent rather than passed as `undefined`. */
function filterValue(key: string, where: ReconFilter, column: string): unknown {
  const value = where[column];
  if (value === undefined) {
    throw new ReconAdapterError(
      key,
      `${column} is undefined. The accessor renders an equality against it and an equality ` +
        'against a value nobody supplied is a predicate nobody wrote',
    );
  }
  return value;
}

// -----------------------------------------------------------------------------
// The one term, narrowed rather than cast
// -----------------------------------------------------------------------------

/**
 * `ADR-157`'s `IS NULL`, minted by `packages/db` and narrowed to the one member
 * this port declares.
 *
 * **`isNull()` RETURNS THE WHOLE `FilterTerm` UNION AND `ReconFilterTerm` IS ONE
 * MEMBER OF IT, SO SOMETHING HAS TO NARROW.** The choices are a cast and a
 * check, and this is a check: the discriminant is read, a term that is not
 * `is-null` is a THROW, and `tsc` narrows the union on the same line. A cast
 * would have compiled identically today and would have quietly become an
 * `at-most` with an undefined bound on the day somebody reordered that
 * vocabulary.
 *
 * **THE TERM ITSELF IS PASSED THROUGH UNTOUCHED, WHICH IS `src/db.ts`'s OWN
 * RULE AND IS WHY THIS IS A GUARD RATHER THAN A WRAPPER.** `packages/db` keeps a
 * module-private `WeakSet` of the terms it minted and `isFilterTerm` reads
 * IDENTITY rather than shape, so a function here that rebuilt the object, spread
 * it or froze a copy would hand back something the accessor refuses, and the
 * refusal would arrive at the first live scan. The value returned below is the
 * one `packages/db` minted, and nothing is done to it but read one field.
 *
 * **AND IT IS MINTED PER CALL AND NEVER CACHED**, for the same reason: a shared
 * constant would work right up until somebody exported it, which is `isNull`'s
 * own docstring stating the rule from the other side.
 */
function reconIsNull(): ReconFilterTerm {
  const term = isNull();
  if (term.term !== 'is-null') {
    throw new ReconAdapterError(
      'dailyMarks',
      `the accessor's isNull() minted a ${term.term} term. "live" is ` +
        "`daily_marks_live_per_account_day_uq`'s `WHERE superseded_by IS NULL` and nothing " +
        'else, so a different term here would silently redefine which mark the sweep compares',
    );
  }
  return term;
}

/** The `ReconTerms` this deployment supplies. One member, and it is the whole of "live". */
export const RECON_TERMS: ReconTerms = { isNull: reconIsNull };

// -----------------------------------------------------------------------------
// One open transaction, translated
// -----------------------------------------------------------------------------

/**
 * A `ReconTx` over one open `SystemTx`.
 *
 * EVERY COLUMN LITERAL IN THIS FILE IS IN THIS FUNCTION, which is what makes the
 * translation reviewable: a reader checking that this adapter narrows what
 * `sweep.ts` asked it to narrow reads one screen.
 */
export function reconTxOver(tx: ReconDbTx): ReconTx {
  return {
    async rowsWhere(key: ReconReadTable, where: ReconFilter): Promise<unknown[]> {
      requireExactColumns(key, where, RECON_READ_FILTERS[key]);
      switch (key) {
        case 'dailyMarks': {
          const tradingDay = filterValue(key, where, 'tradingDay');
          const supersededBy = filterValue(key, where, 'supersededBy');
          return await tx.rowsWhere('dailyMarks', { tradingDay, supersededBy });
        }
        case 'ruleStates': {
          const tradingDay = filterValue(key, where, 'tradingDay');
          return await tx.rowsWhere('ruleStates', { tradingDay });
        }
        case 'reconciliations': {
          const accountId = filterValue(key, where, 'accountId');
          const tradingDay = filterValue(key, where, 'tradingDay');
          return await tx.rowsWhere('reconciliations', { accountId, tradingDay });
        }
      }
    },

    async insert(key: ReconWriteTable, values: ReconValues): Promise<unknown[]> {
      switch (key) {
        case 'reconciliationRuns':
          return await tx.insert('reconciliationRuns', values);
        case 'reconciliations':
          return await tx.insert('reconciliations', values);
        // Header section 4. The port's union allows it, the sweep never asks for
        // it, and an adapter that served it would let a reconciliation bring an
        // account into existence.
        case 'accounts':
          throw new ReconAdapterError(
            key,
            'a reconciliation sweep never creates an account. `accounts` is in the write union ' +
              "because `0014_marks.sql` makes the BLOCK a mismatch's consequence, which is an " +
              'UPDATE of one boolean on a row somebody else provisioned',
          );
      }
    },

    async updateAt(key: ReconWriteTable, at: ReconFilter, values: ReconValues): Promise<unknown[]> {
      requireExactColumns(key, at, [RECON_WRITE_ADDRESS]);
      const id = filterValue(key, at, RECON_WRITE_ADDRESS);
      switch (key) {
        case 'reconciliations': {
          // `reconciliations.id` is `bigint GENERATED ALWAYS AS IDENTITY` and the
          // Drizzle declaration pins `{ mode: 'bigint' }`. A `number` here has
          // been through a lossy conversion somewhere above, and `sweep.ts`
          // refuses one at the row boundary for the same reason.
          if (typeof id !== 'bigint') {
            throw new ReconAdapterError(
              key,
              `the address names an id of type ${typeof id} and reconciliations.id is bigint ` +
                'GENERATED ALWAYS AS IDENTITY',
            );
          }
          return await tx.updateAt('reconciliations', { id }, values);
        }
        case 'reconciliationRuns': {
          if (typeof id !== 'string') {
            throw new ReconAdapterError(
              key,
              `the address names an id of type ${typeof id} and reconciliation_runs.id is a uuid`,
            );
          }
          return await tx.updateAt('reconciliationRuns', { id }, values);
        }
        case 'accounts': {
          if (typeof id !== 'string') {
            throw new ReconAdapterError(
              key,
              `the address names an id of type ${typeof id} and accounts.id is a uuid`,
            );
          }
          return await tx.updateAt('accounts', { id }, values);
        }
      }
    },
  };
}

/**
 * The `ReconSweepIo` this deployment runs the reconciliation sweep against.
 *
 * **TWO ARGUMENTS AND THE SECOND ONE IS THE CLOCK.** `job.ts` states the rule
 * this follows: "THE CLOCK IS AN ARGUMENT AND NOT A CALL, so a suite runs the
 * job at a fixed instant and a deployment passes `Date`." It has no default,
 * because `reconciliation_runs.started_at` and `finished_at` are what an
 * operator reads to tell a run that crashed from a run that never started, and
 * a clock a caller did not choose is a clock nobody can fix a fixture against.
 *
 * ONE DOOR ARGUMENT, so a suite substitutes a recorder and a deployment passes
 * `LIVE_DB`. `src/db.ts`'s own seam, and the reason it gave for being an
 * interface rather than a free function.
 *
 * **IT OPENS NOTHING WHEN IT IS CALLED.** `LIVE_DB.batch` calls `systemDb` and
 * `transaction` when it is INVOKED, so constructing this value connects to no
 * database and needs no `DATABASE_URL`, which is what lets the suite below run
 * in `ci.yml`'s `integration` job.
 */
export function postgresReconSweepIo(db: WorkerDb, now: () => Date): ReconSweepIo {
  return {
    // ONE TRANSACTION PER CALL AND MANY CALLS PER SWEEP, which `ports.ts` argues
    // at length: `OVERVIEW` section 5.2 requires the batch to be resumable at
    // the account boundary, and one transaction around the whole sweep would
    // also make `0064`'s `'running'` state unreachable.
    transact<T>(fn: (tx: ReconTx) => Promise<T>): Promise<T> {
      return db.batch((tx) => fn(reconTxOver(tx)));
    },
    terms: RECON_TERMS,
    now,
  };
}
