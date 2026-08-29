---
status: approved
depends_on: [README.md]
last_updated: 2026-08-29
---

### firm_parameters

**[ADR-252](../../decisions/ADR-252.md)**, [`0074`](../../../packages/db/migrations/0074_firm_parameters.sql), building [ADR-238](../../decisions/ADR-238.md) ruling 1. **Integer-valued numbers that belong to the firm rather than to any identity or any plan version, and the first member is the base account cap.** [`identities`](identities.md)`.max_accounts_override` is the per-entity **exception**; before this table there was no row holding the number it is an exception to.

**Why the cap could not stay where the corpus put it.** [data-model](README.md) section 11 states the value at `plan_versions.rules.limits.max_accounts_per_entity`, inside a per-plan-version jsonb blob, while the constitution enforces the cap against an identity's **total live accounts across every plan** (`B1`, `INV-M3-08`, `GS-094`). ADR-238 ruling 1 refuses all three ways of reading a per-version number as a per-identity one: the purchased version makes an identity's effective cap the **maximum over every published version**, so a buyer picks their own cap by picking a plan; the pinned version on the reset path reads a row that may have been retired years earlier; and requiring every published version to agree is a firm parameter wearing a plan's costume, which no `CHECK` can express because a `CHECK` cannot read another row.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `parameter` | text | pk part, check in (`base_account_cap`) | **The closed vocabulary.** [`price_floors`](price_floors.md)`.product_ref` is bare text and this deliberately is not: a product reference names a thing the catalogue already constrains, while a parameter **name** constrains nothing but itself, so an unchecked one is a configuration file wearing a primary key. A `CHECK` rather than an enum type, on [`0073`](../../../packages/db/migrations/0073_operator_directory.sql)'s precedent for `role`: an enum label cannot be removed |
| `integer_value` | integer | not null, **no default**, positive for `base_account_cap` | **A count and not cents**, and `identities.max_accounts_override` is `integer` one table over, so the base and the exception agree on their type. **The type is the second closure**: there is no `text_value`, no `cents_value` and no `jsonb_value`, so a firm parameter that is not an integer belongs in another table rather than in a second column here. **No default, because a default is a constant** and every one of these values is a launch candidate confirmed at launch as a row |
| `reason` | text | not null | A cap bounds how much exposure one buyer may accumulate, and a liability decision with no written rationale is one nobody can defend at the next review. `price_floors.reason` carries the same sentence |
| `effective_from` | timestamptz | pk part | **Supersession is a new row rather than an update**, so the number in force on the day a purchase was refused stays readable after the number has moved. A row dated in the future has not arrived and does not bind yet, which is `wallet_spend_limits`' idiom |
| `approved_by` | text | not null, **fk** [`operators`](operators.md)`(actor)` on update restrict, on delete restrict | **A referent rather than a string, and this is where the table is tighter than its own precedent.** `price_floors.approved_by` is bare text on `0002`'s actor idiom because no operator directory existed when `0024` was written; `0073` built one, so **a cap approved by a name in no directory cannot be written at all**. `RESTRICT` in both directions because an approval is a historical fact rather than a pointer at whoever holds the seat today |
| `created_at` | timestamptz | not null default now() | |

Indexes: `firm_parameters_current_idx (parameter, effective_from DESC)`, for the `ORDER BY effective_from DESC LIMIT 1` read every consumer will make. That is `price_floors_current_idx`'s shape.
Constraints: `firm_parameters_vocabulary_is_closed` (`parameter IN ('base_account_cap')`); `firm_parameters_base_account_cap_is_positive` (`parameter <> 'base_account_cap' OR integer_value > 0`, so the bound belongs to the parameter and a later member with a different domain gets its own disjunct rather than loosening the cap's).

**The grain is `(parameter, effective_from)` and it is the whole primary key**, so the table has no uuid of its own. That is `price_floors`' shape exactly, and it carries the same known consequence: `dual_control_approvals.subject_id` is `uuid NOT NULL`, so a dual control asserted over this table could not name its subject either. **No dual control is asserted over it today** and none is invented here.

**The table ships empty and that is the control.** Nothing in this repository writes a row, and nothing writes the [`operators`](operators.md) row `approved_by` requires either. **An absent row is NO CAP and it is not an unlimited one**: folding an absent row into an unlimited cap, or skipping the comparison when the read returns nothing, is a control that answers yes to everybody on the endpoint that sells accounts. Whichever slice writes the read owes a **refusal** there before it owes anything else.

Scope class: **`firm`.** The row declares no column against `identities(id)` and none against `accounts(id)`. The available mistake is `derived` via `operators` through `approved_by`, and the edge is real, `NOT NULL` and single valued, so such a rule would compile; it is refused because `operators` is itself `firm`, so the chain terminates at a table with no identity on it. **An approver is also not an owner**: the operator who signs a cap does not thereby hold the number.

**It is registered and it is not admitted to the catalogue door.** `CATALOG_TABLE_KEYS` is a closed list of five in `packages/db/src/scoped-db.ts` and this key is deliberately not one of them, so a **scoped** transaction still cannot read this table. That is what `accountCap()` needs, because `INV-M3-15` requires the restriction check at the same point in the transaction as the cap. `ApiDb.firm` reaches it today; a scoped read is a `packages/db` diff with [ADR-233](../../decisions/ADR-233.md)'s argument attached, and ADR-252 did not make it.

Retention: **forever.** A refused purchase is a `409` a buyer will ask about, and answering requires the number that was in force when it was refused.
