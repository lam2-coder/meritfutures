### identity_links
Graph edges between identities, produced by resolution and by detectors. Append-only except for the dispute columns.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_a` | uuid | fk identities, not null, on delete restrict | |
| `identity_b` | uuid | fk identities, not null, on delete restrict | |
| `link_kind` | text | not null | `shared_device`, `shared_payment`, `biometric_match`, `behavioural_correlation` |
| `confidence_bp` | integer | not null, check between 0 and 10000 | evidence strength, never a boolean. [ADR-022](../../decisions/ADR-022.md) made the graph **scored**: hard links auto-enforce, soft clusters queue a pre-funding review, and a boolean edge cannot carry that distinction |
| `evidence` | jsonb | not null | the specific observations behind the edge. An edge without its evidence is an accusation without a reason |
| `created_by` | text | not null | detector name or `admin` |
| `created_at` | timestamptz | not null default now() | |
| `disputed_at` | timestamptz | null | **`SD-M7-04`** |
| `dispute_note` | text | null | **`SD-M7-04`** |
| `suppressed` | boolean | not null default false | **`SD-M7-04`.** The operative field: a suppressed edge stays visible as history and stops contributing to enforcement |
| `suppressed_by` | text | null | **`SD-M7-04`** |

Indexes: unique `identity_links_edge_uq (identity_a, identity_b, link_kind)`; `identity_links_a_idx (identity_a)`; `identity_links_b_idx (identity_b)`; `identity_links_live_idx (identity_a, identity_b)` where `not suppressed`, which is the enforcement read path.
Constraints: `identity_links_canonical_order` (`identity_a < identity_b`, so an edge is stored once and cannot answer differently depending on argument order); `identity_links_suppression_has_author` (a suppression with no author is a suppression nobody owns).
Append-only, and `suppressed` is one of the two ruled single-column exceptions in §17: the `UPDATE` is performed by a `SECURITY DEFINER` function that arrives with M07, never by the application role.
Why the dispute path exists at all (INV-M7-09): two housemates, a married couple sharing a card, and a father funding a son's evaluation all produce **genuine** edges between **genuinely different** humans. Without a dispute path the graph's errors are permanent and invisible to the person they harm, and [ADR-022](../../decisions/ADR-022.md)'s soft-link queue makes the wrongly-linked-but-legitimate population larger, not smaller. The edge is never deleted, because "we decided this edge was wrong" is itself evidence.
