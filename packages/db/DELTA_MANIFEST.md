---
status: review
depends_on: [../../docs/architecture/data-model/README.md, ../../docs/decisions/README.md]
last_updated: 2026-08-16
---

# Delta manifest

**The completeness gate reads this file.** [ADR-026](../../docs/decisions/ADR-026.md) requires that every `SD-nn` and `U-nn` appearing anywhere in `docs/` appears **exactly once** here with a disposition. A count nobody can drift is better than a count someone remembers to update.

**97 schema changes in scope: 88 numbered, 9 unnumbered.** No delta was rejected. 94 land in the v1 core sequence and 3 in the marked reserved sequence.

**The count moved from 93 to 94 by founder ruling (2026-08-14).** `U-06` is the sixth unnumbered change, found while folding. [ADR-026](../../docs/decisions/ADR-026.md)'s table of five did not carry it. See section 5.

**It moved from 94 to 97 on 2026-08-16**, when [ADR-040](../../docs/decisions/ADR-040.md) and [ADR-041](../../docs/decisions/ADR-041.md) landed as `0030` and `0031`: `U-07`, `U-08` and `U-09`, all three unnumbered for the same reason the first six were, which is that a ruling arrived with no delta number attached. **This sentence and the one above it are the only place the total is written by hand**; the checked figure is the `manifest_changes` span in [STATE](../../docs/STATE.md) and [INDEX](../../docs/INDEX.md), which counts the rows rather than trusting the prose.

Migrations are sacred: once merged, never edited, only superseded. Greenfield rule: every delta is **folded at create**, not applied as a base-plus-ALTER chain, because the repository contains no application code and no database.

## 1. The migration sequence

<!--gen:migration_files-->30<!--/gen--> files. Money-path files open with an `E2 READ: MONEY PATH` header naming what needs the founder's line-by-line read and why; <!--gen:e2_files-->20<!--/gen--> of them do.

**This heading read "27 files" while 28 were on disk, and the table below stopped at `0027`.** Both are corrected here rather than only counted: `0028` merged with [ADR-035](../../docs/decisions/ADR-035.md) and was never rowed. `0029` is **reserved and unwritten** ([ALLOCATION](../../docs/decisions/ALLOCATION.md)), which is why the sequence below skips it and why `CI-06h` asserts gaplessness over allocated **plus reserved** rather than over the directory.

