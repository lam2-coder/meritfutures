# The residue re-derived against today's tree, and the classifier that produced it read against four entries by hand, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs:166`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. **The ruling it feeds is [ADR-243](../decisions/ADR-243.md).**

**EVERY NUMBER BELOW WAS DERIVED ON THIS BRANCH AT `6e8891ca`, WHICH IS `origin/main`'s HEAD ON
2026-08-29.** None is carried from [ADR-227](../decisions/ADR-227.md), and the two readings are put
beside each other in section 2 rather than one replacing the other.

**ONE MEASUREMENT PROBLEM HAD TO BE FIXED BEFORE ANY OF THIS COULD BE DERIVED AT ALL.** The session
container clones this repository SHALLOW: `git rev-parse --is-shallow-repository` returned `true`,
`.git/shallow` carried 14 entries and `git log --oneline origin/main` reported **221** commits
against the **3,529** that exist. The landing-merge derivation walks first-parent history back to
the commit that ADDED each entry file, so on a shallow clone it silently reported **19** money-path
entries instead of 52: every entry older than the graft returned an empty diff and scored as landing
nothing. **This is recorded because a session that ran the published command and reported 19 would
have reported a backlog a third of its real size, with no error and no warning.** The clone was
unshallowed with `git fetch --unshallow origin` before anything below was derived.

---

## 1. The population, derived live

Same commands as [the approval population review](2026-08-29-approval-population.md) sections 2 and
3, re-run:

```
for f in $(git ls-tree -r --name-only origin/main docs/decisions/ | grep -E 'ADR-[0-9]+\.md$'); do
  git show origin/main:$f | head -1        # status: accepted | proposed
  m=$(git log --first-parent --diff-filter=A --format=%H origin/main -- "$f" | tail -1)
  git diff --name-only "$m^1" "$m" | grep -E '^(apps|packages)/' \
    | grep -vE '/(test|tests)/|\.test\.|/fixtures/'
done
```

with the money-path predicate transcribed unchanged from that review's section 3.1, wallet routes
included.

| Measured over `docs/decisions/ADR-*.md` on `origin/main` at `6e8891ca` | Count |
| --- | ---: |
| entry files | **226** |
| carrying `status: accepted` in their first line | **103** |
| carrying `status: proposed` in their first line | **123** |
| of the 123, carrying a `What a founder read adds` block | **112** |
| of the 123, landing at least one **money-path** file in their landing merge | **52** |
| distinct **money-path files** landed under a `proposed` entry | **68** |
| merged migrations, of which carrying `E2 READ: MONEY PATH` | **67**, of which **52** |

**`accepted` WENT DOWN BY ONE AND THAT IS REPORTED RATHER THAN ROUNDED.** ADR-227's last reading was
104 accepted at `6613b8f9`; this one is 103 over a corpus seven files larger. The delta is not
explained here and is named so the next session does not find it as a surprise.

## 2. The trend, ADR-227's four readings and this one

| Reading | Entry files | `proposed` | Money-path entries | Money-path files |
| --- | ---: | ---: | ---: | ---: |
| `21afc5d8` (ADR-227 section 2) | 212 | 108 | 42 | 62 |
| `dddb3860` (section 10.2, predicate widened) | 214 | 110 | 42 | 64 |
| `a86971c6` (section 10.3) | 216 | 112 | 44 | 65 |
| `bfe690fb` (section 10.4) | 218 | 114 | 46 | 66 |
| `6613b8f9` (section 10.5) | 219 | 115 | 47 | 66 |
| **`6e8891ca`, THIS READING** | **226** | **123** | **52** | **68** |

**THE SHAPE ADR-227 REPORTED HAS HELD FOR ANOTHER DAY AND THE RATE HAS NOT SLOWED.** Money-path
entries 42, 44, 46, 47, **52**. Nobody read any of them in that time either.

## 3. The money-path predicate over-counts by exactly one today, and the reason is structural

