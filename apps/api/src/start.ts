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
import { databaseCertificateImageSource } from './certificate-image-source.ts';
import { LIVE_DB } from './db.ts';
import { main } from './index.ts';
import { databaseAccountReads, useAccountReadsBackend } from './routes/account-reads.ts';
import { databaseAccountsBackend, useAccountsBackend } from './routes/accounts.ts';
import { useAuthBackend } from './routes/auth.ts';
import { databaseCatalogReads, useCatalogReads } from './routes/catalog.ts';
import { useCertificateImageSource } from './routes/certificates.ts';
import { databaseEconomicCalendar, setEconomicCalendarSource } from './routes/economic-calendar.ts';
import { databaseMethodDefinitions, setMethodDefinitionSource } from './routes/public-methods.ts';
import { databaseVerifySource, useVerifySource } from './routes/verify.ts';
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

// `GET /economic-calendar`, over the FIRM door, three reads in one transaction.
// ADR-240.
//
// THE PORT WAITED ON A CONFIGURED THRESHOLD AND NOT ON A DOOR, which is the
// distinction this line is worth reading for. ADR-209 registered
// `economic_calendar_current` and the read arm has been constructible since; the
// half that refused was `freshness.stale`, decided against a horizon that lives
// with the alarm. It has a NAME now,
// `MERIT_ECONOMIC_CALENDAR_HORIZON_TRADING_DAYS`, valued nowhere in this
// repository (ADR-012), and a deployment that has not set it answers 503 for
// every request identically rather than publishing a freshness verdict nobody
// decided. That is ADR-226's rule about an absent secret, applied to a threshold.
//
// AND THE STALENESS COMPARISON READS NO CALENDAR DATE. `databaseEconomicCalendar`
// counts the `trading_calendar` sessions that have not yet opened and whose
// trading day is still covered, and compares that count with the horizon; an
// instant is only ever compared with an instant and a day only with a day. That
// is what keeps ADR-146 clause 4 intact rather than repealed: the failure it
// forbids is a UTC calendar date derived from a clock meeting an exchange CT
// trading day, and no value in that adapter crosses between the two.
setEconomicCalendarSource(databaseEconomicCalendar(LIVE_DB));

// `GET /verify/:code`, over the FIFTH DOOR and the FIRM one. ADR-231.
//
// THE PAGE A FUNDED TRADER SHOWS THE WORLD, and it answered 503 until the scope
// system had a word for a public read of a row an identity owns. It has one now
// and it is narrow on purpose: `db.publicLookup` reaches `certificates` by
// `code` and nothing else, ever, by type. The trade this line does NOT make is
// resolving the identity from the code and opening `db.scoped` with it, which
// would have put an authority over that trader's payouts, accounts and wallet
// behind an unauthenticated route in exchange for one column of one row.
//
// THE COPY AND THE FLOOR COME FROM THE ENVIRONMENT AND NOTHING IS DEFAULTED. A
// deployment that has not set the seven variables answers 503 for every code
// identically, before the lookup, which is `readPresentation`'s own reason: a
// copy table read lazily would answer `unknown` in milliseconds and `valid` in a
// refusal, and that is a hit-versus-miss oracle built out of a configuration
// error. `INV-M11-03`'s unknown wording is NOT among them and cannot be set.
//
// THE CODE'S OWN STRENGTH IS SETTLED AT THE MINT AND NOT BY THIS LINE, and
// ADR-235 is where it was settled. When the door above landed, ADR-231 section 6
// recorded that `INV-M11-05`'s 128 bits was a corpus commitment no function in
// this repository produced: there was no minter, so the entropy of a certificate
// code was not a small number, it was undefined. There is one now,
// `mintCertificateCode` in `@merit/db`, at 130 bits from `node:crypto`, and
// `RI-22` EXECUTES it on every CI-01 pass and measures the draws rather than
// reading the source.
//
// TWO OF THE THREE CONTROLS THIS ROUTE RESTS ON NOW EXIST AND THE THIRD DOES
// NOT. The entropy is real and asserted; the `certificate_verifications` write
// below is real; the rate limit per IP and per ASN that `INV-M11-05` requires in
// its own words and `API_CONTRACT:1473` rows as data EXISTS NOWHERE IN THIS
// TREE. ADR-235 section 5 rules it owed rather than discharged, because no
// arithmetic about the code space discharges a clause of the invariant that
// names a limit.
//
// AND THE COLUMN IS STILL UNBOUNDED. `certificates.code` is `text NOT NULL`
// with no length or alphabet CHECK, so what defends this route is that the mint
// is the only writer in the tree and `RI-22` leg 3 keeps it that way. A bound in
// DDL is a migration and ADR-235 section 6.1 leaves it owed.
useVerifySource(databaseVerifySource(LIVE_DB));

// `GET /certificates/:code/image.png`, over the SAME two doors as the row above
// and one renderer. ADR-261.
//
// THE PORT WAITED ON A COMPOSITION AND NOT ON A DOOR OR A PRODUCER, which is
// the distinction this line is worth reading for and the one ADR-256 refused to
// blur. ADR-231 built the read, `db.firm` always held the append and ADR-256
// landed the renderer (`src/certificate-card.ts`); what did not exist was
// anything putting the three together, and ADR-226 and ADR-229 permit wiring
// only
// when the remaining gap is A THING THE DEPLOYMENT SETS. A composition is not
// such a gap. `src/certificate-image-source.ts` is it, and what is left is
// `MERIT_CERTIFICATE_CARD_MAX_AGE_SECONDS`, which is.
//
// THE COPY AND THE LIFETIME ARE READ BEFORE THE LOOKUP AND REFUSED IN FULL, for
// the reason the line above states about `readPresentation` and one that is
// sharper here: a DEFERRED code never renders (ADR-168 foreclosure 4), so a
// configuration check left inside the render would answer 404 for a deferred
// code and 500 for an issued one. That is a response decided by the state of
// the row the caller named, which is exactly what ADR-246 clause 8 refuses one
// port over. A deployment that has not set the seven verify variables or the
// lifetime answers 503 for every code identically.
//
// AND THE COST THAT IS A FOUNDER'S RATHER THAN THIS LINE'S, NAMED WHERE IT IS
// PAID. ADR-249 section 2.2 accepted in writing that render-on-fetch is compute
// an attacker can drive, and ADR-256's approval block says the acceptance "was
// cheap while the render did not exist". THIS LINE IS WHERE IT STOPS BEING
// CHEAP: a PNG encode now sits on an unauthenticated public path, `FM-M11-05`'s
// cache is owed and unbuilt, and the rate limit per IP and per ASN that
// `INV-M11-05` requires in its own words EXISTS NOWHERE IN THIS TREE. ADR-261
// ships UNSIGNED and this is the sentence a founder is asked to read.
//
// THE LIST ROW IS NOT WIRED BY THIS LINE AND MUST NOT BE READ AS RELEASED BY
// IT. `useCertificateBackend` waits on an origin AND on a guard that makes
// `links`' refusal state-independent, and the second is code (ADR-261 section 5).
useCertificateImageSource(databaseCertificateImageSource(LIVE_DB));

await main();
