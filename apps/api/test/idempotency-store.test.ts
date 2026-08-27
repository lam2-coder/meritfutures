import { expect, test } from 'vitest';

import { databaseIdempotencyStore } from '../src/idempotency-store.ts';
import {
  IdempotencyError,
  UNOWNED_SCOPE,
  beginIdempotent,
  identityScope,
  requestHash,
} from '../src/idempotency.ts';
import type { IdempotencyRecord } from '../src/idempotency.ts';
import { recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project. ADR-120, discharging ADR-109 clause 3 for ONE of
// the table's two populations.
//
// `idempotency.ts`'s header states what an implementation of this port must do:
// "EVERY METHOD TAKES THE SCOPE AND THE KEY, WHICH IS THE WHOLE POINT. An
// implementation of this interface must name ONE ROW." These cases assert that
// each method does name one, through the scoped door, with the identity the
// scope carried; and that the arm the accessor cannot reach REFUSES rather than
// answering.

const ALICE = identityScope('11111111-1111-4111-8111-111111111111');
const KEY = '/checkout:tok_1';
const HASH = requestHash(new TextEncoder().encode('{"a":1}'));

function record(over: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    key: KEY,
    endpoint: '/checkout',
    requestHash: HASH,
    responseStatus: null,
    responseBody: null,
    ...over,
  };
}

