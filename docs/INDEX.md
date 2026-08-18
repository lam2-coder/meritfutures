---
status: approved
depends_on: []
last_updated: 2026-08-18
---

# INDEX: The Map

# **CORPUS FROZEN 2026-08-14**

**Every document is `approved` except [M02](plans/M02-rithmic-bridge.md)**, held at `review` by [ADR-005](decisions/ADR-005.md) pending the Rithmic vendor call. `CLAUDE.md` and `README.md` are living operational files and carry no gate status.

**<!--gen:adr_count-->58<!--/gen--> ADRs. <!--gen:ec_count-->157<!--/gen--> edge cases. <!--gen:gs_count-->284<!--/gen--> golden scenarios.** Changing a frozen document requires an ADR, not a commit. **These three numbers are generated spans under [CI-06g](testing/STRATEGY.md)**, rewritten from the registries rather than maintained by hand, because every hand-maintained count in this corpus that has been checked has been found wrong ([ADR-034](decisions/ADR-034.md)).

Every doc in the corpus, one line each. **If a thing is not in this file, it does not exist.** Regenerated whenever any doc is added or changes status. Status values: `draft | review | approved | frozen`. Owner is who moves the doc to its next status (claude drafts; founder approves gates).

**Regenerated in full at the Wave 4 close, 2026-08-14.** **75 entries: 71 documents, the calibration workbook, the committed hook set, the migration set and its delta manifest.** Wave 4 added **18 new files**, retired the **5 remaining placeholders** (testing STRATEGY and SIMULATION_HARNESS, DESIGN_SYSTEM, and the ops and legal indexes), and substantially rewrote three existing documents (TOS_CLAUSES, PRIVACY_POLICY, GOLDEN_SCENARIOS). **No placeholder remains anywhere in the corpus.** **[CI-06c](testing/STRATEGY.md) makes this file's completeness a merge blocker from the first CI setup**, so "if a thing is not in INDEX.md it does not exist" stops being a rule nobody enforces.

## Root
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [MERIT_BUILD_MASTER_PROMPT.md](../MERIT_BUILD_MASTER_PROMPT.md) | The constitution. Read-only; amendments via DECISIONS.md | approved | founder |
| [CLAUDE.md](../CLAUDE.md) | Lean session brain: rituals, git workflow, conventions, model routing | draft | founder |
| [README.md](../README.md) | Repository front door | draft | founder |
| [.claude/settings.json](../.claude/settings.json) | Committed hook set. Corpus phase: `SessionStart` pull, `Stop` push ([ADR-D1](decisions/ADR-D1.md)) | approved | founder |
| [.claude/agents/reviewer.md](../.claude/agents/reviewer.md) | The citation reviewer. Verifies every factual claim against a primary source at `file:line`; verdicts to `docs/reviews/` ([ADR-033](decisions/ADR-033.md)) | proposed | founder |
| [.github/workflows/corpus.yml](../.github/workflows/corpus.yml) | The CI wiring. `integrity` runs `gates.mjs` and proves the spans regenerate to nothing; `migrations` is **CI-06h**: the forward-only apply under `ON_ERROR_STOP`, the must-fail re-apply, the counts read from `pg_indexes` and `pg_constraint`, and the ledger probes | approved | founder |
| [scripts/corpus/gates.mjs](../scripts/corpus/gates.mjs) | The corpus-integrity gates as a runnable check, no dependencies. `check` runs every `CI-06` gate plus [ADR-026](decisions/ADR-026.md)'s manifest gate, **<!--gen:gate_count-->17<!--/gen--> in all**, a generated span because this cell read "CI-06a to CI-06j ... eleven in all" while `CI-06n` was already in the runner; `generate` rewrites every CI-06g span from its named query; `anchors` lists what a file offers ([STRATEGY section 4.4](testing/STRATEGY.md)) | approved | founder |
| [scripts/corpus/falsify.mjs](../scripts/corpus/falsify.mjs) | **Runs every gate against a tree carrying one seeded violation aimed at it, and fails if the gate does not fail on that finding.** A gate nobody has watched fail is not a gate ([STRATEGY section 4.4](testing/STRATEGY.md)) | approved | founder |
| [scripts/db/probe_ledger_constraints.sql](../scripts/db/probe_ledger_constraints.sql) | LEDGER-C1, LEDGER-C2 and zero-sum probed against a real database, checked by error message rather than by exception class, plus the counterfactual that proves C1 is not redundant ([ADR-027](decisions/ADR-027.md)) | approved | founder |
| [scripts/db/probe_plan_version_immutability.sql](../scripts/db/probe_plan_version_immutability.sql) | 14 assertions on `plan_versions` immutability and the seven `cardinality()` conversions. **Leads with the permitted transition succeeding**, which is the probe that did not exist ([ADR-035](decisions/ADR-035.md)) | approved | founder |
| [scripts/db/probe_payout_hold.sql](../scripts/db/probe_payout_hold.sql) | 11 assertions on the payout hold, the widened `SD-09` predicates, the external leg's settlement guard and the restriction episode ([ADR-040](decisions/ADR-040.md), [ADR-041](decisions/ADR-041.md)). **Six success cases before any rejection** | approved | founder |
| [scripts/db/probe_reversible_contact_addresses.sql](../scripts/db/probe_reversible_contact_addresses.sql) | 37 assertions on `ADR-046`'s sealed addresses, the **plaintext floor** that makes `INV-M10-12` a constraint, the evidence foreign keys and the `merit_dispatcher` grants ([ADR-046](decisions/ADR-046.md), `OQ-M10-06`). **Fifteen success cases**, and the only assertions in the install job that watch a GRANT by attempting the write as the role | approved | founder |
| [scripts/db/probe_rule_states_calendar_revision.sql](../scripts/db/probe_rule_states_calendar_revision.sql) | 10 assertions on [ADR-047](decisions/ADR-047.md)'s calendar watermark on `rule_states` (`OQ-P2-02`, `0035`). **Six success cases before any rejection**, because here the dangerous edit is a **tightening** and no inventory of refusals can see one: a `NOT NULL` passes all four rejections and refuses every state row the engine writes until the calendar has been corrected once. Asserts the watermark is over the **whole calendar** rather than this row's own day, and that the `state_hash` contract still names the column as **excluded** | approved | founder |
| [scripts/db/assert_date_unit_shape.mjs](../scripts/db/assert_date_unit_shape.mjs) | **[ADR-042](decisions/ADR-042.md)'s SQL shape check.** No `interval` arithmetic against a `date` column and no `timestamptz` cast to `date`, across the migration set. **Vacuously true today**, which is the argument for wiring it: `0029` to `0031` made `interval '48 hours'` idiomatic on the money path. `--falsify` watches it fire on five seeded violations and leave four legitimate constructs alone, including `interval '48 hours'` against a `timestamptz`, which is the ruled unit | approved | founder |

