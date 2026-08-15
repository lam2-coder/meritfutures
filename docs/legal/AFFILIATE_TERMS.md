---
status: approved
depends_on: [README.md, TOS_CLAUSES.md, ../plans/M08-affiliate-system.md, ../plans/M05-payout-system.md, ../decisions/README.md]
last_updated: 2026-08-14
---

# Affiliate Terms: clause inventory and the NFA I-26-12 blocks

**DRAFT FOR COUNSEL. Not publishable text.** Same discipline as [TOS_CLAUSES](TOS_CLAUSES.md): requirements, not prose.

**Why affiliates get their own document.** An affiliate is not a customer and the failure modes are different in kind. A trader can breach a rule and cost Merit an account; **an affiliate can make a claim Merit has to answer for**, to a regulator, in a market whose regulatory characterization is already contested. [M08 AS-M8-04](../plans/M08-affiliate-system.md) and [EC-082](../EDGE_CASES.md) both land on the same finding: the promoter's claim becomes the firm's problem, and the only defense is a disclosure regime that is enforced per asset rather than accepted once at signup.

---

## 1. NFA Interpretive Notice I-26-12: what it requires and how Merit implements it

**The requirement in one line:** promotional material must not be misleading, must disclose material limitations, and **the promoter's relationship and compensation must be disclosed**.

**Merit's implementation is per-asset approval with disclosure versioning**, and the three mechanisms are the clauses.

| Mechanism | What it does | Why per-asset rather than per-affiliate |
|---|---|---|
| **Creative approval** | Every landing page, ad, video, post, and email template is approved individually before use | An affiliate approved as a person is an affiliate who can publish anything afterwards. Approval attaches to the artifact |
| **Disclosure versioning** | Every approved creative is **bound to a disclosure version**. When a version is superseded, **every creative bound to the old one is withdrawn automatically** | GS-126. A disclosure update that relies on affiliates noticing is a disclosure update that did not happen |
| **Re-check on change** | An approved landing page whose content later changes reverts to `pending` | GS-126. The classic evasion is approval-then-edit, and it is cheap to detect and impossible to argue with |

---

## 2. The disclosure blocks

**Two blocks, both drafted by counsel, both mandatory on every affiliate-published surface.** They are separate because they answer different questions and a combined block gets skimmed as one.

| Block | Must state |
|---|---|
| **Relationship and compensation** | That the promoter is a Merit affiliate, that they are **paid a commission** on purchases made through their link, and that this compensation may create an incentive to promote. NFA I-26-12's core requirement |
| **Simulated environment** | The full form from [TOS_CLAUSES](TOS_CLAUSES.md) section 2. **An omitted simulated-environment disclosure is a named prohibited-claim class**, not a formatting issue |

**Placement requirement: both blocks appear where the claim appears**, not on a linked page and not below a fold on a long form. A disclosure a reader has to navigate to is a disclosure that failed its purpose, and it is the version a regulator reads least charitably.

---

## 3. Prohibited claim classes, enumerated

**Enumerated rather than gestured at**, for exactly the reason clause 4 of the ToS is enumerated: a standard nobody can comply with is a standard Merit cannot enforce.

| # | Prohibited | Why it is its own class |
|---|---|---|
| 1 | **Guarantees**, of passing, of funding, of payout, or of income | The corpus's own selection math puts durable edge at 1 to 3 percent. A guarantee contradicts Merit's model as well as its regulator |
| 2 | **Fabricated, unverified, or unrepresentative results** | Including real results presented without their base rate. [M11](../plans/M11-certificates-social-proof.md)'s signed certificates exist so a real result can be shown verifiably, which removes the excuse |
| 3 | **Omitted simulated-environment disclosure** | Section 2 |
| 4 | **Implied partnership, employment, or agency with Merit** | "Merit's official partner", a Merit-branded email address, or copy written in Merit's voice. [M15](../plans/M15-discord-integration.md) GS-188 is the same failure through a stolen bot token, and the harm is identical: a claim in the firm's own voice |
| 5 | **Any statement about live capital, funded-capital programs, or graduation to live trading** | [OQ-M18-01](../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md). **Zero live-program copy exists anywhere**, and an affiliate is the most likely source of the first instance |
| 6 | **Any rule, price, cap, or parameter stated as a literal** | The [parameter-status ruling](../decisions/gates/parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14.md): a parameter is read, never copied. An affiliate quoting a cap that later changes has published a rule Merit does not have |
| 7 | **Comparative claims against a competitor's figures** | [M12](../plans/M12-transparency-platform.md) GS-169: comparing a rigorous number to an unmethodical one concedes the argument to win a sentence. **Comparisons about the practice are permitted**; comparisons of value to value are not |
| 8 | **Incentivized or misrepresented reviews** | The review-request flow is compliance-constrained on Merit's own surfaces ([M12](../plans/M12-transparency-platform.md) GS-164) and an affiliate route around it would defeat it |

