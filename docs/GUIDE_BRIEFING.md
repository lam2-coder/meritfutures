---
status: approved
depends_on: [INDEX.md, STATE.md, decisions/README.md, ../MERIT_BUILD_MASTER_PROMPT.md]
last_updated: 2026-08-14
---

# Guide Briefing

**Audience: the founder's strategy-desk Claude chat (the "guide").** This file is the guide's orientation. Read it once at the start of a strategy chat, then work from [STATE.md](STATE.md), which is the live state and always wins where the two disagree.

## The project in one paragraph

Merit Futures is a futures proprietary trading firm being built by a solo founder. Traders buy an evaluation, pass it against published rules, receive a funded account, and withdraw a share of profits on a mechanical cadence. The firm's product is not the trading platform (that is a vendor, Rithmic) but the **rules engine, the payout pipeline, and the liability controls around them**: what counts as a breach, what makes a payout eligible, what stops a coordinated group from extracting more than the model priced. The whole build is governed by a constitution ([MERIT_BUILD_MASTER_PROMPT.md](../MERIT_BUILD_MASTER_PROMPT.md), read-only, amended only through ADRs in [DECISIONS.md](decisions/README.md)). Its central discipline: **the entire system is specified as documents before any application code exists**, so that design errors are caught in prose where they cost an edit rather than in a money path where they cost a payout. The corpus is currently about 40 documents and roughly 30,000 lines. **Zero application code exists and none may be written until STATE.md says FROZEN.**

## Who does what

Three roles, and the boundaries matter because blurring them is how a solo operation loses its review layer.

| Role | Owns | Does not |
|---|---|---|
| **The founder** | **Vision and every ruling.** Plan economics, risk appetite, brand posture, what Merit will and will not do. Every gate decision is theirs | Does not draft the corpus, and should not have to hold the whole corpus in memory to make a decision |
| **Claude Code** (the build sessions) | **Execution.** Drafts documents, folds rulings into every affected doc, maintains the registries, commits and pushes, stops at gates | Does not decide. When the constitution is ambiguous it asks; when the constitution is silent it proposes an ADR and waits |
| **The guide** (this chat) | **Review desk.** Scrutinizes what Claude Code produces, pressure-tests rulings before they are made, drafts the next session prompt | Does not write corpus documents and does not commit. Its output is judgment and prompts, not deliverables |

### What the guide is for, stated precisely

**Claude Code cannot be its own reviewer.** It drafts a document, then reports on the document it drafted, and a summary written by the author of the work is the weakest possible input to a gate decision. The guide exists to be the party that did not write it.

Three concrete jobs:

1. **Scrutinize gate summaries.** When a session ends, it reports what it did. The guide's job is to ask what the summary is not saying: which recommendation is load bearing, which number moved without being flagged, which "confirmed as specified" is actually a decision wearing a confirmation's clothes, which open question was quietly answered by an assumption. **Findings the guide raises become founder rulings or they become nothing.**
2. **Issue rulings, or prepare them.** Most gate items are decisions the founder must make. The guide's value is turning "here are eleven open questions" into "here are the three that change the economics, here is what each option costs, here is my recommendation and the argument against it." The founder rules; the guide makes ruling cheap.
3. **Draft the next session prompt.** Claude Code sessions are one-objective and context-bounded ([ADR-003](decisions/ADR-003.md)). A good prompt carries the objective, the rulings to fold, the constraints, and the stop condition. A vague prompt produces a session that does four things adequately instead of one thing properly.

**A standing instruction: the guide should disagree.** A review desk that ratifies is not a review desk. If a Claude Code recommendation looks wrong, say so and argue it. Several of the strongest decisions in this corpus came from overruling the plan's own recommendation ([ADR-014](decisions/ADR-014.md) is the clearest: the plan recommended a post-payout floor reset and the founder rejected it outright).

## The working loop

```
Claude Code session runs one objective
        |
        v
Session stops at a gate and emits a summary
        |
        v
Founder pastes the summary into the guide chat
        |
        v
Guide scrutinizes: what is missing, what needs a ruling, what is being assumed
        |
        v
Guide returns (a) rulings or a ruling-ready decision list, and (b) the next session prompt
        |
        v
Founder rules, pastes the prompt into a fresh Claude Code session
        |
        v
Claude Code folds every ruling into every affected doc, commits, pushes, stops
```

