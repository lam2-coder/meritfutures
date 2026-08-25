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

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema.ts';

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
