# Identifier series under `docs/`: the survey that `ADR-074` is ruled on, 2026-08-21

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.**
It sits outside the corpus ([`gates.mjs`](../../scripts/corpus/gates.mjs) excludes
`docs/reviews/` from `isCorpusDocument`), so it carries no frontmatter, appears in no
INDEX, and binds nothing by existing. It writes no gate and proposes no repair. What it
produces is the measurement `ADR-074` is decided on -- **unlinked, because it does not
exist at the commit this file is measured against and `CI-06a` fails on a link to an
absent document** -- and the three things the ruling could not otherwise know: what the census command actually
counts, which candidate definition rule survives contact with the tree, and why `SD-nn`
is not solvable the way every other series is.

**Everything below was measured at `e23578a`**, the `origin/main` commit this branch
forks from, before this file existed. **A survey of identifier occurrences changes the
count it reports the moment it is committed**, which is not a curiosity here: it is the
same mechanism that moved `OI` from the figure the wave plan quotes to the figure the
same command returns today, and section 1.3 gives the arithmetic.

---

## 1. The census, and what the command counts

### 1.1 The command, quoted

The figure in [WAVE-04 section 1](../plans/WAVE-04-fixture-backlog-and-gate-inventory.md)
came from this, and it is reproduced verbatim rather than described:

```
grep -rhoE '\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-[0-9]{2,3}\b' docs/ --include=*.md \
  | sed -E 's/-[0-9]{2,3}$//' | sort | uniq -c | sort -rn
```

**It returns 215 distinct prefixes over 22,269 occurrences.** The wave plan reads
*"roughly forty distinct `<PREFIX>-nn` series appear under `docs/`"*, and **forty does
not reproduce from this command at any grouping the command itself performs.** The two
readings that come closest are stated so the next reader does not re-derive them:

| Grouping | Count | What it is |
|---|---|---|
| The command's own output rows | **215** | Every distinct prefix, `INV-M5` and `INV` counted apart |
| First segment only, `sed -E 's/-.*$//'` | **67** | Families, with the module scope folded in: `INV-M5` becomes `INV` |
| First segment, less the 14 prefixes that are a module (`M6-N`, `M4-F`) and the 3 that are not series at all | **50** | The nearest defensible reading of "distinct series" |

**Forty is low, and nothing about the wave's plan depends on which of these is used.**
It is corrected here because the next session to type the number should type a measured
one, and because 215 rather than 40 is most of why this gate is not cheap.

### 1.2 Three of the rows are not series, and one series is partly invisible

**The census over-generates.** Three of its rows are not Merit identifiers at all, and a
gate that took the command's output as its scope would be asserting that each of them
needs an allocation table:

| Row | Occurrences | What it actually is |
|---|---|---|
| `SHA` | 26 | `SHA-256`, a hash algorithm, in seven documents |
| `I-26` | 18 | `NFA I-26-12`, an external regulatory citation in the affiliate, portal and counsel documents |
| `PRE-ADR` | 1 | `PRE-ADR-014` in [session 55](../sessions/2026-08-17-session-55.md), a prose construction meaning "before ADR-014", not an identifier |

**This file is inside its own scope, and the table in section 3 proves it.** That table
carries a row whose first cell is `I-26`, so the census run against the committed survey
reports a series `I` that did not exist before the survey described it. It is left
standing rather than disguised: **a check written over a text pattern is a check the
text can answer back**, which is why [`CI-06q`](../testing/STRATEGY.md) assembles its own
search string from fragments so that it is not its own finding.

**And it under-generates in one place that matters.** The `{2,3}` digit floor is why
`D0` reports a single member. `D0-1` and `D0-2` are in the tree and the pattern cannot
see them; only `D0-10` clears two digits. **A series whose members are single-digit is
invisible to this census**, and the gate that reads its scope from a pattern rather than
from a declared list inherits that hole.

### 1.3 `OI` is 271 today and the wave plan's 220 was right when it was taken

The plan states *"`OI` alone appears 220 times"*. The same command returns **271** now.
**Neither number is wrong.** `OI` is quoted 27 times inside
[WAVE-04](../plans/WAVE-04-fixture-backlog-and-gate-inventory.md) itself, 11 more in
[session 107](../sessions/2026-08-20-session-107.md) and 7 in the
[session registry](../sessions/README.md) row that log carries, and all three landed
after the count was taken.

**This is the property that decides the gate's shape, not a footnote.** An occurrence
count is a fact about a moment, so **no assertion in `CI-06/identifier-series` may be
written against one.** The assertions that survive are about structure: a member has a
row, or it does not.

---

## 2. What a parser could call a definition site

Nothing in the corpus states this, so four candidate shapes were derived from how the
tree is actually written, and each was measured rather than argued.

