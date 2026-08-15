---
status: approved
depends_on: [../MERIT_BUILD_MASTER_PROMPT.md, decisions/README.md, STATE.md, INDEX.md, testing/STRATEGY.md, testing/SIMULATION_HARNESS.md, GUIDE_BRIEFING.md]
last_updated: 2026-08-14
---

# Delivery Plan

**Constitution section 8's twelve-week plan, re-planned against what the corpus has since decided.** The constitution is read-only, so this document is the amendment, made through the process section 9 requires.

**The headline, stated first because it is the thing the founder needs and everything below is the argument for it: the plan is now 18 weeks to a public-launch gate, not 12.** Six weeks were added by five decisions, every one of them deliberate and every one of them recorded with its cost at the time it was taken. **None of the six weeks is slippage.** What follows is where each went, what is launch-blocking and what is not, and what could be traded if the schedule tightens.

---

## 1. What changed since section 8 was written

| Decision | Scope impact | Recorded at the time |
|---|---|---|
| **[ADR-020](decisions/ADR-020.md), two-tier data plane** | **+2 to 4 weeks.** The largest single scope addition since the constitution. Streaming ingest, a live cache, WebSocket delivery, live surfaces on the portal and admin, graceful degradation, and the labeling discipline on every one of them | **Yes**, as a duration rather than as "some extra work", specifically so it could be traded against something |
| **[ADR-019](decisions/ADR-019.md), the Merit Wallet** | **+1 to 1.5 weeks.** A new module (M20), a new checkout payment method, wallet UI in the portal, M5's flow becomes the external leg with an internal leg in front of it, and wallet balances enter liability and reserve coverage | Partially. The module scope was clear; the schedule cost was not stated |
| **[ADR-021](decisions/ADR-021.md) and [ADR-022](decisions/ADR-022.md), identity** | **+1.5 to 2 weeks.** M19 is a first-class module that section 8's twelve weeks never contained. The composite trigger set, provider integration, dedupe, funnel telemetry, and ADR-022's **v1 tier only** (hard links plus KYC dedupe) | The module was added by the §4-ADDENDUM; the weeks were not |
| **[ADR-023](decisions/ADR-023.md), checkout enrichment** | **+2 to 3 days.** Bought rather than built, observe mode first, one adapter and one signal path | Yes, as a bought integration |
| **M11 through M18**, ten modules the twelve weeks never mentioned | **Variable, and this is where the triage in section 2 does its work.** Not all of them are launch-blocking and treating them as though they were is how a 12 week plan becomes a 30 week one | No. Section 8 predates the §4-ADDENDUM's module expansion |
| **[ADR-025](decisions/ADR-025.md), cap release rejected** | **Net zero, slightly negative.** Progressive cap release leaves scope; cross-account loyalty is smaller and is not launch-blocking in any case | Yes |

**The two-tier data plane is the trade that is actually available.** It is recorded as a duration precisely so that this sentence can be written: **cutting tier 2 recovers 2 to 4 weeks and costs Merit a live dashboard**, which is competitive-floor table stakes in this market. The recommendation is to keep it, and the founder should know it is the lever.

---

## 2. Launch-blocking triage

**The most valuable thing in this document.** Ten modules arrived after section 8 was written and the schedule is decided by which of them must be live on launch day. **Three tests apply**, and a module is launch-blocking if it fails any one of them.

1. **Does a trader's money go wrong without it?**
2. **Does a legal or disclosure obligation go unmet without it?**
3. **Is it the reason a trader chooses Merit over the incumbent?**

| Module | Verdict | Reasoning |
|---|---|---|
| **M01 to M10** | **MUST**, unchanged | Section 8's original scope |
| **M20 Merit Wallet** | **MUST** | Test 1. [ADR-019](decisions/ADR-019.md) is structural: the cadence anchor is the wallet-credit day, so every plan's published cycle depends on it existing |
| **M19 KYC and identity** | **MUST** | Tests 1 and 2. Zero denial means fraud must be caught before anyone is in the money, and identity is the chokepoint. Direct plans verify at purchase and cannot ship without it |
| **M18 graduation track**, minimal | **MUST**, partially | Test 1. **The terminal settlement is the launch-blocking part**: a graduated account holding withdrawable balance with no request path is a denial by accounting boundary ([EC-124](edge-cases/EC-124.md)). The ladder tracker and its finiteness disclosure are test 2. **The review-pool surface is not launch-blocking** and can follow |
| **M16 notification center**, security and money classes | **MUST**, partially | Test 2. Freeze notices, destination-change warnings, and eligibility notices are obligations. **The preference matrix and marketing classes are not launch-blocking** |
| **M12 transparency platform**, the machine | **MUST**, with a nuance | Test 3. It is the launch differentiator and no competitor can copy it without rebuilding their data plane. **The nuance: at a `min_sample` of 250 it publishes "not yet meaningful" on launch day.** The machine, the definitions, and the method pages must ship at launch; the numbers arrive when the sample does, and **that is the honest version rather than a compromise** |
| **M11 certificates**, minimal | **SHOULD** | Test 3, weakly. Pass and payout cards with verification. It feeds M12's proof links and it is the cheapest social proof available. Cut the leaderboard and the deferred per-trade kind |
| **M17 offers engine**, minimal | **SHOULD** | Commercial. Reset pricing at launch is needed; experiments, bundles, and promotional credit are not |
| **M13 analytics and journal** | **LATER** | Retention driver, not a launch requirement. It also carries the load-contention risk against the payout path ([EC-103](edge-cases/EC-103.md)), which is a reason to ship it when there is slack rather than during a launch |
| **M14 loyalty and retention** | **LATER** | [ADR-025](decisions/ADR-025.md) shrank it and its trigger is a **completed ladder**, which by construction nobody has for at least 25 trading days after the first funded account |
| **M15 Discord** | **LATER** | Constitution section 10 already says post-launch |

