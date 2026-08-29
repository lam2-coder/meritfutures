import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

// CI-02, the `unit` project.
//
// =============================================================================
// THE THREE THINGS THAT REFUSE `POST /checkout`, EACH PINNED AT ITS OWN PRIMARY
// SOURCE RATHER THAN AT THE SENTENCE THAT DESCRIBES IT
// =============================================================================
// `useCheckoutBackend`'s entry in `wiring.test.ts` has lost its LEAD blocker
// twice in one week, to ADR-230 and to ADR-233, and the route answered 503 after
// each. Both times the clause that went stale was PROSE, and prose is what a
// successor inherits: a session dispatched to remove what the entry named would
// have removed it and found the route still refusing.
//
// SO THIS FILE ASSERTS THE BLOCKERS RATHER THAN DESCRIBING THEM. ADR-238 rules
// all three, and every clause of that ruling has a case here reading the file
// the clause is about. The day a door lands, the case for it turns red and the
// session that landed it is the one holding the entry.
//
// -----------------------------------------------------------------------------
// WHY IT READS SOURCE AS TEXT, WHICH IS UNUSUAL AND DELIBERATE
// -----------------------------------------------------------------------------
// The three blockers are facts about SOURCE TEXT rather than about values:
// which classes `scope.ts` assigns, how many words `SystemReason` holds, which
// keys `CATALOG_TABLE_KEYS` lists, and in what ORDER `checkout.ts` calls its
// port. A registry rule and a union of two string literals are both erased
// before a value exists, so there is nothing to import and assert against, and
// the ordering of two calls inside a handler is not observable from outside it
// without a database. Reading the file is the observation that is available,
// and it is `wiring.test.ts`'s own answer to the same problem: that file reads
// `start.ts` as text because "there is no way to ask the module graph 'which
// setters were called'". `packages/ledger`'s suite reads
// `packages/db/src/scoped-db.ts` for the same reason one package over.
//
// EVERY CASE NAMES THE CLAUSE IT PINS, so a reader who turns one red learns
// which ruling they are moving rather than which string they broke.
// -----------------------------------------------------------------------------

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..', '..');

const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const CHECKOUT = read('apps', 'api', 'src', 'routes', 'checkout.ts');
const API_DB = read('apps', 'api', 'src', 'db.ts');
const SCOPE = read('packages', 'db', 'src', 'scope.ts');
const SCOPED_DB = read('packages', 'db', 'src', 'scoped-db.ts');
const LEDGER_TX = read('packages', 'ledger', 'src', 'tx.ts');
const ATTRIBUTION = read('packages', 'affiliate', 'src', 'attribution.ts');
const M20 = read('docs', 'plans', 'M20-wallet.md');

// -----------------------------------------------------------------------------
// BLOCKER 1. A CAP WITH NO SOURCE. ADR-238 ruling 1
// -----------------------------------------------------------------------------

test('ADR-238 ruling 1: `accountCap()` takes no plan, and that is the shape the ruling keeps', () => {
  // A parameter added here is a session choosing to answer a per-identity
  // question with a per-plan-version number, which ruling 1 refuses in all
  // three of its available forms. If this line moved, read section 3.
  expect(CHECKOUT).toContain('  accountCap(): Promise<AccountCapRow>;');
});

test('ADR-238 ruling 1: the cap is checked before any plan version is in hand, on both paths', () => {
  // The purchase path resolves a version straight after the cap gate and the
  // reset path resolves the account's PINNED version, which may have been
  // retired years earlier. Both orderings are load bearing for ruling 1 and
  // neither is an accident: see section 3.
  const purchaseCap = CHECKOUT.indexOf('const cap = await tx.accountCap();');
  const publishedPlan = CHECKOUT.indexOf('await tx.publishedPlanVersion(body.plan_id)');
  const resetCap = CHECKOUT.indexOf('const cap = await tx.accountCap();', purchaseCap + 1);
  const resetTarget = CHECKOUT.indexOf('await tx.resetTarget(accountId)');

  expect(purchaseCap).toBeGreaterThan(-1);
  expect(resetCap).toBeGreaterThan(purchaseCap);
  expect(publishedPlan).toBeGreaterThan(purchaseCap);
  expect(publishedPlan).toBeLessThan(resetCap);
  expect(resetTarget).toBeGreaterThan(resetCap);
});

test('ADR-238 ruling 1: one migration line DECLARES an account cap and it is the per-entity exception', () => {
  // THIS CASE WAS WATCHED RED BY ADR-252 AND IS STRENGTHENED RATHER THAN
  // RELAXED TO PASS. It read every line CONTAINING `max_accounts`, including
  // comment lines, so `0074`'s header -- which recites the exception in order to
  // say what it is an exception to -- took it from 1 to 9. A count of MENTIONS
  // was never the claim; the claim is that exactly one line of DDL declares an
  // account cap column and it is the per-entity exception, and stripping
  // comments is what asks that question. A prose rewrite of any migration now
  // moves this case by zero.
  const lines = declaringLinesMatching('max_accounts');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('0002_identity.sql');
  expect(lines[0]).toContain('max_accounts_override');
});

