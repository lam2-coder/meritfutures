### notification_preferences
| Column | Type | Constraints | Why |
|---|---|---|---|
| `identity_id` | uuid | fk identities, not null, on delete restrict, pk part | |
| `kind` | text | fk notification_kinds, not null, on delete restrict, pk part | |
| `channel` | text | not null, check in (`in_app`,`email`,`push`), pk part | |
| `enabled` | boolean | not null default true | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Primary key: composite `(identity_id, kind, channel)`.
What a preference may silence is decided by `notification_kinds.mutable` and enforced in the send path. A preference row against an immutable kind is permitted to exist and is ignored, because refusing to store it produces a settings screen that lies about what it saved.
