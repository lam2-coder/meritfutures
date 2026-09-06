// =============================================================================
// apps/worker/test/digest-alarm-adapter.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/digests/alarm-adapter.ts`. ADR-353.
//
// **THIS IS THE FIRST ADAPTER SUITE IN THIS DEPLOYABLE WITH NO FAKE IN IT.**
// `expiry-adapter.test.ts` leaves one, the event sink, "because that is the only
// port this deployable has no way to supply"; `detector-adapter.test.ts` leaves
// the same one refusing. `DigestAlarmIo` has three members and this deployable
// holds all three, so section 1 asserts THAT rather than asserting a refusal,
// and it derives the member list from the port's own unwired inhabitant so a
// fourth member arriving is a red case here rather than a silent omission.
//
// -----------------------------------------------------------------------------
// THE THREE THINGS AN ASSIGNMENT SUITE COULD MISS, AND EACH HAS A SECTION
// -----------------------------------------------------------------------------
//   1. `terms` HANDS BACK A MINTED TERM AND NOT A SHAPED ONE. `packages/db`
//      keeps a `WeakSet` of every term `mintTerm` built and `isFilterTerm` reads
//      IDENTITY, so a hand-rolled `{ term: 'at-least', value }` type-checks
//      everywhere above the accessor and is refused at the scan. Section 2 runs
//      the real predicate over what the real port returns, and seeds the
//      lookalike to watch the predicate refuse it.
//
//   2. `read` HANDS THE ALARM A HANDLE IT CANNOT WRITE THROUGH, AND "CANNOT" IS
//      ABOUT THE VALUE AND NOT ONLY ABOUT THE TYPE. Section 3 counts the keys on
//      the object the callback receives, because `ports.ts` section 3's claim
//      that `SystemTx` satisfies `DigestReadTx` structurally is TRUE and would
//      have made a pass-through compile, leaving `insert` on the object the
//      alarm holds. A type assertion cannot see that. This can.
//
//   3. ONE TRANSACTION FOR THE WHOLE EVALUATION. A report folded across two
//      could call a window undelivered that a delivery committed between them.
//      Section 3 counts the doors opened rather than trusting `alarm.ts`'s loop.
//
// -----------------------------------------------------------------------------
// SECTION 5 IS THE RULING AND IT IS THE REASON THIS FILE IS LONGER THAN THE
// ADAPTER IT VALIDATES
// -----------------------------------------------------------------------------
// The adapter makes the job RUNNABLE. Section 5 measures what a run would find
// and what a finding would reach, and both are the ADR's clock argument
// expressed as cases rather than as prose:
//
//   - **NOTHING IN THIS REPOSITORY EVER WRITES A `report_schedules` ROW.** Case
//     5.3 sweeps every `src/` tree, every migration and every seed for one, and
//     finds two readers and no writer.
//   - So case 5.2 runs the REAL `findUndeliveredWindows` through the REAL
//     adapter over an empty store and pins the result: zero schedules
//     evaluated, no findings, `undeliveredWindows: 0`. **THAT IS A GREEN NUMBER
//     COMPUTED OVER AN EMPTY SUBJECT SET**, and `M06` section 3.6 calls
//     `admin.report_windows_undelivered` "zero, always". A clock in front of
//     this today publishes that zero and it means nothing.
//   - Case 5.4 keeps the caller census honest, which is what
//     `test/schedule.test.ts` case 3.1 derives every disposition from.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE CANNOT SEE, STATED RATHER THAN LEFT TO A READER
// -----------------------------------------------------------------------------
// Whether Postgres accepts the read, and whether the composed predicate reaches
// one row or many. Both are `packages/db`'s and are asserted in
// `packages/db/test/keyed-accessor.test.ts`; a case here that claimed either
// would be agreeing with its own recorder. `src/db.ts`'s own header states the
// same division for the same seam.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isFilterTerm } from '@merit/db';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import type { WorkerDb } from '../src/db.ts';
import {
  DIGEST_ALARM_TERMS,
  digestAlarmReadTx,
  postgresDigestAlarmIo,
  postgresDigestAlarmRead,
} from '../src/digests/alarm-adapter.ts';
import { findUndeliveredWindows } from '../src/digests/alarm.ts';
import { UNWIRED_DIGEST_ALARM_IO } from '../src/digests/ports.ts';
import type { DigestFilter, DigestReadTable, DigestReadTx } from '../src/digests/ports.ts';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

