import { expect, test } from 'vitest';

import * as engine from '../src/index.js';

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
// reimplement a rule slightly differently" -- and two of those six are now
// written. So the list below is exact rather than open, and adding an export
// without adding it here is still a red stage.
//
//   advanceDay, initialState   M01 section 1.3, two of the six
//   buildCalendarSlice         ADR-049: the slice is "built by a pure exported
//   lookupCalendarDay          constructor", with "the calendar queries as free
//   CalendarSliceError         functions in `calendar.ts` over that value"
//   EngineInvariantError       R-14's tripwire is useless if a caller cannot
//                              catch it by type
//   IMPLEMENTED_RULES          ADR-048: "the engine exports the set of rule
//                              identifiers it implements, and that export is
//                              part of its public contract"
//   evaluate                   the scaffold's stub, still what CI-03's polarity
//                              probe folds, retired when the loader moves to
//                              `advanceDay`
test('the engine entry point is the whole public surface, and it is this exact list', () => {
  expect(Object.keys(engine).sort()).toEqual([
    'CalendarSliceError',
    'EngineInvariantError',
    'IMPLEMENTED_RULES',
    'advanceDay',
    'buildCalendarSlice',
    'evaluate',
    'initialState',
    'lookupCalendarDay',
  ]);
  expect(typeof engine.evaluate).toBe('function');
  expect(typeof engine.advanceDay).toBe('function');
});
