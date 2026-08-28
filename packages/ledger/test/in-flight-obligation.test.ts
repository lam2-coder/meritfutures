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

describe('no code in the chart can hold it, and each refusal has its own step', () => {
  test('there are exactly four firm codes and three per-identity codes', () => {
    expect(FIRM_CODES).toHaveLength(4);
    expect(IDENTITY_CODES).toHaveLength(3);
  });

  test('every code the chart rules a liability is per identity, so none is firm-scoped', () => {
    const liabilities = LEDGER_ACCOUNT_CODES.filter((code) => KIND_IN_FORCE[code] === 'liability');
    expect(liabilities.length).toBeGreaterThan(0);
    for (const code of liabilities) {
      expect(LEDGER_ACCOUNT_SCOPE[code], code).toBe('identity');
    }
  });

  test('and no firm code carries a liability, whether it is ruled or still silent', () => {
    // TWO REFUSALS AND NOT ONE. Two firm codes are RULED something else, and two
    // fall through the constraint's `ELSE true` and are ruled nothing at all.
    // A silence is not an opening: ADR-181 refuses both on what the tree says
    // they ARE, and the ELSE arm is where that open question is stored.
    const ruled = FIRM_CODES.filter((code) => KIND_IN_FORCE[code] !== undefined);
    const silent = FIRM_CODES.filter((code) => KIND_IN_FORCE[code] === undefined);
    expect(ruled).toHaveLength(2);
    expect(silent).toHaveLength(2);
    for (const code of FIRM_CODES) {
      expect(KIND_IN_FORCE[code], code).not.toBe('liability');
    }
    expect(KIND_CONSTRAINTS[KIND_CONSTRAINTS.length - 1] as string).toMatch(/ELSE\s+true/);
  });

  test('the two silences are refused on what the tree says they are, not on the silence', () => {
    // `psp_clearing`: the only statement of its nature in shipped source calls
    // crediting it booking a receivable, and a receivable is an ASSET.
    expect(read('apps', 'api', 'src', 'routes', 'checkout.ts')).toContain(
      'would book a receivable from a processor that was never asked for money',
    );
    // `reserve`: the figure is anchored OUTSIDE this ledger on purpose, so
    // giving it a posting is what SD-M5-03 refuses in terms.
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
    path: 'packages/db/migrations/0009_ledger.sql',
    kind: 'normative',
    why: 'ledger_accounts_code_is_declared, the primary guard. Superseded, never edited',
  },
  {
    path: 'packages/db/migrations/0027_triggers_invariants.sql',
    kind: 'normative',
    why: "LEDGER-C2's trigger body, the second line. Superseded, never edited",
  },
  {
    path: 'packages/db/migrations/0052_chart_of_accounts.sql',
    kind: 'citation',
    why: 'its header argues four kinds and quotes the vocabulary while doing so',
  },
  {
    path: 'packages/db/migrations/0053_firm_treasury_kind.sql',
    kind: 'citation',
    why: "ADR-180's header, the same shape: it quotes the seven while ruling one code's kind",
  },
  {
    path: 'packages/ledger/src/accounts.ts',
    kind: 'normative',
    why: 'the third statement, and the ONLY place the firm/identity partition is written',
  },
  {
    path: 'packages/ledger/test/chart-of-accounts-kinds.test.ts',
    kind: 'normative',
    why: 'RULED and REFUSED, the two halves of the kind ruling, typed out',
  },
  {
    path: 'packages/ledger/test/pt-03-ledger-zero-sum.property.test.ts',
    kind: 'normative',
    why: 'FIRM_CODES and IDENTITY_CODES are hand-kept generator inputs. A code missing from them is a code the property test never generates, and NOTHING ELSE would say so',
  },
  {
    path: 'packages/rail/test/lt-07.test.ts',
    kind: 'normative',
    why: "two toStrictEqual over 0009's CHECK and 0027's NOT IN, in a package this session does not own",
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
  { path: 'docs/GLOSSARY.md', quote: '**Seven v1 classes**' },
  { path: 'docs/architecture/data-model/ledger_accounts.md', quote: 'Seven v1 classes' },
  {
    path: 'docs/architecture/data-model/ledger_accounts.md',
    quote: 'check in the seven declared codes',
  },
  {
    path: 'docs/architecture/data-model/README.md',
    quote: '**Every entry resolves to one of the seven declared classes**',
  },
  { path: 'apps/api/src/routes/checkout.ts', quote: 'closes the chart at seven codes' },
  { path: 'packages/ledger/src/chart.ts', quote: 'four firm rows plus up to three per identity' },
  { path: 'packages/ledger/test/accounts.test.ts', quote: "'0009 declares seven codes').toBe(7)" },
];

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
  test('the registry names every file that enumerates the whole vocabulary, and no other', () => {
    expect(enumerating(LEDGER_ACCOUNT_CODES, 12)).toStrictEqual(
      [...ENUMERATES_ALL].map((site) => site.path).sort(),
    );
  });

  test('the registry names every file that enumerates the firm subset, and no other', () => {
    // A tighter window than the whole vocabulary needs, because four names in
    // twelve lines is a coincidence a prose paragraph produces and seven is not.
    const found = enumerating(FIRM_CODES, 3).filter(
      (path) => !ENUMERATES_ALL.some((site) => site.path === path),
    );
    expect(found).toStrictEqual([...ENUMERATES_FIRM].map((site) => site.path).sort());
  });

  test('every registered site still states exactly the set it is registered for', () => {
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
    // The claims say seven and four, and this is what makes them claims about
    // THIS package rather than a number somebody typed.
    expect(LEDGER_ACCOUNT_CODES).toHaveLength(7);
    expect(FIRM_CODES).toHaveLength(4);
  });

  test('every registered site carries a reason, because a bare path is not a price', () => {
    for (const site of [...ENUMERATES_ALL, ...ENUMERATES_FIRM]) {
      expect(site.why.length, site.path).toBeGreaterThan(40);
    }
  });

  // THE HALF OF THE PRICE THAT DECIDED ADR-181 NOT TO MINT. Of the normative
  // sites, this session owns the two migrations (by superseding them), this
  // package, and nothing else. The rest are an approved architecture document,
  // an approved glossary, two files in `packages/db/src` and one in `apps/api`.
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
