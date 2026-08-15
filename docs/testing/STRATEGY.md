---
status: approved
depends_on: [../../MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, ../DECISIONS.md, ../EDGE_CASES.md, GOLDEN_SCENARIOS.md, SIMULATION_HARNESS.md, ../architecture/INFRA.md, ../architecture/SECURITY.md, ../architecture/API_CONTRACT.md, ../architecture/DATA_MODEL.md, ../plans/M01-rules-engine.md, ../../research/VIBE_FAILURE_POSTMORTEMS.md, ../../research/SECURITY_LANDSCAPE.md]
last_updated: 2026-08-15
---

# Testing Strategy

Constitution section 5 instantiated, with the tooling chosen and every CI gate inventoried in one place. Section 5 says it is binding, and this document is what makes it executable: the seven numbered requirements become named suites, the `VG-1` to `VG-12` gates from [VIBE_FAILURE_POSTMORTEMS](../../research/VIBE_FAILURE_POSTMORTEMS.md) become jobs with owners, the `D0-1` to `D0-10` attack scenarios from [SECURITY_LANDSCAPE](../../research/SECURITY_LANDSCAPE.md) become golden files, and the docs link-check joins the inventory per the batch 2 gate ruling.

**Identifier conventions:** `CI-nn` pipeline stages, `TR-nn` testing rules that bind regardless of suite, `PT-nn` property tests on the engine. `VG-nn`, `D0-nn`, `GS-nnn`, and the per-module suite prefixes (`M14-D-nn` and friends) are existing identifiers and are used unchanged.

---

## 1. The four rules that bind every suite

Everything below is mechanics. These four are the strategy.

| ID | Rule | Why it is a rule rather than a preference |
|---|---|---|
| TR-01 | **Tests come from the spec, never from the implementation.** Every golden file's expected value is computed by hand from the plan doc's prose, by somebody reading the prose rather than the code | Constitution C10's self-grading trap. A fixture written by reading the implementation proves only that the code agrees with itself, which is the property that lets an ambiguous rule ship. [M12](../plans/M12-transparency-platform.md) section 8 applies the same rule to published statistics and [GOLDEN_SCENARIOS](GOLDEN_SCENARIOS.md) section 1 states it for fixtures |
| TR-02 | **Tests first on any money path.** Rules engine, ledger, payout, auth. The fixture exists, and fails, before the function does | Constitution section 5's opening clause and section 9's working agreements. On a money path the test is the specification, and writing it afterwards means specifying the thing that was built |
| TR-03 | **Never weaken a test to pass it.** A failing golden file is either a bug or a founder ruling, and the second one rewrites the fixture with the ruling cited in the row | Constitution section 9. [GS-055](GOLDEN_SCENARIOS.md) and [GS-179](GOLDEN_SCENARIOS.md) are the worked examples: both changed meaning because a decision changed, both say so in the row, and neither was deleted |
| TR-04 | **Every discovered gap becomes an [EDGE_CASES](../EDGE_CASES.md) entry plus a golden file, in that order.** No exceptions, including for gaps found in review rather than in a test run | Constitution section 9. The registry is 140 entries because this rule has been applied from the first session, and its value is entirely in never having made an exception |

**One consequence worth stating plainly, because it decides how much of this is affordable.** Merit has one operator. A test suite whose failures are not trusted is worse than a smaller suite whose failures are, because the first one trains its own reader to click through red. Every gate below is therefore either a **merge blocker** or an **advisory with a named owner**, and there is no third category. A check nobody would stop for is a check that gets deleted.

---

## 2. Tooling, decided

Constitution section 5 names `fast-check` and Playwright and leaves the rest open. These are the choices, with what was rejected, in the same format as an ADR because each one is a decision somebody will want the reasoning for.

