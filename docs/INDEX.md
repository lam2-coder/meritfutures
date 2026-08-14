---
status: approved
depends_on: []
last_updated: 2026-08-14
---

# INDEX: The Map

# **CORPUS FROZEN 2026-08-14**

**Every document is `approved` except [M02](plans/M02-rithmic-bridge.md)**, held at `review` by [ADR-005](DECISIONS.md) pending the Rithmic vendor call. `CLAUDE.md` and `README.md` are living operational files and carry no gate status.

**<!--gen:adr_count-->33<!--/gen--> ADRs. <!--gen:ec_count-->140<!--/gen--> edge cases. <!--gen:gs_count-->257<!--/gen--> golden scenarios.** Changing a frozen document requires an ADR, not a commit. **These three numbers are generated spans under [CI-06g](testing/STRATEGY.md)**, rewritten from the registries rather than maintained by hand, because every hand-maintained count in this corpus that has been checked has been found wrong ([ADR-034](DECISIONS.md)).

Every doc in the corpus, one line each. **If a thing is not in this file, it does not exist.** Regenerated whenever any doc is added or changes status. Status values: `draft | review | approved | frozen`. Owner is who moves the doc to its next status (claude drafts; founder approves gates).

**Regenerated in full at the Wave 4 close, 2026-08-14.** **75 entries: 71 documents, the calibration workbook, the committed hook set, the migration set and its delta manifest.** Wave 4 added **18 new files**, retired the **5 remaining placeholders** (testing STRATEGY and SIMULATION_HARNESS, DESIGN_SYSTEM, and the ops and legal indexes), and substantially rewrote three existing documents (TOS_CLAUSES, PRIVACY_POLICY, GOLDEN_SCENARIOS). **No placeholder remains anywhere in the corpus.** **[CI-06c](testing/STRATEGY.md) makes this file's completeness a merge blocker from the first CI setup**, so "if a thing is not in INDEX.md it does not exist" stops being a rule nobody enforces.

## Root
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [MERIT_BUILD_MASTER_PROMPT.md](../MERIT_BUILD_MASTER_PROMPT.md) | The constitution. Read-only; amendments via DECISIONS.md | approved | founder |
| [CLAUDE.md](../CLAUDE.md) | Lean session brain: rituals, git workflow, conventions, model routing | draft | founder |
| [README.md](../README.md) | Repository front door | draft | founder |
| [.claude/settings.json](../.claude/settings.json) | Committed hook set. Corpus phase: `SessionStart` pull, `Stop` push ([ADR-D1](DECISIONS.md)) | approved | founder |

## Tracking (living docs, updated every session)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [INDEX.md](INDEX.md) | This map | approved | claude |
| [STATE.md](STATE.md) | One screen: wave, gate, done / in-flight / blocked, next actions | approved | claude |
| [SESSION_LOG.md](SESSION_LOG.md) | Append-only handoff journal (C3 ritual) | approved | claude |
| [GUIDE_BRIEFING.md](GUIDE_BRIEFING.md) | Orientation for the founder's strategy-desk chat: role boundaries, the gate loop, current state, the session queue | approved | founder |
| [DECISIONS.md](DECISIONS.md) | ADRs: every choice with rationale and alternatives, the **number allocation table** ([ADR-034](DECISIONS.md), [CI-06f](testing/STRATEGY.md)), and the gate-closure records. Counts live in the file, not in this row | approved | founder |
| [EDGE_CASES.md](EDGE_CASES.md) | Living registry, **140 entries**. EC-001 to EC-050 approved with M01; EC-051+ carry their module's status | approved | founder |
| [GLOSSARY.md](GLOSSARY.md) | Every domain term defined once; all docs link here | approved | founder |
| [DELIVERY_PLAN.md](DELIVERY_PLAN.md) | **New.** Constitution section 8 re-planned: 18 weeks, the launch-blocking triage across M11 to M20, the pre-FREEZE queue, and the one trade actually available | approved | founder |

