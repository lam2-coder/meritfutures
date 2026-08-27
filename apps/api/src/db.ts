// =============================================================================
// apps/api/src/db.ts
// =============================================================================
// THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/db`, AND THE ADMISSION
// THAT LETS IT IS A RULING RATHER THAN A LINE. ADR-120.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A FILE HERE AT ALL, RATHER THAN AN IMPORT IN EACH ADAPTER
// -----------------------------------------------------------------------------
// `RI-08` guards the MANIFEST and says so in its own `covers`: it does not read
// source, and the day `DB_ADMITTED` stopped being empty is the day this
// deployable acquired the capability everywhere at once. A reviewer asking
// "where does apps/api reach the database" should get one answer with a path in
// it, and `grep -rln '@merit/db' apps/api/src` returning exactly this file is
// that answer. It is a convention and it is not a control, and it is written
// down as a convention so nobody mistakes it for one.
//
// -----------------------------------------------------------------------------
// TWO DOORS, AND THE THIRD IS ABSENT ON PURPOSE
// -----------------------------------------------------------------------------
// `scoped(identityId, fn)`  every read and write a request handler makes on
//                           behalf of the caller it resolved.
// `firm(fn)`                the rows that belong to NOBODY. `otp_challenges` is
//                           the one this surface needs, and `scope.ts` calls it
//                           "the first `firm` row whose reason is TIMING rather
//                           than ownership": the challenge is written before
//                           anybody is anybody.
//
// THERE IS NO `system(reason, fn)` HERE AND ITS ABSENCE IS THE POINT.
// `SystemReason` is `'nightly-batch' | 'operator-console'` (ADR-084 section 5,
// ADR-096 clause 3), a request handler is neither, and ADR-109 clause 1 refused
// to widen that vocabulary to solve what turned out to be a predicate problem.
// A door declared here would be a door somebody uses, and the two things this
// surface genuinely cannot reach (see `auth-backend.ts`'s header) are not made
// reachable by a third word.
//
// -----------------------------------------------------------------------------
// THE CAST IS HERE AND IT IS HERE ONCE
// -----------------------------------------------------------------------------
// `IdentityId` is `string & { readonly __brand: 'IdentityId' }` and
// `packages/db` exports the TYPE and no constructor for it, so every caller
// outside that package writes an assertion. One assertion in one file, guarded
// by a shape check, is the smallest version of that: `scopedTx` refuses a value
// that is not a UUID before the accessor ever sees it, so a malformed identity
// is an exception here rather than a `WHERE identity_id = 'nonsense'` that
// returns zero rows and reads like an empty account.
//
// **A CONSTRUCTOR IN `packages/db` WOULD BE STRICTLY BETTER AND IS NOT THIS
// SESSION'S**, on ADR-112 section 10's own precedent about `RowAddress<K>`: the
// first caller that needs an export adds it, and this caller does not need one,
// it needs a cast it can put a guard in front of. Reported rather than taken.
//
// -----------------------------------------------------------------------------
// WHY THE DOORS ARE AN INTERFACE AND NOT TWO FREE FUNCTIONS
// -----------------------------------------------------------------------------
// `transaction()` opens a real connection out of a real pool the first time it
// is called, and `client()` throws when `DATABASE_URL` is unset. Every adapter
// in this deployable would therefore be untestable except against a live
// database, and `ci.yml`'s `integration` job has none (ADR-102 section 16,
// ADR-112 section 9, and now `VG-3` and `VG-6`'s artifact). So the two doors are
// a parameter with a live default, and a suite substitutes a recorder.
//
// WHAT THAT SEAM CAN AND CANNOT PROVE, STATED HERE RATHER THAN LEFT TO BE
// ASSUMED. A recorder proves the things that are THIS package's: which door was
// opened, whose identity was handed to it, which key and which address were
// named, and which values were written. It proves NOTHING about whether the
// composed predicate reaches one row or many, because that is `packages/db`'s
// and is asserted in `packages/db/test/keyed-accessor.test.ts`. A suite that
// tried to prove it here would be agreeing with its own fake.
// =============================================================================

import { firmDb, scopedDb, transaction } from '@merit/db';
import type { FirmTx, IdentityId, ScopedTx } from '@merit/db';

/** Raised when a door is asked for something it must not guess about. */
export class DbDoorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbDoorError';
  }
}

/**
 * The shape of a UUID, which is what every identity column in this schema is.
 *
 * `identities.id` is `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
 * (`0002_identity.sql`), so a value that is not one cannot name a row and the
 * accessor should never be handed it. Version and variant nibbles are NOT
 * pinned: `gen_random_uuid()` produces v4 and a merged or seeded estate may
 * legitimately hold others, and refusing those would be this file inventing a
 * constraint the database does not carry.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a string can address an identity at all. Exported for the suite. */
export function isIdentityId(value: string): boolean {
  return UUID.test(value);
}

/**
 * The two doors this deployable opens onto the trader database.
 *
 * Each takes the whole unit of work rather than handing back a handle, so a
 * transaction cannot outlive the function that opened it and no caller has a
 * `commit` to forget.
 */
export interface ApiDb {
  /**
   * Everything done on behalf of a resolved caller.
   *
   * THE IDENTITY IS THE ONE THE HANDLER RESOLVED AND NEVER ONE OFF A REQUEST.
   * That is a property of every call site rather than of this signature, and it
   * is the property the suite asserts, because it is the one that fails in the
   * direction ADR-008 was accepted for.
   */
  scoped<T>(identityId: string, fn: (tx: ScopedTx) => Promise<T>): Promise<T>;

  /** Rows that belong to nobody. `FirmTableKey` and nothing else. */
  firm<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T>;
}

/**
 * The doors, opened onto the real pool.
 *
 * Three lines of delegation and one guard, which is the whole of what this
 * package adds to the accessor.
 */
export const LIVE_DB: ApiDb = {
  // `async` SO THE GUARD REJECTS RATHER THAN THROWING SYNCHRONOUSLY. A method
  // whose type says `Promise<T>` and which sometimes throws before returning one
  // is the shape a caller writing `db.scoped(...).catch(...)` gets wrong, and
  // this guard is the only path that could ever do it.
  async scoped<T>(identityId: string, fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
    if (!isIdentityId(identityId))
      throw new DbDoorError(
        'a scoped door needs an identity, and the value it was given is not a uuid. Refusing ' +
          'before the accessor rather than passing it through to a predicate that would match ' +
          'no row and read like an empty account',
      );
    return await transaction(scopedDb(identityId as IdentityId), fn);
  },
  firm<T>(fn: (tx: FirmTx) => Promise<T>): Promise<T> {
    return transaction(firmDb(), fn);
  },
};
