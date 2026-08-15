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
// NEITHER THE CLIENT NOR THE ACCESSOR EXISTS YET, and the scaffold does not
// invent them. What it fixes is that they will live here and nowhere else.
//
// MIGRATIONS ARE NOT SOURCE. `migrations/` is plain reviewable SQL, forward
// only, reviewed on `main`, never edited after merge, only superseded
// (constitution E2). It is excluded from this package's tsconfig, from ESLint,
// and from Prettier. Nothing compiles it and nothing generates it.

/** The identity every query is scoped by. Nothing reads a table unscoped. */
export type IdentityId = string & { readonly __brand: 'IdentityId' };

/**
 * The accessor's shape, declared so that the boundary exists before the
 * implementation does.
 *
 * Every query in the system goes through a value of this type, which is what
 * makes the BOLA blast radius reviewable: the scope is applied in one place
 * rather than remembered at each call site. The methods arrive with the client.
 */
export interface ScopedDb {
  readonly identityId: IdentityId;
}
