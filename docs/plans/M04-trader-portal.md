---
status: approved
depends_on: [../../MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, ../architecture/API_CONTRACT.md, ../architecture/EVENTS.md, ../architecture/SECURITY.md, ../architecture/data-model/README.md, ../design/DESIGN_SYSTEM.md, ../decisions/README.md, ../edge-cases/README.md, ../testing/GOLDEN_SCENARIOS.md, M01-rules-engine.md, M03-billing-checkout.md]
last_updated: 2026-08-14
---

# M4: Trader Portal

Constitution section M4, Appendix D2 and D5, Appendix E (the Lovable and Base44 lessons), Appendix F (the anti-AI-tell standard), Appendix B5 ten-section template.

The portal is where Merit's product promise either lands or does not. Everything the rules engine computes correctly is worthless if the trader cannot see why, and every competitor complaint theme in [TOP10_FIRMS](../../research/TOP10_FIRMS.md) is ultimately about a trader not being able to see the rule that decided their outcome. This module has one job: **render exactly what the engine computed, never recompute it, and never round it.**

**Amended and approved at the Wave 3 batch 1 gate (2026-08-14).** Two rulings changed this module materially: **[ADR-019](../decisions/ADR-019.md)'s Merit Wallet adds a tenth screen** (SC-M4-10, section 3.5), and **[ADR-020](../decisions/ADR-020.md)'s indicative realtime layer supersedes this plan's "polling, not websockets, in v1" position** (section 3.6) and adds two invariants about labeling. The module's governing sentence is unchanged and now carries more weight, not less: render exactly what the engine computed, never recompute it, never round it, **and never let a live number look like a decided one.**

**Identifier conventions:** `INV-M4-nn` invariants, `SD-M4-nn` schema deltas, `SC-M4-nn` screens, `FM-M4-nn` failure modes, `AS-M4-nn` adversarial scenarios, `OQ-M4-nn` open questions, `DEP-M4-nn` dependencies.

---

## 1. Purpose and invariants

### 1.1 What this module is

`apps/portal`, a Next.js App Router application, mobile first, consuming `/api/v1` and nothing else. Passwordless auth (passkeys plus OTP). **Ten** screens, listed in section 3.1.

### 1.2 What this module is not

| Not M4 | Whose job | Why the boundary is here |
|---|---|---|
| Computing any rule, gate, threshold, or payable amount | [M1](M01-rules-engine.md) through the API | Appendix E's Enrichlead lesson: business rules enforced in the UI are business rules that do not exist. The portal has **no arithmetic on money** beyond formatting cents to a string |
| Deciding what a trader may see | API, `scopedDb(identity)` | Authorization is server side. The portal not rendering a link is a convenience, never a control |
| Storing anything durable | API | No client-side cache of a money number survives a navigation. See INV-M4-04 |
| Knowing a plan's rules | `plan_versions.copy_blocks` | The rules page renders the account's **pinned** version. There is no rules content in this repo's UI code at all |
| Taking payment | [M3](M03-billing-checkout.md) | The portal links into checkout; the PSP session belongs to M3 |

### 1.3 Invariants

