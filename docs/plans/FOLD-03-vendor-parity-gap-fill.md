---
status: approved
depends_on: [../decisions/ALLOCATION.md, M04-trader-portal.md, M06-admin-ops-console.md, M07-risk-abuse.md, M16-notification-center.md, ../../research/PROP_TECH_LANDSCAPE.md, ../DELIVERY_PLAN.md]
last_updated: 2026-08-20
---

# FOLD-03: the vendor-parity gap-fill

**A fold plan, not a module plan.** It carries two rulings and the fold of the first, and it exists because five frozen module plans gain scope after a baseline parity check against the PropAccount vendor demo. **Changing a frozen document requires an ADR, not a commit**, so nothing here lands until `ADR-066` does.

**Six items were referred. Four of them are not what the referral described**, and the differences are in section 3 rather than absorbed silently. **The referral was right about every item's intent and wrong about the tree in four places**, which is the ordinary result of reading a demo against a corpus nobody re-read first.

**Two exclusions, both stated rather than assumed.** **Platform downloads** are out: Rithmic credentials already unlock the platform menu and the marketing site covers platform choice. **Competitions** are out. Neither is a gap and neither is revisited by this fold.

---

## 1. The two rulings

| | |
|---|---|
| **`ADR-066`** | **The vendor-parity gap-fill.** Five surfaces admitted into frozen module plans, with sizing. Non-money |
| **`ADR-067`** | **Manual account and wallet balance adjustment.** The one money-path item. It amends [ADR-010](../decisions/ADR-010.md)'s sensitive set. **Its own session, plan mode, ADR-003 strict** |

**`ADR-067` is specified in section 6 and deliberately not written by this fold.** [CLAUDE.md](../../CLAUDE.md)'s cadence table reads *"Money-path work: new session every time. ADR-003, no exceptions."* A fold plan that wrote a ledger ruling in the same session as four surface additions would be the context poisoning that rule exists to prevent. **Section 6 is written so the money session transcribes rather than designs.**

---

## 2. Number allocation, claimed BEFORE anything is written

Per [ADR-034](../decisions/ADR-034.md) and [ADR-036](../decisions/ADR-036.md), and reserved in [ALLOCATION](../decisions/ALLOCATION.md) in its own commit before this document existed.

| Registry | Claim |
|---|---|
| **`ADR-066`** | This fold's parity ruling |
| **`ADR-067`** | The balance-adjustment ruling. **Money path** |
| **`0038`** | `0038_account_adjustments.sql`. **Money path.** Named as the next free migration in five consecutive session logs and claimed here for the first time |
| **`0039`** | `0039_economic_calendar.sql`, closing `DEP-M7-06` |
| **`0040`** | `0040_report_schedules.sql`, the schedule and its delivery-attempt log |
| **`0041`** | `0041_notification_delivery_outcomes.sql`. **CONTINGENT**, see section 5 |

**Every remote ref was read before these numbers were taken**, by `git ls-remote` and by claim, which is the manual step the `044` collision exists to teach. **Thirty-nine refs.** All maxed at `060` except `claude/merit-futures-briefing-7auoor`, which carries [WAVE-03](WAVE-03-duplicate-registry-keys.md)'s reservations to `065`. **This fold therefore runs on that branch and not on `main`**: a branch without `061` to `065` would show five holes and fail `CI-06f` gaplessness.

**`0041` is reserved contingent and may be released.** Gaplessness is asserted over allocated plus reserved, so an unspent reservation costs nothing, and inventing a number mid-session is the failure this table exists to prevent.

---

## 3. What the primary sources say, checked rather than recalled

**Four of the six items are not what the referral described.** Each was checked at `file:line`.

### 3.1 The economic calendar is already a declared dependency, already assigned, and already unsatisfied

**[M07](M07-risk-abuse.md) `DEP-M7-06` reads: "A maintained Tier-1 economic calendar, as data | M6 admin, seed | D-04 fires on the wrong windows."** And `D-04` news-window clustering reads *"`fills` plus a maintained Tier-1 economic calendar"*. And `FM-M7-08` reads *"Tier-1 calendar stale ... Calendar freshness is itself a monitored data dependency, like `contract_specs` and `trading_calendar`. Maintained as data with a staleness"* alarm.

