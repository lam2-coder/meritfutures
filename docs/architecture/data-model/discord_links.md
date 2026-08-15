### discord_links
**`SD-M15-01`**, INV-M15-01, INV-M15-03.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `identity_id` | uuid | fk identities, not null, on delete restrict, pk part | |
| `discord_user_id` | text | not null, pk part | |
| `linked_at` | timestamptz | not null default now() | |
| `revoked_at` | timestamptz | null | |
| `role_opt_ins` | text[] | not null default `'{}'` | **an array because consent is per role.** A trader may be happy to be publicly "Funded" and not at all happy to be publicly "Recently Paid", and a single boolean would force one answer onto both |
| `link_nonce_hash` | bytea | not null | stored hashed so a stolen database yields no live link tokens, and it is what makes the link flow resistant to a replayed link request |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(identity_id, discord_user_id)`.
Indexes: unique `discord_links_live_discord_user_uq (discord_user_id)` where `revoked_at is null`; `discord_links_identity_idx (identity_id)`.
A Discord account links to at most one live identity. A link is never a credential and must not become one by accident of multiplicity.
