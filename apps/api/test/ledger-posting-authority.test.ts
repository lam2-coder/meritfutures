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
// Clause 6: absence 2 IS CLOSED and the property it was measuring is not, which
// is why these three cases are rewritten rather than deleted
// -----------------------------------------------------------------------------
// THIS CLAUSE READ "three measured absences stand between the ruled authority
// and a posting". ADR-305 section 7 slice 6 closed the second of them: the
// worker declares `@merit/ledger`, `apps/worker/src/sweeps/ledger.ts`
// discharges `ExpiryLedgerPort` and `postTransaction` now has a third caller in
// this estate. The three cases below went red on that change, in the order they
// are written, and each was seen red before it was touched.
//
// NOT ONE OF THEM IS DELETED AND NOT ONE IS LOOSENED TO A `toContain`, because
// what each was protecting outlives the absence it happened to measure:
//
//   1. WHICH DEPLOYABLES MAY NAME THE POSTING LIBRARY. The old case said
//      `apps/api` was the only one. That boundary was deliberately crossed, so
//      the case now pins the WHOLE admitted set from the manifests plus the
//      one file inside the worker that the grant reaches. A third deployable
//      taking the dependency, or a second file in the worker naming it, is red.
//
//   2. WHAT POSTS INSIDE `apps/worker`. `toEqual([])` becomes `toEqual([the
//      adapter])`: an EXACT list, so a fourth caller fails exactly as the first
//      one did. A `length` check or a substring would have retired the case.
//
//   3. THAT NO DEPLOYMENT CAN POST. The NAME of case 3 is still true after
//      slice 6 and that is the whole point: what moved is the LIST, not the
//      property. `UNWIRED_EXPIRY_SWEEP_IO` is still the default, nothing
//      constructs an `ExpirySweepIo`, and the adapter recovers its handle by
//      identity through `recordExpiryTransaction`, which HAS NO CALLER. So the
//      map is empty in every deployment and the third call site refuses every
//      handle it could be given. The `API_START` assertions are untouched.

test('exactly two deployables may name the posting library, and the worker grant reaches one file', () => {
  // ADR-305 SECTION 7 SLICE 6 CROSSED THE BOUNDARY THIS CASE USED TO ASSERT,
  // so the assertion is the whole admitted SET rather than one absence. It is
  // derived from the tree rather than listed, on `walk`'s own reasoning: a
  // sixth deployable added with the dependency already in it would pass a list
  // that named the five that existed when this was written.
  const admitted = readdirSync(join(ROOT, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => read('apps', name, 'package.json').includes('"@merit/ledger"'))
    .sort();
  expect(admitted).toEqual(['api', 'worker']);
  expect(WORKER_MANIFEST).toContain('"@merit/ledger": "workspace:*"');
  expect(API_MANIFEST).toContain('"@merit/ledger": "workspace:*"');

  // THE MANIFEST LINE GRANTS THE CAPABILITY TO A WHOLE DEPLOYABLE AND THIS IS
  // THE HALF THAT SAYS WHERE IT LANDED. ADR-165 set the pattern for `@merit/db`
  // at `src/db.ts` and `apps/worker/test/db.test.ts` runs it; this is the same
  // measurement for the posting library, and it lives here because this file is
  // where the authority question is held.
  const naming = walk('apps', 'worker', 'src')
    .filter((path) => readFileSync(path, 'utf8').includes("from '@merit/ledger'"))
    .map((path) => path.slice(ROOT.length + 1))
    .sort();
  expect(naming).toEqual(['apps/worker/src/sweeps/ledger.ts']);

  // AND `ports.ts` IS STILL NOT IT, which is what keeps ADR-315's ruling
  // standing: that file imports nothing, so `ExpiryTx` cannot grow a `ledger`
  // member without restating `LedgerTx` and dragging both excluded keys back
  // into the sweep's reach. THE ASSERTION IS ON THE IMPORT AND NOT ON THE NAME,
  // because that file's docblock QUOTES the package while refusing to import it
  // and the explanation has to stay writable.
  expect(read('apps', 'worker', 'src', 'sweeps', 'ports.ts')).not.toMatch(/from '@merit\/ledger'/);
});

test('the worker posting ADR-172 finding 16 reported is an ADAPTER now, and it is exactly one file', () => {
  const callers = walk('apps', 'worker', 'src')
    .filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some((line) => line.includes('postTransaction(') && !line.trimStart().startsWith('*')),
    )
    .map((path) => path.slice(ROOT.length + 1))
    .sort();
  // AN EXACT LIST AND NOT A LENGTH OR A SUBSTRING. `toEqual([])` was what made
  // the FIRST adapter fail this case; an exact list is what makes the SECOND
  // one fail it, and a `length` check would have made this case retire itself
  // the moment it was first turned.
  expect(callers).toEqual(['apps/worker/src/sweeps/ledger.ts']);
  // THE JOB IS NOT A CALLER AND MUST NOT BECOME ONE. `expiry.ts` calls the PORT
  // and the port is what keeps ledger arithmetic out of the sweep.
  expect(callers).not.toContain('apps/worker/src/sweeps/expiry.ts');
  // The port itself is unchanged, which is what the adapter had to satisfy.
  expect(read('apps', 'worker', 'src', 'sweeps', 'ports.ts')).toContain(
    'postLt01(tx: ExpiryTx, values: Lt01Values): Promise<void>;',
  );
});

