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
| `auth_factor` | text | not null, check in (`passkey`,`email_otp`,`sms_otp`) | **`SD-M4-04`**, C-27. How the session was established. **No default:** defaulting this would over-grant, and a session with no recorded factor is one no handler can refuse |
| `elevated_at` | timestamptz | null | **`SD-M4-04`.** Elevation **raises** an existing session rather than re-establishing it |
| `elevated_by_factor` | text | null, check in (`passkey`,`dual_channel`) | **`SD-M4-04`. This check list is C-27** |
| `created_at` | timestamptz | not null default now() | |

Indexes: `sessions_user_idx (user_id)`; `sessions_live_idx (user_id, expires_at desc)` where `revoked_at is null`.
Constraints: `sessions_elevation_is_complete`.
Retention: 90 days after expiry.
**Why `SD-M4-04` exists: C-27 is unenforceable without it** ([ADR-039](../../decisions/ADR-039.md) amendment 4). Any single factor establishes a session sufficient for **every read surface**. No single factor, and **specifically never SMS alone**, is sufficient for a sensitive action: payout destination change, contact change of either kind, external withdrawal. Each requires a passkey assertion or a dual-channel confirmation, which **elevates** the session. A handler cannot refuse an SMS-established session for a sensitive action if the session never recorded how it was established, and an emergent property of two rules is not enforceable.

**`elevated_by_factor`'s check list is the enforcement, not a handler.** It holds `passkey` and `dual_channel` and nothing else. There is no `sms_otp` and no `email_otp`, so a session established by either **cannot elevate itself at all**: the database has no value for the thing such a handler would have to write. **A SIM-swapped session can see everything and change nothing**, and that is a vocabulary rather than a rule somebody remembers.

**There is deliberately no `elevation_expires_at`.** The elevation window is a launch parameter the config owns ([ADR-037](../../decisions/ADR-037.md)), evaluated against `elevated_at` at the moment of the sensitive action. A stored expiry would be a second copy of a config value **and** would create an expiry column with no release job, which is the class `CI-06l` exists to catch.

Why the four `SD-M4-03` columns are four and not two: account takeover leading to payout redirection is the highest-value attack on a trader account ([SECURITY section 2.6](../SECURITY.md)). The trader-visible active-sessions list, single-session revocation, and the anomaly signal that a session **moved country mid-life** (AS-M4-05) all need them, and the last is only expressible if the creation values and the last-seen values are separate columns rather than one overwritten pair.