| ID | Invariant | Enforcement |
|---|---|---|
| INV-M4-01 | No money value displayed anywhere is computed client side | Lint rule banning arithmetic operators on any field whose name ends `_cents` or `_bp`; a formatting helper is the only permitted consumer. Review-blocking |
| INV-M4-02 | Every screen showing account state labels the [last closed day](../GLOSSARY.md#last-closed-day) it is as of | `as_of_trading_day` is a required prop on every account-state component. A component that renders a balance without it does not compile ([ADR-002](../decisions/ADR-002.md)'s T+1 posture) |
| INV-M4-03 | The payout request button is enabled **only** when the server said `eligible: true`, and the amount shown is the server's `max_payout_cents` | No client-side gate evaluation exists. The button's disabled state carries the failing gate's own text |
| INV-M4-04 | A payout confirmation re-fetches eligibility immediately before submit, and shows the number it will actually send | AS-M4-02. The number on the confirm screen and the number in the request body are the same variable |
| INV-M4-05 | A gate reported `skipped: true` renders as **disabled**, never as satisfied | EC-050. A green check on a gate that was never evaluated is a lie the trader will eventually catch |
| INV-M4-06 | No response body is trusted for authorization; the portal never receives another identity's data to filter client side | `scopedDb(identity)` server side (D2), plus the negative-authz matrix in [API_CONTRACT section 12](../architecture/API_CONTRACT.md) as CI merge blockers |
| INV-M4-07 | Cross-trader resource access returns `404`, and the portal renders it as "not found", not "forbidden" | Confirmed at the [Wave 2 gate](../decisions/README.md). Existence is not confirmed to a stranger, and the UI must not undo that by wording |
| INV-M4-08 | Every rule sentence on any screen comes from `copy_blocks` on the account's pinned plan version | No rule text is authored in the portal. This is the mechanism behind constitution 0.4's "marketing must equal implementation to the tick" |
| INV-M4-09 | The simulated-environment disclosure appears in the footer, at checkout entry, on certificates, and on the funded dashboard | Constitution section 6, and it is a compliance obligation rather than a design preference |
| INV-M4-10 | No screen in this module is reachable without an authenticated session except the public certificate verification page | Middleware, plus the negative-authz suite asserting 401 on every route unauthenticated |
| INV-M4-11 | Every value sourced from the indicative layer is rendered with an **indicative** label, in the same component, at the point of use | [ADR-020](../decisions/ADR-020.md). Enforced the same way INV-M4-02 enforces `as_of_trading_day`: an indicative component takes a required `tier` prop and a component that renders a live value without it does not compile. A label in a page footer is not a label on a number |
| INV-M4-12 | On feed loss, a live surface falls back to last-closed values **and changes its label in the same render** | The failure this prevents is a live number that silently freezes, which is indistinguishable from a quiet market and is therefore worse than an honest stale number. GS-133 |
| INV-M4-13 | No indicative value is ever an input to a request the portal sends | The payout confirm flow reads eligibility from the authoritative endpoint only, even when a live floor distance is on screen beside it. [ADR-020](../decisions/ADR-020.md)'s hard rule, applied at the one place in the portal where a number becomes a money decision |

---

## 2. Entities and schema deltas

M4 owns no table outright. Three deltas, one of which closes a real gap in the approved model.

| ID | Table | Change | Why it is not optional |
|---|---|---|---|
| SD-M4-01 | new `certificates` | `id`, `account_id`, `identity_id`, `kind check in ('pass','payout')`, `payout_request_id null`, `claims jsonb`, `signature bytea`, `signing_key_id`, `issued_at`, `revoked_at null`, `revoked_reason null` | [API_CONTRACT section 6](../architecture/API_CONTRACT.md) returns a `certificate_id` and a `verify_url`, and the approved DATA_MODEL has no table behind either. Without a row there is nothing to verify against, and a "verifiable" share card that verifies nothing is worse than no card at all (AS-M4-03) |
| SD-M4-02 | `purchases` | add `rule_diff_acknowledged_at timestamptz null` | [M3](M03-billing-checkout.md)'s AS-M3-05 requires a reset onto a changed plan version to be explicitly acknowledged. M4 renders the diff and captures the acknowledgement, and the timestamp is the artifact that settles the dispute later |
| SD-M4-03 | `sessions` | add `created_ip inet`, `created_user_agent text`, `last_seen_at timestamptz`, `last_seen_ip inet` | Account takeover leading to payout redirection is the highest-value attack on a trader account ([SECURITY section 2.6](../architecture/SECURITY.md)). The trader-visible active-sessions list, and the ability to revoke one, both need this, and so does the anomaly signal that a session moved country mid-life (AS-M4-05) |

---

## 3. Screens and state machines

### 3.1 The ten screens

| ID | Screen | The one thing it must get right |
|---|---|---|
| SC-M4-01 | Auth (passkey, OTP fallback) | No password field exists anywhere. There is no password database to stuff (D2) |
| SC-M4-02 | Account list | Floor distance, because it is the number traders actually watch, and it is the number that decides whether they trade tomorrow |
| SC-M4-03 | Account detail and equity chart | Every gate, gate by gate, with numbers. Never a single progress bar |
| SC-M4-04 | Payout center | The exact clamped amount, before submit, matching what will be sent (INV-M4-04) |
| SC-M4-05 | Rules page, per account | Rendered from the account's pinned `copy_blocks`. The whole rule, with its operator |
| SC-M4-06 | Purchase and reset | The rule diff when versions differ (SD-M4-02) |
| SC-M4-07 | KYC status | Four honest states, and what to do in each |
| SC-M4-08 | Certificates | Signed, verifiable, disclosure-bearing |
| SC-M4-09 | Referral panel | [M8](M08-affiliate-system.md)'s trader-facing surface, with the required NFA I-26-12 disclosure |
| SC-M4-10 | **Merit Wallet** | The balance, its two directions, and the honest statement of what a wallet balance is: money already earned and already yours, held by Merit until you withdraw it. Section 3.5 |

### 3.2 The payout request flow, which is the one that has to be perfect

```mermaid
stateDiagram-v2
    [*] --> ineligible: gates render, failing gate explained with its number
    ineligible --> eligible: a gate flips on a later day.closed
    eligible --> confirming: trader taps Request
    confirming --> confirming: re-fetch eligibility, show the amount that will be sent
    confirming --> ineligible: gates moved between render and confirm (AS-M4-02)
    confirming --> submitted: POST with idempotency key and the displayed amount
    submitted --> approved: 200, instant
    submitted --> ineligible: 422 payout_not_eligible, with the full gates object
    approved --> settled: payout.settled arrives, 2 to 3 business days
    approved --> failed: transfer failed, honest note, retry visible
```

**Two design rules that come out of this machine and are binding.**

`confirming` re-fetches. It does not trust the number that was on screen when the trader tapped. Between a dashboard render and a tap, a nightly batch can close a day and move a gate, and the difference between "the amount changed underneath me" and "we showed you the change before you confirmed" is the entire difference in how that gets described publicly (AS-M4-02).

**A 422 is never worded as a rejection.** The zero-denial policy means a request that has not cleared its gates is not a denial, and the copy has to carry that distinction: "not yet, here is exactly what is left" rather than "declined". This is a copy rule with a real consequence, since the word "declined" in a screenshot is what a review page is built from.

### 3.3 The consistency meter, always visible

Ruled at the M1 gate (OQ-9): the consistency meter and `profit_needed_to_dilute_cents` are shown **at all times**, not only when the gate fails. The reason is [AS-13](M01-rules-engine.md): eligibility is not monotone in profit, so a trader can make money and become less eligible, and the only defence against that reading as a moved goalpost is that the shape of the rule was visible before it bit.

The meter shows three numbers, always: best day, period profit, and the resulting share in bp against the limit. When the share is under the limit it also shows the headroom. When it is over, it shows `profit_needed_to_dilute_cents` as an amount, not a percentage, because a trader can act on an amount.

### 3.4 The three OQ-2 placements

Ruled at the M1 gate: the funded phase starts at the account size and eval profit is not carried (R-31). This must appear in plain language in three places, and this module owns two of them.

1. **The rules page** (SC-M4-05), in the eval section, as its own sentence rather than a footnote.
2. **The eval progress card** (SC-M4-03), where the profit-target progress is shown, because that is the exact moment a trader is forming the belief that the number they are watching is money they will keep.
3. The pass email, owned by [M10](M10-integrations.md).

The wording is a `copy_blocks` entry, not portal source, so it ships with the plan version it describes.

### 3.5 The wallet screen (ADR-019)

The wallet is where the trader's money sits between earning it and withdrawing it, so the screen's job is to make a genuinely new concept feel like the obvious one. Three elements, and the copy on the first is what decides whether traders trust the feature at all.

**The balance, framed as a payable balance.** The screen says, in plain words, that this is money the trader has already earned and that Merit holds until they move it. It is **not** an account, it earns **no interest**, and it cannot be sent to another trader. Those three negatives are stated affirmatively on the screen rather than buried in the ToS, because a wallet that looks like a bank account will be treated as one, and every misunderstanding lands on support at the worst possible moment. The wording is a `copy_blocks` entry (INV-M4-08) and a counsel-review item (see [legal/](../legal/README.md)).

**Two directions, deliberately asymmetric.** Money in is instant and needs no explanation. Money out has two exits and the screen shows both: **spend** on an evaluation or a reset, which is instant and internal ([M03](M03-billing-checkout.md) section 3.4), and **withdraw** to a bank destination, which carries KYC, the 48 hour destination-cooling window, a $100 minimum, and 2 to 3 business days. **No withdrawal fee**, stated on the screen rather than merely absent, because "no fee" is a claim competitors cannot make and an absence nobody notices.

**The timeline.** Every credit and debit with its cause, because the wallet is a ledger view and a ledger view that does not reconcile to the trader's own memory is the fastest way to lose the trust the wallet was built to earn.

**One thing the screen must not do.** It must not present the wallet balance as a score, a streak, or a level. That is [ADR-019a](../decisions/ADR-019.md)'s bright line arriving in the one place it is most tempting to cross: a balance is money, gamifying money is what the line exists to prevent, and the fact that it is Merit's own ledger rather than a bank makes it more important to treat seriously, not less.

### 3.6 The indicative layer on the dashboard (ADR-020)

[ADR-020](../decisions/ADR-020.md) puts live numbers on the trader dashboard for the first time: **live P&L, projected floor distance, and live win-day and consistency tracking**. This is the largest product change in the module and it is also the easiest place in the entire corpus to accidentally break the thing Merit sells.

**The rule the screens are designed around: a live number and a decided number never look alike.** Not a different tooltip, not a different footnote, a different visual treatment at the point of use (INV-M4-11), with the two never adjacent in a way that invites comparison without context. The trader must be able to answer "is this the number the rules used" without reading anything.

| Element | Tier | What it says |
|---|---|---|
| Live P&L, projected floor distance | indicative | "live, as of a moment ago" |
| Live win-day and consistency tracking | indicative | "on track / not on track today", never "you have 3 win days" |
| Balance, floor, win days, consistency, eligibility | authoritative | "as of last closed session" (INV-M4-02, unchanged) |
| Everything in the payout center | authoritative, always | INV-M4-13 |

**Projected floor distance is the feature and it is also the hazard**, so it gets its own rule. It is the single most useful number Merit can give a funded trader and the single most dangerous to get wrong, because a trader who reads it as authoritative and stops trading one tick early has lost nothing, while one who reads it as authoritative and keeps trading has lost an account. The copy therefore states the projection **and** the enforcement in the same breath: the number is indicative, and the thing that actually stops them intraday is the platform's auto-liquidator sitting at the floor ([DECISIONS](../decisions/README.md), the Wave 2 setpoint ruling), not this display.

**On feed loss the dashboard degrades rather than freezes** (INV-M4-12): live elements fall back to last-closed values with their labels changed in the same render. A frozen live number is the failure mode, because it looks exactly like a market that stopped moving.

**Nothing here touches the payout center.** The confirm flow re-fetches authoritative eligibility exactly as section 3.2 already specifies, and no indicative value enters the request body (INV-M4-13). The socket could be entirely down and the payout path would be unaffected, which is the property that makes shipping tier 2 safe at all.

---

## 4. API endpoints consumed

M4 owns no endpoint. It consumes [API_CONTRACT sections 3, 5, 6, and 7](../architecture/API_CONTRACT.md) verbatim, and adds no field to any of them. What this plan records is the **one obligation per endpoint** that is easy to get wrong.

| Endpoint | Obligation |
|---|---|
| `GET /accounts` | Render `as_of_trading_day` on the card itself, not in a tooltip (INV-M4-02) |
| `GET /accounts/:id` | `progress` is a projection to display, never an input to a client-side decision. `next_eligible_trading_day` renders as a **date**, because a count of trading days is a rule a trader cannot evaluate (EC-046) |
| `GET /accounts/:id/eligibility` | Every gate rendered, including passing ones, including skipped ones as disabled (INV-M4-05). This endpoint is cheap by design and is called on every dashboard render |
| `POST /accounts/:id/payout` | Idempotency key generated once per confirm session, not per tap. A double tap must produce one payout, and the second response must be the first's result |
| `GET /accounts/:id/marks` | The equity chart. A day carrying `corrected: true` is visibly marked, because a chart that silently changes shape is how trust in the data goes |
| `GET /accounts/:id/timeline` | Trader-safe subset only. The portal never receives detector internals or other identities' ids, so it cannot leak them (INV-M4-06) |
| `GET /accounts/:id/certificate` | See AS-M4-03 |
| `GET /plans/:id/versions/:v` | The rules page for an account reads the **pinned** version, not the current one |
| `POST /kyc/session`, `GET /kyc/status` | Four states, four different pieces of advice. `rejected` is the hard one and gets a support route, never a dead end |

---

## 5. Events emitted and consumed

M4 emits no domain events. It **consumes** them for live UI, and it is the surface where several of them become a human experience.

| Event | What the portal does with it |
|---|---|
| `day.closed` | Refresh the account card. The one moment per day where every number changes at once |
| `phase.passed` | The pass celebration, which must state the funded reset in the same view (section 3.4) |
| `phase.pass_deferred_consistency` | The single most important explanatory moment in the eval. The card explains dilution with the actual number needed |
| `breach.detected` | An honest, non-euphemistic account state, with the floor, the low, and the shortfall, and a link to the reset flow with no dark pattern in it |
| `payout.approved`, `payout.settled`, `payout.transfer_failed` | The status timeline. `transfer_failed` gets a truthful note and a visible retry, because silence here is what payout-trust collapse is made of |
| `rule.floor_locked` | A timeline entry explaining that the floor is now permanent, and what the loss room is from here ([ADR-014](../decisions/ADR-014.md)) |
| `kyc.*` | The status card |
| `account.graduated` | The ladder completion, with the live-invitation state |

**Delivery of domain events is via polling, not websockets.** These events are T+1 by construction; a socket to deliver a number that changes once a day is infrastructure with no purchaser. Polling on focus plus a 60 second interval on the dashboard is sufficient.

**This plan's original conclusion, that v1 ships no websocket at all, is superseded by [ADR-020](../decisions/ADR-020.md).** A socket now exists, and the distinction that makes both statements true is worth keeping: **the socket carries indicative market data, never domain events.** A `day.closed` is still delivered by polling, because it happens once and the portal can wait a minute for it. A live floor distance is delivered by socket, because it changes continuously and is the number a funded trader watches all session. The two never share a channel, which also means a socket outage cannot delay a domain event.

---

## 6. Failure modes

| ID | Failure | Blast radius | Detection | Recovery |
|---|---|---|---|---|
| FM-M4-01 | A displayed number disagrees with the engine | The whole product promise. One screenshot of a mismatch is worth more to an adversary than any exploit | INV-M4-01's lint rule; a contract test asserting every displayed field maps to exactly one API field | Structural: the portal has no arithmetic to be wrong |
| FM-M4-02 | Stale eligibility, request submitted against a moved gate | Trader believes the firm changed the number underneath them | Re-fetch at confirm (INV-M4-04); the server re-evaluates regardless | 422 with the full gates object; the UI explains the change rather than reporting a failure (AS-M4-02) |
| FM-M4-03 | IDOR: one trader reads another's account | **Firm-ending.** This is the single most common vibe-code fatality (Appendix E, Lovable and Base44) | `scopedDb(identity)` plus a named negative-authz test per endpoint per resource, as CI merge blockers | Structural. The portal is not the control and must never be described as one |
| FM-M4-04 | Session hijack leading to payout destination change | Money to an attacker, and the account's own trader disputes it | 48 hour cooling plus re-verification on destination change (D4); session anomaly on country change (SD-M4-03) | Destination changes are not instant, which is the only control that survives a valid session (AS-M4-05) |
| FM-M4-05 | The portal renders a rule from its own source rather than `copy_blocks` | Marketing and implementation diverge, silently, exactly as constitution 0.4 forbids | A build-time check that no rule-shaped string literal exists in portal source | Move the sentence into `copy_blocks` on the plan version, where it ships with the rules it describes |
| FM-M4-06 | A certificate is shared that the firm cannot verify | The transparency moat inverts: forged proof of payouts damages the thing it imitates | Signature plus a public verification page backed by SD-M4-01 | Verify page is authoritative; an unverifiable card is reported as unverifiable, never as false (AS-M4-03) |
| FM-M4-07 | Notification says eligible, the portal says not | The highest-volume support wave available | Notifications carry `as_of_trading_day`; the portal is authoritative | The email states the day it was true on. See AS-M4-06 |
| FM-M4-08 | Mobile layout hides the failing gate below the fold | Traders conclude the rule is arbitrary because they never saw it | Mobile-first design, plus a visual test asserting the failing gate is above the fold at 375px | Layout fix; this is a correctness bug, not a polish item |
| FM-M4-09 | The portal ships a visual AI tell | A skeptical trader reads "another AI-generated prop firm", which for a firm holding payouts is a trust wound | Appendix F's hard-fail checklist as a review gate, plus a Playwright slop-score pass | Reject in review. Appendix F is binding, not advisory |

---

## 7. Adversarial scenarios

**Six listed, five novel.** The one marked "extends" takes Appendix D4 somewhere specific to this surface.

### AS-M4-01: The portal as the ring's calculator (NOVEL)

**Attack.** Merit's differentiator is showing the whole rule, including `profit_needed_to_dilute_cents`, continuously (OQ-9's ruling). For an honest trader that is the difference between a rule and a mystery. For the hedged-pair ring in [M01 AS-02](M01-rules-engine.md), it is a **free, authoritative, real-time API for the exact amount of manufactured profit needed to unlock a capped extraction.** The ring does not have to model our consistency rule; we compute it for them, per account, every day.

