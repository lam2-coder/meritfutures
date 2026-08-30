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
  // (`packages/db/src/scoped-db.ts:267`) and ADR-165 ruled it gains no member, so
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
    'SIX entries in this list rather than the four ADR-171 counted. ' +
    'THE ONE THING HERE THAT IS NOT BEHIND THAT PURCHASE IS `readLiability`, which is UNBUILT ' +
    'rather than blocked: its book reader, its seven-day horizon and its payout-velocity ' +
    'evaluator all exist and nothing folds them into one body, and the figure holding that fold ' +
    'is `eligible_next_7d`, whose last term is a `writeRuleState` implementation under ' +
    '`apps/worker/**` or `packages/**`. `test/admin-read-constructibility.test.ts` holds every ' +
    'count in this entry and derives each from source.',
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
    'OUT OF THEM IS REFUSED AND ADR-237 SECTION 8 SAYS WHY: nothing can write an ' +
    '`operator_sessions` row, so every operator would be told 401 on a door that is not shut ' +
    'against them, and a live-looking route in front of an arm that cannot answer is worse than ' +
    "an honest 503 (`usePayoutBackend`'s rule). " +
    'FIVE OTHER PORTS STILL REDUCE TO THIS ONE, four through `principal(request)` ' +
    '(`useAdminWriteBackend`, `useAdminPayoutBackend`, `useAdminWalletBackend` and ' +
    '`useCertificateRevokeBackend`) and a fifth through a door (`setAdminReadSource`, ADR-171 ' +
    'section 9, ADR-236). ADR-171 said THREE, which was right before ' +
    '`useCertificateRevokeBackend` existed. `test/admin-read-constructibility.test.ts` derives ' +
    'both counts from this file.',
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
    'above, AND TWO METHODS THAT WIRING DOES NOT REACH. `writeCorrection` is refused on THREE ' +
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
  // leg has NO PREDICATE TO READ because M01 states R-38's grain both ways. SO
  // THE ENTRY NARROWS TO NAME ALL THREE FIELDS AND WHAT EACH ONE WAITS ON.
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
    'IS A `BatchPorts` VALUE NOW AND IT SERVES FOUR OF TEN METHODS: `runNightlyBatch` ' +
    '(`apps/worker/src/batch/nightly.ts:276`) takes a `BatchPorts`, its read half declares ' +
    'SEVEN methods and its write half THREE (`apps/worker/src/batch/ports.ts:265,336`), and ' +
    '`postgresBatchPorts` (`apps/worker/src/batch/adapter.ts`) serves the calendar watermark, ' +
    'the calendar slice, the accounts with a live mark and the accounts with stored state over ' +
    "this deployable's one door. IT REFUSES `loadAccountDay` BY NAME, so the fold never " +
    'starts: an `AccountDay` carries a resolved plan, a prior state, a mark, settlements, an ' +
    'opened-on anchor and R-40s five context facts, and no adapter resolves them. THIRD, THE ' +
    'CODEC CLAUSE IS DISCHARGED, AND IT IS THE FIRST THING THIS ENTRY HAS LOST RATHER THAN ' +
    'REPHRASED. IT NARROWED TWICE AND THEN CLOSED. It read that writing a decoding would be ' +
    'inventing a corpus fact, which ADR-206 retired by ruling the encoding as the engine`s own ' +
    'value, six groups and twenty-five leaves with every cents leaf a base-10 string. It then ' +
    'read that `RuleStateWriterIo.encodeEngineGates` ' +
    '(`apps/worker/src/batch/state-writer.ts:354`) had no implementation under any `src/`, ' +
    'WHICH ADR-250 MADE FALSE: the codec is `encodeEngineGates` and `decodeEngineGates` in ' +
    '`packages/rules-engine/src/gates-codec.ts`, which is ADR-239 slice A`s home because BOTH ' +
    'deployables need the one predicate and neither can import the other, and ' +
    '`apps/worker/src/batch/adapter.ts:473` INSTALLS it where it took the unwired refusal. The ' +
    'round trip is EXECUTED rather than claimed: an engine-folded value survives encode, JSON ' +
    'and decode unchanged, and a cent past `Number.MAX_SAFE_INTEGER` comes back exact. THE ' +
    'PORT IS NOT WIRED BY ANY OF THAT AND THE WIRED COUNT DOES NOT MOVE, which is why the ' +
    'clause closing is worth stating rather than celebrating: the codec was the SMALLEST of ' +
    'the things `state` waits on, and what it leaves standing is the adapter and the empty ' +
    'table. THE READ THIS PORT NEEDS IS NOW SERVED BY A FUNCTION AND BY NO ROW: ' +
    '`PayoutTx.subject` (`routes/payouts.ts:428`) returns a ' +
    '`PayoutSubject` whose `state` (`routes/payouts.ts:331`) is a `RuleState`, ' +
    '`RuleState.engineGates` (`packages/rules-engine/src/types.ts:1006`) is `EngineGateResults` ' +
    '(`packages/rules-engine/src/types.ts:961`), `rule_states.engine_gates` is `jsonb`, and ' +
    '`decodeEngineGates` is what rebuilds one from the other. ' +
    'FOURTH, `rule_states` HOLDS NO ROWS, so a backend installed today would compute a ' +
    'confident payout verdict off an empty table, which is a wrong answer where a 503 is an ' +
    'honest one. FIFTH: NOTHING IN THIS TREE IMPLEMENTS `PayoutTx`. THE API DOES NOT GET TO ' +
    'FOLD ONE ITSELF AND ADR-239 RULES IT: `INV-M5-02` (`M05:81`) is that both endpoints call ' +
    '`evaluatePayout` with the same inputs because "a second evaluator would be a second rule", ' +
    "and a request-path fold is the divergence ADR-026 C-07's `state_hash` exists to make " +
    'detectable, computed on the one path no replay audit reads. SIXTH, AND IT IS NOT UNDER THE ' +
    '`RuleState` AT ALL: `PayoutSubject` (`routes/payouts.ts:329`) CARRIES THREE FIELDS AND THIS ' +
    'ENTRY HAS ONLY EVER NAMED TWO. `state` is clauses one to four and `plan` was discharged by ' +
    'ADR-233; `gates` is an `ExternalGates` (`routes/payouts.ts:333`) and NO VALUE OF IT IS ' +
    'RESOLVED FROM A ROW ANYWHERE UNDER A `src/`. Swept comment-stripped over every `.ts` under ' +
    'every `apps/*/src` and `packages/*/src`, the object key `hasPayoutInFlight:` appears in ' +
    'TWO files: `packages/rules-engine/src/types.ts`, which DECLARES the field, and ' +
    '`packages/harness/src/trial.ts`, which raises one member on a value its caller handed it ' +
    'inside a Monte Carlo loop whose package declares no database. Every constructed value is a ' +
    'fixture or `scripts/demo/fold.ts`. THE FIVE FACTS SPLIT THREE AND TWO, AND THE ENTRY ' +
    'NARROWS BY ADR-248 RATHER THAN REPEATING THAT A RESOLVER IS MISSING. THREE RESOLVE: ' +
    '`payoutsFrozen` is `identities.payouts_frozen` (`0002_identity.sql:50`) OR ' +
    '`accounts.payouts_frozen` (`0007_accounts.sql:83`), which `admin-source/search.ts` ' +
    'already works out and states; `reconBlocked` is `accounts.recon_blocked` ' +
    '(`0007_accounts.sql:87`) and has no identity half; and `kycState` is the head of the ' +
    'supersession chain over `kyc_verifications.state` (`0003_kyc.sql:51`), which ' +
    '`currentKycState` (`apps/api/src/routes/wallet-withdrawals.ts:471`) ALREADY RESOLVES AND ' +
    'FAILS CLOSED ON, on another money door. TWO DO NOT. THE ACCOUNT-STATUS LEG CANNOT BE A ' +
    'TOTAL MAP: `account_status` ' +
    'declares SEVEN members (`0001_extensions_and_enums.sql:47`) and `AccountStatus` ' +
    '(`packages/rules-engine/src/types.ts:891`) takes SIX, the difference being ' +
    '`provisioning_pending`, and `M01:203` carries the same six, so the engine transcribed its ' +
    'source correctly and the resolver owes a REFUSAL rather than a widened union. AND THE ' +
    'IN-FLIGHT LEG IS NOT A MISSING FUNCTION, IT IS A CONTRADICTED PREDICATE, WHICH IS WHERE ' +
    'ADR-245 SIZED THIS SLICE TOO CHEAPLY: `M01:207` declares the field as an outstanding leg ' +
    '"for this account" and `M01:531` states R-38 as one "for this identity". `EC-040`, ' +
    '`M01:861`s AS-01 residual and the live SD-09 index (`payout_requests (account_id)`, ' +
    '`0031_payout_hold_and_identity_restriction.sql:105`) all take the ACCOUNT reading, and ' +
    'AS-09 is RULED at the gate as visibility rather than a rule, so the identity reading ' +
    'would refuse nine of a copy traders ten accounts under a ceiling the corpus declined to ' +
    'impose. THE TWO READINGS DIFFER BY EVERY IDENTITY HOLDING MORE THAN ONE ACCOUNT, AND ONE ' +
    'OF THEM IS PERMISSIVE ON THE DOOR WHERE MONEY LEAVES. A resolver picking either would be ' +
    'a route ruling a contradiction inside a FROZEN plan, so `gates` IS NOT CONSTRUCTIBLE IN ' +
    'THIS DEPLOYABLE TODAY and ADR-248 refused to build it. THIS CLAUSE ' +
    'DID NOT MOVE WHEN THE WORKER LANDED because nothing ADR-241 built touches it, and it is ' +
    'NOT DOWNSTREAM OF THE CODEC EITHER: `rule_states.context_gates` is `NOT NULL` ' +
    '(`0015_rule_states.sql:130`) and `AccountDay.external` is required ' +
    '(`apps/worker/src/batch/ports.ts:87`), so this resolver is UPSTREAM of the row rather ' +
    'than the independent fourth slice ADR-245 section 6 sized. SO THE THREE FIELDS WAIT ON ' +
    'THREE DIFFERENT THINGS AND THE THIRTEENTH REVISION OF THIS REASON SAYS SO: `state` waited ' +
    'on a codec, an adapter and a row and NOW WAITS ON TWO, because ADR-250 landed the codec; ' +
    '`plan` waits on NOTHING and ' +
    'ADR-233 discharged it; `gates` waits on a RULING and not on code. THE FIRM-READ CLAUSE IS ' +
    'DISCHARGED AND IS DELETED RATHER THAN KEPT BESIDE A DOOR THAT LANDED: `ScopedTx` now ' +
    'carries `catalogRows`, `catalogRowsWhere` and `catalogRowAt` over `CATALOG_TABLE_KEYS` ' +
    '(`packages/db/src/scoped-db.ts:2558`), a closed list of five `firm` keys that includes ' +
    "`planVersions` and `planVersionSizes`, so `PayoutTx.subject`'s `ResolvedPlan` inputs are " +
    'readable ON THE PAYOUT TRANSACTION and the two-transaction remedy ADR-211 clause 2 ruled ' +
    'is not needed. AN OLDER CLAUSE IS KEPT AS HISTORY BECAUSE IT WAS FALSE: this entry once ' +
    'read "a `RuleState` NO MIGRATION IN THIS TREE CAN STORE", and `lifetime_settled_cents`, ' +
    '`breached` and `breach_kind` are all three columns of `rule_states` as of ' +
    '`packages/db/migrations/0065_rule_state_lifetime_and_breach.sql`. THE GREP IT QUOTED IS ' +
    'LIVE AND RI-20 RUNS IT: `grep -rn lifetime_settled packages/db/migrations` returns 7 ' +
    'lines. REGISTERED RATHER THAN REPAIRED: `routes/payouts.ts:438-439` states "no member of ' +
    'this interface that a scoped door cannot serve", which ADR-233 makes TRUE of the ' +
    'catalogue half and leaves false of `state`. EVERY CLAUSE ABOVE IS A PREDICATE SOMEWHERE ' +
    'AND NOT ONLY A SENTENCE HERE: `apps/api/test/rule-state-producibility.test.ts` runs the ' +
    'four links on every CI-01 pass, because a reason naming the second-cheapest blocker ' +
    'retires the question for every reader after it and this entry has done that twice. A ' +
    'PARTIAL BACKEND IS REFUSED RATHER THAN OVERLOOKED: `listPayouts` and `idempotency` are ' +
    'both constructible today (`payoutRequests` is `owned`, `scope.ts:1152`, and ' +
    '`databaseIdempotencyStore` exists at `src/idempotency-store.ts:144`), and installing them ' +
    'beside a `transact` whose `subject` rejects would put a live-looking route in front of the ' +
    'arm that approves payouts. MONEY PATH.',
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
    'A CAP WHOSE ROW EXISTS AND WHOSE DOOR DOES NOT, A CROSS-IDENTITY READ AND THE LEDGER ARM. ' +
    'THREE CLAUSES STILL, AND THE FIRST IS NARROWED RATHER THAN DELETED (ADR-252, on ADR-238 ' +
    'ruling 1). THE `firm` READ CLAUSE THIS ENTRY LED WITH UNTIL ADR-233 STAYS DELETED: ' +
    '`ScopedTx` carries `catalogRows`, `catalogRowsWhere` and `catalogRowAt` over ' +
    '`CATALOG_TABLE_KEYS` (`packages/db/src/scoped-db.ts:2558`), whose five members are exactly ' +
    'the five tables this port reads, and the `attributions` write clause before it was ' +
    'discharged the same way by ADR-230. THIS PORT HAS LOST ITS LEAD BLOCKER TWICE AND ANSWERED ' +
    '503 AFTER EACH. WHAT REFUSES NOW, RE-DERIVED ON THIS TREE. FIRST, THE CAP, AND IT IS STILL ' +
    'THE FIRST LINE OF BOTH HANDLERS: `accountCap()` (`routes/checkout.ts:802`) runs before the ' +
    'plan on the purchase path and before `resetTarget` on the reset path, and its `maxAccounts` ' +
    '(`routes/checkout.ts:557`) NOW HAS A COLUMN AND STILL HAS NO DOOR. ADR-238 ruling 1 ruled ' +
    "the base cap the FIRM'S number and refused `limits.max_accounts_per_entity` in all three of " +
    'its available forms, because that leaf is PER PLAN VERSION while `liveAccounts` beside it ' +
    "is this identity's total across EVERY plan: reading the purchased version makes the " +
    'effective cap the MAXIMUM over published versions, reading the pinned version reads a row ' +
    'that may have been retired years earlier, and requiring every published version to agree is ' +
    "a firm parameter wearing a plan's costume that no CHECK can express. ADR-252 BUILT THAT " +
    'HOME AND WIRED NOTHING TO IT: `grep -rln firm_parameters packages/db/migrations` returns ' +
    '1 line, which is `0074_firm_parameters.sql`, and it creates `base_account_cap` on ' +
    "`price_floors`' shape with its approver a foreign key into `operators`. THE EXCEPTION IS " +
    'UNTOUCHED AND 0002 IS NOT EDITED: `grep -rn max_accounts_override ' +
    'packages/db/migrations/0002_identity.sql` returns 1 line. WHAT REMAINS IS A DOOR AND NOT A ' +
    'COLUMN, WHICH IS THE NARROWING: `accountCap()` is a method of `CheckoutTx`, which is a ' +
    'SCOPED transaction, and a scoped transaction refuses every firm key outside ' +
    '`CATALOG_TABLE_KEYS` -- five members -- and `grep -rn firmParameters ' +
    'packages/db/src/scoped-db.ts` returns nothing. THE READ CANNOT MOVE OUTSIDE THE ' +
    'TRANSACTION EITHER, because `INV-M3-15` requires the restriction check at the same point in ' +
    'the transaction as the cap and `gateIdentity` performs both in one call. AND THE TABLE ' +
    'SHIPS EMPTY, WHICH NO DOOR FIXES: nothing under any `src/` writes a `firm_parameters` row ' +
    'or an `operators` row, and AN ABSENT ROW IS NO CAP RATHER THAN AN UNLIMITED ONE, so the ' +
    'slice that writes this read owes a REFUSAL there before it owes anything else. ' +
    '`databaseAuthBackend` STILL REFUSES `readMe` (`src/auth-backend.ts:1529`) ABOUT THE SAME ' +
    'NUMBER AND NO LONGER FOR THE IDENTICAL FINDING: that method reads through `ApiDb.firm`, ' +
    'which needs no catalogue admission, so its remaining half is the empty table alone. THE TWO ' +
    'ENTRIES WERE ONE REFUSAL FOR AS LONG AS NEITHER HAD A SOURCE AND THEY ARE TWO NOW. SECOND, ' +
    'A ROW THE BUYER MUST SEE THAT BELONGS TO THE AFFILIATE, REFUSED A SECOND ' +
    'TIME: `clickByToken` (`routes/checkout.ts:831`) returns a `ClickRef` whose `affiliate` ' +
    'carries `affiliates.identity_id`, and `couponByCode` returns the same shape ' +
    '(`routes/checkout.ts:478`); `affiliates` is scope class `owned` on `identity_id` ' +
    '(`packages/db/src/scope.ts:1119`) and `affiliate_clicks` is `derived` through it ' +
    '(`packages/db/src/scope.ts:1135`), so the row belongs to somebody else and the disclosure ' +
    'ground that is ABSENT for a `firm` row is fully present here. A buyer-scoped read of either ' +
    'returns the empty set and `resolveAttribution` folds every referral as organic, which is a ' +
    'wrong answer that RETURNS ROWS. ADR-238 RULING 2 NAMES WHAT THE PORT MUST DO INSTEAD AND IT ' +
    'IS NOT A READ: a door that resolves the affiliate INSIDE `packages/db` and hands this ' +
    "handler a BIT rather than a uuid, which is ADR-230's `insertAsParty` stamp applied to the " +
    'counterparty. IT IS UNAVAILABLE WHILE `AffiliateRef` CARRIES `identityId` and ' +
    "`packages/affiliate` was outside that entry's fence. THIRD, THE LEDGER ARM, AND ADR-165's " +
    'GROUND STILL HOLDS: the `ledger` on the wallet arm (`routes/checkout.ts:969`) is a ' +
    '`LedgerTx`, which only `SystemTx` satisfies because `ledger_transactions` and ' +
    '`ledger_entries` are both `derived` rather than `firm`, `SystemReason` is still exactly two ' +
    'members (`packages/db/src/scoped-db.ts:267`) and `ApiDb` still declares no door that yields ' +
    'a `SystemTx`. ADR-238 RULING 3 ADDS THE HALF ADR-165 DID NOT REACH: ADR-176 cleared the ' +
    'same obstruction for `LT-01` by DELETING `PayoutTx.ledger` and posting later at a system ' +
    'authority, and that remedy does NOT transfer, because M20 pins `LT-08` to the purchase ' +
    'transaction by name and `DEP-M20-02` states the consequence of moving it. The card arm ' +
    'alone would be a partial backend whose port promises the whole transaction, which is the ' +
    'shape `usePayoutBackend` refuses above. EVERY CLAUSE HERE IS ASSERTED BY ' +
    '`test/checkout-backend-blockers.test.ts` RATHER THAN ONLY WRITTEN. MONEY PATH.',
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
    'ONE obstruction, and this entry has named THREE and then TWO. `affiliate_commissions` is ' +
    'UNREGISTERED in `packages/db/src/scope.ts` and UNDECLARED in `packages/db/src/schema.ts`, ' +
    'and ADR-253 rules that it is not one registration away but a SEVENTH SCOPE CLASS away. Its ' +
    'only path to an identity runs through `attributions`, which is `pair`, so a `derived` rule ' +
    'compiles and throws; the row declares no column against `identities(id)`, so `owned`, ' +
    '`pair` and `either` have nothing to name; and `firm` is available, is accepted by every ' +
    'mechanical check in this repository, and is FALSE, because a commission is what Merit owes ' +
    'a named affiliate. THE SECOND OBSTRUCTION IS DISCHARGED AS A REGISTRY QUESTION AND IS NOT ' +
    'DELETED: it read that no table records an ISSUED link, and ADR-253 section 3 rules that ' +
    'none is owed, because `affiliate_clicks_token_uq` is UNIQUE and one issued link is clicked ' +
    'many times, so an issued handle and a click token cannot be one column, and every attribute ' +
    'a link would carry is already on `affiliate_clicks` at click grain. `issueLink` therefore ' +
    'waits on an ADAPTER and a BASE URL rather than on DDL, which is the same position ' +
    '`affiliate`, `requiredDisclosure`, `submitCreative` and `statements` are in. FIVE of the ' +
    'six methods are an adapter somebody can write and ONE is not. THE REPAIR REGISTERED HERE ' +
    'LAST WAVE IS TAKEN: `STATEMENTS_UNREACHABLE` served a caller the retired sentence that ' +
    '`affiliate_statements` is not in `schema.ts`, and ADR-253 section 5 repairs it at the ' +
    'constant and at the module header, which carried the same sentence a second time and which ' +
    'no entry had named. NOTE: this port already holds `productionAffiliateDeps` at module scope ' +
    '(`affiliate.ts:478`), so calling the setter here would install what is already installed. ' +
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
    '`0014_marks.sql`, and the exact filter is ALREADY WRITTEN in this deployable at ' +
    '`admin-source/liability.ts:1193`. What refuses it is THE DOOR: `reconciliations` is scope ' +
    'class `derived` (`packages/db/src/scope.ts:1341`), so `firm` refuses the key AT COMPILE ' +
    'TIME and `scoped` has no identity on this surface, and ADR-171 clause 1 refuses the ' +
    '`SystemTx` door until an `AdminSessionSource` a deployment can install exists. ADR-237 ' +
    'measured that condition as UNMET. ' +
    '`runBatch` IS A COMMAND AND `ApiDb` DOES OFFER ITS SHAPE. `firm(fn)` yields a `FirmTx`, ' +
    'which carries `sqlExecutor(reason)` (`packages/db/src/scoped-db.ts:3044`) at the one reason ' +
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
  useCertificateBackend:
    'ONE FIELD OF ONE RESPONSE, AND ADR-246 READ THE THREE CERTIFICATE PORTS AS A SET AND FOUND ' +
    'THAT THIS ONE AND `useCertificateImageSource` WAIT ON THE SAME ABSENT THING. ' +
    '`databaseCertificateBackend` still exists (`routes/certificates.ts:692`) and its read arm is ' +
    'constructible today through `db.scoped`; its second parameter still has no supplier. ' +
    "THE `verify_url` CLAUSE IS DISCHARGED AND IS REWRITTEN RATHER THAN DELETED, on RI-14's " +
    'rule that a false sentence removed leaves nothing for the next reader to check. It read ' +
    'that the path is "named by M11 and DEFINED BY NO SECTION of the contract" (ADR-168 ' +
    'foreclosure 1), and API_CONTRACT section 6.3 has carried a `GET /verify/:code` row since ' +
    'ADR-170, `routes/verify.ts` implements it, and `start.ts` wires `databaseVerifySource(LIVE_DB)` ' +
    'today. What that half waits on is an ORIGIN, which is a deployment fact ADR-012 keeps out of ' +
    'this repository and which one named environment variable would close. ' +
    'WHAT STILL REFUSES IS `image_url`, AND ADR-249 NARROWED IT TO ONE THING. It is no longer ' +
    'the signer, the column and the renderer: it is the RENDERER, alone. ADR-249 ruled that this ' +
    'card carries NO SIGNATURE AT ALL, so the key ADR-240 placed outside this deployable is a key ' +
    'nothing in the design asks for, and that `image_url` is `origin` plus the path this file ' +
    'already serves, DERIVED FROM `code` at projection time. `projectCertificate` hands `links` ' +
    'the code and no other field of the row can reach the address, which is executed in ' +
    '`test/certificate-card-home.test.ts` rather than argued here, so `certificates` needs no ' +
    'image-location column and ADR-249 RESERVED NO MIGRATION NUMBER AND TOOK NONE. The table ' +
    'still carries seventeen columns and none is an image location and no migration in the set ' +
    'alters it (`0020_public_surface.sql`), and that is now a RULING that it needs none rather ' +
    'than a measurement of an absence. `test/certificate-ports.test.ts` executes the column set ' +
    'and the sweep, so the day either moves this entry goes red. ' +
    'SO THIS PORT WAITS ON THE ENDPOINT ITS OWN FIELD WOULD ADDRESS, and on an origin. Publishing ' +
    'a link to a trader is publishing a promise that bytes are there, and until ' +
    '`useCertificateImageSource` has a renderer the address would resolve to a 503. ADR-240 ' +
    'clause 10 still declines to name the origin variable, for a ground ADR-249 CHANGED rather ' +
    'than repeated: it is no longer that the sibling field can never be built, it is that the ' +
    'row it addresses does not answer yet. ' +
    'AND THE HALF-WIRING IS REFUSED ON A SECOND GROUND THAT IS NOT A MISSING PIECE AT ALL: ' +
    '`projectCertificate` never calls `links` for a deferred row (ADR-168 foreclosure 4), so a ' +
    'backend with a live read and a refusing signer answers 200 to a trader whose certificates ' +
    'are all deferred and refuses the trader beside them whose certificate issued. THAT IS A ' +
    "RESPONSE DECIDED BY THE STATE OF THE CALLER'S OWN ROWS, it is executed in " +
    '`test/certificate-ports.test.ts`, and it is why raising the wired count here is refused ' +
    'however the refusal is dressed. ADR-246 repaired the status code of that refusal (503 rather ' +
    'than 500, on ADR-240 section 4) and deliberately did NOT wire the port.',
  useCertificateImageSource:
    'THE SAME ABSENCE AS `useCertificateBackend` SEEN FROM THE OTHER SIDE, WHICH IS ADR-246. ' +
    'THE REASON HERE WAS THE DOOR AND ADR-231 BUILT IT, so the entry is REPLACED rather than ' +
    'deleted and the obstruction that remains is a different one. It read: "a door neither of ' +
    'the two serves. The row is read UNAUTHENTICATED, so `scoped` has no identity to open with, ' +
    'and `certificates` is scope class `owned`, so `firm` refuses the key AT COMPILE TIME." ' +
    'THAT IS NO LONGER THE BLOCKER. `db.publicLookup` reads `certificates` by `code` for a ' +
    'caller who will never be anybody (`PUBLIC_LOOKUP_ADDRESS`), and `GET /verify/:code` is ' +
    "wired over it in `start.ts` today, so BOTH of this port's database arms are " +
    'constructible: `record` writes `certificate_verifications`, scope class `firm`, exactly as ' +
    '`databaseVerifySource` does. WHAT BLOCKS THIS ROW IS THAT ITS ANSWER IS NOT A ROW, IT IS ' +
    'BYTES. `CertificateLookup.card` carries `image/png` bytes ' +
    "(`routes/certificates.ts:958`, reached at `:976`) and this file's own header says the " +
    'renderer "is not ' +
    'in this repository" (`routes/certificates.ts:44`). An adapter written here would have to ' +
    'invent a card, and a public endpoint serving an invented card is a worse failure than a ' +
    "503: it puts Merit's name on an artefact Merit did not render. " +
    "ADR-240 MEASURED THE MISSING RENDERER RATHER THAN RESTATING IT, on ADR-235's rule that an " +
    'absent producer reads as a satisfied specification: over every directory in this ' +
    'repository holding shipped source, `CertificateCard` is named in ONE file and that file is ' +
    "the port's own declaration, and the string `image/png` appears in ONE file too. " +
    '`test/certificate-links.test.ts` executes both counts, so the day a renderer lands this ' +
    'entry goes red rather than waiting to be noticed. ' +
    'AND ONE HALF OF THE CARD IS CONFIGURATION WHILE THE OTHER IS NOT, which is why naming a ' +
    'variable does not close this port either: `cache_max_age_seconds` is "config rather than a ' +
    'number stated here" (API_CONTRACT section 6.3), so a deployment supplies it, and the BYTES ' +
    'beside it are a renderer no deployment can set. ADR-240 declines to name the first while ' +
    'the second has no producer, because a variable whose only consumer refuses is a name ' +
    'nothing reads. ' +
    'ADR-246 ADDED THE SET READING: the bytes this port owes and the `image_url` ' +
    '`useCertificateBackend` owes are ONE deliverable, so the two entries expire together or ' +
    'not at all, and a session dispatched at either is dispatched at the card. ' +
    'AND ADR-249 RULED WHERE THAT CARD COMES FROM, WHICH LEAVES THIS ENTRY WAITING ON A ' +
    'RENDERER AND ON NOTHING ELSE. It is rendered ON FETCH, from the live row, by whatever ' +
    "answers this deployable's own image row, and it is stored NOWHERE DURABLE: `INV-M11-08` " +
    'says a rendered image "is re-generated on fetch from the live row" and is "never a static ' +
    'artifact Merit keeps serving after the row changed", and `imageHandler` already enforces it ' +
    'by refusing a non-deferred lookup that carries no card. Every value the card draws is ' +
    'already a column of `certificates`, so the renderer this port waits on needs NO MIGRATION, ' +
    "and `FM-M11-05`'s cache key `(code, row_version)` names a column that does not exist and " +
    'that ADR-249 rules DERIVED rather than stored. Both halves are executed in ' +
    '`test/certificate-card-home.test.ts`. THE RENDERER IS STILL ABSENT AND THAT IS THE WHOLE ' +
    'OF WHAT REFUSES HERE.',
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
    'class `owned` on `identity_id` (`packages/db/src/scope.ts:886`). `db.firm` refuses that key ' +
    'at compile time because `FirmTableKey` is every key whose class is `firm` ' +
    '(`packages/db/src/scope.ts:1507-1509`), and `db.scoped` needs an identity THIS ROUTE CANNOT ' +
    'KNOW UNTIL IT HAS READ THE ROW: `:id` is `certificates.id` and the identity is a column of ' +
    'the row the door would be opened to read. `adminActions` is `firm` ' +
    '(`packages/db/src/scope.ts:1035`), so the audit half alone has a door and the subject half ' +
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
  // drives `requested --> approved` or `cooling --> approved`, and `:287-292`
  // puts `requested` and `cooling` both inside `OPEN_WITHDRAWAL_STATUSES` (the
  // array is `wallet-withdrawals.ts:288-293` since ADR-232 added an import
  // above it; it was :287-292, and :283-288 was the docblock above that), on
  // which `gateNoInFlight` refuses. So a wired endpoint writes a row nothing
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
    '`OPEN_WITHDRAWAL_STATUSES` (`routes/wallet-withdrawals.ts:288-293`) and `gateNoInFlight` ' +
    'refuses on the whole list. AND THE SENTENCE AFTER THAT ONE IS NOW WRONG TOO, WHICH MAKES ' +
    'FIVE CORRECTIONS TO THIS ENTRY AND IS ADR-234. It read that NOTHING IN THIS TREE reaches ' +
    '`settled`, `failed` or `cancelled`. Session 424 built `requested --> cancelled` and ' +
    '`cooling --> cancelled` under `G-TRADER-CANCELS`, guarded, with `0072` binding the arrow ' +
    "set at the database, and `withdrawalReleasesIdentity('cancelled')` is true, so ONE OF " +
    'THE THREE IS DRIVEN. What refuses NOW is that the edge that exists has NO DOOR and the ' +
    'two that would need one are unreachable. API_CONTRACT states in terms that "there is no ' +
    'endpoint that cancels a withdrawal" and names `G-TRADER-CANCELS` "as owed rather than ' +
    'invented", so a wired backend gives a trader a withdrawal they can open and no way to ' +
    'close; and `settled` and `failed` are drawn only out of `transferring`, which is reached ' +
    'by enqueueing on a rail that has no live adapter and no importer -- ' +
    '`TERMINAL_EDGE_FINDINGS` in `routes/wallet-withdrawals.ts` carries all three per status ' +
    'with the sources, and `wallet-withdrawals.test.ts` RUNS them rather than reading them. ' +
    'THE OBSTRUCTION IS THEREFORE ONE EDGE NARROWER THAN IT WAS AND IS STILL AN OBSTRUCTION. ' +
    'THE ENTRY SUPPLIES ITS OWN DECISION PROCEDURE AND RI-20 RUNS IT: ' +
    '`grep -rn driveApprovals apps/api/src` returns 3 lines, which are the transition and two ' +
    'references to it in docblocks, and no fourth line is a caller; ' +
    '`grep -rn driveCancellation apps/api/src` returns 3 lines, which are ADR-234 transition ' +
    'and two references to it in docblocks, and no fourth line is a caller either. Wiring it ' +
    'trades an honest ' +
    '503 for a permanent per-trader lockout, and only the 503 is reversible. TWO LINE NUMBERS ' +
    'IN THIS ENTRY WERE FALSE BY EIGHTEEN LINES WHEN ADR-176 CHECKED THEM, in the reason ' +
    'ADR-172 wrote one session earlier to replace a false one: line 1233 was the KYC term and ' +
    'line 1506 was a `.send(`. The CLAIMS held at their real lines and the CITATIONS did not, ' +
    'which is the same drift in its quietest form. THOSE TWO NUMBERS ARE WRITTEN OUT OF ' +
    'CITATION GRAMMAR ON PURPOSE: a `file:line` pointer is a claim about THIS tree, so a ' +
    'pointer quoted as HISTORY must not wear the shape that says follow me (ADR-212).',
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
  }).toStrictEqual({ declared: 24, wired: 8, blocked: 16 });
});
