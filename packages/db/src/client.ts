// =============================================================================
// packages/db/src/client.ts
// =============================================================================
// THE ONLY FILE IN THE WORKSPACE THAT IMPORTS `pg`. Everything else reaches the
// database through `scopedDb(identity)` or `systemDb(reason)`, and the ESLint
// rule `merit/no-raw-db-client` makes that mechanical rather than a convention:
// it is attached in the workspace root's eslint.config.js to `apps/**` and
// `packages/**` with `packages/db/**` as the single `ignores` entry.
//
// THE DRIVER IS `pg` AND ADR-006 DECIDES IT, NOT PREFERENCE. postgres.js is the
// better answer on VG-12 read in isolation: it installs 1 package where `pg`
// installs 14. It is refused because this is not in isolation. `pg-boss@12.27.0`
// declares `pg: ^8.22.0` in its own `dependencies`, and ADR-006's central
// consequence is that enqueue participates in the SAME TRANSACTION as the state
// change that caused it. A transaction is per-connection, so a second driver is
// a second pool, and that consequence stops being implementable. Session 147
// builds the queue on this pool.
//
// THE POOL IS LAZY, AND THAT IS LOAD-BEARING RATHER THAN TIDY. Importing this
// package must open no socket: the corpus gates, the golden loader and every
// unit test import `@merit/db` for its types, and a module-scope `new Pool()`
// would have each of them try to reach a database that is not there. The pool
// is created on first use and reused after.

import { Pool, types as pgTypes } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema.ts';

// =============================================================================
// A CALENDAR DAY HAS NO TIMEZONE, AND TWO LIBRARIES WERE GIVING IT ONE (ADR-271)
// =============================================================================
// ADR-268 section 7 MEASURED this by running both libraries, and it was live in
// every deployment whose process timezone was not UTC:
//
//   1. `pg` registers `postgres-date`'s `parseDate` for OID 1082. On a bare
//      `YYYY-MM-DD` that reaches `new Date(year, month, day)`, which is the
//      PROCESS'S LOCAL MIDNIGHT.
//   2. Drizzle's `PgDateString.mapFromDriverValue` then renders that `Date` with
//      `toISOString().slice(0, -14)`, which is UTC.
//
// A local midnight east of UTC is the PREVIOUS UTC day, so the database's
// `2026-08-28` arrived in Merit code as `'2026-08-27'`. That is ADR-146 clause
// 4's forbidden failure -- a UTC calendar date derived from a timestamp meeting
// an exchange CT trading day -- performed by two libraries before any Merit line
// runs, on all 52 `date` columns at once.
//
// THE DEFECT WAS ASYMMETRIC, WHICH IS HOW IT SURVIVED. A local midnight WEST of
// UTC is the same UTC day a few hours in, so every negative offset was silently
// correct. `America/Chicago`, the exchange's own zone, was one of the ones that
// never failed.
//
// WHY THIS IS THE REPAIR AND NOT A CORRECTION AT EACH READER. Drizzle ALREADY
// HOLDS THE CORRECT PATH and never takes it -- `PgDateString.mapFromDriverValue`
// returns a string argument untouched, and the only reason its `toISOString()`
// branch ever runs is that `pg` built a `Date` first. Handing back the wire text
// means no `Date` is ever constructed, drizzle takes the branch it already has,
// and the crossing has nowhere left to happen. A per-reader correction would
// have been the same defect multiplied once per reader, and the next `date`
// column added would have arrived broken with nothing to catch it.
//
// ONLY 1082. `1114` (`timestamp`) and `1184` (`timestamptz`) are deliberately
// untouched: Merit stores instants in UTC on purpose (CLAUDE.md), so an instant
// HAS a timezone and keeps the coercion a day must not get.
//
// IT REFUSES NOTHING, AND THAT IS THE DESIGN. A throw here would be a
// driver-level failure naming no column, no table and no rule. The parser's job
// is to stop INVENTING a value; the doors' own `YYYY-MM-DD` guards are what
// refuse one, by name. It is also strictly better than what it replaced on every
// malformed input: `infinity` used to arrive as the NUMBER `Infinity` and a
// non-ISO DateStyle as `null`, and both then died inside drizzle's mapper as
// "value.toISOString is not a function".
//
// WATCHED RED BEFORE GREEN in `packages/db/test/date-column-timezone.test.ts`,
// which runs the real registry and the real schema columns at five process
// timezones, and pinned tree-wide by `RI-25`.

/** `date`. The one OID this repair touches. */
const DATE_OID = 1082;

/**
 * The `date` parser: the wire text, verbatim.
 *
 * Exported so a test can hold the function itself rather than only the registry
 * entry, and named so that a stack trace through it says what it is.
 */
export function dateWireText(wire: string): string {
  return wire;
}

// AT MODULE SCOPE, BECAUSE THE PROPERTY MUST BE TRUE BEFORE THE FIRST QUERY AND
// NOT BEFORE THE FIRST POOL. `pg` looks a parser up per field at result-parse
// time, so this covers connections opened later and the `PoolClient` handles
// `scoped-db.ts` wraps for transactions. It opens no socket, which is the one
// thing this module's import is not allowed to do.
pgTypes.setTypeParser(DATE_OID, dateWireText);

let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

/**
 * The connection string, read at first use rather than at import.
 *
 * Read here and nowhere else. A second reader is a second place a deployment
 * can be configured, and INFRA names exactly one.
 */
function connectionString(): string {
  const value = process.env['DATABASE_URL'];
  if (value === undefined || value === '') {
    throw new Error(
      'DATABASE_URL is unset. packages/db opens no connection at import time, ' +
        'so this is the first call that needed one.',
    );
  }
  return value;
}

/**
 * The raw Drizzle handle.
 *
 * NOT EXPORTED FROM THE PACKAGE. `index.ts` re-exports the accessors and never
 * this, so "reach the database" and "choose a scope" are the same act for every
 * caller outside this directory. The two accessors in `scoped-db.ts` are its
 * only callers.
 */
export function client(): NodePgDatabase<typeof schema> {
  if (db === undefined) {
    pool = new Pool({ connectionString: connectionString() });
    db = drizzle(pool, { schema });
  }
  return db;
}

/**
 * Close the pool. For a process that means to exit, and for integration tests
 * that would otherwise hold the event loop open.
 */
export async function closeClient(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
