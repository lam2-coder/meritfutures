---
status: draft
depends_on:
  [
    ../decisions/ADR-076.md,
    ../decisions/ADR-072.md,
    ../decisions/ADR-073.md,
    WAVE-04-fixture-backlog-and-gate-inventory.md,
  ]
last_updated: 2026-08-21
---

# WAVE-05: what Tier 2's fourteen actually need, which is eight commits and no new format

**[WAVE-04 section 10](WAVE-04-fixture-backlog-and-gate-inventory.md) named four rulings and said they were the next planning session's first item.** They are taken in [ADR-076](../decisions/ADR-076.md) and the answer to all four is the same: **not a fixture.** This plan is what follows from that, and it is small.

**It is a wave plan, not a module plan.** It carries no ruling of its own. Every decision below is [ADR-076](../decisions/ADR-076.md)'s and is cited to the section that takes it.

---

## 1. What the four rulings changed

| Group | WAVE-04 section 2.3 expected | [ADR-076](../decisions/ADR-076.md) ruled |
|---|---|---|
| Publish-time validation, 5 rows | *"Needs a second fixture shape"* | **No shape.** All five are already asserted in [`plan-validate.test.ts`](../../packages/rules-engine/test/plan-validate.test.ts), section 2 |
| Replay and upgrade, 6 rows | *"Needs a ruling on where a replay golden runs"* | **`apps/worker/test`**, against the in-memory `BatchPorts`. Not the loader, not the nightly, section 3 |
| More than one account, 2 rows | *"The only multi-account fold in the tree is `scripts/demo`"* | **Refused, and it is the group where the format change would falsify `AS-09`**, section 4 |
| The calendar record, 1 row | *"Needs a calendar record key for the session open and close"* | **The keys are not added**, and the row's own arithmetic is falsified, section 5 |

**Zero of fourteen need a second fixture format.** The count is [ADR-076](../decisions/ADR-076.md) section 6 and is not restated here, because a count restated is a count that drifts, which is [ADR-034](../decisions/ADR-034.md)'s whole subject.

---

## 2. The work, and it is eight commits over three fences

**Nothing below is a fixture and nothing below is a loader.** Every item is an edit to a file that exists.

| | Item | Fence | Depends on |
|---|---|---|---|
| **`X1`** | **Six comments.** Each assertion site [ADR-076](../decisions/ADR-076.md) cites names the `GS-nnn` it discharges. Six of the eight sites do not today | `packages/rules-engine/test/`, `packages/golden-loader/test/`, `apps/worker/test/`, `scripts/demo/test/` | nothing |
| **`X2`** | **Section 39 gains the `covered-elsewhere` status**, seven rows move to it, `GS-071` moves to `writable`, and the derived counts at the head of the section are recomputed | [section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md) | `X1` |
| **`X3`** | **`GS-141`'s severity half.** One `expect` in the existing three-plan block: `PW-02a` is `info` and `PW-02b` is `warning`, and their texts differ | `packages/rules-engine/test/plan-validate.test.ts` | nothing |
| **`X4`** | **`GS-076`, `GS-077`, `GS-078` strengthened from `toContain` to a sole-error equality**, which is what `GS-083`'s block already argues for in its own words | `packages/rules-engine/test/plan-validate.test.ts` | `X3`, same file |
| **`X5`** | **`GS-071` at scale**, in [`replay.test.ts`](../../apps/worker/test/replay.test.ts): a 250-day funded life replayed, hash first and field by field | `apps/worker/test/` | `X1`, same file |
| **`X6`** | **`GS-030`'s surviving half**, in [`trading-calendar-generator.test.ts`](../../packages/db/test/trading-calendar-generator.test.ts): one trading day and one row across each transition, whatever the clock did | `packages/db/test/` | nothing |
| **`X7`** | **An ADR repairing `GS-030`'s and [EC-012](../edge-cases/EC-012-to-033-appendix-b4-battery.md)'s falsified clause.** Both are frozen and a commit cannot move either | `docs/decisions/`, `docs/testing/golden-scenarios/04-*`, `docs/edge-cases/` | `X6`, which is the evidence |
| **`X8`** | **`CI-06/fixture-inventory` reads `covered-elsewhere`**: every such row's citation resolves and its file names the row's id | `scripts/corpus/gates.mjs`, [STRATEGY section 4.4](../testing/STRATEGY.md) | `X1` and `X2`, both of them |