| Concern | Choice | Rejected, and why |
|---|---|---|
| **Test runner** | **Vitest**, workspace mode across the monorepo packages | Jest (slower on a TypeScript codebase, and its ESM story is still the part of every upgrade that breaks); `node:test` (no watch ergonomics, and the fixture-driven suites here want `test.each` over a loaded YAML directory) |
| **Property testing** | **fast-check**, named by the constitution and adopted unchanged | Nothing. It is the only mature option in this ecosystem and the constitution already chose it |
| **E2E** | **Playwright**, named by the constitution. One project per surface (site, portal, admin), Chromium in CI, all three locally | Cypress (weaker multi-origin support, and [ADR-012](../DECISIONS.md) puts the admin console on a **separate apex domain**, so cross-origin is a requirement rather than an edge case) |
| **Integration database** | **A Neon branch per CI run**, torn down at job end | Testcontainers (a second runtime dependency in CI, and it tests a Postgres that is not the one production runs); a shared CI database (parallel jobs and money-path tests do not share state safely, and a leaked row between runs is the worst kind of flake because it is intermittent and looks like a real bug) |
| **Vendor failure injection** | **`undici` `MockAgent`** at the HTTP layer, plus each adapter's own fault-injection mode | `nock` (patches the wrong stack now that fetch is native); recording and replaying real vendor traffic (records secrets, and the traffic that matters is the traffic the vendor has never sent us) |
| **Rithmic** | **The synthetic simulator**, in both file and streaming modes ([M02](../plans/M02-rithmic-bridge.md), [ADR-020](../DECISIONS.md)) | Any mock at the parser boundary. GS-084 pins that the simulator writes into the ingest path and no downstream code branches on source, which is only true if the simulator is the fixture rather than a mock beside it |
| **Fixture format** | **YAML plus an expected end-state JSON sibling**, per [GOLDEN_SCENARIOS](GOLDEN_SCENARIOS.md) section 2 | JSON fixtures (unreadable by a human at 250 days of marks, and a fixture nobody reads is a fixture nobody checks against the prose); TypeScript fixture builders (executable, so TR-01 is unenforceable: a builder can call the code under test) |
| **Static analysis** | **`tsc --noEmit`**, **ESLint** with the custom `scopedDb` rule (VG-4), **semgrep** with the Merit ruleset, **gitleaks** (VG-1) | Any of these as a warning. All four are merge blockers or they are decoration |
| **Mutation testing** | **Stryker, nightly, on `packages/rules-engine` only**, reported as a trend rather than a threshold | Repo-wide mutation testing (runtime cost with no proportionate signal on UI code). The engine is the one package where a surviving mutant is genuinely alarming, and restricting it there is what makes the number worth reading |
| **Dependency admission** | **`--frozen-lockfile`**, `pnpm audit`, **syft** SBOM, **grype** scan, human approval on any new package (VG-12) | Automated dependency bumps merging without review. VG-12 is wired in the first CI setup and not deferred, because the build method is AI-assisted and hallucinated package names recur predictably |
| **Docs link-check** | **lychee**, over every markdown file and every anchor | A link-check that ignores anchors. The corpus's cross-references are almost entirely anchors into long documents, and the 59-link fix of 2026-08-14 was mostly anchors |
| **Load** | **k6**, two scripted profiles (nightly batch at 5,000 accounts, 500 payout requests in one minute) | Anything heavier. Constitution section 5.7 is explicit that v1 needs load **sanity** and not a performance programme, and building more would be scope nobody asked for |

**Coverage percentage is not a gate anywhere, and that is deliberate.** The gate is **named-test presence**: VG-5 diffs new tables and endpoints against [API_CONTRACT section 12](../architecture/API_CONTRACT.md)'s negative-authz matrix and fails on a gap. A line-coverage threshold on a codebase written with AI assistance measures how much code was executed, which is the one quality signal that generated tests inflate for free. Coverage is reported per package as a trend, and a sharp drop is a review question rather than a build failure.

---

## 3. Section 5 instantiated, requirement by requirement

### 3.1 Unit and property tests on the rules engine (section 5.1)

The engine is a pure function over a day stream ([M01](../plans/M01-rules-engine.md)), which is what makes property testing worth its cost here and nowhere else in the system.

**Named properties**, each a `fast-check` suite over generated day sequences, with the counterexample shrunk and written to `test-results/` on failure:

| ID | Property | Note |
|---|---|---|
| PT-01 | **Floor monotonicity per drawdown type.** `floor(d+1) >= floor(d)`, with no exceptions | Strengthened by [ADR-014](../DECISIONS.md): with no post-payout recompute, INV-06 lost its carve-out and the property lost its `unless` clause. GS-081 is the settlement case |
| PT-02 | **Win days never decrease except at a payout reset**, and at a reset they go to exactly zero | The exception is the whole property. A generator that never settles proves nothing about R-47 |
| PT-03 | **Ledger zero-sum**, per transaction and in aggregate | Per-transaction is a deferred constraint in the database ([ADR-016](../DECISIONS.md)), so this property tests the aggregate the constraint cannot see. Pairs with GS-231's per-identity assertion |
| PT-04 | **`withdrawable_cents >= 0` always**, at every point in every generated life | R-35's floor at zero. The generator is allowed to drive balance below `size + buffer`, which is the case a naive implementation returns a negative for |
| PT-05 | **`approved_cents <= cap_cents_for_ordinal` and `<= withdrawable_cents`**, and the result is `>= min_payout_cents` or the request is not eligible | [ADR-009](../DECISIONS.md)'s clamp order, asserted as an inequality rather than as a sequence of steps |
| PT-06 | **Replay determinism.** Any permutation of arrival order, any process timezone, any locale, yields byte-identical stored state | The executable form of GS-071 to GS-073. Runs with `TZ` and `LC_ALL` randomized per case, which is how a `toLocaleDateString` gets caught |
| PT-07 | **Idempotence of day application.** Applying the same closed day twice is a no-op on state | GS-047's assertion as a property, which is what makes the resumable batch safe |
| PT-08 | **The lifetime bound.** No sequence of settlements on one account exceeds `max_payouts * max(payout_cap_schedule)` | [M01](../plans/M01-rules-engine.md) INV-17. Since [ADR-025](../DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted) the schedule has one step, so the bound is `max_payouts * cap`, and GS-243 asserts the same number is produced regardless of loyalty state |

