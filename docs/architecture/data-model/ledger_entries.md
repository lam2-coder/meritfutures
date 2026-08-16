### ledger_entries
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `transaction_id` | uuid | fk ledger_transactions, not null | |
| `ledger_account_id` | uuid | fk ledger_accounts, not null | |
| `amount_cents` | bigint | not null, check `<> 0` | **signed: positive is debit, negative is credit.** The convention is load bearing and is stated in three places (here, the migration, [M05 section 4](../../plans/M05-payout-system.md)) because getting it backwards is the error that landed four times in one day on LT-01 |
| `currency` | char(3) | not null default `'USD'` | **reserved for multi-currency**, never used in v1 math |
| `memo` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `ledger_entries_transaction_idx (transaction_id)`; `ledger_entries_account_created_idx (ledger_account_id, created_at)`.
Append-only; no `UPDATE`, no `DELETE` grant (`0026`). Retention: forever.
**Three enforcements in `0027`, all failing at insert rather than in a later job:**

| Name | Shape | What it catches |
|---|---|---|
| `ledger_entries_zero_sum` | deferred constraint trigger, INV-M5-04 | a transaction whose entries do not sum to exactly zero. Deferred to commit because entries arrive one at a time and a transaction is only balanced once all its legs exist |
| **LEDGER-C1** `ledger_entries_no_opposite_signs` | deferred constraint trigger, [ADR-027](../../decisions/ADR-027.md) | a transaction posting **opposite signs against one ledger account**. This is the C-01 collapse mechanized: it passed zero-sum (100,000 against 90,000 plus 10,000) while net-debiting the trader by `firm_cents`. A flat prohibition rather than a threshold, because that shape has no legitimate use in this chart of accounts |
| **LEDGER-C2** `ledger_entries_class_declared` | `BEFORE INSERT` trigger, [ADR-027](../../decisions/ADR-027.md) | an entry against an undeclared class. The CHECK on `ledger_accounts.code` is the primary guard; this is the second line, because a FK to a table whose own CHECK could be dropped in a later migration is a guarantee with a dependency |

The global sum is a nightly assertion. It is proportionate for [ADR-016](../../decisions/ADR-016.md)'s global halt precisely because an unbalanced transaction cannot be written in the first place, so a global mismatch implies data corruption or a direct write.
