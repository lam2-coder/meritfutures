// =============================================================================
// apps/worker/test/expiry.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/sweeps/`.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS "A SWEEP THAT TREATS THE
// THREE CLOCKS IDENTICALLY".** That defect is wrong in the direction that looks
// correct: every one of its three shapes reads as "the sweep releases
// everything" and each is a different loss.
//
//   the hold leg releasing WITHOUT posting        marks a payout paid that
//                                                 never paid
//   the withdrawal leg POSTING                    pays the trader twice
//   the withdrawal leg touching `status`          collapses an orthogonal halt
//                                                 into the rail's state
//                                                 (SD-M5-06's named mistake)
//   the freeze leg writing a guessed settlement   decides what settlement IS,
//                                                 in a sweep
//
// So section 3 below asserts each of those four in the negative, by counting
// what the ports were asked to do rather than by reading the code.
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block, so there is no Postgres in this pipeline at all. What IS asserted is
// the property at the resolution it lives at: WHICH port was called, with WHAT
// values, in WHAT order, and whether the transaction that ran them committed.
// `fakeIo` below makes nothing durable unless the transaction committed, which
// is `packages/queue/test/fake-database.ts`'s design REBUILT rather than
// imported, for the reason `src/sweeps/ports.ts` gives. That reason USED to be
// the manifest; since ADR-165 (2026-08-27) it is the ONE-DOOR rule, which that
// entry states as a checkable clause: `grep -rlE "from '@merit/db'"
// apps/worker/src` must print `apps/worker/src/db.ts` and nothing else. The
// sweep is not that file, so it declares its shapes and the suite asserts the
// absence of the import.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// Every constant the sweep declares because it cannot import it is BOUND to its
// source by reading that source as text. A retyped constant that drifts is the
// defect this file exists to catch, and the worst of them is the ledger
// idempotency key: a key naming this sweep instead of the payout endpoint would
// let three doors mint three `LT-01` postings for one approval, and all three
// would commit.
//
//   packages/db/migrations/0031_...sql   the five hold columns, from the CHECK
//   packages/db/migrations/0011_wallet.sql the three freeze columns, from its CHECK
//   packages/db/src/schema.ts            both table keys are real tables
//   apps/api/src/routes/payouts.ts       PAYOUT_PATH and the posting's key
//   apps/api/src/routes/admin-payouts.ts releaseLedgerKey, character for character
//   docs/architecture/EVENTS.md          the three event rows and their payloads
//   docs/ops/runbooks/CRON_INVENTORY.md  the three clocks are one job's
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  EXPIRY_CLOCKS,
  FREEZE_EXPIRING_LEAD_HOURS,
  FREEZE_EXPIRING_LEAD_MS,
  FREEZE_UNRELEASABLE,
  HELD,
  HOLD_COLUMNS,
  PAYOUT_ENDPOINT,
  PAYOUT_PATH,
  WITHDRAWAL_FREEZE_COLUMNS,
  clearHold,
  clearWithdrawalHalt,
  expirySweepClean,
  releaseLedgerKey,
  runExpirySweep,
} from '../src/sweeps/expiry.ts';
import type { ExpirySweepReport } from '../src/sweeps/expiry.ts';
import { EXPIRY_TABLES, ExpirySweepUnwired, UNWIRED_EXPIRY_SWEEP_IO } from '../src/sweeps/ports.ts';
import type {
  ExpiryEvent,
  ExpiryFilter,
  ExpiryFilterTerm,
  ExpirySweepIo,
  ExpiryTable,
  ExpiryTx,
  ExpiryValues,
  Lt01Values,
} from '../src/sweeps/ports.ts';

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const MIGRATION_0011 = '../../../packages/db/migrations/0011_wallet.sql';
const MIGRATION_0031 =
  '../../../packages/db/migrations/0031_payout_hold_and_identity_restriction.sql';
const SCHEMA_TS = '../../../packages/db/src/schema.ts';
const PAYOUTS_TS = '../../api/src/routes/payouts.ts';
const ADMIN_PAYOUTS_TS = '../../api/src/routes/admin-payouts.ts';
const EVENTS_MD = '../../../docs/architecture/EVENTS.md';
const CRON_INVENTORY_MD = '../../../docs/ops/runbooks/CRON_INVENTORY.md';

// -----------------------------------------------------------------------------
// The fake, which makes nothing durable unless the transaction committed
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Call {
  readonly port: 'rowsWhere' | 'lockAt' | 'updateAt' | 'postLt01' | 'emit';
  readonly table?: ExpiryTable;
  readonly where?: ExpiryFilter;
  readonly values?: ExpiryValues;
  readonly lt01?: Lt01Values;
  readonly event?: ExpiryEvent;
}

interface Fake {
  readonly io: ExpirySweepIo;
  /** Every port call, in order, WHETHER OR NOT its transaction committed. */
  readonly calls: Call[];
  /** Committed writes only. */
  readonly store: Map<ExpiryTable, Map<string, Row>>;
  /** Committed postings only. */
  readonly posted: Lt01Values[];
  /** Committed events only. */
  readonly emitted: ExpiryEvent[];
  readonly rolledBack: () => number;
}

interface FakeOptions {
  readonly now: Date;
  readonly payoutRequests?: readonly Row[];
  readonly walletWithdrawals?: readonly Row[];
  /** Throw from `postLt01` for this payout request id. */
  readonly postFailsFor?: string;
  /** Replace the locked row for this id, as a concurrent door would have. */
  readonly lockReturns?: Readonly<Record<string, Row | undefined>>;
}

function matches(row: Row, where: ExpiryFilter): boolean {
  return Object.entries(where).every(([property, expected]) => {
    const actual = row[property];
    if (typeof expected === 'object' && expected !== null && 'term' in expected) {
      const term = expected as ExpiryFilterTerm;
      if (term.term === 'is-null') return actual === null || actual === undefined;
      if (actual === null || actual === undefined) return false;
      const left = actual instanceof Date ? actual.getTime() : actual;
      const bound = term.value instanceof Date ? term.value.getTime() : term.value;
      if (typeof left !== 'number' || typeof bound !== 'number')
        throw new Error('the fake compares instants only');
      return term.term === 'at-most' ? left <= bound : left >= bound;
    }
    return actual === expected;
  });
}

