## 4. GS-030 to GS-051: the Appendix B4 battery

`GS-(029 + n)` is B4 item `n`, so the mapping never needs looking up. Rows marked M1 are executable against the pure engine now; the others are numbered here and specified by their owning module plan.

| ID | B4 | Scenario | Owner | Expected behavior (M1 rows are binding here) |
|---|---|---|---|---|
| GS-030 | 1 | DST transition day | M1 | Day boundary follows the exchange calendar. The 23 hour and 25 hour sessions each produce exactly one trading day and one mark |
| GS-031 | 2 | CME halt or limit-locked session | M1 | Calendar trading days advance, win days do not. Cadence gap and min-day counters progress. Published as such |
| GS-032 | 3 | Half day (Thanksgiving) | M1 | Counts as a full trading day, identical to GS-003 with the real calendar |
| GS-033 | 4 | Ingest file late or corrupt mid-row | M2 | Whole-file quarantine, zero rows committed, alert, yesterday's states untouched. M1's assertion: given no new mark, no rule state advances and no counter moves |
| GS-034 | 5 | Backdated correction for a closed day | M1 + M2 | New mark supersedes, replay recomputes forward, stored states change, **a settled payout is never clawed back**, `ingest.correction_received` and a review flag fire |
| GS-035 | 6 | Payout at 23:59:59 versus batch at 00:05 | M1 + M5 | Both evaluate against the same last closed day. The request is unaffected by the in-flight batch |
| GS-036 | 7 | Two accounts, same identity, payout the same second | M5 | Both valid, independent, row-locked per account. M1's assertion: two independent folds produce two independent states with no shared counter |
| GS-037 | 8 | Rise webhook replayed 50 times | M5 | Exactly one settlement, exactly one win-day reset, exactly one floor recompute |
| GS-038 | 9 | PSP duplicate and out-of-order delivery | M3 | One account, correct final state |
| GS-039 | 10 | Chargeback after a settled payout | M3 + M5 | Account closes, identity flagged, ledger reversal posted, identity nets negative and the books say so |
| GS-040 | 11 | Coupon race across two tabs | M3 | One redemption wins, decided by the unique index |
| GS-041 | 12 | Plan v2 published while checkout is open on v1 | M3 + M1 | Buyer gets v1, provably. M1's assertion: an existing account's `plan_version_id` is an engine input and no published version ever mutates a live account's rules |
| GS-042 | 13 | 100.00 versus 99.99 minimum, 0.01 requests, cap tie | M1 | `10000 >= 10000` eligible; `9999` not eligible; a supplied `1` clamps to 1 and fails the minimum gate rather than paying 1 cent |
| GS-043 | 14 | Micro versus mini mixed fills | M2 | Tick value from `contract_specs`, never a hardcoded multiplier. M1 consumes only the resulting P&L and asserts no symbol-aware logic exists in the engine |
| GS-044 | 15 | Passes eval while payouts are frozen | M1 | Progression continues, `phase.passed` fires, payouts stay gated, comms template fires. Freezing is not a rule input to progression |
| GS-045 | 16 | Affiliate buys through their own code | M8 | Attribution voided, flag raised |
| GS-046 | 17 | Identity merge after both identities were funded | M7 | Existing accounts grandfathered, new purchases blocked, `accounts_at_merge` recorded |
| GS-047 | 18 | Batch crashes at account 2,341 of 5,000 | M1 + M2 | Resumable, idempotent, no double-applied day. M1's assertion: applying the same day twice is a no-op on state |
| GS-048 | 19 | Restore from backup with payouts mid-queue | M5 | No duplicate transfers; idempotency keys survive the restore |
| GS-049 | 20 | Fuzz: adversarial day sequences | M1 | Alternating 14,999 and 15,001 days, a single 1,000,000 day into consistency math, and 100-day flat grinds. Hunts rounding, overflow, and monotonicity breaks. Runs as a property suite as well as a fixture |
| GS-050 | 21 | Six-account hedged syndicate rehearsal | M7 + M1 | Detectors flag by day 3; caps bound worst-case extraction to the computed ceiling. M1 supplies the ceiling arithmetic, see GS-060 |
| GS-051 | 22 | 500 simultaneous payout requests in one minute | M5 | All correct, p95 under 1s |