52 money-path entries land under **51** distinct merges. One merge, `28f050b1` (*"ADR-174/175, the
external leg moves `firm_treasury` by ZERO"*), added two entry files, so the predicate attributes
`packages/rail/src/settlement.ts` to **both** of them.

**[ADR-175](../decisions/ADR-175.md) SAYS IN ITS OWN WORDS THAT IT LANDS NOTHING**: *"No migration
lands and no code changes, so no `E2` read is owed by this entry; the read is owed on the caller
that first mints a key under this convention."* That is exactly [ADR-227](../decisions/ADR-227.md)
section 2's transfer rule, written by the entry six days before the rule existed.

**SO THE MONEY-PATH ENTRY COUNT IS 52 BY THE PREDICATE AND 51 BY THE ENTRIES.** The error is small
today and it is the same SHAPE as the two ADR-227 already recorded: a predicate that reads git
attributes a shared merge's whole diff to every entry in it. It grows with the practice of landing
two entries in one pull request, which this corpus does deliberately when a session splits.

**AND THE PREDICATE IS STILL INCOMPLETE IN THE OTHER DIRECTION.** ADR-227 section 10.2's hole is
open: [ADR-223](../decisions/ADR-223.md) declares an `E2` read owed on
[`security-headers.ts`](../../apps/api/src/security-headers.ts) and the predicate still does not
match that file. **52 remains a floor.**

## 4. Tier 1, re-derived by file rather than carried

ADR-227 section 8's tier 1 is *"money leaving the firm: payout request, payout approval, rail
settlement"*. Transcribed to a file predicate over each entry's landing merge -- `payouts.ts`,
`admin-payouts.ts`, `wallet-withdrawals.ts`, `admin-wallet.ts`, `packages/rail/`, and the payout,
withdrawal and dual-control migrations `0051`, `0057`, `0068`, `0070`, `0072` -- the tier is:

`ADR-140` `ADR-169` `ADR-174` `ADR-175` `ADR-176` `ADR-177` `ADR-180` `ADR-189` `ADR-191` `ADR-192`
`ADR-197` `ADR-199` `ADR-211` `ADR-212` `ADR-228` `ADR-230` `ADR-231` `ADR-232` `ADR-233` `ADR-234`
`ADR-237`

**Twenty-one entries.** ADR-227's own tier 1 was 9 at its first reading and 14 at its last, and it
selected on the residue classifier as well as on the tier. **This list selects on files alone**, so
it is the wider of the two and it is the one to work from, because whether an entry is class B or
class C is a decision about its claim and not a filter to apply before reading it.

## 5. THE RESIDUE CLASSIFIER IS OVER-INCLUSIVE AT TIER 1, AND FOUR ENTRIES READ BY HAND ARE THE EVIDENCE

ADR-227's residue is *"the 42 money-path entries, classified by whether the entry's own `What a
founder read adds` block declares an outstanding judgement"*. Re-run over the 52 with a pattern of
this session's own transcription (`judgement`, `a choice`, `the first thing to decide`, `founder
question`, `is the founder's`, `founder's call`, `and this entry cannot`):

| Over the 52 money-path entries | Count |
| --- | ---: |
| whose founder-read block declares an outstanding judgement | **46** |
| whose block does not, or which carry no block | **6** |

**46 IS NOT THE CLASS C RESIDUE AND THIS SESSION CAN SHOW IT RATHER THAN ARGUE IT.** Four tier-1
entries were read in full this session -- [ADR-140](../decisions/ADR-140.md),
[ADR-176](../decisions/ADR-176.md), [ADR-191](../decisions/ADR-191.md) and
[ADR-192](../decisions/ADR-192.md) -- and **the classifier scores all four as residue.** All four
have a central claim that is a PROPERTY, all four now carry a named mechanical assertion, and every
one of those assertions was watched failing on the real tree. The transcripts are in
[ADR-243](../decisions/ADR-243.md) section 4.

**THE TWO PREDICATES ARE NOT MEASURING THE SAME THING, AND THAT IS THE FINDING.**
[ADR-227](../decisions/ADR-227.md) section 3 classifies a diff by **the shape of its central
claim**. The classifier asks whether the entry names **any** outstanding choice anywhere in its
founder block. Those come apart immediately, because `RI-13` REQUIRES every entry to write that
block, and a good entry names residual choices even when its central claim is a property.
[ADR-176](../decisions/ADR-176.md) is the clean case: its heading claims that the request path
records the approval and does not post it, which is a property and is asserted at four sites, and
its founder block then names three genuine choices, none of which is that claim.

**THE CORRECTION MAKES THE RESIDUE SMALLER AND IS THEREFORE HELD TO A HIGHER BAR THAN ADR-227's
UPWARD ONE WAS.** ADR-227 corrected its own classifier from 30 to 36 and said, correctly, that a
measurement corrected only where the correction flatters the measurer is not a measurement. **So no
number is proposed here.** What is established is a demonstration on four entries, each with an
assertion that goes red, and the statement that **the true class C residue is smaller than 46 by an
amount nobody has measured**. **Four of fifty-two is not a sample and this document does not treat
it as one.**

**HOW THE REMAINING 48 GET CLASSIFIED IS BY READING THEM.** That is what ADR-227 section 10.3
already concluded twice from the other direction: *"read each entry's own declaration rather than
pattern-matching around it."* This reading is the third instance and the first where the pattern
erred in the direction that would have flattered a session clearing a queue.

## 6. What this document does not establish

- **It does not classify the other 48.** Section 5 says why a number would be false.
- **It does not measure the true residue.** It measures a classifier and refutes it on four cases.
- **It does not touch the `accepted` count's drop by one**, which is named in section 1 and not
  explained.
- **It reads no entry outside tier 1.** Every claim above about entry CONTENT is about
  `ADR-140`, `ADR-175`, `ADR-176`, `ADR-180`, `ADR-191` and `ADR-192`, which are the six read in
  full this session. Everything else is a count over file lists and first lines.
