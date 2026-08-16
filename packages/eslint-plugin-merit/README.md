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
| `merit/no-raw-db-client` | **VG-4.** Only `packages/db` imports a database client; everything else reads through `scopedDb(identity)` |
| `merit/no-calendar-in-expiry-path` | **ADR-042.** The hold, expiry and sweep path may not import the trading calendar. A release deadline is wall-clock hours |

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

## VG-4, and where its exception lives

`no-raw-db-client` is unconditional: it reports every raw client import it
sees. The one package permitted to hold them is named as an `ignores` entry in
the workspace root's [`eslint.config.js`](../../eslint.config.js), not as an
allowlist inside the rule. A list inside the rule is a list a rule change can
widen silently; a line in the root config is a diff on the file whose entire
subject is which rules apply where.

It is attached to `apps/**` **and** `packages/**` rather than to app paths
alone. [STRATEGY section 4.2](../../docs/testing/STRATEGY.md) phrases VG-4 over
"app paths"; [ADR-008](../../docs/decisions/ADR-008.md) and `packages/db`'s own header
phrase the invariant over the complement, and the wider set is the correct one.
A raw connection opened in `packages/rithmic` is exactly as unscoped as one
opened in `apps/portal`.

The scaffold recorded that this rule "needs the `scopedDb(identity)` accessor to
exist before it can name what it permits". That was the softer half: what it
**bans** is fixed today and what it **points at** is a package that exists.
Waiting for the accessor would have shipped a CI-01 stage with a hole in it
where STRATEGY puts a merge blocker.

Both halves are watched: `test/no-raw-db-client.test.ts` proves the rule works,
and `CI-01/vg4` in
[`scripts/ci/falsify-ci.mjs`](../../scripts/ci/falsify-ci.mjs) seeds a real file
into `apps/portal/src/` and proves the **stage** fails on this rule's name.

## ADR-042, and the rule whose glob matches nothing yet

`no-calendar-in-expiry-path` is the strongest of that ruling's three mechanisms,
for one reason: **an import is checkable and an intention is not.**

The ruling is that an obligation Merit binds itself to is measured in exactly one
of two units. **Trading days**, answered only by `TradingCalendar`, for every
engine counter. **Wall-clock hours**, answered only by `now()`, for every release
deadline. Nothing Merit computes is measured in business days; that is the rail's
language, quoted where the rail's leg is described and never calculated.

The failure it exists for is specific. `payout_requests.freeze_expires_at` and
`wallet_withdrawals.freeze_expires_at` are `timestamptz`, and M05 described them
in prose as "10 business days". **There is no business-day calendar anywhere in
this system.** So whoever implements the sweep reaches for the only calendar in
the database, which is the trading calendar, which is a different set of days:
the exchange trades on days banks are shut and shuts on days banks trade. The
substitution is wrong on roughly 104 days a year and it **looks exactly right in
review**, because the import resolves, the types line up, and the code reads as
though somebody thought about holidays.

**Its glob matches zero files today and that is the argument for wiring it now.**
The hold, expiry and sweep paths are P2 code. A rule wired while it is green, and
watched failing on a seeded violation, is the cheapest it will ever be; wired
afterwards it arrives to find the defect already shipped. Every message it can
emit is watched firing in `test/no-calendar-in-expiry-path.test.ts`, including
the exact scenario the ruling predicted, `addTradingDays(from, 5)` inside a
freeze sweep.

**A rule scoped to nothing and a rule unplugged produce byte-identical lint
output**, so `RI-06` in `packages/tooling/checks/repo-invariants.mjs` asserts the
wiring in both directions: every rule this plugin registers is attached to a glob
in the workspace root `eslint.config.js`, and every `merit/*` rule that config
names is one this plugin registers.
