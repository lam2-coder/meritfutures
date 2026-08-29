# Tiers 2 and 3 classified by hand, entry by entry, and one class C established by execution rather than by argument, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs:166`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. **The ruling it feeds is [ADR-247](../decisions/ADR-247.md).**

**EVERY NUMBER BELOW WAS DERIVED ON THIS BRANCH AT `ff36bea`, WHICH IS `origin/main`'s HEAD ON
2026-08-29.** None is carried from [ADR-227](../decisions/ADR-227.md),
[ADR-243](../decisions/ADR-243.md) or [ADR-244](../decisions/ADR-244.md), and where a reading
differs from theirs both are printed rather than one replacing the other.

**THE SHALLOW-CLONE TRAP IS LIVE FOR THE THIRD CONSECUTIVE SESSION AND WAS CLEARED FIRST.**
`git rev-parse --is-shallow-repository` returned `true` and `git log --oneline origin/main` reported
**207** commits against the **3,561** that exist. `git fetch --unshallow origin` was run before
anything below was derived. **Three sessions have now inherited it and nothing in this repository
checks a clone's depth before running the derivation that silently depends on it.**

---

## 1. THE METHOD, STATED BEFORE ANY RESULT

**Row `247` requires this order, and it is [ADR-244](../decisions/ADR-244.md) section 1's method
transcribed rather than adapted.** What follows was fixed before a single entry was classified.

### 1.1 The question asked of each entry

> Take the claim the entry's own heading makes, and the claim the entry itself declares central
> where it declares one. Ask whether an assertion exists that goes RED when the shipped tree stops
> honouring that claim, where "stops honouring" means a change to code or schema **other than
> deleting the assertion**. If yes, **produce the red-then-green transcript**; that is class B and
> nothing else is. If the only falsifier would be a restatement of the one line the entry itself
> wrote, that is class C.

**AN ENTRY IS CLASS B ONLY WHEN A TRANSCRIPT EXISTS.** Not when one is plausible, not when the
assertion is named.

### 1.2 The scope, fixed in advance

**TIERS 2 AND 3, ENTIRE.** Derived by file over each entry's landing merge (section 3), read whole,
**no extrapolation and no sample.** Tiers 4, 5 and 6 are counted and not read, and every sentence
about them says so.

### 1.3 The three things that would have made this session's result untrustworthy, named in advance

1. **A transcript that was argued rather than run.** Every seed in
   [ADR-247](../decisions/ADR-247.md) section 3 was applied to shipped source or to a merged
   migration, run, and restored from a byte copy, with `sha256sum` identical
   in both directions and `git status --short` empty afterwards. **No shipped file is edited by this
   branch.**
2. **A class C talked out of existence.** Row `247` names this as the real trap: this session now
   knows what a good answer looks like. **So the one class C established here is established by
   EXECUTION** (section 5): the falsifier is exhibited, and it is shown to be a transcription of the
   entry's own sentence rather than an independent property.
3. **A tier reported that was not finished.** Both were finished. Had one not been, the row required
   this document to say so and stop.

---

## 2. The population, re-derived live

Same commands as [the tier 1 census](2026-08-29-class-b-tier-1-census.md) section 2, re-run on the
unshallowed clone:

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

| Measured over `docs/decisions/ADR-*.md` on `origin/main` at `ff36bea` | Count |
| --- | ---: |
| entry files | **232** |
| carrying `status: accepted` in their first line | **103** |
| carrying `status: proposed` in their first line | **129** |
| of the 129, landing at least one **money-path** file in their landing merge | **53** |
| distinct **money-path files** landed under a `proposed` entry | **69** |

**THE MONEY-PATH QUEUE DID NOT MOVE TODAY AND THAT IS THE FIRST TIME IN THIS THREAD.** Entry files
went 229 to **232** and `proposed` 126 to **129**, and **the money-path count held at 53 over 69
files**: the three entries added since [ADR-244](../decisions/ADR-244.md) land no money-path file.
The trend across six readings is **42, 44, 46, 47, 52, 53, 53**. **One flat reading is not a
plateau**, and it is recorded as one reading rather than as a change of direction.