**Numbers.** [M01 AS-02](M01-rules-engine.md) prices the manufactured-dilution attack at roughly 2,000c of spread and commission to unlock a 150,000c cap, and the hard part is knowing exactly how much to manufacture. The portal removes the hard part and removes the overshoot, which is the difference between a ring paying for three sloppy dilution days and paying for the minimum.

**Counter, and the honest answer is that we accept it.** Hiding the number does not stop a ring: they can derive it from the published rule with a spreadsheet, since the rule and every parameter are public by design (constitution 0.4). Hiding it only stops the honest trader who does not build spreadsheets, which is the majority. So the number stays visible, and the counter moves to where it belongs: the engine already publishes `profit_needed_to_dilute_cents` into `engine_gates`, which makes M7's detector arithmetic rather than inference. **A cluster of small positive days appearing on an account precisely while consistency is its only failing gate, with an inverse-correlated sibling, is the signature**, and it is only cheap to detect because the same number is stored. Transparency raises the ring's efficiency and simultaneously hands us the detector. GS-100.

### AS-M4-02: The number that changed between the tap and the send (NOVEL)

**Attack.** Not an attacker. The nightly batch. A trader opens the dashboard at 23:58 showing `max_payout_cents` of 150,000, the batch closes a new day at 00:05 with a losing session, and the trader taps Request at 00:07. Naively the request sends 150,000, the server clamps to 90,000, and the trader receives an amount they never agreed to. The support conversation is unwinnable because from the trader's side the firm quietly reduced a number after they committed.

