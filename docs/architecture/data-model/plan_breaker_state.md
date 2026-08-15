### plan_breaker_state
**`SD-M6-02`**, INV-M6-07. The breaker that pauses sales on a plan.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `plan_id` | uuid | fk plans, not null, on delete restrict, pk part | |
| `evaluated_on` | date | not null, pk part | |
| `metric` | text | not null | |
| `numerator_cents` | bigint | not null | |
| `denominator_cents` | bigint | not null | |
| `sample_size` | integer | not null, check >= 0 | **`SD-M6-02`** |
| `ratio_bp` | integer | not null | |
| `threshold_bp` | integer | not null | |
| `min_sample` | integer | not null, check > 0 | **`SD-M6-02`** |
| `state` | text | not null, check in (`armed`,`paused`,`insufficient_data`,`manually_overridden`) | `insufficient_data` is a **first-class state**, not an error. It is what the breaker says during launch week, and saying it is the correct behaviour |
| `override_reason` | text | null | |
| `override_expires_at` | timestamptz | null | an indefinite override is a disabled breaker with a nicer name |
| `changed_by` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(plan_id, evaluated_on)`.
Indexes: `plan_breaker_state_current_idx (plan_id, evaluated_on desc)`; `plan_breaker_state_override_expiry_idx (override_expires_at)` where overridden.
Constraints: `plan_breaker_state_respects_min_sample` (the breaker may not be armed or paused below its own minimum sample); `plan_breaker_state_override_is_complete`.
Why the sample size is the delta's real content: a loss-ratio breaker with no minimum sample fires on a two-transaction denominator, which means it fires during launch week on every new plan, every time. That is an outage Merit inflicts on itself, and worse, it is the outage that teaches everyone to override the breaker (AS-M6-02).
