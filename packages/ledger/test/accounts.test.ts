// =============================================================================
// packages/ledger/test/accounts.test.ts
// =============================================================================
// THE THIRD COPY OF THE VOCABULARY IS CHECKED AGAINST THE OTHER TWO.
//
// The migration set declares the codes as a CHECK constraint and declares them
// again inside `LEDGER-C2`'s trigger body -- its own two-statements-of-one-fact,
// accepted there because "a FK to a table whose own CHECK could be dropped in a
// later migration is a guarantee with a dependency". `accounts.ts` is a third.
// It earns its place only while these assertions hold, and the day somebody adds
// a class to one of the three this file names which one disagrees.
//
// -----------------------------------------------------------------------------
// THIS FILE READ TWO MIGRATIONS BY NAME AND THAT WAS A DEFECT (ADR-187)
// -----------------------------------------------------------------------------
// It read `0009_ledger.sql` for the CHECK and `0027_triggers_invariants.sql` for
// the trigger body. Neither guard can be extended in place: a CHECK moves by
// DROP and re-ADD under one name and a function moves by CREATE OR REPLACE, so
// THE STATEMENT THE DATABASE HAS IS THE LAST ONE INSTALLED, WHATEVER FILE
// INSTALLED IT. `0056` supersedes both. Read by file name, this file would have
// gone on asserting that `accounts.ts` equals a vocabulary the database no
// longer enforces, and it would have stayed GREEN while doing it -- which is the
// exact failure `packages/rail/test/lt-07.test.ts` records against itself ("a
// watcher pinned to file names watches those files and not the claim") and which
// `chart-of-accounts-kinds.test.ts` and `in-flight-obligation.test.ts` each
// repaired for the KIND constraint and neither repaired for the CODE vocabulary.
//
// Both anchors are now resolved across the whole migration set, in application
// order, and the LAST occurrence wins. A slice that finds nothing throws rather
// than looping over an empty list, because a `for` over `[]` passes.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  LEDGER_ACCOUNT_CODES,
  LEDGER_ACCOUNT_SCOPE,
  accountKey,
  firmAccount,
  identityAccount,
  identityOf,
} from '../src/accounts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'db', 'migrations');
const read = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');

/** Every migration, in the order the runner applies them. */
const FILES: readonly string[] = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/**
 * The LAST migration whose text carries `anchor`, which is the one that
 * installed the statement the database is running.
 *
 * The file name is returned beside the text so a failure names the migration a
 * reader has to open, rather than leaving them to find it.
 */
function inForce(anchor: string): readonly [string, string] {
  const found = FILES.filter((file) =>
    read(file)
      .replace(/--[^\n]*/g, '')
      .includes(anchor),
  );
  if (found.length === 0) throw new Error(`no migration carries ${anchor}`);
  const last = found[found.length - 1] as string;
  return [last, read(last)];
}

const [CODE_CHECK_FILE, CODE_CHECK_SQL] = inForce(
  'ADD CONSTRAINT ledger_accounts_code_is_declared',
);
const [CLASS_TRIGGER_FILE, CLASS_TRIGGER_SQL] = inForce('IF acct_code NOT IN');

/**
 * Every single-quoted literal inside the named parenthesised block, in order.
 *
 * COMMENTS COME OFF FIRST AND NOT LAST, which is `chart-of-accounts-kinds.test.ts`'s
 * documented rule and which this function did NOT follow. It stripped them from
 * the SLICE and anchored on the RAW text, so a migration header that quotes its
 * own anchor while explaining itself -- which `0056`'s does, in the sentence
 * saying why the `NOT IN` shape is preserved -- anchored the slice in the prose
 * and read the argument instead of the statement. Watched: the read returned an
 * empty list and the case failed loudly rather than passing on nothing.
 */