**Why it nearly works.** Every component is correct. The dashboard was accurate when rendered. The server clamp is correct and is exactly what [ADR-009](../decisions/ADR-009.md) specifies. The failure is entirely in the seam.

**Counter.** The `confirming` state (section 3.2) re-fetches eligibility and shows the amount that will actually be sent, and the request body carries that same variable. When the number moved, the confirm screen says so explicitly and requires a fresh confirmation. And because [ADR-009](../decisions/ADR-009.md) made `amount_cents` optional, the safest client behavior is to **send the amount it displayed** rather than omitting the field, so that the server's clamp can only ever reduce it and the trader's screenshot and their payout agree. GS-101.

### AS-M4-03: The forged payout certificate (NOVEL)

**Attack.** Certificates are cheap virality and every competitor has them, which means adversaries already know the format. A forged card claiming a $1,500 Merit payout that never happened is trivially made in an image editor. Two directions of damage, and the second is worse. Outward: a scam account uses fake Merit payout proof to sell a signal service, and the reputational cost lands on Merit. Inward: a trader forges a card, Merit disputes it, and the argument is Merit's word against an image, which is exactly the position [M12](M12-transparency-platform.md)'s whole trust strategy exists to avoid.

**Counter.** The card is a rendering; the **certificate is the row** (SD-M4-01). Every card carries a short verification code resolving to a public page that states, from the signed row, what Merit actually issued: plan, size, trading day, and amount for a payout card. Three design rules make it work.
1. **The verification page is the authority and the image is not.** An unverifiable code returns "no certificate with this code", never "this is fake", because the honest claim is the defensible one.
2. **Revocation exists** (`revoked_at`). A certificate on an account later closed for chargeback or enforcement is revoked with a reason, and the verify page says so. Without revocation the firm's own proof outlives the fact it proved.
3. Claims are minimal by construction: no identity, no email, no cumulative totals. A certificate is a fact about an account on a day, and the smaller the claim, the less there is to forge usefully.

