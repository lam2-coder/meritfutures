### wallet_dormancy
**`SD-M20-04`**, INV-M20-09, AS-M20-07.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `identity_id` | uuid | pk, fk identities, on delete restrict | |
| `last_activity_at` | timestamptz | not null | |
| `notified_at` | timestamptz[] | not null default `'{}'` | an array because the notification schedule is a **sequence**, and "did we notify them" is answered by the whole sequence rather than by the last one. A single timestamp would make the second notice overwrite the proof of the first |
| `state` | text | not null default `active`, check in (`active`,`dormant`,`escheat_review`) | |
| `jurisdiction_hint` | text | null | a **hint**, not a determination. The jurisdiction governing an unclaimed balance is a legal question, and this column records our best guess so counsel has something to correct rather than nothing to look at |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `wallet_dormancy_state_idx (state, last_activity_at)` where `state <> 'active'`.
Constraints: `wallet_dormancy_review_was_noticed` (reaching `escheat_review` without ever having notified the trader is the failure this table exists to prevent).
Unclaimed-property obligations are jurisdictional and real, and the alternative to a state machine is **discovering the obligation during an audit**. Dormancy is designed now; escheatment itself is a counsel question (OQ-M20-04 as ruled), which is why the dormancy calendar is blocked on the counsel sitting. The state machine can be built and exercised without the calendar; the calendar cannot be retrofitted onto balances nobody tracked.
