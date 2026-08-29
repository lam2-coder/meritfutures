// =============================================================================
// apps/worker/test/rule-state-writer.test.ts
// =============================================================================
// `B5` TERM 1, WATCHED. `src/batch/state-writer.ts` implements one method of
// `BatchWritePort` over a real transaction, and this file asserts the three
// things a writer can be wrong about without any of them being visible:
//
//   1. THE COLUMN SET, against `packages/db/src/schema.ts` rather than against
//      the writer's own list. A misspelt Drizzle property maps to no column and
//      Postgres then applies a default or a `NOT NULL`, so `floor_cent` is
//      either a silent zero or an error naming a column the writer never wrote.
//   2. THE GUARD, by seeding each shape it refuses AND each shape it must
//      admit. A guard nobody watched fire is a guard nobody has, and one seed
//      here found a real defect: see section 3.
//   3. THE REFUSALS, each typed, because a `23505` reaching a caller as a
//      700-character `Failed query:` dump names neither the account nor the day.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// `apps/worker/src/db.ts`'s own header draws the line and it is drawn here too:
// a recorder "proves which key was named, which address was written, which
// values were set and which reason the handle carried. It proves NOTHING about
// whether the composed predicate reaches one row or many." So the round trip is
// NOT asserted here. It was EXECUTED, against a live PostgreSQL over all 60
// migrations, and `docs/sessions/2026-08-29-session-395.md` carries the
// transcript: three rows written into a table that held zero, twenty-three
// columns read back with no mismatch, and `id`, `computed_at` and `created_at`
// supplied by the database.
//
// -----------------------------------------------------------------------------
// THE ONE IMPORT THAT NEEDS AN ARGUMENT
// -----------------------------------------------------------------------------
// This file takes a TYPE-ONLY import of `SystemTx` from `@merit/db`, which is a
// first for this deployable's suite. It adds no capability: `import type` erases
// entirely, `test/db.test.ts` scans `src/` and not `test/`, and
// `apps/worker/package.json` has declared `@merit/db` since `ADR-165`. What it
// buys is that "a wider handle is assignable to a narrower shape" -- which
// `recon/ports.ts`, `detectors/ports.ts`, `digests/ports.ts` and
// `sweeps/ports.ts` each state IN PROSE and none of them checks -- becomes a
// compile error the day `SystemTx.insert` changes shape. Case 6.1 is that
// check and it is the only reason the import is here.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import type { SystemTx } from '@merit/db';
import type { EngineGateResults } from '@merit/rules-engine';

import { foldAccountDay } from '../src/batch/nightly.ts';
import type { RuleStateRow } from '../src/batch/ports.ts';
import {
  RULE_STATE_WRITE_COLUMNS,
  RULE_STATE_WRITE_TABLES,
  RuleStateAlreadyWritten,
  RuleStateEncodingRefusal,
  RuleStateWriterUnwired,
  UNWIRED_RULE_STATE_WRITER_IO,
  refuseUnstorableJson,
  ruleStateValues,
  writeRuleStateVia,
} from '../src/batch/state-writer.ts';
import type { RuleStateTx, RuleStateValues, RuleStateWriterIo } from '../src/batch/state-writer.ts';
import { WORKER_BARREL_LEGS } from '../src/index.ts';
import { ACCOUNT_A, CALENDAR, DAY_ONE, ENGINE_VERSION, accountDay } from './fixtures.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const WRITER = join(ROOT, 'apps/worker/src/batch/state-writer.ts');

/** Every `.ts` module under this deployable's `src/`, in `db.test.ts`'s idiom. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.ts')) out.push(next);
    }
  };
  walk(join(ROOT, 'apps/worker/src'));
  return out;
}

// -----------------------------------------------------------------------------
// The subject: a row the ENGINE produced, never one this file typed out
// -----------------------------------------------------------------------------
// `scripts/demo/world.ts` states the reason and it applies here: the stored side
// is "`foldAccountDay`'s own `RuleStateRow` ... the row the nightly batch would
// have written". A hand-built row would let a field drift out of the fold and
// into this file, and the writer would then be asserted against a shape nothing
// produces.

function foldedRow(): RuleStateRow {
  const fold = foldAccountDay(accountDay(ACCOUNT_A), CALENDAR, ENGINE_VERSION, 1);
  if (fold.kind !== 'row') throw new Error(`the fixture day was refused: ${fold.kind}`);
  return fold.row;
}

/**
 * The same fold on a day that BREACHED, so `0065`'s breach pair is exercised on
 * the branch that sets it rather than only on the opening state.
 *
 * `PLAN.eval.drawdown` is `trailing_eod` at `250_000n` off a `5_000_000n`
 * opening, so the day-one floor is `4_750_000n` and R-21 is strict: a low BELOW
 * it breaches. The mark is otherwise `DAY_ONE`, so nothing but the low and the
 * close moves, and the fold picks the kind itself.
 */
