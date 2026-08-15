# @merit/golden-loader

**CI-03.** The golden fixture loader, and the only implementation of that stage.

```
pnpm exec vitest run --project golden           CI-03
pnpm exec vitest run --project unit packages/golden-loader   the loader's own rules
```

The format it reads is documented where the fixtures live: [`packages/rules-engine/fixtures/README.md`](../rules-engine/fixtures/README.md).

---

## The one structural obligation

[P1 section 2.2](../../docs/plans/P1-monorepo-scaffold.md): **"the loader reads a directory and imports the engine's public entry point only"**, and [STRATEGY section 2](../../docs/testing/STRATEGY.md) rejected TypeScript fixture builders for exactly this reason: a builder can call the code under test, and a fixture derived from the implementation proves only that the code agrees with itself.

**It is a package rather than a file inside `packages/rules-engine/test`, and that is what makes the obligation structural rather than a promise.** Two things follow from the separation and neither is available from inside the engine's own package:

| | |
|---|---|
| **`@merit/rules-engine` resolves through its `exports` map**, which publishes `.` and nothing else | `../src/floor.js` is not reachable from here at all. The module resolver enforces the boundary, not a reviewer |
| **The engine's `tsconfig` sets `types: []`** so `node:fs` does not exist there | A loader living inside that package could only read a directory by weakening the strongest of the three mechanisms guarding the purity boundary |

The arrow also points the right way: `RI-01` asserts `packages/rules-engine` declares no workspace dependency, so the loader can never become something the engine imports.

## No per-fixture test code

[STRATEGY section 3.2](../../docs/testing/STRATEGY.md): that is what stops a fixture from quietly acquiring a bespoke assertion that weakens it. `test/fixtures.golden.test.ts` is written once and applied to whatever the directory holds.

## The polarity of the golden assertions is derived, not declared

**TR-02 puts the fixture before the function on a money path: "the fixture exists, and FAILS, before the function does."** `packages/rules-engine` ships the scaffold's identity evaluation, so every fixture is in that window. **STRATEGY section 1** is equally clear that a permanently red required stage is worse than a smaller suite whose failures are trusted, because the first one trains its own reader to click through red.

**So the stage asserts the failure instead of suffering it, and reads the direction off the engine.** `engineIsIdentityStub()` probes `evaluate` with one day that closes above its open, which any implemented engine must react to. While that probe holds, **a fixture that MATCHES is the finding**, since a fixture satisfied by an engine that computes nothing is a fixture pinning nothing.

**A per-fixture `pending: true` was the alternative and it is the weakening TR-03 forbids**: the escape hatch a future session reaches for at 11pm when one scenario will not go green. There is no flag to remove and no fixture to edit; when M01 lands the probe stops holding and the same fixtures become live assertions.

**What the probe does not cover, stated rather than implied.** An engine that returns its input state by reference *and* emits no event for a day that moves the floor would be read as the stub. That engine fails `GS-009` and `GS-011` the moment the polarity flips, so the failure mode is loud rather than silent.

## The stage says what it currently proves, and the claims are measured

[ADR-038](../../docs/decisions/ADR-038.md). While the polarity is inverted, `CI-03 golden files: pass` means three things its name contradicts:

| | |
|---|---|
| The assertion is `diffs.length > 0` | A fixture that MATCHES is the finding |
| **A corrupted expected end state still passes** | Any expectation at all produces diffs against an engine that computes nothing, so the stage is blind to whether the expected end states are the ones the corpus states |
| The end-to-end assertion is not running | It is behind `describe.runIf(!stubbed)` and shows up as a skip count |

All three were correct, and all three were stated **only in a pull request body**, which is authored once and read during one review. So [`src/coverage.ts`](src/coverage.ts) emits them into the job log and `$GITHUB_STEP_SUMMARY` on every run, and it **measures** rather than repeats: the corrupted-expectation claim is proved by corrupting every loaded fixture and re-running the stage's own assertion over it, and the fixture-to-registry fraction is derived from the tree and the registry. **When M01 lands the block changes on its own**, exactly as the polarity does.

