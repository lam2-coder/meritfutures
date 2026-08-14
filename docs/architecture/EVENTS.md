---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, OVERVIEW.md, DATA_MODEL.md]
last_updated: 2026-08-13
---

# Events (Constitution §2 "everything is an event")

Every event Merit emits: name, payload schema, producer, consumers. One append-only [`events`](DATA_MODEL.md#events) table drives the admin feed, analytics, lifecycle messaging, audit, and the [evidence pack](../GLOSSARY.md#evidence-pack). Terms are defined in [GLOSSARY.md](../GLOSSARY.md).

## 1. Conventions

**Naming.** `subject.verb_past_tense`, lower snake within each segment: `payout.settled`, `breach.detected`, `ingest.file_quarantined`. The subject is the thing the event is about, not the module that produced it.

**Payloads carry ids and numbers, never PII.** No email addresses, no names, no document data, no card details, no IP addresses inside a payload. An event references `identity_id` and `account_id`; anything sensitive is fetched through an authorized read at display time. This keeps the forever-retained table free of the data a privacy deletion request would have to reach into.

**Money and ratios** in payloads follow the same rules as the schema: integer cents in `_cents` fields, basis points in `_bp` fields.

**Versioning.** Every event row stores `schema_version`. A payload may add optional fields at the same version; any removal, rename, or semantic change increments the version and both shapes stay readable forever, because consumers include a 2031 audit reading a 2027 row.

**Time.** `occurred_at` is when the fact happened (often a session close, not the insert time). `recorded_at` is when we learned it. Corrections make these differ, and analytics that confuse them will silently lie.

**Correlation.** Every multi-step flow carries a `correlation_id` so a saga reads as one thread: checkout through provisioning, or request through settlement.

**Delivery.** Events are written in the same transaction as the state change that caused them, so an event exists if and only if the fact does. Consumers (email, analytics, Discord alerts) read the table and are at-least-once; every consumer is idempotent on `event.id`.

**No event is a command.** Consumers may act, but the event never instructs. Nothing in this catalogue triggers money movement by itself; money moves through the ledger inside the originating transaction.

## 2. Consumer legend

| Code | Consumer | What it does with events |
|---|---|---|
| FEED | Admin event feed (M6) | renders the operational timeline |
| TL | Account timeline (M6 drill-down, M4 portal) | per-account chronological view |
| MAIL | Lifecycle email (M10) | journeys, triggers |
| BI | Metabase on read replica (M10) | funnels, cohorts, payout health |
| RISK | Detectors (M7) | signal inputs |
| ALERT | Discord/ops alerting (M10) | pages and warnings |
| EVID | Evidence pack (M6) | included verbatim in exports |
| NOTIF | Notification center (M16) | in-app and push |
| STATS | Public transparency page (M12) | aggregates only, never per-trader |

## 3. Identity and verification

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `identity.created` | API on first user | `{ identity_id, source: "signup"\|"purchase" }` | FEED, BI |
| `identity.signal_observed` | API, worker | `{ identity_id, kind, value_hash_prefix, first_seen }` | RISK, EVID |
| `identity.linked` | Detector, admin | `{ identity_a, identity_b, link_kind, confidence_bp, evidence_ref }` | FEED, RISK, EVID |
| `identity.merged` | Admin, resolver | `{ surviving_identity_id, merged_identity_id, accounts_at_merge, reason }` | FEED, RISK, EVID, ALERT |
| `identity.restricted` | Admin | `{ identity_id, reason, tos_clause, evidence_pack_id }` | FEED, MAIL, EVID, ALERT |
| `identity.payouts_frozen` | Admin | `{ identity_id, reason, tos_clause, flag_ids[] }` | FEED, NOTIF, EVID, ALERT |
| `identity.payouts_unfrozen` | Admin | `{ identity_id, resolution_note }` | FEED, NOTIF, EVID |
| `kyc.required` | API per placement config | `{ identity_id, placement }` | MAIL, NOTIF, BI |
| `kyc.submitted` | Provider webhook | `{ identity_id, provider, provider_applicant_id }` | FEED, BI |
| `kyc.verified` | Provider webhook | `{ identity_id, provider_applicant_id, document_country, verified_at }` | FEED, MAIL, TL, BI, EVID |
| `kyc.rejected` | Provider webhook | `{ identity_id, rejection_reason_code }` | FEED, MAIL, RISK, ALERT |
| `kyc.expired` | Worker | `{ identity_id, expired_at }` | MAIL, NOTIF |
| `kyc.dedupe_hit` | Provider webhook | `{ identity_id, matched_identity_id, provider }` | RISK, ALERT, EVID |

`kyc.dedupe_hit` is the fleet-killer signal from the [adversary dossier](../../research/ADVERSARY_DOSSIER.md) scheme 6. It fires before any liability exists, which is the entire point of verifying pre-funded.

## 4. Commerce

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `checkout.started` | API | `{ identity_id, plan_version_id, size_cents, coupon_id?, affiliate_id? }` | BI |
| `coupon.claimed` | API | `{ coupon_id, identity_id, claim_id }` | BI, RISK |
| `coupon.claim_released` | API, worker | `{ coupon_id, identity_id, claim_id, reason }` | BI |
| `purchase.paid` | PSP webhook | `{ purchase_id, identity_id, plan_version_id, size_cents, amount_paid_cents, psp, kind }` | FEED, MAIL, BI, STATS, RISK |
| `purchase.failed` | PSP webhook | `{ purchase_id, psp, decline_code }` | BI, ALERT (MID health) |
| `purchase.refunded` | PSP webhook | `{ purchase_id, amount_cents, reason }` | FEED, BI |
| `purchase.charged_back` | PSP webhook | `{ purchase_id, identity_id, amount_cents, reason_code }` | FEED, RISK, ALERT, EVID |
| `plan_version.published` | Admin | `{ plan_id, plan_version_id, version, sizes[] }` | FEED, BI, STATS |
| `plan_version.retired` | Admin | `{ plan_version_id, retired_at }` | FEED |

`purchase.charged_back` is the trigger for the automatic closure, flag, and ledger reversal. It is also what updates the referring affiliate's chargeback rate, which is the affiliate-coordinated-fraud signal the dossier surfaced.

## 5. Account lifecycle and the nightly batch

### 5.1 Provisioning

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `account.provision_requested` | API after payment | `{ account_id, identity_id, plan_version_id, size_cents, platform }` | FEED, TL |
| `account.provisioning_file_written` | Worker | `{ account_id, file_name, operations[] }` | FEED |
| `account.provisioned` | Worker on confirmation | `{ account_id, platform, platform_account_ref, entitlements[], permissions[] }` | FEED, TL, MAIL, BI |
| `account.provision_failed` | Worker | `{ account_id, operation, error, attempts }` | ALERT, FEED |
| `account.entitlement_disabled` | Worker hygiene job | `{ account_id, entitlement, reason }` | FEED, BI (cost) |

`account.provision_failed` after payment is the paid-not-provisioned exception. It alerts within five minutes, because a trader who paid and cannot trade is a refund and a review, in that order.

### 5.2 The daily cycle

`day.closed` is the highest-volume meaningful event and the backbone of the account timeline. One per account per [trading day](../GLOSSARY.md#trading-day).

```jsonc
// day.closed, schema_version 1
{
  "account_id": "uuid",
  "trading_day": "2026-11-27",           // exchange trading day, not a UTC date
  "opening_balance_cents": 5000000,
  "closing_balance_cents": 5014250,
  "high_balance_cents": 5021000,
  "low_balance_cents": 4996500,
  "realized_pnl_cents": 14250,
  "fill_count": 6,
  "traded_day": true,
  "win_day": false,                       // realized_pnl_cents >= win_day_floor_cents
  "floor_cents": 4750000,
  "floor_locked": false,
  "withdrawable_cents": 0,
  "win_days_count": 2,
  "traded_days_count": 7,
  "eligible": false,
  "gate_results": {                       // mirrors rule_states.gate_results
    "min_trading_days": { "pass": true,  "have": 7, "need": 5 },
    "win_days":         { "pass": false, "have": 2, "need": 5 },
    "buffer":           { "pass": false, "have_cents": 14250, "need_cents": 100000 },
    "consistency":      { "pass": true,  "best_day_share_bp": 2100, "max_bp": 3000, "skipped": false },
    "cadence_gap":      { "pass": true,  "days_since_last_payout": null, "need": 5 },
    "kyc_verified":     { "pass": true }
  },
  "engine_version": "1.0.0",
  "source_hash": "hex",
  "is_half_day": false,
  "halted": false
}
```

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `day.closed` | Batch (engine) | above | TL, BI, RISK, EVID, STATS |
| `phase.passed` | Batch (engine) | `{ account_id, from_phase: "eval", to_phase: "funded", trading_day, closing_balance_cents, target_cents, consistency: { best_day_share_bp, max_bp, satisfied } }` | FEED, TL, MAIL, NOTIF, BI, STATS, EVID |
| `phase.pass_deferred_consistency` | Batch (engine) | `{ account_id, trading_day, best_day_share_bp, max_bp, shortfall_cents }` | TL, NOTIF, MAIL |
| `breach.detected` | Batch (engine) | below | FEED, TL, MAIL, NOTIF, BI, RISK, EVID |
| `account.expired` | Batch | `{ account_id, trading_day, expiry_rule }` | TL, MAIL |
| `account.closed` | Batch, admin, chargeback handler | `{ account_id, reason, closed_on, actor_kind }` | FEED, TL, MAIL, BI, EVID |
| `account.graduated` | Batch (engine) | `{ account_id, payouts_settled_count, ladder_target, closed_on }` | FEED, TL, MAIL, NOTIF, BI, STATS |
| `account.live_invitation_issued` | Batch | `{ account_id, identity_id, issued_on }` | FEED, MAIL, BI |

```jsonc
// breach.detected, schema_version 1
{
  "account_id": "uuid",
  "trading_day": "2026-11-27",
  "breach_kind": "trailing_eod_floor",   // or "static_floor" | "hard_daily_loss_limit"
  "low_balance_cents": 4738000,
  "floor_cents": 4750000,
  "shortfall_cents": 12000,               // floor - low, always positive on breach
  "phase_at_breach": "funded",
  "auto_liquidated_by_platform": true,    // from the vendor EOD report where present
  "platform_trigger_note": "vendor text", // provisional: shape depends on report fields
  "engine_version": "1.0.0"
}
```

Breach uses strict `<` against the floor: touching the floor exactly is not a breach, and the golden tests assert that boundary. Day ordering is binding: ingest, then breach, then progression, so a breach and a pass on the same day resolve to breach.

### 5.3 Ingest, reconciliation, and self-audit

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `ingest.file_received` | Worker | `{ ingest_file_id, file_name, sha256, byte_size, kind }` | FEED |
| `ingest.file_applied` | Worker | `{ ingest_file_id, trading_day, row_count, accounts_touched }` | FEED, BI |
| `ingest.file_quarantined` | Worker | `{ ingest_file_id, reason, line_number?, row_count_seen }` | ALERT, FEED |
| `ingest.file_late` | Worker | `{ expected_trading_day, expected_by, elapsed_minutes }` | ALERT |
| `ingest.correction_received` | Worker | `{ account_id, fill_id, correction_of, trading_day, delta_cents }` | ALERT, RISK, EVID, TL |
| `recon.mismatch_detected` | Worker | `{ account_id, trading_day, our_balance_cents, platform_balance_cents, delta_cents }` | ALERT, FEED, EVID |
| `recon.resolved` | Admin | `{ account_id, trading_day, resolution_note, resolved_by }` | FEED, EVID |
| `replay.divergence_detected` | Worker self-audit | `{ account_id, trading_day, field, stored, recomputed, engine_version }` | ALERT, FEED, EVID |
| `batch.started` / `batch.completed` | Worker | `{ run_id, trading_day, accounts_total, accounts_done, duration_ms }` | ALERT, BI |
| `batch.failed` | Worker | `{ run_id, stage, account_cursor, error }` | ALERT |

`ingest.correction_received` and `replay.divergence_detected` are the two events that must never be quiet. A correction that changes a settled payout's basis is absorbed and never clawed back (B4 #5), but it is always flagged, always evidenced, and always visible in the account timeline.

## 6. Payouts

```jsonc
// payout.approved, schema_version 1 (the single most audited event in the system)
{
  "payout_request_id": "uuid",
  "account_id": "uuid",
  "identity_id": "uuid",
  "payout_ordinal": 3,
  "requested_cents": 200000,
  "approved_cents": 150000,               // min(requested, withdrawable, cap)
  "clamp_reason": "cap",                  // "none" | "cap" | "withdrawable"
  "trader_cents": 135000,                 // split_bp applied at ledger level
  "firm_cents": 15000,
  "split_bp": 9000,
  "cap_cents": 150000,
  "withdrawable_cents": 214250,
  "basis_trading_day": "2026-11-27",      // the last closed day the decision used
  "plan_version_id": "uuid",
  "gate_results": { "...": "same shape as day.closed.gate_results, all true" },
  "engine_version": "1.0.0",
  "ledger_transaction_id": "uuid"
}
```

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `payout.requested` | API | `{ payout_request_id, account_id, identity_id, requested_cents, idempotency_key }` | FEED, BI |
| `payout.approved` | API (engine) | above | FEED, TL, MAIL, NOTIF, BI, STATS, EVID |
| `payout.blocked` | API | `{ account_id, identity_id, blocker: "frozen"\|"recon"\|"kyc"\|"ineligible", gate_results }` | FEED, TL, NOTIF, EVID |
| `payout.transfer_queued` | Worker | `{ payout_request_id, transfer_id, idempotency_key, amount_cents }` | FEED |
| `payout.transfer_sent` | Worker | `{ transfer_id, provider, provider_transfer_id }` | FEED |
| `payout.settled` | Rise webhook | `{ payout_request_id, transfer_id, provider_transfer_id, amount_cents, settled_at, ledger_transaction_id }` | FEED, TL, MAIL, NOTIF, BI, STATS, EVID |
| `payout.transfer_failed` | Rise webhook, worker | `{ transfer_id, error_code, attempts, will_retry }` | ALERT, FEED, NOTIF |
| `payout.name_mismatch_detected` | Worker | `{ payout_request_id, identity_id, kyc_name_hash, rise_name_hash }` | ALERT, RISK, EVID |
| `payout.win_days_reset` | Worker on settlement | `{ account_id, previous_count, reset_to: 0, trigger_payout_id }` | TL, EVID |
| `payout.floor_recomputed` | Worker on settlement | `{ account_id, mode, previous_floor_cents, new_floor_cents }` | TL, EVID |

There is no `payout.denied` event in this catalogue, and that absence is deliberate: the system has no path that produces one. `payout.blocked` exists only for the three pre-existing conditions a trader can see coming (frozen account under investigation, unresolved reconciliation, KYC not verified) and for a request that simply has not cleared its gates yet.

## 7. Ledger

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `ledger.transaction_posted` | API, worker | `{ ledger_transaction_id, kind, reference_kind, reference_id, entries: [ { ledger_account_code, amount_cents } ], sums_to_zero: true }` | FEED, BI, EVID |
| `ledger.invariant_violated` | Nightly assertion | `{ scope: "transaction"\|"global", transaction_id?, sum_cents }` | ALERT (page), FEED |

`ledger.invariant_violated` halts payouts. It is the one event whose consumer is allowed to change system behavior automatically, because a ledger that does not sum to zero means we no longer know what we owe.

## 8. Risk and enforcement

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `flag.raised` | Detector | `{ flag_id, identity_id, account_id?, flag_type, severity, detector, detector_version, evidence_summary }` | FEED, ALERT (sev >= 4), EVID |
| `flag.status_changed` | Admin | `{ flag_id, from_status, to_status, actor, note }` | FEED, EVID |
| `enforcement.applied` | Admin | `{ identity_id, account_ids[], action: "restrict"\|"close", tos_clause, evidence_pack_id, reason }` | FEED, MAIL, BI, EVID, ALERT |
| `evidence.pack_exported` | Admin | `{ evidence_pack_id, account_id, requested_by, reason, content_sha256 }` | FEED, EVID |
| `detector.run_completed` | Worker | `{ detector, detector_version, trading_day, rows_scanned, flags_raised, duration_ms }` | BI, ALERT on failure |
| `circuit_breaker.tripped` | Worker | `{ scope: "plan"\|"global", plan_id?, metric: "loss_ratio"\|"rcr", value_bp, threshold_bp, action: "pause_new_sales" }` | ALERT, FEED, BI |
| `circuit_breaker.reset` | Admin, worker | `{ scope, plan_id?, metric, value_bp }` | ALERT, FEED |
| `cusum.alarm` | Worker | `{ plan_id, statistic, threshold, window_days }` | ALERT, FEED |
| `liability.snapshot_taken` | Worker | `{ snapshot_on, open_liability_cents, eligible_next_7d_cents, reserve_cents, rcr_bp }` | BI, FEED |

Every enforcement carries an `evidence_pack_id`. That is not a nicety: the [dossier](../../research/ADVERSARY_DOSSIER.md) documents rings that pressure firms publicly after being caught, and the firm that cannot show its work loses the argument regardless of being right.

## 9. Affiliate

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `attribution.created` | API at purchase | `{ attribution_id, purchase_id, affiliate_id, model }` | BI, FEED |
| `attribution.voided` | API, detector | `{ attribution_id, reason: "self_purchase"\|"chargeback"\|"admin" }` | BI, RISK, FEED |
| `commission.accrued` | Worker | `{ commission_id, affiliate_id, amount_cents, payable_after }` | BI |
| `commission.paid` | Worker | `{ commission_id, affiliate_id, amount_cents, transfer_ref }` | BI, FEED |
| `affiliate.statement_issued` | Worker | `{ statement_id, affiliate_id, period_start, period_end, total_cents }` | MAIL, BI |
| `affiliate.chargeback_rate_updated` | Worker | `{ affiliate_id, rate_bp, window_days }` | RISK, ALERT above threshold |

## 10. The evidence pack: which events constitute it

An [evidence pack](../GLOSSARY.md#evidence-pack) for an account is a deterministic, hash-stamped export. It is a **launch requirement**, not a later nicety. Contents, in order:

1. **Account identity block:** account, identity, resolved links at export time, KYC state and verification dates (status and references only, never documents).
2. **Contract block:** the pinned `plan_version` including full `rules` JSON and the `copy_blocks` that were published with it, so the rules as marketed and the rules as executed are both in the pack.
3. **Chronology:** every event for the account in `occurred_at` order, specifically including every `day.closed`, `phase.passed`, `breach.detected`, `ingest.correction_received`, `recon.*`, `payout.*`, `flag.*`, and `enforcement.applied`.
4. **Raw substrate:** the `fills` rows with their `ingest_file_id` and file digests, plus the `daily_marks` including any superseded rows and what superseded them.
5. **Computation traces:** `rule_states` per trading day with `engine_version` and `gate_results`, and for each payout the immutable `eligibility_snapshot`.
6. **Human record:** `admin_actions` touching the account, with actor, reason, before, after.
7. **Manifest:** SHA-256 of the pack content, generation timestamp, requester, and stated reason, recorded as `evidence.pack_exported`.

The pack is reproducible: regenerating it for the same account and the same as-of time produces the same digest, because every input is append-only.

## 11. Event-driven lifecycle messaging (M10 triggers)

| Trigger event | Message | Guard |
|---|---|---|
| `account.provisioned` | Welcome and platform setup | none |
| `phase.passed` | Congratulations, funded, what changes now | none |
| `phase.pass_deferred_consistency` | Explain the dilution mechanic honestly | throttle to once per account per week |
| `breach.detected` | Commiseration plus reset offer | suppress if the identity is restricted or has an open severity 4+ flag |
| `payout.approved` | Approved instantly, settlement window | none |
| `payout.settled` | Paid, with the amount and the rail | none |
| `payout.transfer_failed` | Honest status and what happens next | always send; silence is what kills payout trust |
| `account.graduated` | Ladder complete and live invitation | none |
| `kyc.rejected` | What to do next | never state the provider's internal reason verbatim |

Suppression rules exist because a commiseration email to someone we just restricted reads as either incompetence or mockery.

## 12. Open questions

1. **`day.closed` volume: RESOLVED at the Wave 2 gate (2026-08-13).** The **full mark payload** is carried in the event, not a thin pointer. At 5,000 active accounts that is roughly 1.25M rows per year in `events` on top of `daily_marks`, and it is the right price: the account timeline and the [evidence pack](../GLOSSARY.md#evidence-pack) both reconstruct from the event stream alone, without joining to state that may since have been superseded by a correction. An event that points at a mutable row proves nothing in 2031.
2. **Public stats derived from events (STATS consumers).** Confirm which aggregates go on the public page at launch: trailing pass rate, payouts paid, average payout, and average time to first payout are the candidate set. (Still open; M12 owns it.)
3. **`identity.signal_observed`** is high volume and low value individually. Proposed: emit only on first observation of a signal per identity, not on every re-observation. (Still open; M7 owns it.)
