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
import {
  environmentCertificateRateLimiter,
  useCertificateRateLimiter,
} from './certificate-rate-limit.ts';
import { LIVE_DB } from './db.ts';
import { main } from './index.ts';
import { databaseAccountReads, useAccountReadsBackend } from './routes/account-reads.ts';
import { databaseAccountsBackend, useAccountsBackend } from './routes/accounts.ts';
import { useAuthBackend } from './routes/auth.ts';
import { databaseCatalogReads, useCatalogReads } from './routes/catalog.ts';
import {
  databaseCertificateBackend,
  useCertificateBackend,
  useCertificateImageSource,
} from './routes/certificates.ts';
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
// THIS PARAGRAPH READ "TWO OF THE THREE CONTROLS THIS ROUTE RESTS ON NOW EXIST
// AND THE THIRD DOES NOT ... the rate limit per IP and per ASN that
// `INV-M11-05` requires in its own words and `API_CONTRACT:1473` rows as data
// EXISTS NOWHERE IN THIS TREE", and ADR-347 landed the part of it that is real,
// so it is amended in place rather than deleted. TWO CORRECTIONS, BOTH
// MEASURED. The first is the citation: section 11's `GET /verify/:code` row is
// at `API_CONTRACT:1506` on this tree and `:1473` lands in section 9's ops
// table, which is the drift `RI-15` and `RI-16` exist for and this file holds
// repair rights over. The second is the claim itself.
//
// THE THIRD CONTROL NOW EXISTS IN ONE OF ITS TWO DIMENSIONS AND THE OTHER IS
// STILL OWED. `src/certificate-rate-limit.ts` holds a PER-IP limit over this
// row, installed below, whose numbers are the deployment's and whose absence is
// a `503` rather than an unmetered route (ADR-226). THE PER-ASN DIMENSION
// EXISTS NOWHERE IN THIS TREE and ADR-347 records it owed with its blocker
// named: an ASN is not observable from a socket, no data source in this
// workspace maps an address to one, `certificate_verifications` has no column
// for it, and the egress that would reach a public resolver is refused. ADR-235
// section 5 still rules the clause owed rather than discharged for that half,
// because no arithmetic about the code space discharges a clause of the
// invariant that names a limit.
//
// AND WHAT THE PER-IP HALF IS WORTH IS WRITTEN WHERE IT IS PAID. `request.ip`
// is the immediate peer, because `server.ts:170` configures no `trustProxy`, so
// the dimension is a real per-caller limit exactly while this origin is reached
// directly and becomes a global one with a per-IP name the day it is not.
// SECURITY C-07 rows this control as "edge and app" and only the app half is in
// this repository.
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
// CHEAP: a PNG encode sits on an unauthenticated public path. ADR-261 ships
// UNSIGNED and this is the sentence a founder is asked to read.
//
// THE REST OF THAT SENTENCE READ "`FM-M11-05`'s cache is owed and unbuilt, and
// the rate limit per IP and per ASN that `INV-M11-05` requires in its own words
// EXISTS NOWHERE IN THIS TREE", AND ONE HALF OF IT IS NO LONGER TRUE. ADR-347
// built the limit this row's own section 11 line names, PER IP AND PER `code`,
// installed below and refusing `429` with `Retry-After` when either is spent;
// its numbers are the deployment's and an absent one answers `503` for every
// code alike. WHAT IS STILL OWED IS `FM-M11-05`'s CACHE, unbuilt, so every
// admitted fetch is still a full encode; ADR-347 declined it deliberately rather
// than by omission, because a cache keyed `(code, row_version)` puts a timing
// difference between two VALID codes and is a different control with its own
// ruling to take.
//
// THE LIST ROW IS NOT WIRED BY THIS LINE AND MUST NOT BE READ AS RELEASED BY
// IT. `useCertificateBackend` waits on an origin AND on a guard that makes
// `links`' refusal state-independent, and the second is code (ADR-261 section 5).
useCertificateImageSource(databaseCertificateImageSource(LIVE_DB));

