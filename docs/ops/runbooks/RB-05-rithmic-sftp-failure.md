---
status: approved
depends_on: [README.md, COMMS_TEMPLATES.md, ../../plans/M02-rithmic-bridge.md, ../../decisions/README.md]
last_updated: 2026-08-14
---

# RB-05: Platform SFTP or streaming failure

**Trigger.** The expected file is absent at its hour, SFTP authentication fails, the streaming feed drops, or provisioning CSVs are not collected.
**Severity.** S2 for the file path (states go stale, which is a labeled condition). **S1 if provisioning is blocked and accounts are being sold**, because that is money taken for something not delivered.
**First move.** Determine which of the two tiers is broken. They fail independently and only one of them is authoritative.

## The two tiers, and why the distinction is the whole runbook

| Tier | What it is | If it fails |
|---|---|---|
| **Tier 1, authoritative** | EOD report files over SFTP. Every rule, gate, breach, eligibility, and money decision | States stay at the last closed session. Nothing is wrong, everything is stale, and the surfaces already say so |
| **Tier 2, indicative** | The streaming feed behind live P&L, projected floor distance, and live counters ([ADR-020](../../decisions/ADR-020.md)) | **Live surfaces degrade to last-closed values and the label changes with them, in the same render** (GS-133). A live number that silently freezes at its last value is a failure, not a fallback |

**Tier 2 failing is not a money incident.** Indicative data never feeds an eligibility, breach, or money decision, and GS-132 asserts the engine's output is byte-identical with the live cache poisoned. Say this out loud before anybody treats a feed drop as urgent.

## A. Inbound file missing or late

1. **Check the vendor first**, not the worker. A file that was never sent looks identical to a file that was never fetched.
2. **Confirm no partial state was committed.** Late is fine; partial is not (GS-033).
3. If the file arrives corrupt mid-row, that is [RB-02](RB-02-recon-mismatch.md).
4. **Leave yesterday's states in place.** They are correct as of their own trading day.
5. If the gap crosses a second session, send **CT-07**.

## B. SFTP authentication failure

1. **Assume credential rotation before assuming compromise**, then verify rather than assume. The keypair rotates on a calendar and a missed rotation looks exactly like a revocation.
2. The SFTP worker's egress is restricted and its keypair rotates ([INFRA](../../architecture/INFRA.md)). A failure after a rotation window is the first thing to check.
3. **If the credential was not rotated by Merit, treat it as a security incident** and go to [RB-08](RB-08-security-incident.md). Provisioning forgery is a crown-jewel path: it mints free funded accounts.

## C. Outbound provisioning blocked

**This is the serious half.** Accounts are being sold and cannot be delivered.

1. **Fail-closed provisioning holds the account out of trading** rather than surfacing it as carried liability (GS-138). Confirm that is what happened.
2. **Do not disable checkout automatically.** Decide deliberately: a short outage is better absorbed than a closed store, and a long one is not.
3. Every held account gets **CT-02** with a time, not a status.
4. Track the held count. It is the number that decides step 2.

## D. Streaming feed loss

1. Confirm **every live surface fell back and relabeled in the same render** (GS-133). A surface showing a stale number with a live label is the actual defect here.
2. Confirm the admin console's live Open Liability did the same.
3. No trader comms unless it persists past a session, and then only a label note.

## Never

- Never reconstruct a missing day from the streaming tier. It is indicative, it is not replayable, and using it once would make every downstream number unauditable forever.
- Never let an account trade with an unconfirmed setpoint to clear a provisioning backlog.

## Exit criteria

Files current, provisioning drained, every held account either online or explained, and the live tier labeled correctly in both directions.
