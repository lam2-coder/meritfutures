import { defineConfig } from 'vitest/config';

// =============================================================================
// packages/rules-engine/vitest.config.ts
// =============================================================================
// THIS FILE EXISTS FOR CI-09's STRYKER LEG AND FOR NOTHING ELSE. `pnpm test` at
// the root is unchanged and still runs the four stage projects the root
// `vitest.config.ts` declares; the root config lists its projects as inline
// objects rather than as directory globs, so nothing there discovers this file.
//
// WHY THE STAGE SPLIT IS WRONG HERE, WHICH IS THE ONLY REASON THIS IS NOT JUST
// A DUPLICATE. The root projects map to CI STAGES: CI-02 is `unit` plus
// `property` and CI-03 is `golden`, and they block independently, which is what
// makes `vitest run --project golden` a thing that has to work. A MUTANT IS
// KILLED BY WHICHEVER TEST NOTICES. Running mutation testing against one
// project would report a mutant as surviving because the file that kills it
// belongs to the other project, which is a false survivor and the worst kind of
// entry in a report whose whole content is survivors.
//
// So this include is the package's WHOLE suite in one run: unit, property and
// golden together. It asserts nothing the root config does not; it groups
// differently, deliberately, for a consumer that is not a CI stage.
//
// AND THERE IS NO COVERAGE THRESHOLD HERE EITHER. STRATEGY section 2 rules
// coverage out as a gate anywhere in this tree and `repo-invariants.mjs`
// asserts the absence rather than trusting a reader to notice.

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
