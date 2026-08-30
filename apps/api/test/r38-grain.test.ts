// =============================================================================
// apps/api/test/r38-grain.test.ts -- CI-02, `unit`.
// =============================================================================
// IT IS HERE AND NOT IN `packages/rules-engine/test/`, WHICH ROW 254's FENCE
// NAMED, AND THE FENCE IS THE THING THAT WAS WRONG. That package sets
// `types: []` on purpose: "an I/O call inside this package is a COMPILE ERROR
// before it is a lint finding, which is the strongest of the three mechanisms
// guarding this boundary and the only one a lint-disable comment cannot route
// around". Every claim below is read out of a FILE -- migrations, M01,
// STATE_MACHINES, EC-040, M05 and two source files -- so the assertion cannot
// live there without widening `types`, which is weakening a boundary gate to
// pass it. It sits beside `rule-state-producibility.test.ts`, which ADR-248
// wrote for this same contradiction and which reads the same sources.
// ADR-254, EXECUTED. R-38 IS ACCOUNT GRAINED, AND THE ARGUMENT IS A SET OF
// PREDICATES RATHER THAN A PARAGRAPH.
//
// ADR-248 section 5 found that M01 states R-38's grain two ways and deliberately
// refused to rule it, which was correct: both sentences are inside a FROZEN plan
// and moving one is an amendment rather than a line of code. This file is the
// derivation the amendment rests on, and it is organised so that the LOSING
// reading cannot be quietly deleted by a later session: group 4 asserts the
// sources that supported it are still quotable in the document that lost.
//
// THE TIEBREAK WAS ALREADY BUILT, WHICH IS THE FIRST THING GROUP 1 MEASURES.
// `payout_requests_no_in_flight_uq` is a UNIQUE partial index ON
// `payout_requests (account_id)`, live since `0031`. A shipped index is a
// commitment the database is already enforcing, so the question was never
// whether the index takes a side; it was whether the index or the plan is
// wrong. The index is right, and it is not even index versus plan: M01's OWN
// `SD-09` delta declares the index at `(account_id)`, so the conflict is M01
// against itself at two lines.
//
// AND THE IDENTITY RULE IS REAL, BUILT, AND NOT THIS PREDICATE. Group 5 reads
// it where it lives: `gateNoInFlight` on the withdrawal route refuses a second
// open `wallet_withdrawals` row for one identity, in the application, because
// `wallet_withdrawals_open_idx` is a PLAIN index (ADR-158 finding 8). That is
// ADR-019's external-leg rule. It never reads `hasPayoutInFlight` and this file
// asserts that it does not.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'packages/db/migrations');

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const M01 = read('docs/plans/M01-rules-engine.md');
const M05 = read('docs/plans/M05-payout-system.md');
const EC040 = read('docs/edge-cases/EC-040.md');
const STATE_MACHINES = read('docs/architecture/STATE_MACHINES.md');
const TYPES_TS = read('packages/rules-engine/src/types.ts');
const EVALUATE_TS = read('packages/rules-engine/src/payout/evaluate.ts');
const WITHDRAWALS_TS = read('apps/api/src/routes/wallet-withdrawals.ts');

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

/**
 * The migration set concatenated IN APPLY ORDER.
 *
 * A merged migration is never edited, only superseded (constitution E2), so the
 * LIVE shape of an index is the LAST statement that creates it and never the
 * first. Every query below that asks what the database enforces reads the last
 * match rather than the first, which is the grain error `wiring.test.ts`'s own
 * per-file claim was found making about `rule_states`.
 */
const SQL = migrationFiles()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

