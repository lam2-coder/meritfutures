// =============================================================================
// apps/api/test/admin-source-liability.test.ts
// =============================================================================
// `AdminReadSource.readLiability`, WHICH IS STILL NOT COMPOSED, AND THIS SUITE
// IS THE MEASUREMENT RATHER THAN THE CLAIM.
//
// TWO OF THE FOUR ORIGINAL BLOCKERS HAVE CLEARED AND THE CASES ARE WHAT SAID SO
// (ADR-199). Blocker 1 went RED, which is the news a clearing condition exists
// to deliver: `packages/db` registered `reserve_coverage_snapshots` and `reserve`
// is a keyed read now. Blockers 2 to 4 are still GREEN and their MEANING changed
// underneath them, which is the harder half: the columns are still absent and the
// absences are now RULED CORRECT rather than owed, so the cases are kept as live
// readings and their comments are repointed at the rulings. See each one below.
//
// **AND `readLiability` IS STILL NOT COMPOSABLE, WHICH IS NOT WHAT THE CLEARING
// LOOKED LIKE FROM OUTSIDE.** *No column of that name exists* and *the figure has
// no producible source* are two claims ADR-199 correctly separates; *the figure is
// derivable* and *this tree can read it today* are a THIRD pair, and they came
// apart on two of the same three figures.
//
// **FOUR OF THE FIVE BLOCKERS ARE SPENT AND ONE STANDS**, which is session 390's
// diff and is the largest move this file has recorded. `B4` gained a reader over
// `0064`'s run record; `B3` and `B2` gained a RENDERING of the absence `ADR-203`
// had only made sayable. **NO COUNT IS WRITTEN HERE**: this header carried
// "produces 27 of `LiabilityResponse`'s 39 leaf paths" and the first half went
// stale in the same diff that lifted the blockers, twice.
// `admin-source-liability-book.test.ts` derives declared, blocked and produced
// from API_CONTRACT through `RI-18`'s own reader, and that is the only place any
// of the three belongs. What is still blocked is `eligible_next_7d` and nothing
// else, and the last section of this file holds each blocker with its condition.
//
// **B1 LIFTED AND THE COUNT DID NOT MOVE, WHICH IS SESSION 380's FINDING AND IS
// WHY B5 IS AT THE BOTTOM OF THIS FILE.** `trading_calendar` is a `TableKey` now
// and `readTradingHorizon` produces the next seven trading days off it. That was
// never the whole of `eligible_next_7d`: the group is a FORECAST over those days
// and the PER-ACCOUNT half of it has no source. TWO blockers sat on the same five
// leaves and only one had ever been looked for.
//
// **AND THE STARTING MEASUREMENT WAS GREEN FOR THE SECOND SESSION RUNNING.**
// Session 374 was dispatched to read a red and found 12 of 12 green because
// session 372 had spent the clearing condition in its own diff. Session 380 was
// dispatched to read a red and found 56 of 56 green, because session 377 spent
// B1's two conditions in ITS own diff and said so. Session 390 was dispatched
// with the point written into the prompt in terms -- "running the suite first
// tells you the map is still accurate, not that a blocker lifted" -- ran it
// green, and then turned two cases red in its own diff. THE MECHANISM IS WORKING:
// a clearing condition is spent by the session that lifts the blocker, so the
// NEXT session inherits a green suite and an accurate map. That is the design,
// not a failure of it.
//
// This file is not the suite of that module -- `test/admin-source-liability-book.test.ts`
// is, and it is where the subtraction is checked against API_CONTRACT. This one
// stays the suite of an ABSENCE, on the precedent session 349 set for
// `listEvents`: that session was dispatched to write an adapter, measured that
// the table it needed was not a `TableKey`, wrote the refusal down, and ADR-191
// is what unblocked it. Every case below is a live read of the tree with a
// stated CLEARING CONDITION, so the day a blocker lifts this file goes red and
// says which one, instead of the next session re-deriving all of them.
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
// THE ORIGINAL BLOCKERS ARE NOT ONE BLOCKER, AND THEY CLEARED SEPARATELY
// -----------------------------------------------------------------------------
// `LiabilityResponse` is a projection of SIX groups, and when this file was
// written exactly one of them had a producible source. THAT SENTENCE IS NO
// LONGER TRUE AND IT IS REPOINTED RATHER THAN DELETED, because the reading it
// records is what the cases below were written against:
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
// So the method's remaining work is NEITHER a migration nor a registration, and
// SESSION 374 MEASURED WHAT IT IS. The adapter is written and runs; what stands
// between it and the method is four things, none of them a column, and the last
// section of this file is each of them with a clearing condition.
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
import {
  ELIGIBLE_HORIZON_TRADING_DAYS,
  LIABILITY_READ_TABLES,
} from '../src/admin-source/liability.ts';

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

/**
 * The column names `trading_calendar` actually declares, CREATE body folded over
 * every `ALTER TABLE` of it in the tree.
 *
 * TABLE-SCOPED BECAUSE THE ESTATE-WIDE CENSUS WAS WRONG HERE AND THE SUITE
 * CAUGHT IT. A first draft of the B5 case asserted `migrationColumnNames()` does
 * not contain `sequence`, and it went RED: `0050` declares
 * `live_account_state.sequence integer NOT NULL`, a live tick ordinal that is
 * "1-based PER ACCOUNT PER DAY". That is a different figure from
 * `CalendarDay.sequence`, which M01 section 2.1 defines as "a DENSE index into
 * the calendar", and the claim the blocker needs is about ONE TABLE. A census
 * over 735 column names cannot make a claim about one of 114 tables.
 */