| | Shape | Where it is the house style |
|---|---|---|
| **D1** | **A filename** leading with the identifier | `docs/decisions/ADR-070.md`, `docs/edge-cases/EC-034.md` |
| **D2** | **A table row** whose first cell leads with the identifier | `R-nn`, `INV-nn`, `CV-nn` in the module plans; `EC-nnn` in the edge-case README |
| **D3** | **A heading** leading with the identifier | `### AS-M14-01: Progressive cap release ...` in M14 |
| **D4** | **A bold lead**, a line or list item opening `**<identifier>` | `**OQ-M5-01 (RULED, ...)** Should a per-transaction ledger imbalance ...` in M05 |

**"Leads with" and not "equals", and the difference is 6 rows of `OI` alone.**
[STATE](../STATE.md) writes its finding rows as ``| **`OI-06`. The 48 hour
payout-destination cooling window has no storage.** | ...``: the identifier, a full
stop, and then the finding, all inside the first cell. An equality rule sees no
definition there at all. **A gate written on equality would report the six rows that do
exist as six rows that do not**, which is the direction that gets a gate switched off.

### 2.1 Both candidate rules were run over the whole tree, and both fail it

| Rule | Series clean | Members with no site | Members with more than one |
|---|---|---|---|
| **Union of D1 to D4**, anywhere in the register the sites concentrate in | 128 of 215 | 75 | **364** |
| **D2 alone**, in the register its rows concentrate in | 120 of 215 | **349** | 89 |

**Neither rule lets a gate over all 215 series pass**, and the two fail in opposite
directions, which is the useful part:

- **The union rule fails on double counting, and most of that double counting is
  correct.** All 157 `EC-nnn` and all 74 `ADR-nnn` report two sites, because each has a
  **document** (D1) and a **register row** (D2) in its README. **That pairing is not a
  defect: [`CI-06n`](../testing/STRATEGY.md) requires exactly it**, in both directions.
  A rule that cannot tell a register row from the document it points at is a rule that
  calls the corpus's own discipline a violation.
- **The D2 rule fails on the 74 series that have no table anywhere**, holding **307
  members and 1,974 occurrences**. Nearly all of it is two families: **42 of those 74
  are `AS-*` and `OQ-*`**, 242 members between them, and they are not undisciplined.
  They are defined by **heading** and by **bold lead**, consistently, in the module plan
  that owns them.

**So the definition site is not one shape, and it is not free-floating either.** What
both failures point at is the same missing input: **a definition site is only meaningful
relative to a declared register.** Section 3 is what that costs to state.

### 2.2 The first cell of a table is not always an identity, and `ADR-014` proves it

Under D2, `ADR-014` reports **four** definition rows. One is its register row in
[decisions/README](../decisions/README.md). The other three are rows in
[ADR-052](../decisions/ADR-052.md) and [ADR-057](../decisions/ADR-057.md) whose first
cell is a link to [ADR-014](../decisions/ADR-014.md) followed by the words *"'s
decision block"* -- **citation tables, whose first column is the source being quoted.**

**This is [`CI-06u`](../testing/STRATEGY.md)'s dimension problem in a new place.** That
gate already carries a closed list of first-column headers that are a **dimension**
rather than an identity, one argued shape per entry. **A definition-site gate scoped to
"any table under `docs/`" inherits that problem and has no such list**, so it would read
three citations as three competing definitions of a frozen ADR. Scoping the search to a
**named register file** removes the whole class rather than enumerating it.

---

## 3. The series, all 215

**Column meanings, stated once.** *Occurrences* counts mentions under `docs/` outside
fenced code. *Members* counts distinct identifiers. *Where its rows concentrate* is the
file, or the ADR-043 split-registry directory, holding first-cell rows for the most
members; it is **derived, not declared**, and that is the point: **no document in the
corpus states where any of these belongs.** The last three columns score the D2 rule
inside that register.

