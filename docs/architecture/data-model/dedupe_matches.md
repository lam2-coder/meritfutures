### dedupe_matches
**`SD-M19-04`**, [ADR-029](../../decisions/ADR-029.md), finding C-05. The authoritative hard link.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_a` | uuid | fk identities, not null, on delete restrict | |
| `identity_b` | uuid | fk identities, not null, on delete restrict | |
| `match_strength` | integer | not null, check between 0 and 10000 | |
| `provider_ref` | text | not null | |
| `observed_at` | timestamptz | not null default now() | |
| `disposition` | text | not null default `open`, check in (`open`,`confirmed_same_person`,`distinct_persons`,`inconclusive`) | `open` is first in the list because it is the default, and a disposition list whose first value is a conclusion invites defaulting to one |
| `disposition_note` | text | null | |
| `evidence_snapshot` | jsonb | not null default `'{}'` | the provider's scores, method and timestamps. **Never images.** This is what makes an enforcement survive the provider relationship ending (AS-M19-07), which is the difference between evidence Merit holds and evidence Merit rents |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `dedupe_matches_pair_uq (identity_a, identity_b, provider_ref)`, so a re-screen returning the same pair updates the disposition rather than stacking a second opinion; `dedupe_matches_a_idx`; `dedupe_matches_b_idx`; `dedupe_matches_open_idx (observed_at)` where `disposition = 'open'`, which is both the review queue and the auto-enforcement read path.
Constraints: `dedupe_matches_canonical_order` (`identity_a < identity_b`); `dedupe_matches_resolution_is_explained` (a resolved disposition carries its reasoning, and `inconclusive` counts as resolved because deciding not to decide is a decision).
Retention: forever.
Why it is a table and not a column: a match is a **relationship between two identities**, not a property of one. The approved single column could not express a face matching three identities, and "first match" is not a property of a set. Under [ADR-022](../../decisions/ADR-022.md) a dedupe hit is a hard link that auto-enforces, so two sources that can disagree is an enforcement defect rather than a redundancy.
