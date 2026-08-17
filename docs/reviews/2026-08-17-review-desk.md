# Review desk, 2026-08-17: four pull requests merged, five rulings

This file is a review record. It is deliberately outside the corpus (`isCorpusDocument`
in [`gates.mjs`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/`), so it carries
no frontmatter, appears in no INDEX, and binds nothing by existing. What binds is the
rulings below, which the next session prompts carry.

---

## 1. What merged, and what was checked rather than believed

| PR | What it claimed | Checked against |
|---|---|---|
| **#57** | Golden fixtures batch 5, GS-064, thirty of 284 | `ls packages/rules-engine/fixtures/*.yaml` is **30**; `GS-064-breach-and-payout-eligibility-on-the-same-day.{yaml,expected.json}` both present |
| **#58** | The nightly batch and SD-08's `state_hash`, replay comparison deliberately not wired | `apps/worker/src/batch/state-hash.ts` present; `apps/worker/package.json` declares `@merit/rules-engine` and the engine declares nothing back, so `RI-01` still holds |
| **#59** | The demo CLI, `--seed` byte-reproducible, no dependency added | **Run, not read.** `node scripts/demo/run.mjs --seed 42` prints the population, the gate-by-gate breakdown and both sides. No dependency in the diff |
| **#60** | P2-1, CV-01 to CV-19, R-17 declared, 45 of 50 | `validate.ts` carries CV-01 through CV-19 with no gaps; `implemented-rules.test.ts` asserts `IMPLEMENTED_RULES.length === 45` and that declared plus undeclared partitions to 50 |

Post-merge on `main`: **48 test files, 656 passed, 30 skipped. 15 of 15 gates pass clean
and fail dirty, and 16 scope cases hold.**

**One thing worth recording about the merge itself.** `pnpm run verify` failed on six
`TS2307: Cannot find module '@merit/rules-engine'` errors in `apps/worker` until
`pnpm install` re-linked the workspace. That is a working-tree artifact, not a defect:
`pnpm-lock.yaml` carries `link:../../packages/rules-engine` and CI installs before it
typechecks. Recorded because the failure reads exactly like a broken dependency
direction, which is the thing `RI-01` exists to catch, and the next person to see it
should not spend the hour I nearly spent.

---

## 2. RULING 1. P2-7 is the next session, and it is overdue rather than missing

[P2 section 7](../plans/P2-rules-engine.md) sequences **P2-7: the generators, PT-06's
harness, `RE-D-01` to `RE-D-03`** between P2-6 and the calendar gate. It has not run.
Sessions have instead executed P2-8's content: the simulator, the nightly batch, groups
F, G and H.

So the position today is that **45 of 50 rules and 30 golden fixtures exist, and the
determinism contract they rest on is asserted by nothing that runs.**
[M01 section 1.4](../plans/M01-rules-engine.md) names three merge blockers and none of
them is in the tree:

| | What M01 specifies | What exists |
|---|---|---|
| **`RE-D-01`** | Stub `globalThis.fetch`, `Date` and `Math.random` to throw, run the entire golden suite | Nothing |
| **`RE-D-02`** | Run the suite under `TZ=Asia/Kolkata` with a non-English locale, diff against the default run | Nothing. No workflow sets `TZ` or `LC_ALL`; the one grep hit is a comment in `packages/db` borrowing the idiom |
| **`RE-D-03`** | A dependency-graph assertion that the package's **transitive** imports contain no Node builtins | Nothing. `RI-01` reads the **manifest** and its own `covers` prose says so in as many words; `merit/engine-purity` reads **direct** import statements under `packages/rules-engine/src/**`. Neither walks the graph |

The engine has zero non-relative imports today, so RE-D-03 is vacuous **right now**. That
is the point: it is vacuous until it is not, and nothing would notice the day it stops
being. This is the house defect in its ordinary form, and P2 already scheduled the cure.

**Ruled: P2-7 runs next.** `RE-D-03` lands in
[`repo-invariants.mjs`](../../packages/tooling/checks/repo-invariants.mjs) as `RI-07`,
beside `RI-01`, because it is a repo invariant by construction and that is where the
existing half lives. Each of the three ships with a seeded violation it has been watched
failing on, in [`falsify-ci.mjs`](../../scripts/ci/falsify-ci.mjs), per the standing
discipline: a gate nobody has watched fail is a gate nobody has tested.

---

## 3. RULING 2. `hash.ts` hand-rolls SHA-256. It does not take a lint exception, and it waits for `RE-D-03`

[PR #58](../../apps/worker/src/batch/state-hash.ts) put `state_hash` in `apps/worker` and
carried the reason as an open item: `merit/engine-purity` reports every non-relative
import under `packages/rules-engine/src/**`, so `import { createHash } from 'node:crypto'`
is a lint error there, while [M01 1.4](../plans/M01-rules-engine.md)'s banned-constructs
table permits "`crypto` **beyond a pure hash**". It framed this as the prose allowing what
the rule refuses, and asked for a scoped exception or a hand-roll.

**The framing is half right. M01 1.4 contradicts itself inside one section.** The
banned-constructs table permits a pure hash. Two paragraphs later the enforcement
paragraph specifies `RE-D-03` as "a dependency-graph assertion that the package's
transitive imports contain **no Node builtins**", full stop, and calls it a merge blocker.
`node:crypto` is a Node builtin. The lint rule is not stricter than the spec; it is
faithful to one half of the spec and inconsistent with the other.

Three ways out, and only one survives:

| | Cost |
|---|---|
| Amend `RE-D-03` to exempt `node:crypto` | **Out on constitution grounds.** Working agreements, section 9: never weaken a gate to pass it |
| Keep the hash outside the engine permanently | Contradicts [M01 1.3](../plans/M01-rules-engine.md), which puts `hash.ts` in `packages/rules-engine/src/`. Needs an ADR to move a frozen layout |
| **Hand-roll SHA-256 in the engine** | ~150 lines of pure integer arithmetic with published NIST vectors, differentially testable against `node:crypto` from a test file, which is not under `src/**` and is not covered by the lint rule |

**Ruled: hand-roll.** It satisfies `RE-D-03`, the banned table, `types: []`, the lint rule
and M01 1.3's layout simultaneously, and the differential test against `node:crypto`
gives the correctness proof the hand-roll would otherwise owe.

**And it waits.** `state-hash.ts` stays in `apps/worker` until `RE-D-03` exists, which is
P2-7. Deciding a placement question on the strength of an assertion that is currently
imaginary is how the ruling gets forgotten the first time it is inconvenient. #58 wrote
the module as a file move on purpose; that judgment was right and it holds.

---

## 4. RULING 3. A disabled consistency gate reports `skipped: true`, and the third state I first ruled for does not exist

**This ruling was issued wrong and corrected the same day. The wrong version and how it
was caught are kept below, because the failure is more instructive than the fix.**

[PR #59](../../scripts/demo/README.md) found that `consistencyOk` returns
`{ ok: true, skipped: false }` when `cfg.enabled` is false
([`consistency.ts:97`](../../packages/rules-engine/src/day/consistency.ts)), so a plan
whose eval consistency is disabled renders `consistency={satisfied=true skipped=false}`
in `phase.passed`. **That defect is real.** A disabled gate reading as satisfied is
exactly what the corpus forbids.

**Ruled: `consistencyOk` returns `skipped: true` when `!cfg.enabled`. One line.** Five
sources state the shape and four of them state it in the same words:

| Source | Wording |
|---|---|
| **`CV-19`** ([M01 line 286](../plans/M01-rules-engine.md)) | `pass: true, skipped: true` ... "**using the same `skipped` shape as the consistency denominator rule**" |
| **[EC-050](../edge-cases/EC-050.md)** | "**the identical shape the consistency denominator rule already uses** for a skipped comparison" |
| **[ADR-015](../decisions/ADR-015.md)** | "**the same shape the consistency denominator rule already uses**" |
| **[GLOSSARY](../GLOSSARY.md), minimum trading days** | "reports `pass: true, skipped: true` and renders as disabled" |
| **`GS-080`** | "**the same shape the consistency denominator rule uses**, and the eligibility response distinguishes it from a gate that was evaluated and passed" |

**The corpus made `skipped` mean NOT EVALUATED, FOR ANY REASON**, and tied the disabled
case to the denominator case deliberately, four separate times. The required distinction
is two-way, evaluated versus not, and `GS-080` says so where it says what the response
must distinguish.

**No information is lost and no new field is needed.** `maxDayShareBp` is `null` when the
gate is disabled and carries the configured limit when R-30's denominator rule fired, so
the reason is already recoverable from the payload. That is asserted in a test rather than
left as a property somebody noticed.

**No ADR. No frozen document changes. `GS-080`'s stated shape is untouched**, which is the
test that this is the right repair rather than a convenient one.

### What the first ruling got wrong, and why it is worth the space

**Ruled first, and wrongly: that `ConsistencyVerdict` needed three states** — evaluated,
skipped by R-30, disabled by config — on the reasoning that collapsing disabled into
`skipped` would lose a distinction a support agent needs.

That reasoning came from
[`consistency.ts`](../../packages/rules-engine/src/day/consistency.ts)'s own header, which
asserts "**`skipped` IS NOT `!enabled`**". **That comment is a session's invention and it
contradicts five frozen citations.** The review desk read the comment, found it
persuasive, and did not open CV-19, EC-050, ADR-015, the GLOSSARY entry or GS-080 before
ruling on the vocabulary they define.

**This is [EC-157](../edge-cases/EC-157.md)'s failure repeated exactly**: reasoning from a
local artifact instead of against the primary sources that disagree with it. EC-157's own
sentence was "an executable statement of the wrong identity is still the wrong identity";
a code comment stating the wrong vocabulary is the same thing one layer weaker, because a
comment is not even executable.

**It was caught by the build session, which read the five sources and asked.** That is the
sixth wrong guide ruling caught this way and the mechanism is the same every time: contact
with a primary source, not adversarial review of plausible reasoning. The remedy is not
more care. It is that **a ruling about vocabulary quotes the documents that define it**,
in the ruling, at the point it is issued. This section now does.

---

## 5. RULING 4. Export the `EngineEvent` discriminated union

`DayOutput.events` is `readonly EngineEvent[]` and `EngineEvent` is
`{ type: string; tradingDay }`. Nine concrete events extend it and no union is exported,
so a consumer wanting `PhasePassedEvent.resetFloorCents` must cast. **Ruled: export the
union.** A consumer that must cast is a consumer that can cast wrong, and the portal will
render one event type per screen. This is cheap and it is the sort of thing that gets
expensive exactly once.

---

## 6. RULING 5. Finding 1 is M02's and blocks nothing being built

`DEP-M2-03`'s setpoint source is now a question with a number attached: `DEMOSWNG250002`
locked its floor at 5,046,250c, breached at a low of 5,009,500c, and the platform
setpoint was 4,750,000c because it is pushed once at provisioning. Gap: 296,250c, so the
breach carries no auto-liquidation record while
[DATA_CAPABILITIES](../../research/DATA_CAPABILITIES.md) section 1 names that record as
Merit's breach evidence.

Every rule involved is working as written. How often M2 re-pushes the setpoint is an M02
question, [M02](../plans/M02-rithmic-bridge.md) holds at `review` pending the vendor call,
and nothing currently being built depends on the answer. **Recorded, not scheduled.** The
demo made the cost of "once, at provisioning" visible in cents, which is the useful thing
and is enough for now.

---

## 7. The one founder item that blocks the build

**The CME calendar artifact.** Re-attempted this session and still refused:
`www.cmegroup.com` is blocked by the network egress proxy, as are `iana.org` and
`nyse.com`. `holidays` is `null`, the calendar cannot be seeded, and
[P2 section 6](../plans/P2-rules-engine.md) is explicit that groups A, F and H cannot
proceed without it. `CI-06m`'s fixture-regeneration half is wired and cannot assert the
days, because there is nothing to derive from.

Nothing else on the founder list gates current work.
