// =============================================================================
// packages/rules-engine/src/plan/rules-codec.ts
// =============================================================================
// `plan_versions.rules`, THE READ DIRECTION ONLY. This file turns the stored
// `jsonb` document into the `PlanRulesJson` that `resolvePlan` and `validatePlan`
// already declare, and it decides nothing about the shape: every key below is
// read out of DATA_MODEL section 11's example and out of `types.ts`, which
// transcribed the same example key for key.
//
// -----------------------------------------------------------------------------
// 1. WHY THE DECODER IS HERE, WHICH IS ADR-239 SLICE A UNCHANGED
// -----------------------------------------------------------------------------
// TWO deployables already state this one predicate and neither can import the
// other: `toPublishedRules` (`apps/worker/src/batch/adapter.ts`) reads the
// column for the nightly fold, and `decodeRules` (`apps/site/src/catalog/adapter.ts`)
// reads the same document off the catalogue response for the marketing page.
// Both return the engine's own `PlanRulesJson`, both read the SAME stored
// document under the SAME key spelling, and NOTHING compares them. That is
// `FM-16` by name, over the blob that fixes every cents value a payout is
// decided against.
//
// `packages/rules-engine` declares no workspace dependency at all (`RI-01`), so
// it is the only place both arrows already point, and it is where `ADR-250` put
// `gates-codec.ts` on exactly this argument. `ADR-281` ruling 4 registered this
// move and could not take it, because that row's fence stopped at `apps/api`.
//
// **THE TWO EXISTING COPIES ARE NOT RETIRED BY THIS FILE AND THAT IS A FENCE
// FACT RATHER THAN A JUDGEMENT.** `apps/worker/src/**` and `apps/site/src/**`
// are outside row `283`'s fence. Until they are collapsed onto this function
// the tree states one predicate THREE times, which is worse than two by one
// and better than two by having a home; `ADR-283` section 7 registers the
// retirement as the row that follows, and
// `apps/api/test/rule-state-producibility.test.ts` link 7 holds the census at
// exactly three so a FOURTH cannot arrive unnoticed.
//
// -----------------------------------------------------------------------------
// 2. THE ONE PROPERTY THIS CODEC DOES NOT SHARE WITH `gates-codec.ts`
// -----------------------------------------------------------------------------
// `decodeEngineGates` refuses an UNDECLARED key by name, because
// `rule_states.engine_gates` is the replay audit's left-hand side: every one of
// its twenty-five leaves enters `state_hash` column 19, so a stray key is a bag
// that does not hash.
//
// **THIS DOCUMENT IS A SUPERSET BY CONSTRUCTION AND THE SAME CHECK WOULD REFUSE
// THE CORPUS'S OWN EXAMPLE.** DATA_MODEL section 11 carries `limits` and `kyc`
// beside the two phases, and `types.ts` says in terms why `PlanRulesJson` does
// not: "M01 section 1.2 puts entitlement and KYC outside this module, and a type
// that carried them would invite a rule to read them. What `validatePlan` may
// not see, it may not validate." So an undeclared key is a key belonging to
// ANOTHER module, and refusing it here would be this module claiming the whole
// document.
//
// Every DECLARED key is still read by name and refused by type, and no key is
// ever reached by iteration (`M01` section 1.4). What is given up is the
// stray-key half, deliberately, once, with the document as the reason.
//
// -----------------------------------------------------------------------------
// 3. CENTS ARE JSON NUMBERS HERE AND BASE-10 STRINGS IN `gates-codec.ts`
// -----------------------------------------------------------------------------
// That is not an inconsistency to be tidied. `ADR-206` RULED the stored
// `engine_gates` rendering and chose strings because `ADR-206` section 5
// measured a `Cents` past `Number.MAX_SAFE_INTEGER` coming back wrong through
// the read port. **THIS COLUMN'S RENDERING IS ALREADY RULED AND IT IS A NUMBER**:
// DATA_MODEL section 11 writes `"min_payout_cents": 10000` and
// `"at_profit_cents": null`, and a decoder that demanded a string would refuse
// every row written to the document that specifies the column.
//
// So the ceiling is stated rather than dissolved: a cents value in this document
// above `Number.MAX_SAFE_INTEGER` is REFUSED rather than rounded, on `hash.ts`'s
// own test and on `INV-02`. A base-10 string is ALSO accepted, because both
// existing decoders accept one and a `jsonb` writer that renders money as text
// is producing a value this codec can read exactly; what is refused is a number
// that has already lost digits by the time it arrives.
//
// -----------------------------------------------------------------------------
// 4. NO `CV-nn` IS RE-RUN HERE, AND THAT IS A RULING RATHER THAN AN OMISSION
// -----------------------------------------------------------------------------
// `validatePlan(rules: PlanRulesJson, sizes: readonly PlanVersionSizeRow[])`
// (`plan/validate.ts`) TAKES THE DECODED TYPE, so "re-run the publish validation
// instead of decoding" is not an option that exists: decoding is strictly prior
// to it and this file is that step.
//
// **AND IT CANNOT BE RUN AT READ EVEN AFTER DECODING, BECAUSE IT NEEDS EVERY
// SIZE OF THE VERSION.** `validate.ts`'s own header: "A VALIDATOR HANDED ONE
// SIZE AT A TIME COULD NOT SEE THE PLAN. CV-11 and CV-12 are inequalities across
// the jsonb and one size row; every size must satisfy them independently." A
// payout read holds the account's ONE pinned size, so a `validatePlan` call
// there would return an `ok` about a different question from the one the publish
// gate answered, and an `ok` nobody may rely on is worse than no call.
//
// So the read trusts the publish gate for the nineteen, and the read-time floor
// is what `resolvePlan` ALREADY refuses on its own: `CV-01` (an
// `intraday_trailing` drawdown), `CV-03` (an enabled eval phase with no profit
// target), `CV-06` (an enabled consistency rule with a null share), `CV-16` (a
// loss-limit type outside the vocabulary, or one with no cents) and `SD-10` (a
// lock enabled with a missing bound). Those five are the ones whose violation
// would otherwise produce a WRONG `ResolvedPlan` rather than a refused one.
//
// **WHAT HAPPENS TO A ROW PUBLISHED BEFORE A VALIDATION RULE EXISTED**: it
// decodes if it is structurally the document, it is refused at read only where
// `resolvePlan` refuses, and the remaining `CV-nn` are NOT re-checked. That is
// stated here rather than left to be discovered, and `ADR-283` section 4 names
// the unchecked set. **A KEY THAT IS ABSENT IS REFUSED AND NEVER DEFAULTED**,
// which is `ADR-258` section 6's ruling one field over: a default is a plan
// parameter written into application code, and it is invisible.
// =============================================================================

