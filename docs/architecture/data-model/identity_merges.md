### identity_merges
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `surviving_identity_id` | uuid | fk identities, not null, on delete restrict | |
| `merged_identity_id` | uuid | fk identities, not null, on delete restrict | |
| `reason` | text | not null | |
| `evidence` | jsonb | not null | |
| `accounts_at_merge` | integer | not null, check >= 0 | supports the B4 #17 grandfather policy: over-cap after merge is grandfathered, new purchases blocked. Recording the count **at merge time** is what makes the policy applicable years later, when the account count has moved for unrelated reasons |
| `actor` | text | not null | admin or detector |
| `created_at` | timestamptz | not null default now() | |

Indexes: `identity_merges_surviving_idx (surviving_identity_id)`; `identity_merges_merged_idx (merged_identity_id)`.
Constraints: `identity_merges_distinct` (an identity cannot be merged into itself).
Append-only. Merging never deletes the merged identity row; it repoints ownership and records this row, because the pre-merge history is what a dispute about a grandfathered cap is argued from.
