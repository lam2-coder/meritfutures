// =============================================================================
// packages/ledger/test/in-flight-obligation.test.ts
// =============================================================================
// ADR-181's RULING, AND THE PRICE OF TAKING IT, BOTH HELD AGAINST THE TREE.
//
// ADR-174 clause 4 ruled that the external leg needs a third account role: the
// wallet claim is gone at `LT-06` and the cash has not left until `LT-07`, so an
// obligation stands between the two moments and must be recorded somewhere. Its
// section 3 named three shapes for WHERE and refused to choose. ADR-180 ruled
// `firm_treasury` an `asset`, which fixed the cash leg of both rows and left the
// counterparty slots open. ADR-181 rules the counterparty: a FIRM-SCOPED
// `liability`, which is none of the seven declared codes.
//
// THE FIRST HALF OF THIS FILE IS THE ELIMINATION, RE-DERIVED RATHER THAN
// RESTATED. Every step reads a primary source: the sign out of `posting.ts`, the
// two ruled kinds out of the constraint the migration set actually installs, the
// scope partition out of `accounts.ts`, and the two `LT` rows out of `M05`. The
// conclusion is negative -- no code in the chart can hold this role -- so it
// goes red the day one can, which is the day a session mints the eighth code or
// rules one of the two remaining silences a `liability`.
//
// THE SECOND HALF IS THE FINDING THAT KEPT `0054` IN THE POOL. ADR-174 finding 3
// priced the eighth code at "TWO merged migrations and a third statement in
// TypeScript". It is more than that, and the sites it missed are the reason
// ADR-181 rules the shape and declines to mint the code in the same session.
// This file registers every one of them and then SCANS FOR THEM, in both
// directions, because a watcher pinned to a list of file names watches those
// files and not the claim -- which is the miss `packages/rail/test/lt-07.test.ts`
// records against itself under finding C.
//
// -----------------------------------------------------------------------------
// ADR-187 PAID THE PRICE AND FOUND TWO DEFECTS IN THE REGISTRY THAT PRICED IT
// -----------------------------------------------------------------------------
// DEFECT 1: THE REGISTRY REQUIRED MERGED MIGRATIONS TO MOVE, AND E2 FORBIDS IT.
// `ENUMERATES_ALL` held five migrations and asserted that EVERY registered site
// "still states exactly the set it is registered for" -- every code in
// `LEDGER_ACCOUNT_CODES`. A merged migration is never edited, only superseded,
// so that assertion could only ever have been satisfied by breaking E2. The
// contradiction was inside one object: `0009`'s own `why` string already read
// "Superseded, never edited" while the case demanded it be edited.
//
// THE REPAIR IS A PARTITION AND IT IS STRICTLY STRONGER THAN WHAT IT REPLACES.
// A migration states the vocabulary AS OF ITS OWN TIME. What a mint owes it is a
// SUPERSESSION -- a new migration re-declaring the whole vocabulary -- and what
// this file owes it is the opposite assertion: that it still says what it said,
// unedited, and does NOT name a code minted after it. That is checkable, and it
// catches an edit to a merged migration, which the old shape could not see.
//
// DEFECT 2: THE SCAN IS BLIND TO A NEGATIVE FIXTURE, AND ONE OF THEM NAMED THE
// SPELLING TWO ENTRIES PLANNED TO MINT. `enumerating` finds files that state the
// WHOLE vocabulary or the FIRM subset. A file that names an UNDECLARED code, as
// a fixture for watching a guard refuse it, states neither and is invisible to
// both directions of the scan. `scripts/db/probe_ledger_constraints.sql` holds
// two: `firm_payable`, which ADR-181 section 4 refuses to mint for exactly this
// reason, and `withdrawals_payable`, added by ADR-186's K1c block, which is the
// spelling ADR-181 section 5 and ADR-186 section 7 each fired at a database AS
// the eighth code. Minting either would make that probe assert the opposite of
// what it says, and nothing in this file would have said so. `NEGATIVE_FIXTURES`
// is that third category.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

import { LEDGER_ACCOUNT_CODES, LEDGER_ACCOUNT_SCOPE } from '../src/accounts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');
const MIGRATIONS = join(ROOT, 'packages', 'db', 'migrations');