| Series | Occurrences under `docs/` | Members | Where its rows concentrate | One row | No row | More than one |
|---|---|---|---|---|---|---|
| `ADR` | 6210 | 74 | `docs/decisions` | 67 | 3 | 4 |
| `GS` | 3214 | 316 | `docs/testing/golden-scenarios` | 272 | 0 | 44 |
| `R` | 1560 | 50 | `docs/plans/M01-rules-engine.md` | 37 | 0 | 13 |
| `EC` | 935 | 157 | `docs/edge-cases` | 156 | 0 | 1 |
| `FOLD` | 652 | 5 | `docs/testing/golden-scenarios` | 5 | 0 | 0 |
| `INV` | 548 | 24 | `docs/plans/M01-rules-engine.md` | 23 | 0 | 1 |
| `C` | 422 | 28 | `docs/architecture/SECURITY.md` | 28 | 0 | 0 |
| `CI` | 375 | 10 | `docs/testing/STRATEGY.md` | 10 | 0 | 0 |
| `CV` | 351 | 19 | `docs/plans/M01-rules-engine.md` | 14 | 0 | 5 |
| `D` | 257 | 18 | `docs/plans/M07-risk-abuse.md` | 18 | 0 | 0 |
| `OI` | 249 | 25 | `packages/db/DELTA_MANIFEST.md` | 7 | 10 | 8 |
| `INV-M5` | 237 | 23 | `docs/plans/M05-payout-system.md` | 23 | 0 | 0 |
| `PT` | 170 | 8 | `docs/testing/STRATEGY.md` | 8 | 0 | 0 |
| `SD` | 165 | 10 | `packages/db/DELTA_MANIFEST.md` | 10 | 0 | 0 |
| `INV-M20` | 159 | 16 | `docs/plans/M20-wallet.md` | 16 | 0 | 0 |
| `RE-P` | 149 | 18 | `docs/plans/M01-rules-engine.md` | 18 | 0 | 0 |
| `RB` | 144 | 11 | `docs/ops/runbooks/README.md` | 7 | 0 | 4 |
| `WAVE` | 142 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `ST` | 125 | 7 | `docs/plans/M12-statistic-definitions.md` | 7 | 0 | 0 |
| `INV-M16` | 122 | 13 | `docs/plans/M16-notification-center.md` | 13 | 0 | 0 |
| `AS` | 120 | 14 | **no table anywhere** | 0 | 14 | 0 |
| `AS-M19` | 115 | 9 | **no table anywhere** | 0 | 9 | 0 |
| `V-M2` | 109 | 16 | `docs/plans/M02-rithmic-bridge.md` | 16 | 0 | 0 |
| `SD-M5` | 107 | 9 | `packages/db/DELTA_MANIFEST.md` | 9 | 0 | 0 |
| `SD-M6` | 102 | 10 | `packages/db/DELTA_MANIFEST.md` | 10 | 0 | 0 |
| `INV-M14` | 100 | 12 | `docs/plans/M14-loyalty-retention.md` | 12 | 0 | 0 |
| `INV-M19` | 98 | 15 | `docs/plans/M19-kyc-identity.md` | 15 | 0 | 0 |
| `LT` | 94 | 8 | `docs/plans/M05-payout-system.md` | 8 | 0 | 0 |
| `INV-M6` | 93 | 15 | `docs/plans/M06-admin-ops-console.md` | 14 | 1 | 0 |
| `INV-M2` | 89 | 15 | `docs/plans/M02-rithmic-bridge.md` | 15 | 0 | 0 |
| `AS-M14` | 86 | 8 | **no table anywhere** | 0 | 8 | 0 |
| `TR` | 79 | 4 | `docs/testing/STRATEGY.md` | 4 | 0 | 0 |
| `AS-M20` | 78 | 8 | **no table anywhere** | 0 | 8 | 0 |
| `M6-N` | 77 | 9 | `docs/plans/M06-admin-ops-console.md` | 8 | 1 | 0 |
| `AS-M6` | 76 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `INV-M10` | 76 | 12 | `docs/plans/M10-integrations.md` | 12 | 0 | 0 |
| `RE-U` | 75 | 18 | **no table anywhere** | 0 | 18 | 0 |
| `INV-M4` | 74 | 17 | `docs/plans/M04-trader-portal.md` | 17 | 0 | 0 |
| `AS-M10` | 71 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `SD-M16` | 71 | 8 | `packages/db/DELTA_MANIFEST.md` | 8 | 0 | 0 |
| `AS-M5` | 70 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `L` | 66 | 11 | `packages/rules-engine/fixtures/README.md` | 10 | 1 | 0 |
| `AS-M15` | 65 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `RI` | 65 | 7 | `packages/tooling/README.md` | 5 | 2 | 0 |
| `SD-M19` | 65 | 7 | `packages/db/DELTA_MANIFEST.md` | 7 | 0 | 0 |
| `AS-M2` | 64 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `AS-M16` | 63 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `AS-M12` | 62 | 8 | **no table anywhere** | 0 | 8 | 0 |
| `AS-M7` | 62 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `OQ-SE` | 62 | 4 | `docs/plans/P1-SE-trading-calendar.md` | 4 | 0 | 0 |
| `INV-M3` | 61 | 16 | `docs/plans/M03-billing-checkout.md` | 16 | 0 | 0 |
| `RE-D` | 61 | 3 | `docs/STATE.md` | 0 | 0 | 3 |
| `AS-M17` | 60 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `VG` | 60 | 3 | `docs/testing/STRATEGY.md` | 3 | 0 | 0 |
| `FM` | 59 | 18 | `docs/plans/M01-rules-engine.md` | 18 | 0 | 0 |
| `AS-M4` | 58 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `INV-M8` | 58 | 12 | `docs/plans/M08-affiliate-system.md` | 12 | 0 | 0 |
| `RE-S` | 58 | 11 | `docs/testing/SIMULATION_HARNESS.md` | 11 | 0 | 0 |
| `AS-M9` | 57 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `INV-M15` | 57 | 9 | `docs/plans/M15-discord-integration.md` | 9 | 0 | 0 |
| `AS-M18` | 56 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `FM-M2` | 55 | 16 | `docs/plans/M02-rithmic-bridge.md` | 16 | 0 | 0 |
| `INV-M18` | 55 | 12 | `docs/plans/M18-graduation-track.md` | 12 | 0 | 0 |
| `FM-M7` | 54 | 10 | `docs/plans/M07-risk-abuse.md` | 10 | 0 | 0 |
| `INV-M12` | 54 | 12 | `docs/plans/M12-transparency-platform.md` | 12 | 0 | 0 |
| `INV-M21` | 54 | 12 | `docs/plans/M21-plan-designer.md` | 12 | 0 | 0 |
| `P-M6` | 54 | 10 | `docs/plans/M06-admin-ops-console.md` | 10 | 0 | 0 |
| `AS-M13` | 53 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `INV-M17` | 53 | 12 | `docs/plans/M17-offers-engine.md` | 12 | 0 | 0 |
| `AS-M21` | 52 | 4 | `docs/decisions` | 4 | 0 | 0 |
| `INV-M9` | 52 | 13 | `docs/plans/M09-marketing-site.md` | 13 | 0 | 0 |
| `SD-M7` | 52 | 5 | `docs/plans/M07-risk-abuse.md` | 5 | 0 | 0 |
| `INV-M13` | 50 | 10 | `docs/plans/M13-trader-analytics-journal.md` | 10 | 0 | 0 |
| `AS-M11` | 49 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `AS-M8` | 48 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `OQ-M6` | 45 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `INV-M11` | 44 | 11 | `docs/plans/M11-certificates-social-proof.md` | 11 | 0 | 0 |
| `PW` | 44 | 4 | `docs/plans/M01-rules-engine.md` | 2 | 0 | 2 |
| `OQ-M10` | 43 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `OQ-M5` | 42 | 7 | `docs/STATE.md` | 1 | 6 | 0 |
| `SD-M3` | 42 | 6 | `packages/db/DELTA_MANIFEST.md` | 6 | 0 | 0 |
| `DEP-M7` | 41 | 6 | `docs/plans/M07-risk-abuse.md` | 6 | 0 | 0 |
| `DG` | 40 | 17 | `docs/design/DESIGN_SYSTEM.md` | 17 | 0 | 0 |
| `SD-M2` | 40 | 6 | `packages/db/DELTA_MANIFEST.md` | 6 | 0 | 0 |
| `CT` | 39 | 12 | `docs/ops/runbooks/COMMS_TEMPLATES.md` | 12 | 0 | 0 |
| `SC-M4` | 39 | 11 | `docs/plans/M04-trader-portal.md` | 11 | 0 | 0 |
| `SD-M4` | 39 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `OQ-M20` | 38 | 7 | `docs/decisions` | 2 | 5 | 0 |
| `SD-M8` | 38 | 5 | `packages/db/DELTA_MANIFEST.md` | 5 | 0 | 0 |
| `OQ-F4` | 36 | 4 | `docs/plans/FOLD-04-impersonation-and-admin-parity.md` | 4 | 0 | 0 |
| `GP-M18` | 35 | 3 | `docs/plans/M18-graduation-track.md` | 3 | 0 | 0 |
| `S` | 35 | 18 | `docs/plans/M12-statistic-definitions.md` | 18 | 0 | 0 |
| `OQ-P2` | 34 | 4 | `docs/plans/P2-rules-engine.md` | 4 | 0 | 0 |
| `DEP-M2` | 32 | 6 | `docs/plans/M02-rithmic-bridge.md` | 6 | 0 | 0 |
| `U` | 32 | 7 | `packages/db/DELTA_MANIFEST.md` | 7 | 0 | 0 |
| `AS-M3` | 31 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `OQ-P1` | 31 | 4 | `docs/plans/P1-monorepo-scaffold.md` | 4 | 0 | 0 |
| `SD-M9` | 31 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `FM-M5` | 30 | 13 | `docs/plans/M05-payout-system.md` | 13 | 0 | 0 |
| `LM-M14` | 29 | 5 | `docs/plans/M14-loyalty-retention.md` | 5 | 0 | 0 |
| `OQ-F3` | 29 | 4 | `docs/plans/FOLD-03-vendor-parity-gap-fill.md` | 4 | 0 | 0 |
| `INV-M7` | 26 | 10 | `docs/plans/M07-risk-abuse.md` | 10 | 0 | 0 |
| `OQ` | 26 | 3 | `docs/decisions` | 3 | 0 | 0 |
| `SD-M12` | 26 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `SD-M18` | 26 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `SHA` | 26 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `DEP-M21` | 25 | 8 | `docs/plans/M21-plan-designer.md` | 8 | 0 | 0 |
| `FM-M16` | 25 | 10 | `docs/plans/M16-notification-center.md` | 10 | 0 | 0 |
| `NC-M16` | 25 | 5 | `docs/plans/M16-notification-center.md` | 1 | 0 | 4 |
| `PP` | 25 | 10 | `docs/testing/SIMULATION_HARNESS.md` | 10 | 0 | 0 |
| `SD-M17` | 25 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `AN-M13` | 24 | 6 | `docs/plans/M13-trader-analytics-journal.md` | 6 | 0 | 0 |
| `FM-M8` | 24 | 11 | `docs/plans/M08-affiliate-system.md` | 11 | 0 | 0 |
| `HO` | 24 | 10 | `docs/testing/SIMULATION_HARNESS.md` | 8 | 2 | 0 |
| `SD-M20` | 23 | 5 | `docs/plans/M20-wallet.md` | 5 | 0 | 0 |
| `SD-M21` | 23 | 3 | `packages/db/DELTA_MANIFEST.md` | 3 | 0 | 0 |
| `OQ-M21` | 22 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `SD-M11` | 22 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `FM-M10` | 21 | 11 | `docs/plans/M10-integrations.md` | 11 | 0 | 0 |
| `FM-M3` | 21 | 12 | `docs/plans/M03-billing-checkout.md` | 12 | 0 | 0 |
| `OQ-062` | 21 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `OQ-M12` | 21 | 5 | `docs/decisions` | 1 | 4 | 0 |
| `OQ-M18` | 21 | 4 | `docs/decisions` | 1 | 3 | 0 |
| `IN-M10` | 20 | 6 | `docs/plans/M10-integrations.md` | 6 | 0 | 0 |
| `SD-M10` | 20 | 4 | `packages/db/DELTA_MANIFEST.md` | 4 | 0 | 0 |
| `OQ-M2` | 19 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `DEP-M6` | 18 | 8 | `docs/plans/M06-admin-ops-console.md` | 8 | 0 | 0 |
| `FM-M4` | 18 | 10 | `docs/plans/M04-trader-portal.md` | 10 | 0 | 0 |
| `I-26` | 18 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `OQ-F5` | 18 | 4 | `docs/plans/FOLD-05-plan-config-and-designer.md` | 4 | 0 | 0 |
| `OQ-M19` | 18 | 5 | `docs/decisions` | 1 | 4 | 0 |
| `SD-M14` | 18 | 3 | `packages/db/DELTA_MANIFEST.md` | 3 | 0 | 0 |
| `DEP-M15` | 17 | 6 | `docs/plans/M15-discord-integration.md` | 6 | 0 | 0 |
| `DEP-M19` | 17 | 9 | `docs/plans/M19-kyc-identity.md` | 9 | 0 | 0 |
| `OQ-M7` | 17 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `OQ-F2` | 16 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `OQ-M15` | 15 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `OQ-M8` | 15 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `SS` | 15 | 8 | `docs/design/DESIGN_SYSTEM.md` | 8 | 0 | 0 |
| `FM-M12` | 14 | 9 | `docs/plans/M12-transparency-platform.md` | 9 | 0 | 0 |
| `FM-M14` | 14 | 11 | `docs/plans/M14-loyalty-retention.md` | 11 | 0 | 0 |
| `FM-M6` | 14 | 10 | `docs/plans/M06-admin-ops-console.md` | 10 | 0 | 0 |
| `OQ-M14` | 14 | 7 | **no table anywhere** | 0 | 7 | 0 |
| `SD-M13` | 14 | 3 | `packages/db/DELTA_MANIFEST.md` | 3 | 0 | 0 |
| `DEP-M10` | 13 | 8 | `docs/plans/M10-integrations.md` | 8 | 0 | 0 |
| `DEP-M4` | 13 | 9 | `docs/plans/M04-trader-portal.md` | 9 | 0 | 0 |
| `FM-M21` | 13 | 10 | `docs/plans/M21-plan-designer.md` | 10 | 0 | 0 |
| `FM-M9` | 13 | 9 | `docs/plans/M09-marketing-site.md` | 9 | 0 | 0 |
| `OQ-FREEZE` | 13 | 2 | `docs/STATE.md` | 2 | 0 | 0 |
| `CT-M11` | 12 | 4 | `docs/plans/M11-certificates-social-proof.md` | 4 | 0 | 0 |
| `DEP-M3` | 12 | 7 | `docs/plans/M03-billing-checkout.md` | 7 | 0 | 0 |
| `FM-M19` | 12 | 9 | `docs/plans/M19-kyc-identity.md` | 9 | 0 | 0 |
| `OQ-F6` | 12 | 3 | `docs/decisions` | 3 | 0 | 0 |
| `OQ-M3` | 12 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `RE-C` | 12 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `DEP-M9` | 11 | 7 | `docs/plans/M09-marketing-site.md` | 7 | 0 | 0 |
| `FM-M11` | 11 | 8 | `docs/plans/M11-certificates-social-proof.md` | 8 | 0 | 0 |
| `FM-M15` | 11 | 8 | `docs/plans/M15-discord-integration.md` | 8 | 0 | 0 |
| `FM-M20` | 11 | 10 | `docs/plans/M20-wallet.md` | 10 | 0 | 0 |
| `OQ-M11` | 11 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `OQ-M9` | 11 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `OQ-P` | 11 | 2 | **no table anywhere** | 0 | 2 | 0 |
| `WF-M20` | 11 | 5 | `docs/plans/M20-wallet.md` | 5 | 0 | 0 |
| `DEP-M5` | 10 | 6 | `docs/plans/M05-payout-system.md` | 6 | 0 | 0 |
| `FM-M13` | 10 | 8 | `docs/plans/M13-trader-analytics-journal.md` | 8 | 0 | 0 |
| `SF-M21` | 10 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `DEP-M14` | 9 | 9 | `docs/plans/M14-loyalty-retention.md` | 9 | 0 | 0 |
| `DEP-M20` | 9 | 9 | `docs/plans/M20-wallet.md` | 9 | 0 | 0 |
| `FM-M17` | 9 | 9 | `docs/plans/M17-offers-engine.md` | 9 | 0 | 0 |
| `FM-M18` | 9 | 8 | `docs/plans/M18-graduation-track.md` | 8 | 0 | 0 |
| `OF-M17` | 9 | 6 | `docs/plans/M17-offers-engine.md` | 6 | 0 | 0 |
| `DEP-M12` | 8 | 8 | `docs/plans/M12-transparency-platform.md` | 8 | 0 | 0 |
| `DEP-M8` | 8 | 6 | `docs/plans/M08-affiliate-system.md` | 6 | 0 | 0 |
| `D0` | 7 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `DEP-M13` | 7 | 6 | `docs/plans/M13-trader-analytics-journal.md` | 6 | 0 | 0 |
| `DEP-M17` | 7 | 7 | `docs/plans/M17-offers-engine.md` | 7 | 0 | 0 |
| `OQ-M13` | 7 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `OQ-M17` | 7 | 5 | **no table anywhere** | 0 | 5 | 0 |
| `OQ-M4` | 7 | 6 | **no table anywhere** | 0 | 6 | 0 |
| `SD-M15` | 7 | 2 | `packages/db/DELTA_MANIFEST.md` | 2 | 0 | 0 |
| `DEP-M11` | 6 | 6 | `docs/plans/M11-certificates-social-proof.md` | 6 | 0 | 0 |
| `DEP-M16` | 6 | 6 | `docs/plans/M16-notification-center.md` | 6 | 0 | 0 |
| `DEP-M18` | 6 | 6 | `docs/plans/M18-graduation-track.md` | 6 | 0 | 0 |
| `PL-M19` | 6 | 3 | `docs/plans/M19-kyc-identity.md` | 3 | 0 | 0 |
| `OQ-M16` | 4 | 4 | **no table anywhere** | 0 | 4 | 0 |
| `DT` | 3 | 3 | **no table anywhere** | 0 | 3 | 0 |
| `OQ-DS` | 3 | 3 | **no table anywhere** | 0 | 3 | 0 |
| `OQ-RB` | 3 | 3 | **no table anywhere** | 0 | 3 | 0 |
| `OQ-SH` | 3 | 3 | **no table anywhere** | 0 | 3 | 0 |
| `OQ-TS` | 3 | 3 | **no table anywhere** | 0 | 3 | 0 |
| `PG-M9` | 3 | 3 | **no table anywhere** | 0 | 3 | 0 |
| `RS-M15` | 3 | 3 | `docs/plans/M15-discord-integration.md` | 3 | 0 | 0 |
| `M4-F` | 2 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `RE-R` | 2 | 2 | **no table anywhere** | 0 | 2 | 0 |
| `M10-D` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M10-K` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M11-K` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M12-T` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M12-X` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M13-G` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M13-L` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M14-X` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M15-O` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M19-K` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M2-I` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M2-U` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M20-K` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M20-X` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M5-D` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M5-P` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M6-U` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M7-G` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M9-K` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `M9-S` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |
| `PRE-ADR` | 1 | 1 | **no table anywhere** | 0 | 1 | 0 |

