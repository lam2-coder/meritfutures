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
// THE PANEL HAS THREE COMPONENTS AND NOT TWO, AND THE THIRD HAS NO COLUMN
// -----------------------------------------------------------------------------
// ADR-195 clause 1: the firm-scoped `withdrawals_in_flight` obligation is a
// TERM IN Open Liability rather than a figure beside it. INV-M6-15 is the rule
// that follows, and M06 amended P-M6-01 additively to carry it:
//
//   "Open Liability does not move when a wallet withdrawal is approved, and it
//    falls when that withdrawal's cash leaves."
//
// THE DEFECT IT REPAIRS IS IN THE TOTAL, WHICH IS WHY IT IS A TERM. Under a
// two-term panel `LT-06` moves only the wallet component, so the reported
// liability falls at the APPROVAL and does not move at the SETTLEMENT, and
// `LT-09`'s rail-exhausted reversal makes it RISE at a moment when nothing new
// is owed. Three wrong movements from one missing term, and no number placed
// next to a wrong sum makes it right.
//
// SO THE THIRD ADDEND IS IN `theThreeNumbers` AND THE OBLIGATION IS A
// MAGNITUDE. `posting.ts` makes a credit `-amountCents`, so a standing
// obligation of 25,000c is a ledger net of -25000 in `withdrawals_in_flight`;
// the panel term is 25000, on `wallet_balances_cents`' own precedent of a
// positive column for a liability whose ledger net is negative. A term written
// as the ledger net would SUBTRACT the obligation from a figure whose whole
// purpose is that it not fall wrongly (ADR-195 section 4).
//
// AND IT IS OPTIONAL, WHICH IS THE HONEST SHAPE RATHER THAN A CONVENIENCE.
// ADR-195 section 6 is the list of what that entry does NOT hold, and row 1 is
// the column: `0009_ledger.sql` plus `0049_reserve_coverage_snapshots.sql`'s
// `ALTER TABLE` give `liability_snapshots` `as_of`, `open_liability_cents`,
// `bounded_near_term_cents`, `remaining_ladder_exposure_cents`,
// `wallet_balances_cents`, `absorbed_corrections_cents`, `funded_accounts`,
// `id` and `computed_at`, and not one of them is this obligation. An unsupplied
// term renders ABSENT with that reason and the total says it is INCOMPLETE, on
// P-M6-03's own precedent one panel over: a zero would read as "nothing is in
// flight", which is a claim no row in this tree can support.
//
// THE ORDERING IS THE ONE SENTENCE THAT MAKES INCOMPLETE SAFE, AND IT WAS
// RE-DERIVED HERE RATHER THAN TAKEN. Nothing in this tree posts `LT-06`:
// `packages/ledger/src/reversal.ts` builds the posting privately to make
// `LT-09` its exact negation and says in terms that nothing posts it yet, and
// `apps/api/src/routes/wallet-withdrawals.ts` says so in its first heading. So
// the term is zero today and the panel is incomplete rather than wrong. It
// becomes wrong on the day the first writer of `LT-06` lands, which is why the
// column has to arrive before that writer does.
//
// WHAT THE THIRD TERM DOES NOT TOUCH IS THE FLOAT, AND THAT IS A CLAUSE RATHER
// THAN AN OVERSIGHT. ADR-195 clause 4 keeps the obligation out of P-M6-07's
// `floatCents`, which is read from `wallet_balances_cents` deliberately and is
// the same column P-M6-01's wallet component reads. An in-flight withdrawal is
// money already being withdrawn rather than float, and folding it into that
// column would make one quantity mean two different things in the two places
// this file reads it from. Whether it belongs in that panel's exposure
// DENOMINATOR is a second question and ADR-195 does not rule it.
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
import { type AsOf, type Reading, absent, figure } from './figure.ts';

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
  /**
   * The row's own `as_of`, the last closed day, UTC and ISO-8601. Every figure
   * this function builds inherits it.
   *
   * THE SOURCE IS NOT A FIELD HERE, WHICH IS THE POINT. INV-M6-04 requires a
   * figure to name what it was read from, and this function reads exactly one
   * table. A caller that could pass the source could mislabel the provenance of
   * a number it did not compute, so the source is a property of the function
   * and the instant is the only half the caller supplies.
   */
  readonly asOfInstant: string;
  /**
   * `0009.open_liability_cents`. ONE COMPONENT OF P-M6-01, NOT THE PANEL.
   * See the header. Never negative: the engine's own property suite asserts
   * "no negative withdrawable ever".
   */
  readonly withdrawableAcrossFundedCents: Cents;
  /** `0009.wallet_balances_cents`. The other component. ADR-019, INV-M6-11. */
  readonly walletBalancesCents: Cents;
  /**
   * P-M6-01's THIRD COMPONENT, AND THERE IS NO COLUMN BEHIND IT.
   *
   * The firm-scoped `withdrawals_in_flight` obligation, which is what
   * `amount_cents` becomes between `LT-06` and `LT-07` (ADR-187, `0056`).
   * ADR-195 clause 1 makes it a TERM in this panel and INV-M6-15 is the rule
   * that follows.
   *
   * A MAGNITUDE AND NEVER THE LEDGER NET. See the header: the ledger net of a
   * standing obligation is negative and a term written that way would subtract
   * it from the panel. `requireNonNegative` refuses the sign error rather than
   * rendering it.
   *
   * OPTIONAL BECAUSE NO SUPPLIER EXISTS, and undefined is not zero.
   * `liability_snapshots` has no column for it (ADR-195 section 6 row 1) and
   * `LiabilityResponse` has no field for it, so this record cannot pretend to
   * carry it. Absent renders the component with that reason and marks the total
   * incomplete; a zero would say the obligation was measured and found empty.
   *
   * IT CARRIES ITS OWN `source` AND THAT IS THE ONE PLACE THIS RECORD DEPARTS
   * FROM {@link LiabilitySnapshot.asOfInstant}'s RULE. The source is a property
   * of this function for every other figure here, because this function reads
   * exactly one table. This term is the figure that breaks that premise: no
   * column of `liability_snapshots` produces it, and ADR-195 clause 3 names TWO
   * producers without choosing between them, the `withdrawals_in_flight` ledger
   * balance and the sum of `amount_cents` over withdrawals standing at
   * `approved` or `transferring`. `WD-C1` in `0057` binds them on the terminal
   * set, so a divergence is confined to the open set, and INV-M6-04 requires
   * the reader be told which of the two they are looking at. The INSTANT is not
   * a member: ADR-195 clause 3 fixes it at the panel's own `as_of`, which is
   * the row's.
   */
  readonly withdrawalsInFlight?: {
    /** The obligation's magnitude at the row's `as_of`. Integer cents. */
    readonly cents: Cents;
    /** Which of ADR-195 clause 3's two producers this figure came from. */
    readonly source: string;
  };
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
    /**
     * ADR-195's third. A claim that has cleared every gate AND BEEN ACTED ON.
     *
     * Absent when the row carries no obligation, which is every row today: see
     * {@link LiabilitySnapshot.withdrawalsInFlightCents}.
     */
    readonly withdrawalsInFlight: Reading;
  };
}