function fakeIo(options: FakeOptions): Fake {
  const store = new Map<ExpiryTable, Map<string, Row>>([
    [
      'payoutRequests',
      new Map((options.payoutRequests ?? []).map((row) => [row['id'] as string, { ...row }])),
    ],
    [
      'walletWithdrawals',
      new Map((options.walletWithdrawals ?? []).map((row) => [row['id'] as string, { ...row }])),
    ],
  ]);
  const calls: Call[] = [];
  const posted: Lt01Values[] = [];
  const emitted: ExpiryEvent[] = [];
  let rolledBack = 0;

  const io: ExpirySweepIo = {
    now: () => options.now,
    terms: {
      atMost: (value) => ({ term: 'at-most', value }),
      isNull: () => ({ term: 'is-null' }),
    },
    ledger: {
      postLt01: (_tx, values) => {
        calls.push({ port: 'postLt01', lt01: values });
        if (options.postFailsFor === values.payoutRequestId)
          return Promise.reject(new Error('ledger halt: postings are refused'));
        pendingPosts.push(values);
        return Promise.resolve();
      },
    },
    events: {
      emit: (_tx, event) => {
        calls.push({ port: 'emit', event });
        pendingEvents.push(event);
        return Promise.resolve();
      },
    },
    transact: async (fn) => {
      pendingWrites.length = 0;
      pendingPosts.length = 0;
      pendingEvents.length = 0;
      const tx: ExpiryTx = {
        rowsWhere: (table, where) => {
          calls.push({ port: 'rowsWhere', table, where });
          const rows = [...(store.get(table) ?? new Map<string, Row>()).values()];
          return Promise.resolve(rows.filter((row) => matches(row, where)));
        },
        lockAt: (table, at) => {
          calls.push({ port: 'lockAt', table, where: at });
          const id = at['id'] as string;
          if (options.lockReturns !== undefined && id in options.lockReturns)
            return Promise.resolve(options.lockReturns[id]);
          return Promise.resolve((store.get(table) ?? new Map<string, Row>()).get(id));
        },
        updateAt: (table, at, values) => {
          calls.push({ port: 'updateAt', table, where: at, values });
          pendingWrites.push({ table, id: at['id'] as string, values });
          return Promise.resolve([]);
        },
      };
      try {
        const result = await fn(tx);
        for (const write of pendingWrites) {
          const table = store.get(write.table);
          const row = table?.get(write.id);
          if (table !== undefined && row !== undefined)
            table.set(write.id, { ...row, ...write.values });
        }
        posted.push(...pendingPosts);
        emitted.push(...pendingEvents);
        return result;
      } catch (err) {
        rolledBack += 1;
        throw err;
      } finally {
        pendingWrites.length = 0;
        pendingPosts.length = 0;
        pendingEvents.length = 0;
      }
    },
  };

  const pendingWrites: { table: ExpiryTable; id: string; values: ExpiryValues }[] = [];
  const pendingPosts: Lt01Values[] = [];
  const pendingEvents: ExpiryEvent[] = [];

  return { io, calls, store, posted, emitted, rolledBack: () => rolledBack };
}

// -----------------------------------------------------------------------------
// Fixtures. Every money value is `bigint`; there is no float in this file.
// -----------------------------------------------------------------------------

const NOW = new Date('2026-08-27T13:00:00.000Z');
const PAST = new Date('2026-08-27T12:00:00.000Z');
const FUTURE = new Date('2026-08-29T13:00:00.000Z');

function heldRow(overrides: Row = {}): Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    identityId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'trader-key-01',
    status: HELD,
    approvedCents: 150_000n,
    traderCents: 135_000n,
    firmCents: 15_000n,
    payoutOrdinal: 1,
    heldAt: new Date('2026-08-25T12:00:00.000Z'),
    holdFlagId: '44444444-4444-4444-8444-444444444444',
    holdExpiresAt: PAST,
    holdTosClause: '13',
    holdReason: 'severity 4 flag open at request time',
    ...overrides,
  };
}

function haltedWithdrawalRow(overrides: Row = {}): Row {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    identityId: '33333333-3333-4333-8333-333333333333',
    status: 'transferring',
    amountCents: 120_000n,
    settledAt: null,
    frozenAt: new Date('2026-08-25T12:00:00.000Z'),
    freezeFlagId: '66666666-6666-4666-8666-666666666666',
    freezeExpiresAt: PAST,
    ...overrides,
  };
}

function frozenRow(overrides: Row = {}): Row {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    accountId: '22222222-2222-4222-8222-222222222222',
    identityId: '33333333-3333-4333-8333-333333333333',
    status: 'frozen',
    frozenAt: new Date('2026-08-25T12:00:00.000Z'),
    freezeFlagId: '88888888-8888-4888-8888-888888888888',
    freezeExpiresAt: PAST,
    ...overrides,
  };
}

const clockOf = (report: ExpirySweepReport, clock: string): (typeof report.clocks)[number] => {
  const found = report.clocks.find((entry) => entry.clock === clock);
  if (found === undefined) throw new Error(`no report row for ${clock}`);
  return found;
};

// =============================================================================
// 1. The constants this file declares because it cannot import them
// =============================================================================