| # | File | Money path | Contents |
|---|---|---|---|
| 0001 | `extensions_and_enums` | yes | extensions, every enum type, `payout_status` as ruled by ADR-028 |
| 0002 | `identity` | yes | `identities`, `identity_signals`, `identity_links`, `identity_merges`, `users`, `passkeys`, `otp_challenges`, `sessions` |
| 0003 | `kyc` | yes | `kyc_verifications`, `sanctions_screenings`, `kyc_funnel_events`, `dedupe_matches` |
| 0004 | `catalog` | yes | `plans`, `plan_versions`, `plan_version_sizes`, `tos_versions`, `tos_acceptances`, `geo_restrictions`, `contract_specs`, `trading_calendar` |
| 0005 | `affiliate_program` | narrow | `affiliates`, `affiliate_creatives`, `affiliate_clicks` |
| 0006 | `commerce` | yes | `coupons`, `purchases`, `coupon_redemptions`, `psp_webhook_events`, `mid_health` |
| 0007 | `accounts` | yes | `accounts`, `account_status_history`, `platform_account_refs`, `provisioning_queue`, `platform_entitlements` |
| 0008 | `risk` | no | `detector_definitions`, `detector_runs`, `risk_flags`, `correlation_groups`, `evidence_packs` |
| 0009 | `ledger` | yes | `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `treasury_balances`, `liability_snapshots` |
| 0010 | `payouts` | yes | `payout_requests`, `payout_transfers` |
| 0011 | `wallet` | yes | `wallet_entries`, `wallet_withdrawals`, `wallet_spend_limits`, `wallet_dormancy` |
| 0012 | `disputes_and_affiliate_settlement` | yes | `payment_disputes`, `attributions`, `affiliate_commissions`, `affiliate_statements` |
| 0013 | `ingest` | no | `ingest_files`, `raw_ingest_rows`, `fills` |
| 0014 | `marks` | yes | `daily_marks`, `reconciliations` |
| 0015 | `rule_states` | yes | `rule_states` |
| 0016 | `treasury_controls` | yes | `plan_breaker_state`, `alarm_suppressions`, `dual_control_approvals`, `ledger_halts` |
| 0017 | `events_and_audit` | no | `events`, `admin_actions`, `idempotency_keys` |
| 0018 | `integrations` | no | `integration_contracts`, `integration_dispatches`, `support_context_views` |
| 0019 | `notifications_and_community` | no | `notification_kinds`, `notifications`, `notification_preferences`, `contact_channels`, `discord_links`, `discord_announcements` |
| 0020 | `public_surface` | no | `content_documents`, `page_revalidations`, `certificates` |
| 0021 | `transparency` | narrow | `statistic_definitions`, `published_statistics`, `review_requests`, `proof_links` |
| 0022 | `analytics_journal` | no | `round_trips`, `journal_entries`, `analytics_snapshots` |
| 0023 | `loyalty_and_graduation` | no | `loyalty_criteria`, `loyalty_states`, `loyalty_benefit_grants`, `graduation_benefits` |
| 0024 | `offers` | yes | `offer_experiments`, `offers`, `price_floors`, `promotional_credit_grants` |
| 0025 | `reserved_sequence` | no | `identity_signal_weights`, `graduation_invitations`, `certificate_verifications` |
| 0026 | `roles_and_grants` | yes | application role, append-only grants (VG-8), analytics role |
| 0027 | `triggers_invariants` | yes | zero-sum, LEDGER-C1, LEDGER-C2, immutability triggers |
| 0028 | `supersede_plan_version_immutability` | yes | [ADR-035](../../docs/decisions/ADR-035.md). Replaces the published-plan-version guard's body and re-adds seven `array_length` CHECKs as `cardinality`. Adds no object |
| 0030 | `payout_hold_enum` | yes | [ADR-040](../../docs/decisions/ADR-040.md). `payout_status` gains `held_pending_review`. **One statement, no `BEGIN`/`COMMIT`** |
| 0031 | `payout_hold_and_identity_restriction` | yes | [ADR-040](../../docs/decisions/ADR-040.md) and [ADR-041](../../docs/decisions/ADR-041.md). The hold trio and its CHECK, both `SD-09` predicates widened, the hold-expiry index, `wallet_withdrawals_frozen_cannot_settle`, `identity_restriction_episodes`, and the replacement `COMMENT ON TABLE payout_requests` |

### Two forward references, and why they are not an ALTER chain

The greenfield rule folds every delta at create. It does **not** abolish genuine reference cycles, and there are exactly three:

1. **`purchases.parent_account_id` -> `accounts`**, while `accounts.purchase_id` -> `purchases`. The foreign key is added in `0007_accounts`.
2. **`purchases.wallet_ledger_transaction_id`** (SD-M3-06) -> `ledger_transactions`, which is created in `0009` because `accounts` must precede `0010_payouts`. The foreign key is added in `0011_wallet`.
3. **`accounts.terminal_settlement_id`** (SD-M18-01) -> `payout_requests`, while `payout_requests.account_id` -> `accounts`. The foreign key is added in `0010_payouts`.

Both are cycle breaks on a column that is created with its table, not a delta applied later. Each carries a comment at both ends.

## 2. M01: SD-01 to SD-10

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| SD-01 | `daily_marks` | add `adjustment_cents` | 0014 | **landed** |
| SD-02 | `rule_states` | `payout_anchor_day` and `cadence_anchor_day` replace `last_payout_trading_day` | 0015 | **landed** |
| SD-03 | `payout_requests` | add `settled_trading_day`, `effective_trading_day` | 0010 | **landed** |
| SD-04 | `rule_states` | add `floor_open_cents` | 0015 | **landed** |
| SD-05 | `payout_requests` | ordinal unique becomes partial `where status <> 'failed'` | 0010 | **landed** |
| SD-06 | `rule_states` | `engine_eligible`; `engine_gates` / `context_gates` split | 0015 | **landed** |
| SD-07 | `rule_states` | add `consistency_period_start_day` | 0015 | **landed** |
| SD-08 | `rule_states` | add `state_hash` | 0015 | **landed** |
| SD-09 | `payout_requests` | partial unique `(account_id) where status in ('approved','frozen')` (predicate per ADR-028) | 0010 | **landed**, **amended by [ADR-040](../../docs/decisions/ADR-040.md)**: both predicates become `('approved','frozen','held_pending_review')`, dropped and re-created under their existing names in `0031`. A widening of an existing delta, not a new one (section 7's rule) |
| SD-10 | `plan_version_sizes` | conditional not-null on the two `floor_lock_*` columns | 0004 | **landed** |

## 3. Batch 1: M02 to M08, 37 deltas

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| SD-M2-01 | `provisioning_queue` | add `payload_hash` | 0007 | **landed** |
| SD-M2-02 | new `platform_account_refs` | permanently burned platform refs | 0007 | **landed** |
| SD-M2-03 | `ingest_files` | add `replaces_ingest_file_id`, `disposition` | 0013 | **landed** |
| SD-M2-04 | `fills` | add `trading_day_vendor`, `trading_day_source` | 0013 | **landed** |
| SD-M2-05 | `platform_entitlements` | add `platform_user_ref`, `billing_unit` | 0007 | **landed** |
| SD-M2-06 | `reconciliations` | add `source_ingest_file_id`, `our_source` | 0014 | **landed** |
| SD-M3-01 | `psp_webhook_events` | add `purchase_id`, `deferred_until`, `defer_attempts` | 0006 | **landed** |
| SD-M3-02 | `purchases` | add `refundable_until`, `first_trade_at` | 0006 | **landed** |
| SD-M3-03 | new `mid_health` | MID health as a decision record | 0006 | **landed** |
| SD-M3-04 | `coupons` | add `first_purchase_only`, `applies_to_kind` | 0006 | **landed** |
| SD-M3-05 | `purchases` | add `checkout_ip_country`, `card_country`, `geo_decision` | 0006 | **landed** |
| SD-M3-06 | `purchases` | add `payment_method`, `wallet_debit_cents`, `wallet_ledger_transaction_id` | 0006 (fk in 0011) | **landed** |
| SD-M4-01 | new `certificates` | the row behind a verifiable share card | 0020 | **landed** |
| SD-M4-02 | `purchases` | add `rule_diff_acknowledged_at` | 0006 | **landed** |
| SD-M4-03 | `sessions` | add `created_ip`, `created_user_agent`, `last_seen_at`, `last_seen_ip` | 0002 | **landed** |
| SD-M5-01 | `payout_requests` | add `frozen_at`, `freeze_flag_id`, `freeze_expires_at` | 0010 | **landed** |
| SD-M5-02 | `payout_transfers` | add `name_match_score`, `name_match_method`, `name_match_reviewed_by` | 0010 | **landed** |
| SD-M5-03 | new `treasury_balances` | the RCR's anchor | 0009 | **landed** |
| SD-M5-04 | `payout_requests` | add `balance_reflection_status`, `reflected_on_trading_day` | 0010 | **landed** |
| SD-M5-05 | `ledger_transactions` | add `reversal_of` | 0009 | **landed** |
| SD-M5-06 | new `wallet_withdrawals` | the external leg as its own object | 0011 | **landed** |
| SD-M5-07 | `ledger_accounts` | **add** the `trader_wallet` class (ADR-027) | 0009 | **landed** |
| SD-M6-01 | `liability_snapshots` | identity max, absorbed corrections, bounded open liability | 0009 | **landed** |
| SD-M6-02 | new `plan_breaker_state` | breaker with a recorded sample size | 0016 | **landed** |
| SD-M6-03 | new `alarm_suppressions` | mandatory expiry on every suppression | 0016 | **landed** |
| SD-M6-04 | `evidence_packs` | add `audience`, `redaction_profile`, `includes_detector_detail` | 0008 | **landed** |
| SD-M6-05 | new `dual_control_approvals` | ADR-010's second approval as a row | 0016 | **landed** |
| SD-M7-01 | `detector_runs` | add `synthetic_expected`, `synthetic_found`; `degraded` status | 0008 | **landed** |
| SD-M7-02 | `risk_flags` | add `sla_due_at`, `first_touched_at` | 0008 | **landed** |
| SD-M7-03 | new `detector_definitions` | versioned parameters with an effective date | 0008 | **landed** |
| SD-M7-04 | `identity_links` | add `disputed_at`, `dispute_note`, `suppressed`, `suppressed_by` | 0002 | **landed** |
| SD-M7-05 | new `correlation_groups` | group-level correlation results | 0008 | **landed** |
| SD-M8-01 | `affiliate_commissions` | add `chargeback_window_ends_on`, `clawback_of`, `paid_in_statement_id` | 0012 | **landed** |
| SD-M8-02 | `affiliate_clicks` | add `referrer_host`, `landing_is_direct`, `click_fingerprint`, `suspicious_reason` | 0005 | **landed** |
| SD-M8-03 | new `affiliate_creatives` | what was approved, not merely that something was | 0005 | **landed** |
| SD-M8-04 | `affiliates` | add `balance_cents`, `negative_balance_since` | 0005 | **landed** |
| SD-M8-05 | `attributions` | add `buyer_identity_id`, `affiliate_identity_id`, `self_deal_link_confidence_bp` | 0012 | **landed** |

## 4. Batch 2: M09 to M20, 41 deltas

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| SD-M9-01 | `plan_versions` | add `public_slug`, `public_visible` | 0004 | **landed** |
| SD-M9-02 | new `content_documents` | versioned content with a checksum | 0020 | **landed** |
| SD-M9-03 | new `page_revalidations` | revalidation as part of publish's definition of done | 0020 | **landed** |
| SD-M10-01 | new `integration_contracts` | per-vendor field allowlist as a row | 0018 | **landed** |
| SD-M10-02 | new `integration_dispatches` | what was sent, to whom, about whom | 0018 | **landed** |
| SD-M10-03 | new `support_context_views` | privileged support reads, audited | 0018 | **landed** |
| SD-M10-04 | `identities` | add `support_contact_ref` | 0002 | **landed** |
| SD-M11-01 | `certificates` | add `signing_key_id`, `code`, `claims_schema_version` | 0020 | **landed** |
| SD-M11-02 | `certificates` | add `revocation_class` | 0020 | **landed** |
| SD-M11-03 | `certificates` | add `deferred_until`, `deferred_reason` | 0020 | **landed** |
| SD-M11-04 | new `certificate_verifications` | the public oracle's access log | 0025 | **landed**, **reserved** |
| SD-M12-01 | new `statistic_definitions` | a statistic is a choice of denominator | 0021 | **landed**, **amended by [ADR-032](../../docs/decisions/ADR-032.md)**: gains `measures`, the declared measure set |
| SD-M12-02 | new `published_statistics` | append-only, with numerator and denominator | 0021 | **landed**, **amended by [ADR-031](../../docs/decisions/ADR-031.md)** (`value_numeric numeric` -> `value bigint` plus `value_unit`) **and [ADR-032](../../docs/decisions/ADR-032.md)** (`measure`, and in the window key) |
| SD-M12-03 | new `review_requests` | who was invited, and were they representative | 0021 | **landed** |
| SD-M12-04 | new `proof_links` | permanent disclosure needs an audited row | 0021 | **landed** |
| SD-M13-01 | new `round_trips` | versioned fill grouping | 0022 | **landed** |
| SD-M13-02 | new `journal_entries` | soft delete with a hard-delete job | 0022 | **landed** |
| SD-M13-03 | new `analytics_snapshots` | computed once per closed day | 0022 | **landed** |
| SD-M14-01 | new `loyalty_states` | derived per day, never a mutable balance | 0023 | **landed** |
| SD-M14-02 | new `loyalty_benefit_grants` | which criteria version earned it | 0023 | **landed** |
| SD-M14-03 | new `loyalty_criteria` | versioned promises, with `breaks_on` enumerated | 0023 | **landed** |
| SD-M15-01 | new `discord_links` | per-role consent | 0019 | **landed** |
| SD-M15-02 | new `discord_announcements` | every message, with the event that caused it | 0019 | **landed** |
| SD-M16-01 | new `notification_kinds` | the class is the policy, and it lives in data | 0019 | **landed** |
| SD-M16-02 | `notifications` | add class, rendered body, delivery split | 0019 | **landed** |
| SD-M16-03 | new `contact_channels` | the previous contact must exist as a row | 0019 | **landed** |
| SD-M17-01 | new `offers` | stated contents before payment | 0024 | **landed** |
| SD-M17-02 | new `price_floors` | a hard stop that is not the sum of the discounts | 0024 | **landed** |
| SD-M17-03 | new `promotional_credit_grants` | what funded a credit | 0024 | **landed** |
| SD-M17-04 | new `offer_experiments` | no enum value for a rule | 0024 | **landed** |
| SD-M18-01 | `accounts` | add `graduated_at`, `graduation_path`, `terminal_settlement_id` | 0007 | **landed** |
| SD-M18-02 | new `graduation_benefits` | accrual with a stated basis | 0023 | **landed** |
| SD-M18-03 | new `graduation_invitations` | shape decided before commercial pressure decides it | 0025 | **landed**, **reserved** |
| SD-M19-01 | `kyc_verifications` | add `verification_purpose`, `supersedes`, `liveness_passed`, `liveness_method` | 0003 | **landed** |
| SD-M19-02 | new `sanctions_screenings` | its own object with a review trail | 0003 | **landed** |
| SD-M19-03 | new `kyc_funnel_events` | the abandonment is the measurement; widened to record the trigger that fired | 0003 | **landed** |
| SD-M19-04 | new `dedupe_matches` | authoritative hard link (ADR-029) | 0003 | **landed** |
| SD-M20-01 | new `wallet_entries` | what kind of money it is | 0011 | **landed** |
| SD-M20-02 | new `wallet_spend_limits` | per identity, not global | 0011 | **landed** |
| SD-M20-03 | `wallet_withdrawals` | add `source_provenance_summary`, `earliest_credit_at` | 0011 | **landed** |
| SD-M20-04 | new `wallet_dormancy` | the obligation is not discovered during an audit | 0011 | **landed** |

## 5. The nine unnumbered changes

Rulings the schema did not yet express. **Five of the first six were invisible because nobody was counting**, and the sixth was miscited to a delta that means something else. This is the reason a count matters.

**`U-07` to `U-09` are different in one respect worth stating: they were never invisible.** They are claimed here, in the same commit that writes `0030` and `0031`, because [FOLD-02](../../docs/plans/FOLD-02-enforcement-window-and-suspension.md) section 7 rules that a delta identifier is claimed **by its registry row existing** and not by a plan pre-naming it. The plan that authorized them named no number, deliberately.

| # | Change | Source | Migration | Status |
|---|---|---|---|---|
| U-01 | new `identity_signal_weights` | ADR-022, M07 D-16 | 0025 | **landed**, **reserved** (ADR-022 tiers it to v1.x) |
| U-02 | `accounts.graduation_eligible` | ADR-024, M01 R-49 | 0007 | **landed** |
| U-03 | new `ledger_halts`, identity-scoped with an escalation clock | ADR-016, M05 INV-M5-16 | 0016 | **landed** |
| U-04 | `identity_signals.kind` gains `footprint_enrichment` | ADR-023, M07 D-15 | 0002 | **landed** |
| U-05 | `kyc_verifications.placement` check widened to the ruled trigger set | ADR-021 | 0003 | **landed** |
| **U-06** | `provisioning_status` gains **`confirmed_inferred`**, plus the binding that `set_risk` may never reach it | M02 section 3.2, AS-M2-03 | 0001 (value), 0007 (binding CHECK) | **landed** |
| **U-07** | `payout_status` gains **`held_pending_review`**, plus `payout_requests.held_at`, `hold_flag_id`, `hold_expires_at`, `payout_requests_hold_is_complete`, `payout_requests_hold_expiry_after_held` and `payout_requests_hold_expiry_idx` | [ADR-040](../../docs/decisions/ADR-040.md) | 0030 (value), 0031 (columns, CHECKs, index) | **landed** |
| **U-08** | `wallet_withdrawals` gains **`wallet_withdrawals_frozen_cannot_settle`**: a withdrawal carrying a live freeze may not reach `settled`. `0011` gave the external leg its freeze columns and `wallet_withdrawal_status` has no frozen value, so **the halt was representable and unenforced** | [ADR-040](../../docs/decisions/ADR-040.md) | 0031 | **landed** |
| **U-09** | new **`identity_restriction_episodes`**, with at most one open episode per identity and an all-or-none restore trio | [ADR-041](../../docs/decisions/ADR-041.md) | 0031 | **landed** |

**`U-06` was found while folding and is the sixth unnumbered change.** The approved [DATA_MODEL section 6](../../docs/architecture/data-model/README.md) declares `provisioning_status` with five values; [M02 section 3.2](../../docs/plans/M02-rithmic-bridge.md) adds a sixth and makes it a distinct state rather than a synonym, and AS-M2-03 makes it **binding that a `set_risk` operation may never reach it**. That is a schema change to an approved document with no delta number, which is the definition of an unnumbered change.

**Ruled by the founder, 2026-08-14: it is `U-06`, and the total in scope is 94.** `0001`'s inline marker previously read `-- SD-M2-06`, which is the `reconciliations` delta and lands in `0014`. **The marker is corrected to `-- U-06` in `0001` and added in `0007`.** Editing `0001` is permitted because it is committed and **not merged**; the rule is that a migration is never edited *once merged*, and shipping a knowingly wrong citation into a merge is the worse outcome.

## 6. Rejection table

**No delta was rejected.** This table says so explicitly rather than being absent, because a rejection table that is missing is indistinguishable from a delta that was dropped. A delta that is ever rejected is rejected in writing, in an ADR, never by omission.

## 7. Two things the corpus called additions and that are not deltas

- **`ladders_completed_lifetime`** is already inside `SD-M14-01`'s column list.
- **The `SD-M19-03` widening** is an amendment to an existing delta, not a new one.

Both fold. Neither is counted twice.

## 8. Open items carried out of the fold

Items found while folding that are **not schema deltas** and are **not closed**. They are here rather than only in a session log because this is the file the next session reads first.

| # | Item | Status |
|---|---|---|
| **OI-01** | **`liability_snapshots` exists in two shapes.** The migration (`0009`) follows `SD-M6-01`: keyed on `as_of timestamptz`, carrying `open_liability_cents`, `bounded_near_term_cents`, `remaining_ladder_exposure_cents`, `wallet_balances_cents`, `absorbed_corrections_cents`. [DATA_MODEL section 8](../../docs/architecture/data-model/README.md) still shows the earlier shape keyed on `snapshot_on date` with `funded_accounts`, `reserve_cents`, `cvar99_cents`, `rcr_bp` and `per_plan`. **The migration is the truth.** The four RCR and CVaR fields have **no home in the folded shape** and need one before [M06](../../docs/plans/M06-admin-ops-console.md) is built: the reserve coverage ratio is the number that decides whether sales pause | **OPEN**, founder ruling (2026-08-14) that it is tracked here |
| **OI-02** | **`published_statistics` cannot express three of the seven ruled statistics.** ST-04 publishes mean **and** median together and "neither is published alone"; ST-05 and ST-06 each publish **p50 and p95**. Two rows for one statistic, window and grain collide on `published_statistics_window_uq`, and no column distinguishes which figure a row carries. Proposed fix: a `measure` discriminator (`rate`, `total`, `mean`, `median`, `p50`, `p95`, `count`) on the table and in the index. **Applied** by [ADR-032](../../docs/decisions/ADR-032.md), together with **STAT-C1**, a deferred constraint trigger in `0027` asserting that a publish run emitting one measure emits every measure its definition declares. The column made the second figure writable; the trigger is what makes it required | **CLOSED** (2026-08-14) |
| **OI-03** | **`0026`'s append-only revoke list is a list, and a list drifts.** Eighteen tables are named there against [DATA_MODEL section 1](../../docs/architecture/data-model/README.md)'s Mutability set. The CI check must assert the revoke list **against the document** rather than trusting either | **OPEN**, CI not yet built |
| **OI-04** | **Two legitimate single-column updates on append-only tables** (`daily_marks.superseded_by`, `identity_links.suppressed`) are forbidden by the grants and require `SECURITY DEFINER` functions that **do not exist yet**. A naive first implementation of either transition fails at the grant, which is the correct failure and will look like a bug | **OPEN**, arrives with the owning module |
| **OI-06** | **`evidence_packs` is account-scoped and a restriction is per human.** `evidence_packs.account_id` is `NOT NULL` (`0008:238`), while [ADR-041](../../docs/decisions/ADR-041.md)'s restriction halts every linked account at once and may precede any account at all. So `identity_restriction_episodes.evidence_pack_id` is nullable and cites a pack exported against **one** of the identity's accounts, which is a narrower artifact than the enforcement it evidences. **This is not fixed here**: widening `evidence_packs` is a change to a merged table on the evidence path and belongs to [M06](../../docs/plans/M06-admin-ops-console.md), which owns the export surface and the `investigating` to `enforced` workflow that requires the pack | **OPEN**, found while folding `0031`, arrives with M06 |
| **OI-05** | **`0027`'s published-plan-version immutability trigger reads `NEW.config`, and `plan_versions` has no `config` column.** The rule contract is `rules`. PL/pgSQL resolves record fields at execution, so the migration installs cleanly and the function is wrong only when it fires. **Proven by execution, not by reading**: every `UPDATE` against a published row raises `record "new" has no field "config"`. The immutability promise survives by accident, because the error rejects the write; **the ruled `published -> retired` transition is refused too, so no plan version can be retired.** A draft row updates normally, which is why the install check and every probe in section 10 missed it. **`0027` is merged and is not edited**: the fix is a superseding migration, which takes the set from 27 files to 28 | **CLOSED** 2026-08-15. [ADR-035](../../docs/decisions/ADR-035.md) **accepted**; fixed by `0028`, which carries an `E2 READ` header and still needs the founder's read. **Two amendments at acceptance are larger than the ADR as proposed** (the whole row is pinned rather than a list of columns, and a retired row is now frozen absolutely per STATE_MACHINES section 9). The structural fix is **[CI-06j](../../docs/testing/STRATEGY.md)**, which found it from the tree with no database |

## 9. NO-FLOATS EXEMPTION LIST

**Constitution and [DATA_MODEL section 1](../../docs/architecture/data-model/README.md): money is `bigint` integer cents, ratios are integer basis points, never `numeric` and never a float, in any financial path.**

**Two columns in this schema are non-integer. Both are a ruled exemption rather than a local judgment, and the list is asserted rather than documented.**

```
correlation_groups.statistic
correlation_groups.threshold
```

**No money-bearing column is on this list, and after [ADR-031](../../docs/decisions/ADR-031.md) none is.** That is the property the list exists to hold and it is worth more than its length: what remains is two correlation coefficients on a risk-detection table, and what left was a column holding published cents.

**The assertion lives in `0027_triggers_invariants.sql`** as a `DO` block that reads `information_schema.columns` and **fails the migration** if the set of `numeric`, `real` or `double precision` columns in `public` is anything other than exactly those two. It asserts in **both directions**: an unlisted column fails, and so does a stale entry naming a column that no longer exists, because an allowlist wider than the schema quietly grants more than it names.

**Verified to bite in both directions**, not merely to run:

| Perturbation | Result |
|---|---|
| Add a rogue `numeric` column | `NO-FLOATS: liability_snapshots.rogue_rate is not on the exemption list` |
| Retype an exempt column to `bigint` | `NO-FLOATS: the exemption list names correlation_groups.threshold which does not exist` |
| Clean schema | Passes, and the only two non-integer columns in `public` are the two named above |

| Column | Ruling |
|---|---|
| `correlation_groups.statistic` | **Exempt.** A correlation coefficient is not money and is not a ratio of two integers Merit controls. Rounding it to cents or to basis points is the actual error |
| `correlation_groups.threshold` | **Exempt**, same reason, and it must be the same type as the statistic it is compared against |

**Both were re-examined at this gate and left exempt on the founder's ruling**, and the rounding is not harmless here, which is exactly the difference from the column that left. **A plain integer `rho` of `0.30` is `0`, and `rho = 0.30` is the reserve-critical figure**: the risk engine shows mean monthly payouts flat near $45.3K across every correlation level while CVaR99 nearly doubles from $84.8K at `rho = 0.05` to $132.9K at `rho = 0.30`. An integer cast erases the whole range the tail lives in. Converting them would be a risk-path change reversing a recorded exemption, and it needs its own ADR rather than a line in this one.

### What left the list: `published_statistics.value_numeric`, by [ADR-031](../../docs/decisions/ADR-031.md)

**It was authorized, and the authorization did not survive inspection.** It is now **`value bigint`** with a mandatory **`value_unit`**.

**All seven ruled statistics are exactly representable as integers under the corpus's own conventions**: ST-01, ST-02 and ST-07 are rates in **integer basis points**; ST-03 and ST-04 are money in **integer cents**; ST-05 and ST-06 are durations in **whole seconds**. The exemption bought nothing.

**The cents case is what decided it.** For ST-03 and ST-04 the column held **money on a public surface**, which is the case DATA_MODEL section 1 names directly. **An authorized exemption covering a money column is not an exemption, it is a hole with a ruling attached.**

**The rename is load-bearing.** `value_numeric` holding a `bigint` would be a lie that survives every grep a future reader runs.

### Scope correction, from the fold: two columns shipped outside the authorization

`published_statistics.numerator` and `.denominator` shipped as `numeric` and **were never authorized**. Both are `bigint`. The reasoning, because it is a ruling and not a cleanup:

- **The denominator is a COUNT in all six statistics that have one**, and ST-03 has none at all because it is a total rather than a rate. It is compared against `min_sample` (250 on ST-01, 100 on ST-02, 50 elsewhere), **which is an integer**. A `numeric` denominator permits `249.7`, which is not a number of accounts, and **a sample gate decided on a rounding is a sample gate that does not gate**.
- **The numerator is one of exactly three things across the seven definitions, and all three are integers**: a count (ST-01, ST-02, ST-07), **integer cents** (ST-03 and ST-04 are a sum of `trader_cents`), or a whole-second duration (ST-05, ST-06). **The cents case is the one that matters: that is MONEY, and it does not stop being money because it is being published.**
- **`numerator_unit` is forced by the type change, not added alongside it.** DATA_MODEL section 1 makes a quantity column with no unit a review reject, and a `bigint` numerator is otherwise ambiguous between cents and a count on a surface Merit cannot restate quietly.

### One unit vocabulary, and it is a type

`value_unit` and `numerator_unit` are both **`statistic_unit`** (`count`, `bp`, `cents`, `duration_seconds`), declared once in `0001`.

**Two `text` columns with two `CHECK` lists would be two vocabularies for one concept, and two vocabularies for one concept is how they drift**: a later migration widens one, nobody widens the other, and a published figure and its own numerator begin disagreeing about what a number means. A shared type makes that impossible rather than unlikely. `bp` never legitimately appears as a numerator unit and is in the shared type anyway, because a second type existing only to omit one value is the drift being prevented.

## 10. Verification performed on this file's claims

**All 27 migrations apply in order against PostgreSQL 16 with `ON_ERROR_STOP`**, producing **96 tables, 326 indexes, 347 check constraints and 6 triggers**. No file was edited to make that pass.

**This is a syntax and dependency check, not a semantic one.** It proves the set is installable and proves nothing about whether a delta was folded correctly, which is what the E2 read is for. The constraints that carry a ruling are tested individually against the database:

| Assertion | Probe | Result |
|---|---|---|
| **STAT-C1** | Publish ST-04 `mean` alone | Fails at commit, naming the missing `median` |
| **STAT-C1** | Publish ST-04 `mean` and `median` in one transaction | Commits |
| **STAT-C1** | Publish a measure the definition does not declare | Fails |
| **STAT-C1** | Publish against a `(stat_code, definition_version)` with no definition | Fails |
| **STAT-C1** | Restate one measure of a published pair | Commits, by the ruled `restatement_of IS NULL` scope |
| `published_statistics_window_uq` | Two live rows, same cell, same measure | Fails |
| `published_statistics_value_has_unit` | A value with no unit | Fails |
| `statistic_definitions_measures_nonempty` | An empty declared measure set | Fails, **after the `array_length` defect below was fixed** |
| `statistic_definitions_measures_distinct` | A declared set with a repeat | Fails |
| NO-FLOATS | Both directions, per section 9 | Fails as intended in each |

**One defect was found by this testing and not by reading.** `statistic_definitions_measures_nonempty` was first written `array_length(measures, 1) >= 1`. **`array_length` on an empty array returns `NULL`, `NULL >= 1` is `NULL`, and a `CHECK` evaluating to `NULL` passes**, so the constraint admitted the single value it existed to reject, and an empty declared set makes STAT-C1 vacuous. It is `cardinality(measures) >= 1`. Recorded because the lesson generalizes: **an invariant that was reviewed and not executed has not been checked.**

---

## 11. Install verification against PostgreSQL 16 (2026-08-15)

Run before the workflow's first push, so [CI-06h](../../docs/testing/STRATEGY.md) ships verified rather than hoped for.

| Check | Result |
|---|---|
| All 27 migrations apply forward-only from empty, `ON_ERROR_STOP=1` | **pass**, zero errors |
| Re-applying the set fails | **pass**, rejected as expected |
| `LEDGER-C1` fires on opposite signs against one account | **pass**, verified by error message and function name |
| `LEDGER-C2` fires on an undeclared class (`firm_payable`) | **pass** |
| Zero-sum fires on an unbalanced transaction | **pass** |
| **Counterfactual: C1 disabled, zero-sum armed** | **the collapse COMMITS.** Transaction nets 0; wallet net debited 10,000c. [ADR-027](../../docs/decisions/ADR-027.md) proven empirically |

**Object counts as reported by the database:** 96 tables, **326 indexes**, **347 check constraints**, 6 triggers.

**The index figure is why those two counts are stated here and nowhere else.** A grep of the DDL finds **219** `CREATE INDEX` statements, because Postgres backs every primary key and unique constraint with an index that the DDL never names. A derivation that disagrees with its artifact by a third would pass CI while telling the reader something false, so `sql_tables` and `sql_triggers` are generated spans and these two are emitted by the install job.

---

## 12. Re-verification at the DATA_MODEL rewrite (2026-08-15)

**The set was installed from scratch against PostgreSQL 16 again and reproduced section 10's figures exactly: 96 tables, 326 indexes, 347 check constraints, 6 triggers.** Nothing in `packages/db` was edited.

| Check | Result |
|---|---|
| Table set against [DATA_MODEL](../../docs/architecture/data-model/README.md), both directions | **96 / 96.** Wired as [CI-06i](../../docs/testing/STRATEGY.md) so it is a robot's job from here |
| Every column of every table carries a design record | **zero undocumented columns; zero documented columns that do not exist.** Generated diff of the document against `information_schema.columns` |
| NO-FLOATS `DO` block on a clean install | passes; the only two non-integer columns are the two in section 9 |
| **`plan_versions` published-row immutability, executed rather than read** | **FAILED against `0001` to `0027`. `OI-05`, [ADR-035](../../docs/decisions/ADR-035.md).** Fixed by `0028`; **14 / 14** in [`probe_plan_version_immutability.sql`](../../scripts/db/probe_plan_version_immutability.sql) against the full set |

**The same lesson as the `array_length` defect, one file over and one gate later.** Section 10's probe table covers STAT-C1, the window uniqueness, the unit constraints and NO-FLOATS. It does not cover the immutability triggers, and **the one thing never executed is the one thing that was broken**. Any probe table is an inventory of what somebody thought to test; the gap in it is not visible from inside it.

**SEVEN further `CHECK` constraints are written in the `array_length` form and are correct today only because no code exists to write an empty array**: `correlation_groups_is_a_group` (`0008:223`), `wallet_dormancy_review_was_noticed` (`0011:277`), `integration_contracts_enabled_has_fields` (`0018:65`), `notification_kinds_has_channels` (`0019:73`), `page_revalidations_has_paths` (`0020:85`), `round_trips_has_entry` (`0022:64`) and `round_trips_closed_has_exit` (`0022:66`). Each admits the empty array by the `NULL`-passes rule. **Folded into [ADR-035](../../docs/decisions/ADR-035.md)'s superseding migration** rather than left as seven separate discoveries.

**This paragraph said "Six" above a list of seven when it was written, and the reconciliation brief quoted the six onward.** The eighth hand-maintained count found wrong, in the manifest section recording the seventh, written by a session whose subject was counts that drift. The list is now line-cited so the next reader can check it in one command: `grep -n 'array_length' packages/db/migrations/*.sql`. The three remaining hits are in `0027` and are the **correct** idiom, `IF array_length(...) IS NOT NULL`, which tests the `NULL` rather than being caught by it.

---

## 13. `0028` lands, and the seven are executed both ways (2026-08-15)

**[`0028_supersede_plan_version_immutability.sql`](migrations/0028_supersede_plan_version_immutability.sql), [ADR-035](../../docs/decisions/ADR-035.md) accepted.** The full 28-file set applies forward-only from empty against PostgreSQL 16 and reproduces section 11's figures unchanged: **96 tables, 326 indexes, 347 check constraints, 6 triggers.** `0028` adds no object; it replaces a function body and re-adds seven `CHECK`s under their existing names.

| Check | Against `0001`-`0027` | Against `0001`-`0028` |
|---|---|---|
| The permitted `published -> retired` transition | **ERROR: record "new" has no field "config"** | **succeeds** |
| A published row's `rules` rewritten in place | rejected (for the wrong reason) | rejected: `Columns changed: rules` |
| A retirement smuggling a `copy_blocks` rewrite | **would have been permitted** once the column name was fixed | rejected: `Columns changed: copy_blocks` |
| A retirement moving `public_slug` | **would have been permitted** once the column name was fixed | rejected: `Columns changed: public_slug` |
| A retired row's `rules` rewritten | **completely unguarded** | rejected: `retirement is terminal` |
| A draft row edited normally | permitted | permitted, unchanged |
| The seven empty-array `CHECK`s | **all seven admitted the empty array** | **all seven reject it** |

**The rejections are checked by message text, not by exception class.** Before `0028` the retirement raised `undefined_column`; a handler catching "any error" would have scored that as the constraint working, which is exactly how this defect stayed invisible through a founder-grade review and a 27-file install check.

**The probe leads with the success case, and that is the transferable part.** Every probe in section 10 attempted a forbidden thing and asserted a rejection, so **every one of them passes against a guard that rejects everything**. Section 10 is an inventory of what somebody thought to test; this row is what the inventory could not see from inside itself.


---

## 14. `0030` and `0031` land, and the two-file split is proven by execution (2026-08-16)

**[ADR-040](../../docs/decisions/ADR-040.md) and [ADR-041](../../docs/decisions/ADR-041.md) accepted; [FOLD-02](../../docs/plans/FOLD-02-enforcement-window-and-suspension.md) session 3.** Two files, and the reason they are two is asserted rather than cited.

### The counterfactual, and the counterfactual's own counterfactual

**FOLD-02 section 9 item 5 requires the combined form be watched failing**, on `0028`'s transferable lesson: a probe that only ever attempts forbidden things passes against a guard that rejects everything. It was written, run against the full `0001`-`0028` set on PostgreSQL 16, and it failed:

```
ERROR:  unsafe use of new value "held_pending_review" of enum type payout_status
LINE 3:   WHERE status IN ('approved', 'frozen', 'held_pending_revie...
HINT:  New enum values must be committed before they can be used.
```

**And then the probe that makes that one mean something was run too**, because a failure watched in one direction only is the same defect one level up. The **same statements with the `BEGIN`/`COMMIT` removed**, under the install job's autocommit, **succeed**.

| Form | Result |
|---|---|
| `ALTER TYPE` and the predicate, one file, wrapped in `BEGIN`/`COMMIT` | **rejected**, `unsafe use of new value`. The rollback restores the unique index the file had already dropped |
| The same statements, one file, **no transaction block**, autocommit | **accepted** |
| `0030` then `0031`, as shipped | **accepted**, and `0031` keeps its transaction |

**So FOLD-02 finding 6 is imprecise and the correction is recorded rather than smoothed over.** It reads "the enum value and the index predicates that reference it **cannot be one file**". They can, if that file gives up atomicity. What they cannot be is one **atomic** file, and **it is `0031` that needs the atomicity**: `0031` drops a uniqueness guarantee before re-creating it, and a non-atomic `0031` failing between the two leaves `payout_requests` with nothing enforcing `G-NO-IN-FLIGHT` and a runner reporting a partial apply. The nicer-sounding reason and the true one differ, and the true one is the one that generalizes to the next enum value somebody adds.

**It is a CI step, not a paragraph.** `.github/workflows/corpus.yml` applies everything below `0030` to a scratch database, runs the combined form, and **fails the build if it succeeds** or if it fails for any reason other than `unsafe use of new value`. If PostgreSQL ever relaxes this, the split should be revisited rather than inherited, and the build is what will say so.

### Verification performed

| Check | Result |
|---|---|
| All <!--gen:migration_files-->30<!--/gen--> migrations apply forward-only from empty, `ON_ERROR_STOP=1` | **pass**, zero errors |
| Object counts, from the catalogue rather than a grep | **97 tables, 331 indexes, 353 check constraints, 6 triggers** |
| The delta against `0001`-`0028` | `+1` table, `+5` indexes, `+6` check constraints, `+0` triggers. **Two of the five indexes are replacements under existing names**, so the net new objects are the hold-expiry index and the episode table's four |
| [`probe_payout_hold.sql`](../../scripts/db/probe_payout_hold.sql), **18 assertions, leading with the success cases** | **18 / 18 pass** |
| [CI-06i](../../docs/testing/STRATEGY.md), every `CREATE TABLE` has a design record, both directions | **97 / 97** |
| [CI-06h](../../docs/testing/STRATEGY.md), every number on disk claimed by [ALLOCATION](../../docs/decisions/ALLOCATION.md), gapless over allocated plus reserved | **pass.** `0029` is a reserved hole, which is the case the gate was written for |

**The probe leads with four success cases before it attempts a single rejection**: a hold is writable at all, a second outstanding request is refused, the auto-release pays and the hold stays provable, and enforcement frees the ladder rung. A hold that cannot be written satisfies every rejection assertion in the file and pays nobody, which is the shape of pass [ADR-035](../../docs/decisions/ADR-035.md) was found hiding inside.

### Two departures from the approved plan, recorded rather than absorbed

**1. `wallet_withdrawals_open_idx` is NOT re-created.** [ADR-040](../../docs/decisions/ADR-040.md) and FOLD-02 section 4.5 both say "the open index re-created so a halted row stays visible". Its predicate is `status IN ('requested','cooling','approved','transferring')` (`0011:205`), and because the halt is **orthogonal to the rail state** by that same ADR's ruling, a halted withdrawal is still `approved` or `transferring` and **already matches**. The fold's own finding 3 says exactly this from the other side: "a halted withdrawal still matches `wallet_withdrawals_open_idx` and nothing refuses settlement", so what was missing was the refusal, which is `U-08`. Dropping and re-creating an index to a byte-identical definition on a money table is a null change that reads in a diff as a considered one. The halted set's own read path is already indexed too: `wallet_withdrawals_freeze_expiry_idx` is `(freeze_expires_at) WHERE freeze_expires_at IS NOT NULL`, and by `wallet_withdrawals_freeze_is_complete` that is exactly the halted set. **If the E2 read wants the re-creation anyway it belongs in a superseding migration**, because `0031` will be merged by then.

**2. `payout_requests_hold_is_complete` does not have the freeze trio's shape, and the difference is retention.** `payout_requests_freeze_is_complete` (`0010:141`) couples its trio to the status in both directions, so a released freeze must **clear** its columns and the row keeps no evidence it was ever frozen. That is merged and is not edited. The new constraint is written the other way: an **open** hold must be complete, and a **released** hold keeps its trio, so "Merit held this payout and paid it at the SLA" is provable from the row. This is [ADR-041](../../docs/decisions/ADR-041.md)'s own argument for the restriction being an episode row rather than a column, applied one table over: **a record erased by the act of ending is unprovable at exactly the moment it is contested**, and a trader whose money was held for 48 hours is the person most likely to ask. The one combination that stays unrepresentable either way is a hold with a flag and no clock, or a clock and no flag. **The resulting asymmetry inside one file is real**: on `wallet_withdrawals` a released freeze still clears its trio, because that constraint is merged. Named in `0031`'s section 4 rather than left for a reader to notice.

### One defect found in the gate runner, by executing rather than reading

**`CI-06g` could not see the `e2_files` spans, and reported success.** `spansIn()` in [`gates.mjs`](../../scripts/corpus/gates.mjs) matched span names against `[a-z_]+`. Every key in `SPAN_QUERIES` parses under that **except one**: `e2_files` contains a digit. So the four `<!--gen:e2_files-->` spans in [STATE](../../docs/STATE.md) and [INDEX](../../docs/INDEX.md) matched nothing, the checker never compared them, the generator never rewrote them, and both reported success. **A span nobody can see is indistinguishable from a span that agrees with its query.**

They read **18**, which was true when written and stopped being true the moment `0028` merged; `0030` and `0031` take the real figure to **20**. The number they carry is **the scope of the founder's E2 read**, which is the one count in this corpus whose staleness has a person attached to it.

**How it surfaced is the transferable part.** The same span key was written into this file and into DATA_MODEL at `20` in the same commit, and `gates.mjs check` passed with **two documents saying 18 and two saying 20**. A gate cannot survive that contradiction, and noticing it took running the thing rather than reading it, which is [ADR-035](../../docs/decisions/ADR-035.md)'s lesson arriving in the gate runner instead of a trigger body. The character class now reads `[a-z0-9_]+`, `falsify.mjs` still watches `CI-06g` fail on a hand-edited span, and the three stale spans were regenerated.

### What is NOT in this session, and is not implied by it

`0030` and `0031` bind the **database**. They do not touch `G-ELIGIBLE`, the machines, the invariants, the surfaces, the ToS clauses, the events, the edge cases, the golden scenarios, `CI-06l`, or `CRON_INVENTORY`, all of which are FOLD-02 sessions 4 through 8. **`identities.status = 'restricted'` still does not block a payout request or a checkout**, because that binding is `G-ELIGIBLE`'s and lands with the machines. The schema is ready for it; nothing enforces it yet, and saying so is the difference between a migration set and a shipped ruling.
