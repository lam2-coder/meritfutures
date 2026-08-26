// =============================================================================
// packages/kyc/src/triggers.ts
// =============================================================================
// ADR-021's COMPOSITE TRIGGER SET, WHICH IS RULED AND IS TRANSCRIBED HERE
// RATHER THAN REASONED FROM SCRATCH.
//
//   "Placement becomes a set of trigger events rather than a single point.
//    Verification fires at whichever of the configured triggers is reached
//    FIRST." (ADR-021)
//
//   "RULED at the FREEZE gate: the trigger set is
//    `{second_distinct_account_purchase, pre_funded}`, earliest fires."
//   (M19 section 1.2.1)
//
// NOTHING HERE RE-DECIDES WHERE KYC SITS. What this file decides is the two
// questions a ruled set leaves to whoever implements it, and both are in
// ADR-114: what happens when two configured triggers become true in the SAME
// evaluation, and what a configuration this reader will not accept looks like.
//
// -----------------------------------------------------------------------------
// `kyc.triggers` HAS HAD NO TYPED HOME ANYWHERE IN THIS WORKSPACE UNTIL NOW
// -----------------------------------------------------------------------------
// ADR-030 ruled the key an array. `packages/rules-engine/src/types.ts` excludes
// it deliberately -- M01 section 1.2 puts KYC outside that module and "what
// `validatePlan` may not see, it may not validate" -- and session 168's finding
// D5 states the consequence: INV-M19-01's "read from the account's PINNED plan
// version" had no reader and no type. `readTriggerConfig` is the first one.
//
// IT IS A READER AND NOT A VALIDATOR OF THE PLAN. The plan-config audit records
// that `kyc.triggers` carries no `CV-nn` and no database constraint BY DESIGN,
// so this function refuses at the point of USE rather than at publish time, and
// says so in every message it throws.
//
// -----------------------------------------------------------------------------
// WHY A SNAPSHOT CAN ANSWER A QUESTION ABOUT TIME: MONOTONICITY
// -----------------------------------------------------------------------------
// "Earliest fires" is a statement about WHEN. This file evaluates a set of
// facts as they stand, which is a statement about NOW, and the two agree only
// because every condition below is MONOTONE: a purchase count never falls, a
// second concurrent account having existed is not undone by closing one, and an
// evaluation pass is latched. Under monotone conditions the earliest-reached
// trigger of a snapshot IS the earliest-in-time trigger, so a trader who is
// evaluated late is attributed to the trigger that actually fired first.
//
// A NON-MONOTONE TRIGGER ADDED LATER SILENTLY BREAKS THAT, and the property
// test beside this file is what would catch it. ADR-114 clause 1.
// =============================================================================

/**
 * The trigger vocabulary, CLOSED, and this package did not choose it.
 *
 * It is `kyc_verifications.placement`'s CHECK list (`0003_kyc.sql:77-85`) and
 * `kyc_funnel_events.placement`'s (`0003_kyc.sql:222-230`), which are the same
 * seven values in the same order. `pre_eval` is NOT a member: `0003` retires it
 * into `first_purchase` because they name the same moment and ADR-021's
 * vocabulary is the later one.
 *
 * AN EIGHTH MEMBER IS A MIGRATION BEFORE IT IS A TYPE CHANGE, which is
 * `PspId`'s reasoning one package over, on a column that carries a CHECK.
 */
export type KycTrigger =
  | 'first_purchase'
  | 'second_distinct_account_purchase'
  | 'second_purchase_any'
  | 'eval_pass'
  | 'pre_funded'
  | 'direct_purchase'
  | 'payout_request';

