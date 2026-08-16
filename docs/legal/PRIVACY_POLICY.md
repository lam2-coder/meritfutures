---
status: approved
depends_on: [README.md, ../plans/M19-kyc-identity.md, ../plans/M07-risk-abuse.md, ../plans/M03-billing-checkout.md, ../plans/M10-integrations.md, ../plans/M16-notification-center.md, ../decisions/README.md, ../architecture/SECURITY.md]
last_updated: 2026-08-16
---

# Privacy Policy: drafting skeleton

**DRAFT FOR COUNSEL. Not publishable text.** This is a structured statement of **what Merit collects and why**, written so a lawyer can turn it into a policy without first having to interview an engineer. Categories and purposes only; no drafted prose, no representations, no jurisdiction-specific language.

**Three mappings are explicitly flagged as counsel work and are not attempted here:** the **BIPA and state-biometric consent** analysis, the **GDPR lawful-basis** mapping for each category below, and the **telecom-metadata basis** for the telephony category ([ADR-039](../decisions/ADR-039.md)). All three are [counsel packet item 3](../decisions/gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md), as 3b, 3c and [3d](COUNSEL_PACKET.md).

## Structural note on the format

**Adopt Topstep's category structure**, which separates a **Sensitive Personal Information** category from ordinary personal information and enumerates sharing by **category of recipient** rather than by named vendor. Two reasons: the separate sensitive category is what most state privacy statutes key their heightened obligations to, and recipient-category disclosure survives a vendor change without a policy amendment, while still requiring the **biometric provider to be named** (see below).

## Categories collected, with purposes

| Category | Contents | Purpose | Notes |
|---|---|---|---|
| **Identity and KYC** | Name, date of birth, address, government identifier, document images | Verification of identity, sanctions screening, regulatory obligation | **Documents are held by the provider, not by Merit.** Merit retains decisions, scores, and metadata ([M19](../plans/M19-kyc-identity.md)) |
| **Biometric, via provider** | Facial geometry derived from a selfie and a document photo, for liveness and dedupe | Confirming the person is real and present, and detecting one person operating multiple identities | **Sensitive PI. Requires explicit consent.** Provider-side storage is the mitigation and must be described as such. **The provider is named** |
| **Device and network** | Device fingerprints, IP addresses, VPN and datacenter indicators, browser characteristics | Fraud prevention, account-takeover defense, identity linking | Feeds the [link-confidence graph](../plans/M07-risk-abuse.md) |
| **Payment identifiers** | Card fingerprints, BIN, billing address, payout destination references | Processing payments, preventing payment fraud, mule detection | Merit does not store full card numbers; the PSP does |
| **Digital footprint enrichment** | Email and phone presence and age signals, from a third-party enrichment provider | Fraud prevention at checkout ([ADR-023](../decisions/ADR-023.md)) | A **new sub-processor**. Named at selection |
| **Telephone number and telephony metadata** | The number itself, held as a **one-way hash and a non-reconstructable display fragment**, never as the number. Plus, from the same enrichment provider at registration: carrier name and country, **line type**, **portability history**, and digital-footprint presence | **Two purposes and they are stated as two.** The number is collected for **authentication**, which is mandatory at registration ([ADR-039](../decisions/ADR-039.md)). The carrier metadata serves **fraud prevention**, and is disclosed as its own purpose rather than folded into the first | **The lawful basis is not asserted here. This row cites [counsel packet item 3d](COUNSEL_PACKET.md).** The number was not optional, portability history reveals when a person changed carrier, and whether that is a heightened category anywhere is a legal question engineering cannot answer. **No new sub-processor**: the same provider as the row above, at a second call site |
| **Trading behavior analysis** | Fills, daily marks, timing patterns, cross-account correlation | Rule evaluation, abuse detection, behavioral linking | The rule-evaluation purpose is contractual; **the linking purpose is fraud prevention and must be disclosed as its own purpose**, not folded into "providing the service" |
| **Communications and support** | Tickets, messages, notification preferences | Support and service messaging | |

**One engineering question was open underneath the telephony row and it has been answered, which changes what this policy can describe. [ADR-046](../decisions/ADR-046.md), 2026-08-16: the answer is reversible encryption, and the retention description for this category moves with it. The paragraph below is left as it was written so counsel can see the question that was asked.** Merit's contact addresses are stored as one-way hashes rather than as addresses, which is a minimization posture. **Whether that survived contact was [M10](../plans/M10-integrations.md) `OQ-M10-06`, and it did not**: a security notice to a prior address, which is an account-takeover countermeasure Merit intends to run, needs an address it can send to. If the resolution is to hold addresses **reversibly encrypted** rather than not at all, the retention description for this category changes, and it is better for counsel to see the question than to be given a description that moves after the sitting. **That is the resolution.** For three tables, `contact_channels`, `identity_phones` and `phone_change_requests`, Merit now holds the address **reversibly**, envelope-encrypted under a key that lives outside the database and that only the sending path can use. A database dump still yields no usable address, which is the posture the paragraph above describes, but the accurate word for the holding is **encrypted** rather than **hashed**, and a subject-access or erasure request against those three tables now has a value to answer about. **`users.email` was already plaintext and is unchanged**; `otp_challenges.destination_hash` is unchanged and remains one-way.

## Retention, and the carve-out that needs the most care

**Ordinary retention** follows the schedule in [DATA_MODEL](../architecture/data-model/README.md) and ends with account closure plus the applicable statutory tail.

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
| **Communication delivery providers** | Delivering messages Merit has decided to send: email, push, and **SMS**, including one-time codes at registration and login. **The content is Merit's and the provider is a transport** ([M10](../plans/M10-integrations.md) AS-M10-06), which is why this is a delivery category rather than a processing one |
| Infrastructure and analytics providers | Hosting, monitoring, business intelligence |
| Legal and regulatory recipients | Where required |

## Open items for counsel

1. **BIPA and state-biometric consent.** Explicit consent flow, retention schedule, and the destruction obligation. Provider-side storage is the mitigation; whether it is sufficient is a legal question.
2. **GDPR lawful basis per category.** Legitimate interest for fraud prevention is the likely basis and the balancing test needs writing.
3. **The biometric provider is named in this policy at selection time** ([ADR-021](../decisions/ADR-021.md)), which makes provider selection a disclosure event. Confirm whether a change of provider requires notice and, if so, how much.
4. Whether the fraud-prevention retention carve-out needs a stated maximum duration to be defensible.
5. **Telephony metadata**, which is [counsel packet item 3d](COUNSEL_PACKET.md) in full. The basis for enriching a number the person supplied in order to log in, the balancing test where that basis is legitimate interest, whether ePrivacy changes it, and **whether portability history is a heightened category anywhere**. The telephony row above cites this item rather than asserting a basis, deliberately: **a lawful basis written by an engineer is a representation**, and this document's own framing is that it makes none.
