import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

// CI-02, the `unit` project.
//
// =============================================================================
// THE CHECK WHOSE ABSENCE LET SIXTEEN PORTS SIT UNWIRED WHILE EVERY GATE STAYED
// GREEN
// =============================================================================
// `apps/api` registers its routes from a DIRECTORY LISTING (`registry.ts`), so
// adding a route is adding a file and nothing has to be remembered. Installing
// a BACKEND has no directory to read, because a backend is a choice about a
// deployment rather than a file on disk, and `start.ts` is where that choice is
// written down. The two halves are therefore checked by different things: the
// route list by the filesystem, and the backend list by nobody.
//
// THE DEFECT THAT PRODUCED IS NOT A FAILING TEST, IT IS A PASSING ONE. Every
// port in this deployable is a module-scope variable holding a fail-closed
// default, and every suite installs its own fake before it asserts. So a port
// that `start.ts` never calls is INVISIBLE to the suite by construction: the
// tests pass against the fake, `tsc` sees a variable that is assigned, `eslint`
// sees a function that is exported and called, and the only observer that would
// have noticed is a request against a running deployment, which answers 503.
//
// SO THIS FILE READS `start.ts` AS TEXT. That is unusual and it is the point:
// there is no way to ask the module graph "which setters were called", because
// calling them is a side effect of importing the entry point, and importing the
// entry point binds a port (`start.ts`'s own header). Reading the source is the
// only observation available that does not start a server.
//
// -----------------------------------------------------------------------------
// WHY THERE IS A BLOCKED LIST AND WHY IT IS NOT A WEAKENING
// -----------------------------------------------------------------------------
// Most of these ports CANNOT be wired today, and the reasons are rulings rather
// than missing adapters: an identity provider this repository does not describe
// (ADR-171), a `SystemReason` that gains no member (ADR-165), a read shape the
// keyed accessor does not offer, a table absent from the registry, a vendor
// adapter that does not exist in this workspace. A test that demanded all twenty
// be wired would be a test somebody deletes.
//
// WHAT THE LIST DOES INSTEAD IS MAKE THE REASON A LIABILITY THAT EXPIRES. Each
// entry names the specific thing its port waits on, at file and line. Three
// assertions keep it honest:
//
//   1. A NEW PORT with no wiring and no entry FAILS. That is the regression this
//      file exists for.
//   2. AN ENTRY THAT IS ALSO WIRED FAILS, so the day a door lands the list must
//      shrink rather than quietly keep a stale excuse beside a live line.
//   3. AN ENTRY NAMING A PORT THAT NO LONGER EXISTS FAILS, so a rename cannot
//      leave a reason pointing at nothing.
//
// -----------------------------------------------------------------------------
// A NO-OP CALL IS NOT A WIRING, AND FOUR PORTS MAKE THAT REACHABLE
// -----------------------------------------------------------------------------
// `useAffiliateDeps`, `useKycDeps` and `useCheckoutAdapters` already hold their
// PRODUCTION value at module scope (`affiliate.ts:672`, `kyc.ts:284`,
// `checkout.ts:1211`), so calling their setter from `start.ts` would install the
// object that is already installed and change nothing a request sees. It would
// also make this file pass. THE REASON TEXT IS WHERE THAT IS RECORDED, so a
// later reader raising the count that way meets the sentence saying it is not a
// wiring before they meet the green tick.
//
// **THESE THREE LINE NUMBERS WERE REPAIRED BY TWO ROWS AT ONCE AND EACH GOT HALF
// OF IT RIGHT.** ADR-357 measured `affiliate.ts:615` and `checkout.ts:1211`;
// ADR-358 measured `affiliate.ts:672` and `checkout.ts:1051`. Neither was
// careless: each ran its measurement before the other's edits existed, and
// ADR-358's own additions to `affiliate.ts` are what moved 615 to 672.
// **CITATION REPAIR IS ITSELF SUBJECT TO THE MERGE PROBLEM**, which is worth
// saying beside `RI-15` and `RI-16` rather than only in a session log: a repair
// derived on a branch is as perishable as the citation it replaced. The three
// above are re-derived on the merged tree and belong to neither side.
//
// `useTurnstileVerifier` IS THE FOURTH AND IT IS NOT WAITING ON ANYTHING
// (ADR-226). Its module-scope default is the REAL Cloudflare verifier rather
// than a fail-closed stand-in, so the port is live with nothing installed, and
// an absent secret is a refusal rather than an unwired state. Its entry says so
// in those terms, because a reader who meets it beside THIRTEEN liabilities
// should not read it as a fourteenth.
//
// THOSE TWO WORDS READ "fifteen" AND "a sixteenth" AND ARE REPAIRED RATHER THAN
// DELETED (`RI-14`). Both were TRUE when written, against a `BLOCKED` of
// sixteen, and went stale the day the two card entries left it for the reason
// the next block states. Nothing went red, because a count spelled in prose is
// asserted by nobody: that is the drift `ADR-034` exists to end, arriving in
// the paragraph that explains why this port is not a liability.
//
// -----------------------------------------------------------------------------
// THE LIST HAS NOW SHRUNK TWICE ON THE SAME ARTEFACT, IN ORDER (ADR-261, ADR-266)
// -----------------------------------------------------------------------------
// BOTH CARD ENTRIES ARE GONE from below, which is assertion 2 above doing its
// job twice: `start.ts` installs `databaseCertificateImageSource` and
// `databaseCertificateBackend`, and a blocked port that is also wired fails.
//
// `useCertificateImageSource` WENT FIRST AND ITS LAST OBSTRUCTION WAS NOT A
// DOOR, A SECRET OR A VENDOR. ADR-231 built the read, `db.firm` always held the
// append and ADR-256 landed the renderer, and what did not exist was anything
// that put the three TOGETHER. ADR-256 ruling 12 named that gap and refused to
// wire past it, on the ground that ADR-226 and ADR-229 permit wiring when the
// last gap is a thing THE DEPLOYMENT SETS and "a composition that does not exist
// is not such a gap". ADR-261 wrote the composition.
//
// `useCertificateBackend` WENT SECOND AND THAT ORDER IS ADR-256 RULING 13.
// ADR-246 had read the two as ONE deliverable that would "expire together or not
// at all"; ruling 13 narrowed that to "expire in ORDER", with this one
// downstream, because the sentence keeping it shut was "publishing a link to a
// trader is publishing a promise that bytes are there" and it is the IMAGE port
// answering that discharges it. Its own last obstruction was a GUARD rather than
// a variable: `projectCertificate` never calls `links` for a deferred row, so a
// live read beside a refusing signer answered by the state of the caller's own
// rows (ADR-246 clause 8), and ADR-261 section 5 ruled that check is code rather
// than configuration. ADR-266 wrote it, in the read arm, ahead of the accessor.
//
// SO NEITHER ENTRY EXPIRED ON A VARIABLE, AND THAT IS THE PART WORTH KEEPING.
// Both were "one SMALLER slice from wireable rather than one VARIABLE from
// wired", and in both cases the slice was a piece of code somebody had to write.
// A reader tempted to close a remaining entry below by naming an environment
// variable should read those two sentences before deciding this one is like them.
// =============================================================================

const HERE = import.meta.dirname;
const ROUTES = join(HERE, '..', 'src', 'routes');
const SRC = join(HERE, '..', 'src');

/**
 * Every `export function useX(` / `setX(` in this deployable's source. The
 * founder's grep.
 *
 * THE THIRD CHARACTER CLASS IS `[A-Z]` AND IT USED TO BE `[A-Za-z]`, which
 * mattered the moment the scan below stopped being routes-only. A port setter is
 * `use` or `set` followed by the NAME OF A THING, so it capitalises; the loose
 * form also matches ordinary vocabulary that begins with those three letters,
 * and `auth-backend.ts` exports exactly one, `userAgentFamily`. Measured before
 * the change: over `src/routes` the two forms match the IDENTICAL set, so
 * nothing real is dropped and the only thing narrowed away is a false positive
 * this file would otherwise have to carry a `BLOCKED` excuse for.
 */
