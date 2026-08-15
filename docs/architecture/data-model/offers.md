### offers
**`SD-M17-01`**, INV-M17-02, INV-M17-03. An offer changes the price of a known thing and may never change the thing.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `offer_type` | text | not null | |
| `scope` | text | not null, check in (`identity`,`segment`,`public`) | |
| `identity_id` | uuid | fk identities, null, on delete restrict | |
| `product_ref` | text | not null | |
| `contents` | jsonb | not null | **stated contents before payment** (ADR-019a). Explicit, never derived at redemption: a bundle whose contents are computed at redemption is a bundle whose contents were not stated |
| `price_cents` | bigint | not null, check >= 0 | |
| `list_price_cents` | bigint | not null, check >= 0 | stored beside `price_cents` so the discount is a **fact** rather than a comparison against a value that may since have moved |
| `currency` | char(3) | not null default `'USD'` | |
| `max_redemptions` | integer | null, check > 0 | |
| `redemptions_used` | integer | not null default 0, check >= 0 | |
| `expires_at` | timestamptz | null | |
| `criteria_version` | integer | null | which loyalty criteria version produced this offer |
| `loyalty_grant_id` | uuid | fk loyalty_benefit_grants, null, on delete restrict | |
| `experiment_arm` | text | null | |
| `experiment_id` | uuid | fk offer_experiments, null, on delete restrict | |
| `created_by` | text | not null | |
| `revoked_at` | timestamptz | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `offers_identity_idx (identity_id, expires_at)` where not null; `offers_live_idx (product_ref, expires_at)` where `revoked_at is null`; `offers_experiment_idx (experiment_id)` where not null; unique `offers_loyalty_grant_uq (loyalty_grant_id)` where not null.
Constraints: `offers_identity_scope_matches`; `offers_price_within_list` (an offer may discount and may not mark up: a price above list is not an offer, it is a different product wearing one's clothes); `offers_redemptions_within_max`; `offers_arm_has_experiment`.
The unique on `loyalty_grant_id` and the grant's own single-spend guarantee (`0023`) are the two halves of "a benefit cannot be spent twice".
