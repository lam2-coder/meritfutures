### geo_restrictions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `country_code` | char(2) | pk | |
| `rule` | text | not null, check in (`block_purchase`,`block_all`,`warn`) | checkout and login behave differently, which is why this is a three-value rule rather than a boolean |
| `reason` | text | not null | counsel's rationale, versioned by row history in `events`, because "why is this country blocked" is a question with a legal answer |
| `effective_from` | date | not null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Retention: forever.
