### plans
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `code` | text | not null, unique | `core_eod`, `merit_rapid`, `direct` (renamed from `rapid_daily` at the M1 gate, [ADR-013](../../decisions/ADR-013.md)). The old code is not carried forward: no row exists to migrate, and a retired alias is a second name for one thing |
| `name` | text | not null | display |
| `is_active` | boolean | not null default true | delisting never deletes. A plan nobody can buy still has to explain the accounts sold under it |
| `sort_order` | integer | not null default 0 | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique on `(code)` (inline).
Retention: forever.
