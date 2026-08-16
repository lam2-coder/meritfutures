---
status: approved
depends_on: [../plans/M01-rules-engine.md, ../testing/golden-scenarios/README.md, ../GLOSSARY.md, ../decisions/README.md]
last_updated: 2026-08-15
---

# EDGE CASES (living registry)

Every discovered edge case and (post-FREEZE) every bug becomes a numbered entry here plus a golden file in [docs/testing/GOLDEN_SCENARIOS.md](../testing/golden-scenarios/README.md). Never delete entries; supersede them. Entry format:

```
## EC-NNN: <one-line name>  (YYYY-MM-DD, module: Mx, status: open | specced | tested)
- Scenario:
- Correct behavior (with the deciding rule and comparison operators spelled out):
- Golden scenario ref:
```

Seed sources: constitution M1 edge-case list, Appendix B4 battery (22 scenarios), Appendix A adversary taxonomy. **Seeded in Wave 3 by [M01](../plans/M01-rules-engine.md).** `status: specced` means the behavior is decided and written down; it becomes `tested` when the golden file exists and passes in CI, which cannot happen before FREEZE.

Numbering blocks: EC-001 to EC-011 are the constitution's own M1 list, EC-012 to EC-033 are the B4 battery in order (`EC-(011 + n)` is B4 item `n`), EC-034 upward are discovered during the build. **EC-083 to EC-138 were added by Wave 3 batch 2 (M09 through M20)** and carry those plans' `review` status. **EC-139 and EC-140 were added by [ADR-025](../decisions/ADR-025.md) at the pre-Wave-4 fold.** The registry now holds <!--gen:ec_count-->141<!--/gen--> entries, a generated span under [CI-06g](../testing/STRATEGY.md) since this line stated a hand-maintained count and [ADR-034](../decisions/ADR-034.md) is what that class ends.

**EC-141 is the first post-FREEZE entry and the first written against the build rather than against the corpus.** The registry's own preamble says every discovered edge case **and, post-FREEZE, every bug** becomes an entry here, and EC-141 is neither: it is an **ambiguity between two frozen documents**, found by the first session that had to implement against both. That is a third kind and it belongs here for the reason the other two do, which is that it is otherwise rediscovered by every reader in turn.

**Two entries were amended rather than added at that fold, and the numbers are worth stating because the ruling as delivered cited different ones.** [EC-104](EC-104.md) is the progressive-cap-release entry (M14) and records the rejection. [EC-122](EC-122.md) is the ladder-finiteness entry (M18) and records the countdown-tracker and same-breath-continuation confirmation. **EC-136 and EC-137 are Merit Wallet entries and are untouched by that ruling.** The mis-citation is inherited from [ADR-024](../decisions/ADR-024.md), which cited EC-137 for the finiteness finding; that citation is corrected in place.

---

Split to a file per entry on 2026-08-15 by [ADR-043](../decisions/ADR-043.md). The
Appendix B4 battery stays one file because it is 22 table rows mapping B4 items to
edge cases and golden scenarios, and a row is not a document.

## Entries

