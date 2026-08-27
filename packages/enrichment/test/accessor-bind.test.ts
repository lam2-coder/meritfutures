// =============================================================================
// packages/enrichment/test/accessor-bind.test.ts
// =============================================================================
// TWO STATEMENTS OF ONE SHAPE, BOUND BY READING THE OTHER ONE.
//
// `EnrichmentTx` restates the subset of ADR-102's `ScopedTx` this package
// writes through, and `ContractSource` restates the subset of `FirmDb` it reads
// the contract row through, because a dependency edge on `@merit/db` would give
// this library the ability to open its own transaction and lose the property
// `tx.ts` states: the observation commits with the purchase that caused it or
// not at all. The cost is ADR-092 section 5's two-statements-of-one-fact
// hazard, and ADR-102 closed the identical problem against `packages/queue`,
// and `packages/ledger` closed it against ADR-102, by having the suite READ the
// other file.
//
// This is that instrument pointed at `packages/db` a third time. A rename there
// fails a test here and the two must move together.
//
// IT ALSO PINS THE TWO MIGRATION FACTS THIS PACKAGE'S WRITE SHAPE RESTS ON,
// which is the half `packages/ledger`'s version of this file does not need. If
// `schema.ts` ever declares the natural key of `identity_signals`, the
// read-then-write in `observe.ts` stops being forced and becomes merely
// cautious, and somebody should be told rather than left to discover it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_SRC = join(HERE, '..', '..', 'db', 'src');
const MIGRATIONS = join(HERE, '..', '..', 'db', 'migrations');
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

describe("ADR-102's scoped writer still has the shape this package restates", () => {
  const scopedDb = read('scoped-db.ts');

  test('`ScopedTx` declares the three members `EnrichmentTx` narrows', () => {
    const body = interfaceBody(scopedDb, 'ScopedTx');
    expect(body).toMatch(
      /rowsWhere<K extends ScopedTableKey, F extends RowFilter<K>>\(\s*key: K,\s*where: NamesAColumn<K, F>,\s*\): Promise<unknown\[\]>/,
    );
    expect(body).toMatch(
      /insert<K extends OwnedTableKey>\(key: K, values: WriteValues\): Promise<unknown\[\]>/,
    );
    expect(body).toMatch(
      /updateAt<K extends ScopedTableKey, A extends RowAddress<K>>\(\s*key: K,\s*at: NamesAColumn<K, A>,\s*values: WriteValues,\s*\): Promise<unknown\[\]>/,
    );
  });

  test('`WriteValues` is still a record keyed by string, which is what a values object is here', () => {
    expect(scopedDb).toMatch(/export type WriteValues = Readonly<Record<string, unknown>>/);
  });

  test('`FirmDb` still declares the `rows` that `ContractSource` narrows', () => {
    expect(interfaceBody(scopedDb, 'FirmDb')).toMatch(
      /rows<K extends FirmTableKey>\(key: K\): Promise<unknown\[\]>/,
    );
  });

  test('a write is still reachable ONLY through `transaction`', () => {
    // ADR-102 clause 1. `ScopedDb` and `FirmDb` are read-only, so a caller
    // handing this package an `EnrichmentTx` is necessarily inside a
    // transaction it opened, which is what makes "the observation commits with
    // the purchase or not at all" a property rather than a convention.
    expect(interfaceBody(scopedDb, 'ScopedDb')).not.toMatch(/insert|updateAt|deleteAt/);
    expect(scopedDb).toMatch(
      /export function transaction<T>\(handle: ScopedDb, fn: \(tx: ScopedTx\) => Promise<T>\): Promise<T>/,
    );
  });

  test('`update` and `delete` still do not exist on a transaction handle (ADR-112)', () => {
    for (const name of ['ScopedTx', 'SystemTx', 'FirmTx']) {
      const body = interfaceBody(scopedDb, name);
      expect(body).not.toMatch(/^\s*update\(/m);
      expect(body).not.toMatch(/^\s*delete\(/m);
    }
  });
});

describe('the two registry facts this package writes against', () => {
  const scope = read('scope.ts');

  test('`identitySignals` is `owned` on `identity_id`, so the handle stamps the tenancy', () => {
    expect(scope).toMatch(
      /identitySignals: \{\s*class: 'owned',\s*column: 'identity_id',\s*nullable: false,/,
    );
  });

  test('`integrationDispatches` is `owned` with a NULLABLE tenancy column', () => {
    expect(scope).toMatch(
      /integrationDispatches: \{\s*class: 'owned',\s*column: 'identity_id',\s*nullable: true,/,
    );
  });

  test('`integrationContracts` is `firm`, which is why it is read through the other door', () => {
    expect(scope).toMatch(/integrationContracts: \{\s*class: 'firm',/);
  });
});

describe('the migration facts the read-then-write rests on', () => {
  test('`identity_signals` natural key is a UNIQUE INDEX, which `uniqueKeys()` does not read', () => {
    const ddl = readFileSync(join(MIGRATIONS, '0002_identity.sql'), 'utf8');
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX identity_signals_identity_kind_value_uq\s*\n\s*ON identity_signals \(identity_id, kind, value_hash\)/,
    );
    // `uniqueKeys()` reads inline and table-level PRIMARY KEY and UNIQUE
    // CONSTRAINTS. A `CREATE UNIQUE INDEX` is none of the four sources, so the
    // key above is invisible to `refuseUnaddressed` and cannot address a write.
    const scopedDb = read('scoped-db.ts');
    expect(scopedDb).toMatch(/for \(const unique of config\.uniqueConstraints\)/);
    expect(scopedDb).not.toMatch(/config\.indexes/);
  });

  test('`schema.ts` declares no key for it, so `id` is the ONLY address this table has', () => {
    const schema = read('schema.ts');
    const at = schema.indexOf("export const identitySignals = pgTable('identity_signals'");
    expect(at).toBeGreaterThan(-1);
    const body = schema.slice(at, schema.indexOf('\n});', at));
    expect(body).toMatch(/id: uuid\('id'\)\.primaryKey\(\)/);
    expect(body).not.toMatch(/\.unique\(\)/);
    // A table-level config would arrive as a second argument to `pgTable`, which
    // closes with `}, (t) => ...` rather than with `});`.
    expect(schema.slice(at, at + body.length + 4)).toMatch(/\n\}\);$/);
  });

  test('`identity_signals.kind` still admits `footprint_enrichment`, which is `U-04`', () => {
    const ddl = readFileSync(join(MIGRATIONS, '0029_phone_identity_and_auth.sql'), 'utf8');
    expect(ddl).toMatch(/identity_signals_kind_allowed/);
    expect(ddl).toMatch(/'footprint_enrichment',\s*-- U-04/);
  });

  test('`integration_dispatches` still CHECKs the four statuses this package writes two of', () => {
    const ddl = readFileSync(join(MIGRATIONS, '0018_integrations.sql'), 'utf8');
    expect(ddl).toMatch(
      /status\s+text NOT NULL CHECK \(status IN \(\s*\n\s*'queued', 'sent', 'failed', 'dropped_by_guard'/,
    );
    expect(ddl).toMatch(
      /CONSTRAINT integration_dispatches_sent_has_timestamp CHECK \(\s*\n\s*status <> 'sent' OR dispatched_at IS NOT NULL/,
    );
  });

  test('`integration_contracts_live_uq` is still what makes ONE live contract a fact', () => {
    const ddl = readFileSync(join(MIGRATIONS, '0018_integrations.sql'), 'utf8');
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX integration_contracts_live_uq\s*\n\s*ON integration_contracts \(integration, event_name\) WHERE enabled;/,
    );
  });
});
