---
status: approved
depends_on: [README.md, COUNSEL_PACKET.md, AFFILIATE_TERMS.md, ../decisions/ADR-040.md, ../decisions/ADR-041.md, ../plans/M02-rithmic-bridge.md, ../plans/M07-risk-abuse.md, ../plans/M19-kyc-identity.md, ../plans/M20-wallet.md, ../plans/M05-payout-system.md, ../plans/M18-graduation-track.md, ../plans/M03-billing-checkout.md, ../decisions/README.md]
last_updated: 2026-08-16
---

# Terms of Service: clause inventory

**DRAFT FOR COUNSEL. Not publishable text.** What each clause must accomplish and why, so a lawyer drafts against a requirement rather than against a guess. **No drafted prose anywhere in this document**, deliberately: prose written by an engineer is prose a lawyer has to unpick before starting, and the one thing this document is good for is telling counsel what the system actually does.

**The governing constraint from the constitution:** a rule Merit cannot enforce is worse than no rule, and a rule Merit enforces without having published is worse still. **Every detector that produces an enforceable outcome needs a clause here, or its flags are unactionable.** [M07 D-01](../plans/M07-risk-abuse.md) spent an entire drafting cycle in exactly that state, waiting for the copy-trading ruling that became clause 4.

---

## 1. Clauses required

**Fifteen clauses.** Each exists because a specific mechanism in the corpus is unenforceable, undisclosed, or misleading without it. The right-hand column is the thing that breaks if the clause is missing, which is the test for whether a clause belongs here at all.