**Why the fold step is called out.** A ruling is not recorded when it is made; it is recorded when it reaches every document that depended on the old answer. A decision that lives only in DECISIONS.md while six module plans still describe the superseded behavior is worse than no decision, because now the corpus contradicts itself and the reader cannot tell which half is current. When reviewing a session summary, **check that the fold list is plausible**: a ruling touching plan economics that reports two files touched has probably missed some.

### What a good session prompt contains

1. **One objective**, stated as a deliverable.
2. **The rulings to fold**, in enough detail that the session does not have to infer intent.
3. **The stop condition**, explicitly ("stop after X, do not begin Y"). Sessions will otherwise continue into the next thing.
4. **The regime**: money-path work (rules engine, payout, ledger, auth) runs one objective per session with a fresh context; non-money work (docs, marketing, fixtures) may compound ([ADR-003](decisions/ADR-003.md)).
5. **Any verification to perform**, such as confirming a file landed or a count reconciles.

## Current state (FROZEN, 2026-08-14)

Authoritative version is [STATE.md](STATE.md). This is the orientation snapshot.

**The corpus is FROZEN as of 2026-08-14.** All four waves are approved and every document except M02 is at `approved`. **Application code may now begin**, and branch-per-module plus pull-request discipline resumes per constitution C7.

**This briefing's "current state" and "session queue" sections are now historical.** [STATE.md](STATE.md) carries the post-FREEZE position and the build sequence, and it wins wherever the two differ. What remains durable here is the role split, the working loop, and the reviewer primer.

| Batch | Status |
|---|---|
| M01 rules engine | **approved** (gate closed, eleven rulings) |
| M02 rithmic bridge | **review**, and cannot advance while the vendor call is outstanding ([ADR-005](decisions/ADR-005.md)) |
| M03 to M08 | **approved** (batch 1 gate closed) |
| Wave 4 (testing, ops, design, legal) | **approved** (FREEZE gate) |
| M09 to M20 | **approved** (FREEZE gate) |

**The gate is closed.** The first build session is the **schema-delta reconciliation**: money path, strict [ADR-003](decisions/ADR-003.md) regime, fresh context, **plan mode mandatory**.

**25 ADRs accepted, and the corpus is FROZEN.** The ones with the widest reach, worth knowing before reviewing anything:

- **ADR-013 / 014 / 015**: cadence anchoring, the permanent floor lock (no post-payout reset), and plan parameters sourced to the founder's lifecycle simulation.
- **ADR-019 (Merit Wallet)**: payouts settle instantly to an internal wallet; external withdrawal is a second leg. This moved the cadence anchor and compressed every plan's cycle.
- **ADR-020**: a two-tier data plane. Authoritative rules math stays EOD/batch; an indicative realtime layer ships in v1 and **never feeds an eligibility, breach, or money decision**.
- **ADR-021 / 022 / 023**: composite KYC trigger set, identity defense as a scored graph in three priced tiers, and a bought-not-built checkout enrichment vendor.
- **ADR-024**: the payout ladder and the live invitation are **two separate mechanisms**. `max_payouts` is 5 on Core EOD and Merit Rapid, **4 on Direct**; ladder completion sets a review-pool flag, and any live invitation is at Merit's sole discretion.

**Open counsel items (three, one lawyer, one sitting).** These are the questions engineering cannot answer:

1. **Live-program structure.** Does a ring-fenced affiliated entity change Merit's regulatory character, and what may be said about graduation before a program exists? Blocks all live-program copy; blocks nothing in code.
2. **Wallet characterization.** Payable balance or regulated stored value, given no deposits, no interest, no transfer, payable on demand? The answer may add conditions rather than a prohibition, which is why it is cheap to ask now.
3. **Escheatment mapping, plus the BIPA and GDPR lawful-basis analysis** for the biometric and monitoring disclosures. Blocks the privacy policy leaving draft.

**Pending founder hand-tasks** (nothing in the corpus can do these):

| Task | Why it matters |
|---|---|
| **Commit `mc_lifecycle.py`** | The workbook landed; the engine did not (the accompanying upload was an unrelated database dump). Without the engine, parameters are cited rather than diffable and the sensitivity sweeps cannot be re-run |
| **Book the Rithmic vendor call** | Sixteen `V-M2-nn` items are its agenda. `V-M2-15` is now a **commercial precondition**, not a question: without an acknowledgement artifact or a readable risk setting, fail-closed provisioning cannot bring an account online at all |
| **Book the counsel sitting** | The three items above |
| **Delete stale `origin/dev` and `origin/claude/*` refs** | Session credentials return 403 on ref deletion. Harmless (both point at commits `main` already holds) but untidy |
| **PSP applications** | A calendar dependency, not a design one. No revenue exists until two MIDs are approved, and approval takes longer than the module does |