const M05 = read('docs', 'plans', 'M05-payout-system.md');
const POSTING = read('packages', 'ledger', 'src', 'posting.ts');
const ADR_174 = read('docs', 'decisions', 'ADR-174.md');

/** The four codes whose account belongs to nobody, from the one file that partitions them. */
const FIRM_CODES = LEDGER_ACCOUNT_CODES.filter((code) => LEDGER_ACCOUNT_SCOPE[code] === 'firm');
/** The three that belong to one person. */
const IDENTITY_CODES = LEDGER_ACCOUNT_CODES.filter(
  (code) => LEDGER_ACCOUNT_SCOPE[code] === 'identity',
);

// -----------------------------------------------------------------------------
// THE CONSTRAINT IN FORCE, WHICH IS THE LAST ONE INSTALLED AND NOT `0052`'s
// -----------------------------------------------------------------------------
// A CHECK cannot be extended in place, so every ruling on a kind arrives as a
// DROP and an ADD under the same name in a later migration. Reading one file by
// name is how this goes green against a constraint the database no longer has,
// which is `chart-of-accounts-kinds.test.ts`'s own argument, applied here rather
// than assumed to cover this file too.
const MIGRATION_FILES: readonly string[] = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const KIND_CONSTRAINTS: readonly string[] = MIGRATION_FILES.flatMap((name) => {
  const bare = readFileSync(join(MIGRATIONS, name), 'utf8').replace(/--[^\n]*/g, '');
  const at = bare.indexOf('ADD CONSTRAINT ledger_accounts_kind_matches_code');
  if (at < 0) return [];
  const end = bare.indexOf(';', at);
  if (end < 0) throw new Error(`unterminated constraint in ${name}`);
  return [bare.slice(at, end)];
});

if (KIND_CONSTRAINTS.length === 0) {
  throw new Error('no migration installs the kind-to-code constraint');
}

/** `code -> kind`, as the installed constraint binds them. Absent means unruled. */
const KIND_IN_FORCE: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ...(KIND_CONSTRAINTS[KIND_CONSTRAINTS.length - 1] as string).matchAll(
      /WHEN\s+'([a-z_]+)'\s+THEN\s+kind\s*=\s*'([a-z_]+)'/g,
    ),
  ].map((m) => [m[1] as string, m[2] as string]),
);

describe('the sign, READ and not assumed, because this corpus has had it backwards', () => {
  test('posting.ts writes +amountCents on the debit and -amountCents on the credit', () => {
    expect(POSTING).toContain(
      'entries.push({ account: t.debit, amountCents: t.amountCents, memo: t.memo });',
    );
    expect(POSTING).toContain(
      'entries.push({ account: t.credit, amountCents: -t.amountCents, memo: t.memo });',
    );
  });
});

describe('the role: what the two ruled slots force the two open ones to be', () => {
  // ADR-180 amended both rows and left one slot open in each. What it left is
  // not free: the ruled slot of each row plus the one sign convention decides
  // the side the open slot sits on, and the kind in force decides what a
  // movement on that side means.
  test('LT-06 DEBITS the wallet position, so its open slot is a CREDIT', () => {
    expect(M05).toContain('| LT-06 | `wallet_withdrawal_approval` | debit `trader_wallet`');
    expect(M05).toContain('**the credit leg is NOT RULED, and it is NOT `firm_treasury`**');
  });

  test('LT-07 CREDITS the cash account, so its open slot is a DEBIT', () => {
    expect(M05).toContain(
      '| LT-07 | `wallet_withdrawal_settlement` | **credit `firm_treasury` `amount_cents`**; ' +
        'the debit leg is NOT RULED.',
    );
  });

  test('the wallet position is a liability and the cash account is an asset, IN FORCE', () => {
    // Not read out of ADR-177 and ADR-180 as prose. Read out of the constraint
    // the migration set installs, which is what the database will enforce.
    expect(KIND_IN_FORCE['trader_wallet']).toBe('liability');
    expect(KIND_IN_FORCE['firm_treasury']).toBe('asset');
  });

  // So: `LT-06` credits the open slot `amount_cents`, and a credit increases a
  // liability, a revenue or an equity. `LT-07` debits the same slot, which
  // decreases it, in the same transaction that credits cash away. An account
  // that rises when a claim is extinguished and falls when the cash leaves is an
  // obligation. It is not revenue -- nothing is earned when a trader moves their
  // own money -- and it is not equity, which moves on a capital event.
  test('and the role is therefore a LIABILITY, which is what ADR-174 clause 4 named', () => {
    expect(ADR_174).toContain('THE EXTERNAL LEG NEEDS A THIRD ACCOUNT ROLE');
    expect(ADR_174).toContain('an obligation exists between the two moments and must be recorded');
  });

  test('and it is FIRM-SCOPED, because ADR-174 clause 3 kept LT-07 firm-only', () => {
    expect(ADR_174).toContain('`LT-07` stays firm-only');
  });
});

