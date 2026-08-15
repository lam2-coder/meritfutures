# eslint-plugin-merit

ESLint rules that enforce a Merit ruling rather than a style preference. A rule
belongs here when a document says something a reviewer cannot be relied on to
notice in a diff.

Plain JavaScript with JSDoc types, not TypeScript. A plugin that must be
compiled before ESLint can load it is a plugin that stops running on the day the
compile breaks, in the stage whose job is to notice that. `tsc --noEmit` still
checks it.

## Rules

| Rule | Enforces |
|---|---|
| `merit/engine-purity` | `packages/rules-engine` has zero I/O, no ambient nondeterminism and no floating-point literals |

`engine-purity` is the **source-level half** of the engine's purity boundary.
The manifest half is `RI-01` in
[`@merit/tooling`](../tooling/checks/repo-invariants.mjs), which asserts the
engine declares no workspace dependency. Neither half substitutes for the other:
an undeclared import resolves anyway under a hoisted layout, and a clock read
needs no manifest entry at all.

It reads one file at a time with no type information, so it sees the spelling of
impurity rather than impurity itself. A nondeterministic value passed in as an
argument is invisible to it; the property suites and the replay self-audit are
what catch that class.

Every message it can emit is watched firing in `test/engine-purity.test.ts`,
alongside the valid cases that stop it from being a rule that rejects
everything.

## Not here yet

**VG-4**, the rule banning raw Drizzle client imports outside `packages/db`
([ADR-008](../../docs/DECISIONS.md),
[STRATEGY section 4.2](../../docs/testing/STRATEGY.md)). It needs the
`scopedDb(identity)` accessor to exist before it can name what it permits, and
it lands with CI-01.
