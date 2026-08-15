### fills
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | high volume, never in a URL |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `platform` | text | not null default `rithmic` | **B3 reservation** |
| `platform_fill_id` | text | not null | vendor identifier |
| `order_id` | text | null | **B3 reservation** |
| `venue` | text | null | **B3 reservation**, exchange MIC |
| `symbol` | text | not null | joins `contract_specs` |
| `side` | text | not null, check in (`buy`,`sell`) | |
| `quantity` | integer | not null, check > 0 | contracts, never fractional |
| `price_numerator` | bigint | not null | exact rational price, never a float, for the same reason money is integer cents: a price that rounds is a P&L that disagrees with the vendor's |
| `price_denominator` | bigint | not null, check > 0 | |
| `executed_at` | timestamptz | not null | vendor execution time |
| `trading_day` | date | not null | resolved through the calendar, never from the timestamp's UTC date. **Our** answer, because the engine must be deterministic |
| `correction_of` | bigint | fk fills, null, on delete restrict | **B3 reservation.** A correction references the original |
| `is_corrected` | boolean | not null default false | set on the original when a correction arrives |
| `ingest_file_id` | uuid | fk ingest_files, not null, on delete restrict | provenance |
| `raw_row_id` | bigint | fk raw_ingest_rows, not null, on delete restrict | provenance |
| `recorded_at` | timestamptz | not null default now() | **arrival** time, which differs from `executed_at` on corrections. Both, because "when did it happen" and "when did we learn it" are different questions and a correction is exactly where they diverge |
| `trading_day_vendor` | date | null | **`SD-M2-04`** |
| `trading_day_source` | text | not null default `calendar`, check in (`calendar`,`vendor`,`agreed`) | **`SD-M2-04`.** When the vendor states a session date and our calendar containment disagrees, that disagreement is the single most valuable ingest signal available, and it is invisible if we overwrite with our own answer. Divergence alarms rather than being silently resolved in our favour (AS-M2-06, FM-M2-04) |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `fills_platform_fill_uq (platform, platform_fill_id)`; `fills_account_day_idx (account_id, trading_day)`; `fills_trading_day_idx (trading_day)`; `fills_account_executed_idx (account_id, executed_at)`; `fills_correction_idx (correction_of)` where not null; `fills_day_divergence_idx (trading_day, account_id)` where the vendor day is present and differs, which is the divergence alarm's read path.
Constraints: `fills_vendor_day_present_when_claimed`; `fills_agreed_means_equal`; `fills_no_self_correction`.
Append-only, including corrections. Retention: forever.
**Provisional ([ADR-005](../../decisions/ADR-005.md)):** correction arrival semantics. The design assumes corrections arrive as new rows referencing the original. If the vendor restates in place, the ingest layer converts a restatement into a correction row so this table's contract holds regardless.
Why a wrong trading day matters: it shifts win-day counts, minimum days, and the breach comparison for that account.
