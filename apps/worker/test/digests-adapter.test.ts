// =============================================================================
// apps/worker/test/digests-adapter.test.ts
// =============================================================================
// **THE SCHEDULED DIGEST PRODUCER'S ADAPTER, AND THE TWO PORTS IT REFUSES.**
//
// `recon-adapter.test.ts` is the idiom one directory over: a recorder standing
// in for the door proves WHICH key the adapter named, WHICH columns it narrowed
// by and WHICH values it wrote, none of which a type checker can see.
//
// **WHAT IS NEW HERE IS SECTION 4, AND IT IS THE HALF WORTH READING.** This row
// serves four of six and refuses two, and a refusal recorded in prose goes stale
// silently: ADR-342 found four blockers dissolved by rows in other deployables
// with nothing noticing. So `DIGEST_TRANSPORT_BLOCKERS` and
// `DIGEST_CONTENT_BLOCKERS` are DATA and the cases below RUN each one against
// the artifact it cites. **EVERY ONE OF THEM FAILS ON GOOD NEWS**: the day a
// transport lands, the day `OQ-F3-04` is answered, the day `@merit/api` becomes
// reachable or the day a `BreakerIo` is written, this file goes RED and the
// adapter is due a re-decision rather than a paragraph nobody re-read.
//
// **SECTION 5 IS THE HAZARD PROVED RATHER THAN ASSERTED.** `adapter.ts` header
// section 3 claims that a clock in front of this value would append permanent
// `failed` rows for a transport that never existed. Case 5.1 RUNS the composed
// value through `runDigestDeliveries` and reads what lands in the write log, so
// that claim is a measurement and not a worry.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  CHANNELS,
  DIGEST_CONTENT_BLOCKERS,
  DIGEST_READ_FILTERS,
  DIGEST_READ_TABLES,
  DIGEST_TERMS,
  DIGEST_TRANSPORT_BLOCKERS,
  DIGEST_WINDOW_ANCHOR,
  DIGEST_WRITE_TABLES,
  DigestAdapterError,
  DigestRunRefusal,
  DigestUnwired,
  WORKER_JOB_ENTRY_POINTS,
  digestTxOver,
  postgresDigestIo,
  runDigestDeliveries,
  tradingDayAnchoredAt,
} from '../src/index.ts';
import type { DigestBlocker, DigestDbTx, DigestValues } from '../src/index.ts';
import { WORKER_REASON } from '../src/db.ts';
import type { WorkerDb } from '../src/db.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ADAPTER_SOURCE = readFileSync(join(ROOT, 'apps/worker/src/digests/adapter.ts'), 'utf8');

// -----------------------------------------------------------------------------
// The door, recorded
// -----------------------------------------------------------------------------

interface DoorCall {
  readonly op: 'rowsWhere' | 'insert';
  readonly key: string;
  readonly where?: Readonly<Record<string, unknown>>;
  readonly values?: Readonly<Record<string, unknown>>;
}

interface Door {
  readonly db: WorkerDb;
  readonly calls: DoorCall[];
  transactions(): number;
}

interface DoorRows {
  readonly reportSchedules?: readonly DigestValues[];
  readonly reportDeliveries?: readonly DigestValues[];
}

/**
 * A `WorkerDb` that records rather than connecting.
 *
 * THE SUBSTITUTE IS CAST TO THE HANDLE'S TYPE, which `recon-adapter.test.ts`
 * does at the same seam and for the same reason: `SystemTx` publishes eight
 * methods and this adapter reaches two, so implementing the union would be six
 * throws asserting nothing. What the cast cannot hide is which of the two was
 * called, because that is what gets recorded.
 */
