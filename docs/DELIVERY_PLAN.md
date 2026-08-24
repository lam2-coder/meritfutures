---
status: approved
depends_on: [../MERIT_BUILD_MASTER_PROMPT.md, decisions/README.md, STATE.md, INDEX.md, testing/STRATEGY.md, testing/SIMULATION_HARNESS.md, GUIDE_BRIEFING.md, plans/M15-discord-integration.md]
last_updated: 2026-08-20
---

# Delivery Plan

**Constitution section 8's twelve-week plan, re-planned against what the corpus has since decided.** The constitution is read-only, so this document is the amendment, made through the process section 9 requires.

**The headline, stated first because it is the thing the founder needs and everything below is the argument for it: the plan is now 18 weeks plus 3 to 5 days to a public-launch gate, not 12.** Six weeks and 3 to 5 days were added by six decisions, every one of them deliberate and every one of them recorded with its cost at the time it was taken. **None of it is slippage.** What follows is where each went, what is launch-blocking and what is not, and what could be traded if the schedule tightens.

**The 3 to 5 days are [ADR-041](decisions/ADR-041.md)'s, they are the first addition since FREEZE, and they are stated in the headline rather than absorbed into a phase.** A three-day addition is exactly the size that gets rounded away, and a plan that rounds away every three-day addition has no way of noticing the fourth one. The rule this document applies to a 2 to 4 week decision applies to a 3 day one or it is not a rule.

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
| **[ADR-041](decisions/ADR-041.md), M15 partial into launch scope** | **+3 to 5 days.** The Discord link and the announcement templates enter **P8**; role sync stays post-launch. The smallest of the six additions and the first since FREEZE | **Yes**, as days rather than as a pull-forward with no number, on this document's own discipline. It is recorded so it can be traded, which is [ADR-020](decisions/ADR-020.md)'s reason for stating a duration at all |

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
| **M15 Discord**, the link and the announcement templates | **MUST**, partially | **[ADR-041](decisions/ADR-041.md), and this is the one row the three tests did not decide.** They would have left it LATER, where it sat until 2026-08-15. It moves on `INV-M15-06`: role removal must be silent, batched, and never coincident with an enforcement, and Ruling B creates an enforcement that halts every linked account at once. **Role sync stays post-launch**, so what ships at launch is the link and the template-only announcement path, per [M15](plans/M15-discord-integration.md)'s own `OQ-M15-01`. **+3 to 5 days, P8** |

**The triage recovers roughly 4 weeks** against a plan that treated all ten as launch scope, and it is why 18 rather than 22.

**M15 is the first thing the triage has given back, and it gave back days rather than weeks.** The row is kept in the table with its reasoning rather than deleted, because the useful record is not that M15 is launch scope; it is that a module the three tests placed at LATER was moved by an invariant in a different module, and the next module to move will most likely move the same way. **A triage test set that cannot see a cross-module invariant is a triage test set with a known blind spot**, and this is its first instance rather than an exception to it.

---

### 2.1 The vendor-parity components ([ADR-066](decisions/ADR-066.md), 2026-08-20)

**Sized by the same launch-blocking test as the table above, and sized per COMPONENT rather than per item.** [ADR-066](decisions/ADR-066.md) section 1 is what these rows transcribe. **[FOLD-03](plans/FOLD-03-vendor-parity-gap-fill.md) section 4 summarises the split as "four of the six are SHOULD" and that sentence is deliberately not carried here**: the ruling records that it does not survive a component-level count at either grain, and a sizing sentence is exactly the thing a roadmap reader quotes.

