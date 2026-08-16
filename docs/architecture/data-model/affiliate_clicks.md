### affiliate_clicks
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | high volume, never in a URL |
| `affiliate_id` | uuid | fk affiliates, not null, on delete restrict | |
| `click_token` | uuid | not null default `gen_random_uuid()` | |
| `ip` | inet | null | |
| `user_agent` | text | null | |
| `landing_path` | text | null | |
| `clicked_at` | timestamptz | not null default now() | |
| `referrer_host` | text | null | **`SD-M8-02`**, and the highest-value one: a click with no referrer arriving at a deep product path is the signature of an injected pixel rather than a person who read something and followed a link |
| `landing_is_direct` | boolean | not null default false | **`SD-M8-02`** |
| `click_fingerprint` | bytea | null | **`SD-M8-02`** |
| `suspicious_reason` | text | null | **`SD-M8-02`.** Set by the detector, not by the click handler. Null means "not examined", which is a different state from "examined and clean" |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `affiliate_clicks_token_uq (click_token)`; `affiliate_clicks_affiliate_time_idx (affiliate_id, clicked_at desc)`; `affiliate_clicks_referrer_idx (affiliate_id, referrer_host, clicked_at desc)`, the stuffing detector's read path; `affiliate_clicks_suspicious_idx (clicked_at)` where flagged.
Retention: 12 months. 30-day cookie window.
Last-touch attribution with a 30 day window is stealable by volume, and the theft is invisible without knowing where a click came from. These four fields are the difference between detecting cookie stuffing and paying for it (AS-M8-03).
