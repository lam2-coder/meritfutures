---
status: review
depends_on: [../../MERIT_BUILD_MASTER_PROMPT.md, ../../research/calibration/README.md, ../plans/M01-rules-engine.md, ../DECISIONS.md, ../plans/M05-payout-system.md, ../plans/M06-admin-ops-console.md, ../plans/M07-risk-abuse.md, STRATEGY.md, GOLDEN_SCENARIOS.md]
last_updated: 2026-08-14
---

# Simulation Harness

Constitution section 5.3: port the Monte Carlo trader population to TypeScript, run 10,000 synthetic traders through the **real engine** nightly in CI, and assert that the aggregate funnel lands in calibrated bands. This document is the port spec, the band inventory, and the CI contract.

**The point of the exercise, stated once so the rest reads correctly.** This is not a test of the simulation. It is a test of the **engine**, using a population whose aggregate behavior is known, and its value is that it catches rule regressions no unit test sees: a floor that trails a fraction too eagerly, an off-by-one in a cadence gap, a consistency denominator that quietly changed shape. Those produce correct-looking individual states and a funnel that has moved three points. Nothing else in [STRATEGY](STRATEGY.md) can see that.

**Identifier conventions:** `RE-S-nn` calibration bands (the identifier [M01](../plans/M01-rules-engine.md) section 8.3 already uses), `PP-nn` population parameters, `HO-nn` harness outputs.

---

## 1. The calibration source, and what is still missing