**So the corpus committed to this dataset when M07 was written, assigned it to M6 admin plus seed, and required a staleness monitor. No table satisfies it, so `D-04` is not implementable today.** The referral proposed the shared dataset as a design choice. **It is not a choice; it is an outstanding commitment**, and this fold closes it.

**That forecloses the source question the referral asked.** A third-party embed cannot be the source of truth, because an embed cannot carry a revision, cannot be monitored for staleness, and cannot be joined to `fills`. **The ruling is an ingested feed into a Merit-owned table**, with the [M04](M04-trader-portal.md) surface rendering from Merit's own row. **An embed beside it would be the second source of truth for "when was the news", which is exactly what the referral warned against and what `FM-M7-08` already guards.**

### 3.2 There is no reporting layer and there are no saved views

**The referral scopes item 2 as recurring delivery of "the reporting layer's saved views".** A grep for `saved view`, `reporting layer` and `scheduled report` across `docs/plans/` and `docs/architecture/` returns **nothing**. The only `SFTP` in the corpus is [M02](M02-rithmic-bridge.md)'s Rithmic file transport, which is a vendor wire format and not a reporting channel.

**So item 2 as written would require specifying a report builder first, which is a module and not a fold.** The four reports the referral names are all derivable from panels [M06](M06-admin-ops-console.md) already has, so **the ruling scopes a fixed, named digest set over existing panels** rather than a general saved-view scheduler. Section 5.2 names the four and their sources. **A report builder is not admitted and is not a v1 gap.**

### 3.3 M16 has five classes, not four, and most of item 4 already exists

**The referral cites "the existing M16 four-class ruling". [M16](M16-notification-center.md) section 1.2 is headed "The five classes, which are the module's real specification"**, and `NC-M16-05` is [ADR-039](../decisions/ADR-039.md) amendment 2, *"the module's first class that is not about a customer."* **Any fold citing four classes would have written a false citation into a frozen document.**

**And the communications log is largely specified already.** `GET /admin/notifications/:identityId` **already exists** and already reads *"What was sent, when, to which channel, and its delivery status. The proof-of-notice query."* `SD-M16-02` already adds `rendered_body text`, which is the content snapshot. `FM-M16-05` already separates `sent_at`, `delivered_at` and `read_at`, and the machine at M16:113 already carries `dispatched --> delivered: provider confirms`.

**Genuinely new, and all of it: `bounced` and `spam_complaint` as outcomes, the alert they feed, admin resend, and download.** The rest is a citation, not an addition.

### 3.4 The duplicate-signal views need no new signal, and phone is already one

**The referral is exactly right here and it is the only item that is.** [M07](M07-risk-abuse.md):84 lists the approved signal model as *"normalized email, device fingerprint, IP and ASN, payment fingerprint, verified KYC identity, and settlement-rail destination"*, and **`D-18` Registration phone lookup** already reads `identity_phones` carrier metadata at capture (`SD-M19-05`). **Every signal the referral names exists.** These are views over `identity_signals` and the link tiers, they duplicate no detection logic, and they need no migration.

### 3.5 Balance adjustment does not exist, and dual control has a closed list

**A grep for `adjust`, `goodwill`, `rectif` and `manual balance` across [M06](M06-admin-ops-console.md) and [M20](M20-wallet.md) returns nothing relevant.** Item 5 is entirely new scope.

**And [M06](M06-admin-ops-console.md) section 3.4 states the sensitive set as a closed list**, per [ADR-010](../decisions/ADR-010.md): *"payout cap, split, cadence gap, treasury credentials, and rail credentials."* **An adjustment is not on it**, so putting one behind dual control is an amendment to ADR-010 rather than an application of it. **That is why item 5 gets its own ADR and not a paragraph in `ADR-066`.**

---

## 4. Sizing, against the existing roadmap discipline

[DELIVERY_PLAN](../DELIVERY_PLAN.md) sizes by launch-blocking test rather than by appetite. **These are sized the same way, and the honest answer is that four of the six are SHOULD.**

