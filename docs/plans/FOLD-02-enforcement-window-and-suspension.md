---
status: approved
depends_on: [../decisions/README.md, ../architecture/STATE_MACHINES.md, ../architecture/DATA_MODEL.md, ../architecture/SECURITY.md, ../architecture/EVENTS.md, ../architecture/API_CONTRACT.md, ../legal/TOS_CLAUSES.md, ../DELIVERY_PLAN.md, ../ops/runbooks/CRON_INVENTORY.md, ../testing/STRATEGY.md, M02-rithmic-bridge.md, M05-payout-system.md, M06-admin-ops-console.md, M07-risk-abuse.md, M15-discord-integration.md, M20-wallet.md, FOLD-01-phone-identity.md, ../../packages/db/DELTA_MANIFEST.md]
last_updated: 2026-08-15
---

# FOLD-02: the payout enforcement window, and identity-level suspension

**A fold plan, not a module plan**, in [FOLD-01](FOLD-01-phone-identity.md)'s idiom. Two founder rulings, two ADRs, one superseded-never-edited schema change. Money path under the [ADR-003](../decisions/ADR-003.md) strict regime.

It is approved before the fold begins and it is what the fold is scored against. **It writes no ADR number into a filename it cannot rename, and it allocates no delta identifier**, per FOLD-01 section 4's finding.

---

## 1. The two rulings

**Ruling A, the payout enforcement window.** `held_pending_review`, a **pre-approval** state entered when an unresolved high-severity flag exists at request time. Hard SLA: **auto-release and pay within 48 hours** unless a documented enforcement action (closure for cause, per ToS, with an evidence pack) is recorded. The trader sees an honest status with the SLA. The external leg (wallet to Rise) supports halt-before-settlement on a flag raised after wallet credit, same 48 hour rule. Both audit-logged with a cited flag and a ToS clause, per the existing freeze constraint.

**Ruling B, identity-level suspension.** A reversible state on the trader identity halting all activity across every linked account at once: purchases and resets blocked at checkout, payout requests blocked, wallet spend and external withdrawal blocked, platform trading revoked through the Rithmic bridge, and **account state preserved intact for restoration**. Distinct from closure for cause (terminal) and from a per-account freeze (narrow). Cited flag and ToS clause, audit-logged with actor and reason, reversible with a documented restore action, and the 48 hour SLA applies where a payout is pending.

**Why they are one fold.** The corpus as frozen has exactly two enforcement shapes: a bounded freeze on an in-flight payout ([M05](M05-payout-system.md) SD-M5-01) and terminal closure ([STATE_MACHINES section 9](../architecture/STATE_MACHINES.md)). There is nothing between them, and the gap is where an operator under pressure improvises. Both rulings put a **clock that binds on Merit** into that gap.

---

## 2. Number allocation, claimed BEFORE anything is written

Per [ADR-034](../decisions/ADR-034.md) and [ADR-036](../decisions/ADR-036.md), and read against [`gates.mjs`](../../scripts/corpus/gates.mjs)'s `allocated()`, which parses **the first cell of table rows only**.

| Registry | Claim |
|---|---|
| **ADR-037**, **ADR-038** | **Taken by an open sibling pull request.** See the collision below. Not this fold's |
| **ADR-039** | **Reserved for [FOLD-01](FOLD-01-phone-identity.md)'s passwordless ADR** (its session 2). Not this fold's |
| **ADR-040** | Ruling A, the payout enforcement window |
| **ADR-041** | Ruling B, identity-level suspension |
| **`0029`** | **Reserved for `0029_phone_identity_and_auth.sql`** (FOLD-01 section 4). Not this fold's |
| **`0030`** | `0030_payout_hold_enum.sql` |
| **`0031`** | `0031_payout_hold_and_identity_restriction.sql` |

**Both reservation rows for FOLD-01 are written in the same commit as this fold's, and that is a finding rather than a courtesy.** `CI-06f` and `CI-06h` assert gaplessness over allocated **plus reserved**. Claiming 040 while 039 has no row is a hole the gate reports; claiming `0030` while `0029` has no row is the same failure on the registry that cannot be renamed, only superseded. FOLD-01 is committed on this branch and has claimed neither number yet, so this is the first session that can see both.

