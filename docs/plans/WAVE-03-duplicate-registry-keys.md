---
status: approved
depends_on: [../STATE.md, ../decisions/ALLOCATION.md, ../architecture/STATE_MACHINES.md, ../testing/STRATEGY.md, WAVE-01-post-freeze-parallel-sessions.md]
last_updated: 2026-08-20
---

# WAVE-03: the duplicate registry keys, nine sessions, five of them concurrent

**A wave plan, not a module plan.** It carries no ruling and no design. It is the
allocation table and the prompt set for the sessions that repair what `CI-06u` found and
did not touch, written so a prompt is pasted into a fresh session and a pull request is
read, rather than anything being composed.

**Every number this wave spends is reserved in [ALLOCATION](../decisions/ALLOCATION.md) in
one commit before any session starts.** `CI-06f` asserts gaplessness over allocated plus
reserved, so three numbers handed to three sessions without reservation fail the first to
commit, for all three. This repository has done that twice, at `044` and again at
`053`/`054`/`055`.

**Every claim below was checked against the tree rather than against the record that
proposed it, and five did not survive that check.** They are in section 1 so the next
reader does not re-derive them.

---

## 1. Five claims in the record that the tree refutes

| Claim as written | What the tree says | Where it is written |
|---|---|---|
| **105 duplicate keys** | `node scripts/corpus/gates.mjs check` prints **`106 known duplicate key(s) registered across 8 file(s)`**. The register's `sessions/README` list holds **59** keys, not 58 | [`gates.mjs`](../../scripts/corpus/gates.mjs) at four sites, [STATE](../STATE.md), [STRATEGY](../testing/STRATEGY.md), and [session 75](../sessions/2026-08-19-session-75.md) |
| **`G-ELIGIBLE` at lines 405 and 408** | [STATE_MACHINES](../architecture/STATE_MACHINES.md) **:403 and :406**. Lines 405 and 408 are `G-NO-IN-FLIGHT`. Verified unmoved since the `CI-06u` commit | `gates.mjs:3749`, session 75, and the brief that commissioned this plan |
| **A `suspended` identity separates the two predicates** | **No `suspended` value exists.** [`0001`](../../packages/db/migrations/0001_extensions_and_enums.sql):27 is `identity_status AS ENUM ('active','restricted','closed')`, and [ADR-041](../decisions/ADR-041.md) **refused** to add one. The witness is **`closed`** | The brief, and every restatement of it |
| **ALLOCATION's `r` rows are byte-identical but for one link, so the dedupe reached one** | Both rows stand on `main` at :151 and :153 and differ by a whole parenthetical clause. The dedupe reached neither. They are invisible for an unrelated reason, in section 2 | `gates.mjs:3876`, session 75's landmines |
| **`OI-10` deduplicated 2026-08-16** | `CI-06, corpus integrity` heads **four** rows of [STATE](../STATE.md) today, at :1279, :1283, :1292 and :1296. Two read `22` and two read `Eleven` | `STATE.md:1232` |

**The count is the one that matters most**, because it is the number every downstream
reader will quote. **It is 106.** The gate has printed it on every run since it landed and
the prose beside it has said 105 since the same day.

---

## 2. Three findings no gate can see, which is the same failure at one remove

**`CI-06u` reads tables. These are the rows that are not in one.**

### 2.1 Four stray blank lines shatter ALLOCATION's letter table

[ALLOCATION](../decisions/ALLOCATION.md) carries blank lines at :160, :163, :166 and :169,
inside what reads as one table. `markdownTables()` builds a table from a **maximal run of
consecutive pipe lines carrying at least one delimiter row**, so the letter table is five
runs and only the first has a delimiter. **The other four are discarded whole: seven rows,
`q` through `u`, are read by no table gate and render as prose on GitHub.**

**That, and not the dedupe, is why `r` is absent from the register.**

**And this plan's own reservation commit made the fourth fragment worse, which is
recorded rather than quietly corrected.** The `v` and `w` rows this plan reserved
were appended after the second `u` row, **inside the unparsed fragment**, so they sit
at :171 and :172 where no table gate reads them. `CI-06p` sees them because
`strategyGateLetters()` and `allocatedLetters()` are line regexes, which is why
gaplessness passed and nothing objected. **Two more rows in the blind spot is not a
new defect class; it is the same one, committed by the session that documented it.**
`S6` absorbs them when it merges the fragments.

### 2.2 The letter `u` is claimed by two different gates

:168 claims `u` for the table-key gate that shipped. :170 claims `u` for
[ADR-059](../decisions/ADR-059.md)'s M01-column gate, reserved and unwritten.
`allocatedLetters()` returns a `Set`, and `CI-06p` asserts uniqueness over
[STRATEGY](../testing/STRATEGY.md) rather than over this file. **A live collision inside
the allocation registry is invisible to the registry's own gate.** This is `OI-11`.

### 2.3 Six gate rows in STRATEGY are outside any table

[STRATEGY](../testing/STRATEGY.md) :235 to :237 carry a re-inserted header row, a
re-inserted delimiter row and a blank line, leaving `CI-06p`, `q`, `r`, `t`, `s` and `u`
at :238 to :243 in an orphan run. `CI-06p` still sees them, because
`strategyGateLetters()` is a line regex rather than a table parser. **`CI-06u` does not.
The gate inventory does not render six of its own gates as a table, and `CI-06u`'s own row
is one of the six.**

### 2.4 The letter registry is three letters from its wall, and the harness hits it first

**This plan reserved a third letter and had to give it back**, which is how the bound was
found. [`falsify.mjs`](../../scripts/corpus/falsify.mjs)'s `nextFreeLetter()` scans **`a`
to `x` only** and throws `seed anchor exhausted` when all of them are claimed, with the
reason written at the line: *"every seed below needs two letters of headroom above the one
it names. A harness that silently wrapped past `z` would plant nothing and report a tidy
did not fire."*

**So the usable registry is 24 letters, not 26, and `CI-06w` spends the twenty-third.**
`CI-06a` to `CI-06u` were claimed in about a week. **One free letter remains before the
falsification harness stops being able to seed `CI-06p` at all**, and it stops with a loud
`SEED IS STALE` rather than a silent pass, which is the one piece of good news here.

**Nothing in the corpus plans for this**, and the remedy is not a bigger alphabet: it is
deciding whether `CI-06<letter>` was ever the right shape for an open-ended gate registry.
`ADR-065` owns it, because it is already the ruling on this file's registries.

**The consequence for this wave, stated so no session invents a number.** ADR-059's
M01-column gate, if `ADR-065` moves it off `u`, **has no reserved letter and must not take
one speculatively.** It is unwritten, and [ADR-034](../decisions/ADR-034.md) rules that the
claim precedes the artifact rather than the plan: whoever writes that gate claims its
letter then, in its own commit, against whatever `ADR-065` decides the registry looks like.

### The repair trap that follows, and it is the sharpest instruction in this plan

