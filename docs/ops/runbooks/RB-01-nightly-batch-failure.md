---
status: review
depends_on: [README.md, COMMS_TEMPLATES.md, CRON_INVENTORY.md, ../../plans/M01-rules-engine.md, ../../plans/M02-rithmic-bridge.md]
last_updated: 2026-08-14
---

# RB-01: Nightly batch failure

**Trigger.** `batch.failed`, or the [dead-man switch](CRON_INVENTORY.md) firing because `batch.completed` did not arrive by 06:00 CT.
**Severity.** S2 by default. **S1 if any account state was written and the run cannot be resumed**, because that is the case where the stored state may be partial.
**First move, under a minute.** Read the batch's last checkpoint. It tells you which account it stopped on and whether the run is resumable.

## What is true before you start

The batch is **resumable and idempotent by design** (GS-047, PT-07 in [STRATEGY](../../testing/STRATEGY.md)). Applying the same closed day twice is a no-op on state. This is the single most important fact in this runbook, because the instinct on a half-finished run is to be clever, and the correct action is almost always to run it again.

## Immediate actions

1. **Do not clear the checkpoint.** It is the only record of where the run stopped.
2. **Check whether ingest completed.** If the platform file never arrived or quarantined, this is not a batch failure. Go to [RB-05](RB-05-rithmic-sftp-failure.md) or [RB-02](RB-02-recon-mismatch.md).
3. **Confirm payouts.** Payout requests evaluate against the **last closed day** and are unaffected by an in-flight batch (GS-035). A stalled batch does not stop payouts and must not be described to a trader as though it did.
4. **Resume the run.** Same job, same trading day. It skips completed accounts by checkpoint.
5. If the resume fails at the **same account**, that account is the problem rather than the batch. Continue at step 6.

## Diagnosis when one account is the problem

| Symptom | Likely cause | Action |
|---|---|---|
| Engine refuses the day with a reconciliation error | Funded opening balance is not `size_cents` (GS-070, GS-093) | Do not force it. Quarantine the account, raise the recon flag, go to [RB-02](RB-02-recon-mismatch.md) |
| Replay of the account diverges from stored state | Engine upgrade applied without the approval gate, or state corruption | **S1.** Halt payouts for the identity, page, and go to [RB-07](RB-07-ledger-imbalance.md)'s halt procedure for the scoping question |
| Balance delta matching no fills and no settlement | A non-trading balance movement (GS-092) | Quarantine, never classify as realized P&L, never guess |
| The account is fine and the job crashed | Resource exhaustion or a transient database error | Resume. If it recurs, check the analytics load profile (GS-178): a payout wave and an analytics burst contend for one Postgres |

## Recovery

**The run completes or it does not run.** There is no partial acceptance. If the batch cannot complete for the trading day, leave yesterday's states in place, tell traders the dashboard is as of the prior session, and resume when the blocker clears. **Stale is a state Merit's surfaces already label** ([ADR-002](../../DECISIONS.md)'s T+1 disclosure); wrong is not.

## Comms

Only if states are still stale after the morning. Use [COMMS_TEMPLATES](COMMS_TEMPLATES.md) **CT-01**. The message says what is stale, that payouts are unaffected, and when the next update comes. It does not say "we are investigating" without a time.

## Never

- Never hand-write a `daily_marks` or `rule_states` row to unblock the run.
- Never skip an account to get the batch green. A skipped account is a trader whose floor did not move.
- Never clear a quarantine to make ingest pass.

## Exit criteria

`batch.completed` for the trading day, the replay self-audit green, and the account count in the run equal to the active account count.

## Post-incident

Every distinct cause becomes an [EDGE_CASES](../../EDGE_CASES.md) entry and a golden file (TR-04). A batch failure that produced no registry entry was not diagnosed.
