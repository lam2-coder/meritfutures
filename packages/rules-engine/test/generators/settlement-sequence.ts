// =============================================================================
// packages/rules-engine/test/generators/settlement-sequence.ts
// =============================================================================
// THE ARBITRARY SETTLEMENT-SEQUENCE GENERATOR, the third of the three P2
// section 5 names: "arbitrary day sequences, arbitrary settlement sequences, and
// arbitrary plans satisfying CV-01 to CV-19".
//
// It was deferred by `day-sequence.ts`, which said so in its own header and gave
// a reason: a settlement "carries an ordinal that is `payouts_settled_count + 1`
// at request time (R-45) and two distinct trading days (SD-02, SD-03), so
// generating a coherent settlement stream means generating payout eligibility,
// WHICH MEANS THE ENGINE."
//
// THAT REASON HAS EXPIRED, which is why this file exists now and not earlier:
// `src/payout/clamp.ts`, `src/payout/gates.ts`, `src/payout/evaluate.ts` and
// `src/payout/settle.ts` all exist, and `IMPLEMENTED_RULES` declares 45 of 50.
//
// IT STILL DOES NOT IMPORT THE ENGINE, and the distinction matters. The
// deferral was about whether a COHERENT settlement stream was expressible at
// all, not about where the arithmetic should come from. `validate-settlement-
// sequence.ts` re-derives R-42's cap scan and R-44's ceiling from M01's own
// words, this file composes them, and neither calls `clampPayout`. A generator
// that called the engine would emit exactly the settlements the engine already
// believes in, which is TR-01's failure in generator costume.
//
// -----------------------------------------------------------------------------
// VALID BY CONSTRUCTION, NEVER BY REJECTION SAMPLING
// -----------------------------------------------------------------------------
// Inherited from `plan.ts` and `day-sequence.ts` with their reason: `fc.filter`
// over a fifteen-rule contract discards almost every candidate, shrinks badly,
// and makes the generator's correctness an accident of the filter rather than a
// property of the construction.
//
// TWO `fc.filter` CALLS APPEAR BELOW ANYWAY AND THEY ARE NOT THAT. Both filter
// on a SIZE -- how many sessions the drawn day sequence has, and how large the
// drawn plan's `max_payouts` is -- and neither filters on validity. The
// difference is not a technicality: a size filter tests one integer, accepts the
// majority of candidates, and shrinks monotonically, and what it buys is that
// the R-49 and INV-17 counterfactuals have room to fire. `plan.ts` learned what
// the alternative costs: two of its nineteen counterfactuals passed VACUOUSLY on
// the first run because a conditional rule's precondition was left free.
//
// -----------------------------------------------------------------------------
// THE `omit` PARAMETER IS THE POINT, NOT A CONVENIENCE
// -----------------------------------------------------------------------------
// A generator asserted to emit only valid sequences, never watched emitting an
// invalid one, is vacuous: `fc.constant(SOME_KNOWN_GOOD_SEQUENCE)` passes that
// assertion forever. So every rule's construction step is individually
// removable, and `settlement-sequence.property.test.ts` watches each removal
// produce a sequence the ORACLE rejects, citing that rule and nothing else.
//
// When a rule is omitted the step INVERTS rather than relaxes, for
// `day-sequence.ts`'s reason: a relaxed step would sometimes still emit a valid
// sequence, and a counterfactual that only sometimes fires is one that will
// eventually be quarantined as flaky and deleted.
//
// -----------------------------------------------------------------------------
// ONE RULE CANNOT BE VIOLATED ALONE, AND THAT IS A FACT ABOUT THE CONTRACT
// -----------------------------------------------------------------------------
// `INV-17/lifetime-bound` is `max_payouts * max cap`. Every settlement is
// clamped to its ordinal's cap by `R-42` and the count is bounded by `R-49`, so
// while those two hold the lifetime bound holds ARITHMETICALLY -- it is their
// conjunction over a life, not an independent constraint. No single construction
// step can break it by itself.
//
// It is kept as its own rule rather than dropped, because INV-17 is the
// liability bound the business rests on and a bound nothing states is a bound
// nobody notices losing. Its inversion is therefore declared JOINT: it fires
// together with `R-49`, and the property test asserts exactly that pair rather
// than asserting a single finding it could never get. Stating the exception is
// the point; a counterfactual quietly permitted two findings would be a hole in
// the one assertion this file's honesty rests on.
//
// -----------------------------------------------------------------------------
// WHY THE DAY SEQUENCE IS REBUILT AND NOT MERELY ANNOTATED
// -----------------------------------------------------------------------------
// A settlement leaves exactly one thing on the day: `adjustmentCents`, applied
// at the OPEN of the effective day (R-10, SD-01), which `day-sequence.ts` names
// as the reason it draws that column at all. But `adjustmentCents` is load
// bearing in INV-18 (`opening == prior.closing + adjustment`), so writing a
// withdrawal into a mark and stopping there would break the balance chain on
// that day and every day after it.
//
// So the withdrawal is applied and THE CHAIN IS REBUILT FORWARD, reusing the
// slack the original marks were drawn with rather than redrawing it. The
// property test asserts `validateDaySequence` on the rebuilt days as well as
// `validateSettlementSequence` on the settlements, so a re-chain that got the
// arithmetic wrong is caught by the OTHER oracle rather than by this file's
// reasoning about itself.
// =============================================================================

