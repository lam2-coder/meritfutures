### identities
The resolved human. Account caps, aggregate liability, and ring detection all key here.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk, default `gen_random_uuid()` | external reference |
| `display_name` | text | null | reserved for future leaderboards; nullable because v1 never shows it |
| `leaderboard_opt_in` | boolean | not null default false | reserved per the Wave 1 schema list, cheap now, migration later otherwise |
| `status` | `identity_status` enum(`active`,`restricted`,`closed`) | not null default `active` | restriction and closure are identity-level, not account-level |
| `status_reason` | text | null | the human-readable half of an audited decision; **required by check when status is not `active`** |
| `max_accounts_override` | integer | null, check > 0 | per-entity cap override for legitimate edge cases (grandfathered merges, B4 #17) |
| `payouts_frozen` | boolean | not null default false | investigation freeze, set before request time only |
| `frozen_reason` | text | null | ToS citation shown to the trader |
| `frozen_at` | timestamptz | null | drives the freeze-duration alert |
| `support_contact_ref` | text | null | **`SD-M10-04`.** The Chatwoot contact pointer, so a support conversation resolves to an identity without Merit storing transcripts. One column instead of a conversation table is the point: Merit is not a second copy of the support system |
| `first_seen_at` | timestamptz | not null default now() | cohort analysis |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `identities_status_idx (status)` where `status <> 'active'`; `identities_payouts_frozen_idx (payouts_frozen)` where true.
Constraints: `identities_freeze_is_explained` (a freeze carries both `frozen_reason` and `frozen_at`); `identities_status_is_explained` (a non-active status carries `status_reason`).
Retention: forever (financial counterparty record).
Why the freeze check exists: a freeze with no reason and no clock is an indefinite hold nobody owns, and `frozen_at` is what drives the alert that binds on Merit rather than on the trader.
