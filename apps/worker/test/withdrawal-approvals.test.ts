// =============================================================================
// apps/worker/test/withdrawal-approvals.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/withdrawals/approval-sweep.ts` AND ITS PORT.
// ADR-325, ADR-305 section 7 slice 7, ruled by ADR-316.
//
// **THE FIRST SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS "THE APPROVAL AND THE
// POSTING ARE TWO TRANSACTIONS".** ADR-006 and `0057`'s header item 3 require
// the posting to commit in the SAME transaction as the state change that caused
// it, and the mechanism that delivers it is that the `LedgerTx` and the
// `ApprovalTx` are THE SAME OBJECT. So section 4 runs the whole driver over one
// handle per identity and asserts that the status write, the four ledger rows
// and the wallet debit went through the same one, IN THAT ORDER, rather than
// asserting that all three happened.
//
// **THE SECOND IS "A DECISION MADE ON A SCANNED ROW IS A DECISION UNDER THE
// LOCK".** The scan reads without one, so section 3 asserts that the lock is
// taken FIRST inside each identity's transaction and that the candidates are
// RE-READ after it, and seeds a row the scan saw and the lock did not.
//
// **THE THIRD IS "THE SEVEN SHARED TERMS WILL STAY IN STEP BECAUSE SOMEBODY
// WILL REMEMBER".** ADR-316 section 6 refuses the move of `decideApproval` and
// pays the duplication cost INTO A CENSUS RATHER THAN INTO A MEMORY. Section 7
// is that census: two statements, both files named, the seven hold names and
// their EVALUATION ORDER identical in both, the worker's copy carrying no
// dual-control token and the route's carrying one. A third statement turns it
// red, and so does a term dropped on either side.
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE, AND THE FAKE IS BUILT RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block. What this file needs is a handle that satisfies `LedgerTx` AND
// `ApprovalTx` at once, because that is precisely what `SystemTx` does and what
// the ruled shape turns on, and a fake satisfying only one of them would be
// agreeing with the half that was never in doubt. `sweep-ledger.test.ts` is the
// same construction one job over.
//
// WHAT THIS CANNOT SEE, stated rather than left to a reader: whether Postgres
// accepts the rows, whether `balance_after_cents >= 0` fires, and whether
// `lockAt('identities', ...)` renders `SELECT ... FOR UPDATE`. All three are
// `packages/db`'s and are asserted there.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import type { LedgerReadKey, LedgerTx, LedgerWriteKey, WriteValues } from '@merit/ledger';

import { APPROVAL_LEDGER, recordApprovalTransaction } from '../src/sweeps/ledger.ts';
import {
  APPROVABLE_STATUSES,
  MACHINE_APPROVAL_HOLDS,
  WITHDRAWAL_DEBIT_CAUSE,
  currentKycState,
  decideMachineApproval,
  positionOf,
  runWithdrawalApprovals,
  toApprovalCandidateRow,
  toApprovalWalletEntryRow,
  withdrawalApprovalsClean,
} from '../src/withdrawals/approval-sweep.ts';
import type {
  ApprovalCandidateRow,
  ApprovalIdentityRow,
} from '../src/withdrawals/approval-sweep.ts';
import { APPROVAL_TABLES, UNWIRED_WITHDRAWAL_APPROVAL_IO } from '../src/withdrawals/ports.ts';
import type {
  ApprovalEvent,
  ApprovalFilter,
  ApprovalTable,
  ApprovalTx,
  ApprovalValues,
  WithdrawalApprovalSweepIo,
} from '../src/withdrawals/ports.ts';

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const SCHEMA_TS = '../../../packages/db/src/schema.ts';
const SCOPED_DB_TS = '../../../packages/db/src/scoped-db.ts';
const ROUTE_TS = '../../api/src/routes/wallet-withdrawals.ts';
const DRIVER_TS = '../src/withdrawals/approval-sweep.ts';
const PORTS_TS = '../src/withdrawals/ports.ts';

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
// The fixture: two identities, one destination each, one verified chain
// -----------------------------------------------------------------------------

const ALICE = '33333333-3333-4333-8333-333333333333';
const BOB = '55555555-5555-4555-8555-555555555555';
const WITHDRAWAL_A = '11111111-1111-4111-8111-111111111111';
const WITHDRAWAL_B = '11111111-1111-4111-8111-111111111112';
const WITHDRAWAL_C = '11111111-1111-4111-8111-111111111113';
const WALLET_A = 'aaaaaaaa-0000-4000-8000-000000000002';
const IN_FLIGHT = 'aaaaaaaa-0000-4000-8000-000000000004';
const DESTINATION = 'rise-dest-01';

const NOW = new Date('2026-09-05T00:00:00.000Z');
const PAST = new Date('2026-09-01T00:00:00.000Z');
const FUTURE = new Date('2026-09-09T00:00:00.000Z');

type Row = Record<string, unknown>;

const account = (
  id: string,
  code: string,
  scope: 'firm' | 'identity',
  identityId: string | null = null,
): Row => ({ id, code, scope, identityId, createdAt: new Date(0) });

/** `LT-06` resolves exactly two accounts: the identity's wallet and the firm's obligation. */
const CHART: readonly Row[] = [
  account(WALLET_A, 'trader_wallet', 'identity', ALICE),
  account('aaaaaaaa-0000-4000-8000-000000000005', 'trader_wallet', 'identity', BOB),
  account(IN_FLIGHT, 'withdrawals_in_flight', 'firm'),
];

