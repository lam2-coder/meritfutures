### otp_send_budget
**`SD-M16-04`**, [ADR-039](../../decisions/ADR-039.md) amendment 2 and the degradation ruling. Created by [`0029_phone_identity_and_auth`](../../../packages/db/migrations/0029_phone_identity_and_auth.sql). The delta is [M16](../../plans/M16-notification-center.md)'s; the subject is the authentication surface, which is why the record sits in §3.

`INV-M16-11` exempts the security and money classes from rate limiting, and it was written for **post-identity** messages: authenticated recipient, address Merit already trusts. Registration OTP is **pre-identity**, unauthenticated, and addressed to an **attacker-supplied number**. Rate-limit-exempt SMS there is **SMS pumping**: the attacker owns premium-rate numbers, drives volume, takes the carrier share, and Merit pays. Two classes, and this table is the second one's control.

Built on [`plan_breaker_state`](plan_breaker_state.md)'s pattern rather than a new idiom: a keyed row per evaluation day carrying a counter, a threshold, a state and a dated override.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `scope_kind` | text | not null, check in (`phone`,`ip`,`country`,`global`), pk part | the three velocity scopes amendment 2 names, plus the cost circuit breaker. The breaker is `global` because Merit's SMS bill is one number and a per-country breaker cannot see an attack spread across ten |
| `scope_key` | text | not null, check `<> ''`, pk part | for `phone` this is `encode(phone_hash,'hex')` and **never the number**: a rate-limit table is not a reason to keep the one plaintext copy the rest of the schema refuses to keep. For `ip` the address, for `country` the alpha-2, for `global` the literal `global` |
| `evaluated_on` | date | not null, pk part | |
| `sends` | integer | not null default 0, check >= 0 | the velocity half |
| `send_limit` | integer | not null, check > 0 | |
| `spend_cents` | bigint | not null default 0, check >= 0 | the cost half. Integer cents, per §1 |
| `budget_cents` | bigint | not null, check > 0 | |
| `state` | text | not null default `armed`, check in (`armed`,`degraded`,`manually_overridden`) | **three states, and the missing fourth is the ruling.** See below |
| `tripped_at` | timestamptz | null | |
| `alarm_raised_at` | timestamptz | null | **the alarm is not optional and is the half that decays.** A degraded mode nobody is watching becomes the normal mode |
| `recovered_at` | timestamptz | null | |
| `deferred_registrations` | integer | not null default 0, check >= 0 | **the reported figure, with somewhere to live.** ADR-039 requires that the number of registrations completing unverified during a degraded window is reported, "because a queue nobody drains is a fail-open with extra steps". A required figure with no column is the `OI-06` shape: a control citing an input that does not exist |
| `override_reason` | text | null | |
| `override_expires_at` | timestamptz | null | an indefinite override is a disabled breaker with a nicer name (0016's ruling) |
| `changed_by` | text | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Primary key: composite `(scope_kind, scope_key, evaluated_on)`.
Indexes: `otp_send_budget_degraded_idx (evaluated_on desc, scope_kind)` where `state = 'degraded'`; `otp_send_budget_override_expiry_idx (override_expires_at)` where overridden.
Constraints: `otp_send_budget_global_is_singular`; **`otp_send_budget_degraded_is_alarmed`**; `otp_send_budget_recovery_follows_a_trip`; `otp_send_budget_degraded_is_not_recovered`; `otp_send_budget_deferrals_have_a_trip`; `otp_send_budget_override_is_complete`.
Retention: 24 months (abuse history).

**There is no stopping state, on the founder's ruling.** `plan_breaker_state`, whose pattern this table otherwise copies, has `paused`. This one does not, and the asymmetry is the content. Phone verification is mandatory at registration, so a breaker that stops means **no new customers**: the control protecting the SMS bill becomes a cheap denial of service on revenue, tripped at the price of the traffic that trips it, which is the attacker's business model in amendment 2 anyway. **Fail-closed protects money on provisioning and destroys it on registration.** On trip, registration **continues** and verification defers to [ADR-021](../../decisions/ADR-021.md)'s `pre_funded` gate, which is an existing mechanism reused rather than a new one. **Adding `paused` here reverses a founder ruling with one word.**

**A silent trip is not permitted to be written.** `otp_send_budget_degraded_is_alarmed` requires both `tripped_at` and `alarm_raised_at` before the state may be `degraded`, and `otp_send_budget_deferrals_have_a_trip` requires a trip behind any non-zero deferral count. If registrations are being deferred with no trip recorded, either the count is wrong or something nobody declared is deferring them.

**Daily granularity is deliberate and is not an oversight about bursts.** Sub-minute velocity belongs at the edge, where it can refuse a send before one is paid for. This table is the durable, reviewable budget state, which is the same job `plan_breaker_state` does for sales.
