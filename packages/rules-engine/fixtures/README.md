# The golden fixture format

**The format is ruled, not designed here.** [STRATEGY section 2](../../../docs/testing/STRATEGY.md) chooses "YAML plus an expected end-state JSON sibling" and [GOLDEN_SCENARIOS section 2](../../../docs/testing/golden-scenarios/README.md) prints a worked example of it. This file records what the loader does with that ruling, the two places the corpus is ambiguous and how each was read, and the four fields that currently reach no engine input.

The loader is [`packages/golden-loader`](../../golden-loader/README.md). It reads this directory and imports the engine's public entry point only.

---

## The layout

```
fixtures/
  GS-NNN-<slug>.yaml            the inputs: plan, calendar, account, day stream
  GS-NNN-<slug>.expected.json   the expectation: end_state, events, pins
  plans/<name>.json             a plan_version + plan_version_sizes row
  calendars/<name>.json         the sessions the day stream may name
```

**The YAML holds only inputs and the JSON sibling holds only the expectation.** A YAML carrying an `expect:` key is refused (`L-05`).

## The two ambiguities in the corpus, and how each was read

**The sibling versus the inline `expect:` block.** [STRATEGY section 2](../../../docs/testing/STRATEGY.md) and [GOLDEN_SCENARIOS section 2](../../../docs/testing/golden-scenarios/README.md) both rule the format as "YAML plus an expected end-state **JSON sibling**", and section 2's printed example then shows `expect:` inside the YAML. **The reading that keeps both sentences true is that the sibling IS the `expect` block, serialized as JSON.** The physical layout is the sibling; `expect` is the logical name for what it holds. The one shape neither reading permits is a fixture carrying two of them, which is why `L-05` refuses it rather than choosing.

**`traded_day`.** The engine's `DayMark` declares it and the printed example does not supply it. [R-08](../../../docs/plans/M01-rules-engine.md) derives it from `fill_count > 0`, so **a loader computing it would be a loader that has implemented a rule the fixtures exist to check.** The fixture states it, like every other measurement, and `L-10` refuses a day row without it.

## The four fields that reach no engine input yet

`account.phase`, `account.opened_on`, `days[].adjustment_cents`, `settlements`.

The corpus's format states all four and the scaffold's engine types declare none of them, which [`packages/rules-engine/src/types.ts`](../src/types.ts) says in its own words: "THE FIELD SETS BELOW ARE THE SCAFFOLD'S, NOT M01's".

**The choice was between dropping them silently and naming them.** A dropped input on a money path is the worst outcome available: the fixture states a condition, the engine never sees it, and the scenario passes while pinning something else. So the loader **refuses any fixture field it can neither map nor find on that list**, the list is one visible place in [`loader.ts`](../../golden-loader/src/loader.ts), and `L-14` asserts every entry is still used by some fixture so it cannot rot into a permanent excuse. `adjustment_cents` may only be `0` and `settlements` may only be `[]`, because carried-and-ignored is not an option on a money field.

**M01 empties the list.** Each entry disappears by the engine's input types growing a home for it, and the compile-time totality assertions in the loader make that widening impossible to do without updating the map.

## Every value here is transcribed from a plan document

**TR-01.** [`plans/CORE-50K.json`](plans/CORE-50K.json) is [M01 Appendix A.1](../../../docs/plans/M01-rules-engine.md)'s 50K column and nothing else; every fixture's header comment names the rule and the registry row each number comes from. A fixture written by reading the implementation proves only that the code agrees with itself.

**One discrepancy was found in the transcription and is not resolved here.** [GOLDEN_SCENARIOS section 3](../../../docs/testing/golden-scenarios/README.md)'s plan shorthand restates Appendix A's numbers in prose and gives Core EOD a **ladder of 8**; [Appendix A.1](../../../docs/plans/M01-rules-engine.md) gives **5** per [ADR-024](../../../docs/decisions/ADR-024.md), in the same sentence that names Appendix A "the only place these numbers are defined". The plan record follows the named authority. It needs a founder ruling, and no fixture here reads the field.

## The calendar is five sessions, not a year

