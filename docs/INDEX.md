---
status: draft
depends_on: []
last_updated: 2026-08-14
---

# INDEX: The Map

Every doc in the corpus, one line each. **If a thing is not in this file, it does not exist.** Regenerated whenever any doc is added or changes status. Status values: `draft | review | approved | frozen`. Owner is who moves the doc to its next status (claude drafts; founder approves gates).

## Root
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [MERIT_BUILD_MASTER_PROMPT.md](../MERIT_BUILD_MASTER_PROMPT.md) | The constitution. Read-only; amendments via DECISIONS.md | approved | founder |
| [CLAUDE.md](../CLAUDE.md) | Lean session brain: rituals, git workflow, conventions, model routing | draft | founder |
| [.claude/settings.json](../.claude/settings.json) | Committed hook set. Corpus phase: `SessionStart` pull, `Stop` push ([ADR-D1](DECISIONS.md)) | approved | founder |

## Tracking (living docs, updated every session)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [INDEX.md](INDEX.md) | This map | draft | claude |
| [STATE.md](STATE.md) | One screen: wave, gate, done / in-flight / blocked, next 3 actions | draft | claude |
| [SESSION_LOG.md](SESSION_LOG.md) | Append-only handoff journal (C3 ritual) | draft | claude |
| [DECISIONS.md](DECISIONS.md) | ADRs: every choice with rationale and alternatives | draft | founder |
| [EDGE_CASES.md](EDGE_CASES.md) | Living registry; every bug becomes an entry plus a golden file (82 entries; EC-001 to EC-050 approved with M01, EC-051+ under review with their module) | approved | founder |
| [GLOSSARY.md](GLOSSARY.md) | Every domain term defined once; all docs link here | approved | founder |

## research/ (Wave 1: next up)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [PROP_TECH_LANDSCAPE.md](../research/PROP_TECH_LANDSCAPE.md) | Section 1: 8+ vendor teardown, feature matrix, MUST/SHOULD/LATER | approved | founder |
| [TOP10_FIRMS.md](../research/TOP10_FIRMS.md) | Section 1B: firm surveillance one-pagers, refreshed monthly | approved | founder |
| [ADVERSARY_DOSSIER.md](../research/ADVERSARY_DOSSIER.md) | Appendix A instantiated with current scheme intel | approved | founder |
| [DATA_CAPABILITIES.md](../research/DATA_CAPABILITIES.md) | B3: platform data matrix (Rithmic/Tradovate/dxFeed/...) | approved | founder |
| [SECURITY_LANDSCAPE.md](../research/SECURITY_LANDSCAPE.md) | D0: breach history, control checklist, B4 additions | approved | founder |
| [VIBE_FAILURE_POSTMORTEMS.md](../research/VIBE_FAILURE_POSTMORTEMS.md) | Appendix E: incident studies converted to named CI gates | approved | founder |
| [CLAUDE_CODE_PLAYBOOK.md](../research/CLAUDE_CODE_PLAYBOOK.md) | C0: community practice, merged monthly | approved | founder |

## docs/architecture/ (Wave 2: APPROVED at the gate, 2026-08-13)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [OVERVIEW.md](architecture/OVERVIEW.md) | System diagram, module map, end-to-end data flow | approved | founder |
| [DATA_MODEL.md](architecture/DATA_MODEL.md) | Every table, column, type, index, constraint, retention | approved | founder |
| [API_CONTRACT.md](architecture/API_CONTRACT.md) | B2 expanded: every endpoint, schemas, errors | approved | founder |
| [EVENTS.md](architecture/EVENTS.md) | Every event: name, payload schema, producer, consumers | approved | founder |
| [STATE_MACHINES.md](architecture/STATE_MACHINES.md) | Account / payout / flag / identity lifecycles as Mermaid | approved | founder |
| [INFRA.md](architecture/INFRA.md) | Environments, deploy pipeline, backups, cost guards, E doctrine | approved | founder |
| [SECURITY.md](architecture/SECURITY.md) | Appendix D instantiated: per-asset threat model and control map | approved | founder |

