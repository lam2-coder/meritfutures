### identity_restriction_episodes
**`U-09`**, [ADR-041](../../decisions/ADR-041.md). The identity-level restriction as a row, created by [`0031`](../../../packages/db/migrations/0031_payout_hold_and_identity_restriction.sql).

**The state is not created here.** `identity_status` has carried a reversible `restricted` since [`0001`](../../../packages/db/migrations/0001_extensions_and_enums.sql), its explained-reason CHECK since [`0002`](../../../packages/db/migrations/0002_identity.sql), its machine since [STATE_MACHINES section 9](../STATE_MACHINES.md), and its event since [EVENTS](../EVENTS.md). What ADR-041 found missing was the **binding surface**, and what this table adds is the **episode**: who restricted, citing what, when, under which ToS clause, and what documented act ended it.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | **per human.** A restriction halts every linked account at once; the set of accounts changes while the episode is open, which is why it does not decompose into per-account rows |
| `flag_id` | uuid | fk risk_flags, **not null**, on delete restrict | the cited flag. **`not null` and that is the point**: a restriction citing no flag is an accusation with no numbers behind it, which is the shape `0008`'s whole module exists to refuse. The freeze columns elsewhere are nullable only because the row exists before the freeze does; an episode row exists **only** because a restriction happened |
| `tos_clause` | text | not null | the clause the trader is shown |
| `reason` | text | not null | the written reason. **GS-117**: the typed reason gates the confirm control, and this is where it lands |
| `opened_by` | text | not null | the actor. Admin, never a detector: [ADR-041](../../decisions/ADR-041.md) puts the entry point on [M06](../../plans/M06-admin-ops-console.md)'s flags queue and identity drill-down, both v1 surfaces, on the `investigating` to `enforced` path |
| `opened_at` | timestamptz | not null default now() | |
| `sla_due_at` | timestamptz | null | **[ADR-040](../../decisions/ADR-040.md)'s 48 hours, where a payout is pending.** It **binds the restriction rather than the payout**, which is the property that stops Ruling B becoming a route around Ruling A. **The column does not enforce that property and the migration says so**: it compares against `payout_requests.hold_expires_at` on another table, which no CHECK can reach. It is asserted by a golden scenario and by ADR-040's hold-expiry alarm, which fires on the payout regardless of why nobody released it |
| `restored_at` | timestamptz | null | the restore branch |
| `restored_by` | text | null | the restoring actor |
| `restore_evidence` | text | null | the human-side proof. `text` rather than `jsonb` because the machine-side proof is a **confirmed `set_risk` row** in `provisioning_queue`, and `provisioning_queue_set_risk_never_inferred` (`U-06`) is what makes that confirmation real |
| `evidence_pack_id` | uuid | fk evidence_packs, null, on delete restrict | the pack exported by the M06 enforcement path that opened the episode. **Nullable for two stated reasons**: `evidence_packs.account_id` is `not null` and account-scoped while a restriction is per human and may precede any account (**`OI-06`**), and the workflow requirement that a pack exist belongs to M06, which owns the surface, rather than to a CHECK that would make an identity-level enforcement unwritable for an identity with no account |
| `created_at`, `updated_at` | timestamptz | not null default now() | **not append-only.** The restore updates the row it opened, which is why the table is absent from `0026`'s revoke list |

Indexes: unique `identity_restriction_episodes_open_uq (identity_id)` where `restored_at is null`; `identity_restriction_episodes_identity_idx (identity_id, opened_at desc)`; `identity_restriction_episodes_sla_due_idx (sla_due_at)` where open and clocked.
Constraints: `identity_restriction_episodes_restore_is_complete` (the restore trio, all three or none); `identity_restriction_episodes_sla_after_open`; `identity_restriction_episodes_restore_after_open`.
Retention: forever (enforcement record).

**Why it is a row and not a column.** `identities` carries `status` and `status_reason` and nothing else, while `accounts` has had `account_status_history` since [`0007`](../../../packages/db/migrations/0007_accounts.sql). A repeat restriction would overwrite its predecessor and **a restore would be unprovable at exactly the moment it is contested**.

**Why at most one open episode.** Two open episodes on one human means two restore actions, each able to lift a restriction the other still holds, and whichever runs second silently un-restricts a trader nobody cleared. The partial unique refuses it in the database because the console is not the only writer, which is `SD-09`'s argument one table over.

**Distinct from its two neighbours, in one sentence.** Closure for cause is terminal and per account; a freeze is per payment and expires; **a restriction is per human, halts everything, and is reversed by a documented restore.**

**Restoration is PROVISIONAL under [ADR-005](../../decisions/ADR-005.md), and the honest form is an asymmetry rather than a caveat.** Suspension is always available; **restoration is contingent on `V-M2-15`**. With neither an acknowledgement artifact nor a readable current risk setting, a restored account cannot be confirmed, and under `INV-M2-13` an unconfirmed account does not trade. This table is written so a restore is **provable when it happens**; it does not make one possible.
