---
status: approved
depends_on: [../../../MERIT_BUILD_MASTER_PROMPT.md, ../../DECISIONS.md, ../../architecture/INFRA.md, ../../architecture/SECURITY.md, ../../architecture/EVENTS.md, ../../plans/M02-rithmic-bridge.md, ../../plans/M05-payout-system.md, ../../plans/M06-admin-ops-console.md, COMMS_TEMPLATES.md, CRON_INVENTORY.md, WEEKLY_RISK_RITUAL.md]
last_updated: 2026-08-14
---

# Runbooks

Constitution section 7 instantiated: one runbook per failure class, a cron inventory with dead-man alerting, pre-written incident comms, and the weekly risk ritual.

**Who these are written for.** One person, at 3am, on a phone, who has not read this document in four months and is being asked a question by a trader at the same time. Every runbook below is therefore an ordered checklist with the first step being something you can do in under a minute, not an explanation of the system. Explanation lives in the module plans, which are linked and which nobody should be reading during an incident.

---

## 1. The five rules that apply to every incident

| # | Rule | Why |
|---|---|---|
| 1 | **Communicate before you understand.** The first trader-facing message goes out when you know something is wrong, not when you know what. [COMMS_TEMPLATES](COMMS_TEMPLATES.md) exists so the message costs no thinking | Payout trust is the brand. A firm that goes quiet during a delay is indistinguishable from a firm that is in trouble, and traders in this market have seen enough real collapses to assume the worst by default |
| 2 | **Never guess a money number.** If a balance, an eligibility, or a ledger position is in doubt, halt the affected path and say so. Do not compute a replacement by hand | Every runbook below has a halt in it and no runbook below has a manual correction in it. A hand-entered figure has no replay, no audit trail, and no way back |
| 3 | **A protective state stays on until somebody turns it off deliberately**, with a written reason and an expiry ([M06](../../plans/M06-admin-ops-console.md) GS-114, GS-117) | The failure this estate actually suffers is a control that got ignored, not one that got attacked. Three of [M06](../../plans/M06-admin-ops-console.md)'s adversarial scenarios name Merit under pressure as the adversary |
| 4 | **Write the timeline as you go**, in the incident channel, with timestamps. Not afterwards | The post-mortem is worth more than the fix, and a reconstructed timeline is a story rather than a record |
| 5 | **A noisy incident is not necessarily the incident.** See [RB-08](RB-08-security-incident.md) | [SECURITY_LANDSCAPE](../../../research/SECURITY_LANDSCAPE.md) records a case where a DDoS consumed the entire response and the actual loss was data. **A DDoS against Merit is a data-exfiltration alarm until proven otherwise**, and that is a named trigger rather than a note |

---

## 2. The runbooks

| ID | Runbook | Trigger | Trader-facing |
|---|---|---|---|
| [RB-01](RB-01-nightly-batch-failure.md) | **Nightly batch failure** | `batch.failed`, or the dead-man switch on `batch.completed` | Only if states are stale past the morning |
| [RB-02](RB-02-recon-mismatch.md) | **Reconciliation mismatch** | `ingest.quarantined`, `recon.mismatch`, `platform.setpoint_unconfirmed` | Affected accounts only |
| [RB-03](RB-03-mid-freeze.md) | **PSP or MID freeze** | Processor notice, decline-rate alarm, or a failed settlement | Yes, on the checkout surface |
| [RB-04](RB-04-settlement-rail-outage.md) | **Settlement rail outage** | Transfer failures, webhook silence, or a provider status page | **Yes, immediately and repeatedly** |
| [RB-05](RB-05-rithmic-sftp-failure.md) | **Platform SFTP or streaming failure** | Missing file at the expected hour, auth failure, feed loss | Label change on live surfaces; notice if it persists |
| [RB-06](RB-06-restore-from-backup.md) | **Restore from backup** | Data loss, corruption, or the quarterly drill | Yes, if a real restore |
| [RB-07](RB-07-ledger-imbalance.md) | **Ledger imbalance and payout halt** | `ledger.invariant_violated` | Affected identity, or everyone on a global halt |
| [RB-08](RB-08-security-incident.md) | **Security incident** | Any of eleven triggers, including a DDoS | Per the disclosure decision, and honestly |
| [RB-09](RB-09-break-glass.md) | **Break-glass and key loss** | A working `owner` credential is lost or compromised | No |
| [RB-10](RB-10-support-account-lookup.md) | **Support: the trader swears the account id is right** | A support contact citing a `404` | Yes, it is a support interaction |
| [RB-11](RB-11-verification-provider-outage.md) | **Verification provider outage** | Provider errors or timeouts on the KYC path | Queued verifications only |

