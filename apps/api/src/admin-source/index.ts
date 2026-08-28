// =============================================================================
// apps/api/src/admin-source/index.ts
// =============================================================================
// =============================================================================
// TWO SESSIONS BUILT TWO DEFENCES FOR THIS FILE AND BOTH ARE KEPT
// =============================================================================
// `P7-i` (session 318) and `P7-j` (session 319) each wrote this file, alone,
// against the same hazard: a keep-both merge of a composition list that
// TYPE-CHECKS while dropping a method. That hazard is not hypothetical here. It
// happened in `apps/worker/src/index.ts` on 2026-08-28 and `pnpm run typecheck`
// passed over it, because a type checker cannot see an export that is gone.
//
// THEY REACHED DIFFERENT ANSWERS AND THE MERGE KEEPS BOTH, because they fail at
// different times and neither subsumes the other:
//
//   COMPILE TIME (318). `IMPLEMENTED_ADMIN_READS` is DATA and
//   `PartialAdminReadSource` is a `Pick` over it. Drop a method from the object
//   and the `Pick` has a member the literal does not; drop a name from the array
//   and the literal has one the `Pick` does not. Neither half can be lost
//   quietly and neither can be added alone.
//
//   RUN TIME (319). `AdminReadParts` is a `Partial` and `composeAdminReadSource`
//   fills every gap with `AdminSourceNotComposed`, which NAMES THE METHOD. A
//   deployment missing a leg answers "no module supplies `listFlags`" at the
//   first request rather than returning nothing.
//
// 318's header argues against 319's shape in terms, and THE ARGUMENT IS CORRECT
// AND IS NOT AN OBJECTION TO KEEPING IT: "`Partial<AdminReadSource>` would type
// an object that implements NONE of them, so a composition file emptied by a
// merge would still compile". It would. That is exactly why the `Pick` half is
// kept alongside it rather than replaced by it. The `Partial` half earns its
// place separately, by producing a WHOLE `AdminReadSource` a wiring slice can
// hold, which the `Pick` cannot until all seven methods exist.
//
// SO THE TWO FUNCTIONS HAVE DIFFERENT NAMES AND DIFFERENT JOBS.
// `composeImplementedAdminReads` composes the backend-read methods this
// directory implements under the compile-time guarantee. `composeAdminReadSource` assembles whatever parts a
// deployment has into the full port. A deployment uses both.
//
// THE RENAME IS THE ONLY BEHAVIOURAL EDIT IN THIS RESOLUTION. Both sides shipped
// a `composeAdminReadSource` with incompatible signatures and both suites bind
// the name; 318's is renamed because 319's produces the port's own type and
// should keep the port's own name.
//
// WHOEVER RESOLVES A CONFLICT HERE KEEPS BOTH AND RE-READS THE FILE AFTERWARDS.
// A green typecheck is not evidence in this file.
// =============================================================================