| EC | Name |
|---|---|
| [EC-001](EC-001.md) | Rounding and comparison operators are per rule, never implied  (2026-08-13, module: M1, status: specced) |
| [EC-002](EC-002.md) | Consistency with a zero or negative denominator  (2026-08-13, module: M1, status: specced) |
| [EC-003](EC-003.md) | Win day exactly at the floor  (2026-08-13, module: M1, status: specced) |
| [EC-004](EC-004.md) | Breach and pass signals on the same day  (2026-08-13, module: M1, status: specced) |
| [EC-005](EC-005.md) | Trading-calendar half days  (2026-08-13, module: M1, status: specced) |
| [EC-006](EC-006.md) | Account with fills but flat P&L  (2026-08-13, module: M1, status: specced) |
| [EC-007](EC-007.md) | Payout request landing mid nightly batch  (2026-08-13, module: M1 + M5, status: specced) |
| [EC-008](EC-008.md) | Cap greater than withdrawable  (2026-08-13, module: M1, status: specced) |
| [EC-009](EC-009.md) | Multiple accounts, same identity, requesting the same day  (2026-08-13, module: M1 + M5 + M6, status: specced) |
| [EC-010](EC-010.md) | Config migration never touches existing accounts  (2026-08-13, module: M1 + M3, status: specced) |
| [EC-011](EC-011.md) | Replay determinism  (2026-08-13, module: M1, status: specced) |
| [EC-012 to EC-033](EC-012-to-033-appendix-b4-battery.md) | the Appendix B4 battery, 22 rows in one table |
| [EC-034](EC-034.md) | A settled payout looks like a catastrophic loss  (2026-08-13, module: M1 + M2, status: specced) |
| [EC-035](EC-035.md) | Comparing the day's low against the floor after trailing it  (2026-08-13, module: M1, status: specced) |
| [EC-036](EC-036.md) | Eligibility is not monotone in profit  (2026-08-13, module: M1, status: specced) |
| [EC-037](EC-037.md) | A failed transfer consumes a ladder rung  (2026-08-13, module: M1 + M5, status: specced) |
| [EC-038](EC-038.md) | Split rounding direction  (2026-08-13, module: M1 + M5, status: specced) |
| [EC-039](EC-039.md) | The cadence anchor changes the published extraction ceiling  (2026-08-13, module: M1, status: specced) |
| [EC-040](EC-040.md) | Payout stacking inside the settlement window  (2026-08-13, module: M1 + M5, status: specced) |
| [EC-041](EC-041.md) | The funded account does not start at the account size  (2026-08-13, module: M1 + M2, status: specced) |
| [EC-042](EC-042.md) | Minimum trading days is dominated by the win-day gate  (2026-08-13, module: M1, status: specced) |
| [EC-043](EC-043.md) | Zero-risk day farming  (2026-08-13, module: M1 + M7, status: specced) |
| [EC-044](EC-044.md) | An engine upgrade pages on every historical row  (2026-08-13, module: M1, status: specced) |
| [EC-045](EC-045.md) | Consistency period off-by-one at the settlement boundary  (2026-08-13, module: M1, status: specced) |
| [EC-046](EC-046.md) | Holiday clusters stretch and compress the gap in calendar time  (2026-08-13, module: M1, status: specced) |
| [EC-047](EC-047.md) | A trading day with no mark at all  (2026-08-13, module: M1 + M2, status: specced) |

## Entries discovered at the M1 gate (2026-08-13)

The three below were produced by the founder's rulings rather than by drafting. Per the constitution's working agreements, a discovered gap becomes an entry here even when the gap was created by a decision that was correct.

| EC | Name |
|---|---|
| [EC-048](EC-048.md) | Removing the post-payout floor reset creates a config that pays an account into a breach  (2026-08-13, module: M1, status: specced) |
| [EC-049](EC-049.md) | The cadence gap can be dominated by the win-day gate, and the two gates use different anchors  (2026-08-13, module: M1 + M9, status: specced) |
| [EC-050](EC-050.md) | A gate configured to zero is indistinguishable from a gate that passed  (2026-08-13, module: M1 + M4, status: specced) |

## Entries from M02 (Rithmic bridge)

| EC | Name |
|---|---|
| [EC-051](EC-051.md) | A balance movement that is neither trading nor a known settlement  (2026-08-13, module: M2 + M5, status: specced) |
| [EC-052](EC-052.md) | A redelivered file that is not byte-identical and carries no correction markers  (2026-08-13, module: M2, status: specced) |
| [EC-053](EC-053.md) | A recycled platform account reference  (2026-08-13, module: M2, status: specced) |
| [EC-054](EC-054.md) | A risk setpoint that was delivered but never applied  (2026-08-13, module: M2 + M6, status: specced) |
| [EC-055](EC-055.md) | Entitlement hygiene disabling an account that is still trading  (2026-08-13, module: M2, status: specced) |
| [EC-056](EC-056.md) | The vendor's session date disagrees with our calendar  (2026-08-13, module: M2, status: specced) |

## Entries from M03 (billing and checkout)

