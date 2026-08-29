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
import { ENGINE_GATE_LEAVES } from '../src/batch/state-hash.ts';
import {
  RULE_STATE_WRITE_COLUMNS,
  RULE_STATE_WRITE_TABLES,
  RuleStateAlreadyWritten,
  RuleStateEncodingRefusal,
  RuleStateWriterUnwired,
  UNWIRED_RULE_STATE_WRITER_IO,
  encodeEngineGates,
  refuseUnstorableJson,
  ruleStateValues,
  writeRuleStateVia,
} from '../src/batch/state-writer.ts';
import type { RuleStateTx, RuleStateValues, RuleStateWriterIo } from '../src/batch/state-writer.ts';
import { WORKER_BARREL_LEGS } from '../src/index.ts';
import { ACCOUNT_A, CALENDAR, ENGINE_VERSION, accountDay } from './fixtures.ts';

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
    const written = new Set<string>(RULE_STATE_WRITE_COLUMNS);
    const unwritten = schemaProperties().filter((p) => !written.has(p));
    expect(unwritten.sort()).toEqual(['computedAt', 'createdAt', 'id']);
  });

  test('1.3 the values object names those columns and no others', () => {
    const values = ruleStateValues(foldedRow());
    expect(Object.keys(values).sort()).toEqual([...RULE_STATE_WRITE_COLUMNS].sort());
    expect(RULE_STATE_WRITE_COLUMNS).toHaveLength(23);
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
    const values = ruleStateValues(row);
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
    const values = ruleStateValues(foldedRow());
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
    expect(ruleStateValues(row).stateHash).toBe(row.stateHash);
    expect(row.stateHash).toHaveLength(32);
  });

  test('2.4 contextGates goes to the column as it stands, and it is the engine’s five', () => {
    const row = foldedRow();
    const values = ruleStateValues(row);
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
    expect(ruleStateValues(row).calendarRevisionId).toBe(1n);
    expect(ruleStateValues({ ...row, calendarRevisionId: null }).calendarRevisionId).toBeNull();
    // A fractional revision id is refused at the boundary rather than sent.
    // `0035` makes `null` mean "the calendar had never been corrected", which
    // is NOT "unknown", so a value that cannot be a revision must not become
    // one.
    expect(() => ruleStateValues({ ...row, calendarRevisionId: 1.5 })).toThrow(RangeError);
  });

  test('2.6 the fold’s own gates are what the mapping encodes', () => {
    const row = foldedRow();
    expect(ruleStateValues(row).engineGates).toEqual(encodeEngineGates(row.engineGates));
  });
});

// =============================================================================
// 3. THE GUARD
// =============================================================================

describe('3. the guard refuses what JSON.stringify throws on, drops or changes', () => {
  test('3.1 a bigint is refused and the PATH is named', () => {
    // THE SHAPE THAT MADE THIS GUARD NECESSARY. `EngineGateResults` types SEVEN
    // of its twenty-five leaves as `Cents`, and case 3b.2 names all seven. This
    // comment said FOUR, inherited from `hash.ts`, which said four until
    // 2026-08-29; both are repaired on this branch.
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
      ruleStateValues(poisoned);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RuleStateEncodingRefusal);
    expect((raised as RuleStateEncodingRefusal).column).toBe('context_gates');
  });
});

// =============================================================================
// 3b. `ADR-206`: THE RULED ENCODING
// =============================================================================
// Term 2 of `B5` landed while this branch was open. These cases are the ruling
// as assertions, and the first is the one this module cannot make about itself.