// THE COMPOSITION, AND IT IS A SEPARATE FILE FOR ONE REASON THAT IS WRITTEN DOWN.
//
// P7 section 9, the `admin-source/index.ts` row: "`AdminReadSource` has six
// methods and three slices in two phases implement different ones; each writes
// its own module and only the composition is shared. SERIAL on the index and
// concurrent on everything else, which is ADR-100's division reached by hand
// because the worker has no registry to inherit it from."
//
// So `flags.ts`, `graph.ts` and whatever `P7-j` and `P5-l` write are DISJOINT
// FILES that never meet, and this file is the one place two sessions collide. It
// is written to make that collision cost one line each.
//
// -----------------------------------------------------------------------------
// A KEEP-BOTH MERGE OF A COMPOSITION FILE SILENTLY DROPPED BOTH SIDES ONCE, AND
// `pnpm run typecheck` PASSED OVER IT
// -----------------------------------------------------------------------------
// It happened in `apps/worker/src/index.ts`, and P7 section 5.5 names the hazard
// in advance: a re-export list resolves cleanly, reads plausibly, and a type
// checker CANNOT SEE AN EXPORT THAT IS SIMPLY GONE, because nothing downstream
// asks for it by name.
//
// **THIS FILE IS BUILT SO THAT A DROPPED LEG IS A COMPILE ERROR**, which is the
// only form of that warning worth writing twice:
//
//   {@link IMPLEMENTED_ADMIN_READS} names the methods as DATA and the return type
//   is `Pick<AdminReadSource, ...>` over it. Drop a method from the object and
//   the `Pick` has a member the literal does not: a missing-property error naming
//   the method. Drop a name from the array and the literal has a member the
//   `Pick` does not: an excess-property error naming the method. **Neither half
//   can be lost quietly and neither can be added alone.**
//
// `test/admin-source-flags.test.ts` closes the runtime half: it reads
// `AdminReadSource`'s declaration out of `routes/admin-reads.ts` and asserts that
// every composed name is one of its seven, and that the composed object's own
// keys
// are exactly {@link IMPLEMENTED_ADMIN_READS}. A type is checked at build and a
// key set is checked at run, and the merge that dropped a leg has to get past
// both.
//
// -----------------------------------------------------------------------------
// WHAT A SECOND SLICE ADDS HERE, SO IT DOES NOT HAVE TO BE INFERRED
// -----------------------------------------------------------------------------
// Three lines, all of them appends to sorted lists:
//
//   1. `& EvidenceTx` on {@link AdminSourceTx}, so the handle carries that
//      module's tables. `& EventsTx` is that line, written by session 356.
//   2. its method name in {@link IMPLEMENTED_ADMIN_READS}.
//   3. its one arm in the object {@link composeAdminReadSource} returns.
//
// Nothing else moves. Adding 2 without 3, or 3 without 2, does not compile.
//
// -----------------------------------------------------------------------------
// THIS COMPOSES A PARTIAL PORT AND SAYS SO, WHICH IS WHY NOTHING WIRES IT
// -----------------------------------------------------------------------------
// `AdminReadSource` has SEVEN methods since ADR-184 ruling 1 and this directory
// implements the ones {@link IMPLEMENTED_ADMIN_READS} names, WHICH IS WHY NO
// NUMERAL APPEARS IN THIS SENTENCE. It carried one, it went stale every time a
// slice landed, and two concurrent slices bumping the same word is a merge
// conflict over a count the array beside it already states as data. There is still no value in this tree
// that satisfies the port, `start.ts` calls no setter, and `setAdminReadSource`
// stays in `test/wiring.test.ts`'s `BLOCKED` list with the triple unchanged.
//
// **A METHOD IS NOT A PORT, WHICH IS WHY THE TRIPLE DOES NOT MOVE.**
// `wiring.test.ts` counts `^export function (use|set)X(` in `src/routes/`, and
// ADR-184 ruling 1 puts the feed's read on the port that already has a setter
// rather than on one of its own. `{ declared: 23, wired: 6, blocked: 17 }` is
// unchanged and was re-run rather than predicted.
//
// **THAT ENTRY'S STATED REASON IS NARROWED BY THIS SLICE AND IS NOT RETIRED BY
// IT, AND THE DIFFERENCE MATTERS.** The reason reads: "A READ SHAPE, and the door
// second ... None of the six methods is a projection of one table ... A live
// adapter today would have to reach `sqlExecutor`". For `listFlags`,
// `readIdentityGraph` and now `listEvents` that is MEASURED FALSE: all three are
// keyed reads plus ordinary code, none reaches the executor, and `flags.ts`,
// `graph.ts` and `events.ts` are the demonstration. For `readLiability` it still
// stands in full. **The entry is `wiring.test.ts`'s, and this directory reports
// the narrowing rather than editing it.**
//
// **AND `readLiability` IS NOW MEASURED RATHER THAN ASSERTED, AND THE ENTRY'S
// REASON IS MEASURED FALSE FOR IT TOO.** `liability.ts` produces **27 of
// `LiabilityResponse`'s 40 leaf paths** from live rows, through the same keyed
// accessor, with no join, no aggregate and no `sqlExecutor`: eight `TableKey`s,
// two whole-table folds where the accessor offers no `ORDER BY`, and two typed
// equalities. So "a live adapter today would have to reach `sqlExecutor`" is
// false for a FOURTH method and the entry is `wiring.test.ts`'s to repair.
//
// **THE METHOD IS STILL NOT COMPOSED AND THE REASON IS FOUR BLOCKERS, NONE OF
// THEM A COLUMN.** `eligible_next_7d` needs `trading_calendar`, which is not a
// `TableKey`; `payout_velocity` needs a 30-day window no document states;
// `per_plan[].cusum` is ruled ABSENT by ADR-167 clause 5 until `DEP-M6-05`, and
// the wire has no absent form for it; `integrations.recon.last_run_at` names a
// reconciliation RUN nothing in this schema records.
// `test/admin-source-liability.test.ts` holds each with its own clearing
// condition and `test/admin-source-liability-book.test.ts` checks the
// subtraction against API_CONTRACT, so the day one lifts a case goes red and
// names it. **None of the four is this fence's to clear**, so the composition
// below is unchanged: a method that cannot fill 13 of its own paths would answer
// a 500 where it answers a named, synchronous "this deployment is not finished".
//
// **`listEvents` IS THE THIRD INSTANCE AND IT IS NOW WRITTEN RATHER THAN ONLY
// PREDICTED.** ADR-184 section 3 measured it as a keyed range read over ONE
// table, sessions 349 and 353 measured that the table was not a `TableKey`, and
// ADR-191 registered it. `events.ts` is that prediction executed.
// That entry now says `six` where the port declares seven, and BOTH halves of it
// are the wiring slice's to repair, not this one's: the triple does not move,
// so `test/wiring.test.ts` is outside this fence and reporting is the whole of
// what the precedent allows.
//
// -----------------------------------------------------------------------------
// THE DOOR IS A PORT AND NOT A CALL, AND THAT IS `src/db.ts`'s RULING NOT THIS
// FILE'S
// -----------------------------------------------------------------------------
// `ApiDb` declares `scoped` and `firm` and NO `system`, and its header states
// that the absence is the point. ADR-171 measured whether to open the operator
// door and refused on the measurement. So {@link AdminSourceBackend} is a
// PARAMETER: this directory names the unit of work it needs and a deployment
// that has a door hands one in, which is `routes/admin-writes.ts`'s
// `AdminWriteBackend.operator` shape exactly and is adopted rather than invented.
//
// `src/db.ts` is not edited and no `@merit/db` import is added anywhere under
// `admin-source/`. `test/db.test.ts` pins which file may take a value off the
// accessor and this directory takes none.
// =============================================================================