describe('none of the SEVEN could hold it, and the eighth is the one that does', () => {
  test('there are exactly five firm codes and three per-identity codes', () => {
    // FOUR UNTIL ADR-187. The eighth code is firm-scoped, because ADR-174 clause
    // 3 rules that `LT-07` stays firm-only -- on arithmetic, not on scope -- and
    // an identity-scoped in-flight position would make `LT-07` visible to an
    // identity-scoped check, which is the exact property ADR-124 clause 3's
    // conclusion depends on.
    expect(FIRM_CODES).toHaveLength(5);
    expect(IDENTITY_CODES).toHaveLength(3);
  });

  test('every liability OTHER than the minted one is per identity', () => {
    // THIS CASE WENT RED WHEN `0056` LANDED AND THE SESSION CAME HERE TO SAY SO.
    //
    // It used to read "every code the chart rules a liability is per identity, so
    // none is firm-scoped", which was ADR-181's ELIMINATION: the step proving
    // that no declared code could hold the external leg's in-flight obligation.
    // THE ELIMINATION SUCCEEDED, and ADR-187 minted the code it proved was
    // missing. A case asserting the absence after that is asserting the absence
    // of the thing the ruling exists to create.
    //
    // WHAT SURVIVES IS THE HALF THAT WAS LOAD-BEARING: every OTHER liability in
    // the chart is a trader's position, so the firm's obligation to pay a
    // withdrawal onward has exactly one home and shadows none of the seven. That
    // was ADR-181 section 8's stated worry about minting -- "a class Merit will
    // carry forever for a role one of the seven already had" -- and it is the
    // property that refuses it.
    const liabilities = LEDGER_ACCOUNT_CODES.filter((code) => KIND_IN_FORCE[code] === 'liability');
    expect(liabilities.length).toBeGreaterThan(0);
    for (const code of liabilities) {
      if (code === 'withdrawals_in_flight') continue;
      expect(LEDGER_ACCOUNT_SCOPE[code], code).toBe('identity');
    }
    expect(liabilities.filter((code) => LEDGER_ACCOUNT_SCOPE[code] === 'firm')).toStrictEqual([
      'withdrawals_in_flight',
    ]);
  });

  test('every firm code is ruled, and exactly one of them is the obligation', () => {
    // THIS CASE HAS NOW GONE RED TWICE AND EACH SESSION CAME HERE TO SAY SO.
    //
    // ADR-186: it used to read "TWO REFUSALS AND NOT ONE. Two firm codes are
    // RULED something else, and two fall through the constraint's `ELSE true`
    // and are ruled nothing at all. A silence is not an opening." That entry
    // ruled `psp_clearing` and `reserve` both `asset` and closed the ELSE.
    //
    // ADR-187: it then read "no firm code carries a liability", which was
    // ADR-181's elimination held BY THE CONSTRAINT rather than by an argument.
    // The elimination is what proved the eighth code necessary, and `0056` mints
    // it, so that clause is now false by construction and by design.
    //
    // WHAT SURVIVES ACROSS BOTH IS THE TOTALITY, WHICH IS THE PART THAT GUARDS
    // ANYTHING: every firm code is RULED, none is silent, and the single firm
    // liability is the one minted for the role. `psp_clearing` and `reserve`
    // still cannot hold it, so ADR-174 section 3 shape (iii) stays
    // unrepresentable and the mint did not reopen it.
    const ruled = FIRM_CODES.filter((code) => KIND_IN_FORCE[code] !== undefined);
    const silent = FIRM_CODES.filter((code) => KIND_IN_FORCE[code] === undefined);
    expect(ruled).toHaveLength(5);
    expect(silent).toHaveLength(0);
    for (const code of FIRM_CODES) {
      if (code === 'withdrawals_in_flight') {
        expect(KIND_IN_FORCE[code], code).toBe('liability');
        continue;
      }
      expect(KIND_IN_FORCE[code], code).not.toBe('liability');
    }
    // The ELSE arm REFUSES now, and it is present rather than deleted: a CASE
    // with no ELSE returns NULL for an unmatched code and a CHECK passes on
    // NULL, which is `ELSE true` wearing a different word.
    expect(KIND_CONSTRAINTS[KIND_CONSTRAINTS.length - 1] as string).toMatch(/ELSE\s+false/);
    expect(KIND_CONSTRAINTS[KIND_CONSTRAINTS.length - 1] as string).not.toMatch(/ELSE\s+true/);
  });

  test('the two former silences are ruled on what the tree says they are, and both are assets', () => {
    // `psp_clearing` IS STATED TWICE IN SHIPPED SOURCE AND BOTH STATEMENTS ARE
    // ASSET-SHAPED. ADR-177 and ADR-181 each quoted only the second.
    const checkout = read('apps', 'api', 'src', 'routes', 'checkout.ts');
    // The one ADR-181 read: a receivable, which is an ASSET.
    expect(checkout).toContain(
      'would book a receivable from a processor that was never asked for money',
    );
    // The one it did not, one line above: an account that HOLDS something when a
    // processor is present. That is ADR-181 section 8's "funds held at a payment
    // provider", which that entry called the coherent alternative not written in
    // this tree. It is written in this tree.
    // The line wraps inside a JSDoc block, so the assertion spans the wrap
    // rather than pinning one column of it.
    expect(checkout).toMatch(
      /There is no processor in this[\s*\n]+transaction, so there is nothing in clearing/,
    );
    // `reserve`: GLOSSARY calls it funds, and the `equity` reading is refused on
    // the anchor -- a provider API reports cash it holds, not an appropriation.
    expect(read('docs', 'GLOSSARY.md')).toContain('Funds set aside to cover projected payouts');
    expect(read('packages', 'db', 'migrations', '0009_ledger.sql')).toContain(
      "source         text NOT NULL CHECK (source IN ('provider_api','manual_attestation'))",
    );
    // And SD-M5-03's anchor still holds: the figure is outside this ledger, which
    // is why ruling the kind is NOT the same act as seeding a row.
    expect(read('packages', 'db', 'migrations', '0009_ledger.sql')).toContain(
      'it from our own ledger makes it a number that agrees with itself, so it is',
    );
  });
});

