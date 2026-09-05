### wallet_entries
**`SD-M20-01`**, INV-M20-03, INV-M20-04. Append-only.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `direction` | text | not null, check in (`credit`,`debit`) | |
| `amount_cents` | bigint | not null, check > 0 | magnitude, always positive; `direction` carries the sign. Deliberately **not** the ledger's signed convention: the ledger's sign means debit or credit against a chart of accounts, and reusing one convention for two different questions is the shape of error [ADR-027](../../decisions/ADR-027.md) was reversed over |
| `provenance` | text | null, **required on a credit** and null-or-`correction` on a debit (`wallet_entries_provenance_follows_direction`, `0080`), check in (`payout`,`refund_wallet_funded`,`correction`) | **the closed list.** The ledger records the money; this records **what kind of money it is**. **The column stopped being `NOT NULL` in [`0080`](../../../packages/db/migrations/0080_wallet_debit_provenance.sql) ([ADR-322](../../decisions/ADR-322.md)) and the requirement did not go away, it became conditional on `direction`**: a credit must name its class, and a debit CONSUMES a composition rather than having one ([EVENTS](../EVENTS.md) section 6.1), so what a withdrawal destroys is a FIFO mixture recorded in `wallet_withdrawals.source_provenance_summary` and not a scalar. `correction` stays admissible on a debit because `0038`'s `ADJ-C3` REQUIRES exactly that row for every reversing adjustment, which is a mechanism rather than a source of value. **The nullability column and the CHECK have to be read together: neither half states the rule alone** |
| `cause` | text | not null | the business event, human readable |
| `reference_id` | uuid | not null | polymorphic: payout request, purchase, or the corrected entry |
| `ledger_transaction_id` | uuid | fk ledger_transactions, not null, on delete restrict | a wallet entry with no ledger transaction is money that moved outside the ledger |
| `balance_after_cents` | bigint | not null, check >= 0 | the running balance after this entry. Stored so a statement renders without a window function over an append-only table, and so a divergence between the stored balance and the recomputed one is a **detectable** tamper indication rather than an invisible one |
| `occurred_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `wallet_entries_identity_idx (identity_id, occurred_at desc)`; `wallet_entries_transaction_idx (ledger_transaction_id)`; `wallet_entries_reference_idx (reference_id)`; `wallet_entries_credits_idx (identity_id, occurred_at)` where `direction = 'credit'`.
Retention: forever.
**INV-WALLET-NO-DEPOSITS. The wallet never takes a deposit, and there is no `deposit` provenance value.** This is excluded **explicitly** rather than merely omitted (OQ-M20-03 as ruled), because "we did not build deposits" and "deposits are forbidden" are different promises and only the second one survives a product meeting. Adding one is a regulatory question about stored value, not a feature, and it requires counsel and an ADR.
**`promotional_credit` is not in the list and must not be** (OQ-FREEZE-01). It has its own ledger class and its own table (`promotional_credit_grants`, `0024`), and it is never wallet value.
Why provenance is a wallet fact and not a ledger fact: the ledger knows an amount moved into `trader_wallet`, and only this table knows it arrived as a payout rather than as a refund of a wallet-funded purchase. Without it every rule in M20 section 3.4 is unenforceable, because the system cannot tell a payout credit from a refund credit once both are in the same integer.
