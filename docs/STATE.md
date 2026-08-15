---
status: approved
depends_on: []
last_updated: 2026-08-15
---

# STATE

# **FROZEN** (2026-08-14)

**The planning corpus is complete, approved, and FROZEN. Application code may now begin.**

Every document is `approved` except [M02](plans/M02-rithmic-bridge.md), which holds at `review` by [ADR-005](DECISIONS.md) pending the Rithmic vendor call, as ruled.

**Branch-per-module and pull-request discipline resume now**, per constitution C7 and the amended [ADR-D1](DECISIONS.md). The corpus-phase single-trunk rule has expired; it was a corpus-phase rule and code exists from here.

---

## What FREEZE means, operationally

| | |
|---|---|
| **The corpus is the specification** | A behavior not in the corpus is not in scope. A behavior in the corpus is a commitment |
| **Changing a frozen document requires an ADR** | Not a commit. The document is the record and the ADR is how it moves |
| **Plan parameters remain launch candidates** | Confirmed at this gate, re-confirmed at launch as config per the standing [parameter-status ruling](DECISIONS.md). They are rows in `plan_version_sizes`, never constants |
| **Structural rulings are fixed** | Caps exist, the ladder exists and is finite, EOD semantics are authoritative, zero denial, the permanent floor lock, the wallet-credit cadence anchor. Absent a new ADR, these do not move |

---

## The gate that closed

**<!--gen:adr_count-->36<!--/gen--> ADRs. <!--gen:ec_count-->140<!--/gen--> edge cases. <!--gen:gs_count-->257<!--/gen--> golden scenarios. Four waves.** These are generated spans under [CI-06g](testing/STRATEGY.md); this line read "25 ADRs" until it was folded, which is the drift [ADR-034](DECISIONS.md) exists to end.

| Sign-off | Ruling |
|---|---|
| Wave 3 batch 2 (M09 to M20) | **APPROVED** |
| Wave 4 (testing, ops, design, legal) | **APPROVED** |
| Plan parameters | **CONFIRMED as launch candidates** |
| **Direct's ladder** | **4.** Direct skips the eval filter, so its funded population carries the unselected base rate and the heaviest per-account tail. The shortest ladder belongs on the least-filtered plan |
| **KYC trigger set** | **`{second_distinct_account_purchase, pre_funded}`, earliest fires.** Fleet coverage prevails; telemetry adjudicates post-beta |
| **M12 statistics, including S-16** | **APPROVED.** The first published number publishes whatever it says |
| **OQ-FREEZE-01** | Implementation **confirmed**, [ADR-025](DECISIONS.md)'s literal wording **overruled**. The perk is `promotional_credit`, never withdrawable. **The invariant guard caught a founder-guide wording error**, which is the review system working as designed |
| **OQ-FREEZE-02** | [ADR-D1](DECISIONS.md) amended: harness-launched sessions run designated branches and **must end mergeable**, founder merges **same day**; local sessions commit direct to `main`. **PR #2 merged** |

---

## The calibration engine landed and the corpus is recalibrated

`research/calibration/mc_lifecycle.py` is committed and was **run**. Full record in [SIMULATION_HARNESS section 9](testing/SIMULATION_HARNESS.md).

**Exact figures at the corpus configuration** (`w=3`, funded `min_trading_days = 0` on all three, ladder 5 / 5 / 4):

| Plan | Eval pass | Funded to payout | Firm $ per funded (50K) | Payouts per payer | Contribution margin |
|---|---|---|---|---|---|
| Core EOD | 26.53% | 33.46% | **$690.44** | 1.54 | **+0.25%** |
| **Merit Rapid** | 16.55% | **48.11%** | **$904.07** | **2.13** | **16.9%** |
| Direct | 100% | 12.07% | **$207.33** | 1.30 | **39.2%** |

[ADR-018](DECISIONS.md) carried $889, 48.1 percent, 2.09, and roughly 18 percent. **The funnel figure matched to two decimals; firm cost is 1.7 percent higher and margin 1.1 points lower. Immaterial, and mildly unfavorable.**

**Lifetime to trader at 50K: $6,750 Core EOD, $5,400 Direct, $4,500 Merit Rapid.**

**The reproduction check passed.** The engine as committed reproduces the workbook's plans tab, and the risk engine reproduces the calibration README's table **exactly, to the cent**: CVaR99 at rho = 0.30 is **$132,896.71**, the multiple **2.9285x**, all twenty ruin cells matching.

**The finding worth carrying: the ladder does not bind the average account.** Ladder 8/6 and ladder 5/4 return identical figures on Core EOD and Direct, because mean payouts per payer are 1.54, 2.13 and 1.30. **The ladder change is margin-neutral in the central estimate and its entire value is tail protection.** No margin table will ever show the ladder costing anything, so a future review looking only at unit economics may conclude it can be lengthened for free. **It cannot.**

