### impersonation_sessions

**`ADR-068`, planned by [FOLD-04](../../plans/FOLD-04-impersonation-and-admin-parity.md) section 4. `SD-M6-10`.** A read-only, money-blind, time-boxed support-visibility session. Created by [`0042`](../../../packages/db/migrations/0042_impersonation_sessions.sql). **Auth, therefore money path**, and **no column here carries money**.

**Merit is passwordless** ([`0002`](../../../packages/db/migrations/0002_identity.sql):280, [ADR-039](../../decisions/ADR-039.md)), so there is no credential a support agent can be walked through and no reset path. This table is the consequence.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk, default `gen_random_uuid()` | |
| `admin_user_id` | uuid | not null, references `users(id)` on delete restrict | The actor. An admin under hardware-key SSO at `ADMIN_ORIGIN` ([ADR-012](../../decisions/ADR-012.md)) |
| `subject_identity_id` | uuid | not null, references `identities(id)` on delete restrict | **An identity and not a user, deliberately.** A restriction is per human ([ADR-041](../../decisions/ADR-041.md)) and so is support: the caller is a person and the accounts under them are what support is trying to see. It is also the table whose `status` `GS-302` turns on |
| `token_hash` | bytea | not null, unique | **The boundary column.** Same type and shape as [`sessions.refresh_token_hash`](sessions.md) at [`0002`](../../../packages/db/migrations/0002_identity.sql):342 on purpose, because `IMPERSONATION-C1` compares the two and a comparison across two representations stops working the day one of them changes |
| `reason_code` | text | not null, check in an eight-member vocabulary | [`0017`](../../../packages/db/migrations/0017_events_and_audit.sql):82 on `admin_actions.reason`: *"NO UNEXPLAINED ADMIN ACTION, EVER. NOT NULL is the whole control."* The vocabulary is the half `NOT NULL` cannot do, because `asdf` is a non-null reason |
| `reason_detail` | text | not null, check `btrim(...) <> ''` | The vocabulary cannot carry specifics. `btrim` rather than `<> ''`: three spaces passes the naive form and is the same nothing |
| `started_at` | timestamptz | not null default `now()` | |
| `expires_at` | timestamptz | not null | **30 minutes by default and configurable; bounded at 2 hours by `impersonation_box_is_bounded`.** The value is a launch candidate and the founder's; that a ceiling exists in the schema is structural (`ADR-068` section 5) |
| `ended_at` | timestamptz | null | The explicit exit, its own audited event |
| `ended_by` | uuid | null, references `users(id)` on delete restrict | |
| `end_reason` | text | null, check in `('explicit_exit','admin_session_ended','revoked_by_owner')` | |

Indexes: `impersonation_sessions_subject_idx (subject_identity_id, started_at desc)`; `impersonation_sessions_admin_idx (admin_user_id, started_at desc)`; partial `impersonation_sessions_open_idx (expires_at) where ended_at is null`, the live-session lookup the auth path makes on every request.

Constraints: `impersonation_box_is_bounded`; `impersonation_exit_is_complete`; `impersonation_exit_within_box`. Triggers: `impersonation_sessions_token_is_not_a_trader_token` (`IMPERSONATION-C1`).

**`DELETE` is revoked from `merit_app` and `PUBLIC`; `UPDATE` is NOT**, and the asymmetry is deliberate: recording the exit is an update to a row that already exists. `IMPERSONATION-C1` fires on `UPDATE OF token_hash`, so the boundary survives the one legitimate update. `merit_analytics` holds no grant at all, which here is a rule rather than [`0032`](../../../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql)'s default: a row names an admin actor beside a trader subject and records that the second was watched without being told. Retention: forever.

**`expires_at` has no sweep and that is a written exemption rather than an oversight**, recorded on [CRON_INVENTORY](../../ops/runbooks/CRON_INVENTORY.md)'s exemption list on `sessions.expires_at`'s own precedent. The column is read at authorization: an unswept expired impersonation session is not an authorized one. `GS-301` is that rule, and `IMPERSONATION-C2` is what makes serving past it fail loudly.

**What is absent is structural.** There is **no `user_id`, no `auth_factor`, no `elevated_at` and no `elevated_by_factor`**. [SECURITY](../SECURITY.md) `C-27`'s elevation columns live on [`sessions`](sessions.md) ([`0029`](../../../packages/db/migrations/0029_phone_identity_and_auth.sql), `SD-M4-04`). **There is no column here a trader-session lookup could resolve and no column an elevation could be written to**, so `ADR-068` section 1's finding that three of the seven blocked routes are refused by `C-27` alone is a fact about this schema rather than a rule somebody has to remember.

**`closed` is deliberately unconstrained.** `identity_status` is `('active','restricted','closed')` at [`0001`](../../../packages/db/migrations/0001_extensions_and_enums.sql):27 and [ADR-041](../../decisions/ADR-041.md) refused a fourth value, so there is no `suspended` to write against. `GS-302` rules `restricted` **impersonable**, because that is exactly when the trader calls. Impersonating a `closed` identity is `OQ-F4-04`, left open by `ADR-068` section 7, and **a `CHECK` written now would settle by accident what the ruling left open**.
