// =============================================================================
// packages/rail/test/lt-07.test.ts
// =============================================================================
// THE THREE REASONS THIS PACKAGE MINTS NO `LT-07`, EACH ASSERTED AGAINST ITS
// PRIMARY SOURCE RATHER THAN STATED IN A COMMENT.
//
// P5 section 8 puts `LT-07` inside this slice and the dispatch allocates this
// session no ADR number, so every one of them is a finding REPORTED. A comment
// reporting a finding goes stale the day the finding is fixed and nothing goes
// red; these go red.
//
// AND THE SIGN, WHICH IS THE ONE THING THE DISPATCH SAID TO ASSERT AND NOT
// ASSUME. Session 288 wrote it inverted on its first draft. `packages/ledger` is
// not a dependency of this package and must not become one, so the convention is
// read out of `posting.ts` AS TEXT, which is that package's own idiom for
// binding a statement it cannot import.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { LT_07_FINDINGS } from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const M05 = read('docs', 'plans', 'M05-payout-system.md');
const LEDGER_SQL = read('packages', 'db', 'migrations', '0009_ledger.sql');
const POSTING = read('packages', 'ledger', 'src', 'posting.ts');
const RAIL_SRC = read('packages', 'rail', 'src', 'settlement.ts');
const PROBE = read('scripts', 'db', 'probe_ledger_constraints.sql');
/** `0052`, ADR-177's seed and the CHECK that ties four kinds to four codes. */
const SEED_MIGRATION = read('packages', 'db', 'migrations', '0052_chart_of_accounts.sql');
/**
 * `0052` with its `--` comments removed.
 *
 * ITS HEADER ARGUES THE RULING AT LENGTH AND QUOTES ITS OWN STATEMENTS WHILE
 * DOING SO, so counting `INSERT INTO ledger_accounts` over the raw file counts
 * the argument as well as the statement. That is not a hypothetical: this case
 * and `chart-of-accounts-kinds.test.ts` each read the prose as SQL on a first
 * draft, in opposite directions, one counting two inserts and one counting none.
 */
const SEED_SQL = SEED_MIGRATION.replace(/--[^\n]*/g, '');
/** `0053`, ADR-180's seed and the constraint that supersedes `0052`'s. */
const KIND_MIGRATION = read('packages', 'db', 'migrations', '0053_firm_treasury_kind.sql');
/** `0053` with its `--` comments removed, for the same reason `SEED_SQL` is. */
const KIND_SQL = KIND_MIGRATION.replace(/--[^\n]*/g, '');
/**
 * EVERY migration's SQL, comments stripped, keyed by file name.
 *
 * THIS EXISTS BECAUSE A CASE BELOW WENT GREEN WHEN IT SHOULD HAVE GONE RED.
 * Finding C's watcher asserted that no file writes a `kind` for
 * `firm_treasury`, and it looped over exactly two sources: the probe and
 * `0052`. ADR-180 wrote that literal into `0053`, and the case passed, because
 * the thing it was watching had moved into a file it was not reading. A watcher
 * pinned to file names watches those files and not the claim.
 */
