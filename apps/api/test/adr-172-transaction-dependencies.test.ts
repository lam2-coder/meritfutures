import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { databaseIdempotencyStore } from '../src/idempotency-store.ts';
import { beginIdempotent, identityScope } from '../src/idempotency.ts';
import { OPEN_WITHDRAWAL_STATUSES, gateNoInFlight } from '../src/routes/wallet-withdrawals.ts';
import { recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project. ADR-172.
//
// =============================================================================
// THE PREMISE THAT WAS FALSE FOR FOUR SESSIONS, PINNED SO IT CANNOT RETURN AS
// PROSE
// =============================================================================
// `wiring.test.ts` carried two sentences twenty lines apart, one saying
// `databaseIdempotencyStore` exists and one saying no file in this tree provides
// an `IdempotencyStore`. Both could not be true. The false one had been copied
// forward from `idempotency.ts`'s header, which was correct when it was written
// and was refuted by ADR-112 landing `updateAt`.
//
// A PARAGRAPH IS WHAT LET IT SURVIVE, so ADR-172's two load-bearing facts are
// assertions here rather than sentences anywhere. CLAUDE.md's own caution is the
// argument: "Prefer a new CI gate over a bigger model whenever the error is
// checkable." Both of these are checkable.
//
// WHAT THIS FILE DOES NOT ASSERT. It says nothing about whether the composed
// predicate reaches one row, which is `packages/db`'s and lives in
// `keyed-accessor.test.ts` (see `db-recorder.ts`'s header). It asserts that
// `apps/api` CAN BUILD THE OBJECT, and that the thing which actually blocks the
// cash door is a different thing entirely.
// =============================================================================

const ALICE = identityScope('11111111-1111-4111-8111-111111111111');

// -----------------------------------------------------------------------------
// 1. The construction, PERFORMED rather than asserted to typecheck
// -----------------------------------------------------------------------------

test('the store the cash door needs is CONSTRUCTED and drives the protocol end to end', async () => {
  // THE DISPATCH ASKED FOR A CONSTRUCTION AND NOT A TYPE. This builds the real
  // adapter over the recorder and runs `beginIdempotent` through it, on the
  // SAME scope arm `POST /wallet/withdrawals` presents at
  // `routes/wallet-withdrawals.ts:1506` -- `identityScope(session.identityId)`,
  // never `UNOWNED_SCOPE`. So the arm `idempotency-store.ts` refuses is not on
  // this route's path at all.
  const { db, calls } = recordingDb({ rowAt: undefined, insert: [{}] });
  const store = databaseIdempotencyStore(db);

  const outcome = await beginIdempotent(
    store,
    ALICE,
    'POST /wallet/withdrawals',
    'tok_cash_1',
    new TextEncoder().encode('{"amount_cents":10000}'),
  );

  expect(outcome.kind).toBe('fresh');
  expect(outcome.key).toBe('POST /wallet/withdrawals:tok_cash_1');

  // Every call went through the SCOPED door carrying the identity the scope
  // named, and none reached for `firm` or an executor.
  expect(calls.every((call) => call.door === 'scoped')).toBe(true);
  expect(calls.every((call) => call.identityId === ALICE.identityId)).toBe(true);
  expect(calls.map((call) => call.verb)).toStrictEqual(['rowAt', 'insert']);
});

test('complete is an ADDRESSED update, which is what the absent-store premise said was unwritable', async () => {
  // `updateAt(key, at, values)` IS the "UPDATE of exactly one row" the old
  // comment said no accessor offered. The address reaching `packages/db` is
  // what this records; the predicate it composes there is that package's.
  const { db, calls } = recordingDb({ updateAt: [{ key: 'POST /wallet/withdrawals:tok_cash_1' }] });

  await databaseIdempotencyStore(db).complete(ALICE, 'POST /wallet/withdrawals:tok_cash_1', 200, {
    status: 'requested',
  });

  const stamp = calls.at(-1);
  expect(stamp?.verb).toBe('updateAt');
  expect(stamp?.door).toBe('scoped');
  expect(stamp?.identityId).toBe(ALICE.identityId);
  // THE CALLER NAMES THE ROW AND NOT THE TENANCY. `refusePinnedColumn` would
  // raise on an address carrying `identityId`, so its ABSENCE here is the
  // composition rather than an omission.
  expect(stamp?.address).toStrictEqual({ key: 'POST /wallet/withdrawals:tok_cash_1' });
  expect(stamp?.address).not.toHaveProperty('identityId');
});

// -----------------------------------------------------------------------------
// 2. The thing that actually blocks the cash door, ADR-172 clause 5
// -----------------------------------------------------------------------------

test('a `requested` row is OPEN, so wiring the route would lock the trader out rather than pay twice', () => {
  // CLAUSE 5 IS ARITHMETIC AND NOT A PREFERENCE. `routes/wallet-withdrawals.ts`
  // creates a row at `requested` or `cooling` and posts nothing; nothing in
  // this tree performs `requested --> approved`; and both statuses are OPEN, so
  // `gateNoInFlight` refuses that identity's every later withdrawal, forever.
  //
  // The failure direction is REFUSAL and never duplication, which is what the
  // cash door requires -- but it is an IRREVERSIBLE refusal, and a 503 is a
  // reversible one. That is the whole of why the port stays blocked.
  expect(OPEN_WITHDRAWAL_STATUSES).toContain('requested');
  expect(OPEN_WITHDRAWAL_STATUSES).toContain('cooling');

  expect(gateNoInFlight([{ status: 'requested' }])).not.toBeNull();
  expect(gateNoInFlight([{ status: 'cooling' }])).not.toBeNull();
  expect(gateNoInFlight([])).toBeNull();
});

// -----------------------------------------------------------------------------
// 3. The premise itself, so it cannot be written down again
// -----------------------------------------------------------------------------

test('no blocked reason claims an `IdempotencyStore` implementation is absent while one is exported', () => {
  // THE REGRESSION THIS CASE EXISTS FOR IS A SENTENCE, which is unusual and is
  // the point: the defect was never a failing test or a type error. It was a
  // true-when-written comment copied into three files and then relied upon by
  // two sessions that declined to wire a port because of it.
  const here = import.meta.dirname;
  const store = readFileSync(join(here, '..', 'src', 'idempotency-store.ts'), 'utf8');
  expect(store).toMatch(/export function databaseIdempotencyStore/);

  // THE REASON STRING AND NOT THE WHOLE FILE. The correcting comment beside it
  // QUOTES the old claim in order to retire it, and a check that banned the
  // phrase outright would forbid the entry from explaining itself -- which is
  // how a corrected record loses the reason it was corrected.
  const wiring = readFileSync(join(here, 'wiring.test.ts'), 'utf8');
  const reason = /useWithdrawalBackend:\n((?:\s+'(?:[^']|\\')*'\s*\+?\n)+)/.exec(wiring)?.[1];
  expect(reason, 'useWithdrawalBackend has no reason string to read').toBeDefined();

  // It must not say the store is absent, and it must name what IS absent.
  expect(reason).not.toMatch(/no file in this tree provides/i);
  expect(reason).not.toMatch(/no implementation of/i);
  expect(reason).toMatch(/requested --> approved/);
});
