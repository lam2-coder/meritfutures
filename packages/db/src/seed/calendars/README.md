# The trading calendar source

**[ADR-042](../../../../../docs/decisions/ADR-042.md), [P1 S-E](../../../../../docs/plans/P1-SE-trading-calendar.md) session S-E3.** The hand-transcribed exception list, the retrieved publication it was transcribed from, and the generator that turns the exceptions into the full row set.

This directory is where `trading_calendar` gets its rows. That table decides what a trading day **is**, and every counter the engine keeps is counted in trading days (R-01, R-02, R-05, R-34, R-37, R-47). **A wrong value here changes rule outcomes with no change to a line of engine code, and it does so silently**, because the engine is a pure function of the calendar it is handed and three mechanisms guarantee it cannot check for itself: `types: []`, `merit/engine-purity`, and the `RI-01` manifest check.

---

## What is here

| File | What it is |
|---|---|
| [`cme-2026-2028.source.json`](cme-2026-2028.source.json) | The hand-transcribed **exceptions**: the holiday list, the early-close list with each early close's CT time, the coverage bounds, the session rule, and the provenance block. **Currently a shape awaiting its values**, see below |
| [`generate.mjs`](generate.mjs) | Exceptions to full rows. Every session carries **both** the CT wall time and the UTC instant. Also the OQ-SE-04 diff |
| `<artifact>` | The retrieved publication, committed verbatim. **Not present**, see below |
| `cme-2026-2028.sessions.json` | The generated rows, committed and reviewed. **Not present**, see below |

The loader is **not** here yet. It is S-E4, it lives in `../` (`packages/db/src/seed/`) for [ADR-008](../../../../../docs/decisions/ADR-008.md)'s reason, and it writes `trading_calendar`, `trading_calendar_loads` and `trading_calendar_revisions` as [`0032`](../../../migrations/0032_trading_calendar_holidays_coverage_revisions.sql) defines them.

---

## The retrieval that did not happen, stated plainly

**The session that wrote this directory could not reach `cmegroup.com`.** The environment's egress policy answered `403` to `CONNECT www.cmegroup.com:443`, and to `iana.org` and `nyse.com` besides; only GitHub and the package registries are reachable. The proxy's own instruction for that class is to report the blocked host rather than route around it.

**So the exception lists are `null` and nothing was written into them.** That is the whole of what is missing, and the reason it was left missing rather than filled in is worth stating in the place a future reader will ask:

> **A holiday list written from recollection is exactly the failure `TR-01` names**, "every value transcribed from the named authority and never from an implementation", with the added defect that the implementation in question is a model's memory of a publication rather than the publication. It would look identical to a correct transcription, it would pass every structural check in `generate.mjs`, and the first thing that could falsify it is `SD-M2-04`'s divergence alarm, **retrospectively, after trading**.
>
> And it would defeat OQ-SE-04 in the same stroke. The ruling rejects a calendar package because "it encodes someone else's reading of the same publication, a second instance of the same error class rather than an independent check". **Two recollections of the same publication are worse than that**: they are perfectly correlated by construction, so the diff comes back empty and proves nothing at all. The ruling's own words for it are "the check reports success while proving nothing".

**`null` is not the empty list, and the distinction is load-bearing.** `holidays: []` asserts that the exchange closes on no day of the year: it loads clean and makes every counter advance through Christmas. `holidays: null` asserts that nobody has read the publication yet, and `generate.mjs` refuses it. This is [ADR-042](../../../../../docs/decisions/ADR-042.md) F-1's lesson, that a holiday is a **positive fact rather than an absence**, applied one layer earlier to the file, and F-4's, that an uncovered day is **unknown rather than a holiday**.

Everything that does not depend on those values is finished: the file's shape, the coverage ruling, the session rule, the generator, the DST cross-check, the OQ-SE-04 diff, and eighteen seeded violations each watched failing on its own finding.

---

## Completing the transcription

Run from an environment that can reach `cmegroup.com`.

### 1. Retrieve and commit the artifact

Save the bytes the exchange served, unmodified. Not a rendering, not a copy-paste, not a summary: **the artifact is what makes the transcription checkable a year from now**, when the page has been redesigned and the transcriber has forgotten.