import type {
  Cents,
  PlanRulesJson,
  PublishedCapScheduleStep,
  PublishedConsistency,
  PublishedDailyLossLimit,
  PublishedDrawdown,
  PublishedDrawdownType,
  PublishedEvalPhase,
  PublishedFloorLock,
  PublishedFundedPhase,
  PublishedWinDays,
} from '../types.ts';

/**
 * A `plan_versions.rules` document was not the shape DATA_MODEL section 11
 * rules.
 *
 * IT CARRIES THE DOTTED PATH, on `EngineGatesCodecError`'s reason unchanged: the
 * value that came back wrong is read by somebody holding a row, and a key name
 * is the only thing that locates the defect in it. `$` is the document itself.
 */
export class PlanRulesCodecError extends Error {
  /** Where in the document the offending value sits, from `$`. */
  readonly path: string;

  // Assigned rather than declared in the parameter list, and that is a RUNTIME
  // requirement rather than a style. `ADR-083` rules that every deployable runs
  // under `node --experimental-strip-types`, which erases types and rewrites
  // nothing: a TypeScript parameter property is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
  // at load time and `tsc --noEmit` accepts it, so the failure is invisible to
  // `CI-01`. `gates-codec.ts` records the same finding.
  constructor(path: string, why: string) {
    super(`plan_versions.rules at ${path}: ${why}`);
    this.name = 'PlanRulesCodecError';
    this.path = path;
  }
}

/** `CV-01`'s vocabulary, WIDER by one than `DrawdownType`. R-17 is the third. */
const DRAWDOWN_TYPES = [
  'trailing_eod',
  'static',
  'intraday_trailing',
] as const satisfies readonly PublishedDrawdownType[];

/** `CV-06`'s two modes, "so nobody has to remember which phase behaves how". */
const CONSISTENCY_MODES = [
  'pass_time_dilutable',
  'payout_gated',
] as const satisfies readonly PublishedConsistency['mode'][];

// -----------------------------------------------------------------------------
// The leaf readers, each of which refuses rather than coercing
// -----------------------------------------------------------------------------
// THE INPUT IS `unknown` AND IT MEANS IT. What arrives is whatever `jsonb` gave
// the driver: a row written by a build that is not this one, by a backfill, or
// by hand in `psql`. A decoder that trusted it would hand `resolvePlan` a
// document with a `NaN` in it and the payout basis would be computed off that.

