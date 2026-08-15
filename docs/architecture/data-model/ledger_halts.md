### ledger_halts
**`U-03`**, [ADR-016](../../decisions/ADR-016.md), M05 INV-M5-16. An identity-scoped halt with an escalation clock.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, **not null**, on delete restrict | the **subject**. Null is not permitted, because a halt with no subject is the global halt, and the global halt is not a row, it is an incident |
| `reason_code` | text | not null, check in (`position_mismatch`,`reflection_missing`,`wallet_balance_divergence`,`manual`) | named rather than free text at the top level so the runbook can key off it |
| `reason_note` | text | not null | |
| `evidence` | jsonb | not null default `'{}'` | |
| `halted_at` | timestamptz | not null default now() | the **start** |
| `halted_by` | text | not null | detector name, or an operator |
| `escalate_at` | timestamptz | **not null** | the **deadline**. When it passes with `released_at` still null, the halt pages and escalates. Not null because a halt without a deadline is the failure mode the ruling exists to prevent: a quiet flag on one trader that survives because it inconveniences nobody with authority to clear it |
| `escalated_at` | timestamptz | null | recorded when the page fires, so a second page is a second decision rather than a repeat of the first |
| `released_at`, `released_by`, `release_note` | timestamptz, text, text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `ledger_halts_live_per_identity_uq (identity_id)` where `released_at is null` (a second halt on an already-halted subject is new evidence on the existing one, not a second outage); `ledger_halts_escalation_idx (escalate_at)` where `released_at is null`, which is both the escalation sweep and the read every payout and withdrawal path makes before it moves money for this identity.
Constraints: `ledger_halts_deadline_after_start`; `ledger_halts_release_is_explained`.
Why scoped rather than global: the global halt is proportionate for a global ledger sum mismatch, because an unbalanced transaction cannot be written in the first place, so a global mismatch implies corruption. A single identity's position failing a check is not that. Halting the firm for it is an outage; ignoring it is a leak.
