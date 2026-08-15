### detector_runs
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `detector` | text | not null | |
| `detector_version` | text | not null | |
| `trading_day` | date | not null | |
| `started_at`, `finished_at` | timestamptz | null | |
| `rows_scanned` | integer | not null default 0, check >= 0 | |
| `flags_raised` | integer | not null default 0, check >= 0 | |
| `synthetic_expected` | integer | not null default 0, check >= 0 | **`SD-M7-01`** |
| `synthetic_found` | integer | not null default 0, check >= 0 | **`SD-M7-01`** |
| `status` | text | not null, check in (`ok`,`failed`,**`degraded`**) | **`SD-M7-01`** adds `degraded`. It is distinct from `failed` because a detector that ran, completed, and found fewer synthetics than it seeded did not fail: it produced an answer that must not be trusted. Those need different handling, and a single failure state hides one inside the other |
| `created_at` | timestamptz | not null default now() | |

Indexes: `detector_runs_detector_day_idx (detector, trading_day desc)`; `detector_runs_unhealthy_idx (trading_day desc)` where `status <> 'ok'`, the morning read.
Constraints: `detector_runs_synthetics_match_status` (a run that missed a seeded positive cannot claim `ok`).
Retention: forever.
Why the synthetic battery is a constraint rather than a dashboard (INV-M7-07, AS-M7-05): **a detector whose query silently returns nothing looks exactly like a clean night.** A schema change, a null-handling bug, or a threshold that no longer matches the data's shape all produce zero rows and zero alarms. Seeded synthetic positives are the only way to tell the difference, and their absence must be a failure state rather than a metric nobody reads.
