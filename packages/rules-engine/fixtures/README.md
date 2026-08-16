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

**Eighteen scenarios, against a registry that defines 284.** The count is the stage's own, re-derived on every run rather than written here, and the honest form of it is **18 of 284**.

**Why writing them does not need an engine, and why it never did.** TR-01 puts the derivation in the plan document rather than in the implementation: every value in a fixture is read out of [M01](../../../docs/plans/M01-rules-engine.md)'s rule taxonomy, its Appendix A.1 column and the scenario's own registry row, by somebody reading prose. An engine is what the fixtures are eventually run against; it is not where their numbers come from. [ADR-048](../../../docs/decisions/ADR-048.md) is what makes writing them early **inert rather than premature**: polarity is derived per fixture from the rules the fixture cites, so a fixture for a rule the engine has not implemented is asserted to fail and is not a false red.

**The batch of fifteen that took this directory from three to eighteen** is the part of GS-001 to GS-029 plus GS-063 that the current fixture format can state without inventing an input: GS-002, GS-005, GS-006, GS-007, GS-010, GS-012, GS-013, GS-014, GS-015, GS-016, GS-017, GS-018, GS-019, GS-025 and GS-063.

**What the format cannot yet reach, named rather than left as an absence:**

| Held back | Why |
|---|---|
| GS-001, GS-003, GS-004, GS-030 to GS-032 | They turn on a session's **kind**: a fill timestamp inside a session, a half day, a halted day. [`calendars/cme-2026.json`](calendars/cme-2026.json) declares five full sessions and no fill stream, and inventing either would be transcription from recollection |
| GS-020 to GS-024 | Consistency, which Core EOD **disables in the eval phase** ([M01 Appendix A.1](../../../docs/plans/M01-rules-engine.md)). They need a second plan record, transcribed from the Merit Rapid column |
| GS-026 to GS-029, GS-042 | Payout arithmetic. `evaluatePayout` and `clampPayout` are not the day fold, and the expectation sibling has no shape for a clamp result |
| Everything from GS-071 | Replay, upgrade, and the module scenarios, which are not one account's day stream |

**The inventory check is the half that stays off until then.** [STRATEGY section 3.2](../../../docs/testing/STRATEGY.md)'s second loader rule has two directions: a fixture whose id is not in the registry fails to load, which `L-03` does, and a registry row with no fixture fails the inventory check, which is CI-06's and would today fail on every scenario in the registry.
