import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// =============================================================================
// GS-296 to GS-299: the audited admin adjustment
// =============================================================================
// CI-02, the `unit` project. ADR-067, SD-M6-09, FOLD-03 section 6. MONEY PATH.
//
// WHAT THESE CAN AND CANNOT ASSERT, STATED FIRST, because rule 1 of both this
// repository's check runners is that a check which cannot verify the whole of
// what it claims says so and verifies the part it can.
//
// THERE IS NO DATABASE IN CI-02. The behaviour these rulings are about lives in
// CHECK constraints, partial unique indexes and three trigger functions, and
// none of that executes without a running PostgreSQL. CI-04, the `integration`
// project, is the stage that would run it and it needs a Neon branch per run,
// which a fork pull request cannot have (see migrations.integration.test.ts).
//
// SO THE EXECUTABLE HALF WAS RUN BY HAND AND RECORDED WHERE A HUMAN WILL READ
// IT: DELTA_MANIFEST section 21 carries the install verification and the probe,
// forty migrations against an empty PostgreSQL 16, eighteen refusals and three
// commits, each watched. THESE TESTS ARE THE OTHER HALF: they assert that THE
// ARTIFACT WHICH DECIDES THAT BEHAVIOUR STILL SAYS WHAT ADR-067 RULED. That is
// the strongest form available in a stage with no database, and it is not a
// placeholder: every assertion below fails on a real, specific regression that
// a future session could otherwise land without anybody noticing.
//
// THE ONE THAT MATTERS MOST IS THE DESTINATION ASSERTION. `trader_withdrawable`
// is the obvious thing a later session reaches for when asked to make a
// goodwill credit "withdrawable", and it would be wrong for a reason no reader
// can see from this file: packages/rules-engine/src/payout/gates.ts computes
// withdrawable from the TRADING balance, so the credit would buy no eligibility
// and would only make the ledger disagree with the engine. A test is the right
// place for that, because the argument is three files away from the edit.
//
// GS-296 AND GS-298's REGISTRY ROWS DO NOT MATCH THIS RULING and are owed an
// amendment (ADR-067 section 9). docs/testing/golden-scenarios/ was not in this
// session's fence. THESE TESTS ASSERT THE RULING, not the stale rows, and they
// are what will fail if the amendment lands the other way.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'packages/db/migrations/0038_account_adjustments.sql';
const ADR = 'docs/decisions/ADR-067.md';
const M06 = 'docs/plans/M06-admin-ops-console.md';
const M20 = 'docs/plans/M20-wallet.md';
const STATE_MACHINES = 'docs/architecture/STATE_MACHINES.md';
const ADR_135 = 'docs/decisions/ADR-135.md';

/**
 * The migration minus its `--` comments, so prose in the header cannot satisfy
 * a DDL assertion.
 *
 * This file is 65% comment by character, which is the point of the header and
 * also exactly why a test that grepped the whole file would pass on the
 * comments alone. That is the "check that cannot fail" this repository has
 * already found more than once, most recently inside this very migration's own
 * ADJ-C1 (DELTA_MANIFEST section 21).
 */
function ddl(): string {
  const body = read(MIGRATION);
  const stripped = body
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    // `COMMENT ON` statements ARE DDL and their payload is prose, so they carry
    // the same "the test passes on the explanation" risk a `--` comment does.
    // The first version of the trader_withdrawable assertion below failed on
    // this migration's own COMMENT ON TABLE, whose text says the destination is
    // "NEVER trader_withdrawable": the sentence that documents the rule looked
    // to a substring search exactly like the rule being broken.
    // This assumes no `;` inside a comment string, which holds across every
    // migration in this repository and would fail loudly rather than quietly.
    .replace(/COMMENT ON [\s\S]*?;\n/g, '');
  expect(stripped.length).toBeLessThan(body.length);
  expect(stripped).not.toContain('COMMENT ON');
  return stripped;
}

