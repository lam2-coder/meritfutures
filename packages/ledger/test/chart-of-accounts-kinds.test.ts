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
// AND ADR-186 IS THE ENTRY THIS HEADER'S PREDICTION WAS ULTIMATELY ABOUT. `0055`
// rules the LAST TWO codes -- `psp_clearing` and `reserve`, both `asset` -- and
// CLOSES THE HOLE: the CASE now names all seven and its `ELSE` is `false` rather
// than `true`. So the half of this file that watched an absence has nothing left
// to watch, and it is REPLACED rather than left looping over an empty list: a
// `for` over `[]` passes, and a case that passes by reading nothing is the shape
// of green this file exists to refuse. What replaces it asserts the TOTALITY --
// every declared code has an arm, no code is unbound -- and the ELSE word, which
// is the half no reader of the migration text can see and the half that decides
// what happens to the eighth code.
//
// AND IT WATCHES THE SUPERSESSION ITSELF, which is the E2 property. A merged
// migration is never edited, only superseded: `0052` must still carry its own
// four arms, unchanged, after `0053` and `0055` exist.
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

// TWO KINDS OF WRITE, SPLIT ON THE `scope` LITERAL THE STATEMENT ITSELF CARRIES.
// Until `0054` every write was a firm seed and this partition would have been a
// distinction with one side empty. ADR-183 provisions the per-identity positions
// and the two halves have genuinely different properties: a firm seed writes one
// fixed row once, and an identity write runs on every identity there will ever
// be. The split is read out of the statement rather than out of a file name, so
// a later migration cannot land on the wrong side by being numbered differently.
const FIRM_SEEDS = SEEDS.filter(([, body]) => /'firm'/.test(body));
const IDENTITY_WRITES = SEEDS.filter(([, body]) => /'identity'/.test(body));

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
 *
 * `psp_clearing` and `reserve` came from ADR-186 and are the last two. Neither
 * has a posting, so neither is an ADR-177 derivation; both are read off what the
 * tree says they ARE. `psp_clearing` is stated twice in shipped source and both
 * statements are asset-shaped: `checkout.ts` says there is "nothing IN clearing"
 * when no processor is present, and that crediting it would book "a receivable
 * from a processor". `reserve` rests on GLOSSARY's "funds set aside ... held and
 * reported separately", with the `equity` reading refused on `treasury_balances`'
 * `source CHECK IN ('provider_api','manual_attestation')`: an equity
 * appropriation has no rail balance and no provider to report it.
 *
 * THE MAP IS NOW TOTAL OVER THE VOCABULARY and the case below asserts that
 * rather than assuming it, which is what makes the deleted `REFUSED` list safe
 * to delete.
 */
const RULED: Readonly<Record<string, string>> = {
  fees_revenue: 'revenue',
  trader_wallet: 'liability',
  trader_withdrawable: 'liability',
  promotional_credit: 'liability',
  firm_treasury: 'asset',
  psp_clearing: 'asset',
  reserve: 'asset',
};

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

