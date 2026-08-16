---
status: review
depends_on: [../../docs/architecture/data-model/README.md, ../../docs/decisions/README.md]
last_updated: 2026-08-16
---

# Delta manifest

**The completeness gate reads this file.** [ADR-026](../../docs/decisions/ADR-026.md) requires that every `SD-nn` and `U-nn` appearing anywhere in `docs/` appears **exactly once** here with a disposition. A count nobody can drift is better than a count someone remembers to update.

<!--gen:manifest_changes-->105<!--/gen--> **schema changes in scope: 96 numbered, 7 unnumbered.** No delta was rejected. 100 land in the v1 core sequence and 3 in the marked reserved sequence.

**The count moved from 93 to 94 by founder ruling (2026-08-14).** `U-06` is the sixth unnumbered change, found while folding. [ADR-026](../../docs/decisions/ADR-026.md)'s table of five did not carry it. See section 5.

**It moved from 94 to <!--gen:manifest_changes-->105<!--/gen--> on 2026-08-16, with [ADR-039](../../docs/decisions/ADR-039.md) and [`0029`](migrations/0029_phone_identity_and_auth.sql).** Nine changes: eight numbered and `U-07`. See section 5a. **The total is a [CI-06g](../../docs/testing/STRATEGY.md) span now** and the split beside it is not, because no query parses the numbered and unnumbered halves apart; that split is prose and drifts like prose, which is the position [ADR-036](../../docs/decisions/ADR-036.md) records for the State column one registry over.

Migrations are sacred: once merged, never edited, only superseded. Greenfield rule: every delta is **folded at create**, not applied as a base-plus-ALTER chain, because the repository contains no application code and no database.

