---
status: approved
depends_on: [../decisions/README.md, ../GLOSSARY.md, ../STATE.md, ../edge-cases/README.md, ../architecture/data-model/README.md, ../architecture/INFRA.md, ../testing/STRATEGY.md, ../testing/golden-scenarios/README.md, ../ops/runbooks/CRON_INVENTORY.md, P1-monorepo-scaffold.md, M01-rules-engine.md, M02-rithmic-bridge.md, M05-payout-system.md, M07-risk-abuse.md, M12-statistic-definitions.md, FOLD-01-phone-identity.md, FOLD-02-enforcement-window-and-suspension.md, ../../packages/db/DELTA_MANIFEST.md]
last_updated: 2026-08-15
---

# P1 S-E: TradingCalendar as data

**A session plan, not a module plan**, in [FOLD-01](FOLD-01-phone-identity.md)'s and [FOLD-02](FOLD-02-enforcement-window-and-suspension.md)'s idiom. It is [P1 section 6](P1-monorepo-scaffold.md)'s last engineering item, it is money path under the [ADR-003](../decisions/ADR-003.md) strict regime, and it was written in plan mode as that section requires.

It is approved before the fold begins and it is what the fold is scored against. **It writes no number into a file it cannot rename and it allocates no delta identifier**, per FOLD-01 section 4's finding: only ADR numbers and migration numbers have an allocation table.

---

## 1. Why this is money path, stated precisely

The calendar decides what a trading day **is**, and every counter the engine keeps is counted in trading days: R-01 fill containment, R-02 counter advance, R-05 session bounds, R-34 win days, R-37 the cadence gap, R-47 the settlement reset ([M01 section 3](M01-rules-engine.md)).

**A wrong row changes rule outcomes with no change to a line of engine code, and it does so silently**, because the engine is a pure function of the calendar it is handed and has no way to disbelieve it. Three mechanisms guarantee the engine cannot go and check for itself: `types: []`, `merit/engine-purity`, and the `RI-01` manifest check. That purity is the reason this table is the highest-leverage unreviewed data in the system.

`trading_calendar` exists in [`0004_catalog.sql`](../../packages/db/migrations/0004_catalog.sql) with its ruled semantics and **zero rows**, no source file, no loader and no seed mechanism.

## 2. What exists today, measured rather than assumed

| Fact | Evidence |
|---|---|
| Zero rows, no loader, no seed mechanism | `grep -c 'INSERT INTO' packages/db/migrations/*.sql` is 0 across 28 files. [`packages/db/src/index.ts`](../../packages/db/src/index.ts) declares a branded type and an interface; `test/` holds one filename check |
| A partial fixture calendar exists and **already commits to being derived** | [`fixtures/calendars/cme-2026.json`](../../packages/rules-engine/fixtures/calendars/cme-2026.json): five sessions, `status: "partial"`, and its own note reads "When S-E lands, this file is DERIVED from the seeded `trading_calendar` rows rather than maintained beside them: two hand-maintained calendars is the drift class this corpus has found thirteen times" |
| **No migration derives a date from a clock** | Zero `::date`, zero `CAST(`, zero `interval` in any case across all 28 files. Every `now()` is a `DEFAULT now()` on a `timestamptz`, and **no `date` column carries a default at all** |
| The schema holds **45 `date` columns** and nothing states which unit each is in | [`affiliate_commissions.payable_after`](../architecture/data-model/affiliate_commissions.md) and `chargeback_window_ends_on` are both wall clock and DATA_MODEL says so well ("Merit's own clock", "the card networks' rather than ours"). `published_statistics.window_start_day` has an **empty** Why cell and is a trading day only because [M12](M12-statistic-definitions.md) says "trailing 90 trading days" |

---

## 3. Where the source data comes from, and how it is verified rather than trusted

**The source is the exchange's own publication.** CME Group's published holiday calendar and published Globex hours for the listed product groups, transcribed by hand into a checked-in JSON file carrying a provenance block: source URL, retrieval date, the retrieved artifact committed beside it, and its SHA-256. This is `TR-01`'s discipline, every value transcribed from the named authority and never from an implementation, applied to calendar data.

**No third-party calendar library is introduced.** VG-12 makes a new dependency a human admission a session cannot grant itself, and a library is in any case not more authoritative than the exchange's own publication. See OQ-SE-04 for the one place a library was considered and the narrower role it would hold.