function breachedRow(): RuleStateRow {
  const fold = foldAccountDay(
    accountDay(ACCOUNT_A, {
      mark: {
        ...DAY_ONE,
        closingBalanceCents: 4_700_000n,
        highBalanceCents: 5_000_000n,
        lowBalanceCents: 4_690_000n,
        realizedPnlCents: -300_000n,
      },
    }),
    CALENDAR,
    ENGINE_VERSION,
    1,
  );
  if (fold.kind !== 'row') throw new Error(`the breaching day was refused: ${fold.kind}`);
  return fold.row;
}

/** A stand-in encoding. NOT A RULING and deliberately not the only one used. */
const ENCODE_FLAT = (gates: EngineGateResults): unknown => ({
  'tradedDays.pass': gates.tradedDays.pass,
  'buffer.needCents': gates.buffer.needCents.toString(10),
  'cadenceGap.nextEligibleTradingDay': gates.cadenceGap.nextEligibleTradingDay,
});

interface Recorded {
  readonly key: string;
  readonly values: RuleStateValues;
}

/** A recorder, in `apps/worker/src/db.ts`'s seam idiom. */
function recorder(options: {
  readonly encode?: (gates: EngineGateResults) => unknown;
  readonly onInsert?: () => never;
  readonly returns?: unknown[];
}): {
  readonly io: RuleStateWriterIo;
  readonly inserts: Recorded[];
  readonly transactions: number;
} {
  const inserts: Recorded[] = [];
  const state = { transactions: 0 };
  const tx: RuleStateTx = {
    insert: (key, values) => {
      inserts.push({ key, values });
      if (options.onInsert !== undefined) options.onInsert();
      return Promise.resolve(options.returns ?? [{ id: 1n }]);
    },
  };
  return {
    io: {
      transact: async (fn) => {
        state.transactions += 1;
        return fn(tx);
      },
      encodeEngineGates: options.encode ?? ENCODE_FLAT,
    },
    inserts,
    get transactions() {
      return state.transactions;
    },
  };
}

// =============================================================================
// 1. THE COLUMN SET, AGAINST THE SCHEMA
// =============================================================================

/**
 * Every Drizzle property name of the `ruleStates` table, read out of the
 * accessor's own file as TEXT.
 *
 * TEXT RATHER THAN AN IMPORT, so this deployable's suite reads the schema
 * without holding the table object, and so the assertion names a FILE a reviewer
 * can open at a line. The block is bounded by its own `pgTable(` opener and the
 * first `\n});` after it, and case 1.0 refuses a parse that found nothing --
 * which is what turns this from a check into a check that can fail.
 */
function schemaProperties(): string[] {
  const source = readFileSync(join(ROOT, 'packages/db/src/schema.ts'), 'utf8');
  const start = source.indexOf("export const ruleStates = pgTable('rule_states', {");
  expect(start, 'the ruleStates table is no longer declared under that name').toBeGreaterThan(-1);
  const end = source.indexOf('\n});', start);
  expect(end, 'the ruleStates block is unterminated').toBeGreaterThan(start);
  const block = source.slice(start, end);
  return [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1] ?? '');
}