// `GET /certificates`, over the SCOPED door. ADR-266.
//
// IT IS THE SECOND OF TWO AND THE ORDER IS A RULING RATHER THAN A LAYOUT.
// ADR-246 read the two card ports as ONE deliverable that would "expire together
// or not at all"; ADR-256 ruling 13 narrowed that to expire in ORDER, with this
// row DOWNSTREAM of the image row above. The sentence that kept this line out of
// this file for four entries was "publishing a link to a trader is publishing a
// promise that bytes are there", and the line above is what discharges it. Wired
// the other way round, this row would have published the promise first.
//
// THE READ WAS NEVER BLOCKED AND THE GUARD WAS. `certificates` is `class:
// 'owned'` on `identity_id`, so `db.scoped` has served this arm since the route
// landed. What refused was ADR-246 clause 8: `projectCertificate` never calls
// `links` for a deferred row (ADR-168 foreclosure 4), so a live read beside a
// refusing signer answers 200 to a trader whose certificates are all deferred
// and 503 to the trader beside them whose certificate issued, and THAT IS A
// RESPONSE DECIDED BY THE STATE OF THE CALLER'S OWN ROWS. ADR-261 section 5
// ruled the remedy is code rather than configuration and left it unwritten.
//
// SO THE ORIGIN IS READ IN THE READ ARM, BEFORE THE ACCESSOR IS OPENED, which
// is the line above's own timing control at a port with two arms instead of one.
// A deployment that has not set `MERIT_PUBLIC_ORIGIN` answers 503 to every
// caller of this row identically and the scoped door is never opened, asserted
// on the recorder's call list being EMPTY rather than on the status codes.
// ADR-012 keeps the value out of this repository, and ADR-249 section 3 is why
// there is no key beside it: the card carries no signature at all.
//
// AND THE COST THIS LINE ADDS TO THE ONE ABOVE, NAMED WHERE IT IS PAID. The
// image row is a PNG encode on an unauthenticated path; this row is what puts
// its address in front of every trader who opens their certificates page, so the
// traffic ADR-261's founder block accepted in principle is the traffic this line
// invites. ADR-266 ships UNSIGNED and this is the sentence a founder is asked to
// read beside the one above it.
//
// THIS PARAGRAPH READ "with no rate limit and no cache ... `INV-M11-05`'s limit
// per IP and per ASN still EXISTS NOWHERE IN THIS TREE and `FM-M11-05`'s cache
// is still owed", AND IT IS AMENDED RATHER THAN DELETED. The image row now
// carries a per-IP and per-`code` limit (ADR-347, installed below); the PER-ASN
// dimension `INV-M11-05` names for the VERIFY row and `FM-M11-05`'s cache are
// both still owed, each with its blocker written in the entry.
//
// AND THIS ROW IS NOT ITSELF RATE LIMITED, WHICH IS THE CONTRACT'S CHOICE
// RATHER THAN AN OMISSION. `GET /certificates` is `Auth: session`, scoped to the
// caller's identity, so section 11 answers it under "Authenticated reads,
// 120/minute/identity" and NOT under either public certificate row. That limit
// is a fourth thing this tree does not have, it is owed by whatever slice takes
// the authenticated surface, and ADR-347's fence stops at the two public rows.
useCertificateBackend(databaseCertificateBackend(LIVE_DB));

// `INV-M11-05`'s rate limit, over the two PUBLIC certificate rows above.
// ADR-347.
//
// IT IS NOT A DATABASE PORT AND IT IS INSTALLED HERE ANYWAY, which is worth one
// sentence because every other line in this file installs a door. What this one
// installs is a COUNTER plus the deployment's numbers, and it belongs here for
// the reason this file's header already gives: `index.ts` is the package's
// `exports` target and importing it must have no effect, so a module-level
// default that counted on import would give every suite that imports a route a
// limiter it did not ask for. A process that never ran this file holds
// `UNWIRED_CERTIFICATE_RATE_LIMITER` and answers 503 on both public rows,
// exactly as it does for auth.
//
// AND IT IS THE LAST INSTALL RATHER THAN THE FIRST FOR NO ORDERING REASON AT ALL.
// It is not the last LINE. `await main()` is, two below it, and every install
// belongs above it. Nothing above reads the limiter and the limiter reads
// nothing above it; the header rules that conflict an APPEND, and this is one.
useCertificateRateLimiter(environmentCertificateRateLimiter());

await main();
