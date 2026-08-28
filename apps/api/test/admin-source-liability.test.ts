// =============================================================================
// apps/api/test/admin-source-liability.test.ts
// =============================================================================
// `AdminReadSource.readLiability`, WHICH IS STILL NOT WRITABLE, AND THIS SUITE
// IS THE MEASUREMENT RATHER THAN THE CLAIM.
//
// There is no `src/admin-source/liability.ts` and this file is not the suite of
// a module. It is the suite of an ABSENCE, on the precedent session 349 set for
// `listEvents`: that session was dispatched to write an adapter, measured that
// the table it needed was not a `TableKey`, wrote the refusal down, and ADR-191
// is what unblocked it. Every case below is a live read of the tree with a
// stated CLEARING CONDITION, so the day a blocker lifts this file goes red and
// says which one, instead of the next session re-deriving all four.
//
// -----------------------------------------------------------------------------
// WHY AN ABSENCE NEEDS A TEST AND A PARAGRAPH DOES NOT DO
// -----------------------------------------------------------------------------
// `admin-source/index.ts` already carries the sentence, written by session 356:
// the "no join and no aggregate to reach for" reason is measured FALSE for
// `listFlags`, `readIdentityGraph` and `listEvents`, and "for `readLiability` it
// still stands in full". A sentence in a header is true on the day it is written
// and silent on every day after. `reserve_coverage_snapshots` will be registered
// by somebody, for some other read, and nothing in this tree would then tell the
// session holding this method that its blocker had gone.
//
// -----------------------------------------------------------------------------
// THE FOUR BLOCKERS ARE NOT ONE BLOCKER, AND THEY CLEAR SEPARATELY
// -----------------------------------------------------------------------------
// `LiabilityResponse` is a projection of SIX groups and only one of them has a
// producible source today:
//
//   `liability_snapshots` IS registered, so the seven top-level fields ADR-188
//   clause 1 rules are a keyed read plus ordinary code, exactly like the three
//   adapters this directory already holds.
//
//   `reserve` needs `reserve_coverage_snapshots`, which `0049` creates and no
//   file of `packages/db/src/` registers. A `Tx` naming it does not COMPILE,
//   which is session 349's `TS2322` on a different table.
//
//   `per_plan[].cusum`, `integrations.batch` and `eligible_next_7d` need columns
//   that no migration declares at all. That is a schema gap and not a type
//   error: the code would compile and there would be nothing to read.
//
// So the method's remaining work is a migration and a registration, both of them
// in `packages/db`, and neither is reachable from a fence over `apps/api`.
//
// -----------------------------------------------------------------------------
// THE COLUMN CENSUS IS DERIVED AND ITS NON-VACUITY IS ASSERTED FIRST
// -----------------------------------------------------------------------------
// {@link migrationColumnNames} parses every column name out of every migration,
// through `ALTER TABLE ... ADD COLUMN` as well as `CREATE TABLE`. A parse that
// silently matched nothing would make every absence below pass for the wrong
// reason, so the first case reads back five columns the response's own producible
// groups depend on, one of which (`funded_accounts`) exists only as an `ALTER`.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { TableKey } from '@merit/db';

import { AdminSourceNotComposed, composeAdminReadSource } from '../src/admin-source/index.ts';
import { IMPLEMENTED_ADMIN_READS } from '../src/admin-source/index.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'packages/db/migrations');

/**
 * Every column name any migration declares, as data read at run time.
 *
 * `ADD COLUMN` IS IN THE PATTERN AND THAT IS NOT DECORATION. `funded_accounts`
 * reaches `liability_snapshots` through `0049`'s `ALTER TABLE` rather than
 * through `0009`'s `CREATE TABLE`, so a pattern that read only table bodies
 * would report it absent and would report an `ALTER`-added column absent for
 * every other table too.
 *
 * A COMMENT LINE IS SKIPPED, because these files argue their own DDL in prose
 * and the prose names columns that other tables have.
 */
function migrationColumnNames(): ReadonlySet<string> {
  const types = [
    'bigint',
    'integer',
    'smallint',
    'numeric',
    'text',
    'boolean',
    'timestamptz',
    'timestamp',
    'date',
    'uuid',
    'jsonb',
    'json',
    'bytea',
    'inet',
    'interval',
    'real',
    'double precision',
    'char',
    'varchar',
  ].join('|');
  const declaration = new RegExp(
    `^\\s*(?:ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?)?([a-z_][a-z0-9_]*)\\s+(?:${types})\\b`,
    'i',
  );

  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    for (const line of readFileSync(join(MIGRATIONS, file), 'utf8').split('\n')) {
      if (/^\s*--/.test(line)) continue;
      const match = declaration.exec(line);
      if (match?.[1] !== undefined) names.add(match[1].toLowerCase());
    }
  }
  return names;
}

describe('the column census this suite reasons over', () => {
  it('reads real columns back, including one that exists only as an ALTER', () => {
    const columns = migrationColumnNames();

    // `0009`'s CREATE TABLE, and the two ADR-188 added to the response.
    expect(columns).toContain('open_liability_cents');
    expect(columns).toContain('wallet_balances_cents');
    // `0049`'s ALTER TABLE. Without this the absences below prove nothing about
    // a column somebody added to an existing table.
    expect(columns).toContain('funded_accounts');
    // `0016`'s plan_breaker_state, which is `per_plan`'s producible half.
    expect(columns).toContain('threshold_bp');
    // `mid_health`, which is the one group of `integrations` that has a table.
    expect(columns).toContain('decline_rate_bp');
  });
});