/**
 * THE FIRING ORDER, WHICH IS FUNNEL ORDER AND IS THE CHECK'S ORDER WITH ONE
 * MEMBER MOVED.
 *
 * The corpus writes this vocabulary three times -- ADR-021's table, M19 section
 * 1.2.1's table, and `0003`'s CHECK list -- and all three agree, in the order a
 * trader reaches the moments: first purchase, second purchase, evaluation,
 * payout.
 *
 * `direct_purchase` IS THE ONE MEMBER WHOSE LIST POSITION DISAGREES WITH ITS
 * MOMENT, and it is moved to the front here rather than left where the CHECK
 * writes it. The CHECK groups it with the configured placements; its moment is
 * PURCHASE, and INV-M19-02 is that "Direct and any instant-funded plan verify
 * at purchase, and no configuration can move that". A member that fires
 * earliest and sorts fifth would lose every tie it must win.
 *
 * `eval_pass` AND `pre_funded` NAME ONE MOMENT and ADR-021 writes them in one
 * row (`eval_pass` / `pre_funded`). They are two CHECK members, so a
 * configuration could name both; the order below is the CHECK's, and a set
 * carrying both is accepted with `eval_pass` naming the firing rather than
 * refused, because refusing it would be a ruling ADR-021 did not take.
 */
export const KYC_TRIGGERS_IN_FIRING_ORDER: readonly KycTrigger[] = [
  'direct_purchase',
  'first_purchase',
  'second_distinct_account_purchase',
  'second_purchase_any',
  'eval_pass',
  'pre_funded',
  'payout_request',
];

/**
 * The same seven values in the order the CHECK constraint writes them.
 *
 * Kept separately from the firing order so the difference between the two is a
 * thing a reader can see rather than a thing a reader has to notice. A stored
 * `placement` is compared against THIS list, and a firing is chosen with the
 * other one.
 */
export const KYC_TRIGGERS_AS_CHECKED: readonly KycTrigger[] = [
  'first_purchase',
  'second_distinct_account_purchase',
  'second_purchase_any',
  'eval_pass',
  'pre_funded',
  'direct_purchase',
  'payout_request',
];

/**
 * The frozen v1 configuration, ruled at the FREEZE gate.
 *
 * M19 section 1.2.1 and `0003_kyc.sql:71-72`. IT IS NOT A DEFAULT AND NOTHING
 * IN THIS FILE FALLS BACK TO IT: the value that governs an account is the one
 * on its PINNED plan version (INV-M19-01), and a reader that substituted this
 * constant for a missing key would gate a trader under a configuration nobody
 * pinned. It is exported so a fixture and a seed row can name one thing.
 */
export const FROZEN_V1_TRIGGERS: readonly KycTrigger[] = [
  'second_distinct_account_purchase',
  'pre_funded',
];

/** Raised when `kyc.triggers` is something this reader will not act on. */
export class KycConfigError extends Error {
  constructor(message: string) {
    super(`${message} (kyc.triggers, ADR-021 and ADR-030; INV-M19-01)`);
    this.name = 'KycConfigError';
  }
}

function isTrigger(value: unknown): value is KycTrigger {
  return (
    typeof value === 'string' && (KYC_TRIGGERS_AS_CHECKED as readonly string[]).includes(value)
  );
}

/**
 * Read `kyc.triggers` off a pinned plan version's config, or refuse.
 *
 * IT REFUSES RATHER THAN DEFAULTS, on every one of the five shapes below, and
 * the reason is INV-M19-01: placement is "read from the account's pinned plan
 * version at the moment the gate evaluates, and is never hardcoded". A reader
 * that filled in a missing or malformed key would be the hardcode, arriving
 * through the door the invariant was written to lock.
 *
 * THE RETURN IS NORMALISED INTO FIRING ORDER, so two plan versions that list
 * the same set in different orders produce the same evaluation and the same
 * stored `placement`. A configuration is a SET and ADR-021 says so; the order
 * a person typed it in is not part of the ruling.
 *
 * @throws {KycConfigError} on a non-array, an empty array, an unknown member, a
 * repeated member, `direct_purchase` (which is not configurable, INV-M19-02),
 * or `payout_request` alone (invalid as a sole trigger, ADR-021).
 */
