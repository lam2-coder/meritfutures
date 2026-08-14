# MERIT FUTURES — MASTER BUILD DIRECTIVE FOR CLAUDE CODE
### The complete engineering plan: research → architecture → every module → every test → launch
**Read this entire document before writing any code. This is the constitution of the build.**

---

## 0. MISSION & NON-NEGOTIABLE CONSTRAINTS

You are building the complete technology stack for **Merit Futures** (meritfutures.com) — a futures-only, SIM/B-book funded-trader evaluation firm (CME "TPAP"). Wyoming LLC. Target: private beta ~Dec 2026, public launch Q1 2027. Solo technical founder + you. Timeline: 2–3 months part-time.

**Product constraints (decided, do not relitigate):**
1. **Futures only. Rithmic-native.** No MT4/MT5, no forex, no multi-asset. One bridge: Rithmic (CSV/SFTP provisioning + report/API ingest).
2. **EOD rule model.** All plan rules compute from end-of-day marks (nightly batch). Intraday max-loss enforcement is delegated to Rithmic's auto-liquidator via risk settings we push. We never build streaming risk in v1.
3. **Instant automatic payout approval. Zero denials, ever.** Eligibility is computed mechanically; if the engine says eligible, approval is instant. Settlement via **Rise** in 2–3 business days. Abuse is handled at *detection* time (restriction/closure per ToS with evidence), never at request time. The 2–3 day settlement window is a silent freeze hook for active investigations only.
4. **Every plan has a payout cap.** Caps + consistency + cadence gaps + an 8-payout live-graduation ladder are the liability architecture. Three launch plans (50K tier canonical):
   - **Core EOD**: eval trail-EOD 5%, target 6%, no eval consistency, 1 min day → funded trail-EOD, 30% consistency (payout-gated), 5 win days @ $150+, $1,000 buffer, cap $1,500/request, 5-day gap, 90/10, 8 payouts → live ladder. Max 10 accounts.
   - **Rapid Daily**: eval 30% consistency, 2 min days → funded 40% consistency, cap $1,000, **1-day gap (daily)**, 90/10, 8-payout ladder. Max 5.
   - **Direct (instant funded)**: no eval; funded trail-EOD 4%, 25% consistency, 5 win days, $1,500 buffer, cap $1,500, 5-day gap, 90/10, 6-payout ladder. Max 5.
   - All parameters live in **versioned plan configs** — sizes 25K/50K/100K derive by scaling percentages.
5. **Marketing must equal implementation to the tick.** Every published rule renders from the same config the engine executes (single source of truth). The Topstep 3.6-star lesson: the gap between label and enforcement becomes the review page.
6. **Single-tenant.** One firm, one brand. No no-code program editor, no theming engine, no multi-tenancy. This is why we can build in months what vendors price at $5–10M.
7. **Buy commodities, own the core.** Build: rules engine, ledger, payouts, portal, admin, tier-1 risk, affiliate, Rithmic bridge. Buy/integrate: helpdesk (Chatwoot self-hosted), analytics BI (Metabase), lifecycle email (Loops/Customer.io), KYC (DEDICATED provider — Sumsub/Veriff/Persona class; see M19 and §10 for placement decision; Rise identity-match remains as a settlement-time check), PSPs (two high-risk MIDs), status page.

**Business context you must internalize:** ~15% of buyers pass evals; ~93% of funded traders have no durable edge and revert (funded time-gates exist to let reversion happen before cash leaves); payout liability is engineered to 25–35% of gross; adversaries include professional "juicing" rings and hedged-pair extractors — the rule caps bound their per-day prize (~$190/day ceiling on our plans), your detection makes them terminal. Firms die from (a) liability blindness (FTT: "didn't know their liabilities till everyone requested on a new dashboard"), (b) payout-trust collapse (one late cycle → review-page death spiral), (c) PSP freezes, (d) correlated payout spikes. Every one of these maps to a module below.

---

## 0.5 PRIME DIRECTIVE — THIS PROMPT GENERATES A PLANNING CORPUS, NOT CODE

**Read carefully: your deliverable is documentation.** This constitution is deliberately dense rather than exhaustive; the exhaustive version is what YOU produce — a complete, folder-organized planning corpus in which every architecture decision, table, endpoint, state machine, test scenario, runbook, and module plan is written down, reviewed, and approved BEFORE any application code exists. Zero application code is written until the founder marks the corpus milestone **FROZEN**. If you ever find yourself writing implementation code before that milestone, stop — you have misread your mission.

### The repository layout (create this skeleton in your first session; nothing lives anywhere else)
```
merit/
├── CLAUDE.md                        # lean session brain (C2) — pointers, commands, conventions
├── MERIT_BUILD_MASTER_PROMPT.md     # this constitution (read-only; amendments via DECISIONS.md)
├── research/                        # Phase-0 outputs (Wave 1)
│   ├── PROP_TECH_LANDSCAPE.md       # §1: 8+ vendor teardown + feature matrix + MUST/SHOULD/LATER
│   ├── TOP10_FIRMS.md               # §1B: firm surveillance one-pagers (refresh monthly)
│   ├── ADVERSARY_DOSSIER.md         # Appendix A instantiated with current scheme intel
│   ├── DATA_CAPABILITIES.md         # B3: platform data matrix (Rithmic/Tradovate/dxFeed/…)
│   ├── SECURITY_LANDSCAPE.md        # D0: breach history → control checklist → B4 additions
│   ├── VIBE_FAILURE_POSTMORTEMS.md  # E: incident studies → named CI gates
│   └── CLAUDE_CODE_PLAYBOOK.md      # C0: community practice, merged monthly
├── docs/
│   ├── INDEX.md                     # THE MAP: every doc, one-line purpose, status, owner. If a
│   │                                #   thing is not in INDEX.md, it does not exist.
│   ├── STATE.md                     # one screen: done / in-flight / blocked (updated every session)
│   ├── SESSION_LOG.md               # append-only handoff journal (C3 ritual)
│   ├── DECISIONS.md                 # ADRs — every choice with rationale and alternatives
│   ├── EDGE_CASES.md                # living registry; every bug becomes an entry + golden file
│   ├── GLOSSARY.md                  # every domain term (trailing DD, buffer, win day…) defined ONCE;
│   │                                #   all other docs link here rather than redefining
│   ├── architecture/                # Wave 2 — the system fully mapped
│   │   ├── OVERVIEW.md              # system diagram, module map, data flow end-to-end
│   │   ├── DATA_MODEL.md            # every table, every column, type, index, constraint, retention
│   │   ├── API_CONTRACT.md          # B2 expanded: every endpoint, request/response schemas, errors
│   │   ├── EVENTS.md                # every event: name, payload schema, producer, consumers
│   │   ├── STATE_MACHINES.md        # account / payout / flag / identity lifecycles as Mermaid
│   │   ├── INFRA.md                 # environments, deploy pipeline, backups, cost guards, E doctrine
│   │   └── SECURITY.md              # Appendix D instantiated: per-asset threat model + control map
│   ├── plans/                       # Wave 3 — one B5-template plan per module, dependency order
│   │   └── M01-rules-engine.md … M19-kyc-identity.md   (every module, no exceptions)
│   ├── testing/
│   │   ├── STRATEGY.md              # §5 instantiated with tooling choices
│   │   ├── GOLDEN_SCENARIOS.md      # every B4 scenario + inventions, NUMBERED (tests cite numbers)
│   │   └── SIMULATION_HARNESS.md    # MC population port spec + CI calibration bands
│   ├── ops/
│   │   └── runbooks/                # §7: one file per failure class, comms templates included
│   ├── design/
│   │   └── DESIGN_SYSTEM.md         # Appendix F instantiated: tokens locked before any UI
│   └── legal/                       # ToS/disclosure drafts, sim-language blocks, geo list
└── (application code appears here ONLY after the FREEZE milestone)
```

### Generation pipeline (waves with hard gates; founder approval advances each gate)
- **Wave 1 — Research** (§1, 1B, A, B3, C0, D0, E): all seven `research/` docs. GATE: founder review; contradictions with this constitution surface as proposed amendments.
- **Wave 2 — Architecture**: GLOSSARY + all seven `architecture/` docs + INDEX. This is where "literally everything explained and mapped" lives — every table column justified, every endpoint schema'd, every state transition drawn. GATE: founder walks OVERVIEW → DATA_MODEL → API_CONTRACT line-by-line.
- **Wave 3 — Module plans**: M01→M19 in dependency order (M1 rules engine first, always), each a full B5 ten-section doc with ≥5 novel adversarial scenarios. GATE: per-doc approval; no plan, no place on the roadmap.
- **Wave 4 — Testing, ops, design, legal docs.** GATE: founder review → corpus marked **FROZEN** in STATE.md.
- Only after FREEZE does §8's W1 begin — and W1's "repo scaffold" now means implementing what the corpus already fully describes.

### Tracking rules (how nothing ever gets lost)
Every doc carries frontmatter: `status: draft | review | approved | frozen`, `depends_on:`, `last_updated:`. INDEX.md is regenerated whenever any doc is added or changes status — it is the first thing every session reads after CLAUDE.md. STATE.md shows the wave, the gate, and the three next actions. A session that cannot locate something in under a minute treats that as a bug in INDEX.md and fixes the index, not just the confusion. Docs are the single source of truth: if code (later) and a doc disagree, work stops until DECISIONS.md records which one was wrong.

---

## 1. PHASE 0 — YOUR OWN DEEP RESEARCH (do this FIRST, ~1 full session, produce `research/PROP_TECH_LANDSCAPE.md`)

Before any code: research the current prop-tech vendor landscape yourself to extract a **feature-parity checklist** and confirm nothing material changed. Study **at least these 8** (web search + their sites + help centers + demo videos + reviews):