---

## 4. Six readings the table cannot make for itself

### 4.1 `OI` HAS an allocation table, and the brief's strongest claim is the one to correct

**The prompt that commissioned this survey states that `OI` "has NO REGISTRY TABLE AT
ALL". It has one.** It is
[`DELTA_MANIFEST`](../../packages/db/DELTA_MANIFEST.md) **section 16**, and it is not
improvised: the heading reads *"Allocation: `OI-nn` identifiers and section numbers"*,
and the section opens by naming what it is for -- *"This file is the fourth numbered
registry in the repository and it was the last one with no table. It collided twice in
one day."* It applies [ADR-034](../decisions/ADR-034.md), it carries the two collisions
it was written to end, and it was **deliberately** placed there rather than in
[ALLOCATION](../decisions/ALLOCATION.md), on a stated argument: *"`OI-nn` and the section
numbers are this document's own namespace."*

**Correcting this is the difference between two rulings.** "`OI` has no table" leads to
*write one*. "`OI` has a table whose declared scope no longer matches its series" leads
to *decide whose namespace `OI` is*, which is a harder question and the real one.

**So the tree carries three places an `OI` row appears, and only the first is a
register:**

| Site | Covers | What it is |
|---|---|---|
| [`DELTA_MANIFEST`](../../packages/db/DELTA_MANIFEST.md) section 16 | `OI-01` to `OI-15` | **The allocation table.** Two columns, claimed-by and disposition, under ADR-034 |
| `DELTA_MANIFEST` section 8, *"Open items carried out of the fold"* | the same range | The findings themselves, keyed by identifier. Not an allocation |
| [STATE](../STATE.md), six rows across six chronological sections | 6 members | Not a register. Finding rows inside narrative sections, keyed by identifier because the finding needed a name |