**The property the constitution names that is false, and it stays documented as false.** Section 5.1 asks for "eligibility is monotone in its inputs". It is not: [GS-069](GOLDEN_SCENARIOS.md) is the counterexample, in which adding profit on the best day breaks a passing consistency gate. The fixture is the proof and there is no `PT-` entry for the property, because writing a weakened version of it would be exactly the thing TR-03 forbids. This is recorded here rather than left as an absence, since an absent property looks like an oversight and a documented refutation looks like what it is.

**Unit tests** cover every rule `R-nn` in [M01 section 3.5](../plans/M01-rules-engine.md) at its comparison boundary, in pairs. `>=` gets a test at the value and one cent below; `<` gets a test at the value and one cent above. [GS-006](GOLDEN_SCENARIOS.md) and GS-007 are the published pair and the pattern for the rest.

### 3.2 Golden replay files (section 5.2)

Constitution section 5.2 requires at least 40. **[GOLDEN_SCENARIOS](GOLDEN_SCENARIOS.md) defines 255**, of which the M1-executable subset runs against the pure engine with zero I/O and the remainder are driven by their owning module's suite.

The loader is one function: it reads `packages/rules-engine/fixtures/GS-*.yaml`, resolves `plan` and `calendar` against the fixture plan and calendar directories, folds the day stream through the real engine, and diffs the result against the expected end-state JSON field by field before comparing state hashes. **There is no per-fixture test code**, which is what stops a fixture from quietly acquiring a bespoke assertion that weakens it.

**Three loader rules that are themselves tested:**

1. **A fixture with no `expect.pins` fails to load.** A golden file without a stated pin is a regression test wearing a golden file's name ([GOLDEN_SCENARIOS](GOLDEN_SCENARIOS.md) section 2).
2. **A fixture whose `id` is not in the registry fails to load**, and a registry row with no fixture fails the inventory check (CI-06). The two directions together are what keeps the count honest.
3. **A fixture marked as a superseded counterfactual asserts the superseded value fails**, so the price of a reversal stays executable. GS-055 carries the settlement-anchored figures this way and GS-179 carries the cap-release arithmetic.

### 3.3 Simulation harness (section 5.3)

Specified in full in [SIMULATION_HARNESS](SIMULATION_HARNESS.md). Its contract with this document is narrow and worth stating here so the CI inventory is complete: **it runs nightly, against the real engine, and it fails the nightly build when an aggregate funnel figure leaves its calibrated band.** It is not a merge blocker, because a ten-thousand-trader Monte Carlo run is not a pull-request-latency operation, and because its failures need a human to classify as a regression or a drift.

### 3.4 Integration tests (section 5.4)

Against a real Postgres branch, real pg-boss queues, and the vendor adapters in fault-injection mode. The four the constitution names, plus the two the corpus discovered:

| Area | What is asserted | Scenarios |
|---|---|---|
| PSP webhook idempotency | Duplicate delivery, out-of-order delivery, and a `refund` arriving before its `payment.success`, all resolving to one account in one correct final state | GS-038, GS-099 |
| Provisioning saga compensation | Every step's failure leaves no partial state, and **fail-closed provisioning holds an unconfirmed setpoint out of trading entirely** rather than surfacing it as carried liability | GS-138, batch 1 gate |
| Settlement rail retry | Transfers queue with idempotency keys intact across an outage, and no duplicate transfer survives a restore | GS-111, GS-048 |
| Recon mismatch quarantine | A whole file quarantines, zero rows commit, and yesterday's states are untouched | GS-033, GS-085, GS-086 |
| **Two-leg payout atomicity** | Approval, the LT-01 ledger posting, and the wallet credit commit together or not at all | GS-128, [ADR-019](../DECISIONS.md) |
| **Wallet concurrency** | A simultaneous withdrawal and checkout spend against one balance resolve to exactly one success and the position never goes negative | GS-230, [M20](../plans/M20-wallet.md) INV-M20-01 |

### 3.5 End-to-end (section 5.5)

One happy path and the ten most valuable unhappy ones, all in Playwright, all against seeded synthetic data.

**Happy path:** buy, provision, synthetic trading, pass, fund, request, wallet credit, external withdrawal, settle.

**The ten unhappy paths**, chosen by what costs most when it breaks rather than by what breaks most often:

