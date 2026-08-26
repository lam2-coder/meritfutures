import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  IDEMPOTENCY_KEY_REUSE,
  IdempotencyError,
  UNOWNED_SCOPE,
  beginIdempotent,
  completeIdempotent,
  identityScope,
  problemForOutcome,
  requestHash,
  storedKey,
} from '../src/idempotency.ts';
import type {
  IdempotencyOutcome,
  IdempotencyRecord,
  IdempotencyScope,
  IdempotencyStore,
} from '../src/idempotency.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. `idempotency.ts` implements no SQL: the store is a
// port, because no accessor in `packages/db` can name a row (ADR-109). So the
// thing that CAN be asserted here is the whole of what the layer decides, and
// the assertions below are the specification API_CONTRACT section 1 states in
// prose, executed.
//
// THE STORE BELOW IS A FAKE AND NOT A STUB, and the difference is the primary
// key. `idempotency_keys.key text PRIMARY KEY` carries NO identity, so a fake
// that kept one map per scope would be a fake in which the schema's own
// cross-scope collision cannot happen -- and that collision is an outcome this
// layer reports by name. So the fake holds ONE map keyed by the primary key,
// exactly as the table does, and applies the scope predicate on read.

interface StoredRow {
  readonly scope: IdempotencyScope;
  record: IdempotencyRecord;
}

/** One `idempotency_keys` table, with the schema's own key structure. */
class FakeStore implements IdempotencyStore {
  /** Keyed by the PRIMARY KEY, which is the stored key alone. */
  readonly rows = new Map<string, StoredRow>();

  /** Every `complete` this store was asked for, so over-writes are countable. */
  readonly completions: string[] = [];

  /** Set to run a concurrent insert between `find` and `begin`. */
  onBegin: ((key: string) => void) | undefined;

  find(scope: IdempotencyScope, key: string): Promise<IdempotencyRecord | null> {
    const row = this.rows.get(key);
    if (row === undefined) return Promise.resolve(null);
    // `identity_id = $1` for the identity arm, `identity_id IS NULL` for the
    // other. A NULL row never equals an identity and an identity row is not
    // NULL, so the two populations are disjoint, which is what `scope.ts`'s
    // rule says the nullability is for.
    return Promise.resolve(sameScope(row.scope, scope) ? row.record : null);
  }

  begin(scope: IdempotencyScope, record: IdempotencyRecord): Promise<'inserted' | 'exists'> {
    this.onBegin?.(record.key);
    if (this.rows.has(record.key)) return Promise.resolve('exists');
    this.rows.set(record.key, { scope, record });
    return Promise.resolve('inserted');
  }

  complete(scope: IdempotencyScope, key: string, status: number, body: unknown): Promise<void> {
    this.completions.push(key);
    const row = this.rows.get(key);
    if (row === undefined || !sameScope(row.scope, scope)) {
      throw new Error(`complete named no row: ${key}`);
    }
    row.record = {
      ...row.record,
      responseStatus: status,
      responseBody: body as IdempotencyRecord['responseBody'],
    };
    return Promise.resolve();
  }
}

function sameScope(a: IdempotencyScope, b: IdempotencyScope): boolean {
  if (a.kind === 'identity' && b.kind === 'identity') return a.identityId === b.identityId;
  return a.kind === 'unowned' && b.kind === 'unowned';
}

const CHECKOUT = '/checkout';
const BODY_A = new TextEncoder().encode('{"plan_version_size_id":"pvs_1"}');
const BODY_B = new TextEncoder().encode('{"plan_version_size_id":"pvs_2"}');
const ALICE = identityScope('11111111-1111-4111-8111-111111111111');
const BOB = identityScope('22222222-2222-4222-8222-222222222222');

/** `'fresh'`, narrowed, because `completeIdempotent` accepts nothing else. */
function fresh(outcome: IdempotencyOutcome): Extract<IdempotencyOutcome, { kind: 'fresh' }> {
  if (outcome.kind !== 'fresh') throw new Error(`expected fresh, got ${outcome.kind}`);
  return outcome;
}

