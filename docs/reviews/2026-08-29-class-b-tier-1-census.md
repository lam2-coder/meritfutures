# Tier 1 classified by hand, entry by entry, and the residue question answered with its method stated first, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs:166`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. **The ruling it feeds is [ADR-244](../decisions/ADR-244.md).**

**EVERY NUMBER BELOW WAS DERIVED ON THIS BRANCH AT `52b5202`, WHICH IS `origin/main`'s HEAD ON
2026-08-29.** None is carried from [ADR-227](../decisions/ADR-227.md) or from
[ADR-243](../decisions/ADR-243.md), and where a reading differs from theirs both are printed rather
than one replacing the other.

**THE SHALLOW-CLONE TRAP [ADR-243](../decisions/ADR-243.md) RECORDED WAS LIVE AGAIN AND WAS
CLEARED FIRST.** `git rev-parse --is-shallow-repository` returned `true` and `git log --oneline
origin/main` reported **220** commits against the **3,551** that exist. `git fetch --unshallow
origin` was run before anything below was derived. **This is the second consecutive session to
inherit it and nothing in this repository checks a clone's depth before running the derivation that
depends on it.**

---

## 1. THE METHOD, STATED BEFORE ANY RESULT

**Row `244` requires this order and the reason is that every incentive in this session points at a
smaller queue.** What follows was fixed before a single entry was classified.

### 1.1 The question being asked of each entry

[ADR-227](../decisions/ADR-227.md) section 3 classifies a money-path diff by **the shape of its
CENTRAL claim**: a PROPERTY earns its approval by a named mechanical assertion, a CHOICE waits for
the founder. Its section 6 makes the property side **demonstrable** in four conditions, of which
condition 2 is the operative one: *"it was watched RED before the change and GREEN after, with the
transcript in the entry."*

**The test applied to each entry, in one sentence:**

> Take the claim the entry's own heading makes, and the claim the entry itself declares central
> where it declares one. Ask whether an assertion exists that goes RED when the shipped tree stops
> honouring that claim, where "stops honouring" means a change to code or schema **other than
> deleting the assertion**. If yes, **produce the red-then-green transcript**; that is class B and
> nothing else is. If the only falsifier would be a restatement of the one line the entry itself
> wrote, that is class C.

**AN ENTRY IS CLASS B ONLY WHEN A TRANSCRIPT EXISTS.** Not when one is plausible, not when the
assertion is named. This is the constraint that stops a session flattering itself, and it is why
section 3 counts twenty-one seeds rather than twenty-one arguments.

### 1.2 The scope, fixed in advance

**TIER 1, ENTIRE.** [ADR-243](../decisions/ADR-243.md)'s residue review derived tier 1 by file at
**21** entries and read **6** of them. This session reads **the remaining 15**, so tier 1 is a
CENSUS and not a sample and **no result below is extrapolated past it**. Tiers 2 to 6 are counted
and not read, and every sentence about them says so.

### 1.3 The three things that would have made this session's result untrustworthy, named in advance

1. **A transcript that was argued rather than run.** Every seed in section 3 was applied to shipped
   source or to a merged migration, run, and restored from a byte copy, with `sha256sum` identical
   in both directions and `git status --short` empty afterwards. **No shipped file is edited by this
   branch.**
2. **A correction taken only where it flatters.** Section 4's mechanical refinement shrinks the
   queue, so it is reported as a **floor** and every hit is quoted from the entry's own text.
   Section 5's finding **enlarges** the doubt about this session's own instrument and is reported
   with the same prominence.
3. **A smaller number declared rather than derived.** Section 6 argues that the class C count is
   **not mechanically obtainable at all**, and then gives the only number it can defend, which is a
   census of one tier.

---

## 2. The population, re-derived live

Same commands as [the class B residue review](2026-08-29-class-b-residue.md) sections 1 and 4,
re-run on the unshallowed clone:

