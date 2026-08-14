---
status: approved
depends_on: [README.md, TOS_CLAUSES.md, PRIVACY_POLICY.md, AFFILIATE_TERMS.md, ../plans/M18-graduation-track.md, ../plans/M19-kyc-identity.md, ../plans/M20-wallet.md, ../DECISIONS.md]
last_updated: 2026-08-14
---

# The Counsel Packet

**One lawyer, one sitting, three questions.** This document exists so that the sitting is a briefing rather than an interview, and so that the founder can send one file instead of five module plans.

**What this is.** Three questions engineering cannot answer, each with the facts the answer depends on, what is blocked by it, and what Merit has already decided so that counsel is not asked to design the product. **Every factual claim below is a description of a system that is fully specified**, so the answers can be given against a design rather than against an intention.

**What this is not.** It is not a request for a memo. Two of the three questions most likely resolve as **"yes, with conditions"**, and the conditions are the valuable output. Asking now, before code exists, is what makes a condition a design input rather than a rewrite.

---

## Item 1: Live-program structure, and what may be said before one exists

### The question

**(a)** Does a **ring-fenced affiliated entity** on the MFFU pattern, offering live-capital trading to graduates of Merit's simulated program, change Merit's regulatory character, and if so how?

**(b)** Until such an entity exists and is operating, **what may Merit say about graduation**, on its marketing site, in the portal, on certificates, and in community channels?

### What is decided and not in question

- **No live program exists at launch.** [OQ-M18-01](../DECISIONS.md) ruled it and the module was renamed from "live-graduation pipeline" to "graduation track" to match shipped behavior rather than an aspiration.
- **Zero live-program copy is written until this question is answered.** That is a standing prohibition across every surface, and it is enforced by a copy lint that fails the build ([M18](../plans/M18-graduation-track.md) GS-205), not by an editorial habit.
- **The ladder and the live invitation are already decoupled.** [ADR-024](../DECISIONS.md): completing the payout ladder sets **graduation eligibility**, which is a review-pool flag and nothing else. Any invitation is at Merit's sole discretion. **The engine does not emit an invitation event**, deliberately, because an engine that emits one has already made the promise.
- **The one sentence Merit intends to publish**, adopted verbatim from Lucid: the ladder is **"the maximum payout level, not a guaranteed minimum for live eligibility."** [TOS_CLAUSES](TOS_CLAUSES.md) clause 8.

### The facts the answer turns on

| Fact | Detail |
|---|---|
| The current product | **Evaluation and funded trading in a simulated environment.** No order reaches a live market and no customer funds are traded. A payout is a contractual performance-based payment |
| What ladder completion does today | Sets `graduated` and a review-pool flag. A terminal settlement pays out any remaining withdrawable balance automatically, and it is **not** an ordinal |
| Selectivity, as a factual anchor | **Topstep's live selectivity is 0.71 percent.** A firm whose funded traders complete a ladder at a much higher rate than that cannot be running "complete the ladder, get live capital" as a rule |
| What is already built | An internal admin queue over graduation-eligible accounts with full history and evidence attached, so a discretionary decision is made against the record. **The surface is internal; the silence is external** |

### Blocked by the answer

**All live-program copy. Nothing in code.** This is the cheapest of the three to leave open and the most expensive to get wrong after publishing.

---

## Item 2: Wallet characterization

### The question

Is the Merit Wallet a **payable balance** rather than a regulated stored-value or deposit-taking product, in the jurisdictions Merit serves, given the properties below? **And if the answer is yes with conditions, what are the conditions?**

Four sub-questions, so the sitting has an agenda:

1. Does holding trader balances in these terms constitute **regulated money transmission or deposit-taking**, and **does the answer change with balance size or holding period**?
2. Do the balances need to be **segregated**, and if so how does that interact with the payout wallet's weekly funding rhythm plus its same-day top-up trigger ([ADR-011](../DECISIONS.md))?
3. What must be **disclosed at the moment a trader first receives a wallet credit**, as distinct from what lives in the ToS?
4. What happens to a balance on **account closure, on enforcement, and on an unresponsive trader** after a long period?

### The properties the characterization rests on

Each is enforced structurally rather than by policy, and the enforcement mechanism is named because "we do not allow it" and "there is no code path" are different assurances.

| Property | Enforcement |
|---|---|
| **Funds originate only from payouts, promotional credit, and refunds of wallet-funded purchases** | A `provenance` check constraint on a closed list. Adding a value is a money-path migration under founder line-by-line review |
| **No deposits, no top-ups, no third-party funding. Ever** | `INV-WALLET-NO-DEPOSITS`. The list **excludes deposits explicitly** rather than omitting them, because an omission is a gap somebody fills and an exclusion is a decision somebody must reverse |
| **No interest** | No mechanism exists by which a balance could accrue |
| **No peer-to-peer transfer** | **No code path.** A wallet spend targeting another identity's account is refused server side inside the debit transaction and flagged at high severity |
| **Payable on demand, subject to stated controls** | KYC verified, 48 hour destination cooling, name match scored, $100 minimum, published 2 to 3 business days, **no withdrawal fee** |
| **Two exits only** | Spend on Merit products, or withdraw to a verified destination **in the trader's own name** |
| **The balance is money Merit already owes** | It has cleared every payout gate. Wallet balances are counted in Open Liability and in the reserve coverage ratio, so the firm's own reporting treats them as the most certain liability on the book rather than the least |
| **Float is segregated in reporting** | Excluded from reserve and reported separately, so the reserve ratio cannot be flattered by float |
| **Promotional credit is a different ledger class** | It is spendable inside Merit and **never withdrawable**, and no chain of transactions converts it into wallet balance |