export function readTriggerConfig(value: unknown): readonly KycTrigger[] {
  if (!Array.isArray(value)) {
    throw new KycConfigError(
      `is an ARRAY under ADR-030 and this plan version carries \`${typeof value}\`. ` +
        'ADR-030 renamed the singular `kyc.placement` for exactly this reason',
    );
  }
  if (value.length === 0) {
    throw new KycConfigError(
      'is empty on this plan version, which is a plan that gates nobody. ' +
        'A set with no members is a decision and it is not one this reader may take',
    );
  }

  const seen = new Set<KycTrigger>();
  for (const member of value) {
    if (!isTrigger(member)) {
      throw new KycConfigError(
        `carries \`${JSON.stringify(member)}\`, which is not one of ` +
          `${KYC_TRIGGERS_AS_CHECKED.join(', ')}. \`pre_eval\` is retired into ` +
          "`first_purchase` and `0003_kyc.sql`'s CHECK refuses it",
      );
    }
    if (seen.has(member)) {
      throw new KycConfigError(
        `names \`${member}\` twice. It is a SET, and a repeated member is a plan ` +
          'edit that did not do what its author thought it did',
      );
    }
    seen.add(member);
  }

  if (seen.has('direct_purchase')) {
    throw new KycConfigError(
      'names `direct_purchase`, which is NOT CONFIGURABLE. INV-M19-02: Direct and ' +
        'any instant-funded plan verify at purchase because funding is immediate and ' +
        "there is no later gate to move to. It fires from the plan's SHAPE and a " +
        'configuration that appears to grant it also appears to be able to withhold it',
    );
  }
  if (seen.size === 1 && seen.has('payout_request')) {
    throw new KycConfigError(
      'is `payout_request` ALONE, which ADR-021 rules INVALID as a sole trigger. ' +
        'Verification first demanded at payout time is the zero-denial policy meeting ' +
        'a wall: the trader has earned the money and the gate is new to them. It is ' +
        'retained only as the backstop that fires when an earlier trigger did not',
    );
  }

  return KYC_TRIGGERS_IN_FIRING_ORDER.filter((trigger) => seen.has(trigger));
}

/**
 * What the gate is evaluated against, and every field is a fact somebody else
 * measured.
 *
 * NOTHING HERE IS A ROW AND NOTHING HERE IS A HANDLE. This package reads no
 * database, which is what lets `apps/api` and `apps/worker` evaluate the same
 * gate from two processes without either of them owning the other's query.
 */
export interface GateFacts {
  /**
   * The pinned plan version's `kyc.triggers`, already through
   * {@link readTriggerConfig}. INV-M19-01: the account's PINNED version, so a
   * trader who bought under one set keeps it, exactly as they keep their pinned
   * rules (B4 #12).
   */
  readonly triggers: readonly KycTrigger[];
  /** `plans.code`. `kyc_funnel_events.plan_code` is `NOT NULL`. */
  readonly planCode: string;
  /**
   * Whether the pinned plan funds immediately. INV-M19-02, and it is read from
   * the plan's shape rather than from `triggers`, which is why
   * {@link readTriggerConfig} refuses `direct_purchase` as a configured member.
   */
  readonly instantFunded: boolean;
  /** Purchases by this identity, RESETS INCLUDED. `second_purchase_any`'s input. */
  readonly purchaseCount: number;
  /**
   * Distinct CONCURRENT accounts this identity has held.
   *
   * IT IS A HIGH-WATER COUNT AND NOT A LIVE ONE, and that is monotonicity
   * rather than pedantry: a fleet operator who closes one account has still
   * been a second-account holder, and a live count would let the trigger
   * UN-fire. See this file's header.
   */
  readonly distinctConcurrentAccounts: number;
  /** An evaluation has passed. Latched: `eval_pass` and `pre_funded`'s input. */
  readonly evaluationPassed: boolean;
  /** A payout has been requested. The backstop's input. */
  readonly payoutRequested: boolean;
}

/**
 * Whether one trigger's condition holds on these facts.
 *
 * EVERY BRANCH IS MONOTONE IN ITS INPUTS and the type cannot say so, so the
 * property test does. Adding a branch that can go from true back to false makes
 * the earliest-fires guarantee false without any type or assertion here moving.
 */