```
for f in $(git ls-tree -r --name-only origin/main docs/decisions/ | grep -E 'ADR-[0-9]+\.md$'); do
  git show origin/main:$f | head -1
  m=$(git log --first-parent --diff-filter=A --format=%H origin/main -- "$f" | tail -1)
  git diff --name-only "$m^1" "$m" | grep -E '^(apps|packages)/' \
    | grep -vE '/(test|tests)/|\.test\.|/fixtures/'
done
```

with the money-path predicate transcribed unchanged from [the approval population
review](2026-08-29-approval-population.md) section 3.1, wallet routes included.

| Measured over `docs/decisions/ADR-*.md` on `origin/main` at `52b5202` | Count |
| --- | ---: |
| entry files | **229** |
| carrying `status: accepted` in their first line | **103** |
| carrying `status: proposed` in their first line | **126** |
| of the 126, landing at least one **money-path** file in their landing merge | **53** |
| distinct **money-path files** landed under a `proposed` entry | **69** |
| of the 53, **tier 1** by file (money leaving the firm) | **21** |

**THE TREND HOLDS FOR A THIRD DAY AND THE TIER DOES NOT MOVE.** Money-path entries **42, 44, 46,
47, 52, 53**. Tier 1 was 21 at `6e8891ca` and is the same 21 entries here, member for member, which
is what made a census of it possible in one session.

**`accepted` IS 103 FOR THE SECOND READING RUNNING.** [ADR-243](../decisions/ADR-243.md) recorded
the drop from 104 and did not explain it; this reading reproduces 103 and does not explain it
either. **It is carried forward as owed rather than quietly dropped.**

---

## 3. THE CENSUS: twenty-one tier-1 entries, every one read in full

**Six were read by [ADR-243](../decisions/ADR-243.md) and are carried with its classification
unchanged. Fifteen were read in full by this session.** The transcripts are
[ADR-244](../decisions/ADR-244.md) section 3; what follows is the roll.

| Entry | Class | On what |
| --- | --- | --- |
| [ADR-140](../decisions/ADR-140.md) | **B** | ADR-243 section 4.1 |
| [ADR-169](../decisions/ADR-169.md) | **B** | 3 seeds, 3 reds |
| [ADR-174](../decisions/ADR-174.md) | **NEITHER** | Lands no executable money-path line; the read transfers, in the entry's own words |
| [ADR-175](../decisions/ADR-175.md) | **NEITHER** | ADR-243 section 5.2 |
| [ADR-176](../decisions/ADR-176.md) | **B** | ADR-243 section 4.2 |
| [ADR-177](../decisions/ADR-177.md) | **B on the surviving clause** | 1 seed, red. Its self-declared CENTRAL finding was overtaken by ADR-180 |
| [ADR-180](../decisions/ADR-180.md) | **C** | ADR-243 section 5.1. **The whole of tier 1's residue** |
| [ADR-189](../decisions/ADR-189.md) | **B** | 2 seeds, 2 reds |
| [ADR-191](../decisions/ADR-191.md) | **B** | ADR-243 section 4.3 |
| [ADR-192](../decisions/ADR-192.md) | **B** | ADR-243 section 4.4 |
| [ADR-197](../decisions/ADR-197.md) | **B** | 2 seeds, 2 reds |
| [ADR-199](../decisions/ADR-199.md) | **B** | 1 seed, 5 cases red |
| [ADR-211](../decisions/ADR-211.md) | **NOT A MONEY-PATH LANDING** | Zero executable lines. Its own words: read-only apart from citation repairs |
| [ADR-212](../decisions/ADR-212.md) | **NOT A MONEY-PATH LANDING** | Zero executable lines. Its own words: *"NOT THE MONEY PATH"* |
| [ADR-228](../decisions/ADR-228.md) | **B**, and one of the two fragile ones | 2 seeds, 2 reds |
| [ADR-230](../decisions/ADR-230.md) | **B** | 1 of its own 2 recorded seeds reproduces. Section 5 |
| [ADR-231](../decisions/ADR-231.md) | **B** | 2 seeds, 2 reds |
| [ADR-232](../decisions/ADR-232.md) | **B** | 2 seeds, 2 reds |
| [ADR-233](../decisions/ADR-233.md) | **B**, and the second fragile one | 1 seed, 3 cases red |
| [ADR-234](../decisions/ADR-234.md) | **B** | 1 seed, 5 cases red |
| [ADR-237](../decisions/ADR-237.md) | **B** | 2 seeds, 2 reds |

