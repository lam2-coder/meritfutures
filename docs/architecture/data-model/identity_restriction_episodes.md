### identity_restriction_episodes
**`0031`**, [ADR-041](../../decisions/ADR-041.md). One row per restriction of one human.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk default `gen_random_uuid()` | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | The restriction is **per human**, which is the whole distinction from a per-account freeze |
| `flag_id` | uuid | fk risk_flags, not null, on delete restrict | The citation. `NOT NULL` rather than checked, because a restriction with no cited flag is an enforcement nobody can justify and there is no branch where it is legitimate |
| `tos_clause` | text | not null | |
| `reason` | text | not null | |
| `opened_by` | uuid | fk users, not null, on delete restrict | |
| `opened_at` | timestamptz | not null default now() | |
| `sla_due_at` | timestamptz | null | [ADR-040](../../decisions/ADR-040.md)'s 48 hours, **where a payout is pending**. Null when none is. **It binds the restriction rather than the payout**: a restriction cannot hold a held payout past its own 48 hours, and that is the property that stops Ruling B from becoming a route around Ruling A |
| `restored_at` | timestamptz | null | |
| `restored_by` | uuid | fk users, null, on delete restrict | |
| `restore_evidence` | text | null | |
| `evidence_pack_id` | uuid | fk evidence_packs, null, on delete restrict | The enforcement branch. An episode ending in closure for cause carries its pack; one ending in a restore does not |
| `created_at` | timestamptz | not null default now() | |

Indexes: `identity_restriction_open_uq (identity_id)` where `restored_at is null`, in `payout_requests_no_in_flight_uq`'s shape; `identity_restriction_sla_due_idx (sla_due_at)` where open and non-null, in `payout_requests_hold_expiry_idx`'s shape; `identity_restriction_identity_idx (identity_id, opened_at desc)`.

Constraints: `identity_restriction_restore_is_complete` (a restore carries its actor and its evidence, or it is not a restore, in `identities_freeze_is_explained`'s shape); `identity_restriction_restore_follows_open`.

**The episode is a row and not a column, and that is the finding.** `identities` carries `status` and `status_reason` and nothing else, while `accounts` has had `account_status_history` since `0007`. A repeat restriction would overwrite its predecessor and **a restore would be unprovable at exactly the moment it is contested**. The partial unique gives at most one open episode per identity; once restored, the index frees and the same human can be restricted again with the earlier episode intact.

**`restricted` was not renamed to `suspended`.** The state already existed in `identity_status`, already reversible, already a distinct third value, already on the trader's own `GET /me`. What was missing was never the state: it was the binding surface and this record. Two expressions of one concept is this repository's most repeated defect, and adding `suspended` beside `restricted` would have created one deliberately. Distinct from its two neighbours: **closure for cause is terminal and per account; a freeze is per payment and expires; a restriction is per human, halts everything, and is reversed by a documented restore.**

Retention: forever.