import fc from 'fast-check';

import type { DailyMark, DaySequence, TradingDay } from './day-input.js';
import { daySequenceArbitrary } from './day-sequence.js';
import type { MaterializedPlan } from './plan-config.js';
import { planArbitrary } from './plan.js';
import {
  capForOrdinal,
  traderLeg,
  type SettlementFact,
  type SettlementSequence,
  type SsRuleId,
} from './validate-settlement-sequence.js';

export interface SettlementSequenceArbitraryOptions {
  /**
   * Rules whose construction step is INVERTED, so the emitted sequence violates
   * them. Empty in every ordinary use; non-empty only in the counterfactual.
   */
  readonly omit?: ReadonlySet<SsRuleId>;
  /**
   * The day sequence the settlements attach to. Drawn when absent, which is the
   * ordinary case: a caller that supplies one is usually a `PT-nn` suite that
   * has already drawn the days and needs the settlements to agree with them.
   */
  readonly days?: DaySequence;
}

const has = (omit: ReadonlySet<SsRuleId>, id: SsRuleId): boolean => omit.has(id);

// -----------------------------------------------------------------------------
// The counterfactual's forced minima
// -----------------------------------------------------------------------------
// A settlement count of zero satisfies every rule below trivially, so inverting
// a step with nothing to invert it on proves nothing. This is `day-sequence.ts`'s
// `markMinimum` applied to settlements, and `PRECONDITIONS` in the test file is
// the executable copy of the list, which is what fails by name if a rule is
// added and this is not updated.
//
//   most rules              need one settlement
//   R-45/ordinal-is-consecutive, R-46/anchors-advance
//                          need TWO, so there is a step between them to break
//   SD-03/effective-not-before-basis
//                          needs a session strictly after the last settlement's
//                          effective day, to serve as a basis day that follows it
//   R-49, INV-17           need the day sequence to carry MORE marks than the
//                          plan's `max_payouts`, or the extra settlement that
//                          breaks the ladder has nowhere to land

const settlementMinimum = (omit: ReadonlySet<SsRuleId>): number =>
  has(omit, 'R-45/ordinal-is-consecutive') || has(omit, 'R-46/anchors-advance') ? 2 : 1;

const needsLadderHeadroom = (omit: ReadonlySet<SsRuleId>): boolean =>
  has(omit, 'R-49/ladder-bounds-the-count') || has(omit, 'INV-17/lifetime-bound');

const needsTrailingSession = (omit: ReadonlySet<SsRuleId>): boolean =>
  has(omit, 'SD-03/effective-not-before-basis');

/**
 * The largest `max_payouts` the ladder counterfactual will accept.
 *
 * `plan.ts` draws it uniformly on [1, 20] and a drawn day sequence carries at
 * most 25 sessions, so an unbounded draw would leave the R-49 inversion without
 * room on a large minority of runs. Six is comfortably inside what a drawn
 * sequence carries and is still a ladder with several rungs.
 */
const LADDER_HEADROOM_MAX_PAYOUTS = 6;

/**
 * An arbitrary settlement sequence: one account's settled payouts, over the day
 * sequence they attach to.
 *
 * With no options the emitted sequence satisfies every rule in
 * `validate-settlement-sequence.ts` AND leaves the day sequence satisfying every
 * rule in `validate-day-sequence.ts`, both of which
 * `settlement-sequence.property.test.ts` asserts against the independent
 * oracles rather than against this module's reasoning.
 */
