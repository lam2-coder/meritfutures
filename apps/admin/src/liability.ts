// =============================================================================
// apps/admin/src/liability.ts
// =============================================================================
// THE THREE NUMBERS, AND THE ONE FUNCTION THAT PRODUCES THEM TOGETHER.
//
// AS-M6-04 is the whole of this file: "`open_liability = sum(withdrawable)` is
// the obvious definition and it is wrong in BOTH DIRECTIONS AT ONCE, which is
// why it feels right". It overstates immediate cash need, because a cap, one
// in-flight payout and a cadence gap stand between a withdrawable balance and
// a withdrawal. It understates total exposure, because the commitment is the
// whole remaining ladder rather than today's profit.
//
//   "Showing all three, labeled, is cheap. Showing one and calling it
//    'liability' is how the FTT quote happens."
//
// SO THERE IS NO EXPORTED FUNCTION THAT RETURNS ONE OF THEM. `theThreeNumbers`
// returns the triple or it throws, which is the structural reading of "three
// named numbers, NEVER ONE". A caller cannot reach for the convenient figure
// because there is no convenient figure to reach for, and every one of the
// three carries a definition that says what it is AND what it is not.
//
// -----------------------------------------------------------------------------
// THE COLUMN THIS FILE READS MOST CAREFULLY, AND WHY IT IS RENAMED ON ARRIVAL
// -----------------------------------------------------------------------------
// `0009` names its first column `open_liability_cents` and documents it as
// "the sum of withdrawable across funded accounts". It then carries
// `wallet_balances_cents` separately, "because ADR-019 made wallet balances
// part of Open Liability (INV-M5-15)".
//
// SO THE COLUMN CALLED `open_liability_cents` IS NOT THE PANEL CALLED OPEN
// LIABILITY. It is one of that panel's two components. P-M6-01 is explicit:
// "`sum(withdrawable_cents)` across funded accounts PLUS `sum(wallet_balance_cents)`
// across identities", and INV-M6-11 makes it not optional: "every liability
// figure includes wallet balances, and no panel reports a liability number that
// excludes them".
//
// A field named `openLiabilityCents` on the input record would put a reader one
// careless line from rendering a column as the panel that shares its name, and
// INV-M6-11 would be broken by a name rather than by a decision. The field is
// therefore `withdrawableAcrossFundedCents`, the mapping from the column is
// stated once at the call site that builds the row, and the sum happens here.
//
// -----------------------------------------------------------------------------
// ONE ORDERING IS DERIVABLE AND IT IS ASSERTED
// -----------------------------------------------------------------------------
// `min(withdrawable, cap) <= withdrawable` termwise, and the accounts eligible
// now or inside 7 trading days are a subset of the funded accounts, so
//
//   bounded near-term <= sum(withdrawable across funded)
//
// always. A row that violates it is a row where the wrong number was written to
// a column, which is the failure this whole module exists to catch, arriving
// one layer below the page. It is refused rather than rendered: a dashboard
// that renders an incoherent book is the confident wrong answer with a source
// citation attached.
//
// The other pair has NO ordering and none is asserted. GS-115's book is the
// counterexample: 500,000c open, 150,000c bounded, 900,000c remaining ladder.
// =============================================================================

import type { Cents } from '@merit/rules-engine';
import { type AsOf, type Reading, figure } from './figure.js';

/** Thrown when a snapshot row cannot be rendered as the three numbers. */
export class LiabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiabilityError';
  }
}

/**
 * One row of [`liability_snapshots`](packages/db/migrations/0009_ledger.sql),
 * with the column names mapped to what the columns MEAN.
 *
 * THE MIGRATION IS THE TRUTH and this record follows it rather than
 * DATA_MODEL section 8, per `OI-01` in the delta manifest: the two shapes
 * disagree, the manifest rules for the migration, and the earlier shape's
 * reserve and CVaR fields are the open half of that item.
 */
export interface LiabilitySnapshot {
  /** The row's own `as_of`, the last closed day. Every figure inherits it. */
  readonly asOf: AsOf;
  /**
   * `0009.open_liability_cents`. ONE COMPONENT OF P-M6-01, NOT THE PANEL.
   * See the header. Never negative: the engine's own property suite asserts
   * "no negative withdrawable ever".
   */
  readonly withdrawableAcrossFundedCents: Cents;
  /** `0009.wallet_balances_cents`. The other component. ADR-019, INV-M6-11. */
  readonly walletBalancesCents: Cents;
  /** `0009.bounded_near_term_cents`. P-M6-02. */
  readonly boundedNearTermCents: Cents;
  /** `0009.remaining_ladder_exposure_cents`. AS-M6-04's third number. */
  readonly remainingLadderExposureCents: Cents;
}

/**
 * The three, plus the two components P-M6-01 requires shown separately.
 *
 * Every member is a `Reading`, so nothing here can be rendered without its
 * definition, its as-of and its source (INV-M6-04).
 */
