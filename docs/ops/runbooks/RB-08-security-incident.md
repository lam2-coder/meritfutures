---
status: approved
depends_on: [README.md, COMMS_TEMPLATES.md, ../../architecture/SECURITY.md, ../../../research/SECURITY_LANDSCAPE.md, RB-09-break-glass.md]
last_updated: 2026-08-14
---

# RB-08: Security incident

**Severity.** S1 until proven otherwise. That is the default and it is deliberate.
**First move.** **Contain. Do not investigate first.** Appendix D5's order is contain, rotate, notify, post-mortem, and the order is the procedure.

## The trigger list

Any of these opens this runbook:

| # | Trigger |
|---|---|
| 1 | **A DDoS or any availability event.** See the note below |
| 2 | Admin login from an unexpected geography or outside normal hours |
| 3 | A failed-authentication burst |
| 4 | A payout-config change nobody recognizes (cap, split, gap, destination) |
| 5 | A role grant nobody made |
| 6 | An SFTP credential failing without a rotation to explain it ([RB-05](RB-05-rithmic-sftp-failure.md) B) |
| 7 | A **canary token** firing, in the database or the repository |
| 8 | An evidence-pack export burst (GS-116) |
| 9 | A ledger imbalance with no benign explanation ([RB-07](RB-07-ledger-imbalance.md) B step 3) |
| 10 | A webhook signature failure at volume |
| 11 | Anything a trader reports that you cannot explain in five minutes |

## Trigger 1 is the one this runbook exists for

**A DDoS against Merit is a data-exfiltration alarm until proven otherwise.**

[SECURITY_LANDSCAPE](../../../research/SECURITY_LANDSCAPE.md) records the case that produced this rule: the visible event was an availability incident, it consumed the entire response, and the actual loss was data. **A runbook that treats availability and confidentiality as separate playbooks will run the wrong one first**, and the attacker knows it, because that is why the noise is there.

So on any availability event, in parallel with mitigating it and **before** it is resolved:

1. Check evidence-pack export volume and signed-URL issuance.
2. Check the identity-graph read surface for bulk access.
3. Check egress on the money paths for anything outside the allowlist (GS-152).
4. Check admin session activity for the window.
5. Check the canaries.

**If you cannot do both at once, do the confidentiality checks.** Availability recovers on its own timescale; data does not come back.

## Contain

1. **Revoke sessions** on the affected surface. All of them, not the suspicious ones.
2. **Rotate the implicated credential immediately.** Not after confirming it was used.
3. **Take the admin origin off the allowlist** if the admin surface is implicated. It is a separate apex domain with its own allowlist precisely so this is one change ([ADR-012](../../decisions/ADR-012.md)).
4. **Halt payouts** if the payout path, its configuration, or a destination is implicated. An outage is recoverable and a fraudulent settlement is not.
5. **Preserve logs off-box first.** Audit logs ship off-box tamper-evident, and containment steps that overwrite them are the first thing to get wrong.

## Rotate

Everything the implicated credential could reach, not everything you believe it reached. Secrets live in the platform vault at minimum scope with a 90 day rotation calendar, so the rotation path is exercised rather than improvised. If a working `owner` credential is implicated, go to [RB-09](RB-09-break-glass.md).

## Notify

**Two audiences and two clocks.**

- **Traders**, using **CT-11**, as soon as there is anything true to say. Merit's position is that payout trust survives honesty and does not survive silence, which is written into Appendix D5 and is not a judgment call to be made under pressure.
- **Regulatory and legal**, on the clock the jurisdiction sets. **This is counsel's call and the contact belongs on the [ops calendar](CRON_INVENTORY.md) before it is needed.** A breach-notification deadline discovered during a breach is a second incident.

**Never say "no data was accessed" until you can prove it.** Say what you know, say what you do not, and say when the next update is. The sentence that ends a firm is the confident early denial that turns out to be wrong.

## Post-mortem

Within a week, written, blameless, and specific. It produces: an [EDGE_CASES](../../EDGE_CASES.md) entry, a golden file where the failure is testable, and at least one change to this runbook. **A post-mortem that changes no procedure did not find the cause.**

## Standing controls this runbook depends on

Canary tokens in the database and repository, tamper-evident off-box audit logs, alerts on every admin login and every payout-config change, `security.txt` and a VDP with safe harbor from day one, and quarterly key-rotation and restore drills. Each is in [SECURITY](../../architecture/SECURITY.md); they are listed here because a runbook that assumes controls it never names is a runbook that fails quietly when one is missing.
