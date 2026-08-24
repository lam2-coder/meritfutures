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
// SEVEN TABLES OF 111 ARE REACHABLE, AND THAT IS REPORTED RATHER THAN ROUNDED.
// The other 104 have no rule in `SCOPE_RULES`, so naming one is a COMPILE ERROR
// at the call site rather than an unscoped read at runtime. A table joins the
// reachable set by getting a rule written by a person, which is a diff on
// `scope.ts` forever. That is the cost and it is the point.
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
} from './scoped-db.js';

export {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  type DerivedRule,
  type FirmRule,
  type FirmTableKey,
  type OwnedRule,
  type RootRule,
  type ScopeClass,
  type ScopeRule,
  type ScopedTableKey,
  type TableKey,
} from './scope.js';

export * as schema from './schema.js';

// The pool's lifecycle, for a process that means to exit and for an integration
// suite that would otherwise hold the event loop open. `client()` itself stays
// unexported.
export { closeClient } from './client.js';