/** The one table this file reads. INV-M6-04's `source`, for every figure below. */
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

  // ADR-195's third component. A magnitude, refused if it arrives as the ledger
  // net: the header states why the two differ by a sign and why only one of
  // them can be summed into this panel.
  const inFlight =
    snapshot.withdrawalsInFlight === undefined
      ? undefined
      : requireNonNegative(
          snapshot.withdrawalsInFlight.cents,
          'the withdrawals_in_flight obligation',
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

  const asOf: AsOf = { instant: snapshot.asOfInstant, source: SOURCE };

  return {
    openLiability: figure({
      origin: 'P-M6-01',
      label: 'Open liability',
      definition:
        'sum(withdrawable) across funded accounts plus sum(wallet balances) across identities, ' +
        'as of the last closed day. The ACCOUNTING claim: what traders could claim if every gate ' +
        'vanished. It is NOT the near-term cash requirement, which is smaller, and NOT the ' +
        'lifetime commitment, which is larger. THREE COMPONENTS AND NOT TWO (ADR-195): the ' +
        'firm-scoped withdrawals_in_flight obligation is summed here as well, so this total does ' +
        'not move when a wallet withdrawal is approved and falls when that withdrawal cash ' +
        'leaves (INV-M6-15)' +
        (inFlight === undefined
          ? '. THE THIRD COMPONENT IS UNSUPPLIED ON THIS ROW, so what is printed is the first ' +
            'two summed and it is INCOMPLETE rather than wrong: no column of liability_snapshots ' +
            'holds the obligation, and nothing in this tree posts LT-06 yet, so the term is zero ' +
            'today and this total starts understating on the day that stops being true'
          : ''),
      cents: withdrawable + wallet + (inFlight ?? 0n),
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
      withdrawalsInFlight:
        inFlight === undefined || snapshot.withdrawalsInFlight === undefined
          ? absent({
              origin: 'P-M6-01',
              label: 'Open liability: in-flight withdrawal component',
              definition:
                'the firm-scoped withdrawals_in_flight obligation, what amount_cents becomes ' +
                'between LT-06 and LT-07 (ADR-187, 0056). ADR-195 clause 1 makes it this panel ' +
                'THIRD COMPONENT rather than a figure beside the panel, because the defect a ' +
                'missing term produces is in the TOTAL',
              reason:
                'NO COLUMN, and no field on the wire either. ADR-195 section 6 row 1: ' +
                '0009_ledger.sql and 0049_reserve_coverage_snapshots.sql give ' +
                'liability_snapshots as_of, open_liability_cents, bounded_near_term_cents, ' +
                'remaining_ladder_exposure_cents, wallet_balances_cents, ' +
                'absorbed_corrections_cents, funded_accounts, id and computed_at, and not one ' +
                'of them is this obligation. Rendered absent rather than zero, because a zero ' +
                'says the obligation was measured and found empty. Nothing in this tree posts ' +
                'LT-06 yet, so the term is zero today and the panel is INCOMPLETE rather than ' +
                'wrong; the column has to land before the first writer of LT-06 does',
            })
          : figure({
              origin: 'P-M6-01',
              label: 'Open liability: in-flight withdrawal component',
              definition:
                'the firm-scoped withdrawals_in_flight obligation, what amount_cents becomes ' +
                'between LT-06 and LT-07 (ADR-187, 0056, INV-M6-15). A claim that has cleared ' +
                'every gate AND BEEN ACTED ON, and the only component of this panel with TWO ' +
                'EXITS: LT-07 out as cash, which is the one external-leg posting that moves ' +
                'this total, or LT-09 back into the wallet component, which moves the total not ' +
                'at all. It is a MAGNITUDE and not the ledger net, and it is NOT money already ' +
                'gone',
              cents: inFlight,
              asOf: { instant: snapshot.asOfInstant, source: snapshot.withdrawalsInFlight.source },
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

// =============================================================================
// P-M6-07: RESERVE COVERAGE, AND THE FLOAT THAT SITS BESIDE IT
// =============================================================================
// ONE SENTENCE IS THE WHOLE OF THIS HALF AND IT IS EASY TO GET BACKWARDS:
// FLOAT ENTERS THE DENOMINATOR AS EXPOSURE AND NEVER THE NUMERATOR AS RESERVE.
//
// The three sources do not read the same way at a glance, which is why P5
// section 5.3 wrote the resolution down rather than leaving it to be discovered
// inside a dashboard diff:
//
//   M05 INV-M5-15   wallet balances are "included in Open Liability AND IN THE
//                   RESERVE COVERAGE RATIO". It does not say which side, and it
//                   is the sentence a reader meets first
//   M06 P-M6-07     "The DENOMINATOR now includes wallet balances"
//   M20 INV-M20-08  wallet balances "are NEVER counted toward reserve", and the
//                   RCR is "computed from RESERVE ALONE"
//
// They agree and the resolution is P-M6-07's. AS-M20-08 is the misreading
// itself: "the ratio flatters itself with the same money on both sides, and the
// breaker stops meaning anything at exactly the moment it matters". GS-229 is
// the registered scenario. DEP-M20-06 is the dependency stated from M20's end,
// and its failure column reads "the breaker at 1.0 becomes fictional".
//
// -----------------------------------------------------------------------------
// SO THE NUMERATOR IS A PARAMETER AND THE FLOAT IS A DIFFERENT PARAMETER, AND
// NOTHING IN THIS FILE ADDS THEM
// -----------------------------------------------------------------------------
// There is no field, no argument and no local that holds `reserve + float`
// except the one inside `assertRatioIsFromReserveAlone`, which exists to REFUSE
// it. `theThreeNumbers` is built on the same principle one panel over: a
// convenient figure a caller could reach for is a figure a caller will reach
// for, so it is not offered.
//
// -----------------------------------------------------------------------------
// THE RATIO IS READ AND NOT RECOMPUTED, AND THE RECOMPUTATION IS AN ASSERTION
// -----------------------------------------------------------------------------
// `0049_reserve_coverage_snapshots.sql` makes `rcr_bp` a GENERATED column, and
// its header states why in the founder-read list: "A ratio the database
// computes cannot disagree with its own inputs". Recomputing it here would put
// the drift back that the generated column removes, so the stored value is what
// renders.
//
// The recomputation still happens, ONCE, as a coherence check rather than as
// the figure. It is integer `bigint` arithmetic and it reproduces Postgres
// exactly: `(reserve_cents * 10000) / NULLIF(cvar99_cents, 0)`, where both
// Postgres integer division and BigInt division truncate toward zero and the
// CHECK constraint `reserve_coverage_snapshots_cvar99_is_positive` makes the
// denominator positive. THAT CHECK IS WHAT CATCHES THE DEFECT THIS PANEL EXISTS
// TO REFUSE, in both of the shapes it takes: a caller that hands a numerator
// with float folded into it disagrees with a ratio the database computed from
// reserve alone, and a caller that recomputed the ratio from float plus reserve
// disagrees with the reserve stored beside it. Either way the row is refused
// rather than rendered.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT COMPUTED HERE, AND WHY THAT IS NOT A GAP TO BE FILLED WITH A ZERO
// -----------------------------------------------------------------------------
// P-M6-07 asks for a SECOND ratio beside the first: "coverage against near-term
// external withdrawal demand rather than against total wallet liability. The
// two diverge exactly when the wallet is doing its job". M20 section 8 says
// that if only one number could be shown it would be that one, because it is
// "the only number that answers what happens if the wallet's convenience is
// tested all at once". NOTHING IN THIS TREE PRODUCES IT: the demand projection
// has no table, and `GET /admin/wallet/reconciliation` (M20's own float
// position for M06) is registered by no route module. It is rendered ABSENT
// with that reason, because a float coverage of zero reads as "no float is
// withdrawable" and a float coverage of 100 percent reads as "all of it is".
// =============================================================================

/**
 * `treasury_balances.source`, transcribed from `0009_ledger.sql`'s CHECK.
 *
 * IT IS TWO NAMES AND NOT A BOOLEAN, because P-M6-07 asks for "attestation
 * staleness shown WHEN the balance is a manual attestation" and a boolean named
 * `isManual` would invite a third source to arrive as `false`.
 */
export type TreasurySource = 'provider_api' | 'manual_attestation';

/** {@link TreasurySource} as data, for the refusal below and for the suite. */
export const TREASURY_SOURCES = [
  'provider_api',
  'manual_attestation',
] as const satisfies readonly TreasurySource[];

/**
 * Narrow a `treasury_balances.source` to the two names `0009` closes it at.
 *
 * REFUSED RATHER THAN DEFAULTED, on
 * [`roles.ts`](apps/admin/src/roles.ts)'s reasoning applied to a column instead
 * of to a role: a third name that quietly rendered as "provider API" would put
 * the words "not a manual attestation" under a figure nobody can classify, and
 * P-M6-07's whole attestation clause is about knowing which of the two it is.
 */
export function requireTreasurySource(value: string): TreasurySource {
  const found = TREASURY_SOURCES.find((name) => name === value);
  if (found === undefined)
    throw new LiabilityError(
      `${JSON.stringify(value)} is not a treasury_balances.source. 0009_ledger.sql closes that ` +
        "column at 'provider_api' and 'manual_attestation', and P-M6-07 shows attestation " +
        'staleness only when the balance is the second, so a name outside the two makes the ' +
        'staleness clause unanswerable rather than merely unfamiliar',
    );
  return found;
}

/**
 * One row of
 * [`reserve_coverage_snapshots`](packages/db/migrations/0049_reserve_coverage_snapshots.sql),
 * with the column names mapped to what the columns MEAN, on
 * {@link LiabilitySnapshot}'s own precedent.
 *
 * THE TABLE IS NOT `liability_snapshots` AND THAT SEPARATION IS A RULING.
 * `0049` gives three reasons in its order of weight, and the second is the one
 * a renderer feels: coverage is the rail's clock (`SD-M5-03`) against ours, so
 * one `as_of` forced onto both would date two figures that do not move
 * together. This record therefore carries its OWN `as_of` and never borrows the
 * liability snapshot's.
 */
export interface ReserveCoverageSnapshot {
  /** `0049.as_of`. The instant the coverage figure describes. UTC, ISO-8601. */
  readonly asOfInstant: string;
  /**
   * `0049.reserve_cents`. THE NUMERATOR, AND IT IS THE RAIL'S REPORTED BALANCE.
   *
   * `INV-M5-11`: reported against a LIVE balance and never one derived from our
   * own ledger, "because a reserve coverage ratio computed from the book it is
   * meant to cover is a number that agrees with itself". `RESERVE-C1` asserts
   * at write time that this copy IS the `treasury_balances` row named below.
   *
   * WALLET BALANCES ARE NOT IN IT. That is `INV-M20-08` and it is the whole
   * point of the panel.
   */
  readonly reserveCents: Cents;
  /**
   * `0049.cvar99_cents`. THE DENOMINATOR, AND IT IS THE FLOOR RATHER THAN THE
   * CENTRAL ESTIMATE.
   *
   * `CVaR99 at rho = 0.30` (P-M6-07, DEP-M6-05). `ADR-019` put wallet balances
   * INSIDE it (GS-130), which is the half of section 5.3 that is easy to lose:
   * the float is already exposure in this number, so a renderer that added the
   * float to the denominator would count it twice, and one that added it to the
   * numerator would cancel it out.
   */
  readonly cvar99Cents: Cents;
  /**
   * `0049.rcr_bp`. GENERATED BY THE DATABASE, integer basis points.
   *
   * Read, never recomputed. See the header. `bigint` rather than `number`
   * because the coherence assertion divides `bigint` cents and mixing the two
   * numeric types is a cast this file will not write.
   */
  readonly rcrBp: bigint;
  /**
   * `0049.treasury_account_code` and `0049.treasury_as_of`, plus the anchor
   * row's own `source`.
   *
   * P-M6-07 requires "attestation staleness shown when the balance is a manual
   * attestation", and `0049` deliberately stores a REFERENCE rather than a copy
   * of the anchor's fields so that the answer is one join away instead of two
   * more columns that can disagree with their source (`ADR-047`). The join has
   * been done by whoever built this record; the `source` arrives here because
   * the panel cannot ask the database.
   */
  readonly anchor: {
    readonly accountCode: string;
    /** `treasury_balances.as_of` for the anchored row. UTC, ISO-8601. */
    readonly asOfInstant: string;
    /**
     * `treasury_balances.source`, AS TEXT AND NOT AS THE CLOSED UNION.
     *
     * It crosses a boundary with the database, which hands over a string.
     * Typing it as {@link TreasurySource} at the port would move the refusal to
     * a cast somebody writes once and nobody watches, which is the reason
     * [`admin-reads.ts`](apps/api/src/routes/admin-reads.ts) takes an operator
     * role as a `string` and refuses it here rather than there.
     */
    readonly source: string;
  };
}

/** The one table the coverage figures are read from. `INV-M6-04`'s `source`. */
const COVERAGE_SOURCE = 'reserve_coverage_snapshots';

/**
 * The breaker threshold, in integer basis points.
 *
 * GLOSSARY: `reserve / CVaR99 at rho = 0.30`, and "Below 1.0, the circuit
 * breaker pauses new sales. It never pauses payouts." 1.0 is 10,000bp.
 *
 * `0049` DELIBERATELY DOES NOT STORE `breaker_armed` and says so: "Armed is
 * `rcr_bp < 10000`, a rendering of a stored number against a threshold the
 * GLOSSARY fixes at 1.0, and storing it would recreate in one column exactly
 * the drift item 1 removes from another". So the arming is computed here, which
 * is where the rendering happens, and it is computed from the STORED ratio.
 */
export const RCR_BREAKER_BP = 10_000n;

/**
 * Integer basis points as a ratio string, by `bigint` division.
 *
 * `formatCents`' argument one file over, applied to the other unit on this
 * page: `Number(bp) / 10000` is the float that reaches the one number that
 * decides whether sales pause.
 */
export function formatRatioBp(bp: bigint): string {
  const negative = bp < 0n;
  const magnitude = negative ? -bp : bp;
  const whole = magnitude / RCR_BREAKER_BP;
  const part = magnitude % RCR_BREAKER_BP;
  return `${negative ? '-' : ''}${whole}.${part.toString().padStart(4, '0')}`;
}

/**
 * THE REFUSAL SECTION 5.3 EXISTS FOR, and it is arithmetic rather than a
 * comment.
 *
 * The stored ratio is re-derived from the stored numerator and denominator and
 * compared. A disagreement is one of exactly two defects and the message names
 * both, because the reader has to know which way round it went:
 *
 *   - the numerator handed to this panel has the float folded into it, and the
 *     stored ratio was generated from reserve alone; or
 *   - the ratio was recomputed somewhere from float plus reserve, and the
 *     reserve stored beside it is the real one.
 *
 * Either way the ratio on the page would not be the ratio the breaker reads.
 */
function assertRatioIsFromReserveAlone(coverage: ReserveCoverageSnapshot): bigint {
  if (coverage.cvar99Cents <= 0n)
    throw new LiabilityError(
      `0049.cvar99_cents is ${coverage.cvar99Cents}, and a coverage ratio over a non-positive ` +
        'denominator is not a coverage of infinity, it is a CVaR99 nobody computed. ' +
        'reserve_coverage_snapshots_cvar99_is_positive refuses the row at the database and this ' +
        'page refuses to render one that reached it anyway',
    );
  requireNonNegative(coverage.reserveCents, '0049.reserve_cents');

  // Postgres: (reserve_cents * 10000) / NULLIF(cvar99_cents, 0). Integer
  // division in both languages truncates toward zero, and both operands are
  // non-negative here, so this reproduces the generated column exactly.
  const derived = (coverage.reserveCents * RCR_BREAKER_BP) / coverage.cvar99Cents;
  if (derived !== coverage.rcrBp)
    throw new LiabilityError(
      `0049.rcr_bp is ${coverage.rcrBp} and reserve_cents ${coverage.reserveCents} over ` +
        `cvar99_cents ${coverage.cvar99Cents} is ${derived}. The stored ratio and the numerator ` +
        'stored beside it disagree, which is one of two things and both are AS-M20-08: either ' +
        'the numerator reaching this page has the wallet float folded into it, or the ratio was ' +
        'recomputed from float plus reserve. The RCR is computed from RESERVE ALONE ' +
        '(INV-M20-08, P-M6-07, DEP-M20-06), and a ratio that flatters itself with the same ' +
        'money on both sides is the breaker at 1.0 becoming fictional',
    );
  return derived;
}

/** P-M6-07's panel, with float rendered beside reserve and never inside it. */
export interface ReserveCoverage {
  /** The numerator, as its own visible figure. */
  readonly reserve: Reading;
  /** The denominator, as its own visible figure. The float is already in it. */
  readonly cvar99: Reading;
  /**
   * THE FLOAT, AS A SEPARATE FIGURE. `INV-M20-08`, `DEP-M20-06`. It is a member
   * of this panel so that a renderer cannot show the ratio without it, and it
   * is never a term of the ratio.
   */
  readonly walletFloat: Reading;
  /**
   * `AS-M20-08` counter 3 and M20 section 8's "if only one number could be
   * shown". Absent: nothing in this tree produces it. See the header.
   */
  readonly floatCoverage: Reading;
  /** The stored, database-generated ratio. Integer basis points. */
  readonly ratioBp: bigint;
  /** `ratioBp < 10000`. Computed here because `0049` deliberately stores it nowhere. */
  readonly breakerArmed: boolean;
  /** The ratio's own line, with the unit, the definition and the provenance. */
  readonly ratioLine: string;
  /** P-M6-07's attestation half, stated for both sources rather than only one. */
  readonly attestationLine: string;
}

/**
 * Render `reserve_coverage_snapshots`' latest row as P-M6-07's panel.
 *
 * `floatCents` IS A SEPARATE PARAMETER AND IT IS THE SAME COLUMN P-M6-01'S
 * WALLET COMPONENT READS, `0009.wallet_balances_cents`. One quantity read from
 * one column and shown in two places is a quantity that cannot drift between
 * them; two suppliers for "the float" is how the liability panel and the
 * coverage panel come to disagree about the same money on the same screen.
 *
 * That the same number appears in both panels is the point rather than a
 * duplication: in P-M6-01 it is a LIABILITY component and in P-M6-07 it is
 * EXPOSURE already inside the denominator, and in neither is it reserve.
 */
export function reserveCoverage(input: {
  readonly coverage: ReserveCoverageSnapshot;
  /** `0009.wallet_balances_cents`. The float. */
  readonly floatCents: Cents;
  /** The liability snapshot's `as_of`, which is where the float was read. */
  readonly floatAsOfInstant: string;
}): ReserveCoverage {
  const { coverage } = input;
  const anchorSource = requireTreasurySource(coverage.anchor.source);
  const ratioBp = assertRatioIsFromReserveAlone(coverage);
  const floatCents = requireNonNegative(input.floatCents, '0009.wallet_balances_cents');

  const asOf: AsOf = { instant: coverage.asOfInstant, source: COVERAGE_SOURCE };
  const breakerArmed = ratioBp < RCR_BREAKER_BP;

  return {
    reserve: figure({
      origin: 'P-M6-07',
      label: 'Reserve, the RCR numerator',
      definition:
        'the payout rail reported balance, copied from the treasury_balances row this snapshot ' +
        'names and asserted equal to it at write time (RESERVE-C1, INV-M5-11). It is the ' +
        'NUMERATOR and it is reserve ALONE: wallet balances are never counted toward it ' +
        '(INV-M20-08). It is NOT the float and NOT a number derived from Merit own ledger',
      cents: coverage.reserveCents,
      asOf,
      authority: 'authoritative',
    }),

    cvar99: figure({
      origin: 'P-M6-07',
      label: 'CVaR99 at rho = 0.30, the RCR denominator',
      definition:
        'the reserve FLOOR and never the simulation harness central estimate (P-M6-07, ' +
        'DEP-M6-05). Wallet balances are already INSIDE this figure (ADR-019, GS-130), which is ' +
        'the sense in which the float is counted: as exposure in the denominator, never as ' +
        'reserve in the numerator',
      cents: coverage.cvar99Cents,
      asOf,
      authority: 'authoritative',
    }),

    walletFloat: figure({
      origin: 'P-M6-07',
      label: 'Wallet float, reported separately',
      definition:
        'total wallet balances across identities, the same 0009.wallet_balances_cents column ' +
        'the open liability wallet component reads. Shown here as a SEPARATE FIGURE because ' +
        'INV-M20-08 requires the float segregated in reporting and in fact, and because it is ' +
        'the most stable part of the book and therefore the most tempting to treat as working ' +
        'capital (FM-M20-09). IT IS NOT RESERVE AND IT IS NOT ADDED TO RESERVE ANYWHERE ON ' +
        'THIS PAGE',
      cents: floatCents,
      asOf: { instant: input.floatAsOfInstant, source: 'liability_snapshots' },
      authority: 'authoritative',
    }),

    floatCoverage: absent({
      origin: 'P-M6-07',
      label: 'Float coverage: withdrawable today if every eligible trader asked',
      definition:
        'P-M6-07 second ratio, coverage against near-term EXTERNAL withdrawal demand rather ' +
        'than against total wallet liability. The two diverge exactly when the wallet is doing ' +
        'its job, and M20 section 8 says that if only one number could be shown it would be ' +
        'this one, because it is the only number that answers what happens if the wallet ' +
        'convenience is tested all at once',
      reason:
        'no supplier. The near-term external withdrawal demand projection has no table in the ' +
        'migrations, and GET /admin/wallet/reconciliation, which M20 section 8 makes the owner ' +
        'of the float position for M06, is registered by no route module in this tree. Rendered ' +
        'absent rather than as a percentage, because a zero here reads as "none of the float is ' +
        'withdrawable" and a hundred reads as "all of it is"',
    }),

    ratioBp,
    breakerArmed,

    ratioLine:
      `Reserve coverage ratio: ${ratioBp} bp (${formatRatioBp(ratioBp)}x) ` +
      '[reserve / CVaR99 at rho = 0.30, computed from RESERVE ALONE. The wallet float is ' +
      'exposure inside the denominator and is never reserve in the numerator (P-M6-07, ' +
      'INV-M20-08, AS-M20-08, GS-229)] ' +
      `(as of ${coverage.asOfInstant}, source ${COVERAGE_SOURCE}.rcr_bp, GENERATED by the ` +
      'database and read rather than recomputed) ' +
      `breaker: ${breakerArmed ? 'ARMED' : 'not armed'} at ${RCR_BREAKER_BP} bp, which pauses ` +
      'NEW SALES and never pauses payouts (GLOSSARY)',

    attestationLine:
      anchorSource === 'manual_attestation'
        ? `Reserve anchor: MANUAL ATTESTATION on treasury_balances ${coverage.anchor.accountCode} ` +
          `as of ${coverage.anchor.asOfInstant}. P-M6-07 requires the attestation staleness shown ` +
          'when the balance is a manual attestation, and this numerator is a human statement ' +
          'rather than a provider reading'
        : `Reserve anchor: provider API on treasury_balances ${coverage.anchor.accountCode} ` +
          `as of ${coverage.anchor.asOfInstant}. Not a manual attestation, so P-M6-07 ` +
          'attestation staleness does not apply to this row',
  };
}
