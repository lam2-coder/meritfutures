---
status: review
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ADVERSARY_DOSSIER.md]
last_updated: 2026-08-13
---

# Security Landscape (Constitution Appendix D0)

Prop-firm/trading-platform breach history, fintech incident patterns, an OWASP ASVS L2 + API Top-10 baseline, a control checklist mapped to every B2 endpoint, and 10 attack scenarios to merge into the B4 battery. Researched 2026-08-13; citations inline. This doc feeds architecture/SECURITY.md (Wave 2) and the per-module STRIDE one-pagers.

## 1. Breach history and incident patterns

### 1.1 The defining prop-firm incident: the June 2025 password panic

The single most instructive event for Merit. In June 2025, traders across **Topstep, MyFundedFutures, and Apex** received unsolicited password-reset emails; many were locked out, some reported phantom purchases. The firms stated their own systems were not compromised. Analysis pointed to a **breach at Fast Track Trading (FTT)** that exposed emails, passwords, and password-reset links for thousands of traders; the leaked credentials enabled **credential stuffing and domain-mimicking phishing** against the other firms. Topstep force-reset all passwords "out of an abundance of caution," noting it uses tokenization and PCI-compliant providers so card data was never at risk. ([PropInsider](https://propinsider.com/prop-firm-password-panic/), [Topstep on X](https://x.com/Topstep/status/1931196489776123985), [T3 analysis](https://x.com/T3metrics/status/1931387798709223623))

**Lessons that shape Merit's controls:**
- **Credential stuffing against trader dashboards is THE documented #1 prop attack** (constitution D0 confirmed). One firm's breach becomes every firm's attack because traders reuse passwords. **Merit's passwordless-only posture (passkeys + OTP, no password DB) removes the entire target class** — there is no password to stuff, reset-link to leak, or hash to crack. This is the highest-leverage control in the whole appendix and it is already constitutional (D2).
- The forced-reset scramble is what firms WITH passwords must do; Merit should never be in that position. The lesson to internalize: our authentication design is a moat, not a feature.
- Phantom purchases during the incident show ATO → checkout abuse is the immediate monetization; our checkout must be identity- and session-bound with re-auth on payment-method actions.

### 1.2 Credential stuffing and ATO at industry scale

- Stolen credentials drove ~22% of confirmed breaches in 2025, the single most common initial-access vector. A 24-billion-record credential corpus enriched with live CVE data surfaced June 2026; OpenBullet 2 is the commodity stuffing tool. ([Secureframe 2025 breaches](https://secureframe.com/blog/top-data-breaches-2025), [TechTimes](https://www.techtimes.com/articles/318746/20260620/credential-stuffing-risk-spikes-24-billion-stolen-passwords-linked-live-exploit-data.htm))
- ATO fraud cost ~$16B in 2024; 42% of victims closed the affected account; damage spans the whole lifecycle — login, MFA, session handling, account recovery, profile changes, payment workflows, APIs. Consumer ATO becomes "checkout fraud, payout diversion, loyalty theft, stored-payment abuse." **Payout diversion is our crown-jewel exposure** and maps directly to D4's payout-destination-change hardening. ([DeepStrike ATO stats](https://deepstrike.io/blog/account-takeover-statistics))
- Behavioral biometrics detect ATO even with valid credentials because a behavior profile cannot be credential-stuffed — a future signal source, noted, not v1.

### 1.3 Fintech breach patterns (the shape of the threat)

- Fintech took ~27% of breaches with ~$5.9M average loss; a recurring vector is **offboarding failure** (departed staff retain access) — for a solo founder this is a future-hire runbook item, logged now. ([DeepStrike fintech stats](https://deepstrike.io/blog/fintech-breach-statistics-2025))
- **Insider/contractor access** is a live 2026 pattern (Coinbase confirmed a contractor improperly accessed customer data, disclosed Feb 2026). Maps to Merit's least-privilege DB roles + audited admin actions + the "agent never holds prod write creds" rule. ([Enzoic](https://www.enzoic.com/blog/qantas-draftkings-and-other-recent-breaches/))
- The vibe-coded application breach class (Moltbook secrets, Lovable/Base44 broken authz, Tea public bucket, Replit prod-DB deletion) is handled in its own doc: [VIBE_FAILURE_POSTMORTEMS.md](VIBE_FAILURE_POSTMORTEMS.md). Those are Merit's exact stack risks and become CI gates there.

## 2. Baseline standards adopted

### 2.1 OWASP ASVS 5.0, Level 2

ASVS 5.0 (released May 2025, the biggest update in six years): ~350 requirements across 17 chapters; L1 streamlined, L2/L3 scale up; password rules aligned to NIST SP 800-63; dedicated web-frontend-security and self-contained-token (JWT) chapters; post-quantum crypto guidance. **Merit targets L2** (the standard for apps handling sensitive data/money; L3 reserved for the payout/ledger path where practical). ([SoftwareMill ASVS 5.0](https://softwaremill.com/whats-new-in-asvs-5-0/), [Codific](https://codific.com/owasp-asvs-a-comprehensive-overview/)) The pre-launch assessment (D5) is a structured ASVS-L2 self-assessment with logged findings, or an external pentest if budget allows.

### 2.2 OWASP API Security Top-10 (2023) — the primary threat model for B2

Authorization dominates: three of the top five are access-control failures. This is exactly the AI-code failure class (see VIBE doc E2) and exactly our crown-jewel surface.

| ID | Risk | Merit relevance |
|---|---|---|
| API1 | Broken Object Level Authorization (BOLA/IDOR) | **THE dashboard bug.** `GET /accounts/:id` must be identity-scoped. Controlled by `scopedDb(identity)` + per-resource negative test. |
| API2 | Broken Authentication | Passwordless removes password attacks; OTP/passkey flows still need rate-limit + replay protection. |
| API3 | Broken Object Property Level Authorization | Never return/accept fields the caller can't see/set (e.g., a trader setting their own `withdrawable`). Zod response allowlists. |
| API4 | Unrestricted Resource Consumption | Rate limits per IP+identity on auth/checkout/payout; cursor pagination caps. |
| API5 | Broken Function Level Authorization | Admin endpoints (`/admin/*`) RBAC-gated; a trader token must 403 on admin functions. |
| API6 | Unrestricted Access to Sensitive Business Flows | Payout, checkout, reset flows need anti-automation (Turnstile) + velocity limits (also scheme-7/8 defense). |
| API7 | SSRF | Webhook/callback URLs and any fetch never take user-supplied hosts; allowlist egress (also slopsquatting registry posture). |
| API8 | Security Misconfiguration | CSP/HSTS/frame-deny; `/docs`/`/openapi.json` gated in prod; no default creds. |
| API9 | Improper Inventory Management | OpenAPI is the inventory; `/internal/*` behind admin origin; no shadow/undocumented endpoints. |
| API10 | Unsafe Consumption of APIs | Verify Rithmic/Rise/PSP responses; sign+verify webhooks; treat third-party data as untrusted (zod at ingest). |

([OWASP API Top-10 2023](https://owasp.org/www-project-api-security/), [2023 release notes](https://owasp.org/blog/2023/07/03/owasp-api-top10-2023))

## 3. Control checklist mapped to B2 endpoints

Legend for controls: **PW** passwordless/session, **RL** rate-limit (IP+identity), **ID** identity-scoped (`scopedDb`), **ZB** zod-at-boundary, **IK** idempotency key, **SW** signed webhook (HMAC+timestamp+nonce), **RB** RBAC, **AU** audit row, **NA** named negative-authz test in CI, **AB** anti-bot (Turnstile), **DC** dual-control/cooling window.

| Endpoint (B2) | Primary risks | Required controls |
|---|---|---|
| `POST /auth/otp`, `/auth/verify`, `/auth/passkey/*` | API2, API4, stuffing, phishing | PW, RL, AB, ZB; OTP single-use + short TTL + attempt lockout; no user-enumeration in responses |
| `GET /me` | API1 | PW, ID |
| `GET /plans`, `/plans/:id/version/:v` | API8, cache poisoning | ZB; public read; served from plan_versions (no injection surface) |
| `POST /checkout` | API6, payment fraud, coupon race | PW, RL, AB, ZB, IK; AVS/CVV strict; per-entity/BIN velocity; single-use-coupon atomic claim (B4 #11) |
| `POST /webhooks/psp/:provider` | API10, forged events, replay | SW, IK, ZB; verify signature before parse; idempotent purchase pipeline (B4 #9) |
| `POST /accounts/:id/reset` | API1, API5, reset abuse | PW, ID, RL, ZB, IK, AU |
| `GET /accounts`, `/accounts/:id`, `/marks`, `/timeline` | **API1 (BOLA — top risk)** | PW, ID, NA (user B cannot read account A → 403); ZB response allowlist (API3) |
| `GET /accounts/:id/eligibility` | API1, API3 info leak | PW, ID; return only the caller's gate breakdown |
| `POST /accounts/:id/payout` | **crown jewel**: API1/API5/API6, payout diversion | PW, ID, RL, AB, IK, AU, NA; server-authoritative eligibility snapshot; clamp server-side; destination-change 48h cooling + re-verify (D4); frozen-account gate |
| `GET /payouts` | API1 | PW, ID |
| `POST /webhooks/rise` | API10, forged settlement, replay | SW, IK, ZB; one settlement per idempotency key (B4 #8) |
| `GET/POST /affiliate/*` | API1, self-dealing, statement tampering | PW, ID, ZB, AU; self-purchase void (scheme 9) |
| `GET /admin/liability`,`/eligible-forecast`,`/loss-ratios`,`/cusum`,`/flags` | API5, admin exposure | PW, RB, NA (trader token 403); separate admin origin + IP allowlist + hardware-key SSO (D3) |
| `POST /admin/accounts/:id/{freeze\|close\|note}` | API5, insider abuse | PW, RB, ZB, AU (actor/reason/before-after); alert on action |
| `GET /admin/identities/:id/graph`, `/admin/evidence/:accountId` | PII exposure, API1 | PW, RB, AU; evidence export logged; PII-min |
| `POST /admin/plans/:id/versions` | config tampering (silent economic sabotage) | PW, RB, ZB, AU, DC (dual-control on cap/split/gap edits, D4); new version never mutates existing accounts (B4 #12) |
| `POST /internal/batch/run`, `GET /internal/recon/status` | API9, unauthorized trigger | admin-origin only; PW, RB, AU; guarded/idempotent (B4 #18) |
| `GET /health` | info leak | minimal payload; no version/stack disclosure |

Cross-cutting (every endpoint): TLS/HSTS; strict CSP + frame-deny; parameterized queries only; secrets in vault (90-day rotation); structured logs with PII/token redaction; append-only audit+events (no UPDATE/DELETE grant to app role); `/docs` and `/openapi.json` return 401/404 in prod.

## 4. Ten attack scenarios for the B4 battery (D0 additions, numbered D0-1..D0-10)

Each becomes a golden/chaos/integration test. These extend Appendix B4 (which ends at #22).

- **D0-1 Credential-stuffing storm.** 50k login attempts from a leaked-credential list across 5k emails in 10 min. Expected: passwordless flow has nothing to stuff; OTP endpoint rate-limits per IP+identity, Turnstile triggers, no account lockout DoS of legit users, alert fires on the burst. (Directly models the June 2025 event.)
- **D0-2 IDOR sweep.** Authenticated user B enumerates `/accounts/{1..N}`, `/accounts/N/marks`, `/accounts/N/timeline`, `/payouts` for accounts they don't own. Expected: every cross-owner request 403; CI has a named negative test per resource; zero object-property leakage.
- **D0-3 Payout destination swap (ATO cash-out).** Attacker with a hijacked session changes Rise payout destination, then requests payout. Expected: destination change forces 48h cooling + re-verification; payout blocked during cooling; alert on out-of-hours/geo change; Rise-name-vs-KYC mismatch freezes (scheme 7).
- **D0-4 Forged Rise settlement webhook.** POST to `/webhooks/rise` with a fabricated settled event and no/invalid signature, plus a replay of a valid one 50×. Expected: signature verification rejects the forgery; nonce/timestamp window rejects replays; exactly one settlement applied (B4 #8 hardened).
- **D0-5 Forged PSP success.** `/webhooks/psp` receives a spoofed `payment.success` for an unpaid order. Expected: HMAC verify fails closed; no account provisioned; alert. Legit duplicate/out-of-order delivery still resolves to one correct state (B4 #9).
- **D0-6 Admin function via trader token.** Trader-scoped token calls `/admin/*` and `/internal/batch/run`. Expected: 403/404; RBAC enforced server-side; admin origin rejects non-allowlisted IP even with a valid token.
- **D0-7 Plan-config tampering.** Compromised ops credential edits a live plan_version's cap/split/gap. Expected: dual-control blocks a single-actor change; change creates a new version (existing accounts untouched, B4 #12); audit + alert on any cap/split/gap edit.
- **D0-8 Coupon/checkout business-flow abuse.** Automated script mass-redeems a single-use code across tabs/bots and probes price manipulation via client-set fields. Expected: atomic single-use claim (B4 #11); server-authoritative pricing from plan_versions (API3); Turnstile + velocity throttle.
- **D0-9 SSRF via webhook/callback config.** An admin/affiliate field accepting a URL is set to an internal metadata address. Expected: egress allowlist blocks internal hosts; no user-supplied host is ever fetched server-side.
- **D0-10 OpenAPI/spec exposure in prod.** Requests to `/docs`, `/openapi.json`, `/swagger`, and undocumented `/internal/*` from the public origin. Expected: 401/404 in prod config (CI test runs against prod build); internal endpoints unreachable off the admin origin (API9).

## 5. Contradictions / notes

- **No constitution contradictions.** Every D0 control already has a home in D1-D5; this doc instantiates them against real 2025-26 incidents and the current OWASP baselines.
- **Confirmation, not amendment:** the June 2025 prop-firm password panic empirically validates the passwordless-only decision — the industry's #1 attack literally could not land on Merit's auth design. Worth quoting in M4/M9 trust copy (carefully, without overclaiming).
- **Standard version pins for Wave 2:** target **ASVS 5.0 Level 2** (L3 on payout/ledger where practical); threat-model against **API Security Top-10 2023**; also review **OWASP Top-10 2025** (web) when writing architecture/SECURITY.md. ([OWASP Top-10 2025](https://owasp.org/Top10/2025/))
- **New backlog items surfaced (not in constitution, logged for future runbooks/plans):** employee-offboarding access-revocation runbook (relevant at first hire); contractor/insider least-privilege review; behavioral-biometrics as a future ATO signal (post-v1). None block v1; none require a constitution amendment.
