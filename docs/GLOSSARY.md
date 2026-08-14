---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md]
last_updated: 2026-08-14
---

# GLOSSARY

Every domain term defined **once**, here. All other docs link to this file (`[win day](GLOSSARY.md#win-day)` from a sibling in `docs/`, `[win day](../GLOSSARY.md#win-day)` from one level deeper such as `docs/plans/`) rather than redefining. If a definition needs to change, it changes here and nowhere else.

Two hard conventions apply to every numeric term below:
- **Money is integer cents.** No floats anywhere in a financial path, including examples in docs.
- **Ratios and percentages are basis points (bp), integer.** 30% is `3000`. 0.3% is `30`. A percentage never appears as a float.

Comparison operators are stated explicitly per rule and are binding: the published rules page and the engine must use the same operator, and the golden tests assert the boundary.

---

## Part 1: Time and calendar

## trading day
A date on the exchange session calendar for which a session existed. Trading days are the unit of every counter in the rule engine (minimum days, cadence gaps, win days). A calendar date with no session (weekend, full holiday) is not a trading day and advances no counter. Trading days advance even when a trader does not trade, and even when the market is halted or limit locked for the whole session (see [halted session](#halted-session)).
Governing data: [trading_calendar](architecture/DATA_MODEL.md#trading_calendar).

## session
The exchange trading period bounded by the CME session open and close for a trading day, expressed in exchange time (CT). Merit stores all timestamps in UTC and derives session membership from the calendar, never from wall-clock arithmetic. A fill belongs to the trading day whose session contains its execution timestamp.

## half day
A trading day with a shortened session (for example the day after Thanksgiving). A half day is a full trading day for every counter. It is published as such so nobody is surprised.

## halted session
A trading day on which the market is halted or limit locked such that a trader cannot transact. Decided and published: calendar trading days advance (so cadence gaps and minimum-day counters progress), and [win days](#win-day) do not advance (no P&L, no win). This is the B4 scenario 2 resolution.

## trading calendar
The maintained dataset of trading days, session open/close times, half days, holidays, and DST transitions. One module (`TradingCalendar`) reads it and everything else calls that module. Rule code never calls `new Date()` arithmetic.

## last closed day
The most recent trading day for which the [nightly batch](#nightly-batch) has completed and marks are final. Every rule evaluation, eligibility check, and payout decision is computed against the last closed day and nothing more recent. This is the semantic that makes a payout request at 23:59:59 and a batch at 00:05 deterministic (B4 scenario 6).

## T+1
Shorthand for Merit's data posture under [ADR-002](DECISIONS.md): all derived state reflects the last closed day, so our system's view of an account lags live trading by one batch cycle. Intraday enforcement is delegated to Rithmic's [auto-liquidator](#auto-liquidator). Trader-facing and admin surfaces label data "as of last closed session".

## nightly batch
The scheduled job that ingests the day's [ingest files](#ingest-file), normalizes [fills](#fill), computes [daily marks](#daily-mark), runs breach checks, advances [rule state](#rule-state), emits events, and runs the [replay self-audit](#replay-determinism) and [reconciliation](#reconciliation). It is arrival-triggered (files present) with a late-file alarm, resumable, and idempotent per account per day.

---

## Part 2: Plans and configuration

## plan
A named product family (Core EOD, Merit Rapid, Direct), with codes `core_eod`, `merit_rapid`, `direct`. A plan has no rules of its own; its rules live in [plan versions](#plan-version). "Merit Rapid" was called "Rapid Daily" in the constitution and was renamed at the M1 gate ([ADR-013](DECISIONS.md)) because its real cadence is about one payout per 5 trading days, not one per day.

## plan version
An immutable, versioned rule configuration plus the published copy blocks that describe it. An [account](#account) is permanently bound to the plan version it was sold under. Publishing a new version never mutates existing accounts. "The rules at the time" is always provable because the version is pinned on the account and snapshotted on every [eligibility snapshot](#eligibility-snapshot).

## plan config
The rules JSON inside a plan version. It is the single source of truth executed by the engine and rendered by marketing. Canonical field names are fixed in this glossary and schema'd in [DATA_MODEL](architecture/DATA_MODEL.md#plan_versions). Ratios are bp, money is cents.

## account size
The nominal capital of a simulated account (25K, 50K, 100K). Sizes derive from the canonical 50K parameters by scaling percentage-expressed rules. Because published numbers must be exact, each size's derived thresholds are materialized to integer cents in [plan_version_sizes](architecture/DATA_MODEL.md#plan_version_sizes) at publish time and never recomputed at runtime.

## eval (evaluation phase)
The phase in which a trader must reach a [profit target](#profit-target) without [breaching](#breach), subject to [minimum trading days](#minimum-trading-days) and optionally [eval consistency](#eval-consistency). Passing moves the account to [funded](#funded-phase).
Config: `phase_eval`.

## funded phase
The post-pass phase in which the trader trades a simulated funded account and can become eligible for [payouts](#payout-request) by clearing every [gate](#gate). Funded accounts operate exclusively in a simulated environment; this disclosure appears in the footer, checkout, ToS, and certificates.
Config: `phase_funded`.

## direct (instant funded)
A plan with no eval: the account starts in the funded phase at purchase. Direct plans always verify identity at purchase (see [KYC placement](#kyc-placement)) because funding is immediate.

## reset (rebuy)
Repurchase of a [breached](#breach) or expired account at the reset price, creating a new account bound to a plan version (the current one at time of reset). Reset velocity per [identity](#trader-identity) is a risk signal.

---

## Part 3: Drawdown and breach

## drawdown (DD)
The maximum permitted loss from the account's high-water reference, expressed as bp of [account size](#account-size) and materialized to cents. Merit v1 uses [trailing-EOD](#trailing-eod-drawdown) and [static](#static-drawdown) types; [intraday trailing](#intraday-trailing-drawdown) is config-supported and unused.
Config: `drawdown.type`, `drawdown.amount_bp`.

## floor
The account's current loss limit in absolute cents. A [breach](#breach) occurs when the day's measured low is **less than** the floor (strictly `<`; touching the floor exactly is not a breach). The floor is recomputed by the engine every closed day and stored in [rule state](#rule-state).

## trailing-EOD drawdown
Floor = (maximum end-of-day balance ever achieved) minus (drawdown amount). The floor moves up with new EOD balance highs and never moves down. Because it trails end-of-day balances only, intraday spikes do not raise it, which is the trader-favorable property Merit markets.
Config: `drawdown.type = "trailing_eod"`.

## floor lock
The rule that stops a trailing floor from trailing once the account reaches a configured profit threshold, fixing the floor at [account size](#account-size) plus a configured amount (typically the point at which the trader's capital is protected). Locking is permanent for the account: the high-water balance stops updating at the same moment, which is what makes the floor immutable rather than merely capped. **Enabled on all three v1 plans at account size plus 10,000 cents ($100)**, engaging at exactly `drawdown + 10,000c` of closing profit so that the trailing floor is already sitting at the lock value when it engages and the floor never jumps ([ADR-014](DECISIONS.md)).
Config: `drawdown.lock.enabled`, `drawdown.lock.at_profit_cents`, `drawdown.lock.floor_at_cents`.

## static drawdown
Floor = initial balance minus drawdown amount, fixed for the life of the account. Does not trail.
Config: `drawdown.type = "static"`.

## intraday trailing drawdown
Floor trails real-time equity including unrealized profit. Supported by config for future use and **not used in v1**, because Merit computes from end-of-day marks and delegates intraday enforcement to Rithmic. Named here so the term is never confused with [trailing-EOD](#trailing-eod-drawdown) in copy: several competitors use intraday trailing and it is the most complained-about mechanic in the industry.

## daily loss limit (DLL)
A per-day loss threshold. Two modes: **soft** (flatten or pause; in v1 Merit flags only, because Rithmic's auto-liquidator performs the enforcement) and **hard** (counts as a [breach](#breach)). A hard limit breaches when the day's realized loss is **more than** the limit (strict `>`), so a loss exactly at the limit survives, matching the [floor](#floor) comparison's strict `<`. No v1 plan configures a limit; the operator is fixed now so the two breach comparators can never disagree by accident later.
Config: `daily_loss_limit.type = "none" | "soft" | "hard"`, `daily_loss_limit.amount_bp`.

## breach
A terminal rule violation that closes the account. Breach is evaluated on the day's low versus the [floor](#floor) for the account's DD type, plus hard DLL if configured. **Day ordering is fixed and binding: mark ingest, then breach check, then progression.** If a breach and a pass condition occur on the same day, the breach wins (B4 ordering rule).

## auto-liquidator
Rithmic's server-side risk enforcement. Merit pushes max-loss risk settings per account via provisioning; Rithmic liquidates positions when a threshold is hit, whether or not the trader is connected. Merit never builds streaming risk in v1. The EOD report records the liquidation event, time, and trigger, which becomes [evidence](#evidence-pack).

## auto-liquidation setpoint
The max-loss value Merit pushes to Rithmic for an account. **Decided and binding: the setpoint sits AT the account's current [floor](#floor)**, not above it and not below it, and it is re-pushed whenever the floor moves, which since [ADR-013 and ADR-014](DECISIONS.md) can only happen for two reasons: a new end-of-day high, or a [floor lock](#floor-lock). Both move the floor **up**, so a setpoint that is stale is always too permissive rather than too strict, which is the safe direction.
The consequence is the one place where a vendor's real-time behavior and Merit's end-of-day arithmetic meet, so it is stated exactly: a clean liquidation leaves the day's low **exactly at** the floor and the account **survives**, because [breach](#breach) is `low < floor` and never `low <= floor`. A liquidation that slips through the floor leaves the low **below** it and the account **breaches**. Traders therefore experience the auto-liquidator as the thing that saves them and slippage as the thing that ends them, which is both true and publishable. All three cases (one tick above the floor, exactly at the floor, one tick below) are pinned by golden files.

---

## Part 4: Progression and payout gates

## gate
A single boolean condition that must be true for a payout to be [eligible](#eligibility). The funded gates are: minimum trading days, [win days](#win-day), [buffer](#buffer), [consistency](#funded-consistency), [cadence gap](#cadence-gap), and identity [verified](#kyc-state). Every gate is evaluated independently and reported gate by gate to the trader.

## profit target
The eval profit threshold, in bp of account size, measured on closing balance versus starting balance. Reached when profit **is greater than or equal to** the target (`>=`).
Config: `phase_eval.profit_target_bp`.

## minimum trading days
The count of [traded days](#traded-day) required before the phase can be passed (eval) or a payout can be requested (funded). Compared with `>=`. **A value of 0 disables the gate**, which then reports `pass: true, skipped: true` and renders as disabled rather than as satisfied, because a gate that cannot fail must say so (EC-050). All three v1 plans configure 0 in the funded phase ([ADR-015](DECISIONS.md)); the eval value is unaffected and is at least 1.
Config: `min_trading_days`.

## traded day
A trading day on which the account has at least one [fill](#fill). A day with fills and exactly zero P&L is a traded day and is not a [win day](#win-day).

## win day
A trading day whose realized P&L **is greater than or equal to** the configured win-day floor (`>=`, so a day exactly at the floor counts). Win days accumulate toward the payout gate and **reset to zero after every settled payout**, which is the mechanic that prevents a single good stretch from funding repeated extractions.
Config: `win_days.required_count`, `win_days.floor_bp`, `win_days.reset_on_payout` (always true in v1).

## buffer
A permanent cushion of profit that is never withdrawable. [Withdrawable](#withdrawable) equals balance minus account size minus buffer. The buffer is what keeps a funded account above water after an extraction and is the reason a payout never returns an account to its starting floor position.
Config: `buffer_bp`.

## withdrawable
`max(0, balance - account_size - buffer)`, in cents. Never negative. This is the ceiling on any payout request before the [cap](#payout-cap) clamp is applied.

## consistency
The family of rules limiting how much of a profit total may come from a single day. Merit uses two distinct variants that must never be conflated: [eval consistency](#eval-consistency) and [funded consistency](#funded-consistency). Both compare the best single day against total profit for the period, in bp.

## eval consistency
Evaluated **at pass time only**. If the best day's share of total eval profit **exceeds** the threshold (`>`), the account does not pass yet; the trader keeps trading until further profit dilutes the ratio. **An eval consistency violation never fails an account.** It delays passing, nothing more.
Config: `phase_eval.consistency.enabled`, `phase_eval.consistency.max_day_share_bp`.

## funded consistency
Evaluated **at payout-eligibility time** (payout-gated). If the best day's share of the period's profit exceeds the threshold, eligibility is delayed until the ratio dilutes. **It never breaches an account and never denies a payout retroactively.**
Config: `phase_funded.consistency.max_day_share_bp`.

## consistency period
The window over which funded consistency is measured: profit since the later of (funded start) and (last settled payout). This is what makes consistency reset alongside win days after each payout.

## consistency denominator rule
Binding edge case: the consistency check is **skipped entirely unless total period profit is strictly greater than zero**. A zero or negative denominator makes the ratio meaningless, so the gate passes by definition and the trader is never blocked by an undefined comparison.

## cadence gap
The minimum number of [trading days](#trading-day) that must elapse between payouts, counted from the last settled payout's **effective** trading day, meaning the first trading day whose opening balance reflects the withdrawal ([ADR-013](DECISIONS.md)). Compared with `>=`. Denied or frozen requests do not reset the gap, because a request that produced no money must not cost the trader time.
The gap is measured from a different day than the [win day](#win-day) reset, which uses the same payout's **basis** day. That is deliberate: the gap governs liability rate, so it starts when money leaves; win days govern earned progress, so they start from the day the decision was computed against, and a trader keeps the progress they made while waiting for the transfer. On a plan where `cadence_gap + settlement lag` is at most the required win-day count, this gate is dominated by the win-day gate and does not bind (EC-049).
Config: `cadence_gap_trading_days`.

## payout cap
The maximum amount payable per request, in bp of account size and materialized to cents. If [withdrawable](#withdrawable) exceeds the cap, the request is clamped to the cap. If the cap exceeds withdrawable, the request is clamped to withdrawable. The cap is stored as a schedule (an ordered list keyed by payout ordinal) so that progressive cap release can be added without a migration; v1 publishes a single flat step.
Config: `payout_cap_schedule`.

## minimum payout
The smallest payable request, fixed at 10000 cents ($100.00) and not scaled by size. A request below the minimum is not eligible. Boundary is `>=` (exactly $100.00 is eligible).
Config: `min_payout_cents`.

## split
The share of a payout that goes to the trader, in bp (90/10 is `9000`). The split is applied at the [ledger](#ledger-entry) level as separate entries, never as a rounded single number, so the firm and trader legs always sum to the gross.
Config: `split_bp`.

## clamp
The deterministic reduction of a requested amount to `min(requested, withdrawable, cap)`. Clamping is performed server-side at request time and recorded in the [eligibility snapshot](#eligibility-snapshot). The trader UI shows the exact clamped amount before submission so the number never changes underneath them.

## eligibility
The conjunction of every [gate](#gate) for an account, evaluated against the [last closed day](#last-closed-day). Eligibility is computed by the pure engine and is server-authoritative; the client never decides it.

## eligibility snapshot
The full gate-by-gate evaluation, input state, plan version, and computed clamp, persisted immutably with a [payout request](#payout-request). It is what makes an approval provable years later and is a required component of the [evidence pack](#evidence-pack).

## payout ladder
The count of settled payouts after which a funded account automatically [graduates](#graduation). It bounds lifetime extraction per account and is the liability architecture's backstop.
Config: **`max_payouts`** ([ADR-030](DECISIONS.md); `ladder.payouts_to_graduate` is the superseded key name). v1 values: **5** on Core EOD and Merit Rapid, **4** on Direct.

## graduation
Automatic closure of a funded account on reaching the ladder count, with status `graduated` and a live-program invitation event. The live program itself is post-launch; v1 records the invitation and closes the simulated account.

## post-payout floor rule
**Retired in v1.** A settled payout reduces the balance and does not touch the [floor](#floor), the high-water balance, or the [floor lock](#floor-lock) ([ADR-014](DECISIONS.md)). The constitution's two configured modes (reset the floor to new balance minus drawdown, or lock at account size plus an amount) are both unused; the config key is retained and pinned to `none` by validation so it cannot be quietly reintroduced. The trader-facing consequence, which must be published in these words: **after a payout your loss room is your [buffer](#buffer)**, or the buffer minus $100 once the floor has locked, not the full drawdown.
Config: `post_payout_floor_rule.mode = "none"`.

---

## Part 5: Money, ledger, and liability

## integer cents
The only representation of money in the system, in storage, computation, and doc examples. Type is `bigint` in Postgres and `bigint` in TypeScript at every boundary. Conversion to a display string happens once, at the presentation layer.

## basis point (bp)
One hundredth of one percent, integer. All ratios, thresholds, shares, and splits are bp.

## ledger entry
An immutable double-entry row. Every financial fact is expressed as balanced debits and credits across [ledger accounts](#ledger-account). Nothing is ever updated or deleted; corrections are new compensating entries.

## ledger account
A node in the chart of accounts. v1 classes: `firm_treasury`, **`trader_wallet`**, `fees_revenue`, `reserve`, `psp_clearing`, `promotional_credit`. The account-type enum is expandable by design.

**`trader_withdrawable` is a superseded name for `trader_wallet`** ([ADR-027](DECISIONS.md)). One class, not two. A reader meeting the old name in an earlier document should resolve it here. `promotional_credit` is activated rather than reserved and is **never withdrawable** ([ADR-019](DECISIONS.md), OQ-FREEZE-01).

## balance
A derived value, always computed by summing [ledger entries](#ledger-entry), never stored as a mutable truth. Cached projections may exist for speed but are rebuildable and are verified against the ledger by the nightly self-audit.

## zero-sum invariant
The binding invariant that the sum of all ledger entry amounts equals zero at all times. It is asserted by a property test in CI and by a runtime check in the nightly batch. A non-zero sum halts payouts and pages.

## open liability
The sum of [withdrawable](#withdrawable) across all funded accounts at a point in time. This is the number on the admin home page, and the one whose absence killed other firms.

## reserve
Funds set aside to cover projected payouts. Held and reported separately from operating funds.

## reserve coverage ratio (RCR)
`reserve / CVaR99 at rho = 0.30`. Below 1.0, the [circuit breaker](#circuit-breaker) pauses new sales. It never pauses payouts. The RCR breaker is one of the three places Merit's conservatism deliberately lives (see [CVaR99](#cvar99)).

## CVaR99
Conditional value at risk at the 99th percentile: the expected payout liability in the worst 1% of modeled outcomes, produced by the simulation harness and refreshed on a schedule.

**CVaR99 evaluated at `rho = 0.30` is the reserve floor, never the estimate** (founder ruling, 2026-08-14, [DECISIONS](DECISIONS.md)). The harness's calibration bands are **central estimates** and carry no built-in cushion. Conservatism lives in three named places instead: the correlation assumption **`rho = 0.30`**, the **regime-stress ruin scenarios**, and the **RCR breaker at 1.0**. Sizing the payout wallet against a central estimate is sizing against a coin flip, and the two numbers are easy to confuse because the same harness emits both under the same name.

## loss ratio
Trailing 30-day payouts divided by fees, per plan. Above 6000 bp (60%), the circuit breaker auto-pauses that plan's new sales and alerts.

## circuit breaker
An automatic control that pauses **new sales** (never payouts) when a liability signal crosses its threshold: RCR below 1.0, or a plan's loss ratio above its limit. Pausing sales is reversible and quiet; pausing payouts would be brand suicide.

## CUSUM
The cumulative-sum control chart used to detect that a plan is being beaten before the funded wave arrives: `S_t = max(0, S_(t-1) + (x_t - mu_0 - 0.5*sigma))`, alarming at 4 to 5 sigma on pass-rate drift per plan.

---

## Part 6: Data pipeline

## fill
An immutable record of an executed trade, ingested from the platform and never edited. Fills are the raw material from which [daily marks](#daily-mark) are computed.

## correction
A vendor-issued restatement of a previously reported fill, arriving as a new row that references the original via `correction_of`. Corrections are applied by [replay](#replay-determinism) going forward. If a correction changes the eligibility of an already-settled payout, Merit **never claws back**: the difference is absorbed, a flag is raised for review, and the trust decision is documented (B4 scenario 5).
Status: the arrival semantics are [provisional pending vendor confirmation](STATE.md).

## daily mark
The per-account, per-trading-day computed record: opening balance, closing balance, intraday high and low, realized P&L, traded-day flag, win-day flag, and a source hash. Marks are the only input the rule engine reads.

## source hash
A digest of the exact input rows that produced a [daily mark](#daily-mark). It makes recomputation verifiable and makes silent upstream changes detectable.

## rule state
The per-account materialized rule position: current floor, buffer progress, consistency statistics, win-day count, payouts taken, last payout day, phase. It is always recomputable from marks; it is stored for speed and verified nightly by [replay](#replay-determinism).

## replay determinism
The binding property that re-running every mark from day one reproduces stored [rule state](#rule-state) byte-identically. It runs as a nightly self-audit job in production, not only in tests. Any divergence halts payout eligibility for the affected account and pages.

## reconciliation
The nightly comparison of Merit's computed EOD balance against the platform's stated EOD balance per account. Any mismatch raises a red alert and excludes the account from payout eligibility until resolved. Reconciliation is the tripwire for both integration bugs and ingest corruption.

## ingest file
A delivered vendor file (report or fills) tracked as a first-class row with filename, digest, receipt time, and status (`received`, `parsed`, `quarantined`, `applied`). Partial or corrupt files are quarantined whole; no partial state is ever committed (B4 scenario 4).

## quarantine
The state of an [ingest file](#ingest-file) that failed validation. Quarantine leaves yesterday's state untouched, commits nothing, and alerts. Recovery is re-delivery or manual repair, then normal processing.

## provisioning
Outbound account lifecycle operations to the platform: creating users and accounts, pushing risk settings (max loss for the [auto-liquidator](#auto-liquidator)), setting market-data [entitlements](#entitlement), and granting platform permissions. Delivered as idempotently named CSV files over SFTP and tracked in a queue with delivery confirmation.

## entitlement
A billable platform permission attached to an account (market data, platform access, API tier). Entitlements cost real money per month, so a nightly hygiene job disables them for closed and expired accounts and alerts if any closed account remains entitled for more than 24 hours.

## platform adapter
The interface (`provision`, `entitle`, `ingestFills`, `ingestEOD`, `reconcile`) that isolates all platform specifics. v1 ships one implementation (Rithmic). A second platform is a new adapter, never a rewrite.

---

## Part 7: Identity, risk, and enforcement

## trader identity
The resolved human behind one or more accounts, and the center entity of the whole data model. Identity owns purchases, accounts, flags, and attributions. **No feature may key on email or account alone when identity exists.**

## entity resolution
The process of merging signals (normalized email, device fingerprint, IP and ASN, payment fingerprint, verified KYC identity) into one [trader identity](#trader-identity). Account caps, aggregate liability, and ring detection are all identity-level, not email-level.

## identity graph
The link structure between identities and their observed signals, with edge types and confidence. Admin can view the graph for any identity; it is the evidence surface for fleet and ring cases.

## device fingerprint
A stable-ish browser or device identifier used as an entity-resolution signal. It is a signal, never a proof, and never the sole basis for enforcement.

## payment fingerprint
A non-reversible hash of card BIN plus last four (plus rail identifiers), used for entity resolution and velocity limits. Merit stores the hash, never a PAN.

## KYC state
The identity verification lifecycle: `kyc_required`, `pending`, `verified`, `rejected`, `expired`. Funded trading (or purchase, per placement config) is blocked until `verified`. Merit stores status, provider applicant reference, and match signals only. **Documents and biometrics never touch Merit storage.**

## KYC placement
The configurable point at which verification is required: `pre_eval` (at purchase) or `pre_funded` (at eval pass). Beta launches `pre_funded`; Direct plans always verify at purchase because funding is immediate. It is config, never a hardcode, so the decision can change without a rewrite.

**Superseded by the ruled trigger set** ([ADR-021](DECISIONS.md), [ADR-030](DECISIONS.md)). Placement is no longer a single point: the config key is **`kyc.triggers`, an array**, and verification fires at whichever configured trigger is reached **first**. The v1 set ruled at FREEZE is **`{second_distinct_account_purchase, pre_funded}`**. Direct plans always verify at purchase, which is not configurable. `payout_request` is invalid as a sole trigger.

## biometric dedupe
The KYC provider's face match across all applicants, which surfaces one-person-many-names fleets before any liability exists. It catches what device fingerprints miss and feeds the [identity graph](#identity-graph).

## risk flag
A detection result with type, severity, evidence JSON, status, and source. Flags are queued for human decision; the system never auto-enforces on a flag. The `source` field accepts `internal` or a vendor name so a third-party risk network can be added later as another detector.

## detection-time enforcement
Merit's binding enforcement doctrine: abuse is handled when it is **detected** (restriction or closure per ToS, with an evidence pack), never by denying a payout at request time. Approval is mechanical and instant; consequences attach to accounts, not to individual payment requests.

## payouts frozen
An account-level flag set **before** request time by an active investigation. A frozen account shows its review status in the UI. Freezing is rare, evidence-backed, and ToS-cited. It is not a denial mechanism; it is a pause on an account already under documented investigation.

## evidence pack
A one-click export for an account containing trades, timestamps, marks, rule states per day, the plan version and its rule text, computation traces, flags, and admin actions. It is court-grade and is a **launch requirement**, because adversaries publicly contest enforcement and the firm that cannot show its work loses the argument regardless of being right.

---

## Part 8: Commerce and integrations

## PSP
Payment service provider. Merit runs two high-risk merchant accounts behind one abstraction with health-checked failover.

## MID
Merchant account identifier at a PSP. MID health (decline rates, chargeback ratio) is monitored; a chargeback ratio above 65 bp (0.65%) threatens the processor relationship.

## chargeback
A card dispute. Policy: instant account closure, flag on the identity, and a compensating ledger reversal. The policy is in the ToS and is enforced automatically on webhook receipt.

## coupon
A discount code with type, value, expiry, redemption limits, and optional affiliate linkage. Codes are single-use-safe: redemption is an atomic claim, so two tabs cannot both win (B4 scenario 11).

## affiliate
A referral partner with codes, attribution, and statements. Attribution is last-touch with a 30-day cookie, overridden by an explicit code at checkout. Self-purchase through one's own code voids attribution and raises a flag.

## Rise
The settlement provider for trader payouts and affiliate payments. Merit sends idempotent transfer requests and consumes signed settlement webhooks. **The Rise payout identity must match the KYC-verified identity**; a mismatch freezes and flags rather than settling silently.

## geo-block
Enforcement of the restricted-jurisdiction list at checkout, with a login-time warning. The list is data, versioned, and pending counsel.

---

## Part 9: Engineering vocabulary

## idempotency key
A caller-supplied unique key on every mutating endpoint and every outbound money operation, making retries safe. Duplicate delivery produces one effect and returns the original result. Keys survive restore from backup (B4 scenario 19).

## saga
A multi-step process with compensation on failure (order, payment, provisioning, welcome). "Paid but not provisioned" alerts within five minutes and auto-retries.

## golden file
A hand-built scenario fixture (YAML input, expected end-state JSON) derived from **plan docs and approved scenarios, never from implementation output**. Golden files are the specification made executable and are what protect against the self-grading trap.

## replay self-audit
The production job that re-derives rule state from marks nightly and compares against stored state. See [replay determinism](#replay-determinism).

## dead-man switch
An alert that fires when a scheduled job does **not** run. Every cron has one, because silent non-execution is the failure mode that hurts most.

## evidence doctrine
No completion claim without evidence: the test output, the command and its return, or a screenshot. Enforced structurally by a Stop hook and culturally by review.

## TPAP
Third Party Access Provider: the CME designation under which a firm provides market access to traders through a clearing relationship. Merit operates as a futures-only SIM/B-book evaluation firm under this arrangement.

## SIM (simulated) and B-book
All Merit trading, including the funded phase, occurs in a simulated environment; the firm takes the other side internally rather than routing trader orders to the exchange. This is disclosed everywhere it matters: footer, checkout, ToS, and certificates.