### The collision, found by looking rather than by a gate

**This plan first claimed 038 and 039, and both were already taken.** `claude/builder-reviewer-loop-rykvhs`, open as **PR #15**, reserved **037 and 038** in its own copy of the allocation table for the S-D review rulings. Nothing on this branch could see that: `git rev-list origin/main...HEAD` shows this branch is one commit ahead of a `main` whose table ends at 036, and **every gate here passed against that table**.

**This is `CI-06f`'s and `CI-06h`'s own declared gap, met in the wild inside two days of being declared.** [ADR-036](../decisions/ADR-036.md) states it in as many words: the table "cannot stop a branch that never reads `main`", and the cross-branch assertion "needs a job that can see both refs". The remedy that worked was reading the open pull request list before writing a number, which is a human step in a process whose whole argument is that human steps drift.

**The numbers move here rather than at merge**, on [ADR-034](../decisions/ADR-034.md)'s own tiebreak: the branch whose numbers are cited least is the one that moves, and PR #15's are cited across a landed fold while this fold's exist only inside this file.

**Every remote branch was checked, not just the one with an open pull request.** `claude/merit-futures-briefing-7auoor`, `claude/p1-scaffold-plan`, `p10` and `s-d` all carry tables ending at 035 or 036; `dev` and `premain` predate the table. **`0029` is still the next free migration number on every branch**, so only the ADR half moved.

**And a correction while in the table.** The `036` row on `main` reads "reserved, unmerged". [ADR-036](../decisions/ADR-036.md) merged in PR #11. That is the same staleness the `035` row was corrected for on 2026-08-15, recurring four rows later in the file that records it, and it is corrected in the same commit. **The sibling branch corrected it independently**, which is two branches fixing one row and is its own small argument for the cross-ref job.

---

## 3. What the primary sources say, checked rather than recalled

Six readings changed this plan. Each is a live contradiction or a proven gap, not a nuance.

