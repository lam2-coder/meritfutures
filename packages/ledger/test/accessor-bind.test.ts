// =============================================================================
// packages/ledger/test/accessor-bind.test.ts
// =============================================================================
// TWO STATEMENTS OF ONE SHAPE, BOUND BY READING THE OTHER ONE.
//
// `LedgerTx` restates the subset of ADR-102's `SystemTx` this package writes
// through, because a dependency edge on `@merit/db` would give this library the
// ability to open its own transaction and lose ADR-006's central consequence
// (`tx.ts` states the argument). The cost is ADR-092 section 5's
// two-statements-of-one-fact hazard, and ADR-102 closed the identical problem
// against `packages/queue` by having the suite READ the other file.
//
// This is that instrument pointed at `packages/db`. A rename there fails a test
// here and the two must move together.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_SRC = join(HERE, '..', '..', 'db', 'src');
const read = (file: string): string => readFileSync(join(DB_SRC, file), 'utf8');

/** The body of one `export interface Name { ... }`, as written. */
function interfaceBody(source: string, name: string): string {
  const at = source.indexOf(`export interface ${name} `);
  if (at < 0) throw new Error(`packages/db no longer declares an interface named ${name}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("ADR-102's writer still has the shape this package restates", () => {
  const scopedDb = read('scoped-db.ts');

  test('SystemTx declares `rows` and `insert` over TableKey, which is what LedgerTx narrows', () => {
    const body = interfaceBody(scopedDb, 'SystemTx');
    expect(body).toMatch(/rows<K extends TableKey>\(key: K\): Promise<unknown\[\]>/);
    expect(body).toMatch(
      /insert<K extends TableKey>\(key: K, values: WriteValues\): Promise<unknown\[\]>/,
    );
  });

  test('`WriteValues` is still a record keyed by string, which is what a values object is here', () => {
    expect(scopedDb).toMatch(/export type WriteValues = Readonly<Record<string, unknown>>/);
  });

  test('a write is still reachable ONLY through `transaction`, so this package cannot be handed a writer any other way', () => {
    // ADR-102 clause 1. `ScopedDb` and `SystemDb` are read-only, so a caller
    // giving this package a `LedgerTx` is necessarily inside a transaction it
    // opened. If a write method ever appears on a read handle, the guarantee in
    // `tx.ts`'s header stops being true and this turns red.
    for (const name of ['ScopedDb', 'SystemDb', 'FirmDb']) {
      const body = interfaceBody(scopedDb, name);
      for (const verb of ['insert', 'update', 'delete', 'transaction']) {
        expect(body, `${name} carries ${verb}`).not.toMatch(new RegExp(`\\b${verb}\\b`));
      }
    }
  });

  // THE FINDING, WATCHED RATHER THAN ONLY WRITTEN DOWN. A posting touches two
  // parties' accounts, so only `SystemTx` can write it, and `SystemReason` has
  // exactly two members -- neither of which a request handler is. The day a
  // third member lands, this test says so and the finding in ADR-103 is closed
  // by whoever added it rather than rediscovered.
  test('SystemReason is still exactly two members, so a request handler is still neither', () => {
    const declared = /export type SystemReason =([^;]+);/.exec(scopedDb)?.[1] ?? '';
    const members = [...declared.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string);
    expect(members.sort()).toEqual(['nightly-batch', 'operator-console']);
  });

  test('firmDb still cannot reach these tables, which is why the reason problem has no third door today', () => {
    // `FirmTx.insert` accepts `FirmTableKey`, and both ledger write targets are
    // `derived` in the registry. So `firmDb()` -- ADR-102's answer to the
    // reader with no identity -- does not serve the posting path.
    const scope = read('scope.ts');
    for (const key of ['ledgerTransactions', 'ledgerEntries']) {
      const at = scope.indexOf(`  ${key}: {`);
      expect(at, `${key} is no longer a registry row`).toBeGreaterThan(0);
      expect(scope.slice(at, at + 200)).toMatch(/class: 'derived'/);
    }
    expect(interfaceBody(scopedDb, 'FirmTx')).toMatch(
      /insert<K extends FirmTableKey>\(key: K, values: WriteValues\)/,
    );
  });

  test('ledger_halts is registered `owned`, so a scoped reader reaches its own halts', () => {
    const scope = read('scope.ts');
    const at = scope.indexOf('  ledgerHalts: {');
    expect(at, 'ledgerHalts is not in the registry').toBeGreaterThan(0);
    const row = scope.slice(at, at + 400);
    expect(row).toMatch(/class: 'owned'/);
    expect(row).toMatch(/column: 'identity_id'/);
    expect(row).toMatch(/nullable: false/);
  });
});