// -----------------------------------------------------------------------------
// THE PRICE OF THE EIGHTH CODE, REGISTERED AND THEN SCANNED FOR
// -----------------------------------------------------------------------------

interface Site {
  /** Repository-relative path, in POSIX spelling. */
  readonly path: string;
  /** Whether a mint MUST move this text, or merely quotes it while arguing. */
  readonly kind: 'normative' | 'citation';
  /** Why it is one or the other. */
  readonly why: string;
}

/**
 * Every file that enumerates the WHOLE vocabulary, inside the directories where
 * a normative statement of it can live.
 *
 * `docs/decisions`, `docs/sessions`, `docs/plans` and `docs/STATE.md` are OUT OF
 * THE SCAN and deliberately so: an entry quoting the seven codes while ruling
 * one of them is a citation, and every future entry that does it would otherwise
 * turn this red for saying something true.
 */
const ENUMERATES_ALL: readonly Site[] = [
  {
    path: 'packages/db/migrations/0056_eighth_ledger_code.sql',
    kind: 'normative',
    why: "ADR-187's mint. It re-declares the WHOLE vocabulary three times in one transaction -- ledger_accounts_code_is_declared, LEDGER-C2's function body and ledger_accounts_kind_matches_code -- and it is the migration in force, so it is the only migration in this list. Its ELSE is still `false`, so a ninth code is refused until its kind is ruled in the migration that mints it",
  },
  {
    path: 'packages/ledger/src/accounts.ts',
    kind: 'normative',
    why: 'the third statement, and the ONLY place the firm/identity partition is written',
  },
  {
    path: 'packages/ledger/test/chart-of-accounts-kinds.test.ts',
    kind: 'normative',
    why: 'RULED, the kind ruling typed out. It carried a REFUSED list beside it until ADR-186 emptied it',
  },
  {
    path: 'packages/ledger/test/pt-03-ledger-zero-sum.property.test.ts',
    kind: 'normative',
    why: 'FIRM_CODES and IDENTITY_CODES are hand-kept generator inputs. A code missing from them is a code the property test never generates, and NOTHING ELSE would say so -- `tsc` least of all, since a list short of a union member is a well typed shorter list',
  },
  {
    path: 'packages/rail/test/lt-07.test.ts',
    kind: 'normative',
    why: "the vocabulary in force and the constraint's arms, in a package this session does not own. ADR-187 repaired it to read the LAST migration that declares the codes rather than 0009 by name",
  },
  {
    path: 'docs/GLOSSARY.md',
    kind: 'normative',
    why: "0027's own comment names GLOSSARY's class list as what caught `firm_payable`. It is the control, and a mint that leaves it saying seven has disabled the control",
  },
  {
    path: 'docs/architecture/data-model/ledger_accounts.md',
    kind: 'normative',
    why: 'the data model page for the table, an approved architecture document',
  },
];

