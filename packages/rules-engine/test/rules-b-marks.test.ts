// =============================================================================
// GROUP B: MARKS. RE-U-007 to RE-U-011, and the group is complete.
// =============================================================================
// R-10 AND R-11 ARE THE TWO THAT USED TO BE MISSING, AND THEY ARE MISSING FOR
// DIFFERENT REASONS, WHICH IS WHY ONE OF THEM IS NOW DECLARED AND THE OTHER IS
// NOT. This header used to file them together as "the engine's half is INV-18's
// adjustment term" and "a query the engine never makes", which is right about
// R-11 and understates R-10.
//
// M01 section 3.1's DO-3 row cites BOTH R-07 AND R-10 against "assert INV-18,
// INV-19, INV-20", and the pair of identities is what discharges R-10: the
// adjustment appears on the OPENING side of INV-18 and does NOT appear in
// INV-19's closing identity at all. So a movement placed inside the session
// breaks `closing == opening + realized_pnl` and the day refuses. That is a
// check that fires, on the engine's own path, which is ADR-048's test for a
// declaration ("the engine COMPUTES it") and not merely a symbol existing.
//
// R-11 HAS NO SUCH CHECK AND CANNOT HAVE ONE. `DailyMark` carries no
// `supersededBy`, so the engine has no way to name a superseded mark, let alone
// refuse it. `superseded_by is null` is the CALLER's predicate and replay
// recomputing forward is the rest of it. RE-U-011 asserts that absence, which is
// RE-U-019's idiom: an absence is the one kind of rule a reader cannot check by
// finding the line.
// =============================================================================

import { expect, test } from 'vitest';

import { advanceDay } from '../src/day/advance.js';
import { isTradedDay, isWinDay } from '../src/day/counters.js';
import type { CalendarDay, DailyMark, DayOutput } from '../src/types.js';
import {
  ACCOUNT_OPENED_ON,
  CME_WINDOW,
  CORE_50K,
  ENGINE_VERSION,
  day,
  fundedPrior,
  mark,
} from './fixtures-in-code.js';
import { reU } from './rule-coverage.js';

const OPEN_SESSION: CalendarDay = {
  tradingDay: day('2026-11-03'),
  isHalfDay: false,
  halted: false,
  sequence: 4022,
};

/** A day folded with the mark stated field by field, so DO-3 can be broken on purpose. */
function foldRaw(fields: {
  readonly openingBalanceCents: bigint;
  readonly closingBalanceCents: bigint;
  readonly realizedPnlCents: bigint;
  readonly adjustmentCents?: bigint;
  readonly priorBalanceCents?: bigint;
  readonly tradedDaysCount?: number;
}): DayOutput {
  return advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, {
      balanceCents: fields.priorBalanceCents ?? 5_000_000n,
      tradedDaysCount: fields.tradedDaysCount ?? 1,
    }),
    mark: {
      tradingDay: day('2026-11-03'),
      openingBalanceCents: fields.openingBalanceCents,
      closingBalanceCents: fields.closingBalanceCents,
      highBalanceCents: 5_100_000n,
      lowBalanceCents: 4_900_000n,
      realizedPnlCents: fields.realizedPnlCents,
      adjustmentCents: fields.adjustmentCents ?? 0n,
      fillCount: 1,
      sourceHash: 'unit',
    },
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
}

// -----------------------------------------------------------------------------
// R-07  the mark identities, INV-18 with INV-19 and INV-20 beside it
// -----------------------------------------------------------------------------
test(reU('R-07'), () => {
  // EXACTLY EQUAL PASSES. prior 5,000,000 + adjustment 0 == opening 5,000,000,
  // and closing 5,020,000 == opening + realized 20,000.
  const clean = foldRaw({
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_020_000n,
    realizedPnlCents: 20_000n,
  });
  expect(clean.assertions).toEqual([]);

  // ONE CENT OFF REFUSES, AND DOES NOT THROW. No state is written for the day
  // and reconciliation is what the caller raises (FM-05, EC-047).
  const off = foldRaw({
    openingBalanceCents: 5_000_001n,
    closingBalanceCents: 5_020_001n,
    realizedPnlCents: 20_000n,
  });
  expect(off.assertions.map((a) => a.kind)).toEqual(['opening_mismatch']);
  expect(off.assertions[0]?.expected).toBe(5_000_000n);
  expect(off.assertions[0]?.got).toBe(5_000_001n);
  expect(off.events).toEqual([]);

  // THE ADJUSTMENT IS ON THE OPENING SIDE, which is the whole of AS-10's
  // counter: a settled 150,000c withdrawal lands at the open and the identity
  // holds through it rather than reading as a catastrophic trading loss.
  const withdrawn = foldRaw({
    priorBalanceCents: 5_200_000n,
    openingBalanceCents: 5_050_000n,
    closingBalanceCents: 5_050_000n,
    realizedPnlCents: 0n,
    adjustmentCents: -150_000n,
  });
  expect(withdrawn.assertions).toEqual([]);

  // INV-19, the closing identity, one cent off on the other term.
  const closingOff = foldRaw({
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_020_001n,
    realizedPnlCents: 20_000n,
  });
  expect(closingOff.assertions.map((a) => a.kind)).toEqual(['closing_mismatch']);

  // INV-20, and it fires only at the funded start: no traded day and no settled
  // payout. AS-14 is what it exists to refuse.
  const notAtSize = foldRaw({
    priorBalanceCents: 5_300_000n,
    openingBalanceCents: 5_300_000n,
    closingBalanceCents: 5_300_000n,
    realizedPnlCents: 0n,
    tradedDaysCount: 0,
  });
  expect(notAtSize.assertions.map((a) => a.kind)).toEqual(['funded_start_not_size']);

  // The same account one traded day later is past the boundary and the check no
  // longer applies, which is what "asserted at DO-3 on the transition boundary"
  // means.
  const pastBoundary = foldRaw({
    priorBalanceCents: 5_300_000n,
    openingBalanceCents: 5_300_000n,
    closingBalanceCents: 5_300_000n,
    realizedPnlCents: 0n,
    tradedDaysCount: 1,
  });
  expect(pastBoundary.assertions).toEqual([]);
});

