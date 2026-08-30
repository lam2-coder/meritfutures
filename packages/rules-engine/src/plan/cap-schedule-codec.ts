// =============================================================================
// packages/rules-engine/src/plan/cap-schedule-codec.ts
// =============================================================================
// `plan_version_sizes.payout_cap_schedule_cents`, THE READ DIRECTION ONLY. This
// file turns the stored `jsonb` array into the `SizeCapScheduleStep[]` that
// `types.ts` already declares, and it decides nothing about the shape: both keys
// below are what `0004_catalog.sql` stores and what every existing reader of the
// column already asks for.
//
// -----------------------------------------------------------------------------
// 1. WHY IT IS HERE, WHICH IS ADR-283's ARGUMENT ON A SECOND BLOB
// -----------------------------------------------------------------------------
// THREE deployables stated this one predicate and none could import another:
// `toCapScheduleCents` (`apps/worker/src/batch/adapter.ts`) read it for the
// nightly fold, `decodeCapSteps` (`apps/site/src/catalog/adapter.ts`) read it
// off the catalogue response for the marketing page, and `readCapSchedule`
// (`apps/api/src/routes/catalog.ts`) read it for the public catalogue. NOTHING
// COMPARED THEM, which is `FM-16` by name over the value that fixes a payout
// ceiling, and by the time this file was written THEY HAD ALREADY DIVERGED.
//
// `packages/rules-engine` declares no workspace dependency at all (`RI-01`), so
// it is the only place all three arrows already point, and it is where `ADR-250`
// put `gates-codec.ts` and `ADR-283` put `rules-codec.ts` on exactly this
// argument. **THE DIFFERENCE FROM BOTH IS THAT ALL THREE COPIES ARE RETIRED IN
// THE SAME DIFF THAT WRITES THIS ONE.** `ADR-302` is that ruling and `ADR-299`
// section 7 named the alternative in advance: a codec written here WITHOUT the
// collapse is a FOURTH statement of the payout ceiling, which `ADR-286` refused
// and `ADR-269` refused before it for this same value.
//
// -----------------------------------------------------------------------------
// 2. THE SPELLING RULING DOES NOT REACH INSIDE THE COLUMN
// -----------------------------------------------------------------------------
// `ADR-286` measured that the SIZE ROW is read under two spellings that are the
// dependency graph rather than a preference: `apps/worker` and `apps/api` read
// `packages/db`'s camelCase because they hold a driver row, and `apps/site`
// reads the stored snake_case because it holds Merit's own HTTP response. **THAT
// SPLIT STOPS AT THE COLUMN BOUNDARY.** Inside the `jsonb` every reader asks
// Postgres for the same two stored keys, `from_ordinal` and `cap_cents`, so this
// half is one predicate that needed no rename from anybody. It is why the blob
// collapses where the row does not.
//
// -----------------------------------------------------------------------------
// 3. WHAT A CENTS VALUE IS HERE, AND THE CEILING IS STATED RATHER THAN ROUNDED
// -----------------------------------------------------------------------------
// A JSON NUMBER IS ADMITTED AND CHECKED, A BASE-10 STRING OF DIGITS IS ADMITTED,
// AND NOTHING ELSE IS. `DATA_MODEL` section 11 writes cents inside `jsonb` as a
// number, so refusing numbers outright would refuse every row written to the
// approved shape; and `ADR-283` ruling 5 blessed the string form as THE ONLY
// RENDERING THAT SURVIVES above `Number.MAX_SAFE_INTEGER`, because `jsonb` has
// one number type and `JSON.parse` has already rounded by the time any reader
// runs.
//
// **SO AN UNSAFE NUMBER IS REFUSED RATHER THAN ROUNDED, AND THAT IS NOT A
// PREFERENCE.** `INV-02` is that money is integer cents at every boundary, and
// `CLAUDE.md` is that there are no floats in financial paths. A cap that arrived
// as `2 ** 53 + 1` and left as `2 ** 53` is a payout ceiling nobody published,
// and it is the divergence `ADR-286` section 7 item 1 reported and `ADR-302`
// repaired.
//
// `from_ordinal` IS HELD TO THE SAME SAFE-INTEGER TEST, on `hash.ts`'s and
// `gates-codec.ts`'s: it selects the rung a payout is clamped against (`R-42`),
// so an ordinal that has lost digits selects a rung nobody wrote.
//
// -----------------------------------------------------------------------------
// 4. WHAT IT DOES NOT DO
// -----------------------------------------------------------------------------
// **IT DOES NOT SORT.** `resolvePlan` sorts the schedule because `capForOrdinal`
// needs a rung in order, and `apps/api`'s `capAtFirstOrdinal` SELECTS by ordinal
// rather than taking a position for the same reason. A decoder that sorted would
// hide from both of them that `jsonb` order survives a round trip only as well
// as whoever wrote it.
//
// **IT RUNS NO `CV-nn`.** `CV-09`, `CV-10` and `CV-17` are inequalities across
// the whole plan and `validatePlan` owns them at publish; a read holds one
// account's one pinned size and could not construct the question. `rules-codec.ts`
// section 4 is the standing ruling and this file inherits it rather than
// restating it.
//
// **A KEY THAT IS ABSENT IS REFUSED AND NEVER DEFAULTED**, on `ADR-258` section
// 6: a default is a plan parameter written into application code, and it is
// invisible.
// =============================================================================

import type { Cents, SizeCapScheduleStep } from '../types.ts';