| Item | Size | Why |
|---|---|---|
| **The calendar dataset** (`0039`, M6 seed) | **MUST** | It is not new scope. `DEP-M7-06` is an outstanding commitment and `D-04` cannot run without it |
| **The M04 calendar surface** | **SHOULD** | Trader-facing convenience. The dataset is the commitment; the widget is the parity item |
| **Scheduled digest delivery** | **MUST**, narrowly | **The weekly risk ritual is a C8-class control and its input is currently a human remembering to look.** Only the daily liability digest and the weekly loss-ratio and CUSUM digest are MUST; the flag-queue and cohort digests are SHOULD |
| **Duplicate-signal views** | **SHOULD** | Pure surface over existing signals. Real operator value, no new capability |
| **Communications completeness** | **MUST**, partially | **`bounced` and `spam_complaint` plus the alert are MUST, because OTP login depends on deliverability** and a silent bounce is a locked-out trader. Resend and download are SHOULD |
| **Balance adjustment** (`ADR-067`) | **SHOULD** | Rectification has a manual path today through the ledger. It is a real gap and it is not launch-blocking |

**The one MUST that is not obvious is the delivery-failure alarm**, and it earns it the same way [M05](M05-payout-system.md) `INV-M5-18` does: **the alarm fires on the delivery record, never on the job.** A sweep that reports success is not evidence that the work happened, and a report that stops arriving is how liability blindness starts.

---

## 5. `ADR-066` folded, by item

Each block below is what the folding session writes. **Identifiers are allocated here so four concurrent sessions cannot collide.**

### 5.1 The economic calendar, M04 surface and M06 dataset

| | |
|---|---|
| **New in [M06](M06-admin-ops-console.md)** | `SD-M6-nn` for `economic_calendar`, owned by M6 admin plus seed per `DEP-M7-06`. Columns carry the event key, its **scheduled release instant in UTC**, tier, and a **revision**, because a release time moves and `D-04`'s windows must move with it |
| **New in [M04](M04-trader-portal.md)** | A dashboard panel rendering Tier-1 events **in the trader's timezone**, read from Merit's table and from no embed |
| **Acceptance, one row** | The panel and `D-04` read **one row**. A test asserts the panel's source is `economic_calendar` and not an external origin, which is the only mechanical form of "one source of truth" |
| **Acceptance, staleness** | A **staleness alarm** exists per `FM-M7-08`, on the same footing as `contract_specs` and `trading_calendar` |
| **Acceptance, revision** | A revised release time moves both the panel and `D-04`'s window, asserted together |
| **Golden scenarios** | **GS-285** a Tier-1 event renders in two traders' timezones from one row. **GS-286** a revision moves the window and `D-04` re-evaluates against the new instant. **GS-287** a stale calendar raises the alarm and `D-04` declines to fire rather than firing on stale windows |
| **Sizing** | dataset **MUST**, surface **SHOULD** |

**`GS-287` is the load-bearing one.** `FM-M7-08` says a stale calendar makes `D-04` fire *"on the wrong windows or not at all"*, and **firing on wrong windows is worse than not firing**: it manufactures evidence against a trader. The fixture pins the declining behaviour.

### 5.2 Scheduled digest delivery, M06

| | |
|---|---|
| **New in [M06](M06-admin-ops-console.md)** | `SD-M6-nn` for `report_schedules` and `report_deliveries` (`0040`). Frequency, recipients, format (**CSV or PDF**), and **one row per delivery attempt with its outcome** |
| **The four digests, from panels that exist** | **Daily liability**: Open Liability, Eligible-Next-7-Days, reserve coverage ratio (`P-M6-07`). **Weekly**: plan loss ratios and CUSUM status. **Weekly**: flag queue summary. **Monthly**: revenue and cohort |
| **Channels** | Email, and **SFTP push**. SFTP reuses no M02 code path: M02's SFTP is a vendor wire format under [ADR-005](../decisions/ADR-005.md) and coupling them would make a reporting change a provisioning incident |
| **Acceptance, the alarm** | **A failed delivery alarms and never silently skips.** The alarm reads `report_deliveries`, not the job's own report |
| **Acceptance, the ritual** | The scheduled digest **is** the C8 weekly risk ritual's input, stated in the ritual's runbook rather than implied |
| **Acceptance, no bulk export** | `INV-M6-10` still holds: **no digest is a bulk identity export.** The liability digest is aggregate; the flag-queue digest names counts and links, never trader-identifying rows |
| **Golden scenarios** | **GS-288** a delivery fails and the alarm fires from the delivery record with the job reporting success. **GS-289** a digest containing no trader-identifying data satisfies `INV-M6-10`. **GS-290** a schedule with a removed recipient degrades to the remaining recipients and records the removal |
| **Sizing** | daily liability and weekly loss-ratio **MUST**; flag queue and cohort **SHOULD** |