## research/ (Wave 1: APPROVED)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [PROP_TECH_LANDSCAPE.md](../research/PROP_TECH_LANDSCAPE.md) | Section 1: vendor teardown, feature matrix, MUST/SHOULD/LATER, 3-year TCO | approved | founder |
| [TOP10_FIRMS.md](../research/TOP10_FIRMS.md) | Section 1B: firm surveillance one-pagers, refreshed monthly | approved | founder |
| [ADVERSARY_DOSSIER.md](../research/ADVERSARY_DOSSIER.md) | Appendix A instantiated with current scheme intel | approved | founder |
| [DATA_CAPABILITIES.md](../research/DATA_CAPABILITIES.md) | B3: platform data matrix | approved | founder |
| [SECURITY_LANDSCAPE.md](../research/SECURITY_LANDSCAPE.md) | D0: breach history, control checklist, the D0-1 to D0-10 attack scenarios | approved | founder |
| [VIBE_FAILURE_POSTMORTEMS.md](../research/VIBE_FAILURE_POSTMORTEMS.md) | Appendix E: incidents converted to the VG-1 to VG-12 CI gates | approved | founder |
| [CLAUDE_CODE_PLAYBOOK.md](../research/CLAUDE_CODE_PLAYBOOK.md) | C0: community practice, merged monthly | approved | founder |
| [calibration/README.md](../research/calibration/README.md) | Calibration source of record: the workbook, the six divergences, the rho table, the derived selection math | approved | founder |
| [calibration/futures_prop_firm_model.xlsx](../research/calibration/futures_prop_firm_model.xlsx) | The 18-tab workbook. **`mc_lifecycle.py` still outstanding** | approved | founder |

## docs/architecture/ (Wave 2: APPROVED at the gate, 2026-08-13)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [OVERVIEW.md](architecture/OVERVIEW.md) | System diagram, module map, end-to-end data flow | approved | founder |
| [DATA_MODEL.md](architecture/DATA_MODEL.md) | Every table, column, type, index, constraint, retention. **Amended under [ADR-026](DECISIONS.md): the schema-delta reconciliation is folded** | approved | founder |
| [API_CONTRACT.md](architecture/API_CONTRACT.md) | B2 expanded: every endpoint, schemas, errors, the negative-authz matrix | approved | founder |
| [EVENTS.md](architecture/EVENTS.md) | Every event: name, payload schema, producer, consumers | approved | founder |
| [STATE_MACHINES.md](architecture/STATE_MACHINES.md) | Account, payout, flag, identity lifecycles as Mermaid | approved | founder |
| [INFRA.md](architecture/INFRA.md) | Environments, deploy pipeline, backups, the VG gate table, cost guards | approved | founder |
| [SECURITY.md](architecture/SECURITY.md) | Appendix D instantiated: per-asset threat model and control map | approved | founder |

