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

## Three things Wave 4 must not inherit from the old assumptions

### 1. The conservatism margin is gone

[ADR-013](../DECISIONS.md) recorded that the founder's lifecycle simulation was **basis anchored**, which made realized liability under the settlement anchor *at most* the modeled figure. The corpus then carried that gap as a safety cushion.

**[ADR-019](../DECISIONS.md) moved the cadence anchor back to the basis day** (the wallet-credit day). The model is now anchored the same way the system is. That does not invalidate the model; it **spends the margin**. Realized liability now tracks the modeled figure instead of sitting below it.

**Consequence, and it must be stated wherever a reserve number is quoted:** CVaR99 and RE-S-01's calibration bands are **central estimates with no built-in cushion** from here on. Anyone sizing the payout wallet against them is sizing against the middle of a distribution, not against a conservative read of it. If a cushion is wanted, it has to be added deliberately and priced, rather than inherited from an anchoring mismatch nobody chose.

### 2. Cycle lengths changed on every plan

[ADR-018](../DECISIONS.md) set Merit Rapid to 3 win days and [ADR-019](../DECISIONS.md) moved the anchor. [M01 AS-03](../plans/M01-rules-engine.md) carries the re-derived arithmetic. The population port must use the current cycle lengths (Core EOD and Direct at 5 trading days, Merit Rapid at 3), because a harness that models the old 7 to 8 day Core cycle will under-produce extraction by roughly 40 percent and will report a reserve that looks comfortable.

### 3. The wallet splits liability from cash

Under [ADR-019](../DECISIONS.md) a payout credits an internal wallet instantly and cash leaves only on a separate external withdrawal. The harness therefore needs **two distributions where it previously needed one**:

- **Liability**, which is deterministic from the gates and is what the engine produces. Unchanged in kind.
- **External withdrawal demand**, which depends on trader behavior: how much of a wallet balance is withdrawn, how quickly, and how much is spent internally on resets instead.

The second is a **harder** estimate than the first, not an easier one, and it is the one the payout wallet is actually funded against ([M06](../plans/M06-admin-ops-console.md) P-M6-07). At launch there is no data for it. The honest approach is to model the pessimistic case (every trader withdraws everything immediately, which reduces to the pre-wallet behavior) as the funding baseline, and to treat any float the wallet actually produces as realized upside rather than as a planning assumption.

## The open reconciliation this harness settles first

**[ADR-018](../DECISIONS.md) records a per-day extraction ceiling of approximately $240 (24,000 cents). The published Merit Rapid parameters imply 30,000 cents**: a 100,000c cap at 50K, a 9000bp split, and a 3 trading day cycle. The two differ by roughly 25 percent, in the direction where the model understates extraction.

Neither number has been silently preferred anywhere in the corpus. **The $240 figure is the number of record until `mc_lifecycle.py` is committed**, at which point the arithmetic is checked against the model and one of them is corrected in writing. This is the first thing this harness settles, and it is the concrete reason the calibration source needed to be in version control rather than described.

## What Wave 4 still owes

Per constitution 5.3 and the dependencies other plans have already declared on this document:

| Deliverable | Who is waiting |
|---|---|
| CVaR99 estimate modelling peak-picking and correlated identity waves | [M05](../plans/M05-payout-system.md) DEP-M5-06, OQ-M5-05's threshold |
| CUSUM `mu_0` and `sigma` per plan | [M06](../plans/M06-admin-ops-console.md) DEP-M6-05, FM-M6-07 |
| RE-S-01 calibration bands | [M01](../plans/M01-rules-engine.md) section 8.3 |
| The labelled fixture population for detector precision | [M07](../plans/M07-risk-abuse.md) section 8 |
| Synthetic-population output routed to `test-results/`, never to the production database and never into an agent's context | [INFRA](../architecture/INFRA.md) section 9 |
