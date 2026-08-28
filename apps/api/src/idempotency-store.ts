// =============================================================================
// apps/api/src/idempotency-store.ts
// =============================================================================
// ADR-109 CLAUSE 3, DISCHARGED FOR ONE OF ITS TWO POPULATIONS AND NOT FOR THE
// OTHER, WITH THE REASON WRITTEN AT THE SITE RATHER THAN LEFT TO BE FOUND.
//
// `idempotency.ts` declares `IdempotencyStore` and says why no implementation of
// it existed: "an idempotency layer's whole job is to find ONE ROW BY ITS KEY
// and to stamp THAT ROW with a response. Nothing in `packages/db` can do
// either." ADR-112 built the construction that can, so this file is written.
//
// -----------------------------------------------------------------------------
// THE IDENTITY ARM, AND WHY THE ADDRESS IS `{ key }` AND NOT `{ key, identityId }`
// -----------------------------------------------------------------------------
// `idempotency_keys.key` is the PRIMARY KEY (`0017_events_and_audit.sql:103`)
// and `idempotency_keys` is scope class `owned` on `identity_id`
// (`scope.ts:1201`), so a keyed write through `scopedTx` renders
//
//   WHERE identity_id = $1 AND key = $2
//
// which is ADR-112 clause 3's composition: the handle pins the tenancy, the
// caller names the row, and BOTH halves are in the predicate that reaches the
// database. Naming `identityId` in the address would not merely be redundant, it
// is REFUSED -- `refusePinnedColumn` raises on a caller naming a column the
// handle supplies -- and the same rule is why `insert` below writes no identity:
// `scopedInsertStatement` stamps it, and `refuseTenancyColumn` refuses a caller
// that tried to.
//
// -----------------------------------------------------------------------------
// THE UNOWNED ARM IS REFUSED, AND THIS IS A FINDING RATHER THAN A STAGE OF THE
// WORK
// -----------------------------------------------------------------------------
// ADR-109 clause 4 makes `UnownedScope` a distinct type because the database
// already holds two populations: `idempotency_keys_identity_idx` is PARTIAL on
// `identity_id IS NOT NULL`. Its row is reached by
//
//   WHERE key = $1 AND identity_id IS NULL
//
// and NO DOOR IN THIS WORKSPACE RENDERS IT. `scopedDb` needs an identity and the
// row has none. `firmDb()` takes `FirmTableKey` and this table is `owned`.
// `systemDb(reason)` reaches it and `SystemReason` is `'nightly-batch' |
// 'operator-console'`, which a request handler is neither of, and ADR-109 clause
// 1 refused to widen that vocabulary. And even at that authority the ADDRESS
// itself is unwritable: `RowFilter` is a typed EQUALITY conjunction (ADR-112
// clause 1) with "no `OR`, no `IN`, no range and no `IS NULL`", and a `null`
// address value is refused before any SQL is rendered.
//
// SO THE ARM RAISES, AND IT RAISES RATHER THAN RETURNING `null`. A `find` that
// answered `null` here would be indistinguishable from "no such row", and the
// caller would then run the handler again -- which is the duplicate effect this
// whole layer exists to prevent, arriving through the layer's own silence.
// ADR-109 clause 4's whole argument is that a discriminated union makes the
// second arm "a switch somebody has to complete"; this file completes it with a
// refusal, which is the honest completion available today.
//
// THE ONLY ENDPOINT THAT NEEDS THIS ARM IS `POST /auth/otp`, the contract's one
// route at required factor `none`, and it does not reach this layer yet. So
// nothing regresses and nothing is quietly wrong: what a caller gets is an
// exception naming the missing construction, and a 500 rather than a duplicate.
// =============================================================================

import type { JsonValue } from '@merit/psp';

import type { ApiDb } from './db.ts';
import { IdempotencyError } from './idempotency.ts';
import type { IdempotencyRecord, IdempotencyScope, IdempotencyStore } from './idempotency.ts';

/** `idempotency_keys`, as `scope.ts` and `schema.ts` key it. */
const TABLE = 'idempotencyKeys';

