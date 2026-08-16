### payment_disputes
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `purchase_id` | uuid | fk purchases, not null, on delete restrict | |
| `kind` | text | not null, check in (`chargeback`,`refund`) | |
| `amount_cents` | bigint | not null, check > 0 | |
| `reason_code` | text | null | |
| `opened_at` | timestamptz | not null default now() | |
| `resolved_at` | timestamptz | null | |
| `outcome` | text | null, check in (`lost`,`won`,`refunded`) | |
| `ledger_transaction_id` | uuid | fk ledger_transactions, null, on delete restrict | the compensating reversal. Corrections are compensating entries, never updates (`SD-M5-05`), and this pointer makes "which reversal answered which dispute" instant at exactly the moment it must be |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `payment_disputes_purchase_idx (purchase_id)`; `payment_disputes_open_idx (opened_at)` where `resolved_at is null`.
Constraints: `payment_disputes_resolved_has_outcome`; `payment_disputes_loss_is_posted` (a dispute Merit lost or refunded moved money and must name the transaction that recorded it; a dispute Merit won moved nothing).
Policy encoded in M03: a chargeback closes the account, flags the identity, and posts a reversal. **Even when the payout already settled and the identity nets negative, the ledger shows the loss honestly** (B4 #10). It does not net, hide, or defer it.
