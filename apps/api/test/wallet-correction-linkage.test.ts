// =============================================================================
// apps/api/test/wallet-correction-linkage.test.ts
// =============================================================================
// WHETHER `0038` ALREADY HOLDS WHICH ENTRY A CORRECTION CORRECTS, AS PREDICATES
// RATHER THAN AS A SENTENCE INSIDE A REFUSAL MESSAGE.
//
// `useAdminWalletBackend`'s entry in `wiring.test.ts` said `writeCorrection` is
// refused because "`0038` is the built door for a wallet correction and ADR-158
// never read it, so no column holds which entry a correction corrects". Session
// 445 was dispatched to check it, because
// `0038_account_adjustments.sql:185` declares
// `reverses_adjustment_id uuid NULL REFERENCES account_adjustments(id)` and a
// linkage column sitting in plain sight under a reason that says none exists is
// exactly the shape `RI-14` was written for.
//
// THE ANSWER IS NEITHER OF THE TWO THE DISPATCH ANTICIPATED. The sentence is
// TRUE as a statement about the schema and it is STILL TRUE today; what is wrong
// is its JOB. `ADR-173` clause 3 ruled that no such column is owed, and
// `API_CONTRACT` carries that ruling in the endpoint's own row: "No column
// anywhere in the schema records which entry a correction corrects, and none is
// owed." So the entry named, as the thing that refuses the append, the ONE of
// session 298's four disagreements that `ADR-173` DISCHARGED, while the three
// that stand went unnamed under the word "four". `ADR-255`.
//
// AND `reverses_adjustment_id` IS NOT THE LINKAGE, ON THREE INDEPENDENT
// GROUNDS, WHICH IS WHY THE DISPATCH'S CHEAP READING IS REFUSED HERE RATHER
// THAN ACCEPTED. It points at `account_adjustments` and not at `wallet_entries`;
// `account_adjustments_debit_is_a_reversal` makes it present exactly on DEBITS,
// so a credit correction cannot carry one at all; and its subject is Merit
// undoing its own prior adjustment rather than an operator naming the entry they
// are repairing. It is not the discharge of the reason. IT IS ONE OF THE THREE
// BLOCKERS THAT SURVIVE, which is the opposite direction from the one the
// dispatch guessed.
//
// -----------------------------------------------------------------------------
// WHY IT READS SOURCE AS TEXT
// -----------------------------------------------------------------------------
// `checkout-backend-blockers.test.ts`'s own reason, one port over: the facts
// here are facts about DDL and about prose. A CHECK constraint and a migration
// column are erased before any value exists in this process, so there is nothing
// to import and assert against, and this suite has no database. `ADR-173` ruled
// against a live PostgreSQL and its findings 7 and 8 came off the catalog; what
// this file adds is that those findings STOP GOING STALE, because a comment
// cannot fail and a predicate that runs on every `CI-01` pass expires.
//
// EVERY CASE NAMES THE CLAUSE IT PINS, so a reader who turns one red learns
// which ruling they are moving rather than which string they broke.
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..', '..', '..');

const read = (...parts: readonly string[]): string => readFileSync(join(REPO, ...parts), 'utf8');

const MIGRATIONS = join(REPO, 'packages', 'db', 'migrations');

const migrationFiles = (): readonly string[] =>
  readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort();

const ADJUSTMENTS = read('packages', 'db', 'migrations', '0038_account_adjustments.sql');
const ADR_158 = read('docs', 'decisions', 'ADR-158.md');
const ADR_173 = read('docs', 'decisions', 'ADR-173.md');
const CONTRACT = read('docs', 'architecture', 'API_CONTRACT.md');
const HANDLER = read('apps', 'api', 'src', 'routes', 'admin-wallet.ts');
const WIRING = read('apps', 'api', 'test', 'wiring.test.ts');

/**
 * The declaration lines of every `CREATE TABLE` in a migration, which is the
 * only region where an identifier is a COLUMN. `0038` declares a plpgsql local
 * named `entries` at `:551` and a sweep that does not bound itself to the table
 * body reports it as a column, which is a false positive on the exact word this
 * file is about.
 */
function columnLines(sql: string): readonly string[] {
  const lines: string[] = [];
  let inTable = false;
  for (const line of sql.split('\n')) {
    if (/^CREATE TABLE\s/i.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^\);/.test(line)) {
      inTable = false;
      continue;
    }
    if (inTable) lines.push(line);
  }
  return lines;
}

/**
 * The `useAdminWalletBackend` reason as PROSE. The entry is a chain of string
 * literals, so a phrase that reads continuously in the message is split by `' +`
 * and a newline in the file; asserting against the raw slice would pass or fail
 * on where prettier happened to wrap. The concatenation joins are removed and
 * nothing else is.
 */
