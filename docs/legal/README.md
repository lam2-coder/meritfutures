---
status: review
depends_on: [../DECISIONS.md, TOS_CLAUSES.md, PRIVACY_POLICY.md, AFFILIATE_TERMS.md, COUNSEL_PACKET.md, ../plans/M07-risk-abuse.md, ../plans/M05-payout-system.md, ../plans/M08-affiliate-system.md, ../plans/M20-wallet.md, ../plans/M18-graduation-track.md]
last_updated: 2026-08-14
---

# Legal Docs Index

ToS, Privacy, affiliate terms, the counsel packet, sim-language disclosure blocks, and the restricted-jurisdiction placeholder. **Written in Wave 4** (source spec: constitution sections 6 and 9). **Every document here is `draft for counsel` and none is publishable text**, which is a status rather than a caveat: the corpus's job was to state precisely what the system does so a lawyer drafts against a requirement rather than against a guess.

What follows are **drafting notes**: rulings already taken that the Wave 4 drafts must implement, and the counsel-review items those rulings created. They are recorded here as they are decided rather than collected at the end, because a clause that is remembered at drafting time is a clause that gets drafted, and one that is not is an enforcement Merit cannot cite.

## 1. The copy-trading clause (ruled 2026-08-14)

From the Wave 3 batch 1 gate ([DECISIONS](../DECISIONS.md), [M07](../plans/M07-risk-abuse.md) section 3.4). The ToS must state all four rows, enumerated rather than gestured at:

| Conduct | Status |
|---|---|
| Copy trading between accounts of the **same verified identity** | **Allowed** |
| Copy trading **across identities** | **Prohibited** |
| **Third-party signal or copy-trading services** | **Prohibited** |
| **Account management**, meaning one person trading an account belonging to another | **Prohibited** |

**Why the enumeration matters more than the policy.** [M07 AS-M7-07](../plans/M07-risk-abuse.md) establishes that enforcement must rest on **behavior described in the ToS**, never on a detector threshold, because citing a threshold both invites an argument about the number and publishes it. "Coordinated trading" is not a standard anyone can comply with; the four rows above are. The clause is what makes cross-identity copy a violation in its own right rather than evidence toward one, and that is the difference between a defensible enforcement and a public argument Merit loses while being right.

**Drafting note.** The third-party-services and account-management rows are not decoration. Without them a ring routes its coordination through a nominally independent signal service and satisfies the letter of a same-identity rule.

## 2. The Merit Wallet (ADR-019, ruled 2026-08-14)

**A counsel-review item, flagged as such rather than assumed settled.** The wallet holds trader money on Merit's books, and the distance between "a payable balance" and "a regulated deposit-taking activity" is a question for a lawyer in the relevant jurisdictions, not for this corpus.

**The framing the product is built to, which the drafts must match:**

- **Payable balance.** The wallet records money Merit **already owes** the trader, held pending their instruction to withdraw or spend it. It is not an account, not a deposit, and not a custody arrangement.
- **No interest.** Balances earn nothing, and the product carries no mechanism by which they could.
- **No peer-to-peer transfer.** A balance cannot move between identities. There is no code path, which is the strongest form of the clause ([M05](../plans/M05-payout-system.md) INV-M5-14).
- **Two exits only:** spend on Merit products, or withdraw to a verified destination in the trader's own name, subject to KYC, the 48 hour destination-cooling window, a $100 minimum, and 2 to 3 business days.
- **No withdrawal fee.**

**The specific questions for counsel**, so the review has an agenda rather than a document:
1. Does holding trader balances in these terms constitute regulated money transmission or deposit-taking in the jurisdictions Merit serves, and does the answer change with balance size or holding period?
2. Do the balances need to be segregated, and if so, does that interact with the payout wallet's funding rhythm ([ADR-011](../DECISIONS.md))?
3. What must be disclosed at the point a trader first receives a wallet credit, as distinct from what lives in the ToS?
4. What happens to a wallet balance on account closure, on enforcement, and on an unresponsive trader after a long period?

## 3. The gamification bright line (ADR-019a)

Not itself a legal document, and it belongs in the drafting notes because it constrains what any future offer or loyalty copy may say:

**Purchased is always known contents. Randomized is earned only, and only with disclosed odds. No purchased loot boxes, ever.**

The rationale is on the record in [DECISIONS](../DECISIONS.md) and has a compliance half worth repeating here: Merit sells simulated-trading evaluations in a market whose regulatory characterization is already contested, and a paid random-outcome mechanic invites the reading the firm can least afford, which is that the product is a wager rather than an evaluation.

