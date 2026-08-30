// =============================================================================
// packages/db
// =============================================================================
// Schema, migrations, and `scopedDb(identity)`: the one sanctioned data
// accessor (ADR-008, accepted, with the wrapper and the ESLint ban part of the
// acceptance rather than a follow-up).
//
// THIS PACKAGE IS THE ONLY ONE PERMITTED TO IMPORT THE DRIZZLE CLIENT, and that
// is what makes VG-4 writable at all: "a custom ESLint rule banning raw client
// imports in app paths" (STRATEGY section 4.2) is expressible only if app paths
// are a glob and exactly one package is the exception. THE RULE IS WIRED
// (session S-C): `merit/no-raw-db-client`, attached in the workspace root's
// eslint.config.js to `apps/**` and `packages/**` with `packages/db/**` as the
// single `ignores` entry. It did not wait for `scopedDb`, because what it bans
// is fixed today and what it points at is this package.
//
// BOTH HALVES NOW EXIST (ADR-084, session 145). The scaffold said "NEITHER THE
// CLIENT NOR THE ACCESSOR EXISTS YET" and fixed only that they would live here;
// they live here.
//
// `client()` IS DELIBERATELY NOT RE-EXPORTED. It is reachable inside this
// directory and nowhere else, so for every caller in the workspace "reach the
// database" and "choose a scope" are the SAME ACT. Exporting it would leave the
// ESLint rule as the only thing standing between an app and an unscoped query,
// and a lint rule is a control a `// eslint-disable-next-line` can route around.
//
// A TABLE IS REACHABLE ONLY IF SOMEBODY WROTE ITS RULE, AND THE REST ARE A
// COMPILE ERROR AT THE CALL SITE rather than an unscoped read at run time. A
// table joins the reachable set by getting a rule written by a person, which is
// a diff on `scope.ts` forever. That is the cost and it is the point.
//
// THIS PARAGRAPH USED TO STATE THE SIZE OF THE REGISTRY AND THE FIGURE WENT
// STALE IN THE DIRECTION THAT UNDERSTATES THE TREE. It read "SEVEN TABLES OF
// 111 ARE REACHABLE ... The other 104 have no rule", written when seven had one;
// the two numbers have since traded places and the sentence read as though the
// registry had shrunk. `test/scoped-db.test.ts` COMPUTES the figure from
// `TABLES` and `SCOPE_RULES` rather than stating it, which is ADR-034's rule
// applied to a comment, so the count is not restated here.
//
// MIGRATIONS ARE NOT SOURCE. `migrations/` is plain reviewable SQL, forward
// only, reviewed on `main`, never edited after merge, only superseded
// (constitution E2). It is excluded from this package's tsconfig, from ESLint,
// and from Prettier. Nothing compiles it and nothing generates it, and
// `drizzle-kit generate` is foreclosed permanently: the SQL is the source and
// `schema.ts` is the transcription, which is the inverse of the flow drizzle-kit
// exists to run.

export {
  scopedDb,
  systemDb,
  scopePredicate,
  type IdentityId,
  type ScopedDb,
  type SystemDb,
  type SystemReason,
} from './scoped-db.ts';

// THE WRITE PATH (ADR-102). `scopedDb` and `systemDb` are UNCHANGED and remain
// read only: a write is reached only through `transaction(handle, fn)`, which is
// `job-queue.ts`'s own ruling about `enqueue` applied to the accessor. ADR-006's
// consequence -- that enqueue rides the same transaction as the state change
// that caused it -- is structural here rather than remembered at a call site.
//
// `firmDb()` is the THIRD DOOR and it takes no reason. `systemDb(reason)` reads
// EVERYBODY's rows without their identity; `firmDb()` reads rows that belong to
// NOBODY, and the question a reason answers does not arise about those.
// `SystemReason` stays at two members, which is ADR-096 clause 3 kept.
//
// `SqlExecutor` is the shape `packages/queue`'s `JobTransaction` declares, and
// `transaction()` is its only producer. Nothing in this workspace could enqueue
// a job before it existed. NEITHER PACKAGE DEPENDS ON THE OTHER and the two
// shapes are bound by an assertion in `test/write-accessor.test.ts` that reads
// `job-queue.ts` rather than restating it.
// `tenancyColumns` is the plural and `tenancyColumn` reads it (ADR-106). The
// list exists because a `pair` row has TWO tenancy columns, and the guard that
// refuses a caller naming one has to refuse the caller naming the other.
export {
  firmDb,
  transaction,
  tenancyColumn,
  tenancyColumns,
  type FirmDb,
  type FirmTx,
  type OwnedTableKey,
  type ScopedTx,
  type SqlExecutor,
  type SqlExecutorReason,
  type SystemTx,
  type WriteValues,
} from './scoped-db.ts';

