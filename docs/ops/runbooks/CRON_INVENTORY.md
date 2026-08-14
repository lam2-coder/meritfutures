---
status: review
depends_on: [README.md, ../../architecture/INFRA.md, ../../DECISIONS.md, ../../plans/M01-rules-engine.md, ../../plans/M12-transparency-platform.md]
last_updated: 2026-08-14
---

# Cron inventory and dead-man switches

Constitution section 7: **cron inventory with alerting on non-run (dead-man switch)**.

**The failure this exists for.** A scheduled job that fails loudly is a job somebody fixes. A scheduled job that **stops being scheduled** is invisible: no error, no alert, no page, and a number on a dashboard that quietly stops moving. Every row below therefore has an expected-by time, and **the absence of the completion signal by that time is itself an alert**.

**One rule: a job in this table without a dead-man switch is a job that does not exist.** Adding a scheduled job to the estate means adding a row here in the same change, and CI-06 checks that the inventory and the job registry agree.

## Scheduled work

| Job | Schedule | Expected by | Dead-man alert | Severity if absent |
|---|---|---|---|---|
| **Platform ingest fetch** | after each session close | 18:30 CT | `ingest.completed` absent | S2, [RB-05](RB-05-rithmic-sftp-failure.md) |
| **Nightly batch** (day close, rule fold, eligibility) | after ingest | 06:00 CT | `batch.completed` absent | S2, [RB-01](RB-01-nightly-batch-failure.md) |
| **Replay self-audit** | after the batch | 07:00 CT | `replay.audit_completed` absent | **S1.** It gates payout eligibility and it gates [M12](../../plans/M12-transparency-platform.md) publication |
| **Provisioning CSV push** | every 15 minutes | continuous | two consecutive cycles missed | S2 if accounts are pending |
| **Entitlement hygiene sweep** | daily | 08:00 CT | completion absent | S3. Leaking cost is a warning; cutting off a live trader is a bug, so this job errs one way |
| **Global ledger zero-sum assertion** | nightly | 05:00 CT | assertion absent | **S1.** A silent assertion is indistinguishable from a passing one |
| **Per-identity ledger reconciliation** | nightly | 05:00 CT | assertion absent | **S1.** GS-231: a per-identity error hides behind a global zero |
| **Statistics run** ([M12](../../plans/M12-transparency-platform.md)) | nightly, after the self-audit | 08:00 CT | `stats.published` absent | S3, and it publishes nothing rather than something partial |
| **Detector runs** ([M07](../../plans/M07-risk-abuse.md)) | per detector cadence | per detector | run absent, or **canaries not found** | S2. A detector finding none of its own canaries is `degraded` and pages (GS-122) |
| **Loyalty derivation and divergence check** | nightly | 09:00 CT | divergence check absent | S2. It is the module's tamper detector |
| **Wallet dormancy scan** | daily | 09:00 CT | scan absent | S3, and it drives a 12 month notice schedule that cannot be reconstructed later |
| **Simulation harness** | nightly | 10:00 CT | run absent | S3, band breach pages ([SIMULATION_HARNESS](../../testing/SIMULATION_HARNESS.md) section 7.2) |
| **Reserve coverage and top-up trigger** | daily | 09:00 CT | evaluation absent | S2. [ADR-011](../../DECISIONS.md)'s same-day trigger is the control against a correlated wave inside the funding week |
| **Backup verification** | nightly | 04:00 CT | verification absent | S2. An unverified backup is a hope |
| **Freeze expiry sweep** | hourly | continuous | sweep absent | **S1 in effect.** A freeze that reaches expiry **releases** (GS-109), and a stalled sweep converts a bounded hold into an unbounded one, which is a denial nobody authorized |

## Calendar work, not cron

On the ops calendar with a named owner and a written result.

| Item | Cadence | Written result |
|---|---|---|
| **Restore drill** (VG-9) | quarterly | Target time, duration, all six checks, and anything in [RB-06](RB-06-restore-from-backup.md) that turned out to be wrong |
| **Key rotation drill** | quarterly | Which credentials, and any that could not be rotated cleanly |
| **Break-glass existence check** | quarterly | Seal intact, credential located. **Does not unseal** ([RB-09](RB-09-break-glass.md)) |
| **Secret rotation** | 90 days | Vault inventory against the rotation calendar |
| **Admin domain renewal** | annual, with a reminder | [ADR-012](../../DECISIONS.md): a lapsed admin domain is an outage with a hostile finder |
| **Signing key rotation** ([M11](../../plans/M11-certificates-social-proof.md)) | 90 days | Historical certificates still verify (GS-157), which is what stops the calendar quietly skipping this key forever |
| **Breach-notification contacts** | annual | Counsel contact and jurisdiction clocks current, per [RB-08](RB-08-security-incident.md) |
| **C8 monthly retro** | monthly | Thresholds reviewed: the top-up trigger, the escalation window, detector precision, the perk budget |

## The dead-man switch itself

**It runs outside the estate.** A dead-man switch hosted on the infrastructure it watches fails silently in exactly the scenario it exists for, which is the whole estate being down. It is an external check-in service, its own credential, and its own alert path, and **its absence is checked by a human on the monthly retro**, because there is no fourth level of watcher and pretending otherwise is how this becomes turtles.
