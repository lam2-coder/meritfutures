---
status: approved
depends_on: [../decisions/ALLOCATION.md, M01-rules-engine.md, M03-billing-checkout.md, M04-trader-portal.md, M09-marketing-site.md, M18-graduation-track.md, M20-wallet.md]
last_updated: 2026-08-20
---

# FOLD-05: plan configuration as a first-class surface, and the console that designs it

**A fold plan, not a module plan.** Two rulings and a new module, none of them written here. **`ADR-070`** makes every parameter a founder varies in concept modelling a versioned, constrained field. **`ADR-071`** admits **`M21` Plan Designer and Simulation Console**, which is a new module after FREEZE and therefore a ruling rather than a document.

**The audit came first and it is the reason this plan says what it says.** Five findings against the tree are in section 3, and **two of them change the work**: one parameter on the referred list does not exist anywhere in the corpus, and the harness `M21`'s simulation preview is supposed to reuse is not the harness the referral has in mind.

---

## 1. Number allocation, claimed BEFORE anything is written

| Registry | Claim |
|---|---|
| **`ADR-070`** | Plan-config completeness and the four gaps |
| **`ADR-071`** | `M21` admitted after FREEZE |
| **`0044`** | `0044_plan_config_completeness.sql` |
| **`0045`** | `0045_simulation_runs.sql`. **CONTINGENT**, section 6.4 |
| **GS-305 to GS-316** | Golden-scenario section 38 |
| **Session logs** | **98 to 104**, in section 7 |

**`M21` is the next free module number**; `M01` to `M20` are taken and nothing else claims 21.

---

## 2. What the audit is actually asking

**"Is every parameter first-class versioned config, not hardcoded?"** has three possible answers per parameter and the corpus contains all three:

| State | Meaning | Example |
|---|---|---|
| **First-class** | a column, with a `CHECK`, versioned by the row it sits on | `plan_version_sizes.buffer_cents` |
| **Versioned but unconstrained** | inside `plan_versions.rules`, a `jsonb` blob, validated in application code and not by the database | the drawdown type, the consistency rule, the ladder |
| **Absent** | not config, not hardcoded, **nowhere** | contract limits |

**The middle state is the one the referral did not anticipate and it is where most of the parameters are.** They are versioned, which is the property that matters most, and they are not constrained, which is the property `plan_version_sizes` already demonstrates is achievable.

---

## 3. Five findings against the tree, checked rather than recalled

### 3.1 The per-size scalars are already exemplary

[`plan_version_sizes`](../../packages/db/migrations/) carries `size_cents`, `price_cents`, `reset_price_cents`, `drawdown_cents`, `profit_target_cents`, `buffer_cents` and `win_day_floor_cents`, **every one a `bigint` with a `CHECK`**. Account size, price, buffer, win-day floor and per-size scaling are **first-class and need nothing**. The audit should say so rather than reflexively proposing work.

### 3.2 The policy parameters live in a `jsonb` blob

`plan_versions` is `id`, `plan_id`, `version`, `status`, **`rules jsonb`**, `copy_blocks jsonb`, and the lifecycle timestamps. **The drawdown width and type, the daily loss limit, the consistency percentage and its evaluation point, the minimum days, the win-day count, the payout cap, the cadence gap, the split and the ladder all live inside `rules`.**

**They are versioned.** `rules` sits on the version row, a published version is immutable, and every account keeps the version it was sold under. **That is the property the referral is really asking about and it holds.**

**What they are not is constrained by the database.** [`validate.ts`](../../packages/rules-engine/src/plan/validate.ts) checks them at the application layer and `PW-01` to `PW-04` ([M01:323](M01-rules-engine.md)) warn at publish. **A malformed `rules` blob written by anything other than that path is accepted by the database.** Whether that is a defect or an accepted design is `ADR-070`'s first question, and it is a real question rather than a rhetorical one: a `jsonb` rule set is what lets a plan shape change without a migration, which is the same flexibility `M21` exists to exploit.

### 3.3 Contract limits do not exist. Anywhere.

**A grep for `contract limit`, `max_contract`, `contract_limit`, `position limit` and `max_position` across all of `docs/` and `packages/` returns nothing.**

