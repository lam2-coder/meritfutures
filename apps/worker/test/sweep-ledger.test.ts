// =============================================================================
// apps/worker/test/sweep-ledger.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/sweeps/ledger.ts`.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS "THE ADAPTER POSTS THROUGH
// WHATEVER HANDLE IT IS GIVEN".** That defect passes a typecheck, passes every
// case that only asserts a posting happened, and is the one thing the shape
// ADR-315 ruled exists to stop: `postLt01` takes an `ExpiryTx`, whose three
// members say nothing about which door opened the transaction, so a handle the
// wiring did not open is a handle whose authority the adapter cannot know. The
// refusal is asserted here on IDENTITY and not on shape, with a second object
// carrying the same members, because a shape check is exactly the defect.
//
// **THE SECOND SENTENCE IS "THE POSTING IS A SECOND TRANSACTION BESIDE THE
// RELEASE".** ADR-006 requires the ledger movement to commit with the state
// change that caused it, and the mechanism that delivers it here is that the
// `LedgerTx` and the `ExpiryTx` are THE SAME OBJECT. So section 3 runs the whole
// sweep over one handle per transaction and asserts that the five hold NULLs and
// the four ledger entries were written through the same one, in that order,
// rather than asserting that both happened.
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE, AND THE FAKE IS BUILT RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block. `packages/ledger/test/recording-tx.ts` is the same idea one package
// over and is NOT imported: what this file needs is a handle that satisfies
// `LedgerTx` AND `ExpiryTx` at once, because that is precisely what `SystemTx`
// does and what the whole ruling turns on, and a fake that satisfied only one
// of them would be agreeing with the half of the shape that was never in doubt.
//
// WHAT THIS CANNOT SEE, stated rather than left to a reader: whether Postgres
// accepts the rows, and whether the composed predicate reaches one row or many.
// Both are `packages/db`'s and are asserted there.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import { PayoutMoneyError } from '@merit/ledger';
import type { LedgerReadKey, LedgerTx, LedgerWriteKey, WriteValues } from '@merit/ledger';

import {
  HELD,
  HOLD_COLUMNS,
  expirySweepClean,
  releaseLedgerKey,
  runExpirySweep,
} from '../src/sweeps/expiry.ts';
import {
  EXPIRY_LEDGER,
  ExpiryLedgerHandleUnknown,
  recordExpiryTransaction,
} from '../src/sweeps/ledger.ts';
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
// The fixture, which is one identity's three accounts and one held request
// -----------------------------------------------------------------------------

const IDENTITY = '33333333-3333-4333-8333-333333333333';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const WITHDRAWABLE = 'aaaaaaaa-0000-4000-8000-000000000001';
const WALLET = 'aaaaaaaa-0000-4000-8000-000000000002';
const FEES = 'aaaaaaaa-0000-4000-8000-000000000003';

/** `M01` Appendix A.1's 50K column, as `expiry.test.ts` seeds the same row. */
const VALUES: Lt01Values = {
  identityId: IDENTITY,
  payoutRequestId: REQUEST,
  idempotencyKey: releaseLedgerKey('trader-key-01'),
  approvedCents: 150_000n,
  traderCents: 135_000n,
  firmCents: 15_000n,
};

/** A `ledger_accounts` row shaped the way Drizzle returns one. */
const account = (
  id: string,
  code: string,
  scope: 'firm' | 'identity',
  identityId: string | null = null,
): Record<string, unknown> => ({ id, code, scope, identityId, createdAt: new Date(0) });

const CHART: readonly Record<string, unknown>[] = [
  account(WITHDRAWABLE, 'trader_withdrawable', 'identity', IDENTITY),
  account(WALLET, 'trader_wallet', 'identity', IDENTITY),
  account(FEES, 'fees_revenue', 'firm'),
];

/** A live `ledger_halts` row against one identity. Released when `releasedAt` is set. */
const halt = (identityId: string, releasedAt: Date | null = null): Record<string, unknown> => ({
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  identityId,
  reasonCode: 'position_mismatch',
  reasonNote: 'seeded by the suite',
  escalateAt: new Date(1),
  releasedAt,
});

