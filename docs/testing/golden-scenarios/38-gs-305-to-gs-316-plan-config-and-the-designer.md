---
status: approved
depends_on: [README.md]
last_updated: 2026-08-20
---

## 38. GS-305 to GS-316: plan configuration and the designer console (FOLD-05)

`ADR-070` and `ADR-071`, planned by [FOLD-05](../../plans/FOLD-05-plan-config-and-designer.md). **Both reserved and unwritten.** `GS-305` to `GS-311` pin the four configuration gaps; `GS-312` to `GS-316` pin `M21`.

**Five of these twelve are OFF cases**, and that is deliberate rather than symmetrical. A configurable rule that fires when it is configured to do nothing is a defect the on case cannot see, and every one of the four gaps here is optional by design.

**`GS-311` is written against whichever way `OQ-F5-02` is ruled.** Contract limits appear nowhere in the corpus today: not as config, not hardcoded, and not in `set_risk`, which pushes the floor and nothing else the corpus names.

| ID | Scenario | Pins |
|---|---|---|
| GS-305 | The Nth payout settles on a plan with fee-back configured | The credit posts as **`promotional_credit` through `LT-08`**, outside the withdrawable set. **Withdrawable-until-earned holds by construction** rather than by rule, because [ADR-019](../../decisions/ADR-019.md) already put that class outside the payable balance |
| GS-306 | A trader reaches `N` on a plan whose fee-back amount is configured to zero | **Nothing posts.** A credit rule firing on zero writes a zero-value row into a double-entry ledger, which is a defect the on case never surfaces |
| GS-307 | A ladder completes on a plan configuring an unlock | The larger tier unlocks **for that identity**, and the tier read is the one `ADR-070` names. `G-LADDER-COMPLETE` is the trigger |
| GS-308 | A ladder completes on a plan configuring **no** unlock | Nothing changes. The unlock is optional and the default must be inert |
| GS-309 | A plan marketed under a runway label is rendered and priced | The **label renders** and **every computation uses `size_cents`**. The marketed label is a disclosure surface, not a display string |
| GS-310 | The marketed label is absent | The site falls back to a **stated default**, never to an empty string. [M09](../../plans/M09-marketing-site.md) renders what the config says, so an absent value must have a specified rendering |
| GS-311 | An account is provisioned on a plan carrying a contract limit | Whichever `OQ-F5-02` rules: Merit config pushed through `set_risk`, a platform setting Merit documents and does not own, or out of scope with a reason. **Today `set_risk` carries the floor alone** |
| GS-312 | A new plan version is published from the console | **No live account changes, on any version.** Every account keeps the version it was sold under. This is the one that makes the console safe to hand to a founder |
| GS-313 | A simulation is run and its result displayed | **The calibration source and sample size appear on the result.** A projection without its calibration is a number with no provenance |
| GS-314 | One owner publishes and a second has not approved | **Blocked until a second owner approves the same payload hash**, on [M06](../../plans/M06-admin-ops-console.md) section 3.4's existing machine and [ADR-010](../../decisions/ADR-010.md)'s sensitive set |
| GS-315 | **AS-M21-01.** A config is published against calibration that was already stale | The publish record **still resolves to the calibration used**. The control is provenance carried onto the publish, not a freshness check that can be skipped |
| GS-316 | A sensitivity sweep runs over price | The **binding constraint changes hands** within the swept range and the chart shows it. A sweep that never changes which constraint binds is a sweep over the wrong range |
