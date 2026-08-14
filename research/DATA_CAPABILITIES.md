---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, PROP_TECH_LANDSCAPE.md]
last_updated: 2026-08-13
---

# Platform Data Capabilities (Constitution B3)

Data matrix for the seven platforms named in B3, the recommended v1 ingest path, and the schema fields to reserve now so future adapters never force migrations. Researched 2026-08-13; several cells require direct vendor conversations (marked OPEN). Those become W1 vendor-call agenda items, front-loaded per §8's risk note.

## 1. Platform matrix

### Rithmic (v1 platform, decided)

- **Data types:** fills/orders/positions per account (tick-by-tick, unaggregated; MBO available), EOD reports, reference data normalized across exchanges. Server-side bracket/OCO/trailing management. ([damnpropfirms R|API guide](https://damnpropfirms.com/trading-guides/rithmic-api-real-time-data-futures-prop-traders/), [rithmic.com/apis](https://www.rithmic.com/apis))
- **Admin scope (the TPAP surface):** **R|Manager** for account management, risk parameter configuration, performance tracking, EOD reporting; the **SFTP File Interface** exposes the same functionality scriptably: upload CSVs, Rithmic processes them automatically. Built explicitly for operations managing hundreds/thousands of accounts. ([rithmic.com/products/r-manager](https://www.rithmic.com/products/r-manager), [rithmic.com/solutions/funding-evaluators](https://www.rithmic.com/solutions/funding-evaluators))
- **Risk enforcement:** rules execute inside Rithmic's infrastructure, not client-side; a disconnected trader remains bound; breach triggers immediate liquidation; the EOD report logs event, time, and exact trigger criterion. This confirms the constitution's delegation of intraday max-loss to Rithmic's auto-liquidator, and means the EOD report doubles as our breach-evidence source.
- **Transport:** SFTP (CSV up/down) for provisioning + reports; R|API+ (C++ class libraries) for programmatic access; R|FIX for FIX; R|Diamond for ultra-low-latency (irrelevant to us).
- **Latency:** sub-250µs platform latency (irrelevant for EOD model; relevant context for why traders accept Rithmic).
- **Auth:** per-User-ID credentials; SFTP keypair for the file interface.
- **Cost:** ~$25/month per User/Trader ID (retail rate); R|API adds ~$100/month per API User ID; routing ~$0.10/contract/side; CME market-depth data ~$30+/month per entitled user for all four CME exchanges (professional rates higher). Constitution's "$30/login-month + data" and "$100/mo API tier" figures confirmed in the right range. ([AMP pricing FAQ](https://faq.ampfutures.com/hc/en-us/articles/360060137993-Rithmic-Pricing), [TraderVPS pricing guide](https://www.tradervps.com/blog/pricing-rithmic-trading-data-feeds))
- **OPEN (vendor call, W1):** exact EOD report file formats and field lists; delivery cadence and timing guarantees; **correction/backdated-fill semantics (CRITICAL for replay determinism, B4 #5)**; sandbox/test environment access pre-agreement; server-side copy configuration; whether admin fill pull via R|API+ requires a dedicated admin User ID and at what cost.

### Tradovate (adapter #2 candidate, confirmed most modern API)

- **Data types:** full account surface (orders, fills, positions, cash balances, user property events) via REST + WebSocket; historical fills retrievable; market data via separate WebSocket. ([api.tradovate.com](https://api.tradovate.com/), [GitHub example-api-faq](https://github.com/tradovate/example-api-faq))
- **Transport:** REST (`live.tradovateapi.com/v1`, demo mirror) + WebSocket (`wss://.../v1/websocket`); event-driven push for fills and cash-balance changes.
- **Auth:** OAuth / access-token (Bearer); demo and live environments cleanly separated.
- **Admin vs trader scope:** API is account-scoped; prop-firm B2B admin arrangements exist (Tradovate Prop). OPEN: admin-tier multi-account pull terms.
- **Latency:** real-time push; more than sufficient.
- **Cost:** OPEN (B2B terms); retail API access is bundled with accounts.
- **Read:** everything our `PlatformAdapter` interface needs exists first-class here; Tradovate as adapter #2 is confirmed low-risk. Note the top-10 drift: MFF/TradeDay/FundedNext already run Tradovate+CQG stacks (see TOP10_FIRMS.md), so adapter #2 has business pull, not just technical elegance.

### dxFeed (market data only; display licensing)

- **Data types:** L1 + full L2 market depth, futures and equities, real-time + historical. No account/fill data, so not an ingest source.
- **Relevance:** only if we render quotes/charts in-portal (v1: we do not; platforms render their own). **Licensing note confirmed:** dxFeed's Vendor-of-Record model means the platform partner (e.g., Volumetrica) carries exchange licensing and usage reporting, so entitlement flows through the front-end vendor, not us. Displaying data ourselves would make us the licensee, a compliance surface to avoid in v1. ([dxfeed.com](https://dxfeed.com/market-data/), [vettedpropfirms dxFeed list](https://vettedpropfirms.com/prop-firms-that-support-dxfeed/))
- **Cost:** VoR-mediated; not our line item in v1.

### CQG (the other feed duopolist)

- **Data types:** consolidated feed (85+ sources), order routing; Client APIs (run co-located with CQGIC), Web API for integrations. ([cqg.com/products/cqg-apis](https://www.cqg.com/products/cqg-apis))
- **Admin scope for a TPAP:** OPEN. Public docs are trader-oriented; fills flow through the FCM relationship. TradeDay runs an all-CQG shop, so an admin data path clearly exists at the FCM/B2B tier, but terms are not public.
- **Relevance:** only if a future plan family targets CQG-fed platforms (TradingView/Tradovate/NinjaTrader route through CQG at several firms). Not v1; the adapter interface is the insurance.

### Volumetrica (dxFeed-based front-end suite with real admin surface)

- **Data types/admin:** white-label trader + admin dashboard; onboarding, suspension/reactivation, individual/group rule assignment; real-time exposure and aggregate P&L; per-trader stats (P&L, win rate, R/R); platform-usage and trading-metric reports.
- **Transport/APIs:** dedicated REST API, WebSocket, webhooks; dxFeed API integration; pre-built connections to ATAS, Quantower, TradingView, DeepChart/DeepDom.
- **Cost:** undisclosed; OPEN if ever considered.
- **Read:** the most complete programmatic admin surface among the front-end vendors, a credible future platform partner if trader demand for orderflow tools materializes. ([volumetricatrading.com/en/futurespropfirm](https://www.volumetricatrading.com/en/futurespropfirm))

### ProjectX (removed from consideration)

Topstep-exclusive since February 2026; third-party service offering ended; not procurable. Its Gateway-API pattern (single API fronting eval accounts for firms) survives as a design reference only. See PROP_TECH_LANDSCAPE.md §1.5. ([Finance Magnates](https://www.financemagnates.com/forex/prop-firms-report-futures-prop-tech-provider-projectx-to-end-its-third-party-service-offering/))

### NinjaTrader (front-end only, for us)

- **Data types:** NinjaTrader as a front-end connects through Rithmic/CQG/Tradovate feeds ([crosstrade NT8 prop guide](https://crosstrade.io/blog/ninjatrader-8-prop-firm-connection-guide)); when traders use NinjaTrader-on-Rithmic, all fills still land in Rithmic's admin surface, so no separate ingest needed.
- **Admin scope:** NinjaTrader Prop (their B2B program) exposes admin tooling to member firms; terms OPEN and irrelevant unless we join their program (we won't in v1; Rithmic User IDs already permit NinjaTrader connections).
- **Read for us:** NinjaTrader is a *platform permission* on the Rithmic provisioning CSV, not a data source. This collapses a whole adapter: fills arrive via Rithmic regardless of front-end.

## 2. Matrix summary

| Platform | Fills/orders | EOD reports | Admin API | Transport | Auth | Admin scope | Cost signal | v1 role |
|---|---|---|---|---|---|---|---|---|
| Rithmic | ● tick-level | ● (formats OPEN) | ● R|Manager + SFTP CSV | SFTP, R|API+ | creds/keypair | full TPAP | $25-30/ID/mo, $100 API, $0.10/ct | THE platform |
| Tradovate | ● REST+WS | ◐ derivable | ● (B2B terms OPEN) | REST+WS | OAuth | account-scoped, B2B tier exists | OPEN | adapter #2, post-v1 |
| dxFeed | ○ (market data only) | ○ | n/a | API via VoR | via partner | n/a | VoR-mediated | none (licensing avoided) |
| CQG | ● via FCM | ◐ | OPEN | Client API, Web API | creds | FCM-mediated | OPEN | none v1; adapter-insured |
| Volumetrica | ● in-suite | ● reports | ● REST+WS+webhooks | REST/WS | API keys | full white-label | undisclosed | none v1; partner candidate |
| ProjectX | n/a | n/a | n/a | n/a | n/a | n/a | n/a | not procurable |
| NinjaTrader | via feed | via feed | B2B program only | n/a | n/a | n/a | bundled | front-end permission on Rithmic |

## 3. v1 ingest path (decision proposal → ADR-002)

**Recommendation: SFTP-first, both directions.**

- **Outbound (provisioning):** CSV over SFTP to Rithmic: accounts, risk settings (max-loss for auto-liquidation), market-data entitlements, platform permissions. This is Rithmic's own scriptable bulk interface, purpose-built for evaluator scale. Idempotent file naming + `provisioning_queue` per M2.
- **Inbound (marks):** **Rithmic EOD report files over SFTP as the primary ingest.** Rationale: (a) the EOD rule model needs exactly and only closed-day data; (b) the EOD report is also the auto-liquidation evidence log (event, time, trigger), which M6 evidence packs want verbatim; (c) file-based ingest is replayable, quarantinable (B4 #4), and testable against golden fixtures without any vendor connectivity; (d) it avoids standing R|API+ admin credentials in a worker (smaller attack surface, D1 crown-jewel note).
- **R|API+ admin pull is the enhancement path, not the foundation:** add it later for intraday recon spot-checks or faster breach visibility if operations demand it. It costs $100/mo per API ID and widens the credential blast radius; nothing in the v1 rule model needs it.
- **Reconciliation stays mandatory:** our computed EOD balance vs Rithmic's stated EOD balance per account, nightly; mismatch = red alert + payout-eligibility exclusion (M2).
- **Contingency:** if the W1 vendor call reveals EOD report files lack per-fill granularity (only summaries), we ingest both the fill/order detail files AND the EOD summary; the constitution's `fills` → `daily_marks` pipeline already assumes raw fills. The vendor call must confirm which files exist; the architecture works in either shape because marks are computed, not trusted.

Proposed as ADR-002 in [DECISIONS.md](../docs/DECISIONS.md); founder approval closes the §10 open item "Rithmic ingest path."

## 4. Schema fields to reserve now (adapter-proofing)

On `fills`: `platform` (enum, v1 always `rithmic`), `platform_fill_id` (vendor's ID, unique per platform), `order_id`, `venue` (exchange MIC), `correction_of` (nullable self-reference for backdated corrections, B4 #5), `ingest_batch_id` (which file/pull delivered it), `raw_ref` (pointer to immutable raw row), `recorded_at` vs `executed_at` (arrival vs execution time, since corrections make these differ).

On `accounts`: `platform`, `platform_account_ref` (rithmic_user_id today, generic tomorrow), `feed` (rithmic|cqg|dxfeed, marketing needs it even when ingest doesn't), `front_end_permissions` (JSON list: NinjaTrader, Quantower, ATAS...).

On `daily_marks`: `source` (report|api|recomputed), `source_hash` (already in constitution), `report_file_id` (provenance to the exact ingested file).

New small tables: `ingest_files` (filename, sha256, received_at, status: received|parsed|quarantined|applied, the B4 #4 quarantine machine), `platform_entitlements` (account, entitlement type, active, since/until, the $30/month hygiene ledger driving M2's nightly disable job).

`PlatformAdapter` interface stands as specified (provision, entitle, ingestFills, ingestEOD, reconcile); Tradovate's API maps onto all five cleanly, which is the test the interface needed to pass.

## 5. Contradictions / open questions

- **No constitution contradictions.**
- **OPEN items consolidated (W1 vendor-call agenda):** Rithmic EOD file formats + field lists; delivery cadence/timing; correction/backdated-fill semantics; sandbox availability; server-side copy config; admin R|API+ terms; Tradovate B2B admin terms (low priority).
- **Watch item:** top-10 firms increasingly run CQG/dxFeed stacks (TradeDay all-CQG; MFF dual-feed). Rithmic-native remains right for v1 (admin surface + auto-liquidator + evaluator tooling are unmatched), but adapter #2 may deserve earlier scheduling than "post-launch someday" if trader-acquisition feedback demands Tradovate/TradingView. Decision deferred to post-beta data; schema is now insured either way.