const MIGRATION_SQL: ReadonlyMap<string, string> = new Map(
  readdirSync(join(ROOT, 'packages', 'db', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => [
      name,
      readFileSync(join(ROOT, 'packages', 'db', 'migrations', name), 'utf8').replace(
        /--[^\n]*/g,
        '',
      ),
    ]),
);

describe('the sign convention, ASSERTED and not assumed', () => {
  test('posting.ts writes +amountCents on the debit and -amountCents on the credit', () => {
    // `packages/ledger/src/posting.ts`, in `entriesOf`. Two lines, adjacent, and
    // they are the only place in this repository a sign is written.
    expect(POSTING).toContain(
      'entries.push({ account: t.debit, amountCents: t.amountCents, memo: t.memo });',
    );
    expect(POSTING).toContain(
      'entries.push({ account: t.credit, amountCents: -t.amountCents, memo: t.memo });',
    );
  });

  test('the schema states the same convention, so the two agree', () => {
    expect(LEDGER_SQL).toContain('-- SIGNED: positive is DEBIT, negative is CREDIT.');
  });

  test('a caller never writes a sign: it names a debit, a credit and a POSITIVE amount', () => {
    expect(POSTING).toContain('a transfer moves a POSITIVE amount and this one is');
  });

  test('this package writes no sign at all, because it posts nothing', () => {
    const sources = ['port.ts', 'webhook.ts', 'replay.ts', 'settlement.ts', 'index.ts'].map(
      (name) => read('packages', 'rail', 'src', name),
    );
    for (const source of sources) {
      expect(source).not.toContain('amountCents: -');
      expect(source).not.toContain('postTransaction');
    }
  });
});

describe('finding A: LT-07s credit leg names an account class that does not exist', () => {
  test('M05 no longer writes LT-07 as debit firm_treasury, and says what it used to say', () => {
    // THIS CASE ASSERTED THE DEFECT AS TEXT AND ADR-180 REPAIRED HALF OF IT,
    // which is what it was armed for. The credit slot finding A is about is
    // STILL OPEN: what moved is the OTHER leg. So the case now asserts the
    // amendment in both directions -- the leg is on the credit side, and the
    // row still quotes what it used to read, because ADR-027's precedent in
    // this table is that a corrected row keeps its defective text visible.
    expect(M05).not.toContain(
      '| LT-07 | `wallet_withdrawal_settlement` | debit `firm_treasury`; credit the payout wallet position.',
    );
    expect(M05).toContain(
      '| LT-07 | `wallet_withdrawal_settlement` | **credit `firm_treasury` `amount_cents`**; ' +
        'the debit leg is NOT RULED.',
    );
    expect(M05).toContain('the row read `debit firm_treasury; credit the payout wallet position`');
  });

  test('0009 declares seven codes and none of them is a pooled payout wallet position', () => {
    const check = LEDGER_SQL.slice(
      LEDGER_SQL.indexOf('ledger_accounts_code_is_declared'),
      LEDGER_SQL.indexOf('ledger_accounts_scope_identity'),
    );
    // `flatMap` and not `map`: a capture group is `string | undefined` under
    // `noUncheckedIndexedAccess`, and a narrowing that drops nothing is honest
    // where a `!` would be a claim about a regex nobody re-reads.
    const codes = [...check.matchAll(/'([a-z_]+)'/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(codes).toStrictEqual([
      'firm_treasury',
      'psp_clearing',
      'fees_revenue',
      'reserve',
      'trader_withdrawable',
      'trader_wallet',
      'promotional_credit',
    ]);
    expect(codes.some((code) => code.includes('payable') || code.includes('payout'))).toBe(false);
  });

  test('SD-M5-07 is why the pooled class went away, and it took LT-01s credit with it', () => {
    expect(M05).toContain(
      'It previously credited the payout wallet position as a firm obligation to pay; ' +
        "it now credits the **identity's `trader_wallet`** position (SD-M5-07)",
    );
  });

  test('trader_wallet is not the substitution, because LT-07 is a FIRM-ONLY posting', () => {
    // ADR-124 names LT-02 and LT-07 as the postings a global halt must refuse
    // precisely because they are the ones an identity-scoped check cannot see.
    const adr124 = read('docs', 'decisions', 'ADR-124.md');
    expect(adr124).toContain(
      '`LT-02` and `LT-07` both move `firm_treasury` against the payout wallet position',
    );
    expect(LEDGER_SQL).toContain("'trader_wallet',         -- per identity.");
  });
});

describe('finding B: the ledger key has two recorded conventions that point opposite ways', () => {
  // THE DOOR COUNT MOVED FROM THREE TO TWO AND FINDING B DID NOT MOVE AT ALL.
  // ADR-176 applied ADR-172 clause 2, so `payouts.ts` records the approval and
  // posts nothing; the CONVENTION under test here -- `LT-01` endpoint-prefixed
  // against `LT-06` bare -- is exactly as it was, and so is the collision the
  // finding reports. This case is rewritten to the tree rather than relaxed:
  // it still names `payouts.ts`, and it now names the COLUMN the two remaining
  // doors compose from, which is what the request path writes in place of the
  // posting it used to make.
  test('LT-01 is posted under the endpoint-prefixed key by every door that posts it', () => {
    const payouts = read('apps', 'api', 'src', 'routes', 'payouts.ts');
    const admin = read('apps', 'api', 'src', 'routes', 'admin-payouts.ts');
    const expiry = read('apps', 'worker', 'src', 'sweeps', 'expiry.ts');

    expect(admin).toContain('return `${PAYOUT_ENDPOINT} ${idempotencyKey}`;');
    expect(expiry).toContain('return `${PAYOUT_ENDPOINT} ${idempotencyKey}`;');

    // The prefix is declared once, where the endpoint is, and the request path
    // stores the UNPREFIXED client token that both doors prefix.
    expect(payouts).toContain('export const PAYOUT_ENDPOINT = `POST ${PAYOUT_PATH}`;');
    expect(payouts).toContain('readonly idempotencyKey: string;');
  });

  test('LT-06s key is recorded as the withdrawals own key and explicitly NOT the endpoints', () => {
    const withdrawals = read('apps', 'api', 'src', 'routes', 'wallet-withdrawals.ts');
    expect(withdrawals).toContain(
      '// the string derived from `wallet_withdrawals.idempotency_key`, which is the',
    );
    expect(withdrawals).toContain(
      '// identity -- NOT one naming this endpoint, because the approval edge is',
    );
    expect(withdrawals).toContain(
      '// key naming this endpoint is how one withdrawal becomes two postings.',
    );
  });

  test('the column is globally unique, so bare would be the string LT-06 already claims', () => {
    expect(LEDGER_SQL).toContain('idempotency_key  text NOT NULL UNIQUE');
  });

  test('so no ledger key is minted here, and the anchors type carries none', () => {
    expect(RAIL_SRC).toContain('THERE IS NO LEDGER IDEMPOTENCY KEY HERE');
    // FINDING B's own claim text QUOTES `${PAYOUT_ENDPOINT}`, so the assertion
    // is about what this package BUILDS rather than about what it mentions. A
    // grep for the word would have gone red on the paragraph reporting the
    // finding, which is the test asserting against its own evidence.
    for (const name of [
      ['port.ts'],
      ['webhook.ts'],
      ['replay.ts'],
      ['settlement.ts'],
      ['index.ts'],
      ['fakes', 'sandbox.ts'],
    ]) {
      const source = read('packages', 'rail', 'src', ...name);
      expect(source, name.join('/')).not.toMatch(/export (function|const) \w*[Ll]edgerKey/);
      expect(source, name.join('/')).not.toContain("from '@merit/ledger'");
    }
    expect(read('packages', 'rail', 'src', 'port.ts')).not.toContain('ledgerKey');
  });
});

describe('finding C: firm_treasurys kind is RULED, and exactly one file writes it', () => {
  test('ledger_accounts.kind is still a five-member CHECK with no per-code mapping', () => {
    // 0009 is unchanged and the tie lives in a later migration, which is what
    // makes the ruling superseded-able instead of an edit to a merged file.
    expect(LEDGER_SQL).toContain(
      "kind         text NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','equity'))",
    );
  });

  test('exactly one migration writes a kind for firm_treasury, and it writes asset', () => {
    // THE PREVIOUS VERSION OF THIS CASE WAS THE ONE MISS OF SESSION 326 AND IT
    // IS RECORDED RATHER THAN QUIETLY REPLACED. It looped over the probe and
    // `0052` by name, so when ADR-180 wrote `'firm_treasury', 'asset'` into
    // `0053` it stayed GREEN, watching two files instead of the claim. It now
    // reads every migration, so the SECOND file to write this literal is what
    // goes red -- which is the shape a re-ruling would take.
    // THE KIND ALTERNATION AND NOT `\w+`, because `0009` and `0027` each write
    // the seven-code vocabulary as a comma-separated list of quoted literals,
    // so `'firm_treasury',\s*'\w+'` matches `'firm_treasury', 'psp_clearing'`
    // in both of them. A pattern that matches the vocabulary cannot tell a
    // ruling from a declaration.
    const KIND = /'firm_treasury',\s*'(?:asset|liability|revenue|expense|equity)'/;
    const writers = [...MIGRATION_SQL].filter(([, sql]) => KIND.test(sql)).map(([name]) => name);
    expect(writers).toStrictEqual(['0053_firm_treasury_kind.sql']);
    expect(KIND_SQL).toContain("'firm_treasury', 'asset', 'firm'");
    expect(KIND_SQL).toMatch(/WHEN\s+'firm_treasury'\s+THEN\s+kind\s*=\s*'asset'/);
    expect(KIND_SQL).not.toMatch(/'firm_treasury'\s+THEN\s+kind\s*=\s*'liability'/);

    // THE PROBE IS STILL NOT A CHART, AND IT IS LESS OF ONE THAN IT WAS.
    //
    // This block used to read: "It seeds the two per-identity positions, because
    // nothing in this tree creates one for an identity, and it writes no kind
    // for firm_treasury at all." `0054` creates them, so the probe now READS the
    // positions instead of asserting them, on ADR-177's own precedent for
    // `fees_revenue` one paragraph up in that file.
    //
    // THE REPAIR WAS NOT COSMETIC AND THE ASSERTION IS STRONGER FOR IT. Left
    // alone, the probe's pinned uuids were skipped by their own
    // ON CONFLICT DO NOTHING and its LEDGER-C1 block raised LEDGER-C2 on a
    // dangling account instead of probing C1: ADR-177's defect, reproduced one
    // code down, watched happening. So the property asserted here is now that
    // the probe writes NO ledger_accounts row for an identity at all.
    expect(PROBE).not.toMatch(/INSERT\s+INTO\s+ledger_accounts[^;]*'identity'/i);
    expect(PROBE).toContain('probe_trader_wallet');
    expect(PROBE).not.toMatch(KIND);
  });

  test('and this package now records the direction, naming the entry that ruled it', () => {
    // ARMED AS THE OPPOSITE ASSERTION. It used to read the words "reported as
    // an ABSENCE and no direction is inferred" out of this package's own
    // source, which was true while nothing had ruled. ADR-180 ruled, so the
    // absence is gone and what must not go missing is the ANSWER.
    //
    // IT READS THE FINDING AND NOT THE FILE, and that is a correction made
    // while seeding defects at this case: `toContain('ADR-180')` over the whole
    // source passed with finding C's own disposition renamed, because the
    // entry is named five other places in the file. A watcher that a defect
    // slides past is measuring the file's vocabulary, not the claim.
    const findingC = LT_07_FINDINGS.find((finding) => finding.id === 'C');
    expect(findingC).toBeDefined();
    expect(findingC?.ruled).toContain('ADR-180');
    expect(findingC?.ruled).toContain('firm_treasury is an ASSET');
    expect(findingC?.ruled).not.toContain('no direction is inferred');
    expect(RAIL_SRC).not.toContain('This is reported as an ABSENCE and no direction is ');
  });
});

describe('the findings are a list a reader can walk, and every source it cites exists', () => {
  test('three findings, lettered A, B and C', () => {
    expect(LT_07_FINDINGS.map((finding) => finding.id)).toStrictEqual(['A', 'B', 'C']);
  });

  test('every cited path is a file that exists', () => {
    for (const finding of LT_07_FINDINGS) {
      for (const source of finding.sources) {
        expect(() => readFileSync(join(ROOT, source), 'utf8'), source).not.toThrow();
      }
    }
  });

  test('every claim is a paragraph rather than a label', () => {
    for (const finding of LT_07_FINDINGS) {
      expect(finding.claim.length, finding.id).toBeGreaterThan(200);
    }
  });
});

// -----------------------------------------------------------------------------
// THE RULINGS, AND WHAT EACH ONE MAKES CHECKABLE
// -----------------------------------------------------------------------------
// Session 315 ruled all three: ADR-174 takes (A) and (C), ADR-175 takes (B).
// NEITHER ENTRY AMENDS A PRIMARY SOURCE THE CASES ABOVE READ, so every one of
// them still passes and none was edited to accommodate a ruling. What is added
// here is the half a ruling makes assertable that a finding did not.
//
// (A)'s ruling turns on a MEASUREMENT rather than on a missing name: LT-06
// credits `firm_treasury` and LT-07 debits it, so the external leg moves that
// account by zero. The two rows are asserted here as TEXT, so the day either is
// repaired this package goes red and the entry has to be re-read. That is the
// same service `finding A` performs for the credit leg, one row over.

describe('the three findings are RULED, and each ruling names its entry', () => {
  test('every finding carries a ruled disposition naming an ADR that exists', () => {
    for (const finding of LT_07_FINDINGS) {
      expect(finding.ruled, finding.id).toMatch(/^ADR-17[45]\b/);
      const adr = /^(ADR-\d+)/.exec(finding.ruled)?.[1];
      expect(adr, finding.id).toBeDefined();
      expect(() => read('docs', 'decisions', `${adr}.md`), finding.id).not.toThrow();
    }
  });

  test('(A) and (C) go to ADR-174 and (B) goes to ADR-175, which is the SPLIT', () => {
    const byId = Object.fromEntries(LT_07_FINDINGS.map((f) => [f.id, f.ruled]));
    expect(byId['A']).toContain('ADR-174');
    expect(byId['C']).toContain('ADR-174');
    expect(byId['B']).toContain('ADR-175');
  });

  test('a ruled disposition is a paragraph, on the same rule the claims are held to', () => {
    for (const finding of LT_07_FINDINGS) {
      expect(finding.ruled.length, finding.id).toBeGreaterThan(200);
    }
  });
});

describe('ADR-174: the measurement the ruling turns on, held against M05', () => {
  test('the zero is GONE, because ADR-180 ruled the kind and both legs moved off it', () => {
    // ARMED BY ADR-174 SECTION 7 AND FIRED BY ADR-180. The measurement was
    // that LT-06 credits firm_treasury and LT-07 debits it, so the external
    // leg moved that account by zero whatever its kind. ADR-180 ruled the
    // account an `asset`, which makes both rows backwards: no cash moves at an
    // approval, so LT-06 names no cash account at all, and cash derecognizes at
    // settlement, so LT-07 CREDITS it. The leg now moves firm_treasury once,
    // downward, which is what a withdrawal does to cash.
    //
    // THE ZERO WAS NEVER EVIDENCE FOR THE RULING and ADR-180 section 1 says so
    // in terms: it holds for every kind. It is asserted here as ABSENT rather
    // than re-derived in the other direction.
    expect(M05).not.toContain('credit `firm_treasury` `amount_cents`.');
    expect(M05).not.toContain('| LT-07 | `wallet_withdrawal_settlement` | debit `firm_treasury`;');
    expect(M05).toContain('**the credit leg is NOT RULED, and it is NOT `firm_treasury`**');
    expect(M05).toContain(
      '| LT-07 | `wallet_withdrawal_settlement` | **credit `firm_treasury` `amount_cents`**;',
    );
  });

  test('and the sign that turns those two words into +a then -a is the one asserted above', () => {
    // Stated twice on purpose: the measurement is worthless if the convention
    // is read backwards, and session 288 read it backwards on a first draft.
    expect(POSTING).toContain(
      'entries.push({ account: t.debit, amountCents: t.amountCents, memo: t.memo });',
    );
    expect(POSTING).toContain(
      'entries.push({ account: t.credit, amountCents: -t.amountCents, memo: t.memo });',
    );
  });

  test('0052 landed and STILL mints no code, so the vocabulary is seven', () => {
    // ADR-174 returned 0052 to the pool and this case asserted it was unspent.
    // ADR-177 took it. The clause that survives is the one that mattered: a
    // ruling on the chart must not widen the vocabulary, and this one does not.
    const migrations = readdirSync(join(ROOT, 'packages', 'db', 'migrations'));
    expect(migrations.filter((name) => name.startsWith('0052'))).toStrictEqual([
      '0052_chart_of_accounts.sql',
    ]);
    expect(SEED_SQL).not.toMatch(/ledger_accounts_code_is_declared/);
    // The eighth-code refusal is stated in TWO merged migrations, and a ruling
    // that minted a code would have had to supersede both.
    // PARSED AND NOT MATCHED AS A PREFIX, and the reason is a seeded defect
    // that got through: `toContain` over the first four codes plus the next
    // three still matches once an EIGHTH is appended after `promotional_credit`,
    // which is the exact widening this case exists to catch. The list is read
    // out of the `NOT IN (...)` and compared whole, the way finding A reads
    // `0009`'s CHECK one describe up.
    const triggers = read('packages', 'db', 'migrations', '0027_triggers_invariants.sql');
    const notIn = triggers.slice(
      triggers.indexOf('IF acct_code NOT IN ('),
      triggers.indexOf('LEDGER-C2: ledger_account % has undeclared class'),
    );
    const declared = [...notIn.matchAll(/'([a-z_]+)'/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(declared).toStrictEqual([
      'firm_treasury',
      'psp_clearing',
      'fees_revenue',
      'reserve',
      'trader_withdrawable',
      'trader_wallet',
      'promotional_credit',
    ]);
  });

  test('and the allocation row says the number went back to the pool', () => {
    const allocation = read('docs', 'decisions', 'ALLOCATION.md');
    expect(allocation).toContain(
      '**`0052` IS NOT TAKEN AND THE NUMBER RETURNS TO THE POOL UNSPENT',
    );
  });
});

describe('ADR-174 section 4: the absence is down to two codes and both are silences', () => {
  test('two migrations seed the chart, one row each, and both rows are firm-scoped', () => {
    // THIS CASE ASSERTED AN EMPTY LIST, ADR-177 FILLED IT, ADR-180 EXTENDED IT
    // AND ADR-183 EXTENDS IT AGAIN. Each step was armed by the one before, which
    // is what ADR-174 section 7 built it for, and each has had to come here and
    // say so.
    //
    // ITS SECOND SENTENCE USED TO READ: "A migration has no identity to seed
    // against, so the three per-identity classes still have no writer anywhere
    // in this tree." `0054` is the writer, and it needs no identity to seed
    // against because it does not seed: a trigger takes `NEW.id` and a backfill
    // joins to `identities`. That sentence is the finding ADR-183 exists to make
    // false, and it is quoted here rather than deleted.
    const seeding = [...MIGRATION_SQL]
      .filter(([, sql]) => /INSERT\s+INTO\s+ledger_accounts/i.test(sql))
      .map(([name]) => name);
    expect(seeding).toStrictEqual([
      '0052_chart_of_accounts.sql',
      '0053_firm_treasury_kind.sql',
      '0054_identity_ledger_accounts.sql',
    ]);
    expect(SEED_SQL.match(/INSERT\s+INTO\s+ledger_accounts/gi)).toHaveLength(1);
    expect(KIND_SQL.match(/INSERT\s+INTO\s+ledger_accounts/gi)).toHaveLength(1);
    expect(SEED_SQL).toContain("'fees_revenue', 'revenue', 'firm'");
    expect(KIND_SQL).toContain("'firm_treasury', 'asset', 'firm'");

    // AND THE TWO FIRM SEEDS STAY FIRM SEEDS. `0054` is the only writer that is
    // identity scoped, and neither of the other two gained a second row, which
    // is the half of this case that was never about the count.
    expect(SEED_SQL).not.toMatch(/'identity'/);
    expect(KIND_SQL).not.toMatch(/'identity'/);
  });

  test('0009 still ties no kind to a code, and the tie in force names five', () => {
    // 0009's CHECK is on the ROW and a constraint tying the two would name both
    // columns in one expression. That is still true OF 0009, and the tie lives
    // in the LAST migration to install the constraint, which is why this case
    // reads for that rather than for one file name.
    expect(LEDGER_SQL).not.toMatch(/CHECK\s*\([^)]*\bcode\b[^)]*\bkind\b/is);
    const installers = [...MIGRATION_SQL].filter(([, sql]) =>
      sql.includes('ADD CONSTRAINT ledger_accounts_kind_matches_code'),
    );
    const inForce = installers[installers.length - 1]?.[1] ?? '';
    const arms = [...inForce.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+kind\s*=/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect([...arms].sort()).toStrictEqual([
      'fees_revenue',
      'firm_treasury',
      'promotional_credit',
      'trader_wallet',
      'trader_withdrawable',
    ]);
    // WHAT IS STILL OPEN, and both are SILENCES rather than contradictions:
    // nothing posts against either, and nothing reads `reserve` at all.
    expect(arms).not.toContain('psp_clearing');
    expect(arms).not.toContain('reserve');
    expect(inForce).toMatch(/ELSE\s+true/);
  });
});

describe('ADR-175: the key is ruled and this package still mints none', () => {
  test('the entry rules the kind-prefixed spelling, and names it', () => {
    const adr175 = read('docs', 'decisions', 'ADR-175.md');
    expect(adr175).toContain('`wallet_withdrawal_settlement <the withdrawal');
    expect(adr175).toContain('NAMES THE EVENT IT POSTS AND NEVER THE DOOR THAT REACHED IT');
  });

  test('LT-01s three doors are NOT re-spelled, so finding B first case still holds', () => {
    // The ruling is forward-only. Had it re-spelled them, the case above that
    // reads all three strings would have gone red, and this states that the
    // green is intended rather than accidental.
    const adr175 = read('docs', 'decisions', 'ADR-175.md');
    expect(adr175).toContain('THREE DOORS ARE NOT RE-SPELLED');
  });

  test('and the port still holds no ledger key, because the receiver mints it', () => {
    for (const name of ['port.ts', 'webhook.ts', 'replay.ts', 'settlement.ts', 'index.ts']) {
      const source = read('packages', 'rail', 'src', name);
      expect(source, name).not.toMatch(/export (function|const) \w*[Ll]edgerKey/);
    }
  });
});