**Ten members appear in none of the three**: `OI-16` through `OI-23`, and `OI-25` and
`OI-26`, which [WAVE-04 section 6](../plans/WAVE-04-fixture-backlog-and-gate-inventory.md)
allocates in a plan document and says so about itself.

**And the ten are not a lapse. They are the stated scope working as stated.** `OI-16`
onward were opened by sessions about engine purity, gate coverage, lint scope and
fixture inventory. **None of that is the manifest's own namespace**, so the argument that
put the table in `packages/db/` is the same argument that keeps those ten out of it.
**A register whose declared subject excludes 40 percent of its series is not that
series' register**, and filing those ten into a schema-delta manifest to satisfy a gate
would be filing a finding by where the check can see it.

**`OI-06` is allocated twice, and the manifest records it against itself**: *"CLAIMED
TWICE, 2026-08-16, and left that way"*, one open and one closed, from two sessions
editing the same document on the same day. That collision is what commissioned section
16 in the first place. **It is the duplicate-key class
[WAVE-03](../plans/WAVE-03-duplicate-registry-keys.md) spent nine sessions on**, and it
is the second time this wave has met it: the brief behind WAVE-04 proposed `OI-19` and
`OI-20` for its two open items and both were already taken. **The table exists and the
collisions kept happening**, which is the argument for a gate rather than against one.

