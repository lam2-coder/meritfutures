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
// than missing adapters: a door `src/db.ts` declines to declare (ADR-120), a
// `SystemReason` that gains no member (ADR-165), a table absent from the
// registry, a vendor adapter that does not exist in this workspace. A test that
// demanded all twenty be wired would be a test somebody deletes.
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
// A NO-OP CALL IS NOT A WIRING, AND THREE PORTS MAKE THAT REACHABLE
// -----------------------------------------------------------------------------
// `useAffiliateDeps`, `useKycDeps` and `useCheckoutAdapters` already hold their
// PRODUCTION value at module scope (`affiliate.ts:478`, `kyc.ts:284`,
// `checkout.ts:1005`), so calling their setter from `start.ts` would install the
// object that is already installed and change nothing a request sees. It would
// also make this file pass. THE REASON TEXT IS WHERE THAT IS RECORDED, so a
// later reader raising the count that way meets the sentence saying it is not a
// wiring before they meet the green tick.
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
  // The operator door. `src/db.ts` declares `scoped` and `firm` and refuses a
  // third, and the refusal is a ruling: `SystemReason` is
  // `'nightly-batch' | 'operator-console'` (`packages/db/src/scoped-db.ts:197`),
  // a request handler is neither, and ADR-165 ruled it gains no member. Every
  // port below needs `systemDb('operator-console')`. Opening that door is an ADR
  // and not an adapter.
  // ---------------------------------------------------------------------------
  setAdminReadSource:
    "`systemDb('operator-console')`, which `src/db.ts` declines to declare (ADR-120), AND the " +
    'join and aggregate shapes the keyed accessor does not offer. The port names both itself, ' +
    'in the refusal at `routes/admin-reads.ts:696-705`.',
  setAdminSessionSource:
    'the same operator door. `AdminSessionLookup` resolves an `AdminPrincipal` from an operator ' +
    'session, and no door `ApiDb` declares reaches one: the refusal at ' +
    '`routes/admin-reads.ts:209-215` says a deployment without it "cannot tell an operator from ' +
    'anybody else".',
  useAdminPayoutBackend:
    "`operator()` at `systemDb('operator-console')` and `principal()` from the admin surface's " +
    "shared helper. Neither is this module's to build; `routes/admin-payouts.ts:418` declares " +
    'the port exactly as `admin-writes.ts` declares its own.',
  useAdminWalletBackend:
    'the same operator door and `principal()`, AND TWO METHODS THAT WIRING DOES NOT REACH. ' +
    '`writeCorrection` is refused on four constraints: `0038` is the built door for a wallet ' +
    'correction and ADR-158 never read it, so no column holds which entry a correction corrects. ' +
    '`reconcile` is refused on ADR-157 clause 6, which needs a join and an aggregate. Installing ' +
    'a backend would not resolve either finding and must not paper over them.',
  useAdminWriteBackend:
    'the operator door, `principal()`, `validatePlan` from `@merit/rules-engine` (which ' +
    '`apps/api` does not declare as a dependency), and `tradingDay()`. The last is the smallest ' +
    'and the least tractable: nothing in this workspace maps an instant to an exchange trading ' +
    'day, and ADR-145 names the gap rather than papering over it with a UTC date.',

  // ---------------------------------------------------------------------------
  // The ledger door, which is the same closed vocabulary reached from the money
  // path. `packages/ledger`'s `LedgerTx` is satisfied only by ADR-102's
  // `SystemTx`, which is opened at a `SystemReason`.
  // ---------------------------------------------------------------------------
  usePayoutBackend:
    '`PayoutTx.ledger` (`routes/payouts.ts:395`), which is a `LedgerTx` and is NOT NULLABLE, so ' +
    'no live deployment can supply a `PayoutBackend` at all. `LedgerTx` is satisfied only by ' +
    "ADR-102's `SystemTx` at a `SystemReason`, and ADR-165 refused to widen that vocabulary. " +
    '`databaseIdempotencyStore` already exists and satisfies the `idempotency` member alone.',
  useCheckoutBackend:
    '`CheckoutTx.insertAttribution` (`routes/checkout.ts:878`) writes `attributions`, which is ' +
    'scope class `pair` and which no authority in `packages/db` admits a request handler ' +
    "writing; and the wallet arm's `ledger` (`routes/checkout.ts:869`) is the same `LedgerTx` " +
    'ADR-165 declined to reach. The card arm alone would be a partial backend whose port ' +
    'promises the whole transaction.',
  useCheckoutAdapters:
    'a configured PSP adapter per MID plus the `returnUrl` and `cancelUrl` configuration. ' +
    '`packages/psp` ships a port and TWO FAKES (`fakes/psp-a.ts`, `fakes/psp-b.ts`) and no ' +
    'vendor adapter, and `packages/enrichment` is in the same position. NOTE: this port already ' +
    'holds `PRODUCTION_CHECKOUT_ADAPTERS` at module scope (`checkout.ts:1005`), so calling the ' +
    'setter here would install what is already installed. That would raise the wired count and ' +
    'serve nothing, and it is not a wiring.',

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
    'adapters for reads the accessor cannot reach. `AffiliateBackend` names four obstructions in ' +
    'its own defaults (`routes/affiliate.ts:432-450`): `affiliate_commissions` is UNREGISTERED ' +
    'in `packages/db/src/scope.ts` and its only path to an identity runs through `attributions`, ' +
    'which is `pair`; `affiliate_statements` is not in `schema.ts` at all; and no table records ' +
    'an ISSUED link. THREE of the six methods do have a door -- `affiliates` is `owned` -- and ' +
    'are an adapter somebody can write. NOTE: this port already holds ' +
    '`productionAffiliateDeps` at module scope (`affiliate.ts:478`), so calling the setter here ' +
    'would install what is already installed. That is not a wiring.',
  setEconomicCalendarSource:
    'TWO THINGS, AND THE FIRST IS A REGISTRY ENTRY RATHER THAN AN ADAPTER. The port reads ' +
    '`economic_calendar_current` and NEVER `economic_calendar` (`routes/economic-calendar.ts:188`), ' +
    'and that view is in neither `packages/db/src/schema.ts` nor `scope.ts`, so it is not a ' +
    '`TableKey` and no door can name it. Second, `freshness.stale` is decided against a ' +
    'CONFIGURED HORIZON that lives with the alarm and not in this deployable; a route that ' +
    'reached for a clock would compare a UTC date against an exchange trading day.',
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
  const accountedByPort = new Set(['databaseCertificateBackend', 'databaseIdempotencyStore']);
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
  }).toStrictEqual({ declared: 20, wired: 6, blocked: 14 });
});
