import { defineConfig } from 'vitest/config';

// =============================================================================
// vitest.config.ts
// =============================================================================
// THE PROJECTS MAP TO CI STAGES, NOT TO PACKAGES. P1 section 2.2, and it is the
// difference between the ruled pipeline being expressible and not:
// STRATEGY section 4.1 makes CI-02 "unit and property" and CI-03 "golden files"
// two stages that run on every push and block independently. The default
// scaffold gives one project per package, and at that point CI-03 is not a
// stage, it is a subset of CI-02 that cannot be run alone or blocked on
// separately.
//
//   pnpm vitest run --project golden      <- what CI-03 runs, and it must work
//
// A package therefore contributes tests to SEVERAL projects, chosen by filename
// suffix rather than by directory, so a package's golden fixtures live beside
// its unit tests and still land in the stage that owns them.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE IS NOT `vitest.workspace.ts`, WHICH IS WHAT P1 SECTION 3 NAMES
// -----------------------------------------------------------------------------
// VITEST 4 SILENTLY IGNORES `vitest.workspace.ts`. Verified against
// vitest@4.1.10 before this file was written, because "it ran and the tests
// passed" is exactly how this defect hides: with a `vitest.workspace.ts`
// present, `vitest run` still discovers `**/*.test.ts` through its DEFAULT
// include and reports green, while the four named projects do not exist. CI-03
// would then be unrunnable alone, which is precisely the failure P1 section 2.2
// exists to prevent, arrived at by honouring the plan's file list literally.
//
// The plan's ARGUMENT is "named projects `unit`, `property`, `golden`,
// `integration`"; `vitest.workspace.ts` was the Vitest 3 spelling of it, and
// section 1 is explicit that the plan re-plans none of the ruled tooling. So
// the argument is carried and the filename is not. `repo-invariants.mjs`
// asserts both halves: the four names are present here, and a
// `vitest.workspace.ts` may not reappear in the tree.
// -----------------------------------------------------------------------------
//
// THERE IS NO COVERAGE THRESHOLD HERE AND THERE MUST NEVER BE ONE. STRATEGY
// section 2 rules coverage out as a gate: on an AI-assisted codebase, line
// coverage measures how much code was executed, which is the one quality signal
// generated tests inflate for free. Every scaffold generator in this ecosystem
// adds a threshold by default, so its absence is ASSERTED by
// `repo-invariants.mjs` rather than left to a reader noticing.

// `scripts/demo` IS A SOURCE ROOT AND NOT A FOURTH PROJECT, which is the whole
// of this line's argument. The projects map to CI STAGES rather than to
// directories, so a `demo` project would be claiming a stage the ruled pipeline
// does not have. What `scripts/demo/test` holds is a unit suite by every
// ordinary meaning of the word -- it asserts that a pure function returns the
// same bytes twice -- so it belongs in CI-02 beside the others, and adding the
// root here is what puts it there. A test matched by no project does not run,
// and a determinism claim nothing runs is a claim, not a control.
//
// `scripts/corpus` JOINED ON THE SAME ARGUMENT (ADR-296). It holds `gates.mjs`,
// the runner every corpus gate is spelled in, and its `test/` directory holds a
// unit suite over that runner's REPORT. Same reasoning, same stage, and the same
// reason it is a source root rather than a project: CI-06 is the stage that runs
// the gates, and CI-02 is the stage that runs the suite about how they are
// counted.
const SOURCES = ['apps/*', 'packages/*', 'scripts/corpus', 'scripts/demo'];

/** Test files that belong to no stage-specific suffix. CI-02, with `property`. */
const UNIT = SOURCES.map((s) => `${s}/test/**/*.test.ts`);

/** A suffixed file belongs to its stage and to no other. */
const suffixed = (suffix: string) => SOURCES.map((s) => `${s}/test/**/*.${suffix}.test.ts`);

const PROPERTY = suffixed('property');
const GOLDEN = suffixed('golden');
const INTEGRATION = suffixed('integration');

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: UNIT,
          // Without these the suffixed files run twice, once in `unit` and once
          // in their own stage, and CI-02 would go red for a CI-03 failure.
          exclude: [...PROPERTY, ...GOLDEN, ...INTEGRATION],
        },
      },
      {
        // CI-02's second half. fast-check lives here (STRATEGY section 2).
        test: { name: 'property', include: PROPERTY },
      },
      {
        // CI-03. The fixture loader that fills this project is session S-D's,
        // per P1 section 6; what this scaffold owes it is a stage that can be
        // run and blocked on by itself.
        test: { name: 'golden', include: GOLDEN },
      },
      {
        // CI-04, and the stage now EXISTS and selects this project: `ci.yml`'s
        // `integration` job runs `vitest run --project integration` (ADR-085).
        // Until 2026-08-24 no workflow selected it, which is why the record
        // blamed a Neon branch that was never the blocker. A project nothing
        // selects is a suite that has never run.
        //
        // THE FORK-PULL-REQUEST DEGRADATION ARRIVES WITH THE DATABASE, NOT
        // BEFORE IT. A Neon branch per run cannot run on a fork PR and must
        // degrade honestly rather than appear green (P1 section 2.2) -- but the
        // assertions this project holds today need no database at all, so there
        // is nothing yet to degrade. STRATEGY section 4.1 keeps the Neon branch
        // as CI-04's second leg with its condition dated and unchanged.
        test: { name: 'integration', include: INTEGRATION },
      },
    ],
  },
});
