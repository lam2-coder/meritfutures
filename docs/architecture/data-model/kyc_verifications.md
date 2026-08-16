### kyc_verifications
Merit stores **status and references only**. Documents, images, and biometric templates never touch Merit storage ([VG-10](../../../research/VIBE_FAILURE_POSTMORTEMS.md)).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `provider` | text | not null | Sumsub, Veriff, Persona class. The adapter is vendor-agnostic (M19 section 1.1) and the selected provider is named in the privacy policy at selection time, which makes provider choice a disclosure event and not only a procurement one ([ADR-021](../../decisions/ADR-021.md)) |
| `provider_applicant_id` | text | not null | the only pointer we keep |
| `state` | `kyc_status` enum(`kyc_required`,`pending`,`verified`,`rejected`,`expired`) | not null | mirrors the provider lifecycle |
| `placement` | text | not null, check in (`first_purchase`,`second_distinct_account_purchase`,`second_purchase_any`,`eval_pass`,`pre_funded`,`direct_purchase`,`payout_request`) | **Widened by `U-05` under [ADR-021](../../decisions/ADR-021.md).** Records **which trigger fired**, not which set was configured. `pre_eval` is retired into `first_purchase`; `payout_request` is invalid as a sole trigger and exists only as a backstop. The frozen `kyc.triggers` value is `['second_distinct_account_purchase','pre_funded']` |
| `document_country` | char(2) | null | geo-consistency triangle, recorded as three columns so a disagreement is visible rather than resolved silently |
| `ip_country` | char(2) | null | |
| `payment_country` | char(2) | null | |
| `biometric_dedupe_hit` | boolean | not null default false | the fleet-killer signal. Survives [ADR-029](../../decisions/ADR-029.md) because **a boolean cannot contradict a set; it can only be stale, and staleness is detectable** |
| `rejection_reason` | text | null | |
| `verified_at` | timestamptz | null | |
| `expires_at` | timestamptz | null | drives re-verification |
| `raw_result` | jsonb | not null default `'{}'` | provider decision metadata only, **never document data** |
| `verification_purpose` | text | not null, check in (`initial`,`reverify_destination`,`reverify_flag`,`reverify_dormant`,`reverify_expiry`) | **`SD-M19-01`.** A re-verification is a new row, or the system cannot distinguish "we checked again today" from "we looked at what we already had" (INV-M19-06) |
| `supersedes` | uuid | fk kyc_verifications, null, on delete restrict | **`SD-M19-01`** |
| `liveness_passed` | boolean | null | **`SD-M19-01`** |
| `liveness_method` | text | null | **`SD-M19-01`.** Recorded because liveness techniques and their defeat rates move quickly: an enforcement decided on a 2027 liveness check needs to know which technique produced it (AS-M19-06), and a boolean alone ages into an assertion nobody can re-evaluate |
| `created_at`, `updated_at` | timestamptz | not null default now() | |
| ~~`dedupe_matched_identity_id`~~ | ~~uuid~~ | **never created, by [ADR-029](../../decisions/ADR-029.md)** | `dedupe_matches` (`SD-M19-04`) is authoritative. A dedupe hit is an **auto-enforcement input**: it bans an account without human review, and a system with two sources for that decision will eventually enforce on whichever is read first. Greenfield means the column is never created rather than created and dropped |

Indexes: `kyc_verifications_identity_state_idx (identity_id, state)`; `kyc_verifications_dedupe_hit_idx (biometric_dedupe_hit)` where true; `kyc_verifications_supersedes_idx (supersedes)` where not null; `kyc_verifications_placement_idx (placement, created_at desc)`, which is the per-placement funnel telemetry [ADR-021](../../decisions/ADR-021.md) made a condition of its acceptance.
Constraints: `kyc_verifications_supersession_matches_purpose` (an `initial` supersedes nothing and every other purpose supersedes something, so the chain has no holes); `kyc_verifications_no_self_supersede`.
Retention: forever (AML obligation), PII minimal by construction.