function walletEntryProse(): string {
  const slice = WIRING.slice(
    WIRING.indexOf('  useAdminWalletBackend:'),
    WIRING.indexOf('  useAdminWriteBackend:'),
  );
  return slice.replace(/'\s*\+\s*\n\s*'/g, '');
}

// -----------------------------------------------------------------------------
// GROUND 1. THE COLUMN THE DISPATCH FOUND POINTS AT THE WRONG TABLE
// -----------------------------------------------------------------------------

describe('`reverses_adjustment_id` is not the linkage the reason says is missing', () => {
  it('ADR-255 ground 1: it references `account_adjustments`, and the corrected entry lives in `wallet_entries`', () => {
    // Derived rather than typed: the target is read OUT of the declaration, so
    // a superseding migration that re-points it turns this red instead of
    // leaving a sentence behind that describes the old target.
    const declaration = /reverses_adjustment_id\s+uuid\s+NULL\s+REFERENCES\s+(\w+)\((\w+)\)/.exec(
      ADJUSTMENTS,
    );
    expect(declaration).not.toBeNull();
    expect([declaration?.[1], declaration?.[2]]).toEqual(['account_adjustments', 'id']);
    // AN ADJUSTMENT IS NOT AN ENTRY. `corrects_entry_id` is a `wallet_entries`
    // id: the contract's `evidence_refs` names it `kind: 'wallet_entry'`, and
    // the handler's `conflict` check resolves it against this identity's own
    // wallet rows. A pointer between two `account_adjustments` rows cannot hold
    // it whatever it is named.
    expect(declaration?.[1]).not.toBe('wallet_entries');
  });

  it('ADR-255 ground 2: it exists exactly on DEBITS, so a credit correction cannot carry one', () => {
    // `account_adjustments_debit_is_a_reversal` is a BICONDITIONAL. A credit
    // adjustment with a `reverses_adjustment_id` is not writable, and the
    // reconciliation credit that repairs a trader's balance is a credit. So
    // even at the wrong grain the column is unavailable to the case the reason
    // is about.
    expect(ADJUSTMENTS).toContain("(direction = 'debit') = (reverses_adjustment_id IS NOT NULL)");
  });

  it('ADR-255 ground 3: its subject is a reversal of a prior adjustment, which is a different fact', () => {
    // The migration says what the column is FOR in its own words, one line
    // above the declaration, and it is not "which entry this corrects".
    expect(ADJUSTMENTS).toContain('-- THE ONLY DEBIT THAT EXISTS. Header item 2.');
    // And the reversal is sound only against another ADJUSTMENT, at the same
    // identity, destination and cents. `assert_adjustment_reversal_is_sound`
    // reads `account_adjustments` and never reaches a wallet entry.
    expect(ADJUSTMENTS).toContain('WHERE id = NEW.reverses_adjustment_id');
  });
});

// -----------------------------------------------------------------------------
// GROUND 4. THE SCHEMA HALF OF THE REASON IS STILL TRUE, AND STAYS MEASURED
// -----------------------------------------------------------------------------

describe('no column anywhere holds which entry a correction corrects', () => {
  it('ADR-173 finding 7, re-derived statically: nothing in the migration set references `wallet_entries`', () => {
    // ADR-173 executed this against a live catalog with `0001` through `0051`
    // applied and got zero rows. The corpus is at 67 migrations now and the
    // catalog is not available to this suite, so the same claim is re-derived
    // over the DDL. THE DAY A FOREIGN KEY TO `wallet_entries` LANDS, THIS CASE
    // IS THE ONE THAT SAYS SO.
    const referencing = migrationFiles().filter((file) =>
      /REFERENCES\s+wallet_entries/i.test(readFileSync(join(MIGRATIONS, file), 'utf8')),
    );
    expect(referencing).toEqual([]);
  });

  it('ADR-173 finding 8, re-derived statically: no COLUMN in any table names a corrected entry', () => {
    // The two the live catalog found are still the two. Neither is a wallet
    // reference: `is_corrected` is a flag on a fill and `entry_fills` is an
    // array on a round trip. A THIRD NAME HERE IS EITHER THE COLUMN THIS REASON
    // SAYS IS MISSING OR A NEW FALSE POSITIVE, and both are worth a read.
    const named: string[] = [];
    for (const file of migrationFiles())
      for (const line of columnLines(readFileSync(join(MIGRATIONS, file), 'utf8'))) {
        const column = /^\s{2,}([a-z_]+)\s+[a-z]/.exec(line)?.[1];
        if (column !== undefined && /corrects|corrected|(^|_)entry|(^|_)entries/.test(column))
          named.push(`${file}:${column}`);
      }
    expect(named.sort()).toEqual([
      '0013_ingest.sql:is_corrected',
      '0022_analytics_journal.sql:entry_fills',
    ]);
  });

  it('and ADR-173 clause 3 ruled that none is owed, which the contract now carries', () => {
    // THIS IS THE HALF THE ENTRY LOST. The absence is a DECISION recorded in
    // the file that would have carried the column, not an oversight waiting on
    // a migration. A successor who reads only the reason takes `0075` for a
    // column two documents already refused.
    expect(CONTRACT).toContain(
      'No column anywhere in the schema records which entry a correction corrects, and none is owed.',
    );
    expect(ADR_173).toContain(
      'It was considered and refused, in writing, in the file that would have carried it',
    );
  });
});