[`calendars/cme-2026.json`](calendars/cme-2026.json) covers `2026-11-02` to `2026-11-06`. **TradingCalendar as data is session S-E** ([P1 section 6](../../../docs/plans/P1-monorepo-scaffold.md)) and there is not one calendar row anywhere in this repository yet.

The file declares a `coverage` interval and `L-08` enforces it in both directions, so a partial calendar **cannot silently be mistaken for the CME year**: a fixture naming a day outside the window is refused rather than run against a calendar that does not know about it. When S-E lands, this file is **derived** from the seeded rows rather than maintained beside them.

## The loader's rules

Each is asserted from both sides in [`test/loader.test.ts`](../../golden-loader/test/loader.test.ts): an untouched copy of this directory loads clean, and one seeded violation per rule is watched failing **on that rule** rather than merely exiting non-zero.

| Rule | Refuses |
|---|---|
| `L-01` | An `id` that is not `GS-nnn`, or does not match the filename |
| `L-02` | An unknown top-level key, so a misspelled `dayz:` is a finding rather than an empty day stream |
| `L-03` | An `id` that is not in [GOLDEN_SCENARIOS](../../../docs/testing/golden-scenarios/README.md) |
| `L-04` | A missing sibling, an `end_state` pinning no field, or an unknown key in the sibling |
| `L-05` | An `expect:` block left in the YAML |
| `L-06` | **No `pins`.** A golden file without a stated pin is a regression test wearing a golden file's name |
| `L-07` | A plan that does not resolve, or one missing a field the engine's config type declares |
| `L-08` | A calendar that does not resolve, or a trading day it does not declare as a session |
| `L-09` | An account field that reaches no engine input and is on no list |
| `L-10` | A malformed, out-of-order or repeated day, or one missing a `DayMark` field |
| `L-11` | A non-zero `adjustment_cents` or a non-empty `settlements` |
| `L-12` | A file outside the YAML subset the loader reads |
| `L-14` | An awaiting-input entry no fixture uses any more |

## What the fixture directory does not yet hold

**Twenty-five scenarios, against a registry that defines 284.** The count is the stage's own, re-derived on every run rather than written here, and the honest form of it is **25 of 284**.

**Why writing them does not need an engine, and why it never did.** TR-01 puts the derivation in the plan document rather than in the implementation: every value in a fixture is read out of [M01](../../../docs/plans/M01-rules-engine.md)'s rule taxonomy, its Appendix A column and the scenario's own registry row, by somebody reading prose. An engine is what the fixtures are eventually run against; it is not where their numbers come from.

**[ADR-048](../../../docs/decisions/ADR-048.md) is ruled and is NOT yet wired, and this paragraph said otherwise until batch 2 checked it.** It read that polarity "is derived per fixture from the rules the fixture cites, so a fixture for a rule the engine has not implemented is asserted to fail and is not a false red". The ruling says that; the code does not do it yet. [`run.ts`](../../golden-loader/src/run.ts) still folds `evaluate`, which is still the scaffold's identity stub, and `engineIsIdentityStub()` still decides the direction **globally** for the whole directory. So **every fixture here is inverted today**, including the ones that cite only implemented rules, and the stage's skip count equals the fixture count. **The ADR's stated prerequisite is also still open**: it requires `source:` to become a resolvable citation enforced by a new `L-nn` rule "before or with the polarity change, never after it", and no rule checks `source` beyond refusing an empty string (`L-02`).

**The batch of fifteen that took this directory from three to eighteen** is the part of GS-001 to GS-029 plus GS-063 that the current fixture format can state without inventing an input: GS-002, GS-005, GS-006, GS-007, GS-010, GS-012, GS-013, GS-014, GS-015, GS-016, GS-017, GS-018, GS-019, GS-025 and GS-063.

**The batch of three that took it from eighteen to twenty-one** is the eval-consistency block: **GS-020, GS-023 and GS-024**, on a second plan record [`plans/MERIT-RAPID-50K.json`](plans/MERIT-RAPID-50K.json) transcribed from [M01 Appendix A.2](../../../docs/plans/M01-rules-engine.md), because Core EOD disables eval consistency and no Core EOD fixture can pin R-28, R-29 or R-30. GS-023 and GS-024 are a **boundary pair on one cent**: identical period profit of 500,000c, differing only in which day carries the cent, so an engine that computed the ratio by division or wrote `<` for `<=` cannot satisfy both.

