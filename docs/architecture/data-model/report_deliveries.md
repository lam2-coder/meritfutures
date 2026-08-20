### report_deliveries
**[ADR-066](../../decisions/ADR-066.md) section 3.** **One row per delivery attempt with its outcome**, for the schedules in [`report_schedules`](report_schedules.md). Created by [`0040`](../../../packages/db/migrations/0040_report_schedules.sql) (`SD-M6-07`). **It is the load-bearing half of that pair**, because the schedule records an intention and this table is the only thing that records whether the intention was met.

**The delivery-failure alarm reads THIS TABLE and never the job's own report.** That is [M05](../../plans/M05-payout-system.md) `INV-M5-18`'s construction on a second sweep rather than a new control: that invariant is asserted on the **query**, evaluated independently of whether the sweep reported success, on the stated ground that **a job that reports success is not evidence that the work happened** ([M02](../../plans/M02-rithmic-bridge.md) `FM-M2-11`). `GS-288` is exactly the case where the job reports success and nothing arrived. The dead-man switch is in [CRON_INVENTORY](../../ops/runbooks/CRON_INVENTORY.md).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | internal, never in a URL |
| `schedule_id` | uuid | not null, references [`report_schedules`](report_schedules.md) on delete restrict | |
| `due_at` | timestamptz | not null | **The window this attempt discharges, and the column the whole control rests on.** The alarm is an anti-join against it. Without a stored window, "nothing arrived" and "not due yet" are the same empty result set, which is [`economic_calendar_loads`](economic_calendar_loads.md)'s coverage bound one table over |
| `attempt` | integer | not null, >= 1, unique with `(schedule_id, due_at)` | A retry is a **new row**, not an update of the failed one. The failure that was retried is the evidence, and an attempt count that overwrites its own history answers "how bad was it" with "fine, eventually" |
| `covers_through_trading_day` | date | not null | **Unit: trading day**. The last closed trading day the digest reports, which is a different fact from `due_at`. `INV-M6-04` requires every number to name its as-of moment, and a digest that leaves the console loses the page that would have said so. A Monday delivery of Friday's book is correct **because it says so** |
| `channel` | text | not null, check in `email`, `sftp` | Transcribed at attempt time rather than joined from the mutable schedule, so a channel changed next month does not rewrite what every historical delivery claims to have been. [M16](../../plans/M16-notification-center.md) `FM-M16-05`'s stored snapshot argument applied to the envelope |
| `format` | text | not null, check in `csv`, `pdf` | Same reason |
| `recipients_attempted` | text[] | not null, no NULL, blank or duplicate element | Who it actually reached |
| `recipients_omitted` | text[] | not null default `{}`, same wellformedness, disjoint from attempted | `GS-290`: a schedule naming a recipient who has been removed **degrades to the remaining recipients** |
| `omission_reason` | text | null, required exactly when `recipients_omitted` is non-empty, non-blank | `GS-290`'s **"and records the removal"**. An equivalence rather than an implication, closing both directions |
| `outcome` | text | not null, check in `delivered`, `failed` | **Two values. There is deliberately no `skipped`** |
| `failure_reason` | text | null, required exactly when `outcome = 'failed'`, non-blank | A failed delivery with no stated reason records that something went wrong and not what, which is the alarm arriving without its evidence |
| `attempted_at` | timestamptz | not null default now() | |
| `delivered_at` | timestamptz | null, required exactly when `outcome = 'delivered'`, >= `attempted_at` | The separation [M16](../../plans/M16-notification-center.md) `FM-M16-05` already draws, and [`integration_dispatches`](integration_dispatches.md)' `sent_has_timestamp` one table over |
| `artifact_digest` | bytea | null, required exactly when `outcome = 'delivered'`, check `length = 32` | **SHA-256 of the artifact, never the artifact.** `rule_states`' idiom: a hash is a SHA-256 digest or it is not a hash |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `report_deliveries_window_attempt_uq (schedule_id, due_at, attempt)`; `report_deliveries_delivered_window_idx (schedule_id, due_at desc) WHERE outcome = 'delivered'`, the alarm's read; `report_deliveries_failed_idx (attempted_at desc) WHERE outcome = 'failed'`, the ops read.

Constraints: `report_deliveries_attempt_is_ordinal`; `report_deliveries_attempted_wellformed`; `report_deliveries_omitted_wellformed`; `report_deliveries_recipient_sets_disjoint`; `report_deliveries_omission_states_its_reason`; `report_deliveries_omission_reason_stated`; `report_deliveries_delivered_reached_somebody`; `report_deliveries_delivered_has_timestamp`; `report_deliveries_delivered_has_digest`; `report_deliveries_digest_is_sha256`; `report_deliveries_failure_states_its_reason`; `report_deliveries_failure_reason_stated`; `report_deliveries_delivery_follows_attempt`.

Append-only, **by grant** (`0040` revokes `update` and `delete` from `merit_app` and from `PUBLIC`, on [`0032`](../../../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql)'s and [`0039`](../../../packages/db/migrations/0039_economic_calendar.sql)'s precedent). Not readable by `merit_analytics`. Retention: forever.

**Without the revoke, "one row per delivery attempt with its outcome" is a sentence in a header.** A `failed` row could be moved to `delivered` after the fact, which makes the alarm's own evidence editable by the process the alarm exists to distrust. [`0026`](../../../packages/db/migrations/0026_roles_and_grants.sql)'s default privileges grant the application full DML on anything a later migration creates, so this is a revoke rather than an omission.

**`report_deliveries_delivered_reached_somebody` is the sharpest constraint here.** `GS-290` degrades to the **remaining** recipients; degrading to **none** of them is not a degraded success, it is a failure that has learned to look like one. A delivery that reached nobody cannot be written as `delivered` at all.

**There is no `skipped` outcome, and that is the same argument in the vocabulary.** [FOLD-03](../../plans/FOLD-03-vendor-parity-gap-fill.md) section 5.2's acceptance is that a failed delivery **alarms and never silently skips**. A skip that can be recorded as an outcome is a skip that reads as normal in a list of outcomes. A run that decides not to send writes `failed` with its reason, or it writes nothing and the missing row is itself the finding; both roads reach a human.

**No artifact is stored here and that is `INV-M6-10` rather than a size decision.** [M06](../../plans/M06-admin-ops-console.md):54 permits trader-identifying data only when the query names a specific subject, and [ADR-066](../../decisions/ADR-066.md) section 3 says no digest is a bulk identity export. A table holding every rendered digest body **would be** that export, sitting behind an admin route, created by the feature admitted on the promise that it was not one. The SHA-256 answers "was what arrived what we generated" and answers nothing about any trader.