/** One `CREATE FUNCTION <name>` body, comments included: the assertions ARE the body. */
function fn(name: string): string {
  const body = read(MIGRATION);
  const start = body.indexOf(`CREATE FUNCTION ${name}()`);
  expect(start, `${name} is not declared in ${MIGRATION}`).toBeGreaterThan(-1);
  const end = body.indexOf('\n$$;', start);
  expect(end, `${name} has no terminator`).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe('0038: the destination, which is the whole ruling (ADR-067 section 2)', () => {
  test('the destination vocabulary is exactly trader_wallet and promotional_credit', () => {
    const sql = ddl();
    const check = /destination\s+text NOT NULL CHECK \(destination IN \(([\s\S]*?)\)\)/.exec(sql);
    expect(check, 'no destination CHECK found').not.toBeNull();
    const values = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual(['trader_wallet', 'promotional_credit']);
  });

  test('trader_withdrawable appears nowhere in the DDL', () => {
    // The failure this catches: a later session "fixes" an unwithdrawable
    // goodwill credit by adding the class here. It would raise a ledger
    // position no gate, no clamp and no screen reads.
    expect(ddl()).not.toContain('trader_withdrawable');
  });

  test('ADJ-C2 asserts the fees_revenue leg and never firm_treasury', () => {
    const body = fn('assert_adjustment_posting_matches');
    expect(body).toMatch(/a\.code\s+=\s+'fees_revenue'/);
    // Narrow deliberately: `firm_treasury` DOES appear in this function, inside
    // the RAISE message that explains why it is not the leg. What must never
    // appear is a comparison selecting it AS the leg, which is the edit M05:140
    // already refused once on LT-01.
    expect(body).not.toMatch(/a\.code\s*=\s*'firm_treasury'/);
  });

  test('the sign mapping is credit-negative on the position, debit-positive', () => {
    // ledger_entries.amount_cents is signed and POSITIVE IS DEBIT (0009).
    // account_adjustments.amount_cents is a magnitude. Getting this backwards
    // is the error 0009 records landing four times in one day on LT-01.
    const body = fn('assert_adjustment_posting_matches');
    const credit =
      /IF NEW\.direction = 'credit' THEN\s+want_position := (-?)NEW\.amount_cents;\s+want_revenue\s+:=\s+(-?)\s*NEW\.amount_cents;/.exec(
        body,
      );
    expect(credit, 'the credit branch does not have the expected shape').not.toBeNull();
    expect(credit?.[1], 'a credit must post a NEGATIVE (credit) leg to the position').toBe('-');
    expect(credit?.[2], 'a credit must post a POSITIVE (debit) leg to fees_revenue').toBe('');
  });
});

describe('0038: never a balance mutation (ADR-067 section 1)', () => {
  test('ledger_transaction_id is NOT NULL and unique', () => {
    const sql = ddl();
    expect(sql).toMatch(
      /ledger_transaction_id\s+uuid NOT NULL REFERENCES ledger_transactions\(id\)/,
    );
    expect(sql).toContain('CREATE UNIQUE INDEX account_adjustments_transaction_uq');
  });

  test('both posting assertions are DEFERRED constraint triggers', () => {
    const sql = ddl();
    for (const name of [
      'account_adjustments_posting_matches',
      'account_adjustments_wallet_entry_matches',
    ]) {
      const trigger = new RegExp(
        `CREATE CONSTRAINT TRIGGER ${name}\\s+AFTER INSERT ON account_adjustments\\s+DEFERRABLE INITIALLY DEFERRED`,
      );
      // Not deferred, and every correct write fails: the entries arrive one at
      // a time and the wallet entry cannot exist before the adjustment has an
      // id. 0027's zero-sum trigger is deferred for the same reason.
      expect(sql, `${name} must be a DEFERRED constraint trigger`).toMatch(trigger);
    }
  });

  test('ADJ-C3 requires provenance correction and the adjustment as reference_id', () => {
    const body = fn('assert_adjustment_wallet_entry_matches');
    expect(body).toContain("w.provenance             = 'correction'");
    expect(body).toContain('w.reference_id           = NEW.id');
  });
});

describe('0038: the debit direction (ADR-067 section 4)', () => {
  test('a debit is a reversal and a credit is not, as an equivalence', () => {
    // Written as `=` rather than as two implications so neither direction can
    // be loosened later without the other.
    expect(ddl()).toMatch(
      /CONSTRAINT account_adjustments_debit_is_a_reversal CHECK \(\s*\(direction = 'debit'\) = \(reverses_adjustment_id IS NOT NULL\)\s*\)/,
    );
  });

  test('at most one reversal per adjustment', () => {
    expect(ddl()).toMatch(
      /CREATE UNIQUE INDEX account_adjustments_reversal_uq\s+ON account_adjustments \(reverses_adjustment_id\)\s+WHERE reverses_adjustment_id IS NOT NULL/,
    );
  });

  test('ADJ-C1 refuses a partial reversal, a chained one and an unlinked one', () => {
    const body = fn('assert_adjustment_reversal_is_sound');
    // Exact amount: partial reversal is refused, full reversal plus a new
    // credit is the remedy (SD-M5-05's reasoning one table up).
    expect(body).toContain('IF target.amount_cents <> NEW.amount_cents THEN');
    // No chain, and it is checked FIRST so its message names the rule.
    expect(body).toContain('IF target.reverses_adjustment_id IS NOT NULL THEN');
    expect(body.indexOf('IF target.reverses_adjustment_id IS NOT NULL THEN')).toBeLessThan(
      body.indexOf("IF target.direction <> 'credit' THEN"),
    );
    // Same human, same class, and the transaction carries reversal_of.
    expect(body).toContain('IF target.identity_id <> NEW.identity_id THEN');
    expect(body).toContain('IF target.destination <> NEW.destination THEN');
    expect(body).toContain('IF claimed_txn IS DISTINCT FROM target_txn THEN');
  });
});

describe('0038: dual control, the reason, and the promotional pairing', () => {
  test('the dual-control CHECK is strictly-below-threshold or an approval', () => {
    expect(ddl()).toMatch(
      /CONSTRAINT account_adjustments_dual_control_above_threshold CHECK \(\s*amount_cents < dual_control_threshold_cents\s+OR dual_control_approval_id IS NOT NULL\s*\)/,
    );
  });

  test('the threshold in force is a column and not a lookup', () => {
    expect(ddl()).toMatch(/dual_control_threshold_cents bigint NOT NULL/);
  });

  test('the reason vocabulary is exactly three values and closed in the migration', () => {
    const sql = ddl();
    const check = /reason_code\s+text NOT NULL CHECK \(reason_code IN \(([\s\S]*?)\n\s*\)\)/.exec(
      sql,
    );
    expect(check, 'no reason_code CHECK found').not.toBeNull();
    const values = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual(['goodwill', 'reconciliation_error', 'promotional_credit']);
  });

  test('the note is required and may not be blank', () => {
    expect(ddl()).toMatch(/reason_note\s+text NOT NULL CHECK \(btrim\(reason_note\) <> ''\)/);
  });

  test('INV-M20-03 holds by construction: the reason picks the destination', () => {
    const sql = ddl();
    expect(sql).toMatch(
      /CONSTRAINT account_adjustments_reason_picks_destination CHECK \(\s*\(reason_code = 'promotional_credit'\) = \(destination = 'promotional_credit'\)\s*\)/,
    );
    expect(sql).toMatch(
      /CONSTRAINT account_adjustments_promotional_names_its_grant CHECK \(\s*\(destination = 'promotional_credit'\) = \(promotional_credit_grant_id IS NOT NULL\)\s*\)/,
    );
  });
});

describe('0038: what it deliberately does not do', () => {
  test('it widens no closed list', () => {
    const sql = ddl();
    // Every vocabulary this table needs already existed, which is the evidence
    // that the destination ruling is right. An ALTER on any of these would mean
    // it did not.
    for (const table of [
      'wallet_entries',
      'ledger_accounts',
      'ledger_transactions',
      'identities',
    ]) {
      expect(sql, `0038 must not ALTER ${table}`).not.toMatch(
        new RegExp(`ALTER TABLE\\s+${table}`),
      );
    }
    expect(sql).not.toMatch(/ALTER TYPE/);
    expect(sql).not.toMatch(/CREATE TYPE/);
  });

  test('it gates on no identity status: restricted and closed are permitted', () => {
    // GS-298. INV-M20-06 already blocks wallet spend and external withdrawal
    // while restricted, so a gate here would be a second expression of one that
    // exists, and refusing the row would mean Merit cannot correct its own
    // error against a person under investigation.
    const sql = ddl();
    expect(sql).not.toContain("'restricted'");
    expect(sql).not.toContain('identities.status');
  });

  test('append-only by grant, against PUBLIC as well as merit_app', () => {
    // Without this every constraint above is bypassable: write a compliant row,
    // then edit it. The deferred assertions are INSERT triggers.
    expect(ddl()).toMatch(/REVOKE UPDATE, DELETE ON account_adjustments FROM merit_app, PUBLIC;/);
  });
});

describe('ADR-067 and SD-M6-09 still say what 0038 was built from', () => {
  test('the ADR is signed, and the signature records that E2s read has NOT happened', () => {
    const adr = read(ADR);
    // FLIPPED 2026-08-21 (session 95). This asserted `status: proposed` and a
    // PENDING line, which was the right guard while 0038 shipped against an
    // unapproved ruling: it stopped the migration reading as authorised.
    //
    // ADR-067 IS NOW GRANTED, so the old assertion pinned a state the corpus
    // has left. It is flipped rather than deleted, because the property worth
    // guarding did not go away -- it MOVED. The entry is on the money path,
    // and the grant was an explicit founder DELEGATION rather than E2's
    // line-by-line read. That distinction is the whole reason the signature is
    // honest, and a later edit that quietly upgraded the wording to imply a
    // read would put a false attestation into a document with a declared
    // `regulator` audience (SD-M6-04). This test is what refuses that edit.
    expect(adr.split('\n')[0]).toContain('status: accepted');
    expect(adr).toContain('**Founder approval: GRANTED 2026-08-21.**');
    expect(adr).toContain('not as a line-by-line read');
    expect(adr).toContain('has not happened');
  });

  test('OQ-F6-01 is still open, so the dual-control CHECK is inert', () => {
    // The grant approved the ROUTE and not the threshold. Until a number is
    // written into the column the dual-control half is specification rather
    // than enforcement, and the signature says so in those terms.
    expect(read(ADR)).toContain('`OQ-F6-01` IS STILL OPEN');
  });

  test('the ADR states the ADR-010 amendment explicitly', () => {
    // ADR-066 section 0 row 4 is the finding that treating this as an
    // APPLICATION of ADR-010 would write a false citation into a frozen doc.
    expect(read(ADR)).toContain('THIS ADR ADDS IT, AND THAT IS AN AMENDMENT TO');
  });

  test('M06 carries SD-M6-09 and it names the migration', () => {
    const row = read(M06)
      .split('\n')
      .find((line) => line.startsWith('| SD-M6-09 |'));
    expect(row, 'M06 has no SD-M6-09 row').toBeDefined();
    expect(row).toContain('account_adjustments');
    expect(row).toContain('0038_account_adjustments.sql');
  });
});
describe('ADR-135: the three extraction doors, which decide what a closed adjustment is worth', () => {
  // WHY THIS BLOCK EXISTS, because a test whose reason is three files away is a
  // test the next session deletes.
  //
  // ADR-067 section 3 rules that an adjustment credit is EXCLUDED from the
  // payout computation and withdrawable ANYWAY, on the second of the wallet's
  // two exits (M20:41, "the only balance in the system with two exits"). That
  // is the whole reason ADR-067:103 can call the fold plan's "excluded and
  // therefore unwithdrawable" horn FALSE.
  //
  // ADR-075 LANDED ONE DAY LATER and moved INV-M20-06 and G-WITHDRAWAL-CLEARED
  // to `identities.status = 'active'`. For a `closed` identity that shuts the
  // second exit, so the refuted horn is true again there and 0038:107's stated
  // reason for permitting the credit ("payable on demand FOREVER") stopped
  // being true of the door set. NOTHING CAUGHT IT FOR SIX DAYS.
  //
  // ADR-135 clause 2 accepts that cost deliberately. The SIZE of the cost is a
  // property of the four sites below rather than of the ruling, so an accepted
  // cost that nothing watches is exactly the defect that produced this entry.
  // CLAUDE.md's remedy for this class is a mechanical assertion rather than a
  // bigger model, and this is it. These are ADR-135's approval clause, rows 1
  // to 4, executed.

  const doorRow = (file: string, key: string): string => {
    const row = read(file)
      .split('\n')
      .find((line) => line.includes(key) && line.startsWith('|'));
    expect(row, `${file} has no ${key} row`).toBeDefined();
    return row as string;
  };

  test('row 1: G-ELIGIBLE reads identities.status = active', () => {
    expect(doorRow(STATE_MACHINES, '**G-ELIGIBLE**')).toContain("identities.status = 'active'");
  });

  test('row 2: G-WITHDRAWAL-CLEARED reads identities.status = active', () => {
    expect(doorRow(STATE_MACHINES, '**G-WITHDRAWAL-CLEARED**')).toContain(
      "identities.status = 'active'",
    );
  });

  test('row 3: INV-M20-06 reads identities.status = active', () => {
    // If this ever returns to `<> 'restricted'`, the strand disappears and
    // ADR-135 clause 2 is accepting a cost that no longer exists. Either way
    // the ruling is REOPENED rather than reinterpreted, which is what its
    // approval clause says in those words.
    expect(doorRow(M20, 'INV-M20-06')).toContain("identities.status = 'active'");
  });

  test('row 4: 0038 still gates on no identity status, so the credit reaches a closed identity at all', () => {
    // The same property account-adjustments already asserts for GS-298, stated
    // again here for a different reason: ADR-135 clause 2 is only reachable
    // while this holds. If a later session gates 0038 on `identities.status`,
    // it has taken Direction A of ADR-135 section 3 and owes that ruling.
    expect(ddl()).not.toContain('identities.status');
  });

  test('ADR-135 records the residue rather than leaving 0038:107 reading as current', () => {
    // 0038 is MERGED and money path, so it is superseded and never edited
    // (constitution E2), and its header still gives INV-M20-09 as the reason
    // `closed` is permitted. This entry is the record that the reason moved.
    const adr = read(ADR_135);
    expect(adr.split('\n')[0]).toContain('status: proposed');
    expect(adr).toContain('**Founder approval: PENDING, UNSIGNED.**');
    expect(adr).toContain('THE CREDIT IS POSTED');
  });

  test('the migration header still carries the reason ADR-135 says has moved', () => {
    // A negative control on the assertion above: if this sentence ever leaves
    // 0038, ADR-135 section 2 is describing a file that no longer says it, and
    // the entry needs re-reading rather than trusting.
    //
    // THE COMMENT PREFIX AND THE LINE WRAP ARE STRIPPED FIRST, and that is not
    // tidiness. The first draft of this assertion searched the raw file for
    // `payable on demand FOREVER` and FAILED, because 0038 wraps the sentence
    // across lines 107 and 108. A quote checked against a hard-wrapped source
    // has to be unwrapped or it is checking the wrapping.
    const prose = read(MIGRATION)
      .split('\n')
      .map((line) => line.replace(/^\s*--\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(prose).toContain(
      "`closed` is permitted for INV-M20-09's reason: a wallet balance is payable on demand FOREVER.",
    );
  });
});
