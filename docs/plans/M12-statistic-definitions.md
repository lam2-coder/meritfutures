---
status: approved
depends_on: [M12-transparency-platform.md, ../DECISIONS.md, ../GLOSSARY.md, ../EDGE_CASES.md, ../testing/GOLDEN_SCENARIOS.md, M01-rules-engine.md, M05-payout-system.md, M09-marketing-site.md, M20-wallet.md]
last_updated: 2026-08-14
---

# M12: The seven statistic definitions, for founder sign-off

**This is a sign-off artifact for the Wave 4 gate**, drafted per [OQ-M12-01](../DECISIONS.md)'s ruling at the batch 2 gate. Each definition below is the exact arithmetic Merit will publish about itself, and **each needs a founder decision before any data exists**, which is the only honest moment to make it.

**Why this cannot wait, in one paragraph.** A pass rate is not a number, it is a **choice of denominator**, and every available choice is defensible while moving the answer by tens of points ([AS-M12-01](M12-transparency-platform.md), [EC-094](../EDGE_CASES.md)). Choosing after the data exists means choosing with knowledge of the result, which is indistinguishable from selecting the flattering one no matter how honest the chooser. **The whole value of the transparency platform is created by the credible possibility of publishing something bad**, and that credibility comes from precommitment rather than from accuracy. GS-171 refuses a definition written with a backdated `effective_from` at write time, for exactly this reason.

**The three binding requirements from the ruling**, applied to every row below:

1. **Each statistic carries both a trailing-window and a lifetime form.** A firm publishing only one of them is choosing the flattering one, and which one is flattering changes over time, which is worse.
2. **Denominators are stated on the surface itself**, never only on a methodology page a reader has to find.
3. **Each definition carries a future-dated `effective_from`**, so a definition change is announced before it takes effect rather than discovered after.

---

## 1. The six global choices

These apply to every statistic and they are the ones that move the numbers most. **Every proposal is the unflattering reading**, which is the drafting basis the ruling set.

| # | Question | Proposal | What the flattering alternative would buy |
|---|---|---|---|
| G-1 | Accounts purchased but never traded | **Included** in the denominator | Excluding them is the single largest available inflation, and every firm that could exclude them would. On plausible never-traded rates this moves a published pass rate by several points, in Merit's favor, for free |
| G-2 | Accounts still in evaluation at window close | **Excluded from both numerator and denominator**, with the **open count published separately** | Including them in the denominator alone understates; in both, overstates. The separate open count is what stops the exclusion from being a hiding place |
| G-3 | A reset | **A new attempt.** A trader who resets and passes has passed on their second attempt, and the page says so | Counting a reset-and-pass as one success inflates the rate by the entire reset population, which is the largest single distortion available after G-1 |
| G-4 | Grain | **Per account**, with a **per-identity figure published alongside** | One identity may hold up to ten accounts, so per-account and per-identity differ materially. Publishing only the higher one is a choice, so both are published |
| G-5 | Window anchor | **Outcome date**, so a trailing 90 days describes outcomes that occurred in it | Anchoring on purchase date lets a slow window look better than it was, because the failures have not landed yet |
| G-6 | Merit Rapid's cadence in ST-05 and ST-06 | Published per plan, with the **3 trading day cycle attributed to the win-day gate**, never to the cadence gap | The gap is a **dominated gate** ([EC-049](../EDGE_CASES.md)) and describing it as the reason the plan is fast would be a marketing-versus-implementation gap in a published statistic |

**One more choice, which the ruling did not name and which belongs with these.** **A statistic is never suppressed because it is unflattering, and there is no endpoint that could do it.** Publication is automatic and scheduled ([M12](M12-transparency-platform.md) INV-M12-08), `POST /internal/stats/run` cannot write to `published_statistics`, and the only path to a public surface is the nightly run. That is the control that makes every choice above worth making.

---

## 2. The seven definitions

Each carries the same fields, in the same order, so the sign-off is a comparison rather than seven readings. `effective_from` is **the launch date plus 30 days for every one**, which is the future-dating requirement applied uniformly at v1; later changes are future-dated individually.

---

### ST-01: Evaluation pass rate

