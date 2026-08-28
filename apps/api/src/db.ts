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
// it, and this file is that answer.
//
// THIS PARAGRAPH SAID TWO THINGS THAT HAVE BOTH BEEN OVERTAKEN, AND ADR-171
// REPLACES THEM RATHER THAN LEAVING THEM BESIDE A TREE THAT REFUTES ONE AND A
// SUITE THAT REFUTES THE OTHER.
//
// IT SAID `grep -rln '@merit/db' apps/api/src` RETURNS EXACTLY THIS FILE. IT
// RETURNS TWO. `routes/account-reads.ts` imports `atMost` for the cursor bound
// on its timeline read, and `atMost` mints a frozen `FilterTerm`: it opens no
// connection, carries no reason and yields no handle. So the property worth
// stating is not that one file NAMES the accessor, it is that ONE FILE TAKES A
// HANDLE FROM IT, and that has always been the true sentence.
//
// AND IT SAID THE PROPERTY IS "a convention and it is not a control". IT IS A
// CONTROL NOW. `test/db.test.ts` pins which file may take which value off the
// accessor, and asserts separately -- first, and with a message naming the file
// and the name -- that no file but this one takes any of `firmDb`, `scopedDb`,
// `systemDb` or `transaction`. That case FOUND the drift above on its first
// run, months of sessions after this paragraph described a tree that had since
// moved, with every gate in the repository green over it. ADR-171.
//
// -----------------------------------------------------------------------------
// FOUR DOORS, AND THE ONE THAT IS STILL ABSENT IS THE ONE ADR-171 REFUSED
// -----------------------------------------------------------------------------
// `scoped(identityId, fn)`  every read and write a request handler makes on
//                           behalf of the caller it resolved.
// `firm(fn)`                the rows that belong to NOBODY. `otp_challenges` is
//                           the one this surface needs, and `scope.ts` calls it
//                           "the first `firm` row whose reason is TIMING rather
//                           than ownership": the challenge is written before
//                           anybody is anybody.
// `resolution(fn)`          the PRE-IDENTITY READ. One table, one address:
//                           `users` by `email`. ADR-126 built it "because
//                           `POST /auth/verify` must turn the address a person
//                           typed into the identity that owns it", and ADR-197
//                           exported it.
// `establishment(fn)`       the identity and its first login, in ONE unit of
//                           work. ADR-196 clause 2, ADR-197 ruling 3.
//
// THE LAST TWO ARE ADR-200 AND THEY DO NOT OVERTURN ADR-171 CLAUSE 1, WHICH IS
// ABOUT A DIFFERENT DOOR AND A DIFFERENT ARGUMENT. That clause refuses
// `operator(fn)`, and section 5 of that entry is why: a door over `SystemTx`
// would arrive on the object `databaseAuthBackend` already holds, and
// `db.operator(tx => tx.rowAt('users', { email }))` would then be ADR-120's B1
// answered at the reason word `'operator-console'`, inside a handler serving an
// anonymous request. THE TWO DOORS BELOW ARE THAT ARGUMENT'S OWN REMEDY RATHER
// THAN ITS CASUALTY: each is narrowed AT THE DOOR by a type in `packages/db`
// -- `ResolutionDb` reads one row of one table at one address and cannot be
// composed into a transaction at all, `EstablishmentTx` carries ONE VERB and no
// executor -- and `auth-backend.ts` is not a file they leak into, it is the
// caller they were built for and named for.
//
// THERE IS STILL NO `system(reason, fn)` HERE AND ITS ABSENCE IS STILL THE
// POINT. `SystemReason` is `'nightly-batch' | 'operator-console'` (ADR-084
// section 5, ADR-096 clause 3), a request handler is neither, and ADR-109
// clause 1 refused to widen that vocabulary to solve what turned out to be a
// predicate problem. ADR-171 section 9's condition -- that the door is takeable
// by the slice landing an `AdminSessionSource` -- is untouched by this file and
// no slice has met it.
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

import { establishmentDb, firmDb, resolutionDb, scopedDb, transaction } from '@merit/db';
import type { EstablishmentTx, FirmTx, IdentityId, ResolutionDb, ScopedTx } from '@merit/db';

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
 * The four doors this deployable opens onto the trader database.
 *
 * Each takes the whole unit of work rather than handing back a handle, so a
 * transaction cannot outlive the function that opened it and no caller has a
 * `commit` to forget. {@link ApiDb.resolution} keeps that shape even though the
 * handle behind it is not transactional, because the property worth holding is
 * that a handle never escapes the call.
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

  /**
   * The pre-identity read: `users` by `email`, one row or none.
   *
   * IT TAKES THE UNIT OF WORK AND NOT A HANDLE EVEN THOUGH `ResolutionDb` IS
   * NOT TRANSACTIONAL, and the shape is the point rather than a formality: the
   * handle stays inside the call, so no adapter can hold one and reach past its
   * own function. `packages/db` gives it no `transaction` overload, which is
   * ADR-126's own ruling that a pre-identity reader "can be composed into
   * nothing", and nothing here composes it.
   */
  resolution<T>(fn: (rx: ResolutionDb) => Promise<T>): Promise<T>;

  /**
   * The identity and its first `users` row, in ONE unit of work.
   *
   * `EstablishmentTx` CARRIES ONE VERB, so what this door grants is an ACT and
   * never an authority: there is no `insert`, no `updateAt`, no `rowAt` and no
   * `sqlExecutor` reachable through it. A caller cannot write an `identities`
   * row without the `users` row ADR-196 clause 2 binds to it, because the
   * statement that writes the first is the statement that writes the second.
   */
  establishment<T>(fn: (tx: EstablishmentTx) => Promise<T>): Promise<T>;
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
  // NO `transaction` HERE, BECAUSE THE ACCESSOR OFFERS NONE FOR THIS HANDLE AND
  // THAT ABSENCE IS ADR-126's RULING. The read is one statement on the pool and
  // the door exists so the handle does not outlive the call.
  resolution<T>(fn: (rx: ResolutionDb) => Promise<T>): Promise<T> {
    return fn(resolutionDb());
  },
  establishment<T>(fn: (tx: EstablishmentTx) => Promise<T>): Promise<T> {
    return transaction(establishmentDb(), fn);
  },
};