| # | Path | Pins |
|---|---|---|
| 1 | Breach screen at 375px and 1280px | Ordering is the anti-dark-pattern control. GS-103 |
| 2 | Eligibility moves between dashboard render and confirm | The trader's screenshot and their payout can never disagree. GS-101 |
| 3 | Payout destination change enters the 48 hour cooling window | The one control that survives an attacker holding a valid session. GS-104 |
| 4 | Consistency gate fails and the dilution amount renders | AS-13 must not read as a moved goalpost. GS-100 |
| 5 | Reset onto a changed plan version | The rule diff is mandatory at the one place a trader can be surprised. GS-098 |
| 6 | Restricted-country visitor, with and without a VPN | The notice is disclosure; the control is server side in both cases. GS-145 |
| 7 | Certificate verification: valid, unknown, revoked | The verification page is the authority and the image never is. GS-102 |
| 8 | Wallet-funded purchase and its refund | The rails never cross. GS-224 |
| 9 | Live dashboard under feed loss | The label changes in the same render as the value. GS-133 |
| 10 | Ladder tracker at the final ordinal | Countdown framing, with the continuation clause in the same sentence as the limit. GS-206, [EC-122](../EDGE_CASES.md) |

### 3.6 Beta shadow-run (section 5.6): the mandatory gate to public launch

**For the entire beta period, a human hand-verifies every payout eligibility decision against the engine's output, and every mismatch is a P0.** This is the constitution's own words and it is the only gate in this document that cannot be automated, by design.

Three things make it a gate rather than a ritual:

1. **A shadow-run log**, one row per decision, carrying the engine's answer, the human's answer, and the disposition of any difference. It is an artifact the launch review reads, not a habit somebody reports on.
2. **A mismatch is a P0 regardless of direction.** An engine that was right and a human who was wrong is still a finding, because it means the eligibility surface is explaining itself badly to the person best placed to understand it.
3. **Six clean weeks is the bar**, and the clock restarts on a P0. The engine earns instant-approval trust by being boringly correct for long enough, and a gate that a fix can shorten is a gate that measures fixing rather than correctness.

### 3.7 Load sanity (section 5.7)

Two k6 profiles, run before launch and after any change to the batch or the payout path:

| Profile | Target | Source |
|---|---|---|
| Nightly batch, 5,000 accounts | Under 10 minutes | Constitution section 5.7 |
| Payout request under load | p95 under 500ms | Constitution section 5.7 |
| 500 simultaneous payout requests in one minute | All correct, p95 under 1s | B4 #22, GS-051 |
| Analytics load concurrent with a payout wave | Payout p95 holds and **analytics degrades first** | GS-178, [M13](../plans/M13-trader-analytics-journal.md) |

The last one is not in the constitution and is the most valuable of the four, because it is the only profile that tests an interaction rather than a component. Running the two suites separately would never have exercised it.

---

## 4. The CI gate inventory

One table, complete, in pipeline order. **This is the inventory the batch 2 gate ruling asked for**, and the rule for extending it is that a new gate arrives with its blocking level decided, because a gate added as advisory is a gate that stays advisory.

### 4.1 Pipeline stages

| ID | Stage | Runs on | Contents |
|---|---|---|---|
| CI-01 | **Lint and types** | every push | `tsc --noEmit`, ESLint including VG-4, prettier check |
| CI-02 | **Unit and property** | every push | Vitest across packages, the `PT-nn` suites, every module's `Mxx-*-nn` suites |
| CI-03 | **Golden files** | every push | The fixture loader over all 255 registry entries with a fixture |
| CI-04 | **Integration** | every push | Neon branch, pg-boss, adapters in fault-injection mode |
| CI-05 | **Security static** | every push | gitleaks (VG-1), semgrep, `pnpm audit`, SBOM and scan (VG-12) |
| CI-06 | **Corpus integrity** | every push | Docs link-check and the registry reconciliations, section 4.4 |
| CI-07 | **Build and bundle checks** | every push | VG-2, VG-10, VG-11, D0-10 against the production build |
| CI-08 | **E2E** | every push to `main`, and on demand | Playwright, three projects |
| CI-09 | **Nightly** | schedule | Simulation harness, replay self-audit, Stryker on the engine, detector canary check |
| CI-10 | **Ops calendar** | quarterly | VG-9 restore drill, key rotation, break-glass existence check |

### 4.2 The `VG` gates, with the test that implements each

From [VIBE_FAILURE_POSTMORTEMS](../../research/VIBE_FAILURE_POSTMORTEMS.md) and [INFRA section 6](../architecture/INFRA.md). The inventory there names the gate; this column names the thing that runs.

