### contract_specs
Tick values per contract. B4 #14 exists because someone always hardcodes a multiplier.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `symbol` | text | not null, pk part | for example `ES`, `MES`, `NQ`, `MNQ`, `CL`, `GC` |
| `exchange` | text | not null | |
| `tick_size_numerator` | bigint | not null, check > 0 | exact rational, never a float, for the same reason money is integer cents |
| `tick_size_denominator` | bigint | not null, check > 0 | |
| `tick_value_cents` | bigint | not null, check > 0 | |
| `currency` | char(3) | not null default `'USD'` | |
| `is_micro` | boolean | not null default false | |
| `effective_from` | date | not null, pk part | **Unit: wall clock**, a configuration validity window, not a session. **A DAY AND NOT AN INSTANT, ruled correct by [ADR-276](../../decisions/ADR-276.md) clause 1.** The key carries the day and there is no `version` column beside it, so the key itself rules ONE SPEC PER SYMBOL PER DAY. That is a claim about what the exchange publishes rather than a typing choice, and [ADR-276](../../decisions/ADR-276.md) section 9 flags it as the one of the nine whose reading is an inference from the key rather than from a comment |
| `effective_to` | date | null | null means current **Unit: wall clock**, the same. |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(symbol, effective_from)`, not `symbol` alone. A spec is versioned, so the symbol cannot be the key.
Indexes: `contract_specs_current_idx (symbol)` where `effective_to is null`.
Constraints: `contract_specs_effective_range` (`effective_to > effective_from` when set).
Retention: forever.
