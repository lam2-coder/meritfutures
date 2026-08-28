// =============================================================================
// packages/ledger/test/chart-of-accounts-kinds.test.ts
// =============================================================================
// THE RULING IN THE CHART HAS A WATCHER, AND THE ABSENCE HAS ONE TOO.
//
// ADR-177 ruled the `kind` of four of the seven v1 codes and REFUSED the other
// three; `0052` wrote both halves into the schema as a CASE binding four codes
// and an `ELSE true` for the rest. ADR-180 SETTLES ONE OF THE THREE:
// `firm_treasury` is an `asset`, and `0053` supersedes `0052`'s constraint to
// say so. A ruling stored as a hole is only a ruling while somebody is watching
// the hole, so this file asserts the shape of BOTH halves as they now stand.
//
// WHAT CHANGED WHEN ADR-180 LANDED, because this file predicted it. Its
// previous header said: "The likeliest next edit to `0052`'s constraint is a
// session that settles `firm_treasury` and adds an arm for it. That session
// SHOULD have to come here and say so." That session was 326 and this is it
// saying so. Two cases went red exactly as armed, which is what they were for.
//
// SO THE FILE NOW READS THE CONSTRAINT IN FORCE RATHER THAN `0052`'s. A CHECK
// cannot be extended in place, so every future ruling on the remaining two
// codes arrives the same way `0053` did: a DROP and an ADD under the same name
// in a later migration. Pinning this file to one file name would make it green
// against a constraint the database no longer has. It scans the whole migration
// set in order and takes the LAST statement, which is the one installed.
//
// AND IT WATCHES THE SUPERSESSION ITSELF, which is the E2 property. A merged
// migration is never edited, only superseded: `0052` must still carry its own
// four arms, unchanged, after `0053` exists.
//
// THIS FILE MINTS NO FOURTH COPY OF THE VOCABULARY. `accounts.test.ts`'s header
// argues why a third statement of the seven codes earns its place only while it
// is checked against the other two; a hand-kept `kind` map in `accounts.ts`
// would be a fourth statement with nothing to check it against, and this package
// never reads `kind` at all (`chart.ts` reads id, code, scope and identity_id).
// So the kinds live in the migrations and this file reads them out of them.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { LEDGER_ACCOUNT_CODES, LEDGER_ACCOUNT_SCOPE } from '../src/accounts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'db', 'migrations');
const read = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');

/** Every migration, in the order the runner applies them. */
const FILES: readonly string[] = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/**
 * Every occurrence of the named statement, from its anchor to the first `;`.
 *
 * THE SLICE IS TAKEN BEFORE ANY LITERAL IS READ, because these files state
 * every kind they rule and refuse in prose and their `COMMENT ON CONSTRAINT` is
 * a SQL string holding more of the same. Reading literals out of the whole file
 * would parse the argument for the ruling as though it were the ruling.
 */
function statements(sql: string, anchor: string): string[] {
  // COMMENTS COME OFF FIRST AND NOT LAST, and getting that order wrong is how
  // this file failed the first time it ran: `0052`'s header names
  // `INSERT INTO ledger_accounts` in prose, three screens above the statement,
  // so anchoring on the raw text sliced the argument and then deleted it.
  const bare = sql.replace(/--[^\n]*/g, '');
  const found: string[] = [];
  for (let at = bare.indexOf(anchor); at >= 0; at = bare.indexOf(anchor, at + 1)) {
    const end = bare.indexOf(';', at);
    if (end < 0) throw new Error(`unterminated statement at ${anchor}`);
    found.push(bare.slice(at, end));
  }
  return found;
}

/** `[migration, statement]` for every occurrence, across the whole set, in order. */
function acrossMigrations(anchor: string): readonly (readonly [string, string])[] {
  return FILES.flatMap((file) =>
    statements(read(file), anchor).map((body) => [file, body] as const),
  );
}

const CONSTRAINTS = acrossMigrations('ADD CONSTRAINT ledger_accounts_kind_matches_code');
const SEEDS = acrossMigrations('INSERT INTO ledger_accounts');

// A SLICE THAT READS NOTHING PASSES EVERY `for` LOOP BELOW, which is the shape
// of green this file exists to refuse.
if (CONSTRAINTS.length === 0) throw new Error('no migration installs the kind-to-code constraint');
if (SEEDS.length === 0) throw new Error('no migration seeds the chart of accounts');

/** The constraint the database actually has: the last one installed wins. */
const [CONSTRAINT_FILE, CONSTRAINT] = CONSTRAINTS[CONSTRAINTS.length - 1] as readonly [
  string,
  string,
];