### 3.1 The file holds exceptions, not two hundred and fifty rows

Hand-maintaining a full year is two hundred and fifty chances to be wrong. The source file carries the **holiday list**, the **early-close list** with each early close's CT time, and the **coverage bounds**. Full sessions are generated from the stated rule: every weekday inside coverage that is not a holiday, 17:00 CT on the prior calendar day to 16:00 CT on the trading day.

**The generated year is committed and reviewed**, so the reviewable artifact still exists and git holds its history.

**This does not violate B4 #1.** That rule forbids the **engine** deriving a trading day from a timestamp at runtime. It does not forbid a build step whose output is committed, digest-pinned and thereafter read as data. The distinction is worth stating in the ADR, because a careful future reader will otherwise read the generator as the thing the rule exists to prevent.

### 3.2 Verification, in three layers, because a source read twice is still one source

| Layer | The class it catches | Mechanism |
|---|---|---|
| **Structural, offline** | A transcription slip | Coverage contiguous; no Saturday row; every full session's bounds match the stated CT rule; no holiday carries a session; the file's declared `session_count` equals its own generated array length. **Two independent statements of one number that must agree**, which is this corpus's own idiom |
| **Cross-source, offline** | A DST error, the one class a careful reader still gets wrong | The file states **both** the CT wall time and the UTC instant for every session. The loader **verifies rather than computes**: it converts CT to UTC through `Intl` with `timeZone: 'America/Chicago'` (Node ships the IANA database with full ICU, and `.nvmrc` pins the Node version and therefore the tzdata) and refuses any row where the two disagree. The DST transitions inside coverage are asserted to land on exactly the days IANA declares and **nowhere else** |
| **Against reality, in production** | A row that is simply wrong about a day that has already happened | [`SD-M2-04`](M02-rithmic-bridge.md)'s `fills.trading_day_vendor` and `trading_day_source` already exist for this, and AS-M2-06's divergence alarm is already specified ([EC-056](../edge-cases/EC-056.md), GS-090). **This plan wires the calendar to that alarm rather than inventing a second one.** It is the only mechanism in the system that can falsify a calendar row from outside the calendar |

The third layer is the only one that can catch a wrong row, and it is retrospective by construction. That is not a shortfall to be engineered away; it is why the first two layers exist.

---

## 4. Correcting a row once trading has occurred against it

**Which rule applies is neither E2 nor "it is only data", and saying which is half the answer.**

Constitution E2 makes a **migration** sacred because a merged migration has already run somewhere, and editing it makes two databases disagree about what was applied. A calendar row is data and E2 does not reach it. But **the reason E2 exists reaches it exactly**: a row that a `daily_mark` has already been computed against has already run, and changing it makes the stored state and the replayed state disagree.

So the correction path is partitioned by whether anything depends on the day, and **the partition is asserted rather than judged**:

| Case | Treatment |
|---|---|
| The day has **no** dependent row in `fills`, `daily_marks` or `rule_states` | An ordinary data change. The loader updates it, having first asserted the dependency count is zero |
| The day **has** dependent rows | **Not a data edit. An incident.** A prior-image row is written, every affected account is replayed through the same `advanceDay` fold ([M01 section 3.7](M01-rules-engine.md): there is no second code path), and **B4 #5 governs the outcome**: if a settled payout's eligibility changes retroactively, **never claw back**, flag for review and absorb. This is already `FM-M2-04`'s stated recovery, "correct the calendar or the parser, supersede affected marks, replay" |

**And the finding that makes this more than process.** The table today carries `updated_at` and `notes` and no prior image, so **it cannot answer what the calendar said on the day the engine read it**. `INV-04`, replaying every mark from day one reproduces stored state byte-identically, is defined against a value that can move underneath it, and the nightly self-audit would page with no way to distinguish a calendar correction from an engine regression. See **F-2**.

---

## 5. Half-day sessions