import { readAccountDetail } from './account.ts';
import { readEventFeed } from './events.ts';
import { readFlagQueue } from './flags.ts';
import { DEFAULT_GRAPH_LIMITS, readIdentityGraph } from './graph.ts';
import { readAccountSearch } from './search.ts';
import type { AccountTx } from './account.ts';
import type { EventsTx } from './events.ts';
import type { FlagsTx } from './flags.ts';
import type { GraphLimits, GraphTx } from './graph.ts';
import type { SearchTx } from './search.ts';
import type { AdminReadSource } from '../routes/admin-reads.ts';

/**
 * The handle every module in this directory reads through.
 *
 * AN INTERSECTION AND NOT A SUPERSET, so each module still declares the tables
 * it touches and no module can reach a table it did not name. `SystemTx`
 * satisfies it structurally, and because every arm of the intersection is
 * read-only, so is this.
 */
export type AdminSourceTx = AccountTx & EventsTx & FlagsTx & GraphTx & SearchTx;

/**
 * The unit of work this directory cannot open for itself.
 *
 * ONE METHOD, TAKING THE WHOLE UNIT rather than handing back a handle, which is
 * `ApiDb`'s shape and for `ApiDb`'s reason: a transaction cannot outlive the
 * function that opened it and no caller has a `commit` to forget.
 *
 * `systemDb('operator-console')` is the authority behind it, ADR-102 accepted
 * that reason for "the admin liability dashboard" by name, and the argument for
 * why an admin read cannot be `scopedDb` or `firmDb` is `routes/admin-reads.ts`'s
 * and is not restated here.
 */