/** Every single-quoted literal in the named parenthesised list. */
function listAfter(sql: string, anchor: string): string[] {
  const at = sql.indexOf(anchor);
  if (at < 0) throw new Error(`the migration no longer contains ${anchor}`);
  const open = sql.indexOf('(', at);
  const close = sql.indexOf(')', open);
  return [...sql.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

/** `WHEN 'code' THEN kind = 'kind'`, in the order the constraint writes them. */
const ARMS: readonly (readonly [string, string])[] = [
  ...CONSTRAINT.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+kind\s*=\s*'([a-z_]+)'/g),
].map((m) => [m[1] as string, m[2] as string] as const);

/**
 * What is RULED, and the only place in this repository it is typed.
 *
 * Four came from ADR-177, each derived from a posting the corpus already states.
 * `firm_treasury` came from ADR-180 and is a JUDGEMENT rather than a derivation:
 * the arithmetic and the prose were each unanimous and opposite, and that entry
 * ruled the prose right, the three postings backwards, and amended `M05`
 * section 2.1 accordingly.
 */
const RULED: Readonly<Record<string, string>> = {
  fees_revenue: 'revenue',
  trader_wallet: 'liability',
  trader_withdrawable: 'liability',
  promotional_credit: 'liability',
  firm_treasury: 'asset',
};

/**
 * What is still REFUSED, and the two refusals are not the same refusal.
 *
 * `psp_clearing` has no posting anywhere in this tree; `reserve` has no posting
 * AND no reader, because `SD-M5-03` anchors that figure outside this ledger on
 * purpose. Both are SILENCES. ADR-180 answered a CONTRADICTION and says in
 * terms that it has nothing to say about a silence, so neither moved.
 */
const REFUSED = ['psp_clearing', 'reserve'] as const;

describe('the constraint in force binds kind to code for exactly the ruled codes', () => {
  test('the ruled codes carry the kinds their entries derived or judged', () => {
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

describe('the refused codes are absent, and the absence is the ruling', () => {
  test('no arm names psp_clearing or reserve', () => {
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

describe('a later ruling SUPERSEDES the constraint and never edits a merged file', () => {
  test('the constraint in force is the last one installed, and a DROP precedes every re-add', () => {
    // The first install has nothing to drop; every one after it must drop the
    // name first, or the ALTER fails on a duplicate constraint and the ruling
    // that looks installed is not.
    expect(FILES).toContain(CONSTRAINT_FILE);
    for (const [file] of CONSTRAINTS.slice(1)) {
      expect(read(file), file).toContain('DROP CONSTRAINT ledger_accounts_kind_matches_code');
    }
  });

  test('0052 still carries its own four arms, unedited, now that 0053 supersedes it', () => {
    // E2: a merged migration is never edited, only superseded. The cheap way to
    // add an arm is to edit `0052`, and that is the thing that must never
    // happen. If this goes red, read the diff against `0052` and not this file.
    const original = statements(read('0052_chart_of_accounts.sql'), 'ADD CONSTRAINT');
    expect(original).toHaveLength(1);
    const originalArms = [
      ...(original[0] as string).matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+kind\s*=\s*'([a-z_]+)'/g),
    ].map((m) => [m[1] as string, m[2] as string] as const);
    expect(Object.fromEntries(originalArms)).toEqual({
      fees_revenue: 'revenue',
      trader_wallet: 'liability',
      trader_withdrawable: 'liability',
      promotional_credit: 'liability',
    });
  });

  test('a superseding constraint carries every arm the one before it carried', () => {
    // Dropping and re-adding is how an arm would go missing SILENTLY: the code
    // falls back through `ELSE true` and the database accepts every kind for it
    // again, with nothing saying a ruling was lost.
    let previous: ReadonlyMap<string, string> = new Map();
    for (const [file, body] of CONSTRAINTS) {
      const arms = new Map(
        [...body.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+kind\s*=\s*'([a-z_]+)'/g)].map(
          (m) => [m[1] as string, m[2] as string] as const,
        ),
      );
      for (const [code, kind] of previous)
        expect(arms.get(code), `${file} dropped ${code}`).toBe(kind);
      previous = arms;
    }
  });
});

describe('the seeds write rows the constraint in force admits', () => {
  test('every seeded row carries the kind its arm requires', () => {
    const ruled = new Map(ARMS);
    for (const [file, seed] of SEEDS) {
      const literals = [...seed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
      const code = literals.find((literal) =>
        (LEDGER_ACCOUNT_CODES as readonly string[]).includes(literal),
      );
      expect(code, file).toBeDefined();
      expect(literals, file).toContain(ruled.get(code as string));
    }
  });

  test('the chart is seeded once per code, and only for firm-scoped codes', () => {
    // A migration has no identity to seed against, so the three per-identity
    // classes still have no writer at all, anywhere in this tree.
    const seeded: string[] = [];
    for (const [file, seed] of SEEDS) {
      const literals = [...seed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
      for (const literal of literals) {
        if ((LEDGER_ACCOUNT_CODES as readonly string[]).includes(literal)) {
          expect(LEDGER_ACCOUNT_SCOPE[literal as keyof typeof LEDGER_ACCOUNT_SCOPE], file).toBe(
            'firm',
          );
          seeded.push(literal);
        }
      }
    }
    expect([...seeded].sort()).toEqual(['fees_revenue', 'firm_treasury']);
  });

  test('every seed is a plain INSERT, because the silent skip is the defect ADR-177 found', () => {
    // The CI probe seeded its own fees_revenue row under ON CONFLICT DO NOTHING
    // and pinned the id. Once that seed exists the clause skips the row and the
    // probe stops exercising LEDGER-C1. A migration runs once and forward only.
    for (const [file, seed] of SEEDS) expect(seed, file).not.toMatch(/ON\s+CONFLICT/i);
  });
});
