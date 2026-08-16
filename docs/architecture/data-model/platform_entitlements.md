### platform_entitlements
The hygiene ledger behind real monthly cost. B3 reservation, now a real table.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `entitlement` | text | not null, check in (`market_data_cme`,`platform_access`,`api_tier`) | |
| `active` | boolean | not null default true | |
| `activated_on` | date | not null | **Unit: wall clock**, when Merit activated the entitlement. |
| `deactivated_on` | date | null | **Unit: wall clock**, when Merit deactivated it. |
| `monthly_cost_cents` | bigint | not null default 0, check >= 0 | makes the cost of forgetting visible in a query, which is the only reason an entitlement leak gets closed |
| `platform_user_ref` | text | null | **`SD-M2-05`** |
| `billing_unit` | text | null, check in (`per_login_month`,`per_account_month`,`per_api_id_month`) | **`SD-M2-05`.** Rithmic bills per login-month per user, and separately for API tier, **not per account**. Modelling entitlements only per account makes the monthly bill unreconcilable against our own records, which is how a cost leak survives for months (`V-M2-09`) |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `platform_entitlements_active_idx (active, account_id)`; `platform_entitlements_billing_idx (billing_unit, platform_user_ref)` where `active`, which groups by the unit the vendor bills in rather than the unit we happen to model in; `platform_entitlements_live_by_account_idx (account_id)` where `active`, which is the nightly alarm's source.
Constraints: `platform_entitlements_active_matches_dates`; `platform_entitlements_dates_ordered`.
The nightly alarm (any closed account still entitled after 24 hours) evaluates **the query**, not the job (FM-M2-11), because a job that stopped running looks exactly like a clean night.