**`accepted` IS 103 FOR THE THIRD READING RUNNING.** [ADR-243](../decisions/ADR-243.md) recorded the
drop from 104 and did not explain it, [ADR-244](../decisions/ADR-244.md) reproduced 103 and did not
either, and this reading reproduces it a third time and does not. **It is carried forward as owed
rather than quietly dropped.**

---

## 3. Tiers 2 and 3, derived by file rather than carried

[ADR-227](../decisions/ADR-227.md) section 8's tier 2 is *"the ledger, the record of what is owed to
whom"* and its tier 3 is *"money entering: checkout and the PSP boundary"*. Transcribed to a file
predicate over each entry's landing merge, on [ADR-243](../decisions/ADR-243.md) section 4's
precedent of naming the files rather than the words:

| Tier | File predicate |
| --- | --- |
| **2** | `packages/ledger/`, and the ledger migrations `0052`, `0053`, `0054`, `0055`, `0056`, `0059` |
| **3** | `apps/api/src/routes/checkout.ts`, `packages/psp/` |

**THE PREDICATE WAS VALIDATED AGAINST A KNOWN ANSWER BEFORE IT WAS TRUSTED.** The same script run
with [ADR-243](../decisions/ADR-243.md) section 4's tier 1 predicate returns its twenty-one entries
**member for member**, which is what makes the two rows above a transcription rather than a new
judgement.

**TIER 2 IS NINE ENTRIES:**
`ADR-104` `ADR-157` `ADR-177` `ADR-180` `ADR-183` `ADR-186` `ADR-187` `ADR-189` `ADR-193`

**TIER 3 IS SEVEN ENTRIES:**
`ADR-105` `ADR-113` `ADR-123` `ADR-187` `ADR-225` `ADR-230` `ADR-238`

**FIFTEEN DISTINCT ENTRIES**, because [ADR-187](../decisions/ADR-187.md) is in both: it mints the
eighth ledger code and its landing merge also touches `checkout.ts`.

**FOUR OF THE FIFTEEN ARE ALREADY CLASSIFIED AND ARE CARRIED RATHER THAN RE-DERIVED**, because they
are also in tier 1 and [ADR-244](../decisions/ADR-244.md) read them: `ADR-177` (B on its surviving
clause), `ADR-180` (C), `ADR-189` (B), `ADR-230` (B). **ELEVEN WERE READ IN FULL HERE.**

**AND [ADR-243](../decisions/ADR-243.md) SECTION 3's OVER-COUNT DOES NOT OCCUR IN THESE TWO TIERS.**
That entry found 52 money-path entries under 51 distinct merges, because `28f050b1` added both
`ADR-174` and `ADR-175`. **All fifteen entries here land under fifteen distinct merges**, checked
rather than assumed, so the shared-merge attribution error is a tier 1 artefact today and not a
general one. **Section 6 records the attribution error that DOES occur here, which runs the other
way.**

---

## 4. THE CENSUS: fifteen entries, fifteen classifications

### 4.1 Tier 2, the ledger

| Entry | Class | On what |
| --- | --- | --- |
| [ADR-104](../decisions/ADR-104.md) | **B** | the imbalance is unrepresentable, and a halt is a halt only because this path honours it. Three seeds, three RED |
| [ADR-157](../decisions/ADR-157.md) | **B** | a term is a closed vocabulary recognised by IDENTITY, and the lock is a ROW lock. Three seeds, three RED |
| [ADR-177](../decisions/ADR-177.md) | **B** on its surviving clause | CARRIED from [ADR-244](../decisions/ADR-244.md) section 3.12 |
| [ADR-180](../decisions/ADR-180.md) | **C** | CARRIED from [ADR-243](../decisions/ADR-243.md) section 5.1. *"THIS IS A JUDGEMENT AND NOT A DERIVATION"* |
| [ADR-183](../decisions/ADR-183.md) | **B** | three positions, opened by the database, per row. Two seeds, two RED |
| [ADR-186](../decisions/ADR-186.md) | **C** | *"the last two codes are both assets"* is a CHOICE, and section 5 executes the demonstration |
| [ADR-187](../decisions/ADR-187.md) | **B** | the eighth code's kind is a DERIVATION. One seed RED, one seed GREEN, and the green one is finding 1 |
| [ADR-189](../decisions/ADR-189.md) | **B** | CARRIED from [ADR-244](../decisions/ADR-244.md) section 3.2 |
| [ADR-193](../decisions/ADR-193.md) | **B** | the rule refuses the LINK, in a trigger because a CHECK is incapable. **The assertion did not exist**; three seeds, three RED |

