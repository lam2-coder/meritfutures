---
status: approved
depends_on: []
last_updated: 2026-08-16
---

# STATE

# **FROZEN** (2026-08-14)

**The planning corpus is complete, approved, and FROZEN. Application code may now begin.**

Every document is `approved` except [M02](plans/M02-rithmic-bridge.md), which holds at `review` by [ADR-005](decisions/ADR-005.md) pending the Rithmic vendor call, as ruled.

**Branch-per-module and pull-request discipline resume now**, per constitution C7 and the amended [ADR-D1](decisions/ADR-D1.md). The corpus-phase single-trunk rule has expired; it was a corpus-phase rule and code exists from here.

---

## What FREEZE means, operationally

| | |
|---|---|
| **The corpus is the specification** | A behavior not in the corpus is not in scope. A behavior in the corpus is a commitment |
| **Changing a frozen document requires an ADR** | Not a commit. The document is the record and the ADR is how it moves |
| **Plan parameters remain launch candidates** | Confirmed at this gate, re-confirmed at launch as config per the standing [parameter-status ruling](decisions/gates/parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14.md). They are rows in `plan_version_sizes`, never constants |
| **Structural rulings are fixed** | Caps exist, the ladder exists and is finite, EOD semantics are authoritative, zero denial, the permanent floor lock, the wallet-credit cadence anchor. Absent a new ADR, these do not move |

---

## The gate that closed

**<!--gen:adr_count-->45<!--/gen--> ADRs. <!--gen:ec_count-->141<!--/gen--> edge cases. <!--gen:gs_count-->257<!--/gen--> golden scenarios. Four waves.** These are generated spans under [CI-06g](testing/STRATEGY.md); this line read "25 ADRs" until it was folded, which is the drift [ADR-034](decisions/ADR-034.md) exists to end.

| Sign-off | Ruling |
|---|---|
| Wave 3 batch 2 (M09 to M20) | **APPROVED** |
| Wave 4 (testing, ops, design, legal) | **APPROVED** |
| Plan parameters | **CONFIRMED as launch candidates** |
| **Direct's ladder** | **4.** Direct skips the eval filter, so its funded population carries the unselected base rate and the heaviest per-account tail. The shortest ladder belongs on the least-filtered plan |
| **KYC trigger set** | **`{second_distinct_account_purchase, pre_funded}`, earliest fires.** Fleet coverage prevails; telemetry adjudicates post-beta |
| **M12 statistics, including S-16** | **APPROVED.** The first published number publishes whatever it says |
| **OQ-FREEZE-01** | Implementation **confirmed**, [ADR-025](decisions/ADR-025.md)'s literal wording **overruled**. The perk is `promotional_credit`, never withdrawable. **The invariant guard caught a founder-guide wording error**, which is the review system working as designed |
| **OQ-FREEZE-02** | [ADR-D1](decisions/ADR-D1.md) amended: harness-launched sessions run designated branches and **must end mergeable**, founder merges **same day**; local sessions commit direct to `main`. **PR #2 merged** |

---

## The calibration engine landed and the corpus is recalibrated

`research/calibration/mc_lifecycle.py` is committed and was **run**. Full record in [SIMULATION_HARNESS section 9](testing/SIMULATION_HARNESS.md).

**Exact figures at the corpus configuration** (`w=3`, funded `min_trading_days = 0` on all three, ladder 5 / 5 / 4):

| Plan | Eval pass | Funded to payout | Firm $ per funded (50K) | Payouts per payer | Contribution margin |
|---|---|---|---|---|---|
| Core EOD | 26.53% | 33.46% | **$690.44** | 1.54 | **+0.25%** |
| **Merit Rapid** | 16.55% | **48.11%** | **$904.07** | **2.13** | **16.9%** |
| Direct | 100% | 12.07% | **$207.33** | 1.30 | **39.2%** |

[ADR-018](decisions/ADR-018.md) carried $889, 48.1 percent, 2.09, and roughly 18 percent. **The funnel figure matched to two decimals; firm cost is 1.7 percent higher and margin 1.1 points lower. Immaterial, and mildly unfavorable.**

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

**Kept for the record because the brief was met.** Schema-delta reconciliation, money path, strict [ADR-003](decisions/ADR-003.md) regime, plan mode mandatory. The plan was reviewed and ruled on before a migration file was written; the two money-path findings that needed a ruling (C-01's ledger classes and C-02's payout enum) were ruled, and **C-01 was ruled, folded, committed, and then reversed** when the founder re-read the source. That reversal is [ADR-027](decisions/ADR-027.md) and it is the clearest evidence in the corpus that the plan-mode gate did the job it was there for.

**Definition of done, as briefed:** one migration set, every delta traced to the document that proposed it, every money-path column read line by line by the founder per constitution E2, and no delta silently dropped. **Three of the four are met. The E2 read is outstanding and is the only thing between this branch and a merge.**

---

## The schema-delta reconciliation has landed (2026-08-14, item 9)

**All <!--gen:manifest_changes-->105<!--/gen--> schema changes are folded. <!--gen:migration_files-->33<!--/gen--> migration files at [`packages/db/migrations`](../packages/db/migrations), verified to apply in order against PostgreSQL 16** (<!--gen:sql_tables-->102<!--/gen--> tables, <!--gen:sql_triggers-->9<!--/gen--> triggers; **index and check-constraint totals are emitted by the install job**, not stated here, because Postgres backs every primary key and unique constraint with an index and a grep of the DDL derives 219 where the database reports 326). **This line previously stated four hand-maintained figures and two of them were wrong when written**; DATA_MODEL carried different numbers for the same set. The exact class of drift [ADR-026](decisions/ADR-026.md) caught in the delta counts, recurring in the document that recorded the catch, which is why the derivable two are now spans and the underivable two are gone. Every delta traces to the document that proposed it in [`packages/db/DELTA_MANIFEST.md`](../packages/db/DELTA_MANIFEST.md), which is the file [ADR-026](decisions/ADR-026.md)'s completeness gate reads. **No delta was rejected.**

**Nothing merges without the founder's E2 line-by-line read.** <!--gen:e2_files-->23<!--/gen--> files carry an `E2 READ: MONEY PATH` header naming what in them needs it and why. **This line read "Sixteen" against seventeen files on disk**, which is the seventh hand-maintained count found wrong, so it is a [CI-06g](testing/STRATEGY.md) span now. The install check proves the set is installable and **proves nothing about whether a delta was folded correctly**, which is the whole reason E2 exists.

**Three things the fold produced that need a founder decision or a follow-on session:**