**Removing those blank lines merges the fragments and makes `r` and `u` duplicate keys.**
The register **shrinks only**, so a session cannot add them. **Whoever removes the blank
lines must repair `r` and `u` in the same commit, or `CI-06u` fails on their own pull
request.** Session `S6` holds both halves for exactly this reason.

### Two more of the same mechanism, outside this gate's reach by design

- [M20](M20-wallet.md):112 and :114 are a **byte-identical duplicated mermaid edge**
  (`requested --> refused: identity restricted`). Fenced blocks are skipped whole.
- [sessions/README](../sessions/README.md):9 and :13 to :15 are **two contradictory copies
  of the prose header**, one saying a session is recoverable from this log and one from
  its own file. [ADR-043](../decisions/ADR-043.md) makes the second current.

### And `WAVE-01`'s `R1` never ran

[WAVE-01](WAVE-01-post-freeze-parallel-sessions.md) section 4 plans **`R1`, `OI-11`, the
duplicated registry rows, session 70, LAST and ALONE**. There is no
`docs/sessions/2026-08-18-session-70.md` and no index row for it. **The plan exists, the
number was spent, and the work never happened.** The duplicate set has grown by five ADR
numbers since it was written. `S5` and `S6` below absorb it rather than supersede it, and
`R1`'s decision rule for allocation pairs is where `ADR-065` starts.

---

## 3. The line: repair or ruling, and where it falls

**Half of it is already drawn and nobody has cited it.** [INDEX](../INDEX.md):37,
`Tracking (living docs, updated every session)`, names [INDEX](../INDEX.md),
[STATE](../STATE.md), [sessions/](../sessions/README.md), [decisions/](../decisions/README.md)
and [ALLOCATION](../decisions/ALLOCATION.md). **Four of the eight damaged files are
declared living documents that move by commit by construction.** No file in this corpus
carries `status: frozen`; all eight read `status: approved`, so FROZEN is the corpus-wide
state and that row is the existing carve-out.

**`ADR-061` draws the other half, over specification documents, and is the only governing
ruling in this wave.** The rule it proposes, which the founder scores:

> A duplicated key in a specification document needs an ADR **if and only if resolving it
> changes what the document commits Merit to.** Three triggers, any one sufficient.
>
> **T1, the halves state different predicates, values, scopes or sets.** Choosing one
> changes behaviour. Three of `STATE_MACHINES`'s ten are here.
>
> **T2, both halves are cited elsewhere under the same identifier**, so no choice
> preserves every citation and the repair is a renumbering. `M05`'s three are here.
>
> **T3, the repair changes a rule the corpus states about itself**: a convention, a
> registry's identity function, or a gate's scope. The session registry and ALLOCATION's
> row-per-number are here.
>
> Everything else is a **repair** that lands by commit under this ADR, because the
> surviving row says what the document already said.
>
> **The safeguard that makes the permissive direction safe.** Every repair pull request
> states, per key, which half it kept and why, checkable from the diff alone. **A session
> that cannot state that the halves agree stops and escalates that key to a ruling.** It
> fails toward the ADR, which is the direction a money-path corpus must fail in.

**Scored against the alternative in both directions.** Ruling every duplicate would put
fifty ADRs against whitespace and teach the next session that an ADR is a formality.
Ruling none would let a session silently pick half of a money-path invariant, which is
`G-ELIGIBLE` today. This lands **five** ADRs across 106 keys, and each of the five is a
question a reader cannot answer from the tree.

---

## 4. The registries this wave spends, allocated before any session starts

| Registry | Spent | Where the claim lives |
|---|---|---|
| **ADR numbers** | **061** (S1), **062** (S2), **063** (S3), **064** (S9), **065** (S6) | [ALLOCATION](../decisions/ALLOCATION.md), ADR table. **Written unlinked**, because `CI-06a` fails on a link to an absent document |
| **CI-06 letters** | **`v`** (S7), **`w`** (S8), and **no third**. Section 2.4 is why | [ALLOCATION](../decisions/ALLOCATION.md), letter table |
| **Migration numbers** | **none.** No session below touches `packages/db/migrations` | **`0038` stays free** |
| **Session-log numbers** | **77 to 85**, one per session, in section 5. This planning session is **76** | **This table.** That registry still has no allocation table of its own, which is `ADR-064`'s second half |

**One number per session, rather than one per day.** That is not a pre-emption of
`ADR-064`: distinct numbers satisfy either ruling, and taking one each stops this wave
adding to the pile it exists to clear.

**Reservation rows are written in final form and carry no link, so no ADR session touches
ALLOCATION at all.** `S6` links them in one pass at the end. That breaks the exact loop
that produced eighteen of the 106: a reservation row, then a second row when the artifact
lands.

---

## 5. The wave

| Rank | # | Session | Log | Branch | Fence | Regime |
|---|---|---|---|---|---|---|
| **1** | **S1** | `ADR-061`, the repair-or-ruling line | 77 | `claude/wave03-s1-adr061-repair-line` | `docs/decisions/ADR-061.md`, `docs/decisions/README.md` | non-money |
| **2** | **S2** | `STATE_MACHINES` section 10, all ten guards, `ADR-062` | 78 | `claude/wave03-s2-adr062-guard-table` | `docs/architecture/STATE_MACHINES.md`, `docs/decisions/ADR-062.md` | **money path** |
| **2** | **S3** | `M05` and `M20`, `ADR-063`, the citation re-point | 79 | `claude/wave03-s3-adr063-inv-m5-collision` | `docs/plans/M05-payout-system.md`, `docs/plans/M20-wallet.md`, `docs/architecture/SECURITY.md`, `docs/decisions/ADR-063.md` | **money path** |
| **2** | **S4** | `M12` and `INDEX` | 80 | `claude/wave03-s4-m12-index-repair` | `docs/plans/M12-statistic-definitions.md`, `docs/INDEX.md` | non-money |
| **2** | **S5** | `STATE`'s P1 table | 81 | `claude/wave03-s5-state-p1-table` | `docs/STATE.md` | non-money |
| **2** | **S6** | ALLOCATION: the eighteen, the blank lines, `r`, `u`, `ADR-065` | 82 | `claude/wave03-s6-adr065-allocation` | `docs/decisions/ALLOCATION.md`, `docs/decisions/ADR-065.md` | non-money |
| **3** | **S7** | `CI-06v`, no orphan table fragment | 83 | `claude/wave03-s7-ci06v-orphan-fragments` | `scripts/corpus/`, `docs/testing/STRATEGY.md` | non-money |
| **4** | **S8** | `CI-06w`, the registries as multisets | 84 | `claude/wave03-s8-ci06w-multiset` | `scripts/corpus/`, `docs/testing/STRATEGY.md` | non-money |
| **5** | **S9** | `sessions/README`, `ADR-064` | 85 | `claude/wave03-s9-adr064-session-identity` | `docs/sessions/` | non-money |

**Rank is a priority band, many sessions to a rank, which is the shape
[WAVE-01](WAVE-01-post-freeze-parallel-sessions.md) uses and the reason `rank` is an argued
`DIMENSION_HEADERS` exemption in [`gates.mjs`](../../scripts/corpus/gates.mjs). Five run at
once: `S2`, `S3`, `S4`, `S5` and `S6`.** The reasons, stated rather than
left to be inferred:

