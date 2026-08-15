### affiliate_commissions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `attribution_id` | uuid | fk attributions, not null, on delete restrict | |
| `amount_cents` | bigint | not null, check `<> 0` | **signed**: a clawback row is negative. The clawback is a compensating row, never an update to the original, for the same reason a ledger reversal is |
| `status` | text | not null default `accrued`, check in (`accrued`,`payable`,`paid`,`clawed_back`) | |
| `payable_after` | date | not null | the **refund** window. Merit's own clock |
| `chargeback_window_ends_on` | date | not null | **`SD-M8-01`.** The second clock, and it is the card networks' rather than ours |
| `clawback_of` | uuid | fk affiliate_commissions, null, on delete restrict | **`SD-M8-01`.** Null on an accrual |
| `paid_in_statement_id` | uuid | fk affiliate_statements, null, on delete restrict | **`SD-M8-01`.** Makes "when did we pay this, and on what statement" a lookup rather than a reconstruction |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `affiliate_commissions_attribution_idx (attribution_id)`; `affiliate_commissions_statement_idx (paid_in_statement_id)` where not null; `affiliate_commissions_clawback_idx (clawback_of)` where not null; `affiliate_commissions_payable_sweep_idx (chargeback_window_ends_on, payable_after)` where `status = 'accrued'`, which reads **both** clocks and is the whole content of the delta.
Constraints: `affiliate_commissions_chargeback_window_is_later` (if the chargeback window ever closed first, the later clock would be the one that does not bind, which is the defect the delta exists to fix); `affiliate_commissions_clawback_sign` (a clawback is negative and an accrual is positive, which stops a clawback being written as a second accrual); `affiliate_commissions_no_self_clawback`; `affiliate_commissions_paid_has_statement`.
Retention: forever.
Why two clocks (AS-M8-01): chargebacks arrive months after the sale, on the card networks' clock. Paying commission on `payable_after` alone pays it long before the sale is final, and the money is then in someone else's bank account when the chargeback lands.