**Two supporting documents, both used inside the runbooks above:** [COMMS_TEMPLATES](COMMS_TEMPLATES.md) and [CRON_INVENTORY](CRON_INVENTORY.md). The [WEEKLY_RISK_RITUAL](WEEKLY_RISK_RITUAL.md) is not an incident procedure; it is the routine that keeps most of these from firing.

---

## 3. Severity, and what each level actually means

| Severity | Definition | Response |
|---|---|---|
| **S1** | Money is wrong, or could be. Payouts stopped, ledger imbalanced, a state that cannot be reproduced | Page. Halt first, diagnose second. Trader comms inside 30 minutes |
| **S2** | A trader-facing surface is wrong or unavailable, but money is provably correct | Page during waking hours. Comms inside 2 hours |
| **S3** | Internal degradation with no trader impact and no money exposure | Next business day |
| **S4** | Cosmetic or informational | Backlog |

**The classification rule that matters: if you are unsure between S1 and S2, it is S1.** The cost of over-escalating is a wasted hour; the cost of under-escalating on a money path is the thing the firm does not survive.

---

## 4. Carried forward from earlier waves

| Runbook | Why it exists | Ruled at |
|---|---|---|
| [RB-10](RB-10-support-account-lookup.md) **Support: "the trader swears the account id is right"** | The API returns `404`, not `403`, when a trader addresses a resource they do not own, so existence is never confirmed to a stranger ([API_CONTRACT section 1](../../architecture/API_CONTRACT.md#1-conventions)). Support therefore never resolves an account from a trader-supplied id | Wave 2 gate, 2026-08-13 ([DECISIONS](../../DECISIONS.md)) |
| [RB-08](RB-08-security-incident.md)'s **DDoS trigger** | A DDoS against Merit is a data-exfiltration alarm until proven otherwise | [SECURITY_LANDSCAPE](../../../research/SECURITY_LANDSCAPE.md) section 1 |
| [RB-09](RB-09-break-glass.md) **break-glass unseal and lost-key rotation** | The batch 1 gate ruled a sealed physical backup, a documented unseal procedure, a quarterly existence check, and a lost-key rotation runbook, all of which must exist before launch | Wave 3 batch 1 gate, 2026-08-14 ([DECISIONS](../../DECISIONS.md)) |
| [RB-07](RB-07-ledger-imbalance.md)'s **escalation clock** | An identity-scoped halt pages immediately and escalates to global on expiry, so scoping the halt does not create a slower version of the attack it fixed | [ADR-016](../../DECISIONS.md) |

---

## 5. Open questions for the founder

**OQ-RB-01. What is the identity-scoped ledger halt's escalation window?** [ADR-016](../../DECISIONS.md) proposed **24 hours** and left the value to M5 configuration. [RB-07](RB-07-ledger-imbalance.md) uses 24 hours throughout. Confirm at FREEZE.

**OQ-RB-02. Who is the second contact?** Every runbook here assumes one operator. Several of them (a restore, a break-glass unseal, a security incident with a disclosure decision) are materially safer with a second person who can be woken. Proposed: **name a technical contact and a legal contact before launch**, even if neither has system access, because the value is somebody to think out loud at rather than somebody to delegate to.

**OQ-RB-03. Does Merit publish a status page from day one?** [RB-04](RB-04-settlement-rail-outage.md) assumes one exists, because constitution section 7 names it in the settlement-outage response. Proposed: **yes, from launch**, on a domain and a host that share nothing with the production estate, since a status page that goes down with the thing it reports on is worse than none.