- **`S1` runs first and alone.** Every other session's authority to land a repair by
  commit is `ADR-061`. It is one new file and one README row, so the round is cheap.
- **`S6` joins the concurrent wave only because this plan pre-reserved every number.**
  `WAVE-01`'s `R1` had to run last and alone because sibling sessions were appending
  claims to ALLOCATION while it edited them. **No session in wave 2 touches ALLOCATION**,
  so that reason is gone. This is the pre-reservation buying back a serial round.
- **`S2` and `S3` share `docs/architecture/` and are fenced to two named disjoint files.**
  Tighter than the desk's directory rule, and stated because the alternative is leaving
  [SECURITY](../architecture/SECURITY.md) citing a renumbered invariant for a day.
- **`S7` and `S8` cannot land before `S6`.** Both would **fail on arrival**:
  [`falsify.mjs`](../../scripts/corpus/falsify.mjs) makes a gate that cannot pass the tree
  an ERROR, and `CI-06v` has five findings today while `CI-06w` has eighteen plus the `u`
  collision. **`S7` repairs STRATEGY's own orphan run**, which is its last finding.
- **`S7` and `S8` are serial with each other.** Both write
  [`gates.mjs`](../../scripts/corpus/gates.mjs) and `falsify.mjs`. The PR #7 and PR #8
  reconciliation is what two branches independently writing that one file costs, and it
  cost a session.
- **`S9` runs last, absolutely.** Every session's end ritual appends a row to the table
  `S9` repairs, and under the current convention a concurrent pair appends a duplicate
  key. Its own end ritual is the first proof the repair holds.

### The one shared file no fence separates

**Every repair session deletes its own entry from `CI06U_REGISTER` in
[`gates.mjs`](../../scripts/corpus/gates.mjs).** The entries are disjoint line ranges of
one `Map` literal, so a keep-both merge fails **loudly**, with
`the register claims "..." and it is not one on this ref`. That is acceptable and it is
named here so the review desk expects it rather than diagnoses it.

### The generated spans, which are mechanical and must not be sequenced around

Five ADRs move `adr_count` from 60 to 65. Two gates move `gate_count` from 22 to 24 across
ten spans in four files. **Every session runs `node scripts/corpus/gates.mjs generate`,
and the review desk re-runs it after each merge and commits the result.** It is idempotent
and it is what `generate` is for.

---

## 6. The rules every prompt below carries, written once here

Each prompt restates these, because a prompt that points at a document is a prompt whose
rules do not arrive with it.

1. **The session-log stub is the first commit.** Write
   `docs/sessions/2026-08-20-session-<N>.md` with the objective and `placeholder` for
   every other field, add its row to [sessions/README](../sessions/README.md), commit,
   push. **Then do the work.**
2. **Commit and push after each file.** Not at the end of the task. A batch of unpushed
   commits is the failure mode the rule exists to prevent, and sessions here have lost
   entire outputs by committing nothing.
3. **The fence is absolute.** Touch nothing outside it. If the work needs a file outside
   the fence, **stop and report it in the pull-request body** rather than reaching.
4. **`docs/STATE.md`: append one `##` section at the END.** Edit no existing line. `S5` is
   the only session permitted to edit existing lines there.
5. **`docs/sessions/README.md`: append your row at the end of the table.** Your number is
   allocated in section 4. Do not take the next number you can see.
6. **Your register entry goes with your repair, in the same commit.** `CI06U_REGISTER`
   shrinks only, so a repair that lands without its register line failing is a repair the
   gate will report as a finding on the next push.
7. **Open the pull request yourself**, ready for review, titled with what landed. **Do not
   merge it.**
8. **Verify by running, never by reading.** Every completion claim ships with the command
   and its output. `node scripts/corpus/gates.mjs check` and `pnpm vitest run` are the two
   that everything must leave green.
9. **Report the count honestly.** Nine of twenty-seven beats eighteen thin files. A
   session low on context says so and stops.
10. **Never weaken a gate to pass it**, and never widen a fence to finish. Both are the
    same move.
11. **Authority citations must resolve.** Say **the review desk** or cite the ADR. **Never
    write founder ruling**; `CI-06q` exists because three sites cited one that never
    happened.

---

## 7. The prompts

Each block is complete. Paste one into a fresh session and change nothing.

---

### S1: `ADR-061`, when a duplicated key is a repair and when it is a ruling (session 77)

```
Branch: claude/wave03-s1-adr061-repair-line   (from origin/main)
Fence:  docs/decisions/ADR-061.md, docs/decisions/README.md, plus your session log.
        DO NOT REPAIR ANY DUPLICATE. DO NOT TOUCH ALLOCATION: 061 is already
        reserved there in its final form.
Regime: non-money. One objective. Log number 77. Session file
        docs/sessions/2026-08-20-session-77.md.

OBJECTIVE
Write ADR-061: when a duplicated table key in an approved document is a REPAIR
that lands by commit, and when it is an AMENDMENT that needs its own ruling.
Every other WAVE-03 session cites this ADR as the authority for its commits, so
this is the only session in the wave that runs alone at the front.

READ FIRST, in this order:
  docs/plans/WAVE-03-duplicate-registry-keys.md sections 1, 2 and 3
  docs/INDEX.md line 37, the "Tracking (living docs)" section
  CLAUDE.md, the line "Changing a frozen document requires an ADR, not a commit"
  docs/decisions/ADR-034.md and ADR-043.md, for the shape an ADR takes here

THE RULE TO RULE ON is drafted in section 3 of the wave plan. Score it, do not
transcribe it. It has three triggers, T1 different predicates, T2 both halves
cited elsewhere, T3 the repair changes a rule the corpus states about itself,
and a safeguard: a session that cannot state that two halves agree escalates
that key to a ruling rather than merging it.

THE HALF ALREADY DRAWN, which the ADR must cite rather than re-derive:
INDEX.md's "Tracking (living docs, updated every session)" section already names
INDEX, STATE, sessions/, decisions/ and ALLOCATION as documents that move every
session without a ruling. No file in this corpus carries status: frozen; all
eight damaged files read status: approved. So FROZEN is a corpus-wide state and
that row is the existing carve-out. VERIFY THAT AT INDEX.md:37 BEFORE CITING IT.

WRITE THE ALTERNATIVES SECTION AT FULL STRENGTH. Rule-everything and
rule-nothing are both real positions and one of them nearly won: ADR-059's own
section 6 beat ADR-059's own recommendation, which is the argument for this.

DEFINITION OF DONE
  - docs/decisions/ADR-061.md exists, status: proposed, with an unsigned
    approval line. It amends how a frozen corpus moves, so the signature is the
    founder's and you do not write one.
  - its row in docs/decisions/README.md
  - node scripts/corpus/gates.mjs generate   (adr_count moves 60 -> 61)
  - node scripts/corpus/gates.mjs check -> 22 of 22
  - node scripts/corpus/falsify.mjs -> clean
  - NOT ONE of the 106 duplicates is repaired by this session

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S2: the guard table, all ten, and `ADR-062` (session 78, MONEY PATH)

```
Branch: claude/wave03-s2-adr062-guard-table   (from origin/main)
Fence:  docs/architecture/STATE_MACHINES.md, docs/decisions/ADR-062.md, the
        docs/decisions/README.md row, your entry in CI06U_REGISTER, your
        session log. DO NOT TOUCH docs/architecture/SECURITY.md: session S3
        holds it.
