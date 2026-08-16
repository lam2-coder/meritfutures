# Wave 3 batch 1 gate closure (2026-08-14)

The founder reviewed [M02](../../plans/M02-rithmic-bridge.md) through [M08](../../plans/M08-affiliate-system.md) and returned rulings on every open question raised in them, plus two new architecture decisions taken at the same sitting. The gate is **closed**. **M03 through M08 move to `approved`; M02 stays at `review`**, because [ADR-005](../ADR-005.md) forbids it leaving review while the vendor call is outstanding, and that is by design rather than an omission.

Five rulings became ADRs above because each chose between alternatives or amended an approved document: **ADR-016** (scoped ledger halt, accepted with a conservative classifier and an escalation clock), **ADR-017** (one outbound rail, accepted with affiliate destination cooling), **ADR-018** (Merit Rapid at 3 win days, resolving OQ-12), **ADR-019** (the Merit Wallet and the two-leg payout, with ADR-019a's gamification bright line), and **ADR-020** (the two-tier data plane). The rest are recorded below.

## The rulings that confirm or extend a design

| Ruling | Where it was asked | Outcome |
|---|---|---|
| [M01 section 3.4](../../plans/M01-rules-engine.md)'s floor expression, read as "the high-water balance stops updating at the lock" | Session-5 landmine: the founder's `max(trail minus DD, lock)` formulation is literally correct only under that reading | **Confirmed as written.** The reading M01 adopted is the intended one. The alternative reading, in which the trail continues after locking, is economically impossible because it breaches every account on its second payout. Section 3.4 needs no correction and everything downstream of it stands |
| Copy trading | [M07 OQ-M7-01](../../plans/M07-risk-abuse.md) | **Ruled, see the clause below.** Permitted same-identity, prohibited cross-identity, prohibited through third parties. Wired into D-01, the ToS drafting note, and M07's detector logic |
| Evidence pack tiering | [M06 AS-M6-01](../../plans/M06-admin-ops-console.md), SD-M6-04 | **Confirmed as two tiers.** A trader-facing pack shows **conduct, rule text, and the trader's own trades**. Thresholds, detector internals, parameters, and population comparisons are **internal and counsel tier only**. The `regulator` audience follows the internal profile. This closes the cross-module control with [M07](../../plans/M07-risk-abuse.md)'s SD-M7-03 registry supplying the strip list |
| Fail-closed provisioning | [M02 OQ-M2-04](../../plans/M02-rithmic-bridge.md) | **Ruled as design law, not a preference.** See below |
| Break-glass for the second `owner` credential | [M06 OQ-M6-03](../../plans/M06-admin-ops-console.md) | **Ruled: sealed physical backup.** See below |
| Revenue and liability recognition timing | [M05 OQ-M5-04](../../plans/M05-payout-system.md) | **Ruled.** See below |
| PSP application timing | [M03 OQ-M3-04](../../plans/M03-billing-checkout.md) | **Calendar note recorded:** applications go out **the day the capital go-decision is made**, not before and not after. The dependency was never a design one and this fixes it to an event rather than a date |

## The copy-trading clause

**Allowed:** copy trading **between accounts of the same verified identity**. A trader running the same strategy across their own Merit accounts is doing something the account cap already contemplates and the rules already bound.

**Prohibited:** copy trading **across identities**; the use of **third-party signal or copy-trading services**; and **account management**, meaning any arrangement in which one person trades an account that belongs to another.

Three consequences, all of which needed a ruling before they could be built:

1. **Cross-identity copy is itself a violation** ([M07](../../plans/M07-risk-abuse.md) D-01). Before this ruling D-01 produced flags nobody could act on, because the dossier is explicit that copy rings are not always ToS-illegal and Merit had not said which kind it forbade. D-01's output now divides cleanly: same-identity clustering is **not a flag at all** and is filtered at the detector rather than dismissed in the queue, which also removes the largest source of benign noise from M7's most-fired detector. Cross-identity clustering is a flag whose evidence is the conduct itself rather than a statistical inference.
2. **A legal drafting note** is filed in [legal/](../../legal/README.md): the ToS needs the clause enumerated in these terms, because "coordinated trading" is not a standard anyone can comply with and [M07 AS-M7-07](../../plans/M07-risk-abuse.md) requires enforcement to rest on a clause a trader can read in advance.
3. The clause is **enforceable and explicable**, which was the test. It matches what the per-entity account cap already implies, and it does not require Merit to argue about correlation coefficients in public.

## M07 detector additions

Three, each closing a gap the plan itself identified and could not close alone.

- **Day-0 graph-prior pairing from identity signals.** Candidate pairs and groups are formed from the identity graph **before any trading data exists**, so a ring that funds on day 0 is already a watched cluster rather than one discovered by twenty days of correlation. This is the direct answer to [AS-M7-01](../../plans/M07-risk-abuse.md)'s finding that the flagship detector does not defend the first cycle.
- **A young-account fast path**, with a **5 trading day window** and deliberately **tightened thresholds: correlation below -0.95, plus size and timing mirroring**. The tightening is what makes a short window usable: on five days of data a -0.8 threshold is noise, and requiring near-perfect inverse correlation together with mirrored size and timing makes a false positive very unlikely while still catching the pattern the ring actually runs. This detector is precise rather than sensitive, on purpose, because it fires on accounts too young to have any other evidence.
- **Clique-level position-sum detection.** Within a candidate clique, detect summed positions at or near zero, which is the signature of third-leg rotation and is invariant to which pair carries the hedge on a given day. It complements D-03's variance-ratio approach by working on positions rather than on realized P&L, so it fires **inside** a day rather than after the day closes, and it does not need a long history.

Together these move M7 from "detects persistence" to "detects entry", which was the honest gap in the plan as written.

## Fail-closed provisioning is design law

**No account trades until Merit has either an acknowledgement of the risk settings or a successful read-back verification of them.** Not a preference, not a default, not a configuration value: it is the design, and the absence of a confirmed setpoint is a hard block on trading rather than a marker on a dashboard.

This upgrades [M02](../../plans/M02-rithmic-bridge.md)'s AS-M2-03 counter from detection to prevention. Previously an account whose `set_risk` was never confirmed could trade while `platform.setpoint_unconfirmed` surfaced it as carried liability; now it cannot trade at all. The cost is honest and is accepted: a vendor-side confirmation gap becomes a provisioning outage for the affected accounts rather than a silent risk, and a provisioning outage is visible, bounded, and recoverable, while an unenforced funded account is none of those things.

**`V-M2-15` is added to the vendor-call agenda**, and it is a **requirement rather than a question**: Merit needs either a provisioning acknowledgement artifact or a readable current-risk-setting endpoint. Without one of the two, no account can be brought online under this rule, which makes it a commercial precondition of the relationship rather than a technical nicety. This is the strongest form of what OQ-M2-04 recommended raising on the call.

## Break-glass for the second `owner` credential

Ruled per [M06 OQ-M6-03](../../plans/M06-admin-ops-console.md)'s recommendation, in four parts, all of which must exist before launch:

1. **A sealed physical backup of the second key**, stored separately from both working keys.
2. **A documented unseal procedure**, written before it is needed rather than improvised during the incident it exists for.
3. **A quarterly existence check**, on the same ops calendar as the restore drill and the key rotation drill. The check verifies the seal is intact and the credential is still where the procedure says it is.
4. **A lost-key rotation runbook**, covering the case where a working key is lost and the sealed backup becomes the second credential.

All four land in [SECURITY section 8](../../architecture/SECURITY.md) alongside the honest statement of what dual control does and does not buy at launch scale. The reasoning behind the quarterly check is the one from the original recommendation and it is worth keeping in writing: **an untested break-glass is the same as none**, and the failure mode is discovering that during the incident.

## Ledger timing

Three recognition rules, settling [M05 OQ-M5-04](../../plans/M05-payout-system.md) and its neighbours:

| Event | Books at | Note |
|---|---|---|
| **Payout liability** | **approval** | The obligation exists the moment approval happens, because approval is irrevocable. Booking it later would mean the balance sheet disagrees with the promise |
| **Cash derecognition** | **settlement** | The cash leaves when it leaves. Under [ADR-019](../ADR-019.md) this is the **external** leg: a wallet credit moves the liability's form, not the cash |
| **Evaluation fees** | **purchase** | Recognized at purchase rather than at pass or at first trade |

This resolves the LT-01 question M05 flagged and left to the founder. The firm's split (`firm_cents`) is recognized at approval, consistent with the liability booking at the same moment, so the two halves of LT-01 are recognized together and the revenue line does not depend on a rail's latency. The wallet makes this cleaner rather than harder: liability books at approval, changes form at wallet credit, and derecognizes as cash only when the external leg settles.

## Where conservatism lives (ruled 2026-08-14)

[ADR-019](../ADR-019.md) returned the lineup to basis-day anchoring and, in doing so, removed a conservatism margin that [ADR-013](../ADR-013.md) had created by accident: the model was basis anchored while the system was settlement anchored, so realized liability sat below the modeled figure for reasons nobody had chosen.

**That margin is relocated, not lost, and the relocation is the ruling.**

| | Role |
|---|---|
| **Calibration bands**, including CVaR99 and RE-S-01's | **Central estimates.** They describe the middle of the distribution and are not to be read as conservative |
| **Correlation assumption `rho = 0.30`** | Where correlation conservatism lives. Traders do not act independently, and the reserve is sized against a book that assumes they do not |
| **Regime-stress ruin scenarios** | Where tail conservatism lives. The model is run through adverse regimes rather than being asked to imply them |
| **Reserve Coverage Ratio breaker at 1.0** | Where operational conservatism lives. It is the control that stops sales, and it is the last line rather than the first |

**The sentence that must survive into every reserve conversation: CVaR99 evaluated at `rho = 0.30` is the reserve floor, never the estimate.** Sizing the payout wallet against a central estimate is sizing against a coin flip; sizing against the floor is the point of having one. The distinction is easy to lose because both numbers come out of the same harness and are quoted with the same name.

**Why this is better than the margin it replaces.** An accidental margin is not a control: nobody knows its size, nobody reviews it, and it disappears silently the moment an unrelated decision changes an assumption, which is exactly what happened here. Three named, sized, reviewable places beat one unmeasured cushion, and each of the three can be argued about on its own terms in the C8 retro.

Binding on [SIMULATION_HARNESS](../../testing/SIMULATION_HARNESS.md), [GLOSSARY](../../GLOSSARY.md#cvar99), [M05](../../plans/M05-payout-system.md), and [M06](../../plans/M06-admin-ops-console.md).

## Two gate findings confirmed as intended (2026-08-14)

Both were raised as needing founder eyes after the batch 1 fold, and both are closed.

**Core EOD and Direct compressing to a 5 trading day cycle is CONFIRMED as intended.** [ADR-019](../ADR-019.md)'s wallet-instant credit is **lineup-wide by design**, not a Merit Rapid feature that happened to touch the other two plans. Their economics equal the original simulation calibration, which was basis anchored throughout, so the compression from 7 to 8 trading days down to 5, and the per-day rise from 16,875 to 19,286 cents up to 27,000, are what the model always described. The concern was that the anchor moved as a side effect of a ruling written about a different plan; it did not, and the item is cleared from [STATE](../../STATE.md).

**The lineup no longer landing on a single design ceiling is accepted.** The constitution's approximately $190 per day figure belonged to the settlement anchor and is superseded wherever it appears. The three plans now sit between 27,000 and 30,000 cents per trading day, and the `w=3` recalibration prices that level.

## The calibration source becomes version controlled

The founder will commit **`research/calibration/mc_lifecycle.py`** and the business-model workbook to the repository as the **version-controlled source of record** for every calibrated number in the corpus.

This closes a gap that has been load bearing since [ADR-015](../ADR-015.md): plan parameters are sourced to `mc_lifecycle.py OUR_PLANS`, and until now that file lived outside the repository, so "the source of record" was a filename rather than an artifact anyone could diff. Once committed, a parameter change is a reviewable diff against a versioned model rather than an assertion.

The path is referenced from [ADR-015](../ADR-015.md), [ADR-018](../ADR-018.md), and [SIMULATION_HARNESS](../../testing/SIMULATION_HARNESS.md), which Wave 4 writes against it.

**Status as of 2026-08-14: the files are not yet in the repository.** `research/calibration/` does not exist; the founder is uploading them. Every reference already points at that path, which is deliberate, because the path is the contract and the citations should not have to be rewritten when the artifact lands. Until then, Appendix A's parameters are sourced to the model **by citation rather than by diff**, and that is precisely the gap committing them closes. Tracked in [STATE](../../STATE.md).

---
