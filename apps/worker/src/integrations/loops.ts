// =============================================================================
// apps/worker/src/integrations/loops.ts
// =============================================================================
// `IN-M10-03`'s LIFECYCLE MESSAGING, AND THE ARTIFACT IS THE ALLOWLIST.
//
// `SD-M10-01`'s stated reason (`M10:74`): "Making the contract a row rather than
// code also makes 'what are we sending Loops' a question the founder can answer
// without reading a repository." A dispatch that is correct and legible only by
// reading this file has missed the point, so the twelve contracts below are
// DATA in the shape of the `integration_contracts` columns, each carrying the
// line it was transcribed from, and the projection underneath them cannot send a
// field that is not in one.
//
// THIS FILE IMPORTS NOTHING. Not `@merit/db`, not `pg`, not a sibling module.
// `ADR-165` makes `src/db.ts` the one door under `apps/worker/src`, and the
// reason this file needs no door at all is section 1.
//
// -----------------------------------------------------------------------------
// 1. THE NAMED DEPENDENCY DID NOT LAND, AND THE SLICE IS BUILDABLE ANYWAY
// -----------------------------------------------------------------------------
// `P7` section 8 gives this slice one dependency: "`P5-b` for `events`, because
// a lifecycle dispatch reads the event it is dispatching." `P5-b` RAN AND
// REFUSED THAT TABLE, and the refusal is the standing text of
// `packages/db/src/scope.ts`: "`events` IS ABSENT ... all five members of the
// vocabulary were tried against the shape and every one is either refused by a
// mechanical assertion or silently lossy ... WHAT THE TABLE NEEDS IS A SIXTH
// CLASS, and `ADR-106` is the precedent for what adding one costs."
//
// So there is no registered `events` table to read, and reaching around the
// accessor to read it is the one line `P7` section 11 rule 10 forecloses.
//
// **THAT BOUNDS THE SLICE AND DOES NOT BLOCK IT, BECAUSE THE ALLOWLIST IS NOT A
// READ.** A contract is a declaration about an event NAME and a FIELD NAME, and
// both are known without opening a row. So this module takes the event as a
// VALUE and holds no port, no transaction and no query. The half that reads
// `events` is the dispatcher `M10:36` describes, and it is owed by the session
// that gets `events` a scope class.
//
// -----------------------------------------------------------------------------
// 2. TWELVE TRIGGERS AND NOT NINE, AND THE THREE THAT WOULD HAVE BEEN LOST ARE
//    THE THREE MARKED "always send"
// -----------------------------------------------------------------------------
// `M10:31` and `M10:165` both say "the nine `EVENTS` section 11 triggers".
// **`EVENTS` section 11 CARRIES TWELVE ROWS**, and session 163 found the
// discrepancy and reported it rather than editing an `approved` plan
// (`2026-08-24-session-163.md:102`). The three M10 does not count are
// `payout.held`, `payout.hold_released` and `identity.restriction_lifted`.
//
// **THAT COUNT IS THIS FILE'S SUBJECT AND NOT A FOOTNOTE.** `M10:372` is the
// coverage rule: "Every integration contract has a negative test asserting that
// a field absent from its allowlist is not transmitted, and the test is
// GENERATED FROM THE CONTRACT ROWS rather than hand written." A twelve-row table
// generates twelve negative tests and a nine-row table generates nine, and the
// three that would be missing are the three the corpus marks "always send", one
// of them with the note that "a restore nobody was told about is, from the
// trader's side, still a restriction". The transcription below is from `EVENTS`
// and the count is asserted against the document rather than stated here.
//
// -----------------------------------------------------------------------------
// 3. NO FIELD LIST IN THIS FILE IS THIS SLICE'S, SO ALL TWELVE SHIP UNDECLARED
// -----------------------------------------------------------------------------
// `M10:31` says the module carries "the minimum payload each needs" and **THE
// CORPUS NEVER SAYS WHAT THAT IS FOR ANY OF THE TWELVE.** `EVENTS` section 11
// gives a message and a guard per row; the payloads in `EVENTS` sections 4
// through 8 are what the EVENT carries, which is the superset a contract exists
// to cut down. Deriving twelve allowlists from twelve payloads would be this
// session choosing what Merit discloses to a third party, in a file, by
// inference.
//
// So {@link LOOPS_CONTRACTS} ships twelve rows with `state: 'undeclared'`, an
// EMPTY allowlist and `enabled: false`, on `breaker/ports.ts`'s `LOSS_RATIO_POLICY`
// precedent one directory over: a value the corpus does not state is carried
// with its citation rather than invented, and the run DECLINES.
//
// **`0018` ALREADY ANTICIPATED THAT STATE AND THE CHECK IS THE EVIDENCE.**
// `integration_contracts_enabled_has_fields` reads
// `enabled = false OR array_length(field_allowlist, 1) >= 1`, so a DISABLED row
// with an EMPTY allowlist is a legal row and an ENABLED one is not. The schema
// can hold "declared as owed, not yet declared" and cannot hold "enabled and
// sending nothing", which is exactly the pair this slice needs.
//
// **AN UNDECLARED CONTRACT IS NOT A GAP IN THE CONTROL, IT IS THE CONTROL AT
// REST.** `M10:184` (FM-M10-03): "Contract allowlists are additive-by-approval;
// a new field is absent from every contract by default." Nothing reaches the
// vendor today, which is the correct behaviour for a vendor nobody has chosen
// and a field list nobody has approved.
//
// -----------------------------------------------------------------------------
// 4. THE SECOND LAYER, WHICH IS STATED AND IS ACTIVE TODAY
// -----------------------------------------------------------------------------
// An empty allowlist is a control that a later session retires by filling the
// allowlist in. **{@link FORBIDDEN_FIELDS} is the layer that survives that**: a
// field the corpus forbids by name cannot be dispatched EVEN IF SOMEBODY ADDS IT
// TO AN ALLOWLIST, and {@link projectForLoops} refuses rather than filtering, so
// the contradiction is reported instead of silently honoured.
//
// It has exactly one member and the member is sourced. `EVENTS:407` on
// `payout.held`: "The fact, the clause and the date, NEVER THE EVIDENCE AND
// NEVER THE DETECTOR." `hold_flag_id` in that event's payload (`EVENTS:250`) is
// both: it is the flag a detector raised and it is the evidence pointer.
//
// **INV-M10-04 IS NOT IN THAT SET AND THE REASON IS THAT IT NAMES CLASSES.**
// `M10:57` forbids "no document, no biometric, no PAN, no full device
// fingerprint, and no raw IP", and no column in any of the twelve payloads is
// named as one. A list of columns inferred from those five words would be this
// session deciding which columns are biometrics. The invariant's own stated
// enforcement is the allowlist rather than a denylist, which is section 3's
// emptiness doing the work, and `M10:57` says so: "The contract allowlists make
// it structural rather than a review item."
//
// -----------------------------------------------------------------------------
// 5. THE GUARDS ARE A TYPE AND NOT `guard_expression`, AND THAT IS A FINDING
// -----------------------------------------------------------------------------
// `0018` declares the column as "An optional predicate that must hold before
// this event is dispatched at all, EVALUATED OVER THE ALLOWLISTED FIELDS ONLY."
//
// **THE ONE GUARD THIS MODULE EXISTS TO ENFORCE CANNOT BE WRITTEN THAT WAY.**
// `EVENTS:403` suppresses `breach.detected` "if the identity is restricted or
// has an open severity 4+ flag", and `M10:232` says the dispatcher "re-reads
// restriction status, open flag severity, and account state immediately before
// the send". None of those three is a field of `breach.detected`, whose payload
// (`EVENTS:163` onward) carries no `identity_id` at all. A predicate over the
// allowlisted fields is structurally unable to see them.
//
// So {@link LoopsGuard} is a discriminated union transcribed from `EVENTS`
// section 11, every row ships `guardExpression: null`, and the reason is
// recorded on the constant rather than left for the next reader to rediscover.
// **THE COLUMN IS NOT WRONG AND IS NOT WIDENED HERE**: it is a narrower facility
// than this module needs, the finding is reported, and a session that holds
// `packages/db/migrations` owns whatever it costs.
//
// -----------------------------------------------------------------------------
// 6. SEND TIME IS A PROPERTY OF THE PARAMETER LIST
// -----------------------------------------------------------------------------
// `INV-M10-08` (`M10:61`) and `FM-M10-02` (`M10:183`): a guard evaluated at
// enqueue rather than at send delivers a commiseration and a discounted reset
// offer to a ring Merit is in the middle of detecting.
//
// `digests/ports.ts` section 1 is the idiom and it is applied here: the alarm
// cannot be told "the run said it worked" because no such field exists on its
// input. {@link LoopsLiveState} carries restriction, open-flag severity and the
// last send, and **carries NOTHING a producer could hand it saying the guard
// already passed**. {@link dispatchToLoops} takes it as a REQUIRED argument, so
// there is no enqueue-time signature to call by mistake: a caller that has not
// re-read live state has no value to pass.
//
// -----------------------------------------------------------------------------
// 7. NO VENDOR, NO ENDPOINT, NO SECRET, AND NO RETRY BUDGET
// -----------------------------------------------------------------------------
// `OQ-M10-02` is unruled (`M10:418`) and **the choice is the founder's, so this
// slice takes no ADR number and makes no choice.** It does not have to: session
// 163 measured the cost of the question at "nothing depends on it except the
// adapter's own file name" (`2026-08-24-session-163.md:170`), and the file name
// is `P7` section 8's. {@link LOOPS_INTEGRATION} is the `integration` COLUMN'S
// KEY and not a vendor selection, and `M10:418`'s transport-only discipline holds
// whichever vendor is chosen.
//
// There is no base URL, no host and no credential in this file, and there is no
// send. `ADR-012`'s discipline on `ADMIN_ORIGIN` reads the same way for a vendor:
// a real hostname in an artifact is a real hostname in an artifact.
//
// **THE ATTEMPT BUDGET IS `unstated`.** `M10:96` draws `retrying --> dead_letter`
// on "attempts exhausted" and names no number; `integration_dispatches.attempts`
// is `integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)` with no ceiling.
// {@link LOOPS_DISPATCH_POLICY} carries it `unstated` with a null, so a session
// that wants a budget states one rather than inheriting this file's guess.
// =============================================================================