| # | Clause | What it must accomplish | Driven by |
|---|---|---|---|
| 1 | **Account linking** | Merit may treat multiple accounts as controlled by one person on the basis of identity, device, payment, destination, and behavioral signals, and may apply per-person limits and enforcement across them | [ADR-022](../decisions/ADR-022.md). Without it the link-confidence graph produces conclusions Merit cannot act on. Apex publishes an equivalent clause |
| 2 | **Verification and re-verification rights** | Merit may require identity verification at defined trigger points, and may re-verify on destination change, flag, dormancy, or document expiry | [ADR-021](../decisions/ADR-021.md), [M19](../plans/M19-kyc-identity.md) SD-M19-01. **Trigger points are disclosed in advance** on plan pages, so verification is never a surprise after payment |
| 3 | **Monitoring consent** | Trading behavior, device and network signals are analyzed for rule evaluation **and** for fraud and abuse detection | The dual purpose must be explicit. Folding the fraud purpose into "providing the service" is the gap that makes a later enforcement contestable |
| 4 | **Copy trading and account management** | Same-identity copying across one's own Merit accounts is permitted. **Cross-identity copying, third-party signal and copy services, and account management by another person are prohibited** | The batch 1 copy-trading ruling. This is the clause D-01 was waiting for, and the enumeration is the point: "coordinated trading" is not a standard anyone can comply with |
| 5 | **Enforcement process** | What Merit may do on a confirmed violation, in what order, with what notice, and what the trader's route of response is. **Three outcomes, not two**, and they are distinguished by scope and reversibility: a **freeze** is per payment and expires; a **restriction** is per person, halts activity across every account that person holds, and **is reversed by a documented restore**; **closure for cause** is terminal and per account. Every one carries a cited flag, a stated clause and a written reason | **A process clause protects Merit more than a discretion clause does.** "Decisions are final" language is explicitly rejected: it is false, because a human can reverse, and it is what a wronged trader screenshots. **[ADR-041](../decisions/ADR-041.md) is why this clause now enumerates three.** The corpus previously had a bounded freeze and terminal closure and **nothing between them**, which is the gap an operator under pressure improvises into. A restriction is the proportionate middle action, and drafting it as a distinct, **reversible** outcome is what makes the reversal a term the trader can hold Merit to rather than a favour. See section 8 |
| 6 | **Eligibility representation** | The trader represents they have **no outstanding balances or unresolved disputes with other proprietary trading firms** | **Lucid-style.** A cheap, self-executing filter against operators cycling between firms, and it makes a later discovery a breach of representation rather than an argument about house rules |
| 7 | **Wallet terms** | The wallet is a **payable balance**. It bears **no interest**, permits **no peer-to-peer transfer**, and **accepts no deposits** (`INV-WALLET-NO-DEPOSITS`). Funds originate only from payouts, promotional credit, and refunds. Two exits: spend on Merit products, or withdraw to a verified destination in the trader's own name | [ADR-019](../decisions/ADR-019.md), [M20](../plans/M20-wallet.md). **The no-deposit property is what the payable framing rests on**, so it is a term and not only an implementation detail. See section 4 for the full property list counsel needs |
| 8 | **Ladder and live eligibility** | The payout ladder is **the maximum payout level, not a guaranteed minimum for live eligibility**. Ladder completion sets graduation eligibility only; any live invitation is **at Merit's sole discretion** | [ADR-024](../decisions/ADR-024.md), Lucid's framing adopted verbatim. **This clause exists to be quoted back**, so it is written to be quotable. See section 3 |
| 9 | **Dormancy and unclaimed balances** | Notice schedule from 12 months of inactivity, and a statement that **Merit never keeps a balance** | [OQ-M20-04](../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md). Escheatment mapping is [counsel packet](COUNSEL_PACKET.md) item 3 |
| 10 | **Simulated environment** | The product is **evaluation and funded trading in a simulated environment**. No order reaches a live market, no customer funds are traded, and a payout is a contractual performance-based payment rather than trading profit | Constitution section 6. This is the clause the entire regulatory posture rests on, and it must be consistent with every disclosure block in section 2 rather than merely compatible with them |
| 11 | **Eligibility, jurisdiction, and restricted territories** | Who may buy, the geographic restrictions, and that enforcement is **server side at checkout** rather than a notice | **The restricted list is a placeholder pending counsel.** See section 5, which is written so the list can be dropped in without redrafting the clause |
| 12 | **Rules, plan versions, and pinning** | An account is governed by the **plan version pinned at purchase**. A later published version never applies to it, in either direction | [M01](../plans/M01-rules-engine.md), B4 #12, GS-041, GS-221. Without this clause the retroactive-change protection is an implementation detail rather than a promise, and it is the single most valuable promise Merit can make in a market whose live case study is a firm destroyed by a retroactive rule change |
| 13 | **Payout mechanics** | Approval is **mechanical against published gates with no discretionary denial**. Where a payout is held, the hold requires a **cited open flag, a stated clause, a written reason, and a published expiry**, and reaching expiry **releases and pays**. **The expiry is 48 hours and it is one number for both holds**: the pre-approval review hold and the post-approval freeze. The same rule and the same clock apply to a withdrawal halted before settlement | [M05](../plans/M05-payout-system.md) INV-M5-01 and INV-M5-10, GS-109, and **[ADR-040](../decisions/ADR-040.md), which is what put a number in this row.** The freeze contract is a constraint on Merit and it should be drafted as one, because a clause that binds the firm is worth more to a reader than three that bind them. See section 8 |
| 14 | **Fees, refunds, resets, and chargebacks** | What is charged, what is refundable and in what window, that a **refund returns to the funding payment method** and never to the wallet, and the consequence of a chargeback on a funded account | [M03](../plans/M03-billing-checkout.md), [M20](../plans/M20-wallet.md) INV-M20-05, GS-224, GS-096. The refund-routing rule is a term because crossing the rails turns card money into withdrawable cash outside the card network's protections |
| 15 | **Acceptance, versioning, and changes to these terms** | Acceptance is recorded **per version with IP and timestamp**; changes are notified before taking effect and **never applied to conduct that predates them** | [M03](../plans/M03-billing-checkout.md) INV-M3-09. The acceptance record is the first artifact any enforcement dispute asks for, and clause 12's protection would be hollow if the terms themselves could move retroactively |

---

## 2. The simulated-environment disclosure blocks

Constitution section 6 requires simulated-environment disclosure in the **footer, at checkout, in the ToS, and on certificates**. [M04](../plans/M04-trader-portal.md) INV-M4-09 adds the funded dashboard. This section is the inventory, because a disclosure that exists in four places and says three different things is worse than one that exists in three.

**The rule: one canonical block, one canonical short form, and every surface uses one of the two.** Counsel drafts both. Nobody paraphrases either.

