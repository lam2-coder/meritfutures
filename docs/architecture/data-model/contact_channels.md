### contact_channels
**`SD-M16-03`**, INV-M16-03.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `kind` | text | not null, check in (`email`,`push`) | |
| `value_hash` | bytea | not null | hashed rather than the value: this table exists to notify a prior address and the sending path holds the address. A second plaintext copy of every address a trader has ever used buys nothing and costs a breach |
| `verified_at` | timestamptz | null | |
| `superseded_at` | timestamptz | null | |
| `superseded_by` | uuid | fk contact_channels, null, on delete restrict | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `contact_channels_live_uq (identity_id, kind)` where `superseded_at is null`; `contact_channels_recently_superseded_idx (superseded_at)` where not null, which is the countermeasure's read.
Constraints: `contact_channels_supersession_is_complete`; `contact_channels_no_self_supersede`.
**The previous contact must exist as a row.** The account-takeover countermeasure is: when a contact changes, notify the **prior** contacts for a window. That is impossible if the contact is a column that was overwritten, which is why the countermeasure is so often missing. Supersession rather than update, for the same reason `daily_marks` supersedes.
