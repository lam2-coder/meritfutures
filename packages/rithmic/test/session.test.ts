import { expect, test } from 'vitest';

import { canonicalInput, CANONICAL_ADJUSTMENTS, CANONICAL_SESSIONS } from './canonical.js';
import { simulate, SimulationError } from '../src/simulator/session.js';
import { parseInstantUtc } from '../src/simulator/time.js';
import type { SimDay } from '../src/simulator/types.js';

// CI-02, the `unit` project.
//
// THE IDENTITIES THE DAY MODEL MUST CLOSE, ASSERTED HERE BECAUSE THE PARSER
// CANNOT ASSERT THEM LATER. INV-M2-06 is that M2 checks the mark identities
// BEFORE handing the mark to the engine, so the engine's DO-3 assertion is a
// second line rather than the first (FM-M2-06). A simulator whose own output
// does not close those identities produces files that quarantine for a reason
// that has nothing to do with the scenario, and the fixture stops testing what
// it claims to.

const run = simulate(canonicalInput());
const everyDay: readonly SimDay[] = run.days.flat();

test('a run produces one day per account per session', () => {
  expect(run.days).toHaveLength(CANONICAL_SESSIONS.length);
  for (const session of run.days) expect(session).toHaveLength(run.population.length);
});

test('INV-19: closing equals opening plus realized on every day', () => {
  // `0036_supersede_daily_marks_balance_arithmetic.sql` replaced the original
  // three-term constraint with exactly this identity, and EC-157's whole
  // finding was that the executable statement had been the wrong one. The
  // simulator states it the way the schema now does.
  for (const day of everyDay) {
    expect(day.closingBalanceCents).toBe(day.openingBalanceCents + day.realizedPnlCents);
  }
});

test('INV-18: opening equals the prior closing plus the adjustment', () => {
  // SD-01 and R-10: the non-trading movement is applied AT THE OPEN of the
  // effective trading day, never inside a session. `V-M2-05` is the row that
  // moves if the vendor applies it intraday instead.
  for (const account of run.population) {
    let prior = account.startingBalanceCents;
    for (const [index, session] of run.days.entries()) {
      const day = session.find((d) => d.account.platformAccountRef === account.platformAccountRef);
      expect(day, `${account.platformAccountRef} on session ${index}`).toBeDefined();
      if (day === undefined) return;
      expect(day.openingBalanceCents).toBe(prior + day.adjustmentCents);
      prior = day.closingBalanceCents;
    }
  }
});

test('INV-M2-07: the first mark opens at exactly the account size', () => {
  const first = run.days[0];
  expect(first).toBeDefined();
  for (const day of first ?? []) {
    expect(day.openingBalanceCents).toBe(day.account.sizeCents);
  }
});

test("the day's high and low bound the day they describe", () => {
  // `daily_marks_high_bounds_day` and `daily_marks_low_bounds_day` (0014),
  // transcribed rather than paraphrased.
  for (const day of everyDay) {
    const opening = day.openingBalanceCents;
    const closing = day.closingBalanceCents;
    expect(day.highBalanceCents >= (opening > closing ? opening : closing)).toBe(true);
    expect(day.lowBalanceCents <= (opening < closing ? opening : closing)).toBe(true);
  }
});

test('realized P&L is the sum of the round trips, not a second opinion about it', () => {
  for (const day of everyDay) {
    const summed = day.trades.reduce((total, trade) => total + trade.realizedCents, 0n);
    expect(summed).toBe(day.realizedPnlCents);
  }
});

test('traded_day is fill_count > 0, by definition rather than by convention', () => {
  // `daily_marks_traded_day_matches_fills` (0014). The simulator's two outputs
  // have to agree about this or the mark computed from them cannot satisfy the
  // constraint at all.
  for (const day of everyDay) {
    expect(day.fills.length === 0).toBe(day.trades.length === 0);
    expect(day.fills).toHaveLength(day.trades.length * 2);
  }
});

test('every fill lands strictly inside its session window', () => {
  // INV-M2-05: `fills.trading_day` comes from calendar session containment,
  // never from a UTC date cast, and GS-001 is the fill at 17:05 CT that belongs
  // to the next trading day. A simulator that stamped a fill at or past the
  // close would manufacture that boundary case by accident.
  for (const [index, session] of CANONICAL_SESSIONS.entries()) {
    const open = parseInstantUtc(session.sessionOpenUtc);
    const close = parseInstantUtc(session.sessionCloseUtc);
    for (const day of run.days[index] ?? []) {
      for (const fill of day.fills) {
        const at = parseInstantUtc(fill.executedAtUtc);
        expect(at).toBeGreaterThanOrEqual(open);
        expect(at).toBeLessThan(close);
      }
    }
  }
});