export interface AdminSourceBackend {
  operator<T>(fn: (tx: AdminSourceTx) => Promise<T>): Promise<T>;
}

/** What a deployment may tune without a deploy of this directory. */
export interface AdminSourceOptions {
  /** See {@link GraphLimits}: no corpus number rules these. */
  readonly graphLimits?: GraphLimits;
}

/**
 * The methods this directory implements, as data.
 *
 * SORTED, AND APPEND-ONLY. See the header: this array and the object below are
 * two halves of one declaration and the type checker refuses either alone.
 */
export const IMPLEMENTED_ADMIN_READS = [
  'listEvents',
  'listFlags',
  'readAccount',
  'readIdentityGraph',
  'searchAccounts',
] as const;

/** One of {@link IMPLEMENTED_ADMIN_READS}. */
export type ImplementedAdminRead = (typeof IMPLEMENTED_ADMIN_READS)[number];

/**
 * The part of `AdminReadSource` this directory can satisfy today.
 *
 * A `Pick` RATHER THAN A `Partial`. `Partial<AdminReadSource>` would type an
 * object that implements NONE of them, so a composition file emptied by a merge
 * would still compile, which is the exact failure this file is shaped against.
 */
export type PartialAdminReadSource = Pick<AdminReadSource, ImplementedAdminRead>;

/**
 * Compose the reads this directory implements against one door.
 *
 * EACH ARM OPENS ITS OWN UNIT OF WORK. A single transaction spanning both would
 * be a read consistency this port does not promise and a lock held across two
 * unrelated screens, and `ApiDb`'s shape gives no way to hand one out anyway.
 *
 * THE COST OBJECTS ARE DROPPED HERE AND THAT IS DELIBERATE. `readFlagQueue` and
 * `readIdentityGraph` each measure what they read, the port's signatures are the
 * contract's and have nowhere to carry it, and a measurement the suite asserts on
 * is worth more than one only a log carries.
 */
export function composeImplementedAdminReads(
  backend: AdminSourceBackend,
  options: AdminSourceOptions = {},
): PartialAdminReadSource {
  const graphLimits = options.graphLimits ?? DEFAULT_GRAPH_LIMITS;
  return {
    listEvents: async (query) => (await backend.operator((tx) => readEventFeed(tx, query))).page,
    listFlags: async (query) => (await backend.operator((tx) => readFlagQueue(tx, query))).page,
    readAccount: async (accountId) =>
      (await backend.operator((tx) => readAccountDetail(tx, accountId)))?.detail ?? null,
    readIdentityGraph: async (identityId) =>
      (await backend.operator((tx) => readIdentityGraph(tx, identityId, graphLimits)))?.graph ??
      null,
    searchAccounts: async (query) =>
      (await backend.operator((tx) => readAccountSearch(tx, query))).page,
  };
}