**`research/calibration/mc_lifecycle.py`, plus the business-model workbook, are the source of record** for every calibrated number in the corpus ([DECISIONS](../DECISIONS.md#the-calibration-source-becomes-version-controlled)).

| Artifact | Status as of 2026-08-14 |
|---|---|
| `research/calibration/futures_prop_firm_model.xlsx` | **Committed**, with a provenance [README](../../research/calibration/README.md) |
| `research/calibration/mc_lifecycle.py` | **Still outstanding.** The upload accompanying the workbook was an unrelated 12MB database dump and was not committed |

**What the absence costs, precisely, because it is narrower than it sounds.** The workbook is the *output*, and it carries the numbers this document needs: the correlation table, the reserve rule, the ruin scenarios, and the selection math are all in it and are all quoted below. What it cannot do is **re-run**. Without the engine, a parameter change is a diff against a spreadsheet rather than against the model that produced it, the sensitivity sweeps cannot be recomputed, and [ADR-015](../DECISIONS.md)'s sourcing of plan parameters to `mc_lifecycle.py OUR_PLANS` stays a citation rather than a diff.

**So this document is finalized against the source that exists and carries a named checklist for the source that does not.** Section 8 is that checklist. The port can be built today: the population model, the band inventory, the output contract, and the CI wiring below are complete and none of them waits on the engine. What waits is the **re-derivation** of four figures that are currently conservative rather than exact, and section 8 names each one.

---

## 2. Three things the port must not inherit

### 2.1 Conservatism was relocated, and the harness reports it that way

[ADR-013](../DECISIONS.md) recorded that the founder's lifecycle simulation was **basis anchored**, which made realized liability under the settlement anchor *at most* the modeled figure. The corpus carried that gap as a safety cushion. **[ADR-019](../DECISIONS.md) moved the cadence anchor back to the basis day**, so the model and the system are anchored the same way and the accidental cushion is gone.

**It was relocated rather than lost** (founder ruling, [DECISIONS](../DECISIONS.md)), and the relocation is a requirement on this harness rather than a note about it:

| Output | What it is | How the harness must report it |
|---|---|---|
| Calibration bands, RE-S-01's included | **Central estimates** | Labeled as central. No cushion is implied and none may be described |
| **`rho = 0.30`** correlation assumption | Where correlation conservatism lives | A **named, reported input**, not a constant buried in the model. Traders do not act independently and the reserve is sized against a book that assumes they do not |
| **Regime-stress ruin scenarios** | Where tail conservatism lives | Run as explicit adverse regimes rather than left for the distribution to imply |
| **`CVaR99 at rho = 0.30`** | **The reserve floor** | Emitted as a **distinct output from the central estimate**, named so the two cannot be confused downstream |

**The workbook computes all three and the numbers belong here rather than only in the source.** At the baseline scale of 176 active funded accounts, monthly payouts have a mean near **$45.3K at every correlation level**, while CVaR99 runs **$84.8K at rho = 0.05, $109.6K at rho = 0.15, and $132.9K at rho = 0.30**. The mean barely moves and the tail nearly doubles: **the tail is all correlation.** The reserve rule that follows is "hold at least CVaR99 of monthly payouts", roughly **2.93x the mean at rho = 0.30**, about **$135K ring-fenced from opex** at baseline.

Regime stress is the second leg. Combined revenue-shock plus extraction-wave ruin over 18 months runs **6.28 percent at $150K of capital, 1.64 percent at $250K, 0.36 percent at $350K, and 0.01 percent at $500K**, which is where the industry's "$300K to $500K" benchmark comes from once it is derived instead of repeated. Neither stressor alone is close: revenue shock alone at $150K is 0.71 percent and the extraction wave alone is 0.20 percent. **Ruin comes from regimes, not from months**, and the two together are an order of magnitude worse than either, which is the FTT and Thrive death pattern.

**The sentence this harness exists to make true: `CVaR99 at rho = 0.30` is the reserve floor, never the estimate.** Both numbers come out of the same run and would otherwise be quoted with the same name, which is exactly how a firm sizes its payout wallet against the middle of a distribution. The RCR's denominator is the floor ([M06](../plans/M06-admin-ops-console.md) P-M6-07), and reporting them as one number would silently break that.

**Two model-risk notes carried from the workbook, because they are the sort of thing that is embarrassing to discover later.** Gaussian copulas have **zero tail dependence**, which was the 2008 error; a t-copula at `nu = 4` and `rho = 0.15` lifts CVaR99 by roughly 5 percent, and the workbook's own conclusion is that **`rho = 0.30` Gaussian already dominates that stress**, so the reserve rule stands and the reasoning is on the record rather than assumed. And **a day-one `rho` estimator exists**: beta-binomial overdispersion on daily percent-profitable, one column of arithmetic. `rho = 0.30` is a conservative prior and not a permanent input, and HO-07 below is where the measurement replaces it.

### 2.2 Cycle lengths changed on every plan, and the compression was intended

[ADR-018](../DECISIONS.md) set Merit Rapid to 3 win days and [ADR-019](../DECISIONS.md) moved the anchor. The population port must use the **current** cycle lengths (Core EOD and Direct at **5 trading days**, Merit Rapid at **3**), because a harness modelling the old 7 to 8 day Core cycle under-produces extraction by roughly 40 percent and reports a reserve that looks comfortable.

**Confirmed at the batch 1 gate: the lineup-wide compression is by design, not a side effect.** Wallet-instant credit applies to every plan, and Core EOD's and Direct's economics under a 5 day cycle **equal the original simulation calibration**, which was basis anchored throughout. The harness is not being asked to model something new; it is being asked to stop modelling a settlement lag the system no longer has.

### 2.3 The wallet splits liability from cash

Under [ADR-019](../DECISIONS.md) a payout credits an internal wallet instantly and cash leaves only on a separate external withdrawal. The harness needs **two distributions where it previously needed one**:

- **Liability**, deterministic from the gates and produced by the engine. Unchanged in kind.
- **External withdrawal demand**, which depends on trader behavior: how much of a wallet balance is withdrawn, how quickly, and how much is spent internally on resets instead.

The second is a **harder** estimate than the first, not an easier one, and it is the one the payout wallet is actually funded against ([M06](../plans/M06-admin-ops-console.md) P-M6-07). At launch there is no data for it. **The funding baseline is therefore the pessimistic case** (every trader withdraws everything immediately, which reduces to pre-wallet behavior), and any float the wallet actually produces is **realized upside rather than a planning assumption**. PP-09 carries the withdrawal-behavior parameter so the assumption is visible and sweepable rather than implicit in a zero.

---

## 3. The population model

Ten parameters. Each is a named input with a source, because a population model whose assumptions live in code comments is a model nobody can argue with.

| ID | Parameter | Value | Source |
|---|---|---|---|
| PP-01 | **P(skilled)** in the buying population | **2 percent** | Chague et al. (N = 19,646) and Barber and Odean's Taiwan study put durable edge at 1 to 3 percent. The midpoint is used and the range is swept |
| PP-02 | **Skill representation** | Per-trader true Sharpe drawn from a mixture: skilled at Sharpe 1.0, unskilled at Sharpe 0 with a negative drift equal to costs | The literature's finding is a **negative** experience coefficient, so unskilled traders do not improve and must not be modelled as drifting toward zero |
| PP-03 | **P(pass \| skilled)** | **50 percent** | Workbook selection math |
| PP-04 | **P(pass \| unskilled)** | **14 percent** | Workbook selection math. Blended pass is **14.7 percent**, and **P(skilled \| funded) is 6.8 percent** |
| PP-05 | **Daily return process** | Per-trader volatility with position sizing that is **not** constant: a fraction of the population risks up after a payout | Constitution section 5.3 names this explicitly. It is the behavior that produces the post-payout breach cluster, and a harness without it under-produces breaches and over-produces liability |
| PP-06 | **Correlation** | Gaussian copula across traders at **`rho = 0.30`** baseline, swept at 0.05 and 0.15 | Workbook risk engine. Reported as a named input (section 2.1) |
| PP-07 | **Plan mix** | Purchases distributed across Core EOD, Merit Rapid, and Direct at the sizes offered, per the launch mix | Sweepable, because plan mix is a marketing outcome and the reserve should be robust to it |
| PP-08 | **Reset behavior** | A repurchase hazard after breach, with a heavy tail: a small share of identities reset many times | Dossier item 8 (martingale eval brute-forcing) is the tail, and [M14](../plans/M14-loyalty-retention.md) AS-M14-04's inversion is priced against this distribution |
| PP-09 | **External withdrawal behavior** | Share of wallet balance withdrawn, and latency to withdrawal. **Baseline: 100 percent, immediately** | Section 2.3. The pessimistic case is the funding baseline and float is upside |
| PP-10 | **Adversarial cohort** | A configurable share of identities running the hedged-pair and ring patterns from [M07](../plans/M07-risk-abuse.md), with **detection modelled explicitly** as a probability and a lag | Without this the harness models a world with no adversary, which is the world the reserve does not need to survive |

**PP-10 is the parameter that makes this harness worth more than a spreadsheet, and it is the one most likely to be dropped for being hard.** The liability tail is the true 7 percent **plus lucky streaks from the 93 percent** **plus the undetected adversarial residual**, and only the third term is under Merit's control. Modelling detection as a probability and a lag rather than as a boolean is what lets [M07](../plans/M07-risk-abuse.md)'s beta precision figures feed the reserve model instead of sitting in a risk dashboard.

**What the harness must not flatten.** Roughly **93 percent of the funded book has zero or negative true edge and will revert**, so a harness that models only skilled winners under-produces the tail. **Pass rate is a price knob, not a quality filter**, so sweeping it changes volume and liability rather than book quality. And **there is no learning effect**, so a reverted trader who rebuys does not come back stronger, which is what makes rebuy revenue durable and is the fact [M09](../plans/M09-marketing-site.md)'s honesty stance has to sit next to.

---

## 4. The port, and the one rule that makes it valid

**The synthetic population produces day streams. The real engine folds them. Nothing else.**

```
population model  ->  daily_marks per account per trading day
                          |
                          v
                  packages/rules-engine  (the real one, unmodified)
                          |
                          v
             rule_states, eligibility, settlements
                          |
                          v
                  aggregate funnel  ->  RE-S-nn bands
```

**The rule: the harness may not contain a single line that decides a gate, a breach, an eligibility, or a payout amount.** It generates balances and fills and it reads outcomes. The moment it computes an eligibility itself, in order to decide whether to have the trader request a payout, it has become a second implementation of the engine and the whole exercise tests that two things written by the same author agree. Where the population needs to know whether a payout is available, it **asks the engine**, exactly as the portal does.

**The trading calendar is the real one** (`cme-2026` and forward), including half days and halts, so the harness exercises the calendar semantics that GS-030 to GS-032 pin. A synthetic calendar of 252 identical days would silently remove the most calendar-sensitive rules from the run.

**Output goes to `test-results/`, never to the production database and never into an agent's context** ([INFRA section 9](../architecture/INFRA.md)). A 10,000-trader run produces on the order of a million marks, and a harness that writes them anywhere durable is a harness that eventually corrupts a real number.

---

## 5. The calibration bands

`RE-S-nn` is [M01](../plans/M01-rules-engine.md) section 8.3's identifier. The nightly run asserts each band and fails the build on a breach.

| ID | Assertion | Band | Note |
|---|---|---|---|
| RE-S-01 | **Evaluation pass rate**, lineup blended | **12 to 20 percent**, central estimate 14.7 percent | Constitution section 5.3's band, corroborated by the workbook's blended figure |
| RE-S-02 | **Funded to first payout** | **40 to 55 percent** | Constitution section 5.3. [ADR-018](../DECISIONS.md)'s `w=3` recalibration reports **48.1 percent**, which sits mid-band |
| RE-S-03 | **Payouts per paying account** | **1.8 to 2.4** | ADR-018 reports **2.09** |
| RE-S-04 | **Firm dollars per funded account**, per plan | Within band per plan | ADR-018 reports **$889** at `w=3`. The pre-`w=3` workbook figures are $698 Core EOD, $800 Rapid, $206 Direct, and section 8's first check is reproducing the older numbers from the older parameters |
| RE-S-05 | **Per-day extraction at the ceiling** | Merit Rapid **30,000c**, Core EOD and Direct **27,000c** | Section 6. A divergence here is a harness bug rather than an open question |
| RE-S-06 | **Lifetime extraction per account** never exceeds `max_payouts * cap` | Hard assertion, not a band | INV-17. At 50K: **750,000c gross and 675,000c to the trader** on Core EOD and Direct, **500,000c and 450,000c** on Merit Rapid ([ADR-024](../DECISIONS.md)) |
| RE-S-07 | **Mean monthly payout** at baseline scale | Near **$45.3K**, flat across the `rho` sweep | The flatness is the assertion. A mean that moves with `rho` means the copula is wired wrong |
| RE-S-08 | **CVaR99 at `rho = 0.30`** | Near **$132.9K**, roughly **2.93x** the mean | The reserve floor, emitted separately from RE-S-07 (HO-02) |
| RE-S-09 | **Combined-regime 18 month ruin** | **6.28 percent at $150K, 1.64 percent at $250K, 0.36 percent at $350K, 0.01 percent at $500K** | The capital decision's evidence, and the one output the founder reads directly |
| RE-S-10 | **Breach rate in the first funded cycle** | Elevated versus later cycles | PP-05's risk-up behavior showing up. A flat profile means the harness modelled constant sizing and the post-payout cluster is missing |
| RE-S-11 | **Detected share of the adversarial cohort**, by detection lag | Reported against [M07](../plans/M07-risk-abuse.md)'s target | PP-10. Below target, the undetected residual feeds RE-S-08 and the reserve floor rises |

**A band is a founder decision, not a tuning parameter.** When a band fails, the two available responses are "the engine regressed" and "the founder moved a plan parameter and the band moves with it, recorded in [DECISIONS](../DECISIONS.md)". Widening a band to make a nightly build green is TR-03 in [STRATEGY](STRATEGY.md), and it is the exact failure this harness exists to catch.

---

## 6. The per-day ceiling of record

**Merit Rapid's per-day extraction ceiling is $300** (30,000 cents) at 50K: a 100,000c cap, a 9000bp split, a 3 trading day cycle. **Core EOD and Direct are 27,000 cents** on a 5 trading day cycle.

This was briefly recorded as approximately $240 and flagged as an open reconciliation. It is settled: **the $240 figure was settlement-anchored commentary predating [ADR-019](../DECISIONS.md)**, and the `w=3` calibration was **basis anchored and already contained the 3 trading day cycle**. The correction is to a stale annotation and **carries no economic change**: the recalibrated unit economics ($889 firm dollars per funded account, 48.1 percent funded-to-payout, 2.09 payouts per payer, roughly 18 percent margin) were produced under the 3 day cycle and stand as recorded.

**What the harness owes here is a check, not a reconciliation** (RE-S-05). A divergence is now a harness bug rather than an open question, which is the useful state for it to be in.

**And the lifetime figure is the one to publish, not the per-day one.** [ADR-018](../DECISIONS.md)'s defense of Merit Rapid's headline rate is that a fast per-day rate on a hard-capped, gated, short-lived ladder is a marketing advantage, and the ladder is what makes the lifetime figure the number that matters: **$4,500 to the trader over at most 15 trading days** on Merit Rapid, **$6,750 over 25** on Core EOD and Direct. RE-S-06 asserts the bound and RE-S-05 asserts the rate, and the harness reports them together so nobody quotes one without the other.

---

## 7. Outputs and CI wiring

### 7.1 The output contract

| ID | Output | Consumer |
|---|---|---|
| HO-01 | Funnel report: every `RE-S-nn` band with its realized value, sample size, and pass or fail | The nightly build, and the C8 monthly retro |
| HO-02 | **`CVaR99 at rho = 0.30`** and the **central estimate**, as two separately named fields | [M05](../plans/M05-payout-system.md) DEP-M5-06, [M06](../plans/M06-admin-ops-console.md) P-M6-07's RCR denominator |
| HO-03 | Regime-stress ruin table across the capital ladder | The capital decision, [STATE](../STATE.md) |
| HO-04 | **CUSUM `mu_0` and `sigma` per plan** | [M06](../plans/M06-admin-ops-console.md) DEP-M6-05, FM-M6-07 |
| HO-05 | The **labelled fixture population** for detector precision: synthetic identities tagged as honest or adversarial | [M07](../plans/M07-risk-abuse.md) section 8. It is the only source of ground truth a precision figure can be computed against before real enforcement history exists |
| HO-06 | Wallet float projection under PP-09's sweep, reported as upside and never as a funding assumption | [M06](../plans/M06-admin-ops-console.md), [M20](../plans/M20-wallet.md) AS-M20-08 |
| HO-07 | The **day-one `rho` estimator's** output once live data exists: beta-binomial overdispersion on daily percent-profitable | Replaces PP-06's prior with a measurement. Until then the field is absent rather than zero, because a zero here would read as "no correlation measured" |
| HO-08 | Sensitivity sweep over PP-01, PP-07, and `max_payouts` | The parameter-confirmation conversation at FREEZE. **Blocked on `mc_lifecycle.py`**, see section 8 |

### 7.2 CI

**CI-09, nightly, per [STRATEGY](STRATEGY.md) section 4.1.** Not a merge blocker: a 10,000-trader Monte Carlo is not a pull-request-latency operation, and its failures need a human to classify as a regression or a drift.

**But it is not advisory either.** A failed band pages the same channel a nightly batch failure does, the run is reproducible from a recorded seed, and the seed is written into the report so a failure can be re-run exactly rather than approximately. **A harness whose failures are not reproducible is a harness whose failures get attributed to noise**, which is the specific way this kind of suite dies.

**Money-path diffs run it out of band**, before the change is considered done rather than the next morning ([STRATEGY](STRATEGY.md) section 5).

---

## 8. The checklist for when `mc_lifecycle.py` lands

**This section is the standing action.** It is written as a checklist rather than as prose because it will be executed in a session that has not read this document before.

### 8.1 The six divergences

The [calibration README](../../research/calibration/README.md) tabulates six places where the workbook's `Our Firm - Plans` tab disagrees with the corpus, because that tab predates the M1 and batch 1 gates. **The corpus wins.** When the engine lands and is re-run, **every row should either disappear or become a deliberate founder decision to change the corpus**, and there is no third outcome.

| # | Workbook | Corpus | Authority |
|---|---|---|---|
| 1 | "Rapid Daily" | **Merit Rapid** | [ADR-013](../DECISIONS.md) |
| 2 | Rapid: 5 winning days | **3 win days** (`w=3`) | [ADR-018](../DECISIONS.md) |
| 3 | Rapid: pay gap 1, marketed as daily | Gap 1, **dominated** by the 3 win-day gate | EC-049, PW-02b |
| 4 | Core: min days to first payout "day 1" | Funded `min_trading_days` **0 on all plans**, disabled and visibly so | [ADR-015](../DECISIONS.md), CV-19 |
| 5 | Settlement "2 to 3 business days" as the cadence anchor | **Instant wallet credit** is the anchor; 2 to 3 days is the external leg only | [ADR-019](../DECISIONS.md) |
| 6 | Profit split "90/9" | **9000bp (90/10)**. A typo, not a third split | [GLOSSARY](../GLOSSARY.md) |

### 8.2 The four figures that are currently conservative rather than exact

[ADR-024](../DECISIONS.md) shortened the ladder from 8 to 5 after the `w=3` recalibration and the workbook's risk engine were both computed. **Liability is monotone-decreasing in `max_payouts`**, so every affected figure is now a bound in the safe direction rather than an estimate. **The direction of the error is known and it is the conservative one**, which is why this is a scheduled recalibration rather than a blocker.

| Figure | Current status | What the re-run produces |
|---|---|---|
| Firm dollars per funded account (**$889**) | Computed at the 8-rung ladder, so realized is **at least** this | The exact figure at 5 rungs |
| Funded-to-payout conversion (**48.1 percent**) | Same | Exact |
| Payouts per paying account (**2.09**) | Same, and the shortened ladder truncates the upper tail | Exact |
| **CVaR99 at `rho = 0.30`** (**$132.9K**) and the ruin table | Computed at the longer ladder, so the reserve floor is **at least** adequate | Exact, and this is the one the capital decision turns on |

**On execution, every "at least" annotation in the corpus attached to these four figures is replaced with the exact value**, in this document, [ADR-018](../DECISIONS.md), [ADR-024](../DECISIONS.md), the [calibration README](../../research/calibration/README.md), and [STATE](../STATE.md).

### 8.3 The order of operations

1. **Commit the engine** at `research/calibration/mc_lifecycle.py`. Verify it is the lifecycle engine and not another artifact.
2. **Re-run it unchanged first**, at the workbook's original parameters, and reproduce the workbook's `Our Firm - Plans` figures ($698 Core EOD, $800 Rapid, $206 Direct). **Reproducing a superseded result from superseded inputs is the cheapest available proof that the artifact is the one the workbook came from**, and it is available exactly once, while both sets of numbers still exist.
3. **Walk the six divergences.** Each row disappears or becomes a founder decision.
4. **Re-run at the current corpus parameters**, including `max_payouts = 5`, and produce the four exact figures in 8.2.
5. **Replace every "at least" annotation** with the exact value, across the five documents named in 8.2.
6. **Confirm [ADR-015](../DECISIONS.md)'s `OUR_PLANS` sourcing** is now a diff rather than a citation, and say so in the ADR.
7. **Clear the [STATE](../STATE.md) item.** It has narrowed twice and this is what closes it.
8. **Then build the port**, using the engine as the reference implementation for the population model rather than this document's prose. A port whose source is prose is a port that quietly diverges.

**Step 8 is last for a reason and it is the one most likely to be reordered under time pressure.** Building the TypeScript port before the Python engine is verified means calibrating the port against numbers that are about to change, and the failure is invisible: the port passes its bands, the bands were wrong, and nothing ever says so.

---

## 9. Open questions for the founder

**OQ-SH-01. What is the adversarial cohort share in PP-10?** The harness needs a number for the fraction of identities running ring patterns, and there is no honest source for it before beta. Proposed: **sweep 1, 3 and 5 percent** and report RE-S-08 at each, rather than picking one and reporting a single reserve floor. The reserve conversation is then "at what adversarial share does $350K stop being enough", which is a better question than "what is the number".

**OQ-SH-02. Does the nightly run page, or digest?** Section 7.2 proposes **page**, on the same channel as a nightly batch failure. The argument for digest is that a band breach is rarely urgent at 3am. The argument for page, which is the recommendation, is that the first time this suite is treated as a digest is the last time anybody reads it.

**OQ-SH-03. Is the capital decision made against RE-S-09 at $350K?** The workbook puts combined-stress 18 month ruin at **0.36 percent at $350K** and **6.28 percent at $150K**. This is the founder's call and it is on the [STATE](../STATE.md) surviving-items list rather than being decided here, but the harness should be told which figure it is defending so RE-S-08's band can be set against it rather than against a general sense of adequacy.
