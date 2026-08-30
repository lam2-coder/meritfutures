---
status: review
depends_on: [../../docs/architecture/data-model/README.md, ../../docs/decisions/README.md]
last_updated: 2026-08-23
---

# Delta manifest

**The completeness gate reads this file.** [ADR-026](../../docs/decisions/ADR-026.md) requires that every `SD-nn` and `U-nn` appearing anywhere in `docs/` appears **exactly once** here with a disposition. A count nobody can drift is better than a count someone remembers to update.

<!--gen:manifest_changes-->118<!--/gen--> **schema changes in scope: 96 numbered, 7 unnumbered.** No delta was rejected. 100 land in the v1 core sequence and 3 in the marked reserved sequence.

**The count moved from 93 to 94 by founder ruling (2026-08-14).** `U-06` is the sixth unnumbered change, found while folding. [ADR-026](../../docs/decisions/ADR-026.md)'s table of five did not carry it. See section 5.

**It moved from 94 to <!--gen:manifest_changes-->118<!--/gen--> on 2026-08-16, with [ADR-039](../../docs/decisions/ADR-039.md) and [`0029`](migrations/0029_phone_identity_and_auth.sql).** Nine changes: eight numbered and `U-07`. See section 5a. **The total is a [CI-06g](../../docs/testing/STRATEGY.md) span now** and the split beside it is not, because no query parses the numbered and unnumbered halves apart; that split is prose and drifts like prose, which is the position [ADR-036](../../docs/decisions/ADR-036.md) records for the State column one registry over.

Migrations are sacred: once merged, never edited, only superseded. Greenfield rule: every delta is **folded at create**, not applied as a base-plus-ALTER chain, because the repository contains no application code and no database.