/**
 * PostgreSQL's `unique_violation`.
 *
 * READ OFF THE ERROR AND NEVER OFF ITS MESSAGE, and the driver is NOT imported
 * to get the type: `merit/no-raw-db-client` bans a `pg` import in `apps/**` and
 * this file has no business being the exception. The shape is duck-typed
 * through the wrapper too, because a query error may arrive wrapped with the
 * driver's own as its `cause`.
 */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e !== null && e !== undefined && depth < 4; depth += 1) {
    if (typeof e !== 'object') return false;
    const code: unknown = (e as { code?: unknown }).code;
    if (code === UNIQUE_VIOLATION) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The identity this scope names, or a refusal carrying the finding.
 *
 * ONE PLACE, SO THE REFUSAL READS THE SAME FROM ALL THREE METHODS and a later
 * session repairing it has one call site to delete.
 */
function identityOf(scope: IdempotencyScope): string {
  if (scope.kind === 'identity') return scope.identityId;
  throw new IdempotencyError(
    'the unowned idempotency row cannot be reached. Its predicate is `key = $1 AND identity_id ' +
      'IS NULL`, and no accessor in this workspace renders it: the scoped door needs an ' +
      'identity the row has not got, the firm door refuses an `owned` table, the unscoped door ' +
      'takes a reason vocabulary a request handler is not in, and an address is equality only ' +
      'so `IS NULL` is unwritable at every authority. ADR-120 reports it; ADR-109 clause 4 is ' +
      'the type that makes it visible rather than silent',
  );
}

/** One `idempotency_keys` row, read back out of the accessor's `unknown`. */
function toRecord(row: unknown): IdempotencyRecord {
  if (typeof row !== 'object' || row === null)
    throw new IdempotencyError('idempotency_keys returned something that is not a row');
  const r = row as Record<string, unknown>;
  const key = r['key'];
  const endpoint = r['endpoint'];
  const hash = r['requestHash'];
  const status = r['responseStatus'];
  const body = r['responseBody'];
  if (typeof key !== 'string' || typeof endpoint !== 'string')
    throw new IdempotencyError('idempotency_keys row is missing its key or its endpoint');
  if (!(hash instanceof Uint8Array))
    throw new IdempotencyError('idempotency_keys.request_hash did not read back as bytes');
  // NULL UNTIL THE REQUEST COMPLETES, and the two are read as a PAIR because
  // `classify` treats either half being null as `in_flight`. A row with one of
  // them set is a row nothing in this layer writes.
  if (status !== null && typeof status !== 'number')
    throw new IdempotencyError('idempotency_keys.response_status is neither null nor a number');
  return {
    key,
    endpoint,
    requestHash: hash,
    responseStatus: status,
    responseBody: (body ?? null) as JsonValue | null,
  };
}

/**
 * The store, over the real accessor.
 *
 * Every method names ONE ROW, which is what `IdempotencyStore`'s own doc comment
 * says an implementation of it must do.
 */
export function databaseIdempotencyStore(db: ApiDb): IdempotencyStore {
  return {
    async find(scope: IdempotencyScope, key: string): Promise<IdempotencyRecord | null> {
      const identityId = identityOf(scope);
      const row = await db.scoped(identityId, (tx) => tx.rowAt(TABLE, { key }));
      return row === undefined || row === null ? null : toRecord(row);
    },

    async begin(
      scope: IdempotencyScope,
      record: IdempotencyRecord,
    ): Promise<'inserted' | 'exists'> {
      const identityId = identityOf(scope);
      try {
        await db.scoped(identityId, (tx) =>
          // NO `identityId` IN THESE VALUES. `scopedInsertStatement` stamps the
          // tenancy column itself and `refuseTenancyColumn` raises on a caller
          // that named it, which is ADR-102 clause 4: the stamp is the last word
          // and a caller may not supply it.
          tx.insert(TABLE, {
            key: record.key,
            endpoint: record.endpoint,
            requestHash: Buffer.from(record.requestHash),
            responseStatus: record.responseStatus,
            responseBody: record.responseBody,
          }),
        );
        return 'inserted';
      } catch (err) {
        // THE RACE IS RESOLVED BY THE DATABASE AND NOT BY A READ, which is the
        // interface's own sentence. The statement that lost aborts its
        // transaction, `transaction()` rolls it back, and the outcome arrives
        // here as an error carrying a SQLSTATE rather than as a returned row.
        if (isUniqueViolation(err)) return 'exists';
        throw err;
      }
    },

    async complete(
      scope: IdempotencyScope,
      key: string,
      status: number,
      body: JsonValue,
    ): Promise<void> {
      const identityId = identityOf(scope);
      const written = await db.scoped(identityId, (tx) =>
        tx.updateAt(TABLE, { key }, { responseStatus: status, responseBody: body }),
      );
      // ZERO ROWS IS RAISED AND NEVER SWALLOWED. The caller reached here holding
      // a `'fresh'` outcome, which means THIS scope inserted THIS key moments
      // ago, so a write that lands nowhere means the row was removed underneath
      // it or the scope is not the one that took it. Returning quietly would
      // leave a claimed key with no response on it, and the next delivery of the
      // same request would answer `409 conflict` forever.
      if (written.length === 0)
        throw new IdempotencyError(
          `the response for \`${key}\` was written to no row. The key was claimed by this scope ` +
            'and the stamp reached nothing, which is a row that vanished or a scope that is not ' +
            'the holder; neither is a thing this layer may answer for',
        );
    },
  };
}
