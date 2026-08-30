// =============================================================================
// packages/rules-engine/src/gates-codec.ts
// =============================================================================
// `rule_states.engine_gates`, BOTH DIRECTIONS. This file is a TRANSCRIPTION of
// `ADR-206` and it decides nothing: the shape it writes is the one
// `docs/architecture/data-model/rule_states.md` reproduces beside the
// `state_hash` input list, and where that document is silent this file refuses
// rather than choosing.
//
// -----------------------------------------------------------------------------
// 1. WHY THE CODEC IS HERE AND NOT IN THE DEPLOYABLE THAT WRITES THE COLUMN
// -----------------------------------------------------------------------------
// `ADR-239` slice A ruled the home and the reason is a dependency direction
// rather than a preference. TWO deployables need this one predicate: the worker
// ENCODES (`apps/worker/src/batch/state-writer.ts`'s `RuleStateWriterIo`) and
// the API DECODES (`PayoutSubject.state` is a `RuleState`, whose `engineGates`
// is an `EngineGateResults`). `apps/api` cannot import `apps/worker`, and this
// package declares NO workspace dependency at all, so it is the only place both
// arrows already point. An encoder in the worker and a decoder in the API would
// be `FM-16` by name: two statements of one predicate with nothing comparing
// them, which is the defect `ADR-206` was written to close rather than to move.
//
// -----------------------------------------------------------------------------
// 2. `ENGINE_GATE_LEAVES` IS NOT IMPORTED HERE, AND THAT IS DELIBERATE
// -----------------------------------------------------------------------------
// `hash.ts`'s array is the executable copy of the leaf set, and the obvious
// design is to build the bag by walking it. THAT WOULD BE THE BANNED SHAPE
// TWICE OVER. `M01` section 1.4 forbids "iteration over an object's keys where
// the result affects output", and a codec assembled from a path list would have
// to SPLIT each dotted path and index back into the value, which is key
// iteration wearing a different hat and which no type checker can see through.
// `hash.ts` renders through explicit per-leaf closures for the same reason.
//
// So the twenty-five leaves are written out here, once per direction, and the
// comparison against `ENGINE_GATE_LEAVES` is performed by the SUITE
// (`test/gates-codec.test.ts`) rather than by this file. That is `ADR-206`
// section 8's own recommendation -- "the suite-side check over the executable
// list" -- and it keeps the two copies COMPARED rather than merged: a bag that
// grew a leaf goes red in a named case instead of hashing differently in
// production.
//
// -----------------------------------------------------------------------------
// 3. THE TRAP, NAMED SO A READER OF THIS FILE MEETS IT BEFORE THE CODE
// -----------------------------------------------------------------------------
// `projectGates` in `apps/api/src/routes/payouts.ts` IS NOT THIS CODEC and
// `rule_states.md` says so in terms. It is the WIRE shape, an allowlist for
// `API_CONTRACT`'s eligibility breakdown, and against the store it is lossy in
// three distinct ways: it DROPS `tradedDays.skipped`, `cadenceGap.skipped` and
// `minimumAmount.capCents`; it RENAMES `consistency.maxDayShareBp` and
// `cadenceGap.tradingDaysSinceLastPayout` beyond casing; and its
// `minimum_amount.pass` is the route's conjunction of the engine's gate with
// `G-CLAMP`'s clamp, which is a DIFFERENT FACT from the one the engine
// computed. A store written in that shape would lose three leaves into
// `state_hash` column 19, silently and permanently, because the hash is taken
// over all twenty-five.
//
// The wire may be lossy because a contract is an allowlist. The store may not,
// because the store is the replay audit's left-hand side.
//
// -----------------------------------------------------------------------------
// 4. WHY THE CENTS LEAVES ARE STRINGS, WHICH IS THE ONE RULING WITH A COST
// -----------------------------------------------------------------------------
// `Cents` is `bigint`. `ADR-206` section 5 MEASURED that Postgres is not the
// lossy leg and the READ PORT is: `jsonb` numbers are `numeric` and Postgres
// holds `9007199254740993` exactly, while the same value read back through
// `JSON.parse` as a NUMBER returns `9007199254740992`, so the decoder could not
// rebuild the `bigint` it is typed to return. A base-10 string round-trips
// through `BigInt` exactly, and it is the same rendering `hash.ts`'s `money()`
// already puts into the hash, so the column and the hash speak one
// representation of money rather than two.
//
// THE ENCODER IS THEREFORE TOTAL OVER `Cents` AND REFUSES NOTHING. A write path
// that refused a legal state would leave the account-day with NO ROW AT ALL,
// which is `DO-3` and a raised reconciliation against a figure the engine
// computed correctly. Every refusal in this file is on the DECODE side, where
// the input is a `jsonb` value some other writer may have produced.
//
// -----------------------------------------------------------------------------
// 5. KEY ORDER IS NOT PART OF THE ENCODING
// -----------------------------------------------------------------------------
// `ADR-206` ruling 6. `jsonb` sorts keys by length and then bytewise, so what
// Postgres returns is in a different order from what was written. The encoder
// emits the interface's declaration order because a reader in `psql` deserves
// it; NOTHING may depend on that, and the decoder reads every leaf by name.
// The hash is taken over the engine's in-memory value and never over the round
// trip, which is `hash.ts`'s own ruling and is not this file's to revisit.
// =============================================================================