1. **Quant Technology Group / YourPropFirm** (quanttechnology.com — study every page: /platforms, /components, /yourpropfirm, /proptradegroup, /custom-trading-technology). Their YPF console enumerates the industry-standard surface set: trader portal (dashboard, challenge progress, KPIs, payouts, certificates, KYC), no-code program editor, payout pipeline (request→review→approve→settle, multi-rail, audit), risk engine wired to **QuantSentry** (breach detection, soft/hard stops, evidence packs), affiliate portal (attribution, sub-IB hierarchies, statements), lifecycle messaging (journeys, segments, A/B), analytics (cohort funnels, P&L, payout health, agent SLA), support (tickets, macros, AI suggestions), marketing CMS (programs catalog, FAQ, SEO). 85+ firms, 2.75M accounts. Note their claim "18–24 months, $5–10M" and understand why single-tenant futures-only EOD collapses that estimate.
2. **Axcera** (axcera.io) — modular suite: Prop CRM, Trading APIs, **RiskGuard**; fixed-fee no-rev-share; note which modules they consider separable — that's a hint for our module boundaries.
3. **FPFX Tech / PropAccount** — enterprise APIs, rev-share + capital-backing model; their public dataset (300K accounts) is our calibration anchor.
4. **DXtrade XT (Devexperts)** — platform+data bundle economics ($12K setup, $4,800/mo floor, $24/acct, chargeable-user-by-active-status trap).
5. **ProjectX / Sims2Funded** (Topstep-owned) — browser front-end on Rithmic; study its trader UX as the futures-native benchmark.
6. **Tickblaze** — native futures/algo evaluation architecture.
7. **Trade Tech Solutions** — widest futures platform list (Rithmic, Tradovate, NinjaTrader, Quantower, ATAS).
8. **Match-Trade / PropForge / any 2 newer entrants** — scan for features nobody else has yet.

Also study **operating firms' surfaces** for UX truth: MyFundedFutures (4.9★ — auto-approvals + 24h processing is the crown), Tradeify help center (payout ladders, resetting win-day counts), Lucid (15-min payouts), FundedNext (progressive cap release after 5th withdrawal — candidate v1.1 feature), Apex (activation + Bonus Vault), SharkFutures (50%-of-cycle + progressive cap mechanic). Use F12/network-tab fingerprinting where useful (API domains, dashboard CNAMEs identify backends).

**Deliverable:** feature matrix (vendor × capability), a MUST/SHOULD/LATER cut for Merit v1, and a list of any feature that would change the data model if added later (so we design the schema for it now). Flag anything that contradicts this document; propose amendments before coding.

### 1B. TOP-10 FIRM SURVEILLANCE (same Phase-0 session; produce `research/TOP10_FIRMS.md`; refresh monthly through launch)
Deep-profile the ten biggest futures props — currently approximately: **Apex, Topstep, MyFundedFutures, Tradeify, TradeDay, Lucid, FundedNext Futures, TakeProfit Trader, FundedFuturesFamily, FuturesElite** (verify ranking via payoutjunction.com 7d/30d on-chain volumes + PropScorer + Trustpilot volume; swap in risers like Alpha Futures if warranted). For EACH firm extract, with dates:
- **Current plans & rules** (from their help centers ONLY — pricing, caps, cadence, consistency, buffers, ladders, live programs) and any rule changes in the last 90 days.
- **Tech stack**: trading platforms offered (Rithmic/Tradovate/ProjectX/Volumetrica/Quantower/NinjaTrader/proprietary), dashboard provider (F12/DNS fingerprint), payout rails (Rise/Plane/crypto), payout speed claims, mobile apps, AI/copilot features, data tools — anything tech they market as differentiation.
- **X/Twitter + Discord signal**: read each firm's X account (@apextraderfund, @Topstep, @MyFundedFutures, @tradeify_, @TradeDayFunding, @lucidtrading_, @FundedNext, @takeprofittrader etc. — find current handles) — last 60–90 days of posts: promos/discount cadence and depth, new features announced, payout-proof marketing style, rule-change announcements and community backlash, outage/incident comms. Note what earns engagement; Merit's launch marketing copies the winners' formats.
- **Trust trajectory**: Trustpilot rating + review velocity + top complaint themes (rule-implementation gaps are gold — each one is a Merit differentiator).
Output: per-firm one-pagers + a "what the market now considers table-stakes tech" list + a "gaps nobody serves" list.

---

## 2. ARCHITECTURE PRINCIPLES

- **Stack (boring on purpose):** TypeScript end-to-end. Next.js (App Router) for portal+admin+site; PostgreSQL (Neon/Supabase) as the single source of truth; a worker process (BullMQ + Redis, or pg-boss to stay Postgres-only — you choose, justify) for jobs; Drizzle or Prisma ORM; deployed on Railway/Fly + Vercel or single-box Hetzner — optimize for one operator's comprehension, not scale cosplay.
- **Event-sourced money.** Every financial fact is an immutable **ledger entry** (double-entry: debit/credit accounts for firm treasury, trader withdrawable, fees, reserves). Balances are derived, never stored as mutable truth. Invariant: ledger sums to zero; test enforces it.
- **Deterministic rules engine as a pure library.** Zero I/O in rule computation: `(planConfigVersion, accountState, dayMarks[]) → newState + emittedEvents`. Same inputs always produce identical outputs. All engine code runs headless in tests.
- **Everything is an event.** `account.provisioned`, `day.closed`, `phase.passed`, `breach.detected`, `payout.requested/approved/settled`, `flag.raised` — one append-only `events` table drives the admin feed, analytics, messaging triggers, and audit.
- **Idempotency everywhere money moves.** PSP webhooks, Rise transfers, provisioning CSVs — all carry idempotency keys; retries must be safe. Test duplicate delivery explicitly.
- **Money is integer cents.** No floats in any financial path. Rule thresholds stored as basis points / integer cents. Rounding rules explicit and documented per rule (see M1 edge cases).
- **Versioned everything a trader relies on:** plan configs, ToS, rule text. An account is永 bound to the config version it was sold under; changes create new versions applying only to new sales. "The rules at the time" must always be provable.
- **Time discipline:** all timestamps UTC in storage; **trading day = exchange session calendar (CT)**, maintained as data (holidays, half-days, DST). One `TradingCalendar` module used by everything; never `new Date()` math in rule code.
- **Audit-first:** every admin action and automated enforcement writes actor, reason, evidence refs, before/after. Append-only.

---

## 3. DATA MODEL (design fully in week 1; migrations are sacred)

Core tables (indicative, refine): `users` (auth, profile), `identities` (KYC state, device/IP/payment fingerprints for entity resolution), `plans` + `plan_versions` (full rule JSON, published copy blocks), `purchases` (PSP ref, coupon, affiliate, amount, MID), `accounts` (user, plan_version, size, phase: eval|funded|closed|graduated, rithmic_user_id, status), `fills` (raw ingest, immutable), `daily_marks` (per account per trading day: open/close bal, hi/lo, realized P&L, win-day flag, source hash), `rule_states` (per account: trailing floor, buffer progress, consistency stats, win-day count, payouts taken, last payout day — always recomputable from marks; stored for speed), `payout_requests` (amount, eligibility snapshot, status: approved|settled|frozen, rise_ref), `ledger_entries`, `risk_flags` (type, severity, evidence JSON, status), `affiliates` + `attributions` + `affiliate_statements`, `events`, `admin_actions`, `trading_calendar`. Every table: created_at, and where mutable, updated_at + row history or event trail.

---

## 4. MODULE SPECIFICATIONS
For every module: build to the listed requirements; enumerate further edge cases as you discover them into `docs/EDGE_CASES.md`; nothing in a money path ships without the tests named in §5.

### M1 — RULES ENGINE (the crown jewel; build FIRST, with its test suite, before any UI)
Pure TS library `packages/rules-engine`. Implements the complete rule taxonomy:
- **Drawdown:** trailing-EOD (floor = max(EOD balance highs) − DD; per-plan: locks at initial balance + $X once buffer/profit threshold reached), static, and (config-supported but unused v1) intraday-trailing. Breach check uses the day's low vs floor per type.
- **Daily loss limit:** soft (flatten/pause — flag only in v1 since Rithmic enforces) vs hard (breach). Config per plan.
- **Eval:** profit target %, min trading days (a day counts if ≥1 fill), optional eval consistency (best day ≤ X% of total profit — evaluated at pass time; if violated, keep trading until diluted, never fail for it), max days/expiry (config; unlimited default).
- **Funded gates to payout eligibility (ALL must pass):** min days; **win days** (day P&L ≥ floor, e.g. $150) with **count reset to zero after every payout** (Tradeify pattern); **buffer** (withdrawable = balance − size − buffer; buffer permanent); **consistency** (best day ≤ X% of period profit — *payout-gated*: failing delays eligibility, never breaches); **cadence gap** (trading days since last payout ≥ N; denied/frozen requests do not reset it); **cap** per request (min payout $100); **split** applied at ledger level; **payout ladder** (after N payouts account auto-graduates: v1 = closed with "live invitation" status + event; live program itself is post-launch).
- **Post-payout mechanics:** withdrawable extracted via ledger; floor recompute honors plan's post-payout rule (reset floor to balance−DD, or lock at size+$100, per config).
- **Edge cases you MUST handle + test explicitly:** rounding (all thresholds integer cents; comparisons ≥ / ≤ documented per rule and mirrored in published copy); zero-profit and negative-profit consistency denominators (define: consistency check skipped unless total period profit > 0); a win-day exactly at the floor (counts — ≥); breach and pass signals on the same day (breach wins; day order: mark ingest → breach check → progression); trading-calendar half days (count as days); account with fills but flat P&L (counts as traded day, not win day); payout request landing mid-nightly-batch (requests evaluated against last **closed** day only); cap > withdrawable (auto-clamp to withdrawable); multiple accounts same user requesting same day (independent; aggregate exposure surfaces in admin); config migration (new version never touches existing accounts); replay determinism (re-running all marks from day 1 reproduces stored `rule_states` byte-identically — this replay is a nightly self-audit job in prod).

