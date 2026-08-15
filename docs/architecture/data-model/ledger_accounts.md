### ledger_accounts
The chart of accounts. Seven v1 classes ([ADR-027](../../decisions/ADR-027.md)).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `code` | text | not null, check in the seven declared codes | the vocabulary is closed in DDL. A class appearing first in a migration is a class nobody defined, and the first draft of [ADR-027](../../decisions/ADR-027.md) invented `firm_payable`, which is why this is a constraint and not a convention |
| `kind` | text | not null, check in (`asset`,`liability`,`revenue`,`expense`,`equity`) | |
| `scope` | text | not null, check in (`firm`,`identity`) | |
| `identity_id` | uuid | fk identities, null | set when scope is identity |
| `created_at` | timestamptz | not null default now() | |

The seven v1 codes: `firm_treasury`, `psp_clearing`, `fees_revenue`, `reserve`, `trader_withdrawable` (per identity), **`trader_wallet`** (per identity, added by `SD-M5-07`), `promotional_credit` (activated by [ADR-019](../../decisions/ADR-019.md), never withdrawable).
Indexes: unique `ledger_accounts_firm_code_uq (code)` where `scope = 'firm'`; unique `ledger_accounts_identity_code_uq (code, identity_id)` where `scope = 'identity'`. Two partial uniques rather than one, because the firm case has a `NULL` `identity_id` and NULLs do not collide.
Constraints: `ledger_accounts_code_is_declared`; `ledger_accounts_scope_identity` (the two must agree in both directions).
Retention: forever.

**The two per-identity classes are distinct positions and neither supersedes the other** ([ADR-027](../../decisions/ADR-027.md), finding C-01). Withdrawable is what the engine says the trader may draw; wallet is what Merit already owes them. A payout approval moves the full `approved_cents` out of the first and `trader_cents` into the second, the difference being `fees_revenue`. `approved_cents <> trader_cents`, so **the two positions move by different magnitudes in one transaction, which one class cannot do.** Collapsing them passes the zero-sum trigger and net-debits the trader's position by `firm_cents` on every approval: the ledger reconciles perfectly and the balance is wrong. LEDGER-C1 in `0027` makes that shape unrepresentable.
