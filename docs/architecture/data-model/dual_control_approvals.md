### dual_control_approvals
**`SD-M6-05`**. [ADR-010](../../decisions/ADR-010.md) requires a second approval within a window, and that needs a row.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `subject_kind` | text | not null | |
| `subject_id` | uuid | not null | |
| `requested_by` | text | not null | |
| `requested_at` | timestamptz | not null default now() | |
| `payload_hash` | bytea | not null | **`SD-M6-05`.** Pins **what** is being approved. An approval that does not pin the payload approves whatever the request happens to say when it executes, which is a control that can be edited after it is passed |
| `approved_by`, `approved_at` | text, timestamptz | null | |
| `expires_at` | timestamptz | **not null** | [ADR-010](../../decisions/ADR-010.md)'s "within a window", not null for the same reason `alarm_suppressions.expires_at` is |
| `status` | text | not null default `pending`, check in (`pending`,`approved`,`expired`,`withdrawn`) | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `dual_control_approvals_subject_idx (subject_kind, subject_id)`; `dual_control_approvals_pending_idx (expires_at)` where `status = 'pending'`.
Constraints: **`dual_control_approvals_second_person`** (`approved_by <> requested_by`, the control itself in DDL); `dual_control_approvals_approval_is_complete`; `dual_control_approvals_within_window`; `dual_control_approvals_window_after_request`.
Without the second-person check the table records two clicks by the same session and calls it dual control, which Appendix D names as **worse than nothing**, because it reads as a control in an audit.