// -----------------------------------------------------------------------------
// The vocabulary, transcribed from `0018_integrations.sql` and never designed here
// -----------------------------------------------------------------------------

/**
 * The `integration` column's key for this contract set.
 *
 * **A KEY AND NOT A VENDOR SELECTION.** `OQ-M10-02` asks "which messaging
 * vendor" and proposes choosing "on deliverability and price"; it is the
 * founder's and it is not made here. The string is `P7` section 8's own file
 * name, and moving it costs a constant and a data migration of rows that do not
 * exist yet.
 */
export const LOOPS_INTEGRATION = 'loops' as const;

/**
 * `integration_dispatches.status`, transcribed from `0018`'s own `CHECK`.
 *
 * `status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed',
 * 'dropped_by_guard'))`. Four values, and a guard that suppresses writes the
 * fourth rather than writing nothing: a suppression that leaves no row is
 * indistinguishable from a dispatcher that never ran, and `M10:183` wants a
 * "suppressed-count metric that should never be zero".
 */
export const DISPATCH_STATUSES = ['queued', 'sent', 'failed', 'dropped_by_guard'] as const;

/** One of `integration_dispatches.status`'s four values. */
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

// -----------------------------------------------------------------------------
// The twelve triggers, transcribed from `EVENTS` section 11
// -----------------------------------------------------------------------------

