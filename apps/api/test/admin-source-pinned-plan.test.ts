// =============================================================================
// apps/api/test/admin-source-pinned-plan.test.ts
// =============================================================================
// `B5` TERM 1, DISCHARGED, AND THE CASES THAT SAY SO RATHER THAN AN ENTRY.
//
// THREE ENTRIES PRICED THIS TERM AND EACH CORRECTED THE ONE BEFORE IT.
// `ADR-411` section 12 item 2 called it "one export and one call" and named the
// FENCE as the only obstacle. `ADR-413` measured that false: the composition
// reads through `catalogRowAt`, `packages/db` declared that accessor on
// `ScopedTx` alone, an admin read holds a `SystemTx`, and so the export would
// have compiled with no caller able to produce its first argument. It named the
// home as a `packages/db` door and could not take it, holding neither package.
//
// **`ADR-416` HOLDS BOTH AND THE DOOR IS TAKEN, AFTER WHICH `ADR-411`'s PRICE IS
// CORRECT.** That is worth stating plainly because it is the one thing three
// entries disagreed about: the term really was one export and one call. What was
// missing was never a refactor and never a decoder; it was a handle for the call
// to be made on.
//
// WHAT EACH CASE BELOW WOULD CATCH IF IT REGRESSED:
//
//   1. The supplier answers, so `EligibleFoldUnwired` is no longer this
//      deployable's answer for `resolvePinnedPlan`. THE PORT IS SATISFIED.
//   2. The plan it answers with carries the size row's OWN cents, unrounded and
//      unscaled, which is the property `resolvePlan` exists to keep and the one
//      a second mapping would break silently.
//   3. A `SystemTx` satisfies the handle the supplier takes. This is the whole
//      of what `ADR-416` changed and it is checked by `tsc`.
//   4. The refusals of the shared composition travel rather than being caught
//      and turned into a figure.
// =============================================================================

import { describe, expect, test } from 'vitest';

import type { CatalogReadTx, SystemTx } from '@merit/db';
import type { Cents, ResolvedPlan } from '@merit/rules-engine';

import {
  EligibleFoldUnwired,
  UNWIRED_ELIGIBLE_FOLD_IO,
  type EligibleFoldIo,
} from '../src/admin-source/eligible-next-7d.ts';
import { pinnedPlanIo } from '../src/admin-source/pinned-plan.ts';

const PLAN_VERSION = '0199c7a1-6666-7000-8000-000000000501';
const SIZE_CENTS = 5_000_000n as Cents;

/**
 * `plan_versions.rules` AS THE COLUMN HOLDS IT.
 *
 * `payout-backend.test.ts`'s fixture and its reason: the column is `jsonb NOT
 * NULL`, the value arrives as a JSON document, and a fixture typed as the
 * DECODED shape would be handing the decoder its own answer.
 */
const STORED_RULES: Record<string, unknown> = {
  schema_version: 1,
  phase_eval: {
    enabled: true,
    profit_target_bp: 800,
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 1,
    consistency: { enabled: false, max_day_share_bp: null, mode: 'pass_time_dilutable' },
    max_days: null,
  },
  phase_funded: {
    drawdown: {
      type: 'trailing_eod',
      amount_bp: 500,
      lock: { enabled: false, at_profit_cents: null, floor_at_cents: null },
    },
    daily_loss_limit: { type: 'none', amount_bp: null },
    min_trading_days: 0,
    win_days: { required_count: 1, floor_bp: 10, reset_on_payout: true },
    consistency: { enabled: false, max_day_share_bp: null, mode: 'payout_gated' },
    buffer_bp: 100,
    cadence_gap_trading_days: 0,
    min_settlement_lag_trading_days: 0,
    payout_cap_schedule: [{ from_ordinal: 1, cap_bp: 100 }],
    min_payout_cents: 10000,
    split_bp: 8000,
    max_payouts: 3,
    post_payout_floor_rule: { mode: 'none' },
  },
};

