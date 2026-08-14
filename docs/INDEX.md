---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# INDEX: The Map

Every doc in the corpus, one line each. **If a thing is not in this file, it does not exist.** Regenerated whenever any doc is added or changes status. Status values: `draft | review | approved | frozen`. Owner is who moves the doc to its next status (claude drafts; founder approves gates).

## Root
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [MERIT_BUILD_MASTER_PROMPT.md](../MERIT_BUILD_MASTER_PROMPT.md) | The constitution. Read-only; amendments via DECISIONS.md | approved | founder |
| [CLAUDE.md](../CLAUDE.md) | Lean session brain: rituals, conventions, model routing | draft | founder |

## Tracking (living docs, updated every session)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [INDEX.md](INDEX.md) | This map | draft | claude |
| [STATE.md](STATE.md) | One screen: wave, gate, done / in-flight / blocked, next 3 actions | draft | claude |
| [SESSION_LOG.md](SESSION_LOG.md) | Append-only handoff journal (C3 ritual) | draft | claude |
| [DECISIONS.md](DECISIONS.md) | ADRs: every choice with rationale and alternatives | draft | founder |
| [EDGE_CASES.md](EDGE_CASES.md) | Living registry; every bug becomes an entry plus a golden file | draft | claude |
| [GLOSSARY.md](GLOSSARY.md) | Every domain term defined once; all docs link here | draft | claude |

## research/ (Wave 1: next up)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [PROP_TECH_LANDSCAPE.md](../research/PROP_TECH_LANDSCAPE.md) | Section 1: 8+ vendor teardown, feature matrix, MUST/SHOULD/LATER | review | founder |
| [TOP10_FIRMS.md](../research/TOP10_FIRMS.md) | Section 1B: firm surveillance one-pagers, refreshed monthly | review | founder |
| [ADVERSARY_DOSSIER.md](../research/ADVERSARY_DOSSIER.md) | Appendix A instantiated with current scheme intel | review | founder |
| [DATA_CAPABILITIES.md](../research/DATA_CAPABILITIES.md) | B3: platform data matrix (Rithmic/Tradovate/dxFeed/...) | review | founder |
| [SECURITY_LANDSCAPE.md](../research/SECURITY_LANDSCAPE.md) | D0: breach history, control checklist, B4 additions | review | founder |
| [VIBE_FAILURE_POSTMORTEMS.md](../research/VIBE_FAILURE_POSTMORTEMS.md) | Appendix E: incident studies converted to named CI gates | draft | claude |
| [CLAUDE_CODE_PLAYBOOK.md](../research/CLAUDE_CODE_PLAYBOOK.md) | C0: community practice, merged monthly | draft | claude |

## docs/architecture/ (Wave 2)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [OVERVIEW.md](architecture/OVERVIEW.md) | System diagram, module map, end-to-end data flow | draft | claude |
| [DATA_MODEL.md](architecture/DATA_MODEL.md) | Every table, column, type, index, constraint, retention | draft | claude |
| [API_CONTRACT.md](architecture/API_CONTRACT.md) | B2 expanded: every endpoint, schemas, errors | draft | claude |
| [EVENTS.md](architecture/EVENTS.md) | Every event: name, payload schema, producer, consumers | draft | claude |
| [STATE_MACHINES.md](architecture/STATE_MACHINES.md) | Account / payout / flag / identity lifecycles as Mermaid | draft | claude |
| [INFRA.md](architecture/INFRA.md) | Environments, deploy pipeline, backups, cost guards, E doctrine | draft | claude |
| [SECURITY.md](architecture/SECURITY.md) | Appendix D instantiated: per-asset threat model and control map | draft | claude |

## docs/plans/ (Wave 3, dependency order, M1 first always)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [M01-rules-engine.md](plans/M01-rules-engine.md) | The crown jewel: full rule taxonomy, pure library | draft | claude |
| [M02-rithmic-bridge.md](plans/M02-rithmic-bridge.md) | Provisioning CSVs, ingest, reconciliation, simulator | draft | claude |
| [M03-billing-checkout.md](plans/M03-billing-checkout.md) | PSP abstraction, coupons, resets, chargeback handling | draft | claude |
| [M04-trader-portal.md](plans/M04-trader-portal.md) | Next.js portal: dashboard, payout center, certificates | draft | claude |
| [M05-payout-system.md](plans/M05-payout-system.md) | Instant auto-approve pipeline, Rise, freeze path, reserve | draft | claude |
| [M06-admin-ops-console.md](plans/M06-admin-ops-console.md) | Liability dashboard, CUSUM, circuit breakers, evidence packs | draft | claude |
| [M07-risk-abuse.md](plans/M07-risk-abuse.md) | Entity resolution, detectors, flags queue | draft | claude |
| [M08-affiliate-system.md](plans/M08-affiliate-system.md) | Attribution, commissions, NFA I-26-12 hooks | draft | claude |
| [M09-marketing-site.md](plans/M09-marketing-site.md) | Config-rendered plans/rules, stats page, legal pages | draft | claude |
| [M10-integrations.md](plans/M10-integrations.md) | Chatwoot, Metabase, Loops, Sentry, Discord alerts | draft | claude |
| [M11-certificates-social-proof.md](plans/M11-certificates-social-proof.md) | Signed, verifiable pass/payout share cards | draft | claude |
| [M12-transparency-platform.md](plans/M12-transparency-platform.md) | Public trailing pass rates and payout stats, auto-computed | draft | claude |
| [M13-trader-analytics-journal.md](plans/M13-trader-analytics-journal.md) | Per-account performance breakdowns | draft | claude |
| [M14-loyalty-retention.md](plans/M14-loyalty-retention.md) | Progressive cap release, streaks, win-backs | draft | claude |
| [M15-discord-integration.md](plans/M15-discord-integration.md) | Role sync, announcements bot | draft | claude |
| [M16-notification-center.md](plans/M16-notification-center.md) | In-app/email/push preference matrix, event-driven | draft | claude |
| [M17-offers-engine.md](plans/M17-offers-engine.md) | Contextual reset pricing, bundles, A/B-able configs | draft | claude |
| [M18-live-graduation-pipeline.md](plans/M18-live-graduation-pipeline.md) | Ladder tracker, invitation workflow | draft | claude |
| [M19-kyc-identity.md](plans/M19-kyc-identity.md) | Dedicated KYC provider, placement config, biometric dedupe | draft | claude |

## docs/testing/, ops/, design/, legal/ (Wave 4)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [STRATEGY.md](testing/STRATEGY.md) | Section 5 instantiated with tooling choices | draft | claude |
| [GOLDEN_SCENARIOS.md](testing/GOLDEN_SCENARIOS.md) | Every B4 scenario plus inventions, numbered | draft | claude |
| [SIMULATION_HARNESS.md](testing/SIMULATION_HARNESS.md) | Monte-Carlo population port spec, CI calibration bands | draft | claude |
| [ops/runbooks/README.md](ops/runbooks/README.md) | Section 7: one runbook per failure class | draft | claude |
| [design/DESIGN_SYSTEM.md](design/DESIGN_SYSTEM.md) | Appendix F instantiated: tokens locked before any UI | draft | claude |
| [legal/README.md](legal/README.md) | ToS/disclosure drafts, sim-language blocks, geo list | draft | claude |