**The engine is stale in four places** (plan name, Rapid's win days, Rapid and Direct minimum days, ladder counts). **Re-running it at the corpus configuration is a build-phase task** and must reproduce the table above before any CI calibration band is set from it.

---

## What survives FREEZE

**Nine items. Six are founder or third-party actions with no engineering content**, which remains the honest summary of where the schedule is exposed.

| # | Item | Blocking | Owner |
|---|---|---|---|
| 1 | **The Rithmic vendor call.** Sixteen `V-M2-nn` items. **`V-M2-15` is a commercial precondition rather than a question**: without an acknowledgement artifact or a readable risk setting, fail-closed provisioning brings **no account online at all**. Raise it first, not as item fifteen | M02 leaving `review`. Could stop a launch that is otherwise ready | founder |
| 2 | **PSP applications.** Two MIDs, sent **the day the capital go-decision lands**. Approval takes longer than the module does. A firm with one MID has no working version of [RB-03](ops/runbooks/RB-03-mid-freeze.md) | Revenue | founder |
| 3 | **The capital decision.** 18-month combined-stress ruin is **6.28% at $150K, 1.64% at $250K, 0.36% at $350K, 0.01% at $500K** | Whether the plan is worth executing | founder |
| 4 | **The counsel sitting.** Three items, one sendable document: [COUNSEL_PACKET](legal/COUNSEL_PACKET.md). Item 2, wallet characterization, is the only one that blocks launch and most likely resolves as yes-with-conditions | The privacy policy leaving draft; all live-program copy; the dormancy calendar | founder |
| 5 | **Re-run `mc_lifecycle.py`** at the corpus configuration and commit the result. Four stale places, listed above | CI calibration bands | claude, build phase |
| 6 | **Launch-time parameter re-confirmation.** Every value is a config row, and the standing rule requires a deliberate confirmation rather than an inherited one | Launch | founder |
| 7 | **The `promotional_credit` loyalty perk's build**, per OQ-FREEZE-01 as ruled | M14 | claude, build phase |
| 8 | **Post-beta KYC trigger adjudication** on the funnel and corpus-coverage telemetry | Nothing. A config array | founder, post-beta |
| 9 | ~~**The schema-delta reconciliation.**~~ **LANDED 2026-08-14**, pending the founder's E2 read. See below | The first line of application code | claude, done; founder reads |

---

## The first build session, as it was briefed

**Kept for the record because the brief was met.** Schema-delta reconciliation, money path, strict [ADR-003](DECISIONS.md) regime, plan mode mandatory. The plan was reviewed and ruled on before a migration file was written; the two money-path findings that needed a ruling (C-01's ledger classes and C-02's payout enum) were ruled, and **C-01 was ruled, folded, committed, and then reversed** when the founder re-read the source. That reversal is [ADR-027](DECISIONS.md) and it is the clearest evidence in the corpus that the plan-mode gate did the job it was there for.

**Definition of done, as briefed:** one migration set, every delta traced to the document that proposed it, every money-path column read line by line by the founder per constitution E2, and no delta silently dropped. **Three of the four are met. The E2 read is outstanding and is the only thing between this branch and a merge.**

---

## The schema-delta reconciliation has landed (2026-08-14, item 9)

**All <!--gen:manifest_changes-->94<!--/gen--> schema changes are folded. <!--gen:migration_files-->28<!--/gen--> migration files at [`packages/db/migrations`](../packages/db/migrations), verified to apply in order against PostgreSQL 16** (<!--gen:sql_tables-->96<!--/gen--> tables, <!--gen:sql_triggers-->6<!--/gen--> triggers; **index and check-constraint totals are emitted by the install job**, not stated here, because Postgres backs every primary key and unique constraint with an index and a grep of the DDL derives 219 where the database reports 326). **This line previously stated four hand-maintained figures and two of them were wrong when written**; DATA_MODEL carried different numbers for the same set. The exact class of drift [ADR-026](DECISIONS.md) caught in the delta counts, recurring in the document that recorded the catch, which is why the derivable two are now spans and the underivable two are gone. Every delta traces to the document that proposed it in [`packages/db/DELTA_MANIFEST.md`](../packages/db/DELTA_MANIFEST.md), which is the file [ADR-026](DECISIONS.md)'s completeness gate reads. **No delta was rejected.**

**Nothing merges without the founder's E2 line-by-line read.** <!--gen:e2_files-->18<!--/gen--> files carry an `E2 READ: MONEY PATH` header naming what in them needs it and why. **This line read "Sixteen" against seventeen files on disk**, which is the seventh hand-maintained count found wrong, so it is a [CI-06g](testing/STRATEGY.md) span now. The install check proves the set is installable and **proves nothing about whether a delta was folded correctly**, which is the whole reason E2 exists.

**Three things the fold produced that need a founder decision or a follow-on session:**

| # | Item | Why it matters |
|---|---|---|
| **A** | ~~A sixth unnumbered change.~~ **RULED AND CLOSED.** It is **`U-06`** and the total in scope is **94**. `0001`'s inline marker read `SD-M2-06`, the `reconciliations` delta, and is corrected to `-- U-06` in `0001` and added in `0007` | **The manifest gate exists so an uncounted change cannot hide, and it caught one on its first run.** That is the gate justifying itself, not a defect |
| **B** | **[ADR-030](DECISIONS.md)'s stale list is wrong in two of four.** `win_days.required_count: 5` and `phase_eval.min_trading_days: 1` are Core EOD's **frozen** values per [M01 Appendix A.1](plans/M01-rules-engine.md). `w = 3` is Merit Rapid's | Following the list would have put **Merit Rapid's cadence on Core EOD's contract**. Recorded in the amended section 11, not applied |
| **C** | ~~**DATA_MODEL is only partly at post-migration truth.**~~ **CLOSED 2026-08-15.** §3 through §10 rewritten table by table against the `.sql`. **The scope was larger than this row described: the migrations create 96 tables and the document carried 46 sections, so 50 tables had no design record at all.** All 96 now do, the reconciliation runs both ways as [CI-06i](testing/STRATEGY.md), and the line-15 banner is gone | **It closed with two findings rather than none.** [ADR-035](DECISIONS.md) is a proven defect in a merged money-path migration; `OI-01` (`liability_snapshots`' two shapes) is surfaced with a recommendation and still needs a ruling |

## Two rulings on the transparency surface (2026-08-14)

**Both land on `published_statistics`, both amend approved `SD-M12-02`, and both are folded into `0021` and `0027` rather than recorded.**

| ADR | Ruling | What it changes |
|---|---|---|
| **[ADR-031](DECISIONS.md)** | **`value_numeric numeric` becomes `value bigint` with a mandatory `value_unit`** | Its no-floats exemption is retired. All seven ruled statistics are exactly representable as integers, and for ST-03 and ST-04 the column held **money on a public surface**. `value_unit` and `numerator_unit` share one `statistic_unit` type, because two vocabularies for one concept is how they drift |
| **[ADR-032](DECISIONS.md)** | **`measure` joins the table and the window unique key, and STAT-C1 enforces the pair** | **Closes OI-02.** ST-04's median, and ST-05's and ST-06's p95, were unwritable. The column makes them writable; the deferred constraint trigger makes them **required**, converting "neither is published alone" from M12 prose into DDL. The rejected alternative, separate `stat_code`s per figure, is recorded: it needs no schema change and deletes the invariant by making it unstateable |

**The no-floats exemption list is now two columns and no money.** `correlation_groups.statistic` and `.threshold` stay exempt on the founder's ruling: a plain integer `rho` of `0.30` is `0`, and `rho = 0.30` is the reserve-critical figure.

**Every constraint carrying a ruling is now probed against the database**, one perturbation each, tabulated in [DELTA_MANIFEST section 10](../packages/db/DELTA_MANIFEST.md). **That testing found a defect a reading had passed**: a `CHECK` written `array_length(measures, 1) >= 1` admits the empty array, because `array_length` returns `NULL` there and **a `CHECK` evaluating to `NULL` passes**. It admitted the one value it existed to reject, and an empty declared set makes STAT-C1 vacuous. Now `cardinality()`.

## Blocked

Nothing.

**The ADR-031 collision is resolved.** Two open pull requests both claimed the number: PR #4 carried ADR-031 and ADR-032, PR #5 a different proposed ADR-031, and both branched from a `main` whose registry ended at 030. The founder assigned at merge, PR #5's became **ADR-033**, and **[ADR-034](DECISIONS.md) ruled that a number is claimed in an allocation table before the ADR is written**. [CI-06f](testing/STRATEGY.md) now **fails the second pull request to claim a number** rather than failing the corpus after both have merged, which is what this incident asked for in its own words.

## The DATA_MODEL rewrite landed, and found a defect (2026-08-15, item C)

**All 96 tables carry a `### <table>` design record with columns, types, constraints, indexes, retention and the reason each exists**, checked against the migration that creates it rather than against the plan that proposed it. Verified two ways: [CI-06i](testing/STRATEGY.md) reconciles the table sets in both directions from the tree, and a generated diff against a live PostgreSQL 16 catalogue found **zero undocumented columns and zero documented columns that do not exist**.

**[`scripts/corpus/gates.mjs`](../scripts/corpus/gates.mjs) exists and all eight gates pass.** CI-06a through CI-06g were specified and not running; they run now, with no dependencies. The first honest run found 27 broken anchors, all repaired, and one drifted count span, regenerated. **Each gate states what it does not cover** rather than implying full coverage.

**Two findings the rewrite would not reconcile quietly:**

| # | Finding | Needs |
|---|---|---|
| **[ADR-035](DECISIONS.md)** | **`0027`'s published-plan-version immutability trigger reads `NEW.config`; the column is `rules`.** Proven by executing it, not by reading it. Every update to a published row raises, so the promise holds by accident and **the ruled `published -> retired` transition is refused too: no plan version can be retired.** A draft row updates normally, which is why the install check and every existing probe missed it | **ACCEPTED 2026-08-15.** Fixed by [`0028`](../packages/db/migrations/0028_supersede_plan_version_immutability.sql), a superseding migration; `0027` is not edited. Set goes 27 to 28. **Two amendments at acceptance are larger than the ADR as proposed** and are named in it |
| **`OI-01`** | **`liability_snapshots` exists in the folded shape only**, and the approved design's four reserve-coverage fields have no home. §8 now recommends a separate table rather than widening this one, with the reasoning, and does not decide it | **STILL OPEN, deliberately.** A founder ruling before [M06](plans/M06-admin-ops-console.md). The reconciliation session was instructed not to decide it and did not |

---

## The PR #7 / PR #8 reconciliation (2026-08-15)

**Two branches overlapped on 11 of 13 files and both independently wrote `scripts/corpus/gates.mjs`. They are now one branch and nothing was dropped.**

**The founder's ruling on the runner, and the criterion is the transferable part.** PR #8's `gates.mjs` is the base **because it had been falsified**: it produced 109 phantom broken anchors and 119 phantom refless edge cases, both were traced to bugs in the runner rather than to the corpus, both were fixed, and only then did it find 27 real broken anchors. PR #7's runner had not been watched fail correctly. **A gate nobody has watched fail is not a gate**, and that is now [`scripts/corpus/falsify.mjs`](../scripts/corpus/falsify.mjs) rather than a judgment about a transcript.

| From | What landed |
|---|---|
| **PR #8** | `gates.mjs` as the base. The DATA_MODEL post-migration rewrite, all 96 tables. `ADR-035`. `CI-06i` |
| **PR #7** | `.github/workflows/corpus.yml` **unchanged**, the only CI wiring either branch had. `probe_ledger_constraints.sql`. The STATE reconciliation and item **A**'s closure (`U-06`, total 94). `CI-06h`. **[ADR-026](DECISIONS.md)'s manifest completeness gate, which PR #8 had no equivalent of.** `CI-06d` contiguity, `CI-06b` `depends_on` resolution, `CI-06a` duplicate-heading anchors, the `anchors` subcommand |
| **Neither** | **`CI-06j`**, the gate that would have caught `ADR-035`. `falsify.mjs`. `0028`. `probe_plan_version_immutability.sql` |

**Eleven checks run in one dependency-free runner, and every one has been watched pass clean and fail dirty.** The three things `falsify.mjs` found on its first run are in [STRATEGY section 4.4](testing/STRATEGY.md); the shortest of them is that **a gate failing for a reason nobody planted proves nothing**, which two of the eleven were doing.

**What was dropped, in writing rather than by omission:** PR #7's narrower per-gate document scopes, its finding-count exit accounting, and its prose. Nothing else.

**TWO artifacts this session produced are not wired into CI, and both are consequences of the ruling to take `corpus.yml` unchanged.** Adding a step is a change, so neither was added.

| Not wired | What it costs | The addition |
|---|---|---|
| [`scripts/corpus/falsify.mjs`](../scripts/corpus/falsify.mjs) | The eleven gates are proven falsifiable **as of this session** and nothing keeps them that way. A gate that stops failing correctly next month passes silently | three lines in the `integrity` job |
| [`scripts/db/probe_plan_version_immutability.sql`](../scripts/db/probe_plan_version_immutability.sql) | **The `migrations` job runs only `probe_ledger_constraints.sql`.** ADR-035's guard is verified by hand in this session and by nothing thereafter, which is the exact condition that let the defect live in `0027` | one line beside the existing probe step |

**Until they are wired they are scripts somebody has to remember**, which is the failure mode this corpus already named for the gates themselves. Both are founder calls, not a session's.

**`CI-06h` has now run in GitHub Actions and passed** (PR #9, first execution): the runner's own database reported **96 tables, 326 indexes, 347 check constraints, 6 triggers**, the re-apply was rejected, and the ledger probes fired 3/3. It is no longer a job verified only on a laptop.

---

## FOLD-01 is planned and approved, and it found a gap in a shipped control (2026-08-15)

**[FOLD-01](plans/FOLD-01-phone-identity.md) is `approved`.** The passwordless-auth and phone-as-identity ruling plus four founder amendments, planned across twenty-one files and six sessions. **Plan only; nothing was folded**, which was the brief's stop condition. The `FOLD-nn` series is new and exists because a ruling this size is too large to fold from a prompt and too small to be a module.

**The two decisions the brief required were taken, and the first turned on evidence rather than preference.** The registration lookup is **[ADR-023](DECISIONS.md)'s existing vendor**, because ADR-023 already buys phone digital-footprint, VPN and datacenter detection; **only portability history is separable, so it becomes a disqualifying selection criterion** rather than an assumption, since amendment 3's recycling guard has no input without it. Carrier metadata joins **counsel packet item 3** as a new sub-item.

**The founder ruled the hard link at plan approval**, because (b)'s phrase "auto-enforced like KYC face-dedupe" sits between `INV-M19-04` (a hit changes no state) and [ADR-022](DECISIONS.md) (hard links auto-enforce). One live verified phone per identity is a real unique index; a second identity verifying a live number **completes, binds the edge at the hard ceiling, and opens a severity-5 flag against both**.

| Finding | State |
|---|---|
| **`OI-06`. The 48 hour payout-destination cooling window has no storage.** There is no `payout_destinations` table in the merged 96; `destination_ref` is a column on `payout_transfers` and `wallet_withdrawals`, the destination **of a transfer**. **C-11, C-24, [SECURITY section 4](architecture/SECURITY.md) item 1, [M20](plans/M20-wallet.md) `WF-M20-02` and [M04](plans/M04-trader-portal.md)'s destination-cooling scenario all cite a control whose input does not exist** | **OPEN, a founder ruling.** Surfaced with a recommendation and deliberately not decided. Migration `0029` builds the phone hold on its own storage and does not touch it. **Found by trying to model the ruling's (c) on the control (c) says to copy** |
| **[SECURITY section 2.7](architecture/SECURITY.md) says "no SMS-based second factor anywhere in the stack" and the ruling adds SMS OTP** | **Resolved in the plan, folded by the ADR.** Section 2.7 sits under "The founder (the human asset)" and is rescoped to founder and admin credentials; admin keeps hardware-key SSO with no SMS path |
| **`contact_channels.kind check in ('email','push')`**, so `INV-M16-03`'s prior-contact countermeasure cannot notify a prior **number** | Folded by `0029`. The one contact kind the ruling makes an identity signal is the one kind the table cannot hold today |

**The plan pre-claimed ten delta identifiers, an edge case and a golden scenario, and [ADR-026](DECISIONS.md)'s gate refused all twelve.** The gate was right: **only ADR and migration numbers have an allocation table**, and a delta identifier is claimed by its `DELTA_MANIFEST` row existing. **That is [ADR-034](DECISIONS.md)'s drift class reproduced inside the plan for folding it**, and it was caught by a robot in under a minute rather than at merge, which is the argument for the gates in one line.

---

## FOLD-02 is planned and approved, and it collapses one of the two new states into a state that already exists (2026-08-15)

**[FOLD-02](plans/FOLD-02-enforcement-window-and-suspension.md) is `approved`.** The payout enforcement window (a pre-approval `held_pending_review` with a hard 48 hour auto-release) and identity-level suspension, planned across roughly twenty-six files and eight sessions. **Plan only; nothing was folded**, which was the brief's stop condition. **ADR-040, ADR-041, `0030` and `0031` are claimed, and `0029` plus ADR-039 are reserved for FOLD-01 in the same rows**, because gaplessness is asserted over allocated plus reserved and FOLD-01 had claimed neither yet.

**The founder's amendment 4 asked whether the new payout state is the bounded freeze under a second name. It is not, and the discriminator is whether the ledger has moved.** A held request has posted nothing: no LT-01, no wallet credit, nothing owed, so release means *approve and pay* and enforcement reverses nothing. A frozen request has posted LT-01 and the money is already the trader's. Two consequences are ruled rather than inherited: a held request **stores its full evaluated decision** so release re-evaluates nothing and every existing `NOT NULL` on `payout_requests` survives untouched, and **a hold that reaches expiry pays even if the account breached during it**, because the alternative is that Merit's own hold cost the trader money.

**The same question applied to Ruling B and the answer went the other way, which is the plan's one departure from the brief's literal wording.** `identity_status` already carries a reversible `restricted` value, wired through the enum, the machine, the events, [M20](plans/M20-wallet.md)'s spend and withdrawal gates and the trader's own `GET /me`. **`suspended` is `restricted` under a second name**, and what is missing is not the state but its binding surface, so the plan enumerates and asserts the surface instead of adding a second value.

| Finding | State |
|---|---|
| **An ADR-number collision with an open sibling pull request, which no gate could see.** The plan first claimed 038 and 039; **PR #15 had already reserved 037 and 038** in its own copy of the table. This branch is one commit ahead of a `main` ending at 036, and **eleven of eleven gates passed against that table** | **Resolved here rather than at merge**, on [ADR-034](DECISIONS.md)'s tiebreak. **This is `CI-06f`'s and `CI-06h`'s declared coverage gap met in the wild within two days of being declared**, and the cross-ref job that would close it is still not written. Every remote branch was checked; only the ADR half moved |
| **The zero-denial sentence is not in [CLAUDE.md](../CLAUDE.md).** The words "no `denied` status and no review state" are [GUIDE_BRIEFING](GUIDE_BRIEFING.md)'s, and the constraint is restated in **ten** places, **two of them inside merged migrations that can never be edited** | **Folded by the ADR.** `0010`'s `COMMENT ON TABLE` is replaceable metadata and `0031` re-states it; the two `--` comments stand, and the ADR says so rather than implying the sweep was complete |
| **The external leg's halt exists as columns with no state to sit in.** `wallet_withdrawals` carries the three freeze columns and its expiry index, and `wallet_withdrawal_status` has no frozen value, so a halted withdrawal still reads as open and nothing refuses settlement | **Folded by `0031`**, as enforcement rather than a state. The halt is orthogonal to the rail state, and collapsing it into that column is SD-M5-06's named mistake |
| **`restricted` blocks the wallet and nothing else Ruling B names.** `G-ELIGIBLE` names `payouts_frozen` and not `identities.status`; checkout has no restriction check; nothing revokes platform trading | **Folded.** The surface is enumerated once, in one table, and asserted |
| **`ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it**, and every index predicate in the change is such a use | **Two migrations, `0030` and `0031`.** Proven by executing the counterfactual (the combined file must fail), not by citing the manual |

**The auto-release is now the load-bearing control, so it is structural in three places and unsuppressible in one.** It joins the existing hourly freeze-expiry sweep and its S1 dead-man switch, its alarm fires on the query rather than on the job, and a hold or freeze past expiry becomes the **fourth unsuppressible alarm**, amending [M06](plans/M06-admin-ops-console.md) OQ-M6-01. A new gate, `CI-06l`, asserts from the tree that every expiry column names a release job.

**The Rithmic revocation leg is marked PROVISIONAL, and the honest form is an asymmetry: suspension is always available and restoration is contingent on `V-M2-15`.** With neither an acknowledgement artifact nor a readable risk setting, a restored account cannot be confirmed, and INV-M2-13 means an unconfirmed account does not trade.

**Four open questions for the founder**, none blocking the fold: the `suspended` versus `restricted` ruling, whether the 48 hour SLA also replaces the freeze's unruled 10 business days (as it stands Merit binds itself harder where nothing has moved than where the money is already owed), M15's partial versus full launch scope, and the fourth unsuppressible alarm.

---

## Next 3 actions

1. **The founder's E2 read** on the <!--gen:e2_files-->18<!--/gen--> money-path migration files, and a ruling on item **B** ([ADR-030](DECISIONS.md)'s stale config list, wrong in two of four). **A** and **C** are closed. Nothing merges first.
2. **In parallel, the three calendar items**: book the vendor call, book the counsel sitting, and send the PSP applications the day the capital decision lands.
3. **Rule `OI-01`** (`liability_snapshots`, surfaced with a recommendation and deliberately not decided by a session), then the rest of **P1** below. **[ADR-035](DECISIONS.md) is accepted and `0028` is written**; it needs the E2 read like every other money-path file, not a separate ruling. **S-B and S-D have landed**, so [P1 section 6](plans/P1-monorepo-scaffold.md) has **S-C** (CI-01, CI-02, CI-05 with VG-12) and **S-E** (TradingCalendar as data, money path, fresh session, plan mode) left, and they may run in parallel.

---

## What actually remains of P1 (2026-08-15)

**[DELIVERY_PLAN section 4](DELIVERY_PLAN.md) gives P1 three contents: the monorepo scaffold, the reconciled schema and migrations, TradingCalendar as data, and CI carrying the full [STRATEGY](testing/STRATEGY.md) gate inventory.** Its definition of done is **"every VG gate wired and failing correctly on a seeded violation, VG-12 not deferred"**. Measured against that, honestly:

| P1 item | State | What is actually left |
|---|---|---|
| **The reconciled schema and migrations** | **DONE**, pending the E2 read | <!--gen:migration_files-->28<!--/gen--> files, 96 tables, 326 indexes, 347 check constraints, 6 triggers, verified on a clean PostgreSQL 16 install. Nothing to build. **The founder's read is the remaining work and it is not engineering** |
| **CI-06, corpus integrity** | **DONE and exceeded** | Eleven checks, all passing clean and failing dirty. The row's own definition of done is met **for CI-06 only** |
| **CI-06h, migration install** | **RUNS IN ACTIONS, green** | Corrected 2026-08-15 (S-B). This row read "WIRED, never executed by GitHub. **It has not run in Actions once**" and that was already false when it was written: run `31860712550`, job `94953489824`, commit `3082b61e`, **2026-08-15T03:01:16Z, success**, applying all <!--gen:migration_files-->28<!--/gen--> migrations against PostgreSQL 16 on a runner. It has since run on every push to this branch, and now carries ADR-035's probe as well (run `31862563569`) |
| **The monorepo scaffold** | **DONE** (S-B, 2026-08-15) | Nine workspace-root files, three libraries, four deployables, two tooling packages, and a lockfile. `pnpm install --frozen-lockfile` from clean, `tsc --noEmit` across nine projects, four named Vitest projects each runnable alone. **Section 6's S-C, S-D and S-E are the remaining P1 sessions** |
| **TradingCalendar as data** | **SCHEMA ONLY** | `trading_calendar` exists in `0004` with its ruled semantics (half day counts as a full day, a halt advances counters but not win days). **There is not one row of data anywhere in the repository, and no seed mechanism**: `grep -c 'INSERT INTO' packages/db/migrations/*.sql` is zero across the set. The CME session calendar has to be sourced, encoded, and given a maintenance path |
| **CI-01, CI-02, CI-05** | **RUN IN ACTIONS, green** (S-C, 2026-08-15) | `.github/workflows/ci.yml`. Three jobs, none of them `needs:` another, each with its seeded-violation harness as its last step. **CI-02 is green about less than its row means**: the `PT-nn` and `Mxx-*-nn` suites do not exist and arrive with P2, so the stage runs the scaffold's placeholders plus the invariant and rule suites. It grows with no workflow change |
| **CI-03, golden files** | **DONE** (S-D, 2026-08-15) | [`packages/golden-loader`](../packages/golden-loader/README.md) over [`packages/rules-engine/fixtures`](../packages/rules-engine/fixtures/README.md), wired in [`.github/workflows/golden.yml`](../.github/workflows/golden.yml). Twelve loader rules, each watched failing on its own seeded violation. **Three fixtures, not the registry's full set**: `evaluate` is a stub, so an expected end state written today would be derived from nothing. The rest arrive with P2 |
| **CI-04, CI-07 to CI-09** | **NOT STARTED** | Integration, build checks, E2E and the nightly. The `integration` Vitest project exists and is deliberately not selected by CI-02 |
| **VG-1 to VG-12** | **THREE OF TWELVE WIRED** | **VG-1** (gitleaks, history and working tree), **VG-4** (`merit/no-raw-db-client`) and **VG-12** (`--frozen-lockfile`, `pnpm audit`, syft SBOM, grype), each watched failing on a seeded violation. **The other nine are not late, they are assigned to stages that do not exist**: VG-3 and VG-6 to CI-04, VG-5 to CI-06, VG-2, VG-10 and VG-11 to CI-07, VG-9 to CI-10. VG-7 and VG-8 are platform controls rather than jobs |

**The honest summary, as of S-D: four of the ten pipeline stages run in Actions, and three of the twelve VG gates are wired and have been watched failing.** Schema, corpus integrity, lint and types, unit and property, and security static are all real and verified on a runner. **What remains of P1 is TradingCalendar's data (S-E, money path)**, plus the stages P1's own scope never claimed. The gates still unwired are not late: each one is assigned to a stage that does not exist yet, and STRATEGY's table is where that assignment lives.

**One thing the reconciliation proved about P1's definition of done, and it is worth carrying into the scaffold session.** "Failing correctly on a seeded violation" is not one check, it is two: the gate must fail, and it must fail **on the seeded finding**. Two of the eleven corpus gates failed on a truncated tree copy and would have been scored as working. `falsify.mjs` is the shape that catches that, and the VG gates should arrive with the same harness rather than with a claim.

---

## The P1 scaffold plan is approved and OQ-P1-04 is ruled (2026-08-15)

**[P1-monorepo-scaffold](plans/P1-monorepo-scaffold.md) is `approved`.** Four questions, all ruled: the tooling packages need no ADR and `packages/config` is `packages/tooling`, no build orchestrator at P1, `.nvmrc` is the only Node version in the tree, and **OQ-P1-04**.

**OQ-P1-04 was a merge blocker sitting in front of the scaffold, and the ruling arrived larger than the question.** CI-06b demanded corpus frontmatter on every markdown file under `packages/`, so the first package README would have failed it while passing CI-06c ten lines away in the same runner. Option A was ruled, **with a structural amendment that is the transferable half: the fix is one predicate both gates call, not CI-06b's regex narrowed to match CI-06c's.** Two expressions of one concept that agree today is how the defect was born, and `packages/` holding exactly one markdown file is the only reason they ever agreed.

| | |
|---|---|
| **Folded** | `isCorpusDocument` in [`scripts/corpus/gates.mjs`](../scripts/corpus/gates.mjs), read by CI-06b and CI-06c both. The by-name allowlist carries its own expiry in a comment: **one entry is fine, three needs a rule instead of a list**, which is [ADR-034](DECISIONS.md)'s drift class applied to the fix for a drift |
| **C disqualified on evidence** | `docs/legal/README.md`, `docs/ops/runbooks/README.md` **and `research/calibration/README.md`**, all approved and indexed. **The ruling named two and the tree carries three** |
| **B rejected** | It makes a gate green by making its status field meaningless |
| **Asserted, not claimed** | [`falsify.mjs`](../scripts/corpus/falsify.mjs) gains a **SCOPE** phase and two cases: a file under `packages/` with no frontmatter must **not** fail CI-06b, and a file under `docs/` with no frontmatter **must**. Both directions, because a narrowing tested only from the quiet side is indistinguishable from a gate switched off |
| **Watched fail** | Against the pre-ruling regex, `CI-06b/out` reports `READ A FILE IT MUST NOT`. Against a predicate narrowed past `docs/`, `CI-06b/in` reports `DID NOT FAIL`. Neither case can only pass |

**The one coverage loss was recovered the same day, and the dilemma turned out to be false.** The first fold excluded `docs/INDEX.md` from the unified predicate, so **INDEX's own frontmatter was checked by nothing** and a hand-edit to `status: nearly` would have passed the whole runner. The recorded way out was a second expression inside CI-06b, which is the thing the amendment exists to prevent. **Neither was needed.** INDEX **is** a corpus document and belongs inside the predicate; CI-06c skips it because **a list cannot contain itself**, which is a property of that gate rather than of the document class, so the skip moved into CI-06c alone. `CI-06b/index` in [`falsify.mjs`](../scripts/corpus/falsify.mjs) proves it in both directions.

**Eleven gates pass and thirteen assertions hold** (eleven seeded violations, two scope cases).

## S-B landed: the monorepo scaffold (2026-08-15)

**[P1 section 3](plans/P1-monorepo-scaffold.md)'s list exists, all three riders are in `corpus.yml`, and section 4's seven definition-of-done lines were each run as a command.** `pnpm install --frozen-lockfile` from an empty tree, `tsc --noEmit` across nine projects, `vitest run` executing all four named projects, the dependency check watched failing on a seeded workspace dependency, no coverage threshold asserted rather than assumed, eleven gates green and `falsify.mjs` green.

**The three boundaries the plan says a cheap scaffold destroys silently are each mechanical now.**

| Boundary | Mechanism | Failure it makes impossible to reach quietly |
|---|---|---|
| **Engine purity** | `RI-01` reads the manifest, `merit/engine-purity` reads the source, and `types: []` with `lib: ["ES2023"]` removes every ambient global from the package | An I/O call inside the engine is a **compile error** before it is a lint finding, and a clock read is caught as the same defect class as an import. Three mechanisms because each misses what the others catch: the manifest cannot see an import that resolves through a hoisted layout, the lint cannot see nondeterminism that arrives as an argument, the compiler cannot see a declared-but-unused dependency |
| **`apps/admin` is a separate deployable** | `RI-04` | Four packages with four names and no app depending on another. One application with three route groups now fails CI-01 rather than passing review |
| **No coverage threshold** | `RI-02` | Five known spellings plus the config files that exist only to hold one. The needles are **assembled from fragments** so the checker and its test do not match themselves, which is the alternative to an exclusion in the least visible possible place |

**Two defects were found that the brief did not name, and one of them is a file on section 3's list.**

**`vitest.workspace.ts` is dead in Vitest 4 and fails silently.** Verified against `vitest@4.1.10` before the file was written: with that file present, `vitest run` still discovers `**/*.test.ts` through its default include and reports green, **while the four named projects do not exist**. Honouring section 3's filename literally would have produced exactly the CI-03-is-not-a-stage failure section 2.2 exists to prevent, arrived at by following the plan. The projects live in `vitest.config.ts`; `RI-03` asserts the four names are present **and** that no `vitest.workspace.*` returns.

**TypeScript is 6.0.3 rather than 7.0.2**, because `typescript-eslint@8.67.0` and its canary both declare `peerDependencies.typescript` as `>=4.8.4 <6.1.0`. TypeScript 7 has no supported lint toolchain, so CI-01's two halves cannot both run on it.

**Every dependency version is a `catalog:` reference resolved once in `pnpm-workspace.yaml`**, which is rider 3's argument applied past the Node version: a version written in nine manifests is a hand-maintained count and drifts the same way.

**Each of the five invariants was watched failing on a seeded violation, and the seeds found four real defects in the checks.** The workspace-globs parser could not see a `packages:` key on line 1; the coverage scan matched its own test file twice, once through a string literal and once through a **comment**; a `fast-check` date arbitrary generated the Invalid Date because `noInvalidDate` is not the default. **Three of the four were the check being right and the harness being wrong**, which is the shape the 109 phantom anchors had.

---

## S-A landed: migration numbers are allocated (2026-08-15)

**[ADR-036](DECISIONS.md). [DECISIONS](DECISIONS.md) now carries two allocation tables**, ADR numbers and migration numbers, and `CI-06h` asserts the second one by `CI-06f`'s rule: gapless over allocated plus reserved, and **a number on disk that no row claims fails.** `0001` to `0028` are allocated and merged; **nothing is reserved and `0029` is the next free number.**

**The registry that had no table was the one that could least afford a collision.** `CI-06h` derived the sequence from the tree, which is the check a branch can satisfy while colliding with its sibling: two branches both find `0028`, both write `0029`, both pass locally. [ADR-034](DECISIONS.md) resolved the ADR collision by renumbering the cheaper branch, and **that remedy does not exist for a migration**, which E2 makes sacred once merged.

**It extends `CI-06h` rather than arriving as a sibling gate, and that was decided on evidence.** A reserved number has no file on disk, so `CI-06h`'s existing gap check would fail on the exact hole a sibling gate would exist to permit. `CI-06h` had to become allocation-aware either way, and a sibling then holds a second expression of one concept **in the runner OQ-P1-04 was ruled about**. One parser reads both tables; it is stricter than the inline scan it replaced, which read three-digit numerals out of the section's prose.

**Two hand-maintained claims about this very sequence were found wrong while writing the ADR that exists to end that class.** The commissioning brief said `0028` was reserved and not yet written: it is written, merged in PR #9, and `origin/main` lists 28 migration files. The ADR table's own `035` row said `reserved, unmerged` four commits after the merge that falsified it. **Eleventh and twelfth.** The State column is prose no gate can parse from one ref, and both the table and [STRATEGY](testing/STRATEGY.md) now say so rather than letting the row look enforced.

**Eleven gates pass clean and fail dirty, and sixteen assertions hold** (eleven seeded violations, five scope cases). All four counterfactuals for the new half were watched: reservations ignored gives `READ A FILE IT MUST NOT`, the allocation check removed gives `DID NOT FAIL`, the hole loop disabled gives `FAILED OFF-TARGET` rather than a pass, and a renamed table heading gives `ERROR` rather than a green gate.

**The next session is S-B**, the scaffold itself, carrying all three riders in [plan section 5](plans/P1-monorepo-scaffold.md#5-the-three-riders).

---

## S-D landed: the golden fixture loader and CI-03 (2026-08-15)

**[`packages/golden-loader`](../packages/golden-loader/README.md) reads [`packages/rules-engine/fixtures`](../packages/rules-engine/fixtures/README.md) and folds each day stream through the engine's public entry point. [`.github/workflows/golden.yml`](../.github/workflows/golden.yml) is the CI-03 stage.** Twelve loader rules, each watched failing on its own seeded violation and each asserting the rule id that came back; the untouched fixture tree is asserted to load clean, because a rule that refuses everything passes every seeded case and gates nothing.

**The loader is a package rather than a file inside the engine, and the purity boundary is what decided it.** `packages/rules-engine` sets `types: []`, so `node:fs` does not exist there and a loader living inside could only read a directory by weakening the strongest of the three mechanisms guarding the engine. From outside, `@merit/rules-engine` resolves through an `exports` map publishing `.` and nothing else, so **the internals are not reachable at all**: [P1 section 2.2](plans/P1-monorepo-scaffold.md)'s obligation is discharged by the module resolver rather than by a reviewer.

**Three fixtures, not the registry's full set, and that is the scope rather than a shortfall.** `evaluate` is the scaffold's identity stub, so an expected end state written today would be derived from nothing, which is the failure TR-01 exists to prevent reached by being thorough. GS-008, GS-009 and GS-011 are the floor's three rules, every number traced to [M01 Appendix A.1](plans/M01-rules-engine.md) or to the registry row. **The rest arrive with P2.**

**TR-02 says the fixture fails before the function exists, so the stage asserts the failure instead of suffering it.** The polarity is read off the engine by a probe rather than written into a fixture: while the stub holds, a fixture that **matches** is the finding. There is no `pending: true` for a future session to reach for, and when M01 lands the same fixtures become live assertions with nothing edited.

| # | Finding | Needs |
|---|---|---|
| **1** | **[STRATEGY](testing/STRATEGY.md) said 255 golden scenarios in two places and the registry defines <!--gen:gs_count-->257<!--/gen-->**, derived as distinct identifiers, contiguous with no holes. 255 is the pre-consolidation count, from before the verification-UX pair was renumbered to GS-256 and GS-257 | **CLOSED.** Both are generated spans now. **Fourteenth and fifteenth hand-maintained counts found wrong**, and they survived inside [CI-06g](testing/STRATEGY.md)'s own stated gap: it compares the spans that exist and does not sweep for bare numerals |
| **2** | **[GOLDEN_SCENARIOS section 3](testing/GOLDEN_SCENARIOS.md)'s `CORE-50K` shorthand says ladder 8; [M01 Appendix A.1](plans/M01-rules-engine.md) says 5** per [ADR-024](DECISIONS.md), in the same sentence naming Appendix A "the only place these numbers are defined". Twelve of thirteen restated values agree | **OPEN, a founder ruling.** The plan fixture follows the named authority. **A count folds into a span; a plan parameter does not**, and no fixture reads the field yet |
| **3** | **Four fixture fields reach no engine input**: `account.phase`, `account.opened_on`, `days[].adjustment_cents`, `settlements`. And `traded_day` runs the other way, declared by the type and absent from the printed format | **NAMED, not dropped.** The loader refuses any field it can neither map nor list, `L-14` asserts the list is still in use, and the fixture supplies `traded_day` because a loader deriving it would have implemented R-08, a rule the fixtures exist to check. **M01 empties the list** |
| **4** | **Where the expectation lives is ambiguous in two approved documents**: both rule "YAML plus a JSON sibling" and section 2's example shows `expect:` inline | **RULED BY READING, reversible.** The sibling **is** the `expect` block serialized as JSON, which keeps both sentences true; `L-05` refuses a fixture carrying both. If the founder reads it the other way, `L-05` inverts |
| **5** | **`yaml` is not a dependency.** VG-12 makes a new package a human admission a session cannot grant itself, so the loader reads a strictly specified subset and throws on everything else | **OPEN, a founder call.** Swapping it in is a small diff **and must quote every date in every fixture in the same commit**: an unquoted `2026-11-03` is a string here and a `Date` under a real YAML library, which is a clock reading entering the one package whose contract is that it has none |

**One duplication is recorded rather than smoothed over.** `registryIds()` re-implements `gs_count`'s query from [`scripts/corpus/gates.mjs`](../scripts/corpus/gates.mjs), which is [OQ-P1-04](plans/P1-monorepo-scaffold.md)'s defect class in the runner that ruling was about. Unifying them needs the corpus runner to export a membership helper and S-D was scoped out of that directory. **The tiebreak is written down: if the two ever disagree, the loader is wrong.**

**CI-03 is its own workflow file rather than a job in `ci.yml`, which is S-C's to create and did not exist.** Folding it in later is a move of one job, not a rewrite. Left as a founder call, the same way the reconciliation ruling took `corpus.yml` unchanged.