export function triggerConditionHolds(trigger: KycTrigger, facts: GateFacts): boolean {
  switch (trigger) {
    case 'direct_purchase':
      // INV-M19-02. The purchase is the moment, so it needs one to have happened.
      return facts.instantFunded && facts.purchaseCount >= 1;
    case 'first_purchase':
      return facts.purchaseCount >= 1;
    case 'second_distinct_account_purchase':
      // "A purchase creating a SECOND CONCURRENT account" (M19 section 1.2.1).
      // The fleet-operator trigger, and the population `pre_funded` misses.
      return facts.distinctConcurrentAccounts >= 2;
    case 'second_purchase_any':
      // "Any second purchase, INCLUDING RESETS." ADR-021 condition 4 is that
      // this is written into the config's own documentation, because a trader
      // who resets once is a second purchaser without being a second-account
      // holder, which is a different population entirely.
      return facts.purchaseCount >= 2;
    case 'eval_pass':
    case 'pre_funded':
      return facts.evaluationPassed;
    case 'payout_request':
      return facts.payoutRequested;
  }
}

/**
 * The effective set: what is configured, PLUS what the plan's shape imposes.
 *
 * `direct_purchase` IS ADDED HERE AND CANNOT BE REMOVED BY CONFIGURATION, which
 * is INV-M19-02 expressed as an operation rather than as a sentence a reviewer
 * has to remember. {@link readTriggerConfig} refuses it on the way in; this
 * function puts it back on the way out, for instant-funded plans only.
 */
export function effectiveTriggers(facts: GateFacts): readonly KycTrigger[] {
  const set = new Set<KycTrigger>(facts.triggers);
  if (facts.instantFunded) set.add('direct_purchase');
  return KYC_TRIGGERS_IN_FIRING_ORDER.filter((trigger) => set.has(trigger));
}

/** What the gate concluded. */
export type GateEvaluation =
  | {
      readonly kind: 'reached';
      /**
       * THE ONE VALUE THAT REACHES `kyc_verifications.placement`, which is
       * `NOT NULL` under a CHECK, so exactly one of the reached set must be it.
       */
      readonly trigger: KycTrigger;
      /**
       * Every trigger whose condition holds, in firing order. Reported rather
       * than discarded: ADR-021's condition 1 is per-trigger funnel telemetry,
       * and "which others were also true" is the measurement that tells a
       * later adjudication whether a trigger is carrying its own weight.
       */
      readonly alsoReached: readonly KycTrigger[];
    }
  | { readonly kind: 'not_reached'; readonly effective: readonly KycTrigger[] };

/**
 * Evaluate the composite set. THE EARLIEST OF WHAT IS REACHED FIRES.
 *
 * TWO THINGS ARE HAPPENING AND THEY ARE DIFFERENT. Across occasions, "earliest"
 * is time and this function delivers it by monotonicity (see the header).
 * Within one occasion, two configured triggers can both be true and one value
 * must be written, so the tie is broken by {@link KYC_TRIGGERS_IN_FIRING_ORDER}
 * and the earlier-in-funnel trigger names the firing. ADR-114 clause 1.
 *
 * THE TIE-BREAK ALSO PREFERS THE MORE SPECIFIC TRIGGER, WHICH IS NOT A COINCIDENCE.
 * A purchase that creates a second concurrent account satisfies both
 * `second_distinct_account_purchase` and `second_purchase_any`; the first sorts
 * earlier and names the firing, which is the one the fleet-coverage argument
 * cares about and the one whose population is worth counting.
 */
export function evaluateGate(facts: GateFacts): GateEvaluation {
  const effective = effectiveTriggers(facts);
  const reached = effective.filter((trigger) => triggerConditionHolds(trigger, facts));
  const first = reached[0];
  if (first === undefined) return { kind: 'not_reached', effective };
  return { kind: 'reached', trigger: first, alsoReached: reached };
}
