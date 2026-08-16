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
| `new_phone_ciphertext` | bytea | null | **`ADR-046`.** The proposed number, envelope-encrypted. The trader typed it when the request was opened; the confirmation to it is sent after the hold, by a job that no longer has the request in front of it |
| `new_phone_key_id` | text | null | which key sealed it |
| `new_phone_encrypted_at` | timestamptz | null | when |
| `dual_channel_verified_at` | timestamptz | null | (d). **Never SMS alone.** A passkey assertion or a second independent channel confirmed the change |
| `prior_notified_at` | timestamptz | null | `INV-M16-03` on a prior **number**, which `SD-M16-06` is what makes possible. One timestamp for both legs because (c) requires both, and a change that notified one of them has not satisfied it. **Since [ADR-046](../../decisions/ADR-046.md) it may not be set without citing both legs**, which is [`EC-146`](../../edge-cases/EC-146.md) made structural |
| `prior_notified_sms_dispatch_id` | uuid | fk integration_dispatches, null, on delete restrict | **`ADR-046`, `EC-146`, `GS-265`.** The dispatch that carried the notice to the prior number. It is an `integration_dispatches` row and **cannot** be a `notifications` row: `notifications.channel` is (`in_app`,`email`,`push`) and `0029` declined to widen it |
| `prior_notified_email_notification_id` | uuid | fk notifications, null, on delete restrict | the email leg. **`ON DELETE RESTRICT` means a cited notification can never be deleted**, which is correct because it is evidence, and which collides with any future retention sweep on `notifications` |
| `withdrawal_hold_until` | timestamptz | null | the external-withdrawal hold, read by the payout and wallet-withdrawal paths, which refuse an external leg while it is in the future |
| `applied_at` | timestamptz | null | |
| `cancelled_at` | timestamptz | null | |
| `cancelled_reason` | text | null | an unexplained cancellation on a control this shape is indistinguishable from an attacker abandoning a probe |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `phone_change_requests_open_per_identity_uq (identity_id)` where `state in ('pending','dual_channel_verified')`; `phone_change_requests_live_hold_idx (identity_id, withdrawal_hold_until)` where not null, which is the read every external-withdrawal path makes before it moves money; `phone_change_requests_old_phone_idx (old_phone_id)`; `phone_change_requests_key_rotation_idx (new_phone_key_id)` where `new_phone_ciphertext is not null`.
Constraints: **`phone_change_requests_applied_is_complete`**; `phone_change_requests_state_matches_applied`; `phone_change_requests_state_matches_cancelled`; `phone_change_requests_verified_state_is_earned`; `phone_change_requests_cancellation_is_explained`; **`phone_change_requests_prior_notice_is_evidenced`**; `phone_change_requests_ciphertext_is_complete`; **`phone_change_requests_ciphertext_refuses_plaintext`**; foreign keys `phone_change_requests_prior_sms_dispatch_fk` and `phone_change_requests_prior_email_notification_fk`, **named rather than generated**, on `0029`'s own lesson about `contact_channels_kind_check`.
Triggers: `phone_change_requests_evidence_is_this_identitys`, which asserts that both cited evidence rows belong to the same identity as the request ([ADR-046](../../decisions/ADR-046.md)).
Retention: forever (security record).

**`phone_change_requests_applied_is_complete` is (c), and it is the SIM-swap control.** A request may not reach `applied` unless dual-channel verification happened, the prior contact was notified, and a withdrawal hold is set **and still running at the moment it applies**. Three D4 controls become a precondition of the write.

**The duration is not in the database, and that is deliberate.** 48 hours is a launch parameter the config owns, and [ADR-037](../../decisions/ADR-037.md) rules that a shorthand may not restate a value the config owns. What the constraint asserts is the **ordering**, which is the part a config cannot get wrong: `withdrawal_hold_until > applied_at`. **A hold that expired before the change landed is not a hold.**

**At most one open request per identity.** A second open request is not a second ceremony, it is a way to run two holds and pick the shorter one.

**`prior_notified_at` was storage-enforceable and not send-enforceable, and [ADR-046](../../decisions/ADR-046.md) is the difference.** `phone_change_requests_applied_is_complete` made the timestamp a precondition of reaching `applied`, and **a database can only assert that a timestamp exists**: a handler with no address and a column it must fill will fill it, the constraint passes, and the anti-takeover control reads as enforced in every document and in every test that inspects the row while nothing has left the building. That is [`EC-146`](../../edge-cases/EC-146.md), and `GS-265` is written to fail against the timestamp alone.

**So the timestamp is now a citation rather than a claim.** `phone_change_requests_prior_notice_is_evidenced` refuses a `prior_notified_at` that does not name both legs. **The `CHECK` is one-directional on purpose**: evidence with no claim is permitted, because the two legs do not land in the same instant and a biconditional would force a handler that has sent one to discard the citation it holds or assert a notification it has not made.

**`phone_change_requests_ciphertext_refuses_plaintext` is `INV-M10-12` as a constraint, and this is the column where a plaintext address is likeliest to arrive.** The trader typed the number into the request, so **the handler that opens this row is the one handler in the corpus holding a number in the clear and a `bytea` column to put it in**; every other sealed column is written by a path that had to fetch the address from somewhere first. The floor is `octet_length(new_phone_ciphertext) >= 29` when not null, and it is **total** here: E.164 is at most 16 bytes and this column holds nothing else. See [`contact_channels`](contact_channels.md) for the arithmetic.

**What it still does not prove.** A foreign key proves a row was cited. The database cannot assert the notice was **addressed to the prior number**, because `integration_dispatches` records `fields_sent` and never values (`INV-M10-03`), so no column anywhere holds a dispatch's destination. The trigger closes the cheap bypass, citing any row at all, and nothing more.
