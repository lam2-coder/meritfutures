---
status: approved
depends_on: [../../MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, ../decisions/README.md, ../edge-cases/README.md, golden-scenarios/README.md, SIMULATION_HARNESS.md, ../architecture/INFRA.md, ../architecture/SECURITY.md, ../architecture/API_CONTRACT.md, ../architecture/data-model/README.md, ../plans/M01-rules-engine.md, ../decisions/ADR-039.md, ../plans/FOLD-01-phone-identity.md, ../../research/VIBE_FAILURE_POSTMORTEMS.md, ../../research/SECURITY_LANDSCAPE.md]
last_updated: 2026-08-17
---

# Testing Strategy

Constitution section 5 instantiated, with the tooling chosen and every CI gate inventoried in one place. Section 5 says it is binding, and this document is what makes it executable: the seven numbered requirements become named suites, the `VG-1` to `VG-12` gates from [VIBE_FAILURE_POSTMORTEMS](../../research/VIBE_FAILURE_POSTMORTEMS.md) become jobs with owners, the `D0-1` to `D0-10` attack scenarios from [SECURITY_LANDSCAPE](../../research/SECURITY_LANDSCAPE.md) become golden files, and the docs link-check joins the inventory per the batch 2 gate ruling.

**Identifier conventions:** `CI-nn` pipeline stages, `TR-nn` testing rules that bind regardless of suite, `PT-nn` property tests on the engine. `VG-nn`, `D0-nn`, `GS-nnn`, and the per-module suite prefixes (`M14-D-nn` and friends) are existing identifiers and are used unchanged.

---

## 1. The four rules that bind every suite

Everything below is mechanics. These four are the strategy.

| ID | Rule | Why it is a rule rather than a preference |
|---|---|---|
| TR-01 | **Tests come from the spec, never from the implementation.** Every golden file's expected value is computed by hand from the plan doc's prose, by somebody reading the prose rather than the code | Constitution C10's self-grading trap. A fixture written by reading the implementation proves only that the code agrees with itself, which is the property that lets an ambiguous rule ship. [M12](../plans/M12-transparency-platform.md) section 8 applies the same rule to published statistics and [GOLDEN_SCENARIOS](golden-scenarios/README.md) section 1 states it for fixtures |
| TR-02 | **Tests first on any money path.** Rules engine, ledger, payout, auth. The fixture exists, and fails, before the function does | Constitution section 5's opening clause and section 9's working agreements. On a money path the test is the specification, and writing it afterwards means specifying the thing that was built |
| TR-03 | **Never weaken a test to pass it.** A failing golden file is either a bug or a founder ruling, and the second one rewrites the fixture with the ruling cited in the row | Constitution section 9. [GS-055](golden-scenarios/05-gs-052-to-gs-070-adversarial-scenarios-m1-section-7.md) and [GS-179](golden-scenarios/01-numbering-map.md) are the worked examples: both changed meaning because a decision changed, both say so in the row, and neither was deleted |
| TR-04 | **Every discovered gap becomes an [EDGE_CASES](../edge-cases/README.md) entry plus a golden file, in that order.** No exceptions, including for gaps found in review rather than in a test run | Constitution section 9. The registry holds <!--gen:ec_count-->157<!--/gen--> entries because this rule has been applied from the first session, and its value is entirely in never having made an exception. **That figure was a bare `140` until the FOLD-01 registries session**, in the row that rules every discovered gap into the registry, which is the drift [ADR-034](../decisions/ADR-034.md) ends |

**One consequence worth stating plainly, because it decides how much of this is affordable.** Merit has one operator. A test suite whose failures are not trusted is worse than a smaller suite whose failures are, because the first one trains its own reader to click through red. Every gate below is therefore either a **merge blocker** or an **advisory with a named owner**, and there is no third category. A check nobody would stop for is a check that gets deleted.

---

## 2. Tooling, decided

Constitution section 5 names `fast-check` and Playwright and leaves the rest open. These are the choices, with what was rejected, in the same format as an ADR because each one is a decision somebody will want the reasoning for.