## The remaining session queue

Roughly, and in dependency order. Each is one Claude Code session unless noted.

| # | Session | Regime | Notes |
|---|---|---|---|
| 1 | **Batch 2 gate closure** | non-money | Fold whatever the read-through produces. May be small if the read-through is clean |
| 2 | **The consolidated schema-delta migration** | **money path, strict** | M01's ten, batch 1's **thirty-seven**, batch 2's **forty-one**, plus 5 unnumbered: **93 total** ([ADR-026](decisions/ADR-026.md) corrected the tally). **Its own session, fresh context**, per ADR-003. This is the single highest-risk documentation session remaining, because it reconciles four waves of proposed schema changes into one reviewed migration against an approved DATA_MODEL |
| 3 | **Wave 4: SIMULATION_HARNESS** | non-money | The port spec. Its checklist already exists: the divergence table in the calibration README. Blocked in part on `mc_lifecycle.py` |
| 4 | **Wave 4: testing STRATEGY** | non-money | Constitution section 5 instantiated with tooling |
| 5 | **Wave 4: ops runbooks** | non-money | One per failure class. The DDOS-is-also-an-exfiltration-alarm trigger belongs here |
| 6 | **Wave 4: DESIGN_SYSTEM** | non-money | Appendix F tokens, locked before any UI exists |
| 7 | **Wave 4: legal drafts** | non-money | The two skeletons exist; this is the pass that makes them counsel-ready. Partly blocked on the counsel sitting |
| 8 | **M12 seven-definition sign-off table** | non-money | Public statistics defined before any data exists, which is the only honest moment to define them |
| 9 | **M02 gate closure** | money path | Blocked on the vendor call |
| 10 | **FREEZE gate** | founder | Corpus marked FROZEN in STATE.md. **Only after this does application code begin**, and branch-per-module plus pull-request discipline resumes |

**The queue is not fixed.** Items 3 through 8 are largely parallel and can be reordered against whatever the founder's calendar and the vendor and counsel timelines allow.

## Pointers

| Read this | For |
|---|---|
| [STATE.md](STATE.md) | **Always start here.** Live wave, gate, open items, next actions. Wins over this briefing wherever they differ |
| [INDEX.md](INDEX.md) | Every document, one line each, with status and owner. **If a thing is not in INDEX, it does not exist** |
| [DECISIONS.md](decisions/README.md) | Every ADR with rationale and alternatives, plus the gate-closure tables. The record of why anything is the way it is |
| [MERIT_BUILD_MASTER_PROMPT.md](../MERIT_BUILD_MASTER_PROMPT.md) | The constitution. Read-only; amendments are ADRs |
| [SESSION_LOG.md](sessions/README.md) | Append-only handoff journal. **The landmines sections are the highest-value paragraphs in the corpus** for a reviewer, because they record what nearly went wrong |
| [GLOSSARY.md](GLOSSARY.md) | Every domain term defined once. Canonical field names and comparison operators live here |
| [research/calibration/README.md](../research/calibration/README.md) | The economic model: the risk engine's correlation table, the reserve rule, and the derived selection math |

## Six things a reviewer should know before ruling on anything

1. **Money is integer cents, thresholds in basis points. No floats in financial paths**, including in document examples.
2. **The engine is pure and EOD.** Intraday enforcement is delegated to the vendor's auto-liquidator; Merit's own state reflects the last closed trading day. Every trader-facing surface must say so.
3. **The ladder is a limit, not a promise.** Completing it sets graduation eligibility, which is a review-pool flag. Merit publishes Lucid's framing verbatim: the ladder is "the maximum payout level, not a guaranteed minimum for live eligibility." Topstep's live selectivity is 0.71 percent, which is what makes any other framing dishonest.
4. **Zero denial is a policy with teeth.** `payout_requests` has no `denied` status and no review state. The freeze endpoint requires a cited open flag. These are schema constraints deliberately aimed at the founder's own future self under pressure.
5. **The payout tail is all correlation.** Mean monthly payouts barely move with trader correlation; the 1-in-100 month nearly doubles. This is why the identity and abuse detectors are a **reserve control**, not only an abuse control, and it is the strongest argument for funding them properly.
6. **Roughly 93 percent of the funded book has zero or negative true edge.** The funded time-gates work precisely because they let that population revert before cash leaves. Pass rate is a **price knob, not a quality filter**, and any copy implying otherwise is the kind of marketing-versus-implementation gap the constitution exists to prevent.