## Tracking (living docs, updated every session)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [INDEX.md](INDEX.md) | This map | approved | claude |
| [STATE.md](STATE.md) | One screen: wave, gate, done / in-flight / blocked, next actions | approved | claude |
| [sessions/](sessions/README.md) | Append-only handoff journal (C3 ritual), one file per session since [ADR-043](decisions/ADR-043.md). Entry files are fragments indexed by that README under `CI-06n` | approved | claude |
| [GUIDE_BRIEFING.md](GUIDE_BRIEFING.md) | Orientation for the founder's strategy-desk chat: role boundaries, the gate loop, current state, the session queue | approved | founder |
| [decisions/](decisions/README.md) | The ADR registry, one file per entry since [ADR-043](decisions/ADR-043.md). Every choice with rationale and alternatives, plus the six gate-closure records in [gates/](decisions/gates/). Entry files are fragments rather than corpus documents and are indexed by that README under `CI-06n`, not by this row | approved | founder |
| [decisions/ALLOCATION.md](decisions/ALLOCATION.md) | The **three number allocation tables** (ADR numbers, [ADR-034](decisions/ADR-034.md) and [CI-06f](testing/STRATEGY.md); migration numbers, [ADR-036](decisions/ADR-036.md) and [CI-06h](testing/STRATEGY.md); CI gate letters, no gate yet). Kept in one file because each is read as a table. Counts live in the file, not in this row | approved | founder |
| [edge-cases/](edge-cases/README.md) | Living registry, one file per entry since [ADR-043](decisions/ADR-043.md), holding <!--gen:ec_count-->157<!--/gen--> entries. The Appendix B4 battery stays one file: 22 table rows are not 22 documents. EC-001 to EC-050 approved with M01; EC-051+ carry their module status. Entry files are fragments indexed by that README under `CI-06n` | approved | founder |
| [GLOSSARY.md](GLOSSARY.md) | Every domain term defined once; all docs link here | approved | founder |
| [DELIVERY_PLAN.md](DELIVERY_PLAN.md) | **New.** Constitution section 8 re-planned: **18 weeks plus 3 to 5 days**, the launch-blocking triage across M11 to M20, the pre-FREEZE queue, and the one trade actually available. [ADR-041](decisions/ADR-041.md)'s M15 partial is the sixth addition and the first since FREEZE | approved | founder |

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
| [DATA_MODEL.md](architecture/data-model/README.md) | Every table, column, type, index, constraint, retention. **Amended under [ADR-026](decisions/ADR-026.md): the schema-delta reconciliation is folded** | approved | founder |
| [API_CONTRACT.md](architecture/API_CONTRACT.md) | B2 expanded: every endpoint, schemas, errors, the negative-authz matrix | approved | founder |
| [EVENTS.md](architecture/EVENTS.md) | Every event: name, payload schema, producer, consumers | approved | founder |
| [STATE_MACHINES.md](architecture/STATE_MACHINES.md) | Account, payout, flag, identity lifecycles as Mermaid | approved | founder |
| [INFRA.md](architecture/INFRA.md) | Environments, deploy pipeline, backups, the VG gate table, cost guards | approved | founder |
| [SECURITY.md](architecture/SECURITY.md) | Appendix D instantiated: per-asset threat model and control map | approved | founder |

