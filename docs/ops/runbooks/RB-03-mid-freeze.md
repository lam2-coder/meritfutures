---
status: review
depends_on: [README.md, COMMS_TEMPLATES.md, ../../plans/M03-billing-checkout.md, ../../DECISIONS.md]
last_updated: 2026-08-14
---

# RB-03: PSP or MID freeze

**Trigger.** A processor notice, a decline-rate alarm, a settlement that did not arrive, or a reserve demand.
**Severity.** S2. It stops revenue and it touches no trader money.
**First move.** Switch checkout routing to the second MID. **This is why two MIDs exist and it should take one config change.**

## What this is not

**This is not a payout problem.** Merit's outbound rail is separate from its inbound processing ([ADR-017](../../DECISIONS.md): one outbound rail, one transfer table). A frozen MID stops sales and does not touch a single payout. Say that internally before anybody starts improvising, and say it to traders if the question comes up, because "our payment processor froze us" is a sentence this market reads as a firm dying.

## Immediate actions

1. **Route new checkouts to MID B.** Failover is **per-attempt routing and never mid-transaction** (GS-095): an in-flight attempt at MID A completes or fails at MID A, and is never retried at B.
2. **Watch the double-charge fingerprint alarm.** Two `paid` purchases for the same plan and size under one identity inside five minutes is the failure this rule exists to prevent, and a routing change is when it would happen.
3. **Reconcile settlements from the frozen MID.** What is captured, what is authorized, what is in the reserve.
4. **Do not stop provisioning.** An account already paid for is provisioned regardless of what happened to the processor afterwards.

## If both MIDs are unavailable

1. **Take checkout down deliberately**, with a stated reason and a return time, rather than leaving a checkout that fails at the last step. A failed payment page is a worse experience and a worse signal than a closed one.
2. Existing accounts, evaluations, funded trading, and **payouts are all unaffected** and the notice must say so in its first sentence.
3. Resets are also blocked, which affects breached traders disproportionately. Extend nothing automatically and promise nothing that needs a config change to honor.

## The chargeback interaction

A frozen MID often arrives with a chargeback-rate problem attached. If so:

1. **Chargeback after a settled payout is not clawed back** (GS-039, GS-096). The account closes, the identity is flagged, a compensating reversal posts, and the identity nets negative in the books honestly.
2. **Affiliate commission on a charged-back purchase claws back** and the affiliate balance may go negative (GS-123).
3. A rising chargeback rate is a [M07](../../plans/M07-risk-abuse.md) input, not only a processor problem.

## Comms

**CT-04** on the checkout surface. It states that purchasing is paused, that existing accounts and payouts are unaffected, and when the next update is. No explanation of the processor relationship, ever, on a public surface.

## The calendar dependency

**PSP applications go out the day the capital go-decision is made** (batch 1 gate). Approval takes longer than the module does, and a firm with one MID has no version of this runbook that works.

## Exit criteria

Checkout is live on at least one MID, settlements from the affected MID are reconciled to the cent, and no purchase resolved to two charges.
