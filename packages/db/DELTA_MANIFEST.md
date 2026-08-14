---
status: review
depends_on: [../../docs/architecture/DATA_MODEL.md, ../../docs/DECISIONS.md]
last_updated: 2026-08-14
---

# Delta manifest

**The completeness gate reads this file.** [ADR-026](../../docs/DECISIONS.md) requires that every `SD-nn` and `U-nn` appearing anywhere in `docs/` appears **exactly once** here with a disposition. A count nobody can drift is better than a count someone remembers to update.

**94 schema changes in scope: 88 numbered, 6 unnumbered.** No delta was rejected. 91 land in the v1 core sequence and 3 in the marked reserved sequence.

**The count moved from 93 to 94 by founder ruling (2026-08-14).** `U-06` is the sixth unnumbered change, found while folding. [ADR-026](../../docs/DECISIONS.md)'s table of five did not carry it. See section 5.

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
| 0021 | `transparency` | narrow | `statistic_definitions`, `published_statistics`, `review_requests`, `proof_links` |
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
| SD-M12-01 | new `statistic_definitions` | a statistic is a choice of denominator | 0021 | **landed** |
| SD-M12-02 | new `published_statistics` | append-only, with numerator and denominator | 0021 | **landed** |
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

## 5. The six unnumbered changes

Rulings the schema did not yet express. **Five of the six were invisible because nobody was counting**, and the sixth was miscited to a delta that means something else. This is the reason a count matters.

| # | Change | Source | Migration | Status |
|---|---|---|---|---|
| U-01 | new `identity_signal_weights` | ADR-022, M07 D-16 | 0025 | **landed**, **reserved** (ADR-022 tiers it to v1.x) |
| U-02 | `accounts.graduation_eligible` | ADR-024, M01 R-49 | 0007 | **landed** |
| U-03 | new `ledger_halts`, identity-scoped with an escalation clock | ADR-016, M05 INV-M5-16 | 0016 | **landed** |
| U-04 | `identity_signals.kind` gains `footprint_enrichment` | ADR-023, M07 D-15 | 0002 | **landed** |
| U-05 | `kyc_verifications.placement` check widened to the ruled trigger set | ADR-021 | 0003 | **landed** |
| **U-06** | `provisioning_status` gains **`confirmed_inferred`**, plus the binding that `set_risk` may never reach it | M02 section 3.2, AS-M2-03 | 0001 (value), 0007 (binding CHECK) | **landed** |

**`U-06` was found while folding and is the sixth unnumbered change.** The approved [DATA_MODEL section 6](../../docs/architecture/DATA_MODEL.md) declares `provisioning_status` with five values; [M02 section 3.2](../../docs/plans/M02-rithmic-bridge.md) adds a sixth and makes it a distinct state rather than a synonym, and AS-M2-03 makes it **binding that a `set_risk` operation may never reach it**. That is a schema change to an approved document with no delta number, which is the definition of an unnumbered change.

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
| **OI-01** | **`liability_snapshots` exists in two shapes.** The migration (`0009`) follows `SD-M6-01`: keyed on `as_of timestamptz`, carrying `open_liability_cents`, `bounded_near_term_cents`, `remaining_ladder_exposure_cents`, `wallet_balances_cents`, `absorbed_corrections_cents`. [DATA_MODEL section 8](../../docs/architecture/DATA_MODEL.md) still shows the earlier shape keyed on `snapshot_on date` with `funded_accounts`, `reserve_cents`, `cvar99_cents`, `rcr_bp` and `per_plan`. **The migration is the truth.** The four RCR and CVaR fields have **no home in the folded shape** and need one before [M06](../../docs/plans/M06-admin-ops-console.md) is built: the reserve coverage ratio is the number that decides whether sales pause | **OPEN**, founder ruling (2026-08-14) that it is tracked here |
| **OI-02** | **`published_statistics` cannot express three of the seven ruled statistics.** ST-04 publishes mean **and** median together and "neither is published alone"; ST-05 and ST-06 each publish **p50 and p95**. Two rows for one statistic, window and grain collide on `published_statistics_window_uq`, and no column distinguishes which figure a row carries. Proposed fix: a `measure` discriminator (`rate`, `total`, `mean`, `median`, `p50`, `p95`, `count`) on the table and in the index. **Not applied**: it changes what a published, append-only, publicly-restated row *is* | **OPEN**, needs the founder's read of `0021` |
| **OI-03** | **`0026`'s append-only revoke list is a list, and a list drifts.** Eighteen tables are named there against [DATA_MODEL section 1](../../docs/architecture/DATA_MODEL.md)'s Mutability set. The CI check must assert the revoke list **against the document** rather than trusting either | **OPEN**, CI not yet built |
| **OI-04** | **Two legitimate single-column updates on append-only tables** (`daily_marks.superseded_by`, `identity_links.suppressed`) are forbidden by the grants and require `SECURITY DEFINER` functions that **do not exist yet**. A naive first implementation of either transition fails at the grant, which is the correct failure and will look like a bug | **OPEN**, arrives with the owning module |

