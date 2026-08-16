// =============================================================================
// packages/rithmic/src/simulator/types.ts
// =============================================================================
// THE SIMULATOR'S INPUTS ARE ALL CALLER-SUPPLIED, AND THE LIST OF THINGS IT
// REFUSES TO KNOW IS THE INTERESTING HALF OF THIS FILE.
//
//   it does not know     a plan config, a floor, a drawdown type, a win-day
//                        threshold, a trading calendar, a contract spec, or
//                        what a breach is
//   it is TOLD           account sizes, the risk setpoint, session boundaries,
//                        symbols and their tick values, and every non-trading
//                        balance movement
//
// Three separate rules land on that split and they all point the same way.
//
//   1. M02 section 1.2: "M2 PUSHES a floor value to the vendor as a risk
//      setting. It is TOLD the number; it never derives it." The simulator is
//      the far side of that push, so it is told the number too.
//   2. STATE's standing parameter ruling: plan parameters are launch
//      candidates and are "rows in `plan_version_sizes`, never constants". A
//      simulator with `50_000_00` in it has made one a constant.
//   3. SIMULATION_HARNESS section 4: the harness "may not contain a single line
//      that decides a gate, a breach, an eligibility, or a payout amount". The
//      auto-liquidation this file models is a VENDOR behaviour against a
//      setpoint it was handed, which is the one thing on that list Merit does
//      not decide.
//
// PROVISIONAL THROUGHOUT (ADR-005). Every field whose shape the vendor call
// could move carries its `V-M2-nn` in a comment. `assumptions.ts` is the
// machine-readable form of those comments and `vendor-assumptions.test.ts`
// closes the loop between the two, so the comment list cannot drift from the
// table the call is run against.
// =============================================================================

/** `yyyy-mm-dd`. The vendor's session date and ours are both spelled this way. */
export type TradingDay = string;

/** Integer cents. `bigint`, matching `Cents` in the engine (M01 section 2.1, INV-02). */
export type Cents = bigint;

/**
 * One session of the exchange calendar, SUPPLIED BY THE CALLER.
 *
 * There is not one calendar row in this repository (P2 section 6) and the CME
 * publication has not been transcribed, so the simulator takes its sessions as
 * data exactly as ADR-049 makes the engine take its `CalendarSlice` as data. A
 * caller's window is a caller's fiction until the transcription lands, and a
 * fiction stated in a test file is honest in a way a constant in `src/` is not.
 *
 * `V-M2-02`: that the vendor states a session date at all, and therefore that
 * `session_date` on the report is comparable against this day, is the
 * assumption SD-M2-04 exists to keep checkable.
 */
export interface SimSession {
  readonly tradingDay: TradingDay;
  /** `yyyy-mm-ddThh:mm:ssZ`. Fills land inside `[open, close)`. */
  readonly sessionOpenUtc: string;
  readonly sessionCloseUtc: string;
}

/**
 * A traded instrument, SUPPLIED BY THE CALLER (DEP-M2-04, FM-M2-14).
 *
 * The normalizer refuses a fill whose symbol has no `contract_specs` row
 * effective on the trading day, so the simulator must not invent multipliers
 * either: a simulator carrying its own idea of a tick value is a second source
 * of truth for the number every P&L on the account is computed from.
 *
 * `V-M2-01`: prices are rendered as DECIMAL strings with `priceDecimals`
 * places. An instrument quoted in thirty-seconds (Treasury futures) does not
 * render this way and would need a second rendering; nothing in v1's synthetic
 * population is quoted that way and the real field list is what the call
 * settles.
 */
export interface ContractSpec {
  readonly symbol: string;
  /** Exchange MIC, which is `fills.venue` (0013). */
  readonly exchangeMic: string;
  readonly priceDecimals: number;
  /** Price in units of `10^-priceDecimals`. Integer, never a float. */
  readonly referencePriceNumerator: number;
  /** One tick, in the same units. */
  readonly tickNumerator: number;
  /** What one tick is worth on one contract. The multiplier, already in cents. */
  readonly tickValueCents: Cents;
}

/** An account-size band the population draws from. Caller-supplied, never a constant here. */
export interface AccountSizeBand {
  readonly label: string;
  readonly sizeCents: Cents;
  /** Relative weight. Any positive integers; they are summed, not required to total anything. */
  readonly weight: number;
}

