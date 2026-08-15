### price_floors
**`SD-M17-02`**, INV-M17-05, INV-M17-12. Set through the dual-controlled publish path (`0016`'s `dual_control_approvals`).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `product_ref` | text | not null, pk part | |
| `floor_cents` | bigint | not null, check >= 0 | |
| `reason` | text | **not null** | for a Direct plan this is a liability decision, and a liability decision with no written rationale is one nobody can defend at the next review |
| `effective_from` | timestamptz | not null, pk part | |
| `approved_by` | text | **not null** | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(product_ref, effective_from)`.
Indexes: `price_floors_current_idx (product_ref, effective_from desc)`.
Why it exists: stacking arithmetic needs a hard stop that is **not** "the sum of the discounts we happened to configure". A Direct account is funded on purchase, so its price is the only thing standing between the firm and immediate exposure.
