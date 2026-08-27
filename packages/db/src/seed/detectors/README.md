# The detector registry source

**[P7 section 8](../../../../../docs/plans/P7-risk-and-abuse.md), slice `P7-d`.** The cited transcription of [M07 section 3.2](../../../../../docs/plans/M07-risk-abuse.md), the generator that turns it into `detector_definitions` rows, and the rows it generated.

This directory is where `detector_definitions` gets its rows. That table is the answer to **"why did this not fire in March"**, and `INV-M7-04` is what makes it a precondition rather than a convenience: a run that cannot record the parameters it ran under cannot answer the question. A detector whose thresholds live only in code has no version, no effective date, and no answer.

**It is also `P7-j`'s strip list.** Under `INV-M7-10` the evidence pack's `trader` profile computes what it strips from the `is_sensitive` column rather than from a hand-written list, so a row marked wrong here leaks a detector internal to a trader six slices from now.

---

## What is here

| File | What it is |
|---|---|
| [`m07-detectors-v1.source.json`](m07-detectors-v1.source.json) | The transcription. Eighteen detectors, every value carrying the line of M07 it was read from. **This is the file a reviewer reads** |
| [`generate.mjs`](generate.mjs) | Source to rows. It refuses rather than guesses, and every rejection names a finding |
| [`m07-detectors-v1.rows.json`](m07-detectors-v1.rows.json) | The generated rows, committed and reviewed. Do not edit: edit the source and regenerate |

The loader is **not** here. It opens no database connection, imports no client and writes no row, which is the same division [`../calendars/generate.mjs`](../calendars/generate.mjs) states about itself.

```
node generate.mjs m07-detectors-v1.source.json --out m07-detectors-v1.rows.json
node generate.mjs m07-detectors-v1.source.json --check m07-detectors-v1.rows.json
```

Every rule has a seeded violation in [`../../../test/seed-detectors.test.ts`](../../../test/seed-detectors.test.ts), watched failing **on its own finding**.

---

## The table already exists, and this slice does not declare it

[`0008_risk.sql`](../../../migrations/0008_risk.sql) creates `detector_definitions` with `(detector, version)` as its primary key, `parameters jsonb NOT NULL`, `description`, `effective_from`, `effective_to`, and `is_sensitive boolean NOT NULL DEFAULT true`. **No migration number is allocated to this slice and none is taken.** The first suite in the test asserts the DDL is there and carries every column a generated row holds, so a missing column is a red test before anything else runs rather than a loader failure later.

---

## What makes `status: "transcribed"` mean something

The calendars source file next door carries the same word and the same danger, one authority over. There, the failure is **a holiday written from recollection**: it looks identical to a correct transcription, passes every structural check, and is falsified retrospectively, after trading.

**Here the failure is a THRESHOLD written from judgment.** A row reading `correlation_floor_bp: -8000` looks exactly like a row reading `-7500`, on a page of eighteen of them, and the first thing that could falsify the wrong one is a ring that was not flagged. Judgment and transcription are indistinguishable once they are both JSON.

**The difference is that here the authority is a file in this repository, so the check is mechanical.** Every value carries a `cite` of the form `<path>:<line>` and a `quote`, and the generator **opens that file at that line and requires the quote to occur in it verbatim**. A paraphrase fails. A drifted line number fails. A number nobody can point at fails, because there is no line to point it at. That is 197 citations on this transcription, and it is the assertion `CLAUDE.md` asks for in place of a bigger model: the reconciliation session's three worst errors were each a claim never checked against its primary source.

**And the authority itself is digested.** A cite that still resolves against a *different* M07 has silently changed meaning, so `provenance.authority_sha256` is re-derived on every run and a disagreement is a rejection.

---

## `null` is not zero, and `unstated` is not `not_applicable`

Every parameter carries a state, and the three-way distinction is the whole design.