import type { Cents, EngineGateResults, TradingDay } from './types.ts';

/**
 * A `rule_states.engine_gates` value was not the shape `ADR-206` rules.
 *
 * IT CARRIES THE DOTTED PATH, because a bag that came back wrong is read by
 * somebody holding a row and a leaf name is the only thing that locates the
 * defect in it. `$` is the bag itself.
 */
export class EngineGatesCodecError extends Error {
  /** Where in the bag the offending value sits, from `$`. */
  readonly path: string;

  // Assigned rather than declared in the parameter list, and that is a RUNTIME
  // requirement rather than a style. `ADR-083` rules that every deployable runs
  // under `node --experimental-strip-types`, which erases types and rewrites
  // nothing: a TypeScript parameter property is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
  // at load time, and `tsc --noEmit` accepts it, so the failure is invisible to
  // `CI-01`. `apps/worker/src/batch/state-writer.ts` records finding it by
  // running the file.
  constructor(path: string, why: string) {
    super(`rule_states.engine_gates at ${path}: ${why}`);
    this.name = 'EngineGatesCodecError';
    this.path = path;
  }
}

// -----------------------------------------------------------------------------
// The stored shape, declared rather than inferred
// -----------------------------------------------------------------------------
// `RuleStateWriterIo.encodeEngineGates` returns `unknown` on purpose, because
// that interface declined to choose the outer shape. THIS FILE IS WHERE THE
// SHAPE IS CHOSEN, so it is written down: a stored bag that drifts from
// `EngineGateResults` is then a compile error here rather than a divergence in
// a nightly report.

/** `tradedDays`, `ADR-206`'s four leaves. */
export interface StoredTradedDaysGate {
  readonly pass: boolean;
  readonly skipped: boolean;
  readonly have: number;
  readonly need: number;
}

/** `winDays`. `floorCents` is `Cents` and so is a base-10 string. */
export interface StoredWinDaysGate {
  readonly pass: boolean;
  readonly have: number;
  readonly need: number;
  readonly floorCents: string;
}

/** `buffer`. Both figures are `Cents`. */
export interface StoredBufferGate {
  readonly pass: boolean;
  readonly haveCents: string;
  readonly needCents: string;
}

/** `consistency`. The two basis-point leaves are nullable and are NOT money. */
export interface StoredConsistencyGate {
  readonly pass: boolean;
  readonly skipped: boolean;
  readonly bestDayShareBp: number | null;
  readonly maxDayShareBp: number | null;
  readonly profitNeededToDiluteCents: string;
}

/** `cadenceGap`. `nextEligibleTradingDay` is the ONE non-money string leaf. */
export interface StoredCadenceGapGate {
  readonly pass: boolean;
  readonly skipped: boolean;
  readonly tradingDaysSinceLastPayout: number | null;
  readonly need: number;
  readonly nextEligibleTradingDay: string | null;
}

/** `minimumAmount`. Three of its four leaves are `Cents`. */
export interface StoredMinimumAmountGate {
  readonly pass: boolean;
  readonly withdrawableCents: string;
  readonly capCents: string;
  readonly minPayoutCents: string;
}

/**
 * The whole bag: six groups, twenty-five leaves, in the engine's field names.
 *
 * `skipped` IS ON THREE GROUPS AND NOT ON THE OTHER THREE, which is the
 * interface's shape rather than an omission. `CV-19` fixed the vocabulary -- a
 * gate that was not evaluated reports `pass: true, skipped: true` -- and
 * `winDays`, `buffer` and `minimumAmount` are ALWAYS evaluated, so a bag that
 * grew a fourth `skipped` would carry a fact the engine never produced.
 */
export interface StoredEngineGates {
  readonly tradedDays: StoredTradedDaysGate;
  readonly winDays: StoredWinDaysGate;
  readonly buffer: StoredBufferGate;
  readonly consistency: StoredConsistencyGate;
  readonly cadenceGap: StoredCadenceGapGate;
  readonly minimumAmount: StoredMinimumAmountGate;
}

