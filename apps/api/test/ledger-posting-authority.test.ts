import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

// CI-02, the `unit` project.
//
// =============================================================================
// WHAT POSTS A LEDGER ENTRY, PINNED AT EACH SOURCE
// =============================================================================
// ADR-270. Two ports reduced to one question that the corpus had never answered
// in one place: if a ledger posting is not performed on the request path
// (ADR-172 clause 2) and not through a door `apps/api` may open (ADR-165), what
// performs it?
//
// THE ANSWER IS NOT A NEW AUTHORITY AND THAT IS THE POINT. `SystemReason` holds
// two words, one of them names a process a clock started, and `apps/worker`
// already holds a handle at that word. What this file asserts is the reasoning
// that gets from there to a ruling, so that a session moving any leg of it
// learns which ruling it is moving.
//
// THE RULE THIS FILE EXISTS TO KEEP TRUE, in one sentence: a posting may move to
// a clock exactly where the CHECK the corpus binds it to resolves no caller.
// `INV-M20-01` binds `LT-06` to a live POSITION, which is read off rows;
// `INV-M20-02` binds `LT-08` to the PAYING IDENTITY, which is the caller. The
// two sentences are three documents apart and the difference between them is
// the whole of why one leg can move and the other cannot.
//
// NOTHING HERE TOUCHES A DATABASE. Every case is a string read or a directory
// walk. This is `lt06-posting-timing.test.ts`'s idiom, applied one question up:
// that file holds a ruling about one leg against its sources, and this one holds
// the ruling about the authority all three legs are decided under.
// -----------------------------------------------------------------------------

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..', '..');

const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const SCOPED_DB = read('packages', 'db', 'src', 'scoped-db.ts');
const API_DB = read('apps', 'api', 'src', 'db.ts');
const API_START = read('apps', 'api', 'src', 'start.ts');
const LEDGER_TX = read('packages', 'ledger', 'src', 'tx.ts');
const WORKER_DB = read('apps', 'worker', 'src', 'db.ts');
const WORKER_INDEX = read('apps', 'worker', 'src', 'index.ts');
const WORKER_MANIFEST = read('apps', 'worker', 'package.json');
const API_MANIFEST = read('apps', 'api', 'package.json');
const ADMIN_PAYOUTS = read('apps', 'api', 'src', 'routes', 'admin-payouts.ts');
const PAYOUTS = read('apps', 'api', 'src', 'routes', 'payouts.ts');
const M05 = read('docs', 'plans', 'M05-payout-system.md');
const M20 = read('docs', 'plans', 'M20-wallet.md');
const WALLET_SQL = read('packages', 'db', 'migrations', '0011_wallet.sql');

/** Every `.ts` file under a directory, relative to the repository root. */
function walk(...parts: readonly string[]): readonly string[] {
  const base = join(ROOT, ...parts);
  const found: string[] = [];
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(join(entry.parentPath, entry.name));
    }
  }
  return found;
}

// -----------------------------------------------------------------------------
// Clause 1: neither refusal moves, and both are read rather than cited
// -----------------------------------------------------------------------------

test('ADR-165 clause 3 holds: `SystemReason` is still exactly two members', () => {
  expect(SCOPED_DB).toContain("export type SystemReason = 'nightly-batch' | 'operator-console';");
});

test('ADR-172 clause 2 holds: `ApiDb` declares no door that yields a system handle', () => {
  const doors = [...API_DB.matchAll(/^ {2}(\w+)<T>\(/gm)].map((m) => m[1]);
  expect(doors).toContain('scoped');
  expect(doors).toContain('firm');
  expect(doors).not.toContain('system');
  expect(doors).not.toContain('operator');
  expect(API_DB).toContain('THERE IS STILL NO `system(reason, fn)` HERE');
});

// -----------------------------------------------------------------------------
// Clause 2: the authority is chosen by who the transaction's opener serves
// -----------------------------------------------------------------------------

test('`packages/ledger` states the rule this entry generalises, in its own words', () => {
  expect(LEDGER_TX).toContain(
    'the reason is chosen by whoever opens the transaction,\n// which is the caller',
  );
});

test('the clock row: `apps/worker` spends `nightly-batch` at the call site and takes one door', () => {
  expect(WORKER_DB).toContain(
    "export const WORKER_REASON: SystemReason = 'nightly-batch' as const",
  );
  // One door, and the absence of a reason PARAMETER is what forecloses the other
  // word from this deployable by construction rather than by convention.
  expect(WORKER_DB).toMatch(/batch<T>\(fn: \(tx: SystemTx\) => Promise<T>\): Promise<T>;/);
  expect(WORKER_DB).not.toMatch(/reason: SystemReason\)/);
});

