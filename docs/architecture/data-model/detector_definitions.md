### detector_definitions
**`SD-M7-03`**, INV-M7-04.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `detector` | text | not null, pk part | |
| `version` | text | not null, pk part | |
| `parameters` | jsonb | not null | |
| `description` | text | not null | |
| `effective_from` | date | not null | **Unit: wall clock**, a configuration validity window. **A DAY AND NOT AN INSTANT, ruled correct by [ADR-276](../../decisions/ADR-276.md) clause 1.** `0008`'s own header asks for *"a RECORDED EFFECTIVE DATE rather than a deploy"*, and `version` carries the row's identity in the primary key, so `effective_from` is a window boundary and never a discriminator |
| `effective_to` | date | null | null means current **Unit: wall clock**, the same. |
| `is_sensitive` | boolean | not null default **true** | marks parameters that must never reach a trader. Default true, because a detector parameter that leaks tells the adversary exactly where the line is, and defaulting to safe means a new detector is protected before anyone remembers to protect it |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(detector, version)`.
Indexes: `detector_definitions_current_idx (detector)` where `effective_to is null`.
Constraints: `detector_definitions_range_ordered`.
Retention: forever.
Three needs at once: provenance, M06's redaction strip list (DEP-M6-03), and the ability to **tune a threshold as a data change with a recorded effective date** rather than as a deploy. The last is the one that matters operationally: a threshold tuned by deploy is a threshold whose history lives in git and whose "why did this not fire in March" answer is an archaeology exercise.