/**
 * A `payout_cap_schedule_cents` document was not the shape `0004` stores.
 *
 * IT CARRIES THE DOTTED PATH, on `PlanRulesCodecError`'s and
 * `EngineGatesCodecError`'s reason unchanged: the value that came back wrong is
 * read by somebody holding a row, and an index plus a key name is the only thing
 * that locates the defect in it. `$` is the array itself.
 */
export class CapScheduleCodecError extends Error {
  /** Where in the array the offending value sits, from `$`. */
  readonly path: string;

  // Assigned rather than declared in the parameter list, and that is a RUNTIME
  // requirement rather than a style. `ADR-083` rules that every deployable runs
  // under `node --experimental-strip-types`, which erases types and rewrites
  // nothing: a TypeScript parameter property is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
  // at load time and `tsc --noEmit` accepts it, so the failure is invisible to
  // `CI-01`. `gates-codec.ts` and `rules-codec.ts` record the same finding.
  constructor(path: string, why: string) {
    super(`plan_version_sizes.payout_cap_schedule_cents at ${path}: ${why}`);
    this.name = 'CapScheduleCodecError';
    this.path = path;
  }
}

/** What a value IS, for a message, without ever printing the value itself. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CapScheduleCodecError(path, `expected an object and found ${describe(value)}`);
  return value as Record<string, unknown>;
}

/**
 * One DECLARED key, whose ABSENCE is refused.
 *
 * `hasOwnProperty` RATHER THAN `!== undefined`, on `rules-codec.ts`'s ruling: a
 * stored document may legally carry a null, and neither key here may read one as
 * a missing key or a missing key as one. Both existing driver-side readers tested
 * key presence explicitly and this preserves that.
 */
function owed(bag: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(bag, key))
    throw new CapScheduleCodecError(`${path}.${key}`, 'is absent, and no key here takes a default');
  return bag[key];
}

/**
 * `from_ordinal`, the rung selector.
 *
 * `Number.isSafeInteger` IS THE TEST `hash.ts`, `gates-codec.ts` AND
 * `rules-codec.ts` ALL APPLY, and it disposes of `NaN` and both infinities,
 * which `JSON.parse` never produces but `jsonb` reaches through other writers.
 */
function ordinal(bag: Record<string, unknown>, key: string, path: string): number {
  const value = owed(bag, key, path);
  if (typeof value !== 'number')
    throw new CapScheduleCodecError(
      `${path}.${key}`,
      `expected a number and found ${describe(value)}`,
    );
  if (!Number.isSafeInteger(value))
    throw new CapScheduleCodecError(
      `${path}.${key}`,
      'expected a safe integer, which is the test `hash.ts` applies to the same kind of leaf. ' +
        'An ordinal that has lost digits selects a rung nobody wrote (R-42)',
    );
  return value;
}

/**
 * `cap_cents`, on this file's section 3 terms.
 *
 * A number that is not a safe integer has already lost digits by the time it
 * arrives, so it is refused with the ceiling named; a string is read through
 * `BigInt` and must be the base-10 rendering of the integer it holds, which
 * admits nothing a `JSON.stringify` of a `Cents` could not have produced.
 */
function cents(bag: Record<string, unknown>, key: string, path: string): Cents {
  const value = owed(bag, key, path);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new CapScheduleCodecError(
        `${path}.${key}`,
        'is not a safe integer and integer cents were required, so it has already lost digits: ' +
          'a cap past `Number.MAX_SAFE_INTEGER` must be stored as a base-10 string (INV-02)',
      );
    return BigInt(value);
  }
  if (typeof value === 'string') {
    let parsed: bigint;
    try {
      parsed = BigInt(value);
    } catch {
      throw new CapScheduleCodecError(`${path}.${key}`, 'is not a base-10 integer');
    }
    if (parsed.toString(10) !== value)
      throw new CapScheduleCodecError(
        `${path}.${key}`,
        'is not the base-10 rendering of the integer it holds',
      );
    return parsed;
  }
  throw new CapScheduleCodecError(
    `${path}.${key}`,
    'integer cents were required, as a safe-integer number or a base-10 string, and found ' +
      describe(value),
  );
}

/**
 * `plan_version_sizes.payout_cap_schedule_cents`, as every reader of it reads it.
 *
 * THE RETURN TYPE IS THE ENGINE'S OWN, so the day `SizeCapScheduleStep` grows a
 * key this function fails to compile rather than silently dropping it. **That is
 * the property a cast cannot have**, and a cast over a stored bag is a
 * transcription nothing checks: a payout ceiling asserted onto unvalidated
 * `jsonb` is a figure nobody checked wearing the costume of a decode.
 *
 * NO KEY IS EVER REACHED BY ITERATION (`M01` section 1.4). Both are read by name
 * and an undeclared key is IGNORED rather than refused, which is `rules-codec.ts`
 * section 2's ruling on the same question: this array is `0004`'s and a decoder
 * that refused a stray key would be this module claiming a column it does not own.
 *
 * `at` names the array for the message and defaults to `$`. A caller holding a
 * row should pass something that locates it.
 */
export function decodeCapScheduleCents(value: unknown, at = '$'): readonly SizeCapScheduleStep[] {
  if (!Array.isArray(value))
    throw new CapScheduleCodecError(at, `expected an array and found ${describe(value)}`);

  return value.map((step: unknown, index: number): SizeCapScheduleStep => {
    const path = `${at}[${String(index)}]`;
    const bag = object(step, path);
    return {
      from_ordinal: ordinal(bag, 'from_ordinal', path),
      cap_cents: cents(bag, 'cap_cents', path),
    };
  });
}
