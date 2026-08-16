### affiliate_statements
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `affiliate_id` | uuid | fk affiliates, not null, on delete restrict | |
| `period_start`, `period_end` | date | not null | **Unit: wall clock**, a statement period is a billing period on Merit’s calendar. |
| `total_cents` | bigint | not null | **signed**: a clawback-heavy month is negative |
| `status` | text | not null default `draft`, check in (`draft`,`issued`,`paid`,`void`) | |
| `paid_transfer_ref` | text | null | |
| `issued_at` | timestamptz | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `affiliate_statements_period_uq (affiliate_id, period_start)`.
Constraints: `affiliate_statements_period_ordered`; `affiliate_statements_issued_has_date`.
Monthly, immutable once issued. Retention: forever. Created before `affiliate_commissions` in `0012` because `SD-M8-01`'s `paid_in_statement_id` references it.

**System spine (`0017`).** No deltas land here. All three tables are the approved design, and the file exists because they are the append-only spine the admin feed, analytics, messaging and audit all read.
