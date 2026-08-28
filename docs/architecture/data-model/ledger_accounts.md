### ledger_accounts
The chart of accounts. Eight v1 classes ([ADR-027](../../decisions/ADR-027.md), [ADR-187](../../decisions/ADR-187.md)).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `code` | text | not null, check in the eight declared codes | the vocabulary is closed in DDL. A class appearing first in a migration is a class nobody defined, and the first draft of [ADR-027](../../decisions/ADR-027.md) invented `firm_payable`, which is why this is a constraint and not a convention |
| `kind` | text | not null, check in (`asset`,`liability`,`revenue`,`expense`,`equity`) | |
| `scope` | text | not null, check in (`firm`,`identity`) | |
| `identity_id` | uuid | fk identities, null | set when scope is identity |
| `created_at` | timestamptz | not null default now() | |

The eight v1 codes: `firm_treasury`, `psp_clearing`, `fees_revenue`, `reserve`, `trader_withdrawable` (per identity), **`trader_wallet`** (per identity, added by `SD-M5-07`), `promotional_credit` (activated by [ADR-019](../../decisions/ADR-019.md), never withdrawable), **`withdrawals_in_flight`** (firm, minted by [ADR-187](../../decisions/ADR-187.md)).
Indexes: unique `ledger_accounts_firm_code_uq (code)` where `scope = 'firm'`; unique `ledger_accounts_identity_code_uq (code, identity_id)` where `scope = 'identity'`. Two partial uniques rather than one, because the firm case has a `NULL` `identity_id` and NULLs do not collide.
Constraints: `ledger_accounts_code_is_declared`; `ledger_accounts_scope_identity` (the two must agree in both directions); `ledger_accounts_kind_matches_code`, which binds a `kind` to every declared code and whose `ELSE` arm is `false`, so a ninth code is refused until its kind is ruled in the migration that mints it.
Retention: forever.

**A CHECK cannot be extended in place, so the vocabulary in force is the LAST migration to install it, not `0009`.** [`0056`](../../../packages/db/migrations/0056_eighth_ledger_code.sql) supersedes `0009`'s `ledger_accounts_code_is_declared`, `0027`'s `LEDGER-C2` function and `0055`'s `ledger_accounts_kind_matches_code`, all three in one transaction, which is the migration [`0027`](../../../packages/db/migrations/0027_triggers_invariants.sql) anticipated in its own words when it explained why `LEDGER-C2` is a second line.

**`withdrawals_in_flight` is firm-scoped and the only `liability` among the firm codes** ([ADR-187](../../decisions/ADR-187.md)). It holds the external leg's in-flight obligation: `LT-06` credits it at approval, `LT-07` debits it at settlement, and no identity opens a position in it, so `0054`'s provisioning trigger does not write one.

**The two per-identity classes are distinct positions and neither supersedes the other** ([ADR-027](../../decisions/ADR-027.md), finding C-01). Withdrawable is what the engine says the trader may draw; wallet is what Merit already owes them. A payout approval moves the full `approved_cents` out of the first and `trader_cents` into the second, the difference being `fees_revenue`. `approved_cents <> trader_cents`, so **the two positions move by different magnitudes in one transaction, which one class cannot do.** Collapsing them passes the zero-sum trigger and net-debits the trader's position by `firm_cents` on every approval: the ledger reconciles perfectly and the balance is wrong. LEDGER-C1 in `0027` makes that shape unrepresentable.
