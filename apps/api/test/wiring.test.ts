import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

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
// PRODUCTION value at module scope (`affiliate.ts:478`, `kyc.ts:284`,
// `checkout.ts:1051`), so calling their setter from `start.ts` would install the
// object that is already installed and change nothing a request sees. It would
// also make this file pass. THE REASON TEXT IS WHERE THAT IS RECORDED, so a
// later reader raising the count that way meets the sentence saying it is not a
// wiring before they meet the green tick.
//
// `useTurnstileVerifier` IS THE FOURTH AND IT IS NOT WAITING ON ANYTHING
// (ADR-226). Its module-scope default is the REAL Cloudflare verifier rather
// than a fail-closed stand-in, so the port is live with nothing installed, and
// an absent secret is a refusal rather than an unwired state. Its entry says so
// in those terms, because a reader who meets it beside sixteen liabilities
// should not read it as a seventeenth.
// =============================================================================

const HERE = import.meta.dirname;
const ROUTES = join(HERE, '..', 'src', 'routes');
const SRC = join(HERE, '..', 'src');

/** Every `export function useX(` / `setX(` in a route module. The founder's grep. */
const DECLARES = /^export function ((?:use|set)[A-Za-z]+)\(/gm;

/** Every top-level `useX(` / `setX(` call in `start.ts`. */
const CALLS = /^((?:use|set)[A-Za-z]+)\(/gm;

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

/** Which route module declares each port. */
const declaredIn = new Map<string, string>();
for (const name of tsFiles(ROUTES))
  for (const port of matches(read(join(ROUTES, name)), DECLARES)) declaredIn.set(port, name);

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
  //   `setAdminSessionSource` is the SSO port itself and no door onto this
  //   database can serve it, because THE OPERATOR DIRECTORY IS NOT IN THIS
  //   DATABASE. `admin_actions.actor` is `text NOT NULL` with no foreign key
  //   (`0017_events_and_audit.sql:77`) and `routes/admin-writes.ts:133` says why:
  //   "the operator directory is the SSO provider's and not this database's".
  //
  //   `useAdminWriteBackend`, `useAdminPayoutBackend` and `useAdminWalletBackend`
  //   each require `principal(request)`, whose only resolver in this tree is that
  //   same session source, so all three reduce to the port above BEFORE any door
  //   is reached. Each carries at least one further blocker of its own.
  //
  //   `setAdminReadSource` says in its own header that what it is missing "is not
  //   an authority, it is a shape" (`routes/admin-reads.ts:961`).
  //
  // `SystemReason` is `'nightly-batch' | 'operator-console'`
  // (`packages/db/src/scoped-db.ts:267`) and ADR-165 ruled it gains no member, so
  // the vocabulary was never the obstacle either. ADR-171 section 9 states the
  // condition under which the door becomes takeable: the slice that lands an
  // `AdminSessionSource` a deployment can install, because that is the first
  // moment the door has a caller that reaches a row.
  // ---------------------------------------------------------------------------
  setAdminReadSource:
    'A READ SHAPE, and the door second. `routes/admin-reads.ts:961` states it: "WHAT IS MISSING ' +
    'IS NOT AN AUTHORITY, IT IS A SHAPE", and `:967` "There is no join and no aggregate to ' +
    'reach for." ' +
    'None of the six methods is a projection of one table: `LiabilityResponse` needs a seven-day ' +
    'forecast, a payout velocity, a reserve and a per-plan loss ratio, and `liability_snapshots` ' +
    '(`packages/db/migrations/0009_ledger.sql:164`) carries `as_of`, `open_liability_cents` and ' +
    'four exposure columns, plus `funded_accounts` ' +
    '(`packages/db/migrations/0049_reserve_coverage_snapshots.sql:135`) -- ' +
    'and is scope class `firm` (`packages/db/src/scope.ts:826`), so the EXISTING `firm` door ' +
    'already reaches every column it has. A live adapter today would have to reach `sqlExecutor` ' +
    'to smuggle in SQL the accessor deliberately does not offer, which the port refuses by name.',
  setAdminSessionSource:
    'THE ADMIN IDENTITY PROVIDER, AND NO DOOR ONTO THIS DATABASE COULD EVER SERVE IT. The port ' +
    'says so at `routes/admin-reads.ts:186-197`: C-08 hardware-key SSO and the D3 IP allowlist ' +
    'are edge controls on `ADMIN_ORIGIN`, and "the mapping from a session to an actor and a role ' +
    'is the admin identity provider\'s". THE OPERATOR DIRECTORY IS NOT IN THIS DATABASE: ' +
    '`admin_actions.actor` is `text NOT NULL` with no foreign key ' +
    '(`0017_events_and_audit.sql:77`) and no table in the registry holds an operator, a role or ' +
    'an operator session. ADR-171 rules this port never waited on the operator door, and that ' +
    'THREE OTHER PORTS WAIT ON THIS ONE through `principal(request)`.',
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
    'above, AND TWO METHODS THAT WIRING DOES NOT REACH. `writeCorrection` is refused on four ' +
    'constraints: `0038` is the built door for a wallet correction and ADR-158 never read it, so ' +
    'no column holds which entry a correction corrects (ADR-173). `reconcile` is refused on ' +
    'ADR-157 clause 6, which needs a join and an aggregate. Installing a backend would not ' +
    'resolve either finding and must not paper over them. MONEY PATH.',
  useAdminWriteBackend:
    'THREE SUPPLIERS AND NONE OF THEM IS A DOOR. `principal(request)` ' +
    '(`routes/admin-writes.ts:269`), blocked on `setAdminSessionSource` above. `tradingDay()`, ' +
    'which is the smallest and the least tractable: nothing in this workspace maps an instant to ' +
    'an exchange trading day, and ADR-145 names the gap rather than papering over it with a UTC ' +
    'date. And a projection of `ValidationResult` onto `PlanValidation`, whose `errors` is ' +
    '`{ code, message }` where `CvViolation` is `{ id, path, detail, sizeCents }` and whose `ok` ' +
    'is false when `materialization` is non-empty as well. THE CLAIM THAT `apps/api` DOES NOT ' +
    'DECLARE `@merit/rules-engine` STOOD HERE AND WAS FALSE: it has been declared since session ' +
    '252 landed `routes/payouts.ts` (`apps/api/package.json`), and `validatePlan` is exported ' +
    '(`packages/rules-engine/src/index.ts:163`). ADR-171 finding 10. The same stale sentence ' +
    "survives in that port's own docstring at `routes/admin-writes.ts:277-281`, which is a " +
    "handler file and outside that entry's fence.",

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
  // THE PER-FILE CLAIM WAS A GRAIN ERROR AND IT IS WORTH NAMING. "`0015` declares
  // none of the three" was TRUE the day it was written and is true today, and it
  // was still the wrong question: a merged migration is never edited, only
  // superseded (constitution E2), so what a TABLE can store is never a fact about
  // one file. An entry asking a per-file question about a per-table fact is stale
  // the moment the next `ALTER TABLE` lands, by construction.
  // ---------------------------------------------------------------------------
  usePayoutBackend:
    'A `firm` READ ON A ONE-TRANSACTION PORT, AND NOT THE STORABILITY OF A `RuleState` THIS ' +
    'ENTRY USED TO NAME. IT READ "A `RuleState` NO MIGRATION IN THIS TREE CAN STORE" AND THAT ' +
    'IS FALSE. `lifetime_settled_cents` ' +
    '(`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql:101`), `breached` ' +
    '(`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql:107`) and `breach_kind` ' +
    '(`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql:118`) are all three ' +
    'columns of `rule_states`, and the constraint ' +
    '`rule_states_breach_kind_is_a_breach_kind` ' +
    '(`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql:126`) enumerates every ' +
    'member of `BreachKind` (`packages/rules-engine/src/types.ts:789`) in its `IN` list. ' +
    'Session 400 landed the writer, so `RULE_STATE_WRITE_COLUMNS` ' +
    '(`apps/worker/src/batch/state-writer.ts:232`) carries them. THE ' +
    'ENTRY ALSO SAID `0015_rule_states.sql` DECLARES NONE OF THE THREE, WHICH IS TRUE AND WAS ' +
    'THE WRONG QUESTION: a merged migration is never edited, only superseded (E2), so what a ' +
    'TABLE can store is not a fact about one file. THE GREP IT QUOTED IS NOW LIVE AND RI-20 ' +
    'RUNS IT: `grep -rn lifetime_settled packages/db/migrations` returns 7 lines. WHAT REFUSES ' +
    'NOW, RE-DERIVED ON THIS TREE RATHER THAN INHERITED. FIRST, A `firm` READ INSIDE A PORT ' +
    'THAT RUNS EVERY METHOD ON ONE TRANSACTION: `PayoutTx.subject` returns `PayoutSubject` ' +
    '(`routes/payouts.ts:329`) whose `plan` (`:332`) is a `ResolvedPlan`, which M01 section 1.3 ' +
    'builds from `plan_versions.rules` and a `plan_version_sizes` row; both tables are scope ' +
    'class `firm` -- `planVersions` (`packages/db/src/scope.ts:772`) and `planVersionSizes` ' +
    '(`packages/db/src/scope.ts:777`) -- and `ScopedTableKey` is ' +
    '`Exclude<TableKey, FirmTableKey | PairTableKey>` (`scope.ts:1514`), so no `ScopedTx` read ' +
    'reaches either. ADR-211 clause 2 RULED THE REMEDY AND NOTHING HAS APPLIED IT: two ' +
    'transactions, scoped first, the catalogue read a SECOND PORT beside `PayoutTx` rather ' +
    'than a member of it. That is a change to `routes/payouts.ts`. THE MUTABILITY HALF OF ' +
    "ADR-211 CLAUSE 3 IS SPENT AND ONLY THAT HALF: ADR-213's `0066` pins a published " +
    "version's size grid (`0066_published_size_grid_immutable.sql:212`) beside `0027`'s " +
    '`plan_versions_published_immutable` (`0027_triggers_invariants.sql:260`), so the crossing ' +
    'is safe and the crossing is still not built. SECOND: NOTHING IN THIS TREE IMPLEMENTS ' +
    '`PayoutTx`. THIRD, AND REGISTERED RATHER THAN REPAIRED: `routes/payouts.ts:438-439` states ' +
    '"no member of this interface that a scoped door cannot serve" while `subject()` returns a ' +
    '`ResolvedPlan` no scoped door reaches. Session 401 registered it, ADR-213 section 8 ' +
    'registered it again, and `routes/payouts.ts` is a handler file outside this fence. A ' +
    'PARTIAL BACKEND IS REFUSED RATHER THAN OVERLOOKED: `listPayouts` and `idempotency` are ' +
    'both constructible today (`payoutRequests` is `owned`, `scope.ts:1126`, and ' +
    '`databaseIdempotencyStore` exists at `src/idempotency-store.ts:144`), and installing them ' +
    'beside a `transact` that rejects would put a live-looking route in front of the arm that ' +
    'approves payouts. MONEY PATH.',
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
  // THE FIRM READ IS THE ONE THAT BLOCKS EVERY REQUEST. `usePayoutBackend` above
  // states the identical shape about a different port, and the difference is
  // reach: there it is `PayoutTx.subject`, and here it is FIVE methods of which
  // two are on the unconditional path of both handlers, so no checkout of any
  // payment method gets past the plan lookup.
  // ---------------------------------------------------------------------------
  useCheckoutBackend:
    'A `firm` READ AND A CROSS-IDENTITY READ ON A ONE-TRANSACTION PORT, AND NOT THE ' +
    '`attributions` WRITE THIS ENTRY USED TO LEAD WITH. IT READ that `CheckoutTx.' +
    'insertAttribution` writes a `pair` table "which no authority in `packages/db` admits a ' +
    'request handler writing", AND THAT IS NOW FALSE: ADR-230 gives `PairRule` a required ' +
    '`writer` field (`packages/db/src/scope.ts:1422` registers `attributions` `pair`), and ' +
    '`ScopedTx.insertAsParty` (`packages/db/src/scoped-db.ts:2335`) inserts one row of a table ' +
    'whose rule says `by: party`, over `PartyWritableTableKey` ' +
    '(`packages/db/src/scoped-db.ts:2126`), stamping the identity the handle carries into ' +
    '`buyer_identity_id` and refusing a caller that names it. WHAT REFUSES NOW, DERIVED ON THIS ' +
    'TREE. FIRST, A `firm` READ INSIDE A PORT THAT RUNS EVERY METHOD ON ONE TRANSACTION ' +
    '(`routes/checkout.ts:722`): `publishedPlanVersion` (`routes/checkout.ts:730`) reads ' +
    '`plan_versions`, `planVersionSize` (`:733`) reads `plan_version_sizes`, `couponByCode` ' +
    '(`:739`) reads `coupons`, `geoDecision` (`:765`) reads `geo_restrictions` and ' +
    '`midCandidates` (`:768`) reads `mid_health`; all five tables are scope class `firm` ' +
    '(`packages/db/src/scope.ts:772`, `:777`, `:917`, `:1358`, `:934`) and `ScopedTableKey` is ' +
    '`Exclude<TableKey, FirmTableKey | PairTableKey>` (`packages/db/src/scope.ts:1514`), so no ' +
    '`ScopedTx` read reaches one. THE FIRST TWO ARE UNCONDITIONAL, so this refuses every ' +
    'checkout rather than one arm, which is how it differs from `usePayoutBackend`. SECOND, A ' +
    'ROW THE BUYER MUST SEE THAT BELONGS TO THE AFFILIATE: `clickByToken` (`routes/checkout.ts:753`) ' +
    'returns a `ClickRef` whose `affiliate` is an `AffiliateRef` carrying ' +
    '`affiliates.identity_id`, and `couponByCode` returns the same shape ' +
    '(`routes/checkout.ts:457`); `affiliates` is scope class `owned` on `identity_id` ' +
    '(`packages/db/src/scope.ts:1093`) and `affiliate_clicks` is `derived` through it ' +
    '(`packages/db/src/scope.ts:1109`), so a BUYER-scoped read of either returns the empty set ' +
    'and `resolveAttribution` folds every referral as organic. That is a wrong answer that ' +
    'RETURNS ROWS and it needs a ruling, not a door. THIRD, THE LEDGER ARM, AND THE GROUND ADR-165 STATED ' +
    'STILL HOLDS, RE-DERIVED RATHER THAN CARRIED: the `ledger` on the wallet arm ' +
    '(`routes/checkout.ts:906`) is a `LedgerTx`, which only `SystemTx` satisfies, `SystemReason` ' +
    'is still exactly two members (`packages/db/src/scoped-db.ts:267`) and `apps/api/src/db.ts` ' +
    'still declares no `system(reason, fn)` door. The card arm alone would be a partial backend ' +
    'whose port promises the whole transaction, which is the shape `usePayoutBackend` refuses ' +
    'above.',
  useCheckoutAdapters:
    'a configured PSP adapter per MID plus the `returnUrl` and `cancelUrl` configuration. ' +
    '`packages/psp` ships a port and TWO FAKES (`fakes/psp-a.ts`, `fakes/psp-b.ts`) and no ' +
    'vendor adapter, and `packages/enrichment` is in the same position. NOTE: this port already ' +
    'holds `PRODUCTION_CHECKOUT_ADAPTERS` at module scope (`checkout.ts:1051`), so calling the ' +
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
    '(`routes/auth.ts:642`), which reads `MERIT_TURNSTILE_SECRET` from `process.env` per call ' +
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
    'TWO obstructions, and this entry used to name THREE. `AffiliateBackend` states them in its ' +
    'own defaults (`routes/affiliate.ts:432-450`): `affiliate_commissions` is UNREGISTERED in ' +
    '`packages/db/src/scope.ts` and its only path to an identity runs through `attributions`, ' +
    'which is `pair`; and no table records an ISSUED link. THE THIRD IS SPENT AND THE ENTRY IS ' +
    'REWRITTEN RATHER THAN SHRUNK: it read that `affiliate_statements` is not in `schema.ts` at ' +
    'all, and `affiliateStatements` (`packages/db/src/schema.ts:2686`) declares it while ' +
    '`affiliateStatements` (`packages/db/src/scope.ts:1116`) registers it `derived` through ' +
    '`affiliates` on `affiliate_id`. So FOUR of the six methods have a door rather than three -- ' +
    '`affiliate`, `requiredDisclosure` and `submitCreative` on `affiliates`, which is `owned`, ' +
    'and now `statements` -- and all four are an adapter somebody can write. REGISTERED RATHER ' +
    "THAN REPAIRED: the route module's own `STATEMENTS_UNREACHABLE` " +
    '(`routes/affiliate.ts:444`) still carries the retired sentence and serves it to a caller as ' +
    'the reason `statements` refuses. That is a handler file and outside this fence. NOTE: this ' +
    'port already holds `productionAffiliateDeps` at module scope (`affiliate.ts:478`), so ' +
    'calling the setter here would install what is already installed. That is not a wiring.',
  setEconomicCalendarSource:
    'ONE THING, AND THIS ENTRY USED TO NAME TWO. It read that the view the port reads is in ' +
    'neither `packages/db/src/schema.ts` nor `scope.ts`, so no door could name it, AND THAT IS ' +
    'FALSE: ADR-209 registered it. `economicCalendarCurrent` ' +
    '(`packages/db/src/schema.ts:2379`) declares `economic_calendar_current` and ' +
    '`economicCalendarCurrent` (`packages/db/src/scope.ts:1033`) classes it `firm`, so it is a ' +
    '`TableKey` and `db.firm` reaches it. WHAT REFUSES IS THE SECOND GROUND, UNTOUCHED: ' +
    '`freshness.stale` is decided against a CONFIGURED HORIZON that lives with the alarm and ' +
    'not in this deployable. The port says so at `routes/economic-calendar.ts:166`, "the answer ' +
    'the deployment already computed against the configured horizon", and the module header at ' +
    '`:58` puts the horizon with the alarm. A route that reached for a clock instead would ' +
    'compare a UTC date against an exchange trading day. THE READ ARM ALONE IS NOW ' +
    'CONSTRUCTIBLE AND THE PORT IS ONE METHOD (`routes/economic-calendar.ts:194`), so there is ' +
    'no partial backend available here: `readPanel` returns the panel AND its freshness ' +
    '(`routes/economic-calendar.ts:177`) in one value, and a backend answering it would have to ' +
    'invent the half it cannot compute.',
  setInternalOpsSource:
    'an ops plane rather than a database read. `readDependencies`, `readJobs` and ' +
    '`readReconStatus` are probes of other processes, and `runBatch` COMMANDS one. None of the ' +
    'four is a shape `ApiDb` offers, and `routes/internal.ts:842-845` says a retry against this ' +
    'process will never succeed.',
  useCertificateBackend:
    'ITS SIGNER, AND NOT ITS READ. `databaseCertificateBackend` already exists ' +
    '(`routes/certificates.ts:646`) and its second parameter has no supplier: `image_url` is ' +
    '"signed, time-limited" and this deployable holds no signing key, and `verify_url` addresses ' +
    '`GET /verify/:code`, which ADR-168 foreclosure 1 records as named by M11 and DEFINED BY NO ' +
    'SECTION of the contract. Composing a string here would invent both the origin ADR-012 keeps ' +
    'out of this repository and a path no approved document defines.',
  useCertificateImageSource:
    'a door neither of the two serves. The row is read UNAUTHENTICATED, so `scoped` has no ' +
    'identity to open with, and `certificates` is scope class `owned`, so `firm` refuses the key ' +
    'AT COMPILE TIME. The port states this itself at `routes/certificates.ts:944-948`.',
  useCertificateRevokeBackend:
    'TWO OBSTRUCTIONS, AND THE SECOND IS A CIRCULARITY RATHER THAN A MISSING DOOR. ' +
    '`principal(request)` (`routes/admin-certificates.ts:353`) resolves only through ' +
    '`AdminSessionSource`, so it is blocked on `setAdminSessionSource` above, which ADR-171 ' +
    'rules no door onto this database could ever serve. SECOND AND INDEPENDENT: ' +
    '`AdminCertificateTx` runs `lockAt`, `insert` and `updateAt` on ONE transaction ' +
    '(`routes/admin-certificates.ts:326`), and one of the two tables is `certificates`, scope ' +
    'class `owned` on `identity_id` (`packages/db/src/scope.ts:860`). `db.firm` refuses that key ' +
    'at compile time because `FirmTableKey` is every key whose class is `firm` ' +
    '(`packages/db/src/scope.ts:1473-1475`), and `db.scoped` needs an identity THIS ROUTE CANNOT ' +
    'KNOW UNTIL IT HAS READ THE ROW: `:id` is `certificates.id` and the identity is a column of ' +
    'the row the door would be opened to read. `adminActions` is `firm` ' +
    '(`packages/db/src/scope.ts:1009`), so the audit half alone has a door and the subject half ' +
    'does not, which is the same one-live-arm shape `useVerifySource` below refuses. THIRD, AND ' +
    'it is configuration rather than a door: `presentation()` ' +
    "(`routes/admin-certificates.ts:363`) is `GET /verify/:code`'s copy, and the " +
    "`account_enforced` sentence is `OQ-M11-02`, still open. THIS ROUTE REVOKES A TRADER'S " +
    'PUBLIC PROOF; a backend that answered plausibly would be a fixture doing that to real ' +
    'people.',
  useVerifySource:
    'ONE ARM OF THREE, AND THE OTHER TWO ARE CONSTRUCTIBLE TODAY, WHICH IS WHY THIS ENTRY EXISTS ' +
    'RATHER THAN AN ADAPTER. `VerifySource.lookup` (`routes/verify.ts:596`) reads `certificates`, ' +
    'and `GET /verify/:code` is UNAUTHENTICATED, so `db.scoped` has no identity to open with; ' +
    '`certificates` is scope class `owned` on `identity_id` (`packages/db/src/scope.ts:860`), and ' +
    '`FirmTableKey` is every key whose class is `firm` (`packages/db/src/scope.ts:1473-1475`), so ' +
    '`db.firm` refuses that key AT COMPILE TIME. THE OTHER TWO ARMS HAVE WHAT THEY NEED: ' +
    '`certificate_verifications` is scope class `firm` (`packages/db/src/scope.ts:1375`), so the ' +
    '`record` arm is writable through `db.firm` now, and `presentation` is deployment ' +
    'configuration rather than a read. A BACKEND WITH ONE LIVE ARM AND ONE THAT REJECTS IS ' +
    "REFUSED HERE, on `usePayoutBackend`'s stated rule: it would put a live-looking public " +
    "route in front of the arm that answers the caller, and this route answers `INV-M11-03`'s " +
    '"no certificate with this code", which is a claim about Merit\'s book rather than about a ' +
    'deployment. When `lookup` gets a door this entry shrinks to the copy rather than being ' +
    'rewritten.',
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
  // drives `requested --> approved` or `cooling --> approved`, and `:287-292`
  // puts `requested` and `cooling` both inside `OPEN_WITHDRAWAL_STATUSES` (the
  // array is `wallet-withdrawals.ts:287-292`; :283-288 was the docblock above
  // it), on
  // which `gateNoInFlight` (`:1254`) refuses. So a wired endpoint writes a row
  // nothing will ever advance and then refuses that identity's every later
  // withdrawal, permanently, behind a screen saying a withdrawal is in flight.
  //
  // A 503 AND A LOCKOUT BOTH REFUSE, AND ONLY ONE OF THEM IS REVERSIBLE. That
  // is why the 503 is kept, and it is the same fail-closed direction session
  // 303 was reaching for with the reason it had.
  // ---------------------------------------------------------------------------
  useWithdrawalBackend:
    'A DRIVER FOR THE APPROVAL EDGE, AND NOT THE STORE THIS ENTRY USED TO NAME (ADR-172 clause ' +
    '5). `databaseIdempotencyStore` (`src/idempotency-store.ts:144`) exists and serves the ' +
    'identity arm this route presents (`routes/wallet-withdrawals.ts:1527`), so the idempotency ' +
    'half is no longer what refuses. What refuses is that NOTHING IN THIS TREE performs ' +
    '`requested --> approved` or `cooling --> approved` (`routes/wallet-withdrawals.ts:57-60`), ' +
    'and both statuses are in `OPEN_WITHDRAWAL_STATUSES` (`:287-292`), so `gateNoInFlight` ' +
    '(`:1254`) would refuse that identity every later withdrawal. Wiring it trades an honest 503 ' +
    'for a permanent per-trader lockout, and only the 503 is reversible. TWO LINE NUMBERS IN ' +
    'THIS ENTRY WERE FALSE BY EIGHTEEN LINES WHEN ADR-176 CHECKED THEM, in the reason ADR-172 ' +
    'wrote one session earlier to replace a false one: line 1233 was the KYC term and line 1506 ' +
    'was a `.send(`. The CLAIMS held at their real lines and the CITATIONS did not, which is the ' +
    'same drift in its quietest form. THOSE TWO NUMBERS ARE WRITTEN OUT OF CITATION GRAMMAR ON ' +
    'PURPOSE: a `file:line` pointer is a claim about THIS tree, so a pointer quoted as HISTORY ' +
    'must not wear the shape that says follow me (ADR-212).',
};

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
    'databaseCertificateBackend',
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
  expect({
    declared: declaredIn.size,
    wired: [...wired].filter((port) => declaredIn.has(port)).length,
    blocked: Object.keys(BLOCKED).length,
  }).toStrictEqual({ declared: 24, wired: 6, blocked: 18 });
});