## docs/plans/ (Wave 3, dependency order. **Batch 1 gate closed 2026-08-14. Batch 2 at `review` awaiting the FREEZE gate**)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [M01-rules-engine.md](plans/M01-rules-engine.md) | The crown jewel: 50-rule taxonomy, pure library, replay self-audit. **Gate closed 2026-08-13** | approved | founder |
| [M02-rithmic-bridge.md](plans/M02-rithmic-bridge.md) | Provisioning, ingest, reconciliation, simulator, streaming path, the provisional revocation and restoration leg, and the vendor-confirmation agenda whose count is its own table. Held at `review` by [ADR-005](decisions/ADR-005.md) | review | founder |
| [M03-billing-checkout.md](plans/M03-billing-checkout.md) | PSP abstraction, coupons, resets, chargebacks, MID failover, wallet as a payment method, the registration lookup as a second call site and the two cost lines a signup drives, and the restriction refusal that closes the card leg the wallet leg already refused | approved | founder |
| [M04-trader-portal.md](plans/M04-trader-portal.md) | Dashboard, payout center, wallet screen, indicative live layer, certificates, the C-27 authority boundary shown rather than hit, Appendix F gate | approved | founder |
| [M05-payout-system.md](plans/M05-payout-system.md) | Two-leg payouts, ledger, bounded freeze, reserve | approved | founder |
| [M03-billing-checkout.md](plans/M03-billing-checkout.md) | PSP abstraction, coupons, resets, chargebacks, MID failover, wallet as a payment method | approved | founder |
| [M04-trader-portal.md](plans/M04-trader-portal.md) | Dashboard, payout center, wallet screen, indicative live layer, certificates, Appendix F gate | approved | founder |
| [M05-payout-system.md](plans/M05-payout-system.md) | Two-leg payouts, ledger, the 48 hour enforcement window (pre-approval hold and bounded freeze), reserve | approved | founder |
| [M06-admin-ops-console.md](plans/M06-admin-ops-console.md) | Liability dashboard, CUSUM, breakers, two-tier evidence packs, dual control, the identity drill-down, restriction and restore as launch-available actions, and the fourth unsuppressible alarm | approved | founder |
| [M07-risk-abuse.md](plans/M07-risk-abuse.md) | Entity resolution, three link tiers, eighteen detectors, copy-trading clause, flags queue, canaries | approved | founder |
| [M08-affiliate-system.md](plans/M08-affiliate-system.md) | Attribution, commissions, clawbacks, destination cooling, creative approval, and the restriction gate one rail did not supply | approved | founder |
| [M09-marketing-site.md](plans/M09-marketing-site.md) | Config-rendered plans and rules, publish-ordered revalidation, versioned legal, geo disclosure | approved | founder |
| [M10-integrations.md](plans/M10-integrations.md) | One outbound bus, send-time suppression, support-context scoping, vendor-down chaos, and the SMS sender as the first vendor on a critical path | approved | founder |
| [M11-certificates-social-proof.md](plans/M11-certificates-social-proof.md) | Issuance, key lifecycle, non-enumerable verification, revocation classes, opt-in leaderboard | approved | founder |
| [M12-transparency-platform.md](plans/M12-transparency-platform.md) | **Launch differentiator.** Seven auto-computed statistics, versioned definitions, immutable history, proof links | approved | founder |
| [M12-statistic-definitions.md](plans/M12-statistic-definitions.md) | The seven definitions as a founder sign-off table, drafted before any data exists. **Amended by [ADR-031](decisions/ADR-031.md) and [ADR-032](decisions/ADR-032.md):** each statistic now declares its measure set and its integer unit | approved | founder |
| [M13-trader-analytics-journal.md](plans/M13-trader-analytics-journal.md) | Per-account analytics from engine tables, private journal, load isolation from the payout path | approved | founder |
| [M14-loyalty-retention.md](plans/M14-loyalty-retention.md) | **Amended by [ADR-025](decisions/ADR-025.md):** cap release rejected, cross-account loyalty added, INV-M14-11 bounds invariance | approved | founder |
| [M15-discord-integration.md](plans/M15-discord-integration.md) | Per-role consent, a link that is never a credential, template-only announcements. **The link and the announcements are launch scope at P8 by [ADR-041](decisions/ADR-041.md); role sync stays post-launch** | approved | founder |
| [M16-notification-center.md](plans/M16-notification-center.md) | Five classes deciding what a preference may silence, contact-change ceremony, template allowlist | approved | founder |
| [M17-offers-engine.md](plans/M17-offers-engine.md) | Server-authoritative pricing, dual-controlled floors, identity-bound offers, credit provenance | approved | founder |
| [M18-graduation-track.md](plans/M18-graduation-track.md) | Ladder finiteness disclosed pre-purchase, countdown tracker, mechanical graduation, terminal settlement. **No live program at launch** | approved | founder |
| [M19-kyc-identity.md](plans/M19-kyc-identity.md) | Composite trigger set, verification as milestone, dedupe with dispositions, sanctions carve-out, funnel telemetry | approved | founder |
| [M20-wallet.md](plans/M20-wallet.md) | The wallet as an object: closed credit list, provenance rules, two exits, dormancy, float segregation | approved | founder |
| [P1-monorepo-scaffold.md](plans/P1-monorepo-scaffold.md) | **Build phase, not a module plan.** The scaffold P1 has left: the package boundaries argued against what the cheap choice breaks, the Vitest workspace mapped to the ruled CI stages, the three tiers of forbidding a plan parameter a home in code, the file manifest that enforces one-artifact-one-session, and the sequencing from ADR-036 through TradingCalendar | approved | founder |
| [FOLD-01-phone-identity.md](plans/FOLD-01-phone-identity.md) | **A fold plan, not a module plan.** Passwordless auth widened to three factors and phone as a first-class identity signal, plus four founder amendments: the pre-identity OTP class split that stops SMS pumping, the number-recycling guard, and the authentication-versus-authority boundary as an invariant. Takes the vendor and the counsel-basis decisions, allocates migration `0029`, and surfaces `OI-06` | approved | founder |
| [FOLD-02-enforcement-window-and-suspension.md](plans/FOLD-02-enforcement-window-and-suspension.md) | **A fold plan, not a module plan.** The pre-approval payout hold with its 48 hour auto-release, and identity-level suspension. Rules that the hold is **not** the bounded freeze under a second name (the discriminator is whether the ledger has moved) and that identity suspension **is** the existing `restricted` state under a second name. Widens SD-09's predicate so `G-NO-IN-FLIGHT` keeps covering a request under review, makes the releaser structural and its absence unsuppressible, marks the Rithmic revocation leg PROVISIONAL on `V-M2-15`, allocates ADR-040, ADR-041, `0030` and `0031`, records the ADR-number collision with PR #15 that no gate could see, and moves M15 into launch scope with its weeks recorded | approved | founder |
| [P2-rules-engine.md](plans/P2-rules-engine.md) | **A phase plan, not a module plan.** P2's five hard questions answered against the tree rather than the brief: `CalendarSlice` as a value because none of the three purity mechanisms can see a capability passed as an argument, the fixture and engine sessions alternating so no session grades its own output, CI-03's polarity derived per fixture from the rules it already cites because the present probe is global and cannot survive fifty rules landing incrementally, and the calendar revision scoped into replay because a correction diverges the whole book at once and Appendix B has no row for it. Finds that M01's reference algorithm calls `nextTradingDayAfter` and never supplies it, that `rule_states` carries no calendar reference at all, and that PT-03 is not an engine property so P2's done-condition is unsatisfiable as written. Allocates nothing: OQ-P2-01 to OQ-P2-04 are ruled before any engine code | draft | founder |
| [P1-SE-trading-calendar.md](plans/P1-SE-trading-calendar.md) | **A session plan, not a module plan.** P1's last engineering item, money path. The exchange calendar as verified data: the source transcribed with provenance and a digest, DST verified against IANA rather than trusted, the fixture calendar **derived** rather than maintained beside it, and correction after trading partitioned into a data change and an incident. Finds that `is_holiday` is unwritable as designed, that a corrected row leaves no prior image for replay, that coverage has no storage so an exhausted calendar reads as an unbroken holiday, and that one `session_close_at` cannot serve six symbols. Carries the founder's wall-clock ruling and the measured audit behind it: no counter is wrongly clocked today, and the three mechanisms that keep it that way are wired before `0029` makes `interval` idiomatic. Allocates ADR-042, `0032` and `CI-06m` | approved | founder |
| [WAVE-01-post-freeze-parallel-sessions.md](plans/WAVE-01-post-freeze-parallel-sessions.md) | **A wave plan, not a module plan.** It carries no ruling and no design: it is the allocation table and the prompt set for the nine sessions unblocked on 2026-08-18, six of which run concurrently. Allocates session-log numbers 61 to 69 for a registry that has no table and has now raced twice, and records the two `CI-06` letters (`r`, `s`) claimed in [ALLOCATION](decisions/ALLOCATION.md) before any session spends them. Fences the three concurrent `packages/rules-engine/test` sessions to files that do not exist yet, serialises the gates lane because three of its sessions write one runner, and runs the registry dedup last and alone because every other session appends to the two files it edits. Section 5 records three claims of the handoff that commissioned it which the tree does not support, the load-bearing one being that group A is blocked on the engine's input types rather than on the calendar | approved | founder |