// -----------------------------------------------------------------------------
// GROUND 5. THE REASON'S OWN CLAIM ABOUT ADR-158, WHICH IS CHECKABLE
// -----------------------------------------------------------------------------

describe("the reason's claim that ADR-158 never read `0038`", () => {
  it('ADR-255 section 3: is TRUE, and being true is why the sentence misleads', () => {
    // Eighteen findings written from `0011` alone. The door was one migration
    // away and no finding opened it, which is the fact `ADR-173` opens with.
    for (const name of ['0038', 'account_adjustments', 'reverses_adjustment_id'])
      expect({ name, inAdr158: ADR_158.includes(name) }).toEqual({ name, inAdr158: false });
    // AND THE SAME GREP OVER ADR-173 IS THE CONTROL. A pair of assertions where
    // one side can never fire is a guard with nothing to find, so the absence
    // above is only worth reading beside a presence.
    expect(ADR_173.includes('0038_account_adjustments.sql')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// GROUND 6. WHAT ACTUALLY REFUSES `writeCorrection`, AND THE ENTRY THAT SAYS SO
// -----------------------------------------------------------------------------

describe('the entry names the three that stand rather than the one that was ruled', () => {
  it('ADR-173 clause 6: one of session 298`s four is RULED and three STAND', () => {
    // Sliced out of the clause 6 table rather than typed, so an entry that
    // later rules a second one moves this count instead of leaving a "three"
    // behind in prose.
    const table = ADR_173.slice(
      ADR_173.indexOf("| # | Session 298's finding | After this entry |"),
      ADR_173.indexOf('So the append is still unwritable'),
    );
    expect(table).not.toBe('');
    const verdicts = [...table.matchAll(/\*\*(RULED|STANDS)[.,]/g)].map((match) => match[1]);
    expect(verdicts).toEqual(['RULED', 'STANDS', 'STANDS', 'STANDS']);
  });

  it('and the handler has named the same three all along, which is where the entry drifted from', () => {
    // `admin-wallet.ts` is the file that stopped the write and it has been
    // right since session 298. The entry beside it was not.
    expect(HANDLER).toContain('ITEM 1 IS REPAIRED HERE AND ITEMS 2, 3 AND 4 ARE NOT');
    expect(HANDLER).toContain('the rulings it is waiting on are items 2, 3\n// and 4 above');
  });

  it('ADR-255: the narrowed entry names all three survivors', () => {
    const entry = walletEntryProse();
    expect(entry).not.toBe('');
    // The three, each in the vocabulary of the constraint that refuses it, so
    // the entry can be checked against the DDL rather than against a mood.
    expect(entry).toContain('account_adjustments_debit_is_a_reversal');
    expect(entry).toContain('dual_control_approvals');
    expect(entry).toContain('reason_code');
    // AND `reconcile`'s blocker is untouched by this row.
    expect(entry).toContain('ADR-157 clause 6');
  });

  it("ADR-255: and it keeps the old clause as history rather than deleting it, on RI-14's rule", () => {
    const entry = walletEntryProse();
    // A false sentence deleted leaves nothing for the next reader to check, and
    // this one is not even false: it is a true sentence doing a job that was
    // ruled away from it. Deleting it would invite a sixth session to
    // rediscover `reverses_adjustment_id` and reach the dispatch's own reading.
    // RI-14's own marker vocabulary, matched the way RI-14 matches it, so the
    // entry cannot satisfy this case in a spelling that invariant would not
    // accept.
    expect(entry).toMatch(/it read\b/i);
    expect(entry).toMatch(/was true when/i);
    // The clause must no longer be stated AS the refusal.
    expect(entry).not.toContain('is refused on four constraints');
  });
});