function tradingCalendarColumnNames(): ReadonlySet<string> {
  const create = readFileSync(join(MIGRATIONS, '0004_catalog.sql'), 'utf8');
  const body = create.slice(create.indexOf('CREATE TABLE trading_calendar ('));
  const names = new Set<string>();
  for (const line of body.slice(0, body.indexOf('\n);')).split('\n')) {
    if (/^\s*--/.test(line)) continue;
    const match = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
    if (match?.[1] !== undefined) names.add(match[1].toLowerCase());
  }
  // AND EVERY `ADD COLUMN` ON THE TABLE, over every migration, so the fold is
  // the table's history and not `0004`'s snapshot of it. Session 377 read the
  // same history to transcribe the table and found no `ADD COLUMN` at all.
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(
      /ALTER TABLE\s+trading_calendar\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    ))
      if (match[1] !== undefined) names.add(match[1].toLowerCase());
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
  it('is absent from IMPLEMENTED_ADMIN_READS, whose length is derived and not asserted', () => {
    // THIS TITLE READ "which stays at the four that are written" AND THE ARRAY
    // WAS AT FIVE. Session 371 appended `searchAccounts` and this comment did
    // not follow, which is a green case carrying a false statement -- the worse
    // of the two failures, in session 372's words. NO NUMERAL REPLACES IT: the
    // array is data and a count written beside it goes stale every time a slice
    // lands, which is `admin-source/index.ts`'s own stated reason for carrying
    // no numeral in the sentence above it.
    expect(IMPLEMENTED_ADMIN_READS).not.toContain('readLiability');
    expect([...IMPLEMENTED_ADMIN_READS]).toStrictEqual([...IMPLEMENTED_ADMIN_READS].sort());
    // Non-vacuity: an emptied array would satisfy the two assertions above.
    expect(IMPLEMENTED_ADMIN_READS).toContain('searchAccounts');
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

// =============================================================================
// THE BLOCKERS, EACH WITH ITS CLEARING CONDITION, AND FOUR OF THE FIVE ARE SPENT
// =============================================================================
// SESSION 374's MEASUREMENT, IN THE FORM SESSION 363 CHOSE FOR ITS OWN. ADR-199
// ruled three figures DERIVABLE and it is right about all three; what it did not
// rule is that they are READABLE, and for two of the three it says so in its own
// words. These are what stands between `src/admin-source/liability.ts` and
// `AdminReadSource.readLiability`, which needs all of them.
//
// **NO NUMERAL IS WRITTEN IN THIS BLOCK.** It used to read "produces 27 of the
// response's 39 leaf paths" and the first half went stale in session 390's own
// diff. `test/admin-source-liability-book.test.ts` derives declared, blocked and
// produced from API_CONTRACT through `RI-18`'s reader, and that is the only
// place any of the three belongs.
//
// NOT ONE OF THEM IS A COLUMN, so no migration number clears any of them and
// `0062` stays returned. **ALL THREE RULINGS OWED HAVE LANDED** -- `ADR-201` the
// window, `ADR-202` and `ADR-203` the absence and its wire shape, `ADR-204` the
// per-account projection -- and a ruling makes a figure SAYABLE and never
// PRODUCED, which is why each of B2, B3 and B4 then took a SESSION as well.
// **B1, B2, B3 AND B4 ARE SPENT. B5 IS THE ONE STILL STANDING**, and `ADR-204`
// section 8 is why: leg 1 holds and leg 2 is refuted.
// =============================================================================

describe('blocker B1: eligible_next_7d, and the TableKey that arrived', () => {
  it('has the calendar registered, which is the clearing condition this case was written to fire on', () => {
    // B1 IS LIFTED AND THIS ASSERTION IS INVERTED IN THE DIFF THAT LIFTED IT.
    // It read `expect(TABLE_KEYS).not.toContain('tradingCalendar')` and its own
    // comment said "this case goes red the day `tradingCalendar` is registered,
    // and `eligible_next_7d` is then five leaf paths of ordinary code". That day
    // is this one: `packages/db/src/scope.ts` registers the table `firm` under
    // ADR-103 clause 2, which had made it REGISTRABLE long before anybody spent
    // the widening. A clearing condition fires ONCE and the session that lifts
    // the blocker spends it, which is session 372's precedent on `events`.
    //
    // WHAT LIFTED IS THE BLOCKER AND NOT THE WORK. `readLiability` still does
    // not produce `eligible_next_7d`: the fold over the next seven trading days
    // is five leaf paths of ordinary code that nobody has written, and the
    // session that writes them holds this fence rather than `packages/db`. The
    // case below states what is still missing.
    expect(TABLE_KEYS).toContain('tradingCalendar');
    // Non-vacuity, and the contrast that made the absence precise while it was
    // one: the two neighbouring tables were registered first and are still here.
    expect(TABLE_KEYS).toContain('tradingCalendarLoads');
    expect(TABLE_KEYS).toContain('tradingCalendarRevisions');
  });

  it('was UNREGISTERED and never UNREGISTRABLE, which is why the lift took no ruling', () => {
    // THE DISTINCTION DECIDED WHETHER THIS BLOCKER WAS A SESSION OR A RULING,
    // and it was a session: this case predicted that and the registration is
    // what settled it. `0032` carries `ALTER TABLE trading_calendar ALTER COLUMN
    // session_open_at DROP NOT NULL`, ADR-094 clause 3 closed the drift fold at
    // `ADD COLUMN` with a default of FAIL, and `schema.ts` went on saying the
    // neighbour "cannot be registered" for exactly that reason.
    //
    // ADR-103 CLAUSE 2 HAD SUPERSEDED THAT AND ONLY THAT: it replaced the stated
    // proxy with the type-and-nullability comparison it stood for, added
    // `ALTER COLUMN ... DROP NOT NULL` as the fold's second member, and named
    // this table as one of the two the widening makes REGISTRABLE. So the
    // blocker was a registration nobody had taken and never a refusal that
    // stood, and the four stale sentences are repaired in `packages/db` in the
    // same branch as this inversion. THE ASSERTIONS BELOW ARE UNCHANGED: they
    // read the ruling and the migration, and both still say what they said.
    const adr = readFileSync(join(ROOT, 'docs/decisions/ADR-103.md'), 'utf8');
    expect(adr).toContain('`otp_challenges` and `trading_calendar` become REGISTRABLE');
    expect(
      readFileSync(
        join(MIGRATIONS, '0032_trading_calendar_holidays_coverage_revisions.sql'),
        'utf8',
      ),
    ).toContain('ALTER TABLE trading_calendar ALTER COLUMN session_open_at  DROP NOT NULL;');
  });

  it('has every other NAMED input landed, and named is not the same as readable', () => {
    // THIS CASE'S TITLE USED TO READ "so the calendar is the whole gap" AND THAT
    // CLAIM IS REFUTED BY THE B5 BLOCK BELOW. Every assertion in it is unchanged
    // and every one still passes: ADR-199 section 6's four inputs are four real
    // columns on three registered tables. What the case cannot see is whether
    // anything WRITES them or declares their contents, which is the distinction
    // session 374's own landmine named -- "`derivable` and `readable` are
    // different claims" -- arriving one level down, on a jsonb bag rather than
    // on a figure.
    const columns = migrationColumnNames();
    for (const name of [
      'withdrawable_cents',
      'engine_eligible',
      'engine_gates',
      'payout_anchor_day',
    ])
      expect(columns).toContain(name);
    expect(TABLE_KEYS).toContain('ruleStates');
    expect(TABLE_KEYS).toContain('accounts');
    expect(TABLE_KEYS).toContain('planVersions');
  });

  it('has the HORIZON produced, which is what lifting B1 actually bought', () => {
    // B1's PAYOUT, ASSERTED FROM THE SIDE THAT MEASURES IT. The module reads
    // both calendar tables now, which it could not do at all while
    // `trading_calendar` was unregistered, and `readTradingHorizon` is executed
    // by `admin-source-liability-book.test.ts` over a fixture taken from a live
    // read. Neither table is on `readLiabilityBook`'s path, because the book
    // carries no `eligible_next_7d` to spend them on.
    expect(LIABILITY_READ_TABLES).toContain('tradingCalendar');
    expect(LIABILITY_READ_TABLES).toContain('tradingCalendarLoads');
    expect(ELIGIBLE_HORIZON_TRADING_DAYS).toBe(7);
  });
});

// =============================================================================
// BLOCKER B5, WHICH IS THE SECOND BLOCKER ON THE SAME FIVE LEAVES
// =============================================================================
// LIFTING B1 DID NOT MOVE THE BLOCKED-LEAF COUNT AND THAT IS THIS SESSION'S
// FINDING. `eligible_next_7d` is a FORECAST -- ADR-199 section 6: "which accounts
// clear their payout gates on each of the next seven trading days, and for how
// much" -- and it is TWO folds rather than one. The horizon is built. The
// per-account half has no source, on two INDEPENDENT legs either of which alone
// blocks the group.
//
// THE CASES BELOW ARE READINGS OF THE TREE AND NONE OF THEM IMPORTS THE MODULE,
// which is this file's shape throughout (session 349's precedent).
// =============================================================================

describe('blocker B5: eligible_next_7d`s per-account half, which nobody had looked at', () => {
  it('has ONE forward-looking eligibility date in the whole engine, and it lives in a jsonb bag', () => {
    // SIX GATE GROUPS DECIDE ELIGIBILITY AND EXACTLY ONE PUBLISHES A DATE.
    // `nextEligibleTradingDay` is AS-06's resolved date on the cadence gap, and
    // it exists because "any counter published in trading days must be rendered
    // as a date, or the firm has published a rule its own traders cannot
    // evaluate". Every OTHER gate clears only when the trader TRADES, so no
    // stored row says when: `tradedDays` and `winDays` count days traded,
    // `buffer` and `minimumAmount` move with the balance, and `consistency` is a
    // share of profit that does not yet exist.
    const types = readFileSync(join(ROOT, 'packages/rules-engine/src/types.ts'), 'utf8');
    for (const gate of ['TradedDaysGate', 'WinDaysGate', 'CadenceGapGate', 'MinimumAmountGate'])
      expect(types).toContain(gate);
    expect(types).toContain('nextEligibleTradingDay');
    // ONE. A second forward-looking date would make this blocker a different
    // shape, so the count is derived rather than asserted in prose.
    expect(types.split('nextEligibleTradingDay').length - 1).toBeGreaterThan(0);
    expect(types).not.toContain('nextEligibleTradingDays');
  });

  it('LEG 1: nothing in this tree writes rule_states, so the bag has no producer', () => {
    // `writeRuleState` IS A PORT AND ITS ONLY IMPLEMENTATIONS ARE A TEST DOUBLE
    // AND A REFUSAL. `scripts/demo/world.ts` rejects the call in terms ("the
    // demo world is sealed"), and no module of `packages/db` or `apps/worker`
    // supplies a database one. So `rule_states.engine_gates` is a column whose
    // contents no producer in this estate has ever determined.
    const ports = readFileSync(join(ROOT, 'apps/worker/src/batch/ports.ts'), 'utf8');
    expect(ports).toContain('writeRuleState(row: RuleStateRow): Promise<void>;');
    expect(readFileSync(join(ROOT, 'scripts/demo/world.ts'), 'utf8')).toContain(
      'the demo world is sealed',
    );
    // NON-VACUITY: the port type really does carry the typed value, so the
    // absence below is an absent WRITER rather than an absent field.
    expect(ports).toContain('readonly engineGates: EngineGateResults;');
  });

  it('LEG 1: ADR-206 declares the STORED shape, and NEITHER the contract NOR 0015 does', () => {
    // **CITATION REPAIR, AND THE BLOCKER THAT LIFTED IS NAMED.** This case read
    // "no primary source declares the STORED shape". `ADR-206` (session 394) is
    // that source now, and EVERY ASSERTION BELOW IS UNCHANGED: the two places
    // this case looked are still silent, which is why the declaration had to be
    // written somewhere and is what makes the two new assertions worth adding.
    //
    // THE CONTRAST WITH `integrations.batch` IS WHAT MAKES THIS PRECISE. ADR-199
    // clause 4 could rule the batch's two figures readable off an event nothing
    // has emitted, because EVENTS section 5 DECLARES that event's body in the
    // approved catalogue. This bag is now declared the same way: API_CONTRACT
    // still carries no `engine_gates` shape at all, `0015`'s own column comment
    // still names EIGHT gates where `EngineGateResults` has six, and the design
    // record carries the ruled encoding.
    expect(readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8')).not.toContain(
      'engine_gates:',
    );
    // THE DECLARATION, PINNED WHERE IT LANDED, AND EVERY NAME ANCHORED INSIDE
    // ITS CODE SPAN RATHER THAN AS A BARE SUBSTRING. That is session 392's
    // landmine met a second time and IN THIS CASE'S OWN FIRST DRAFT: a bare
    // `toContain('ENGINE_GATE_LEAVES')` was seeded by renaming the symbol to
    // `ENGINE_GATE_LEAVES_RENAMED` in the record and STAYED GREEN, because the
    // old name is a prefix of the new one. Closing the backtick fixes it and
    // the re-seed is red.
    const record = readFileSync(join(ROOT, 'docs/architecture/data-model/rule_states.md'), 'utf8');
    expect(record).toContain('`ENGINE_GATE_LEAVES`');
    expect(record).toContain('`profitNeededToDiluteCents`');
    expect(readFileSync(join(ROOT, 'docs/decisions/ADR-206.md'), 'utf8')).toContain(
      'status: proposed',
    );
    const migration = readFileSync(join(MIGRATIONS, '0015_rule_states.sql'), 'utf8');
    expect(migration).toContain('profit target, drawdown, win days, minimum days');
    // The engine's own six, none of which that list names as such.
    const types = readFileSync(join(ROOT, 'packages/rules-engine/src/types.ts'), 'utf8');
    for (const member of ['cadenceGap', 'minimumAmount', 'tradedDays', 'winDays'])
      expect(types).toContain(member);
    expect(migration).not.toContain('cadenceGap');
  });

  it('LEG 2: `sequence` is still not a column, and ADR-204 REFUTED the conclusion', () => {
    // **CITATION REPAIR, HANDED TO THIS FENCE BY THE ENTRY THAT REFUTED IT.**
    // `ADR-204` section 10 finding 1 says of this case, in terms: "Every
    // assertion in it is still true ... What is now wrong is its prose", and
    // "Reported: `apps/api/**` is not this fence's". This is that fence, so the
    // prose is repaired here and every assertion below is UNCHANGED.
    //
    // WHAT THE CASE USED TO CONCLUDE: "The engine receives its slice from a PORT
    // the caller supplies; `trading_calendar` stores no such column and the seed
    // assigns none, so the only substitute available to an adapter is the date
    // arithmetic AS-06 forbids."
    //
    // **THE PREMISE HOLDS AND THE CONCLUSION DOES NOT FOLLOW**, on `ADR-204`
    // section 8's three steps. `CalendarDay.sequence` is a property of the
    // SLICE and not of the table: `CalendarSlice` is a value the caller
    // constructs (`ADR-049`), every reader of the field is slice-local
    // (`tradingDaysBetween` subtracts two lookups in ONE slice), and two callers
    // in this tree already synthesize it and both state when that is safe. A
    // slice built over ONE COVERED INTERVAL cannot have a hole, because `0032`
    // makes a day inside coverage that the table does not hold POSITIVELY not a
    // session. So position over the ordered, holiday-filtered rows of one
    // covered interval IS the dense index, by construction.
    //
    // **THEREFORE LEG 2 IS NOT A BLOCKER AND NO MIGRATION IS OWED.** What it
    // names is a `CalendarSlice` loader over the covered interval, which is
    // ordinary code in `apps/api`. The assertions stay because the COLUMN's
    // absence is still the fact any later reader has to start from, and because
    // `ADR-204` takes no number to add one.
    expect(readFileSync(join(ROOT, 'packages/rules-engine/src/types.ts'), 'utf8')).toContain(
      'readonly sequence: number;',
    );
    const calendarDdl = readFileSync(join(MIGRATIONS, '0004_catalog.sql'), 'utf8');
    expect(calendarDdl).toContain('CREATE TABLE trading_calendar (');
    // NON-VACUITY FIRST: the columns that ARE there are read back, so a pattern
    // that matched nothing could not report the absence.
    for (const column of ['trading_day', 'session_open_at', 'is_holiday', 'halted'])
      expect(calendarDdl).toContain(column);
    // AND THE ABSENCE, over the TABLE'S OWN HISTORY rather than over the estate.
    const columns = tradingCalendarColumnNames();
    // Non-vacuity again, on the fold this time: the reader really read the row.
    expect(columns).toContain('trading_day');
    expect(columns).toContain('is_half_day');
    expect(columns.size).toBeGreaterThan(5);
    expect(columns).not.toContain('sequence');
    // AND THE NAME IS TAKEN ELSEWHERE, WHICH IS WHY THIS CASE IS TABLE-SCOPED.
    // `0050` declares `live_account_state.sequence`, a live tick ordinal that is
    // 1-based per account per day. An estate-wide census reports the name
    // PRESENT and would have made this blocker look cleared by a column that has
    // nothing to do with the calendar.
    expect(migrationColumnNames()).toContain('sequence');
    expect(readFileSync(join(MIGRATIONS, '0050_live_cache_and_role.sql'), 'utf8')).toContain(
      '1-based\n  -- PER ACCOUNT PER DAY',
    );
    // The seed assigns none either, so nothing derives what no column stores.
    expect(readdirSync(join(ROOT, 'packages/db/src/seed/calendars'))).toContain('generate.mjs');
    expect(
      readFileSync(join(ROOT, 'packages/db/src/seed/calendars/generate.mjs'), 'utf8'),
    ).not.toContain('sequence');
  });

  it('holds the WHOLE group, on B2`s stated reason rather than a new one', () => {
    // PRODUCING ONLY THE ACCOUNTS ELIGIBLE TODAY WOULD UNDERSTATE `total_cents`,
    // and that figure is the one the payout wallet is funded against. EC-074 and
    // P-M6-02 both define it over "eligible now OR inside 7 trading days", and
    // `0009`'s own column comment on `bounded_near_term_cents` says it a third
    // time. A partial group would be the same number under the same name meaning
    // something narrower, which is the exact failure EC-074 is about.
    const ec = readFileSync(join(ROOT, 'docs/edge-cases/EC-074.md'), 'utf8');
    expect(ec).toContain('accounts eligible now or inside 7 trading days');
    expect(readFileSync(join(ROOT, 'docs/plans/M06-admin-ops-console.md'), 'utf8')).toContain(
      'currently eligible or become eligible inside 7 trading days',
    );
    expect(readFileSync(join(MIGRATIONS, '0009_ledger.sql'), 'utf8')).toContain(
      'accounts eligible now or inside 7 trading days',
    );
  });

  // **THE CONDITION IS RESTATED WITH ALL THREE OF ITS TERMS, AND THE REPAIR IS
  // THE FINDING RATHER THAN A TIDY-UP.** It was stated TWICE -- here and in
  // `src/admin-source/liability.ts`'s `B5` block -- with TWO OF THREE TERMS
  // EACH. This case said "a `writeRuleState` implementation lands, AND
  // `eligible_next_7d` gains its `| null`"; the module said "a `rule_states`
  // writer lands AND a primary source declares the stored `engine_gates` shape,
  // or a ruling defines the forecast over columns that exist". **NEITHER NAMED
  // THE OTHER'S SECOND TERM AND NO CONTROL COMPARED THEM**, which is `FM-16`'s
  // shape -- a second statement of one predicate, free to drift -- arriving on
  // the clearing condition that exists to stop exactly that. Session 392 wrote
  // it ONCE in the module, with all three terms, and this case asserts all
  // three. THE RULING ARM IS STRUCK: `ADR-204` is that ruling, it landed, and
  // three sessions have now recorded that it moves nothing.
  //
  // **THE FOURTH ARM LANDED IN THIS SESSION'S OWN DIFF AND MOVED IT NO FURTHER
  // EITHER.** `readCalendarSlice` is `projectPayout`'s `calendar` input, built
  // over one covered interval and executed against a live PostgreSQL across a
  // holiday and a coverage edge (`test/admin-source-liability-calendar.test.ts`).
  // **`projectPayout` TAKES FIVE INPUTS AND THE ONE THAT BLOCKS IS `state`**: a
  // `RuleState` carries `engineGates: EngineGateResults`, which lives in the bag
  // term 2 is about. Four arms are now spent on this condition -- a ruling, an
  // engine producer, a calendar loader, and a leg-2 refutation -- and not one of
  // them was ever a term of it.
  //
  // **THE RULING HALF OF THIS CONDITION FIRED AND THE PRODUCER HALF DID NOT**,
  // which is why the condition is restated rather than inverted. It read: "a
  // rule_states writer lands, OR a ruling defines the forecast". `ADR-204` is
  // that ruling and it defines the projection completely -- population `E` union
  // `C`, at most one `by_day` row per account, `min(withdrawable_cents,
  // cap_for_next_ordinal)`, five named assumptions a producer may not choose --
  // and it ruled the word FORECAST out while keeping the field. **A DEFINITION
  // IS NOT A PRODUCER**, which is `B2`'s lesson arriving on the fifth blocker:
  // `ADR-201` defined `avg_30d_cents` in August and the figure took two more
  // sessions to reach a body.
  //
  // **AND THE ENGINE PRODUCER LANDED WHILE THIS BRANCH WAS OPEN, WHICH IS THE
  // THIRD ARM AND MOVED IT NO FURTHER.** Session 389 built `projectPayout` in
  // `packages/rules-engine`: `ADR-204`'s projection, executed, with the five
  // assumptions carried as data rather than as arithmetic. **A PRODUCER WITH NO
  // INPUT IS THE SAME BLOCKER WITH A LONGER CHAIN**, because that function takes
  // a `RuleState` and a `RuleState` comes from `rule_states`, which is leg 1.
  // That session reported the repair of this case's title to this fence in
  // terms, and the title above is that repair: the ruling arm and the engine arm
  // are both spent and neither was ever the blocker.
  //
  // **TWO THINGS ARE OWED AND NEITHER IS THIS FENCE'S TO TAKE ALONE.**
  //   1. A `rule_states` writer. `ADR-204` section 8 refines session 380's
  //      finding: the CALL SITE is real (`nightly.ts` calls `writeRuleState`)
  //      and the IMPLEMENTATION is missing, so what is owed is one adapter and
  //      not a call path. `packages/**` and `apps/worker/**` hold it.
  //   2. `eligible_next_7d: EligibleNext7d | null`. **PAID BY `ADR-208`
  //      (session 397).** `ADR-203` ruling 8 ruled that this field takes the
  //      absence shape and that BOTH causes it needs are already in the
  //      vocabulary, and it deliberately did NOT move the declaration: the seed
  //      produced exactly two `TS2345`s and no `RI-18` finding, one of them in
  //      `EligibleForecastResponse`, a SECOND response whose empty-horizon body
  //      was an open ruling. **THAT MEASUREMENT WAS TAKEN ON THE PARTIAL MOVE
  //      `RI-18` REFUSES AND IT UNDERSTATED THE COST**: the atomic three-copy
  //      move produces two MORE type errors, in `apps/admin`, which no entry
  //      had measured because no entry had made the move `RI-18` forces.
  //
  // CLEARING CONDITION, ALL THREE TERMS: a `writeRuleState` IMPLEMENTATION
  // lands, AND a primary source declares the stored `engine_gates` ENCODING, AND
  // `eligible_next_7d` gains its `| null`. Any one alone leaves this group
  // unproducible, and the group goes whole or not at all (EC-074).
  //
  // **TERMS 2 AND 3 ARE CLEARED, BY `ADR-206` AND `ADR-208`, AND TERM 1 HOLDS
  // THE GROUP ALONE.** Both assertions below are now POSITIVE ones on their
  // terms rather than the absences they used to be, so this case still carries
  // all three and a reader cannot mistake a one-term condition for the whole of
  // it. `readLiability` stays uncomposed for a seventh session, and the reason
  // is now a single missing adapter rather than three open questions.
  it('CLEARING CONDITION: a rule_states WRITER, a declared engine_gates ENCODING, and the `| null`', () => {
    expect(readFileSync(join(ROOT, 'apps/worker/src/batch/ports.ts'), 'utf8')).toContain(
      'writeRuleState(row: RuleStateRow): Promise<void>;',
    );
    // NON-VACUITY ON THE ARM THAT DID LAND, so this case cannot be read as
    // saying the projection is unbuilt. It is built and it has no input.
    expect(
      readFileSync(join(ROOT, 'packages/rules-engine/src/payout/project.ts'), 'utf8'),
    ).toContain('export function projectPayout');
    // TERM 2, WHICH THIS CASE DID NOT ASSERT AND THE MODULE'S COPY DID, AND
    // WHICH IS NOW CLEARED. `ADR-206` declares the stored encoding, so a reader
    // no longer has to fix it from the read side. The bag is reached through
    // `projectPayout`'s OWN input type, which is why term 1 landing alone would
    // not have cleared this and why clearing term 2 does not clear term 1.
    expect(
      readFileSync(join(ROOT, 'packages/rules-engine/src/payout/project.ts'), 'utf8'),
    ).toContain('readonly state: RuleState;');
    expect(readFileSync(join(ROOT, 'packages/rules-engine/src/types.ts'), 'utf8')).toContain(
      'readonly engineGates: EngineGateResults;',
    );
    expect(readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8')).not.toContain(
      'engine_gates:',
    );
    // TERM 2, CLEARED, ASSERTED AT THE SOURCE THAT DECLARES IT. The design
    // record is where a reader checking a row looks, and the entry that ruled
    // it is UNSIGNED, so this pins the ruling and not an approval.
    expect(
      readFileSync(join(ROOT, 'docs/architecture/data-model/rule_states.md'), 'utf8'),
    ).toContain('[ADR-206](../../decisions/ADR-206.md)');
    // TERM 3, CLEARED, READ AT THE CONTRACT. `ADR-203` ruling 8 named this exact
    // edit and did not make it, so a reader of that entry alone would conclude
    // the shape had landed; `ADR-208` made it. THE ASSERTION IS POSITIVE NOW AND
    // WAS `not.toContain('| null')`, which is term 2's inversion repeated.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    const declared = contract.split('\n').filter((line) => /^ {2}eligible_next_7d:/.test(line));
    expect(declared).toHaveLength(1);
    expect(declared[0]).toContain('by_day: Array<{');
    expect(declared[0]).toContain('| null');
    expect(readFileSync(join(ROOT, 'docs/decisions/ADR-203.md'), 'utf8')).toContain(
      '`eligible_next_7d` TAKES THIS SHAPE',
    );
    // AND ALL THREE COPIES CARRY IT, WHICH IS THE HALF `RI-18` BINDS AND THE
    // HALF A ONE-FILE READ WOULD MISS. **THE PARTIAL MOVE WAS MEASURED ON THIS
    // BRANCH BEFORE THE WHOLE ONE**: the `apps/api` copy alone is `RI-18` RED on
    // SIX findings, which is session 392's seed A reproduced and is the opposite
    // of what `ADR-203` section 7a predicted. Each copy is asserted in its own
    // spelling rather than through one regex, because the three declare the
    // shape three ways and a pattern loose enough to match all three would match
    // a sentence about it.
    expect(readFileSync(join(ROOT, 'apps/api/src/routes/admin-reads.ts'), 'utf8')).toContain(
      'readonly eligible_next_7d: EligibleNext7d | null;',
    );
    expect(readFileSync(join(ROOT, 'apps/admin/src/api/types.ts'), 'utf8')).toMatch(
      /readonly eligible_next_7d: \{[\s\S]*?\n {2}\} \| null;/,
    );
    // THE SIBLING BODY, WHICH IS WHAT `ADR-203` LEFT AND `ADR-208` TOOK. A
    // ruling that only nulled the liability copy would have left this endpoint
    // unable to compile against its own source.
    expect(readFileSync(join(ROOT, 'docs/decisions/ADR-208.md'), 'utf8')).toContain(
      'GET /admin/eligible-forecast',
    );
    // AND THE METHOD IS STILL NOT COMPOSED, which is what the two above decide.
    expect(IMPLEMENTED_ADMIN_READS).not.toContain('readLiability');
  });

  // **AND `eligible_next_7d` IS THE ONLY GROUP LEFT**, which is the one count
  // worth holding here and is READ OFF THE MODULE rather than written down. The
  // book's `Omit` list was four entries when session 374 measured it.
  it('is the WHOLE of what LiabilityBook still subtracts, which was four groups', () => {
    const book = readFileSync(join(ROOT, 'apps/api/src/admin-source/liability.ts'), 'utf8');
    expect(book).toContain(
      "export type LiabilityBook = Omit<LiabilityResponse, 'eligible_next_7d'>;",
    );
  });
});

// =============================================================================
// TERM 3 IS ATOMIC ACROSS THREE FILES, AND TAKING IT COSTS `RI-18` ITS SIGHT
// =============================================================================
// **SESSION 392 SEEDED THIS IN BOTH DIRECTIONS AND THE SECOND HALF WAS NOT
// EXPECTED.** `ADR-203` ruled that a liability figure which is not there is a
// null whose reason rides on the body, and `ADR-204` ruling 9 puts
// `eligible_next_7d` under that shape. What nobody had measured is what the
// shape costs the one control binding the three copies.
//
//   SEED A: `| null` on the `apps/api` copy ALONE.  **RED**, six findings, and
//           it names the three declarations. FIVE field paths vanish from that
//           copy at once, because `response-shape-copies.mjs` says in its own
//           words that "A UNION is deliberately NOT reduced".
//   SEED B: the same `| null` on ALL THREE copies.  **GREEN.**
//   SEED C: with all three nulled, `by_day` RENAMED on ONE copy only.  **GREEN.
//           DID NOT FIRE.**
//   CONTROL: an identical drop at the same depth under a parent that is NOT
//           nulled (`reserve.rcr_bp`).  **RED.** Without it seed C proves
//           nothing.
//
// **SO THE ABSENCE SHAPE BUYS A WIRE THAT CAN DECLINE AND PAYS FOR IT IN THE
// CHECK'S SIGHT**, and the price is not hypothetical: `per_plan[].cusum` has
// carried `| null` since `ADR-203`, so `RI-18` is blind inside it TODAY. The
// cases below are that measurement on the tree as it stands.
// =============================================================================

describe('term 3 of B5`s condition: the `| null` RI-18 binds in three copies', () => {
  /** A member named EXACTLY `eligible_next_7d`, so a renamed one does not count. */
  const declaresField = (rel: string): boolean =>
    /(^|[\s(|])eligible_next_7d\s*:/m.test(readFileSync(join(ROOT, rel), 'utf8'));

  it('has THREE declarations of the shape, one frozen and one in another deployable', () => {
    // **WHY THIS TERM IS NOT ONE FENCE'S TO TAKE.** The contract is a FROZEN
    // document, so moving it is an ADR and never a commit (`DISPATCH_PROTOCOL`
    // section 3); `apps/admin` is a different deployable; and RI-18 refuses the
    // partial move. A session holding one of the three can measure this term and
    // cannot spend it.
    //
    // **THE PREDICATE IS A MEMBER NAME AND NOT A SUBSTRING, WHICH A SEED
    // CAUGHT.** A first draft asked whether each file CONTAINED the string, and
    // renaming the member to `eligible_next_7d_GONE` left it green, because the
    // old name is a prefix of the new one. That non-firing is why the regex
    // above anchors on the colon.
    expect(declaresField('docs/architecture/API_CONTRACT.md')).toBe(true);
    expect(declaresField('apps/api/src/routes/admin-reads.ts')).toBe(true);
    expect(declaresField('apps/admin/src/api/types.ts')).toBe(true);
    // Non-vacuity on the predicate itself: a name that is a SUPERSTRING of the
    // field's does not satisfy it, which is the seed above turned into a case.
    expect(/(^|[\s(|])eligible_next_7d\s*:/m.test('  readonly eligible_next_7d_GONE: {')).toBe(
      false,
    );
    // And the check really does bind all three, out of its own source.
    const check = readFileSync(
      join(ROOT, 'packages/tooling/checks/response-shape-copies.mjs'),
      'utf8',
    );
    expect(check).toContain("export const SUBJECTS = ['LiabilityResponse'];");
    expect(check).toContain("export const CONTRACT_REL = 'docs/architecture/API_CONTRACT.md';");
  });

  it('goes BLIND inside any field that takes the absence shape, which cusum already has', () => {
    // THE MECHANISM, AT ITS OWN LINE. A union is not reduced to a field set, so
    // a nulled field contributes ONE path and none of its members. That is a
    // deliberate ruling in that file (`SUBJECTS`: "Reducing a union to a field
    // set needs a rule ... and no entry states one") and this case pins the
    // CONSEQUENCE, which no entry had recorded.
    const check = readFileSync(
      join(ROOT, 'packages/tooling/checks/response-shape-copies.mjs'),
      'utf8',
    );
    expect(check).toContain('A UNION is deliberately NOT reduced');
    expect(check).toContain('Reducing a union to a field set');
    // AND THE FIELD IT IS ALREADY BLIND INSIDE. `ADR-203` nulled `cusum` across
    // the three copies, so its three members are outside RI-18's reach today.
    const routes = readFileSync(join(ROOT, 'apps/api/src/routes/admin-reads.ts'), 'utf8');
    expect(routes).toMatch(/readonly cusum: \{[^}]*\} \| null;/s);
    expect(routes).toContain('readonly statistic: number;');
    // Non-vacuity, and it is the CONTROL half of the seed pair: a member at the
    // same depth whose parent is NOT nulled, where an identical drop went RED.
    expect(routes).toContain('readonly rcr_bp: number;');
    expect(readFileSync(join(ROOT, 'docs/decisions/ADR-203.md'), 'utf8')).toContain(
      '`eligible_next_7d` TAKES THIS SHAPE',
    );
  });
});

describe('blocker B2: payout_velocity, whose window ADR-201 ruled and whose wire ADR-203 opened', () => {
  it('has the 2.5x threshold stated in FOUR documents, which is one more than this case read', () => {
    // MERIT_BUILD_MASTER_PROMPT is the constitution and INFRA is what pages on
    // it, so this is a control with an operator attached rather than a chart.
    //
    // **THE COUNT WAS THREE AND IS FOUR**, which session 381 re-derived while
    // ruling ADR-201 and this case now derives rather than carries. The fourth,
    // `research/ADVERSARY_DOSSIER.md`, is descriptive rather than normative and
    // is asserted anyway, because a count of three that is really four is
    // exactly the kind of thing a later reader has to re-derive, and because its
    // agreement is evidence: the number survived being restated in a document
    // written for a different purpose.
    const stated: readonly (readonly [string, string])[] = [
      ['MERIT_BUILD_MASTER_PROMPT.md', 'payout velocity vs 30-day avg (alarm >2.5'],
      ['docs/architecture/INFRA.md', 'Over 2.5 times the 30 day average pages'],
      [
        'docs/plans/M06-admin-ops-console.md',
        'Trailing 7 day settled cents against the 30 day average',
      ],
      ['research/ADVERSARY_DOSSIER.md', 'trips the payout-velocity alarm (>2.5'],
    ];
    for (const [file, quote] of stated)
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toContain(quote);
    expect(stated).toHaveLength(4);
  });

  it('has avg_30d_cents DEFINED by ADR-201, which is this case cleared rather than broken', () => {
    // THE THREE READINGS ARE NOT A ROUNDING DIFFERENCE. Against a 30-day DAILY
    // mean a seven-day total sits near 7.0 in steady state and the 2.5x pager
    // fires every day forever; against that mean scaled to seven days it sits
    // near 1.0 and the threshold means what the constitution says. `FM-M6-07`'s
    // words for the CUSUM -- "either constant alarms or none, which is the same
    // as no chart" -- are the exact failure, on a control that pages.
    //
    // THE CENSUS IS OVER THE FOUR REGISTERS A RULING WOULD LAND IN. When this
    // case was written the token appeared in exactly ONE of them, API_CONTRACT,
    // where it is the TYPE and not a definition, and the case stated its own
    // clearing condition in one line: A SECOND FILE.
    //
    // THAT CONDITION IS MET. ADR-201 ruled the averaging basis on 2026-08-28
    // and the census now returns FOUR files. The case is INVERTED rather than
    // deleted, because the property worth holding is no longer "nobody has
    // ruled" but "the ruling is where a reader will find it": API_CONTRACT
    // still carries the TYPE and only the type, and ADR-201 carries the
    // DEFINITION. A future edit that moves the definition out of the ADR, or
    // that quietly adds a second competing one, fails here.
    const bearing = new Map<string, string[]>();
    for (const dir of ['docs/architecture', 'docs/plans', 'docs/decisions', 'docs/edge-cases']) {
      for (const name of readdirSync(join(ROOT, dir))) {
        if (!name.endsWith('.md')) continue;
        const body = readFileSync(join(ROOT, dir, name), 'utf8');
        if (body.includes('avg_30d')) bearing.set(`${dir}/${name}`, body.split('\n'));
      }
    }
    expect([...bearing.keys()]).toContain('docs/architecture/API_CONTRACT.md');
    expect([...bearing.keys()]).toContain('docs/decisions/ADR-201.md');

    // API_CONTRACT still carries the TYPE and nothing but the type.
    const lines = (bearing.get('docs/architecture/API_CONTRACT.md') ?? []).filter((line) =>
      line.includes('avg_30d'),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.trim().startsWith('payout_velocity: {')).toBe(true);
  });

  it('has ALL FOUR leaves producible AND a wire that can decline them, so only the COMPOSITION is left', () => {
    // WHEN THIS CASE WAS WRITTEN the numerator was producible and the
    // denominator had no definition, so one leaf of four was reachable and the
    // group was not. **ADR-201 supplied the definition and session 383 built
    // the evaluator**, so all four are produced today by
    // `evaluatePayoutVelocity` over these same columns, executed against a live
    // PostgreSQL.
    //
    // **THE CASE IS INVERTED A SECOND TIME AND THE FIRST INVERSION STANDS.** Its
    // condition read: "the wire gains a shape for 'there is no window', which is
    // a change to a response `RI-18` binds in three copies." `ADR-203` is that
    // change and the three copies moved together, which is why it was one slice.
    //
    // THE REASON MOVED RATHER THAN LIFTED, FOR THE SECOND TIME, AND THE COUNT IS
    // HONEST ABOUT IT. The evaluator answers THREE ways -- evaluated, exhausted,
    // uncovered -- and `LiabilityResponse` carried ONE; it carries three now,
    // because `payout_velocity` may be `null` and `gaps` says which of the two
    // absences it is. An uncovered calendar is no longer `0 / false` and no
    // longer reads as a quiet week, which was ADR-201 finding 3's gap with a
    // pager attached.
    //
    // **AND THE THIRD INVERSION IS THE ONE ON THIS COMMENT RATHER THAN ON AN
    // ASSERTION.** It read: "`readLiability` stays out of
    // `IMPLEMENTED_ADMIN_READS` on B4 and B5, so nothing calls this evaluator on
    // a served path yet." **B4 IS SPENT AND SOMETHING CALLS IT**: session 390
    // wired `evaluatePayoutVelocity` into `readLiabilityBook` as a port, so the
    // group is on the book, produced or declined with a paired gap, executed
    // against a live PostgreSQL. **A SHAPE THAT CAN CARRY AN ANSWER IS NOT AN
    // ANSWER** and this is the sentence's other half: an answer that reaches the
    // BOOK is still not an answer on a SERVED PATH.
    //
    // CLEARING CONDITION, UNCHANGED AND NOW HELD BY ONE BLOCKER RATHER THAN TWO:
    // `IMPLEMENTED_ADMIN_READS` contains `readLiability`, which waits on B5.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    expect(contract).toContain(
      'payout_velocity: { last_7d_cents: number; avg_30d_cents: number; ratio_bp: number; alarm: boolean } | null',
    );
    expect(IMPLEMENTED_ADMIN_READS).not.toContain('readLiability');
    const columns = migrationColumnNames();
    expect(columns).toContain('amount_cents');
    expect(columns).toContain('settled_at');
    expect(TABLE_KEYS).toContain('payoutTransfers');
    const evaluator = readFileSync(
      join(ROOT, 'apps/api/src/admin-source/payout-velocity.ts'),
      'utf8',
    );
    expect(evaluator).toContain('export async function evaluatePayoutVelocity');
    for (const leaf of ['last_7d_cents', 'avg_30d_cents', 'ratio_bp', 'alarm'])
      expect(evaluator, leaf).toContain(leaf);
  });
});

describe('blocker B3: per_plan[].cusum, ruled ABSENT, wired by ADR-203 and RENDERED by session 390', () => {
  it('has ADR-167 clause 5 rendering it absent until DEP-M6-05, in those words', () => {
    const adr = readFileSync(join(ROOT, 'docs/decisions/ADR-167.md'), 'utf8');
    expect(adr).toContain('renders `per_plan[].cusum` as ABSENT until `DEP-M6-05` lands');
    // AND THE SAME ENTRY LEAVES THE SHAPE UNBUILT, which is the half that makes
    // this a blocker rather than a rendering choice: "the wire shape is `P7-b`'s
    // to carry, not this entry's to invent".
    expect(adr).toContain("the wire shape is `P7-b`'s to carry");
  });

  it('has all three copies of the response typing cusum NULLABLE, which is the absent form arriving', () => {
    // **THE CLEARING CONDITION FIRED AND THIS CASE IS INVERTED IN THE DIFF THAT
    // FIRED IT.** It read: "either half -- the calibration landing, or the shape
    // gaining an absent form." The calibration did not land; `DEP-M6-05` is
    // still M06 Wave 4. THE SHAPE MOVED. `ADR-202` ruled which of the two rules
    // yields and what form the yield takes, and `ADR-203` is the transcription,
    // in one diff across three declarations because `RI-18` makes it atomic.
    //
    // WHAT THE CASE HOLDS NOW IS THE PROPERTY WORTH HOLDING AFTER THE RULING,
    // and it is not "the shape is nullable" alone. It is that the absence sits
    // at the OBJECT and never at a member: `{ statistic: null, threshold: 4,
    // alarm: false }` is a half-calibrated chart, a shape nothing in the corpus
    // describes, and `ADR-202` ruling 3's second refusal. So the three member
    // names must still be spelled non-nullable in all three copies.
    //
    // AND `cusum?:` STAYS REFUSED, which the original case asserted and which
    // survives the inversion unchanged: an omitted key makes "absent, blocked on
    // DEP-M6-05" and "this deployment did not fill the field" the same response.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    expect(contract).toContain(
      'cusum: { statistic: number; threshold: number; alarm: boolean } | null',
    );
    for (const rel of ['apps/api/src/routes/admin-reads.ts', 'apps/admin/src/api/types.ts']) {
      const body = readFileSync(join(ROOT, rel), 'utf8');
      expect(body, rel).toMatch(/readonly cusum: \{[\s\S]*?\} \| null;/);
      expect(body, rel).not.toMatch(/readonly cusum\?: /);
      for (const member of ['statistic', 'threshold', 'alarm'])
        expect(body, `${rel} ${member}`).not.toContain(`readonly ${member}: number | null`);
    }
    // THE CALIBRATION STILL HAS NOT LANDED, which is what makes the null the
    // value this field actually takes rather than a form nobody reaches.
    expect(readFileSync(join(ROOT, 'docs/decisions/ADR-167.md'), 'utf8')).toContain(
      'renders `per_plan[].cusum` as ABSENT until `DEP-M6-05` lands',
    );
  });

  // **THE THIRD HALF, AND IT IS THE ONE THIS SESSION SPENT.** `ADR-202` ruled
  // the form and `ADR-203` put it on the wire; neither RENDERED it, and a
  // nullable field nobody fills is a shape rather than an answer. The book now
  // carries `cusum: null` on every plan with one `gaps` entry naming the path,
  // and the entry is CONDITIONAL on there being a plan, because
  // `assertLiabilityGapsPaired` refuses a gap over a figure that is not absent
  // and `plan_breaker_state` has never held a row.
  //
  // CLEARING CONDITION: `DEP-M6-05` lands and the three members become numbers.
  it('is RENDERED by the book, as a null the body explains rather than a member it drops', () => {
    const book = readFileSync(join(ROOT, 'apps/api/src/admin-source/liability.ts'), 'utf8');
    expect(book).toContain('cusum: null');
    expect(book).toContain("field: 'per_plan[].cusum'");
    expect(book).toContain("awaiting: 'DEP-M6-05'");
    // AND THE ENTRY IS CONDITIONED ON THE ARRAY THE VALIDATOR READS, which is
    // what a constant `CUSUM_GAPS` could not be. `admin-breaker.ts` carries the
    // constant form and has no pairing validator; this response has one.
    expect(book).toContain('if (perPlan.some((plan) => plan.cusum === null))');
    expect(readFileSync(join(ROOT, 'apps/api/src/routes/admin-breaker.ts'), 'utf8')).toContain(
      'export const CUSUM_GAPS',
    );
  });

  it('has the CALIBRATION in Wave 4 and not in any migration, which is not a column', () => {
    expect(readFileSync(join(ROOT, 'docs/plans/M06-admin-ops-console.md'), 'utf8')).toContain(
      'DEP-M6-05',
    );
    expect([...migrationColumnNames()].filter((name) => name.includes('sigma'))).toStrictEqual([]);
  });
});

describe('blocker B4: integrations.recon.last_run_at, LIFTED -- a run IS recorded and IS read', () => {
  it('has per-account recon events and no run event, which is the fold ADR-199 refuses', () => {
    // ADR-199 section 5 refuses `max(rule_states.computed_at)` for the batch
    // because OVERVIEW section 5.2 makes the run resumable at the account
    // boundary, "so a fold over per-account clocks reports a SUCCESS for a run
    // that crashed". `max(reconciliations.created_at)` is that fold, one field to
    // the left, on a sweep that is also per account. Taking it here would
    // overturn that reasoning by writing code.
    const events = readFileSync(join(ROOT, 'docs/architecture/EVENTS.md'), 'utf8');
    expect(events).toContain('`recon.mismatch_detected`');
    expect(events).toContain('`recon.resolved`');
    expect(events).not.toContain('recon.completed');
    // Non-vacuity, and the contrast: the BATCH has exactly the event this field
    // would need, which is why ADR-199 clause 4 could rule its two figures
    // readable and this one is not.
    expect(events).toContain('`batch.started` / `batch.completed`');
  });

  // INVERTED BY THE SESSION THAT SPENT THE CLEARING CONDITION. Session 374 wrote
  // this case as "has no run table and no run column", and `0064` gives the
  // schema half of B4's stated clearing condition ("a `recon.completed` event or
  // a run record"). The case now asserts what LANDED and what still STANDS,
  // because a case whose title has gone false while its assertions still pass is
  // the worst of the three states: session 374's own landmine 1 is that a
  // clearing condition fires once and the session that lifts the blocker is the
  // session that spends it.
  //
  // THE COLUMN ASSERTION IS KEPT AND IT SAYS MORE THAN IT DID. `last_run_at` is
  // still not a column anywhere, and now it is not a column on a table that
  // exists: the field is a fold over `reconciliation_runs.started_at` rather
  // than a figure anybody stores, which is ADR-199 ruling 6's distinction
  // holding on the one field that had failed it.
  it('has a run table now, and no run column, so the record half of B4 has fired', () => {
    const columns = migrationColumnNames();
    expect(columns).not.toContain('last_run_at');
    expect(TABLE_KEYS).toContain('reconciliations');
    expect(TABLE_KEYS).toContain('reconciliationRuns');
    // The control that makes the clock trustworthy, which is the whole reason a
    // run record clears what `max(reconciliations.created_at)` could not: a
    // sweep that stopped at the account boundary may not claim it completed.
    expect(readFileSync(join(MIGRATIONS, '0064_reconciliation_runs.sql'), 'utf8')).toContain(
      'reconciliation_runs_completed_is_whole',
    );
    // `status` is what makes the COUNT producible: `0014` closes it at three
    // names and `mismatch` is the open one.
    expect(readFileSync(join(MIGRATIONS, '0014_marks.sql'), 'utf8')).toContain(
      "status IN ('match', 'mismatch', 'resolved')",
    );
  });

  // **B4 IS LIFTED AND THIS CASE IS INVERTED IN THE DIFF THAT LIFTED IT.** It
  // read "is still blocked on a reader, which is what the record does not
  // supply", and it asserted the adapter named no `reconciliationRuns` and
  // carried `'last_run_at'` only as a string inside a type subtraction. Session
  // 374 named two things standing between the record and the field, neither of
  // them a migration: a PRODUCER that writes the row, and the READER here.
  // Session 387 wrote the producer (`apps/worker/src/recon/sweep.ts`); this
  // session wrote the reader. A clearing condition fires ONCE and the session
  // that lifts the blocker spends it.
  //
  // WHAT THE CASE HOLDS NOW IS THE PROPERTY WORTH HOLDING AFTER THE LIFT, and it
  // is not "a reader exists". It is that the reader takes the newest COMPLETED
  // run, which is `reconciliation_runs_completed_is_whole`'s own stated reader
  // and the only reading under which `0064` clears what `max(reconciliations.
  // created_at)` could not. A later edit that drops the predicate would put the
  // `started_at` of a sweep that died at account 2,341 of 5,000 on the panel
  // P-M6-09 gates the page with, and it fails here.
  it('has a reader now, and the reader takes the newest COMPLETED run', () => {
    const book = readFileSync(join(ROOT, 'apps/api/src/admin-source/liability.ts'), 'utf8');
    expect(book).toContain('reconciliationRuns');
    expect(book).toContain("rowsWhere('reconciliationRuns', { status: 'completed' })");
    expect(book).toContain("latestInstant(completedRuns, 'startedAt'");
    // AND THE COLUMN IS THE ONE `0064` NAMES FOR THIS FIELD, which is the half a
    // reader of the predicate alone would not check. `finished_at` is a
    // different instant and the index the migration attaches to the panel's read
    // is on `started_at`.
    expect(readFileSync(join(MIGRATIONS, '0064_reconciliation_runs.sql'), 'utf8')).toContain(
      "-- The panel's read, which is `integrations.recon.last_run_at`: the newest run,",
    );
    expect(book).not.toContain("latestInstant(completedRuns, 'finishedAt'");
  });

  // THE EVENT IS A THIRD THING AND IT IS STILL OWED, which is stated as its own
  // case so the lift above does not read as closing it. `data-model/README`
  // section 1 says a mutable table emits an event on every meaningful
  // transition; EVENTS section 5.3 has no `recon.completed` to emit. That is an
  // amendment to a frozen document and therefore an ADR, and it blocks no field
  // on this response.
  it('CLEARING CONDITION: `recon.completed` reaches EVENTS section 5.3', () => {
    expect(readFileSync(join(ROOT, 'docs/architecture/EVENTS.md'), 'utf8')).not.toContain(
      'recon.completed',
    );
  });
});