## docs/plans/ (Wave 3, dependency order. **Batch 1 gate closed 2026-08-14. Batch 2 at `review` awaiting the FREEZE gate**)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [M01-rules-engine.md](plans/M01-rules-engine.md) | The crown jewel: 50-rule taxonomy, pure library, replay self-audit. **Gate closed 2026-08-13** | approved | founder |
| [M02-rithmic-bridge.md](plans/M02-rithmic-bridge.md) | Provisioning, ingest, reconciliation, simulator, streaming path, **16 vendor-confirmation items**. Held at `review` by [ADR-005](DECISIONS.md) | review | founder |
| [M03-billing-checkout.md](plans/M03-billing-checkout.md) | PSP abstraction, coupons, resets, chargebacks, MID failover, wallet as a payment method | approved | founder |
| [M04-trader-portal.md](plans/M04-trader-portal.md) | Dashboard, payout center, wallet screen, indicative live layer, certificates, Appendix F gate | approved | founder |
| [M05-payout-system.md](plans/M05-payout-system.md) | Two-leg payouts, ledger, bounded freeze, reserve | approved | founder |
| [M06-admin-ops-console.md](plans/M06-admin-ops-console.md) | Liability dashboard, CUSUM, breakers, two-tier evidence packs, dual control | approved | founder |
| [M07-risk-abuse.md](plans/M07-risk-abuse.md) | Entity resolution, 14 detectors, copy-trading clause, flags queue, canaries | approved | founder |
| [M08-affiliate-system.md](plans/M08-affiliate-system.md) | Attribution, commissions, clawbacks, destination cooling, creative approval | approved | founder |
| [M09-marketing-site.md](plans/M09-marketing-site.md) | Config-rendered plans and rules, publish-ordered revalidation, versioned legal, geo disclosure | approved | founder |
| [M10-integrations.md](plans/M10-integrations.md) | One outbound bus, send-time suppression, support-context scoping, vendor-down chaos | approved | founder |
| [M11-certificates-social-proof.md](plans/M11-certificates-social-proof.md) | Issuance, key lifecycle, non-enumerable verification, revocation classes, opt-in leaderboard | approved | founder |
| [M12-transparency-platform.md](plans/M12-transparency-platform.md) | **Launch differentiator.** Seven auto-computed statistics, versioned definitions, immutable history, proof links | approved | founder |
| [M12-statistic-definitions.md](plans/M12-statistic-definitions.md) | The seven definitions as a founder sign-off table, drafted before any data exists. **Amended by [ADR-031](DECISIONS.md) and [ADR-032](DECISIONS.md):** each statistic now declares its measure set and its integer unit | approved | founder |
| [M13-trader-analytics-journal.md](plans/M13-trader-analytics-journal.md) | Per-account analytics from engine tables, private journal, load isolation from the payout path | approved | founder |
| [M14-loyalty-retention.md](plans/M14-loyalty-retention.md) | **Amended by [ADR-025](DECISIONS.md):** cap release rejected, cross-account loyalty added, INV-M14-11 bounds invariance | approved | founder |
| [M15-discord-integration.md](plans/M15-discord-integration.md) | Per-role consent, a link that is never a credential, template-only announcements. Post-launch | approved | founder |
| [M16-notification-center.md](plans/M16-notification-center.md) | Four classes deciding what a preference may silence, contact-change ceremony, template allowlist | approved | founder |
| [M17-offers-engine.md](plans/M17-offers-engine.md) | Server-authoritative pricing, dual-controlled floors, identity-bound offers, credit provenance | approved | founder |
| [M18-graduation-track.md](plans/M18-graduation-track.md) | Ladder finiteness disclosed pre-purchase, countdown tracker, mechanical graduation, terminal settlement. **No live program at launch** | approved | founder |
| [M19-kyc-identity.md](plans/M19-kyc-identity.md) | Composite trigger set, verification as milestone, dedupe with dispositions, sanctions carve-out, funnel telemetry | approved | founder |
| [M20-wallet.md](plans/M20-wallet.md) | The wallet as an object: closed credit list, provenance rules, two exits, dormancy, float segregation | approved | founder |

## packages/db/ (build phase, from 2026-08-14)

| Artifact | Purpose | Status | Owner |
|---|---|---|---|
| [migrations/](../packages/db/migrations) | The reviewed migration set. **27 files, all 93 schema deltas folded at create**, verified to apply in order against PostgreSQL 16. Sixteen carry an `E2 READ: MONEY PATH` header | review | founder (E2 line-by-line read) |
| [DELTA_MANIFEST.md](../packages/db/DELTA_MANIFEST.md) | Every `SD-nn` and `U-nn` with its disposition and target file, the migration sequence, the rejection table (empty, and explicitly so), the no-floats exemption list (**two columns, no money**, under [ADR-031](DECISIONS.md)), and the per-constraint verification table. **[ADR-026](DECISIONS.md)'s completeness gate reads this file** | review | founder |

## docs/testing/ (Wave 4)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [STRATEGY.md](testing/STRATEGY.md) | **Written.** Section 5 instantiated: tooling with rejected alternatives, eight engine properties, and the complete CI gate inventory across ten stages, VG-1 to VG-12, the D0 battery, anti-slop gates, and corpus integrity. **Section 4.4 gains CI-06f (ADR numbers unique and gapless) and CI-06g (the COUNT GATE) under [ADR-034](DECISIONS.md)** | approved | founder |
| [GOLDEN_SCENARIOS.md](testing/GOLDEN_SCENARIOS.md) | **Consolidated. 257 scenarios**, contiguous, deduplicated, with an ownership partition, the reconciliation from 242, and the coverage map | approved | founder |
| [SIMULATION_HARNESS.md](testing/SIMULATION_HARNESS.md) | **Written.** Port spec, ten population parameters, eleven calibration bands, eight outputs, and the `mc_lifecycle.py` checklist | approved | founder |

