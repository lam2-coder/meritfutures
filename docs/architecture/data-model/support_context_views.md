### support_context_views
**`SD-M10-03`**, INV-M10-05, AS-M10-01.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `agent_ref` | text | not null | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `fields_returned` | text[] | not null | **what was returned**, not what was requested. A view that logs the request cannot answer what the agent actually saw |
| `conversation_ref` | text | null | |
| `viewed_at` | timestamptz | not null default now() | |
| `ip_hash` | bytea | null | hashed rather than raw: this is an audit of Merit's own staff, and the audit should not itself become a second store of personal data about them |
| `created_at` | timestamptz | not null default now() | |

Indexes: `support_context_views_identity_idx (identity_id, viewed_at desc)`; `support_context_views_agent_idx (agent_ref, viewed_at desc)`.
Social engineering through support is item 9 in the adversary dossier, and a support agent reading the identity graph is a privileged read happening **outside** the admin origin's IP allowlist and hardware-key SSO. An unaudited support surface is an unmonitored back door into the crown jewel.

**Notifications and community (`0019`).** Two modules share the file because they are the same surface seen twice: everything Merit says to a trader, and everything Merit says about a trader in public.