## 4. Already-recorded obligations the Wave 4 drafts inherit

| Obligation | Source |
|---|---|
| Affiliate ToS with **enumerated prohibited-claim classes** (guarantees, fabricated results, omitted simulated-environment disclosure, implied partnership with Merit), plus the graduated enforcement ladder and the treatment of unpaid commission on termination | [M08](../plans/M08-affiliate-system.md) AS-M8-04, OQ-M8-04, DEP-M8-04, NFA I-26-12 |
| Simulated-environment disclosure in the footer, at checkout entry, on certificates, and on the funded dashboard | [M04](../plans/M04-trader-portal.md) INV-M4-09, constitution section 6 |
| ToS acceptance recorded per version with IP and timestamp, as the first artifact any enforcement dispute asks for | [M03](../plans/M03-billing-checkout.md) INV-M3-09 |
| The freeze contract: a cited open flag, a ToS clause, a written reason, and a **published expiry** | [M05](../plans/M05-payout-system.md) INV-M5-10, AS-M5-04 |
| Restricted-jurisdiction list | constitution section 10, pending counsel |
| Coordinated-trading and common-control clauses, still open | [M07](../plans/M07-risk-abuse.md) DEP-M7-05 |

## The documents (completed Wave 4, 2026-08-14)

| Doc | Covers | Status |
|---|---|---|
| [TOS_CLAUSES.md](TOS_CLAUSES.md) | **Fifteen** required clauses with what each must accomplish, the simulated-environment disclosure-block inventory across seven surfaces, clause 8's Lucid framing, the wallet property list, the restricted-jurisdiction placeholder structure, and what must not appear | draft for counsel |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | Collection categories and purposes, the fraud-prevention retention carve-out, sharing by recipient category | draft for counsel |
| [AFFILIATE_TERMS.md](AFFILIATE_TERMS.md) | **New.** NFA I-26-12 implemented as per-asset approval with disclosure versioning, the two mandatory disclosure blocks, eight enumerated prohibited-claim classes, the four-step enforcement ladder, and commission clawback and termination terms | draft for counsel |
| [COUNSEL_PACKET.md](COUNSEL_PACKET.md) | **New.** The three questions as one sendable document: live-program structure, wallet characterization, and escheatment plus BIPA and GDPR. Each with the facts the answer turns on, what is already decided, and what is blocked | draft for counsel |

**None contains drafted prose and none is publishable.** The two mappings counsel must supply, BIPA and state biometric consent, and GDPR lawful basis per category, are flagged in the privacy policy and are [counsel packet](COUNSEL_PACKET.md) item 3.

**Two documents deliberately do not exist yet.** A **risk disclosure** is not written because its content depends on counsel packet items 1 and 2, and drafting it now would produce a document that has to be rewritten rather than reviewed. The **restricted-jurisdiction list** is not written because it is counsel's output rather than an engineering input; [TOS_CLAUSES](TOS_CLAUSES.md) section 5 specifies the clause structure so the list drops in without a redraft.

## Norm positioning

**Merit's planned scope sits at or below the published practice of Tradeify, Topstep, and Blue Guardian.** This is recorded because it is the useful fact when a clause is challenged: Merit's identity linking, verification triggers, and monitoring disclosures are all inside what competitors already publish, not ahead of them. Apex publicly acknowledges linking on IP, device, billing instrument, and behavioral similarity including spousal accounts.

**The aggressive end of the norm, for calibration, is Blue Guardian's stack:** continuous document monitoring, provider-final decisions, and a 7-day funded-inactivity rule. **Merit adopts none of the three.**

**One market practice is explicitly refused rather than positioned against:** payout-time fraud friction, of which Apex's two-day screen-recording requirement is the named example. Merit moves identity friction upstream of funding so nothing new is ever demanded at payout ([M05](../plans/M05-payout-system.md) section 7.9).

## The counsel packet

**Now its own document: [COUNSEL_PACKET.md](COUNSEL_PACKET.md).** Three items, one lawyer, one sitting: the **live-program structure** and what may be said about graduation before one exists; **wallet characterization** as a payable rather than regulated stored value; and **escheatment mapping plus the BIPA and GDPR lawful-basis analysis**. Each carries the facts its answer turns on, so the sitting is a briefing rather than an interview.

**Two of the three most likely resolve as "yes, with conditions", and the conditions are the valuable output.** That is the argument for asking before code exists: a segregation requirement is a bank-account decision today and a migration later. The packet also carries a fourth question to ask at the end, which is what Merit has not thought to ask.
