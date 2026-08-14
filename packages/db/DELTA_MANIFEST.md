---
status: draft
depends_on: [../../docs/architecture/DATA_MODEL.md, ../../docs/DECISIONS.md]
last_updated: 2026-08-14
---

# Delta manifest

**The completeness gate reads this file.** [ADR-026](../../docs/DECISIONS.md) requires that every `SD-nn` and `U-nn` appearing anywhere in `docs/` appears **exactly once** here with a disposition. A count nobody can drift is better than a count someone remembers to update.

**93 schema changes in scope: 88 numbered, 5 unnumbered.** No delta was rejected. 90 land in the v1 core sequence and 3 in the marked reserved sequence.

Migrations are sacred: once merged, never edited, only superseded. Greenfield rule: every delta is **folded at create**, not applied as a base-plus-ALTER chain, because the repository contains no application code and no database.

## 1. The migration sequence

27 files. Money-path files open with an `E2 READ: MONEY PATH` header naming what needs the founder's line-by-line read and why.

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
| 0021 | `transparency` | no | `statistic_definitions`, `published_statistics`, `review_requests`, `proof_links` |
| 0022 | `analytics_journal` | no | `round_trips`, `journal_entries`, `analytics_snapshots` |
| 0023 | `loyalty_and_graduation` | no | `loyalty_criteria`, `loyalty_states`, `loyalty_benefit_grants`, `graduation_benefits` |
| 0024 | `offers` | yes | `offer_experiments`, `offers`, `price_floors`, `promotional_credit_grants` |
| 0025 | `reserved_sequence` | no | `identity_signal_weights`, `graduation_invitations`, `certificate_verifications` |
| 0026 | `roles_and_grants` | yes | application role, append-only grants (VG-8), analytics role |
| 0027 | `triggers_invariants` | yes | zero-sum, LEDGER-C1, LEDGER-C2, immutability triggers |

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
| SD-09 | `payout_requests` | partial unique `(account_id) where status in ('approved','frozen')` (predicate per ADR-028) | 0010 | **landed** |
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
| SD-M4-01 | new `certificates` | the row behind a verifiable share card | 0020 | pending |
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
| SD-M9-02 | new `content_documents` | versioned content with a checksum | 0020 | pending |
| SD-M9-03 | new `page_revalidations` | revalidation as part of publish's definition of done | 0020 | pending |
| SD-M10-01 | new `integration_contracts` | per-vendor field allowlist as a row | 0018 | **landed** |
| SD-M10-02 | new `integration_dispatches` | what was sent, to whom, about whom | 0018 | **landed** |
| SD-M10-03 | new `support_context_views` | privileged support reads, audited | 0018 | **landed** |
| SD-M10-04 | `identities` | add `support_contact_ref` | 0002 | **landed** |
| SD-M11-01 | `certificates` | add `signing_key_id`, `code`, `claims_schema_version` | 0020 | pending |
| SD-M11-02 | `certificates` | add `revocation_class` | 0020 | pending |
| SD-M11-03 | `certificates` | add `deferred_until`, `deferred_reason` | 0020 | pending |
| SD-M11-04 | new `certificate_verifications` | the public oracle's access log | 0025 | pending, **reserved** |
| SD-M12-01 | new `statistic_definitions` | a statistic is a choice of denominator | 0021 | pending |
| SD-M12-02 | new `published_statistics` | append-only, with numerator and denominator | 0021 | pending |
| SD-M12-03 | new `review_requests` | who was invited, and were they representative | 0021 | pending |
| SD-M12-04 | new `proof_links` | permanent disclosure needs an audited row | 0021 | pending |
| SD-M13-01 | new `round_trips` | versioned fill grouping | 0022 | pending |
| SD-M13-02 | new `journal_entries` | soft delete with a hard-delete job | 0022 | pending |
| SD-M13-03 | new `analytics_snapshots` | computed once per closed day | 0022 | pending |
| SD-M14-01 | new `loyalty_states` | derived per day, never a mutable balance | 0023 | pending |
| SD-M14-02 | new `loyalty_benefit_grants` | which criteria version earned it | 0023 | pending |
| SD-M14-03 | new `loyalty_criteria` | versioned promises, with `breaks_on` enumerated | 0023 | pending |
| SD-M15-01 | new `discord_links` | per-role consent | 0019 | pending |
| SD-M15-02 | new `discord_announcements` | every message, with the event that caused it | 0019 | pending |
| SD-M16-01 | new `notification_kinds` | the class is the policy, and it lives in data | 0019 | pending |
| SD-M16-02 | `notifications` | add class, rendered body, delivery split | 0019 | pending |
| SD-M16-03 | new `contact_channels` | the previous contact must exist as a row | 0019 | pending |
| SD-M17-01 | new `offers` | stated contents before payment | 0024 | pending |
| SD-M17-02 | new `price_floors` | a hard stop that is not the sum of the discounts | 0024 | pending |
| SD-M17-03 | new `promotional_credit_grants` | what funded a credit | 0024 | pending |
| SD-M17-04 | new `offer_experiments` | no enum value for a rule | 0024 | pending |
| SD-M18-01 | `accounts` | add `graduated_at`, `graduation_path`, `terminal_settlement_id` | 0007 | **landed** |
| SD-M18-02 | new `graduation_benefits` | accrual with a stated basis | 0023 | pending |
| SD-M18-03 | new `graduation_invitations` | shape decided before commercial pressure decides it | 0025 | pending, **reserved** |
| SD-M19-01 | `kyc_verifications` | add `verification_purpose`, `supersedes`, `liveness_passed`, `liveness_method` | 0003 | **landed** |
| SD-M19-02 | new `sanctions_screenings` | its own object with a review trail | 0003 | **landed** |
| SD-M19-03 | new `kyc_funnel_events` | the abandonment is the measurement; widened to record the trigger that fired | 0003 | **landed** |
| SD-M19-04 | new `dedupe_matches` | authoritative hard link (ADR-029) | 0003 | **landed** |
| SD-M20-01 | new `wallet_entries` | what kind of money it is | 0011 | **landed** |
| SD-M20-02 | new `wallet_spend_limits` | per identity, not global | 0011 | **landed** |
| SD-M20-03 | `wallet_withdrawals` | add `source_provenance_summary`, `earliest_credit_at` | 0011 | **landed** |
| SD-M20-04 | new `wallet_dormancy` | the obligation is not discovered during an audit | 0011 | **landed** |

