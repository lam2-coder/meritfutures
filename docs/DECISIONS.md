---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# DECISIONS (ADR registry)

Every choice with rationale and alternatives. Constitution amendments are proposed here. ADR format per entry:

```
## ADR-NNN: <title>  (YYYY-MM-DD, status: proposed | accepted | superseded)
- Context:
- Decision:
- Alternatives considered:
- Consequences:
```

The Open Decisions Register (constitution section 10) resolves into entries here during W1 with the founder: queue tech, ORM, Rithmic ingest path, PSP shortlist, auth provider, hosting, restricted-jurisdiction list, Discord bot scope, KYC placement (M19).

---

## ADR-001: Repo root stands in for `merit/`  (2026-08-13, status: proposed)
- Context: Section 0.5 draws the skeleton under a `merit/` directory. The git repo `meritfutures` already holds the constitution at its root.
- Decision: Treat the repo root as `merit/`; the skeleton lives directly at root.
- Alternatives considered: Nesting everything under a `merit/` subdirectory (adds a pointless path segment to every reference).
- Consequences: All constitution paths map 1:1 with the leading `merit/` dropped.

## ADR-002: Rithmic ingest path is SFTP-first, both directions  (2026-08-13, status: accepted)
- Context: Constitution section 10 leaves "Rithmic ingest (reports vs R|API admin)" open pending vendor docs. research/DATA_CAPABILITIES.md section 3 built the comparison.
- Decision (proposed): Outbound provisioning via CSV/SFTP (Rithmic's scriptable bulk interface). Inbound marks via Rithmic EOD report files over SFTP as primary ingest. R|API+ admin pull deferred to a post-v1 enhancement for intraday recon if operations demand it.
- Alternatives considered: R|API+ admin pull as primary (rejected v1: $100/mo per API ID, standing admin credentials in a worker widen the attack surface, and the EOD rule model needs only closed-day data); hybrid from day one (rejected: two ingest paths to test and reconcile before either is proven).
- Consequences: File-based ingest is replayable and quarantinable (B4 #4); EOD report doubles as auto-liquidation evidence for M6 packs. Contingent on the vendor call confirming per-fill granularity in report files; the fills-to-marks pipeline absorbs either file shape. Blocks: M2 plan doc detail.
- **Founder approval (2026-08-13): ACCEPTED**, closing the section-10 open item, with two conditions recorded.
  - **T+1 tradeoff accepted explicitly.** File-based EOD ingest means every derived state (daily_marks, rule_states, eligibility, liability dashboard, recon) reflects the last closed trading day only. Merit has no intraday state by design, and breach visibility in our own system lags Rithmic's enforcement by one batch cycle. This is consistent with the constitution's EOD rule model (intraday enforcement is delegated to Rithmic's auto-liquidator), and it is the price of a replayable, quarantinable, low-credential ingest. Trader-facing copy and the admin dashboard must both label data as "as of last closed session" so the lag is never mistaken for a bug or a stale page.
  - **Vendor-confirmation condition stands but the call is deferred** pending the founder's capital decision. See ADR-005. Until the call happens, every ingest specific derived from public quote details is provisional and flagged in the architecture docs.

## ADR-003: Session-length policy on money vs non-money paths  (2026-08-13, status: accepted)
- Context: research/CLAUDE_CODE_PLAYBOOK.md section 7 found a 2026 community strand advocating long compounding sessions (reset only on project change), enabled by 1M-token windows + compaction. This contradicts constitution C4/C3 (`/clear` between unrelated tasks; one objective per session; fresh session per module slice).
- Decision (proposed): Keep per-slice resets and one-objective sessions on money paths (rules-engine, payout, ledger, auth) where context poisoning is catastrophic. Permit longer compounding sessions only for explicitly non-money work (marketing site, docs, fixtures).
- Alternatives considered: Adopt long-compounding universally (rejected: unacceptable risk on money-path diffs); keep strict resets everywhere (viable, but needlessly costs time on low-stakes work).
- Consequences: Amends C4 to be path-sensitive.
- **Founder approval (2026-08-13): ACCEPTED.** C4 is amended: per-slice resets and one-objective sessions remain binding on rules-engine, payout, ledger, and auth work; longer compounding sessions are permitted on marketing site, docs, fixtures, and seed work. CLAUDE.md carries the split so every session knows which regime it is in.

## ADR-004: CLAUDE_CODE_PLAYBOOK.md location (research/ vs docs/)  (2026-08-13, status: accepted)
- Context: Constitution section 0.5 skeleton places the playbook in research/; Appendix C0 text says docs/CLAUDE_CODE_PLAYBOOK.md. Standing landmine since Session 1.
- Decision (proposed): Keep it in research/ (all Phase-0 research lives together; C1 says research outputs land in research/). Treat the C0 docs/ reference as superseded.
- Alternatives considered: Move to docs/ per C0 literal text (one-line INDEX change; separates it from its six sibling research docs).
- Consequences: Cosmetic; a one-line INDEX edit either way.
- **Founder approval (2026-08-13): ACCEPTED.** The playbook stays at research/CLAUDE_CODE_PLAYBOOK.md; the Appendix C0 reference to docs/ is superseded and the Session-1 landmine is closed.

## ADR-006: Queue technology is pg-boss (Postgres-only)  (2026-08-13, status: proposed)
- Context: Constitution section 10 leaves queue tech open (BullMQ plus Redis, or pg-boss). Wave 2 needs the answer because the provisioning saga, Rise transfers, and the nightly batch all enqueue work, and the choice changes the backup and restore story.
- Decision (proposed): pg-boss. Jobs live in the same Postgres instance as the money data.
- Alternatives considered: BullMQ plus Redis (higher throughput, richer primitives, mature dashboards, but adds a second stateful service to secure, back up, and restore, and puts job state outside the PITR boundary that protects the ledger). At v1 scale (5,000 accounts in a nightly batch under 10 minutes, payout request p95 under 500ms) the throughput advantage buys nothing we need.
- Consequences: One datastore to restore, one credential set, one backup drill. Enqueue participates in the same transaction as the state change that caused it, which removes a whole class of saga bugs ("committed the purchase, lost the provisioning job"). Restore-from-backup keeps queued work and idempotency keys consistent with the ledger (B4 scenario 19). If job volume ever outgrows Postgres, migration is a contained change behind the job interface.
- **Founder approval (2026-08-13): ACCEPTED.** Closes the section-10 queue-tech open item. The job interface stays narrow enough that a later move to BullMQ is a contained change, and that narrowness is now a review criterion on M2 and M5, not an aspiration.

## ADR-007: Hosting is managed Postgres (Neon) plus Railway plus Cloudflare  (2026-08-13, status: proposed)
- Context: Constitution section 10 leaves hosting open with a bias to "simplest restorable". Appendix E3's shippers' doctrine says managed everything, almost no custom infrastructure.
- Decision (proposed): Neon for Postgres (PITR, per-environment projects, branchable previews), Railway for the four services (site, portal API, admin, worker), Cloudflare for edge, WAF, DNS, and the admin IP allowlist, and an S3-compatible private bucket for certificates and evidence packs.
- Alternatives considered: single Hetzner box with Docker Compose (cheapest and fully controlled, but PITR, patching, and restore become bespoke scripts we own and rarely exercise, which is exactly the custom infrastructure E3 warns against for a solo operator); Railway plus Vercel (a second platform for a static site that Railway already serves adequately).
- Consequences: Restore is a documented vendor procedure rehearsed quarterly rather than a homegrown script. Cost is higher than a single box and is reviewed monthly in the C8 retro. The admin origin is a separate service with its own hostname and Cloudflare rules. Revisit only if a module spec proves a managed option fails a requirement.
- **Founder approval (2026-08-13): ACCEPTED.** Closes the section-10 hosting open item. The admin origin question that rode along with it is settled separately in [ADR-012](#adr-012-admin-console-lives-on-a-separate-apex-domain--2026-08-13-status-accepted).

## ADR-008: ORM is Drizzle  (2026-08-13, status: proposed)
- Context: Constitution section 10 leaves Drizzle versus Prisma open. Migrations are sacred and the founder reads every money-path migration line by line (constitution E2).
- Decision (proposed): Drizzle, with a `scopedDb(identity)` wrapper as the only sanctioned data accessor and an ESLint rule banning direct client imports in application paths (VG-4).
- Alternatives considered: Prisma (better ergonomics and a mature ecosystem, but migration SQL is generated rather than authored, the client abstracts more of the query, and a heavier runtime sits between the founder and the statement that touched the ledger).
- Consequences: Migrations are plain SQL files that can be reviewed line by line, which is the whole point on money tables. Types are generated from the schema so drift is a compile error. The team accepts more verbose query code in exchange for the diff being readable.
- **Founder approval (2026-08-13): ACCEPTED.** Closes the section-10 ORM open item. The `scopedDb(identity)` wrapper and the ESLint ban on direct client imports (VG-4) are part of the acceptance, not a follow-up.

## ADR-005: Rithmic vendor call deferred; M2 ingest specifics are provisional  (2026-08-13, status: accepted)
- Context: ADR-002 is conditional on a Rithmic vendor call confirming EOD report formats and field lists, delivery cadence and timing guarantees, correction/backdated-fill semantics (critical for replay determinism, B4 #5), sandbox availability, server-side copy configuration, and admin R|API+ terms. The founder is deferring that call pending a capital decision.
- Decision: Wave 2 architecture is designed fully from the known public CSV/SFTP quote details rather than waiting. Every ingest specific that the vendor call must later confirm is labeled **provisional-pending-vendor-confirmation** at the point of use, and the assumption is stated explicitly so a later correction is a bounded edit rather than a redesign.
- Alternatives considered: Block Wave 2 on the vendor call (rejected: the architecture is 90% independent of file-format detail, and blocking wastes the deferral window); design vaguely to avoid being wrong (rejected: vagueness moves the cost into Wave 3 and hides the assumptions instead of listing them).
- Consequences: DATA_MODEL absorbs either report shape because marks are computed from ingested rows, never trusted from a vendor summary. The provisional set is tracked in STATE.md and re-verified the moment the vendor conversation happens; the M2 plan doc (Wave 3) cannot leave draft until it does.

## ADR-009: Payout amount is optional and defaults to the maximum eligible  (2026-08-13, status: accepted)
- Context: [API_CONTRACT §13](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) question 2 asked whether `POST /accounts/:id/payout` should take an amount at all, or always pay the maximum. Taking an amount serves real trader preferences (tax timing, leaving a cushion above the buffer); requiring one adds a decision to a flow whose whole selling point is that it is mechanical.
- Decision: `amount_cents` is **optional**. Omitted means "pay the maximum I am eligible for". Supplied means "pay at most this". The server clamps in one direction only: `approved_cents = min(requested_cents, cap_cents_for_ordinal, withdrawable_cents)`, and the request is only eligible when that result is `>= min_payout_cents` (10000 cents). A supplied amount can only ever reduce the payout, never raise it.
- Alternatives considered: always pay maximum (simplest, but forces full extraction on traders who want to leave a cushion, and makes the cadence gap more punishing than it needs to be); required amount (one more decision on every request, and the number most traders want is the one the UI already displays).
- Consequences: [API_CONTRACT §6](architecture/API_CONTRACT.md) is amended: `amount_cents` becomes optional, `clamp_reason` gains the value `requested`, and the default is documented in the response so the trader can see which number was used. The clamp order is now a named engine function with a golden test per boundary (cap tie, withdrawable tie, below minimum, exactly minimum). Nothing in the eligibility gates changes: a request below the minimum is `payout_not_eligible`, not a denial.
- **Founder approval (2026-08-13): ACCEPTED.**

## ADR-010: Dual control on cap, split, gap, and treasury credentials, with both keys founder-held at launch  (2026-08-13, status: accepted)
- Context: Appendix D4 requires dual control plus a delay window on treasury and Rise credential changes and on any config edit touching cap, split, or cadence gap. [API_CONTRACT §13](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) question 4 flagged that at solo-founder scale a "second approver" is a second credential held by the same person, which is not separation of duties in the classical sense.
- Decision: Implement dual control now, with both credentials held by the founder on physically separate hardware keys, and state the honest reason in the control's own documentation: at launch scale this is **compromise resistance, not insider resistance**. One phished session or one owned laptop cannot move the cap, the split, the gap, or the payout rail on its own. It becomes real separation of duties on the first operations hire, with no code change.
- Alternatives considered: defer dual control until a second person exists (rejected: the control's hardest moment is a solo founder under pressure, which is exactly launch); a time-delay window with no second key (weaker, since a compromised session can wait); ceremonial approval in the UI without a distinct credential (theatre, and worse than nothing because it reads as a control in an audit).
- Consequences: A second `owner` credential must exist before the first sensitive config edit. The delay window and the second approval are both enforced server-side, so the constraint survives a determined founder in a hurry. [SECURITY.md](architecture/SECURITY.md) C-10 and [API_CONTRACT §8](architecture/API_CONTRACT.md) carry the launch-scale note verbatim, so nobody later reads the control as something it is not.
- **Founder approval (2026-08-13): ACCEPTED.**

## ADR-011: Reserve funding is weekly-manual with a same-day top-up trigger  (2026-08-13, status: accepted)
- Context: [OVERVIEW §10](architecture/OVERVIEW.md#10-open-questions-for-the-founder) question 3 left the payout-wallet funding rhythm open. Constitution M5 says the payout wallet is funded from the operating account manually or weekly, with the [reserve coverage ratio](GLOSSARY.md#reserve-coverage-ratio) on the admin home page. A purely weekly rhythm has a known failure mode: a correlated eligibility wave inside the week empties the wallet, and payout trust dies on the first late settlement.
- Decision: **Weekly manual funding as the baseline, plus a same-day top-up trigger.** When the [Eligible-Next-7-Days](GLOSSARY.md#open-liability) forecast exceeds a configured share of the payout wallet balance, the admin home raises a top-up task and alerts the same day. The threshold is a configuration value, not a constant in code, and it is reviewed in the C8 monthly retro alongside the reserve coverage ratio.
- Alternatives considered: pure weekly (rejected: the forecast exists precisely so that a bad week is visible before it arrives, and ignoring it wastes the module); continuous automated sweeps from the operating account (rejected for v1: it puts an automated money-movement path between two accounts, which is a new crown-jewel surface for the benefit of a rhythm a founder can execute by hand at this scale).
- Consequences: M5 and M6 both carry the trigger. The threshold's initial value is an open item for the M5 plan, which is the document that can compute it against the CVaR99 estimate rather than guessing. The circuit breaker remains untouched: it pauses **sales**, never payouts, and a top-up alert is not a breaker.
- **Founder approval (2026-08-13): ACCEPTED.**

## ADR-012: Admin console lives on a separate apex domain  (2026-08-13, status: accepted)
- Context: Appendix D3 requires the admin console on a separate origin, IP allowlisted, hardware-key SSO, and **unlinked from public surfaces**. [INFRA §13](architecture/INFRA.md#13-open-questions) question 2 proposed `ops.meritfutures.com`, which satisfies "separate origin" but not "unlinked": a subdomain of the brand is guessable, appears in certificate transparency logs next to the brand, and shares the registrable domain with the public surfaces.
- Decision: The admin console is served from a **separate apex domain**, unrelated to the Merit brand in name. The domain itself is chosen at infrastructure setup time and is never written into the corpus, the repository, or any public artifact. Everywhere a value is needed, docs and configuration use the placeholder **`ADMIN_ORIGIN`**, resolved from the platform vault at deploy time.
- Alternatives considered: `ops.meritfutures.com` (simpler DNS and certificate story, but it is discoverable by anyone reading certificate transparency, which is the first place an attacker looks); a path on the main domain (rejected outright by D3); an internal-only origin behind a VPN (stronger, and revisitable, but it makes break-glass access during an incident depend on a second system being up).
- Consequences: Cookie scope, CORS, and the CSP never span the two origins, so an XSS on the portal cannot reach the admin surface even in principle. The IP allowlist and hardware-key SSO still apply. INFRA, SECURITY, and OVERVIEW all refer to `ADMIN_ORIGIN` rather than a hostname. The domain is registered separately, with its own registrar lock and its own renewal reminder, because a lapsed admin domain is an outage with a hostile finder.
- **Founder approval (2026-08-13): ACCEPTED.**

---

# Wave 2 gate closure (2026-08-13)

The founder walked [OVERVIEW](architecture/OVERVIEW.md), [DATA_MODEL](architecture/DATA_MODEL.md), and [API_CONTRACT](architecture/API_CONTRACT.md) line by line. The gate is **closed**. ADR-006, ADR-007, and ADR-008 are accepted above; ADR-009 through ADR-012 record the decisions the walkthrough produced. The remaining rulings confirm designs already documented and are recorded here rather than as ADRs, because each confirms a proposal rather than choosing between alternatives.

| Ruling | Where it was asked | Outcome |
|---|---|---|
| Reserve `promotional_credit` ledger class and the `currency` columns on `ledger_entries` and `purchases` now | [DATA_MODEL §16.5](architecture/DATA_MODEL.md#16-what-needs-the-founders-eyes) | **Confirmed.** Both stay reserved and unused in v1 math, with `currency` defaulting to `USD`. The cost is two columns and one row; the migration avoided is a multi-currency retrofit onto a live ledger |
| `404` rather than `403` when a trader addresses another trader's resource | [API_CONTRACT §13.1](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) | **Confirmed as written.** Existence is not confirmed to a stranger. The support cost is real and is handled by a runbook: support looks the account up by identity in the admin console rather than trusting a trader-supplied id, and the runbook is a Wave 4 deliverable already noted in [ops/runbooks](ops/runbooks/README.md) |
| Payout endpoint takes an optional amount, defaulting to maximum eligible | [API_CONTRACT §13.2](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) | **Confirmed with an amendment.** See [ADR-009](#adr-009-payout-amount-is-optional-and-defaults-to-the-maximum-eligible) |
| Freeze requires at least one cited open flag | [API_CONTRACT §13.3](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) | **Confirmed as written.** Unchanged, and deliberately a constraint on the founder's own future self |
| Dual control on cap, split, and gap edits | [API_CONTRACT §13.4](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) | **Confirmed with a launch-scale note.** See [ADR-010](#adr-010-dual-control-on-cap-split-gap-and-treasury-credentials-with-both-keys-founder-held-at-launch) |
| Published settlement window | [API_CONTRACT §13.5](architecture/API_CONTRACT.md#13-what-needs-the-founders-eyes) | **Confirmed: 2 to 3 business days**, stated as a range everywhere it appears, including the payout response, the portal timeline, and the marketing site |
| `day.closed` carries the full mark payload rather than a thin pointer | [EVENTS §12.1](architecture/EVENTS.md#12-open-questions) | **Confirmed.** Roughly 1.25M rows per year at 5,000 accounts is the right price for a timeline and an evidence pack that reconstruct without joining to mutable state |
| Admin origin | [INFRA §13.2](architecture/INFRA.md#13-open-questions) | **Separate apex domain, placeholder `ADMIN_ORIGIN`.** See [ADR-012](#adr-012-admin-console-lives-on-a-separate-apex-domain--2026-08-13-status-accepted) |
| Reserve funding cadence | [OVERVIEW §10.3](architecture/OVERVIEW.md#10-open-questions-for-the-founder) | **Weekly manual plus a same-day top-up trigger.** See [ADR-011](#adr-011-reserve-funding-is-weekly-manual-with-a-same-day-top-up-trigger) |
| Rithmic auto-liquidation setpoint versus the Merit floor | Raised at the gate, not previously documented | **Ruled: the setpoint sits AT the floor.** Liquidation exactly at the floor survives (the floor comparison is strict `<`); slippage that carries the fill below the floor is a breach. This is now a required golden file, because it is the single place where a vendor's real-time behavior and Merit's end-of-day arithmetic meet |

**Consequence of the last ruling, stated plainly:** Merit pushes a max-loss risk setting equal to the account's current floor, so Rithmic flattens the trader at the moment the floor is touched. A perfectly filled liquidation leaves the day's low exactly at the floor, and the account survives, because [breach](GLOSSARY.md#breach) is `low < floor` and not `low <= floor`. A liquidation that fills through the floor leaves the low below it, and the account breaches. Traders therefore experience the auto-liquidator as the thing that saves them and slippage as the thing that ends them, which is both true and publishable. The golden file pins all three cases: one tick above the floor, exactly at the floor, and one tick below.
