// =============================================================================
// packages/ledger/test/recording-tx.ts
// =============================================================================
// A `LedgerTx` THAT RECORDS INSTEAD OF WRITING.
//
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block, so there is no Postgres in CI and a suite that needed one would report
// nothing. ADR-102 met the same wall and answered it by asserting the SQL its
// accessor BUILDS; this package builds no SQL at all -- it calls ADR-102's
// writer -- so what there is to assert is the SEQUENCE OF CALLS, exactly, in
// order, with the values each one carried.
//
// THAT IS NOT A SUBSTITUTE FOR THE ROUND TRIP AND THE ENTRY SAYS SO. What this
// cannot see is whether Postgres accepts the rows, which is why ADR-104 section
// on the executed round trip exists and why it is reported as evidence rather
// than claimed as a control.

import type { LedgerReadKey, LedgerTx, LedgerWriteKey, WriteValues } from '../src/tx.ts';

export interface RecordedInsert {
  readonly key: LedgerWriteKey;
  readonly values: WriteValues;
}

export class RecordingTx implements LedgerTx {
  readonly inserts: RecordedInsert[] = [];
  readonly reads: LedgerReadKey[] = [];

  private nextId = 1;

  constructor(
    private readonly accounts: readonly Record<string, unknown>[] = [],
    private readonly halts: readonly Record<string, unknown>[] = [],
  ) {}

  rows(key: LedgerReadKey): Promise<unknown[]> {
    this.reads.push(key);
    return Promise.resolve([...(key === 'ledgerAccounts' ? this.accounts : this.halts)]);
  }

  insert(key: LedgerWriteKey, values: WriteValues): Promise<unknown[]> {
    this.inserts.push({ key, values });
    // The accessor calls `.returning()` on every statement, so a row comes back.
    // `ledger_entries.id` is a generated bigint and `ledger_transactions.id` a
    // uuid default; both are read back as `id` and only the transaction's is used.
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
    return Promise.resolve([{ ...values, id }]);
  }

  /** Every `ledger_entries` row this transaction was asked to write. */
  entryRows(): readonly WriteValues[] {
    return this.inserts.filter((i) => i.key === 'ledgerEntries').map((i) => i.values);
  }

  /** The aggregate `PT-03` measures: the net of every entry written, in integer cents. */
  netCentsWritten(): bigint {
    let net = 0n;
    for (const row of this.entryRows()) {
      const amount = row['amountCents'];
      if (typeof amount !== 'bigint') {
        throw new TypeError(
          `an entry was written with amountCents as a ${typeof amount}. Money is integer ` +
            'cents as a bigint on this path and nothing else is admissible.',
        );
      }
      net += amount;
    }
    return net;
  }
}

/** A chart row shaped the way Drizzle returns one, for `readChart` to index. */
export function accountRow(
  id: string,
  code: string,
  scope: 'firm' | 'identity',
  identityId: string | null = null,
): Record<string, unknown> {
  return { id, code, scope, identityId, createdAt: new Date(0) };
}

/** A `ledger_halts` row, live unless `releasedAt` is given. */
export function haltRow(
  id: string,
  identityId: string,
  releasedAt: Date | null = null,
): Record<string, unknown> {
  return {
    id,
    identityId,
    reasonCode: 'position_mismatch',
    reasonNote: 'seeded by the suite',
    evidence: {},
    haltedAt: new Date(0),
    haltedBy: 'test',
    escalateAt: new Date(1),
    escalatedAt: null,
    releasedAt,
    releasedBy: null,
    releaseNote: null,
    createdAt: new Date(0),
  };
}
