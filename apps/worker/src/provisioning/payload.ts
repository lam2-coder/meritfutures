// =============================================================================
// apps/worker/src/provisioning/payload.ts
// =============================================================================
// SD-M2-01's DUPLICATE-INTENT GUARD, AND THE ENQUEUE PATH IS THIS FILE.
//
// `0007_accounts.sql:278` declares `payload_hash bytea NOT NULL` and says in
// its own comment who computes it: "Written by the enqueue path over a
// canonical serialization of payload, deliberately NOT a generated column: a
// generated column would need an immutable cast of jsonb, whose immutability is
// a Postgres version question, and the duplicate-intent guard must not rest on
// that." `provisioning_queue_intent_uq` is
// `unique (account_id, operation, payload_hash) where status <> 'failed'`, so
// the digest below is the only thing standing between one intent and an account
// provisioned twice.
//
// -----------------------------------------------------------------------------
// THE PAYLOAD IS FLAT, AND THAT IS THE COLUMN'S OWN CLAIM RATHER THAN A
// SIMPLIFICATION
// -----------------------------------------------------------------------------
// `0007:266` says `payload jsonb NOT NULL, -- the exact field values rendered
// into CSV`, and `scope.ts:909` repeats it: "`payload jsonb` HOLDS THE FIELD
// VALUES RENDERED INTO CSV FOR THIS ACCOUNT". A CSV row is flat by
// construction. So `ProvisioningPayload` is a flat map, the canonicalization
// below is total with no recursion, and a nested value is a THROW rather than a
// silently-serialized shape that a later CSV writer would have to invent a
// flattening for.
//
// -----------------------------------------------------------------------------
// THE FRAMING IS `hash.ts`'s, DELIBERATELY, AND THE ARGUMENT IS REPRODUCED
// BECAUSE IT IS THE SAME ARGUMENT
// -----------------------------------------------------------------------------
// `packages/rules-engine/src/hash.ts` frames every field as
// `<utf8 byte length>:<utf8 bytes>` and states why: plain concatenation is not
// injective, and a separator character is injective only while no field can
// contain it, "which is a claim a future column can falsify quietly."
//
// THIS FILE FRAMES THE KEY AS WELL AS THE VALUE, and that is the one place the
// two differ. `hash.ts` serializes a FIXED COLUMN LIST in a declared order, so
// position identifies the field and only the value needs framing. A payload is
// a MAP whose key set is not fixed, so `{ab: 'c'}` and `{a: 'bc'}` would frame
// identically if only values were framed -- two different intents carrying one
// hash, which under `provisioning_queue_intent_uq` is one of them silently not
// being enqueued.
//
// THE TYPE TAG IS THE SECOND HALF OF THE SAME PROPERTY. `'100'` and `100n` are
// different intents (a string field and a cents field), and without a tag they
// frame identically. One character before the value costs nothing and closes it.
//
// LIKE `hash.ts`, THIS FIXES EVERY STORED `payload_hash` FOREVER. Changing the
// framing after the first row lands invalidates the guard for every row already
// in the table, and there is no migration that repairs it. It is chosen now
// because `provisioning_queue` has no rows and this is the only moment at which
// choosing costs nothing.

import { createHash } from 'node:crypto';

import type { ProvisioningOperation } from './vocabulary.ts';

/**
 * One field of one intent.
 *
 * `bigint` IS HERE AND `number` IS NOT, and the exclusion is the corpus
 * convention rather than a preference: money is integer cents and thresholds
 * are basis points or integer cents, with no floats in any financial path. A
 * risk floor is money. `number` would admit `2.5` and admit a value above
 * `Number.MAX_SAFE_INTEGER` that has already lost digits by the time this file
 * sees it, and neither is detectable here.
 */
export type ProvisioningValue = string | bigint | boolean | null;

/** The exact field values rendered into CSV, before they are rendered. */
export type ProvisioningPayload = Readonly<Record<string, ProvisioningValue>>;

/** Thrown when a payload cannot be rendered. A malformed intent is loud, never hashed. */
export class ProvisioningPayloadError extends Error {
  override readonly name = 'ProvisioningPayloadError';
}

/** `<utf8 byte length>:<utf8 bytes>`. `hash.ts`'s framing, unchanged. */
function frame(value: string): string {
  return `${String(Buffer.byteLength(value, 'utf8'))}:${value}`;
}

/**
 * The type tag, one character, from a closed set.
 *
 * The set is closed by `ProvisioningValue` and this function is total over it,
 * so a member added to that union is a compile error here rather than a value
 * that hashes as something else.
 */
function tagged(value: ProvisioningValue, key: string): string {
  switch (typeof value) {
    case 'string':
      return `s${value}`;
    case 'bigint':
      return `i${value.toString(10)}`;
    case 'boolean':
      return `b${value ? '1' : '0'}`;
    default:
      // `null` is the only remaining inhabitant of the union, and `typeof null`
      // is `'object'`. Anything else reached this function past its type.
      if (value === null) return 'n';
      throw new ProvisioningPayloadError(
        `payload field ${JSON.stringify(key)} is ${typeof value}, which is not a ` +
          'ProvisioningValue. The payload holds the exact field values rendered into ' +
          'CSV and a CSV field is flat.',
      );
  }
}

/**
 * The bytes SD-M2-01's digest is taken over.
 *
 * KEYS ARE SORTED BY UTF-16 CODE UNIT, which is what `Array.prototype.sort`
 * does with no comparator and is stable across every engine because the
 * ordering is defined on the string values rather than on a locale. The sort
 * exists because an object's own enumeration order is insertion order, so two
 * callers building the same intent in different field orders would otherwise
 * produce two hashes and two rows for one intent.
 */