describe('1. the column set is the schema’s and not this writer’s', () => {
  test('1.0 the parse is not vacuous: it finds the columns nobody disputes', () => {
    const properties = schemaProperties();
    // NON-VACUITY FIRST. A regex that matched nothing would make every
    // assertion below trivially true, which is the failure that makes a
    // text-reading check worse than none.
    expect(properties.length).toBeGreaterThan(20);
    for (const known of ['id', 'accountId', 'stateHash', 'engineGates', 'calendarRevisionId'])
      expect(properties).toContain(known);
  });

  test('1.1 every column this writer sets is a property of the table', () => {
    const properties = new Set(schemaProperties());
    for (const column of RULE_STATE_WRITE_COLUMNS)
      expect(properties, `${column} is written and is not a column of rule_states`).toContain(
        column,
      );
  });

  test('1.2 the properties it does NOT set are exactly the database’s three', () => {
    // `ports.ts`: "`id`, `computed_at` and `created_at` are absent because they
    // are the database's ... THE BATCH THEREFORE READS NO CLOCK." A column a
    // later migration adds appears here and in neither list, so this case is
    // what makes that column a red suite rather than a value nobody writes.
    //
    // **IT FIRED. `0065` ADDED THREE COLUMNS AND THIS CASE WENT RED ON THE
    // MERGE**, naming `lifetimeSettledCents`, `breached` and `breachKind`, while
    // each branch was green alone. **THE ASSERTION BELOW IS UNCHANGED FROM THE
    // LINE THAT CAUGHT THEM.** Widening it to six names was the available fix
    // and is the exact failure the case exists to prevent: the writer would then
    // set none of the three, every row would carry the columns' DEFAULTS, and
    // `readEligibility` -- wired in production at `apps/api/src/start.ts` --
    // would report `0 / false / null` for every account regardless of truth.
    // What cleared it is the WRITER carrying the three, which is why this case
    // reads the same words it did before `0065` and passes for a different
    // reason.
    const written = new Set<string>(RULE_STATE_WRITE_COLUMNS);
    const unwritten = schemaProperties().filter((p) => !written.has(p));
    expect(unwritten.sort()).toEqual(['computedAt', 'createdAt', 'id']);
  });

  test('1.3 the values object names those columns and no others', () => {
    const values = ruleStateValues(foldedRow(), ENCODE_FLAT);
    expect(Object.keys(values).sort()).toEqual([...RULE_STATE_WRITE_COLUMNS].sort());
    // TWENTY-THREE UNTIL `0065`. The literal is derived from the assertion
    // above rather than the other way round: the set equality is the check and
    // this length is the non-vacuity guard on it.
    expect(RULE_STATE_WRITE_COLUMNS).toHaveLength(26);
  });

  test('1.4 the write union is one table and it is the one 0015 declares', () => {
    expect(RULE_STATE_WRITE_TABLES).toEqual(['ruleStates']);
  });
});

// =============================================================================
// 2. THE MAPPING
// =============================================================================