const DECLARES = /^export function ((?:use|set)[A-Z][A-Za-z]*)\(/gm;

/** Every top-level `useX(` / `setX(` call in `start.ts`. Same shape, same reason. */
const CALLS = /^((?:use|set)[A-Z][A-Za-z]*)\(/gm;

/** Every `export function databaseX(` / `export const databaseX =` in this deployable. */
const FACTORIES = /^export (?:function|const) (database[A-Za-z]+)\b/gm;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function tsFiles(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function matches(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

/**
 * Which module declares each port.
 *
 * `src/routes` AND `src` BOTH, AND THE SECOND JOINED ON A PORT THAT IS NOT A
 * ROUTE'S. This scan read `src/routes` alone until ADR-347, on the true
 * observation that a backend port belongs to the module whose routes refuse
 * without it. `useCertificateRateLimiter` belongs to TWO route modules at once
 * (`GET /verify/:code` and `GET /certificates/:code/image.png` are limited
 * separately by API_CONTRACT section 11 and by one counter), so declaring it in
 * either would have made the other import a port it half owns.
 *
 * THE GATE READS MORE OF THE TREE AND NOT LESS. Its stated regression is a
 * setter `start.ts` calls that NOTHING declares, which a rename leaves behind;
 * widening the scan keeps that assertion and extends the opposite one, that a
 * declared port is wired or is blocked with a reason, to the sibling modules
 * too. `tsFiles` filters to `.ts` and does not recurse, so `src/routes` is
 * reached by the second term rather than twice.
 */
const declaredIn = new Map<string, string>();
for (const [dir, label] of [
  [ROUTES, 'routes'],
  [SRC, 'src'],
] as const)
  for (const name of tsFiles(dir))
    for (const port of matches(read(join(dir, name)), DECLARES))
      declaredIn.set(port, label === 'routes' ? name : `../${name}`);

const startSource = read(join(SRC, 'start.ts'));
const wired = new Set(matches(startSource, CALLS));

/**
 * A port `start.ts` does not call, and the specific thing it waits on.
 *
 * EVERY REASON BELOW WAS READ OUT OF THE PRIMARY SOURCE IT CITES rather than
 * carried over from a summary. A reason that cannot be checked at the file and
 * line it names is worse than no list, because it retires the question.
 */
const BLOCKED: Readonly<Record<string, string>> = {
  // ---------------------------------------------------------------------------
  // THE ADMIN SURFACE, AND THE FIVE ENTRIES BELOW SAID THE WRONG THING UNTIL
  // ADR-171 READ THEM AT THEIR OWN DECLARATIONS.
  //
  // They said these five wait on the operator door: `systemDb('operator-console')`,
  // which `src/db.ts` declines to declare. ADR-171 was dispatched to open it,
  // measured what it would unblock, and REFUSED IT ON THE MEASUREMENT: the door
  // moves NONE of the five.
  //
  //   `setAdminSessionSource` is the SSO port itself, and HALF OF WHAT IT WAITED
  //   ON IS NOW IN THIS DATABASE (ADR-237). This block read "no door onto this
  //   database can serve it, because THE OPERATOR DIRECTORY IS NOT IN THIS
  //   DATABASE", which was true of every migration up to `0072` and is false of
  //   `0073`: `operators` and `operator_sessions` exist, the role set is a CHECK
  //   over API_CONTRACT section 8's closed three, and `admin_actions.actor` has
  //   a foreign key into the directory rather than being free text. WHAT IS
  //   LEFT IS AUTHENTICATION AND NOT THE DIRECTORY, which is one named thing
  //   and is named in the entry below.
  //
  //   `useAdminWriteBackend`, `useAdminPayoutBackend` and `useAdminWalletBackend`
  //   each require `principal(request)`, whose only resolver in this tree is that
  //   same session source, so all three reduce to the port above BEFORE any door
  //   is reached. Each carries at least one further blocker of its own.
  //
  //   `setAdminReadSource` SAID IN ITS OWN HEADER that what it is missing "is
  //   not an authority, it is a shape". THAT SENTENCE IS RETIRED (ADR-236) and
  //   this entry quoted it three citations deep: the header said it, this list
  //   quoted the header, ADR-171 section 4 read this list, and an ALLOCATION row
  //   read ADR-171. Six of the port's seven reads have producers today and none
  //   reaches `sqlExecutor`, so the missing thing IS the authority, which is the
  //   inverse of what the four of them said. `test/admin-read-constructibility.test.ts`
  //   derives that partition from source on every run, so the correction cannot
  //   go stale the way the claim it replaces did.
  //
  // `SystemReason` is `'nightly-batch' | 'operator-console'`
  // (`packages/db/src/scoped-db.ts:271`) and ADR-165 ruled it gains no member, so
  // the vocabulary was never the obstacle either. ADR-171 section 9 states the
  // condition under which the door becomes takeable: the slice that lands an
  // `AdminSessionSource` a deployment can install, because that is the first
  // moment the door has a caller that reaches a row.
  // ---------------------------------------------------------------------------
  setAdminReadSource:
    'THE OPERATOR DOOR, AND THE READ SHAPE IS NO LONGER SECOND BECAUSE IT IS NO LONGER A ' +
    'BLOCKER (ADR-236). This entry read "A READ SHAPE, and the door second", quoting a sentence ' +
    'in the port that was true when written and is now measured false for SIX OF SEVEN methods: ' +
    '`AdminReadSource` declares seven reads, `IMPLEMENTED_ADMIN_READS` names five, ' +
    '`adminReadSourceParts` supplies `exportEvidence` as a sixth, and not one producer reaches ' +
    '`sqlExecutor` or takes a handle off the accessor. ' +
    'WHAT IT WAITS ON IS AN `AdminSourceBackend`, whose one method takes a `SystemTx`, and ' +
    '`systemDb` is the only name in the accessor that yields one. `src/db.ts` declares no ' +
    '`operator(fn)` and imports no `systemDb`, ADR-171 clause 1 refuses to add it, and ADR-171 ' +
    'section 9 makes it takeable only by "the slice that lands an `AdminSessionSource` a ' +
    'deployment can install". SO THIS PORT REDUCES TO `setAdminSessionSource` TOO, one step ' +
    'further along than the four `principal(request)` backends do, and the SSO purchase blocks ' +
    'EIGHT entries in this list rather than the four ADR-171 counted. ' +
    'THAT FIGURE READ SIX AND IS REPAIRED RATHER THAN DELETED (`RI-14`, ADR-360 section 7). ' +
    'The two it omitted are `setInternalOpsSource`, whose `reconciliations` read waits on ' +
    'the same ADR-171 clause 1 door, and `useCheckoutBackend`, whose admin mutations ' +
    'resolve their principal through this port. NOTHING WENT RED, because a count spelled ' +
    'into a string is asserted by nobody, and `test/admin-read-constructibility.test.ts` ' +
    'was already deriving EIGHT beside it on every run. ' +
    'THE RETIRED FIGURE IS NAMED RATHER THAN QUOTED, on this file`s own precedent in ' +
    '`usePayoutBackend` below, and here the precedent has a second reason: the case that ' +
    'now binds this clause reads the sentence AROUND the number, and a reproduced original ' +
    'would hand it two answers. IT IS BOUND NOW, in both directions, by `the two prose ' +
    'counts of the SSO purchase are derived from BLOCKED rather than typed` further down ' +
    'this file. ' +
    'THE ONE THING HERE THAT IS NOT BEHIND THAT PURCHASE IS `readLiability`, WHICH IS STILL ' +
    'UNBUILT AND IS NOW BLOCKED ONE LAYER LOWER (ADR-269). This entry read that the figure ' +
    'holding the fold "is `eligible_next_7d`, whose last term is a `writeRuleState` ' +
    'implementation under `apps/worker/**` or `packages/**`". THAT CLAUSE IS FALSE AND IT IS ' +
    'FALSE BY MEASUREMENT: `writeRuleStateVia` is that implementation ' +
    '(`apps/worker/src/batch/state-writer.ts`), `postgresBatchPorts` composes it on ADR-250`s ' +
    'codec, `runNightlyBatch` calls it, and ADR-264 section 2 ran the batch against PostgreSQL ' +
    'and watched `rule_states` go from zero rows to one. All THREE terms of `liability.ts`s ' +
    '`B5` are spent -- ADR-206 cleared term 2 and ADR-208 term 3 -- AND THE FIGURE IS STILL ' +
    'NOT ON THE WIRE, which is a blocker that was stated one layer too high rather than a term ' +
    'left over. ' +
    'THE FOLD IS BUILT NOW. `src/admin-source/eligible-next-7d.ts` is the body those four ' +
    'readers never had: it reads the funded population, takes each account`s folded state ' +
    'through `ruleStateOn` (ADR-264), resolves the five R-41 vetoes through ' +
    '`resolveExternalGates`, and calls the engine`s `projectPayout` over the horizon and slice ' +
    '`liability.ts` already produced. ONE OF `PayoutProjectionInput`s FIVE INPUTS REFUSES AND ' +
    'IT IS `plan`, AND THE CLAUSE THAT SAID WHY IS FALSE IN EVERY PART OF IT (ADR-283). IT ' +
    'READ: "`plan_versions.rules` decodes into `PlanRulesJson` in exactly one place in this ' +
    'repository, `toPublishedRules` in `apps/worker/src/batch/adapter.ts`, `apps/api` cannot ' +
    'import it", and it ended "until that move lands". THE MOVE LANDED. ADR-239 slice A ruled ' +
    'the shared home and ADR-283 took it: `decodePlanRules` ' +
    '(`packages/rules-engine/src/plan/rules-codec.ts:472`) is declared there and re-exported ' +
    'from the engine`s index, this deployable ' +
    'has declared `@merit/rules-engine` since session 252, AND IT ALREADY CALLS THE DECODER -- ' +
    '`planLeg` (`apps/api/src/payout-backend.ts:415`) decodes the blob and resolves the plan ' +
    'on the payout transaction (ADR-308). The one-place half was wrong in the other direction ' +
    'too: the predicate is stated THREE times in this tree, by the engine, by ' +
    '`toPublishedRules` in `apps/worker` and by `decodeRules` in `apps/site`, and ' +
    '`test/rule-state-producibility.test.ts` link 7 holds that census at exactly three. ' +
    'THE FM-16 GROUND IS UNCHANGED AND IS WHY THIS FILE MAY STILL NOT WRITE A DECODER HERE: a ' +
    'second decoder of the blob that fixes every cents value a payout is decided against is ' +
    'FM-16 on the money path, and the engine`s is the statement the other two are owed to. ' +
    'WHAT THE FIGURE ACTUALLY WAITS ON IS SMALLER AND IS NOT A MOVE. The term is still ' +
    '`EligibleFoldIo.resolvePinnedPlan`, injected, whose unwired default throws ' +
    '`EligibleFoldUnwired` by name, and NOTHING under any `src/` in this deployable supplies ' +
    'it, so the fold refuses exactly as it did. What changed is the PRICE: a ruling nobody had ' +
    'taken became a call somebody writes on this port`s own composition, and this entry says so ' +
    'rather than letting a reader meet the retired sentence and size a money-path refactor. ' +
    'NO PORT IS WIRED BY ANY OF THAT and `readLiability` is still the one name missing from ' +
    '`IMPLEMENTED_ADMIN_READS`. ' +
    'SO `readLiability` IS STILL NOT COMPOSED, AND COMPOSING IT WOULD BE A LIVE-LOOKING FIGURE ' +
    'IN FRONT OF AN ARM THAT CANNOT ANSWER (`usePayoutBackend`s rule). ' +
    'AND THE FIGURE IS A FORECAST RATHER THAN A MEASUREMENT, WHICH THE WIRE TYPE CANNOT SAY: ' +
    '`EligibleNext7d` declares `total_cents`, `account_count` and `by_day[]` and NOT ONE ' +
    'MEASURED TERM, so there is no field a basis could ride on. The fold carries the basis on ' +
    'its own value instead (`ELIGIBLE_FIGURE_TERMS`), an empty `rule_states` is a REFUSAL ' +
    'rather than a zero liability, and `test/admin-source-eligible-next-7d.test.ts` derives ' +
    'both from the figure. `test/admin-read-constructibility.test.ts` holds every count in ' +
    'this entry and derives each from source.',
  setAdminSessionSource:
    'THE ADMIN IDENTITY PROVIDER, AND IT IS NOW THE ONLY THING LEFT (ADR-237). This entry read ' +
    '"NO DOOR ONTO THIS DATABASE COULD EVER SERVE IT" over two reasons, and ONE OF THE TWO IS ' +
    'DISCHARGED. It said "THE OPERATOR DIRECTORY IS NOT IN THIS DATABASE: `admin_actions.actor` ' +
    'is `text NOT NULL` with no foreign key (`0017_events_and_audit.sql:77`) and no table in ' +
    'the registry holds an operator, a role or an operator session". ' +
    '`0073_operator_directory.sql` creates `operators` and `operator_sessions`, closes ' +
    "`operators.role` over API_CONTRACT section 8's three with a CHECK, and adds " +
    '`admin_actions_actor_is_an_operator`, so that sentence is false in every clause and the ' +
    'registry holds both relations (`packages/db/src/scope.ts`). ' +
    'WHAT STILL REFUSES IS AUTHENTICATION, WHICH IS ONE FUNCTION AND THREE VARIABLES. ' +
    '`src/operator-identity.ts` declares `OperatorAssertionVerifier`, whose one method turns a ' +
    'presented assertion into an `AssertionOutcome`; NO IMPLEMENTATION OF IT EXISTS IN THIS ' +
    'REPOSITORY, because C-08 requires hardware-key SSO and that is a purchase. A deployment ' +
    'closes the seam by supplying `MERIT_ADMIN_IDP_ISSUER`, `MERIT_ADMIN_IDP_AUDIENCE` and ' +
    '`MERIT_ADMIN_IDP_JWKS_URL` AND by the slice that writes the verifier: ' +
    '`refusingAssertionVerifier` answers `unconfigured` when any variable is absent and ' +
    '`unavailable` when all three are set, so the configuration is necessary and is not ' +
    'sufficient, and NEITHER ARM CAN BE MADE TO PASS BY AN ENVIRONMENT FILE. Both refusals are ' +
    "503 rather than 401, on this port's own stated ground: an unfinished deployment is not a " +
    'caller who is logged out. ' +
    'THE DECISIONS BEHIND THE PORT ARE BUILT AND TESTED WITHOUT IT. `resolveOperatorSession` is ' +
    "`lookup`'s verdict without its query and `operatorFromAssertion` is the directory join, " +
    'both total, both pure, both exercised in `test/operator-identity.test.ts`. WIRING THE PORT ' +
    'OUT OF THEM IS REFUSED AND ADR-237 SECTION 8 SAID WHY: nothing can write an ' +
    '`operator_sessions` row, so every operator would be told 401 on a door that is not shut ' +
    'against them, and a live-looking route in front of an arm that cannot answer is worse than ' +
    "an honest 503 (`usePayoutBackend`'s rule). " +
    'THAT OBJECTION IS SPENT AND THE REFUSAL IS NOT (ADR-343). ADR-343 clause 1 made an unwired ' +
    'session source resolve to `unknown`, so a deployment with NOTHING installed already answers ' +
    '401 to every caller, cookie or not, and wiring the port would therefore change NOTHING a ' +
    'caller can see: the misreport ADR-237 refused is now the answer either way. ' +
    'AND THE PORT IS NOT BLOCKED BY A DOOR, WHICH THIS ENTRY IMPLIED AND ADR-343 MEASURED FALSE. ' +
    '`operators` and `operatorSessions` are both scope class `firm` (`packages/db/src/scope.ts`), ' +
    'so `ApiDb.firm()` reaches BOTH TODAY, `AdminSessionSource.lookup` reads only those two ' +
    'relations, and `resolveOperatorSession` is already its verdict. NO NEW DOOR IS NEEDED AND ' +
    'ADR-171 CLAUSE 1 HAS NOTHING TO REFUSE HERE; the operator-console door is owed by ' +
    '`setAdminReadSource` alone, whose `AdminSourceTx` spans `owned` keys the firm door refuses ' +
    'by construction. ' +
    'SO THIS PORT IS DECLINED RATHER THAN BLOCKED, ON THREE GROUNDS THAT ARE NOT THE OLD ONE. ' +
    '(1) An install nothing can exercise is an install nothing falsifies: wired against an empty ' +
    'table, its first real exercise is the day somebody lands the identity provider, at which ' +
    'point a console that can freeze accounts, revoke certificates and correct ledgers opens as a ' +
    'SIDE EFFECT of an unrelated slice, carrying no signal that it did. ' +
    '(2) It buys no observable change and costs a transaction against two tables on EVERY ' +
    '`/admin/*` request including the ones answering 401 to a caller holding nothing, so an ' +
    'anonymous prober gets to schedule database work; `start.ts:206` and `:245` say in their own ' +
    'words that the rate limit `INV-M11-05` requires "EXISTS NOWHERE IN THIS TREE", so nothing ' +
    'bounds that. ' +
    '(3) It would move the triple to `wired: 11` and report as progress a port whose table cannot ' +
    'be filled. ' +
    'WHAT IS STILL OWED IS THE PURCHASE AND A CALLER. `refusingAssertionVerifier` and ' +
    '`operatorFromAssertion` have ZERO callers outside their own suite, and the caller is a login ' +
    'route minting an `operator_sessions` row, which needs a verified assertion first. ' +
    'SEVEN OTHER PORTS STILL REDUCE TO THIS ONE, four through `principal(request)` ' +
    '(`useAdminWriteBackend`, `useAdminPayoutBackend`, `useAdminWalletBackend` and ' +
    '`useCertificateRevokeBackend`), two through the `SystemTx` door ADR-171 clause 1 ' +
    'refuses (`setAdminReadSource`, ADR-171 section 9 and ADR-236, and ' +
    '`setInternalOpsSource`, whose `reconciliations` read waits on that same clause), and ' +
    'one through the operator route on the cap (`useCheckoutBackend`). ' +
    'THAT FIGURE READ FIVE AND IS REPAIRED RATHER THAN DELETED (`RI-14`, ADR-360 ' +
    'section 7), which makes this the SECOND figure this one clause has carried wrongly: ' +
    'ADR-171 said THREE, which was right before `useCertificateRevokeBackend` existed, and ' +
    'neither wrong figure was ever read by anything. THE RETIRED FIGURES ARE NAMED RATHER ' +
    'THAN QUOTED, for the reason `setAdminReadSource` above states. ' +
    '`test/admin-read-constructibility.test.ts` derives the set, and this file now binds ' +
    'both prose counts to that same predicate rather than restating it.',
  useAdminPayoutBackend:
    '`principal(request)` (`routes/admin-payouts.ts:390`), which resolves only through ' +
    '`AdminSessionSource` and is therefore blocked on `setAdminSessionSource` above. THIS IS THE ' +
    'ONE OF THE FIVE THAT IS CLOSEST TO WIREABLE and ADR-171 section 4 says so: `AdminPayoutTx` ' +
    'is `lockAt`, `rowAt`, `insert` and `updateAt`, every one a `SystemTx` method, plus a ' +
    '`LedgerTx` which `routes/admin-payouts.ts:350-353` correctly observes `SystemTx` ' +
    'structurally satisfies at a reason that already exists. ONE SUPPLIER SHORT, AND THE ' +
    'SUPPLIER IS NOT A DOOR. Wiring it with `principal: async () => null` would report an ' +
    'unfinished deployment as a caller who is not an operator, on the endpoint that releases ' +
    'held payouts. MONEY PATH.',
  useAdminWalletBackend:
    '`principal(request)` (`routes/admin-wallet.ts:679`), blocked on `setAdminSessionSource` ' +
    'above, AND THREE FURTHER MEMBERS: `operator`, `writeCorrection` and `reconcile`. ' +
    'THAT FIGURE READ TWO AND THE MEMBER IT OMITTED IS `operator` (ADR-366, ADR-369, ' +
    '`RI-14`). The retired figure is NAMED rather than quoted, on `setAdminReadSource`s ' +
    'precedent above, because the case that binds this clause reads the sentence AROUND the ' +
    'number and a reproduced original would hand it two answers. ' +
    '`AdminWalletBackend`s `operator` (`routes/admin-wallet.ts:670`) IS THE ONE BOTH APPENDS ' +
    'TRAVEL THROUGH and it ' +
    'is a door rather than a shape: it yields the `AdminWalletTx` that carries `insert`, that ' +
    'handle needs a `SystemTx` (`packages/db/src/scoped-db.ts:3769`), and `ApiDb` ' +
    '(`apps/api/src/db.ts:173`) declares five doors of which none yields one, refused by ' +
    'ADR-171 clause 1. The two appends are the `admin_actions` row every mutating endpoint ' +
    'writes first and the spend limit, which is the whole of that write, and NEITHER GOES ' +
    'THROUGH ' +
    '`writeCorrection`: a slice that solved the other three would still write nothing, and a ' +
    'slice that solved `principal` and `operator` alone would have a working spend-limit ' +
    'endpoint with the correction still refusing (ADR-366 section 4). ' +
    '`writeCorrection` is refused on THREE ' +
    'constraints, each a CHECK on `account_adjustments` that no draft this module composes can ' +
    'satisfy. (1) A correcting DEBIT is unwritable unless it exactly reverses a prior adjustment ' +
    'CREDIT: `account_adjustments_debit_is_a_reversal` is a biconditional and the wire carries ' +
    'no `reverses_adjustment_id`. (2) Dual control needs a `dual_control_approvals` row and ' +
    'nothing in this tree writes one; ADR-228 supplied the THRESHOLD and not the approval, which ' +
    'is the half that moved. (3) `reason_code` is NOT NULL over a closed three-member vocabulary ' +
    'the wire has no field for. `routes/admin-wallet.ts` has named exactly these three since ' +
    'session 298 and THIS ENTRY DID NOT. IT READ: "`0038` is the built door for a wallet ' +
    'correction and ADR-158 never read it, so no column holds which entry a correction ' +
    'corrects". Every clause of that WAS TRUE WHEN WRITTEN and the schema half is true today; ' +
    'ADR-158 really does never name `0038`. What was wrong is the JOB it was doing here, because ' +
    'ADR-173 clause 3 ruled that no such column is OWED, API_CONTRACT carries that ruling in the ' +
    'endpoint row, and the durable record is `admin_actions.before.corrected_entry`. So the ' +
    'entry named the ONE of session 298 four disagreements that ADR-173 DISCHARGED and left the ' +
    'three that stand unnamed. It is quoted rather than deleted because a reader who deletes it ' +
    'finds `reverses_adjustment_id` (`0038:185`) and concludes the reason was discharged: that ' +
    'column references `account_adjustments` and not `wallet_entries`, and exists exactly on ' +
    'DEBITS, so it is constraint (1) above rather than an answer to any of them. ADR-255, ' +
    'asserted in `test/wallet-correction-linkage.test.ts`. `reconcile` is refused on ADR-157 ' +
    'clause 6, which needs a join and an aggregate. Installing a backend would not resolve any ' +
    'of these findings and must not paper over them. MONEY PATH.',
  useAdminWriteBackend:
    'ONE SUPPLIER AND IT IS NOT A DOOR. THIS ENTRY NAMED THREE, THE THIRD WENT AT ADR-251 AND ' +
    'THE SECOND GOES HERE (ADR-257). `principal(request)` ' +
    '(`routes/admin-writes.ts:277`), blocked on `setAdminSessionSource` above, is what is ' +
    'left, and it is behind the SSO purchase. ' +
    'THE SECOND CLAUSE READ "nothing in this tree performs that projection" AND IT IS NOW ' +
    'FALSE RATHER THAN NARROWED: `projectPlanValidation` ' +
    '(`routes/admin-writes.ts:405`) maps `ValidationResult` ' +
    '(`packages/rules-engine/src/types.ts:701`) onto `PlanValidation` ' +
    '(`routes/admin-writes.ts:350`), carrying `ok` from the engine unchanged and folding the ' +
    'materialization findings into `errors` so that an `ok: false` is never handed over with ' +
    'an empty reason list. ' +
    'WHAT REPLACES IT IS NOT A BLOCKER ON THIS PORT AND IS A FINDING ABOUT THE ENVELOPE. A ' +
    '`CvViolation` (`packages/rules-engine/src/types.ts:667`) declares FOUR fields and one ' +
    'entry of `errors` declares TWO, so `path` and `sizeCents` are LOST, and `sizeCents` is ' +
    'the only field that tells one `plan_version_sizes` row apart from another: two rows with ' +
    'the same defect project to two IDENTICAL entries. Widening `PlanValidation` would move ' +
    "that loss one line later rather than remove it, because API_CONTRACT section 2's " +
    '`errors?: Array<{ path: string; message: string }>` is where this refusal travels and it ' +
    'has no third field. The loss FAILS CLOSED, so it is reported at ADR-257 section 5 and ' +
    'the contract is not moved here. `test/admin-write-plan-validation.test.ts` derives every ' +
    'clause of this paragraph from the engine and from source on every run. ' +
    'THE THIRD CLAUSE READ "nothing in this workspace maps an instant to an exchange trading ' +
    'day" AND IT IS NOW FALSE RATHER THAN NARROWED: `@merit/rules-engine` exports ' +
    '`buildSessionCalendar` (`packages/rules-engine/src/calendar.ts:443`) and `tradingDayAt` ' +
    '(`packages/rules-engine/src/calendar.ts:591`), which answer by CONTAINMENT over ' +
    "`trading_calendar`'s stored session bounds and `trading_calendar_loads`' coverage, " +
    'comparing an instant only with an instant. Both tables are `firm` and `apps/api` holds ' +
    '`db.firm`, so the supplier and the read are both in this deployable. ' +
    'WHAT REPLACED THAT ONE IS SMALLER AND IS NOT A MISSING FUNCTION. `tradingDay(): string` ' +
    '(`routes/admin-writes.ts:346`) has ONE arm and the resolver answers THREE, because ' +
    'ADR-042 F-4 requires `outside_coverage` to be distinguishable from `not_a_session`; and no ' +
    'ruling says which day an operator close takes when the instant is in no session, while ' +
    '`accounts_terminal_has_close_date` requires `closed_on` on every `closed_admin` row. A ' +
    'DECISION IS OWED AND A FUNCTION IS NOT. ' +
    'THE CLAIM THAT `apps/api` DOES NOT DECLARE `@merit/rules-engine` ALSO STOOD HERE AND WAS ' +
    'FALSE: it has been declared since session 252 landed `routes/payouts.ts` ' +
    '(`apps/api/package.json`), and `validatePlan` is exported ' +
    '(`packages/rules-engine/src/index.ts:185`). ADR-171 finding 10. That stale sentence ' +
    "survived in this port's own docstring, which was outside that entry's fence and is inside " +
    "ADR-251's; it is repaired at the source. `test/admin-write-trading-day.test.ts` derives " +
    'every clause here from source on every run.',

  // ---------------------------------------------------------------------------
  // THE LEDGER DOOR, AND THE TWO PORTS THAT REACHED FOR IT ARE NOW ONE.
  //
  // `packages/ledger`'s `LedgerTx` is satisfied only by ADR-102's `SystemTx`,
  // which is opened at a `SystemReason`, and ADR-165 ruled that vocabulary gains
  // no member. BOTH ENTRIES BELOW USED TO NAME THAT AS THEIR BLOCKER AND ONLY
  // ONE STILL DOES.
  //
  // ADR-172 clause 2 ruled that the handle is not the missing thing: the only
  // value satisfying `LedgerTx` is generic over EVERY TABLE IN THE ESTATE
  // (`scoped-db.ts:2389`, `insert<K extends TableKey>`), so a door in `apps/api`
  // returning one would be `systemDb` renamed. ADR-176 applied that to
  // `routes/payouts.ts`: `PayoutTx.ledger` is DELETED, the `LT-01` posting is
  // performed at a system authority, and the request path records the approval
  // and stores the client's key for the door that posts it.
  //
  // SO `usePayoutBackend`'S ENTRY IS REWRITTEN RATHER THAN SHRUNK. The port did
  // not become wireable; a different obstruction was underneath the one that
  // moved, and it is a READ rather than a write. `useCheckoutBackend` is
  // untouched by that ruling and still names the ledger among its blockers,
  // because nothing has ruled where a CHECKOUT posting happens.
  //
  // AND THEN THE REWRITE ITSELF WENT STALE INSIDE ONE NIGHT, WHICH IS WHY RI-20
  // EXISTS. The entry below read "A `RuleState` NO MIGRATION IN THIS TREE CAN
  // STORE", that "`0015_rule_states.sql` declares NONE of the three", and that a
  // recursive grep for lifetime_settled over the migrations directory returned
  // nothing at all. ALL THREE WERE FALSE by the time the next session read them:
  // `0065` landed `lifetime_settled_cents`, `breached` and `breach_kind`,
  // session 400 landed the writer, and the entry's OWN CITED GREP returns seven
  // lines.
  //
  // THAT THIRD SENTENCE IS WRITTEN OUT OF COMMAND GRAMMAR ON PURPOSE AND ADR-212
  // IS WHY. A backticked command beside a stated result is a claim about THIS
  // tree, so a command quoted as HISTORY must not wear the shape that says run
  // me -- which is the rule ADR-212 already made for `file:line` pointers, and
  // `useWithdrawalBackend`'s entry below spells two dead line numbers out in
  // words for the same reason. RI-20 has no refuted-claim escape and must not
  // grow one: the escape RI-14 needs is safe because a name is inert, and a
  // command is not.
  //
  // NO GATE COULD SEE IT AND THAT WAS A BOUNDARY RATHER THAN A BUG. RI-14 reads
  // EXPORTS, and a migration COLUMN is not an export, so the one class of claim
  // this file makes most often about the database was outside every check in the
  // tree. ADR-214 rules that a reason's existence claim DOES reach schema
  // objects and that a runner cannot tell a column name from prose -- measured,
  // not assumed -- so a reason claiming a schema fact QUOTES THE COMMAND THAT
  // SETTLES IT and `RI-20` runs the command. The grep below is live: it is
  // executed on every CI-01 run and the number beside it is checked.
  //
  // AND ADR-233 TOOK THE LEAD BLOCKER OFF THIS ENTRY FOR THE SECOND TIME IN A
  // WEEK, WHICH IS WHY WHAT IS LEFT IS WORTH READING SLOWLY. `ScopedTx` gained a
  // `firm`-class READ over a closed list of five catalogue keys, so the
  // `ResolvedPlan` half of `PayoutTx.subject` is now a call somebody can write on
  // the payout transaction. THE PORT DID NOT BECOME WIREABLE. Underneath the read
  // was a third obstruction that no reason on this port had ever named, and it is
  // not a door at all: `PayoutSubject.state` is a `RuleState`, whose `engineGates`
  // has no decoding for `rule_states.engine_gates` and whose table holds no rows.
  // `routes/account-reads.ts` has said both about `/eligibility` since session
  // 401, and `INV-M5-02` makes it one blocker across two endpoints rather than
  // two. THREE REASONS ON THIS PORT HAVE NOW BEEN DISCHARGED AND THE PORT HAS
  // NEVER BEEN CLOSER TO WIRED THAN 503, which is what this list is for.
  //
  // THE PER-FILE CLAIM WAS A GRAIN ERROR AND IT IS WORTH NAMING. "`0015` declares
  // none of the three" was TRUE the day it was written and is true today, and it
  // was still the wrong question: a merged migration is never edited, only
  // superseded (constitution E2), so what a TABLE can store is never a fact about
  // one file. An entry asking a per-file question about a per-table fact is stale
  // the moment the next `ALTER TABLE` lands, by construction.
  //
  // AND SESSION 429 FOUND A FOURTH REASON UNDER THE THIRD, WHICH IS WHY THE ENTRY
  // NOW LEADS SOMEWHERE ELSE ENTIRELY. Every clause this entry has ever carried
  // was a clause about a DOOR: a handle, a read, a decoding. The thing actually
  // standing between this port and a `RuleState` is not a door at all and is not
  // in `apps/api`. `rule_states` is written by one function, that function is
  // called by one function, and that function is called by NOTHING: the worker
  // deployable's `start` script loads a barrel of exports, declares `main` and
  // never invokes it, so the process exits 0 having scheduled nothing. A payout
  // that needs a rule state, in an estate where no job ever computes one, is a
  // MISSING SCHEDULED JOB and not a wiring, and ADR-239 sizes it.
  //
  // THE THIRD CLAUSE ALSO NARROWED AND THE NARROWING IS THE GOOD NEWS. This entry
  // said a decoding for `engine_gates` would be inventing a corpus fact. ADR-206
  // ruled that fact on 2026-08-29 and `rule_states.md` reproduces it, so what is
  // owed is a codec somebody writes rather than a decision somebody makes. The
  // clause is REWRITTEN rather than deleted, because the implementation is still
  // absent and the refusal still stands; only its price changed.
  //
  // ADR-239 RULES THE QUESTION THIS ENTRY KEPT IMPLYING WITHOUT ASKING: the API
  // READS a `RuleState` the WORKER WROTE, and the two deployables meet at
  // `rule_states`. The alternative, an API that folds its own, puts the engine on
  // two paths and only one of them is audited, which is the divergence ADR-026
  // C-07's `state_hash` exists to make detectable.
  //
  // AND SESSION 435 WAS DISPATCHED TO ASK WHETHER THE WORKER LANDING DISCHARGED
  // THIS ENTRY, FOUND THAT IT DID NOT, AND FOUND A CLAUSE UNDER THE ONES IT WAS
  // SENT TO RE-DERIVE. Every clause above re-derives true on this tree and the
  // entry is not rewritten for the worker: link 1 is measured CLOSED (the
  // deployable now exits NON-ZERO where ADR-239 measured no output and exit 0),
  // link 2 is a real adapter serving four of ten, and links 3 and 4 are exactly
  // where ADR-239 left them. ADR-245 records the measurement.
  //
  // THE SIXTH CLAUSE IS THE FINDING AND IT IS THIS ENTRY'S OWN DEFECT FOR THE
  // THIRD TIME. `PayoutSubject` has THREE fields and eleven revisions of this
  // reason named two. ADR-248 RULED THE THIRD AND THE ANSWER IS THAT `gates` IS
  // NOT CONSTRUCTIBLE IN THIS DEPLOYABLE: three of its five facts resolve off
  // registered tables, `accountStatus` is not a total map, and the in-flight
  // leg had NO PREDICATE TO READ because M01 stated R-38's grain both ways. SO
  // THE ENTRY NARROWS TO NAME ALL THREE FIELDS AND WHAT EACH ONE WAITS ON.
  //
  // AND ADR-254 THEN RULED THE GRAIN, WHICH MOVES ONE OF THE TWO UNRESOLVED
  // LEGS WITHOUT MOVING THE PORT. R-38 is the ACCOUNT's, M01's two R-38 rows
  // are amended and every other source in the corpus already said so, so the
  // in-flight leg stops being a contradiction and becomes a read on a table
  // this port already reaches. THE PORT IS UNCHANGED AND THE COUNT IS
  // UNCHANGED: `accountStatus` still has no total map and `gates` still cannot
  // be built, which is why this entry narrows rather than shrinks. A leg that
  // moves from "nobody may decide this" to "nobody has written this" is worth
  // recording precisely because it looks like progress and is not a wiring.
  //
  // AND ADR-250 IS THE FIRST TIME A CLAUSE ON THIS ENTRY HAS CLOSED RATHER THAN
  // BEEN REPHRASED, WHICH IS WORTH THE PARAGRAPH BECAUSE THE OTHER TWELVE
  // REVISIONS WERE THE OPPOSITE SHAPE. The third clause moved from "a decoding
  // would be inventing a corpus fact" to "a ruling exists and a module does not"
  // to nothing at all: `encodeEngineGates` and `decodeEngineGates` are in
  // `packages/rules-engine/src/gates-codec.ts`, `adapter.ts` installs the
  // encoder where it took the unwired refusal, and the round trip is executed.
  // THE PORT DID NOT BECOME WIREABLE AND THE WIRED COUNT DOES NOT MOVE. What
  // the codec was is the SMALLEST of the three things `state` waits on, and the
  // two that remain are the ones ADR-239 sized as larger: an adapter that
  // resolves an `AccountDay`, and a table that holds a row. A clause that closes
  // on a money path is worth recording precisely because it is rare here; a
  // clause that closes and takes the port with it would be a different entry.
  //
  // AND ADR-258 IS THE SECOND CLAUSE TO CLOSE IN HALF, WHICH IS A DIFFERENT
  // SHAPE AGAIN AND IS WHY IT GETS A LINE. The second clause said the adapter
  // resolved NONE of an `AccountDay`'s six fields. It resolves five. What stops
  // the fold is `external` alone, `ADR-248`'s ruling, and clause six was already
  // the place that reason lives -- so the narrowing MOVES a blocker into a
  // clause that already carried it rather than adding one. The port did not
  // become wireable and the wired count does not move: `rule_states` still holds
  // no rows, and the read half of that is now the only half left.
  //
  // AND ADR-260 IS THE THIRD CLAUSE TO CLOSE OUTRIGHT, WHICH HAS NOW HAPPENED
  // TWICE IN THIS ENTRY'S LIFE AGAINST FOURTEEN REPHRASINGS, AND IT IS THE FIRST
  // TIME A CLAUSE HAS CLOSED ON A FIELD RATHER THAN ON A MODULE. Clause six
  // asked what `gates` waits on and the answer moved three times: ADR-248 said a
  // ruling nobody may make, ADR-254 said a resolver nobody has written, and
  // ADR-260 wrote it. `resolveExternalGates` is in
  // `packages/rules-engine/src/external-gates.ts`, both deployables reach it
  // through the barrel, `apps/worker/src/batch/adapter.ts` calls it and
  // `loadAccountDay` now serves six fields of six.
  //
  // **THE PORT STILL DOES NOT BECOME WIREABLE AND THE WIRED COUNT DOES NOT MOVE,
  // AND THE REASON IS NOW A SINGLE ONE.** `PayoutSubject` has three fields;
  // `plan` was discharged by ADR-233, `gates` is discharged here, and `state` is
  // a `RuleState` that this deployment must READ from a `rule_states` row. The
  // fold that writes such a row completes on the worker as of this entry, and
  // NO SCHEDULED RUN HAS WRITTEN ONE AGAINST A DATABASE, so what stands between
  // this port and a wiring is a run and a reader rather than five distinct
  // absences. A clause closing on a money path is worth stating rather than
  // celebrating; an entry down to ONE blocker is worth stating twice, because
  // this file's own repeated finding is that a reason naming the second-cheapest
  // blocker retires the question for every reader after it.
  //
  // AND ADR-264 IS THE FIRST ENTRY ON THIS PORT TO SETTLE A CLAUSE BY RUNNING
  // SOMETHING, WHICH IS WHY IT GETS ITS OWN PARAGRAPH AFTER SIXTEEN REVISIONS OF
  // READING. Clause four said `rule_states` holds no rows and that the fold
  // "completes"; completing and PERSISTING are different claims and this entry
  // had never held the second. It does now: `0001` to `0074` applied to an empty
  // PostgreSQL 16, one account seeded with one live mark, `apps/worker`'s own
  // entrypoint run, and the table went from zero rows to one. The read half is
  // built in the same entry and `apps/api/src/rule-state-reader.ts` is the
  // module.
  //
  // **THE PORT STILL DOES NOT BECOME WIREABLE AND THE REASON IS A DIFFERENT KIND
  // OF THING FROM EVERY REASON BEFORE IT.** Sixteen revisions have named
  // something nobody had BUILT: a job, an adapter, a codec, a resolver, a
  // reader. What stands now is that no DEPLOYMENT has run the job, which
  // ADR-241 ruled external and this repository cannot assert, and one read on
  // the wrong door: `R-06` permits only the last closed trading day, and
  // `tradingCalendar` is `firm` and outside `CATALOG_TABLE_KEYS`, so the
  // transaction that reads the state cannot read the day that decides which
  // state it may read. `apps/api/test/rule-state-producibility.test.ts` runs
  // that as link 6 on every CI-01 pass, because it is a clause this entry
  // discovered rather than inherited and a comment cannot fail.
  //
  // AND A SECOND TRANSCRIPTION OF A `rule_states` ROW NOW SHIPS, WHICH IS
  // REGISTERED HERE RATHER THAN LEFT FOR A SWEEP TO FIND. `toRuleState` in
  // `apps/worker/src/batch/adapter.ts` and `readRuleState` in `apps/api` read
  // the same twenty-two values and neither deployable can import the other,
  // which is `FM-16` by name; its home is `packages/rules-engine` beside
  // `gates-codec.ts` and ADR-264's row does not fence that package. What FM-16
  // costs is "with nothing comparing them", and that half is paid: SD-08's
  // digest is computed by the writer, stored in `bytea`, and re-derived from
  // the state the reader rebuilds.
  //
  // AND ADR-285 IS THE FIRST CLAUSE ON THIS ENTRY TO CLOSE ON A REFUSAL PATH
  // RATHER THAN ON A CAPABILITY, WHICH IS A DIFFERENT SHAPE FROM EVERY CLAUSE
  // BEFORE IT. The earlier ones named something nobody had BUILT -- a job, an
  // adapter, a codec, a resolver, a reader, a door, a decoding -- and closed
  // when somebody built it. This one named what the route DID WITH A THROW: an
  // absent `rule_states` row left the payout transaction and became a 500,
  // because the only refusal this file's foot recognised was an unwired
  // backend. Nothing was missing from the estate; the ANSWER was.
  //
  // THE PORT DID NOT BECOME WIREABLE AND THE WIRED COUNT DOES NOT MOVE, and
  // ADR-256 ruling 12 is why: wiring is permitted when the last gap is a thing
  // THE DEPLOYMENT SETS, and neither of the two gaps left is one. What ADR-285
  // bought is that the day this port IS wired, the deployment's first unfolded
  // morning is a 503 a trader can read rather than an internal error, and that
  // is worth having BEFORE the wiring rather than after it.
  //
  // AND THE ENTRY IS REWRITTEN RATHER THAN SHRUNK, ON THIS FILE'S OWN REPEATED
  // FINDING. Three obstructions became two, and a reader who saw only the
  // shrink would conclude this port is one step from live for the fourth time.
  // ---------------------------------------------------------------------------
  usePayoutBackend:
    'A `RuleState` THIS DEPLOYMENT CANNOT PRODUCE, AND THE LEAD CLAUSE MOVED AGAIN BECAUSE THE ' +
    'LINK UNDER IT CLOSED: THE JOB NOW RUNS AND THE ROW IT WOULD WRITE IS STILL OUT OF REACH. ' +
    'THIS ENTRY LED WITH AN UNSCHEDULED JOB AND WITH A PROCESS THAT LOADED A BARREL, PRINTED ' +
    'NOTHING AND LEFT A ZERO STATUS, AND ADR-241 MADE BOTH CLAUSES FALSE. THE RETIRED WORDING ' +
    'IS PARAPHRASED RATHER THAN QUOTED, because a reason that reproduces its own retired ' +
    'sentence reads as live to every grep and to the predicate that checks it is gone. ' +
    '`apps/worker/package.json` starts the batch deployable at ' +
    '`node --experimental-strip-types src/start.ts`, that file ends in a top-level ' +
    '`await main()`, and a batch that throws leaves a NON-ZERO exit status, which a supervisor ' +
    'can read: `apps/worker/test/entrypoint.test.ts` SPAWNS the process and asserts the status ' +
    'rather than reasoning about it. The schedule is ruled EXTERNAL and registered in ' +
    '`docs/ops/runbooks/CRON_INVENTORY.md`, because a timer inside a process nothing restarts ' +
    'is not a schedule and a long-lived process has no exit code to fail with. SECOND, THERE ' +
    'IS A `BatchPorts` VALUE NOW AND FIVE OF ITS TEN METHODS ANSWER, ONE OF THEM ONLY IN ' +
    'PART: `runNightlyBatch` ' +
    '(`apps/worker/src/batch/nightly.ts:276`) takes a `BatchPorts`, its read half declares ' +
    'SEVEN methods and its write half THREE (`apps/worker/src/batch/ports.ts:265,336`), and ' +
    '`postgresBatchPorts` (`apps/worker/src/batch/adapter.ts`) serves the calendar watermark, ' +
    'the calendar slice, the accounts with a live mark and the accounts with stored state over ' +
    "this deployable's one door. THIS CLAUSE READ THAT `loadAccountDay` REFUSED BY NAME AND " +
    'THAT NO ADAPTER RESOLVED ANY OF AN `AccountDay`s SIX FIELDS; ADR-258 MADE THE SECOND ' +
    'HALF FALSE AND ADR-260 MADE THE FIRST. `plan` is `resolvePlan` over the account`s PINNED ' +
    '`plan_versions.rules` and ' +
    'its `plan_version_sizes` row, `prior` is a stored `rule_states` row rebuilt as a ' +
    '`RuleState` through ADR-250`s decoder, `mark` is the unsuperseded `daily_marks` row, ' +
    '`settlements` are the SETTLED `payout_requests` effective on the day, `openedOn` is ' +
    '`accounts.opened_on`, and `external` is `resolveExternalGates` over four tables; an ' +
    'account with no live mark is answered `null` rather than ' +
    'refused. **SO THE FOLD COMPLETES**: `runNightlyBatch` calls calendarWatermark, ' +
    'calendarSlice, accountsWithLiveMark, loadAccountDay and writeRuleState, and every one of ' +
    'the five answers. `accountDaysFrom` and `storedRuleStates` still refuse and NEITHER IS ON ' +
    'THAT PATH: both are the replay audit`s and `runReplayAudit` is unscheduled. WHAT IS LEFT ' +
    'IS THAT NO RUN HAS HAPPENED AGAINST A DATABASE, which is a smaller thing than a port and ' +
    'is clause FOUR rather than this one. THIRD, THE ' +
    'CODEC CLAUSE IS DISCHARGED, AND IT IS THE FIRST THING THIS ENTRY HAS LOST RATHER THAN ' +
    'REPHRASED. IT NARROWED TWICE AND THEN CLOSED. It read that writing a decoding would be ' +
    'inventing a corpus fact, which ADR-206 retired by ruling the encoding as the engine`s own ' +
    'value, six groups and twenty-five leaves with every cents leaf a base-10 string. It then ' +
    'read that `RuleStateWriterIo.encodeEngineGates` ' +
    '(`apps/worker/src/batch/state-writer.ts:354`) had no implementation under any `src/`, ' +
    'WHICH ADR-250 MADE FALSE: the codec is `encodeEngineGates` and `decodeEngineGates` in ' +
    '`packages/rules-engine/src/gates-codec.ts`, which is ADR-239 slice A`s home because BOTH ' +
    'deployables need the one predicate and neither can import the other, and ' +
    '`apps/worker/src/batch/adapter.ts:798` INSTALLS it where it took the unwired refusal. The ' +
    'round trip is EXECUTED rather than claimed: an engine-folded value survives encode, JSON ' +
    'and decode unchanged, and a cent past `Number.MAX_SAFE_INTEGER` comes back exact. THE ' +
    'PORT IS NOT WIRED BY ANY OF THAT AND THE WIRED COUNT DOES NOT MOVE, which is why the ' +
    'clause closing is worth stating rather than celebrating: the codec was the SMALLEST of ' +
    'the things `state` waits on, and what it left standing was the adapter and the empty ' +
    'table. ADR-258 TOOK FIVE SIXTHS OF THE ADAPTER AND THE EMPTY TABLE IS UNTOUCHED, so what ' +
    '`state` waits on is now the gates ruling and a scheduled run that produces a row. ' +
    'THE READ THIS PORT NEEDS IS NOW SERVED BY A FUNCTION AND BY NO ROW: ' +
    '`PayoutTx.subject` (`routes/payouts.ts:606`) returns a ' +
    '`PayoutSubject` whose `state` (`routes/payouts.ts:400`) is a `RuleState`, ' +
    '`RuleState.engineGates` (`packages/rules-engine/src/types.ts:1020`) is `EngineGateResults` ' +
    '(`packages/rules-engine/src/types.ts:975`), `rule_states.engine_gates` is `jsonb`, and ' +
    '`decodeEngineGates` is what rebuilds one from the other. ' +
    'FOURTH, THIS CLAUSE READ THAT `rule_states` HOLDS NO ROWS AND THAT A BACKEND INSTALLED ' +
    'TODAY WOULD COMPUTE A CONFIDENT PAYOUT VERDICT OFF AN EMPTY TABLE, AND ADR-264 SETTLED ' +
    'BOTH HALVES OF IT BY RUNNING RATHER THAN BY READING. The retired wording is paraphrased ' +
    'rather than quoted, because a reason that reproduces its own retired sentence reads as ' +
    'live to every grep. **THE FOLD WRITES A ROW AND THAT IS MEASURED**: migrations `0001` to ' +
    '`0074` applied forward-only to an empty PostgreSQL 16, one identity, one plan version, ' +
    'one account and one live `daily_marks` row seeded, `apps/worker`s own entrypoint invoked ' +
    'at `node --experimental-strip-types src/start.ts`, and the table went from zero rows to ' +
    'one, reported `written: 1` and exited 0. **AND THE READ HALF IS BUILT**: ' +
    '`readRuleState` and `ruleStateOn` (`apps/api/src/rule-state-reader.ts`) rebuild the ' +
    'engine`s `RuleState` from that row, `apps/api/test/rule-state-reader.test.ts` re-derives ' +
    'SD-08`s digest over the rebuilt state and compares it with the `state_hash` PostgreSQL ' +
    'holds, and the thirty-two bytes agree. SO WHAT IS ABSENT IS NEITHER A CAPABILITY NOR A ' +
    'ROW THIS REPOSITORY COULD PRODUCE: it is that NO SCHEDULED RUN HAS HAPPENED IN A ' +
    'DEPLOYMENT, which is an operator fact ADR-241 ruled EXTERNAL and registered in ' +
    '`CRON_INVENTORY`, and a reader that answered an absent row with anything at all would be ' +
    'the wrong answer this clause has refused five times. AN ABSENT ROW IS A REFUSAL AND ' +
    'NEVER A DEFAULT VERDICT: `RuleStateAbsent` is a class and not an arm. ' +
    'SEVENTH WAS THE DAY, AND IT IS THE FIRST CLAUSE OF THIS ENTRY TO CLOSE ON THE STRENGTH ' +
    'OF A RULING RATHER THAN A BUILD. `R-06` permits ONE day, the LAST CLOSED one, so ' +
    '`subject()` must select the stored row BY DAY, and ADR-264 found that day unreadable ' +
    'exactly where the state is read: `tradingCalendar` is scope class `firm` and is NOT one ' +
    'of the five members of `CATALOG_TABLE_KEYS`. THIS CLAUSE READ THAT THE REMEDY WAS EITHER ' +
    'ADR-211 CLAUSE 2`s TWO-TRANSACTION CROSSING OR A SIXTH CATALOGUED KEY, THAT BOTH WERE ' +
    'SOMEBODY`s RULING AND THAT ADR-264 TOOK NEITHER. ADR-268 IS THAT SOMEBODY AND IT REFUSES ' +
    'BOTH. The retired wording is paraphrased rather than quoted, because a reason that ' +
    'reproduces its own retired sentence reads as live to every grep. THE SIXTH KEY IS ' +
    'REFUSED ON ADR-265`s SHAPE ARGUMENT, LANDING HARDER HERE: a catalogue read hands out ROWS ' +
    'and the fold the caller would then hold is `R-06` ITSELF, which this tree already states ' +
    'TWICE in two ways that disagree -- `readLastClosedTradingDay` ' +
    '(`apps/worker/src/batch/adapter.ts`) consults no coverage at all and `lastClosedDay` ' +
    '(`apps/api/src/admin-source/liability.ts`) has a caller that does -- so a third statement ' +
    'would be the first on the money path; and the answer needs TWO tables, because coverage ' +
    'is `trading_calendar_loads` and `scope.ts` says of this table that a reader must consult ' +
    'both. THE TWO-TRANSACTION CROSSING IS REFUSED ON ADR-211`s OWN PRECONDITION rather than ' +
    'on a preference: its clause 4 made the crossing safe with a migration after which ' +
    '"nothing readable can move", and `trading_calendar` has the OPPOSITE property BY DESIGN ' +
    '-- `0026` grants `merit_app` all four verbs on it, `0032` revoked them only on the two ' +
    'satellites, and CALENDAR-C1 to C3 REQUIRE a correction to leave a prior image rather ' +
    'than PREVENTING one. A verdict across two snapshots would persist a ' +
    '`payout_requests.basis_trading_day` the transaction that recorded it never read. ' +
    'SO THE DAY IS A NAMED DOOR: `ScopedTx.lastClosedTradingDay()`, one day out, ' +
    'three reads on the ONE transaction, refusing an empty calendar, an EXHAUSTED one and a ' +
    'coverage gap. `CATALOG_TABLE_KEYS` did not move and ADR-211 foreclosure 2 is honoured: ' +
    '`PayoutTx` gains no firm method, exactly as ADR-233`s catalogue verbs discharged the ' +
    '`plan` half without adding a port member. ' +
    'AND ADR-281 RE-DERIVED THAT DOOR AT SOURCE RATHER THAN TAKING THIS ENTRY`s WORD FOR IT, ' +
    'BECAUSE A DOOR THAT EXISTS AND IS NOT REACHED FROM THE REFUSING PATH IS NOT A DISCHARGE: ' +
    '`ScopedTx.lastClosedTradingDay(): Promise<string>` is DECLARED at ' +
    '`packages/db/src/scoped-db.ts:3635` and IMPLEMENTED at `:3782` on `source`, which is the ' +
    'payout transaction itself; `lastClosedTradingDayStatement` (`:3235`) reads both calendar ' +
    'tables and throws on an empty calendar, an EXHAUSTED one and a coverage gap alike; the ' +
    'return type is `string` so no caller holds an absent value to fold a UTC date into ' +
    '(ADR-146 clause 4); and `routes/payouts.ts:355` instructs a backend to call it. SO THE ' +
    'READ CLAUSE IS DISCHARGED AND IS DELETED FROM THE SUMMARY BELOW RATHER THAN KEPT BESIDE A ' +
    'DOOR THAT LANDED, which is assertion 2 of this file`s own three working a third time. ' +
    'FIFTH, AND THE CLAUSE THAT OUTLIVED EVERY OTHER ONE HAS NARROWED FOR THE FIRST TIME ' +
    'RATHER THAN CLOSED. It read that this tree held no implementation of `PayoutTx` at all, and ' +
    'ADR-291 made that false. The retired wording is paraphrased rather than quoted, because a ' +
    'reason that reproduces its own retired sentence reads as live to every grep, and this entry ' +
    'has retired a question that way four times already. **THE VALUE EXISTS AND IT IS SIX ' +
    'MEMBERS OF EIGHT**: `postgresPayoutBackend` (`apps/api/src/payout-backend.ts`) implements ' +
    '`transact`, which opens the scoped door on the session identity and is the ONE transaction ' +
    'every later slice reads on, `lockScope()`, which delegates to `ScopedTx.lockScope` in one ' +
    'line and is ADR-301 building what ADR-293 section 3.5 ruled, `identityStatus()`, which ' +
    'reads `identities` as scope class ' +
    '`root` and decodes `identity_status` to one of three or RAISES, and, since ADR-295, ' +
    '`insertPayoutRequest()` ON ITS APPROVAL BRANCH: it derives the `NOT NULL` ' +
    '`plan_version_id` off `accounts` on the SAME transaction, names ELEVEN of the insert ' +
    'shape`s FOURTEEN fields, names `splitBp` and `clampReason` NOWHERE because neither has a ' +
    'column and both are already inside the snapshot, and leaves `identity_id` to the handle ' +
    'to stamp, AND, SINCE ADR-306 AND ADR-308, `subject()` ON ALL FOUR OF ITS LEGS, AND, ' +
    'SINCE ADR-311, `listPayouts()`, the one member outside every write path. ' +
    '**ITS OTHER TWO MEMBERS REJECT WITH `PayoutBackendUnwired`, AND SO DOES THE ' +
    'HOLD BRANCH OF THE MEMBER THAT ANSWERS**: `holdFlag` ' +
    'and `insertPayoutRequest`s hold arm are slice 8, WHICH CANNOT BE SCHEDULED BECAUSE ' +
    '`HoldFlag.tosClause` HAS NO VALUE SPACE AND `DEP-M7-05` OWES THE CLAUSES TO COUNSEL, ' +
    'and `idempotency` IS THE ONE THAT COULD ANSWER TODAY AND ' +
    'DELIBERATELY DOES NOT, on this entry`s own closing sentence below. ' +
    'THIS PARTITION READ FOUR ANSWERING AND FOUR REJECTING AND NAMED `subject` AND ' +
    '`listPayouts` AMONG THE REJECTERS, AND IS REPAIRED RATHER THAN DELETED (`RI-14`, ' +
    'ADR-361 section 7). BOTH WERE BUILT WHILE THE CLAUSE STOOD, AND THE CLAUSE IS THE ONE ' +
    'A SESSION WOULD ACT ON: a row dispatched off it would go and build two members that ' +
    'already answer. The adapter`s own header says SIX answer and TWO reject twelve lines ' +
    'below a line that still reads five of eight, and that half is OWED because it is a ' +
    '`src/` file this row does not own. THE RETIRED FIGURES ARE NAMED RATHER THAN QUOTED, ' +
    'on this entry`s own four-times precedent above, and the partition is now derived by ' +
    '`the payout member partition is derived from the adapter rather than typed` below. ' +
    'AND THE RULED LINE ' +
    'THAT WAS STILL OWED HERE IS BUILT, WHICH IS THE FIRST TIME THIS CLAUSE HAS CLOSED A HALF ' +
    'RATHER THAN NARROWED ONE: ADR-293 section 3.5 ruled that THE PAYOUT ' +
    'PATH LOCKS, as `PayoutTx.lockScope()` delegated to `handle.lockScope()` and called by ' +
    '`decidePayout` FIRST, on `decideWithdrawal`s and `checkout.ts`s unanimous precedent, and ' +
    'ADR-301 landed all four lines. So slice 6`s read-then-write is SERIALISED rather than ' +
    'backstopped only by ' +
    '`payout_requests_no_in_flight_uq`, WHICH TURNS A CONTRACT-SPECIFIED 409 INTO A 500 AND IS ' +
    'KEYED PER ACCOUNT WHERE THE EXPOSURE QUESTION IS PER IDENTITY, and `payouts.test.ts` ' +
    'watches the 409 under two concurrent requests. `transact` STILL TAKES NO LOCK and ' +
    'ADR-293 section 3.4 is why. SO WHAT THIS CLAUSE ' +
    'NAMES NOW IS FOUR MEMBERS AND ONE BRANCH, AND NOT A PORT: ' +
    '`apps/api/test/payout-backend.test.ts` drives ' +
    'the adapter over `db-recorder.ts` and asserts each refusal BEFORE it reads ' +
    'anything, and `rule-state-producibility.test.ts` holds the census at EXACTLY ONE ' +
    'implementing file so a second cannot arrive unnoticed. AND THE FOLD RULING IS UNCHANGED ' +
    'AND STILL BINDS EVERY SLICE AFTER THIS ONE: THE API DOES NOT GET TO ' +
    'FOLD A `RuleState` ITSELF AND ADR-239 RULES IT. `INV-M5-02` (`M05:81`) is that both ' +
    'endpoints call ' +
    '`evaluatePayout` with the same inputs because "a second evaluator would be a second rule", ' +
    "and a request-path fold is the divergence ADR-026 C-07's `state_hash` exists to make " +
    'detectable, computed on the one path no replay audit reads. ' +
    'SIXTH, AND THE CLAUSE THAT HAS MOVED MOST IS NOW CLOSED. ' +
    '`PayoutSubject` (`routes/payouts.ts:337`) CARRIES THREE FIELDS AND THIS ENTRY NAMED ONLY ' +
    'TWO FOR ELEVEN REVISIONS. `state` is clauses one to four, `plan` was discharged by ' +
    'ADR-233, and `gates` is an `ExternalGates` WHICH IS NOW CONSTRUCTIBLE. THE CLAUSE MOVED ' +
    'THREE TIMES AND IS RECORDED THAT WAY BECAUSE EACH MOVE WAS A DIFFERENT KIND OF THING. ' +
    'ADR-248 read that NO value of it was resolved from a row anywhere under a `src/` and ' +
    'ruled it unbuildable, because `hasPayoutInFlight` had no predicate to read: `M01` stated ' +
    'R-38 at the ACCOUNT grain in section 2.1 and at the IDENTITY grain in Group F, and both ' +
    'sentences were inside a FROZEN plan. ADR-254 RULED THE GRAIN ACCOUNT, amended M01`s two ' +
    'R-38 rows with the retired wording kept and marked, and left the leg waiting on a ' +
    'resolver somebody writes rather than a decision somebody makes. ADR-260 WROTE IT. ' +
    '`resolveExternalGates` (`packages/rules-engine/src/external-gates.ts`) takes the RAW ' +
    'column values and returns the record or refuses BY LEG: `payoutsFrozen` is ' +
    '`identities.payouts_frozen` (`0002_identity.sql:50`) OR `accounts.payouts_frozen` ' +
    '(`0007_accounts.sql:83`), `reconBlocked` is `accounts.recon_blocked` ' +
    '(`0007_accounts.sql:87`) with no identity half, `kycState` is the head of the ' +
    'supersession chain over `kyc_verifications.state` (`0003_kyc.sql:51`), `accountStatus` is ' +
    '`accounts.status` (`0007_accounts.sql:60`), and `hasPayoutInFlight` is an `approved`, ' +
    '`frozen` or `held_pending_review` `payout_requests` row FOR THE SUBJECT ACCOUNT, which is ' +
    '`payout_requests_no_in_flight_uq`s predicate (`0031_payout_hold_and_identity_restriction.sql:104-106`). ' +
    'ITS HOME IS THE ENGINE AND THAT IS ADR-239 SLICE A`s ARGUMENT UNCHANGED: TWO deployables ' +
    'need the one narrowing, `apps/worker` for `AccountDay.external` and this port for ' +
    '`PayoutSubject.gates`, neither can import the other, and that package declares no ' +
    'workspace dependency at all, so a resolver in each would be `FM-16` by name. THE ' +
    'SEVEN-VERSUS-SIX GAP IS CLOSED BY A REFUSAL AND NOT BY A WIDER UNION: `account_status` ' +
    'declares SEVEN members (`0001_extensions_and_enums.sql:47`) and `AccountStatus` ' +
    '(`packages/rules-engine/src/types.ts:891`) takes SIX, `M01:203` carries the same six so ' +
    'the engine transcribed its source correctly, and the resolver REFUSES ' +
    '`provisioning_pending` rather than admitting it, because an account still being ' +
    'provisioned is not an account whose payout verdict is meaningful and widening the union ' +
    'would amend a frozen plan through a type. NO LEG TAKES A DEFAULT, PERMISSIVE OR ' +
    'REFUSING: `R-41` conjoins all five as VETOES, so a fact defaulted to the permissive value ' +
    'is a veto that never fires and a refusing default denies every eligible trader while ' +
    'reading as a working gate (ADR-248 section 8), and a row that cannot be read raises an ' +
    '`ExternalGatesRefusal` naming the account and every failing leg. AND ADR-019s ' +
    'ONE-IN-FLIGHT-PER-IDENTITY RULE IS A DIFFERENT RULE ON A DIFFERENT TABLE AND IS ALREADY ' +
    'SERVED: `gateNoInFlight` (`routes/wallet-withdrawals.ts`) refuses a second open ' +
    '`wallet_withdrawals` row for one identity IN THE HANDLER, because that legs open index is ' +
    'plain rather than unique (ADR-158 finding 8), and it does not read this field. ' +
    'SO THE THREE FIELDS WAIT ON TWO THINGS BETWEEN THEM, AND THE SEVENTEENTH REVISION OF THIS ' +
    'REASON IS THE FIRST TO NAME THE ONE THAT WAS NEVER ON IT (ADR-281). THE RETIRED SUMMARY ' +
    'IS PARAPHRASED RATHER THAN QUOTED, because a reason that reproduces its own retired ' +
    'sentence reads as live to every grep, and this entry has retired the same question that ' +
    'way twice already. IT SAID THE `plan` FIELD WAITED ON NOTHING, ON ADR-233`s AUTHORITY, ' +
    'AND ADR-233 GAVE THIS TRANSACTION THE READ AND NOT THE DECODE. `PayoutSubject.plan` is a ' +
    '`ResolvedPlan` (`routes/payouts.ts:435`); `resolvePlan` takes a DECODED `PlanRulesJson` ' +
    'and a decoded `PlanVersionSizeRow` (`packages/rules-engine/src/plan/resolve.ts:184`); and ' +
    '`plan_versions.rules` is `jsonb`, so a catalogue row is a blob and not a plan. THAT WAS ' +
    'THE THIRD TIME THIS ENTRY NAMED THE SECOND-CHEAPEST BLOCKER, and it is the failure this ' +
    'file diagnoses in itself rather than a new kind of miss: a session dispatched to remove ' +
    'what this entry named would have removed a scheduled run and a calendar door that landed ' +
    'two waves ago, found the route still answering 503, and had no written account of why. ' +
    'ADR-283 TOOK THE MOVE ADR-281 REGISTERED AND COULD NOT MAKE, AND THE BLOB HALF IS ' +
    'DISCHARGED. `decodePlanRules` (`packages/rules-engine/src/plan/rules-codec.ts`) is ' +
    'exported from the engine (`packages/rules-engine/src/index.ts`), `apps/api` has declared ' +
    '`@merit/rules-engine` since session 252, and ADR-239 slice A is the home it landed in ' +
    'beside `gates-codec.ts`, which is where ADR-250 put this port`s other codec. IT IS A ' +
    'DECODE AND NOT A CAST: the return type is the engine`s own `PlanRulesJson`, so a document ' +
    'that is not the shape THROWS `PlanRulesCodecError` naming the dotted path, and the day ' +
    'the type grows a key the decoder fails to compile. TWO PROPERTIES DIFFER FROM ' +
    '`gates-codec.ts` AND EACH HAS A DOCUMENT AS ITS REASON: an UNDECLARED key is tolerated, ' +
    'because DATA_MODEL section 11 carries `limits` and `kyc` and `PlanRulesJson` deliberately ' +
    'does not, so a stray-key refusal would refuse the corpus`s own example; and cents are ' +
    'JSON NUMBERS rather than base-10 strings, because that example writes ' +
    '`min_payout_cents: 10000`, with a string accepted beside a number and a number past ' +
    '`Number.MAX_SAFE_INTEGER` refused rather than rounded. NO `CV-nn` IS RE-RUN AT READ AND ' +
    'THAT IS A RULING RATHER THAN AN OMISSION: `validatePlan` TAKES the decoded type, so it is ' +
    'not an alternative to decoding, and it needs EVERY size of the version, so a read holding ' +
    'the account`s ONE pinned size would get an `ok` about a different question than the ' +
    'publish gate answered. The read-time floor is the five refusals `resolvePlan` already ' +
    'makes (CV-01, CV-03, CV-06, CV-16 and SD-10), and a row published before any OTHER ' +
    '`CV-nn` existed decodes unchecked, which ADR-283 section 4 states rather than hides. AN ' +
    'ABSENT KEY IS REFUSED AND NEVER DEFAULTED, on ADR-258 section 6`s ruling one field over, ' +
    'so DATA_MODEL section 11`s OWN EXAMPLE does not decode: it carries no ' +
    '`min_settlement_lag_trading_days`, which M01 section 2.4 requires, and ' +
    '`rule-state-producibility.test.ts` link 8 decodes the document out of the README on every ' +
    'run to prove it. WHAT `plan` WAITS ON NOW IS THE SIZE ROW AND IT IS SMALLER AND NAMED: ' +
    '`ScopedTx.catalogRowAt` returns `Promise<unknown>` (`packages/db/src/scoped-db.ts:3726`) ' +
    'and `plan_version_sizes.payout_cap_schedule_cents` is itself `jsonb` holding cents ' +
    '(`packages/db/migrations/0004_catalog.sql:168`), so the second argument is a blob too. ' +
    'ADR-283 DID NOT TAKE IT AND ADR-286 IS THE RULING IT SAID SOMEBODY OWNS. THAT ROW LEFT ' +
    'THIS CLAUSE FRAMED AS A CHOICE OF KEY SPELLING IN WHICH ONE CALLER GIVES UP ITS OWN, AND ' +
    'THE FRAMING IS RETIRED RATHER THAN ANSWERED. The retired wording is paraphrased and not ' +
    'quoted, because a reason that reproduces its own retired sentence reads as live to every ' +
    'grep. THE SPELLINGS ARE REAL AND ADR-286 RE-DERIVED BOTH AT SOURCE BEFORE RULING: ' +
    '`apps/worker` reads a driver row whose properties are `packages/db`s camelCase ' +
    "(`size_cents: bigintOf(row, 'sizeCents', at)`, `apps/worker/src/batch/adapter.ts:1304`) " +
    'and `apps/site` reads a wire object under the stored snake_case column names ' +
    '(`apps/site/src/catalog/adapter.ts:498`). **BUT NEITHER SPELLING IS A PREFERENCE AND SO ' +
    'NEITHER IS TRADEABLE, AND THE MANIFESTS ARE WHERE THAT IS VISIBLE RATHER THAN THE ' +
    'READERS**: `apps/site` DECLARES NO `@merit/db` AT ALL, so it reads snake_case because it ' +
    'reads Merit`s own HTTP response and has no database to read instead, while `apps/worker` ' +
    'and `apps/api` both declare it and both get Drizzle`s property names. Asking the site to ' +
    'read camelCase is asking the wire contract to change and asking the worker to read ' +
    'snake_case is asking `packages/db` to stop mapping. **AND THE PAYOUT PATH IS ON THE ' +
    'DRIVER SIDE OF THAT SPLIT, SO IT NEEDS NO RENAME FROM ANYBODY**: this deployable already ' +
    'reads `plan_version_sizes` off this door under the driver spelling, at ' +
    '`readSize` (`apps/api/src/routes/catalog.ts:1213`), which is a THIRD size-row reader ' +
    'ADR-283`s count did not reach because it returns a LOCAL row type rather than the ' +
    'engine`s. **SO THE RESIDUE IS A HOME AND NOT A RULING, AND THAT IS THE FIRST TIME THIS ' +
    'CLAUSE HAS NAMED IT**: a driver-side decoder has to know `packages/db`s property names, ' +
    '`RI-01` forbids the engine from knowing them and that package`s own manifest says it ' +
    'never may, and `apps/api` and `apps/worker` cannot import each other, so `toSizeRow` ' +
    '(`apps/worker/src/batch/adapter.ts:1417`) fits this port exactly and is unreachable from ' +
    'it. ADR-239 slice A`s argument PUT `gates-codec.ts` in the engine and the same argument ' +
    'read in the other direction KEEPS this one out. **AND THE ONE `FM-16` IN THIS AREA IS THE ' +
    'CAP SCHEDULE RATHER THAN THE ROW, WHICH IS THE FINDING ADR-283 COULD NOT SEE FROM WHERE ' +
    'IT STOOD**: the spelling ruling does not reach INSIDE the `jsonb`, where every reader asks ' +
    'for the same two stored keys, so `payout_cap_schedule_cents` WAS one predicate stated ' +
    'THREE times, by `toCapScheduleCents` (`apps/worker`), `decodeCapSteps` (`apps/site`) and ' +
    '`readCapSchedule` (`apps/api/src/routes/catalog.ts`), with nothing comparing them -- AND ' +
    'THE THIRD HAD DIVERGED ON THE MONEY, admitting a `cap_cents` past ' +
    '`Number.MAX_SAFE_INTEGER` and handing back the rounded double while refusing the base-10 ' +
    'string ADR-283 ruling 5 blessed, which its two peers did neither of. **ADR-302 CLOSED IT ' +
    'AND THE CENSUS IS NOW ONE**: `decodeCapScheduleCents` ' +
    '(`packages/rules-engine/src/plan/cap-schedule-codec.ts`) states it once and ALL THREE ' +
    'READERS WERE RETIRED IN THE DIFF THAT ADDED IT, which is what kept the codec from being ' +
    'the FOURTH statement ADR-286 refused and ADR-269 refused one port over for this same ' +
    'value: `EligibleFoldUnwired` states it in its own message and `setAdminReadSource`s entry ' +
    'above carries it. ADR-286 section 7 item 1 is CLOSED. ' +
    'AND THE TREE STILL STATES THE RULES BLOB`s DECODING ' +
    'THREE TIMES UNTIL `toPublishedRules` (`apps/worker/src/batch/adapter.ts:1230`) and ' +
    '`decodeRules` (`apps/site/src/catalog/adapter.ts:549`) COLLAPSE ONTO THE ENGINE`s, which ' +
    'row 283`s fence put out of bounds; link 7 holds that census at exactly three, holds the ' +
    'cap-schedule census at ONE beside it, and asserts the repaired cap-schedule property so a ' +
    'SECOND cannot arrive unnoticed and each remaining retirement is visible the day it ' +
    'lands. ' +
    '`gates` STILL WAITS ON NOTHING (ADR-260) AND THAT IS RE-DERIVED RATHER THAN CARRIED: ' +
    '`ExternalGateFacts` takes raw scalars and two row lists, `identities` is `root` and ' +
    '`accounts`, `kycVerifications` and `payoutRequests` are `owned`, so every input is on this ' +
    'transaction. AND `state` NO LONGER WAITS ON A READ, ON A CODEC OR ON A REFUSAL ARM. ' +
    'ROW 281 ASKED WHETHER A PORT REFUSES ON AN EMPTY TABLE OR WIRES AND ANSWERS HONESTLY THAT ' +
    'THERE IS NO STATE FOR THE DAY, ADR-283 ANSWERED THAT THE SECOND ARM DID NOT EXIST, AND ' +
    'ADR-285 BUILT IT. The retired wording is paraphrased rather than quoted, because a reason ' +
    'that reproduces its own retired sentence reads as live to every grep, and this entry has ' +
    'retired a question that way three times already. IT READ THAT `unwiredOrThrow` RETHREW ' +
    'EVERYTHING THAT WAS NOT A `PayoutBackendUnwired`, so a wired backend meeting an unfolded ' +
    'day answered 500 on the door where money leaves the firm. THE RETHROW IS UNCHANGED AND THE ' +
    'ARM SITS BESIDE IT: `stateNotFolded` (`routes/payouts.ts`) answers an absent row with 503 ' +
    '`service_unavailable` and a generic `detail`, out of the payout transaction`s own catch. ' +
    'NO CANONICAL CODE IS INVENTED, because API_CONTRACT section 2`s table is CLOSED and section ' +
    '2 defines 503 as a dependency that is down and safe to retry, which is what an unrun fold ' +
    'is; `payout_not_eligible` is refused because its `gates` breakdown would show every gate ' +
    'PASSING, which is ADR-140`s false-eligibility-story shape one door up. AND THE REFUSAL IS ' +
    'STILL NEVER A STATE: `RuleStateAbsent` is a class and not an arm, a fabricated `RuleState` ' +
    'is a payout basis nobody computed, and `rule-state-producibility.test.ts` link 7 asserts ' +
    'this route builds none. `RuleStateUnreadable` IS DELIBERATELY NOT CAUGHT and stays a 500, ' +
    'because a row whose columns disagree with the schema that wrote them is an internal error ' +
    'and a retryable status would tell a trader to retry what no retry can fix. ' +
    'THE PORT IS UNCHANGED AND THE TRIPLE HAS MOVED WITHOUT IT, AT ELEVEN OF TWENTY-FIVE ' +
    'DECLARED WITH FOURTEEN BLOCKED. THIS CLAUSE READ "THE WIRED COUNT IS UNCHANGED AT TEN OF ' +
    'TWENTY-FOUR DECLARED" AND IS REPAIRED RATHER THAN DELETED (`RI-14`): it was true until ' +
    'ADR-347 declared `useCertificateRateLimiter` and installed it, which moved both halves by ' +
    'one and left `blocked` where it was. It is the SECOND hand-spelled count in this file ' +
    'found stale by ADR-357, and neither was asserted by anything, which is why the triple is ' +
    'derived at the assertion and a count written in prose is not. ' +
    'AND THE REASON FOR THAT IS NEW A FOURTH TIME: every clause on this ' +
    'entry until ADR-264 named something nobody had BUILT, ADR-268 closed the one that named a ' +
    'READ, ADR-281 found a decoding whose home was RULED and untaken, ADR-283 TOOK IT, and ' +
    'ADR-285 IS THE FIRST CLAUSE TO CLOSE ON A REFUSAL PATH RATHER THAN ON A CAPABILITY. ' +
    'WHAT STANDS NOW IS TWO THINGS AND NOT THREE, WHICH IS WHY A READER WHO WATCHED THE ' +
    'CHEAPEST OF THE THREE CLOSE MAY NOT CONCLUDE THIS PORT IS ONE STEP FROM LIVE: the SIZE ' +
    'ROW`s decoding, and the FIVE REFUSING MEMBERS of the backend that now exists, which is ' +
    'clause FIVE narrowed by ADR-291 rather than discharged. BOTH ARE CODE SOMEBODY WRITES IN ' +
    'THIS REPOSITORY, which is what keeps this entry a liability that can expire: an entry whose ' +
    'last obstruction is an operator fact ADR-241 ruled EXTERNAL is one nothing here could ' +
    'ever discharge. ADR-256 RULING 12 IS WHY REMOVING THE CHEAPEST DID NOT WIRE ANYTHING: ' +
    'wiring is permitted when the last gap is a thing THE DEPLOYMENT SETS, and a composition ' +
    'that does not exist is not such a gap. AND THE ENTRY IS REWRITTEN RATHER THAN SHRUNK FOR ' +
    'THE HABIT THIS FILE KEEPS CATCHING IN ITSELF: the size row is now the cheapest of the two ' +
    'and the missing backend is the whole purchase, so the ORDER is stated here and a session ' +
    'dispatched at this entry does not have to rediscover it. ' +
    'A CONSTRAINT ON ANY FUTURE `PayoutTx` LANDED WITH THE ARM AND IS REGISTERED HERE RATHER ' +
    'THAN LEFT FOR AN IMPLEMENTER TO MEET: `subject()` MUST resolve ownership BEFORE it reads ' +
    '`rule_states`, because 404 and 503 are distinguishable and a scoped read of a foreign ' +
    'account`s rows is EMPTY, so a state-first implementation would answer a prober 503 for ' +
    'every account of another identity where API_CONTRACT section 1 requires 404. ' +
    'THE FIRM-READ CLAUSE IS ' +
    'DISCHARGED AND IS DELETED RATHER THAN KEPT BESIDE A DOOR THAT LANDED: `ScopedTx` now ' +
    'carries `catalogRows`, `catalogRowsWhere` and `catalogRowAt` over `CATALOG_TABLE_KEYS` ' +
    '(`packages/db/src/scoped-db.ts:3403`), a closed list of five `firm` keys that includes ' +
    "`planVersions` and `planVersionSizes`, so `PayoutTx.subject`'s `ResolvedPlan` inputs are " +
    'readable ON THE PAYOUT TRANSACTION and the two-transaction remedy ADR-211 clause 2 ruled ' +
    'is not needed. AN OLDER CLAUSE IS KEPT AS HISTORY BECAUSE IT WAS FALSE: this entry once ' +
    'read "a `RuleState` NO MIGRATION IN THIS TREE CAN STORE", and `lifetime_settled_cents`, ' +
    '`breached` and `breach_kind` are all three columns of `rule_states` as of ' +
    '`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql`. THE GREP IT QUOTED IS ' +
    'LIVE AND RI-20 RUNS IT: `grep -rn lifetime_settled packages/db/migrations` returns 7 ' +
    'lines. REGISTERED RATHER THAN REPAIRED: `routes/payouts.ts:625-626` states "no member of ' +
    'this interface that a scoped door cannot serve", which ADR-233 makes TRUE of the ' +
    'catalogue half and leaves false of `state`. EVERY CLAUSE ABOVE IS A PREDICATE SOMEWHERE ' +
    'AND NOT ONLY A SENTENCE HERE: `apps/api/test/rule-state-producibility.test.ts` runs the ' +
    'SEVEN links on every CI-01 pass, because a reason naming the second-cheapest blocker ' +
    'retires the question for every reader after it and this entry has done that three times. ' +
    'AND THREE CITATIONS IN THIS ENTRY WERE FOUND STALE BY EXACTLY FIFTEEN LINES BEFORE A ' +
    'CHARACTER OF ADR-281 WAS WRITTEN, WHICH IS ADR-212 ON THIS ENTRY A THIRD TIME: `state`, ' +
    '`PayoutTx.subject` and the no-member sentence each pointed fifteen lines above themselves, ' +
    'because a docblock was inserted above them and nothing checks a line number. All three are ' +
    'repointed here at the post-diff file rather than left, and the durable repair is still the ' +
    'one ADR-212 names, which is to cite a NAME where a name will do. ' +
    'LINK 7 IS ADR-281`s AND IT IS A CENSUS RATHER THAN A SENTENCE: exactly two files in this ' +
    'tree call `resolvePlan(` and neither is under `apps/api/src`, exactly two declare a ' +
    '`rules` decoder and neither is importable here, and the day either count moves this entry ' +
    'goes red rather than stale. A ' +
    'PARTIAL BACKEND IS REFUSED RATHER THAN OVERLOOKED: `listPayouts` and `idempotency` are ' +
    'both constructible today (`payoutRequests` is `owned`, `scope.ts:1245`, and ' +
    '`databaseIdempotencyStore` exists at `src/idempotency-store.ts:144`), and installing them ' +
    'beside a `transact` whose `subject` rejects would put a live-looking route in front of the ' +
    'arm that approves payouts. **AND THAT SENTENCE STOPPED BEING A WARNING AND BECAME A ' +
    'PROPERTY THE DAY THE BACKEND LANDED**: ADR-291 built `transact` and left BOTH of those ' +
    'members rejecting, `payout-backend.test.ts` asserts the unwired store in all three of its ' +
    'methods, and `rule-state-producibility.test.ts` asserts the module names no ' +
    '`databaseIdempotencyStore`, so installing either one is a session deleting a test rather ' +
    'than a session forgetting a paragraph. MONEY PATH.',
  // ---------------------------------------------------------------------------
  // THE REVENUE PATH, AND ITS ENTRY NAMED TWO OF FOUR OBSTRUCTIONS. ADR-230.
  //
  // THE FIRST IS DISCHARGED AND THE ENTRY SHRINKS BY IT, which is assertion 2 of
  // this file's own three working: the day a door lands the list must shrink
  // rather than keep a stale excuse beside a live line. `attributions` had no
  // write authority in `packages/db` and now has the narrowest one there is.
  //
  // TWO OF THE THREE THAT REMAIN WERE NEVER IN THIS ENTRY AT ALL, and that is
  // the finding rather than an omission being tidied. This list exists to make a
  // reason a LIABILITY THAT EXPIRES, and an entry naming the second-cheapest
  // blocker retires the question for every reader after it: a session dispatched
  // to remove what this entry named would have removed it, found the route still
  // answering 503, and had no written account of why. Both were derived on this
  // tree at the sources cited below rather than inherited.
  //
  // THE FIRM READ WAS THE ONE THAT BLOCKED EVERY REQUEST AND ADR-233 BUILT IT,
  // so that clause is DELETED rather than replaced: `CATALOG_TABLE_KEYS` is five
  // keys and they are exactly the five tables this port reads. `usePayoutBackend`
  // above lost the same clause in the same ruling.
  //
  // AND THE ENTRY STILL DID NOT NAME ITS CHEAPEST BLOCKER, FOR THE SECOND TIME.
  // `accountCap()` is the FIRST line of both handlers and its `maxAccounts` has
  // no source in any migration, which `databaseAuthBackend` has reported about
  // the same number on `GET /me` since ADR-171. A session dispatched to remove
  // what this entry named would have removed it twice over and found the route
  // still answering 503, which is the failure mode the paragraph above describes
  // and this is its second instance on one port.
  //
  // ADR-238 RULED ALL THREE AND DISCHARGED NONE, WHICH WAS A DIFFERENT OUTCOME
  // FROM THE TWO BEFORE IT AND IS STILL WORTH THE DISTINCTION. ADR-230 and
  // ADR-233 each BUILT a door and this entry lost a clause to each. ADR-238
  // built nothing: it ruled where the cap comes from, refused the cross-identity
  // read a second time on ground ADR-233 could not supply, and established that
  // the ledger arm is foreclosed by the CORPUS rather than by the accessor.
  //
  // ADR-252 IS THE FIRST ENTRY TO NARROW CLAUSE 1 RATHER THAN RESTATE IT, AND
  // IT DID NOT DELETE IT. `0074` gives the base cap a `firm` row and registers
  // it, so the clause stops being "no column anywhere" and becomes "no door
  // from a scoped transaction, and no row in the table". THAT IS TWO STEPS
  // SHORT OF A WIRING AND BOTH ARE NAMED: a `CATALOG_TABLE_KEYS` admission with
  // ADR-233's argument attached, which `refuseUncatalogued` states in its own
  // message and this table satisfies, and a writer for the row.
  //
  // THE PAIRING WITH `readMe` IS WEAKER THAN IT WAS AND THE ENTRY SAYS SO. The
  // two refusals were the same finding while neither number had a source. They
  // are not now: `readMe` reads through `ApiDb.firm` and needs no catalogue
  // admission, so only the empty table is common to both. An entry that kept
  // calling them identical would send a session to clear one and find the other
  // standing, which is the failure mode the paragraph above describes.
  //
  // THE REASONS ARE NOW ASSERTED AS WELL AS WRITTEN, which is what this entry
  // has needed since the first time it went stale. `test/checkout-backend-
  // blockers.test.ts` reads the file each clause is about and pins it: the port
  // method that takes no plan, the call order on both handlers, the one
  // migration line, the two registry classes, the catalogue list, the reason
  // vocabulary, the door set and the corpus line that pins `LT-08`. A clause
  // here going stale now turns a case red rather than waiting for a reader.
  // ---------------------------------------------------------------------------
  useCheckoutBackend:
    'A CAP WHOSE ROW AND DOOR BOTH EXIST AND WHOSE TABLE IS EMPTY, AND THE LEDGER ARM. ' +
    'TWO CLAUSES STILL: THE FIRST IS NARROWED FOR THE SECOND TIME IN A WEEK AND NOT DELETED ' +
    '(ADR-252, then ADR-265, both on ADR-238 ruling 1) AND THE CROSS-IDENTITY READ IS DELETED ' +
    '(ADR-262). THE `firm` READ CLAUSE THIS ENTRY LED WITH UNTIL ADR-233 STAYS DELETED: ' +
    '`ScopedTx` carries `catalogRows`, `catalogRowsWhere` and `catalogRowAt` over ' +
    '`CATALOG_TABLE_KEYS` (`packages/db/src/scoped-db.ts:3403`), whose five members are exactly ' +
    'the five tables this port reads, and the `attributions` write clause before it was ' +
    'discharged the same way by ADR-230. THIS PORT HAS LOST ITS LEAD BLOCKER TWICE AND ANSWERED ' +
    '503 AFTER EACH. WHAT REFUSES NOW, RE-DERIVED ON THIS TREE. FIRST, THE CAP, AND IT IS STILL ' +
    'THE FIRST LINE OF BOTH HANDLERS: `accountCap()` (`routes/checkout.ts:851`) runs before the ' +
    'plan on the purchase path and before `resetTarget` on the reset path. ADR-238 ruling 1 ruled ' +
    "the base cap the FIRM'S number and refused `limits.max_accounts_per_entity` in all three of " +
    'its available forms, because that leaf is PER PLAN VERSION while `liveAccounts` beside it ' +
    "is this identity's total across EVERY plan: reading the purchased version makes the " +
    'effective cap the MAXIMUM over published versions, reading the pinned version reads a row ' +
    'that may have been retired years earlier, and requiring every published version to agree is ' +
    "a firm parameter wearing a plan's costume that no CHECK can express. ADR-252 BUILT THAT " +
    'HOME AND WIRED NOTHING TO IT: `grep -rln firm_parameters packages/db/migrations` returns ' +
    '2 files, and the FIRST is `0074_firm_parameters.sql`, which creates `base_account_cap` on ' +
    "`price_floors`' shape with its approver a foreign key into `operators`. THE COUNT READ 1 " +
    'UNTIL ADR-284 PUT THE WRITE CONTROL BESIDE THE ROW, and the second file is that control ' +
    'rather than a caller: the clause at the foot of this entry is where it is read. THE ' +
    'EXCEPTION IS ' +
    'UNTOUCHED AND 0002 IS NOT EDITED: `grep -rn max_accounts_override ' +
    'packages/db/migrations/0002_identity.sql` returns 1 line. AND ADR-265 BUILT THE DOOR, SO ' +
    'THE CLAUSE THAT SAID "NO DOOR" IS SPENT: `grep -rn effectiveAccountCap ' +
    'packages/db/src/scoped-db.ts` returns 6 lines. FOUR ARE THE DOOR -- the declaration on ' +
    '`ScopedTx`, the implementation, the statement function and its call -- and the OTHER TWO ' +
    'ARE ADR-268 CITING IT AS PRECEDENT, once for taking no argument and once for reading its ' +
    'registry rule rather than assuming it. THE COUNT READ 4 UNTIL A SECOND NAMED DOOR WAS ' +
    'BUILT BESIDE THE FIRST, which is the shape this invariant exists to surface. IT IS A ' +
    'NAMED DOOR AND NOT A ' +
    'CATALOGUE ADMISSION, WHICH IS THE PART WORTH READING: ADR-252 section 10 sized the ' +
    'remainder of this clause as one member added to `CATALOG_TABLE_KEYS`, and ADR-265 REFUSED ' +
    'that sizing rather than deferring it. A catalogue read hands out ROWS, so the caller would ' +
    'do the effective dating this supersession dated table needs and would fold ' +
    '`identities.max_accounts_override` itself, which is the control a second caller forgets. ' +
    'The door resolves both and returns ONE INTEGER, the list is still five members, and this ' +
    'port is where the difference would have been paid. THE READ STILL CANNOT MOVE OUTSIDE THE ' +
    'TRANSACTION, WHICH IS WHY THE DOOR IS ON THE SCOPED HANDLE: `INV-M3-15` requires the ' +
    'restriction check at the same point in the transaction as the cap and `gateIdentity` ' +
    'performs both in one call. WHAT IS LEFT OF CLAUSE 1 IS THE EMPTY TABLE ALONE, WHICH NO ' +
    'DOOR FIXES: nothing under any `src/` writes a `firm_parameters` row or an `operators` row, ' +
    'and AN ABSENT ROW IS NO CAP RATHER THAN AN UNLIMITED ONE, so the door THROWS there, before ' +
    'it reads the identity, and its return type is `number` so no caller has an absent value to ' +
    'fold into `Infinity`. THAT IS THE REFUSAL ADR-252 SAID THIS SLICE OWED. ' +
    'AND THE EMPTY TABLE IS NARROWED FOR THE THIRD TIME RATHER THAN DISCHARGED (ADR-284), ' +
    'BECAUSE A ROW NEEDS A WRITER AND A WRITER FOR A CONFIG NUMBER IS AN OPERATOR ACT. ' +
    'THE HALF THAT NEEDED NO IDENTITY PROVIDER IS BUILT AND IT IS A CONTROL RATHER THAN A ' +
    'CALLER: `grep -rn firm_parameters packages/db/migrations` now returns TWO files, and ' +
    '`0076_firm_parameter_write_control.sql` makes an unapproved cap UNWRITABLE. A row cites ' +
    'an approved `dual_control_approvals` row whose `payload_hash` is that row of the cap ' +
    "written out canonically, its requester is the cap row's own `approved_by` so that " +
    "`0016`'s second-person CHECK is the second-person rule rather than a second copy of it, " +
    'BOTH HANDS ARE ACTIVE `owner` OPERATORS because API_CONTRACT section 8 bounds `ops` to ' +
    '"no config or role changes", the act appears in `admin_actions` under the operator who ' +
    'signed it, and the row is superseded rather than rewritten. THREE THINGS THAT FILE FOUND ' +
    'BY EXECUTING RATHER THAN READING: `firm_parameters` declared NO `uuid` COLUMN AT ALL ' +
    'while `admin_actions.subject_id` is `uuid NOT NULL`, so the audit row section 8 requires ' +
    'COULD NOT NAME A CAP ROW; `dual_control_approvals` had NO FOREIGN KEY on either of its ' +
    'two names, so the second person could be a string naming nobody; and `0074` promised ' +
    'supersession and nothing enforced it. THE DELAY WINDOW IS NOT INSTALLED ' +
    'AND THE REASON IS STATED: D4 and ADR-010 require one and state NO DURATION, and a number ' +
    'invented here is what `0074` refused to do with the cap itself. WHAT IS LEFT IS THE ' +
    'OPERATOR ROUTE AND IT IS BEHIND THE SSO PURCHASE: every admin mutation resolves its ' +
    'principal through `setAdminSessionSource`, `operators` still has no writer, the table is ' +
    'STILL EMPTY and the door STILL THROWS. This port is not wired and nothing here wires it. ' +
    '`databaseAuthBackend` STILL REFUSES `readMe` (`src/auth-backend.ts:1576`) ABOUT THE SAME ' +
    'NUMBER AND IS ONE FINDING WITH THIS ONE AGAIN: ADR-252 found the two had STOPPED being one ' +
    'finding, because this port needed a catalogue admission and that one did not; ADR-265 built ' +
    'a named door instead of taking the admission, so the construction half is gone from both ' +
    'and the empty table is all that is left of either. THE DIFFERENCE BETWEEN THEM WAS THE ' +
    'DOOR AND THERE IS ONE DOOR. ' +
    'ADR-341 NARROWED WHAT "ONE FINDING" MEANS AND DID NOT DISSOLVE IT: the two ports are one ' +
    'finding ABOUT THE CAP, and they are not one finding about their endpoints, because ' +
    '`readMe` carries two further blockers this cap has nothing to do with (`Me.kyc.placement` ' +
    'and `Me.accounts_count`, both run by `test/me-blockers.test.ts`). SO CLOSING THE CAP ' +
    'CLOSES THIS CLAUSE HERE AND DOES NOT OPEN `GET /me`. ADR-341 also found what `0076` ' +
    'already required of the cap row and neither entry had said: two distinct `owner` operators ' +
    'on a `dual_control_approvals` row plus an `admin_actions` row, so the cap arrives at deploy ' +
    'time through that control rather than in any migration. ' +
    'THE PORT IS NOT WIRED AND `effectiveAccountCap` IS CALLED ' +
    'NOWHERE IN `apps/api`: `grep -rn effectiveAccountCap apps/api/src` returns 4 lines and ' +
    'every one of them is prose. ' +
    'THE CROSS-IDENTITY READ THIS ENTRY CARRIED SECOND IS DISCHARGED AND IS DELETED RATHER ' +
    'THAN NARROWED (ADR-262). IT IS THE THIRD CLAUSE THIS ENTRY HAS LOST IN A WEEK AND THE ' +
    'FIRST DISCHARGED WITHOUT A READ GRANT: neither table became readable, and both refusals ' +
    'are still asserted -- `affiliates` is scope class `owned` on `identity_id` and ' +
    '`affiliate_clicks` is `derived` through it, and `CATALOG_TABLE_KEYS` reaches neither. ' +
    'WHAT MOVED IS THE SHAPE THE PORT ASKS FOR: an `AffiliateRef` carries `isBuyer` instead of ' +
    '`identityId`, `ScopedTx` gained `attributionAffiliate` and `attributionClick`, which ' +
    'resolve the affiliate inside the transaction and project the answer to a bit, and ' +
    '`PairRule` now records that `attributions` resolves its counterparty from `affiliate_id`, ' +
    'so `insertAsParty` STAMPS `affiliate_identity_id` and the insert takes NEITHER identity ' +
    "from the caller. That is ADR-238 ruling 2's own remedy, which is ADR-230's stamp applied " +
    "to the counterparty. SECOND AND LAST, THE LEDGER ARM, AND ADR-165's " +
    'GROUND STILL HOLDS: the `ledger` on the wallet arm (`routes/checkout.ts:1056`) is a ' +
    '`LedgerTx`, which only `SystemTx` satisfies because `ledger_transactions` and ' +
    '`ledger_entries` are both `derived` rather than `firm`, `SystemReason` is still exactly two ' +
    'members (`packages/db/src/scoped-db.ts:271`) and `ApiDb` still declares no door that yields ' +
    'a `SystemTx`. ADR-238 RULING 7 ADDS THE HALF ADR-165 DID NOT REACH: ADR-176 cleared the ' +
    'same obstruction for `LT-01` by DELETING `PayoutTx.ledger` and posting later at a system ' +
    'authority, and that remedy does NOT transfer, because M20 pins `LT-08` to the purchase ' +
    'transaction by name and `DEP-M20-02` states the consequence of moving it. The card arm ' +
    'alone would be a partial backend whose port promises the whole transaction, which is the ' +
    'shape `usePayoutBackend` refuses above. AND ADR-270 NARROWS THIS ARM BY RULING IT ' +
    'OUTSIDE ITS OWN ANSWER RATHER THAN INSIDE IT. That entry rules what posts a ledger ' +
    'entry when the request path may not: a job a clock started, at `nightly-batch`, on the ' +
    'door `apps/worker` holds. LT-08 IS NOT REACHED BY THAT ANSWER AND THE REASON IS THE PIN ' +
    'RATHER THAN A FENCE: a posting may move to a clock exactly where the check it is bound ' +
    'to resolves no caller, INV-M20-01 binds LT-06 to a live POSITION which is read off ' +
    'rows, and INV-M20-02 binds LT-08 to the PAYING IDENTITY, which IS the caller (M20 ' +
    'section 7, AS-M20-06: ownership is resolved server side and "compared to the paying ' +
    'identity, in the same transaction as the debit"). This transaction is a request ' +
    'transaction by construction, so NO SUCCESSOR MAY REACH FOR THE WORKER HERE and the arm ' +
    'still waits on the ruling ADR-238 ruling 7 named, in `packages/ledger` and ' +
    '`packages/db`. EVERY CLAUSE HERE IS ASSERTED BY ' +
    '`test/checkout-backend-blockers.test.ts` RATHER THAN ONLY WRITTEN. MONEY PATH.',
  useCheckoutAdapters:
    'a configured PSP adapter per MID plus the `returnUrl` and `cancelUrl` configuration. ' +
    '`packages/psp` ships a port and TWO FAKES (`fakes/psp-a.ts`, `fakes/psp-b.ts`) and no ' +
    'vendor adapter, and `packages/enrichment` is in the same position. NOTE: this port already ' +
    'holds `PRODUCTION_CHECKOUT_ADAPTERS` at module scope (`checkout.ts:1211`), so calling the ' +
    'setter here would install what is already installed. That would raise the wired count and ' +
    'serve nothing, and it is not a wiring.',

  // ---------------------------------------------------------------------------
  // THE FOURTH NO-OP, AND IT IS THE STRONGEST OF THE FOUR. ADR-226.
  //
  // The three above hold a PRODUCTION OBJECT at module scope. This one holds
  // the real Cloudflare verifier, reading `MERIT_TURNSTILE_SECRET` from
  // `process.env` on every call, so a deployment that sets the secret is
  // verifying tokens with nothing installed and nothing remembered. That is
  // deliberate rather than convenient: an anti-bot control that is live only
  // when a wiring slice remembers it is the class of defect ADR-226 exists to
  // remove, and `start.ts` is not this session's file to edit.
  //
  // AND IT DOES NOT FAIL OPEN WHEN THE SECRET IS ABSENT. The default answers
  // `unconfigured`, which `routes/auth.ts` serves as 503. So the port has no
  // unwired state: it verifies, or it refuses, and there is no third thing for
  // `start.ts` to install.
  // ---------------------------------------------------------------------------
  useTurnstileVerifier:
    'NOTHING. THIS PORT IS ALREADY LIVE AND THE ENTRY EXISTS TO SAY SO. ' +
    '`routes/auth.ts` initialises it with `cloudflareTurnstileVerifier()` at module scope ' +
    '(`routes/auth.ts:643`), which reads `MERIT_TURNSTILE_SECRET` from `process.env` per call ' +
    'and calls Cloudflare, so calling the setter from `start.ts` would install what is already ' +
    'installed. That would raise the wired count and serve nothing, and it is not a wiring, on ' +
    "`useCheckoutAdapters`'s stated rule three entries up. THE DIFFERENCE FROM THOSE THREE, AND " +
    'IT IS THE REASON THIS ENTRY IS NOT A LIABILITY: they wait on a vendor adapter that does not ' +
    'exist, and this one waits on nothing at all. An absent secret is not an unwired state ' +
    'either; the default answers `unconfigured` and `POST /auth/otp` serves that as 503 ' +
    '(ADR-226), so there is no configuration under which this port admits an unverified token.',

  // ---------------------------------------------------------------------------
  // A dependency that does not exist in this workspace, or a row the registry
  // cannot name.
  // ---------------------------------------------------------------------------
  useKycDeps:
    'a `KycProvider` vendor adapter and a configured `returnUrl`. `packages/kyc` ships a port ' +
    'and ONE FAKE (`fakes/provider.ts`) and no vendor adapter. NOTE: this port already holds ' +
    '`productionKycDeps` at module scope (`kyc.ts:284`), whose `provider` and `returnUrl` are ' +
    'both null, so calling the setter here would install what is already installed. That is not ' +
    'a wiring.',
  useAffiliateDeps:
    'TWO obstructions, and this entry has named THREE, then TWO, then a DIFFERENT ONE, then ' +
    '"ONE obstruction, and this entry has named THREE, then TWO, then a DIFFERENT ONE". ' +
    'THE LAST OF THOSE IS CORRECTED BY ADR-358 AND IS QUOTED HERE RATHER THAN REPLACED, on ' +
    'RI-14`s rule and on the rule this entry keeps being the subject of. THE ' +
    'COUNT WAS WRONG BECAUSE NOBODY RE-DERIVED THE METHOD LIST: each rewrite repaired the ' +
    'clause it was dispatched about and INHERITED the rest, and the second survivor had never ' +
    'been named by ANY version of this entry. ADR-358 derives the door PER METHOD from the key ' +
    'sets in `scoped-db.ts` instead, so this column stops being the place the answer lives. ' +
    'THE OBSTRUCTION THIS ENTRY LED WITH FOR TWO WAVES IS DISCHARGED AND THE ONE BEHIND IT IS ' +
    'NOT (ADR-321 wrote the column, ADR-324 repaired what was still being said about it). ' +
    'THE RETIRED CLAUSES ARE QUOTED RATHER THAN DELETED, on RI-14`s rule and on the rule this ' +
    'entry has now been the subject of twice. THEY READ: `affiliate_commissions` is ' +
    '"UNREGISTERED in packages/db/src/scope.ts and UNDECLARED in packages/db/src/schema.ts", ' +
    'it is "ONE COLUMN away rather than a class away", the column "IS RESERVED AND NOT ' +
    'WRITTEN", and a session dispatched here "would be taking a number the ruling gates on a ' +
    'read that has not happened". ALL FOUR WERE TRUE WHEN WRITTEN AND ALL FOUR WERE FALSE THE ' +
    'DAY `0078_affiliate_commission_owner.sql` MERGED, and nothing in this repository went ' +
    'red, because what was asserted anywhere was the WORDS. ' +
    'AND THE SENTENCE UNDER THEM IS OLDER AND WAS ALSO FALSE (ADR-304, 2026-08-30). IT READ: ' +
    '"ADR-253 rules that it is not one registration away but a SEVENTH SCOPE CLASS away". ' +
    'ADR-304 met ADR-253 section 6`s open question and REFUSED THE SEVENTH CLASS in those ' +
    'terms: the vocabulary was not what was missing, and what was missing was ' +
    '`affiliate_id uuid NOT NULL REFERENCES affiliates(id)`, which `affiliate_creatives`, ' +
    '`affiliate_clicks` and `affiliate_statements` each declare and on which all three are ' +
    'registered `derived` via `affiliates` WITH NO RULING AT ALL. ' +
    'WHAT IS TRUE NOW, RE-DERIVED ON THIS TREE RATHER THAN INHERITED: `0078` declares that ' +
    'exact edge on `affiliate_commissions`, `schema.ts` declares `affiliateId`, and `scope.ts` ' +
    'registers the table `derived` via `affiliates` on `affiliate_id` as a `hop`, which makes ' +
    'it the FOURTH table on that rail registered on the THIRD`s rule and with no new class. So ' +
    'the three money figures of `AffiliateStats` -- `earned_cents_lifetime`, `payable_cents` ' +
    'and `paid_cents_lifetime` -- have a scoped door and wait on an ADAPTER, which is the same ' +
    'position five of the six methods are in. THE CLASS QUESTION IS SETTLED AND THE ANSWER IS ' +
    '`derived` AND NOT `firm`, and the clause saying why is kept because the mistake is still ' +
    'available: `firm` compiles, is accepted by every mechanical check in this repository, and ' +
    'is FALSE, because a commission is what Merit owes a named affiliate. ' +
    'WHAT REFUSES NOW IS THE FOURTH FIELD, AND NO MIGRATION AND NO SCOPE CLASS REACHES IT. ' +
    '`conversions_30d` is a count over `attributions`, which is `pair`: excluded from ' +
    '`ScopedTableKey` AND from `FirmTableKey`, so `scopePredicate` throws on it, and ADR-106`s ' +
    'exclusion is a ruling about what a ROW read returns while a count returns no row. What ' +
    'serves it is a NAMED DOOR returning one integer, which is ADR-262`s and ADR-265`s ' +
    'construction and needs no registry change and no DDL. THIS PORT THEREFORE WAITS ON A ' +
    'COUNTING DOOR AND THEN AN ADAPTER, IN THAT ORDER, and on no further ruling. ' +
    'THE FOUNDER GATE THIS ENTRY CARRIED IS DISCHARGED AS A DISPATCH CONDITION AND NOT AS A ' +
    'READ. ADR-304 put its second judgement to the founder -- whether a denormalized tenancy ' +
    'column on a money table is acceptable at all -- in its APPROVAL block rather than in its ' +
    'section 10, which this entry cited wrongly, and ruled that a founder preferring the ' +
    'derivation "should say so before `0078` is dispatched rather than after". `0078` HAS BEEN ' +
    'DISPATCHED AND HAS MERGED, so there is no number left for a session to take here and the ' +
    'warning is spent. WHAT IS OWED INSTEAD IS AN `E2` READ: ADR-321 is `proposed` and ' +
    'UNSIGNED, and merging is not signing. ' +
    'THE CITATION FOR THE FACTS MOVED WITH THEM: ' +
    '`packages/db/test/affiliate-commissions-is-a-column-away.test.ts` asserted the column`s ' +
    'ABSENCE and now asserts what `0078` did about it, table by table, against the migration ' +
    'set; `docs/decisions/ALLOCATION.md` carries `0078` as TAKEN AND SPENT rather than as ' +
    '"RESERVED, NOT WRITTEN, AND NO FILE EXISTS"; and what a caller is SERVED is asserted, ' +
    'derived rather than quoted, in `apps/api/test/affiliate-stats-obstructions.test.ts`. ' +
    'THE SECOND OBSTRUCTION IS DISCHARGED AS A REGISTRY QUESTION AND IS NOT ' +
    'DELETED: it read that no table records an ISSUED link, and ADR-253 section 3 rules that ' +
    'none is owed, because `affiliate_clicks_token_uq` is UNIQUE and one issued link is clicked ' +
    'many times, so an issued handle and a click token cannot be one column, and every attribute ' +
    'a link would carry is already on `affiliate_clicks` at click grain. `issueLink` therefore ' +
    'waits on an ADAPTER and a BASE URL rather than on DDL, which is the same position ' +
    '`affiliate`, `requiredDisclosure` and `statements` are in. THIS LIST NAMED ' +
    '`submitCreative` TOO AND NO LONGER DOES (ADR-358), and the removed name is the whole of ' +
    'the correction: on that method the peer group WAS the claim, and it was false. ' +
    '`requiredDisclosure` STAYS IN THE LIST AND ITS REASON IS REPLACED: it reads ' +
    '`tos_versions`, which is `firm`, so its door is `ApiDb.firm()` and never the `owned` door ' +
    'over `affiliates` that its refusal used to name. The answer was right and the reason was ' +
    'followable to the wrong table. FOUR of the ' +
    'six methods are an adapter somebody can write and TWO are not. THIS CLAUSE READ "FIVE of ' +
    'the six methods are an adapter somebody can write and ONE is not, AND THE ONE IS STILL ' +
    '`stats`, for a reason that is now the counting door alone", and it is kept beside its ' +
    'correction per RI-14 (ADR-358). `stats` IS STILL ONE OF THE TWO and the counting door is ' +
    'still its reason. THE SECOND IS `submitCreative`, WHICH NO VERSION OF THIS ENTRY HAS EVER ' +
    'NAMED. It is a WRITE of `affiliate_creatives`, and it was served a refusal calling it a ' +
    'READ and reasoning about `affiliates`. `affiliate_creatives` is `derived`, and no handle ' +
    'a request path can open inserts one: `ScopedTx.insert` takes `OwnedTableKey`, ' +
    "`insertUnder` takes `ParentedTableKey`, which is `Extract<DerivedTableKey, 'sessions'>` " +
    'and a CLOSED LIST OF ONE, `insertAsParty` takes `PartyWritableTableKey` and this table is ' +
    'not `pair`, and `FirmTx.insert` takes `FirmTableKey`. `ApiDb` exposes `scoped`, `firm`, ' +
    '`resolution`, `establishment` and `publicLookup` AND NO SYSTEM HANDLE. NOTHING IN THIS ' +
    'TREE WRITES `affiliate_creatives`. So it waits on a `packages/db` WIDENING and then an ' +
    'adapter, which is the shape `stats` waits in rather than the shape an adapter closes. ' +
    'WHAT THIS PORT CAN SERVE TODAY, DERIVED RATHER THAN PROMISED: `affiliate`, `statements` ' +
    'and `requiredDisclosure` have doors, so `GET /affiliate/statements` is servable on doors ' +
    'alone once a cursor rule exists; `POST /affiliate/links` is servable the moment a base URL ' +
    'is a configured value; and `GET /affiliate/stats` and `POST /affiliate/creatives` cannot ' +
    'be served at all without a `packages/db` diff, the second because it needs BOTH the write ' +
    'door and `requiredDisclosure`. THE REPAIR REGISTERED HERE ' +
    'TWO WAVES AGO IS TAKEN: `STATEMENTS_UNREACHABLE` served a caller the retired sentence that ' +
    '`affiliate_statements` is not in `schema.ts`, and ADR-253 section 5 repairs it at the ' +
    'constant and at the module header, which carried the same sentence a second time and which ' +
    'no entry had named. NOTE: this port already holds `productionAffiliateDeps` at module scope ' +
    '(`affiliate.ts:672`), so calling the setter here would install what is already installed. ' +
    'That is not a wiring.',
  setInternalOpsSource:
    'FOUR METHODS, AND ADR-242 RULES THEM ONE AT A TIME BECAUSE ONE REASON COVERED WHICHEVER OF ' +
    'THEM IT HAPPENED TO FIT. This entry read: "an ops plane rather than a database read. ' +
    '`readDependencies`, `readJobs` and `readReconStatus` are probes of other processes, and ' +
    '`runBatch` COMMANDS one. None of the four is a shape `ApiDb` offers." The last sentence is ' +
    "REWRITTEN RATHER THAN DELETED, on RI-14's rule that a false sentence removed leaves nothing " +
    'for the next reader to check: it is TRUE of two methods, true for the WRONG REASON of a ' +
    'third, and FALSE of the fourth. ' +
    '`readDependencies` IS A COMMAND AND NO PARTIAL ADAPTER EXISTS. Three of API_CONTRACT ' +
    "section 9's four dependencies are other systems, `apps/api/src` reaches the network in " +
    'exactly two files and they are a CAPTCHA verifier and an OTP vendor, `packages/psp` ships a ' +
    'port and two fakes and no vendor adapter, and no manifest in this workspace declares an ' +
    'SFTP library. `renderDeepHealth` throws on a missing probe by ruling, so an adapter that ' +
    'probed `db` and omitted the other three could not render a response. ' +
    '`readJobs` IS A COMMAND ON THE HALF THAT DECIDES. A queue depth lives in the pg-boss ' +
    'schema, which NO migration installs; `JobQueue` declares five methods and none reads a ' +
    "depth; `expected_by` is a CELL OF A MARKDOWN TABLE by the field's own docblock; and " +
    '`firing` is the alarm, which is not in this tree. `renderJobs` throws on an empty dead-man ' +
    'list, so the queue half alone cannot render either. ' +
    '`readReconStatus` IS A DATABASE READ AND THE ENTRY WAS RIGHT ABOUT IT FOR THE WRONG REASON. ' +
    '`apps/worker/src/recon/sweep.ts` writes the rows, every field maps to a column of ' +
    '`0014_marks.sql`, and the exact filter is ALREADY WRITTEN in this deployable, inside ' +
    "`readLiabilityBook` as its `rowsWhere('reconciliations', { status: 'mismatch' })` read " +
    '(`admin-source/liability.ts`). THE POINTER IS A NAME RATHER THAN A NUMBER, on ADR-212, ' +
    'because this citation has now been broken twice by lines inserted above it. ' +
    'What refuses it is THE DOOR: `reconciliations` is scope ' +
    'class `derived` (`packages/db/src/scope.ts:1434`), so `firm` refuses the key AT COMPILE ' +
    'TIME and `scoped` has no identity on this surface, and ADR-171 clause 1 refuses the ' +
    '`SystemTx` door until an `AdminSessionSource` a deployment can install exists. ADR-237 ' +
    'measured that condition as UNMET. ' +
    '`runBatch` IS A COMMAND AND `ApiDb` DOES OFFER ITS SHAPE. `firm(fn)` yields a `FirmTx`, ' +
    'which carries `sqlExecutor(reason)` (`packages/db/src/scoped-db.ts:3587`) at the one reason ' +
    '`job-enqueue`, and that is structurally the `JobTransaction` `packages/queue` declares. It is ' +
    'blocked on an AUTHORITY and not a shape: `apps/api` declares no `@merit/queue`, and the ' +
    'manifest is the only place that capability can be acquired (ADR-117 section 5). Beyond it ' +
    'sit a job store with no schema and a consumer that does not run. ' +
    'THE PORT STAYS BLOCKED ON ONE READ OUT OF FOUR, and that is a ruling rather than a ' +
    "shortfall: `usePayoutBackend`'s rule refuses one live arm beside arms that reject, and this " +
    'port\'s OWN docblock refuses it harder -- four setters "would buy the ability to half-wire ' +
    'the operator console, which is not an ability anybody has asked for". ' +
    '`routes/internal.ts:844` still says a retry against this process will never succeed, and ' +
    'that citation was always for THIS clause rather than for the `ApiDb` one beside it. ' +
    'EVERY ABSENCE ABOVE IS EXECUTED in `test/internal-ops-constructibility.test.ts` rather than ' +
    'stated here, so the day any of them lifts a case goes red and this entry expires.',
  useCertificateRevokeBackend:
    'READ BY ADR-246 AS THE THIRD OF THE THREE CERTIFICATE PORTS AND LEFT EXACTLY WHERE IT ' +
    'STOOD: it is the one of the three that is NOT about the card, so the card landing does ' +
    'nothing for it and this entry does not expire with the other two. ' +
    'TWO OBSTRUCTIONS, AND THE SECOND IS A CIRCULARITY RATHER THAN A MISSING DOOR. ' +
    '`principal(request)` (`routes/admin-certificates.ts:353`) resolves only through ' +
    '`AdminSessionSource`, so it is blocked on `setAdminSessionSource` above, WHICH IS NOW ONE ' +
    'NAMED THING RATHER THAN TWO (ADR-237): the operator directory is in this database and the ' +
    'assertion verifier is not. SECOND AND INDEPENDENT: ' +
    '`AdminCertificateTx` runs `lockAt`, `insert` and `updateAt` on ONE transaction ' +
    '(`routes/admin-certificates.ts:326`), and one of the two tables is `certificates`, scope ' +
    'class `owned` on `identity_id` (`packages/db/src/scope.ts:970`). `db.firm` refuses that key ' +
    'at compile time because `FirmTableKey` is every key whose class is `firm` ' +
    '(`packages/db/src/scope.ts:1614-1616`; it stood at sixteen hundred and seven through ' +
    'sixteen hundred and nine when this entry was written, and that number is out of ' +
    "citation grammar on purpose, ADR-212, because it now points inside `operatorSessions`' " +
    'own reason and a grep would find a live line). THE CLAIM ITSELF IS UNCHANGED AND WAS ' +
    'RE-MEASURED: the type is still every key whose class is `firm`. `db.scoped` needs an identity THIS ROUTE CANNOT ' +
    'KNOW UNTIL IT HAS READ THE ROW: `:id` is `certificates.id` and the identity is a column of ' +
    'the row the door would be opened to read. `adminActions` is `firm` ' +
    '(`packages/db/src/scope.ts:1119`), so the audit half alone has a door and the subject half ' +
    "does not, which is the one-live-arm shape this file refuses on `usePayoutBackend`'s stated " +
    'rule. ADR-231 DOES NOT REACH THIS ONE AND THE REASON IS THE ADDRESS: `db.publicLookup` is ' +
    'READ ONLY and its vocabulary is `certificates` by `code`, while this route locks and ' +
    'updates, and addresses by `certificates.id`, which `PUBLIC_LOOKUP_ADDRESS` refuses ' +
    'deliberately because `0020` keeps the two columns distinct so the public token can be ' +
    'rotated. THIRD, AND ' +
    'it is configuration rather than a door: `presentation()` ' +
    "(`routes/admin-certificates.ts:363`) is `GET /verify/:code`'s copy, and the " +
    "`account_enforced` sentence is `OQ-M11-02`, still open. THIS ROUTE REVOKES A TRADER'S " +
    'PUBLIC PROOF; a backend that answered plausibly would be a fixture doing that to real ' +
    'people.',
  // ---------------------------------------------------------------------------
  // The cash door. THE REASON THAT STOOD HERE WAS FALSE AND IS REPLACED RATHER
  // THAN DELETED, because it was true when it was written. ADR-172.
  //
  // It read: no implementation of `IdempotencyStore` exists in this tree,
  // because `complete` is an UPDATE of exactly one row and `systemTx`/`firmTx`
  // hardcode `undefined` for the `WHERE`. THE SECOND HALF IS STILL TRUE AND IS
  // A FACT ABOUT DOORS THIS STORE DOES NOT USE. `databaseIdempotencyStore`
  // (`src/idempotency-store.ts:144`) opens `db.scoped` on all three methods and
  // stamps through `tx.updateAt(TABLE, { key }, ...)`, which ADR-112 clause 3
  // composes as `WHERE identity_id = $1 AND key = $2`. ELEVEN EXECUTED TESTS in
  // `idempotency-store.test.ts` hold it, and this file said so itself twenty
  // lines above, in `usePayoutBackend`'s entry. Both could not be true.
  //
  // THE PORT IS STILL BLOCKED AND THE TRUE REASON IS WORSE THAN THE FALSE ONE.
  // `routes/wallet-withdrawals.ts:57-60` records that NOTHING IN THIS TREE
  // drives `requested --> approved` or `cooling --> approved`, and `:350-355`
  // puts `requested` and `cooling` both inside `OPEN_WITHDRAWAL_STATUSES`, on
  // which `gateNoInFlight` refuses. THE ARRAY HAS MOVED FOUR TIMES AND THE
  // EARLIER PLACES ARE WRITTEN OUT OF CITATION GRAMMAR ON PURPOSE (ADR-212, the
  // rule this entry states about its own two dead numbers): it stood at lines
  // two hundred eighty three, two hundred eighty seven and three hundred
  // twenty seven before ADR-267 added a docblock above it, and a pointer quoted
  // as HISTORY must not wear the shape that says follow me. So a wired endpoint writes a row nothing
  // will ever advance and then refuses that identity's every later withdrawal,
  // permanently, behind a screen saying a withdrawal is in flight.
  //
  // A 503 AND A LOCKOUT BOTH REFUSE, AND ONLY ONE OF THEM IS REVERSIBLE. That
  // is why the 503 is kept, and it is the same fail-closed direction session
  // 303 was reaching for with the reason it had.
  //
  // AND THEN THE ENTRY NAMED THE WRONG EDGE, WHICH IS ADR-232's FINDING AND IS
  // THE FOURTH TIME THIS FILE HAS RECORDED A REASON THAT DID NOT SURVIVE BEING
  // CHECKED. It read the missing approval edge as the thing standing between a
  // wired backend and the lockout, and IT IS NOT: `approved` IS ITSELF ONE OF
  // THE FOUR OPEN STATUSES. A withdrawal that crosses `G-WITHDRAWAL-CLEARED`
  // moves from `requested` to `approved`, `gateNoInFlight` finds it in exactly
  // the same list, and the trader is refused their next withdrawal by the same
  // 409. Building the approval edge -- which session 422 did build, guarded,
  // with the founder's dual-control threshold on it -- does not shorten this
  // entry by a word.
  //
  // WHAT ACTUALLY RELEASES AN IDENTITY IS `settled`, `failed` OR `cancelled`,
  // the three arrows STATE_MACHINES section 3.2 draws into `[*]`, and NOTHING
  // IN THIS TREE DRIVES ANY OF THEM EITHER. Derived over `apps/**` and
  // `packages/**` outside the test and tooling directories at the moment
  // ADR-232 was written: the only writers of a `wallet_withdrawals` row are the
  // creation INSERT in `routes/wallet-withdrawals.ts` and one `updateAt` in
  // `apps/worker/src/sweeps/expiry.ts`, and the second writes the freeze trio
  // and `updated_at` without touching `status` at all.
  //
  // SO THE OBSTRUCTION IS ONE EDGE WIDER THAN IT WAS WRITTEN, and the honest
  // 503 is kept for the reason it was always kept for rather than for the
  // reason this entry used to give.
  // ---------------------------------------------------------------------------
  useWithdrawalBackend:
    'A TERMINAL EDGE, AND NOT THE APPROVAL EDGE THIS ENTRY USED TO NAME (ADR-232), WHICH IN ' +
    'TURN WAS NOT THE STORE IT NAMED BEFORE THAT (ADR-172 clause 5). ' +
    '`databaseIdempotencyStore` (`src/idempotency-store.ts:144`) exists and serves the identity ' +
    'arm this route presents, so the idempotency half has not been what refuses since ADR-172. ' +
    'THE APPROVAL EDGE IS NOT WHAT REFUSES EITHER, and that sentence IS FALSE where this entry ' +
    'used to state it: session 422 built `requested --> approved` and `cooling --> approved`, ' +
    'guarded and dual controlled above 500000 integer cents, and the port did not become ' +
    'wireable, because `approved` IS ITSELF ONE OF THE FOUR MEMBERS OF ' +
    '`OPEN_WITHDRAWAL_STATUSES` (`routes/wallet-withdrawals.ts:357-362`) and `gateNoInFlight` ' +
    'refuses on the whole list. AND THE SENTENCE AFTER THAT ONE IS NOW WRONG TOO, WHICH MAKES ' +
    'FIVE CORRECTIONS TO THIS ENTRY AND IS ADR-234. It read that NOTHING IN THIS TREE reaches ' +
    '`settled`, `failed` or `cancelled`. Session 424 built `requested --> cancelled` and ' +
    '`cooling --> cancelled` under `G-TRADER-CANCELS`, guarded, with `0072` binding the arrow ' +
    "set at the database, and `withdrawalReleasesIdentity('cancelled')` is true, so ONE OF " +
    'THE THREE IS DRIVEN. AND THE SENTENCE AFTER THAT ONE IS NOW WRONG AS WELL, WHICH MAKES ' +
    'SIX CORRECTIONS TO THIS ENTRY AND IS ADR-263. It read that the edge which exists has NO ' +
    'DOOR, resting on API_CONTRACT stating in terms that "there is no endpoint that cancels a ' +
    'withdrawal" and naming `G-TRADER-CANCELS` "as owed rather than invented". ADR-263 MOVED ' +
    'THAT ONE PARAGRAPH AND `POST /wallet/withdrawals/:withdrawalId/cancel` SERVES IT, ' +
    'elevated, so THE LOCKOUT HALF OF THIS REASON IS DISCHARGED: a trader closes the ' +
    'withdrawal they opened and `gateNoInFlight` takes their next one. WHAT REFUSES NOW IS ' +
    'ONE EDGE FURTHER ON, AND IT IS THE OBSTRUCTION ADR-232 SECTION 6 ALREADY NAMED RATHER ' +
    'THAN A NEW ONE: NO DOOR DRIVES `requested --> approved` EITHER, so a wired backend would ' +
    'take a withdrawal request that nothing in this estate can pay. The approval posts LT-06 ' +
    'and needs the ledger authority ADR-165 declined and ADR-172 clause 2 ruled is not a ' +
    'handle. AND ADR-267 NARROWS THAT CLAUSE FROM AN ABSENCE TO A RULING, WHICH IS THE ' +
    'SEVENTH CORRECTION TO THIS ENTRY AND THE FIRST THAT MAKES IT SMALLER RATHER THAN ' +
    'LONGER. The question a successor would otherwise ask here is whether ADR-176 clears it ' +
    'the way it cleared LT-01. IT DOES NOT, AND THE FOUR PINS ARE RUN RATHER THAN RESTATED ' +
    'HERE: `lt06-posting-timing.test.ts` holds M05 section 2.1 (LT-01 CREDITS the wallet and ' +
    'LT-06 DEBITS it), INV-M20-01, M20 section 3.3a, and the key `decideWithdrawal` already ' +
    'stores. What refuses is WHEN the posting happens and not a missing key or a handle. ' +
    'THE CONSEQUENCE FOR THIS PORT IS THAT NO `apps/api` DOOR CAN DISCHARGE THIS CLAUSE AT ' +
    'ALL: the driver that lands it performs the TRANSITION AND THE POSTING TOGETHER at a ' +
    'system authority, which is a move OUT of this deployable rather than a wiring inside ' +
    'it, so this entry is no longer waiting on a slice that could arrive here. ' +
    'AND ADR-270 CLOSES THE AUTHORITY HALF, WHICH IS THE EIGHTH CORRECTION AND THE SECOND ' +
    'THAT MAKES THIS ENTRY SMALLER. This clause used to end on a door nobody had ruled. ' +
    'BOTH REFUSALS STAND, RE-DERIVED AT SOURCE AND NOT SOFTENED: `SystemReason` is still two ' +
    'members and `ApiDb` still declares no system door. WHAT POSTS IS DECIDED BY WHO THE ' +
    "TRANSACTION'S OPENER SERVES, which `packages/ledger/src/tx.ts` states in its own words, " +
    'and a job a clock started is `nightly-batch` on the door `apps/worker` has held since ' +
    'ADR-165 clause 2. SO WHAT IS LEFT IS NOT AN AUTHORITY AND NONE OF IT IS IN THIS ' +
    'DEPLOYABLE: the worker declares no `@merit/ledger`, `ExpiryLedgerPort.postLt01` has no ' +
    'adapter, and there is no job store. THE WORKER RUNNING IS NOT WHAT ANSWERED IT EITHER ' +
    '(ADR-241, ADR-260): the handle predates the run, and what those entries changed is ' +
    'delivery rather than authority. `ledger-posting-authority.test.ts` RUNS the ruling and ' +
    '`lt06-posting-timing.test.ts` RUNS the leg, each watched red under five seeded defects. ' +
    'Past it `settled` and `failed` are drawn only out of `transferring`, reached by ' +
    'enqueueing on a rail with no live adapter and no importer. A 503 says Merit cannot do ' +
    'this today. A wired deployment would say yes and then never pay, and a trader can now ' +
    'take that request back but cannot make it settle. `TERMINAL_EDGE_FINDINGS` in ' +
    '`routes/wallet-withdrawals.ts` carries one finding per terminal status with its sources, ' +
    '`wallet-withdrawals.test.ts` RUNS them rather than reading them, and finding C is marked ' +
    'CLOSED by the door rather than deleted. ' +
    'AND ADR-305 SIZED THE DRIVER AND FOUND THREE ABSENCES THIS ENTRY HAD NEVER NAMED, WHICH ' +
    'IS THE NINTH CORRECTION AND THE FIRST CARRIED IN FROM A ROW THAT COULD NOT REACH THIS ' +
    'FILE. ADR-305 section 8 says so in its own words: `F1`, `F2` and `F3` "live here and not ' +
    'there", owed to this entry by a row whose fence reaches `apps/api/test/**`. THIS IS THAT ' +
    'ROW AND ALL THREE ARE RE-DERIVED AT SOURCE RATHER THAN CARRIED. ' +
    '`F1`, AND IT IS WHY THE MANIFEST LINE THE WORKER IS MISSING IS NOT THE FIX IT LOOKS ' +
    'LIKE: `@merit/ledger` PUBLISHES NO `LT-06` BUILDER. `walletWithdrawalApprovalPosting` ' +
    '(`packages/ledger/src/reversal.ts:218`) is a module-scoped `function`, that package`s ' +
    'index publishes `walletWithdrawalFailurePosting` (`LT-09`, built from `LT-06` through ' +
    '`reversalPosting`) and not it, and a manifest line grants a deployable the EXPORTED ' +
    'surface, so a session reading the worker`s missing dependency as a one-line fix would ' +
    'land the line, import the package and find no function to call. ' +
    '`F2`: `lt01` HAD EXACTLY ONE DEFINITION IN THIS REPOSITORY AND IT WAS IN THE DEPLOYABLE ' +
    'THE WORKER CANNOT IMPORT. The way round was ' +
    'refused by the port itself, which says that file "names no ledger account, writes no ' +
    'transfer and contains no ledger arithmetic", a second transcription of the split being ' +
    'ADR-092 section 5`s two-statements-of-one-fact hazard on the money path. So `lt01` moves ' +
    'or nothing posts. ADR-305 POINTED AT THAT DEFINITION AT A LINE IT NO LONGER HELD and the ' +
    'pointer here was re-derived rather than transcribed. ' +
    'ADR-317 MOVED IT AND `F2` IS DISCHARGED. It is `packages/ledger/src/payout.ts:101`, both ' +
    'doors in `apps/api` import it back, and it STILL HAS EXACTLY ONE DEFINITION: the move ' +
    'was code motion and the property the old arrangement protected is what carried it. ' +
    'THE MANIFEST LINE IS STILL OWED, so this port is no closer to wired: slice 6 owes ' +
    '`apps/worker/package.json` its `@merit/ledger` dependency and the adapter itself. ' +
    '`F3` IS THE SMALLEST AND WOULD STOP A SESSION JUST AS HARD, BECAUSE THE ADAPTER SENTENCE ' +
    'AND THE PORT DISAGREE. `ExpiryTx` (`apps/worker/src/sweeps/ports.ts:157`) declares ' +
    '`rowsWhere`, `lockAt` and `updateAt` and no `ledger` member, while `postLt01` ' +
    '(`apps/worker/src/sweeps/ports.ts:259`) WAS specified in its own docblock as ' +
    '`postTransaction(tx.ledger, ...)`, so the sentence describing the one-line adapter ' +
    'described a line that does not compile. The omission is deliberate rather than an ' +
    'oversight: `EXPIRY_TABLES` excludes both ledger keys "so nothing here can write a ledger ' +
    'row by naming a key", and ADR-006 requires the posting to commit in the SAME transaction ' +
    'as the state change, so a second handle is not the remedy. THAT WAS A DESIGN QUESTION AND ' +
    'ADR-315 ANSWERED IT: the docblock is corrected, `ExpiryTx` keeps three members, and the ' +
    '`LedgerTx` stays in the wiring, recovered by the identity of the handle `postLt01` is ' +
    'given. `F3` IS DISCHARGED AND SLICE 6 STILL OWES THE ADAPTER ITSELF. ' +
    'NONE OF THE THREE MOVES THIS PORT AND NONE IS MEANT TO. ADR-305 section 7 makes the ' +
    'installation slice 9, blocked on slices 7 and 8 AND on a payment rail that is ' +
    'FOUNDER-OWED and that no engineering session supplies, and its section 5 measures what a ' +
    'premature wiring costs: `0072` refuses `approved --> cancelled` at the database and ' +
    '`transferring` is unreachable, so the day `LT-06` posts an approved withdrawal has no ' +
    'exit at all. THEY ARE CARRIED HERE SO THAT THE NEXT READER OF THIS ENTRY MEETS THEM ' +
    'BEFORE STARTING RATHER THAN AFTER. ' +
    'THE ENTRY SUPPLIES ITS OWN DECISION PROCEDURE AND RI-20 RUNS IT: ' +
    '`grep -rn driveApprovals apps/api/src` returns 3 lines, which are the transition and two ' +
    'references to it in docblocks, and NO FOURTH LINE IS A CALLER, which is what refuses; ' +
    '`grep -rn driveCancellation apps/api/src` returns 7 lines, and that number moved because ' +
    'ONE of them IS a caller now. A count that changes when a door lands is what this entry ' +
    'is for. TWO LINE NUMBERS ' +
    'IN THIS ENTRY WERE FALSE BY EIGHTEEN LINES WHEN ADR-176 CHECKED THEM, in the reason ' +
    'ADR-172 wrote one session earlier to replace a false one: line 1233 was the KYC term and ' +
    'line 1506 was a `.send(`. The CLAIMS held at their real lines and the CITATIONS did not, ' +
    'which is the same drift in its quietest form. THOSE TWO NUMBERS ARE WRITTEN OUT OF ' +
    'CITATION GRAMMAR ON PURPOSE: a `file:line` pointer is a claim about THIS tree, so a ' +
    'pointer quoted as HISTORY must not wear the shape that says follow me (ADR-212). ' +
    'AND ADR-342 IS THE TENTH CORRECTION, THE THIRD THAT MAKES THIS ENTRY SMALLER, AND THE ' +
    'FIRST WRITTEN BY A ROW DISPATCHED TO INSTALL THIS PORT RATHER THAN TO EXPLAIN IT. FOUR ' +
    'SENTENCES ABOVE ARE NOW FALSE AND ARE KEPT WHERE THEY WERE MADE. (1) IT READ that NO ' +
    'DOOR DRIVES `requested --> approved` EITHER. `runWithdrawalApprovals` ' +
    '(`apps/worker/src/withdrawals/approval-sweep.ts`) performs that arrow AND ' +
    '`cooling --> approved`, with the `LT-06` posting in the same transaction at a system ' +
    'authority. (2) `F1` READ that `@merit/ledger` PUBLISHES NO `LT-06` BUILDER. ' +
    '`packages/ledger/src/index.ts` exports `walletWithdrawalApprovalPosting` and ' +
    '`apps/worker/src/sweeps/ledger.ts` calls `postTransaction` with it. (3) IT READ that ' +
    'THE MANIFEST LINE IS STILL OWED and that slice 6 owes the worker its `@merit/ledger` ' +
    'dependency. `apps/worker/package.json` declares it. (4) IT READ that the driver is a ' +
    'move OUT of this deployable rather than a wiring inside it, so this entry was NO LONGER ' +
    'WAITING ON A SLICE THAT COULD ARRIVE HERE. The move happened and the slice arrived, one ' +
    'deployable over. ' +
    'WHAT REFUSES NOW IS SMALLER THAN ANY OF THAT AND IS STILL NOT AN ADAPTER FOR THIS PORT. ' +
    '`UNWIRED_WITHDRAWAL_APPROVAL_IO` is the only `WithdrawalApprovalSweepIo` in the tree, ' +
    "the approval job carries `disposition: 'unscheduled'`, and `apps/worker/src/index.ts` " +
    'states the condition in its own words: the installation MUST NOT BE DISPATCHED BEFORE A ' +
    'PAYMENT RAIL EXISTS, because past `approved` there is no exit and `0072`s `WD-C2` ' +
    'refuses `approved --> cancelled` at the database. The rail is FOUNDER-OWED and is ' +
    'unchanged. ' +
    'AND ADR-342 ADDS THE ONE BLOCKER THIS ENTRY NEVER NAMED, WHICH IS THIS DEPLOYABLES OWN. ' +
    '`C-27` refuses every caller of both rows BEFORE the handler body runs, and ' +
    '`databaseAuthBackend` declares `elevate` BLOCKED on both arms, so no session in a ' +
    'deployment can be elevated and the 503 this port produces is itself unreachable. AN ' +
    'INSTALL WOULD THEREFORE CHANGE NO OBSERVABLE RESPONSE AND WOULD ARM ITSELF SILENTLY on ' +
    'the day an unrelated row lands a WebAuthn ceremony or an SMS sender, which is an ' +
    'argument against installing rather than a reason it is harmless. ' +
    'THE THREE LIVE BLOCKERS ARE NO LONGER PROSE: `INSTALL_BLOCKING_FINDINGS` in ' +
    '`routes/wallet-withdrawals.ts` carries them with their sources and ' +
    '`wallet-withdrawals.test.ts` RUNS each one, so the day any of them is discharged that ' +
    'suite goes RED rather than this paragraph going quietly stale.',
};

// -----------------------------------------------------------------------------
// WHAT EACH BLOCKED PORT HOLDS BEFORE ANYTHING INSTALLS ONE (ADR-357)
// -----------------------------------------------------------------------------
// `BLOCKED` COUNTS THE PORTS `start.ts` DOES NOT CALL AND HAS NEVER COUNTED
// OBSTRUCTION. The two readings agree on thirteen of the fourteen entries and
// part on the fourteenth: `useTurnstileVerifier`'s reason opens with the word
// `NOTHING`, because its module-scope default is the real Cloudflare verifier
// and the port is live with nothing installed. So `blocked` in the triple below
// is a name for the SET, not a claim about every member of it.
//
// THE COUNT IS RIGHT AND MUST NOT MOVE, and the reason is mechanical rather
// than editorial. The first assertion below requires every declared port
// `start.ts` does not call to carry an entry here, so deleting the live one to
// report `blocked: 13` makes `unaccounted` RED. A number that cannot fall
// without disarming the gate beside it is not a number a session may lower,
// and the honest repair is therefore the vocabulary and a second measurement.
//
// THIS IS THAT SECOND MEASUREMENT. `DEFAULTS` records the initializer each
// port's module-scope variable actually carries, read off the declaring module,
// so a default that changes goes RED here instead of quietly disagreeing with
// the paragraph describing it. That is `useWithdrawalBackend`'s own stated
// remedy one entry up, applied to the property this file reports.
//
// THE CLASSIFICATION IS A RULING AND IS DELIBERATELY NOT A REGEX. A probe
// asking "does the initializer name an `UNWIRED_` value" classifies thirteen
// correctly and `useCheckoutAdapters` WRONGLY: `PRODUCTION_CHECKOUT_ADAPTERS`
// (`checkout.ts:1203`) names no such value and refuses by being EMPTY
// (`adapterFor: () => undefined`, both URLs `''`). A probe that reads the WORD
// is the failure `RI-35`'s register carries its comments about, so the input is
// measured and the judgement is written down beside it.
// -----------------------------------------------------------------------------

/**
 * The initializer each blocked port's module-scope variable carries, as text.
 *
 * Every value is read back off the tree by the assertion below, so a stale
 * entry here is a failure rather than a comment.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
  setAdminReadSource: 'null',
  setAdminSessionSource: 'null',
  setInternalOpsSource: 'null',
  useAdminPayoutBackend: 'UNWIRED_ADMIN_PAYOUT_BACKEND',
  useAdminWalletBackend: 'UNWIRED_ADMIN_WALLET_BACKEND',
  useAdminWriteBackend: 'UNWIRED_ADMIN_WRITE_BACKEND',
  useAffiliateDeps: 'productionAffiliateDeps',
  useCertificateRevokeBackend: 'UNWIRED_ADMIN_CERTIFICATE_BACKEND',
  useCheckoutAdapters: 'PRODUCTION_CHECKOUT_ADAPTERS',
  useCheckoutBackend: 'UNWIRED_CHECKOUT_BACKEND',
  useKycDeps: 'productionKycDeps',
  usePayoutBackend: 'UNWIRED_PAYOUT_BACKEND',
  useTurnstileVerifier: 'cloudflareTurnstileVerifier()',
  useWithdrawalBackend: 'UNWIRED_WITHDRAWAL_BACKEND',
};

/**
 * The blocked ports whose default SERVES A REQUEST rather than refusing one.
 *
 * ONE, AND IT IS A RULING RATHER THAN A DERIVATION (ADR-357).
 * `cloudflareTurnstileVerifier()` reads `MERIT_TURNSTILE_SECRET` from
 * `process.env` PER CALL (`turnstile.ts:211`) and calls Cloudflare, so a
 * deployment holding the secret verifies tokens with nothing installed. The
 * other thirteen refuse in three shapes: `null` (three), an `UNWIRED_*`
 * stand-in (seven), and a `production*` value that resolves nothing (three).
 *
 * AN ABSENT SECRET IS A REFUSAL AND NOT AN UNWIRED STATE. The default answers
 * `unconfigured` and `POST /auth/otp` serves that as 503 (ADR-226), so there is
 * no configuration under which this port admits an unverified token, which is
 * why it is counted live here and still carries a reason above.
 *
 * THIS CONSTANT WAS `LIVE_DEFAULT` AND IT IS NO LONGER THE SOURCE (ADR-363).
 * IT IS KEPT HERE UNDER `RI-14`, BECAUSE WHAT IT SAYS IS STILL TRUE AND ONLY
 * ITS AUTHORITY HAS CHANGED. It was the ANSWER, hand-written, and nothing read
 * the tree back to check it: `defaultOf` resolves a default EXACTLY ONE HOP and
 * returns the initializer AS TEXT, so three of the thirteen were recorded as
 * refusing on the strength of a NAME beginning `production` while their
 * contents went unread. All three do refuse today, which is what made this
 * dangerous rather than harmless: the day one of them held a real backend,
 * `defaultOf` would still return the same string, `DEFAULTS` would still match,
 * this line would still say one, and `refusing: 13` would become a lie with
 * every gate green.
 *
 * `LIVE_DEFAULT` BELOW IS DERIVED BY `resolveDefault`, AND THE ASSERTION
 * COMPARES THE TWO. So this line is now a PIN that must move when the tree
 * moves, rather than the thing the tree is trusted against.
 */
const LIVE_DEFAULT_DECLARED: ReadonlySet<string> = new Set(['useTurnstileVerifier']);

// -----------------------------------------------------------------------------
// The assertions
// -----------------------------------------------------------------------------

test('every backend port a route module declares is either wired or blocked with a reason', () => {
  // THE REGRESSION THIS FILE EXISTS FOR. A route slice that declares a port and
  // a wiring slice that never installs it produce a deployment answering 503 on
  // every one of that module's routes, with a green suite and a clean typecheck.
  const unaccounted = [...declaredIn.keys()]
    .filter((port) => !wired.has(port) && !(port in BLOCKED))
    .sort();

  expect(unaccounted).toStrictEqual([]);
});

test('no blocked port is also wired, so the list shrinks when a door lands', () => {
  // A stale excuse beside a live line is how a reason outlives the obstruction
  // it describes.
  const stale = Object.keys(BLOCKED)
    .filter((port) => wired.has(port))
    .sort();

  expect(stale).toStrictEqual([]);
});

test('every blocked port still exists, so a rename cannot leave a reason pointing at nothing', () => {
  const orphaned = Object.keys(BLOCKED)
    .filter((port) => !declaredIn.has(port))
    .sort();

  expect(orphaned).toStrictEqual([]);
});

test('every blocked port names a specific obstruction rather than saying it is not wired', () => {
  // "not wired yet" retires the question. A reason a reader can check at a file
  // and a line is what makes the entry a liability that expires.
  for (const [port, reason] of Object.entries(BLOCKED)) {
    expect(reason.length, `${port} has too short a reason to be checkable`).toBeGreaterThan(80);
    expect(reason, `${port}'s reason says only that it is unwired`).not.toMatch(
      /^(it is )?not wired/i,
    );
  }
});

test('every setter start.ts calls is a port some route module declares', () => {
  // The other direction, which catches a call left behind by a rename: it would
  // not compile, but it would also not be noticed here if this file only read
  // one way.
  const unknown = [...wired].filter((port) => !declaredIn.has(port)).sort();

  expect(unknown).toStrictEqual([]);
});

test('every database adapter written in this deployable is installed or accounted for', () => {
  // THE SECOND HALF OF THE SAME DEFECT, AND THE ONE THAT ACTUALLY HAPPENED.
  // `databaseWalletBackend` sat beside its port, fully written and fully tested,
  // and `start.ts` never named it. An adapter nobody installs is indistinguishable
  // from an adapter nobody wrote, from the outside of a running process.
  const factories = new Set<string>();
  for (const dir of [SRC, ROUTES])
    for (const name of tsFiles(dir))
      for (const factory of matches(read(join(dir, name)), FACTORIES)) factories.add(factory);

  // An adapter whose PORT is blocked is accounted for by that port's entry.
  const accountedByPort = new Set([
    'databaseIdempotencyStore',
    // `useWithdrawalBackend` is blocked, and its own entry above carries the
    // reason, so its adapter is accounted for by it.
    //
    // THE REASON WORDED HERE WAS THE REFUTED ONE, "an absent `IdempotencyStore`",
    // AND IT SURVIVED IN THIS COMMENT AFTER THE ENTRY ABOVE WAS CORRECTED. That
    // is the same defect ADR-172 found in this file twice already, in a third
    // place: a claim restated somewhere nothing reads it for agreement. The
    // reason lives in `BLOCKED` and this comment now points at it instead of
    // paraphrasing it, because a paraphrase is what drifts.
    'databaseWithdrawalBackend',
  ]);
  const orphaned = [...factories]
    .filter((factory) => !startSource.includes(`${factory}(`) && !accountedByPort.has(factory))
    .sort();

  expect(orphaned).toStrictEqual([]);
});

test('the wired count is reported, so a regression is a number and not a paragraph', () => {
  // The measurement this file was written to keep honest. It is an assertion
  // rather than a log line because a log line nobody reads is not a control.
  //
  // THE NUMBERS MOVED BY ONE AND ONE ON 2026-09-05 AND NEITHER MOVE IS A
  // WIDENING. ADR-347 declared `useCertificateRateLimiter` in
  // `src/certificate-rate-limit.ts` and installed it in `start.ts`, so `declared`
  // is 25 and `wired` is 11; `blocked` does not move, because nothing was
  // excused. The scan that found it also stopped matching `userAgentFamily`,
  // which the widened directory list would otherwise have added as a
  // twenty-sixth: see `DECLARES` above for the measurement that made the
  // narrowing safe.
  expect({
    declared: declaredIn.size,
    wired: [...wired].filter((port) => declaredIn.has(port)).length,
    blocked: Object.keys(BLOCKED).length,
  }).toStrictEqual({ declared: 25, wired: 11, blocked: 14 });
});

// -----------------------------------------------------------------------------
// The second measurement: what the blocked ports hold (ADR-357)
// -----------------------------------------------------------------------------

/** The path of the module declaring `port`, from `declaredIn`'s own labels. */
function moduleOf(port: string): string {
  const where = declaredIn.get(port) ?? '';
  return where.startsWith('../') ? join(SRC, where.slice(3)) : join(ROUTES, where);
}

/**
 * The initializer of the module-scope variable `port`'s setter assigns to.
 *
 * Reads the declaring module AS TEXT, for this file's own stated reason:
 * importing it would bind a port. The setter names its target in its body, and
 * the target is declared once at module scope.
 */
function defaultOf(port: string): string {
  const lines = read(moduleOf(port)).split('\n');
  const at = lines.findIndex((line) => line.startsWith(`export function ${port}(`));
  const target = lines
    .slice(at + 1, at + 8)
    .map((line) => /^\s*([A-Za-z_$][\w$]*) = /.exec(line)?.[1])
    .find((name) => name !== undefined);
  if (target === undefined) return '<no assignment in the setter body>';
  const decl = lines.find((line) => new RegExp(`^let ${target}\\b`).test(line));
  return /=\s*(.+);\s*$/.exec(decl ?? '')?.[1] ?? '<no module-scope binding>';
}

// -----------------------------------------------------------------------------
// THE DERIVATION: WHAT A DEFAULT HOLDS PAST THE FIRST HOP (ADR-363)
// -----------------------------------------------------------------------------
// `defaultOf` above resolves a default EXACTLY ONE HOP. It reads the setter's
// target, finds that target's module-scope binding, and returns the
// initializer AS TEXT. So `useAffiliateDeps` records the STRING
// `productionAffiliateDeps` and nothing ever opened it, and three of the
// fourteen record a default whose name begins `production` while its contents
// decide whether it refuses.
//
// TODAY ALL THREE DO REFUSE, AND THAT IS WHAT MADE THE HAND-WRITTEN ANSWER
// DANGEROUS RATHER THAN HARMLESS. The day somebody gives
// `productionAffiliateDeps` (`routes/affiliate.ts:672`) a real backend,
// `defaultOf` still returns the same string, `DEFAULTS` still matches,
// `LIVE_DEFAULT_DECLARED` still says one, and `refusing: 13` becomes a lie
// with every gate in this repository green. That is the class this repo
// already has a name for: a check that goes green on a commented-out control.
//
// SO THE ANSWER IS DERIVED HERE INSTEAD, BY FOLLOWING THE CHAIN. An identifier
// naming another module-scope binding is followed to ITS initializer; an
// object literal is descended into member by member; a call is followed into
// the factory it names, across a relative import when the factory lives in a
// sibling module. The walk stops at leaves, and the leaves are classified.
//
// THE GRAMMAR IS ASYMMETRIC AND THE ASYMMETRY IS THE WHOLE CONTROL.
// `refuses` must be PROVEN, out of a closed list of forms written below.
// Everything that parses and is not a proven refusal is `unproven`, and
// everything that does not parse at all is `unresolved`. NEITHER OF THOSE EVER
// BECOMES A REFUSAL BY DEFAULT, which is the property that matters: a resolver
// that silently gave up would be indistinguishable from one that proved a
// refusal, and the number would go green on the give-up.
//
// IT DOES NOT READ THE WORD `UNWIRED_`, DELIBERATELY. ADR-357 wrote that probe,
// ran it, and refused it on its own result: it classifies thirteen correctly
// and `PRODUCTION_CHECKOUT_ADAPTERS` (`routes/checkout.ts:1203`) WRONGLY,
// because that value names no `UNWIRED_` member and refuses by being empty.
// The walk below proves all four of its members refuse without ever reading a
// name, and it would equally catch an `UNWIRED_`-named value that had stopped
// refusing. A probe that reads the WORD is the failure `RI-35`'s register
// carries its comments about.
//
// THE MODULES ARE READ AS TEXT, which is this file's own standing reason:
// importing one would bind a port.

/** What resolving a default proved about it. */
type Verdict = 'refuses' | 'unproven' | 'unresolved';

interface Resolution {
  /** `refuses` is proven. `unproven` parsed and is not a refusal. `unresolved` did not parse. */
  readonly verdict: Verdict;
  /** What was proved, or the shape the walk stopped on. Carried into the failure message. */
  readonly why: string;
}

const refuses = (why: string): Resolution => ({ verdict: 'refuses', why });
const unproven = (why: string): Resolution => ({ verdict: 'unproven', why });
const unresolved = (why: string): Resolution => ({ verdict: 'unresolved', why });

/** The index of the closing quote of the string literal opening at `at`. */
function endOfString(text: string, at: number): number {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length;
}

/**
 * The first character of `stop` at bracket depth zero from `from`, or the
 * closer that ends the enclosing bracket run, whichever comes first.
 *
 * STRINGS AND COMMENTS ARE SKIPPED. Every reason in this deployable is a long
 * string full of `;`, `,`, `(` and `{`, so a scanner that did not skip them
 * would end a statement inside a sentence.
 */
function scanTop(text: string, from: number, stop: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (ch === "'" || ch === '"' || ch === '`') {
      i = endOfString(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl < 0) return text.length;
      i = nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i);
      if (close < 0) return text.length;
      i = close + 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth -= 1;
      continue;
    }
    if (depth === 0 && stop.includes(ch)) return i;
  }
  return text.length;
}

/** The index just past the bracket run opening at `open`. */
function pastBracket(text: string, open: number): number {
  return scanTop(text, open + 1, '') + 1;
}

/** The initializer text of the module-scope `const` or `let` named `name`. */
function bindingInit(source: string, name: string): string | undefined {
  const declared = new RegExp(`^(?:export )?(?:const|let) ${name}\\b`, 'm').exec(source);
  if (declared === null) return undefined;
  const eq = scanTop(source, declared.index + declared[0].length, '=');
  if (source[eq] !== '=') return undefined;
  return source.slice(eq + 1, scanTop(source, eq + 1, ';')).trim();
}

/**
 * The expression a module-scope `function name(...)` returns.
 *
 * The `return` is taken at the function body's OWN depth, so the many inner
 * returns of a real adapter are not mistaken for the factory's.
 */
function factoryReturn(source: string, name: string): string | undefined {
  const declared = new RegExp(`^(?:export )?function ${name}\\(`, 'm').exec(source);
  if (declared === null) return undefined;
  const brace = source.indexOf('{', pastBracket(source, declared.index + declared[0].length - 1));
  if (brace < 0) return undefined;
  let depth = 1;
  for (let i = brace + 1; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (ch === "'" || ch === '"' || ch === '`') {
      i = endOfString(source, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return undefined;
      continue;
    }
    if (depth === 1 && source.startsWith('return ', i) && !/[\w$]/.test(source[i - 1] ?? ' '))
      return source.slice(i + 7, scanTop(source, i + 7, ';')).trim();
  }
  return undefined;
}

/** The specifier a named import of `name` comes from, if this module imports it. */
function importedFrom(source: string, name: string): string | undefined {
  for (const line of source.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)';/gm)) {
    const names = (line[1] ?? '').split(',').map(
      (entry) =>
        entry
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim() ?? '',
    );
    if (names.includes(name)) return line[2];
  }
  return undefined;
}

/**
 * The top-level members of an object literal, as `[key, value text]`.
 *
 * `undefined` when the literal holds a shape this reader does not split, which
 * becomes `unresolved` at the call site rather than an empty member list. An
 * empty member list would report "all 0 members refuse", which is the silent
 * give-up this whole block exists to make impossible.
 */
function objectMembers(text: string): readonly (readonly [string, string])[] | undefined {
  if (!text.startsWith('{')) return undefined;
  const inner = text.slice(1, text.lastIndexOf('}'));
  const members: (readonly [string, string])[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i] ?? '')) i += 1;
    if (i >= inner.length) break;
    if (inner.startsWith('//', i)) {
      const nl = inner.indexOf('\n', i);
      i = nl < 0 ? inner.length : nl;
      continue;
    }
    if (inner.startsWith('/*', i)) {
      const close = inner.indexOf('*/', i);
      i = close < 0 ? inner.length : close + 2;
      continue;
    }
    const start = i;
    const key = /^(?:(?:async|get|set)\s+)?([A-Za-z_$][\w$]*)/.exec(inner.slice(i));
    if (key === null) return undefined;
    i += key[0].length;
    while (i < inner.length && /\s/.test(inner[i] ?? '')) i += 1;
    if (inner[i] === ':') {
      const end = scanTop(inner, i + 1, ',');
      members.push([key[1] ?? '', inner.slice(i + 1, end).trim()]);
      i = end;
    } else if (inner[i] === '(') {
      const brace = inner.indexOf('{', pastBracket(inner, i));
      if (brace < 0) return undefined;
      const end = pastBracket(inner, brace);
      members.push([key[1] ?? '', inner.slice(start, end).trim()]);
      i = end;
    } else if (i >= inner.length || inner[i] === ',') {
      members.push([key[1] ?? '', key[1] ?? '']);
    } else return undefined;
  }
  return members;
}