| Gate | Implementation | Stage | Blocks |
|---|---|---|---|
| VG-1 secret scan | gitleaks on the diff and the full history | CI-05 | merge |
| VG-2 no secrets in client output | grep of the built bundle for key-shaped strings | CI-07 | deploy |
| VG-3 server-side authz | review plus the VG-6 suite | CI-04 | merge |
| VG-4 `scopedDb` accessor | custom ESLint rule banning raw client imports in app paths | CI-01 | merge |
| VG-5 negative-authz test per resource | script diffing new tables and endpoints against [API_CONTRACT section 12](../architecture/API_CONTRACT.md)'s matrix | CI-06 | merge |
| VG-6 entitlement tested via direct API | integration suite calling endpoints with no UI in the path | CI-04 | merge |
| VG-7 agent holds no prod credentials | platform permissions; agent sessions get development credentials only | always | always |
| VG-8 no DDL or DELETE for the app role | database grants, plus a `PreToolUse` hook blocking dangerous shell | always | always |
| VG-9 PITR and tested restore | quarterly drill with a written result | CI-10 | ops calendar |
| VG-10 no world-readable bucket | infrastructure test against the live bucket policy | CI-07 | deploy |
| VG-11 metadata stripped on upload | unit test on the upload path | CI-02 | merge |
| VG-12 dependency admission | `--frozen-lockfile`, SCA, SBOM, human approval for any new package | CI-05 | merge |

**VG-12 is wired in the very first CI setup and not deferred.** [INFRA](../architecture/INFRA.md) says so and the reason is worth repeating in the document engineers will actually read during a rush: the build method is AI-assisted, hallucinated package names recur predictably, and the gate costs one approval step.

### 4.3 The `D0` attack scenarios become golden files

[SECURITY section 9](../architecture/SECURITY.md) records that the ten `D0` scenarios from [SECURITY_LANDSCAPE section 4](../../research/SECURITY_LANDSCAPE.md) "become numbered entries in `docs/testing/GOLDEN_SCENARIOS.md` during Wave 4". **They are now GS-246 to GS-255**, on the same mnemonic the B4 battery uses: `GS-(245 + n)` is `D0-n`, so the mapping never needs looking up.

Four of them extend an existing fixture rather than duplicating it, and the registry rows say which. That is the honest form of deduplication here: the D0 scenario is a distinct attack with a distinct expected behavior, and the fixture it pairs with covers a neighbouring case. Collapsing them would lose the attack; numbering them without the pairing would double-count the coverage.

### 4.4 Corpus integrity, which is new at this gate

The batch 2 gate ruled that the docs link-check joins the inventory. It arrives with four siblings, because the same script is already walking every document and the marginal cost of each is a few lines.

| ID | Check | Blocks | Why |
|---|---|---|---|
| CI-06a | **Link check** (lychee, including anchors) | merge | The corpus's cross-references are its navigation. 59 links broke silently before a human found them; the next 59 are caught by a robot |
| CI-06b | **Frontmatter present and valid** on every document: `status`, `depends_on`, `last_updated` | merge | A document without a status cannot be gated, and the whole wave model is statuses |
| CI-06c | **INDEX completeness**: every tracked document appears in [INDEX](../INDEX.md), and every INDEX row resolves | merge | "If a thing is not in INDEX.md, it does not exist" is a rule with no enforcement until this check exists |
| CI-06d | **Registry reconciliation**: the counts stated in [EDGE_CASES](../EDGE_CASES.md) and [GOLDEN_SCENARIOS](GOLDEN_SCENARIOS.md) equal the number of entries, and every `GS-nnn` cited anywhere in the corpus exists in the registry | merge | Both counts are quoted in gate summaries, and a quoted count that drifted is a gate decided on a wrong number |
| CI-06e | **Every `EC-nnn` names a golden scenario reference, and it resolves** | merge | TR-04's second half. An edge case with no fixture is a decision nobody can test |
| CI-06f | **ADR numbers are unique and gapless.** Every `## ADR-nnn` heading in [DECISIONS](../DECISIONS.md) is distinct; the allocated set runs 001 to the maximum with no holes; and **a pull request may not introduce a number already present on `main` or reserved in the allocation table** | merge | **Fails the second pull request to claim a number, rather than failing the corpus after both have merged.** The ADR number is the corpus's most-cited identifier, and two branches forking from the same `main` will both take "the next one" |
| CI-06g | **COUNT GATE: no document states a quantity a script can derive**, unless the number sits inside a generated span the script rewrites. CI regenerates every span and fails if the tree changes, and scans for bare numerals adjacent to a registry noun | merge | **Every hand-maintained count in this corpus has drifted. Five for five.** A count is not a fact a document owns; it is a query result somebody pasted |
| CI-06h | **Migration install and object counts.** The set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP`; re-applying it **must fail**; and the table and trigger counts the corpus states are checked against the **installed database**, not against a grep of the DDL | merge | An install that reports green because `psql` continued past a failed statement is worse than no install check. And index and check-constraint totals are **not derivable by grep**: Postgres backs every primary key and unique constraint with an index, so the DDL derives 219 where the database reports 326. A derivation that disagrees with its artifact by a third would pass CI while telling the reader something false, so those two are emitted by this job and stated nowhere |
| **CI-06i** | **DATA_MODEL and the migrations name the same table set, in BOTH directions.** Every `CREATE TABLE` in [`packages/db/migrations`](../../packages/db/migrations) has a `### <table>` section in [DATA_MODEL](../architecture/DATA_MODEL.md), and every `### <table>` section has a `CREATE TABLE` that creates it | merge | **At the fold the migrations created 96 tables and DATA_MODEL documented 46. Fifty tables had no design record at all and nothing failed, because nothing was counting.** The next module is built by reading DATA_MODEL rather than the DDL, so a table with no design record is a module built blind, and a section describing a table that does not exist is a module built against a fiction. **Only one of the two directions is the obvious one** |
| **CI-06j** | **Every column a PL/pgSQL trigger body names exists on the table it guards.** Every `NEW.<col>` and `OLD.<col>` reference in every trigger function resolves against the columns the migrations declare for every table a `CREATE TRIGGER` attaches that function to; and no trigger function reading `NEW.`/`OLD.` is left unattached | merge | **[ADR-035](../DECISIONS.md). `assert_published_plan_version_immutable()` read `NEW.config` and `plan_versions` has no `config` column.** PL/pgSQL resolves record fields **at execution**, so the migration installed cleanly, the 27-file apply passed, every probe passed, and the function was wrong only when it fired. It fired on the one transition the design permits, so **no plan version could be retired.** This is [LEDGER-C2](../DECISIONS.md)'s idea applied to columns: LEDGER-C2 asserts a ledger entry's account **class** was declared, this asserts a trigger's **column** was declared. It found the defect from the tree with no database |