describe('2. the mapping carries the fold’s values through unchanged', () => {
  test('2.1 the eighteen plain columns are the row’s own values, by identity', () => {
    const row = foldedRow();
    const values = ruleStateValues(row, ENCODE_FLAT);
    expect(values.accountId).toBe(row.accountId);
    expect(values.tradingDay).toBe(row.tradingDay);
    expect(values.phase).toBe(row.phase);
    expect(values.floorCents).toBe(row.floorCents);
    expect(values.floorLocked).toBe(row.floorLocked);
    expect(values.floorOpenCents).toBe(row.floorOpenCents);
    expect(values.highWaterBalanceCents).toBe(row.highWaterBalanceCents);
    expect(values.balanceCents).toBe(row.balanceCents);
    expect(values.withdrawableCents).toBe(row.withdrawableCents);
    expect(values.tradedDaysCount).toBe(row.tradedDaysCount);
    expect(values.winDaysCount).toBe(row.winDaysCount);
    expect(values.consistencyBestDayCents).toBe(row.consistencyBestDayCents);
    expect(values.consistencyPeriodProfitCents).toBe(row.consistencyPeriodProfitCents);
    expect(values.consistencyPeriodStartDay).toBe(row.consistencyPeriodStartDay);
    expect(values.payoutsSettledCount).toBe(row.payoutsSettledCount);
    expect(values.payoutAnchorDay).toBe(row.payoutAnchorDay);
    expect(values.cadenceAnchorDay).toBe(row.cadenceAnchorDay);
    expect(values.engineEligible).toBe(row.engineEligible);
    expect(values.engineVersion).toBe(row.engineVersion);
  });

  test('2.2 every cents column stays a bigint, so no money crosses through a float', () => {
    const values = ruleStateValues(foldedRow(), ENCODE_FLAT);
    for (const column of [
      'floorCents',
      'floorOpenCents',
      'highWaterBalanceCents',
      'balanceCents',
      'withdrawableCents',
      'consistencyBestDayCents',
      'consistencyPeriodProfitCents',
    ] as const)
      expect(typeof values[column], `${column} left the mapping as a non-bigint`).toBe('bigint');
  });

  test('2.3 state_hash is the bytes the fold produced, by REFERENCE and not by value', () => {
    // `ports.ts`: "THE ADAPTER MUST WRITE THIS VALUE, NOT A RE-DERIVATION OF
    // IT", because `jsonb` does not preserve key order and a hash recomputed
    // from a round trip is a different serializer. Identity is the strongest
    // form of that: a re-derivation would be equal and not the same object.
    const row = foldedRow();
    expect(ruleStateValues(row, ENCODE_FLAT).stateHash).toBe(row.stateHash);
    expect(row.stateHash).toHaveLength(32);
  });

  test('2.4 contextGates goes to the column as it stands, and it is the engine’s five', () => {
    const row = foldedRow();
    const values = ruleStateValues(row, ENCODE_FLAT);
    expect(values.contextGates).toBe(row.contextGates);
    // `0015`'s column comment names FOUR ("freeze, recon_blocked, KYC,
    // in-flight") and `ports.ts` rules the engine's five stored instead. The
    // count is derived rather than asserted in prose.
    expect(Object.keys(row.contextGates).sort()).toEqual([
      'accountActive',
      'kycVerified',
      'noPayoutInFlight',
      'notFrozen',
      'reconClear',
    ]);
  });

  test('2.5 calendarRevisionId becomes the column’s own type, and null stays null', () => {
    const row = foldedRow();
    expect(ruleStateValues(row, ENCODE_FLAT).calendarRevisionId).toBe(1n);
    expect(
      ruleStateValues({ ...row, calendarRevisionId: null }, ENCODE_FLAT).calendarRevisionId,
    ).toBeNull();
    // A fractional revision id is refused at the boundary rather than sent.
    // `0035` makes `null` mean "the calendar had never been corrected", which
    // is NOT "unknown", so a value that cannot be a revision must not become
    // one.
    expect(() => ruleStateValues({ ...row, calendarRevisionId: 1.5 }, ENCODE_FLAT)).toThrow(
      RangeError,
    );
  });

  test('2.6 the encoder is CALLED with the fold’s gates and its result is what lands', () => {
    const row = foldedRow();
    const seen: EngineGateResults[] = [];
    const values = ruleStateValues(row, (gates) => {
      seen.push(gates);
      return { marker: 'this encoding is a stand-in' };
    });
    expect(seen).toEqual([row.engineGates]);
    expect(seen[0]).toBe(row.engineGates);
    expect(values.engineGates).toEqual({ marker: 'this encoding is a stand-in' });
  });

  // ---------------------------------------------------------------------------
  // `0065`'s three
  // ---------------------------------------------------------------------------
  // The columns exist and this writer sets them, which is what case 1.2 went red
  // to demand. These cases are about the two ways the mapping could be wrong
  // WITHOUT case 1.2 noticing: it could send the wrong value, and it could send
  // a pair the database refuses.

  test('2.7 the three 0065 columns are the fold’s own values, by identity', () => {
    const row = foldedRow();
    const values = ruleStateValues(row, ENCODE_FLAT);
    expect(values.lifetimeSettledCents).toBe(row.lifetimeSettledCents);
    expect(values.breached).toBe(row.breached);
    expect(values.breachKind).toBe(row.breachKind);
    // `lifetime_settled_cents` is `bigint NOT NULL` and `Cents` is `bigint`, so
    // unlike `calendarRevisionId` there is no conversion at this boundary and a
    // `number` reaching the column would be money through a float.
    expect(typeof values.lifetimeSettledCents).toBe('bigint');
  });

  test('2.8 the breach pair is TRANSCRIBED and never derived, so the CHECK stays a detector', () => {
    // `0065`'s `rule_states_breach_flag_matches_kind` is
    // `breached = (breach_kind IS NOT NULL)`. A mapping that computed one side
    // from the other would satisfy that constraint BY CONSTRUCTION and the
    // constraint would then detect nothing. This case pins the opposite: an
    // inconsistent pair reaches the values object unrepaired, so the database is
    // comparing two independently carried facts. The row below is one the engine
    // cannot produce, which is exactly why the writer must not quietly fix it.
    const row = foldedRow();
    const impossible = ruleStateValues({ ...row, breached: true, breachKind: null }, ENCODE_FLAT);
    expect(impossible.breached).toBe(true);
    expect(impossible.breachKind).toBeNull();

    const alsoImpossible = ruleStateValues(
      { ...row, breached: false, breachKind: 'static_floor' },
      ENCODE_FLAT,
    );
    expect(alsoImpossible.breached).toBe(false);
    expect(alsoImpossible.breachKind).toBe('static_floor');
  });

  test('2.9 what the ENGINE produces satisfies 0065’s two breach CHECKs, on both branches', () => {
    // "Your mapping must satisfy that CHECK for every state the engine can
    // produce, INCLUDING THE NO-BREACH STATE." The vocabulary is read out of the
    // migration rather than typed here: a fourth `BreachKind` member with no
    // `CHECK` member is the failure this reads for, and it is `packages/db`'s
    // `rule-state-breach-vocabulary.test.ts` that owns the two-way comparison.
    const migration = readFileSync(
      join(ROOT, 'packages/db/migrations/0065_rule_state_lifetime_and_breach.sql'),
      'utf8',
    );
    const list = /breach_kind IN \(([^)]*)\)/.exec(migration)?.[1];
    expect(list, 'the vocabulary CHECK is no longer written that way').toBeDefined();
    const vocabulary = [...(list ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '');
    // NON-VACUITY. A regex that found nothing would make the membership
    // assertions below trivially true.
    expect(vocabulary.length).toBeGreaterThan(0);

    for (const [label, values] of [
      ['the clean fold', ruleStateValues(foldedRow(), ENCODE_FLAT)],
      ['the breached fold', ruleStateValues(breachedRow(), ENCODE_FLAT)],
    ] as const) {
      // rule_states_breach_flag_matches_kind
      expect(values.breached, `${label}: the pair disagrees`).toBe(values.breachKind !== null);
      // rule_states_breach_kind_is_a_breach_kind
      if (values.breachKind !== null)
        expect(vocabulary, `${label}: a kind the CHECK does not admit`).toContain(
          values.breachKind,
        );
      // rule_states_no_settlements_no_lifetime_total, and the >= 0 CHECK
      expect(typeof values.lifetimeSettledCents).toBe('bigint');
      const lifetime = values.lifetimeSettledCents as bigint;
      expect(lifetime >= 0n, `${label}: a negative lifetime total`).toBe(true);
      if (values.payoutsSettledCount === 0)
        expect(lifetime, `${label}: no settlements and a lifetime total`).toBe(0n);
    }

    // THE BREACHED BRANCH IS NOT VACUOUS EITHER: it must actually have breached,
    // or the loop above asserted the no-breach state twice.
    expect(breachedRow().breached).toBe(true);
    expect(breachedRow().breachKind).not.toBeNull();
  });
});

