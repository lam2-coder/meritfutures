### certificates
**`SD-M4-01`**, **`SD-M11-01`**, **`SD-M11-02`**, **`SD-M11-03`**. The card is a rendering; the certificate is the row.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `kind` | text | not null, check in (`pass`,`payout`) | |
| `payout_request_id` | uuid | fk payout_requests, null, on delete restrict | |
| `claims` | jsonb | not null | what Merit actually issued: plan, size, trading day, and amount for a payout card. The public verification page states these **from the signed row**, never from the image |
| `signature` | bytea | not null | |
| `signing_key_id` | text | not null | **`SD-M11-01`**, INV-M11-06. Without a key id, the first rotation makes every historical signature unverifiable, which means either the key is never rotated or the history is discarded. Both are worse than the column |
| `code` | text | not null | **`SD-M11-01`.** The short unguessable token in the image. **Distinct from `id`** so the public token can be rotated after an incident without rewriting the primary key or breaking every foreign key pointing at it |
| `claims_schema_version` | integer | not null default 1, check > 0 | **`SD-M11-01`**, INV-M11-05. Lets the claim shape evolve without making old cards unreadable |
| `issued_at` | timestamptz | not null default now() | |
| `revoked_at` | timestamptz | null | |
| `revoked_reason` | text | null | **internal** free text |
| `revocation_class` | text | null, check in (`fact_untrue`,`account_enforced`,`issued_in_error`,`trader_request`) | **`SD-M11-02`**, INV-M11-07. The class drives the **published** sentence; the free text stays internal (AS-M11-05). Free text on a public page is how an enforcement gets described inconsistently twice |
| `deferred_until` | timestamptz | null | **`SD-M11-03`** |
| `deferred_reason` | text | null | **`SD-M11-03`**, INV-M11-09. An achievement earned while a flag is open is still an achievement. Deferral needs a state, or the alternative is issuing a card Merit may have to revoke publicly within the week, and a public revocation costs more than a private delay |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `certificates_code_uq (code)`, the verify page's only lookup key; `certificates_account_idx (account_id, issued_at desc)`; `certificates_identity_idx (identity_id, issued_at desc)`; `certificates_deferred_idx (deferred_until)` where not null.
Constraints: `certificates_payout_kind_has_request`; `certificates_revocation_is_complete`; `certificates_deferral_is_explained`.
Retention: forever.
Why the table exists at all (`SD-M4-01`): [API_CONTRACT section 6](../API_CONTRACT.md) returns a `certificate_id` and a `verify_url`, and the approved design had **no table behind either**. Without a row there is nothing to verify against, and a "verifiable" share card that verifies nothing is worse than no card at all (AS-M4-03), because the transparency moat inverts: forged proof of payouts damages the thing it imitates. An unverifiable card is reported as unverifiable, never as false.

**Transparency (`0021`).** Not a money-path file, and the one whose output is hardest to take back. `0021` also creates the helper function `measures_are_distinct(statistic_measure[])`, which exists because a `CHECK` may not contain a subquery and duplicate detection over an array needs one; it is `IMMUTABLE` because it reads nothing outside its argument, which is what makes it legal in a `CHECK` rather than merely accepted there.
