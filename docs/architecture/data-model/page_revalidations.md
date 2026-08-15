### page_revalidations
**`SD-M9-03`**, INV-M9-04.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `trigger` | text | not null | `plan_version_published`, `content_published`, and so on |
| `reference_id` | uuid | null | |
| `paths` | text[] | not null | |
| `requested_at` | timestamptz | not null default now() | |
| `completed_at` | timestamptz | null | |
| `status` | text | not null default `pending`, check in (`pending`,`ok`,`failed`) | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `page_revalidations_open_idx (requested_at)` where `status <> 'ok'`, which the publish path waits on and the alarm reads.
Constraints: `page_revalidations_has_paths`; `page_revalidations_settled_has_timestamp`.
Revalidation is part of the publish transaction's **definition of done**, so it needs a row with a completion state. A fire-and-forget invalidation cannot be waited on, retried, or alarmed on, and a stale price page is the one cache miss Merit cannot absorb (AS-M9-01).