/** `plan_version_sizes` as the grid holds it. `payout-backend.test.ts`'s row. */
function storedSizeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '0199c7a1-bbbb-7000-8000-000000000501',
    planVersionId: PLAN_VERSION,
    sizeCents: SIZE_CENTS,
    priceCents: 29_900n,
    resetPriceCents: 19_900n,
    drawdownCents: 250_000n,
    profitTargetCents: 400_000n,
    bufferCents: 50_000n,
    winDayFloorCents: 5_000n,
    payoutCapScheduleCents: [{ from_ordinal: 1, cap_cents: 150_000 }],
    dailyLossLimitCents: null,
    floorLockEnabled: false,
    floorLockAtProfitCents: null,
    floorLockFloorAtCents: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  };
}

interface Seed {
  readonly planVersion?: unknown;
  readonly planVersionSize?: unknown;
}

interface Read {
  readonly key: string;
  readonly at: unknown;
}

/**
 * A `CatalogReadTx` answering from fixtures and RECORDING every address.
 *
 * THE DOUBLE IS THE HANDLE AND NOT THE DOOR, which is the shape this whole term
 * turned on: the supplier takes the transaction its caller is already inside,
 * so a double for it is one method and no lifecycle at all.
 */
function handle(seed: Seed = {}): { tx: CatalogReadTx; reads: Read[] } {
  const reads: Read[] = [];
  const answers: Record<string, unknown> = {
    planVersions:
      'planVersion' in seed ? seed.planVersion : { id: PLAN_VERSION, rules: STORED_RULES },
    planVersionSizes: 'planVersionSize' in seed ? seed.planVersionSize : storedSizeRow(),
  };
  const tx = {
    catalogRowAt: (key: string, at: unknown) => {
      reads.push({ key, at });
      return Promise.resolve(answers[key]);
    },
  } as unknown as CatalogReadTx;
  return { tx, reads };
}

// -----------------------------------------------------------------------------
// 3. THE HANDLE, CHECKED BY `tsc`, WHICH IS THE WHOLE OF WHAT `ADR-416` MOVED
// -----------------------------------------------------------------------------

/**
 * A `SystemTx` IS a handle this supplier accepts.
 *
 * **THIS IS THE ONE ASSERTION THE WHOLE TERM RESTED ON AND IT IS A TYPE.**
 * `ADR-413`'s finding was that the admin liability read holds a `SystemTx` and
 * that no catalogue accessor existed on it, so a supplier here was unbuildable
 * whatever the fence said. The day that stops being true is the day this line
 * stops compiling, and it would take the supplier with it.
 *
 * Compiled and never called, on `catalog-read.test.ts`'s own reason.
 */
function anAdminHandleSuppliesThePort(tx: SystemTx): EligibleFoldIo {
  return pinnedPlanIo(tx);
}

