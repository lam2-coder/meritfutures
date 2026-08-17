# NOT AN ARTIFACT. A pasted rendering, kept as a work list.

**This file is a copy-paste of CME's Holiday and Trading Hours page, taken 2026-08-17.**
The README's retrieval discipline is explicit that this cannot be the artifact: *"Save
the bytes the exchange served, unmodified. Not a rendering, not a copy-paste, not a
summary."* A paste loses the table structure (the columns visibly run together below),
and a transcription checked against a paste that a Merit session typed is not checked
against the exchange.

**It is kept for exactly one purpose: it names the 2026 holidays, so whoever fetches the
real artifacts knows which dates to request and how many.** Nothing here may be
transcribed into `cme-2026-2028.source.json`.

## `2026 CME Globex Trading Schedule`, as the page renders it

| U.S. HOLIDAY | INCLUDES THE FOLLOWING DATES: |
|---|---|
| New Year's | 31 December 2025 - 2 January 2026 |
| Dr. Martin Luther King, Jr. | 18 - 20 January 2026 |
| Presidents Day | 15 - 17 February 2026 |
| Good Friday | 2 - 4 April 2026 |
| Memorial Day | 24 - 26 May 2026 |
| Juneteenth | 18 - 19 June 2026 |
| Independence Day | 3 - 5 July 2026 |
| Labor Day | 6 - 8 September 2026 |
| Thanksgiving | 26 - 28 November 2026 |
| Christmas | 24 - 26 December 2026 |
| New Year's | 31 December 2026 - 1 January 2027 |

The page also carries a note that CME finalises hours **roughly two weeks before each
holiday** and that the schedule is subject to NYSE and SIFMA input.

## FINDING 1: that second column is NOT a holiday list, and reading it as one triples the count

**`INCLUDES THE FOLLOWING DATES` is the window the holiday AFFECTS, not the days the
exchange is closed.** The committed artifact
[`cme-trading-hours-2026-09-06-to-2026-09-08.retrieved-2026-08-17.xlsx`](../cme-trading-hours-2026-09-06-to-2026-09-08.retrieved-2026-08-17.xlsx)
proves it on the one row both documents cover:

- The page says Labor Day "includes" **6 - 8 September 2026**, three days.
- The artifact shows Sunday 6 September opening with `Trade Date: 2026-09-08`, and
  Tuesday 8 September closing normally at 16:00 as its own trade date.
- **So exactly one of those three days is a holiday: Monday 7 September.** The other two
  are the session either side of it.

A transcriber reading that column as the holiday list produces roughly **three times too
many holidays**, every one of them well-formed. `generate.mjs` would accept them:
`holiday-on-a-weekend` does not fire on a Tuesday, and `early-close-on-a-holiday` does not
fire on a row that is simply about the wrong day. **This is the same failure class the
`_status_note` names, one layer out**: a plausible reading of an authoritative-looking
table, indistinguishable from a correct transcription by every check we have.

**Both blind readers must be given this warning identically, or the blindness breaks on
the instructions rather than on the file.** It belongs beside the existing hazard note.

## FINDING 2: `ADR-042` `OQ-SE-02`'s factual premise is in question

[ADR-042](../../../../../../docs/decisions/ADR-042.md) rules coverage at "current year
plus two" and gives the reason as a fact about the publisher: **"the current year plus two
is about as far as CME publishes, so it is the honest maximum rather than a chosen one."**

**Every schedule table on the page is 2026.** The Globex table ends at 1 January 2027;
there is no 2027 table and no 2028 table. If that holds against the real artifact, then
`coverage: 2026-01-01 to 2028-12-31` in the source file cannot be transcribed, because two
of its three years are not published, and **declaring coverage through 2028 while filling
only 2026 is the worst available outcome**: `trading_calendar_loads` would assert
knowledge of 2027 and 2028 that nobody has, which is precisely what `F-4` exists to make
impossible.

**This is FLAGGED, NOT RULED.** It is read off a paste, the page carries a date picker and
a `View: Holidays / Full Calendar` toggle that a paste cannot exercise, and a ruling that
amends a frozen ADR on the strength of a rendering is the mistake this desk has already
made once this week. **It is settled against the artifact when the artifact lands**, and
if it holds it is an ADR amending `OQ-SE-02`, not a commit.