// THE FILTER TERMS (ADR-157). A read may narrow by a range or by `IS NULL` and
// a write may not, so these are exported and there is nothing here a write path
// could reach for. `atMost`, `atLeast` and `isNull` are the ONLY producers of a
// term in this workspace and `isFilterTerm` is the only reader of the set they
// mint into, which is what makes "a jsonb value that looks like a term is a
// value" true rather than hoped for.
//
// THE LOCK IS NOT EXPORTED HERE AND DOES NOT NEED TO BE. `lockAt` and
// `lockScope` are methods on the transaction handles, which a caller already
// reaches through `transaction(handle, fn)`; ADR-112 section 10 records the same
// fact about `updateAt` and the same consequence, that a caller wanting to
// DECLARE a variable of one of these types adds the line.
// THE TWO DOORS THAT CREATE A SCOPE RATHER THAN EXERCISE ONE (ADR-126, ADR-197).
//
// `resolutionDb` LANDED WITH ADR-126 AND WAS NEVER EXPORTED, WHICH IS WHY
// ADR-196 MEASURED THAT IT "HAS NO CALLER ANYWHERE IN `apps/`". Its docblock
// says it exists "because `POST /auth/verify` must turn the address a person
// typed into the identity that owns it", and that endpoint could not import it:
// `apps/api/src/db.ts` is the one file in that deployable that takes a handle off
// this package, it takes them from here, and this list did not carry the door.
// The refusal string in `auth-backend.ts` that cites a missing pre-identity read
// was therefore true of the PACKAGE SURFACE for as long as it was false of the
// package. ADR-197 finding 1.
//
// `establishmentDb` IS THE WRITE SIBLING AND IT IS NARROWER THAN A TABLE LIST.
// `EstablishmentTx` carries one verb, so what is exported here is an ACT and not
// an authority: nothing reachable through it can write an `identities` row
// without the `users` row ADR-196 clause 2 binds to it.
//
// `normalizedEmail` IS EXPORTED BECAUSE `otp_challenges.email_normalized` NEEDS
// THE SAME FUNCTION. The challenge is keyed on the normalized address before any
// user exists, and two spellings of one entity-resolution key is the drift the
// column's own comment is written against.
export {
  establishmentDb,
  normalizedEmail,
  resolutionDb,
  IdentityAlreadyEstablished,
  RESOLUTION_ADDRESS,
  type EstablishedIdentity,
  type EstablishmentAddress,
  type EstablishmentDb,
  type EstablishmentTx,
  type ResolutionAddress,
  type ResolutionDb,
  type ResolvableTableKey,
} from './scoped-db.ts';