**`GS-288` is `INV-M5-18`'s idiom, deliberately reused.** The job reporting success while nothing arrived is the exact failure `M05`'s nightly assertion was written against, and a second sweep with the same shape gets the same control rather than a new one.

### 5.3 The duplicate-signal quick reports, M06 over M07

| | |
|---|---|
| **New in [M06](M06-admin-ops-console.md)** | Six standing views: shared **IP**, shared **device fingerprint**, shared **payment fingerprint** (BIN plus last4 hash), shared **phone or carrier** (`D-18`, `SD-M19-05`), shared **KYC-match**, shared **payout destination** |
| **Each row shows** | The signal, the linked identities, account count, **aggregate open liability**, and a jump to the graph explorer (section 7.9) |
| **Default sort** | **Aggregate open liability, descending.** The biggest exposure surfaces first or the view is a curiosity |
| **New in [M07](M07-risk-abuse.md)** | **Nothing.** One sentence recording that these are views and that no detector is duplicated |
| **Acceptance, no duplicated logic** | **No detection logic is duplicated.** A test asserts the views read `identity_signals` and the link tiers and compute no confidence of their own |
| **Acceptance, the tiers** | The views respect the link tiers: a **soft link** is displayed as a soft link and **changes nothing a trader may buy**, per M07:94 |
| **Acceptance, subject-scoped** | `INV-M6-10` holds: these views name a signal and its identities, which is a specific-subject query, not a bulk export |
| **Golden scenarios** | **GS-291** a shared IP across three identities ranks below a shared payment fingerprint across two with higher liability. **GS-292** a soft link renders as a soft link and triggers no state change |
| **Sizing** | **SHOULD** |

**`GS-291` is the sort assertion and it matters more than it looks.** M07:94 says *"a shared IP is a coffee shop; a shared device is a household; a shared card is a family"*, so **a view sorted by signal count teaches the operator to chase coffee shops.** Sorting by liability is what makes it a risk tool.

### 5.4 Communications completeness, M16 and M06

| | |
|---|---|
| **Already specified, cited not added** | `GET /admin/notifications/:identityId`, `rendered_body` (`SD-M16-02`), and the `sent_at` / `delivered_at` / `read_at` separation (`FM-M16-05`) |
| **New in [M16](M16-notification-center.md)** | **`bounced` and `spam_complaint` outcomes** (`0041`, contingent), and the alert they feed |
| **New in [M06](M06-admin-ops-console.md)** | Admin **resend** and **download** on the per-identity log |
| **The class rule, cited correctly** | [M16](M16-notification-center.md) section 1.2, **five classes**. The **security class is exempt from rate limits and preference opt-outs**, which is why a bounce on it is an incident and not a preference |
| **Acceptance, the bounce** | **A bounce or complaint on a security-class message alarms**, because OTP login depends on deliverability and a silent bounce is a locked-out trader |
| **Acceptance, resend fidelity** | **Resend is audited and re-renders nothing**: it re-sends the stored `rendered_body`, so proof of notice survives a template change |
| **Acceptance, the event set** | The event-triggered set is complete against [EVENTS](../architecture/EVENTS.md): welcome and credentials, eval passed, breach, payout requested and settled, wallet credit, KYC required, completed and failed, suspension and enforcement, affiliate events, inactivity, contract issued and signed, reset offers |
| **Golden scenarios** | **GS-293** a bounced security-class message alarms and the trader is not silently locked out. **GS-294** a resend after a template change delivers the original snapshot. **GS-295** a spam complaint suppresses marketing class and leaves security class untouched |
| **Sizing** | outcomes and alert **MUST**; resend and download **SHOULD** |

**`GS-295` is where the five-class ruling earns itself.** A complaint that suppressed every class would silence the freeze notice, and the class table already forbids that; the fixture pins it.

---

## 6. `ADR-067` specified, and deliberately not written