| State | What it says | `value` |
|---|---|---|
| `stated` | M07 gives this value, at the cite, in the quote | the value |
| `unstated` | M07 **names this knob and gives it no number** | `null` |
| `not_applicable` | the knob **cannot exist** for this detector, and here is why | `null`, plus a `reason` |
| `contextual` | M07 states it per **condition** rather than per detector | `null`, plus `cases` |

**`unstated` and `not_applicable` are not interchangeable.** `unstated` sends a later session to find the number M07 owes; `not_applicable` tells them there was never one to find. `D-10` has no numeric threshold at all because its statistic is a condition, and `D-12` writes no `risk_flags` row at all because its output is a watched-cluster set. Both facts are **positive statements** rather than absences, which is [ADR-042](../../../../../docs/decisions/ADR-042.md) F-1's lesson applied to a different table.

**This is also why the citation travels into the row.** `0008_risk.sql`'s own header says a threshold tuned by deploy is one whose "why did this not fire in March" answer is an archaeology exercise. A threshold whose *provenance* lives in a JSON file in git and whose *value* lives in the database is the same archaeology one layer in. So a row's `parameters` holds `{state, value, unit, cite, quote}` per parameter rather than a bare number, and `INV-M7-04` is answerable from the row alone. The wrapper also makes the three-valued case unmissable: `null` under a bare number reads as zero to a careless consumer and `{state: "unstated", value: null}` cannot.

---

## Eleven of the eighteen rows carry no number, and that is `OQ-M7-02`'s state

M07 section 10 says it in its own words: *"Every threshold in section 3.2 is currently a number from the dossier or from judgment."* Most of them are not written down anywhere.

Seven rows carry at least one stated number: **`D-01`** (a 2 second window), **`D-02`** (20 trading days, a -8000 bp floor), **`D-09`** (more than one unrelated identity), **`D-16`** (a 10000 bp exclusive ceiling on an inferred edge), **`D-12`** (zero trading data), **`D-13`** (5 trading days, a -9500 bp floor) and **`D-18`** (four required legs). The other eleven are `unstated` throughout, each with the M07 phrase that names the knob.

**The posture is recorded and it is unexercised, which is the honest thing to say about it.** `OQ-M7-02` recommends tuning for recall over precision during beta. That is advice about **which way to be wrong when choosing a number**, and this seed chooses no number: every threshold is either quoted from M07 or left null with the phrase that names it. So the posture governs nothing here and will govern the first session that fills a null in. Writing a number and citing the posture for it would be exactly the move *"a number you cannot cite is the finding"* forecloses.

**The rows are data with an effective date**, so the founder can move any of them without a deploy, which is `SD-M7-03`'s whole reason. Writing them is not the same as ruling them.

---

## Money is integer cents, and a decimal in M07's prose becomes basis points

`generate.mjs` walks **every number in the generated artifact** and rejects a non-integer on `float-in-seed`. M07 writes two correlations as decimals, `-0.8` for `D-02` and `-0.95` for `D-13`; both are carried as basis points, `-8000` and `-9500`. A Pearson correlation is a pure ratio in `[-1, 1]`, so basis points express it **exactly**, with no rounding at all.

---

## `is_sensitive` is uniformly `true`, and that is a finding rather than a result

`INV-M7-10` is unqualified: *"Detector parameters never appear in a trader-audience evidence pack."* Nothing in M07 designates any detector parameter as trader-visible, so every row is sensitive and **no row is a counter-example**. Each row states its own reason, in the row rather than in this file, and no two reasons are the same, because a reason copied from a neighbour is a value that was not decided.

**Two rows are worth reading before the others, because they are where the argument is closest.**

- **`D-07`** is where marking sensitive **over-strips**. Its bound is the plan maximum, which a trader can read off the plan catalogue, so stripping it removes a number the trader already has. It stays `true`: the invariant is unqualified, the over-strip costs a trader nothing, and an exception carved here to save one lookup is the precedent for carving one where it costs something.
- **`D-02`** is where the number is **already leaked**. `AS-M7-02` calls `-0.8` industry folklore and assumes the ring knows it. It stays `true` because folklore is not disclosure: confirming the number turns a guess into a specification, and the whole defence of the detector is that the ring must guess.

