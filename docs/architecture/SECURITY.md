---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, API_CONTRACT.md, DATA_MODEL.md, ../../research/SECURITY_LANDSCAPE.md, ../../research/VIBE_FAILURE_POSTMORTEMS.md]
last_updated: 2026-08-13
---

# Security Architecture (Constitution Appendix D, instantiated)

Merit's threat model per asset, the control catalogue, and the mapping from every control to the endpoint, table, or job that implements it. This document is the **instantiation**; the landscape research, baseline standards, and the ten D0 attack scenarios live in [research/SECURITY_LANDSCAPE.md](../../research/SECURITY_LANDSCAPE.md) and are referenced, not repeated.

Baselines adopted: **OWASP ASVS 5.0 Level 2** across the application (Level 3 controls on the payout and ledger path where practical), and the **OWASP API Security Top-10 (2023)** as the primary threat frame for [API_CONTRACT](API_CONTRACT.md).

## 1. Control catalogue

Controls carry stable IDs so plans, tests, and code comments can cite them.

| ID | Control | Where it lives |
|---|---|---|
| C-01 | Passwordless only: passkeys plus email OTP. No password column exists anywhere | [DATA_MODEL](DATA_MODEL.md) has no password table by construction |
| C-02 | Short-lived access session, rotating refresh, httpOnly Secure SameSite cookies | `sessions` |
| C-03 | Identity scoping through `scopedDb(identity)`; raw table access lint-blocked | every handler |
| C-04 | Zod validation at every boundary, request and response allowlists | every endpoint |
| C-05 | Idempotency keys on all mutating endpoints and outbound money operations | `idempotency_keys`, `payout_transfers` |
| C-06 | Webhook HMAC verification before parsing, plus timestamp and nonce replay window | all `/webhooks/*` |
| C-07 | Rate limits per IP and per identity, plus Turnstile on auth, checkout, payout | edge and app |
| C-08 | RBAC on admin, admin on a separate origin, IP allowlist, hardware-key SSO | admin app |
| C-09 | Append-only tables enforced by database grants (no UPDATE, no DELETE) | events, ledger, fills, marks, rule_states, admin_actions |
| C-10 | Dual control plus delay window on cap, split, gap, and treasury credential changes | `POST /admin/plans/versions/:id/publish` |
| C-11 | Payout destination change triggers 48 hour cooling and re-verification | KYC machine, `payout_transfers` |
| C-12 | Rise payout name must match the KYC-verified identity | `payout_transfers.destination_name_match` |
| C-13 | PII minimization: no documents, no PANs, hashed signals only | `identity_signals`, `kyc_verifications` |
| C-14 | Secrets in the platform vault only, 90 day rotation, never in client output | INFRA gates VG-1, VG-2 |
| C-15 | Least-privilege database roles: app role has no DDL and no DELETE on append-only tables | INFRA |
| C-16 | Egress allowlist on the worker; no user-supplied host is ever fetched server-side | worker |
| C-17 | Structured logs with PII and token redaction; audit trail separated from debug logs | INFRA |
| C-18 | Named negative-authz test per endpoint per resource, in CI | [API_CONTRACT §12](API_CONTRACT.md#12-negative-authz-test-matrix-d5-required-in-ci) |
| C-19 | Canary tokens in the database and repository as tripwires | INFRA |
| C-20 | Alerting on admin login, failed-auth bursts, payout-config changes, role grants, SFTP failures, out-of-hours admin actions | INFRA |
| C-21 | Server-authoritative pricing, eligibility, and clamping; the client can only ever reduce a payout | checkout, payout endpoints |
| C-22 | OpenAPI and docs endpoints return 404 in production; `/internal/*` only on the admin origin | API |

## 2. Crown jewels and STRIDE

Six assets, each with the threats that actually apply and the controls that answer them. Threats are named as STRIDE categories: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege.

### 2.1 Treasury and payout path

The asset: the ability to cause money to leave Merit.

| Threat | Concrete scenario | Controls |
|---|---|---|
| S | Attacker with a stolen session requests a payout to their own destination | C-01, C-02, C-11, C-12, C-07 |
| T | Client tampers `amount_cents` or a price field to extract more than earned | C-21 (clamp is server-side; the request is a ceiling), C-04 |
| T | Forged Rise settlement webhook marks an unsent transfer as settled | C-06, plus settlement matched to an existing transfer id |
| R | Dispute over whether a payout was owed | immutable `eligibility_snapshot`, pinned `plan_version`, [evidence pack](../GLOSSARY.md#evidence-pack) |
| I | Payout history of one trader visible to another | C-03, C-18 |
| D | Payout endpoint flooded on a promo day | C-07, and the queue absorbs transfer work asynchronously |
| E | Ops role escalates to change split or cap | C-08, C-10, C-20 |

Additional payout-specific hardening (D4) is detailed in §4.

### 2.2 Identity graph and PII

The asset: the resolved-human graph, including device, payment, and verification signals.

| Threat | Scenario | Controls |
|---|---|---|
| I | Breach exposes fingerprints and lets an attacker correlate real people | C-13 (values stored as hashes with only non-identifying previews), C-15, encryption at rest |
| I | Evidence pack export leaks an entire trader dossier | export is audited (`evidence.pack_exported`), signed time-limited URL, private storage, `reason` required |
| T | Attacker edits links to break an investigation | C-09 (identity_links and merges are append-only) |
| I | KYC documents leak (the Tea failure) | documents never touch Merit storage; we hold status plus provider refs only |
| E | Support social-engineering to swap an identity's email or destination | no support-initiated identity change without the verification runbook; C-11 |

### 2.3 Admin console

The asset: one owned admin equals total loss.

| Threat | Scenario | Controls |
|---|---|---|
| S | Phished admin credential | hardware-key SSO (phishing-resistant), C-08 |
| E | Trader token reaches an admin function | C-08, C-18 (explicit test), server-side RBAC |
| T | Silent plan-config edit as economic sabotage | C-10, published versions immutable by trigger, C-20 alert on any cap/split/gap change |
| R | Admin action later denied | `admin_actions` append-only with actor, reason, before, after |
| I | Admin origin discoverable and probeable | separate origin, IP allowlist, no links from public surfaces, C-22 |

### 2.4 Rithmic SFTP credentials

The asset: provisioning forgery equals free funded accounts.

| Threat | Scenario | Controls |
|---|---|---|
| S | Stolen keypair used to upload forged provisioning files | keypair scoped to the worker, egress-restricted (C-16), rotated on schedule, never in the repo (C-14) |
| T | Tampered inbound report inflates balances | reconciliation compares our computed balance against the vendor's stated balance; whole-file quarantine on validation failure; digests recorded |
| R | Dispute over what was provisioned | `provisioning_queue` plus `ingest_files` digests are the record |
| D | SFTP unavailable | queue with retry and alerting; batch is arrival-triggered, so a late file delays rather than corrupts |

### 2.5 PSP and Rise webhook keys

| Threat | Scenario | Controls |
|---|---|---|
| S | Forged `payment.success` provisions a free account | C-06, and the unique index on `(psp, provider_event_id)` |
| T | Replayed settlement double-credits | C-05, C-06, replay window plus nonce |
| R | Provider claims an event we never processed | raw signed payloads retained 24 months in `psp_webhook_events` |

### 2.6 Trader sessions

| Threat | Scenario | Controls |
|---|---|---|
| S | Credential stuffing (the June 2025 industry incident) | C-01 removes the attack class entirely: there is no password to stuff |
| S | OTP interception or brute force | short TTL, single use, 5-attempt lock, C-07, no user enumeration in responses |
| E | Session fixation or token theft | C-02 rotation, httpOnly cookies, strict CSP, no tokens in local storage |
| I | IDOR across accounts | C-03, C-18, and `404` rather than `403` on trader surfaces |

### 2.7 The founder (the human asset)

SIM-swap and phishing against the one person who can do everything: hardware keys on every account that matters, carrier port-lock, separated identities for firm and personal, recovery contacts audited, and no SMS-based second factor anywhere in the stack. This is listed as an asset because for a solo operator it genuinely is one.

## 3. Per-endpoint control map

The [D0 checklist](../../research/SECURITY_LANDSCAPE.md) mapped onto the real endpoints from [API_CONTRACT](API_CONTRACT.md). Legend matches the control catalogue in §1.

| Endpoint | Primary risks (API Top-10) | Controls |
|---|---|---|
| `POST /auth/otp` | API2, API4, API6 | C-01, C-04, C-07 plus Turnstile, no enumeration |
| `POST /auth/verify` | API2 | C-01, C-02, C-04, C-07, attempt lockout |
| `POST /auth/passkey/*` | API2 | C-01, C-02, C-04, C-07 |
| `GET /me` | API1, API3 | C-02, C-03, response allowlist |
| `GET /plans`, `GET /plans/:id/versions/:v` | API8 | C-04, public cache, no injection surface |
| `POST /checkout` | API6, payment fraud, coupon race | C-04, C-05, C-07, C-21, atomic coupon claim, AVS and CVV strictness, per-entity and per-BIN velocity |
| `POST /accounts/:id/reset` | API1, API6 | C-03, C-04, C-05, C-07 |
| `POST /webhooks/psp/:provider` | API10 | C-06, C-05, C-04, raw payload retention |
| `GET /accounts`, `/accounts/:id`, `/marks`, `/timeline` | **API1 (top risk)** | C-03, C-04, C-18, 404-not-403 |
| `GET /accounts/:id/eligibility` | API1, API3 | C-03, C-04, caller-only gate data |
| `POST /accounts/:id/payout` | **crown jewel**: API1, API5, API6 | C-03, C-04, C-05, C-07, C-11, C-12, C-21, C-18, freeze and recon and KYC gates upstream |
| `GET /payouts` | API1 | C-03, C-04 |
| `GET /accounts/:id/certificate` | API1, API3 | C-03, signed time-limited URL, private storage |
| `POST /kyc/session`, `GET /kyc/status` | API1, API3 | C-03, C-13, hosted provider flow (no document proxying) |
| `GET/POST /affiliate/*` | API1, self-dealing | C-03, C-04, self-purchase void, audited statements |
| `GET /admin/*` (reads) | API5 | C-08, C-18, admin origin only |
| `POST /admin/accounts/:id/{freeze,unfreeze,close,note}` | API5, insider abuse | C-08, C-04, audit row with reason, C-20 alert, freeze requires a cited flag |
| `GET /admin/identities/:id/graph`, `GET /admin/evidence/:id` | API1, PII exposure | C-08, audited export, signed URL, `reason` required |
| `POST /admin/plans/*` | config tampering | C-08, C-10, publish immutability trigger, C-20 |
| `POST /internal/batch/run`, `GET /internal/*` | API9 | C-08, C-22, guarded and idempotent |
| `GET /health` | information disclosure | minimal payload, no version or dependency detail |

## 4. Payout-path hardening (D4 in detail)

1. **Destination changes are the classic account-takeover cash-out vector.** Any change to a payout destination sets KYC to `expired`, starts a 48 hour cooling window during which payouts cannot settle, requires re-verification, and notifies the trader through a channel that was already on file.
2. **Name matching is mandatory.** Rise's payout identity is compared to the KYC-verified identity. A mismatch freezes the transfer and raises a `payout.name_mismatch_detected` flag rather than settling quietly. This is the payout-mule control from [adversary scheme 7](../../research/ADVERSARY_DOSSIER.md).
3. **Daily settlement-velocity ceiling** with an automatic page when exceeded. A correct-looking flood is still a flood.
4. **Rise credentials** are minimum-scope and IP-pinned, held only by the worker, rotated on the 90 day calendar, and changing them requires dual control plus a delay window.
5. **Anomaly alerting on admin actions** outside normal hours or geography, specifically freeze, unfreeze, close, and any plan-config change.
6. **The freeze contract:** a freeze requires at least one cited open flag and a ToS clause. This is enforced by the API, not by discipline, because the pressure to "just hold this one" arrives exactly when the money is largest.

## 5. Data protection and privacy

- **What Merit stores:** identifiers, statuses, hashes, and money. **What Merit never stores:** identity documents, biometric templates, card numbers, or raw bank details.
- **Encryption:** TLS 1.2 or higher in transit with HSTS; encryption at rest on the database and object storage; hashed signal values (C-13) so a database dump does not yield a usable device or payment identifier.
- **Retention** is specified per table in [DATA_MODEL §15](DATA_MODEL.md#15-retention-summary). Financial spine forever, operational ephemera on short clocks.
- **Deletion requests** redact PII columns and pseudonymize the identity while retaining the financial spine, because the ledger cannot lie about money that moved. The runbook records what was redacted and when.
- **Logs** are structured, with token and PII redaction at the logger, and the audit trail is separate from debug logging so one cannot be muted with the other.

## 6. Detection and response

**Security events that always alert:** admin login, failed-auth burst (per IP and global), any `/admin/plans/*` mutation, role grant or change, payout-destination change, `payout.name_mismatch_detected`, `ledger.invariant_violated`, `replay.divergence_detected`, `recon.mismatch_detected`, SFTP delivery failure, webhook signature failure spike, and canary-token access.

**Incident response** follows contain, rotate, notify, post-mortem, with comms templates written in advance ([ops runbooks](../ops/runbooks/README.md), Wave 4). The doctrine from the payout-trust research applies: honesty survives incidents, silence does not.

**security.txt and a vulnerability disclosure policy with safe harbor** ship from day one, because researchers who cannot find a channel publish instead.

## 7. Assurance

| Activity | Cadence | Gate |
|---|---|---|
| Named negative-authz test per endpoint per resource | every PR touching an endpoint | merge blocker (C-18) |
| Semgrep, dependency audit, secret scanning | every PR | merge blocker |
| ASVS 5.0 L2 structured self-assessment with logged findings | before public launch | launch gate |
| External pentest (or the self-assessment if budget-constrained) | before public launch | launch gate |
| Key rotation drill | quarterly | ops calendar |
| Restore-from-backup drill including payouts mid-queue | quarterly | ops calendar |
| D0-1 through D0-10 attack scenarios as tests | continuous in CI | merge blocker |

The ten D0 scenarios are specified in [research/SECURITY_LANDSCAPE.md §4](../../research/SECURITY_LANDSCAPE.md) and become numbered entries in `docs/testing/GOLDEN_SCENARIOS.md` during Wave 4.

## 8. Known limitations, stated plainly

1. **Cross-firm collusion is invisible to us** (adversary scheme 2). No control here detects a hedge whose other leg sits at another firm. The answer is bounding (caps, ladder, reserve), not detection, until a shared-vendor network is worth buying.
2. **Device and payment fingerprints are signals, never proof.** Every enforcement path requires human judgment plus an evidence pack, and no detector enforces on its own.
3. **T+1 visibility** means our own view of an account lags live trading by one batch cycle. Rithmic's auto-liquidator, not Merit, is the intraday control.
4. **A solo operator is a single point of failure** for admin access and dual control. The second `owner` credential (a separately stored hardware key) is the mitigation, and it is a real operational burden the founder is choosing on purpose.
5. **Dual control at launch scale is compromise resistance, not insider resistance.** Both `owner` credentials are held by the same person ([ADR-010](../DECISIONS.md)). What C-10 actually buys today is that one phished session or one owned laptop cannot move the cap, the split, the gap, or the payout rail alone. It is not separation of duties and must never be described as such in an audit, a policy document, or a customer conversation. It becomes separation of duties on the first operations hire, with no code change.

## 9. Founder rulings (Wave 2 gate, 2026-08-13) and remaining questions

1. **Second `owner` credential for dual control: CONFIRMED.** Two hardware keys, held by the founder in separate physical locations, before launch. The launch-scale limitation is recorded above as limitation 5 and in [ADR-010](../DECISIONS.md).
2. **Admin IP allowlist practicality:** confirm you operate from stable addresses, or accept a VPN or bastion as the allowlisted origin. **Still open**, and it now interacts with [ADR-012](../DECISIONS.md): the allowlist protects `ADMIN_ORIGIN`, a separate apex domain rather than a Merit subdomain.
3. **WAF vendor:** Cloudflare, **confirmed** with [ADR-007](../DECISIONS.md).
