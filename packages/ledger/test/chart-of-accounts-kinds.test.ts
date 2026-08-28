// =============================================================================
// packages/ledger/test/chart-of-accounts-kinds.test.ts
// =============================================================================
// THE RULING IN `0052` HAS A WATCHER, AND THE ABSENCE HAS ONE TOO.
//
// ADR-177 rules the `kind` of four of the seven v1 codes and REFUSES the other
// three, and `0052` writes both halves into the schema: a CASE binding four
// codes to a kind, ending in `ELSE true` for the three no file in this tree
// states. A ruling stored as a hole is only a ruling while somebody is watching
// the hole, so this file asserts the shape of BOTH halves.
//
// WHY THE ABSENCE IS ASSERTED RATHER THAN LEFT IMPLICIT. The likeliest next edit
// to `0052`'s constraint is a session that settles `firm_treasury` and adds an
// arm for it. That session SHOULD have to come here and say so: the alternative
// is a code quietly leaving the open-question list with nothing recording that
// it was answered, which is ADR-174 section 4's own hazard one file over.
//
// THIS FILE MINTS NO FOURTH COPY OF THE VOCABULARY. `accounts.test.ts`'s header
// argues why a third statement of the seven codes earns its place only while it
// is checked against the other two; a hand-kept `kind` map in `accounts.ts`
// would be a fourth statement with nothing to check it against, and this package
// never reads `kind` at all (`chart.ts` reads id, code, scope and identity_id).
// So the kinds live in the migration and this file reads them out of it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { LEDGER_ACCOUNT_CODES, LEDGER_ACCOUNT_SCOPE } from '../src/accounts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'db', 'migrations');
const read = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');

/**
 * The named statement, from its anchor to the first `;` that ends it.
 *
 * THE SLICE IS TAKEN BEFORE ANY LITERAL IS READ, because `0052`'s header states
 * every kind it refuses in prose and its `COMMENT ON CONSTRAINT` is a SQL string
 * holding more of the same. Reading literals out of the whole file would parse
 * the argument for the ruling as though it were the ruling.
 */
function statement(sql: string, anchor: string): string {
  // COMMENTS COME OFF FIRST AND NOT LAST, and getting that order wrong is how
  // this file failed the first time it ran: `0052`'s header names
  // `INSERT INTO ledger_accounts` in prose, three screens above the statement,
  // so anchoring on the raw text sliced the argument and then deleted it.
  const bare = sql.replace(/--[^\n]*/g, '');
  const at = bare.indexOf(anchor);
  if (at < 0) throw new Error(`0052 no longer contains ${anchor}`);
  const end = bare.indexOf(';', at);
  if (end < 0) throw new Error(`unterminated statement at ${anchor}`);
  return bare.slice(at, end);
}

/** Every single-quoted literal in the named parenthesised list. */
function listAfter(sql: string, anchor: string): string[] {
  const at = sql.indexOf(anchor);
  if (at < 0) throw new Error(`the migration no longer contains ${anchor}`);
  const open = sql.indexOf('(', at);
  const close = sql.indexOf(')', open);
  return [...sql.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

const MIGRATION = read('0052_chart_of_accounts.sql');
const CONSTRAINT = statement(MIGRATION, 'ADD CONSTRAINT ledger_accounts_kind_matches_code');
const SEED = statement(MIGRATION, 'INSERT INTO ledger_accounts');

// A SLICE THAT READS NOTHING PASSES EVERY `for` LOOP BELOW, which is the shape
// of green this file exists to refuse.
for (const [name, slice] of [
  ['the constraint', CONSTRAINT],
  ['the seed', SEED],
] as const) {
  if (slice.trim().length === 0)
    throw new Error(`0052 parsed to an empty statement for ${name}; the test cannot run`);
}

/** `WHEN 'code' THEN kind = 'kind'`, in the order the constraint writes them. */
const ARMS: readonly (readonly [string, string])[] = [
  ...CONSTRAINT.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+kind\s*=\s*'([a-z_]+)'/g),
].map((m) => [m[1] as string, m[2] as string] as const);

/** What ADR-177 ruled, and the only place in this repository it is typed. */
const RULED: Readonly<Record<string, string>> = {
  fees_revenue: 'revenue',
  trader_wallet: 'liability',
  trader_withdrawable: 'liability',
  promotional_credit: 'liability',
};

/** What ADR-177 refused. `0052` header item 2 argues each one separately. */
const REFUSED = ['firm_treasury', 'psp_clearing', 'reserve'] as const;

describe('0052 binds kind to code for exactly the codes ADR-177 ruled', () => {
  test('the four ruled codes carry the kinds the entry derived', () => {
    expect(Object.fromEntries(ARMS)).toEqual(RULED);
  });

  test('every code the constraint names is one of 0009s seven', () => {
    for (const [code] of ARMS) expect(LEDGER_ACCOUNT_CODES).toContain(code);
  });

  test('every kind the constraint names is one of 0009s five', () => {
    const kinds = listAfter(read('0009_ledger.sql'), 'CHECK (kind IN');
    expect(kinds).toHaveLength(5);
    for (const [, kind] of ARMS) expect(kinds).toContain(kind);
  });
});

describe('the three refused codes are absent, and the absence is the ruling', () => {
  test('no arm names firm_treasury, psp_clearing or reserve', () => {
    const named = new Set(ARMS.map(([code]) => code));
    for (const code of REFUSED) expect(named.has(code)).toBe(false);
  });

  test('the refused codes are exactly the codes the constraint leaves unbound', () => {
    const named = new Set(ARMS.map(([code]) => code));
    const unbound = LEDGER_ACCOUNT_CODES.filter((code) => !named.has(code));
    expect([...unbound].sort()).toEqual([...REFUSED].sort());
  });

  test('the fall-through the refused codes take is still there', () => {
    // Without `ELSE true` the CASE returns NULL for them, and a CHECK passes on
    // NULL, so the constraint would behave the same way and say something else.
    // The word is what tells a reader the hole is deliberate.
    expect(CONSTRAINT).toMatch(/ELSE\s+true/);
  });
});

describe('the seed writes a row the constraint above admits', () => {
  test('it seeds fees_revenue as revenue, which is the arm for that code', () => {
    const literals = [...SEED.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
    expect(literals).toEqual(['fees_revenue', 'revenue', 'firm']);
    expect(RULED['fees_revenue']).toBe('revenue');
  });

  test('a migration seeds only firm-scoped codes, because it has no identity to seed against', () => {
    const literals = [...SEED.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
    for (const literal of literals) {
      if ((LEDGER_ACCOUNT_CODES as readonly string[]).includes(literal)) {
        expect(LEDGER_ACCOUNT_SCOPE[literal as keyof typeof LEDGER_ACCOUNT_SCOPE]).toBe('firm');
      }
    }
  });

  test('the seed is a plain INSERT, because the silent skip is the defect ADR-177 found', () => {
    // The CI probe seeded its own fees_revenue row under ON CONFLICT DO NOTHING
    // and pinned the id. Once this seed exists that clause skips the row and the
    // probe stops exercising LEDGER-C1. A migration runs once and forward only.
    expect(SEED).not.toMatch(/ON\s+CONFLICT/i);
  });
});
