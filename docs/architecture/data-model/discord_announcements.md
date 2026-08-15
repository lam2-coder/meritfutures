### discord_announcements
**`SD-M15-02`**, INV-M15-04, INV-M15-05.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `event_id` | bigint | fk events, null, on delete restrict | the event that caused it |
| `template_code` | text | **not null** | announcements are **template-only**, so there is no path by which a free-text post reaches the channel through this system |
| `channel_id` | text | not null | |
| `rendered_body` | text | not null | |
| `posted_at` | timestamptz | null | |
| `provider_message_ref` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `discord_announcements_posted_idx (posted_at desc)`; `discord_announcements_event_idx (event_id)` where not null.
Constraints: `discord_announcements_posted_has_ref`.
Every message Merit has ever posted in its own community, reproducible, with the event that caused it. In a market where one announcement destroyed a firm, being able to prove exactly what was said and when is worth a table.

**Public surface (`0020`).** Not a money-path file, and it is the file the outside world reads.