**And `set_risk` does not carry them.** Every reference in [M02](M02-rithmic-bridge.md) is *"`set_risk` at the account's current floor"*, *"a `set_risk` at the new floor"*, *"a changed floor enqueues a `set_risk` push"*. **The provisioning call pushes the auto-liquidation setpoint and nothing else the corpus names.**

**So this is not a config gap, it is a specification gap**, and it is the most consequential finding in this audit. A prop-firm risk configuration with no position or contract limit is a real hole rather than a tidiness issue, and it is a **fourth gap** the referral did not list. `ADR-070` should decide whether contract limits are Merit config pushed through `set_risk`, a platform-side setting Merit does not own, or deliberately out of scope, **and say which**.

### 3.4 The Monte Carlo harness `M21` would reuse is not one

**`packages/rithmic/src/simulator/` is a market and day simulator, not a plan-economics harness.** [`session.ts`](../../packages/rithmic/src/simulator/session.ts) opens *"THE DAY MODEL. One account, one session, in integer cents and integer ticks"*, and it exists because *"`daily_marks` needs `high_balance_cents` and `low_balance_cents`, and the low is THE BREACH COMPARISON INPUT"*. **It produces equity paths to test the bridge and the engine. It does not produce pass rates, liability or margin.**

**The referral's phrase "the ported Monte Carlo harness" therefore names something that is not in this repository**, and `M21`'s simulation preview is blocked on it.

**But the news is much better than "it does not exist."** A day model that produces breach-comparison-correct equity paths is **exactly the inner loop** a Monte Carlo harness needs, and [`rng.ts`](../../packages/rithmic/src/simulator/rng.ts) states *"DETERMINISM IS THE WHOLE VALUE OF THIS PACKAGE, so the randomness is keyed rather than streamed"*. **Keyed determinism is precisely what a reproducible trial loop requires.** So the harness is a trial loop and an aggregator over an inner model that already exists and is already deterministic, which is a far smaller thing than a harness from nothing. **`M21`'s plan should say that rather than inheriting the word "ported".**

### 3.5 Fee-back credit already has its home, and its guard rail

**`promotional_credit` is an existing ledger class** ([M20:35](M20-wallet.md), [ADR-019](../decisions/ADR-019.md)), deliberately outside the withdrawable set, posted by **`LT-08` only**, and separated from earned balance by [M14](M14-loyalty-retention.md) `INV-M14-10`.

**So gap 1 is a configuration and a trigger, not a new ledger concept**, and the withdrawable-until-earned constraint the referral asks for is **already structural** rather than something the fold must impose. That is the cheapest of the four gaps and the audit should say so.

---

## 4. `ADR-070`, the four gaps

### 4.1 Fee-back credit

| | |
|---|---|
| **What** | A configurable credit of the evaluation fee, **or any amount**, to the wallet on the **Nth payout** |
| **Where** | `plan_versions` config; posted as **`promotional_credit` via `LT-08`** |
| **The guard rail, already structural** | `promotional_credit` is outside the withdrawable set, so **withdrawable-until-earned cannot be violated by construction** rather than by rule |
| **Config** | the trigger ordinal `N`, the amount (fixed cents or "the evaluation fee actually paid"), and whether it repeats |
| **Golden scenarios** | **GS-305** the Nth payout settles and the credit posts as `promotional_credit`, not as withdrawable balance. **GS-306** a trader reaches `N` on a plan whose fee-back is configured to zero, and nothing posts |

**`GS-306` is not padding.** A credit rule that fires on a zero amount and posts a zero-value ledger row is a real defect in a double-entry system, and the off case is the one nobody writes.

### 4.2 Ladder progression

| | |
|---|---|
| **What** | Completing a ladder **optionally** unlocks a larger runway or size tier for the same identity |
| **Where** | per `plan_version`, **with the unlock rule explicit** rather than implied by ordering |
| **Ties into** | [M18](M18-graduation-track.md)'s `payouts_to_graduate` and `G-LADDER-COMPLETE`, and cross-account loyalty in [M14](M14-loyalty-retention.md) |
| **Golden scenarios** | **GS-307** a ladder completes and the configured larger tier unlocks for that identity. **GS-308** a ladder completes on a plan configured with **no** unlock, and nothing changes |

