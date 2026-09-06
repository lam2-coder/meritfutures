// =============================================================================
// apps/worker/test/expiry-adapter.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/sweeps/expiry-adapter.ts`. ADR-344.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS "THE ADAPTER IS FIVE
// ASSIGNMENTS AND THERE IS NOTHING IN IT TO GET WRONG".** Four of the five are
// exactly that and the suite still checks them, because each one is a line a
// merge can drop silently. The two that are NOT assignments are where the money
// is:
//
//   1. `terms` HANDS BACK A MINTED TERM AND NOT A SHAPED ONE. `packages/db`
//      keeps a `WeakSet` of every term `mintTerm` built and `isFilterTerm` reads
//      IDENTITY, so a hand-rolled `{ term: 'at-most', value }` type-checks
//      everywhere above the accessor and is refused at the scan. An adapter that
//      wrapped, spread or froze the returned object would pass a shape
//      assertion and fail in production. Section 2 runs the real predicate over
//      what the real port returns, and seeds the lookalike to watch the
//      predicate refuse it.
//
//   2. `transact` HANDS THE SWEEP THE HANDLE IT RECORDED. `postLt01` recovers
//      its `LedgerTx` by the identity of the `ExpiryTx` it is given (ADR-315),
//      so a wiring that recorded a different object, or recorded nothing, is a
//      release that rolls back at the posting. Section 3 asserts identity rather
//      than the fact of a call.
//
// -----------------------------------------------------------------------------
// EVERY PORT THIS DEPLOYABLE CAN SERVE IS REAL IN SECTION 4, AND THE ONE FAKE IS
// THE ONE PORT IT CANNOT
// -----------------------------------------------------------------------------
// `sweep-ledger.test.ts` builds "the wiring slice 9 will write, minus everything
// that is not this row's", with the real `EXPIRY_LEDGER` and hand-rolled `terms`
// and `events`. This file is that harness with the ACTUAL adapter in the middle:
// the io under test is `expirySweepIo(...)`, its `terms` are the accessor's own
// constructors, its `ledger` is `EXPIRY_LEDGER`, its `transact` is
// `WorkerDb.batch`, and the ONLY fake is the event sink, because that is the
// only port this deployable has no way to supply.
//
// **THAT ASYMMETRY IS THE FINDING AND SECTION 5 ASSERTS IT MECHANICALLY** rather
// than leaving it to a header: the factory's arity says the sink has no default,
// and a census over `src/` says nothing constructs the io, which is why
// `runExpirySweep` is still `unscheduled` in `schedule.ts`.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE CANNOT SEE, STATED RATHER THAN LEFT TO A READER
// -----------------------------------------------------------------------------
// Whether Postgres accepts the rows, and whether the composed predicate reaches
// one row or many. Both are `packages/db`'s and are asserted in
// `packages/db/test/keyed-accessor.test.ts`; a case here that claimed either
// would be agreeing with its own fake. `src/db.ts`'s own header states the same
// division for the same seam.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isFilterTerm } from '@merit/db';
import type { LedgerReadKey, LedgerTx, LedgerWriteKey, WriteValues } from '@merit/ledger';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import type { WorkerDb } from '../src/db.ts';
import { EXPIRY_TERMS, expirySweepIo } from '../src/sweeps/expiry-adapter.ts';
import {
  HELD,
  HOLD_COLUMNS,
  expirySweepClean,
  releaseLedgerKey,
  runExpirySweep,
} from '../src/sweeps/expiry.ts';
import { EXPIRY_LEDGER } from '../src/sweeps/ledger.ts';
import { UNWIRED_EXPIRY_SWEEP_IO } from '../src/sweeps/ports.ts';
import type {
  ExpiryEvent,
  ExpiryEventPort,
  ExpiryFilter,
  ExpiryFilterTerm,
  ExpiryTable,
  ExpiryTx,
  ExpiryValues,
} from '../src/sweeps/ports.ts';

