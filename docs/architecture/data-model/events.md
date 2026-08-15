### events
The append-only spine. Full catalogue in [EVENTS.md](../EVENTS.md).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | ordering |
| `event_name` | text | not null | dotted name, versioned by `schema_version` |
| `schema_version` | smallint | not null default 1, check > 0 | payloads evolve and consumers must know which shape they hold. A consumer that infers the shape from the fields present is one that breaks silently when a field becomes optional |
| `occurred_at` | timestamptz | not null | when the fact happened |
| `recorded_at` | timestamptz | not null default now() | when we learned it. Both, because they diverge on exactly the events where the difference matters: vendor corrections, late webhooks, backfills |
| `identity_id` | uuid | fk identities, null, on delete restrict | |
| `account_id` | uuid | fk accounts, null, on delete restrict | |
| `subject_kind` | text | not null | polymorphic subject, **not** a foreign key, because the subject can be any of a dozen kinds and a nullable column per kind is worse than a pair |
| `subject_id` | uuid | not null | |
| `payload` | jsonb | not null | validated against the event's zod schema at write time |
| `actor_kind` | text | not null, check in (`system`,`trader`,`admin`,`vendor`) | |
| `actor_id` | text | null | |
| `correlation_id` | uuid | null | ties a saga's events together, which makes "show me everything that happened because of this purchase" one query |
| `created_at` | timestamptz | not null default now() | |

Indexes: `events_account_time_idx (account_id, occurred_at desc)`; `events_identity_time_idx (identity_id, occurred_at desc)`; `events_name_time_idx (event_name, occurred_at desc)`; `events_correlation_idx (correlation_id)` where not null; `events_subject_idx (subject_kind, subject_id)`.
Append-only, no `UPDATE`, no `DELETE`. Retention: forever.