| Outcome over tier 1 | Count |
| --- | ---: |
| **B**, an assertion watched RED and then GREEN | **15** |
| **B on the surviving clause**, the central finding superseded | **1** |
| **C**, the residue | **1** |
| **NEITHER**, the read transfers under ADR-227 section 2 | **2** |
| **Not a money-path landing**, no executable line | **2** |
| **Total** | **21** |

---

## 4. The mechanical refinement, measured, and reported as a FLOOR because it shrinks the queue

**THE PREDICATE COUNTS AN ENTRY WHOSE LANDING MERGE CHANGES ONLY COMMENTS IN A MONEY-PATH FILE.**
[ADR-243](../decisions/ADR-243.md) section 3 found one over-count of a different shape (a shared
landing merge). This is a second shape and it is mechanically decidable: take each entry's landing
merge, restrict it to money-path files, strip every changed line that is blank or begins with a
comment marker, and count what is left.

| Entry | Changed lines in money-path files | Of those, executable |
| --- | ---: | ---: |
| [ADR-171](../decisions/ADR-171.md) | 23 | **0** |
| [ADR-211](../decisions/ADR-211.md) | 10 | **0** |
| [ADR-212](../decisions/ADR-212.md) | 20 | **0** |
| [ADR-225](../decisions/ADR-225.md) | 22 | **0** |
| [ADR-238](../decisions/ADR-238.md) | 107 | **0** |
| [ADR-239](../decisions/ADR-239.md) | 23 | **0** |

**ALL SIX WERE VERIFIED BY READING THE DIFF RATHER THAN BY TRUSTING THE FILTER**, and every changed
line in all six is inside a docblock or a `--` comment. Two of the six were also read in full by
this session and each declares the same thing in its own words: [ADR-211](../decisions/ADR-211.md),
*"`packages/**` AND `apps/**` ARE READ-ONLY TO THIS SESSION APART FROM CITATION REPAIRS"*;
[ADR-212](../decisions/ADR-212.md), *"NOT THE MONEY PATH, AND THE DISTINCTION IS BY SUBJECT."*

**WHAT THIS DISCHARGES IS THE BEHAVIOURAL READ AND NOTHING ELSE, and the distinction matters
because four of the six exist to repair a comment that was FALSE.**
[`MERIT_BUILD_MASTER_PROMPT.md:358`](../../MERIT_BUILD_MASTER_PROMPT.md) asks a founder to walk a
diff whose BEHAVIOUR nobody can account for; a diff that changes no executable line changes no
behaviour, and that is checkable rather than assertable. **Whether the new prose is TRUE is a
different question**, [ADR-042](../decisions/ADR-042.md) already ruled that prose is not a control,
and `RI-14`, `RI-15` and `RI-20` are the mechanical checks that exist for it.

**SIX IS A FLOOR AND THE FILTER IS UNDER-INCLUSIVE ON PURPOSE.**
[ADR-174](../decisions/ADR-174.md)'s money-path diff carries 22 executable lines and every one of
them is a **string literal** inside `LT_07_FINDINGS` recording that a finding is now RULED. The
filter cannot see that and a reader can. **The direction is the safe one for a correction that
shrinks a queue**, and it is stated here rather than tuned until the number improved.

---

## 5. THE FINDING: a recorded red-then-green transcript that does not reproduce

**[ADR-230](../decisions/ADR-230.md) SECTION 3.4 RECORDS TWO SEEDED DEFECTS AND SAYS BOTH TURNED
THE SAME CASE RED. ONE OF THEM DOES NOT.**