/** An `idempotency_keys` row as the accessor hands one back. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: KEY,
    identityId: ALICE.identityId,
    endpoint: '/checkout',
    requestHash: Buffer.from(HASH),
    responseStatus: null,
    responseBody: null,
    createdAt: new Date('2026-08-27T12:00:00.000Z'),
    ...over,
  };
}

// -----------------------------------------------------------------------------
// The identity arm
// -----------------------------------------------------------------------------

test('find names ONE row through the scoped door, addressed by the primary key', async () => {
  const { db, calls } = recordingDb({ rowAt: row() });
  const found = await databaseIdempotencyStore(db).find(ALICE, KEY);

  expect(calls).toEqual([
    {
      door: 'scoped',
      identityId: ALICE.identityId,
      verb: 'rowAt',
      key: 'idempotencyKeys',
      address: { key: KEY },
    },
  ]);
  // THE ADDRESS IS `{ key }` AND NOT `{ key, identityId }`, and that is not a
  // tidiness choice: `refusePinnedColumn` RAISES on a caller naming a column the
  // handle supplies. The composed predicate is `identity_id = $1 AND key = $2`,
  // which is ADR-112 clause 3 -- the handle pins the tenancy, the caller names
  // the row, and both halves reach the database.
  expect(found?.key).toBe(KEY);
  expect(found?.endpoint).toBe('/checkout');
  expect(found?.responseStatus).toBeNull();
});

test('a row this scope cannot see reads as null, which `begin` is what disambiguates', async () => {
  const { db } = recordingDb({ rowAt: undefined });
  expect(await databaseIdempotencyStore(db).find(ALICE, KEY)).toBeNull();
});

test('begin claims the key and writes NO identity, because the accessor stamps it', async () => {
  const { db, calls } = recordingDb({ insert: [row()] });
  expect(await databaseIdempotencyStore(db).begin(ALICE, record())).toBe('inserted');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.verb).toBe('insert');
  expect(calls[0]?.door).toBe('scoped');
  expect(calls[0]?.identityId).toBe(ALICE.identityId);
  // ADR-102 clause 4: `scopedInsertStatement` stamps the tenancy column and
  // `refuseTenancyColumn` raises on a caller that named it. A `values` object
  // carrying `identityId` would not be redundant, it would throw.
  expect(Object.keys(calls[0]?.values as object)).not.toContain('identityId');
  expect(calls[0]?.values).toEqual({
    key: KEY,
    endpoint: '/checkout',
    requestHash: Buffer.from(HASH),
    responseStatus: null,
    responseBody: null,
  });
});

test('a primary-key collision is `exists` and is read off the SQLSTATE', async () => {
  // THE RACE IS RESOLVED BY THE DATABASE AND NOT BY A READ, which is the port's
  // own sentence: a `find` that returned nothing and an insert that lands are
  // two statements, and between them a concurrent request carrying the same key
  // can win. The loser's statement aborts its transaction and arrives here as an
  // error carrying `23505`.
  const violation = Object.assign(new Error('duplicate key value'), { code: '23505' });
  const { db } = recordingDb({ insertThrows: violation });
  expect(await databaseIdempotencyStore(db).begin(ALICE, record())).toBe('exists');
});

test('a collision reported through a wrapper is still read', async () => {
  // A query error may arrive with the driver's own as its `cause`, and the
  // driver is deliberately NOT imported to get the type: `merit/no-raw-db-client`
  // bans a `pg` import in `apps/**` and this file's package has no business
  // being the exception.
  const wrapped = Object.assign(new Error('query failed'), {
    cause: Object.assign(new Error('duplicate key value'), { code: '23505' }),
  });
  const { db } = recordingDb({ insertThrows: wrapped });
  expect(await databaseIdempotencyStore(db).begin(ALICE, record())).toBe('exists');
});

test('any other database error is rethrown and never read as `exists`', async () => {
  // THE DIRECTION THAT DESTROYS. Treating an arbitrary failure as `exists` would
  // make `beginIdempotent` fall through to its second read, find nothing, and
  // answer `key_held_elsewhere` -- a 409 for a request that never touched the
  // table, on the checkout path.
  const other = Object.assign(new Error('connection terminated'), { code: '57P01' });
  const { db } = recordingDb({ insertThrows: other });
  await expect(databaseIdempotencyStore(db).begin(ALICE, record())).rejects.toThrow(
    'connection terminated',
  );
});

test('complete stamps THAT ONE row and raises when the write lands nowhere', async () => {
  const written = recordingDb({ updateAt: [row({ responseStatus: 201 })] });
  await databaseIdempotencyStore(written.db).complete(ALICE, KEY, 201, { id: 'p_1' });
  expect(written.calls).toEqual([
    {
      door: 'scoped',
      identityId: ALICE.identityId,
      verb: 'updateAt',
      key: 'idempotencyKeys',
      address: { key: KEY },
      values: { responseStatus: 201, responseBody: { id: 'p_1' } },
    },
  ]);

  // ZERO ROWS IS RAISED AND NEVER SWALLOWED. The caller reached `complete`
  // holding a `'fresh'` outcome, so this scope inserted this key moments ago.
  // Returning quietly would leave a claimed key with no response on it, and
  // every later delivery of the same request would answer 409 forever.
  const nowhere = recordingDb({ updateAt: [] });
  await expect(
    databaseIdempotencyStore(nowhere.db).complete(ALICE, KEY, 201, { id: 'p_1' }),
  ).rejects.toThrow(IdempotencyError);
});

test('a row that reads back malformed raises rather than being coerced', async () => {
  // `request_hash` is what the contract's two branches -- replay verbatim, or
  // 409 -- both hang off, so a row whose digest did not read back as bytes must
  // not become a comparison against something else.
  const { db } = recordingDb({ rowAt: row({ requestHash: 'not-bytes' }) });
  await expect(databaseIdempotencyStore(db).find(ALICE, KEY)).rejects.toThrow(IdempotencyError);

  const noStatus = recordingDb({ rowAt: row({ responseStatus: 'two hundred' }) });
  await expect(databaseIdempotencyStore(noStatus.db).find(ALICE, KEY)).rejects.toThrow(
    IdempotencyError,
  );
});

test('the store drives the protocol end to end for a replay', async () => {
  // Through `beginIdempotent` rather than through the store directly, because
  // the protocol is what a handler calls and the store is what it calls in turn.
  const { db } = recordingDb({
    rowAt: row({ responseStatus: 202, responseBody: { sent: true } }),
  });
  const outcome = await beginIdempotent(
    databaseIdempotencyStore(db),
    ALICE,
    '/checkout',
    'tok_1',
    new TextEncoder().encode('{"a":1}'),
  );
  expect(outcome.kind).toBe('replay');
  expect(outcome).toMatchObject({ status: 202, body: { sent: true } });
});

// -----------------------------------------------------------------------------
// The unowned arm, which is a FINDING and not a stage of the work
// -----------------------------------------------------------------------------

test('all three methods refuse the unowned scope, and none opens a door', async () => {
  // ADR-109 clause 4 makes `UnownedScope` a distinct type because the database
  // already holds two populations: `idempotency_keys_identity_idx` is PARTIAL on
  // `identity_id IS NOT NULL`. Its row is reached by `key = $1 AND identity_id
  // IS NULL`, and no door renders it: the scoped door needs an identity the row
  // has not got, the firm door refuses an `owned` table, `SystemReason` is a
  // two-word vocabulary a request handler is not in, and an address is EQUALITY
  // ONLY so `IS NULL` is unwritable at every authority.
  const { db, calls } = recordingDb({ rowAt: row() });
  const store = databaseIdempotencyStore(db);

  await expect(store.find(UNOWNED_SCOPE, KEY)).rejects.toThrow(IdempotencyError);
  await expect(store.begin(UNOWNED_SCOPE, record())).rejects.toThrow(IdempotencyError);
  await expect(store.complete(UNOWNED_SCOPE, KEY, 202, {})).rejects.toThrow(IdempotencyError);
  expect(calls).toEqual([]);
});

test('the unowned arm RAISES rather than answering null, which would be worse', async () => {
  // A `find` answering `null` here is indistinguishable from "no such row", and
  // the caller would then run the handler again -- which is the duplicate effect
  // this whole layer exists to prevent, arriving through the layer's own
  // silence. The refusal names the missing construction so a 500 says what is
  // missing.
  const { db } = recordingDb();
  const err: unknown = await databaseIdempotencyStore(db)
    .find(UNOWNED_SCOPE, KEY)
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err).toBeInstanceOf(IdempotencyError);
  expect((err as Error).message).toContain('IS NULL');
  expect((err as Error).message).toContain('equality only');
});
