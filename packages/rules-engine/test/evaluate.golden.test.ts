import { expect, test } from 'vitest';

import * as engine from '../src/index.ts';

// CI-03, the `golden` project, and it exists as a STAGE rather than as a subset
// of CI-02: `pnpm vitest run --project golden` must work by itself, or the
// pipeline STRATEGY section 4.1 rules cannot be built (P1 section 2.2).
//
// THE LOADER IS NOT THIS SESSION'S. It and the fixture directory are session
// S-D (P1 section 6). What this file does is hold the stage open and assert the
// structural precondition the loader depends on, which is a scaffold property a
// later session can break without anyone noticing.
//
// TR-01's mechanism. STRATEGY section 2 rejected TypeScript fixture builders
// because a builder can call the code under test, and a fixture derived from
// the implementation proves only that the code agrees with itself. The
// structural half of that is that the loader "reads a directory and imports the
// engine's public entry point only": if the entry point stops being the whole
// public surface, the loader gains a route to the internals and TR-01 stops
// being enforceable by construction.
// WHAT CHANGED WHEN THE FOLD LANDED, and why this is not the guard being
// loosened. The assertion was `['evaluate']` while the engine was the scaffold's
// identity stub, and the property it was defending was never "one export": it is
// that THE ENTRY POINT IS THE WHOLE PUBLIC SURFACE, so the loader has no route to
// an internal. M01 section 1.3 names the surface -- six functions, "and nothing
// else is exported, because every additional export is a way for a caller to
// reimplement a rule slightly differently" -- and ALL SIX are now written. So
// the list below is exact rather than open, and adding an export without
// adding it here is still a red stage.
//
//   advanceDay, initialState   M01 section 1.3, four of the six. `resolvePlan`
//   applySettlement            and `validatePlan` are P2-1.
//   evaluatePayout             `clampPayout` is NOT among them, and section 3.6
//                              writes `export function clampPayout` all the
//                              same: section 1.3's list wins, so the clamp is
//                              reachable only through `evaluatePayout`
//   buildCalendarSlice         ADR-049: the slice is "built by a pure exported
//   lookupCalendarDay          constructor", with "the calendar queries as free
//   nextTradingDayAfter        functions in `calendar.ts` over that value".
//   CalendarSliceError         The third is R-31's and R-47's `the next trading
//                              day after`, which AS-12 is the off-by-one in
//   EngineInvariantError       R-14's tripwire is useless if a caller cannot
//                              catch it by type
//   IMPLEMENTED_RULES          ADR-048: "the engine exports the set of rule
//                              identifiers it implements, and that export is
//                              part of its public contract"
//   stateHash                  ADR-081. SD-08's canonical serialization and
//   canonicalStateSerialization  digest, moved out of apps/worker into the
//   StateHashError             file M01 section 1.3's layout names. SIX NAMES,
//   HASHED_COLUMNS             GAINING EXACTLY TWO FUNCTIONS, and ADR-078's
//   ENGINE_GATE_LEAVES         test decides them in TWO CASES rather than six
//   EXCLUDED_COLUMNS           instances of one. The first four plus the error
//                              are DEFEATED BY WITHHOLDING IN PRODUCTION:
//                              nothing else computes the digest, and
//                              apps/worker/src/batch/replay.ts walks
//                              HASHED_COLUMNS at :167 and ENGINE_GATE_LEAVES at
//                              :173 to name the diverged field, so withholding
//                              a table makes the batch hand-maintain a second
//                              copy of C-07's order. EXCLUDED_COLUMNS has NO
//                              production consumer and is exported for a
//                              different reason, said plainly: it keeps
//                              apps/worker/test/state-hash.test.ts reachable,
//                              and that file is the DIFFERENTIAL ORACLE for a
//                              hand-rolled SHA-256, not a coverage exercise
//   replay                     ADR-078. M01 section 3.7's fold over a whole
//   ReplayAssertionError       account life. THE CLAMP AND THE FOLD ARE THE
//                              SAME CONTRADICTION RULED OPPOSITE WAYS, and
//                              not because the sites were counted: 1.3's
//                              layout lists `payout/clamp.ts` and `replay.ts`
//                              alike. Withholding the clamp SERVES 1.3's
//                              rationale because `evaluatePayout` reaches it;
//                              withholding `replay` DEFEATS it, because no
//                              export reaches the whole-life fold and
//                              `apps/worker` had already written its own
//
//   projectPayout              ADR-204, and ADR-078's test a third time. M01
//   PROJECTION_ASSUMPTIONS     section 4 names `evaluatePayout` "projected
//   PROJECTION_CAVEAT          forward over the calendar" as the producer behind
//                              `GET /admin/eligible-forecast`, and that entry
//                              proves the sentence uncallable as written: the
//                              call's argument is the future. What IS callable
//                              is a forward BASIS DAY for R-37, the one of
//                              eleven conditions a stored row already fixes for
//                              the whole horizon. THREE NAMES, GAINING EXACTLY
//                              ONE FUNCTION. Withholding it DEFEATS 1.3's
//                              rationale for `replay`'s reason: nothing
//                              exported reaches a forward basis day, so the
//                              caller that needs one -- `eligible_next_7d` in
//                              `apps/api/src/admin-source/` -- writes its own
//                              six-gate conjunction in the API layer, which is
//                              FM-16 by name. The two tables are frozen data
//                              and reimplement no rule: ADR-204 ruling 6 says a
//                              producer MAY NOT CHOOSE the five assumptions and
//                              ruling 7 says both halves of the figure are
//                              stated wherever it is shown, so a caller that
//                              had to retype them could retype them wrongly.
//                              `projectEngineGates` is NOT here and that is the
//                              CLAMP's ruling: `projectPayout` reaches it
//
//   buildSessionCalendar       ADR-251, and it is ADR-078's test a FOURTH time
//   tradingDayAt               with the largest evidence any of the four has
//                              had. The question is always whether withholding
//                              SERVES or DEFEATS 1.3's "every additional export
//                              is a way for a caller to reimplement a rule
//                              slightly differently". Here it DEFEATS it, and
//                              the reimplementations were already written
//                              before the export existed: THREE ports declare
//                              their own instant-to-day method and every one
//                              throws (`admin-writes.ts`, `digests/ports.ts`,
//                              `breaker/ports.ts`), and TWO private functions
//                              already do the mapping in two deployables
//                              (`readLastClosedTradingDay`, `anchorCalendar`).
//                              That is `replay`'s situation exactly, where
//                              `apps/worker` "had already written its own", at
//                              five sites instead of one. TWO NAMES, GAINING
//                              EXACTLY TWO FUNCTIONS, and both compute: there
//                              is no frozen table and no class here.
//
//                              AND THE COST OF WITHHOLDING IS NOT A DUPLICATE
//                              FUNCTION, IT IS A WRONG ONE. A caller that
//                              cannot reach this reimplements it from an
//                              instant's UTC date, which ADR-146 clause 1
//                              forbids and which is right all afternoon and
//                              wrong every evening. `merit/engine-purity`
//                              refuses that spelling INSIDE this package and
//                              nowhere else, so the export is also what puts
//                              the answer where the lint rule guards it
//
// `evaluate` WAS HERE AND IS GONE (ADR-078). It was the scaffold's identity
// stub and was never among 1.3's six. The line that used to sit here said the
// polarity probe folds it; `engineIsIdentityStub` in `golden-loader/src/run.ts`
// folds `advanceDay` and has for some time, so that sentence described a state
// the code had already left. Both halves are corrected rather than deleted.
test('the engine entry point is the whole public surface, and it is this exact list', () => {
  expect(Object.keys(engine).sort()).toEqual([
    'CalendarSliceError',
    'CapScheduleCodecError',
    'ENGINE_GATE_LEAVES',
    'EXCLUDED_COLUMNS',
    'EngineGatesCodecError',
    'EngineInvariantError',
    'ExternalGatesRefusal',
    'HASHED_COLUMNS',
    'IMPLEMENTED_RULES',
    'PAYOUT_IN_FLIGHT_STATUSES',
    'PROJECTION_ASSUMPTIONS',
    'PROJECTION_CAVEAT',
    'PlanRulesCodecError',
    'ReplayAssertionError',
    'StateHashError',
    'advanceDay',
    'applySettlement',
    'buildCalendarSlice',
    'buildSessionCalendar',
    'canonicalStateSerialization',
    'decodeCapScheduleCents',
    'decodeEngineGates',
    'decodePlanRules',
    'encodeEngineGates',
    'evaluatePayout',
    'initialState',
    'lookupCalendarDay',
    'nextTradingDayAfter',
    'projectPayout',
    'replay',
    'resolveExternalGates',
    'resolvePlan',
    'stateHash',
    'tradingDayAt',
    'validatePlan',
  ]);
  expect(typeof engine.replay).toBe('function');
  expect(typeof engine.advanceDay).toBe('function');
});