| Field | Value |
|---|---|
| **Numerator** | Evaluation accounts that reached `passed` in the window |
| **Denominator** | Evaluation accounts whose outcome (passed, breached, or expired) **occurred in the window** |
| **Exclusions** | Accounts still in evaluation at window close (G-2). **Nothing else.** Never-traded accounts are in (G-1), resets are separate attempts (G-3) |
| **Trailing form** | Trailing **90 trading days** |
| **Lifetime form** | Since first evaluation sold |
| **Grain** | Per plan, and lineup total. Per-account **and** per-identity (G-4) |
| **`min_sample`** | **250 completed evaluations** per published cell |
| **Surface statement** | The rate, the numerator, the denominator, the window, the as-of trading day, and the **open count** |
| **Why 250** | [OQ-M12-04](../DECISIONS.md)'s recommendation. A high floor is a legitimate way to be careful and, unlike an approval step, it is a commitment made **before** the data rather than after |

**The founder decision this one carries.** ST-01 is the headline and it is the number a competitor will quote against Merit if it is low. **TradeDay publishes 36 percent, as a blog figure**, and it is the only top-ten firm publishing a pass rate at all. Merit's own selection math puts blended pass near **14.7 percent**, and the honest reason it is lower is G-1 and G-3: Merit counts the never-traded and counts a reset as a second attempt, and a blog figure has no stated denominator to compare against. **The comparison Merit may make is about the practice, not the value** (GS-169).

---

### ST-02: Funded-to-first-payout rate

| Field | Value |
|---|---|
| **Numerator** | Funded accounts that reached a **first settled payout** in the window |
| **Denominator** | Funded accounts whose funded life **ended** in the window (first payout, breach, or closure), plus those still funded past the plan's maximum plausible time-to-first-payout |
| **Exclusions** | Funded accounts still inside their first plausible cycle, with the count published separately |
| **Trailing form** | Trailing **90 trading days** |
| **Lifetime form** | Since first funded account |
| **Grain** | Per plan. Per-account and per-identity |
| **`min_sample`** | **100 resolved funded accounts** |
| **Surface statement** | Rate, numerator, denominator, window, as-of day, and the still-funded count |

**This is the number that says whether funded accounts actually get paid**, which is the question ST-01 does not answer, and it is the more important of the two. [ADR-018](../DECISIONS.md)'s recalibration reports **48.1 percent** internally, which is a good number and is exactly why publishing it is worth the risk of the quarter it is not.

---

### ST-03: Total paid to traders

| Field | Value |
|---|---|
| **Numerator** | Sum of `trader_cents` across settled payouts, in dollars |
| **Denominator** | None. It is a total, and the surface says so rather than implying a rate |
| **Exclusions** | Terminal settlements at graduation are **included** and labeled, because they are money paid to traders |
| **Trailing forms** | Trailing **30** and trailing **90 trading days** |
| **Lifetime form** | Since first settled payout |
| **Grain** | Lineup total |
| **`min_sample`** | None. A total of a small number is still a true total |
| **Surface statement** | The figure, the window, the as-of day, the **count of payouts** behind it, and a link to the proof trail |

**Two decisions worth naming.** **Wallet credit is the recognition point**, not external settlement, because that is when the trader has the money under [ADR-019](../DECISIONS.md) and publishing the later moment would understate a real thing. And **the count is published with the total**, because a large total from three payouts and a large total from three hundred are different claims.

---

### ST-04: Average and median payout

| Field | Value |
|---|---|
| **Numerator** | Sum and the ordered middle of `trader_cents` across settled payouts in the window |
| **Denominator** | Count of settled payouts in the window |
| **Exclusions** | Terminal settlements at graduation **excluded** from this one and reported separately, because they are close-outs of a remaining balance rather than a payout under the cap and blending them distorts both |
| **Trailing form** | Trailing **90 trading days** |
| **Lifetime form** | Since first settled payout |
| **Grain** | Per plan |
| **`min_sample`** | **50 settled payouts** per cell |
| **Surface statement** | **Both figures together**, count, window, as-of day |

**Median is published alongside the mean deliberately**, and neither is published alone. A mean is the number one large payout distorts, and a median alone hides that large payouts happen at all.

