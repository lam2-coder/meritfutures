### kyc_funnel_events
**`SD-M19-03`**, constitution (g), INV-M19-11. Append-only.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | high volume, never in a URL |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `placement` | text | not null, check in the same seven values as `kyc_verifications.placement` | **widened at the reconciliation**: this column records **which trigger fired**, not which placement was configured. Under [ADR-021](../../decisions/ADR-021.md) the placement is a set and the triggers race, so recording the configured set would answer a question nobody asked and lose the one that decides the adjudication |
| `plan_code` | text | not null | per-plan escalation is pre-agreed rather than lineup-wide ([ADR-021](../../decisions/ADR-021.md) condition 3) |
| `step` | text | not null, check in (`gate_reached`,`session_created`,`provider_opened`,`submitted`,`decided`,`abandoned`) | |
| `occurred_at` | timestamptz | not null default now() | |
| `attempt_number` | integer | not null default 1, check > 0 | |
| `cost_cents` | bigint | null, check >= 0 when present | the per-check cost in integer cents, which turns "a $2 identity check in front of a $79 impulse purchase" from a rhetorical figure into a measured one |
| `created_at` | timestamptz | not null default now() | |

Indexes: `kyc_funnel_events_identity_idx (identity_id, occurred_at)`; `kyc_funnel_events_funnel_idx (placement, plan_code, step, occurred_at)`.
Retention: forever (it is the measurement series).
Why it exists: drop-off per placement **cannot** be reconstructed from `kyc_verifications`, because the traders who matter most are the ones who never created a verification row at all. The abandonment is the measurement (AS-M19-08). This is the table that settles the post-beta KYC trigger adjudication, which is one of the nine items that survived FREEZE and is a config array decided on this data.
