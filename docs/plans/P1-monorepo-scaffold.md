---
status: draft
depends_on: [../architecture/OVERVIEW.md, ../testing/STRATEGY.md, ../DELIVERY_PLAN.md, ../DECISIONS.md]
last_updated: 2026-08-15
---

# P1: the monorepo scaffold

**The last unstarted content of P1, and the longest-lived decision left in it.** Every VG gate, every CI stage from CI-01 to CI-05 and CI-07 to CI-09, and every module from P2 onward lands inside the shape this session fixes. [STATE](../STATE.md) measures the position: two of P1's three named contents are substantially done and this one has not begun.

## 1. What this plan is, and what it is not

**It is not a design.** The containers are ruled in [OVERVIEW section 3](../architecture/OVERVIEW.md), the tooling is ruled in [STRATEGY section 2](../testing/STRATEGY.md), the pipeline stages are ruled in [STRATEGY section 4.1](../testing/STRATEGY.md), and the data accessor is ruled in [ADR-008](../DECISIONS.md). **This plan re-plans none of it.** Its job is the three things the corpus does not say: which of those rulings the scaffold can silently break, what the session actually creates, and in what order.

**Scope boundary, stated so nobody scores P1 against the wrong line.** This plan covers the workspace and the packages. It does **not** cover the CI workflow files, the golden fixture loader, or TradingCalendar's data, each of which is its own session in section 6. P1's definition of done in [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) is "every VG gate wired and failing correctly on a seeded violation, VG-12 not deferred", and the scaffold is the precondition for that rather than the whole of it.

## 2. The three arguments

### 2.1 Package boundaries

[OVERVIEW section 3](../architecture/OVERVIEW.md) rules seven containers. The argument is not whether they are right; it is which of them the cheap scaffold choice destroys without anyone noticing.

**The `packages/rules-engine` purity boundary is the one that must be mechanical.** OVERVIEW gives it `(planConfigVersion, accountState, dayMarks[]) -> newState + events` and "zero I/O", and three separate commitments rest on that being literally true: the replay self-audit, the `PT-nn` property suites, and Stryker running there and nowhere else ([STRATEGY section 2](../testing/STRATEGY.md), where restricting mutation testing to the engine is what makes the number worth reading). **So the engine's `package.json` declares no workspace dependencies at all**, and a dependency check in CI-01 asserts that rather than a reviewer noticing. The clock is the same defect class as an import: the trading day comes from calendar data, so a wall-clock read inside the engine is impurity wearing a different hat.

**Why this belongs in the scaffold session rather than in P2.** The first `import { db }` into the engine will be added because it is convenient, in a session with a deadline, and every one of those three commitments degrades quietly at that moment. The cheapest time to make it impossible is while the package has no code in it.

**`apps/admin` is a separate deployable from the first commit, and it will look like waste for weeks.** [ADR-012](../DECISIONS.md) puts the admin console on a separate apex domain, [SECURITY](../architecture/SECURITY.md) treats one owned admin as total loss, and [STRATEGY section 2](../testing/STRATEGY.md) chose Playwright over Cypress **specifically because** that separate origin makes cross-origin a requirement rather than an edge case. The tempting scaffold is one application with three route groups. That choice is invisible for months, is a re-platform to undo, and it silently converts a security control into a URL convention.

**`worker` is the one row in OVERVIEW's table with no path prefix, and this plan decides it: `apps/worker`.** It is a deployable with its own lifecycle, not a library anything imports. Putting it under `packages/` would make "apps are deployables, packages are libraries" false in exactly one place, and that rule is not decoration: VG-4 depends on it, per the next paragraph. **Recorded as a plan decision rather than an ADR**, because it names a path and moves no ruling.

**The layout is what makes VG-4 writable at all, which is the strongest argument that these boundaries are not cosmetic.** VG-4 is "a custom ESLint rule banning raw client imports in app paths" ([STRATEGY section 4.2](../testing/STRATEGY.md)). A rule phrased over "app paths" is expressible only if app paths are a glob, and only if `packages/db` is the single package permitted to import the Drizzle client. **A flat `src/` layout does not make VG-4 harder; it makes a ruled merge blocker unwritable.**

**Two packages the scaffold needs that OVERVIEW does not name**, flagged rather than smuggled: `packages/tooling`, holding the base `tsconfig`, ESLint and Prettier, and `packages/eslint-plugin-merit`, which will hold the VG-4 rule. The alternative is that each application grows its own copy of the base config, and VG-4 gets disabled in one of them without a diff anyone reads. **These are tooling, not architectural containers**, so this plan treats them as outside OVERVIEW section 3's list rather than as an amendment to it (**ruled: no ADR**, section 7).