/** The behavioural draws, all stated as caller-supplied inclusive integer ranges. */
export interface PopulationBehaviour {
  /** Probability, in basis points, that an account trades on any given session. */
  readonly tradeRateBasisPoints: { readonly min: number; readonly max: number };
  /** Upper bound on round trips in one session. */
  readonly tradesPerDayMax: { readonly min: number; readonly max: number };
  /** Upper bound on contracts per round trip. */
  readonly quantityMax: { readonly min: number; readonly max: number };
  /** Signed per-trade drift in ticks. Negative is the ordinary case (costs). */
  readonly driftTicks: { readonly min: number; readonly max: number };
  /** Per-trade dispersion in ticks. Positive. */
  readonly volatilityTicks: { readonly min: number; readonly max: number };
  /**
   * How far past the setpoint an auto-liquidation comes to rest, in ticks.
   *
   * STATE_MACHINES G-BREACH: "the setpoint sits at that same floor, so a CLEAN
   * LIQUIDATION LANDS EXACTLY ON IT AND SURVIVES, and slippage below it
   * breaches." A population whose slippage range is `0..0` therefore produces
   * liquidations that never breach, and one with a wide range produces the
   * breach path. It is a caller knob because which of those a run wants is a
   * scenario's decision.
   */
  readonly liquidationSlippageTicks: { readonly min: number; readonly max: number };
}

/**
 * How a seeded population is built. Every number is the caller's.
 *
 * `V-M2-10`: `firstRefOrdinal` exists because a platform account ref is
 * PERMANENTLY BURNED (SD-M2-02, INV-M2-10, AS-M2-05). A second population built
 * for a later scenario starts at an ordinal past the first one's, so no two
 * synthetic accounts ever share a ref, and the fixture cannot teach the ingest
 * path a habit the schema forbids.
 */
export interface PopulationSpec {
  readonly seed: string;
  readonly accountCount: number;
  readonly sizes: readonly AccountSizeBand[];
  readonly symbols: readonly ContractSpec[];
  readonly accountRefPrefix: string;
  readonly userRefPrefix: string;
  readonly firstRefOrdinal: number;
  /**
   * How far below the account's starting balance the auto-liquidation setpoint
   * sits. THE CALLER'S NUMBER. The simulator never computes a floor.
   */
  readonly riskMaxLossOffsetCents: Cents;
  /**
   * The share of accounts provisioned with NO readable setpoint, in basis
   * points. `V-M2-08`: where the vendor exposes neither the current risk
   * setting nor a liquidation record, an unprotected account is
   * indistinguishable from a protected one that never approached its floor.
   * This is the population half of GS-087, and it is a knob rather than a
   * constant because AS-M2-03's residual is a number the founder may want to
   * set to zero for some runs and high for others.
   */
  readonly unprotectedShareBasisPoints: number;
  readonly behaviour: PopulationBehaviour;
}

/** One synthetic account. Everything here was drawn from the seed or handed in. */
export interface SimAccount {
  readonly index: number;
  /** `V-M2-10`. Unique, monotone, never reissued. */
  readonly platformAccountRef: string;
  /** `V-M2-09`. Rithmic bills per login-month per USER, which is SD-M2-05's whole point. */
  readonly platformUserRef: string;
  readonly sizeLabel: string;
  readonly sizeCents: Cents;
  /** INV-M2-07: a funded account's first mark opens at exactly `size_cents`. */
  readonly startingBalanceCents: Cents;
  /**
   * The setpoint the platform was told to enforce, or null for an account whose
   * setting is unreadable or was never applied. `V-M2-08`.
   */
  readonly riskMaxLossCents: Cents | null;
  readonly tradeRateBasisPoints: number;
  readonly tradesPerDayMax: number;
  readonly quantityMax: number;
  readonly driftTicks: number;
  readonly volatilityTicks: number;
  readonly liquidationSlippageTicks: number;
}

/**
 * A non-trading balance movement, SUPPLIED BY THE CALLER.
 *
 * It is not drawn, and that is INV-M2-12 read from the vendor's side: a
 * withdrawal that appears in the platform balance originates in M5, and the
 * normalizer classifies every balance delta as trading or non-trading and
 * REFUSES TO GUESS. A simulator that invented its own payouts would be feeding
 * the pipeline movements Merit has no settlement record for, which is the
 * quarantine case (GS-092, EC-051) presented as the normal one.
 *
 * A caller wanting the quarantine case supplies one of these and tells Merit
 * nothing about it. That is a scenario's decision, not the simulator's.
 *
 * `V-M2-05`, the second-highest risk in the corpus: the movement is applied
 * BETWEEN sessions, at the open of `tradingDay` (SD-01, R-10). If the vendor
 * applies non-trading movements intraday, `daily_marks` needs an adjustment
 * timestamp and M01's breach comparison changes shape, and this type gains a
 * field rather than the model gaining a caveat.
 */
export interface BalanceAdjustment {
  readonly platformAccountRef: string;
  readonly tradingDay: TradingDay;
  /** Signed. A settled withdrawal is negative. */
  readonly cents: Cents;
  /** The vendor's own words for it, verbatim into the report's classification column. */
  readonly vendorDescription: string;
}