/**
 * MIGRATIONS THAT DECLARED THE VOCABULARY AND ARE NOW SUPERSEDED.
 *
 * THESE ARE NOT SITES A MINT MOVES. E2 makes a merged migration unamendable:
 * it is superseded, never edited. Each of these states the vocabulary AS OF ITS
 * OWN TIME, and the assertion owed to it is the OPPOSITE of the one owed to a
 * live file -- that it still says exactly what it said, and does not name a code
 * minted after it.
 *
 * `declared` is the count each one stated, quoted from the file rather than
 * computed, so a reader can see the sequence without opening seven migrations.
 */
const SUPERSEDED: readonly {
  readonly path: string;
  readonly declared: number;
  readonly why: string;
}[] = [
  {
    path: 'packages/db/migrations/0009_ledger.sql',
    declared: 7,
    why: 'the original ledger_accounts_code_is_declared, superseded by 0056',
  },
  {
    path: 'packages/db/migrations/0027_triggers_invariants.sql',
    declared: 7,
    why: "LEDGER-C2's first function body, superseded by 0056's CREATE OR REPLACE",
  },
  {
    path: 'packages/db/migrations/0052_chart_of_accounts.sql',
    declared: 7,
    why: 'its header argues four kinds and quotes the vocabulary while doing so',
  },
  {
    path: 'packages/db/migrations/0053_firm_treasury_kind.sql',
    declared: 7,
    why: "ADR-180's header, the same shape: it quotes the seven while ruling one code's kind",
  },
  {
    path: 'packages/db/migrations/0055_last_two_ledger_kinds.sql',
    declared: 7,
    why: "ADR-186's CASE named all seven and closed its ELSE to `false`, which is the guard that forced 0056 to rule a kind in the same statement that declared a name",
  },
];

/**
 * FILES THAT NAME AN UNDECLARED CODE AS A LIVE FIXTURE.
 *
 * THE SCAN CANNOT SEE THESE AT ALL and that is why they need their own list: a
 * file naming a code that is deliberately NOT in the vocabulary enumerates
 * neither the whole set nor the firm subset. Minting one of these spellings does
 * not make such a file incomplete -- it makes it assert the OPPOSITE of what it
 * says, silently, because the guard it was watching refuse the row now accepts
 * it. That is ADR-181 section 4's stated reason for refusing `firm_payable` in
 * advance, generalised to every fixture of the shape.
 */
