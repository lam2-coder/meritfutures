# @merit/tooling

Shared build tooling. Two things live here and nothing else:

| File | What it is |
|---|---|
| `eslint.base.js` | The ESLint base the workspace root composes. One copy, so a rule cannot be disabled in one application without a diff anyone reads |
| `checks/repo-invariants.mjs` | The five repository invariants CI-01 asserts, with `covers` lines stating what each one does not check |

There is deliberately no `src/`: neither file is compiled, both are read by a
tool that runs before anything is built. They are still type-checked, from
their JSDoc, by this package's `tsc --noEmit`.

## The invariants

Run them with `pnpm check:invariants` from the workspace root, or
`node packages/tooling/checks/repo-invariants.mjs list` to read what each one
covers.

| | Invariant | Why it is mechanical rather than reviewed |
|---|---|---|
| RI-01 | `packages/rules-engine` declares no workspace dependencies | The first `import { db }` into the engine will be added because it is convenient, in a session with a deadline, and the replay self-audit, the property suites and Stryker all degrade quietly at that moment |
| RI-02 | No coverage threshold exists anywhere | Every scaffold generator in this ecosystem adds one by default, and the strategy rules coverage out as a gate. Absence has to be asserted, not assumed |
| RI-03 | The Vitest projects are named for the CI stages | Vitest 4 silently ignores `vitest.workspace.ts`, and one project per package makes the golden-file stage unrunnable alone |
| RI-04 | `site`, `portal`, `admin` and `worker` are four deployables | One application with three route groups is invisible for months, is a re-platform to undo, and converts a security control into a URL convention |
| RI-05 | `.nvmrc` is the only Node version in the tree | Two files holding one number is a hand-maintained count in a different costume |

Each is watched failing on a seeded violation in `test/repo-invariants.test.ts`
before it is trusted, which is the rule
[`scripts/corpus/falsify.mjs`](../../scripts/corpus/falsify.mjs) applies to the
corpus gates.

## Why the package is not called `config`

[P1 section 2.1](../../docs/plans/P1-monorepo-scaffold.md). A package named
`config` is where the next person puts a plan parameter, it would look correct
to every future reader, and it would pass every gate this corpus has. The name
was free to fix while the package had no code in it.

Plan parameters are rows in `plan_versions.rules` and `plan_version_sizes`.
There is no plan parameter anywhere in application code, and that includes
here.

## Not here yet

VG-4, the ESLint rule banning raw Drizzle client imports outside `packages/db`
([ADR-008](../../docs/DECISIONS.md)), needs the `scopedDb(identity)` accessor to
exist before it can name what it permits. It lands with CI-01, which is a later
session in [P1 section 6](../../docs/plans/P1-monorepo-scaffold.md).