**The tooling package is not called `config`, and the reason is section 2.3.** This plan quotes "there is no plan parameter anywhere in application code" and then proposes a package whose name is the single most natural place to put one. A `cap_bp` in `packages/config` would look correct to every future reader, would pass every gate this corpus has, and would be found the first time a value moved. **The name is free to fix while the package has no code in it**, which is the same argument this plan makes for the engine's dependency boundary and is worth applying to itself.

### 2.2 The test runner

**Vitest in workspace mode, fast-check, Playwright one project per surface, a Neon branch per CI run. All ruled** ([STRATEGY section 2](../testing/STRATEGY.md)) and none of it reopened here. Three ways the scaffold breaks the ruling while appearing to implement it:

**Vitest projects map to CI stages, not to packages.** [STRATEGY section 4.1](../testing/STRATEGY.md) makes CI-02 "unit and property" and CI-03 "golden files" two stages that run on every push and block independently. The default scaffold gives one project per package, and at that point CI-03 is no longer a stage, it is a subset of CI-02 that cannot be run alone or blocked on separately. **Named projects (`unit`, `property`, `golden`, `integration`) are what make the ruled pipeline expressible.**

**No coverage threshold, anywhere, and this must be actively removed rather than merely not added.** [STRATEGY section 2](../testing/STRATEGY.md) rules coverage out as a gate and gives the reason: on an AI-assisted codebase, line coverage measures how much code was executed, which is the one quality signal generated tests inflate for free. **Every scaffold generator in this ecosystem adds a threshold by default.** This is the clearest case in the plan of a tool's default silently contradicting a ruling.

**The golden fixture loader must be incapable of calling the code under test.** [STRATEGY section 2](../testing/STRATEGY.md) rejected TypeScript fixture builders for exactly this reason, and TR-01 depends on it: fixtures are YAML with an expected end-state JSON sibling, derived from the plan documents rather than from implementation output. The scaffold's obligation is narrow and structural: the loader reads a directory and imports the engine's public entry point only.

**One scaffold-time consequence worth surfacing early.** A Neon branch per CI run means CI-04 needs a Neon token in the CI environment, so that stage cannot run on a fork pull request and must degrade honestly rather than appear green. VG-7 already rules that agent sessions hold development credentials only.

### 2.3 Where plan parameters are structurally forbidden from living

The rule is absolute and already written: **"There is no plan parameter anywhere in application code: these are rows in `plan_versions.rules` and `plan_version_sizes`"** ([DATA_MODEL section 12](../architecture/DATA_MODEL.md)), with [M01](M01-rules-engine.md) requiring every downstream surface to read from the account's pinned plan version at request time, and [DESIGN_SYSTEM](../design/DESIGN_SYSTEM.md) putting it as "a parameter is read, never copied".

**"Structurally forbidden" is a stronger claim than "linted", and the plan separates three tiers because only the first is actually structural.**

| Tier | Mechanism | Where |
|---|---|---|
| **1. Forbidden by signature** | The engine's public type **requires** the full pinned config. No parameter field is optional, no default exists, no `DEFAULT_CAP_BP` is declarable. A missing field is a type error, not a fallback | `packages/rules-engine`, at scaffold time |
| **2. Forbidden by path** | A named allowlist of the only places a parameter value may appear as a literal: the migrations and seed data, golden fixtures and their expected-state siblings, `research/calibration/`, and the corpus documents. Everywhere else a bare parameter value is a finding | Repository-wide, expressible because of 2.1's layout |
| **3. Forbidden by component** | GS-143's `<PlanValue>` and the content lint, so a number in a headline or a price card is read from the pinned version | `apps/site` and `apps/portal`, **and this is P4's work, not P1's** |

**The strongest available check is not a lint, and it belongs to P2 rather than here, so the scaffold must leave room for it.** Propose: a property asserting that **every parameter in the config changes some output**. If a field can be perturbed and no golden scenario moves, then either the engine ignores it, which means the value is hardcoded somewhere, or the config carries something dead. **A numeric-literal lint is evadable by arithmetic and by naming; "this parameter demonstrably does nothing" is not.** It is the same idea as the probe that led with the permitted transition succeeding: assert the thing works, not only that the forbidden thing is rejected.

**Scope honesty.** Tier 1 is scaffold work. Tier 2 is a written allowlist in this plan, enforced when the lint arrives. Tier 3 is P4's definition of done in [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md). **P1 is not incomplete for lacking the parameter lint, and pulling it forward is scope nobody asked for.**

## 3. What the scaffold session creates

