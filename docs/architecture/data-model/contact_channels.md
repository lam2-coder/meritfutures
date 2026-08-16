### contact_channels
**`SD-M16-03`**, INV-M16-03.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `kind` | text | not null, check in (`email`,`push`,**`sms`**) | **`sms` is `SD-M16-06`**, [ADR-039](../../decisions/ADR-039.md) (c). `0019` wrote the check inline, so Postgres named it `contact_channels_kind_check`; `0029` drops it and re-adds it as `contact_channels_kind_allowed`, so the next widening does not depend on a generated name staying generated |
| `value_hash` | bytea | not null | hashed rather than the value: this table exists to notify a prior address and the sending path holds the address. A second plaintext copy of every address a trader has ever used buys nothing and costs a breach |
| `verified_at` | timestamptz | null | |
| `superseded_at` | timestamptz | null | |
| `superseded_by` | uuid | fk contact_channels, null, on delete restrict | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `contact_channels_live_uq (identity_id, kind)` where `superseded_at is null`; `contact_channels_recently_superseded_idx (superseded_at)` where not null, which is the countermeasure's read.
Constraints: `contact_channels_kind_allowed`; `contact_channels_supersession_is_complete`; `contact_channels_no_self_supersede`.
**`SD-M16-06` is what makes ADR-039 (c) buildable at all.** (c) requires notifying the **prior number** on a phone change, and until `0029` there was no row shape for a phone number here, so `INV-M16-03`'s countermeasure had nothing to notify. **The live-uniqueness index needed no change**: it is already per `(identity_id, kind)`, so it now also means one live SMS destination per identity, which is the correct reading and is what (b) implies for the delivery side. The identity node is [`identity_phones`](identity_phones.md), and it is a different table on purpose.
**The previous contact must exist as a row.** The account-takeover countermeasure is: when a contact changes, notify the **prior** contacts for a window. That is impossible if the contact is a column that was overwritten, which is why the countermeasure is so often missing. Supersession rather than update, for the same reason `daily_marks` supersedes.