export function settlementSequenceArbitrary(
  options: SettlementSequenceArbitraryOptions = {},
): fc.Arbitrary<SettlementSequence> {
  const omit = options.omit ?? new Set<SsRuleId>();
  const minSettlements = settlementMinimum(omit);

  // A settlement needs a mark to land its adjustment on, and never the account's
  // first: `day-sequence.ts` sets `adjustmentCents` to zero on day one because
  // "INV-18 is the only rule that reads the column and `DayInput.prior` is null
  // only on the account's first trading day". So the capacity of a sequence is
  // one fewer than its marks, and one more mark again is needed when a basis day
  // must follow the last effective day.
  const minMarks = omit.size === 0 ? 1 : minSettlements + 1 + (needsTrailingSession(omit) ? 1 : 0);

  const daysArb = options.days !== undefined ? fc.constant(options.days) : drawDays(omit, minMarks);

  return daysArb.chain((days) => buildFrom(days, omit));
}

/**
 * The day sequence, with the SIZE filters this file's header distinguishes from
 * validity filtering.
 *
 * NOTHING IS FILTERED IN THE ORDINARY CASE, and that is deliberate rather than
 * an omission. Forcing a minimum when no rule is being inverted would remove
 * the account that settled NOTHING from the support, and an account with no
 * payouts is the commonest real sequence there is. The minima exist only to
 * give a counterfactual room to fire.
 */
function drawDays(omit: ReadonlySet<SsRuleId>, minMarks: number): fc.Arbitrary<DaySequence> {
  if (omit.size === 0) return planArbitrary().chain((plan) => daySequenceArbitrary({ plan }));

  const ladderHeadroom = needsLadderHeadroom(omit);
  const minSettlements = settlementMinimum(omit);

  const planArb = planArbitrary().filter((p) => {
    const funded = p.phase_funded;
    const maxCap = funded.payout_cap_schedule.reduce((m, s) => Math.max(m, s.cap_cents), 0);

    // The ladder is what bounds the settlement count, so an inversion that needs
    // two settlements cannot run against a one-rung ladder. This is the size
    // filter the R-45 and R-46 counterfactuals rest on, and without it they
    // fail reporting "the generator stopped inverting" when the real cause is
    // that the plan never allowed a second payout.
    if (funded.max_payouts < minSettlements) return false;
    if (ladderHeadroom && funded.max_payouts > LADDER_HEADROOM_MAX_PAYOUTS) return false;

    // R-42's inversion approves ONE CENT OVER the cap, and INV-17's bound is
    // `max_payouts * max cap`. A sequence already sitting on that bound would be
    // pushed over it by that cent, and the counterfactual would report two
    // findings. `buildFrom` keeps the count one below the ladder for this case;
    // that needs a ladder with at least two rungs to be one below.
    if (has(omit, 'R-42/approved-within-cap') && funded.max_payouts < 2) return false;

    // R-49's inversion emits one settlement too many and must NOT trip INV-17 as
    // collateral, so `assemble` approves every one of them at the minimum. That
    // is under the lifetime bound only if the bound has room for the extra one,
    // which is this inequality and not an approximation of it.
    if (
      has(omit, 'R-49/ladder-bounds-the-count') &&
      !has(omit, 'INV-17/lifetime-bound') &&
      maxCap * funded.max_payouts < funded.min_payout_cents * (funded.max_payouts + 1)
    ) {
      return false;
    }

    // INV-17's inversion needs the OPPOSITE: every ordinal must resolve to the
    // schedule's LARGEST cap, or `max_payouts + 1` settlements at their own caps
    // can still sit under `max_payouts * max cap`. A multi-step schedule whose
    // big step starts at ordinal 16 does exactly that. One step makes every
    // ordinal resolve to the same cap, and ADR-025 leaves v1's schedule with one
    // step anyway, so this restricts the counterfactual to the shipped shape
    // rather than to a convenient one.
    if (has(omit, 'INV-17/lifetime-bound') && funded.payout_cap_schedule.length !== 1) return false;

    return true;
  });

  return planArb.chain((plan) =>
    daySequenceArbitrary({ plan }).filter((d) => {
      if (d.marks.length < minMarks) return false;
      // R-49's inversion emits `max_payouts + 1` settlements, so the sequence
      // has to be able to carry one more than the ladder allows.
      if (ladderHeadroom && d.marks.length < plan.phase_funded.max_payouts + 2) return false;
      return true;
    }),
  );
}