/** One leg of a round trip, as the vendor would report it. */
export interface SimFill {
  readonly platformAccountRef: string;
  readonly platformUserRef: string;
  readonly tradingDay: TradingDay;
  /** `fills.platform_fill_id` (0013). Unique per platform. */
  readonly platformFillId: string;
  /** `fills.order_id`. */
  readonly orderId: string;
  readonly symbol: string;
  /** `fills.venue`, the exchange MIC. */
  readonly exchangeMic: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: number;
  /** `fills.price_numerator` / `price_denominator`. Exact rational, never a float. */
  readonly priceNumerator: number;
  readonly priceDenominator: number;
  readonly executedAtUtc: string;
  /** `fills.correction_of`. Always null in file mode; corrections are a later session's. */
  readonly correctsPlatformFillId: string | null;
  readonly leg: 'entry' | 'exit';
  readonly tradeSequence: number;
}

/** A round trip, entry to exit, with the excursion the equity path took between them. */
export interface SimTrade {
  readonly sequence: number;
  readonly symbol: string;
  readonly quantity: number;
  readonly direction: 'long' | 'short';
  readonly entryPriceNumerator: number;
  readonly exitPriceNumerator: number;
  readonly entryAtUtc: string;
  readonly exitAtUtc: string;
  /** Signed, exact: `ticksMoved * tickValueCents * quantity`. */
  readonly realizedCents: Cents;
  /** Ticks against the position at its worst point. Non-negative. */
  readonly adverseTicks: number;
  /** Ticks in favour at its best point. Non-negative. */
  readonly favourableTicks: number;
  /** True when the auto-liquidator ended this trade rather than the trader. */
  readonly liquidated: boolean;
}

/**
 * The vendor's auto-liquidation record.
 *
 * DATA_CAPABILITIES section 1: "the EOD report logs event, time, and exact
 * trigger criterion", which is what makes it Merit's breach-evidence source as
 * well as its mark source. `V-M2-08` is whether that record is actually visible
 * to us; where it is not, the behavioural fallback in AS-M2-03 is all there is.
 */
export interface SimLiquidation {
  readonly atUtc: string;
  /** The vendor's stated criterion, verbatim into the report. */
  readonly criterion: string;
  /** The setpoint that fired. */
  readonly thresholdCents: Cents;
  /** Where the account actually came to rest. Below the threshold is slippage. */
  readonly equityCents: Cents;
}

/**
 * A point on the intraday equity path.
 *
 * THIS IS THE SEAM ADR-020's TIER 2 ATTACHES TO, and naming it here is the
 * point. File mode summarises the waypoints into `high_balance` and
 * `low_balance` and throws the path away. Streaming mode emits the waypoints as
 * `LiveAccountTick`s and computes no summary. ONE day model, two consumers,
 * which is the only way the two modes cannot disagree about what happened.
 *
 * The type deliberately is not `LiveAccountTick` and must not become it:
 * ADR-020's hard rule (INV-M2-14) is that the streaming tier's type appears
 * nowhere in the authoritative pipeline, and file mode IS the authoritative
 * pipeline. The streaming session converts; it does not rename this.
 */
export interface SimWaypoint {
  readonly atUtc: string;
  readonly equityCents: Cents;
  readonly kind: 'open' | 'adverse' | 'favourable' | 'exit' | 'liquidation';
}

/** One account's one session, complete. The unit both report files are rendered from. */
export interface SimDay {
  readonly account: SimAccount;
  readonly tradingDay: TradingDay;
  /** INV-18: `opening == prior closing + adjustment`. Asserted in `session.test.ts`. */
  readonly openingBalanceCents: Cents;
  /** INV-19, and `0036`'s constraint: `closing == opening + realized_pnl`. */
  readonly closingBalanceCents: Cents;
  readonly highBalanceCents: Cents;
  /** The breach comparison input (0014). Never derived from a rule here. */
  readonly lowBalanceCents: Cents;
  readonly realizedPnlCents: Cents;
  /** Signed, and zero unless the caller supplied a movement for this day. */
  readonly adjustmentCents: Cents;
  readonly adjustmentDescription: string;
  readonly trades: readonly SimTrade[];
  readonly fills: readonly SimFill[];
  readonly waypoints: readonly SimWaypoint[];
  readonly liquidation: SimLiquidation | null;
}

/** Everything one seeded run produced, in session order then population order. */
export interface SimRun {
  readonly seed: string;
  readonly sessions: readonly SimSession[];
  readonly population: readonly SimAccount[];
  readonly specs: readonly ContractSpec[];
  /** `days[i]` corresponds to `sessions[i]`, one entry per account, population order. */
  readonly days: readonly (readonly SimDay[])[];
}

/** What `simulate` is given. */
export interface SimulationInput {
  readonly seed: string;
  readonly population: readonly SimAccount[];
  readonly sessions: readonly SimSession[];
  readonly specs: readonly ContractSpec[];
  readonly adjustments: readonly BalanceAdjustment[];
}