/** What a value IS, for a message, without ever printing the value itself. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new PlanRulesCodecError(path, `expected an object and found ${describe(value)}`);
  return value as Record<string, unknown>;
}

/**
 * One DECLARED key, whose ABSENCE is refused.
 *
 * `hasOwnProperty` RATHER THAN `!== undefined`, because a stored document may
 * legally carry a null and a missing key must not read as one: `max_days: null`
 * means unlimited (DATA_MODEL section 11) and an absent `max_days` means a row
 * this build cannot fold. `ADR-258` section 6 is the standing ruling and
 * `min_settlement_lag_trading_days` is the field it was made on.
 */
function owed(bag: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(bag, key))
    throw new PlanRulesCodecError(`${path}.${key}`, 'is absent, and no key here takes a default');
  return bag[key];
}

function flag(bag: Record<string, unknown>, key: string, path: string): boolean {
  const value = owed(bag, key, path);
  if (typeof value !== 'boolean')
    throw new PlanRulesCodecError(
      `${path}.${key}`,
      `expected a boolean and found ${describe(value)}`,
    );
  return value;
}

/**
 * A basis-point figure, a day count or an ordinal.
 *
 * `Number.isSafeInteger` IS THE TEST `hash.ts` AND `gates-codec.ts` BOTH APPLY,
 * and it is applied here for their reason: a non-integer is refused rather than
 * rounded, and it disposes of `NaN` and both infinities, which `JSON.parse`
 * never produces but `jsonb` reaches through other writers.
 */
function integer(bag: Record<string, unknown>, key: string, path: string): number {
  const value = owed(bag, key, path);
  if (typeof value !== 'number')
    throw new PlanRulesCodecError(
      `${path}.${key}`,
      `expected a number and found ${describe(value)}`,
    );
  if (!Number.isSafeInteger(value))
    throw new PlanRulesCodecError(
      `${path}.${key}`,
      'expected a safe integer, which is the test `hash.ts` applies to the same kind of leaf',
    );
  return value;
}

/** `null` is JSON `null` and is a VALUE here: `max_days: null` means unlimited. */
function nullableInteger(bag: Record<string, unknown>, key: string, path: string): number | null {
  return owed(bag, key, path) === null ? null : integer(bag, key, path);
}

/**
 * A `Cents` leaf of this document.
 *
 * **THE RENDERING IS THE ONE DATA_MODEL SECTION 11 WRITES, WHICH IS A JSON
 * NUMBER**, and section 3 of this file's header is why a base-10 string is
 * accepted beside it rather than instead of it. A number that is not a safe
 * integer has already lost digits by the time it arrives, so it is refused with
 * the ceiling named; a string is read through `BigInt` and must be the base-10
 * rendering of the integer it holds, which admits nothing a `JSON.stringify` of
 * a `Cents` could not have produced.
 */
function cents(bag: Record<string, unknown>, key: string, path: string): Cents {
  const value = owed(bag, key, path);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new PlanRulesCodecError(
        `${path}.${key}`,
        'is not a safe integer, so it has already lost digits: integer cents past ' +
          '`Number.MAX_SAFE_INTEGER` must be stored as a base-10 string (INV-02)',
      );
    return BigInt(value);
  }
  if (typeof value === 'string') {
    let parsed: bigint;
    try {
      parsed = BigInt(value);
    } catch {
      throw new PlanRulesCodecError(`${path}.${key}`, 'is not a base-10 integer');
    }
    if (parsed.toString(10) !== value)
      throw new PlanRulesCodecError(
        `${path}.${key}`,
        'is not the base-10 rendering of the integer it holds',
      );
    return parsed;
  }
  throw new PlanRulesCodecError(
    `${path}.${key}`,
    `expected integer cents as a number or a base-10 string and found ${describe(value)}`,
  );
}

function nullableCents(bag: Record<string, unknown>, key: string, path: string): Cents | null {
  return owed(bag, key, path) === null ? null : cents(bag, key, path);
}

function text(bag: Record<string, unknown>, key: string, path: string): string {
  const value = owed(bag, key, path);
  if (typeof value !== 'string')
    throw new PlanRulesCodecError(
      `${path}.${key}`,
      `expected a string and found ${describe(value)}`,
    );
  return value;
}

/**
 * A closed vocabulary, compared MEMBER BY MEMBER and never by set membership on
 * a key list, so this is not the iteration `M01` section 1.4 bans.
 */