function door(rows: DoorRows = {}): Door {
  const calls: DoorCall[] = [];
  let transactions = 0;

  const tx = {
    __brand: 'SystemTx',
    reason: WORKER_REASON,
    rowsWhere(key: string, where: Readonly<Record<string, unknown>>): Promise<unknown[]> {
      calls.push({ op: 'rowsWhere', key, where });
      if (key === 'reportSchedules') return Promise.resolve([...(rows.reportSchedules ?? [])]);
      return Promise.resolve([...(rows.reportDeliveries ?? [])]);
    },
    insert(key: string, values: Readonly<Record<string, unknown>>): Promise<unknown[]> {
      calls.push({ op: 'insert', key, values });
      return Promise.resolve([values]);
    },
    updateAt: (): never => {
      throw new Error('DigestTx declares no updateAt and this adapter names none');
    },
    deleteAt: (): never => {
      throw new Error('DigestTx declares no deleteAt and this adapter names none');
    },
    sqlExecutor: (): never => {
      throw new Error('no adapter in this deployable may reach for one');
    },
  };

  return {
    calls,
    transactions: () => transactions,
    db: {
      batch<T>(fn: (handle: never) => Promise<T>): Promise<T> {
        transactions += 1;
        return fn(tx as never);
      },
    },
  };
}

/** One `DigestTx` over the recorded door, for the per-call cases. */
function handleOver(rows: DoorRows = {}): { tx: ReturnType<typeof digestTxOver>; door: Door } {
  const recorded = door(rows);
  let captured: DigestDbTx | undefined;
  void recorded.db.batch(async (raw) => {
    captured = raw;
  });
  if (captured === undefined) throw new Error('the substitute door never yielded a handle');
  return { tx: digestTxOver(captured), door: recorded };
}

const DUE_AT = new Date('2026-09-01T12:00:00.000Z');
const TRADING_DAY = '2026-08-31';

/** One enabled `weekly_flag_queue` schedule, in the shape `readProducerSchedule` accepts. */
const ENABLED_SCHEDULE: DigestValues = {
  id: '11111111-1111-4111-8111-111111111111',
  digest: 'weekly_flag_queue',
  channel: 'email',
  format: 'csv',
  recipients: ['risk@merit.example'],
  enabled: true,
};

// -----------------------------------------------------------------------------
// 1. The four that are served
// -----------------------------------------------------------------------------

test('1.1 transact opens ONE transaction for the whole run and yields a translated handle', async () => {
  const recorded = door({ reportSchedules: [] });
  const io = postgresDigestIo(recorded.db, () => DUE_AT, tradingDayAnchoredAt(DUE_AT, TRADING_DAY));

  const report = await runDigestDeliveries(io, { dueAt: DUE_AT });

  // ADR-006's criterion, which `produce.ts` states: the delivery rows commit
  // together or none of them does.
  expect(recorded.transactions()).toBe(1);
  expect(report.coversThroughTradingDay).toBe(TRADING_DAY);
  expect(report.results).toEqual([]);
});

test('1.2 the schedule read is narrowed by `enabled` and reaches the key the port names', async () => {
  const { tx, door: recorded } = handleOver({ reportSchedules: [ENABLED_SCHEDULE] });

  await tx.rowsWhere('reportSchedules', { enabled: true });

  expect(recorded.calls).toEqual([
    { op: 'rowsWhere', key: 'reportSchedules', where: { enabled: true } },
  ]);
});

test('1.3 the delivery read is narrowed by BOTH columns, which is what bounds `attempt`', async () => {
  const { tx, door: recorded } = handleOver();

  await tx.rowsWhere('reportDeliveries', { scheduleId: ENABLED_SCHEDULE['id'], dueAt: DUE_AT });

  expect(recorded.calls).toEqual([
    {
      op: 'rowsWhere',
      key: 'reportDeliveries',
      where: { scheduleId: ENABLED_SCHEDULE['id'], dueAt: DUE_AT },
    },
  ]);
});

test('1.4 a filter naming a column the adapter does not translate is a THROW and never a drop', async () => {
  const { tx } = handleOver();

  await expect(
    tx.rowsWhere('reportSchedules', { enabled: true, channel: 'email' }),
  ).rejects.toBeInstanceOf(DigestAdapterError);
});