## docs/plans/ (Wave 3, dependency order, M1 first always. **Batch 1 gate closed 2026-08-14; batch 2 in progress**)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [M01-rules-engine.md](plans/M01-rules-engine.md) | The crown jewel: 50-rule taxonomy, pure library, replay self-audit. **Gate closed 2026-08-13** | approved | founder |
| [M02-rithmic-bridge.md](plans/M02-rithmic-bridge.md) | Provisioning CSVs, ingest, reconciliation, simulator, streaming path, **16 vendor-confirmation items**. Held at `review` by [ADR-005](DECISIONS.md) until the vendor call | review | founder |
| [M03-billing-checkout.md](plans/M03-billing-checkout.md) | PSP abstraction, coupons, resets, chargeback handling, MID failover, **wallet as a payment method** | approved | founder |
| [M04-trader-portal.md](plans/M04-trader-portal.md) | Next.js portal: dashboard, payout center, **wallet screen**, **indicative live layer**, certificates, Appendix F gate | approved | founder |
| [M05-payout-system.md](plans/M05-payout-system.md) | **Two-leg payouts**: instant wallet credit, external rail withdrawal, ledger, bounded freeze, reserve | approved | founder |
| [M06-admin-ops-console.md](plans/M06-admin-ops-console.md) | Liability dashboard **including wallet balances**, CUSUM, breakers, two-tier evidence packs, dual control | approved | founder |
| [M07-risk-abuse.md](plans/M07-risk-abuse.md) | Entity resolution two-tier, **14 detectors**, copy-trading clause, flags queue, canaries | approved | founder |
| [M08-affiliate-system.md](plans/M08-affiliate-system.md) | Attribution, commissions, clawbacks, destination cooling, NFA I-26-12 creative approval | approved | founder |
| [M09-marketing-site.md](plans/M09-marketing-site.md) | Config-rendered plans and rules, publish-ordered revalidation, stats render, versioned legal and content, geo disclosure | review | founder |
| [M10-integrations.md](plans/M10-integrations.md) | One outbound bus: contract allowlists, send-time suppression, support-context scoping, replica exclusion, vendor-down chaos | review | founder |
| [M11-certificates-social-proof.md](plans/M11-certificates-social-proof.md) | Issuance, signing key lifecycle, non-enumerable verification, revocation classes, deferred per-trade cards, opt-in leaderboard | review | founder |
| [M12-transparency-platform.md](plans/M12-transparency-platform.md) | **Launch differentiator.** Seven auto-computed statistics with versioned definitions, immutable history and restatement, proof links, compliant review requests | review | founder |
| [M13-trader-analytics-journal.md](plans/M13-trader-analytics-journal.md) | Per-account analytics read from engine tables, versioned round-trip derivation, private journal, load isolation from the payout path | review | founder |
| [M14-loyalty-retention.md](plans/M14-loyalty-retention.md) | Derived loyalty state, cap release only via the dual-controlled publish path, recognition-not-economics streaks, inverted win-back targeting, ADR-019a compositional rule | review | founder |
| [M15-discord-integration.md](plans/M15-discord-integration.md) | Per-role consent, one-way link that is never a credential, template-only announcements, moderation separated from enforcement. Post-launch per constitution section 10 | review | founder |
| [M16-notification-center.md](plans/M16-notification-center.md) | Four notification classes deciding what a preference may silence, contact-change ceremony with prior-contact window, identity coalescing, template allowlist | review | founder |
| [M17-offers-engine.md](plans/M17-offers-engine.md) | Server-authoritative price resolution, dual-controlled price floors, identity-bound offers, promotional credit provenance, experiments that cannot vary a rule | review | founder |
| [M18-live-graduation-pipeline.md](plans/M18-live-graduation-pipeline.md) | Ladder finiteness disclosed pre-purchase, mechanical graduation, terminal settlement, accrued-only vault. **Carries the live-program regulatory finding** | review | founder |
| [M19-kyc-identity.md](plans/M19-kyc-identity.md) | Placement as pinned config, dedupe as a relationship with dispositions, sanctions carve-out, real re-verification, minimization with durable evidence, funnel telemetry | review | founder |

## docs/testing/, ops/, design/, legal/ (Wave 4)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [STRATEGY.md](testing/STRATEGY.md) | Section 5 instantiated with tooling choices | draft | claude |
| [GOLDEN_SCENARIOS.md](testing/GOLDEN_SCENARIOS.md) | Every B4 scenario plus inventions, numbered (**141 defined**; GS-001 to GS-083 approved with M01, GS-084 to GS-141 approved with their module except M02's) | approved | founder |
| [SIMULATION_HARNESS.md](testing/SIMULATION_HARNESS.md) | Monte-Carlo population port spec, CI calibration bands. Carries the Wave 4 inputs the gate rulings changed | draft | claude |
| [ops/runbooks/README.md](ops/runbooks/README.md) | Section 7: one runbook per failure class | draft | claude |
| [design/DESIGN_SYSTEM.md](design/DESIGN_SYSTEM.md) | Appendix F instantiated: tokens locked before any UI | draft | claude |
| [legal/README.md](legal/README.md) | ToS/disclosure drafts, sim-language blocks, geo list. Carries the copy-trading clause and the wallet counsel agenda | draft | claude |
