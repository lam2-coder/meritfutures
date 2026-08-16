---
status: approved
depends_on: [../../MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, ../architecture/data-model/README.md, ../architecture/STATE_MACHINES.md, ../architecture/EVENTS.md, ../architecture/API_CONTRACT.md, ../../research/ADVERSARY_DOSSIER.md, ../decisions/README.md, ../edge-cases/README.md, ../testing/golden-scenarios/README.md, M01-rules-engine.md, M02-rithmic-bridge.md, M05-payout-system.md, M06-admin-ops-console.md, M20-wallet.md, ../decisions/ADR-040.md, ../decisions/ADR-041.md, FOLD-02-enforcement-window-and-suspension.md]
last_updated: 2026-08-16
---

# M7: Risk and Abuse

Constitution section M7, Appendix A (the whole dossier), Appendix B4 items 16, 17, and 21, Appendix B5 ten-section template. Escalation tier per C5.

Constitution Appendix A states the kill chain this module is one link of: **rings bound by rules, caught by detection, made unprofitable by both, and the reserve survives whatever leaks through.** M1 already did the bounding. M7 does the catching, and it does it under one absolute constraint that shapes every design choice here.

**Detection never denies a payout.** Enforcement happens at detection time, per the ToS, with an evidence pack, against an account or an identity. It never happens at request time against a payment. That is [detection-time enforcement](../GLOSSARY.md#detection-time-enforcement) and it is the reason the zero-denial promise can be kept while abuse is still handled.

**Amended by [ADR-040](../decisions/ADR-040.md), and the amendment is narrower than it first reads.** One of this module's flags can now hold a payout **at request time**: an unresolved severity 4+ flag puts the request into `held_pending_review` before it is approved. **Detection still never denies a payout, and detection still decides nothing.** What the flag does is start a clock that binds on Merit: the request either **pays within 48 hours** or produces the documented enforcement action this paragraph already required, per the ToS, with an evidence pack. The detector's output is unchanged, still `open` and nothing else (INV-M7-02), and **no detector puts a request on hold**, because entering `investigating` is a human act with a written reason and a ToS clause. **This is one of the ten zero-denial sites ADR-040 enumerates**, and two of the ten sit inside merged migrations and can never be edited (constitution E2).

**The sentence that changed is "it never happens at request time", and the honest form is that it now happens at request time and cannot end there.** A hold is not an enforcement. It is a bounded pause with a deadline Merit owes the trader, and the only two ways out of it are **paying** and **a decision somebody signed**.

**Amended and approved at the Wave 3 batch 1 gate (2026-08-14).** The **copy-trading clause was ruled** (section 3.4), which gives D-01 consequences for the first time, and **three detectors were added** to close the gap AS-M7-01 identified and could not close on its own: **D-12** day-0 graph-prior pairing, **D-13** the young-account fast path, and **D-14** clique position-sum detection. Together they move this module from detecting persistence to detecting entry.

**Identifier conventions:** `INV-M7-nn` invariants, `SD-M7-nn` schema deltas, `D-nn` detectors, `FM-M7-nn` failure modes, `AS-M7-nn` adversarial scenarios, `OQ-M7-nn` open questions, `DEP-M7-nn` dependencies.

---

## 1. Purpose and invariants

### 1.1 What this module is

Two halves that share a graph.

**Entity resolution** turns signals into a resolved [trader identity](../GLOSSARY.md#trader-identity). It runs at signup and at purchase, synchronously, because the account cap is enforced per entity and a cap enforced after the sale is not a cap.

**Detectors** run nightly and on ingest, produce `risk_flags` with numeric evidence, and stop. A human decides. That boundary is absolute (INV-M7-02).

### 1.2 What this module is not

| Not M7 | Whose job | Why the boundary is here |
|---|---|---|
| Denying or clawing back a payment | nobody | There is no such action anywhere in Merit. **A flag can now cause three things and every one of them is bounded and ends in a payment or a signed decision:** a **pre-approval hold** ([M05](M05-payout-system.md) SD-M5-08, 48 wall-clock hours, expiry **pays**), a **bounded freeze** on an in-flight payout (SD-M5-01, same clock, expiry releases), and an **identity restriction** ([ADR-041](../decisions/ADR-041.md), reversible, and where a payout is pending its SLA binds the **restriction** so it cannot outlast the hold's own 48 hours). **Delaying is no longer in this row's title**, because two of the three are delays and pretending otherwise would make this cell the contradiction rather than the boundary |
| Enforcing anything automatically | admin, via [M6](M06-admin-ops-console.md) | Detectors only ever produce `open`. [STATE_MACHINES section 7](../architecture/STATE_MACHINES.md) makes the absence of an automatic path to `enforced` binding |
| Changing a rule | [M1](M01-rules-engine.md) | A detector never alters what the engine computes. If a pattern needs a rule, that is a plan-config change with a published diff |
| Verifying identity documents | M19 | M7 consumes the verification result and the biometric dedupe hit as graph edges |
| Computing P&L or marks | [M2](M02-rithmic-bridge.md) | M7 reads fills and marks. It never derives them |

### 1.3 Invariants

| ID | Invariant | Enforcement |
|---|---|---|
| INV-M7-01 | An identity link is a **signal with a confidence**, never a proof | `confidence_bp` is not null and never 10000 for an inferred edge; only a biometric dedupe hit or an explicit admin merge may exceed a configured ceiling (AS-M7-04) |
| INV-M7-02 | No detector transitions a flag past `open` | Enforced by the writer: the detector service has no grant to write `status` values other than `open`. Not a convention, a permission |
| INV-M7-03 | Every flag carries the numbers behind the accusation, never a bare label | `risk_flags.evidence` is not null and is schema-validated per `flag_type`. A flag with an empty evidence object is rejected at write |
| INV-M7-04 | Every flag names the detector **and its version and parameters as of that run** | SD-M7-03. "Why did this not fire in March" must be answerable from data, and it cannot be if parameters live only in code |
| INV-M7-05 | The account cap is enforced per resolved entity at purchase time, synchronously | [M3](M03-billing-checkout.md) DEP-M3-04. An asynchronous cap is not a cap |
| INV-M7-06 | A merge never deletes an identity and never retroactively closes an account | `identity_merges` is append-only with `accounts_at_merge`; over-cap after a merge is **grandfathered** and new purchases are blocked (B4 #17, GS-046) |
| INV-M7-07 | Every detector run is recorded, including runs that raised nothing, and a run that finds no synthetic canary is a **failure** | SD-M7-01. A broken detector and a quiet one are indistinguishable without this (AS-M7-05) |
| INV-M7-08 | Signals are stored hashed, never raw | Approved DATA_MODEL: `identity_signals.value_hash`. A breach yields hashes and a non-identifying preview fragment |
| INV-M7-09 | A trader may contest a link, and a contested link is visible to the admin who acts on it | SD-M7-04. Entity resolution is inference and inference is sometimes wrong about a person's life (AS-M7-04) |
| INV-M7-10 | Detector parameters never appear in a trader-audience evidence pack | [M06](M06-admin-ops-console.md) SD-M6-04 and AS-M6-01, using SD-M7-03's registry as the strip list |

---

## 2. Entities and schema deltas

M7 consumes [DATA_MODEL sections 3 and 9](../architecture/data-model/README.md) as approved. Five deltas.

| ID | Table | Change | Why it is not optional |
|---|---|---|---|
| SD-M7-01 | `detector_runs` | add `synthetic_expected int not null default 0`, `synthetic_found int not null default 0`, `status` gains `degraded` | INV-M7-07. A detector whose query silently returns nothing (a schema change, a null-handling bug, a threshold that no longer matches the data's shape) looks exactly like a clean night. Seeded synthetic positives are the only way to tell, and their absence must be a **failure state** rather than a metric nobody reads (AS-M7-05) |
| SD-M7-02 | `risk_flags` | add `sla_due_at timestamptz null`, `first_touched_at timestamptz null` | A severity-scored queue with no clock is a queue that grows. Severity 4 and 5 need a stated time-to-first-touch, or detection produces evidence nobody acts on, which is worse than no detection because it is documented negligence |
| SD-M7-03 | new `detector_definitions` | `(detector, version) pk`, `parameters jsonb not null`, `description`, `effective_from`, `effective_to null`, `is_sensitive boolean not null default true` | Three needs at once: INV-M7-04's provenance, [M06](M06-admin-ops-console.md)'s redaction strip list (DEP-M6-03), and the ability to tune a threshold as a **data change with a recorded effective date** rather than a deploy. `is_sensitive` marks the parameters that must never reach a trader |
| SD-M7-04 | `identity_links` | add `disputed_at timestamptz null`, `dispute_note text null`, `suppressed boolean not null default false`, `suppressed_by text null` | INV-M7-09. Two housemates, a married couple sharing a card, and a father funding a son's evaluation all produce genuine edges between genuinely different humans. Without a dispute path the graph's errors are permanent and invisible to the person they harm (AS-M7-04) |
| SD-M7-05 | new `correlation_groups` | `id`, `trading_day`, `member_account_ids uuid[]`, `method text`, `statistic numeric`, `threshold numeric`, `detector_run_id`, `evidence jsonb` | Pairwise correlation is defeated by rotating a third leg (AS-M7-02). Group-level results have no home in a schema built around pairwise `identity_links`, and inventing one at detection time means the result cannot be reviewed, replayed, or explained |

**`identity_restriction_episodes` is deliberately not a row in this table, and it is not an omission.** [`0031`](../../packages/db/migrations/0031_payout_hold_and_identity_restriction.sql) creates it and [DELTA_MANIFEST section 14](../../packages/db/DELTA_MANIFEST.md) records it, so the migration registry has it; what it does not yet have is a **plan-level `SD-` identifier**, and the module that should own one is [M06](M06-admin-ops-console.md), because [ADR-041](../decisions/ADR-041.md) puts the entry point on M06's flags queue and identity drill-down and the episode is an **enforcement record** rather than a detection one (section 1.2: enforcing is not M7's). M06 is [FOLD-02](FOLD-02-enforcement-window-and-suspension.md)'s **session 5**. Taking the next free number in **this** module's series, to avoid a table that looks like it missed something, would put an enforcement table inside the detection module on the strength of a citation, which is the two-owners defect rather than a tidy one. **This module reads the table** (section 3.5 reads `opened_at`) and does not own it.

**And the number is not written out here, deliberately.** `ADR-026`'s completeness gate reads **any** `SD-` identifier appearing anywhere under `docs/` as a claim and demands a manifest row for it, so naming the next free one even to say it is not being claimed **creates the claim the sentence is refusing to make**. Same class as [ADR-042](../decisions/ADR-042.md)'s finding that prose quoting a generated span's literal delimiters becomes a span: **on a registry with a mechanical reader, describing an identifier and claiming it are the same act**, and the only safe way to decline is by position rather than by name.

---

## 3. Detectors and the resolution graph

### 3.1 Entity resolution

Signals, per the approved model: normalized email, device fingerprint, IP and ASN, payment fingerprint, verified KYC identity, and settlement-rail identity. Each is stored hashed with an observation count (INV-M7-08).

**Resolution has three tiers, and conflating them is the mistake.** It had two until [ADR-039](../decisions/ADR-039.md) ruled the verified phone, which fits neither and forced the third.

| Tier | What it does | Signals that qualify |
|---|---|---|
| **Hard merge** | Two identities become one. Caps aggregate. Requires a decision | Biometric dedupe hit from M19, or an explicit admin merge with evidence |
| **Hard link, reviewed** | An edge written at the **hard-link confidence ceiling**. Caps do **not** aggregate and **no state changes automatically**. A **severity-5 flag opens against both identities** | **A verified phone found live on a second identity** ([M19](M19-kyc-identity.md) `INV-M19-13`, ADR-039 (b)). Signals stored on `identity_phones` under `U-07`'s `phone` and `phone_carrier` kinds |
| **Soft link** | An edge with a confidence. Caps do **not** aggregate. Surfaces in the graph and feeds detectors | Shared device, shared payment fingerprint, shared normalized email, shared IP or ASN, and D-15's and D-18's footprint signals |

**Only a hard merge changes what a trader may buy.** A shared IP is a coffee shop; a shared device is a household; a shared card is a family. None of them is a person, and treating them as one is AS-M7-04. What a soft link does is make the cluster **visible**, and visibility is what the detectors and the admin need.

**The middle tier is not a hedge, and it is worth saying why it earns its own row rather than being filed under one of its neighbours.** A verified phone is genuinely stronger than a soft link: real mobile numbers are scarce where emails are free to mint, which is the whole premise of ADR-039, so the edge deserves the hard ceiling. It is genuinely weaker than a merge: **carriers reassign numbers**, so the same edge that catches a fleet operator also catches whoever legitimately inherits their number ninety days later ([M19](M19-kyc-identity.md) AS-M19-09). Filing it under **soft link** would waste the strongest cheap identity signal available. Filing it under **hard merge** would aggregate an innocent person's caps on a carrier's administrative decision. **The third tier is what a signal looks like when it is strong evidence about a number and weak evidence about a human**, and `identity_phones`' deliberately non-unique `phone_hash` index is that distinction expressed in DDL.

**One thing this tier makes visible rather than fixes, recorded rather than resolved.** ADR-039 ruled the phone case in those exact terms, and the corpus's older phrase for the same class does not agree with itself: section 7.9's table says hard links **auto-enforce** and [ADR-029](../decisions/ADR-029.md) says a hard link "bans an account without human review", while the hard-merge row above says "requires a decision" and [M19](M19-kyc-identity.md) `INV-M19-04` says a biometric dedupe hit "raises a flag against both identities and changes no state". **For the phone, ADR-039 settled it. For biometric dedupe, the two readings are still both in the corpus**, and this plan does not extend one ruling's reach by assumption. **OQ-M7-05.**

### 3.2 The detector set

Each detector states its input, its statistic, its threshold, and what it is actually evidence **of**, because a detector whose meaning is unstated becomes a detector whose flags are dismissed.

| ID | Detector | Input | Statistic and threshold | Evidence of |
|---|---|---|---|---|
| D-01 | Fill clustering | `fills` self-join | Two accounts with fills on the same symbol and side within a 2 second window, more than a configured share of both accounts' fills. **Same-identity pairs are filtered at the detector**, not dismissed in the queue (section 3.4) | **Cross-identity copy trading, which is now itself a ToS violation** (section 3.4). This changed at the batch 1 gate: D-01 previously produced flags nobody could act on |
| D-02 | Inverse P&L pair | `daily_marks` | Rolling 20 trading day Pearson correlation of daily realized P&L below the configured floor (dossier: below -0.8), with comparable size | The hedged-pair signature, named in the constitution as the number one industry threat |
| D-03 | **Group inverse exposure** | `daily_marks` across a linked cluster | Sum of daily P&L across an n-account group with variance far below the sum of member variances. Group discovery from `identity_links` plus a candidate search over accounts sharing any signal | AS-M7-02: rings that defeat pairwise correlation by rotating a third leg |
| D-04 | News-window clustering | `fills` plus a maintained Tier-1 economic calendar | Entries within a configured window of a scheduled release, **as a pattern across many events**, never a single event | Straddle farming. The pattern qualifier is load bearing: one trade around a release is a normal trading day |
| D-05 | Martingale sequence | `fills` | Size-after-loss regression at strategy level, over a minimum number of sequences | Eval brute-forcing. Strategy level, never a single sequence |
| D-06 | Velocity anomaly | `daily_marks`, purchases | Win rate, pace to target, and reset velocity against the population distribution | The generic outlier feed; low precision by design, useful only as a group-with signal |
| D-07 | Entity cap aggregation | `identities`, `accounts` | Resolved entity holding more accounts than the plan maximum after a merge | B4 #17. Grandfathered, not enforced retroactively (INV-M7-06) |
| D-08 | Payment velocity | `identity_signals` | Distinct cards or BINs per identity, and identities per payment fingerprint, over a window | Stolen-card evaluation purchasing (dossier item 7) |
| D-09 | Destination concentration | `payout_transfers` | One `destination_ref` receiving payouts from more than one unrelated identity | **The strongest mule detector available** ([M05 AS-M5-02](M05-payout-system.md)), and it is a query rather than an inference |
| D-10 | Affiliate self-deal | attributions | Purchase attributed to a code whose affiliate identity is linked to the buyer | B4 #16, voids attribution and flags |
| D-15 | **Digital-footprint enrichment** | checkout enrichment adapter | Email and phone footprint age and connectedness, device and IP reputation, VPN or datacenter origin, BIN intelligence, from a SEON-class vendor ([ADR-023](../decisions/ADR-023.md)). **Observe mode at launch**, thresholds tuned on beta data, then soft-decline plus review queue. Never a silent decline | A fresh identity with a clean card is invisible to every other detector at checkout, which is the cheapest moment to see it |
| D-16 | **Link-confidence score** | all identity signals | Not a detector so much as the **aggregation of every other one** ([ADR-022](../decisions/ADR-022.md)). Hard links auto-enforce; soft clusters queue a **pre-funding** review. The signal-weight table is config | Asks the question the detector list never asked: how confident are we that these two accounts are one person |
| D-17 | **Behavioral fingerprint against the banned corpus** | `fills`, `daily_marks` | A returning banned operator recognized by how they trade. **Flag-and-review only, never auto-enforce**, and the output must be evidence-grade | **post-launch tier.** Requires a banned corpus, which requires having banned people |
| D-11 | Dilution timing | `rule_states.engine_gates` | Small positive days appearing precisely while consistency is the only failing gate, with an inverse-correlated sibling | [M01 AS-02](M01-rules-engine.md)'s manufactured dilution. Cheap **only** because the engine already stores `profit_needed_to_dilute_cents` |
| **D-12** | **Day-0 graph-prior pairing** | `identity_links`, `identity_signals` | Candidate pairs and groups formed from graph priors **at funding time, with zero trading data**. Output is a watched-cluster set, not a flag: it seeds D-13 and D-14 rather than accusing anyone | The ring that funds and extracts inside one cycle. This is the direct answer to AS-M7-01: a detector that needs history cannot defend the first cycle, so the first cycle is defended by what we knew before it started |
| **D-13** | **Young-account fast path** | `daily_marks`, `fills`, over a **5 trading day** window | Correlation below **-0.95**, **and** size mirroring, **and** timing mirroring. All three, not any of three | The hedged pair, caught inside the extraction window. Deliberately **precise rather than sensitive**: on five days of data a -0.8 threshold is noise, and requiring near-perfect inverse correlation together with mirrored size and timing is what makes a short window usable at all |
| **D-14** | **Clique position-sum** | live and end-of-day positions across a D-12 clique | Summed positions across the clique at or near zero | Third-leg rotation, detected **inside the day** rather than after it closes. Complements D-03 by working on positions rather than realized P&L, and is invariant to which pair carries the hedge, which is exactly what AS-M7-02 defeats in a pairwise detector |
| **D-18** | **Registration phone lookup** | `identity_phones` carrier metadata at capture (`SD-M19-05`), joined to the checkout enrichment D-15 already buys | The **fleet signature** as a **named composite**, defined below, scored by **D-16** and never evaluated as a refusal. **No threshold anywhere refuses a line type**, and no CHECK in `0029` can express one | A fleet at the **earliest** and cheapest moment it is observable. D-15 sees the card and the email at checkout; D-18 sees the number at **registration**, which is upstream of a purchase, and the number is the one signal in the set that a fleet operator cannot mint in bulk for free |

**D-18's fleet signature, stated as a composite because no leg of it means anything alone.** [ADR-039](../decisions/ADR-039.md) (a) names it: **VoIP plus a fresh email plus a datacenter IP plus no digital footprint.** Four legs, all four required.

| Leg | Column | Why it is worthless alone |
|---|---|---|
| VoIP line type | `identity_phones.line_type = 'voip'` | A legitimate customer's only number, in several markets and for most people who moved country. **VoIP is scored, never rejected**, and that is the ruling rather than a tolerance |
| A fresh email | D-15's footprint age | Everybody's email was new once |
| A datacenter or VPN origin | D-15's IP reputation | A privacy-conscious trader, or an office |
| No digital footprint | `identity_phones.footprint_present = false` | A young person, or somebody who is simply not online |

**The one implementation trap, and it is a mass-false-positive trap rather than a missed-detection one.** `footprint_present` and `ported` are **nullable on purpose and the null is not a `false`**. Three-valued because the lookup **fails open**: `null` means "we did not find out", `false` means "the vendor looked and there is none". **A detector written against `IS NOT TRUE` scores every vendor timeout as a fleet member**, which converts a supplier outage into a flood of flags against real customers on the day Merit can least afford it. D-18 tests `footprint_present IS FALSE`, and the difference between those two expressions is the whole reliability of the detector. The same discipline applies to `ported`, which INV-M19-14 reads.

**The call site inherits checkout's failure posture verbatim, and this is not a new decision.** Non-blocking, fail-open on timeout, VoIP scored and never rejected, the same as D-15's. `lookup_provider` and `lookup_at` are recorded on every row for `kyc_verifications.liveness_method`'s reason exactly: an enforcement decided in 2027 on a carrier lookup needs to know whose lookup it was, or a bare value ages into an assertion nobody can re-evaluate.

**D-11 is the clearest example of why the engine's transparency is also a detection asset**, and it is the counter recorded in [M04 AS-M4-01](M04-trader-portal.md): the same number that helps a ring compute its minimum manufactured profit is the number that makes their pattern arithmetic to detect.

### 3.3 Flag lifecycle

The machine is [STATE_MACHINES section 7](../architecture/STATE_MACHINES.md), unchanged. What this plan adds is the clock: severity 4 and 5 flags carry `sla_due_at` (SD-M7-02), and a breached SLA is an alert on [M6](M06-admin-ops-console.md)'s page rather than a number nobody queries.

**Severity is scored, not asserted.** Proposed scale, so it is consistent across detectors rather than per-author:

| Severity | Meaning | Example |
|---|---|---|
| 5 | Money is leaving now and the pattern is strong | D-09 destination concentration, D-03 with a funded member eligible this week |
| 4 | Strong pattern, funded accounts involved, no imminent payout | D-02 below the floor with both accounts funded |
| 3 | Strong pattern, evaluation accounts only | D-01 clustering across evaluations |
| 2 | Weak or ambiguous pattern needing corroboration | D-06 velocity alone |
| 1 | Informational, aggregated in a digest rather than queued | D-04 single-window observations |

**Severity 4 became load-bearing on 2026-08-15 and this is where that is recorded.** `G-HOLD-REQUIRED` ([STATE_MACHINES section 10](../architecture/STATE_MACHINES.md), [ADR-040](../decisions/ADR-040.md)) reads **an unresolved flag of severity 4 or above, in `open` or `investigating`**, and holds the payout request on it. So a number that was a queue-ordering judgment is now a **gate on money**, and three things follow.

- **The band is not new and was not invented for the hold.** Severity 4 and 5 is already the set `SD-M7-02` gives `sla_due_at` to, and already the set `G-EXPIRY-OR-RETRIGGER` reads when it re-triggers KYC on "an open severity 4+ flag". **Reusing the existing band is the point**: a second high-severity threshold, defined elsewhere and drifting, is this repository's most repeated defect.
- **Scoring is now a money-path decision and inherits that discipline.** Moving a detector's output from 3 to 4 changes who gets held, so it is a **data change with a recorded effective date** through `SD-M7-03`, never a deploy, and it is auditable after the fact from `detector_definitions`.
- **The precision floor and the auto-demotion in AS-M7-03 now protect a payout rather than an inbox.** A detector whose precision collapses while sitting at severity 4 holds real payouts for real traders, and **`FM-M7-05`'s automatic demotion to digest severity is what stops that being a policy decision made under pressure.** The demotion is a data change, which means it can happen in the hour rather than the sprint.

**And `OQ-M7-03` is no longer only about an inbox.** It asks the SLA on severity 5 and answers "24 hours still lands before settlement", which was reasoned against a 2 to 3 business day rail. Under [ADR-040](../decisions/ADR-040.md) the same flag now runs a **48 wall-clock hour** clock on Merit, so a 24 hour time-to-first-touch leaves 24 hours to investigate, decide, and export an evidence pack before the request **auto-releases and pays**. That is still the correct outcome when nobody decided, and it is a materially tighter operating window than the question was answered against. The number is not moved here; the changed footing is recorded so the founder is answering the question that now exists.

**The three enforcement shapes, distinguished in one place**, because the fold created the third and two adjacent states are how a control gets applied to the wrong thing:

| Shape | Scope | Clock | Reversal |
|---|---|---|---|
| **Hold** (`held_pending_review`) | **one payment**, before approval | 48 wall-clock hours, **expiry pays** | nothing to reverse; nothing was posted |
| **Freeze** (`frozen`, and the `wallet_withdrawals` halt) | **one payment**, after the ledger moved | 48 wall-clock hours, expiry releases | LT-03 on the internal leg; the external halt just resumes the rail |
| **Restriction** (`identities.status = 'restricted'`) | **one human**, every account they hold | none of its own. Reversed by a **documented restore**, and where a payout is pending its `sla_due_at` binds the restriction so it cannot outlast the hold's 48 hours | `identity_restriction_episodes.restored_at`, `restored_by` and `restore_evidence`, all-or-none |

**Closure for cause is the fourth and it is terminal**, which is why it is not in that table: the three above all end with the trader still holding what they had.

### 3.4 The copy-trading clause, and what it does to D-01

Ruled at the batch 1 gate ([DECISIONS](../decisions/README.md)), closing OQ-M7-01.

| | Status |
|---|---|
| Copy trading **between accounts of the same verified identity** | **Allowed.** A trader running one strategy across their own Merit accounts is doing something the account cap already contemplates and the rules already bound |
| Copy trading **across identities** | **Prohibited** |
| **Third-party signal or copy-trading services** | **Prohibited** |
| **Account management**, meaning one person trading an account belonging to another | **Prohibited** |

**This is the ruling that gives D-01 consequences**, and the effect on the detector is larger than "now we can act on it".

**Same-identity clustering is filtered at the detector, not dismissed in the queue.** That distinction matters operationally. A trader with five accounts running one strategy generates near-perfect same-second clustering across all ten pairs, every day, forever. Under the old design each of those was a technically correct flag that an operator had to open and dismiss, which is [AS-M7-03](#as-m7-03-poisoning-the-queue-with-false-positives-novel)'s attention attack arriving without an attacker. **Removing it at the query removes the single largest source of benign noise from this module's most-fired detector**, and it does so on a rule rather than a heuristic, which is why it is safe to do at the query rather than in review.

**Cross-identity copy is now a violation in its own right**, which changes what the flag has to prove. Previously D-01's output was evidence toward some other conclusion, usually coordinated hedging, and the flag's strength rested on a statistical argument. Now the conduct **is** the violation, so the evidence is the conduct: these fills, on these accounts, held by these two identities, at these timestamps, against this ToS clause. That is exactly the form [AS-M7-07](#as-m7-07-enforcement-contested-in-public-extends-dossier-item-5) says survives a public argument, and it discloses no threshold.

**The legal dependency is now specific rather than open.** DEP-M7-05 previously asked for clauses "covering coordinated trading, common control, and copy trading", which is not a standard anyone can comply with. The clause is now enumerable in the four rows above, and it is filed as a drafting note in [legal/](../legal/README.md).

### 3.5 Portability history wired to the recycling decision, and the delta that turned out not to exist

[ADR-039](../decisions/ADR-039.md) amendment 3 is M19's invariant ([`INV-M19-14`](M19-kyc-identity.md)) and M7's obligation. **Carriers reassign numbers**, so the phone edge that binds a fleet operator also binds whoever legitimately inherits their number, and the guard's whole job is to tell those two apart: **reassignment after the linked identity's restriction date means it is not the same node.** M19 owns the decision. M7 owns what the graph does with the answer, which is the half that actually stops an innocent person being enforced against.

**The wiring, by the question the guard asks, because "wire it up" is not a specification.**

| Question | Where the answer lives | What put it there |
|---|---|---|
| Was this number ported, and when | `identity_phones.ported`, `identity_phones.last_ported_at` | `SD-M19-05`, [`0029`](../../packages/db/migrations/0029_phone_identity_and_auth.sql) |
| When was the prior holder restricted | `identity_restriction_episodes.opened_at` | [`0031`](../../packages/db/migrations/0031_payout_hold_and_identity_restriction.sql), [ADR-041](../decisions/ADR-041.md). One row per restriction of one human, which is why a repeat restriction does not overwrite the date this guard reads |
| Is this number live on somebody else **right now** | `identity_phones_live_number_idx`, **deliberately not unique** | `SD-M19-05` |
| Has it **ever** been held, including by an identity now banned | `identity_phones_history_idx (phone_hash, created_at desc)` | `SD-M19-05`. A different question from the one above, and the guard needs the history rather than the live set, because the whole point is that the prior holder is gone |
| Record the release | `identity_phones.released_at`, `release_evidence`, refused when empty by `identity_phones_release_is_evidenced` | `SD-M19-05` |
| Stop the phone edge contributing to enforcement | `identity_links.suppressed`, `identity_links.suppressed_by`, read through `identity_links_live_idx` | **`SD-M7-04`**, `0002`. Written through the `SECURITY DEFINER` function that arrives with this module, never by the application role |
| Keep the edge as history anyway | `identity_links` is append-only and the edge is **never deleted** | `SD-M7-04`. "We decided this edge was wrong" is itself evidence, which is the same reason the dispute path never deletes |

**The finding, and it is a finding rather than an omission.** [FOLD-01 section 6.1](FOLD-01-phone-identity.md) promised this module "the M7 delta wiring portability history to the recycling decision". **There is no such delta and there should not be.** Section 4 of that same plan enumerates nine schema changes and **not one of them is M7's**; session 3 wrote `0029` against that list and it contains no M7 change. Every input and every output the decision needs already exists: five from `SD-M19-05` in that very migration, and the suppression pair from `SD-M7-04`, which has been in `0002` since the schema-delta reconciliation and was written for AS-M7-04's housemates. `identity_links.link_kind` is `text NOT NULL` with **no CHECK constraint**, so the phone edge needs a vocabulary value rather than a migration, and that value is claimed with the `identity_links` data-model row rather than here.

**So no delta identifier is claimed**, for the reason [FOLD-01 section 4](FOLD-01-phone-identity.md) already records against its own first draft: **only ADR numbers and migration numbers have an allocation table**, a delta is claimed by its `DELTA_MANIFEST` row existing, and writing one into a plan first is pre-claiming in a registry with no claim mechanism. Inventing a number for a change with nothing in it would be worse than pre-claiming: it would be a **deferred delta that a later session has to open, read, and discover is empty**, which is the same defect as a stale count with a migration attached. The prose in section 6.1 was a reasonable expectation at plan time and the migration is the primary source. **The primary source wins.**

---

## 4. API endpoints touched

M7 owns no public endpoint and adds none. It supplies [API_CONTRACT section 8](../architecture/API_CONTRACT.md)'s `GET /admin/flags`, `POST /admin/flags/:id/status`, and `GET /admin/identities/:id/graph`, and it is a **synchronous** dependency of `POST /checkout` for cap enforcement (INV-M7-05, DEP-M3-04).

Two obligations. The graph endpoint returns `confidence_bp` and the evidence on every edge, never a bare adjacency, because an admin acting on a cluster must be able to see why it is a cluster. And the resolver call inside checkout has a **hard timeout with a fail-closed default**: if resolution cannot complete, the purchase is refused rather than allowed, because an unresolved buyer is exactly the fleet case the cap exists for.

---

## 5. Events emitted and consumed

Emitted per [EVENTS section 8](../architecture/EVENTS.md), plus three NEW.

| Event | When | Notes |
|---|---|---|
| `flag.raised` | detector | Severity 4 and above alerts. Carries `detector`, `detector_version`, and `evidence_summary` |
| `flag.status_changed`, `enforcement.applied` | admin, via M6 | |
| `identity.merged` | hard merge | Carries `accounts_at_merge`, which is what the grandfather policy reads |
| `detector.run_degraded` **NEW** | SD-M7-01 | `{ detector, detector_version, trading_day, synthetic_expected, synthetic_found, rows_scanned }`. A detector that found none of its own canaries is broken, and this is the only way anyone learns (AS-M7-05). Consumers: ALERT (page), FEED |
| `identity.link_disputed` **NEW** | trader contests | `{ link_id, identity_a, identity_b, link_kind, note }`. Consumers: FEED, and it renders on the graph so an admin sees the dispute before acting (AS-M7-04) |
| `risk.group_detected` **NEW** | D-03 | `{ correlation_group_id, member_account_ids, statistic, threshold, method }`. Group findings have no pairwise event to ride on. Consumers: ALERT, FEED, EVID |

**Consumed:** `purchase.paid` and `checkout.started` (resolution), `day.closed` (D-02, D-03, D-06, D-11), fill ingestion (D-01, D-04, D-05), `payout.approved` and `payout.name_mismatch_detected` (D-09), `kyc.verified` with its dedupe hit (hard merge), and `attribution.recorded` (D-10).

---

## 6. Failure modes

| ID | Failure | Blast radius | Detection | Recovery |
|---|---|---|---|---|
| FM-M7-01 | A detector silently stops firing | Detection appears healthy and is absent. **The worst failure in this module**, because everything downstream reads a green dashboard | Seeded synthetic positives per detector per run (SD-M7-01) | `detector.run_degraded` pages. A run that finds none of its canaries is `degraded`, never `ok` (AS-M7-05) |
| FM-M7-02 | Over-merge collapses two real humans | A legitimate trader loses purchasing capacity, or is enforced against for someone else's behavior | Two-tier resolution (section 3.1) plus the dispute path (SD-M7-04) | Only a biometric hit or an admin decision merges. Soft links never aggregate caps (AS-M7-04) |
| FM-M7-03 | Under-merge misses a fleet | Twenty accounts under one operator beat a per-entity cap of ten | Biometric dedupe at M19 is the fleet-killer; device and payment graphs are the second line | Accepted residual, bounded by caps and the ladder. The dossier is explicit that no single-firm graph catches everything |
| FM-M7-04 | Flag queue grows unworked | Documented evidence of abuse with no action, which is worse than no detection in a dispute | `sla_due_at` and time-to-first-touch on the M6 page | Severity 1 goes to a digest rather than the queue, so the queue only ever holds actionable items |
| FM-M7-05 | False positives train the operator to dismiss | The queue becomes noise and a real ring is dismissed with it | Per-detector precision tracked as a first-class metric | A detector below a precision floor is demoted to digest severity, as a **data** change (SD-M7-03), not a deploy |
| FM-M7-06 | Detector parameters leak to an adversary | Detection becomes evadable, permanently, for everyone | `is_sensitive` on SD-M7-03, enforced by M6's redaction profile | AS-M6-01. This is a cross-module control and neither half works alone |
| FM-M7-07 | Resolver unavailable at checkout | Either sales stop or the cap silently stops being enforced | Hard timeout, fail closed | Refuse the purchase. A brief sales outage is recoverable; an unenforced cap during it is not (INV-M7-05) |
| FM-M7-08 | Tier-1 calendar stale | D-04 fires on the wrong windows or not at all | Calendar freshness is itself a monitored data dependency, like `contract_specs` and `trading_calendar` | Maintained as data with a staleness alarm |
| FM-M7-09 | Detection lands after the money is gone | The ring extracts and leaves; the flag documents a loss | The day-3 arithmetic in AS-M7-01 | Detection cadence is designed against the extraction timeline, not against convenience |
| FM-M7-10 | An enforcement is contested publicly and the evidence does not hold | Merit loses the argument even when it is right, which is the specific outcome the evidence pack exists to prevent | Evidence schema per flag type (INV-M7-03); every enforcement requires an exported pack | The pack shows the account's own facts and the rules applied. Enforcement rests on behavior, never on a threshold |

---

## 7. Adversarial scenarios

**Seven listed, five novel.** The two marked "extends" take dossier items into places that changed this module's design.

### AS-M7-01: Detection cadence versus extraction speed, computed (NOVEL)

**Attack.** B4 #21 requires that a six-account hedged syndicate be flagged **by day 3**. That number has never been checked against how fast the money can actually leave. If extraction beats detection, every detector in this document is a forensic tool rather than a control.

**The arithmetic, from [M01 AS-03](M01-rules-engine.md).** On CORE-50K the minimum-variance path to a first full-cap payout is **5 trading days** (five days at 50,000c, clearing buffer plus cap, best-day share 2000bp, five win days, five traded days). Settlement is 2 to 3 business days after that. So the earliest cash leaves Merit is roughly **trading day 7 to 8** from funding.

**So detection at day 3 wins, but the margin is thinner than it looks**, and three things eat it:
- D-02's rolling correlation needs a **20 day window**. On a 5 day life it has almost no data. A ring that funds, extracts once, and abandons every account never generates enough history for the flagship detector to see, which means **the flagship detector does not defend the first cycle at all**.
- Direct plans have no evaluation, so funding is immediate and the clock starts at purchase.
- The detector runs nightly, so "day 3" is really "the night after day 3".

**Counter, and it changed the detector set.**
1. **D-01 (fill clustering) and D-03 (group exposure) must operate on short windows**, from day 1, because they are pattern detectors rather than statistical ones and do not need 20 days. D-02 keeps its long window and is explicitly labelled a **second-cycle** detector: it catches persistence, not entry.
2. **On-ingest detection, not only nightly, for D-01.** Same-second fill clustering is computable the moment fills land and does not need to wait for a batch.
3. **The strongest early control is not a detector at all.** It is M19's biometric dedupe at funding, which fires before the first trade, and the [M01 AS-09](M01-rules-engine.md) identity-level forecast, which makes a correlated cluster visible before it is eligible.
4. **The honest bound**, which the founder should carry: a single-cycle, abandon-after-extraction ring on Direct plans is bounded by the cap and the buffer, not by detection. Per account that is 135,000c to the trader against a purchase price, and the counter is the entry cost plus verification, not the detector.

**What the batch 1 gate added, and it addresses this scenario directly.** Three detectors now attack the first cycle rather than the second. **D-12** forms candidate clusters from graph priors **at funding, before a single fill exists**, so a ring is watched from day 0 rather than discovered on day 20. **D-13** runs a 5 trading day window at deliberately tightened thresholds (correlation below -0.95 plus size and timing mirroring), which is short enough to land inside the extraction window and precise enough that a five-day sample does not generate noise. **D-14** detects clique position sums near zero **inside the day**, which needs no history at all.

**The margin is materially better and the residual is unchanged in kind.** A ring with genuinely clean separation produces no D-12 candidate set, and D-13 and D-14 both operate on D-12's clusters. The first cycle is now defended against rings that share any signal, which is most of them, and undefended against rings that share none, which is the same residual as AS-M7-06 and has the same answer: bounded by caps, priced into the reserve.

**And the extraction timeline itself moved under this scenario's feet.** [ADR-018](../decisions/ADR-018.md) and [ADR-019](../decisions/ADR-019.md) shortened the minimum path: Core EOD's cycle is now 5 trading days and Merit Rapid's is 3, and under the wallet a payout reaches the trader's Merit balance the **same day** it is approved. The external withdrawal still takes 2 to 3 business days, so cash still leaves on roughly the old clock, but **the arithmetic in this scenario must be re-run against the new cycle lengths rather than the ones above**, and D-13's 5 day window is now the same length as Core EOD's entire cycle rather than comfortably inside it. GS-118 is re-pinned accordingly.

GS-118.

### AS-M7-02: The third leg that defeats pairwise correlation (NOVEL)

**Attack.** D-02 looks for a rolling correlation below -0.8 between two accounts' daily P&L. A ring that knows this (and the threshold is industry folklore, so assume they do) uses **three** accounts and rotates which two carry the hedge. Account A is long, B is short on Monday and Wednesday, C is short on Tuesday and Thursday. Every **pair** correlates at roughly -0.5, comfortably inside the threshold. The **group** is flat.

**Numbers.** With three legs and random rotation, pairwise correlation falls by roughly the share of days each pair is actually paired, so a -0.9 two-account signature becomes about -0.45 across three, and about -0.3 across four. Adding legs costs the ring one evaluation fee each and defeats a pairwise detector completely.

**Counter.** D-03 detects at **group** level: for a candidate group, compare the variance of the summed daily P&L against the sum of the members' variances. A genuinely independent group has a summed variance near the sum of the parts; a hedged group has summed variance far **below** it, and that ratio is invariant to how the ring rotates its legs. Candidate groups come from `identity_links` clusters and from accounts sharing any signal, with a bounded search size so the cost stays linear. Results land in `correlation_groups` (SD-M7-05) so a group finding can be reviewed and replayed rather than recomputed from memory.

**Residual.** A ring with no shared signal at all (separate devices, separate cards, separate IPs, separate verified humans) produces no candidate group and is invisible to D-03. That is the same residual as the cross-firm case (AS-M7-06) and the same answer: bounded by caps, priced into the reserve. GS-119.

### AS-M7-03: Poisoning the queue with false positives (NOVEL)

**Attack.** Detection has a scarce resource: the founder's attention. An adversary who understands the detector set can manufacture **benign-looking traffic that trips it on innocent traders.** Trade a popular public signal service from a widely used VPN exit and dozens of unrelated accounts cluster on D-01. Post a "free copy signals" offer in a Discord and produce genuine same-second fills across strangers. The queue fills with real detections about innocent people, the operator learns that D-01 means nothing, and the actual ring runs underneath it.

**Why it nearly works.** Every flag is technically correct. The detector did its job. The failure is entirely in the economics of attention, which no detector measures.

**Counter, three parts.**
1. **Per-detector precision is a tracked metric** (FM-M7-05), computed from admin dispositions. A detector whose precision collapses is **demoted to digest severity automatically**, as a data change through SD-M7-03, without a deploy and without a human deciding to ignore it.
2. **Severity is contextual, not per-detector.** D-01 across evaluations is severity 3; the same pattern with a funded member eligible this week is severity 5. Manufactured noise lands almost entirely in the low bands, since the adversary cannot easily push strangers into funded eligibility.
3. **Corroboration outranks any single detector.** The queue sorts by the number of **independent** detector families implicated on an identity, not by raw flag count. One family firing loudly is one signal; three families agreeing is a case. This also means poisoning one detector does not move an identity up the queue.

GS-120.

### AS-M7-04: The graph that punishes a family (NOVEL)

**Attack.** No adversary. A father funds his son's evaluation with his card. A married couple share a laptop. Two students in one dorm share an IP and an ASN. Every one of those produces exactly the signals the dossier lists for a fleet, and an over-eager resolver merges them into a single entity, aggregates their caps, and one day enforces against all of them for one member's behavior. The cost of over-merging is borne by people who did nothing wrong, and they have no visibility into why.

**Why it is worth as much attention as the ring.** A firm that wrongly restricts a real trader creates exactly the review-page content that kills firms, and unlike a ring, the wronged trader is sympathetic, articulate, and telling the truth.

**Counter.**
1. **Two tiers** (section 3.1). Only a biometric dedupe hit or an explicit admin merge with evidence aggregates caps. Shared device, IP, ASN, and payment produce **soft links** that make the cluster visible and change nothing a trader may do.
2. **`confidence_bp` is never 10000 on an inferred edge** (INV-M7-01). The graph's own schema refuses to express certainty it does not have.
3. **A dispute path** (SD-M7-04). A trader who is told their account is linked can contest it, the dispute renders on the graph, and an admin sees it **before** acting rather than after. This is the control that stops an inference error from being permanent.
4. **Enforcement is always per behavior, never per edge.** An edge is a reason to look. It is never the evidence.

GS-121.

### AS-M7-05: The detector that quietly stopped working (NOVEL)

**Attack.** Nobody. A schema change renames a column, a null-handling path swallows a case, a threshold stops matching the data's shape after a plan config changes, or a query that used to scan 200,000 rows now scans zero because a join condition drifted. `detector_runs` records `status: ok`, `rows_scanned: 0`, `flags_raised: 0`. **That is indistinguishable from a genuinely quiet night**, and quiet nights are the normal case, so nobody looks.

**Why it is the worst failure here.** Every other failure in this module is visible to someone. This one makes the whole system report health while providing nothing, for months, and it is discovered when a ring that should have been flagged is not.

**Counter.** **Seeded synthetic positives.** Each detector's nightly run includes a small set of synthetic subjects, flagged `is_synthetic`, constructed to trip exactly that detector: a hedged pair with correlation -0.95, a same-second fill cluster, a martingale sequence, a destination shared by two identities. The run asserts it found them (SD-M7-01). A run that finds fewer than expected is `degraded` and emits `detector.run_degraded`, which **pages**.

Two implementation notes that make or break it. The synthetic subjects must be **excluded from every aggregate, statistic, and published number** (the same `is_synthetic` discipline [M02 OQ-M2-01](M02-rithmic-bridge.md) proposes for simulator accounts), enforced by a CI test over aggregate queries. And they must be **regenerated per run rather than static**, or a detector that has memorized them passes while broken for real data.

GS-122.

### AS-M7-06: Cross-firm hedging (extends dossier item 2)

**Attack.** Long at Merit, short at another firm. Invisible to any single firm's data by construction. The dossier's own conclusion is "accept, bound, budget".

**Counter, which is honest rather than clever.** Nothing in M7 detects this and nothing will. What bounds it is already built: the per-request cap, the [consistency](../GLOSSARY.md#funded-consistency) gate that forces multi-day extraction, the cadence gap, and the **5-payout ladder** that bounds lifetime extraction per account (INV-17, [ADR-024](../decisions/ADR-024.md)). What prices it is the reserve. What could eventually detect it is a shared-vendor risk network, which the flag schema already accommodates through `risk_flags.source` accepting `vendor:<name>` without a migration.

**The one thing M7 owes here is not pretending.** The metric that matters is the share of realized payout liability attributable to accounts with **no** internal ring signal, tracked over time. If that share climbs, cross-firm activity is growing and the reserve assumption needs revisiting. Nobody can detect the scheme; anyone can watch its footprint.

### AS-M7-07: Enforcement contested in public (extends dossier item 5)

**Attack.** The juicing community contests enforcement loudly and forensically, and does it on a platform where Merit's reply is read by prospective customers. A ring member enforced against posts a partial, selectively edited account and demands Merit prove its case, knowing that a firm that reveals its detection method loses the method and a firm that says nothing looks guilty.

**Counter.** The [evidence pack](../GLOSSARY.md#evidence-pack) with the `trader` audience profile ([M06](M06-admin-ops-console.md) SD-M6-04), plus one discipline that has to be decided **before** the first case rather than during it: **enforcement rests on behavior described in the ToS, never on a threshold.** "Accounts under common control traded in coordinated opposition" is a ToS clause and is provable from fills the trader already has. "Your correlation was -0.87 against a -0.80 threshold" is a number that invites an argument about the number and publishes the threshold in the same breath.

The pack gives the trader every fill, mark, rule state, and gate result of their own account, plus the rule text that applied. That is a complete answer to "show your work" that discloses nothing about how the pattern was found.

---

## 7.9 Link-confidence scoring, and the tiers it ships in

[ADR-022](../decisions/ADR-022.md), folded here because it changes what this module *is*: a set of independent detectors becomes a **scored identity graph**, and enforcement grades by confidence rather than by which detector happened to fire.

| Link class | Signals | Behavior |
|---|---|---|
| **Hard** | Biometric dedupe hit ([M19](M19-kyc-identity.md) SD-M19-04), same payout destination (D-09), same payment fingerprint (D-08), a `confirmed_same_person` disposition | **Auto-enforce.** These are facts, not inferences |
| **Hard, reviewed** | **A verified phone live on a second identity** ([M19](M19-kyc-identity.md) `INV-M19-13`, [ADR-039](../decisions/ADR-039.md) (b)) | **The edge is written at the hard-link confidence ceiling and a severity-5 flag opens against both identities. No state changes automatically** |
| **Soft** | Shared device or IP, behavioral similarity, timing correlation, shared address components, D-15's and D-18's footprint signals | **Queue a pre-funding review.** Never auto-enforce |

**The middle row is [ADR-039](../decisions/ADR-039.md)'s ruling and it is section 3.1's third tier seen from the confidence side.** A verified phone earns the hard ceiling because real mobile numbers are scarce where emails are free to mint, and it cannot earn auto-enforcement because **carriers reassign numbers**: the guard in section 3.5 needs time to run, and a refusal at the door happens before it can. That is also why `identity_phones` has a unique index on `identity_id` and **deliberately none on `phone_hash`**.

**And it is the row that makes an older ambiguity visible.** "Auto-enforce" in the row above it means, per [ADR-029](../decisions/ADR-029.md), "bans an account without human review"; [M19](M19-kyc-identity.md)'s `INV-M19-04` says a biometric dedupe hit "raises a flag against both identities and changes no state", and section 3.1's hard-merge tier says it "requires a decision". **Those are not the same behaviour.** ADR-039 settled it for the phone in exactly the words above. It is unsettled for biometric dedupe, and this plan records that rather than assuming one ruling reaches the other. **OQ-M7-05.**

**The review is pre-funding, and the timing is the point.** A soft cluster caught before an account is funded costs a review. The same cluster caught at payout costs a dispute, an evidence pack, and a trader who earned money and is being told to wait. [M07 AS-M7-01](#) established that the minimum extraction path is short; the corollary is that identity review has to happen upstream of funding or it happens too late to be cheap.

**Two supporting changes:**
- **Honest-baseline anomaly scoring.** Anomaly is measured against the **honest population's** distribution, not the whole population's, because a population containing the fleet normalizes the fleet. Same reasoning as the [consistency denominator rule](../GLOSSARY.md#consistency-denominator-rule), applied to detection.
- **The signal-weight table is configuration**, tuned through a reviewed diff. Weights are the detector internals that [M06](M06-admin-ops-console.md)'s two-tier evidence packs keep **internal-tier always**, and the richer the graph the more a leak is worth.

**Shipping tiers, forced by data availability rather than by ambition:**

| Tier | Contents | Why then |
|---|---|---|
| **v1** | Hard links plus KYC dedupe | They are facts and need no tuning |
| **v1.x** | Probabilistic scoring, the signal-weight table, [M06](M06-admin-ops-console.md)'s graph explorer | Weights tuned on no data are guesses wearing a number |
| **post-launch** | D-17 behavioral fingerprinting | A fingerprint corpus with three members is a false-positive engine |

**Golden scenarios are required per tier**, so a defense promoted upward arrives with the fixture proving it does what the tier above assumed. GS-235 to GS-238, plus GS-239 for D-15's fail-open behavior.

**The framing that makes these comparable: identity replacement cost.** The measure of an identity defense is not how many fakes it catches but **what a fresh usable identity costs the adversary**. Biometric dedupe is expensive to defeat; an email-domain heuristic is free. Scoring every control on that one axis is what the [dossier](../../research/ADVERSARY_DOSSIER.md) now does, and it is the only way to compare a $2 provider call against a detector.

## 8. Test plan

| Suite | Prefix | Count | Runs | Blocks |
|---|---|---|---|---|
| Detector unit tests, each against a hand-built positive and a hand-built near-miss | `M7-D-nn` | **two per detector in section 3.2** | every commit | merge |
| Resolution tests (soft link versus hard merge, per signal kind) | `M7-R-nn` | 12 | every commit | merge |
| Precision harness over a labelled fixture population | `M7-P-nn` | 1 per detector | nightly | nightly alarm |
| Synthetic canary integration | `M7-S-nn` | 1 per detector | every run, in prod | **page** in prod |
| Ring rehearsal, six accounts end to end | `M7-G-01` | 1 | nightly | nightly alarm |
| Golden fixtures | `GS-nnn` | 5 owned (GS-118 to GS-122), plus GS-046, GS-050, GS-054, GS-060, GS-062 shared | every commit | merge |

**Every detector needs a near-miss fixture, not only a positive.** A detector tested only against a case that should fire proves nothing about its threshold, and threshold errors are how a detector becomes either noise or nothing.

**D-18's near-miss fixture is named here because it is the one a reader would build wrong.** The positive is the four-leg fleet signature. The near-miss is **a vendor timeout**: `line_type = 'unknown'`, `footprint_present IS NULL`, everything else identical. It must **not** fire, and a detector written against `footprint_present IS NOT TRUE` fires on it. That fixture is the difference between a supplier outage and a flood of flags against real customers.

**The count in this table was a number and is now the rule that produces it.** It read "22, two per detector" against a section 3.2 that has held more than eleven detectors since the batch 1 gate added D-12 to D-14 and D-15 to D-17, and this session's D-18 would have made it wrong by one more. [ADR-034](../decisions/ADR-034.md)'s remedy is to generate the number or delete it and point at the source; there is no CI span for a test count, so this is the second. Same class as the counts [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md) section 4a records, and it is not tallied there for the reason that section gives: the tally of hand-maintained counts is itself a hand-maintained count.

### 8.1 Named scenarios owned by this module

| ID | Scenario | Pins |
|---|---|---|
| GS-118 | Detection cadence beats extraction on the minimum-variance path | A six-account ring on the 5 trading day path is flagged by D-01 and D-03 before the first settlement lands, and D-02 is asserted **not** to have fired, because its 20 day window has no data yet. AS-M7-01 |
| GS-119 | Three-leg rotation defeats pairwise correlation and not group variance | Every pair sits inside the D-02 threshold; D-03's variance ratio fires. AS-M7-02 |
| GS-120 | Queue ordering under manufactured noise | Fifty innocent D-01 clusters do not outrank one identity with three independent detector families implicated, and a detector whose precision collapses is auto-demoted to digest severity. AS-M7-03 |
| GS-121 | Household signals produce a soft link and never a merge | Shared IP, shared device, and shared card across two identities produce edges with confidence below the ceiling, caps do **not** aggregate, and a disputed link renders on the graph before an admin acts. AS-M7-04 |
| GS-122 | Detector run that finds none of its canaries | Status `degraded`, `detector.run_degraded` emitted, page fired. Synthetic subjects are excluded from every aggregate and are regenerated per run. AS-M7-05 |

---

## 9. Observability

| Metric | Why it matters |
|---|---|
| `detector.precision` per detector, from admin dispositions | AS-M7-03. The number that decides whether a detector stays in the queue |
| `detector.synthetic_found` versus expected, per run | AS-M7-05. Should be exact; anything less pages |
| `flags.open` by severity, and time-to-first-touch on 4 and 5 | A queue nobody works is documented negligence |
| `flags.corroboration_depth` distribution | How often multiple families agree, which is the queue's real ordering signal |
| `identity.links_created` and `links_disputed` | A rising dispute rate means the resolver is over-linking |
| `identity.merges` and merges reversed | A reversed merge is a resolver error with a human cost |
| `risk.groups_detected` and group size distribution | D-03's yield, and the early warning for AS-M7-02 in the wild |
| `payout_liability_share_with_no_ring_signal` | AS-M7-06's footprint metric. The only number that tracks a scheme nobody can detect |

**Alerts:** any `detector.run_degraded` pages. Severity 5 flag raised alerts immediately. SLA breach on severity 4 or 5 alerts. Precision falling below its floor warns and auto-demotes. A merge that aggregates caps alerts, because it changes what a human may buy.

---

## 10. Open questions for the founder

**OQ-M7-01 (RULED, 2026-08-14). Is copy trading allowed?** **The recommendation was accepted and extended.** Permitted between accounts of the same verified identity; prohibited across identities; and additionally prohibited through **third-party signal or copy services** and through **account management**. The extension matters: without it, a ring could route coordination through a nominally independent signal service and satisfy the letter of a same-identity rule. **Cross-identity copy is now itself a violation** rather than evidence toward one, which is what gives D-01 consequences. See section 3.4.

**OQ-M7-02. Detector thresholds at launch, with no data.** Every threshold in section 3.2 is currently a number from the dossier or from judgment. The honest position is that they will all be wrong at launch and the question is which way to be wrong. Recommendation: **tune for recall over precision during beta**, with everything above severity 3 going to the digest rather than the queue, then tighten from labelled dispositions. Beta is when a false positive is cheapest and a missed ring is most instructive.

**OQ-M7-03. What is the SLA on severity 5?** Proposed: **4 hours to first touch during business hours, 24 hours otherwise.** Money can leave in 2 to 3 business days, so 24 hours still lands before settlement. Anything longer means the flag documents a loss rather than preventing one.

**OQ-M7-04. Do we tell a trader they are linked?** SD-M7-04's dispute path requires that they can find out. Telling them also tells a ring which signal we resolved on, which is a real cost. Recommendation: **tell them the fact and not the signal**: "this account is associated with another account under our terms", with a contest route. That preserves the dispute path and discloses nothing about the graph.

**OQ-M7-05 (NEW, raised by [FOLD-01](FOLD-01-phone-identity.md) session 4). Does "hard link" mean auto-enforce, or does it mean a flag against both and no state change?** The corpus currently answers both. Section 7.9's hard row and [ADR-029](../decisions/ADR-029.md) say auto-enforce, explicitly "bans an account without human review". Section 3.1's hard-merge tier says "requires a decision", and [M19](M19-kyc-identity.md) `INV-M19-04` says a biometric dedupe hit raises a flag against both identities and changes no state. **[ADR-039](../decisions/ADR-039.md) ruled the phone case** and gave it the flag-and-review behaviour, which is now section 3.1's third tier, and it ruled **only** the phone case. Recommendation: **settle it the same way for biometric dedupe, in an ADR rather than by inheritance.** The argument that decided the phone applies with almost the same force to a face: FM-M19-02 and AS-M19-05 establish that dedupe produces false matches on siblings, twins, poor captures and at demographically uneven rates, so the population an auto-ban would hit wrongly is the same sympathetic population AS-M7-04 protects. **The counter-argument is real and belongs in the ruling**: a face is not reassigned by a carrier, so the phone's specific rescue mechanism has no analogue, and "hard links auto-enforce" is load bearing in ADR-022's economics. **Not settled here.** One ruling's words are not evidence about another signal, and the whole reason this question exists is that a phrase was reused without being re-derived.

---

### Dependencies on other modules

| ID | Dependency | Owner | Consequence if unmet |
|---|---|---|---|
| DEP-M7-01 | M2 supplies fill-level data | M2, contingent on **V-M2-11** | D-01, D-04, and D-05 are impossible. The strongest detector family in this module depends on an unconfirmed vendor assumption |
| DEP-M7-02 | M19 supplies biometric dedupe hits as the only automatic hard-merge signal | M19 | AS-M7-01's earliest control disappears and fleets are caught only after they trade |
| DEP-M7-03 | M6 renders the queue with SLA and corroboration ordering, and enforces redaction | M6 | Detection produces evidence nobody acts on, and AS-M6-01 discloses thresholds |
| DEP-M7-04 | M5 supplies `destination_ref` reuse across identities | M5 | D-09, the strongest mule detector, has no input |
| DEP-M7-05 | Legal supplies ToS clauses covering coordinated trading, common control, and copy trading. **The copy-trading clause is now specified** (section 3.4) and is filed as a drafting note in [legal/](../legal/README.md); the coordinated-trading and common-control clauses remain open | Wave 4 legal | Enforcement has nothing to cite, and AS-M7-07 becomes unwinnable in public |
| DEP-M7-06 | A maintained Tier-1 economic calendar, as data | M6 admin, seed | D-04 fires on the wrong windows |