**`X1` before `X8` is not a preference.** [`falsify.mjs`](../../scripts/corpus/falsify.mjs) makes a gate that cannot pass the tree an ERROR, and the gate cannot pass six of eight rows until the comments land. That is the same ordering [ADR-073](../decisions/ADR-073.md) section 3 applied to `CI-07`.

**`X3` and `X4` are one session** because they are one file and one describe block. **`X5` and `X6` are separate** because they are separate packages and neither blocks the other.

---

## 3. What stays open after this wave, and on what

**Six rows and two halves**, each now named against an artifact rather than against "the format".

| Row | Open on | Owner |
|---|---|---|
| `GS-034` | A superseding mark through `accountDaysFrom`, plus `ingest.correction_received` and a review flag, which are M2's and M6's | M1 + M2 |
| `GS-074` | The same superseding mark, **plus a fifth member on `BatchReadPort`** for `payouts.eligibility_snapshot` ([`0010_payouts.sql`](../../packages/db/migrations/0010_payouts.sql)) | M1 |
| `GS-075` | The engine-upgrade protocol: Appendix B.4 step 4, a diff report, and an approval. **A golden cannot assert that somebody approved something** | M1 + ops |
| `GS-052`, internal half | [M20](M20-wallet.md)'s atomicity claim: three requests in one transaction window producing one wallet credit. A request is not a mark | M20 |
| `GS-062` | `evaluatePayout` projected forward over the calendar and aggregated at identity level. **Neither the projection nor the aggregation exists** | M1 computes, M6 renders |
| `GS-030` | The calendar-layer session count, `X6`, **and** the falsified arithmetic, `X7` | M1 calendar data |
| `GS-141`, severity half | `X3` | M1 |
| `GS-072` | **Nothing.** [`replay-determinism.property.test.ts`](../../scripts/demo/test/replay-determinism.property.test.ts) skips by derivation and switches itself on the day the engine exports `replay` | M1, self-clearing |

**`GS-072` is on this table to be struck off it.** It is the one row in Tier 2 that needed neither a ruling nor a commit, and it was in the group WAVE-04 described as *"needs a ruling on where a replay golden runs"*.

---

## 4. What this plan deliberately does not do

- **It does not write a fixture.** [ADR-076](../decisions/ADR-076.md) says none of the fourteen is one, and the two rows section 39 marks `writable` (`GS-059` and `GS-080`) are [WAVE-04](WAVE-04-fixture-backlog-and-gate-inventory.md)'s remaining business rather than this wave's.
- **It does not touch the loader.** No `L-nn` moves, `FIXTURE_KEYS` and `EXPECTATION_KEYS` are unchanged, and the engine-only import boundary is unchanged. That is section 3's ruling and it is the half of it that is easiest to erode by accident.
- **It does not widen [ADR-072](../decisions/ADR-072.md)'s blocker vocabulary.** `covered-elsewhere` is a fourth **status** and the six blocker terms stay closed. A reader who finds a seventh blocker term has found a defect.
- **It does not build `CI-09`'s replay leg** and does not depend on it. Section 3's ruling is stated against [ADR-073](../decisions/ADR-073.md) section 5's row rather than against a workflow file, so what session 114 lands does not change it. **If that session implements the replay leg WITH an input, the rejection of the nightly is re-argued and not merely inherited**, which is [ADR-076](../decisions/ADR-076.md)'s own alternative, stated conditionally.
- **It does not close `OI-25`.** The remaining scope is smaller and differently shaped than 276 suggested, and 229 of the rows behind that number are still `no-fixture-format` for modules with no code.