| Surface | Form | Placement requirement |
|---|---|---|
| **Site footer** | Short | Every page, above the fold on nothing, present on all |
| **Checkout entry** | Full | **Before payment**, not on the confirmation. A disclosure a buyer reads after paying is a receipt |
| **ToS clause 10** | Full, canonical | The source the others are derived from |
| **Certificates and social cards** | Short | **Inside the image** ([M11](../plans/M11-certificates-social-proof.md)), because a card is screenshotted and cropped and the disclosure has to survive that |
| **Funded dashboard** | Short | Persistent, not dismissible. [M04](../plans/M04-trader-portal.md) INV-M4-09 |
| **Pass and payout emails** | Short | The two messages most likely to be forwarded |
| **Affiliate creative** | Full, plus the NFA block | [AFFILIATE_TERMS](AFFILIATE_TERMS.md). An omitted simulated-environment disclosure is a named prohibited-claim class |

**Three drafting notes counsel should have.**

1. **The short form must be a true summary of the full one**, not a softened one. If the short form cannot carry the meaning, the full form goes on that surface instead.
2. **The disclosure is not a disclaimer.** It describes what the product is. Drafting it in disclaimer register (dense, defensive, at the bottom) undercuts clause 10's role as the foundation of the regulatory posture, and it also reads as something being hidden, which is the opposite of Merit's whole position.
3. **A build check enforces presence, not wording** ([M09](../plans/M09-marketing-site.md)). A surface missing the block fails the build. Wording is counsel's and changing it is a versioned content change.

---

## 3. Clause 8, drafted against the exact risk

Clause 8 is short and it is the highest-leverage sentence in the document, so it gets its own section.

**The framing to adopt, verbatim from Lucid because it is exactly right:** the ladder is **"the maximum payout level, not a guaranteed minimum for live eligibility."**

**Why this sentence and not a longer disclaimer.** [ADR-024](../decisions/ADR-024.md) decoupled ladder completion from any live invitation, and the reasoning was that **an engine emitting an invitation on ladder completion has already made the promise**, so disclaiming an event the system reliably emits is the weakest possible position. Merit does not emit it. Ladder completion sets a review-pool flag and nothing else. The clause therefore describes the system rather than qualifying it, which is the only kind of clause that survives being quoted back.

**The number that makes it honest: Topstep's live selectivity is 0.71 percent.** A firm whose funded traders complete a ladder at a far higher rate than that cannot be operating "complete the ladder, get live capital" as a rule. Counsel does not need to draft the number, but they should know it exists, because it is why the clause is a description rather than a hedge.

**And the clause has a hard boundary.** [OQ-M18-01](../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md) ruled that **no live program exists at launch and zero live-program copy is written until counsel rules**. Clause 8 is the **only** permitted statement in the entire estate touching live eligibility, and it is a disclaimer of entitlement rather than a description of a program. Anything else is [counsel packet](COUNSEL_PACKET.md) item 1.

---

## 4. Clause 7, and the property list the wallet characterization rests on

Counsel packet item 2 asks whether the wallet is a payable or a regulated stored-value product. **The answer depends on properties rather than on framing**, so the properties are listed here as the drafting basis and as the factual record the opinion is given against.

| Property | Status | Enforced by |
|---|---|---|
| **Funds originate only from payouts, promotional credit, and refunds of wallet-funded purchases** | Closed list | A `provenance` check constraint. Adding a value is a money-path migration ([M20](../plans/M20-wallet.md) SD-M20-01, GS-225) |
| **No deposits, no top-ups, no third-party funding** | Excluded explicitly, not merely omitted | `INV-WALLET-NO-DEPOSITS`, [M20](../plans/M20-wallet.md) INV-M20-11. **An omission is a gap somebody fills; an exclusion is a decision somebody must reverse** |
| **No interest** | No mechanism exists by which a balance could earn | [ADR-019](../decisions/ADR-019.md) |
| **No peer-to-peer transfer** | **No code path**, which is the strongest form of the clause | [M05](../plans/M05-payout-system.md) INV-M5-14. A wallet spend targeting another identity's account is refused and flagged at high severity (GS-227) |
| **Payable on demand, subject to stated controls** | KYC verified, 48 hour destination cooling, name match, $100 minimum, 2 to 3 business days, **no withdrawal fee** | [M05](../plans/M05-payout-system.md), GS-129 |
| **Balance is money Merit already owes** | It has cleared every gate, so it is the most certain liability on the book | [ADR-019](../decisions/ADR-019.md). Wallet balances join Open Liability and the reserve coverage ratio (GS-130) |
| **Float is segregated in reporting** | Excluded from reserve and reported separately | GS-229 |
| **Dormancy is tracked from month 12 and a balance is never forfeited** | Designed in v1 rather than retrofitted | [OQ-M20-04](../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md), GS-228 |

