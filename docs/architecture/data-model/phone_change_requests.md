### phone_change_requests
**`SD-M19-06`**, [ADR-039](../../decisions/ADR-039.md) (c) and (d). Created by [`0029_phone_identity_and_auth`](../../../packages/db/migrations/0029_phone_identity_and_auth.sql).

**The D4 ceremony as state**, so the controls are a precondition of the write rather than steps a handler is trusted to have taken. The attack this refuses is: take the number, change the number, drain the wallet.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `state` | text | not null default `pending`, check in (`pending`,`dual_channel_verified`,`applied`,`cancelled`) | the machine [STATE_MACHINES](../STATE_MACHINES.md) draws |
| `old_phone_id` | uuid | fk identity_phones, **not null**, on delete restrict | a change request with no prior phone is not a change, it is a registration, and registration writes [`identity_phones`](identity_phones.md) directly |
| `new_phone_hash` | bytea | not null | the proposed number, hashed. Its `identity_phones` row is written when the request **applies**, not when it is opened, so an abandoned request leaves no half-verified phone behind |
| `dual_channel_verified_at` | timestamptz | null | (d). **Never SMS alone.** A passkey assertion or a second independent channel confirmed the change |
| `prior_notified_at` | timestamptz | null | `INV-M16-03` on a prior **number**, which `SD-M16-06` is what makes possible. One timestamp for both legs because (c) requires both, and a change that notified one of them has not satisfied it |
| `withdrawal_hold_until` | timestamptz | null | the external-withdrawal hold, read by the payout and wallet-withdrawal paths, which refuse an external leg while it is in the future |
| `applied_at` | timestamptz | null | |
| `cancelled_at` | timestamptz | null | |
| `cancelled_reason` | text | null | an unexplained cancellation on a control this shape is indistinguishable from an attacker abandoning a probe |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `phone_change_requests_open_per_identity_uq (identity_id)` where `state in ('pending','dual_channel_verified')`; `phone_change_requests_live_hold_idx (identity_id, withdrawal_hold_until)` where not null, which is the read every external-withdrawal path makes before it moves money; `phone_change_requests_old_phone_idx (old_phone_id)`.
Constraints: **`phone_change_requests_applied_is_complete`**; `phone_change_requests_state_matches_applied`; `phone_change_requests_state_matches_cancelled`; `phone_change_requests_verified_state_is_earned`; `phone_change_requests_cancellation_is_explained`.
Retention: forever (security record).

**`phone_change_requests_applied_is_complete` is (c), and it is the SIM-swap control.** A request may not reach `applied` unless dual-channel verification happened, the prior contact was notified, and a withdrawal hold is set **and still running at the moment it applies**. Three D4 controls become a precondition of the write.

**The duration is not in the database, and that is deliberate.** 48 hours is a launch parameter the config owns, and [ADR-037](../../decisions/ADR-037.md) rules that a shorthand may not restate a value the config owns. What the constraint asserts is the **ordering**, which is the part a config cannot get wrong: `withdrawal_hold_until > applied_at`. **A hold that expired before the change landed is not a hold.**

**At most one open request per identity.** A second open request is not a second ceremony, it is a way to run two holds and pick the shorter one.
