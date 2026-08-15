### review_requests
**`SD-M12-03`**, INV-M12-09.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `trigger_event` | text | not null | |
| `trigger_class` | text | not null, check in (`favorable`,`unfavorable`,`neutral`) | **the whole delta.** `unfavorable` rows are the ones that make the set representative, and they are the ones a review-farming design would omit |
| `sent_at` | timestamptz | null | |
| `suppressed_reason` | text | null | |
| `provider_ref` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `review_requests_identity_idx (identity_id)`; `review_requests_class_idx (trigger_class, created_at desc)`, the representativeness query.
Constraints: `review_requests_sent_or_suppressed`.
The compliance question a regulator or Trustpilot asks is not "did you incentivize" but **"who did you invite, and were they a representative set"**. That is answerable only from a table recording the trigger class of every invitation, including the unfavourable ones (AS-M12-03).