/**
 * A guard, as `EVENTS` section 11 states it, in a shape that can be evaluated.
 *
 * `none` and `alwaysSend` are BOTH "dispatch", and they are two members rather
 * than one because they are two different statements. `none` is "no guard was
 * specified"; `alwaysSend` is a positive instruction that a later session may
 * not attach a guard to, and `EVENTS:406` gives the reason on
 * `payout.transfer_failed`: "silence is what kills payout trust".
 *
 * `contentRule` IS NOT A DISPATCH DECISION AND IS CARRIED SO THAT IT IS NOT
 * MISTAKEN FOR ONE. `EVENTS:411`'s "never state the provider's internal reason
 * verbatim" is a rule about what the message SAYS, and `M10:23` puts content in
 * `M16`: "M16 owns preference, channel, and content. M10 owns delivery to the
 * vendor that sends it." It reaches this file because the structural way to
 * honour it is to keep the field out of the allowlist, which is a declaration
 * decision this slice does not get to make (header section 3).
 */
export type LoopsGuard =
  | { readonly kind: 'none' }
  | { readonly kind: 'alwaysSend'; readonly why: string }
  | { readonly kind: 'throttlePerAccount'; readonly days: number }
  | { readonly kind: 'suppressWhenRestrictedOrFlagged'; readonly minOpenSeverity: number }
  | { readonly kind: 'contentRule'; readonly rule: string; readonly owner: string };

