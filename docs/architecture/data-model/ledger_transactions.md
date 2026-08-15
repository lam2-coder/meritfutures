### ledger_transactions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `kind` | text | not null | `purchase`, `payout_approval`, `payout_settlement`, `chargeback_reversal`, `adjustment`, `affiliate_commission` |
| `reference_kind` | text | not null | what caused it |
| `reference_id` | uuid | not null | |
| `idempotency_key` | text | not null, unique | |
| `reversal_of` | uuid | fk ledger_transactions, null | **`SD-M5-05`.** Corrections are compensating entries, never updates. Without the link a reversal is a transaction that happens to be equal and opposite, and reconstructing which reversal answered which original becomes archaeology at exactly the moment (a chargeback dispute, an audit) when it must be instant |
| `posted_at` | timestamptz | not null default now() | |

Indexes: unique on `(idempotency_key)` (inline); `ledger_transactions_reversal_of_idx (reversal_of)` where not null; `ledger_transactions_reference_idx (reference_kind, reference_id)`.
Constraints: `ledger_transactions_no_self_reversal`. A reversal may not reverse itself, and a reversal of a reversal is an adjustment and should be posted as one.
Append-only. Retention: forever.
**Deviation from §1 recorded rather than smoothed:** this table carries `posted_at` and no `created_at`. Posting time is the fact; a second creation timestamp would be a second answer to the same question.