**TIER 2: SEVEN CLASS B, TWO CLASS C.**

### 4.2 Tier 3, money entering

| Entry | Class | On what |
| --- | --- | --- |
| [ADR-105](../decisions/ADR-105.md) | **B** | the port owns the ORDER and the vendor owns the mechanics. Three seeds, three RED |
| [ADR-113](../decisions/ADR-113.md) | **NEITHER** | its central claim is an API_CONTRACT row. **Section 6 is the finding, and it is this census's sharpest** |
| [ADR-123](../decisions/ADR-123.md) | **B** | an empty book REFUSES instead of reporting clean. Two seeds, two RED |
| [ADR-187](../decisions/ADR-187.md) | **B** | shared with tier 2, classified once |
| [ADR-225](../decisions/ADR-225.md) | **not a money-path landing** | **0** executable lines across all three of its money-path files, measured |
| [ADR-230](../decisions/ADR-230.md) | **B** | CARRIED from [ADR-244](../decisions/ADR-244.md) section 3.6 |
| [ADR-238](../decisions/ADR-238.md) | **not a money-path landing** | **0** executable lines in `checkout.ts`, measured |

**TIER 3: FOUR CLASS B, ZERO CLASS C, ONE NEITHER, TWO LANDING NO EXECUTABLE MONEY-PATH LINE.**

### 4.3 The two tiers together, and both numbers reported

| Outcome | Count |
| --- | ---: |
| **B**, an assertion watched RED then GREEN | **9** |
| **B on the surviving clause**, central finding superseded | **1** ([ADR-177](../decisions/ADR-177.md)) |
| **C**, the residue | **2** ([ADR-180](../decisions/ADR-180.md), [ADR-186](../decisions/ADR-186.md)) |
| **NEITHER**, the read transfers | **1** ([ADR-113](../decisions/ADR-113.md)) |
| **Not a money-path landing** | **2** ([ADR-225](../decisions/ADR-225.md), [ADR-238](../decisions/ADR-238.md)) |
| | **15** |

**AND [ADR-227](../decisions/ADR-227.md) SECTION 8's CLASSIFIER SCORES 15 OF 15 AS RESIDUE**, run
over these entries with [ADR-243](../decisions/ADR-243.md) section 5's word list transcribed.
**That is [ADR-244](../decisions/ADR-244.md) section 7.3 reproducing on a second and third tier**:
the class C **merge queue** here is two, the **outstanding-decision queue** is fifteen, and neither
may be reported without the other. **Every class B entry below carries a `WHAT IT DOES NOT COVER`
paragraph naming the choices its assertion does not reach.**

**RUN OVER THE WHOLE 53 THE SAME TRANSCRIPTION SCORES 53, AND THAT DISAGREES WITH
[ADR-244](../decisions/ADR-244.md), SO BOTH READINGS ARE PRINTED.** That entry's section 7.3 reports
**47** as residue and **6** as carrying no founder block. This reading finds **53 of 53** scoring
residue and **53 of 53** carrying a founder-read block, case-sensitively and case-insensitively
alike. **The fifty-three entries are the same fifty-three**: the three entry files added since
`52b5202` land no money-path file, so the difference is in the INSTRUMENT and not in the corpus.
**Which transcription is the faithful one is not settled here**, and it does not need to be:
[ADR-244](../decisions/ADR-244.md) section 7.1 already rules that no pattern over prose can ask
section 3's question, and a second pattern disagreeing with the first is that ruling arriving as
evidence.

### 4.4 The executable-line measurement, per entry

Take each entry's landing merge, restrict it to money-path files, drop every changed line that is
blank or opens with a comment marker, and count what is left.