describe('the constants are BOUND to their sources and not merely retyped', () => {
  it('PAYOUT_PATH is the literal `payouts.ts` declares', () => {
    const declared = /export const PAYOUT_PATH = '([^']+)'/.exec(source(PAYOUTS_TS));
    expect(declared).not.toBeNull();
    expect(PAYOUT_PATH).toBe(declared?.[1]);
  });

  it('PAYOUT_ENDPOINT is built the way `payouts.ts` builds it', () => {
    expect(source(PAYOUTS_TS)).toContain('export const PAYOUT_ENDPOINT = `POST ${PAYOUT_PATH}`;');
    expect(PAYOUT_ENDPOINT).toBe(`POST ${PAYOUT_PATH}`);
  });

  // THE ASSERTION THIS SUITE IS MOST FOR. `ledger_transactions.idempotency_key`
  // is `text NOT NULL UNIQUE`, so a key naming this sweep instead of the payout
  // endpoint would let THREE doors mint THREE `LT-01` postings for ONE approval
  // and every one of them would commit. `admin-payouts.ts` says the same in its
  // own header and this is the mechanical half of that sentence.
  it('releaseLedgerKey is `admin-payouts.ts`’s, character for character', () => {
    const body =
      /export function releaseLedgerKey\(idempotencyKey: string\): string \{\s*return ([^\n]+);\s*\}/.exec(
        source(ADMIN_PAYOUTS_TS),
      );
    expect(body).not.toBeNull();
    expect(body?.[1]).toBe('`${PAYOUT_ENDPOINT} ${idempotencyKey}`');
    expect(releaseLedgerKey('trader-key-01')).toBe(`${PAYOUT_ENDPOINT} trader-key-01`);
  });

  it('the key this sweep posts under is the string `payouts.ts` posts under when NO hold stands', () => {
    expect(source(PAYOUTS_TS)).toContain('idempotencyKey: `${PAYOUT_ENDPOINT} ${idempotencyKey}`,');
    expect(releaseLedgerKey('k')).toBe('POST /accounts/:accountId/payout k');
  });

  it('both EXPIRY_TABLES members are real tables in `packages/db`’s schema', () => {
    const schema = source(SCHEMA_TS);
    for (const key of EXPIRY_TABLES) expect(schema).toContain(`export const ${key} = pgTable(`);
  });

  it('HELD is the status `0031`’s CHECK names', () => {
    expect(source(MIGRATION_0031)).toContain(`status = '${HELD}'`);
  });
});

// =============================================================================
// 2. The two biconditional CHECKs, read out of the migrations
// =============================================================================

/** Every `col IS NULL` conjunct of one named CHECK's first branch. */
function nullColumnsOf(sql: string, constraint: string): string[] {
  const start = sql.indexOf(`CONSTRAINT ${constraint} CHECK (`);
  const alter = sql.indexOf(`ADD CONSTRAINT ${constraint} CHECK (`);
  const from = start >= 0 ? start : alter;
  expect(from).toBeGreaterThanOrEqual(0);
  const body = sql.slice(from, sql.indexOf('OR', from));
  return [...body.matchAll(/(\w+) IS NULL/g)].map((match) => match[1] as string);
}

/** `snake_case` to the Drizzle property name, which is `camelCase` throughout. */
const camel = (column: string): string =>
  column.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());

describe('payout_requests_hold_is_complete is a BICONDITIONAL and the release is its other half', () => {
  const columns = nullColumnsOf(source(MIGRATION_0031), 'payout_requests_hold_is_complete');

  it('the CHECK names FIVE hold columns', () => {
    expect(columns).toEqual([
      'held_at',
      'hold_flag_id',
      'hold_expires_at',
      'hold_tos_clause',
      'hold_reason',
    ]);
  });

  it('HOLD_COLUMNS is exactly that set, so a SIXTH column added by a later migration turns THIS red', () => {
    expect([...HOLD_COLUMNS].sort()).toEqual(columns.map(camel).sort());
  });

  // AN OMISSION HERE IS A `23514` FROM POSTGRES AND NEVER A SILENT PARTIAL HOLD.
  it('clearHold NULLs every one of them, and not four of five', () => {
    const values = clearHold(NOW);
    for (const column of columns) expect(values[camel(column)]).toBeNull();
    expect(
      Object.keys(values)
        .filter((key) => values[key] === null)
        .sort(),
    ).toEqual(columns.map(camel).sort());
  });

  it('clearHold moves the status to `approved`, which ADR-040 makes the post-LT-01 state', () => {
    expect(clearHold(NOW)['status']).toBe('approved');
  });

  // A SWEEP MAY NOT INVENT A SETTLEMENT. `payout_requests_settled_has_days`
  // requires three columns this job cannot compute, so it writes none of them.
  it('clearHold writes NO settlement column', () => {
    const values = clearHold(NOW);
    expect(values).not.toHaveProperty('settledAt');
    expect(values).not.toHaveProperty('settledTradingDay');
    expect(values).not.toHaveProperty('effectiveTradingDay');
  });
});

describe('wallet_withdrawals_freeze_is_complete is THREE columns and the rail is not one of them', () => {
  const sql = source(MIGRATION_0011);
  const columns = nullColumnsOf(sql, 'wallet_withdrawals_freeze_is_complete');

  it('the CHECK names three freeze columns and no status', () => {
    expect(columns).toEqual(['frozen_at', 'freeze_flag_id', 'freeze_expires_at']);
  });

  it('WITHDRAWAL_FREEZE_COLUMNS is exactly that set', () => {
    expect([...WITHDRAWAL_FREEZE_COLUMNS].sort()).toEqual(columns.map(camel).sort());
  });

  it('clearWithdrawalHalt NULLs all three', () => {
    const values = clearWithdrawalHalt(NOW);
    for (const column of columns) expect(values[camel(column)]).toBeNull();
  });

  // `INV-M20-13`. THE HALT IS ORTHOGONAL TO THE RAIL AND IS NEVER COLLAPSED
  // INTO IT, which is `SD-M5-06`'s named mistake: the engine's gates and the
  // rail's gates sharing one column IS the defect.
  it('clearWithdrawalHalt does NOT write `status`, and that absence is INV-M20-13', () => {
    expect(clearWithdrawalHalt(NOW)).not.toHaveProperty('status');
  });
});

// =============================================================================
// 3. THE THREE CLOCKS ARE THREE DIFFERENT ACTS
// =============================================================================