test('ADR-238 ruling 1: no migration declares the BASE cap under the name the corpus gives it', () => {
  // `limits.max_accounts_per_entity` is a leaf of the `plan_versions.rules`
  // jsonb and NO COLUMN MATERIALIZES IT, which is why ruling 1 had somewhere to
  // stand and why ADR-252 did not build one under that name either. Red under
  // the mention-counting form for the same reason as the case above: `0074`'s
  // header names the leaf it is refusing.
  expect(declaringLinesMatching('max_accounts_per_entity')).toHaveLength(0);
});

test('ADR-252: the base cap has a home, in exactly one migration, and it is not a column name', () => {
  // THE DISCHARGED HALF OF CLAUSE 1, ASSERTED SO THAT ITS RETURN IS LOUD.
  // `base_account_cap` is a MEMBER of a closed vocabulary rather than a column,
  // which is the whole difference between a firm parameter row and the settings
  // bag `wiring.test.ts`'s entry warns about.
  const declaring = declaringLinesMatching('base_account_cap');
  expect(declaring.every((l) => l.startsWith('0074_firm_parameters.sql:'))).toBe(true);
  expect(declaring.some((l) => l.includes("parameter IN ('base_account_cap')"))).toBe(true);
  expect(declaringLinesMatching('base_account_cap integer')).toHaveLength(0);
});

test('ADR-252: what still refuses the cap is the catalogue door, and the list has not moved', () => {
  // THE NARROWED HALF. `accountCap()` is a `CheckoutTx` method and a scoped
  // transaction refuses every firm key outside `CATALOG_TABLE_KEYS`. The day
  // this key joins that list is the day the clause changes again, and this case
  // is what turns red on it.
  expect(SCOPED_DB).not.toContain('firmParameters');
  expect(SCOPED_DB).toContain("export const CATALOG_TABLE_KEYS = [\n  'coupons',");
});

test('ADR-252: the table ships empty, so an absent row is what any reader will meet', () => {
  // NO SEED ANYWHERE IN THE SET AND NO WRITER IN ANY `src/`. The trap the row
  // named first is that an implementation folds that absence into an unlimited
  // cap; nothing here can assert what an unwritten reader does, and this is the
  // fact that reader will meet.
  expect(declaringLinesMatching('INSERT INTO firm_parameters')).toHaveLength(0);
  expect(CHECKOUT).toContain('AN ABSENT ROW IS NO CAP AND IT IS NOT AN');
});

// -----------------------------------------------------------------------------
// BLOCKER 2. A CROSS-IDENTITY READ. ADR-238 ruling 2, refusing it a second time
// -----------------------------------------------------------------------------

test('ADR-238 ruling 2: the rows the buyer would have to read still belong to the affiliate', () => {
  expect(SCOPE).toContain("  affiliates: {\n    class: 'owned',\n    column: 'identity_id',");
  expect(SCOPE).toContain("  affiliateClicks: {\n    class: 'derived',\n    via: 'affiliates',");
});

test('ADR-238 ruling 2: the catalogue door ADR-233 built does not reach either table', () => {
  const list = SCOPED_DB.slice(
    SCOPED_DB.indexOf('export const CATALOG_TABLE_KEYS = ['),
    SCOPED_DB.indexOf('] as const satisfies readonly FirmTableKey[];'),
  );
  expect(list).not.toContain('affiliates');
  expect(list).not.toContain('affiliateClicks');
  expect(list).toContain("'coupons'");
});

test('ADR-238 ruling 2: the fold still needs the affiliate IDENTITY and not only the affiliate', () => {
  // The remedy ruling 2 names is a door that resolves the affiliate INSIDE
  // `packages/db` and hands the handler one bit rather than a uuid. It is not
  // available while `AffiliateRef` carries `identityId`, and `packages/affiliate`
  // is outside this session's fence, which is why the blocker survives the
  // ruling that names its remedy.
  expect(ATTRIBUTION).toContain('export interface AffiliateRef {');
  expect(ATTRIBUTION).toContain('  readonly identityId: string;');
  expect(ATTRIBUTION).toContain('if (buyerIdentityId === affiliate.identityId) {');
});

// -----------------------------------------------------------------------------
// BLOCKER 3. THE LEDGER ARM. ADR-238 ruling 3, and it is not this session's
// -----------------------------------------------------------------------------

