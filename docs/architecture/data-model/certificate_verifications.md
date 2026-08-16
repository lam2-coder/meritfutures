### certificate_verifications
**`SD-M11-04`**, AS-M11-04. Reserved.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `code_hash` | bytea | not null | **hashed.** Storing the attempted codes in the clear would make this table a list of valid tokens for anyone who reached it |
| `result` | text | not null, check in (`valid`,`unknown`,`revoked`,`deferred`) | |
| `ip_hash` | bytea | null | |
| `user_agent_class` | text | null | a class, never the string |
| `verified_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `certificate_verifications_time_idx (verified_at desc)`; `certificate_verifications_unknown_idx (verified_at, ip_hash)` where `result = 'unknown'`.
Retention: 90 days.
The verify endpoint is the only public oracle Merit operates about its own payout book, and an enumeration campaign against it is invisible without this table. **The rate of `unknown` is itself the signal**: a verifier looking up codes they were given resolves them, and a verifier guessing codes does not, so a rising unknown rate is an enumeration campaign in progress rather than a usability problem.
