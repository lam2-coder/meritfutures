### integration_dispatches
**`SD-M10-02`**, INV-M10-03. Append-only.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `integration` | text | not null | |
| `event_id` | bigint | fk events, null, on delete restrict | |
| `identity_id` | uuid | fk identities, null, on delete restrict | nullable because not every dispatch is about a person, and the ones that are not must not be findable by an identity search that returns them anyway |
| `fields_sent` | text[] | not null | **what actually went**, not what the contract permitted. The two differ when a field is absent from a particular event, and the breach question is about what left the building rather than about what was allowed to |
| `status` | text | not null, check in (`queued`,`sent`,`failed`,`dropped_by_guard`) | |
| `attempts` | integer | not null default 0, check >= 0 | |
| `response_code` | integer | null | |
| `dispatched_at` | timestamptz | null | |
| `idempotency_key` | text | not null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `integration_dispatches_idempotency_uq (integration, idempotency_key)`; `integration_dispatches_identity_idx (identity_id, created_at desc)` where not null, the deletion-request and breach query; `integration_dispatches_integration_idx (integration, created_at desc)`; `integration_dispatches_retry_idx (created_at)` where queued or failed.
Constraints: `integration_dispatches_sent_has_timestamp`.
Retention: **long, deliberately**, and the only table in this module with a retention longer than a quarter. A privacy deletion request and a vendor breach ask the identical question, and a 30-day log cannot answer either.