function identityRow(overrides: Row = {}): Row {
  return { id: ALICE, status: 'active', payoutsFrozen: false, ...overrides };
}

function withdrawalRow(overrides: Row = {}): Row {
  return {
    id: WITHDRAWAL_A,
    identityId: ALICE,
    status: 'requested',
    amountCents: 50_000n,
    destinationRef: DESTINATION,
    idempotencyKey: 'trader-key-01',
    frozenAt: null,
    destinationNameMatch: true,
    nameMatchScore: 98,
    nameMatchMethod: 'rise_identity',
    sourceProvenanceSummary: [{ provenance: 'payout', cents: 50_000 }],
    earliestCreditAt: PAST,
    ...overrides,
  };
}

function entryRow(overrides: Row = {}): Row {
  return {
    id: 1n,
    identityId: ALICE,
    direction: 'credit',
    amountCents: 120_000n,
    provenance: 'payout',
    cause: 'payout settled',
    referenceId: WITHDRAWAL_A,
    ledgerTransactionId: '99999999-9999-4999-8999-999999999999',
    balanceAfterCents: 120_000n,
    occurredAt: PAST,
    ...overrides,
  };
}

function kycRow(overrides: Row = {}): Row {
  return { id: 'kyc-1', identityId: ALICE, state: 'verified', supersedes: null, ...overrides };
}

function destinationRow(overrides: Row = {}): Row {
  return {
    identityId: ALICE,
    destinationRef: DESTINATION,
    firstSeenAt: PAST,
    coolingUntil: PAST,
    ...overrides,
  };
}

const CANDIDATE: ApprovalCandidateRow = toApprovalCandidateRow(withdrawalRow());
const ACTIVE: ApprovalIdentityRow = { status: 'active', payoutsFrozen: false };

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
 * IT IMPLEMENTS `LedgerTx` AND `ApprovalTx` AT ONCE, which is the property
 * `SystemTx` has and the whole reason the ruled shape works: `SystemTx.rows`,
 * `SystemTx.insert` and the rest are generic over every `TableKey`, so a handle
 * that accepts every key satisfies one that accepts five.
 */
class ApprovalFakeTx implements LedgerTx, ApprovalTx {
  readonly written: Written[] = [];
  readonly read: string[] = [];
  readonly locked: { key: string; at: ApprovalFilter }[] = [];
  /** Every filter this handle was given, so a case reads the TERMS and not only the keys. */
  readonly filters: { key: string; where: ApprovalFilter }[] = [];
  readonly addresses: { key: string; at: ApprovalFilter }[] = [];

  private nextId = 1;

  constructor(
    private readonly store: Map<string, Row[]>,
    private readonly halts: readonly Row[] = [],
    private readonly onInsert: (key: string) => void = () => undefined,
  ) {}

  rows(key: LedgerReadKey): Promise<unknown[]> {
    this.read.push(key);
    return Promise.resolve(key === 'ledgerAccounts' ? [...CHART] : [...this.halts]);
  }

  insert(
    key: LedgerWriteKey | ApprovalTable,
    values: WriteValues | ApprovalValues,
  ): Promise<unknown[]> {
    this.onInsert(String(key));
    this.written.push({ what: 'insert', key: String(key), values: values as WriteValues });
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    return Promise.resolve([{ ...values, id }]);
  }

  rowsWhere(key: ApprovalTable, where: ApprovalFilter): Promise<unknown[]> {
    this.read.push(key);
    this.filters.push({ key, where });
    return Promise.resolve((this.store.get(key) ?? []).filter(matches(where)));
  }

  rowAt(key: ApprovalTable, at: ApprovalFilter): Promise<unknown> {
    this.read.push(key);
    this.addresses.push({ key, at });
    return Promise.resolve((this.store.get(key) ?? []).find(matches(at)));
  }

  lockAt(key: ApprovalTable, at: ApprovalFilter): Promise<unknown> {
    this.locked.push({ key, at });
    this.read.push(key);
    return Promise.resolve((this.store.get(key) ?? []).find(matches(at)) ?? null);
  }

  updateAt(key: ApprovalTable, at: ApprovalFilter, values: ApprovalValues): Promise<unknown[]> {
    this.written.push({ what: 'update', key, values: values as WriteValues });
    const table = this.store.get(key) ?? [];
    const found = table.filter(matches(at));
    for (const row of found) Object.assign(row, values);
    return Promise.resolve(found);
  }
}

const matches =
  (where: ApprovalFilter) =>
  (row: Row): boolean =>
    Object.entries(where).every(([property, expected]) => row[property] === expected);

/**
 * The wiring slice 9 will write, minus everything that is not this row's.
 *
 * `transact` OPENS ONE HANDLE AND RECORDS IT, which is the one line this suite
 * exists to prove is sufficient. `events` is a fake because `P5-n`'s sink is not
 * this row's; `ledger` is the REAL `APPROVAL_LEDGER` and nothing about it is
 * faked.
 */