**The triage recovers roughly 4 weeks** against a plan that treated all ten as launch scope, and it is why 18 rather than 22.

---

## 3. Before any of this: the pre-FREEZE queue

**Zero application code exists and none may be written until [STATE](STATE.md) says FROZEN.** Three items remain, and one of them is flagged.

### 3.1 The consolidated schema-delta migration reconciliation

**Its own session. Money path. Strict [ADR-003](decisions/ADR-003.md) regime. Fresh context. This is the single highest-risk documentation session remaining and it is being split out rather than folded into the FREEZE gate.**

**What it is.** Four waves of proposed schema changes reconciled into one reviewed migration set against the approved [DATA_MODEL](architecture/DATA_MODEL.md): **M01's ten deltas, batch 1's thirty-seven, and batch 2's forty-one: 88 numbered, plus 5 unnumbered schema changes that exist as rulings with no delta number, for a total of 93** ([ADR-026](decisions/ADR-026.md)). The link-confidence signal-weight table gets a home in the reserved sequence.

**Correction folded:** this line previously read "thirty-one" and named `ladders_completed_lifetime` and the SD-M19-03 widening as two further additions. Neither is a separate delta: `ladders_completed_lifetime` is already inside `SD-M14-01`'s column list, and the SD-M19-03 widening is an amendment to an existing delta. Both are folded and neither is counted twice.

**Why it is high risk, in four specific ways rather than as a feeling.**

1. **It is the last moment the schema is free.** Constitution E2: migrations are sacred, never edited after merge, and every money-table migration gets the founder's line-by-line read. A delta reconciled wrongly here is a migration on a live table later.
2. **The deltas were written by twenty separate module plans that could not see each other.** Two plans proposing the same column under different names, or the same name with different semantics, is the expected failure rather than the unlikely one, and it is invisible until they are laid side by side.
3. **Several deltas encode a ruling.** `provenance`'s closed check constraint carries `INV-WALLET-NO-DEPOSITS`; the absence of a per-account parameter override column carries [ADR-010](decisions/ADR-010.md)'s dual control; append-only grants carry VG-8. **A delta that loses its ruling looks like a schema simplification.**
4. **Context poisoning on this diff is catastrophic and it is a long diff**, which is exactly the combination [ADR-003](decisions/ADR-003.md)'s strict regime exists for.

**Definition of done.** One migration set, ordered, each file traceable to the `SD-nn` deltas it implements, every money-table change flagged for the line-by-line read, every constraint that encodes a ruling annotated with the ADR, and every new table paired with its negative-authz test row (VG-5).

### 3.2 M02 gate closure

Blocked on the Rithmic vendor call. **Sixteen `V-M2-nn` items**, and `V-M2-15` is a **commercial precondition rather than a question**: without an acknowledgement artifact or a readable risk setting, fail-closed provisioning brings no account online at all. It should be raised first on the agenda rather than as item fifteen.

### 3.3 The FREEZE gate itself

The founder marks the corpus FROZEN in [STATE](STATE.md). **Only after this does application code begin**, and branch-per-module with pull-request discipline resumes for it (constitution C7, [ADR-D1](decisions/ADR-D1.md)).

---

## 4. The revised plan

Eighteen weeks. Each phase carries a definition of done that includes its tests green, per section 8's own rule.

