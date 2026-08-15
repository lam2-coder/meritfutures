### passkeys
WebAuthn credentials. Merit is [passwordless only](../../../research/SECURITY_LANDSCAPE.md), so there is no password table anywhere in this schema, by design. Adding one is a security architecture change requiring an ADR, not a convenience.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `user_id` | uuid | fk users, not null, on delete restrict | |
| `credential_id` | bytea | not null, unique | WebAuthn identifier |
| `public_key` | bytea | not null | |
| `sign_count` | bigint | not null default 0, check >= 0 | clone detection: a counter that goes backwards means the credential exists in two places |
| `transports` | text[] | null | |
| `label` | text | null | user-facing device name |
| `last_used_at` | timestamptz | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `passkeys_user_idx (user_id)`.
Retention: for the life of the user record.
