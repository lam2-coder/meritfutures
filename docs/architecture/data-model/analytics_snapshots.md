### analytics_snapshots
**`SD-M13-03`**, INV-M13-06, AS-M13-07.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `account_id` | uuid | fk accounts, not null, on delete restrict, pk part | |
| `as_of_trading_day` | date | not null, pk part | |
| `payload` | jsonb | not null | |
| `inputs_digest` | bytea | not null | **`SD-M13-03`.** What makes INV-M13-10 checkable: if the digest changed, the marks changed, and the trader is told why. Without it, a corrected mark silently changes a trader's historical statistics and the only evidence is that they remember a different number |
| `computed_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(account_id, as_of_trading_day)`.
Indexes: `analytics_snapshots_day_idx (as_of_trading_day)`.
The expensive shapes are computed once per account per closed day in the batch, not per page load.

**Loyalty and graduation (`0023`).** Not a money-path file by table, and it sits directly beside one, so the boundary is stated hard: **[ADR-025](../../decisions/ADR-025.md) rejected progressive cap release for v1 rather than deferring it, and no loyalty benefit moves a per-account bound** (INV-M14-11, INV-M14-12). There is no `benefit_code` here that can raise a cap, lengthen a ladder, or change a gate, and there is no column for one. A cap edit is a cap edit regardless of the word "loyalty", and it goes through the dual-controlled publish path or it does not happen. What loyalty may do instead is cross-account: reset discounts, promotional credit (never withdrawable), and review-pool priority.