/** The shape drawn per settlement, before any rule is applied to it. */
interface RawSettlement {
  /** Extra calendar spacing between this settlement's mark and the prior one. */
  readonly spread: number;
  /** Where inside `[min_payout_cents, cap]` the approval falls, in parts per 10,000. */
  readonly approvalBp: number;
  /** What the trader asked for above what was approved. */
  readonly requestSlack: number;
  readonly payoutRequestId: string;
}

const HEX_DIGIT = fc.constantFrom(...'0123456789abcdef');

const rawSettlementArbitrary = (): fc.Arbitrary<RawSettlement> =>
  fc.record({
    spread: fc.integer({ min: 0, max: 4 }),
    approvalBp: fc.integer({ min: 0, max: 10_000 }),
    requestSlack: fc.integer({ min: 0, max: 500_000 }),
    payoutRequestId: fc
      .array(HEX_DIGIT, { minLength: 8, maxLength: 8 })
      .map((cs) => `pr-${cs.join('')}`),
  });

function buildFrom(
  days: DaySequence,
  omit: ReadonlySet<SsRuleId>,
): fc.Arbitrary<SettlementSequence> {
  const funded = days.plan.phase_funded;

  // The count is DRAWN rather than fixed at the ladder, because an account that
  // settled once and an account that settled its way to graduation are different
  // sequences and both are real. Fixing it at `max_payouts` would put every
  // emitted account exactly on R-49's boundary, which is the one place a bound
  // is least informative about the rules that lead up to it.
  const capacity = days.marks.length - 1 - (needsTrailingSession(omit) ? 1 : 0);
  // R-42's inversion spends one cent of the lifetime bound, so it runs one rung
  // below the ladder and leaves that cent of room. See `drawDays`.
  const ladder = has(omit, 'R-42/approved-within-cap')
    ? funded.max_payouts - 1
    : funded.max_payouts;
  const ceiling = Math.min(ladder, Math.max(capacity, 0));
  const floor = omit.size === 0 ? 0 : Math.min(settlementMinimum(omit), ceiling);

  // The ladder inversion is the one case that is not drawn: it emits exactly one
  // more than the ladder allows, and `drawDays` has guaranteed the room for it.
  const countArb = needsLadderHeadroom(omit)
    ? fc.constant(Math.min(funded.max_payouts + 1, days.marks.length - 1))
    : fc.integer({ min: floor, max: ceiling });

  return countArb.chain((count) =>
    count <= 0
      ? fc.constant<SettlementSequence>({ days, settlements: [] })
      : fc
          .array(rawSettlementArbitrary(), { minLength: count, maxLength: count })
          .map((raws) => assemble(days, raws, omit)),
  );
}

