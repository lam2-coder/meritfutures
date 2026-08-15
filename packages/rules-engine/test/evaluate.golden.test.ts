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
test('the engine has one public entry point, and it exports the evaluation and nothing else', () => {
  expect(Object.keys(engine)).toEqual(['evaluate']);
  expect(typeof engine.evaluate).toBe('function');
});
