### provisioning_queue
One row per **intent**, so partial success is legible. A batch that half-applied is the normal failure and it has to be readable operation by operation.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `operation` | text | not null, check in (`create_user`,`create_account`,`set_risk`,`set_entitlement`,`set_permissions`,`disable_account`,`disable_entitlement`) | |
| `payload` | jsonb | not null | the exact field values rendered into CSV |
| `payload_hash` | bytea | not null | **`SD-M2-01`.** The approved model declared the duplicate-intent index and **the column itself was missing from the table definition**, so the guard did not exist. Written by the enqueue path over a canonical serialization, deliberately **not** a generated column: a generated column would need an immutable cast of `jsonb`, whose immutability is a Postgres version question, and the duplicate-intent guard must not rest on that |
| `file_name` | text | null | idempotent name, assigned at batch build |
| `status` | `provisioning_status` enum(`queued`,`written`,`delivered`,`confirmed`,**`confirmed_inferred`**,`failed`) | not null default `queued` | **`U-06`** adds `confirmed_inferred` |
| `attempts` | integer | not null default 0, check >= 0 | |
| `last_error` | text | null | |
| `queued_at` | timestamptz | not null default now() | |
| `delivered_at`, `confirmed_at` | timestamptz | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `provisioning_queue_status_idx (status, queued_at)`; unique `provisioning_queue_intent_uq (account_id, operation, payload_hash)` where `status <> 'failed'`, so a genuine retry after a failure is permitted and a second live intent is not.
Constraints: `provisioning_queue_set_risk_never_inferred` (**`U-06`**, AS-M2-03: a `set_risk` operation may never reach `confirmed_inferred`); `provisioning_queue_delivered_has_timestamp`.
Why `U-06` is a CHECK rather than a convention: an inferred confirmation means we believe the account exists because the vendor reported on it. That is strong evidence for `create_account` and **worthless** for `set_risk`, because you cannot infer that a risk setting applied from an account appearing in a report. The failure is silent, and an account trading with no working auto-liquidator is a liability the firm is carrying without knowing.
**Provisional ([ADR-005](../../decisions/ADR-005.md)):** the operation set and payload fields follow the public CSV/SFTP description and must be confirmed against the real provisioning spec at the vendor call.