**THE CONSEQUENCE BELONGS TO [`P7-j`](../../../../../docs/plans/P7-risk-and-abuse.md) AND IS RECORDED HERE BECAUSE THIS IS THE FILE THAT KNOWS IT.** While this column is uniform, a `trader` pack that **computes** its strip list from `is_sensitive` and one that strips every detector **unconditionally** produce byte-identical output. So `GS-112` passes either way and `INV-M7-10`'s mechanism is untested. `P7-j` needs a fixture row with `is_sensitive: false` to tell the two apart, and it **cannot come from this seed**, because there is no M07 line to cite for one. The test carries an assertion that goes red on the day the column acquires its first `false`, so whoever writes it must revisit `P7-j`'s test in the same change.

---

## The two sentences that are read, named, and deliberately not encoded

**`P7` is the phase whose temptation is a Behavior column in an accepted entry**, and M07 carries that column twice.

| Where | The sentence | Why it is not a row |
|---|---|---|
| `D-16`'s own statistic cell | *"Hard links auto-enforce"* | `OQ-M7-05` is **open**. Section 3.1's third tier says *"no state changes automatically"* and [M19](../../../../../docs/plans/M19-kyc-identity.md) `INV-M19-04` agrees, and M07 section 10 says in terms that this plan does not extend one ruling's reach by assumption |
| section 7.9's link-class table | *"Auto-enforce."*, on the Hard row naming `D-08` and `D-09` | The **class** is a fact about the strength of the signal and is recorded. The **behaviour** is the half [ADR-155](../../../../../docs/decisions/ADR-155.md) and `INV-M7-02` foreclose |

A seed that merely **omitted** them would be indistinguishable from a seed whose author never read them, and the next session would encode them. So the source carries a `refusals` block naming both, with the authority for each refusal beside it, and the generator **requires the block to exist**.

The refusal is mechanical rather than trusted to a comment. Any parameter whose *value* spells an enforcement outcome is rejected on `parameter-implies-enforcement`; every row's `flag_status` is `open` or `not_applicable` and nothing else; and `D-16`'s `auto_enforce` is `not_applicable` with its reason, because writing **either** value would settle an open question by being written.

---

## `D-18` tests `IS FALSE`, and the value is seeded so a code path can be checked against it

`footprint_present` is three-valued because the lookup **fails open**: `null` means the vendor was not reached and `false` means the vendor looked and found none. **A detector written against `IS NOT TRUE` scores every vendor timeout as a fleet member**, which converts a supplier outage into a flood of flags against real customers on the day Merit can least afford it.

M07 names this as the one a reader would build wrong, so the test lives in the registry as **data**: `footprint_present_test: "IS FALSE"`. `generate.mjs` refuses `IS NOT TRUE` there on its own finding, and `P7-h`'s detector has something to be checked against rather than a comment to be trusted.

---

## What a reviewer should check, in the order it matters

1. **The `is_sensitive` reason on every row.** It is the only value in this file whose consequence is a leak rather than a missed detection, and it is the one thing no mechanical check can decide.
2. **The two `chosen` values.** `version: "v1"` and `effective_from: "2026-08-27"` are **not cited**, because M07 gives no version vocabulary and no effective date. They are declared as choices with reasons, and the generator refuses a `chosen` value that carries a `cite` at all.
3. **The `posture.routing` block**, which records `OQ-M7-02`'s second half as **contested** and writes neither reading. Read literally, *"everything above severity 3 going to the digest"* sends severity 4 and 5 to the digest, and that is the band `G-HOLD-REQUIRED` reads to hold a payout. It bears on money and it is the founder's.
4. **The severity cases.** Severity is recorded per **condition**, because M07 says *"Severity is contextual, not per-detector"*, and because moving a detector from 3 to 4 changes who gets held.