// -----------------------------------------------------------------------------
// Encode
// -----------------------------------------------------------------------------

/**
 * `C-07`'s "`bigint` rendered base-10", which is `hash.ts`'s `money()` exactly.
 *
 * IT IS RESTATED RATHER THAN IMPORTED because `money()` is not exported and
 * making it so would export a hash internal to serve a column. The two are
 * COMPARED instead: `test/gates-codec.test.ts` renders every cents leaf both
 * ways and asserts the strings are identical, which is a check that fires if
 * either side ever moves.
 */
function money(value: Cents): string {
  return value.toString(10);
}

/**
 * The engine's value, as `rule_states.engine_gates` holds it.
 *
 * TOTAL OVER EVERY LEGAL `EngineGateResults` AND REFUSES NOTHING; section 4 is
 * why. The leaves are written out rather than walked; section 2 is why.
 */
export function encodeEngineGates(gates: EngineGateResults): StoredEngineGates {
  return {
    // R-33. `tradedDaysCount >= min_trading_days`, and 0 DISABLES the gate (CV-19).
    tradedDays: {
      pass: gates.tradedDays.pass,
      skipped: gates.tradedDays.skipped,
      have: gates.tradedDays.have,
      need: gates.tradedDays.need,
    },
    // R-34. Win days, counted strictly after `payoutAnchorDay`.
    winDays: {
      pass: gates.winDays.pass,
      have: gates.winDays.have,
      need: gates.winDays.need,
      floorCents: money(gates.winDays.floorCents),
    },
    // R-35. The permanent buffer.
    buffer: {
      pass: gates.buffer.pass,
      haveCents: money(gates.buffer.haveCents),
      needCents: money(gates.buffer.needCents),
    },
    // R-36 over the R-47 period, with R-30's denominator rule.
    consistency: {
      pass: gates.consistency.pass,
      skipped: gates.consistency.skipped,
      bestDayShareBp: gates.consistency.bestDayShareBp,
      maxDayShareBp: gates.consistency.maxDayShareBp,
      profitNeededToDiluteCents: money(gates.consistency.profitNeededToDiluteCents),
    },
    // R-37. Trading days strictly after `cadenceAnchorDay`, by sequence subtraction.
    cadenceGap: {
      pass: gates.cadenceGap.pass,
      skipped: gates.cadenceGap.skipped,
      tradingDaysSinceLastPayout: gates.cadenceGap.tradingDaysSinceLastPayout,
      need: gates.cadenceGap.need,
      nextEligibleTradingDay: gates.cadenceGap.nextEligibleTradingDay,
    },
    // R-39. `min(withdrawable, cap) >= min_payout_cents`.
    minimumAmount: {
      pass: gates.minimumAmount.pass,
      withdrawableCents: money(gates.minimumAmount.withdrawableCents),
      capCents: money(gates.minimumAmount.capCents),
      minPayoutCents: money(gates.minimumAmount.minPayoutCents),
    },
  };
}

// -----------------------------------------------------------------------------
// Decode, where every refusal lives
// -----------------------------------------------------------------------------
// THE INPUT IS `unknown` AND IT MEANS IT. What arrives here is whatever
// `jsonb` gave the driver: a row written by a build that is not this one, by a
// migration backfill, or by hand in `psql`. A decoder that trusted it would
// hand `evaluatePayout` an `EngineGateResults` with a `NaN` in it and the
// payout verdict would be computed off it.

/** `YYYY-MM-DD`, which is `TradingDay`'s brand and is `hash.ts`'s own shape. */
const TRADING_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One gate group, with its key set checked EXACTLY.
 *
 * BOTH DIRECTIONS ARE REFUSED and each catches one half of the trap. A MISSING
 * key is the wire shape's three dropped leaves and its two renames; an EXTRA
 * key is the four `R-40` context gates `INV-23` bars from the replayed state.
 *
 * THE KEY SET IS COMPARED AS A SET AND NEVER READ IN ORDER, so this is not the
 * iteration `M01` section 1.4 bans: `jsonb` returns keys sorted by length and
 * then bytewise, and a check whose result moved with that order would refuse
 * rows by how long their field names are. The stray names are sorted before
 * they reach the message for the same reason -- an error text that varied run
 * to run is a defect report nobody can diff.
 */
