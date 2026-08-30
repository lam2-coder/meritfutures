// =============================================================================
// apps/api/src/idempotency.ts
// =============================================================================
// API_CONTRACT SECTION 1's IDEMPOTENCY PARAGRAPH, AS A PROTOCOL RATHER THAN AS
// A HABIT EVERY HANDLER REPEATS.
//
//   "Every mutating endpoint accepts `Idempotency-Key` and it is REQUIRED on
//    `POST /checkout`, `POST /accounts/:id/payout`, and
//    `POST /accounts/:id/reset`. Replaying a key with an identical body returns
//    the original response verbatim; replaying with a different body returns
//    `409 idempotency_key_reuse`."
//
// -----------------------------------------------------------------------------
// THIS FILE WRITES NO SQL, AND THE SECTION BELOW RECORDED THAT NO IMPLEMENTATION
// OF THE PORT COULD EXIST. THAT HAS BEEN FALSE SINCE ADR-112 AND IS CORRECTED
// HERE RATHER THAN LEFT BESIDE THE FILE THAT REFUTES IT. ADR-172 clause 1.
//
// `idempotency-store.ts:144` implements this port. It opens `db.scoped` on all
// three methods, addresses the row with `tx.rowAt(TABLE, { key })`, and stamps
// with `tx.updateAt(TABLE, { key }, ...)` -- which ADR-112 clause 3 composes as
// `WHERE identity_id = $1 AND key = $2`, the handle pinning the tenancy and the
// caller naming the row. `updateAt` IS the addressed UPDATE the paragraph below
// says no accessor offers; it did not exist when that paragraph was written.
// Eleven executed tests in `test/idempotency-store.test.ts` hold it.
//
// EVERYTHING BELOW REMAINS TRUE ABOUT THE DOORS IT NAMES, and that is why it is
// kept. `systemTx` and `firmTx` do hardcode `undefined` for the `WHERE`; the
// scoped `update` does narrow by tenancy alone. The error was concluding from
// those three doors that the table was unreachable, when the reachable door was
// the KEYED one. The finding that survives is ADR-109 clause 4's second arm: the
// UNOWNED row is still addressable by nothing, and `idempotency-store.ts` raises
// on it rather than answering `null`.
//
// -----------------------------------------------------------------------------
// WHAT FOLLOWS IS THE ORIGINAL ADR-109 FINDING, KEPT FOR ITS REASONING
// -----------------------------------------------------------------------------
// An idempotency layer's whole job is to find ONE ROW BY ITS KEY and to stamp
// THAT ROW with a response. Nothing in `packages/db` can do either.
//
//   the scoped accessor   needs an identity, and the unowned replay has none.
//   `firmDb()`            is `FirmTableKey`, and `idempotency_keys` is `owned`.
//   `systemDb(reason)`    is `'nightly-batch' | 'operator-console'`, and a
//                         request handler is neither.
//
// THE FIRST DOOR IS DESCRIBED AND NOT NAMED, WHICH IS DELIBERATE AND IS ITSELF
// A FINDING. `CI-06/vg-inventory` probes `\bscopedDb\b` over every `.ts` under
// `apps/api/src` as VG-3's and VG-6's arrival artifact, and STRATEGY's own cell
// says the accessor's name appearing here "is the first commit on which the
// subject exists". A COMMENT EXPLAINING THAT THE ACCESSOR CANNOT BE USED IS NOT
// THAT COMMIT, and spelling the identifier would flip both rows to ARRIVED on
// prose. The probe cannot tell a use from a mention; the gate is not edited and
// the identifier is not written. ADR-109 section 7 reports it.
//
// THAT LIST IS THE HALF EVERYBODY NOTICES AND IT IS NOT THE HALF THAT DECIDES
// THIS FILE. Admitting a third `SystemReason` member would not help, because
// `scoped-db.ts:696-706` and `714-724` pass `undefined` where the statement
// builders take a `WHERE` clause, and the transaction handles expose no
// parameter that could supply one. `systemTx.update('idempotencyKeys', ...)`
// renders no predicate and WRITES EVERY ROW IN THE TABLE. On this table that is
// the worst shape the defect has: every idempotency record in the estate would
// carry one response body, and the next replay of any key on any endpoint would
// serve it.
//
// THE SCOPED PATH IS BLOCKED FOR THE SAME REASON AND NOT FOR A MILDER ONE.
// `ScopedTx.update` narrows by tenancy and by nothing else, so it would stamp
// every idempotency record ONE IDENTITY owns. That is a smaller blast radius and
// the same defect.
//
// So the store is a PORT, this file is the protocol over it, and the accessor
// that can name a row is ADR-109's ruling and the founder's to take.
//
// -----------------------------------------------------------------------------
// THE SCOPE IS TWO TYPES AND NOT ONE NULLABLE FIELD
// -----------------------------------------------------------------------------
// `scope.ts`'s rule for this table is `owned` on a NULLABLE `identity_id`, and
// its `why` states what the nullability is for: "NULLABLE IS HOW THE UNOWNED
// REPLAY IS EXCLUDED, and SQL does the excluding: a key replayed by an
// unauthenticated caller carries no identity and no correct one, so
// `identity_id = $1` drops it without a second predicate because NULL never
// equals anything." The DDL agrees in its own index, which is partial:
// `idempotency_keys_identity_idx (identity_id) WHERE NOT NULL`.
//
// THE DATABASE THEREFORE ALREADY HOLDS TWO POPULATIONS, and a single accessor
// over both is the thing the schema is built to refuse. So the scope is a
// DISCRIMINATED UNION rather than an optional identity: a store implementation
// has to answer for each arm separately and cannot serve one while silently
// answering for the other, which is the failure a nullable field invites.
// =============================================================================