Regime: MONEY PATH. ADR-003 strict, one objective, PLAN MODE MANDATORY. Log
        number 78. Session file docs/sessions/2026-08-20-session-78.md.

OBJECTIVE
STATE_MACHINES section 10's guard table defines ten guards twice. Read ALL TEN
PAIRS, classify each as CONTRADICTION or AGREEMENT, rule the contradictions in
ADR-062, merge the agreements under ADR-061, and take the file's entry out of
CI06U_REGISTER.

NOBODY HAS READ ALL TEN. The CI-06u survey counted keys, not semantics. Three
pairs are already known to differ and the other seven are unread. Your first
deliverable is the ten-row classification, in the PR body, one line each.

THE THREE KNOWN CONTRADICTIONS, each verified against the tree on 2026-08-20:

  G-ELIGIBLE, :403 vs :406, BOTH CITING ADR-041.
    :403  identities.status <> 'restricted'
    :406  identities.status = 'active'
    packages/db/migrations/0001_extensions_and_enums.sql:27 declares
    identity_status AS ENUM ('active', 'restricted', 'closed').
    THE WITNESS IS 'closed', NOT 'suspended'. A closed identity passes :403 and
    fails :406. ADR-041 REFUSED to add a suspended value, so any reasoning that
    turns on one is reasoning about a value that does not exist. The brief that
    commissioned this wave got that wrong and so did the survey.

  G-FREEZE-CLEARED / G-FREEZE-ENFORCED, :416 vs :423.
    :416 carries "or freeze_expires_at reached" and the 48 wall-clock hours.
    :423 does not. A freeze that should self-clear does not, under :423.

  G-HOLD-REQUIRED, :417 vs :424.
    :417 scopes to "the account or the identity" and names severity 4 or above
    in status open or investigating. :424 scopes to the identity alone and says
    "high-severity" without a band.

THE SEVEN UNREAD PAIRS: G-CLAMP (:404, :407), G-NO-IN-FLIGHT (:405, :408),
G-FREEZE-DURING-FLIGHT (:415, :422), G-HOLD-RELEASED (:418, :425),
G-HOLD-ENFORCED (:419, :426), G-ENFORCEMENT-RESTRICT (:420, :432),
G-RESTRICTION-LIFTED (:421, :433).
Two are worth naming because they look like agreement and may not be:
  - G-ENFORCEMENT-RESTRICT :420 says the investigating-to-enforced PATH; :432
    says a flag AT investigating OR enforced. Those are different preconditions.
  - G-RESTRICTION-LIFTED :421 names restored_at, restored_by and
    restore_evidence; :433 names two of the three. Check both against
    identity_restriction_restore_is_complete in
    packages/db/migrations/0031_payout_hold_and_identity_restriction.sql:264
    and let the constraint decide.

EVIDENCE FOR G-ELIGIBLE THAT YOU MUST WEIGH RATHER THAN INHERIT:
  - ADR-041's own binding table expresses the wallet and withdrawal gates as
    "restricted -> blocked", which is the <> 'restricted' shape.
  - STATE_MACHINES:429, G-WITHDRAWAL-CLEARED, reads "the identity not
    restricted", the same shape.
  - AND YET the strict form = 'active' is the safer one on a payout path, and
    'closed' reaching a payout gate at all is a question this ruling should
    answer explicitly rather than by side effect.
  - grep identities.status across packages/rules-engine/src: ZERO HITS. No code
    implements this gate yet, so the ruling is cheap today and expensive later.
Verify all four of those yourself before you write.

THE LINE CITATIONS IN THE RECORD ARE WRONG AND YOU WILL PROPAGATE THEM IF YOU
DO NOT LOOK. gates.mjs:3749, session 75's log and the wave brief all say "line
405 and line 408". Those are G-NO-IN-FLIGHT rows. G-ELIGIBLE is :403 and :406.

WHERE A DUPLICATE IS A MERGE RATHER THAN A RULING, apply ADR-061 and say in the
PR body, per key, which half you kept and why. IF YOU CANNOT STATE THAT TWO
HALVES AGREE, IT IS A CONTRADICTION AND IT GOES IN THE ADR. Fail toward the
ruling.

IF A DIVERGENCE FOLDS OUTSIDE THIS FILE, record the fold site and STOP. Do not
reach. M05, M20 and SECURITY are held by S3.

DEFINITION OF DONE
  - the ten-row classification in the PR body, one line per guard
  - docs/decisions/ADR-062.md, status: proposed, unsigned approval line. It
    amends a frozen document on the money path, so the signature is the
    founder's.
  - the guard table carries each guard ONCE
  - CI06U_REGISTER loses its docs/architecture/STATE_MACHINES.md entry ENTIRELY,
    in the same commit as the repair
  - node scripts/corpus/gates.mjs check -> 22 of 22, CI-06u among them
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S3: `M05`'s colliding invariants and `ADR-063` (session 79, MONEY PATH)

