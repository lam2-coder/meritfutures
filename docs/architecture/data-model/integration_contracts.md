### integration_contracts
**`SD-M10-01`**, INV-M10-02.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `integration` | text | not null | |
| `event_name` | text | not null | |
| `field_allowlist` | text[] | not null | **an allowlist, not a denylist**, because a denylist defaults to sending |
| `enabled` | boolean | not null default false | |
| `guard_expression` | text | null | an optional predicate that must hold before this event is dispatched at all, evaluated over the allowlisted fields only |
| `version` | integer | not null default 1, check > 0 | |
| `approved_by` | text | **not null** | an enabled contract with no approver is a disclosure nobody authorised |
| `approved_at` | timestamptz | **not null** | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `integration_contracts_version_uq (integration, event_name, version)`; unique `integration_contracts_live_uq (integration, event_name)` where `enabled`, the dispatcher's read.
Constraints: `integration_contracts_enabled_has_fields` (an enabled contract with an empty allowlist would dispatch an event with no fields, which is either a bug or a signal channel, and neither should be silent).
Why it is a row rather than code: without a declared per-vendor field allowlist, the payload sent to a vendor is whatever the event happened to contain on the day it was serialized, **which means a schema addition silently becomes a disclosure**. Nobody decides to leak the new column: someone adds a column to an event payload for an unrelated reason, and the vendor starts receiving it that afternoon. A row is also reviewable by someone who does not read the repository, which is the founder.