| Entry | Executable money-path lines |
| --- | ---: |
| ADR-104 | 476 |
| ADR-157 | 168 |
| ADR-183 | 29 |
| ADR-186 | 25 |
| ADR-187 | 83 |
| ADR-193 | 53 |
| ADR-105 | 753 |
| ADR-113 | **662**, and section 6 is what that number is |
| ADR-123 | 39 (27 in `checkout.ts`, 12 in `replay.ts`) |
| ADR-225 | **0** |
| ADR-238 | **0** |

**ADR-225 AND ADR-238 REPRODUCE [ADR-244](../decisions/ADR-244.md) SECTION 4's MEASUREMENT
INDEPENDENTLY**, both entries having been in that entry's six. Each says so in its own words.
ADR-225: *"Every change in this pull request is a comment or a reason string."* ADR-238 rules three
obstructions and clears none.

---

## 5. [ADR-186](../decisions/ADR-186.md) IS CLASS C AND THE DEMONSTRATION IS EXECUTED

**A CLASS C IS NORMALLY ARGUED AND THIS ONE IS RUN.** [ADR-227](../decisions/ADR-227.md) section 6
condition 2 names the failure that makes a class C look like a class B: *"a tautology that was green
on an empty tree."* The question is therefore not whether SOMETHING goes red when this ruling is
reversed. It is whether what goes red is an independent property or a restatement of the one line
the entry wrote.

**ADR-186's CENTRAL CLAIM IS `psp_clearing` AND `reserve` ARE BOTH `asset`, WHICH IS EXACTLY THE
SHAPE [ADR-180](../decisions/ADR-180.md) WAS RULED CLASS C ON.** The entry's own founder block says
it: *"Nothing in the tree can falsify a `reserve` ruling by execution, because nothing posts against
it and nothing reads it, so this literal is a claim no behaviour depends on until something does."*

**FOUR PROBES, EACH APPLIED TO A MERGED MIGRATION AND RESTORED BYTE-IDENTICALLY.** The suite is
`packages/ledger`, `packages/db` and `packages/rail`, 36 files and **952** cases green before each.

| Probe | Result, and what the red case actually holds |
| --- | --- |
| `reserve` flips to `liability` in [`0055`](../../packages/db/migrations/0055_last_two_ledger_kinds.sql) **alone** | **RED, 1 of 952**, on *"a superseding constraint carries every arm the one before it carried"*. **That is a COPIES-AGREE property between `0055` and `0056` and says nothing about which kind is right** |
| `reserve` flips to `liability` in **both** copies | **RED, 4 of 952.** Three of the four are *"exactly one firm code is a liability"* and its relatives, which hold that `reserve` is NOT a liability and are silent on which of the other four it is |
| `psp_clearing` flips to `liability` in **both** copies | **RED, 4 of 952**, the same four, for the same reason |
| **`reserve` flips to `equity` in both copies, which is the reading [ADR-186](../decisions/ADR-186.md) section 4 argues against BY NAME** | **RED, 1 of 952, and that one case is `expect(Object.fromEntries(ARMS)).toEqual(RULED)`** |

**THE FOURTH PROBE IS THE WHOLE ARGUMENT.** `RULED` is a hand-written map at
[`chart-of-accounts-kinds.test.ts:163`](../../packages/ledger/test/chart-of-accounts-kinds.test.ts)
carrying `reserve: 'asset'`, and that literal is ADR-186's own ruling transcribed into a test file.
**951 of 952 cases are indifferent to whether `reserve` is an asset or an equity**, and the one that
is not is the sentence being read back to itself. That is condition 2's named failure, exhibited
rather than asserted.

**AND THE FILE'S OWN HEADER SEPARATES THE TWO KINDS OF ROW IN THAT MAP, WHICH IS WHY THIS IS NOT AN
ARGUMENT AGAINST THE TEST.** It says of `withdrawals_in_flight`: *"Its kind is a DERIVATION, not a
judgement -- `LT-06` credits the slot and `LT-07` debits it."* That derivation is held by
[`in-flight-obligation.test.ts`](../../packages/ledger/test/in-flight-obligation.test.ts) against the
postings' signs, independently of the map, **which is why [ADR-187](../decisions/ADR-187.md) is
class B and [ADR-186](../decisions/ADR-186.md) is class C.** The two rulings sit one line apart in
the same constant and are not the same kind of claim.

