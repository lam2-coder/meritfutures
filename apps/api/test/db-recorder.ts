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

/** Which door one call was made through. ADR-200 added two and ADR-231 the last. */
export type DbDoor = 'scoped' | 'firm' | 'resolution' | 'establishment' | 'publicLookup';

/** One accessor call, as this file records it. */
export interface DbCall {
  readonly door: DbDoor;
  /** The identity the SCOPED door was opened with. Absent on every other door. */
  readonly identityId?: string;
  readonly verb:
    | 'lockScope'
    | 'rows'
    | 'rowsWhere'
    | 'rowAt'
    | 'updateAt'
    | 'deleteAt'
    | 'insert'
    | 'insertUnder'
    | 'establish';
  /**
   * The table named. `establish` names none: the door's whole point is that a
   * caller cannot choose, so the recorder writes the ACT rather than a key.
   * `lockScope` names none either, for the opposite reason: it TAKES NO
   * ARGUMENT, so the only fact there is to record is that it was called, and
   * the row it locks is the handle's own identity.
   */
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
  readonly insertUnder?: unknown[];
  /**
   * What `lockScope` answers.
   *
   * IT ANSWERS A ROW BECAUSE THE ACCESSOR DOES. `ScopedTx.lockScope` is a
   * locking select over `identities` and hands back the row it locked
   * (`packages/db/src/scoped-db.ts`), so a recorder that answered `undefined`
   * unconditionally would make "the adapter discards it" unfalsifiable.
   */
  readonly locks?: unknown;
  /** What the RESOLUTION door answers. `undefined` is "nobody holds this address". */
  readonly resolvesTo?: unknown;
  /** What the PUBLIC LOOKUP door answers. `undefined` is "no row carries this code". */
  readonly publiclyLooksUpTo?: unknown;
  /** What `establish` answers, and what it throws instead. */
  readonly establishes?: unknown;
  readonly establishThrows?: unknown;
  /** Called before `establish` answers, so a suite can watch an interleaving. */
  readonly onEstablish?: () => void;
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
/**
 * The two ADR-200 doors, for a fixture whose subject cannot reach them.
 *
 * THEY REJECT RATHER THAN RETURNING SOMETHING EMPTY. Every adapter but
 * `databaseAuthBackend` takes an `ApiDb` and opens two of its four doors, and a
 * fixture that answered `undefined` from the pre-identity read would let a
 * wallet or catalogue adapter quietly acquire a capability its own suite is
 * asserting it does not use. A rejection names the file and the door.
 */
export const NO_PRE_IDENTITY_DOORS: Pick<ApiDb, 'resolution' | 'establishment' | 'publicLookup'> = {
  resolution: () =>
    Promise.reject(
      new Error('this fixture opens no resolution door: its subject resolves no address'),
    ),
  establishment: () =>
    Promise.reject(
      new Error('this fixture opens no establishment door: its subject creates no identity'),
    ),
  // ADR-231's door is a THIRD member and it is NEVER-identity rather than
  // pre-identity, so the constant's name is now one word wider than its
  // contents. IT IS NOT RENAMED, and that is a deliberately small decision:
  // five suites spread this object and none of them names the door, so a rename
  // would put this slice's diff into four files it has no other business in
  // while changing nothing any fixture asserts. What the set MEANS is "every
  // door that opens without a session", and all three members are that.
  publicLookup: () =>
    Promise.reject(
      new Error('this fixture opens no public lookup door: its subject reads no published token'),
    ),
};

export function recordingDb(replies: Replies = {}): Recorder {
  const calls: DbCall[] = [];

  const handle = (door: DbDoor, identityId?: string): unknown => {
    const note = (call: DbCall): void => {
      calls.push(identityId === undefined ? call : { ...call, identityId });
    };
    return {
      __brand: door === 'scoped' ? 'ScopedTx' : 'FirmTx',
      identityId,
      sqlExecutor: () => {
        throw new Error('the recorder offers no sqlExecutor: no adapter here may reach for one');
      },
      // ADR-157's per-identity row lock. IT TAKES NO ARGUMENT AND RECORDS NO
      // KEY, which is the honest shape: what an `apps/api` suite can assert
      // here is THAT the adapter took the lock and IN WHAT ORDER, and whether
      // the `FOR UPDATE` really blocks a second transaction is `packages/db`'s
      // and is asserted there against a real database.
      lockScope: () => {
        note({ door, verb: 'lockScope', key: '' });
        return Promise.resolve(replies.locks);
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
      insertUnder: (key: string, values: unknown) => {
        note({ door, verb: 'insertUnder', key, values });
        return Promise.resolve(replies.insertUnder ?? []);
      },
      // THE ESTABLISHMENT DOOR'S ONE VERB. It takes an ADDRESS and no values,
      // which is ADR-196 clause 3 made structural in `packages/db`, so this
      // records the address under `address` and leaves `values` absent: a
      // recorder that offered a values slot here would be inviting a suite to
      // assert on a parameter the real door does not have.
      establish: (at: unknown) => {
        note({ door, verb: 'establish', key: 'identities+users', address: at });
        replies.onEstablish?.();
        if (replies.establishThrows !== undefined) return Promise.reject(replies.establishThrows);
        return Promise.resolve(replies.establishes);
      },
    };
  };

  const db: ApiDb = {
    scoped: <T>(identityId: string, fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(handle('scoped', identityId) as never),
    firm: <T>(fn: (tx: never) => Promise<T>): Promise<T> => fn(handle('firm') as never),
    // THE RESOLUTION HANDLE ANSWERS `rowAt` AND NOTHING ELSE, which is the whole
    // of `ResolutionDb`. A suite asserting that the address named was `email`
    // and the table `users` is asserting an `apps/api` property; that the
    // predicate reaches one row is `packages/db`'s and is not simulated here.
    resolution: <T>(fn: (rx: never) => Promise<T>): Promise<T> => {
      const rx = {
        __brand: 'ResolutionDb',
        rowAt: (key: string, at: unknown) => {
          calls.push({ door: 'resolution', verb: 'rowAt', key, address: at });
          return Promise.resolve(replies.resolvesTo);
        },
      };
      return fn(rx as never);
    },
    establishment: <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
      fn(handle('establishment') as never),
    // THE PUBLIC LOOKUP HANDLE ANSWERS `rowAt` AND NOTHING ELSE, which is the
    // whole of `PublicLookupDb` (ADR-231). It is a SEPARATE literal from the
    // resolution one rather than a shared handle with two brands, because the
    // property a suite asserts here is WHICH DOOR was opened: the two doors
    // reach different tables by different columns and a recorder that answered
    // both from one object could not tell a caller that opened the wrong one.
    // That the predicate reaches one row is `packages/db`'s and is not
    // simulated here.
    publicLookup: <T>(fn: (px: never) => Promise<T>): Promise<T> => {
      const px = {
        __brand: 'PublicLookupDb',
        rowAt: (key: string, at: unknown) => {
          calls.push({ door: 'publicLookup', verb: 'rowAt', key, address: at });
          return Promise.resolve(replies.publiclyLooksUpTo);
        },
      };
      return fn(px as never);
    },
  };

  return { db, calls };
}