**The semantics are ruled and this plan does not reopen them.** A half day is a **full** trading day for every counter (B4 #3, [EC-005](../edge-cases/EC-005.md), GS-003, GS-032). A half day counting as half a day would make the minimum-trading-days gate a different promise in November. The only thing `is_half_day` changes is `session_close_at`.

**The finding is that one close time cannot serve six symbols.** [`contract_specs`](../architecture/data-model/contract_specs.md) lists `ES`, `MES`, `NQ`, `MNQ`, `CL`, `GC`, spanning CME, NYMEX and COMEX, whose **early closes differ by product group** while their regular hours agree. `trading_calendar` has one row per trading day and **no symbol dimension**, so one `session_close_at` is wrong for some group on every early-close day.

**Recommended resolution, conservative and reversible: on an early-close day, `session_close_at` is the LATEST close across the listed groups**, with the per-group times recorded in `notes`.

R-01 is a containment lookup, so the only thing at stake is whether a fill can fall outside every session, and the latest close guarantees it cannot. The next session opens at 17:00 CT regardless, so no overlap is created and no fill is orphaned.

**The rejected alternative is a symbol dimension on the calendar.** It turns R-01 from a day lookup into a per-symbol lookup and changes the engine's calendar contract, which is a far larger change than an early-close table warrants, and it would make the calendar's grain differ from the grain every counter is defined at. Founder ruling **F-3**.

---

## 6. How the loader proves it loaded what the source said

**The loader lives in `packages/db/src/seed/`** because `packages/db` is the only package permitted to import the database client ([ADR-008](../decisions/ADR-008.md), `merit/no-raw-db-client`, whose single `ignores` entry is this package). Putting it anywhere else needs a second lint exception, and the exception is the control.

| Proof | What it catches |
|---|---|
| **Digest round-trip** | The loader canonicalizes the rows it is about to write and hashes them. After commit it **re-reads the rows from the database**, re-canonicalizes and asserts the digests match. Catches a truncated load, a partial transaction, and a `timestamptz` rendered in the session's timezone rather than UTC |
| **Declared count** | The file's `session_count` equals the rows written, which equals the generated array length. Three statements of one number |
| **Idempotence** | Re-running against an unchanged source writes nothing and still passes the digest check |
| **Refusal, never a silent update** | Re-running against a source whose already-loaded days changed **fails and prints the diff**. Section 4's discipline expressed as loader behaviour rather than as a rule somebody remembers |
| **Timezone hostility** | The loader's suite runs under `TZ=Asia/Kolkata` and must produce byte-identical rows, borrowing `RE-D-02`'s idiom. A calendar loader is the most timezone-sensitive program in this system |
| **The positive control** | The untouched source must load clean. **A loader that refuses everything passes every seeded violation and gates nothing**, which is [`falsify.mjs`](../../scripts/corpus/falsify.mjs)'s standing lesson and the golden loader's, in the same words |

Every loader rule ships with a seeded violation and must fail **on that finding** rather than merely exit non-zero, per [P1 section 6](P1-monorepo-scaffold.md).

---

## 7. Which gate catches a calendar disagreeing with the exchange

Three layers, catching different things.

### 7.1 `CI-06m`, offline, in the corpus runner

The letter is `m` because `a` through `j` are in [`gates.mjs`](../../scripts/corpus/gates.mjs) today, **FOLD-01 claims `k`** and **FOLD-02 claims `l`**. Gate identifiers have no allocation table, so the identifier is claimed when its [STRATEGY](../testing/STRATEGY.md) row is written.

Three checks:

1. The source file's declared counts agree with its own contents.
2. **The fixture calendar is regenerated and `git diff --quiet`**, which is the pattern [`corpus.yml`](../../.github/workflows/corpus.yml) already uses for generated spans.
3. Every `date` column in the migration set has a DATA_MODEL row naming its unit (section 8).

**Check 2 is the load-bearing one.** `cme-2026.json` says in its own note that two hand-maintained calendars is the drift class this corpus has found thirteen times. Deriving it and asserting the derivation is reproducible is what turns that sentence into a mechanism.

### 7.2 The `migrations` job, extended rather than duplicated

[ADR-036](../decisions/ADR-036.md)'s precedent is explicit: a sibling job would need a second copy of the source parser, and two expressions of one concept agree exactly until they do not. So the existing job gains, after its apply step, a loader run against the real PostgreSQL 16 service, the digest round-trip assertion, and `scripts/db/probe_trading_calendar.sql` beside the two probes already there. One perturbation each, **checked by message rather than by exception class**: a holiday carrying a session is rejected, `session_close_at <= session_open_at` is rejected, a duplicate `trading_day` is rejected.

### 7.3 Production, against the exchange

AS-M2-06's divergence alarm on `trading_day_vendor` (section 3.2), `FM-M7-08`'s staleness alarm ("maintained as data with a staleness alarm", named there beside `contract_specs`), and **one control this plan adds**:

> **The batch fails closed on a day outside coverage.**
>
> Today an exhausted calendar is **indistinguishable from an unbroken holiday**. No row means not a trading day, so every counter quietly stops advancing, no rule fires, nothing breaches, nothing becomes eligible, and **nothing raises**. A calendar that runs out is the single most silent failure available to this table.
>
> A stored coverage fact makes "we do not know about this day" a positive answer, and the batch refuses rather than guesses. A horizon alarm warns when coverage runs less than six months ahead, and the annual review joins [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md), which today carries 90-day and quarterly rows and no annual one.

---

## 8. The wall clock and the trading day

**This section is why the plan was written now rather than after the two folds in flight.**

### 8.1 The founder's ruling, carried

**The FOLD-01 and FOLD-02 clocks are WALL CLOCK, and the obligation is to RELEASE, not to SETTLE.** Release means the hold ends. Settlement follows the rail's published 2 to 3 business days. This keeps the promise honest and keeps it Merit's to keep.

### 8.2 How the two coexist, stated so a future reader cannot assume one governs the other

> An obligation Merit binds itself to is measured in exactly one of two units.
>
> **Trading days**, answered only by `TradingCalendar`, for every engine counter.
> **Wall-clock hours**, answered only by `now()`, for every release deadline.
>
> **Nothing Merit computes is measured in business days.** That is the rail's language, quoted on the surface where the rail's leg is described, and never computed by Merit.
>
> The calendar has no opinion about a `timestamptz` deadline, and a `timestamptz` deadline has no opinion about whether the exchange is open. **A 48 hour hold that expires at 03:00 on Christmas Day releases at 03:00 on Christmas Day.** That is not an oversight in the unit, it is the reason the unit was chosen. Releasing is Merit's own act and needs no exchange, no bank and no calendar, which is exactly what makes it a promise Merit can keep. An obligation that waited for the exchange would be a promise about somebody else's schedule.

### 8.3 Is any existing trading-day counter at risk of being computed against a wall clock?

**Measured answer: no, and the risk runs the other way.**

Across all 28 merged migrations: zero `::date`, zero `CAST(`, zero `interval` in any case, no `date` column with any default, and every `now()` a `DEFAULT now()` on a `timestamptz`. The engine is guarded three ways and cannot read a clock at all. **Nothing is wrong today**, and that is a measurement rather than a reassurance.

**The exposure is what the two folds are about to add.** `0029` through `0031` introduce the first `interval '48 hours'` arithmetic and the first `now()` comparisons on the money path, plus an hourly sweep. The moment that is idiomatic in the payout tables, the next session that needs "five trading days from now" has a working pattern sitting right there that produces a wrong answer on roughly 104 days a year. **The moment to wire the guard is before those migrations, not after**, and it is cheapest now precisely because it is green.

Three at-risk items, found by looking, none of them a defect yet:

| # | At risk | Why |
|---|---|---|
| **1** | `payout_requests.freeze_expires_at` and `wallet_withdrawals.freeze_expires_at` | Both are `timestamptz`, and [M05](M05-payout-system.md) describes them in **business days**: "10 business days" for the freeze, `payout.freeze_expiring` "2 business days before". The column can only express wall clock, the prose promises business days, and **there is no business-day calendar anywhere in the system**. Whoever implements the sweep reaches for the only calendar in the database, which is the trading calendar, which is a different set of days. `OQ-F2-02` is already circling this without naming the unit |
| **2** | "business day" as a unit | It appears in M04, M05, M07, M09, M11, M12, M16 and three runbooks, including the published settlement claim the brand is built on, and it is **not in [GLOSSARY](../GLOSSARY.md)** and has no table. A trading day is not a business day **in either direction**: the exchange trades on days banks are shut and shuts on days banks trade |
| **3** | 45 `date` columns whose unit is not derivable from their type | And derivable from their name for only some of them. `published_statistics` carries `as_of_trading_day`, whose unit is in the name, beside `window_start_day`, whose unit lives only in M12 and whose DATA_MODEL Why cell is empty, **in one table** |

### 8.4 Enforcement, because prose is not a control and this corpus keeps proving it

Three mechanisms, each watched failing on its own seeded violation:

| # | Mechanism | Why this one |
|---|---|---|
| **1** | **An import ban** in [`packages/eslint-plugin-merit`](../../packages/eslint-plugin-merit/README.md), beside `no-raw-db-client` and `engine-purity`: the hold, expiry and sweep code path may not import `TradingCalendar` | The strongest of the three. **An import is checkable and an intention is not**, and this is the same shape as the two rules already in that plugin |
| **2** | **A SQL shape check** over `packages/db/migrations`: no `interval` arithmetic against a `date` column, and no `timestamptz` cast to `date` | Vacuously true today, which is precisely the argument for wiring it now. A gate wired while it is green and watched failing on a seed is the cheapest it will ever be |
| **3** | **The unit declaration gate** in `CI-06m`: every `date` column has a DATA_MODEL row naming its unit | `payable_after` and `chargeback_window_ends_on` are the model to copy. And the transparency surface already got this right **in the type rather than in the prose**: `statistic_unit` carries `duration_seconds`, not `days`, per [ADR-031](../decisions/ADR-031.md) |

**One place both units legitimately appear**: the trader's screen, where `next_eligible_trading_day` and a hold's `expires_at` can sit together. The rule there is copy rather than code, and each is labelled with its unit. M04 and M16.

---

## 9. Findings needing a founder ruling before the fold begins

| # | Finding | Recommendation |
|---|---|---|
| **F-1** | **`is_holiday` is unwritable as designed.** `session_open_at` and `session_close_at` are `NOT NULL` under `CHECK (session_close_at > session_open_at)`, so a holiday row must carry a **fabricated** session interval, while the CHECK immediately beside it says in its own comment that "a holiday has no session to contain fills in". Either the column is dead and holidays are an absence, or fabricated instants enter a containment table | **Supersede.** `0004` is merged and E2 permits superseding only. Make the session columns nullable for holiday rows under `CHECK (is_holiday = (session_open_at IS NULL))` with the ordering check made NULL-safe. A holiday becomes a **positive fact rather than an absence**, which is also what section 7.3's fail-closed control needs |
| **F-2** | **A corrected calendar row leaves no prior image** (section 4), so replay cannot distinguish a calendar correction from an engine regression, and `INV-04` is defined against a value that can move | An append-only `trading_calendar_revisions` table: prior row image, actor, reason, source digest, incident reference. **The cheaper alternative, git as the history, is real but incomplete**: git records what the **file** said and cannot prove what the **database** held when the mark was computed |
| **F-3** | **One `session_close_at` cannot serve six symbols across three exchanges on an early-close day** (section 5) | Latest close across the listed groups, per-group times in `notes`. Reject the symbol dimension, which changes R-01's contract |
| **F-4** | **Coverage has no storage**, so an exhausted calendar reads as an unbroken holiday and every counter silently stops (section 7.3) | A `trading_calendar_loads` fact: source id, coverage bounds, source digest, loaded at, actor. It serves fail-closed, the horizon alarm and the digest round-trip at once. **Needed under either reading of F-1** |
| **F-5** | **[FOLD-02 section 2](FOLD-02-enforcement-window-and-suspension.md) states its allocation rows "are written in the same commit as this fold's". They are not in [DECISIONS](../decisions/README.md) on this branch.** The migration table still reads "Nothing is reserved today and `0029` is the next free number" and the ADR table still ends at 036, on the branch that carries **both** fold plans. A sibling reading this branch sees `0029` and ADR-037 free | Write the six reservation rows before S-E claims anything. **A hand-maintained claim about the registry that exists to end hand-maintained claims**, which is exactly where this corpus keeps finding them |

---

## 10. Number allocation

Claimed at fold time and not in the planning session, read against `gates.mjs`'s `allocated()`, which parses the first cell of table rows only.

| Registry | Claim |
|---|---|
| **ADR-037**, **ADR-038** | Taken by `claude/builder-reviewer-loop-rykvhs`, open as PR #15 |
| **ADR-039** | [FOLD-01](FOLD-01-phone-identity.md)'s passwordless ADR |
| **ADR-040**, **ADR-041** | [FOLD-02](FOLD-02-enforcement-window-and-suspension.md)'s two rulings |
| **ADR-042** | **This fold**, carrying the unit ruling of section 8, F-1 through F-4, and the calendar source discipline |
| **`0029`** | FOLD-01's `0029_phone_identity_and_auth.sql` |
| **`0030`**, **`0031`** | FOLD-02's two migrations |
| **`0032`** | **`0032_trading_calendar_holidays_coverage_revisions.sql`**, carrying an `E2 READ: MONEY PATH` header naming what in it needs the line-by-line read and why |

**S-E cannot claim `0032` while `0029` through `0031` have no rows.** Gaplessness is asserted over allocated plus reserved, so the hole fails `CI-06h`. **F-5 is a hard prerequisite rather than a note.**

---

## 11. Session sequence

[ADR-003](../decisions/ADR-003.md) strict regime: money path, one objective per session, fresh session each time, `/clear` between.

| # | Session | Regime | Produces |
|---|---|---|---|
| **S-E1** | The ADR, F-5's six reservation rows, and this fold's two allocation rows | money path | Lands alone, so a sibling branch can read the numbers before anything is written against them |
| **S-E2** | `0032`, the `DELTA_MANIFEST` rows, the DATA_MODEL sections | money path, fresh session | The founder's E2 read happens on this diff, incrementally, per read-early-merge-late |
| **S-E3** | The source file, its provenance artifact and digest, and the generated sessions | money path, fresh session | The hand-transcribed surface is small: holidays plus early closes. The generated year is committed and reviewed |
| **S-E4** | The loader and its six proofs | money path, fresh session | `packages/db/src/seed/`, plus `scripts/db/probe_trading_calendar.sql` |
| **S-E5** | `CI-06m`, the lint rule, the SQL shape check, and the fixture derivation | non-money | Each watched failing on its own seeded violation in `falsify.mjs` |

**Deliberately out of scope: the `TradingCalendar` module itself.** [GLOSSARY](../GLOSSARY.md) and [M02](M02-rithmic-bridge.md) name it as a shared module and [M01](M01-rules-engine.md)'s `calendar.ts` is pure over an injected slice. P1's scope for this session is "the seed mechanism and the calendar rows". **The query surface arrives with its first consumer** rather than being guessed at now, and this plan fixes its home so it cannot land in two places.

---

## 12. Definition of done

Every line is a command, run rather than asserted, matching P1's own definition of done.

1. `node scripts/corpus/gates.mjs check` green with `CI-06m` present, and `node scripts/corpus/falsify.mjs` green with the new seeded violations, **each failing on its own finding**.
2. `node scripts/corpus/gates.mjs generate` then `git diff --quiet`, with the fixture calendar now part of what regeneration reproduces.
3. The `migrations` job on a clean PostgreSQL 16: apply `0001` through `0032`, run the loader, assert the digest round-trip, run all three probe files.
4. Re-run the loader unchanged: zero rows written, digest check still passes.
5. Mutate one already-loaded day in the source and re-run: **refusal with a printed diff**, never an update.
6. `TZ=Asia/Kolkata` over the loader suite: byte-identical rows.
7. The `golden` Vitest project: the three existing fixtures still load clean against the **derived** `cme-2026.json`, and `L-08`'s coverage check still fires in both directions.
8. Seed a wall-clock violation of each kind (an `interval '5 days'` against a `date` column; a `TradingCalendar` import in the sweep path) and watch each of the three section 8.4 mechanisms fail on it.

---

## 13. Open questions for the founder

| # | Question |
|---|---|
| **OQ-SE-01** | **F-1 through F-4**: four schema changes to a money-path table, or fewer. F-4 is needed under every reading of F-1, and the four are one migration or none |
| **OQ-SE-02** | **How many years of coverage at launch?** `0004`'s own `COMMENT ON TABLE` says "seeded years ahead, reviewed annually". Recommended: the current year plus two, which is about as far as CME publishes, with the horizon alarm at six months |
| **OQ-SE-03** | **Does "business day" get retired as a Merit-computed unit?** (Section 8.3, item 2.) Recommended: yes. It is defined in GLOSSARY as the rail's language, quoted and never computed, and `freeze_expires_at`'s "10 business days" becomes wall-clock hours or trading days **deliberately**. This folds into `OQ-F2-02`, which is already asking half of it |
| **OQ-SE-04** | **Is a second independent encoding of the holiday list worth its cost?** The IANA cross-check covers DST completely and covers the holiday list not at all. The candidates are a second hand transcription by a different reader with an empty diff required, or an ADR admitting a vetted calendar package **as a CI cross-check only, never as the loader's input**. Recommended: the second transcription for v1, because it needs no dependency admission |