| ADR-230's recorded seed | Re-run on `52b5202` |
| --- | --- |
| *"The writer-column refusal loop short-circuited to `continue`"* | **RED, 1 of 16.** Reproduces exactly, naming *"a handler party to pair A cannot write a row for pair B"* |
| *"The caller's values spread AFTER the stamp, so a supplied buyer wins"* | **GREEN. 715 of 715 in `packages/db` pass.** It does not reproduce |

**THE TREE IS NOT DEFECTIVE AND THE ENTRY'S RULING STANDS.** `pairInsertStatement` throws on the
writer column in both spellings before the values object is ever spread, so with the refusal live
the ORDER of the spread is unreachable and swapping it changes no observable behaviour. The
narrowness property [ADR-230](../decisions/ADR-230.md) claims is still held, by the refusal, and the
refusal is still watched failing.

**WHAT IS TRUE IS NARROWER AND IT IS WORTH SAYING.** That file's own header names three legs, of
which leg 1 is *"THE STAMP. Every statement the door builds binds the handle's own identity into the
writer column, whatever the caller passed."* **Leg 1 is not independently held**: with the refusal
intact no test distinguishes a stamp-last door from a caller-wins door, so if a later session ever
relaxed the refusal, the ordering would be the only thing standing and nothing would report it
gone. `git log --first-parent origin/main -- packages/db/test/pair-write-door.test.ts` returns
**one** commit, ADR-230's own merge, so the suite has not drifted since the transcript was written.

**THIS IS THE SHARPEST THING THIS SESSION FOUND ABOUT ITS OWN SUBJECT.** Row `244` says an approval
without a red-then-green transcript is a signature wearing a test's clothes. **A transcript that
does not reproduce is the same object one step further on**, and it is invisible to every check in
this repository, `RI-23` included, because re-running a seed is not something a static reader can
do. **The only instrument that catches it is a later session re-running the seed**, which is what
happened here.

---

## 6. THE RESIDUE QUESTION, ANSWERED

### 6.1 No mechanical classifier can ask ADR-227's question, and this is why rather than an assertion

**THE TWO SIDES OF THE RULE ARE NOT SYMMETRIC AND THAT IS THE WHOLE ANSWER.**

- **Class B is DEMONSTRABLE.** [ADR-227](../decisions/ADR-227.md) section 6 says what a witness
  looks like and how to exhibit one: name the assertion, watch it red, watch it green. A session
  that produces the witness has settled the question, and section 3 above did it fifteen times.
- **Class C is the COMPLEMENT, and its claim is universally quantified.** *"No assertion falsifies
  this central claim"* ranges over every assertion anybody could write. **No search establishes it
  and no pattern approximates it**, because the thing being quantified over is not in the corpus.

**SO THE RESIDUE CAN BE BOUNDED ABOVE AND NEVER MEASURED DIRECTLY.** Every honest figure for it is
`(money-path entries) minus (entries demonstrated class B) minus (entries demonstrated to land
nothing)`, and every one of those subtrahends is a session's work. **The residue cannot be measured
more cheaply than it can be cleared.** That is the answer to *"build a classifier that asks the
rule's question"*: the procedure that answers it **is** the class B procedure, and there is no
cheaper oracle.

### 6.2 The empirical half, because an argument about decidability is not a measurement

**[ADR-227](../decisions/ADR-227.md)'s CLASSIFIER, RE-RUN VERBATIM** over the 53, with the pattern
transcribed from [the class B residue review](2026-08-29-class-b-residue.md) section 5
(`judgement`, `a choice`, `the first thing to decide`, `founder question`, `is the founder's`,
`founder's call`, `and this entry cannot`):

| Over the 53 money-path entries at `52b5202` | Count |
| --- | ---: |
| whose founder-read block declares an outstanding judgement | **47** |
| carrying no founder-read block at all | **6** |
| **Restricted to the 21 tier-1 entries** | |
| scored as residue | **21 of 21** |