**Note the exclusion is the opposite of ST-03's**, and that is intentional rather than inconsistent: a total should include every dollar paid, and an average of payouts should average payouts. Both surfaces state which treatment they use, which is why the inconsistency is visible rather than confusing.

---

### ST-05: Time from payout request to wallet credit

| Field | Value |
|---|---|
| **Numerator** | Elapsed time from `payout_requests.created_at` to the wallet-credit posting |
| **Denominator** | Count of payout requests resolved in the window |
| **Exclusions** | Requests held under a cited freeze, **published separately with count and median duration** rather than dropped |
| **Trailing form** | Trailing **90 trading days**, p50 and p95 |
| **Lifetime form** | Since the wallet shipped |
| **Grain** | Lineup, and per plan for G-6 |
| **`min_sample`** | **50 requests** |
| **Surface statement** | p50 and p95, count, the **freeze decomposition**, window, as-of day |

**Under [ADR-019](../DECISIONS.md) this is effectively zero and it is Merit's strongest verifiable claim.** Approval, the ledger posting, and the wallet credit commit in one transaction (GS-128). **A number that is structurally near-zero is exactly the kind of claim a reader disbelieves**, which is why the freeze decomposition is published with it rather than as a footnote: the believable version of "instant" is the one that shows the exceptions.

---

### ST-06: Time from withdrawal request to external settlement

| Field | Value |
|---|---|
| **Numerator** | Elapsed time from a wallet-to-rail withdrawal request to the settlement confirmation |
| **Denominator** | Count of withdrawals settled in the window |
| **Exclusions** | Withdrawals held under P-1 or P-3 provenance rules, **published separately with count and reason class**; withdrawals inside a 48 hour destination-cooling window, same treatment |
| **Trailing form** | Trailing **90 trading days**, p50 and p95 |
| **Lifetime form** | Since the wallet shipped |
| **Grain** | Lineup |
| **`min_sample`** | **50 withdrawals** |
| **Surface statement** | p50 and p95, count, hold decomposition, the **published 2 to 3 business day window**, as-of day |

**ST-06 exists because ST-05 without it is a lie by omission.** [M09](M09-marketing-site.md) GS-147 already fails the build on any payout copy stating one leg without the other, at equal weight, on headlines, social cards, email subjects, and OG images alike. **This is that rule in statistical form**, and the two are published as a pair on the same surface rather than in adjacent sections.

---

### ST-07: Share of eligible payout requests approved

| Field | Value |
|---|---|
| **Numerator** | Payout requests meeting the published gates that were approved |
| **Denominator** | Payout requests meeting the published gates |
| **Exclusions** | **None.** Requests failing a gate are not in the denominator, because they were never eligible, and the surface says so in those words |
| **Trailing form** | Trailing **90 trading days** |
| **Lifetime form** | Since first payout request |
| **Grain** | Lineup |
| **`min_sample`** | **50 eligible requests** |
| **Surface statement** | The rate, numerator, denominator, **and the full freeze decomposition: count, median duration, and release outcome** |

**This will publish 100 percent, structurally, because [M05](M05-payout-system.md) INV-M5-01 has no denial path and `payout_requests` has no `denied` status.** That makes it simultaneously the best and the most suspicious claim available (AS-M12-05).

**The answer is not to soften it. The answer is to publish the denominator a skeptic is already looking for**, which is the freeze data: how many were held, for how long, and how they resolved. GS-166 pins exactly this. **A constant is believable only when the thing a reader suspects is hiding behind it is published next to it.**

---

## 3. The three deliberate exclusions

Published on the method index **with their reasons**, because an unexplained absence is read as concealment while an explained one is read as judgment (GS-165).

| Excluded | Published reason |
|---|---|
| **Per-plan loss ratio** | It is [M06](M06-admin-ops-console.md)'s circuit-breaker input. Publishing it tells a coordinated group which plan is currently being beaten, in near real time, from Merit's own site (AS-M12-04) |
| **Reserve coverage ratio** | Merit's liquidity position is not a trust signal, it is a target. **A falling RCR published live is a bank-run mechanic** |
| **Any per-trader or per-account figure** | [M11](M11-certificates-social-proof.md) covers individual claims with the trader's consent. Aggregates here are never small enough to identify anyone (INV-M12-06) |

