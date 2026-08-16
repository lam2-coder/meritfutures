// =============================================================================
// packages/rules-engine/src/errors.ts
// =============================================================================
// THE ENGINE THROWS IN EXACTLY ONE CLASS OF CASE, and everything else goes down
// the assertion channel.
//
//   THROWS   an invariant the ENGINE'S OWN arithmetic is responsible for was
//            violated, which means a future edit broke a rule. R-14's tripwire
//            is the only live instance: "No input can reach this; only a future
//            edit to the two blocks above can."
//
//   REFUSES  the INPUT contradicts something the engine is entitled to assume
//            (DO-3's mark identities, DO-1's preconditions, ADR-049's calendar
//            miss). No state is written for the day, reconciliation is raised,
//            and nothing throws, because the day's data being wrong is not the
//            batch's crash.
//
// M01 makes the distinction explicitly at the tripwire: "It throws rather than
// returning an `AssertionFailure` because it is not a data problem (contrast
// DO-3, where the vendor's arithmetic is what failed)."
//
// -----------------------------------------------------------------------------
// THE SECOND INSTANCE IS `capForOrdinal`, AND IT DOES NOT FIT THE PAIR CLEANLY
// -----------------------------------------------------------------------------
// R-42 resolves a payout cap out of `payout_cap_schedule`, and CV-09 guarantees
// the schedule is non-empty and starts at `from_ordinal: 1`, so every ordinal
// from 1 up has a rung. A plan with no rung for an ordinal is neither the
// engine's own arithmetic failing NOR a bad day of vendor data: it is a config
// `validatePlan` must have rejected at publish, arriving anyway.
//
// IT THROWS, AND THE REASON IS WHAT THE ALTERNATIVE WOULD COMPUTE. There is no
// assertion channel out of `clampPayout` (it returns an amount, not a
// `DayOutput`), and there is no plausible cap to fall back on: the absence of a
// cap is an UNCAPPED extraction, and "universal per-payout caps exist on every
// plan and every ordinal" is a structural ruling (constitution 0.4, M01 Appendix
// A.0), not a parameter with a default. Refusing loudly is the only answer that
// does not invent a liability limit, and it lands as the same class because a
// page that says `CV-09` names the rule either way.
// =============================================================================

/** An invariant the engine's own computation must maintain, and did not. */
export class EngineInvariantError extends Error {
  /** The invariant id, so the page names the rule rather than the stack. */
  readonly invariant: string;

  constructor(invariant: string, detail: string) {
    super(`${invariant}: ${detail}`);
    this.name = 'EngineInvariantError';
    this.invariant = invariant;
  }
}