test('a round trip is two fills on opposite sides of the same order', () => {
  for (const day of everyDay) {
    for (const trade of day.trades) {
      const legs = day.fills.filter((fill) => fill.tradeSequence === trade.sequence);
      expect(legs).toHaveLength(2);
      const [entry, exit] = legs;
      expect(entry?.leg).toBe('entry');
      expect(exit?.leg).toBe('exit');
      expect(entry?.side).not.toBe(exit?.side);
      expect(entry?.orderId).toBe(exit?.orderId);
      expect(entry?.side).toBe(trade.direction === 'long' ? 'buy' : 'sell');
    }
  }
});

test('every platform fill id is unique across the run', () => {
  // `fills_platform_fill_uq` on (platform, platform_fill_id) (0013). A
  // simulator that collided would have every second file fail to insert, which
  // is a defect discovered in an integration suite instead of here.
  const ids = new Set<string>();
  for (const day of everyDay) {
    for (const fill of day.fills) {
      expect(ids.has(fill.platformFillId)).toBe(false);
      ids.add(fill.platformFillId);
    }
  }
  expect(ids.size).toBeGreaterThan(0);
});

test('a liquidation lands at or below the setpoint, and only on a protected account', () => {
  // STATE_MACHINES G-BREACH: the setpoint sits at the floor, "so a clean
  // liquidation lands exactly on it and survives, and slippage below it
  // breaches". The simulator models the vendor's trigger and decides nothing
  // about whether the day is a breach, which is M1's (SIMULATION_HARNESS
  // section 4).
  for (const day of everyDay) {
    if (day.liquidation === null) continue;
    const setpoint = day.account.riskMaxLossCents;
    expect(setpoint).not.toBeNull();
    if (setpoint === null) return;
    expect(day.liquidation.thresholdCents).toBe(setpoint);
    expect(day.liquidation.equityCents <= setpoint).toBe(true);
    expect(day.lowBalanceCents <= setpoint).toBe(true);
    expect(day.closingBalanceCents).toBe(day.liquidation.equityCents);
  }
});

test('an account with no readable setpoint is never liquidated', () => {
  // `V-M2-08`. This is GS-087's population half: an unprotected account can go
  // below where its floor would be with NO liquidation record, which is the
  // evidence AS-M2-03's behavioural fallback looks for. The simulator must be
  // able to produce it, so the assertion is that the model does not quietly
  // protect everyone.
  const unprotected = run.population.filter((account) => account.riskMaxLossCents === null);
  expect(unprotected.length).toBeGreaterThan(0);
  for (const day of everyDay) {
    if (day.account.riskMaxLossCents !== null) continue;
    expect(day.liquidation).toBeNull();
  }
});

test('the adjustment appears on exactly the account and day it was supplied for', () => {
  const supplied = CANONICAL_ADJUSTMENTS[0];
  expect(supplied).toBeDefined();
  if (supplied === undefined) return;
  const carrying = everyDay.filter((day) => day.adjustmentCents !== 0n);
  expect(carrying).toHaveLength(1);
  expect(carrying[0]?.account.platformAccountRef).toBe(supplied.platformAccountRef);
  expect(carrying[0]?.tradingDay).toBe(supplied.tradingDay);
  expect(carrying[0]?.adjustmentCents).toBe(supplied.cents);
  expect(carrying[0]?.adjustmentDescription).toBe(supplied.vendorDescription);
});

test('two adjustments for one account-day are refused rather than netted', () => {
  // INV-M2-12 refuses to guess, and netting two movements into one number is a
  // guess about which of them the parser is looking at (EC-051, GS-092).
  const input = canonicalInput();
  expect(() =>
    simulate({
      ...input,
      adjustments: [
        { ...CANONICAL_ADJUSTMENTS[0]!, cents: -1_000n },
        { ...CANONICAL_ADJUSTMENTS[0]!, cents: -2_000n },
      ],
    }),
  ).toThrow(SimulationError);
});

test('a duplicated session is refused', () => {
  const input = canonicalInput();
  expect(() =>
    simulate({ ...input, sessions: [CANONICAL_SESSIONS[0]!, CANONICAL_SESSIONS[0]!] }),
  ).toThrow(SimulationError);
});

test('a session that closes before it opens is refused rather than repaired', () => {
  const input = canonicalInput();
  expect(() =>
    simulate({
      ...input,
      sessions: [
        {
          tradingDay: '2026-11-02',
          sessionOpenUtc: '2026-11-02T20:00:00Z',
          sessionCloseUtc: '2026-11-02T13:30:00Z',
        },
      ],
    }),
  ).toThrow(SimulationError);
});