GS-102.

### AS-M4-04: The breach screen as a dark-pattern surface (NOVEL)

**Attack.** The moment of maximum vulnerability in the entire product is the breach screen. A trader has just lost an account, is emotional, and a reset purchase is one tap away. Every dark pattern in the funnel playbook works better here than anywhere else: a countdown discount, a pre-checked upgrade, an obscured floor number, a "you were so close" framing. The revenue is immediate and measurable, and the cost is invisible for months and then arrives all at once as a Trustpilot theme.

**Why it belongs in an adversarial list.** The adversary is Merit's own future incentive under revenue pressure. Constitution M4 says "zero dark patterns" and Appendix F's copy rules say the rest, but a documented rule with no test is a rule that erodes.

**Counter, made structural.** The breach screen shows the arithmetic first: the floor, the day's low, the shortfall in cents, and which rule (`breach_kind`), rendered from the event payload. The reset offer is present, honestly priced, below the explanation, with **no countdown, no pre-selection, and no comparative framing**. This is enforced as a review checklist item with a named test asserting the breach detail is above the reset call to action at every breakpoint, because the ordering is the control. GS-103.

### AS-M4-05: Account takeover for payout redirection (extends Appendix D4)

**Attack.** D4 names the classic vector. Its portal-specific shape is sharper than the generic case because of two Merit properties: payouts are **instant and mechanical** with no human in the loop, and a funded account's `withdrawable` is publicly visible on the dashboard, so an attacker with any session can see immediately whether the account is worth taking. Passwordless auth removes credential stuffing (there is no password database to stuff) but does not remove session theft, OTP interception, or a passkey registered on a device the attacker controls.