**The batch of four that took it from twenty-one to twenty-five** is **GS-021, GS-022, GS-055 and GS-069**. Three of them are pairs against files that already existed, which is deliberate: a fixture whose sibling differs by one input is an assertion about an operator, and a fixture that stands alone is an assertion about an outcome.

| Fixture | Pairs with | The one number that differs |
|---|---|---|
| GS-021 | GS-022 | The losing day's P&L, which lands the consistency denominator on zero rather than below it. Together they pin both halves of R-30's strict `> 0`, and an engine that wrote `>=` satisfies GS-022 and fails GS-021 |
| GS-069 | GS-023 | Day one's P&L, 250,000c against 150,000c. The expectation differs in the seventh event alone: `phase.pass_deferred_consistency` where GS-023 has `phase.passed`. This is AS-13's monotonicity counterexample, carried at a scale of five because AS-13's own period profit of 100,000c does not meet any 50K eval target |
| GS-055 | none | AS-03's minimum-variance path, five days at exactly 50,000c, where the withdrawable lands **exactly** on the cap |

**GS-021 and GS-022 correct a claim this file made after batch 2**, which is recorded rather than quietly edited. The held-back table said a non-positive consistency denominator "requires the period to have been reset by a settlement (R-47)". It does not: **R-31's funded reset zeroes the same accumulators**, and more simply, a funded account whose period has not been reset at all reaches a negative denominator the first time it has a losing stretch. The rule was reachable the whole time. What made it *look* blocked was reading R-30 as an eval rule, and R-30 is unreachable in eval for a different reason worth stating: with no adjustment, eval period profit **is** the closing balance minus the size, so a day that meets a 300,000c target has a denominator of at least 300,000c. R-30 has nothing to do at the eval gate and everything to do at the funded one.

**What the format cannot yet reach, named rather than left as an absence:**

| Held back | Why |
|---|---|
| GS-001, GS-003, GS-004, GS-030 to GS-032 | They turn on a session's **kind**: a fill timestamp inside a session, a half day, a halted day. [`calendars/cme-2026.json`](calendars/cme-2026.json) declares five full sessions and no fill stream, and inventing either would be transcription from recollection |
| GS-026 to GS-029, GS-042 | Payout arithmetic. `evaluatePayout` and `clampPayout` are not the day fold, and the expectation sibling has no shape for a clamp result |
| GS-060, GS-080 | The `skipped: true` shape. Both turn on a gate rendering as **disabled rather than as satisfied**, which lives in `engine_gates`. That is a nested object and [`compare.ts`](../../golden-loader/src/compare.ts) diffs flat fields with `Object.is`, so a nested expectation could never match by reference. GS-021 and GS-022 reach R-30's denominator **state** and say in their own siblings that they cannot reach its flag |
| GS-052, GS-053, GS-065 to GS-068, GS-081, GS-082 | They turn on a **settlement**, and `L-11` refuses a fixture that states one because `EngineInput` has no home for it |
| GS-064, GS-070 | Reachable in principle and not inside **five sessions**. GS-064 needs an eligibility that exists at one close and a breach at the next, which is six trading days after the win-day gate is satisfied. [`calendars/cme-2026.json`](calendars/cme-2026.json) covers `2026-11-02` to `2026-11-06` and **extending it by hand is the one repair that is not available**: the CME publication has not been transcribed (`holidays: null` in the seed source), so adding a session would be recollection wearing a data file's name. GS-070 additionally needs a shape for `assertions`, which an expectation sibling does not have: a DO-3 refusal writes no state and emits no events |
| GS-049 | Its registry row names **three** probe shapes: alternating 14,999c and 15,001c days, a single 1,000,000c day into consistency math, and 100-day flat grinds. One fixture is one stream, and the third needs 100 sessions. Writing the first alone would be a third of a row wearing a whole row's id |
| GS-056, GS-079 | GS-056's second half is a post-payout balance, so it needs a settlement. GS-079 needs a plan with a **hard daily loss limit**, and all three columns of Appendix A carry `none`, so the plan record would have to invent the one value the fixture turns on |
| GS-071 to GS-078, GS-083 | Replay, engine upgrade, and publish-time config validation, none of which is one account's day stream |

