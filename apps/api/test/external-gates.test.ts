// =============================================================================
// apps/api/test/external-gates.test.ts -- CI-02, `unit`.
// =============================================================================
// `ADR-260`, EXECUTED. THE RESOLVER'S THREE CLOSED VOCABULARIES, COMPARED TO THE
// PRIMARY SOURCES THEY WERE TRANSCRIBED FROM.
//
// **IT IS HERE AND NOT IN `packages/rules-engine/test/`, ON `ADR-254` FINDING
// 3's RULING UNCHANGED.** That package sets `types: []` on purpose, so "an I/O
// call inside this package is a COMPILE ERROR before it is a lint finding, which
// is the strongest of the three mechanisms guarding this boundary and the only
// one a lint-disable comment cannot route around". Every claim below is read out
// of a FILE -- two migrations, `types.ts` and `M01` -- so it cannot live there
// without widening `types`, which is weakening a boundary gate to pass it. What
// the resolver DOES with a value is asserted in that package, where no file is
// read: `packages/rules-engine/test/external-gates.test.ts`.
//
// **WHY THE COMPARISON EXISTS AT ALL: `ADR-254` SECTION 8 FINDING 4.** The
// in-flight status set is written out in five places -- `M01` twice, `EC-040`,
// `STATE_MACHINES` and the index -- and that entry recorded that "nothing pins
// the resolver that does not exist yet", with the cheapest control being that it
// import a constant rather than a literal. `PAYOUT_IN_FLIGHT_STATUSES` is that
// constant and this file is its comparator. A constant nothing compares is a
// sixth copy.
//
// **AND THE SEVEN-VERSUS-SIX GAP IS ASSERTED AS A REFUSAL RATHER THAN AS A
// COUNT.** `rule-state-producibility.test.ts` already derives both sides of the
// gap from their own sources; what it cannot say is what the resolver DOES with
// the seventh member, and the whole risk on this leg is that a later session
// closes the gap by widening the engine's union. Group 2 is that risk as a
// predicate, in both directions.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ExternalGatesRefusal,
  PAYOUT_IN_FLIGHT_STATUSES,
  resolveExternalGates,
} from '@merit/rules-engine';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * A file with its comment lines removed.
 *
 * `rule-state-producibility.test.ts`'s helper, transcribed rather than imported
 * because that file exports nothing. A census over raw text counts the prose
 * that DESCRIBES a defect as an instance of it, which is how a file explaining
 * that it must not name `provisioning_pending` fails a check that it does not.
 */
const codeOf = (rel: string): string =>
  read(rel)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');

const ENUMS = read('packages/db/migrations/0001_extensions_and_enums.sql');
const HOLD = read('packages/db/migrations/0031_payout_hold_and_identity_restriction.sql');
const HOLD_ENUM = read('packages/db/migrations/0030_payout_hold_enum.sql');
const TYPES = read('packages/rules-engine/src/types.ts');
const RESOLVER = read('packages/rules-engine/src/external-gates.ts');
const M01 = read('docs/plans/M01-rules-engine.md');

/** The members of a `CREATE TYPE ... AS ENUM (...)` block, in declaration order. */
function enumMembers(name: string): readonly string[] {
  const from = ENUMS.slice(ENUMS.indexOf(`CREATE TYPE ${name} AS ENUM (`));
  return [...from.slice(0, from.indexOf(');')).matchAll(/'(\w+)'/g)].map((m) => m[1] ?? '');
}

/** The members of a `readonly T[]`-shaped tuple literal in the resolver, in order. */
function tuple(name: string): readonly string[] {
  const from = RESOLVER.slice(RESOLVER.indexOf(`const ${name} = [`));
  return [...from.slice(0, from.indexOf('] as const')).matchAll(/'(\w+)'/g)].map((m) => m[1] ?? '');
}

// -----------------------------------------------------------------------------
// 1. `PAYOUT_IN_FLIGHT_STATUSES` is the live index's predicate, in its order
// -----------------------------------------------------------------------------