function assemble(
  days: DaySequence,
  raws: readonly RawSettlement[],
  omit: ReadonlySet<SsRuleId>,
): SettlementSequence {
  const plan = days.plan;
  const funded = plan.phase_funded;
  const marks = days.marks;
  const count = raws.length;

  // ---------------------------------------------------------------------------
  // Which marks the settlements land on
  // ---------------------------------------------------------------------------
  // Index 0 is excluded: it is the account's first day and carries no
  // adjustment. The drawn spread widens the spacing when there is room for it,
  // so settlements are not always on consecutive days, and collapses to
  // consecutive when there is not. Consecutive is a legal sequence rather than a
  // degenerate one, so the fallback needs no apology.
  const lastUsable = marks.length - 1 - (needsTrailingSession(omit) ? 1 : 0);
  let slack = Math.max(lastUsable - count, 0);
  const indices: number[] = [];
  let cursor = 0;
  for (let k = 0; k < count; k++) {
    const spread = Math.min(raws[k]!.spread, slack);
    slack -= spread;
    cursor += 1 + spread;
    indices.push(Math.min(cursor, lastUsable));
  }

  // ---------------------------------------------------------------------------
  // The settlements
  // ---------------------------------------------------------------------------
  const settlements: SettlementFact[] = [];
  const withdrawalByDay = new Map<TradingDay, number>();

  for (let k = 0; k < count; k++) {
    const raw = raws[k]!;
    const markIndex = indices[k]!;

    // R-45. The ordinal is the settled count plus one, so across a stream of
    // settlements it is simply the position plus one.
    // THE WHOLE STREAM SHIFTS, not just the first one. Starting at 2 and then
    // continuing 2, 3, 4 would break consecutiveness as well, and the
    // counterfactual would report both R-45 clauses instead of the one it aimed
    // at. Shifting every ordinal keeps each step exactly one.
    let ordinal = has(omit, 'R-45/ordinal-starts-at-one') ? k + 2 : k + 1;
    if (k === 1 && has(omit, 'R-45/ordinal-is-consecutive')) ordinal = k + 3;

    // R-42 and R-43. The approval lives in `[min_payout_cents, cap]`, which is
    // the window R-43 clamps into and R-43's own eligibility floor.
    const cap = capForOrdinal(plan, ordinal);
    const floor = funded.min_payout_cents;
    const span = Math.max(cap - floor, 0);
    let approvedCents = floor + Math.floor((span * raw.approvalBp) / 10_000);

    // THE TWO LADDER INVERSIONS PIN THE AMOUNTS IN OPPOSITE DIRECTIONS, and
    // that is what separates the two findings. R-49 alone must break the COUNT
    // bound without breaking the LIFETIME bound, so every approval sits at the
    // minimum; INV-17 must break both, so every approval sits at its cap. Left
    // drawn, R-49's case would trip INV-17 on most seeds and neither
    // counterfactual would mean what it says.
    if (has(omit, 'INV-17/lifetime-bound')) approvedCents = cap;
    else if (has(omit, 'R-49/ladder-bounds-the-count')) approvedCents = floor;

    // R-42 overshoots the cap on the FIRST settlement only, and the rest sit at
    // the minimum, so the one cent of overshoot is the only thing this sequence
    // spends against the lifetime bound.
    if (has(omit, 'R-42/approved-within-cap')) approvedCents = k === 0 ? cap + 1 : floor;
    if (has(omit, 'R-43/approved-at-least-the-minimum')) approvedCents = floor - 1;

    // The clamp can only reduce, so the request is never below the approval.
    let requestedCents = approvedCents + raw.requestSlack;
    if (has(omit, 'payout_requests_approved_within_requested')) {
      requestedCents = approvedCents - 1;
    }
    // INV-02 rides on the request rather than on the approval, because a
    // fractional approval would break the split identity too and the
    // counterfactual would report three findings instead of one.
    if (has(omit, 'INV-02')) requestedCents = requestedCents + 0.5;

    // R-44. The ceiling favours the trader by at most one cent; the firm takes
    // the remainder, so the legs sum exactly (INV-11).
    let traderCents = traderLeg(approvedCents, funded.split_bp);
    if (has(omit, 'R-44/remainder-favours-the-trader')) traderCents = traderCents - 1;
    let firmCents = approvedCents - traderCents;
    if (has(omit, 'payout_requests_split_sums')) firmCents = firmCents + 1;

    // R-46 and SD-03. The basis day is the last closed day the decision used,
    // so it is the session before the withdrawal lands; the effective day is the
    // one whose OPENING balance reflects it.
    let basisTradingDay = marks[markIndex - 1]!.tradingDay;
    let effectiveTradingDay = marks[markIndex]!.tradingDay;

    if (k === 0 && has(omit, 'R-46/basis-day-is-a-session')) {
      // A day well before the calendar's coverage: certainly not a session, and
      // still no later than the effective day, so SD-03 stays satisfied and this
      // finding arrives alone.
      basisTradingDay = shiftDay(days.calendar.coverage.from, -1_000);
    }
    if (k === count - 1 && has(omit, 'R-46/effective-day-is-a-session')) {
      // The mirror image, after the coverage, on the LAST settlement so both
      // anchor streams still ascend.
      effectiveTradingDay = shiftDay(days.calendar.coverage.to, 1_000);
    }
    if (k === 1 && has(omit, 'R-46/anchors-advance')) {
      // Equal is not advancing. Taking the prior basis rather than a later one
      // keeps `effective >= basis` true, so SD-03 does not fire as collateral.
      basisTradingDay = settlements[0]!.basisTradingDay;
    }
    if (k === count - 1 && has(omit, 'SD-03/effective-not-before-basis')) {
      // A real session, strictly after this settlement's effective day. It
      // exists because `needsTrailingSession` reserved it.
      basisTradingDay = marks[markIndex + 1]!.tradingDay;
    }

    settlements.push({
      payoutRequestId: raw.payoutRequestId,
      ordinal,
      requestedCents,
      approvedCents,
      traderCents,
      firmCents,
      basisTradingDay,
      effectiveTradingDay,
    });

    // R-10. What the settlement leaves on the day, unless this is the run that
    // is watching R-10 fail, in which case the day is left with nothing.
    const suppress = k === 0 && has(omit, 'R-10/adjustment-lands-on-the-effective-day');
    if (!suppress) {
      const prior = withdrawalByDay.get(effectiveTradingDay) ?? 0;
      withdrawalByDay.set(effectiveTradingDay, prior + approvedCents);
    } else {
      withdrawalByDay.set(effectiveTradingDay, 0);
    }
  }

  return { days: { ...days, marks: rechain(plan, marks, withdrawalByDay) }, settlements };
}