/** Every `CREATE [UNIQUE] INDEX <name>` statement body, in apply order. */
function indexStatements(name: string): { unique: boolean; body: string }[] {
  const out: { unique: boolean; body: string }[] = [];
  const re = new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX\\s+${name}\\b([\\s\\S]*?);`, 'g');
  for (const m of SQL.matchAll(re)) {
    out.push({ unique: m[1] !== undefined, body: (m[2] ?? '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** The quoted members of a `status IN (...)` predicate, in written order. */
function predicateStatuses(body: string): string[] {
  const m = /status\s+IN\s*\(([^)]*)\)/i.exec(body);
  if (m === null) return [];
  return [...(m[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '');
}

/** The members of a `CREATE TYPE <name> AS ENUM (...)`. */
function enumMembers(name: string): string[] {
  const m = new RegExp(`CREATE TYPE ${name} AS ENUM\\s*\\(([^)]*)\\)`, 'i').exec(SQL);
  if (m === null) return [];
  return [...(m[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '');
}

/** The LIVE in-flight predicate, read out of the database rather than typed. */
const LIVE_IN_FLIGHT = (() => {
  const created = indexStatements('payout_requests_no_in_flight_uq');
  const last = created.at(-1);
  return { statements: created, last, statuses: predicateStatuses(last?.body ?? '') };
})();

/** M01's two `R-38` rows, and its `SD-09` delta row. */
const r38Rows = M01.split('\n').filter((l) => l.startsWith('| R-38 |'));
const sd09Row = M01.split('\n').find((l) => l.startsWith('| SD-09 |')) ?? '';
const hasPayoutInFlightDecl =
  M01.split('\n').find((l) => l.includes('hasPayoutInFlight: boolean;')) ?? '';

/**
 * The LIVE half of an M01 row, which is everything before its retirement
 * clause.
 *
 * A REFUTED SENTENCE STAYS AND MUST SAY SO. STATE_MACHINES' own
 * `G-NO-IN-FLIGHT` row keeps the wording ADR-040 retired and marks it, and
 * ADR-255's finding is that a true-looking sentence deleted leaves nothing for
 * the next reader to check. So M01 keeps the identity wording as HISTORY, and
 * the assertions below read only the half that still makes a claim.
 */
const RETIREMENT_MARKER = '**THIS ROW READ';
const liveHalf = (line: string): string => line.split(RETIREMENT_MARKER)[0] ?? '';

describe('ADR-254 group 1: the tiebreak is already built, and it takes the ACCOUNT side', () => {
  test('the live SD-09 index is UNIQUE, on payout_requests (account_id)', () => {
    expect(LIVE_IN_FLIGHT.statements.length).toBeGreaterThan(0);
    const last = LIVE_IN_FLIGHT.last;
    expect(last).toBeDefined();
    expect(last?.unique).toBe(true);
    expect(last?.body).toContain('ON payout_requests (account_id)');
    expect(last?.body).not.toContain('identity_id');
  });

  test('its predicate is the three outstanding states, and nothing else', () => {
    expect(LIVE_IN_FLIGHT.statuses).toEqual(['approved', 'frozen', 'held_pending_review']);
  });

  test('EVERY creation of it, first and last, keys off the ACCOUNT', () => {
    // The grain has never moved in the database. `0010` created it and `0031`
    // dropped and re-created it under the same name to widen the PREDICATE, and
    // an entry arguing that the index changed sides has to argue with this.
    expect(LIVE_IN_FLIGHT.statements.length).toBeGreaterThanOrEqual(2);
    for (const stmt of LIVE_IN_FLIGHT.statements) {
      expect(stmt.unique).toBe(true);
      expect(stmt.body).toContain('ON payout_requests (account_id)');
    }
  });

  test('the EXTERNAL leg has no unique index at all, which is ADR-158 finding 8', () => {
    for (const stmt of indexStatements('wallet_withdrawals_open_idx')) {
      expect(stmt.unique).toBe(false);
    }
    const uniqueOnWithdrawals = [...SQL.matchAll(/CREATE UNIQUE INDEX\s+(wallet_withdrawals\w*)/g)]
      .map((m) => m[1] ?? '')
      .sort();
    expect(uniqueOnWithdrawals).toEqual(['wallet_withdrawals_identity_idempotency_uq']);
    // The presence control. An absence claim measured by a query that finds
    // nothing anywhere is a claim about the query.
    const uniqueOnRequests = [...SQL.matchAll(/CREATE UNIQUE INDEX\s+(payout_requests\w*)/g)].map(
      (m) => m[1] ?? '',
    );
    expect(uniqueOnRequests).toContain('payout_requests_no_in_flight_uq');
  });
});

describe('ADR-254 group 2: the losing sentence was satisfiable on NEITHER table', () => {
  test('payout_status has no `transferring` and wallet_withdrawal_status has no `frozen`', () => {
    const payout = enumMembers('payout_status');
    const withdrawal = enumMembers('wallet_withdrawal_status');
    expect(payout.length).toBeGreaterThan(0);
    expect(withdrawal.length).toBeGreaterThan(0);
    expect(payout).not.toContain('transferring');
    expect(withdrawal).not.toContain('frozen');
    // The controls, so neither absence is a spelling accident.
    expect(payout).toContain('frozen');
    expect(withdrawal).toContain('transferring');
  });

  test('so `wallet-to-rail withdrawal in approved, transferring or frozen` matched nothing', () => {
    // The retired sentence names one value each table lacks, and the SET it
    // names is exactly `payout_requests`' pre-ADR-028 vocabulary. That is why it
    // is a fold artefact rather than an independent reading: the status set came
    // from the internal leg and only the grain word came from ADR-019.
    const retired = ['approved', 'transferring', 'frozen'];
    const payout = enumMembers('payout_status');
    const withdrawal = enumMembers('wallet_withdrawal_status');
    expect(retired.every((s) => payout.includes(s))).toBe(false);
    expect(retired.every((s) => withdrawal.includes(s))).toBe(false);
  });
});

describe('ADR-254 group 3: M01 states ONE grain, and it is the account', () => {
  test('both R-38 rows exist and their live half is account grained', () => {
    expect(r38Rows.length).toBe(2);
    for (const row of r38Rows) {
      const live = liveHalf(row);
      expect(live).toContain('for this account');
      expect(live).not.toContain('for this identity');
      expect(live).not.toContain('transferring');
    }
  });

  test('every R-38 row names the LIVE index predicate, derived from the SQL', () => {
    // READ OUT OF THE PREDICATE CLAUSE AND NOT OUT OF THE CELL. A seeded
    // narrowing of the clause to "`approved` or `frozen`" left this case GREEN
    // when it searched the whole live half, because the row NAMES
    // `held_pending_review` a second time in the sentence that explains why
    // ADR-040 restored the window. A check that a document mentions a word
    // somewhere is not a check that the rule says it.
    for (const row of r38Rows) {
      const live = liveHalf(row);
      const at = live.indexOf('**for this account** in ');
      expect(at).toBeGreaterThan(-1);
      const clause = live.slice(at + '**for this account** in '.length).split('.')[0] ?? '';
      const named = [...clause.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '');
      expect(named).toEqual(LIVE_IN_FLIGHT.statuses);
    }
  });

  test('section 2.1s declaration and the SD-09 delta name the same set and the same grain', () => {
    expect(hasPayoutInFlightDecl).not.toBe('');
    expect(hasPayoutInFlightDecl).toContain('for this account');
    expect(hasPayoutInFlightDecl).not.toContain('transferring');
    for (const status of LIVE_IN_FLIGHT.statuses) {
      expect(hasPayoutInFlightDecl).toContain(status);
    }
    expect(sd09Row).toContain('(account_id)');
    for (const status of LIVE_IN_FLIGHT.statuses) {
      expect(liveHalf(sd09Row)).toContain(`'${status}'`);
    }
  });

  test('the retired wording is KEPT and every occurrence of it is marked retired', () => {
    // RI-14's escape, applied to a plan: a refuted claim may stay and must say
    // so. What must never happen again is the wording sitting in M01 unmarked,
    // where a reader takes it for a live rule -- which is precisely how it
    // reached `types.ts` as "for this identity" twice.
    const lines = M01.split('\n');
    const stale = lines.filter(
      (l) => l.includes('transferring') || l.includes('for this identity'),
    );
    expect(stale.length).toBeGreaterThan(0);
    for (const line of stale) {
      expect(line).toContain('ADR-254');
    }
  });
});

describe('ADR-254 group 4: the sources that DECIDED it are still quotable', () => {
  test('AS-01s residual, which is only true if R-38 is account grained', () => {
    expect(M01).toContain(
      'None at account level. At identity level, ten accounts can each hold one in-flight payout, which is AS-09.',
    );
  });

  test('AS-09 says the in-flight rule is per account, in its own words', () => {
    expect(M01).toContain("AS-01's in-flight rule does not help because each account has its own");
  });

  test('AS-09 is RULED at the gate: no identity-level ceiling in v1', () => {
    expect(M01).toContain('no identity-level extraction ceiling in v1');
  });

  test('EC-040 and M05 both state it at the account', () => {
    expect(EC040).toContain('for the same account');
    expect(M05).toContain('At most one payout is in flight per account');
  });

  test('STATE_MACHINES draws the guard at the account, pinned to the index predicate', () => {
    const guard = STATE_MACHINES.split('\n').find((l) => l.startsWith('| **G-NO-IN-FLIGHT**'));
    expect(guard).toBeDefined();
    expect(guard).toContain('`payout_requests` row for this account');
    for (const status of LIVE_IN_FLIGHT.statuses) {
      expect(guard).toContain(`\`${status}\``);
    }
  });
});