// -----------------------------------------------------------------------------
// R-08  a traded day is `fill_count > 0`, STRICT
// -----------------------------------------------------------------------------
test(reU('R-08'), () => {
  expect(
    isTradedDay(
      mark({
        tradingDay: day('2026-11-03'),
        openingBalanceCents: 5_000_000n,
        realizedPnlCents: 0n,
        fillCount: 1,
      }),
    ),
  ).toBe(true);
  expect(
    isTradedDay(
      mark({
        tradingDay: day('2026-11-03'),
        openingBalanceCents: 5_000_000n,
        realizedPnlCents: 0n,
        fillCount: 0,
      }),
    ),
  ).toBe(false);

  // One fill with flat P&L is a traded day and not a win day, which is the pair
  // Appendix C names ("Fills but flat P&L is a traded day, not a win day").
  const out = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, { tradedDaysCount: 3, winDaysCount: 2 }),
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 0n,
      fillCount: 1,
    }),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(out.state.tradedDaysCount).toBe(4);
  expect(out.state.winDaysCount).toBe(2);
});

// -----------------------------------------------------------------------------
// R-09  a win day is `realized_pnl_cents >= win_day_floor_cents`
// -----------------------------------------------------------------------------
test(reU('R-09'), () => {
  const at = mark({
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 15_000n,
  });
  const below = mark({
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 14_999n,
  });

  // EXACTLY AT THE FLOOR COUNTS. The `>=` is published and pinned by GS-006 and
  // GS-007, and the floor at CORE-50K is 15,000c (30bp of 5,000,000c).
  expect(isWinDay(at, OPEN_SESSION, CORE_50K.funded.winDayFloorCents)).toBe(true);
  expect(isWinDay(below, OPEN_SESSION, CORE_50K.funded.winDayFloorCents)).toBe(false);
});

// -----------------------------------------------------------------------------
// R-10  the adjustment lands at the open and is absent from the closing identity
// -----------------------------------------------------------------------------
test(reU('R-10'), () => {
  // THE TWO IDENTITIES ARE THE RULE, AND THE SECOND ONE IS THE HALF THAT SAYS
  // "NEVER INSIDE A SESSION". INV-18 is `opening == prior.balance + adjustment`,
  // so the movement is IN the opening. INV-19 is `closing == opening +
  // realized_pnl`, with NO adjustment term, so the same movement counted inside
  // the session makes the day refuse rather than fold.
  //
  // The movement below is a settled CORE-50K payout at the full 150,000c cap
  // (Appendix A.1), negated, which is SD-01's own example: "a settled withdrawal
  // today, a promotional credit later".
  const withdrawal = -150_000n;

  // SIDE ONE: at the open. The opening balance is 150,000c below the prior
  // balance, the identity holds, and the day folds.
  //
  // THE MARK IS BUILT BY `mark()` RATHER THAN BY `foldRaw`, and the reason is
  // this test's own subject. `foldRaw` pins `lowBalanceCents` at a constant
  // 4,900,000c, which sits ABOVE an opening of 4,850,000c: a day whose low is
  // above its open is a day that cannot occur, and asserting "the extraction is
  // already behind the low" against one would be asserting it against a fixture
  // rather than against the rule. `mark()` derives the low from the open and the
  // close, so the day below is one an exchange could have produced.
  const atTheOpen = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: fundedPrior(CORE_50K, { balanceCents: 5_000_000n }),
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 4_850_000n,
      realizedPnlCents: 20_000n,
      adjustmentCents: withdrawal,
    }),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(atTheOpen.assertions).toEqual([]);
  expect(atTheOpen.state.balanceCents).toBe(4_870_000n);

  // SIDE TWO: inside the session. The same 150,000c, moved out of the opening
  // and into the day, is EXACTLY the shape INV-19 has no term for. The mark now
  // opens where the prior balance was and closes 150,000c lower than its own
  // realized P&L accounts for, and DO-3 refuses on both identities: the opening
  // is short of `prior + adjustment` and the closing is short of `opening +
  // realized_pnl`. This one is stated field by field on purpose, because a mark
  // whose identities hold cannot express it.
  const insideTheSession = foldRaw({
    priorBalanceCents: 5_000_000n,
    adjustmentCents: withdrawal,
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    closingBalanceCents: 4_870_000n,
  });
  expect(insideTheSession.assertions.map((a) => a.kind)).toEqual([
    'opening_mismatch',
    'closing_mismatch',
  ]);
  // NO STATE IS WRITTEN FOR THE DAY, which is what makes the refusal a control
  // rather than a log line (FM-05).
  expect(insideTheSession.state.balanceCents).toBe(5_000_000n);
  expect(insideTheSession.events).toEqual([]);

  // AND THIS IS AS-10's COUNTER, WHICH IS WHY THE PLACEMENT IS A MONEY RULE AND
  // NOT A BOOKKEEPING PREFERENCE. `lowBalanceCents` is the breach comparison
  // input (R-21). Because the movement lands at the OPEN, the low describes the
  // session and the extraction is already behind it: 4,850,000c against a floor
  // of 4,750,000c, so the account that earned the payout is not breached by
  // taking it (INV-21). Had the same 150,000c been an intraday move, the low
  // would have been 4,700,000c and the day would have breached.
  expect(atTheOpen.state.breached).toBe(false);
  expect(atTheOpen.state.floorOpenCents).toBe(4_750_000n);
  expect(4_850_000n - 150_000n).toBeLessThan(atTheOpen.state.floorOpenCents);
});

