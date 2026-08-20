# Plan-configuration completeness audit, 2026-08-20

**A review verdict under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.**
This file is a review record. It sits deliberately outside the corpus
([`gates.mjs:167`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing
by existing. **It writes no module plan, no ADR and no migration, and it proposes no fix.**
What it produces is the parameter map that [`ADR-070`](../plans/FOLD-05-plan-config-and-designer.md)
is the ruling on.

**Session `P1` of [FOLD-05](../plans/FOLD-05-plan-config-and-designer.md).** That plan states
the dependency in its own words at [line 191](../plans/FOLD-05-plan-config-and-designer.md):
*"`P1` runs first and alone, and it writes to `docs/reviews/` rather than into a module plan
… M01, M03, M04 and M09 are frozen, so a table written into one is an amendment needing
`ADR-070`, whose content is the audit's own output."*

---

## The verdict, first

> **47 parameters. 3 first-class. 11 materialized. 29 versioned-unconstrained. 4 absent.**

**The referral's question was "is every parameter first-class versioned config, not hardcoded?"
and it has two answers, one of which is unambiguously good news.**

- **Nothing is hardcoded. The claim is testable and it holds.** [`0004_catalog.sql:78`](../../packages/db/migrations/0004_catalog.sql)
  states it as design law: *"Every parameter in here is a LAUNCH CANDIDATE re-confirmed at
  launch, not a constant. **There is no plan parameter anywhere in application code.**"* A grep
  for plan-parameter literals across `packages/*/src/**` and `apps/` returns **one hit, and it is
  a comment** ([`validate.ts:214`](../../packages/rules-engine/src/plan/validate.ts), citing
  ADR-030 on a key name). **Every one of the 47 is versioned or is absent. None is a literal.**
- **"First-class versus not" is the wrong axis, and it is why the referral undercounted the
  gaps.** The corpus has **four** states, not three, and the fourth holds 11 of the 47.

---

## 1. The four states, and why the audit reports four rather than three

[FOLD-05:34](../plans/FOLD-05-plan-config-and-designer.md) sets out three. **The tree contains a
fourth, and it is the corpus's own answer to the constraint question the referral is asking.**

| State | Meaning | Count |
|---|---|---|
| **FIRST-CLASS** | a column with a `CHECK`, versioned by the row it sits on, with no counterpart in the blob | **3** |
| **MATERIALIZED** | declared in `plan_versions.rules` as a **ratio or a flag**, projected at publish onto a **constrained column**, and the two asserted to agree by a `CV-nn` | **11** |
| **VERSIONED-UNCONSTRAINED** | inside `plan_versions.rules`, validated by application code, **not by the database** | **29** |
| **ABSENT** | not config, not hardcoded, nowhere | **4** |

**MATERIALIZED is not a shade of "unconstrained". The database does constrain these**, on the
column the publish path writes, and [`0004_catalog.sql:183`](../../packages/db/migrations/0004_catalog.sql)
explains the mechanism in its own comment: *"a CHECK constraint cannot read another table. Rather
than push the guarantee into a trigger (which is a weaker control: it can be disabled, and it
fires per row rather than per constraint), the flag is **MATERIALIZED** here alongside every
other value this table materializes at publish. That is exactly what this table is for."*

**And the split is deliberate rather than historical.** [`types.ts:409`](../../packages/rules-engine/src/types.ts)
quotes M01 section 2.4: *"The engine reads two things and never anything else:
`plan_versions.rules` for **STRUCTURE** and `plan_version_sizes` for **EVERY CENTS VALUE**. No
percentage is ever applied to a money value at runtime."* **So the blob holds shapes, types, flags
and counts; the constrained table holds money.** A reader who counts blob keys and calls them all
"unconstrained" has counted the structure half of a deliberate split and reported it as a gap.

---

## 2. The enumeration source, and how the count was derived

**The count is derived, not tallied by hand**, because a hand-maintained registry figure is the
defect [ADR-034](../decisions/ADR-034.md) exists for and this corpus has caught repeatedly.

| Source | What it enumerates | Cited at |
|---|---|---|
| `PlanRulesJson` and its eight member interfaces | every key of `plan_versions.rules` the engine models | [`types.ts:560`](../../packages/rules-engine/src/types.ts), transcribed *"key for key from DATA_MODEL section 11 and `0004_catalog.sql`"* ([`types.ts:412`](../../packages/rules-engine/src/types.ts)) |
| `PlanVersionSizeRow` | `plan_version_sizes`, *"transcribed column for column from `0004_catalog.sql`"* | [`types.ts:587`](../../packages/rules-engine/src/types.ts) |
| `CREATE TABLE plan_version_sizes` | the columns and their constraints, read directly | [`0004_catalog.sql:145`](../../packages/db/migrations/0004_catalog.sql) |
| DATA_MODEL section 11's worked example | the two stored keys the engine type deliberately omits | [`data-model/README.md:289`](../architecture/data-model/README.md) |

**Leaf expansion of `PlanRulesJson`, each interface read out of the file:**

| Interface | Line | Leaves |
|---|---|---|
| `PublishedFloorLock` | 460 | 3 |
| `PublishedDrawdown` | 441 | 2 scalars + lock = **5** |
| `PublishedDailyLossLimit` | 467 | 2 |
| `PublishedConsistency` | 473 | 3 |
| `PublishedCapScheduleStep` | 480 | 2 |
| `PublishedWinDays` | 501 | 3 |
| `PublishedEvalPhase` | 486 | 4 scalars + 5 + 2 + 3 = **14** |
| `PublishedFundedPhase` | 509 | 7 scalars + `post_payout_floor_rule.mode` + 5 + 2 + 3 + 3 + 2 = **23** |
| **`PlanRulesJson`** | **560** | `schema_version` + 14 + 23 = **38** |

**And `plan_version_sizes` carries 12 configurable columns**, excluding `id`, `plan_version_id`
and `created_at`, of which **10 carry a column-level `CHECK`**.

**The counting rule, stated so the number is reproducible.** *One parameter is one thing a founder
sets.* Where a value is declared as a ratio or a flag in `rules` **and** materialized to a column,
that is **one parameter in two representations**, counted once, in state MATERIALIZED. Counting
both would inflate `N` by nine and would report the corpus's strongest control as duplication.

```
  38  rules leaves modelled by the engine
+  2  stored in rules, deliberately unmodelled (limits, kyc)
+  3  size-row columns with no counterpart in rules
+  4  absent, named
= 47  parameters      =  3 FIRST-CLASS + 11 MATERIALIZED + 29 VERSIONED-UNCONSTRAINED + 4 ABSENT
```

---

## 3. FIRST-CLASS: 3

Size-row columns with a `CHECK` and no counterpart in the blob. **The engine cannot see two of
them and that is deliberate**: [`types.ts:582`](../../packages/rules-engine/src/types.ts) records
*"`price_cents` AND `reset_price_cents` ARE COLUMNS AND ARE NOT HERE. No `CV-nn` mentions either,
no rule reads a price … A validator that could see the price could grow a rule about it."*

| Parameter | Column | Constraint | At |
|---|---|---|---|
| Account size | `size_cents` | `bigint NOT NULL CHECK (size_cents > 0)` | [`0004:149`](../../packages/db/migrations/0004_catalog.sql) |
| Price | `price_cents` | `bigint NOT NULL CHECK (price_cents > 0)` | [`0004:150`](../../packages/db/migrations/0004_catalog.sql) |
| Reset price | `reset_price_cents` | `bigint NOT NULL CHECK (reset_price_cents > 0)` | [`0004:151`](../../packages/db/migrations/0004_catalog.sql) |

---

## 4. MATERIALIZED: 11

Declared in `rules`, projected onto a constrained column at publish, with the agreement asserted
by a `CV-nn`. **These are the parameters the referral is most concerned about and they are the
best-controlled ones in the corpus.**

| Parameter | In `rules` at | On the size row at | Column constraint | Agreement asserted by |
|---|---|---|---|---|
| Eval profit target | `phase_eval.profit_target_bp`, [`types.ts:489`](../../packages/rules-engine/src/types.ts) | `profit_target_cents`, [`0004:158`](../../packages/db/migrations/0004_catalog.sql) | `bigint NULL CHECK (> 0)` | CV-03 |
| Eval drawdown width | `phase_eval.drawdown.amount_bp`, [`types.ts:445`](../../packages/rules-engine/src/types.ts) | `drawdown_cents`, [`0004:153`](../../packages/db/migrations/0004_catalog.sql) | `bigint NOT NULL CHECK (> 0)` | CV-02 |
| Funded drawdown width | `phase_funded.drawdown.amount_bp`, [`types.ts:445`](../../packages/rules-engine/src/types.ts) | `drawdown_cents`, **the same column** | `bigint NOT NULL CHECK (> 0)` | CV-02 |
| Eval daily loss limit | `phase_eval.daily_loss_limit.amount_bp`, [`types.ts:469`](../../packages/rules-engine/src/types.ts) | `daily_loss_limit_cents`, [`0004:171`](../../packages/db/migrations/0004_catalog.sql) | `bigint NULL CHECK (> 0)` | CV-16 |
| Funded daily loss limit | `phase_funded.daily_loss_limit.amount_bp`, [`types.ts:469`](../../packages/rules-engine/src/types.ts) | `daily_loss_limit_cents`, **the same column** | `bigint NULL CHECK (> 0)` | CV-16 |
| Buffer | `phase_funded.buffer_bp`, [`types.ts:517`](../../packages/rules-engine/src/types.ts) | `buffer_cents`, [`0004:160`](../../packages/db/migrations/0004_catalog.sql) | `bigint NOT NULL CHECK (>= 0)` | CV-07 |
| Win-day floor | `phase_funded.win_days.floor_bp`, [`types.ts:504`](../../packages/rules-engine/src/types.ts) | `win_day_floor_cents`, [`0004:161`](../../packages/db/migrations/0004_catalog.sql) | `bigint NOT NULL CHECK (> 0)` | CV-05 |
| Payout cap schedule | `phase_funded.payout_cap_schedule`, [`types.ts:537`](../../packages/rules-engine/src/types.ts) | `payout_cap_schedule_cents`, [`0004:168`](../../packages/db/migrations/0004_catalog.sql) | **`jsonb NOT NULL`. NO CHECK** | CV-09, CV-10, CV-17 |
| Floor-lock enabled | `phase_funded.drawdown.lock.enabled`, [`types.ts:461`](../../packages/rules-engine/src/types.ts) | `floor_lock_enabled`, [`0004:190`](../../packages/db/migrations/0004_catalog.sql) | boolean; **table-level** `plan_version_sizes_floor_lock_complete`, [`0004:200`](../../packages/db/migrations/0004_catalog.sql) | SD-10 |
| Floor-lock trigger | `phase_funded.drawdown.lock.at_profit_cents`, [`types.ts:462`](../../packages/rules-engine/src/types.ts) | `floor_lock_at_profit_cents`, [`0004:191`](../../packages/db/migrations/0004_catalog.sql) | `bigint NULL CHECK (> 0)` | CV-12 |
| Floor-lock level | `phase_funded.drawdown.lock.floor_at_cents`, [`types.ts:463`](../../packages/rules-engine/src/types.ts) | `floor_lock_floor_at_cents`, [`0004:192`](../../packages/db/migrations/0004_catalog.sql) | `bigint NULL CHECK (> 0)`, plus `plan_version_sizes_buffer_clears_lock`, [`0004:214`](../../packages/db/migrations/0004_catalog.sql) | CV-11, CV-12 |

### 4.1 Two findings inside the exemplary table

**FINDING A. `payout_cap_schedule_cents` is a column in the exemplary table with no constraint of
any kind.** No column `CHECK` and no table `CHECK`; a grep for `payout_cap_schedule` across
`packages/db/migrations/` returns exactly one line, its declaration at
[`0004:168`](../../packages/db/migrations/0004_catalog.sql). **It is the one materialized value
whose column does not constrain it**, and its own comment explains why the shape was chosen
(*"AN ARRAY FROM DAY ONE even though v1 publishes one flat step"*) without addressing the
constraint. So the referral's premise, that the size table demonstrates constraint is achievable,
is **true of eleven of its twelve columns**.

**FINDING B. `drawdown_cents` and `daily_loss_limit_cents` are each ONE column receiving from TWO
phases.** [`types.ts:598`](../../packages/rules-engine/src/types.ts) states it plainly on the
column: *"CV-02, materialized. **ONE COLUMN, and `rules` declares a drawdown PER PHASE.**"* and
again at [`types.ts:608`](../../packages/rules-engine/src/types.ts) for CV-16. **A plan whose eval
and funded drawdowns differ has one column and two source values**, and which one it holds is a
publish-path convention rather than a schema fact. **The same asymmetry runs the other way for the
floor lock**: `PublishedDrawdown` gives *both* phases a `lock`, and the size row carries exactly
one `floor_lock_*` trio, which [`types.ts:452`](../../packages/rules-engine/src/types.ts) attaches
to `phase_funded`. **`phase_eval.drawdown.lock` therefore has no column at all** and is counted
below as versioned-unconstrained.

---

## 5. VERSIONED-UNCONSTRAINED: 29

Inside `plan_versions.rules`, a `jsonb` blob. **They are versioned, which is the property the
referral is really asking about, and it holds**: `rules` sits on the version row, a published
version is immutable ([`0028_supersede_plan_version_immutability.sql:61`](../../packages/db/migrations/0028_supersede_plan_version_immutability.sql),
*"Published plan_versions are immutable, and retirement is terminal"*), and retirement stops new
sales without touching live accounts ([`0004:100`](../../packages/db/migrations/0004_catalog.sql)).

**The database does not constrain them.** [`validate.ts`](../../packages/rules-engine/src/plan/validate.ts)
implements **all nineteen** `CV-01` to `CV-19`, and `PW-01`, `PW-02a`, `PW-02b`, `PW-03`, `PW-04`
warn at publish ([M01:321](../plans/M01-rules-engine.md)); both sets were confirmed present by
extracting the identifiers from the source rather than from the plan. **The column itself is
`rules jsonb NOT NULL`** ([`0004:79`](../../packages/db/migrations/0004_catalog.sql)) with the
shape *"validated by zod at the write boundary"*. **A malformed blob written by any other path is
accepted by the database.**

### 5.1 `phase_eval`, 11 unconstrained leaves of 14

| Parameter | At | Validated by |
|---|---|---|
| `enabled` | [`types.ts:487`](../../packages/rules-engine/src/types.ts) | precondition of CV-03 |
| `drawdown.type` | [`types.ts:443`](../../packages/rules-engine/src/types.ts) | **CV-01**, and it is load bearing: `PublishedDrawdownType` is *wider by one member* than `DrawdownType`, because R-17's `intraday_trailing` is *"config-supported and unimplemented"* ([`types.ts:425`](../../packages/rules-engine/src/types.ts)). A published plan may carry it; a resolved plan may not |
| `drawdown.lock.enabled` | [`types.ts:461`](../../packages/rules-engine/src/types.ts) | **no column.** Finding B |
| `drawdown.lock.at_profit_cents` | [`types.ts:462`](../../packages/rules-engine/src/types.ts) | **no column.** Finding B |
| `drawdown.lock.floor_at_cents` | [`types.ts:463`](../../packages/rules-engine/src/types.ts) | **no column.** Finding B |
| `daily_loss_limit.type` | [`types.ts:468`](../../packages/rules-engine/src/types.ts) | CV-16's vocabulary, typed `string` |
| `min_trading_days` | [`types.ts:493`](../../packages/rules-engine/src/types.ts) | CV-04 |
| `consistency.enabled` | [`types.ts:474`](../../packages/rules-engine/src/types.ts) | CV-06 |
| `consistency.max_day_share_bp` | [`types.ts:475`](../../packages/rules-engine/src/types.ts) | CV-06 |
| `consistency.mode` | [`types.ts:476`](../../packages/rules-engine/src/types.ts) | CV-06. Explicit *"so nobody has to remember which phase behaves how"* |
| `max_days` | [`types.ts:497`](../../packages/rules-engine/src/types.ts) | R-32. `null` means unlimited, which is every v1 plan |

### 5.2 `phase_funded`, 16 unconstrained leaves of 23

| Parameter | At | Validated by |
|---|---|---|
| `drawdown.type` | [`types.ts:443`](../../packages/rules-engine/src/types.ts) | CV-01 |
| `daily_loss_limit.type` | [`types.ts:468`](../../packages/rules-engine/src/types.ts) | CV-16 |
| `min_trading_days` | [`types.ts:513`](../../packages/rules-engine/src/types.ts) | **CV-19.** *"Zero DISABLES the gate; it does not set it low"* |
| `win_days.required_count` | [`types.ts:502`](../../packages/rules-engine/src/types.ts) | CV-05 |
| `win_days.reset_on_payout` | [`types.ts:505`](../../packages/rules-engine/src/types.ts) | CV-05 |
| `consistency.enabled` | [`types.ts:474`](../../packages/rules-engine/src/types.ts) | CV-06 |
| `consistency.max_day_share_bp` | [`types.ts:475`](../../packages/rules-engine/src/types.ts) | CV-06 |
| `consistency.mode` | [`types.ts:476`](../../packages/rules-engine/src/types.ts) | CV-06 |
| `cadence_gap_trading_days` | [`types.ts:519`](../../packages/rules-engine/src/types.ts) | CV-08, PW-02a, PW-02b, PW-04 |
| `min_settlement_lag_trading_days` | [`types.ts:535`](../../packages/rules-engine/src/types.ts) | PW-02a, PW-02b. **See the finding below** |
| `payout_cap_schedule[].from_ordinal` | [`types.ts:481`](../../packages/rules-engine/src/types.ts) | CV-09, CV-10, CV-17 |
| `payout_cap_schedule[].cap_bp` | [`types.ts:482`](../../packages/rules-engine/src/types.ts) | CV-09, CV-10, CV-17, PW-03 |
| `min_payout_cents` | [`types.ts:543`](../../packages/rules-engine/src/types.ts) | **CV-15, and it is the one cents value that lives in `rules` rather than on the size row**, because Appendix A's preamble says it *"never does"* scale by size, so there is nothing per size to materialize |
| `split_bp` | [`types.ts:545`](../../packages/rules-engine/src/types.ts) | CV-13 |
| `max_payouts` | [`types.ts:547`](../../packages/rules-engine/src/types.ts) | **CV-14. This is the ladder.** [ADR-030](../decisions/ADR-030.md) ruled the stored key is `phase_funded.max_payouts` and **not** `ladder.payouts_to_graduate` ([`0004:68`](../../packages/db/migrations/0004_catalog.sql)); frozen values 5 / 5 / 4 |
| `post_payout_floor_rule.mode` | [`types.ts:549`](../../packages/rules-engine/src/types.ts) | CV-18. *"Retired but retained, per [ADR-014](../decisions/ADR-014.md)"* |

### 5.3 Blob-level and stored-but-unmodelled, 2 + 1

| Parameter | At | Note |
|---|---|---|
| `schema_version` | [`types.ts:561`](../../packages/rules-engine/src/types.ts) | Pinned to the literal `1` |
| `limits.max_accounts_per_entity` | [`data-model/README.md:289`](../architecture/data-model/README.md) | **In the stored jsonb and NOT in the engine type**, deliberately: [`types.ts:555`](../../packages/rules-engine/src/types.ts) says *"M01 section 1.2 puts entitlement and KYC outside this module, and a type that carried them would invite a rule to read them. What `validatePlan` may not see, it may not validate, and neither key has a `CV-nn`."* |
| `kyc.triggers` | [`data-model/README.md:290`](../architecture/data-model/README.md) | Same. An **array** under [ADR-021](../decisions/ADR-021.md) and [ADR-030](../decisions/ADR-030.md), frozen at `['second_distinct_account_purchase', 'pre_funded']` ([`0004:75`](../../packages/db/migrations/0004_catalog.sql)) |

**FINDING C. Two of the 29 are unvalidated by anything, and it is on the record as intentional.**
`limits.max_accounts_per_entity` and `kyc.triggers` are in the stored blob, carry **no `CV-nn`**,
and are invisible to the validator by design. **They are the only two parameters in this audit
with neither a database constraint nor an application check.** That is a defensible boundary and
it is worth `ADR-070` seeing stated, because "validated in application code" is true of 27 of the
29 and not of these two.

**FINDING D. `min_settlement_lag_trading_days` exists because two approved documents disagree.**
[`types.ts:521`](../../packages/rules-engine/src/types.ts) records it: *"DATA_MODEL SECTION 11's
EXAMPLE DOES NOT CARRY THIS KEY AND M01 SECTION 2.4 REQUIRES IT TO EXIST, which is a disagreement
between two approved documents rather than a shape decision this file is making."* The field is
declared on M01's authority, and **the gap is reported rather than folded**. It is named here
because it is a live inconsistency in the parameter set this audit is enumerating, and it is not
one of the four gaps.

---

## 6. ABSENT: 4

**Not config, not hardcoded, nowhere.**

| # | Parameter | Verified absent by | Note |
|---|---|---|---|
| 1 | **Contract / position limits** | see 6.1 | **A specification gap, not a config gap** |
| 2 | **Marketed size label** | `git grep -inE 'marketed_size\|size_label\|marketed size'` over `docs/` and `packages/` returns **nothing outside FOLD-05**. `display_name` exists only on **`identities`**, reserved for leaderboards ([`data-model/identities.md:7`](../architecture/data-model/identities.md)) and unrelated to plans | `plans.name` exists at [`0004:40`](../../packages/db/migrations/0004_catalog.sql). The marketed label, decoupled from `size_cents`, does not |
| 3 | **Fee-back credit rule** (trigger ordinal, amount, whether it repeats) | `git grep -inE 'fee.back\|fee_back'` returns only FOLD-05 and the GS section it spawned | **The destination exists; the rule does not.** `promotional_credit` is an existing ledger class ([M20:35](../plans/M20-wallet.md), [ADR-019](../decisions/ADR-019.md)), posted by `LT-08` only and outside the withdrawable set |
| 4 | **Ladder unlock rule** (which larger tier a completed ladder unlocks) | `git grep -in 'unlock'` over [M18](../plans/M18-graduation-track.md) returns **zero** | The ladder **length** is config (`max_payouts`, section 5.2). What completing it *unlocks* is not a parameter anywhere |

### 6.1 Contract limits: the claim, restated precisely

**The brief for this session said the grep returns ZERO. It does not, and the difference does not
change the conclusion. It is recorded because a reader who runs the grep will see 15 hits.**

| Term | Hits in `docs/` + `packages/` | What they are |
|---|---|---|
| `contract limit` | 11 | [FOLD-05](../plans/FOLD-05-plan-config-and-designer.md) ×5, [INDEX:107](../INDEX.md), [ALLOCATION](../decisions/ALLOCATION.md) ×2, [GS section 38](../testing/golden-scenarios/38-gs-305-to-gs-316-plan-config-and-the-designer.md) ×2, and FOLD-05's own `OQ-F5-02` |
| `max_contract` | 1 | [FOLD-05:60](../plans/FOLD-05-plan-config-and-designer.md), the sentence declaring it absent |
| `contract_limit` | 1 | the same sentence |
| `position limit` | 1 | the same sentence |
| `max_position` | 1 | the same sentence |

**Every hit is a description of the absence, not an instance of the thing.** The four `snake_case`
terms occur only inside FOLD-05's own sentence saying they occur nowhere. **So the finding stands
in full: no schema, no config key, no plan document and no engine type defines a contract or
position limit.**

**And `set_risk` does not carry one.** Every reference in [M02](../plans/M02-rithmic-bridge.md) is
to the auto-liquidation setpoint and nothing else: *"`set_risk` at the account's current floor
**confirmed**"* ([M02:198](../plans/M02-rithmic-bridge.md)), *"you cannot infer that a risk setting
applied from the account appearing in a report"* ([M02:140](../plans/M02-rithmic-bridge.md)). **The
provisioning call pushes the floor. The corpus names no second field on it.**

**This is the fourth gap and the referral did not list it.** A prop-firm risk configuration with no
position or contract limit is a hole rather than a tidiness issue. **The gap is named here and the
fix is not proposed**: whether contract limits are Merit config pushed through `set_risk`, a
platform-side setting Merit does not own, or deliberately out of scope is `ADR-070`'s to decide,
and FOLD-05 already carries it as `OQ-F5-02` ([FOLD-05:204](../plans/FOLD-05-plan-config-and-designer.md)).

---

## 7. What the audit does NOT claim

- **It does not propose a fix for anything.** Four gaps and four findings are named; none is
  costed, designed, or assigned a migration. `0044` is reserved
  ([ALLOCATION:118](../decisions/ALLOCATION.md)) and untouched.
- **It does not say the `jsonb` blob is a defect.** Whether an unconstrained `rules` is a defect or
  an accepted design is `ADR-070`'s first question and a real one: a `jsonb` rule set is what lets a
  plan shape change without a migration, which is the flexibility `M21` exists to exploit.
- **It does not read `plans` and `plan_versions` presentation fields as plan parameters.**
  `plans.code`, `plans.name`, `plans.is_active`, `plans.sort_order`, `plan_versions.public_slug`,
  `public_visible` and `copy_blocks` are plan **identity and presentation**, all first-class columns
  and none of them something a founder varies when modelling economics. They are excluded from `N`
  and named here so the exclusion is visible rather than silent. **`copy_blocks` is worth one line
  anyway**: [`0004:83`](../../packages/db/migrations/0004_catalog.sql) says *"A version cannot be
  published with copy that describes a different number"*, which is the same disclosure guarantee
  gap 2 would need.
- **It states one figure it could not derive mechanically.** The leaf expansion in section 2 is a
  reading of nested interfaces, not a parse. The **interface field counts** were extracted from
  [`types.ts`](../../packages/rules-engine/src/types.ts) programmatically and the **column count and
  its ten `CHECK`s** were extracted from [`0004_catalog.sql`](../../packages/db/migrations/0004_catalog.sql)
  programmatically; the composition of those into 38 leaves is arithmetic done here and shown so it
  can be checked.

---

## 8. Summary table

| State | Count | Where |
|---|---|---|
| **FIRST-CLASS** | **3** | `size_cents`, `price_cents`, `reset_price_cents` |
| **MATERIALIZED** | **11** | 11 `rules` leaves onto 9 constrained columns, asserted by CV-02, 03, 05, 07, 09, 10, 11, 12, 16, 17 and SD-10 |
| **VERSIONED-UNCONSTRAINED** | **29** | 11 in `phase_eval`, 16 in `phase_funded`, `schema_version`, and 2 stored keys the engine deliberately cannot see |
| **ABSENT** | **4** | contract limits, marketed size label, fee-back credit rule, ladder unlock rule |
| **N** | **47** | |

| Finding | |
|---|---|
| **A** | `payout_cap_schedule_cents` is the one materialized value whose column carries **no constraint of any kind** |
| **B** | `drawdown_cents` and `daily_loss_limit_cents` are each **one column fed by two phases**; `phase_eval.drawdown.lock` has **no column at all** |
| **C** | `limits.max_accounts_per_entity` and `kyc.triggers` have **neither a database constraint nor a `CV-nn`**, by design |
| **D** | `min_settlement_lag_trading_days` exists because **DATA_MODEL section 11 and M01 section 2.4 disagree**, and the disagreement is unresolved |
