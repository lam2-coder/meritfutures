### promotional_credit_grants
**`SD-M17-03`**, INV-M17-08, INV-M17-11.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `amount_cents` | bigint | not null, check > 0 | |
| `source_offer_id` | uuid | fk offers, null, on delete restrict | |
| `funding_purchase_id` | uuid | fk purchases, null, on delete restrict | **the delta's real content.** A credit needs to know what funded it, or a chargeback cannot claw back the credit it paid for (AS-M17-06): the purchase reverses, the credit stays, and the trader spends money the firm never received |
| `expires_at` | timestamptz | **not null** | promotional credit expires; that is what distinguishes it from a payable. An unexpiring promotional balance is a liability wearing a marketing label, and it is also an escheatment question nobody wants |
| `consumed_cents` | bigint | not null default 0, check >= 0 | |
| `revoked_at` | timestamptz | null | |
| `revoked_reason` | text | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `promotional_credit_grants_identity_idx (identity_id, expires_at)`; `promotional_credit_grants_funding_idx (funding_purchase_id)` where not null (the query a chargeback runs); `promotional_credit_grants_live_idx (identity_id, expires_at)` where `revoked_at is null and consumed_cents < amount_cents`.
Constraints: `promotional_credit_grants_consumed_within_amount`; `promotional_credit_grants_revocation_is_explained`.
**Never withdrawable** (OQ-FREEZE-01, which overruled [ADR-025](../../decisions/ADR-025.md)'s literal wording and confirmed the implementation). Promotional credit is rendered inside the wallet screen and is **not** wallet value: it has its own ledger class (`promotional_credit`, `0009`) and no `wallet_entries.provenance` value (`0011`). The ledger records the money; this table records the entitlement's provenance and expiry.