export interface ThreeNumbers {
  /** P-M6-01. The accounting claim, wallet balances included. */
  readonly openLiability: Reading;
  /** P-M6-02. The cash figure, and what the payout wallet is funded against. */
  readonly boundedNearTerm: Reading;
  /** AS-M6-04's third. The upper bound on lifetime commitment. */
  readonly remainingLadderExposure: Reading;
  /**
   * P-M6-01: "the two components are shown separately as well as summed,
   * because they behave differently".
   */
  readonly openLiabilityComponents: {
    /** A claim that still has to clear gates. */
    readonly withdrawable: Reading;
    /** A claim that has already cleared them all and is owed unconditionally. */
    readonly wallet: Reading;
  };
}

const SOURCE = 'liability_snapshots';

function requireNonNegative(cents: Cents, column: string): Cents {
  if (cents < 0n)
    throw new LiabilityError(
      `${column} is ${cents}, and a negative one is not a figure this page can define`,
    );
  return cents;
}

/**
 * Render one snapshot row as AS-M6-04's three numbers.
 *
 * It returns all three or it throws. There is deliberately no
 * `openLiability(row)`, no `boundedNearTerm(row)` and no third of them: a
 * function that returns one number is a function whose result gets called
 * "liability" by its caller.
 */
export function theThreeNumbers(snapshot: LiabilitySnapshot): ThreeNumbers {
  const withdrawable = requireNonNegative(
    snapshot.withdrawableAcrossFundedCents,
    '0009.open_liability_cents',
  );
  const wallet = requireNonNegative(snapshot.walletBalancesCents, '0009.wallet_balances_cents');
  const bounded = requireNonNegative(snapshot.boundedNearTermCents, '0009.bounded_near_term_cents');
  const ladder = requireNonNegative(
    snapshot.remainingLadderExposureCents,
    '0009.remaining_ladder_exposure_cents',
  );

  // The derivable ordering. See the header for the proof and for why the other
  // pair has none.
  if (bounded > withdrawable)
    throw new LiabilityError(
      `bounded near-term liability (${bounded}) exceeds the sum of withdrawable across funded ` +
        `accounts (${withdrawable}), which is impossible termwise: min(withdrawable, cap) <= ` +
        'withdrawable, and the eligible set is a subset of the funded set. The row is incoherent ' +
        'and AS-M6-04 is what happens when one is rendered anyway',
    );

  const asOf = snapshot.asOf;

  return {
    openLiability: figure({
      origin: 'P-M6-01',
      label: 'Open liability',
      definition:
        'sum(withdrawable) across funded accounts plus sum(wallet balances) across identities, ' +
        'as of the last closed day. The ACCOUNTING claim: what traders could claim if every gate ' +
        'vanished. It is NOT the near-term cash requirement, which is smaller, and NOT the ' +
        'lifetime commitment, which is larger',
      cents: withdrawable + wallet,
      asOf,
      authority: 'authoritative',
    }),

    boundedNearTerm: figure({
      origin: 'P-M6-02',
      label: 'Bounded near-term liability',
      definition:
        'sum(min(withdrawable, cap for the next ordinal)) across funded accounts eligible now or ' +
        'inside 7 trading days. The CASH figure: what can actually leave soon, and the number the ' +
        'payout wallet is funded against (ADR-011). It is NOT the accounting claim',
      cents: bounded,
      asOf,
      authority: 'authoritative',
    }),

    remainingLadderExposure: figure({
      origin: 'AS-M6-04',
      label: 'Remaining ladder exposure',
      definition:
        'sum((ladder - payouts settled) * cap) over funded accounts, read from each pinned plan ' +
        'version and never from a constant. The UPPER BOUND on lifetime commitment. It is NOT ' +
        'what is owed today and NOT what any wallet is funded against',
      cents: ladder,
      asOf,
      authority: 'authoritative',
    }),

    openLiabilityComponents: {
      withdrawable: figure({
        origin: 'P-M6-01',
        label: 'Open liability: withdrawable component',
        definition:
          'sum(withdrawable) across funded accounts. A claim that still has to clear a cap, a ' +
          'cadence gap and the in-flight rule before any of it can leave',
        cents: withdrawable,
        asOf,
        authority: 'authoritative',
      }),
      wallet: figure({
        origin: 'P-M6-01',
        label: 'Open liability: wallet component',
        definition:
          'sum(wallet balances) across identities (ADR-019, INV-M6-11). Money that has already ' +
          'cleared every gate and is owed unconditionally, which makes it the most certain ' +
          'liability on the book rather than the least',
        cents: wallet,
        asOf,
        authority: 'authoritative',
      }),
    },
  };
}

/**
 * The three, in the order AS-M6-04 lists them, for a renderer that iterates.
 *
 * The components are NOT in this list. They are P-M6-01's breakdown and a
 * reader who saw five rows under one heading would be reading a sum beside its
 * own parts with nothing saying which is which.
 */
export function inAdversarialOrder(three: ThreeNumbers): readonly Reading[] {
  return [three.openLiability, three.boundedNearTerm, three.remainingLadderExposure];
}
