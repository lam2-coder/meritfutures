### coupon_redemptions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `coupon_id` | uuid | fk coupons, not null, on delete restrict | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | limits are per identity, not per email |
| `purchase_id` | uuid | fk purchases, null, on delete restrict | null while the claim is held and the payment is in flight |
| `claimed_at` | timestamptz | not null default now() | |
| `released_at` | timestamptz | null | claim released if payment fails. The row survives, so a pattern of claim-and-abandon is visible rather than erased |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `coupon_redemptions_live_claim_uq (coupon_id, identity_id)` where `released_at is null`; `coupon_redemptions_coupon_idx (coupon_id)`.
This table is why two tabs cannot both win a single-use code: the claim insert is the race, and the partial unique index decides it (B4 #11). Limits above 1 are checked transactionally against `redemption_count` in the same statement.
