---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, OVERVIEW.md, data-model/README.md, ../decisions/ADR-039.md, ../plans/FOLD-01-phone-identity.md]
last_updated: 2026-08-27
---

# Events (Constitution §2 "everything is an event")

Every event Merit emits: name, payload schema, producer, consumers. One append-only [`events`](data-model/events.md) table drives the admin feed, analytics, lifecycle messaging, audit, and the [evidence pack](../GLOSSARY.md#evidence-pack). Terms are defined in [GLOSSARY.md](../GLOSSARY.md).

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
| `identity.restricted` | Admin | `{ identity_id, restriction_episode_id, flag_id, reason, tos_clause, evidence_pack_id, sla_due_at }` | FEED, MAIL, EVID, ALERT |
| `identity.restriction_lifted` **NEW** | Admin | `{ identity_id, restriction_episode_id, restored_by, restore_evidence, restored_at }` | FEED, MAIL, NOTIF, EVID, ALERT |
| `identity.payouts_frozen` | Admin | `{ identity_id, reason, tos_clause, flag_ids[] }` | FEED, NOTIF, EVID, ALERT |
| `identity.payouts_unfrozen` | Admin | `{ identity_id, resolution_note }` | FEED, NOTIF, EVID |
| `kyc.required` | API per placement config | `{ identity_id, placement }` | MAIL, NOTIF, BI |
| `kyc.submitted` | Provider webhook | `{ identity_id, provider, provider_applicant_id }` | FEED, BI |
| `kyc.verified` | Provider webhook | `{ identity_id, provider_applicant_id, document_country, verified_at }` | FEED, MAIL, TL, BI, EVID |
| `kyc.rejected` | Provider webhook | `{ identity_id, rejection_reason_code }` | FEED, MAIL, RISK, ALERT |
| `kyc.expired` | Worker | `{ identity_id, expired_at }` | MAIL, NOTIF |
| `kyc.dedupe_hit` | Provider webhook | `{ identity_id, matched_identity_id, provider }` | RISK, ALERT, EVID |
| `phone.verified` | API on verification | `{ identity_id, phone_id, line_type, carrier_country, ported, footprint_present, lookup_provider, is_reassignment_candidate }` | FEED, TL, RISK, EVID, BI |
| `phone.change_requested` | API | `{ identity_id, change_request_id, old_phone_id, withdrawal_hold_until }` | FEED, TL, NOTIF, RISK, EVID |
| `phone.reassignment_detected` | Worker on the recycling guard | `{ identity_id, phone_id, prior_phone_id, last_ported_at, release_evidence_ref, resolved }` | RISK, ALERT, EVID |
| `sms.budget_breaker_tripped` | Worker on `otp_send_budget` | `{ scope_kind, scope_key, evaluated_on, state, sends, send_limit, spend_cents, budget_cents, deferred_registrations }` | ALERT, FEED, BI, EVID |

`kyc.dedupe_hit` is the fleet-killer signal from the [adversary dossier](../../research/ADVERSARY_DOSSIER.md) scheme 6. It fires before any liability exists, which is the entire point of verifying pre-funded.

**`identity.restriction_lifted` closes a gap that had existed since `identity.restricted` was written, and [ADR-041](../decisions/ADR-041.md) is what made it load-bearing.** `identity.payouts_frozen` has `identity.payouts_unfrozen` beside it; the restriction had **nothing**. So `G-RESTRICTION-LIFTED` was a transition with no event, against [STATE_MACHINES](STATE_MACHINES.md) universal rule 1, and **the hold half of three consumers worked while the release half did not**: [M02](../plans/M02-rithmic-bridge.md) could not re-enable trading, [M06](../plans/M06-admin-ops-console.md) could not put the restore on the feed, and [M08](../plans/M08-affiliate-system.md) could not release a held statement. **That failure presents as a trader who was cleared and is still locked out**, which is the worst version of it, because every operator involved believes the restore happened.

**Both restriction events now carry `restriction_episode_id`, and the episode row is the authority rather than either payload.** `identity.restricted` deliberately carries **no account list** while `enforcement.applied` does, and the asymmetry is correct: the set of accounts an identity holds can change between the two events, so a consumer must resolve the set **at consume time** rather than trust a payload written earlier. `sla_due_at` is carried because a restriction opened over a held payout inherits that payout's deadline, and a consumer rendering the restriction without it will render an enforcement that looks open-ended when it is not.

**The four phone and SMS events are [ADR-039](../decisions/ADR-039.md)'s, and both [M16](../plans/M16-notification-center.md) and [M07](../plans/M07-risk-abuse.md) consume them.** Four things about their payloads are decisions rather than shapes.

**No payload carries a number, a hash of one, or a preview of one.** The convention in §1 forbids PII in a forever-retained table, and a phone number is the most re-identifying field Merit holds. `phone_id` references the row; anything sensitive is fetched through an authorized read at display time. This is stricter than it looks: `identity_phones.phone_preview` exists and is deliberately not carried here, because "enough to recognise" in a permanent event stream is enough to correlate.

**`phone.verified` fires on the second identity too, and `is_reassignment_candidate` is why it can.** `INV-M19-13` rules that a second identity verifying a live number **completes**, writes the edge at the hard-link confidence ceiling and opens a severity-5 flag against both, changing no state. The event is therefore emitted on an ordinary success and on a contested one, and the flag carries the difference. **The trader-facing surfaces never see that field**, because telling either party about the other is what `AS-M19-05` counter 4 forbids.

**`phone.reassignment_detected` carries `resolved` and it is the field the investigation needs.** The recycling guard has three outcomes and only one is a release: the port date falls after the restriction date and the prior row is released with evidence; the port date falls before it and the link stands; or **there is no portability record at all**, which is `EC-143`'s residual and leaves a severity-5 flag open with nothing enforced. A boolean that flattened the third case into the second would make the corpus unable to count the cases the vendor could not answer, which is the number `DEP-M19-09` is judged on.

**`sms.budget_breaker_tripped` is an ALERT event first and that is a ruling, not an ordering.** [ADR-039](../decisions/ADR-039.md)'s breaker **degrades rather than stopping**, and a degraded mode nobody is watching becomes the normal mode. `otp_send_budget_degraded_is_alarmed` refuses to store a silent trip at the schema level and this is the same obligation on the event side. It fires on the trip, on the degraded window and on the recovery, distinguished by `state`, and it carries `deferred_registrations` because **the number of registrations that completed unverified during the window is a reported figure**: a queue nobody drains is a fail-open with extra steps. `EC-142`, `GS-271`.

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
| `payout.win_days_reset` | Worker on settlement | `{ account_id, previous_count, reset_to: 0, trigger_payout_id, anchor_trading_day }` | TL, EVID |
| `payout.held` **NEW** | API (engine) | `{ payout_request_id, account_id, identity_id, hold_flag_id, tos_clause, hold_expires_at, approved_cents, payout_ordinal, plan_version_id }` | FEED, TL, MAIL, NOTIF, EVID, ALERT |
| `payout.hold_released` **NEW** | Worker (the expiry sweep), Admin | `{ payout_request_id, account_id, identity_id, released_by: "expiry"\|"actor", actor?, hold_flag_id, held_at, hold_expires_at }` | FEED, TL, MAIL, NOTIF, BI, EVID |
| `payout.hold_enforced` **NEW** | Admin | `{ payout_request_id, account_id, identity_id, hold_flag_id, tos_clause, evidence_pack_id, reason, freed_ordinal }` | FEED, TL, MAIL, NOTIF, BI, EVID, ALERT |
| `payout.expiry_overdue` **NEW** | Worker (the nightly assertion) | `{ subject_kind: "payout_hold"\|"payout_freeze"\|"withdrawal_freeze", subject_id, account_id?, identity_id, expires_at, overdue_seconds }` | ALERT, FEED, EVID |
| `payout.balance_reflection_missing` **NEW** | Worker (the observation window) | `{ payout_request_id, account_id, approved_cents, settled_trading_day, trading_days_elapsed }` | ALERT (page), RISK, FEED, EVID |
| `payout.freeze_expiring` **NEW** | Worker (the hourly sweep) | `{ payout_request_id, flag_id, expires_at, lead_hours }` | ALERT, FEED |
| `wallet.withdrawal_halted` **NEW** | Admin, detector | `{ withdrawal_id, identity_id, freeze_flag_id, tos_clause, freeze_expires_at, rail_status }` | FEED, TL, NOTIF, EVID, ALERT |
| `wallet.withdrawal_halt_released` **NEW** | Worker (the expiry sweep), Admin | `{ withdrawal_id, identity_id, released_by: "expiry"\|"actor", actor?, rail_status }` | FEED, TL, NOTIF, EVID |
| `payout.floor_recomputed` | **retired, no producer** | `{ account_id, mode, previous_floor_cents, new_floor_cents }` | none |
| `rule.floor_locked` | Engine, via the batch, R-15 | `{ account_id, trading_day, at_profit_cents, locked_floor_cents }` | TL, EVID, RISK, BI |
| `rule.soft_dll_exceeded` | Engine, via the batch, R-23 | `{ account_id, trading_day, realized_pnl_cents, limit_cents }` | RISK, TL |

**Three amendments from the M1 gate (2026-08-13).** `rule.floor_locked` and `rule.soft_dll_exceeded` are added: the first because the lock permanently changes an account's risk profile and belongs on the trader timeline and in the evidence pack, the second so that enabling a soft daily loss limit is a config change rather than a code change (no v1 plan configures one). `payout.floor_recomputed` is **retired** rather than deleted, because [ADR-014](../decisions/ADR-014.md) removed the post-payout floor recompute and left it with no producer. The name stays in the catalogue with its payload intact so that a reader who finds it in an old design note learns it is dead, instead of concluding the catalogue is incomplete. `payout.win_days_reset` gains `anchor_trading_day`, because "reset to zero" without the anchor does not explain the next cycle.

There is no `payout.denied` event in this catalogue, and that absence is deliberate: the system has no path that produces one. `payout.blocked` exists only for the three pre-existing conditions a trader can see coming (frozen account under investigation, unresolved reconciliation, KYC not verified) and for a request that simply has not cleared its gates yet.

**Six events are added by [ADR-040](../decisions/ADR-040.md), and `payout.held` is not `payout.blocked` under a second name.** `payout.blocked` says the request was refused and no row is outstanding; `payout.held` says the request exists, carries a full evaluated decision, and **has a deadline**. Collapsing them would put a state with a clock into the vocabulary of a state without one.

**Every hold event carries its own expiry in the payload**, which is unusual for this catalogue and is the point: a consumer that renders the trader-facing status must show the date the hold resolves, and one that has to join back to `payout_requests` to find it will eventually render the hold without it. [M05](../plans/M05-payout-system.md) section 3.4's rule governs, **a review the trader cannot see the end of is indistinguishable from a refusal**, and the payload is where that rule becomes hard to get wrong.

**`payout.hold_released` names who released it, and `expiry` is a first-class value rather than a null actor.** The two cases are operationally different, since one is the SLA working and the other is a human deciding early, and a release with no actor is otherwise indistinguishable from a release whose actor was not recorded.

**`payout.expiry_overdue` is the only event here produced by an assertion rather than by a state change**, which is a deliberate exception to this document's own delivery rule. Every other event is written in the same transaction as the fact it records, so the event exists if and only if the fact does. **This one records that a fact did NOT happen**, and there is no transaction for an absence. It is the alarm that fires on the query rather than on the job ([EC-151](../edge-cases/EC-151.md)), it is the fourth unsuppressible alarm, and its `subject_kind` is what lets one assertion cover all three clocks the hourly sweep carries.

**`payout.freeze_expiring`'s LEAD IS SET HERE AT TWELVE WALL-CLOCK HOURS, and setting it is this row's whole cost.** [M05](../plans/M05-payout-system.md) `OQ-M5-07` says in terms that the value is set where the event is written, and this is that file. The old lead was two business days, which [ADR-040](../decisions/ADR-040.md) left degenerate by closing the window at 48 hours and [ADR-042](../decisions/ADR-042.md) left uncomputable by ruling that Merit quotes business days and never derives them: a lead that long inside a window that short fires at or before the moment the hold opens, so the warning and the thing it warns about arrive together. Twelve hours leaves three quarters of the window elapsed before anyone is asked to decide. **The counter-argument is real and is not answered by a longer lead**: a hold opened at 21:00 warns at 09:00 and expires at 21:00, so a single-operator firm gets one working day and no more, and the remedy for that is the alarm being unsuppressible rather than earlier. **`lead_hours` is in the payload because the lead is a launch parameter and not a constant**, and a 2031 audit reading a 2027 row has no other way to know which lead produced it. `payout.balance_reflection_missing` is beside it as the other alarm [M05 section 5](../plans/M05-payout-system.md) names and this catalogue lacked; it pages, it sets `recon_blocked`, and **the payout it reports is never reversed** ([EC-066](../edge-cases/EC-066.md)).

**The wallet halt gets events and does not get a status**, because on `wallet_withdrawals` the halt is orthogonal to the rail state. `rail_status` is carried in the payload for exactly that reason: a halted withdrawal is still `approved` or `transferring` as far as the rail is concerned, and a consumer that infers the halt from the status will infer wrong. **These were the first `wallet.*` rows in this catalogue and they are no longer the only ones.** The gap this paragraph recorded, the three names [STATE_MACHINES section 3.2](STATE_MACHINES.md)'s transition table already carried and this catalogue did not, is closed in 6.2 below together with the rest of the family. **The refusal that left it open still governs what was folded**: every payload in 6.1 to 6.3 is a mirror a plan names or a column a migration declares, and the one transition in that drawing with no event at all is reported in 6.2 rather than given a name here.

### 6.1 The wallet, which is where the internal leg lands

**[ADR-019](../decisions/ADR-019.md) split the payout into two legs and the first one ends here**, so `wallet.credited` is the event a trader experiences as being paid and [M11](../plans/M11-certificates-social-proof.md) issues the payout certificate on it rather than on `payout.settled`. Both rows are named in [M05 section 5](../plans/M05-payout-system.md) and both are stored by [`wallet_entries`](../../packages/db/migrations/0011_wallet.sql), whose columns are what the payloads carry.

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `wallet.credited` **NEW** | API (the internal leg), worker (a refund or a correction) | `{ identity_id, provenance: "payout"\|"refund_wallet_funded"\|"correction", amount_cents, cause, reference_id, balance_after_cents, ledger_transaction_id, account_id?, payout_request_id?, basis_trading_day? }` | FEED, TL, NOTIF, BI, EVID |
| `wallet.debited` **NEW** | API at checkout, API at withdrawal approval | `{ identity_id, amount_cents, cause, reference_id, balance_after_cents, ledger_transaction_id }` | FEED, RISK, BI |

**`wallet.credited` gains `provenance` and three of M05's fields become conditional on it, and that is an amendment made at the fold rather than a transcription.** [`0011`](../../packages/db/migrations/0011_wallet.sql) declares `wallet_entries.provenance` `NOT NULL` over a closed list of three, of which only `payout` has a payout request, an account or a basis trading day; M05's payload names all three unconditionally, so **two of the three storable credits could not produce it**. Carrying the discriminator is section 1's own rule that a payload is ids and numbers, applied to a row whose kind is a column. `wallet_entries` carries no `account_id` of its own, so `account_id` on a payout credit is resolved through `reference_id` at write time and is carried because TL in section 2's legend is a per-account view and would otherwise have to join to find one.

**`balance_after_cents` is not the identity's balance and a consumer must not read it as one.** It is [`0011`](../../packages/db/migrations/0011_wallet.sql)'s stored running balance **after this entry**, written so a statement renders without a window function and so a divergence from the recomputed value is detectable. A consumer that treats it as the current balance will be wrong the moment a second entry posts, which is the same trap `day.closed`'s `occurred_at` sets in section 1.

**`wallet.debited` has no `provenance` and that asymmetry is correct.** Provenance is what value is MADE of, and it is a property of a credit; a debit consumes a composition rather than having one. `cause` and `reference_id` are polymorphic on the debit side by [`0011`](../../packages/db/migrations/0011_wallet.sql)'s own comment, *"payout_request, purchase, or the corrected entry"*, and the withdrawal composition a debit does destroy is reported by `wallet.withdrawal_approved` in 6.2, on the row that has the summary.

### 6.2 The withdrawal lifecycle, which is the external leg of the wallet

**[STATE_MACHINES section 3.2](STATE_MACHINES.md) draws this machine and names its events; this is where those names become real.** [M05 section 5](../plans/M05-payout-system.md) rules the shape of the family in one sentence, *"mirrors the `payout.transfer_*` family for the wallet-to-rail path"*, and every payload below is either that mirror or a column of [`wallet_withdrawals`](../../packages/db/migrations/0011_wallet.sql).

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `wallet.withdrawal_requested` **NEW** | API | `{ withdrawal_id, identity_id, amount_cents, destination_ref, idempotency_key, requested_at }` | FEED, TL, NOTIF, BI |
| `wallet.withdrawal_cooling` **NEW** | API | `{ withdrawal_id, identity_id, destination_ref, cooling_until }` | FEED, TL, NOTIF |
| `wallet.withdrawal_approved` **NEW** | API | `{ withdrawal_id, identity_id, amount_cents, destination_name_match, name_match_score, name_match_method, source_provenance_summary, earliest_credit_at }` | FEED, TL, NOTIF, EVID |
| `wallet.withdrawal_held` **NEW** | API (the composition) | `{ withdrawal_id, identity_id, rule: "P-1"\|"P-3", source_provenance_summary, earliest_credit_at, expected_release_at }` | ALERT, NOTIF, FEED, EVID |
| `wallet.withdrawal_sent` **NEW** | Worker | `{ withdrawal_id, identity_id, amount_cents, idempotency_key, ledger_transaction_id }` | FEED |
| `wallet.withdrawal_settled` **NEW** | Rail webhook | `{ withdrawal_id, identity_id, amount_cents, provider_transfer_id, settled_at, ledger_transaction_id }` | FEED, TL, MAIL, NOTIF, BI, STATS, EVID |
| `wallet.withdrawal_failed` **NEW** | Rail webhook, worker | `{ withdrawal_id, identity_id, error_code, attempts, will_retry }` | ALERT, FEED, NOTIF |

**`destination_ref` is admissible under section 1 and the reason is written in the column itself.** [`0011`](../../packages/db/migrations/0011_wallet.sql) declares it *"Provider-side destination id, never bank details"*, which puts it in the same class as `provider_applicant_id` on `kyc.submitted` and `provider_transfer_id` on `payout.settled`: an opaque reference this catalogue already carries. It is carried rather than omitted because **one destination reference appearing under two identities is a signal no other event in this family can express**, and RISK is the consumer that needs it.

**`wallet.withdrawal_held` is not `wallet.withdrawal_halted` under a second name, and the pair is the wallet's version of the distinction section 6 already draws between `payout.held` and `payout.blocked`.** The hold is [M20](../plans/M20-wallet.md)'s provenance rule, `P-1` or `P-3`, evaluated **before** the rail is reached and resolving on a date arithmetic can produce; the halt is an investigation opened against a withdrawal **already past approval**, resolving on `freeze_expires_at` or on a dismissal, and it changes no rail status at all. Two events, two clocks, two authorities. Collapsing them would make the trader-facing copy unable to say which one is running, and [M05](../plans/M05-payout-system.md) section 3.4's rule is that a review the trader cannot see the end of is indistinguishable from a refusal.

**`expected_release_at` is [M20](../plans/M20-wallet.md)'s `expected_release` with the timestamp said out loud**, which matters in a table read in 2031 by a consumer that has only the field name.

**`cooling_until` is the one field below that is not a column today**, and it is named unlinked because the destination registry that will carry it is `payout_destinations`, which `P5-e` writes. Until it exists the value is [ADR-017](../decisions/ADR-017.md)'s window applied to the destination change, and the field is here because a cooling event that does not say when cooling ends is a status with no clock.

**`wallet.withdrawal_sent` fires on the edge `G-TRANSFER-QUEUED` guards, so it fires when the transfer is QUEUED and not when the rail acknowledges it.** The name is [STATE_MACHINES section 3.2](STATE_MACHINES.md)'s and this catalogue does not rename a drawn transition; the payload is what keeps the difference legible, because it carries the idempotency key and the posted ledger transaction and it carries no provider transfer id. There is none yet. On the payout leg that same distinction is two events, `payout.transfer_queued` and `payout.transfer_sent`, because that machine draws two edges and this one draws one.

**One transition in [STATE_MACHINES section 3.2](STATE_MACHINES.md) has no event and it is not folded here.** `cancelled` is a live `wallet_withdrawal_status` value in [`0001`](../../packages/db/migrations/0001_extensions_and_enums.sql), the drawing's own diagram takes two edges into it under `G-TRADER-CANCELS`, and that guard is defined in section 10; the transition **table** below the diagram carries no row for either edge, so universal rule 1 is unmet and no name exists for this catalogue to register. The gap is recorded rather than filled, for the reason this section's own halt note gave: a name invented here would be a row nobody ruled on, and the row that is missing is a transition row in a table this fold does not hold.

### 6.3 The wallet's own guards, its assertion, and dormancy

**[M20 section 5](../plans/M20-wallet.md) names these and each one is a control reporting on itself.** `wallet.withdrawal_held` belongs to this set by content and is rowed in 6.2 instead, beside the machine it stops.

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `wallet.spend_delayed` **NEW** | API at checkout | `{ identity_id, amount_cents, limit_kind, retry_at }` | RISK, NOTIF, FEED |
| `wallet.spend_refused` **NEW** | API at checkout | `{ identity_id, reason: "frozen"\|"cross_identity"\|"insufficient" }` | RISK, FEED |
| `wallet.provenance_anomaly` **NEW** | Detector | `{ identity_id, pattern, window_days }` | ALERT, RISK, EVID |
| `wallet.reconciliation_failed` **NEW** | Worker (the nightly per-identity assertion) | `{ identity_id, expected_cents, actual_cents }` | ALERT (page), FEED, EVID |
| `wallet.dormancy_changed` **NEW** | Worker | `{ identity_id, state: "active"\|"dormant"\|"escheat_review" }` | NOTIF, FEED |

**`wallet.spend_delayed` and `wallet.spend_refused` are two events because `C-23` makes the velocity limit DELAY rather than refuse.** A limit that refused would be indistinguishable from an insufficient balance to every consumer, and the burst of delays on one identity is [M20](../plans/M20-wallet.md)'s stated account-takeover signature, which only exists as a signal if the delayed case has its own name. `retry_at` is carried for the same reason every hold event in section 6 carries its expiry: a delay with no visible end is a refusal to the person waiting.

**A cross-identity spend attempt is evidence rather than a validation error**, which is why `cross_identity` is a first-class value of `reason` rather than a case of `insufficient`. [M20](../plans/M20-wallet.md) `AS-M20-06`'s argument is that a trader cannot construct that request through the interface by accident, so an attempt is a high-severity signal and RISK is the first consumer listed.

**`expected_cents` and `actual_cents` are section 1's money convention applied to a payload that reached this fold spelled `expected` and `actual`.** They are integer cents on a per-identity wallet position and the catalogue's own rule is that money in a payload lives in a `_cents` field. `window_days` on `wallet.provenance_anomaly` is the same repair against the same rule, and it matches `cusum.alarm` and `affiliate.chargeback_rate_updated` in sections 8 and 9, which both already spell it that way.

**`wallet.reconciliation_failed` pages and it is the wallet's version of `ledger.invariant_violated`, one scope down.** The global zero-sum assertion in section 7 balances while a per-identity position is wrong, which is [M20](../plans/M20-wallet.md) `FM-M20-10`'s whole point: a wallet-shaped hole is invisible in a global sum that still adds up. It is an [ADR-016](../decisions/ADR-016.md) scoped-halt input rather than a global halt, and the difference between the two is the difference between stopping one identity's withdrawals and stopping everyone's.

**`wallet.dormancy_changed` has a third consumer this catalogue has no code for, and that is stated rather than dropped.** [M20](../plans/M20-wallet.md) lists NOTIF, FEED *"and the legal calendar"*: an escheatment obligation is jurisdictional, dated, and owed to a party outside this system, and `INV-M20-09` makes forfeiture unavailable, so the transition into `escheat_review` is the input to a process section 2's legend cannot name. The state values are [`SD-M20-04`](../plans/M20-wallet.md)'s own `check`, transcribed rather than chosen.

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
| `treasury.coverage_changed` **NEW** | Worker on an RCR threshold crossing, worker on a recorded rail balance | `{ rcr_bp, reserve_cents, cvar99_cents, eligible_next_7d_cents, source, as_of }` | ALERT, FEED, BI |

**`treasury.coverage_changed` sits beside `liability.snapshot_taken` because the two carry three of the same figures and are not the same fact.** The snapshot is the nightly job recording where the book stood; the coverage event fires when the ratio CROSSES a threshold or when a live rail balance is recorded, and [ADR-011](../decisions/ADR-011.md)'s same-day top-up trigger reads it. The two exist separately because a top-up trigger that only fired once a night would be a dashboard somebody remembers to open, which is the failure [M05](../plans/M05-payout-system.md) section 7 names. `source` is what distinguishes them at the consumer: the reserve figure is computed against a **live rail balance** under `SD-M5-03`, because a ratio derived from Merit's own ledger is one that agrees with itself.

**The payload carries `rcr_bp` and carries no float figure, and a consumer therefore cannot recompute the ratio from it.** That is faithful to [M05 section 5](../plans/M05-payout-system.md) and it is worth naming, because the ratio's two sides are answered in different documents: wallet float enters the DENOMINATOR as exposure ([M06](../plans/M06-admin-ops-console.md) `P-M6-07`) and never the NUMERATOR as reserve ([M20](../plans/M20-wallet.md) `INV-M20-08`), and [P5 section 5.3](../plans/P5-payouts-and-wallet.md) is where the three sources were read together. An alert that renders float inside reserve flatters the ratio, which is `AS-M20-08`'s whole scenario, and this payload gives a consumer no field with which to make that mistake or to check it.

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
| `payout.held` | The fact, the ToS clause, and **the date it resolves** | always send. The fact, the clause and the date, never the evidence and never the detector. [M04](../plans/M04-trader-portal.md)'s copy rule binds: it is **never worded as a rejection** |
| `payout.hold_released` | Released and paying, with the amount | none. It is the good news and it is the message that closes the loop the hold opened |
| `identity.restriction_lifted` | Access restored, and what is available again | always send. **A restore nobody was told about is, from the trader's side, still a restriction** |
| `account.graduated` | Ladder complete and live invitation | none |
| `kyc.rejected` | What to do next | never state the provider's internal reason verbatim |

Suppression rules exist because a commiseration email to someone we just restricted reads as either incompetence or mockery.

## 12. Open questions

1. **`day.closed` volume: RESOLVED at the Wave 2 gate (2026-08-13).** The **full mark payload** is carried in the event, not a thin pointer. At 5,000 active accounts that is roughly 1.25M rows per year in `events` on top of `daily_marks`, and it is the right price: the account timeline and the [evidence pack](../GLOSSARY.md#evidence-pack) both reconstruct from the event stream alone, without joining to state that may since have been superseded by a correction. An event that points at a mutable row proves nothing in 2031.
2. **Public stats derived from events (STATS consumers).** Confirm which aggregates go on the public page at launch: trailing pass rate, payouts paid, average payout, and average time to first payout are the candidate set. (Still open; M12 owns it.)
3. **`identity.signal_observed`** is high volume and low value individually. Proposed: emit only on first observation of a signal per identity, not on every re-observation. (Still open; M7 owns it.)
