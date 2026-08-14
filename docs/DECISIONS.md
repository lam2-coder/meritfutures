---
status: approved
depends_on: []
last_updated: 2026-08-14
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

## ADR-013: The cadence gap anchors on the settled payout's effective day; Rapid Daily becomes Merit Rapid  (2026-08-13, status: accepted)
- Context: [M01 OQ-1](plans/M01-rules-engine.md) and [EC-039](EDGE_CASES.md). The [cadence gap](GLOSSARY.md#cadence-gap) can be counted from a payout's basis day (the day the decision was computed against) or from its effective day (the first trading day whose opening balance reflects the withdrawal). On CORE-50K the choice moves the steady-state extraction ceiling from 16,875 to 19,286 cents per trading day to 27,000 cents per trading day, a 40 percent change in the per-account liability rate. The constitution's own stated ceiling of roughly 19,000 cents per day is reproducible only under the effective-day anchor. The same ruling decides whether the plan the constitution calls "Rapid Daily" can be published as daily.
- Decision: **Settlement anchored.** `cadence_anchor_day` is the settled payout's `effective_trading_day` and the gap counts trading days strictly after it (R-37). The separate `payout_anchor_day` remains the basis day and continues to reset win days and the consistency period, so progress earned during the transfer window is kept rather than confiscated (R-47). Two anchors, both stored, both replayable. **Rapid Daily is renamed "Merit Rapid"** (plan code `merit_rapid`) and its cadence is published honestly per OQ-1 option (a) rather than as "daily". No engine change was required by either half of this ruling.
- Alternatives considered: basis-day anchoring (rejected: it raises the per-account liability rate 40 percent and contradicts the constitution's own economics); a per-plan anchor so Merit Rapid could anchor on the basis day (rejected: two anchoring semantics in one engine is the kind of soft spot that becomes a support argument, and it moves liability in the wrong direction on exactly the plan whose cap is smallest); allowing multiple in-flight payouts on Merit Rapid with an aggregate in-flight cap (rejected: most engineering, most risk, and it removes a liability control to solve a naming problem).
- **Calibration note, recorded because it is load bearing:** the founder's Monte Carlo lifecycle simulation was **basis anchored**. Realized liability under the accepted settlement anchor is therefore **at most** the modeled figure, never more. The bias runs in the conservative direction, which is the direction a reserve model is allowed to be wrong in. [SIMULATION_HARNESS](testing/SIMULATION_HARNESS.md) must state this when the population is ported, and RE-S-01's calibration bands inherit the same conservatism.
- Consequences: [GLOSSARY](GLOSSARY.md#cadence-gap) gains the word "effective". The plan code `rapid_daily` becomes `merit_rapid` in [DATA_MODEL](architecture/DATA_MODEL.md) and [API_CONTRACT](architecture/API_CONTRACT.md). **The honest cadence number for Merit Rapid is not the one OQ-1 estimated:** see the correction recorded under [ADR-015](#adr-015-plan-parameters-come-from-the-founders-lifecycle-simulation-funded-minimum-trading-days-is-zero--2026-08-13-status-accepted), which found that the 5 win-day gate, not the 1 day cadence gap, sets that plan's cycle length.
- **Founder approval (2026-08-13): ACCEPTED.**

## ADR-014: The floor never resets on settlement; the lock is a permanent stop  (2026-08-13, status: accepted)
- Context: [M01 OQ-4 and OQ-5](plans/M01-rules-engine.md). The constitution's M1 section says post-payout mechanics "honor the plan's post-payout rule (reset floor to balance minus DD, or lock at size plus $X, per config)", and leaves X unfixed. M01 recommended `reset_to_balance_minus_dd` on every v1 plan on the strength of AS-04, which shows that a locked floor hands the trader a bounded-downside, unbounded-upside option exactly at the moment the account has proven it can make money.
- Decision: **The recommendation is overruled. There is no post-payout floor recompute in v1 at all.** The floor is whatever the ordinary floor rules already produced, and a settlement does not touch it:
  ```
  floor(d) = max( high_water_balance_cents(d) - drawdown_cents ,
                  floor_locked ? floor_lock_floor_at_cents : size_cents - drawdown_cents )
  ```
  where `high_water_balance_cents` **stops updating** the first day the lock engages, which is what makes the `max` above resolve to the locked value forever after (this is [floor lock](GLOSSARY.md#floor-lock) as the glossary already defines it: the rule that stops a trailing floor from trailing). The **floor lock is enabled on all three v1 plans** with **X = 10,000 cents ($100)**, engaging at `drawdown_cents + 10,000c` of closing profit so that CV-12 holds and the floor never jumps when it locks. `post_payout_floor_rule` is retired: the config key is reserved with the single valid v1 value `none`, and R-19 and R-48 become statements that settlement leaves the floor alone.
- Alternatives considered: `reset_to_balance_minus_dd` on all plans (M01's own recommendation; rejected by the founder, and the honest tradeoff is recorded below); `lock_at_size_plus` as a distinct post-payout mode (now redundant, because the ordinary lock already gets the account there and does it without a discontinuity); keeping both modes configurable and unused (rejected: an unused branch in the floor machine is an untested branch in the money path).
- Consequences, stated plainly because this is the trader-facing half of the plan's risk profile:
  - **The floor becomes strictly monotone non-decreasing, with no exceptions.** INV-06 loses its "absent a post-payout recompute" clause and becomes a stronger, simpler property. One fewer branch in `applySettlement`, one fewer state the evidence pack has to explain.
  - **After a payout, the trader's loss room equals the buffer** (pre-lock) or the buffer minus $100 (post-lock), rather than the full drawdown. On CORE-50K that is $1,000 of room after an extraction, not $2,500. This is materially tighter than the reset alternative and it must be published in those words on the rules page, because a trader who discovers it after their first payout will read it as a hidden rule.
  - **AS-04's free option is accepted, not defended against.** After the lock, the only thing the trader risks is progress above `size + $100`, which is the buffer, which was never withdrawable. The firm's exposure per post-lock cycle is the cap, and lifetime exposure stays bounded by the ladder (INV-17). The lock's engagement is an event (`rule.floor_locked`), so M6 and M7 can watch post-lock behavior as a cohort from day one. **Revisit post-beta** against that cohort's realized variance.
  - **A new publish-time validation is required and did not exist before.** With no reset, a payout taken on a new closing high reduces the balance while the floor stays put, so a cap at or above the drawdown could breach the account that earned it. CV-11 already prevents this whenever the lock is enabled; CV-17 is added to cover the lock-disabled case (`max(cap_cents) < drawdown_cents`). INV-21 now derives from CV-11 and CV-17 rather than from the reset. Golden file GS-083.
  - Net liability direction: tighter room after each extraction means marginally more breaches and marginally lower realized payout liability than the reset alternative. Like ADR-013, the error runs conservative.
- **Founder approval (2026-08-13): ACCEPTED, overruling the plan's recommendation, with a post-beta revisit on the record.**

## ADR-015: Plan parameters come from the founder's lifecycle simulation; funded minimum trading days is zero  (2026-08-13, status: accepted)
- Context: [M01 OQ-3 and OQ-8](plans/M01-rules-engine.md). Six Merit Rapid parameters (drawdown, eval profit target, win-day count, win-day floor, buffer, funded minimum trading days) and two shared ones are absent from the constitution. M01 Appendix A carried proposals marked `RULING NEEDED` rather than inventing them silently. The founder's Monte Carlo lifecycle model (`mc_lifecycle.py`, `OUR_PLANS`) is the artifact those numbers were actually calibrated in.
- Decision: The `OUR_PLANS` table in the founder's lifecycle simulation is the **source of record** for every plan parameter the constitution does not state, and it **matches M01's proposals exactly** on all eight open values. Separately, **funded `min_trading_days` is 0 on all three plans**, and the field is retained rather than dropped. A gate configured to 0 is deliberately disabled and reports `pass: true, skipped: true`, the same shape the [consistency denominator rule](GLOSSARY.md#consistency-denominator-rule) already uses, so a disabled gate is visibly disabled in the eligibility breakdown rather than silently true.
- Alternatives considered: keeping funded `min_trading_days` at 5 as a floor for future configs (rejected: EC-042 shows the gate is dominated by the 5 win-day requirement and can never bind, and publishing a dominated gate as a protection is exactly the marketing-versus-implementation gap constitution section 0.5 exists to prevent); dropping the column (rejected: it is the binding gate on any future plan with fewer required win days than minimum days, and re-adding a money-path column later is a migration on a live table).
- Consequences:
  - Appendix A's `RULING NEEDED` markers are cleared and the `Source` column now reads `mc_lifecycle.py OUR_PLANS` for those rows. Every published number traces to either the constitution or that file.
  - The publish-time warning for a dominated gate stays and now fires on all three plans by design, so the diff shows it deliberately rather than as a surprise.
  - **A finding this ruling produced, which needs founder eyes and is not yet decided.** With win days confirmed at 5 and resetting to the basis day, Merit Rapid's cycle is bound by the **win-day gate at 5 trading days**, not by its 1 day cadence gap. OQ-1's estimate of "3 to 4 trading days" predated these numbers and is wrong; the honest published figure is **about one payout per 5 trading days**, roughly weekly. Two consequences follow. The 1 day gap on Merit Rapid is a **dominated gate** in the same sense as EC-042 and must not be marketed as the thing that makes the plan rapid (EC-049). And an instant settlement rail does **not** unlock true daily cadence on this plan, because the settlement leg is already hidden behind the win-day gate; only `win_days.required_count` sets that cadence, and lowering it is a liability decision rather than a rail decision (see the M1 gate closure table, OQ-12).
  - Validation of the confirmed lineup: at these parameters all three plans land within roughly 16,875 to 19,286 cents per trading day of trader extraction at the ceiling (Core EOD 16,875 to 19,286, Merit Rapid 18,000, Direct 16,875 to 19,286), which reproduces the constitution's stated approximately $190 per day design ceiling across the whole lineup rather than on one plan. INV-17 bounds the lifetime figure independently.
- **Founder approval (2026-08-13): ACCEPTED.**

## ADR-D1: Corpus phase runs on a single trunk, with pull and push enforced by hooks  (2026-08-14, status: accepted)
- Context: The corpus had accumulated four branches (`main`, `dev`, `premain`, and a merged `claude/*` feature branch) with the full corpus living on `dev` and `main` holding only a README. The operator is solo, works across two machines, and each Claude Code session runs in an ephemeral container. Under those conditions branch-per-change buys review isolation nobody uses and costs a real failure mode: work that exists in one container and nowhere else.
- Decision: **`main` is the sole trunk for the corpus phase and holds the full corpus.** `dev` merges into `main`, `main` is the repository default branch, and `dev` plus the stale `claude/*` branches are deleted. Every corpus session commits directly to `main` and pushes to `origin` immediately after each commit. Enforcement is deterministic per constitution C10 rather than advisory: `.claude/settings.json` is committed to the repository with a **`SessionStart` hook running `git pull --ff-only`** and a **`Stop` hook running `git push origin HEAD`**. CLAUDE.md's rituals are amended to match: start is pull, every commit is followed immediately by a push, end is verify clean and pushed.
- Alternatives considered: keeping `dev` as the integration branch (rejected: with one operator and no CI on the corpus, `dev` is `main` with a rename and an extra merge step that is exactly where the lost work would sit); branch-per-session with a pull request each time (rejected for the corpus: a pull request whose only reviewer is its own author is ceremony, and the review that matters here is the founder reading a document, not a diff); relying on CLAUDE.md alone (rejected by C10's own doctrine, which is the reason this is a hook).
- Consequences:
  - Origin is the single source of truth and the two machines converge on it every session start.
  - **Both hooks report failure loudly and exit zero rather than blocking.** A blocking `Stop` hook is the stricter reading of C10's completion gate, and it was deliberately not taken: a network outage or a rejected non-fast-forward push would leave a session unable to terminate, which converts an unrelated failure into a wedged agent. The softening is recorded here rather than left as an undocumented implementation detail, and the end ritual carries a manual verification (`git status` clean, `git log origin/main..HEAD` empty) precisely because a hook that printed a failure into a scrollback nobody read is not a control.
  - The `premain` branch was left in place: it was not named in the ruling and it points at the same commit `main` held before the merge, so deleting it is a separate decision rather than an implied one.
  - **Execution status, recorded because two halves of this landed and one did not.** The merge is done and pushed: `main` fast-forwarded to `dev` and holds the full corpus, and `main` was already the repository default branch, so that half needed nothing. **The branch deletions did not happen.** `git push origin --delete` and the equivalent REST calls both return **403** from this session's credentials, which permit push to a branch but not ref deletion or repository administration. `origin/dev` and `origin/claude/axcera-brochure-research-7s2pdd` therefore still exist, pointing at commits `main` already contains, so they are stale rather than divergent and nothing is at risk. **Deleting them is a founder action**, tracked in [STATE](STATE.md). Until they are gone, the single-trunk rule is a convention held by the hooks and this ADR rather than by the absence of anywhere else to push.
  - **This is a corpus-phase rule and it expires at FREEZE.** Branch-per-module slice, CI green before merge, and migrations only on `main` through reviewed pull requests all resume for application code per constitution C7. The distinction is that a document has one reviewer and code has a test suite.
- **Founder ruling (2026-08-14): ADOPTED.**

## ADR-016: A ledger imbalance halts payouts for the implicated identity; only a global mismatch halts everything  (2026-08-13, status: accepted)
- Context: The approved [EVENTS](architecture/EVENTS.md) catalogue says `ledger.invariant_violated` is "the one event whose consumer is allowed to change system behavior automatically", and what it does is halt payouts. That is correct in spirit: a ledger that does not sum to zero means we do not know what we owe. [M05 AS-M5-05](plans/M05-payout-system.md) found that as written it is also a **denial-of-payouts trigger with a one cent activation energy**. Anyone who can cause a single imbalance anywhere halts every payout for every trader until a human intervenes. Candidate levers include a refund and chargeback race on one purchase, a partial refund with an odd amount interacting with a split, and an affiliate commission reversal timed against a statement boundary. The attack never has to move money, only to make the books disagree, and Merit's own safety control does the damage. For a firm whose brand is payout reliability, that is a very cheap outage to buy.
- Decision (proposed): **Scope the halt by scope of ignorance.** A per-transaction imbalance halts payouts for the implicated identity and its accounts only. A **global** sum mismatch halts everything, because only a global mismatch means the aggregate is unknown. Supporting both: the per-transaction zero-sum check is a deferred constraint trigger at commit, so an unbalanced transaction cannot be written in the first place, which means a global mismatch implies data corruption or a direct write and genuinely warrants stopping the firm. A global halt pages immediately, names the implicated transaction range, and opens with the reconciliation query rather than a search for a cause.
- Alternatives considered: keep the global halt as written (rejected: it converts a one cent bug or a crafted race into a firm-wide outage, and the first false global halt is also the moment someone learns to bypass the control); halt nothing automatically and alert only (rejected: paying out of a ledger we know is wrong is exactly the failure the invariant exists to prevent).
- Consequences: amends the approved [EVENTS section 7](architecture/EVENTS.md) wording. [M05](plans/M05-payout-system.md) OQ-M5-01 raises it for a ruling rather than assuming it; GS-110 and EC-070 already carry the scoped behavior. Nothing else changes: the invariant, the deferred trigger, and the nightly global assertion all stand.
- **Founder approval (2026-08-14): ACCEPTED, with two conditions that are part of the acceptance rather than follow-ups.**
  - **The scope classifier is conservative, and unattributable imbalance is global.** An imbalance is scoped to an identity only when the implicated transaction can be attributed to exactly one identity with certainty. Anything else, including an imbalance that spans identities, one whose attribution is ambiguous, and one that cannot be traced to a transaction at all, is **treated as global** and halts everything. The failure direction matters and it is chosen deliberately: wrongly scoping a global problem to one identity means paying out of books we do not understand, which is the exact failure the invariant exists to prevent. Wrongly globalizing a local problem is an outage, and an outage is recoverable. The classifier is therefore written to prove locality before it grants it, never to assume locality because it cannot see further.
  - **An identity-scoped halt pages immediately and carries an escalation clock to global.** The scoped halt is not the quiet half of this control. It pages on the same channel as a global halt, and it starts a clock: an identity-scoped imbalance that is not resolved inside a configured window escalates to a global halt automatically. Without the clock, scoping the halt would create a second, slower version of AS-M5-05, in which an attacker who can produce one attributable imbalance buys an indefinitely unexamined corner of the ledger. The window's initial value is an M5 configuration item, proposed at 24 hours, and it is reviewed in the C8 retro rather than being a constant in code.

## ADR-017: Every outbound payment in Merit uses one rail and one transfer table  (2026-08-13, status: accepted)
- Context: [M08 AS-M8-05](plans/M08-affiliate-system.md). Affiliate commissions and trader payouts are computed by different modules, appear on different screens, and are reviewed with different mental models. It would be natural to give affiliate statements their own settlement path. Doing so would put a second outbound money path in the system, and [M07](plans/M07-risk-abuse.md)'s D-09 destination-concentration detector, which is the strongest mule signal available, was specified against `payout_transfers` and would simply not see it. An operator could then register as an affiliate, point the affiliate destination at an account that also receives trader payouts from several unrelated identities, and have a payment channel with a commercial cover story.
- Decision (proposed): **One rail, one destination table, one detector.** Affiliate payments post through [M5](plans/M05-payout-system.md)'s transfer machinery, with the same idempotency discipline, the same destination records, and the same settlement webhook path. M8 computes what is owed and never moves money. The same rule binds every later module that ever pays anybody: refunds, bonuses, promotional credit, live-program payments, and anything M11 through M19 invents.
- Alternatives considered: a separate affiliate payment path (simpler to build in isolation, and it creates a payment channel nobody reconciles against the trader-payout channel); a shared table with a discriminator column but separate code paths (the table is the part that matters least; the detector reads the table but the idempotency and destination-verification discipline lives in the code).
- Consequences: M8's scope shrinks and M5's grows slightly, which is the right direction because M5 is the module already built to the money-path standard. The generalized rule is stated here so it does not have to be rediscovered in each of M09 through M19: **a second outbound payment path is not an efficiency, it is a blind spot with a schedule.**
- **Founder approval (2026-08-14): ACCEPTED, with one addition.** **Affiliate destinations carry the same 48 hour cooling window on change** as trader payout destinations (C-11, Appendix D4). The reasoning is that one rail with one destination table is only actually one control if the destination-change path is also one control. An affiliate destination that could be repointed instantly would be the soft side of the same rail, and an attacker who compromised an affiliate account would find the fast route to the same money. The cooling window, the re-verification, and the notification to the contact already on file are identical to the trader case; the only difference is which screen initiates the change. Binding on [M08](plans/M08-affiliate-system.md) and [M05](plans/M05-payout-system.md).

## ADR-018: Merit Rapid requires 3 win days  (2026-08-14, status: accepted)
- Context: [OQ-12](#m1-gate-closure-2026-08-13), raised by the ADR-015 ruling and left open at the M1 gate. With `win_days.required_count = 5` and win days resetting to the basis day (R-47), Merit Rapid's cycle is bound at **5 trading days by its win-day gate**, not by its 1 day cadence gap. The plan's name claims speed the lineup did not deliver: its published cadence was roughly weekly, the same order as Core EOD, and its 1 day gap was a dominated gate (EC-049) that could not be marketed as the reason the plan is fast. M01 priced the alternatives and declined to choose, because the choice is plan economics rather than engine behavior: every option is a config edit.
- Decision: **`win_days.required_count = 3` on `merit_rapid`.** `min_trading_days` stays at 0 on all three plans, unchanged from [ADR-015](#adr-015-plan-parameters-come-from-the-founders-lifecycle-simulation-funded-minimum-trading-days-is-zero--2026-08-13-status-accepted). No engine change is required: this is a plan-config value and the gate arithmetic is untouched.
- Recalibration, which is what makes the number defensible: the founder re-ran the lifecycle simulation at `w=3` and recorded the resulting unit economics. **Firm dollars per funded account $889, funded-to-payout conversion 48.1 percent, 2.09 payouts per paying account, and roughly 18 percent margin.** **Recalibrated exactly at the FREEZE gate once the engine landed: $904.07, 48.11 percent, 2.13, and 16.9 percent** (see the recalibration section at the end of this file). The funnel figure matched to two decimals; the others moved immaterially and unfavorably. Those figures, not the plan's name, are the reason 3 was chosen over 1 or 5.
- **The per-day extraction ceiling of record is $300** (30,000 cents) per trading day at 50K: a 100,000c cap, a 9000bp split, a 3 trading day cycle. This ADR originally recorded approximately $240 and flagged the discrepancy; **the $240 figure was settlement-anchored commentary that predated [ADR-019](#adr-019-merit-wallet-two-leg-payouts-with-the-cadence-anchor-on-wallet-credit--2026-08-14-status-accepted) and has been corrected** (founder ruling, 2026-08-14). The `w=3` simulation calibration was **basis anchored and already contained the 3 trading day cycle**, so the correction is a bookkeeping fix to a stale annotation and **carries no economic change**: the $889, 48.1 percent, 2.09, and 18 percent figures above were produced under the 3 day cycle and stand exactly as recorded.
- Alternatives considered: leaving it at 5 and renaming the plan again (rejected: the lineup then has no fast plan at all, and Merit Rapid's whole commercial purpose is the trader who wants a shorter cycle); dropping to 1 (rejected at the M1 gate's own arithmetic: roughly 30,000 cents per trading day on the settlement rail and roughly 45,000 on an instant one, against a design ceiling near 19,000, and it drives `cadence_gap` and `win_days` both to the floor, which is AS-01 territory); holding the ceiling by cutting the cap to about 42,000 cents (rejected: a $420 cap is a worse product than a slower cadence, and it makes the plan's headline number the unattractive one).
- Consequences:
  - **Merit Rapid's cycle becomes 3 trading days** and its published cadence copy changes from "about 5 trading days" to "about 3 trading days", binding on [M09](plans/M09-marketing-site.md) and [M04](plans/M04-trader-portal.md). [M01 Appendix A.2](plans/M01-rules-engine.md) and A.4's validation walk are re-materialized at `w=3`.
  - **The dominated-cadence-gap warning still fires**, and more strongly than before, because [ADR-019](#adr-019-merit-wallet-two-leg-payouts-with-the-cadence-anchor-on-wallet-credit--2026-08-14-status-accepted) drives `min_settlement_lag_trading_days` to 0 for the cadence anchor: the comparison becomes `0 + 1 <= 3`. The 1 day gap on this plan remains a gate that never binds and still may not be described as the reason the plan is fast (EC-049 stands, with its arithmetic updated).
  - **Merit Rapid's ceiling nominally exceeds the benchmark that made a competitor a magnet, and the defense is not the per-day rate.** $300 per trading day is a fast headline number, and the [dossier](../research/ADVERSARY_DOSSIER.md) is clear that high-cadence payout products attract disproportionate adversarial attention: MyFundedFutures' Rapid plan, with 24 hour payout eligibility, is the market's reference point for exactly this ([TOP10_FIRMS](../research/TOP10_FIRMS.md)). Reading the per-day rate as Merit's exposure would be the mistake, because **the per-day rate is not what bounds this plan.** Three things are:
    1. **The win-day gate.** Three win days at the win-day floor must be earned, on three separate trading days, and they reset to the basis day on every settlement (R-47). The cadence is a floor on effort, not a schedule.
    2. **The 5-payout lifetime ladder**, which caps a Merit Rapid account at **5 x 90,000c = 450,000c, roughly $4,500 to the trader over its entire life** (INV-17). A per-day rate that runs for at most **15 trading days** is a very different object from one that runs indefinitely, and the ladder is what makes the lifetime figure the number that matters. **Shortened from 8 to 5 by [ADR-024](#adr-024-the-ladder-and-the-live-invitation-are-two-separate-mechanisms--2026-08-14-status-accepted), which strengthens this defense rather than weakening it**: liability is monotone-decreasing in `max_payouts`.
    3. **Detection**, which since this gate attacks the first cycle rather than the second: D-12's day-0 graph priors, D-13's young-account fast path, and D-14's clique position sums ([M07](plans/M07-risk-abuse.md)).
    Stated plainly so nobody has to reconstruct it under pressure: **a fast per-day rate on a hard-capped, gated, short-lived ladder is a marketing advantage; the same rate without the ladder would be a liability hole.** Merit has the ladder.
- **Founder ruling (2026-08-14): OQ-12 RESOLVED. `w=3` approved.**

## ADR-019: Merit Wallet, two-leg payouts with the cadence anchor on wallet credit  (2026-08-14, status: accepted)
- Context: Merit's product promise is payout speed, and the binding constraint on that promise was never the rules engine. It was the external rail: 2 to 3 business days of settlement latency that the trader experiences as the firm being slow, plus [ADR-013](#adr-013-the-cadence-gap-anchors-on-the-settled-payouts-effective-day-rapid-daily-becomes-merit-rapid--2026-08-13-status-accepted)'s settlement anchor, which pushed the whole settlement leg inside the cadence clock and made every plan's cycle longer than its gates implied.
- Decision: **Adopt the Merit Wallet.** Payouts become two legs.
  - **Internal leg (instant).** A payout request settles **immediately** to an internal wallet: a ledger account per identity. Approval, ledger posting, and wallet credit happen in one transaction with no external party in the path. **The `promotional_credit` ledger class and the `currency` columns reserved at the Wave 2 gate activate here**, which is what that reservation was for.
  - **External leg (unchanged).** A withdrawal from wallet to Rise carries every existing control: KYC verification, the 48 hour destination-cooling window, name matching, and the published 2 to 3 business day settlement. **No external withdrawal fees. Minimum external withdrawal $100** (10,000 cents), matching `min_payout_cents`.
- **The cadence anchor moves to the wallet-credit day, which is the basis day.** `cadence_anchor_day` is the day the wallet was credited, and because the internal leg is instant that is the same trading day the decision was computed against. This **supersedes ADR-013's anchor half**; ADR-013's two-anchor structure survives intact, and the two anchors simply now coincide. **`G-NO-IN-FLIGHT` migrates to the external leg only**: there is no window in which an internal payout is in flight, so there is nothing to stack inside, and AS-01 is structurally resolved rather than gated. The external leg keeps one-in-flight per identity.
- Alternatives considered: buying a faster external rail (rejected as insufficient: [M01 OQ-12](plans/M01-rules-engine.md)'s finding was that an instant rail does not shorten a cycle whose settlement leg already hides behind the win-day gate, so the rail was never the lever); paying instantly to the external destination with no wallet (rejected: it removes the KYC, cooling, and name-match controls from the money-out path, which are the controls that make payout mules and account takeover survivable); a wallet with interest or peer-to-peer transfer (rejected outright, see the legal note below).
- Consequences, and the first one is the important one:
  - **This is a return to basis-day anchoring across the whole lineup, and the liability arithmetic moves with it.** ADR-013 rejected basis anchoring because it raises the per-account liability rate by roughly 40 percent. That rate increase now happens, by choice rather than by accident. Core EOD's cycle compresses from 7 to 8 trading days to **5**, and its per-day extraction rises from 16,875 to 19,286 cents to **27,000 cents**. Direct moves identically. Merit Rapid at `w=3` runs a 3 trading day cycle.
  - **The reserve model is not invalidated by this, and the reason is worth being precise about.** ADR-013's calibration note records that the founder's Monte Carlo lifecycle simulation was **basis anchored**, which made realized liability under the settlement anchor *at most* the modeled figure. Moving back to basis anchoring does not exceed the model: it **spends the conservatism margin that ADR-013 accidentally created.** Realized liability now tracks the model rather than sitting below it. That is a supportable position and it is a materially different one from where the corpus stood yesterday, so the CVaR99 estimate and RE-S-01's calibration bands lose their built-in safety cushion and must be read as central estimates from here on. Recorded in [SIMULATION_HARNESS](testing/SIMULATION_HARNESS.md).
  - **Liquidity improves while accounting liability does not.** Cash leaves Merit only on the external leg, so a correlated eligibility wave ([M05 AS-M5-03](plans/M05-payout-system.md)) now lands on the wallet rather than on the payout wallet's cash balance, and the firm gets the float of every trader who does not withdraw immediately. That is a real improvement in the failure mode constitution 0 names as fatal. It is **not** a reduction in what Merit owes, and the design says so: **wallet balances join Open Liability and the reserve coverage ratio** ([M06](plans/M06-admin-ops-console.md) P-M6-01 and P-M6-07). A wallet balance is money owed to a trader that has already cleared every gate, which makes it the most certain liability on the book, not the least.
  - Module amendments: **wallet is a checkout payment method** ([M03](plans/M03-billing-checkout.md)), **wallet UI ships in the portal** ([M04](plans/M04-trader-portal.md)), **M05's existing flow becomes the external leg** with the internal leg added in front of it, and **M06 gains wallet balances in liability and reserve coverage**.
  - Security: **wallet-spend velocity limits and an account-takeover blast-radius analysis land in [SECURITY](architecture/SECURITY.md) and D4.** The two failure modes are genuinely asymmetric and are controlled differently. External theft still meets destination cooling, KYC, and name matching, so it stays slow and detectable. **Internal spend is the contained failure mode**: an attacker with a valid session can spend a stolen wallet balance on evaluations and resets, which is a real loss but one that never leaves Merit's own books and is fully reversible by ledger entry. Containment is the point, and it is why the wallet is a better place for a compromised balance to sit than a bank destination.
- **Founder ruling (2026-08-14): ADOPTED.**

### ADR-019a: The gamification bright line
Recorded here because the wallet, the `promotional_credit` class, and any future rewards mechanic are the surfaces where this line gets crossed by accident.

**Purchased is always known contents. Randomized is earned only, and only with disclosed odds. There are no purchased loot boxes in Merit, ever.**

Concretely: anything a trader pays money for states exactly what they receive before they pay. Anything with a randomized outcome is obtained through activity rather than purchase, and its odds are published. The two rules compose, so there is no product in which money buys a random outcome.

**Rationale, two parts, both load bearing.** *CFTC posture:* Merit sells simulated-trading evaluations in a market whose regulatory characterization is already contested, and a paid random-outcome mechanic invites the reading the firm can least afford, which is that the product is a wager rather than an evaluation. The distance between "evaluation with a published rulebook" and "paid chance" is the distance between Merit's entire compliance position and someone else's problem. *Brand:* the firm's differentiator is that every number is stated in advance and the rules do not surprise you. A purchased random reward is the exact opposite proposition, and shipping one would undercut the transparency claim more than any single rule ever could.

Binding on [M14](plans/M14-loyalty-retention.md) (loyalty and streaks), [M17](plans/M17-offers-engine.md) (offers and promotional credit), and anything M11 through M19 later invents. A mechanic that needs this line explained is a mechanic that has already failed it.

## ADR-020: A two-tier data plane, with an indicative realtime layer over the authoritative EOD engine  (2026-08-14, status: accepted)
- Context: [ADR-002](#adr-002-rithmic-ingest-path-is-sftp-first-both-directions--2026-08-13-status-accepted) settled the rules math as EOD and batch, and the T+1 tradeoff was accepted explicitly: every derived state reflects the last closed trading day. That is right for money decisions and it is a genuinely poor trading product. A funded trader watching a floor cannot see how close they are to it, which is the single number they care about most, and "as of last closed session" is a correct label on a dashboard that is not useful during a session.
- Decision: **Two tiers, with a hard rule between them.**
  - **Tier 1, authoritative.** Unchanged and untouched. EOD and batch per ADR-002. Every rule, gate, breach, eligibility decision, and money movement is computed here, from closed-session data, by the pure engine.
  - **Tier 2, indicative.** Ships in v1. Streaming ingest through the [platform adapter](GLOSSARY.md#platform-adapter) (an R|API+ admin connection, or high-frequency snapshot polling where a stream is unavailable), into a live cache, pushed to clients over WebSocket. It drives **live P&L, projected floor distance, and live win-day and consistency tracking on the trader dashboard**, and **live Open Liability on the admin console**.
  - **The hard rule, and it is the whole reason this is safe: indicative data never feeds any eligibility, breach, or money decision.** Not as an input, not as a pre-check, not as an optimization. The engine never reads the live cache. Tier 2 is a view.
  - **Every surface is labeled**, indicative versus as-of-last-closed-session, at the point of use rather than in a footnote. **Feed loss degrades gracefully to the last closed session** with the label changing to match, because a live number that silently freezes is worse than an honest stale one.
  - **Built against the streaming synthetic simulator.** The real feed plugs in post-agreement, exactly as the batch pipeline already does, so this does not become a second reason the vendor call blocks engineering. The streaming mechanism is added to the [M02](plans/M02-rithmic-bridge.md) vendor-call agenda.
- Alternatives considered: staying EOD-only (rejected: it is a product decision disguised as an architecture decision, and the competitive floor in this market includes a live dashboard); making the realtime layer authoritative for a subset of rules such as the floor (**rejected firmly**: it puts intraday vendor data on the money path, reintroduces every replay-determinism problem ADR-002 solved, and creates two sources of truth for the one number the firm is most often disputed about); deferring to post-v1 (rejected: retrofitting a live layer onto surfaces designed without one is more work than building both, and the labeling discipline is much harder to add later than to start with).
- Consequences:
  - **Merit gets to publish the honest version of a claim competitors make dishonestly.** Firms that show live numbers usually enforce against them; Merit shows live numbers and enforces against closed sessions, and says so on the surface. The label is a feature.
  - Amendments to [M02](plans/M02-rithmic-bridge.md) (streaming ingest through the adapter, plus the vendor-agenda item), [M04](plans/M04-trader-portal.md) (WebSocket delivery, live dashboard elements, degradation behavior, and the labeling rule, which supersedes M04's "polling, not websockets, in v1" position), and [M06](plans/M06-admin-ops-console.md) (live Open Liability).
  - **Roughly 2 to 4 weeks of schedule**, reflected in constitution section 8's plan at Wave 4. This is the largest single scope addition the corpus has taken since the constitution was written, and it is recorded as a duration rather than as "some extra work" so that it can be traded against something if the schedule tightens.
  - The labeling requirement is testable and becomes one: a component that renders an indicative value without its label is a build failure, in the same way M04's INV-M4-02 already treats `as_of_trading_day`.
- **Founder ruling (2026-08-14): ADOPTED.**

---

# M1 gate closure (2026-08-13)

The founder took [M01-rules-engine.md](plans/M01-rules-engine.md) for external review and returned rulings on all eleven open questions. The gate is **closed**. [M01](plans/M01-rules-engine.md), [GOLDEN_SCENARIOS](testing/GOLDEN_SCENARIOS.md), and [EDGE_CASES](EDGE_CASES.md) move to `approved`. ADR-013, ADR-014, and ADR-015 above carry the three rulings that chose between alternatives or amended the constitution; the table records the rest.

| OQ | Question | Ruling |
|---|---|---|
| OQ-1 | Cadence anchor, and can Rapid Daily be published as daily | **Settlement anchor confirmed. Renamed Merit Rapid, cadence published honestly (option a).** See [ADR-013](#adr-013-the-cadence-gap-anchors-on-the-settled-payouts-effective-day-rapid-daily-becomes-merit-rapid--2026-08-13-status-accepted). The sim was basis anchored, so realized liability is at most the modeled figure |
| OQ-2 | Funded phase starts at account size, eval profit not carried | **Confirmed, with the three placements required rather than suggested:** the rules page, the eval progress card, and the pass email each state it in plain language. R-31 is unchanged; what changed is that the disclosure is now a launch requirement carried into M04 and M10, not a recommendation |
| OQ-3 | Merit Rapid's unspecified funded gates | **Confirmed from `mc_lifecycle.py` `OUR_PLANS`, which matches M01's proposals exactly.** Funded minimum trading days is 0 on all three plans, field retained. See [ADR-015](#adr-015-plan-parameters-come-from-the-founders-lifecycle-simulation-funded-minimum-trading-days-is-zero--2026-08-13-status-accepted) |
| OQ-4 | Floor lock value X and which plans enable it | **Approved. X = 10,000 cents ($100), lock enabled on all three plans.** Folded into [ADR-014](#adr-014-the-floor-never-resets-on-settlement-the-lock-is-a-permanent-stop--2026-08-13-status-accepted) because it and OQ-5 together define one floor machine |
| OQ-5 | Post-payout floor rule per plan | **Overruled. No post-payout reset at all.** `floor = max(trail minus DD, lock)`, revisit post-beta. See [ADR-014](#adr-014-the-floor-never-resets-on-settlement-the-lock-is-a-permanent-stop--2026-08-13-status-accepted) |
| OQ-6 | Operator asymmetry on the hard daily loss limit | **Aligned as "exactly at the limit survives".** R-22 becomes `-realized_pnl_cents > daily_loss_limit_cents` (strict `>`), published as "more than", matching the floor's strict `<`. This **amends the approved [STATE_MACHINES](architecture/STATE_MACHINES.md) G-BREACH guard**, which carried `>=`. No v1 plan configures a daily loss limit, so nothing in production turns on it; the point is that the two operators never disagree by accident when one is enabled. Golden file GS-079 |
| OQ-7 | Identity-level extraction ceiling | **No identity ceiling in v1.** AS-09 is handled by visibility (the identity-level Eligible-Next-7-Days forecast plus [ADR-011](#adr-011-reserve-funding-is-weekly-manual-with-a-same-day-top-up-trigger)'s same-day top-up trigger), not by a rule. The engine stays per-account and pure, and no cross-account state enters the fold. M6 owns the forecast; M7 owns the correlation detector |
| OQ-8 | Funded minimum trading days on Core EOD | **Resolved via OQ-3: 0 on all three plans.** See [ADR-015](#adr-015-plan-parameters-come-from-the-founders-lifecycle-simulation-funded-minimum-trading-days-is-zero--2026-08-13-status-accepted) |
| OQ-9 | What the trader sees when eligibility is lost by making money | **Confirmed as specified.** The consistency meter and `profit_needed_to_dilute_cents` are displayed **at all times**, not only when the gate fails. Binding on M04 |
| OQ-10 | Absorbed corrections | **Confirmed as specified.** The absorbed total is a named line on the admin liability dashboard (M06), and a systematically favorable correction pattern per identity is a flag (M07), not merely a number |
| OQ-11 | Engine upgrade approval gate | **Confirmed as specified, including bugfixes in the trader's favor.** "It favors the trader" is a judgment, and the whole purpose of the gate is that a human makes it deliberately. Appendix B step 3 stands unchanged |
| **OQ-12** | **NEW, raised by the OQ-3 ruling and not yet decided.** Merit Rapid's cycle is 5 trading days because of its 5 win-day gate, not 3 to 4 because of its 1 day cadence gap. Is a weekly cadence acceptable under the name "Merit Rapid", or should `win_days.required_count` drop on that plan? | **Open, non-blocking.** Dropping to 1 win day with the current rail gives a 3 to 4 trading day cycle and roughly 30,000 cents per trading day of extraction, about 1.6 times the design ceiling; with an instant rail it gives a 2 day cycle and roughly 45,000, about 2.4 times. Holding the ceiling at a 2 day cycle would require the cap to fall to about 42,000 cents ($420). This is a plan-economics decision for the founder and the lifecycle model, not an engine change: every option above is a config edit. Nothing blocks M02 through M08 |

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

---

# Wave 3 batch 1 gate closure (2026-08-14)

The founder reviewed [M02](plans/M02-rithmic-bridge.md) through [M08](plans/M08-affiliate-system.md) and returned rulings on every open question raised in them, plus two new architecture decisions taken at the same sitting. The gate is **closed**. **M03 through M08 move to `approved`; M02 stays at `review`**, because [ADR-005](#adr-005-rithmic-vendor-call-deferred-m2-ingest-specifics-are-provisional--2026-08-13-status-accepted) forbids it leaving review while the vendor call is outstanding, and that is by design rather than an omission.

Five rulings became ADRs above because each chose between alternatives or amended an approved document: **ADR-016** (scoped ledger halt, accepted with a conservative classifier and an escalation clock), **ADR-017** (one outbound rail, accepted with affiliate destination cooling), **ADR-018** (Merit Rapid at 3 win days, resolving OQ-12), **ADR-019** (the Merit Wallet and the two-leg payout, with ADR-019a's gamification bright line), and **ADR-020** (the two-tier data plane). The rest are recorded below.

## The rulings that confirm or extend a design

| Ruling | Where it was asked | Outcome |
|---|---|---|
| [M01 section 3.4](plans/M01-rules-engine.md)'s floor expression, read as "the high-water balance stops updating at the lock" | Session-5 landmine: the founder's `max(trail minus DD, lock)` formulation is literally correct only under that reading | **Confirmed as written.** The reading M01 adopted is the intended one. The alternative reading, in which the trail continues after locking, is economically impossible because it breaches every account on its second payout. Section 3.4 needs no correction and everything downstream of it stands |
| Copy trading | [M07 OQ-M7-01](plans/M07-risk-abuse.md) | **Ruled, see the clause below.** Permitted same-identity, prohibited cross-identity, prohibited through third parties. Wired into D-01, the ToS drafting note, and M07's detector logic |
| Evidence pack tiering | [M06 AS-M6-01](plans/M06-admin-ops-console.md), SD-M6-04 | **Confirmed as two tiers.** A trader-facing pack shows **conduct, rule text, and the trader's own trades**. Thresholds, detector internals, parameters, and population comparisons are **internal and counsel tier only**. The `regulator` audience follows the internal profile. This closes the cross-module control with [M07](plans/M07-risk-abuse.md)'s SD-M7-03 registry supplying the strip list |
| Fail-closed provisioning | [M02 OQ-M2-04](plans/M02-rithmic-bridge.md) | **Ruled as design law, not a preference.** See below |
| Break-glass for the second `owner` credential | [M06 OQ-M6-03](plans/M06-admin-ops-console.md) | **Ruled: sealed physical backup.** See below |
| Revenue and liability recognition timing | [M05 OQ-M5-04](plans/M05-payout-system.md) | **Ruled.** See below |
| PSP application timing | [M03 OQ-M3-04](plans/M03-billing-checkout.md) | **Calendar note recorded:** applications go out **the day the capital go-decision is made**, not before and not after. The dependency was never a design one and this fixes it to an event rather than a date |

## The copy-trading clause

**Allowed:** copy trading **between accounts of the same verified identity**. A trader running the same strategy across their own Merit accounts is doing something the account cap already contemplates and the rules already bound.

**Prohibited:** copy trading **across identities**; the use of **third-party signal or copy-trading services**; and **account management**, meaning any arrangement in which one person trades an account that belongs to another.

Three consequences, all of which needed a ruling before they could be built:

1. **Cross-identity copy is itself a violation** ([M07](plans/M07-risk-abuse.md) D-01). Before this ruling D-01 produced flags nobody could act on, because the dossier is explicit that copy rings are not always ToS-illegal and Merit had not said which kind it forbade. D-01's output now divides cleanly: same-identity clustering is **not a flag at all** and is filtered at the detector rather than dismissed in the queue, which also removes the largest source of benign noise from M7's most-fired detector. Cross-identity clustering is a flag whose evidence is the conduct itself rather than a statistical inference.
2. **A legal drafting note** is filed in [legal/](legal/README.md): the ToS needs the clause enumerated in these terms, because "coordinated trading" is not a standard anyone can comply with and [M07 AS-M7-07](plans/M07-risk-abuse.md) requires enforcement to rest on a clause a trader can read in advance.
3. The clause is **enforceable and explicable**, which was the test. It matches what the per-entity account cap already implies, and it does not require Merit to argue about correlation coefficients in public.

## M07 detector additions

Three, each closing a gap the plan itself identified and could not close alone.

- **Day-0 graph-prior pairing from identity signals.** Candidate pairs and groups are formed from the identity graph **before any trading data exists**, so a ring that funds on day 0 is already a watched cluster rather than one discovered by twenty days of correlation. This is the direct answer to [AS-M7-01](plans/M07-risk-abuse.md)'s finding that the flagship detector does not defend the first cycle.
- **A young-account fast path**, with a **5 trading day window** and deliberately **tightened thresholds: correlation below -0.95, plus size and timing mirroring**. The tightening is what makes a short window usable: on five days of data a -0.8 threshold is noise, and requiring near-perfect inverse correlation together with mirrored size and timing makes a false positive very unlikely while still catching the pattern the ring actually runs. This detector is precise rather than sensitive, on purpose, because it fires on accounts too young to have any other evidence.
- **Clique-level position-sum detection.** Within a candidate clique, detect summed positions at or near zero, which is the signature of third-leg rotation and is invariant to which pair carries the hedge on a given day. It complements D-03's variance-ratio approach by working on positions rather than on realized P&L, so it fires **inside** a day rather than after the day closes, and it does not need a long history.

Together these move M7 from "detects persistence" to "detects entry", which was the honest gap in the plan as written.

## Fail-closed provisioning is design law

**No account trades until Merit has either an acknowledgement of the risk settings or a successful read-back verification of them.** Not a preference, not a default, not a configuration value: it is the design, and the absence of a confirmed setpoint is a hard block on trading rather than a marker on a dashboard.

This upgrades [M02](plans/M02-rithmic-bridge.md)'s AS-M2-03 counter from detection to prevention. Previously an account whose `set_risk` was never confirmed could trade while `platform.setpoint_unconfirmed` surfaced it as carried liability; now it cannot trade at all. The cost is honest and is accepted: a vendor-side confirmation gap becomes a provisioning outage for the affected accounts rather than a silent risk, and a provisioning outage is visible, bounded, and recoverable, while an unenforced funded account is none of those things.

**`V-M2-15` is added to the vendor-call agenda**, and it is a **requirement rather than a question**: Merit needs either a provisioning acknowledgement artifact or a readable current-risk-setting endpoint. Without one of the two, no account can be brought online under this rule, which makes it a commercial precondition of the relationship rather than a technical nicety. This is the strongest form of what OQ-M2-04 recommended raising on the call.

## Break-glass for the second `owner` credential

Ruled per [M06 OQ-M6-03](plans/M06-admin-ops-console.md)'s recommendation, in four parts, all of which must exist before launch:

1. **A sealed physical backup of the second key**, stored separately from both working keys.
2. **A documented unseal procedure**, written before it is needed rather than improvised during the incident it exists for.
3. **A quarterly existence check**, on the same ops calendar as the restore drill and the key rotation drill. The check verifies the seal is intact and the credential is still where the procedure says it is.
4. **A lost-key rotation runbook**, covering the case where a working key is lost and the sealed backup becomes the second credential.

All four land in [SECURITY section 8](architecture/SECURITY.md) alongside the honest statement of what dual control does and does not buy at launch scale. The reasoning behind the quarterly check is the one from the original recommendation and it is worth keeping in writing: **an untested break-glass is the same as none**, and the failure mode is discovering that during the incident.

## Ledger timing

Three recognition rules, settling [M05 OQ-M5-04](plans/M05-payout-system.md) and its neighbours:

| Event | Books at | Note |
|---|---|---|
| **Payout liability** | **approval** | The obligation exists the moment approval happens, because approval is irrevocable. Booking it later would mean the balance sheet disagrees with the promise |
| **Cash derecognition** | **settlement** | The cash leaves when it leaves. Under [ADR-019](#adr-019-merit-wallet-two-leg-payouts-with-the-cadence-anchor-on-wallet-credit--2026-08-14-status-accepted) this is the **external** leg: a wallet credit moves the liability's form, not the cash |
| **Evaluation fees** | **purchase** | Recognized at purchase rather than at pass or at first trade |

This resolves the LT-01 question M05 flagged and left to the founder. The firm's split (`firm_cents`) is recognized at approval, consistent with the liability booking at the same moment, so the two halves of LT-01 are recognized together and the revenue line does not depend on a rail's latency. The wallet makes this cleaner rather than harder: liability books at approval, changes form at wallet credit, and derecognizes as cash only when the external leg settles.

## Where conservatism lives (ruled 2026-08-14)

[ADR-019](#adr-019-merit-wallet-two-leg-payouts-with-the-cadence-anchor-on-wallet-credit--2026-08-14-status-accepted) returned the lineup to basis-day anchoring and, in doing so, removed a conservatism margin that [ADR-013](#adr-013-the-cadence-gap-anchors-on-the-settled-payouts-effective-day-rapid-daily-becomes-merit-rapid--2026-08-13-status-accepted) had created by accident: the model was basis anchored while the system was settlement anchored, so realized liability sat below the modeled figure for reasons nobody had chosen.

**That margin is relocated, not lost, and the relocation is the ruling.**

| | Role |
|---|---|
| **Calibration bands**, including CVaR99 and RE-S-01's | **Central estimates.** They describe the middle of the distribution and are not to be read as conservative |
| **Correlation assumption `rho = 0.30`** | Where correlation conservatism lives. Traders do not act independently, and the reserve is sized against a book that assumes they do not |
| **Regime-stress ruin scenarios** | Where tail conservatism lives. The model is run through adverse regimes rather than being asked to imply them |
| **Reserve Coverage Ratio breaker at 1.0** | Where operational conservatism lives. It is the control that stops sales, and it is the last line rather than the first |

**The sentence that must survive into every reserve conversation: CVaR99 evaluated at `rho = 0.30` is the reserve floor, never the estimate.** Sizing the payout wallet against a central estimate is sizing against a coin flip; sizing against the floor is the point of having one. The distinction is easy to lose because both numbers come out of the same harness and are quoted with the same name.

**Why this is better than the margin it replaces.** An accidental margin is not a control: nobody knows its size, nobody reviews it, and it disappears silently the moment an unrelated decision changes an assumption, which is exactly what happened here. Three named, sized, reviewable places beat one unmeasured cushion, and each of the three can be argued about on its own terms in the C8 retro.

Binding on [SIMULATION_HARNESS](testing/SIMULATION_HARNESS.md), [GLOSSARY](GLOSSARY.md#cvar99), [M05](plans/M05-payout-system.md), and [M06](plans/M06-admin-ops-console.md).

## Two gate findings confirmed as intended (2026-08-14)

Both were raised as needing founder eyes after the batch 1 fold, and both are closed.

**Core EOD and Direct compressing to a 5 trading day cycle is CONFIRMED as intended.** [ADR-019](#adr-019-merit-wallet-two-leg-payouts-with-the-cadence-anchor-on-wallet-credit--2026-08-14-status-accepted)'s wallet-instant credit is **lineup-wide by design**, not a Merit Rapid feature that happened to touch the other two plans. Their economics equal the original simulation calibration, which was basis anchored throughout, so the compression from 7 to 8 trading days down to 5, and the per-day rise from 16,875 to 19,286 cents up to 27,000, are what the model always described. The concern was that the anchor moved as a side effect of a ruling written about a different plan; it did not, and the item is cleared from [STATE](STATE.md).

**The lineup no longer landing on a single design ceiling is accepted.** The constitution's approximately $190 per day figure belonged to the settlement anchor and is superseded wherever it appears. The three plans now sit between 27,000 and 30,000 cents per trading day, and the `w=3` recalibration prices that level.

## The calibration source becomes version controlled

The founder will commit **`research/calibration/mc_lifecycle.py`** and the business-model workbook to the repository as the **version-controlled source of record** for every calibrated number in the corpus.

This closes a gap that has been load bearing since [ADR-015](#adr-015-plan-parameters-come-from-the-founders-lifecycle-simulation-funded-minimum-trading-days-is-zero--2026-08-13-status-accepted): plan parameters are sourced to `mc_lifecycle.py OUR_PLANS`, and until now that file lived outside the repository, so "the source of record" was a filename rather than an artifact anyone could diff. Once committed, a parameter change is a reviewable diff against a versioned model rather than an assertion.

The path is referenced from [ADR-015](#adr-015-plan-parameters-come-from-the-founders-lifecycle-simulation-funded-minimum-trading-days-is-zero--2026-08-13-status-accepted), [ADR-018](#adr-018-merit-rapid-requires-3-win-days--2026-08-14-status-accepted), and [SIMULATION_HARNESS](testing/SIMULATION_HARNESS.md), which Wave 4 writes against it.

**Status as of 2026-08-14: the files are not yet in the repository.** `research/calibration/` does not exist; the founder is uploading them. Every reference already points at that path, which is deliberate, because the path is the contract and the citations should not have to be rewritten when the artifact lands. Until then, Appendix A's parameters are sourced to the model **by citation rather than by diff**, and that is precisely the gap committing them closes. Tracked in [STATE](STATE.md).

---

# Parameter status: launch candidates versus structural rulings (founder ruling, 2026-08-14)

Recorded here as well as in [STATE](STATE.md) and [M01 Appendix A.0](plans/M01-rules-engine.md) because twelve module plans are about to cite it, and a ruling that binds a whole wave needs one stable anchor rather than a sentence people remember differently.

**Every plan parameter is a versioned-config launch candidate.** Prices, caps, win-day counts, consistency ratios, buffers, cadence gaps, splits, and ladder counts are **economically validated working values**, produced by the lifecycle simulation and intended for launch. They are **formally confirmed by the founder at the FREEZE gate** and are **tunable up to launch without an engine change**, because each is a row in `plan_version_sizes` rather than a constant in code.

**Structural rulings are fixed absent a new ADR**: that universal per-payout caps exist, that the payout ladder exists and bounds lifetime extraction, [EOD semantics](GLOSSARY.md#t1) as the authoritative tier, zero denial, [ADR-014](#adr-014-the-floor-never-resets-on-settlement-the-lock-is-a-permanent-stop--2026-08-13-status-accepted)'s permanent floor lock, and [ADR-019](#adr-019-merit-wallet-two-leg-payouts-with-the-cadence-anchor-on-wallet-credit--2026-08-14-status-accepted)'s cadence anchor.

**The two binding consequences for every public surface**, which is why this ruling reaches past M01:

1. **A parameter is read, never copied.** Any surface that shows a number must read it at request time from the account's pinned plan version or from the published plan version, never from a literal in a template, a chart axis, a price card, or a piece of blog copy. Binding on [M09](plans/M09-marketing-site.md), [M11](plans/M11-certificates-social-proof.md), [M12](plans/M12-transparency-platform.md), [M13](plans/M13-trader-analytics-journal.md), [M17](plans/M17-offers-engine.md), and [M18](plans/M18-graduation-track.md).
2. **A structural ruling is never marketed as a tunable.** "Caps exist" is not a promotion and may not be offered, waived, or framed as a limited-time condition. The cap's *value* is a config; the cap's *existence* is not. Binding on [M17](plans/M17-offers-engine.md) alongside [ADR-019a](#adr-019a-the-gamification-bright-line).

---

# Consolidated founder addendum and batch 2 gate closure (2026-08-14)

The founder returned a consolidated addendum covering the M19 placement question, an elevation of Merit's identity defenses, the legal disclosure skeletons, four primary-source intelligence folds, a checkout enrichment vendor, the verification UX, and rulings on the five open batch 2 questions. Three became ADRs because they choose between alternatives or amend an approved decision. The rest are recorded in the closure table below.

## ADR-021: KYC placement is a composite trigger set, not a single point  (2026-08-14, status: accepted)

- **Context:** Constitution section 10 frames placement as a choice among three points, and [M19](plans/M19-kyc-identity.md) implemented all three as `kyc.placement` config. [AS-M19-01](plans/M19-kyc-identity.md) then found the tradeoff omits its most important term: placement decides **how much of the buyer population enters the biometric dedupe corpus**, and that corpus is what the constitution itself calls the fleet-killer. At `pre_funded`, roughly **85 percent of buyers never enter it**. OQ-M19-01 asked whether that finding changes the recommendation.
- **Decision:** **Placement becomes a set of trigger events rather than a single point.** Verification fires at whichever of the configured triggers is reached **first**:

  | Trigger | Fires when | Note |
  |---|---|---|
  | `first_purchase` | Any first purchase | The `pre_eval` behavior, now one option among several rather than the only early one |
  | `second_distinct_account_purchase` | A purchase creating a second concurrent account | **The fleet-operator trigger.** See below |
  | `second_purchase_any` | Any second purchase, **including resets** | Cheaper coverage, but see the reset caveat |
  | `eval_pass` / `pre_funded` | Evaluation passed, before the funded account exists | The constitution's "likely sweet spot" |
  | `payout_request` | A payout is requested | **Invalid as a sole trigger.** Retained only as a backstop that fires when an earlier trigger somehow did not, because verification first demanded at payout time is the [zero-denial policy](GLOSSARY.md) meeting a wall, and it is the industry's worst-reviewed practice |

  **Direct and any instant-funded plan always verify at purchase**, unchanged and not configurable, because funding is immediate and no later moment exists.
- **The composite is what resolves OQ-M19-01, and the reason is the finding itself.** `pre_funded` alone leaves the fleet operator outside the corpus precisely because fleet operators mostly do not pass evaluations; they buy many accounts and farm the ones that run. **A serial buyer of distinct concurrent accounts is the exact population `pre_funded` misses, and `second_distinct_account_purchase` captures their faces early**, at a cost paid only by people who have already bought twice. That converts AS-M19-01 from an argument for lineup-wide `pre_eval` friction into a targeted trigger, which is a better answer than either of the two the constitution offered.
- **Founder's live comparison, recorded because the choice is not yet final:** `{pre_funded always}` versus `{second_distinct_account + pre_funded}`. **The final trigger set is decided at FREEZE**, on beta funnel data rather than in advance. Both options are the same code; the difference is a config array.
- **Conditions of acceptance:**
  1. **Implemented as configuration**, a set rather than an enum, with **per-trigger funnel telemetry** (M19g, SD-M19-03's `kyc_funnel_events` already carries `placement`; it widens to carry the trigger that fired).
  2. **Corpus-coverage telemetry is adopted** as proposed in OQ-M19-01: the share of the buyer population inside the dedupe corpus is a reported number with a configured floor, not an inference.
  3. **Per-plan escalation is pre-agreed**, not lineup-wide: the beta escalates specific plan and size combinations that show fleet behavior, and the escalation path is agreed before the data arrives so it is not negotiated under pressure.
  4. **Resets inflate `second_purchase_any` and this is written into the config's own documentation.** A trader who resets once is a second purchaser under that trigger without being a second-account holder, which is a different population entirely. Choosing `second_purchase_any` buys coverage and buys friction on Merit's most loyal repeat customers at the same time.
  5. **Precedent recorded:** Topstep verifies before the second purchase, so the composite sits inside published industry practice rather than ahead of it.
- **The provider is still undecided, and one thing must be true regardless.** The **provider adapter is vendor-agnostic** ([M19](plans/M19-kyc-identity.md) section 1.1), and the selected provider is **named in the privacy policy at selection time**, which makes provider choice a disclosure event and not only a procurement one.
- **Alternatives considered:** `pre_funded` alone (the constitution's sweet spot; rejected because AS-M19-01 shows it leaves the fleet-killer's corpus 15 percent full); lineup-wide `pre_eval` (maximum coverage, and it puts a $2 identity check in front of a $79 impulse purchase that no major competitor gates); payout-only (rejected by the constitution and again here).

## ADR-022: Identity defense is elevated to a scored graph, in three priced tiers  (2026-08-14, status: accepted)

- **Context:** Merit's identity defenses were specified as independent detectors ([M07](plans/M07-risk-abuse.md) D-01 to D-14) plus biometric dedupe ([M19](plans/M19-kyc-identity.md)). The dossier's schemes 1, 3, 4 and 6 are all **identity-multiplication** attacks, and the workbook's risk engine makes the same point from the liability side: **the payout tail is all correlation**, and correlation is what linked accounts produce. Treating each signal as its own detector means the system never asks the one question that matters, which is how confident Merit is that two accounts are one person.
- **Decision:** Adopt **link-confidence scoring across all signals**, with enforcement graded by confidence rather than by which detector fired.

  | Link class | Examples | Behavior |
  |---|---|---|
  | **Hard** | Biometric dedupe hit, same payout destination, same payment fingerprint, confirmed same-person disposition | **Auto-enforce.** These are facts, not inferences |
  | **Soft** | Shared device or IP, behavioral similarity, timing correlation, shared address components | **Queue a pre-funding review.** Never auto-enforce, and the review happens **before funding** rather than before payout, which is the moment where being wrong is cheap |

  The **signal-weight table is configuration**, not code, so weights are tuned on beta data through a reviewed diff.
- **The other three components:**
  - **Behavioral fingerprinting against the banned corpus at funding.** A returning banned operator is recognizable by how they trade, not only by who they are. **Flag-and-review only, never auto-enforce**, and the output must be **evidence-grade**: a flag that cannot be explained in an evidence pack is a flag that cannot survive a dispute.
  - **Honest-baseline anomaly scoring.** Anomaly is measured against the *honest* population's distribution rather than against the whole population, because a population that contains the fleet normalizes the fleet. This is the same reasoning as the [consistency denominator rule](GLOSSARY.md#consistency-denominator-rule) applied to detection.
  - **Identity-replacement-cost framing enters the [dossier](../research/ADVERSARY_DOSSIER.md).** The correct measure of an identity defense is not how many fakes it catches; it is **what a fresh usable identity costs the adversary**. Every control is scored on how much it raises that price, which makes biometric dedupe (expensive to defeat) and email-domain heuristics (free to defeat) comparable on one axis for the first time.
  - **[M06](plans/M06-admin-ops-console.md) gains an identity-graph explorer** with **weighted edges** and **one-click evidence packs** from any node or cluster. An operator who cannot see the graph will reason about the graph anyway, from a list of flags, badly.
- **Thresholds, weights, and detector internals are internal-tier always**, per the two-tier evidence pack ruling. This is not a new rule; it is that ruling applied to a much richer object, and the richer the object the more a leak is worth.
- **Priority, which is the part that makes this shippable:**

  | Tier | Contents | When |
  |---|---|---|
  | **v1** | Hard links plus KYC dedupe | Launch. These are facts and they auto-enforce |
  | **v1.x** | Probabilistic scoring, the signal-weight table, the M06 graph explorer | After beta produces the data the weights need |
  | **post-launch** | Behavioral fingerprinting against the banned corpus | Requires a banned corpus, which requires having banned people |

  **The ordering is forced by data availability rather than by ambition.** Weights tuned on no data are guesses wearing a number, and a fingerprint corpus with three members is a false-positive engine.
- **Golden scenarios are required for each tier**, so that a defense promoted from one tier to the next arrives with the fixture that proves it does what the tier above assumed.
- **Alternatives considered:** keep independent detectors and let the queue correlate them (status quo; rejected because the correlation happens in an operator's head and is therefore unreviewable and unreproducible); auto-enforce on soft links to cut review load (rejected outright: [AS-M19-05](plans/M19-kyc-identity.md) already establishes that the fleet-killer is also a false-accusation engine, and soft links are exactly where the false accusations live); build all three tiers for v1 (rejected: two of the three need data that does not exist yet).

## ADR-023: A digital-footprint enrichment vendor at checkout, bought and not built  (2026-08-14, status: accepted)

- **Context:** [M03](plans/M03-billing-checkout.md) collects payment signals and [M07](plans/M07-risk-abuse.md) resolves identities from them, but Merit sees only what its own funnel produces. A fresh identity with a clean card looks identical to a real customer at checkout, and the cheapest moment to learn otherwise is before the purchase completes.
- **Decision:** Adopt a **SEON-class enrichment vendor at checkout**, supplying **email and phone digital-footprint** (how old and how connected the identity's public presence is), **device, IP, VPN and datacenter detection**, and **BIN intelligence**. It is a **v1 signal feeding the identity graph** through the [M07](plans/M07-risk-abuse.md) adapter, which is **vendor-agnostic** for the same reason the platform adapter is.
- **Rollout is graduated, and the sequence is the control:**
  1. **Observe mode from launch.** Signals recorded, scored, and reported; **nothing is blocked**. The purpose is to learn the distribution on Merit's own traffic.
  2. **Thresholds tuned on beta data**, never on the vendor's defaults, because the vendor's defaults describe a different population.
  3. **Graduated enforcement:** a **soft decline plus a review queue**, and **never a silent decline**. A customer who is refused is told, and a human can reverse it.
- **Buy, not build**, and the reason is categorical. This is a **data-network product**: its value comes from having seen an email address across millions of merchants, which Merit structurally cannot replicate at any engineering budget. Building it would produce a worse version of a commodity while consuming the schedule of the modules that are actually differentiated.
- **Consequences:** a cost line enters the [Cost Stack](../research/calibration/README.md), a new sub-processor enters the privacy policy's disclosed sharing categories, and [M03](plans/M03-billing-checkout.md) gains a checkout dependency whose **failure must be non-blocking** in observe mode and **fail-open on timeout** in enforcement mode, because a checkout that cannot complete because an enrichment call timed out converts a fraud control into an outage.
- **Alternatives considered:** build in-house from Merit's own signals (rejected above); no enrichment (rejected: it leaves the cheapest detection moment unused, and the dossier's payment-side schemes are exactly what this class of product is built for); hard-decline on a bad score from day one (rejected: enforcing on an untuned threshold against an unmeasured population is how a firm declines its own customers on launch week).

## Batch 2 gate closure table (2026-08-14)

The five open batch 2 questions, plus the two verification items. Each confirms or directs rather than choosing between architectures, so they are recorded here rather than as ADRs.

| Ruling | Where it was asked | Outcome |
|---|---|---|
| **OQ-M18-01: which graduation path, and does a live program exist?** | [M18](plans/M18-graduation-track.md) | **No live program exists at launch.** The ladder ends in **graduation eligibility plus continuation**, which is GP-M18-03, the path that requires nothing and is honest. **Zero live-program copy is written until counsel rules**, and that includes the marketing site, the portal, certificates, and Discord. The working structure, if one is ever built, is a **ring-fenced affiliated entity** on the MFFU pattern. **The module is renamed to match shipped behavior** rather than describing an aspiration. **Counsel packet item 1** |
| **OQ-M20-03: is the wallet a payable or a regulated stored-value product?** | [M20](plans/M20-wallet.md) | **Proceed on the payable-balance framing**, with a named invariant so the framing cannot erode by accident: **`INV-WALLET-NO-DEPOSITS`. Wallet funds originate only from payouts, promotional credit, and refunds. No external loading, ever, without a new ADR and counsel sign-off.** The closed credit list is confirmed to **exclude deposits explicitly** rather than merely omitting them, because an omission is a gap someone fills and an exclusion is a decision someone must reverse. **Counsel packet item 2** |
| **OQ-M19-01: does the corpus-coverage finding change placement?** | [M19](plans/M19-kyc-identity.md) | **Resolved by [ADR-021](#adr-021-kyc-placement-is-a-composite-trigger-set-not-a-single-point--2026-08-14-status-accepted).** The finding does change it, and the answer is a composite trigger set rather than a different single point. The corpus-coverage telemetry and the pre-agreed per-plan escalation are both adopted as proposed |
| **OQ-M12-01: the seven public statistic definitions** | [M12](plans/M12-transparency-platform.md) | **Draft them as a founder sign-off table for the Wave 4 gate.** Each statistic gets **both a trailing-window and a lifetime form**, **denominators always stated** on the surface itself and never only in a methodology page, and a **future-dated `effective_from`** per M12's existing design so a definition change is announced before it takes effect rather than discovered after. The unflattering readings M12 proposed stand as the drafting basis |
| **OQ-M20-04: dormancy and escheatment** | [M20](plans/M20-wallet.md) | **Dormancy tracking and 12-month notices are designed now**, in v1, because retrofitting a notice schedule onto balances that have already gone quiet means reconstructing when they went quiet. **Escheatment state-mapping is counsel packet item 3**: trigger dates vary by jurisdiction, and the mapping belongs on a calendar rather than in anyone's memory |
| **The docs link-check joins the CI gate inventory** | [SESSION_LOG](SESSION_LOG.md) landmine | **Accepted.** A corpus whose cross-references are its navigation needs the check that proves they resolve. The 59-link fix is verified in this session's closing check, and the gate is added to the inventory so the next 59 are caught by a robot |
| **Calibration source** | [STATE](STATE.md) | **Workbook committed, engine still outstanding.** `research/calibration/futures_prop_firm_model.xlsx` is in the repository with a provenance [README](../research/calibration/README.md). `mc_lifecycle.py` is not: the accompanying upload was an unrelated database dump. The STATE item **narrows rather than clears** |

## The counsel packet

Three items now have a named home rather than being scattered across module plans, because they are the questions engineering cannot answer and they all need the same lawyer at the same time.

| # | Question | Blocking what |
|---|---|---|
| 1 | The live-program structure: does a ring-fenced affiliated entity on the MFFU pattern change Merit's regulatory character, and what may be said about graduation before one exists? | All live-program copy. Nothing in code |
| 2 | Is the wallet a payable rather than a regulated stored-value product, given `INV-WALLET-NO-DEPOSITS`, no interest, no transfer, no deposit, payable on demand? | Launch, and the answer may add conditions rather than a prohibition, which is why it is cheap now |
| 3 | Escheatment mapping per jurisdiction, and the BIPA plus GDPR lawful-basis mapping for the biometric and monitoring disclosures | The privacy policy leaving draft, and the dormancy calendar |


## ADR-024: The ladder and the live invitation are two separate mechanisms  (2026-08-14, status: accepted)

- **Context:** The corpus conflated two things the market treats separately. [M01](plans/M01-rules-engine.md) R-49 graduates an account when it completes its payout ladder **and emits a live invitation in the same step**, which reads as a promise: complete the ladder, receive live capital. [M18 AS-M18-01](plans/M18-graduation-track.md) already found that promise to be a regulatory and commercial exposure, and [OQ-M18-01](#) ruled that **no live program exists at launch**. That left an engine still emitting an invitation event for a program that does not exist. Separately, the ladder counts were 8 on Core EOD and Merit Rapid and 6 on Direct, which is longer than industry practice.
- **Decision, in two parts, and the separation is the point.**

  **(1) `max_payouts` launch candidate is 5 on all plans.** Configured per `plan_version` like every other parameter ([the parameter-status ruling](#parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14)), so it is tunable to launch without an engine change. **Direct was set to 4 at the FREEZE gate** (see the gate closure below). Industry consensus is the anchor: **Lucid and Tradeify both run 5.**

  **(2) The live invitation is fully discretionary and decoupled from the ladder.** Completing the ladder sets **graduation eligibility**, which is a **review-pool flag and nothing more**. Invitation is at **Merit's sole discretion** from that pool. The two are no longer one event.
- **The framing to publish, adopted verbatim from Lucid because it is exactly right:** the ladder is **"the maximum payout level, not a guaranteed minimum for live eligibility."** One sentence that prevents the entire misreading, and it goes in the ToS and in marketing.
- **Why decoupling is worth doing even though no live program exists.** An engine that emits an invitation on ladder completion is an engine that has **already made the promise**, and the promise is the thing that commits Merit rather than the program. **Topstep's live selectivity is 0.71 percent.** A firm whose funded traders complete a ladder at a far higher rate than that cannot be operating "complete the ladder, get live capital" as a rule, and neither can Merit. Decoupling now means the discretion is designed in rather than retrofitted onto a population that already believes otherwise.
- **Liability is monotone-decreasing in `max_payouts`, so every calibrated margin holds or improves.** Shortening a ladder can only reduce the lifetime bound INV-17 asserts; it cannot raise it. The `w=3` recalibration and the workbook's risk engine were both computed at the longer ladder, so **the recorded margins are now conservative rather than exact**. Flagged for **recalibration to exact figures once `research/calibration/mc_lifecycle.py` lands**; the direction of the error is known and it is the safe one.
- **Lifetime ceilings, recomputed and now publishable** (50K, at the 9000bp split):

  | Plan | Cap | Per payout to trader | Ladder | **Lifetime to trader** | Trading days at the cycle |
  |---|---|---|---|---|---|
  | Core EOD | 150,000c | 135,000c | 5 | **675,000c ($6,750)** | 25 |
  | Merit Rapid | 100,000c | 90,000c | 5 | **450,000c ($4,500)** | 15 |
  | Direct | 150,000c | 135,000c | 5 | **675,000c ($6,750)** | 25 |

- **Plan-page disclosure changes accordingly**, and the sentence is specified rather than left to a copywriter: **"each account pays up to 5 payouts, then completes. Open another anytime."** The second clause is load bearing. [EC-122](EDGE_CASES.md#ec-122-the-payout-ladder-is-only-a-ladder-while-the-trader-is-winning--2026-08-14-module-m18-status-specced) established that the ladder's danger is a trader discovering finiteness at the end; a shorter ladder makes that discovery arrive sooner, so the continuation path has to be in the same sentence as the limit. **(Citation corrected 2026-08-14: this ADR originally cited EC-137, which is a Merit Wallet entry. The ladder-finiteness entry is EC-122. See [ADR-025](#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted)'s numbering note.)**
- **Cross-account combination counting is noted as a config option, defaulting to per-account.** Tradeify counts the ladder across an entity's accounts rather than per account. Merit's default stays **per-account**, with the alternative recorded as a config that exists rather than a change that would need one.
- **Caps confirm percent-of-size scaling across 25K, 50K, 100K and 150K**, with **per-size overrides remaining available config**. The bp figure is the source and the cents are derived, which is what makes a new size a row rather than a redesign.
- **Consequences:**
  - **R-49 splits.** Ladder completion sets `graduated` and the **graduation-eligible** flag. It no longer emits an invitation. The invitation becomes an operator action from the review pool.
  - **[M18](plans/M18-graduation-track.md) specs the review-pool surface**: an admin queue over graduation-eligible accounts with full history and evidence attached, so a discretionary decision is made against the record rather than against a name. **M18 still ships zero live copy pending counsel**, per the prior ruling. The surface is internal; the silence is external.
  - INV-17's bound tightens on every plan. CV-14 (`ladder >= 1`) is unchanged and still correct.
  - **The competitive map** (Lucid, Tradeify, Topstep, TopOne, Phidias) is recorded in [TOP10_FIRMS](../research/TOP10_FIRMS.md) and in M18's context section, because "industry consensus is 5" is a claim that should be checkable rather than remembered.
- **Alternatives considered:** keep the 8 and 6 ladders (rejected: longer than every comparable firm, and a longer ladder is a larger lifetime liability for no competitive gain); keep the invitation coupled to ladder completion but add discretionary language (rejected: the event is the promise, and disclaiming an event the system reliably emits is the weakest possible position); a guaranteed live path (rejected by [OQ-M18-01](#) and by Topstep's 0.71 percent, which shows what selectivity actually looks like in practice).

## ADR-025: Progressive cap release is rejected for v1 and replaced with cross-account loyalty  (2026-08-14, status: accepted)

- **Context:** [M14](plans/M14-loyalty-retention.md) LM-M14-01 carried progressive cap release as its flagship mechanic, copied from the market shape "after five payouts, your cap goes up". [AS-M14-01](plans/M14-loyalty-retention.md) priced it and OQ-M14-01 recommended holding it back rather than dropping it. [ADR-024](#adr-024-the-ladder-and-the-live-invitation-are-two-separate-mechanisms--2026-08-14-status-accepted) then shortened the ladder from 8 to 5, which changed the arithmetic underneath the recommendation and, on inspection, removed the version of the mechanic that was worth having.
- **Decision, two parts.**

  **(1) Progressive cap release does not ship in v1, and it is rejected rather than deferred.** `payout_cap_schedule` stays an array and the publish path keeps validating every step, because that shape costs nothing and [DATA_MODEL section 12](architecture/DATA_MODEL.md) reserved it for exactly this. What is rejected is publishing a second step. Recording this as a rejection rather than a deferral is deliberate: a deferred mechanic returns as a roadmap item and gets re-proposed as a new idea by whoever did not read the arithmetic, while a rejected one returns as an ADR that has to argue against a number.

  **(2) The retention purpose is served by cross-account loyalty instead.** Completing the Nth **ladder** across an identity's accounts earns **account-spanning perks**: reset discounts, bonus credit, and review-pool priority. **No per-account bound ever moves.**
- **The economics, and this is the whole ruling.** At Core EOD 50K, cap 150,000c, ladder 5, split 9000bp, lifetime extraction is bounded at **750,000c gross and 675,000c to the trader** ([ADR-024](#adr-024-the-ladder-and-the-live-invitation-are-two-separate-mechanisms--2026-08-14-status-accepted), INV-17). Every way of keying a cap release against that ladder is expensive:

  | Release keyed at | Rungs at 150,000c | Rungs at 300,000c | Lifetime gross | **Change to the bound** | Goodwill bought |
  |---|---|---|---|---|---|
  | Nothing (v1) | 5 | 0 | 750,000c | baseline | none |
  | Ordinal 6 and later, the market's own shape | n/a | n/a | 750,000c | **structurally impossible** | none |
  | Ordinal 5 only | 4 | 1 | 900,000c | **+20 percent** | one raised payout, at the very end of the account's life |
  | Ordinal 4 and later | 3 | 2 | 1,050,000c | **+40 percent** | two raised payouts |

  **On a 5-rung ladder there is no "after five payouts": five payouts is the whole ladder.** The mechanic therefore cannot be copied from the market at all, and every implementable version re-keys it earlier, which is precisely what makes it more expensive, because the raised cap then applies to a larger share of the rungs that remain. **A shorter ladder did not make progressive cap release safer. It made the cheap version impossible and left only the expensive ones.**
- **And the cohort is the wrong one, which is what turns an expensive mechanic into a bad one.** [ADR-018](#adr-018-merit-rapid-requires-3-win-days--2026-08-14-status-accepted) names the 5-payout ladder as the second of three defenses of Merit Rapid's headline per-day rate. A cap release attacks that defense directly. The population reaching a late ordinal is not a random sample of good traders: it is enriched for hedged pairs and rings, for whom repeated extraction is the designed outcome rather than a skill result. [M07](plans/M07-risk-abuse.md)'s detectors are good and imperfect, and a cap release is a policy that pays the residual undetected fraction more, at the exact ordinal where they have most demonstrated they can reach it.
- **The replacement, specified so it is a decision rather than a direction.**

  | Property | Cross-account loyalty |
  |---|---|
  | **Trigger** | The **Nth completed ladder** across an identity's accounts. A completed ladder is 5 settled payouts and a `graduated` account, so the trigger is an existing fact rather than a new counter |
  | **Grain** | **Identity**, which is the grain the account cap and the entity limits already use. This is the first loyalty mechanic in the corpus whose grain matches its own economics |
  | **Perks** | **Reset discounts** (priced and issued by [M17](plans/M17-offers-engine.md)), **bonus credit** (see the credit-class note below), **review-pool priority** ([M18](plans/M18-graduation-track.md)'s graduation-eligible queue is ordered rather than gated by it) |
  | **What never moves** | `payout_cap_cents`, `max_payouts`, `profit_split_bp`, `cadence_gap_trading_days`, `win_days.required_count`, and every other value the engine reads. **INV-17's per-account bound is untouched on every plan, at every size, forever** |
  | **Cost shape** | A **marketing line item denominated in cents**, budgeted and capped, rather than a multiplier on the lifetime liability bound. This is the substantive difference: the rejected mechanic's cost scales with how successful the cohort is, and the replacement's does not |

- **Why this is a better product and not only a cheaper one.** The rejected mechanic rewards extracting harder from one account. The replacement rewards **coming back**, which is the behavior a firm with a finite ladder actually needs, and it is the behavior [ADR-024](#adr-024-the-ladder-and-the-live-invitation-are-two-separate-mechanisms--2026-08-14-status-accepted)'s own disclosure sentence already asks for ("Open another anytime"). The loyalty program and the ladder disclosure now point the same direction, where before the disclosure said the account ends and the loyalty program said it gets better.
- **The credit-class note, flagged rather than assumed, because it crosses four invariants.** The ruling names the perk "bonus wallet credit". Implemented literally, a loyalty credit landing in the **withdrawable** `trader_wallet` position would breach [M14](plans/M14-loyalty-retention.md) INV-M14-10 (loyalty credit is `promotional_credit`, never `trader_wallet`), [M20](plans/M20-wallet.md) INV-M20-03 (promotional credit can never become wallet balance), INV-M20-11 and `INV-WALLET-NO-DEPOSITS` (the closed `provenance` list is `payout`, `refund_wallet_funded`, `correction`), and [M17](plans/M17-offers-engine.md) INV-M17-08. It would also hand an attacker a laundering path that does not require passing an evaluation, which is the one thing [AS-M20-01](plans/M20-wallet.md)'s counter currently relies on.

  **Adopted reading: the perk is issued as `promotional_credit`**, spendable on any Merit product, **rendered inside the wallet screen** next to the withdrawable position and labeled as the separate thing it is, and **never withdrawable**. The trader experience the ruling describes is delivered; the ledger separation is not. **This is the one place in this fold where the literal words of the ruling were not implemented, and it is raised as [OQ-FREEZE-01](STATE.md) for the founder to confirm or overrule at the FREEZE gate.** Overruling it is a money-path change to a closed check constraint and would need its own ADR, its own session under [ADR-003](#adr-003-session-length-policy-on-money-vs-non-money-paths--2026-08-13-status-accepted)'s strict regime, and a re-run of AS-M20-01's economics.
- **Alternatives considered:** ship the ordinal-5 release (rejected above: +20 percent on the bound to deliver one raised payout at the end of an account's life, which is the worst goodwill-per-cent-of-liability trade available); ship it only on Direct, whose ladder may be 4 (rejected: it is the plan with instant funding and the least trading history behind each payout, so it is the worst plan to widen); keep it as a deferred roadmap item (rejected as described above); per-trader cap grants outside the plan-version path (rejected outright and permanently by [M14](plans/M14-loyalty-retention.md) INV-M14-01 and [ADR-010](#adr-010-dual-control-on-cap-split-gap-and-treasury-credentials-with-both-keys-founder-held-at-launch), and it is what AS-M14-06 exists to make impossible).
- **Consequences:**
  - [M14](plans/M14-loyalty-retention.md) LM-M14-01 becomes **rejected**; LM-M14-05 (cross-account loyalty) is added; INV-M14-11 and INV-M14-12 are added; OQ-M14-01 is **closed**; AS-M14-01 is rewritten to record the rejection and its arithmetic, and AS-M14-08 is added for the mechanic that replaced it.
  - [EC-104](EDGE_CASES.md) is amended to record the rejection. **EC-139** and **EC-140** are new. **GS-179** is rewritten and **GS-243** to **GS-245** are added.
  - The ladder-finiteness disclosure ruling is **confirmed unchanged**: the countdown tracker counts down from the final ordinal, and the continuation clause sits in the same sentence as the limit. [EC-122](EDGE_CASES.md#ec-122-the-payout-ladder-is-only-a-ladder-while-the-trader-is-winning--2026-08-14-module-m18-status-specced), [M18](plans/M18-graduation-track.md) INV-M18-02, GS-206.
  - **A numbering note, because the ruling as delivered cited two edge cases by the wrong number.** The ruling folds into **EC-104** (progressive cap release, M14) and **EC-122** (ladder finiteness, M18). It cited EC-136 and EC-137, which are Merit Wallet entries ("the wallet compresses the attacker's cycle as much as the trader's" and "checkout is a transfer endpoint nobody labelled as one") and are untouched by it. The mis-citation is inherited from [ADR-024](#adr-024-the-ladder-and-the-live-invitation-are-two-separate-mechanisms--2026-08-14-status-accepted), which cited EC-137 for the finiteness finding; that citation is corrected in place above. Recorded here rather than fixed silently, because a corpus whose cross-references are its navigation cannot afford a quiet renumbering, and the **docs link-check** joining the CI inventory at this gate exists to catch the next one.
- **Founder ruling (2026-08-14): ADOPTED.**

---

# FREEZE gate closure (2026-08-14)

The founder ruled every open item and granted the sign-offs. **The corpus is FROZEN.** This section records the gate; each ruling is folded into the documents it touches.

## OQ-FREEZE-01: the loyalty perk's credit class

**The implementation is CONFIRMED and [ADR-025](#)'s literal wording is OVERRULED.** The cross-account loyalty perk is `promotional_credit`, rendered inside the wallet screen and **never withdrawable**. The ADR's phrase "bonus wallet credit", read literally, would have breached INV-M14-10, [M20](plans/M20-wallet.md) INV-M20-03 and INV-M20-11, `INV-WALLET-NO-DEPOSITS`, and [M17](plans/M17-offers-engine.md) INV-M17-08, and would have handed an attacker a laundering path that does not require passing an evaluation.

**Recorded because it is the most useful thing that happened at this gate: the invariant guard caught a founder-guide wording error, and the author raised it rather than implementing it.** That is the review system working as designed. The corpus's standing rule is that a session asks when the constitution is ambiguous and proposes an ADR when it is silent. This was a third case, **an instruction that was clear and wrong**, and the correct response was to implement the intent, flag the conflict, and put it in front of the founder as a named question rather than either obeying the words or quietly substituting a judgment. **A closed check constraint is a good place to discover a wording error, because it is the one kind of specification that cannot be talked past.**

## OQ-FREEZE-02: the branch-workflow conflict, amending ADR-D1

**[ADR-D1](#) is amended. Corpus single-trunk is achieved via immediate pull-request merge rather than by direct commit alone.**

| Session origin | Workflow |
|---|---|
| **Harness-launched** (web, mobile, or any designated-branch instruction) | Runs its designated branch. **Must end mergeable.** The founder merges **same day** |
| **Local** | Commits **direct to `main`**, unchanged |

**Why this rather than picking a side.** The single-trunk rule exists because a commit living in one container is a commit about to be lost, and a long-lived branch is a merge conflict with a delay fuse. **A branch merged the same day is neither of those things.** The harness's branch default is not going to stop asserting itself, so a rule forbidding it would be broken on every web-launched session and would then be ignored, which is worse than a rule that accommodates it and keeps the merge window short. **PR #2 is merged.**

## Sign-offs granted

| Item | Ruling |
|---|---|
| **Wave 3 batch 2** (M09 to M20) | **APPROVED** |
| **Wave 4** (18 new documents, 5 placeholders retired, 3 rewrites) | **APPROVED** |
| **Plan parameters** | **CONFIRMED as launch candidates**, re-confirmed at launch as config per the standing [parameter-status ruling](#) |
| **Direct's ladder** | **4** |
| **KYC trigger set** | **`{second_distinct_account + pre_funded}`, earliest fires** |
| **M12 sign-off table** | **APPROVED, including S-16** |

### Direct's ladder is 4

**The rationale is a risk argument, not an economic one.** Direct skips the evaluation entirely, so **its funded population carries the unselected base rate of skill**. Every other plan's funded book has passed a filter; Direct's has passed nothing. The [calibration source](../research/calibration/README.md)'s own selection math makes this decisive: an evaluation is a weak classifier, but a weak classifier is not a useless one, and removing it leaves a population at the base rate, where durable edge is 1 to 3 percent and the **per-account tail is heaviest**. **The shortest ladder belongs on the least-filtered plan.**

**Lifetime to trader at 50K: 4 x 135,000c = 540,000c ($5,400).** Margin intact, confirmed exactly in the recalibration below.

### The KYC trigger set is `{second_distinct_account + pre_funded}`

**The fleet-coverage argument prevails.** [ADR-021](#) framed the choice as `{pre_funded always}` versus this one, and AS-M19-01's finding decides it: `pre_funded` alone leaves roughly 85 percent of buyers outside the biometric dedupe corpus, and fleet operators are disproportionately inside that 85 percent because they are serial buyers who mostly do not pass evaluations. **`second_distinct_account_purchase` captures their faces early, at a cost paid only by people who have already bought twice.**

**Telemetry adjudicates post-beta.** The per-trigger funnel instrumentation and the corpus-coverage floor exist so this is revisited against data rather than re-argued. The trigger set is a config array and changing it is not an engine change.

### M12's sign-off table is approved, including S-16

**S-16 commits Merit to publishing whatever the first published number says.** No soft launch, no holding the page until the figures flatter, no "we will publish once the sample is meaningful" that quietly becomes never.

**The rationale, recorded because it will be tempting to revisit on a bad month: a stats page with an escape hatch is marketing, and Merit built the version without one.** The entire value of a transparency surface is that it was committed to before anyone knew what it would say. A page that publishes only favorable numbers is not a transparency page having a bad quarter; it is an advertisement that was always going to be one, and every reader who matters can tell the difference.

## The calibration engine landed, and the corpus is recalibrated against it

`research/calibration/mc_lifecycle.py` (546 lines) is committed. **Every "at least" and "conservative rather than exact" annotation in the corpus is now replaced with a measured value.** The engine was run at the corpus's actual configuration; the runs and the checklist are recorded in [SIMULATION_HARNESS section 8](testing/SIMULATION_HARNESS.md).

### The reproduction check passed

Running the engine **as committed**, against its own `OUR_PLANS`, reproduces the workbook's plans tab: **$690.44 firm dollars per funded account on Core EOD** against the workbook's $698, **$829.36 on Rapid** against $800, **$207.33 on Direct** against $206. The **portfolio risk engine reproduces the [calibration README](../research/calibration/README.md)'s table exactly**, to the cent: CVaR99 at rho = 0.30 is **$132,896.71**, the multiple is **2.9285x**, and every one of the twenty ruin cells matches. **Reproducing a superseded result from superseded inputs was the cheapest available proof that the port is faithful, and it was available exactly once.** It is now spent, and it passed.

### Exact recalibrated figures, at the corpus configuration

`w=3` on Merit Rapid, funded `min_trading_days = 0` on all three plans, ladder **5 / 5 / 4**:

| Plan | Eval pass | Funded to payout | **Firm $ per funded (50K)** | Payouts per payer | Contribution margin |
|---|---|---|---|---|---|
| Core EOD | 26.53% | 33.46% | **$690.44** | 1.54 | **+0.25%** |
| **Merit Rapid** | 16.55% | **48.11%** | **$904.07** | **2.13** | **16.9%** |
| Direct | 100% | 12.07% | **$207.33** | 1.30 | **39.2%** |

**[ADR-018](#) recorded $889, 48.1 percent, 2.09 payouts per payer, and roughly 18 percent margin.** The exact figures are **$904.07, 48.11 percent, 2.13, and 16.9 percent**. The funnel figure matches to two decimal places; firm cost is 1.7 percent higher and margin 1.1 points lower than the round numbers carried since. **The direction is mildly unfavorable and the magnitude is immaterial**, which is the outcome a decision made on round numbers is entitled to hope for and not entitled to assume. Merit Rapid remains the lineup's margin engine at 16.9 percent.

### The finding this run produced, which is not what anyone expected

**Shortening the ladder changed the modeled firm cost by exactly nothing on Core EOD and Direct.** The two configurations, ladder 8 and 6 against ladder 5 and 4, return **identical figures to every decimal place**. The reason is visible in the table above: **mean payouts per payer are 1.54, 2.13 and 1.30, nowhere near any ladder length under discussion.** The average account never reaches rung 4, let alone rung 8.

**So [ADR-024](#) and Direct's ladder of 4 are margin-neutral in the central estimate, and their entire value is tail protection.** That is a stronger statement than "margin intact", and it is the one to carry:

- **The claim "liability is monotone-decreasing in `max_payouts`" is confirmed and is nearly vacuous at the mean.** The ladder does not bind the average account. It binds the account that keeps winning, which is precisely the account a reserve model must survive.
- **A ladder is a tail control priced at zero in the central case.** Shortening it costs nothing that shows up in a margin table and removes the far right of the distribution, which is where correlated groups and undetected rings live. The [risk engine's](../research/calibration/README.md) own conclusion points the same way: the tail is all correlation and the mean is flat.
- **The corollary is a warning.** Because the ladder never binds on the average account, **no margin table will ever show its value**, and a future review looking only at unit economics will find it costless in both directions and may conclude it can be lengthened for free. It cannot. INV-17 is the assertion, and this paragraph is the reason.

### The six-divergence checklist, run

| # | README divergence | Engine says | Outcome |
|---|---|---|---|
| 1 | "Rapid Daily" versus Merit Rapid | `'Rapid Daily (eval)'` | **Confirmed stale.** Corpus wins ([ADR-013](#)) |
| 2 | 5 win days versus `w=3` | `winning_days=5` | **Confirmed stale, and it means the committed engine predates the founder's own `w=3` re-run.** The re-run happened; it was never saved back. Corpus wins ([ADR-018](#)) |
| 3 | Rapid cadence gap 1 | `payout_gap=1` | **Agrees.** No divergence |
| 4 | Funded minimum days | Core `min_days=0`, **Rapid `min_days=5`, Direct `min_days=5`** | **A seventh divergence, not in the README's six.** Corpus is 0 on all three ([ADR-015](#)) and the engine carries 5 on two plans. It is dominated by the win-day gate in both cases, so it changes nothing, which is exactly why nobody noticed |
| 5 | Settlement anchor | Not modelled; the engine has `payout_gap` only | **Not applicable.** The anchor is a corpus-level semantic the model does not represent |
| 6 | Split "90/9" | `split=0.90` | **Resolved as a workbook display typo.** The engine has always been correct |
| 7 | Ladder 8 / 8 / 6 | `max_payouts=8, 8, 6` | **Confirmed stale.** Corpus is 5 / 5 / 4 ([ADR-024](#) and this gate) |

**Four confirmed stale, one agreement, one not applicable, one resolved as a typo, and one new.** The corpus won every contested row, which is the result the README predicted and the reason it was written before the engine arrived.

**The engine is now the source of record and it is stale in four places.** That is recorded rather than fixed here: **re-running it at the corpus configuration is a build-phase task**, listed in [SIMULATION_HARNESS section 8](testing/SIMULATION_HARNESS.md), and it must produce the table above before any CI calibration band is set from it.


---

## ADR-026: The schema-delta reconciliation, and the count correction  (2026-08-14, status: accepted)

- **Context:** Four waves of module plans proposed schema changes that were approved with their plans and never folded into [DATA_MODEL](architecture/DATA_MODEL.md). Section 11 of that document says so in its own words. This ADR authorizes the fold, amends a frozen document, records a count correction, and carries the rejection table.
- **Decision:** All **93** schema changes land as one migration set at `packages/db`, folded at create rather than applied as a base-plus-ALTER chain, because the repository contains no application code and no database. DATA_MODEL is amended in the same pull request under this ADR.

### The count was wrong, and the correction is folded rather than merely recorded

The corpus recorded "M01's ten, batch 1's thirty-one, batch 2's thirty-four". The actual counts are:

| Wave | Recorded | **Actual** | Drift |
|---|---|---|---|
| M01 (`SD-01` to `SD-10`) | ten | **10** | correct |
| Batch 1 (`SD-M2-nn` to `SD-M8-nn`) | thirty-one | **37** | **+6** |
| Batch 2 (`SD-M9-nn` to `SD-M20-nn`) | thirty-four | **41** | **+7** |
| Numbered total | 75 | **88** | **+13** |
| Unnumbered (section below) | 0 | **5** | **+5** |
| **Total in scope** | 75 | **93** | **+18** |

Per module: M02 6, M03 6, M04 3, M05 7, M06 5, M07 5, M08 5. M09 3, M10 4, M11 4, M12 4, M13 3, M14 3, M15 2, M16 3, M17 4, M18 3, M19 4, M20 4.

**Provenance, traced through git rather than assumed.** At commit `64b52b3`, when batch 1 was drafted and "thirty-one" was written, M02 to M08 held **34** deltas. **The number was wrong on the day it was recorded.** Session 7's batch-1 gate then correctly observed the set "grew by three" (`SD-M3-06`, `SD-M5-06`, `SD-M5-07`, all from [ADR-019](#)'s wallet) and applied a right increment to a wrong base: 31 + 3 = 34, where 34 + 3 = **37**. Batch 2 repeats the shape: 38 at `c5e7826`, plus `SD-M18-01` to `SD-M18-03` at [ADR-024](#), giving **41**.

**Nothing is missing from the corpus. Every delta is present and traceable.** What was wrong is a hand-maintained tally that four documents quoted. **Corrected in all four**: [STATE](STATE.md), [DELIVERY_PLAN](DELIVERY_PLAN.md), [GUIDE_BRIEFING](GUIDE_BRIEFING.md), and [SESSION_LOG](SESSION_LOG.md). The session log is append-only, so its two entries are **annotated in place** rather than rewritten: the historical record stands and carries the correction beside it, because falsifying a journal to fix a number is a worse failure than the number.

**The control that was missing.** The FREEZE gate moved registry counts under CI assertion (CI-06d); this tally sat outside that net. **A manifest completeness gate now joins CI**: every `SD-nn` and `U-nn` appearing anywhere in `docs/` must appear exactly once in `packages/db/DELTA_MANIFEST.md` with a disposition. A count nobody can drift is better than a count someone remembers to update.

**Two things the corpus called additions are not deltas.** `ladders_completed_lifetime` is already inside `SD-M14-01`'s column list, and the `SD-M19-03` widening is an amendment to an existing delta. Both fold; neither is counted twice.

### Five schema changes that exist as rulings with no delta number

| # | Change | Source | Why it has no number |
|---|---|---|---|
| **U-01** | Link-confidence **signal-weight table** | [ADR-022](#), M07 D-16 | Known homeless. ADR-022 tiers it to v1.x, so no module claimed it |
| **U-02** | `accounts.graduation_eligible` | [ADR-024](#), M01 R-49 | R-49 sets a flag no column exists for. `SD-M18-01` adds `graduated_at`, `graduation_path`, `terminal_settlement_id`, and not this |
| **U-03** | Identity-scoped **ledger halt state** with escalation clock | [ADR-016](#), M05 INV-M5-16 | The ruling requires a scoped halt that pages and escalates on a configured window: a row with a subject, a start, and a deadline. Nothing holds it |
| **U-04** | `identity_signals.kind` value for **D-15 checkout enrichment** | [ADR-023](#), M07 D-15 | The check list has no slot for the enrichment vendor's signals |
| **U-05** | `kyc_verifications.placement` **check widening** | [ADR-021](#) | The constraint allows `pre_eval, pre_funded, direct_purchase`. The ruled trigger vocabulary is a set. `SD-M19-03` widened the funnel table and not this one |

**These are the reason a count matters.** Four of the five were invisible because nobody was counting; they are rulings the schema does not yet express, which is the precise failure a reconciliation session exists to catch.

### Rejection table

**No delta was rejected.** All 88 numbered and all 5 unnumbered changes land, 90 in the v1 core sequence and 3 in a marked reserved sequence (`U-01` per ADR-022's v1.x tier, `SD-M18-03`'s `graduation_invitations` conditional on a live program that does not exist per [OQ-M18-01](#), and `SD-M11-04`). **This table says so explicitly rather than being absent**, because a rejection table that is missing is indistinguishable from a delta that was dropped.

### Documents amended under this ADR

[DATA_MODEL](architecture/DATA_MODEL.md) (tables rewritten to post-migration truth, section 11 re-materialized at the frozen configuration, delta-provenance appendix), **[GLOSSARY](GLOSSARY.md)** (the canonical naming authority: it carries the ledger class list, `ladder.payouts_to_graduate`, and the singular KYC placement. [ADR-027](#) **adds** `trader_wallet` to the class list, taking it to seven; [ADR-030](#) renames the other two keys), [M05](plans/M05-payout-system.md) (LT-01's debit leg and the state machine's `frozen` target), [STATE](STATE.md), [DELIVERY_PLAN](DELIVERY_PLAN.md), [GUIDE_BRIEFING](GUIDE_BRIEFING.md), [SESSION_LOG](SESSION_LOG.md), and [EDGE_CASES](EDGE_CASES.md) for gaps discovered while folding.

### C-07: the `state_hash` input, written down because it was not

`SD-08` adds `state_hash` for the nightly replay audit and `SD-06` splits the gates precisely because context gates are not replayable. **Nothing in the corpus recorded which columns the hash covers.** If `context_gates` entered it, a freeze applied last March would produce a divergence every night until someone disabled the audit, which is FM-17 by construction.

**The hash is SHA-256 over a canonical serialization** ([M01 section 12](plans/M01-rules-engine.md)): fields in the fixed declared order below, `bigint` rendered base-10, `null` as an explicit sentinel, no whitespace.

**Included, in this exact order:**

```
 1. account_id
 2. trading_day
 3. phase
 4. floor_cents
 5. floor_locked
 6. floor_open_cents                    -- SD-04
 7. high_water_balance_cents
 8. balance_cents
 9. withdrawable_cents
10. traded_days_count
11. win_days_count
12. consistency_best_day_cents
13. consistency_period_profit_cents
14. consistency_period_start_day        -- SD-07
15. payouts_settled_count
16. payout_anchor_day                   -- SD-02
17. cadence_anchor_day                  -- SD-02
18. engine_eligible                     -- SD-06
19. engine_gates                        -- SD-06
```

**Excluded, each for a stated reason:**

| Column | Why excluded |
|---|---|
| `context_gates` | **The whole reason SD-06 split them.** Freeze, recon, KYC and in-flight were true on the day and may not be true now. INV-23 |
| `engine_version` | A build identifier is not state. Including it makes every engine upgrade a universal divergence |
| `computed_at` | Wall-clock, not state |
| `id`, `state_hash` | Surrogate key and the hash itself |

**Both anchors are in the hash and both stay separate columns** (C-09). Under [ADR-019](#) they coincide today; collapsing them because today's configuration makes them equal is exactly the silent fold this session exists to prevent, and it is a 40 percent liability change if the anchor ever moves back.

## ADR-027: `trader_withdrawable` and `trader_wallet` are two distinct positions  (2026-08-14, status: accepted, **reversing an earlier ruling in this same session**)

- **Context:** C-01. [DATA_MODEL section 8](architecture/DATA_MODEL.md) and [GLOSSARY](GLOSSARY.md) carry `trader_withdrawable` as a per-identity ledger class. `SD-M5-07` introduces `trader_wallet` per identity. [M05](plans/M05-payout-system.md)'s LT-01 touches both in one transaction, which read at first glance like a rename applied to one leg and not the other.
- **This ADR was first written the other way, ruling one class named `trader_wallet` and retiring `trader_withdrawable`. That ruling was wrong, was folded into GLOSSARY, DATA_MODEL and M05, and was committed. It is reversed here, and the reversal is recorded rather than the history rewritten**, because a corpus that quietly repairs a bad ruling teaches nobody what the bad ruling looked like.
- **Decision: two distinct per-identity positions. The chart of accounts carries both. Seven v1 classes.** `SD-M5-07` says **add** the `trader_wallet` account class, and it means add.

### The evidence, which was in the corpus and was read past

[M05](plans/M05-payout-system.md) states the split explicitly: a payout approval reduces the **withdrawable** position by the full `approved_cents`, and **of that**, `trader_cents` becomes the wallet payable and `firm_cents` becomes revenue.

**`approved_cents != trader_cents`. The two positions move by different magnitudes in the same transaction, which is precisely what one class cannot do.** Withdrawable is what the engine says the trader may draw; wallet is what Merit already owes them. They are different facts about different moments, and the payout is the event that converts one into the other minus the firm's share.

### What the collapse would actually have done, which is worse than the first draft claimed

The first version of this ADR asserted the collapsed posting would "balance and move nothing". **That was wrong.** With one class `X`:

```
debit  X              approved_cents   (= trader_cents + firm_cents)
credit X              trader_cents
credit fees_revenue   firm_cents
```

Net on `X` is `trader_cents - approved_cents = -firm_cents`. **Every payout approval would have net DEBITED the trader's single position by the firm's share, draining it on every approval, in the firm's favor.** At a 9000bp split on a 100,000c cap that is 10,000c per approval, taken from the trader, silently.

**And the deferred zero-sum trigger passes**, because debits equal credits: 100,000 against 90,000 plus 10,000. **The ledger reconciles perfectly while the balance is wrong.** The invariant that would have caught it is not zero-sum; it is that a position's movement must match the business event it records, and no trigger asserts that.

**This is the single best argument in the corpus for why the reconciliation session exists**, and it is sharper for having been produced by the session rather than by an adversary: a plausible reading of two documents, ruled on by the founder, folded correctly by the author, and wrong. The catch came from re-reading the source rather than from any test, which is what the E2 line-by-line read on money-path files is for.

### The corrected posting

```
LT-01 payout_approval
  debit  trader_withdrawable (identity)  approved_cents
  credit trader_wallet       (identity)  trader_cents
  credit fees_revenue                    firm_cents
```

**The debit leg is unchanged.** The only defect in the corpus was the table row reading `credit firm_treasury trader_cents` while its own note beneath already said the leg credits `trader_wallet`. **The row is corrected to match the note**, and that is the whole of C-01's real content.

**`firm_treasury` as the debit is rejected.** It books a cash movement at approval, which contradicts the ruled recognition timing: **payout liability books at approval, cash derecognizes at settlement**. Cash moves at LT-02 and LT-07. The first draft of this ADR proposed `firm_treasury` and it is rejected on the record, alongside the `firm_payable` class that draft invented and that does not exist in the chart of accounts.

- **Consequences:** [GLOSSARY](GLOSSARY.md) and [DATA_MODEL](architecture/DATA_MODEL.md) are amended to **add** `trader_wallet`, not to retire `trader_withdrawable`; the earlier "superseded name" edit is reverted in both. Migration file `0009_ledger` creates both classes. M14, M17 and M20's invariants against `trader_wallet` are unaffected, because nothing about the wallet's meaning changed; what changed is that it no longer swallows a second position.
- **Alternatives considered:** one class named `trader_wallet` (**ruled and then reversed**, for the reasons above); one class named `trader_withdrawable` (same defect, different label); keeping both but netting them in reporting (rejected: Open Liability needs the wallet reportable per identity, INV-M5-15, and a netted view cannot be un-netted).

## ADR-028: `payout_requests.status` under the wallet  (2026-08-14, status: accepted)

- **Context:** C-02, **the single most dangerous item in the set.** The approved enum is `approved, transferring, settled, failed, frozen`. [M05](plans/M05-payout-system.md) section 3 says the internal leg "reaches `settled_to_wallet` and stops"; M05 step S-4 says set `status = 'settled'`. Under [ADR-019](#), `transferring` describes the external leg, which now lives in `wallet_withdrawals`. **No delta proposed any of this.** And `SD-09`'s partial unique index has predicate `status in ('approved','transferring','frozen')`, so the enum question **silently decides whether G-NO-IN-FLIGHT is enforced at all.**
- **Decision:** **The enum is `approved, settled, failed, frozen`.** `transferring` is retired from `payout_requests` and owned by `wallet_withdrawals`. **`settled_to_wallet` is not added**, because settlement to the wallet is the only settlement the internal leg has, and a status naming its destination invites a second one. **`SD-09`'s predicate becomes `status in ('approved','frozen')`.**
- **Two corrections the ruling carries, both found by reading the files rather than the deltas:**
  1. **[DATA_MODEL](architecture/DATA_MODEL.md) line 638 carries a second index with the same stale predicate**, `(status) partial where status in ('approved','transferring')`. It becomes `where status in ('approved','frozen')`. **A predicate fixed in one of two places is a uniqueness guarantee that holds on Tuesdays.**
  2. **[M05](plans/M05-payout-system.md)'s state machine reads `frozen --> transferring`**, which becomes unreachable once `transferring` leaves this table. **Retargeted to `frozen --> settled`**, which is what a released freeze actually does under the wallet: the payout settles internally and instantly.
- **Why the predicate is the dangerous half.** G-NO-IN-FLIGHT is the gate that stops a second payout while one is outstanding. If the index kept `transferring` in its predicate after the value stopped occurring, **the index would still exist, still be valid, and enforce nothing**, because no row would ever match. A gate that silently stops gating is worse than one that is absent, and nothing in the test suite would fail.
- **Consequences:** the enum is written with a comment naming the zero-denial policy, so a future `denied` or review state is a deliberate act against a stated rule rather than an oversight. `wallet_withdrawals` owns the external leg's states per [M20](plans/M20-wallet.md).
- **Alternatives considered:** keep `transferring` on `payout_requests` for the external leg (rejected: it duplicates state that `wallet_withdrawals` owns, and two tables tracking one transfer is how they disagree); add `settled_to_wallet` (rejected above).

## ADR-029: `dedupe_matches` is the authoritative hard link  (2026-08-14, status: accepted)

- **Context:** C-05. `SD-M19-04`'s `dedupe_matches` exists because the single `kyc_verifications.dedupe_matched_identity_id` column "cannot express a face matching three identities". **The delta does not say to drop the column.** Under [ADR-022](#) a dedupe hit is a **hard link that auto-enforces**, so two sources that can disagree is an enforcement defect rather than a redundancy.
- **Decision:** **Drop `dedupe_matched_identity_id`. `dedupe_matches` is authoritative.** `biometric_dedupe_hit` stays as the fast boolean, because a boolean cannot contradict a set; it can only be stale, and staleness is detectable.
- **Why it needed a ruling.** This is an **auto-enforcement input**. A hard link bans an account without human review, and a system with two sources for that decision will eventually enforce on the one that happens to be read first. Leaving both would have been the safe-looking choice and the wrong one.
- **Alternatives considered:** keep the column as a denormalized "first match" (rejected: "first" is not a property of a set, and the column would drift the moment a second match arrived).

## ADR-030: Plan-config key names are `max_payouts` and `kyc.triggers`  (2026-08-14, status: accepted)

- **Context:** C-06. `ladder.payouts_to_graduate` ([DATA_MODEL section 11](architecture/DATA_MODEL.md), [M01](plans/M01-rules-engine.md) R-49, CV-14) versus `max_payouts` (M01 Appendix A, [ADR-024](#)). Section 11's literal example is also stale: ladder 8, `win_days.required_count` 5, `phase_eval.min_trading_days` 1, and `kyc.placement` as a singular enum against [ADR-021](#)'s ruled trigger set. **The zod schema and the CV publish validations key off these names.**
- **Decision:** the canonical name is **`max_payouts`**, matching ADR-024 and every Appendix A table. **`kyc.placement` becomes `kyc.triggers`, an array.** Section 11's example is re-materialized at the frozen configuration under [ADR-026](#).
- **Consequences:** [GLOSSARY](GLOSSARY.md) is amended, since it carries `ladder.payouts_to_graduate` and the singular placement. `U-05` widens the `kyc_verifications.placement` check to the ruled trigger vocabulary in the same migration, because a config key and a stored value that disagree is the same defect one layer down.
- **Alternatives considered:** keep `payouts_to_graduate` (rejected: ADR-024 is the later ruling and Appendix A is what a founder reads when confirming parameters); keep the singular placement and store the trigger set elsewhere (rejected: it splits one fact across two shapes).