// =============================================================================
// 3. THE GUARD
// =============================================================================

describe('3. the guard refuses what JSON.stringify throws on, drops or changes', () => {
  test('3.1 a bigint is refused and the PATH is named', () => {
    // THE SHAPE THAT MADE THE SEAM NECESSARY. `EngineGateResults` types SEVEN
    // of its twenty-five leaves as `Cents`: `winDays.floorCents`,
    // `buffer.haveCents`, `buffer.needCents`,
    // `consistency.profitNeededToDiluteCents`, `minimumAmount.withdrawableCents`,
    // `minimumAmount.capCents` and `minimumAmount.minPayoutCents`. This comment
    // said FOUR, inherited from `hash.ts`, which said four until 2026-08-29;
    // both are repaired on this branch and `ADR-206` ruling 3 names the same
    // seven.
    let raised: unknown;
    try {
      refuseUnstorableJson('engine_gates', { buffer: { needCents: 100_000n } });
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RuleStateEncodingRefusal);
    expect((raised as RuleStateEncodingRefusal).path).toBe('$.buffer.needCents');
    expect((raised as RuleStateEncodingRefusal).column).toBe('engine_gates');
    expect((raised as Error).message).toContain('rule_states.engine_gates at $.buffer.needCents');
  });

  test('3.2 the three SILENT shapes are refused, and silent is why they are here', () => {
    // Each of these SERIALIZES. `JSON.stringify({a: undefined})` is `'{}'` and
    // `JSON.stringify(NaN)` is `'null'`, so the write would succeed and a gate
    // leaf would be absent or a money figure would be an absence. Nothing
    // downstream can tell either apart from an encoding that omitted the leaf.
    expect(JSON.stringify({ a: undefined })).toBe('{}');
    expect(JSON.stringify(Number.NaN)).toBe('null');
    for (const [value, path] of [
      [{ gate: { have: undefined } }, '$.gate.have'],
      [{ gate: { have: Number.NaN } }, '$.gate.have'],
      [{ gate: { have: Number.POSITIVE_INFINITY } }, '$.gate.have'],
    ] as const)
      expect(() => {
        refuseUnstorableJson('engine_gates', value);
      }, `${path} was accepted`).toThrow(RuleStateEncodingRefusal);
  });

  test('3.3 a fractional or unsafe number is refused, which is the constitution’s rule', () => {
    expect(() => {
      refuseUnstorableJson('engine_gates', { buffer: { haveCents: 30_000.5 } });
    }).toThrow(/not an integer/);
    expect(() => {
      refuseUnstorableJson('engine_gates', { buffer: { haveCents: 2 ** 53 } });
    }).toThrow(/safe-integer/);
    // 2^53 - 1 is the last integer a JSON number carries exactly, and it is
    // ADMITTED: the guard's edge is a boundary and not a margin.
    expect(() => {
      refuseUnstorableJson('engine_gates', { buffer: { haveCents: 2 ** 53 - 1 } });
    }).not.toThrow();
  });

  test('3.4 a function, a symbol and a cycle are refused', () => {
    expect(() => {
      refuseUnstorableJson('engine_gates', { gate: () => 1 });
    }).toThrow(RuleStateEncodingRefusal);
    expect(() => {
      refuseUnstorableJson('engine_gates', { gate: Symbol('x') });
    }).toThrow(RuleStateEncodingRefusal);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => {
      refuseUnstorableJson('engine_gates', cyclic);
    }).toThrow(/a cycle/);
  });

  test('3.5 THE ACCEPTANCES, because a guard that refuses everything proves nothing', () => {
    // `DISPATCH_PROTOCOL` section 6: "Watch the acceptance cases fire, not only
    // the refusals. A probe that only ever attempts forbidden things passes
    // against a guard that rejects everything." These are the four shapes a
    // ruling could reasonably choose and every one of them must survive.
    for (const admitted of [
      { 'buffer.needCents': '100000', 'tradedDays.pass': true },
      { buffer: { need_cents: 100_000, pass: false } },
      [{ path: 'buffer.needCents', value: '100000' }],
      { cadenceGap: { nextEligibleTradingDay: null } },
    ])
      expect(() => {
        refuseUnstorableJson('engine_gates', admitted);
      }).not.toThrow();
    // And the real thing: today's `StoredContextGates`, which is why the same
    // walk runs over the column this file does NOT gate behind a seam.
    expect(() => {
      refuseUnstorableJson('context_gates', foldedRow().contextGates);
    }).not.toThrow();
  });

  test('3.6 the guard runs over context_gates too, so a Cents added there is caught', () => {
    const row = foldedRow();
    const poisoned = {
      ...row,
      contextGates: { ...row.contextGates, lifetimeSettledCents: 1n },
    } as unknown as RuleStateRow;
    let raised: unknown;
    try {
      ruleStateValues(poisoned, ENCODE_FLAT);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RuleStateEncodingRefusal);
    expect((raised as RuleStateEncodingRefusal).column).toBe('context_gates');
  });
});