function member<T extends string>(
  bag: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const found = text(bag, key, path);
  for (const one of allowed) if (one === found) return one;
  throw new PlanRulesCodecError(
    `${path}.${key}`,
    `is "${found}", which is outside {${allowed.join(', ')}}`,
  );
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new PlanRulesCodecError(path, `expected an array and found ${describe(value)}`);
  return value;
}

// -----------------------------------------------------------------------------
// The groups, written out once and reached by name
// -----------------------------------------------------------------------------

function decodeFloorLock(value: unknown, path: string): PublishedFloorLock {
  const bag = object(value, path);
  return {
    enabled: flag(bag, 'enabled', path),
    // BOTH ARE `null` ON ALL THREE V1 PLANS and that is not an omission: the
    // values live on `plan_version_sizes` because they scale with size, and
    // `CV-11` and `CV-12` read the SIZE ROW. The keys are carried because the
    // document carries them.
    at_profit_cents: nullableCents(bag, 'at_profit_cents', path),
    floor_at_cents: nullableCents(bag, 'floor_at_cents', path),
  };
}

function decodeDrawdown(value: unknown, path: string): PublishedDrawdown {
  const bag = object(value, path);
  return {
    // THE THIRD MEMBER IS ADMITTED HERE AND REFUSED BY `resolvePlan`, which is
    // R-17 arriving where CV-01 put it. A decoder that narrowed to two would
    // make that refusal unreachable and its test vacuous, which is the shape
    // `types.ts` spends a paragraph refusing at the type.
    type: member(bag, 'type', DRAWDOWN_TYPES, path),
    amount_bp: integer(bag, 'amount_bp', path),
    lock: decodeFloorLock(owed(bag, 'lock', path), `${path}.lock`),
  };
}

function decodeDailyLossLimit(value: unknown, path: string): PublishedDailyLossLimit {
  const bag = object(value, path);
  return {
    // `CV-16`'s VOCABULARY IS NOT NARROWED HERE and the type says so: the field
    // is `string`, `validatePlan` is what rejects a member outside
    // {none, soft, hard}, and `resolvePlan` refuses one arriving anyway. A
    // decoder that closed the union would take CV-16's job and leave its test
    // unable to construct a violation.
    type: text(bag, 'type', path),
    amount_bp: nullableInteger(bag, 'amount_bp', path),
  };
}

function decodeConsistency(value: unknown, path: string): PublishedConsistency {
  const bag = object(value, path);
  return {
    enabled: flag(bag, 'enabled', path),
    max_day_share_bp: nullableInteger(bag, 'max_day_share_bp', path),
    mode: member(bag, 'mode', CONSISTENCY_MODES, path),
  };
}

function decodeWinDays(value: unknown, path: string): PublishedWinDays {
  const bag = object(value, path);
  return {
    required_count: integer(bag, 'required_count', path),
    floor_bp: integer(bag, 'floor_bp', path),
    reset_on_payout: flag(bag, 'reset_on_payout', path),
  };
}

/**
 * `CV-09`'s structural half.
 *
 * AN ARRAY FROM DAY ONE even though v1 has one step, per DATA_MODEL section 11:
 * "progressive cap release is a known v1.1 candidate and turning a scalar into a
 * schedule later is a migration plus a config rewrite". THE ORDER IS NOT SORTED
 * HERE: `resolvePlan` sorts the SIZE ROW's schedule because `capForOrdinal`
 * needs a rung, and this array carries `cap_bp` rather than cents and is read by
 * `validatePlan` alone.
 */
function decodeCapSchedule(value: unknown, path: string): readonly PublishedCapScheduleStep[] {
  return list(value, path).map((step, index) => {
    const at = `${path}[${String(index)}]`;
    const bag = object(step, at);
    return {
      from_ordinal: integer(bag, 'from_ordinal', at),
      cap_bp: integer(bag, 'cap_bp', at),
    };
  });
}

function decodeEvalPhase(value: unknown, path: string): PublishedEvalPhase {
  const bag = object(value, path);
  return {
    enabled: flag(bag, 'enabled', path),
    profit_target_bp: integer(bag, 'profit_target_bp', path),
    drawdown: decodeDrawdown(owed(bag, 'drawdown', path), `${path}.drawdown`),
    daily_loss_limit: decodeDailyLossLimit(
      owed(bag, 'daily_loss_limit', path),
      `${path}.daily_loss_limit`,
    ),
    min_trading_days: integer(bag, 'min_trading_days', path),
    consistency: decodeConsistency(owed(bag, 'consistency', path), `${path}.consistency`),
    // `null` MEANS UNLIMITED, which is every v1 plan, and it is why `owed` tests
    // the key rather than the value.
    max_days: nullableInteger(bag, 'max_days', path),
  };
}

