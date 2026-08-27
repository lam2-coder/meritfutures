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
// EVERY ROUTE SLICE THAT WIRES AN ADAPTER APPENDS HERE, AND THIS FILE IS
// THEREFORE THE ONE SHARED FILE THE CONCURRENT ROUTE SESSIONS COLLIDE ON. It is
// not the route registry: `registry.ts` made the module list a directory
// listing precisely so that a slice adding a route edits nothing another slice
// edits, and it succeeded. Installing a BACKEND is the part that has no
// directory to read, because a backend is a choice about a deployment rather
// than a file on disk. THE CONFLICT IS AN APPEND: keep every line, order by
// module name, and let `tsc` catch a bad resolution.
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
import { databaseAccountReads, useAccountReadsBackend } from './routes/account-reads.ts';
import { databaseAccountsBackend, useAccountsBackend } from './routes/accounts.ts';
import { useAuthBackend } from './routes/auth.ts';
import { databaseCatalogReads, useCatalogReads } from './routes/catalog.ts';
import { databaseMethodDefinitions, setMethodDefinitionSource } from './routes/public-methods.ts';
import { databaseWalletBackend, useWalletBackend } from './routes/wallet.ts';

useAuthBackend(databaseAuthBackend(LIVE_DB));
useAccountsBackend(databaseAccountsBackend(LIVE_DB));

// Section 6's four sub-resource reads of one account. ONE OF THE FOUR IS SERVED
// end to end and three refuse by name with the blocker measured, so this line
// installs a backend that answers `/marks` from real rows and answers 503 on
// `/timeline`, `/eligibility` and `/certificate` rather than serving a fixture.
// `routes/account-reads.ts` carries the three blockers at file and line.
useAccountReadsBackend(databaseAccountReads(LIVE_DB));

// The catalogue and the purchase list, over the SAME two doors. `catalog.ts`
// holds both halves of its port and this is the one line that installs them; a
// process that never ran this file answers 503 on all three of its routes and
// says so, exactly as it does for auth.
useCatalogReads(databaseCatalogReads(LIVE_DB));

// `GET /wallet` and `GET /wallet/entries`, over the scoped door.
//
// IT IS ON THE MONEY PATH BY NAME AND IT MOVES NO MONEY, and the distinction is
// the whole of why this line is a line rather than a slice. `databaseWalletBackend`
// is `db.scoped(identityId, tx => tx.rows('walletEntries'))` and a clock: one
// read of one `owned` table, no write, no posting, no ledger handle. The balance
// is `balanceOf`, which is the greatest row's stored `balance_after_cents` and
// not a sum, so this installs a STATEMENT and never an authority to spend.
//
// THE WRITE HALF OF THE WALLET IS STILL 503 AND STAYS THAT WAY. `checkout.ts`'s
// debit arm needs a `LedgerTx`, `SystemReason` is `'nightly-batch' |
// 'operator-console'`, and ADR-165 refused to widen it. Wiring the read does not
// reach that and must not be read as having reached it.
useWalletBackend(databaseWalletBackend(LIVE_DB));

// `GET /public/methods/:statCode`, over the FIRM door.
//
// PUBLIC IN BOTH SENSES AND THEY ARE INDEPENDENT FACTS. The READER may be
// anybody, so no session is resolved; the ROW is nobody's, so
// `statistic_definitions` is scope class `firm` and the scoped door would not
// compile with that key. Nothing is withheld here because there is no field an
// identity filter would have had to remove.
setMethodDefinitionSource(databaseMethodDefinitions(LIVE_DB));

await main();
