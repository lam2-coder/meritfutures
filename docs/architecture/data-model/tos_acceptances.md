### tos_acceptances
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `tos_version_id` | uuid | fk tos_versions, not null, on delete restrict | |
| `accepted_at` | timestamptz | not null default now() | |
| `ip` | inet | not null | |
| `user_agent` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `tos_acceptances_identity_version_uq (identity_id, tos_version_id)`.
Append-only. Retention: forever.
This is the row that proves what a trader agreed to and when, which is the first thing any enforcement dispute asks for.
