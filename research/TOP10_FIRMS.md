---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, PROP_TECH_LANDSCAPE.md]
last_updated: 2026-08-14
---

# Top-10 Futures Firm Surveillance (Constitution §1B)

Deep profiles of the ten biggest futures props as of 2026-08-13, plus the table-stakes-tech list and the gaps-nobody-serves list. Refresh monthly through launch. All rule figures carry the caveat that firms change rules frequently; each one-pager notes its source date. Citations inline.

## Ranking verification

[Payout Junction](https://payoutjunction.com/) on-chain data (24h snapshot, 2026-08-13): Tradeify $1.49M/849 payouts, MyFundedFutures $745K/394, FundedNext $505K/311, then (mixed CFD/futures) BlueGuardian, FundingPips, E8, The5ers, with FundedFuturesFamily $85K/59 and FuturesElite $71K/35 in the futures tail. **Caveat:** on-chain trackers only see crypto-rail (Rise-style) payouts; Apex (Wise + ACH since 4.0) and Topstep (Wise) are invisible there despite being among the largest by volume ([Topstep claims $1.4B+ lifetime paid](https://newyorkcityservers.com/blog/best-futures-prop-firms)). [PropScorer](https://www.propscorer.com/) August 2026 quality ranking: MFF 83, Lucid 83, Apex 82.

**Roster used (size + trajectory):** Apex, Topstep, MyFundedFutures, Tradeify, Lucid, TradeDay, FundedNext Futures, TakeProfit Trader, FundedFuturesFamily, Alpha Futures (riser, swapped in per §1B's allowance). FuturesElite retained on the watchlist (smaller on-chain volume, 4.1 marketplace rating).

---


## Live-path structures and ladder lengths (2026-08-14, for [ADR-024](../docs/DECISIONS.md))

Recorded because "industry consensus is 5" is a claim that should be checkable rather than remembered, and because the **live path is where firms differ most in honesty**.

| Firm | Payout ladder | Live-path structure | What Merit takes from it |
|---|---|---|---|
| **Lucid** | **5** | **Discretionary, and published as such.** Frames the ladder as "the maximum payout level, **not a guaranteed minimum** for live eligibility" | **Merit adopts this framing verbatim.** It is the single sentence that prevents the entire misreading, and Lucid got there first |
| **Tradeify** | **5** | Discretionary. Counts the ladder **across an entity's accounts** rather than per account | Ladder length confirms consensus. The cross-account counting is recorded as a **config option Merit does not adopt by default** |
| **Topstep** | n/a | The selectivity benchmark: **0.71 percent** of funded traders reach live capital | **The number that settles the argument.** Any firm implying that completing a ladder leads to live capital is describing something no firm operates |
| **TopOne** | varies | Live path advertised as a progression | The pattern to avoid |
| **Phidias** | varies | Live path advertised as a progression | The pattern to avoid |

**The reading, and it is the reason this table exists.** Ladder length is genuinely converged at 5, so Merit sitting there is unremarkable and needs no defense. **Live-path framing is not converged**, and it splits cleanly: the two firms that publish a discretionary framing are the two Merit is matching, and the firms that advertise a progression are describing an outcome that a 0.71 percent selectivity rate makes almost entirely notional. **Merit's ladder is at consensus and its live posture is at the honest end of it**, which is a defensible position to hold publicly and a cheap one to hold now, before any copy exists.

## One-pagers

### 1. Apex Trader Funding

- **Rules (Apex 4.0, effective 2026-03-01):** one-time-fee evaluations, lifetime activation ($79-99), EOD trailing drawdown default, safety net = drawdown limit + $100 applied for the account's lifetime (legacy: first 3 payouts only), consistency loosened 30% → 50%, qualifying days 7 → 5, minimum payout $500, **6-payout ceiling per account** then reset or live, automated payout review. 100% of first $25K profit. ([pickmytrade guide](https://blog.pickmytrade.trade/apex-payout-rules-explained-safety-net-2026-changes/), [phidias](https://phidiaspropfirm.com/education/apex-payout-rules), [proptradingvibes](https://proptradingvibes.com/blog/apex-trader-funding-rules-overview))
- **Tech:** three account families by platform: Rithmic (feeds NinjaTrader, Sierra, Bookmap, ATAS, Jigsaw, Quantower), Tradovate (browser + TradingView), and WealthCharts (purpose-built for Apex, native trade copier, live trailing-threshold overlay on chart). Payouts: automated Wise + ACH ([platform guide](https://proptradingvibes.com/blog/apex-trader-funding-platforms), [financialtechwiz](https://www.financialtechwiz.com/post/apex-trader-funding-review/)); USDC/USDT via Rise also reported ([luxalgo](https://www.luxalgo.com/blog/prop-firms-with-the-fastest-payouts-in-2025/)).
- **Signal (60-90d):** 4.0 marketing push continues; heavy discount cadence (evals from $197 for 50K, perpetual sale culture); WealthCharts positioned as differentiator.
- **Trust trajectory: declining.** Trustpilot 4.3 (19,103 reviews, May 2026), down from 4.5 in Sept 2025; ~8.7% one-star. Complaint themes: accounts "under maintenance"/"under review" after profitability, payouts approved but unpaid 15+ business days, profitable traders banned from buying new evals, support silence. ([Trustpilot](https://www.trustpilot.com/review/apextraderfunding.com), [completetradersedge](https://completetradersedge.com/apex-trader-funding-review-2026/)) **Merit lesson:** this is the exact label-vs-enforcement gap the constitution targets; "under review" as a payout-time gate is the anti-pattern our detection-time-only doctrine avoids.

### 2. Topstep

- **Rules (multiple 2026 changes):** 90/10 split from dollar one for accounts after 2026-01-12 (pre-dates: 100% of first $10K lifetime). Express Funded payouts: 5 winning days (Standard) or 3 trading days + 40% consistency (Consistency path). **2026-04-28: per-payout caps on new $50K/$100K combines cut from $5,000/$6,000 to $2,000/$3,000.** Live Funded (post 2026-02-10): starts with 20% of balance tradable, 80% in reserve unlocking in 25% milestones by net profit; live payouts uncapped. ([tradecovex changes log](https://tradecovex.com/guides/topstep-rule-changes-2026), [Topstep payout policy](https://help.topstep.com/en/articles/8284233-topstep-payout-policy), [live rules](https://www.topstep.com/live-funded-account-rules))
- **Tech:** **TopstepX** (exclusive ProjectX license since Feb 2026); acquired The Futures Desk and is folding TFD tech into TopstepX; Topstep Brokerage launched for live graduation. Payouts via Wise. ([fortraders](https://fortraders.com/blog/topstep-funded-account-rules), [proptradingvibes](https://proptradingvibes.com/blog/topstep-payout-rules))
- **Signal:** the platform exclusivity is the strategic story: Topstep converted a vendor into a moat and forced the rest of the market onto Tradovate/Rithmic/Volumetrica stacks. Rule-change cadence is high and each cap cut generates measurable backlash.
- **Trust trajectory: the cautionary tale.** Trustpilot 3.6 (14,000+ reviews). Themes: real-time MLL breaching accounts on unrealized wicks (rule-implementation gap between what traders expect and what the engine enforces), IP-sharing auto-flags, payout-time account deletions alleged, polarized fast-payout vs denied-payout reports. ([Trustpilot](https://www.trustpilot.com/review/topstep.com), [proptradingvibes review themes](https://www.proptradingvibes.com/blog/topstep-trustpilot-reviews)) The constitution's "Topstep 3.6-star lesson" is confirmed current and, if anything, sharper after the April cap cuts.

### 3. MyFundedFutures (the crown)

- **Rules (July 2026 lineup: Builder, Rapid, Pro; Core/Flex legacy):** Core: EOD trailing DD, 40% consistency, 80/20, $5,000/cycle cap. Rapid: intraday trailing DD (real-time equity incl. unrealized), no consistency, 90/10, payout eligibility every 24h from first funded trade once buffer (MLL + $100) and $500 minimum met; most requests approved instantly, manual reviews 6-12 business hours. Pro: EOD DD, no consistency, 80/20, $1,000 minimum, $100K cumulative cap across Pro accounts. ([tradecovex](https://tradecovex.com/guides/myfundedfutures-rules-2026), [MFF help center](https://help.myfundedfutures.com/en/articles/13745661-payout-policy-overview-best-and-fastest-prop-firm-payouts), [proptradingvibes](https://proptradingvibes.com/blog/myfundedfutures-account-types))
- **Tech:** dual-feed platform matrix: CQG-based (TradingView, Tradovate, NinjaTrader) + dxFeed-based (Quantower, Volumetrica Web/VolSys/VolBook, ATAS); R|Trader Pro also listed. Dashboard widely praised; provider fingerprint not yet confirmed (F12 pass pending, needs live session). ([platform guide](https://proptradingvibes.com/blog/myfundedfutures-platforms))
- **Signal:** #1 PropScore (83) August 2026; sustained ~50% discount codes; markets "best and fastest payouts" explicitly in its help center, i.e., payout speed as brand.
- **Trust trajectory: the benchmark.** 4.9 Trustpilot, no activation fee, next-day payouts. ([tradezella rankings](https://www.tradezella.com/blog/best-prop-trading-firms-2026-rankings)) **Merit lesson:** instant auto-approval + clear buffer math + published payout policy is exactly the constitution's target posture; MFF proves it wins the review war.

### 4. Tradeify

- **Rules (Tradeify 3.0, March 2026: Select, Growth, Lightning):** Select = 2-phase eval; Growth = 1-day eval (no consistency in eval, passable in one session); Lightning = no eval (instant). Growth Funded: 90/10, 35% consistency, 5 qualifying trading days before every payout, minimum balance threshold, **trading-day count resets to zero after each payout** (the pattern our M1 win-day reset copies). Elite Live eligibility at 3 payouts on one account or 10 total; transition at firm's discretion and mandatory once selected. ([Tradeify help center](https://help.tradeify.co/en/articles/11083796-growth-funded-account-payout-policy), [consistency rule](https://help.tradeify.co/en/articles/10468320-rules-consistency-rule), [test-max](https://test-max.com/prop-firms/tradeify/))
- **Tech:** platform list includes Tradovate, NinjaTrader, TradingView and dxFeed platforms ([supported platforms](https://help.tradeify.co/en/articles/10468221-supported-platforms)); payouts via Rise incl. USDC/USDT; 24h processing.
- **Signal:** #1 on-chain payout volume (24h snapshot); $150M+ verified payouts; 80K+ traders; 102K-member Discord used as the announcement channel; 40% discount codes running. ([payoutjunction](https://payoutjunction.com/), [thortradecopier](https://thortradecopier.com/blog/best-futures-prop-firms-2026), [Discord](https://discord.com/invite/tradeify))
- **Trust trajectory: strong.** 4.7 Trustpilot, rising volume. The 3.0 restructure retired legacy plans without notable backlash (grandfathering handled cleanly).

### 5. Lucid Trading

- **Rules:** three families: LucidPro (structured eval, EOD DD, funded consistency), LucidFlex (eval, then funded with no daily loss limit, no funded consistency), LucidDirect (instant funded, 20% consistency, strong caps). 100% of first $10K, then 90/10. Live graduation restructured Feb 2026 alongside **LucidMaxx Daily Payout Account** (premium daily-payout product); live bonus $1,000-4,500 on reaching live target. News trading allowed, no blackout windows. ([damnpropfirms rules](https://damnpropfirms.com/prop-firms/lucid-trading-rules-payouts/), [MondoTraders](https://mondotraders.com/en/blog/lucid-trading-verified-payouts-2026), [directionsmag](https://www.directionsmag.com/reviews/prop-trading-firms/lucid-trading))
- **Tech:** Rithmic, Tradovate, NinjaTrader connections. **Dropped ProjectX ("LucidX") after reliability concerns and a major infrastructure outage**, a live case of platform-vendor risk. Payouts via Rise (USDC/USDT); markets minutes-fast settlement. ([pipback](https://pipback.com/blogs/lucid-trading-review/))
- **Signal:** $463M verified payouts / 281K withdrawals claimed; PropScore 83 (tied #1); community sentiment ranks it top for payout reliability and value ([MondoTraders](https://mondotraders.com/en/blog/lucid-trading-verified-payouts-2026), [X ranking post](https://x.com/stocksgeeks/status/2005129358252642586)).
- **Trust trajectory: rising fast.** The growth firm of 2026 on payout-speed brand.

### 6. TradeDay

- **Rules (TradeDay 2.0, May 2026):** two routes: **Quick Pay** (5-day eval minimum, choice of intraday or EOD drawdown, 30% eval-only consistency; funded: day-one payout eligibility with any positive balance, $250 minimum, no milestones/buffer/consistency) and **Fast Pass** (3-day pass, 45% eval-only consistency, flat 80/20). Tiered split: 80% to $50K profits, 90% $50-100K, 95% above. Payouts within 24h. ([damnpropfirms](https://damnpropfirms.com/futures-prop-firms/tradeday/), [tradingfinder](https://tradingfinder.com/props/tradeday/))
- **Tech:** Tradovate, NinjaTrader, TradingView, Jigsaw Daytradr, **all on CQG feed** (notable: a top-10 futures firm running no Rithmic at all). Chicago-based, operating since 2020.
- **Signal:** 2.0 relaunch was the year's cleanest rebrand; **publicly discloses evaluation pass rate (36%, Jan-Jun 2026)**, the only top-10 firm doing voluntary stats disclosure, directly validating Merit's M12 transparency bet. ([damnpropfirms](https://damnpropfirms.com/futures-prop-firms/tradeday/))
- **Trust trajectory: stable-good.** 4.6 Trustpilot, 1,300+ reviews, $10M+ verified payouts.

### 7. FundedNext Futures

- **Rules:** four paths: Flex (cheapest, $150K size), Legacy (biggest per-cycle withdrawals, no funded consistency), Rapid Pro (3-day payout cycle, no daily loss limit), Rapid Daily (fastest eval-to-payout). **Progressive cap release:** before 30 benchmark days, Legacy withdrawals capped at 50% of profits with $3,000-6,000 per-cycle maximums by size; after 30 benchmark days restrictions lift entirely. **24-hour payout guarantee backed by a $1,000 penalty** (since April 2026). 80% base split to 95% add-on. ([proptradingvibes payout rules](https://proptradingvibes.com/blog/fundednext-payout-rules), [thetrustedprop](https://thetrustedprop.com/prop-firms/fundednext-futures))
- **Tech:** Tradovate, NinjaTrader, TradingView via Tradovate (CQG feed).
- **Signal:** #3 on-chain futures volume; $261M+ paid across FX+futures; the penalty-backed payout SLA is the most aggressive trust-marketing mechanic in the industry.
- **Trust trajectory: solid.** 4.5 Trustpilot across 72,000+ reviews (July 2026).

### 8. TakeProfit Trader

- **Rules:** 1-step eval, 6% target, sizes $25K-150K. Funded PRO: **day-one payout eligibility**, no scaling plan, no max withdrawal, ~1-hour withdrawal processing, 80/20; PRO drawdown switches to intraday trailing on peak equity including unrealized. **PRO+ (live, up to 90%): promotion automatic since March 2026** after consistent trading or a $10K day. ([proptradingvibes](https://proptradingvibes.com/blog/takeprofittrader-payout-rules), [damnpropfirms](https://damnpropfirms.com/futures-prop-firms/take-profit-trader/), [thetrustedprop](https://thetrustedprop.com/prop-firms/takeprofittrader))
- **Tech:** NinjaTrader and Tradovate primary; Orlando-based, founded 2021.
- **Signal:** trust-marketed on day-one payouts and hour-fast processing; community ranks its funded accounts best-in-class.
- **Trust trajectory: good.** 4.4-4.7 Trustpilot (~9,300 reviews).

### 9. FundedFuturesFamily

- **Rules:** 100% of first $10K lifetime then 90/10; **escalating funded consistency: 40% (payouts 1-3), 45% (4-5), 50% (6+)**, the inverse of a progressive unlock, tightening as traders extract; 3-7 qualifying days at $200+ profit; 24-hour Rise processing. Sizes $25K-150K, $79-325 pricing. ([PropScorer profile](https://www.propscorer.com/firms/funded-futures-family))
- **Tech:** Rise payout rail confirmed; platform set typical (Tradovate/NinjaTrader class). Founded 2024.
- **Signal:** #8 on-chain; "human-led customer service" as positioning.
- **Trust trajectory: good for its age.** 4.5 Trustpilot, 1,900 reviews; PropScore 78.

### 10. Alpha Futures (riser, swapped in)

- **Rules:** one-step eval, EOD balance-based drawdown, weekly or bi-weekly payouts, up to 90% split, max $450K across 3 qualified accounts. UK-based, founded 2024. ([alpha-futures.com](https://alpha-futures.com/), [funded.now review](https://funded.now/propfirm/alpha-futures))
- **Signal:** the named riser in the constitution; ex-ProjectX white-label ("AlphaTicks") that migrated post-exclusivity.
- **Trust trajectory:** 4.5 customer rating; too young for a long trajectory. Watch.

**Watchlist:** FuturesElite (#10 on-chain, 4.1 marketplace rating), BlueGuardian Futures ($100M+ paid, entering futures from CFD side), FundingTicks (negative watch: December 2025 retroactive rule-change scandal with profit clawbacks, the live case study in how one announcement destroys a brand, [Finance Magnates](https://www.financemagnates.com/forex/prop-firm-fundingticks-faces-massive-backlash-after-retroactive-rule-change/)).

---

## What the market now considers table-stakes tech

1. **Instant or same-day payout processing** with a published SLA (MFF instant, TPT ~1 hour, TradeDay/Tradeify/FFF 24h, FundedNext 24h with a $1,000 penalty). A 2-3 day settle is still acceptable; a slow *approval* no longer is.
2. **Rise (or equivalent stablecoin-capable) payout rail** with USDC/USDT option; Wise/ACH as the fiat alternative (Apex, Topstep).
3. **Multi-platform trader choice on a real-time feed**: at minimum Tradovate + NinjaTrader + TradingView on CQG or Rithmic; dxFeed-based orderflow platforms (Quantower, ATAS, Volumetrica) increasingly expected at the top end. Merit v1 is Rithmic-native by constitution; the platform-list gap is a marketing question, not an engineering one (Rithmic feeds NinjaTrader, Quantower, ATAS, etc.).
4. **A dashboard that shows live rule state** (drawdown floor distance, consistency meter, days-to-eligible): every top firm has one; traders screenshot them constantly.
5. **Discount-code culture**: perpetual 40-50% codes; list price is fiction. Coupons and per-affiliate codes are launch-day requirements (M3).
6. **Discord as the primary community/announcement channel** (Tradeify: 102K members) with X for payout-proof marketing.
7. **EOD drawdown as the marquee "fair rules" feature** (Apex 4.0 default, Lucid, Alpha, MFF Core, TradeDay option). The industry converged on Merit's founding rule model.
8. **One-step / short evals and instant-funded products** (TPT 1-step, Tradeify Lightning, LucidDirect, MFF Rapid). Merit's three-plan lineup matches the market shape.
9. **Certificates/share cards and referral programs**: universal.
10. **Automated payout review** (Apex 4.0 "automated review", MFF instant-approve). Manual-review-by-default is now a competitive liability.

## Gaps nobody serves (Merit openings)

1. **Voluntary stats transparency at platform level.** Only TradeDay publishes a pass rate, and only as a blog figure. Nobody auto-publishes trailing pass rates, payout totals, and average payout from the engine itself (M12). The FTC-adjacent regulatory direction and the review-war both reward whoever does this first.
2. **Zero-denial payout policy stated as policy.** Every firm reserves discretionary review at request time; Apex's "under review" complaints and Topstep's payout-time deletions are the top trust-killers in current reviews. Merit's detection-time-only enforcement is a structural differentiator no competitor claims.
3. **Rules provably identical to enforcement.** Topstep's real-time-MLL-vs-expectation complaints and the FundingTicks retroactive-change scandal show the market's #1 wound is label-vs-engine gaps. Config-versioned rules rendered live to marketing (constitution §0 item 5) is unserved.
4. **Rule stability commitments.** 2026's cadence of caps cut (Topstep April), consistency changed (Apex March), plans retired (Tradeify March) means "your account keeps the rules it was sold under" (our plan_version pinning) is a marketable promise nobody makes explicitly.
5. **Honest liability mechanics disclosed** (caps/gaps/ladders explained as what they are). Firms hide these in help centers; Merit can publish the why.
6. **A serious trader-facing eligibility breakdown** (gate-by-gate "here's exactly what's missing for your payout", our `GET /accounts/:id/eligibility`). Current dashboards show progress bars but not the full gate logic.

## Contradictions / notes for DECISIONS.md

- **No constitution contradictions.** The §1B firm list needed one swap (Alpha Futures in, FuturesElite to watchlist), which §1B explicitly authorizes.
- **Market drift worth noting (no amendment required):** (a) several top firms now run CQG or dxFeed rather than Rithmic (TradeDay is 100% CQG; MFF is dual CQG+dxFeed), so Rithmic-native remains valid but the B3 adapter-interface directive is more important than the constitution implies; (b) payout-cap direction across the market is tightening (Topstep cuts) while consistency direction is loosening (Apex 30→50%), so Merit's plan parameters sit comfortably inside current market norms; (c) win-day/qualifying-day resets after payout (Tradeify pattern cited in constitution M1) confirmed still current.
