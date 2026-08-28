// =============================================================================
// apps/api/test/admin-source-liability.test.ts
// =============================================================================
// `AdminReadSource.readLiability`, WHICH IS STILL NOT WRITTEN, AND THIS SUITE
// IS THE MEASUREMENT RATHER THAN THE CLAIM.
//
// TWO OF THE FOUR BLOCKERS HAVE CLEARED SINCE THIS FILE WAS WRITTEN AND THE
// CASES ARE WHAT SAID SO (ADR-199). Blocker 1 went RED, which is the news a
// clearing condition exists to deliver: `packages/db` registered
// `reserve_coverage_snapshots` and `reserve` is a keyed read now. Blockers 2 to
// 4 are still GREEN and their MEANING changed underneath them, which is the
// harder half: the columns are still absent and the absences are now RULED
// CORRECT rather than owed, so the cases are kept as live readings and their
// comments are repointed at the rulings. See each one below.
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
//   `reserve` needed `reserve_coverage_snapshots`, which `0049` creates and no
//   file of `packages/db/src/` registered. A `Tx` naming it did not COMPILE,
//   which was session 349's `TS2322` on a different table. **CLEARED by
//   ADR-199**, which registered it `firm`.
//
//   `per_plan[].cusum`, `integrations.batch` and `eligible_next_7d` name no
//   column any migration declares. THAT WAS READ AS A SCHEMA GAP AND ADR-199
//   RULES IT IS NOT ONE: all three are DERIVABLE from columns that already
//   exist, so the census below measures a correct absence rather than an owed
//   migration. `per_plan[].cusum` is ADR-167 clause 1, recomputed at read time
//   and stored nowhere by ruling; `integrations.batch` is the `batch.completed`
//   event, whose payload carries `duration_ms` and whose table has been a
//   `TableKey` since ADR-191; `eligible_next_7d` is a fold over `rule_states`,
//   `plan_versions.rules` and `trading_calendar`.
//
// So the method's remaining work is NEITHER a migration nor a registration. It
// is the adapter itself plus two things outside `packages/db`: `DEP-M6-05`'s
// calibration, which ADR-167 clause 5 says is rendered ABSENT rather than
// manufactured, and `trading_calendar`, which is the one input of the three
// derivations that is still not a `TableKey` (its `_loads` and `_revisions` are).
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

describe('blocker 1: reserve, and it CLEARED -- ADR-199 registered the table', () => {
  it('has a table that a migration creates', () => {
    const ddl = readFileSync(join(MIGRATIONS, '0049_reserve_coverage_snapshots.sql'), 'utf8');
    expect(ddl).toMatch(/^CREATE TABLE reserve_coverage_snapshots \($/m);
  });

  it('is now a TableKey, so a Tx in this directory may name it', () => {
    // THE CLEARING CONDITION FIRED, WHICH IS THE NEWS THIS CASE EXISTS TO
    // DELIVER. It read `expect(TABLE_KEYS).not.toContain(...)` and went red the
    // moment `packages/db` registered the table, exactly as session 363 wrote
    // it to. ADR-199 is that registration: `firm`, on the DDL rather than on
    // the name, because the row declares no column against `identities(id)` and
    // its one foreign key is a COMPOSITE edge to `treasury_balances`, which is
    // itself firm. `reserve` is a keyed read now, like every other group.
    expect(TABLE_KEYS).toContain('reserveCoverageSnapshots');
    // Non-vacuity, and the contrast that made the finding precise: the table
    // holding the SEVEN TOP-LEVEL FIELDS was registered all along, so what
    // blocked this method was the second table and never the first.
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

// ADR-199 RULES ALL THREE OF THESE DERIVABLE, so what these cases now measure is
// that the schema still declares no column for a figure the corpus says must not
// have one. They are kept, and re-titled, because a case deleted the day its
// reading changes is a measurement nobody can re-run.
describe('blockers 2 to 4: three groups ADR-199 rules DERIVABLE rather than owed a column', () => {
  it('has no CUSUM column anywhere, which ADR-167 clause 1 RULES rather than laments', () => {
    // ADR-167 takes reading 3: `S_t` is folded at read time from the pass-rate
    // series and "no column, table or row anywhere holds it", and `0051` was
    // returned to the pool for it. So this absence is the ruling holding, and
    // the day a CUSUM column lands it is that ruling being overturned rather
    // than this blocker clearing.
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

  it('has no batch-run column, because the batch reports through EVENTS instead', () => {
    // ADR-199. The two names are absent and the FIGURES are not: EVENTS.md
    // section 5 declares `batch.started` / `batch.completed` with a payload of
    // `{ run_id, trading_day, accounts_total, accounts_done, duration_ms }`, and
    // `events` has been a `TableKey` since ADR-191. `last_success_at` is the
    // `occurred_at` of the latest `batch.completed` row and `last_duration_ms`
    // is that row's `payload->>'duration_ms'`. A batch-run column would be a
    // SECOND record of a fact this schema already holds, which is `0049` header
    // item 1's own objection to storing a value beside its inputs.
    const columns = migrationColumnNames();
    expect(columns).not.toContain('last_success_at');
    expect(columns).not.toContain('last_duration_ms');
    // The derivation's own columns, read back so the absence above is not the
    // only thing this case asserts.
    expect(columns).toContain('event_name');
    expect(columns).toContain('occurred_at');
    expect(columns).toContain('payload');
  });

  it('has neither of SD-M6-01 eligible-forecast columns, which are a DIFFERENT figure', () => {
    // ADR-188 clause 5 refuses a FIELD for a figure no column produces, and the
    // two columns below are that figure: `P-M6-03`'s largest-single-identity
    // share, which is on NO field of `LiabilityResponse`. ADR-199 separates
    // them: the response's `eligible_next_7d` is `{ total_cents, account_count,
    // by_day[] }`, and every input it folds is landed -- `rule_states`,
    // `plan_versions.rules` and `trading_calendar` -- which is why `0062` was
    // not taken for it. This case therefore measures the identity maximum and
    // says nothing about the group, which is the distinction it used to blur.
    const columns = migrationColumnNames();
    expect(columns).not.toContain('eligible_next_7d_identity_max_cents');
    expect(columns).not.toContain('eligible_next_7d_identity_max_id');
    // The fold's inputs, read back so the ruling above is checkable here.
    expect(columns).toContain('withdrawable_cents');
    expect(columns).toContain('payout_anchor_day');
    expect(columns).toContain('trading_day');
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