// -----------------------------------------------------------------------------
// R-11  the engine reads only live marks, by having no way to name a dead one
// -----------------------------------------------------------------------------
test(reU('R-11'), () => {
  // `superseded_by is null` IS A PREDICATE ON A QUERY THIS PACKAGE CANNOT MAKE.
  // The engine performs no I/O, so the live/superseded decision is made before
  // the fold and the assertion available here is that the decision cannot be
  // re-made or overridden inside it: `DailyMark` has no field naming a
  // supersession, so there is no branch for a superseded mark to take.
  // THE ASSERTION IS COMPILE-TIME, for the reason RE-U-001 states: a runtime
  // `Object.keys` check reads the FIXTURE, so a `supersededBy` added to
  // `DailyMark` and left unset by `mark()` would not show up in it. `Extract`
  // over `keyof DailyMark` resolves to `never` while no such field exists and to
  // the field's own name the moment one does, and `never` is the only thing
  // assignable to `never`.
  const noSupersessionField: Extract<keyof DailyMark, 'supersededBy' | 'superseded_by'>[] = [];
  expect(noSupersessionField).toEqual([]);

  const sample = mark({
    tradingDay: day('2026-11-03'),
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
  });
  expect(Object.keys(sample)).not.toContain('supersededBy');

  // WHAT THE MARK CARRIES INSTEAD IS `sourceHash`, AND THAT IS THE OTHER HALF OF
  // R-11 RATHER THAN A CONSOLATION. "A correction supersedes and REPLAY
  // RECOMPUTES FORWARD": the correction arrives as a different mark for the same
  // trading day, and what tells the two apart downstream is that their hashes
  // differ. The engine carries the hash through without interpreting it.
  expect(sample.sourceHash).toBe('unit');

  // AND THE FOLD CANNOT ABSORB A CORRECTION IN PLACE, WHICH IS WHAT MAKES
  // "RECOMPUTES FORWARD" THE ONLY AVAILABLE ROUTE. Applying a corrected mark for
  // a day the state already carries is DO-1's `not_forward` refusal (INV-14), so
  // a caller that tried to patch yesterday by re-folding it is refused and has
  // to replay from a prior state instead. The two marks below differ by 30,000c
  // of realized P&L and the second one changes nothing.
  const original = foldRaw({
    openingBalanceCents: 5_000_000n,
    realizedPnlCents: 20_000n,
    closingBalanceCents: 5_020_000n,
  });
  expect(original.assertions).toEqual([]);
  expect(original.state.tradingDay).toBe('2026-11-03');
  expect(original.state.balanceCents).toBe(5_020_000n);

  const correction = advanceDay({
    engineVersion: ENGINE_VERSION,
    plan: CORE_50K,
    prior: original.state,
    mark: mark({
      tradingDay: day('2026-11-03'),
      openingBalanceCents: 5_000_000n,
      realizedPnlCents: 50_000n,
    }),
    calendar: CME_WINDOW,
    settlements: [],
    openedOn: ACCOUNT_OPENED_ON,
  });
  expect(correction.assertions.map((a) => a.kind)).toEqual(['not_forward']);
  expect(correction.state.balanceCents).toBe(5_020_000n);
});