### 4.2 `GS`'s 44 double rows are the ownership index, and they are correct

44 of 316 `GS-nnn` carry two first-cell rows inside
[`docs/testing/golden-scenarios/`](../testing/golden-scenarios/README.md): the scenario's
own registry row, and a second row in the **ownership and coverage reconciliation**
section. `GS-001` and `GS-047` are both in that set, and both are cited in WAVE-04's own
fixture partition for exactly that reason -- they are **co-owned**, so a second row is
what records the second owner.

**A gate asserting "exactly one row per member" fails 44 correct rows** unless the
register is declared **per section** rather than per directory. `CI-06d` already reads
this registry and already asserts the ownership partition covers every `GS-nnn` exactly
once, in both directions, which is the same property stated where the structure is known.

### 4.3 `R`'s 13 and `CV`'s 5 are the rule table and its coverage table

Thirteen `R-nn` and five `CV-nn` carry two rows inside
[M01](../plans/M01-rules-engine.md). The second row is a **coverage or implementation
status** row, not a competing definition. Same shape as 4.2, one document down, and the
same consequence: **the register is a section, not a file.**

### 4.4 `AS-*` and `OQ-*` are disciplined and row-less, and that is 42 series

**Not one of the 42 `AS-*` and `OQ-*` prefixes has a first-cell row anywhere.** They are
defined by heading (`### AS-M14-01: ...`) or bold lead (`**OQ-M5-01 (RULED, ...)**`),
and they are consistent about it within each module plan. **A D2-only gate would report
242 members as undefined and every one of the reports would be false.**