`--reporter=verbose` is part of the stage's command for this reason and not for taste: Vitest's default reporter swallows test stdout on a passing run.

**The proof that a wrong expectation FAILS is not in this stage**, and the block says so and names where it is: [`test/compare.test.ts`](test/compare.test.ts), made against hand-built states rather than against whatever the engine does today. The stage asserts that file exists, so the citation cannot rot.

## The YAML subset parser, and the dependency it is standing in for

`src/yaml.ts` reads a small, strictly specified subset and **throws on everything else**, with a line number. The subset and its refusals are listed in the file's own header.

**The rule it is written against is refuse, never mis-read**, and two ways it was failing that rule were found and closed. Both were silent passes rather than crashes, which is the only kind that matters here:

1. **Sequence items dropped their tail.** `parseNode` returns how much it consumed and both sequence-item call sites discarded it, so a nested sequence followed by anything else parsed with the remainder **read from disk and thrown away**. A fixture input the engine never sees is the worst outcome a golden file has: the scenario passes while pinning something the author did not write. `readWholeItem` now refuses to read part of an item.
2. **Plain scalars a real YAML library types differently.** `True`, `yes`, `NULL`, `0x1F`, `007`, `+5`, `1_000`, `.inf` and `1:30` were all strings here and are booleans, null, integers, floats or a sexagesimal elsewhere. **This is the date hazard below, generalized**, and the bare `YYYY-MM-DD` trading day is now the single named admission in that class. Quoting is the escape hatch and it means the text under every schema.

**Why not the `yaml` package.** VG-12 makes every new dependency a human admission decision ([STRATEGY section 4.2](../../docs/testing/STRATEGY.md), [`.npmrc`](../../.npmrc)) and a session cannot grant itself that approval. **Swapping this file for `yaml` is a founder call and a small diff.** Two things to weigh before making it:

1. **A fixture the loader MISREADS is worse than a fixture the loader rejects.** It is a golden file pinning something nobody wrote. A refusing parser has no such failure mode.
2. **An unquoted `2026-11-03` is a string here and a `Date` under a real YAML library**, because YAML's core schema resolves timestamps. [GOLDEN_SCENARIOS section 2](../../docs/testing/GOLDEN_SCENARIOS.md) prints trading days unquoted and the fixtures are written the way the corpus prints them. **Anyone swapping in `yaml` must quote every date in every fixture in the same commit**, or the loader starts handing the engine a clock reading, in the one package whose entire contract is that it has none.

Against that: a hand-written parser is a hand-written parser. It is ~250 lines, it refuses rather than guesses, and `test/yaml.test.ts` asserts fifteen out-of-subset constructs throw.

## Two second expressions of one concept, named rather than smoothed over

[OQ-P1-04](../../docs/plans/P1-monorepo-scaffold.md)'s ruling is that two expressions of one concept agreeing today is how a defect is born, so both of these are recorded:

- **`registryIds()` re-implements `gs_count`'s query** from [`scripts/corpus/gates.mjs`](../../scripts/corpus/gates.mjs): distinct `GS-\d{3}` in `GOLDEN_SCENARIOS.md`. Unifying them means the corpus runner exporting a membership helper, which is a change to `scripts/corpus` this session is scoped out of. **If the two ever disagree, this one is wrong.**
- **`L-06` and the golden stage both assert every fixture states a pin**, from opposite sides. That one is deliberate: the load-time refusal is the gate, and the stage-level assertion is what would show a loosened rule in a test run rather than in a diff review.

## What is not here

**State hashes.** [STRATEGY section 3.2](../../docs/testing/STRATEGY.md) has the loader diff field by field "before comparing state hashes". A hash of the **engine's** output can only be obtained by running the engine, which is the direction TR-01 forbids. A hash of the **fixture's** stated end state needs the full state shape, which is M01's. The field-by-field diff is what runs and the hash is an open item, not a line of dead code.

**The inventory check**, a registry row with no fixture. That direction is CI-06's and it would today fail on every scenario the registry defines. It arrives with P2.
