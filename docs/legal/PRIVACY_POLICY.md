---
status: review
depends_on: [README.md, ../plans/M19-kyc-identity.md, ../plans/M07-risk-abuse.md, ../plans/M03-billing-checkout.md, ../DECISIONS.md, ../architecture/SECURITY.md]
last_updated: 2026-08-14
---

# Privacy Policy: drafting skeleton

**DRAFT FOR COUNSEL. Not publishable text.** This is a structured statement of **what Merit collects and why**, written so a lawyer can turn it into a policy without first having to interview an engineer. Categories and purposes only; no drafted prose, no representations, no jurisdiction-specific language.

**Two mappings are explicitly flagged as counsel work and are not attempted here:** the **BIPA and state-biometric consent** analysis, and the **GDPR lawful-basis** mapping for each category below. Both are [counsel packet item 3](../DECISIONS.md).

## Structural note on the format

**Adopt Topstep's category structure**, which separates a **Sensitive Personal Information** category from ordinary personal information and enumerates sharing by **category of recipient** rather than by named vendor. Two reasons: the separate sensitive category is what most state privacy statutes key their heightened obligations to, and recipient-category disclosure survives a vendor change without a policy amendment, while still requiring the **biometric provider to be named** (see below).

## Categories collected, with purposes

| Category | Contents | Purpose | Notes |
|---|---|---|---|
| **Identity and KYC** | Name, date of birth, address, government identifier, document images | Verification of identity, sanctions screening, regulatory obligation | **Documents are held by the provider, not by Merit.** Merit retains decisions, scores, and metadata ([M19](../plans/M19-kyc-identity.md)) |
| **Biometric, via provider** | Facial geometry derived from a selfie and a document photo, for liveness and dedupe | Confirming the person is real and present, and detecting one person operating multiple identities | **Sensitive PI. Requires explicit consent.** Provider-side storage is the mitigation and must be described as such. **The provider is named** |
| **Device and network** | Device fingerprints, IP addresses, VPN and datacenter indicators, browser characteristics | Fraud prevention, account-takeover defense, identity linking | Feeds the [link-confidence graph](../plans/M07-risk-abuse.md) |
| **Payment identifiers** | Card fingerprints, BIN, billing address, payout destination references | Processing payments, preventing payment fraud, mule detection | Merit does not store full card numbers; the PSP does |
| **Digital footprint enrichment** | Email and phone presence and age signals, from a third-party enrichment provider | Fraud prevention at checkout ([ADR-023](../DECISIONS.md)) | A **new sub-processor**. Named at selection |
| **Trading behavior analysis** | Fills, daily marks, timing patterns, cross-account correlation | Rule evaluation, abuse detection, behavioral linking | The rule-evaluation purpose is contractual; **the linking purpose is fraud prevention and must be disclosed as its own purpose**, not folded into "providing the service" |
| **Communications and support** | Tickets, messages, notification preferences | Support and service messaging | |

## Retention, and the carve-out that needs the most care

**Ordinary retention** follows the schedule in [DATA_MODEL](../architecture/DATA_MODEL.md) and ends with account closure plus the applicable statutory tail.

**The fraud-prevention carve-out is the exception and it is deliberate.** Banned-identity records **persist past account closure**, because an identity defense that forgets a banned operator when they close their account is not a defense at all. This must be disclosed as an explicit, bounded carve-out with its own purpose statement, not left implied by a general retention clause.

**Precedent to draft against: Tradeify's published language**, which already states a fraud-prevention retention basis for exactly this. Counsel should compare and, where Merit's scope is narrower, say so rather than copying a broader claim.

**What persists is the minimum that makes recognition possible**: the decision, the linking signals, and the reason. Not documents, not images.

## Sharing, by recipient category

| Recipient category | Why |
|---|---|
| Identity verification and biometric providers | Verification and dedupe. **Biometric provider named** |
| **Fraud prevention providers** | Enrichment and screening. Adopt Topstep's practice of disclosing this as its own named sharing category rather than burying it under "service providers" |
| Payment processors and payout rails | Processing purchases and payouts |
| Trading platform providers | Provisioning and market access |
| Infrastructure and analytics providers | Hosting, monitoring, business intelligence |
| Legal and regulatory recipients | Where required |

## Open items for counsel

1. **BIPA and state-biometric consent.** Explicit consent flow, retention schedule, and the destruction obligation. Provider-side storage is the mitigation; whether it is sufficient is a legal question.
2. **GDPR lawful basis per category.** Legitimate interest for fraud prevention is the likely basis and the balancing test needs writing.
3. **The biometric provider is named in this policy at selection time** ([ADR-021](../DECISIONS.md)), which makes provider selection a disclosure event. Confirm whether a change of provider requires notice and, if so, how much.
4. Whether the fraud-prevention retention carve-out needs a stated maximum duration to be defensible.