import { createHash } from 'node:crypto';

// The one JSON type spelled in this workspace. A second spelling here would be
// a second thing to keep true, which is the argument `packages/db`'s scope
// registry makes about restating the DDL, one package over.
import type { JsonValue } from '@merit/psp';

import { PROBLEM_TYPE_PREFIX } from './server.ts';
import type { Problem } from './server.ts';

// -----------------------------------------------------------------------------
// The scope
// -----------------------------------------------------------------------------

/** A replay by a caller this database holds an identity for. */
export interface IdentityScope {
  readonly kind: 'identity';
  /** `identity_keys.identity_id`. Written on insert, never taken from a body. */
  readonly identityId: string;
}

/**
 * A replay by a caller with no identity, which is the NULL row.
 *
 * `POST /auth/otp` is the contract's only endpoint at required factor `none`
 * and it mutates, so this arm has a consumer the day that route lands. A PSP
 * webhook does NOT use this table at all: API_CONTRACT section 10 anchors a
 * webhook's idempotency on `(psp, provider_event_id)`, which is a unique index
 * on `psp_webhook_events` and not a key a caller supplies.
 */
export interface UnownedScope {
  readonly kind: 'unowned';
}

/** One or the other, never a nullable field. See this file's header. */
export type IdempotencyScope = IdentityScope | UnownedScope;

/** The identity-bearing arm. */
export function identityScope(identityId: string): IdentityScope {
  if (identityId === '') throw new IdempotencyError('an identity scope needs an identity');
  return { kind: 'identity', identityId };
}

/** The identity-free arm. One value, because it carries nothing. */
export const UNOWNED_SCOPE: UnownedScope = { kind: 'unowned' };

/** Raised when this layer is asked for something it must not guess about. */
export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

// -----------------------------------------------------------------------------
// The row
// -----------------------------------------------------------------------------

/**
 * The stored key, which is the client's token under an endpoint prefix.
 *
 * `0017_events_and_audit.sql:103` declares `key text PRIMARY KEY` and its own
 * inline comment says "scoped by endpoint prefix". This function is that
 * comment, and it is the only place the prefix is formed.
 *
 * THE IDENTITY IS NOT IN THE PREFIX AND THAT IS THE DDL's CHOICE RATHER THAN
 * THIS FILE's. The consequence is a landmine worth naming where somebody will
 * read it: the primary key is `key` ALONE, so two identities choosing the same
 * token on the same endpoint collide in the table. The scope predicate keeps
 * the first one's response from reaching the second (a scoped `find` returns
 * nothing), so it is a DENIAL and not a disclosure, and `beginIdempotent`
 * reports it as its own outcome rather than guessing which of the two it is.
 */
export function storedKey(endpoint: string, clientKey: string): string {
  if (endpoint === '') throw new IdempotencyError('an idempotency key needs its endpoint');
  if (clientKey === '') throw new IdempotencyError('an idempotency key cannot be empty');
  if (clientKey.includes('\n')) throw new IdempotencyError('an idempotency key is one line');
  return `${endpoint}:${clientKey}`;
}