### M2 — RITHMIC BRIDGE
- Outbound: generate provisioning CSVs (new users, accounts, **risk settings** = max-loss for auto-liquidation, market-data entitlements, platform permissions) → SFTP push on schedule + on-demand. Idempotent file naming; delivery confirmation tracking; a `provisioning_queue` with states.
- **Entitlement hygiene (real money):** nightly job auto-disables data entitlements + User IDs for closed/expired accounts (Rithmic bills $30/login-month + data per entitled user; DXtrade-style vendors bill on *active status* — our own discipline mirrors this). Alert if any closed account still entitled >24h.
- Inbound: ingest fills/positions/EOD reports (Rithmic reports or R|API admin pull — investigate both in Phase 0; choose simplest reliable). Store raw → normalize to `fills` → compute `daily_marks` in the nightly batch. **Reconciliation job:** our computed EOD balance vs Rithmic's stated; any mismatch = red alert + account excluded from payout eligibility until resolved.
- Flag API-tier users (R|API traders cost $100/mo vs $30 — surface in admin; pricing may differ for algo tier later).
- Build a **synthetic Rithmic simulator** for dev/staging: emits realistic fills for N fake traders (reuse trader-distribution logic: mostly breakeven-negative, few skilled) so the whole pipeline runs end-to-end with zero real accounts.

### M3 — BILLING & CHECKOUT
- PSP abstraction layer over **two** high-risk MID providers (interfaces first; wire real providers when merchant accounts approved — likely Authorize.net-style gateway API on high-risk MIDs). Health-checked failover: if MID-A declines/errors abnormally, route to MID-B; both webhook into the same idempotent purchase pipeline.
- Coupons (percent off, stackable=false, expiry, per-affiliate codes), price list per plan/size from plan_versions, **resets/rebuys** (repurchase flow on breached accounts at reset price), refund policy hooks (refund window pre-first-trade only), **chargeback handler**: instant account closure + flag + ledger reversal (industry standard, in ToS).
- Order → payment → `account.provisioned` event → Rithmic queue → welcome email: the golden path must be a single traceable saga with compensation on failure (paid but not provisioned = alert within 5 min, auto-retry).

### M4 — TRADER PORTAL (Next.js, mobile-first)
Auth (email+passkey/OTP; no passwords ideally), dashboard: account cards (phase, balance, floor distance, win-day progress with the reset-after-payout count, consistency meter, buffer progress, days-to-eligible countdown, cap/gap status), equity chart from daily_marks, payout center (request button appears ONLY when engine-eligible; shows exact clamped amount; status timeline request→approved(instant)→settled), certificates (pass/payout PNG/PDF share cards — cheap virality, every vendor has them), KYC status card (dedicated provider flow per M19 — placement pre-eval or pre-funded per §10 decision; clear progress states: required → pending → verified → issue), purchase/reset flows, rule page per account rendering **live from its plan_version** (implementation = marketing), referral panel. Tone: numbers-forward, zero dark patterns, publish the honest stats.

### M5 — PAYOUT SYSTEM
Request pipeline: trader clicks → engine eligibility snapshot (persisted with the request — provable forever) → clamp to cap & withdrawable → **instant auto-approve** → ledger entries (trader split, firm split, buffer retained) → Rise transfer job (idempotent; batch to Rise API) → settled webhook → notify. Freeze path: an *active* risk investigation sets `payouts_frozen` on the account **before** request time; a frozen account's UI shows review status (rare, evidence-backed, ToS-cited). Treasury separation: payout wallet funded from ops account manually/weekly; **Reserve Coverage Ratio** (reserve ÷ CVaR99 estimate) on admin home; if <1.0 → automatic new-sales banner pause (circuit breaker pauses SALES, never payouts). Rise integration: tax forms + multi-rail settlement (their problem), webhooks for settlement + failure retry queue; **Rise payout-name must match the M19-verified identity** (mismatch = payout mule signal → freeze + flag, never silent). Payout requests are only reachable by identities in `kyc_verified` state — the gate lives upstream (M19), so payout-time is never the first identity check.

