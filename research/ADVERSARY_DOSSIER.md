---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, TOP10_FIRMS.md]
last_updated: 2026-08-13
---

# Adversary Dossier (Constitution Appendix A, instantiated)

The 9-scheme taxonomy from Appendix A, populated with current intel (researched 2026-08-13). Each scheme carries: current mechanics, the detection signal M7 must implement, and a golden-test scenario note for testing/GOLDEN_SCENARIOS.md (numbered GT-A1 through GT-A9 here; final numbering happens in Wave 4). The kill-chain frame remains: rings bound by rules, caught by detection, made unprofitable by both, and the reserve survives whatever leaks through.

**Industry temperature check:** coordinated extraction is now openly reported industry-wide. Finance Magnates documents groups that buy challenges at two firms, place opposite positions, and, notably, **pressure firms into paying even after being caught, weaponizing negative publicity** ("firms find themselves in a lose-lose situation," per PipFarm CEO James Glyde). Alpha Capital Group blocked 150 users for group trading; prop firm Karma shut down entirely, blaming challenge exploiters. An estimated 80-100 prop firms closed 2023-2026, largely from automated strategies extracting from simulator pricing. ([Finance Magnates](https://www.financemagnates.com/forex/coordinated-groups-are-exploiting-prop-trading-models-with-arbitrage/), [Quantt](https://www.quantt.co.uk/resources/latency-arbitrage-explained)) The publicity-pressure finding directly validates Merit's evidence-pack doctrine: enforcement must ship with court-grade evidence precisely because adversaries litigate in public.

---

## Scheme 1: Intra-firm hedge pairs/rings

**Current mechanics.** Two+ accounts take opposite sides of the same instrument; one side is mathematically guaranteed to pass or reach payout. Confirmed current and ubiquitous; firms describe it as turning "the firm's payout pool into a fixed-cost extraction scheme" and it rarely receives first-offense leniency because the pattern proves intent. ([TakeProfit Trader explainer](https://takeprofittrader.com/blog/what-is-prop-firm-hedging), [TradersYard](https://tradersyard.com/blog-posts/what-is-prop-firm-hedging))

**Economics on Merit rules (recomputed, still holds).** Pair cost 2× eval fee; funded-side prize bounded by cap × split ($1,500 × 90% = $1,350/request); consistency + 5 win days + cadence gap force multi-day grinding, ceiling ~$190/day. Not riskless, not fast. On uncapped/daily competitors the same play yields $270+/day repeatable.

**Detection signal (M7).** Rolling correlation of daily P&L between account pairs < −0.8 (the constitution's threshold, confirmed as the industry-standard signature: "equal and opposite positions, matched lot sizes, synchronized entry timing"); mirrored size/timing on the same instrument; shared entity-graph edges (device/IP/payment) elevate severity but are NOT required. Unlinked inverse pairs still flag.

**GT-A1 (the ring rehearsal, extends B4 #21).** Six accounts, three hedged pairs, staggered entries ±2s, sizes matched within 10%. Expected: inverse-correlation detector flags all three pairs by day 3; caps clamp cumulative extraction to the computed ceiling; evidence pack contains the correlation series and paired fill timeline.

## Scheme 2: Cross-firm hedge syndicates

**Current mechanics.** Long at Merit, short at Apex; invisible to any single firm's data. Now a fee-based membership industry: coordinated groups sell entry, split proceeds, and use the publicity-pressure play on detection. ([Finance Magnates](https://www.financemagnates.com/forex/coordinated-groups-are-exploiting-prop-trading-models-with-arbitrage/))

**Detection signal.** Single-firm data cannot see the other leg. Proxies: accounts that trade only around high-conviction directional moments with abnormal win-rate-vs-hold-time profiles; entity-graph links to known scheme 1 flags; geography/device overlap with other flagged cohorts. True detection needs a shared-vendor network (QuantSentry-class bad-actor DB claims 10,000+ verified threat profiles, the bolt-on argument; [RiskGuard](https://axcera.io/solutions/risk-guard), [QuantSentry review](https://alexfirdaus.com/quantsentry-review/)).

**Posture: accept, bound, budget.** Caps bound per-account damage; the 8-payout ladder bounds lifetime damage; the reserve prices the leak-through. No detector spec v1 beyond the proxies above.

**GT-A2.** Simulated single-leg extractor: account trades twice a month, only large NFP-day directional wins, hits cap each cycle. Expected: no breach (rules honored), velocity/pattern flag raised at low severity, liability forecast counts it, ladder graduates it out after 8 payouts. This is the "we survive what we cannot see" test.

## Scheme 3: Paid passing services and account management

**Current mechanics.** Openly advertised market with Trustpilot-reviewed storefronts (e.g., "Pass My Prop Firms", "Prop Funded Kings") and Telegram operators; standard offer is pass-your-eval for a fee or 50/50 profit split on managed accounts; scams-within-the-scam are common (operators taking fees and vanishing). Every reputable firm bans third-party passing as a ToS breach with forfeiture. ([Forex Factory thread](https://www.forexfactory.com/thread/1377376-best-prop-firm-passing-funded-account-management), [Trustpilot: passmypropfirms](https://www.trustpilot.com/review/passmypropfirms.xyz), [Forex Peace Army report](https://www.forexpeacearmy.com/community/threads/telegram-group-or-person-who-proposes-to-help-pass-prop-or-manage-forex-trading-accounts.88103/), [JP Trading Capital legal take](https://www.jptradingcapital.com/blog/en/is-it-legal-to-use-someone-else-to-pass-prop-firm-challenge))

**Detection signal (M7 + M19).** Same-second fill clustering across "unrelated" accounts (one operator, many customers); identical trade sequences; login geography vs KYC-country mismatch; device/IP overlap across identities; sudden style change between eval (operator) and funded (customer) phases; M19 biometric dedupe catches the operator who also KYCs accounts.

**GT-A3.** Twelve accounts across ten identities; eight execute near-identical sequences within ±2s during eval, then four diverge stylistically once funded (handback). Expected: copy-cluster detector groups the eight; style-shift heuristic flags eval-vs-funded divergence; entity resolver links two identities by device.

## Scheme 4: Copy-ring rentals / signal herds

**Current mechanics.** Commercial copiers (TradeSyncer: 200+ accounts, sub-100ms mirroring, marketed openly with discount codes) make correlated cohorts trivial to assemble. Firms have responded with explicit policy splits: self-copying across your own accounts is broadly allowed (Apex: 20-account ceiling with one leader; Tradeify: 5 per household); copying *others* is banned. The risk is not always ToS-illegal behavior: it is the correlated-payout spike the reserve must price. ([TradeSyncer](https://damnpropfirms.com/trading-tools/tradesyncer/), [Track360 operator guide](https://track360.io/blog/trade-copier-copy-trading-in-prop-firms-operator-guide-2026), [thortradecopier detection guide](https://thortradecopier.com/blog/how-prop-firms-detect-copy-trading))

**Detection signal.** Sub-second fill matching across accounts (industry: shared IP + fills within ~10ms = flag); graph-based clustering on (instrument, direction, timestamp, size-ratio); entity-cap enforcement per resolved identity, not email; correlated-cohort exposure surfaced in M6 liability dashboard (aggregate same-direction open risk).

**GT-A4 (extends B4 #21/#22).** Twenty accounts under seven entities mirror one leader within 150ms for ten days, then all reach eligibility in the same 48h window. Expected: copy-cluster flags by day 2; entity caps clamp accounts 6+ at purchase time; the correlated-eligibility spike trips the payout-velocity alarm (>2.5× 30-day avg) and the Eligible-Next-7-Days forecast shows the wave before it lands.

## Scheme 5: The juice/reviewer extraction culture

**Current mechanics.** Semi-organized community that forensically reads new firms' rulebooks and coordinates timing against gaps; the industry now openly discusses "beating" consistency rules via profit-splitting across days, and firms that mispriced rules died publicly (Karma). Community content teaches cap-gaming as normal practice ("how to beat the consistency rule" is mainstream SEO content, e.g. [newyorkcityservers guide](https://newyorkcityservers.com/blog/prop-firm-consistency-rule)). The "win too much, you lose" narrative ([substack](https://automatedtradingstrategies.substack.com/p/the-prop-firm-paradox-win-too-much)) is the reputational frame Merit's zero-denial policy defuses.

**Defense.** Airtight rule implementation (M1 test battery), caps, strict-but-published launch posture, and marketing copy that never overpromises (§0 item 5). No detector: this adversary attacks the gap between label and engine, so the control is that no gap exists.

**GT-A5.** Adversarial day-sequence fuzz targeting published rule boundaries: alternating +$149.99/+$150.01 days (win-day floor), payout requested the tick after cap-equals-withdrawable, consistency denominator manipulation via one $10K day then flat grind. Expected: engine decisions match published copy exactly, byte-for-byte with the rendered rules page (the marketing=implementation invariant as an automated test).

## Scheme 6: Identity/fleet fraud

**Current mechanics.** One operator, many KYC'd names (synthetic IDs, family documents, VPNs) beating per-entity caps. Confirmed as a priced-in industry problem: KYC providers market face-match dedupe and video verification specifically against account sharing and fleets; firms increasingly demand photo-holding-ID or video checks. ([iDenfy on prop KYC](https://idenfy.com/blog/prop-firm-payout-kyc/), [EBS/Sumsub prop guide](https://www.ebsfintech.com/prop-firm-kyc-a-practical-guide-to-compliance-conversion-with-sumsub/))

**Detection signal (M7 + M19).** Entity resolution before funding: normalized emails (dots/plus), device fingerprint, IP/ASN, payment fingerprint (BIN+last4 hash); M19 biometric dedupe (provider face-match across ALL applicants) as the fleet-killer for one-face-many-names; geo-consistency triangle (IP country vs document country vs payment country).

**GT-A6.** Operator runs 12 accounts under 6 synthetic identities: shared device fingerprint on 4, shared payment BIN+last4 on 3, same face across 2 KYC applications, VPN-rotated IPs. Expected: entity graph collapses 12 accounts to ≤3 entities; account caps enforce at purchase against resolved entity; face-match hit freezes funded progression before liability exists (payouts never reached).

## Scheme 7: Payment-side fraud

**Current mechanics.** Three chargeback forms now standard in prop: friendly fraud (fail the eval, dispute the fee), affiliate-coordinated fraud (partner tells referred buyers to dispute after CPA is paid), stolen-card purchases (real cardholder disputes weeks later). Payout-mule and synthetic-identity cash-out rings are named risks in payment-processor guidance; >0.65% chargeback ratio threatens the MID. ([Track360 chargeback guide](https://track360.io/learn/prop-trading-fraud-prevention/chargeback-fraud-payout-protection), [Kenmore Design operator writeup](https://www.kenmoredesign.com/2026/03/19/the-prop-firm-chargeback-problem-how-operators-protect-their-revenue/))

**Detection signal (M3 + M7 + M5).** AVS/CVV strictness at purchase; velocity limits per entity and per BIN; chargeback webhook auto-matches original transaction, closes the account, reverses ledger, flags the identity, and updates the referring affiliate's chargeback rate (the affiliate-coordination signal); Rise payout-name-vs-KYC-identity mismatch = mule flag, freeze before settle.

**GT-A7 (extends B4 #10).** (a) Chargeback lands after a payout settled: identity net-negative, close + flag + ledger shows the loss honestly, no clawback attempt. (b) Affiliate with 12 referred purchases accumulates 4 chargebacks in 30 days: affiliate flagged, attribution voided on pending commissions, alert fires. (c) Payout requested to a Rise identity whose name mismatches M19 KYC: freeze + flag, never silent.

## Scheme 8: Exploit hunting (feed, latency, rule-mechanics)

**Current mechanics.** Sim-feed latency/stale-quote arb remains the documented firm-killer (80-100 firm closures 2023-2026 attributed largely to automated extraction from simulator pricing); commercial HFT-arb software now ships "masking layers" (lot randomization, hold-time extension, manual-simulation) explicitly to evade detection; news-straddle brackets and martingale eval brute-forcing remain standard. ([Quantt](https://www.quantt.co.uk/resources/latency-arbitrage-explained), [BJF "arbitrage masking" marketing](https://bjftradinggroup.com/arbitrage-masking-2026-intelligent-flow-camouflage-ai-detection/), [brokeret legal framing](https://brokeret.com/blog/latency-arbitrage-illegal-legal-vs-contract-platform-rules))

**Merit exposure assessment.** Lower than CFD peers: Rithmic routes to real CME-matched sim (no house-made price feed to arb), and EOD rule computation removes intraday rule-race exploits. Residual: news-window straddles (allowed at competitors like Lucid, a marketing tension to resolve in plan copy), martingale brute-forcing across cheap resets, and platform bug abuse.

**Detection signal.** Maintained Tier-1 economic calendar as data; entries within ±N sec of calendar events flagged as pattern (never single events); size-after-loss regression for martingale at strategy level; reset-velocity per entity (brute-force signature: many cheap resets, each with all-in risk profile); fill-vs-quote sanity in recon (stale-fill detection deferred to M2 reconciliation).

**GT-A8.** (a) Martingale brute-forcer: entity buys 6 resets in 30 days, each account shows size-doubling-after-loss regression slope above threshold; expected: strategy-level flag with reset-velocity evidence, not single-trade enforcement. (b) News-straddler: bracket entries ±3s around 8 consecutive Tier-1 releases; expected: pattern flag with calendar-join evidence after N occurrences, zero flags for a single event.

## Scheme 9: Insider/process leaks

**Current mechanics.** Leaked promo codes, support social-engineering (account transfers, KYC swaps), affiliate self-dealing (buying through own code). No new public incident intel found this pass beyond the standing pattern; the affiliate-coordinated chargeback scheme (scheme 7) is the closest documented cousin. Treat as internally-facing risk.

**Detection signal (M6 + M8).** Append-only audited admin actions with alerting on out-of-hours/out-of-geo actions; code redemption limits + per-code velocity alarms; no support-initiated identity changes without the verification runbook; affiliate self-purchase auto-void (B4 #16); payout-destination changes trigger 48h cooling + re-verification (D4).

**GT-A9 (extends B4 #16).** (a) Affiliate purchases through own code from same device fingerprint as affiliate login: attribution voided, flag raised. (b) Support agent role attempts account-email change without verification-runbook flag set: action blocked, admin alert fires, audit row written. (c) Promo code redeemed 40× in one hour from one ASN: code auto-suspended, alert.

---

## Vendor fraud-marketing review (what the detection industry says the threats are)

- **Axcera RiskGuard**: "antivirus for prop firms"; 10,000+ verified bad-actor profiles, 100K+ accounts monitored monthly, ~100ms detection; Z-score analysis on trade timing/size/instrument/direction for copier networks and hedging; device intelligence + behavioral consistency scoring; shared bad-actor database across client firms. ([axcera.io/solutions/risk-guard](https://axcera.io/solutions/risk-guard), [Axcera blog](https://axcera.io/blog/risk-management-and-fraud-detection-prop-firm))
- **QuantSentry (QTG)**: AI-native risk engine; coordinated-abuse detection, real-time rule enforcement, evidence packs; integrated with YPF's pre-payout review queue. ([launch coverage](https://www.thestockdork.com/quant-technology-group-launches-quantsentry-an-ai-native-risk-platform-for-prop-firms-of-all-sizes/))
- **Trade Tech Solutions**: ships copy/inverse/news/IP detection as standard platform features with rule-triggered auto-actions. ([tradetechsolutions.io](https://www.tradetechsolutions.io/))
- **Takeaway for M7:** our tier-1 detector list matches what vendors sell; the flag schema must accept a vendor `source` field so a shared-network bolt-on (the only real answer to scheme 2) plugs in without migration. The cross-firm bad-actor database is the one capability we cannot build alone; budget for it post-launch.

## Regulatory context (bounded relevance)

CFTC's My Forex Funds case was dismissed with prejudice in May 2025 with sanctions against the agency, cooling the enforcement wave, but a CFTC public consultation running through late 2026 asks whether challenge fees could be treated as commodity-pool participation interests, and US/EU/UK/AU are all pulling challenge firms toward the perimeter. Monitor; not an adversary issue but shapes the disclosure posture (M9's honesty stance is also regulatory positioning). ([Paul, Weiss review](https://www.paulweiss.com/insights/client-memos/cftc-enforcement-2025-year-in-review), [Industry Spread](https://theindustryspread.com/retail-prop-trading-regulation-2026-my-forex-funds-cftc/), [desilva](https://www.desilvalawoffices.com/articles/blog/2025/may/cftc-case-dismissed-my-forex-funds-controversy-h/))

## Contradictions / notes

- **No constitution contradictions.** All 9 schemes confirmed live; thresholds (−0.8 correlation, ±2s clustering, 0.65% chargeback ratio) match current industry practice.
- **New intel the constitution lacks (additive, no amendment needed):** (a) the publicity-pressure extortion pattern post-detection, so evidence packs are a launch requirement, not a nice-to-have; (b) commercial "arbitrage masking" tooling means naive single-signal detectors are already countered, so M7's multi-signal scoring design is correct; (c) affiliate-coordinated chargeback fraud is a named industry pattern, so M8 must track per-affiliate chargeback rate from day one (small M8 spec addition, flagged for the Wave 3 plan doc).
- **Rule-design tension for the founder (carried to plans):** several top firms allow news trading as a marketing feature (Lucid: "no blackout windows"); Merit's news-straddle detector flags patterns, not events, which is compatible with allowing news trading in copy. The plan-doc copy for M9 must say precisely what is allowed so scheme 5 finds no daylight.
