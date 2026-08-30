### geo_restrictions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `country_code` | char(2) | pk | |
| `rule` | text | not null, check in (`block_purchase`,`block_all`,`warn`) | checkout and login behave differently, which is why this is a three-value rule rather than a boolean |
| `reason` | text | not null | counsel's rationale, versioned by row history in `events`, because "why is this country blocked" is a question with a legal answer |
| `effective_from` | date | not null | **Unit: wall clock**, a policy validity window. **A DAY AND NOT AN INSTANT, ruled correct by [ADR-276](../../decisions/ADR-276.md) clause 1.** Counsel's rule takes effect on a stated date, the table holds ONE row per country and `effective_from` is not in the key at all, so no second rule for one country has to be told apart from the first inside a day. Supersession here is an update with its history in `events`, which is why this is the only one of the nine where the column versions nothing |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Retention: forever.
