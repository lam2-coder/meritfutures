---
status: approved
depends_on: [../../docs/DECISIONS.md, ../../docs/testing/SIMULATION_HARNESS.md, ../../docs/plans/M01-rules-engine.md]
last_updated: 2026-08-14
---

# Calibration source of record

Per [ADR-015](../../docs/DECISIONS.md) and the calibration-source ruling, **every calibrated number in the corpus traces to the artifacts in this directory.** Before they lived here, "the source of record" was a filename rather than something anyone could diff.

## What is here

| File | What it is | Status |
|---|---|---|
| `futures_prop_firm_model.xlsx` | The business-model workbook. 18 tabs: industry data, verified competitor rules, our plan lineup, eval and funded phase models, cost stack, pricing power, the portfolio risk engine, an 18-month treasury projection, and the launch playbook | **Committed 2026-08-14** |
| `mc_lifecycle.py` | The Monte Carlo lifecycle engine the workbook is generated from. The workbook's own README tab says "Engine = mc_lifecycle.py; re-run after any rule change" | **NOT YET COMMITTED.** See below |

## `mc_lifecycle.py` is still outstanding

The upload accompanying the workbook on 2026-08-14 was **not** `mc_lifecycle.py`. It was a 12MB PostgreSQL dump (`fpacpre...sql`) of an unrelated accounting-operations system, schemas `fpac_acctops` and `fpac_close`, containing 36 tables of real data. It was **not committed**, for three reasons, recorded so the decision is not re-litigated: it is not the artifact the corpus references; a 12MB dump does not belong in a planning-corpus repository; and a database dump of a live system may carry data that has no business being in version control.

**Consequence, stated plainly.** The workbook is the *output*. Without the engine, a parameter change is a diff against a spreadsheet rather than against the model that produced it, and the sensitivity sweeps the workbook cites cannot be re-run. [ADR-015](../../docs/DECISIONS.md) sources plan parameters to `mc_lifecycle.py OUR_PLANS` specifically, and that reference remains a citation rather than a diff until the file lands. Tracked in [STATE](../../docs/STATE.md).

## The workbook predates several approved ADRs, and this matters

**The `Our Firm - Plans` tab is a snapshot taken before the M1 gate and the batch 1 gate.** It is corroborating evidence for the corpus, not an authority over it. Where the two disagree, **the corpus wins**, because the corpus carries the founder rulings and the workbook has not been re-run since.

Known divergences as of 2026-08-14:

| Workbook says | Corpus says | Authority |
|---|---|---|
| "Rapid Daily" | **Merit Rapid** | [ADR-013](../../docs/DECISIONS.md) renamed it; the plan cannot be published as daily |
| Rapid: 5 winning days | **3 win days** (`w=3`) | [ADR-018](../../docs/DECISIONS.md), and the `w=3` recalibration is the founder's own re-run |
| Rapid: pay gap 1 (daily) | Gap 1, but **dominated** by the 3 win-day gate | EC-049, [M01](../../docs/plans/M01-rules-engine.md) PW-02b |
| Core: min days to first payout "day 1" | Funded `min_trading_days` **0 on all three plans**, gate disabled and visibly so | [ADR-015](../../docs/DECISIONS.md), CV-19 |
| Settlement "2-3 biz days via Rise" as the cadence anchor | Two legs: **instant wallet credit** is the anchor; 2 to 3 days applies to the **external** withdrawal only | [ADR-019](../../docs/DECISIONS.md) |
| Profit split "90/9" | **9000bp (90/10)**. The workbook's shorthand is a typo, not a third split | [GLOSSARY](../../docs/GLOSSARY.md) |

**When `mc_lifecycle.py` lands and is re-run, this table is the checklist**, and every row should either disappear or become a founder decision to change the corpus.

## The Risk Engine tab is the exception: it is current, and it is load bearing

`Risk Engine (VaR)` is the artifact behind the conservatism ruling ([DECISIONS](../../docs/DECISIONS.md)), and unlike the plans tab it says exactly what the corpus says. Its baseline is 500 signups per month, a 0.16 blended eval pass, 2.2 month average funded life, and a resulting **176 active funded accounts**.

**Monthly payout distribution by correlation, 20,000 simulations:**

| rho | Mean / mo | Std dev | VaR95 | VaR99 | **CVaR99** | CVaR99 / mean |
|---|---|---|---|---|---|---|
| 0.05 | $45,307 | $13,267 | $68,526 | $79,604 | $84,839 | 1.87x |
| 0.15 | $45,237 | $21,362 | $84,384 | $102,403 | $109,591 | 2.42x |
| **0.30** | $45,380 | $30,045 | $103,252 | $125,068 | **$132,897** | **2.93x** |