| Phase | Weeks | Contents | Definition of done |
|---|---|---|---|
| **P1 Foundation** | **1** | Monorepo scaffold, the reconciled schema and migrations, TradingCalendar as data, CI with the full [STRATEGY](testing/STRATEGY.md) gate inventory including VG-12 and the corpus-integrity checks | Every VG gate wired and failing correctly on a seeded violation. **VG-12 is not deferred** |
| **P2 Rules engine** | **2 to 4** | The engine, the entire section 5.1 to 5.3 test stack, the synthetic Rithmic simulator **in both file and streaming modes**, the nightly batch, the replay self-audit | All engine-executable golden files green, the eight `PT-nn` properties green, the harness running nightly with its bands. **This is the longest pole and it is intentional** |
| **P3 Ledger, billing, identity** | **5 to 6** | Ledger, billing and checkout, coupons and affiliate attribution, the provisioning saga against the simulator, **M19 KYC with the composite trigger set**, **[ADR-023](decisions/ADR-023.md) enrichment in observe mode** | Webhook idempotency suite green, saga compensation green, fail-closed provisioning holding an unconfirmed setpoint out of trading, verification firing at each configured trigger |
| **P4 Portal and site** | **7 to 8** | Trader portal, marketing site with config-rendered plans and rules, the M12 machine and method pages, the stats page rendering "not yet meaningful" honestly | [DESIGN_SYSTEM](design/DESIGN_SYSTEM.md)'s slop-score pass green, the parameter-lint green, every disclosure block present, GS-143 and GS-144 failing the build on a seeded violation |
| **P5 Payouts and wallet** | **9 to 10** | **M20 wallet and the two-leg payout**, the external rail in sandbox, the freeze path with its expiry sweep, the admin liability dashboard including wallet balances, the event feed | Two-leg atomicity green, wallet concurrency green, a freeze reaching expiry **releases**, reserve coverage computed with float excluded |
| **P6 Live tier** | **11 to 12** | **[ADR-020](decisions/ADR-020.md)'s tier 2**: streaming ingest through the adapter, the live cache, WebSocket delivery, live portal surfaces, live Open Liability, degradation and labeling | GS-132 byte-identical with the cache poisoned, GS-133 relabeling in the same render as the fallback. **This is the tradeable phase** |
| **P7 Risk and abuse** | **13 to 14** | Tier-1 detectors including D-12 to D-14, the flags queue, two-tier evidence packs, CUSUM and circuit breakers, [ADR-022](decisions/ADR-022.md)'s **v1 tier only**, Metabase, Chatwoot and Loops wiring | Detector canaries found on every run, evidence-pack redaction by audience green, the breaker reporting `insufficient_data` rather than firing on a small sample |
| **P8 Hardening** | **15 to 16** | Idempotency chaos, load sanity, the security pass and the D0 battery, **the runbooks rehearsed rather than read**, the real Rithmic test environment, the CME TPAP prerequisites checklist | All ten D0 fixtures green, both load profiles inside target, **the restore drill run once for real with payouts mid-queue**, the break-glass existence check performed |
| **P9 Private beta** | **17 to 18+** | 50 to 100 traders at a discount. **The shadow-run**, daily triage, polish | **Six clean weeks of shadow-run, restarting on any P0** ([STRATEGY](testing/STRATEGY.md) section 3.6). This gate is measured in clean weeks rather than in calendar weeks, which is why the plan ends at "18+" |

**P9 is honestly open-ended and the plan says so.** The public-launch gate is the constitution's section 5.6 requirement, it is measured in consecutive clean weeks, and a plan that quotes it as two weeks is a plan that has already decided to shorten it.

---

## 5. What is not in the 18 weeks

| Item | When |
|---|---|
| M13 analytics and journal, M14 loyalty, M15 Discord | Post-launch, in that order |
| M17's experiments, bundles, and promotional credit | Post-launch. Reset pricing ships in P4 |
| M18's review-pool surface | Post-launch. **The terminal settlement ships in P5** because it is a correctness requirement |
| M11's leaderboard and deferred per-trade certificate kind | Post-launch, and the per-trade kind may never ship ([EC-090](edge-cases/EC-090.md)) |
| [ADR-022](decisions/ADR-022.md)'s **v1.x** tier: probabilistic scoring, the signal-weight table, the M06 graph explorer | After beta produces the data the weights need. **The ordering is forced by data availability rather than by ambition** |
| [ADR-022](decisions/ADR-022.md)'s **post-launch** tier: behavioral fingerprinting against the banned corpus | It requires a banned corpus, which requires having banned people |
| Any live-capital program | Counsel packet item 1, and no copy until then |

---

## 6. Risks, and which are calendar rather than engineering

| Risk | Type | Mitigation |
|---|---|---|
| **The Rithmic vendor call has not happened** | Calendar | Everything proceeds against the simulator, which the architecture guarantees. **`V-M2-15` is the exception**: it is a commercial precondition, and without it fail-closed provisioning brings no account online. **This is the one that could stop a launch that is otherwise ready** |
| **PSP approval lead time** | Calendar | Applications go out **the day the capital go-decision is made**. Approval takes longer than the module does, and a firm with one MID has no working version of [RB-03](ops/runbooks/RB-03-mid-freeze.md) |
| **The counsel sitting** | Calendar | Three items, one lawyer, one sitting. Item 2 (wallet characterization) is the only one that blocks launch, and it most likely resolves as yes-with-conditions |
| **`mc_lifecycle.py` has not landed** | Founder task | Four calibrated figures are conservative rather than exact, and the direction of the error is the safe one. [SIMULATION_HARNESS](testing/SIMULATION_HARNESS.md) section 8 is the checklist |
| **The capital decision** | Founder | 18 month combined-stress ruin is **6.28 percent at $150K and 0.36 percent at $350K**. It is not an engineering input and it decides whether the plan is worth executing |
| **Tier 2 is 2 to 4 weeks of a 18 week plan** | Engineering | It is the recorded trade. Cutting it recovers the weeks and costs the live dashboard |

**Three of the six are calendar rather than engineering, and all three have been outstanding for the whole corpus phase.** That is the honest summary: **the schedule's largest risk is not the build.**