```
Branch: claude/wave03-s3-adr063-inv-m5-collision   (from origin/main)
Fence:  docs/plans/M05-payout-system.md, docs/plans/M20-wallet.md,
        docs/architecture/SECURITY.md, docs/decisions/ADR-063.md, the
        docs/decisions/README.md row, your entries in CI06U_REGISTER, your
        session log. DO NOT TOUCH docs/architecture/STATE_MACHINES.md: S2 holds
        it.
Regime: MONEY PATH. ADR-003 strict, one objective, PLAN MODE MANDATORY. Log
        number 79. Session file docs/sessions/2026-08-20-session-79.md.

OBJECTIVE
M05 defines INV-M5-17, INV-M5-18 and INV-M5-19 TWICE EACH, with entirely
different content, and BOTH SETS ARE CITED, inside M05 and outside it. Rule the
renumbering in ADR-063, apply it, re-point every citation, and clear M05's and
M20's register entries.

THIS IS NOT "PICK A HALF". Both sets are load-bearing. Verified 2026-08-20:

  SET A, M05:90 to :92
    INV-M5-17  a held request that reaches auto-release pays, even after a
               breach during the hold
    INV-M5-18  no payout request sits past its hold or freeze expiry, asserted
               nightly ON THE QUERY
    INV-M5-19  a hold consumes no ladder rung

  SET B, M05:101 to :103
    INV-M5-17  no hold and no freeze outlives its expiry
    INV-M5-18  a held request has posted nothing
    INV-M5-19  a withdrawal carrying a live freeze cannot settle

  CITATIONS OF SET A:  M05:214 (18), M05:217 (17 and 19), M20:170 (18)
  CITATIONS OF SET B:  M05:271 (18), M05:512 (17), SECURITY:172 (18),
                       STATE:286 (17 and 18)

  So M20:170 and SECURITY:172 cite INV-M5-18 FOR TWO DIFFERENT INVARIANTS. The
  ambiguity has already left the document. No choice of half preserves every
  citation, which is why this is a renumbering and not a merge, and why it is
  ADR-061's T2 trigger rather than a repair.

  THE NEXT FREE IDENTIFIER IS INV-M5-21. INV-M5-20 exists (M05:217).

  ALSO IN THE REGISTER: INV-M5-01, doubled at M05:80 and :81. Those two AGREE,
  both being ADR-040 amendments of the same zero-denial invariant. Merge under
  ADR-061 and say which you kept.

M20 IS IN THIS FENCE FOR TWO REASONS, not one:
  1. M20:170 cites INV-M5-18 and must be re-pointed by whoever renumbers.
  2. M20 has its own register entry, INV-M20-06, doubled. The two wordings
     AGREE; :62 is the enumerated form carrying identities.status = 'restricted'
     and the ADR-041 shape, :63 is prose. Merge under ADR-061, keep the
     enumerated one, say so.
  3. AND A THIRD THING NO GATE CAN SEE: M20:112 and M20:114 are a
     byte-identical duplicated mermaid edge, "requested --> refused: identity
     restricted (INV-M20-06, ADR-041)". CI-06u skips fenced blocks by design.
     Delete one. It is not in the register and removing it changes no register
     line.

STATE:286 IS OUTSIDE YOUR FENCE. Session S5 holds docs/STATE.md. Record the
re-point it needs in your PR body and DO NOT REACH.

ONE CLAIM IN THE RECORD TO CHECK RATHER THAN INHERIT: ADR-060's fold item 6
says M05:88 cites SD-06. Session 75 found that it does not; INV-M5-08's cell
cites M1's SD-09 and DEP D-M5-2. If your work touches that cell, check it.

DEFINITION OF DONE
  - docs/decisions/ADR-063.md, status: proposed, unsigned approval line, stating
    WHICH SET KEEPS 17, 18 and 19 and what the other set becomes, with the
    reason, and listing every re-pointed citation
  - M05 defines each INV-M5 identifier ONCE
  - M05:214, :217, :271, :512 re-pointed; M20:170 re-pointed; SECURITY:172
    re-pointed; M20's mermaid duplicate gone
  - CI06U_REGISTER loses its docs/plans/M05-payout-system.md and
    docs/plans/M20-wallet.md entries ENTIRELY
  - a grep in the PR body proving no other file in the tree cites a renumbered
    identifier
  - node scripts/corpus/gates.mjs check -> 22 of 22
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S4: `M12`'s sign-off collisions and `INDEX`'s three rows (session 80)

```
Branch: claude/wave03-s4-m12-index-repair   (from origin/main)
Fence:  docs/plans/M12-statistic-definitions.md, docs/INDEX.md, your entries in
        CI06U_REGISTER, your session log.
Regime: non-money, but both files are registries. One objective. Log number 80.
        Session file docs/sessions/2026-08-20-session-80.md.

OBJECTIVE
Two pure repairs under ADR-061, neither of which needs a ruling, and BOTH OF
WHICH ARE PER ROW RATHER THAN PER BLOCK.

M12, THE SIGN-OFF TABLE. S-14 and S-15 each head two rows, verified 2026-08-20:
  :221  S-14  the published value is bigint with a unit   ADR-031  RULED
  :222  S-15  each statistic declares its measure set     ADR-032  RULED
  :223  S-14  the three exclusions, published verbatim    UNSIGNED
  :224  S-15  effective_from is launch plus 30 days       UNSIGNED
  S-16 already exists at :225, so the next free identifiers are S-17 and S-18.
  THE RULED ROWS KEEP 14 AND 15. The tiebreak is that a row with a signature
  against it is the row that cannot move. Renumber the unsigned pair.
  BEFORE YOU RENUMBER, grep S-14 and S-15 across the whole tree and PUT THE
  RESULT IN THE PR BODY. It came back clean on 2026-08-20, including inside
  ADR-031 and ADR-032, which is what makes this a repair rather than a ruling
  under ADR-061's T2. If your grep disagrees, STOP: it is a ruling.