// =============================================================================
// 4. THE WRITE
// =============================================================================

describe('4. the write names one table, takes one transaction, and checks it happened', () => {
  test('4.1 one call is one transaction and one insert into ruleStates', async () => {
    const rec = recorder({});
    await writeRuleStateVia(rec.io)(foldedRow());
    expect(rec.transactions).toBe(1);
    expect(rec.inserts).toHaveLength(1);
    expect(rec.inserts[0]?.key).toBe('ruleStates');
  });

  test('4.2 the values the transaction saw are the mapping’s, column for column', async () => {
    const row = foldedRow();
    const rec = recorder({});
    await writeRuleStateVia(rec.io)(row);
    expect(rec.inserts[0]?.values).toEqual(ruleStateValues(row, ENCODE_FLAT));
  });

  test('4.3 TWO callers with TWO encodings both write, and the writer chooses NEITHER', async () => {
    // **THE CASE THAT SAYS WHAT THIS SLICE DID NOT DO.** `B5` term 2 is a
    // primary source declaring the stored `engine_gates` encoding and this
    // session held no number for it. A writer that had quietly picked one would
    // pass every other case in this file.
    const row = foldedRow();
    const flat = recorder({ encode: ENCODE_FLAT });
    const nested = recorder({
      encode: (g) => ({ buffer: { need_cents: Number(g.buffer.needCents) } }),
    });
    await writeRuleStateVia(flat.io)(row);
    await writeRuleStateVia(nested.io)(row);
    expect(flat.inserts[0]?.values.engineGates).not.toEqual(nested.inserts[0]?.values.engineGates);
    // And every OTHER column is identical across the two, which is what makes
    // the difference the encoding rather than the row.
    for (const column of RULE_STATE_WRITE_COLUMNS)
      if (column !== 'engineGates')
        expect(flat.inserts[0]?.values[column]).toEqual(nested.inserts[0]?.values[column]);
  });

  test('4.4 an insert that wrote no row is a refusal, not a success', async () => {
    const rec = recorder({ returns: [] });
    await expect(writeRuleStateVia(rec.io)(foldedRow())).rejects.toThrow(/returned 0 rows/);
  });

  test('4.5 a bad encoding stops BEFORE the transaction opens', async () => {
    // The guard runs in the mapping and the mapping runs before `transact`, so
    // a deployment with a broken encoder never reaches the database at all.
    // Measured live as well: rows before 3, rows after 3.
    const rec = recorder({ encode: (g) => ({ leak: g.buffer.needCents }) });
    await expect(writeRuleStateVia(rec.io)(foldedRow())).rejects.toBeInstanceOf(
      RuleStateEncodingRefusal,
    );
    expect(rec.transactions).toBe(0);
    expect(rec.inserts).toHaveLength(0);
  });
});

