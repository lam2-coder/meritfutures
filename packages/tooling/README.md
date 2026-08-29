# @merit/tooling

Shared build tooling. Two kinds of thing live here and nothing else:

| Path | What it is |
|---|---|
| `eslint.base.js` | The ESLint base the workspace root composes. One copy, so a rule cannot be disabled in one application without a diff anyone reads |
| `checks/` | The repository invariants CI-01 asserts, each with a `covers` line stating what it does not check. `repo-invariants.mjs` holds the `CHECKS` array and the runner; a check whose argument runs long enough to crowd its neighbours lives in its own module beside it and is imported into that array |

There is deliberately no `src/`: nothing here is compiled, all of it is read by
a tool that runs before anything is built. It is still type-checked, from its
JSDoc, by this package's `tsc --noEmit`.

## The invariants

Run them with `pnpm check:invariants` from the workspace root, or
`node packages/tooling/checks/repo-invariants.mjs list` to read what each one
covers.

**THERE IS NO TABLE OF THEM HERE, AND THE ABSENCE IS THE POINT.** This file
carried one for five invariants and the tree grew past it: by the time anyone
looked, the table named five of what `list` prints, and its `RI-04` row said
"four deployables" where the check itself had said five since `apps/api`
landed. That is precisely what `RI-05`'s own `covers` calls a hand-maintained
count in a different costume, and what `RI-04` did when its literal held four
names against a tree of five: **it reported PASS for three sessions while
asserting nothing.** A second copy of a list does not fail when the list moves.
It goes stale in step, silently, in the document a reader trusts most.

So the roster is `list` and the reasons are the `covers` lines beside each
check, which the runner prints from the checks themselves. Read those.

Each invariant is watched failing on a seeded violation in
`test/repo-invariants.test.ts` before it is trusted, which is the rule
[`scripts/corpus/falsify.mjs`](../../scripts/corpus/falsify.mjs) applies to the
corpus gates. A check that has only ever been seen pass is indistinguishable
from a check that cannot fail.

## Why the package is not called `config`

[P1 section 2.1](../../docs/plans/P1-monorepo-scaffold.md). A package named
`config` is where the next person puts a plan parameter, it would look correct
to every future reader, and it would pass every gate this corpus has. The name
was free to fix while the package had no code in it.

Plan parameters are rows in `plan_versions.rules` and `plan_version_sizes`.
There is no plan parameter anywhere in application code, and that includes
here.

## What is deliberately not in the base

VG-4 landed with CI-01 (session S-C) as `merit/no-raw-db-client`, and it is
attached in the workspace root's [`eslint.config.js`](../../eslint.config.js)
rather than here. That is the same reason `merit/engine-purity` is attached
there: the base holds the rules that apply to **every** file, and a rule whose
whole meaning is the path it is scoped to belongs beside its glob.

Type-aware linting is still off, for the reason stated in `eslint.base.js`.
`no-raw-db-client` did not need it: what it reads is the module specifier.