function decodeFundedPhase(value: unknown, path: string): PublishedFundedPhase {
  const bag = object(value, path);
  return {
    drawdown: decodeDrawdown(owed(bag, 'drawdown', path), `${path}.drawdown`),
    daily_loss_limit: decodeDailyLossLimit(
      owed(bag, 'daily_loss_limit', path),
      `${path}.daily_loss_limit`,
    ),
    min_trading_days: integer(bag, 'min_trading_days', path),
    win_days: decodeWinDays(owed(bag, 'win_days', path), `${path}.win_days`),
    consistency: decodeConsistency(owed(bag, 'consistency', path), `${path}.consistency`),
    buffer_bp: integer(bag, 'buffer_bp', path),
    cadence_gap_trading_days: integer(bag, 'cadence_gap_trading_days', path),
    // **M01 SECTION 2.4 REQUIRES THIS KEY AND DATA_MODEL SECTION 11's EXAMPLE
    // DOES NOT CARRY IT**, which `types.ts` records at the field itself as "a
    // disagreement between two approved documents". It is READ rather than
    // defaulted, on `ADR-258` section 6's ruling and `ADR-260`'s citation of it:
    // writing `0` here would be the literal in engine code M01 refused, and
    // `ADR-019`'s v1 value of zero is a published constant rather than this
    // codec's opinion. **A row written to the corpus's own example therefore
    // stops here by the key's name**, which is the honest half of the
    // disagreement rather than a side taken silently in a decoder. What closes
    // it is one line in one of two approved documents, which is an ADR.
    min_settlement_lag_trading_days: integer(bag, 'min_settlement_lag_trading_days', path),
    payout_cap_schedule: decodeCapSchedule(
      owed(bag, 'payout_cap_schedule', path),
      `${path}.payout_cap_schedule`,
    ),
    // THE ONE CENTS VALUE THAT LIVES IN `rules` RATHER THAN ON THE SIZE ROW.
    // Appendix A's preamble: `min_payout_cents` never scales by size, so there
    // is nothing per size to materialize.
    min_payout_cents: cents(bag, 'min_payout_cents', path),
    split_bp: integer(bag, 'split_bp', path),
    max_payouts: integer(bag, 'max_payouts', path),
    // `CV-18`. RETIRED BUT RETAINED, per `ADR-014`, so the key is read and the
    // mode is a `string` the engine reads no rule from.
    post_payout_floor_rule: {
      mode: text(
        object(owed(bag, 'post_payout_floor_rule', path), `${path}.post_payout_floor_rule`),
        'mode',
        `${path}.post_payout_floor_rule`,
      ),
    },
  };
}

/**
 * `plan_versions.rules`, as `resolvePlan` and `validatePlan` read it.
 *
 * THE RETURN TYPE IS THE ENGINE'S OWN, so the day `PlanRulesJson` grows a key
 * this function fails to compile rather than silently dropping it. **That is the
 * property a cast cannot have**, and a cast over a stored bag is a transcription
 * nothing checks: a `PlanRulesJson` asserted onto unvalidated `jsonb` is a
 * payout basis nobody checked wearing the costume of a decode.
 *
 * `at` names the document for the message and defaults to `$`. A caller holding
 * a row should pass something that locates it.
 */
export function decodePlanRules(value: unknown, at = '$'): PlanRulesJson {
  const bag = object(value, at);

  // **THE LITERAL IS THE TYPE'S AND THE REFUSAL IS BOTH EXISTING DECODERS'.**
  // `PlanRulesJson.schema_version` is `1`, so a second schema is a different
  // build rather than a branch inside this one.
  const version = integer(bag, 'schema_version', at);
  if (version !== 1)
    throw new PlanRulesCodecError(
      `${at}.schema_version`,
      `is ${String(version)} and this build reads 1. The engine's \`PlanRulesJson\` declares ` +
        'the literal, so a second schema is a different build rather than a branch inside this one',
    );

  return {
    schema_version: 1,
    phase_eval: decodeEvalPhase(owed(bag, 'phase_eval', at), `${at}.phase_eval`),
    phase_funded: decodeFundedPhase(owed(bag, 'phase_funded', at), `${at}.phase_funded`),
  };
}