describe('one job, three clocks, and CRON_INVENTORY says it is one job', () => {
  it('EXPIRY_CLOCKS is the three columns the sweep’s row names', () => {
    const row = source(CRON_INVENTORY_MD)
      .split('\n')
      .find((line) => line.includes('Freeze expiry sweep') && line.includes('hourly'));
    expect(row).toBeDefined();
    for (const clock of EXPIRY_CLOCKS) expect(row).toContain(clock);
    expect(row).toContain('one job rather than three');
  });

  it('each clock also has its own row in the release-job table, all naming ONE job', () => {
    const document = source(CRON_INVENTORY_MD);
    for (const clock of EXPIRY_CLOCKS) {
      const row = document.split('\n').find((line) => line.startsWith(`| \`${clock}\``));
      expect(row, clock).toBeDefined();
      expect(row, clock).toContain('Freeze expiry sweep');
    }
  });

  it('the sweep issues exactly THREE reads, one per clock, in one scan transaction', async () => {
    const fake = fakeIo({ now: NOW });
    await runExpirySweep(fake.io);
    const reads = fake.calls.filter((call) => call.port === 'rowsWhere');
    expect(reads).toHaveLength(3);
    expect(reads.map((read) => read.table)).toEqual([
      'payoutRequests',
      'walletWithdrawals',
      'payoutRequests',
    ]);
  });

  // ADR-157: the bound is the PROCESS'S clock and never the database's, because
  // rendering `now()` would put the database's clock in a money path and make
  // every expiry test unwritable. This is that test.
  it('every range bound is the sweep’s own instant, never a database clock', async () => {
    const fake = fakeIo({ now: NOW });
    await runExpirySweep(fake.io);
    const [holds, withdrawals, frozen] = fake.calls.filter((call) => call.port === 'rowsWhere');
    expect(holds?.where?.['holdExpiresAt']).toEqual({ term: 'at-most', value: NOW });
    expect(withdrawals?.where?.['freezeExpiresAt']).toEqual({ term: 'at-most', value: NOW });
    expect(frozen?.where?.['freezeExpiresAt']).toEqual({
      term: 'at-most',
      value: new Date(NOW.getTime() + FREEZE_EXPIRING_LEAD_MS),
    });
  });

  // ADR-157 admits `IS NULL` on the READ path only, and this is its one caller:
  // `wallet_withdrawals_live_freeze_blocks_settlement` asserted on the read, so
  // the scan cannot SEE a settled row rather than trusting one cannot exist.
  it('the withdrawal read carries `settledAt IS NULL` and the payout reads carry no term but the range', async () => {
    const fake = fakeIo({ now: NOW });
    await runExpirySweep(fake.io);
    const [holds, withdrawals, frozen] = fake.calls.filter((call) => call.port === 'rowsWhere');
    expect(withdrawals?.where?.['settledAt']).toEqual({ term: 'is-null' });
    expect(holds?.where).not.toHaveProperty('settledAt');
    expect(frozen?.where).not.toHaveProperty('settledAt');
    expect(holds?.where?.['status']).toBe(HELD);
    expect(frozen?.where?.['status']).toBe('frozen');
  });
});

describe('THE HOLD LEG RELEASES AND PAYS (INV-M5-17)', () => {
  it('moves the status to `approved`, blanks all five hold columns and POSTS LT-01', async () => {
    const held = heldRow();
    const fake = fakeIo({ now: NOW, payoutRequests: [held] });
    const report = await runExpirySweep(fake.io);

    const row = fake.store.get('payoutRequests')?.get(held['id'] as string);
    expect(row?.['status']).toBe('approved');
    for (const column of HOLD_COLUMNS) expect(row?.[column]).toBeNull();

    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]).toEqual({
      identityId: held['identityId'],
      payoutRequestId: held['id'],
      idempotencyKey: releaseLedgerKey('trader-key-01'),
      approvedCents: 150_000n,
      traderCents: 135_000n,
      firmCents: 15_000n,
    });
    expect(clockOf(report, 'payout_requests.hold_expires_at')).toMatchObject({
      found: 1,
      released: 1,
      superseded: 0,
      unreleasable: 0,
      failed: 0,
    });
  });

  // MONEY IS READ OFF THE STORED ROW AND NEVER RECOMPUTED (INV-M5-02), and it is
  // `bigint` end to end. A release producing a different number would mean the
  // hold cost the trader money.
  it('posts the stored `bigint` amounts and recomputes nothing', async () => {
    const held = heldRow({ approvedCents: 1n, traderCents: 1n, firmCents: 0n });
    const fake = fakeIo({ now: NOW, payoutRequests: [held] });
    await runExpirySweep(fake.io);
    expect(fake.posted[0]?.approvedCents).toBe(1n);
    expect(typeof fake.posted[0]?.traderCents).toBe('bigint');
  });

  it('emits `payout.hold_released` with `released_by: expiry` and NO actor key', async () => {
    const held = heldRow();
    const fake = fakeIo({ now: NOW, payoutRequests: [held] });
    await runExpirySweep(fake.io);
    const event = fake.emitted.find((entry) => entry.name === 'payout.hold_released');
    expect(event?.payload).toEqual({
      payout_request_id: held['id'],
      account_id: held['accountId'],
      identity_id: held['identityId'],
      released_by: 'expiry',
      hold_flag_id: held['holdFlagId'],
      held_at: (held['heldAt'] as Date).toISOString(),
      hold_expires_at: PAST.toISOString(),
    });
    // A NULL ACTOR AND AN ABSENT ONE ARE DIFFERENT CLAIMS. EVENTS section 6:
    // "a release with no actor is otherwise indistinguishable from a release
    // whose actor was not recorded".
    expect(event?.payload).not.toHaveProperty('actor');
  });

  // THE HOLD COLUMNS ARE READ BEFORE THE WRITE THAT ERASES THEM. After the
  // update the row cannot say it was ever held, so the event is the only place
  // `held_at` and `hold_expires_at` survive from this door.
  it('the event carries hold values the write has already blanked', async () => {
    const fake = fakeIo({ now: NOW, payoutRequests: [heldRow()] });
    await runExpirySweep(fake.io);
    const event = fake.emitted.find((entry) => entry.name === 'payout.hold_released');
    expect(event?.payload['hold_flag_id']).toBe('44444444-4444-4444-8444-444444444444');
    expect(
      fake.store.get('payoutRequests')?.get('11111111-1111-4111-8111-111111111111')?.['holdFlagId'],
    ).toBeNull();
  });

  it('a hold whose clock has NOT been reached is never released', async () => {
    const fake = fakeIo({ now: NOW, payoutRequests: [heldRow({ holdExpiresAt: FUTURE })] });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'payout_requests.hold_expires_at').found).toBe(0);
    expect(fake.posted).toHaveLength(0);
    expect(fake.calls.some((call) => call.port === 'updateAt')).toBe(false);
  });
});