/** Every `.ts` file under `apps/worker/src`, absolute. */
function walkSrc(): readonly string[] {
  const base = fileURLToPath(new URL('../src', import.meta.url));
  const found: string[] = [];
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.ts'))
      found.push(join(entry.parentPath, entry.name));
  return found;
}

// -----------------------------------------------------------------------------
// The fixture: one identity's three accounts and one held request past its clock
// -----------------------------------------------------------------------------
// TRANSCRIBED FROM `sweep-ledger.test.ts` RATHER THAN IMPORTED, on that file's
// own reason for not importing `packages/ledger/test/recording-tx.ts`: a shared
// harness between two suites that assert different properties is a harness one
// of them will eventually be edited for. The figures are `M01` Appendix A.1's
// 50K column and they are integer cents as `bigint`, which is what the sweep
// refuses a `number` in place of.

const IDENTITY = '33333333-3333-4333-8333-333333333333';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';

const account = (
  id: string,
  code: string,
  scope: 'firm' | 'identity',
  identityId: string | null = null,
): Record<string, unknown> => ({ id, code, scope, identityId, createdAt: new Date(0) });

const CHART: readonly Record<string, unknown>[] = [
  account('aaaaaaaa-0000-4000-8000-000000000001', 'trader_withdrawable', 'identity', IDENTITY),
  account('aaaaaaaa-0000-4000-8000-000000000002', 'trader_wallet', 'identity', IDENTITY),
  account('aaaaaaaa-0000-4000-8000-000000000003', 'fees_revenue', 'firm'),
];

const PAST = new Date('2026-08-31T00:00:00.000Z');
const NOW = new Date('2026-09-01T00:00:00.000Z');

type Row = Record<string, unknown>;