function group(value: unknown, path: string, expected: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new EngineGatesCodecError(path, `expected an object and found ${describe(value)}`);

  const bag = value as Record<string, unknown>;
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(bag, key));
  if (missing.length > 0)
    throw new EngineGatesCodecError(
      path,
      `${String(missing.length)} declared leaf/leaves are absent: ${[...missing].sort().join(', ')}`,
    );

  const strays = Object.keys(bag).filter((key) => !expected.includes(key));
  if (strays.length > 0)
    throw new EngineGatesCodecError(
      path,
      `${String(strays.length)} undeclared leaf/leaves are present: ${[...strays].sort().join(', ')}`,
    );

  return bag;
}

/** What a value IS, for a message, without ever printing the value itself. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function boolean(bag: Record<string, unknown>, key: string, path: string): boolean {
  const value = bag[key];
  if (typeof value !== 'boolean')
    throw new EngineGatesCodecError(
      `${path}.${key}`,
      `expected a boolean and found ${describe(value)}`,
    );
  return value;
}

/**
 * A count, a day total or a basis-point figure.
 *
 * `Number.isSafeInteger` IS THE SAME TEST `hash.ts`'s `count()` APPLIES, and it
 * is applied here for the reason that file gives: a non-integer is refused
 * rather than rounded. It also disposes of `NaN` and both infinities, which
 * `JSON.parse` never produces but `jsonb` reaches through other writers.
 */
function count(bag: Record<string, unknown>, key: string, path: string): number {
  const value = bag[key];
  if (typeof value !== 'number')
    throw new EngineGatesCodecError(
      `${path}.${key}`,
      `expected a number and found ${describe(value)}`,
    );
  if (!Number.isSafeInteger(value))
    throw new EngineGatesCodecError(
      `${path}.${key}`,
      'expected a safe integer, which is the test `hash.ts` applies to the same leaf',
    );
  return value;
}

/** `null` is JSON `null` and never the hash's `~null` sentinel (`ADR-206` ruling 4). */
function nullableCount(bag: Record<string, unknown>, key: string, path: string): number | null {
  return bag[key] === null ? null : count(bag, key, path);
}

/**
 * A `Cents` leaf: a JSON string holding the base-10 integer.
 *
 * **THE CHECK IS A ROUND TRIP AGAINST `money()` RATHER THAN A REGULAR
 * EXPRESSION, AND THAT IS THE POINT.** `BigInt(text).toString(10) === text`
 * admits EXACTLY the strings the encoder can emit and nothing else, so the two
 * directions are bound to one rendering instead of to two descriptions of one.
 * A pattern would have been a second statement of `money()` with nothing
 * comparing them, which is `FM-16` at the leaf.
 *
 * It disposes, in one line, of every near miss a hand-written row produces:
 * `""` (`BigInt` reads 0n), `" 12"` and `"12 "` (whitespace is tolerated by
 * `BigInt` and lost), `"0012"`, `"+12"`, `"-0"`, `"0x10"` and `"1e3"`. A JSON
 * NUMBER is refused before any of that, because a number is what `ADR-206`
 * section 5 measured coming back wrong.
 */
function cents(bag: Record<string, unknown>, key: string, path: string): Cents {
  const value = bag[key];
  if (typeof value !== 'string')
    throw new EngineGatesCodecError(
      `${path}.${key}`,
      `expected a base-10 string and found ${describe(value)}. ADR-206 ruling 3: a JSON number ` +
        'cannot round-trip a Cents through the read port',
    );

  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new EngineGatesCodecError(`${path}.${key}`, 'is not a base-10 integer');
  }
  if (parsed.toString(10) !== value)
    throw new EngineGatesCodecError(
      `${path}.${key}`,
      'is not the base-10 rendering of the integer it holds',
    );
  return parsed;
}

/**
 * `cadenceGap.nextEligibleTradingDay`, the only leaf that is a string and not money.
 *
 * THE SHAPE IS ASSERTED AND THE DATE IS NOT RESOLVED. `types.ts` calls this "a
 * REPORTED date, never compared", and a decoder that looked it up in a calendar
 * would be reading a slice this file has no reason to hold.
 */
function tradingDay(bag: Record<string, unknown>, key: string, path: string): TradingDay | null {
  const value = bag[key];
  if (value === null) return null;
  if (typeof value !== 'string')
    throw new EngineGatesCodecError(
      `${path}.${key}`,
      `expected a YYYY-MM-DD string or null and found ${describe(value)}`,
    );
  if (!TRADING_DAY_SHAPE.test(value))
    throw new EngineGatesCodecError(`${path}.${key}`, 'is not YYYY-MM-DD');
  return value as TradingDay;
}