/** Every dotted leaf path of a bag, deepest-first order irrelevant. */
function dottedLeaves(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, member]) =>
    dottedLeaves(member, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('3b. the stored bag is ADR-206’s, leaf for leaf', () => {
  test('3b.1 THE LEAF SET IS `ENGINE_GATE_LEAVES`, IN BOTH DIRECTIONS', () => {
    // `ADR-206` ruling 1: the leaves "are exactly `ENGINE_GATE_LEAVES`' dotted
    // paths". THE ENCODER IS WRITTEN OUT LEAF BY LEAF, on `M01` section 1.4's
    // ban on key iteration that affects output, so nothing inside that function
    // can notice a leaf added to a gate interface. This case is what does: a
    // new member of `WinDaysGate` appears in the hash's list and not in the bag,
    // and the column would sit one field short of the `state_hash` beside it.
    const produced = dottedLeaves(encodeEngineGates(foldedRow().engineGates)).sort();
    const declared = ENGINE_GATE_LEAVES.map((leaf) => leaf.path).sort();
    // NON-VACUITY: twenty-five is the count `ADR-206` and `hash.ts` both state.
    expect(declared).toHaveLength(25);
    expect(produced).toEqual(declared);
  });

  test('3b.2 the SEVEN cents leaves are base-10 strings and nothing else is', () => {
    // Ruling 3, and the seven are named in it. A JSON number here round-trips
    // through the read port and loses its low digits past 2^53 - 1, which is
    // that entry's section 5 measured on a real row.
    const bag = encodeEngineGates(foldedRow().engineGates);
    const strings = dottedLeaves(bag).filter((path) => path.endsWith('Cents'));
    expect(strings.sort()).toEqual(
      [
        'buffer.haveCents',
        'buffer.needCents',
        'consistency.profitNeededToDiluteCents',
        'minimumAmount.capCents',
        'minimumAmount.minPayoutCents',
        'minimumAmount.withdrawableCents',
        'winDays.floorCents',
      ].sort(),
    );
    expect(typeof bag.buffer.needCents).toBe('string');
    expect(typeof bag.minimumAmount.capCents).toBe('string');
    expect(bag.buffer.needCents).toBe(foldedRow().engineGates.buffer.needCents.toString(10));
  });

  test('3b.3 a Cents past 2^53 - 1 survives the encoding EXACTLY', () => {
    // THE WHOLE REASON RULING 3 CHOSE STRINGS, as a value rather than as an
    // argument. `Number(9_007_199_254_740_993n)` is 9007199254740992.
    const row = foldedRow();
    const huge = 9_007_199_254_740_993n;
    const bag = encodeEngineGates({
      ...row.engineGates,
      minimumAmount: { ...row.engineGates.minimumAmount, capCents: huge },
    });
    expect(bag.minimumAmount.capCents).toBe('9007199254740993');
    expect(BigInt(bag.minimumAmount.capCents)).toBe(huge);
    // The direction ruling 3 refuses, shown losing the value on the same input.
    expect(BigInt(Number(huge))).not.toBe(huge);
  });

  test('3b.4 `null` is JSON null and never the hash’s sentinel', () => {
    // Ruling 4. `hash.ts` renders an absent leaf as a sentinel because a hash
    // needs one; a `jsonb` bag has a real null and using the sentinel would
    // store the string that means "absent" as a value.
    const row = foldedRow();
    const bag = encodeEngineGates({
      ...row.engineGates,
      consistency: { ...row.engineGates.consistency, bestDayShareBp: null, maxDayShareBp: null },
      cadenceGap: {
        ...row.engineGates.cadenceGap,
        tradingDaysSinceLastPayout: null,
        nextEligibleTradingDay: null,
      },
    });
    expect(bag.consistency.bestDayShareBp).toBeNull();
    expect(bag.cadenceGap.nextEligibleTradingDay).toBeNull();
    expect(JSON.stringify(bag)).not.toContain('~null');
    expect(JSON.parse(JSON.stringify(bag))).toEqual(bag);
  });

  test('3b.5 `skipped` is on THREE groups and no others, and no context gate is here', () => {
    // Ruling 5 is the interface's shape rather than an omission: `CV-19` gives
    // a not-evaluated gate `pass: true, skipped: true`, and the other three
    // groups are always evaluated. And `INV-23` is why the four `R-40` context
    // gates are absent: `SD-06` split the column in two so the replayed half
    // carries nothing that "was true on the day and may not be true now".
    const bag = encodeEngineGates(foldedRow().engineGates);
    expect(
      dottedLeaves(bag)
        .filter((p) => p.endsWith('.skipped'))
        .sort(),
    ).toEqual(['cadenceGap.skipped', 'consistency.skipped', 'tradedDays.skipped']);
    expect(Object.keys(bag).sort()).toEqual([
      'buffer',
      'cadenceGap',
      'consistency',
      'minimumAmount',
      'tradedDays',
      'winDays',
    ]);
    for (const contextGate of ['accountActive', 'kycVerified', 'notFrozen', 'reconClear'])
      expect(JSON.stringify(bag)).not.toContain(contextGate);
  });

  test('3b.6 the bag the guard sees is storable, which is the two rulings meeting', () => {
    expect(() => {
      refuseUnstorableJson('engine_gates', encodeEngineGates(foldedRow().engineGates));
    }).not.toThrow();
  });

  test('3b.7 THE GUARD RUNS ON THE ENCODED BAG, AT THE CALL SITE AND NOT ONLY DIRECTLY', () => {
    // **A SEED CAUGHT THIS FILE LEAVING A GUARD UNWATCHED AND IT IS THE MOST
    // VALUABLE RESULT OF THIS SESSION'S SECOND PASS.** Deleting
    // `refuseUnstorableJson('engine_gates', ...)` from `ruleStateValues` left
    // the suite **GREEN at 163 of 163**. The reason is the ruling: once
    // `encodeEngineGates` returns a typed `StoredEngineGates`, no encoder can
    // hand the guard a bigint, and the case above calls the guard DIRECTLY
    // rather than through the mapping. The call site had no witness.
    //
    // **THE SEED THAT DOES WITNESS IT IS NOT CONTRIVED.** Sixteen of the
    // twenty-five leaves are passed through the encoder UNCONVERTED -- every
    // `pass`, `skipped`, `have`, `need`, the two basis-point leaves,
    // `tradingDaysSinceLastPayout` and `nextEligibleTradingDay` -- so a leaf
    // whose engine type later becomes a `Cents` reaches the column raw, and
    // this line is what fails instead of a query builder.
    const row = foldedRow();
    const raw = {
      ...row,
      engineGates: {
        ...row.engineGates,
        tradedDays: { ...row.engineGates.tradedDays, have: 12n },
      },
    } as unknown as RuleStateRow;
    let raised: unknown;
    try {
      ruleStateValues(raw);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RuleStateEncodingRefusal);
    expect((raised as RuleStateEncodingRefusal).column).toBe('engine_gates');
    expect((raised as RuleStateEncodingRefusal).path).toBe('$.tradedDays.have');
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
    expect(rec.inserts[0]?.values).toEqual(ruleStateValues(row));
  });

  test('4.3 what reaches the column is `ADR-206`s bag, unchanged by the write path', async () => {
    // **THIS CASE USED TO SAY THE OPPOSITE AND THE INVERSION IS RECORDED.** It
    // read "TWO callers with TWO encodings both write, and the writer chooses
    // NEITHER", and it drove the writer twice through an injected encoder to
    // prove this slice had not pre-empted `B5` term 2. `ADR-206` ruled the
    // encoding while the branch was open, so what has to be asserted now is the
    // opposite: that the ONE ruled bag is what the transaction sees.
    const row = foldedRow();
    const rec = recorder({});
    await writeRuleStateVia(rec.io)(row);
    expect(rec.inserts[0]?.values.engineGates).toEqual(encodeEngineGates(row.engineGates));
  });

  test('4.4 an insert that wrote no row is a refusal, not a success', async () => {
    const rec = recorder({ returns: [] });
    await expect(writeRuleStateVia(rec.io)(foldedRow())).rejects.toThrow(/returned 0 rows/);
  });

  test('4.5 an unstorable bag stops BEFORE the transaction opens', async () => {
    // The guard runs in the mapping and the mapping runs before `transact`, so
    // a row the column cannot hold never reaches the database at all. Measured
    // live as well, when the encoding was still injected: rows before 3, after 3.
    //
    // THE SEED IS ON `context_gates`, WHICH IS THE HALF STILL REACHED WITHOUT AN
    // ENCODER. `engine_gates` is now `ADR-206`'s and case 3.x seeds the guard
    // directly; this case is about the ORDER of the two steps.
    const row = foldedRow();
    const poisoned = {
      ...row,
      contextGates: { ...row.contextGates, leakedCents: 1n },
    } as unknown as RuleStateRow;
    const rec = recorder({});
    await expect(writeRuleStateVia(rec.io)(poisoned)).rejects.toBeInstanceOf(
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

  test('5.5 the unwired default serves nothing, and the refusal is typed', async () => {
    await expect(
      writeRuleStateVia(UNWIRED_RULE_STATE_WRITER_IO)(foldedRow()),
    ).rejects.toBeInstanceOf(RuleStateWriterUnwired);
    await expect(UNWIRED_RULE_STATE_WRITER_IO.transact(async () => 1)).rejects.toThrow(/transact/);
    // ONE MEMBER, AND IT USED TO BE TWO. `encodeEngineGates` was on this `Io`
    // while `B5` term 2 was open; `ADR-206` ruled the encoding and the seam is
    // gone rather than left standing with a supplier it declines to use.
    expect(Object.keys(UNWIRED_RULE_STATE_WRITER_IO)).toEqual(['transact']);
  });

  test('5.6 there is ONE engine_gates encoding in this deployable and it is not injectable', () => {
    // **THE PREDICATE INVERTED WITH `ADR-206` AND THE OLD ONE IS RECORDED.** It
    // read "no encoding for `engine_gates` ships in this deployable's source"
    // and swept `src/` for a second `RuleStateWriterIo` value, because while
    // term 2 was open the correct number of encodings here was ZERO. It is now
    // exactly ONE, and what matters is that nothing can supply a second: an
    // `Io` member would let a deployment install one, and there is no longer a
    // member to install it into.
    const declarations: string[] = [];
    for (const file of sourceFiles())
      for (const match of readFileSync(file, 'utf8').matchAll(
        /export function (\w+)\(gates: EngineGateResults\)/g,
      ))
        declarations.push(match[1] ?? '');
    expect(declarations, 'a second engine_gates encoder ships in src/').toEqual([
      'encodeEngineGates',
    ]);
    expect(readFileSync(WRITER, 'utf8')).not.toContain('encodeEngineGates:');
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
