### risk_flags
Flags attach to **humans**, not to accounts. `account_id` is set when a flag is account-specific, and the identity is always there because that is the level enforcement acts at.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `account_id` | uuid | fk accounts, null, on delete restrict | when account-specific |
| `flag_type` | text | not null | `inverse_pair`, `copy_cluster`, `news_window`, `martingale`, `velocity`, `entity_cap`, `payment_velocity`, `name_mismatch`, `reset_velocity`, `affiliate_self_deal` |
| `severity` | smallint | not null, check between 1 and 5 | a scored queue, not a boolean. Severity is what makes an SLA meaningful and what stops a queue being worked in arrival order |
| `status` | `risk_flag_status` enum(`open`,`investigating`,`dismissed`,`enforced`) | not null default `open` | |
| `source` | text | not null default `internal` | **reserved**: `internal` or `vendor:<name>`, so a QuantSentry-class detector plugs in without a migration |
| `detector_run_id` | uuid | fk detector_runs, null, on delete restrict | provenance |
| `evidence` | jsonb | not null | the numbers behind the accusation, never a bare label |
| `first_detected_on` | date | not null | |
| `resolved_at` | timestamptz | null | |
| `resolved_by`, `resolution_note` | text | null | |
| `sla_due_at` | timestamptz | null | **`SD-M7-02`** |
| `first_touched_at` | timestamptz | null | **`SD-M7-02`.** Separate from `resolved_at` on purpose: "someone looked" and "someone decided" are different service levels and only the first can be promised in hours |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `risk_flags_queue_idx (status, severity desc, first_detected_on)`, worst first and oldest first within a severity; `risk_flags_identity_idx (identity_id)`; `risk_flags_type_idx (flag_type)`; `risk_flags_sla_breached_idx (sla_due_at)` where untouched and open, the breach query.
Constraints: `risk_flags_high_severity_has_sla` (severity 4 and 5 carry a clock; without this the column exists and the promise does not); `risk_flags_resolution_is_explained`.
Retention: forever.
Why `SD-M7-02` exists: a severity-scored queue with no clock is a queue that grows, and detection that produces evidence nobody acts on is worse than no detection, because it is **documented negligence**.