### 4.5 Twenty-two prefixes exist once and are defined nowhere

`M2-I`, `M4-F`, `M5-D`, `M5-P`, `M6-U`, `M7-G`, `M9-K`, `M9-S`, `M10-D`, `M10-K`,
`M11-K`, `M12-T`, `M12-X`, `M13-G`, `M13-L`, `M14-X`, `M15-O`, `M19-K`, `M20-K`,
`M20-X`, `M2-U`, and `PRE-ADR`: one member each, one or two mentions each, **no
definition site of any shape.**

`M4-F-01` is the representative case. It appears in a table in
[M04](../plans/M04-trader-portal.md) -- in the **second** cell, where the first cell
reads "Appendix F slop score" -- and again in a sentence below it. **The row defines it
in every sense a reader cares about and in none a parser can reach.** These are not
registry failures; they are identifiers minted once, in place, for a thing that needed a
name in one table. **A gate that demands a register for them is demanding twenty-two
registries with one row each.**

### 4.6 Five series already have a purpose-built gate, and it is stronger than this one

| Series | Gate | What it already asserts |
|---|---|---|
| `ADR-nnn` | `CI-06f`, `CI-06n`, `CI-06r`, `CI-06w` | Unique and gapless over allocated plus reserved; every entry has a README row and every row resolves; heading status agrees with the body; every allocation claim reads as a multiset |
| Migration numbers | `CI-06h` | The sequence against the allocation table |
| `CI-06` letters | `CI-06p`, `CI-06w` | Unique in STRATEGY and gapless over implemented plus reserved |
| `GS-nnn`, `EC-nnn` | `CI-06d` | Every citation resolves; each registry runs 1..n with no holes or duplicates; the ownership partition covers every scenario exactly once |
| `SD-nn`, and the unnumbered delta series | `ADR-026` | Exactly one manifest row each, carrying a disposition from a closed vocabulary |