**This file has its own allocation table, and it is [section 16](#16-allocation-oi-nn-identifiers-and-section-numbers).** `OI-nn` identifiers and section numbers are claimed there before they are written, on [ADR-034](../../docs/decisions/ADR-034.md)'s rule. It is at the end rather than here because the sections are in numeric order and section 16 is a section; it is announced here because **the two collisions that produced it were both made by sessions reading this file from the top**.

## 1. The migration sequence

<!--gen:migration_files-->34<!--/gen--> files. Money-path files open with an `E2 READ: MONEY PATH` header naming what needs the founder's line-by-line read and why.
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
| SD-M4-04 | `sessions` | add `auth_factor`, `elevated_at`, `elevated_by_factor`. **C-27 is unenforceable without it**: a handler cannot refuse an SMS-established session for a sensitive action if the session never recorded how it was established | 0029 | **landed** |

`U-07` is in section 5 with the other unnumbered changes.

**One thing this fold's plan got wrong, recorded here rather than left for the next reader.** [FOLD-01 section 6.2](../../docs/plans/FOLD-01-phone-identity.md) says the fold adds "three new `### <table>` sections plus amended columns on **five** existing tables". It is **six**: `otp_challenges`, `sessions`, `contact_channels`, `identity_signals`, `notification_kinds` and `kyc_verifications`, each of which is a row in the plan's own section 4 table. Another instance of the hand-maintained-count class, this time inside an approved plan, written by the fold whose subject is that class of error. The count in [DATA_MODEL](../../docs/architecture/data-model/README.md)'s amendment header is the one taken from the diff.

**And no ordinal is claimed for it, because the ordinal has itself drifted.** The obvious sentence to write here was "the tenth hand-maintained count found wrong", on the arithmetic that section 12 records an eighth and [`0028`](migrations/0028_supersede_plan_version_immutability.sql)'s header records a ninth. **It is double-booked.** `grep -rn 'eighth\|[Nn]inth' packages/db docs --include=*.md --include=*.sql` returns **two different findings each claiming "eighth"** (section 12's `array_length` six-above-a-list-of-seven, and [Session 30](../../docs/sessions/2026-08-15-session-30.md)'s `INDEX` "140 entries" against 141) and **two each claiming "ninth"** (`0028`'s three-above-a-list-of-four, and Session 30's `INDEX` "257 scenarios"). **The tally of hand-maintained counts is a hand-maintained count, it collided the moment two branches recorded an instance in the same week, and it is exactly the ADR-034 race one registry over with no allocation table under it.** The class is real and the running total is not; this entry records the instance and stops there.

**Four more were found in the same pass and fixed rather than tallied.** All four were `0028` landing and nothing downstream moving: this file's section 1 said "27 files" above a 27-row table and the table stopped at `0027`, [DATA_MODEL](../../docs/architecture/data-model/README.md)'s amendment header said "94 approved schema changes" and "27 files", and its §17 said "The 27 files" and "Sixteen carry an `E2 READ`" **when STATE and INDEX had already converted that same E2 figure to a span after finding it wrong there** and this third copy was left behind. **Every one is now a [CI-06g](../../docs/testing/STRATEGY.md) span**, which is [ADR-034](../../docs/decisions/ADR-034.md)'s remedy: generate the number, or delete it and point at the source.

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

**`OI-nn` is claimed in [section 16](#16-allocation-oi-nn-identifiers-and-section-numbers) before the row is written, and so is a section number.** That table exists because this one collided: **two rows below are numbered `OI-06`**, written on the same day by two sessions that each read this section, each found `OI-05` as the maximum and each took `06`. They are **not renumbered**, they are cited with their subject attached, and section 16 records why.

| # | Item | Status |
|---|---|---|
| **OI-01** | **`liability_snapshots` exists in two shapes.** The migration (`0009`) follows `SD-M6-01`: keyed on `as_of timestamptz`, carrying `open_liability_cents`, `bounded_near_term_cents`, `remaining_ladder_exposure_cents`, `wallet_balances_cents`, `absorbed_corrections_cents`. [DATA_MODEL section 8](../../docs/architecture/data-model/README.md) still shows the earlier shape keyed on `snapshot_on date` with `funded_accounts`, `reserve_cents`, `cvar99_cents`, `rcr_bp` and `per_plan`. **The migration is the truth.** The four RCR and CVaR fields have **no home in the folded shape** and need one before [M06](../../docs/plans/M06-admin-ops-console.md) is built: the reserve coverage ratio is the number that decides whether sales pause | **OPEN**, founder ruling (2026-08-14) that it is tracked here |
| **OI-02** | **`published_statistics` cannot express three of the seven ruled statistics.** ST-04 publishes mean **and** median together and "neither is published alone"; ST-05 and ST-06 each publish **p50 and p95**. Two rows for one statistic, window and grain collide on `published_statistics_window_uq`, and no column distinguishes which figure a row carries. Proposed fix: a `measure` discriminator (`rate`, `total`, `mean`, `median`, `p50`, `p95`, `count`) on the table and in the index. **Applied** by [ADR-032](../../docs/decisions/ADR-032.md), together with **STAT-C1**, a deferred constraint trigger in `0027` asserting that a publish run emitting one measure emits every measure its definition declares. The column made the second figure writable; the trigger is what makes it required | **CLOSED** (2026-08-14) |
| **OI-03** | **`0026`'s append-only revoke list is a list, and a list drifts.** Eighteen tables are named there against [DATA_MODEL section 1](../../docs/architecture/data-model/README.md)'s Mutability set. The CI check must assert the revoke list **against the document** rather than trusting either | **OPEN**, CI not yet built |
| **OI-04** | **Two legitimate single-column updates on append-only tables** (`daily_marks.superseded_by`, `identity_links.suppressed`) are forbidden by the grants and require `SECURITY DEFINER` functions that **do not exist yet**. A naive first implementation of either transition fails at the grant, which is the correct failure and will look like a bug | **OPEN**, arrives with the owning module |
| **OI-05** | **`0027`'s published-plan-version immutability trigger reads `NEW.config`, and `plan_versions` has no `config` column.** The rule contract is `rules`. PL/pgSQL resolves record fields at execution, so the migration installs cleanly and the function is wrong only when it fires. **Proven by execution, not by reading**: every `UPDATE` against a published row raises `record "new" has no field "config"`. The immutability promise survives by accident, because the error rejects the write; **the ruled `published -> retired` transition is refused too, so no plan version can be retired.** A draft row updates normally, which is why the install check and every probe in section 10 missed it. **`0027` is merged and is not edited**: the fix is a superseding migration, which takes the set from 27 files to 28 | **CLOSED** 2026-08-15. [ADR-035](../../docs/decisions/ADR-035.md) **accepted**; fixed by `0028`, which carries an `E2 READ` header and still needs the founder's read. **Two amendments at acceptance are larger than the ADR as proposed** (the whole row is pinned rather than a list of columns, and a retired row is now frozen absolutely per STATE_MACHINES section 9). The structural fix is **[CI-06j](../../docs/testing/STRATEGY.md)**, which found it from the tree with no database |
| **OI-06** **(payout destinations)** | **The 48 hour payout-destination cooling window has no storage.** [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md) finding 5, found by trying to model (c) on the control (c) says to copy. `destination_ref` on `payout_transfers` (`0010:243`) and `wallet_withdrawals` (`0011:132`) is the destination **of a transfer**; **no table records that a destination changed or when**. C-11, C-24, [SECURITY section 4](../../docs/architecture/SECURITY.md) item 1, `WF-M20-02` and [M04](../../docs/plans/M04-trader-portal.md)'s destination-cooling scenario all cite a control whose input does not exist. **Recommendation, offered without deciding it**: a `payout_destinations` registry keyed on `(identity_id, destination_ref)` carrying `first_seen_at` and `cooling_until`, read by both payout legs and by the affiliate rail under C-24, in its own migration after its own session. **`0029` builds the phone hold on its own storage and does not touch this**, because folding a change nobody asked for into the diff the founder reads line by line is how a review stops being a review | **OPEN**, deliberately not decided |
| **OI-06** **(calendar prior image)** | **Nothing in the database forces an `UPDATE` to `trading_calendar` to write a `trading_calendar_revisions` row.** `0032` creates the prior-image table [ADR-042](../../docs/decisions/ADR-042.md) F-2 ruled and the loader writes to it; a hand-run `UPDATE` against the calendar leaves no prior image and `INV-04`'s replay is back where F-2 found it. **A trigger would make it a control rather than a rule somebody follows**, and `0027` is where the invariant triggers live. **ADR-042 is silent on it**, so `0032` does not add a money-path trigger on its own authority: per CLAUDE.md, silence means propose an ADR and proceed on approval. The same question covers whether a `DELETE` from `trading_calendar` should be forbidden outright, which today only the revisions foreign key partly prevents | **CLOSED** 2026-08-16. [ADR-045](../../docs/decisions/ADR-045.md) **accepted**; the guards are `CALENDAR-C1` and `CALENDAR-C2` in [`0033`](migrations/0033_trading_calendar_revision_required.sql), which carries an `E2 READ` header and still needs the founder's read. **The ruling is larger than the row as raised**: the `DELETE` half this row calls "the same question" is answered too, because `DELETE` then `INSERT` is an `UPDATE` with the audit trail removed, and `TRUNCATE` is named beside it because it fires no row triggers at all. **And `dependent_row_count` is now counted rather than reported**, which section 17 records as the half that was proven by watching a zero pass without it |
| **OI-07** | **`0029` has no committed probe.** [FOLD-01](../../docs/plans/FOLD-01-phone-identity.md)'s definition of done names `scripts/db/probe_phone_identity.sql`, and section 14 below records 48 assertions **executed** against the installed schema on 2026-08-16. They were executed ad hoc and are **not re-runnable in CI**, because the session brief's stop condition was the migration, its data-model files and its manifest rows. **That is the exact object section 13 names**: a probe that ships beside a fix and never runs again is the same thing as the golden test that was missing. Owed: the probe file, leading with the success case, plus its step in [`corpus.yml`](../../.github/workflows/corpus.yml) beside the ledger and ADR-035 probes | **CLOSED** 2026-08-16. [`scripts/db/probe_phone_identity.sql`](../../scripts/db/probe_phone_identity.sql), wired into CI-06h. Section 15 records what it asserts and how it was watched failing. **It leads with the success case and the ruling is a permission**: a second identity verifying a live number must COMPLETE, and an absence (no unique index on `phone_hash`) is asserted as an absence, because "completing the pair" looks like tightening a constraint in a diff. **The step is pinned by [CI-06h](../../scripts/corpus/gates.mjs)**, so deleting it is itself a gate failure: an unpinned probe is one delete away from the object this row exists to name |
| **OI-08** | **The NO-FLOATS `DO` block is positional, and everything after `0027` is outside it.** Section 9 says the assertion "fails the migration" if any column in `public` is `numeric`, `real` or `double precision` outside the two exempt ones. It lives in `0027` and therefore reads the schema **as of `0027`**: `0028` and `0029` both land after it, and **a future migration adding a `numeric` money column would sail past the guard the corpus believes protects it.** It was checked by hand for `0029` (section 14) and the set is still exactly the two `correlation_groups` columns. **Recommendation**: re-assert it in the install job after the whole set applies, beside the object-count derivation, so it is positionally last by construction rather than by whoever remembers. It is a two-line step and it belongs with the gate work, not inside a money-path migration | **CLOSED** 2026-08-16. [`scripts/db/assert_no_floats.sql`](../../scripts/db/assert_no_floats.sql), run in the install job after every migration applies, so it is positionally last **by construction**. **By the time it was fixed the gap had reached five migrations** (`0028` to `0032`), not the two this row was written against. `0027`'s block is **deliberately left in place**, per E2: migrations are sacred, once merged never edited. The exemption list is still exactly `correlation_groups.statistic` and `.threshold` on the full 32-file schema, **and it now fails in both directions with each direction watched firing** |
| **OI-09** | **`CI-06n` accepts a link in prose where its own title says a row.** The gate matches **any markdown link anywhere in a registry README**, so [ADR-043](../../docs/decisions/ADR-043.md) sat outside the ADR registry table for a day while being linked from a sentence in its preamble, and nothing reported it. Its `covers` line is honest ("is linked from") and its **title** is not, which is why a merged ADR could fall out of the registry it belongs to with twelve gates green. **The missing row is added; the gate is not narrowed here**, because narrowing it needs a sweep of every registry directory [ADR-043](../../docs/decisions/ADR-043.md) created plus a seeded violation it has been watched failing on, and this session's stop condition was `0033` | **OPEN**, and the first number allocated from section 16 |


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

**[`0029_phone_identity_and_auth.sql`](migrations/0029_phone_identity_and_auth.sql), [ADR-039](../../docs/decisions/ADR-039.md).** The full <!--gen:migration_files-->34<!--/gen-->-file set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP=1`, re-applying it is rejected, and the database reports **<!--gen:sql_tables-->102<!--/gen--> tables, 340 indexes, 381 check constraints, <!--gen:sql_triggers-->10<!--/gen--> triggers**. No file was edited to make that pass.

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

**The live figures on the whole set**, derived from the database rather than from a grep: **<!--gen:sql_tables-->102<!--/gen--> tables, 351 indexes, 397 check constraints, <!--gen:sql_triggers-->10<!--/gen--> triggers**, across <!--gen:migration_files-->34<!--/gen--> files. **The words "the full 32-file set" are gone from this sentence and the span beside them is not**, which is the same one-adjective correction section 12 records: the number is derived and the adjective was not, so `0033` landing would have made the sentence disagree with its own span. **The index and check figures are hand-maintained and were unmoved by `0033`**, which is luck rather than a control and is why section 17 re-derives all four.

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

**Claim the next free number here in the commit that opens the item.**

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

### Section numbers

**Claim the next free number here in the commit that writes the section.** Sections are append-only records of what landed and when, so the sequence only ever grows and the maximum is the only thing anybody needs.

| Section | Claimed by | State |
|---|---|---|
| 1 to 13 | the schema-delta fold and its follow-ons | **allocated** |
| **14** | **CLAIMED THREE TIMES, 2026-08-16, and left that way.** `0029`, then `0030` and `0031`, then `0032` | **allocated three times.** Cite as `section 14 (0029)`, `section 14 (0030 and 0031)`, `section 14 (0032)` |
| 15 | `OI-07` and `OI-08`'s closure | **allocated** |
| **16** | this session | **allocated.** This table |
| **17** | this session | **allocated.** `0033` lands |

**`4a` is a section and not a number**, inserted between 4 and 5 to record FOLD-01's deltas without disturbing what cites 5. It is the escape hatch when a section belongs in the middle, and it is recorded here so the next session finds it before inventing a second one.

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

**All <!--gen:migration_files-->34<!--/gen--> files apply forward-only from empty against PostgreSQL 16.13 with `ON_ERROR_STOP`, zero errors**, and the counts are read from `pg_tables`, `pg_indexes`, `pg_constraint` and `pg_trigger` rather than from a grep:

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
| Three sealed columns, three times | `*_ciphertext`, `*_key_id`, `*_encrypted_at` on `contact_channels`, `identity_phones` and `phone_change_requests`, each with a completeness `CHECK` and a partial index serving the rotation sweep |
| `merit_dispatcher` | The fourth role. `0026` created three and none of them is a sending path, and **you cannot withhold `DELETE` from a principal the database cannot name** |
| The evidence foreign keys | `prior_notified_at` may not be set without citing an `integration_dispatches` row **and** a `notifications` row, both `ON DELETE RESTRICT`, both **explicitly named** |
| The identity-match trigger | Both cited rows belong to the same identity as the request. Separately rejectable |

### Install verification, from empty

**All <!--gen:migration_files-->34<!--/gen--> files apply forward-only from empty against PostgreSQL 16.13 with `ON_ERROR_STOP`, zero errors**, and the counts are read from the catalogue rather than from a grep:

| | Before `0034` | After `0034` |
|---|---|---|
| Tables | 102 | **102** |
| Indexes | 351 | **354** |
| Check constraints | 397 | **401** |
| Foreign keys | 141 | **143** |
| Triggers | 9 | **10** |

**No table moves, and that is the shape of the change.** `OQ-M10-06` is not a missing entity. It is three tables that each held a value they could recognise and not use, so the fix is columns beside the columns that were already right, plus the one thing a column cannot be: a role.

### The probe

[`scripts/db/probe_reversible_contact_addresses.sql`](../../scripts/db/probe_reversible_contact_addresses.sql), **27 assertions, 27 / 27**, wired into `CI-06h`'s job as step 10. Eleven are successes, on section 13's lesson: a probe that only attempts forbidden things passes perfectly against a guard that refuses everything.

**Half of what it proves is a grant, which no other probe in this job touches.** A migration that grants `DELETE` by accident installs cleanly, satisfies every constraint in the file, and is wrong in the exact way the founder's amendment exists to prevent. So six assertions `SET LOCAL ROLE merit_dispatcher` and attempt the write: **a catalogue query proves what was written and an attempted write proves what the database will do.**

| # | Assertion | What it proves |
|---|---|---|
| **S1** | A contact channel with **no ciphertext at all** | Every row written before `0034`. A `NOT NULL` would have refused them and forced a backfill to invent ciphertext for addresses nobody has |
| **S2** | A sealed address beside its hash | The shape `OQ-M10-06` asked for |
| **S3** | Resealed under a new key id | Rotation, which is the entire reason `UPDATE` survived the amendment |
| **S4** | **Erasure: the three columns clear and the row stays** | **The assertion the amendment rests on.** Withholding `DELETE` is defensible only if erasure is expressible without it |
| **S4b** | The `value_hash` survived the erasure | An erasure that took the hash would disarm `INV-M16-03` **through the privacy path**, which is the trade this design refuses |
| **S5pre** | The change request opens with a sealed new number | See the counterfactuals: this was a bare fixture `INSERT` until a seeded run showed why it must be a labelled one |
| **S5a** | Evidence cited with **no** `prior_notified_at` yet | Why the `CHECK` is one-directional. The two legs do not land in the same instant |
| **S5** | **The ceremony reaches `applied` with both legs evidenced** | The positive control. A tightening that refuses the legitimate path is worse than the gap it closed |
| **S6, S7, S8** | `merit_dispatcher` reads a sealed address, rotates it, records a dispatch | `SELECT`, `UPDATE`, `INSERT`: the three verbs the amendment keeps |
| **R1, R2** | Ciphertext with no key id; a key id of whitespace | An unopenable blob every rotation sweep skips and every reader believes is an address. The blank case is `trading_calendar_revisions.reason`'s argument: an empty string satisfies `NOT NULL` and answers nothing |
| **R3, R4** | The same `CHECK` on the other two tables | A constraint written three times can be omitted once, and the omission is one missing paragraph in a five-hundred-line file |
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

### Eight counterfactuals, each watched failing on its own finding

| Seeded schema | Result |
|---|---|
| `0034` absent entirely | **`S2` fails**: `column "value_ciphertext" of relation "contact_channels" does not exist`. One assertion runs. The probe cannot pass vacuously against a schema with none of this in it |
| The identity-match trigger dropped | **`R7` reports the write was ACCEPTED.** Thirteen assertions pass first, which is what makes `R7` the one that owns that half |
| `phone_change_requests_prior_notice_is_evidenced` dropped | **`R5` fails.** `EC-146`'s remedy, watched being absent |
| **Table-wide `UPDATE`** instead of column-scoped | **`R14` reports `merit_dispatcher rewrote value_hash`.** Twenty-four assertions pass first: every constraint is intact and the role can disarm the countermeasure anyway |
| `DELETE` granted to `merit_dispatcher` **after** the `REVOKE` | **`R12` reports `merit_dispatcher DELETED a contact channel`** |
| `<>` instead of `IS DISTINCT FROM` | **`R9` fails and nothing else does.** Fifteen assertions pass, including `R7` and `R8` |
| A `CHECK` that **refuses everything** | **`S5pre` fails.** The positive control catching what an inventory of refusals cannot see from inside itself |
| `0026`'s `ALTER DEFAULT PRIVILEGES` line copied to this role | **`R16` reports `merit_dispatcher read identity_signals`.** Twenty-six assertions pass first |

### The `REVOKE` was described as decoration, and the seeded run proved otherwise

**The ninth counterfactual is the one that changed the file.** The trailing `REVOKE DELETE ... FROM merit_dispatcher` was written with a comment calling it "a statement rather than a mechanism", on the reasoning that nothing above it grants `DELETE`, so it revokes a privilege the role does not hold and changes no catalogue row.

**Then the seed added `DELETE` to the grant list above it and the probe still passed, all 27 assertions.** The `REVOKE` had already taken it back. **A privilege granted earlier in this file cannot survive to `COMMIT`**, which makes it a real control against the likeliest mistake: an absent-minded verb added to a grant list somebody was already editing. The comment now says that, and the seed was rewritten to add the grant **after** the `REVOKE`, which is how the defect actually arrives, and `R12` catches that one.

**This is the third time in three days that a claim written into a comment was wrong in the direction of understating a control, and the second time execution rather than review found it.** The rule it argues for is not "write more careful comments". It is that a seeded violation is worth running even when you are confident you know what it will say.

### What `0034` does not do

**It does not touch `otp_challenges`.** An OTP is challenge-response: the trader types the number into the request, so the address is held by the request and is deliverable today. `destination_hash` stays one-way. The exposed class is every message **Merit itself initiates**.

**It does not prove the notice was addressed to the prior number.** `integration_dispatches` records `fields_sent` and never values (`INV-M10-03`), so no column anywhere holds a dispatch's destination, and adding one would make the audit record of a disclosure into a second copy of the thing disclosed. `GS-265`'s wording is "addressed to the prior channel" and the database can assert the citation and the identity, not the address.

**It does not scope `merit_app`'s read.** PostgreSQL cannot subtract a column from a table-level `SELECT`, and the alternative is a hand-maintained column list. The key is the control; the sidecar table that would make the grant the control is named in [ADR-046](../../docs/decisions/ADR-046.md) and is not built here.

**It does not backfill.** Every row written before `0034` has a hash and no ciphertext, and sealing one requires the plaintext, which for a **prior** address Merit does not have. **The backfill is forward-only by construction** and the addresses already lost stay lost.

**And there is no gate.** `CI-06h`'s job runs the probe, which proves this schema. Nothing asserts that the **next** table carrying an address hash arrives with a sendable sibling, or that a later migration has not granted `DELETE` to this role. Both are checkable and neither is claimed here, because a gate arrives with a `CI-06` letter and a seeded violation it has been watched failing on.
