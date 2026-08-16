### contact_channels
**`SD-M16-03`**, INV-M16-03.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `kind` | text | not null, check in (`email`,`push`,**`sms`**) | **`sms` is `SD-M16-06`**, [ADR-039](../../decisions/ADR-039.md) (c). `0019` wrote the check inline, so Postgres named it `contact_channels_kind_check`; `0029` drops it and re-adds it as `contact_channels_kind_allowed`, so the next widening does not depend on a generated name staying generated |
| `value_hash` | bytea | not null | hashed rather than the value: this table exists to notify a prior address and the sending path holds the address. A second plaintext copy of every address a trader has ever used buys nothing and costs a breach |
| `verified_at` | timestamptz | null | |
| `value_ciphertext` | bytea | null | **`ADR-046`, `OQ-M10-06`. The address, held reversibly.** Envelope-encrypted under the key named by `value_key_id`, which is not in this database, so a dump yields the same nothing the hash yielded. **Nullable in two directions**: backwards, every row written before [`0034`](../../../packages/db/migrations/0034_reversible_contact_addresses.sql) has a hash and no ciphertext and is still valid; forwards, **erasure is a null**, which is what lets the privacy path clear an address without a `DELETE` |
| `value_key_id` | text | null | which key, not the key. An opaque identifier for the key encryption key and its version, resolved against a key manager outside this database. **It references no table here on purpose**: a key registry in the same database as the ciphertext is one dump away from being a key ceremony |
| `value_encrypted_at` | timestamptz | null | when it was last sealed. What a rotation sweep reports against |
| `superseded_at` | timestamptz | null | |
| `superseded_by` | uuid | fk contact_channels, null, on delete restrict | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `contact_channels_live_uq (identity_id, kind)` where `superseded_at is null`; `contact_channels_recently_superseded_idx (superseded_at)` where not null, which is the countermeasure's read; `contact_channels_key_rotation_idx (value_key_id)` where `value_ciphertext is not null`, which is the rotation sweep's read.
Constraints: `contact_channels_kind_allowed`; `contact_channels_supersession_is_complete`; `contact_channels_no_self_supersede`; **`contact_channels_ciphertext_is_complete`**.
Grants: `merit_dispatcher` holds `SELECT`, and `UPDATE` **on the three sealed columns only**. It holds no `DELETE`, on the founder's amendment to [ADR-046](../../decisions/ADR-046.md).
**`SD-M16-06` is what makes ADR-039 (c) buildable at all.** (c) requires notifying the **prior number** on a phone change, and until `0029` there was no row shape for a phone number here, so `INV-M16-03`'s countermeasure had nothing to notify. **The live-uniqueness index needed no change**: it is already per `(identity_id, kind)`, so it now also means one live SMS destination per identity, which is the correct reading and is what (b) implies for the delivery side. The identity node is [`identity_phones`](identity_phones.md), and it is a different table on purpose.
**The previous contact must exist as a row.** The account-takeover countermeasure is: when a contact changes, notify the **prior** contacts for a window. That is impossible if the contact is a column that was overwritten, which is why the countermeasure is so often missing. Supersession rather than update, for the same reason `daily_marks` supersedes.

**The value is hashed because the sending path holds the address, and until [ADR-046](../../decisions/ADR-046.md) the sending path held nothing.** That sentence is in `0019`'s comment and in the `value_hash` row above, and [M10](../../plans/M10-integrations.md) is the sending path: it stores no contact value by `INV-M10-02` and `INV-M10-03`, and `AS-M10-06` part 3 forbids a vendor holding one either. So `INV-M16-03`'s notification to a **prior** address had no destination on either channel, which is `OQ-M10-06` and is recorded as [`EC-146`](../../edge-cases/EC-146.md). **The three columns above are the holder those two documents already assumed existed.**

**The ciphertext is never matched on and the hash is.** `contact_channels_live_uq` does not move. A reader who indexes a ciphertext for uniqueness has to make the encryption deterministic to do it, and a deterministic ciphertext is an enumerable one: equal addresses become equal bytes and the dump the hashing exists to defeat becomes a lookup table again.