test('1.5 a filter MISSING a column is refused, because a short read is a wider read', async () => {
  // `adapter.ts`'s stated reason: `{scheduleId}` alone on `reportDeliveries` is a
  // syntactically perfect read of every window that schedule has ever had, and
  // `nextAttempt` would fold it into an ordinal over the wrong population rather
  // than failing.
  const { tx } = handleOver();

  const refused = await tx
    .rowsWhere('reportDeliveries', { scheduleId: ENABLED_SCHEDULE['id'] })
    .then(
      () => null,
      (error: unknown) => error,
    );

  expect(refused).toBeInstanceOf(DigestAdapterError);
  expect((refused as Error).message).toContain('dueAt');
});

test('1.6 the ONE write reaches `reportDeliveries` and the handle offers no other verb', async () => {
  const { tx, door: recorded } = handleOver();

  await tx.insert('reportDeliveries', { outcome: 'failed' });

  expect(recorded.calls).toEqual([
    { op: 'insert', key: 'reportDeliveries', values: { outcome: 'failed' } },
  ]);
  // `ports.ts` section 2, carried down from `0040`'s
  // `REVOKE UPDATE, DELETE ON report_deliveries`. The accessor offers both on a
  // `SystemTx`; this adapter names neither, so the file cannot grow one by
  // accident.
  expect(ADAPTER_SOURCE).not.toMatch(/tx\.updateAt\(/);
  expect(ADAPTER_SOURCE).not.toMatch(/tx\.deleteAt\(/);
});

test('1.7 `terms.atLeast` is passed through UNTOUCHED, because the accessor reads identity', () => {
  // `ADR-157` clause 2: `packages/db` keeps a module-private `WeakSet` of the
  // terms it minted and `isFilterTerm` reads IDENTITY rather than shape, so a
  // wrapped term is a term the accessor stops recognising.
  const term = DIGEST_TERMS.atLeast(DUE_AT);

  expect(term).toEqual({ term: 'at-least', value: DUE_AT });
});

// -----------------------------------------------------------------------------
// 2. The trading day, which is served by being pinned
// -----------------------------------------------------------------------------

test('2.1 the pinned day answers the instant it was resolved for', () => {
  expect(tradingDayAnchoredAt(DUE_AT, TRADING_DAY)(new Date(DUE_AT.getTime()))).toBe(TRADING_DAY);
});

test('2.2 it REFUSES any other instant rather than stamping a day nobody resolved for it', () => {
  // `report_deliveries.covers_through_trading_day` is `INV-M6-04`'s as-of
  // column. An adapter answering one day for every instant is `ADR-273` finding
  // 1's harm moved onto the digest's evidence table.
  const pinned = tradingDayAnchoredAt(DUE_AT, TRADING_DAY);

  expect(() => pinned(new Date(DUE_AT.getTime() + 1))).toThrow(DigestRunRefusal);
});

test('2.3 a run whose instant moved writes NOTHING, because the refusal is above the transaction', async () => {
  // `runDigestDeliveries` calls `tradingDayOf` before `transact`, which is
  // `job.ts`'s rule that every refusal about a run is made above the work.
  const recorded = door({ reportSchedules: [ENABLED_SCHEDULE] });
  const io = postgresDigestIo(recorded.db, () => DUE_AT, tradingDayAnchoredAt(DUE_AT, TRADING_DAY));

  await expect(
    runDigestDeliveries(io, { dueAt: new Date(DUE_AT.getTime() + 60_000) }),
  ).rejects.toBeInstanceOf(DigestRunRefusal);

  expect(recorded.transactions()).toBe(0);
  expect(recorded.calls).toEqual([]);
});

// -----------------------------------------------------------------------------
// 3. The two that refuse, and they refuse as `DigestUnwired`
// -----------------------------------------------------------------------------

test('3.1 both content reads and the transport reject with `DigestUnwired`, carrying the blocker', async () => {
  const io = postgresDigestIo(door().db, () => DUE_AT, tradingDayAnchoredAt(DUE_AT, TRADING_DAY));

  for (const call of [
    io.content.lossRatioCusum(TRADING_DAY),
    io.content.flagQueue(TRADING_DAY),
    io.transport.send({
      digest: 'weekly_flag_queue',
      channel: 'email',
      format: 'csv',
      recipients: [],
      artifact: new Uint8Array(),
    }),
  ]) {
    const error = await call.then(
      () => null,
      (raised: unknown) => raised,
    );
    expect(error).toBeInstanceOf(DigestUnwired);
    // The canonical sentence survives. A refusal that dropped it would lose the
    // reason the default refuses at all.
    expect((error as Error).message).toContain('indistinguishable');
  }
});

test('3.2 the transport refusal names BOTH channels, because they block differently', async () => {
  const io = postgresDigestIo(door().db, () => DUE_AT, tradingDayAnchoredAt(DUE_AT, TRADING_DAY));

  const error = await io.transport
    .send({
      digest: 'weekly_flag_queue',
      channel: 'sftp',
      format: 'csv',
      recipients: [],
      artifact: new Uint8Array(),
    })
    .then(
      () => null,
      (raised: unknown) => raised,
    );

  expect((error as Error).message).toContain('unreachable');
  expect((error as Error).message).toContain('unwritten');
  expect((error as Error).message).toContain('OQ-F3-04');
});

// -----------------------------------------------------------------------------
// 4. The blockers, RUN against the artifacts they cite
// -----------------------------------------------------------------------------

/** Every `.ts` under a shipped `src/`, which is the scope every census below reads. */
function shippedSources(): readonly string[] {
  const found: string[] = [];
  for (const app of ['apps', 'packages']) {
    for (const holder of readdirSync(join(ROOT, app), { withFileTypes: true })) {
      if (!holder.isDirectory()) continue;
      const src = join(ROOT, app, holder.name, 'src');
      const walk = (relative: string): void => {
        for (const entry of readdirSync(join(src, relative), { withFileTypes: true })) {
          const next = join(relative, entry.name);
          if (entry.isDirectory()) walk(next);
          else if (next.endsWith('.ts')) found.push(join(src, next));
        }
      };
      try {
        walk('.');
      } catch {
        // A package with no `src/` contributes nothing and is not an error.
      }
    }
  }
  return found;
}

test('4.1 every blocker names a `kind`, a `cite` and a `why`, and no entry is a bare sentence', () => {
  const every: readonly DigestBlocker[] = [
    ...DIGEST_TRANSPORT_BLOCKERS,
    ...DIGEST_CONTENT_BLOCKERS,
  ];

  expect(every.length).toBeGreaterThan(0);
  for (const blocker of every) {
    expect(['unwritten', 'unreachable']).toContain(blocker.kind);
    expect(blocker.cite.length).toBeGreaterThan(0);
    expect(blocker.why.length).toBeGreaterThan(0);
  }
});

test('4.2 the transport register carries one entry per CHANNEL, so a fifth channel cannot arrive unnamed', () => {
  for (const channel of CHANNELS)
    expect(
      DIGEST_TRANSPORT_BLOCKERS.some((one) => one.member.includes(`channel: ${channel}`)),
      `${channel} has no blocker entry`,
    ).toBe(true);
  expect(DIGEST_TRANSPORT_BLOCKERS).toHaveLength(CHANNELS.length);
});

test('4.3 THE TRANSPORT STILL HAS NO INHABITANT, and this case fails on good news', () => {
  // THE SHAPE AND NOT THE WORD. `DigestTransport` occurs in this workspace as
  // the declaration, as the barrel's type re-export and inside this adapter's
  // prose; what the claim is about is whether any VALUE of that type exists. So
  // the probe looks for an annotation or a satisfies clause, which is how every
  // other inhabitant in this deployable is written, and excludes the module that
  // declares the type.
  const declaring = join(ROOT, 'apps/worker/src/digests/ports.ts');
  const inhabited = shippedSources()
    .filter((file) => file !== declaring)
    .filter((file) =>
      /:\s*DigestTransport\b|satisfies\s+DigestTransport\b/.test(readFileSync(file, 'utf8')),
    );

  expect(inhabited, 'a DigestTransport now exists and the adapter is due a re-decision').toEqual(
    [],
  );
});

test('4.4 `OQ-F3-04` IS STILL OPEN, which is the sftp channel`s whole blocker', () => {
  // ADR-066 section 3 and M06 section 3.6 both carry it, and both call SFTP a
  // second credential surface. The day a founder ruling closes it, the phrasing
  // moves and this case says so.
  const adr = readFileSync(join(ROOT, 'docs/decisions/ADR-066.md'), 'utf8');
  const m06 = readFileSync(join(ROOT, 'docs/plans/M06-admin-ops-console.md'), 'utf8');

  expect(adr).toContain('`OQ-F3-04` stands and the founder closes it at signature');
  expect(adr).toContain('second credential surface');
  expect(m06).toContain('second credential surface');
});

test('4.5 `report_schedules` STILL CARRIES NO CREDENTIAL COLUMN, so the transport holds its own', () => {
  const scope = readFileSync(join(ROOT, 'packages/db/src/scope.ts'), 'utf8');

  expect(scope).toContain('NO CREDENTIAL IS STORED HERE');
});

test('4.6 `apps/worker` STILL DECLARES NO PATH INTO `apps/api`, which is flagQueue`s blocker', () => {
  // RI-04 asserts the general rule; this reads the manifest the flag-queue
  // blocker actually cites, so the entry fails the day the dependency is added
  // rather than the day somebody remembers to re-read a paragraph.
  const manifest: unknown = JSON.parse(
    readFileSync(join(ROOT, 'apps/worker/package.json'), 'utf8'),
  );
  const dependencies = (manifest as { dependencies?: Record<string, string> }).dependencies ?? {};

  expect(Object.keys(dependencies)).not.toContain('@merit/api');
});

test('4.7 lossRatioCusum`s FIRST blocker is RETIRED and its SECOND still holds, so the refusal is unchanged', () => {
  // THIS CASE WAS WRITTEN AS "`UNWIRED_BREAKER_IO` IS STILL THE ONLY `BreakerIo`"
  // AND IT FIRED, WHICH IS THE TRIPWIRE WORKING RATHER THAN A DEFECT. ADR-352
  // landed `./breaker/adapter.ts` on a concurrent branch and the two rows met in
  // one integration merge. The original wording is kept here per `RI-14`,
  // because it was true when written and it names the step that retired it: the
  // case failed the day the constructor arrived rather than the day somebody
  // remembered to re-read a paragraph, which is exactly what it was for.
  //
  // **THE RE-LOOK IT DEMANDED IS DONE AND THE ANSWER IS THAT NOTHING MOVES.**
  // `DIGEST_CONTENT_BLOCKERS` records TWO blockers on this member and says in
  // its own words that "the second is not an adapter": `OQ-M6-02`'s minimum
  // sample is the founder's and is unanswered, so `evaluateBreaker` raises
  // `BreakerDeclined` even fully wired rather than inventing a floor. So
  // `content.lossRatioCusum` still refuses, for one reason now instead of two.
  const declaring = join(ROOT, 'apps/worker/src/breaker/ports.ts');
  const inhabited = shippedSources()
    .filter((file) => file !== declaring)
    .filter((file) => /\):\s*BreakerIo\b|satisfies\s+BreakerIo\b/.test(readFileSync(file, 'utf8')));

  // The tripwire now guards the OTHER direction: a SECOND constructor, or the
  // adapter disappearing, both mean this reasoning needs re-reading.
  expect(
    inhabited.map((file) => file.slice(ROOT.length + 1)),
    'the BreakerIo inhabitant set moved again and lossRatioCusum is due another re-look',
  ).toEqual(['apps/worker/src/breaker/adapter.ts']);

  // AND THE BLOCKER THAT ACTUALLY HOLDS IS ASSERTED, not just described: the
  // member is still refused and the surviving reason is still the founder's.
  const adapter = readFileSync(join(ROOT, 'apps/worker/src/digests/adapter.ts'), 'utf8');
  expect(adapter).toContain('THE FIRST BLOCKER IS RETIRED AND THE SECOND');
  expect(adapter).toContain('OQ-M6-02');
});

// -----------------------------------------------------------------------------
// 5. The hazard, measured rather than asserted
// -----------------------------------------------------------------------------

test('5.1 A CLOCK WOULD APPEND PERMANENT `failed` ROWS FOR A TRANSPORT THAT NEVER EXISTED', async () => {
  // `adapter.ts` header section 3's claim, RUN. `deliverOne` catches a refusing
  // `content` and writes `outcome: failed` rather than crashing, and `0040`
  // REVOKES UPDATE and DELETE on `report_deliveries`, so each of these rows is
  // uncorrectable. This is why `schedule.ts` keeps the row `unscheduled` with
  // the adapter present, and it is the finding rather than a caveat.
  const recorded = door({ reportSchedules: [ENABLED_SCHEDULE] });
  const io = postgresDigestIo(recorded.db, () => DUE_AT, tradingDayAnchoredAt(DUE_AT, TRADING_DAY));

  const report = await runDigestDeliveries(io, { dueAt: DUE_AT });

  expect(report.delivered).toBe(0);
  expect(report.failed).toBe(1);
  const written = recorded.calls.filter((call) => call.op === 'insert');
  expect(written).toHaveLength(1);
  expect(written[0]?.values?.['outcome']).toBe('failed');
  // NOT `delivered`, on any path. This is the half `DigestUnwired`'s own message
  // is about and the composed value cannot reach it.
  expect(written.every((call) => call.values?.['outcome'] !== 'delivered')).toBe(true);
});

test('5.2 the job is STILL registered `unscheduled`, and wiring did not schedule it', () => {
  const row = WORKER_JOB_ENTRY_POINTS.find((job) => job.entryPoint === 'runDigestDeliveries');

  expect(row?.disposition).toBe('unscheduled');
  expect(row?.cronRow).toBe('scheduled digest delivery');
});

test('5.3 NOTHING UNDER ANY `src/` CALLS `runDigestDeliveries`, and this row did not change that', () => {
  // THE DECLARING MODULE IS EXCLUDED AND NOTHING ELSE IS, which is
  // `absence-claims.mjs`'s rule for every probe of this shape: the function is
  // declared in `produce.ts`, so a census over the whole tree would report the
  // producer calling itself. It is a CALL and never the mention, so the barrel's
  // re-export line and `schedule.ts`'s `entryPoint` string are both invisible to
  // it: neither is followed by an open parenthesis.
  const declaring = join(ROOT, 'apps/worker/src/digests/produce.ts');
  const callers = shippedSources()
    .filter((file) => file !== declaring)
    .filter((file) => /\brunDigestDeliveries\s*\(/.test(readFileSync(file, 'utf8')));

  expect(
    callers,
    'the delivery run has a caller and its schedule row is due a re-decision',
  ).toEqual([]);
});

test('5.4 THE WINDOW ANCHOR IS STILL UNSTATED, which is the blocker a transport does not discharge', () => {
  // A cron interval IS an anchor, and `produce.ts` says `due_at` is the
  // CALLER's "because the anchor is unstated and whatever schedules this job is
  // what knows when it fired". Filling one of these in is a ruling, and this
  // case makes it a red suite rather than a quiet commit.
  for (const term of ['weekdayOfWeeklyWindow', 'hourOfWindowClose']) {
    expect(DIGEST_WINDOW_ANCHOR[term]?.state).toBe('unstated');
    expect(DIGEST_WINDOW_ANCHOR[term]?.value).toBeNull();
  }
});

// -----------------------------------------------------------------------------
// 6. The translation's own scope
// -----------------------------------------------------------------------------

test('6.1 the read-filter register covers every read table the port names, and no other', () => {
  expect(Object.keys(DIGEST_READ_FILTERS).sort()).toEqual([...DIGEST_READ_TABLES].sort());
});

test('6.2 the write union still has exactly one member, and the adapter serves that one', () => {
  // `ports.ts` section 2: a delivery job that could write a schedule could
  // DISABLE the schedule it failed to serve.
  expect(DIGEST_WRITE_TABLES).toEqual(['reportDeliveries']);
});

test('6.3 the adapter reaches `@merit/db` through `../db.ts` and names the package NOWHERE', () => {
  // ADR-165's one-door rule, asserted at this file rather than only estate-wide,
  // so a future edit here fails at the file that made it.
  expect(ADAPTER_SOURCE).not.toMatch(/from '@merit\/db'/);
  expect(ADAPTER_SOURCE).toMatch(/from '\.\.\/db\.ts'/);
});