// =============================================================================
// 5. THE REFUSALS
// =============================================================================

describe('5. every refusal is typed and names what a reader needs', () => {
  test('5.1 THE SEED THAT FOUND A REAL DEFECT: 23505 arrives WRAPPED', async () => {
    // **THE FIRST DRAFT OF `isUniqueViolation` READ ONLY THE TOP-LEVEL `code`
    // AND DID NOT FIRE.** Executed against a live database, a second insert for
    // one account-day arrives as a `DrizzleQueryError` whose own `code` is
    // `undefined` and whose `cause` carries `23505`, so the caller got the raw
    // `Failed query:` dump with neither the account nor the day in it. This case
    // is the shape that found it, and it is the wrapped one deliberately.
    const wrapped = Object.assign(new Error('Failed query: insert into "rule_states" ...'), {
      cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    });
    const row = foldedRow();
    const rec = recorder({
      onInsert: () => {
        throw wrapped;
      },
    });
    let raised: unknown;
    await writeRuleStateVia(rec.io)(row).catch((error: unknown) => {
      raised = error;
    });
    expect(raised).toBeInstanceOf(RuleStateAlreadyWritten);
    expect((raised as RuleStateAlreadyWritten).accountId).toBe(row.accountId);
    expect((raised as RuleStateAlreadyWritten).tradingDay).toBe(String(row.tradingDay));
    expect((raised as RuleStateAlreadyWritten).driverError).toBe(wrapped);
    expect((raised as Error).message).toContain('never superseded');
  });

  test('5.2 an unwrapped 23505 is the same answer, so the walk did not replace the check', async () => {
    const rec = recorder({
      onInsert: () => {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      },
    });
    await expect(writeRuleStateVia(rec.io)(foldedRow())).rejects.toBeInstanceOf(
      RuleStateAlreadyWritten,
    );
  });

  test('5.3 ANY OTHER error passes through UNCHANGED, so nothing is mislabelled', async () => {
    // A guard that answered `RuleStateAlreadyWritten` to every failure would
    // report a `NOT NULL` violation and a lost connection as a day already
    // closed, and a resumed run would then skip an account it never wrote.
    const other = Object.assign(new Error('null value in column "phase"'), { code: '23502' });
    const rec = recorder({
      onInsert: () => {
        throw other;
      },
    });
    await expect(writeRuleStateVia(rec.io)(foldedRow())).rejects.toBe(other);
  });

  test('5.4 a cyclic cause chain does not hang the walk', async () => {
    const a = new Error('a');
    const b = Object.assign(new Error('b'), { cause: a });
    Object.assign(a, { cause: b });
    const rec = recorder({
      onInsert: () => {
        throw b;
      },
    });
    await expect(writeRuleStateVia(rec.io)(foldedRow())).rejects.toBe(b);
  });

  test('5.5 the unwired default serves neither member, and both are typed', async () => {
    await expect(
      writeRuleStateVia(UNWIRED_RULE_STATE_WRITER_IO)(foldedRow()),
    ).rejects.toBeInstanceOf(RuleStateWriterUnwired);
    // AND THE ENCODER IS THE ONE THAT REFUSES FIRST, which is the whole point:
    // a deployment that installed a door and no encoding must not write.
    expect(() => UNWIRED_RULE_STATE_WRITER_IO.encodeEngineGates(foldedRow().engineGates)).toThrow(
      /encodeEngineGates/,
    );
    await expect(UNWIRED_RULE_STATE_WRITER_IO.transact(async () => 1)).rejects.toThrow(/transact/);
  });

  test('5.6 no encoding for engine_gates ships in this deployable’s source', async () => {
    // `B5` TERM 2 IS NOT CLEARED HERE AND THIS IS THE MECHANICAL FORM OF THAT.
    // The only `encodeEngineGates` implementation under `src/` is the unwired
    // refusal; every other one in this workspace is a test's or a probe's.
    // THE PREDICATE IS "HOW MANY `RuleStateWriterIo` VALUES DOES THIS
    // DEPLOYABLE'S SOURCE HOLD", swept over `src/` rather than over this one
    // file, because the file an encoder would arrive in is the file nobody has
    // written yet. A COUNT OF THE WORD `encodeEngineGates` WAS THE FIRST DRAFT
    // AND IT WAS WRONG IN BOTH DIRECTIONS: it counted the mapping's own
    // parameter, which is where an encoding ARRIVES rather than where one is
    // written, and it would have missed an installed `Io` assembled field by
    // field.
    const declarations: string[] = [];
    for (const file of sourceFiles())
      for (const match of readFileSync(file, 'utf8').matchAll(
        /export const (\w+): RuleStateWriterIo =/g,
      ))
        declarations.push(match[1] ?? '');
    expect(declarations, 'a second RuleStateWriterIo value ships in src/').toEqual([
      'UNWIRED_RULE_STATE_WRITER_IO',
    ]);
    expect(readFileSync(WRITER, 'utf8')).toContain('throw new RuleStateWriterUnwired');
  });
});