**WHAT WOULD MOVE ADR-186 OUT OF CLASS C is a posting.** The moment anything in this tree posts
against either code, its kind is constrained by the sign of the leg, and the assertion writes
itself. Both grounds ADR-177 refused these codes on are still live, which is the entry's own
section 2.

---

## 6. THE FINDING: 662 executable lines of the money-entering path landed under an entry that rules an API_CONTRACT row, and the transfer rule has nowhere to send the read

**`apps/api/src/routes/checkout.ts` IS HOW MERIT TAKES MONEY AND IT WAS ADDED ONCE, IN ONE MERGE.**
`git log --first-parent --diff-filter=A origin/main -- apps/api/src/routes/checkout.ts` returns
exactly one commit, `f5a3660`, *"session 220, P3-n, checkout, attribution inside the transaction"*.

**THE ONLY ADR FILE IN THAT MERGE IS [ADR-113](../decisions/ADR-113.md)**, whose subject is a single
row for `POST /affiliate/creatives` in [API_CONTRACT](../architecture/API_CONTRACT.md) section 7.
Its five rulings are about where the row goes, what its response carries, and whether the endpoint
needs elevation. **Not one of them is about the checkout handler.**

**THE ENTRY SAYS SO ITSELF, IN ITS LAST LINE, AND IT HAS SAID SO SINCE 2026-08-26:**

> **MONEY PATH by position rather than by content**: this row moves no money and the entry it ships
> with does. The `E2` line-by-line read is owed on the session, not discharged by this signature.

**SO ADR-113 IS NEITHER, UNDER [ADR-227](../decisions/ADR-227.md) SECTION 2's TRANSFER RULE, AND THE
TRANSFER HAS NOWHERE TO GO.** That rule reads *"an owed read transfers to the entry that lands the
diff"*. Here the entry that lands the diff and the entry in the merge are not the same object:
**there is no entry that lands the checkout handler, because no entry was written for it.** Five
later entries touch the file ([ADR-123](../decisions/ADR-123.md),
[ADR-187](../decisions/ADR-187.md), [ADR-225](../decisions/ADR-225.md),
[ADR-230](../decisions/ADR-230.md), [ADR-238](../decisions/ADR-238.md)) and every one of them rules
something else: an audit refusal, a ledger code, six citations, a write door, and three obstructions
it declines to clear.

**THIS IS THE EXACT INVERSE OF [ADR-243](../decisions/ADR-243.md) SECTION 3 AND IT IS THE WORSE
DIRECTION.** That error attributes one diff to two entries and inflates a queue by one. **This one
attributes 662 executable lines of the money-entering path to an entry that never argued them, and
it makes the queue look like it contains a reader for a file nobody has read.** A reader who opens
the money-path census learns that `checkout.ts` sits under `ADR-113`; a reader who opens `ADR-113`
learns it is about affiliate creatives.

**WHAT IS NOT CLAIMED.** Nothing here says the checkout handler is wrong, and nothing here reads it.
`checkout.test.ts` exists and is green. **What is missing is the ENTRY**: the document that states
what that handler's central claim is, so that [ADR-227](../decisions/ADR-227.md) section 3 has
something to classify. **Until one exists, `checkout.ts` cannot be class B, cannot be class C, and
cannot be counted honestly in either.**

**AND THE MEASUREMENT THAT WOULD FIND MORE OF THESE IS ONE COMMAND.** For every money-path file,
walk to the merge that ADDED it and ask whether the entry in that merge names the file. **This
census ran that walk on tiers 2 and 3 only**, so how many other money-path files sit under an entry
that does not argue them is **not measured here and is not guessed.**

---

## 7. Finding 2: a merged migration's own literal can drift from the constant that is watched, and only one side is in CI