| # | Finding | Source | Consequence |
|---|---|---|---|
| **1** | **The zero-denial sentence is not in [CLAUDE.md](../../CLAUDE.md).** The words "no `denied` status and no review state" are [GUIDE_BRIEFING](../GUIDE_BRIEFING.md) line 149. CLAUDE.md carries no zero-denial paragraph at all | grep of the tree | The amendment must name **every** site, and there are ten: `0001:73`, `0010:77`, `0010:225`, [STATE_MACHINES](../architecture/STATE_MACHINES.md) line 89, [M05](M05-payout-system.md) INV-M5-01, [M06](M06-admin-ops-console.md) section 1.2, [M07](M07-risk-abuse.md) line 13, [TOS_CLAUSES](../legal/TOS_CLAUSES.md) line 118, GUIDE_BRIEFING line 149, [SESSION_LOG](../SESSION_LOG.md) line 46. Amending one leaves the corpus contradicting itself in nine places |
| **2** | **Two of those ten sit inside MERGED migrations** and can never be edited | constitution E2, [`0001`](../../packages/db/migrations/0001_extensions_and_enums.sql), [`0010`](../../packages/db/migrations/0010_payouts.sql) | `0010:225` is a `COMMENT ON TABLE`, which is **replaceable metadata**, so `0031` re-states it. `0001:73` and `0010:77` are `--` comments and stay as written forever. The ADR says so rather than implying the sweep was complete, and `0031`'s header cites the ADR so a reader arriving from `0010` lands somewhere |
| **3** | **The external leg's halt already exists as columns with no state to sit in.** [`0011`](../../packages/db/migrations/0011_wallet.sql) gives `wallet_withdrawals` its `frozen_at`, `freeze_flag_id`, `freeze_expires_at` and a freeze-expiry index, and `wallet_withdrawal_status` has **no** frozen or halted value | grep of `0011` and `0001` | A halted withdrawal still matches `wallet_withdrawals_open_idx` and nothing refuses settlement. **The halt is representable and unenforced.** Section 4.5 rules how |
| **4** | **`identity_status` already carries a reversible `restricted` state**, wired end to end: the enum in `0001`, the column and its explained-reason CHECK in [`0002`](../../packages/db/migrations/0002_identity.sql), the machine with `G-ENFORCEMENT-RESTRICT` and `G-RESTRICTION-LIFTED` in [STATE_MACHINES section 9](../architecture/STATE_MACHINES.md), the `identity.restricted` event and `enforcement.applied`'s `restrict` action in [EVENTS](../architecture/EVENTS.md), wallet spend and withdrawal both blocked by it ([M20](M20-wallet.md) INV-M20-06 and section 3.4), and it is already on the trader's own `GET /me` in [API_CONTRACT](../architecture/API_CONTRACT.md) | grep of the tree | **`suspended` is `restricted` under a second name.** Section 5.1 rules it |
| **5** | **`restricted` blocks the wallet and nothing else Ruling B names.** `G-ELIGIBLE` names `payouts_frozen` on the account and the identity and does **not** name `identities.status`. Checkout has no restriction check. Nothing revokes platform trading on a restriction | [STATE_MACHINES section 10](../architecture/STATE_MACHINES.md), grep of [M03](M03-billing-checkout.md) | The state exists; **its enforcement surface does not**. That is the actual content of Ruling B |
| **6** | **`ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it.** Every migration file wraps itself in `BEGIN`/`COMMIT`, and the install job runs each file through `psql -f` in autocommit | PostgreSQL semantics, [`corpus.yml`](../../.github/workflows/corpus.yml) | The enum value and the index predicates that reference it **cannot be one file**. Hence `0030` and `0031`, and the split is proven by execution in section 8 rather than by reading |

---

## 4. Ruling A, folded

### 4.1 The ADR says it amends zero denial, in both sentences

Written into ADR-040 verbatim and in this order, because the halves are not interchangeable:

> **The substance survives.** No payout is denied. Every hold either pays inside 48 hours or produces a documented enforcement action carrying a cited flag, a ToS clause and an evidence pack.
>
> **The mechanism changes.** Zero denial was expressed as "no review state exists". It is now expressed as "a review state exists and it expires". A constraint aimed at the founder's own future self, quietly reinterpreted, is the failure it was built against, so the reinterpretation is recorded as an amendment rather than absorbed as a clarification.

The ADR carries finding 1's ten-site list and finding 2's note that two of the ten are permanent.

### 4.2 It is NOT `frozen` under a second name, and the discriminator is the ledger

**Ruled here rather than left as a resemblance.** The two states are asked the same three questions the corpus asks of any hold (is there a cited flag, does it expire, does it block settlement) and they answer identically. They diverge on the only question that decides behavior.

| | `held_pending_review` | `frozen` |
|---|---|---|
| Entered | at request time, **before** approval | from `approved`, **after** LT-01 posted |
| Ledger | **nothing posted.** No wallet credit. Nothing owed | LT-01 posted, `trader_wallet` credited, the money is already the trader's |
| Release means | **approve and pay** | let settlement proceed |
| Enforcement means | close the request. **Nothing to reverse** | LT-03 `payout_reversal` ([M05](M05-payout-system.md) section 2.1) |
| Clock | 48 hours | 10 business days proposed, [M05](M05-payout-system.md) OQ-M5-02 |

**Two consequences ruled rather than inherited.**

1. **A held request stores the full evaluated decision.** The eligibility snapshot, `approved_cents`, the split, the ordinal and the pinned plan version are computed at request time and frozen; only the ledger posting is deferred. Release is then mechanical and re-evaluates nothing, which preserves INV-M5-02 (the number shown is the number sent) and, decisively, **keeps every existing `NOT NULL` and every existing CHECK on `payout_requests` intact**. A superseding migration that relaxes `NOT NULL` on the money table has a far wider blast radius than one that only adds.
2. **A held request that reaches auto-release pays, even if the account breached during the hold.** INV-M5-09's first clause holds (the snapshot was true when it was taken); its second clause ("the money was already the trader's") does not. The first governs, because the alternative is that **Merit's own hold cost the trader money**, which is the exact shape zero denial exists to make impossible. Pinned by a golden scenario, not left to reasoning.

### 4.3 The predicate, checked against every index and CHECK on the table

A held request is **outstanding**. It joins both predicates, dropped and re-created under the same names, adjacent, in `0031`, carrying `0010`'s comment forward:

```
payout_requests_no_in_flight_uq   WHERE status IN ('approved','frozen','held_pending_review')
payout_requests_outstanding_idx   WHERE status IN ('approved','frozen','held_pending_review')
```

**This is the `C-02` defect verbatim** ([ADR-028](../decisions/ADR-028.md)): a predicate that stops matching is a gate that still exists, is still valid, enforces nothing, and fails no test. The other objects on the table were each read and dispositioned rather than assumed:

| Object | Disposition |
|---|---|
| `payout_requests_account_ordinal_uq`, `WHERE status <> 'failed'` | **Unchanged, and that is correct.** A held request holds its ordinal while held; enforcement sends it to `failed`, which releases the rung (EC-037). Verified against the file, not assumed |
| `payout_requests_freeze_is_complete` | **Unchanged.** A held row leaves the three freeze columns null and satisfies the constraint's first branch |
| `payout_requests_reflection_needs_settlement` | **Unchanged.** A held row is `pending`, which the constraint permits |
| `payout_requests_account_idempotency_uq`, `identity_approved_idx`, `freeze_expiry_idx`, `reflection_pending_idx` | Unchanged. A hold-expiry index is added beside the freeze-expiry one, in its shape |

### 4.4 The auto-release is the load-bearing control, so it is structural

It is now the only thing standing between a hold and an indefinite one. Three mechanisms, **none of them new**:

1. **The hold joins the existing hourly freeze-expiry sweep** ([CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md)), which already carries an **S1 dead-man switch** whose stated reason is that "a stalled sweep converts a bounded hold into an unbounded one, which is a denial nobody authorized". One job, one row, one switch.
2. **The alarm fires on the query, not on the job.** A nightly assertion that no request sits past its hold expiry, evaluated independently of whether the sweep reported success. This is [M02](M02-rithmic-bridge.md) FM-M2-11's idiom applied to the releaser: a job that reports success is not evidence that the work happened.
3. **It becomes the fourth unsuppressible alarm.** [M06](M06-admin-ops-console.md) OQ-M6-01 names three (ledger global imbalance, replay divergence, balance-reflection missing). A hold or a freeze past its expiry joins them, which amends that open question. **A releaser that is not running is an alarm, and an alarm that can be muted is not a control.**

**Plus one new CI gate, because the error is checkable from the tree.** **`CI-06l`, every expiry has a sweep**: each expiry column in the migration set either names a release job in CRON_INVENTORY or appears on a written exemption list with a reason, in the NO-FLOATS list's idiom. It reads the DDL and one document and needs no database. It must be watched failing on a seeded violation and **on the seeded finding**, per [`falsify.mjs`](../../scripts/corpus/falsify.mjs).

The letter is `l` because `a` through `j` are in `gates.mjs` today and **FOLD-01 section 7 claims `k`**. Gate identifiers have no allocation table, so the identifier is claimed when its [STRATEGY](../testing/STRATEGY.md) row is written, on the same discipline as a `GS-nnn`.

### 4.5 The external leg, and a deliberate asymmetry

The wallet-to-rail halt is **not** a status value and the payout hold **is**. The reason is stated in the ADR so the asymmetry does not read as an oversight:

- On `payout_requests` the hold **replaces** approval. It is mutually exclusive with every other status, so it is a status.
- On `wallet_withdrawals` the halt is **orthogonal** to the rail state: a halted withdrawal is still `approved` or `transferring` as far as the rail is concerned. Collapsing an orthogonal hold into the rail's status column is precisely SD-M5-06's warning, where the engine's gates and the rail's gates sharing one column is the named mistake.

So `0031` gives the external leg its **enforcement** rather than a state: a CHECK that a withdrawal carrying a live freeze cannot be `settled`, the open index re-created so a halted row stays visible, and the same 48 hour expiry on the same hourly sweep. Release resumes the rail; it does not re-pay, because the money is already the trader's.

### 4.6 What the trader sees

The fact, the ToS clause, and the date it resolves. Not the evidence and not the detector. [M05](M05-payout-system.md) section 3.3's existing rule governs: a review the trader cannot see the end of is indistinguishable from a refusal. [M04](M04-trader-portal.md)'s copy rule binds, so it is **never worded as a rejection**, and [M16](M16-notification-center.md) carries the notice in the security and money class, which [DELIVERY_PLAN](../DELIVERY_PLAN.md) section 2 already puts in launch scope.

---

## 5. Ruling B, folded

### 5.1 The decision this plan takes rather than defers: it is `restricted`

**Recommended: do not add a `suspended` value to `identity_status`. Give `restricted` the enforcement surface it was always supposed to have.**

The ruling asks for a reversible identity-level state halting all activity across every linked account, distinct from terminal closure and from a per-account freeze. Finding 4 shows that state already exists, is already reversible, is already a distinct third value beside `active` and `closed`, and is already visible to the trader. Finding 5 shows that what is missing is not the state but its binding surface. **Two expressions of one concept is this repository's most repeated defect**, and adding `suspended` beside `restricted` would create one deliberately, in the same week the founder ruled against it for Ruling A.

**The counter-argument, recorded because it is real.** `restricted` is a weaker word than `suspended`, and the corpus never enumerated what it restricts, so a reader could reasonably have concluded it meant something narrower. The answer is to enumerate it once, in one table, in one document, which is section 5.2. **This is the one place this plan departs from the ruling's literal wording, and it is flagged rather than absorbed.**

### 5.2 What `restricted` binds, enumerated once and asserted

| Surface | Behavior | Where it is enforced |
|---|---|---|
| Purchases and resets | refused at checkout, **server side** | [M03](M03-billing-checkout.md), joining the existing `geo_restricted` and `account_cap_reached` refusal set |
| Payout requests | blocked | **`G-ELIGIBLE` gains the identity status**. It names `payouts_frozen` today and not `status`, which is finding 5 |
| Wallet spend | blocked | Already true. [M20](M20-wallet.md) INV-M20-06 and section 3.4 rule 2 |
| External withdrawal | blocked | Already true, same source |
| Affiliate settlement | blocked | [ADR-017](../decisions/ADR-017.md) put every outbound payment on one rail, and a restriction that stops one door and not the other is not a restriction. **Confirmed against [M08](M08-affiliate-system.md) during the fold** |
| Platform trading | revoked through the Rithmic bridge | [M02](M02-rithmic-bridge.md), **PROVISIONAL**. Section 5.4 |
| Account state | **preserved intact.** No account status moves, no ladder rung is consumed, no entitlement history is rewritten | The restriction is a layer over the account machine, exactly as `payouts_frozen` and `recon_blocked` already are ([STATE_MACHINES section 1](../architecture/STATE_MACHINES.md)) |

Distinct from its two neighbours, in the ADR's own words: **closure for cause is terminal and per account**; **a freeze is per payment and expires**; **a restriction is per human, halts everything, and is reversed by a documented restore.**

### 5.3 The episode is a row, not a column

`identities` carries `status` and `status_reason` and nothing else. There is no identity status history, while `accounts` has had `account_status_history` since `0007`. A repeat restriction would overwrite its predecessor and a restore would be unprovable at exactly the moment it is contested.

`0031` therefore adds a restriction-episode table: the identity, the cited `risk_flags` id, the ToS clause, the written reason, the actor, the opened-at, the SLA due-at where a payout is pending, the restored-at, the restoring actor, the restore evidence, and the evidence-pack id on the enforcement branch. A **partial unique index gives at most one open episode per identity**, in `payout_requests_no_in_flight_uq`'s shape, and a completeness CHECK in `identities_freeze_is_explained`'s shape makes an episode with a clock and no flag, or a flag and no clock, unwritable.

**The 48 hour SLA applies where a payout is pending, and it binds the restriction rather than the payout.** A suspension cannot hold a held payout past its own 48 hours. That is the property that stops Ruling B from becoming a route around Ruling A.

### 5.4 Restoration inherits fail-closed provisioning, and the leg is PROVISIONAL

**Revocation**, fail-closed on the way out: `disable_entitlement`, then `disable_account`. Both already exist as `provisioning_queue.operation` values in `0007`.

**Restoration**, fail-closed on the way back: `set_risk` at the account's current floor **confirmed first**, then entitlement, then permissions. `0007` already makes it unwritable for a `set_risk` row to reach `confirmed_inferred`, which is exactly the guarantee restoration needs. Re-enabling an entitlement against an unconfirmed setpoint is an unenforced funded account, which **INV-M2-13 forbids** and which [M02](M02-rithmic-bridge.md) section 3.2 made design law.

**The whole platform leg is marked PROVISIONAL under [ADR-005](../decisions/ADR-005.md), and the honest form of that is an asymmetry rather than a caveat:**

> Suspension is always available. **Restoration is contingent on `V-M2-15`.** With neither an acknowledgement artifact nor a readable current risk setting, a restored account cannot be confirmed, and under INV-M2-13 an unconfirmed account does not trade. A suspended trader would be revocable and not restorable.

`V-M2-15` is the corpus's one open **commercial precondition**, [M02](M02-rithmic-bridge.md) is still at `status: review` by [ADR-005](../decisions/ADR-005.md), and this fold does not move either. It adds a row to the vendor agenda instead.

### 5.5 The entry point

[ADR-022](../decisions/ADR-022.md) tiers [M06](M06-admin-ops-console.md)'s identity-graph explorer to **v1.x**, so the one-click-from-a-cluster affordance cannot be the only way in.

- **Launch-available:** restriction is an action on M06's **flags queue** and **identity drill-down**, both v1 surfaces, sitting on the `investigating` to `enforced` path that already requires an exported evidence pack, a ToS clause and a written reason.
- **v1.x:** the graph one-click arrives with the explorer, beside its one-click evidence pack.
- Both directions inherit **GS-117**, the typed reason before the confirm control enables. Restoration is a reversal of a protective state, which is the category GS-117 names explicitly.

### 5.6 M15 moves to launch scope, and why it belongs in this ADR

**The connection is INV-M15-06**, not a roadmap preference: role removal is silent, batched, and never coincident with an enforcement, because a role disappearing at the moment an account closes publishes the enforcement to everyone in the server ([M15](M15-discord-integration.md) AS-M15-05). Ruling B creates an enforcement that halts every linked account at once. If roles sync and M15 ships later, suspension is built with no counterpart discipline and the first suspension broadcasts itself.

**The weeks are recorded**, per [DELIVERY_PLAN](../DELIVERY_PLAN.md)'s own discipline: [ADR-020](../decisions/ADR-020.md) is "+2 to 4 weeks" precisely so it can be traded.

| Option | Weeks | Contents |
|---|---|---|
| **Partial (recommended)** | **+3 to 5 days** | The link and the announcement templates, per M15's own OQ-M15-01. Role sync stays post-launch. Matches the "MUST, partially" idiom already used for M16 and M18 |
| Full | +1 to 1.5 weeks | Adds role sync and its moderation surface. Comparable to [ADR-019](../decisions/ADR-019.md)'s M20 line |

Phase **P8**, so the surface exists when P9's beta community forms. DELIVERY_PLAN sections 1, 2, 4 and 5 all move, and the 18 week headline is restated with the delta rather than left implied.

**It also amends the constitution.** Section 10 lists Discord community bot scope as post-launch among the Open Decisions Register items. The constitution is read-only and the amendment is this ADR, per [CLAUDE.md](../../CLAUDE.md) and DELIVERY_PLAN's own opening sentence. Both facts go in the ADR.

---

## 6. The migrations

**Two files, because one is impossible** (finding 6).

| File | Contents |
|---|---|
| **`0030_payout_hold_enum.sql`** | `ALTER TYPE payout_status ADD VALUE 'held_pending_review';` and nothing else. **No `BEGIN`/`COMMIT`**, deliberately, with the reason in the `E2 READ: MONEY PATH` header: PostgreSQL refuses to use a new enum value inside the transaction that added it, and every index predicate in `0031` is such a use |
| **`0031_payout_hold_and_identity_restriction.sql`** | The hold columns and their completeness CHECK; both SD-09 predicates dropped and re-created under the same names; the hold-expiry index; the external leg's settlement guard and its re-created open index; the restriction-episode table with its partial unique and its completeness CHECK; and the replacement `COMMENT ON TABLE payout_requests` carrying the amended zero-denial sentence. An `E2 READ: MONEY PATH` header naming all six |

**Two disciplines inherited from defects this corpus already paid for.** Every CHECK over an array uses `cardinality()` and never `array_length`, because a CHECK evaluating to `NULL` passes ([ADR-035](../decisions/ADR-035.md)). Every trigger body names only columns the migrations declare, which is what `CI-06j` asserts from the tree.

**Neither file edits anything.** `0001`, `0002`, `0010` and `0011` are merged and stay exactly as they are. Migrations are sacred: superseded, never edited.

---

## 7. The fold, by file

**The two rulings name eight documents. The corpus's own gates force roughly twenty-six**, and the count is stated here rather than discovered mid-session.

**Money path.** [DECISIONS](../decisions/README.md), the two migrations, [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md), [DATA_MODEL](../architecture/DATA_MODEL.md), [STATE_MACHINES](../architecture/STATE_MACHINES.md), [M05](M05-payout-system.md), [M20](M20-wallet.md), [M07](M07-risk-abuse.md), [M02](M02-rithmic-bridge.md), [SECURITY](../architecture/SECURITY.md) section 4.

**Non-money.** [M06](M06-admin-ops-console.md), [M03](M03-billing-checkout.md), [M04](M04-trader-portal.md), [M16](M16-notification-center.md), [M08](M08-affiliate-system.md) (confirm), [M15](M15-discord-integration.md), [DELIVERY_PLAN](../DELIVERY_PLAN.md), [API_CONTRACT](../architecture/API_CONTRACT.md), [EVENTS](../architecture/EVENTS.md), [TOS_CLAUSES](../legal/TOS_CLAUSES.md) clauses 5 and 13, [GUIDE_BRIEFING](../GUIDE_BRIEFING.md), [EDGE_CASES](../EDGE_CASES.md), [GOLDEN_SCENARIOS](../testing/GOLDEN_SCENARIOS.md), [STRATEGY](../testing/STRATEGY.md), [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md), [INDEX](../INDEX.md), [STATE](../STATE.md), [SESSION_LOG](../SESSION_LOG.md).

Each addition beyond the eight is forced by a named gate: `CI-06i` in both directions on DATA_MODEL, [ADR-026](../decisions/ADR-026.md)'s completeness gate on DELTA_MANIFEST, `CI-06d` and `CI-06e` on the two registries, `CI-06c` and `CI-06g` on INDEX.

**No identifier is invented here.** `SD-nn`, `INV-nn`, `EC-nnn` and `GS-nnn` are claimed by their registry row existing and take the next free number in the owning series **when that row is written**, per FOLD-01 section 4: only ADR numbers and migration numbers have an allocation table, so a plan that pre-names a delta has claimed in a registry with no claim mechanism.

**Golden scenarios: eight minimum.** Ruling A's four (hold to release, hold to enforcement, external-leg halt to release, SLA expiry auto-pay) plus Ruling B's four (restriction blocks every surface in section 5.2, restoration refused against an unconfirmed setpoint, restore succeeds and is provable from the episode row, a suspension does not extend a held payout past 48 hours). They continue from the registry's maximum, which is a generated span and is derived rather than quoted.

---

## 8. Session sequence

[ADR-003](../decisions/ADR-003.md) strict. **This is not one session.**

| # | Session | Scope |
|---|---|---|
| 1 | **This plan** | Landed. Stops here |
| 2 | ADR-040, ADR-041, **all five allocation rows**, and the stale `036` correction | **Money path.** It lands alone so a sibling branch can read the claims before writing against them |
| 3 | `0030`, `0031`, DATA_MODEL, DELTA_MANIFEST | **Money path, fresh session.** The E2 read happens on this diff, incrementally, per read-early-merge-late |
| 4 | STATE_MACHINES, M05, M20, M07, SECURITY section 4 | **Money path.** The machines and the invariants |
| 5 | M02's provisional platform leg, M06, M03, M04, M16, and the M08 confirmation | The surfaces |
| 6 | TOS clauses 5 and 13, GUIDE_BRIEFING, EVENTS, API_CONTRACT | The disclosure and contract surfaces |
| 7 | EDGE_CASES, GOLDEN_SCENARIOS, STRATEGY, `CI-06l`, CRON_INVENTORY, INDEX, STATE, SESSION_LOG | The registries and the gates |
| 8 | DELIVERY_PLAN and M15's scope move | Non-money. May compound |

**Sessions 2, 3 and 4 are money path and take a fresh session each, no exceptions.**

---

## 9. Definition of done

Nothing below is a claim. Each is a command.

1. `node scripts/corpus/gates.mjs check`, all gates green. **The runner's own check count is derived by the runner and is not stated here**, per `CI-06g`.
2. `node scripts/corpus/gates.mjs generate` regenerates every span the fold moves (`adr_count`, `ec_count`, `gs_count`, `migration_files`, `manifest_changes`, `e2_files`, `sql_tables`), run **before** the commit rather than after.
3. `node scripts/corpus/falsify.mjs`, every gate watched failing on its own seeded violation **and on the seeded finding**.
4. **The full 31-file set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP=1`**, re-applying it is rejected, and the install job emits the new object counts. Those counts are emitted, never stated.
5. **The counterfactual on the two-file split, executed.** A single file combining the `ADD VALUE` with the index predicates **must fail**, and the failure is recorded. This is `0028`'s transferable lesson: a probe that only ever attempts forbidden things passes against a guard that rejects everything, so the split is proven by watching the combined form break rather than by citing the manual.
6. `scripts/db/probe_payout_hold.sql`, **leading with the success case**. A held request auto-releases and pays at expiry; a second request on the same account is refused by the widened `no_in_flight_uq`; a held request sent to enforcement frees its ordinal; a halted withdrawal cannot reach `settled`; a restriction blocks every surface in section 5.2; restoration is refused against an unconfirmed `set_risk`.
7. **The founder's E2 read on `0030` and `0031`.** No merge without it.

---

## 10. Open questions for the founder

**OQ-F2-01. `suspended` or `restricted`?** Section 5.1, and the one place this plan departs from the ruling's literal wording. Proposed: **`restricted`**, with no new enum value, and its binding surface enumerated and asserted rather than assumed.

**OQ-F2-02. Does the 48 hour SLA also replace the freeze's proposed 10 business days?** [M05](M05-payout-system.md) OQ-M5-02 proposed 10 business days for `frozen` and has never been ruled. As this fold stands, Merit would hold itself to **48 hours where nothing has moved** and to **10 business days where the money is already the trader's**, which reads backwards from the side of the person waiting. Proposed: raise it deliberately rather than inherit it, and if the two clocks stay different, the ADR states why in one sentence.

**OQ-F2-03. M15: partial or full launch scope, and which phase?** Section 5.6. Proposed: **partial, +3 to 5 days, P8**, which is M15's own recommendation and the idiom DELIVERY_PLAN already uses for M16 and M18.

**OQ-F2-04. The unsuppressible alarm list moves from three to four.** Section 4.4, amending [M06](M06-admin-ops-console.md) OQ-M6-01. Proposed: **accept**. The auto-release is now the load-bearing control, and a control that can be muted during the incident it exists for is not one.