## 9. NO-FLOATS EXEMPTION LIST

**Constitution and [DATA_MODEL section 1](../../docs/architecture/DATA_MODEL.md): money is `bigint` integer cents, ratios are integer basis points, never `numeric` and never a float, in any financial path.**

**Three columns in this schema are non-integer. Every one is a ruled exemption rather than a local judgment, and the list is asserted rather than documented.**

```
correlation_groups.statistic
correlation_groups.threshold
published_statistics.value_numeric
```

**The assertion lives in `0027_triggers_invariants.sql`** as a `DO` block that reads `information_schema.columns` and **fails the migration** if the set of `numeric`, `real` or `double precision` columns in `public` is anything other than exactly those three. It asserts in **both directions**: an unlisted column fails, and so does a stale entry naming a column that no longer exists, because an allowlist wider than the schema quietly grants more than it names.

**Verified to bite**, not merely to run: adding a rogue `numeric` column and re-running `0027` fails with `NO-FLOATS: liability_snapshots.rogue_rate is not on the exemption list`.

| Column | Ruling |
|---|---|
| `correlation_groups.statistic` | **Exempt.** A correlation coefficient is not money and is not a ratio of two integers Merit controls. Rounding it to cents or to basis points is the actual error |
| `correlation_groups.threshold` | **Exempt**, same reason, and it must be the same type as the statistic it is compared against |
| `published_statistics.value_numeric` | **Exempt as authorized**, and see the note below |

### Scope correction: two columns shipped outside the authorization

`published_statistics.numerator` and `.denominator` shipped as `numeric` and **were never authorized**. Both are now `bigint`. The reasoning, because it is a ruling and not a cleanup:

- **The denominator is a COUNT in all six statistics that have one**, and ST-03 has none at all because it is a total rather than a rate. It is compared against `min_sample` (250 on ST-01, 100 on ST-02, 50 elsewhere), **which is an integer**. A `numeric` denominator permits `249.7`, which is not a number of accounts, and **a sample gate decided on a rounding is a sample gate that does not gate**.
- **The numerator is one of exactly three things across the seven definitions, and all three are integers**: a count (ST-01, ST-02, ST-07), **integer cents** (ST-03 and ST-04 are a sum of `trader_cents`), or a whole-second duration (ST-05, ST-06). **The cents case is the one that matters: that is MONEY, and it does not stop being money because it is being published.** `numeric` there is the case DATA_MODEL section 1 names directly.
- **`numerator_unit` is forced by the type change, not added alongside it.** DATA_MODEL section 1 makes a quantity column with no unit a review reject, and a `bigint` numerator is otherwise ambiguous between cents and a count on a surface Merit cannot restate quietly.

### Note on `published_statistics.value_numeric`, for the founder

**It is on the authorized list and is left as authorized.** On inspection it does not require the exemption: **all seven ruled statistics are exactly representable as integers under the corpus's own conventions** (ST-01/02/07 rates in basis points, ST-03/04 money in integer cents, ST-05/06 durations in whole seconds). For ST-03 and ST-04 this column currently holds **money on a public surface**.

Tightening it to `bigint` plus the same unit discriminator the numerator now carries is a one-line change. **Removing an authorized exemption is not a call to make without asking**, so it is recorded and not applied.