test('ADR-238 ruling 3: the reason vocabulary is still two words and neither is a checkout', () => {
  expect(SCOPED_DB).toContain("export type SystemReason = 'nightly-batch' | 'operator-console';");
});

test('ADR-238 ruling 3: this deployable still declares no door that yields a `SystemTx`', () => {
  // `apps/api` HAS declared `@merit/db` since ADR-120, so the refusal is not a
  // manifest fact and asserting one would be asserting a sentence this session
  // found false in `checkout.ts` twice. What refuses is the DOOR SET: `ApiDb`
  // names six and none of them takes a `SystemReason`.
  const doors = API_DB.slice(
    API_DB.indexOf('export interface ApiDb {'),
    API_DB.indexOf('\n}', API_DB.indexOf('export interface ApiDb {')),
  );
  expect(doors).toContain('scoped<T>(');
  expect(doors).toContain('firm<T>(');
  expect(doors).not.toMatch(/\bsystem\s*</);
  expect(API_DB).not.toContain('systemDb,');
});

test('ADR-238 ruling 3: `FirmTx` cannot serve the posting because both ledger tables are `derived`', () => {
  // This is `packages/ledger`'s own stated finding, pinned here because it is
  // the half that makes ADR-233's catalogue trick unavailable to the posting:
  // that door reads `firm` rows, and these two are not `firm`.
  expect(LEDGER_TX).toContain('export interface LedgerTx {');
  expect(SCOPE).toContain("  ledgerTransactions: {\n    class: 'derived',");
  expect(SCOPE).toContain("  ledgerEntries: {\n    class: 'derived',");
});

test('ADR-238 ruling 3: the corpus requires the posting INSIDE the purchase transaction', () => {
  // ADR-176 cleared the same obstruction for `LT-01` by moving the posting out
  // of the request path. That remedy does not transfer, and this is the line
  // that forecloses it: M20 pins `LT-08` to the purchase transaction, and
  // DEP-M20-02 names the consequence of moving it.
  expect(M20).toContain('LT-08 posted in the same transaction as the purchase');
  expect(M20).toContain('posts LT-08 in the purchase transaction');
});

// -----------------------------------------------------------------------------
// The one helper, kept at the bottom because the cases are the subject
// -----------------------------------------------------------------------------

/**
 * Every migration line containing `needle`, prefixed by its file name.
 *
 * IT WALKS THE DIRECTORY RATHER THAN SHELLING OUT, so the assertion holds on a
 * runner with no `grep` and cannot be defeated by a quoting mistake. `RI-20`
 * runs the shell form against the reason text; this is the same question asked
 * by the suite.
 */
/**
 * Every migration line containing `needle` OUTSIDE a comment, prefixed by its
 * file name.
 *
 * WHY THE COMMENT-STRIPPING FORM EXISTS, AND IT IS A REPAIR RATHER THAN A
 * CONVENIENCE. IT REPLACES A `migrationLinesMatching` THAT COUNTED EVERY LINE
 * CONTAINING A NEEDLE, comments included, and a migration that explains what it
 * is superseding mentions the thing it supersedes. `0074`'s
 * header recites `max_accounts_override` in order to say what the new row is an
 * exception TO, and that took a case asserting "one line declares an account
 * cap" from 1 to 9 without a single column changing. The claim was always about
 * DDL and this is the form that asks it.
 *
 * A `COMMENT ON` BODY IS DOCUMENTATION TOO AND IS DROPPED WITH THE REST, which
 * this helper learned the same way: `0074`'s `COMMENT ON COLUMN` says which
 * number the new row is the base of, and that recital is prose whether it is
 * carried in a `--` line or in a string literal a statement stores. The
 * distinction the cases want is DDL versus documentation and not which syntax
 * the documentation used.
 *
 * IT STRIPS `--` TO END OF LINE AND NOTHING CLEVERER, so a `--` inside a
 * surviving literal would truncate that line early. Stated rather than handled:
 * the alternative is a SQL parser in a test helper, and a truncation makes this
 * report FEWER lines, which fails an existence case rather than passing a
 * non-existence one.
 */
function declaringLinesMatching(needle: string): readonly string[] {
  const dir = join(ROOT, 'packages', 'db', 'migrations');
  const hits: string[] = [];
  for (const name of readdirSyncSorted(dir)) {
    let inComment = false;
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const code = line.split('--')[0] ?? '';
      const ends = code.trimEnd().endsWith(';');
      if (inComment) {
        if (ends) inComment = false;
        continue;
      }
      if (/^\s*COMMENT\s+ON\s/i.test(code)) {
        inComment = !ends;
        continue;
      }
      if (code.includes(needle)) hits.push(`${name}: ${code.trim()}`);
    }
  }
  return hits;
}

function readdirSyncSorted(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}