```
curl -sS -L -o cme-holiday-calendar-<yyyy-mm-dd>.html \
  'https://www.cmegroup.com/tools-information/holiday-calendar.html'
shasum -a 256 cme-holiday-calendar-<yyyy-mm-dd>.html
```

Both the **holiday calendar** and the **published Globex hours for the listed product groups** are named as the source by ADR-042. If they are two documents, commit two artifacts and name both; `provenance.artifact` and `provenance.source_url` take a list in that case, and `generate.mjs` needs the one-line change to accept it. Do not summarise two documents into one artifact.

### 2. Transcribe the exceptions

Into `cme-2026-2028.source.json`: `holidays`, `early_closes`, the provenance block, and `declared`. Set `status` to `"transcribed"`, which is the transcriber's positive statement that every value below was read off the artifact. Delete the `_status_note` and each `_note`.

**`close_ct` on an early close is the LATEST close across `ES`, `MES`, `NQ`, `MNQ`, `CL` and `GC`** ([ADR-042](../../../../../docs/decisions/ADR-042.md) F-3), and the **per-group times go in `notes`**, because `session_close_at` carries only one of them. R-01 is a containment lookup, so the only thing at stake is whether a fill can fall outside every session, and the latest close guarantees it cannot.

**Read [The one transcription hazard the ruled model does not settle](#the-one-transcription-hazard-the-ruled-model-does-not-settle) before deciding whether a day is a holiday or an early close.** It is the judgement call in this task, and both readers must be given it identically or the blindness is broken by the instructions rather than by the file.

### 3. Generate, and commit what it generated

```
node generate.mjs cme-2026-2028.source.json --out cme-2026-2028.sessions.json
```

The generator refuses rather than guesses. Every rejection names a finding (`holiday-on-a-weekend`, `early-close-on-a-holiday`, `ct-and-utc-disagree`, ...) and each has a seeded violation in [`../../../test/trading-calendar-generator.test.ts`](../../../test/trading-calendar-generator.test.ts).

**The generated file is committed and reviewed.** That is [P1 S-E](../../../../../docs/plans/P1-SE-trading-calendar.md) section 3.1: the reviewable artifact still exists and git holds its history. It is regenerated and diffed by `CI-06m` (S-E5), so it can never drift from its source.

### 4. The second, blind transcription

[ADR-042](../../../../../docs/decisions/ADR-042.md), OQ-SE-04, ruled: **"second transcription, and the blindness is the condition. A second reader who can see the first rationalises disagreements rather than surfacing them. Transcribe independently, diff, require it empty."**

```
node generate.mjs --diff cme-2026-2028.source.json /path/to/second-reader.json
```

**What the command can hold and what it cannot.** It holds the diff, and it refuses to call an empty diff meaningful when the two `artifact_sha256` values differ, because two readers who read different bytes agreeing about a holiday list have agreed about nothing. **It cannot hold the blindness.** Blindness is a property of how the second file came to exist, and only the procedure and the person following it can hold that. A green result that implied otherwise would be the thing `falsify.mjs` exists to prevent: a check that cannot fail.

So the procedure, and every line of it is there to remove a way the second reader could see the first:

1. The second reader works from **the committed artifact and this section**, and from **no other file in this directory**. Not the first transcription, not the generated sessions, not a diff, not a review comment quoting a date.
2. They write a **complete** source file of their own, including their own `retrieved_at`, `retrieved_by` and `id`. A partial file compared against a full one is a review.
3. The diff is run by **a third party, or after both files are committed**, never by the second reader mid-transcription. A reader who can run the diff can converge on the first file one date at a time and the diff still ends empty.
4. **A disagreement is resolved against the artifact**, never by picking a reader. If the artifact cannot settle it, the artifact is the wrong artifact and step 1 starts again.
5. `notes` and the provenance fields that differ by construction are **not** compared, deliberately: requiring two readers to phrase per-group close times identically would push the second toward copying the first, which is the one thing the ruling forbids.

**A calendar package is rejected as the second reader** and the rejection is the sharper half of the ruling: it is one more transcription of the same CME publication, made by somebody with no more access to the exchange than Merit has, and **it correlates with the first transcription on exactly the days both readers would misread**.

---

## The one transcription hazard the ruled model does not settle

**This needs a founder ruling and it is not settled by ADR-042.** It is raised here, in the file the transcriber reads, rather than only in a session log.

The ruled model has two states for a day the exchange does not trade normally:

- **A holiday**, which under F-1 carries **no session at all**: `session_open_at` and `session_close_at` are `NULL`, enforced by `trading_calendar_holiday_has_no_session`.
- **An early close**, which is a **full trading day for every counter** (B4 #3, [EC-005](../../../../../docs/edge-cases/EC-005.md)) with `session_close_at` brought forward.

**CME's own publication uses "holiday" for both.** Several days it lists as holidays still carry a shortened Globex session, and some list an early close on the day and a full closure the next. So a day can be published as a holiday and still be a day on which **a fill can occur**.

**If such a day is transcribed as a holiday, the row carries no session, and R-01's containment lookup finds no session containing the fill.** That is the same orphaned-fill failure F-3 exists to prevent, arriving through the other door: F-3 guards against a close time that is too early, and this is a session interval that is absent entirely.

**The recommendation, offered without deciding it:** a day on which any of `ES`, `MES`, `NQ`, `MNQ`, `CL` or `GC` trades at all is an **early close**, however the publication labels it, and `is_holiday` is reserved for days on which none of them trades. That keeps `is_holiday` meaning what `0032`'s constraint says it means, and it keeps every fill inside a session. **The cost is that the calendar's `is_holiday` will disagree with the word "holiday" on the exchange's page**, which is a documentation problem rather than a containment one, and the disagreement belongs in `notes`.

**What it is not:** it is not a schema change, and `0032` is unaffected either way. It is a transcription rule, and it has to be settled **before** the transcription rather than after, because both readers must be given the same one or the second transcription is checking a different question than the first.

---

## Two digests, and confusing them is easy

| Digest | Of what | Answers |
|---|---|---|
| `provenance.artifact_sha256` | The retrieved publication, the bytes the exchange served | Is the committed copy of the publication the one that was read |
| `generated.source_sha256`, and `trading_calendar_loads.source_digest` | **The source JSON file itself** | Are the rows in the database the ones this transcription produced |

Both are needed and neither substitutes for the other. The first is provenance and the second is the round trip.

---

## Why a generator at all, and why it is not the thing B4 #1 forbids

**Hand-maintaining a full year is two hundred and fifty chances to be wrong**, against a holiday-plus-early-close list that is a few dozen values. So the file holds exceptions and the sessions are generated.

**B4 #1 forbids the *engine* deriving a trading day from a timestamp at runtime.** It does not forbid a build step whose output is committed, digest-pinned and thereafter read as data. Nothing in `generate.mjs` runs in a request, the engine never imports it, and what the engine eventually reads is the committed JSON and the rows loaded from it. [ADR-042](../../../../../docs/decisions/ADR-042.md) states the distinction for exactly this reason: a careful future reader will otherwise read the generator as the thing the rule exists to prevent.

**Every UTC instant is converted through `Intl` with `timeZone: 'America/Chicago'` and then rendered back and required to match.** No CT wall time in this repository is converted by hand. The generated file states **both** the CT wall time and the UTC instant so that the loader **verifies rather than computes** (S-E4), and the DST transitions inside coverage are discovered from IANA and checked against the published United States rule, which is the only form of DST check that can fail.

---

## The first artifact landed, and it covers one holiday (2026-08-17)

[`cme-trading-hours-2026-09-06-to-2026-09-08.retrieved-2026-08-17.xlsx`](cme-trading-hours-2026-09-06-to-2026-09-08.retrieved-2026-08-17.xlsx), SHA-256 `70c3a6370cae35c8c3189c7a580d974261be43914d85a6c65d981e5bfb2793b2`, retrieved by the founder from CME Group's **Trading Hours** tool on 2026-08-17 from an environment that can reach `cmegroup.com`.

**It is NOT wired into `provenance.artifact` and `status` stays `awaiting-transcription`, deliberately.** It is a three-day window, not the holiday calendar. Naming a one-holiday export as *the* artifact would let a later session read `provenance.artifact` as a complete source and transcribe against it, and that reader would find eight or nine holidays a year missing with nothing in this directory telling them so. **`null` is still not the empty list**, one layer further out.

**What it does settle, and it settles the hard one.** It is Labor Day 2026, in the per-asset-class form [ADR-042](../../../../../docs/decisions/ADR-042.md) F-3 needs, and it is a worked example of the judgement call [The one transcription hazard the ruled model does not settle](#the-one-transcription-hazard-the-ruled-model-does-not-settle) names:

| Column | Equities |
|---|---|
| **Sun 2026-09-06** | `17:00 Trade Date: 2026-09-08 (OPEN)` |
| **Mon 2026-09-07** | `12:00 Trade Date: 2026-09-08 (PREOPEN)`, `17:00 Trade Date: 2026-09-08 (OPEN)` |
| **Tue 2026-09-08** | `16:00 Trade Date: 2026-09-08 (CLOSED)` |

**Sunday's open carries trade date 2026-09-08, not 2026-09-07.** So Labor Day Monday is **a holiday and not an early close**: it is never a trade date at all, and what happens at 12:00 CT on Monday is a pause inside the 2026-09-08 session, which runs Sunday 17:00 CT to Tuesday 16:00 CT. A reader seeing "12:00" and reaching for `early_closes` would put a session on a day the exchange assigns no trade date to, and `generate.mjs` would accept it, because `holiday-on-a-weekend` and `early-close-on-a-holiday` do not fire on a well-formed row that is simply about the wrong day.

**The per-asset-class spread is the other thing it makes concrete.** On the Monday: Equities and Interest Rates pause at 12:00, Energy and Metals at 13:30, Grains opens 19:00. F-3's rule is that `close_ct` takes the LATEST close across `ES`, `MES`, `NQ`, `MNQ`, `CL` and `GC`, and the per-group times go in `notes`.

**Still needed: the holiday calendar itself**, the list of closures and early closes across the declared coverage. That is a different page of the same site (`/tools-information/holiday-calendar.html`), and until it is here the exception lists stay `null` and `generate.mjs` keeps refusing the file.

## A second artifact, and it verifies the session rule against the exchange (2026-08-17)

[`cme-trading-hours-2026-08-16-to-2026-08-18-all-products.retrieved-2026-08-17.xlsx`](cme-trading-hours-2026-08-16-to-2026-08-18-all-products.retrieved-2026-08-17.xlsx), SHA-256 `7120e6763e111661abb202c4c1cb1394a9e07cce90bdc4314af00d44950c801d`. The same Trading Hours tool at **per-product** granularity: 1,591 products, three days, `2026-08-16` to `2026-08-18`. **No holiday falls inside that window**, so it adds no exception row.

**What it does is close a `TR-01` gap nobody had named.** `session_rule` in [`cme-2026-2028.source.json`](cme-2026-2028.source.json) carries `open_ct: 17:00`, `open_day_offset: -1`, `close_ct: 16:00`, and its `_note` cites [P1 S-E section 3.1](../../../../../docs/plans/P1-SE-trading-calendar.md) **verbatim**. That is a Merit document. `TR-01` is "every value transcribed from the named authority and never from an implementation", and until this file landed **the session rule was transcribed from our own plan rather than from CME.**

All six products [ADR-042](../../../../../docs/decisions/ADR-042.md) F-3 names are in the export and **all six agree**:

| | `2026-08-17`, verbatim |
|---|---|
| `ES`, `MES`, `NQ`, `MNQ` (CME) | `16:00 Trade Date: 2026-08-17 (CLOSED)`, `16:45 Trade Date: 2026-08-18 (PREOPEN)`, `17:00 Trade Date: 2026-08-18 (OPEN)` |
| `CL` (NYMEX) | identical |
| `GC` (COMEX) | identical |

**Trade date `T` runs 17:00 CT on `T-1` to 16:00 CT on `T`**, which is the rule the file already stated, now stated by the exchange. The 16:00-to-16:45 gap is the maintenance break and sits outside the session on both sides, so the rule excludes it correctly rather than by luck.

**F-3's latest-close rule is a no-op on an ordinary day and only bites on an early close.** All six close at 16:00 here; the spread appears on a holiday, as the Labor Day artifact above shows (Equities 12:00, Energy and Metals 13:30). Worth knowing before someone reads F-3 and expects a per-product `close_ct` on every row.

**Still missing, and it is the same thing as before: the holiday LIST.** The Trading Hours tool exports a three-day window, so reaching every closure and early close in the declared coverage through it is roughly thirty separate exports. The holiday calendar is one document and it is a different page.