**The unlock is per identity and the corpus is already careful here.** [M07](M07-risk-abuse.md):94 says only a hard merge changes what a trader may buy, so an unlock keyed to an identity has to survive the identity graph's tiers. **`ADR-070` should state which tier an unlock reads**, because a soft-linked pair sharing an unlock is a cap-aggregation bug wearing a loyalty feature's clothes.

### 4.3 Display-name decoupling

| | |
|---|---|
| **What** | **Plan display name, marketed size label, and internal size are three independent fields** |
| **Why** | so a plan can be marketed by runway or style rather than by a capital figure |
| **Where** | `plans.name` exists; the marketed label is new; `plan_version_sizes.size_cents` is the internal truth and does not move |
| **[M09](M09-marketing-site.md)** | renders **whatever the config says**, which it already does for plans and rules |
| **Golden scenarios** | **GS-309** a plan marketed under a runway label renders that label while every computation uses `size_cents`. **GS-310** the marketed label is absent and the site falls back to a stated default rather than to an empty string |

**The risk this gap creates is worth naming in the ADR.** A marketed label that drifts from `size_cents` is a **disclosure** problem, not a display problem, and [M09](M09-marketing-site.md) is the module whose whole point is that the site renders the config. **The label must be versioned with the plan version**, or a plan sold under one label can be described by another later.

### 4.4 Contract limits, which is the gap the referral did not know it had

**Not a config gap. An absence.** `ADR-070` decides, and the three live options are: Merit-owned config pushed through `set_risk`; a platform-side setting Merit does not own and must document as such; or deliberately out of scope with a stated reason.

**It cannot be left silent**, because [M02](M02-rithmic-bridge.md) is `review` under [ADR-005](../decisions/ADR-005.md) pending the vendor call and this is exactly a vendor-call question. **Golden scenario GS-311** pins whichever answer is ruled.

---

## 5. What needs no work, stated so the audit is not mistaken for a to-do list

**Account size, price, reset price, drawdown cents, profit target, buffer, win-day floor and per-size scaling are first-class already**, with `CHECK` constraints, in `plan_version_sizes`. **The drawdown type, DLL, consistency percentage and evaluation point, minimum days, win-day count, payout cap, cadence gap, split and ladder are versioned already**, inside `rules`.

**The referral asked whether they are "first-class versioned config, not hardcoded". None of them is hardcoded.** The open question is constraint, not versioning, and section 3.2 is where that question actually lives.

---

## 6. `ADR-071` and `M21`, specified

### 6.1 The intent, which is the ruling's real content

**Plan and pricing design becomes an in-product experiment rather than a code round trip.** That is the sentence `ADR-071` has to justify admitting a module after FREEZE for, and it is a strong one: every plan change today is a migration, a deploy and a founder reading a spreadsheet.

### 6.2 The six requirements

| | |
|---|---|
| **(a) Parameter form** | Over **every** `plan_version` field, with inline validation and the existing publish-time checks rendered **live**. `PW-01` to `PW-04`'s severity model ([M01:323](M01-rules-engine.md)) is displayed as it will fire, not re-implemented |
| **(b) Simulation preview** | On demand against the current parameter set: projected eval pass rate, funded-to-payout rate, average payouts per payer, liability per funded account, contribution per buyer and margin at the entered price, per-day extraction ceiling, and lifetime liability bound. **The calibration source and sample size are shown on the result**, always |
| **(c) Comparison** | Side by side: a draft against any published version, and against modelled competitor configs |
| **(d) Sensitivity** | Sweep one parameter (drawdown, consistency, win days, cap, price) and chart pass rate, liability and margin, **so the binding constraint is visible** |
| **(e) Workflow** | Draft, review, publish. **Dual control on publish** per the existing cap, split and cadence-gap rule ([ADR-010](../decisions/ADR-010.md)), a **diff against current** shown before publish, and versioning semantics preserved: **a new version applies to new sales only** |
| **(f) Never mutates live accounts** | Simulation is **read-only compute**. Publishing creates a new version and touches no existing account |

### 6.3 The harness, honestly scoped

