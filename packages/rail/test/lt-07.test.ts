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

import { readFileSync } from 'node:fs';
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
  test('M05 writes LT-07 as debit firm_treasury, credit the payout wallet position', () => {
    expect(M05).toContain(
      '| LT-07 | `wallet_withdrawal_settlement` | debit `firm_treasury`; credit the payout wallet position.',
    );
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
  test('LT-01 is posted under the endpoint-prefixed key by three doors', () => {
    const payouts = read('apps', 'api', 'src', 'routes', 'payouts.ts');
    const admin = read('apps', 'api', 'src', 'routes', 'admin-payouts.ts');
    const expiry = read('apps', 'worker', 'src', 'sweeps', 'expiry.ts');

    expect(payouts).toContain('idempotencyKey: `${PAYOUT_ENDPOINT} ${idempotencyKey}`');
    expect(admin).toContain('return `${PAYOUT_ENDPOINT} ${idempotencyKey}`;');
    expect(expiry).toContain('return `${PAYOUT_ENDPOINT} ${idempotencyKey}`;');
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

describe('finding C: firm_treasurys kind is written in no file in this tree', () => {
  test('ledger_accounts.kind is a five-member CHECK with no per-code mapping', () => {
    expect(LEDGER_SQL).toContain(
      "kind         text NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','equity'))",
    );
  });

  test('the only INSERT into ledger_accounts anywhere seeds three codes, and not this one', () => {
    expect(PROBE).toContain("'trader_withdrawable','liability'");
    expect(PROBE).toContain("'trader_wallet','liability'");
    expect(PROBE).toContain("'fees_revenue','revenue'");
    expect(PROBE).not.toContain("'firm_treasury','asset'");
    expect(PROBE).not.toContain("'firm_treasury','liability'");
  });

  test('and this package infers no direction from that absence', () => {
    expect(RAIL_SRC).toContain('This is reported as an ABSENCE and no direction is ');
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