## packages/db/ (build phase, from 2026-08-14)

| Artifact | Purpose | Status | Owner |
|---|---|---|---|
| [migrations/](../packages/db/migrations) | The reviewed migration set. **<!--gen:migration_files-->37<!--/gen--> files, all <!--gen:manifest_changes-->105<!--/gen--> schema changes folded**, verified to apply in order against PostgreSQL 16. **<!--gen:e2_files-->27<!--/gen--> carry an `E2 READ: MONEY PATH` header and are the founder's read set.** This row read "27 files, all 93 schema deltas" and "Sixteen carry" until 2026-08-15, **stating the scope of the E2 read two files short**; all three are generated spans now | review | founder (E2 line-by-line read) |
| [DELTA_MANIFEST.md](../packages/db/DELTA_MANIFEST.md) | Every `SD-nn` and `U-nn` with its disposition and target file, the migration sequence, the rejection table (empty, and explicitly so), the no-floats exemption list (**two columns, no money**, under [ADR-031](decisions/ADR-031.md)), and the per-constraint verification table. **[ADR-026](decisions/ADR-026.md)'s completeness gate reads this file** | review | founder |

## docs/testing/ (Wave 4)
| Doc | Purpose | Status | Owner |
|---|---|---|---|
| [STRATEGY.md](testing/STRATEGY.md) | **Written.** Section 5 instantiated: tooling with rejected alternatives, eight engine properties, and the complete CI gate inventory across ten stages, VG-1 to VG-12, the D0 battery, anti-slop gates, and corpus integrity. **Section 4.4 now runs**: every `CI-06` gate plus [ADR-026](decisions/ADR-026.md)'s manifest gate, **<!--gen:gate_count-->17<!--/gen--> in all**, each passing clean and failing dirty under `falsify.mjs`. **That count is a generated span because this cell stated it by hand and was wrong**, reading "CI-06a to CI-06j ... all eleven" with `CI-06k` and `CI-06n` already in the runner. CI-06f and CI-06g are [ADR-034](decisions/ADR-034.md)'s; CI-06j is [ADR-035](decisions/ADR-035.md)'s; **CI-06h's allocation half is [ADR-036](decisions/ADR-036.md)'s**; CI-06n is [ADR-043](decisions/ADR-043.md)'s; CI-06k is [ADR-039](decisions/ADR-039.md)'s; **CI-06l is [ADR-040](decisions/ADR-040.md)'s** | approved | founder |
| [testing/golden-scenarios/](testing/golden-scenarios/README.md) | **Consolidated, <!--gen:gs_count-->284<!--/gen--> scenarios**, contiguous, deduplicated, with an ownership partition, the reconciliation from 242, and the coverage map. One file per SECTION since [ADR-043](decisions/ADR-043.md), because the identifiers vastly outnumber the sections and live as table rows, and a row is not a document. **The row total is deliberately not stated here**: it is the one figure of the two that no query in `gates.mjs` derives, and this cell carried it as a bare numeral until the FOLD-01 registries session added section 34 | approved | founder |
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