**[ADR-187](../decisions/ADR-187.md)'s SECOND SEED WENT GREEN AND THAT IS REPORTED WITH THE SAME
PROMINENCE AS THE RED ONE.** The entry's ruling is that the eighth code is firm-scoped, and
[`0056`](../../packages/db/migrations/0056_eighth_ledger_code.sql) seeds one row to say so.

| Seed | Result |
| --- | --- |
| `0056`'s seeded row becomes `('withdrawals_in_flight', 'liability', 'identity')` | **GREEN, 20 of 20** in `in-flight-obligation.test.ts` |
| [`accounts.ts:75`](../../packages/ledger/src/accounts.ts)'s `withdrawals_in_flight: 'firm'` becomes `'identity'` | **RED, 8 cases** across two suites |

**SO THE SUITE HOLDS THE TYPESCRIPT COPY OF THE SCOPE AND NOT THE MIGRATION'S OWN.** The tree is not
defective: both say `firm` today, and ADR-187 is class B on its kind seed, which is the clause its
own heading makes. **What is true is narrower and it is the part worth carrying**: `0056`'s `scope`
literal and `LEDGER_ACCOUNT_SCOPE`'s can diverge, and the only instrument that would say so is
[`probe_ledger_constraints.sql`](../../scripts/db/probe_ledger_constraints.sql)'s `K3` block, which
needs a running PostgreSQL that `CI-02` does not have. **A merged migration is never edited, so a
divergence introduced there is permanent**, and the case that would catch it is a set comparison
this census did not write because writing it is a fourth copy's watcher and belongs to whoever holds
that fence.

---

## 8. Finding 3: [ADR-193](../decisions/ADR-193.md) had no assertion anywhere, and [ADR-244](../decisions/ADR-244.md)'s headline does not repeat here

**[ADR-243](../decisions/ADR-243.md)'s SURPRISE WAS THAT THREE OF ITS FOUR ENTRIES ALREADY CARRIED
AN ASSERTION AND NOTHING HAD NAMED IT, AND [ADR-244](../decisions/ADR-244.md) FOUND THE SAME AT
SCALE: *"what was missing was the record and not the control."* IN TIER 2 THAT IS NOT WHAT WAS
FOUND.** `grep -rl "0059\|LEDGER-C3" --include='*.test.ts' packages/ apps/` returned **nothing**
before this session. `LEDGER-C3` is a trigger on `ledger_transactions` refusing a chained reversal,
it was watched executing against PostgreSQL 16 by the session that wrote it, and **that run is not a
control**: it happened once, in the session that also wrote the migration, and nothing re-runs it.

**[`packages/db/test/reversal-chain.test.ts`](../../packages/db/test/reversal-chain.test.ts) IS
WRITTEN HERE**, 7 cases, and [ADR-247](../decisions/ADR-247.md) section 3.9 carries its three
seeds. **Seven of the nine class B entries
in these two tiers rest on assertions earlier sessions wrote; one needed a new one.** That is one in
nine against ADR-243's one in four, and neither is a rate anybody should carry forward.

---

## 9. What this document does not establish

- **It classifies fifteen entries and no others.** **Thirty-two** of the 53 money-path entries are
  now in a read tier, counting tier 1's twenty-one and the four this census carries rather than
  re-derives. **Twenty-one money-path entries fall in no tier 1, 2 or 3 and are read by nobody**:
  `ADR-102` `ADR-106` `ADR-107` `ADR-112` `ADR-120` `ADR-122` `ADR-126` `ADR-127` `ADR-128`
  `ADR-164` `ADR-171` `ADR-200` `ADR-207` `ADR-209` `ADR-213` `ADR-216` `ADR-221` `ADR-226`
  `ADR-229` `ADR-239` `ADR-241`. **No ratio from tier 2 or tier 3 is carried to them**, and
  [ADR-244](../decisions/ADR-244.md) section 7.1 is why one would be false.
- **It does not measure the true residue.** Section 4.3's two is an upper bound on these fifteen and
  on nothing else.
- **It does not read `checkout.ts`.** Section 6 measures an attribution and reads no handler.
- **It does not explain the `accepted` count's drop by one**, now unexplained for a third reading.
- **It writes one assertion and no invariant.** No `RI-` number is taken.
