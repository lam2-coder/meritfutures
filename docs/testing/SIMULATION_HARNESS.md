---
status: draft
depends_on: [../plans/M01-rules-engine.md, ../DECISIONS.md, ../plans/M05-payout-system.md, ../plans/M06-admin-ops-console.md]
last_updated: 2026-08-14
---

# Simulation Harness

Monte-Carlo trader-population port spec and CI calibration bands. **Content is generated in Wave 4** (source spec: constitution section 5.3). This file currently records the inputs Wave 4 must build against, because three gate rulings changed them and a harness written against the old assumptions would be calibrated to a firm that no longer exists.

## The calibration source is version controlled

**`research/calibration/mc_lifecycle.py`, plus the business-model workbook, are the source of record** for every calibrated number in the corpus ([DECISIONS](../DECISIONS.md#the-calibration-source-becomes-version-controlled)). The founder commits both to this repository.

This closes a gap that has been load bearing since [ADR-015](../DECISIONS.md): plan parameters are sourced to `mc_lifecycle.py OUR_PLANS`, and until the file lives in the repository, "the source of record" is a filename rather than an artifact anyone can diff. Once committed, a parameter change is a reviewable diff against a versioned model.

**Wave 4 writes this document against that file, not against a description of it.** The port spec's job is to reproduce the model's population in a form the engine can be replayed over, and a port whose source is prose is a port that quietly diverges.

**Status as of 2026-08-14: the workbook has landed, the engine has not.** `research/calibration/futures_prop_firm_model.xlsx` is committed with a provenance [README](../../research/calibration/README.md). **`mc_lifecycle.py` is still outstanding**; the file uploaded alongside the workbook was an unrelated 12MB database dump and was not committed. The workbook is the *output*; without the engine, a parameter change is a diff against a spreadsheet rather than against the model that produced it, and the sensitivity sweeps cannot be re-run. [ADR-015](../DECISIONS.md) sources plan parameters to `mc_lifecycle.py OUR_PLANS` specifically, so that reference stays a citation until the file lands.

**The workbook's plans tab predates the M1 and batch 1 gates, and the corpus wins where they disagree.** Six known divergences are tabulated in the calibration README (the "Rapid Daily" name, 5 win days versus `w=3`, the disabled min-days gate, and the settlement anchor among them). **That table is this harness's first checklist**: when the engine lands and is re-run, every row should either disappear or become a deliberate founder decision to change the corpus. A harness ported from the workbook's plans tab as it stands today would model the pre-ADR-018 firm.

## Three things Wave 4 must not inherit from the old assumptions

### 1. Conservatism was relocated, and the harness must report it that way

[ADR-013](../DECISIONS.md) recorded that the founder's lifecycle simulation was **basis anchored**, which made realized liability under the settlement anchor *at most* the modeled figure. The corpus carried that gap as a safety cushion. **[ADR-019](../DECISIONS.md) moved the cadence anchor back to the basis day**, so the model and the system are anchored the same way and the accidental cushion is gone.

**It was relocated rather than lost** (founder ruling, [DECISIONS](../DECISIONS.md)), and the relocation is a requirement on this harness rather than a note about it:

| Output | What it is | How the harness must report it |
|---|---|---|
| Calibration bands, RE-S-01's included | **Central estimates** | Labeled as central. No cushion is implied and none may be described |
| **`rho = 0.30`** correlation assumption | Where correlation conservatism lives | A **named, reported input**, not a constant buried in the model. Traders do not act independently and the reserve is sized against a book that assumes they do not |
| **Regime-stress ruin scenarios** | Where tail conservatism lives | Run as explicit adverse regimes rather than left for the distribution to imply |
| **`CVaR99 at rho = 0.30`** | **The reserve floor** | Emitted as a **distinct output from the central estimate**, named so the two cannot be confused downstream |

**The workbook already computes all three, and the numbers are worth carrying here rather than only in the source.** At the baseline scale of 176 active funded accounts, monthly payouts have a mean near **$45.3K at every correlation level**, while CVaR99 runs **$84.8K at rho = 0.05, $109.6K at rho = 0.15, and $132.9K at rho = 0.30**. The mean barely moves and the tail nearly doubles: **the tail is all correlation.** The reserve rule that follows is "hold at least CVaR99 of monthly payouts", roughly **2.9x the mean at rho = 0.30**, about **$135K ring-fenced from opex** at baseline. Regime stress is the second leg: combined revenue-shock plus extraction-wave ruin over 18 months runs **6.3 percent at $150K of capital and 0.36 percent at $350K**, which is where the industry's "$300K to $500K" benchmark comes from once it is derived instead of repeated.

**The sentence this harness exists to make true: `CVaR99 at rho = 0.30` is the reserve floor, never the estimate.** Both numbers come out of the same run and would otherwise be quoted with the same name, which is exactly how a firm ends up sizing its payout wallet against the middle of a distribution. The RCR's denominator is the floor ([M06](../plans/M06-admin-ops-console.md) P-M6-07), and the harness reporting them as one number would silently break that.

**Why the relocation is an improvement rather than a repair.** An accidental margin is not a control: nobody knows its size, nobody reviews it, and it vanishes the moment an unrelated decision changes an assumption, which is precisely what happened. Three named, sized, reviewable places are each arguable on their own terms in the C8 retro. One unmeasured cushion is not.

### 2. Cycle lengths changed on every plan, and the compression was intended

[ADR-018](../DECISIONS.md) set Merit Rapid to 3 win days and [ADR-019](../DECISIONS.md) moved the anchor. [M01 AS-03](../plans/M01-rules-engine.md) carries the re-derived arithmetic. The population port must use the current cycle lengths (Core EOD and Direct at **5 trading days**, Merit Rapid at **3**), because a harness that models the old 7 to 8 day Core cycle will under-produce extraction by roughly 40 percent and will report a reserve that looks comfortable.

**Confirmed at the batch 1 gate: the lineup-wide compression is by design, not a side effect.** Wallet-instant credit applies to every plan, and Core EOD's and Direct's economics under a 5 day cycle **equal the original simulation calibration**, which was basis anchored throughout. The harness is therefore not being asked to model something new here; it is being asked to stop modelling a settlement lag the system no longer has.

### 3. The wallet splits liability from cash

Under [ADR-019](../DECISIONS.md) a payout credits an internal wallet instantly and cash leaves only on a separate external withdrawal. The harness therefore needs **two distributions where it previously needed one**:

- **Liability**, which is deterministic from the gates and is what the engine produces. Unchanged in kind.
- **External withdrawal demand**, which depends on trader behavior: how much of a wallet balance is withdrawn, how quickly, and how much is spent internally on resets instead.

The second is a **harder** estimate than the first, not an easier one, and it is the one the payout wallet is actually funded against ([M06](../plans/M06-admin-ops-console.md) P-M6-07). At launch there is no data for it. The honest approach is to model the pessimistic case (every trader withdraws everything immediately, which reduces to the pre-wallet behavior) as the funding baseline, and to treat any float the wallet actually produces as realized upside rather than as a planning assumption.

## The per-day ceiling of record (settled 2026-08-14)

**Merit Rapid's per-day extraction ceiling is $300** (30,000 cents) at 50K: a 100,000c cap, a 9000bp split, a 3 trading day cycle.

This was briefly recorded as approximately $240 and flagged as an open reconciliation. It is settled: **the $240 figure was settlement-anchored commentary predating [ADR-019](../DECISIONS.md)**, and the `w=3` simulation calibration was **basis anchored and already contained the 3 trading day cycle**. The correction is to a stale annotation and **carries no economic change**: the recalibrated unit economics ($889 firm dollars per funded account, 48.1 percent funded-to-payout, 2.09 payouts per payer, roughly 18 percent margin) were produced under the 3 day cycle and stand as recorded.

**What the harness owes here is a check, not a reconciliation.** When the population is ported, the modelled per-day extraction at the ceiling should reproduce 30,000 cents on Merit Rapid and 27,000 on Core EOD and Direct. A divergence is now a harness bug rather than an open question, which is the useful state for it to be in.

**A second check the committed workbook makes possible.** Its `Our Firm - Plans` tab reports modelled firm dollars per funded account of **$698 on Core EOD, $800 on Rapid, and $206 on Direct** at the pre-`w=3` parameters. [ADR-018](../DECISIONS.md)'s recalibration reports **$889** at `w=3`. Those are not in conflict (different parameters, and the ADR figure is the later run), but the port should reproduce the older numbers from the older parameters before it is trusted on the newer ones. **Reproducing a superseded result from superseded inputs is the cheapest available proof that the port is faithful**, and it is available exactly once, while both sets of numbers still exist.

## The population's prior is derived, not assumed

The workbook's selection math ([calibration README](../../research/calibration/README.md)) fixes the trader-skill prior this harness must port, and it is derived from published literature rather than chosen: durable edge in the population is roughly **1 to 3 percent** (Chague et al., N = 19,646, with a **negative** experience coefficient; Barber and Odean's Taiwan study agrees under 1 percent), a 10 day evaluation separates Sharpe-1.0 from Sharpe-0 by only **0.20 sigma (AUC 55.6 percent)**, and the Bayesian result is **P(skilled | funded) = 6.8 percent**.

**Three things follow, and the harness must not flatten any of them.** Roughly 93 percent of the funded book has zero or negative true edge and will revert, so the liability tail is the true 7 percent **plus lucky streaks from the 93 percent**, and a harness that models only skilled winners will under-produce the tail. **Pass rate is a price knob, not a quality filter**, so sweeping it changes volume and liability rather than book quality. And there is **no learning effect**, so a reverted trader who rebuys does not come back stronger, which is what makes rebuy revenue durable and is also the fact [M09](../plans/M09-marketing-site.md)'s honesty stance has to sit next to.

## What Wave 4 still owes

Per constitution 5.3 and the dependencies other plans have already declared on this document:

| Deliverable | Who is waiting |
|---|---|
| **`CVaR99 at rho = 0.30`** (the reserve floor) **and** the central estimate, reported separately, modelling peak-picking and correlated identity waves | [M05](../plans/M05-payout-system.md) DEP-M5-06, OQ-M5-05's threshold, [M06](../plans/M06-admin-ops-console.md) P-M6-07's denominator |
| Regime-stress ruin scenarios as explicit adverse regimes | The conservatism ruling ([DECISIONS](../DECISIONS.md)) |
| CUSUM `mu_0` and `sigma` per plan | [M06](../plans/M06-admin-ops-console.md) DEP-M6-05, FM-M6-07 |
| RE-S-01 calibration bands | [M01](../plans/M01-rules-engine.md) section 8.3 |
| The labelled fixture population for detector precision | [M07](../plans/M07-risk-abuse.md) section 8 |
| Synthetic-population output routed to `test-results/`, never to the production database and never into an agent's context | [INFRA](../architecture/INFRA.md) section 9 |