export function canonicalPayload(payload: ProvisioningPayload): string {
  const keys = Object.keys(payload).sort();
  let out = '';
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined) {
      // Reachable only through an explicitly-undefined property, which
      // `Object.keys` reports and `Readonly<Record<string, ProvisioningValue>>`
      // does not exclude. It is a throw rather than a skip: skipping would make
      // `{a: undefined}` and `{}` one intent.
      throw new ProvisioningPayloadError(
        `payload field ${JSON.stringify(key)} is undefined. A field that is absent and a ` +
          'field that is present and empty are different intents.',
      );
    }
    out += frame(key) + frame(tagged(value, key));
  }
  return out;
}

/**
 * SD-M2-01. Thirty-two bytes, over the canonical serialization.
 *
 * `Buffer` RATHER THAN `Uint8Array` because the column is `bytea` and the value
 * goes straight into a bind parameter, which is `state-hash.ts:60`'s reasoning
 * for the same decision one directory over.
 */
export function payloadHash(payload: ProvisioningPayload): Buffer {
  return createHash('sha256').update(canonicalPayload(payload), 'utf8').digest();
}

/**
 * The payload as `jsonb` will hold it.
 *
 * A `bigint` BECOMES A DECIMAL STRING AND THAT IS NOT A ROUND TRIP LOSS, it is
 * the only way there is not one. `JSON.stringify` THROWS on a `bigint`, so the
 * choice is between a string and a `number`; a `number` would be read back by
 * `JSON.parse` as a double, and a risk floor above 2^53 cents would come back
 * changed with nothing anywhere reporting it. The digest above is taken over
 * the TAGGED value rather than over this rendering, so `'100'` and `100n` stay
 * different intents even though both reach `jsonb` as `"100"`.
 */
export function renderPayload(payload: ProvisioningPayload): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const key of Object.keys(payload).sort()) {
    const value = payload[key];
    if (value === undefined) {
      throw new ProvisioningPayloadError(
        `payload field ${JSON.stringify(key)} is undefined.`,
      );
    }
    out[key] = typeof value === 'bigint' ? value.toString(10) : value;
  }
  return out;
}

/**
 * M02 section 3.3. The batch id, from the ORDERED SET of payload hashes.
 *
 * ORDERED SET IS M02's OWN WORDING AND BOTH WORDS ARE HONOURED: the hashes are
 * SORTED, so the batch id does not depend on the order the intents happened to
 * be read in, and they are DEDUPLICATED, so a batch that carried one intent
 * twice is the same batch as the one that carried it once. A batch cannot carry
 * one intent twice in any case -- `provisioning_queue_intent_uq` forbids it --
 * so the dedupe is a property that already holds being made not to matter
 * rather than a behaviour anybody relies on.
 */
export function batchId(hashes: readonly Buffer[]): string {
  const unique = [...new Set(hashes.map((h) => h.toString('hex')))].sort();
  if (unique.length === 0) {
    throw new ProvisioningPayloadError(
      'a batch of zero intents has no id. An empty batch is not a file with no rows, ' +
        'it is a file that must not be written.',
    );
  }
  const digest = createHash('sha256');
  for (const hex of unique) digest.update(frame(hex), 'utf8');
  return digest.digest('hex');
}

/**
 * The short form that goes in the file name.
 *
 * SIXTEEN HEX CHARACTERS, AND M02 DOES NOT SAY HOW MANY. Section 3.3 gives the
 * name as `merit_<operation>_<yyyymmdd>_<hhmmss>_<batch_id_short>.csv` and
 * leaves `_short` undefined, so this is a choice the source does not make and
 * it fixes every stored `file_name`. Sixty-four bits, under a name that already
 * carries the operation and the second, is the point past which a collision
 * needs two different batches of the same operation in the same second.
 */
export const BATCH_ID_SHORT_LENGTH = 16;

/**
 * M02 section 3.3's file name.
 *
 * THE INSTANT IS AN ARGUMENT AND THIS MODULE READS NO CLOCK, which is
 * `ports.ts:98`'s rule one directory over ("THE BATCH THEREFORE READS NO
 * CLOCK") applied for the same reason: a function that reads a clock cannot be
 * asserted against a fixture, and this one has to be.
 *
 * IT IS NOT IDEMPOTENT OVER TIME AND M02 SECTION 3.3 READS AS THOUGH IT IS.
 * That section says "The same intents always produce the same filename", and
 * the name it specifies carries `yyyymmdd_hhmmss`, so the same intents built a
 * minute apart produce two names. The corpus resolves its own tension one line
 * away and the resolution is a COLUMN: `0007:280` is
 * `file_name text NULL, -- idempotent name, assigned at batch build`, and M02
 * section 3.2's retry edge is `failed --> queued: operator retry, same
 * payload_hash, SAME FILE NAME`. So the name is idempotent because it is
 * ASSIGNED ONCE AND STORED, not because it is recomputable. **A retry that
 * recomputes this instead of reading `file_name` re-uploads under a new name,
 * which is the double-application `INV-M2-02`'s outbound mirror exists to
 * prevent.** `saga.ts` reads the stored name and never recomputes.
 *
 * UTC, because timestamps are UTC in storage.
 */
export function provisioningFileName(
  operation: ProvisioningOperation,
  builtAt: Date,
  hashes: readonly Buffer[],
): string {
  const t = builtAt.getTime();
  if (!Number.isFinite(t)) {
    throw new ProvisioningPayloadError('a batch cannot be built at an invalid instant.');
  }
  const iso = builtAt.toISOString();
  const day = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
  const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
  const short = batchId(hashes).slice(0, BATCH_ID_SHORT_LENGTH);
  return `merit_${operation}_${day}_${time}_${short}.csv`;
}