## 5. The five unnumbered changes

Rulings the schema did not yet express. Four of the five were invisible because nobody was counting.

| # | Change | Source | Migration | Status |
|---|---|---|---|---|
| U-01 | new `identity_signal_weights` | ADR-022, M07 D-16 | 0025 | pending, **reserved** (ADR-022 tiers it to v1.x) |
| U-02 | `accounts.graduation_eligible` | ADR-024, M01 R-49 | 0007 | **landed** |
| U-03 | new `ledger_halts`, identity-scoped with an escalation clock | ADR-016, M05 INV-M5-16 | 0016 | **landed** |
| U-04 | `identity_signals.kind` gains `footprint_enrichment` | ADR-023, M07 D-15 | 0002 | **landed** |
| U-05 | `kyc_verifications.placement` check widened to the ruled trigger set | ADR-021 | 0003 | **landed** |

## 6. Rejection table

**No delta was rejected.** This table says so explicitly rather than being absent, because a rejection table that is missing is indistinguishable from a delta that was dropped. A delta that is ever rejected is rejected in writing, in an ADR, never by omission.

## 7. Two things the corpus called additions and that are not deltas

- **`ladders_completed_lifetime`** is already inside `SD-M14-01`'s column list.
- **The `SD-M19-03` widening** is an amendment to an existing delta, not a new one.

Both fold. Neither is counted twice.
