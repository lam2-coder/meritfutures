---
status: review
depends_on: [README.md, COMMS_TEMPLATES.md, ../../plans/M19-kyc-identity.md, ../../DECISIONS.md]
last_updated: 2026-08-14
---

# RB-11: Verification provider outage

**Trigger.** The KYC or biometric provider errors, times out, or degrades.
**Severity.** S2. It stops new verifications and it stops nothing else.
**First move.** Confirm that **no payout path is calling the provider**. If one is, that is the incident.

## The design fact that makes this survivable

**Verification is a state Merit holds, not a question Merit asks** (GS-213). A verified identity's payouts settle normally during a total provider outage, because the payout path reads `kyc_verifications.status` and never calls out.

**If a payout is blocked by a provider outage, that is a defect rather than a consequence**, and it is [M19](../../plans/M19-kyc-identity.md) INV-M19-04 failing. Treat it as S1 and fix the coupling, not the outage.

## Immediate actions

1. **Confirm the payout path is unaffected.** Sample a verified identity's request end to end.
2. **Queue new verifications** rather than failing them. The trader sees an honest queued status with a reason, not an error and not a silent spinner.
3. **Do not fall back to a weaker check.** There is no manual verification path and adding one during an outage would create a permanent one.
4. **Do not let accounts through the gate.** The composite trigger set ([ADR-021](../../DECISIONS.md)) exists so that verification happens before liability, and waiving it under time pressure is the one thing that makes the whole placement argument moot.
5. **Watch the enrichment vendor separately.** [ADR-023](../../DECISIONS.md)'s checkout enrichment **fails open on timeout** in enforcement mode and is non-blocking in observe mode (GS-239). A checkout that cannot complete because a fraud signal timed out converts a fraud control into an outage, and that is by design not allowed to happen.

## Comms

**CT-12** to identities with a queued verification, naming the step they are at and what happens next. Nothing on a public surface: a firm announcing that its identity checks are down is a firm advertising a window.

## If the outage is long

1. **The backlog is the metric.** Held funded accounts and held Direct purchases, counted, watched.
2. **Direct plans verify at purchase and are the hardest hit**, because funding is immediate and there is no later gate to move to (GS-220). Consider pausing Direct sales rather than accumulating a backlog of paid-for accounts that cannot be provisioned.
3. **A provider change is a disclosure event**, not only a procurement one: the biometric provider is named in the privacy policy at selection time. Do not switch providers during an outage.

## The evidence dependency worth remembering

Merit stores status, references, and match signals, never documents or biometrics. **The evidence for a dedupe-based enforcement lives at the provider** (GS-218, EC-131). During an outage, an enforcement grounded in a dedupe hit cannot have its basis retrieved. **Do not build an enforcement pack against a dedupe hit while the provider is down**; the pack's spine is corroborating conduct in any case, and this is the moment that requirement earns its keep.

## Exit criteria

Queue drained, no account passed the gate unverified, and no payout was ever blocked by the outage.