**The four questions for counsel** are in the [counsel packet](COUNSEL_PACKET.md) rather than here, so the packet is one document a lawyer can be sent.

---

## 5. Clause 11, and the restricted-jurisdiction placeholder

**The list is not in this document and it is not in the corpus, because it is counsel's output rather than an engineering input.** Clause 11 is drafted so that the list can be supplied later without redrafting anything.

**The structure to draft against:**

1. **The clause states that Merit restricts availability by jurisdiction and that the current list is published**, with a stable URL. The clause does not enumerate.
2. **The published list is a versioned content artifact** with an effective date, so a trader can see what applied when they bought.
3. **Enforcement is server side at checkout**, and the site notice is disclosure rather than control. GS-145 pins both halves: the notice renders and the call to action is suppressed on a direct visit, and **checkout refuses server side in both the direct and the VPN case**.
4. **A VPN bypass of the notice is an expected outcome rather than a failure**, and the clause should not promise that the notice is a barrier, because it is not one and a trader who gets past it has not defeated a control.
5. **The trader represents their jurisdiction** and a false representation is a breach, which is what makes the geo triangle in [M19](../plans/M19-kyc-identity.md) a signal rather than an accusation.

**What counsel needs to supply:** the list, the basis for each entry, and whether the list's changes apply to existing accounts or only to new purchases. **The corpus's default is clause 12's pinning**, so an existing account keeps its terms, and counsel should say if that is wrong for this clause specifically.

---

## 6. What must not appear

- **"Decisions are final."** See clause 5. It is false and it is what a wronged trader screenshots.
- **Any live-program or funded-capital representation.** [OQ-M18-01](../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md). Clause 8 is the only permitted statement touching live eligibility.
- **Any rule Merit does not implement.** The publish-time validations ([M01](../plans/M01-rules-engine.md) PW-01 to PW-04) exist to catch the reverse case, where a page describes a rule the config does not carry. This is the same discipline applied to prose, in the direction nobody checks.
- **Any performance representation, guarantee, or implied likelihood of passing.** The corpus's own selection math puts durable edge in the population at 1 to 3 percent and P(skilled given funded) at 6.8 percent, and **pass rate is a price knob rather than a quality filter**. A clause implying otherwise would contradict the firm's own model.
- **A discretionary payout-denial power.** There is no `denied` status in `payout_requests`. **This bullet read "and no review state" until [ADR-040](../decisions/ADR-040.md)**, and it is one of the ten sites that amendment names. A review state now exists and **it expires**; what does not exist, and what counsel must not draft, is a power to deny. Drafting a power the system cannot exercise would create a liability with no corresponding capability, which is the worst of both. **The distinction is the whole of section 8** and it is not a quibble: a hold that pays on a clock and a denial are different powers, and only one of them is real.
- **Blanket indemnification for anything Merit controls.** A clause that reads as though the firm accepts no operational risk on a product whose entire promise is operational reliability is a clause that undercuts the product.

---

## 7. Norm positioning, recorded so counsel can calibrate

Merit's planned scope **sits at or below the published practice** of Tradeify, Topstep, and Blue Guardian. Apex publicly acknowledges linking on IP, device, billing instrument, and behavioral similarity including spousal accounts, which is clause 1's precedent.

**The aggressive end of the norm, for calibration, is Blue Guardian's stack:** continuous document monitoring, provider-final decisions, and a 7-day funded-inactivity rule. **Merit adopts none of the three.**

**One market practice is explicitly refused rather than positioned against:** payout-time fraud friction, of which Apex's two-day screen-recording requirement is the named example. Merit moves identity friction upstream of funding so that **nothing new is ever demanded at payout** ([M05](../plans/M05-payout-system.md) section 7.9). Clause 2's trigger points are the mechanism, and clause 13 is the promise it enables.

