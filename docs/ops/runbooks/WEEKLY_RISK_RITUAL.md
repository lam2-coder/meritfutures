---
status: approved
depends_on: [README.md, ../../plans/M06-admin-ops-console.md, ../../plans/M07-risk-abuse.md, ../../plans/M05-payout-system.md, ../../decisions/ADR-066.md, ../../testing/SIMULATION_HARNESS.md]
last_updated: 2026-08-20
---

# The weekly risk ritual

Constitution section 7: **a weekly risk ritual checklist page in admin (loss ratios, CUSUM, top-20 liabilities, flags, reserve)**.

**This is not an incident procedure.** It is the routine that keeps most of the runbooks from firing, and it is a page in the admin console rather than a document, so that it is completed rather than remembered. Completion is recorded, because a ritual with no record is a ritual that gets skipped in the weeks it matters most.

**Fifteen minutes, same time every week, whether or not anything looks wrong.** The value is entirely in the weeks where nothing does: that is what builds the sense of normal that makes an abnormal week visible.

## The input is a delivered digest, not a remembered login

**[ADR-066](../../decisions/ADR-066.md) section 3, [M06](../../plans/M06-admin-ops-console.md) section 3.6.** Two scheduled digests are this ritual's input and both are sized **MUST** for that reason and no other: the **daily liability** digest (Open Liability, Eligible-Next-7-Days, and the reserve coverage ratio against a live rail balance) and the **weekly plan loss-ratio and CUSUM** digest. They carry sections 1, 2 and 3 below into an inbox on the day they are computed.

**Until they exist, this ritual's input is a human remembering to look**, which is the thing constitution 0 lists first among the named causes of death. A control that exists and does not arrive enforces nothing.

**So step zero is to check that the digest arrived, and it is checked against the delivery record rather than against a job's report.** [`report_deliveries`](../../architecture/data-model/report_deliveries.md) carries one row per delivery attempt with its outcome, and the alarm is an enabled schedule whose window closed with no `delivered` row. This is [M05](../../plans/M05-payout-system.md) `INV-M5-18`'s construction on a second sweep: **a job that reports success is not evidence that the work happened**. If the digest is in the inbox, the ritual is already half done; if it is not, that absence is the first finding of the week.

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
| **Digest deliveries**, from [`report_deliveries`](../../architecture/data-model/report_deliveries.md) rather than from the job | Any window with no `delivered` row, and any attempt that **degraded to fewer recipients**: the omission carries its reason, and a recipient quietly dropped is how this ritual stops reaching the person who acts on it ([M06](../../plans/M06-admin-ops-console.md) section 3.6) |

## The two questions to end on

1. **What did I look at this week that I did not understand?** Write it down. It becomes an [EDGE_CASES](../../edge-cases/README.md) entry or an investigation, and the ones that get skipped are the ones that were slightly boring.
2. **What would I want to have already checked, if the worst thing happened tomorrow?** If the answer is not on this list, add it.