**A note on why these are merge blockers in a repository with no code.** They are cheap, they are deterministic, and they protect the artifact the entire pre-FREEZE phase produces. The corpus is the deliverable until STATE says FROZEN, and a deliverable with no CI is a deliverable held together by one person's attention.

#### These gates are now a script, and it runs

**[`scripts/corpus/gates.mjs`](../../scripts/corpus/gates.mjs), no dependencies, `node scripts/corpus/gates.mjs check`.** All ten of the gates above, plus [ADR-026](../DECISIONS.md)'s manifest completeness gate, pass as of 2026-08-15. That is **eleven checks in one runner**. A gate with an install step is a gate that stops running on the day the install breaks, so the runner reads the tree and nothing else.

```
node scripts/corpus/gates.mjs check            every gate
node scripts/corpus/gates.mjs check CI-06j     one gate
node scripts/corpus/gates.mjs generate         rewrite every CI-06g span from its query
node scripts/corpus/gates.mjs list             the gates, and what each one covers
node scripts/corpus/gates.mjs anchors <f.md>   the anchors a file offers, for repairing a dead link
```

**Each gate declares what it does NOT cover, in a `covers` line the `list` command prints.** Four coverage gaps are real and stated rather than implied: CI-06a resolves relative links and anchors and does **not** fetch external `http(s)` targets, which need network and stay with the lychee job; CI-06f checks uniqueness and gaplessness within `DECISIONS.md` against the allocation table and cannot check the cross-branch half, which needs a job that can see both refs; CI-06g compares the spans that exist and does **not** yet sweep for bare numerals adjacent to a registry noun; **CI-06h checks the migration sequence and that the install job still exists, and does NOT install anything**, which needs a live PostgreSQL and runs in CI. **A gate that cannot check the whole of its row says so rather than returning green for a check it did not perform.**

#### The gates have been watched failing, and that is a command now

**[`scripts/corpus/falsify.mjs`](../../scripts/corpus/falsify.mjs), `node scripts/corpus/falsify.mjs`.** It runs every gate twice: against the tree, where each must **PASS**, and against a copy of the tree carrying **one seeded violation aimed at that gate**, where each must **FAIL on that finding** rather than merely exit non-zero. A gate that passes both times is not checking what its row says, and the harness reports that as an error.

**A gate nobody has watched fail is not a gate**, and this is the criterion the founder used to choose between two independently written runners at the PR #7 / PR #8 reconciliation. That judgment was made by reading a transcript. This makes it a command.

**It earned its place on its first run by finding three things**, all of which would otherwise have shipped:

| # | What it found | The shape of it |
|---|---|---|
| 1 | **CI-06j reported `0028`'s rebound guard as orphaned.** A superseding migration uses `CREATE OR REPLACE FUNCTION` and does not recreate the trigger, and the single-pass parser let the later definition wipe the earlier attachment | A gate wrong about the corpus, caught before it failed a build |
| 2 | **CI-06a and CI-06c "failed" on a tree the harness had copied incompletely.** Both exited non-zero on links into a directory that was never copied | **A gate failing for a reason nobody planted proves nothing.** Every seed now names a substring its finding must contain |
| 3 | **CI-06e's seed landed on the convention paragraph above `EC-001`**, which the gate correctly ignores, so the gate "could not be made to fail" | The seed was wrong and the gate was right. Same shape as the 109 phantom anchors |