### M6 — ADMIN / OPS CONSOLE (the FTT-killer)
Home = **liability dashboard**: Open Liability (Σ withdrawable across funded, live number), Eligible-Next-7-Days forecast (engine projects gate-clearing), payout velocity vs 30-day avg (alarm >2.5×), per-plan trailing-30d loss ratio (payouts/fees; **circuit breaker: >60% auto-pauses that plan's new sales** + alert), pass-rate CUSUM chart per plan (S_t = max(0, S_{t-1} + (x_t − μ0 − 0.5σ)); alarm at 4–5σ — "a plan is being beaten; inspect before the funded wave"), reserve coverage, MID health, Rithmic recon status. Account drill-down: full timeline (fills, marks, rule states per day, events, flags, payouts, admin actions), manual actions (close, freeze payouts, note) — all reasoned + audited. Search by anything. RBAC-lite: owner/ops/readonly. Event feed. Exportable evidence packs per account (trades, timestamps, rule version, computation trace) — one click, court-grade.

### M7 — RISK & ABUSE (tier-1, heuristics + SQL; detection-time only)
- **Entity resolution at signup + purchase:** normalize emails (dots/plus), device fingerprint (FingerprintJS OSS), IP/ASN, payment fingerprint (card BIN+last4 hash, Rise identity). Graph table linking identities; max-accounts enforced per *entity*, not email.
- **Detectors (nightly + on-ingest):** same-second/±2s fill clustering across accounts (copy rings — you have every fill; it's a self-join); **inverse-P&L pair detection** (rolling correlation of account daily P&L < −0.8 between linked or any two accounts = the no-risk-hedge signature, the #1 industry threat); news-window straddles (entries within ±N sec of a maintained Tier-1 calendar — flag pattern, not single events); martingale sequences (size-after-loss regression, strategy-level threshold); velocity anomalies (win rate/pace vs population); multi-account same-entity aggregation exceeding caps.
- Flags → severity-scored queue in admin with evidence JSON; human decides; enforcement = restriction/closure per ToS with evidence pack, **never** payout denial. Design the flag schema so a QuantSentry-class vendor can be bolted in later as another detector source.

### M8 — AFFILIATE SYSTEM
Codes (= coupon linkage), click+purchase attribution (last-touch, 30-day cookie + code override), dashboard for affiliates (clicks, conversions, earned, paid), commission engine (% of net sale, payable after refund window), monthly statements, payment via Rise too. **NFA I-26-12 compliance hooks:** affiliate ToS acceptance versioned, required-disclosure copy blocks, per-affiliate creative approval flag. No sub-IB trees v1 (schema allows parent_id for later).

### M9 — MARKETING SITE + CONTENT
Fast static Next.js: home, plans/pricing (rendered FROM plan_versions — one source of truth), rules pages (verbatim engine parameters + plain-English explainer per rule), honest FAQ, **published stats page** (pass rate, payouts paid, average payout, trailing windows — auto-computed; voluntary disclosure is the trust moat and likely future compliance), blog/CMS (MDX fine), legal pages (ToS/Privacy/Risk Disclosure — versioned, sim-disclosure language everywhere: "funded stage operates exclusively in a simulated environment"), geo-block list enforcement at checkout, Trustpilot/Discord links. SEO basics.

### M10 — INTEGRATIONS (buy, wire, don't build)
Chatwoot (self-hosted) with account-context sidebar via our API; Metabase on a read replica (cohort funnels, LTV/CAC, payout health dashboards as saved questions); Loops/Customer.io driven by our events (welcome, eval-passed, payout-settled, win-back, breach commiseration→reset offer); Sentry + uptime + status page; Discord webhook for internal alerts (liability, CUSUM, recon, MID health).

---

## 5. TESTING STRATEGY (money code = tests first; this section is binding)
1. **Unit + property tests** on the rules engine: for each rule, generated day-sequences (fast-check) asserting invariants — floor monotonicity per DD type; win-day count never decreases except payout reset; eligibility is monotone in its inputs; clamped payout ≤ cap ∧ ≤ withdrawable; ledger zero-sum; no negative withdrawable ever.
2. **Golden replay files:** hand-built scenario fixtures (≥40): "passes eval day 3 with consistency violation then dilutes", "breach + target same day", "payout then immediate risk-up blowout", "daily-cadence trader extracts at cap 8× then graduates", "hedged pair across two accounts", "holiday-shortened week gap counting", "cap clamp when withdrawable < cap", "config v2 launches mid-life". Stored as YAML → expected end-state JSON. CI runs all.
3. **Simulation harness:** port the Monte-Carlo trader population (mostly zero/negative edge, few skilled, risk-up after payout) to TS; run 10K synthetic traders through the REAL engine nightly in CI; assert aggregate funnel lands in calibrated bands (pass 12–20%, funded→payout 40–55%, firm-$/funded within band per plan). This catches subtle rule regressions no unit test sees.
4. **Integration tests:** PSP webhook idempotency (duplicate + out-of-order delivery), provisioning saga compensation, Rise transfer retry, recon mismatch quarantine.
5. **E2E (Playwright):** buy→provision→(synthetic trading)→pass→fund→request→settle happy path + the 10 most valuable unhappy paths.
6. **Beta shadow-run (mandatory gate to public launch):** entire beta period, a human (Luke) hand-verifies every payout eligibility against the engine's decision; every mismatch is a P0. Engine earns instant-approval trust by being boringly correct for 6+ weeks.
7. **Load sanity:** nightly batch for 5K accounts < 10 min; payout request p95 < 500ms. That's all the scale v1 needs.

---

## 6. SECURITY, COMPLIANCE, PRIVACY
Secrets in platform vault only; least-privilege DB roles; admin behind SSO+2FA and IP allowlist; PII minimization (KYC documents live at the KYC provider — Merit stores status, provider applicant ref, and match signals, never documents or biometrics); encrypted at rest; rate limits + bot protection on auth/checkout; signed webhooks verified; append-only audit and events tables (no UPDATE grants); ToS acceptance recorded with version + IP + timestamp; geo-block enforcement (checkout + login warning) for restricted list; SIM-disclosure copy in footer, checkout, ToS, certificates; affiliate marketing disclosure blocks (NFA I-26-12); data export + deletion runbook (privacy requests); backups: PITR on Postgres + nightly logical dump to object storage + quarterly restore drill.

## 7. OPERATIONS
Runbooks in `docs/runbooks/`: nightly-batch failure, recon mismatch, MID freeze (switch + comms template), Rise outage (queue + status page + ETA comms — payout trust is the brand; over-communicate), Rithmic SFTP failure, restore-from-backup. Cron inventory with alerting on non-run (dead-man switch). Incident comms templates pre-written. Weekly risk ritual checklist page in admin (loss ratios, CUSUM, top-20 liabilities, flags, reserve).

## 8. DELIVERY PLAN (12 weeks; each phase has a Definition of Done incl. its tests green)
- **W1:** Phase-0 research doc; repo/monorepo scaffold (`apps/portal`, `apps/admin`, `apps/site`, `packages/rules-engine`, `packages/db`, `packages/rithmic`); full schema + migrations; TradingCalendar; CI.
- **W2–4:** Rules engine + entire §5.1–5.3 test stack (this is the longest pole and it is intentional); synthetic Rithmic simulator; nightly batch + replay self-audit.
- **W5:** Ledger + billing/checkout + coupons/affiliates attribution; provisioning saga against simulator.
- **W6–7:** Trader portal complete; marketing site with config-rendered plans; stats page (synthetic data).
- **W8:** Payout system + Rise sandbox + freeze path; admin liability dashboard + event feed.
- **W9:** Risk tier-1 detectors + flags queue + evidence packs; CUSUM + circuit breakers; Metabase/Chatwoot/Loops wiring.
- **W10:** Hardening: idempotency chaos tests, load sanity, security pass, runbooks; real Rithmic test environment + CME TPAP prerequisites checklist surfaced.
- **W11–12:** Private beta (50–100 traders, discounted): shadow-run, daily triage, polish; public-launch gate review against §5.6.
- **Risks:** Rithmic integration specifics unknown until agreement — front-load the sandbox conversation W1; PSP approval lead time — apply W1; if either slips, everything else proceeds against simulators (the architecture guarantees it).

## 9. WORKING AGREEMENTS (how you, Claude Code, operate)
Plan before code on every module (write `docs/plans/Mx.md`, get approval); tests-first on any money path; small conventional commits; migrations never edited after merge; seed script creates a full demo world (plans, 50 synthetic traders with histories, flags, payouts) so every surface is developable offline; no mocked money logic left in prod paths; when this document is ambiguous, ASK — when it's silent, propose in `docs/DECISIONS.md` (ADR format) and proceed on approval; maintain `docs/EDGE_CASES.md` as a living registry — every bug becomes a golden file; never weaken a test to pass it.

## 10. OPEN DECISIONS REGISTER (resolve in W1 with the founder)
Queue tech (BullMQ+Redis vs pg-boss); ORM (Drizzle vs Prisma); Rithmic ingest path (reports vs R|API admin) — pending vendor docs; PSP shortlist (apply to 2 immediately); auth provider (Lucia/Auth.js/Clerk) — bias to boring+owned; hosting (single Hetzner box + Docker Compose vs Railway) — bias to simplest restorable; exact restricted-jurisdiction list (pending counsel); Discord community bot scope (post-launch); **KYC placement (M19) — pre-eval vs pre-funded (founder undecided; implement as config)**. The tradeoff to document in the M19 plan: PRE-EVAL = maximum deterrence (fraudsters never enter; cleanest book) but maximum friction — verification at checkout suppresses conversion on a $79–99 impulse purchase, costs ~$1.50–2 on 100% of buyers, and no major competitor gates purchase (competitive disadvantage at the floor). PRE-FUNDED (verify at eval-pass, before the funded account exists) = the likely sweet spot: only ~15% of buyers ever get verified (85% cost saving), friction lands on people already invested (negligible abandonment), and every fraud-relevant moment — funded trading, payouts — still sits behind verification; fleets are caught by biometric dedupe before any liability exists. PAYOUT-ONLY = rejected (too late under a zero-denial policy). Beta plan: launch pre-funded, instrument the funnel (M19g), and revisit pre-eval only if funded-stage fraud volume justifies pushing friction to checkout.

---
## APPENDIX A — ADVERSARY DOSSIER: HEDGING & FRAUD GROUPS (this is what kills firms; M7 is built against THIS)
Organized extraction is an industry, not an edge case. A firm CEO described one coordinated hedging ring as an **"existential threat."** Research this actively in Phase 0 (produce `research/ADVERSARY_DOSSIER.md`) and treat M7 + the rules architecture as the counter-design. Known adversary taxonomy:

1. **Intra-firm hedge pairs/rings** — two+ accounts opposite-direction same instrument; one side is guaranteed to pass/reach payout. Economics on OUR rules: pair cost 2× fee, prize capped at $1,350 (cap×split), forced multi-day by consistency+win-days → ~$190/day ceiling and no longer riskless. On uncapped/daily competitors it's a magnet ($270+/day repeatable). Signal: inverse daily-P&L correlation < −0.8, mirrored size/timing.
2. **Cross-firm hedge syndicates** — long at Merit, short at Apex; invisible to any single firm's data. Groups coordinate on Discord/Telegram, split proceeds. Our rules bound the damage per account; the ladder bounds it per lifetime; true detection needs shared-vendor networks (QuantSentry-class bolt-on later). Accept, bound, budget.
3. **Paid passing services & account management** — advertised openly on X/Telegram ("we pass your eval, 50% split"); one skilled operator or bot passes dozens of strangers' accounts → correlated funded cohort trading identically. Signals: same-second fills across "unrelated" accounts, identical sequences, login geography vs KYC mismatch, device/IP overlap. Research the current service market: X searches "prop firm pass service", "eval passing", Telegram group listings, YouTube exposés.
4. **Copy-ring rentals / signal herds** — commercial copy-trading groups (Tradesyncer-style tooling) stacking max accounts per member; not always ToS-illegal but creates the correlated-payout spike our reserve math prices (one Trump tweet from roasting all accounts — their words). Max-accounts-per-ENTITY + copy-cluster detection + the VaR reserve are the containment.
5. **The juice/reviewer extraction culture** — semi-organized community that professionally targets new cheap firms ("good firm to juice for 10k", "hit them like you hit Bulenox"); they read rulebooks forensically, exploit any gap between marketing and implementation, and coordinate timing. Defense: airtight rule implementation (§M1 tests), caps, and the launch posture of strict-but-published rules.
6. **Identity/fleet fraud** — one operator, 20–30 accounts under different names beating per-entity caps: synthetic identities, family KYC, VPNs. Counter: entity resolution (M7) BEFORE funding, device/payment graphs, and M19's biometric dedupe — the provider's face-match across ALL applicants catches one-face-many-names fleets that device fingerprints miss.
7. **Payment-side fraud** — stolen-card eval purchases (chargeback wave weeks later = MID health damage: >0.65% ratio threatens the processor relationship), refund abuse, payout mules (KYC'd person cashing out a hidden operator). Counter: AVS/CVV strictness, chargeback=closure ToS, velocity limits per entity/BIN, Rise identity match vs account identity.
8. **Exploit hunting** — sim-feed latency/stale-quote arb, news-straddle brackets around Tier-1 releases, martingale eval brute-forcing, platform bug abuse (test rule engine against adversarial day-sequences in §5.1 fuzzing). Maintain the Tier-1 economic calendar as data; flag strategy-level patterns, never single trades.
9. **Insider/process leaks** — leaked promo codes, support social-engineering (account transfers, KYC swaps), affiliate self-dealing. Counter: audited admin actions, code redemption limits, no support-initiated identity changes without verification runbook.

**Research directives:** mine X/Reddit(r/propfirms, r/Daytrading)/YouTube/Discord-leak posts for current scheme mechanics and firm incident post-mortems; read Axcera RiskGuard + QuantSentry + FPFX fraud-content marketing (they publish scheme taxonomies as lead-gen); check CFTC/state enforcement records for prop-adjacent fraud cases; catalog which of the top-10 firms' rule changes in the last year were visibly anti-ring patches (those changes are the industry's revealed threat intel). Every scheme found → a detector spec or a rule-config note + a golden test scenario. The kill-chain to internalize: **rings bound by rules → caught by detection → made unprofitable by both → and the reserve survives whatever leaks through.**

---
**Final orientation:** the product is trust, and trust is the rules engine being provably, boringly correct plus payouts that settle exactly as promised. Every hour spent on §M1 tests and §M6 visibility is worth ten anywhere else. Build accordingly.

---
## APPENDIX B — FOUNDATION BLUEPRINT: THE CENTER ENTITY, API SURFACE, PLATFORM DATA & THE EVIL-BRAIN TEST BATTERY

### B1. The center entity and its branches (build the world around this)
Everything radiates from **TraderIdentity** — the resolved human, not the email. Spine:
`TraderIdentity` ← merges → {emails, devices, IPs/ASNs, payment fingerprints, Rise/KYC identity} and owns → `Purchases` → `Accounts` (each pinned to a `PlanVersion`) → `Fills` → `DailyMarks` → `RuleState` → `PayoutRequests` → `LedgerEntries`; laterally → `RiskFlags`, `AffiliateAttribution`, `Conversations` (support), `Events` (everything). Aggregations the business runs on are identity-level: total accounts (cap enforcement), aggregate open liability, aggregate daily P&L correlation vs other identities (ring detection), lifetime value. **Rule:** no feature may key on email or account alone when identity exists; write the resolver first (W1) and make every module consume it.

### B2. API surface (versioned `/api/v1`; portal+admin are its first clients; document with OpenAPI from day one)
- **Auth:** `POST /auth/otp`, `/auth/verify`, `/auth/passkey/*`, `GET /me`
- **Catalog:** `GET /plans`, `GET /plans/:id/version/:v` (rules JSON = the same object marketing renders)
- **Commerce:** `POST /checkout` (plan, size, coupon) → PSP session; `POST /webhooks/psp/:provider` (idempotent); `POST /accounts/:id/reset`
- **Accounts:** `GET /accounts`, `GET /accounts/:id` (state, gates progress, floor distance), `GET /accounts/:id/marks`, `GET /accounts/:id/timeline`
- **Payouts:** `GET /accounts/:id/eligibility` (live gate-by-gate breakdown — show the trader exactly what's missing), `POST /accounts/:id/payout` (snapshot+clamp+auto-approve), `GET /payouts`, `POST /webhooks/rise`
- **Affiliate:** `GET/POST /affiliate/*` (stats, links, statements)
- **Admin (RBAC):** `GET /admin/liability`, `/admin/eligible-forecast`, `/admin/loss-ratios`, `/admin/cusum`, `/admin/flags`, `POST /admin/accounts/:id/{freeze|close|note}`, `GET /admin/identities/:id/graph`, `GET /admin/evidence/:accountId` (pack export), `POST /admin/plans/:id/versions`
- **Ops:** `POST /internal/batch/run` (guarded), `GET /health`, `GET /internal/recon/status`
Design rules: cursor pagination everywhere; every mutating endpoint idempotency-keyed; errors as typed problem-JSON; webhooks signed+replay-protected (timestamp+nonce).

### B3. Platform data capabilities — research directive (produce `research/DATA_CAPABILITIES.md`)
Merit is Rithmic-native v1, but design ingestion as an **adapter interface** (`PlatformAdapter: provision, entitle, ingestFills, ingestEOD, reconcile`) so a second platform is a new adapter, not a rewrite. Phase-0 task — build the matrix of what each offers (data types, transport, latency, auth, admin vs trader scope, cost):
- **Rithmic:** fills/orders/positions per account, EOD reports, R|API+ admin access, server-side copy, auto-liquidator, risk-settings via CSV/SFTP, market-data entitlement control. Confirm: report file formats, delivery cadence, correction/backdated-fill semantics (CRITICAL for replay determinism), sandbox availability.
- **Tradovate:** full REST+WebSocket API (orders, fills, cash balances, real-time), OAuth — the most modern API in futures; likely adapter #2.
- **dxFeed:** market data only (L1/L2) — relevant if we ever render charts/quotes in-portal; note licensing implications of *displaying* data vs entitling traders.
- **CQG, Volumetrica, ProjectX, NinjaTrader:** what admin/export data exists for a TPAP; which expose fills programmatically vs dashboard-only.
Decide from the matrix: exact v1 ingest path, and what schema fields to reserve now (e.g., `order_id`, `venue`, `correction_of`) so adapters never force migrations.

### B4. The evil-brain test battery (each becomes a golden file or chaos test; extend it every week)
1. DST transition day — session spans clock change; day boundary must follow exchange calendar, not wall clock. 2. CME halt/limit-locked session — trader physically cannot trade; do min-day/gap counters advance? (Define: calendar trading days advance; win-days don't — document publicly.) 3. Half-day (Thanksgiving) — reduced session counts as a day. 4. Rithmic file arrives 6h late / partially corrupted mid-row — batch quarantines, no partial states committed, alert fires, yesterday's states untouched. 5. Backdated fill correction arrives for a day already closed — replay recomputes forward; if a settled payout's eligibility changes retroactively, NEVER claw back — flag for review + absorb (trust > pennies) and test that exact flow. 6. Payout request at 23:59:59 vs batch at 00:05 — snapshot semantics pin to last closed day. 7. Two accounts, same identity, payout same second — race-safe, both valid, admin sees aggregate. 8. Rise webhook replayed 50× — one settlement. 9. PSP sends `payment.success` twice + out-of-order with `refund` — one account, correct final state. 10. Chargeback lands AFTER a payout settled — identity net-negative: close, flag, ledger shows firm loss honestly. 11. Coupon race: two tabs, one single-use code. 12. Plan v2 published while checkout open on v1 — buyer gets v1, provably. 13. $100.00 vs $99.99 min-payout boundary; $0.01 requests; cap-equals-withdrawable exact tie. 14. Micro vs mini mixed fills — tick-value math per contract spec table, never hardcoded multipliers. 15. Trader passes eval while payout-frozen under investigation — progression continues, payouts stay gated, comms template fires. 16. Affiliate buys through own code — attribution voided, flag. 17. Identity merge AFTER both identities funded separately (now over account cap) — grandfather + block new, document policy. 18. Nightly batch crashes at account 2,341 of 5,000 — resumable, idempotent, no double-applied days. 19. Restore-from-backup drill with payouts mid-queue — no duplicate Rise transfers (idempotency keys survive restore). 20. Fuzz: adversarial day-sequences (alternating +$149.99/+$150.01, single +$10k day into consistency math, 100-day flat grinds) hunting rounding/overflow/monotonicity breaks. 21. The full ring rehearsal: simulate a 6-account hedged syndicate end-to-end through engine+detectors — detectors must flag by day 3; caps must bound worst-case extraction to the computed ceiling. 22. Load: 500 simultaneous payout requests in one minute (a viral promo day) — all correct, p95 < 1s.

### B5. Recursive depth directive (how "the most complete plan ever" actually gets produced)
This document is the constitution; the exhaustive detail is generated per-module IN the repo where context is fresh. Before coding any module, produce `docs/plans/Mx-<name>.md` following this mandatory template, each section substantive: (1) purpose & invariants; (2) entities/schema deltas; (3) full state machines (every state, every transition, every guard — as Mermaid); (4) API endpoints touched (request/response schemas); (5) events emitted/consumed; (6) failure-mode enumeration (what breaks, blast radius, recovery); (7) adversarial scenarios (extend Appendix A + B4 — invent new ones; minimum 5 novel per module); (8) test plan mapping every behavior to a named test; (9) observability (metrics, alerts, dashboards for this module); (10) open questions for the founder. **Gate: no module's code begins until its plan doc is reviewed and its §7 contains creative scenarios not found in this document.** That gate is how the plan stays ahead of the adversaries — and of us.

### §4-ADDENDUM — MODULE EXPANSION DIRECTIVE (M11–M18; spec each via B5 template)
Phase-0 research WILL surface capabilities beyond M1–M10 (QTG/YPF ship them; several are market table-stakes). Size each MUST/SHOULD/LATER from the 1B matrix: **M11 Certificates & social proof** (signed, verifiable pass/payout share cards); **M12 Transparency platform** (public trailing pass rates, payouts paid, on-chain proof links — auto-computed trust moat); **M13 Trader analytics/journal** (per-account performance breakdowns — retention driver); **M14 Loyalty & retention engine** (progressive cap release after Nth payout, streaks, reset discounts, win-backs — FundedNext/SharkFutures mechanics); **M15 Discord integration** (role sync on funded/payout events, announcements bot); **M16 Notification center** (in-app/email/push preference matrix, event-driven); **M17 Offers engine** (contextual reset pricing, bundles — every offer a config, A/B-able); **M18 Live-graduation pipeline** (ladder tracker, invitation workflow, vault/bonus display — the marketing face of the payout cap); **M19 KYC & Identity Verification** — a first-class module, NOT a Rise afterthought. Dedicated provider (Sumsub/Veriff/Persona class, ~$1.4–2/verification incl. document + liveness/face + device signals). Why it exists: Merit's zero-denial policy means fraud MUST be caught before anyone is in the money — identity is the chokepoint. Spec must cover: (a) the placement decision (§10) implemented as a config, not a hardcode, so pre-eval vs pre-funded can change without a rewrite (and Direct/instant-funded plans always verify at purchase, since funding is immediate); (b) provider webhook lifecycle (`kyc_required → pending → verified → rejected → expired`) wired into the account state machine — funded trading (or purchase, per config) is blocked until `verified`; (c) **biometric dedupe as a fleet-killer**: provider face-match across all applicants surfaces one-person-many-names rings before liability exists, feeding M7's identity graph; (d) AML/sanctions screening + geo-consistency checks (IP/document/payment country triangle); (e) re-verification triggers: payout-destination change (D4's 48h cooling), active risk flag, dormant-account reactivation; (f) data minimization per D2 — status + refs only, documents never touch Merit's storage; (g) friction telemetry: measure drop-off at the KYC step per placement so the §10 decision gets settled by data within the beta. Anything else Phase-0 discovers gets a numbered spec; nothing enters the roadmap without a plan doc.

---
## APPENDIX D — CYBERSECURITY: FULL-STACK THREAT MODEL & CONTROLS (a breach = firm death)

### D0. Research directive (`research/SECURITY_LANDSCAPE.md`)
Research prop-firm/trading-platform breach history (credential-stuffing against trader dashboards is the #1 documented attack), fintech incident post-mortems, OWASP ASVS L2 + API Security Top-10 as baseline, X/security community on Next.js/Postgres/webhook hardening. Output: control checklist mapped to every B2 endpoint + 10 new attack scenarios into the B4 battery.

### D1. Threat model (STRIDE pass per asset, in each module plan)
Crown jewels: **treasury/payout path** (fraudulent settlement) · **identity graph/PII** (we hold fingerprints — minimize, encrypt) · **admin console** (one owned admin = total loss) · **Rithmic SFTP/API creds** (provisioning forgery = free funded accounts) · **PSP/Rise webhook keys** (forged payment events) · **trader sessions** (ATO → payout redirection) · **plan configs** (tampering = silent economic sabotage) · **the founder** (SIM-swap/phishing: hardware keys everywhere, carrier port-lock, separated identities).

### D2. Application controls (binding)
Passwordless only (passkeys + OTP — no password DB to stuff); short-lived httpOnly sessions, refresh rotation; **every query identity-scoped via a shared `scopedDb(identity)` accessor — raw table access in app code forbidden and lint-enforced** (IDOR is THE dashboard bug class); zod at every boundary; parameterized queries only; rate limits per IP+identity on auth/checkout/payout; Turnstile on auth+checkout; strict CSP/HSTS/frame-deny; CSRF on cookie mutations; semgrep + dependency-audit + secret-scanning as CI merge blockers; secrets in platform vault, least scope, 90-day rotation calendar.

### D3. Infrastructure controls
Admin on a **separate origin**, IP-allowlisted, hardware-key SSO, unlinked from public surfaces; Postgres least-privilege roles (app role: no DDL, no DELETE on append-only tables — enforced in the DB, not convention), private networking, PITR + immutable offsite backups; SFTP worker egress-restricted with rotating keypair; Cloudflare WAF/DDoS/bot rules fronting everything; all webhooks HMAC + timestamp/nonce replay windows; audit logs shipped off-box tamper-evident; alerts on every admin login, failed-auth bursts, payout-config changes, role grants, SFTP failures; canary tokens in DB + repo as tripwires.

### D4. Payout-path hardening
Dual-control + delay window on treasury/Rise credential changes AND any config edit touching cap/split/gap; **payout destination changes trigger 48h cooling + re-verification** (the classic ATO cash-out vector); daily settlement-velocity ceiling with auto-page; Rise keys minimum-scope + IP-pinned; anomaly alert on admin actions outside normal hours/geo.

### D5. SDLC & assurance
A named negative authz test per endpoint per resource ("user B cannot read account A") in CI; D0 attack scenarios merged into B4; pre-launch external pentest or structured ASVS-L2 self-assessment with logged findings; incident-response runbook (contain → rotate → notify → post-mortem; comms templates pre-written — payout trust survives honesty, not silence); security.txt + VDP safe-harbor from day one; quarterly restore and key-rotation drills on the ops calendar.

---
## APPENDIX C — THE CLAUDE CODE OPERATING SYSTEM (how we run the build itself)

### C0. Research directive (Phase 0, same week; produce `docs/CLAUDE_CODE_PLAYBOOK.md`, refresh monthly)
Research current community practice yourself: X searches ("claude code" workflow/tips/CLAUDE.md/subagents/worktrees, posts by Anthropic engineers and heavy users), Anthropic's own "Claude Code best practices" engineering posts, r/ClaudeAI, HN threads. Extract: context-management tactics, plan-mode usage, multi-session patterns, failure stories (what makes agentic coding go wrong). Merge findings into this appendix; where community practice contradicts it, propose amendments.

### C1. Workspace division of labor
- **Claude Code (repo)** = all implementation, tests, migrations, module plan docs. The repo is the only source of truth for engineering.
- **Cowork / desktop chats** = upstream of the repo: business research (Phase 0/1B/Appendix-A dossiers), vendor comms drafting, workbook analysis. Outputs land in `research/` via files, never as chat-only knowledge.
- **claude.ai strategy chats** (with the business model workbook) = economics, pricing, rule design decisions. Decisions flow into `docs/DECISIONS.md`; the repo never depends on a chat transcript.

### C2. Repo memory architecture (the project's brain lives in files, not context)
- **`CLAUDE.md`** (root, ≤ ~150 lines — it loads every session, keep it lean): pointer to this master prompt, build/test/run commands, conventions (money=cents, UTC, calendar module), current-phase pointer, the working agreements from §9, and "read `docs/SESSION_LOG.md` tail before anything."
- **`docs/SESSION_LOG.md`** — append-only handoff journal (see C3). **`docs/plans/Mx-*.md`** — module plans (§B5). **`docs/DECISIONS.md`** — ADRs. **`docs/EDGE_CASES.md`** — living registry. **`docs/STATE.md`** — one screen: what's done, what's in flight, what's blocked, updated every session end. A fresh session reading CLAUDE.md + STATE.md + SESSION_LOG tail must be fully oriented in <2 minutes with zero human explanation — that is the handoff standard.

### C3. Session protocol (every session, no exceptions)
- **Start ritual:** read CLAUDE.md → STATE.md → last 2 SESSION_LOG entries → the active module plan. State back the objective in one sentence; get confirmation.
- **One objective per session.** A session is a single module slice or a single bug family — never "continue everything."
- **End ritual (before context runs out, not after):** commit clean; append SESSION_LOG entry: `done / next / blockers / landmines (things I learned that aren't in code) / files touched`; update STATE.md. If a session dies mid-task, the next one must recover from the log alone.

### C4. Context management (the scarce resource; manage it like treasury)
- `/clear` between unrelated tasks; start fresh per module slice rather than marathon sessions — long sessions accumulate noise and degrade output.
- `/compact` deliberately at natural checkpoints (~50–60% usage) with a focus hint ("keep: current plan, schema decisions, failing tests"); never let auto-compaction land mid-money-path — finish or checkpoint first.
- Feed **paths, not blobs**: point at files; use subagents/Tasks for bulk reads (research, log spelunking, dependency audits) so raw material never floods the main thread; ask for summaries into files.
- Keep source files small and single-purpose (also better for the engine's own edits). Large generated artifacts (OpenAPI, fixtures) live in files, referenced not pasted.
- The Monte-Carlo/CI simulation outputs: write to `test-results/` and read summaries — never stream 10k-trader dumps into context.

### C5. Model, effort & mode selection (the token portfolio; check `/model` at build time — lineups drift, tiers don't)
Current lineup (Aug 2026): **Claude Fable 5** (Mythos-class, deepest reasoning, built for long-running agents) > **Opus 4.8** (flagship coding/agentic; `/fast` mode = same Opus, faster streaming) > **Sonnet 4.6** (near-flagship daily driver) > **Haiku 4.5** (throughput chores). Community consensus + Anthropic guidance distilled:

**Fable 5 — the high-stakes ~20% (judgment concentrated where mistakes are irreversible):**
- Rules-engine design + its edge-case enumeration (M1) and any change to it, ever
- Schema design & every migration touching money tables; public API contract changes
- Security review of auth/payout/ledger paths (Appendix D work); the self-adversarial passes (C6)
- Cross-cutting refactors touching 10+ files; module plan docs (B5 template) for M1/M2/M5/M7
- Phase-0 synthesis (turning research into architecture decisions); Appendix A/B4 scenario invention
**Opus 4.8 (effort: xhigh — Anthropic's recommended setting for serious coding/agentic work):**
- Long agentic implementation sessions on approved plans; deep debugging; multi-file features
- `/fast` variant for interactive pair-programming loops where latency shapes the rhythm
**Sonnet 4.6 — the routine ~80%:** endpoints/UI/tests from an approved plan, refactors within one module, fixture and seed work, doc drafting. Default session model.
**Haiku 4.5:** changelogs from commits, test-output summarization, bulk renames/transforms, log spelunking via subagents.

**Effort/thinking dial:** default high everywhere; xhigh (or max where exposed) for M1 logic, migrations, security reviews, and B4 scenario work; drop to medium only for chores where Haiku isn't already the answer. In the terminal client, thinking keywords scale the reasoning budget: `think` < `think hard` < `ultrathink` (~32k-token reasoning budget on a single decision — reserve for architecture calls, gnarly debugging, and design reviews; it's a scalpel, not a default). Plan mode (read-only reasoning → approved plan → execute) remains MANDATORY for structural work and migrations regardless of model.

**Model-outage resilience:** model availability is a real operational risk (Fable 5 was suspended Jun 12–Jul 1, 2026 — mid-build, that's three lost weeks if the workflow depends on one tier). The C2/C3 file-based handoff standard is the mitigation: because all project state lives in files, any tier can pick up any session; if the escalation tier is down, Opus/Sonnet proceed on already-approved plans and defer new M1/migration/security decisions until it returns. Never let a plan doc exist only in one model's context.

**Pin it in CLAUDE.md** (models don't auto-switch; the block gives every session the routing context):
```
## Model preferences
Default: sonnet (routine implementation on approved plans)
Escalate to fable-5 for: rules-engine changes; migrations; auth/payout/ledger security review;
  cross-cutting refactors (10+ files); API contract changes; module plan docs for M1/M2/M5/M7
Opus 4.8 @ xhigh for: long agentic builds, deep debugging; /fast for interactive loops
Haiku for: changelogs, summaries, bulk mechanical transforms
```
Rule of thumb: *thinking is expensive once, rework is expensive forever* — over-spend on planning models, under-spend on typing models. On subscription the constraint is rate limits, not dollars: spend Fable time on plans and reviews (short, dense) and let cheaper tiers burn the long token streams.

### C6. Prompting patterns that work (use verbatim)
- **Plan-then-build:** "Read docs/plans/M5.md §3. Propose the diff as a plan first. Do not write code until I approve."
- **Tests-first for money:** "Write the failing golden tests for scenarios 4,7,12 from Appendix B4 first; show me red before green."
- **Self-adversarial pass:** after any money-path diff: "Now switch roles: you are a juicing-ring operator and a hostile auditor. Attack this diff. List exploits, then fix."
- **Checklist closure:** "Walk M1's plan §8 test map line by line; mark each implemented/passing with the test name."
- **Uncertainty surfacing:** "List everything you assumed that isn't in the docs" at the end of each work block → assumptions go to DECISIONS.md or get corrected.
- **The interview-first spec:** for any fuzzy feature, reverse the flow — "Interview me about this feature before writing anything: probe requirements, question edge cases, surface tradeoffs. Then write the spec." Approve the spec, then execute it in a *fresh session* carrying only the spec and decisions, not the interview. (Spec-driven flows show 50–80% implementation-time reductions precisely because the thinking happens before the typing.)
- **Error-loop circuit breaker:** when a fix introduces a new bug twice in a row, STOP prompting. The endless error loop (AI "fixes" bug A by creating bug B, forever) burns sessions. Escalation path: read the code yourself → write a precise repro + expected behavior → fresh session with that repro. "That's wrong" is a bad prompt; "auth middleware should read the Authorization header, not X-Token, and 401 on expired tokens" is a good one.
- **The comprehension rule (golden, non-negotiable on money paths):** never merge code you can't explain to someone else. Your name is on the commit; on `rules-engine/`, `payout/`, `ledger/`, the founder must be able to walk any diff line-by-line. If you can't explain it, it doesn't merge — have Claude teach it to you first, then decide.

### C7. Parallelism & safety rails
Git worktrees for parallel sessions (one module per worktree; never two sessions touching shared packages simultaneously — rules-engine work is always solo). Branch per module slice; CI green before merge; migrations only on main via reviewed PRs. Permission posture: auto-allow read/test/lint; confirm on file-writes outside the active module; always-confirm on migrations, deletes, network, and anything in `payout`/`ledger` paths.

### C9. Self-slop checks (add to C6's verbatim patterns)
- After any UI work: "Render this page mentally against Appendix F's hard-fail list. Score each tell present. Fix before showing me."
- After any infra/config work: "Audit this against Appendix E's failure taxonomy. Which vibe-code failure mode is closest to what you just wrote?"

### C8. The weekly meta-session (the system updates itself)
Every ~7 sessions run a retro: Claude Code reads the full SESSION_LOG + recent CI failures, then proposes amendments to CLAUDE.md, this appendix, and the plan templates ("what slowed us, what broke, what pattern should be standard"). **Measure velocity, never feel it:** a randomized controlled trial found experienced developers were 19% *slower* with AI tools while believing they were 20% *faster* — a ~40-point perception gap. The retro therefore reads objective signals only: plan-doc items shipped, golden tests added and passing, CI history, EDGE_CASES entries closed — never "it felt productive." If the numbers say a workflow is slow, it changes, however good it feels. The build process is versioned and improved exactly like the product. That loop — plus the handoff standard in C2 — is what makes a 2–3 month solo+AI build compound instead of thrash.

### C10. Community-hardened operating rules (distilled from Anthropic guidance + 2026 heavy-user practice; treat as binding)
- **Hooks are law; CLAUDE.md is advice.** Anthropic's own doctrine: CLAUDE.md instructions are *advisory*; hooks are *deterministic* and guarantee the action happens. Anything that must ALWAYS happen becomes a hook, never a memory-file sentence. Merit's mandatory hook set: **PostToolUse → run the module's test command after every file edit** (the single highest-value hook in community consensus); **PreToolUse → block dangerous shell patterns** (rm -rf, prod connection strings, force-push) and any write into `payout/`/`ledger/` paths without the confirm flag; **Stop → completion gate** that runs lint+typecheck+tests and blocks the turn from ending until green (deterministic "definition of done"); **PreCompact → preservation policy** (see below); **SessionStart → echo STATE.md + last SESSION_LOG entry**.
- **The surface map: enforce → hooks/permissions; knowledge → skills; conventions → lean CLAUDE.md.** Repeated workflow instructions become `.claude/skills/<name>/SKILL.md` files (progressive disclosure — they load only when relevant, keeping CLAUDE.md lean). Rule: *if you've written the same instructions to Claude twice, it should have been a skill the first time.* Merit skills to write early: `migration-procedure`, `golden-file-authoring`, `payout-path-review`, `rithmic-csv-format`, `design-tokens`.
- **Compact policy lives in CLAUDE.md** so auto-compaction preserves the right things: "When summarizing: preserve schema/API decisions + rationale, error messages + their fixes, the modified-file list, and current plan step; summarize exploration."
- **Evidence doctrine: never accept "it works."** Every completion claim ships with the test output, the command + its return, or a screenshot. The Stop hook makes this structural; the human habit makes it cultural.
- **The self-grading trap (this one is existential for M1):** when the same model writes implementation AND tests, both share one mental model including its blind spots — "high coverage may reflect nothing more than the AI talking to itself." Merit's countermeasures: golden files derive from **plan docs and Appendix B4 scenarios (human-approved spec), never from implementation output**; the writer/reviewer split runs review in a fresh session/subagent with its own system prompt (the agent doing the work is never the one grading it); acceptance criteria are written in the plan doc *before* implementation exists.
- **Context hygiene rules:** clear the session after **two failed corrections** on the same bug (context poisoning compounds; a fresh session with a written repro beats a third attempt); unbounded "go investigate" is banned — scope reads narrowly or delegate to a subagent that returns a summary file; ~2–3 parallel worktrees maximum, capped by *your review capacity*, not the tooling's.
- **Simplicity doctrine:** simple control loops outperform elaborate multi-agent choreography; low-level tools + selective abstractions beat heavy frameworks. When a workflow feels clever, it's fragile. One builder, one reviewer, deterministic gates — that's the whole machine.
- **Sandbox posture:** deny-rules and allowlists *before* the agent runs anywhere credentials live; dev containers for anything experimental; the agent never holds prod write credentials (E's Replit lesson, enforced at the permission layer, not by request).

---
## APPENDIX E — DON'T SHIP VIBE-CODED INFRASTRUCTURE (the failures that killed real 2025–26 apps)
Merit holds money, PII, and an identity graph. The public vibe-code graveyard is our exact threat model made real — study it (`research/VIBE_FAILURE_POSTMORTEMS.md`) and treat each as a named CI gate. Documented disasters and the control each demands:

- **Moltbook — 1.5M API keys exposed.** Secrets in client bundles / committed env. → Control: secrets ONLY in platform vault; CI secret-scanning as a merge blocker; a pre-deploy grep that fails the build on any key-shaped string in client output; `.env` never in git (verified by CI, not trust).
- **Lovable (170/1,645 apps leaked PII) & Base44 (account creation on private apps via public app_id).** Authorization inverted or absent; access control assumed at the frontend. → Control: **server-side authz on every endpoint**, the lint-enforced `scopedDb(identity)` accessor from D2, and the named negative-authz test per resource from D5 ("unauthenticated request to protected endpoint returns 401; user B reading account A returns 403"). This is THE most common vibe-code fatality and it maps exactly to our M4/M6 dashboards.
- **Enrichlead — subscription tokens bypassed by direct API calls.** Business rules enforced only in the UI. → Control: entitlement/eligibility checks live in the API + engine, never the client; the payout-eligibility engine (M1) is server-authoritative; test direct API calls that skip the frontend.
- **Replit agent — deleted a production DB during a code freeze, then fabricated that backups were gone.** No prod/dev separation; agent had write access to live data; no planning-only mode; no docs access for recovery. → Control (already in this doc, now non-negotiable): **separate prod/dev/preview databases, different credentials, agent NEVER holds prod write creds**; migrations only via reviewed PR on main; app DB role has no DELETE on append-only tables and no DDL (D3); PITR + one-click restore tested in a quarterly drill; destructive ops require human confirmation (C7).
- **Tea — verification photos in a public Firebase bucket with GPS metadata.** Public-by-default storage; PII retained with metadata. → Control: object storage private by default, signed time-limited URLs only; strip EXIF/metadata on any upload; KYC documents stay at the provider, never with us (D2/M19); a test asserting no bucket is world-readable.

**The pattern behind all of them (internalize this):** vibe-coded code *satisfies the happy path and skips the security primitive.* Escape.tech scanned 5,600 vibe-coded apps → 2,000+ high-impact vulns, 400+ exposed secrets. The fix is not "be careful" — it's a **verification layer that runs before deploy**: behavioral E2E tests covering authenticated vs unauthenticated flows, direct API calls bypassing the UI, and token/subscription bypass — exactly our §5 + D5 batteries, wired as deploy gates. Also adopt: STRIDE one-pager per module (D1); signature-verified idempotent webhook handlers with CI contract tests (already M3/M5); structured logs with PII/token redaction and audit trail separated from debug logs; no debug logging in prod builds. **Merit's standard: if a test wouldn't have caught the Moltbook/Lovable/Replit/Tea failure, we haven't finished the module.**

**E2. Why "prompt it to be secure" is not a control (research findings, 2025–26 — this section justifies the whole verification architecture):**
- **Security prompting has been tested and it fails.** Researchers tried security-focused prompts, CWE self-identification, and direct hints about which vulnerability categories to watch — *none reliably closed the gap* between functional and secure. Models learn to produce code that passes tests, not code that resists attacks. Conclusion: it's a training-distribution problem, not a prompting problem, so Merit's controls are structural (hooks, named negative tests, reviewer-split, human diff-reads on money paths) and never "Claude was told to be careful."
- **The failure class is business logic, not syntax.** In the Tenzai five-tool benchmark (15 apps, 69 vulnerabilities, 6 critical), *four of the six critical flaws came from Claude Code* — and none of the tools produced classic SQLi/XSS. Models dodge the bugs that are well-represented in training data and fail on **access control, authorization bypass, and trust boundaries** — exactly Merit's crown-jewel surface (identity-scoped accounts, payout eligibility, admin). And static analysis (Semgrep/GoSec) *cannot reason about trust boundaries* — which is why D5's per-endpoint negative-authz tests are hand-specified, not scanner-derived.
- **Base rates to respect:** Veracode 2025 — 45% of AI-generated samples fail basic security tests; CodeRabbit — AI PRs carry ~1.7× more major issues than human-written; Gartner — defect *escape* rates rise ~25% when review practices aren't adapted to AI's failure profile. Survey reality: 96% of developers don't fully trust AI code, yet under half review before every commit — the gap between those two numbers is where every incident above lived. Merit's rule: **on `rules-engine/`, `payout/`, `ledger/`, and auth paths, a human reads every diff, full stop** — the founder's review time is budgeted in the W-plan as a real resource, concentrated exactly there.
- **"Looks confident" is not a signal.** AI mistakes arrive well-formatted with explanatory comments; reviewer instincts trained on messy human errors mis-fire on polished-but-wrong code. Review against the *plan doc's acceptance criteria with the spec open in a parallel window* — requirement fidelity, not code aesthetics.

**E3. Controls added from primary-source review (r/SaaS infra thread, Retool production checklist, vibe-coding playbooks — each of these was a gap):**
- **Slopsquatting / dependency supply chain.** Models hallucinate plausible package names; attackers now register those names and publish malware under them. Binding rules: no new dependency enters the repo without human approval; every package verified to exist, be maintained, and be the *intended* package (typo-adjacent names checked); lockfiles committed and CI-enforced (`--frozen-lockfile`); SCA + SBOM generation in CI; transitive deps audited on add, not on incident. Registry-fetch in CI is deny-by-default beyond the allowlisted registries (our network posture already leans this way — formalize it).
- **Public API specs are an attacker's map.** Field report: reverse-engineering vibe-coded apps is trivial because "the backend is never protected — public specs at /docs." We mandate OpenAPI (B2) — so the spec itself is gated: `/docs`, `/openapi.json`, `/swagger` return 401/404 in production (named B4-style test, run against prod config in CI). Internal endpoints (`/internal/*`) live behind the admin origin, never merely "unlisted."
- **Permissive-by-default is the RLS lesson.** A single audited AI-built app: 14 access-control issues, worst being records readable by *any logged-in user* — generated policies default open and demo fine. Our `scopedDb(identity)` is the structural answer, plus one more rule: any new table ships with its negative-authz test in the same PR, or the PR doesn't merge.
- **Prompt injection (OWASP LLM Top-10 #1) — a rule for future-Merit.** The moment any LLM feature touches the product (support assistant in M10, risk-analysis copilot in M7), untrusted content (trader messages, uploaded docs, web content) is hostile input: it never reaches a tool-capable model with access to internal data or actions; LLM outputs render as data, never execute as instructions; support-bot scope is read-only over published docs until a threat-model pass says otherwise. Decided now so it's never improvised later.
- **Keep the boring parts aggressively boring.** The shippers' consensus doctrine, adopted verbatim: managed auth, hosted Postgres, object storage, platform env-vars, basic CI — and *almost no custom infrastructure until there is actual pain*. Custom infra is a liability we take on only when a module spec proves the managed option fails a requirement. Corollary — **cloud cost hygiene**: dev/preview resources auto-torn-down on schedule, egress and storage alarms from day one, one monthly cost review line in the C8 retro (bill creep is the quiet vibe-infra tax).
- **Stat refresh for the doctrine:** Veracode Spring 2026 puts AI code's security pass rate at ~55% — *barely moved in two years*, confirming E2's core claim that model improvement won't close this gap; and even the best frontier model resolves only ~59% of real-world engineering tasks (SWE-bench Pro, mid-2026). The verification layer isn't a phase of the build. It *is* the build.

---
## APPENDIX F — THE ANTI-AI-TELL DESIGN STANDARD (Merit must not look vibe-coded; trust is visual too)
A funded-trader firm's site IS its credibility — the "broken window effect": one templated tell makes traders quietly wonder what else is neglected (and for a firm holding their payouts, that question is fatal). AI-generated frontends share a visual fingerprint from distributional convergence (models emit the statistical median of scraped SaaS pages). Every item below is a **hard fail** in review. Produce `docs/DESIGN_SYSTEM.md` committing to specific non-default choices up front, then enforce.

**Color — the #1 tells:**
- ❌ Purple→blue / indigo gradient anywhere (the single most reliable AI tell, born from Tailwind's `indigo-500` demo default). ❌ "Vibecode purple" lavender. ❌ default shadcn-gray + tailwind-blue untouched. ❌ gradient slapped on a big number "for impact." ❌ timid even palette with no dominant color; ❌ pure #fff/#000 with no depth.
- ✅ Commit to a specific, non-default brand palette with ONE dominant color + one accent, chosen deliberately (Merit = trust/precision: consider a deep ink or forest base, a single sharp accent — NOT indigo). Customize shadcn color tokens, radius, and shadow depths so defaults never ship.

**The colored-left-border card** — a 3–4px colored stripe on a card/blockquote — is "almost as reliable a sign of AI design as em-dashes are for AI text." ❌ Never. Also ❌ "cardocalypse" (every block a bordered rounded-2xl shadow-lg card, cards nested in cards); ❌ the untouched shadcn default card repeated.

**Typography:** ❌ Inter/Poppins/Space Grotesk/Geist as the default face; ❌ all-caps section labels everywhere; ❌ decorative monospace "for the hacker vibe"; ❌ one serif-italic accent word on a sans page. ✅ Pick an intentional type pairing most sites won't have; vary weight/size with purpose, not decoration.

**Layout:** ❌ centered hero with a pill badge floating above the H1; ❌ hero → three icon-top feature cards → testimonials → pricing (middle plan elevated) → FAQ accordion → footer, in that exact order; ❌ uniform 16px radius on everything; ❌ floating social-proof badge in the corner. ✅ Asymmetry with intent; ✅ one layout primitive repeated until it becomes a signature rather than seven different treatments; ✅ break the template order.

**Copy — the textual purple gradient:** ❌ no sentence opening with "Empower / Unlock / Transform"; ❌ no feature titled with two abstract nouns ("Seamless Integration"); ❌ vague aspirational headlines ("Build the future"); ❌ emoji as icons; ❌ every-other-word bolded or recolored until nothing is emphasized. ✅ Every headline makes ONE concrete claim, ideally with a number (Merit has them: real pass rates, payout speed, on-chain totals — the transparency platform M12 is the antidote to slop copy); ✅ at least one sentence per section that sounds like a person wrote it. **Note for all Merit prose, site and docs: avoid the em-dash tell — prefer periods, commas, or parentheses.**

**Enforcement:** `docs/DESIGN_SYSTEM.md` locks palette/type/radius/shadow/spacing tokens before UI work; every component uses tokens, never raw defaults; a review checklist (the ❌ list above) runs on every page; consider a Playwright "slop-score" pass (detect gradient heroes, left-border cards, Inter, default shadcn signatures) in CI. The bar: a skeptical trader landing on meritfutures.com should read "a real company built this," never "another AI-generated prop firm." Given the trust research (MFF's 4.9 is earned credibility), looking generic is a competitive wound, not a cosmetic one.

**F2. Code-level tells (the backend is a surface too — auditors, acquirers, security reviewers, and open-source-savvy traders can all fingerprint unreviewed AI code, and for a payout platform that reads as a diligence red flag):**
The research-documented tells, each now a repo rule:
- ❌ **Comments that explain WHAT, not WHY**, at uniform density. → Rule: comments exist only where a decision needs context ("using advisory locks here because the batch and payout path can race — see EDGE_CASES #14"), reference tickets/edge-cases, and cluster at complexity. A file where every line is narrated gets rejected in review.
- ❌ **Placeholder logic** (`// TODO: handle this case`) inside complete-looking code — the model saw the gap and skipped it. → Lint: no TODO/FIXME merges to main; gaps become EDGE_CASES entries or get fixed.
- ❌ **Speculative abstraction** — helpers with one caller, layers for hypothetical futures, config for things that never vary. → Rule of three: no shared helper until the third call site exists.
- ❌ **Unnecessary defensive programming** — try/catch and null checks on already-validated paths (noise that hides real trust boundaries), paired with its evil twin: **broad catches that swallow failures with vague logs**. → Rule: validate at boundaries (zod), trust the interior, never catch without a typed handling decision; swallowed errors are a review-reject.
- ❌ **`as any` / type-assertion workarounds** to silence TS instead of fixing types. → Lint-banned outside test fixtures.
- ❌ **Style discontinuity**: naming that drifts within one function (`userData` → `user_data` → `data`), patterns that don't match the surrounding file, a fourth database-access idiom where the codebase has one. → The `scopedDb` accessor + established module patterns are mandatory idioms; consistency is checked in review against the file, not the diff alone.
- ❌ **Generic commit messages** ("update code", "fix bug"). → Conventional commits referencing the plan-doc section or edge-case ID.
- **The slop-reviewer pass (C9's third pattern, use verbatim after any sizable diff):** "Review this diff against the surrounding code in a scratchpad. Identify AI-slop instances with line references: over-commenting, speculative abstraction, defensive noise, type workarounds, style mismatches vs the file. Output the cleaned diff." Run it in a fresh reviewer session (C10's self-grading rule applies to slop too).
The deeper standard: AI slop is *polished but architecturally thoughtless* — it compiles, passes its own tests, and rots the codebase by pattern-mimicry (500-line functions, duplicated idioms, tests that mirror the implementation instead of the requirement). The defense is already this document's spine: plan docs before code, spec-derived tests, one architecture enforced by skills and review. Polish is not the quality signal; **fit** is.
