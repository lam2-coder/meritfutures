---
status: review
depends_on: [README.md, ../../architecture/SECURITY.md, ../../DECISIONS.md, RB-08-security-incident.md]
last_updated: 2026-08-14
---

# RB-09: Break-glass and key loss

**Trigger.** A working `owner` credential is lost, destroyed, or compromised, and a dual-control action is needed.
**Severity.** S2 unless a dual-control action is blocking an S1, in which case it inherits it.
**First move.** Establish which of the three keys you still have. The procedure differs entirely.

## What dual control is, honestly

[ADR-010](../../DECISIONS.md): both credentials are founder-held on physically separate hardware keys, and the control's own documentation says what it is. **At launch scale this is compromise resistance, not insider resistance.** One phished session or one owned laptop cannot move the cap, the split, the gap, or the payout rail on its own. It becomes real separation of duties on the first operations hire, with no code change.

Three keys exist: **working key A**, **working key B**, and a **sealed physical backup** stored separately from both (batch 1 gate ruling).

## A. One working key lost, not compromised

1. **Use the remaining working key plus the sealed backup** for any dual-control action.
2. **Unseal per section D.**
3. **Enroll a replacement key** and re-seal a fresh backup. The estate returns to three.
4. **Revoke the lost key** at the identity provider, even though it is only lost. A key that is merely lost is a key somebody may find.

## B. One working key compromised

**This is [RB-08](RB-08-security-incident.md) first and this runbook second.** Contain and rotate before restoring capability.

1. Revoke the compromised credential immediately.
2. **Audit every action it took**, not only the ones that look wrong. Admin actions are append-only and every payout-config change alarms.
3. **Assume the other working key is at risk** if they shared a device, a session, or a recovery path. Rotate both.
4. Then proceed as A.

## C. Both working keys lost

The sealed backup becomes one credential and a newly enrolled key becomes the other. **A single sealed backup means both dual-control credentials pass through one person's hands during this recovery**, which is the weakest moment the control has. Do it once, document it, and re-establish three keys before doing anything else.

## D. The unseal procedure

**Written before it is needed, which is the entire reason it exists.**

1. **Record the intent first**, in the incident channel, with a timestamp and a reason: what action requires the second credential and why the normal path is unavailable.
2. **Retrieve the sealed backup** from its store.
3. **Photograph the seal intact before breaking it.** If the seal is already broken, stop: **this is a security incident** ([RB-08](RB-08-security-incident.md)) and the credential must be treated as compromised regardless of how convincing the explanation is.
4. Unseal, use the credential for the specific action recorded in step 1, and no other.
5. **Re-seal a fresh backup within 24 hours.** A break-glass that leaves the estate with two keys is a break-glass that used up the control.
6. File a written record: what was done, when, by whom, and what was re-sealed.

## The quarterly existence check

**On the ops calendar, alongside the restore drill and the key-rotation drill** ([CRON_INVENTORY](CRON_INVENTORY.md)). It verifies the seal is intact and the credential is where the procedure says it is. It does **not** unseal.

**An untested break-glass is the same as none, and the failure mode is discovering that during the incident it exists for.** That sentence is from the ruling and it is the reason a check that finds nothing three times a year is worth doing a fourth.

## Never

- Never store the sealed backup with either working key, or in the same building as both.
- Never use the backup credential for routine dual control. That is not a shortcut, it is spending the control.
- Never delay re-sealing because nothing has gone wrong since.