// THE COMPOSITION, AND IT IS A SEPARATE FILE FOR EXACTLY ONE REASON.
//
// `AdminReadSource` (`routes/admin-reads.ts`) declares SEVEN methods and three
// slices in two phases implement different ones: `P7-i` takes `listFlags` and
// `readIdentityGraph`, `P7-j` takes `exportEvidence`, and `P5-l` takes
// `readLiability`. P7 section 9 rows the division as **SERIAL on the index and
// concurrent on everything else**, which is `ADR-100`'s answer reached by hand,
// because each method's real work lives in its own module and only the assembly
// is shared.
//
// -----------------------------------------------------------------------------
// A KEEP-BOTH MERGE OF THIS FILE TYPE-CHECKS WHILE DROPPING A METHOD
// -----------------------------------------------------------------------------
// P7 section 5.5 names the hazard on the worker's barrel and it is the same
// hazard here: a re-export or a composition list resolved by taking one side
// reads as a clean resolution, compiles, and loses a leg, because A TYPE CHECKER
// CANNOT SEE AN EXPORT THAT IS SIMPLY GONE. It happened in this repository, in
// `apps/worker/src/index.ts`, and it passed `pnpm run typecheck`.
//
// SO THE UNIMPLEMENTED METHODS THROW WITH THEIR OWN NAME IN THE MESSAGE rather
// than being absent. A method that was composed and then lost in a merge answers
// "no module supplies `listFlags`" at the first request, which is the loud
// version of the failure; a method that was never composed answers the same
// thing and nothing pretends otherwise. `AdminReadError`'s own no-source message
// makes the same choice one level up.
//
// **WHOEVER RESOLVES A CONFLICT IN THIS FILE KEEPS BOTH KEYS AND RE-READS THE
// FILE AFTERWARDS.** A green typecheck is not evidence here.
// =============================================================================

import { createEvidenceExporter } from './evidence.ts';
import type { EvidenceExporterDeps } from './evidence.ts';

/** A method the deployment has not composed yet. */
export class AdminSourceNotComposed extends Error {
  constructor(method: string) {
    super(
      `no module supplies \`AdminReadSource.${method}\`, so this read has no rows to return. ` +
        'This is a deployment which has not been finished rather than a request that failed: ' +
        'the module lives beside this file and the composition is one key in `composeAdminReadSource`',
    );
    this.name = 'AdminSourceNotComposed';
  }
}

/**
 * The methods a deployment has modules for. One key per slice.
 *
 * PARTIAL BY DESIGN AND NOT BY OVERSIGHT. Three slices in two phases land these
 * at different times, and a required shape would mean the first one to land
 * either waits for the other two or writes stubs for methods it does not own.
 */
export type AdminReadParts = Partial<AdminReadSource>;

/** Fill the gaps with a refusal that names the method. */
export function composeAdminReadSource(parts: AdminReadParts): AdminReadSource {
  return {
    searchAccounts: (query) => {
      if (parts.searchAccounts === undefined) throw new AdminSourceNotComposed('searchAccounts');
      return parts.searchAccounts(query);
    },
    readAccount: (accountId) => {
      if (parts.readAccount === undefined) throw new AdminSourceNotComposed('readAccount');
      return parts.readAccount(accountId);
    },
    readIdentityGraph: (identityId) => {
      if (parts.readIdentityGraph === undefined)
        throw new AdminSourceNotComposed('readIdentityGraph');
      return parts.readIdentityGraph(identityId);
    },
    listFlags: (query) => {
      if (parts.listFlags === undefined) throw new AdminSourceNotComposed('listFlags');
      return parts.listFlags(query);
    },
    readLiability: () => {
      if (parts.readLiability === undefined) throw new AdminSourceNotComposed('readLiability');
      return parts.readLiability();
    },
    exportEvidence: (request) => {
      if (parts.exportEvidence === undefined) throw new AdminSourceNotComposed('exportEvidence');
      return parts.exportEvidence(request);
    },
    listEvents: (query) => {
      if (parts.listEvents === undefined) throw new AdminSourceNotComposed('listEvents');
      return parts.listEvents(query);
    },
  };
}

/**
 * `P7-j`'s composition. ONE KEY, and the module beside it does the work.
 *
 * A LATER SLICE ADDS ITS KEY HERE AND CHANGES NOTHING ELSE.
 */
export function adminReadSourceParts(deps: {
  readonly evidence: EvidenceExporterDeps;
}): AdminReadParts {
  return {
    exportEvidence: createEvidenceExporter(deps.evidence).exportEvidence,
  };
}
