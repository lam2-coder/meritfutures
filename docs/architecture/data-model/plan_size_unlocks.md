### plan_size_unlocks
**`SD-M18-04`**, INV-M18-11, INV-M18-12. [ADR-070](../../decisions/ADR-070.md) section 3, folded by [FOLD-05](../../plans/FOLD-05-plan-config-and-designer.md) section 4.2 in [`0044`](../../../packages/db/migrations/0044_fee_back_and_ladder_unlock.sql).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | **`SD-M18-04`. This foreign key IS the ruling.** ADR-070 section 3: an unlock reads the hard-merged identity and nothing weaker, on M07:94's "only a hard merge changes what a trader may buy". A hard merge **repoints ownership into the surviving `identities` row**; `identity_links` carries soft and hard-link edges and repoints nothing. So a soft-linked pair sharing an unlock is **unrepresentable** here rather than forbidden by a filter somebody has to remember |
| `plan_version_id` | uuid | fk plan_versions, not null, on delete restrict | The entitlement is per published rule set. An unlock earned under one version does not silently carry into the next, which is the reasoning that makes a published version immutable |
| `unlocked_size_cents` | bigint | not null, check > 0 | **What may now be purchased, and the only value this table confers.** It names a `plan_version_sizes.size_cents` and is deliberately **not** a foreign key to that row: the entitlement is to the size, so a version republishing the same size honours an unlock earned against it |
| `earned_account_id` | uuid | fk accounts, not null, on delete restrict | The account whose ladder completed. The evidence, and what a dispute is argued from |
| `earned_at` | timestamptz | not null default now() | |
| `revoked_at` | timestamptz | null | |
| `revoked_reason` | text | null | A revocation without a reason is a disappearance. `graduation_benefits.withheld_reason` makes the same argument one table over |
| `created_at` | timestamptz | not null default now() | |

Indexes: `plan_size_unlocks_identity_version_size_uq (identity_id, plan_version_id, unlocked_size_cents)` unique, so two completed ladders do not stack into two entitlements to one size and a retried grant fails rather than duplicating; `plan_size_unlocks_live_idx (identity_id, plan_version_id)` where not revoked, the purchase path's read; `plan_size_unlocks_earned_account_idx (earned_account_id)`.
Constraints: `plan_size_unlocks_revocation_is_explained`.

**Why this is not `loyalty_benefit_grants` or `graduation_benefits`**, because declining to reuse needs the argument. `loyalty_benefit_grants` is the structure [M14](../../plans/M14-loyalty-retention.md) `INV-M14-11` and `INV-M14-12` exist to keep inert ("no loyalty mechanic moves a per-account bound"; "cross-account loyalty confers no rule difference"), and an unlock is earned on **one account under one plan version** rather than from cross-account criteria. `graduation_benefits` carries `accrued_cents bigint NOT NULL` and `basis text NOT NULL`, so an unlock would land there as `accrued_cents = 0` with a basis explaining it is not money, which is the zero-value-row defect `GS-306` exists to prevent.

**It confers no rule change and that is asserted rather than argued.** [M18](../../plans/M18-graduation-track.md) `INV-M18-07` says graduation confers no rule change on any account; an unlock changes only **which `plan_version_sizes` row the identity may purchase**, and the account opened against it gets that version's published rules like everyone. The mechanical form is [`plan-size-unlocks.test.ts`](../../../packages/db/test/plan-size-unlocks.test.ts): **this table has nowhere to put a rule parameter**, and the test fails if a column that could hold one is ever added.