// =============================================================================
// 6. THE DOOR
// =============================================================================

describe('6. the door is this deployable’s and nothing here widens it', () => {
  test('6.1 SystemTx is assignable to RuleStateTx, checked rather than claimed', () => {
    // The prose four ports files carry -- "a wider handle is assignable to a
    // narrower shape, so the narrowing costs the wiring nothing" -- as a
    // compile-time fact. `tsc` reads `test/**/*.ts` (`apps/worker/tsconfig.json`),
    // so this line is `CI-01`'s to check.
    const narrow = (tx: SystemTx): RuleStateTx => tx;
    expect(typeof narrow).toBe('function');
  });

  test('6.2 and the accessor still declares the member that makes 6.1 true', () => {
    const accessor = readFileSync(join(ROOT, 'packages/db/src/scoped-db.ts'), 'utf8');
    expect(accessor).toContain('insert<K extends TableKey>(key: K, values: WriteValues)');
    // `ruleStates` is `derived` and NOT firm, which is why `apps/api`'s `firm`
    // door cannot name it and this module lives in `apps/worker`.
    const scope = readFileSync(join(ROOT, 'packages/db/src/scope.ts'), 'utf8');
    const entry = scope.slice(scope.indexOf('  ruleStates: {'));
    expect(entry.slice(0, 200)).toContain("class: 'derived'");
  });

  test('6.3 the module names no accessor, no driver and no reason', () => {
    // SWEPT OVER CODE AND NOT OVER THE FILE, in `breaker.test.ts` 7.5's idiom
    // and for its reason: this module's header QUOTES the words it refuses, so
    // a sweep over the prose would be red on the sentence that explains why it
    // is green.
    const source = readFileSync(WRITER, 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n');
    for (const forbidden of ["from '@merit/db'", "from 'pg'", 'sqlExecutor', 'SystemReason'])
      expect(source, `${forbidden} appears in the writer's code`).not.toContain(forbidden);
    // NON-VACUITY: the strip left the code, not an empty string.
    expect(source).toContain('export function writeRuleStateVia');
    // It reaches `@merit/rules-engine` for ONE type and nothing else.
    expect(source).toContain("import type { EngineGateResults } from '@merit/rules-engine';");
  });

  test('6.4 the module is a declared leg of the barrel', () => {
    expect(WORKER_BARREL_LEGS).toContain('./batch/state-writer.ts');
  });
});