**Enumerated because the one-artifact-one-session rule is enforced by this list.** Two sessions writing one file cost a full reconciliation once already. No other in-flight session may create any file below.

| Area | Files |
|---|---|
| **Workspace root** | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.nvmrc`, `tsconfig.base.json`, `vitest.workspace.ts`, `eslint.config.js`, `.prettierrc` |
| **Libraries** | `packages/rules-engine/`, `packages/rithmic/`, and `packages/db/` gaining `package.json`, `tsconfig.json` and `src/` beside the existing `migrations/` and `DELTA_MANIFEST.md` |
| **Deployables** | `apps/site/`, `apps/portal/`, `apps/admin/`, `apps/worker/`, each with `package.json`, `tsconfig.json`, and a minimal entry point |
| **Tooling** | `packages/tooling/`, `packages/eslint-plugin-merit/`. **Not `packages/config`**, per section 2.1 |
| **Edited, not created** | `.github/workflows/corpus.yml`, for the two riders in section 5 only |

**`packages/db` is the one existing directory the session touches**, and it gains files beside the migrations rather than altering them. **No `.sql` file is edited. Migrations are sacred.**

## 4. Definition of done

Each line is a command with an output, per the evidence doctrine. "It works" is not one of them.

1. `pnpm install --frozen-lockfile` succeeds from a clean checkout, which is also VG-12's precondition.
2. `tsc --noEmit` passes across every workspace.
3. `vitest run` executes every named project and reports the placeholder test in each package.
4. **The dependency check proves `packages/rules-engine` has no workspace dependencies**, and fails when one is added.
5. **No coverage threshold exists anywhere in the tree**, asserted rather than assumed.
6. `node scripts/corpus/gates.mjs check` still reports every gate passing, and `node scripts/corpus/falsify.mjs` is green.
7. The three riders are in `corpus.yml` and the workflow is green on the pull request.

**Items 6 and 7 cannot both hold against section 3's tree until OQ-P1-04 is ruled, and that is a real conflict rather than a caveat.** CI-06b demands frontmatter on every `.md` under `packages/`, so the first package README fails it. **The scaffold session must not discover this**, because the only fixes available to a session under a red gate are to weaken the gate or to put a corpus gate status on a file that is not a corpus document. Both are wrong, and one of them is wrong in the way this corpus exists to prevent. **The ruling is a precondition of S-B**, section 6.

## 5. The three riders

**All ride with the scaffold session, after PR #9 merges, not on PR #9.** They are carried verbatim into that session's prompt. **All three edit `corpus.yml` and no other session touches that file**, which is section 3's collision rule holding rather than an accident.

**Rider 1.**
```
Wire scripts/corpus/falsify.mjs into corpus.yml's integrity job: a step after
"Run corpus gates" running `node scripts/corpus/falsify.mjs`, on every push.
The eleven gates are proven falsifiable as of one session and nothing keeps
them so. A gate nobody has watched fail is not a gate (STRATEGY section 4.4).
```

**Rider 2.**
```
Wire scripts/db/probe_plan_version_immutability.sql into corpus.yml's
migrations job: one line beside the existing ledger-probe step, same psql
invocation with ON_ERROR_STOP. That job runs only probe_ledger_constraints.sql
today, so ADR-035's guard is verified by nothing after the session that fixed it.
```

**Rider 3.**
```
Make .nvmrc the only Node version in the tree. corpus.yml hardcodes
node-version: '22'; replace it with node-version-file: .nvmrc on every
setup-node step, and add .nvmrc. Two files holding one number is a
hand-maintained count in a different costume, and it drifts the same way.
```

**Rider 2 is the one that matters more.** A probe that ships beside a fix and never runs again is the same object as the golden test that was missing, and that is precisely the condition that let the `NEW.config` defect live inside a merged migration through a founder-grade review and a full install check.

**Rider 3 replaces this plan's own first answer to OQ-P1-03, which was wrong in the way the corpus is trained to catch.** The proposal was to pin the version "in `.nvmrc` and in CI, both places", which is two artifacts holding one value with nothing reconciling them. **A plan that argues against hand-maintained counts for three sections and then specifies one is worth recording as an instance rather than editing quietly.**

## 6. Sequencing, and what each session may touch

**No session below starts before PR #9 merges.** Nothing here is parallel with it, because `corpus.yml` exists only on that branch and `main` has no CI at all.

| # | Session | Regime | Creates | Depends on |
|---|---|---|---|---|
| **S-A** | **ADR-036, the migration number allocation table**, as a second table beside the ADR allocation in [DECISIONS](../DECISIONS.md). One mechanism, one place to look | non-money | nothing new | PR #9 merged |
| **S-B** | **The scaffold**, section 3, carrying all three riders | non-money | section 3's list | S-A, **and the OQ-P1-04 ruling** |
| **S-C** | **CI-01, CI-02 and CI-05, with VG-12** | non-money | `.github/workflows/ci.yml` | S-B |
| **S-D** | **The golden fixture loader and CI-03** | non-money | the loader and the fixture directory | S-B |
| **S-E** | **TradingCalendar as data** | **money path, fresh session, plan mode** | the seed mechanism and the calendar rows | S-B |

**S-A lands before any parallel money-path work**, which is the whole reason it is first: migration numbers have no allocation table, [CI-06h](../testing/STRATEGY.md) asserts they are gapless and unique but surfaces a collision at merge rather than in CI, and nothing today stops two branches both claiming `0029`.

**S-E is money path and is called out as such.** The calendar decides what a trading day is, and every counter the engine keeps is counted in trading days, so a wrong row changes rule outcomes without changing a line of engine code. It gets a fresh session, plan mode, and [ADR-003](../DECISIONS.md)'s strict regime. **That prompt is written when S-B lands, not before**, because it should name the seed mechanism the scaffold actually produced.

**Every gate any of these sessions wires ships with a seeded violation in `falsify.mjs`, and must fail on that finding rather than merely exit non-zero.** Two of the eleven corpus gates were failing off-target and would have been scored as working. [STATE](../STATE.md) already carries this as the thing the reconciliation proved about P1's own definition of done: "failing correctly on a seeded violation" is two checks, not one.

## 7. Rulings, and the one question that blocks

### Ruled 2026-08-15

| # | Question | Ruling |
|---|---|---|
| **OQ-P1-01** | Do the tooling packages need an ADR, given [OVERVIEW section 3](../architecture/OVERVIEW.md)'s container table does not name them? | **No ADR.** That table is architectural containers and these are build tooling. **And `packages/config` is renamed `packages/tooling`**, per section 2.1: a package named `config` is where the next person puts a plan parameter, and it will look right |
| **OQ-P1-02** | A build orchestrator, or none? | **None at P1.** Adopting one later is additive rather than a migration |
| **OQ-P1-03** | Where is the Node version pinned? | **`.nvmrc` is the only source**, read by `setup-node` through `node-version-file`. **Rider 3**, section 5 |

### OQ-P1-04, open, and S-B does not start until it is ruled

**CI-06b's scope is `^(docs|research|packages)/`, so it demands corpus frontmatter on every markdown file under `packages/`, and the first package README fails it.** Reproduced against the tree at this branch:

```
FAIL   CI-06b  Frontmatter present and valid on every tracked document  (1)
       packages/rules-engine/README.md: no frontmatter block