| Concern | Choice | Rejected, and why |
|---|---|---|
| **Test runner** | **Vitest**, workspace mode across the monorepo packages | Jest (slower on a TypeScript codebase, and its ESM story is still the part of every upgrade that breaks); `node:test` (no watch ergonomics, and the fixture-driven suites here want `test.each` over a loaded YAML directory) |
| **Property testing** | **fast-check**, named by the constitution and adopted unchanged | Nothing. It is the only mature option in this ecosystem and the constitution already chose it |
| **E2E** | **Playwright**, named by the constitution. One project per surface (site, portal, admin), Chromium in CI, all three locally | Cypress (weaker multi-origin support, and [ADR-012](../decisions/ADR-012.md) puts the admin console on a **separate apex domain**, so cross-origin is a requirement rather than an edge case) |
| **Integration database** | **A Neon branch per CI run**, torn down at job end | Testcontainers (a second runtime dependency in CI, and it tests a Postgres that is not the one production runs); a shared CI database (parallel jobs and money-path tests do not share state safely, and a leaked row between runs is the worst kind of flake because it is intermittent and looks like a real bug) |
| **Vendor failure injection** | **`undici` `MockAgent`** at the HTTP layer, plus each adapter's own fault-injection mode | `nock` (patches the wrong stack now that fetch is native); recording and replaying real vendor traffic (records secrets, and the traffic that matters is the traffic the vendor has never sent us) |
| **Rithmic** | **The synthetic simulator**, in both file and streaming modes ([M02](../plans/M02-rithmic-bridge.md), [ADR-020](../decisions/ADR-020.md)) | Any mock at the parser boundary. GS-084 pins that the simulator writes into the ingest path and no downstream code branches on source, which is only true if the simulator is the fixture rather than a mock beside it |
| **Fixture format** | **YAML plus an expected end-state JSON sibling**, per [GOLDEN_SCENARIOS](golden-scenarios/README.md) section 2 | JSON fixtures (unreadable by a human at 250 days of marks, and a fixture nobody reads is a fixture nobody checks against the prose); TypeScript fixture builders (executable, so TR-01 is unenforceable: a builder can call the code under test) |
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
| PT-01 | **Floor monotonicity per drawdown type.** `floor(d+1) >= floor(d)`, **except across the R-31 funded reset**, where the floor is asserted to equal `size_cents - funded drawdown_cents` exactly | [ADR-014](../decisions/ADR-014.md) removed the settlement carve-out and [ADR-050](../decisions/ADR-050.md) states the one exception that remains. `PT-01` and M01's `RE-P-01` are one property under two registries and may not disagree. GS-081 is the settlement case; GS-019 is the transition |
| PT-02 | **Win days never decrease except at a payout reset**, and at a reset they go to exactly zero | The exception is the whole property. A generator that never settles proves nothing about R-47 |
| PT-03 | **Ledger zero-sum**, per transaction and in aggregate | Per-transaction is a deferred constraint in the database ([ADR-016](../decisions/ADR-016.md)), so this property tests the aggregate the constraint cannot see. Pairs with GS-231's per-identity assertion |
| PT-04 | **`withdrawable_cents >= 0` always**, at every point in every generated life | R-35's floor at zero. The generator is allowed to drive balance below `size + buffer`, which is the case a naive implementation returns a negative for |
| PT-05 | **`approved_cents <= cap_cents_for_ordinal` and `<= withdrawable_cents`**, and the result is `>= min_payout_cents` or the request is not eligible | [ADR-009](../decisions/ADR-009.md)'s clamp order, asserted as an inequality rather than as a sequence of steps |
| PT-06 | **Replay determinism.** Any permutation of arrival order, any process timezone, any locale, yields byte-identical stored state | The executable form of GS-071 to GS-073. Runs with `TZ` and `LC_ALL` randomized per case, which is how a `toLocaleDateString` gets caught |
| PT-07 | **Idempotence of day application.** Applying the same closed day twice is a no-op on state | GS-047's assertion as a property, which is what makes the resumable batch safe |
| PT-08 | **The lifetime bound.** No sequence of settlements on one account exceeds `max_payouts * max(payout_cap_schedule)` | [M01](../plans/M01-rules-engine.md) INV-17. Since [ADR-025](../decisions/ADR-025.md) the schedule has one step, so the bound is `max_payouts * cap`, and GS-243 asserts the same number is produced regardless of loyalty state |

**The property the constitution names that is false, and it stays documented as false.** Section 5.1 asks for "eligibility is monotone in its inputs". It is not: [GS-069](golden-scenarios/05-gs-052-to-gs-070-adversarial-scenarios-m1-section-7.md) is the counterexample, in which adding profit on the best day breaks a passing consistency gate. The fixture is the proof and there is no `PT-` entry for the property, because writing a weakened version of it would be exactly the thing TR-03 forbids. This is recorded here rather than left as an absence, since an absent property looks like an oversight and a documented refutation looks like what it is.

**Unit tests** cover every rule `R-nn` in [M01 section 3.5](../plans/M01-rules-engine.md) at its comparison boundary, in pairs. `>=` gets a test at the value and one cent below; `<` gets a test at the value and one cent above. [GS-006](golden-scenarios/03-gs-001-to-gs-029-rule-and-boundary-scenarios-m1.md) and GS-007 are the published pair and the pattern for the rest.

### 3.2 Golden replay files (section 5.2)