describe('the stored key is the DDL comment and not an invention', () => {
  test('it is the endpoint prefix and the client token', () => {
    expect(storedKey(CHECKOUT, 'tok_1')).toBe('/checkout:tok_1');
  });

  test('the same token on two endpoints is two keys', () => {
    expect(storedKey(CHECKOUT, 'tok_1')).not.toBe(storedKey('/accounts/a1/payout', 'tok_1'));
  });

  test('an empty token, an empty endpoint and a multi-line token are refused', () => {
    expect(() => storedKey(CHECKOUT, '')).toThrow(IdempotencyError);
    expect(() => storedKey('', 'tok_1')).toThrow(IdempotencyError);
    expect(() => storedKey(CHECKOUT, 'tok\n1')).toThrow(IdempotencyError);
  });

  test('an identity scope needs an identity', () => {
    expect(() => identityScope('')).toThrow(IdempotencyError);
  });
});

describe('the request hash is over the bytes and never over a re-serialisation', () => {
  test('it is SHA-256 of exactly what arrived', () => {
    expect(Buffer.from(requestHash(BODY_A)).toString('hex')).toBe(
      createHash('sha256').update(BODY_A).digest('hex'),
    );
  });

  test('two JSON texts that PARSE EQUAL hash differently, which is the point', () => {
    const spaced = new TextEncoder().encode('{"a": 1}');
    const tight = new TextEncoder().encode('{"a":1}');
    expect(JSON.stringify(JSON.parse(new TextDecoder().decode(spaced)))).toBe(
      JSON.stringify(JSON.parse(new TextDecoder().decode(tight))),
    );
    expect(requestHash(spaced)).not.toEqual(requestHash(tight));
  });
});

describe('API_CONTRACT section 1, both directions on every arm', () => {
  test('a key nobody has used is fresh, and the row is claimed with no response', async () => {
    const store = new FakeStore();
    const outcome = await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    expect(outcome.kind).toBe('fresh');
    const row = store.rows.get('/checkout:tok_1');
    expect(row?.record.responseStatus).toBeNull();
    expect(row?.record.responseBody).toBeNull();
    expect(row?.record.endpoint).toBe(CHECKOUT);
  });

  test('THE REPLAY RETURNS THE ORIGINAL RESPONSE VERBATIM', async () => {
    const store = new FakeStore();
    const first = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    await completeIdempotent(store, ALICE, first, 201, { purchase_id: 'p_1', amount_cents: 9900 });

    const second = await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    expect(second).toEqual({
      kind: 'replay',
      key: '/checkout:tok_1',
      status: 201,
      body: { purchase_id: 'p_1', amount_cents: 9900 },
    });
    // AND THE HANDLER DID NOT RUN AGAIN. The store was asked to complete once.
    expect(store.completions).toEqual(['/checkout:tok_1']);
  });

  test('THE SAME KEY WITH A DIFFERENT BODY IS 409 idempotency_key_reuse', async () => {
    const store = new FakeStore();
    const first = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    await completeIdempotent(store, ALICE, first, 201, { purchase_id: 'p_1' });

    const second = await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_B);
    expect(second.kind).toBe('reuse');
    const p = problemForOutcome(second, 'req_9');
    expect(p).toEqual({
      type: `https://meritfutures.com/problems/${IDEMPOTENCY_KEY_REUSE}`,
      title: 'Idempotency key reuse',
      status: 409,
      code: IDEMPOTENCY_KEY_REUSE,
      instance: 'req_9',
    });
  });

  test('a different body is refused even before the first request completed', async () => {
    const store = new FakeStore();
    await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    expect((await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_B)).kind).toBe('reuse');
  });

  test('the same body while the first is still running is in_flight, and it is a 409', async () => {
    const store = new FakeStore();
    await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    const second = await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    expect(second.kind).toBe('in_flight');
    expect(problemForOutcome(second, 'req_9')?.code).toBe('conflict');
    expect(problemForOutcome(second, 'req_9')?.status).toBe(409);
  });

  test('fresh and replay carry no problem document', async () => {
    const store = new FakeStore();
    const first = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    expect(problemForOutcome(first, 'req_9')).toBeNull();
    await completeIdempotent(store, ALICE, first, 200, { ok: true });
    const replay = await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    expect(problemForOutcome(replay, 'req_9')).toBeNull();
  });
});

