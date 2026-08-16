### reconciliations
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `trading_day` | date | not null | **Unit: trading day**, the day being reconciled. |
| `our_balance_cents` | bigint | not null | |
| `platform_balance_cents` | bigint | not null | |
| `delta_cents` | bigint | **generated always as** `our_balance_cents - platform_balance_cents` **stored** | generated, so the two sides and their difference can never disagree |
| `status` | text | not null, check in (`match`,`mismatch`,`resolved`) | |
| `resolved_by`, `resolution_note` | text | null | |
| `source_ingest_file_id` | uuid | fk ingest_files, null, on delete restrict | **`SD-M2-06`.** Which file carried the vendor's number |
| `our_source` | text | null, check in (`rule_state`,`ledger`) | **`SD-M2-06`.** Which of our two internal balance derivations was compared. They can disagree with each other as well as with the vendor, and a nightly alarm that does not say which pair diverged is a five-hour diagnosis instead of a five-minute one (FM-M2-08) |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `reconciliations_account_day_uq (account_id, trading_day)`; `reconciliations_open_mismatch_idx (trading_day)` where `status = 'mismatch'`, which is the set excluded from eligibility this morning.
Constraints: `reconciliations_resolution_is_explained`; `reconciliations_mismatch_names_sources`; `reconciliations_status_matches_delta` (a match has a zero delta and a mismatch does not, by construction rather than by the writer's care).
A `mismatch` sets `accounts.recon_blocked = true` and blocks eligibility until a human resolves it. Recon is a **context** gate, never part of the replayed state (INV-23, `SD-06`).