**The inventory check is the half that stays off until then.** [STRATEGY section 3.2](../../../docs/testing/STRATEGY.md)'s second loader rule has two directions: a fixture whose id is not in the registry fails to load, which `L-03` does, and a registry row with no fixture fails the inventory check, which is CI-06's and would today fail on every scenario in the registry.

---

## Three readings this directory does not choose, and where each one bites

**A fixture that pins a contested value is a fixture that ratifies a ruling nobody made.** Each of these was found by writing a fixture that would have had to state one, and each is recorded here rather than settled. **None of them is a defect in a file in this directory**; two of them are places where M01 says two things.

### 1. The funded reset lowers the floor, and INV-06 forbids the floor from decreasing

**Three files already state a value that depends on the resolution: GS-019, GS-020 and GS-023**, all of which pin `floor_cents: 4750000` after an eval pass. Every one of them landed before the question was raised, and none is edited here.

R-31 sets `floor = size_cents - funded drawdown_cents` at the pass. On any 50K plan that is 4,750,000c. But the pass day's own close must clear a 300,000c target, so DO-7 has already trailed the floor to at least 5,050,000c **on that same day** before DO-8 rewrites it downward. INV-06 and R-14 say the floor never retreats, and the pseudocode's tripwire cannot see it: `if (floor < s.floorCents) throw` runs at DO-7, strictly before the progression block that lowers it.

**The reading is genuinely open** and the two candidates give different published promises: either INV-06 is scoped to the floor machine within a phase, and the funded reset is a new account's initial floor rather than a decrease, or the reset is an exception INV-06 has to name. **Batch 3 wrote no fixture that depends on it.**

### 2. The floor lock disagrees with itself when the trigger is crossed by a jump

[M01 section 3.4](../../../docs/plans/M01-rules-engine.md) gives the founder's binding expression, `floor = max(hwb - drawdown, floorLocked ? lock_floor : size - drawdown)`, and says the `max` is redundant "by CV-12". [Section 3.6](../../../docs/plans/M01-rules-engine.md)'s pseudocode instead **assigns** `floor = floorLockFloorAtCents`.

CV-12 makes them agree only when the closing balance lands **exactly** on the trigger, which is GS-015's case. On a close that overshoots, they do not. At 50K with a close of 5,400,000c the trailing floor is 5,150,000c and the locked floor is 5,010,000c, so section 3.4 gives 5,150,000c and section 3.6 gives 5,010,000c, a difference of 140,000c on the value every later breach compares against.

**INV-06 survives either way and that is why this is quiet rather than loud.** The prior day's floor can never exceed the locked floor while the account is unlocked, because a floor above it would require a close that would already have triggered the lock, so the cross-day tripwire never fires. The disagreement is **within the locking day** and it is invisible until a later low lands between the two candidates.

GS-069 is the fixture that would have had to state one. It states neither, and every low on its later days is set above **both** candidates.

### 3. R-22's operator is `>` in the rule taxonomy and `>=` in the pseudocode

[R-22](../../../docs/plans/M01-rules-engine.md) reads `-realized_pnl_cents > daily_loss_limit_cents` (**strict `>`**, "a loss exactly at the limit survives"), and records that this was aligned with R-21's strict `<` at the M1 gate under OQ-6, **amending the approved STATE_MACHINES guard**, and that it is published as "more than". Section 3.6's `dllBreach` line reads `-mark.realizedPnlCents >= rules.dailyLossLimitCents!`.

**No v1 plan configures a daily loss limit**, so nothing reachable turns on it today, and that is exactly why it is worth writing down: the day a plan enables one is the day a trader loses an account on a boundary Merit publishes the other way. GS-079 is the fixture for it and is held back for an unrelated reason (no plan record can state a limit without inventing one), so this discrepancy currently has **no fixture and no gate** standing over it.
