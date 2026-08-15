# @merit/rules-engine

Pure rule computation, zero I/O.

```
(planConfigVersion, accountState, dayMarks[]) -> newState + events
```

Nothing is implemented. `evaluate` is the identity evaluation and the placeholder
test says so out loud, because M01 arrives under TR-02: the golden fixtures exist
and fail before the functions do. **What this session fixed is the boundary, not
the behavior**, and the boundary is the part that stops being fixable once code
depends on it.

## The purity boundary is guarded three ways, and none of them is a reviewer

| Mechanism | Where | Catches |
|---|---|---|
| `types: []` and `lib: ["ES2023"]` | `tsconfig.json` | `process`, `Buffer`, `fetch`, `require` and every other ambient global do not exist here. An I/O call is a **compile error**, and no lint-disable comment routes around it |
| `RI-01` | [`@merit/tooling`](../tooling/checks/repo-invariants.mjs) | A workspace package in any of the four dependency fields of `package.json` |
| `merit/engine-purity` | [`eslint-plugin-merit`](../eslint-plugin-merit/rules/engine-purity.js) | A clock read, `Math.random`, `Intl`, a non-relative import, a float literal |

Three because each misses what the others catch. The manifest check cannot see
an import that resolves through a hoisted layout. The lint rule cannot see a
nondeterministic value that arrives as an argument. The compiler cannot see a
`@merit/db` dependency that is declared but unused yet.

**The clock is the same defect class as an import.** The trading day comes from
calendar data, so a wall-clock read here is impurity wearing a different hat,
and it breaks the replay self-audit silently rather than loudly.

## Why this matters more than it looks

Three commitments rest on the zero-I/O contract being literally true:

- the **replay self-audit**, which asserts byte-identical reproduction of every
  stored state;
- the **`PT-nn` property suites**;
- **Stryker**, which runs here and nowhere else. Restricting mutation testing to
  this package is what makes the number worth reading.

The first `import { db }` into this package will be added because it is
convenient, in a session with a deadline, and all three degrade quietly at that
moment. The cheapest time to make it impossible was while the package had no
code in it.

## Plan parameters

There are none here and there cannot be. `PlanConfigVersion` is a closed record
of required fields, so a caller who has not read the account's pinned plan
version cannot construct one; a missing field is a type error rather than a
fallback. `PlanConfigVersionIsClosed` in `src/types.ts` asserts that at compile
time, so a later `cap_bp?: number` stops the build instead of looking like a
convenience.

Parameters are rows in `plan_versions.rules` and `plan_version_sizes`. A
parameter is read, never copied.

## Tests, by the stage that runs them

| File | Project | Stage |
|---|---|---|
| `test/evaluate.test.ts` | `unit` | CI-02 |
| `test/evaluate.property.test.ts` | `property` | CI-02 |
| `test/evaluate.golden.test.ts` | `golden` | CI-03 |

The golden file is a placeholder holding the stage open. The fixture loader and
the fixtures are session S-D in
[P1 section 6](../../docs/plans/P1-monorepo-scaffold.md).
