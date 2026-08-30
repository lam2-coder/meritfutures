// =============================================================================
// apps/api/test/rule-state-reader.test.ts
// =============================================================================
// **THE ROW A REAL NIGHTLY FOLD WROTE, READ BACK BY `apps/api` INTO A
// `RuleState`, AND THE HASH THAT PROVES NOTHING WAS INVENTED ON THE WAY.**
//
// `usePayoutBackend`'s entry has said for four revisions that `state` waits on
// "a `rule_states` ROW, which is a scheduled run and a reader". `ADR-264`
// established the first half by RUNNING it rather than by reading `ADR-260`:
// migrations `0001` to `0074` applied to an empty PostgreSQL 16, one account
// seeded with one live `daily_marks` row, `apps/worker`'s own entrypoint
// invoked, and `rule_states` went from zero rows to one. Every column in
// `FOLDED_ROW` below is that row as `SystemTx.rowsWhere('ruleStates', ...)`
// returned it, and `FOLDED_STATE_HASH` is what `rule_states.state_hash` holds
// for it.
//
// -----------------------------------------------------------------------------
// WHY THE HASH IS THE ASSERTION AND THE FIELD-BY-FIELD COMPARISON IS NOT
// -----------------------------------------------------------------------------
// There are now TWO transcriptions of this row in the repository:
// `toRuleState` in `apps/worker/src/batch/adapter.ts` reads it to build a
// `prior`, and `readRuleState` in `apps/api/src/rule-state-reader.ts` reads it
// to build a `PayoutSubject.state`. `apps/api` cannot import `apps/worker`, so
// that is `FM-16`'s shape by name: two statements of one predicate. `ADR-264`
// section 6 registers it and names its home.
//
// **WHAT `FM-16` COSTS IS "WITH NOTHING COMPARING THEM", AND THAT HALF IS
// ANSWERED HERE.** `SD-08`'s digest is computed by `apps/worker` from the
// `RuleState` the engine folded, BEFORE the row is written, and the database
// holds it in a `bytea` a trigger checks is thirty-two bytes. So re-hashing the
// state this reader rebuilds and comparing it with the stored bytes compares
// the WRITER's transcription with the READER's, through a value neither of them
// can adjust. A shared module would make the two agree by construction and
// would still prove nothing about whether the STORED row survives the trip.
//
// The engine is the only implementation of the digest (`ADR-081` moved it out
// of `apps/worker`), and `@merit/rules-engine` is a declared dependency of this
// deployable, so this comparator needs no cross-deployable import at all.
// =============================================================================

import { describe, expect, test } from 'vitest';
import { stateHash, type RuleState } from '@merit/rules-engine';

import {
  RuleStateAbsent,
  RuleStateUnreadable,
  readRuleState,
  ruleStateOn,
} from '../src/rule-state-reader.ts';

/** The account `ADR-264` section 2 seeded and folded. */
const ACCOUNT = '0199c7a1-0000-7000-8000-0000000000e0';

/** The day it closed. `MERIT_BATCH_TRADING_DAY`, carried by the seeded calendar. */
const DAY = '2026-08-28';

/**
 * `rule_states.state_hash` FOR THAT ROW, as `psql` rendered the `bytea`.
 *
 * IT IS NOT COMPUTED ANYWHERE IN THIS FILE AND THAT IS THE WHOLE POINT. It was
 * produced by `apps/worker` through `@merit/rules-engine`'s `stateHash` over
 * the state the fold returned, written by `writeRuleStateVia`, and read back
 * out of PostgreSQL. A test that recomputed it from the same row it is checking
 * would be agreeing with itself.
 */
const FOLDED_STATE_HASH = '68d7303f2d7282a3f310360a3470e9e6fa2d40025683cd5d80c437b2c5f3d090';

/**
 * The row, as the accessor returns it: camelCase keys, `bigint` for every
 * `bigint` column, ISO strings for `date`, the parsed bag for `jsonb`.
 *
 * A FUNCTION RATHER THAN A CONSTANT, so a case that deletes a key to watch the
 * refusal cannot leave the next case reading a row it damaged.
 */
