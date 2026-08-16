### identity_signal_weights
**`U-01`**, [ADR-022](../../decisions/ADR-022.md), M07 D-16. Reserved.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `signal_kind` | text | not null, pk part | |
| `link_kind` | text | not null, pk part | |
| `version` | integer | not null, check > 0, pk part | |
| `weight_bp` | integer | not null, check between 0 and 10000 | basis points, like every ratio in this schema |
| `tier` | text | not null, check in (`v1`,`v1x`,`post_launch`) | so a v1.x weight cannot be switched on by a config edit that predates the data it needs |
| `rationale` | text | not null | |
| `effective_from` | date | not null | **Unit: wall clock**, a configuration validity window. |
| `effective_to` | date | null | **Unit: wall clock**, the same. |
| `approved_by` | text | not null | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(signal_kind, link_kind, version)`.
Indexes: `identity_signal_weights_live_idx (signal_kind, link_kind)` where `effective_to is null`.
Constraints: `identity_signal_weights_range_ordered`.
Why it stays empty at launch, stated so a future reader does not "fix" it: [ADR-022](../../decisions/ADR-022.md)'s tier ordering is forced by **data availability, not by ambition**. The v1 tier is deliberately only the facts. Weights tuned on no data are guesses wearing a number, and a scored graph running on guessed weights produces confident wrong answers about which humans are the same human. The weights are configuration, tuned through a reviewed diff, and they are detector internals that M06's evidence packs keep internal-tier always.
