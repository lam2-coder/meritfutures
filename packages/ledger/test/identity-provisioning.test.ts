// =============================================================================
// packages/ledger/test/identity-provisioning.test.ts
// =============================================================================
// THE FOURTH COPY OF THE PER-IDENTITY VOCABULARY IS CHECKED AGAINST THE ONE
// THIS PACKAGE HOLDS.
//
// `0009` declares the seven codes as a CHECK, `0027` declares them again inside
// LEDGER-C2's trigger body, and `accounts.ts` states which three are per
// identity. `accounts.test.ts` beside this file holds those three against each
// other, and its header states the rule they live by: a copy earns its place
// "only because it is CHECKED against both of the others".
//
// `0054` is a FOURTH statement, and it is the first one a wrong literal would
// survive in. `ledger_accounts_kind_matches_code` refuses a wrong `kind`, so
// that half is self-checking against a running database. NOTHING refuses a
// wrong `code`: a row reading ('reserve','liability','identity', <uuid>)
// satisfies `ledger_accounts_code_is_declared`, satisfies
// `ledger_accounts_scope_identity`, and falls through the kind constraint's
// `ELSE true`. That was executed rather than reasoned about, and it was
// ACCEPTED. The DDL never ties `code` to `scope`, which `accounts.ts`'s own
// header states from the other direction ("ledger_accounts would accept a
// firm-scoped trader_wallet row").
//
// A MERGED MIGRATION IS NEVER EDITED, so a copy nobody checks is wrong forever.
// This file is why `0054` is allowed to hold one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { LEDGER_ACCOUNT_CODES, LEDGER_ACCOUNT_SCOPE } from '../src/accounts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '..', '..', 'db', 'migrations', '0054_identity_ledger_accounts.sql');

// COMMENTS COME OFF FIRST AND NOT LAST. `0054`'s header argues the ruling at
// length and quotes the exact tuple the database ACCEPTS as its named hole,
// so reading literals out of the raw file would parse the argument as though it
// were the statement. That is `chart-of-accounts-kinds.test.ts`'s recorded
// first-run failure, avoided here by construction rather than rediscovered.
const SQL = readFileSync(MIGRATION, 'utf8');
const BARE = SQL.replace(/--[^\n]*/g, '');

/** The three codes this package says belong to a person. */
const PER_IDENTITY = LEDGER_ACCOUNT_CODES.filter(
  (code) => LEDGER_ACCOUNT_SCOPE[code] === 'identity',
);

/** The body of the provisioning function, between its dollar quotes. */
function functionBody(): string {
  const at = BARE.indexOf('CREATE FUNCTION provision_identity_ledger_accounts');
  if (at < 0) throw new Error('0054 no longer creates provision_identity_ledger_accounts');
  const open = BARE.indexOf('$$', at);
  const close = BARE.indexOf('$$', open + 2);
  if (open < 0 || close < 0) throw new Error('the function body is not dollar quoted');
  return BARE.slice(open + 2, close);
}

/** Everything after the trigger is created: the backfill and nothing else. */
function backfillBlock(): string {
  const at = BARE.indexOf('CREATE TRIGGER identities_provision_ledger_accounts');
  if (at < 0) throw new Error('0054 no longer creates the provisioning trigger');
  return BARE.slice(at);
}

/** `('code', 'kind', 'scope', NEW.id)` tuples, in order. */
function seededRows(body: string): readonly (readonly [string, string, string])[] {
  return [
    ...body.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*NEW\.id\s*\)/g),
  ].map((m) => [m[1] as string, m[2] as string, m[3] as string] as const);
}

