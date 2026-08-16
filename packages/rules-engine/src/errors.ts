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