```

**The sharpest form of the defect is that the same file passes CI-06c**, whose scope is `^(docs|research)/` **plus `packages/db/DELTA_MANIFEST.md` by name**. **The runner already contains both answers to "what is a tracked document", ten lines apart, and only one of them survives a scaffold.** The divergence is inherited: the reconciliation took PR #8's glob where PR #7 carried the explicit allowlist, and the two looked equivalent because `packages/` has held exactly one markdown file since it existed.

| Option | What it costs |
|---|---|
| **A. Bring CI-06b to CI-06c's scope**: `docs/` and `research/`, plus an explicit allowlist of files elsewhere, `DELTA_MANIFEST.md` being the only current entry | An allowlist is a list, and a list drifts. Mitigated by the two gates then reading **one** definition, so a future corpus document under `packages/` is added in one place rather than two |
| **B. Keep the glob and put frontmatter on package READMEs** | **`status: approved` on a package README is a gate status on a file that is not gated**, and `depends_on` has no meaning there. It also strands the file between the two gates: CI-06b would require the status while CI-06c would not require an INDEX row, in a corpus whose rule is that a thing not in INDEX does not exist |
| **C. Exempt `README.md` by filename** | **Punches a hole through the corpus itself.** `docs/legal/README.md` and `docs/ops/runbooks/README.md` are corpus documents and would silently stop being checked |

**Recommendation: A, which is the founder's own read.** CI-06b's row in [STRATEGY section 4.4](../testing/STRATEGY.md) says "every document", and the document class it means is the corpus. A package README is a source file that happens to be markdown. **C is disqualified on evidence rather than on taste**, and B is the option that makes a gate green by making its status field meaningless, which is the failure this corpus names most often.

**This is recorded as a question rather than applied, deliberately, and the reason is the ruling itself.** The scope is a merge blocker, the session that found it is the session that finds it inconvenient, and **a gate narrowed by the party it is about to block is not a gate.** The fix is one line in a runner and it still does not belong to this session.
