### otp_challenges
The email fallback for the passwordless flow.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `email_normalized` | citext | not null | issued before a user may exist, so this keys off the normalized email rather than a `user_id` |
| `code_hash` | bytea | not null | never store the code itself |
| `expires_at` | timestamptz | not null | short TTL (10 minutes) |
| `consumed_at` | timestamptz | null | single use, enforced by partial unique index |
| `attempts` | smallint | not null default 0, check between 0 and 5 | lockout without enabling user enumeration: the counter is on the challenge, not on the account, so a locked-out attacker learns nothing about whether the address exists |
| `request_ip` | inet | null | rate limiting and abuse signal |
| `created_at` | timestamptz | not null default now() | |

Indexes: `otp_challenges_email_created_idx (email_normalized, created_at desc)`; unique `otp_challenges_unconsumed_uq (id)` where `consumed_at is null`.
Retention: 30 days.
