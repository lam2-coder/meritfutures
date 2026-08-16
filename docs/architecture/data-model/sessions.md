### sessions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `user_id` | uuid | fk users, not null, on delete restrict | |
| `refresh_token_hash` | bytea | not null, unique | rotation on every refresh; the hash, never the token |
| `issued_at` | timestamptz | not null default now() | |
| `expires_at` | timestamptz | not null | short-lived access, rotating refresh |
| `revoked_at` | timestamptz | null | logout, re-auth, admin action |
| `ip` | inet | null | |
| `user_agent` | text | null | |
| `device_fingerprint_id` | uuid | fk identity_signals, null, on delete restrict | ties a session to the entity graph |
| `created_ip` | inet | null | **`SD-M4-03`** |
| `created_user_agent` | text | null | **`SD-M4-03`** |
| `last_seen_at` | timestamptz | null | **`SD-M4-03`** |
| `last_seen_ip` | inet | null | **`SD-M4-03`** |
| `created_at` | timestamptz | not null default now() | |

Indexes: `sessions_user_idx (user_id)`; `sessions_live_idx (user_id, expires_at desc)` where `revoked_at is null`.
Retention: 90 days after expiry.
Why the four `SD-M4-03` columns are four and not two: account takeover leading to payout redirection is the highest-value attack on a trader account ([SECURITY section 2.6](../SECURITY.md)). The trader-visible active-sessions list, single-session revocation, and the anomaly signal that a session **moved country mid-life** (AS-M4-05) all need them, and the last is only expressible if the creation values and the last-seen values are separate columns rather than one overwritten pair.
