### ingest_files
The quarantine machine for B4 #4.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `file_name` | text | not null | |
| `sha256` | bytea | not null | |
| `kind` | text | not null, check in (`eod_report`,`fills`,`positions`,`unknown`) | **provisional**: the real set depends on what Rithmic delivers |
| `trading_day` | date | null | parsed from content, null until known |
| `byte_size` | bigint | not null, check >= 0 | |
| `received_at` | timestamptz | not null default now() | |
| `status` | `ingest_file_status` enum(`received`,`parsing`,`parsed`,`quarantined`,`applied`) | not null default `received` | |
| `row_count` | integer | null, check >= 0 | |
| `quarantine_reason` | text | null | |
| `applied_at` | timestamptz | null | |
| `replaces_ingest_file_id` | uuid | fk ingest_files, null, on delete restrict | **`SD-M2-03`** |
| `disposition` | text | null, check in (`new`,`duplicate_ignored`,`full_replacement`,`correction_set`) | **`SD-M2-03`.** A vendor redelivery that is not byte-identical is otherwise indistinguishable from a new file, and a corrected redelivery treated as a new file **double-applies a day**. This is the most dangerous branch in M02 |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `ingest_files_sha256_uq (sha256)`, which **is** the guarantee that re-delivery of an identical file is a no-op rather than a helper for one; `ingest_files_status_idx (status)`; `ingest_files_trading_day_idx (trading_day)`; `ingest_files_replaces_idx (replaces_ingest_file_id)` where not null.
Constraints: `ingest_files_replacement_names_target`; `ingest_files_no_self_replace`; `ingest_files_quarantine_is_explained`; `ingest_files_applied_has_disposition`, which is the constraint that makes the four-way decision explicit rather than default.
Invariant: a file in `quarantined` has committed **no** downstream rows, enforced by processing the whole file in one transaction.
A row touching an already-applied day **without** a `correction_of` quarantines the whole file (AS-M2-02, GS-086). Merit would rather lose a day of data than double-apply one.