### Why the wallet exists at all, since counsel will ask

The external settlement rail takes 2 to 3 business days, which traders experience as the firm being slow. **The wallet moves the speed to an internal leg**: a payout credits the wallet in the same transaction it is approved, with no external party in the path. Every external control remains on the external leg, unchanged. The firm gets the float of traders who do not withdraw immediately, and the design deliberately does **not** count that float as a reduction in what it owes.

### Blocked by the answer

**Launch.** The answer may add conditions rather than a prohibition, which is exactly why it is cheap to ask now: a segregation requirement is a bank-account decision today and a migration later.

---

## Item 3: Escheatment mapping, and the BIPA plus GDPR analysis

Two mappings, bundled because they are the same kind of work: jurisdiction-by-jurisdiction analysis that engineering cannot do and that decays if it is not on a calendar.

### 3a. Escheatment and dormancy

**The question.** Per jurisdiction: what is the **dormancy trigger period**, what **notice schedule** is required, and **where must an unclaimed balance be remitted**?

**What is decided.** Dormancy tracking and a **12 month notice schedule are designed in v1** rather than retrofitted, because reconstructing when a balance went quiet after the fact is not possible. **A balance is never forfeited**: expiry is the most brand-destroying term available and indefinite holding is non-compliant, so remittance per jurisdiction is the only remaining option. Escalating contact runs through security-class channels **including prior contacts**, which matters because a dormant trader is disproportionately one whose contact details changed.

**What counsel supplies.** The trigger-date and remittance mapping, and whether the 12 month first-notice point is early enough everywhere. **The output belongs on a calendar rather than in anyone's memory**, and the [ops calendar](../ops/runbooks/CRON_INVENTORY.md) has a row waiting for it.

### 3b. BIPA and state biometric consent

**The question.** What **consent flow, retention schedule, and destruction obligation** apply, and **is provider-side storage sufficient** as the mitigation?

**The facts.** Facial geometry is derived from a selfie and a document photo for **liveness and dedupe**. **Merit never holds documents, images, or biometric templates**: the provider does, and Merit stores a decision, a provider applicant reference, and match signals. **The selected provider is named in the privacy policy at selection time**, which makes provider choice a disclosure event rather than only a procurement one.

**The consequence counsel should know about, because it cuts the other way.** Minimization creates an **evidence dependency**: the basis for a dedupe-grounded enforcement lives at the provider, so if the provider's retention expires or Merit changes providers, Merit holds a conclusion whose basis is gone. Merit's answer is that an enforcement pack's spine is corroborating conduct rather than the dedupe hit alone. **A retention obligation that shortens provider-side storage would tighten that further**, and counsel should say so if it applies.

### 3c. GDPR lawful basis

**The question.** The lawful basis **per collection category**, and the **legitimate-interest balancing test** where that is the basis.

**The category that needs the most care.** Trading behavior is analyzed for **two purposes**: rule evaluation, which is contractual, and **abuse detection and identity linking, which is fraud prevention**. Merit's position is that the second must be disclosed as **its own purpose** rather than folded into "providing the service", because folding it is the gap that makes a later enforcement contestable. Counsel should confirm the basis and write the balancing test.

**One retention carve-out needs the balancing test most.** **Banned-identity records persist past account closure**, because an identity defense that forgets a banned operator when they close their account is not a defense. What persists is the minimum that makes recognition possible: the decision, the linking signals, and the reason. Not documents, not images. Tradeify publishes a fraud-prevention retention basis for exactly this and is the precedent to compare against, and **where Merit's scope is narrower, counsel should say so rather than copying a broader claim**.

### Blocked by the answer

**The privacy policy leaving draft**, and the dormancy calendar.

---

## Calibration, so counsel is not asked to judge in a vacuum

**Merit's planned scope sits at or below the published practice of Tradeify, Topstep, and Blue Guardian.** Apex publicly acknowledges linking on IP, device, billing instrument, and behavioral similarity including spousal accounts.

**The aggressive end of the norm is Blue Guardian's stack:** continuous document monitoring, provider-final decisions, and a 7-day funded-inactivity rule. **Merit adopts none of the three.**

**And one practice is refused rather than positioned against:** payout-time fraud friction, of which Apex's two-day screen-recording requirement is the named example. Merit moves identity friction **upstream of funding** so nothing new is ever demanded at payout.

**The regulatory weather.** US futures-prop regulation is unsettled and **the CFTC consultation closes 30 November 2026**. Payout-reserve adequacy and registration posture are counsel items in their own right, and the founder should raise them at the same sitting even though they are not among the three blocking questions.

---

## What the founder should bring

| Document | Why |
|---|---|
| [TOS_CLAUSES](TOS_CLAUSES.md) | Fifteen clauses with what each must accomplish. Clauses 7, 8, 10 and 11 are the ones the three questions land on |
| [PRIVACY_POLICY](PRIVACY_POLICY.md) | Collection categories with purposes, the fraud-prevention retention carve-out, sharing by recipient category |
| [AFFILIATE_TERMS](AFFILIATE_TERMS.md) | The NFA I-26-12 implementation, and one open item on unpaid commission at termination |
| This packet | The three questions with their facts |

**And one question to ask at the end, which is not on the list:** given everything above, **what has Merit not thought to ask?** The three items are the questions engineering knew it could not answer. The valuable answer is the fourth one.