**Counter, layered, because no single one survives a valid session.**
1. **Payout destination changes trigger a 48 hour cooling window plus re-verification** (D4). The attacker's session is valid and the change still does not take effect today, which converts an instant theft into a detectable one.
2. **The trader sees every active session** with its creation IP, user agent, and last-seen time, and can revoke any of them (SD-M4-03). This is the control that lets the victim act before the firm notices.
3. **Passkey registration is itself a notified event**, because a new authenticator on the account is the quietest possible takeover step.
4. A session whose country changes mid-life is a signal to [M7](M07-risk-abuse.md), not a block, since traders travel and blocking on geography would generate more harm than it prevents.

GS-104.

### AS-M4-06: The eligibility notification that is already stale (NOVEL)

**Attack.** Not an attacker. Physics. A "you are now eligible" notification is generated from a `day.closed` event. The trader reads it the next evening, after another day has closed, and the account is no longer eligible because a losing day moved the buffer or a new best day broke consistency ([AS-13](M01-rules-engine.md)). The trader experiences a firm that invited them to request money and then said no. This is the highest-volume support wave available to us, and it is entirely self-inflicted.

**Counter.** Three things, all cheap.
1. **Every notification carries the trading day it was true on**, in the body, not in metadata: "as of Thursday 12 November". The claim is then permanently true and the trader can reconcile it themselves.
2. **The eligibility notification links to the eligibility screen, never to a request action.** A notification that deep-links to a Request button is a notification that promises an outcome.
3. **A losing-day notification is not sent**, but the eligibility screen always shows the current state, so the asymmetry is one of push rather than of truth. Notifying a trader that they became ineligible is technically transparent and practically cruel, and the state is one tap away for anyone who wants it.

GS-105.

---

## 7.9 Verification UX in the portal

[M19 section 7.9](M19-kyc-identity.md) carries the full specification; what M04 owns is the rendering, and three of its requirements are portal surfaces rather than copy decisions.