| EC | Name |
|---|---|
| [EC-057](EC-057.md) | A refund taken before any trade, repeatedly, as free optionality  (2026-08-13, module: M3 + M7, status: specced) |
| [EC-058](EC-058.md) | Failover double-charges one purchase across two MIDs  (2026-08-13, module: M3, status: specced) |
| [EC-059](EC-059.md) | A leaked coupon code silently reprices resets forever  (2026-08-13, module: M3, status: specced) |
| [EC-060](EC-060.md) | A reset silently moves a trader onto rules they never agreed to  (2026-08-13, module: M3 + M4, status: specced) |
| [EC-061](EC-061.md) | A payment event that Merit never originated  (2026-08-13, module: M3, status: specced) |

## Entries from M04 (trader portal)

| EC | Name |
|---|---|
| [EC-062](EC-062.md) | The payable amount changes between the dashboard render and the tap  (2026-08-13, module: M4 + M5, status: specced) |
| [EC-063](EC-063.md) | A share certificate the firm cannot verify  (2026-08-13, module: M4 + M11, status: specced) |
| [EC-064](EC-064.md) | The breach screen is the highest-yield dark-pattern surface in the product  (2026-08-13, module: M4, status: specced) |
| [EC-065](EC-065.md) | An eligibility notification that was true yesterday and is not true today  (2026-08-13, module: M4 + M10 + M16, status: specced) |

## Entries from M05 (payout system)

| EC | Name |
|---|---|
| [EC-066](EC-066.md) | A settled payout that never reduces the platform balance  (2026-08-13, module: M5 + M2, status: specced) |
| [EC-067](EC-067.md) | The payout name match freezes real traders and catches no mules  (2026-08-13, module: M5 + M19, status: specced) |
| [EC-068](EC-068.md) | Instant approval commits the firm before the wallet can react  (2026-08-13, module: M5 + M6, status: specced) |
| [EC-069](EC-069.md) | A freeze with no expiry is a denial nobody had to authorize  (2026-08-13, module: M5, status: specced) |
| [EC-070](EC-070.md) | The ledger zero-sum halt as a cheap denial-of-payouts trigger  (2026-08-13, module: M5, status: specced, founder ruling requested) |

## Entries from M06 (admin and ops console)

| EC | Name |
|---|---|
| [EC-071](EC-071.md) | An evidence pack sent to a trader discloses the detection thresholds  (2026-08-13, module: M6 + M7, status: specced) |
| [EC-072](EC-072.md) | The circuit breaker fires on a sample of one and is never trusted again  (2026-08-13, module: M6, status: specced) |
| [EC-073](EC-073.md) | A muted alarm outlives the reason it was muted  (2026-08-13, module: M6, status: specced) |
| [EC-074](EC-074.md) | "Open liability" is wrong in both directions at once  (2026-08-13, module: M6 + M5, status: specced) |

## Entries from M07 (risk and abuse)

| EC | Name |
|---|---|
| [EC-075](EC-075.md) | The flagship correlation detector does not defend the first extraction cycle  (2026-08-13, module: M7, status: specced) |
| [EC-076](EC-076.md) | Rotating a third leg defeats pairwise correlation entirely  (2026-08-13, module: M7, status: specced) |
| [EC-077](EC-077.md) | Poisoning the flag queue with true positives about innocent people  (2026-08-13, module: M7 + M6, status: specced) |
| [EC-078](EC-078.md) | Entity resolution merges a family and punishes them for each other  (2026-08-13, module: M7, status: specced) |

## Entries from M08 (affiliate system)

