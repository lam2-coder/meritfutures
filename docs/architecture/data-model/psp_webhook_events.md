### psp_webhook_events
Raw, signed, immutable inbound payment events. Kept separately from `events` because these are third-party assertions, not facts we generated, and the distinction matters the day one of them turns out to be wrong.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `psp` | text | not null | |
| `provider_event_id` | text | not null | |
| `event_type` | text | not null | |
| `signature_verified` | boolean | not null | recorded, not assumed. A payload whose signature did not verify is still stored, and stored with the fact that it did not verify |
| `payload` | jsonb | not null | as received |
| `received_at` | timestamptz | not null default now() | |
| `processed_at` | timestamptz | null | |
| `processing_result` | text | null, check in (`applied`,`duplicate_ignored`,`out_of_order_deferred`,`rejected_signature`) | |
| `purchase_id` | uuid | fk purchases, null, on delete restrict | **`SD-M3-01`** |
| `deferred_until` | timestamptz | null | **`SD-M3-01`** |
| `defer_attempts` | integer | not null default 0, check >= 0 | **`SD-M3-01`.** INV-M3-04 needs somewhere to park a deferred event and something to drive its re-evaluation; without these three columns "deferred" means "dropped and hoped for". The canonical case is a refund arriving before its payment (FM-M3-03): applying it would record a refund against nothing, so it is deferred, re-driven, and warned on after 3 attempts |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `psp_webhook_events_provider_event_uq (psp, provider_event_id)`, which **is** the idempotency guarantee for B4 #9 rather than a helper for one; `psp_webhook_events_deferred_idx (deferred_until)` where `deferred_until is not null and processed_at is null` (the re-drive queue); `psp_webhook_events_purchase_idx (purchase_id)` where not null.
Retention: 24 months, then archive.