describe('the two scopes are two populations, which is what the nullable column is for', () => {
  test("an identity's key is invisible to the unowned reader and the other way round", async () => {
    const store = new FakeStore();
    const claimed = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    await completeIdempotent(store, ALICE, claimed, 200, { seen: 'alice' });

    // The unowned caller cannot see it and cannot take it either: the primary
    // key is global. IT IS A DENIAL AND NOT A DISCLOSURE, which is the whole
    // finding, and the layer reports it rather than guessing.
    const unowned = await beginIdempotent(store, UNOWNED_SCOPE, CHECKOUT, 'tok_1', BODY_A);
    expect(unowned.kind).toBe('key_held_elsewhere');
    expect(problemForOutcome(unowned, 'req_9')?.code).toBe('conflict');
  });

  test('one identity never reads another identity through this layer', async () => {
    const store = new FakeStore();
    const claimed = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    await completeIdempotent(store, ALICE, claimed, 201, { purchase_id: 'alices' });

    const bob = await beginIdempotent(store, BOB, CHECKOUT, 'tok_1', BODY_A);
    // NOT a replay. Bob must never receive Alice's stored response, and the
    // identical body is exactly the case where a scope-blind layer would.
    expect(bob.kind).toBe('key_held_elsewhere');
  });

  test('the unowned arm works on its own, so it is not merely refused', async () => {
    const store = new FakeStore();
    const first = fresh(await beginIdempotent(store, UNOWNED_SCOPE, '/auth/otp', 'tok_9', BODY_A));
    await completeIdempotent(store, UNOWNED_SCOPE, first, 202, { deferred: true });
    const second = await beginIdempotent(store, UNOWNED_SCOPE, '/auth/otp', 'tok_9', BODY_A);
    expect(second).toMatchObject({ kind: 'replay', status: 202, body: { deferred: true } });
  });
});

describe('the race between the read and the insert is resolved by the primary key', () => {
  test('a concurrent claim in the same scope becomes in_flight, not a second fresh', async () => {
    const store = new FakeStore();
    // The concurrent request lands between `find` and `begin`, which is the
    // window a read-then-insert cannot close.
    store.onBegin = (key) => {
      store.onBegin = undefined;
      store.rows.set(key, {
        scope: ALICE,
        record: {
          key,
          endpoint: CHECKOUT,
          requestHash: requestHash(BODY_A),
          responseStatus: null,
          responseBody: null,
        },
      });
    };
    const outcome = await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A);
    expect(outcome.kind).toBe('in_flight');
  });

  test('a concurrent claim carrying a different body becomes reuse', async () => {
    const store = new FakeStore();
    store.onBegin = (key) => {
      store.onBegin = undefined;
      store.rows.set(key, {
        scope: ALICE,
        record: {
          key,
          endpoint: CHECKOUT,
          requestHash: requestHash(BODY_B),
          responseStatus: null,
          responseBody: null,
        },
      });
    };
    expect((await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A)).kind).toBe('reuse');
  });
});

describe('completeIdempotent names one row and refuses a status that is not one', () => {
  test('it stamps the row the outcome named and no other', async () => {
    const store = new FakeStore();
    const one = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    await beginIdempotent(store, ALICE, CHECKOUT, 'tok_2', BODY_B);
    await completeIdempotent(store, ALICE, one, 201, { purchase_id: 'p_1' });

    expect(store.rows.get('/checkout:tok_1')?.record.responseStatus).toBe(201);
    // THE ROW NOBODY NAMED IS UNTOUCHED. This is the assertion that fails first
    // if the eventual store is written through an accessor with no WHERE clause.
    expect(store.rows.get('/checkout:tok_2')?.record.responseStatus).toBeNull();
    expect(store.completions).toEqual(['/checkout:tok_1']);
  });

  test('a status outside 100..599 is refused rather than stored', async () => {
    const store = new FakeStore();
    const one = fresh(await beginIdempotent(store, ALICE, CHECKOUT, 'tok_1', BODY_A));
    await expect(completeIdempotent(store, ALICE, one, 0, {})).rejects.toBeInstanceOf(
      IdempotencyError,
    );
    await expect(completeIdempotent(store, ALICE, one, 200.5, {})).rejects.toBeInstanceOf(
      IdempotencyError,
    );
    expect(store.completions).toEqual([]);
  });
});