**The point of recording all this: Merit's clauses are not novel.** That is the useful fact when a clause is challenged as overreach, and it is worth counsel having before they read clause 1.

---

## 8. Clauses 5 and 13, and the two clocks counsel must not soften

**[ADR-040](../decisions/ADR-040.md) and [ADR-041](../decisions/ADR-041.md) put a clock that binds Merit into a gap where the corpus previously had nothing**, and both clauses get their own section for clause 8's reason: they are the sentences most likely to be softened in drafting, and softening either one deletes the thing being disclosed.

### The hold is a promise about a deadline, not a disclosure of a power

**The obvious drafting instinct is wrong here.** A lawyer reading "Merit may hold a payout pending review" will reach for the familiar shape, which is a reserved discretion with an indefinite window and a best-efforts sentence. **That is the opposite of what the system does**, and drafting it that way would create the discretionary denial power section 6 forbids while describing a mechanism that cannot exercise it.

**What the system actually does, and therefore what the clause must say:**

| The fact | Why it belongs in the clause rather than in a policy page |
|---|---|
| A hold is entered **before approval**, only when an unresolved high-severity flag already stands | It is not a discretion exercised after a decision. There is no decision yet, which is what makes it not a denial |
| It **expires in 48 hours**, and the expiry is published | An unpublished expiry is a promise Merit can quietly extend. The number is the clause's whole value to a reader |
| Reaching expiry **releases and pays** | The verb is "pays", not "resumes review". A clause that says the hold "lapses" leaves open what happens next, and what happens next is the point |
| The only alternative outcome is a **documented enforcement action** carrying a cited flag, a stated clause and an evidence pack | Two outcomes and no third. "Or such further period as Merit may reasonably require" is the drafting that would delete this clause |
| A hold **pays at expiry even if the account has since breached** | This is the one counsel is most likely to query, and the answer is that the alternative is Merit's own hold costing the trader money |

**The same clock and the same rule apply to a withdrawal halted after the money is already in the trader's wallet**, with one difference that must survive drafting: **release there resumes the transfer and does not re-pay**, because the money is already owed and recognised. Counsel should not collapse the two into one sentence that implies a second payment.

### The restriction is defined by its reversal

**Clause 5's three outcomes are distinguished by scope and by reversibility, and the second property is the one that is easy to lose.** A restriction that is drafted as "Merit may suspend access" is indistinguishable to a reader from closure, and a trader who cannot tell them apart behaves as though the terminal one has happened.

**What the clause must carry:**

1. **It is per person, not per account.** It halts purchases and resets, payout requests, wallet spend, external withdrawal, affiliate settlement, and platform trading, across every account that person holds.
2. **Account state is preserved intact.** No account status moves, no ladder position is lost, no entitlement history is rewritten. This is a term, not an implementation detail, because it is the difference between a pause and a forfeiture.
3. **It is reversed by a documented restore**, recorded with an actor, a time and evidence. The reversal is the property that makes it proportionate, and a clause that omits it has described closure under a gentler word.
4. **Where a payout is pending, [ADR-040](../decisions/ADR-040.md)'s 48 hours still runs.** A restriction cannot hold a held payout past its own deadline. Counsel should draft this as an express limit rather than leaving it to inference, because the inference a reader draws from two overlapping enforcement powers is that the longer one governs.

**One honest limit to state to counsel rather than hide.** The platform-trading leg of a restriction is **provisional** on a vendor capability Merit does not yet have ([ADR-005](../decisions/ADR-005.md), `V-M2-15`). Revocation works; **restoration of platform access depends on an artifact the vendor has not committed to supply.** Until it exists, the clause should not promise a restoration timeframe for that leg specifically, and it should not promise one implicitly by promising one for the others.

### What must not appear in either clause

- **Any indefinite or extendable hold period.** The expiry is the control. A clause permitting extension deletes it, and this is the single most likely amendment to be proposed in redlining.
- **"Pending investigation" with no stated end.** A review the trader cannot see the end of is indistinguishable from a refusal ([M05](../plans/M05-payout-system.md) section 3.4), which is the rule the trader-facing copy already runs on.
- **A suspension power described without its reversal.**
- **Any wording implying that a hold reaching expiry results in a further review** rather than in payment.
