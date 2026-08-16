### affiliates
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | an affiliate **is** an identity. That is what makes the self-deal check possible at all (B4 #16): the buyer and the referrer resolve to the same graph |
| `code` | citext | not null, unique | |
| `parent_id` | uuid | fk affiliates, null, on delete restrict | **reserved** for sub-IB trees, unused in v1 |
| `level` | smallint | not null default 0, check >= 0 | **reserved** |
| `commission_bp` | integer | not null, check between 0 and 10000 | |
| `status` | text | not null default `active`, check in (`active`,`suspended`,`closed`) | |
| `tos_version_id` | uuid | fk tos_versions, not null, on delete restrict | NFA I-26-12: acceptance is versioned. An affiliate's obligations are the ones they accepted, on the day they accepted them |
| `creative_approved` | boolean | not null default false | the fast gate; `affiliate_creatives` holds the record of **what** was approved |
| `chargeback_rate_bp` | integer | not null default 0, check between 0 and 10000 | maintained on dispute webhooks. An affiliate whose referrals charge back is a different problem from one whose referrals refund |
| `balance_cents` | bigint | not null default 0 | **`SD-M8-04`**, INV-M8-06. **Signed**: negative is owed to Merit, which is the case this column exists for. Without a carried balance the only options after a paid clawback are chasing a refund or writing it off, and an affiliate who learns that clawbacks are unenforceable is an affiliate with a business model |
| `negative_balance_since` | date | null | **`SD-M8-04`.** The clock on a negative balance. A carried debt with no start date is one nobody escalates, and the escalation is the enforcement **Unit: wall clock**, how long a carried debt has been carried. |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique on `(code)` (inline); `affiliates_identity_idx (identity_id)`; `affiliates_status_idx (status)` where `status <> 'active'`; `affiliates_in_debt_idx (negative_balance_since)` where `balance_cents < 0`, the collections queue, oldest first.
Constraints: `affiliates_negative_balance_has_clock` (both directions: a negative balance with no start date has no clock, and a start date with a cleared balance is a debt that was settled and left an alarm behind); `affiliates_no_self_parent`.
Retention: forever.