describe('readLiability is declared by the port and implemented by no module', () => {
  it('is absent from IMPLEMENTED_ADMIN_READS, which stays at the four that are written', () => {
    expect(IMPLEMENTED_ADMIN_READS).not.toContain('readLiability');
    expect([...IMPLEMENTED_ADMIN_READS]).toStrictEqual([...IMPLEMENTED_ADMIN_READS].sort());
  });

  it('refuses SYNCHRONOUSLY and names itself, rather than resolving to nothing', () => {
    // A rejected promise would be caught by the route's own error handling and
    // rendered as a read that failed. This is a deployment that was not
    // finished, and the throw is the loud version of that.
    const source = composeAdminReadSource({});
    expect(() => source.readLiability()).toThrow(AdminSourceNotComposed);
    expect(() => source.readLiability()).toThrow('readLiability');
  });
});

describe('blocker 1: reserve, and it is a compile error rather than a gap', () => {
  it('has a table that a migration creates', () => {
    const ddl = readFileSync(join(MIGRATIONS, '0049_reserve_coverage_snapshots.sql'), 'utf8');
    expect(ddl).toMatch(/^CREATE TABLE reserve_coverage_snapshots \($/m);
  });

  it('has no registration, so no Tx in this directory may name it', () => {
    // THE CLEARING CONDITION. When `packages/db` registers this table the name
    // is a `TableKey`, this case goes red, and `reserve` becomes a keyed read
    // like every other group. That registration is ADR-191's shape and it needs
    // an entry, which is why it is not done here.
    expect(TABLE_KEYS).not.toContain('reserveCoverageSnapshots');
    // Non-vacuity, and the contrast that makes the finding precise: the table
    // holding the SEVEN TOP-LEVEL FIELDS is registered, so what blocks this
    // method is the second table and never the first.
    expect(TABLE_KEYS).toContain('liabilitySnapshots');
    expect(TABLE_KEYS).toContain('treasuryBalances');
  });

  it('is 8 of the response field paths and 4 of them are ADR-188 clause 4s', () => {
    // Derived from the contract's own block rather than counted by hand, so a
    // field added to `reserve` moves this number with it.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    const block = /^ {2}reserve: \{(.*)\};$/m.exec(contract);
    expect(block?.[1]).toBeDefined();
    const members = (block?.[1] ?? '').split(';').filter((part) => part.trim() !== '');
    expect(members).toHaveLength(8);
    for (const name of ['as_of', 'treasury_account_code', 'treasury_as_of', 'treasury_source'])
      expect(members.some((member) => member.trim().startsWith(`${name}:`))).toBe(true);
  });
});

describe('blockers 2 to 4: three groups whose columns no migration declares', () => {
  it('has no CUSUM column anywhere, so per_plan[].cusum has nothing behind it', () => {
    const columns = [...migrationColumnNames()];
    expect(columns.filter((name) => name.includes('cusum'))).toStrictEqual([]);
    // `plan_breaker_state` is the table that would carry it and it carries the
    // OTHER half of `per_plan`: a ratio, a threshold, a sample size and a state.
    // So this group is partly producible, which is worse than wholly blocked:
    // three of its nine paths could be filled and six could not.
    const columns2 = migrationColumnNames();
    expect(columns2).toContain('ratio_bp');
    expect(columns2).toContain('sample_size');
  });

  it('has no batch-run column, so integrations.batch has nothing behind it', () => {
    const columns = migrationColumnNames();
    expect(columns).not.toContain('last_success_at');
    expect(columns).not.toContain('last_duration_ms');
  });

  it('has neither of SD-M6-01 eligible-forecast columns, which ADR-188 finding 9 measured', () => {
    // ADR-188 clause 5 refuses a FIELD for a figure no column produces, and
    // this is the read side of the same fact: the field `eligible_next_7d` is on
    // the wire already and the forecast behind it is stored nowhere.
    const columns = migrationColumnNames();
    expect(columns).not.toContain('eligible_next_7d_identity_max_cents');
    expect(columns).not.toContain('eligible_next_7d_identity_max_id');
  });
});

describe('ADR-195 term, and why no field for it landed with ADR-188 code half', () => {
  it('has no withdrawals_in_flight_cents column, so ADR-188 clause 5 refuses the field', () => {
    // ADR-195 section 6 row 1 owes this column and takes no migration number.
    // Its row 3 says the field follows from ADR-188 clause 1's projection "the
    // moment the column exists" and is refused before then. THE CLEARING
    // CONDITION IS THE COLUMN: this case goes red when it lands, and the field,
    // the delta row and the renderer are owed in the same slice.
    expect(migrationColumnNames()).not.toContain('withdrawals_in_flight_cents');
  });

  it('has the ledger account the term reads, so the gap is the snapshot and not the book', () => {
    const seed = readFileSync(join(MIGRATIONS, '0056_eighth_ledger_code.sql'), 'utf8');
    expect(seed).toContain("'withdrawals_in_flight'");
  });
});

describe('the keys this method would take are already reachable', () => {
  it('names six TableKeys the producible groups read, so only the gaps are gaps', () => {
    // A COMPILE-TIME ASSERTION AND NOT A RUNTIME ONE. The annotation is what
    // fails; the loop below only makes the same fact visible in a report.
    const keys: readonly TableKey[] = [
      'liabilitySnapshots',
      'treasuryBalances',
      'planBreakerState',
      'midHealth',
      'reconciliations',
      'plans',
    ];
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
  });
});