/**
 * `idempotency_keys.request_hash`, over the RAW REQUEST BYTES.
 *
 * OVER THE BYTES AND NEVER OVER A PARSED BODY RE-SERIALISED. Two JSON documents
 * that parse equal can serialise differently, so a hash taken after a parse
 * makes "an identical body" a property of this process's serialiser rather than
 * of what the client sent. The contract's two branches -- replay verbatim, or
 * `409` -- both hang off this comparison.
 */
export function requestHash(raw: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(raw).digest());
}

/** One `idempotency_keys` row, in this layer's terms. */
export interface IdempotencyRecord {
  /** {@link storedKey}. `idempotency_keys.key`. */
  readonly key: string;
  /** `idempotency_keys.endpoint`. Stored beside the prefix, as the DDL declares. */
  readonly endpoint: string;
  /** {@link requestHash}. `idempotency_keys.request_hash`. */
  readonly requestHash: Uint8Array;
  /** `idempotency_keys.response_status`. NULL until the request completes. */
  readonly responseStatus: number | null;
  /** `idempotency_keys.response_body`. NULL until the request completes. */
  readonly responseBody: JsonValue | null;
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * The three things this layer needs a database for, and no fourth.
 *
 * EVERY METHOD TAKES THE SCOPE AND THE KEY, WHICH IS THE WHOLE POINT. An
 * implementation of this interface must name ONE ROW.
 *
 * THAT IMPLEMENTATION EXISTS: `idempotency-store.ts:144`, over the KEYED
 * accessor ADR-112 built. It answers the comment this doc used to pose --
 * `packages/db/src/scoped-db.ts`'s `systemTx` and `firmTx` do hardcode
 * `undefined` for the `WHERE` -- by using NEITHER handle. `complete` is an
 * UPDATE of exactly one row and `scopedTx.updateAt` is an UPDATE of exactly one
 * row, addressed by a unique key and narrowed by tenancy in the same predicate.
 *
 * THE UNOWNED ARM IS STILL UNSERVED and that is a live finding rather than a
 * stage of the work. See `idempotency-store.ts`'s header and ADR-172.
 */
export interface IdempotencyStore {
  /**
   * The row for this key IN THIS SCOPE, or `null`.
   *
   * `null` is genuinely ambiguous and callers are not asked to resolve it: it
   * means no such row, OR a row this scope cannot see. `begin` is what tells
   * the two apart, because the primary key is global.
   */
  find(scope: IdempotencyScope, key: string): Promise<IdempotencyRecord | null>;

  /**
   * Claim the key by INSERTING the row, with no response stored yet.
   *
   * `'exists'` when the primary key refused the insert. THE RACE IS RESOLVED BY
   * THE DATABASE AND NOT BY A READ: a `find` that returned nothing and an
   * insert that lands are two statements, and between them a concurrent request
   * carrying the same key can win. `idempotency_keys.key` is the mutex.
   */
  begin(scope: IdempotencyScope, record: IdempotencyRecord): Promise<'inserted' | 'exists'>;