**It is not wired into CI, and neither is [`probe_plan_version_immutability.sql`](../../scripts/db/probe_plan_version_immutability.sql).** The reconciliation ruling was to take PR #7's `corpus.yml` unchanged, and adding a step is a change. **Two artifacts therefore exist and do not run**: the falsification harness (three lines in the `integrity` job) and ADR-035's probe (one line beside the existing probe step in `migrations`, which today runs only `probe_ledger_constraints.sql`). Both are founder calls.

**The second one is worth naming plainly.** The `plan_versions` guard is verified by hand in one session and by nothing after it, which is precisely the condition that let the `NEW.config` defect live inside `0027` through a founder-grade review and a 27-file install check. **A probe that ships beside a fix and never runs again is the same object as the golden test that was missing.**

**Writing the runner falsified two of its own gates before it found anything real, which is the part worth carrying.** CI-06a first reported **109 broken anchors** because the slug function collapsed runs of whitespace where GitHub maps each space to one hyphen; the corpus was right and the gate was wrong. CI-06e first reported **119 edge cases with no golden scenario** because it read only the `## EC-nnn` block form and the Appendix B4 battery lives as 22 table rows under one heading. **A gate is not trustworthy because it fails; it is trustworthy once you have checked what it fails on.** Both were caught by reading the failures instead of accepting them, and the same discipline is what found [ADR-035](../DECISIONS.md).

**What the first honest run then found**, after those two fixes, was small and real: `docs/INDEX.md`'s `adr_count` span drifted the moment `ADR-035` was written (regenerated by the `generate` command, which is the half of CI-06g that did not exist before), and **27 genuinely broken anchors** across `DECISIONS`, `GLOSSARY`, `API_CONTRACT`, `OVERVIEW`, `INFRA`, `DATA_MODEL` and `M05`, now repaired.