**`M21`'s simulation depends on a Monte Carlo harness that does not exist yet**, per section 3.4. **It is a trial loop and an aggregator over `packages/rithmic/src/simulator`'s day model**, which is already deterministic and already breach-comparison-correct. **`M21`'s plan must name the harness as a dependency with its own delivery**, in the shape [M07](M07-risk-abuse.md)'s `DEP-M7-nn` rows take, rather than assuming it.

### 6.4 Adversarial scenarios, including the one the referral named

| | |
|---|---|
| **AS-M21-01** | **A published config whose simulation was run against stale calibration.** The numbers looked right, the calibration behind them was months old, and the plan is now live. **This is the scenario that decides whether `0045` is spent**: a console that stores nothing cannot tell you what a decision was based on |
| **AS-M21-02** | A sensitivity sweep run at a sample size too small to separate the arms, read as a signal |
| **AS-M21-03** | A draft published without the diff being read, changing a parameter nobody intended to touch |
| **AS-M21-04** | Simulation compute heavy enough to affect the production database it reads from |

**`AS-M21-01` is the one with a structural answer rather than a procedural one.** **Bind the calibration identity and its sample size into the simulation result, and carry it onto the publish record**, so a published version can always be traced to what its decision was based on. **That is the argument for `0045` and the plan should make it explicitly rather than reserving the table on instinct.**

### 6.5 Golden scenarios

| ID | Scenario |
|---|---|
| **GS-312** | A draft is published and **no live account changes**, on any version |
| **GS-313** | A simulation runs and **the calibration source and sample size appear on the result** |
| **GS-314** | Publish is attempted by one owner and **blocked until a second approves the same payload hash** |
| **GS-315** | **AS-M21-01:** a config is published against stale calibration, and the publish record still resolves to the calibration used |
| **GS-316** | A sensitivity sweep over price shows the binding constraint changing hands, which is the view's whole purpose |

---

## 7. Session sequence

| Rank | # | Session | Log | Fence | Regime |
|---|---|---|---|---|---|
| **1** | **P1** | **The config completeness audit.** Every parameter to its state, change nothing | 98 | `docs/reviews/` only | non-money |
| **2** | **P2** | **`ADR-070`** and the four gaps | 99 | `docs/decisions/ADR-070.md` | non-money |
| **2** | **P3** | **`ADR-071`**, admitting `M21` | 100 | `docs/decisions/ADR-071.md` | non-money |
| **3** | **P4** | The `M21` plan document | 101 | `docs/plans/M21-plan-designer.md`, `docs/INDEX.md` | non-money |
| **3** | **P5** | Fee-back and ladder folds, `0044` | 102 | `docs/plans/M18-*`, `M20-*`, `packages/db/migrations/0044_*` | **MONEY PATH** |
| **3** | **P6** | Display-name decoupling | 103 | `docs/plans/M09-*`, `M03-*` | non-money |
| **4** | **P7** | The Monte Carlo harness | 104 | `packages/` | non-money |

**`P1` runs first and alone, and it writes to `docs/reviews/` rather than into a module plan**, for the same reason [FOLD-04](FOLD-04-impersonation-and-admin-parity.md)'s `I1` does: M01, M03, M04 and M09 are frozen, so a table written into one is an amendment needing `ADR-070`, whose content is the audit's own output.

**`P2` and `P3` are concurrent.** Two new ADR files, no shared document.

**`P5` is money path**: it posts to the ledger through `LT-08` and it takes a migration. Its own session, plan mode, ADR-003 strict.

---

## 8. Open questions for the founder

| # | Question |
|---|---|
| **OQ-F5-01** | **Should `plan_versions.rules` become constrained columns, or stay a validated blob?** The blob is what lets a plan shape change without a migration, which is the flexibility `M21` exists to exploit. **Constraining it may cost the thing being built.** |
| **OQ-F5-02** | **Contract limits: Merit config, platform setting, or out of scope?** It is a vendor-call question and [M02](M02-rithmic-bridge.md) is still `review` under [ADR-005](../decisions/ADR-005.md) |
| **OQ-F5-03** | **Which identity-graph tier does a ladder unlock read?** A soft-linked pair sharing an unlock is cap aggregation by another name |
| **OQ-F5-04** | **Is the marketed size label versioned with the plan version?** If not, a plan sold under one label can be described by another later, which is a disclosure problem rather than a display one |