| EC | Name |
|---|---|
| [EC-079](EC-079.md) | Commission is cash paid before the sale is final  (2026-08-13, module: M8 + M3, status: specced) |
| [EC-080](EC-080.md) | An affiliate recruiting their own fleet buys evaluations at a discount no coupon rule sees  (2026-08-13, module: M8 + M7, status: specced) |
| [EC-081](EC-081.md) | Last-touch attribution is stealable by volume  (2026-08-13, module: M8, status: specced) |
| [EC-082](EC-082.md) | The promoter claim the firm has to answer for  (2026-08-13, module: M8, status: specced) |
| [EC-083](EC-083.md) | A parameter value burned into an image cannot be linted  (2026-08-14, module: M9, status: specced) |
| [EC-084](EC-084.md) | Solicitation and sale are different acts, and only sale was defended  (2026-08-14, module: M9, status: specced) |
| [EC-085](EC-085.md) | A rules page that is removed breaks the evidence it was cited in  (2026-08-14, module: M9, status: specced) |
| [EC-086](EC-086.md) | The support console is a read of the identity graph without the admin origin's controls  (2026-08-14, module: M10, status: specced) |
| [EC-087](EC-087.md) | A suppression guard evaluated at enqueue has nothing left to suppress  (2026-08-14, module: M10, status: specced) |
| [EC-088](EC-088.md) | An error handler copies crown-jewel data into the least controlled system in the estate  (2026-08-14, module: M10, status: specced) |
| [EC-089](EC-089.md) | A vendor becomes load bearing without anybody deciding it should  (2026-08-14, module: M10, status: specced) |
| [EC-090](EC-090.md) | A per-trade certificate is a cherry-picking machine with the firm's signature on it  (2026-08-14, module: M11, status: specced) |
| [EC-091](EC-091.md) | The public verification page is an oracle about the firm's own book  (2026-08-14, module: M11, status: specced) |
| [EC-092](EC-092.md) | An opt-in leaderboard is a target list ordered by value  (2026-08-14, module: M11, status: specced) |
| [EC-093](EC-093.md) | A certificate system becomes an aggregate publisher by accretion  (2026-08-14, module: M11, status: specced) |
| [EC-094](EC-094.md) | A pass rate is a choice of denominator, and every choice is defensible  (2026-08-14, module: M12, status: specced) |
| [EC-095](EC-095.md) | Publishing on-chain payout proof publishes the treasury  (2026-08-14, module: M12, status: specced) |
| [EC-096](EC-096.md) | An auto-review-request on payout settlement is review gating  (2026-08-14, module: M12, status: specced) |
| [EC-097](EC-097.md) | A structurally constant 100 percent is the least believable number on the page  (2026-08-14, module: M12, status: specced) |
| [EC-098](EC-098.md) | A backdated correction changes a statistic already published  (2026-08-14, module: M12, status: specced) |
| [EC-099](EC-099.md) | The analytics page becomes a second implementation of a gate  (2026-08-14, module: M13, status: specced) |
| [EC-100](EC-100.md) | A trader's own history changes overnight with no explanation  (2026-08-14, module: M13, status: specced) |
| [EC-101](EC-101.md) | The trading journal is a confession the firm holds  (2026-08-14, module: M13, status: specced) |
| [EC-102](EC-102.md) | A metric that looks rigorous and is definitionally circular  (2026-08-14, module: M13, status: specced) |
| [EC-103](EC-103.md) | The retention feature contends with the payout path for one database  (2026-08-14, module: M13, status: specced) |
| [EC-104](EC-104.md) | Progressive cap release moves the lifetime bound for the cohort best able to reach it  (2026-08-14, module: M14, status: specced) |
| [EC-105](EC-105.md) | A streak reward pays for the behavior the cadence gap exists to slow  (2026-08-14, module: M14, status: specced) |
| [EC-106](EC-106.md) | A free earned spin that resolves into a purchase is still a purchased loot box  (2026-08-14, module: M14, status: specced) |
| [EC-107](EC-107.md) | The highest-scoring win-back target is the worst one to win back  (2026-08-14, module: M14, status: specced) |
| [EC-108](EC-108.md) | A loyalty service is a config editor with less scrutiny  (2026-08-14, module: M14, status: specced) |
| [EC-109](EC-109.md) | A loyalty streak broken by the exchange calendar  (2026-08-14, module: M14, status: specced) |
| [EC-110](EC-110.md) | A Discord role broadcasts a trader's financial state  (2026-08-14, module: M15, status: specced) |
| [EC-111](EC-111.md) | A linked chat account becomes a trading credential  (2026-08-14, module: M15, status: specced) |
| [EC-112](EC-112.md) | A stolen bot token can announce a rule change in the firm's own voice  (2026-08-14, module: M15, status: specced) |
| [EC-113](EC-113.md) | Hosting the community creates both a recruitment venue and a surveillance temptation  (2026-08-14, module: M15, status: specced) |
| [EC-114](EC-114.md) | The freeze notice a trader is owed is also an investigation tip-off  (2026-08-14, module: M16, status: specced) |
| [EC-115](EC-115.md) | An attacker mutes the alarm before redirecting the money  (2026-08-14, module: M16, status: specced) |
| [EC-116](EC-116.md) | A read receipt is not proof of notice  (2026-08-14, module: M16, status: specced) |
| [EC-117](EC-117.md) | A rule change marketed as a promotion  (2026-08-14, module: M17, status: specced) |
| [EC-118](EC-118.md) | A free trial deletes the identity signal it most needs  (2026-08-14, module: M17, status: specced) |
| [EC-119](EC-119.md) | Stacked instruments sell a funded account for nothing  (2026-08-14, module: M17, status: specced) |
| [EC-120](EC-120.md) | Promotional credit funded by a payment that came back  (2026-08-14, module: M17, status: specced) |
| [EC-121](EC-121.md) | A live graduation program would change the firm's regulatory character  (2026-08-14, module: M18, status: specced) |
| [EC-122](EC-122.md) | The payout ladder is only a ladder while the trader is winning  (2026-08-14, module: M18, status: specced) |
| [EC-123](EC-123.md) | Completing the ladder is exactly what a successful undetected ring produces  (2026-08-14, module: M18, status: specced) |
| [EC-124](EC-124.md) | A graduated account can still owe the trader money  (2026-08-14, module: M18, status: specced) |
| [EC-125](EC-125.md) | KYC placement silently sets the size of the biometric dedupe corpus  (2026-08-14, module: M19, status: specced) |
| [EC-126](EC-126.md) | The verification provider becomes a payout dependency  (2026-08-14, module: M19, status: specced) |
| [EC-127](EC-127.md) | The geo-consistency triangle fires on cross-border lives  (2026-08-14, module: M19, status: specced) |
| [EC-128](EC-128.md) | A sanctions match is the one refusal Merit must be able to make  (2026-08-14, module: M19, status: specced) |
| [EC-129](EC-129.md) | The fleet-killer is also a false-accusation engine  (2026-08-14, module: M19, status: specced) |
| [EC-130](EC-130.md) | A re-verification that reads a cached status verifies nothing  (2026-08-14, module: M19, status: specced) |
| [EC-131](EC-131.md) | Data minimization creates an evidence dependency on the provider  (2026-08-14, module: M19, status: specced) |
| [EC-132](EC-132.md) | Bonus-credit farming converts promotional credit to cash through a funded account  (2026-08-14, module: M20, status: specced) |
| [EC-133](EC-133.md) | A freeze that covers the cash door and not the product door is not a freeze  (2026-08-14, module: M20, status: specced) |
| [EC-134](EC-134.md) | Refunding a card purchase to the wallet is a rail crossing  (2026-08-14, module: M20, status: specced) |
| [EC-135](EC-135.md) | The wallet becomes a deposit account by accretion  (2026-08-14, module: M20, status: specced) |
| [EC-136](EC-136.md) | The wallet compresses the attacker's cycle as much as the trader's  (2026-08-14, module: M20, status: specced) |
| [EC-137](EC-137.md) | Checkout is a transfer endpoint nobody labelled as one  (2026-08-14, module: M20, status: specced) |
| [EC-138](EC-138.md) | A dormant wallet balance may be neither kept nor held forever  (2026-08-14, module: M20, status: specced) |
| [EC-139](EC-139.md) | Cross-account loyalty rewards the population that completes ladders reliably  (2026-08-14, module: M14, status: specced) |
| [EC-140](EC-140.md) | A rejected mechanic returns as a roadmap item nobody re-prices  (2026-08-14, module: M14, status: specced) |
| [EC-141](EC-141.md) | Two approved documents disagree on where a golden file's expectation lives  (2026-08-15, module: M1, status: specced) |