describe('`B5` term 1: the port has a supplier (ADR-416)', () => {
  test('the type case above is compiled, and this test says so out loud', () => {
    expect(typeof anAdminHandleSuppliesThePort).toBe('function');
  });

  // ---------------------------------------------------------------------------
  // 1. THE PORT IS SATISFIED
  // ---------------------------------------------------------------------------
  test('the unwired default still refuses BY NAME, so the contrast is not assumed', async () => {
    // THE BASELINE, ASSERTED FIRST. A case that only showed the supplier
    // answering would pass on a day the refusal had been quietly deleted, and
    // the refusal is what protects every deployment that has NOT composed one.
    expect(() => UNWIRED_ELIGIBLE_FOLD_IO.resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS)).toThrow(
      EligibleFoldUnwired,
    );
  });

  test('and the composed supplier answers a plan instead of throwing', async () => {
    const { tx } = handle();
    const plan: ResolvedPlan = await pinnedPlanIo(tx).resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS);
    expect(plan.planVersionId).toBe(PLAN_VERSION);
    expect(plan.sizeCents).toBe(SIZE_CENTS);
  });

  test('it addresses the two catalogue tables the pair names, and no others', async () => {
    // THE READS ARE THE PAYOUT PATH'S OWN AND ARE ASSERTED AS SUCH. `INV-16` is
    // in the addresses: the version and the size are the ACCOUNT's, this
    // function chooses neither, and the grid is addressed at its own unique key
    // `(plan_version_id, size_cents)` rather than filtered.
    const { tx, reads } = handle();
    await pinnedPlanIo(tx).resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS);
    expect(reads).toStrictEqual([
      { key: 'planVersions', at: { id: PLAN_VERSION } },
      { key: 'planVersionSizes', at: { planVersionId: PLAN_VERSION, sizeCents: SIZE_CENTS } },
    ]);
  });

  // ---------------------------------------------------------------------------
  // 2. THE CENTS ARE THE ROW'S OWN
  // ---------------------------------------------------------------------------
  test('every cents value is COPIED from the size row and nothing is scaled', async () => {
    // **THE PROPERTY A SECOND MAPPING WOULD BREAK SILENTLY.** M01 section 2.4:
    // the engine reads `plan_versions.rules` for STRUCTURE and
    // `plan_version_sizes` for EVERY CENTS VALUE, and no percentage is applied
    // to a money value at run time. Each assertion below reads a leaf of the
    // resolved plan back against the stored row it came from, so a mapping that
    // put `bufferCents` where `drawdownCents` belongs fails here rather than in
    // a payout six weeks later. Both are `bigint`, so the type cannot catch it.
    const { tx } = handle();
    const plan = await pinnedPlanIo(tx).resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS);
    const stored = storedSizeRow();
    expect(plan.funded.drawdown.drawdownCents).toBe(stored['drawdownCents']);
    expect(plan.funded.bufferCents).toBe(stored['bufferCents']);
    expect(plan.funded.winDayFloorCents).toBe(stored['winDayFloorCents']);
    expect(plan.eval?.profitTargetCents).toBe(stored['profitTargetCents']);
    // AND NOTHING IS A FLOAT ANYWHERE ON THE PATH, which is the constitution's
    // money rule asserted at the one boundary a JSON document crosses it.
    for (const value of [
      plan.sizeCents,
      plan.funded.drawdown.drawdownCents,
      plan.funded.bufferCents,
      plan.funded.winDayFloorCents,
    ])
      expect(typeof value).toBe('bigint');
  });

  test('the cap schedule is the ENGINE codec output and not a second decode', async () => {
    // `decodeCapScheduleCents` IS THE SINGLE STATEMENT OF THE BLOB (`ADR-302`),
    // and the supplier reaches its FOURTH caller rather than becoming a fifth
    // statement. The stored document carries `cap_cents` as a JSON number and
    // what comes back is money, which is exactly the hop that has diverged
    // before.
    const { tx } = handle();
    const plan = await pinnedPlanIo(tx).resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS);
    expect(plan.funded.payoutCapSchedule).toStrictEqual([{ fromOrdinal: 1, capCents: 150_000n }]);
  });

  // ---------------------------------------------------------------------------
  // 4. THE REFUSALS TRAVEL
  // ---------------------------------------------------------------------------
  test('a catalogue that disagrees with the account REFUSES, on both reads', async () => {
    // NEITHER IS CAUGHT AND NEITHER IS TURNED INTO A FIGURE. A fold that
    // swallowed either would report a liability over a population it had
    // silently shrunk, which on the surface an operator funds a payout wallet
    // from is worse than no number. Both arms are driven, because a supplier
    // that handled one and not the other is the shape this case exists to see.
    await expect(
      pinnedPlanIo(handle({ planVersion: undefined }).tx).resolvePinnedPlan(
        PLAN_VERSION,
        SIZE_CENTS,
      ),
    ).rejects.toThrow(/carries no such row on this transaction/);

    await expect(
      pinnedPlanIo(handle({ planVersionSize: undefined }).tx).resolvePinnedPlan(
        PLAN_VERSION,
        SIZE_CENTS,
      ),
    ).rejects.toThrow(/no composite foreign key holding the pair together/);
  });

  test('and a `rules` blob this build cannot read is UNCAUGHT, which is a 500', async () => {
    // `planLeg`'s `@throws` clause, unchanged by the split and asserted through
    // the new entry point: a stored document that disagrees with the codec that
    // reads it is Merit's records disagreeing with Merit's engine, and no retry
    // fixes it.
    await expect(
      pinnedPlanIo(
        handle({ planVersion: { id: PLAN_VERSION, rules: { schema_version: 2 } } }).tx,
      ).resolvePinnedPlan(PLAN_VERSION, SIZE_CENTS),
    ).rejects.toThrow();
  });
});
