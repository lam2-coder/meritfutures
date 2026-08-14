---
status: review
depends_on: [README.md, COMMS_TEMPLATES.md, ../../plans/M05-payout-system.md, ../../plans/M20-wallet.md, ../../DECISIONS.md]
last_updated: 2026-08-14
---

# RB-04: Settlement rail outage

**Trigger.** Transfer failures, webhook silence past the expected window, or the provider's status page.
**Severity.** **S1 always.** Payout trust is the brand and this is the failure that damages it.
**First move.** Post the trader-facing notice. **Before diagnosing.** [COMMS_TEMPLATES](COMMS_TEMPLATES.md) **CT-05** takes thirty seconds and is the highest-value action available in the first minute.

## What the wallet changed, and it is a lot

Under [ADR-019](../../DECISIONS.md) a payout is two legs. **The internal leg is instant and does not touch this rail.** A trader requesting a payout during a total rail outage still receives their wallet credit, in the same transaction as the approval, with no external party in the path (GS-128).

**So the honest message is much better than it used to be:** payouts are working, withdrawals to bank are delayed. That distinction is real, it is the reason the wallet exists, and it must be stated in exactly those terms rather than blurred into "payouts are delayed", which would be both false and self-harming.

## Immediate actions

1. **Post CT-05.** Status page, the portal's payout screen, and the notification channel. Every affected trader hears it from Merit before they ask.
2. **Confirm transfers are queuing with idempotency keys intact** (GS-111, GS-048). They must survive a restore without producing a duplicate.
3. **Do not retry by hand.** The retry path is idempotent; a manual transfer is not, and a duplicate settlement is a loss with no clean reversal.
4. **Confirm the internal leg is unaffected.** Wallet credits should continue normally. If they are not, this is a different and much worse incident, go to [RB-07](RB-07-ledger-imbalance.md).
5. **Freeze nothing.** An outage is not a flag, and the freeze endpoint requires a cited open flag for exactly this reason.

## During

- **Update on a schedule you commit to and keep**, even when the update is "no change". A promised update that arrives saying nothing is worth more than a useful update that arrives late.
- Watch the **reserve coverage ratio**: a queued backlog is liability that has not left. Wallet balances are already in Open Liability and the RCR denominator (GS-130), so the number does not move when transfers stall, which is correct and worth knowing before somebody reads the dashboard as reassuring.
- **Never offer an alternative rail.** [ADR-017](../../DECISIONS.md) is one rail and one transfer table, and a second path opened during an incident is a permanent blind spot in the destination-concentration detector.

## Recovery

1. Drain the queue in order. Idempotency keys make redelivery safe.
2. Reconcile every queued transfer against the provider's record before declaring the incident over.
3. **CT-06** closes it: what happened, how long, what was never at risk, and what changed.

## Never

- Never pay a trader out of band to fix an individual complaint. It creates a settlement with no idempotency key, no provenance, and no place in the ledger.
- Never quote a settlement time you have not been given. **2 to 3 business days is the published window** and it is stated as a range everywhere.

## Exit criteria

Queue drained, every transfer reconciled, zero duplicates, and a closing message sent to everyone who received the opening one.