/** Every `.ts` file under one `src` tree, absolute. */
function walkSrc(base: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.ts'))
      found.push(join(entry.parentPath, entry.name));
  return found;
}

const ADAPTER_SOURCE = readFileSync(join(REPO, 'apps/worker/src/digests/alarm-adapter.ts'), 'utf8');

// -----------------------------------------------------------------------------
// The store, and the recorder that stands in for the one door
// -----------------------------------------------------------------------------
// TRANSCRIBED FROM `digests.test.ts` RATHER THAN IMPORTED, on `expiry-adapter`'s
// own reason for not importing its neighbour's harness: a fixture shared between
// two suites that assert different properties is a fixture one of them will
// eventually be edited for.

const NOW = new Date('2026-08-28T12:00:00.000Z');

interface Store {
  reportSchedules: Record<string, unknown>[];
  reportDeliveries: Record<string, unknown>[];
}

function emptyStore(): Store {
  return { reportSchedules: [], reportDeliveries: [] };
}

function schedule(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sched-loss',
    digest: 'weekly_loss_ratio_cusum',
    cadence: 'weekly',
    format: 'csv',
    channel: 'email',
    recipients: ['risk@merit.example'],
    enabled: true,
    createdBy: 'founder',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

function delivery(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scheduleId: 'sched-loss',
    dueAt: new Date('2026-08-24T00:00:00.000Z'),
    attempt: 1,
    coversThroughTradingDay: '2026-08-21',
    channel: 'email',
    format: 'csv',
    recipientsAttempted: ['risk@merit.example'],
    recipientsOmitted: [],
    omissionReason: null,
    outcome: 'failed',
    failureReason: 'smtp refused',
    attemptedAt: new Date('2026-08-24T00:05:00.000Z'),
    deliveredAt: null,
    artifactDigest: null,
    createdAt: new Date('2026-08-24T00:05:01.000Z'),
    ...over,
  };
}

/**
 * One read the recorder saw, so a case can assert what crossed the boundary.
 *
 * THE FILTER IS KEPT BY REFERENCE and not copied, because case 2.3 asserts that
 * the object the alarm put on `dueAt` is the object `packages/db` MINTED, and a
 * copy would pass a shape check and fail `isFilterTerm`.
 */
interface SeenRead {
  readonly key: DigestReadTable;
  readonly where: DigestFilter;
}