test('the operator row: the console arm holds a `LedgerTx` at a word that already exists', () => {
  expect(ADMIN_PAYOUTS).toContain('readonly ledger: LedgerTx;');
  expect(ADMIN_PAYOUTS).toContain('WHICH DOOR IS ASKING IS THE WHOLE OF THE DIFFERENCE.');
  // ADR-171 section 9's condition, recorded where the door would be declared.
  expect(API_DB).toContain("ADR-171 section 9's condition");
});

test('the trader row: the request path records and does not post, and `PayoutTx` carries no handle', () => {
  expect(PAYOUTS).toContain('`PayoutTx` USED TO CARRY A `LedgerTx` AND NO LONGER DOES');
  expect(PAYOUTS).not.toContain('readonly ledger: LedgerTx;');
});

// -----------------------------------------------------------------------------
// Clause 3: the pinned CHECK decides which row a posting belongs to
// -----------------------------------------------------------------------------

test('`LT-06`’s pinned check names a position and no caller', () => {
  expect(M20).toContain(
    'every debit is checked against the live position inside the same transaction',
  );
});

test('`LT-08`’s pinned check names the PAYING IDENTITY, which is the caller', () => {
  expect(M20).toContain(
    "The target account's ownership is resolved server side and compared to the paying identity, " +
      'in the same transaction as the debit.',
  );
  expect(M20).toContain(
    'M3 resolves target-account ownership server side and posts LT-08 in the purchase transaction',
  );
});

test('the corpus blesses a deferred posting once, in M05, and M20 has no such sentence', () => {
  expect(M05).toContain('Only the ledger posting is deferred');
  expect(M20).not.toContain('Only the ledger posting is deferred');
});

// -----------------------------------------------------------------------------
// Clause 5: what the request path records for a later door is already recorded
// -----------------------------------------------------------------------------

test('both legs already store the key a later door posts under, so nothing is added here', () => {
  expect(WALLET_SQL).toMatch(/idempotency_key\s+text NOT NULL,/);
  expect(PAYOUTS).toMatch(/interface PayoutRequestInsert[\s\S]*?readonly idempotencyKey: string;/);
});

// THE CLAIM IS ABOUT ADR-270 AND IT USED TO BE WRITTEN AS A CLAIM ABOUT THE
// ESTATE. It read "0074 is still the highest" and pinned the global maximum to
// prove a local absence, so it was destined to fail on the next migration
// whoever wrote it and for whatever reason: ADR-278's `0075` is the one that
// arrived, and it renames a column on `simulation_runs` with nothing to do with
// a ledger posting. Rewritten to assert what the sentence means. `0074` is
// still named, as the highest number ON THE DAY ADR-270 LANDED, which is a fact
// about that entry rather than a fact about every later one.
test('no migration is taken by this entry: none names ADR-270', () => {
  const dir = join(ROOT, 'packages', 'db', 'migrations');
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  expect(migrations).toContain('0074_firm_parameters.sql');
  const claiming = migrations.filter((name) =>
    readFileSync(join(dir, name), 'utf8').includes('ADR-270'),
  );
  expect(claiming).toEqual([]);
});

// -----------------------------------------------------------------------------
// Clause 6: three measured absences stand between the ruled authority and a
// posting, and not one of them is an authority
// -----------------------------------------------------------------------------

test('`apps/worker` cannot name the posting library, and `apps/api` is the only package that can', () => {
  expect(WORKER_MANIFEST).not.toContain('@merit/ledger');
  expect(API_MANIFEST).toContain('"@merit/ledger": "workspace:*"');
});

test('the worker posting ADR-172 finding 16 reports is a PORT and a sentence, not an adapter', () => {
  const callers = walk('apps', 'worker', 'src').filter((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .some((line) => line.includes('postTransaction(') && !line.trimStart().startsWith('*')),
  );
  expect(callers).toEqual([]);
  // What does exist is the port and the docstring naming the adapter in prose.
  expect(read('apps', 'worker', 'src', 'sweeps', 'ports.ts')).toContain(
    'postLt01(tx: ExpiryTx, values: Lt01Values): Promise<void>;',
  );
});

test('the worker runs one job and records that every other one is unscheduled', () => {
  expect(WORKER_INDEX).toContain('The job store is still not\n * installed');
});

test('no deployment of Merit can post a ledger entry: two call sites, both unwired', () => {
  const callers = [...walk('apps', 'api', 'src'), ...walk('apps', 'worker', 'src')]
    .filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some((line) => line.includes('postTransaction(') && !line.trimStart().startsWith('*')),
    )
    .map((path) => path.slice(ROOT.length + 1))
    .sort();
  expect(callers).toEqual([
    'apps/api/src/routes/admin-payouts.ts',
    'apps/api/src/routes/checkout.ts',
  ]);
  expect(API_START).not.toContain('useCheckoutBackend(');
  expect(API_START).not.toContain('useAdminPayoutBackend(');
});
