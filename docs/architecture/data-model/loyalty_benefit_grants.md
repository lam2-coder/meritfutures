### loyalty_benefit_grants
**`SD-M14-02`**, INV-M14-07, INV-M14-09.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `benefit_code` | text | not null | |
| `criteria_version` | integer | not null | **`SD-M14-02`.** Which published criteria version earned it. Composite FK to `loyalty_criteria (benefit_code, version)`, so a grant can never cite a version that was never published |
| `earned_on_trading_day` | date | not null | |
| `expires_at` | timestamptz | null | |
| `consumed_at` | timestamptz | null | |
| `consumed_ref` | uuid | null | **`SD-M14-02`.** Polymorphic: an offer id or a purchase id. Not a foreign key because it is two kinds; the single-spend guarantee is the partial unique index |
| `revoked_at`, `revoked_reason` | timestamptz, text | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `loyalty_benefit_grants_consumed_ref_uq (consumed_ref)` where not null; `loyalty_benefit_grants_identity_idx (identity_id, earned_on_trading_day desc)`; `loyalty_benefit_grants_live_idx (identity_id, expires_at)` where unconsumed and unrevoked.
Constraints: `loyalty_benefit_grants_criteria_fk`; `loyalty_benefit_grants_consumption_is_complete`; `loyalty_benefit_grants_revocation_is_explained`; `loyalty_benefit_grants_not_both_consumed_and_revoked` (if both happened, one of them is wrong and the write should fail rather than the accounting).
`criteria_version` is what stops a criteria change silently rewriting what past traders were promised. That is the FundingTicks failure, and it is the one this schema is built to make impossible.
