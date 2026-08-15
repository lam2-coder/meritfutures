# @merit/db

Schema, migrations, and `scopedDb(identity)`.

## Migrations are not source

`migrations/` is plain reviewable SQL. Forward only, reviewed on `main`, **never
edited after merge, only superseded** (constitution E2). It is excluded from
this package's `tsconfig.json`, from ESLint and from Prettier: nothing compiles
it, nothing generates it, and nothing reformats it.

[`DELTA_MANIFEST.md`](DELTA_MANIFEST.md) is the authority on which schema
changes are in scope, and it is the one markdown file under `packages/` that is
a corpus document, gated as such.

Migration numbers are claimed in the allocation table in
[`docs/DECISIONS.md`](../../docs/DECISIONS.md) **before the file is written**.
A branch cannot see its siblings, so two branches forking from the same `main`
both find the same last number, and the collision surfaces at merge in a
directory rather than in CI. `CI-06h` asserts the sequence is gapless over
allocated plus reserved.

## The accessor

`scopedDb(identity)` is the only sanctioned data idiom
([ADR-008](../../docs/DECISIONS.md), accepted with the wrapper and the ESLint
ban as part of the acceptance rather than a follow-up). **This is the only
package permitted to import the Drizzle client**, and that exception is what
makes VG-4 writable: a rule phrased over "app paths" needs app paths to be a
glob and needs exactly one package to be the exception.

Neither the client nor the accessor exists yet. What this scaffold fixes is that
they will live here and nowhere else.

**VG-4 is wired** (session S-C) as `merit/no-raw-db-client` in
[`eslint-plugin-merit`](../eslint-plugin-merit/README.md), attached to
`apps/**` and `packages/**` with this package as the single `ignores` entry. It
did not wait for `scopedDb`: what it bans is fixed today, and what it points at
is this package. **The exception is one line in the workspace root's
`eslint.config.js`**, which is where a reviewer looks to answer "which rules
apply where", rather than an allowlist inside the rule.