function quotedLiteralsAfter(raw: string, anchor: string): string[] {
  const sql = raw.replace(/--[^\n]*/g, '');
  const at = sql.indexOf(anchor);
  if (at < 0) throw new Error(`the migration no longer contains ${anchor}`);
  const open = sql.indexOf('(', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`unbalanced parentheses after ${anchor}`);
  // The comments are already gone: they came off the whole file above, before
  // the anchor was looked for, which is the half this function used to get
  // backwards. `0009`'s list carries a `-- per identity` comment on three of its
  // lines and `0056`'s carries one on four, and a comment holding an apostrophe
  // would otherwise be read as a literal.
  return [...sql.slice(open, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

describe('the v1 classes, checked against both migrations that declare them IN FORCE', () => {
  test('the CHECK, LEDGER-C2 and this package name the same codes', () => {
    const inCheck = quotedLiteralsAfter(
      CODE_CHECK_SQL,
      'ADD CONSTRAINT ledger_accounts_code_is_declared',
    );
    const inTrigger = quotedLiteralsAfter(CLASS_TRIGGER_SQL, 'IF acct_code NOT IN');

    // THE COUNT IS DERIVED FROM THE PACKAGE AND NOT TYPED. It used to read
    // `.toBe(7)`, which is a number a reader has to keep true by hand in a file
    // whose whole subject is that hand-kept copies drift. What the case is
    // holding is that the three statements agree, and the cardinality is
    // asserted once, in `in-flight-obligation.test.ts`'s count-claim registry.
    expect(inCheck.length, `${CODE_CHECK_FILE} declares the whole vocabulary`).toBe(
      LEDGER_ACCOUNT_CODES.length,
    );
    expect([...inCheck].sort()).toEqual([...LEDGER_ACCOUNT_CODES].sort());
    expect([...inTrigger].sort(), CLASS_TRIGGER_FILE).toEqual([...LEDGER_ACCOUNT_CODES].sort());
  });

  test('the codes are declared in the order the CHECK in force declares them, so a diff reads the same way', () => {
    const inCheck = quotedLiteralsAfter(
      CODE_CHECK_SQL,
      'ADD CONSTRAINT ledger_accounts_code_is_declared',
    );
    expect(LEDGER_ACCOUNT_CODES).toEqual(inCheck);
  });

  // THE SUPERSESSION IS ASSERTED RATHER THAN ASSUMED. If `0056` is ever reverted
  // or a later migration re-declares the vocabulary, these two names move, and a
  // reader of a failure above needs to know which file the vocabulary came out
  // of. This case is why the two `inForce` reads cannot silently resolve to a
  // migration nobody expected.
  test('the vocabulary in force comes from a migration that supersedes 0009 and 0027', () => {
    expect(FILES).toContain(CODE_CHECK_FILE);
    expect(FILES).toContain(CLASS_TRIGGER_FILE);
    expect(CODE_CHECK_FILE >= '0009_ledger.sql').toBe(true);
    expect(CLASS_TRIGGER_FILE >= '0027_triggers_invariants.sql').toBe(true);
  });

  // THE SCOPE PARTITION IS THIS PACKAGE'S OWN AND THE DDL DOES NOT CARRY IT.
  // What the DDL carries is the vocabulary `scope` is constrained to, and this
  // asserts that the two words this file partitions by are exactly that
  // vocabulary -- so a third scope word arriving in a migration turns this red
  // rather than leaving a class silently unclassified.
  test('the two scope words are exactly the ones 0009 constrains `scope` to', () => {
    const declared = quotedLiteralsAfter(
      read('0009_ledger.sql'),
      'scope        text NOT NULL CHECK',
    );
    expect([...declared].sort()).toEqual(['firm', 'identity']);
    expect([...new Set(Object.values(LEDGER_ACCOUNT_SCOPE))].sort()).toEqual(['firm', 'identity']);
  });

  test('every code is partitioned, and the two positions 0009 refused to collapse are both here', () => {
    for (const code of LEDGER_ACCOUNT_CODES) {
      expect(LEDGER_ACCOUNT_SCOPE[code], code).toMatch(/^(firm|identity)$/);
    }
    expect(LEDGER_ACCOUNT_SCOPE.trader_withdrawable).toBe('identity');
    expect(LEDGER_ACCOUNT_SCOPE.trader_wallet).toBe('identity');
    expect(LEDGER_ACCOUNT_SCOPE.promotional_credit).toBe('identity');
  });

  // 0009's own argument for the two partial unique indexes, restated as the key.
  test('the account key is the pair the two partial unique indexes make unique', () => {
    expect(accountKey(firmAccount('reserve'))).toBe(accountKey(firmAccount('reserve')));
    expect(accountKey(identityAccount('trader_wallet', 'A'))).not.toBe(
      accountKey(identityAccount('trader_wallet', 'B')),
    );
    expect(accountKey(identityAccount('trader_wallet', 'A'))).not.toBe(
      accountKey(identityAccount('trader_withdrawable', 'A')),
    );
    expect(accountKey(firmAccount('reserve'))).not.toBe(
      accountKey(identityAccount('trader_wallet', 'reserve')),
    );
  });

  test('an identity-scoped account with no identity is refused, because the DDL refuses the row', () => {
    expect(() => identityAccount('trader_wallet', '')).toThrow(/needs an identity/);
  });

  test('a firm account names nobody and an identity account names one person', () => {
    expect(identityOf(firmAccount('firm_treasury'))).toBeUndefined();
    expect(identityOf(identityAccount('trader_withdrawable', 'A'))).toBe('A');
  });
});
