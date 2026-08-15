---
status: approved
depends_on: [README.md, ../../plans/M06-admin-ops-console.md, ../../plans/M07-risk-abuse.md, ../../plans/M05-payout-system.md, ../../testing/SIMULATION_HARNESS.md]
last_updated: 2026-08-14
---

# The weekly risk ritual

Constitution section 7: **a weekly risk ritual checklist page in admin (loss ratios, CUSUM, top-20 liabilities, flags, reserve)**.

**This is not an incident procedure.** It is the routine that keeps most of the runbooks from firing, and it is a page in the admin console rather than a document, so that it is completed rather than remembered. Completion is recorded, because a ritual with no record is a ritual that gets skipped in the weeks it matters most.

**Fifteen minutes, same time every week, whether or not anything looks wrong.** The value is entirely in the weeks where nothing does: that is what builds the sense of normal that makes an abnormal week visible.

## The checklist

### 1. Reserve

| Read | Look for |
|---|---|
| **Reserve coverage ratio** against **CVaR99 at `rho = 0.30`**, which is the **floor and never the estimate** | Anything below 1.2. The breaker is at 1.0 and it stops **sales**, never payouts, and arriving at it unprepared is the failure |
| **Eligible-Next-7-Days forecast**, per identity and in aggregate | A single identity contributing a large share. That is a correlated wave arriving, and the answer is liquidity and visibility rather than a payout block (GS-108) |
| **Wallet float**, reported separately from reserve | Float is excluded from reserve and reported apart (GS-229). A ratio that improved because float grew is a ratio that did not improve |
| Top-up trigger state | Whether it fired this week and whether it was actioned the same day ([ADR-011](../../decisions/ADR-011.md)) |

### 2. Liability

| Read | Look for |
|---|---|
| **The three liability numbers**, named separately and never conflated: open liability, bounded near-term liability, remaining ladder exposure | Any presentation that has merged two of them. GS-115 exists because conflating them is the precise failure that killed FTT |
| **Top 20 identities by liability** | New entrants, and anything that arrived fast |
| **Absorbed corrections total** | A trend, and any identity with a systematically favorable pattern, which is a flag rather than a number (OQ-10) |

### 3. Loss ratios and the breaker

| Read | Look for |
|---|---|
| **Loss ratio per plan**, with sample size | `insufficient_data` is a valid and important state. A ratio computed on a small sample is how a breaker fires falsely once and gets overridden forever after (GS-113) |
| **CUSUM** per plan against `mu_0` and `sigma` from the harness | A drift that has not yet tripped. That is the point of a CUSUM and reading it only when it trips wastes it |
| Breaker state, and any override | **Every override has an expiry.** An override with none is rejected, and one nearing expiry is a decision due (GS-117) |

### 4. Flags and detection

| Read | Look for |
|---|---|
| **Flags queue depth and age**, by severity | Aging severity 4+ items. Attention is the scarce resource an adversary attacks (GS-120) |
| **Detector health**: canaries found, precision, any auto-demoted detector | A detector that found none of its own canaries is `degraded`, and that is the only difference between a broken detector and a quiet night (GS-122) |
| **Identity graph**: new hard links, new soft-link clusters awaiting pre-funding review | Soft-link reviews are upstream of funding, so a backlog here is liability being created while the review waits |
| **Completed-ladder cohort** and its perk spend against budget | [M14](../../plans/M14-loyalty-retention.md) AS-M14-08. A fast-completing cohort is a ring cohort before it is a loyalty cohort |

### 5. Payouts and the promise

| Read | Look for |
|---|---|
| **Approval rate** | It should be 100 percent. There is no denial path, so anything else is a defect rather than a decision |
| **Freezes**: count, age, and any approaching expiry | A freeze reaching expiry **releases** (GS-109). The clock binds Merit, not the trader, and this row is where that gets honored |
| **Wallet-to-rail withdrawal times**, p50 and p95 | Against the published 2 to 3 business days. It is a published statistic (ST-06) and the week to find out it slipped is this one |
| **Balance-reflection checks** | Any `recon_blocked` account. Having paid and the account knowing it was paid are two claims, and the second is checked (GS-106) |

### 6. Alarms and suppressions

| Read | Look for |
|---|---|
| **Active suppressions**, with reason and expiry | Every suppression has a mandatory expiry and a written reason, and expiry restores automatically. Read the list anyway: "temporarily off" is a dated fact rather than a thing people tell themselves (GS-114) |
| **Alarms that fired and were not actioned** | The gap between firing and acting is the real alarm quality metric |
| **Dead-man switch state** across [CRON_INVENTORY](CRON_INVENTORY.md) | A job that stopped being scheduled. This is the only place anybody would notice |

## The two questions to end on

1. **What did I look at this week that I did not understand?** Write it down. It becomes an [EDGE_CASES](../../EDGE_CASES.md) entry or an investigation, and the ones that get skipped are the ones that were slightly boring.
2. **What would I want to have already checked, if the worst thing happened tomorrow?** If the answer is not on this list, add it.