function wiredIo(fixture: {
  readonly identities?: readonly Row[];
  readonly walletWithdrawals?: readonly Row[];
  readonly walletEntries?: readonly Row[];
  readonly kycVerifications?: readonly Row[];
  readonly payoutDestinations?: readonly Row[];
  readonly halts?: readonly Row[];
  readonly onInsert?: (key: string) => void;
}): {
  io: WithdrawalApprovalSweepIo;
  opened: ApprovalFakeTx[];
  emitted: ApprovalEvent[];
  store: Map<string, Row[]>;
} {
  const store = new Map<string, Row[]>([
    ['identities', (fixture.identities ?? []).map((row) => ({ ...row }))],
    ['walletWithdrawals', (fixture.walletWithdrawals ?? []).map((row) => ({ ...row }))],
    ['walletEntries', (fixture.walletEntries ?? []).map((row) => ({ ...row }))],
    ['kycVerifications', (fixture.kycVerifications ?? []).map((row) => ({ ...row }))],
    ['payoutDestinations', (fixture.payoutDestinations ?? []).map((row) => ({ ...row }))],
  ]);
  const opened: ApprovalFakeTx[] = [];
  const emitted: ApprovalEvent[] = [];
  const io: WithdrawalApprovalSweepIo = {
    transact: <T>(fn: (tx: ApprovalTx) => Promise<T>): Promise<T> => {
      const tx = new ApprovalFakeTx(store, fixture.halts ?? [], fixture.onInsert);
      opened.push(tx);
      return fn(recordApprovalTransaction(tx));
    },
    ledger: APPROVAL_LEDGER,
    events: {
      emit: (_tx, event) => {
        emitted.push(event);
        return Promise.resolve();
      },
    },
    now: () => NOW,
  };
  return { io, opened, emitted, store };
}

/** The whole happy fixture: Alice, verified, one cleared destination, one open withdrawal. */
const HAPPY = {
  identities: [identityRow()],
  walletWithdrawals: [withdrawalRow()],
  walletEntries: [entryRow()],
  kycVerifications: [kycRow()],
  payoutDestinations: [destinationRow()],
};

// =============================================================================
// 1. The port, which is ADR-316 section 3 transcribed and imports nothing
// =============================================================================

