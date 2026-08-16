# FREEZE gate closure (2026-08-14)

The founder ruled every open item and granted the sign-offs. **The corpus is FROZEN.** This section records the gate; each ruling is folded into the documents it touches.

## Architecture decision records closed at this gate

- [ADR-026](../ADR-026.md): The schema-delta reconciliation, and the count correction  (2026-08-14, status: accepted)
- [ADR-027](../ADR-027.md): `trader_withdrawable` and `trader_wallet` are two distinct positions  (2026-08-14, status: accepted, **reversing an earlier ruling in this same session**)
- [ADR-028](../ADR-028.md): `payout_requests.status` under the wallet  (2026-08-14, status: accepted)
- [ADR-029](../ADR-029.md): `dedupe_matches` is the authoritative hard link  (2026-08-14, status: accepted)
- [ADR-030](../ADR-030.md): Plan-config key names are `max_payouts` and `kyc.triggers`  (2026-08-14, status: accepted)
- [ADR-031](../ADR-031.md): The published statistic is `bigint` with a unit, and its no-floats exemption is retired  (2026-08-14, status: accepted)
- [ADR-032](../ADR-032.md): `measure` on `published_statistics`, and the pair invariant as DDL  (2026-08-14, status: accepted)
- [ADR-033](../ADR-033.md): The reviewer subagent is a citation check, not an adversarial one  (2026-08-14, status: proposed)
- [ADR-034](../ADR-034.md): ADR numbers are allocated, not guessed, and no document states a derivable count  (2026-08-14, status: accepted)
- [ADR-035](../ADR-035.md): `0027`'s published-plan-version immutability trigger reads a column that does not exist  (2026-08-15, status: accepted)
- [ADR-036](../ADR-036.md): Migration numbers are allocated, not guessed, and the allocation gate lives where the number set already lives  (2026-08-15, status: proposed)
- [ADR-037](../ADR-037.md): A shorthand may not restate a value the config owns  (2026-08-15, status: accepted)
- [ADR-038](../ADR-038.md): A CI stage states, in its own output, what it currently proves  (2026-08-15, status: accepted)
- [ADR-039](../ADR-039.md): Auth is passkeys plus email OTP plus SMS OTP, and a verified phone is an identity signal  (2026-08-15, status: accepted)
- [ADR-040](../ADR-040.md): The payout enforcement window, and zero denial expressed as a state that expires  (2026-08-15, status: accepted)
- [ADR-041](../ADR-041.md): Identity-level restriction is `restricted`, and this is its enforcement surface  (2026-08-15, status: accepted)
- [ADR-042](../ADR-042.md): The trading calendar is transcribed from the exchange, and Merit computes nothing in business days  (2026-08-15, status: accepted)

## OQ-FREEZE-01: the loyalty perk's credit class

**The implementation is CONFIRMED and [ADR-025](../ADR-025.md)'s literal wording is OVERRULED.** The cross-account loyalty perk is `promotional_credit`, rendered inside the wallet screen and **never withdrawable**. The ADR's phrase "bonus wallet credit", read literally, would have breached INV-M14-10, [M20](../../plans/M20-wallet.md) INV-M20-03 and INV-M20-11, `INV-WALLET-NO-DEPOSITS`, and [M17](../../plans/M17-offers-engine.md) INV-M17-08, and would have handed an attacker a laundering path that does not require passing an evaluation.

**Recorded because it is the most useful thing that happened at this gate: the invariant guard caught a founder-guide wording error, and the author raised it rather than implementing it.** That is the review system working as designed. The corpus's standing rule is that a session asks when the constitution is ambiguous and proposes an ADR when it is silent. This was a third case, **an instruction that was clear and wrong**, and the correct response was to implement the intent, flag the conflict, and put it in front of the founder as a named question rather than either obeying the words or quietly substituting a judgment. **A closed check constraint is a good place to discover a wording error, because it is the one kind of specification that cannot be talked past.**

## OQ-FREEZE-02: the branch-workflow conflict, amending ADR-D1

**[ADR-D1](../ADR-D1.md) is amended. Corpus single-trunk is achieved via immediate pull-request merge rather than by direct commit alone.**

| Session origin | Workflow |
|---|---|
| **Harness-launched** (web, mobile, or any designated-branch instruction) | Runs its designated branch. **Must end mergeable.** The founder merges **same day** |
| **Local** | Commits **direct to `main`**, unchanged |