| Surface | Requirement |
|---|---|
| **The trigger moment** | **One** contextual prompt, leading with the achievement: "**You passed. One quick step to activate your funded account, about 2 minutes.**" Never a modal that blocks the dashboard |
| **The persistent card** | After the prompt, a dashboard card that waits. **Repeated prompting reads as accusation regardless of wording**, so the card is the only reminder |
| **Save and resume** | A trader who abandons mid-flow returns to exactly where they were. This is the single highest-value item in the whole spec, because abandonment is the dominant failure and a lost place is why people do not come back. GS-206 |
| **Embedded provider flow** | Rendered in place, never a redirect to an unfamiliar domain, which reads as phishing to exactly the security-conscious trader Merit wants |
| **The Verified badge** | Permanent and visible. A status the trader keeps, not a gate they passed and cannot confirm |
| **Failure** | Routes to a human. **The words "decisions are final" may not appear in any string this module renders** |

**The vocabulary rule is binding on this module's copy and is testable:** no trader-facing verification string contains "fraud", "suspicious", "risk", "flagged", or "review". Those words are internal-tier. A lint over the portal's string catalogue is the cheapest possible enforcement and it belongs in CI alongside the Appendix F em-dash check.

## 8. Test plan

### 8.1 Suites

| Suite | Prefix | Count | Runs | Blocks |
|---|---|---|---|---|
| Component render contracts (every field maps to one API field) | `M4-R-nn` | 22 | every commit | merge |
| Negative authz, D5 matrix | `M4-N-nn` | 14, one per endpoint per resource | every commit | merge |
| E2E happy path (buy, pass, request, settle) | `M4-E-nn` | 1 plus the 10 highest-value unhappy paths | every commit | merge |
| Visual and layout, 375px and 1280px | `M4-V-nn` | 9, one per screen | every commit | merge |
| Appendix F slop score | `M4-F-01` | 1 | every commit | merge |
| Golden fixtures | `GS-nnn` | 6 owned (GS-100 to GS-105) | every commit | merge |

**`M4-F-01` deserves a sentence** because a lint rule for design taste sounds unserious and is not. It is a Playwright pass asserting the absence of the specific, enumerable tells in Appendix F: an indigo-to-purple gradient, a 3 to 4px colored left border on a card, Inter or Poppins as the body face, a centered hero with a pill badge above the H1, and uniform 16px radius across every surface. These are mechanically detectable, and the constitution classes each as a hard fail, so they are a test rather than an opinion.

### 8.2 Named scenarios owned by this module

| ID | Scenario | Pins |
|---|---|---|
| GS-100 | Consistency meter and dilution amount render on a passing account | Both are visible when the gate passes, not only when it fails. The OQ-9 ruling, and the reason AS-13 does not read as a moved goalpost. AS-M4-01 |
| GS-101 | Eligibility moves between dashboard render and confirm | The confirm step re-fetches, states that the amount changed, and requires fresh confirmation. The request body carries the displayed amount so the server clamp can only reduce it. AS-M4-02 |
| GS-102 | Certificate verification: valid, unknown, and revoked | Valid resolves to the signed claims; unknown returns "no certificate with this code" and never "fake"; revoked states the revocation. AS-M4-03 |
| GS-103 | Breach screen ordering at every breakpoint | Floor, low, shortfall, and rule name appear above the reset call to action at 375px and 1280px, with no countdown and no pre-selected option. AS-M4-04 |
| GS-104 | Payout destination change enters a 48 hour cooling window | The change is accepted, does not take effect, is notified to the existing contact, and is visible in the active-session and security views. AS-M4-05 |
| GS-105 | Eligibility notification names its trading day and links to the gates screen | The notification body carries "as of <trading day>" and deep-links to eligibility rather than to a request action. AS-M4-06 |

### 8.3 Coverage rule

**Every screen has a negative-authz test and a mobile layout test, and no screen merges without both.** Appendix E's finding is that AI-written frontends fail on access control and trust boundaries rather than on syntax, so the two suites that matter most here are the two that are least fun to write.

---

## 9. Observability

### 9.1 Metrics

| Metric | Why it matters |
|---|---|
| `portal.eligibility_views` versus `payout_requests` | The gap is the funnel between knowing you can and doing it. A widening gap means the request flow has friction we did not intend |
| `portal.gate_view_distribution` by failing gate | Which gate traders are actually staring at, which is the leading indicator of the next support theme and pairs with M1's `engine.gate_failure_distribution` |
| `portal.confirm_amount_changed_rate` | AS-M4-02 firing in the wild. Should be small; a spike means batch timing and trader behavior overlap more than modelled |
| `portal.404_on_owned_resource` | A trader hitting 404 on something that is theirs is an authorization bug wearing a not-found costume |
| `portal.session_country_change` | AS-M4-05 signal, routed to M7 |
| `portal.certificate_verify_lookups`, and the unknown-code rate | A rising unknown-code rate means forged cards are circulating (AS-M4-03) |
| `portal.p95_dashboard_ttfb` | Constitution 5.7's only portal-relevant budget |
| `portal.mobile_share` | Decides where layout effort goes, and constitution M4 says mobile first |