  /**
   * Stamp the response onto THAT ONE ROW.
   *
   * The row is named by `(scope, key)` and by nothing else. An implementation
   * that writes more rows than one is the defect this interface exists to make
   * impossible to write by accident.
   */
  complete(scope: IdempotencyScope, key: string, status: number, body: JsonValue): Promise<void>;
}

// -----------------------------------------------------------------------------
// The protocol
// -----------------------------------------------------------------------------

/**
 * What a caller found when it presented a key. Four arms, and the contract
 * names two of them.
 */
export type IdempotencyOutcome =
  /** No such key. The handler runs, then calls {@link completeIdempotent}. */
  | { readonly kind: 'fresh'; readonly key: string }
  /** Same key, same body, response stored. Returned VERBATIM. Contract, section 1. */
  | {
      readonly kind: 'replay';
      readonly key: string;
      readonly status: number;
      readonly body: JsonValue;
    }
  /** Same key, DIFFERENT body. `409 idempotency_key_reuse`. Contract, section 1. */
  | { readonly kind: 'reuse'; readonly key: string }
  /**
   * Same key, same body, NO response stored yet. `409 conflict`.
   *
   * NOT IN THE CONTRACT, AND NAMED HERE RATHER THAN FOLDED INTO ONE THAT IS.
   * Section 1 describes a replay of a COMPLETED request and says nothing about
   * a second delivery arriving while the first is still running, which is the
   * ordinary case when a client times out and retries. The three available
   * wrong answers are: run the handler again (which is the duplicate charge
   * this layer exists to prevent), return the first request's response before
   * it exists (there is nothing to return), or wait (which holds a connection
   * on a request whose outcome this process does not own). So it refuses, and
   * `409 conflict` is section 2's code for a state conflict.
   */
  | { readonly kind: 'in_flight'; readonly key: string }
  /**
   * The key is held by a row this scope cannot see. `409 conflict`.
   *
   * `idempotency_keys.key` is the PRIMARY KEY and carries no identity, so one
   * caller's token can block another's. See {@link storedKey}. It is reported
   * rather than guessed at: this layer cannot tell a foreign holder from a row
   * it is racing, and answering either way would be an invention.
   */
  | { readonly kind: 'key_held_elsewhere'; readonly key: string };

/**
 * Present a key. The FIRST thing a mutating handler does, before any effect.
 *
 * @param raw the request body AS RECEIVED. See {@link requestHash}.
 */
export async function beginIdempotent(
  store: IdempotencyStore,
  scope: IdempotencyScope,
  endpoint: string,
  clientKey: string,
  raw: Uint8Array,
): Promise<IdempotencyOutcome> {
  const key = storedKey(endpoint, clientKey);
  const hash = requestHash(raw);

  const found = await store.find(scope, key);
  if (found !== null) return classify(found, hash, key);

  const claimed = await store.begin(scope, {
    key,
    endpoint,
    requestHash: hash,
    responseStatus: null,
    responseBody: null,
  });
  if (claimed === 'inserted') return { kind: 'fresh', key };

  // The insert lost. Either somebody in THIS scope won the race between the
  // find and the insert, or the key belongs to a row this scope cannot see.
  // One more read tells them apart, and it is the only place this layer reads
  // twice.
  const afterRace = await store.find(scope, key);
  if (afterRace === null) return { kind: 'key_held_elsewhere', key };
  return classify(afterRace, hash, key);
}

function classify(record: IdempotencyRecord, hash: Uint8Array, key: string): IdempotencyOutcome {
  // A CONSTANT-TIME COMPARISON IS NOT WANTED HERE AND THE ABSENCE IS
  // DELIBERATE. Both operands are digests of bodies the caller already holds:
  // there is no secret to leak by timing, and `timingSafeEqual` throws on a
  // length mismatch, which a stored row of the wrong width would turn into a
  // 500 where a 409 is correct.
  if (!sameBytes(record.requestHash, hash)) return { kind: 'reuse', key };
  if (record.responseStatus === null || record.responseBody === null) {
    return { kind: 'in_flight', key };
  }
  return {
    kind: 'replay',
    key,
    status: record.responseStatus,
    body: record.responseBody,
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Store the response against a key this caller took with `'fresh'`.
 *
 * IT TAKES THE OUTCOME AND NOT A BARE KEY, so a handler that never held the key
 * cannot stamp it: `'fresh'` is the only arm this accepts, and the other four
 * are compile errors at the call site.
 */
export async function completeIdempotent(
  store: IdempotencyStore,
  scope: IdempotencyScope,
  outcome: Extract<IdempotencyOutcome, { kind: 'fresh' }>,
  status: number,
  body: JsonValue,
): Promise<void> {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new IdempotencyError(`\`${String(status)}\` is not an HTTP status`);
  }
  await store.complete(scope, outcome.key, status, body);
}

// -----------------------------------------------------------------------------
// The two refusals, in the contract's own shape
// -----------------------------------------------------------------------------

/** API_CONTRACT section 2's code for a key replayed with a different body. */
export const IDEMPOTENCY_KEY_REUSE = 'idempotency_key_reuse';

/**
 * The problem document for an outcome that refuses, or `null` for one that does
 * not.
 *
 * `server.ts`'s `problem()` is not reused for the first of these: its `TITLE`
 * table is closed over the codes the TRANSPORT can produce with no handler
 * involved, and `idempotency_key_reuse` is a handler's. The type prefix is
 * imported rather than respelled.
 */
export function problemForOutcome(outcome: IdempotencyOutcome, instance: string): Problem | null {
  switch (outcome.kind) {
    case 'fresh':
    case 'replay':
      return null;
    case 'reuse':
      return {
        type: `${PROBLEM_TYPE_PREFIX}${IDEMPOTENCY_KEY_REUSE}`,
        title: 'Idempotency key reuse',
        status: 409,
        code: IDEMPOTENCY_KEY_REUSE,
        instance,
      };
    case 'in_flight':
    case 'key_held_elsewhere':
      return {
        type: `${PROBLEM_TYPE_PREFIX}conflict`,
        title: 'Conflict',
        status: 409,
        code: 'conflict',
        instance,
      };
  }
}