**These reasons are published verbatim**, and the founder should read them as public statements rather than as internal notes, because that is what they will be.

---

## 4. The founder sign-off table

**One row per decision. Sign, amend, or reject.** A definition that reaches launch unsigned is a definition chosen by default, which is the outcome this entire document exists to prevent.

| # | Decision | Proposal | Sign-off |
|---|---|---|---|
| S-01 | **G-1**: accounts purchased but never traded are in the denominator | Included | ☐ approve ☐ amend |
| S-02 | **G-2**: accounts still in evaluation are excluded from both, open count published | Excluded, count published | ☐ approve ☐ amend |
| S-03 | **G-3**: a reset is a new attempt | New attempt | ☐ approve ☐ amend |
| S-04 | **G-4**: per-account and per-identity both published | Both | ☐ approve ☐ amend |
| S-05 | **G-5**: window anchored on outcome date | Outcome date | ☐ approve ☐ amend |
| S-06 | **G-6**: Merit Rapid's cadence attributed to the win-day gate | Win-day gate | ☐ approve ☐ amend |
| S-07 | **ST-01** definition and a `min_sample` of 250 | As drafted | ☐ approve ☐ amend |
| S-08 | **ST-02** definition and a `min_sample` of 100 | As drafted | ☐ approve ☐ amend |
| S-09 | **ST-03** recognized at wallet credit, count published with the total | As drafted | ☐ approve ☐ amend |
| S-10 | **ST-04** mean and median together, terminal settlements excluded | As drafted | ☐ approve ☐ amend |
| S-11 | **ST-05** with the freeze decomposition published alongside | As drafted | ☐ approve ☐ amend |
| S-12 | **ST-06** published as a pair with ST-05 on the same surface | As drafted | ☐ approve ☐ amend |
| S-13 | **ST-07** publishing a structural 100 percent with the full freeze decomposition | As drafted | ☐ approve ☐ amend |
| S-14 | The **three exclusions**, with their reasons published verbatim | As drafted | ☐ approve ☐ amend |
| S-15 | `effective_from` for every v1 definition is **launch plus 30 days** | As drafted | ☐ approve ☐ amend |
| **S-16 (APPROVED at FREEZE)** | **[OQ-M12-04](../DECISIONS.md)**: the first number publishes whatever it says, with no approval step | **Confirm the consequence in advance**: a bad first quarter publishes, is screenshotted, and cannot be withdrawn | ☐ approve ☐ amend |

**S-16 is the one that matters most and it is not a definition.** [M12](M12-transparency-platform.md) INV-M12-08 removes the approval step deliberately, so that Merit can say there is no approval step. **That control is only real if its consequence is accepted before the data exists**, and accepting it afterwards is not available: the first time a founder wants to hold a number is the moment the claim stops being true.

---

## 5. What still needs a number, and is not in the sign-off table

Two items from [M12](M12-transparency-platform.md) section 10 that are adjacent to these definitions and are decided separately.

**OQ-M12-02: on-chain address or third-party trackers only?** Proposed: **cite trackers, do not publish an address.** Publishing an address publishes operational tempo permanently and irrevocably, and a group watching the balance can time a correlated wave to the funding cycle (AS-M12-02, GS-163). The proof strength lost is modest, because a tracker already indexes the rail. **The disclosure avoided is permanent.**

**OQ-M12-03: the restatement materiality threshold, per statistic.** Proposed: **0.5 percentage points for rate statistics, 1 percent of value for money statistics**, published on each method page, fixed before launch. The number matters less than that it exists in advance, because AS-M12-06's real failure is a threshold chosen after seeing the delta.

---

## FREEZE gate ruling (2026-08-14)

**The table is approved in full, including S-16.** The first published number publishes whatever it says: no soft launch, no holding the page until the figures flatter, no "we will publish once the sample is meaningful" that quietly becomes never.

**The rationale, recorded because it will be tempting to revisit on a bad month: a stats page with an escape hatch is marketing, and Merit built the version without one.** The entire value of a transparency surface is that it was committed to before anyone knew what it would say. A page that publishes only favorable numbers is not a transparency page having a bad quarter; it is an advertisement that was always going to be one, and every reader who matters can tell the difference.