describe('1. the in-flight set is `payout_requests_no_in_flight_uq`s predicate and nothing else', () => {
  test('1.1 the live index is still UNIQUE, on `(account_id)`, and the grain is ADR-254s', () => {
    // THE TIEBREAK, RE-DERIVED RATHER THAN CARRIED. A resolver pinned to an index
    // that had been re-grained would be pinned to the wrong thing, so the shape
    // of the index is asserted before its predicate is.
    const create = HOLD.slice(HOLD.indexOf('CREATE UNIQUE INDEX payout_requests_no_in_flight_uq'));
    const statement = create.slice(0, create.indexOf(';'));

    expect(statement).toContain('ON payout_requests (account_id)');
    expect(statement).not.toContain('identity_id');
  });

  test('1.2 the resolver`s constant IS that predicate, compared as a SEQUENCE', () => {
    // **AS A SEQUENCE AND NOT AS A SET, WHICH IS ADR-254 SECTION 11's OWN
    // LESSON.** A seeded defect there survived a membership check, and the repair
    // was to compare the predicate clause in order. The same needle is used here.
    const create = HOLD.slice(HOLD.indexOf('CREATE UNIQUE INDEX payout_requests_no_in_flight_uq'));
    const where = create.slice(create.indexOf('WHERE status IN ('), create.indexOf(';'));
    const declared = [...where.matchAll(/'(\w+)'/g)].map((m) => m[1] ?? '');

    expect(declared).toEqual([...PAYOUT_IN_FLIGHT_STATUSES]);
  });

  test('1.3 and `M01`s SD-09, which the index is the delta OF, carries the same three', () => {
    // The index is M01's own schema delta built faithfully (ADR-254 section 1),
    // and ADR-254 folded ADR-040's vocabulary remainder into that line. If the
    // plan and the index ever separate again, this is where it shows.
    // **THE SLICE STOPS AT THE CLAUSE'S OWN CLOSING PAREN AND THAT IS LOAD
    // BEARING.** The same row carries the RETIRED set under `THIS ROW READ`,
    // which ADR-254 kept and marked on purpose, so a slice to end of line reads
    // six statuses and a check written that way is green on a row that says two
    // different things.
    const sd09 = M01.slice(M01.indexOf('| SD-09 |'));
    const from = sd09.indexOf('where status in (');
    const clause = sd09.slice(from, sd09.indexOf(')', from));

    expect([...clause.matchAll(/'(\w+)'/g)].map((m) => m[1] ?? '')).toEqual([
      ...PAYOUT_IN_FLIGHT_STATUSES,
    ]);

    // NON-VACUITY: the retired set really is still on that row, marked, so the
    // narrow slice is doing work rather than being narrow for its own sake.
    expect(sd09.slice(0, sd09.indexOf('\n'))).toContain("('approved','transferring','frozen')");
  });
});

// -----------------------------------------------------------------------------
// 2. `payout_status`, whole, so an unknown member cannot read as not-in-flight
// -----------------------------------------------------------------------------

describe('2. the resolver knows the WHOLE payout vocabulary and refuses outside it', () => {
  test('2.1 `payout_status` is `0001`s four plus `0030`s fifth, and the resolver has five', () => {
    // THE ENUM IS ASSEMBLED FROM BOTH MIGRATIONS, because `ADD VALUE` in a later
    // file is how this vocabulary grows and a reader of `0001` alone would find
    // four. That is the exact shape a sixth member would arrive in.
    const declared = enumMembers('payout_status');
    const added = [...HOLD_ENUM.matchAll(/ALTER TYPE payout_status ADD VALUE '(\w+)'/g)].map(
      (m) => m[1] ?? '',
    );

    expect(declared).toEqual(['approved', 'settled', 'failed', 'frozen']);
    expect(added).toEqual(['held_pending_review']);
    expect(tuple('PAYOUT_REQUEST_STATUSES')).toEqual([...declared, ...added]);
  });

  test('2.2 the in-flight three are a SUBSET of the five, and the other two are named', () => {
    // A predicate naming a value no row can hold enforces nothing and fails no
    // test, which is the `C-02` defect ADR-254 section 5 refused to create.
    const all = tuple('PAYOUT_REQUEST_STATUSES');
    for (const status of PAYOUT_IN_FLIGHT_STATUSES) expect(all).toContain(status);
    expect(all.filter((one) => !PAYOUT_IN_FLIGHT_STATUSES.includes(one as never))).toEqual([
      'settled',
      'failed',
    ]);
  });

  test('2.3 `transferring` is NOT in it, because ADR-028 moved it to the other leg', () => {
    // The retired member. `wallet_withdrawal_status` has it and `payout_status`
    // does not, and a resolver carrying it would be reading a value no
    // `payout_requests` row can hold.
    expect(tuple('PAYOUT_REQUEST_STATUSES')).not.toContain('transferring');
    expect(enumMembers('wallet_withdrawal_status')).toContain('transferring');
    expect(enumMembers('wallet_withdrawal_status')).not.toContain('frozen');
  });
});