/** One row of `EVENTS` section 11, transcribed with the line it came from. */
export interface LoopsTrigger {
  /** The `events.name` this message is triggered by, and `integration_contracts.event_name`. */
  readonly eventName: string;
  /** The Message column, verbatim. */
  readonly message: string;
  /** The Guard column, as a value. */
  readonly guard: LoopsGuard;
  /** Where the row was read from. */
  readonly cite: string;
}

/**
 * Every lifecycle trigger, in `EVENTS` section 11's own order.
 *
 * **TWELVE, AND THE SUITE ASSERTS THE COUNT AGAINST THE DOCUMENT** rather than
 * against a number written here, which is `ADR-034`'s rule applied to the
 * transcription that would otherwise repeat `M10`'s "nine". Header section 2.
 */
export const LOOPS_TRIGGERS: readonly LoopsTrigger[] = [
  {
    eventName: 'account.provisioned',
    message: 'Welcome and platform setup',
    guard: { kind: 'none' },
    cite: 'EVENTS:400',
  },
  {
    eventName: 'phase.passed',
    message: 'Congratulations, funded, what changes now',
    guard: { kind: 'none' },
    cite: 'EVENTS:401',
  },
  {
    eventName: 'phase.pass_deferred_consistency',
    message: 'Explain the dilution mechanic honestly',
    // "throttle to once per account per week". A week is seven days, which is
    // `digests/ports.ts`'s `CADENCE_PERIOD_MS` reading of the same word.
    guard: { kind: 'throttlePerAccount', days: 7 },
    cite: 'EVENTS:402',
  },
  {
    eventName: 'breach.detected',
    message: 'Commiseration plus reset offer',
    // "suppress if the identity is restricted or has an open severity 4+ flag".
    // The 4 is the document's and not this file's.
    guard: { kind: 'suppressWhenRestrictedOrFlagged', minOpenSeverity: 4 },
    cite: 'EVENTS:403',
  },
  {
    eventName: 'payout.approved',
    message: 'Approved instantly, settlement window',
    guard: { kind: 'none' },
    cite: 'EVENTS:404',
  },
  {
    eventName: 'payout.settled',
    message: 'Paid, with the amount and the rail',
    guard: { kind: 'none' },
    cite: 'EVENTS:405',
  },
  {
    eventName: 'payout.transfer_failed',
    message: 'Honest status and what happens next',
    guard: { kind: 'alwaysSend', why: 'silence is what kills payout trust' },
    cite: 'EVENTS:406',
  },
  {
    eventName: 'payout.held',
    message: 'The fact, the ToS clause, and the date it resolves',
    guard: {
      kind: 'alwaysSend',
      why: 'The fact, the clause and the date, never the evidence and never the detector',
    },
    cite: 'EVENTS:407',
  },
  {
    eventName: 'payout.hold_released',
    message: 'Released and paying, with the amount',
    guard: { kind: 'none' },
    cite: 'EVENTS:408',
  },
  {
    eventName: 'identity.restriction_lifted',
    message: 'Access restored, and what is available again',
    guard: {
      kind: 'alwaysSend',
      why: "A restore nobody was told about is, from the trader's side, still a restriction",
    },
    cite: 'EVENTS:409',
  },
  {
    eventName: 'account.graduated',
    message: 'Ladder complete and live invitation',
    guard: { kind: 'none' },
    cite: 'EVENTS:410',
  },
  {
    eventName: 'kyc.rejected',
    message: 'What to do next',
    guard: {
      kind: 'contentRule',
      rule: "never state the provider's internal reason verbatim",
      owner: 'M16',
    },
    cite: 'EVENTS:411',
  },
];