describe('THE WITHDRAWAL LEG RESUMES THE RAIL AND NEVER RE-PAYS (INV-M20-14)', () => {
  it('blanks the three freeze columns and POSTS NOTHING', async () => {
    const halted = haltedWithdrawalRow();
    const fake = fakeIo({ now: NOW, walletWithdrawals: [halted] });
    const report = await runExpirySweep(fake.io);

    const row = fake.store.get('walletWithdrawals')?.get(halted['id'] as string);
    for (const column of WITHDRAWAL_FREEZE_COLUMNS) expect(row?.[column]).toBeNull();

    // THE ASSERTION THAT MAKES THE "TREAT THEM IDENTICALLY" DEFECT FALSE. The
    // money is already the trader's, so there is nothing to pay again.
    expect(fake.posted).toHaveLength(0);
    expect(fake.calls.some((call) => call.port === 'postLt01')).toBe(false);
    expect(clockOf(report, 'wallet_withdrawals.freeze_expires_at').released).toBe(1);
  });

  it('leaves the rail status exactly as it found it, and carries it into the event', async () => {
    const halted = haltedWithdrawalRow({ status: 'transferring' });
    const fake = fakeIo({ now: NOW, walletWithdrawals: [halted] });
    await runExpirySweep(fake.io);

    expect(fake.store.get('walletWithdrawals')?.get(halted['id'] as string)?.['status']).toBe(
      'transferring',
    );
    const write = fake.calls.find((call) => call.port === 'updateAt');
    expect(write?.values).not.toHaveProperty('status');

    const event = fake.emitted.find((entry) => entry.name === 'wallet.withdrawal_halt_released');
    expect(event?.payload).toEqual({
      withdrawal_id: halted['id'],
      identity_id: halted['identityId'],
      released_by: 'expiry',
      rail_status: 'transferring',
    });
  });

  it('releases a halt on a terminal withdrawal too, because a row past its expiry is a defect either way', async () => {
    const halted = haltedWithdrawalRow({ status: 'cancelled' });
    const fake = fakeIo({ now: NOW, walletWithdrawals: [halted] });
    await runExpirySweep(fake.io);
    expect(
      fake.store.get('walletWithdrawals')?.get(halted['id'] as string)?.['freezeExpiresAt'],
    ).toBeNull();
    expect(fake.posted).toHaveLength(0);
  });

  it('never sees a settled withdrawal, because the read carries IS NULL on `settled_at`', async () => {
    const fake = fakeIo({
      now: NOW,
      walletWithdrawals: [
        haltedWithdrawalRow({ status: 'settled', settledAt: new Date('2026-08-26T00:00:00.000Z') }),
      ],
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'wallet_withdrawals.freeze_expires_at').found).toBe(0);
  });

  it('never sees an unhalted withdrawal, because a NULL clock cannot satisfy a range term', async () => {
    const fake = fakeIo({
      now: NOW,
      walletWithdrawals: [
        haltedWithdrawalRow({ frozenAt: null, freezeFlagId: null, freezeExpiresAt: null }),
      ],
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'wallet_withdrawals.freeze_expires_at').found).toBe(0);
  });
});