// THE COUNT IS SAID IN FUNCTIONS BECAUSE THAT IS WHAT SECTION 1.3'S REASON IS
// ABOUT. ADR-078 corrected a false approval clause by counting this list rather
// than a delta, and ADR-081's clause is written the same way: fourteen names to
// twenty, and of the six only `stateHash` and `canonicalStateSerialization`
// COMPUTE anything. The other four are a class and three frozen tables, none of
// which a caller can reimplement a rule slightly differently with. Ten
// functions become TWELVE; the other four new names are not functions.
//
// ADR-204 IS THE SAME SENTENCE A THIRD TIME AND IT IS THE SMALLEST OF THE
// THREE: twenty names to TWENTY-THREE, gaining exactly ONE function. Of the
// three new names only `projectPayout` computes anything; `PROJECTION_ASSUMPTIONS`
// and `PROJECTION_CAVEAT` are frozen tables in the class `HASHED_COLUMNS` and
// `ENGINE_GATE_LEAVES` are in. TWELVE FUNCTIONS BECOME THIRTEEN.
//
// ADR-250 IS THE FOURTH AND IT IS THE FIRST TO ADD TWO FUNCTIONS AT ONCE:
// twenty-three names to TWENTY-SIX, gaining `encodeEngineGates`,
// `decodeEngineGates` and the class `EngineGatesCodecError`. Section 1.3's
// rationale is what admits them and ADR-239 slice A is where it was applied:
// TWO deployables need this one predicate and neither can import the other, so
// a withheld codec is not a codec nobody writes, it is TWO codecs, which is the
// `FM-16` that ADR-206 exists to close. THIRTEEN FUNCTIONS BECOME FIFTEEN and
// the error classes go from four to FIVE.
//
// ADR-251 IS THE FOURTH AND IT IS THE ONLY ONE WHOSE TWO NEW NAMES ARE BOTH
// FUNCTIONS: twenty-three names to TWENTY-FIVE, thirteen functions to FIFTEEN.
// The types travel with them and are erased, so they add no name here. THIS
// GATE CAUGHT THE ADDITION rather than being updated alongside it, which is
// what it is for: the export surface is a ruling and not a consequence.
// **ADR-250 AND ADR-251 LANDED IN ONE MERGE AND EACH PARAGRAPH ABOVE COUNTED
// ONLY ITS OWN ARRIVAL**, which is why neither number above is the number
// asserted below. Both were written against twenty-three and neither could see
// the other. MEASURED ON THE MERGED TREE: twenty-three names become
// TWENTY-EIGHT, thirteen functions become SEVENTEEN, and the error classes go
// from four to FIVE. The counts here are read off the merged surface rather
// than added up from the two prose paragraphs, because that addition is exactly
// the step this gate exists to refuse.
//
// ADR-260 IS THE FIFTH AND IT IS THE ONLY ONE SO FAR WHOSE NEW FUNCTION READS NO
// RULE AT ALL: twenty-eight names to THIRTY-ONE, seventeen functions to
// EIGHTEEN, and the error classes from five to SIX. `resolveExternalGates`
// narrows four columns into the two unions `types.ts` declares and decides
// nothing about R-40 or R-41, which is why section 1.3's "a way for a caller to
// reimplement a rule slightly differently" does not reach it: there is no rule
// here to reimplement. What withholding it would produce is TWO narrowings, one
// per deployable, which is the `FM-16` the codec above was moved here to close.
// `PAYOUT_IN_FLIGHT_STATUSES` is a frozen table in the class `HASHED_COLUMNS`
// and `ENGINE_GATE_LEAVES` are in, and it is ADR-254 finding 4's own remedy: the
// status set is written out in five places, and a constant is only a control if
// a caller can name it. `ExternalGatesRefusal` is the sixth error class, on
// `EngineGatesCodecError`'s reason unchanged.
// ADR-283 IS THE SIXTH AND IT IS THE FIRST WHOSE ARGUMENT IS A COUNT THAT
// ALREADY STOOD AT TWO: thirty-one names to THIRTY-THREE, eighteen functions to
// NINETEEN, and the error classes from six to SEVEN. `decodePlanRules` is not a
// codec somebody might one day need in two places; `toPublishedRules`
// (`apps/worker`) and `decodeRules` (`apps/site`) read the same stored document
// under the same key spelling TODAY, return this package's own `PlanRulesJson`,
// and are compared by nothing, which is the `FM-16` section 1.3's rationale
// exists to price. Withholding it would not prevent a decoder, it would add the
// third one `apps/api` needs. `PlanRulesCodecError` is the seventh error class,
// on `EngineGatesCodecError`'s reason unchanged.
//
// ADR-302 IS THE SEVENTH AND IT IS THE FIRST WHOSE ARGUMENT IS A COUNT THAT
// ALREADY STOOD AT THREE, AND THE FIRST WHERE ALL OF THEM ARE RETIRED IN THE
// SAME DIFF: thirty-three names to THIRTY-FIVE, nineteen functions to TWENTY,
// and the error classes from seven to EIGHT. `decodeCapScheduleCents` had
// `toCapScheduleCents` (`apps/worker`), `decodeCapSteps` (`apps/site`) and
// `readCapSchedule` (`apps/api`) reading the same two stored keys out of the
// same `jsonb` column with nothing comparing them, AND THE THIRD HAD ALREADY
// DIVERGED ON THE MONEY: it admitted a `cap_cents` past
// `Number.MAX_SAFE_INTEGER` and handed back the rounded double, and refused the
// base-10 string ADR-283 ruling 5 blessed. So withholding it here would not have
// prevented a decoder, it would have left the divergence live; and adding it
// WITHOUT retiring the three would have been a FOURTH statement of the payout
// ceiling, which ADR-286 refused and ADR-269 refused before it for this same
// value. `CapScheduleCodecError` is the eighth error class, on
// `EngineGatesCodecError`'s reason unchanged.
//
// **AND THE ENCODE HALF IS DELIBERATELY ABSENT, WHICH IS WHERE THIS DIFFERS FROM
// ADR-250.** `gates-codec.ts` exports BOTH directions because the worker writes
// `rule_states.engine_gates` through `RuleStateWriterIo`. NOTHING in this
// repository writes `plan_versions.rules` from a `PlanRulesJson`: the publish
// path validates a document somebody authored. An encoder here would be a second
// statement of the shape with no caller to keep it honest, which is the thing
// this gate exists to refuse rather than an omission it should catch.
test('of the thirty-five names, exactly twenty are non-class functions after ADR-302', () => {
  const functions = Object.keys(engine)
    .filter((name) => typeof (engine as Record<string, unknown>)[name] === 'function')
    .sort();

  // A class is `typeof === 'function'` too, so the four error classes are
  // named and subtracted rather than filtered by a predicate that cannot see
  // the difference. `IMPLEMENTED_RULES` and the three tables are values.
  const classes = [
    'CalendarSliceError',
    'CapScheduleCodecError',
    'EngineGatesCodecError',
    'EngineInvariantError',
    'ExternalGatesRefusal',
    'PlanRulesCodecError',
    'ReplayAssertionError',
    'StateHashError',
  ];
  expect(functions.filter((name) => !classes.includes(name))).toEqual([
    'advanceDay',
    'applySettlement',
    'buildCalendarSlice',
    'buildSessionCalendar',
    'canonicalStateSerialization',
    'decodeCapScheduleCents',
    'decodeEngineGates',
    'decodePlanRules',
    'encodeEngineGates',
    'evaluatePayout',
    'initialState',
    'lookupCalendarDay',
    'nextTradingDayAfter',
    'projectPayout',
    'replay',
    'resolveExternalGates',
    'resolvePlan',
    'stateHash',
    'tradingDayAt',
    'validatePlan',
  ]);
});
