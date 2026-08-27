// =============================================================================
// apps/api/src/start.ts
// =============================================================================
// The process entry point, and it is three lines on purpose.
//
// `index.ts` is this package's `exports` target, so importing it must have no
// effect: a test that imports `main` to assert on it must not thereby start a
// server on port 3000. The usual answer is an entry-point guard comparing
// `import.meta.filename` with `process.argv[1]`, which is a run-time string
// comparison that is right until something invokes the file by a symlink or a
// different real path, and which is invisible when it silently stops matching.
//
// A SEPARATE FILE HAS NO SUCH FAILURE MODE. `pnpm start` names this file, this
// file calls `main`, and `index.ts` stays a module that exports.
//
// -----------------------------------------------------------------------------
// IT IS ALSO THE WIRING SLICE, AND THAT IS WHY THE BACKEND IS INSTALLED HERE
// -----------------------------------------------------------------------------
// `useAuthBackend`'s own comment says "the wiring slice calls this; so does the
// suite", and this file is the wiring slice for the same reason it exists at
// all: `index.ts` is the package's `exports` target and importing it must have
// no effect. Installing a database-backed backend inside `main()` would give
// every test that calls `main` a backend whose first method call opens a socket,
// and `listen.test.ts` calls it.
//
// SO A DEPLOYMENT SERVES AUTH AND AN IMPORT DOES NOT, which is the same
// separation the port's fail-closed default already draws: a process that never
// ran this file holds `UNWIRED_AUTH_BACKEND` and answers 503 on every auth
// route, saying so rather than pretending. ADR-120.
//
// THE INSTALL IS BEFORE `main()` AND NOT AFTER, because `main` binds the port at
// the end of it. A window in which the process is listening and the backend is
// still the fail-closed default would serve 503 to real traffic for as long as
// the event loop took to come back around, which is a race nobody would ever
// reproduce and everybody would eventually see.
//
// -----------------------------------------------------------------------------
// THE PARAGRAPH THAT STOOD HERE SAID THIS SCRIPT COULD NOT RUN, AND IT CAN
// -----------------------------------------------------------------------------
// It recorded that every module under `apps/api/src` wrote `./x.js` specifiers
// for files that are `x.ts`, so `node --experimental-strip-types` died on this
// file's own import with `ERR_MODULE_NOT_FOUND`, and that the repair was two
// things together: the specifiers rewritten, and `allowImportingTsExtensions`.
// BOTH LANDED (`c8fc4d6`, and `tsconfig.base.json`), `RI-10` now asserts the
// first over every deployable's shipped source, and the finding is replaced
// rather than left beside a tree that refutes it.
// =============================================================================

import { databaseAuthBackend } from './auth-backend.ts';
import { LIVE_DB } from './db.ts';
import { main } from './index.ts';
import { useAuthBackend } from './routes/auth.ts';
import { databaseCatalogReads, useCatalogReads } from './routes/catalog.ts';

useAuthBackend(databaseAuthBackend(LIVE_DB));
// The catalogue and the purchase list, over the SAME two doors. `catalog.ts`
// holds both halves of its port and this is the one line that installs them; a
// process that never ran this file answers 503 on all three of its routes and
// says so, exactly as it does for auth.
useCatalogReads(databaseCatalogReads(LIVE_DB));

await main();