describe('THE PAYOUT FREEZE LEG IS SWEPT AND REPORTED AND NOT WRITTEN', () => {
  it('a freeze past its expiry writes NOTHING and is reported unreleasable', async () => {
    const frozen = frozenRow();
    const fake = fakeIo({ now: NOW, payoutRequests: [frozen] });
    const report = await runExpirySweep(fake.io);

    expect(fake.calls.some((call) => call.port === 'updateAt')).toBe(false);
    expect(fake.calls.some((call) => call.port === 'lockAt')).toBe(false);
    expect(fake.posted).toHaveLength(0);
    expect(fake.store.get('payoutRequests')?.get(frozen['id'] as string)?.['status']).toBe(
      'frozen',
    );

    const leg = clockOf(report, 'payout_requests.freeze_expires_at');
    expect(leg).toMatchObject({ found: 1, released: 0, unreleasable: 1, failed: 0 });
    expect(report.outcomes.find((outcome) => outcome.subjectId === frozen['id'])?.detail).toBe(
      FREEZE_UNRELEASABLE,
    );
  });

  // THE FINDING'S OWN TEXT NAMES WHAT BLOCKS THE RELEASE. A later session that
  // makes it writable deletes this constant rather than editing around it.
  //
  // THE FOURTH NEEDLE IS A CORRECTION AND IT MAKES THIS ASSERTION STRONGER.
  // This session's first draft said `applySettlement` did not exist. It does,
  // at packages/rules-engine/src/payout/settle.ts, and it takes a
  // `calendar: CalendarSlice` -- so the leg is blocked by
  // `merit/no-calendar-in-expiry-path` banning that import here under ADR-042,
  // which is a CHECKABLE control rather than an absence somebody could close by
  // writing a function. Pinning the rule's name is what stops the finding
  // drifting back into the weaker claim.
  it('the finding names the settlement columns and the rule that blocks the import', () => {
    expect(FREEZE_UNRELEASABLE).toContain('settled_trading_day');
    expect(FREEZE_UNRELEASABLE).toContain('effective_trading_day');
    expect(FREEZE_UNRELEASABLE).toContain('INV-M5-07');
    expect(FREEZE_UNRELEASABLE).toContain('merit/no-calendar-in-expiry-path');
  });

  // THE BLOCKER IS NOW LOAD BEARING, SO IT IS CHECKED RATHER THAN CITED.
  //
  // The finding above rests on two facts outside this app, and the session that
  // wrote the first draft got one of them wrong by reading a truncated grep as
  // an absence. Both are asserted here against their sources, so the claim
  // cannot rot into prose again:
  //
  //   1. `applySettlement` EXISTS and takes a calendar. If somebody removes the
  //      parameter, the finding's reason changes and this turns red.
  //   2. `merit/no-calendar-in-expiry-path` is scoped by a GLOB in
  //      `eslint.config.js`, and THIS FILE'S SOURCE PATH MUST MATCH ONE. That
  //      config's own comment says the glob "MATCHES ZERO FILES TODAY" because
  //      the sweep was P2 code that had not landed; `src/sweeps/expiry.ts` is
  //      the first file to match it, and a refactor that moved the sweep out of
  //      the glob would switch the control off silently.
  it('the blocker is real: applySettlement takes a calendar, and the glob reaches this sweep', () => {
    const settle = source('../../../packages/rules-engine/src/payout/settle.ts');
    expect(settle).toContain('export function applySettlement(');
    expect(settle).toMatch(/export function applySettlement\([^)]*calendar: CalendarSlice/s);

    // THE GLOB LIST IS TAKEN FROM THE RULE'S OWN BLOCK AND NOT FROM THE WHOLE
    // FILE. `eslint.config.js` carries several `files:` arrays, and scanning all
    // of them would let another block's glob satisfy this assertion, which would
    // report the control as live after the line scoping it had been deleted.
    const config = source('../../../eslint.config.js');
    const rule = config.indexOf("'merit/no-calendar-in-expiry-path': 'error'");
    expect(rule).toBeGreaterThan(-1);
    const filesAt = config.lastIndexOf('files: [', rule);
    expect(filesAt).toBeGreaterThan(-1);
    const globs = [
      ...config.slice(filesAt, config.indexOf(']', filesAt)).matchAll(/'([^']+)'/g),
    ].map((match) => match[1] as string);

    const reaches = (glob: string, path: string): boolean => {
      let out = '';
      for (let i = 0; i < glob.length; i += 1) {
        const character = glob[i] as string;
        if (character === '*') {
          if (glob[i + 1] === '*') {
            // `**/` is zero or more whole path segments; a bare `**` is any run.
            if (glob[i + 2] === '/') {
              out += '(?:[^/]+/)*';
              i += 2;
            } else {
              out += '.*';
              i += 1;
            }
          } else out += '[^/]*';
        } else out += character.replace(/[.+?^${}()|[\]\\]/, (found) => `\\${found}`);
      }
      return new RegExp(`^${out}$`).test(path);
    };

    // `apps/**/*sweep*.ts` and `apps/**/*expiry*.ts` each reach this sweep.
    // Matching EITHER is enough; matching neither means the rule no longer
    // covers the file whose header and whose `FREEZE_UNRELEASABLE` cite it.
    expect(globs.filter((glob) => reaches(glob, 'apps/worker/src/sweeps/expiry.ts'))).not.toEqual(
      [],
    );
    // THE NEGATIVE CONTROL, so the matcher cannot pass vacuously. A path outside
    // the expiry family must match none of these globs; without this, a matcher
    // that returned true for everything would read as the control being live.
    expect(globs.filter((glob) => reaches(glob, 'apps/worker/src/batch/nightly.ts'))).toEqual([]);
  });

  it('an unreleasable row makes the run not clean', async () => {
    const fake = fakeIo({ now: NOW, payoutRequests: [frozenRow()] });
    expect(expirySweepClean(await runExpirySweep(fake.io))).toBe(false);
  });

  it('a clean run over two released legs IS clean', async () => {
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [heldRow()],
      walletWithdrawals: [haltedWithdrawalRow()],
    });
    expect(expirySweepClean(await runExpirySweep(fake.io))).toBe(true);
  });

  it('a freeze INSIDE its lead window emits `payout.freeze_expiring` and writes nothing', async () => {
    const soon = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    const frozen = frozenRow({ freezeExpiresAt: soon });
    const fake = fakeIo({ now: NOW, payoutRequests: [frozen] });
    const report = await runExpirySweep(fake.io);

    expect(report.warned).toEqual([frozen['id']]);
    expect(clockOf(report, 'payout_requests.freeze_expires_at')).toMatchObject({
      found: 0,
      unreleasable: 0,
    });
    expect(fake.calls.some((call) => call.port === 'updateAt')).toBe(false);
    expect(fake.emitted.find((entry) => entry.name === 'payout.freeze_expiring')?.payload).toEqual({
      payout_request_id: frozen['id'],
      flag_id: frozen['freezeFlagId'],
      expires_at: soon.toISOString(),
      lead_hours: FREEZE_EXPIRING_LEAD_HOURS,
    });
  });

  it('a freeze BEYOND its lead window is not warned about and is not found', async () => {
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [frozenRow({ freezeExpiresAt: new Date(NOW.getTime() + 20 * 3_600_000) })],
    });
    const report = await runExpirySweep(fake.io);
    expect(report.warned).toEqual([]);
    expect(clockOf(report, 'payout_requests.freeze_expires_at').found).toBe(0);
    expect(fake.emitted).toHaveLength(0);
  });

  it('a row past expiry is unreleasable rather than warned about: it is expired, not expiring', async () => {
    const fake = fakeIo({ now: NOW, payoutRequests: [frozenRow()] });
    const report = await runExpirySweep(fake.io);
    expect(report.warned).toEqual([]);
    expect(fake.emitted).toHaveLength(0);
  });

  it('the lead is TWELVE wall-clock hours and EVENTS is where it is ruled', () => {
    expect(FREEZE_EXPIRING_LEAD_HOURS).toBe(12);
    expect(FREEZE_EXPIRING_LEAD_MS).toBe(12 * 60 * 60 * 1000);
    expect(source(EVENTS_MD)).toContain('LEAD IS SET HERE AT TWELVE WALL-CLOCK HOURS');
  });
});

