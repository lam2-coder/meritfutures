### graduation_benefits
**`SD-M18-02`**, INV-M18-06, INV-M18-10.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `benefit_code` | text | not null | |
| `accrued_cents` | bigint | not null, check >= 0 | |
| `basis` | text | **not null** | **`SD-M18-02`.** How `accrued_cents` was derived, in words a trader can check. A number on a screen with no stated derivation is read as a promise, and the trader is not wrong to read it that way |
| `conferred_at` | timestamptz | null | |
| `withheld_reason` | text | null | **`SD-M18-02`.** Lets the risk review hold a benefit without silently dropping it, which is the difference between a decision and a disappearance |
| `criteria_version` | integer | not null, check > 0 | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `graduation_benefits_identity_idx (identity_id)`; `graduation_benefits_account_idx (account_id)`; `graduation_benefits_pending_idx (created_at)` where neither conferred nor withheld, the review queue.
Constraints: `graduation_benefits_not_both_conferred_and_withheld`.

**The reserved sequence (`0025`).** Three tables, **created and deliberately empty at launch**. Marked rather than deferred, because [ADR-026](../../decisions/ADR-026.md) rejected no delta: a rejected delta is rejected in writing in an ADR, never by omission, and a table that quietly failed to appear is indistinguishable from one that was dropped. Each costs an empty table now and avoids a migration against live data later, which is the same trade §12 documents for every other reservation.