**MONEY PATH. Its own session, plan mode, ADR-003 strict.** This section is the specification that session transcribes.

| | |
|---|---|
| **The action** | An audited admin credit or debit against an account or a wallet, for **goodwill correction, reconciliation-error correction, or promotional credit** |
| **Never a balance mutation** | **Ledger-native double entry.** An adjustment posts a transaction or it does not exist. `0038`'s constraint makes an adjustment row without a posted transaction **unwritable**, which is `identity_restriction_restore_is_complete`'s shape |
| **The reason** | A **controlled vocabulary** plus free text. Both required. The vocabulary is closed and lives in the migration |
| **Dual control** | Above a **configurable threshold**, on [M06](M06-admin-ops-console.md) section 3.4's existing payload-hash machine. **This amends [ADR-010](../decisions/ADR-010.md)'s sensitive set**, which is a closed list of five that does not contain an adjustment |
| **Eligibility** | **An adjustment must not manufacture payout eligibility.** Excluded from the eligibility computation, **or admitted and flagged explicitly on the request**. The ruling picks one and says why |
| **Liability** | Reflected in **Open Liability immediately**, per `INV-M6-11`, which already requires every liability figure to include wallet balances |
| **Audit** | Actor, both actors on the dual-control path, the account timeline, and the evidence pack |
| **Golden scenarios** | **GS-296** adjustment then payout request. **GS-297** adjustment reversal. **GS-298** adjustment on a restricted identity. **GS-299** the threshold-crossing dual-control path |

**Three things the money session must settle rather than inherit.**

**First, the eligibility question is the whole ruling.** Zero denial means an eligible request is paid, so **an adjustment that creates eligibility creates an obligation.** Excluding adjustments makes a goodwill credit unwithdrawable, which is a different broken promise. **`GS-296` is written against whichever way it goes and the ADR states the trade rather than picking quietly.**

**Second, `GS-298` says restricted and not suspended.** [`0001`](../../packages/db/migrations/0001_extensions_and_enums.sql):27 declares `identity_status` as `('active','restricted','closed')` and [ADR-041](../decisions/ADR-041.md) **refused** to add `suspended`. **A scenario named for a state that does not exist is unwritable**, and `closed` deserves its own case.

**Third, the debit direction is the dangerous one.** A credit is goodwill; **a debit takes money from a trader's balance**, and nothing in the corpus permits that today. `INV-M6-03` says no admin action can deny a payout. **The ruling must say whether a debit is permitted at all**, and if it is, what stops it becoming the denial mechanism `INV-M6-03` forbids.

---

## 7. Item 6, the parity assessment

**[PROP_TECH_LANDSCAPE](../../research/PROP_TECH_LANDSCAPE.md) gains the assessment**, and it is a research document rather than a frozen plan, so it moves without an ADR.

**Merit is at or above vendor baseline on every demoed surface.** The structural advantages, each cited to where it is specified rather than asserted: **instant auto-approval** against the vendor's requested-approved-pending human queue ([M05](M05-payout-system.md) `INV-M5-01`, no `denied` value); **liability plus CVaR reserve coverage plus CUSUM plus loss-ratio breakers** against an open-positions-only risk tab ([M06](M06-admin-ops-console.md)); **a scored identity graph with biometric dedupe and behavioral fingerprinting** against duplicate-IP lists ([M07](M07-risk-abuse.md)); plus the **wallet** ([M20](M20-wallet.md)), the **transparency platform** ([M12](M12-transparency-platform.md)), the **indicative realtime layer**, **evidence packs** and **replay determinism**, none present in the vendor baseline.

**Competitions are a stated exclusion, not an oversight.** So are platform downloads.

**This assessment is the answer to "are we missing table stakes" and is cited at the FREEZE review.** **It should also record what the check cost**: four of six referred items were mis-scoped against the tree, and one of them, the calendar, was an outstanding commitment nobody had noticed was unsatisfied.

---

## 8. The fold, by file