Constitution section 5.2 requires at least 40. **[GOLDEN_SCENARIOS](golden-scenarios/README.md) defines <!--gen:gs_count-->284<!--/gen-->**, of which the M1-executable subset runs against the pure engine with zero I/O and the remainder are driven by their owning module's suite. **This line and CI-03's row below both read "255" until they were folded**, which is the count the registry stood at before the Wave 4 consolidation renumbered the verification-UX pair to GS-256 and GS-257; both are generated spans under [CI-06g](#44-corpus-integrity-which-is-new-at-this-gate) now. They are the fourteenth and fifteenth hand-maintained counts in this corpus found wrong, and they survived because CI-06g's stated gap is exactly this shape: it compares the spans that exist and does not sweep for bare numerals adjacent to a registry noun.

The loader is one function: it reads `packages/rules-engine/fixtures/GS-*.yaml`, resolves `plan` and `calendar` against the fixture plan and calendar directories, folds the day stream through the real engine, and diffs the result against the expected end-state JSON field by field before comparing state hashes. **There is no per-fixture test code**, which is what stops a fixture from quietly acquiring a bespoke assertion that weakens it.

**Three loader rules that are themselves tested:**

1. **A fixture with no `expect.pins` fails to load.** A golden file without a stated pin is a regression test wearing a golden file's name ([GOLDEN_SCENARIOS](golden-scenarios/README.md) section 2).
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
| **Two-leg payout atomicity** | Approval, the LT-01 ledger posting, and the wallet credit commit together or not at all | GS-128, [ADR-019](../decisions/ADR-019.md) |
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
| 10 | Ladder tracker at the final ordinal | Countdown framing, with the continuation clause in the same sentence as the limit. GS-206, [EC-122](../edge-cases/EC-122.md) |

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
| CI-03 | **Golden files** | every push | The fixture loader over the registry entries that have a fixture, of <!--gen:gs_count-->284<!--/gen--> defined. **[`packages/golden-loader`](../../packages/golden-loader/README.md), wired in [`.github/workflows/golden.yml`](../../.github/workflows/golden.yml).** The directory holds three scenarios and the rest arrive with P2: `packages/rules-engine` is a stub, so an expected end state written today would be derived from nothing. **The stage emits what it currently proves into its own output** ([ADR-038](../decisions/ADR-038.md)), because while the engine is a stub its polarity is inverted, **a corrupted expected end state still passes**, and the end-to-end assertion is skipped rather than run. The claims are measured on each run rather than written down |
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
| CI-06d | **Registry reconciliation**: the counts stated in [EDGE_CASES](../edge-cases/README.md) and [GOLDEN_SCENARIOS](golden-scenarios/README.md) equal the number of entries, and every `GS-nnn` cited anywhere in the corpus exists in the registry | merge | Both counts are quoted in gate summaries, and a quoted count that drifted is a gate decided on a wrong number |
| CI-06e | **Every `EC-nnn` names a golden scenario reference, and it resolves** | merge | TR-04's second half. An edge case with no fixture is a decision nobody can test |
| CI-06f | **ADR numbers are unique and gapless.** Every `## ADR-nnn` heading in [DECISIONS](../decisions/README.md) is distinct; the allocated set runs 001 to the maximum with no holes; and **a pull request may not introduce a number already present on `main` or reserved in the allocation table** | merge | **Fails the second pull request to claim a number, rather than failing the corpus after both have merged.** The ADR number is the corpus's most-cited identifier, and two branches forking from the same `main` will both take "the next one" |
| CI-06g | **COUNT GATE: no document states a quantity a script can derive, AND no document restates a value another document or the config owns** ([ADR-034](../decisions/ADR-034.md), extended to parameters by [ADR-037](../decisions/ADR-037.md)), unless the number sits inside a generated span the script rewrites. Either generate it into the document or delete it and point at the source. CI regenerates every span and fails if the tree changes, and scans for bare numerals adjacent to a registry noun | merge | **Every hand-maintained count in this corpus has drifted. Five for five.** A count is not a fact a document owns; it is a query result somebody pasted. **The parameter half was added when [GOLDEN_SCENARIOS section 3](golden-scenarios/README.md) was found restating thirteen [Appendix A.1](../plans/M01-rules-engine.md#a1-core-eod-core_eod) values in the sentence that named Appendix A as their only authority, with the ladder stale at 8 against 5.** A count misleads a reader; **a plan parameter is an input to a running system**, so the same shape costs more |
| CI-06h | **Migration numbers are allocated, and the set installs.** Filenames are unique and **gapless over allocated plus reserved**, checked against the migration allocation table in [DECISIONS](../decisions/README.md); **a number on disk that no row claims fails** ([ADR-036](../decisions/ADR-036.md)). The set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP`; re-applying it **must fail**; and the table and trigger counts the corpus states are checked against the **installed database**, not against a grep of the DDL | merge | **Deriving the sequence from the tree is blind by construction**: two branches forking from the same `main` both find `0028`, both write `0029`, and both pass locally. The collision surfaces at merge, and **a merged migration cannot be renumbered** (E2), so ADR-034's renumber-the-cheaper-branch remedy has no equivalent here. An install that reports green because `psql` continued past a failed statement is worse than no install check. And index and check-constraint totals are **not derivable by grep**: Postgres backs every primary key and unique constraint with an index, so the DDL derives 219 where the database reports 326. A derivation that disagrees with its artifact by a third would pass CI while telling the reader something false, so those two are emitted by this job and stated nowhere |
| **CI-06i** | **DATA_MODEL and the migrations name the same table set, in BOTH directions.** Every `CREATE TABLE` in [`packages/db/migrations`](../../packages/db/migrations) has a `### <table>` section in [DATA_MODEL](../architecture/data-model/README.md), and every `### <table>` section has a `CREATE TABLE` that creates it | merge | **At the fold the migrations created 96 tables and DATA_MODEL documented 46. Fifty tables had no design record at all and nothing failed, because nothing was counting.** The next module is built by reading DATA_MODEL rather than the DDL, so a table with no design record is a module built blind, and a section describing a table that does not exist is a module built against a fiction. **Only one of the two directions is the obvious one** |
| **CI-06j** | **Every column a PL/pgSQL trigger body names exists on the table it guards.** Every `NEW.<col>` and `OLD.<col>` reference in every trigger function resolves against the columns the migrations declare for every table a `CREATE TRIGGER` attaches that function to; and no trigger function reading `NEW.`/`OLD.` is left unattached | merge | **[ADR-035](../decisions/ADR-035.md). `assert_published_plan_version_immutable()` read `NEW.config` and `plan_versions` has no `config` column.** PL/pgSQL resolves record fields **at execution**, so the migration installed cleanly, the 27-file apply passed, every probe passed, and the function was wrong only when it fired. It fired on the one transition the design permits, so **no plan version could be retired.** This is [LEDGER-C2](../decisions/ADR-027.md)'s idea applied to columns: LEDGER-C2 asserts a ledger entry's account **class** was declared, this asserts a trigger's **column** was declared. It found the defect from the tree with no database |
| **CI-06k** | **Declared authority.** Every row of [API_CONTRACT §12](../architecture/API_CONTRACT.md)'s negative-authz matrix carries a **required-factor cell** drawn from that section's published vocabulary; every sensitive action [C-27](../architecture/SECURITY.md) names (payout destination change, contact change, external withdrawal) appears there and declares a **non-single** factor; and **no `notification_kinds` class outside the post-identity `security` and `money` classes is `rate_limit_exempt`**, read from the generated column's expression in the DDL | merge | **[ADR-039](../decisions/ADR-039.md) amendments 4 and 2, and the invariant says the enforcement is "a server-side required-factor declaration per endpoint, **not** discipline".** A declaration that lives only in a handler is one no reviewer can audit, so the matrix is where it is declared and this is what reads it. It catches the two errors a reading would otherwise have to catch: **a sensitive endpoint added later with no factor declared**, and **a pre-identity kind quietly inheriting an exemption written for authenticated recipients**, which is `AS-M16-07`'s funded attack. It needs no database, so it runs on every push |
| **CI-06l** | **Every expiry has a sweep.** Every `*_expires_at` column the migrations declare is dispositioned **exactly once** in [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md): either in the coverage table against a release job that is **itself a row of that document's scheduled table**, or on the written exemption list **with a reason**. **Stale entries in either list are findings**, in the [NO-FLOATS list](../../scripts/db/assert_no_floats.sql)'s idiom. No database | merge | **[ADR-040](../decisions/ADR-040.md) made the auto-release the load-bearing control of the whole enforcement window**, and the schema cannot express that a job exists. [`0031`](../../packages/db/migrations/0031_payout_hold_and_identity_restriction.sql) gives the hold a mandatory clock, a completeness CHECK and an index, and **every one of those artifacts reads as the control while none of them is it**. A hold with an expiry and no releaser is indistinguishable from inside the database from a hold that releases: the column is populated, the constraint passes, the index is used, and the trader is never paid. **It fails no test, because there is no test a schema can fail by omission**, and it fails no review, because the reviewer is reading the migration and the releaser is not in it. `CI-06i` found 50 tables with no design record because nothing was counting; this counts the clocks |
| **CI-06m** | **The calendar declares its own counts, its generated file is derived, and every `date` column names its unit.** Three checks, one subject. **(1)** Every calendar source in [`packages/db/src/seed/calendars`](../../packages/db/src/seed/calendars/README.md) is internally coherent: its transcription state, its exception lists and its declared counts agree with each other and with its own contents, **through `generate.mjs`'s own parser rather than a second copy of it**. `holidays: null` says nobody has read the publication and `holidays: []` asserts the exchange closes on no day of the year, so the two are asserted apart in **both** directions. **(2)** Every generated calendar is **derived and reproduces**, and an untranscribed source has **no generated file at all**, because a generated artifact nobody can reproduce is the hand-maintained calendar the derivation exists to abolish; every fixture declares a `session_count` that agrees with its own array, sits inside its own coverage, and carries no weekend session. **(3)** Every `date` column the migrations declare has a design-record row declaring `**Unit: <token>**` from the closed vocabulary **trading day / wall clock / rail clock**. No database | merge | **A wrong calendar row changes rule outcomes with no change to a line of engine code**, and it does so silently, because the engine is a pure function of the calendar it is handed and `types: []`, `merit/engine-purity` and `RI-01` each guarantee it cannot go and check. And the schema holds 49 `date` columns whose unit is **not derivable from their type** and only sometimes from their name: `published_statistics` carried `as_of_trading_day`, whose unit is in its name, beside `window_start_day`, whose design-record cell was **empty** and whose unit lived only in [M12](../plans/M12-statistic-definitions.md), **in one table**. The exposure is not historical: `0029` to `0031` made `interval '48 hours'` idiomatic on the money path, so the next session that needs "five trading days from now" has a working pattern sitting right there that is **wrong on roughly 104 days a year** |
| **CI-06n** | **Every registry entry has a README row, and every README row resolves.** For each registry directory [ADR-043](../decisions/ADR-043.md) created, every entry file is linked from that registry `README.md`, and every entry link in the README resolves to a file that exists | merge | **This gate is the price of ADR-043's INDEX exemption, and it is written down as a price rather than assumed.** `CI-06c` guarantees "if a thing is not in INDEX.md, it does not exist". ADR-043 exempts entry files from that, because four registries split per entry would take INDEX from 85 rows to about 400 and destroy the one artifact whose whole value is being readable. **An exemption with nothing in its place is weakening a gate to pass it.** So the guarantee becomes **transitive** instead of lost: `CI-06c` puts the registry README in INDEX, this puts every entry in the README. A registry whose entry pattern matches nothing reports that it is asserting nothing, rather than reporting the empty set as agreement |

**A note on why these are merge blockers in a repository with no code.** They are cheap, they are deterministic, and they protect the artifact the entire pre-FREEZE phase produces. The corpus is the deliverable until STATE says FROZEN, and a deliverable with no CI is a deliverable held together by one person's attention.

#### These gates are now a script, and it runs

**[`scripts/corpus/gates.mjs`](../../scripts/corpus/gates.mjs), no dependencies, `node scripts/corpus/gates.mjs check`.** Every gate above, plus [ADR-026](../decisions/ADR-026.md)'s manifest completeness gate: **<!--gen:gate_count-->15<!--/gen--> checks in one runner**. A gate with an install step is a gate that stops running on the day the install breaks, so the runner reads the tree and nothing else.

**That number is a generated span, and it is one because this sentence was found wrong.** It read "All ten of the gates above ... **eleven checks in one runner**" against eleven gate rows plus `ADR-026`, and had been wrong since `CI-06n` was added. **Sixteenth hand-maintained count found wrong in this corpus**, and it was sitting in the section that documents the gate against hand-maintained counts. The query is `GATES.length`, written beside `GATES`, which is the one place that cannot drift from the runner.

```
node scripts/corpus/gates.mjs check            every gate
node scripts/corpus/gates.mjs check CI-06j     one gate
node scripts/corpus/gates.mjs generate         rewrite every CI-06g span from its query
node scripts/corpus/gates.mjs list             the gates, and what each one covers
node scripts/corpus/gates.mjs anchors <f.md>   the anchors a file offers, for repairing a dead link
```

**Each gate declares what it does NOT cover, in a `covers` line the `list` command prints**, and `node scripts/corpus/gates.mjs list` is the authority on that set rather than the prose below, which names the gaps that have been argued about. CI-06a resolves relative links and anchors and does **not** fetch external `http(s)` targets, which need network and stay with the lychee job; CI-06f checks uniqueness and gaplessness within `DECISIONS.md` against the allocation table and cannot check the cross-branch half, which needs a job that can see both refs; CI-06g compares the spans that exist and does **not** yet sweep for bare numerals adjacent to a registry noun, **nor for a restated config parameter, which [ADR-037](../decisions/ADR-037.md) added to its rule and did not add to its runner**: the query has to tell a shorthand from a scenario's own arithmetic, since GS-026's "withdrawable 214,250, cap 150,000" is a computed boundary a fixture exists to pin and must survive any sweep, and a gate that fails on correct prose is a gate that gets switched off; **CI-06h checks the migration sequence against the allocation table and that the install job still exists, and does NOT install anything**, which needs a live PostgreSQL and runs in CI, **and inherits CI-06f's cross-branch gap verbatim** since it too reads one ref; and **CI-06k checks that the declaration exists and is not a single factor, and cannot check that a handler HONOURS it**, which needs the running server and is the negative-authz suite itself, **nor can it tell that an endpoint is sensitive unless C-27 names the action**, so a sensitive endpoint nobody classified is invisible to it and its first assertion is the only thing standing between that and silence; and **`CI-06l` checks that a release job is NAMED and cannot check that it RUNS**, which is what the dead-man switch is for and needs the estate, **nor does it read any clock whose column is not spelled `*_expires_at`**, so `identity_restriction_episodes.sla_due_at` is covered by the document and invisible to the gate. **A gate that cannot check the whole of its row says so rather than returning green for a check it did not perform.**

**`CI-06l`'s narrowness is a choice with a stated price, and the price is one real clock.** Widening the pattern to catch `sla_due_at` would also match every `starts_at`, `verified_at` and `created_at` in the schema, and **a gate that fails on correct DDL is a gate that gets switched off**, which is the same trade `CI-06g` records for the bare-numeral sweep. The clock is dispositioned in CRON_INVENTORY anyway, so the corpus is right and the gate is short of it, and that is written into both the `covers` line and the document rather than left for the reader who wonders why it is not listed. **It also does not judge whether an exemption reason is good**, only that one was written, because "is this reason sound" is the founder's read and not a parser's.

**Neither allocation gate parses the State column, and that is a fifth gap worth naming because the table looks fully enforced.** A reservation becomes an allocation at merge, and a runner reading one ref cannot tell the two apart: the branch holding a reservation and the `main` that has absorbed it both show the number claimed. The Numbers column is load-bearing and checked; the State column is prose for a reader and drifts like all prose. It has already drifted once, on `ADR-035`'s row, four commits after the merge that falsified it.

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

**Writing the runner falsified two of its own gates before it found anything real, which is the part worth carrying.** CI-06a first reported **109 broken anchors** because the slug function collapsed runs of whitespace where GitHub maps each space to one hyphen; the corpus was right and the gate was wrong. CI-06e first reported **119 edge cases with no golden scenario** because it read only the `## EC-nnn` block form and the Appendix B4 battery lives as 22 table rows under one heading. **A gate is not trustworthy because it fails; it is trustworthy once you have checked what it fails on.** Both were caught by reading the failures instead of accepting them, and the same discipline is what found [ADR-035](../decisions/ADR-035.md).

**What the first honest run then found**, after those two fixes, was small and real: `docs/INDEX.md`'s `adr_count` span drifted the moment `ADR-035` was written (regenerated by the `generate` command, which is the half of CI-06g that did not exist before), and **27 genuinely broken anchors** across `DECISIONS`, `GLOSSARY`, `API_CONTRACT`, `OVERVIEW`, `INFRA`, `DATA_MODEL` and `M05`, now repaired.

**CI-06e's one accepted exception, and it is printed rather than silent.** `EC-057` states `Golden scenario ref: none owned; covered by the refund-window unit suite and M7's velocity detector`. That is a considered answer, not a forgotten field, so the runner accepts the sentinel `none owned` **and names every entry it accepted in the output**, because an accepted exception nobody can see is how a gate quietly stops gating. **The sentinel is a convention introduced with the runner and is open to a founder ruling**: the alternative is that `EC-057` gets a golden scenario of its own and the sentinel is deleted.

#### CI-06k has three assertions, and a seed covers one of them

**`SEEDS` holds exactly one violation per gate**, which is right for a gate that asserts one thing and wrong for a gate that asserts three. `CI-06k` would otherwise be watched failing on its required-factor check and taken on trust for the other two, and "taken on trust" is the condition this harness exists to end. So the seeded violation covers the **missing declaration**, and two scope cases carry the rest: `CI-06k/exempt-class` adds a class outside `security` and `money` to the generated exemption and must be a finding, and `CI-06k/single-factor-read` asserts the **partition** rather than a rule.

**That last one is a pair, and the pair is the content.** `session` on a read surface is correct and `session` on a C-27 sensitive action is the SIM-swap hole the invariant exists to close, so the case seeds the first and its **control** seeds the second: if the control goes quiet the gate is not reading the matrix at all and the `PASS` beside it means nothing. **The control preserves the `C-27:` tag and downgrades only the factor**, because replacing the whole cell would untag the row, the missing-action assertion would fire instead, and the case would fail off-target while looking like it worked.

**Every one of these seeds derives its target at seed time.** The rider that produced that rule came from two seeds pinned to the literal `0029`; the registry here is different and the failure is identical, since the matrix rows, the C-27 action names and the notification class list are all things the corpus edits. A seed naming one by literal goes stale silently, because a row that no longer matches plants nothing.

#### CI-06m has four cases, and the third direction was found by execution

**One seeded violation and three scope cases**, on `CI-06l`'s precedent one gate over. The seed strips a `**Unit: <token>**` marker and leaves the prose, which is how the defect actually happens: nobody deletes a Why cell, they reword it.

**The third direction is the one the gate did not have.** `CI-06m/vacuous-derivation` empties a fixture to `"sessions": []` with `"session_count": 0`, and **before it existed the gate reported PASS on that tree**. Every check after the declared count is a loop, and every loop over an empty array succeeds: the count agreed (0 equals 0), nothing fell outside coverage, and nothing landed on a Saturday. **A derivation that reproduces nothing read exactly like one that reproduces correctly**, which is the single distinction this gate exists to make. It is the fourth costume of one defect: `array_length` on an empty array returning `NULL` and the `CHECK` passing ([ADR-035](../decisions/ADR-035.md), seven constraints), `{}` accepted as a prior row image, an allowlist decaying by keeping a stale entry (`CI-06l`), and this.

`CI-06m/phantom-generator` is **`CI-06l/unknown-job`'s assertion one registry over**: `generated_by` is the one field separating a derived calendar from a typed one, so a citation resolving to nothing lets a hand-maintained file keep a provenance line on top of it.

`CI-06m/small-is-not-empty` is the control, **and it carries its own control**, because a `PASS` case with nothing on the other side of the line is decoration. It cuts the fixture to a single session and requires no finding; its control cuts to zero and requires one. Together they say the boundary is at **empty** and not at **small**, which is the only reading that leaves the deliberately five-session `cme-2026.json` legal. Without it the gate could be "hardened" into demanding a full year, every seeded case would still fire, and the fixture that actually exists would have become illegal.

#### CI-06l has four assertions, and two of them are the ones an allowlist decays through

**The headline assertion is the cheap one.** A column on neither list is the finding the gate is named for, and it is the finding a careful author would not produce anyway. **The two that earn the gate are the stale-entry checks**, which run in the direction nobody looks: an entry naming a column no migration declares means the list still looks complete while the real column, under its new spelling, is covered by nothing. **Assertion 1 alone reports that tree as clean.** This is the [NO-FLOATS list](../../scripts/db/assert_no_floats.sql)'s own stated second direction, adopted rather than reinvented, and it is why the exemption list is a list in a document the gate reads rather than a convention in a reviewer's head. The fourth assertion is that a named release job **exists as a row of the scheduled table**, because a coverage row pointing at a job nobody scheduled is the original failure wearing the fix's clothing.

**One seeded violation and three scope cases**, on `CI-06k`'s precedent one gate over. The seed covers the uncovered column; `CI-06l/exempt` proves the exemption list is **read** and pairs with a control that writes the same exemption **with no reason**; `CI-06l/stale-entry` covers the quiet direction; `CI-06l/unknown-job` covers the phantom job.

**The seed tags a coverage row's column cell rather than deleting the row, and the reason is a harness bug worth recording.** `expect` is resolved against the **seeded** tree, after the seed has run, so a seed that deletes the first row makes the harness ask about the *next* column while the gate correctly names the one that was deleted. It was watched reporting `FAILED OFF-TARGET` in exactly that state, which is the harness working: the gate was right and the seed's description of its own target was wrong. **Two readers now exist on purpose** — the gate's column reference is anchored and strict, the harness's is loose and finds the same row before and after the edit — and that seeds a real property anyway, since a cell carrying prose beside an identifier is **not** a disposition, and the alternative reading is how this gate would come to pass on a table of commentary.

#### Writing CI-06l found a parser defect in CI-06j, and it fails in the safe direction

**`columnCatalogue()` read one column out of a multi-column `ALTER TABLE`.** The expression required `ADD COLUMN` to follow the table name immediately, so `0031`'s five hold columns contributed `held_at` and nothing else, and **four were invisible to the runner, including `hold_expires_at`**, which is the clock ADR-040's entire enforcement window rests on. `CI-06l` reported the coverage row for it as a **stale entry naming a column no migration declares**, which is the gate being right about the tree and wrong about the reason, and reading the failure rather than accepting it is what found the parser.

**It survived because it fails in the safe direction.** A column missing from the catalogue makes `CI-06j` report a live trigger reference as a phantom, which is a false finding somebody investigates rather than a false pass nobody sees. No trigger has yet named one of the four, so nothing fired; **it would have fired on the first guard written over the hold**, which is a money-path session. Widening a catalogue can only ever remove `CI-06j` findings, never add one, so the fix is one-directional. **The fifth gate found with a parser narrower than the property it claims**, after `CI-06a`'s 109 phantom anchors, `CI-06e`'s 119 phantom refless entries, `CI-06k`'s whole-matrix false report and `CI-06b`'s blindness to a duplicate frontmatter key. **No ordinal is claimed beyond that count and it is deliberately not folded into [ADR-034](../decisions/ADR-034.md)'s running tally**, which counts hand-maintained numbers found wrong and is a different class; one session log has already been written that ran the two together. **The pattern is well enough evidenced to state as a rule: a new gate's first run is as likely to falsify the runner as the corpus, and the only way to tell is to read what it failed on.**

#### CI-06f, and why gaplessness is asserted over allocated **plus reserved**

**A branch cannot see the numbers its siblings have taken.** Two pull requests forking from the same `main` both read the registry, both find the same maximum, and both claim the next integer; neither is wrong locally and the corpus is broken globally the moment the second merges. That is not hypothetical, it is [ADR-034](../decisions/ADR-034.md)'s own context.

So the check is **not** "the numbers in this file are gapless". It is **gapless over the allocated set union the reservation table**, and a number reserved by an open pull request counts as taken. **A branch that holds a reserved-but-unmerged number therefore shows a hole in `DECISIONS.md` and passes**, which is the correct behavior and the one a naive gapless check gets wrong.

**Heading order is deliberately not asserted.** On `main` today `ADR-005` sits between `ADR-008` and `ADR-009` in file order; the set is still unique and gapless, so this gate passes and should. Reordering a registry that every other document deep-links into buys readability and costs a link sweep, and **a gate nobody agreed to should not be the thing that forces that trade.** Recorded so a future reader does not infer from a green check that the file is sorted.

#### CI-06h and the second allocation table, and why it is not a sibling gate

**[ADR-036](../decisions/ADR-036.md).** The migration sequence is the other numbered registry in this repository and it had no table. `CI-06h` asserted uniqueness and gaplessness **from the tree**, which is precisely the check a branch can satisfy while colliding with its sibling, and the registry that can least afford a collision is the one where the fix ADR-034 used is unavailable: **a merged migration cannot be renumbered, only superseded.**

**The question it was commissioned as was "extend `CI-06f` or add its sibling", and the answer is neither.** `CI-06h` **already computes the migration number set**. A sibling gate holding the reservation semantics does not partition the work, because a reserved number has no file on disk and `CI-06h`'s existing gap check would fail on the exact hole the sibling exists to permit. `CI-06h` has to become allocation-aware either way, and once it is, the sibling is a second expression of one concept **in the runner [OQ-P1-04](../plans/P1-monorepo-scaffold.md) was ruled about, one session after that ruling.** The two would have agreed for exactly as long as nothing was ever reserved, which is the same sentence that describes the original defect.

**One parser reads both tables** for the same reason, and it is stricter than the one it replaced: `CI-06f`'s inline scan read every three-digit numeral in the section's **prose**, so a number mentioned in a sentence was silently reserved. The shared parser reads the first cell of table rows. **That direction matters more than it looks**: a number reserved by accident is a hole the gate stops reporting.

**Two scope cases, one per direction**, because the change makes the gate quieter on one input and louder on another, and a change that only ever makes a gate quieter is indistinguishable from switching it off. `CI-06h/reserved` asserts a reserved hole is **not** a finding; `CI-06h/unallocated` asserts a number on disk that no row claims **is** one. Both were watched failing before they were trusted: against a gate that ignores reservations, `CI-06h/reserved` reports `READ A FILE IT MUST NOT`; against a gate with the allocation check removed, `CI-06h/unallocated` reports `DID NOT FAIL`. The seeded violation was retargeted too, and **watched failing off-target**: with the hole loop disabled the gate still exits non-zero on a different finding, and `falsify.mjs` reports `FAILED OFF-TARGET` rather than scoring it a pass.

#### CI-06g, the COUNT GATE, and the two ways to satisfy it

**Either generate the number into the document, or delete it and point at the script.** There is no third option and in particular "check it carefully at the gate" is not one, because that is what was being done.

**The generated form** wraps the number in a comment-delimited span, which renders as the bare number everywhere Markdown is read:

```
The corpus carries <!--gen:adr_count-->25<!--/gen--> ADRs.
```

The generator rewrites every span from the artifact it derives from, and **CI fails if regenerating changes the tree.** The number in the document is then a cache of a query, marked as one.

**The pointed form** removes the number: *"the ADR registry is [DECISIONS.md](../decisions/README.md)"* rather than *"25 ADRs"*. Prefer it wherever the count is decoration. **A count that no reader acts on is a liability with no upside.**

**The query has to be specified, not assumed.** Counting table rows in the `EC` and `GS` registries gives 22 and 301; counting **distinct identifiers** gives the correct 140 and 257. Both are "a script deriving it", and one is wrong. **A generated span is only as good as the named query behind it**, so every key carries its query in the generator rather than in a reader's head.

**Derivable keys at the first run:** `adr_count`, `ec_count`, `gs_count`, `index_entries`, `delta_count`, `migration_files`, and, once `packages/db` exists, the schema-object counts (`tables`, `indexes`, `check_constraints`, `triggers`) taken from a live apply rather than from a reading.

**The gate's first run is a sweep**, and it will find more than the five known instances. That is the point: the five were found by accident, one at a time, and each was found by somebody who happened to be looking.

### 4.5 The anti-slop gates

Appendix F2's code-level tells and the slop-reviewer pass, wired rather than remembered.

| Check | Implementation | Blocks |
|---|---|---|
| No `TODO` or `FIXME` reaches `main` | ESLint rule. A gap becomes an [EDGE_CASES](../edge-cases/README.md) entry or gets fixed | merge |
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
5. **A fresh session for the review**, per [ADR-003](../decisions/ADR-003.md). The reviewer that has been in the diff for six hours is not a reviewer.

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