**SO THE CLASSIFIER SCORES EVERY ENTRY IN TIER 1 AS RESIDUE AND THE CENSUS FINDS ONE.** Fifteen of
its twenty-one hits now carry an assertion this session watched failing, and four more carried one
[ADR-243](../decisions/ADR-243.md) watched failing. **This is not a sample and it is not four cases:
it is the whole tier, read one entry at a time.**

### 6.3 AND THE CLASSIFIER IS NOT WRONG, WHICH IS THE PART [ADR-243](../decisions/ADR-243.md) DID NOT REACH

**THE TWO PREDICATES MEASURE TWO DIFFERENT OBJECTS AND BOTH OBJECTS ARE REAL.**
[ADR-227](../decisions/ADR-227.md) section 8 says so in its own words about its own number:
***"THIS IS THIRTY DECISIONS AND NOT THIRTY DIFFS."***

| | What it counts | What it blocks | Tier 1 today |
| --- | --- | --- | ---: |
| **ADR-227 section 3's rule** | **diffs** whose central claim is a choice | a MERGE. `:358` applies undiluted | **1** |
| **ADR-227 section 8's classifier** | **entries** naming a choice a founder still owns | nothing. It is a list of questions | **21** |

**A GOOD ENTRY NAMES A RESIDUAL CHOICE EVEN WHEN ITS CENTRAL CLAIM IS A PROPERTY**, because `RI-13`
requires the block and because naming what you did not settle is the discipline this corpus runs on.
**So the classifier scoring 21 of 21 is the corpus working, not the classifier failing.**

**WHAT WAS WRONG WAS USING ONE NUMBER FOR BOTH JOBS, and that is the correction.** The class C merge
queue in tier 1 is **one entry**. The outstanding-decision queue in tier 1 is **twenty-one**, and
**class B does not empty it**: every entry moved in section 3 still names choices its founder block
already wrote down, and moving it to class B says only that the diff's behaviour is accountable
without a read. **Neither number is a correction of the other and neither should be reported without
the other.**

### 6.4 What a human must read instead, measured

**THE READ IS NOT AN ENTRY, IT IS A BLOCK, AND FOR SOME ENTRIES IT IS A BULLET.** Twenty-three of
the 53 money-path entries and **9 of the 21 in tier 1** now carry an explicit
`WHAT IS MEASURED, WHAT IS DERIVED, AND WHAT IS JUDGED` bullet, which is the entry declaring its own
split before its argument starts. **For those, the question ADR-227 section 3 asks is answered by
one paragraph the entry already wrote.** For the other 30 it is not, and the entry has to be read.

**THIS IS A REDUCTION IN READING AND NOT A REDUCTION IN THE QUEUE, and the difference is the point.**
It does not make any entry class B and it does not remove any founder's decision. **The durable
repair is that a money-path entry declares its own split**, which more than half of tier 1's
recent entries already do without being asked.

---

## 7. What this document does not establish

- **It classifies no entry outside tier 1.** Thirty-two money-path entries in tiers 2 to 6 are
  counted here and read by nobody. Section 6.1 is why a number for them would be false.
- **It does not measure what a structural assertion is worth.**
  [ADR-243](../decisions/ADR-243.md) section 9 raised this and nothing here answers it: several of
  the fifteen rest on assertions that read source text or migration text rather than executing a
  path. **A structural assertion is defeated by a rewrite that preserves the text**, and the seeds
  in section 3 are evidence that the assertion is live, not that it is deep.
- **It does not explain the `accepted` count's drop**, reproduced at 103 and unexplained for the
  second reading running.
- **It does not re-run any transcript other than [ADR-230](../decisions/ADR-230.md)'s**, so section
  5's finding is one entry's and says nothing about the other three
  [ADR-243](../decisions/ADR-243.md) recorded.
- **It writes no rate limit, mints no code, edits no shipped source and takes no migration number.**
