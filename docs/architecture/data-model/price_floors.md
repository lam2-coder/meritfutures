### price_floors
**`SD-M17-02`**, INV-M17-05, INV-M17-12. Set through the dual-controlled publish path (`0016`'s `dual_control_approvals`).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `product_ref` | text | not null, pk part | |
| `floor_cents` | bigint | not null, check >= 0 | |
| `reason` | text | **not null** | for a Direct plan this is a liability decision, and a liability decision with no written rationale is one nobody can defend at the next review |
| `effective_from` | timestamptz | not null, pk part | **AN INSTANT AND NOT A DAY, ruled correct by [ADR-276](../../decisions/ADR-276.md) clause 1**, and Merit's own clock. Configuration by content and an ACT by grain, and the grain is what the primary key is made of: `effective_from` is the sole non-subject member of it with no `version` column beside it, so a floor published in the morning and corrected in the afternoon are two readable rows rather than one collision. Nothing reads this column yet. **No `**Unit:**` marker: `CI-06m` reads that marker on `date` rows only** |
| `approved_by` | text | **not null** | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(product_ref, effective_from)`.
Indexes: `price_floors_current_idx (product_ref, effective_from desc)`.
Why it exists: stacking arithmetic needs a hard stop that is **not** "the sum of the discounts we happened to configure". A Direct account is funded on purchase, so its price is the only thing standing between the firm and immediate exposure.