**The finding that justifies where conservatism lives: the tail is all correlation.** Mean payouts barely move across the rho column (about $45.3K throughout), while the 1-in-100 month nearly doubles, from $79.6K at rho = 0.05 to $125.1K at rho = 0.30. Copy trading, stacked accounts, and one-directional index days *are* the risk; average winner volume is not. That is why `rho = 0.30` is a named, reported input rather than a constant buried in the model, and it is why [M07](../../docs/plans/M07-risk-abuse.md)'s correlation detectors are a reserve control and not only an abuse control.

**The reserve rule, in the workbook's own words:** hold at least CVaR99 of monthly payouts, roughly **2.9x mean monthly payouts at rho = 0.30**, which is about **$135K ring-fenced from opex** at baseline scale. This replaces the industry's "3x average" heuristic and is the arithmetic behind the [RCR](../../docs/GLOSSARY.md#reserve-coverage-ratio-rcr) denominator.

**18-month ruin probability at rho = 0.30, 8,000 paths**, which is the regime-stress leg of the conservatism ruling:

| Scenario | $150K | $250K | $350K | $500K | What it models |
|---|---|---|---|---|---|
| base | 0.04% | 0 | 0 | 0 | Normal operations, correlated months only |
| rev_shock | 0.71% | 0.08% | 0.03% | 0 | Fees down 40% for months 7 to 12 (PSP freeze or sales slump) |
| juice_wave | 0.20% | 0.01% | 0 | 0 | Coordinated extraction: payout probability x1.5, severity x1.2, months 5 to 7 |
| **combined** | **6.28%** | **1.64%** | **0.36%** | **0.01%** | Both at once, the FTT/Thrive death pattern |

**Ruin comes from regimes, not from months.** No single bad month kills a funded book with positive drift; death is a persistent regime, and the two stressors together are an order of magnitude worse than either alone. $350K of starting capital holds combined-stress ruin near 0.4 percent while $150K runs above 6 percent. The insider "$300K to $500K reserves" benchmark is derived here rather than borrowed.

**Two model-risk notes the workbook records against itself**, both worth keeping because they are the sort of thing that is embarrassing to discover later:
- **Gaussian copulas have zero tail dependence**, which was the 2008 error. A t-copula at nu = 4 and rho = 0.15 lifts CVaR99 by roughly 5 percent. The workbook's own conclusion is that **rho = 0.30 Gaussian already dominates that stress**, so the reserve rule stands, but the reasoning is recorded rather than assumed.
- **A day-one rho estimator exists** and should replace the assumption with a measurement once live: beta-binomial overdispersion on daily percent-profitable, one column of arithmetic. `rho = 0.30` is a conservative prior, not a permanent input.

## The selection math, which belongs in the corpus and was not previously written down

The same tab derives why the business works at all, from published literature rather than from assumption. It is recorded here because three separate design decisions rest on it.

- **Base rate.** Chague, De-Losso and Giovannetti (N = 19,646 Brazilian futures day traders): 97 percent of persistent day traders lose net of fees, with a **negative** experience coefficient, meaning no learning effect. Barber and Odean's 15-year Taiwan study: under 1 percent persistently profitable. Durable edge in the population is roughly 1 to 3 percent.
- **An evaluation is a weak classifier.** A Sharpe-1.0 trader separates from a Sharpe-0 trader by only `d' = (1/sqrt(252)) * sqrt(10) = 0.20` sigma over a 10 day evaluation, an AUC of about 55.6 percent. **Pass rate is a price knob, not a quality filter**, and any copy that implies otherwise is a marketing-versus-implementation gap.
- **Who is actually funded.** With P(skilled) = 2 percent, P(pass | skilled) = 50 percent and P(pass | unskilled) = 14 percent, blended pass is 14.7 percent and **P(skilled | funded) = 6.8 percent**. Roughly 93 percent of the funded book has zero or negative true edge and will revert; the liability tail is the true 7 percent plus lucky streaks from the 93 percent.

**Three design implications, now derived rather than assumed:** funded time-gates (win days, cadence, consistency) work *because* they let the 93 percent revert before cash leaves, which is the honest defense of every gate in [M01](../../docs/plans/M01-rules-engine.md); the live program exists to remove the true 7 percent from the simulated book ([M18](../../docs/plans/M18-graduation-track.md)); and rebuy revenue is durable precisely because there is no learning effect, which is a fact to hold carefully next to [M17](../../docs/plans/M17-offers-engine.md)'s offer design and [M09](../../docs/plans/M09-marketing-site.md)'s honesty stance.

## Disclaimer carried from the workbook

It is a planning model, not financial, legal or tax advice. US futures-prop regulation is unsettled and the CFTC consultation closes 30 November 2026. Payout-reserve adequacy and registration posture are counsel items, and they are on the counsel packet in [STATE](../../docs/STATE.md).