**CI-06e's one accepted exception, and it is printed rather than silent.** `EC-057` states `Golden scenario ref: none owned; covered by the refund-window unit suite and M7's velocity detector`. That is a considered answer, not a forgotten field, so the runner accepts the sentinel `none owned` **and names every entry it accepted in the output**, because an accepted exception nobody can see is how a gate quietly stops gating. **The sentinel is a convention introduced with the runner and is open to a founder ruling**: the alternative is that `EC-057` gets a golden scenario of its own and the sentinel is deleted.

#### CI-06f, and why gaplessness is asserted over allocated **plus reserved**

**A branch cannot see the numbers its siblings have taken.** Two pull requests forking from the same `main` both read the registry, both find the same maximum, and both claim the next integer; neither is wrong locally and the corpus is broken globally the moment the second merges. That is not hypothetical, it is [ADR-034](../DECISIONS.md)'s own context.

So the check is **not** "the numbers in this file are gapless". It is **gapless over the allocated set union the reservation table**, and a number reserved by an open pull request counts as taken. **A branch that holds a reserved-but-unmerged number therefore shows a hole in `DECISIONS.md` and passes**, which is the correct behavior and the one a naive gapless check gets wrong.

**Heading order is deliberately not asserted.** On `main` today `ADR-005` sits between `ADR-008` and `ADR-009` in file order; the set is still unique and gapless, so this gate passes and should. Reordering a registry that every other document deep-links into buys readability and costs a link sweep, and **a gate nobody agreed to should not be the thing that forces that trade.** Recorded so a future reader does not infer from a green check that the file is sorted.

#### CI-06g, the COUNT GATE, and the two ways to satisfy it

**Either generate the number into the document, or delete it and point at the script.** There is no third option and in particular "check it carefully at the gate" is not one, because that is what was being done.

**The generated form** wraps the number in a comment-delimited span, which renders as the bare number everywhere Markdown is read:

```
The corpus carries <!--gen:adr_count-->25<!--/gen--> ADRs.
```

The generator rewrites every span from the artifact it derives from, and **CI fails if regenerating changes the tree.** The number in the document is then a cache of a query, marked as one.

**The pointed form** removes the number: *"the ADR registry is [DECISIONS.md](../DECISIONS.md)"* rather than *"25 ADRs"*. Prefer it wherever the count is decoration. **A count that no reader acts on is a liability with no upside.**

**The query has to be specified, not assumed.** Counting table rows in the `EC` and `GS` registries gives 22 and 301; counting **distinct identifiers** gives the correct 140 and 257. Both are "a script deriving it", and one is wrong. **A generated span is only as good as the named query behind it**, so every key carries its query in the generator rather than in a reader's head.

**Derivable keys at the first run:** `adr_count`, `ec_count`, `gs_count`, `index_entries`, `delta_count`, `migration_files`, and, once `packages/db` exists, the schema-object counts (`tables`, `indexes`, `check_constraints`, `triggers`) taken from a live apply rather than from a reading.

**The gate's first run is a sweep**, and it will find more than the five known instances. That is the point: the five were found by accident, one at a time, and each was found by somebody who happened to be looking.

### 4.5 The anti-slop gates

Appendix F2's code-level tells and the slop-reviewer pass, wired rather than remembered.

| Check | Implementation | Blocks |
|---|---|---|
| No `TODO` or `FIXME` reaches `main` | ESLint rule. A gap becomes an [EDGE_CASES](../EDGE_CASES.md) entry or gets fixed | merge |
| No `as any` or type-assertion workaround outside test fixtures | ESLint rule | merge |
| No banned constructs in the engine (dates, locales, floats, `Math.random`) | Custom ESLint rule over `packages/rules-engine` | merge |
| Conventional commit referencing a plan section or an edge-case ID | commitlint | merge |
| **Design slop-score pass** | Playwright checks in [DESIGN_SYSTEM](../design/DESIGN_SYSTEM.md) section 7 | merge on UI changes |
| **The slop-reviewer pass** on any sizable diff | Appendix C9's verbatim prompt, run in a fresh reviewer session | advisory, owner is the founder |

The last row is the only advisory in the inventory and it is honest about it: a judgment pass cannot be a build failure, and pretending otherwise would produce a gate that gets bypassed with a flag.

---

## 5. What runs when a money path changes

The strictest regime in the document, gathered in one place because it is the checklist somebody needs at 11pm.

A diff touching `packages/rules-engine`, the ledger, the payout path, or auth runs everything in section 4 **and**:

1. **The full golden suite, not the affected subset.** Fixture selection by heuristic is how a rule change silently stops being covered by the fixture that was watching a neighbouring rule.
2. **The replay self-audit over the seeded demo world**, asserting byte-identical reproduction of every stored state ([M01](../plans/M01-rules-engine.md) Appendix B).
3. **The engine-upgrade protocol** if any stored output changes: a diff report, a named human approval, and an unapproved divergence pages. GS-075.
4. **The simulation harness**, out of band, with its calibration bands checked before the change is considered done rather than the next morning.
5. **A fresh session for the review**, per [ADR-003](../DECISIONS.md). The reviewer that has been in the diff for six hours is not a reviewer.

**And the migration rule, which is the one with no test behind it.** Migrations are forward-only, reviewed on `main`, never edited after merge, and every migration touching a money table gets the founder's line-by-line read (constitution E2). No gate in this document substitutes for that read, and the [consolidated schema-delta session](../DELIVERY_PLAN.md) is scheduled as its own high-risk session precisely because it is the largest such read the project will ever ask for.

---

## 6. What this strategy deliberately does not do

Four omissions, each a decision rather than a gap.

- **No contract testing between services.** There are four deployables and one team, and the API contract is generated from the same zod schemas both sides import. A contract test here would test that TypeScript is TypeScript.
- **No visual regression suite.** [DESIGN_SYSTEM](../design/DESIGN_SYSTEM.md)'s slop-score pass checks for the specific tells that matter, and a full screenshot-diff suite on a site that is being actively designed produces a stream of expected failures, which is TR-04's warning applied to pixels.
- **No chaos engineering beyond the named failure injections.** GS-154 asserts that every vendor returning 500 and then timing out still completes purchase, provisioning, payout request, and settlement. That is the property; randomized fault injection on top of it would be a way to discover it more slowly.
- **No performance budget beyond section 5.7's two numbers.** The constitution is explicit that this is all the scale v1 needs, and building a performance programme for 5,000 accounts would be the [Appendix E](../../MERIT_BUILD_MASTER_PROMPT.md) failure of shipping infrastructure nobody asked for.

---

## 7. Open questions for the founder

**OQ-TS-01. Does the beta shadow-run's six clean weeks restart on any P0, or only on a P0 in the engine's favor?** Section 3.6 proposes **any P0**, including the case where the engine was right and the human misread the surface, because a misread surface is a real defect on the one screen the firm's entire promise rests on. The cost is a longer beta. Recommendation: restart on any.

**OQ-TS-02. Is Stryker's mutation score ever a gate, or only a trend?** Proposed **trend only**, reported nightly. A threshold on a young codebase produces tests written to kill mutants rather than to pin behavior, which is TR-01 inverted. Revisit once the engine is stable and the score has a baseline worth defending.

**OQ-TS-03. Do the corpus-integrity checks (CI-06) survive FREEZE, or retire when code begins?** Proposed **survive**. The corpus does not stop being the specification when the code starts; it becomes the thing the code is checked against, and a broken link in a plan doc is worse after FREEZE than before it.