test('the worker runs one job and records that every other one is unscheduled', () => {
  // **THIS CASE PINNED A SENTENCE AND THE SENTENCE WENT FALSE UNDERNEATH IT.**
  // It read `expect(WORKER_INDEX).toContain('The job store is still not\n *
  // installed')`, which asserts a string in a COMMENT and not a fact about the
  // tree: `0079_pgboss_job_store.sql` merged on 2026-09-03 and this case stayed
  // green over a claim that had become false. That is `ADR-324`'s finding one
  // row earlier, met again here, and it is what `ADR-326` was dispatched to
  // repair. **REWRITTEN AND NOT DELETED**, and rewritten so that each half is
  // derived from something a rename or a merge can move.
  //
  // HALF ONE: THE FACT THE OLD STRING DENIED, read at the migration directory.
  const store = readdirSync(join(ROOT, 'packages/db/migrations')).filter((file) =>
    /pgboss/i.test(file),
  );
  expect(store, 'no migration installs the pg-boss job store').toHaveLength(1);
  // ASSERTED OUTSIDE THE PARAGRAPH THAT RETIRES THE CLAIM, because `RI-14` keeps
  // a corrected sentence beside its correction and the barrel therefore QUOTES
  // the old wording on purpose. Splitting at the retirement marker is what makes
  // "the claim is gone" and "the record of it is kept" both assertable.
  const [beforeRetirement] = WORKER_INDEX.split('THIS PARAGRAPH READ');
  expect(
    WORKER_INDEX,
    'the barrel no longer records what it corrected, which RI-14 requires',
  ).toContain('THIS PARAGRAPH READ');
  expect(
    beforeRetirement,
    'the worker barrel still asserts the job store is not installed, and it is',
  ).not.toContain('The job store is still not');

  // HALF TWO: THE TITLE'S OWN CLAIM, read at the registry rather than at prose.
  // `apps/worker/src/schedule.ts` carries every job entry point this deployable
  // has built with its disposition, and exactly one CRON_INVENTORY row is
  // scheduled. A second job getting a clock turns this red, which is what the
  // sentence this case used to quote could never do.
  const registry = read('apps', 'worker', 'src', 'schedule.ts');
  const scheduled = [
    ...registry.matchAll(/cronRow: '([^']+)',\n\s*disposition: 'scheduled',/g),
  ].map((match) => match[1]);
  expect(scheduled.length, 'the registry parsed to no scheduled job at all').toBeGreaterThan(0);
  expect([...new Set(scheduled)]).toEqual(['nightly batch']);
  // AND THE REST ARE RECORDED RATHER THAN SILENT, which is ADR-305 slice 8's
  // stop condition: a job left off a clock is a decision somebody wrote down.
  expect(registry.split("disposition: 'unscheduled'").length - 1).toBeGreaterThan(scheduled.length);
});

test('no deployment of Merit can post a ledger entry: three call sites, all unwired', () => {
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
    'apps/worker/src/sweeps/ledger.ts',
  ]);
  expect(API_START).not.toContain('useCheckoutBackend(');
  expect(API_START).not.toContain('useAdminPayoutBackend(');

  // THE THIRD SITE'S UNWIRING, AT THE SAME RESOLUTION AS THE OTHER TWO. The
  // `apps/api` pair is unreachable because `start.ts` installs no backend; the
  // worker's is unreachable for a reason one level further in, and it is the
  // adapter's own mechanism rather than an omission. `postLt01` recovers its
  // `LedgerTx` by the IDENTITY of the `ExpiryTx` it is given (ADR-315), and the
  // only thing that records one is `recordExpiryTransaction`. NOTHING CALLS IT,
  // so the map is empty in every deployment of this code and every handle the
  // adapter could be given is refused.
  const recorders = walk('apps', 'worker', 'src')
    .filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some(
          (line) => line.includes('recordExpiryTransaction(') && !line.trimStart().startsWith('*'),
        ),
    )
    .map((path) => path.slice(ROOT.length + 1))
    .sort();
  expect(recorders).toEqual([]);
  // And the default `ExpirySweepIo` still refuses rather than serving.
  expect(read('apps', 'worker', 'src', 'sweeps', 'ports.ts')).toContain(
    "ledger: { postLt01: () => Promise.reject(new ExpirySweepUnwired('ledger.postLt01')) },",
  );
});
