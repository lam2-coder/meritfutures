// =============================================================================
// apps/api/src/admin-source/index.ts
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
// every composed name is one of its six, and that the composed object's own keys
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
//      module's tables.
//   2. its method name in {@link IMPLEMENTED_ADMIN_READS}.
//   3. its one arm in the object {@link composeAdminReadSource} returns.
//
// Nothing else moves. Adding 2 without 3, or 3 without 2, does not compile.
//
// -----------------------------------------------------------------------------
// THIS COMPOSES A PARTIAL PORT AND SAYS SO, WHICH IS WHY NOTHING WIRES IT
// -----------------------------------------------------------------------------
// `AdminReadSource` has six methods. This directory implements TWO. There is
// therefore no value in this tree that satisfies the port, `start.ts` calls no
// setter, and `setAdminReadSource` stays in `test/wiring.test.ts`'s `BLOCKED`
// list with the triple unchanged.
//
// **THAT ENTRY'S STATED REASON IS NARROWED BY THIS SLICE AND IS NOT RETIRED BY
// IT, AND THE DIFFERENCE MATTERS.** The reason reads: "A READ SHAPE, and the door
// second ... None of the six methods is a projection of one table ... A live
// adapter today would have to reach `sqlExecutor`". For `listFlags` and
// `readIdentityGraph` that is now MEASURED FALSE: both are keyed reads plus
// ordinary code, neither reaches the executor, and `flags.ts` and `graph.ts` are
// the demonstration. For `readLiability` it still stands in full, and the
// remaining three are unwritten. **The entry is `wiring.test.ts`'s, session 316
// holds that file this wave, and this slice reports the narrowing rather than
// editing it.**
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

import { readFlagQueue } from './flags.ts';
import { DEFAULT_GRAPH_LIMITS, readIdentityGraph } from './graph.ts';
import type { FlagsTx } from './flags.ts';
import type { GraphLimits, GraphTx } from './graph.ts';
import type { AdminReadSource } from '../routes/admin-reads.ts';

/**
 * The handle every module in this directory reads through.
 *
 * AN INTERSECTION AND NOT A SUPERSET, so each module still declares the tables
 * it touches and no module can reach a table it did not name. `SystemTx`
 * satisfies it structurally, and because every arm of the intersection is
 * read-only, so is this.
 */
export type AdminSourceTx = FlagsTx & GraphTx;

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
export const IMPLEMENTED_ADMIN_READS = ['listFlags', 'readIdentityGraph'] as const;

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
export function composeAdminReadSource(
  backend: AdminSourceBackend,
  options: AdminSourceOptions = {},
): PartialAdminReadSource {
  const graphLimits = options.graphLimits ?? DEFAULT_GRAPH_LIMITS;
  return {
    listFlags: async (query) => (await backend.operator((tx) => readFlagQueue(tx, query))).page,
    readIdentityGraph: async (identityId) =>
      (await backend.operator((tx) => readIdentityGraph(tx, identityId, graphLimits)))?.graph ??
      null,
  };
}
