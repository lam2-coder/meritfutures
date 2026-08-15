## EC-012 to EC-033: the Appendix B4 battery

`EC-(011 + n)` is B4 item `n`. Each maps to `GS-(029 + n)`. Rows owned by later modules are recorded now so the registry is complete and the numbering is stable; their behavior is decided in their own module plan.

| EC | B4 | Scenario | Module | Decided behavior (M1 rows are binding) | GS |
|---|---|---|---|---|---|
| EC-012 | 1 | DST transition day | M1 | Session bounds come from `trading_calendar` as stored UTC instants. The 23 hour and 25 hour sessions each produce exactly one trading day. No `new Date()` arithmetic exists in engine code | GS-030 |
| EC-013 | 2 | Halt or limit-locked session | M1 | Calendar trading days advance, win days do not. Published | GS-031 |
| EC-014 | 3 | Half day | M1 | Full trading day for every counter | GS-032 |
| EC-015 | 4 | File late or corrupt mid-row | M2 | Whole-file quarantine, zero rows committed, alert. M1 asserts that absent a mark, no state advances | GS-033 |
| EC-016 | 5 | Backdated correction on a closed day | M1 + M2 | Supersede the mark, replay forward, **never claw back** a settled payout, flag for review, absorb the difference, report the absorbed amount | GS-034 |
| EC-017 | 6 | Request at 23:59:59 versus batch at 00:05 | M1 + M5 | Last-closed-day snapshot semantics. Same as EC-007 | GS-035 |
| EC-018 | 7 | Same identity, two payouts the same second | M5 | Both valid, per-account row locks, aggregate visible to admin | GS-036 |
| EC-019 | 8 | Rise webhook replayed 50 times | M5 | One settlement, one win-day reset, one floor recompute | GS-037 |
| EC-020 | 9 | PSP duplicate and out-of-order | M3 | One account, correct final state, out-of-order deferred not applied | GS-038 |
| EC-021 | 10 | Chargeback after a settled payout | M3 + M5 | Close, flag, ledger reversal, identity nets negative honestly | GS-039 |
| EC-022 | 11 | Coupon race, two tabs, one code | M3 | Atomic claim, unique index decides | GS-040 |
| EC-023 | 12 | Plan v2 published mid-checkout | M3 + M1 | Buyer gets v1, provably. Same as EC-010 | GS-041 |
| EC-024 | 13 | 100.00 versus 99.99, 0.01 requests, cap tie | M1 | `>=` on the minimum, exact tie resolves to the tied value, a 1c request fails the minimum gate rather than paying 1c | GS-042 |
| EC-025 | 14 | Micro versus mini mixed fills | M2 | Tick value from `contract_specs`, versioned by date, never hardcoded. The engine contains no symbol-aware logic at all | GS-043 |
| EC-026 | 15 | Passes eval while payout-frozen | M1 | Progression continues, payouts stay gated. Freeze is not an input to progression | GS-044 |
| EC-027 | 16 | Affiliate self-purchase | M8 | Attribution voided, flag raised | GS-045 |
| EC-028 | 17 | Identity merge after both were funded | M7 | Grandfather existing, block new, record `accounts_at_merge` | GS-046 |
| EC-029 | 18 | Batch crash at account 2,341 of 5,000 | M1 + M2 | Per-account transaction plus cursor. Applying the same day twice is a no-op on state | GS-047 |
| EC-030 | 19 | Restore with payouts mid-queue | M5 | Idempotency keys survive restore, no double transfer | GS-048 |
| EC-031 | 20 | Fuzz on adversarial day sequences | M1 | Property suite plus fixtures. Hunts rounding, overflow, monotonicity | GS-049 |
| EC-032 | 21 | Six-account hedged syndicate rehearsal | M7 + M1 | Flagged by day 3, extraction bounded by the computed ceiling | GS-050 |
| EC-033 | 22 | 500 payout requests in one minute | M5 | All correct, p95 under 1s | GS-051 |

---