/**
 * A function leaf, classified on its BODY.
 *
 * THE CLOSED LIST OF REFUSALS IS HERE AND IT IS FOUR FORMS: a body that
 * throws, a body that returns a rejection, a body that returns nothing, and
 * nothing else. A body that does anything else RETURNS SOMETHING TO THE
 * HANDLER, and this file will not call that a refusal on its own authority.
 */
function classifyBody(body: string): Resolution {
  const text = body.trim();
  if (text.startsWith('{')) {
    const inner = text.slice(1, text.lastIndexOf('}')).trim();
    const first = scanTop(inner, 0, ';');
    const only = inner.slice(0, first).trim();
    if (inner.slice(first + 1).trim() !== '')
      return unproven(`a block body of more than one statement: ${only.slice(0, 50)}`);
    if (/^throw\b/.test(only)) return refuses('throws and does nothing else');
    if (/^return Promise\.reject\(/.test(only)) return refuses('rejects and does nothing else');
    if (only === 'return' || only === 'return undefined') return refuses('returns nothing');
    return unproven(`a body that is not a refusal: ${only.slice(0, 50)}`);
  }
  if (text === 'undefined') return refuses('returns nothing');
  if (/^Promise\.reject\(/.test(text)) return refuses('returns a rejection');
  return unproven(`a body that is not a refusal: ${text.slice(0, 50)}`);
}

/**
 * What `expression`, read in `modulePath`, resolves to.
 *
 * `seen` breaks a binding cycle rather than recursing to a stack overflow, and
 * a cycle is `unresolved` because a value defined in terms of itself is not a
 * proven refusal.
 */
function resolveExpression(
  expression: string,
  modulePath: string,
  seen: ReadonlySet<string>,
): Resolution {
  const text = expression.trim();

  if (text === 'null' || text === 'undefined') return refuses('holds nothing');
  if (text === "''" || text === '""' || text === '``') return refuses('holds no value');

  // An arrow function, with or without a return-type annotation.
  if (/^(?:async\s+)?\(/.test(text)) {
    const after = text
      .slice(pastBracket(text, text.indexOf('(')))
      .trim()
      .replace(/^:[^=]*/, '')
      .trim();
    if (after.startsWith('=>')) return classifyBody(after.slice(2));
  }

  // A method shorthand, or a call. Both open with a name and a paren, and what
  // follows the parameters tells them apart: a method has a body.
  if (/^(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(text)) {
    const after = text.slice(pastBracket(text, text.indexOf('('))).trim();
    if (after.startsWith('{')) return classifyBody(after);
    if (/^:[^{]*\{/.test(after)) return classifyBody(after.slice(after.indexOf('{')));
    if (after !== '') return unresolved(`a call with trailing syntax: ${text.slice(0, 60)}`);
    return followName(/^([A-Za-z_$][\w$]*)/.exec(text)?.[1] ?? '', modulePath, seen, factoryReturn);
  }

  if (text.startsWith('{')) {
    const members = objectMembers(text);
    if (members === undefined)
      return unresolved(`an object literal this reader cannot split: ${text.slice(0, 60)}`);
    const walked = members.map(
      ([key, value]) => [key, resolveExpression(value, modulePath, seen)] as const,
    );
    const stuck = walked.find(([, member]) => member.verdict === 'unresolved');
    if (stuck !== undefined) return unresolved(`member \`${stuck[0]}\` is ${stuck[1].why}`);
    const live = walked.find(([, member]) => member.verdict === 'unproven');
    if (live !== undefined) return unproven(`member \`${live[0]}\` has ${live[1].why}`);
    return refuses(`all ${String(walked.length)} members refuse`);
  }

  if (/^[A-Za-z_$][\w$]*$/.test(text)) return followName(text, modulePath, seen, bindingInit);

  return unresolved(`an expression shape this reader does not know: ${text.slice(0, 60)}`);
}

/**
 * Follow `name` to what `take` reads out of its declaring module, here or one
 * relative import away, and resolve THAT.
 *
 * THE REACH STOPS AT `apps/api/src` ON PURPOSE. A default reaching a package is
 * a default this file cannot read as text, and it must say so rather than
 * assume anything about it.
 */
function followName(
  name: string,
  modulePath: string,
  seen: ReadonlySet<string>,
  take: (source: string, of: string) => string | undefined,
): Resolution {
  const key = `${modulePath}#${name}`;
  if (seen.has(key)) return unresolved(`\`${name}\` is defined in terms of itself`);
  const next = new Set([...seen, key]);

  const here = take(read(modulePath), name);
  if (here !== undefined) return resolveExpression(here, modulePath, next);

  const specifier = importedFrom(read(modulePath), name);
  if (specifier === undefined || !specifier.startsWith('.'))
    return unresolved(`\`${name}\`, which this module neither declares nor imports relatively`);
  const target = join(dirname(modulePath), specifier);
  if (!target.startsWith(SRC))
    return unresolved(`\`${name}\`, imported from ${specifier}, outside apps/api/src`);
  const there = take(read(target), name);
  if (there === undefined)
    return unresolved(`\`${name}\`, imported from ${specifier}, which declares no such value`);
  return resolveExpression(there, target, next);
}

/** What `port`'s module-scope default resolves to, followed past the first hop. */
function resolveDefault(port: string): Resolution {
  return resolveExpression(defaultOf(port), moduleOf(port), new Set());
}

/**
 * The ruling for each default that is NOT a proven refusal, and why.
 *
 * TWO, AND BOTH ARE IRREDUCIBLE JUDGEMENTS RATHER THAN GAPS IN THE WALK. The
 * assertion below requires this record to hold EXACTLY the ports the
 * derivation reports as `unproven`, in both directions, so a default that
 * stops being a proven refusal cannot reach `refusing` without somebody
 * writing a sentence here, and a ruling cannot outlive the shape it ruled on.
 *
 * THIS IS THE HAND-MAINTAINED PART AND IT IS SMALLER AND LOUDER THAN WHAT IT
 * REPLACED. `LIVE_DEFAULT_DECLARED` was the ANSWER, unchecked against anything.
 * These are INPUTS to an answer that is now computed, and each one is enforced
 * for presence and for necessity.
 */
const UNPROVEN_RULING: Readonly<
  Record<string, { readonly verdict: 'live' | 'refuses'; readonly why: string }>
> = {
  useTurnstileVerifier: {
    verdict: 'live',
    why:
      'ADR-357, and the derivation reaches the same leaf its ruling rests on. `cloudflareTurnstileVerifier` ' +
      'at `turnstile.ts:211` returns an object whose `verify` is a real vendor call: it reads ' +
      '`MERIT_TURNSTILE_SECRET` from the environment PER CALL, posts to siteverify under a timeout, and ' +
      'answers on what comes back. A deployment holding the secret verifies tokens with nothing installed, ' +
      'so this default SERVES. An absent secret is a refusal rather than an unwired state, which is why ' +
      'the port is counted live here and still carries a reason above.',
  },
  useWithdrawalBackend: {
    verdict: 'refuses',
    why:
      'THE DERIVATION FOUND A LEAF ADR-357 DID NOT, AND THE RULING IS THAT THE PORT STILL REFUSES. ' +
      '`UNWIRED_WITHDRAWAL_BACKEND` refuses on `transact` and on all three members of its idempotency ' +
      'store, and its `now` at `wallet-withdrawals.ts:1128` is `() => new Date()`, a working clock rather ' +
      'than a refusal, and the FOUR sibling defaults that carry a `now` all throw from it instead. It reaches no caller, and ' +
      'that is measured at both doors rather than argued: the creation door reads the clock at ' +
      '`wallet-withdrawals.ts:2468` and the very next statement rejects, because `begin` at ' +
      '`wallet-withdrawals.ts:1112` refuses, and `unwiredOrThrow` at `wallet-withdrawals.ts:2381` answers ' +
      '503; the cancellation door reads it at `wallet-withdrawals.ts:2604` and `transact` refuses at ' +
      '`wallet-withdrawals.ts:2621` into that same refusal handler. A timestamp ' +
      'computed and discarded is not a request served, so this port belongs among the thirteen.',
  },
};

/**
 * The blocked ports whose default SERVES a request rather than refusing one,
 * DERIVED rather than declared.
 *
 * Every port the walk proves refusing is out. Of the rest, the ones this file
 * has ruled live are in. Nothing here is a literal.
 */
const LIVE_DEFAULT: ReadonlySet<string> = new Set(
  Object.keys(BLOCKED).filter(
    (port) =>
      resolveDefault(port).verdict === 'unproven' && UNPROVEN_RULING[port]?.verdict === 'live',
  ),
);

test('every blocked port records the module-scope default it actually holds', () => {
  // ADR-357. The INPUT to the ruling below, measured rather than described, so
  // a default that changes cannot leave the ruling standing beside it. This is
  // the check whose absence let a port be live and counted as blocked for four
  // waves while every gate stayed green.
  const measured = Object.fromEntries(Object.keys(BLOCKED).map((port) => [port, defaultOf(port)]));

  expect(measured).toStrictEqual(DEFAULTS);
});

test('the recorded defaults cover the blocked list exactly', () => {
  // A port leaving `BLOCKED` must leave `DEFAULTS` with it. The day a wiring
  // slice installs one of the fourteen this fails until both move, which is
  // the conflict being VISIBLE rather than silent.
  expect(Object.keys(DEFAULTS).sort()).toStrictEqual(Object.keys(BLOCKED).sort());
});

test('exactly one blocked port is live with nothing installed, and it is named', () => {
  // ADR-357's ruling, as a number. `blocked` counts what `start.ts` does not
  // call; `refusing` counts what a request actually meets. THE TWO DIFFER BY
  // ONE AND THE ONE IS WRITTEN DOWN, which is the whole finding: a reader who
  // takes `blocked: 14` for fourteen obstructions is wrong by exactly this.
  expect([...LIVE_DEFAULT].sort()).toStrictEqual(['useTurnstileVerifier']);

  // THE DERIVATION AND THE RETIRED HAND-WRITTEN FORM AGREE (ADR-363). The set
  // above is now computed from the tree, and the literal it replaced is kept
  // beside it as a pin rather than as the source.
  expect([...LIVE_DEFAULT].sort()).toStrictEqual([...LIVE_DEFAULT_DECLARED].sort());

  // A live port with no entry would be unaccounted; a named one that is not
  // blocked would be a reason pointing at nothing.
  expect([...LIVE_DEFAULT].filter((port) => !(port in BLOCKED))).toStrictEqual([]);

  expect({
    blocked: Object.keys(BLOCKED).length,
    refusing: Object.keys(BLOCKED).filter((port) => !LIVE_DEFAULT.has(port)).length,
    live: LIVE_DEFAULT.size,
  }).toStrictEqual({ blocked: 14, refusing: 13, live: 1 });
});

test('every blocked default resolves to a shape this file can read', () => {
  // ADR-363. A RESOLVER THAT SILENTLY GIVES UP IS WORSE THAN NO RESOLVER,
  // because the give-up is indistinguishable from a proven refusal and the
  // count goes green on it. Anything the grammar does not read is `unresolved`,
  // and `unresolved` fails HERE, naming the port and the text it stopped on.
  const unread = Object.keys(BLOCKED)
    .map((port) => [port, resolveDefault(port)] as const)
    .filter(([, resolution]) => resolution.verdict === 'unresolved')
    .map(([port, resolution]) => `${port}: ${resolution.why}`)
    .sort();

  expect(unread).toStrictEqual([]);
});

test('a default shape the resolver cannot read fails rather than passing as a refusal', () => {
  // THE FAILURE MODE ABOVE, DRIVEN DIRECTLY. A control whose failure mode is
  // never exercised is a control nobody has watched, and this is the one that
  // decides whether the count can go green on something nobody read.
  const module = moduleOf('useTurnstileVerifier');
  for (const shape of [
    'deploymentConfig.checkout',
    'resolveAdapters() ?? PRODUCTION_FALLBACK',
    '{ ...PRODUCTION_CHECKOUT_ADAPTERS }',
    'noSuchBindingAnywhere',
    '[UNWIRED_CHECKOUT_BACKEND]',
    '42',
  ])
    expect(resolveExpression(shape, module, new Set()).verdict, shape).toBe('unresolved');

  // AND IT IS NOT THE `unresolved` BRANCH SWALLOWING EVERYTHING, which would
  // make the case above pass over a resolver that reads nothing at all.
  expect(resolveExpression('null', module, new Set()).verdict).toBe('refuses');
  expect(resolveExpression('() => Promise.reject(new Error())', module, new Set()).verdict).toBe(
    'refuses',
  );
  expect(resolveExpression('() => new Date()', module, new Set()).verdict).toBe('unproven');
});

test('the derivation follows a default past its first hop rather than stopping at the name', () => {
  // THE DEFECT ADR-363 WAS DISPATCHED ON, ASSERTED. `defaultOf` returns the
  // STRING `productionAffiliateDeps`, and three of the fourteen record a name
  // beginning `production` whose CONTENTS decide whether they refuse. These
  // three are proven refusing by their leaves, so a later edit to any of them
  // moves this file rather than passing under it.
  for (const port of ['useAffiliateDeps', 'useKycDeps', 'useCheckoutAdapters']) {
    expect(defaultOf(port), `${port} still records a name rather than a value`).toMatch(
      /^(production|PRODUCTION)/,
    );
    expect(resolveDefault(port).verdict, `${port}`).toBe('refuses');
  }

  // AND THE WALK IS NOT READING THE WORD `UNWIRED_`, WHICH IS THE PROBE ADR-357
  // WROTE AND REFUSED ON ITS OWN RESULT. `PRODUCTION_CHECKOUT_ADAPTERS` names
  // no such value and refuses by being EMPTY, and it is proven from its four
  // leaves; `UNWIRED_WITHDRAWAL_BACKEND` carries the word and is NOT proven,
  // because one of its members is a working clock.
  expect(resolveDefault('useCheckoutAdapters').why).toBe('all 4 members refuse');
  expect(resolveDefault('useWithdrawalBackend').verdict).toBe('unproven');
});

test('every default that is not a proven refusal carries a ruling, and no ruling outlives its shape', () => {
  // BOTH DIRECTIONS, WHICH IS WHAT MAKES THE HAND-MAINTAINED HALF SAFE. A
  // default that stops being a proven refusal cannot reach `refusing` until
  // somebody writes the sentence, and a ruling cannot survive the shape that
  // needed it.
  const unprovenPorts = Object.keys(BLOCKED)
    .filter((port) => resolveDefault(port).verdict === 'unproven')
    .sort();

  expect(unprovenPorts).toStrictEqual(Object.keys(UNPROVEN_RULING).sort());

  for (const [port, ruling] of Object.entries(UNPROVEN_RULING))
    expect(ruling.why.length, `${port}'s ruling is too short to be checkable`).toBeGreaterThan(80);
});

// -----------------------------------------------------------------------------
// The third measurement: the counts this file writes in PROSE, derived (ADR-367)
// -----------------------------------------------------------------------------
//
// THIS IS THE THIRD WAVE IN A ROW REPAIRING A HAND-MAINTAINED NUMBER IN THIS ONE
// FILE, AND THE PATTERN IS THE FINDING. ADR-357 built `DEFAULTS` off the tree and
// set an ANSWER beside it that read back off nothing. ADR-363 derived that answer
// and left `UNPROVEN_RULING` hand-maintained on purpose, with a both-directions
// assertion around it. This wave opened holding THREE stale figures that three
// rows had found and none was allowed to repair, and every one of the three was a
// count spelled into a string.
//
// A COUNT SPELLED INTO A STRING IS ASSERTED BY NOBODY, and two of these three sat
// in the same tree as a live derivation of the very set they miscounted. The SSO
// figures read SIX and FIVE while `test/admin-read-constructibility.test.ts`
// derived EIGHT on every run, green, for eight sessions. The remedy is not a
// better proofreader.
//
// WHAT IS DERIVED HERE AND WHAT IS NOT, so nobody reads these cases as stronger
// than they are. The two SSO figures are derived from the live `BLOCKED` map by
// the same predicate that other file runs over a parse of this one. The payout
// partition is derived from the adapter's own refusal spellings and from the two
// interfaces' member lists. NO JUDGEMENT IS DERIVED: the prose still says what a
// number MEANS, and these cases only refuse to let it say a different number than
// the tree does.
//
// AND THE RETIREMENT CONVENTION IS LOAD BEARING HERE RATHER THAN COSMETIC.
// `RI-14` keeps a corrected sentence beside its correction, and ADR-358 measured
// that this can collide with a prose-matching case: a repaired message that
// QUOTES its false sentence puts the retired words back exactly where a matcher
// reads them, inside the quotation of their own retirement. Every case below
// therefore requires its anchor phrase EXACTLY ONCE in the entry, so the
// collision is a RED bar naming the entry rather than a silent second answer.
// The three entries retire their figures by NAMING them instead, which is
// `usePayoutBackend`'s own precedent from four earlier retirements.

/** The cardinals these entries spell. Widen it when an entry needs a bigger one. */
const CARDINAL: Readonly<Record<string, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  ELEVEN: 11,
  TWELVE: 12,
  THIRTEEN: 13,
  FOURTEEN: 14,
  FIFTEEN: 15,
};

/**
 * The one cardinal `pattern` finds in `reason`, as a number.
 *
 * EXACTLY ONE MATCH IS REQUIRED AND THAT IS THE ADR-358 GUARD, not a convenience.
 * A second match means the entry has retired its own figure by reproducing the
 * sentence that carried it, and a matcher reading the second one would report a
 * count the entry no longer makes. Failing is the only honest answer available:
 * the file cannot tell which of two identical sentences is live.
 */
function soleCardinal(reason: string, pattern: RegExp, where: string): number {
  const hits = [...reason.matchAll(pattern)];
  expect(
    hits.length,
    `${where} must carry ${pattern.source} exactly once. Two matches means a retired ` +
      'figure was QUOTED rather than NAMED, which puts the old words back where this case ' +
      'reads them; zero means the anchor phrase was reworded and the count is unbound again',
  ).toBe(1);
  const word = hits[0]?.[1] ?? '';
  expect(
    CARDINAL[word],
    `${where} spells the cardinal "${word}", which CARDINAL above does not carry`,
  ).toBeDefined();
  return CARDINAL[word] ?? 0;
}

/** The port every entry behind the SSO purchase reduces to. */
const SSO_PORT = 'setAdminSessionSource';

/**
 * Every `BLOCKED` entry the SSO purchase blocks.
 *
 * THE PREDICATE IS `test/admin-read-constructibility.test.ts`'s, deliberately,
 * and it is run here over the LIVE map rather than over a parse of this file's
 * own text. That file derives the set and names its members; this one binds the
 * two PROSE figures to the same predicate, which is the half that was missing
 * while both figures were wrong.
 */
const behindTheSsoPurchase: readonly string[] = Object.entries(BLOCKED)
  .filter(([port, reason]) => port === SSO_PORT || reason.includes('AdminSessionSource'))
  .map(([port]) => port)
  .sort();

test('the two prose counts of the SSO purchase are derived from BLOCKED rather than typed', () => {
  // THE DEFECT THIS ENDS, STATED SO THE CASE IS NOT MISREAD AS TIDINESS.
  // `setAdminReadSource` said the purchase blocks SIX and `setAdminSessionSource`
  // said FIVE OTHER PORTS reduce to it. The tree derived EIGHT. Three sessions
  // found it, ADR-360 section 7 wrote it down, and nothing in this file could
  // have gone red, because the only reader of those two numbers was a person.
  expect(behindTheSsoPurchase).toContain(SSO_PORT);

  const blocks = soleCardinal(
    BLOCKED['setAdminReadSource'] ?? '',
    /the SSO purchase blocks ([A-Z]+) entries/g,
    "`setAdminReadSource`'s reason",
  );
  expect(
    blocks,
    `\`setAdminReadSource\` says the purchase blocks ${blocks}; the map derives ` +
      `${behindTheSsoPurchase.length}: ${behindTheSsoPurchase.join(', ')}`,
  ).toBe(behindTheSsoPurchase.length);

  // THE SECOND FIGURE IS THE FIRST ONE MINUS THE PORT ITSELF, and it is asserted
  // as that rather than as its own literal, so the two can never part.
  const others = soleCardinal(
    BLOCKED[SSO_PORT] ?? '',
    /([A-Z]+) OTHER PORTS STILL REDUCE TO THIS ONE/g,
    `\`${SSO_PORT}\`'s reason`,
  );
  expect(
    others,
    `\`${SSO_PORT}\` says ${others} other ports reduce to it; the map derives ` +
      `${behindTheSsoPurchase.length - 1} besides itself`,
  ).toBe(behindTheSsoPurchase.length - 1);
});

/**
 * The top-level member names an `export interface` declares.
 *
 * SLICED AT THE BRACES BY `scanTop` RATHER THAN MATCHED BY A LINE PATTERN, for
 * the reason that scanner exists: every interface in this deployable is mostly
 * docblock, and a line pattern would count a name out of a sentence.
 */
function interfaceMembers(source: string, name: string): readonly string[] {
  const declared = new RegExp(`^export interface ${name}\\b`, 'm').exec(source);
  if (declared === null) return [];
  const open = source.indexOf('{', declared.index);
  if (open < 0) return [];
  const body = source.slice(open + 1, scanTop(source, open + 1, ''));
  const names: string[] = [];
  for (let pos = 0; pos < body.length;) {
    const end = scanTop(body, pos, ';');
    const member = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[<(:?]/.exec(
      stripComments(body.slice(pos, end)).trim(),
    );
    if (member !== null) names.push(member[1] ?? '');
    pos = end + 1;
  }
  return names;
}

/** The interface `member` is declared as a PROPERTY of, or undefined if it is a method. */
function propertyType(source: string, iface: string, member: string): string | undefined {
  const declared = new RegExp(`^export interface ${iface}\\b`, 'm').exec(source);
  if (declared === null) return undefined;
  const open = source.indexOf('{', declared.index);
  if (open < 0) return undefined;
  const body = stripComments(source.slice(open + 1, scanTop(source, open + 1, '')));
  return new RegExp(`(?:^|\\s)readonly\\s+${member}\\s*:\\s*([A-Za-z_$][\\w$]*)`).exec(body)?.[1];
}

/** The one module under `src` or `src/routes` that declares `iface`. */
function declaringSource(iface: string): string {
  const found = [
    ...tsFiles(SRC).map((name) => join(SRC, name)),
    ...tsFiles(ROUTES).map((name) => join(ROUTES, name)),
  ].filter((path) => new RegExp(`^export interface ${iface}\\b`, 'm').test(read(path)));
  expect(found.length, `\`${iface}\` is declared in ${found.length} modules, not one`).toBe(1);
  return read(found[0] ?? '');
}

const payoutRoutes = read(join(ROUTES, 'payouts.ts'));
const payoutAdapter = read(join(SRC, 'payout-backend.ts'));

/** The EIGHT members `PayoutBackend` and `PayoutTx` carry between them. */
const PAYOUT_MEMBERS: readonly string[] = [
  ...interfaceMembers(payoutRoutes, 'PayoutTx'),
  ...interfaceMembers(payoutRoutes, 'PayoutBackend'),
];

/**
 * The names `payout-backend.ts` spells into its own refusals.
 *
 * THE ADAPTER SPELLS THE MEMBER INTO THE ERROR ON PURPOSE, "so a 503 names the
 * member a reader can go and look at" (`payout-backend.ts`'s `UNWIRED_STORE`
 * docblock). That habit is what makes this partition derivable at all, and the
 * case below asserts every occurrence was captured rather than trusting the
 * pattern, because a refusal spelled some other way would silently promote its
 * member into the answering half.
 */
const spelledRefusals: readonly string[] = matches(
  payoutAdapter,
  /new PayoutBackendUnwired\('([A-Za-z_$][\w$.]*)'\)/g,
);

/** Every refusal `payout-backend.ts` spells under `member`, as the part after its name. */
function branchesRefused(member: string): readonly string[] {
  return spelledRefusals
    .filter((name) => name === member || name.startsWith(`${member}.`))
    .map((name) => name.slice(member.length + 1));
}

/**
 * Whether `member` refuses AS A WHOLE in `postgresPayoutBackend`.
 *
 * THE DOTTED NAMES ARE TWO DIFFERENT THINGS AND TELLING THEM APART IS THE WHOLE
 * DERIVATION. `idempotency.find` names a MEMBER of the store `idempotency`
 * holds, and when the spellings cover every member of that store's interface the
 * field refuses whole. `insertPayoutRequest.hold` names a BRANCH of a method,
 * and a method with one refusing branch still answers on the other: that is
 * exactly the distinction the retired prose lost when it counted
 * `insertPayoutRequest` as answering and `subject` as rejecting.
 */
function refusesWholly(member: string): boolean {
  const tails = branchesRefused(member);
  if (tails.length === 0) return false;
  if (tails.includes('')) return true;
  const held =
    propertyType(payoutRoutes, 'PayoutBackend', member) ??
    propertyType(payoutRoutes, 'PayoutTx', member);
  if (held === undefined) return false;
  return interfaceMembers(declaringSource(held), held).every((name) => tails.includes(name));
}

test('the payout member partition is derived from the adapter rather than typed', () => {
  // ADR-361 SECTION 7. This entry read "FOUR MEMBERS OF EIGHT" and named
  // `subject` and `listPayouts` among the four that reject. Both answer today,
  // ADR-306 and ADR-308 built the first and ADR-311 the second, and the adapter's
  // own header says so. A row dispatched off that clause would have gone and
  // built two members that already exist, which is the cost that makes this the
  // clause worth deriving rather than merely correcting.

  // EVERY REFUSAL IS CAPTURED, ASSERTED RATHER THAN ASSUMED. A refusal written
  // any other way is invisible to the pattern and would promote its member into
  // the answering half without a bar going red, which is the one direction this
  // derivation must not fail in.
  expect(
    spelledRefusals.length,
    'a `new PayoutBackendUnwired(...)` in the adapter is not spelled with a literal member ' +
      'name, so this derivation cannot see it and would count that member as answering',
  ).toBe((payoutAdapter.match(/new PayoutBackendUnwired\(/g) ?? []).length);

  const refusing = PAYOUT_MEMBERS.filter(refusesWholly).sort();

  // NAMED RATHER THAN COUNTED, so a member that starts or stops refusing arrives
  // in the diff with its own name on it.
  expect(refusing).toStrictEqual(['holdFlag', 'idempotency']);

  const answers = soleCardinal(
    BLOCKED['usePayoutBackend'] ?? '',
    /THE VALUE EXISTS AND IT IS ([A-Z]+) MEMBERS OF/g,
    "`usePayoutBackend`'s reason",
  );
  const outOf = soleCardinal(
    BLOCKED['usePayoutBackend'] ?? '',
    /MEMBERS OF ([A-Z]+)\*\*/g,
    "`usePayoutBackend`'s reason",
  );
  const rejects = soleCardinal(
    BLOCKED['usePayoutBackend'] ?? '',
    /ITS OTHER ([A-Z]+) MEMBERS REJECT WITH/g,
    "`usePayoutBackend`'s reason",
  );

  expect(outOf, 'the entry states a member total the two interfaces do not carry').toBe(
    PAYOUT_MEMBERS.length,
  );
  expect(
    rejects,
    `the entry states ${rejects} refusing; the adapter refuses on ${refusing.length}`,
  ).toBe(refusing.length);
  expect(
    answers,
    `the entry states ${answers} answering; ${PAYOUT_MEMBERS.length} declared less ` +
      `${refusing.length} refusing is ${PAYOUT_MEMBERS.length - refusing.length}`,
  ).toBe(PAYOUT_MEMBERS.length - refusing.length);
});

test('no member that answers is named inside the sentence saying which members reject', () => {
  // THIS IS THE DEFECT ITSELF AND NOT THE COUNT AROUND IT. The retired clause
  // was wrong twice over: the number was four, and `subject` and `listPayouts`
  // were written into the list of names. A count binding alone would have caught
  // the first and not the second, and the second is the half a dispatch reads.
  //
  // THE SPAN IS DELIMITED BY THE ENTRY'S OWN TWO MARKERS and a missing delimiter
  // FAILS rather than widening the span to nothing, on this file's standing rule
  // that a check must not go green on a shape nobody read.
  const reason = BLOCKED['usePayoutBackend'] ?? '';
  const from = reason.indexOf('ITS OTHER');
  const to = reason.indexOf('THIS PARTITION READ');
  expect(
    from >= 0 && to > from,
    'the rejection sentence is delimited by `ITS OTHER` and the retirement marker `THIS ' +
      'PARTITION READ`. One of them was reworded, so this case can no longer find the span ' +
      'it reads. Restore a delimiter or repoint this case; do not delete it',
  ).toBe(true);

  // A MEMBER THAT REFUSES ON A BRANCH MAY BE NAMED HERE AND A MEMBER THAT
  // REFUSES NOWHERE MAY NOT, WHICH IS THE DISTINCTION THE RETIRED CLAUSE LOST.
  // `insertPayoutRequest` is named in this sentence on purpose, because the
  // sentence says in its own words that the hold branch of the member that
  // answers rejects too, and the adapter spells that branch as
  // `insertPayoutRequest.hold`. `subject` and `listPayouts` were spelled
  // NOWHERE, and that is what made naming them an error rather than a nuance.
  // THIS CASE WAS WRITTEN WITHOUT THE DISTINCTION AND ITS FIRST RUN FAILED ON
  // `insertPayoutRequest`, which is kept here rather than quietly repaired:
  // the first draft would have forced a true sentence to be deleted.
  const sentence = reason.slice(from, to);
  const unrefused = PAYOUT_MEMBERS.filter((member) => branchesRefused(member).length === 0);
  for (const member of unrefused)
    expect(
      sentence,
      `\`${member}\` refuses on no branch in the adapter and is named inside the sentence ` +
        'listing what rejects, which is exactly how this clause sent a row to build what ' +
        'already existed',
    ).not.toContain(`\`${member}\``);

  // AND THE OTHER DIRECTION, so the sentence cannot go silent instead of wrong.
  for (const member of PAYOUT_MEMBERS.filter(refusesWholly))
    expect(
      sentence,
      `\`${member}\` refuses in the adapter and the sentence listing what rejects does not name it`,
    ).toContain(`\`${member}\``);
});

// -----------------------------------------------------------------------------
// The fourth measurement: the one port two rows read opposite ways (ADR-367)
// -----------------------------------------------------------------------------
//
// TWO ROWS MEASURED `PRODUCTION_CHECKOUT_ADAPTERS` ON THE SAME DAY AND WROTE
// DOWN OPPOSITE ANSWERS, AND BOTH ARE ON THIS TREE. ADR-363 section 6 predicted
// the collision in those words and called it the mechanism working rather than
// something to avoid, because the failure mode it replaces is ADR-357 section
// 8's, documented four times over: two readings of one fact, only one defended,
// and nothing going red when they part.
//
// THEY PARTED, AND NOTHING WENT RED. That is what this case is for. The wave
// merged both entries and the tree carried no record that they disagree.
//
//   ADR-363 section 6, DERIVED: the default refuses, from four leaves and no
//   name. `adapterFor: () => undefined` returns nothing, `returnUrl: ''` and
//   `cancelUrl: ''` hold no value, `enrichment: null` holds nothing.
//
//   ADR-362 section 4, MEASURED THROUGH THE ROUTER: a funded wallet checkout
//   against this same default answers 200, records a purchase at `paid`, moves
//   the ledger and quotes `amount_cents` and `wallet_debit_cents`.
//
// BOTH ARE TRUE AND THE INFERENCE BETWEEN THEM IS WHAT IS FALSE. The grammar
// proves things about LEAF SHAPES; `LIVE_DEFAULT`'s own docblock is about ports
// "whose default SERVES a request rather than refusing one". A leaf that holds
// nothing does not make a port refuse a request when the caller GUARDS that leaf
// and carries on, and this one does: the wallet arm reads `enrichment`, finds
// `null`, skips the observation and returns before the adapter guard.
//
// AND THE SHARP FORM OF IT IS IN THE INTERFACE RATHER THAN IN THE CALLER.
// `CheckoutAdapters` DECLARES that member as admitting `null`, in the docblock's
// own words, "`null` when this deployment observes nothing". So `null` here is a
// value the contract names, not a stand-in for one it lacks, and the grammar's
// `null` rule is being applied to a member whose type invites it. That is the
// difference between this leaf and `setAdminSessionSource`'s `null`, where no
// contract names it and the port genuinely has no source.
//
// WHAT THIS CASE DOES AND DOES NOT DO. It does not move the triple and it does
// not add a member to `LIVE_DEFAULT`. Naming the category is ADR-362 section 9's
// first open question and it is the founder's: `live` makes the triple
// `{14, 12, 2}`, a third term such as `partial` makes it a quadruple, and that
// entry records `refusing` as available and NOT recommended. What this case does
// is refuse to let the two readings part quietly a second time: every input the
// disagreement rests on is pinned, so the day the grammar changes, or the leaf
// changes, or the contract stops admitting `null`, this bar goes red and names
// the question instead of silently resolving it.

/** The full type annotation of `member` on `interface iface`, as written. */
function propertyAnnotation(source: string, iface: string, member: string): string | undefined {
  const declared = new RegExp(`^export interface ${iface}\\b`, 'm').exec(source);
  if (declared === null) return undefined;
  const open = source.indexOf('{', declared.index);
  if (open < 0) return undefined;
  const body = stripComments(source.slice(open + 1, scanTop(source, open + 1, '')));
  const at = new RegExp(`(?:^|\\s)readonly\\s+${member}\\s*:`).exec(body);
  if (at === null) return undefined;
  const from = at.index + at[0].length;
  return body.slice(from, scanTop(body, from, ';')).trim();
}

test('the one port whose derived verdict and whose measured wire behaviour disagree is pinned', () => {
  const port = 'useCheckoutAdapters';

  // THE DERIVED HALF, ADR-363 SECTION 6. Pinned at the verdict and not at the
  // reason text, so a reworded `why` does not fail this and a changed grammar
  // does.
  expect(resolveDefault(port).verdict, `\`${port}\` no longer resolves as a proven refusal`).toBe(
    'refuses',
  );
  expect(LIVE_DEFAULT.has(port)).toBe(false);

  // THE LEAF THE DISAGREEMENT TURNS ON, followed off the module rather than
  // named: the port's own module-scope default, then that name's binding.
  const checkout = read(join(ROUTES, 'checkout.ts'));
  const held = defaultOf(port);
  expect(held).toBe('PRODUCTION_CHECKOUT_ADAPTERS');
  const members = objectMembers(bindingInit(checkout, held) ?? '');
  expect(
    members,
    `\`${held}\` no longer reads as an object literal this case can descend`,
  ).toBeDefined();
  expect(
    Object.fromEntries((members ?? []).map(([name, body]) => [name, body.trim()])),
  ).toStrictEqual({
    adapterFor: '() => undefined',
    returnUrl: "''",
    cancelUrl: "''",
    enrichment: 'null',
  });

  // THE CONTRACT HALF, WHICH IS THE PART THAT MAKES THIS A DEFECT IN THE
  // INFERENCE RATHER THAN A DIFFERENCE OF OPINION. The member's declared type
  // ADMITS the leaf the grammar reads as a refusal.
  const annotation = propertyAnnotation(checkout, 'CheckoutAdapters', 'enrichment');
  expect(
    annotation,
    '`CheckoutAdapters.enrichment` no longer declares a type this case can read',
  ).toBeDefined();
  expect(
    (annotation ?? '').split('|').map((part) => part.trim()),
    'the disagreement rested on `enrichment` declaring `null` as a value rather than as an ' +
      'absent one. If that is no longer true, ADR-362 section 4 and ADR-363 section 6 need ' +
      're-reading together rather than this expectation loosening',
  ).toContain('null');

  // AND THE OTHER DIRECTION: nothing here has quietly answered ADR-362 section 9
  // open question 1. The triple is asserted unmoved above and asserted unmoved
  // here, so a later row cannot resolve the disagreement by editing this case.
  expect({
    blocked: Object.keys(BLOCKED).length,
    refusing: Object.keys(BLOCKED).filter((name) => !LIVE_DEFAULT.has(name)).length,
    live: LIVE_DEFAULT.size,
  }).toStrictEqual({ blocked: 14, refusing: 13, live: 1 });
});

// =============================================================================
// THE CENSUS: EVERY BLOCKED PORT'S MEMBER SET, AND WHICH OF THOSE MEMBERS ITS
// OWN ENTRY NAMES (ADR-369)
// =============================================================================
// ADR-366 MEASURED THAT `useAdminWalletBackend` DECLARES FIVE MEMBERS WHILE ITS
// ENTRY CARRIED BLOCKERS FOR THREE, and that the member it did not name is the
// one BOTH of that module's appends travel through. The obvious question is
// whether that entry is the only one, and the answer measured here is NO: on the
// tree this case landed against, ELEVEN of the fourteen entries leave at least
// one member of their own port's interface unnamed, and the wallet entry is not
// the worst of them. `useWithdrawalBackend` names NONE of its three in eleven
// thousand characters.
//
// THE ROT MECHANISM IS ADR-358's AND IT IS NOT CARELESSNESS. Each rewrite of an
// entry repaired the clause it was dispatched about and INHERITED the rest, so
// no entry's member list has ever been re-derived as a whole. Nothing could go
// red, because the member set lives in a `src/` interface and the claim about it
// lives in a string, and no reader held both.
//
// -----------------------------------------------------------------------------
// WHAT THIS CASE DERIVES, AND THE ONE THING IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// DERIVED: the member set of every blocked port's interface, sliced at the
// braces, and which of those members the port's own entry NAMES. Both halves are
// facts about the tree and neither answers a question anybody is holding.
//
// NOT DERIVED, AND THIS IS A RULING RATHER THAN A SHORTFALL: that every entry
// MUST name every member. That is a policy about what a `BLOCKED` reason owes a
// reader, nothing in this tree has ruled it, and it is measurably WRONG for at
// least five entries. `useTurnstileVerifier` is live and waits on nothing, so it
// has no member-level blocker to state; `useAffiliateDeps`, `useKycDeps` and
// `useCheckoutAdapters` are blocked at the PORT level, because calling their
// setter would install what is already installed. Demanding a member-by-member
// accounting from those would be this file legislating rather than measuring.
// THAT IS ADR-367 SECTION 5's REASON RECURRING and it is why the gap below is
// PINNED rather than required to be empty: the pin makes the census loud and
// leaves the ruling to the founder, which is the strongest thing available
// inside a fence that does not reach the ruling.
//
// -----------------------------------------------------------------------------
// WHAT "NAMES" MEANS, MECHANICALLY, AND WHY IT IS THIS AND NOT SOMETHING BETTER
// -----------------------------------------------------------------------------
// A member is NAMED when the entry contains a BACKTICK IMMEDIATELY FOLLOWED BY
// the member's name, ending at a character that neither continues an identifier
// nor continues a path. Three measured reasons, each for one clause of it:
//
//   1. THE BACKTICK IS REQUIRED because these members are ordinary English
//      words. `now`, `operator`, `backend`, `provider`, `verify` and `transact`
//      are all member names AND all appear in these entries as prose. Without
//      the backtick, "a trader can now take that request back" names `now`.
//
//   2. THE BACKTICKS ARE NOT PAIRED INTO SPANS, which is the opposite of the
//      obvious implementation and is forced by this file. It uses a lone
//      backtick as an APOSTROPHE, so `usePayoutBackend` and
//      `useWithdrawalBackend` carry an ODD number of backticks and every
//      span-pairing reader desynchronises at the first one. That is the same
//      hazard `RI-15` met at `wiring.test.ts:215` and it is met here the same
//      way, by reading the backtick immediately before the name rather than by
//      pairing from the start.
//
//   3. THE TRAILING CHARACTER MAY NOT CONTINUE AN IDENTIFIER OR A PATH, so that
//      a member name that is a PREFIX of a longer backticked token, as `operator`
//      is of `operator-console`, is not counted as the member.
//
//      THIS CLAUSE IS DEFENSIVE AND IT IS INERT ON THIS TREE, WHICH IS SAID HERE
//      RATHER THAN LEFT FOR A READER TO ASSUME. A seed removing it left all
//      twenty-three cases GREEN. The first draft of this block claimed the clause
//      is what refuses `packages/enrichment` and `systemDb(operator-console)`, and
//      that claim was FALSE: in both of those the backtick sits before `packages`
//      and before `systemDb`, so clause 1 refuses them and clause 3 never runs.
//      The fixture below now carries a case that DISCRIMINATES, so the clause is
//      held by something rather than only believed. Clauses 1 and 2 are the
//      load-bearing pair, each measured by its own seed.
//
// TWO STRONGER DEFINITIONS WERE MEASURED AND BOTH ARE WORSE, WHICH IS WHY THIS
// ONE IS HERE RATHER THAN ASSERTED AS THE ONLY OPTION.
//
//   "NAMED AT ITS OWN DECLARATION LINE", meaning the entry cites `file:line` and
//   the line is where the member is declared, would count FIVE of the forty-five
//   members. It is not this file's convention and requiring it would invent one.
//
//   "NAMED WITHIN TWO HUNDRED CHARACTERS OF AN `ADR-nnn` OR A `file:line`" would
//   count nineteen where naming counts twenty-three, and the four it drops are
//   real accountings: `useCheckoutAdapters` says `returnUrl` and `cancelUrl` are
//   CONFIGURATION it waits on, and `setAdminReadSource` says
//   `adminReadSourceParts` supplies `exportEvidence`. A definition that discards
//   a true accounting to look stricter is a worse definition.
//
// SO NAMING IS THE NECESSARY HALF OF ACCOUNTING AND NOT THE SUFFICIENT HALF, and
// this file says so rather than pretending otherwise. Whether an entry that
// names a member also says what BLOCKS it cannot be derived without a list of
// blocker verbs, and a word list is a judgement wearing a derivation's clothes
// (ADR-367 section 10's own confession about its dotted-name rule). WHAT THE PIN
// BUYS INSTEAD IS THAT A BARE NAME IS NOT FREE: an entry that names a member it
// does not account for SHRINKS THE GAP and turns this case RED with the member's
// own name in the message, so the name has to be defended or removed. A census
// that went green on a bare mention would be worthless, and this one does not.

/** The interface a port's setter installs, read off the setter's own parameter. */
function portInterface(port: string): string | undefined {
  for (const [dir] of [[ROUTES], [SRC]] as const)
    for (const name of tsFiles(dir)) {
      const hit = new RegExp(
        `^export function ${port}\\(\\s*[A-Za-z_$][\\w$]*\\s*:\\s*([A-Za-z_$][\\w$]*)`,
        'm',
      ).exec(read(join(dir, name)));
      if (hit !== null) return hit[1];
    }
  return undefined;
}

/**
 * Whether `reason` NAMES `member`, on the rule the block above defends.
 *
 * NO SPAN PAIRING. The opening backtick is read immediately before the name.
 */
function namesMember(reason: string, member: string): boolean {
  return new RegExp('`' + member + '($|[^A-Za-z0-9_$/-])').test(reason);
}

test('the naming rule counts a code span and refuses prose, a path and a hyphenated name', () => {
  // THE DEFINITION IS ASSERTED BEFORE IT IS USED, in both directions, because a
  // census resting on an undefended predicate is the defect it exists to end.
  // Every string below is a shape that is LIVE in the entries above.
  expect(namesMember('refused on `now` at module scope', 'now')).toBe(true);
  expect(namesMember('`principal(request)` (`routes/admin-wallet.ts:679`)', 'principal')).toBe(
    true,
  );
  expect(namesMember('`idempotency.find` names a member of the store', 'idempotency')).toBe(true);

  // AND THE FOUR IT MUST REFUSE, EACH REFUSED BY CLAUSE 1: the backtick sits
  // before `packages`, before `systemDb` and before `operatorSessions`, never
  // before the member name.
  expect(namesMember('a trader can now take that request back', 'now')).toBe(false);
  expect(namesMember('and `packages/enrichment` is in the same position', 'enrichment')).toBe(
    false,
  );
  expect(namesMember('the operator door, `systemDb(operator-console)`', 'operator')).toBe(false);
  expect(namesMember('it now points inside `operatorSessions` own reason', 'operator')).toBe(false);

  // AND THE TWO THAT REACH CLAUSE 3, which the four above do not. These are the
  // only shapes in this fixture whose answer CHANGES when the trailing rule is
  // removed, and they are here because a seed proved the four above do not hold
  // that clause at all.
  expect(namesMember('`operator-console` is the door this port waits on', 'operator')).toBe(false);
  expect(namesMember('`db/scoped.ts` is where the handle lives', 'db')).toBe(false);
});

/** Every blocked port, its interface, and that interface's members. */
const CENSUS: readonly { port: string; iface: string; members: readonly string[] }[] = Object.keys(
  BLOCKED,
).map((port) => {
  const iface = portInterface(port) ?? '';
  return {
    port,
    iface,
    members: iface === '' ? [] : interfaceMembers(declaringSource(iface), iface),
  };
});

test('every blocked port resolves to one interface this file can slice', () => {
  // THE NON-VACUITY GUARD, AND IT IS THE ONE THIS CASE CANNOT DO WITHOUT. A port
  // whose interface is not found slices to ZERO members, and zero members is an
  // empty gap, which is a GREEN census over a port nobody measured. So an
  // unresolvable port FAILS here rather than passing quietly below.
  for (const row of CENSUS) {
    expect(
      row.iface,
      `\`${row.port}\` declares no setter this scan can read a parameter type off`,
    ).not.toBe('');
    expect(
      row.members.length,
      `\`${row.iface}\` sliced to zero members, so the census below would pass \`${row.port}\` ` +
        'without reading anything. The slicer or the declaration has moved',
    ).toBeGreaterThan(0);
  }
});

test('the member census is derived from the interfaces rather than from the entries', () => {
  // NAMED RATHER THAN COUNTED, so a member added to or removed from a port
  // arrives in the diff carrying its own name. A count alone would have let
  // ADR-366's finding land as "five became six" with nobody able to say which.
  expect(Object.fromEntries(CENSUS.map((row) => [row.port, row.members]))).toStrictEqual({
    setAdminReadSource: [
      'searchAccounts',
      'readAccount',
      'readIdentityGraph',
      'listFlags',
      'readLiability',
      'exportEvidence',
      'listEvents',
    ],
    setAdminSessionSource: ['lookup'],
    useAdminPayoutBackend: ['operator', 'principal', 'now'],
    useAdminWalletBackend: ['operator', 'principal', 'now', 'writeCorrection', 'reconcile'],
    useAdminWriteBackend: ['operator', 'principal', 'validatePlan', 'now', 'tradingDay'],
    usePayoutBackend: ['transact', 'listPayouts', 'idempotency'],
    useCheckoutBackend: ['transact'],
    useCheckoutAdapters: ['adapterFor', 'returnUrl', 'cancelUrl', 'enrichment'],
    useTurnstileVerifier: ['verify'],
    useKycDeps: ['provider', 'backend', 'returnUrl'],
    useAffiliateDeps: ['backend'],
    setInternalOpsSource: ['readDependencies', 'readJobs', 'readReconStatus', 'runBatch'],
    useCertificateRevokeBackend: ['operator', 'principal', 'now', 'presentation'],
    useWithdrawalBackend: ['transact', 'idempotency', 'now'],
  });

  // THE THREE INDEPENDENT AGREEMENTS THAT SAY THE SLICER IS RIGHT, asserted so
  // that a slicer regression is caught by a figure a HUMAN derived by hand in a
  // different session rather than only by this file's own pin. ADR-360 read
  // seven off `AdminReadSource`, ADR-364 four off `InternalOpsSource`, and
  // ADR-366 five off `AdminWalletBackend`, each by its own means.
  const size = (port: string): number =>
    CENSUS.find((row) => row.port === port)?.members.length ?? -1;
  expect({
    adminReads: size('setAdminReadSource'),
    internalOps: size('setInternalOpsSource'),
    adminWallet: size('useAdminWalletBackend'),
  }).toStrictEqual({ adminReads: 7, internalOps: 4, adminWallet: 5 });
});

test('the members no entry names are pinned, so a bare name is not free and a new member is not quiet', () => {
  // BOTH DIRECTIONS, WHICH IS THE WHOLE POINT OF PINNING THE GAP RATHER THAN
  // REQUIRING IT EMPTY:
  //
  //   A PORT GAINS A MEMBER  -> the gap grows -> RED, naming the member. That is
  //   the ADR-358 rot caught at the moment it starts, which is the control this
  //   file did not have.
  //
  //   AN ENTRY NAMES A MEMBER -> the gap shrinks -> RED, naming the member. A
  //   name is the NECESSARY half of an accounting and not the sufficient half,
  //   so the name has to be defended in the diff that adds it or taken out. This
  //   is the direction that stops the census going green on a bare mention.
  const gap = Object.fromEntries(
    CENSUS.map((row) => [
      row.port,
      row.members.filter((member) => !namesMember(BLOCKED[row.port] ?? '', member)),
    ]).filter(([, missing]) => (missing as readonly string[]).length > 0),
  );

  expect(
    gap,
    'the census moved. A member appearing here is a member whose port waits on something no ' +
      'entry states; a member LEAVING here was NAMED by an entry, which is not the same as ' +
      'being accounted for, and the diff that named it owes a blocker or owes the name back',
  ).toStrictEqual({
    setAdminReadSource: [
      'searchAccounts',
      'readAccount',
      'readIdentityGraph',
      'listFlags',
      'listEvents',
    ],
    useAdminPayoutBackend: ['operator', 'now'],
    useAdminWalletBackend: ['now'],
    useAdminWriteBackend: ['operator', 'now'],
    useCheckoutBackend: ['transact'],
    useCheckoutAdapters: ['adapterFor', 'enrichment'],
    useTurnstileVerifier: ['verify'],
    useKycDeps: ['backend'],
    useAffiliateDeps: ['backend'],
    useCertificateRevokeBackend: ['operator', 'now'],
    useWithdrawalBackend: ['transact', 'idempotency', 'now'],
  });

  // THE THREE THAT ACCOUNT FOR EVERY MEMBER ARE ASSERTED AS SUCH rather than
  // left as an absence, so that an entry falling out of the complete set is a
  // named regression instead of a quietly longer object above.
  expect(CENSUS.filter((row) => !(row.port in gap)).map((row) => row.port)).toStrictEqual([
    'setAdminSessionSource',
    'usePayoutBackend',
    'setInternalOpsSource',
  ]);
});

test('the admin wallet entry enumerates the members it blocks and the figure is bound to that list', () => {
  // ADR-366 SECTION 10 ITEM 1 IS THE OWED REPAIR AND THIS IS IT. The clause read
  // TWO and the member it omitted is `operator`, which is the member BOTH of
  // that module's appends travel through. The figure is retired by being NAMED
  // in the entry rather than by the sentence around it being reproduced, which
  // is the `RI-14` collision ADR-367 section 7 measured: `soleCardinal` requires
  // its anchor EXACTLY ONCE, so an editor who quotes instead of naming gets a
  // red bar with instructions rather than a silent second answer.
  const reason = BLOCKED['useAdminWalletBackend'] ?? '';
  const wallet = CENSUS.find((row) => row.port === 'useAdminWalletBackend');
  expect(wallet, 'the admin wallet port left the blocked list').toBeDefined();

  const stated = soleCardinal(
    reason,
    /AND ([A-Z]+) FURTHER MEMBERS/g,
    "`useAdminWalletBackend`'s reason",
  );

  // THE LIST IS READ OUT OF THE ENTRY'S OWN SENTENCE and every name in it is
  // asserted to be a real member of the port, so a rename in `src/` reddens this
  // rather than leaving the entry naming something that no longer exists.
  const listed = matches(
    /AND [A-Z]+ FURTHER MEMBERS: (.*?)\. THAT FIGURE/.exec(reason)?.[1] ?? '',
    /`([A-Za-z_$][\w$]*)`/g,
  );
  expect(
    listed.length,
    'the enumeration sentence no longer parses, so the figure below binds to nothing',
  ).toBeGreaterThan(0);
  for (const name of listed)
    expect(
      wallet?.members,
      `the entry blocks \`${name}\`, which \`AdminWalletBackend\` does not declare`,
    ).toContain(name);

  expect(
    stated,
    `the entry states ${stated} further members and enumerates ${listed.length}: ` +
      listed.join(', '),
  ).toBe(listed.length);

  // AND THE FINDING ITSELF IS PINNED BY NAME, so a later rewrite cannot inherit
  // its way back to the three-blocker census ADR-366 found. `operator` is the
  // member the entry omitted and it is the one that matters.
  expect(
    listed,
    'ADR-366 measured that `operator` is the member this entry did not name and the one both ' +
      'of the module appends travel through. Removing it re-opens the defect',
  ).toContain('operator');
});