| File | Item | Session |
|---|---|---|
| [M06](M06-admin-ops-console.md) | calendar dataset, digests, duplicate views, resend and download | **F1**, **F2**, **F3** |
| [M04](M04-trader-portal.md) | the calendar panel | **F1** |
| [M07](M07-risk-abuse.md) | one sentence: the views duplicate no detector | **F3** |
| [M16](M16-notification-center.md) | bounce and complaint outcomes, the alert | **F4** |
| [PROP_TECH_LANDSCAPE](../../research/PROP_TECH_LANDSCAPE.md) | the parity assessment | **F5** |
| [DELIVERY_PLAN](../DELIVERY_PLAN.md) | the sizing rows | **F5** |

---

## 9. Session sequence

**`ADR-066` first and alone**, because every fold below cites it and a fold that lands first amends a frozen document without a ruling.

| Rank | # | Session | Fence | Regime |
|---|---|---|---|---|
| **1** | **F0** | `ADR-066` | `docs/decisions/ADR-066.md`, `docs/decisions/README.md` | non-money |
| **2** | **F1** | The calendar: `0039`, M6 dataset, M4 panel | `docs/plans/M04-trader-portal.md`, the M06 dataset delta, `packages/db/migrations/0039_*` | non-money |
| **2** | **F4** | Communications completeness | `docs/plans/M16-notification-center.md`, `packages/db/migrations/0041_*` | non-money |
| **2** | **F5** | Parity assessment and sizing | `research/PROP_TECH_LANDSCAPE.md`, `docs/DELIVERY_PLAN.md` | non-money |
| **3** | **F2** | Scheduled digests: `0040` | `docs/plans/M06-admin-ops-console.md`, `packages/db/migrations/0040_*` | non-money |
| **3** | **F3** | Duplicate-signal views | `docs/plans/M06-admin-ops-console.md`, `docs/plans/M07-risk-abuse.md` | non-money |
| **4** | **F6** | **`ADR-067` and `0038`** | `docs/decisions/ADR-067.md`, `docs/plans/M06-admin-ops-console.md`, `packages/db/migrations/0038_*` | **MONEY PATH** |

**`F1`, `F4` and `F5` are concurrent.** Three files, three directories, no intersection.

**`F2` and `F3` are serial with each other and with `F1`**, because all three write [M06](M06-admin-ops-console.md) and it is one file. **`F1` writes only M06's dataset delta**, so the desk may run `F1` and `F2` together if it accepts one merge in `docs/plans/M06-admin-ops-console.md`; the plan's recommendation is not to.

**`F6` is last and alone.** Money path, and it also writes M06.

**This fold does not collide with [WAVE-03](WAVE-03-duplicate-registry-keys.md)**, whose sessions hold M05, M12, M20, INDEX, STATE, ALLOCATION, STATE_MACHINES, SECURITY and sessions/README. **The one shared file is `docs/INDEX.md`**, which WAVE-03's `S4` repairs and which every session here touches only through `gates.mjs generate`'s `adr_count` span. **Re-run `generate` after each merge rather than sequencing around it.**

---

## 10. Definition of done

- `ADR-066` and `ADR-067` exist, `status: proposed`, **unsigned approval lines**. Both admit scope to frozen documents, so the signature is the founder's.
- **GS-285 to GS-299** exist in the golden-scenario registry with their owning sections.
- The sizing rows are in [DELIVERY_PLAN](../DELIVERY_PLAN.md).
- `node scripts/corpus/gates.mjs check` green, with `CI-06c`, `CI-06d` and `CI-06n` among them: this fold adds registry entries in three registries.
- `pnpm vitest run` green.
- **`0041` is spent or released, and the row says which.**

---

## 11. Open questions for the founder

| # | Question |
|---|---|
| **OQ-F3-01** | **The eligibility trade in `ADR-067`.** Excluding adjustments from eligibility makes a goodwill credit unwithdrawable; admitting them lets an adjustment manufacture an obligation under zero denial. **Which, and is a flagged admission acceptable?** |
| **OQ-F3-02** | **Is a debit permitted at all?** `INV-M6-03` forbids an admin action that denies a payout. A debit against a balance is not that, and it is adjacent enough to need saying |
| **OQ-F3-03** | **The calendar feed's vendor.** The ruling fixes the shape as an ingested feed into a Merit table. **The vendor is not chosen here** and is a procurement question with a cost line |
| **OQ-F3-04** | **SFTP push for digests.** It is real operator demand and a second credential surface. **Is email alone acceptable for v1?** |