describe('1. the port is declared structurally and names five real tables', () => {
  it('every `APPROVAL_TABLES` member is a real `pgTable` in `packages/db`', () => {
    const schema = source(SCHEMA_TS);
    for (const key of APPROVAL_TABLES) expect(schema).toContain(`export const ${key} = pgTable(`);
    expect([...APPROVAL_TABLES]).toEqual([
      'identities',
      'walletWithdrawals',
      'walletEntries',
      'payoutDestinations',
      'kycVerifications',
    ]);
  });

  // ADR-316 SECTION 3.1: THE TWO LEDGER KEYS ARE EXCLUDED DELIBERATELY, so
  // nothing in the job can write a ledger row by naming a key. The exclusion is
  // asserted on the union rather than on the prose that explains it.
  it('neither ledger key is reachable through this port', () => {
    expect([...APPROVAL_TABLES]).not.toContain('ledgerTransactions');
    expect([...APPROVAL_TABLES]).not.toContain('ledgerEntries');
    // `adminActions` too: a sweep is nobody's decision and has no actor.
    expect([...APPROVAL_TABLES]).not.toContain('adminActions');
  });

  it('the port imports nothing at all, so ADR-165s one door is untouched', () => {
    const ports = source(PORTS_TS);
    expect(ports).not.toMatch(/^\s*(?:import|export)\b[^\n]*from '/m);
    const code = stripComments(ports);
    expect(code).not.toContain('@merit/db');
    expect(code).not.toContain('@merit/ledger');
    expect(code).not.toContain("from 'pg'");
    expect(code).not.toContain('SqlExecutorReason');
    expect(code).not.toContain('SystemReason');
  });

  // `SystemTx` IS ASSIGNABLE TO `ApprovalTx` AND THE SUITE BINDS THE TWO BY
  // READING THE ACCESSOR'S SOURCE, which is `sweeps/ports.ts`'s idiom: the port
  // cannot import the accessor and the accessor must not know the port exists.
  it('`SystemTx` declares every member `ApprovalTx` needs', () => {
    const scoped = source(SCOPED_DB_TS);
    const start = scoped.indexOf('export interface SystemTx extends TxCommon {');
    expect(start).toBeGreaterThan(-1);
    const block = scoped.slice(start, scoped.indexOf('\n}', start));
    for (const member of ['rowsWhere<', 'rowAt<', 'lockAt<', 'insert<', 'updateAt<'])
      expect(block, member).toContain(member);
  });

  it('the unwired default refuses every member and says what it would have to invent', async () => {
    await expect(UNWIRED_WITHDRAWAL_APPROVAL_IO.transact(() => Promise.resolve(1))).rejects.toThrow(
      /wallet claim was extinguished/,
    );
    await expect(
      UNWIRED_WITHDRAWAL_APPROVAL_IO.ledger.postLt06({} as ApprovalTx, {
        withdrawalId: WITHDRAWAL_A,
        identityId: ALICE,
        amountCents: 1n,
        withdrawalIdempotencyKey: 'k',
      }),
    ).rejects.toThrow(/ledger.postLt06/);
    await expect(
      UNWIRED_WITHDRAWAL_APPROVAL_IO.events.emit({} as ApprovalTx, {
        name: 'wallet.debited',
        payload: {},
      }),
    ).rejects.toThrow(/events.emit/);
    expect(() => UNWIRED_WITHDRAWAL_APPROVAL_IO.now()).toThrow(/now/);
  });
});

// =============================================================================
// 2. The decision, total and pure, every arm reachable without a database
// =============================================================================

describe('2. `decideMachineApproval` holds on each term and approves on neither', () => {
  const decide = (over: Partial<Parameters<typeof decideMachineApproval>[0]> = {}) =>
    decideMachineApproval({
      candidate: CANDIDATE,
      identity: ACTIVE,
      kyc: 'verified',
      destination: { coolingUntil: PAST },
      positionCents: 120_000n,
      at: NOW,
      ...over,
    });

  it('approves a cleared `requested` row under `G-WITHDRAWAL-CLEARED`', () => {
    const decision = decide();
    expect(decision.kind).toBe('approve');
    if (decision.kind !== 'approve') return;
    expect(decision.guard).toBe('G-WITHDRAWAL-CLEARED');
    // ALL THREE OPERATOR COLUMNS ARE `null`, which `0070`'s
    // `wallet_withdrawals_unapproved_records_no_approval` requires of a machine
    // approval and which is the eighth term this deployable cannot reach.
    expect(decision.values).toEqual({
      status: 'approved',
      approvedAt: NOW,
      approvedBy: null,
      dualControlApprovalId: null,
      dualControlThresholdCents: null,
      updatedAt: NOW,
    });
  });

  it('approves a `cooling` row under `G-COOLING-ELAPSED`, which is the other arrow', () => {
    const cooling = toApprovalCandidateRow(withdrawalRow({ status: 'cooling' }));
    const decision = decide({ candidate: cooling });
    expect(decision.kind === 'approve' && decision.guard).toBe('G-COOLING-ELAPSED');
  });

  it('holds on each of the eight terms, and the order is the order they are listed', () => {
    const cases: readonly [string, ReturnType<typeof decide>][] = [
      [
        'not_approvable',
        decide({ candidate: toApprovalCandidateRow(withdrawalRow({ status: 'approved' })) }),
      ],
      ['identity_not_active', decide({ identity: { status: 'restricted', payoutsFrozen: false } })],
      ['payouts_frozen', decide({ identity: { status: 'active', payoutsFrozen: true } })],
      ['kyc_not_verified', decide({ kyc: 'pending' })],
      ['halted', decide({ candidate: toApprovalCandidateRow(withdrawalRow({ frozenAt: PAST })) })],
      [
        'provenance_missing',
        decide({
          candidate: toApprovalCandidateRow(
            withdrawalRow({ sourceProvenanceSummary: [], earliestCreditAt: null }),
          ),
        }),
      ],
      ['destination_cooling', decide({ destination: { coolingUntil: FUTURE } })],
      ['insufficient_position', decide({ positionCents: 49_999n })],
    ];
    expect(
      cases.map(([, decision]) => (decision.kind === 'hold' ? decision.hold : 'approve')),
    ).toEqual([...MACHINE_APPROVAL_HOLDS]);
  });

  // A DESTINATION THIS TREE HAS NO ROW FOR HAS NEVER STARTED A WINDOW, and a
  // window that has not started has not elapsed. `undefined` is a hold and never
  // a pass.
  it('an unknown destination is `destination_cooling` and not a pass', () => {
    expect(decide({ destination: undefined })).toEqual({
      kind: 'hold',
      hold: 'destination_cooling',
    });
  });

  // `>` AND NOT `>=`. A withdrawal that empties the wallet exactly is a wallet
  // emptied and not an overdraft, and `balance_after_cents >= 0` admits the zero
  // row it produces.
  it('a withdrawal for exactly the position is approved and leaves zero', () => {
    expect(decide({ positionCents: 50_000n }).kind).toBe('approve');
    expect(decide({ positionCents: 49_999n })).toEqual({
      kind: 'hold',
      hold: 'insufficient_position',
    });
  });

  it('`positionOf` reads the greatest `id` and not the greatest `occurred_at`', () => {
    const rows = [
      entryRow({ id: 1n, balanceAfterCents: 10n, occurredAt: FUTURE }),
      entryRow({ id: 9n, balanceAfterCents: 700n, occurredAt: PAST }),
    ].map(toApprovalWalletEntryRow);
    expect(positionOf(rows)).toBe(700n);
    expect(positionOf([])).toBe(0n);
  });

  // A CHAIN WHOSE HEAD CANNOT BE NAMED FAILS CLOSED, on the door where a pass
  // means paying somebody.
  it('a kyc chain with two live heads is `kyc_required` and not the first row', () => {
    expect(currentKycState([kycRow()])).toBe('verified');
    expect(currentKycState([])).toBe('kyc_required');
    expect(currentKycState([kycRow(), kycRow({ id: 'kyc-2' })])).toBe('kyc_required');
    expect(
      currentKycState([kycRow({ state: 'expired' }), kycRow({ id: 'kyc-2', supersedes: 'kyc-1' })]),
    ).toBe('verified');
  });
});

// =============================================================================
// 3. The ordering, which is the whole of the concurrency control
// =============================================================================

describe('3. the lock comes first and the candidates are re-read under it', () => {
  it('opens one transaction for the scan and one per identity, and locks `identities` first', async () => {
    const { io, opened } = wiredIo({
      ...HAPPY,
      identities: [identityRow(), identityRow({ id: BOB })],
      walletWithdrawals: [
        withdrawalRow(),
        withdrawalRow({ id: WITHDRAWAL_C, identityId: BOB, idempotencyKey: 'trader-key-03' }),
      ],
      kycVerifications: [kycRow(), kycRow({ id: 'kyc-b', identityId: BOB })],
      payoutDestinations: [destinationRow(), destinationRow({ identityId: BOB })],
      walletEntries: [entryRow(), entryRow({ id: 2n, identityId: BOB })],
    });
    const report = await runWithdrawalApprovals(io);

    // ONE SCAN PLUS ONE PER IDENTITY. A sweep-wide transaction is refused
    // (ADR-316 section 3.5) because it would hold every scanned identity's row
    // until the run ended, and `lockScope()` is the request handler's first act.
    expect(opened).toHaveLength(3);
    expect(opened[0]?.locked).toEqual([]);
    expect(opened[1]?.locked[0]?.key).toBe('identities');
    expect(opened[2]?.locked[0]?.key).toBe('identities');
    expect(report.identities.map((identity) => identity.identityId)).toEqual([ALICE, BOB]);
    expect(report.approved).toBe(2);
  });

  it('the lock is the FIRST read of the identity transaction and the candidates come after', async () => {
    const { io, opened } = wiredIo(HAPPY);
    await runWithdrawalApprovals(io);
    // `identities` is read by the lock and by nothing before it. Two
    // `walletWithdrawals` reads follow, because `APPROVABLE_STATUSES` is two
    // values and an `OR` is a term ADR-157 refuses.
    expect(opened[1]?.read.slice(0, 3)).toEqual([
      'identities',
      'walletWithdrawals',
      'walletWithdrawals',
    ]);
  });

  // **THE SEEDED DEFECT THIS CASE WATCHES**: the scan saw a `requested` row and
  // the trader cancelled it before the lock. A driver that decided on the
  // scanned row would approve a cancelled withdrawal, and
  // `wallet_withdrawals_open_idx` is not unique (ADR-158 finding 8) so nothing
  // in the database would catch it.
  it('a row the scan saw and the lock did not is not approved', async () => {
    const { io, store, emitted } = wiredIo(HAPPY);
    const original = io.transact.bind(io);
    let first = true;
    const racing: WithdrawalApprovalSweepIo = {
      ...io,
      transact: <T>(fn: (tx: ApprovalTx) => Promise<T>): Promise<T> => {
        const result = original(fn);
        if (first) {
          first = false;
          // Between the scan and the identity transaction, the trader cancels.
          for (const row of store.get('walletWithdrawals') ?? []) row['status'] = 'cancelled';
        }
        return result;
      },
    };
    const report = await runWithdrawalApprovals(racing);

    expect(report.approved).toBe(0);
    expect(report.held).toBe(0);
    expect(report.identities[0]?.outcomes).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('the two candidate reads are the two approvable statuses and nothing else', async () => {
    const { io, opened } = wiredIo(HAPPY);
    await runWithdrawalApprovals(io);
    // THE SCAN CARRIES NO IDENTITY and the re-read carries one, which is the
    // difference between "which identities are worth locking" and "what does
    // this identity hold under the lock".
    expect(opened[0]?.filters.filter((read) => read.key === 'walletWithdrawals')).toEqual([
      { key: 'walletWithdrawals', where: { status: 'requested' } },
      { key: 'walletWithdrawals', where: { status: 'cooling' } },
    ]);
    expect(opened[1]?.filters.filter((read) => read.key === 'walletWithdrawals')).toEqual([
      { key: 'walletWithdrawals', where: { identityId: ALICE, status: 'requested' } },
      { key: 'walletWithdrawals', where: { identityId: ALICE, status: 'cooling' } },
    ]);
    expect([...APPROVABLE_STATUSES]).toEqual(['requested', 'cooling']);
  });

  // `payout_destinations`' PRIMARY KEY IS `(identity_id, destination_ref)` and
  // this handle has no scope, so a port that forgot the identity conjunct would
  // read another identity's cooling window.
  it('the destination is addressed by two columns and not one', async () => {
    const { io, opened } = wiredIo(HAPPY);
    await runWithdrawalApprovals(io);
    expect(opened[1]?.addresses).toEqual([
      { key: 'payoutDestinations', at: { identityId: ALICE, destinationRef: DESTINATION } },
    ]);
  });
});

// =============================================================================
// 4. ADR-006: one transaction, one handle, and the order inside it
// =============================================================================

describe('4. the transition, the posting and the debit are one transaction', () => {
  it('writes the status, four ledger rows and the wallet debit through ONE handle in order', async () => {
    const { io, opened } = wiredIo(HAPPY);
    const report = await runWithdrawalApprovals(io);

    expect(report.approved).toBe(1);
    expect(withdrawalApprovalsClean(report)).toBe(true);

    const tx = opened[1];
    expect(tx).toBeDefined();
    // ONE HEADER, TWO ENTRIES, which is `LT-06`'s single transfer, and the
    // status write comes BEFORE all three: an approval that could not post
    // leaves the row `requested` rather than marking a claim extinguished.
    expect(tx?.written.map((write) => `${write.what} ${write.key}`)).toEqual([
      'update walletWithdrawals',
      'insert ledgerTransactions',
      'insert ledgerEntries',
      'insert ledgerEntries',
      'insert walletEntries',
    ]);
  });

  it('a posting that refuses rolls the whole identity back and approves nothing', async () => {
    // A LIVE LEDGER HALT REFUSES THE POSTING AND NO OVERRIDE IS TAKEN. The
    // rejection propagates out of `transact`, which a real accessor answers by
    // rolling back; here the assertion is that nothing past the posting ran.
    const { io, opened, emitted } = wiredIo({
      ...HAPPY,
      halts: [
        {
          id: 'bbbbbbbb-0000-4000-8000-000000000001',
          identityId: ALICE,
          reasonCode: 'position_mismatch',
          reasonNote: 'seeded by the suite',
          escalateAt: new Date(1),
          releasedAt: null,
        },
      ],
    });
    const report = await runWithdrawalApprovals(io);

    // THE WHOLE IDENTITY ROLLS BACK, so nothing is approved rather than
    // "approved but unposted". A refused posting leaves the row `requested`,
    // the trader keeps the claim, and they keep their cancel.
    expect(report.approved).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.identities[0]?.failure).toMatch(/halt/i);
    expect(withdrawalApprovalsClean(report)).toBe(false);
    expect(emitted).toEqual([]);
    // The wallet debit never ran, so the trader's statement carries nothing.
    expect(opened[1]?.written.map((write) => write.key)).not.toContain('walletEntries');
  });

  it('one identity failing does not stop the next one', async () => {
    const { io } = wiredIo({
      identities: [identityRow(), identityRow({ id: BOB })],
      walletWithdrawals: [
        withdrawalRow(),
        withdrawalRow({ id: WITHDRAWAL_C, identityId: BOB, idempotencyKey: 'trader-key-03' }),
      ],
      kycVerifications: [kycRow(), kycRow({ id: 'kyc-b', identityId: BOB })],
      payoutDestinations: [destinationRow(), destinationRow({ identityId: BOB })],
      // Alice has no wallet history at all, so her position is zero and her
      // 50_000c withdrawal cannot be covered; Bob's is.
      walletEntries: [entryRow({ id: 2n, identityId: BOB })],
    });
    const report = await runWithdrawalApprovals(io);
    expect(report.approved).toBe(1);
    expect(report.held).toBe(1);
    expect(report.identities[0]?.outcomes[0]?.decision).toEqual({
      kind: 'hold',
      hold: 'insufficient_position',
    });
  });

  // THE POSTING IS ON THE HANDLE THE APPROVAL WAS WRITTEN THROUGH, recovered by
  // IDENTITY and not by shape. A handle nothing recorded is a handle whose
  // authority the adapter cannot know.
  it('a handle this deployment did not open is refused', async () => {
    const stranger = new ApprovalFakeTx(new Map());
    await expect(
      APPROVAL_LEDGER.postLt06(stranger, {
        withdrawalId: WITHDRAWAL_A,
        identityId: ALICE,
        amountCents: 50_000n,
        withdrawalIdempotencyKey: 'trader-key-01',
      }),
    ).rejects.toThrow(/did not open/);
    expect(stranger.written).toEqual([]);
  });

  it('`postLt06` returns the id the debit has to carry, and it is the header row', async () => {
    const recorded = recordApprovalTransaction(new ApprovalFakeTx(new Map()));
    const id = await APPROVAL_LEDGER.postLt06(recorded, {
      withdrawalId: WITHDRAWAL_A,
      identityId: ALICE,
      amountCents: 50_000n,
      withdrawalIdempotencyKey: 'trader-key-01',
    });
    const header = recorded.written.find((write) => write.key === 'ledgerTransactions');
    expect(header).toBeDefined();
    expect(id).toBe('00000000-0000-4000-8000-000000000001');
    // AND IT POSTS UNDER THE ROW'S OWN BARE KEY, not one naming an endpoint,
    // because the approval edge is reachable from more than one door.
    expect((header?.values as Record<string, unknown>)['idempotencyKey']).toBe('trader-key-01');
  });
});

// =============================================================================
// 5. The wallet's own statement, which nothing in this tree wrote before
// =============================================================================

describe('5. the debit is the first `wallet_entries` write in this application', () => {
  it('this file is the only `insert` of `walletEntries` under any `src/`', () => {
    const writers = [
      ...walkSrc(),
      ...readdirSync(fileURLToPath(new URL('../../api/src/routes', import.meta.url)))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => fileURLToPath(new URL(`../../api/src/routes/${name}`, import.meta.url))),
    ]
      .filter((path) =>
        /insert\(\s*'walletEntries'/.test(stripComments(readFileSync(path, 'utf8'))),
      )
      .map((path) => path.slice(path.indexOf('apps/')));
    // ADR-316 section 8 finding 3: nothing in this tree wrote a `wallet_entries`
    // row, so `balance_after_cents >= 0` (`0011:90`) had never been exercised.
    // THIS DRIVER IS THE FIRST, and the list is exact so a second writer is a
    // decision somebody records.
    expect(writers).toEqual(['apps/worker/src/withdrawals/approval-sweep.ts']);
  });

  it('the debit carries no provenance, the withdrawal as its reference, and the new balance', async () => {
    const { io, opened } = wiredIo(HAPPY);
    await runWithdrawalApprovals(io);

    const debit = opened[1]?.written.find((write) => write.key === 'walletEntries');
    expect(debit?.values).toEqual({
      identityId: ALICE,
      direction: 'debit',
      amountCents: 50_000n,
      // `0080`'s `wallet_entries_provenance_follows_direction` admits `debit +
      // NULL` and refuses `credit + NULL`. The null is WRITTEN and not omitted,
      // so the row states what ADR-322 ruled rather than relying on the column
      // having no DEFAULT.
      provenance: null,
      cause: WITHDRAWAL_DEBIT_CAUSE,
      referenceId: WITHDRAWAL_A,
      ledgerTransactionId: '00000000-0000-4000-8000-000000000001',
      balanceAfterCents: 70_000n,
      occurredAt: NOW,
    });
  });

  // THE POSITION IS THREADED AND NOT RE-READ. An identity with two approvable
  // withdrawals has to see the first debit before deciding the second, and
  // re-reading `wallet_entries` inside the loop would read rows this
  // transaction has not committed.
  it('two withdrawals of one identity debit in sequence and the second sees the first', async () => {
    const { io, opened } = wiredIo({
      ...HAPPY,
      walletWithdrawals: [
        withdrawalRow({ amountCents: 70_000n }),
        withdrawalRow({ id: WITHDRAWAL_B, amountCents: 60_000n, idempotencyKey: 'trader-key-02' }),
      ],
    });
    const report = await runWithdrawalApprovals(io);

    // 120_000c, less the first 70_000c, leaves 50_000c and the second asks for
    // 60_000c. A driver that re-read the position would still see 120_000c,
    // because nothing this transaction wrote has committed.
    expect(report.approved).toBe(1);
    expect(report.held).toBe(1);
    expect(report.identities[0]?.outcomes[1]?.decision).toEqual({
      kind: 'hold',
      hold: 'insufficient_position',
    });
    const debits = opened[1]?.written.filter((write) => write.key === 'walletEntries') ?? [];
    expect(debits).toHaveLength(1);
    expect((debits[0]?.values as Record<string, unknown>)['balanceAfterCents']).toBe(50_000n);
  });

  it('two that both fit debit twice, and the running balance walks down', async () => {
    const { io, opened } = wiredIo({
      ...HAPPY,
      walletWithdrawals: [
        withdrawalRow({ amountCents: 70_000n }),
        withdrawalRow({ id: WITHDRAWAL_B, amountCents: 50_000n, idempotencyKey: 'trader-key-02' }),
      ],
      walletEntries: [entryRow({ balanceAfterCents: 130_000n })],
    });
    const report = await runWithdrawalApprovals(io);
    expect(report.approved).toBe(2);
    const debits = (opened[1]?.written ?? [])
      .filter((write) => write.key === 'walletEntries')
      .map((write) => (write.values as Record<string, unknown>)['balanceAfterCents']);
    expect(debits).toEqual([60_000n, 10_000n]);
  });
});

// =============================================================================
// 6. The events, field for field with the registry
// =============================================================================

describe('6. two events, both catalogue rows, both on the transaction', () => {
  it('emits `wallet.withdrawal_approved` and `wallet.debited`, in that order', async () => {
    const { io, emitted } = wiredIo(HAPPY);
    await runWithdrawalApprovals(io);

    expect(emitted.map((event) => event.name)).toEqual([
      'wallet.withdrawal_approved',
      'wallet.debited',
    ]);
    expect(emitted[0]?.payload).toEqual({
      withdrawal_id: WITHDRAWAL_A,
      identity_id: ALICE,
      amount_cents: 50_000n,
      destination_name_match: true,
      name_match_score: 98,
      name_match_method: 'rise_identity',
      source_provenance_summary: [{ provenance: 'payout', cents: 50_000 }],
      earliest_credit_at: PAST.toISOString(),
    });
    // `wallet.debited` HAS NO `provenance` AND THE REGISTRY SAYS WHY: a debit
    // consumes a composition rather than having one, and the composition it
    // destroys is reported by the row above it.
    expect(emitted[1]?.payload).toEqual({
      identity_id: ALICE,
      amount_cents: 50_000n,
      cause: WITHDRAWAL_DEBIT_CAUSE,
      reference_id: WITHDRAWAL_A,
      balance_after_cents: 70_000n,
      ledger_transaction_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(emitted[1]?.payload).not.toHaveProperty('provenance');
  });

  it('both payloads are the registry rows, field for field', () => {
    const events = readFileSync(
      fileURLToPath(new URL('../../../docs/architecture/EVENTS.md', import.meta.url)),
      'utf8',
    );
    // Read out of the document rather than restated, which is ADR-159 clause 1:
    // the authority for a name and its fields is the registry.
    expect(events).toContain(
      '`{ withdrawal_id, identity_id, amount_cents, destination_name_match, name_match_score, ' +
        'name_match_method, source_provenance_summary, earliest_credit_at }`',
    );
    expect(events).toContain(
      '`{ identity_id, amount_cents, cause, reference_id, balance_after_cents, ' +
        'ledger_transaction_id }`',
    );
  });

  it('cents cross the event boundary as `bigint`, so a sink that cannot serialise raises', async () => {
    const { io, emitted } = wiredIo(HAPPY);
    await runWithdrawalApprovals(io);
    expect(typeof emitted[0]?.payload['amount_cents']).toBe('bigint');
    expect(() => JSON.stringify(emitted[0]?.payload)).toThrow(TypeError);
  });
});

// =============================================================================
// 7. THE CENSUS. ADR-316 section 6's duplication cost, paid into an assertion
// =============================================================================
// **THIS IS THE CASE THE REFUSAL BOUGHT.** `decideApproval` does not move, so the
// approval predicate is stated TWICE, and the drift direction that costs is the
// one nobody watches: this sweep is the only live writer of the approval edge,
// so a term tightened in `apps/api` alone changes nothing and the tree gives no
// sign, while a term dropped HERE approves a withdrawal for a restricted
// identity, an unverified one or a halted row.

describe('7. the approval predicate stands at exactly two statements', () => {
  /** The hold names a `decide*` function returns, in the order it evaluates them. */
  const evaluationOrder = (text: string, declaration: string): readonly string[] => {
    const start = text.indexOf(declaration);
    expect(start, declaration).toBeGreaterThan(-1);
    // `\n}\n` AND NOT `\n}`. Both declarations open with an inline argument
    // object, so `}): ApprovalDecision {` closes a brace at the start of a line
    // BEFORE the body begins, and the shorter marker slices the signature and
    // reports an empty list on two functions that both have terms.
    const end = text.indexOf('\n}\n', start);
    return [...text.slice(start, end).matchAll(/hold: '([a-z_]+)'/g)].map(
      (match) => match[1] ?? '',
    );
  };

  const route = source(ROUTE_TS);
  const driver = source(DRIVER_TS);

  it('there are two statements and no third, and both files are named', () => {
    const deciders = [...walkSrc(), fileURLToPath(new URL(ROUTE_TS, import.meta.url))]
      .filter((path) =>
        /\bhold: 'destination_cooling'/.test(stripComments(readFileSync(path, 'utf8'))),
      )
      .map((path) => path.slice(path.indexOf('apps/')))
      .sort();
    expect(deciders).toEqual([
      'apps/api/src/routes/wallet-withdrawals.ts',
      'apps/worker/src/withdrawals/approval-sweep.ts',
    ]);
  });

  it('the seven shared terms are evaluated in the identical order in both', () => {
    const shared = [
      'not_approvable',
      'identity_not_active',
      'payouts_frozen',
      'kyc_not_verified',
      'halted',
      'provenance_missing',
      'destination_cooling',
    ];
    // EACH IS THE SEVEN PLUS ITS OWN EIGHTH, AND THE EIGHTHS ARE DIFFERENT
    // TERMS. The route's is `dual_control_required`, which a clock can never
    // reach because `dualControlRequired` returns `false` for a null hand; the
    // driver's is `insufficient_position`, which the route has no need of
    // because `driveApprovals` posts nothing and therefore debits nothing.
    expect(evaluationOrder(route, 'export function decideApproval(args: {')).toEqual([
      ...shared,
      'dual_control_required',
    ]);
    expect(evaluationOrder(driver, 'export function decideMachineApproval(args: {')).toEqual([
      ...shared,
      'insufficient_position',
    ]);
  });

  it('the worker carries no dual-control token and the route carries one', () => {
    for (const token of [
      'dual_control_required',
      'DUAL_CONTROL_THRESHOLD_CENTS',
      'dualControlRequired',
      'ApprovalHand',
    ])
      expect(stripComments(driver), token).not.toContain(token);
    expect(route).toContain('dual_control_required');
    expect(route).toContain('DUAL_CONTROL_THRESHOLD_CENTS');
    // AND THE EIGHTH TERM IS UNREACHABLE FROM A CLOCK RATHER THAN OMITTED:
    // `dualControlRequired` returns `false` for a null hand on its first line.
    expect(route).toContain('if (hand === null) return false;');
  });

  it('the route has no live caller and this driver is not one', () => {
    // `grep -rn driveApprovals apps/api/src` RETURNS THREE LINES AND NO FOURTH
    // IS A CALLER, which is ADR-305 section 4's measurement and the thing that
    // tells a reader the door is not in that deployable. It is re-derived here
    // rather than carried.
    const mentions: string[] = [];
    const routes = fileURLToPath(new URL('../../api/src', import.meta.url));
    for (const entry of readdirSync(routes, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const text = readFileSync(join(entry.parentPath, entry.name), 'utf8');
      for (const line of text.split('\n')) if (line.includes('driveApprovals')) mentions.push(line);
    }
    expect(mentions).toHaveLength(3);
    // ONE DECLARATION AND TWO DOCBLOCK REFERENCES. A fourth line that called it
    // would be a door in `apps/api` onto an edge that deployable cannot post.
    expect(
      mentions.filter((line) => line.includes('export async function driveApprovals(')),
    ).toHaveLength(1);
    expect(mentions.filter((line) => line.trimStart().startsWith('*'))).toHaveLength(2);

    // AND THE DRIVER DOES NOT IMPORT FROM `apps/api` AT ALL: the two deployables
    // cannot import each other, and a relative specifier is the move a wiring
    // session under pressure reaches for.
    expect(driver).not.toMatch(/from\s+'\.\.\/\.\.\/\.\.\/api/);
  });
});
