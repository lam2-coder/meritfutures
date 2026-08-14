---
status: draft
depends_on: [README.md, ../plans/M07-risk-abuse.md, ../plans/M19-kyc-identity.md, ../plans/M20-wallet.md, ../DECISIONS.md]
last_updated: 2026-08-14
---

# Terms of Service: clause inventory

**DRAFT FOR COUNSEL. Not publishable text.** What each clause must accomplish and why, so a lawyer drafts against a requirement rather than against a guess. No drafted prose.

**The governing constraint from the constitution:** a rule Merit cannot enforce is worse than no rule, and a rule Merit enforces without having published is worse still. **Every detector that produces an enforceable outcome needs a clause here, or its flags are unactionable.** [M07 D-01](../plans/M07-risk-abuse.md) spent an entire drafting cycle in exactly that state.

## Clauses required

| # | Clause | What it must accomplish | Driven by |
|---|---|---|---|
| 1 | **Account linking** | Merit may treat multiple accounts as controlled by one person on the basis of identity, device, payment, destination, and behavioral signals, and may apply per-person limits and enforcement across them | [ADR-022](../DECISIONS.md). Without it, the link-confidence graph produces conclusions Merit cannot act on. Apex publishes an equivalent clause |
| 2 | **Verification and re-verification rights** | Merit may require identity verification at defined trigger points and may re-verify on destination change, flag, dormancy, or document expiry | [ADR-021](../DECISIONS.md), [M19](../plans/M19-kyc-identity.md) SD-M19-01. **Trigger points are disclosed in advance** on plan pages, so verification is never a surprise after payment |
| 3 | **Monitoring consent** | Trading behavior, device and network signals are analyzed for rule evaluation **and** for fraud and abuse detection | The dual purpose must be explicit. Folding the fraud purpose into "providing the service" is the gap that makes a later enforcement contestable |
| 4 | **Copy trading and account management** | Same-identity copying across one's own Merit accounts is permitted. **Cross-identity copying, third-party signal and copy services, and account management by another person are prohibited** | The batch 1 copy-trading ruling. This is the clause D-01 was waiting for |
| 5 | **Enforcement process** | What Merit may do on a confirmed violation, in what order, with what notice, and what the trader's route of response is | **A process clause protects Merit more than a discretion clause does.** "Decisions are final" language is explicitly rejected: it is false (a human can reverse) and it is what a wronged trader screenshots |
| 6 | **Eligibility representation** | The trader represents they have **no outstanding balances or unresolved disputes with other proprietary trading firms** | **Lucid-style.** A cheap, self-executing filter against operators cycling between firms, and it makes a later discovery a breach of representation rather than an argument about house rules |
| 7 | **Wallet terms** | The wallet is a **payable balance**. It bears **no interest**, permits **no peer-to-peer transfer**, and **accepts no deposits** (`INV-WALLET-NO-DEPOSITS`). Funds originate only from payouts, promotional credit, and refunds | [ADR-019](../DECISIONS.md), [M20](../plans/M20-wallet.md). The no-deposit property is what the payable framing rests on, so it is a term and not only an implementation detail |
| 8 | **Dormancy and unclaimed balances** | Notice schedule from 12 months of inactivity, and a statement that Merit never keeps a balance | [OQ-M20-04](../DECISIONS.md). Escheatment mapping is counsel packet item 3 |

## What must not appear

- **"Decisions are final."** See clause 5.
- **Any live-program or funded-capital representation.** [OQ-M18-01](../DECISIONS.md): no live program exists at launch and no copy is written until counsel rules.
- **Any rule Merit does not implement.** The publish-time validation ([M01](../plans/M01-rules-engine.md) PW-01 to PW-04) exists to catch the reverse case; this is the same discipline applied to prose.

## Norm positioning, recorded so counsel can calibrate

Merit's planned scope **sits at or below the published practice** of Tradeify, Topstep, and Blue Guardian. The aggressive end of the norm is Blue Guardian's stack: continuous document monitoring, provider-final decisions, and a 7-day funded-inactivity rule. Merit adopts none of those three. The point of recording it is that **Merit's clauses are not novel**, which is the useful fact when a clause is challenged as overreach.