/**
 * Apply the withdrawals at the open of their effective days and rebuild the
 * balance chain forward.
 *
 * The arithmetic is `day-sequence.ts`'s `chainMarks`, restricted to the
 * uninverted case, because these marks were drawn with no `omit` of their own:
 * INV-20 on the first day, INV-18 on every day after it, INV-19 throughout, and
 * the high and low keeping the slack they were drawn with.
 *
 * THE SLACK IS RECOVERED RATHER THAN REDRAWN. Reading it back off the original
 * mark keeps the rebuilt sequence as close to the drawn one as the withdrawal
 * allows, so a shrunk counterexample differs from its neighbour in the
 * settlement and not in six unrelated bounds.
 */
function rechain(
  plan: MaterializedPlan,
  marks: readonly DailyMark[],
  withdrawalByDay: ReadonlyMap<TradingDay, number>,
): readonly DailyMark[] {
  const out: DailyMark[] = [];
  let priorClosing = 0;

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!;

    const originalTop = Math.max(m.openingBalanceCents, m.closingBalanceCents);
    const originalBottom = Math.min(m.openingBalanceCents, m.closingBalanceCents);
    const highSlack = m.highBalanceCents - originalTop;
    const lowSlack = originalBottom - m.lowBalanceCents;

    // The withdrawal is a negative non-trading movement (SD-01), applied at the
    // open. Day one carries no adjustment at all, so a settlement can never land
    // there and `assemble` never places one.
    //
    // ON A SETTLEMENT DAY THE WITHDRAWAL IS THE WHOLE ADJUSTMENT, and the drawn
    // one is dropped rather than added to. `adjustmentCents` is the day's NET
    // non-trading movement, so a drawn deposit could otherwise offset the
    // withdrawal and leave the net less negative than the payout -- which the
    // first run of this generator did, producing marks whose net was `-9,999`
    // against an approval of `10,000`. Netting is real, but a generator that
    // models it cannot state R-10 as a checkable inequality, and a rule the
    // oracle cannot state is a rule nothing enforces. So a settlement day
    // carries its withdrawal and nothing else, which is the modelling choice
    // rather than an accident of the arithmetic.
    const settled = withdrawalByDay.has(m.tradingDay);
    const adjustmentCents =
      i === 0 ? 0 : settled ? -withdrawalByDay.get(m.tradingDay)! : m.adjustmentCents;

    const openingBalanceCents = i === 0 ? plan.size_cents : priorClosing + adjustmentCents;
    const closingBalanceCents = openingBalanceCents + m.realizedPnlCents;
    priorClosing = closingBalanceCents;

    const top = Math.max(openingBalanceCents, closingBalanceCents);
    const bottom = Math.min(openingBalanceCents, closingBalanceCents);

    out.push({
      ...m,
      openingBalanceCents,
      closingBalanceCents,
      adjustmentCents,
      highBalanceCents: top + highSlack,
      lowBalanceCents: bottom - lowSlack,
    });
  }

  return out;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The day `n` CALENDAR days from `day`, for the two inversions that need a day
 * the calendar certainly does not contain.
 *
 * `day-sequence.ts` states the licence and it is inherited verbatim: B4 #1
 * forbids the ENGINE deriving a trading day from a timestamp, this is test
 * material, `Date.UTC` is used as a calendar rather than as a clock, and the
 * process timezone cannot reach it, which is what keeps this file correct under
 * PT-06's `TZ` randomisation.
 */
function shiftDay(day: string, n: number): string {
  const m = ISO_DAY.exec(day);
  if (m === null) throw new Error(`not an ISO day: ${day}`);
  const utc = Date.UTC(Number(m[1]!), Number(m[2]!) - 1, Number(m[3]!));
  return new Date(utc + n * 86_400_000).toISOString().slice(0, 10);
}