**A second gate over a property a purpose-built gate already checks is a second copy of
a rule**, which is the drift [ADR-034](../decisions/ADR-034.md) exists to end. It is
also, for four of these five, a **weaker** copy: none of them would gain anything from
being told its members have one definition site.

---

## 5. `SD-nn` cannot be solved the way every other series can, and the proof is runnable

**Every other series in this survey could, in principle, be given a table in a document.
`SD` cannot**, and the reason is that it already has a gate that makes the attempt
self-defeating.

[ADR-026](../decisions/ADR-026.md) requires that **every `SD-` and unnumbered-delta
identifier appearing anywhere under `docs/` has exactly one
[`DELTA_MANIFEST`](../../packages/db/DELTA_MANIFEST.md) row carrying a disposition.** The
gate reads citations from `docs/` and rows from `packages/db/`. So:

> **Writing an unallocated `SD` number into a plan document to reserve it creates a
> manifest obligation that the reservation itself cannot discharge.** The number is now
> cited under `docs/` and has no row, which is a failing gate, and the only repair is a
> manifest row -- which is to say the allocation was never in the document at all.

**This was executed rather than reasoned.** An unallocated number in the forties was
appended to [STATE](../STATE.md), the gate was run, and the file was reverted:

```
$ node scripts/corpus/gates.mjs check ADR-026
FAIL   ADR-026  Manifest completeness: every SD-nn and U-nn has exactly one row, ...  (1)
       SD-**: cited in docs/ but has no DELTA_MANIFEST row

0 of 1 gates pass. A gate that fails is a corpus that is wrong, not a gate to relax.
```

**The number is masked in that transcript and the masking is the finding, not a
courtesy.** This survey is a file under `docs/`. Reproducing the probe's literal token
in it would recreate the obligation the paragraph is about, and **the survey would fail
the gate it is describing.** A series whose identifiers cannot be written down outside
their register, even to discuss them, is a series no docs-scoped definition-site rule
can serve.

**Three consequences, and `ADR-074` has to survive all three.**

1. **`SD`'s register is not under `docs/`.** Any rule whose search space is `docs/`
   either exempts `SD` or looks outside its own scope for one series.
2. **`SD` already has the property this gate would assert, enforced harder.** ADR-026
   demands exactly one row *and* a disposition from a closed vocabulary. A definition
   site is the weaker half of what `SD` already has.
3. **`SD`'s reservation mechanism is a manifest row with the `reserved` disposition, and
   seven rows carry it today.** So the pattern generalises in the opposite direction to
   the one the wave assumed: **the register carries the reservation, and the plan
   document cites it.** Not the reverse.

**[WAVE-03](../plans/WAVE-03-duplicate-registry-keys.md) found the module-scoped delta
and note collisions this way, by a session reading the tree rather than by a gate**, and
the same is true here: every finding in this survey came from a command a person chose
to run against a question a person chose to ask.

---

## 6. What this hands `ADR-074`

**Stated as inputs to a ruling, not as the ruling.**

1. **A definition site cannot be defined by shape alone.** Four shapes are in live use,
   two of them (`D3`, `D4`) carry 42 series that have no rows at all, and the union of
   all four calls 364 members double-defined, most of them correctly.
2. **It can be defined relative to a declared register**, and that declaration does not
   exist anywhere in the corpus today for any series. **Whoever writes it is choosing
   the scope**, which is why it is a ruling and not an implementation detail.
3. **The register is a section for at least three series** (`GS`, `R`, `CV`), a
   directory for two (`EC`, `ADR`), a file for most, and **outside `docs/` for `SD` and
   for such `OI` rows as exist.**
4. **215 series is not the scope of anything.** Three rows are not identifiers, 22 are
   one-off names in a single table cell, and five series are already gated harder
   elsewhere.
5. **`OI`'s defect is a register whose declared scope has expired, not a missing one.**
   The table is `DELTA_MANIFEST` section 16, argued into that file because `OI-nn` was
   *"this document's own namespace"*. Ten members are outside that namespace and outside
   the table, one number is allocated twice with the collision recorded and unrepaired,
   and two more were allocated in a plan file this wave. **The ruling `ADR-074` owes is
   whose namespace `OI` is now**, and only then where the table lives.
6. **Neither candidate rule passes the tree.** 120 of 215 series are clean under the
   narrow rule and 128 under the broad one. **A gate scoped to all series arrives as an
   ERROR under [`falsify.mjs`](../../scripts/corpus/falsify.mjs)**, so the ruling owes
   `W8` a decision about scope, and owes it before implementation rather than during.
