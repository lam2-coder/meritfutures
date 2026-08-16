### raw_ingest_rows
Immutable landing zone. We keep the vendor's bytes because our normalization can be wrong and their file is the evidence.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `ingest_file_id` | uuid | fk ingest_files, not null, on delete restrict | |
| `line_number` | integer | not null, check > 0 | |
| `raw` | jsonb | not null | parsed columns, verbatim values |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `raw_ingest_rows_file_line_uq (ingest_file_id, line_number)`.
Append-only. Retention: 24 months hot, then archived to object storage with the file digest.