### 9.2 Alerts

| Alert | Threshold | Severity |
|---|---|---|
| Any negative-authz test failing in CI | any | merge blocker |
| 404 on an owned resource | any | **page** (it is an authz bug until proven otherwise) |
| Certificate unknown-code rate | more than 5 per day | warn |
| Confirm-amount-changed rate | more than 2 sigma week over week | warn |
| Payout request 5xx | any | **page** |

### 9.3 Dashboard

Not a separate one. The portal's health belongs on M6's ops page as three lines: dashboard p95, payout request error rate, and the eligibility-to-request funnel. A module that needs its own dashboard to be understood is a module with too much in it.

---

## 10. Open questions for the founder

**OQ-M4-01. Does the portal show the identity-level aggregate?** A trader with ten accounts currently sees ten cards and no total. A combined withdrawable across accounts is genuinely useful to them. It also hands a ring a single view of their fleet's extraction capacity, and it makes the account cap and its per-entity basis very concrete to someone probing it. Recommendation: **show a total for accounts the trader holds, and do not show anything that reveals how the identity was resolved.** The useful number is theirs; the resolution graph is a detection asset.

**OQ-M4-02. What does a `rejected` KYC state say?** The four states are honest. `rejected` is the one where the honest wording and the useful wording diverge, since the provider's reason is often not something we may repeat, and a dead end here produces a support ticket from someone who may be entirely legitimate. Proposal: a neutral state plus a support route, never a reason code, and never an implication of wrongdoing.

**OQ-M4-03. Do we show the buffer as "yours but locked" or as "not yours"?** [ADR-014](../decisions/ADR-014.md) made this sharper: after a payout the trader's loss room **is** the buffer, so the buffer is simultaneously the thing they cannot withdraw and the thing they are risking. Recommendation: show it as a distinct band on the balance display labeled as the cushion, with the sentence "after a payout, this is your loss room" attached, because a trader who discovers that relationship after their first extraction will read it as a hidden rule. This is a `copy_blocks` entry.

**OQ-M4-04 (RESOLVED, 2026-08-14). Merit Rapid's cadence copy.** OQ-12 was decided as [ADR-018](../decisions/ADR-018.md): `win_days.required_count = 3`, so **the real cycle is about 3 trading days** and that is the figure the portal displays. [EC-049](../edge-cases/EC-049.md) still binds: the 1 day cadence gap is dominated, never binds, and may not be presented as the reason the plan is fast. Under [ADR-019](../decisions/ADR-019.md) the payout reaches the wallet the same day, so the cadence copy no longer needs to explain a settlement window at all; the 2 to 3 business day figure moves to the wallet screen's withdraw path, where it is actually true.

**OQ-M4-05 (NEW, from [ADR-020](../decisions/ADR-020.md)). How is "indicative" said, in one word, to a trader who will not read a sentence?** The invariants fix that a label exists and where it lives; they do not fix its wording, and this is a place where a bad word is worse than no word. "Indicative" is precise and is not a word most traders use. "Live" is the word they use and it carries exactly the wrong implication, since live is what they will assume the rules run on. "Estimated" implies imprecision that is not really the issue, because the number is accurate and merely not the one enforcement used. Recommendation: **"live (not used for rules)"** on first appearance, shortened to a persistent visual treatment plus "live" thereafter, and tested on real traders during the private beta rather than decided in this document. The one thing that must not happen is the label degrading to a tooltip, which is INV-M4-11's whole purpose.

---

### Dependencies on other modules

| ID | Dependency | Owner | Consequence if unmet |
|---|---|---|---|
| DEP-M4-01 | Every displayable number comes from an API field the engine computed | M1, M5 | The portal starts computing, and the marketing-equals-implementation guarantee dies in the client (FM-M4-01) |
| DEP-M4-02 | `copy_blocks` exists for every rule on every published plan version | M3 publish gate | The portal has no legitimate text to render and someone writes a sentence in a component (FM-M4-05) |
| DEP-M4-03 | Payout destination changes are gated by a 48 hour cooling window server side | M5, M19 | AS-M4-05 has no control that survives a valid session |
| DEP-M4-04 | `scopedDb(identity)` is the only data accessor, lint-enforced | packages/db, [ADR-008](../decisions/ADR-008.md) | FM-M4-03, which is the most common vibe-code fatality in the corpus's own research |
| DEP-M4-05 | Certificates are signed rows with a public verification endpoint | M11 builds it, M4 renders it | AS-M4-03 has no defensible position |
| DEP-M4-06 | Notifications carry `as_of_trading_day` | M10, M16 | AS-M4-06 becomes a recurring support wave |