| Component | Verdict | Reasoning |
|---|---|---|
| **The Tier-1 economic calendar dataset** (`0039`) | **MUST** | **Not new scope.** `DEP-M7-06` has declared it since M07 was written and `FM-M7-08` has required its staleness alarm; no table satisfies either, so `D-04` has never been implementable. It is a repair |
| **The daily liability digest** | **MUST** | Test 1. The C8 weekly risk ritual's input is **currently a human remembering to look**. Open Liability, Eligible-Next-7-Days and the reserve coverage ratio ([M06:90](plans/M06-admin-ops-console.md) `P-M6-07`) |
| **The weekly loss-ratio and CUSUM digest** | **MUST** | Test 1, same ground. A control that exists and does not arrive is a control that enforces nothing |
| **The delivery-failure alarm** | **MUST** | **The one MUST that is not obvious.** It reads the delivery record and never the job's own report, on [M05:91](plans/M05-payout-system.md) `INV-M5-18`'s stated ground that a job reporting success is not evidence that the work happened |
| **`bounced` and `spam_complaint` as outcomes** | **MUST** | Test 2. [M16](plans/M16-notification-center.md)'s security class is exempt from rate limits and opt-outs, so a bounce on it is an **incident** rather than a preference |
| **The bounce and complaint alert** | **MUST** | Test 2. **OTP login depends on deliverability**: a silently bounced OTP is a locked-out trader with no signal anywhere |
| **The M04 calendar panel** | **SHOULD** | Trader-facing convenience. The dataset is the commitment; the panel is the parity item |
| **The flag-queue digest** | **SHOULD** | Useful, and nothing depends on it |
| **The monthly revenue and cohort digest** | **SHOULD** | Useful, and nothing depends on it |
| **All six duplicate-signal views** | **SHOULD** | Pure surface over signals [M07](plans/M07-risk-abuse.md) already carries. Real operator value, **no new capability and no new detector** |
| **Admin resend** | **SHOULD** | Re-sends the stored `rendered_body` and re-renders nothing, so proof of notice survives a template change |
| **Admin download** | **SHOULD** | Convenience over a query [M16](plans/M16-notification-center.md) already answers |

**Six MUST components and six SHOULD.** The MUST set is the whole of what launch blocks on, and **neither of its two reasons is the vendor**: the calendar closes a commitment unsatisfied since M07 was written, and the bounce alert closes an OTP lockout with no signal. Both would be MUST if no competitor existed.

**Manual balance adjustment is deliberately absent from this table.** It is the one referred item on the money path, it amends [ADR-010](decisions/ADR-010.md)'s sensitive set, and it is `ADR-067`'s to rule and size. It is named here so its absence reads as a decision rather than an omission.

---

## 3. Before any of this: the pre-FREEZE queue

**Zero application code exists and none may be written until [STATE](STATE.md) says FROZEN.** Three items remain, and one of them is flagged.

### 3.1 The consolidated schema-delta migration reconciliation

**Its own session. Money path. Strict [ADR-003](decisions/ADR-003.md) regime. Fresh context. This is the single highest-risk documentation session remaining and it is being split out rather than folded into the FREEZE gate.**

**What it is.** Four waves of proposed schema changes reconciled into one reviewed migration set against the approved [DATA_MODEL](architecture/data-model/README.md): **M01's ten deltas, batch 1's thirty-seven, and batch 2's forty-one: 88 numbered, plus 5 unnumbered schema changes that exist as rulings with no delta number, for a total of 93** ([ADR-026](decisions/ADR-026.md)). The link-confidence signal-weight table gets a home in the reserved sequence.

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

Eighteen weeks plus 3 to 5 days. Each phase carries a definition of done that includes its tests green, per section 8's own rule.

**The delta sits in P8 and moves P9's start with it.** It is written into the two phases it touches rather than into the total alone, so that a reader looking at a phase sees the same number as a reader looking at the headline.

