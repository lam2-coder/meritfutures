### account_status_history
Materialized transition log. Append-only.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `from_status` | text | null | null on the first transition |
| `to_status` | text | not null | |
| `from_phase` | text | null | |
| `to_phase` | text | null | |
| `reason` | text | null | |
| `changed_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `account_status_history_account_idx (account_id, changed_at desc)`.
Retention: forever.
`events` is the canonical trail; this table exists because "was this account active during month M" is a billing-provability question asked often enough to deserve an index rather than an event scan.
