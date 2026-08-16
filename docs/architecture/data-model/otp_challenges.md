### otp_challenges
The one-time-code half of the passwordless flow. **Two channels since [`0029`](../../../packages/db/migrations/0029_phone_identity_and_auth.sql)** (`SD-M16-05`, [ADR-039](../../decisions/ADR-039.md)): email, and SMS.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `channel` | text | not null, check in (`email`,`sms`) | **`SD-M16-05`.** **No default, deliberately.** A `default 'email'` would let a handler that forgot to set the channel on an SMS send write a well-formed email challenge, and the exactly-one-destination check would be the only thing that noticed, which is a constraint doing a type's job |
| `email_normalized` | citext | **null** since `0029` | issued before a user may exist, so this keys off the normalized email rather than a `user_id`. **Relaxed, not dropped** (`SD-M16-05`): an SMS challenge has no email address, and `0002` made it not-null because at the time there was no other kind of challenge |
| `destination_hash` | bytea | null | **`SD-M16-05`.** The SMS destination, hashed. Never the number: an OTP table is not a reason to keep a plaintext copy of every number ever entered, including every number entered by an attacker |
| `code_hash` | bytea | not null | never store the code itself |
| `expires_at` | timestamptz | not null | short TTL (10 minutes) |
| `consumed_at` | timestamptz | null | single use, enforced by partial unique index |
| `attempts` | smallint | not null default 0, check between 0 and 5 | lockout without enabling user enumeration: the counter is on the challenge, not on the account, so a locked-out attacker learns nothing about whether the address exists |
| `request_ip` | inet | null | rate limiting and abuse signal |
| `created_at` | timestamptz | not null default now() | |

Indexes: `otp_challenges_email_created_idx (email_normalized, created_at desc)`; `otp_challenges_destination_created_idx (destination_hash, created_at desc)` where not null, which is the per-number velocity read [`otp_send_budget`](otp_send_budget.md)'s `phone` scope is counted from; unique `otp_challenges_unconsumed_uq (id)` where `consumed_at is null`.
Constraints: `otp_challenges_exactly_one_destination`.
Retention: 30 days.
**Exactly one destination, and it is the one the channel names.** Two destinations on one challenge is a code delivered twice, which halves the work of intercepting it; zero is a challenge nobody can answer.
