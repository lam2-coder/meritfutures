### sanctions_screenings
**`SD-M19-02`**, INV-M19-05, AS-M19-04. Its own object rather than a value in `kyc_verifications.rejection_reason`, because folding it in would put a legally mandatory refusal in the same field as a blurry-photo rejection. They are not the same kind of fact and they do not get the same review path.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `provider` | text | not null | |
| `list_refs` | text[] | not null default `'{}'` | which lists were screened |
| `match_strength` | integer | null, check between 0 and 10000 | basis points, like every other confidence in this schema |
| `status` | text | not null, check in (`clear`,`possible_match`,`confirmed_match`,`cleared_on_review`) | `cleared_on_review` is a distinct terminal state from `clear` on purpose: "we looked and it was not them" is a different fact from "nothing matched", and only the first needs a reviewer's name attached |
| `reviewed_by` | text | null | |
| `reviewed_at` | timestamptz | null | |
| `review_note` | text | null | |
| `screened_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `sanctions_screenings_identity_idx (identity_id, screened_at desc)`; `sanctions_screenings_open_idx (screened_at)` where `status = 'possible_match' and reviewed_at is null`, which is the action queue.
Constraints: `sanctions_screenings_review_has_author` (a review outcome with no reviewer is not a review).
Retention: forever (AML obligation).
