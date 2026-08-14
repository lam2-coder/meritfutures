---
status: approved
depends_on: [README.md, COMMS_TEMPLATES.md, ../../DECISIONS.md, ../../plans/M05-payout-system.md, ../../plans/M20-wallet.md]
last_updated: 2026-08-14
---

# RB-07: Ledger imbalance and payout halt

**Trigger.** `ledger.invariant_violated`.
**Severity.** **S1, always, both scopes.**
**First move.** Read the scope classification on the event. It decides everything that follows, and it was decided by the classifier rather than by you.

## The rule, and why it is scoped

[ADR-016](../../DECISIONS.md): **a per-transaction imbalance attributable to exactly one identity halts payouts for that identity only. A global sum mismatch halts everything.** The reason for scoping is that an unscoped halt is a denial-of-payouts trigger with a one cent activation energy: anyone who can make the books disagree stops every payout for every trader, without moving any money.

**The classifier proves locality before it grants it.** An imbalance spanning identities, one with ambiguous attribution, and one traceable to no transaction at all are **all global**. If you find yourself arguing that a global halt is probably local, the classifier already considered it and said no.

## A. Identity-scoped halt

**A scoped halt is not the quiet half of this control.** It pages on the same channel as a global halt and it starts a **24 hour escalation clock**. On expiry it escalates to a global halt automatically, and that is not a bug to work around: without the clock, an attacker who can produce one attributable imbalance buys an indefinitely unexamined corner of the ledger.

1. **Open with the reconciliation query, not with a search for a cause.** The query names the transaction range.
2. Identify the implicated transaction. The per-transaction zero-sum check is a **deferred constraint at commit**, so an unbalanced transaction cannot normally be written at all. Its existence means a direct write, a migration, or corruption.
3. **Correct by compensating entry only.** Never by update, never by delete. The append-only grants make this true in the database rather than by convention (VG-8).
4. **Notify the affected trader** with CT-09 before the clock runs out, whether or not it is resolved. A halt the trader discovers by pressing a button is a much worse event than one they were told about.
5. **Do not extend the clock to buy time.** Escalating to global is the designed outcome of an unresolved local imbalance.

## B. Global halt

1. **Every payout is stopped.** Confirm it, including the internal wallet-credit leg.
2. **Page.** Then open the reconciliation query, which names the implicated transaction range.
3. **A global mismatch implies data corruption or a direct write**, because the deferred constraint makes an unbalanced transaction unwritable. Treat a direct write as a **security incident** ([RB-08](RB-08-security-incident.md)) until you have a benign explanation with a name attached.
4. **CT-10** goes out inside 30 minutes. It says payouts are paused, it says why in one sentence, and it gives a next-update time.
5. Do not resume until the ledger sums to zero globally **and** per identity. GS-231 exists because a per-identity error hides behind a global zero, and resuming on the global check alone is the exact mistake it pins.

## Never

- **Never adjust a balance to make the sum work.** That converts an accounting error into an accounting fiction and destroys the audit trail that would have explained it.
- **Never resume payouts on a partial explanation.** Paying out of books nobody understands is the failure the invariant exists to prevent, and it is worth an outage to avoid.
- Never suppress this alarm. Ledger imbalance is one of three alarms [M06](../../plans/M06-admin-ops-console.md) GS-114 makes unsuppressable, alongside replay divergence and payout balance-reflection-missing.

## Exit criteria

Zero-sum holds globally and per identity, every compensating entry is posted with its `reversal_of` reference, the halt is lifted deliberately with a written reason, and every affected trader has been told it is over by the same channel that told them it started.