describe('0054 provisions exactly the vocabulary this package partitions', () => {
  test('this package names three per-identity codes and the partition is not empty', () => {
    // A PARTITION THAT READ NOTHING WOULD PASS EVERY SET COMPARISON BELOW,
    // which is the shape of green this file exists to refuse.
    expect(PER_IDENTITY.length).toBeGreaterThan(0);
    expect([...PER_IDENTITY].sort()).toStrictEqual([
      'promotional_credit',
      'trader_wallet',
      'trader_withdrawable',
    ]);
  });

  test('the trigger seeds every per-identity code and no other, in both directions', () => {
    const rows = seededRows(functionBody());
    const codes = rows.map(([code]) => code);

    expect(rows.length).toBeGreaterThan(0);
    // BOTH DIRECTIONS. Sorted set equality catches a code dropped from the
    // migration AND a code added to it that this package does not partition.
    expect([...codes].sort()).toStrictEqual([...PER_IDENTITY].sort());
    // And no duplicate: a repeated tuple would satisfy set equality while
    // asking the partial unique index to refuse a row the trigger itself wrote.
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('no firm-scoped code is seeded onto an identity', () => {
    const firm = LEDGER_ACCOUNT_CODES.filter((code) => LEDGER_ACCOUNT_SCOPE[code] === 'firm');
    const body = functionBody();
    // This is the hole the database does NOT close. `reserve` and
    // `psp_clearing` fall through `ledger_accounts_kind_matches_code`'s
    // `ELSE true`, so an identity-scoped `reserve` row is ACCEPTED. Verified by
    // execution against PostgreSQL 16 and recorded in ADR-183 section 7.
    for (const code of firm) expect(body).not.toContain(`'${code}'`);
  });

  test('every seeded row is a liability and is identity scoped', () => {
    for (const [code, kind, scope] of seededRows(functionBody())) {
      // `ledger_accounts_kind_matches_code` as `0053` left it rules all three
      // per-identity codes `liability`, so this assertion agrees with a
      // constraint rather than replacing one. It fails at test time; the
      // constraint fails at insert time; a wrong literal is caught twice.
      expect(kind, `${code} must be seeded as a liability`).toBe('liability');
      expect(scope, `${code} must be seeded identity scoped`).toBe('identity');
    }
  });

  test('the trigger fires per row after an identity is inserted', () => {
    expect(BARE).toMatch(
      /CREATE TRIGGER identities_provision_ledger_accounts\s+AFTER INSERT ON identities\s+FOR EACH ROW EXECUTE FUNCTION provision_identity_ledger_accounts\(\)/,
    );
  });
});

describe('0054 backfills the identities that already exist', () => {
  test('the backfill names the same codes as the trigger', () => {
    const block = backfillBlock();
    const codes = [...block.matchAll(/\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1] as string);

    // A TRIGGER REPAIRS THE FUTURE ONLY. An identity created before `0054`
    // keeps the defect forever, and the two lists disagreeing is how that
    // would ship looking correct.
    expect([...codes].sort()).toStrictEqual([...PER_IDENTITY].sort());
    expect(block).toContain("'liability', 'identity'");
  });

  test('both writes are idempotent, which is what lets the backfill be re-run', () => {
    // The backfill and the trigger can both address one identity, and
    // `ledger_accounts_identity_code_uq` is `(code, identity_id) WHERE scope =
    // 'identity'`. Without this clause a re-applied migration is a failed one.
    expect([...BARE.matchAll(/ON CONFLICT DO NOTHING/g)]).toHaveLength(2);
  });
});

describe('0054 supersedes nothing', () => {
  test('no merged migration is edited through this one', () => {
    // `0009`, `0027`, `0038`, `0052` and `0053` are byte for byte unchanged and
    // this file adds rows rather than replacing guarantees. A later session
    // that needs to supersede one of them writes `0055`; changing this file's
    // shape to do it here would move two guards inside one transaction, which
    // is what `0027:97-100` anticipates and ADR-181 section 4 refuses.
    const executable = BARE.slice(BARE.indexOf('BEGIN;'));
    expect(executable).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(executable).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    expect(executable).not.toMatch(/ALTER\s+TABLE/i);
    expect(executable).not.toMatch(/DROP\s+TRIGGER/i);
  });

  test('the vocabulary stays closed at seven', () => {
    // Every code literal in the executable half is one of the declared seven.
    const executable = BARE.slice(BARE.indexOf('BEGIN;'));
    const declared = new Set<string>(LEDGER_ACCOUNT_CODES);
    const suspects = [...executable.matchAll(/'([a-z][a-z_]{4,})'/g)]
      .map((m) => m[1] as string)
      .filter((word) => word.includes('_'))
      .filter((word) => !['liability', 'identity'].includes(word));

    for (const word of suspects) {
      expect(declared.has(word), `${word} is not one of the seven declared codes`).toBe(true);
    }
  });
});
