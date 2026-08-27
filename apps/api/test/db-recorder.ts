// =============================================================================
// apps/api/test/db-recorder.ts
// =============================================================================
// THE SEAM `db.ts` EXISTS FOR, AND AN HONEST STATEMENT OF WHAT IT PROVES.
//
// `transaction()` opens a real connection out of a real pool and `client()`
// throws when `DATABASE_URL` is unset, so an adapter in this deployable is
// testable only against a live database or against this. `ci.yml`'s
// `integration` job has no database (ADR-102 section 16, ADR-112 section 9), so
// it is this.
//
// WHAT A RECORDER PROVES: WHICH DOOR was opened, WHOSE IDENTITY was handed to
// it, WHICH TABLE was named, WHAT ADDRESS was written, and WHAT VALUES were set.
// Every one of those is a property of `apps/api` and every one of them fails in
// the direction ADR-008 was accepted for.
//
// WHAT IT PROVES NOTHING ABOUT: whether the composed predicate reaches one row
// or many. That is `packages/db`'s and is asserted in
// `packages/db/test/keyed-accessor.test.ts`, watched failing there on eight
// seeded mutations. A case here that claimed it would be agreeing with its own
// fake, which is ADR-084 section 7's defect and is exactly the thing this file
// must not do. ADR-120's approval clause runs the other half against a real
// PostgreSQL.
// =============================================================================

import type { ApiDb } from '../src/db.ts';

/** One accessor call, as this file records it. */
export interface DbCall {
  readonly door: 'scoped' | 'firm';
  /** The identity the SCOPED door was opened with. Absent on the firm door. */
  readonly identityId?: string;
  readonly verb: 'rows' | 'rowsWhere' | 'rowAt' | 'updateAt' | 'deleteAt' | 'insert';
  readonly key: string;
  readonly address?: unknown;
  readonly values?: unknown;
}

/** What each verb hands back, and what `insert` throws instead. */
export interface Replies {
  readonly rows?: unknown[];
  readonly rowAt?: unknown;
  readonly rowsWhere?: unknown[];
  readonly updateAt?: unknown[];
  readonly deleteAt?: unknown[];
  readonly insert?: unknown[];
  readonly insertThrows?: unknown;
}

export interface Recorder {
  readonly db: ApiDb;
  readonly calls: DbCall[];
}

/**
 * A pair of doors that record rather than connect.
 *
 * THE HANDLE IS CAST AND THE CAST IS THE HONEST SHAPE HERE. `ScopedTx` and
 * `FirmTx` are branded interfaces with six methods and a `sqlExecutor`, and a
 * fixture implementing all of them faithfully would be a second accessor: the
 * thing this file must never become. What is recorded is the CALL, so the cast
 * is the boundary between "what apps/api did" and "what packages/db would have
 * done with it", and the second half is not this file's to simulate.
 */
export function recordingDb(replies: Replies = {}): Recorder {
  const calls: DbCall[] = [];

  const handle = (door: 'scoped' | 'firm', identityId?: string): unknown => {
    const note = (call: DbCall): void => {
      calls.push(identityId === undefined ? call : { ...call, identityId });
    };
    return {
      __brand: door === 'scoped' ? 'ScopedTx' : 'FirmTx',
      identityId,
      sqlExecutor: () => {
        throw new Error('the recorder offers no sqlExecutor: no adapter here may reach for one');
      },
      rows: (key: string) => {
        note({ door, verb: 'rows', key });
        return Promise.resolve(replies.rows ?? []);
      },
      rowsWhere: (key: string, address: unknown) => {
        note({ door, verb: 'rowsWhere', key, address });
        return Promise.resolve(replies.rowsWhere ?? []);
      },
      rowAt: (key: string, address: unknown) => {
        note({ door, verb: 'rowAt', key, address });
        return Promise.resolve(replies.rowAt);
      },
      updateAt: (key: string, address: unknown, values: unknown) => {
        note({ door, verb: 'updateAt', key, address, values });
        return Promise.resolve(replies.updateAt ?? []);
      },
      deleteAt: (key: string, address: unknown) => {
        note({ door, verb: 'deleteAt', key, address });
        return Promise.resolve(replies.deleteAt ?? []);
      },
      insert: (key: string, values: unknown) => {
        note({ door, verb: 'insert', key, values });
        if (replies.insertThrows !== undefined) return Promise.reject(replies.insertThrows);
        return Promise.resolve(replies.insert ?? []);
      },
    };
  };

  const db: ApiDb = {
    scoped: <T>(identityId: string, fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(handle('scoped', identityId) as never),
    firm: <T>(fn: (tx: never) => Promise<T>): Promise<T> => fn(handle('firm') as never),
  };

  return { db, calls };
}