describe('the hole is closed, and the closure is the ruling', () => {
  // THESE THREE CASES REPLACE THREE THAT ASSERTED THE OPPOSITE, AND THE SESSION
  // THAT CLOSED THE HOLE HAD TO COME HERE AND SAY SO. They used to read: "no arm
  // names psp_clearing or reserve", "the refused codes are exactly the codes the
  // constraint leaves unbound", and "the fall-through the refused codes take is
  // still there", the last of which asserted `/ELSE\s+true/`. ADR-186 rules both
  // codes `asset` and closes `ELSE true` to `ELSE false`, so all three went red
  // exactly as armed, which is what the header above says an armed case is for.

  test('every declared code has an arm, so nothing is left to fall through', () => {
    const named = new Set(ARMS.map(([code]) => code));
    const unbound = LEDGER_ACCOUNT_CODES.filter((code) => !named.has(code));
    expect(unbound).toEqual([]);
    expect(named.size).toBe(LEDGER_ACCOUNT_CODES.length);
  });

  test('the ELSE arm REFUSES, and it is present rather than deleted', () => {
    // THE WORD IS THE WHOLE OF THIS CASE. With every code armed, the ELSE is
    // unreachable today under either word, and what separates them is the day
    // the vocabulary widens: `ELSE true` admits an eighth code with any kind and
    // `ELSE false` refuses it until its kind is ruled in the same migration.
    //
    // AND DELETING THE ELSE IS NOT THE SAME CLOSURE. A CASE with no ELSE returns
    // NULL for an unmatched code and a CHECK PASSES on NULL, so a constraint
    // that dropped the arm would behave exactly as `ELSE true` did while
    // appearing to say something else. Both halves are asserted.
    expect(CONSTRAINT).toMatch(/ELSE\s+false/);
    expect(CONSTRAINT).not.toMatch(/ELSE\s+true/);
  });

  test('no firm code is a liability, which is ADR-181s elimination made total', () => {
    // ADR-181 derived that the external leg's in-flight obligation is a
    // FIRM-SCOPED `liability` and that none of the seven can hold one. Two of
    // its four steps were "the code is ruled something else" and two were "the
    // code is ruled nothing and falls through". After ADR-186 all four are the
    // first kind, so ADR-174 section 3 shape (iii) is not merely refused in an
    // entry: it is unrepresentable in the schema.
    const ruled = new Map(ARMS);
    const firm = LEDGER_ACCOUNT_CODES.filter((code) => LEDGER_ACCOUNT_SCOPE[code] === 'firm');
    expect(firm).toHaveLength(4);
    for (const code of firm) {
      expect(ruled.get(code), code).toBeDefined();
      expect(ruled.get(code), code).not.toBe('liability');
    }
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
    // THIS CASE WENT RED WHEN `0054` LANDED AND THE SESSION CAME HERE TO SAY SO,
    // which is what the header above says an armed case is for.
    //
    // It used to read, in its own comment: "A migration has no identity to seed
    // against, so the three per-identity classes still have no writer at all,
    // anywhere in this tree." ADR-183 is the entry that makes that false, and
    // `0054` is how: a TRIGGER has an identity to write against (`NEW.id`) and a
    // backfill joins to `identities`, so neither needs a literal to seed onto.
    //
    // THE PROPERTY THE CASE WAS PROTECTING SURVIVES INTACT AND IS NOT WEAKENED.
    // What it was really holding is that no migration writes a per-identity row
    // by asserting a hand-written identity onto it, and that the FIRM chart is
    // seeded exactly once per code. Both are asserted below, the second over the
    // firm seeds unchanged. What is new is that identity-scoped writes exist at
    // all, and they are given their own assertions rather than an exemption.
    const seeded: string[] = [];
    for (const [file, seed] of FIRM_SEEDS) {
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
    //
    // ADR-186 RULES TWO MORE FIRM KINDS AND SEEDS NEITHER, so this list is
    // UNCHANGED and the unchange is deliberate rather than an omission. `0052`
    // header item 4's stated rule -- the seedable set is the firm codes with a
    // settled kind -- would now admit `psp_clearing` and `reserve`; its
    // ARGUMENT would not, because it seeded `fees_revenue` for a posting that
    // resolves against it and nothing posts against either of these two. A row
    // here would be a chart entry no posting resolves and a `readChart` cost
    // with no reader. The list is the assertion: a later session that seeds one
    // comes here and says why.
    expect([...seeded].sort()).toEqual(['fees_revenue', 'firm_treasury']);
  });

  test('the partition is total, so a write cannot escape both sets', () => {
    // A statement naming neither scope, or naming both, would fall out of every
    // assertion in this describe block while the block stayed green. That is
    // the shape of green this file exists to refuse, so it is refused here.
    expect(FIRM_SEEDS.length + IDENTITY_WRITES.length).toBe(SEEDS.length);
    expect(FIRM_SEEDS.length).toBeGreaterThan(0);
    expect(IDENTITY_WRITES.length).toBeGreaterThan(0);
  });

  test('an identity-scoped write names only per-identity codes and no literal identity', () => {
    for (const [file, write] of IDENTITY_WRITES) {
      const literals = [...write.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
      const codes = literals.filter((literal) =>
        (LEDGER_ACCOUNT_CODES as readonly string[]).includes(literal),
      );
      expect(codes.length, file).toBeGreaterThan(0);
      for (const code of codes) {
        expect(LEDGER_ACCOUNT_SCOPE[code as keyof typeof LEDGER_ACCOUNT_SCOPE], file).toBe(
          'identity',
        );
      }
      // THE ORIGINAL PROPERTY, KEPT. A migration still has no identity to seed
      // against: the identity comes from `NEW.id` or from a join to
      // `identities`, never from a uuid somebody typed.
      expect(write, file).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(write, file).toMatch(/NEW\.id|FROM identities/);
    }
  });

  test('every FIRM seed is a plain INSERT, because the silent skip is the defect ADR-177 found', () => {
    // The CI probe seeded its own fees_revenue row under ON CONFLICT DO NOTHING
    // and pinned the id. Once that seed exists the clause skips the row and the
    // probe stops exercising LEDGER-C1. A migration runs once and forward only.
    //
    // THE SCOPE OF THIS CASE IS NARROWED TO THE FIRM SEEDS AND THE NARROWING IS
    // ARGUED RATHER THAN ASSUMED. The defect ADR-177 found is a FIXED, KNOWN row
    // that a later seed makes redundant, leaving a pinned uuid naming nothing.
    // `0054`'s two writes are neither fixed nor pinned: the trigger runs on every
    // identity forever rather than once, and the clause is what makes the
    // backfill re-runnable against a partly provisioned database. Both resolve
    // their rows through `ledger_accounts_identity_code_uq` instead of holding a
    // second opinion about what exists.
    //
    // AND THE DEFECT ITSELF WAS RE-FOUND RATHER THAN ARGUED AWAY: `0054` DID
    // reproduce it, in `probe_ledger_constraints.sql`, whose two per-identity
    // fixtures were pinned uuids under exactly this clause. Watched raising
    // `LEDGER-C2: ledger_account aaaaaaaa-...-000000000002 does not exist`
    // instead of probing C1, and repaired the way ADR-177 repaired fees_revenue:
    // the ids are read from the chart. See ADR-183 section 8.
    for (const [file, seed] of FIRM_SEEDS) expect(seed, file).not.toMatch(/ON\s+CONFLICT/i);
  });
});