// -----------------------------------------------------------------------------
// The contracts, in the shape of the `integration_contracts` columns
// -----------------------------------------------------------------------------

/**
 * One `integration_contracts` row, plus the provenance a row cannot carry.
 *
 * The first six members are `0018`'s columns by name. `state`, `cite` and
 * `quote` are `breaker/ports.ts`'s `PolicyNumber` shape applied to a field list:
 * a reader asking "where does this allowlist come from" gets the answer from the
 * value, and a reader asking why it is empty gets that too.
 *
 * `approved_by` and `approved_at` are ABSENT and their absence is deliberate. A
 * contract is approved "by a person, on a date" in `0018`'s own words, and no
 * person has approved these. Carrying a placeholder approver would put this
 * session's name in the column whose whole job is to say who authorised a
 * disclosure.
 */
export interface LoopsContract {
  readonly integration: typeof LOOPS_INTEGRATION;
  readonly eventName: string;
  readonly fieldAllowlist: readonly string[];
  readonly enabled: boolean;
  /** Always `null`, and header section 5 is why. */
  readonly guardExpression: null;
  readonly version: number;
  readonly state: 'declared' | 'undeclared';
  readonly cite: string;
  readonly quote: string;
}

/**
 * What the corpus says about the field list, said once because it is said
 * identically about all twelve.
 */
const ALLOWLIST_UNDECLARED = {
  state: 'undeclared',
  cite: 'M10:31 (IN-M10-03), M10:74 (SD-M10-01)',
  quote:
    'The nine EVENTS section 11 triggers, with suppression guards, and THE MINIMUM PAYLOAD EACH ' +
    'NEEDS. The corpus states that a minimum payload exists and never states what it is, so the ' +
    'allowlist is owed by an approver and is not derived here.',
} as const;

/**
 * THE ANSWER TO "WHAT ARE WE SENDING LOOPS", AND TODAY IT IS "NOTHING, AND HERE
 * IS EXACTLY WHO OWES THE DECLARATION".
 *
 * Twelve rows, one per `EVENTS` section 11 trigger, every one `undeclared`,
 * empty and disabled. `test/integrations-loops.test.ts` asserts all three
 * properties on every row, so a later session that fills an allowlist in without
 * an approver turns the suite red rather than committing quietly.
 */
export const LOOPS_CONTRACTS: readonly LoopsContract[] = LOOPS_TRIGGERS.map((trigger) => ({
  integration: LOOPS_INTEGRATION,
  eventName: trigger.eventName,
  fieldAllowlist: [],
  enabled: false,
  guardExpression: null,
  version: 1,
  ...ALLOWLIST_UNDECLARED,
}));

/** The contract for one event name, or `undefined` when the vendor has none. */
export function contractFor(eventName: string): LoopsContract | undefined {
  return LOOPS_CONTRACTS.find((contract) => contract.eventName === eventName);
}

// -----------------------------------------------------------------------------
// The forbidden set, which outranks any allowlist
// -----------------------------------------------------------------------------

/**
 * Fields the corpus forbids BY NAME, per event, whatever an allowlist says.
 *
 * Header section 4. One entry, because one is what is sourced: `EVENTS:407`
 * rules that `payout.held`'s message carries "the fact, the clause and the date,
 * never the evidence and never the detector", and `hold_flag_id` in that event's
 * payload (`EVENTS:250`) is the detector's flag and the evidence pointer at once.
 *
 * **THE POINT OF THE SECOND LAYER IS THAT IT SURVIVES THE FIRST BEING FILLED
 * IN.** An allowlist is a declaration somebody makes; this is a declaration
 * somebody already made, in a frozen document, and {@link projectForLoops}
 * REFUSES rather than quietly dropping the field, because a silent drop would
 * let a contradictory contract sit in the table looking approved.
 */
export const FORBIDDEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'payout.held': ['hold_flag_id'],
};

/** Raised when a contract permits a field the corpus forbids by name. */
export class LoopsEgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopsEgressError';
  }
}

