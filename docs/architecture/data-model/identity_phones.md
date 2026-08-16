### identity_phones
**`SD-M19-05`**, [ADR-039](../../decisions/ADR-039.md) (a), (b) and amendment 3. Created by [`0029_phone_identity_and_auth`](../../../packages/db/migrations/0029_phone_identity_and_auth.sql).

**A verified phone is an identity signal and not a contact field**, and this table is the difference between those two sentences. Emails are free to mint and real mobile numbers are scarce, so the number is worth more to [ADR-022](../../decisions/ADR-022.md)'s link-confidence graph as a node than it is worth to [M16](../../plans/M16-notification-center.md) as a delivery address. The delivery address is [`contact_channels`](contact_channels.md), which `SD-M16-06` widens for `sms`. **The two tables are not redundant**: one is who this person is, the other is where a message goes, and collapsing them is how a contact-preference edit becomes an identity change.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `phone_hash` | bytea | not null | **hashed, never raw**, for `contact_channels`' reason exactly: this table exists to decide and to notify, and the sending path holds the number. A second plaintext copy of every number a trader has ever used buys nothing and costs a breach |
| `phone_ciphertext` | bytea | null | **`ADR-046`, `OQ-M10-06`.** The number, envelope-encrypted, so [SECURITY section 4.8](../SECURITY.md) leg 2 has a destination: a security notice to the **verified** number, which Merit initiates. **Superseded and released rows keep theirs**, because [ADR-039](../../decisions/ADR-039.md) (c) requires notifying the prior number and a ciphertext cleared on supersession leaves the same gap one table over |
| `phone_key_id` | text | null | which key encryption key sealed it, resolved outside this database |
| `phone_encrypted_at` | timestamptz | null | when it was last sealed |
| `phone_preview` | text | null | non-identifying display fragment, on `identity_signals.value_preview`'s pattern: enough to recognise, not enough to reconstruct |
| `country_code` | char(2) | not null, check `^[A-Z]{2}$` | ISO-3166-1 alpha-2 derived from the E.164 prefix at capture. Same type and regex as `users.country_code` and the three country columns on `kyc_verifications`, because a fourth spelling of "country" is how a join silently returns nothing |
| `verified_at` | timestamptz | null | null means captured and not yet proven, which is a real and common state: the row is written at capture so the carrier lookup has somewhere to land before the OTP is answered |
| `superseded_at` | timestamptz | null | (c). The prior number remains a row |
| `superseded_by` | uuid | fk identity_phones, null, on delete restrict | |
| `released_at` | timestamptz | null | **amendment 3, the recycling guard's output.** Carriers reassign numbers. When portability history shows the number left this identity's control, the row is **released** rather than superseded: nothing replaced it, the person simply no longer holds it |
| `release_evidence` | jsonb | not null default `'{}'` | the portability record that justified the release. A release with no evidence is an assertion, and `identity_phones_release_is_evidenced` refuses one |
| `line_type` | text | not null default `unknown`, check in (`mobile`,`landline`,`voip`,`prepaid`,`unknown`) | (a). `unknown` is the fail-open value and it is the **default**, because the call site inherits checkout's failure posture verbatim: non-blocking, fail-open on timeout. **There is no constraint anywhere refusing a line type, and that absence is the ruling: VoIP is scored, never rejected** |
| `carrier_name` | text | null | (a) |
| `carrier_country` | char(2) | null, check `^[A-Z]{2}$` | the carrier's country, which is not always the number's |
| `ported` | boolean | null | **nullable on purpose, and the null is not a `false`** |
| `last_ported_at` | timestamptz | null | amendment 3's input. The guard compares this against the linked identity's ban date |
| `footprint_present` | boolean | null | **three-valued because the lookup fails open.** Null is "we do not know", false is "the vendor looked and there is none". The **fleet signature** (VoIP plus a fresh email plus a datacenter IP plus no footprint) scores on `footprint_present = false`; a detector written against `IS NOT TRUE` would score every timeout as a fleet member and turn a vendor outage into a mass false positive |
| `lookup_provider` | text | null | which vendor said so, for `kyc_verifications.liveness_method`'s reason: a bare value ages into an assertion nobody can re-evaluate |
| `lookup_at` | timestamptz | null | and when |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique **`identity_phones_live_per_identity_uq (identity_id)`** where `verified_at is not null and superseded_at is null and released_at is null`; `identity_phones_live_number_idx (phone_hash)` on the same predicate and **deliberately not unique**; `identity_phones_history_idx (phone_hash, created_at desc)`; `identity_phones_identity_idx (identity_id, created_at desc)`; `identity_phones_key_rotation_idx (phone_key_id)` where `phone_ciphertext is not null`.
Constraints: `identity_phones_supersession_is_complete`; `identity_phones_no_self_supersede`; `identity_phones_release_is_evidenced`; `identity_phones_one_ending`; `identity_phones_port_date_implies_ported`; `identity_phones_lookup_is_attributed`; **`identity_phones_ciphertext_is_complete`**; **`identity_phones_ciphertext_refuses_plaintext`**.

**`identity_phones_ciphertext_refuses_plaintext` is `INV-M10-12` as a constraint**, and on this table the refusal is **total**: `octet_length(phone_ciphertext) >= 29` when not null (a 12-byte nonce, a 16-byte GCM tag, one byte sealed), against a column that holds a telephone number and nothing else. E.164 is a `+` and at most fifteen digits, so 16 bytes is the ceiling of the entire address space this column can hold and every value of it is below the floor. See [`contact_channels`](contact_channels.md) for the full argument and for the one place the refusal is partial.
Grants: `merit_dispatcher` holds `SELECT`, and `UPDATE` on the three sealed columns only. No `DELETE` ([ADR-046](../../decisions/ADR-046.md)).
Retention: forever (fraud history), on `identity_signals`' `payment` and `kyc_identity` precedent.

**The unique index on `phone_hash` is deliberately absent, and its absence is the ruling.** [ADR-039](../../decisions/ADR-039.md) splits (b)'s hard link in two. **Identity to phone** is a database constraint: one live verified phone per identity, which `identity_phones_live_per_identity_uq` is. **Phone to identity is not.** A second identity verifying a number already live elsewhere **completes**, writes the edge at the hard-link confidence ceiling, and opens a **severity-5 flag against both identities**, changing no state automatically. A reader who "finishes the pair" by making `phone_hash` unique refuses the innocent owner of a recycled number at the door, before the portability check that exists to rescue them can run. [AS-M19-05](../../plans/M19-kyc-identity.md) already says that person belongs in a review queue.

**Three ending states, and they are not the same ending.** Live, **superseded** (the trader replaced it), and **released** (the carrier took it back). `identity_phones_one_ending` forbids both at once, because conflating them loses the only distinction amendment 3 turns on. **A released row frees the live index**, which is what lets an identity whose number was reassigned verify a new one without an operator unpicking anything.

**A port date implies the port flag, and the converse is deliberately not asserted.** A vendor may report that a number was ported without saying when. That state is exactly the one the recycling guard cannot resolve, so it routes to review; forbidding it would force the writer to invent a date, which is worse than recording that the date is missing.

**Hashed, never raw, and now sealed as well, which are not the same claim.** [ADR-046](../../decisions/ADR-046.md) leaves `phone_hash` exactly where it is: it is what `identity_phones_live_number_idx` and `identity_phones_history_idx` match on, and (b)'s deliberate non-uniqueness is untouched. What the sealed columns add is a **destination**, for the class of message Merit itself initiates, which had none. The stated goal, that a database dump yields no usable number, is preserved by the key living outside the database rather than by the value being irrecoverable.
