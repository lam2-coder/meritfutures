// =============================================================================
// packages/ledger/test/accounts.test.ts
// =============================================================================
// THE THIRD COPY OF THE VOCABULARY IS CHECKED AGAINST THE OTHER TWO.
//
// `0009` declares the seven codes as a CHECK constraint and `0027` declares
// them again inside `LEDGER-C2`'s trigger body -- the migration set's own
// two-statements-of-one-fact, accepted there because "a FK to a table whose own
// CHECK could be dropped in a later migration is a guarantee with a dependency".
// `accounts.ts` is a third. It earns its place only while these assertions hold,
// and the day somebody adds an eighth class to one of the three this file names
// which one disagrees.

import { readFileSync } from 'node:fs';
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

/** Every single-quoted literal inside the named parenthesised block, in order. */
function quotedLiteralsAfter(sql: string, anchor: string): string[] {
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
  const body = sql.slice(open, end);
  // COMMENTS ARE STRIPPED FIRST. `0009`'s list carries a `-- per identity`
  // comment on three of its seven lines, and a comment holding an apostrophe
  // would otherwise be read as a literal.
  const withoutComments = body.replace(/--[^\n]*/g, '');
  return [...withoutComments.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

describe('the seven v1 classes, checked against both migrations that declare them', () => {
  test('0009 CHECK, 0027 LEDGER-C2 and this package name the same seven codes', () => {
    const inCheck = quotedLiteralsAfter(
      read('0009_ledger.sql'),
      'ledger_accounts_code_is_declared',
    );
    const inTrigger = quotedLiteralsAfter(
      read('0027_triggers_invariants.sql'),
      'IF acct_code NOT IN',
    );

    expect(inCheck.length, '0009 declares seven codes').toBe(7);
    expect([...inCheck].sort()).toEqual([...LEDGER_ACCOUNT_CODES].sort());
    expect([...inTrigger].sort()).toEqual([...LEDGER_ACCOUNT_CODES].sort());
  });

  test('the codes are declared in the order 0009 declares them, so a diff reads the same way', () => {
    const inCheck = quotedLiteralsAfter(
      read('0009_ledger.sql'),
      'ledger_accounts_code_is_declared',
    );
    expect(LEDGER_ACCOUNT_CODES).toEqual(inCheck);
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
