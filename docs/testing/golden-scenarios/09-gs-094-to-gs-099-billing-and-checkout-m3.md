## 9. GS-094 to GS-099: billing and checkout (M3)

Defined by [M03](../../plans/M03-billing-checkout.md) section 8.2. The B4 commerce battery (GS-038 to GS-041, GS-046) is shared and stays where it is.

| ID | Name | Pins |
|---|---|---|
| GS-094 | Account cap enforced per identity, not per email | Two emails resolving to one identity, cap of 10: the eleventh purchase is refused with `account_cap_reached`. Asserts constitution B1's binding identity rule at the one endpoint where getting it wrong costs money and creates a fleet |
| GS-095 | Failover never retries a purchase at the second MID | A slow PSP-A session that later succeeds produces exactly one charge and one account, and the double-charge fingerprint alarm fires on two `paid` purchases for the same plan and size inside five minutes. Asserts failover is per-attempt routing and never mid-transaction. AS-M3-02 |
| GS-096 | Chargeback lands after a settled payout | Account closes, identity flagged, compensating reversal posted, identity nets negative and the ledger says so. The settled payout is **not** clawed back. Extends GS-039 with the deliberate version of the attack. AS-M3-03 |
| GS-097 | Coupon restricted by purchase kind | A `new`-only code is refused on a reset with `conflict`, and a coupon with no `applies_to_kind` cannot be created at all. Asserts that a leaked launch code cannot silently reprice resets forever. AS-M3-04 |
| GS-098 | Reset onto a changed plan version renders the rule diff | Parent account on v1, current published version is v3 with a lower cap: the reset flow renders the changed rules from `copy_blocks` and refuses payment without explicit acknowledgement. Asserts that the one place a trader can be surprised by a rule change is the one place the diff is mandatory. AS-M3-05 |
| GS-099 | Webhook citing an unknown purchase reference | Rejected and alarmed; no purchase row and no account created. Asserts that a `purchases` row Merit itself wrote is a precondition for any paid state, so a forged or replayed event cannot mint a funded account. AS-M3-06 |
