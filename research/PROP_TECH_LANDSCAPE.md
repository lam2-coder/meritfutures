---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md]
last_updated: 2026-08-14
---

# Prop-Tech Vendor Landscape (Constitution §1)

Teardown of the vendors that define the feature bar for trader-funded firms, a vendor × capability matrix, the MUST/SHOULD/LATER cut for Merit v1, and the list of features that would force data-model changes if bolted on later. Research performed 2026-08-13 via live web sources; citations inline. Amended 2026-08-14 with a primary source (Axcera brochure, section 1.2 and 2.1); no gate reopened. Refresh cadence: before Wave 2 freeze, then monthly through launch.

## 1. Vendor teardowns

### 1.1 Quant Technology Group / YourPropFirm (the surface-set ceiling)

YourPropFirm (YPF) is the industry's most complete operating system and defines the maximal feature surface. Claims: 85+ firms, 2.75M+ provisioned accounts, $238.4M client revenue attributed, 99.98% uptime. No public pricing or time-to-launch figures. ([quanttechnology.com/yourpropfirm](https://quanttechnology.com/yourpropfirm))

Modules observed on their site:
- **Trader portal:** challenge phase tracking, equity curves, R-multiple metrics, payout request/history, verified-trader certificates.
- **Challenge engine:** 1/2/3-step and instant programs, per-phase rule sets (drawdowns, targets), reset/retry policies, scaling plans across tiers. This is the no-code program editor the constitution explicitly excludes for Merit (single-tenant, config-versioned instead).
- **Payout workflow:** request → review → approve → settle; multi-rail multi-region settlement; configurable splits and holds; PSP routing and failover; automatic ledger reconciliation; 1099/W-8 tax handling. Note: their default pipeline includes a review stage; Merit's zero-denial instant-approve is a deliberate divergence, not a parity gap.
- **Risk:** native rule engine wired to **QuantSentry** (AI-native risk platform, launched as a standalone product for firms of all sizes; breach detection, pattern-based forensics, pre-payout review queue). ([thestockdork.com](https://www.thestockdork.com/quant-technology-group-launches-quantsentry-an-ai-native-risk-platform-for-prop-firms-of-all-sizes/))
- **Operator CRM:** unified trader timeline, tickets with macros/playbooks, segmentation, lifecycle automations, SLA dashboards.
- **Affiliate/IB:** n-tier hierarchies, click-to-fund attribution, automated partner payouts, partner portal and statements.
- **Also:** lifecycle email (journeys, segments, A/B), analytics/BI (cohort funnels, P&L, payout health, agent SLA), support inbox with AI suggestions, trader mobile app (iOS/Android), platform sync (cTrader, DXtrade, MatchTrader, TradeLocker), marketing CMS.

**Read for Merit:** YPF's breadth exists because they are multi-tenant and multi-asset. Every module maps to a Merit module (M4/M5/M6/M7/M8/M9/M10/M16), but Merit's single-tenant futures-only EOD scope removes the program editor, multi-platform sync, and multi-region complexity, which is precisely why the constitution's 2-3 month estimate is plausible against their "18-24 months, $5-10M" positioning.

### 1.2 Axcera (module boundaries as a hint; pricing now verified)

Modular suite: **Prop CRM** (multiphase challenges, onboarding, trader area), **Broker CRM**, **Trading APIs**, and **RiskGuard** as a separable risk layer usable standalone or integrated. Covers forex, futures, crypto, equities. ([axcera.io](https://axcera.io/), [axcera.io/solutions/risk-guard](https://axcera.io/solutions/risk-guard), [fundedtrading.com review](https://fundedtrading.com/tech-provider/axcera/))

**Verified pricing (primary source: Axcera Futures Solution brochure, February 2026, obtained 2026-08-14).** Supersedes the earlier unverified competitor claim of $5K-30K/month:

- **$15,000 one-time setup; $5,000/month fixed fee; hosting billed at cost, roughly $1,000/month.**
- **One futures platform included; each additional futures platform is +$5,000/month.**
- **Launch timeline 6 to 8 weeks; support SLA under 1 hour.**
- Brochure feature nuggets routed to plan docs as SHOULD/LATER inputs: per-trade certificates (M11), Trustpilot auto-review request on payout settlement (M12, compliance check required when specced), free-trial accounts and rule-based promo campaigns (M17), affiliate commission vesting/holds (M8).
- Supported-platform list includes Black Arrow, BookMap, and DeepMap (added to DATA_CAPABILITIES' front-end inventory; no v1 impact). The brochure **still lists ProjectX** despite the February 2026 Topstep exclusivity (section 1.5), so treat the platform list as corroborating evidence only, not current procurement fact.

**Named gotcha: the stealth rev-share.** The "fixed fee, no revenue share" positioning carries two revenue-indexed escalators in the brochure fine print: the monthly fee increases by **$10,000/month, ongoing, once firm revenue exceeds $250K/month**, and the contract **auto-upgrades to the next tier above $150K/month revenue or 2,500 accounts**. A fee that steps with revenue is a revenue share with extra steps. File it alongside DXtrade's chargeable-active-user model (section 1.4) and PropForge's per-active-account fee (section 1.9) as the third pricing-trap pattern: when evaluating any vendor, **verify what indexes the fee, not what the pricing page calls it.**

**Read for Merit:** Axcera considering RiskGuard separable confirms our M7 boundary (risk as a detector-source pluggable module with its own flag schema). Their CRM/Trading-API split mirrors our M6 (admin) vs M2 (bridge) split. Fixed-fee-no-rev-share is their sales wedge against FPFX; now known to be conditional on staying under the revenue escalators, which matters if we ever buy a bolt-on and is quantified in the TCO comparison (section 2.1).

### 1.3 FPFX Tech / PropAccount (the calibration anchor)

End-to-end automation for funded-account firms: custom plan configs, automated account creation, risk monitoring, auto-liquidations, notifications, discount codes, certificates, contests, affiliate portals, leaderboards, trader dashboard + admin CRM. API-first; claims most firms live within 7 days. Platform support: MT4/5, cTrader, DXtrade, MatchTrader, Rithmic, GooeyTrade; rev-share plus capital-backing business model (PropAccount). ([fpfxtech.com](https://www.fpfxtech.com/), [fpfxtech.com/tech-kit](https://www.fpfxtech.com/tech-kit), [propaccount.com](https://propaccount.com/))

**Their public dataset is our economics calibration anchor:** 300,000+ accounts across 10 firms: **14% pass challenges; ~45% of funded reach a payout (7% of all buyers); average payout ~4% of account size**; successful traders' aggregate ROI ~4x fees paid. ([Finance Magnates exclusive](https://www.financemagnates.com/forex/analysis/exclusive-only-7-of-300000-prop-trading-accounts-achieved-payouts/)) These land inside the constitution §5.3 calibration bands (pass 12-20%, funded→payout 40-55%), which is confirmation the bands are realistic.

### 1.4 DXtrade XT / Devexperts (bundle economics warning)

White-label platform extended to US futures for prop firms; 40+ prop firms onboarded to DXtrade in a year; SaaS model launches in 7-14 days starting ~$5,000/month (public floor; constitution's $12K setup / $4,800/mo / $24-per-account figures are consistent with reported quotes). The chargeable-user-by-active-status model is the trap to remember: you pay for every account whose status is active, which is why our M2 entitlement-hygiene job (auto-disable closed accounts) exists. ([dx.trade prop trading](https://dx.trade/prop-trading-technology/), [Finance Magnates](https://www.financemagnates.com/forex/devexperts-onboarded-over-40-prop-firms-to-dxtrade-xt-in-a-year-now-focuses-on-futures/))

### 1.5 ProjectX / TopstepX (the UX benchmark, now exclusive)

**Market-structure change since the constitution was written:** ProjectX (built by Sims2Funded) ended its third-party service offering effective **February 2026**; Topstep signed an exclusive deal in November 2025 and relaunched it as **TopstepX**. Firms that white-labeled it (Bulenox ProjectX, TradeDayX, AlphaTicks) have migrated to Tradovate, Rithmic front-ends, Volumetrica, and Quantower. ([Finance Magnates](https://www.financemagnates.com/forex/prop-firms-report-futures-prop-tech-provider-projectx-to-end-its-third-party-service-offering/), [fortraders.com](https://fortraders.com/blog/project-x-trading), [damnpropfirms.com](https://damnpropfirms.com/best-prop-firm-trading-platforms/projectx/))

**Read for Merit:** (a) TopstepX remains the futures-native trader-UX benchmark to study (browser front-end on real-time infrastructure, integrated evaluation state). (b) The exclusivity event validates the constitution's Rithmic-native decision: firms that rented their front-end got rugged; firms on open platform stacks (Rithmic + NinjaTrader/Quantower/Tradovate connections) kept optionality. (c) It also means the "browser platform included" table-stake is now harder for small firms to meet, widening the field for Rithmic-connected third-party platforms as the standard trader offering.

### 1.6 Tickblaze (integrated 3-in-1 architecture)

Hybrid multi-asset platform (desktop/web/mobile) + native OMS/OME + purpose-built prop CRM back office, launched as a "3-in-1" stack (Nov 2025). Back office includes KYC onboarding, challenge/evaluation engine, and a payout engine with Stripe Connect, ACH, wire, crypto. CME market-data distribution partnership for direct in-platform futures data; Elite Trader Funding is live on it. ([tickblaze.com/prop-firm-partner](https://tickblaze.com/prop-firm-partner/), [BusinessWire](https://www.businesswire.com/news/home/20251125387210/en/Tickblaze-Sets-New-Industry-Standard-with-Launch-of-3-in-1-Prop-Firm-Technology-Stack), [Finance Magnates](https://www.financemagnates.com/forex/prop-firms-get-faster-cme-access-via-tickblaze-following-similar-plus500-and-topstep-deal/))

**Read for Merit:** their integration of evaluation engine directly with the OMS is the architecture Merit deliberately avoids in v1 (we delegate intraday risk to Rithmic's auto-liquidator and compute EOD). Their payout-rail spread (Stripe Connect/ACH/wire/crypto) is a useful checklist against Rise's coverage.

### 1.7 Trade Tech Solutions (widest futures platform matrix)

Supports MT4/5, TradeLocker, cTrader, MatchTrader, DXtrade, **Volumetrica, Tradovate Prop, NinjaTrader Prop, Rithmic, Quantower, ATAS, ProjectX (historical), DeepCharts, DeepMap**. V4.0 adds scale automation and risk control. Automated detection of copy trading, hedging/inverse trading, news trading, IP anomalies, with rule-triggered automatic actions; KYC integrations; **semi-automated payouts (eligibility auto-processed, final approval human)**. Powers Goat Funded Trader/Goat Funded Futures and other top-10 CFD firms; multiple UF Awards. ([tradetechsolutions.io](https://www.tradetechsolutions.io/), [Finance Magnates](https://www.financemagnates.com/thought-leadership/trade-tech-solutions-awarded-most-innovative-and-best-prop-firm-tech-provider-at-uf-awards-apac-2025/))

**Read for Merit:** their fraud-detection list (copy/inverse/news/IP) is exactly our M7 tier-1 detector set, confirming that surface is table-stakes for operators even when payouts are "semi-automated." Merit going full-auto on payouts with detection-time-only enforcement remains a differentiator no vendor default matches.

### 1.8 Match-Trade Technologies (forex-centric, futures-curious)

Prop solution around the Match-Trader platform: custom dashboards, public leaderboards, automated onboarding, integrated payments, affiliate systems, prop CRM, TradingView charts; now marketing challenge-based trading with futures-specific evaluation rules. PWA distribution instead of app stores. ([match-trade.com/products/proptrading](https://match-trade.com/products/proptrading/), [match-trader.com/prop-trading](https://match-trader.com/prop-trading/))

### 1.9 Newer entrants scanned

- **PropForge** (propforge.io): operator-built bundle of CRM, dashboard, challenge engine, payout system, KYC, fraud detection, risk; live in 2 weeks; **flat monthly fee + small per-active-account fee** (the DXtrade active-status billing pattern again). ([propforge.io](https://propforge.io/))
- **Propriotec** (propriotec.com): positions directly against Axcera on price transparency; confirms a mid-market tier now exists under the enterprise vendors. ([propriotec.com](https://propriotec.com/alternative/axcera))
- **Hashcodex**: white-label all-in-one (onboarding, evaluations, risk, payouts, CRM) marketed at new firms; representative of a commodity low-end tier. ([Medium overview](https://medium.com/coinmonks/leading-companies-offering-prop-firm-technology-solutions-in-2026-bc983351309e))
- **Track360**: publishes a prop-firm tech-stack buyer's guide; a signal that the buy-side market is now mature enough to have comparison media. ([track360.io](https://track360.io/blog/prop-firm-software-buyer-guide-2026))
- **Phidias**: futures-focused dashboard provider expanding NinjaTrader/TradingView integrations in 2026; real-time rule-compliance dashboards. ([quantvps.com](https://www.quantvps.com/blog/prop-firms-compatible-with-quantower))

No scanned entrant ships a capability outside the YPF surface set; differentiation is price, launch speed, and platform coverage, not features.

### 1.10 Operating-firm surface notes (UX truth, deepened in TOP10_FIRMS.md)

- **MyFundedFutures**: instant auto-approval on most payout requests; manual reviews 6-12 business hours; Rapid plan pays 90/10 with payout eligibility every 24h from first funded trade once buffer + $500 minimum met; buffer = MLL + $100. The 4.9-star crown is earned on payout speed and rule clarity. ([MFF help center](https://help.myfundedfutures.com/en/articles/13745661-payout-policy-overview-best-and-fastest-prop-firm-payouts), [test-max.com](https://test-max.com/prop-firms/myfundedfutures/))
- **Lucid**: markets minutes-fast payouts (LucidDirect: no-eval instant sim-funded accounts with cycle profit goals). Speed as brand.
- **FundedNext Futures**: progressive cap release after later withdrawals (candidate Merit v1.1 mechanic, M14).
- Details, dates, and the rest of the top-10 in [TOP10_FIRMS.md](TOP10_FIRMS.md).

## 2. Vendor × capability feature matrix

Legend: ● full, ◐ partial/add-on, ○ absent/unknown. "Merit v1" column = what we build (B) or buy (K) per constitution.

| Capability | YPF/QTG | Axcera | FPFX | DXtrade XT | Tickblaze | TTS | Match-Trade | PropForge | Merit v1 |
|---|---|---|---|---|---|---|---|---|---|
| Trader dashboard (phase, KPIs, equity) | ● | ● | ● | ● | ● | ● | ● | ● | B (M4) |
| No-code program/challenge editor | ● | ● | ● | ◐ | ● | ● | ● | ● | EXCLUDED (versioned configs instead) |
| Payout pipeline w/ review stage | ● | ● | ● | ◐ | ● | ● (semi-auto) | ◐ | ● | B (M5, zero-review by design) |
| Multi-rail settlement + tax forms | ● | ◐ | ◐ | ○ | ● | ◐ | ◐ | ◐ | K (Rise) |
| Risk/fraud engine (copy, inverse, news, IP) | ● (QuantSentry) | ● (RiskGuard) | ● | ○ | ◐ | ● | ◐ | ◐ | B tier-1 (M7), vendor bolt-on later |
| Ledger/accounting reconciliation | ● | ◐ | ◐ | ○ | ◐ | ◐ | ○ | ◐ | B (event-sourced ledger) |
| Affiliate/IB portal + attribution | ● (n-tier) | ● | ● | ○ | ◐ | ● | ● | ◐ | B flat v1 (M8; parent_id reserved) |
| Lifecycle messaging (journeys, A/B) | ● | ◐ | ◐ | ○ | ◐ | ◐ | ◐ | ○ | K (Loops/Customer.io) (M10) |
| Analytics/BI (cohorts, payout health) | ● | ● | ◐ | ○ | ◐ | ● | ◐ | ◐ | K (Metabase) + M6 liability dashboard |
| Support/ticketing w/ trader context | ● | ◐ | ◐ | ○ | ◐ | ◐ | ◐ | ○ | K (Chatwoot) (M10) |
| Certificates / share cards | ● | ● (incl. per-trade) | ● | ○ | ◐ | ◐ | ◐ | ○ | B (M11) |
| Leaderboards / contests | ◐ | ◐ | ● | ○ | ● | ◐ | ● | ○ | LATER |
| KYC integration | ● | ● | ◐ | ○ | ● | ● | ◐ | ● | K (dedicated provider, M19) |
| Trader mobile app | ● | ◐ | ◐ | ● | ● | ◐ | ◐ (PWA) | ○ | LATER (mobile-first web instead) |
| Marketing CMS / program catalog | ● | ◐ | ◐ | ○ | ◐ | ◐ | ◐ | ○ | B static (M9) |
| Futures platform breadth (Rithmic et al.) | ◐ | ◐ | ◐ (Rithmic yes) | ● (own platform) | ● (own platform) | ● (widest) | ◐ | ◐ | Rithmic-native only |
| Trading contest engine | ◐ | ○ | ● | ○ | ◐ | ○ | ◐ | ○ | LATER |
| Public transparency/stats page | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | B (M12), nobody ships this |

Two cells matter most: **no vendor ships a public transparency platform** (M12 is open field), and **no vendor defaults to fully automatic payout approval** (Merit's zero-denial pipeline is structurally differentiated, not just faster).

The Axcera column was re-verified against the February 2026 brochure (primary source, section 1.2): certificates upgraded to full (per-trade certificates ship), and its futures-platform breadth stays ◐ because every platform past the first is a $5K/month add-on.

### 2.1 Three-year TCO comparison (buy vs build, amended 2026-08-14)

Cash outlay over 36 months at Merit's planned scale. Build labor is excluded on the self-build row by design: the constitution's premise is that the founder plus Claude Code are the build, so the comparison is cash out the door.

| Option | Basis | 3-year TCO |
|---|---|---|
| **Axcera Futures Solution** | $15K setup + $5K/mo fixed + ~$1K/mo hosting at cost = ~$231K baseline, single platform. The stealth rev-share escalator (+$10K/mo above $250K monthly revenue) and the auto-tier-upgrade (above $150K/mo revenue or 2,500 accounts) put Merit's plan into escalator territory well inside 3 years; each additional futures platform is another $180K over the period | **~$220-280K** |
| **YPF / QTG** | No public pricing; reported enterprise quotes put the realistic 3-year floor here, before per-account and module add-ons | **~$125K+** |
| **DXtrade XT** | $12K setup + $4,800/mo = ~$185K, plus $24 per chargeable active account (the entitlement-hygiene trap, section 1.4) | **~$190K+** |
| **Self-build (Merit)** | Infra only: Neon + Railway + Cloudflare, ~$200/month per the approved ADR-007 stack | **~$7K** |

Three readings. First, the buy options cluster at $125K-280K over 3 years while carrying the constraints Merit's constitution rejects (multi-tenant program editors, review-stage payout defaults, per-account billing). Second, Axcera's brochure makes the buy-side pricing concrete for the first time and it lands at the **top** of the cluster at Merit's plan, because the escalators activate exactly when a firm succeeds. Third, the ~30x gap between any buy option and self-build cash cost is the constitution's build decision restated in vendor-verified numbers; the real cost of self-build is founder time and delivery risk, which the planning corpus exists to control. Platform and data fees (Rithmic IDs, CME data) are common to every row and excluded.

## 3. MUST / SHOULD / LATER for Merit v1

**MUST (table-stakes confirmed across every vendor + top firms):**
trader dashboard with live rule state; versioned plan configs rendered to marketing (our substitute for the program editor); payout request → instant approve → Rise settle with status timeline; certificates (pass/payout share cards); affiliate codes + attribution + statements; KYC via dedicated provider; risk tier-1 detectors (copy-cluster, inverse-P&L, news-window, velocity) with evidence packs; admin liability dashboard; lifecycle email triggers; support with account context; entitlement hygiene (auto-disable closed accounts).

**SHOULD (competitive but v1-scope-safe):**
public stats/transparency page (M12; differentiator, cheap because engine computes it anyway); notification preference center (M16); reset/rebuy offers at contextual pricing (M17 minimal: fixed reset price v1); Discord role sync (M15 minimal); trader analytics beyond equity curve (M13 minimal: daily P&L table + consistency meter).

**LATER (explicitly deferred):**
mobile native apps; leaderboards/contests; n-tier sub-IB trees; no-code program editor (never, by constitution); multi-platform support beyond Rithmic (adapter interface reserved); AI copilot/journal features; progressive cap release (M14, v1.1 per constitution); QuantSentry/RiskGuard-class vendor bolt-on (flag schema designed for it).

**Additions from the Axcera brochure (2026-08-14), all SHOULD/LATER, none v1 MUST:** per-trade certificates (M11); Trustpilot auto-review request on payout settlement (M12, with a mandatory ToS/platform-policy compliance check when specced); free-trial accounts and rule-based promo campaigns (M17); affiliate commission vesting/holds (M8, corroborates the OQ-M8-01 holdback as market practice). Each is recorded in its module plan doc as a drafting input.

## 4. Features that would change the data model if added later (reserve schema now)

1. **Second trading platform (Tradovate adapter)** → `accounts.platform` enum + `platform_account_ref`; `fills.venue`, `fills.order_id`, `fills.correction_of` (already directed by B3). Reserve now.
2. **Progressive cap release (FundedNext mechanic)** → per-account payout-count-indexed cap schedule; make `plan_versions.rules.payout_cap` an array/step function, not a scalar. Reserve now (cheap: config shape).
3. **Sub-IB hierarchies** → `affiliates.parent_id` (already in constitution) + per-level commission splits in statements. Reserve `parent_id` + `level` now.
4. **Contests/leaderboards** → opt-in visibility flag + display-name on `users`; contest entity keyed by plan/period. Reserve `users.display_name`, `users.leaderboard_opt_in`.
5. **Trader mobile app / push** → device token registry per identity (M16's preference matrix should include a `channel` enum with `push` from day one).
6. **Vendor risk bolt-on (QuantSentry-class)** → `risk_flags.source` (internal|vendor:name) + vendor payload passthrough JSON. Constitution already directs this; confirm in DATA_MODEL.
7. **Live brokerage graduation (Topstep Brokerage pattern)** → `accounts.phase` already includes `graduated`; reserve `graduation_invitations` table concept + external broker ref field.
8. **Multi-currency payouts** → keep `ledger_entries.currency` (ISO code) even though v1 is USD-only integer cents.
9. **Bonus/vault mechanics (Apex Bonus Vault pattern)** → a ledger account class for promotional credits, distinct from withdrawable; design the chart of accounts with an expandable account-type enum.
10. **Per-active-account vendor billing (if we ever buy)** → account status history table (already implied by events) so "active during month M" is provable; no extra reservation needed beyond append-only events.

## 5. Contradictions / amendment candidates

- **No contradictions with the constitution found.** The §1 vendor list, the buy-vs-build split, and the single-tenant rationale all survived contact with current data.
- **Context update (no amendment needed):** ProjectX is no longer licensable (Topstep-exclusive since Feb 2026); the constitution already labeled it Topstep-owned and only directed UX study, which TopstepX still serves.
- **Calibration confirmation:** FPFX's 14% pass / 45% funded-to-payout aligns with §5.3 bands; no band change proposed.
- **Wave 1 amendment, 2026-08-14 (no gate reopened).** The actual Axcera Futures Solution brochure (February 2026) was obtained, the doc's first primary vendor source. Folded in: verified pricing (section 1.2), the stealth rev-share gotcha named as a pricing-trap pattern, the 3-year TCO comparison (section 2.1), matrix cell corrections, SHOULD/LATER nuggets routed to M8/M11/M12/M17, and Black Arrow/BookMap/DeepMap added to DATA_CAPABILITIES' inventory. Nothing contradicts an approved decision; the brochure narrows unknowns and strengthens the build case, so the doc stays `approved`.
- **Corroboration note:** the brochure still lists ProjectX as a supported platform despite the Feb 2026 exclusivity, which dates the platform list and confirms vendor marketing lags market structure. Weigh brochure platform lists as corroborating evidence only.

## Sources

Key sources cited inline. **Primary document: Axcera Futures Solution brochure, February 2026 (on file, obtained 2026-08-14).** Web primaries: [quanttechnology.com](https://quanttechnology.com/yourpropfirm), [axcera.io](https://axcera.io/), [fpfxtech.com](https://www.fpfxtech.com/), [propaccount.com](https://propaccount.com/), [dx.trade](https://dx.trade/prop-trading-technology/), [projectx.com](https://www.projectx.com/index.html), [tickblaze.com](https://tickblaze.com/prop-firm-partner/), [tradetechsolutions.io](https://www.tradetechsolutions.io/), [match-trade.com](https://match-trade.com/products/proptrading/), [propforge.io](https://propforge.io/), [Finance Magnates 300K-account exclusive](https://www.financemagnates.com/forex/analysis/exclusive-only-7-of-300000-prop-trading-accounts-achieved-payouts/), [Finance Magnates on ProjectX](https://www.financemagnates.com/forex/prop-firms-report-futures-prop-tech-provider-projectx-to-end-its-third-party-service-offering/), [MFF help center](https://help.myfundedfutures.com/en/articles/13745661-payout-policy-overview-best-and-fastest-prop-firm-payouts).