**Why this rather than picking a side.** The single-trunk rule exists because a commit living in one container is a commit about to be lost, and a long-lived branch is a merge conflict with a delay fuse. **A branch merged the same day is neither of those things.** The harness's branch default is not going to stop asserting itself, so a rule forbidding it would be broken on every web-launched session and would then be ignored, which is worse than a rule that accommodates it and keeps the merge window short. **PR #2 is merged.**

## Sign-offs granted

| Item | Ruling |
|---|---|
| **Wave 3 batch 2** (M09 to M20) | **APPROVED** |
| **Wave 4** (18 new documents, 5 placeholders retired, 3 rewrites) | **APPROVED** |
| **Plan parameters** | **CONFIRMED as launch candidates**, re-confirmed at launch as config per the standing [parameter-status ruling](#) |
| **Direct's ladder** | **4** |
| **KYC trigger set** | **`{second_distinct_account + pre_funded}`, earliest fires** |
| **M12 sign-off table** | **APPROVED, including S-16** |

### Direct's ladder is 4

**The rationale is a risk argument, not an economic one.** Direct skips the evaluation entirely, so **its funded population carries the unselected base rate of skill**. Every other plan's funded book has passed a filter; Direct's has passed nothing. The [calibration source](../../../research/calibration/README.md)'s own selection math makes this decisive: an evaluation is a weak classifier, but a weak classifier is not a useless one, and removing it leaves a population at the base rate, where durable edge is 1 to 3 percent and the **per-account tail is heaviest**. **The shortest ladder belongs on the least-filtered plan.**

**Lifetime to trader at 50K: 4 x 135,000c = 540,000c ($5,400).** Margin intact, confirmed exactly in the recalibration below.

### The KYC trigger set is `{second_distinct_account + pre_funded}`

**The fleet-coverage argument prevails.** [ADR-021](../ADR-021.md) framed the choice as `{pre_funded always}` versus this one, and AS-M19-01's finding decides it: `pre_funded` alone leaves roughly 85 percent of buyers outside the biometric dedupe corpus, and fleet operators are disproportionately inside that 85 percent because they are serial buyers who mostly do not pass evaluations. **`second_distinct_account_purchase` captures their faces early, at a cost paid only by people who have already bought twice.**

**Telemetry adjudicates post-beta.** The per-trigger funnel instrumentation and the corpus-coverage floor exist so this is revisited against data rather than re-argued. The trigger set is a config array and changing it is not an engine change.

### M12's sign-off table is approved, including S-16

**S-16 commits Merit to publishing whatever the first published number says.** No soft launch, no holding the page until the figures flatter, no "we will publish once the sample is meaningful" that quietly becomes never.

**The rationale, recorded because it will be tempting to revisit on a bad month: a stats page with an escape hatch is marketing, and Merit built the version without one.** The entire value of a transparency surface is that it was committed to before anyone knew what it would say. A page that publishes only favorable numbers is not a transparency page having a bad quarter; it is an advertisement that was always going to be one, and every reader who matters can tell the difference.

## The calibration engine landed, and the corpus is recalibrated against it

`research/calibration/mc_lifecycle.py` (546 lines) is committed. **Every "at least" and "conservative rather than exact" annotation in the corpus is now replaced with a measured value.** The engine was run at the corpus's actual configuration; the runs and the checklist are recorded in [SIMULATION_HARNESS section 8](../../testing/SIMULATION_HARNESS.md).

### The reproduction check passed

Running the engine **as committed**, against its own `OUR_PLANS`, reproduces the workbook's plans tab: **$690.44 firm dollars per funded account on Core EOD** against the workbook's $698, **$829.36 on Rapid** against $800, **$207.33 on Direct** against $206. The **portfolio risk engine reproduces the [calibration README](../../../research/calibration/README.md)'s table exactly**, to the cent: CVaR99 at rho = 0.30 is **$132,896.71**, the multiple is **2.9285x**, and every one of the twenty ruin cells matches. **Reproducing a superseded result from superseded inputs was the cheapest available proof that the port is faithful, and it was available exactly once.** It is now spent, and it passed.

### Exact recalibrated figures, at the corpus configuration

`w=3` on Merit Rapid, funded `min_trading_days = 0` on all three plans, ladder **5 / 5 / 4**:

| Plan | Eval pass | Funded to payout | **Firm $ per funded (50K)** | Payouts per payer | Contribution margin |
|---|---|---|---|---|---|
| Core EOD | 26.53% | 33.46% | **$690.44** | 1.54 | **+0.25%** |
| **Merit Rapid** | 16.55% | **48.11%** | **$904.07** | **2.13** | **16.9%** |
| Direct | 100% | 12.07% | **$207.33** | 1.30 | **39.2%** |

**[ADR-018](../ADR-018.md) recorded $889, 48.1 percent, 2.09 payouts per payer, and roughly 18 percent margin.** The exact figures are **$904.07, 48.11 percent, 2.13, and 16.9 percent**. The funnel figure matches to two decimal places; firm cost is 1.7 percent higher and margin 1.1 points lower than the round numbers carried since. **The direction is mildly unfavorable and the magnitude is immaterial**, which is the outcome a decision made on round numbers is entitled to hope for and not entitled to assume. Merit Rapid remains the lineup's margin engine at 16.9 percent.

### The finding this run produced, which is not what anyone expected

**Shortening the ladder changed the modeled firm cost by exactly nothing on Core EOD and Direct.** The two configurations, ladder 8 and 6 against ladder 5 and 4, return **identical figures to every decimal place**. The reason is visible in the table above: **mean payouts per payer are 1.54, 2.13 and 1.30, nowhere near any ladder length under discussion.** The average account never reaches rung 4, let alone rung 8.

**So [ADR-024](../ADR-024.md) and Direct's ladder of 4 are margin-neutral in the central estimate, and their entire value is tail protection.** That is a stronger statement than "margin intact", and it is the one to carry:

- **The claim "liability is monotone-decreasing in `max_payouts`" is confirmed and is nearly vacuous at the mean.** The ladder does not bind the average account. It binds the account that keeps winning, which is precisely the account a reserve model must survive.
- **A ladder is a tail control priced at zero in the central case.** Shortening it costs nothing that shows up in a margin table and removes the far right of the distribution, which is where correlated groups and undetected rings live. The [risk engine's](../../../research/calibration/README.md) own conclusion points the same way: the tail is all correlation and the mean is flat.
- **The corollary is a warning.** Because the ladder never binds on the average account, **no margin table will ever show its value**, and a future review looking only at unit economics will find it costless in both directions and may conclude it can be lengthened for free. It cannot. INV-17 is the assertion, and this paragraph is the reason.

### The six-divergence checklist, run

| # | README divergence | Engine says | Outcome |
|---|---|---|---|
| 1 | "Rapid Daily" versus Merit Rapid | `'Rapid Daily (eval)'` | **Confirmed stale.** Corpus wins ([ADR-013](../ADR-013.md)) |
| 2 | 5 win days versus `w=3` | `winning_days=5` | **Confirmed stale, and it means the committed engine predates the founder's own `w=3` re-run.** The re-run happened; it was never saved back. Corpus wins ([ADR-018](../ADR-018.md)) |
| 3 | Rapid cadence gap 1 | `payout_gap=1` | **Agrees.** No divergence |
| 4 | Funded minimum days | Core `min_days=0`, **Rapid `min_days=5`, Direct `min_days=5`** | **A seventh divergence, not in the README's six.** Corpus is 0 on all three ([ADR-015](../ADR-015.md)) and the engine carries 5 on two plans. It is dominated by the win-day gate in both cases, so it changes nothing, which is exactly why nobody noticed |
| 5 | Settlement anchor | Not modelled; the engine has `payout_gap` only | **Not applicable.** The anchor is a corpus-level semantic the model does not represent |
| 6 | Split "90/9" | `split=0.90` | **Resolved as a workbook display typo.** The engine has always been correct |
| 7 | Ladder 8 / 8 / 6 | `max_payouts=8, 8, 6` | **Confirmed stale.** Corpus is 5 / 5 / 4 ([ADR-024](../ADR-024.md) and this gate) |

**Four confirmed stale, one agreement, one not applicable, one resolved as a typo, and one new.** The corpus won every contested row, which is the result the README predicted and the reason it was written before the engine arrived.

**The engine is now the source of record and it is stale in four places.** That is recorded rather than fixed here: **re-running it at the corpus configuration is a build-phase task**, listed in [SIMULATION_HARNESS section 8](../../testing/SIMULATION_HARNESS.md), and it must produce the table above before any CI calibration band is set from it.


---