/** A term as the accessor mints one, interpreted by the recorder. */
function matches(row: Record<string, unknown>, where: DigestFilter): boolean {
  return Object.entries(where).every(([column, expected]) => {
    const actual = row[column];
    if (isFilterTerm(expected)) {
      if (expected.term !== 'at-least') return false;
      if (!(actual instanceof Date) || !(expected.value instanceof Date)) return false;
      return actual.getTime() >= expected.value.getTime();
    }
    if (actual instanceof Date && expected instanceof Date)
      return actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

/**
 * The one door, as a recorder.
 *
 * **IT PUBLISHES EVERY METHOD `SystemTx` PUBLISHES AND NOT ONLY THE ONE THE
 * ALARM NEEDS.** That is the whole point of section 3: if the adapter passed
 * this object through, `insert` would be sitting on the value the alarm holds,
 * and only a key count can see it.
 */
function recordingDb(store: Store): {
  readonly db: WorkerDb;
  readonly opened: unknown[];
  readonly reads: SeenRead[];
} {
  const opened: unknown[] = [];
  const reads: SeenRead[] = [];
  const db: WorkerDb = {
    batch<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const tx = {
        rows: () => Promise.resolve([]),
        rowsWhere: (key: DigestReadTable, where: DigestFilter) => {
          reads.push({ key, where });
          return Promise.resolve(store[key].filter((row) => matches(row, where)));
        },
        insert: () => Promise.resolve([]),
        rowAt: () => Promise.resolve(null),
        lockAt: () => Promise.resolve(null),
        updateAt: () => Promise.resolve([]),
        deleteAt: () => Promise.resolve([]),
        sqlExecutor: () => undefined,
      };
      opened.push(tx);
      return fn(tx as never);
    },
  };
  return { db, opened, reads };
}

// =============================================================================
// 1. Every member is served, and the count is derived from the port
// =============================================================================

describe('1. the whole port, with nothing refusing', () => {
  it('1.1 serves every member the port declares, derived from the port and not typed here', () => {
    // THE MEMBER LIST COMES FROM `UNWIRED_DIGEST_ALARM_IO` rather than from a
    // literal in this file, so a fourth member added to `DigestAlarmIo` fails
    // HERE and not at a deployment. The unwired value is the port's only other
    // inhabitant and it is obliged to answer for every member.
    const declared = Object.keys(UNWIRED_DIGEST_ALARM_IO).sort();
    expect(declared).toEqual(['now', 'read', 'terms']);
    const io = postgresDigestAlarmIo(recordingDb(emptyStore()).db);
    expect(Object.keys(io).sort()).toEqual(declared);
  });

  it('1.2 no member of the built value refuses, which the unwired one does for all three', async () => {
    // THE CONTRAST IS THE ASSERTION. Every member of the unwired value raises
    // `DigestUnwired`; not one member of this one does. `expiry-adapter.ts` and
    // `detectors/adapter.ts` each keep a member that still refuses, and this row
    // is the first with none, so the claim is made mechanically.
    const io = postgresDigestAlarmIo(recordingDb(emptyStore()).db);
    expect(() => io.now()).not.toThrow();
    expect(() => io.terms.atLeast(NOW)).not.toThrow();
    await expect(io.read(() => Promise.resolve('served'))).resolves.toBe('served');

    expect(() => UNWIRED_DIGEST_ALARM_IO.now()).toThrow();
    expect(() => UNWIRED_DIGEST_ALARM_IO.terms.atLeast(NOW)).toThrow();
    await expect(UNWIRED_DIGEST_ALARM_IO.read(() => Promise.resolve(1))).rejects.toThrow();
  });

  it('1.3 the factory takes ONE required argument, because no capability is missing', () => {
    // `expirySweepIo` takes TWO and the second has no default, which is ADR-344
    // making an absent sink a call that does not compile. There is nothing to do
    // that with here: `length` counts parameters before the first default, and
    // the clock is defaulted because a process clock is a thing this deployable
    // has.
    expect(postgresDigestAlarmIo.length).toBe(1);
  });

  it('1.4 the clock defaults to the process clock and a caller may pin it', () => {
    const { db } = recordingDb(emptyStore());
    const before = Date.now();
    const defaulted = postgresDigestAlarmIo(db).now().getTime();
    expect(defaulted).toBeGreaterThanOrEqual(before);
    expect(defaulted).toBeLessThanOrEqual(Date.now());
    expect(postgresDigestAlarmIo(db, () => NOW).now()).toBe(NOW);
  });
});

// =============================================================================
// 2. The term is MINTED and not shaped
// =============================================================================

describe('2. the one term', () => {
  it('2.1 declares exactly `atLeast`, which is the one term this slice uses', () => {
    expect(Object.keys(DIGEST_ALARM_TERMS)).toEqual(['atLeast']);
  });

  it('2.2 hands back a term the accessor recognises, and a lookalike is refused', () => {
    const minted = DIGEST_ALARM_TERMS.atLeast(NOW);
    expect(isFilterTerm(minted)).toBe(true);
    // THE SEEDED LOOKALIKE. Identical shape, refused, because `isFilterTerm`
    // reads a `WeakSet` of what `mintTerm` built. An adapter that wrapped,
    // spread or froze the returned object would pass a shape assertion here and
    // fail at the first live scan.
    expect(isFilterTerm({ ...(minted as object) })).toBe(false);
    expect(isFilterTerm({ term: 'at-least', value: NOW })).toBe(false);
  });

  it('2.3 the minted object itself reaches the door, unwrapped', async () => {
    const store = emptyStore();
    store.reportSchedules.push(schedule());
    const { db, reads } = recordingDb(store);
    const since = new Date('2026-08-01T00:00:00.000Z');
    await findUndeliveredWindows(
      postgresDigestAlarmIo(db, () => NOW),
      { historySince: since },
    );
    const delivered = reads.find((read) => read.key === 'reportDeliveries');
    expect(delivered).toBeDefined();
    expect(isFilterTerm(delivered?.where['dueAt'])).toBe(true);
  });
});

// =============================================================================
// 3. The handle is NARROWED, and that is about the value
// =============================================================================

describe('3. the read handle', () => {
  it('3.1 the alarm receives one method and not seven, so `insert` is not on the value', async () => {
    // **THE CASE THE TYPE SYSTEM CANNOT BUY.** `ports.ts` section 3 says
    // `SystemTx` satisfies `DigestReadTx` structurally, and it does: a
    // pass-through compiles. It also hands the alarm an object still carrying
    // `insert`, `updateAt`, `deleteAt` and `sqlExecutor`, and `alarm.ts` builds
    // its whole construction on the alarm being unable to discharge the window
    // it is complaining about.
    const { db } = recordingDb(emptyStore());
    let seen: DigestReadTx | null = null;
    await postgresDigestAlarmRead(db)((tx) => {
      seen = tx;
      return Promise.resolve(null);
    });
    const keys = Object.keys(seen ?? {});
    expect(keys).toEqual(['rowsWhere']);
    expect(seen).not.toHaveProperty('insert');
    expect(seen).not.toHaveProperty('updateAt');
    expect(seen).not.toHaveProperty('deleteAt');
    expect(seen).not.toHaveProperty('sqlExecutor');
  });

  it('3.2 the key and the filter cross unchanged', async () => {
    const store = emptyStore();
    const { db, reads } = recordingDb(store);
    const where = { enabled: true };
    await postgresDigestAlarmRead(db)((tx) => tx.rowsWhere('reportSchedules', where));
    expect(reads).toHaveLength(1);
    expect(reads[0]?.key).toBe('reportSchedules');
    expect(reads[0]?.where).toBe(where);
  });

  it('3.3 ONE transaction for the whole evaluation, however many schedules there are', async () => {
    const store = emptyStore();
    store.reportSchedules.push(
      schedule(),
      schedule({ id: 'sched-flags', digest: 'weekly_flag_queue' }),
    );
    const { db, opened } = recordingDb(store);
    await findUndeliveredWindows(postgresDigestAlarmIo(db, () => NOW));
    expect(opened).toHaveLength(1);
  });

  it('3.4 `digestAlarmReadTx` narrows any transaction it is given, and not only the door one', () => {
    // The narrowing is a function rather than a line inside the factory, so it
    // can be asserted on its own and reused by a caller that already holds a
    // transaction.
    const carrier = { rowsWhere: () => Promise.resolve([]), insert: () => Promise.resolve([]) };
    expect(Object.keys(digestAlarmReadTx(carrier as never))).toEqual(['rowsWhere']);
  });
});

// =============================================================================
// 4. The real run, through the real adapter
// =============================================================================

describe('4. end to end', () => {
  it('4.1 a closed window with no delivered row is found', async () => {
    const store = emptyStore();
    store.reportSchedules.push(schedule());
    store.reportDeliveries.push(delivery());
    const { db } = recordingDb(store);
    const report = await findUndeliveredWindows(postgresDigestAlarmIo(db, () => NOW));
    expect(report.evaluatedAt).toBe(NOW);
    expect(report.schedulesEvaluated).toBe(1);
    expect(report.findings.map((finding) => finding.kind)).toContain('window_not_delivered');
    expect(report.undeliveredWindows).toBeGreaterThan(0);
    expect(report.deliveriesFailed).toBe(1);
  });

  it('4.2 a delivered window is not a finding', async () => {
    const store = emptyStore();
    store.reportSchedules.push(schedule());
    store.reportDeliveries.push(delivery({ outcome: 'delivered', deliveredAt: NOW }));
    const { db } = recordingDb(store);
    const report = await findUndeliveredWindows(postgresDigestAlarmIo(db, () => NOW));
    expect(report.findings.map((finding) => finding.kind)).not.toContain('window_not_delivered');
    expect(report.deliveriesFailed).toBe(0);
  });

  it('4.3 the schedule filter reaches the door as `enabled: true`', async () => {
    const store = emptyStore();
    store.reportSchedules.push(schedule(), schedule({ id: 'sched-off', enabled: false }));
    const { db, reads } = recordingDb(store);
    const report = await findUndeliveredWindows(postgresDigestAlarmIo(db, () => NOW));
    expect(reads[0]).toEqual({ key: 'reportSchedules', where: { enabled: true } });
    expect(report.schedulesEvaluated).toBe(1);
  });
});

// =============================================================================
// 5. What the job would find today, and what a finding would reach
// =============================================================================

describe('5. the disposition, measured rather than asserted', () => {
  it('5.1 nothing under any src/ tree in this workspace ever writes a report_schedules row', () => {
    // **THE MEASUREMENT THE CLOCK RULING RESTS ON.** Two readers, no writer, in
    // code or in SQL or in a seed. `INSERT` is searched in the migrations and
    // the Drizzle key in the TypeScript, because a writer could be either.
    const writers: string[] = [];
    for (const base of [
      join(REPO, 'apps/worker/src'),
      join(REPO, 'apps/api/src'),
      join(REPO, 'packages/db/src'),
    ])
      for (const file of walkSrc(base)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        if (/\.insert\(\s*'reportSchedules'/.test(code)) writers.push(file);
      }
    expect(writers).toEqual([]);

    const sql = readdirSync(join(REPO, 'packages/db/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .filter((name) =>
        /insert\s+into\s+report_schedules/i.test(
          readFileSync(join(REPO, 'packages/db/migrations', name), 'utf8'),
        ),
      );
    expect(sql).toEqual([]);
  });

  it('5.2 so a run over the estate as merged is green over an EMPTY subject set', async () => {
    // `M06` section 3.6: `admin.report_windows_undelivered` is "zero, always,
    // and is computed from the table rather than from the job's report". It is
    // zero here because there is nothing to compute it over, and no field of
    // this report distinguishes that from a estate where every digest arrived.
    // **`schedulesEvaluated` IS THE FIELD THAT WOULD**, and it is the reason a
    // clock in front of this today publishes a number that means nothing.
    const { db } = recordingDb(emptyStore());
    const report = await findUndeliveredWindows(postgresDigestAlarmIo(db, () => NOW));
    expect(report.schedulesEvaluated).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.undeliveredWindows).toBe(0);
    expect(report.deliveriesFailed).toBe(0);
  });

  it('5.3 nothing under apps/worker/src calls the job or builds the io, so the census is honest', () => {
    // `test/schedule.test.ts` case 3.1 derives every disposition from a caller
    // census over this tree, so the registry cannot claim a disposition the tree
    // contradicts. This case is the same measurement taken from the adapter's
    // side: the file that makes the job RUNNABLE must not be the file that makes
    // it RUN.
    //
    // COUNTED WITH COMMENTS STRIPPED AND THE DECLARATION SUBTRACTED, which is
    // `schedule.test.ts` case 3.1's own arithmetic and its reason: this
    // repository's headers quote these names constantly, and each name is
    // declared exactly once, whose `name(` reads as a call to a counter.
    const bodies = walkSrc(join(REPO, 'apps/worker/src')).map((file) =>
      stripComments(readFileSync(file, 'utf8')),
    );
    const callsBeyondTheDeclaration = (name: string): number => {
      let total = 0;
      for (const body of bodies)
        total += [...body.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length;
      return total - 1;
    };
    expect(callsBeyondTheDeclaration('findUndeliveredWindows')).toBe(0);
    expect(callsBeyondTheDeclaration('postgresDigestAlarmIo')).toBe(0);
  });

  it('5.4 the adapter names no package and casts past no key type', () => {
    const code = stripComments(ADAPTER_SOURCE);
    expect(code).not.toContain("from 'pg'");
    expect(code).not.toContain("from '@merit/db'");
    expect(code).not.toContain('SqlExecutorReason');
    expect(code).not.toContain('sqlExecutor');
    expect(code).not.toContain('SystemReason');
    // NO `as never` AND NO `as unknown`. `detectors/adapter.ts` calls its cast
    // "THE ONE CAST IN THIS DEPLOYABLE PAST A KEY TYPE"; this file has none,
    // because `DigestReadTable` and `DigestFilter` cross into `SystemTx.rowsWhere`
    // as written and a bogus member of `DIGEST_READ_TABLES` is a compile error
    // at the call rather than a run-time surprise.
    expect(code).not.toContain('as never');
    expect(code).not.toContain('as unknown');
  });
});