describe('ADR-254 group 5: the identity rule is a DIFFERENT object and is already served', () => {
  test('the withdrawal route refuses a second open withdrawal per identity', () => {
    expect(WITHDRAWALS_TS).toContain('A withdrawal is already open for this identity.');
    expect(WITHDRAWALS_TS).toContain('OPEN_WITHDRAWAL_STATUSES');
  });

  test('and it does NOT read hasPayoutInFlight, so the two rules never met', () => {
    expect(WITHDRAWALS_TS).not.toContain('hasPayoutInFlight');
    expect(WITHDRAWALS_TS).not.toContain('ExternalGates');
  });
});

describe('ADR-254 group 6: the engine contract carries the RULING, not the contradiction', () => {
  test('types.ts no longer reports the grain contested', () => {
    expect(TYPES_TS).not.toContain('THE GRAIN IS CONTESTED');
    expect(TYPES_TS).not.toContain('ADR-248 rules NEITHER');
    expect(TYPES_TS).toContain('ADR-254');
  });

  test('the hasPayoutInFlight declaration states the account grain', () => {
    const at = TYPES_TS.indexOf('readonly hasPayoutInFlight: boolean;');
    expect(at).toBeGreaterThan(-1);
    const doc = TYPES_TS.slice(Math.max(0, at - 700), at);
    expect(doc).toContain('account');
    expect(doc).toContain('ADR-254');
  });

  test('evaluate.ts no longer claims M01 still carries the retired vocabulary', () => {
    expect(EVALUATE_TS).not.toContain('still reads `approved | transferring | frozen`');
    expect(EVALUATE_TS).toContain('ADR-254');
  });
});