## docs/ops/runbooks/ (Wave 4)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [README.md](ops/runbooks/README.md) | Index, the five incident rules, the severity ladder, and what is carried forward from earlier waves | approved | founder |
| [RB-01-nightly-batch-failure.md](ops/runbooks/RB-01-nightly-batch-failure.md) | Resume, never repair. Per-account diagnosis table | approved | founder |
| [RB-02-recon-mismatch.md](ops/runbooks/RB-02-recon-mismatch.md) | File quarantine, backdated correction, unconfirmed setpoint, unattributable delta | approved | founder |
| [RB-03-mid-freeze.md](ops/runbooks/RB-03-mid-freeze.md) | MID failover, the chargeback interaction, and why this is never a payout problem | approved | founder |
| [RB-04-settlement-rail-outage.md](ops/runbooks/RB-04-settlement-rail-outage.md) | Comms before diagnosis. Payouts work, withdrawals are delayed, and the distinction is the message | approved | founder |
| [RB-05-rithmic-sftp-failure.md](ops/runbooks/RB-05-rithmic-sftp-failure.md) | The two tiers, inbound, credentials, provisioning, feed loss | approved | founder |
| [RB-06-restore-from-backup.md](ops/runbooks/RB-06-restore-from-backup.md) | Stop writes first, the six-check verification, and the drill that runs with payouts mid-queue | approved | founder |
| [RB-07-ledger-imbalance.md](ops/runbooks/RB-07-ledger-imbalance.md) | Scoped and global halts, the 24 hour escalation clock, compensating entries only | approved | founder |
| [RB-08-security-incident.md](ops/runbooks/RB-08-security-incident.md) | Eleven triggers, contain before investigate, and **a DDoS is a data-exfiltration alarm** | approved | founder |
| [RB-09-break-glass.md](ops/runbooks/RB-09-break-glass.md) | Three keys, four loss scenarios, the unseal procedure, the quarterly existence check | approved | founder |
| [RB-10-support-account-lookup.md](ops/runbooks/RB-10-support-account-lookup.md) | Why the API answers `404`, and the procedure that never resolves an account from a trader-supplied id | approved | founder |
| [RB-11-verification-provider-outage.md](ops/runbooks/RB-11-verification-provider-outage.md) | Verification is a state Merit holds, not a question Merit asks | approved | founder |
| [COMMS_TEMPLATES.md](ops/runbooks/COMMS_TEMPLATES.md) | Twelve pre-written incident messages, with the five rules each already obeys | approved | founder |
| [CRON_INVENTORY.md](ops/runbooks/CRON_INVENTORY.md) | Fifteen scheduled jobs with dead-man switches, eight calendar items, and the switch that runs outside the estate | approved | founder |
| [WEEKLY_RISK_RITUAL.md](ops/runbooks/WEEKLY_RISK_RITUAL.md) | Fifteen minutes across reserve, liability, loss ratios, flags, payouts and suppressions | approved | founder |

## docs/design/ (Wave 4)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [DESIGN_SYSTEM.md](design/DESIGN_SYSTEM.md) | **Written.** Appendix F instantiated: forest ink and brass, two semantic colors, the ruled row, the full token set, 17 review gates, 8 automated slop-score checks | approved | founder |

## docs/legal/ (Wave 4, all draft-for-counsel)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [README.md](legal/README.md) | Index, the drafting notes rulings created, norm positioning | approved | founder |
| [TOS_CLAUSES.md](legal/TOS_CLAUSES.md) | **Fifteen clauses**, the disclosure-block inventory across seven surfaces, clause 8's Lucid framing, the wallet property list, the geo placeholder | approved | founder |
| [PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md) | Collection categories and purposes, the fraud-prevention retention carve-out, sharing by recipient category | approved | founder |
| [AFFILIATE_TERMS.md](legal/AFFILIATE_TERMS.md) | **New.** NFA I-26-12 as per-asset approval, two disclosure blocks, eight prohibited-claim classes, the enforcement ladder | approved | founder |
| [COUNSEL_PACKET.md](legal/COUNSEL_PACKET.md) | **New.** The three questions as one sendable document, each with the facts its answer turns on | approved | founder |