const NEGATIVE_FIXTURES: readonly {
  readonly path: string;
  readonly code: string;
  readonly why: string;
}[] = [
  {
    path: 'scripts/db/probe_ledger_constraints.sql',
    code: 'firm_payable',
    why: "LEDGER-C2's negative fixture, and the class ADR-027's first draft invented. 0027 records that reading GLOSSARY's class list is what caught it",
  },
  {
    path: 'scripts/db/probe_ledger_constraints.sql',
    code: 'withdrawals_payable',
    why: "LEDGER-K1c's undeclared-code fixture, added by ADR-186. It is the spelling ADR-181 section 5 row 1 and ADR-186 section 7 row 6 each fired at a database AS the eighth code, so it is the fixture a mint was most likely to collide with, and ADR-187 moved its name rather than this probe",
  },
];

/**
 * Files that enumerate the FIRM SUBSET exhaustively.
 *
 * An eighth code that is firm-scoped makes each of these incomplete WITHOUT
 * making it contradict anything, which is the quiet half of the price. Two are
 * shipped source in `packages/db`, which this session does not own.
 */
const ENUMERATES_FIRM: readonly Site[] = [
  {
    path: 'packages/db/src/schema.ts',
    kind: 'normative',
    why: 'the argument for classing ledger_accounts `owned` names the firm rows one by one',
  },
  {
    path: 'packages/db/src/scope.ts',
    kind: 'normative',
    why: "the accessor's `why` string for the nullable scope column, which is shipped and is read at a gate",
  },
  {
    path: 'apps/api/src/routes/checkout.ts',
    kind: 'normative',
    why: "LT-08's lookup argument eliminates the other three firm codes by name",
  },
];

/**
 * Sentences stating the CARDINALITY, which a mint makes false without touching a
 * code name. Quoted rather than pattern-matched, and the quotes carry no code
 * names, so this registry is not a further copy of the vocabulary.
 */
const COUNT_CLAIMS: readonly { readonly path: string; readonly quote: string }[] = [
  { path: 'docs/GLOSSARY.md', quote: '**Eight v1 classes**' },
  { path: 'docs/architecture/data-model/ledger_accounts.md', quote: 'Eight v1 classes' },
  {
    path: 'docs/architecture/data-model/ledger_accounts.md',
    quote: 'check in the eight declared codes',
  },
  {
    path: 'docs/architecture/data-model/README.md',
    quote: '**Every entry resolves to one of the eight declared classes**',
  },
  { path: 'apps/api/src/routes/checkout.ts', quote: 'closes the chart at eight codes' },
  { path: 'packages/ledger/src/chart.ts', quote: 'five firm rows plus up to three per identity' },
];

// `packages/ledger/test/accounts.test.ts` USED TO BE THE SEVENTH CLAIM AND IS
// DELIBERATELY NOT THE EIGHTH. Its quote was `'0009 declares seven codes').toBe(7)`,
// a cardinality TYPED into a file whose whole subject is that hand-kept copies
// drift. ADR-187 replaced it with `.toBe(LEDGER_ACCOUNT_CODES.length)`, derived
// from the package, so there is no longer a number there to keep true. The
// cardinality is asserted once, below, against this package.

/** The directories a normative statement can live in. Entries and logs are out. */
const SCANNED: readonly string[] = [
  'apps',
  'packages',
  'scripts',
  join('docs', 'architecture'),
  'docs/GLOSSARY.md',
];

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.turbo']);
const READABLE = /\.(ts|mts|js|mjs|sql|md|json)$/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (READABLE.test(entry)) out.push(full);
  }
}

const SCAN_FILES: readonly string[] = SCANNED.flatMap((target) => {
  const full = join(ROOT, target);
  if (statSync(full).isDirectory()) {
    const found: string[] = [];
    walk(full, found);
    return found;
  }
  return [full];
});

/**
 * The files in which some window of `window` consecutive lines names every code
 * in `codes`. The heuristic is stated rather than tuned: a list of codes written
 * one per line is the widest shape any site in this tree uses.
 */