**This file has its own allocation table, and it is [section 16](#16-allocation-oi-nn-identifiers-and-section-numbers).** `OI-nn` identifiers and section numbers are claimed there before they are written, on [ADR-034](../../docs/decisions/ADR-034.md)'s rule. It is at the end rather than here because the sections are in numeric order and section 16 is a section; it is announced here because **the two collisions that produced it were both made by sessions reading this file from the top**.

## 1. The migration sequence

<!--gen:migration_files-->69<!--/gen--> files. Money-path files open with an `E2 READ: MONEY PATH` header naming what needs the founder's line-by-line read and why.
**The v1 core sequence is these 27 files.** Money-path files open with an `E2 READ: MONEY PATH` header naming what needs the founder's line-by-line read and why.

**Superseding migrations are not added to this table**, because it is the record of where each delta was **folded** and a supersession folds no delta. Each arrives instead in its own dated section with the execution that justified it: `0028` in section 13, `0030` and `0031` in section 14. The file count on disk is a generated span in [INDEX](../../docs/INDEX.md) and [STATE](../../docs/STATE.md) rather than a sentence here, for the reason section 12 records at length.
**The fold's 27 files, and this table is closed at 27.** Money-path files open with an `E2 READ: MONEY PATH` header naming what needs the founder's line-by-line read and why.

**A superseding migration does not get a row here**, and saying so is the point: `0028` ([ADR-035](../../docs/decisions/ADR-035.md)) and `0032` ([ADR-042](../../docs/decisions/ADR-042.md)) are recorded in sections 13 and 14, because this table describes **what the fold created** and a superseding file describes **what changed afterwards**. Appending to it would make the sequence and the file count two hand-maintained numbers in a document written to end them. The count that is checked is the `migration_files` span in [STATE](../../docs/STATE.md) and [INDEX](../../docs/INDEX.md), derived from the directory by [CI-06g](../../docs/testing/STRATEGY.md); this line read a bare "27 files" against 28 on disk until `0032` landed, which is the ninth hand-maintained count found wrong.

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
| 0028 | `supersede_plan_version_immutability` | yes | [ADR-035](../../docs/decisions/ADR-035.md). Replaces the published-plan-version guard's body, freezes a retired row, re-adds seven `array_length` `CHECK`s as `cardinality()`. Creates no object |
| 0029 | `phone_identity_and_auth` | yes | [ADR-039](../../docs/decisions/ADR-039.md). `identity_phones`, `phone_change_requests`, `otp_send_budget`, plus amended columns on `otp_challenges`, `sessions`, `contact_channels`, `identity_signals`, `notification_kinds` and `kyc_verifications`. **Supersedes and never edits**: `0002`, `0003` and `0019` are untouched on disk |

**The table above listed 27 rows and stopped at `0027` until 2026-08-16**, a day after `0028` merged and in the same file whose section 13 records that `0028` landed. The heading count is a span now; the rows are not derivable and are hand-maintained by the session that adds a file, which is the same arrangement the migration allocation table runs on.

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
| SD-M5-08 | `payout_requests` | add `held_at`, `hold_flag_id`, `hold_expires_at`, `hold_tos_clause`, `hold_reason`, `payout_requests_hold_is_complete`, `payout_requests_hold_expiry_idx`, and **both** `SD-09` predicates widened to include `held_pending_review` (ADR-040) | 0030, 0031 | **landed** |
| SD-M5-09 | `wallet_withdrawals` | add `wallet_withdrawals_live_freeze_blocks_settlement`, open index re-created so a halted row stays visible (ADR-040) | 0031 | **landed** |
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
| SD-M9-04 | `plan_version_sizes` | add `marketed_size_label`, the versioned marketed label ([ADR-070](../../docs/decisions/ADR-070.md) section 4, M9 SD-M9-04) | 0044 | **reserved** |
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

## 4a. FOLD-01: [ADR-039](../../docs/decisions/ADR-039.md), 8 numbered deltas plus `U-07`

**The numbers were allocated here, in this session, and not in the plan.** [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md) first named them inline and [ADR-026](../../docs/decisions/ADR-026.md)'s completeness gate refused all ten, correctly: **only ADR numbers and migration numbers have an allocation table.** A delta identifier is claimed by its row here existing, so a plan that writes one before the row exists has pre-claimed in a registry with no claim mechanism. Each takes the next free number in its module's series, and this is the commit where that happens.

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| SD-M19-05 | new `identity_phones` | the verified phone as a graph node: hash, preview, country, carrier metadata at capture, supersession, and the recycling guard's `released_at` / `release_evidence`. **One live verified phone per identity as a partial unique index; `phone_hash` deliberately NOT unique** | 0029 | **landed** |
| SD-M19-06 | new `phone_change_requests` | (c)'s D4 ceremony as state. Dual-channel verification, prior-contact notification and a still-running withdrawal hold are preconditions of applying | 0029 | **landed** |
| SD-M19-07 | `kyc_verifications` | `verification_purpose` check widened: `reverify_phone_change`. `INV-M19-06` | 0029 | **landed** |
| SD-M16-04 | new `otp_send_budget` | pre-identity OTP velocity by number, IP and country, plus the global cost circuit breaker, on `plan_breaker_state`'s pattern from `0016`. **The breaker degrades, it does not stop** | 0029 | **landed** |
| SD-M16-05 | `otp_challenges` | add `channel` and `destination_hash`; `email_normalized` relaxed to nullable under a check that exactly one destination is set | 0029 | **landed** |
| SD-M16-06 | `contact_channels` | `kind` check widened to include `sms`, as a named constraint dropped and re-added. **Finding 4: `INV-M16-03` could not notify a prior number without it** | 0029 | **landed** |
| SD-M16-07 | `notification_kinds` | `class` gains `pre_identity_auth`, and a new `rate_limit_exempt boolean` **generated from `class`**. `notification_kinds_immutable_never_coalesced` widened to the new class | 0029 | **landed** |
| SD-M16-08 | `contact_channels` | add `complained_at timestamptz null` and a partial index over the rows where it is set. The spam complaint recorded **against the destination**, suppressing the marketing class and nothing else. **`bounced` needed no delta**: `0019` already carries the value and what was missing was [M16](../../docs/plans/M16-notification-center.md) section 3.4's specification. `spam_complaint` is refused as a `delivery_status` because a complaint follows delivery and would overwrite the proof of notice `INV-M16-09` rests on | 0041 | **landed** |
| SD-M4-04 | `sessions` | add `auth_factor`, `elevated_at`, `elevated_by_factor`. **C-27 is unenforceable without it**: a handler cannot refuse an SMS-established session for a sensitive action if the session never recorded how it was established | 0029 | **landed** |
| SD-M20-05 | `promotional_credit_grants`, `plan_versions` | The fee-back credit, [ADR-070](../../docs/decisions/ADR-070.md) section 2. **No new ledger class and no new grant table**: `promotional_credit` is 0009's and the grant table is 0024's, so the delta is `source_payout_request_id` plus a **partial unique index making one fee-back per settlement structural**, which is what stops a retried settlement crediting twice. `plan_versions` gains `fee_back_repeats`, materialized at publish on [`0004:183`](migrations/0004_catalog.sql)'s own pattern and **locked to `false` by a named CHECK**: a fee-back is issued by a payout rather than through M17's issuance path, so `repeats: true` closes AS-M20-01's chain into a self-funding loop outside the only cap that bounds it. `OQ-M20-06` asks when it may be unlocked | 0044 | **landed** |
| SD-M18-04 | new `plan_size_unlocks` | The ladder unlock, [ADR-070](../../docs/decisions/ADR-070.md) section 3, triggered by `payoutsSettledCount >= phase_funded.max_payouts` (`G-LADDER-COMPLETE`). **`OQ-F5-03` is answered by which table the key points at**: a hard merge repoints ownership into the surviving `identities` row and `identity_links` repoints nothing, so an FK to `identities(id)` makes a soft-linked pair sharing an unlock **unrepresentable** rather than forbidden. Not filed in `loyalty_benefit_grants`, which `INV-M14-11` and `INV-M14-12` keep inert, nor in `graduation_benefits`, whose `accrued_cents NOT NULL` would force the zero-value row `GS-306` exists to prevent | 0044 | **landed** |

`U-07` is in section 5 with the other unnumbered changes.

**One thing this fold's plan got wrong, recorded here rather than left for the next reader.** [FOLD-01 section 6.2](../../docs/plans/FOLD-01-phone-identity.md) says the fold adds "three new `### <table>` sections plus amended columns on **five** existing tables". It is **six**: `otp_challenges`, `sessions`, `contact_channels`, `identity_signals`, `notification_kinds` and `kyc_verifications`, each of which is a row in the plan's own section 4 table. Another instance of the hand-maintained-count class, this time inside an approved plan, written by the fold whose subject is that class of error. The count in [DATA_MODEL](../../docs/architecture/data-model/README.md)'s amendment header is the one taken from the diff.

**And no ordinal is claimed for it, because the ordinal has itself drifted.** The obvious sentence to write here was "the tenth hand-maintained count found wrong", on the arithmetic that section 12 records an eighth and [`0028`](migrations/0028_supersede_plan_version_immutability.sql)'s header records a ninth. **It is double-booked.** `grep -rn 'eighth\|[Nn]inth' packages/db docs --include=*.md --include=*.sql` returns **two different findings each claiming "eighth"** (section 12's `array_length` six-above-a-list-of-seven, and [Session 30](../../docs/sessions/2026-08-15-session-30.md)'s `INDEX` "140 entries" against 141) and **two each claiming "ninth"** (`0028`'s three-above-a-list-of-four, and Session 30's `INDEX` "257 scenarios"). **The tally of hand-maintained counts is a hand-maintained count, it collided the moment two branches recorded an instance in the same week, and it is exactly the ADR-034 race one registry over with no allocation table under it.** The class is real and the running total is not; this entry records the instance and stops there.

**Four more were found in the same pass and fixed rather than tallied.** All four were `0028` landing and nothing downstream moving: this file's section 1 said "27 files" above a 27-row table and the table stopped at `0027`, [DATA_MODEL](../../docs/architecture/data-model/README.md)'s amendment header said "94 approved schema changes" and "27 files", and its §17 said "The 27 files" and "Sixteen carry an `E2 READ`" **when STATE and INDEX had already converted that same E2 figure to a span after finding it wrong there** and this third copy was left behind. **Every one is now a [CI-06g](../../docs/testing/STRATEGY.md) span**, which is [ADR-034](../../docs/decisions/ADR-034.md)'s remedy: generate the number, or delete it and point at the source.

## 4b. FOLD-03: [ADR-066](../../docs/decisions/ADR-066.md), 2 numbered deltas

**Sessions `F1` and `F2` of [FOLD-03](../../docs/plans/FOLD-03-vendor-parity-gap-fill.md).** `F1` closes [M07](../../docs/plans/M07-risk-abuse.md) `DEP-M7-06`; `F2` gives [M06](../../docs/plans/M06-admin-ops-console.md):377's recurring artifact a delivery mechanism. The numbers are allocated by these rows existing, on section 4a's rule: only ADR numbers and migration numbers have an allocation table, and a delta identifier is claimed by its manifest row. **`SD-M6-07` could not be reserved anywhere else**: [ADR-026](../../docs/decisions/ADR-026.md)'s gate requires a row here for every `SD-` identifier appearing under `docs/`, so writing it into [M06](../../docs/plans/M06-admin-ops-console.md) first would have failed the gate on arrival.

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| SD-M6-06 | new `economic_calendar`, `economic_calendar_loads` | the Tier-1 economic calendar as Merit-owned data: event key, occurrence key, tier, the scheduled release instant in UTC, the transcribed `release_trading_day`, and **a revision that is a new row rather than an update**. Plus the view `economic_calendar_current`, which is the only definition of "current" and is what makes the panel and `D-04` read one row. `economic_calendar_loads` is `FM-M7-08`'s staleness clock on `trading_calendar_loads`' precedent | 0039 | **landed** |
| SD-M6-07 | new `report_schedules`, `report_deliveries` | scheduled delivery of a **fixed, named digest set**: the schedule, its recipients, its format (CSV or PDF), its channel (email or SFTP push), and **one row per delivery attempt with its outcome**. `report_schedules.digest` is a **closed vocabulary of four**, which is what makes "this is not a report builder" a schema fact rather than a sentence in [ADR-066](../../docs/decisions/ADR-066.md); `cadence` is generated from it so the two cannot disagree. `report_deliveries` is append-only by grant and carries `due_at`, the window an attempt discharges, **because absence is only detectable against an expectation** | 0040 | **landed** |

**This delta is a repair, not an addition, and that is the whole of its interest.** [M07:470](../../docs/plans/M07-risk-abuse.md) `DEP-M7-06` declared the dependency when M07 was written, [M07:109](../../docs/plans/M07-risk-abuse.md) `D-04` names it as an input, and [M07:267](../../docs/plans/M07-risk-abuse.md) `FM-M7-08` required its staleness alarm. **A grep for `economic_calendar` over `docs/`, `packages/db/migrations/` and `packages/` returned four hits, all prose, and no table.** So `D-04` has been unimplementable since M07 was written and **no gate could see it**: a declared dependency with no satisfying object is invisible to every check this repository runs, because every check reads what exists rather than what was promised.

**`0039` is not in section 1's table**, on [`0032`](migrations/0032_trading_calendar_holidays_coverage_revisions.sql)'s precedent: that table records what the fold created and is closed at 27, and a later migration that creates tables gets its own section instead. `0039` creates two tables and one view, supersedes nothing, and edits no merged file.

**`SD-M6-07`'s load-bearing half is the delivery log and not the schedule**, and the reason is [M05](../../docs/plans/M05-payout-system.md):91 `INV-M5-18` rather than anything new. That invariant is asserted *"on the QUERY, never on the job"*, evaluated independently of whether the sweep reported success, on the stated ground that **a job that reports success is not evidence that the work happened**. A second sweep with the same shape gets the same control rather than a new one: the delivery-failure alarm reads `report_deliveries` and never the job's own report, and `GS-288` pins the case where the job reports success and nothing arrived. **`due_at` is what makes that askable**, because without a stored window "nothing arrived" and "not due yet" return the same empty set, which is [`economic_calendar_loads`](../../docs/architecture/data-model/economic_calendar_loads.md)'s coverage bound one table over and one row up.

**`0040` was executed rather than only read, and two of the twenty-four assertions were refused by a constraint other than the one they were aimed at.** All <!--gen:migration_files-->69<!--/gen--> files apply forward-only from empty against PostgreSQL 16.13 under `ON_ERROR_STOP` with zero errors, and 24 assertions ran against the applied schema, 24 / 24: four successes first, on section 13's lesson that a probe which only attempts forbidden things passes against a guard that rejects everything.

| Aimed at | What actually refused it |
|---|---|
| A fifth `digest` value, the report builder [ADR-066](../../docs/decisions/ADR-066.md) section 8 rejected | **The NOT NULL on `cadence`**, not `report_schedules_digest_check`. A generated column is computed **before** CHECK constraints, so the error names `cadence` for a defect in `digest`. Dropping that NOT NULL and re-inserting shows the CHECK firing, so both are live and **each refuses a widening of the other**: admitting a fifth digest is a two-place edit and a half-admitted one cannot exist |
| The outcome `skipped`, which does not exist | **`report_deliveries_failure_states_its_reason`**, because the row carried a `failure_reason` beside it. Re-run with nothing else wrong on the row, `report_deliveries_outcome_check` is what fires |

**Both are recorded rather than tidied away, because a refusal counted against the wrong constraint is a constraint nobody has actually watched work.** That is section 13's finding in a different costume, and the second one is the reason the isolated re-run exists at all: without it this file would claim the two-value outcome vocabulary had been exercised when what had been exercised was a constraint about failure reasons.

**No probe is committed, and that is a debt rather than a choice.** `CI-06s` asserts that every probe on disk is run by the workflow and pinned by `CI-06h`, so committing one means editing [`corpus.yml`](../../.github/workflows/corpus.yml) **and** [`gates.mjs`](../../scripts/corpus/gates.mjs)' required-needle list, both outside this session's fence and both being read by three sibling sessions writing [M06](../../docs/plans/M06-admin-ops-console.md) at the same time. [`0039`](migrations/0039_economic_calendar.sql) is the precedent for a non-money FOLD-03 migration landing with a vitest test and no probe, and this follows it. **The assertions above are transcribed from a run and are not repeatable from the tree**, which is exactly the property `OI-07` was opened four times about; it is named here rather than left for a reader to discover from an absence.

**One thing found while writing it, recorded rather than left for the next reader.** [`packages/db/test/migrations.integration.test.ts`](test/migrations.integration.test.ts) asserted the on-disk migration sequence is `1..n` contiguous, under a comment claiming `CI-06h` "asserts the same thing" and that the local copy was "the weaker half". **Both halves of that claim were false.** It was not weaker, it was **stricter in the one direction [ADR-036](../../docs/decisions/ADR-036.md) rules out**: gaplessness is asserted over allocated **plus reserved**, "so a branch holding a reservation shows a hole and passes". `0038` is reserved for the money-path adjustment migration and is sequenced **last** in FOLD-03, so any branch writing `0039` first has a legal reserved hole and the old assertion failed on it. The property is not lost, it is deferred to `CI-06h` by name; re-implementing the allocation parser in vitest would be `OQ-P1-04`'s defect, which the parser's own header names as the thing not to do.

## 4c. FOLD-05: [ADR-071](../../docs/decisions/ADR-071.md) and `M21`, 3 numbered deltas

**Session `P4` of [FOLD-05](../../docs/plans/FOLD-05-plan-config-and-designer.md), which writes [M21](../../docs/plans/M21-plan-designer.md), the first module admitted after FREEZE.** The identifiers are allocated by these rows existing, on section 4a's rule: only ADR numbers and migration numbers have an allocation table, and a delta identifier is claimed by its manifest row.

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| SD-M21-01 | new `simulation_runs` | the persisted simulation run and its provenance: the `rules` and sizes digests the run was over, the calibration identity, digest and observation date, the harness and engine versions, the seed, the sample size, and the sweep columns that make one arm of a sensitivity sweep an individually traceable run. **Digests rather than a `plan_version_id` alone**, because a run is over a draft and a draft is mutable | 0045 | **landed**, session 120 |
| SD-M21-02 | `plan_versions` | add `decided_on_simulation_run_id`, `simulation_waiver_reason`, and a `CHECK` that a published row carries **exactly one** of them. `AS-M21-01`'s structural remedy: the run is where the number is produced and the publish record is where the consequence lands, so tracing has to reach the second, and "no simulation was run" has to be a recorded decision rather than a null | 0045 | **landed**, session 120 |
| SD-M21-03 | new `competitor_plan_models` | the modelled competitor configurations requirement (c) compares against, each carrying `observed_on` and a source reference, superseded by a new row rather than updated. A side-by-side against an undated competitor config is the stale-calibration failure in a second costume | **unallocated** | **reserved** |

**`0045` was reserved CONTINGENT and [M21](../../docs/plans/M21-plan-designer.md) section 2.1 is what spends it.** [ALLOCATION](../../docs/decisions/ALLOCATION.md)'s row made the reservation conditional on the plan naming a persisted run, on the reasoning that a console recomputing on demand and storing nothing needs no table. The plan names one, and the argument it makes is that the other three adversarial scenarios are answered by showing the reader something while the stale-calibration one is not: staleness has no tell at the moment of the decision, so the only remedy that survives an inattentive reader is a record.

**`SD-M21-03` deliberately claims no migration number.** It is not `M21`'s simulation-run record, and folding it into `0045` would stretch a reservation whose text names something else. The number is claimed in [ALLOCATION](../../docs/decisions/ALLOCATION.md) by whichever session writes the migration, and [M21](../../docs/plans/M21-plan-designer.md) `OQ-M21-06` carries it.
## 4c. FOLD-03: [ADR-067](../../docs/decisions/ADR-067.md), 1 numbered delta
**Session `F6` of [FOLD-03](../../docs/plans/FOLD-03-vendor-parity-gap-fill.md), the fold's one MONEY-PATH session.** It is separate from `4b` because it carries a different ruling: `4b` is [ADR-066](../../docs/decisions/ADR-066.md), which deliberately did not decide this item, and [ADR-067](../../docs/decisions/ADR-067.md) is its own entry with its own unsigned approval line.
| SD-M6-09 | new `account_adjustments` | the audited admin adjustment, and **every property of it is a constraint rather than a policy**. `ledger_transaction_id not null` makes an unposted adjustment unwritable; two DEFERRED constraint triggers then read the posting the row claims and assert it **is** the adjustment, to the account, the identity, the cent and the sign. The destination is `trader_wallet` or `promotional_credit` and **never `trader_withdrawable`**. A debit is only ever the **exact reversal of a credit this table posted**, at most one per credit. The reason is a **closed vocabulary plus a non-empty note**, and the vocabulary **picks the destination**, which is what makes `INV-M20-03` unbreakable through this surface. The dual-control threshold **in force** is a column | 0038 | **landed** |
**It widens no closed list, and that is the strongest evidence the destination is right.** No new `wallet_entries.provenance` value (`correction` has been legal since [`0011:74`](migrations/0011_wallet.sql)), no new `ledger_accounts.code`, no new `identity_status`, no new payout status. **The wallet was built to hold this and nobody had built the door**, which is also why `ADR-067` needed no eighth ledger class: the seven codes are declared the whole permitted set in two enforced places.
**`0038` is not in section 1's table**, on [`0032`](migrations/0032_trading_calendar_holidays_coverage_revisions.sql)'s and `0039`'s precedent: that table records what the fold created and is closed at 27.
**`0038` had been named "the next free migration" in five consecutive session logs and is spent here for the first time.** [ALLOCATION](../../docs/decisions/ALLOCATION.md) rows for `ADR-054`, `ADR-056`, `ADR-058` and `ADR-059` each end with the words "`0038` stays free". They do not any more, and **amending those four rows is owed to whichever session next holds that fence**: `docs/decisions/ALLOCATION.md` is not in this session's, which is the same [ADR-065](../../docs/decisions/ADR-065.md) T3 situation [session 99](../../docs/sessions/2026-08-20-session-99.md) recorded one registry over.
## 4c. FOLD-04: `ADR-068`, 1 numbered delta
**Claimed under [ADR-026](../../docs/decisions/ADR-026.md) in the commit that writes the delta, on `4a`'s and `4b`'s precedent.** `ADR-068` is **auth and therefore money path**, so the row lands with the module plan rather than after the migration.
| ID | Table | Change | Migration | Disposition |
| SD-M6-10 | new `impersonation_sessions`, `impersonation_page_views` | the distinct session type: the admin actor, the subject identity, the controlled-vocabulary reason and its non-blank detail, the start and the hard expiry, the explicit exit, and the page-view audit. Three `CHECK` guards bound the box and make an exit complete. **The load-bearing part is not a column**: two triggers refuse any `token_hash` that exists in `sessions.refresh_token_hash`, **in both directions**, so a token minted for impersonation cannot resolve on the trader auth path at all | 0042 | **landed** |
**The three `SD-M6-nn` numbers between `06` and `10` are unclaimed and are not this session's.** [FOLD-03](../../docs/plans/FOLD-03-vendor-parity-gap-fill.md) `F2` and `F3` both write [M06](../../docs/plans/M06-admin-ops-console.md) concurrently and the run is left for them.
**They are named by position here, and the first draft of this paragraph named them outright on the theory that this file is exempt from its own gate.** It is not. [`gates.mjs:1537`](../../scripts/corpus/gates.mjs) scans `docs/**` **and `packages/db/DELTA_MANIFEST.md`**, so a number written here needs a row here exactly as one written under `docs/` does. **The gate's finding text at [`gates.mjs:1542`](../../scripts/corpus/gates.mjs) says `cited in docs/` and points the reader at the one file set that does not contain the citation**, which is why the theory survived being typed. Recorded rather than repaired: `gates.mjs` is held by three concurrent sessions and a shared file earns a minimal diff.
---
## 4c. FOLD-04: [ADR-069](../../docs/decisions/ADR-069.md), 1 numbered delta
**Session `I4` of [FOLD-04](../../docs/plans/FOLD-04-impersonation-and-admin-parity.md), the admin capability parity closure.** The number is allocated by this row existing, on section 4a's rule.
| SD-M6-11 | `admin_actions` | `initiative text NOT NULL CHECK (initiative IN ('enforcement','trader_request','operational'))` and `on_behalf_of_identity_id uuid NULL REFERENCES identities(id) ON DELETE RESTRICT`, with the **biconditional** constraint `admin_actions_on_behalf_matches_initiative` asserting `(on_behalf_of_identity_id IS NOT NULL) = (initiative = 'trader_request')`, plus the partial index `admin_actions_on_behalf_idx` that is the dual-timeline read | 0043 | **landed** |
**`0043` was RESERVED AS CONTINGENT and the contingency was tested rather than assumed.** [ALLOCATION](../../docs/decisions/ALLOCATION.md)'s row required the parity session to *"confirm the delta before spending the number"* and to release it *"if the attribution is expressible without one"*. **It is, and initiative is not**, which is a different question that the reservation's wording did not separate.
| Property [ADR-069](../../docs/decisions/ADR-069.md) requires | Carried before `0043`? |
|---|---|
| **Attributed to the admin** | **Yes.** [`0017`](migrations/0017_events_and_audit.sql) gives `admin_actions` `actor`, `action`, `subject_kind`, `subject_id`, `reason NOT NULL`, `before`, `after`, `evidence_refs` and `ip` |
| **A mandatory reason** | **Yes**, and the `NOT NULL` is the existing control |
| **The trader half of the dual timeline** | **Yes.** `events.actor_kind` is `CHECK (actor_kind IN ('system','trader','admin','vendor'))` with `actor_id`, `identity_id` and `account_id`, and `GET /accounts/:accountId/timeline` is a projection of `events` |
| **On whose initiative the action was taken** | **No, nowhere.** Nothing distinguished an admin acting **on** a trader from an admin acting **for** one |
**The finding that decided it.** `CloseRequest` carries `kind: "enforcement" | "trader_request" | "operational"` on `POST /admin/accounts/:accountId/close`, which is the one trader-requested admin act the corpus already models, and **that field has no column anywhere**: [`0007`](migrations/0007_accounts.sql)'s `account_status_history` carries `from_status`, `to_status`, `from_phase`, `to_phase` and a nullable `reason`, and no `kind`. So the existence proof the parity audit builds its argument on **cannot be queried as one**. `0043` takes that vocabulary unchanged rather than inventing a second one.
**Why it lands before any of the eighteen parity routes exists.** `admin_actions` is append-only ([`0026`](migrations/0026_roles_and_grants.sql) revokes `UPDATE` and `DELETE` from `merit_app` and from `PUBLIC`) and its retention is forever. **A discriminator added after rows exist leaves every historical row `NULL`, and `NULL` is then ambiguous between "Merit's own act" and "written before the column existed".** It is unambiguous only if it is never null, and never null only if it arrives while the table is empty. E2 makes a merged migration unfixable rather than expensive, so this is the last cheap moment.
**`0043` is not in section 1's table**, on `0032`'s and `0039`'s precedent: that table is closed at 27 and records what the fold created. `0043` creates no table, supersedes nothing and edits no merged file.
**No probe ships with it, and that is a choice rather than an omission.** The biconditional is a `CHECK`, so the workflow's forward-only apply proves it **installs**; a probe would prove it **refuses**. Wiring one needs a step in [`corpus.yml`](../../.github/workflows/corpus.yml) and a pin in [`gates.mjs`](../../scripts/corpus/gates.mjs) under `CI-06s`, **neither of which was in the writing session's fence**, and an unpinned probe is `OI-07` for the fifth time. `0041` shipped without one for the same reason.

## 5. The seven unnumbered changes

Rulings the schema did not yet express. **Five of the first six were invisible because nobody was counting**, and the sixth was miscited to a delta that means something else. This is the reason a count matters. The seventh arrived with [ADR-039](../../docs/decisions/ADR-039.md) and was unnumbered for `U-04`'s reason exactly.

| # | Change | Source | Migration | Status |
|---|---|---|---|---|
| U-01 | new `identity_signal_weights` | ADR-022, M07 D-16 | 0025 | **landed**, **reserved** (ADR-022 tiers it to v1.x) |
| U-02 | `accounts.graduation_eligible` | ADR-024, M01 R-49 | 0007 | **landed** |
| U-03 | new `ledger_halts`, identity-scoped with an escalation clock | ADR-016, M05 INV-M5-16 | 0016 | **landed** |
| U-04 | `identity_signals.kind` gains `footprint_enrichment` | ADR-023, M07 D-15 | 0002 | **landed** |
| U-05 | `kyc_verifications.placement` check widened to the ruled trigger set | ADR-021 | 0003 | **landed** |
| **U-06** | `provisioning_status` gains **`confirmed_inferred`**, plus the binding that `set_risk` may never reach it | M02 section 3.2, AS-M2-03 | 0001 (value), 0007 (binding CHECK) | **landed** |
| **U-07** | `identity_signals.kind` gains **`phone`** and **`phone_carrier`** | [ADR-039](../../docs/decisions/ADR-039.md), [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md) section 4 change 7 | 0029 | **landed** |

**`U-06` was found while folding and is the sixth unnumbered change.** The approved [DATA_MODEL section 6](../../docs/architecture/data-model/README.md) declares `provisioning_status` with five values; [M02 section 3.2](../../docs/plans/M02-rithmic-bridge.md) adds a sixth and makes it a distinct state rather than a synonym, and AS-M2-03 makes it **binding that a `set_risk` operation may never reach it**. That is a schema change to an approved document with no delta number, which is the definition of an unnumbered change.

**Ruled by the founder, 2026-08-14: it is `U-06`, and the total in scope is 94.** `0001`'s inline marker previously read `-- SD-M2-06`, which is the `reconciliations` delta and lands in `0014`. **The marker is corrected to `-- U-06` in `0001` and added in `0007`.** Editing `0001` is permitted because it is committed and **not merged**; the rule is that a migration is never edited *once merged*, and shipping a knowingly wrong citation into a merge is the worse outcome.

**`U-07` is unnumbered for `U-04`'s reason exactly**: [ADR-039](../../docs/decisions/ADR-039.md) creates a signal source and no delta creates the value it writes under. [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md) section 4 marks change 7 "unnumbered" in its Owner column and says it "takes the next free unnumbered slot", which is this row. **Two kinds and not one**, because they are different nodes in [ADR-022](../../docs/decisions/ADR-022.md)'s graph and weigh differently: `phone` is the high-weight node the whole ruling turns on, and `phone_carrier` is a weak observation worth something only inside a composite, because every prepaid VoIP number on one carrier is a country and not a fleet.

## 6. Rejection table

**No delta was rejected.** This table says so explicitly rather than being absent, because a rejection table that is missing is indistinguishable from a delta that was dropped. A delta that is ever rejected is rejected in writing, in an ADR, never by omission.

## 7. Two things the corpus called additions and that are not deltas

- **`ladders_completed_lifetime`** is already inside `SD-M14-01`'s column list.
- **The `SD-M19-03` widening** is an amendment to an existing delta, not a new one.

Both fold. Neither is counted twice.

## 8. Open items carried out of the fold

Items found while folding that are **not schema deltas** and are **not closed**. They are here rather than only in a session log because this is the file the next session reads first.

**`OI-nn` is claimed in [ALLOCATION](../../docs/decisions/ALLOCATION.md) before the row is written, since session 141 moved it there under [ADR-074](../../docs/decisions/ADR-074.md) section 7; a SECTION number is still claimed in [section 16](#16-allocation-oi-nn-identifiers-and-section-numbers), which is this document's own namespace and stays.** Section 16's table exists because this one collided: **two rows below are numbered `OI-06`**, written on the same day by two sessions that each read this section, each found `OI-05` as the maximum and each took `06`. They are **not renumbered**, they are cited with their subject attached, and section 16 records why.

| # | Item | Status |
|---|---|---|
| **OI-01** | **`liability_snapshots` exists in two shapes.** The migration (`0009`) follows `SD-M6-01`: keyed on `as_of timestamptz`, carrying `open_liability_cents`, `bounded_near_term_cents`, `remaining_ladder_exposure_cents`, `wallet_balances_cents`, `absorbed_corrections_cents`. [DATA_MODEL section 8](../../docs/architecture/data-model/README.md) still shows the earlier shape keyed on `snapshot_on date` with `funded_accounts`, `reserve_cents`, `cvar99_cents`, `rcr_bp` and `per_plan`. **The migration is the truth.** The four RCR and CVaR fields have **no home in the folded shape** and need one before [M06](../../docs/plans/M06-admin-ops-console.md) is built: the reserve coverage ratio is the number that decides whether sales pause | **CLOSED** 2026-08-27 by [ADR-128](../../docs/decisions/ADR-128.md) and [`0049`](migrations/0049_reserve_coverage_snapshots.sql), `status: proposed`, approval line UNSIGNED, `E2` owed. **[STATE](../../docs/STATE.md) HAS CARRIED THE CLOSURE SINCE THE DAY IT HAPPENED AND THIS ROW DID NOT**, which is the third time in this register that a row outlived the work it tracks. **ONLY THREE OF THE FIVE FIELDS NEEDED THE NEW TABLE**, and `0049`'s own header is where that is argued: `reserve_cents`, `cvar99_cents` and `rcr_bp` are reserve coverage *"on a cadence that is not the liability snapshot's"*, while `funded_accounts` is **NOT** reserve coverage and belongs on `liability_snapshots`, and `per_plan` has had a home in `plan_breaker_state` since [`0016`](migrations/0016_treasury_controls.sql) -- **thirty-three migrations of an orphan that was not orphaned.** `rcr_bp` is a GENERATED column, which is the direct answer to the ratio being derivable rather than stored |
| **OI-02** | **`published_statistics` cannot express three of the seven ruled statistics.** ST-04 publishes mean **and** median together and "neither is published alone"; ST-05 and ST-06 each publish **p50 and p95**. Two rows for one statistic, window and grain collide on `published_statistics_window_uq`, and no column distinguishes which figure a row carries. Proposed fix: a `measure` discriminator (`rate`, `total`, `mean`, `median`, `p50`, `p95`, `count`) on the table and in the index. **Applied** by [ADR-032](../../docs/decisions/ADR-032.md), together with **STAT-C1**, a deferred constraint trigger in `0027` asserting that a publish run emitting one measure emits every measure its definition declares. The column made the second figure writable; the trigger is what makes it required | **CLOSED** (2026-08-14) |
| **OI-03** | **`0026`'s append-only revoke list is a list, and a list drifts.** Eighteen tables are named there against [DATA_MODEL section 1](../../docs/architecture/data-model/README.md)'s Mutability set. The CI check must assert the revoke list **against the document** rather than trusting either | **CLOSED** 2026-08-28. **THE CHECK WAS BUILT AND THIS ROW WAS NEVER MOVED**, which is the drift the row itself is about, one register over. [`scripts/db/assert_append_only_grants.mjs`](../../scripts/db/assert_append_only_grants.mjs) reads the fenced block in [DATA_MODEL section 1](../../docs/architecture/data-model/README.md) and `has_table_privilege` over the installed schema, and compares them **in both directions**; [`corpus.yml`](../../.github/workflows/corpus.yml) runs it TWICE, `--falsify` first and then the assertion, because an assertion with no natural failures reports PASS in exactly the same way as one narrowed until it reads nothing. **IT HAS SINCE CAUGHT A REAL FALSE FINDING OF ITS OWN**: its definition of append-only asked only whether `merit_app` lacked `UPDATE` and `DELETE`, against an unstated premise that `merit_app` could reach the table at all, and [`0050`](migrations/0050_live_cache_and_role.sql)'s `REVOKE ALL ON live_account_state` for `FM-M12-08` answered yes while `merit_live` UPDATEs that table. The derivation now takes `INSERT` as well, a **second declared block** names the tables `merit_app` cannot reach at all, and **the partition between them is asserted** so the added conjunct decides which list a table owes an entry to rather than shrinking the union guarded |
| **OI-04** | **Two legitimate single-column updates on append-only tables** (`daily_marks.superseded_by`, `identity_links.suppressed`) are forbidden by the grants and require `SECURITY DEFINER` functions that **do not exist yet**. A naive first implementation of either transition fails at the grant, which is the correct failure and will look like a bug | **CLOSED** by [`0048`](migrations/0048_audited_writes_on_append_only_tables.sql), and **TWO REGISTERS DISAGREED ABOUT IT**: [DATA_MODEL section 1](../../docs/architecture/data-model/README.md) has said *"That closes `OI-04` and `OI-13`"* since `0048` landed, while this row still read OPEN. `0048` creates `supersede_daily_mark`, `suppress_identity_link` and `rewrite_rule_state`, each `SECURITY DEFINER`, each owned by `merit_migrator`, each granted `EXECUTE` to `merit_app` and revoked from `PUBLIC`, each with its negative-authz case in [`scripts/db/probe_audited_writes.sql`](../../scripts/db/probe_audited_writes.sql). **THE ROW UNDERSTATED THE WORK IN ONE PLACE AND THAT IS WORTH KEEPING**: it calls both transitions *"single-column"* and `identity_links` is FOUR columns, since `identity_links_suppression_has_author` makes `suppressed_by` mandatory, so `disputed_at`, `dispute_note`, `suppressed` and `suppressed_by` move together or the write is not a dispute resolution |
| **OI-05** | **`0027`'s published-plan-version immutability trigger reads `NEW.config`, and `plan_versions` has no `config` column.** The rule contract is `rules`. PL/pgSQL resolves record fields at execution, so the migration installs cleanly and the function is wrong only when it fires. **Proven by execution, not by reading**: every `UPDATE` against a published row raises `record "new" has no field "config"`. The immutability promise survives by accident, because the error rejects the write; **the ruled `published -> retired` transition is refused too, so no plan version can be retired.** A draft row updates normally, which is why the install check and every probe in section 10 missed it. **`0027` is merged and is not edited**: the fix is a superseding migration, which takes the set from 27 files to 28 | **CLOSED** 2026-08-15. [ADR-035](../../docs/decisions/ADR-035.md) **accepted**; fixed by `0028`, which carries an `E2 READ` header and still needs the founder's read. **Two amendments at acceptance are larger than the ADR as proposed** (the whole row is pinned rather than a list of columns, and a retired row is now frozen absolutely per STATE_MACHINES section 9). The structural fix is **[CI-06j](../../docs/testing/STRATEGY.md)**, which found it from the tree with no database |
| **OI-06** **(payout destinations)** | **The 48 hour payout-destination cooling window has no storage.** [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md) finding 5, found by trying to model (c) on the control (c) says to copy. `destination_ref` on `payout_transfers` (`0010:243`) and `wallet_withdrawals` (`0011:132`) is the destination **of a transfer**; **no table records that a destination changed or when**. C-11, C-24, [SECURITY section 4](../../docs/architecture/SECURITY.md) item 1, `WF-M20-02` and [M04](../../docs/plans/M04-trader-portal.md)'s destination-cooling scenario all cite a control whose input does not exist. **Recommendation, offered without deciding it**: a `payout_destinations` registry keyed on `(identity_id, destination_ref)` carrying `first_seen_at` and `cooling_until`, read by both payout legs and by the affiliate rail under C-24, in its own migration after its own session. **`0029` builds the phone hold on its own storage and does not touch this**, because folding a change nobody asked for into the diff the founder reads line by line is how a review stops being a review | **CLOSED** 2026-08-27. [ADR-169](../../docs/decisions/ADR-169.md) **accepted**, and the recommendation above is TAKEN on its key and its two columns and **AMENDED on the one word it does not contain**. The registry is [`0051`](migrations/0051_payout_destinations.sql), which carries an `E2 READ` header and still needs the founder's read. **THE AMENDMENT IS `cooling_until NOT NULL`**: read literally, the recommendation admits an `INSERT` that omits the column, and such a row is **usable the instant it exists**, because the gate reads `cooling_until > now()` and a NULL compares to nothing -- a fail-OPEN on the row written at the exact moment `C-11` exists to slow down. **THE KEY SURVIVED FOR A MEASURED REASON**: one row per pair keeps `G-DESTINATION-COOLING` a keyed lookup, and the append-only alternative puts the read on `max(cooling_until)`, **the scalar aggregate [ADR-157](../../docs/decisions/ADR-157.md) refused**, which would leave `P5-h` unreachable through `scopedDb`. **THE ROW AS RAISED IS NARROWER THAN THE GAP AND THAT HALF IS STILL OPEN**: it names *"the affiliate rail under C-24"* as a reader, and [session 162](../../docs/sessions/2026-08-24-session-162.md) measured that `affiliates` carries **no destination column at all**, so `INV-M8-11` now has a registry to write into and still nothing that says what an affiliate's current destination is |
| **OI-06** **(calendar prior image)** | **Nothing in the database forces an `UPDATE` to `trading_calendar` to write a `trading_calendar_revisions` row.** `0032` creates the prior-image table [ADR-042](../../docs/decisions/ADR-042.md) F-2 ruled and the loader writes to it; a hand-run `UPDATE` against the calendar leaves no prior image and `INV-04`'s replay is back where F-2 found it. **A trigger would make it a control rather than a rule somebody follows**, and `0027` is where the invariant triggers live. **ADR-042 is silent on it**, so `0032` does not add a money-path trigger on its own authority: per CLAUDE.md, silence means propose an ADR and proceed on approval. The same question covers whether a `DELETE` from `trading_calendar` should be forbidden outright, which today only the revisions foreign key partly prevents | **CLOSED** 2026-08-16. [ADR-045](../../docs/decisions/ADR-045.md) **accepted**; the guards are `CALENDAR-C1` and `CALENDAR-C2` in [`0033`](migrations/0033_trading_calendar_revision_required.sql), which carries an `E2 READ` header and still needs the founder's read. **The ruling is larger than the row as raised**: the `DELETE` half this row calls "the same question" is answered too, because `DELETE` then `INSERT` is an `UPDATE` with the audit trail removed, and `TRUNCATE` is named beside it because it fires no row triggers at all. **And `dependent_row_count` is now counted rather than reported**, which section 17 records as the half that was proven by watching a zero pass without it |
| **OI-07** | **`0029` has no committed probe.** [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md)'s definition of done names `scripts/db/probe_phone_identity.sql`, and section 14 below records 48 assertions **executed** against the installed schema on 2026-08-16. They were executed ad hoc and are **not re-runnable in CI**, because the session brief's stop condition was the migration, its data-model files and its manifest rows. **That is the exact object section 13 names**: a probe that ships beside a fix and never runs again is the same thing as the golden test that was missing. Owed: the probe file, leading with the success case, plus its step in [`corpus.yml`](../../.github/workflows/corpus.yml) beside the ledger and ADR-035 probes | **CLOSED** 2026-08-16. [`scripts/db/probe_phone_identity.sql`](../../scripts/db/probe_phone_identity.sql), wired into CI-06h. Section 15 records what it asserts and how it was watched failing. **It leads with the success case and the ruling is a permission**: a second identity verifying a live number must COMPLETE, and an absence (no unique index on `phone_hash`) is asserted as an absence, because "completing the pair" looks like tightening a constraint in a diff. **The step is pinned by [CI-06h](../../scripts/corpus/gates.mjs)**, so deleting it is itself a gate failure: an unpinned probe is one delete away from the object this row exists to name |
| **OI-08** | **The NO-FLOATS `DO` block is positional, and everything after `0027` is outside it.** Section 9 says the assertion "fails the migration" if any column in `public` is `numeric`, `real` or `double precision` outside the two exempt ones. It lives in `0027` and therefore reads the schema **as of `0027`**: `0028` and `0029` both land after it, and **a future migration adding a `numeric` money column would sail past the guard the corpus believes protects it.** It was checked by hand for `0029` (section 14) and the set is still exactly the two `correlation_groups` columns. **Recommendation**: re-assert it in the install job after the whole set applies, beside the object-count derivation, so it is positionally last by construction rather than by whoever remembers. It is a two-line step and it belongs with the gate work, not inside a money-path migration | **CLOSED** 2026-08-16. [`scripts/db/assert_no_floats.sql`](../../scripts/db/assert_no_floats.sql), run in the install job after every migration applies, so it is positionally last **by construction**. **By the time it was fixed the gap had reached five migrations** (`0028` to `0032`), not the two this row was written against. `0027`'s block is **deliberately left in place**, per E2: migrations are sacred, once merged never edited. The exemption list is still exactly `correlation_groups.statistic` and `.threshold` on the full 32-file schema, **and it now fails in both directions with each direction watched firing** |
| **OI-09** | **`CI-06n` accepts a link in prose where its own title says a row.** The gate matches **any markdown link anywhere in a registry README**, so [ADR-043](../../docs/decisions/ADR-043.md) sat outside the ADR registry table for a day while being linked from a sentence in its preamble, and nothing reported it. Its `covers` line is honest ("is linked from") and its **title** is not, which is why a merged ADR could fall out of the registry it belongs to with twelve gates green. **The missing row is added; the gate is not narrowed here**, because narrowing it needs a sweep of every registry directory [ADR-043](../../docs/decisions/ADR-043.md) created plus a seeded violation it has been watched failing on, and this session's stop condition was `0033` | **CLOSED** 2026-08-28. **THE GATE WAS NARROWED AND ITS TITLE AND BEHAVIOUR NOW AGREE.** `CI-06n` requires a TABLE ROW rather than any link, and it counts the difference in its own note: *"786 entry file(s) over 1007 README ROW link(s) across 5 registries; **0 entry link(s) outside any row, prose or fenced**, claimed as nothing."* That last clause is the row's exact ask: a link in a preamble sentence is now counted separately and claimed as nothing rather than silently satisfying the gate, so the case that opened this row -- [ADR-043](../../docs/decisions/ADR-043.md) sitting outside the registry table for a day while linked from prose -- **is reported instead of passing** |


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

## 14. `0029` lands, and forty-eight assertions are executed (2026-08-16)

**[`0029_phone_identity_and_auth.sql`](migrations/0029_phone_identity_and_auth.sql), [ADR-039](../../docs/decisions/ADR-039.md).** The full <!--gen:migration_files-->69<!--/gen-->-file set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP=1`, re-applying it is rejected, and the database reports **<!--gen:sql_tables-->118<!--/gen--> tables, 340 indexes, 381 check constraints, <!--gen:sql_triggers-->29<!--/gen--> triggers**. No file was edited to make that pass.

**The deltas relative to `0028`'s figures are +3 tables, +14 indexes, +34 check constraints, +0 triggers.** `0029` installs **no trigger and no function**, which is why the trigger count does not move and why [CI-06j](../../docs/testing/STRATEGY.md) has nothing new to resolve. The hard link's severity-5 flag is application logic, not a trigger, because [ADR-039](../../docs/decisions/ADR-039.md) rules that it changes no state automatically and a trigger that opens a flag **is** automatic state.

**No array column is declared anywhere in `0029`**, so [ADR-035](../../docs/decisions/ADR-035.md)'s `array_length` trap has no surface here. Stated rather than left implicit: `grep -n 'array_length' packages/db/migrations/*.sql` still returns only `0027`'s three correct `IS NOT NULL` uses.

### The probe leads with the success case

`0028`'s transferable lesson, applied. **Every assertion in section 10 attempted a forbidden thing, so every one of them passes against a guard that rejects everything.** These lead with what must be permitted, and the two most important rows in the table are permissions rather than rejections.

| Assertion | Result |
|---|---|
| An identity verifies a phone at registration | **permitted** |
| **A second identity verifies a number already live on the first** | **permitted.** ADR-039's phone-to-identity half completes and raises the flag; the database does not refuse. If this ever starts failing, the recycling guard is dead and the innocent owner of a reassigned number is in a support ticket |
| The same identity verifies a second live phone | rejected: `identity_phones_live_per_identity_uq` |
| A release with no evidence | rejected: `identity_phones_release_is_evidenced` |
| **A released row frees the live index** | **permitted.** The identity verifies a new phone with no operator unpicking anything |
| A row both superseded and released | rejected: `identity_phones_one_ending` |
| A port date with no port flag | rejected: `identity_phones_port_date_implies_ported` |
| `ported = true` with no date, the case the guard cannot resolve | **permitted**, and it routes to review rather than forcing an invented date |
| A lookup timestamp with no provider | rejected: `identity_phones_lookup_is_attributed` |
| **VoIP at capture** | **permitted. Scored, never rejected**, and there is no constraint anywhere in the file that could refuse a line type |
| Applying a phone change with no dual-channel verification | rejected: `phone_change_requests_applied_is_complete` |
| Applying with no prior-contact notification | rejected: same constraint |
| **Applying with an already-expired withdrawal hold** | **rejected: same constraint.** A hold that expired before the change landed is not a hold |
| Applying with all three D4 controls and a running hold | **permitted** |
| A second open change request for one identity | rejected: `phone_change_requests_open_per_identity_uq` |
| An unexplained cancellation | rejected: `phone_change_requests_cancellation_is_explained` |
| An SMS-established session | **permitted.** Any single factor logs in |
| **Elevating that session by SMS** | **rejected by `sessions_elevated_by_factor_check`, which is the check list itself.** C-27 is a vocabulary, not a handler |
| Elevating the same session by dual channel | **permitted** |
| An elevation with no factor recorded | rejected: `sessions_elevation_is_complete` |
| A session with no `auth_factor` | rejected: not-null |
| An SMS challenge, and an email challenge unchanged from `0002` | **both permitted** |
| A challenge with both destinations, or with neither | rejected: `otp_challenges_exactly_one_destination`, both ways |
| An armed budget row | **permitted** |
| **A budget row in a state named `paused`** | **rejected: `otp_send_budget_state_check`. There is no stopping state, and that is the founder's ruling rather than an omission** |
| A silent trip | rejected: `otp_send_budget_degraded_is_alarmed` |
| A trip that raises its alarm, and the deferral count during the window | **both permitted** |
| Deferred registrations with no trip behind them | rejected: `otp_send_budget_deferrals_have_a_trip` |
| A second global row under another spelling | rejected: `otp_send_budget_global_is_singular` |
| An override with no expiry | rejected: `otp_send_budget_override_is_complete` |
| `contact_channels` accepts `sms`, and still refuses `fax` | **permitted / rejected** |
| `identity_signals` accepts `phone` and `phone_carrier`, and still refuses an invented kind | **permitted / rejected** |
| **`pre_identity_auth` reads back `rate_limit_exempt = false` and `mutable = false`** | **confirmed by selecting the generated columns.** Amendment 2 holds by construction, and nobody can opt out of the OTP proving they own the number they are registering |
| **The `security` class still reads back `rate_limit_exempt = true`** | **confirmed. `INV-M16-11` is unchanged, which is what "confirmed rather than amended" has to mean in the database** |
| Writing `rate_limit_exempt` directly | rejected: it is `GENERATED ALWAYS` |
| Coalescing a pre-identity kind | rejected: `notification_kinds_immutable_never_coalesced` |
| `reverify_phone_change` superseding an initial verification | **permitted** |
| `reverify_phone_change` superseding nothing | rejected by `kyc_verifications_supersession_matches_purpose`, **a constraint `0003` wrote against the shape rather than against a list, so it bound a value that did not exist when it was written** |

**Every rejection is checked by message text, not by exception class**, per section 13. A handler catching "any error" scores a wrong-reason failure as the constraint working, which is exactly how ADR-035's defect survived a founder-grade review and a 27-file install check.

**These forty-eight ran ad hoc and were not re-runnable in CI. That was `OI-07`**, and it was not a footnote: the stop condition for this session was the migration, its data-model files and these manifest rows. A probe that ships beside a fix and never runs again is the same object as the golden test that was missing. **`OI-07` closed on 2026-08-16**: they are [`scripts/db/probe_phone_identity.sql`](../../scripts/db/probe_phone_identity.sql) now, run by CI-06h on every push, and section 15 records what changed in the translation from a table to a file.

### Two things verified beyond the constraints

**Grants.** `0026`'s `ALTER DEFAULT PRIVILEGES` covers all three new tables with no line in `0029`: `merit_app` holds `SELECT, INSERT, UPDATE, DELETE` on each and `merit_analytics` holds nothing, which is the ruled default that a table added later is invisible to analytics until someone grants it deliberately. **None of the three is append-only**, for `contact_channels`' reason: supersession is written by `UPDATE` on the superseded row, so `0026`'s revoke list is unchanged and `OI-03` gains nothing to reconcile.

**No floats.** The non-integer set on the installed schema is still exactly `correlation_groups.statistic` and `correlation_groups.threshold`. It was confirmed by querying `information_schema.columns` **rather than by the `DO` block**, and the difference is `OI-08`: the block lives in `0027` and cannot see a column that `0029` adds. **`OI-08` closed on 2026-08-16**, by which point the blind spot ran from `0028` to `0032`; the assertion runs in the install job now and the hand query is no longer the only thing checking.
## 14. `0030` and `0031` land, and the split is proven by watching the combined form break (2026-08-16)

**[ADR-040](../../docs/decisions/ADR-040.md) (the payout enforcement window) and [ADR-041](../../docs/decisions/ADR-041.md) (identity-level restriction), FOLD-02.** Two files, and the second one is not a stylistic preference.

| # | File | Money path | Contents |
|---|---|---|---|
| 0030 | `payout_hold_enum` | yes | `ALTER TYPE payout_status ADD VALUE 'held_pending_review'`. **One statement, no `BEGIN`/`COMMIT`** |
| 0031 | `payout_hold_and_identity_restriction` | yes | the five hold columns and `payout_requests_hold_is_complete`; **both** `SD-09` predicates dropped and re-created under their own names; `payout_requests_hold_expiry_idx`; `wallet_withdrawals_live_freeze_blocks_settlement` and the re-created open index; `identity_restriction_episodes`; the replacement `COMMENT ON TABLE payout_requests` |

**Two files because one is impossible, and that is executed rather than cited.** A combined form was written and applied against PostgreSQL 16:

```
BEGIN
ALTER TYPE
DROP INDEX
ERROR:  unsafe use of new value "held_pending_review" of enum type payout_status
LINE 3:   WHERE status IN ('approved', 'frozen', 'held_pending_revie...
HINT:  New enum values must be committed before they can be used.
```

`psql` exited **3**. The split form was then applied to the **same database** and succeeded. PostgreSQL refuses to *use* a new enum value inside the transaction that *added* it, and `0031` re-creates both `SD-09` predicates with the new value inside them, so every one of those predicates is such a use. Combining the files does not produce a slower migration; it produces one that **cannot run**.

**The first run of that counterfactual reported the wrong verdict, and the harness was the defect rather than the migration.** It was written `if psql ... | tee out.txt; then`, which tests **`tee`**'s exit status and never `psql`'s, so a failing migration scored as a pass. Rewritten to capture `rc=$?` from `psql` directly. Recorded here because it is section 13's lesson in a new costume: **the assertion that cannot fail is worth nothing, and it looks exactly like the assertion that passed.**

### Install verification, from empty

**All 30 files apply forward-only against PostgreSQL 16 with `ON_ERROR_STOP=1`, one file per `psql -f` invocation, zero errors.**

| | `0001`-`0028` | `0001`-`0031` | Delta |
|---|---|---|---|
| tables | 96 | **97** | `identity_restriction_episodes` |
| indexes | 326 | **331** | its primary key and three indexes, plus `payout_requests_hold_expiry_idx`. The four dropped-and-re-created indexes net zero, which is the point of re-creating them under the same names |
| check constraints | 347 | **351** | `payout_requests_hold_is_complete`, `wallet_withdrawals_live_freeze_blocks_settlement`, `identity_restriction_restore_is_complete`, `identity_restriction_restore_follows_open` |
| triggers | 6 | **6** | unchanged |

**Re-application is rejected on both files.** `0031` fails at `column "held_at" of relation "payout_requests" already exists`; `0030` fails at `enum label "held_pending_review" already exists`. Both exit **3**. Neither file is idempotent and neither pretends to be: the migration runner applies each file once, and a file that silently tolerates a second application is a file that cannot tell a fresh database from a corrupted one.

### Probe: [`probe_payout_hold.sql`](../../scripts/db/probe_payout_hold.sql), 11 assertions, **11 / 11**

**It leads with six success cases and section 13 is why.** A guard that rejects everything passes every rejection test ever written against it, so the successes come first.

| | Assertion | Result |
|---|---|---|
| SUCCESS 1 | a held request stores the full evaluated decision: snapshot, `approved_cents`, the split, the ordinal, the pinned plan version. Only the ledger posting is deferred | **passes** |
| SUCCESS 2 | the hold auto-releases to `approved` and pays, re-evaluating nothing (INV-M5-02) | **passes** |
| SUCCESS 3 | enforcement sends the request to `failed`, which **frees the ordinal** for a new request (EC-037) | **passes** |
| SUCCESS 4 | a restriction episode opens with its cited flag, its ToS clause and its clock | **passes** |
| SUCCESS 5 | a documented restore is provable from the episode row, by actor and evidence | **passes** |
| SUCCESS 6 | a restored episode frees the partial unique, so the same human can be restricted again with the earlier episode intact | **passes** |
| REJECTION 1 | `payout_requests_no_in_flight_uq` refuses a second request beside a **held** one | **fires** |
| REJECTION 2 | `payout_requests_hold_is_complete` refuses a hold with no cited flag | **fires** |
| REJECTION 3 | `wallet_withdrawals_live_freeze_blocks_settlement` refuses settlement under a live freeze | **fires** |
| REJECTION 4 | at most one open episode per identity | **fires** |
| REJECTION 5 | `identity_restriction_restore_is_complete` refuses a restore with no actor | **fires** |

**REJECTION 3 is the one worth naming.** `0011` gave `wallet_withdrawals` a freeze clock, a freeze flag and a freeze-expiry index, and `wallet_withdrawal_status` has no frozen value. **The halt was representable and entirely unenforced**: a halted withdrawal still matched the open index and nothing whatsoever refused settlement. Nobody had to write the defect; it arrived by writing half the mechanism and reading the other half as done.

**The probe cost five fixture corrections before it ran, and every one was a constraint this set already enforced** (`users.email`; a severity-5 `risk_flags` row needing `sla_due_at`; `plan_versions` needing `public_slug`, `created_by` and a publish transition; `purchases` needing its four money columns plus a PSP reference; a funded `accounts` row needing `funded_on`). Each was fixed by reading the DDL rather than guessing at it. **A schema that is hard to write a fixture against by guessing is the schema working**, and it is also the reason CI-03's golden fixtures load from a declared file rather than from a session's memory.
## 14. `0032` lands, and the weak reading of F-1 is falsified by execution (2026-08-16)

**[`0032_trading_calendar_holidays_coverage_revisions.sql`](migrations/0032_trading_calendar_holidays_coverage_revisions.sql), [ADR-042](../../docs/decisions/ADR-042.md) accepted.** F-1 through F-4, and **the four are one migration or none**. It supersedes `0004_catalog`'s `trading_calendar` constraints and `0026_roles_and_grants`' append-only revoke list. **Neither file is edited.**

**No numbered delta lands here.** F-1 to F-4 are ADR-042 findings rather than `SD-nn` rows, so [ADR-026](../../docs/decisions/ADR-026.md)'s completeness gate has nothing to count and this section is the record instead. The manifest's 94 stands.

**The set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP=1`, zero errors.** `0029` to `0031` are reserved and unwritten ([ALLOCATION](../../docs/decisions/ALLOCATION.md)), so the applied sequence is `0001` to `0028` then `0032`, which is the same order `corpus.yml`'s glob produces.

| Object counts | After `0028` | After `0032` |
|---|---|---|
| tables | 96 | **98** |
| indexes | 326 | **332** |
| check constraints | 347 | **359** |
| triggers | 6 | **6** |

### What each finding actually carries

| # | In `0032` | In the schema |
|---|---|---|
| **F-1** | `session_open_at` and `session_close_at` lose `NOT NULL`; `trading_calendar_session_ordered` is **dropped and rewritten under its own name**; `trading_calendar_holiday_has_no_session` is added | A holiday is writable, and it is a **positive fact rather than an absence** |
| **F-2** | `trading_calendar_revisions`, append-only by grant | Replay can tell a calendar correction from an engine regression |
| **F-3** | `COMMENT ON COLUMN session_close_at` carrying the latest-close semantics, plus `trading_calendar_half_day_records_group_closes` | The per-group times are recorded. **No symbol dimension**: it changes R-01's contract |
| **F-4** | `trading_calendar_loads`, append-only by grant | A day outside coverage is **unknown**, and the batch fails closed rather than reading it as an unbroken holiday |

### The counterfactual, because the weak reading of F-1 looks correct and is not

**Dropping `NOT NULL` from a column named inside an existing `CHECK` does not make the `CHECK` null-safe. It makes it vacuous on exactly the rows that now carry `NULL`**, because `session_close_at > session_open_at` evaluates to `NULL` when either side is `NULL`, and **a `CHECK` that evaluates to `NULL` passes**. That is the identical defect [ADR-035](../../docs/decisions/ADR-035.md) found seven times in the `array_length` form and fixed in `0028`, arriving a second time through a different door.

It was **executed rather than reasoned about**, on [ADR-027](../../docs/decisions/ADR-027.md)'s counterfactual idiom. A scratch schema carrying `0004`'s table with `NOT NULL` dropped, F-1's ruled `CHECK (is_holiday = (session_open_at IS NULL))` added and **the ordering `CHECK` left alone**, was given a holiday with a `session_close_at` and no `session_open_at`:

```
insert into tc(trading_day, session_close_at, is_holiday)
values ('2026-01-01','2026-01-01 21:00Z', true);
-- COUNTERFACTUAL COMMITTED: 1 row(s)
```

**A fabricated close instant, on a day the exchange is shut, in a containment table, past both ruled constraints.** The ruled `CHECK` names `session_open_at` only, so it cannot see a stray close; the ordering `CHECK` returns `NULL` and passes. `0032`'s rewritten constraint admits the two legitimate states and nothing else: both columns `NULL`, or both non-`NULL` and ordered.

### Perturbations, one per assertion, checked by message rather than by exception class

**36 assertions against the full applied set. Every group leads with its positive control**, which is `0028`'s transferable lesson: a probe that only attempts forbidden things passes against a guard that rejects everything.

| Attempt | Result |
|---|---|
| An ordinary session day; a holiday with both session columns `NULL`; a half day with per-group notes | **all three commit** |
| A holiday carrying a session | `trading_calendar_holiday_has_no_session` |
| A non-holiday with no session | `trading_calendar_holiday_has_no_session` |
| An open with no close | `trading_calendar_session_ordered` |
| A close with no open (the counterfactual's row) | `trading_calendar_session_ordered` |
| `session_close_at <= session_open_at` | `trading_calendar_session_ordered` |
| A duplicate `trading_day` | `trading_calendar_pkey` |
| A holiday that is also a half day | `trading_calendar_holiday_not_half_day`, `0004`'s constraint still armed |
| A half day with no notes, and a half day whose notes are whitespace | `trading_calendar_half_day_records_group_closes`, both |
| A correction to a day nothing depends on; a correction to a day with 41 dependents naming an incident | **both commit** |
| `{}` as the prior image, and a prior image missing `session_close_at` | `trading_calendar_revisions_prior_row_is_a_row`, both |
| Dependents with no incident named, and dependents with a blank one | `trading_calendar_revisions_incident_named_when_dependent`, both |
| A blank actor; a blank reason; a digest that is not SHA-256; a negative dependent count | the four named constraints, each |
| A revision for a day the calendar does not carry | `trading_calendar_revisions_trading_day_fkey` |
| A load | **commits** |
| Coverage that ends before it starts | `trading_calendar_loads_coverage_ordered` |
| The same source loaded twice at the same digest | `trading_calendar_loads_source_digest_uq` |
| A blank source id; a load digest that is not SHA-256 | the two named constraints |
| `merit_app` UPDATEs or DELETEs a revision or a load, four ways | **`permission denied`**, all four |
| `merit_app` INSERTs and SELECTs a load; `merit_app` UPDATEs `trading_calendar` itself | **both commit.** The revoke is narrow and the calendar stays mutable |

**Two of those rows were written expecting the wrong constraint and the schema corrected the expectation, not the other way round.** "An open with no close" was expected to fail on `trading_calendar_holiday_has_no_session` and fails on `trading_calendar_session_ordered`, which is right: `is_holiday = false` and `session_open_at IS NOT NULL` satisfies the first, and the pairing in the second is the only thing that rejects it. "A holiday that is also a half day" first failed on the new notes constraint because the test row had no notes, and names `0004`'s constraint once the notes are supplied. **Checking by message is what made both visible**; an exception-class check would have scored both green and proven nothing about which constraint is load-bearing.

**These perturbations are not yet a committed probe file.** `scripts/db/probe_trading_calendar.sql` is S-E4's deliverable, beside the loader it exists to test ([P1 S-E](../../docs/plans/P1-SE-trading-calendar.md) sections 7.2 and 11). This section records what was run; **a run that is recorded and not wired is exactly the "ships beside a fix and never runs again" shape RIDER 2 in [`corpus.yml`](../../.github/workflows/corpus.yml) was added to end**, and it is stated here so that S-E4 is what closes it rather than a later reader assuming it already is.

### What `0032` does not do

**No loader, no source file, no rows, no probe file, no `CI-06m`, no lint rule.** Those are S-E3, S-E4 and S-E5 under [ADR-003](../../docs/decisions/ADR-003.md)'s strict regime, one objective per session. `trading_calendar` still holds **zero rows**, so every `ADD CONSTRAINT` above validated against an empty table and none of them is evidence that any row satisfies it.

**And `0029` to `0031` are untouched.** They are FOLD-01's and FOLD-02's reservations and this session does not write them.

---

## 15. `OI-07` and `OI-08` close, and the guards are watched failing (2026-08-16)

**No migration. Two gate files and three workflow steps**, and both open items were the same defect wearing different clothes: an assertion that had been run once and could not run again, and an assertion that ran every time and could not see what it was for.

| File | What it is |
|---|---|
| [`scripts/db/probe_phone_identity.sql`](../../scripts/db/probe_phone_identity.sql) | Section 14's forty-eight assertions, committed and wired into CI-06h. `OI-07` |
| [`scripts/db/assert_no_floats.sql`](../../scripts/db/assert_no_floats.sql) | Section 9's exemption list, asserted over the **whole applied schema** instead of a prefix of it. `OI-08` |

### `OI-08` was worse than the row that recorded it

The row was written against `0028` and `0029`. **By the time it was fixed the blind spot ran from `0028` to `0032`: five migrations, 155 columns, outside the guard the corpus believed protected every money column.** It grew because nothing about it was visible. A positional assertion does not fail when it goes blind; it keeps passing, faster, against less.

The set is **still exactly `correlation_groups.statistic` and `.threshold`** on all 32 files, so nothing was hiding in the gap. That is luck rather than a control, and it is the reason this closes as a gate and not as a query.

**`0027`'s `DO` block is deliberately left in place.** Migrations are sacred: once merged, never edited, only superseded (constitution E2). It still passes and it is now a dated historical assertion about the schema as it stood at `0027`. The install job carries the live one, where it is positionally last **by construction**: a migration numbered `0099` is inside it on the day it is written, with nobody having to move anything.

### The probe leads with the success case, and on `0029` the ruling IS a permission

`0028`'s lesson, and this is the migration where it pays. Every probe in section 10 attempted a forbidden thing, so **every one of them would pass against a guard that rejects everything.** `0029`'s central ruling cannot be tested that way at all, because it is something the database must **not** do.

| Assertion | Why it is the load-bearing one |
|---|---|
| **`S2` a second identity verifies a number already live on the first** | **Must COMPLETE.** ADR-039 splits the hard link and leaves phone -> identity unconstrained. A reader who "completes the pair" with a unique index on `phone_hash` refuses the innocent owner of a recycled number at the door, before the portability check that exists to rescue them can run |
| `S2b` the live-number read sees both holders | Completing is half of it. The severity-5 flag is application logic, so what the database owes is that the collision is **detectable**. A schema that permitted the insert and could not see the collision would satisfy `S2` and leave the flag with no input |
| **`A1` `phone_hash` carries no unique index** | The absence asserted **as an absence**. Nothing in `0029` says "no unique index here", so nothing in a diff shows one being added, and adding one reads as tightening a constraint |
| **`A2` `otp_send_budget.state` is exactly three values** | An omission and a ruling look identical in a `CHECK` list. There is no stopping state because a breaker that stops is a denial of service on customer acquisition, and `A2` is what tells the ruling apart from an oversight |

**Rejections are checked by the constraint that fired**, read from `GET STACKED DIAGNOSTICS`, not by exception class and not by exit status. A write refused by the **wrong** constraint fails this probe. Twenty-five hand-rolled handlers would have been twenty-five chances to write `WHEN others THEN RAISE NOTICE 'rejected'`, which is ADR-035's defect with the lesson already written down, so the comparison is mechanical and lives in one helper.

### Both files were watched failing, which is the part section 13 says is not optional

A gate nobody has watched fail is not a gate ([STRATEGY](../../docs/testing/STRATEGY.md) section 4.4). Seeded against a clone of the installed schema:

| Seeded change | Result |
|---|---|
| A unique index on `identity_phones (phone_hash)` where live, the "complete the pair" edit | **`S2` fails**: `this MUST be permitted and the database refused it` |
| A unique index on `phone_hash` that `S2`'s fixtures do **not** collide with | **`A1` fails.** `S2` alone passes it, which is why the absence is asserted separately |
| `'paused'` added to `otp_send_budget_state_check` | **`R16` fails**: `the write was ACCEPTED` |
| `identity_phones_one_ending` renamed | **`R3` fails**: `refused by "identity_phones_endings_v2" instead`. A wrong-reason rejection is not a pass |
| A `numeric` column on `payout_requests` | **NO-FLOATS fires**, unlisted direction |
| `correlation_groups.threshold` dropped | **NO-FLOATS fires**, stale-entry direction |

`assert_no_floats.sql` carries the last two **inside itself**, one seeded violation per direction, each rolled back by the handler that catches it and the guard re-run afterwards to prove the seeds did not leak. An assertion only ever run against a schema that satisfies it reports PASS in exactly the same way as one narrowed until it reads nothing.

### The steps are pinned, because that is what "closed" has to mean

**[CI-06h](../../scripts/corpus/gates.mjs) now requires all four probe filenames plus `assert_no_floats.sql` to appear in the workflow.** Deleting a step is a gate failure rather than a silent regression. Verified by deleting each and watching CI-06h report it. **A fifth probe joined the list in section 17**, and this sentence is left saying four because it is what was true when it was written; the list itself is the count.

**`probe_payout_hold.sql` was never pinned**, from the day it landed on 2026-08-16 until this session. It was one delete from being `OI-07` again, and it is pinned now with the other two. **The probe file existing was never the fix; the file being unable to stop running is.**

### The install job's own comment had drifted, twice, in one day

The header of [`corpus.yml`](../../.github/workflows/corpus.yml) declared that object counts are not repeated there **and then repeated them one sentence later** ("30 files and 97 / 331 / 351 / 6"). `0032` landed the same day and made all four wrong. **A count in a comment was found wrong twice in one file on one day**, the second time inside the comment documenting the first. The figures are gone rather than corrected; the job derives them on every run and this file records them dated.

**The live figures on the whole set**, derived from the database rather than from a grep: **<!--gen:sql_tables-->118<!--/gen--> tables, 351 indexes, 397 check constraints, <!--gen:sql_triggers-->29<!--/gen--> triggers**, across <!--gen:migration_files-->69<!--/gen--> files. **The words "the full 32-file set" are gone from this sentence and the span beside them is not**, which is the same one-adjective correction section 12 records: the number is derived and the adjective was not, so `0033` landing would have made the sentence disagree with its own span. **The index and check figures are hand-maintained and were unmoved by `0033`**, which is luck rather than a control and is why section 17 re-derives all four.

---

## 16. Allocation: `OI-nn` identifiers and section numbers

**This file is the fourth numbered registry in the repository and it was the last one with no table. It collided twice in one day.** [ADR-034](../../docs/decisions/ADR-034.md) rules the allocation for every registry: **a number is claimed in a table before the artifact is written**, because two branches forking from one `main` both read the maximum, both take the next value, and neither is wrong locally. [ALLOCATION](../../docs/decisions/ALLOCATION.md) carries the other three, and the argument for the third one there was that three folds were claiming `CI-06` letters from an unregistered namespace in one week. **The argument here is stronger, because this namespace has already collided rather than nearly collided.**

**It lives in this file rather than in `ALLOCATION.md`, and that is a decision rather than a default.** `OI-nn` and the section numbers are **this document's own namespace**, and both collisions happened between sessions that were editing **this document** and no other. A claim a writer cannot see while writing is a claim that does not bind. It also cannot join the other three mechanically: `allocated()` in [`gates.mjs`](../../scripts/corpus/gates.mjs) parses a three or four digit first cell, `OI-06` does not parse, and a fourth table in that file that the shared parser silently skips is exactly the reserved-by-prose hazard that parser was hardened against.

### The two collisions this table exists to end

| Collision | What happened |
|---|---|
| **Two rows numbered `OI-06`** | The payout-destination cooling window's missing storage ([FOLD-01](../../docs/plans/FOLD-01-phone-identity.md) finding 5, landed with `0029`) and the `trading_calendar` prior-image trigger (landed with `0032`). **Both were written on 2026-08-16 by different sessions**, each reading section 8, each finding `OI-05` as the maximum in the table it could see, each taking `06`. The second row was appended **outside the table** and rendered as a stray one-row table, which is how it survived a reading |
| **Three sections numbered `14`** | `0029`'s record, `0030` and `0031`'s record, and `0032`'s record. **Same day, same cause, three ways.** The file also carries a `4a`, which is the precedent for adding a section **without taking a number**, and is the alternative nobody reached for because nobody knew what the maximum was |

**Neither is renumbered, and that is a ruling rather than an omission.** Both `OI-06`s are cited from module plans, [STATE](../../docs/STATE.md), a migration header and a session log; renumbering either breaks every citation of whichever one moves, and choosing which one moves is a decision about two open findings that has nothing to do with the defect. **The collision is left in place and the table allocates forward.**

**So `OI-06` is cited with its subject attached**: `OI-06 (payout destinations)` and `OI-06 (calendar prior image)`. Two rows sharing an identifier is a defect; two rows sharing an identifier with no way to say which one you mean is a worse one, and it costs three words to close.

### `OI-nn`

> **SUPERSEDED AS AN ALLOCATOR, 2026-08-23, session 141.** **`OI` numbers are claimed in
> [ALLOCATION](../../docs/decisions/ALLOCATION.md)**, which gained the fourth table
> [ADR-074](../../docs/decisions/ADR-074.md) section 7 ruled. **This table allocates nothing.
> Do not read it for the maximum and do not add a row to it to take a number**, which is
> exactly what [session 120](../../docs/sessions/2026-08-21-session-120.md) did: it found
> `OI-24` here, took `OI-25`, and `OI-25` was already held by
> [WAVE-04 section 6](../../docs/plans/WAVE-04-fixture-backlog-and-gate-inventory.md). That
> near-miss is `OI-27`, and this pointer is its repair.
>
> **The rows below stay, as the record of the items THIS MANIFEST opened.** They are the only
> copy of several findings, and deleting a row to move a number is how a register loses the
> thing it was registering. **ALLOCATION carries the number and this table carries the
> finding**, which is [ADR-074](../../docs/decisions/ADR-074.md) section 7's own distinction
> and the reason the ten members that were never the manifest's namespace are not filed here
> to satisfy a gate.

**The next free number is read from [ALLOCATION](../../docs/decisions/ALLOCATION.md), never from this table.**

| `OI-nn` | Claimed by | State |
|---|---|---|
| `OI-01` | the schema-delta fold | **allocated.** `liability_snapshots`' two shapes. Open, founder ruling |
| `OI-02` | the schema-delta fold | **allocated.** `published_statistics` and the missing measure. Closed by [ADR-032](../../docs/decisions/ADR-032.md) |
| `OI-03` | the schema-delta fold | **allocated.** `0026`'s append-only revoke list against DATA_MODEL. Open |
| `OI-04` | the schema-delta fold | **allocated.** Two legitimate updates on append-only tables. Open |
| `OI-05` | the schema-delta fold | **allocated.** The plan-version immutability defect. Closed by [ADR-035](../../docs/decisions/ADR-035.md) and `0028` |
| **`OI-06`** | **CLAIMED TWICE, 2026-08-16, and left that way.** FOLD-01's session and S-E's session | **allocated twice.** `OI-06 (payout destinations)` is **open**; `OI-06 (calendar prior image)` is **closed** by [ADR-045](../../docs/decisions/ADR-045.md) and `0033` |
| `OI-07` | FOLD-01 session 3 | **allocated.** `0029` had no committed probe. Closed 2026-08-16 |
| `OI-08` | FOLD-01 session 3 | **allocated.** The positional NO-FLOATS block. Closed 2026-08-16 |
| **`OI-09`** | this session | **allocated.** `CI-06n` accepts a link in prose where its own title says a row. Open, and section 17 records how it was found |
| `OI-10` | the review desk, 2026-08-16 | **allocated.** Keep-both merges duplicated four passages in STATE and no gate could see it. Deduplicated; the gate that would catch it is unwritten. **This row was missing from this table**, claimed in [STATE](../../docs/STATE.md) and never brought back here, which is the drift the table exists to end |
| **`OI-11`** | `0035`'s session | **allocated, open.** **A duplicate row in an allocation table is invisible to every gate.** `allocated()` accumulates claims into a `Set`, so the two adjacent rows both claiming `0034` produced one member and twelve gates passed. The check is cheap and blocked on a cleanup: the ADR table claims `039` to `046` twice each and the migration table claims `0033` twice, so it fails on arrival. See [ALLOCATION](../../docs/decisions/ALLOCATION.md) |
| **`OI-12`** | `0035`'s session | **allocated, open.** **A calendar `INSERT` moves no watermark.** `0033` guards every way a day can change; a day backfilled inside an existing coverage window changes the day sequence retroactively with no revision row, and every stamped `rule_states` row still claims a watermark that looks current. ADR-045 owns `trading_calendar`'s guards and ADR-047 does not rule it |
| **`OI-13`** | `0035`'s session | **allocated, open.** **B.4 step 4's audited rewrite has no grant.** `0026` revoked `UPDATE` on `rule_states` from `merit_app` and `PUBLIC` and no `SECURITY DEFINER` function performs it. Pre-existing and identical for `engine_version`; `calendar_revision_id` makes a second caller for a path that has none |
| **`OI-15`** | `0043`'s session | **CLOSED 2026-08-27 by [session 246](../../docs/sessions/2026-08-27-session-246.md), and the class under it is now a runnable check.** The record carries the two columns, the `CHECK` and the fourth index, read from the migration. **[`data-model-columns.mjs`](../../scripts/corpus/data-model-columns.mjs) is the reconciliation this row said no gate could do** ([ADR-134](../../docs/decisions/ADR-134.md)); it is landed and **deliberately unregistered**, because it found three SIBLING records missing a column each and all three were outside that session's fence. **Originally: allocated, open.** **[The `admin_actions` design record](../../docs/architecture/data-model/admin_actions.md) does not carry `SD-M6-11`'s two columns, its `CHECK` or its fourth index.** The migration is the truth and the record trails it by one session, which is `OI-01`'s shape on a smaller surface. **No gate sees this**: `CI-06i` reconciles the TABLE set in both directions and nothing in the runner reconciles COLUMNS, so a design record can contradict its own DDL indefinitely and every gate passes. Recorded here rather than left as prose because `docs/architecture/data-model/` was not in the writing session's fence and four sibling sessions were in flight against `M06` |
| **`OI-14`** | `0035`'s session | **allocated. CLOSED 2026-08-27 by [session 241](../../docs/sessions/2026-08-27-session-241.md), on an EXECUTED refusal rather than on a diff.** **The replay job must refuse an empty in-scope set.** If the engine never populates `calendar_revision_id`, every row reads as out of scope after the first correction, the audit compares nothing, and an audit that has stopped looking reports exactly like one that found nothing (FM-17). No per-row constraint can tell "not yet written" from "pristine calendar" without fabricating, so it belongs to the job. **The job is [`runReplayAudit`](../../apps/worker/src/batch/replay.ts) and it throws `ReplayAuditRefusal` on `report.storedRows > 0 && report.inScope === 0`**, asserted by `it('REFUSES a run that compared nothing while rows exist (OI-14)')` in [`replay.test.ts`](../../apps/worker/test/replay.test.ts), which pins the MESSAGE and not only the class because three guards throw that class. **The guard was FALSIFIED before the row was closed**: neutered alone it turns that case red and leaves the empty-book case green, and neutering the empty-book guard instead swaps the two. **It was NOT [#315](https://github.com/lam2-coder/meritfutures/pull/315) that satisfied this row and the dispatch that closed it said otherwise.** #315 and [ADR-123](../../docs/decisions/ADR-123.md) added the `accountsAudited === 0` guard, which is ADR-073 section 5's EMPTY BOOK and a different failure; this row's guard predates it and ADR-123 section 4 says in its own words that it does not close this row. **A third scale escapes both guards and is not this row's**: an account named by `accountsWithStoredState()` with no rows and no days returns a clean report, pinned as a hole in the same file and owed a ruling against ADR-123 section 7 |
| **`OI-24`** | `ADR-068`'s session, [FOLD-04](../../docs/plans/FOLD-04-impersonation-and-admin-parity.md) `I2` | **allocated, open, and DELIBERATELY NOT REPAIRED.** [M06](../../docs/plans/M06-admin-ops-console.md) section 2 opens *"Six deltas, each from a failure mode below"* and the table now carries **seven**. **Session 89 already corrected this line once**, from *"Five deltas"*, and `SD-M6-10` makes it wrong again three sessions later. **Four concurrent sessions are each about to move it**, which is the proof that the count cannot be hand-maintained rather than an argument that it can be maintained harder. **The remedy is named and is [ADR-034](../../docs/decisions/ADR-034.md)'s own**: the count becomes a `<!--gen:-->` span under `CI-06g`, computed from the delta table it describes, and then no session touches it again. **Not implemented here**: [`gates.mjs`](../../scripts/corpus/gates.mjs) is held by three concurrent sessions and this one already carries four forced fence extensions. **For the review desk.** |
| **`OI-27`** | session 120, `0045` | **allocated, open, and it is a LIVE INSTANCE of the thing [ADR-074](../../docs/decisions/ADR-074.md) is about.** This session read the `OI` table in THIS FILE, which stops at `OI-24`, and allocated `OI-25`. **`OI-25` and `OI-26` were already taken**: allocated in [WAVE-04 section 6](../../docs/plans/WAVE-04-fixture-backlog-and-gate-inventory.md) and recorded in [STATE](../../docs/STATE.md), which is **one identifier series with two definition sites** and neither one names the other. The near-miss is worth more than the renumber: `CI-06/identifier-series` is being written against `ADR-074` in a sibling session as this lands, and **this is exactly the collision it would have caught**, found by a founder read rather than by a gate. Renumbered to `OI-27`. **Second finding, same cause, and DELIBERATELY NOT REPAIRED**: `## 21.` is claimed TWICE in this file, at the `0038` section and again at the `0042` section, and the section-number table in section 16 carries **both** rows. `22` remains the maximum, so section `23` below is correctly numbered. **The table that exists to end section-number drift is carrying the drift.** It belongs to [FOLD-04](../../docs/plans/FOLD-04-impersonation-and-admin-parity.md) `I2`, is outside this session's fence, and a money-path session does not repair another session's numbering **CLOSED 2026-08-23 by [session 141](../../docs/sessions/2026-08-23-session-141.md)**: `OI` is allocated in [ALLOCATION](../../docs/decisions/ALLOCATION.md) and this table points at it. **Two more double claims were found while building that table and neither had ever been counted**: sessions 105 and 106 each took `OI-19` and `OI-20` on 2026-08-20, and WAVE-04 renumbered session 106's pair to `OI-25` and `OI-26` while [STATE](../../docs/STATE.md), being append-only, still carries the old numbers |
| **`OI-28`** | session 120, `0045` | **allocated. CLOSED 2026-08-23 by [ADR-082](../../docs/decisions/ADR-082.md), and amended in place here on 2026-08-27 rather than joined by a second row** ([ADR-065](../../docs/decisions/ADR-065.md) T3). **The ADR this row said was owed was WRITTEN, and it widened the third token's DEFINITION instead of the token list**: `rail clock` reads *"a third party's own clock, quoted and never computed by Merit: a payment rail's, a calibration vendor's, any counterparty whose day Merit reads and never derives"*, `UNIT_TOKENS` still holds exactly three members, and the same `date` columns resolved to the same tokens before and after, so nothing was re-classified. **A fourth token was refused on a structural argument and the refusal is a control**: `CI-06m/widened-definition-is-not-a-fourth-token` in [`falsify.mjs`](../../scripts/corpus/falsify.mjs) seeds `**Unit: vendor clock**` onto a row declaring `rail clock` and watches the gate refuse it. **`simulation_runs.calibration_observed_at` was correctly declared on the day it landed** and the design record now cites the ruling. ADR-082 named this exact row as the amendment it could not reach; [session 267](../../docs/sessions/2026-08-27-session-267.md) is the session that held the file, and it arrived only because a dispatch re-read the stale row as live work ([ADR-156](../../docs/decisions/ADR-156.md) section 2). **Originally:**  `simulation_runs.calibration_observed_at` is a `date`, so `CI-06m` requires it to declare one of exactly three closed unit tokens, and **none of the three names what this column is**. `wall clock` is refuted by its own definition, *"Merit's own clock, answered only by `now()`"*: this column is never `now()`, and writing `now()` into it is precisely the defect it exists to prevent. `trading day` is *"answered only by TradingCalendar"* and a calibration vendor does not observe on the exchange session boundary. `rail clock` is **declared**, because its operative half, *"quoted and never computed by Merit"*, is exactly true and [`affiliate_commissions.chargeback_window_ends_on`](../../docs/architecture/data-model/affiliate_commissions.md) already carries it for the same reason. **The noun is still wrong: a calibration vendor is not a rail.** Widening `UNIT_TOKENS` amends [ADR-042](../../docs/decisions/ADR-042.md)'s closed set and is **not** done from a money-path session, so the candidate ADR is named as owed. Argued in the open at [`simulation_runs`](../../docs/architecture/data-model/simulation_runs.md) rather than picked quietly, because picking the nearest-looking token is how three rows passed `CI-06m` by accident |
| **`OI-29`** | session 120, `0045` | **allocated, PARTLY CLOSED by [`0047`](migrations/0047_publish_decision_is_sound.sql) under [ADR-087](../../docs/decisions/ADR-087.md) (session 148), and amended in place rather than joined by a second row.** `plan_versions_publish_decision_recorded` makes the link to a simulation run EXIST and a `CHECK` cannot make it SOUND. **Two of the three states named below are now unwritable**: a publish decided on a run that is not `complete` is refused by `OI-29 check A`, and a publish decided on a run anchored to any plan version other than the row being published is refused by `OI-29 check B`, which is stronger than the state it closes because same-plan-different-version is the identical defect. **THE THIRD DOES NOT CLOSE AND IT IS RE-FILED AS `OI-29b`**: a publish decided on a run over a since-edited draft, whose `rules_digest` no longer matches. `0047` is a TRIGGER, and [`0004:183`](migrations/0004_catalog.sql)'s cost stands unhedged: it can be disabled and it fires per row. The alternative lost on a fact rather than a preference, that no application publish path exists in `apps/` at all. **RESTATED 2026-08-27 by [ADR-156](../../docs/decisions/ADR-156.md) section 5, and the restatement narrows what the two closed states are worth: BOTH ARE ASSERTED AT THE WRITE AND NOTHING PRESERVES THEM.** Both triggers fire on the publish decision and nowhere else, and the two columns they read, `simulation_runs.status` and `.plan_version_id`, carry no trigger, no `REVOKE` and no immutability guard, `merit_app` holding `UPDATE` on both. **Measured on the full migration set under `SET LOCAL ROLE merit_app`, inside a rolled-back transaction, with [`probe_publish_decision_is_sound.sql`](../../scripts/db/probe_publish_decision_is_sound.sql) run green first so the control under test was the installed one**: a publish written with both checks satisfied survives `UPDATE simulation_runs SET status = 'failed'`, survives that run going back to `queued` with `completed_at` nulled, which removes the completion time `0047`'s header reasons from, and survives the run being re-anchored to another plan's version. **The asymmetry is the mechanism**: [`0028`](migrations/0028_supersede_plan_version_immutability.sql) refuses every write to the citing row, including a column it counts as movable, while `0045` leaves the cited row free by design, so the only unpinned half of the link is the half both checks read. **The `DELETE` is refused**, by `plan_versions_decided_on_simulation_run_id_fkey`, so the citation is permanent and only the content of the thing cited is free. **No migration number is claimed and this row does not close.** The preservation condition is named in ADR-156 section 5 and left unnumbered; the naive guard is refuted by `SUCCESS 1` of the probe, whose next statement after a sound publish is the legitimate `NULL` to citing-row anchor move |
| **`OI-29b`** | session 148, `0047`, [ADR-087](../../docs/decisions/ADR-087.md) | **allocated, open, and NARROWED rather than new.** `OI-29`'s staleness state, which `0047` could not reach. **`simulation_runs.rules_digest` HAS NO PRODUCER**: `grep -rn 'rules_digest\|rulesDigest' --include='*.ts' --include='*.mjs' packages/ apps/ scripts/` returns nothing, and [ADR-081](../../docs/decisions/ADR-081.md)'s claim to have landed *"the digest half `OI-29` needs"* does not survive reading [`hash.ts:557`](../../packages/rules-engine/src/hash.ts), whose `HASHED_COLUMNS` is nineteen **`rule_states`** columns. What ADR-081 landed is a pure SHA-256 and a framing discipline, reusable and pointed at another subject. **`pgcrypto` IS installed** ([`0001:22`](migrations/0001_extensions_and_enums.sql)) so `digest(rules::text,'sha256')` runs today, and the refusal to install it is therefore a RULING: `jsonb::text` sorts keys but **is not canonical over numbers**, measured, so `{"a":1.0}` and `{"a":1}` digest differently and the comparison would REFUSE A LEGITIMATE PUBLISH. No temporal proxy exists either: `plan_versions` carries no `updated_at`. **Check B narrows what survives**: after `0047` the staleness case reaches only a run whose `plan_version_id` IS NULL, which [`0045:66`](migrations/0045_simulation_runs.sql) makes nullable on purpose. **Closing that last branch would break `SUCCESS 4` and case `0028 A` of [`probe_simulation_decision_record.sql`](../../scripts/db/probe_simulation_decision_record.sql)**, both of which assert a NULL-anchored publish WRITABLE, so it is a change to what `0045` ruled and needs its own ADR. `SUCCESS 3` of [`probe_publish_decision_is_sound.sql`](../../scripts/db/probe_publish_decision_is_sound.sql) asserts the hole so the day somebody closes it the probe says what they broke |

### Section numbers

**Claim the next free number here in the commit that writes the section.** Sections are append-only records of what landed and when, so the sequence only ever grows and the maximum is the only thing anybody needs.

| Section | Claimed by | State |
|---|---|---|
| 1 to 13 | the schema-delta fold and its follow-ons | **allocated** |
| **14** | **CLAIMED THREE TIMES, 2026-08-16, and left that way.** `0029`, then `0030` and `0031`, then `0032` | **allocated three times.** Cite as `section 14 (0029)`, `section 14 (0030 and 0031)`, `section 14 (0032)` |
| 15 | `OI-07` and `OI-08`'s closure | **allocated** |
| **16** | this session | **allocated.** This table |
| **17** | this session | **allocated.** `0033` lands |
| **18** | `0034`'s session | **allocated.** `0034` lands. **This row was written into the file as a heading and never into this table**, one section after the table was created to stop exactly that |
| **19** | `0035`'s session | **allocated.** `0035` lands |
| **21** | `0038`'s session ([ADR-067](../../docs/decisions/ADR-067.md)) | **allocated.** `0038` lands. **`20` is claimed by a heading and has no row here**, which is exactly the defect the `18` row above records happening one section after this table was created to stop it; it is left for `0036`'s session rather than filled in on its behalf, because a row written on somebody else's behalf is a claim nobody made. **`0037` has no section at all**, found in the same pass |
| **22** | session 95, the signing pass | **allocated.** Four merged migration headers go stale when their ADRs are signed. **Section 21 is claimed TWICE**, by `0038``s session and `0042``s; cite as `section 21 (0038)` and `section 21 (0042)` on this table`s standing rule |
| **23** | session 120, `0045` ([ADR-071](../../docs/decisions/ADR-071.md)) | **allocated.** `0045` lands. **`21` is claimed twice above**, by `0038`'s session and by `ADR-068`'s, so `22` is the true maximum and this is the next free number rather than the row count. `OI-27` records it |
| **20** | `0036`'s session | **allocated.** `0036` lands. **This row was written into the file as a heading and never into this table**, which is the identical omission the `18` row above records one section earlier. Added here by `0042`'s session, which is the third occurrence of the same miss and the reason `OI-24` exists |
| **21** | `ADR-068`'s session | **allocated.** `0042` lands |
| **25** | session 148, `0047` ([ADR-087](../../docs/decisions/ADR-087.md)) | **allocated.** `0047` lands. **SECTION 24 IS CLAIMED BY A HEADING AND HAS NO ROW HERE**, which is the fourth time (`18`, `20` and `24` were each written as a heading and never as a row), and it is named rather than added because `24` is session 135's to claim. **This is the first section in the file to record a repair that does NOT close the item it was written for**: `OI-29` goes to PARTLY CLOSED and `OI-29b` opens above |
| **31** | session 403, `0066` ([ADR-213](../../docs/decisions/ADR-213.md)) | **allocated.** `0066` lands. **Sections 26 and 28 to 30 are claimed by headings and have no row here**, and `27` has no section at all, which is the same omission the `18`, `20` and `24` rows above each record. They are NAMED and not filled in on their authors' behalf, on this table's standing rule that a row written for somebody else is a claim nobody made. **30 is the true maximum, so 31 is the next free number rather than the row count.** |

**`4a` is a section and not a number**, inserted between 4 and 5 to record FOLD-01's deltas without disturbing what cites 5. It is the escape hatch when a section belongs in the middle, and it is recorded here so the next session finds it before inventing a second one.

**It has been used twice more and neither use took a row above, which is stated rather than repaired.** `4b` records FOLD-03's single delta and `4c` records FOLD-04's. **A lettered section deliberately claims no number**, so the sequence this table allocates is undisturbed by either, and adding rows for them would make the table's own key ambiguous between a number and a name. **The sentence above is the allocation**: a fold that adds a delta section appends the next letter after `4c` and does not enter it here.

### What no gate checks, stated rather than implied

**Nothing reads this table.** `CI-06f` and `CI-06h` parse `ALLOCATION.md`'s first two tables and nothing parses this file's structure at all; the `manifest_changes` span counts delta rows and cannot see a section heading. The table binds a reader today, which is the position the `CI-06` letter table shipped in and is stated the same way here.

**The cheap version of the gate is the one to write, and it is two assertions**: every `## <n>.` heading in this file is unique and gapless, and every `OI-nn` appearing anywhere in `docs/` or `packages/` has exactly one row above. That is `ADR-026`'s manifest-completeness check with a different identifier prefix, and it would have caught both collisions on the day they were written. **It is not written here**, because a gate arrives with a seeded violation it has been watched failing on, and this session's stop condition is `0033`.

---

## 17. `0033` lands, and the counted half was proven by watching a zero pass without it (2026-08-16)

**[`0033_trading_calendar_revision_required.sql`](migrations/0033_trading_calendar_revision_required.sql), with its `E2 READ: MONEY PATH` header and the founder's read still to come.** [ADR-045](../../docs/decisions/ADR-045.md) closes `OI-06 (calendar prior image)`: [ADR-042](../../docs/decisions/ADR-042.md) F-2 ruled the prior-image **table** and ruled nothing about what obliges anybody to write to it, so F-2 landed as a table nobody was required to use. **It edits nothing.** `0004`, `0027` and `0032` are untouched on disk, and `0029` to `0032` are other folds' files.

**It asserts and it does not write, which is `0027`'s idiom rather than a preference.** Not one guard in `0027` repairs anything. A trigger that wrote the prior image itself would have to invent an `actor` and a `reason`, and a reason nobody gave is precisely what `trading_calendar_revisions.reason` exists to refuse.

| Guard | What it refuses |
|---|---|
| **`CALENDAR-C1`** | An `UPDATE` that commits with no `trading_calendar_revisions` row carrying **that row's** prior image, `to_jsonb(OLD)`, compared as `jsonb` |
| **`CALENDAR-C1`, counted half** | A prior image whose `dependent_row_count` is not the number **the database itself counts** across `fills`, `daily_marks` and `rule_states` |
| **`CALENDAR-C2`** | A `DELETE` from `trading_calendar`, and a `TRUNCATE` of it |

### Install verification, from empty

**All <!--gen:migration_files-->69<!--/gen--> files apply forward-only from empty against PostgreSQL 16.13 with `ON_ERROR_STOP`, zero errors**, and the counts are read from `pg_tables`, `pg_indexes`, `pg_constraint` and `pg_trigger` rather than from a grep:

| | Before `0033` | After `0033` |
|---|---|---|
| Tables | 102 | **102** |
| Indexes | 351 | **351** |
| Check constraints | 397 | **397** |
| Triggers | 6 | **9** |

**Three of the four figures do not move, and that is the shape of the change.** `0033` creates no table, no index and no constraint. It adds two functions and three triggers to a schema that already had every column it needs, which is what a control that was **missing** rather than **wrong** looks like in a diff.

### The probe, and why it forces a check that would otherwise never run

[`scripts/db/probe_calendar_revision_required.sql`](../../scripts/db/probe_calendar_revision_required.sql), **12 assertions, 12 / 12, and the first four are successes** on section 13's lesson: a probe that only ever attempts forbidden things passes against a guard that rejects everything.

**`CALENDAR-C1` is `DEFERRABLE INITIALLY DEFERRED` and the probe ends in `ROLLBACK`, so a success case left to fire "at commit" would be checked by nothing at all.** The file would print four green successes having verified none of them. `SET CONSTRAINTS ... IMMEDIATE` applies the pending checks retroactively, and every assertion in the file runs because of it. **This is the vacuous-pass shape a third time**: it has now been found in a `CHECK` that evaluated to `NULL` ([ADR-035](../../docs/decisions/ADR-035.md)), in a `DO` block that read a prefix of the schema (`OI-08`), and in a `falsify.mjs` seed that inserted a duplicate row.

| # | Assertion | What it proves |
|---|---|---|
| **S1** | An `INSERT` of a calendar day needs no image | A guard demanding an image for a day that did not exist would refuse the first load of the calendar |
| **S2** | A correction carrying its image commits, image written **first** | F-2's own machinery is still usable |
| **S3** | The image may be written **after** the update | What the deferral buys. A non-deferred trigger would refuse this and say nothing about why |
| **S4** | A day with three dependents, counted, naming an incident | The **incident path working** rather than being refused |
| **R1** | No image at all | `OI-06` in one statement |
| **R2** | An image of a state that never was | A row exists, so a reviewer counting rows sees one |
| **R3** | An image assembled by hand with the four required keys | The image is `to_jsonb(OLD)` or it is a hand-written column list wearing a JSON costume |
| **R4** | A correct image claiming `dependent_row_count = 0` on a day with three | **The bypass the counted half exists to close** |
| **R5** | Two corrections in one transaction, one image | A per-transaction check would lose an intermediate state from the replay record |
| **R6** | An update that changes nothing | There is no exempt column and no exempt update |
| **R7** | `DELETE` | `CALENDAR-C1`'s bypass is otherwise one extra statement |
| **R8** | `TRUNCATE trading_calendar, trading_calendar_revisions` | **The form that defeats the foreign key.** `TRUNCATE trading_calendar` alone fails on the revisions foreign key, and a probe that stopped there would be testing PostgreSQL rather than this migration |

**Rejections are checked by message, never by exception class.** Both halves of `CALENDAR-C1` raise `check_violation`, so a handler catching the class cannot tell "no prior image" from "the count is wrong", and the counted half could be deleted with every rejection still passing. That is not a hypothetical: it is exactly what the seeded run below did.

### Four counterfactuals, each watched failing on its own finding

| Seeded schema | Result |
|---|---|
| `0033` absent entirely | **`ERROR: constraint "trading_calendar_revision_required" does not exist`**, on the first success case. The probe cannot pass vacuously against a schema with no guard in it |
| The **counted half** removed, everything else intact | **`R4` reports `PROBE FAILED: a day with 3 dependent rows was corrected claiming 0`.** Every other assertion still passes, which is what makes this the assertion that owns that half |
| `CALENDAR-C2`'s two triggers dropped | **`R7` reports `PROBE FAILED: a calendar day was deleted`** |
| A guard that **refuses everything** | **`S2` fails.** The positive control catching the failure mode an inventory of refusals cannot see from inside itself |

### What `0033` does not do

**It does not add an index on `rule_states (trading_day)`**, and the count query therefore scans that table. `rule_states` is written once per account per day by the engine, so an index serving a query that runs only on a calendar **correction** would be paid for on every mark of every account forever. It is a trade and it is written down rather than discovered.

**It does not count `reconciliations` or `ingest_files`**, both of which carry a `trading_day`. [P1 S-E section 4](../../docs/plans/P1-SE-trading-calendar.md)'s partition names three tables; widening it is a founder's call rather than a migration's.

**It does not touch `OI-06 (payout destinations)`**, which is the other row with this number and is still open and still undecided.

### `OI-09`, found while wiring this session's own registry row

**[ADR-043](../../docs/decisions/ADR-043.md)'s own ADR has no row in the ADR registry table.** It is linked from a sentence in the README's preamble, and `CI-06n` accepted that: the gate matches **any markdown link anywhere in the README**, while its title says "every registry entry has a README **row**". Its `covers` line is honest and says "is linked from", so the implementation matches its stated coverage and the title overstates it, which is how nobody noticed that a merged ADR had fallen out of the registry it belongs to.

**The row is added here. The gate is not narrowed here**, because a gate arrives with a seeded violation it has been watched failing on, and narrowing this one needs a sweep of every registry directory the split created rather than a one-line regex. Carried as `OI-09`.

---

## 18. `0034` lands, and the REVOKE that was called decoration turned out to be a control (2026-08-16)

**[`0034_reversible_contact_addresses.sql`](migrations/0034_reversible_contact_addresses.sql), with its `E2 READ: MONEY PATH` header and the founder's read still to come.** [ADR-046](../../docs/decisions/ADR-046.md) closes `OQ-M10-06`: `INV-M16-03`'s prior-contact notification, [SECURITY section 4.8](../../docs/architecture/SECURITY.md) leg 2 and every security-class message Merit itself initiates had **no address to send to**, in any of the thirty-three migrations before this one. **It edits nothing.** `0018`, `0019`, `0026` and `0029` are untouched on disk; this file changes what they installed, which is `0028`'s precedent applied a fourth time.

**No numbered delta lands here.** ADR-046 is a ruling on an open question rather than a module's schema delta, so [ADR-026](../../docs/decisions/ADR-026.md)'s manifest completeness gate has nothing to count. `0033`'s precedent, and this section is the record instead.

| Change | What it is |
|---|---|
| Three sealed columns, three times | `*_ciphertext`, `*_key_id`, `*_encrypted_at` on `contact_channels`, `identity_phones` and `phone_change_requests`, each with a completeness `CHECK`, a **plaintext floor** and a partial index serving the rotation sweep |
| The plaintext floor | `octet_length(<col>) >= 29` when the column is not null, three times. **`INV-M10-12` as a constraint rather than as a promise**, and the founder's second amendment |
| `merit_dispatcher` | The fourth role. `0026` created three and none of them is a sending path, and **you cannot withhold `DELETE` from a principal the database cannot name** |
| The evidence foreign keys | `prior_notified_at` may not be set without citing an `integration_dispatches` row **and** a `notifications` row, both `ON DELETE RESTRICT`, both **explicitly named** |
| The identity-match trigger | Both cited rows belong to the same identity as the request. Separately rejectable |

### Install verification, from empty

**All <!--gen:migration_files-->69<!--/gen--> files apply forward-only from empty against PostgreSQL 16.13 with `ON_ERROR_STOP`, zero errors**, and the counts are read from the catalogue rather than from a grep:

| | Before `0034` | After `0034` |
|---|---|---|
| Tables | 102 | **102** |
| Indexes | 351 | **354** |
| Check constraints | 397 | **404** |
| Foreign keys | 141 | **143** |
| Triggers | 9 | **10** |

**No table moves, and that is the shape of the change.** `OQ-M10-06` is not a missing entity. It is three tables that each held a value they could recognise and not use, so the fix is columns beside the columns that were already right, plus the one thing a column cannot be: a role.

### The probe

[`scripts/db/probe_reversible_contact_addresses.sql`](../../scripts/db/probe_reversible_contact_addresses.sql), **37 assertions, 37 / 37**, wired into `corpus.yml` as step 10 **and pinned by `CI-06h`**. Fifteen are successes, on section 13's lesson: a probe that only attempts forbidden things passes perfectly against a guard that refuses everything.

**It was wired and not pinned, which is `OI-07` a third time**, and this one was caught before the merge rather than a day after it. See the subsection below.

**Half of what it proves is a grant, which no other probe in this job touches.** A migration that grants `DELETE` by accident installs cleanly, satisfies every constraint in the file, and is wrong in the exact way the founder's amendment exists to prevent. So six assertions `SET LOCAL ROLE merit_dispatcher` and attempt the write: **a catalogue query proves what was written and an attempted write proves what the database will do.**

| # | Assertion | What it proves |
|---|---|---|
| **H0** | The two boundary fixtures really are 29 and 28 bytes | Six assertions below read them for their byte counts. A `sealed_minimum()` of 30 would report the floor correct **at 29 and at 30**, passing either way and proving neither: the vacuous-pass shape, pre-empted |
| **S1** | A contact channel with **no ciphertext at all** | Every row written before `0034`. A `NOT NULL` would have refused them and forced a backfill to invent ciphertext for addresses nobody has |
| **S2** | A sealed address beside its hash | The shape `OQ-M10-06` asked for |
| **S2b** | **Exactly 29 bytes is permitted** | The off-by-one guard. `> 29` or `>= 30` refuses the smallest legal envelope and **every rejection in the file still passes**: an error in the STRICT direction is invisible to an inventory of refusals |
| **S2c** | `identity_phones` sealed at the minimum envelope | **The success case that was missing.** Until it existed, every write this probe made to `phone_ciphertext` was one it expected to be refused, so a guard on that table refusing **everything** passed all thirty-two assertions. Found by a seeded run, not by reading |
| **S3** | Resealed under a new key id | Rotation, which is the entire reason `UPDATE` survived the amendment |
| **S5b** | `phone_change_requests` at exactly 29 bytes | The third table's permissive boundary, so all three are pinned to 29 rather than one of them to "somewhere above a telephone number" |
| **S4** | **Erasure: the three columns clear and the row stays** | **The assertion the amendment rests on.** Withholding `DELETE` is defensible only if erasure is expressible without it |
| **S4b** | The `value_hash` survived the erasure | An erasure that took the hash would disarm `INV-M16-03` **through the privacy path**, which is the trade this design refuses |
| **S5pre** | The change request opens with a sealed new number | See the counterfactuals: this was a bare fixture `INSERT` until a seeded run showed why it must be a labelled one |
| **S5a** | Evidence cited with **no** `prior_notified_at` yet | Why the `CHECK` is one-directional. The two legs do not land in the same instant |
| **S5** | **The ceremony reaches `applied` with both legs evidenced** | The positive control. A tightening that refuses the legitimate path is worse than the gap it closed |
| **S6, S7, S8** | `merit_dispatcher` reads a sealed address, rotates it, records a dispatch | `SELECT`, `UPDATE`, `INSERT`: the three verbs the amendment keeps |
| **R1, R2** | Ciphertext with no key id; a key id of whitespace | An unopenable blob every rotation sweep skips and every reader believes is an address. The blank case is `trading_calendar_revisions.reason`'s argument: an empty string satisfies `NOT NULL` and answers nothing |
| **R3, R4** | The same `CHECK` on the other two tables | A constraint written three times can be omitted once, and the omission is one missing paragraph in a five-hundred-line file |
| **R2b, R3a, R4a** | **A plaintext E.164 written into each sealed column** | `INV-M10-12`, which nothing else in `0034` enforces: every one of these columns is `bytea` and every byte string is a valid `bytea`. `R3a` uses the **longest E.164 that can exist** (16 bytes, the ceiling of the whole address space), because any floor low enough to admit an E.164 at all admits that one |
| **R2a, R3b, R4b** | 28 bytes refused, on all three | A nonce and a tag **with nothing sealed between them**: the envelope of the empty string. Paired with `S2b`/`S2c`/`S5b` this pins each floor to **exactly 29**. Without them a floor of 17 through 28 passes the whole file, which a seeded run demonstrated |
| **R5** | **`prior_notified_at` claimed with no evidence** | `EC-146` in one statement. This is the write `0029` accepted |
| **R6** | Claimed on the SMS leg alone | ADR-039 (c) requires both |
| **R7, R8** | Citing another identity's dispatch; another identity's notification | Named separately because **both raise `check_violation` from one function**, so a handler catching the class could not tell them apart and either half could be deleted with the other still passing |
| **R9** | **Citing a dispatch attributed to nobody** | The `IS DISTINCT FROM` case. See below |
| **R10, R11** | Deleting a **cited** notification; a cited dispatch | The founder's note, watched rather than asserted: the retention-sweep collision, in the output of a job that runs on every push |
| **R12, R13** | `merit_dispatcher` deleting a contact channel; an identity phone | **The amendment.** The assertions that fail the day somebody widens the grant to make an erasure ticket easier |
| **R14** | `merit_dispatcher` rewriting `value_hash` | The `UPDATE` grant is **column-scoped**, so the send path cannot blank the value `INV-M16-03` matches on without deleting anything |
| **R15** | `merit_dispatcher` rewriting a dispatch record | `0026` made `integration_dispatches` append-only. The dispatcher must not become the one role that can rewrite the audit trail of what left the building |
| **R16** | `merit_dispatcher` reading `identity_signals` | `0034` grants five tables by name and adds **no** default privilege, so a table created by a later migration is invisible to the sending path until somebody grants it |

**`R9` is the assertion that would not exist if the trigger had been written the obvious way.** `integration_dispatches.identity_id` is nullable, because `0018` rules that not every dispatch is about a person. `evidence_identity <> NEW.identity_id` yields `NULL` against an unattributed dispatch, `NULL` is not `TRUE`, and **the one check that exists to attribute the evidence would wave through the least attributed row in the table.**

### Eighteen counterfactuals, each watched failing on its own finding

| Seeded schema | Result |
|---|---|
| `0034` absent entirely | **`S2` fails**: `column "value_ciphertext" of relation "contact_channels" does not exist`. Two assertions run. The probe cannot pass vacuously against a schema with none of this in it |
| The identity-match trigger dropped | **`R7` reports the write was ACCEPTED.** Thirteen assertions pass first, which is what makes `R7` the one that owns that half |
| `phone_change_requests_prior_notice_is_evidenced` dropped | **`R5` fails.** `EC-146`'s remedy, watched being absent |
| **Table-wide `UPDATE`** instead of column-scoped | **`R14` reports `merit_dispatcher rewrote value_hash`.** Twenty-four assertions pass first: every constraint is intact and the role can disarm the countermeasure anyway |
| `DELETE` granted to `merit_dispatcher` **after** the `REVOKE` | **`R12` reports `merit_dispatcher DELETED a contact channel`** |
| `<>` instead of `IS DISTINCT FROM` | **`R9` fails and nothing else does.** Fifteen assertions pass, including `R7` and `R8` |
| A `CHECK` that **refuses everything** | **`S5pre` fails.** The positive control catching what an inventory of refusals cannot see from inside itself |
| `0026`'s `ALTER DEFAULT PRIVILEGES` line copied to this role | **`R16` reports `merit_dispatcher read identity_signals`.** Thirty-six assertions pass first |
| The plaintext floor dropped from `contact_channels` | **`R2a` reports the write was ACCEPTED.** Nine pass first |
| The plaintext floor dropped from `identity_phones` | **`R3a` reports the write was ACCEPTED.** Thirteen pass first |
| The plaintext floor dropped from `phone_change_requests` | **`R4a` reports the write was ACCEPTED.** Seventeen pass first |
| The floor written `>= 30` (or `> 29`), the off-by-one **in the strict direction** | **`S2b` fails**, and on the other two tables `S2c` and `S5b` do. Every rejection in the file still passes: only a success case can see this |
| The floor written `>= 17`: above every E.164, below the envelope | **`R3b` and `R4b` report the write was ACCEPTED.** Before they existed **nothing failed and all 33 assertions passed**, which is what added them |
| A floor that **refuses everything**, per table | `S2` on `contact_channels`, **`S2c` on `identity_phones`**, `S5pre` on `phone_change_requests`. The middle one had no success case at all until this run |
| A fixture helper returning 30 bytes instead of 29 | **`H0` fails** before any assertion rests on it |

### The `REVOKE` was described as decoration, and the seeded run proved otherwise

**The ninth counterfactual is the one that changed the file.** The trailing `REVOKE DELETE ... FROM merit_dispatcher` was written with a comment calling it "a statement rather than a mechanism", on the reasoning that nothing above it grants `DELETE`, so it revokes a privilege the role does not hold and changes no catalogue row.

**Then the seed added `DELETE` to the grant list above it and the probe still passed, all twenty-seven assertions it carried at the time.** The `REVOKE` had already taken it back. **A privilege granted earlier in this file cannot survive to `COMMIT`**, which makes it a real control against the likeliest mistake: an absent-minded verb added to a grant list somebody was already editing. The comment now says that, and the seed was rewritten to add the grant **after** the `REVOKE`, which is how the defect actually arrives, and `R12` catches that one.

**This is the third time in three days that a claim written into a comment was wrong in the direction of understating a control, and the second time execution rather than review found it.** The rule it argues for is not "write more careful comments". It is that a seeded violation is worth running even when you are confident you know what it will say.

### The plaintext floor, which is `INV-M10-12` becoming a constraint

**Founder ruling, 2026-08-16, at the same sitting that approved the redesign.** `0034` gained `CHECK (octet_length(<col>) >= 29)` on each of the three sealed columns, guarded so it applies only when the column is not null. `ADR-046` carries the ruling and the reasoning; what belongs here is what it costs and what it does not reach.

**Every sealed column is `bytea` and every byte string is a valid `bytea`.** A handler that skipped the seal and wrote the address itself satisfied the completeness `CHECK`, the uniqueness indexes and the foreign keys. Nothing objected, the row read as sealed to every catalogue query, and the defect would have surfaced at **decrypt** time with the address in the clear at rest in the meantime. `INV-M10-12` says plaintext lives in a request body and never at rest; before this it was a promise the schema made and could not keep.

**29 is a 12-byte nonce, a 16-byte GCM tag and one byte of ciphertext.** A raw E.164 is at most 16 bytes, so the entire telephone-number address space sits below the floor. **The reach is stated exactly rather than rounded up**: `contact_channels.kind` is `('email','push','sms')`, so a plaintext email of 29 bytes or more clears it. Total for telephone numbers, partial on that one table for the other two kinds, total on `identity_phones` and `phone_change_requests`.

**It is a separate constraint rather than a clause inside `*_ciphertext_is_complete`, and the reason is the paragraph below this one.** Two constraints on one column mean a write can violate both, and PostgreSQL reports one of them in an order it does not document. **That is not a hypothetical here: it is the defect this same section recorded one day earlier**, and the three fixtures that name the completeness `CHECK` were rewritten from `'\xaa'` to a 44-byte envelope so that each violates exactly the constraint it names.

### `OI-07` a third time, caught before the merge instead of a day after it

**`probe_reversible_contact_addresses.sql` was wired into `corpus.yml` and never added to `CI-06h`'s required-needle list**, which is the identical omission `probe_payout_hold.sql` made and which left that file one `git rm` from being `OI-07` again for a day. It is pinned now, and the pin was watched failing: deleting the workflow step makes `CI-06h` report `ADR-046's sealed addresses, plaintext floor and dispatcher grants are no longer probed`.

**Wiring a probe and pinning it are two edits in two files, and only the second makes the first permanent.** Three occurrences is a pattern rather than a slip, and the shape of the fix is a gate that reads `corpus.yml` and asserts that every `scripts/db/probe_*.sql` on disk is both run and pinned. **No gate is claimed here**, because a gate arrives with a `CI-06` letter and a seeded violation, and this one needs neither `0034` nor the founder's read to land first.

### A guard that refused everything on `identity_phones` passed all thirty-two assertions

**And that is this file's own stated defence, failing on the table it was not looking at.** The probe leads with success cases precisely because an inventory of refusals passes against a guard that rejects everything. But every write it made to `identity_phones.phone_ciphertext` was one it expected to be **refused**: `R3` and `R3a` are both rejections and no assertion ever sealed an identity phone successfully. A `CHECK` on that table reading `phone_ciphertext IS NULL` therefore passed the entire file and reported nothing.

**A seeded run found it, not a reading**, which is the second time in two days that executing a counterfactual corrected a claim this corpus had already written down. `S2c` is the missing success, it seals at the minimum legal envelope so it pins the floor's permissive side at the same time, and it is what fails now when that table's guard refuses everything.

**It also moved an assertion that was resting on an absence.** `R3` set `phone_ciphertext` and `phone_key_id` and relied on `phone_encrypted_at` being **unset** to violate the completeness `CHECK`. With `S2c` sealing the row first, the omitted column would have inherited `S2c`'s timestamp and `R3` would have reported the write accepted. It clears the column explicitly now: **an assertion that depends on a column being unset is an assertion one earlier fixture can silently disarm.**

### `0034` broke a probe written before it, and CI is what said so

**`probe_phone_identity.sql`'s `S6` applies a phone change with all three D4 controls and a running hold, and it sets `prior_notified_at` because that is what (c) required in `0029`.** After `0034` that write cites no evidence, `phone_change_requests_prior_notice_is_evidenced` refuses it, and the probe fails. **It failed on CI and not locally**, because this session ran its own probe against the new schema and not the other five.

**The fix is not a loosening and the distinction matters.** `S6` is the positive control for the legitimate path, and ADR-046 made the legitimate path **narrower**: an application now has to produce two artifacts it previously did not need. `S6` produces them. `R7`, which applies with no notification at all, is untouched and still rejects.

**And it exposed two assertions that were resting on an undocumented detail.** `R6` (no dual-channel verification) and `R8` (an expired hold) each set `prior_notified_at` while violating `phone_change_requests_applied_is_complete`, so after `0034` they violate **two** constraints at once and PostgreSQL reports one of them in an order it does not document. Both happened to report the one they name. Given the evidence rows they now violate exactly one, and each asserts the constraint it names rather than the constraint the planner reached first.

**The transferable rule: run every probe, not the new one.** The probe suite is a single body of evidence about one schema, and a migration that changes a shared table changes what every probe touching it is asserting.

### What `0034` does not do

**It does not touch `otp_challenges`.** An OTP is challenge-response: the trader types the number into the request, so the address is held by the request and is deliverable today. `destination_hash` stays one-way. The exposed class is every message **Merit itself initiates**.

**It does not prove the notice was addressed to the prior number.** `integration_dispatches` records `fields_sent` and never values (`INV-M10-03`), so no column anywhere holds a dispatch's destination, and adding one would make the audit record of a disclosure into a second copy of the thing disclosed. `GS-265`'s wording is "addressed to the prior channel" and the database can assert the citation and the identity, not the address.

**It does not scope `merit_app`'s read.** PostgreSQL cannot subtract a column from a table-level `SELECT`, and the alternative is a hand-maintained column list. The key is the control; the sidecar table that would make the grant the control is named in [ADR-046](../../docs/decisions/ADR-046.md) and is not built here.

**It does not backfill.** Every row written before `0034` has a hash and no ciphertext, and sealing one requires the plaintext, which for a **prior** address Merit does not have. **The backfill is forward-only by construction** and the addresses already lost stay lost.

**And there is no gate.** `CI-06h`'s job runs the probe, which proves this schema. Nothing asserts that the **next** table carrying an address hash arrives with a sendable sibling, or that a later migration has not granted `DELETE` to this role. Both are checkable and neither is claimed here, because a gate arrives with a `CI-06` letter and a seeded violation it has been watched failing on.

---

## 19. `0035` lands, and the ruling it carries is one a constraint cannot reach (2026-08-16)

**[ADR-047](../../docs/decisions/ADR-047.md) accepted, `OQ-P2-02` closed, [`0035_rule_states_calendar_revision.sql`](migrations/0035_rule_states_calendar_revision.sql) written, applied, probed and pinned.** It is the other half of `0033`. `0033` made the prior image **mandatory** on the calendar side, so every correction leaves an unforgeable record of what the calendar said before it moved; nothing joined that record to a state row, so **replay held the evidence and could not scope by it.**

`rule_states.calendar_revision_id` references `trading_calendar_revisions(id)` `ON DELETE RESTRICT`. A **reference rather than a copied value**, which ADR-047 rules explicitly: a stored revision number accepts any integer a writer types, and a second copy of a fact the database owns is the drift this corpus has spent five ADRs ending.

### The stamp is a watermark, and the column name invites the other reading

**`calendar_revision_id` is the highest revision id that existed when the FOLD ran. It is NOT the revision that corrected this row's `trading_day`.** A rule state is folded over the whole day sequence from day one, so what it depends on is the calendar **as a whole**. A per-day pointer would scope replay to the corrected day and **miss every downstream counter**, which is the entire failure ADR-047 exists to prevent.

**The watermark is complete because of what `0032` and `0033` already installed**, and it is worth naming the chain: `0032` revoked `UPDATE` and `DELETE` on `trading_calendar_revisions` from `merit_app` and `PUBLIC`, `0033` requires a prior image on every `UPDATE` to `trading_calendar` and refuses `DELETE` and `TRUNCATE`, and the identity primary key is monotonic. So **the set of revisions with `id <= N` is a complete and immutable description of every correction the calendar had undergone at watermark N.** The column is decoration without all three.

### The ruling is an EXCLUSION, and getting it backwards inverts the ADR

**`calendar_revision_id` is excluded from `state_hash`.** `engine_version` is already excluded because "a build identifier is not state; including it makes every engine upgrade a universal divergence", and ADR-047's thesis is that the calendar revision is the engine's **second version-like input**. The identical argument applies with identical force: **in the hash, one calendar correction changes every row's hash at once and pages once per account**, which is the 5,000-page morning the ADR exists to prevent.

**The nineteen hashed fields and their order are unchanged**, so no stored hash moves and no replay is invalidated. The **exclusion** list goes from three to four, and it is extended **in the column comment `0015` put it in** rather than only in a document, because that comment is the only machine-readable record of the input set ([ADR-026](../../docs/decisions/ADR-026.md) C-07). A migration that added a column and left the comment alone would make C-07's own warning come true in the commit that cites it.

### Install verification, from empty

| Check | Result |
|---|---|
| Forward-only apply, `0001` to `0035`, `ON_ERROR_STOP=1` | **applies clean** |
| Re-apply of `0035` | **rejected** (`column "calendar_revision_id" of relation "rule_states" already exists`) |
| Foreign key installed | `rule_states_calendar_revision_id_fkey` -> `trading_calendar_revisions(id)` `ON DELETE RESTRICT` |
| `state_hash` comment | names `calendar_revision_id` among the exclusions |
| Tables created / triggers created | **zero and zero**, so the database-derived counts are unchanged |
| Corpus gates | **15 of 15** |

**No backfill, and it needs none.** `rule_states` has zero rows: the engine is P2 and no seed or fixture inserts into it. The `ADD COLUMN` is metadata-only and **nothing in the file can be read as evidence that a populated table satisfies it**, which is `0032` and `0033`'s sentence and is why the probe exists.

### The probe leads with SIX successes, because here the dangerous edit is a TIGHTENING

[`probe_rule_states_calendar_revision.sql`](../../scripts/db/probe_rule_states_calendar_revision.sql), **10 / 10**, wired into [`corpus.yml`](../../.github/workflows/corpus.yml) and **pinned by `CI-06h` in the same commit**.

**Section 13's lesson is usually "a guard that refuses everything passes an inventory of refusals". This migration is the mirror image and it is worth stating separately: a NULLABLE column's dangerous edit is a NOT NULL, and no rejection can see one.** `NOT NULL` on `calendar_revision_id` installs cleanly, satisfies all four rejections below, and **refuses every state row the engine writes until somebody has corrected the calendar at least once**. That is ADR-039's `SUCCESS 2` in a different costume: completing the pair looks like tightening a constraint while actually breaking the ordinary path to guard the rare one.

| Assertion | What fails if it is deleted |
|---|---|
| **SUCCESS 1** | A `NOT NULL` on the column goes unnoticed. NULL means the fold read a calendar that had **never** been corrected, which is every row until the first correction lands |
| **SUCCESS 2** | The ordinary post-correction write is unproven |
| **SUCCESS 3** | Nothing asserts two states may **disagree**. B.4 step 1 compares only rows matching the current watermark, and a schema forcing every row to one value satisfies the key, reads as tidy, and leaves the scoping query nothing to scope. It asserts **both sides of the partition are non-empty** |
| **SUCCESS 4** | The `= max(id)` guard gets added later by somebody who reads the rejections and concludes the column is under-constrained. **It would force a lie**: a correction committing between the fold and the write leaves a row that genuinely read the older calendar |
| **SUCCESS 5** | The **non**-correspondence goes unasserted. It walks from a state for `2026-06-03` to the prior image of `2026-06-01` and **requires them to differ**, so a future "fix" that constrains the two days to agree fails here and nowhere else |
| **SUCCESS 6** | The one ruling no constraint can reach. The hash is computed by an engine that does not exist yet, so the **contract** is asserted instead, in **both halves**: that the comment names the column, and that it names it as `excluded` |
| **REJECTION 1** | A state may cite a revision that never existed, which is what a bare integer would allow and is why ADR-047 rules a reference |
| **REJECTION 2** | `ON DELETE RESTRICT` is unproven and a stamp may point at a deleted row |
| **REJECTION 3** | `0032`'s `REVOKE` is unproven, and **the watermark rests on it**: if the prior image at revision 7 can be rewritten, two folds carrying watermark 7 read different calendars |
| **REJECTION 4** | A revision may be erased in the window between the correction landing and the first fold citing it |

**Rejections 1 and 2 both raise `foreign_key_violation`**, so both are checked **by message**: a handler catching the class cannot tell "the revision does not exist" from "it may not be deleted while a state cites it", and either half could be deleted with both tests still passing.

### Nine counterfactuals, each watched failing on its own finding

| Seeded defect | Caught by |
|---|---|
| `NOT NULL` on `calendar_revision_id` | SUCCESS 1 |
| The naive `= max(id)` guard on INSERT | SUCCESS 1 (it refuses NULL as well) |
| **The refined guard that permits NULL and forces non-null stamps current** | **SUCCESS 4 alone**, with 1, 2 and 3 passing |
| The watermark constrained to match the row's own `trading_day` | SUCCESS 5 |
| The `state_hash` comment reverted to `0015`'s three exclusions | SUCCESS 6 |
| **The INVERSION: the comment lists the column as hashed rather than excluded** | SUCCESS 6's second half |
| The foreign key dropped (a bare integer) | REJECTION 1 |
| `ON DELETE CASCADE` in place of `RESTRICT` | REJECTION 2 |
| `0032`'s `REVOKE` undone | REJECTION 3 |
| **A trigger refusing every `rule_states` write** | SUCCESS 1, which is the shape only a success case can see |

**Both forms of the `max(id)` guard were seeded and they fail in different places**, which is why the probe header names both rather than claiming SUCCESS 4 catches "the" guard. The first draft of that header did claim it, and the seeded run said otherwise.

### What `0035` does not do

**It installs no trigger asserting the stamp is current, and refusing to is a decision.** The tempting guard would force a row that genuinely read the older calendar to claim one it never saw, and replay would then believe a stale row was current. **A control that can fabricate is not a control**, which is `0033`'s own header ("the database's answer to a correction with no reason is to REFUSE the correction, never to write a reason of its own") applied back to it. What **is** assertable, that the stamp names a revision that really existed, is the foreign key.

**It adds no index.** B.4 step 1 scopes by this column on every nightly audit, which sounds like an index and is not: the audit re-derives every row for every account, so the scoping is a filter applied **during** a full pass rather than a lookup into one. **`engine_version` has carried the identical access pattern since `0015` with no index**, and adding one for the second while the first has none would assert a difference that does not exist.

**It does not guard calendar `INSERT`, and that is a stated exposure.** `0033` covers every way a day can **change**; an `INSERT` writes no revision row and moves no watermark. For a **future** day that is correct, because extending coverage forward changes no already-computed state. For a day **backfilled inside an existing coverage window** it is not: the day sequence moves retroactively and every stamped row still claims a watermark that looks current. ADR-047 does not rule it and ADR-045 owns `trading_calendar`'s guards, so this session does not add a money-path trigger on its own authority. **`0032` header item 3's restraint, applied a second time.** `OI-12`.

**It does not create the rewrite path B.4 step 4 needs.** `0026` revoked `UPDATE` on `rule_states` from `merit_app` and `PUBLIC` and no `SECURITY DEFINER` function performs the audited rewrite. **Pre-existing and identical for `engine_version`**, so it is not widened here, but this column makes a second caller for a path that has none. `OI-13`.

**And it cannot make the engine populate the column.** This is the failure the column creates if it is never written: **every row stamped NULL after a correction reads as out of scope, the audit compares nothing, and an audit that has stopped looking reports exactly like an audit that found nothing** (FM-17). No per-row constraint can tell "not yet written" from "pristine calendar" without fabricating, so the assertion belongs to the replay job: **it must refuse a run whose in-scope set is empty while rows exist.** `OI-14`.

### `0035` broke a probe written before it, and a hand-maintained list is why

**`probe_calendar_revision_required.sql`'s `REJECTION 8` truncated `trading_calendar, trading_calendar_revisions` by name**, and its own comment explained the pair: naming both tables leaves the foreign key no objection, so **the only thing standing between an operator and an empty calendar is CALENDAR-C2**. That list named every table in the dependency graph **as of `0033`**.

**`0035` added a third.** `rule_states.calendar_revision_id` references `trading_calendar_revisions`, so the statement began failing with `cannot truncate a table referenced in a foreign key constraint` **before CALENDAR-C2 could fire**. The guard was intact the whole time; the probe had gone blind to it.

**Two things stopped that from being a silent pass, and both were already in the file.** The assertion checks the finding **by message** rather than by exception class, so a `wrong finding` is a failure rather than a green rejection; and section 18's rule was followed, **every probe was run against the new schema rather than only the new one**. This session ran seven probes and the NO-FLOATS assertion; one failed, and it failed loudly.

**The repair removes the list rather than extending it.** `TRUNCATE trading_calendar CASCADE` makes PostgreSQL derive the referencing set, so the next migration to reference either table cannot break the assertion the way `0035` did. It is also the **stronger** test: `CASCADE` is the form an operator with a deadline reaches for, and it is the one that empties the audit trail **and the rule states** along with the calendar. **This is `OI-08`'s lesson in a new costume**: a hand-maintained list does not fail when it goes stale, it keeps passing against less. Here it did not even manage that, which is the better failure of the two. Watched failing dirty with `trading_calendar_no_truncate` dropped.

**All seven probes and the NO-FLOATS assertion pass against the `0035` schema.**

---

## 20. `0036` lands, and the executable artifact was the one that was wrong (2026-08-16)

**[`0036_supersede_daily_marks_balance_arithmetic.sql`](migrations/0036_supersede_daily_marks_balance_arithmetic.sql), [EC-157](../../docs/edge-cases/EC-157.md)'s Repair A, ruled by the founder 2026-08-16.** `0014` is untouched on disk. **No numbered delta lands here**: this is a correction to a constraint, not a schema change any `SD-nn` proposed.

| | |
|---|---|
| Dropped | `daily_marks_balance_arithmetic` — `closing = opening + realized_pnl + adjustment` |
| Added | `daily_marks_inv19_closing_identity` — `closing = opening + realized_pnl` |

**The name is retired with the statement rather than reused.** Redefining `daily_marks_balance_arithmetic` in place would leave every reference to that name pointing at a constraint whose meaning had silently changed, which is `C-02` ([ADR-028](../../docs/decisions/ADR-028.md)) in a new costume. The replacement is named for the identity it carries.

### The arithmetic, and why five artifacts could not all be right

A settled payout of 250,000c against a prior close of 5,000,000c, on a day that makes 30,000c:

| Source | Says | Gives |
|---|---|---|
| `INV-18` | `opening == prior.balance + adjustment` | opening **4,750,000** |
| `INV-19` | `closing == opening + realized_pnl` | closing **4,780,000** |
| `0014`'s CHECK | `closing = opening + realized_pnl + adjustment` | requires **4,530,000** |

**The three have exactly one common solution and it is `adjustment_cents = 0`**, which is the one value `SD-01` was added to make impossible to assume. **The mark for every settled payout was unwritable as specified.** Nothing had noticed because every mark in the repository carries a zero adjustment, and at zero the three agree exactly.

**Four artifacts put the adjustment at the open and one put it inside the day**: `INV-18`, `R-10` ("the withdrawal lands at the open of `effectiveTradingDay`, never inside a session"), `EC-034`, and **`0014`'s own comment on the column** ("applied at the **open** ... never inside a session"), against `daily_marks_balance_arithmetic`.

**M02 settles it from the other side, and this is the citation the ruling turns on.** `INV-M2-06`: "Every mark satisfies M1's identities ... **asserted by M2 before handing the mark to the engine**." The ingest module is specified to produce marks already in the identity form, so `daily_marks` is a **normalized** record rather than a raw vendor dump, and `INV-M2-12` has the normalizer classify every balance delta as trading or non-trading and refuse to guess. Both invariants name `mark.` columns, so both are claims about the **stored row**.

**Repair B was rejected on the record.** Moving the adjustment inside the day contradicts `R-10` and `EC-034`, reopens the question `SD-01` closed, and breaks `INV-21`: a withdrawal applied inside a session is one the intraday low can be measured against, so `INV-21` would stop following from `CV-11` and `CV-17`.

### The cost, accepted rather than discovered later

**The schema stops asserting the adjustment at all.** `INV-18` reads `prior.balance_cents`, which lives in `rule_states`, and a `CHECK` cannot see across rows. The identity moves to where it was always asserted: M02 before the engine sees the mark (`INV-M2-06`), and the engine at `DO-3`, which returns an `AssertionFailure` and raises reconciliation rather than throwing (`R-07`, `EC-047`). `INV-19` is intra-row and stays a `CHECK`.

That is a real loss of a database-level guarantee and it is the price of the ruling. The alternative was keeping an executable statement of an identity that no document asserts.

### The mislabel, which is the transferable part

`0014`'s comment above the constraint reads **"INV-18, now checkable because SD-01 exists"**, and the [`daily_marks` design record](../../docs/architecture/data-model/daily_marks.md) said the same. **It is neither identity.** `INV-18` is the opening identity, `INV-19` the closing one, and `closing = opening + realized_pnl + adjustment` appears nowhere in M01.

**A wrong label on an executable artifact is how the wrong identity became authoritative.** A reader checking whether the schema enforced `INV-18` found a constraint that said it did. The design record is corrected in the same commit; `0014`'s `--` comment can never be edited (constitution E2), so `0036` replaces the **column comment**, which is metadata rather than migration text, exactly as `0031` replaced `0010:225`.

**The one artifact of five that was never read against the other four was the executable one**, and the reading a session under pressure re-derives is that the constraint must be authoritative *because* it is executable. It is worth stating the opposite plainly: an executable statement of the wrong identity is still the wrong identity.

### Verification

**All 36 files apply forward-only from empty against PostgreSQL 16, zero errors: 102 tables, 404 check constraints.**

[`probe_daily_marks_identities.sql`](../../scripts/db/probe_daily_marks_identities.sql), **three success cases first, then three rejections, 6 / 6.** It leads with the success case because here that is the entire finding: **a legitimate row was refused**, and a probe that only attempted forbidden things passed against this constraint for twenty-two migrations.

| | Assertion | Result |
|---|---|---|
| SUCCESS 1 | the settled-payout mark satisfying `INV-18` and `INV-19` is writable | **passes** |
| SUCCESS 2 | a positive adjustment (the promotional-credit direction) | **passes** |
| SUCCESS 3 | the zero-adjustment day, unchanged | **passes** |
| REJECTION 1 | `daily_marks_inv19_closing_identity` refuses a broken closing | **fires** |
| REJECTION 2 | the retired name is **gone from the catalogue**, not merely quiet | **fires** |
| REJECTION 3 | `daily_marks_high_bounds_day` is untouched and still binds | **fires** |

**THE COUNTERFACTUAL, EXECUTED.** The same probe against `0001`-`0035` fails at SUCCESS 1:

```
ERROR:  new row for relation "daily_marks" violates check constraint "daily_marks_balance_arithmetic"
```

`psql` exits **3**. Under `0036` the same row commits. That is EC-157's claim, run rather than argued.

**The day-sequence property suite is flipped in the same commit rather than deleted.** It watched every non-zero-adjustment mark **violate** the stored constraint; it now watches them **pass**, and the branch on whether the adjustment is zero is gone, which is itself the finding: under `0014` that branch existed because zero was the only value at which the constraint and the two invariants agreed. Kept rather than removed as redundant, because it is what fails if a later migration puts the adjustment back into the closing identity.

---

## 21. `0038` lands, and the assertion a reader would have counted as a control turned out to be unreachable (2026-08-20)

**[ADR-067](../../docs/decisions/ADR-067.md), `SD-M6-09`, [FOLD-03](../../docs/plans/FOLD-03-vendor-parity-gap-fill.md) session `F6`. MONEY PATH.** The file carries an `E2 READ` header naming seven things for the founder's line-by-line read.

### Install verification, from empty

**PostgreSQL 16, empty cluster, `0001` through `0041` applied in order, `ON_ERROR_STOP=1`.** All forty files apply clean and the schema reaches **106 relations**. `0038` creates one table, three functions, three triggers, six indexes and one `REVOKE`.

### The probe: eighteen refusals and three commits, each watched

**Executed rather than argued**, on sections 17 to 20's precedent. The fixture is one identity and four ledger accounts, and every case below was run against the installed schema.

| | Case | Result |
|---|---|---|
| **SUCCESS 1** | a 50,000 cent goodwill credit: transaction, two legs, adjustment row, wallet entry | **commits** |
| **SUCCESS 2** | the full, linked reversal of it, wallet back to zero | **commits** |
| **SUCCESS 3** | **a credit against a `restricted` identity**, which is `GS-298` and is the ruling's positive case | **commits**, identity still `restricted` |
| B1 | a credit whose wallet leg is posted as a **debit** | `ADJ-C2` **fires** |
| B2 | the row says 50,000 cents and the posting says 40,000 | `ADJ-C2` **fires** |
| B3 | posted to **`trader_withdrawable`**, which is the whole ruling | `ADJ-C2` **fires** |
| B4 | no posting at all | `ledger_transaction_id` **NOT NULL fires** |
| C1 | posted, balanced, and **no `wallet_entries` row** | `ADJ-C3` **fires** |
| D1 | a bare debit naming no credit: **the clawback** | `account_adjustments_debit_is_a_reversal` **fires** |
| D2 | a **partial** reversal, 20,000 against 50,000 | `ADJ-C1` **fires** |
| D3 | a reversal whose transaction carries no `reversal_of` | `ADJ-C1` **fires** |
| D5 | a **second** reversal of the same credit | `account_adjustments_reversal_uq` **fires** |
| D6 | a reversal **of a reversal** | `ADJ-C1` **fires** |
| E1 | an adjustment **at** the threshold naming no approval | `dual_control_above_threshold` **fires** |
| F1 | a **promotional** reason landing in the **wallet** | `reason_picks_destination` **fires** |
| F2 | the promotional class with **no grant row** | `promotional_names_its_grant` **fires** |
| G1 | a `reason_note` of **one space** | the non-empty `CHECK` **fires** |
| G2 | a `reason_code` outside the vocabulary | the vocabulary `CHECK` **fires** |
| H1, H2 | `merit_app` `UPDATE` and `DELETE` | **permission denied**, twice |
| I2 | a wallet debit that would take the balance **negative** | `wallet_entries_balance_after_cents_check` **fires** |

**`I2` is the one worth reading twice, because the constraint that catches it is four migrations old.** [`0011:90`](migrations/0011_wallet.sql) has made `balance_after_cents >= 0` a `CHECK` since the wallet was written. **So "an adjustment cannot overdraw a wallet" needed nothing from `0038`**, and the honest way to record that is as a property this file inherited rather than one it established.

### The finding: assertion 2 of `ADJ-C1` cannot fail, and only running it said so

**`D6`, a reversal of a reversal, was caught by the wrong assertion.** As first written, `assert_adjustment_reversal_is_sound` checked *"the row you are reversing must be a credit"* before it checked *"the row you are reversing must not itself be a reversal"*. Both catch `D6`, so the second one **never ran**, and its error message is the one that names [`0009:104`](migrations/0009_ledger.sql)'s rule in the corpus's own words.

**The order was swapped, and then the deeper half became visible.** `account_adjustments_debit_is_a_reversal` makes **every** debit a reversal, so the direction check is now unreachable for **any** input: a target that is a debit is necessarily a reversal, and assertion 1 refuses it first. **It is kept as a second line for `LEDGER-C2`'s stated reason** ([`0027`](migrations/0027_triggers_invariants.sql)), that a guarantee resting on a `CHECK` a later migration could drop is a guarantee with a dependency, **and the comment now says in terms that it is not the control and must not be counted as one.**

**The transferable part is the method and not the finding.** [CLAUDE.md](../../CLAUDE.md) records that this corpus's worst errors were failures to check a claim against its source, and that the remedy is reading the source and adding a mechanical assertion rather than escalating the model. **This is the same lesson one layer further in: an assertion that was read rather than run.** Nothing about `ADJ-C1` looked wrong on the page. It took eighteen counterfactuals against a real database to find that one of its six branches was decoration.

### What `0038` does not do

**It widens no closed list**, it adds no eligibility rule, and it does not gate on `identities.status`: [M20](../../docs/plans/M20-wallet.md) `INV-M20-06` already blocks wallet spend and external withdrawal while `restricted`, so `SUCCESS 3` above is the ruling working rather than a gap. **It does not sum sub-threshold rows**, which is a real gap named as `OQ-F6-02` rather than left, with `account_adjustments_actor_idx` created so that whoever rules it has the query.
## 21. `0042` lands, and the guard that mattered was the one nobody writes (2026-08-20)
**`ADR-068`, `SD-M6-10`, [FOLD-04](../../docs/plans/FOLD-04-impersonation-and-admin-parity.md) `I2`. AUTH, therefore MONEY PATH.** Two tables, three `CHECK` constraints, three trigger functions and three triggers, and two narrow `REVOKE` statements.
### Install verification (PostgreSQL 16.13, 2026-08-20)
**`0001` to `0042` applied forward-only from an empty database under `ON_ERROR_STOP=1`, zero errors.** `0038` and `0040` are legal reserved holes under [ADR-036](../../docs/decisions/ADR-036.md), so the applied sequence is `0001` to `0037`, `0039`, `0041`, `0042`.
**Every figure below is read from the catalogue rather than grepped from the DDL**, which is [ADR-034](../../docs/decisions/ADR-034.md)'s rule applied to this file's own claims.
| | `0001` to `0041` | `0001` to `0042` | Delta |
|---|---|---|---|
| tables (`pg_tables`) | 104 | **106** | +2 |
| indexes (`pg_indexes`) | 362 | **369** | +7 |
| check constraints (`pg_constraint`, `contype='c'`) | 414 | **421** | +7 |
| triggers (`pg_trigger`, not internal) | 10 | **13** | +3 |
**Two of the eight figures above were written from arithmetic before they were measured, and both were wrong.** The index and check-constraint counts for `0001` to `0041` were assumed to be three below the new totals, on the reasoning that `0042` declares three named indexes and three named table constraints. **The real deltas are seven and seven**: the count includes the two primary keys and the `token_hash` unique index, which are indexes nobody writes the word `INDEX` for, and the three column-level `CHECK`s on `reason_code`, `reason_detail` and `end_reason`, which are constraints nobody writes the word `CONSTRAINT` for. **They were corrected by querying the counterfactual database rather than by recounting the DDL**, which is the only method that could have caught them, and this paragraph is here because the arithmetic was persuasive and wrong in the same direction twice.
**The grant asymmetry was verified from `information_schema.role_table_grants` and not from the `REVOKE` text**, because a revoke that names the wrong role reads exactly like one that names the right one:
| Role | `impersonation_sessions` | `impersonation_page_views` |
| `merit_app` | `INSERT, SELECT, UPDATE` | `INSERT, SELECT` |
| `merit_analytics` | **no grant of any kind** | **no grant of any kind** |
**`UPDATE` survives on one table and not the other, and that is the intended shape.** Recording the explicit exit is an update to a row that already exists, so revoking `UPDATE` on `impersonation_sessions` would make every session unclosable. `IMPERSONATION-C1` fires on `UPDATE OF token_hash`, so the boundary survives the one update that is allowed. This is why the append-only list in [DATA_MODEL section 1](../../docs/architecture/data-model/README.md) gains **one** table rather than two.
### The probe, and the two seeded violations it was watched failing on
[`scripts/db/probe_impersonation_session_type.sql`](../../scripts/db/probe_impersonation_session_type.sql). **Five success cases before the first rejection**, then seven rejections. All twelve fire against `0042`.
| Seed | What happened |
|---|---|
| **The mirror trigger dropped**, forward guard left in place | **`REJECTION 1` STILL PASSED** and `REJECTION 2` failed. This is the entire argument for two triggers stated as evidence: a guard only on `impersonation_sessions` is satisfied by writing the `sessions` row **second**, and an inventory of refusals reports it green. The hole it leaves is an impersonation token resolving on the trader auth path, which `GS-303` calls the failure that makes every other control on that table decorative |
| **`IMPERSONATION-C2`'s bound rewritten as plain `expires_at`** | **`REJECTION 4` STILL PASSED** and `REJECTION 5` failed. The naive bound admits a page view recorded after an **explicit exit** but before the original expiry, which is a view of a trader's account after the session ended, recorded as though the session were live. `LEAST(expires_at, COALESCE(ended_at, expires_at))` is the whole difference and only `REJECTION 5` can see it |
**The counterfactual against `0001` to `0041` fails on the FIRST SUCCESS CASE**, `relation "impersonation_sessions" does not exist`. The probe cannot pass vacuously against a schema with none of this in it, which is `0034`'s stated test applied here.
### Two fixture facts found by running rather than by reading
Both are recorded in the probe itself, where the next author writing a fixture against these tables will hit them.
1. **`identities_status_is_explained`** ([`0002`](migrations/0002_identity.sql):73) requires a `status_reason` on any identity that is not `active`. `GS-302` needs a **`restricted`** subject, so the fixture carries one.
2. **`sessions.auth_factor` is `NOT NULL`, and it is [`0029`](migrations/0029_phone_identity_and_auth.sql)'s rather than [`0002`](migrations/0002_identity.sql)'s.** Reading `CREATE TABLE sessions` alone does not show it. **This is the corpus's recurring error class in its cheapest form**: a claim about a table checked against the file that created it rather than against the table as it now stands.
### One finding recorded and not repaired
**`ADR-026`'s completeness gate reads this file, and its finding text says otherwise.** [`gates.mjs:1537`](../../scripts/corpus/gates.mjs) scans `docs/**` **and `packages/db/DELTA_MANIFEST.md`**; [`gates.mjs:1542`](../../scripts/corpus/gates.mjs) reports `cited in docs/`. A first draft of section 4c named two unclaimed `SD-M6-nn` numbers outright on the theory that this file is exempt from the gate that reads it, and **the gate caught it while its own message pointed at the one file set that did not contain the citation.** Left unrepaired: `gates.mjs` is held by three concurrent sessions and a shared file earns a minimal diff.

---

## 22. Four merged migration headers went stale the day the ADRs were signed (2026-08-21)

**[`0038`](migrations/0038_account_adjustments.sql):83, [`0041`](migrations/0041_contact_channel_complaints.sql):15, [`0043`](migrations/0043_admin_attributed_actions.sql):11 and [`0044`](migrations/0044_fee_back_and_ladder_unlock.sql):17 each name their ruling as `status: proposed, founder approval PENDING`.** [ADR-066](../../docs/decisions/ADR-066.md), [ADR-067](../../docs/decisions/ADR-067.md), [ADR-069](../../docs/decisions/ADR-069.md) and [ADR-070](../../docs/decisions/ADR-070.md) were all **granted on 2026-08-21**, so all four sentences are now false.

**NONE OF THE FOUR IS EDITED, AND THAT IS THE RULE RATHER THAN A CHOICE.** Migrations are sacred: once merged, never edited, only superseded ([E2](../../MERIT_BUILD_MASTER_PROMPT.md)). A header comment is not a constraint and supersession exists for schema, not for prose, so **there is nothing to supersede and nothing to edit.** The correct disposition is to record the staleness where a reader looks it up, which is this file.

**It is worth stating as a class rather than as four rows.** A migration header that cites the approval STATE of its ruling is citing a value that moves after the file is frozen. **The durable citation is the ADR number; the approval state is not durable and should not have been transcribed into an immutable artifact.** Four files did it, which makes it a pattern rather than an oversight, and the next money-path migration should cite the ruling and not its status.

**No gate catches this and none is proposed here.** `CI-06q` checks that a dated citation of a founder ruling resolves to a declared ruling, and these citations carry no date. A gate asserting that migration prose agrees with ADR status would be asserting agreement between a frozen file and a moving value, which is the defect rather than the check.

---

## 23. `0045` lands, and the exception it makes cheap is the one it exists to record (2026-08-21)

**Session 120.** `SD-M21-01` and `SD-M21-02`, [M21](../../docs/plans/M21-plan-designer.md) section 2.1, under [ADR-071](../../docs/decisions/ADR-071.md) section 4. `SD-M21-03` claims no number and `OQ-M21-06` still carries it.

**The ruling is one sentence: a published plan version resolves to the simulation run it was decided on, or it carries a written waiver saying why no run was consulted. Exactly one of two, never neither.** [M21](../../docs/plans/M21-plan-designer.md) `FM-M21-03` names what that ends, *"a publish lands with no link to the simulation it was decided on ... the amnesia the module was admitted to end"*. The design principle is **make the recorded exception cheap and the unrecorded one impossible**: a copy-only publish takes the waiver in one sentence, and what no publish can be is silent, because afterwards an absent link and a lost link are the same thing.

### The install, from empty, with every figure queried rather than counted

All 45 migrations applied forward-only into an empty PostgreSQL 16.13 under `ON_ERROR_STOP=1`. Read from `pg_tables`, `pg_indexes`, `pg_constraint` and `pg_trigger` against the applied schema, because **two catalogue figures in this repository were written from arithmetic and both were wrong**:

```
tables=111        (110 at 0044, so 0045 adds exactly one)
indexes=392
constraints=879
triggers=16
simulation_runs columns=19
```

Re-applying `0045` to the same database fails, which is what forward-only means:

```
ERROR:  relation "simulation_runs" already exists
```

`simulation_runs` carries **12 named CHECK constraints** plus its primary key and one foreign key, and **2 partial indexes**. Every constraint is named, so every rejection below can be attributed to one.

### The probe: six successes, eight rejections, two `0028` interactions

`scripts/db/probe_simulation_decision_record.sql`, run against the full set. **Successes lead**, per [ADR-035](../../docs/decisions/ADR-035.md): `0034`'s guard rejected everything and passed thirty-two rejection assertions while doing it.

```
SUCCESS 1   | calibrationDigest() hex (64 chars) decoded to exactly 32 bytea bytes and satisfied the CHECK
SUCCESS 2   | a queued run writes with completed_at NULL, and sample_size 0 IS storable
SUCCESS 3   | a DRAFT with neither a run nor a waiver still writes: authoring is untouched
SUCCESS 4   | a published version resolving to its simulation run writes
SUCCESS 5   | a published version carrying a written waiver writes: the exception is CHEAP
SUCCESS 6   | a sweep arm with all three columns writes, alongside runs carrying none
REJECTION 1 | publish with NEITHER refused by plan_versions_publish_decision_recorded (SQLSTATE 23514)
REJECTION 2 | publish with BOTH refused by plan_versions_publish_decision_recorded (SQLSTATE 23514)
REJECTION 3 | BLANK waiver refused by plan_versions_simulation_waiver_not_blank, which the exactly-one CHECK cannot do
REJECTION 4 | running + completed_at refused by simulation_runs_terminal_has_completion
REJECTION 5 | complete without completed_at refused by simulation_runs_terminal_has_completion
REJECTION 6 | a sweep arm naming a parameter but no sweep refused by simulation_runs_sweep_arm_is_whole
REJECTION 7 | the hex string stored UNDECODED (64 bytes) refused by simulation_runs_calibration_digest_is_sha256
REJECTION 8 | sample_size -1 refused by simulation_runs_sample_size_nonneg, matching provenanceFor exactly
0028 A      | the draft -> published UPDATE writing the decision SUCCEEDS: 0028 does not block it
0028 B      | a published row REFUSES to have its decision moved, via 0028's derived pinned set
```

**`SUCCESS 1` and `REJECTION 7` are the same seam from both sides, and they are the one place this migration meets running code.** `calibrationDigest()` returns **hex** and `calibration_digest` is `bytea`, so the probe writes a row through the real decode using an actual producer output, then shows the same string stored **undecoded** being refused at 64 bytes. A header comment cannot reach that seam and this file's own convention is that a claim about running code is watched, not asserted.

**`REJECTION 3` is why the blank floor is a second named constraint.** `num_nonnulls` counts the empty string as **present**, so a waiver of `''` satisfies "exactly one" while recording nothing at all: the publish would pass the control and the reader would learn no reason. A compound constraint passes for one reason and fails for two, so the floor is separate and named, and the probe asserts the rejection comes from **that** constraint rather than from the exactly-one check.

**`REJECTION 4` and `REJECTION 5` are the two halves of a biconditional.** An implication passes the first and admits the second.

### The counterfactual is not what the plan predicted, and this is the honest record of it

The session plan predicted the probe would fail, against a database built from `0001` to `0044` only, on the publish-with-neither assertion. **It fails earlier**, at `SUCCESS 1`:

```
ERROR:  relation "simulation_runs" does not exist
```

That proves the **table** is load-bearing and proves nothing about the **CHECK**, which is the control the ruling actually rests on. So the isolated counterfactual was run instead, and it is the one that means something:

```
COUNTERFACTUAL AT 0044: a publish with NEITHER field was ACCEPTED, rows=1
```

The identical insert at `0045` is refused by `plan_versions_publish_decision_recorded`. **Accepted before, refused after, same statement.** A probe that passes with and without the thing it probes asserts nothing, and a predicted counterfactual that was never run asserts less.

### Three existing probes broke, and that is the constraint working

`probe_daily_marks_identities`, `probe_payout_hold` and `probe_plan_version_immutability` each publish a `plan_versions` fixture and each began failing the moment `0045` applied. **Exactly those three**: the other three probes touching the table leave it at `draft` and were untouched, which is itself a check on the constraint's scope. Each now carries a `simulation_waiver_reason` naming itself as a fixture. Precedent: *"`0035` broke a probe written before it, and CI is what said so."* **11 of 11 probes green** against the full set, and `assert_no_floats` holds on the applied schema.

### What did not get done, stated rather than left to be discovered

- **No `CHECK` can assert the link is SOUND.** `OI-29`. A publish decided on a `failed` run, or on a run over a since-edited draft, satisfies the constraint. A `CHECK` cannot read another table. Stated in the migration header and in the design record, not only here.
- **`swept_value_bp` ships under a name that is not always true.** `OI-29`'s sibling finding, recorded in the design record: [M21](../../docs/plans/M21-plan-designer.md) section 3.4's own worked example sweeps `max_payouts`, a count of 5 and not a basis point. The plan's row is the authority this migration transcribes, so the column keeps the plan's name and the mismatch goes to the founder's read.
- **The unit vocabulary has no word for a calibration vendor's observation date.** `OI-28`, with the candidate ADR named as owed. `rail clock` is declared and argued in the open rather than picked quietly.
- **One identifier series, two definition sites.** `OI-27`, and it is a live instance of [ADR-074](../../docs/decisions/ADR-074.md)'s subject found by a founder read rather than by the gate being built for it this hour.

---

## 24. `0046` lands, and the constraint it replaces was pointed at the wrong column all along (2026-08-22)

**Session 135.** [ADR-079](../../docs/decisions/ADR-079.md), `status: proposed`, unsigned. **No `SD-nn` and no `U-nn`: nothing is added to the schema.** One `CHECK` is retired and one is installed in its place, so this section records a supersession rather than a delta, which is `0036`'s and `0037`'s shape.

**The defect is a reference point rather than a direction.** [`0015:193`](migrations/0015_rule_states.sql)'s `rule_states_consistency_period_started` required `consistency_period_start_day <= trading_day`. `R-47` defines the period start against the **anchor** and sets it to the next trading day **after** that anchor ([M01:563](../../docs/plans/M01-rules-engine.md), and [M01:737](../../docs/plans/M01-rules-engine.md) comments the line `// R-47, strict`). On the eval-pass row the anchor **is** the row's own day, so the period starts tomorrow and **every account that passes an evaluation wrote a row PostgreSQL refused**.

**Why thirty-one migrations passed over it.** On a settlement row the anchor is the basis day, *"The LAST CLOSED DAY the decision used"* ([`0010:63`](migrations/0010_payouts.sql)), and the row is written for the effective day, *"the FIRST TRADING DAY WHOSE OPENING BALANCE REFLECTS THE WITHDRAWAL"* ([`0010:97`](migrations/0010_payouts.sql)), so `nextTradingDayAfter(basis) <= effective` and the predicate held. **It held by `<=` and not by equality**: `GS-068` is the case where the two differ, with Thanksgiving between basis `2026-11-25` and effective `2026-11-27`. Every case anybody thought to write was a case the constraint was right about, which is `0037`'s finding one screen up in the same table.

### The install, from empty, with every figure queried rather than counted

All 46 migrations applied forward-only into an empty PostgreSQL 16.13 under `ON_ERROR_STOP=1`.

```
tables=111        (unchanged from 0045: this migration adds no table)
indexes=392       (unchanged)
constraints=879   (unchanged, and that is the point: one CHECK out, one in)
triggers=16
rule_states CHECK constraints=12   (12 at 0045 and 12 at 0046)
```

**The unchanged total is worth stating rather than glossing.** A supersession that left the count moving would mean something else had been added or dropped alongside it, and the figure is the cheapest available check that nothing was.

Re-applying `0046` to the same database fails, which is what forward-only means:

```
ERROR:  constraint "rule_states_consistency_period_started" of relation "rule_states" does not exist
```

### The defect, executed at `0045` before the repair was written

```
ERROR:  new row for relation "rule_states" violates check constraint
        "rule_states_consistency_period_started"
DETAIL:  Failing row contains (1, 11400000-..., 2026-01-01, funded, 4750000, f,
         4750000, 5000000, 5000000, 0, 0, 0, 0, 0, 2026-01-02, 0, ...)
```

### The probe asserts in three directions, and the third is the one that nearly went missing

[`probe_consistency_period_after_anchor.sql`](../../scripts/db/probe_consistency_period_after_anchor.sql), wired into the migrations job and pinned in `CI-06h`'s required list **in one commit**, which section 18 records as the rule rather than the exception after three occurrences of a probe wired and left unpinned.

**The row this entry exists for is EXEMPT from the constraint it installs.** On the eval-pass row `payout_anchor_day IS NULL`, which is exactly `payouts_settled_count = 0` by `rule_states_settlements_imply_anchors`, so the replacement does not reach it. **"The row inserts clean at `0046`" is therefore satisfied by a constraint that refuses nothing, ever**, and without a third direction this migration would have shipped a `CHECK` watched only not-applying.

`REJECTION 1` and `REJECTION 2` are the boundary either side of `R-47`'s *"strictly"*: a post-settlement row whose period starts **on** its anchor is refused, and one starting **before** it is refused. **Each asserts the constraint NAME** via `GET STACKED DIAGNOSTICS` rather than accepting a bare `check_violation`, which any of the table's twelve checks would satisfy — the same near-miss `0040` recorded when two of its twenty-four assertions were refused by a constraint other than the one they were aimed at.

Three successes and five rejections at `0046`; the same file run against a database at `0045` fails at `SUCCESS 1` with exit 3.

---

## 25. `0047` lands, and the entry that closes `OI-29` closes two thirds of it (2026-08-24)

**Session 148.** [ADR-087](../../docs/decisions/ADR-087.md), `status: proposed`, unsigned. **No `SD-nn` and no `U-nn`: nothing is added to the schema.** One function and two triggers are installed and nothing is retired, so this section records an ADDITION rather than a delta or a supersession, which is a third shape for this file.

**It supersedes nothing, and that is the answer to a question the reservation expected to be live.** [ADR-053](../../docs/decisions/ADR-053.md) refused to reuse a superseded constraint's name because that leaves every existing reference pointing at a constraint whose meaning changed. **The question does not arise here**: `plan_versions_publish_decision_recorded` is not wrong, it is INCOMPLETE, and it keeps standing beside the trigger. The question was asked and answered rather than skipped.

### The reservation cited the wrong file, and the mandatory grep is the only reason anyone knows

[ALLOCATION](../../docs/decisions/ALLOCATION.md)'s rows for `ADR-087` and `0047`, and [P3 section 8](../../docs/plans/P3-ledger-billing-identity.md), all put `plan_versions_publish_decision_recorded` in [`0004_catalog.sql`](migrations/0004_catalog.sql).

```
$ grep -n 'plan_versions_publish_decision_recorded' packages/db/migrations/*.sql
0045_simulation_runs.sql:236:  ADD CONSTRAINT plan_versions_publish_decision_recorded CHECK (
```

**One line, and it is `0045`'s.** The constraint arrived with both columns it reads, in session 120, as `SD-M21-02`. `0004` is the right citation for a different fact: [`0004:183`](migrations/0004_catalog.sql) is where the trigger's cost is stated and [`0045:48`](migrations/0045_simulation_runs.sql) quotes it from there. **Two facts, one file number, fused, and the fusion propagated into three documents.**

**The instruction that caught it was aimed elsewhere.** It exists because [session 129](../../docs/sessions/2026-08-22-session-129.md) cited `0015:208` after [`0037`](migrations/0037_supersede_rule_states_high_water_bounds_balance.sql) had already repaired it, a *later* migration missed. **This was an origin cited too early**, the opposite direction, and the same grep catches both.

### The defect, measured at `0046` before a line of the repair was written

`0001` to `0046` applied forward-only into an empty PostgreSQL 16.13 under `ON_ERROR_STOP=1`. All three of the states this file names inserted clean, each satisfying `plan_versions_publish_decision_recorded`:

```
NOTICE:  WRITABLE AT 0046 (1): publish decided on a FAILED run
NOTICE:  WRITABLE AT 0046 (2): publish decided on a run belonging to a DIFFERENT plan
NOTICE:  WRITABLE AT 0046 (3): publish decided on a run naming NO plan version
```

**`ADR-079`'s rule, applied to a migration that adds rather than replaces: a control that refuses nothing is the failure to measure first.**

### The install, from empty, with every figure queried rather than counted

All 47 migrations applied forward-only into an empty PostgreSQL 16.13 under `ON_ERROR_STOP=1`.

```
tables=111        (unchanged from 0046: this migration adds no table)
indexes=392       (unchanged)
checks=474        (unchanged: no CHECK is added, dropped or replaced)
triggers=16 -> 18 (one function, two attachments)
```

**Three unchanged figures and one that moves is the whole shape of this migration**, and stating them is the cheapest available check that nothing else came along with it.

Re-applying `0047` to the same database fails, which is what forward-only means:

```
ERROR:  function "assert_publish_decision_is_sound" already exists with same argument types
```

### Two of three, and the third is re-filed rather than glossed

| DELTA_MANIFEST's state | Disposition at `0047` |
|---|---|
| A publish decided on a **`failed`** run | **CLOSED.** `OI-29 check A`, and it is written `= 'complete'` rather than `<> 'failed'`: `simulation_runs_status_known` admits four values, so negating the state that motivated the guard would leave `queued` and `running` through, and a queued run has produced no numbers at all |
| A publish decided on a run over a **since-edited draft** | **NOT CLOSED.** Re-filed as `OI-29b` |
| A publish decided on a run belonging to a **different plan** | **CLOSED.** `OI-29 check B`, and stronger than the state asks: the test is the ROW, so a run over another VERSION of the same plan is refused too |

**The third does not close because `rules_digest` has no producer.** `grep -rn 'rules_digest\|rulesDigest' --include='*.ts' --include='*.mjs' packages/ apps/ scripts/` returns nothing. [ADR-081](../../docs/decisions/ADR-081.md) records that `hash.ts` is *"THE DIGEST HALF `OI-29` NEEDS"*; read at the file, [`hash.ts:557`](../../packages/rules-engine/src/hash.ts)'s `HASHED_COLUMNS` is nineteen **`rule_states`** columns and [`hash.ts:691`](../../packages/rules-engine/src/hash.ts) takes a `StateHashSubject`. **What ADR-081 landed is a reusable SHA-256 and a framing discipline pointed at another subject.**

**And the database could hash it, which is why this is a ruling.** `pgcrypto` is installed at [`0001:22`](migrations/0001_extensions_and_enums.sql), so `digest(rules::text,'sha256')` runs today. Installing it would define the canonical serialization of the rule contract to be `jsonb::text`, in a trigger, on the money path, binding a writer that does not exist. Measured on the same cluster:

```
SELECT digest('{"a":1.0}'::jsonb::text,'sha256') = digest('{"a":1}'::jsonb::text,'sha256');  -->  f

'{"a":1.0}'::jsonb::text     -->  {"a": 1.0}
'{"a":1.00}'::jsonb::text    -->  {"a": 1.00}
'{"a":1e2}'::jsonb::text     -->  {"a": 100}
'{"a":1,"a":2}'::jsonb::text -->  {"a": 2}
```

**`jsonb::text` sorts keys and normalizes whitespace and is not canonical over numbers.** A draft re-saved with `5.0` where it held `5` digests differently while being the same contract, so the check would **refuse a legitimate publish**. That is the direction a money path cannot fail in. There is no temporal fallback either: `plan_versions` carries `created_at`, `published_at` and `retired_at` and **no `updated_at`**, so a draft edit leaves no timestamp to compare a run against.

### The probe asserts in every direction the guard can go, and two of them watch a guard NOT firing

[`probe_publish_decision_is_sound.sql`](../../scripts/db/probe_publish_decision_is_sound.sql), wired into the migrations job and pinned in `CI-06h`'s required list **in one commit**, which section 18 records as the rule rather than the exception after three occurrences of a probe wired and left unpinned.

**Rejections assert the check named in the MESSAGE, not the SQLSTATE alone.** A trigger `RAISE` carries no `CONSTRAINT_NAME`, so the sibling probe's `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` technique is unavailable here; matching `OI-29 check A` / `OI-29 check B` is the equivalent discrimination, and without it a row refused by any of the table's checks, or by `0028`, would score as this trigger working.

**Cases `0045 A` and `0045 B` are the direction a wider guard would have broken, and they are the reason the file is longer than its two checks.** A `BEFORE ROW` trigger fires **before** the table's `CHECK` constraints, so the two rows `plan_versions_publish_decision_recorded` exists to refuse reach this trigger first. Both must pass **through** it and be refused **by name**, exactly as at `0046`. A guard scoped one clause wider would take over those refusals silently: both rows would still be refused, nothing in the job would fail, and every caller resolving publish failures by constraint name would stop working.

**`SUCCESS 3` asserts a HOLE rather than a control**, which no other probe in this repository does. A run anchored to no plan version still decides any publish, because `0045` makes that column nullable on purpose. It is in the probe output so that the day somebody closes `OI-29b`, the probe says what they broke.

**Sixteen assertions at `0047`, five successes leading.** The same file run against a database at `0046` fails at `REJECTION 1` with exit 3:

```
psql:scripts/db/probe_publish_decision_is_sound.sql:421: ERROR:  a publish decided on a FAILED run was accepted
CONTEXT:  PL/pgSQL function inline_code_block line 183 at RAISE
```

**Every SUCCESS above it passed at `0046`, and that is the point**: the successes are not what changed, and a probe whose successes also broke at the counterfactual would be measuring the fixtures rather than the guard.

### `0045`'s own probe was run at `0047`, because compatibility is a claim like any other

[`probe_simulation_decision_record.sql`](../../scripts/db/probe_simulation_decision_record.sql) is pinned and `0047` must not disturb it. Run against the database at `0047` it reports **all 16 of its own assertions unchanged**, including `REJECTION 1` and `REJECTION 2` arriving by constraint name and `0028 A` still permitting the publish transition.

**That run is also what decided the shape of check B.** Requiring a non-`NULL` anchor would close the last branch of `OI-29b` and would turn `SUCCESS 4` and `0028 A` into rejections, both of which `0045` asserts **writable**. Turning an asserted-writable shape into a refusal is a change to what `0045` ruled rather than an enforcement of it, and that file is outside session 148's fence. **The constraint on the repair was found by running the neighbour, not by reading it.**

### One check was available, is not one of the three, and is deliberately not installed

`completed_at <= published_at` costs nothing extra in the same trigger and would refuse a publish citing a run that had not finished when the decision was recorded. **A money-path migration that installs an unruled constraint because it was cheap is how a schema acquires rules nobody decided**, and the next reader cannot tell which of its controls were ruled and which were convenient. [ADR-087 section 6](../../docs/decisions/ADR-087.md) records it as a candidate for a ruling.

---

## 26. `0048` and `0049` land, and the defect was found by writing a fixture rather than by reading anything (2026-08-27)

**[ADR-128](../../docs/decisions/ADR-128.md) proposed, founder approval PENDING. `OI-01`, `OI-03`, `OI-04`, `OI-12` and `OI-13` close.** Two migrations rather than one, and `OI-03` takes neither: its own words ask for a check that reads `0026`'s revoke list **against the document**, and a `.sql` file cannot read markdown.

| | |
|---|---|
| [`0048_audited_writes_on_append_only_tables.sql`](migrations/0048_audited_writes_on_append_only_tables.sql) | `OI-04`, `OI-12`, `OI-13`. Three `SECURITY DEFINER` paths and `CALENDAR-C3` |
| [`0049_reserve_coverage_snapshots.sql`](migrations/0049_reserve_coverage_snapshots.sql) | `OI-01`. `reserve_coverage_snapshots`, plus `liability_snapshots.funded_accounts` |
| [`scripts/db/assert_append_only_grants.mjs`](../../scripts/db/assert_append_only_grants.mjs) | `OI-03`. No DDL, no migration number |

**No numbered delta lands here.** All five are open items rather than `SD-nn` rows, so [ADR-026](../../docs/decisions/ADR-026.md)'s completeness gate has nothing to count. `SD-M6-01` stays dispositioned against `0009`.

### The ruled mark correction has never been executable, and no reading found it

**`0014`: "A CORRECTION PRODUCES A NEW MARK ROW AND POINTS THE OLD ONE HERE. Never an UPDATE." `0026` says the same thing in different words. The database refuses both orders and there is no third.**

| Order | Result, executed against PostgreSQL 16.13 |
|---|---|
| Insert the replacement, then point the old row at it | `duplicate key value violates unique constraint "daily_marks_live_per_account_day_uq"`. For the instant before the old row is pointed away, the account-day carries **two live marks**, and the index is partial on `superseded_by IS NULL` |
| Point the old row first, then insert the replacement | `insert or update on table "t2" violates foreign key constraint "t2_superseded_by_fkey"`, reproduced on a minimal copy of the shape. `superseded_by` cannot name a row that does not exist yet |

**It was found by writing the fixture for `SUCCESS 4` of the probe**, which is the same way `EC-157`'s constraint and [ADR-035](../../docs/decisions/ADR-035.md)'s trigger were each found: by trying to perform the legitimate operation. `daily_marks` has zero rows and no correction has ever been attempted, so nothing failed and nothing could.

**The repair defers the uniqueness rather than weakening it.** A partial `UNIQUE INDEX` cannot be deferred, because only a constraint can be deferred and a unique constraint cannot be partial; an `EXCLUDE` constraint can be both. `0048` installs `EXCLUDE USING btree (account_id WITH =, trading_day WITH =) WHERE (superseded_by IS NULL) DEFERRABLE INITIALLY DEFERRED` under the same name, over the same btree, with the same predicate. **The violation class moves from `unique_violation` to `exclusion_violation`**, which is why `REJECTION 6b` checks the class as well as the name.

### `CALENDAR-C3` is immediate, and the deferred version refused its own fixtures

**Written first as a `DEFERRABLE INITIALLY DEFERRED` constraint trigger, on `CALENDAR-C1`'s precedent. Running every existing probe against the new schema, which is section 18's rule, broke [`probe_calendar_revision_required.sql`](../../scripts/db/probe_calendar_revision_required.sql) twice for two different reasons, and the second one was a design finding rather than a probe repair.**

| Run | What happened |
|---|---|
| Deferred trigger, first run | `ERROR: cannot TRUNCATE "trading_calendar" because it has pending trigger events`, so `REJECTION 8` met the executor instead of `CALENDAR-C2` |
| Deferred trigger, after flushing the pending events | `CALENDAR-C3: trading_calendar day 2026-06-01 was INSERTED at or before 2026-06-02`. **The probe's fixture inserts the calendar and then folds over it, in one transaction**, and a deferred guard asks its question at commit, by which time the transaction has folded past the day it just added |
| Immediate trigger, with `0032`'s revisions foreign key superseded as `DEFERRABLE` | Every probe passes. The flush stays in `REJECTION 8`, because a pending foreign-key event blocks `TRUNCATE` the same way a pending trigger event did |

**A transaction that seeds a calendar and then writes marks against it is not exotic**: it is what that fixture does, and it is what a demo seed does. The guard has to ask whether the day was retroactive **when it was inserted**, which is a statement about the moment rather than about the transaction, and that is the one place this file departs from `CALENDAR-C1`'s shape on purpose.

### Install verification, from empty

**All 49 migrations apply in order against PostgreSQL 16.13 with `ON_ERROR_STOP=1`.** **This table read "14 of 14 probes" when it was first written and there are 15**, because the count was taken from a run made while only one of this session's two probes existed. It is corrected here rather than quietly, since a hand-maintained count found wrong is this manifest's most repeated finding and the tenth instance does not get an exception. Counts read from `pg_tables`, `pg_indexes`, `pg_constraint` and `pg_trigger`, never from a grep.

| Check | Result |
|---|---|
| Forward-only apply, `0001` to `0049` | **applies clean** |
| Re-apply of `0048` | **rejected** (`function "supersede_daily_mark" already exists with same argument types`) |
| Tables / indexes / checks / triggers | **112 / 395 / 477 / 20** (was 111 / 392 / 474 / 18 at `0047`) |
| `CREATE TABLE` and `CREATE TRIGGER` in the DDL | 112 and 20, agreeing with the database, which is what `CI-06h` compares |
| Append-only set, from `has_table_privilege` | **26**, and the document declares the same 26 |
| Every probe in `scripts/db/`, plus `assert_no_floats.sql` | **15 of 15 pass**, section 18's rule |
| Corpus gates | **32 of 32** |

### The counterfactuals, recorded as observed rather than as predicted

**Each artifact was run against the migration set WITHOUT the file it belongs to.** A guard nobody has watched fail is not a guard.

```
$ psql -d cf47 -v ON_ERROR_STOP=1 -f scripts/db/probe_audited_writes.sql     # 0001-0047
NOTICE:  SUCCESS 1: with nothing folded, a calendar INSERT needs no revision row
NOTICE:  SUCCESS 2: a day beyond the fold extent is an extension and needs nothing
ERROR:  insert or update on table "trading_calendar_revisions" violates foreign key
        constraint "trading_calendar_revisions_trading_day_fkey"
exit 3
```

**That is not what the probe header predicted and the header now says what happened.** It said `SUCCESS 4` would fail first, because `supersede_daily_mark` does not exist before `0048`. In fact `SUCCESS 1` and `SUCCESS 2` **pass** without the migration, because a guard that does not exist refuses nothing, and the first thing that breaks is the deferrable foreign key. **Both facts were kept**: those two successes are assertions about the guard's shape rather than its existence, and that is worth knowing about them.

```
$ psql -d cf48 -v ON_ERROR_STOP=1 -f scripts/db/probe_reserve_coverage.sql   # 0001-0048
ERROR:  type "reserve_coverage_snapshots" does not exist
LINE 2: DECLARE v_row reserve_coverage_snapshots;
exit 3
```

**It dies at a `DECLARE` rather than at a write**, because the probe binds the table's own composite type, so the absence is caught at PL/pgSQL compile time.

```
$ PGDATABASE=cf48 node scripts/db/assert_append_only_grants.mjs             # 0001-0048
APPEND-ONLY: the declared set (26) and the installed set (25) disagree on 1:
  reserve_coverage_snapshots: DATA_MODEL section 1 declares it append-only and
  merit_app still holds UPDATE or DELETE on it. The word "append-only" in its
  comment is false (VG-8) ...
exit 1
```

**And the assertion falsifies in both directions on the full schema**, which is the direction that matters, because `OI-03` is a stale-list defect and the stale direction is the one nobody looks in:

```
$ node scripts/db/assert_append_only_grants.mjs --falsify
FALSIFIED (declared and unguarded): zzz_phantom_append_only: DATA_MODEL section 1
  declares it append-only and merit_app still holds UPDATE or DELETE on it ...
FALSIFIED (guarded and undeclared): payout_requests: the database revokes UPDATE and
  DELETE from merit_app and DATA_MODEL section 1 does not list it ...
assert_append_only_grants: falsified in both directions, and the seed did not leak.
```

### What `OI-03` actually found, which is not what it predicted either

**The item says a list drifts. It had already drifted, three ways, and every gate was green.** DATA_MODEL section 1 carried **three** copies of its Mutability bullet, left by three keep-both merges, claiming "twenty-three tables ... four migrations", "twenty-two ... three" and "twenty-two ... three", over three different lists of which migrations revoke. **The installed set was twenty-five.** `CI-06u` looks for duplicated passages and these had diverged; `CI-06i` reads table names and not privileges; nothing at all read the database's grants.

**The replacement carries no count.** Every previous version of that sentence opened with one and every one of them was wrong, and a list a machine reads needs no number in front of it.

### Two register rows were wrong, and the register calling its own entry stale is [ADR-117](../../docs/decisions/ADR-117.md)'s named blind spot

| Row | What it says | What is true |
|---|---|---|
| `OI-04` | "two legitimate **single-column** updates" | The `identity_links` write is **four** columns. `suppressed` is the operative field and `identity_links_suppression_has_author` makes `suppressed_by` mandatory, so `disputed_at`, `dispute_note`, `suppressed` and `suppressed_by` move together |
| `OI-01` | `per_plan` is among the fields with no home | It has had one since `0016`. API_CONTRACT's `per_plan` is loss ratio, threshold, `sales_paused` and CUSUM per plan, and that is `plan_breaker_state` column for column. **Thirty-three migrations of an orphan that was not orphaned** |

### `NULLIF` in `rcr_bp` is load-bearing, and the ordering it depends on was executed rather than assumed

**A `GENERATED` column is computed BEFORE the row's `CHECK` constraints are evaluated.** With a plain `(reserve_cents * 10000) / cvar99_cents`, a zero denominator raises a bare `division by zero` and `reserve_coverage_snapshots_cvar99_is_positive` never fires at all; with `NULLIF(cvar99_cents, 0)` the generated value is `NULL`, the row reaches its constraints, and the operator gets the named one. Both were run on a scratch table before either was written into the migration.

**The overflow bound is stated rather than constrained, for the same reason.** A coverage above 214,748x raises `integer out of range`, and no `CHECK` can intercept it, because the generated column is computed first. A reserve 214,748 times the CVaR99 floor is not a state this business reaches.

### What `0048` and `0049` do not do

**No producer, no loader, no replay job, no rows.** `daily_marks`, `identity_links`, `rule_states`, `liability_snapshots` and `reserve_coverage_snapshots` all have zero rows, so nothing in either file can be read as evidence that a populated table satisfies it. The probes are where the evidence is, and they run in CI on every push.

**`0026`'s default privileges are NOT inverted.** Making new tables append-only by default would be strictly stronger and would reverse a decision `0026` states and reasons, which `0045` already writes against. `OI-03` asks for a check.

**`treasury_balances` is NOT made append-only.** `RESERVE-C1` proves the copy was true when it was written, and a later correction to an attestation is outside what a trigger on the citing table can see. That limit is named in `0049`'s header rather than left to be discovered.

**`CI-06w` is NOT extended to the `OI` table**, which ALLOCATION names as the check that would have caught session 120. `scripts/corpus/` was outside this session's fence apart from `CI-06h`'s needle list.

| Where | What it says |
|---|---|---|---|---|
| [`0049:47`](migrations/0049_reserve_coverage_snapshots.sql) | *"`per_plan` ALREADY HAS A HOME AND NEEDS NOTHING. API_CONTRACT's `per_plan` is loss ratio, threshold, `sales_paused` and CUSUM per plan, and that is `plan_breaker_state`, which `0016` built with `plan_id`, `evaluated_on`, `ratio_bp`, `threshold_bp` and a state enum whose values include `'paused'`."* |
| **Section 26 of this file**, the `OI-01` register row | *"It has had one since `0016`. API_CONTRACT's `per_plan` is loss ratio, threshold, `sales_paused` and CUSUM per plan, and that is `plan_breaker_state` **column for column**. Thirty-three migrations of an orphan that was not orphaned."* |
| Delta | Table | Change | Migration | Status |
| SD-M2-07 | new `live_account_state` | [ADR-020](../../docs/decisions/ADR-020.md) tier 2's live cache, one row per account, plus the fifth role `merit_live` and the `REVOKE` that takes `0026`'s default privileges back from `merit_app` | 0050 | **landed** |
| | `0001`..`0049` | `0001`..`0050` | Delta |
| Tables (`pg_tables`, schema `public`) | 112 | **113** | +1, `live_account_state` |
| Indexes (`pg_indexes`) | 395 | **396** | +1, the primary key's |
| `CHECK` constraints (`pg_constraint`, `contype='c'`) | 477 | **479** | +2, `sequence_is_positive` and `is_indicative` |
| All constraints (`pg_constraint`) | 773 | **777** | +4, the two `CHECK`s, the primary key and the `accounts` foreign key |
| Triggers (`pg_trigger`, not internal) | 20 | **20** | **+0, and that is the ruling rather than an omission**: [ADR-164](../../docs/decisions/ADR-164.md) `F6` refuses a monotonicity trigger and gives the guard to `P6-f`'s upsert predicate |

---

## 28. `0051` lands, and `OI-06` closes on one word the recommendation did not contain (2026-08-27)

**[ADR-169](../../docs/decisions/ADR-169.md), session 293, [P5](../../docs/plans/P5-payouts-and-wallet.md)'s `P5-e`.** `OI-06 (payout destinations)` was raised on 2026-08-15 and left **OPEN and deliberately undecided** for eleven days. It closes here, and the register row above carries the disposition.

### The delta

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| `OI-06` | new `payout_destinations` | The payout-destination registry, keyed `(identity_id, destination_ref)` with `first_seen_at` and `cooling_until NOT NULL`, plus the `PAYOUT-DEST-C1` trigger and the `REVOKE DELETE` that takes `0026`'s default privilege back from `merit_app` | 0051 | **landed** |

**No `SD-nn` is claimed and that is deliberate.** This table is not a schema delta proposed by an approved module document; it is an `OI-nn` closure, and section 16 already holds that namespace. Minting an `SD-nn` for it would put a row in the completeness gate's population that no module plan can be reconciled against.

### The install, from empty, with every figure queried rather than counted

`0001`..`0051` applied forward-only under `ON_ERROR_STOP=1` against **PostgreSQL 16.13**, 51 of 51. The re-apply **fails**, as it must: `ERROR: relation "payout_destinations" already exists`.

| | `0001`..`0050` | `0001`..`0051` | Delta |
|---|---|---|---|
| Tables (`pg_tables`, schema `public`) | 113 | **114** | +1, `payout_destinations` |
| Indexes (`pg_indexes`) | 396 | **397** | +1, the primary key's |
| `CHECK` constraints (`pg_constraint`, `contype='c'`, schema `public`) | 479 | **481** | +2, `cooling_follows_first_seen` and `ref_is_present` |
| All constraints (`pg_constraint`, schema `public`) | 777 | **781** | +4, the two `CHECK`s, the primary key and the `identities` foreign key |
| Triggers (`pg_trigger`, not internal) | 20 | **21** | +1, `payout_destinations_window_only_grows` |

**The `0050` column reproduces section 27's figures exactly**, which is why it is stated: it was measured on this branch rather than copied, and the first attempt at it read 481 and 889 because `pg_constraint` was queried **without a namespace filter** and system catalogues came back with it. The filtered query agrees with section 27 to the unit. **A count that does not reproduce is a count nobody has checked**, and this one now has been, twice.

### The grant probe, run in BOTH directions

`0026`'s `ALTER DEFAULT PRIVILEGES` grants `merit_app` all four verbs on every table a later migration creates, so the `REVOKE` is the whole of what makes this table non-erasable. It was proved rather than asserted, on `0050`'s discipline:

| Run | `merit_app` privileges | `DELETE FROM payout_destinations` as `merit_app` |
|---|---|---|
| `0001`..`0051` with the `REVOKE` line removed | `SELECT, INSERT, UPDATE, DELETE` | **`DELETE 1`.** A running cooling window removed by the application role |
| `0001`..`0051` as written | `SELECT, INSERT, UPDATE` | `ERROR: permission denied for table payout_destinations` |

### Seven rejections seeded, seven watched firing, two legitimate writes accepted

| # | Seed | Refused by |
|---|---|---|
| 1 | `INSERT` omitting `cooling_until` -- **the fail-open row this entry exists for** | `null value in column "cooling_until" ... violates not-null constraint` |
| 2 | A window ending before the destination appeared | `payout_destinations_cooling_follows_first_seen` |
| 3 | An empty `destination_ref` | `payout_destinations_ref_is_present` |
| 4 | `cooling_until` moved **backward** | `PAYOUT-DEST-C1`, naming both instants in the message |
| 5 | `destination_ref` repointed on an existing row | `PAYOUT-DEST-C1` |
| 6 | `first_seen_at` rewritten | `PAYOUT-DEST-C1` |
| 7 | `DELETE` as `merit_app` | `permission denied` |

Accepted, because the control has to leave the legitimate operations available: a **forward** re-arm (`UPDATE 1`), and an **equal** write, which is permitted so that a re-registration inside a still-longer window is a no-op rather than an error the caller must avoid by reading first.

### What `0051` does not do

**It does not close `INV-M8-11`.** The register row above says so: `affiliates` carries no destination column at all, so the affiliate rail gains a registry it cannot yet populate. **It does not edit `API_CONTRACT`**, whose line 722 says `cooling_until` *"reads from a registry that does not exist yet"* and is now stale in one direction; that file is `P5-c`'s and `P5-h`'s. **It adds no `provider` column**, because `wallet_withdrawals` carries no provider and the reading leg could not form the key, and the day a second rail lands the namespace needs a superseding migration rather than an edit. **It adds no index beyond the primary key**, `D-09` being specified against `payout_transfers` and owned by `P7`. **And it does not refuse `DELETE` from the table OWNER**, although `0033`'s `CALENDAR-C2` has the precedent and states why a revoke is weaker: that guard is affordable where a ruled correction path leaves every legitimate need another door, and this table has none yet.

---

## 29. `0064` lands, and the field had no source rather than a missing join (2026-08-28)

**Session 384, session 374's blocker `B4`.** `integrations.recon.last_run_at` is projected by `LiabilityResponse` ([API_CONTRACT:908](../../docs/architecture/API_CONTRACT.md)) and **nothing in this schema was written by a reconciliation run**. The allocation row for `0064` was CONDITIONAL and the condition is met: no existing table can carry the record under its own rules, so the number is taken rather than returned.

### The absence, re-derived from the catalogue rather than inherited

The dispatch's premise was checked against the installed 59-migration schema before a line was written, and it holds. Read from `information_schema` and `pg_tables`, never from a grep:

| Query | Result |
|---|---|
| Tables carrying **both** `started_at` and `finished_at` | **one**: `detector_runs`. The schema held exactly one run record and it belongs to the risk detectors |
| Columns matching `%run_at%`, `%run_id%` or `last_%` | twelve, **none a reconciliation clock**. `last_run_at` is not among the schema's 705 distinct column names |
| Tables matching `%recon%`, `%run%`, `%load%`, `%job%`, `%sweep%` | `detector_runs`, `economic_calendar_loads`, `reconciliations`, `simulation_runs`, `trading_calendar_loads` |
| `reconciliations.account_id` | `NOT NULL`, and `reconciliations_account_day_uq` is `(account_id, trading_day)` |

**The last row is the whole finding.** Every row of `reconciliations` is about one account on one day, so the only fold available across them is `max(reconciliations.created_at)` -- which is the fold [ADR-199](../../docs/decisions/ADR-199.md) section 5 refuses one field to the left for the batch, because [OVERVIEW section 5.2](../../docs/architecture/OVERVIEW.md) leaves the run *"resumable at the account boundary"* and a fold over per-account clocks reports a success for a run that crashed.

**Four existing tables were ruled against and each is refused on its own DDL**, in [the design record](../../docs/architecture/data-model/reconciliation_runs.md): `reconciliations` (per account, by a `NOT NULL` and a unique key), `detector_runs` (a run record whose subject is a risk detector, with a synthetic battery this sweep has no analogue of), `ingest_files` (`applied_at` is the ingest stage's clock, two stages earlier in the same sequence), `simulation_runs` (the harness over a draft plan version).

### The delta

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| `B4` | new `reconciliation_runs` | One row per reconciliation sweep per nightly batch run: `batch_run_id`, `trading_day`, `started_at` / `finished_at`, `accounts_total` / `accounts_done`, `mismatches_found`, a three-state `status`, three indexes and six named `CHECK` constraints | 0064 | **landed** |

**No `SD-nn` is claimed and no ADR number is taken.** `0051`'s reasoning for the first: this is not a schema delta proposed by an approved module document. For the second, the dispatch allocated none and `ADR-202` is another session's; `0049` and `0051` each arrived with an entry, so **the absence is named here rather than papered over** -- the design record and this section carry the reasoning, and a founder who wants it as an entry has everything an entry would restate.

### The install, from empty, with every figure queried rather than counted

`0001`..`0064` applied forward-only under `ON_ERROR_STOP=1` against **PostgreSQL 16.13**, 60 of 60. The re-apply **fails**, as it must: `ERROR: relation "reconciliation_runs" already exists`.

| | `0001`..`0063` | `0001`..`0064` | Delta |
|---|---|---|---|
| Tables (`pg_tables`, schema `public`) | 114 | **115** | +1, `reconciliation_runs` |
| Indexes (`pg_indexes`) | 397 | **401** | +4, the primary key's and the three below |
| `CHECK` constraints (`pg_constraint`, `contype='c'`, schema `public`) | 482 | **491** | +9, the six named and the three inline `>= 0` |
| All constraints (`pg_constraint`, schema `public`) | 783 | **793** | +10, the nine `CHECK`s and the primary key |
| Triggers (`pg_trigger`, not internal) | 25 | **25** | **0. This file installs no trigger and no function** |

### The A/B `0060`'s row requires, run rather than assumed

Session 365 wrote a candidate constraint against this schema and refused it on a clean A/B: 15 of 15 probes passed without it and 14 with it, the casualty being `0049`'s own acceptance script. The same A/B was run here over all fifteen pre-existing `probe_*.sql` scripts:

| Run | Result |
|---|---|
| `0001`..`0063`, the fifteen probes | **15 of 15 pass** |
| `0001`..`0064`, the same fifteen | **15 of 15 pass** |

**Nothing this file installs can reach another probe**, and that is a property of the shape rather than luck: every constraint is row-local on a table that did not exist a moment ago, no merged migration is edited, no existing constraint is dropped or re-added, and no trigger or function is created.

### The counterfactual, as observed

`probe_reconciliation_run.sql` run against `0001`..`0063` dies **before SUCCESS 1's INSERT**, at its `DECLARE`, with `type "reconciliation_runs" does not exist`, **exit 3**. The probe binds the table's own composite type, so the absence is caught at PL/pgSQL compile time rather than at the write, which is `probe_reserve_coverage.sql`'s observed shape at `0049`.

### Five successes and ten rejections, every one watched firing

| # | Case | Result |
|---|---|---|
| S1 | A sweep starts: population declared, nobody compared yet | the row `B4` had nowhere to write |
| S2 | **`merit_app`** closes the sweep by `UPDATE` | permitted, and it must be: the table is deliberately not append-only |
| S3 | A run finds two mismatches, **completes**, then a human resolves one | `mismatches_found` stays 2 while `mismatches_open` falls to 1 |
| S4 | A second sweep over the same trading day, killed at 2 of 3 | latest-started and latest-**completed** return different rows |
| S5 | The morning read's predicate | reaches the crashed run **and** the completed one that found something |
| R1 | 2 of 3 accounts, claiming `completed` | `reconciliation_runs_completed_is_whole` |
| R2 | `completed` with no `finished_at` | `reconciliation_runs_finished_when_not_running` |
| R3 | `running` **with** a `finished_at` | `reconciliation_runs_finished_when_not_running` |
| R4 | more accounts compared than declared | `reconciliation_runs_done_within_total` |
| R5 | more mismatches than accounts compared | `reconciliation_runs_mismatches_within_done` |
| R6 | finished an hour before it started | `reconciliation_runs_finished_after_started` |
| R7 | status `degraded`, which is `detector_runs`' third state | `reconciliation_runs_status_is_known` |
| R8 | no `accounts_total` | `not-null`, and R1's control would otherwise be satisfied by `0 of 0` |
| R9 | no `batch_run_id` | `not-null`, which is all the database can hold with no batch-run table to reference |
| R10 | `merit_analytics` reading the table | `insufficient_privilege` |

**S3 and S4 are the two that carry the design.** If `mismatches_found` and `mismatches_open` could never come apart, one would be a copy of the other and this table would be carrying a number `reconciliations` already answers. If latest-started and latest-completed could never come apart, the record would not have solved `B4` at all.

**S2 is an acceptance case for a REVOKE that is deliberately absent.** `0049`'s shape was the available mistake here: copying its `REVOKE UPDATE, DELETE` would have left the producer unable to close a run it had started, and every sweep would then look exactly like a crash.

### What `0064` does not do

**It does not clear `B4` on its own.** The blocker's clearing condition was *"a `recon.completed` event or a run record"*, and this is the record. The reader is `apps/api`'s fence and is not opened here, and **the event half is still owed**: section 1 of the data-model README says mutable tables *"emit an event on every meaningful transition"*, and [EVENTS section 5.3](../../docs/architecture/EVENTS.md) carries `recon.mismatch_detected` and `recon.resolved` and no `recon.completed`. That is an amendment to a frozen document and therefore an ADR, on session 382's finding about `detector.run_completed` at the same boundary.

**It adds no column to `reconciliations`**, and the symmetric design is refused on the DDL rather than on taste: `reconciliations_account_day_uq` makes a re-run update the existing row, so a `reconciliation_run_id` there would name the last run that touched the row rather than the run that found it.

**It stores no `duration_ms`, no `our_source` and no `source_ingest_file_id`.** The first is `finished_at - started_at`; the other two are per comparison and already on `reconciliations` under `SD-M2-06`, and `0013`'s `replaces_ingest_file_id` makes a day a chain of files rather than one.

**It proposes no constraint that reads another table.** `mismatches_found` is bounded and not verified against `reconciliations`; doing that needs a cross-table trigger, which is the class `0060` refused on evidence.

**It gives `batch_run_id` no foreign key**, because no batch run is a row anywhere in this schema. `EVENTS section 5.3` declares the `run_id` in three payloads and no table stores it, which is a second and smaller absence of the same shape as `B4`, found while re-deriving the first and reported rather than taken.

---

## 30. `0065` lands, and the storage was the easy half of the question (2026-08-29)

**Session 398, [ADR-207](../../docs/decisions/ADR-207.md), [ALLOCATION](../../docs/decisions/ALLOCATION.md) rows `207` and `0065`.** `RuleState` requires `lifetimeSettledCents`, `breached` and `breachKind` and `0015_rule_states.sql` declares none of the three. **The port that refuses because of it is wired in production**: [`start.ts:76`](../../apps/api/src/start.ts) installs `databaseAccountReads` and `readEligibility` rejects on `ELIGIBILITY_BLOCKER`, so a trader asking whether they are eligible today gets a rejection because a column does not exist. `0015` is merged and is superseded **by addition** rather than edited (constitution E2).

### The absence, re-derived from the catalogue and larger than the reservation said

`0001`..`0064` applied forward-only under `ON_ERROR_STOP=1` against **PostgreSQL 16.13**, 60 of 60, then read at `pg_attribute`, `pg_constraint`, `pg_indexes` and `pg_trigger`:

| Query | Result |
|---|---|
| Columns matching `%breach%` across all **115** tables | **zero**. Not absent from this table; absent from the estate |
| Columns matching `%lifetime%` across all **115** tables | **zero** |
| `rule_states` columns | **26**, not the 25 `0015` declares. `0035` added `calendar_revision_id` |
| `rule_states` `CHECK` constraints (`contype = 'c'`) | **12**. Fifteen constraints in all, with two foreign keys and one primary key |
| `rule_states` indexes / triggers / rows | **5 / 0 / 0** |
| `0015` constraints still in the catalogue under their original names | **two are not**, both superseded by [`0037`](migrations/0037_supersede_rule_states_high_water_bounds_balance.sql) and [`0046`](migrations/0046_supersede_rule_states_consistency_period_started.sql). This file does not restate either retired name: section 24 already records one of them and `CI-06/retired-constraints` bounds the citations per file |
| `rule_states.phase` | bare `text`, **no vocabulary constraint at all**, while `account_phase` exists at `0001:45` and only `accounts.phase` uses it |

**The last row is a finding in no dispatch and is reported rather than taken** ([ADR-207](../../docs/decisions/ADR-207.md) section 9): the engine's own record admits any string as a phase, on the table replay compares against.

### The delta

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| `ADR-207` | `rule_states` | `lifetime_settled_cents bigint NOT NULL DEFAULT 0` with `>= 0`; `breached boolean NOT NULL DEFAULT false`; `breach_kind text NULL` closed over `BreachKind`'s three members; three named `CHECK` constraints; the `state_hash` column comment superseded | 0065 | **landed** |

**No `SD-nn` is claimed**, on `0051`'s and `0064`'s reasoning: this is not a schema delta proposed by an approved module document. **An ADR number was allocated and is taken**, unlike `0064`, and it carries the two rulings a `CHECK` cannot state: `text` over an `ENUM`, and a derivable column stored anyway.

### The defaults are forced, and this was measured rather than assumed

Five committed probe scripts insert into `rule_states` with explicit column lists naming none of the three: `probe_audited_writes.sql`, `probe_calendar_revision_required.sql`, `probe_consistency_period_after_anchor.sql`, `probe_rule_states_calendar_revision.sql` and `probe_rule_states_high_water_bound.sql`, all wired in `corpus.yml`. **A `NOT NULL` without a default turns sixteen CI probes red.** The values chosen are also the engine's own opening state at [`advance.ts:124`](../../packages/rules-engine/src/day/advance.ts), so the constraint and the correctness argument agree rather than one being bent to the other.

### The install, from empty, every figure queried rather than counted

`0001`..`0065` applied forward-only under `ON_ERROR_STOP=1` against **PostgreSQL 16.13**, **61 of 61**. The re-apply **fails**, as it must: `ERROR: column "lifetime_settled_cents" of relation "rule_states" already exists`.

```
                                    0064      0065     delta
pg_tables (public)                   115       115        0
pg_indexes (public)                  401       401        0
pg_constraint (public, all)          793       797       +4
pg_constraint (public, contype c)    491       495       +4
pg_trigger (public, not internal)     25        25        0
pg_proc (public)                     111       111        0
enum labels (pg_enum)                 65        65        0     no new type

rule_states columns                   26        29       +3
rule_states CHECK constraints         12        16       +4
```

**The four are the three named constraints plus the inline `lifetime_settled_cents >= 0`.** No index, no trigger, no function and no enum type: `breach_kind` is `text` with a `CHECK`, on [ADR-207](../../docs/decisions/ADR-207.md) section 4.

### `0048` item 4's claim, executed rather than read

`rewrite_rule_state` ([`0048:488`](migrations/0048_audited_writes_on_append_only_tables.sql)) takes the whole `rule_states` composite type and derives its assignment list from `pg_attribute` at [`:563`](migrations/0048_audited_writes_on_append_only_tables.sql), on the stated argument that "a column a later migration adds to `rule_states` is rewritten with nobody remembering to add it here". **This is the first migration to test that claim.** The derivation, run against the installed `0065` schema, returns 25 names ending:

```
..., computed_at, calendar_revision_id, lifetime_settled_cents, breached, breach_kind
```

All three are present and `B.4` step 4's audited rewrite covers them with no edit to `0048`.

### The grants, checked rather than assumed

Column adds inherit table-level grants and the catalogue confirms it. `merit_app` holds `INSERT` and `SELECT` on all three and **no `UPDATE`**, so `0026`'s append-only revoke is not widened by a column; `merit_migrator` holds `SELECT` and `UPDATE`, which is `0048`'s table-scoped exception for the audited rewrite. `assert_append_only_grants.mjs` still reports the document and the database naming the same **26** append-only tables.

### Eleven database cases, five acceptances and six rejections, all watched firing

Against `0001`..`0065`, in one transaction, rolled back. **The acceptances are here because a probe that only ever attempts forbidden things passes against a guard that rejects everything.**

```
ACCEPTANCE 1  an insert naming none of the three lands at (0, false, NULL), the engine opening state
ACCEPTANCE 2  all three BreachKind members are writable with breached true
ACCEPTANCE 3  payouts_settled_count 1 with 250000 cents lifetime lands
ACCEPTANCE 4  count 1 with lifetime 0 LANDS, which the refused biconditional would have rejected
ACCEPTANCE 5  an EXPIRED account is phase closed and breached false, so phase does not decide the flag
REJECTION 1   breached true with a null kind          -> rule_states_breach_flag_matches_kind
REJECTION 2   a kind with breached false              -> rule_states_breach_flag_matches_kind
REJECTION 3   'soft_daily_loss_limit'                 -> rule_states_breach_kind_is_a_breach_kind
REJECTION 4   cents settled with nothing settled      -> rule_states_no_settlements_no_lifetime_total
REJECTION 5   a negative lifetime total               -> rule_states_lifetime_settled_cents_check
REJECTION 6   merit_app UPDATE on a new column        -> insufficient_privilege, append-only holds
```

**REJECTION 3 is the vocabulary doing work rather than decorating.** `soft_daily_loss_limit` is the plausible fourth member and `R-23` is explicit that a soft limit is a FACT and never a breach ([`breach.ts:72`](../../packages/rules-engine/src/day/breach.ts)). **ACCEPTANCE 4 is the refused biconditional**: `(payouts_settled_count = 0) = (lifetime_settled_cents = 0)` mirrors `rule_states_settlements_imply_anchors` exactly and is unsound, because [`0010:54`](migrations/0010_payouts.sql) admits `approved_cents = 0`.

**The counterfactual was run.** The same script against `0001`..`0064` fails at ACCEPTANCE 1 with `ERROR: record "r" has no field "lifetime_settled_cents"`.

### The A/B against every existing probe, both legs

| Leg | Result |
|---|---|
| All 16 `scripts/db/probe_*.sql` against `0001`..`0064` | **16 of 16 pass** |
| All 16 against `0001`..`0065` | **16 of 16 pass** |
| `assert_no_floats.sql`, `assert_append_only_grants.mjs`, `assert_date_unit_shape.mjs` at `0065` | all pass |

**The cleanness is structural rather than lucky.** Every constraint is row-local, no merged migration is edited, no constraint is dropped or re-added, no trigger or function is created, and the only pre-existing artefact this file rewrites is one column comment whose load-bearing substring is preserved verbatim.

### What `0065` does not do

**It does not put the three columns in the state hash and it does not rule them out either.** `ADR-026` C-07 fixes nineteen inputs; `0035` added a column and ruled it **excluded** on `ADR-047`'s own reason; **there is no reason of that kind here.** All three are replayable facts the fold produced, which is what inputs 3 and 15 are, so on the merits they belong in the hash. The executable list is `HASHED_COLUMNS` in `packages/rules-engine/src/hash.ts`, outside this fence, and a declared input set no code computes is worse than a stated open question. **The `state_hash` comment therefore records them as UNRULED, in those words.** [ADR-207](../../docs/decisions/ADR-207.md) section 5 is the decision and it is free while the table is empty.

**It does not clear `usePayoutBackend`.** That port's **second** blocker is independent and stands, verified at its sources rather than quoted: `planVersions` ([`scope.ts:672`](src/scope.ts)) and `planVersionSizes` ([`:677`](src/scope.ts)) are class `firm` and `ScopedTableKey` excludes them ([`:1380`](src/scope.ts)), so no `ScopedTx` reaches the `ResolvedPlan` while `PayoutTx` runs every method on one transaction. **`ELIGIBILITY_BLOCKER` is not edited either**, because `readEligibility` still has no adapter: what `0065` removes is the reason the adapter could not be written, not the adapter.

**It writes no row and installs no writer.** `B5` term 1 is still owed and is another fence's.

**It adds no constraint that reads another table.** `INV-17`'s `ladder * max cap` bound reads `plan_version_sizes` and is named in the column comment rather than enforced, which is the class `0060` refused on evidence.

**It does not close `phase`.** Section 9 of the entry says why and says it is the obvious next slice on this table.

**It commits no probe.** The eleven cases above were executed and their transcript is here; `scripts/db/`, `.github/workflows/corpus.yml` and `docs/testing/STRATEGY.md` are all outside this fence, and a probe committed without the workflow row runs nowhere. **It is evidence and not yet a control**, and the remedy is named in the entry's fence section.

---

## 31. `0066` lands, and the record claiming the guard is why nobody looked for it (2026-08-29)

**Session 403, [ADR-213](../../docs/decisions/ADR-213.md), [ALLOCATION](../../docs/decisions/ALLOCATION.md) rows `213` and `0066`.** [`0027:260`](migrations/0027_triggers_invariants.sql) creates `plan_versions_published_immutable` and [`0028`](migrations/0028_supersede_plan_version_immutability.sql) replaces its body, so a published `plan_versions` row is pinned to the byte and a retired one is frozen absolutely. **`plan_version_sizes` carried ZERO triggers**, and every published cents value the engine and a payout approval read lives there. `0004`, `0027` and `0028` are untouched on disk; `0066` adds beside them (constitution `E2`).

**AND THE DESIGN RECORD HAD CLAIMED THE MISSING GUARD SINCE THE DAY THE TABLE LANDED.** [`plan_version_sizes.md`](../../docs/architecture/data-model/plan_version_sizes.md) read *"Immutable once the parent version is published (same trigger)."* There was no such trigger. **That sentence is the reason sixty-two migrations went by**: a reader checking whether the grid was protected found a document saying it was. No gate can see the class -- `CI-06i` reconciles the table set, [`data-model-columns.mjs`](../../scripts/corpus/data-model-columns.mjs) reconciles columns, and **nothing reconciles a record's trigger prose against the `CREATE TRIGGER` statements in the migrations.**

### The defect, re-derived from the catalogue rather than taken from the dispatch

`0001`..`0065` applied forward-only under `ON_ERROR_STOP=1` against **PostgreSQL 16**, 61 of 61, then read at `pg_trigger`, `pg_constraint` and `information_schema.role_table_grants`:

| Query | Result |
|---|---|
| Non-internal triggers on `plan_version_sizes` | **zero** |
| Non-internal triggers on any plan table | **four**, all on `plan_versions` or `accounts`: `plan_versions_published_immutable`, `plan_versions_publish_decision_is_sound`, `plan_versions_publish_decision_is_sound_on_publish`, `accounts_plan_version_pinned` |
| `merit_app`'s privileges on `plan_version_sizes` | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and no `TRUNCATE`. Granted by `0026:75`'s blanket `GRANT ... ON ALL TABLES`, from which this table is never subtracted |
| `CHECK` constraints on `plan_version_sizes` | **nine**, of which the seven `> 0` column checks plus `_floor_lock_complete` and `_buffer_clears_lock` (`CV-11`). **`CV-09`, `CV-10`, `CV-12` and `CV-17` have none**, and three of those four read the parent's `rules` jsonb |
| `buffer_cents` `100000` -> `777777` on a **published** version | **COMMITTED** |
| that version's whole size grid `DELETE` | **COMMITTED**, 0 rows remain |
| a fourth size `INSERT`ed into a published version | **COMMITTED** |

### The delta

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| `ADR-213` | `plan_version_sizes` | `assert_published_plan_version_size_immutable()` and the `BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW` trigger `plan_version_sizes_published_immutable`; the table comment `0004` never wrote | 0066 | **landed** |

**No `SD-nn` and no `U-nn` is claimed**, on `0051`, `0064` and `0065`'s reasoning: this is not a schema delta proposed by an approved module document. **An ADR number was allocated and is taken**, and it carries the ruling a constraint cannot state: the `INSERT` is refused as well as the `UPDATE` and the `DELETE`.

### The `INSERT` is the clause that was decided rather than assumed

**Adding a size takes nothing away from an existing account.** `accounts` pins `plan_version_id` at purchase and resolves exactly one grid row through `plan_version_sizes_version_size_uq`, so no live account's numbers move. **It is refused because nothing validates such a row.** [`validate.ts:45`](../../packages/rules-engine/src/plan/validate.ts): *"eight read `plan_version_sizes` and are evaluated once per size"*, at the publish transition, over the array rather than a row. Of those eight only `CV-11` has a constraint on this table. **A row written after publication is [`validate.ts:463`](../../packages/rules-engine/src/plan/validate.ts)'s own failure mode**: *"two plans wearing one version number, and which of the two an account gets depends on which field a rule happens to read."* The corpus's mechanism for offering a new size is publishing a version, which is what [`0044:243`](migrations/0044_fee_back_and_ladder_unlock.sql) already assumes when it keys an unlock to a `size_cents` rather than to a row id.

### The counterfactual, both directions, from empty and forward-only

[`probe_published_size_grid_immutable.sql`](../../scripts/db/probe_published_size_grid_immutable.sql), seventeen cases, six of them acceptances and they lead. **The dangerous over-correction here is not a missing guard but a TOTAL one**: a guard refusing every write to this table passes all eleven refusals and makes plan authoring impossible, and nothing in `apps/` writes this table today, so nobody would find out.

| | `0001`..`0065` | `0001`..`0066` |
|---|---|---|
| the probe | **11 of 17 RED** | **17 of 17 PASS** |
| `buffer_cents` `100000` -> `777777` on a published version | COMMITTED | **REFUSED**, `check_violation` |
| the whole grid `DELETE` | COMMITTED, 0 rows remain | **REFUSED**, 2 rows remain |
| a fourth size `INSERT`ed | COMMITTED | **REFUSED** |
| a row moved onto a published version | COMMITTED | **REFUSED** |
| a row moved off a published version | COMMITTED | **REFUSED** |
| the three retired-version writes | all COMMITTED | all **REFUSED** |
| a draft grid takes `INSERT`, `UPDATE`, `DELETE` | PASS | **PASS** |
| a version carrying a grid publishes, and later retires | PASS | **PASS** |
| a dangling parent is the foreign key's refusal | PASS | **PASS** |

**The six cases passing on both sides are the point of the acceptance half.** They are what a total guard would break.

### The install, from empty, every figure queried rather than counted

`0001`..`0066` applied forward-only under `ON_ERROR_STOP=1` against **PostgreSQL 16**, **62 of 62**.

```
                                    0065      0066     delta
pg_tables (public)                   115       115        0
pg_indexes (public)                  401       401        0
pg_constraint (public, all)          797       797        0
pg_trigger (public, not internal)     25        26       +1
pg_proc (public)                     111       112       +1
```

### Seven seeds, six red and one green

| # | Seed | Result |
|---|---|---|
| 1 | the landing check removed, so only `OLD` is read | **RED, 4 cases** |
| 2 | the leaving check removed, so only `NEW` is read | **RED, 5 cases** |
| 3 | the refused set listed as `= 'published'` rather than derived as `<> 'draft'` | **RED, 3 cases.** `0028` item 3's exact defect, one table out |
| 4 | `BEFORE` changed to `AFTER` | **GREEN.** A measurement: the exception aborts the statement either way, so the probe cannot see the timing. Written into the probe's header |
| 5 | the `FOUND` test dropped | **RED, 1 case.** A dangling foreign key is then reported as `is <NULL> and its size grid is immutable`, which sends a reader to the wrong file |
| 6 | the refusal message reworded | **RED, 5 cases.** The refusals are asserted by TEXT, not only by SQLSTATE |
| 7 | one case deleted from the probe | **RED**, on the row-count sentinel |

**Each was applied to the committed shape and restored from a byte copy with the SHA-256 checked both ways**, `git status --porcelain` empty after every one.

**TWO DEFECTS IN THE PROBE WERE FOUND BY RUNNING IT IN THE DIRECTION NOBODY LOOKS, AND NEITHER WAS REACHABLE FROM THE GREEN SIDE.**

1. **A `unique_violation` escaping its block truncated the run.** Seeded with the landing check neutered, the retired-`INSERT` case collided with the published-`INSERT` case's now-committed row on `plan_version_sizes_version_size_uq`; that class is not `check_violation`, so the exception took the whole `DO` with it and **the run reported zero failing rows while four cases were broken.** The retired `INSERT` takes a size of its own now, and all eight rejection blocks gained a `WHEN OTHERS` leg recording `FAIL: wrong error class <sqlstate>`.
2. **A `NULL` verdict was invisible to the verdict counter.** Against `0001`..`0065` the move-onto rejection commits, which empties the draft sibling the per-version acceptance then looks for; the value came back `NULL`, the `CASE` returned `NULL`, and `verdict <> 'PASS'` is `NULL` for that row and does not count. **Ten failures were reported where there were eleven.** The value comparisons are total now, the counter reads `IS DISTINCT FROM`, and a row-count sentinel refuses a run producing fewer than seventeen cases. **[`probe_plan_version_immutability.sql:227`](../../scripts/db/probe_plan_version_immutability.sql) carries the same counter**; its `CASE`s are total in practice so nothing is wrong today, and it is another session's control, so it is reported rather than repaired.

### What `0066` does not do

**It does not reach `TRUNCATE`**, which no row-level trigger does. Not reachable by `merit_app`, which holds no `TRUNCATE` here, so the hole is the owner's.

**It does not survive `ALTER TABLE ... DISABLE TRIGGER`.** [`0004:184-185`](migrations/0004_catalog.sql)'s cost, restated rather than hidden. The alternative -- a `REVOKE` plus a `SECURITY DEFINER` write path, `0048`'s shape -- was considered and refused for now: `merit_app` legitimately writes this table while a version is a draft, so that road needs a definer function for ordinary authoring.

**It does not pin `plans`.** Session 401 finding 5, re-derived here and holding: `plans` carries zero triggers and `plans.code` moved. It feeds no cents value into `ResolvedPlan`, so it is registered and open rather than folded in.

**It does not wire `usePayoutBackend`, and it clears one of four grounds.** What `ResolvedPlan` is built from is now pinned on both halves. What still refuses is re-derived in [ADR-213](../../docs/decisions/ADR-213.md) section 8: `PayoutTx` runs every method on one transaction while `subject()` needs a `firm` read, and [ADR-211](../../docs/decisions/ADR-211.md)'s two-transaction remedy is unapplied; `wiring.test.ts`'s `BLOCKED` entry still states the state-half blocker as *"`grep -rn lifetime_settled packages/db/migrations` returns nothing at all"* (`wiring.test.ts:219`), **which is false since [`0065:101`](migrations/0065_rule_state_lifetime_and_breach.sql)**; `routes/payouts.ts:438-439` still states a property the port does not have; and no adapter exists. `apps/**` was outside this fence, so all three are registered.

**It does not say how a published grid is corrected when it is found wrong.** The answer the ruling implies is *publish a new version*, and no route performs one.

## 32. `0067` lands, and the argument against a `CHECK` is a count nobody had taken (2026-08-29)

**Session 406, [ADR-216](../../docs/decisions/ADR-216.md), [ALLOCATION](../../docs/decisions/ALLOCATION.md) rows `216` and `0067`.** [`0001:45`](migrations/0001_extensions_and_enums.sql) declares `account_phase` as **exactly** the engine's four `Phase` members, and it did so before any other table existed. [`0015:47`](migrations/0015_rule_states.sql) typed `rule_states.phase` bare `text` and wrote no `CHECK`. **For fifty-two migrations the table replay compares against admitted ANY STRING as a phase**, on a column that is hash input 3 of [ADR-026](../../docs/decisions/ADR-026.md) `C-07`. `0001` and `0015` are untouched on disk; `0067` supersedes one column declaration from outside them (constitution `E2`), which is the mechanism `0037`, `0046` and `0065` have already used on this table.

**[SESSION 398](../../docs/sessions/2026-08-29-session-398.md) FOUND THIS AND DID NOT TAKE IT**, under `ADR-003`, and said in terms that it is cheaper before rows land than after. It was right about the price and the price is not symmetric: section 32.4 measures which way.

### The defect, re-derived from the catalogue rather than taken from the dispatch

`0001`..`0066` applied forward-only into an empty database under `ON_ERROR_STOP=1` against **PostgreSQL 16.13**, then read at `pg_attribute`, `pg_constraint`, `pg_enum` and `pg_type` rather than by grep:

| Query | Result |
|---|---|
| `rule_states.phase` | `text`, `NOT NULL` |
| constraints on `rule_states` whose definition names `phase` | **zero** |
| `account_phase` labels, in `enumsortorder` | `eval`, `funded`, `closed`, `graduated` -- **the engine union exactly, and in the same order** |
| table columns of type `account_phase` | **`accounts.phase`, and that is all** |
| `rule_states` rows | **zero**, and no writer exists: `B5` term 1 is still owed |
| enum types in `public` | **thirteen**, all created in `0001` |

**AND THE FINDING IS WIDER THAN THE RESERVATION SAID.** `rule_states.phase` is not the only unconstrained phase-shaped column in the estate. [`0007:192-193`](migrations/0007_accounts.sql) declares `account_status_history.from_phase` and `to_phase` as bare `text NULL` with no `CHECK`, beside `from_status` and `to_status` which are bare `text` against `account_status`. **That table is `0007`'s and is outside this fence**; it is registered in section 32.7 rather than repaired.

### The delta

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| `ADR-216` | `rule_states` | `phase` moves from `text` to `account_phase`; the column comment `0015` never wrote | 0067 | **landed** |

**No `SD-nn` and no `U-nn` is claimed**, on `0051`, `0064`, `0065` and `0066`'s reasoning: this is not a schema delta proposed by an approved module document. **An ADR number was allocated and is taken**, and it carries the ruling a statement cannot state: which of [ADR-207](../../docs/decisions/ADR-207.md)'s three reasons transfer to this column and which do not.

### 32.4 The ruling, and the reason ADR-207 had no access to

`ADR-207` chose a `CHECK` over a new `ENUM` for `breach_kind` on three measured reasons. **Re-argued on this column's facts rather than copied**, two of the three do not survive the move:

| `ADR-207`'s reason | Here |
|---|---|
| **1.** All thirteen enum types are created in `0001` and no migration since has added one, so an enum would be a ruling about where new estate vocabularies live | **DOES NOT TRANSFER.** It is a reason against CREATING a type. `account_phase` already exists. Measured: **13 enum types before `0067` and 13 after**, `65` labels before and `65` after. Adding no new type is not the same as using an existing one, and only the first is what this reason speaks to |
| **2.** This table already stores an engine union as bare `text` (`phase`), so an enum for `breach_kind` would make it internally inconsistent | **INVERTS.** Its premise is the defect `0067` repairs. A reason that cites a gap as its justification cannot survive the gap's repair with its sign unchanged. What survives is the requirement underneath it, and section 32.6 states where `0067` leaves it |
| **3.** A `CHECK` narrows by `DROP` and re-`ADD` under one name, which is `E2`'s own mechanism, while an enum value can be added and **can never be removed** | **TRANSFERS AS A FACT AND FAILS AS A REASON.** Both halves executed rather than recalled: `ALTER TYPE account_phase DROP VALUE 'graduated'` is a **SYNTAX ERROR** on 16.13, so it is not a permission that could be granted; `ALTER TYPE ... ADD VALUE` inside a transaction then raises `unsafe use of new value` when the same transaction uses it, so widening costs two migrations here. **BOTH COSTS ARE ALREADY BORNE.** `accounts.phase` has been `account_phase` since `0001`, so removing a `Phase` member already means recreating the type, and adding one already costs the dance. A second column joining adds ONE MORE COLUMN to a rewrite that has to happen anyway. **The marginal cost is zero, and that is what `breach_kind` had no counterpart to** |

**THE REASON `ADR-207` COULD NOT REACH IS THE COPY COUNT.** `Phase`'s four members are written out **literally six times** in this repository with **no comparator between any two of them**:

| # | Site |
|---|---|
| 1 | [`packages/rules-engine/src/types.ts:787`](../rules-engine/src/types.ts) -- `export type Phase` |
| 2 | [`migrations/0001_extensions_and_enums.sql:45`](migrations/0001_extensions_and_enums.sql) -- `CREATE TYPE account_phase` |
| 3 | [`packages/db/src/schema.ts:163`](src/schema.ts) -- `pgEnum('account_phase', ...)` |
| 4 | `apps/api/src/routes/accounts.ts:157` -- `type AccountPhase` |
| 5 | `apps/api/src/routes/accounts.ts:748` -- `const PHASES` |
| 6 | `apps/portal/src/api/types.ts:123` -- an inline union |

**`breach_kind` had TWO copies and `ADR-207` paid for the second with a comparator. A `CHECK` here would have been a SEVENTH copy of four members that already have six and none.** `ALTER COLUMN ... TYPE account_phase` writes the type's NAME rather than its members, so this column's vocabulary is copy 2 **by construction** and there is nothing new for a comparator to defend. That is not an aesthetic preference; it is the difference between a fact stated once and a fact stated twice.

**AND THE OBJECTION TO A SHARED TYPE IS ANSWERED AT ITS SOURCE RATHER THAN BY ASSURANCE.** One enum now serves two columns, and the worry is that an account's phase and the engine's `Phase` are only *incidentally* the same today. **They are the same by design**: [`0007:8`](migrations/0007_accounts.sql) states the split in its own `E2` header -- *"`phase` is the lifecycle the rules engine executes; `status` is the operational state. They are separate columns on purpose."* So `accounts.phase` IS `Phase`, stored on the account, and the account-side state that can move independently already has its own type, `account_status` at [`0001:47`](migrations/0001_extensions_and_enums.sql). **The residual risk is a later migration widening `account_phase` for the accounts side alone, and it is the one thing REJECTION 5 and the `vitest` comparator both exist to catch.** Under a `CHECK` that same widening would be silent in the other direction, with nothing shared to compare: **the shared type does not create the divergence risk, it is what makes it checkable.**

**AND THE PRICE OF DEFERRING IS NOT SYMMETRIC.** A `CHECK` added after rows land can be added `NOT VALID` and validated without an exclusive-lock rewrite. A column type change cannot: it takes `ACCESS EXCLUSIVE` and rewrites the table. **The answer taken is precisely the one whose price rises fastest, and it is taken on the day the table holds zero rows.**

### 32.5 The existing rows were checked before the statement was written

**A constraint added to a table already holding a violating row fails AT INSTALL, and this one was made to.** With `0001`..`0066` installed, a `rule_states` row carrying `phase 'nonsense'` was committed and `0067`'s statement then run against it:

```
ERROR:  invalid input value for enum account_phase: "nonsense"
```

**The table holds zero rows, so `0067` cannot fail that way**, and that is a measurement rather than an assumption. `merit_app` still holds `INSERT` and `SELECT` on the retyped column and no `UPDATE`, read from `information_schema.column_privileges` after the change: **append-only is not widened**, and no `GRANT` was needed because `account_phase`'s `typacl` is `NULL`, which is `USAGE` to `PUBLIC`.

### The counterfactual, both directions, from empty and forward-only

[`probe_rule_state_phase_vocabulary.sql`](../../scripts/db/probe_rule_state_phase_vocabulary.sql), eleven cases, **five of them acceptances and they lead**. The dangerous direction on a vocabulary is not a missing guard but one that fell BEHIND: a fifth member added to `Phase` and not to `account_phase` makes a legitimate row unwritable while all six rejections still fire.

| | `0001`..`0066` | `0001`..`0067` |
|---|---|---|
| the probe | **RED at REJECTION 1**, five acceptances first | **11 of 11 PASS** |
| every `scripts/db/probe_*.sql` | **17 of 18** | **18 of 18** |

The failing line against `0001`..`0066`, verbatim:

```
ERROR:  PROBE FAILED: REJECTION 1: rule_states stored phase not_a_phase_at_all.
The engine's own per-day record admits a string the engine cannot produce, on
the table replay compares against.
```

and against `0001`..`0067` the same row is refused at the cast, `invalid_text_representation` (`22P02`) rather than `check_violation`: **an enum refuses before the row is a row.**

**ACCEPTANCE 5 EXECUTES `0048`'s `rewrite_rule_state` RATHER THAN REASONING ABOUT IT.** That function takes a `rule_states` ROWTYPE and derives its `UPDATE` from `pg_attribute` through `%I`, binding the row as `$1`, so a column type change is invisible to it by construction. **`0027` installed a function that was WRONG and still installed cleanly**, so the one path in the estate that writes this column through a rowtype is run.

**THE PROBE'S FIRST DRAFT WAS WRONG AND ONLY THE ACCEPTANCE HALF COULD SEE IT.** Its writer took the phase as a `text` parameter and bound it straight into the column. A `text` VARIABLE does not implicitly cast to an enum, so against `0001`..`0067` it failed at ACCEPTANCE 1 with `column "phase" is of type account_phase but expression is of type text` -- on `eval`, a phase the column accepts perfectly well. **Every rejection passed while the file was measuring PL/pgSQL's assignment rules rather than the column's vocabulary.** Casting the variable instead would have moved every rejection into the cast, which tests the TYPE and not the COLUMN and would stay green against a column moved back to `text`. The phase goes in as a LITERAL through `%L`, which is what an adapter and a hand-written `INSERT` both emit, so **the same file runs unchanged on both sides of `0067` and its verdict is the migration's.**

### `scoped-db.test.ts` refused this migration and was right to

**The suite went RED before the migration was believed, and the control that did it says in its own comment that this was its purpose.** `ADR-094` and [ADR-103](../../docs/decisions/ADR-103.md) close the fold's `ALTER COLUMN` sub-vocabulary at ONE shape, `DROP NOT NULL`, with a default of FAIL, on `ADR-094` item 3's rule against writing a rule for a shape with zero instances. Its inventory assertion reads: *"The day a fourth one lands -- a `SET DATA TYPE`, a `SET NOT NULL`, or a `DROP NOT NULL` on a third table -- this is RED and the next session reads the ruling before writing a regex."* **`0067` is that day and this is that session.**

`ADR-216` clause 5 adds the fold's **third member** the way `ADR-103` added its second: the comparison first, the vocabulary second. `retypedColumns` reads `ALTER COLUMN <name> TYPE` and `SET DATA TYPE` as one member and returns `null` on anything else; `withType` applies it to the folded definition and **throws on the two ways of applying nothing**, on `withoutNotNull`'s own argument. A new assertion holds that **exactly one of the two readers claims each statement**, because a reader widened until it matched everything would satisfy the inventory while folding `DROP NOT NULL` as a retype to the type `NULL`.

**REFUSING THE TYPE CHANGE BECAUSE A PARSER COULD NOT READ IT WOULD HAVE BEEN CHOOSING THE WEAKER SCHEMA GUARANTEE TO AVOID EXTENDING A TEST**, which is weakening a gate to pass it in the exact shape the standing refusals name. The vocabulary is closed because there had been nothing to rule on; the moment there is an instance, the rule is written against something.

**AND ADR-216'S MEMBER RUNS ON A REGISTERED TABLE ON THE DAY IT LANDS, WHICH `ADR-103`'S DID NOT.** That member shipped with no registered carrier and session 214 had to find the gap for `ADR-106` to close. `rule_states` has been registered since `ADR-094`, so the per-table TYPE-and-NULLABILITY comparison reads this column against the transcription immediately.

### 32.6 What `0067` leaves open, stated rather than glossed

**AFTER `0067`, `rule_states` HOLDS ONE ENGINE UNION AS A TYPE AND ANOTHER AS BARE `text` WITH A `CHECK`.** That is the shape `ADR-207` reason 2 named as worse than either uniform answer, now true in the other direction. **It is not hidden**: it is the second item on `ADR-216`'s approval block. The two are not symmetric, which is why it is not decisive -- `Phase` has a type in `0001` that names its members exactly and `BreachKind` has none, and creating one is the ruling `ADR-207` declined and `0067` does not take either way. **Uniformity bought by leaving this column unconstrained against a type that already spells it out is uniformity bought with the defect.**

**THE STATE HASH IS UNTOUCHED AND UNMOVED.** `phase` is input 3 of `ADR-026` `C-07`'s nineteen and stays input 3. `0067` changes the column's DOMAIN and not its value: every string this column could legally hold before it, it holds after it, byte for byte, so no stored hash could change. `ADR-207` section 5's open question about the three columns `0065` added is neither answered nor moved.

**IT DOES NOT BIND `rule_states.phase` TO `accounts.phase`.** Nothing does and nothing should: a per-day snapshot legitimately disagrees with the account's phase now, which is the whole reason the table has a grain. What `0067` guarantees is that the two draw from ONE vocabulary, by construction rather than by assertion.

**IT DOES NOT MOVE `accounts.phase` OR `account_phase`'s DEFINITION.** Both were refused explicitly; if the ruling implies either should move, that is a separate decision with its own number.

### 32.7 Registered rather than repaired, each with the fence that owns it

1. **`account_status_history.from_phase` and `to_phase` are bare `text NULL` with no `CHECK`**, beside `from_status` and `to_status` which are bare `text` against `account_status`, while `accounts` is declared against both types. [`schema.ts`](src/schema.ts)'s own entry for that table records the asymmetry and says *"That is `0007`'s shape and not this file's to repair."* **It is a log table rather than the table replay compares against**, which is a difference in consequence and not in kind. `0007` and that table are outside this fence.

2. **`RI-15` SEES A POINTER THAT LANDS ON NOTHING AND NOT ONE THAT LANDS ON THE WRONG THING.** `apps/worker/src/provisioning/vocabulary.ts:9` cited `schema.ts:3501` for the `provisioning_queue` type asymmetry; on `origin/main` that line sits inside the `graduation_invitations` comment, three hundred lines from the transcription it names. **The citation was already wrong and no invariant could see it.** `0067`'s edit to the `ruleStates` entry shifted the file and dropped `3501` onto a blank line, which is the only reason it went red. Repaired under the citation-repair right; **the finding about the invariant's reach is reported, because `RI-15` is not this fence.** **AND THIS SESSION'S OWN REPAIR THEN DRIFTED, WHICH IS THE SAME BLINDNESS MET FROM THE INSIDE.** The pointer was re-derived at `3867` and a LATER commit to `schema.ts` moved it eleven lines; `3867` then held a bare `//`, which is neither a blank line nor a closing bracket, so **`RI-15` stayed green on a pointer that was wrong.** Caught by re-deriving every citation after the last edit rather than by any runner, which is `DISPATCH_PROTOCOL` section 2's rule doing the work no check does. It reads `schema.ts:3878`.

3. **`ADR-207` SECTION 9 CALLED THIS COLUMN'S GAP THE OBVIOUS NEXT SLICE AND IT WAS.** Its own reason 2 turns on this column being bare `text`, so that reason is now historical. The entry is another session's ruling and is not amended here; `ADR-216` states which of its reasons transfer, which is the reading rather than an edit.

### Seeds, watched failing

**Eleven seeds against the committed shape, ten red and one green control**, each restored from a byte copy with SHA-256 checked both ways and `git status --porcelain` empty after every one. No seed was restored with `git checkout`.

| # | Seed | Result |
|---|---|---|
| 1 | a fifth member added to `Phase` in `types.ts` | **RED, 2 cases** |
| 2 | `account_phase` reordered in `0001`, `closed` and `graduated` swapped | **RED, 2 cases.** The two ORDERED comparisons; the set comparison stays green, which is that case's stated blindness measured rather than described |
| 3 | the `ruleStates` entry reverted to `text('phase')` | **RED, 2 cases, across two files.** A migration whose column the accessor types as an open string leaves every read of it wrong |
| 4 | `0067`'s target type changed to `text`, so the retype retypes nothing | **RED, 9 cases.** `withType` throws rather than folding a definition it did not move |
| 5 | a `CHECK` re-listing the vocabulary added to `0067` | **RED, 1 case.** The seventh copy the ruling refuses |
| 6 | the probe step deleted from `corpus.yml` | **RED, `CI-06h`**, 31 of 33 |
| 7 | the needle deleted from `gates.mjs`, probe left wired | **RED, `CI-06s`**, 32 of 33 |
| 8 | `Phase` renamed in `types.ts`, blinding the parser | **RED, by THROWING.** A derivation whose parse returns nothing must not compare two empty lists and report PASS |
| 9 | `graduated` deleted from the `schema.ts` `pgEnum` | **RED, 2 cases** |
| 10 | **CONTROL**: a comment reworded in `0067`, no identifier moved | **GREEN, 317 of 317** |
| 11 | `retypedColumns` widened until it also claims `DROP NOT NULL` | **RED, 4 cases**, on the overlap assertion written for exactly that |

**Three more were seeded into the live catalogue rather than into a file**, against `0001`..`0067`, each undone and the probe rerun clean:

| Seed | Result |
|---|---|
| a `CHECK` re-listing the vocabulary installed on `rule_states` | **RED at REJECTION 6**, quoting the constraint definition back |
| the column moved back to `text` | **RED at REJECTION 1.** Not at REJECTION 4, and that is correct: the row cases catch the regression first and the catalogue assertion is the backstop for a future where they are gone |
| `ALTER TYPE account_phase ADD VALUE 'probationary'` | **RED at REJECTION 5**, naming the widening that cannot be undone |

---

## 33. `0075` lands, and it is the first statement in this estate that changes a column rather than adding one (2026-08-30)

**Session 469, [ADR-278](../../docs/decisions/ADR-278.md), [ALLOCATION](../../docs/decisions/ALLOCATION.md) rows `278` and `0075`.** [`0045:103`](migrations/0045_simulation_runs.sql) declares `calibration_observed_at date NOT NULL`. [ADR-272](../../docs/decisions/ADR-272.md) clause 3 ruled the property that makes this a defect and not a preference: a column name may be SILENT about its temporal type and may not be FALSE about it. `*_at` is [ADR-146](../../docs/decisions/ADR-146.md) clause 2 asserting an RFC 3339 UTC instant, and this column is a day.

**[SESSION 463](../../docs/sessions/2026-08-30-session-463.md) SPECIFIED THIS RENAME AND DECLINED TO LAND IT**, because row `272` fenced neither `scripts/db/**` nor the two CI-wired probes that name the column sixteen times. That was the right call and this row is the one that fences them.

### What was verified, at the catalogue rather than by grep

`0001`..`0075` applied forward-only into an empty database under `ON_ERROR_STOP=1` against **PostgreSQL 16.13**, then read at `pg_attribute` and `pg_constraint`:

| Query | Result |
|---|---|
| `simulation_runs` columns named `calibration%`, after the set applies | `calibration_id text`, `calibration_digest bytea`, **`calibration_observed_on date NOT NULL` at ordinal 7** |
| columns named `calibration_observed_at` anywhere in `public` | **zero** |
| constraint definitions, index definitions or views naming the old column | **zero, measured before the migration was written**, which is why the rename carries no dependency and rewrites no heap |
| the column comment | present, `ADR-278, renaming 0045's calibration_observed_at ...` |
| object counts after the set | **118 tables, 410 indexes, 516 checks, 29 triggers**, unchanged by this file |
| re-applying `0001`, and re-applying `0075` alone | **both refused.** `0075` a second time reports `column "calibration_observed_at" does not exist`, which is the migration proving it is not idempotent by rerun |
| both CI-wired probes, run against the migrated database | **16 assertions each, all green**, `probe_simulation_decision_record.sql` and `probe_publish_decision_is_sound.sql` |

### The delta

| Delta | Table | Change | Migration | Status |
|---|---|---|---|---|
| `ADR-278` | `simulation_runs` | `calibration_observed_at` renames to `calibration_observed_on`; the column comment `0045` never wrote | 0075 | **landed** |

**No `SD-nn` and no `U-nn` is claimed**, on `0051`, `0064`, `0065`, `0066` and `0067`'s reasoning: this is a repair to a name, not a schema delta proposed by an approved module document. `0045` is NOT edited and its header stays exactly as written, including the three sentences that argue the `date` type under the old name, because a merged migration records what it did (constitution E2).

### The part a reader should carry forward, and it is not the rename

**BEFORE THIS FILE THE ESTATE HELD ZERO `RENAME COLUMN` AND ZERO `DROP COLUMN` STATEMENTS**, measured over all 68 migrations then on disk. Every reader in this repository that parses `packages/db/migrations` for "the columns the schema declares" builds that answer as the union of `CREATE TABLE` bodies and `ADD COLUMN` clauses, and until `0075` that union WAS the installed schema. It is not any more, and E2 guarantees it never will be again: the superseded declaration is permanent.

**Five readers were affected and only one of them names the column.** `RI-26` and the `ADR-216` fold in [`scoped-db.test.ts`](test/scoped-db.test.ts) each learned the rename, and the fold's `RENAME` refusal is what found itself: it was written to turn the suite red on exactly this shape so that the next session would read the ruling before writing a regex, and it did. [`ledger-posting-authority.test.ts`](../../apps/api/test/ledger-posting-authority.test.ts) pinned `0074` as the highest migration to prove a local absence and would have failed on any migration at all; it now asserts what its sentence means. **`dateColumns()` behind `CI-06m` still reads declarations**, which ADR-278 section 5 records as owed and the [`simulation_runs`](../../docs/architecture/data-model/simulation_runs.md) design record works around by carrying both names in one cell.
