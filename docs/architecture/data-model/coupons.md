### coupons
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `code` | citext | not null, unique | case-insensitive redemption |
| `discount_kind` | text | not null, check in (`percent`,`fixed`) | |
| `discount_bp` | integer | null, check between 0 and 10000 | set when kind is percent |
| `discount_cents` | bigint | null, check > 0 | set when kind is fixed |
| `affiliate_id` | uuid | fk affiliates, null, on delete restrict | per-affiliate codes |
| `max_redemptions` | integer | null, check > 0 | null means unlimited |
| `redemption_count` | integer | not null default 0, check >= 0 | maintained transactionally |
| `per_identity_limit` | integer | not null default 1, check > 0 | blocks one person farming a code. Per **identity**, not per email: an email limit is a limit on typing, not on people |
| `starts_at`, `expires_at` | timestamptz | null | |
| `is_active` | boolean | not null default true | |
| `applies_to_kind` | text | not null default `any`, check in (`new`,`reset`,`any`) | **`SD-M3-04`.** Reset pricing and new-purchase pricing are different products with different margins. Without this, one leaked launch code discounts resets forever, which is the highest-volume repeat purchase in the business (AS-M3-04). M03 requires the value stated explicitly at creation rather than defaulted, because a default of `any` is exactly the leak; the column default exists only so the constraint is total |
| `first_purchase_only` | boolean | not null default false | **`SD-M3-04`** |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique on `(code)` (inline); `coupons_affiliate_idx (affiliate_id)` where not null.
Constraints: `coupons_one_discount_form` (exactly one discount form, because a coupon that is both is a coupon whose price depends on which branch the code reads first); `coupons_window_ordered`; `coupons_redemptions_within_max`.
Concurrency: redemption is an atomic claim (see `coupon_redemptions`), never a read-then-write. B4 #11.