INDEX, AND THE TRAP. M03, M04 and M05 are each rowed twice, at :79 to :81 and
:82 to :84. A BLOCK DELETE LOSES CONTENT EITHER WAY:
  :79 M03 is RICHER than :82  (adds the registration lookup, the two cost lines
      and the restriction refusal)
  :80 M04 is RICHER than :83  (adds the C-27 authority boundary)
  :81 M05 is POORER than :84  (:81 says "bounded freeze, reset"; :84 says "the
      48 hour enforcement window (pre-approval hold and bounded freeze),
      reserve", which is the ADR-040 shape and is current)
  SO: KEEP :79, KEEP :80, KEEP :84. Delete :81, :82, :83. Say so, row by row,
  in the PR body. This is the registry that decides whether a thing exists and
  M05's two rows give it two different purposes.

DO NOT REGENERATE INDEX.md WHOLESALE. Edit the three rows.

DEFINITION OF DONE
  - M12 heads each S-nn identifier once; INDEX rows each plan once
  - the grep result for S-14 and S-15 in the PR body
  - the three INDEX rows named individually with what was kept and why
  - CI06U_REGISTER loses its docs/plans/M12-statistic-definitions.md and
    docs/INDEX.md entries ENTIRELY
  - node scripts/corpus/gates.mjs check -> 22 of 22, CI-06a and CI-06n among
    them (you are editing the registry they read)
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S5: `STATE`'s P1 table, and `OI-10`'s false clearance (session 81)

```
Branch: claude/wave03-s5-state-p1-table   (from origin/main)
Fence:  docs/STATE.md, your entry in CI06U_REGISTER, your session log.
Regime: non-money, but it is THE registry every other session appends to. One
        objective. Log number 81. Session file
        docs/sessions/2026-08-20-session-81.md.

OBJECTIVE
STATE's P1-item table carries nine duplicated keys, recorded as OI-10 and
recorded as CLEARED when it is not. Repair the table under ADR-061, correct
OI-10's own record, and clear the register entry.

YOU ARE THE ONLY SESSION IN THIS WAVE PERMITTED TO EDIT EXISTING LINES OF
docs/STATE.md. Every other session appends one ## section at the end. Those
appends will land while you work; they are at EOF and your edits are not.

THE FINDING, verified 2026-08-20. "CI-06, corpus integrity" heads FOUR rows:
  :1279  <!--gen:gate_count-->22<!--/gen--> checks, with the ADR-034 span
  :1283  the bare word "Eleven" checks
  :1292  the same 22-span row again, column-padded
  :1296  the same "Eleven" row again, column-padded
  KEEP A ROW THAT CARRIES THE GENERATED SPAN. The "Eleven" rows are hand
  counts, they are wrong, and CI-06g cannot correct them because they are not
  spans. That is ADR-034's whole remedy and this is the row it was written for.
  COUNT THE gen:gate_count SPANS IN THIS FILE BEFORE AND AFTER. There are five
  today. If your repair changes that number, say so and say why.

OI-10 AT :1232 SAYS "Deduplicated 2026-08-16" AND IT IS FALSE ON THIS TREE. It
also says the row stood three times; it stands four. Correct the record in
place. A tracking item that reports itself cleared is worse than one that
reports itself open, and this is the second time this file has done it.

THE OTHER EIGHT KEYS in the register for this file are the rest of the same
table: ci-01/ci-02/ci-05, ci-03 golden files, ci-04/ci-07 to ci-09, ci-06h
migration install, the monorepo scaffold, the reconciled schema and migrations,
tradingcalendar as data, vg-1 to vg-12. Same mechanism, same table. For each,
reconcile against the TREE and never against whichever copy reads most
confidently. WAVE-01 recorded three copies of one item saying 0032 was next,
was done, and was not started; only one was true.

TWO CORRECTIONS THIS FILE ALSO OWES, both verified:
  - :1749 and :1769 say "105 duplicate table keys". The gate prints 106 on
    every run. Correct both.
  - :286 cites INV-M5-17 and INV-M5-18 for M05's SET B invariants. Session S3
    is renumbering those. IF S3 HAS MERGED, re-point. IF NOT, record it in your
    PR body and leave it: do not guess the new numbers.

DEFINITION OF DONE
  - the P1 table heads each key once, and the surviving CI-06 row carries the
    generated span
  - OI-10 corrected in place
  - the 105 corrected to 106 at both sites
  - a before-and-after count of gen:gate_count spans in this file
  - CI06U_REGISTER loses its docs/STATE.md entry ENTIRELY
  - node scripts/corpus/gates.mjs generate -> no diff afterwards
  - node scripts/corpus/gates.mjs check -> 22 of 22, CI-06g and CI-06t among
    them
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S6: ALLOCATION, the blank lines, the `u` collision, and `ADR-065` (session 82)

```
Branch: claude/wave03-s6-adr065-allocation   (from origin/main)
Fence:  docs/decisions/ALLOCATION.md, docs/decisions/ADR-065.md, the
        docs/decisions/README.md row, your entry in CI06U_REGISTER, your
        session log.
Regime: non-money, but it is THE number registry. One objective. Log number 82.
        Session file docs/sessions/2026-08-20-session-82.md.

OBJECTIVE
Eighteen duplicated keys across ALLOCATION's three tables, four stray blank
lines that hide seven more rows from every gate, and a live double-claim of the
letter u. Rule the registry's shape in ADR-065, apply it, and clear the entry.

READ WAVE-01 SECTION 4's R1 FIRST. It planned exactly this repair as session 70,
LAST AND ALONE, and IT NEVER RAN: there is no session-70 log. Its decision rule
is already written and is where ADR-065 starts, not where it ends. Its
enumeration is now incomplete: it names 039 to 046 and 0033/0034, and the
register also holds 050, 054, 055, 057 and 059.

WHY THIS SESSION IS NOT ALONE THIS TIME. R1 had to run last because sibling
sessions were appending claims to this file while it edited them. WAVE-03
pre-reserved every number it spends, in one commit, before any session started.
NO SESSION IN THIS WAVE TOUCHES ALLOCATION EXCEPT YOU. That is what buys the
concurrency, and it is why you must NOT add a reservation row for anything.

THE FOUR BLANK LINES, AND THE TRAP. Re-verified after this plan's own
reservation commits shifted them: :160, :163, :166 and :169 are blank lines
inside the letter table. markdownTables() builds a table
from a maximal run of consecutive pipe lines carrying at least one delimiter
row, so the letter table is FIVE runs and only the first has a delimiter. Seven
rows, q through u, are read by NO TABLE GATE and render as prose.

  REMOVING THOSE BLANK LINES MERGES THE FRAGMENTS AND MAKES r AND u DUPLICATE
  KEYS. The register SHRINKS ONLY, so you cannot add them. YOU MUST REPAIR r
  AND u IN THE SAME COMMIT AS THE BLANK LINES, or CI-06u fails on your own pull
  request. This is the single instruction most likely to burn this session.

  r, at :161 and :164: the two rows AGREE, same gate, same description. :164
  links WAVE-01; :151 carries a parenthetical about PR #96 that :153 dropped.
  Merge under ADR-061 and say which you kept. THE RECORD'S STATED REASON FOR
  r's ABSENCE FROM THE REGISTER IS FALSE: gates.mjs:3876 and session 75 both
  say the rows are byte-identical but for one link and the dedupe reached one.
  Both stand on main and they differ by a clause. Correct that comment.

  u, at :168 and :170: TWO DIFFERENT GATES CLAIM ONE LETTER. :168 is the
  table-key gate that shipped. :170 is ADR-059's M01-column gate, reserved and
  unwritten. THIS IS A REAL COLLISION, not a State-column artifact, and it is
  invisible because allocatedLetters() returns a Set and CI-06p asserts
  uniqueness over STRATEGY rather than over this file. ADR-034's existing rule
  renumbers the branch citing the number least.
  THE DISPLACED GATE HAS NO RESERVED LETTER AND MUST NOT BE GIVEN ONE HERE. It
  is unwritten, and ADR-034 rules that the claim precedes the artifact rather
  than the plan. Whoever writes it claims a letter then. See below.

AND THE REASON THAT MATTERS: THE ALPHABET IS ALMOST GONE. falsify.mjs's
nextFreeLetter() scans a to x ONLY and throws "seed anchor exhausted" when all
are claimed, because every CI-06p seed needs two letters of headroom above the
one it names. WAVE-03 reserved a third letter, hit that wall, and gave it back.
With v and w reserved, ONE FREE LETTER REMAINS before the harness can no longer
seed CI-06p. CI-06a through CI-06u were claimed in about a week and nothing in
the corpus plans for the registry running out. ADR-065 MUST RULE ON THIS: not a
bigger alphabet, but whether CI-06<letter> was ever the right shape for an
open-ended gate registry, and what the identifier becomes. VERIFY THE WALL
YOURSELF at scripts/corpus/falsify.mjs's nextFreeLetter() before you write.

THE EIGHTEEN. Fifteen carry a reservation row AND a merged row for one number,
which is the State column ADR-034 deleted growing back as rows. That is ADR-065's
T3 ruling: one number, one row, and what the row says when the number merges.
TWO ARE NOT THAT SHAPE and must not be swept:
  - 0034 is a REAL HISTORICAL COLLISION with two different subjects, ADR-047's
    rule_states calendar revision and ADR-046's reversible contact addresses.
    The file has a whole heading about it at :123. Deleting a row erases the
    history that heading exists to explain.
  - 0033's pair IS the reservation-plus-merge shape.
  Read each of the eighteen before deciding it is the common case.

DO NOT SILENTLY DROP A BRANCH ROW'S REASONING where it says something the merge
row does not. Carry it into the surviving row or state what you dropped.

LINK THE LANDED RESERVATIONS. Rows 055, 056, 057, 059, 060 and any WAVE-03 ADR
that has merged by the time you run were written unlinked, because CI-06a fails
on a link to an absent document. Link the ones whose files now exist. THAT IS
THE OTHER HALF OF WHY THIS FILE GREW DUPLICATES: a reservation row, then a
second row when the artifact landed, instead of an amendment in place. ADR-065
should say so.

DEFINITION OF DONE
  - docs/decisions/ADR-065.md, status: proposed, unsigned approval line. It
    amends ADR-034's registry shape, so the signature is the founder's.
  - each of the three tables heads each number or letter ONCE
  - zero blank lines inside any of the three tables
  - the u collision resolved, with the displaced gate's letter left UNCLAIMED
    and the reason stated
  - ADR-065 rules on the letter registry's exhaustion, per section 2.4
  - gates.mjs:3876's false claim about r corrected
  - CI06U_REGISTER loses its docs/decisions/ALLOCATION.md entry ENTIRELY
  - which row survived each of the eighteen, ROW BY ROW, in the PR body. A dedup
    that cannot be audited is indistinguishable from one that lost something.
  - node scripts/corpus/gates.mjs check -> 22 of 22, with CI-06f, CI-06h and
    CI-06p green: all three read these tables
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S7: `CI-06v`, no orphan table fragment (session 83, AFTER S6 MERGES)

```
Branch: claude/wave03-s7-ci06v-orphan-fragments   (from origin/main AFTER
        SESSION S6's PULL REQUEST HAS MERGED. This gate cannot pass on a tree
        that still has ALLOCATION's four blank lines, and falsify.mjs makes a
        gate that cannot pass the tree an ERROR.)
Fence:  scripts/corpus/, docs/testing/STRATEGY.md, your session log. The letter
        v is already reserved in ALLOCATION: DO NOT TOUCH THAT FILE.
Regime: non-money. One objective. Log number 83. Session file
        docs/sessions/2026-08-20-session-83.md.

OBJECTIVE
Write CI-06v: no orphan table fragment under docs/. A run of consecutive pipe
lines carrying no delimiter row is a finding. And repair the last one, which is
in STRATEGY's own gate inventory.

THE DEFECT THIS GATE IS FOR. A stray blank line inside a markdown table splits
it. markdownTables() builds a table from a maximal run of consecutive pipe lines
carrying at least one delimiter row, and DISCARDS any run with no delimiter. So
those rows are read by no table gate, checked for duplicate keys by nothing, and
render as prose on GitHub. CI-06u could not see seven rows of ALLOCATION,
including a live double-claim of its own letter, for exactly this reason.

THE FIVE FINDINGS ON MAIN AS OF 2026-08-20, four of which S6 will have cleared:
  docs/decisions/ALLOCATION.md:161-162, :164-165, :167-168, :170-172   (S6)
  docs/testing/STRATEGY.md:238-243, SIX ROWS, hiding CI-06p, q, r, t, s and u.
    The cause is at :235 to :237: a re-inserted header row, a re-inserted
    delimiter row, and a blank line. THE GATE INVENTORY DOES NOT RENDER SIX OF
    ITS OWN GATES AS A TABLE, AND CI-06u's OWN ROW IS ONE OF THE SIX.
    YOU REPAIR THIS ONE, in this session, because it is inside your fence and
    because your gate cannot pass while it stands.
  VERIFY THE SET IS STILL EXACTLY THIS before you write. If S6 left one, STOP
  and report it rather than widening your fence to fix it.

NOTE WHAT CI-06p DOES AND DOES NOT SEE, so your covers text is honest:
strategyGateLetters() is a LINE REGEX, not a table parser, so CI-06p reads those
six rows fine. The damage is to rendering and to CI-06u's blind spot, not to
CI-06p's assertion. Do not claim otherwise.

THE GATE ARRIVES WITH ITS OWN SEEDED VIOLATION WATCHED FAILING, and with
boundary cases watched in BOTH directions, per falsify.mjs's own rule. At least:
  - a blank line inside a table IS a finding
  - two genuinely separate tables with a blank line and a HEADING between them
    are NOT (the delimiter is what distinguishes them)
  - a pipe line inside a fenced block claims nothing
  - a single pipe line in prose, for example a table of contents entry, claims
    nothing: decide the rule and state it

DEFINITION OF DONE
  - CI-06v in scripts/corpus/gates.mjs with a comment block stating what it does
    NOT do, in the shape CI-06u's carries
  - the seed and the boundary cases in scripts/corpus/falsify.mjs
  - the STRATEGY section 4.4 row for CI-06v, and STRATEGY's own orphan run
    repaired
  - node scripts/corpus/gates.mjs check -> 23 of 23
  - node scripts/corpus/falsify.mjs -> all 23 pass clean and fail dirty
  - node scripts/corpus/gates.mjs generate   (gate_count 22 -> 23, ten spans)
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S8: `CI-06w`, the allocation registries as multisets (session 84, AFTER S7 MERGES)

```
Branch: claude/wave03-s8-ci06w-multiset   (from origin/main AFTER SESSION S7's
        PULL REQUEST HAS MERGED. S7 writes the same two files and the PR #7 /
        PR #8 reconciliation is what two branches independently writing
        gates.mjs costs.)
Fence:  scripts/corpus/, docs/testing/STRATEGY.md, your session log. The letter
        w is already reserved in ALLOCATION: DO NOT TOUCH THAT FILE.
Regime: non-money. One objective. Log number 84. Session file
        docs/sessions/2026-08-20-session-84.md.

OBJECTIVE
Write CI-06w: each ADR number, each migration number and each CI-06 letter is
claimed by AT MOST ONE ROW of its own table in ALLOCATION. This is OI-11. It was
named as now-writable by WAVE-01's R1, which never ran, and it has been
deliberately unwritten since because it failed on arrival against the tables as
they stood. S6 cleared them.

THE DEFECT. allocated() and allocatedLetters() accumulate claims into a Set, so
TWO ROWS CLAIMING 0034 PRODUCE ONE MEMBER. Gaplessness holds, every-number-on-
disk-is-claimed holds, and A TABLE WHOSE ENTIRE PURPOSE IS TO MAKE A DUPLICATE
CLAIM VISIBLE CANNOT SEE ONE. Fifteen gates passed over a real double-claim of
0034 by two different migrations, and twenty-two passed over a live double-claim
of the letter u by two different gates.

WHY THIS IS NOT ALREADY CI-06u's JOB, and your covers text must say so. CI-06u
reads TABLES and would catch a duplicate row in this file. It did not catch u,
because the row sat in an orphan fragment; S7's CI-06v closes that. CI-06w is
the assertion at the SEMANTIC level, over the parsers the other gates actually
use, so a future refactor of allocated() into a Set cannot make the check
vacuous again. State that distinction rather than eliding it: two gates whose
scopes are not separable is how a gate gets deleted later.

THE CHECK IS A HANDFUL OF LINES AGAINST A SET THAT ALREADY EXISTS. The work is
the seeded violation, the boundary cases, and the honesty of the covers text.

ALSO IN THIS SESSION, because you are the last to touch these files: THE COUNT.
gates.mjs says 105 duplicate keys at four sites (:3747, :3755, :3800, :4060) and
the gate has printed 106 on every run since it landed. DO NOT JUST CORRECT THE
NUMBER. A hand-maintained count in a comment beside a gate that computes the
same number is exactly the defect ADR-034's spans exist for. Remove the count
and point at the printed note, or state why a frozen historical figure is the
right thing to keep. Say which you chose and why.

DEFINITION OF DONE
  - CI-06w in scripts/corpus/gates.mjs, seeded violation watched failing, and
    boundary cases watched in both directions
  - the STRATEGY section 4.4 row
  - the 105 resolved at all four sites, with a stated reason for the shape you
    chose
  - node scripts/corpus/gates.mjs check -> 24 of 24
  - node scripts/corpus/falsify.mjs -> all 24 pass clean and fail dirty
  - node scripts/corpus/gates.mjs generate   (gate_count 23 -> 24)
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

### S9: the session registry, `ADR-064` (session 85, LAST AND ALONE)

```
Branch: claude/wave03-s9-adr064-session-identity   (from origin/main AFTER
        EVERY OTHER WAVE-03 PULL REQUEST HAS MERGED. Every session's end ritual
        appends a row to the table you are repairing, and under the current
        convention a concurrent pair appends a duplicate key. Running this
        alongside anything reproduces the defect it exists to clear.)
Fence:  docs/sessions/, docs/decisions/ADR-064.md, the docs/decisions/README.md
        row, your entry in CI06U_REGISTER.
Regime: non-money, but it is a registry and a ruling. One objective. Log number
        85. Session file docs/sessions/2026-08-20-session-85.md.

OBJECTIVE
docs/sessions/README.md is TWO PROBLEMS AND THEY NEED DIFFERENT ANSWERS. Rule
the identity function in ADR-064, merge the duplicated index, and shrink the
register entry to exactly what the ruling leaves behind.

PROBLEM ONE, THE RULING THIS CORPUS HAS OWED SINCE SESSION 45. Parallel sessions
on one day SHARE a number and a log file, each appending its own ## section.
Sessions 31, 49, 50 and 56 each hold four; 32, 33, 40, 45, 47, 48, 51, 57 and 59
each hold three. So two index rows pointing at one file are TWO ENTRIES and
identity is (file, subject) rather than the file. CI-06u reads the first cell
and calls that a duplicate. THE CONVENTION AND THE GATE ARE IN CONFLICT AND ONE
MUST GIVE. A session number naming four different sessions is not an identifier.
WAVE-01 recorded this registry racing twice, with four entries numbered 31 and
two numbered 32. The review desk registered the 2026-08-19 pair rather than
renumbering thirty sessions mid-merge and flagged the ruling as owed. YOU ARE
THE SESSION THAT OWES IT.

PROBLEM TWO, THE MERGE, AND IT IS NOT WHAT THE SURVEY SAID. The index really is
duplicated, but NEITHER COPY IS A SUPERSET. Verified 2026-08-20:
  COPY 1  lines 21 to 117,  97 rows,  62 distinct keys
  COPY 2  lines 120 to 225, 106 rows, 69 distinct keys
  58 keys appear in BOTH.
  COPY 1 ALONE holds sessions 60, 61, 62 and 64.
  COPY 2 ALONE holds sessions 63, 65, 66, 67, 68, 69, 71, 72, 73, 74 and 75.
  DELETING EITHER COPY LOSES SESSIONS AND BREAKS CI-06n, which asserts in both
  directions that every entry file has a README row. There are 73 session files
  and 73 distinct keys across the two copies. THE REPAIR IS A UNION, NOT A
  DELETE. Verify those numbers yourself before you cut anything.

THE ARITHMETIC YOUR STOP CONDITION TURNS ON. The register holds 59 keys for this
file. 58 are the both-copies duplication. The 59th is 2026-08-19 - session 75,
which appears three times in copy 2 and is the CONVENTION, not the merge.
  AFTER THE UNION, IF THE CONVENTION SURVIVES: 19 keys remain duplicated,
  being sessions 31, 32, 33, 40, 42, 45, 47, 48, 49, 50, 51, 52, 54, 55, 56,
  57, 58, 59 and 75. THE REGISTER ENTRY MUST BE EXACTLY THOSE 19.
  IF THE RULING MAKES SESSION NUMBERS UNIQUE: the entry goes to ZERO and thirty
  sessions get renumbered. That is a large and irreversible edit and the ADR
  must weigh it explicitly rather than defaulting to it.

TWO MORE THINGS IN THIS FILE, both verified:
  - :9 and :13 to :15 are TWO CONTRADICTORY COPIES OF THE PROSE HEADER, one
    saying a session is recoverable from this log and one from its own file.
    ADR-043 makes the second current. Not a table duplicate, not in the
    register, same keep-both mechanism. Repair it and cite ADR-043.
  - THE HOLES. There is no session 35 and no session 70. Session 70 was
    allocated by WAVE-01 section 4 to R1, the duplicated-registry-rows session,
    AND R1 NEVER RAN. ADR-064 should say what a hole in this registry means,
    because a registry with unexplained holes and repeated numbers is not a
    registry.

ALSO: this registry is the LAST ONE WITH NO ALLOCATION TABLE. Whichever way the
ruling goes, that gap is real and ADR-064 should name who closes it and where
the table lives.

DEFINITION OF DONE
  - docs/decisions/ADR-064.md, status: proposed, unsigned approval line, ruling
    the identity function, the holes, and the allocation table
  - one index copy holding the UNION of all 73 session files
  - CI06U_REGISTER's docs/sessions/README.md entry is EXACTLY the 19 keys the
    convention leaves, or GONE if the ruling makes numbers unique. State the
    number in the PR body.
  - the duplicated prose header repaired
  - node scripts/corpus/gates.mjs check -> green, with CI-06n among them: it
    reads this file in both directions
  - pnpm vitest run -> green

COMMIT AND PUSH AFTER EACH FILE. OPEN A PULL REQUEST YOURSELF, ready for
review, and do not merge it.
```

---

## 8. What this plan does not do

**It repairs nothing.** Not the one-line ones. A planning session that repaired the cheap
half would hand the wave a tree that no longer matches its own prompts.

**It does not make the session-registry ruling.** That is `ADR-064` and it belongs to
`S9`, which has the file open in front of it.

**It adds nothing to `CI06U_REGISTER`.** The register holds 106 entries and every one of
them is real. The three findings in section 2 are **not** register candidates: `r` and `u`
would make the gate fail immediately, because the register asserts an entry names a
duplicate the gate can currently find, and it cannot find those. They close through
`S6`'s repair and `CI-06v`.

**The end state is 19 registered keys, or zero**, depending on `ADR-064`. Nothing else in
the register survives this wave.