// =============================================================================
// 4. The row lock, which is the whole concurrency control
// =============================================================================

describe('THE SWEEP IS THE THIRD DOOR AND THE ROW LOCK IS WHAT MAKES IT ONE RELEASE', () => {
  it('locks the row before reading the precondition, on every release', async () => {
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [heldRow()],
      walletWithdrawals: [haltedWithdrawalRow()],
    });
    await runExpirySweep(fake.io);
    const perRow = fake.calls.filter((call) => call.port !== 'rowsWhere');
    expect(perRow[0]?.port).toBe('lockAt');
    expect(perRow.filter((call) => call.port === 'lockAt')).toHaveLength(2);
  });

  // AN OPERATOR RELEASING AT 12:59:59 AND THIS JOB FIRING AT 13:00:00 MUST
  // PRODUCE ONE RELEASE. `admin-payouts.ts` is the other two doors; the second
  // transaction blocks on the lock, reads a row whose status has moved, and
  // records `superseded` rather than posting a second `LT-01`.
  it('a hold an operator already released under the lock is SUPERSEDED, not paid twice', async () => {
    const held = heldRow();
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [held],
      lockReturns: { [held['id'] as string]: { ...held, status: 'approved' } },
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'payout_requests.hold_expires_at')).toMatchObject({
      found: 1,
      released: 0,
      superseded: 1,
    });
    expect(fake.posted).toHaveLength(0);
    expect(fake.calls.some((call) => call.port === 'updateAt')).toBe(false);
  });

  it('a hold an operator enforced under the lock is SUPERSEDED and nothing is posted', async () => {
    const held = heldRow();
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [held],
      lockReturns: { [held['id'] as string]: { ...held, status: 'failed' } },
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'payout_requests.hold_expires_at').superseded).toBe(1);
    expect(fake.posted).toHaveLength(0);
  });

  it('a row that vanished between the scan and the lock is SUPERSEDED, not a failure', async () => {
    const held = heldRow();
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [held],
      lockReturns: { [held['id'] as string]: undefined },
    });
    expect(clockOf(await runExpirySweep(fake.io), 'payout_requests.hold_expires_at')).toMatchObject(
      {
        superseded: 1,
        failed: 0,
      },
    );
  });

  it('a halt another door released under the lock is SUPERSEDED', async () => {
    const halted = haltedWithdrawalRow();
    const fake = fakeIo({
      now: NOW,
      walletWithdrawals: [halted],
      lockReturns: {
        [halted['id'] as string]: {
          ...halted,
          frozenAt: null,
          freezeFlagId: null,
          freezeExpiresAt: null,
        },
      },
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'wallet_withdrawals.freeze_expires_at').superseded).toBe(1);
    expect(fake.calls.some((call) => call.port === 'updateAt')).toBe(false);
  });

  it('the clock is re-read UNDER the lock, so a hold extended in between is not released', async () => {
    const held = heldRow();
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [held],
      lockReturns: { [held['id'] as string]: { ...held, holdExpiresAt: FUTURE } },
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'payout_requests.hold_expires_at').superseded).toBe(1);
    expect(fake.posted).toHaveLength(0);
  });

  // THE PROSE MENTION IS THE ARGUMENT AND THE PARENTHESIS IS THE DEFECT, so the
  // pattern matches a declaration or a call and never a name in a comment. Both
  // files explain at length WHY no advisory lock is taken, and a check that
  // refused the word would make the explanation unwritable.
  it('NO ADVISORY LOCK IS REACHABLE: neither file declares nor calls `sqlExecutor`', () => {
    for (const file of ['../src/sweeps/ports.ts', '../src/sweeps/expiry.ts']) {
      const text = source(file);
      expect(text, file).not.toMatch(/sqlExecutor\s*\(/);
      expect(text, file).not.toMatch(/pg_advisory_xact_lock\s*\(/);
    }
  });

  it('the sweep adds no SqlExecutorReason member, no SystemReason member and no pg import', () => {
    for (const file of ['../src/sweeps/ports.ts', '../src/sweeps/expiry.ts']) {
      const text = source(file);
      expect(text, file).not.toMatch(/from 'pg'/);
      expect(text, file).not.toMatch(/SystemReason\s*=/);
      expect(text, file).not.toMatch(/SqlExecutorReason\s*=/);
    }
  });

  // ADR-165's ONE-DOOR CLAUSE, HELD FOR THIS SLICE'S FILES.
  //
  // Until 2026-08-27 the sweep declared its shapes structurally because
  // `apps/worker/package.json` could not resolve `@merit/db` at all. ADR-165
  // admitted the accessor to that manifest, so the old reason is gone and a
  // STRONGER one replaces it: that entry rules ONE door and ONE acquisition
  // point, and states the check in terms -- `grep -rlE "from '@merit/db'"
  // apps/worker/src` must print `apps/worker/src/db.ts` AND NOTHING ELSE.
  //
  // WITH THE MANIFEST LINE PRESENT, AN IMPORT HERE WOULD NOW RESOLVE. That is
  // exactly why this assertion is worth its line: the thing that used to make
  // the reach impossible is gone, so what stops it has to be checked instead of
  // assumed. `src/db.ts` is asserted to still be the acquisition point, so this
  // passing cannot mean the door moved here.
  // THE PATTERN MATCHES AN IMPORT STATEMENT AND NOT THE SPELLING, for the reason
  // one case up: both sweep files QUOTE ADR-165's grep in their headers, so a
  // bare string match reports the reach-around it was written to catch and makes
  // the explanation unwritable. The first draft of this case did exactly that.
  it('neither sweep file imports the accessor: ADR-165 rules ONE door and it is src/db.ts', () => {
    const imports = /^\s*(?:import|export)\b[^\n]*from '@merit\/db'/m;
    for (const file of ['../src/sweeps/ports.ts', '../src/sweeps/expiry.ts']) {
      expect(source(file), file).not.toMatch(imports);
    }
    expect(source('../src/db.ts')).toMatch(imports);
  });
});