/** Every forbidden field for one event, empty when the corpus names none. */
export function forbiddenFor(eventName: string): readonly string[] {
  return FORBIDDEN_FIELDS[eventName] ?? [];
}

// -----------------------------------------------------------------------------
// The projection
// -----------------------------------------------------------------------------

/** An event as it reaches this module: a name and the payload it carried. */
export interface LoopsEvent {
  readonly eventName: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * What the allowlist did to one event.
 *
 * `fieldsSent` is `integration_dispatches.fields_sent`, and `0018` states what
 * it means: "what actually went, not what the contract permitted. The two can
 * differ when a field is absent from a particular event." So it is the
 * INTERSECTION of the allowlist and the payload's own keys, never the allowlist.
 */
export type LoopsProjection =
  | { readonly outcome: 'no_contract'; readonly eventName: string }
  | { readonly outcome: 'undeclared'; readonly eventName: string; readonly owed: string }
  | { readonly outcome: 'not_enabled'; readonly eventName: string }
  | {
      readonly outcome: 'projected';
      readonly eventName: string;
      readonly fieldsSent: readonly string[];
      readonly body: Readonly<Record<string, unknown>>;
    };

/**
 * Apply one contract to one event.
 *
 * **THE ONLY PATH BY WHICH A FIELD REACHES `body` IS MEMBERSHIP OF
 * `fieldAllowlist`**, and there is no spread, no rest and no default case that
 * copies the payload. `admin-source/flags.ts`'s stated warning is the idiom: a
 * spread would be `SELECT *`, and here a spread would be the disclosure
 * `INV-M10-02` exists to prevent.
 *
 * A forbidden field inside an allowlist is a REFUSAL and not a filter, because
 * the contradiction is between an approver and a frozen document and only a
 * person can resolve it.
 */
export function projectForLoops(event: LoopsEvent): LoopsProjection {
  const contract = contractFor(event.eventName);
  if (contract === undefined) return { outcome: 'no_contract', eventName: event.eventName };

  if (contract.state === 'undeclared')
    return {
      outcome: 'undeclared',
      eventName: event.eventName,
      owed: `${contract.cite}: ${contract.quote}`,
    };

  if (!contract.enabled) return { outcome: 'not_enabled', eventName: event.eventName };

  return projectWith(contract, event);
}

/**
 * The projection against an EXPLICIT contract, which is how the mechanism is
 * exercised while every shipped contract is `undeclared`.
 *
 * It is exported because the alternative is a suite that can only assert that
 * nothing is sent, and `M10:372` requires the negative test to be GENERATED FROM
 * THE CONTRACT ROWS. A generated test needs a row to generate from, and today
 * the rows are empty, so the generator runs over the twelve shipped rows AND
 * over a declared row per trigger built in the suite. **A declared contract built
 * here is not a declaration**: it reaches no table, has no approver, and
 * {@link LOOPS_CONTRACTS} is what the founder reads.
 */
export function projectWith(contract: LoopsContract, event: LoopsEvent): LoopsProjection {
  if (contract.eventName !== event.eventName)
    throw new LoopsEgressError(
      `contract for ${contract.eventName} applied to ${event.eventName}: a contract is per event ` +
        'and applying one to another event would send a field nobody allowlisted for it',
    );

  const forbidden = forbiddenFor(event.eventName);
  for (const field of contract.fieldAllowlist)
    if (forbidden.includes(field))
      throw new LoopsEgressError(
        `${contract.integration} contract for ${event.eventName} allowlists \`${field}\`, which ` +
          'the corpus forbids on this event by name (EVENTS:407: never the evidence and never ' +
          'the detector). The contract and the document disagree and only a person resolves that',
      );

  const fieldsSent: string[] = [];
  const body: Record<string, unknown> = {};
  for (const field of contract.fieldAllowlist) {
    if (!Object.prototype.hasOwnProperty.call(event.payload, field)) continue;
    fieldsSent.push(field);
    body[field] = event.payload[field];
  }

  return { outcome: 'projected', eventName: event.eventName, fieldsSent, body };
}

// -----------------------------------------------------------------------------
// The guard, evaluated at send time
// -----------------------------------------------------------------------------

/**
 * The live state a guard is evaluated against, re-read immediately before the
 * send.
 *
 * `M10:232`: "Guards evaluate at send time, against live state, never at enqueue
 * (INV-M10-08). The dispatcher re-reads restriction status, open flag severity,
 * and account state immediately before the send."
 *
 * **THERE IS NO MEMBER HERE A PRODUCER COULD SET TO SAY THE GUARD ALREADY
 * PASSED**, which is `digests/ports.ts` section 1's shape: "a run that crashed
 * after writing 'success' and a run that never started are the same fact to the
 * person who did not get the digest, and here they are the same input, because
 * neither is an input at all."
 */
export interface LoopsLiveState {
  /** Whether the identity is restricted RIGHT NOW, not when the event fired. */
  readonly identityRestricted: boolean;
  /** The highest severity among the identity's OPEN flags, or `null` when none. */
  readonly maxOpenFlagSeverity: number | null;
  /** When this trigger last sent for this account, or `null` when it never has. */
  readonly lastSentAt: Date | null;
  /** The send-time clock. */
  readonly now: Date;
}

/** What a guard decided, and the `integration_dispatches.status` it implies. */
export type GuardOutcome =
  | { readonly decision: 'send'; readonly why: string }
  | { readonly decision: 'suppress'; readonly why: string; readonly status: 'dropped_by_guard' };

/** Milliseconds in one day, for the one stated cadence in this file. */
const MS_PER_DAY = 86_400_000;

/**
 * Evaluate one trigger's guard against live state.
 *
 * `alwaysSend` and `contentRule` both send, and they send for different reasons
 * that are both recorded: the first is an instruction, and the second is a rule
 * about the body that this module does not own.
 */
export function evaluateGuard(trigger: LoopsTrigger, live: LoopsLiveState): GuardOutcome {
  const guard = trigger.guard;
  switch (guard.kind) {
    case 'none':
      return { decision: 'send', why: 'no guard stated' };

    case 'alwaysSend':
      return { decision: 'send', why: guard.why };

    case 'contentRule':
      return {
        decision: 'send',
        why: `${guard.owner} owns the content rule: ${guard.rule}`,
      };

    case 'suppressWhenRestrictedOrFlagged': {
      if (live.identityRestricted)
        return {
          decision: 'suppress',
          why: 'the identity is restricted at send time',
          status: 'dropped_by_guard',
        };
      const severity = live.maxOpenFlagSeverity;
      if (severity !== null && severity >= guard.minOpenSeverity)
        return {
          decision: 'suppress',
          why: `an open flag of severity ${severity} is at or above ${guard.minOpenSeverity}`,
          status: 'dropped_by_guard',
        };
      return { decision: 'send', why: 'not restricted and no open flag at the stated severity' };
    }

    case 'throttlePerAccount': {
      const last = live.lastSentAt;
      if (last === null) return { decision: 'send', why: 'no prior send for this account' };
      const elapsed = live.now.getTime() - last.getTime();
      if (elapsed < guard.days * MS_PER_DAY)
        return {
          decision: 'suppress',
          why: `throttled: ${guard.days} days per account and the last send was inside the window`,
          status: 'dropped_by_guard',
        };
      return { decision: 'send', why: 'the throttle window has closed' };
    }
  }
}

// -----------------------------------------------------------------------------
// The dispatch decision, which is guard THEN allowlist and never the reverse
// -----------------------------------------------------------------------------

/** The trigger for one event name, or `undefined` when the event is not one. */
export function triggerFor(eventName: string): LoopsTrigger | undefined {
  return LOOPS_TRIGGERS.find((trigger) => trigger.eventName === eventName);
}

/** What a dispatch attempt resolved to, before anything leaves the building. */
export type LoopsDispatchDecision =
  | { readonly outcome: 'not_a_trigger'; readonly eventName: string }
  | {
      readonly outcome: 'suppressed';
      readonly eventName: string;
      readonly why: string;
      readonly status: 'dropped_by_guard';
    }
  | { readonly outcome: 'no_contract'; readonly eventName: string }
  | { readonly outcome: 'undeclared'; readonly eventName: string; readonly owed: string }
  | { readonly outcome: 'not_enabled'; readonly eventName: string }
  | {
      readonly outcome: 'dispatch';
      readonly eventName: string;
      readonly fieldsSent: readonly string[];
      readonly body: Readonly<Record<string, unknown>>;
      readonly why: string;
    };

/**
 * Decide one dispatch. It sends nothing: there is no vendor and no endpoint
 * (header section 7), and what this returns is what a sender would be given.
 *
 * **THE GUARD RUNS FIRST AND THE ORDER IS THE CONTROL**, which is
 * `breaker/evaluate.ts`'s ladder read on a different subject: a suppressed
 * message must not be projected, because a projected body is a body that exists,
 * and a body that exists is one edit away from being sent. `AS-M10-03`'s
 * scenario is a message whose body was fine and whose recipient had changed.
 *
 * `live` is REQUIRED and this is the only dispatch entry point, so there is no
 * signature a caller can reach without having re-read live state.
 */
export function dispatchToLoops(event: LoopsEvent, live: LoopsLiveState): LoopsDispatchDecision {
  const trigger = triggerFor(event.eventName);
  if (trigger === undefined) return { outcome: 'not_a_trigger', eventName: event.eventName };

  const guard = evaluateGuard(trigger, live);
  if (guard.decision === 'suppress')
    return {
      outcome: 'suppressed',
      eventName: event.eventName,
      why: guard.why,
      status: guard.status,
    };

  const projection = projectForLoops(event);
  switch (projection.outcome) {
    case 'no_contract':
      return { outcome: 'no_contract', eventName: projection.eventName };
    case 'undeclared':
      return { outcome: 'undeclared', eventName: projection.eventName, owed: projection.owed };
    case 'not_enabled':
      return { outcome: 'not_enabled', eventName: projection.eventName };
    case 'projected':
      return {
        outcome: 'dispatch',
        eventName: projection.eventName,
        fieldsSent: projection.fieldsSent,
        body: projection.body,
        why: guard.why,
      };
  }
}

// -----------------------------------------------------------------------------
// The numbers, and the one this slice does not have
// -----------------------------------------------------------------------------

/**
 * A number the corpus states, with the source it was read from.
 *
 * `breaker/ports.ts`'s `PolicyNumber` in this module's own file, because `P7`
 * section 11 rule 10 and `ADR-165` keep these modules from importing each other
 * and a shared type would be a leg neither barrel owns.
 */
export type DispatchNumber =
  | {
      readonly state: 'stated';
      readonly value: number;
      readonly cite: string;
      readonly quote: string;
    }
  | {
      readonly state: 'unstated';
      readonly value: null;
      readonly cite: string;
      readonly quote: string;
    };

/** What a Loops dispatch would run under. One number stated, one not. */
export interface LoopsDispatchPolicy {
  /** `EVENTS:402`'s throttle, in days. Stated. */
  readonly throttleDays: DispatchNumber;
  /** `EVENTS:403`'s open-flag floor. Stated. */
  readonly suppressAtSeverity: DispatchNumber;
  /** Attempts before dead-letter. `unstated`, and header section 7 is why. */
  readonly maxAttempts: DispatchNumber;
}

/**
 * The shipped policy.
 *
 * `test/integrations-loops.test.ts` asserts `maxAttempts` is still `unstated`,
 * so filling it in is a red suite rather than a quiet commit, and asserts the two
 * stated numbers match the guards transcribed above so the two transcriptions of
 * the same document cannot drift apart.
 */
export const LOOPS_DISPATCH_POLICY: LoopsDispatchPolicy = {
  throttleDays: {
    state: 'stated',
    value: 7,
    cite: 'EVENTS:402',
    quote: 'throttle to once per account per week',
  },
  suppressAtSeverity: {
    state: 'stated',
    value: 4,
    cite: 'EVENTS:403',
    quote: 'suppress if the identity is restricted or has an open severity 4+ flag',
  },
  maxAttempts: {
    state: 'unstated',
    value: null,
    cite: 'M10:96, 0018_integrations.sql',
    quote:
      'retrying --> dead_letter: attempts exhausted. The transition is drawn and no number is ' +
      'stated, and `attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)` carries no ' +
      'ceiling. A budget invented here would be a retry policy nobody ruled on.',
  },
};