// -----------------------------------------------------------------------------
// 3. Seven versus six: the union is NOT widened and the seventh REFUSES
// -----------------------------------------------------------------------------

describe('3. the account-status gap is closed by a refusal and never by a wider union', () => {
  test('3.1 `account_status` still declares SEVEN and `AccountStatus` still takes SIX', () => {
    // BOTH SIDES DERIVED FROM THEIR OWN SOURCES, so the day either moves this
    // names the difference rather than going stale. `M01:203` carries the same
    // six, so the engine transcribed its source correctly and the gap is the
    // corpus's.
    const stored = enumMembers('account_status');
    const union = TYPES.slice(TYPES.indexOf('export type AccountStatus ='));
    const accepted = [...union.slice(0, union.indexOf(';')).matchAll(/'(\w+)'/g)].map(
      (m) => m[1] ?? '',
    );

    expect(stored).toHaveLength(7);
    expect(accepted).toHaveLength(6);
    expect(stored.filter((one) => !accepted.includes(one))).toEqual(['provisioning_pending']);
  });

  test('3.2 the resolver holds the COLUMN`s seven, so it can tell the two findings apart', () => {
    // A resolver holding only the engine's six could not distinguish "the enum
    // grew and nobody swept this" from "one known account is not foldable", and
    // the messages have to differ because the remedies do.
    expect(tuple('ACCOUNT_STATUS_COLUMN')).toEqual(enumMembers('account_status'));
  });

  test('3.3 and the seventh is REFUSED rather than admitted, run rather than read', () => {
    // **THE TRAP AS A PREDICATE.** This is the one assertion in this file that
    // executes the resolver, and it is here rather than only in the engine's
    // suite because the seeded defect it guards against is a source edit: a
    // session that widened `AccountStatus` to make the map total would turn 3.1
    // red and could make it green again by editing the expected count. It could
    // not make this green without also deleting the refusal.
    expect(() =>
      resolveExternalGates({
        accountId: 'a',
        accountStatus: 'provisioning_pending',
        identityPayoutsFrozen: false,
        accountPayoutsFrozen: false,
        reconBlocked: false,
        kycChain: [],
        payoutRequestStatuses: [],
      }),
    ).toThrow(ExternalGatesRefusal);
  });

  test('3.4 `kyc_status`s five are the resolver`s five, in order', () => {
    expect(tuple('KYC_STATE_COLUMN')).toEqual(enumMembers('kyc_status'));

    const union = TYPES.slice(TYPES.indexOf('export type KycState ='));
    expect(
      [...union.slice(0, union.indexOf(';')).matchAll(/'(\w+)'/g)].map((m) => m[1] ?? ''),
    ).toEqual(enumMembers('kyc_status'));
  });
});

// -----------------------------------------------------------------------------
// 4. The one predicate, and the two deployables that reach it
// -----------------------------------------------------------------------------

describe('4. the narrowing is written once, which is what its home was chosen for', () => {
  test('4.1 the resolver performs no I/O and could not, by this package`s tsconfig', () => {
    // The boundary that makes this file necessary is the same boundary that
    // makes the resolver's home safe. Asserted rather than assumed, because the
    // obvious way to shorten the resolver is to have it read the rows itself.
    expect(read('packages/rules-engine/tsconfig.json')).toContain('"types": []');
    const code = codeOf('packages/rules-engine/src/external-gates.ts');
    for (const needle of ['readFileSync', 'fetch(', 'process.', 'await ', 'async '])
      expect(code, `the resolver reached for ${needle}`).not.toContain(needle);
    // AND IT IMPORTS NOTHING BUT TYPES, so the boundary is visible in one line
    // rather than inferred from the absence of four needles.
    expect([...code.matchAll(/^import .*$/gm)].map((m) => m[0])).toEqual([
      "import type { AccountStatus, ExternalGates, KycState } from './types.ts';",
    ]);
  });

  test('4.2 `apps/worker` calls it and does not restate it', () => {
    // The worker reads the rows and hands the RAW column values over. A worker
    // that narrowed `accounts.status` itself would be the second place the
    // seven-versus-six question is answered.
    const adapter = codeOf('apps/worker/src/batch/adapter.ts');

    expect(adapter).toContain('resolveExternalGates');
    expect(adapter).not.toContain('provisioning_pending');
    expect(adapter).not.toContain('held_pending_review');
    expect(adapter).not.toContain('kyc_required');
  });
});
