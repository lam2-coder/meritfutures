---
status: review
depends_on: [README.md, COMMS_TEMPLATES.md, ../../architecture/INFRA.md, ../../plans/M05-payout-system.md]
last_updated: 2026-08-14
---

# RB-06: Restore from backup

**Trigger.** Data loss, corruption, a failed migration, or the **quarterly drill** (VG-9).
**Severity.** S1 for a real restore. The drill is scheduled work and is run with the same steps, which is the point of the drill.
**First move.** **Stop writes.** Everything else is recoverable; a restore racing live traffic is not.

## Before anything

**Decide the target time before you touch a console.** PITR means you are choosing a moment, and choosing it under pressure while the restore is already running is how a restore loses an hour of real trading it did not need to.

Write down, in the incident channel: the target timestamp, why it was chosen, and what is expected to be lost.

## The order

1. **Stop the application writes.** Scale the worker to zero. Put the portal and admin into read-only or maintenance.
2. **Take a snapshot of the current broken state before restoring over it.** A corrupted database is evidence and it is the only copy of anything written since the target time.
3. **Restore to the chosen point** using the vendor's documented procedure ([ADR-007](../../DECISIONS.md): the restore is a documented vendor procedure rehearsed quarterly, not a homegrown script).
4. **Verify before reconnecting**, per the checklist below.
5. **Reconnect the worker last**, after the queue state is verified.

## The verification checklist, in this order

| # | Check | Why this one |
|---|---|---|
| 1 | **Ledger sums to zero**, globally and per identity | The first question about any restored database is whether the books survived. GS-231 pins that a per-identity error hides behind a global zero |
| 2 | **No duplicate settlements**, and **idempotency keys survived the restore** | GS-048, B4 #19. This is the failure a restore uniquely creates: a queued transfer replaying against a provider that already sent it |
| 3 | **Queue state consistent with the ledger** | [ADR-006](../../DECISIONS.md) put jobs in the same Postgres for exactly this reason. Restore keeps them consistent, and this check proves it did |
| 4 | **Replay self-audit green** over a sample of accounts | Stored `rule_states` re-derive identically, or the restore brought back state the engine does not vouch for |
| 5 | **Wallet positions reconcile** per identity, and never negative | Two exits from one integer (GS-230), and a restore is where a position could land inconsistent |
| 6 | **Last closed trading day is what you expect** | Determines what has to be re-ingested |

**Any check failing stops the reconnection.** A database that is up and wrong is worse than one that is down.

## Re-ingesting the gap

Files for trading days after the restore point are re-ingested through the normal path. **The batch is idempotent** (GS-047), so re-running a day already applied is a no-op. Do not shortcut this by hand.

## Comms

A real restore gets **CT-08**, and it says what was lost in plain terms. **A restore that lost data and was described as maintenance is the sentence a trader finds later**, and the market Merit operates in has excellent institutional memory for firms that were vague once.

## The drill

**Quarterly, on the ops calendar, with a written result** (VG-9). The drill is not "can we restore"; it is **"can we restore with payouts mid-queue and produce no duplicate transfers"**. A drill against an idle database tests the vendor's product rather than Merit's procedure. Run it against a seeded world with transfers in flight.

The written result records: target time chosen, wall-clock duration, every checklist item's outcome, and anything in this runbook that turned out to be wrong. **The last field is the reason the drill is worth its cost.**

## Exit criteria

All six checks green, the gap re-ingested, the worker reconnected, and, for a drill, a written result filed.
