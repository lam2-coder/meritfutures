// =============================================================================
// packages/enrichment/test/recording-tx.ts
// =============================================================================
// AN `EnrichmentTx` THAT RECORDS WHAT WAS WRITTEN THROUGH IT.
//
// `packages/ledger/test/recording-tx.ts`'s shape and its argument: the accessor
// itself is asserted in `packages/db`'s own suite, so what this package owes is
// evidence about WHICH rows it asks for and in what order, and a handle that
// remembers is how that becomes an assertion instead of a mock framework.
//
// IT MODELS ONE IDENTITY, which is what a `ScopedTx` is. There is no
// `identity_id` anywhere in here for the same reason there is none in the
// values `observe.ts` passes: the real handle stamps it and refuses a caller
// that names it.
//
// IT CAN BE MADE TO FAIL, because the `record_failed` direction is one of the
// ones the approval line is written about and a suite that could not produce a
// failing write could not watch it.

import type { EnrichmentTx, RowAddress, RowFilter, WriteValues } from '../src/tx.ts';

/** One call, as it arrived. */
export interface RecordedWrite {
  readonly op: 'insert' | 'updateAt';
  readonly key: string;
  readonly values: WriteValues;
  readonly at?: RowAddress;
}

/** One call to the read path. */
export interface RecordedRead {
  readonly key: string;
  readonly where: RowFilter;
}

/** A stored `identity_signals` row, in the columns this package reads back. */
interface StoredSignal {
  id: string;
  kind: string;
  valueHashHex: string;
  observationCount: number;
}

export interface RecordingTx extends EnrichmentTx {
  readonly writes: readonly RecordedWrite[];
  readonly reads: readonly RecordedRead[];
  /** Every `identity_signals` row this handle holds, so a repeat can be watched. */
  readonly signals: readonly Readonly<StoredSignal>[];
}

/** Bytes to a stable key, because a `Uint8Array` is not comparable by value. */
function hex(value: unknown): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  return `not-bytes:${String(value)}`;
}

export interface RecordingTxOptions {
  /** Fail every write to this table, the way a constraint violation would. */
  readonly failWritesTo?: string;
}

/**
 * A transaction handle that keeps what it was told.
 *
 * THE READ IS AN EQUALITY CONJUNCTION AND NOTHING ELSE, which is ADR-112's
 * `RowFilter` honoured rather than approximated: this handle answers `kind` and
 * `valueHash` because those are the two columns `observe.ts` filters on, and it
 * throws on a column it was not built to answer rather than returning
 * everything, so a widened filter fails here instead of silently matching.
 */
export function recordingTx(options: RecordingTxOptions = {}): RecordingTx {
  const writes: RecordedWrite[] = [];
  const reads: RecordedRead[] = [];
  const signals: StoredSignal[] = [];
  let nextId = 1;

  const refuseIfFailing = (key: string): void => {
    if (options.failWritesTo === key) {
      throw new Error(`duplicate key value violates a unique constraint on ${key}`);
    }
  };

  return {
    writes,
    reads,
    signals,

    rowsWhere(key, where): Promise<unknown[]> {
      reads.push({ key, where });
      const named = Object.keys(where).sort();
      if (named.join(',') !== 'kind,valueHash') {
        throw new Error(
          `this handle answers a filter on (kind, valueHash) and was given [${named.join(', ')}]. ` +
            'A widened filter fails here rather than silently matching.',
        );
      }
      const wantedHash = hex(where['valueHash']);
      return Promise.resolve(
        signals
          .filter((row) => row.kind === where['kind'] && row.valueHashHex === wantedHash)
          .map((row) => ({ id: row.id, observationCount: row.observationCount })),
      );
    },

    insert(key, values): Promise<unknown[]> {
      refuseIfFailing(key);
      writes.push({ op: 'insert', key, values });
      if (key === 'identitySignals') {
        const id = `signal-${nextId}`;
        nextId += 1;
        signals.push({
          id,
          kind: String(values['kind']),
          valueHashHex: hex(values['valueHash']),
          observationCount: Number(values['observationCount']),
        });
        return Promise.resolve([{ id }]);
      }
      return Promise.resolve([{}]);
    },

    updateAt(key, at, values): Promise<unknown[]> {
      refuseIfFailing(key);
      writes.push({ op: 'updateAt', key, at, values });
      const row = signals.find((candidate) => candidate.id === at['id']);
      if (row === undefined) return Promise.resolve([]);
      row.observationCount = Number(values['observationCount']);
      return Promise.resolve([{ id: row.id }]);
    },
  };
}