// THE DOOR THAT EXERCISES A SCOPE NOBODY HOLDS (ADR-231).
//
// `publicLookupDb` IS THE FIFTH AND IT IS THE FIRST THAT READS AN `owned` ROW
// FOR A CALLER WHO WILL NEVER BE ANYBODY. The four above it divide into "the
// caller is somebody" and "the caller is about to be somebody"; `GET
// /verify/:code` is neither, and a certificate a stranger cannot read is not a
// certificate. Its vocabulary is `(table, column)` on `RESOLUTION_ADDRESS`'s
// own shape, and the column half is the control: a member of
// `PUBLIC_LOOKUP_ADDRESS` is an assertion that the named column is unguessable,
// because the address is the entire predicate and there is no tenancy conjunct
// to fall back on.
//
// IT IS EXPORTED WITH ITS CALLER RATHER THAN AHEAD OF ONE, which is ADR-197
// finding 1 read as a rule instead of as a mistake: `resolutionDb` landed
// unexported and a refusal string in `auth-backend.ts` cited a missing
// pre-identity read that had existed for months. `apps/api/src/db.ts` takes this
// value in the same slice that adds it.
//
// THERE IS NO `transaction` OVERLOAD FOR IT and that absence is the ruling. A
// door open to a caller who has proved nothing reaches no write at any
// authority, because `transaction` is the only thing in that file that makes a
// statement a unit of work.
export {
  publicLookupDb,
  PUBLIC_LOOKUP_ADDRESS,
  type PublicLookupAddress,
  type PublicLookupDb,
  type PubliclyLookedUpTableKey,
} from './scoped-db.ts';

// THE CATALOGUE READ A SCOPED TRANSACTION CARRIES (ADR-233).
//
// IT IS NOT A SIXTH DOOR AND THAT IS THE WHOLE OF ITS SHAPE. The five doors
// above are ways to REACH the database; this is three read verbs on a handle a
// caller already holds, over a CLOSED LIST of five `firm` keys, so nothing here
// widens who may open anything. What it changes is WHICH TRANSACTION a
// catalogue read runs in, which is the one property `firmDb()` cannot give a
// port that runs every method on one transaction.
//
// THE LIST IS EXPORTED BESIDE THE TYPE BECAUSE A SUITE MUST BE ABLE TO ASSERT
// ITS BOUNDS. `CATALOG_TABLE_KEYS` is what `packages/db/test/catalog-read.test.ts`
// measures against `FirmTableKey` and against `SCOPE_RULES`, and a narrowness
// nobody can enumerate is a narrowness nobody can watch shrink.
export { CATALOG_TABLE_KEYS, type CatalogTableKey } from './scoped-db.ts';

export { atLeast, atMost, isFilterTerm, isNull, type FilterTerm } from './scoped-db.ts';

export {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  type DerivedRule,
  type FirmRule,
  type FirmTableKey,
  type OwnedRule,
  type PairCounterparty,
  type PairRule,
  type PairWriter,
  type RootRule,
  type ScopeClass,
  type ScopeRule,
  type ScopedTableKey,
  type TableKey,
} from './scope.ts';

// THE MINT FOR THE ONE COLUMN AN UNAUTHENTICATED CALLER MAY ADDRESS (ADR-235).
//
// `PUBLIC_LOOKUP_ADDRESS` above asserts that `certificates.code` cannot be
// guessed. NOTHING IN THIS TREE PRODUCED SUCH A CODE until this export existed:
// no `INSERT` reaches `certificates` from any deployable, so the 128 bits
// `INV-M11-05` commits to were a property of a function nobody had written. The
// mint is exported HERE rather than from the issuer, because `M11:111` puts the
// issuer in the worker and ADR-231 put the verifier in the api, and `@merit/db`
// is the only package both deployables already declare.
//
// IT IS EXPORTED AHEAD OF ITS CALLER, WHICH IS THE OPPOSITE OF THE RULE THE
// DOOR ABOVE FOLLOWS, and the difference is what each thing costs when it sits
// unused. An unexported accessor is an authority nobody can reach, which
// ADR-197 finding 1 shows gets misreported as absent; an unexported mint is a
// security parameter the next slice re-invents under deadline. `RI-22` executes
// this function on every `CI-01` pass and measures what it actually returns.
export {
  CERTIFICATE_CODE_ALPHABET,
  CERTIFICATE_CODE_ENTROPY_BITS,
  CERTIFICATE_CODE_LENGTH,
  mintCertificateCode,
} from './certificate-code.ts';

export * as schema from './schema.ts';

// The pool's lifecycle, for a process that means to exit and for an integration
// suite that would otherwise hold the event loop open. `client()` itself stays
// unexported.
export { closeClient } from './client.ts';
