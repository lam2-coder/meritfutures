### payout_transfers
Separates "we approved" from "the rail moved money", so a Rise outage never looks like a payout problem.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `payout_request_id` | uuid | fk payout_requests, not null, on delete restrict | |
| `provider` | text | not null default `rise` | |
| `provider_transfer_id` | text | null | |
| `idempotency_key` | text | not null, unique | |
| `amount_cents` | bigint | not null, check > 0 | |
| `destination_ref` | text | not null | provider-side destination id, **never bank details**. Merit does not hold them, which is the point |
| `destination_name_match` | boolean | null | Rise identity versus KYC identity |
| `status` | text | not null, check in (`queued`,`sent`,`settled`,`failed`,`retrying`) | |
| `attempts` | integer | not null default 0, check >= 0 | |
| `last_error` | text | null | |
| `sent_at`, `settled_at` | timestamptz | null | |
| `name_match_score` | integer | null, check between 0 and 10000 | **`SD-M5-02`** |
| `name_match_method` | text | null | **`SD-M5-02`** |
| `name_match_reviewed_by` | text | null | **`SD-M5-02`** |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `payout_transfers_provider_transfer_uq (provider, provider_transfer_id)` where not null; `payout_transfers_request_idx (payout_request_id)`; `payout_transfers_open_idx (status, created_at)` where in flight.
Constraints: `payout_transfers_score_has_method` (a score with no method is a number nobody can re-derive when the matcher is replaced); `payout_transfers_settled_has_timestamp`.
**Why `SD-M5-02` exists: real name matching is not boolean.** Transliteration, married names, and common names make a strict comparison produce false freezes on legitimate traders, which under a zero-denial policy is a brand cost paid by the people least deserving of it. Merit refuses the market norm of payout-time fraud friction (Apex's screen-recording requirement, refused on the record), and that refusal only holds if the identity friction lands upstream of funding, which is what [ADR-021](../../decisions/ADR-021.md)'s triggers are for. These three columns are what keep the name check from becoming the friction that reappears here.