| Phase | Weeks | Contents | Definition of done |
|---|---|---|---|
| **P1 Foundation** | **1** | Monorepo scaffold, the reconciled schema and migrations, TradingCalendar as data, CI with the full [STRATEGY](testing/STRATEGY.md) gate inventory including VG-12 and the corpus-integrity checks | Every VG gate wired and failing correctly on a seeded violation. **VG-12 is not deferred** |
| **P2 Rules engine** | **2 to 4** | The engine, the entire section 5.1 to 5.3 test stack, the synthetic Rithmic simulator **in both file and streaming modes**, the nightly batch, the replay self-audit | All engine-executable golden files green, the eight `PT-nn` properties green, the harness running nightly with its bands. **This is the longest pole and it is intentional** |
| **P3 Ledger, billing, identity** | **5 to 6** | Ledger, billing and checkout, coupons and affiliate attribution, the provisioning saga against the simulator, **M19 KYC with the composite trigger set**, **the authentication surface: sessions, the OTP challenge lifecycle, the two passkey ceremonies and `C-27` elevation** ([ADR-039](decisions/ADR-039.md), `SD-M4-04`, [ADR-093](decisions/ADR-093.md)), **[ADR-023](decisions/ADR-023.md) enrichment in observe mode** | Webhook idempotency suite green, saga compensation green, fail-closed provisioning holding an unconfirmed setpoint out of trading, verification firing at each configured trigger, and **[API_CONTRACT section 12](architecture/API_CONTRACT.md)'s `C-27` rows green in BOTH directions**: an SMS-established session refused elevation, a non-elevated session refused each of the three sensitive actions, and `GET /sessions` and `GET /phone/change` returning **200** from a single-factor session |
| **P4 Portal and site** | **7 to 8** | Trader portal, marketing site with config-rendered plans and rules, the M12 machine and method pages, the stats page rendering "not yet meaningful" honestly | [DESIGN_SYSTEM](design/DESIGN_SYSTEM.md)'s slop-score pass green, the parameter-lint green, every disclosure block present, GS-143 and GS-144 failing the build on a seeded violation |
| **P5 Payouts and wallet** | **9 to 10** | **M20 wallet and the two-leg payout**, the external rail in sandbox, the freeze path with its expiry sweep, the admin liability dashboard including wallet balances, the event feed | Two-leg atomicity green, wallet concurrency green, a freeze reaching expiry **releases**, reserve coverage computed with float excluded |
| **P6 Live tier** | **11 to 12** | **[ADR-020](decisions/ADR-020.md)'s tier 2**: streaming ingest through the adapter, the live cache, WebSocket delivery, live portal surfaces, live Open Liability, degradation and labeling | GS-132 byte-identical with the cache poisoned, GS-133 relabeling in the same render as the fallback. **This is the tradeable phase** |
| **P7 Risk and abuse** | **13 to 14** | Tier-1 detectors including D-12 to D-14, the flags queue, two-tier evidence packs, CUSUM and circuit breakers, [ADR-022](decisions/ADR-022.md)'s **v1 tier only**, Metabase, Chatwoot and Loops wiring | Detector canaries found on every run, evidence-pack redaction by audience green, the breaker reporting `insufficient_data` rather than firing on a small sample |
| **P8 Hardening** | **15 to 16, plus 3 to 5 days** | Idempotency chaos, load sanity, the security pass and the D0 battery, **the runbooks rehearsed rather than read**, the real Rithmic test environment, the CME TPAP prerequisites checklist, and **[M15](plans/M15-discord-integration.md)'s partial scope: the identity link and the template-only announcement path, role sync excluded** ([ADR-041](decisions/ADR-041.md)) | All ten D0 fixtures green, both load profiles inside target, **the restore drill run once for real with payouts mid-queue**, the break-glass existence check performed. **For M15: the link suite, the announcement suite proving there is no free-text send path and no unknown-template post, the negative-authz suite proving the link table is unreachable from auth and support verification, and the credential-separation suite against [M10](plans/M10-integrations.md)'s alerting.** The role-consent and removal-batching suites ship with role sync and are not P8's |
| **P9 Private beta** | **17 to 18+, shifted by P8's 3 to 5 days** | 50 to 100 traders at a discount. **The shadow-run**, daily triage, polish. **The community server exists from P8**, which is the point of moving M15: the surface is there when the beta community forms rather than arriving after it has settled somewhere else | **Six clean weeks of shadow-run, restarting on any P0** ([STRATEGY](testing/STRATEGY.md) section 3.6). This gate is measured in clean weeks rather than in calendar weeks, which is why the plan ends at "18+" |

**P9 is honestly open-ended and the plan says so.** The public-launch gate is the constitution's section 5.6 requirement, it is measured in consecutive clean weeks, and a plan that quotes it as two weeks is a plan that has already decided to shorten it.

---

## 5. What is not in the plan

**The heading previously read "what is not in the 18 weeks" and the total is no longer a whole number of weeks.** The list is what the plan excludes, not what a particular figure excludes, and phrasing it against a figure is how a section heading goes stale without anything catching it.

| Item | When |
|---|---|
| M13 analytics and journal, M14 loyalty | Post-launch, in that order |
| **M15's role sync**: the per-role consent surface, the removal batching, and the reconciliation sweep | Post-launch. **The link and the announcement templates ship in P8** ([ADR-041](decisions/ADR-041.md)). Role sync is the half that publishes something about a named trader, and it is the half that waits. **The server itself is not deferred with it**, and the channel policy and moderation posture are live from P8 because the room is |
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
| **Tier 2 is 2 to 4 weeks of the whole plan, and the largest single item in it** | Engineering | It is the recorded trade. Cutting it recovers the weeks and costs the live dashboard. **The denominator was written out as a number here and is now stated as a rule**, because a total that moves by 3 days makes every hand-copied instance of it wrong and nothing in CI can see a stale number inside a sentence |

**Three of the six are calendar rather than engineering, and all three have been outstanding for the whole corpus phase.** That is the honest summary: **the schedule's largest risk is not the build.**