function foldedRow(): Record<string, unknown> {
  return {
    id: 1n,
    accountId: ACCOUNT,
    tradingDay: DAY,
    phase: 'eval',
    floorCents: 4_760_000n,
    floorLocked: false,
    floorOpenCents: 4_750_000n,
    highWaterBalanceCents: 5_010_000n,
    balanceCents: 5_010_000n,
    withdrawableCents: 0n,
    tradedDaysCount: 1,
    winDaysCount: 0,
    consistencyBestDayCents: 10_000n,
    consistencyPeriodProfitCents: 10_000n,
    consistencyPeriodStartDay: null,
    payoutsSettledCount: 0,
    payoutAnchorDay: null,
    cadenceAnchorDay: null,
    engineEligible: false,
    engineGates: {
      tradedDays: { pass: true, skipped: true, have: 1, need: 0 },
      winDays: { pass: false, have: 0, need: 5, floorCents: '15000' },
      buffer: { pass: false, haveCents: '10000', needCents: '100000' },
      consistency: {
        pass: false,
        skipped: false,
        bestDayShareBp: 10000,
        maxDayShareBp: 3000,
        profitNeededToDiluteCents: '23334',
      },
      cadenceGap: {
        pass: true,
        skipped: true,
        tradingDaysSinceLastPayout: null,
        need: 5,
        nextEligibleTradingDay: null,
      },
      minimumAmount: {
        pass: false,
        withdrawableCents: '0',
        minPayoutCents: '10000',
        capCents: '150000',
      },
    },
    // `INV-23`'s half. It is on the row, it is NOT on a `RuleState`, and the
    // reader must not read it.
    contextGates: {
      accountActive: { pass: false, status: 'active' },
      kycVerified: { pass: false, state: 'kyc_required' },
      notFrozen: { pass: true, reason: null },
      reconClear: { pass: true },
      noPayoutInFlight: { pass: true },
    },
    stateHash: Buffer.from(FOLDED_STATE_HASH, 'hex'),
    engineVersion: 'session-455-probe',
    computedAt: new Date('2026-08-30T02:05:43.682Z'),
    createdAt: new Date('2026-08-30T02:05:43.682Z'),
    calendarRevisionId: null,
    lifetimeSettledCents: 0n,
    breached: false,
    breachKind: null,
  };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('the row a real fold wrote, rebuilt by this deployable', () => {
  test('THE DIGEST CLOSES: the writer folded this state and the reader rebuilds the same one', () => {
    // THE ONE ASSERTION THIS FILE EXISTS FOR. `SD-08` hashes nineteen columns
    // plus the twenty-five gate leaves in `ADR-026` C-07's order, so a single
    // cents value that came back a `number`, a day that lost its shape or a
    // gate leaf the decoder dropped moves these thirty-two bytes. The stored
    // value was computed on the other side of a PostgreSQL round trip by a
    // different deployable.
    const state: RuleState = readRuleState(foldedRow(), 'rule_states');

    expect(hex(stateHash({ accountId: ACCOUNT, state }))).toBe(FOLDED_STATE_HASH);
  });

  test('and every money field came back `bigint`, which is what the digest was about', () => {
    // STATED SEPARATELY BECAUSE THE DIGEST WOULD CATCH IT AND WOULD NOT NAME
    // IT. `INV-02` is integer cents in `bigint`, and a reader that returned
    // `Number(row.balanceCents)` on a 50K account passes every eyeball check and
    // is a float on the money path.
    const state = readRuleState(foldedRow(), 'rule_states');
    for (const field of [
      state.balanceCents,
      state.floorCents,
      state.floorOpenCents,
      state.highWaterBalanceCents,
      state.withdrawableCents,
      state.consistencyBestDayCents,
      state.consistencyPeriodProfitCents,
      state.lifetimeSettledCents,
    ])
      expect(typeof field).toBe('bigint');

    expect(state.balanceCents).toBe(5_010_000n);
    expect(state.tradingDay).toBe(DAY);
    expect(state.phase).toBe('eval');
    expect(state.engineEligible).toBe(false);
    expect(state.breached).toBe(false);
    expect(state.breachKind).toBeNull();
    expect(state.engineVersion).toBe('session-455-probe');
  });

  test('and the three columns a `RuleState` has no field for are NOT read', () => {
    // `context_gates`, `state_hash` and `calendar_revision_id` are the row's
    // and not the state's. A reader that carried any of them would be handing
    // `evaluatePayout` a value `INV-23` keeps out of the replayed state, and the
    // digest above would still pass, because the digest covers the state.
    const damaged = foldedRow();
    damaged['contextGates'] = 'not a bag at all';
    damaged['stateHash'] = 'not bytes at all';
    damaged['calendarRevisionId'] = 'not a bigint at all';

    const state = readRuleState(damaged, 'rule_states');
    expect(hex(stateHash({ accountId: ACCOUNT, state }))).toBe(FOLDED_STATE_HASH);
  });
});

describe('AN ABSENT ROW IS A REFUSAL AND NEVER A DEFAULT VERDICT', () => {
  test('no rows at all refuses, and the refusal names the account and the day', () => {
    // **THE TRAP THIS PORT HAS REFUSED FIVE TIMES.** `rule_states` holding no
    // row for the day is not a reason to compute a confident payout verdict off
    // an empty table: a wrong answer that returns 200 is worse than an honest
    // 503, and every field of a fabricated `RuleState` is a gate that never
    // fires. The reader has no arm that returns a state it did not read.
    let raised: unknown = null;
    try {
      ruleStateOn([], ACCOUNT, DAY);
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeInstanceOf(RuleStateAbsent);
    expect((raised as RuleStateAbsent).accountId).toBe(ACCOUNT);
    expect((raised as RuleStateAbsent).tradingDay).toBe(DAY);
  });

  test('and a row for ANOTHER day is an absence for THIS day, which is R-06', () => {
    // **THE SECOND HALF OF THE SAME TRAP AND IT IS THE ONE THAT LOOKS
    // HARMLESS.** `R-06` is that no endpoint may evaluate eligibility against
    // anything other than the last closed day. A reader that fell back to the
    // latest row it could find would answer a payout request from a state
    // computed before the nights in between, which reads as a working endpoint
    // and pays against a floor that has moved.
    expect(() => ruleStateOn([foldedRow()], ACCOUNT, '2026-08-29')).toThrow(RuleStateAbsent);
    expect(() => ruleStateOn([foldedRow()], ACCOUNT, '2026-08-27')).toThrow(RuleStateAbsent);

    // AND THE DAY THAT IS THERE STILL RESOLVES, so the case above is a refusal
    // rather than a reader that refuses everything.
    expect(ruleStateOn([foldedRow()], ACCOUNT, DAY).tradingDay).toBe(DAY);
  });

  test('and TWO rows for one day refuse rather than one of them being chosen', () => {
    // `rule_states_account_day_uq` is UNIQUE on `(account_id, trading_day)`, so
    // a pair reaching this reader is a database whose index is gone. Picking one
    // would fold a payout against whichever row the accessor happened to return
    // first, which is an ordering this table does not declare.
    const twice = [foldedRow(), foldedRow()];
    expect(() => ruleStateOn(twice, ACCOUNT, DAY)).toThrow(RuleStateUnreadable);
  });

  test('and a row belonging to another account is refused rather than read', () => {
    // The caller's read is already scoped, so this cannot happen through the
    // accessor. It is asserted because the argument is a `readonly unknown[]`
    // and a future call site that passed the wrong list would otherwise pay a
    // trader against somebody else's state.
    const other = foldedRow();
    other['accountId'] = '0199c7a1-0000-7000-8000-0000000000ff';
    expect(() => ruleStateOn([other], ACCOUNT, DAY)).toThrow(RuleStateAbsent);
  });
});

describe('every column refuses rather than defaulting', () => {
  test('a missing NOT NULL column stops the read and names itself', () => {
    // `R-41` conjoins the context gates as vetoes and `evaluatePayout` reads
    // this state for the rest, so a field defaulted here is a rule that never
    // fires. There is no `?? 0n` and no `?? false` in the reader.
    const columns = [
      'tradingDay',
      'phase',
      'floorCents',
      'floorLocked',
      'floorOpenCents',
      'highWaterBalanceCents',
      'balanceCents',
      'withdrawableCents',
      'tradedDaysCount',
      'winDaysCount',
      'consistencyBestDayCents',
      'consistencyPeriodProfitCents',
      'payoutsSettledCount',
      'engineEligible',
      'engineGates',
      'lifetimeSettledCents',
      'breached',
      'engineVersion',
    ];

    for (const column of columns) {
      const row = foldedRow();
      delete row[column];
      expect(
        () => readRuleState(row, 'rule_states'),
        `${column} was defaulted rather than refused`,
      ).toThrow();
    }
  });

  test('and the three NULLABLE columns are read as `null` rather than refused', () => {
    // NON-VACUITY FOR THE CASE ABOVE. A reader that threw on every absent key
    // would pass it and would refuse every account that has never taken a
    // payout, which is every account on its first funded day.
    const state = readRuleState(foldedRow(), 'rule_states');
    expect(state.consistencyPeriodStartDay).toBeNull();
    expect(state.payoutAnchorDay).toBeNull();
    expect(state.cadenceAnchorDay).toBeNull();
  });

  test('and a `phase` outside `account_phase` is refused rather than carried', () => {
    const row = foldedRow();
    row['phase'] = 'provisioning_pending';
    expect(() => readRuleState(row, 'rule_states')).toThrow(RuleStateUnreadable);
  });

  test('and a cents column that arrives as a JSON number is refused, not coerced', () => {
    // `INV-02`. A `bigint` column that came back a `number` has already lost
    // digits past 2^53, and the value that would be silently accepted here is
    // the one the digest is computed over.
    const row = foldedRow();
    row['balanceCents'] = 5_010_000;
    expect(() => readRuleState(row, 'rule_states')).toThrow(RuleStateUnreadable);
  });

  test('and `breached` split from `breach_kind` is refused, on `0065`s own pairing', () => {
    // `rule_states_breach_flag_matches_kind` is `breached = (breach_kind IS NOT
    // NULL)` at the store, so either shape below is a row the database says
    // cannot exist. Repairing it here would tell a consumer about a drawdown
    // type that never happened, or hide one that did.
    const orphanKind = foldedRow();
    orphanKind['breachKind'] = 'static_floor';
    expect(() => readRuleState(orphanKind, 'rule_states')).toThrow(RuleStateUnreadable);

    const orphanFlag = foldedRow();
    orphanFlag['breached'] = true;
    expect(() => readRuleState(orphanFlag, 'rule_states')).toThrow(RuleStateUnreadable);

    // AND THE PAIR TOGETHER READS, so the two cases above are a pairing check
    // rather than a reader that cannot read a breached account at all.
    const breached = foldedRow();
    breached['breached'] = true;
    breached['breachKind'] = 'trailing_eod_floor';
    expect(readRuleState(breached, 'rule_states').breachKind).toBe('trailing_eod_floor');

    const kind = foldedRow();
    kind['breached'] = true;
    kind['breachKind'] = 'a kind no migration declares';
    expect(() => readRuleState(kind, 'rule_states')).toThrow(RuleStateUnreadable);
  });

  test('and `engine_gates` is decoded by the ENGINE rather than by this deployable', () => {
    // `ADR-250` put the codec in `packages/rules-engine` because both
    // deployables read this column and neither can import the other. A leaf
    // missing from the bag must fail in the engine's decoder, so the refusal
    // this deployable makes about the stored encoding is the same refusal
    // `apps/worker` makes.
    const row = foldedRow();
    const gates = { ...(row['engineGates'] as Record<string, unknown>) };
    delete gates['buffer'];
    row['engineGates'] = gates;

    expect(() => readRuleState(row, 'rule_states')).toThrow();
  });
});