const PAST = new Date('2026-08-31T00:00:00.000Z');
const NOW = new Date('2026-09-01T00:00:00.000Z');

type Row = Record<string, unknown>;

function heldRow(overrides: Row = {}): Row {
  return {
    id: REQUEST,
    accountId: '22222222-2222-4222-8222-222222222222',
    identityId: IDENTITY,
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

// -----------------------------------------------------------------------------
// The handle, which satisfies BOTH shapes because `SystemTx` does
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
 * `SystemTx` has and the whole reason the ruled shape works: `SystemTx.rows` and
 * `SystemTx.insert` are generic over every `TableKey`, so a handle that accepts
 * every key satisfies one that accepts two, and its `rowsWhere`, `lockAt` and
 * `updateAt` are the sweep's three members by ordinary contravariance.
 */
class SweepTx implements LedgerTx, ExpiryTx {
  readonly written: Written[] = [];
  readonly read: string[] = [];

  private nextId = 1;

  constructor(
    private readonly store: Map<ExpiryTable, Map<string, Row>>,
    private readonly halts: readonly Row[] = [],
  ) {}

  rows(key: LedgerReadKey): Promise<unknown[]> {
    this.read.push(key);
    return Promise.resolve(key === 'ledgerAccounts' ? [...CHART] : [...this.halts]);
  }

  insert(key: LedgerWriteKey, values: WriteValues): Promise<unknown[]> {
    this.written.push({ what: 'insert', key, values });
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    return Promise.resolve([{ ...values, id }]);
  }

  rowsWhere(key: ExpiryTable, where: ExpiryFilter): Promise<unknown[]> {
    this.read.push(key);
    return Promise.resolve([...(this.store.get(key) ?? new Map()).values()].filter(matches(where)));
  }

  lockAt(key: ExpiryTable, at: ExpiryFilter): Promise<unknown> {
    this.read.push(key);
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
 * The wiring slice 9 will write, minus everything that is not this row's.
 *
 * `transact` OPENS ONE HANDLE AND RECORDS IT, which is the one line this suite
 * exists to prove is sufficient. `terms` and `events` are fakes because
 * `packages/db`'s constructors and `P5-n`'s sink are not this row's; `ledger` is
 * the REAL `EXPIRY_LEDGER` and nothing about it is faked.
 */
function wiredIo(options: {
  readonly payoutRequests?: readonly Row[];
  readonly halts?: readonly Row[];
}): { io: ExpirySweepIo; opened: SweepTx[]; emitted: ExpiryEvent[] } {
  const store = new Map<ExpiryTable, Map<string, Row>>([
    [
      'payoutRequests',
      new Map((options.payoutRequests ?? []).map((row) => [row['id'] as string, { ...row }])),
    ],
    ['walletWithdrawals', new Map<string, Row>()],
  ]);
  const opened: SweepTx[] = [];
  const emitted: ExpiryEvent[] = [];
  const io: ExpirySweepIo = {
    transact: <T>(fn: (tx: ExpiryTx) => Promise<T>): Promise<T> => {
      const tx = new SweepTx(store, options.halts ?? []);
      opened.push(tx);
      return fn(recordExpiryTransaction(tx));
    },
    terms: {
      atMost: (value) => ({ term: 'at-most', value }),
      isNull: () => ({ term: 'is-null' }),
    },
    ledger: EXPIRY_LEDGER,
    events: {
      emit: (_tx, event) => {
        emitted.push(event);
        return Promise.resolve();
      },
    },
    now: () => NOW,
  };
  return { io, opened, emitted };
}

// =============================================================================
// 1. The posting, on the handle the wiring recorded
// =============================================================================

describe('1. `postLt01` posts `LT-01` through the recorded handle and nothing else', () => {
  it('writes one header and FOUR entries, which is two transfers and not three legs', async () => {
    const tx = recordExpiryTransaction(new SweepTx(new Map()));
    await EXPIRY_LEDGER.postLt01(tx, VALUES);

    const inserts = tx.written.filter((w) => w.what === 'insert');
    expect(inserts.map((w) => w.key)).toEqual([
      'ledgerTransactions',
      'ledgerEntries',
      'ledgerEntries',
      'ledgerEntries',
      'ledgerEntries',
    ]);
    // ADR-104 ruling 1: an entry is never constructed, a `Transfer` is, and
    // every transfer yields exactly two. A one-debit two-credit shape is
    // unrepresentable in the library and this is what says the adapter did not
    // find a way to write one anyway.
    expect(inserts).toHaveLength(5);
  });

  it('carries the header `lt01` built and the key the sweep derived, unaltered', async () => {
    const tx = recordExpiryTransaction(new SweepTx(new Map()));
    await EXPIRY_LEDGER.postLt01(tx, VALUES);

    expect(tx.written[0]?.values).toEqual({
      kind: 'payout_approval',
      referenceKind: 'payout_request',
      referenceId: REQUEST,
      idempotencyKey: VALUES.idempotencyKey,
      reversalOf: null,
    });
  });

  it('resolves the split onto three accounts and the entries net to zero, in `bigint`', async () => {
    const tx = recordExpiryTransaction(new SweepTx(new Map()));
    await EXPIRY_LEDGER.postLt01(tx, VALUES);

    const entries = tx.written
      .filter((w) => w.key === 'ledgerEntries')
      .map((w) => ({
        account: w.values['ledgerAccountId'],
        amountCents: w.values['amountCents'],
      }));
    // THE DEBIT IS `trader_withdrawable` TWICE AND NOT `firm_treasury` ONCE.
    // M05 section 2.1: booking a cash movement at approval contradicts the ruled
    // recognition timing, and that error has been made in this repository once
    // already, which is why it is asserted at the account uuid here.
    expect(entries).toEqual([
      { account: WITHDRAWABLE, amountCents: 135_000n },
      { account: WALLET, amountCents: -135_000n },
      { account: WITHDRAWABLE, amountCents: 15_000n },
      { account: FEES, amountCents: -15_000n },
    ]);
    expect(entries.reduce((net, e) => net + (e.amountCents as bigint), 0n)).toBe(0n);
  });

  it('reads the chart and the halts through the SAME handle it posts through', async () => {
    const tx = recordExpiryTransaction(new SweepTx(new Map()));
    await EXPIRY_LEDGER.postLt01(tx, VALUES);

    // A chart read beside the transaction is a chart that can disagree with the
    // rows the posting is about to be checked against, and `LEDGER-C1` resolves
    // against the account uuids this read produced. BOTH READS ARE ON THIS
    // HANDLE AND THERE IS NO THIRD: the chart is the adapter's own argument and
    // the halts are `postTransaction`'s, and neither opens anything.
    expect(tx.read).toEqual(['ledgerAccounts', 'ledgerHalts']);
  });

  it('returns nothing, because the sweep has no use for a transaction id', async () => {
    const tx = recordExpiryTransaction(new SweepTx(new Map()));
    await expect(EXPIRY_LEDGER.postLt01(tx, VALUES)).resolves.toBeUndefined();
  });
});

// =============================================================================
// 2. The refusal, which is what the identity lookup is FOR
// =============================================================================

describe('2. a handle this deployment did not open is refused, by identity and not by shape', () => {
  it('refuses a handle nothing recorded, and writes not one row before refusing', async () => {
    const tx = new SweepTx(new Map());
    await expect(EXPIRY_LEDGER.postLt01(tx, VALUES)).rejects.toBeInstanceOf(
      ExpiryLedgerHandleUnknown,
    );
    expect(tx.written).toEqual([]);
    expect(tx.read).toEqual([]);
  });

  // THE CASE THAT SEPARATES IDENTITY FROM SHAPE, and it is the whole ruling. A
  // membership test on `rows` and `insert` being present would pass this
  // handle, and this handle is one nothing in the wiring ever opened.
  it('refuses a SECOND handle of the identical class, so the check is not structural', async () => {
    const opened = recordExpiryTransaction(new SweepTx(new Map()));
    const impostor = new SweepTx(new Map());

    await expect(EXPIRY_LEDGER.postLt01(opened, VALUES)).resolves.toBeUndefined();
    await expect(EXPIRY_LEDGER.postLt01(impostor, VALUES)).rejects.toBeInstanceOf(
      ExpiryLedgerHandleUnknown,
    );
  });

  it('names the mechanism in the refusal rather than saying the port is unwired', async () => {
    const tx = new SweepTx(new Map());
    await expect(EXPIRY_LEDGER.postLt01(tx, VALUES)).rejects.toThrow(
      /recovered by identity through `recordExpiryTransaction`/,
    );
  });

  it('hands its argument straight back, so a wiring cannot record and then pass another', () => {
    const tx = new SweepTx(new Map());
    expect(recordExpiryTransaction(tx)).toBe(tx);
  });
});

// =============================================================================
// 3. The release and the posting commit through ONE transaction
// =============================================================================

describe('3. the sweep releases and posts on one handle, which is ADR-006 met and not restated', () => {
  it('writes the five NULLs and the ledger rows through the SAME transaction, in that order', async () => {
    const { io, opened } = wiredIo({ payoutRequests: [heldRow()] });
    const report = await runExpirySweep(io);

    expect(report.clocks[0]?.released).toBe(1);

    // The scan opens the first transaction; the release opens the second. What
    // matters is that the SECOND one carries both writes and no third handle
    // exists at all.
    const release = opened[1];
    expect(release).toBeDefined();
    expect(opened).toHaveLength(2);

    const kinds = (release?.written ?? []).map((w) => `${w.what} ${w.key}`);
    expect(kinds).toEqual([
      'update payoutRequests',
      'insert ledgerTransactions',
      'insert ledgerEntries',
      'insert ledgerEntries',
      'insert ledgerEntries',
      'insert ledgerEntries',
    ]);

    // STEP 5 BEFORE STEP 6, AND THE UPDATE IS THE FIVE NULLS. After the update
    // the row cannot answer, which is why `expiry.ts` reads the hold columns
    // before writing them.
    const update = release?.written[0]?.values ?? {};
    for (const column of HOLD_COLUMNS) expect(update).toHaveProperty(column, null);
  });

  it('posts under the request’s OWN stored key, so two doors cannot mint two postings', async () => {
    const { io, opened } = wiredIo({ payoutRequests: [heldRow()] });
    await runExpirySweep(io);

    const header = opened[1]?.written.find((w) => w.key === 'ledgerTransactions');
    expect(header?.values['idempotencyKey']).toBe(releaseLedgerKey('trader-key-01'));
  });

  it('emits `payout.hold_released` on the same transaction, after the posting', async () => {
    const { io, emitted } = wiredIo({ payoutRequests: [heldRow()] });
    await runExpirySweep(io);

    expect(emitted.map((event) => event.name)).toEqual(['payout.hold_released']);
    expect(emitted[0]?.payload['released_by']).toBe('expiry');
  });
});

// =============================================================================
// 4. The halt refuses the posting, and the release goes back with it
// =============================================================================

describe('4. a live halt refuses the posting and no override is taken', () => {
  it('refuses the posting and the sweep reports the request as `failed`, not `released`', async () => {
    const { io } = wiredIo({ payoutRequests: [heldRow()], halts: [halt(IDENTITY)] });
    const report = await runExpirySweep(io);

    expect(report.clocks[0]?.released).toBe(0);
    expect(report.clocks[0]?.failed).toBe(1);
    // A REFUSED POSTING ROLLS THE RELEASE BACK, which is the correct direction:
    // the hold stands and `P5-k`'s nightly assertion reports the row that
    // stayed held. `expirySweepClean` is what a scheduler reads, and a run that
    // could not post is not a clean run.
    expect(expirySweepClean(report)).toBe(false);
  });

  it('a RELEASED halt against the same identity does not refuse it', async () => {
    const { io } = wiredIo({
      payoutRequests: [heldRow()],
      halts: [halt(IDENTITY, new Date('2026-08-30T00:00:00.000Z'))],
    });
    const report = await runExpirySweep(io);

    expect(report.clocks[0]?.released).toBe(1);
  });

  it('`despiteHalt` occurs in no CODE anywhere under `src/`, so the override is unreachable', () => {
    // AN OVERRIDE IS A RULING THIS ROW DOES NOT TAKE, and the assertion is on
    // the word rather than on the adapter's call shape: an option object added
    // later at ANY call site in this deployable fails here. THE WALK IS THE
    // WHOLE TREE AND NOT THE THREE FILES OF THIS SLICE, because the manifest
    // line grants the capability to the deployable and a narrower sweep would
    // be checking the one directory nobody was going to write it in.
    //
    // COMMENTS ARE STRIPPED FIRST so that the paragraphs EXPLAINING why no
    // override is taken cannot be the thing that breaks the case, which is
    // `expiry.test.ts`'s idiom for the ledger keys one file over.
    const overriding = walkSrc().filter((path) =>
      stripComments(readFileSync(path, 'utf8')).includes('despiteHalt'),
    );
    expect(overriding).toEqual([]);
  });
});

// =============================================================================
// 5. What the adapter refuses to do for itself
// =============================================================================

describe('5. the adapter holds no arithmetic, no account name and no second door', () => {
  const adapter = source('../src/sweeps/ledger.ts');

  it('`INV-M5-03` refuses a split that does not sum, and nothing is written first', async () => {
    const tx = recordExpiryTransaction(new SweepTx(new Map()));
    await expect(
      EXPIRY_LEDGER.postLt01(tx, { ...VALUES, firmCents: 15_001n }),
    ).rejects.toBeInstanceOf(PayoutMoneyError);
    expect(tx.written).toEqual([]);
    // NOTHING IS WRITTEN AND `postTransaction` IS NEVER ENTERED. The chart read
    // does happen, because `postTransaction(ledger, await readChart(ledger),
    // lt01(values))` evaluates its arguments left to right and the ruled
    // expression is transcribed rather than reordered; what matters is that a
    // read is not a write and that no halt was consulted for a posting that was
    // never built. A partially posted refusal is the thing that cannot occur.
    expect(tx.read).toEqual(['ledgerAccounts']);
  });

  // COMMENTS STRIPPED, for the reason `expiry.test.ts` gives about the ledger
  // keys in `ports.ts`: the docblock that EXPLAINS why no account is named here
  // has to name them to explain it, and an explanation that breaks the check it
  // explains is an explanation nobody can write.
  const code = stripComments(adapter);

  it('names no ledger account and writes no transfer: `lt01` is the one definition', () => {
    for (const name of ['trader_withdrawable', 'trader_wallet', 'fees_revenue', 'transfer('])
      expect(code, name).not.toContain(name);
    expect(code).toContain('postTransaction(ledger, await readChart(ledger), lt01(values))');
  });

  it('reaches no database: the ONE-DOOR clause ADR-165 states is untouched', () => {
    expect(code).not.toContain('@merit/db');
    expect(code).not.toContain("from 'pg'");
    expect(code).not.toContain('drizzle-orm');
  });

  it('caches no chart, so a chart cannot outlive the transaction it was read in', () => {
    const { io, opened } = wiredIo({ payoutRequests: [heldRow()] });
    return runExpirySweep(io).then(() => {
      expect(opened[1]?.read.filter((key) => key === 'ledgerAccounts')).toHaveLength(1);
      // And the read happened on the release's handle rather than the scan's.
      expect(opened[0]?.read).not.toContain('ledgerAccounts');
    });
  });
});
