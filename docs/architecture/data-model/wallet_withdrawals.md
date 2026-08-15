### wallet_withdrawals
**`SD-M5-06`**, **`SD-M20-03`**. The external leg as its own object.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `amount_cents` | bigint | not null, check > 0 | |
| `destination_ref` | text | not null | provider-side destination id, never bank details |
| `status` | `wallet_withdrawal_status` enum(`requested`,`cooling`,`approved`,**`transferring`**,`settled`,`failed`,`cancelled`) | not null default `requested` | this table **owns** `transferring` ([ADR-028](../../decisions/ADR-028.md)), along with `cooling` and `cancelled`, which the internal leg has no use for at all |
| `idempotency_key` | text | not null | |
| `requested_at` | timestamptz | not null default now() | |
| `settled_at` | timestamptz | null | |
| `frozen_at`, `freeze_flag_id`, `freeze_expires_at` | timestamptz, uuid fk risk_flags, timestamptz | null | **`SD-M5-06`**, the same freeze clock as `payout_requests` and for the same reason: the zero-denial policy must not permit itself an indefinite hold on either leg |
| `destination_name_match` | boolean | null | **`SD-M5-06`** |
| `name_match_score` | integer | null, check between 0 and 10000 | **`SD-M5-06`.** This is where the destination name actually gets compared, because this is the leg with a destination |
| `name_match_method`, `name_match_reviewed_by` | text | null | **`SD-M5-06`** |
| `source_provenance_summary` | jsonb | not null default `'{}'` | **`SD-M20-03`.** The provenance rule cannot be evaluated against a balance, only against a **composition**: a wallet holding $500 of settled payout and $99 of `refund_wallet_funded` is not the same object as one holding $599 of payout, and only the second is fully withdrawable on the day it arrives |
| `earliest_credit_at` | timestamptz | null | **`SD-M20-03`.** The chargeback-window hold's input. A refund credit three days old is still inside the window in which the funding purchase can be charged back, and paying it out is how a wallet becomes a cash-out rail for a stolen card |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `wallet_withdrawals_identity_idempotency_uq (identity_id, idempotency_key)`; `wallet_withdrawals_identity_idx (identity_id, requested_at desc)`; `wallet_withdrawals_open_idx (status, requested_at)` where in flight; `wallet_withdrawals_freeze_expiry_idx (freeze_expires_at)` where not null.
Constraints: `wallet_withdrawals_freeze_is_complete`; `wallet_withdrawals_score_has_method`; `wallet_withdrawals_settled_has_timestamp`; `wallet_withdrawals_approved_has_provenance` (before approval the summary may still be empty; after it, never).
Retention: forever.
Why it is not a payout request: a payout request is a claim against an **account** evaluated by the engine; a withdrawal is a movement of an **already-settled balance** evaluated against KYC and destination rules.
