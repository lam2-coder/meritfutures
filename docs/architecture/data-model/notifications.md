### notifications
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `kind` | text | fk notification_kinds, not null, on delete restrict | |
| `channel` | text | not null, check in (`in_app`,`email`,`push`) | **`push` reserved now** so the future mobile surface needs no migration |
| `payload` | jsonb | not null default `'{}'` | |
| `read_at` | timestamptz | null | |
| `sent_at` | timestamptz | null | |
| `class` | text | not null, check in the four classes | **`SD-M16-02`.** Denormalized from `notification_kinds` **at send time**. The class a message was sent under is a historical fact; the kind's class today is a current policy, and reclassifying a kind must not rewrite what was already sent under the old one |
| `template_version` | integer | not null, check > 0 | **`SD-M16-02`** |
| `rendered_body` | text | null | **`SD-M16-02`.** What makes a message reproducible years later. A template plus a payload is reproducible only while the template still exists in the shape it had; the rendered body is the artifact |
| `coalesce_key` | text | null | **`SD-M16-02`** |
| `dispatch_ref` | uuid | fk integration_dispatches, null, on delete restrict | **`SD-M16-02`.** The vendor dispatch that carried it, when one did |
| `delivery_status` | text | not null default `pending`, check in (`pending`,`delivered`,`bounced`,`suppressed`,`failed`) | **`SD-M16-02`** |
| `delivered_at` | timestamptz | null | **`SD-M16-02`** |
| `created_at` | timestamptz | not null default now() | |

Indexes: `notifications_identity_idx (identity_id, created_at desc)`; `notifications_unread_idx` same key where `read_at is null`; `notifications_coalesce_idx (identity_id, coalesce_key, created_at desc)` where keyed; `notifications_undelivered_idx (created_at)` where pending or failed.
Constraints: `notifications_delivered_has_timestamp`; `notifications_read_implies_sent`.
Three different facts, and AS-M16-05's distinction is not expressible without all three: `sent_at` is when Merit handed it over, `delivery_status` and `delivered_at` are what the channel reported back, `read_at` is what the trader did. **"We notified you" is a claim that needs the middle one to be true.**
