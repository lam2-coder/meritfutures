### idempotency_keys
| Column | Type | Constraints | Why |
|---|---|---|---|
| `key` | text | pk | scoped by endpoint prefix |
| `identity_id` | uuid | fk identities, null, on delete restrict | |
| `endpoint` | text | not null | |
| `request_hash` | bytea | not null | the same key with a different body is a client bug and returns 409. Not a new request, and not a silent overwrite of the first: those are the two ways an idempotency layer becomes a duplicate-payment machine |
| `response_status` | integer | null | |
| `response_body` | jsonb | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `idempotency_keys_created_idx (created_at)`; `idempotency_keys_identity_idx (identity_id)` where not null.
Retention: 30 days. Replaying a key returns the stored response verbatim.

**Integrations (`0018`).** Not a money-path file. It is a **disclosure**-path file, and the three tables answer three questions asked under pressure: what are we sending this vendor, what did we send about this person, and who at support looked at this identity. One outbound bus and one field-allowlist contract per vendor, so "what did we tell that vendor about this trader" has exactly one answer.
