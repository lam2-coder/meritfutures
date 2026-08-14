---
status: review
depends_on: [MERIT_BUILD_MASTER_PROMPT.md]
last_updated: 2026-08-13
---

# Claude Code Playbook (Constitution Appendix C0)

Current community and Anthropic practice for running Claude Code on a solo+AI money-app build, merged into an actionable playbook and checked against the constitution (Appendix C). Researched 2026-08-13. Where community practice contradicts the constitution, it is flagged for a DECISIONS.md amendment rather than silently adopted (§0.5 gate). Refresh monthly per C0.

**Note on this being a `research/` doc.** The constitution's §0.5 skeleton places this file in `research/`; Appendix C0 says `docs/CLAUDE_CODE_PLAYBOOK.md`. The skeleton won ("nothing lives anywhere else"), logged as a Session-1 landmine. If the founder prefers `docs/`, moving it is a one-line INDEX change (flagged again in §7 below).

## 1. The one constraint everything reduces to: context is the budget

Community consensus 2026: "Claude Code best practices reduce to one constraint — the context window fills up quickly." The named failure modes are precise and match the constitution's treasury metaphor:
- **Context poisoning** — a hallucinated result contaminates later turns.
- **Context confusion** — irrelevant material steers the answer.
- **Context clash** — two parts of the context contradict each other.
Every iteration appends to the window; as history grows, the model degrades. ([HighLearningRate](https://highlearningrate.substack.com/p/agents-fail-between-model-calls-2026), [SmartScope advanced practices](https://smartscope.blog/en/generative-ai/claude/claude-code-best-practices-advanced-2026/))

**Merit alignment:** C4 already treats context as scarce. The playbook additions below are tactics, not a new doctrine.

## 2. The surface map (enforce → knowledge → convention), confirmed and sharpened

Community now states the exact division the constitution's C10 adopted: **hooks/permissions for enforcement, skills for contextual knowledge, subagents for context isolation.** ([ofox.ai hooks/subagents/skills guide](https://ofox.ai/blog/claude-code-hooks-subagents-skills-complete-guide-2026/), [code.claude.com best practices](https://code.claude.com/docs/en/best-practices))

- **Hooks are law.** "Without hooks, every safeguard depends on the model understanding your instructions; with hooks you enforce at the system level." Merit's mandatory hook set (C10) stands: PostToolUse test-run, PreToolUse dangerous-pattern + payout/ledger write block, Stop completion gate (lint+typecheck+test), PreCompact preservation, SessionStart STATE echo.
  - **New caveat (adopt):** auto-format/heavy hooks can burn large context (one report: 160k tokens across 3 rounds). **Rule for Merit:** hooks must emit terse output (pass/fail + first failing line), never stream full formatter/test dumps into the thread; verbose artifacts go to `test-results/` and are read on demand (matches C4). ([SmartScope](https://smartscope.blog/en/generative-ai/claude/claude-code-best-practices-advanced-2026/))
- **Skills for repeated knowledge.** "If you've written the same instructions twice, it should have been a skill." Merit's early skills (C10) confirmed valuable: `migration-procedure`, `golden-file-authoring`, `payout-path-review`, `rithmic-csv-format`, `design-tokens`. Progressive disclosure keeps CLAUDE.md lean.
- **Subagents for isolation.** "Sub-agents run in a separate context window and can explore or verify without cluttering the main conversation." Use for: research/log-spelunking/dependency audits (return a summary file), and — critically for Merit — the **writer/reviewer split** (C10 self-grading rule): the agent that writes M1 is never the one grading it; the reviewer runs as a fresh subagent with its own system prompt.

## 3. Plan mode and spec-first (the highest-ROI habit)

"Planning before implementation is non-negotiable; plan mode before any edit." Spec-driven flows show large implementation-time reductions because the thinking precedes the typing. ([zenn best-practice guide](https://zenn.dev/tmasuyama1114/articles/claude_code_best_practice_202601?locale=en), [Medium 2026 workflows](https://medium.com/data-science-collective/effective-claude-code-workflows-in-2026-what-changed-and-what-works-now-c93ebc6f8f50))

**Merit alignment:** this IS the whole planning-corpus doctrine (§0.5) — plan mode is mandatory for structural work and migrations (C5). The constitution is ahead of community practice here, not behind it. The B5 module-plan template and the "no plan, no place on the roadmap" gate are the strongest version of this habit found anywhere in the research.

## 4. CLAUDE.md discipline (with a research-backed warning)

- "Keep it short and current; a CLAUDE.md that has drifted is worse than none, because Claude trusts it. Every line should be human-approved." ([Medium 2026 workflows](https://medium.com/data-science-collective/effective-claude-code-workflows-in-2026-what-changed-and-what-works-now-c93ebc6f8f50))
- **ETH Zürich finding (Gloaguen et al., 2026):** LLM-*generated* context files reduced task success ~3% and raised inference cost 20%+, while developer-*written* files improved success ~4%. **Implication for Merit:** CLAUDE.md and the doc frontmatter must stay human-curated; do not let a model auto-generate the session brain. The founder-approves-every-line rule (already in INDEX ownership: CLAUDE.md owner = founder) is empirically correct.

**Merit alignment:** CLAUDE.md is already lean and founder-owned; STATE.md carries the volatile state so CLAUDE.md stays stable. No change.

## 5. Multi-session, worktrees, parallelism

- Teams run 4-8 concurrent worktrees per developer by mid-2026; each subagent can get its own worktree/branch/context. ([claudedirectory worktrees guide](https://www.claudedirectory.org/blog/claude-code-worktrees-guide), [FlorianBruniaux agent-teams](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/agent-teams.md))
- **Merit constraint holds and is stricter on purpose:** C7 caps at ~2-3 worktrees "by your review capacity, not the tooling's," and rules-engine work is always solo (never two sessions on shared packages). For a solo founder whose review time is the bottleneck and whose money paths demand line-by-line reading, the community's 4-8 is an anti-pattern. **Keep C7's cap; do not adopt the higher number.** This is a deliberate divergence, not an oversight.

## 6. Failure stories → guardrails (what makes agentic coding go wrong)

Documented 2026 failure catalog and the Merit control each implies:
- **Revert/error loops** (fix bug A → create bug B, forever) among the top-10 common errors. → C6 error-loop circuit breaker: stop after two failed corrections on the same bug; fresh session with a written repro. ([AppStuck 10 errors](https://www.appstuck.com/blog/claude-code-troubleshooting-10-errors-fixes-2026))
- **Out-of-scope edits / "built something nobody asked for"** on long autonomous runs (a 4-hour unattended loop produced unrequested work). → scoped tasks only; "unbounded go-investigate is banned" (C10); plan-gated execution. ([rentierdigital 4-hour story](https://medium.com/@rentierdigital/i-let-claude-code-run-for-4-hours-it-built-something-nobody-asked-for-cde474825b33))
- **Context compaction landing mid-task** / context exhaustion as "the primary failure mode for agent loops." → C4 deliberate `/compact` at checkpoints with a focus hint; never let auto-compaction land mid-money-path; PreCompact preservation hook.
- **Agent with full filesystem/permissions destroying reachable data**; attacker-controlled project overriding `ANTHROPIC_BASE_URL` to exfiltrate the API key. → C10 sandbox posture + VG-7/VG-8 (agent never holds prod creds; dangerous-shell PreToolUse block); workspace boundary explicit. ([Docker horror stories](https://www.docker.com/blog/ai-coding-agent-horror-stories-security-risks/), [Straiker on the base-URL vector](https://www.straiker.ai/blog/claude-code-source-leak-with-great-agency-comes-great-responsibility))
- **Self-grading trap** (model writes impl + tests, shares blind spots). → C10 writer/reviewer split + spec-derived golden files (from plan docs/B4, never from implementation output). This is existential for M1 and the research reinforces it strongly.

## 7. Contradictions with the constitution (flagged for DECISIONS.md)

**C0 gate: where community practice contradicts the constitution, propose an amendment, don't silently adopt.** Two genuine tensions surfaced; both are proposed as amendments (not yet acted on):

1. **Session length: compound vs reset.** A visible 2026 community strand argues "keep sessions longer, let context compound across tasks, reset only when you change projects" — enabled by 1M-token windows + compaction. The constitution's C4/C3 says the opposite: `/clear` between unrelated tasks, one objective per session, start fresh per module slice. **Assessment:** the constitution is right *for Merit's money paths* (context poisoning on a payout/ledger diff is catastrophic; the file-based handoff standard makes resets cheap), but the "compound" approach may be fine for low-stakes UI/doc work. **Proposed ADR-003 (below): keep per-slice resets on money paths; permit longer compounding sessions only for non-money work (site/docs/fixtures), explicitly.** Not adopted pending founder approval.

2. **Playbook file location.** §0.5 skeleton (`research/`) vs Appendix C0 text (`docs/`). Standing landmine since Session 1. **Proposed: leave in `research/` (all Phase-0 research lives together; C1 says research outputs land in `research/`), and treat the C0 `docs/` reference as superseded.** A one-line fix either way; founder picks. Logged as ADR-004 candidate.

Everything else in current practice **agrees with or is already exceeded by** the constitution (plan-first, hooks-as-law, skills-for-knowledge, subagent isolation, writer/reviewer split, evidence-not-claims, error-loop breaker, sandbox posture). Appendix C is, if anything, more rigorous than the median community guide because it is built for a money app.

## 8. The actionable playbook (the distilled checklist for every Merit session)

**Start:** read CLAUDE.md → STATE.md → last 2 SESSION_LOG entries → active plan; state the one objective; confirm.
**Model routing:** Fable 5 for M1/migrations/security/plan-docs/Phase-0 synthesis; Opus 4.8 @ xhigh for long approved builds; Sonnet for routine on-plan work; Haiku for chores. (Per CLAUDE.md model block.)
**Before code:** plan mode → written plan/diff → founder approval. No plan, no code.
**During:** scope reads narrowly or delegate to a subagent that returns a summary file; keep hook output terse; `/compact` at checkpoints with a focus hint; never auto-compact mid-money-path.
**Money paths:** tests-first from spec-derived golden files; writer ≠ reviewer (reviewer is a fresh subagent); founder reads every diff line-by-line on rules-engine/payout/ledger/auth; the comprehension rule is non-negotiable.
**On errors:** two failed corrections on one bug → stop, write a precise repro, fresh session.
**End (before context runs out):** commit clean (conventional message referencing the doc/section); append SESSION_LOG (done/next/blockers/landmines/files); update STATE.md; regenerate INDEX if any doc changed status.
**Weekly:** C8 meta-retro on objective signals only (plan items shipped, golden tests added/passing, CI history, EDGE_CASES closed) — never "it felt productive" (the 19%-slower-but-felt-20%-faster RCT).

## Contradictions / notes summary

- **Two proposed amendments** (session-length policy; playbook file location) carried to DECISIONS.md as ADR-003 and ADR-004 candidates. Neither acted on; both await the founder.
- **No hard blockers.** Current practice validates the constitution's operating model; the only real divergences (worktree cap, session resets) are places where the constitution is *deliberately stricter* for money-code safety, and Merit should keep the stricter rule.
- **One adopted refinement** (no amendment needed, it is additive): hooks must emit terse output and route verbose artifacts to `test-results/`, to protect the context budget — fold into INFRA.md's hook specs in Wave 2.