const TRADED_DAYS_LEAVES = ['pass', 'skipped', 'have', 'need'] as const;
const WIN_DAYS_LEAVES = ['pass', 'have', 'need', 'floorCents'] as const;
const BUFFER_LEAVES = ['pass', 'haveCents', 'needCents'] as const;
const CONSISTENCY_LEAVES = [
  'pass',
  'skipped',
  'bestDayShareBp',
  'maxDayShareBp',
  'profitNeededToDiluteCents',
] as const;
const CADENCE_GAP_LEAVES = [
  'pass',
  'skipped',
  'tradingDaysSinceLastPayout',
  'need',
  'nextEligibleTradingDay',
] as const;
const MINIMUM_AMOUNT_LEAVES = ['pass', 'withdrawableCents', 'capCents', 'minPayoutCents'] as const;

/** The six groups, and no seventh. `INV-23` is what a seventh would be. */
const GATE_GROUPS = [
  'tradedDays',
  'winDays',
  'buffer',
  'consistency',
  'cadenceGap',
  'minimumAmount',
] as const;

/**
 * `rule_states.engine_gates` as the engine's own value.
 *
 * THE RETURN IS BUILT LEAF BY LEAF FROM NAMED READS, so the value handed back
 * carries no key the row happened to have and no key order the row happened to
 * be stored in. `ADR-206` ruling 6 is the ruling and `jsonb`'s key sorting is
 * the reason.
 */
export function decodeEngineGates(value: unknown): EngineGateResults {
  const bag = group(value, '$', GATE_GROUPS);

  // Bracket access, because `noPropertyAccessFromIndexSignature` is on and the
  // bag is `Record<string, unknown>`: a dotted read of a key the row may not
  // carry is exactly the assumption this decoder exists to refuse.
  const tradedDays = group(bag['tradedDays'], '$.tradedDays', TRADED_DAYS_LEAVES);
  const winDays = group(bag['winDays'], '$.winDays', WIN_DAYS_LEAVES);
  const buffer = group(bag['buffer'], '$.buffer', BUFFER_LEAVES);
  const consistency = group(bag['consistency'], '$.consistency', CONSISTENCY_LEAVES);
  const cadenceGap = group(bag['cadenceGap'], '$.cadenceGap', CADENCE_GAP_LEAVES);
  const minimumAmount = group(bag['minimumAmount'], '$.minimumAmount', MINIMUM_AMOUNT_LEAVES);

  return {
    tradedDays: {
      pass: boolean(tradedDays, 'pass', '$.tradedDays'),
      skipped: boolean(tradedDays, 'skipped', '$.tradedDays'),
      have: count(tradedDays, 'have', '$.tradedDays'),
      need: count(tradedDays, 'need', '$.tradedDays'),
    },
    winDays: {
      pass: boolean(winDays, 'pass', '$.winDays'),
      have: count(winDays, 'have', '$.winDays'),
      need: count(winDays, 'need', '$.winDays'),
      floorCents: cents(winDays, 'floorCents', '$.winDays'),
    },
    buffer: {
      pass: boolean(buffer, 'pass', '$.buffer'),
      haveCents: cents(buffer, 'haveCents', '$.buffer'),
      needCents: cents(buffer, 'needCents', '$.buffer'),
    },
    consistency: {
      pass: boolean(consistency, 'pass', '$.consistency'),
      skipped: boolean(consistency, 'skipped', '$.consistency'),
      bestDayShareBp: nullableCount(consistency, 'bestDayShareBp', '$.consistency'),
      maxDayShareBp: nullableCount(consistency, 'maxDayShareBp', '$.consistency'),
      profitNeededToDiluteCents: cents(consistency, 'profitNeededToDiluteCents', '$.consistency'),
    },
    cadenceGap: {
      pass: boolean(cadenceGap, 'pass', '$.cadenceGap'),
      skipped: boolean(cadenceGap, 'skipped', '$.cadenceGap'),
      tradingDaysSinceLastPayout: nullableCount(
        cadenceGap,
        'tradingDaysSinceLastPayout',
        '$.cadenceGap',
      ),
      need: count(cadenceGap, 'need', '$.cadenceGap'),
      nextEligibleTradingDay: tradingDay(cadenceGap, 'nextEligibleTradingDay', '$.cadenceGap'),
    },
    minimumAmount: {
      pass: boolean(minimumAmount, 'pass', '$.minimumAmount'),
      withdrawableCents: cents(minimumAmount, 'withdrawableCents', '$.minimumAmount'),
      capCents: cents(minimumAmount, 'capCents', '$.minimumAmount'),
      minPayoutCents: cents(minimumAmount, 'minPayoutCents', '$.minimumAmount'),
    },
  };
}