---

## 4. The graduated enforcement ladder

**A ladder rather than a switch**, because the alternative is that every violation is either ignored or terminal, and the middle is where almost all of them live.

| Step | Trigger | Action |
|---|---|---|
| 1 | A creative fails re-check or a disclosure is missing | **Creative withdrawn**, affiliate notified with the specific asset and the specific defect |
| 2 | Repeat within a window, or a prohibited claim of class 1, 2, or 3 | **Approval suspended**: existing creative withdrawn, no new approvals, **commissions continue to accrue** |
| 3 | A prohibited claim of class 4 or 5, or continued publication after suspension | **Program termination**, with the unpaid-commission treatment in section 5 |
| 4 | Fraud: self-referral, cookie stuffing, or referred-buyer clustering above the confidence ceiling | **Termination and forfeiture**, and it is a [M07](../plans/M07-risk-abuse.md) matter as well as a program one |

**Each step requires a written reason and names the asset or conduct**, mirroring the ToS's enforcement-process clause. An affiliate program that terminates without stating why produces the same public argument a trader enforcement does, with a promoter's audience attached.

---

## 5. Commission, clawback, and termination

| Term | Requirement |
|---|---|
| **Attribution** | Last touch, **30 day window**. The window is deliberately unchanged in the face of click-fraud patterns, because shortening it would punish legitimate content affiliates to stop a pattern that is detectable directly (GS-125) |
| **Chargeback clawback** | A chargeback on a referred purchase **claws back the commission**, and the affiliate balance may go negative and nets against future commission (GS-123). This is the accepted consequence of paying before the chargeback window closes, which is the only commercially available option |
| **Chargeback-rate hold** | A chargeback rate above the threshold **holds the next statement pending review** rather than merely appearing on a dashboard |
| **Self-referral** | Attribution voided and the account flagged (GS-045). Extended by the linking clause: **a buyer linked to the affiliate above the confidence ceiling** is treated the same way, while a genuine family referral below the ceiling is **not** voided (GS-124) |
| **Payment rail** | Commissions pay through **the same transfer machinery as trader payouts** ([ADR-017](../decisions/ADR-017.md)): one rail, one destination table, one detector. **Affiliate destination changes carry the same 48 hour cooling window** (GS-140) |
| **Unpaid commission on termination** | **This needs counsel's judgment and it is the one commercial term this document does not propose.** The options are forfeit, pay out, or pay out net of clawbacks and holds. Merit's brand position argues against forfeiture as a default; the fraud cases in step 4 argue for it as an available remedy. Recommendation to draft: **pay out net, except on termination for fraud** |

---

## 6. What must not appear in the affiliate terms

- **A blanket right to withhold commission at Merit's discretion.** It is the affiliate-facing version of "decisions are final" and it makes every legitimate hold look like the same act.
- **An approval that attaches to the affiliate rather than the asset.** Section 1.
- **Any obligation Merit cannot detect a breach of.** An unenforceable affiliate term is worse than none, for the same reason it is worse in the ToS.

---

## 7. Open items for counsel

1. **Unpaid commission on termination**, section 5. A commercial and legal judgment together.
2. **Whether the relationship-and-compensation block must appear in a specific form or position** under I-26-12, or whether "clear and prominent" is the standard. It changes the lint that enforces it.
3. **Whether affiliate conduct in a jurisdiction Merit restricts creates exposure for Merit**, given that the affiliate is promoting and Merit is refusing the sale server side. This interacts with [TOS_CLAUSES](TOS_CLAUSES.md) clause 11 and it is the affiliate question the corpus cannot answer at all.
