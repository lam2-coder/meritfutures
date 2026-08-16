### loyalty_criteria
**`SD-M14-03`**, INV-M14-07.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `benefit_code` | text | not null, pk part | |
| `version` | integer | not null, check > 0, pk part | |
| `title` | text | not null | |
| `criteria_spec` | jsonb | not null | no `criteria_spec` may reference a per-account bound |
| `terms_body_mdx` | text | not null | |
| `expiry_rule` | text | not null | |
| `breaks_on` | text[] | not null default `'{}'` | **`SD-M14-03`.** Enumerated, not implied. "What breaks my streak" is the question a trader asks **after** it breaks, and answering it then is too late (AS-M14-07) |
| `effective_from` | date | not null | |
| `superseded_by` | text | null | the `benefit_code` of the successor, when renamed |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(benefit_code, version)`.
Indexes: `loyalty_criteria_effective_idx (benefit_code, effective_from desc)`.
The same versioned-definition discipline M12 uses for statistics, applied to **promises**.
