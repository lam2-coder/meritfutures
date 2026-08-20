### impersonation_page_views

**`ADR-068` requirement 6, the "pages viewed" half of the audit. `SD-M6-10`.** Created by [`0042`](../../../packages/db/migrations/0042_impersonation_sessions.sql).

**It is the compensating control for the non-disclosure ruling and not a log.** `ADR-068` section 3 rules that the trader is **not** notified. What makes that survivable is that the view is recorded in detail internally, so **an unnotified view that is not itself recorded is not an exception to transparency, it is the absence of it**. That is why this table is not optional and why requirement 6 says "pages viewed" rather than stopping at start and end.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk, default `gen_random_uuid()` | |
| `impersonation_session_id` | uuid | not null, references [`impersonation_sessions(id)`](impersonation_sessions.md) on delete restrict | `restrict`, because a view whose session could vanish is a view nobody can attribute |
| `route` | text | not null, check `btrim(...) <> ''` | **The route template, never the resolved path.** A resolved path carries ids in its segments, and this table is read by people reviewing an admin's conduct rather than by people who need the trader's account number a second time |
| `viewed_at` | timestamptz | not null default `now()` | Bounded to its session's box by `IMPERSONATION-C2` |

Indexes: `impersonation_page_views_session_idx (impersonation_session_id, viewed_at)`. Triggers: `impersonation_page_view_within_box` (`IMPERSONATION-C2`).

Append-only **by grant**: [`0042`](../../../packages/db/migrations/0042_impersonation_sessions.sql) revokes `update` and `delete` from `merit_app` and from `PUBLIC`. Not readable by `merit_analytics`, for the reason [`impersonation_sessions`](impersonation_sessions.md) states. Retention: forever.

**`IMPERSONATION-C2` is stronger than the scenario it implements, and the difference is worth stating.** `GS-301` says a session reaching expiry mid-view has its **next request refused, not silently served**. A constraint cannot refuse a request; it can refuse a row. So the guard makes **a request served after the box closed unauditable**: the system cannot write this row, and a system that served it fails loudly at the moment it tries to record what it did instead of quietly succeeding. The bound is `LEAST(expires_at, COALESCE(ended_at, expires_at))` rather than `expires_at`, because an explicit exit closes the box early and a view between the exit and the original expiry is a view after the session ended.
