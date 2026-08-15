## 28. GS-232 to GS-239: the consolidated founder addendum

Added by [ADR-021](../../decisions/ADR-021.md), [ADR-022](../../decisions/ADR-022.md), and [ADR-023](../../decisions/ADR-023.md). Per ADR-022's condition, **each identity-defense tier carries its own scenarios**, so a defense promoted from one tier to the next arrives with the fixture proving it does what the tier above assumed.

| ID | Scenario | Pins |
|---|---|---|
| GS-232 | The composite trigger fires at the earliest reached trigger | An identity configured with `{second_distinct_account, pre_funded}` verifies at the second distinct account purchase and is **not** asked again at evaluation pass. Asserts first-wins semantics and single-verification. [ADR-021](../../decisions/ADR-021.md) |
| GS-233 | `payout_request` never fires as a sole trigger | A config listing only `payout_request` is **rejected at publish**, not silently accepted. Asserts the invalid-alone rule is a validation and not a convention |
| GS-234 | Resets inflate `second_purchase_any` | A trader who resets once and holds one account is captured by `second_purchase_any` and **not** by `second_distinct_account_purchase`. Pins that the two triggers reach different populations, which is the caveat most likely to be forgotten |
| GS-235 | **v1 tier:** a hard link auto-enforces | A biometric dedupe hit and a shared payout destination each enforce without a review step. [ADR-022](../../decisions/ADR-022.md) |
| GS-236 | **v1 tier:** a soft link never auto-enforces | A shared device and IP cluster queues a **pre-funding** review and enforces nothing. Asserts the review is upstream of funding, not upstream of payout |
| GS-237 | **v1.x tier:** the signal-weight table is config, not code | Changing a weight is a config diff that alters cluster scoring with no deployment. Pins the tunability ADR-022 depends on |
| GS-238 | **v1.x tier:** graph explorer packs are audience-scoped | A trader-facing pack generated from a cluster node contains conduct, rule text, and own trades, and **contains no weight, threshold, or detector internal**. The two-tier rule applied to the richest surface that exists |
| GS-239 | Enrichment failure never blocks checkout | The enrichment call times out; in observe mode the purchase completes, and in enforcement mode it **fails open** and completes. Asserts a fraud signal can never become an outage. [ADR-023](../../decisions/ADR-023.md) |

**A numbering collision is corrected here, 2026-08-14.** This block previously claimed GS-206 and GS-207 to GS-209 for the addendum's verification-UX ruling. **Those numbers belong to [M18](../../plans/M18-graduation-track.md)** (the final ladder ordinal, the unresolved correlation signal at graduation, and the vault display), and citing them twice meant two different fixtures answered to one id, which is the failure mode a numbered registry exists to make impossible. The verification-UX scenarios are renumbered to **GS-256 and GS-257**, section 32. The identity-defense tier scenarios are **GS-235 to GS-238** in the table above and were never separately numbered.