function enumerating(codes: readonly string[], window: number): readonly string[] {
  const hits: string[] = [];
  for (const file of SCAN_FILES) {
    const text = readFileSync(file, 'utf8');
    if (!codes.every((code) => text.includes(code))) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const chunk = lines.slice(i, i + window).join('\n');
      if (codes.every((code) => chunk.includes(code))) {
        hits.push(relative(ROOT, file).split(sep).join('/'));
        break;
      }
    }
  }
  return hits.sort();
}

describe('the price of the eighth code, registered and scanned for in both directions', () => {
  test('the registry names every LIVE file that enumerates the whole vocabulary, and no other', () => {
    // The superseded migrations drop out of this scan the moment the vocabulary
    // widens, because they state the OLD set and no longer name every code. That
    // is not a gap: it is what supersession looks like from here, and it is
    // asserted from the other side in the case below.
    expect(enumerating(LEDGER_ACCOUNT_CODES, 12)).toStrictEqual(
      [...ENUMERATES_ALL].map((site) => site.path).sort(),
    );
  });

  test('every superseded migration still says what it said, and names no code minted after it', () => {
    // E2: A MERGED MIGRATION IS NEVER EDITED, ONLY SUPERSEDED. This is the
    // assertion the old shape could not make. It required these files to contain
    // every CURRENT code, which is satisfiable only by editing them, and their
    // own registry entries said "Superseded, never edited" at the same time.
    //
    // What is asserted instead: each one still declares the count it declared,
    // and none of them names a code that did not exist when it merged. An edit to
    // a merged migration turns this red, which is the property that was actually
    // wanted.
    const bySeq = [...SUPERSEDED].map((site) => site.path).sort();
    expect([...SUPERSEDED].map((site) => site.path)).toStrictEqual(bySeq);
    for (const site of SUPERSEDED) {
      const text = read(...site.path.split('/'));
      const named = LEDGER_ACCOUNT_CODES.filter((code) => text.includes(code));
      expect(named.length, `${site.path} declared ${String(site.declared)}`).toBe(site.declared);
      expect(site.why.length, site.path).toBeGreaterThan(40);
    }
  });

  test('the newest migration is the only one in the live registry, and it supersedes the rest', () => {
    // A mint that added its migration to the live list WITHOUT retiring the one
    // before it would leave two files claiming to state the vocabulary in force,
    // which is the state `chart-of-accounts-kinds.test.ts` exists to refuse for
    // the kind constraint. Exactly one migration is live here.
    const liveMigrations = ENUMERATES_ALL.filter((site) =>
      site.path.startsWith('packages/db/migrations/'),
    );
    expect(liveMigrations).toHaveLength(1);
    const live = liveMigrations[0] as Site;
    for (const site of SUPERSEDED) {
      if (!site.path.startsWith('packages/db/migrations/')) continue;
      expect(site.path < live.path, `${site.path} precedes ${live.path}`).toBe(true);
    }
  });

  test('every negative fixture still names a code the vocabulary does NOT declare', () => {
    // THE CATEGORY THE SCAN IS BLIND TO. A file naming an undeclared code
    // enumerates neither the whole vocabulary nor the firm subset, so neither
    // direction of `enumerating` can see it. Minting one of these spellings does
    // not make the file incomplete; it makes it assert the opposite of what it
    // says, because the guard it watches refuse the row would accept it.
    for (const fixture of NEGATIVE_FIXTURES) {
      expect(read(...fixture.path.split('/')), fixture.path).toContain(fixture.code);
      expect(
        (LEDGER_ACCOUNT_CODES as readonly string[]).includes(fixture.code),
        `${fixture.code} is a live negative fixture in ${fixture.path} and must stay undeclared`,
      ).toBe(false);
      expect(fixture.why.length, fixture.code).toBeGreaterThan(40);
    }
  });

  test('the registry names every file that enumerates the firm subset, and no other', () => {
    // A tighter window than the whole vocabulary needs, because four names in
    // twelve lines is a coincidence a prose paragraph produces and eight is not.
    // The superseded migrations are excluded here too: they state the firm subset
    // as it was, and a widened subset is not something they can be asked to say.
    const superseded = new Set(SUPERSEDED.map((site) => site.path));
    const found = enumerating(FIRM_CODES, 3).filter(
      (path) => !ENUMERATES_ALL.some((site) => site.path === path) && !superseded.has(path),
    );
    expect(found).toStrictEqual([...ENUMERATES_FIRM].map((site) => site.path).sort());
  });

  test('every live registered site still states exactly the set it is registered for', () => {
    for (const site of ENUMERATES_ALL) {
      const text = read(...site.path.split('/'));
      for (const code of LEDGER_ACCOUNT_CODES) expect(text, site.path).toContain(code);
    }
    for (const site of ENUMERATES_FIRM) {
      const text = read(...site.path.split('/'));
      for (const code of FIRM_CODES) expect(text, site.path).toContain(code);
    }
  });

  test('every cardinality claim still reads as it is quoted here', () => {
    for (const claim of COUNT_CLAIMS) {
      expect(read(...claim.path.split('/')), claim.path).toContain(claim.quote);
    }
    // The claims say eight and five, and this is what makes them claims about
    // THIS package rather than a number somebody typed.
    expect(LEDGER_ACCOUNT_CODES).toHaveLength(8);
    expect(FIRM_CODES).toHaveLength(5);
  });

  test('the registry states its own size, so the price is a number and not an impression', () => {
    // A PRICE NOBODY CAN QUOTE IS NOT A PRICE. Every entry above is a claim about
    // one file, and this is the only place the SET's size is stated, derived from
    // the lists themselves rather than typed beside them. An entry added or
    // dropped moves this number, so a session reporting "the registry names N
    // sites" is reporting something a control checked.
    const sizes = {
      live: ENUMERATES_ALL.length,
      superseded: SUPERSEDED.length,
      firm: ENUMERATES_FIRM.length,
      negativeFixtures: NEGATIVE_FIXTURES.length,
      countClaims: COUNT_CLAIMS.length,
    };
    expect(sizes).toStrictEqual({
      live: 7,
      superseded: 5,
      firm: 3,
      negativeFixtures: 2,
      countClaims: 6,
    });

    // AND THE DISTINCT FILES, WHICH IS THE FIGURE A SESSION PLANNING THE NEXT
    // MINT ACTUALLY NEEDS. Some files carry two entries: a data-model page states
    // the vocabulary AND two cardinalities, and one probe holds two negative
    // fixtures.
    const files = new Set<string>([
      ...ENUMERATES_ALL.map((site) => site.path),
      ...SUPERSEDED.map((site) => site.path),
      ...ENUMERATES_FIRM.map((site) => site.path),
      ...NEGATIVE_FIXTURES.map((fixture) => fixture.path),
      ...COUNT_CLAIMS.map((claim) => claim.path),
    ]);
    expect(files.size).toBe(18);
  });

  test('every registered site carries a reason, because a bare path is not a price', () => {
    for (const site of [...ENUMERATES_ALL, ...ENUMERATES_FIRM]) {
      expect(site.why.length, site.path).toBeGreaterThan(40);
    }
  });

  // THE HALF OF THE PRICE THAT DECIDED ADR-181 NOT TO MINT, AND THAT ADR-187
  // PAID. Of the normative sites, the minting session owns the migrations (by
  // superseding them), this package, and nothing else. The rest are an approved
  // architecture document, an approved glossary, two files in `packages/db/src`,
  // one in `apps/api` and one in `packages/rail` -- six, which is the figure
  // ADR-181 section 4 measured and the figure that was actually paid.
  test('the normative ENUMERATION sites outside this package and the migrations are six', () => {
    const outside = [...ENUMERATES_ALL, ...ENUMERATES_FIRM]
      .filter((site) => site.kind === 'normative')
      .map((site) => site.path)
      .filter(
        (path) =>
          !path.startsWith('packages/ledger/') && !path.startsWith('packages/db/migrations/'),
      )
      .sort();
    expect(outside).toStrictEqual([
      'apps/api/src/routes/checkout.ts',
      'docs/GLOSSARY.md',
      'docs/architecture/data-model/ledger_accounts.md',
      'packages/db/src/schema.ts',
      'packages/db/src/scope.ts',
      'packages/rail/test/lt-07.test.ts',
    ]);
  });
});
