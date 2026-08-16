### admin_actions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `actor` | text | not null | |
| `action` | text | not null | |
| `subject_kind` | text | not null | |
| `subject_id` | uuid | not null | |
| `reason` | text | **not null** | **no unexplained admin action, ever.** The `NOT NULL` is the whole control, and it is the first thing any enforcement dispute asks for |
| `before`, `after` | jsonb | not null | so the action is reconstructable without replaying the system that produced it |
| `evidence_refs` | jsonb | not null default `'[]'` | |
| `ip` | inet | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `admin_actions_subject_idx (subject_kind, subject_id, created_at desc)`; `admin_actions_actor_idx (actor, created_at desc)`; `admin_actions_action_idx (action, created_at desc)`.
Append-only. Retention: forever.
Every row also emits an event; this table exists **alongside** `events` rather than instead of it, so the audit query never depends on event-payload shape. The duplication is the point.