function heldRow(overrides: Row = {}): Row {
  return {
    id: REQUEST,
    accountId: ACCOUNT,
    identityId: IDENTITY,
    idempotencyKey: 'trader-key-01',
    status: HELD,
    approvedCents: 150_000n,
    traderCents: 135_000n,
    firmCents: 15_000n,
    heldAt: new Date('2026-08-25T12:00:00.000Z'),
    holdFlagId: '44444444-4444-4444-8444-444444444444',
    holdExpiresAt: PAST,
    holdTosClause: '13',
    holdReason: 'severity 4 flag open at request time',
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// The recorder the door hands out
// -----------------------------------------------------------------------------

interface Written {
  readonly what: 'insert' | 'update';
  readonly key: string;
  readonly values: WriteValues;
}

/**
 * One open transaction, recording rather than writing.
 *
 * IT IMPLEMENTS `LedgerTx` AND `ExpiryTx` AT ONCE, which is the property
 * `SystemTx` has and the reason the adapter's one line works: the door hands out
 * a handle that satisfies both, so the object the release is written through and
 * the object the posting is written through are the same object.
 *
 * **IT KEEPS THE FILTERS IT WAS GIVEN, WHICH IS WHAT LETS SECTION 4 CHECK THE
 * TERMS AT THE SCAN RATHER THAN AT THE PORT.** A term that reached this recorder
 * shaped rather than minted would still filter correctly here, because this fake
 * reads shape; only `isFilterTerm` can tell, and section 2 is where it is run.
 */
class RecordingTx implements LedgerTx, ExpiryTx {
  readonly written: Written[] = [];
  readonly scanned: { key: ExpiryTable; where: ExpiryFilter }[] = [];

  private nextId = 1;

  constructor(private readonly store: Map<ExpiryTable, Map<string, Row>>) {}

  rows(key: LedgerReadKey): Promise<unknown[]> {
    return Promise.resolve(key === 'ledgerAccounts' ? [...CHART] : []);
  }

  insert(key: LedgerWriteKey, values: WriteValues): Promise<unknown[]> {
    this.written.push({ what: 'insert', key, values });
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    return Promise.resolve([{ ...values, id }]);
  }

  rowsWhere(key: ExpiryTable, where: ExpiryFilter): Promise<unknown[]> {
    this.scanned.push({ key, where });
    return Promise.resolve([...(this.store.get(key) ?? new Map()).values()].filter(matches(where)));
  }

  lockAt(key: ExpiryTable, at: ExpiryFilter): Promise<unknown> {
    return Promise.resolve(
      [...(this.store.get(key) ?? new Map()).values()].find(matches(at)) ?? null,
    );
  }

  updateAt(key: ExpiryTable, at: ExpiryFilter, values: ExpiryValues): Promise<unknown[]> {
    this.written.push({ what: 'update', key, values });
    const table = this.store.get(key) ?? new Map<string, Row>();
    const found = [...table.values()].filter(matches(at));
    for (const row of found) table.set(row['id'] as string, { ...row, ...values });
    return Promise.resolve(found);
  }
}

const matches =
  (where: ExpiryFilter) =>
  (row: Row): boolean =>
    Object.entries(where).every(([property, expected]) => {
      const actual = row[property];
      if (typeof expected === 'object' && expected !== null && 'term' in expected) {
        const term = expected as ExpiryFilterTerm;
        if (term.term === 'is-null') return actual === null || actual === undefined;
        if (!(actual instanceof Date) || !(term.value instanceof Date)) return false;
        return term.term === 'at-most'
          ? actual.getTime() <= term.value.getTime()
          : actual.getTime() >= term.value.getTime();
      }
      return actual === expected;
    });

/**
 * The one door, substituted.
 *
 * **THE SEAM `src/db.ts` EXISTS FOR, USED FOR THE THING IT WAS DECLARED FOR.**
 * `transaction()` opens a real pool and `client()` throws with no
 * `DATABASE_URL`, and `ci.yml`'s jobs run on bare `ubuntu-latest` with no
 * services block, so the adapter is driven end to end here with no database at
 * all. A NEW handle per `batch` call, because the sweep opens one transaction
 * for the scan and one PER ROW for the releases, and a shared handle would make
 * section 3's identity assertion vacuous.
 */
function recordingDb(store: Map<ExpiryTable, Map<string, Row>>): {
  readonly db: WorkerDb;
  readonly opened: RecordingTx[];
} {
  const opened: RecordingTx[] = [];
  const db: WorkerDb = {
    batch<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const tx = new RecordingTx(store);
      opened.push(tx);
      return fn(tx as never);
    },
  };
  return { db, opened };
}

/** The one fake left, and the one port this deployable cannot serve. */
function recordingSink(): { readonly events: ExpiryEventPort; readonly emitted: ExpiryEvent[] } {
  const emitted: ExpiryEvent[] = [];
  return {
    events: {
      emit: (_tx, event) => {
        emitted.push(event);
        return Promise.resolve();
      },
    },
    emitted,
  };
}

function storeWith(payoutRequests: readonly Row[]): Map<ExpiryTable, Map<string, Row>> {
  return new Map<ExpiryTable, Map<string, Row>>([
    ['payoutRequests', new Map(payoutRequests.map((row) => [row['id'] as string, { ...row }]))],
    ['walletWithdrawals', new Map<string, Row>()],
  ]);
}

// =============================================================================
// 1. The five ports, and which of them the caller has to bring
// =============================================================================

describe('1. the io is the port and nothing more, and the sink is the caller`s', () => {
  it('carries exactly the five members `ExpirySweepIo` declares', () => {
    const io = expirySweepIo(recordingDb(storeWith([])).db, recordingSink().events);

    // AN EXACT SET AND NOT A `toContain` SWEEP. A sixth member is a capability
    // the port did not ask for arriving at the job through the wiring, which is
    // the direction `EXPIRY_TABLES`'s narrow union and `ExpiryTx`'s three
    // members were both written against.
    expect(Object.keys(io).sort()).toEqual(['events', 'ledger', 'now', 'terms', 'transact']);
  });

  it('takes the sink as a REQUIRED argument and the clock as a defaulted one', () => {
    // `Function.length` COUNTS DECLARED PARAMETERS BEFORE THE FIRST DEFAULT, so
    // this is the mechanical statement of the header's ruling: `db` and `events`
    // are required and `now` is not. **A DEFAULT ON `events` WOULD MAKE THIS
    // ONE**, and a refusing default is exactly what was refused: every leg of
    // this sweep emits inside its own release transaction, so a live io over a
    // rejecting sink is an hourly job that releases nothing while an S1
    // dead-man switch watching for the job's ABSENCE reports it present.
    expect(expirySweepIo.length).toBe(2);
  });

  it('passes the caller`s sink through by identity and substitutes nothing for it', () => {
    const { events } = recordingSink();
    expect(expirySweepIo(recordingDb(storeWith([])).db, events).events).toBe(events);
  });

  it('defaults `now` to a live clock and lets a fixture pin it', () => {
    const { db } = recordingDb(storeWith([]));
    const before = Date.now();
    const defaulted = expirySweepIo(db, recordingSink().events).now();
    expect(defaulted.getTime()).toBeGreaterThanOrEqual(before);
    expect(defaulted.getTime()).toBeLessThanOrEqual(Date.now());

    // ADR-157's bound is the sweep's own instant and never the database's, and
    // this is what makes every expiry case above writable.
    expect(expirySweepIo(db, recordingSink().events, () => NOW).now()).toBe(NOW);
  });

  it('serves the ledger port that already existed rather than composing a second one', () => {
    // `sweeps/ledger.ts` IS THIS DEPLOYABLE'S ONE `@merit/ledger` DOOR and the
    // adapter reaches it by name. A second `ExpiryLedgerPort` composed here
    // would be a second file naming the posting library, which
    // `apps/api/test/ledger-posting-authority.test.ts` asserts against.
    expect(expirySweepIo(recordingDb(storeWith([])).db, recordingSink().events).ledger).toBe(
      EXPIRY_LEDGER,
    );
  });
});

// =============================================================================
// 2. The terms are MINTED, which a shape assertion cannot tell
// =============================================================================

describe('2. `terms` hands back what the accessor minted and not what looks like it', () => {
  it('mints an `at-most` bound the accessor`s own predicate accepts', () => {
    const term = EXPIRY_TERMS.atMost(NOW);

    // THE REAL PREDICATE OVER THE REAL PORT. `isFilterTerm` reads a
    // module-scoped `WeakSet` in `packages/db`, so this passes only if the value
    // came out of `mintTerm` and reached here untouched.
    expect(isFilterTerm(term)).toBe(true);
    expect(term).toEqual({ term: 'at-most', value: NOW });
  });

  it('mints an `is-null` the same predicate accepts', () => {
    const term = EXPIRY_TERMS.isNull();
    expect(isFilterTerm(term)).toBe(true);
    expect(term).toEqual({ term: 'is-null' });
  });

  it('REFUSES a hand-rolled lookalike, which is why the adapter may not wrap', () => {
    // **THE SEEDED VIOLATION.** This is the value an adapter that rebuilt, spread
    // or froze the minted object would hand the accessor. It satisfies
    // `ExpiryFilterTerm` at the type level, it satisfies this suite's own `matches`
    // helper, and the accessor refuses it. A shape assertion cannot tell the two
    // apart and that is the whole reason `src/db.ts` re-exports rather than wraps.
    const shaped: ExpiryFilterTerm = { term: 'at-most', value: NOW };
    expect(isFilterTerm(shaped)).toBe(false);
    expect(isFilterTerm({ ...EXPIRY_TERMS.atMost(NOW) })).toBe(false);
  });

  it('offers `atMost` and `isNull` and no third narrowing', () => {
    // ADR-157 REFUSES `isNotNull` BY NAME and `atLeast` has no caller in this
    // deployable. A third name arriving here is a decision somebody takes in
    // `src/db.ts`, and this is what makes it visible.
    expect(Object.keys(EXPIRY_TERMS).sort()).toEqual(['atMost', 'isNull']);
  });
});

// =============================================================================
// 3. `transact` hands the sweep the handle the door opened, recorded
// =============================================================================

describe('3. the handle the sweep writes through is the handle the ledger recognises', () => {
  it('gives the callback the door`s own transaction, by identity', async () => {
    const { db, opened } = recordingDb(storeWith([]));
    const io = expirySweepIo(db, recordingSink().events, () => NOW);

    let handed: ExpiryTx | undefined;
    await io.transact((tx) => {
      handed = tx;
      return Promise.resolve(null);
    });

    expect(opened).toHaveLength(1);
    // NOT `toEqual`. `recordExpiryTransaction` returns its own argument, and a
    // wiring that recorded a copy, a proxy or a wrapper would satisfy structural
    // equality and break `postLt01`, whose lookup is a `WeakMap` on identity.
    expect(handed).toBe(opened[0]);
  });

  it('records it, so the REAL `postLt01` accepts it rather than refusing', async () => {
    const { db } = recordingDb(storeWith([]));
    const io = expirySweepIo(db, recordingSink().events, () => NOW);

    // THE POSITIVE OF `sweep-ledger.test.ts`'s REFUSAL. That suite proves an
    // unrecorded handle is refused; this proves the adapter's one line is what
    // makes the recorded case reachable at all, using the real `EXPIRY_LEDGER`
    // and the real `lt01`.
    await expect(
      io.transact((tx) =>
        io.ledger.postLt01(tx, {
          identityId: IDENTITY,
          payoutRequestId: REQUEST,
          idempotencyKey: releaseLedgerKey('trader-key-01'),
          approvedCents: 150_000n,
          traderCents: 135_000n,
          firmCents: 15_000n,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('opens one transaction per unit of work and never reuses one', async () => {
    // `FM-M5-13` TAKEN SERIOUSLY. One transaction spanning the estate makes one
    // bad row stall every other row, which is the failure the job exists
    // against arriving through the job itself.
    const { db, opened } = recordingDb(storeWith([]));
    const io = expirySweepIo(db, recordingSink().events, () => NOW);
    await io.transact(() => Promise.resolve(null));
    await io.transact(() => Promise.resolve(null));
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
  });
});

// =============================================================================
// 4. The whole sweep, through the real adapter, with one fake in it
// =============================================================================

describe('4. the sweep runs against the door, and the only fake is the sink', () => {
  it('releases a hold past its clock, blanks all five columns and posts LT-01', async () => {
    const store = storeWith([heldRow()]);
    const { db, opened } = recordingDb(store);
    const { events, emitted } = recordingSink();

    const report = await runExpirySweep(expirySweepIo(db, events, () => NOW));

    expect(report.sweptAt).toBe(NOW.toISOString());
    expect(expirySweepClean(report)).toBe(true);
    expect(report.outcomes).toEqual([
      { clock: 'payout_requests.hold_expires_at', subjectId: REQUEST, disposition: 'released' },
    ]);

    // THE FIVE NULLS, READ OFF THE WRITE THE ADAPTER CARRIED. The biconditional
    // `payout_requests_hold_is_complete` makes an omission a `23514` from
    // Postgres, so the assertion is the whole `SET` clause and not a sample.
    const updates = opened.flatMap((tx) => tx.written).filter((w) => w.what === 'update');
    expect(updates).toHaveLength(1);
    const set = updates[0]?.values as Record<string, unknown>;
    expect(set['status']).toBe('approved');
    for (const column of HOLD_COLUMNS) expect(set[column]).toBeNull();

    // THE POSTING, THROUGH THE REAL LIBRARY. One header and four entries, which
    // is two transfers and not three legs (ADR-104 ruling 1).
    const inserts = opened.flatMap((tx) => tx.written).filter((w) => w.what === 'insert');
    expect(inserts.map((w) => w.key)).toEqual([
      'ledgerTransactions',
      'ledgerEntries',
      'ledgerEntries',
      'ledgerEntries',
      'ledgerEntries',
    ]);

    // THE KEY IS THE REQUEST'S OWN, UNDER `payouts.ts`'s PREFIX, so `LT-01` for
    // one payout request is ONE posting whichever door reaches it and the second
    // is refused by the database rather than by application memory.
    expect((inserts[0]?.values as Record<string, unknown>)['idempotencyKey']).toBe(
      releaseLedgerKey('trader-key-01'),
    );

    expect(emitted.map((event) => event.name)).toEqual(['payout.hold_released']);
    expect(emitted[0]?.payload['released_by']).toBe('expiry');
  });

  it('leaves a hold inside its clock alone, and the terms are what decide that', async () => {
    const store = storeWith([heldRow({ holdExpiresAt: new Date('2026-09-02T00:00:00.000Z') })]);
    const { db, opened } = recordingDb(store);
    const { events, emitted } = recordingSink();

    const report = await runExpirySweep(expirySweepIo(db, events, () => NOW));

    expect(report.outcomes).toEqual([]);
    expect(emitted).toEqual([]);
    expect(opened.flatMap((tx) => tx.written)).toEqual([]);
  });

  it('scans both tables with MINTED terms on the columns the job named', async () => {
    const { db, opened } = recordingDb(storeWith([heldRow()]));
    const scan = opened;
    await runExpirySweep(expirySweepIo(db, recordingSink().events, () => NOW));

    // THE SCAN IS THE FIRST TRANSACTION, and every read in it is one of the
    // three the job declares. `EXPIRY_TABLES` is two members and the freeze leg
    // shares `payoutRequests` with the hold leg.
    const reads = scan[0]?.scanned ?? [];
    expect(reads.map((read) => read.key)).toEqual([
      'payoutRequests',
      'walletWithdrawals',
      'payoutRequests',
    ]);

    // **EVERY TERM THAT REACHED THE ACCESSOR CAME OUT OF `mintTerm`.** This is
    // the property that makes the adapter usable against a real database, and it
    // is asserted at the SCAN rather than at the port, because the port is where
    // it is easy and the scan is where it matters.
    const terms = reads.flatMap((read) =>
      Object.values(read.where).filter(
        (value) => typeof value === 'object' && value !== null && 'term' in value,
      ),
    );
    expect(terms).toHaveLength(4);
    for (const term of terms) expect(isFilterTerm(term)).toBe(true);

    // THE STATUS TERM IS AN EQUALITY AND THE CLOCK TERM IS A RANGE, which is the
    // one thing the sweep is responsible for getting right about ADR-157.
    expect(reads[0]?.where['status']).toBe(HELD);
    expect(isFilterTerm(reads[0]?.where['holdExpiresAt'])).toBe(true);
    expect(reads[1]?.where['settledAt']).toEqual({ term: 'is-null' });
  });

  it('carries money as `bigint` from the row to the posting, with no float in the path', async () => {
    const { db, opened } = recordingDb(storeWith([heldRow()]));
    await runExpirySweep(expirySweepIo(db, recordingSink().events, () => NOW));

    // MONEY IS INTEGER CENTS. Every entry the posting wrote carries a `bigint`
    // amount, and `centsOf` in the sweep REFUSES a `number` rather than coercing
    // it, because a `number` means the handle is not the accessor and the value
    // may already have lost digits.
    const entries = opened
      .flatMap((tx) => tx.written)
      .filter((w) => w.what === 'insert' && w.key === 'ledgerEntries');
    expect(entries).toHaveLength(4);
    for (const entry of entries)
      expect(typeof (entry.values as Record<string, unknown>)['amountCents']).toBe('bigint');
  });
});

// =============================================================================
// 5. The job is RUNNABLE and it is not RUNNING, and both halves are derived
// =============================================================================

describe('5. nothing constructs the io, which is why the row is still unscheduled', () => {
  it('no module under src calls the factory, so no deployment holds an io', () => {
    // **THE DISPOSITION IS A FACT ABOUT THE TREE AND NOT A LABEL SOMEBODY
    // TYPED**, which is `test/schedule.test.ts` case 3.1's rule applied one
    // level in: that case counts callers of the ENTRY POINT, and this counts
    // callers of the thing the entry point would need to be handed. Comments are
    // stripped, because this repository's headers name the factory constantly
    // and a docblock naming a function is not a call site.
    const callers = walkSrc().filter((path) => {
      const body = stripComments(readFileSync(path, 'utf8'));
      return (
        [...body.matchAll(/\bexpirySweepIo\s*\(/g)].length >
        (path.endsWith('expiry-adapter.ts') ? 1 : 0)
      );
    });
    expect(callers.map((path) => path.split('/').slice(-2).join('/'))).toEqual([]);
  });

  it('and the reason is a port with nothing to pass it, not a line nobody wrote', () => {
    // THE EVENT SINK, MEASURED. `apps/api/src/events.ts` is the only producer in
    // this repository and this deployable cannot name it: `test/db.test.ts`
    // section 4 pins the bare specifiers to four names and none is `@merit/api`,
    // and `test/event-sink.test.ts` section 3 refuses a relative specifier that
    // escapes the app. Neither is restated here. What IS asserted here is the
    // consequence at this file: the adapter names no sink of its own, so there
    // is no value in this module a wiring row could reach for.
    const body = stripComments(
      readFileSync(
        fileURLToPath(new URL('../src/sweeps/expiry-adapter.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(body).not.toContain('LIVE_EXPIRY_SWEEP_IO');
    expect(body).not.toContain('UNWIRED_EXPIRY_SWEEP_IO');
    // AND NO EMIT IS IMPLEMENTED HERE. An `emit` in this file would be a sink
    // this deployable invented, which is the value `ExpirySweepUnwired` says it
    // refuses to invent one level down.
    expect(body).not.toContain('emit(');
  });
});

// -----------------------------------------------------------------------------
// 6. WHAT THE ARITY PIN IS ACTUALLY THE ONLY THING HOLDING
// -----------------------------------------------------------------------------

describe('6. the sink is passable, and the pin above is what bars the default', () => {
  it('takes the refusing member of the io`s own unwired default, by type and at run time', async () => {
    // **THIS IS THE MEASUREMENT THAT RETIRES A CLAUSE FOUR REGISTERS CARRY.**
    // Those registers say that nothing in this tree can be passed for `events`,
    // and therefore that the blocker is a call which does not compile. **THE
    // SECOND HALF DOES NOT FOLLOW AND THE FIRST HALF IS FALSE**: the io's own
    // unwired default composes a refusing `ExpiryEventPort` inline, that member
    // is exported with the value that holds it, and the call below both
    // type-checks and runs. The clause is named rather than reproduced per
    // `RI-14`; ADR-382 rules on it and `test/schedule.test.ts` case `9.1` holds
    // the census half.
    //
    // **PASSING IT HERE IS NOT WIRING AND THE DISTINCTION IS THE FILE BOUNDARY.**
    // Section 5 asserts that no module under `src/` calls this factory, and this
    // is a test. What a suite can construct and what a deployment holds are two
    // different questions, and only the second one is a clock.
    const io = expirySweepIo(recordingDb(storeWith([])).db, UNWIRED_EXPIRY_SWEEP_IO.events);
    expect(io.events).toBe(UNWIRED_EXPIRY_SWEEP_IO.events);
    await expect(io.events.emit({} as ExpiryTx, {} as ExpiryEvent)).rejects.toThrow(
      'no adapter is installed',
    );
  });

  it('so what bars the default is the arity above, and NOT the port census', () => {
    // **THE GUARD IS ONE INTEGER AND SAYING SO IS THE POINT.** The cheapest
    // repair a later row could make is one line: give `events` a default built
    // from the value this file just passed, or written inline in the same shape.
    // It declares no `export const` and returns no port type, so
    // `test/schedule.test.ts`'s two censuses stay GREEN on it and the pin at the
    // top of this file is the whole of what turns red. **A BAR HELD BY ONE
    // ASSERTION IS A BAR WHOSE REASON HAD BETTER BE TRUE**, which is why the
    // reason is repaired rather than the pin widened.
    const source = stripComments(
      readFileSync(
        fileURLToPath(new URL('../src/sweeps/expiry-adapter.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(/events:\s*ExpiryEventPort\s*,/.test(source)).toBe(true);
    expect(/events:\s*ExpiryEventPort\s*=/.test(source)).toBe(false);
  });
});