| # | Item | Why it matters |
|---|---|---|
| **A** | ~~A sixth unnumbered change.~~ **RULED AND CLOSED.** It is **`U-06`** and the total in scope is **94**. `0001`'s inline marker read `SD-M2-06`, the `reconciliations` delta, and is corrected to `-- U-06` in `0001` and added in `0007` | **The manifest gate exists so an uncounted change cannot hide, and it caught one on its first run.** That is the gate justifying itself, not a defect |
| **B** | **[ADR-030](decisions/ADR-030.md)'s stale list is wrong in two of four.** `win_days.required_count: 5` and `phase_eval.min_trading_days: 1` are Core EOD's **frozen** values per [M01 Appendix A.1](plans/M01-rules-engine.md). `w = 3` is Merit Rapid's | Following the list would have put **Merit Rapid's cadence on Core EOD's contract**. Recorded in the amended section 11, not applied |
| **C** | ~~**DATA_MODEL is only partly at post-migration truth.**~~ **CLOSED 2026-08-15.** §3 through §10 rewritten table by table against the `.sql`. **The scope was larger than this row described: the migrations create 96 tables and the document carried 46 sections, so 50 tables had no design record at all.** All 96 now do, the reconciliation runs both ways as [CI-06i](testing/STRATEGY.md), and the line-15 banner is gone | **It closed with two findings rather than none.** [ADR-035](decisions/ADR-035.md) is a proven defect in a merged money-path migration; `OI-01` (`liability_snapshots`' two shapes) is surfaced with a recommendation and still needs a ruling |

## Two rulings on the transparency surface (2026-08-14)

**Both land on `published_statistics`, both amend approved `SD-M12-02`, and both are folded into `0021` and `0027` rather than recorded.**

| ADR | Ruling | What it changes |
|---|---|---|
| **[ADR-031](decisions/ADR-031.md)** | **`value_numeric numeric` becomes `value bigint` with a mandatory `value_unit`** | Its no-floats exemption is retired. All seven ruled statistics are exactly representable as integers, and for ST-03 and ST-04 the column held **money on a public surface**. `value_unit` and `numerator_unit` share one `statistic_unit` type, because two vocabularies for one concept is how they drift |
| **[ADR-032](decisions/ADR-032.md)** | **`measure` joins the table and the window unique key, and STAT-C1 enforces the pair** | **Closes OI-02.** ST-04's median, and ST-05's and ST-06's p95, were unwritable. The column makes them writable; the deferred constraint trigger makes them **required**, converting "neither is published alone" from M12 prose into DDL. The rejected alternative, separate `stat_code`s per figure, is recorded: it needs no schema change and deletes the invariant by making it unstateable |

**The no-floats exemption list is now two columns and no money.** `correlation_groups.statistic` and `.threshold` stay exempt on the founder's ruling: a plain integer `rho` of `0.30` is `0`, and `rho = 0.30` is the reserve-critical figure.

**Every constraint carrying a ruling is now probed against the database**, one perturbation each, tabulated in [DELTA_MANIFEST section 10](../packages/db/DELTA_MANIFEST.md). **That testing found a defect a reading had passed**: a `CHECK` written `array_length(measures, 1) >= 1` admits the empty array, because `array_length` returns `NULL` there and **a `CHECK` evaluating to `NULL` passes**. It admitted the one value it existed to reject, and an empty declared set makes STAT-C1 vacuous. Now `cardinality()`.

## Blocked

Nothing.

**The ADR-031 collision is resolved.** Two open pull requests both claimed the number: PR #4 carried ADR-031 and ADR-032, PR #5 a different proposed ADR-031, and both branched from a `main` whose registry ended at 030. The founder assigned at merge, PR #5's became **ADR-033**, and **[ADR-034](decisions/ADR-034.md) ruled that a number is claimed in an allocation table before the ADR is written**. [CI-06f](testing/STRATEGY.md) now **fails the second pull request to claim a number** rather than failing the corpus after both have merged, which is what this incident asked for in its own words.

## The DATA_MODEL rewrite landed, and found a defect (2026-08-15, item C)

**All <!--gen:sql_tables-->102<!--/gen--> tables carry a `### <table>` design record with columns, types, constraints, indexes, retention and the reason each exists**, checked against the migration that creates it rather than against the plan that proposed it. Verified two ways: [CI-06i](testing/STRATEGY.md) reconciles the table sets in both directions from the tree, and a generated diff against a live PostgreSQL 16 catalogue found **zero undocumented columns and zero documented columns that do not exist**.

**[`scripts/corpus/gates.mjs`](../scripts/corpus/gates.mjs) exists and all eight gates pass.** CI-06a through CI-06g were specified and not running; they run now, with no dependencies. The first honest run found 27 broken anchors, all repaired, and one drifted count span, regenerated. **Each gate states what it does not cover** rather than implying full coverage.

**Two findings the rewrite would not reconcile quietly:**

| # | Finding | Needs |
|---|---|---|
| **[ADR-035](decisions/ADR-035.md)** | **`0027`'s published-plan-version immutability trigger reads `NEW.config`; the column is `rules`.** Proven by executing it, not by reading it. Every update to a published row raises, so the promise holds by accident and **the ruled `published -> retired` transition is refused too: no plan version can be retired.** A draft row updates normally, which is why the install check and every existing probe missed it | **ACCEPTED 2026-08-15.** Fixed by [`0028`](../packages/db/migrations/0028_supersede_plan_version_immutability.sql), a superseding migration; `0027` is not edited. Set goes 27 to 28. **Two amendments at acceptance are larger than the ADR as proposed** and are named in it |
| **`OI-01`** | **`liability_snapshots` exists in the folded shape only**, and the approved design's four reserve-coverage fields have no home. §8 now recommends a separate table rather than widening this one, with the reasoning, and does not decide it | **STILL OPEN, deliberately.** A founder ruling before [M06](plans/M06-admin-ops-console.md). The reconciliation session was instructed not to decide it and did not |

---

## The PR #7 / PR #8 reconciliation (2026-08-15)

**Two branches overlapped on 11 of 13 files and both independently wrote `scripts/corpus/gates.mjs`. They are now one branch and nothing was dropped.**

**The founder's ruling on the runner, and the criterion is the transferable part.** PR #8's `gates.mjs` is the base **because it had been falsified**: it produced 109 phantom broken anchors and 119 phantom refless edge cases, both were traced to bugs in the runner rather than to the corpus, both were fixed, and only then did it find 27 real broken anchors. PR #7's runner had not been watched fail correctly. **A gate nobody has watched fail is not a gate**, and that is now [`scripts/corpus/falsify.mjs`](../scripts/corpus/falsify.mjs) rather than a judgment about a transcript.

| From | What landed |
|---|---|
| **PR #8** | `gates.mjs` as the base. The DATA_MODEL post-migration rewrite, all 96 tables. `ADR-035`. `CI-06i` |
| **PR #7** | `.github/workflows/corpus.yml` **unchanged**, the only CI wiring either branch had. `probe_ledger_constraints.sql`. The STATE reconciliation and item **A**'s closure (`U-06`, total 94). `CI-06h`. **[ADR-026](decisions/ADR-026.md)'s manifest completeness gate, which PR #8 had no equivalent of.** `CI-06d` contiguity, `CI-06b` `depends_on` resolution, `CI-06a` duplicate-heading anchors, the `anchors` subcommand |
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

**The two decisions the brief required were taken, and the first turned on evidence rather than preference.** The registration lookup is **[ADR-023](decisions/ADR-023.md)'s existing vendor**, because ADR-023 already buys phone digital-footprint, VPN and datacenter detection; **only portability history is separable, so it becomes a disqualifying selection criterion** rather than an assumption, since amendment 3's recycling guard has no input without it. Carrier metadata joins **counsel packet item 3** as a new sub-item.

**The founder ruled the hard link at plan approval**, because (b)'s phrase "auto-enforced like KYC face-dedupe" sits between `INV-M19-04` (a hit changes no state) and [ADR-022](decisions/ADR-022.md) (hard links auto-enforce). One live verified phone per identity is a real unique index; a second identity verifying a live number **completes, binds the edge at the hard ceiling, and opens a severity-5 flag against both**.

| Finding | State |
|---|---|
| **`OI-06`. The 48 hour payout-destination cooling window has no storage.** There is no `payout_destinations` table in the merged 96; `destination_ref` is a column on `payout_transfers` and `wallet_withdrawals`, the destination **of a transfer**. **C-11, C-24, [SECURITY section 4](architecture/SECURITY.md) item 1, [M20](plans/M20-wallet.md) `WF-M20-02` and [M04](plans/M04-trader-portal.md)'s destination-cooling scenario all cite a control whose input does not exist** | **OPEN, a founder ruling.** Surfaced with a recommendation and deliberately not decided. Migration `0029` builds the phone hold on its own storage and does not touch it. **Found by trying to model the ruling's (c) on the control (c) says to copy** |
| **[SECURITY section 2.7](architecture/SECURITY.md) says "no SMS-based second factor anywhere in the stack" and the ruling adds SMS OTP** | **Resolved in the plan, folded by the ADR.** Section 2.7 sits under "The founder (the human asset)" and is rescoped to founder and admin credentials; admin keeps hardware-key SSO with no SMS path |
| **`contact_channels.kind check in ('email','push')`**, so `INV-M16-03`'s prior-contact countermeasure cannot notify a prior **number** | Folded by `0029`. The one contact kind the ruling makes an identity signal is the one kind the table cannot hold today |

**The plan pre-claimed ten delta identifiers, an edge case and a golden scenario, and [ADR-026](decisions/ADR-026.md)'s gate refused all twelve.** The gate was right: **only ADR and migration numbers have an allocation table**, and a delta identifier is claimed by its `DELTA_MANIFEST` row existing. **That is [ADR-034](decisions/ADR-034.md)'s drift class reproduced inside the plan for folding it**, and it was caught by a robot in under a minute rather than at merge, which is the argument for the gates in one line.

### FOLD-01 session 3: `0029` is written (2026-08-16)

**[`0029_phone_identity_and_auth.sql`](../packages/db/migrations/0029_phone_identity_and_auth.sql) exists, and it is the fold's money path.** [ADR-039](decisions/ADR-039.md)'s nine changes: three new tables ([`identity_phones`](architecture/data-model/identity_phones.md), [`phone_change_requests`](architecture/data-model/phone_change_requests.md), [`otp_send_budget`](architecture/data-model/otp_send_budget.md)) and amended columns on six existing ones. **The delta numbers were allocated in this session and not in the plan**, which is what the plan's section 4 requires: `SD-M19-05/06/07`, `SD-M16-04/05/06/07`, `SD-M4-04`, `U-07`. **It supersedes and never edits**: `0002`, `0003` and `0019` are untouched on disk.

**The set applies and the constraints were executed, not read.** <!--gen:migration_files-->33<!--/gen--> files forward-only from empty against PostgreSQL 16, re-apply rejected, <!--gen:sql_tables-->102<!--/gen--> tables / 340 indexes / 381 checks / <!--gen:sql_triggers-->9<!--/gen--> triggers, and **48 assertions against the installed schema leading with the success case**, tabulated in [DELTA_MANIFEST section 14](../packages/db/DELTA_MANIFEST.md). `0029` installs no trigger and no function, so [CI-06j](testing/STRATEGY.md) has nothing new to resolve and the trigger count does not move.

| The three things the E2 read is for | |
|---|---|
| **The unique index on `identity_phones.phone_hash` is deliberately absent** | ADR-039 splits (b)'s hard link. Identity to phone is a constraint; phone to identity **completes and flags**. Making `phone_hash` unique refuses the innocent owner of a recycled number before the portability check can rescue them. **A probe asserts the second verification is PERMITTED**, so the ruling fails loudly if someone completes the pair |
| **`otp_send_budget` has no stopping state** | `armed`, `degraded`, `manually_overridden`. `plan_breaker_state`, whose pattern it copies, has `paused`; this does not, on the founder's ruling. **A breaker that stops registration is a denial of service on customer acquisition**, tripped at the price of the traffic that trips it |
| **`sessions.elevated_by_factor`'s check list is C-27** | `passkey` or `dual_channel` and nothing else, so an SMS-established session cannot elevate: the database has no value for what such a handler would write. **Never SMS alone is a vocabulary, not a handler** |

**Two open items are added and one is finally rowed.** `OI-06` (the payout-destination cooling window's missing storage) is now a numbered manifest row rather than only a finding in this section. **`OI-07`: `0029` has no committed probe.** The 48 assertions ran ad hoc and are not in [`corpus.yml`](../.github/workflows/corpus.yml), because the session's stop condition was the migration, its records and its manifest rows; that is the exact object the manifest's section 13 names, and it is one commit. **`OI-08`: the NO-FLOATS `DO` block is positional.** It lives in `0027`, so `0028` and `0029` are outside it and a future migration adding a `numeric` money column would sail past the guard the corpus believes protects it. Checked by hand for `0029`; the fix belongs in the install job.

**Both closed on 2026-08-16**, in [DELTA_MANIFEST section 15](../packages/db/DELTA_MANIFEST.md). `OI-08` had grown from two migrations to five by the time it was fixed, which is the property worth carrying forward: **a positional assertion does not fail when it goes blind, it keeps passing against less.** And closing `OI-07` surfaced the same defect one file over: [`probe_payout_hold.sql`](../scripts/db/probe_payout_hold.sql) was wired into the workflow and **never pinned by CI-06h**, so it had been one delete from being `OI-07` again since the day it landed. All four probes plus the NO-FLOATS assertion are pinned now. **The file existing was never the fix; the file being unable to stop running is.**

**And the tally of hand-maintained counts turned out to be double-booked.** Two findings claim "eighth" and two claim "ninth". No ordinal is claimed for this session's (the plan's five-existing-tables against six), and the reason is recorded in the manifest: **a running total with no allocation table is [ADR-034](decisions/ADR-034.md)'s race one registry over.** Four further stale figures from `0028` landing were converted to spans rather than tallied.

### FOLD-01 session 4: the invariants and the adversarial scenarios (2026-08-16)

**[SECURITY](architecture/SECURITY.md), [M19](plans/M19-kyc-identity.md), [M07](plans/M07-risk-abuse.md) and [M16](plans/M16-notification-center.md) are folded.** Non-money, no migration, no registry entry, no manifest row. C-01 widened to three factors with the stuffing-immunity claim preserved verbatim; **C-27** the authority boundary and **C-28** the pre-identity breaker; §2.7 rescoped to founder and admin credentials with its prior wording quoted; a new §4.8. `INV-M19-13` and `INV-M19-14`, `AS-M19-09`, `DEP-M19-09`. A **third resolution tier** in M07 with `D-18` and the fleet signature. `NC-M16-05`, `INV-M16-12`, `AS-M16-07`, and **`INV-M16-11` recorded as CONFIRMED rather than amended, in those words**.

**The brief named an `SD-M7-nn` that does not exist, and the finding is that it should not.** FOLD-01 section 6.1 promised M07 a delta wiring portability history to the recycling decision. **Section 4 of the same plan enumerates nine changes and none is M7's, and `0029` contains none.** Every input and output already exists: five columns and two indexes from `SD-M19-05`, `identity_restriction_episodes.opened_at` from `0031`, and the suppression pair from **`SD-M7-04`**, in `0002` since the reconciliation. `identity_links.link_kind` carries no CHECK, so a phone edge kind is a vocabulary value. Writing the identifier would have failed `ADR-026`'s gate on the spot, and a `deferred` row for a change with nothing in it is a delta a later session opens and discovers is empty. **Recorded in M07 section 3.5.** The founder may overrule; it would need a migration to be about.

**Two open questions leave this session and neither blocks session 5.** **`OQ-M7-05`:** "hard link" means *auto-enforce* in section 7.9 and [ADR-029](decisions/ADR-029.md) and *flag-and-no-state-change* in section 3.1 and `INV-M19-04`. **ADR-039 settled it for the phone and only for the phone**, and this session refused to extend one ruling's reach by inheritance. And **session 6 owes two citations**: `CI-06d` fails on any unresolvable `GS` or `EC` identifier, so `AS-M19-09` and `AS-M16-07` name session 6 in prose rather than claiming numbers, and session 6 must go back and wire them.

### FOLD-01 session 5: the portal, the vendors and the legal surface (2026-08-16)

**[M04](plans/M04-trader-portal.md), [M03](plans/M03-billing-checkout.md), [M10](plans/M10-integrations.md), [PRIVACY_POLICY](legal/PRIVACY_POLICY.md) and [COUNSEL_PACKET](legal/COUNSEL_PACKET.md) are folded.** Non-money, no migration, no registry entry, no manifest row. `SD-M4-04` recorded against `0029`; `INV-M4-14` and `INV-M4-15` and a new section 3.7, **the authority boundary shown rather than hit**; `AS-M4-05` gains the SIM-swap shape; `FM-M4-10`; `IN-M10-06` the SMS sender and `INV-M10-12`; M03 §7.9.1 the registration lookup and §7.9.2 the Cost Stack lines; counsel item **3d** and the privacy policy's telephony row **citing** it.

**Two findings leave this session and one of them is a proven gap in a shipped control.**

**`OQ-M10-06`: nothing in the schema holds an address the dispatcher can send to.** There is **no plaintext telephone number in any of the twenty-nine migrations**, `users.email` is overwritten on change, and `contact_channels.value_hash` is one-way. Both `0019` and the `contact_channels` design record say the value is hashed because **"the sending path holds the address"**; the sending path is [M10](plans/M10-integrations.md), it holds nothing, and it may not delegate to a vendor under `AS-M10-06` part 3. So `INV-M16-03`'s prior-contact notification, [SECURITY §4.8](architecture/SECURITY.md) leg 2 and every Merit-initiated security SMS have no destination. **`phone_change_requests_applied_is_complete` can only assert that `prior_notified_at` exists**, so a handler with no address will fill it and the control reads as enforced in every document and every row-level test while never sending. This is `OI-06`'s shape and it is recorded, not fixed. **No `OI-nn` claimed**: that series already carries two rows numbered `OI-06`.

**`OQ-M10-05`: C-28's degradation ruling is about the cost breaker and says nothing about a vendor outage.** `IN-M10-06` is the first bought vendor on the critical path of anything, by design and on day one, because phone verification is mandatory at registration. The shape is identical and the mechanism is already built, but degrading on a vendor outage means anyone who can take an SMS provider offline can turn off Merit's phone verification, which is a different bargain and the founder's to make.

**One identifier was allocated and it is reversible.** `SC-M4-11`, the security and sessions screen, for a surface `AS-M4-05` counter 2 and `GS-104` already committed to and that had no row in section 3.1. Unlike `SD-nn` it has no allocation table and no gate, and nothing outside M04 section 3.7 cites it.

**Next is FOLD-01 session 6**, the registries and the gates: `EDGE_CASES`, `GOLDEN_SCENARIOS`, `STRATEGY`, `CI-06k`, `API_CONTRACT`, `EVENTS`, `STATE_MACHINES`, `INDEX`. **It carries a growing debt of citations no session may claim before it**: session 4 owes `AS-M19-09` and `AS-M16-07` their scenario references, and session 5 owes three more, named in words in [M04 §8.2](plans/M04-trader-portal.md). It also owes the endpoints M04 consumes and has never had, including the session-list endpoint owed since `AS-M4-05` was approved.

---

## FOLD-02 is planned and approved, and it collapses one of the two new states into a state that already exists (2026-08-15)

**[FOLD-02](plans/FOLD-02-enforcement-window-and-suspension.md) is `approved`.** The payout enforcement window (a pre-approval `held_pending_review` with a hard 48 hour auto-release) and identity-level suspension, planned across roughly twenty-six files and eight sessions. **Plan only; nothing was folded**, which was the brief's stop condition. **ADR-040, ADR-041, `0030` and `0031` are claimed, and `0029` plus ADR-039 are reserved for FOLD-01 in the same rows**, because gaplessness is asserted over allocated plus reserved and FOLD-01 had claimed neither yet.

**The founder's amendment 4 asked whether the new payout state is the bounded freeze under a second name. It is not, and the discriminator is whether the ledger has moved.** A held request has posted nothing: no LT-01, no wallet credit, nothing owed, so release means *approve and pay* and enforcement reverses nothing. A frozen request has posted LT-01 and the money is already the trader's. Two consequences are ruled rather than inherited: a held request **stores its full evaluated decision** so release re-evaluates nothing and every existing `NOT NULL` on `payout_requests` survives untouched, and **a hold that reaches expiry pays even if the account breached during it**, because the alternative is that Merit's own hold cost the trader money.

**The same question applied to Ruling B and the answer went the other way, which is the plan's one departure from the brief's literal wording.** `identity_status` already carries a reversible `restricted` value, wired through the enum, the machine, the events, [M20](plans/M20-wallet.md)'s spend and withdrawal gates and the trader's own `GET /me`. **`suspended` is `restricted` under a second name**, and what is missing is not the state but its binding surface, so the plan enumerates and asserts the surface instead of adding a second value.

| Finding | State |
|---|---|
| **An ADR-number collision with an open sibling pull request, which no gate could see.** The plan first claimed 038 and 039; **PR #15 had already reserved 037 and 038** in its own copy of the table. This branch is one commit ahead of a `main` ending at 036, and **eleven of eleven gates passed against that table** | **Resolved here rather than at merge**, on [ADR-034](decisions/ADR-034.md)'s tiebreak. **This is `CI-06f`'s and `CI-06h`'s declared coverage gap met in the wild within two days of being declared**, and the cross-ref job that would close it is still not written. Every remote branch was checked; only the ADR half moved |
| **The zero-denial sentence is not in [CLAUDE.md](../CLAUDE.md).** The words "no `denied` status and no review state" are [GUIDE_BRIEFING](GUIDE_BRIEFING.md)'s, and the constraint is restated in **ten** places, **two of them inside merged migrations that can never be edited** | **Folded by the ADR.** `0010`'s `COMMENT ON TABLE` is replaceable metadata and `0031` re-states it; the two `--` comments stand, and the ADR says so rather than implying the sweep was complete |
| **The external leg's halt exists as columns with no state to sit in.** `wallet_withdrawals` carries the three freeze columns and its expiry index, and `wallet_withdrawal_status` has no frozen value, so a halted withdrawal still reads as open and nothing refuses settlement | **Folded by `0031`**, as enforcement rather than a state. The halt is orthogonal to the rail state, and collapsing it into that column is SD-M5-06's named mistake |
| **`restricted` blocks the wallet and nothing else Ruling B names.** `G-ELIGIBLE` names `payouts_frozen` and not `identities.status`; checkout has no restriction check; nothing revokes platform trading | **Folded.** The surface is enumerated once, in one table, and asserted |
| **`ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it**, and every index predicate in the change is such a use | **Two migrations, `0030` and `0031`.** Proven by executing the counterfactual (the combined file must fail), not by citing the manual |

**The auto-release is now the load-bearing control, so it is structural in three places and unsuppressible in one.** It joins the existing hourly freeze-expiry sweep and its S1 dead-man switch, its alarm fires on the query rather than on the job, and a hold or freeze past expiry becomes the **fourth unsuppressible alarm**, amending [M06](plans/M06-admin-ops-console.md) OQ-M6-01. A new gate, `CI-06l`, asserts from the tree that every expiry column names a release job.

**The Rithmic revocation leg is marked PROVISIONAL, and the honest form is an asymmetry: suspension is always available and restoration is contingent on `V-M2-15`.** With neither an acknowledgement artifact nor a readable risk setting, a restored account cannot be confirmed, and INV-M2-13 means an unconfirmed account does not trade.

### FOLD-02 session 3: the DDL lands (2026-08-16)

**`0030` and `0031` are written, applied and probed, and they are the fold's whole database surface.** `0030` widens `payout_status` with `held_pending_review` in one statement and **no transaction block**; `0031` carries the five hold columns and their completeness `CHECK`, **both** `SD-09` predicates re-created with the new value inside them, the hold-expiry index, the external leg's settlement guard and its re-created open index, `identity_restriction_episodes`, and the replacement `COMMENT ON TABLE payout_requests`. **All 30 files apply forward-only from empty against PostgreSQL 16: 97 tables, 331 indexes, 351 check constraints, 6 triggers.** [`probe_payout_hold.sql`](../scripts/db/probe_payout_hold.sql) is **11 / 11**, and it leads with **six** success cases before any rejection, on section 13's lesson that a guard rejecting everything passes every rejection test written against it.

**The two-file split was proven by watching the combined form break, which is what the plan asked for.** A combined file was written and applied: `ERROR: unsafe use of new value "held_pending_review" of enum type payout_status`, exit 3; the split form then applied cleanly to the same database. **The first run of that counterfactual reported the wrong verdict**, because `if psql ... | tee` tests `tee`'s exit status and never `psql`'s. The migration was correct throughout and only the instrument was broken, which is the assertion-that-cannot-fail class in a new costume.

**Nothing else in FOLD-02 is folded.** The engine gates, the sweep, the API contract, `STATE_MACHINES` and the four remaining `transferring` sites named in [ADR-040](decisions/ADR-040.md) are session 4 onward. **`0029` and `0032` were not touched**: they are FOLD-01's and S-E's.


**[STATE_MACHINES](architecture/STATE_MACHINES.md), [M05](plans/M05-payout-system.md), [M20](plans/M20-wallet.md), [M07](plans/M07-risk-abuse.md) and [SECURITY](architecture/SECURITY.md) section 4 are folded.** The payout machine gains `held_pending_review` and its three guards; `G-ELIGIBLE` gains the identity status it never named; M05 gains INV-M5-17 to INV-M5-20, M20 gains INV-M20-12 to INV-M20-14, M07 tabulates the four enforcement outcomes, and SECURITY section 4 gains five items whose load-bearing sentence is that **the expiry is the security control rather than the flag**.

**Three defects found by folding rather than by a gate, all in the sweep [ADR-028](decisions/ADR-028.md) believed it had finished.**

| Finding | State |
|---|---|
| **`G-NO-IN-FLIGHT` and `G-FREEZE-DURING-FLIGHT` still read `transferring`.** The section 2 drawing had been corrected; **the guards behind it had not**, which is the more dangerous half because the guard is what the engine reads | **CLOSED.** Both rewritten, and `G-NO-IN-FLIGHT` now matches `payout_requests_no_in_flight_uq`'s predicate word for word |
| **Section 2 pointed at "section 3" for `wallet_withdrawals`, and section 3 was `payout_transfers`.** `wallet_withdrawals` had **no drawing anywhere in the authoritative document**, which is how `0011`'s representable-but-unenforced halt survived a founder-grade review | **CLOSED.** Section 3 is two sub-machines and 3.2 is written |
| **M05 said `status: settled_to_wallet` in two places, a value ADR-028 explicitly REJECTED** and `0001`'s comment block records rejecting. ADR-028 names M05 as one of two files it corrected | **CLOSED.** The fifth site of that sweep, and **not on ADR-040's list of four remaining sites either** |

**`G-ENFORCEMENT-RESTRICT` and `G-RESTRICTION-LIFTED` were named by section 9 and defined nowhere**, in a document whose own opening sentence says guards are defined once in section 10 so the same condition is never written twice. Both are defined now.

**Two things this session deliberately did not do, and both are session 7's.** **`CI-06l` is not written**: four documents now assert that every expiry has a sweep and **nothing checks it from the tree**, so the auto-release is load-bearing by assertion until that gate lands. **No `EC-nnn` or `GS-nnn` was claimed**; the five cross-machine rows added to STATE_MACHINES section 11 are those scenarios' content, filed where a reader of the machine will find it.

**A registry with no allocation table has started to race.** Four session-log entries are numbered 31 and two are numbered 32, written by parallel sessions each taking the next number it could see. `CI-06n` cannot see it because every one of those rows resolves. This is [ADR-034](decisions/ADR-034.md)'s failure one registry over, and it is recorded rather than fixed here because renumbering merged entries is not this session's call.

~~**Four open questions for the founder**~~ **ALL FOUR RULED 2026-08-15**, recorded in [ADR-040](decisions/ADR-040.md) and [ADR-041](decisions/ADR-041.md). **OQ-F2-01: `restricted`**, no new enum value. **OQ-F2-02: OQ-M5-02 closes at 48 hours**, matching the hold, because the investigate-time justification is identical in both cases and the post-credit case holds money Merit has already recognised as owed. **OQ-F2-03: M15 partial, +3 to 5 days, P8**, on `INV-M15-06`. **OQ-F2-04: accepted, the list moves from three to four.**

### FOLD-02 session 4: the machines and the invariants (2026-08-16)

**The DDL now has documents that agree with it.** [STATE_MACHINES](architecture/STATE_MACHINES.md), [M05](plans/M05-payout-system.md), [M20](plans/M20-wallet.md), [M07](plans/M07-risk-abuse.md) and [SECURITY](architecture/SECURITY.md) section 4 carry `held_pending_review` and the identity restriction. The payout machine gains three edges and three guards, `G-ELIGIBLE` gains `identities.status`, and the two `transferring` sites ADR-040 named inside section 10 are swept.

**Three invariants and one failure mode, and the failure mode is the one the fold created.** `INV-M5-17` (no hold or freeze outlives its expiry), `INV-M5-18` (a held request has posted nothing, which is the discriminator against `frozen`), `INV-M5-19` (a withdrawal carrying a live freeze cannot settle), and **`FM-M5-13`: the hourly release sweep stalls.** That last one is genuinely new exposure rather than a restatement: a constraint cannot stall and a job can, which is why the assertion runs on **the query** and why both alarms are unsuppressible.

**Two documents said a control was in force and no mechanism was.** `G-ELIGIBLE` named `payouts_frozen` and never `identities.status`, so the one state that halts a human across every account they hold did not reach the payout gate. `INV-M20-06` named `payouts_frozen` alone while [M20](plans/M20-wallet.md) AS-M20-02's counter-argument cited the restriction as already blocking wallet spend. **A control that exists in the paragraph explaining why the attack fails, and nowhere that binds, is the attack succeeding on schedule.**

**Three findings the fold did not go looking for**, all in STATE_MACHINES and all recorded rather than swept past:

| Finding | Disposition |
|---|---|
| **Section 3 draws `payout_transfers`, not `wallet_withdrawals`**, and the ADR-040 correction sent readers there for the external leg's states. `wallet_withdrawal_status` carries **seven** values and has **no drawing anywhere** | Corrected in place. **The missing machine is recorded, not drawn**: a seven-state machine is a fold of its own |
| The same correction named **`G-SETTLEMENT-CONFIRMED` and `G-TRANSFER-EXHAUSTED`**, which section 10 has never defined. The guards that exist are `G-WEBHOOK-SETTLED` and `G-RETRY-BUDGET-EXHAUSTED` | Corrected |
| **`G-ENFORCEMENT-CLOSE` is named by the identity machine and defined nowhere**, and the corpus does not agree on what it closes: ADR-041 says closure for cause is "terminal and **per account**", while the drawing routes an **identity** to `closed` | **Not defined here.** Writing one would be one ruling's words used as evidence about another act, which is the defect `OQ-M7-05` exists to refuse. It needs an ADR |

**One thing was carried into this session as outstanding and was already done.** Section 2's payout machine no longer routed `frozen --> transferring`: session 29 corrected it in the ADR-040 commit. What remained, and what this session swept, were the two guards in section 10.

**Three events are named in STATE_MACHINES and are not in [EVENTS](architecture/EVENTS.md) yet.** `payout.held`, `payout.hold_released` and `payout.hold_enforced` are introduced in [M05](plans/M05-payout-system.md) section 5, which is the route `payout.freeze_expiring` took, and EVENTS is session 6. **The forward reference is stated in both documents rather than left to be discovered**, because STATE_MACHINES' own header says events are named *from* EVENTS, and its universal rule 1 admits no transition without one: three silent edges would have been worse.

**`OQ-M5-02` is closed in its own document and `OQ-M5-07` is opened**, asking what `payout.freeze_expiring`'s lead becomes now that the window is 48 wall-clock hours. The old lead was two business days, which inside a 48 hour window fires at or before the hold opens, so the warning and the thing it warns about arrive together. **Proposed 12 hours, and the value is set where the event is written**, which is session 6.

**Nothing in M04, M03, M10 or the legal documents was touched**, and no golden scenario number was claimed: `GS-nnn` continues from a generated span and is session 7's.

### FOLD-02 session 8: the schedule moves, and it moves by days (2026-08-16)

**[DELIVERY_PLAN](DELIVERY_PLAN.md) and [M15](plans/M15-discord-integration.md) carry [ADR-041](decisions/ADR-041.md)'s scope ruling. Non-money, and it is the fold's last session by the plan's own list.** The headline is restated as **18 weeks plus 3 to 5 days**, in the headline sentence, in section 1's decision table as a sixth row, in section 4's P8 and P9 cells, and in section 5. **`OQ-M15-01` closes** on the ADR that closed `OQ-F2-03`.

**The delta is stated rather than absorbed, and the reason is the size of it.** A 3 day addition is exactly the size a plan rounds away, and a plan that rounds away every 3 day addition cannot notice the fourth one. Section 1's table records durations so they can be traded, per [ADR-020](decisions/ADR-020.md)'s own reason for saying "+2 to 4 weeks" instead of "some extra work"; the rule either applies at 3 days or it is not a rule.

**Three findings, and the second is the one a build session would otherwise hit at P8.**

| # | Finding | Disposition |
|---|---|---|
| **1** | **The M15 row is the one row in the triage table the three tests did not decide.** They placed it at LATER and it moved on `INV-M15-06`, which is an invariant in a **different** module | Kept in the table with the reasoning visible rather than quietly rewritten. **A triage test set that cannot see a cross-module invariant has a blind spot**, and this is its first instance rather than an exception |
| **2** | **`INV-M15-06` is the ruling's ground and role sync is the thing it constrains, so at launch it constrains nothing.** With no role sync there is no role to vanish at the moment of an enforcement, and nothing in P8 enforces the invariant because nothing in P8 can violate it | **Written into M15 section 1.1a rather than smoothed over.** What the ruling buys is the **ordering**: role sync arrives into a corpus where restriction already exists. The launch-day protection against `AS-M15-05` is role sync's absence, and a reader who assumes the pulled-forward scope carries the invariant will build the wrong thing |
| **3** | **The partial scope is not half the risk. It puts the room in launch scope.** A server with an announcement bot and a link flow is a public venue Merit hosts from P8, so **`AS-M15-04` (the recruitment venue) and `AS-M15-06` (support in public) are live from the day it opens** and neither depends on role sync | The scenarios that wait with role sync are `AS-M15-01` and `AS-M15-05`. Section 8.2 maps each golden scenario to the half it belongs to, and DELIVERY_PLAN section 5 states that the channel policy and moderation posture are not deferred with the roles |

**Four of M15's six dependencies now bind at P8** because they attach to the link, the bot credential or the announcement path. **`DEP-M15-05` is the one to watch**: [M12](plans/M12-transparency-platform.md) is launch scope while its numbers are not, and a template that would render a statistic the platform is declining to publish is the second publisher `INV-M15-05` forbids, arriving through a gap in the calendar rather than through a gap in the design.

**One hand-maintained number was replaced by its rule rather than updated.** Section 6's tier-2 risk row read "2 to 4 weeks of a 18 week plan"; the denominator is now stated as a proportion of the whole plan. **A total that moves by 3 days makes every hand-copied instance of it wrong and no gate can see a stale number inside a sentence**, which is [ADR-034](decisions/ADR-034.md)'s class in prose. Section 5's heading moved off the figure for the same reason.

**No module plan except M15 was touched**, which was the session fence. `M01`'s missing slot, `CI-06l` and the `GS-nnn` claims are still owed by the sessions that own them.

---

## S-E is planned, and the audit it was asked for came back clean while naming what will break it (2026-08-15)

**[P1-SE-trading-calendar](plans/P1-SE-trading-calendar.md) is `approved`.** P1's last engineering item, money path, written in plan mode as [P1 section 6](plans/P1-monorepo-scaffold.md) requires. **Plan only; nothing was folded and no number was claimed**, which was the brief's stop condition. Five sessions, four of them money path. It allocates **ADR-042**, **`0032`** and **`CI-06m`**.

**The source is the exchange's own publication, verified in three layers rather than trusted**: structural checks offline, **DST verified against IANA through the tzdata Node already ships** (the file states both the CT wall time and the UTC instant and the loader verifies rather than computes), and `AS-M2-06`'s existing divergence alarm on `fills.trading_day_vendor`, **which is the only mechanism in the system that can falsify a calendar row from outside the calendar**. The fixture calendar becomes **derived** and `CI-06m` asserts the derivation reproduces, which is what [`cme-2026.json`](../packages/rules-engine/fixtures/calendars/cme-2026.json)'s own note already committed to.

**Correction after trading has occurred is partitioned, and the partition is asserted rather than judged.** E2 makes a *migration* sacred and does not reach a data row, but the reason E2 exists reaches it exactly. No dependent row is an ordinary data change; a dependent row is an **incident** that replays and, per B4 #5, **never claws back**.

| Finding | State |
|---|---|
| **`is_holiday` is unwritable as designed.** `session_open_at` and `session_close_at` are `NOT NULL` under `CHECK (close > open)`, so a holiday row must carry a **fabricated** session interval while the CHECK immediately beside it says "a holiday has no session to contain fills in" | **RULED 2026-08-15, F-1 accepted** ([ADR-042](decisions/ADR-042.md)). Supersede `0004`, columns nullable under `CHECK (is_holiday = (session_open_at IS NULL))` with the ordering check made NULL-safe. A holiday becomes a positive fact rather than an absence |
| **Coverage has no storage, so an exhausted calendar is indistinguishable from an unbroken holiday.** No row means not a trading day, so every counter quietly stops advancing, nothing breaches, nothing becomes eligible and **nothing raises** | **RULED 2026-08-15, F-4 accepted** ([ADR-042](decisions/ADR-042.md)). A `trading_calendar_loads` fact, and the batch **fails closed** on a day outside coverage. Coverage is the current year plus two, with the horizon alarm at six months |
| **A corrected row leaves no prior image**, so `INV-04`'s replay cannot distinguish a calendar correction from an engine regression and the nightly self-audit would page with no way to tell | **RULED 2026-08-15, F-2 accepted** ([ADR-042](decisions/ADR-042.md)). An append-only revisions table. Git records what the **file** said and cannot prove what the **database** held when the mark was computed |
| **One `session_close_at` cannot serve six symbols.** `contract_specs` lists ES, MES, NQ, MNQ, CL and GC across CME, NYMEX and COMEX, whose early closes differ by product group, and the calendar has no symbol dimension | **RULED 2026-08-15, F-3 accepted** ([ADR-042](decisions/ADR-042.md)). The **latest** close across the listed groups, per-group times in `notes`, because R-01 is containment and the latest close is the one that cannot orphan a fill. The symbol dimension is rejected: it changes R-01's contract |
| **FOLD-02 section 2 says its allocation rows "are written in the same commit as this fold's" and they are not in [DECISIONS](decisions/README.md).** On the branch carrying **both** fold plans, the migration table still reads "Nothing is reserved today and `0029` is the next free number" and the ADR table still ends at 036 | **CLOSED 2026-08-15.** All eight rows written: ADR-039 to ADR-042 and `0029` to `0032`. **The "nothing is reserved" sentence is deleted rather than corrected**, on [ADR-034](decisions/ADR-034.md)'s own remedy, because it was the only thing in the repository asserting it |

**The wall-clock audit the plan was commissioned to run came back clean, and it is a measurement rather than a reassurance.** Across the <!--gen:migration_files-->33<!--/gen--> files in `packages/db/migrations`: **zero `::date`, zero `CAST(`, zero `interval` arithmetic, no `date` column with any default, and every `now()` a `DEFAULT now()` on a `timestamptz`.** **No existing trading-day counter is computed against a wall clock.**

**Two words in that sentence were corrected on 2026-08-16 and the correction is the useful part.** It read "across all 28 **merged** migrations" beside a span that counts the **directory**, so `0032` made the span say 29 while the word said merged and `0032` is not; the number and the adjective are answers to different questions and only one of them is derived. And it read "zero `interval` **in any case**", which a case-insensitive grep now falsifies: `0032` uses the English word *interval* five times in its comments, describing the fabricated session interval F-1 exists to abolish. **Zero `interval` arithmetic is the property; zero occurrences of the letters is not**, and a shape check written against the letters would fire on a comment and miss `date + interval '5 days'` written as `date + '5 days'::interval`. ADR-042's SQL shape check is a **parse** of the construct, not a grep of the word.

**The risk runs the other way, and that is why this plan was written before the folds rather than after.** `0029` to `0031` introduce the first `interval '48 hours'` arithmetic and the first `now()` comparisons on the money path. The moment that is idiomatic in the payout tables, the next session needing "five trading days from now" has a working pattern sitting right there that is **wrong on roughly 104 days a year**. Three mechanisms land first, each watched failing on a seeded violation: an **import ban** so the sweep path cannot reach `TradingCalendar`, a **SQL shape check** that is vacuously true today and therefore cheapest today, and a **unit declaration gate** over all **45** `date` columns.

**Two units, and the founder's ruling stated so a future reader cannot assume one governs the other.** Trading days, answered only by `TradingCalendar`. Wall-clock hours, answered only by `now()`. **A 48 hour hold that expires at 03:00 on Christmas Day releases at 03:00 on Christmas Day**, because releasing is Merit's own act and needs no exchange, no bank and no calendar. **Nothing Merit computes is measured in business days**, which is the third unit the corpus uses in ten documents, defines in none, and has no table for.

---

## S-E2: `0032` carries F-1 to F-4, and the weak reading of F-1 was falsified by execution (2026-08-16)

**[`0032_trading_calendar_holidays_coverage_revisions.sql`](../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql), with its `E2 READ: MONEY PATH` header and the founder's read still to come.** It supersedes `0004_catalog`'s `trading_calendar` constraints and `0026_roles_and_grants`' append-only revoke list, and **edits neither**. `0029` to `0031` are untouched. The set applies forward-only from empty against PostgreSQL 16 with zero errors: **98 tables, 332 indexes, 359 check constraints, 6 triggers.**

| Finding | What landed |
|---|---|
| **F-1** | Session columns nullable, `trading_calendar_session_ordered` **rewritten under its own name**, `trading_calendar_holiday_has_no_session` added. A holiday is a **positive fact rather than an absence** |
| **F-2** | `trading_calendar_revisions`, append-only by grant: prior row image (derived, `to_jsonb(OLD)`, not a listed column set), actor, reason, source digest, incident reference, **and the asserted dependent-row count that makes the incident reference required when anything depends on the day** |
| **F-3** | The latest-close semantics on `session_close_at` as a `COMMENT`, plus a `CHECK` that a half day records something in `notes`. **The symbol dimension is rejected**, as ruled |
| **F-4** | `trading_calendar_loads`, append-only by grant. A day outside coverage is **unknown**, not a holiday |

**The most dangerous line in the file, and it was executed rather than reasoned about.** Dropping `NOT NULL` from a column named inside an existing `CHECK` does not make that `CHECK` null-safe, it makes it **vacuous** on the rows that now carry `NULL`, because a `CHECK` that evaluates to `NULL` **passes**. That is [ADR-035](decisions/ADR-035.md)'s `array_length` defect arriving a second time through a different door. A scratch schema carrying the weak reading, ruled `CHECK` and all, **accepted a holiday with a fabricated close instant and no open**, in a containment table, on a day the exchange is shut. `0032`'s constraint admits both columns `NULL` or both non-`NULL` and ordered, and nothing else.

**36 perturbations, one per assertion, checked by message rather than by exception class, every group led by its positive control.** All pass. **Two of them were written expecting the wrong constraint and the schema corrected the expectation**, which is precisely what an exception-class check would have hidden. Tabulated in [DELTA_MANIFEST section 14](../packages/db/DELTA_MANIFEST.md). They are **not yet a committed probe**: `scripts/db/probe_trading_calendar.sql` is S-E4's deliverable beside the loader it tests, and this is said here so the next reader does not assume it is already wired.

**A gate was found reading nothing, and it is the CI-06g class again.** `CI-06g`'s span parser read the name as `[a-z_]+`, with **no digits in the class**, so the `e2_files` span was **not a span at all**: invisible to the checker and to the generator, passing green while the number was wrong. INDEX said 18 files carry an `E2 READ` header against 19 on disk, **in the same sentence that calls it a generated span**. Found because `0032` became the nineteenth. Fixed to `[a-z0-9_]+`, three spans across two documents corrected, and **watched failing on a seeded violation and passing when restored**. A span that cannot be parsed is worse than a hand-maintained number, because it reads as checked.

~~**One thing is open and needs a ruling rather than a session's judgment.**~~ **RULED AND CLOSED 2026-08-16, see below.** `OI-06`: **nothing in the database forced an `UPDATE` to `trading_calendar` to write a prior image.** The loader did it; the schema did not require it. A trigger makes F-2 a control rather than a rule somebody follows, `0027` is where invariant triggers live, and **ADR-042 was silent**, so the session that wrote `0032` did not add a money-path trigger on its own authority. That restraint is what [ADR-045](decisions/ADR-045.md) answers.

---

## `0033` closes the calendar prior-image gap, and DELTA_MANIFEST gets the fourth allocation table (2026-08-16)

**[`0033_trading_calendar_revision_required.sql`](../packages/db/migrations/0033_trading_calendar_revision_required.sql) exists, applies and is probed, and the founder's E2 read is still to come.** [ADR-045](decisions/ADR-045.md) closes `OI-06 (calendar prior image)`: **[ADR-042](decisions/ADR-042.md) F-2 ruled the prior-image table and ruled nothing about what obliges anybody to write to it**, so F-2 landed as a table nobody was required to use. It edits nothing; `0004`, `0027` and `0032` are untouched on disk.

**It asserts and does not write, which is `0027`'s idiom rather than a preference.** A trigger that wrote the image itself would have to invent an `actor` and a `reason`, and a reason nobody gave is exactly what `trading_calendar_revisions.reason` exists to refuse. **All <!--gen:migration_files-->33<!--/gen--> files apply forward-only from empty against PostgreSQL 16.13 with zero errors: 102 tables, 351 indexes, 397 check constraints, <!--gen:sql_triggers-->9<!--/gen--> triggers.** Three of the four figures do not move, which is what a control that was **missing** rather than **wrong** looks like in a diff.

| The three things the E2 read is for | |
|---|---|
| **The counted half is one assertion more than the ruling names** | `dependent_row_count` was self-reported, and `trading_calendar_revisions_incident_named_when_dependent` reads that number and nothing else, so **an incident became an ordinary data change by typing a zero**. The trigger recounts across the three tables [P1 S-E section 4](plans/P1-SE-trading-calendar.md) partitions on. **Separately rejectable**: the image half stands without it |
| **`CALENDAR-C2` refuses `DELETE` and `TRUNCATE`** | `DELETE` then `INSERT` is an `UPDATE` with the audit trail removed, and `TRUNCATE` fires no row triggers at all. **Today's protection was real and inverted**: the revisions foreign key is `ON DELETE RESTRICT`, so a day already corrected could not be deleted and a day nobody had touched could |
| **The image is compared as `jsonb`, which forces the loader to build it in the database** | An image assembled in application code does not equal `to_jsonb(OLD)`. That is `0032`'s derived-not-listed rule **enforced** rather than restated, and it is an obligation on the loader S-E4 has not written yet |

**[`probe_calendar_revision_required.sql`](../scripts/db/probe_calendar_revision_required.sql) is 12 / 12, leads with four success cases, and arrives already pinned by [CI-06h](testing/STRATEGY.md).** `probe_payout_hold.sql` was wired and unpinned for a day, which is one delete from being `OI-07` again; this one is pinned in the commit that wires it. **It forces the deferred check with `SET CONSTRAINTS ... IMMEDIATE`**, because the probe ends in `ROLLBACK` and a success case left to fire at commit would be checked by nothing: the file would print four green successes having verified none of them. **That is the vacuous-pass shape a third time**, after the `CHECK` that evaluated to `NULL` and the `DO` block that read a prefix of the schema. **Four counterfactuals were watched failing on their own findings**, including a guard that refuses everything, which only a success case can see.

**And DELTA_MANIFEST has its own allocation table at last** ([section 16](../packages/db/DELTA_MANIFEST.md)), which is the fourth registry to get one and the one that had already collided rather than nearly collided. **Two rows numbered `OI-06` and three sections numbered `14`, all five written on 2026-08-16 by three parallel sessions**, each reading the same file, each finding the same maximum, each taking the next number. **Nothing is renumbered**: both `OI-06`s are cited with their subject attached, because choosing which one moves is a decision about two open findings and a silent renumber breaks every citation of whichever one loses. **No gate reads the new table and that is stated rather than implied**, with the cheap version of the gate written down for whoever writes it.

**The ADR number collided with an open sibling pull request and this branch moved before opening its own.** The ruling was claimed as `044`, in its own commit, before the file existed, which is what the founder asked for. **PR #25 has held `ADR-044` on its branch the whole time**: `main` ends at `043`, this branch is not behind `main`, and twelve gates passed against the claim, because `CI-06f` reads one ref. **That is its declared cross-branch gap met in the wild for the second time in three days**, after FOLD-02's plan hit it on `038`, and the job that would close it is still unwritten. Resolved here rather than at merge, on FOLD-02's precedent; [ALLOCATION](decisions/ALLOCATION.md) records why this branch moved when [ADR-034](decisions/ADR-034.md)'s tiebreak points the other way. **The step that was skipped is the one no table can perform: reading the remote branches.**

**`OI-09` was found while writing this session's own registry row.** [ADR-043](decisions/ADR-043.md)'s ADR **had no row in the ADR registry table**: it was linked from a sentence in the README preamble, and `CI-06n` accepted that, because the gate matches any markdown link anywhere in a registry README while its title says "row". Its `covers` line is honest and its title is not, which is how a merged ADR fell out of the registry it belongs to with twelve gates green. The row is added; **the gate is not narrowed here**, because narrowing it needs a sweep of every registry directory the split created and a seeded violation it has been watched failing on.

---

## The registries are honest, and the four ADRs are written (2026-08-15)

**[ADR-039](decisions/ADR-039.md), [ADR-040](decisions/ADR-040.md), [ADR-041](decisions/ADR-041.md) and [ADR-042](decisions/ADR-042.md) exist**, and so do the eight allocation rows the three approved plans each claimed and none had written. **Recording only: no migration, no schema, no module document and no golden scenario was touched.** The three folds may now write against their numbers, and a sibling branch reading `main` can see every claim.

**The correction this session was commissioned to make had already been made, and the staleness had moved.** The brief named the `036` row as still reading `reserved, unmerged` after the pull request that merged it. It does not: `036` was corrected in the fold that landed ADR-037 and ADR-038, and the row records its own repair. **`037` and `038` were the stale ones**, merged by PR #15 and still claiming to be reserved on a branch that no longer exists. That is the **third and fourth** instance of this exact drift, it was found by reading `git log` against the table rather than by reading the table, and **a brief written against that column was wrong about it inside two days.** The remedy is not more care: the State column is prose, no gate can check it, and [ADR-036](decisions/ADR-036.md) already said so.

| What landed | Detail |
|---|---|
| **The ADR table** | Rows for **039 to 042**, and `037` and `038` corrected from `reserved, unmerged` to `allocated` |
| **The migration table** | Rows for **`0029` to `0032`**. **The "nothing is reserved today and `0029` is the next free number" sentence is DELETED rather than corrected**, on [ADR-034](decisions/ADR-034.md)'s own remedy: it was a hand-maintained claim about the registry that exists to end hand-maintained claims, and it was the only thing in the repository asserting it |
| **A third allocation table** | **`CI-06` gate letters**, claiming `k` (FOLD-01, declared authority), `l` (FOLD-02, every expiry has a sweep) and `m` (S-E, the calendar's own counts). Three folds were claiming from an unregistered namespace at once, and **each plan hand-maintained the other two's letters in its own prose**. It also records that [ADR-036](decisions/ADR-036.md)'s alternatives list names a **rejected** `CI-06k` that is not a reservation, which is the prose-reserves-a-number failure the shared parser was hardened against on the other two tables. **No gate reads this table yet and that is stated rather than implied** |

**Nine founder rulings that existed nowhere in the corpus are now recorded.** The widest three:

| Ruling | Where |
|---|---|
| **The cost breaker degrades, it does not stop.** Phone verification is mandatory at registration, so a tripped breaker means **no new customers**: the control protecting revenue becomes a cheap denial-of-service on it. **Fail-closed protects money on provisioning and destroys it on registration.** On trip, registration continues with verification deferred to a hard gate before first funding, which [ADR-021](decisions/ADR-021.md)'s composite trigger set already makes real, so no new mechanism. **And it trips alarms**: a breaker that degrades silently is one nobody notices is stuck | [ADR-039](decisions/ADR-039.md) |
| **OQ-M5-02 closes at 48 hours**, matching the hold. The investigate-time justification is identical in both cases, and **the post-credit case holds money Merit has already recognised as owed**. Merit would otherwise have bound itself harder where nothing has moved than where the money is already the trader's | [ADR-040](decisions/ADR-040.md) |
| **"Business day" is the rail's language. Merit quotes it and never computes it.** [GLOSSARY](GLOSSARY.md) gains the term defined as exactly that; M05's "10 business days" becomes **48 wall-clock hours**; the published "2 to 3 business days" settlement claim is **unchanged**, because it is the rail's claim, quoted. **The 48 hour clocks are wall clock, and the obligation is to RELEASE, not to SETTLE** | [ADR-042](decisions/ADR-042.md) |

**One cross-cutting correction was folded here rather than recorded: [STATE_MACHINES section 2](architecture/STATE_MACHINES.md) still routed `frozen --> transferring`.** [ADR-028](decisions/ADR-028.md) retired `transferring` from `payout_requests` on 2026-08-14 and named two sites it corrected, DATA_MODEL's second stale predicate and M05's machine. **It missed the authoritative drawing**, and the only reason it was found is that a founder read the machine rather than the ADR. **The sweep is still not complete and the remaining four sites are named in ADR-040 rather than left for a grep**: `G-NO-IN-FLIGHT` and `G-FREEZE-DURING-FLIGHT` in section 10, [M01](plans/M01-rules-engine.md)'s `SD-09` and its `hasPayoutInFlight` comment, [EDGE_CASES](edge-cases/README.md) line 148, and [API_CONTRACT](architecture/API_CONTRACT.md)'s status union. All four are surfaces FOLD-02 must touch anyway to add `held_pending_review`.

**Two of the four are swept as of session 4** (both section 10 guards). **[EDGE_CASES](edge-cases/README.md) and [API_CONTRACT](architecture/API_CONTRACT.md) are sessions 7 and 6.** **[M01](plans/M01-rules-engine.md) is on neither list, and that is a hole in [FOLD-02](plans/FOLD-02-enforcement-window-and-suspension.md)'s own section 7 rather than a session that skipped it**: the plan enumerates roughly twenty-six files and M01 is not among them, while ADR-040 names two M01 sites by name. `SD-09` is M01's delta, its predicate has now moved twice without M01 saying so, and `hasPayoutInFlight`'s comment still reads `approved | transferring | frozen`. **The one document that must not disagree about which requests are outstanding is the engine's**, so this needs a session rather than a footnote, and it is listed in the next actions.

**Two `falsify.mjs` seeds were invalidated by the reservations, and one of them failed silently.** Both `CI-06h` scope cases were pinned to the literal `0029`: reserving it made the unallocated case write a file the table now claims, so its finding stopped firing and the harness said so, and made the reserved case insert a **second** row for an already-reserved number, so it passed while asserting nothing and **said nothing at all**. **One went silent and one went vacuous, and only the silent one announced itself.** Both are retargeted to `0033` with the maintenance cost recorded in the file, and all three `CI-06h` cases have been watched firing on their own findings again.

---

## The AI and LLM policy is ruled (2026-08-16, ADR-044)

**[ADR-044](decisions/ADR-044.md) is accepted.** Merit may use language models in
four narrow classes and may not use them anywhere near a money decision. It was
written by the review desk against a founder brief, and **four defects in the
brief itself were found against the primary sources and ruled rather than
inherited.** No migration, no schema, no engine behavior and no running gate
changed.

**The corpus said nothing about this before today.** A grep for `llm`, `genai`,
`machine learning`, `generative` and `ml` across every document in `docs/`
returned **zero hits**, so under FREEZE's own reading every AI feature was
prohibited by omission, which nobody had decided.

| # | The brief said | The source said | Ruled |
|---|---|---|---|
| **1** | M13 insights, "labeled advisory" | **[M13](plans/M13-trader-analytics-journal.md)'s governing sentence**: a second computation of anything the engine computes means **two rulebooks**, and its failure mode is a trader who believes something different from what the engine enforces | **The narration boundary.** A model may narrate, order and explain engine-computed numbers. It may not **derive** one. Checkable by fixture; "advisory" is not checkable at all |
| **2** | Prohibit "unreviewed AI-generated user-facing copy" | The same ADR permits per-trader runtime narration in (a), **which can never be pre-reviewed**. The brief prohibited its own permission three lines later | Prohibition scoped to **published, static** surfaces. Class (a) is held by the narration boundary instead |
| **3** | Support assistant reads live gate state, "per E3" | **[E3](../MERIT_BUILD_MASTER_PROMPT.md)** scopes the support bot to **published docs** *until a threat-model pass says otherwise*. Live gate state is internal per-identity data | **ADR-044 amends E3** and pays E3's own stated price. The threat-model pass is a named precondition on the M10 and M15 builds |
| **4** | "Follows the ADR-020 pattern" | **[ADR-020](decisions/ADR-020.md)**'s indicative tier is nondeterministic in *freshness* only and always degrades to a correct stale value. A model layer has **no stale-but-correct fallback** | Degradation is stronger than ADR-020's: the deterministic surface must be **complete and usable with the model layer deleted** |

**The ruling that matters most is section 1: the ADR adds no scope.** It is a
permission boundary. Five frozen module plans (M06, M07, M10, M13, M15) describe
no AI behavior, and an ADR that merely listed four permitted features would have
converted them into four uncosted commitments in five frozen documents. Each still
needs its own module amendment, which is where the per-feature cost, latency and
failure-mode analysis lands.

**`CI-06o` is claimed and unwritten, and the ADR says so.** A money-path model
ban enforced by people remembering it is a control that exists, stays valid and
enforces nothing. Until the gate runs and has been **watched failing on a seeded
violation**, ADR-044's first prohibition is prose. It is cheapest now, while the
payout, ledger and auth packages do not exist and it is close to vacuous, which
is [ADR-042](decisions/ADR-042.md)'s argument for its SQL shape check.

### Three findings from the desk's own verification pass

| # | Finding | State |
|---|---|---|
| **`OI-09`** | **`CI-06n` matches any markdown link, not a table row.** Its `run()` scans the registry README with `/\[[^\]]*\]\(([^)\s#]+)[^)]*\)/g` and accepts a **prose mention**. Its title claims "has a README row"; its `covers` line honestly says "is linked from", and the check matches the weaker of the two. **Found because `ADR-043` had no row in [decisions/README](decisions/README.md) and CI-06n was green.** One ADR of 43 was missing from the registry index, and it was the ADR that wrote CI-06n to pay for its own `CI-06c` exemption | **Row added 2026-08-16; the gate is NOT fixed.** The parser tightening (require the link to sit in a table row) is a tooling change and must arrive with its own `falsify.mjs` seed, watched failing. **This is the `CI-06g` span-parser class a third time**: a gate whose parser is looser than the property it claims |
| **`OI-10`** | **Keep-both merges duplicated four passages in this file and no gate could see it.** The schema-delta paragraph stood **twice** identically, the `CI-06, corpus integrity` row **three times**, action item 3 **three times with three different tails** (`0032` next, `0032` done, `0032` not started), and a **stale** P1 row asserted `0029` to `0031` were "reserved and unwritten" **after all three merged**. `CI-06g` cannot catch it: duplicated spans carrying the **same** value match their query, so the gate passes over a document containing a false sentence | **Deduplicated 2026-08-16.** The `Eleven checks` count was corrected to twelve in the same pass. **The gate that would catch it does not exist**: no restated span-carrying sentence may appear twice in one document. It needs a letter, and the desk did not claim one for a gate it had not scoped precisely |
| **The ADR State column** | Rows `039` to `043` read **`written on the branch, unmerged`** after PR #17 and PR #18 merged them | **Corrected. Fifth through ninth instance**, in the column [ADR-036](decisions/ADR-036.md) already records as prose no gate can check |

---

## Next 3 actions

1. **The founder's E2 read** on the <!--gen:e2_files-->23<!--/gen--> money-path migration files, and a ruling on item **B** ([ADR-030](decisions/ADR-030.md)'s stale config list, wrong in two of four). **A** and **C** are closed. Nothing merges first.
2. **In parallel, the three calendar items**: book the vendor call, book the counsel sitting, and send the PSP applications the day the capital decision lands.
3. ~~Write the six missing allocation rows.~~ **DONE 2026-08-15.** Eight rows, not six: ADR-039 to ADR-042 and `0029` to `0032`, plus a **third allocation table for `CI-06` letters** claiming `k`, `l` and `m`. **The three folds may now write against their numbers.** **FOLD-01 session 3 has landed** (`0029`, its nine design records, its manifest rows; 2026-08-16). Next in each: FOLD-01 session 4 (SECURITY, M19, M07, M16), FOLD-02 session 3 (`0030`, `0031`), S-E session 2 (`0032`). **Each money-path session takes a fresh session, no exceptions.**
3. ~~Write the six missing allocation rows.~~ **DONE 2026-08-15.** Eight rows, not six: ADR-039 to ADR-042 and `0029` to `0032`, plus a **third allocation table for `CI-06` letters** claiming `k`, `l` and `m`. **The three folds may now write against their numbers.** Next in each: FOLD-01 session 3 (`0029`, DATA_MODEL, DELTA_MANIFEST), ~~FOLD-02 session 3 (`0030`, `0031`)~~ **DONE 2026-08-16, see below**, S-E session 2 (`0032`). **Each is money path and takes a fresh session, no exceptions.**
3. ~~Write the six missing allocation rows.~~ **DONE 2026-08-15.** Eight rows, not six: ADR-039 to ADR-042 and `0029` to `0032`, plus a **third allocation table for `CI-06` letters** claiming `k`, `l` and `m`. **The three folds may now write against their numbers.** Next in each: FOLD-01 session 3 (`0029`, DATA_MODEL, DELTA_MANIFEST), FOLD-02 session 3 (`0030`, `0031`), ~~S-E session 2 (`0032`)~~ **`0032` DONE 2026-08-16**, ~~S-E now at session 3 (the source file)~~ **S-E3 landed PARTIALLY 2026-08-16: the source contract, the generator and its eighteen seeded violations are written, and the transcription itself is BLOCKED on egress to `cmegroup.com`** ([session 32](sessions/2026-08-16-session-32.md)). **Each is money path and takes a fresh session, no exceptions.**

**This item now has three near-identical copies above it**, one per parallel session that appended its own version of the same line rather than editing the shared one. It is left as found: the duplication is the record of how it happened, and the fix belongs with whoever rules on the `OI-06` collision that has the same cause.
3. ~~Write the six missing allocation rows.~~ **DONE 2026-08-15.** Eight rows, not six: ADR-039 to ADR-042 and `0029` to `0032`, plus a **third allocation table for `CI-06` letters** claiming `k`, `l` and `m`. **All three folds have now written against their numbers and merged**: FOLD-01 session 3 (`0029`), FOLD-02 session 3 (`0030` and `0031`) and S-E session 2 (`0032`), all on 2026-08-16. **This item stood three times in this list with three different tails**, each a keep-both merge of a sentence a sibling branch had already advanced, and the three said `0032` was next, was done, and was not yet started. **Deduplicated 2026-08-16 and recorded as `OI-10`**, because no gate can see it. Next in each: FOLD-01 session 4, FOLD-02 session 4 (which waits on FOLD-01 s4), S-E session 3. **Each money-path session takes a fresh session, no exceptions.**
5. **FOLD-02 continues at session 5**, and its file list has a hole that needs closing first. **Session 4 landed 2026-08-16** (STATE_MACHINES, M05, M20, M07, SECURITY section 4) and **session 8 landed 2026-08-16 out of order** (DELIVERY_PLAN and M15, non-money, and it depends on nothing sessions 5 to 7 produce). Remaining: session 5 the surfaces (M02's provisional platform leg, M06, M03, M04, M16, the M08 confirmation), session 6 the disclosure and contract surfaces (TOS clauses 5 and 13, GUIDE_BRIEFING, EVENTS, API_CONTRACT), session 7 the registries and `CI-06l`. **[M01](plans/M01-rules-engine.md) is on none of those lists and [ADR-040](decisions/ADR-040.md) names two M01 sites**, so it needs a slot: `SD-09`'s predicate has moved twice without its owning plan saying so. **This item is written once, here, rather than appended as a fourth copy of item 3.**
4. **Rule `OI-01`** (`liability_snapshots`, surfaced with a recommendation and deliberately not decided by a session), then the rest of **P1** below. **[ADR-035](decisions/ADR-035.md) is accepted and `0028` is written**; it needs the E2 read like every other money-path file, not a separate ruling. **S-B, S-C and S-D have landed and S-E is now planned**, so [P1 section 6](plans/P1-monorepo-scaffold.md) has nothing left to plan and five build sessions to run. This line read "S-C and S-E left" after S-C had already landed, which is the row below correcting it.

---

## What actually remains of P1 (2026-08-15)

**[DELIVERY_PLAN section 4](DELIVERY_PLAN.md) gives P1 three contents: the monorepo scaffold, the reconciled schema and migrations, TradingCalendar as data, and CI carrying the full [STRATEGY](testing/STRATEGY.md) gate inventory.** Its definition of done is **"every VG gate wired and failing correctly on a seeded violation, VG-12 not deferred"**. Measured against that, honestly:

| P1 item | State | What is actually left |
|---|---|---|
| **CI-06, corpus integrity** | **DONE and exceeded** | **Twelve** checks, all passing clean and failing dirty. The row's own definition of done is met **for CI-06 only**. This row stood three times in this table and read "Eleven" against the twelve `gates.mjs` reports; both are `OI-10` |
| **The reconciled schema and migrations** | **DONE**, pending the E2 read | <!--gen:migration_files-->33<!--/gen--> files, <!--gen:sql_tables-->102<!--/gen--> tables, <!--gen:sql_triggers-->9<!--/gen--> triggers, verified on a clean PostgreSQL 16 install; **index and check-constraint totals are emitted by the install job**, for the reason line 99 gives. Nothing to build. **The founder's read is the remaining work and it is not engineering** |
| **CI-06h, migration install** | **RUNS IN ACTIONS, green** | Corrected 2026-08-15 (S-B). This row read "WIRED, never executed by GitHub. **It has not run in Actions once**" and that was already false when it was written: run `31860712550`, job `94953489824`, commit `3082b61e`, **2026-08-15T03:01:16Z, success**, applying all <!--gen:migration_files-->33<!--/gen--> migrations against PostgreSQL 16 on a runner. It has since run on every push to this branch, and now carries ADR-035's probe as well (run `31862563569`) |
| **The reconciled schema and migrations** | **DONE**, pending the E2 read | <!--gen:migration_files-->33<!--/gen--> files, **98 tables, 332 indexes, 359 check constraints, 6 triggers**, verified on a clean PostgreSQL 16 install (`0001` to `0028` then `0032`; `0029` to `0031` are reserved and unwritten). The figures read 96 / 326 / 347 / 6 before `0032`. Nothing to build. **The founder's read is the remaining work and it is not engineering** |
| **CI-06, corpus integrity** | **DONE and exceeded** | Eleven checks, all passing clean and failing dirty. The row's own definition of done is met **for CI-06 only** |
| **The monorepo scaffold** | **DONE** (S-B, 2026-08-15) | Nine workspace-root files, three libraries, four deployables, two tooling packages, and a lockfile. `pnpm install --frozen-lockfile` from clean, `tsc --noEmit` across nine projects, four named Vitest projects each runnable alone. **Section 6's S-C, S-D and S-E are the remaining P1 sessions** |
| **TradingCalendar as data** | **IN FLIGHT.** S-E1, **S-E2** and **S-E3 in part** landed (2026-08-16). Schema and generator on disk, **no data** | `trading_calendar` exists in `0004` with its ruled semantics (half day counts as a full day, a halt advances counters but not win days), and **[`0032`](../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql) now carries [ADR-042](decisions/ADR-042.md)'s F-1 to F-4**: a holiday is writable and is a positive fact, `trading_calendar_revisions` holds the prior image `INV-04` needs, `trading_calendar_loads` makes an uncovered day a positive "unknown", and F-3's latest-close semantics are on the column. **S-E3 landed the seed mechanism's first half** ([session 32](sessions/2026-08-16-session-32.md)): [`packages/db/src/seed/calendars/`](../packages/db/src/seed/calendars/README.md) holds the source-file contract, the generator (exceptions to full rows, both the CT wall time and the UTC instant on every session, DST discovered from IANA and checked against the published United States rule), the OQ-SE-04 diff, and eighteen seeded violations each failing on its own finding. **There is still not one row of data anywhere in the repository, and the reason is now specific rather than pending: the CME publication could not be retrieved, the exception lists are `null`, and nothing was written from recollection because that is what `TR-01` forbids and what makes OQ-SE-04's second reader worthless.** [P1-SE-trading-calendar](plans/P1-SE-trading-calendar.md) is `approved`; **the transcription, S-E4 (the loader and its six proofs) and S-E5 (`CI-06m`, the lint rule, the shape check, the fixture derivation) remain** |
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
| **Folded** | `isCorpusDocument` in [`scripts/corpus/gates.mjs`](../scripts/corpus/gates.mjs), read by CI-06b and CI-06c both. The by-name allowlist carries its own expiry in a comment: **one entry is fine, three needs a rule instead of a list**, which is [ADR-034](decisions/ADR-034.md)'s drift class applied to the fix for a drift |
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

**[ADR-036](decisions/ADR-036.md). [ALLOCATION](decisions/ALLOCATION.md) carries three allocation tables**, ADR numbers, migration numbers and CI gate letters, and `CI-06h` asserts the migration one by `CI-06f`'s rule: gapless over allocated plus reserved, and **a number on disk that no row claims fails.** **The next free number is read from the last row of the table and is not stated here.** This sentence said "nothing is reserved and `0029` is the next free number" until 2026-08-15, when it was false in both halves: `0029` to `0032` were reserved and the claim had been deleted from the table itself under [ADR-034](decisions/ADR-034.md). It is the seventh site of that class and the reason `CI-06g` exists.

**The registry that had no table was the one that could least afford a collision.** `CI-06h` derived the sequence from the tree, which is the check a branch can satisfy while colliding with its sibling: two branches both find `0028`, both write `0029`, both pass locally. [ADR-034](decisions/ADR-034.md) resolved the ADR collision by renumbering the cheaper branch, and **that remedy does not exist for a migration**, which E2 makes sacred once merged.

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
| **2** | **[GOLDEN_SCENARIOS section 3](testing/golden-scenarios/README.md)'s `CORE-50K` shorthand says ladder 8; [M01 Appendix A.1](plans/M01-rules-engine.md) says 5** per [ADR-024](decisions/ADR-024.md), in the same sentence naming Appendix A "the only place these numbers are defined". Twelve of thirteen restated values agree | **CLOSED by [ADR-037](decisions/ADR-037.md).** The **thirteen copies are deleted**, not the wrong one corrected, and section 3 points at Appendix A.1. GS-066 and GS-067 carried the same stale 8 and now name `max_payouts`. **CI-06g's rule extends from counts to parameters**; the enforcement does not, and the gap is stated in its `covers` line |
| **3** | **Four fixture fields reach no engine input**: `account.phase`, `account.opened_on`, `days[].adjustment_cents`, `settlements`. And `traded_day` runs the other way, declared by the type and absent from the printed format | **NAMED, not dropped.** The loader refuses any field it can neither map nor list, `L-14` asserts the list is still in use, and the fixture supplies `traded_day` because a loader deriving it would have implemented R-08, a rule the fixtures exist to check. **M01 empties the list** |
| **4** | **Where the expectation lives is ambiguous in two approved documents**: both rule "YAML plus a JSON sibling" and section 2's example shows `expect:` inline | **CLOSED as [EC-141](edge-cases/EC-141.md).** The reading stands, unchanged and still reversible: the sibling **is** the `expect` block serialized as JSON, which keeps both approved sentences true, and `L-05` refuses a fixture carrying both. It is an EDGE_CASES entry now rather than a session finding, so the next reader looks it up instead of rediscovering it |
| **5** | **`yaml` is not a dependency.** VG-12 makes a new package a human admission a session cannot grant itself, so the loader reads a strictly specified subset and throws on everything else | **STANDS. VG-12 upheld, `yaml` not admitted**, and the subset parser is hardened instead. **Two silent mis-parses were found and closed**: a sequence item's tail was read and discarded, and every plain scalar a real YAML library types differently was read as a string. **The same-commit date obligation is recorded in the code that admits the date**, not only in prose: an unquoted `2026-11-03` is a string here and a `Date` under `yaml`, which is a clock reading entering the one package whose contract is that it has none |

**One duplication is recorded rather than smoothed over.** `registryIds()` re-implements `gs_count`'s query from [`scripts/corpus/gates.mjs`](../scripts/corpus/gates.mjs), which is [OQ-P1-04](plans/P1-monorepo-scaffold.md)'s defect class in the runner that ruling was about. Unifying them needs the corpus runner to export a membership helper and S-D was scoped out of that directory. **The tiebreak is written down: if the two ever disagree, the loader is wrong.**

**CI-03 is its own workflow file rather than a job in `ci.yml`, which is S-C's to create and did not exist.** Folding it in later is a move of one job, not a rewrite. Left as a founder call, the same way the reconciliation ruling took `corpus.yml` unchanged.

---

## The S-D review rulings are folded (2026-08-15)

**Four rulings from the founder's read of S-D, all non-money.** Two changed frozen documents and carry ADRs; two are code.

| Ruling | Landed as |
|---|---|
| **A shorthand may not restate a value the config owns** | [ADR-037](decisions/ADR-037.md). [GOLDEN_SCENARIOS section 3](testing/golden-scenarios/README.md)'s thirteen restated `CORE-50K` values are **deleted** and the section points at [M01 Appendix A.1](plans/M01-rules-engine.md#a1-core-eod-core_eod). GS-066 and GS-067 named the same stale ladder of 8 in their pins and now name `max_payouts`. **CI-06g's rule extends from counts to parameters** |
| **The YAML subset must fail loudly, never mis-parse** | Two silent mis-parses found and closed in [`src/yaml.ts`](../packages/golden-loader/src/yaml.ts), each with a seeded case asserting the refusal. **`yaml` is not admitted; VG-12 stands.** The same-commit date-quoting obligation is now recorded at the line of code that admits the date |
| **The expectation-location ambiguity resolves once** | [EC-141](edge-cases/EC-141.md). The reading is unchanged and still reversible; it is a registry entry now rather than a session finding |
| **CI-03 prints what it currently proves** | [ADR-038](decisions/ADR-038.md). [`src/coverage.ts`](../packages/golden-loader/src/coverage.ts) emits the statement into the job log and the Actions step summary on every run, and **measures** the claims rather than repeating them |

**The two mis-parses are worth naming separately, because both were silent passes rather than crashes and only one was in the class anybody was watching.**

**A sequence item dropped its tail.** `parseNode` returns how far it got and both sequence-item call sites discarded that number, so `- \n  - a\n  keep_me: 1` parsed to `[["a"]]` with `keep_me` read from disk, parsed, and thrown away, on every stream, with no error. **A fixture input the engine never sees is the worst outcome a golden file has**: the scenario passes while pinning something the author did not write, which is the exact failure the loader's `AWAITING_M01_INPUT` list exists to prevent from the other direction. A field the parser never surfaces cannot reach that refusal at all.

**Plain scalars a real YAML library types differently were read as strings.** `True`, `yes`, `NULL`, `0x1F`, `007`, `+5`, `1_000`, `.inf` and `1:30` are booleans, null, integers, a float and a sexagesimal elsewhere. **This is the recorded date hazard generalized**, and the bare `YYYY-MM-DD` trading day is now the single named admission in that class, with the same-commit obligation written where a reader changing it would see it.

**The CI-03 ruling is the one with the longest reach and it is stated as a rule rather than as a note about one stage.** While the engine is a stub the stage's polarity is inverted, so **a corrupted expected end state still passes** and the end-to-end assertion is behind `describe.runIf(!stubbed)` and does not run. All three were true, all three were correct, and all three were written down **only in a pull request body**, which is read once. The stage now says so itself, on every run, and the corrupted-expectation claim is **proved** by corrupting every loaded fixture and re-running the stage's own assertion over it, so the block cannot describe a stage other than the one that ran. `--reporter=verbose` is part of the command for a reason that is not taste: Vitest's default reporter swallows test stdout on a passing run.

**One defect was found in the falsification harness while verifying, and it is the same class as ADR-037's.** `falsify.mjs`'s CI-06g seed hardcoded `<!--gen:ec_count-->140`, so adding EC-141 broke the harness built to catch hand-maintained counts. It now reads the span and adds one, which is a violation by construction whatever the query returns. **Sixth site of that class, and the first one inside the tooling.**

**What is NOT enforced, stated rather than implied.** CI-06g's parameter half is a rule a reviewer applies, not a query a runner runs. Closing it needs a check that can tell a shorthand from a scenario's own arithmetic, since GS-026's "withdrawable 214,250, cap 150,000" is a computed boundary a fixture exists to pin and must survive any sweep. That query is not ruled, and a gate that fails on correct prose is a gate that gets switched off.