// =============================================================================
// 5. FM-M5-13: one bad row must not stall the sweep
// =============================================================================

describe('a per-row failure is recorded and the sweep CONTINUES', () => {
  const first = heldRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', idempotencyKey: 'k-a' });
  const second = heldRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', idempotencyKey: 'k-b' });

  it('a refused posting rolls its own row back and the next row still releases', async () => {
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [first, second],
      postFailsFor: first['id'] as string,
    });
    const report = await runExpirySweep(fake.io);

    expect(clockOf(report, 'payout_requests.hold_expires_at')).toMatchObject({
      found: 2,
      released: 1,
      failed: 1,
    });
    expect(fake.rolledBack()).toBe(1);
    // THE ROLLED-BACK ROW IS STILL HELD, which is the correct direction: a
    // release that could not post leaves the request held rather than marking a
    // payout paid that never paid.
    expect(fake.store.get('payoutRequests')?.get(first['id'] as string)?.['status']).toBe(HELD);
    expect(fake.store.get('payoutRequests')?.get(second['id'] as string)?.['status']).toBe(
      'approved',
    );
    expect(fake.posted.map((posting) => posting.payoutRequestId)).toEqual([second['id']]);
  });

  it('the failure detail reaches the report rather than the console', async () => {
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [first],
      postFailsFor: first['id'] as string,
    });
    const report = await runExpirySweep(fake.io);
    expect(report.outcomes[0]?.detail).toContain('ledger halt');
    expect(expirySweepClean(report)).toBe(false);
  });

  // A `number` WHERE A `bigint` BELONGS MEANS THE HANDLE IS NOT THE ACCESSOR AND
  // THE VALUE MAY ALREADY HAVE LOST DIGITS. It is refused rather than coerced,
  // and the refusal is a failed row rather than a posting.
  it('a money column that came back as a `number` is refused and nothing is posted', async () => {
    const fake = fakeIo({ now: NOW, payoutRequests: [heldRow({ approvedCents: 150_000 })] });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'payout_requests.hold_expires_at').failed).toBe(1);
    expect(report.outcomes[0]?.detail).toContain('ExpiryRowError');
    expect(fake.posted).toHaveLength(0);
  });

  it('the three legs all run even when the first one fails', async () => {
    const fake = fakeIo({
      now: NOW,
      payoutRequests: [first, frozenRow()],
      walletWithdrawals: [haltedWithdrawalRow()],
      postFailsFor: first['id'] as string,
    });
    const report = await runExpirySweep(fake.io);
    expect(clockOf(report, 'payout_requests.hold_expires_at').failed).toBe(1);
    expect(clockOf(report, 'wallet_withdrawals.freeze_expires_at').released).toBe(1);
    expect(clockOf(report, 'payout_requests.freeze_expires_at').unreleasable).toBe(1);
  });

  it('one instant governs the whole run', async () => {
    const fake = fakeIo({ now: NOW });
    expect((await runExpirySweep(fake.io)).sweptAt).toBe(NOW.toISOString());
  });
});

// =============================================================================
// 6. The unwired default, and the events the registry already carries
// =============================================================================

describe('the unwired default refuses rather than returning a plausible value', () => {
  it('every port refuses by name', async () => {
    await expect(runExpirySweep(UNWIRED_EXPIRY_SWEEP_IO)).rejects.toBeInstanceOf(
      ExpirySweepUnwired,
    );
    expect(() => UNWIRED_EXPIRY_SWEEP_IO.terms.atMost(NOW)).toThrow(ExpirySweepUnwired);
    expect(() => UNWIRED_EXPIRY_SWEEP_IO.terms.isNull()).toThrow(ExpirySweepUnwired);
    await expect(
      UNWIRED_EXPIRY_SWEEP_IO.events.emit({} as ExpiryTx, {
        name: 'payout.hold_released',
        payload: {},
      }),
    ).rejects.toBeInstanceOf(ExpirySweepUnwired);
  });

  it('an empty report would be indistinguishable from a clean sweep, so `now` refuses too', () => {
    expect(() => UNWIRED_EXPIRY_SWEEP_IO.now()).toThrow(ExpirySweepUnwired);
  });
});

describe('every event this job emits is already a row in the registry, produced by this job', () => {
  const events = source(EVENTS_MD);

  it('`payout.hold_released` names the expiry sweep as a producer and types `released_by`', () => {
    const row = events.split('\n').find((line) => line.startsWith('| `payout.hold_released`'));
    expect(row).toContain('Worker (the expiry sweep)');
    expect(row).toContain('released_by');
    for (const path of [
      'payout_request_id',
      'account_id',
      'identity_id',
      'hold_flag_id',
      'held_at',
    ])
      expect(row).toContain(path);
  });

  it('`wallet.withdrawal_halt_released` names the expiry sweep and carries `rail_status`', () => {
    const row = events
      .split('\n')
      .find((line) => line.startsWith('| `wallet.withdrawal_halt_released`'));
    expect(row).toContain('Worker (the expiry sweep)');
    expect(row).toContain('rail_status');
  });

  it('`payout.freeze_expiring` names the hourly sweep and carries `lead_hours`', () => {
    const row = events.split('\n').find((line) => line.startsWith('| `payout.freeze_expiring`'));
    expect(row).toContain('Worker (the hourly sweep)');
    expect(row).toContain('lead_hours');
  });

  // `payout.expiry_overdue` BELONGS TO THE NIGHTLY ASSERTION AND NOT TO THIS
  // JOB. `INV-M5-18`'s load-bearing clause is that the alarm runs ON THE QUERY
  // and never on the job, so a sweep raising it would collapse two deliberately
  // independent detections into one.
  it('`payout.expiry_overdue` is the NIGHTLY ASSERTION’s and this job never emits it', () => {
    const row = events.split('\n').find((line) => line.startsWith('| `payout.expiry_overdue`'));
    expect(row).toContain('the nightly assertion');
    expect(source('../src/sweeps/expiry.ts')).not.toContain("'payout.expiry_overdue'");
  });
});
